import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import { readClinicProfileAsync } from "../../services/clinic/clinicStore";
import { toRenderableImageUriAsync } from "../../services/imageUri";
import { consultationIndexService } from "../../services/indexing/consultationIndexService";
import { safeDeleteFile } from "../../services/storage/fsUtils";
import { getConsultation, getPatient } from "../../services/storage/storage";
import {
    buildReportHtml,
    type ReportClinic,
    type ReportConsultation,
} from "./consultationReportHtml";

/**
 * Assemble and share a PDF report: single consultation ("Share PDF") or a multi-visit
 * patient summary. Photos are embedded at FULL resolution (clinical detail matters more
 * than file size; a report is shared deliberately) — the thumbnail is only a fallback
 * for a photo whose original can't be read.
 */

/** A dataset image → data URI, via the render cache (SAF content:// can't be read raw). */
const toDataUriAsync = async (uri: string | null): Promise<string | null> => {
    if (!uri) return null;
    try {
        const renderable = await toRenderableImageUriAsync(uri);
        if (!renderable) return null;
        const base64 = await new File(renderable).base64();
        const mime = renderable.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
        return `data:${mime};base64,${base64}`;
    } catch {
        return null;
    }
};

const buildReportConsultationAsync = async (
    patientId: string,
    consultationId: string,
): Promise<ReportConsultation | null> => {
    const consultation = await getConsultation(patientId, consultationId);
    if (!consultation) return null;

    const photoDataUris: string[] = [];
    for (let i = 0; i < consultation.photoUris.length; i += 1) {
        const dataUri =
            (await toDataUriAsync(consultation.photoUris[i])) ??
            (await toDataUriAsync(consultation.thumbUris[i]));
        if (dataUri) photoDataUris.push(dataUri);
    }

    return {
        cid: consultation.cid,
        uid: consultation.uid,
        visitNumber: await consultationIndexService.getConsultationNumberAsync(
            patientId,
            consultationId,
        ),
        date: new Date(consultation.createdAt).toLocaleDateString(),
        remarks: consultation.remarks,
        photoDataUris,
    };
};

/** Sanitize an identifier for use inside the PDF file name. */
const fileSafe = (value: string): string => value.replace(/[^A-Za-z0-9-]+/g, "_");

/**
 * Build the PDF for the given consultations of one patient (chronological order) and
 * hand it to the OS share sheet.
 */
export const sharePatientReportAsync = async (
    patientId: string,
    consultationIds: readonly string[],
): Promise<void> => {
    if (!(await Sharing.isAvailableAsync())) {
        throw new Error("Sharing isn't available on this device.");
    }

    const patient = await getPatient(patientId);
    if (!patient) throw new Error("That patient no longer exists on this device.");

    const clinicProfile = await readClinicProfileAsync();
    const clinic: ReportClinic = {
        name: clinicProfile?.name,
        address: clinicProfile?.address,
        phone: clinicProfile?.phone,
        email: clinicProfile?.email,
        doctorName: clinicProfile?.doctorName,
        department: clinicProfile?.department,
        logoDataUri: (await toDataUriAsync(clinicProfile?.logoUri ?? null)) ?? undefined,
    };

    const consultations: ReportConsultation[] = [];
    for (const consultationId of consultationIds) {
        const report = await buildReportConsultationAsync(patientId, consultationId);
        if (report) consultations.push(report);
    }
    if (consultations.length === 0) {
        throw new Error("None of the selected consultations could be read.");
    }
    consultations.sort((a, b) => (a.visitNumber ?? 0) - (b.visitNumber ?? 0));

    const html = buildReportHtml({
        clinic,
        patient: {
            name: patient.name,
            emrNumber: patient.emrNumber,
            age: patient.age,
            gender: patient.gender,
            phone: patient.phone,
        },
        consultations,
        generatedAt: new Date().toLocaleString(),
    });

    const printed = await Print.printToFileAsync({ html });
    // printToFileAsync mints a random name; give the shared file a meaningful one.
    const named = new File(
        Paths.cache,
        consultations.length === 1
            ? `Report-${fileSafe(patientId)}-${fileSafe(consultations[0].cid)}.pdf`
            : `Report-${fileSafe(patientId)}-summary.pdf`,
    );
    try {
        const printedFile = new File(printed.uri);
        if (named.exists) named.delete();
        printedFile.move(named);

        await Sharing.shareAsync(named.uri, {
            mimeType: "application/pdf",
            dialogTitle: "Share consultation report",
            UTI: "com.adobe.pdf",
        });
    } finally {
        await safeDeleteFile(named);
        await safeDeleteFile(new File(printed.uri));
    }
};
