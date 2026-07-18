/**
 * Pure HTML builder for consultation PDF reports (expo-print renders it). No I/O —
 * images arrive as data URIs — so the layout is unit-testable and reusable by both the
 * single-consultation report and the multi-visit patient summary.
 */

export type ReportClinic = {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    doctorName?: string;
    department?: string;
    logoDataUri?: string;
};

export type ReportPatient = {
    name: string;
    emrNumber: string;
    age?: number;
    gender?: string;
    phone?: string;
};

export type ReportConsultation = {
    cid: string;
    /** The consultation's immutable identity, printed for traceability. */
    uid: string;
    visitNumber: number | null;
    date: string;
    remarks: string;
    photoDataUris: string[];
};

const escapeHtml = (value: string): string =>
    value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

const clinicHeader = (clinic: ReportClinic): string => {
    const contact = [clinic.address, clinic.phone, clinic.email]
        .filter(Boolean)
        .map((line) => `<div>${escapeHtml(line!)}</div>`)
        .join("");

    const doctorLine = [clinic.doctorName, clinic.department].filter(Boolean).join(" · ");

    return `
      <header>
        ${clinic.logoDataUri ? `<img class="logo" src="${clinic.logoDataUri}" />` : ""}
        <div class="clinic">
          ${clinic.name ? `<div class="clinic-name">${escapeHtml(clinic.name)}</div>` : ""}
          <div class="clinic-contact">${contact}</div>
          ${doctorLine ? `<div class="doctor">${escapeHtml(doctorLine)}</div>` : ""}
        </div>
      </header>`;
};

const patientBlock = (patient: ReportPatient): string => {
    const fields: [string, string | undefined][] = [
        ["Patient", patient.name],
        ["EMR", patient.emrNumber],
        ["Age", patient.age != null ? String(patient.age) : undefined],
        ["Gender", patient.gender && patient.gender !== "unspecified" ? patient.gender : undefined],
        ["Phone", patient.phone],
    ];
    const cells = fields
        .filter(([, value]) => value)
        .map(
            ([label, value]) =>
                `<div class="field"><span class="field-label">${label}</span> ${escapeHtml(value!)}</div>`,
        )
        .join("");
    return `<section class="patient">${cells}</section>`;
};

const consultationSection = (consultation: ReportConsultation): string => {
    const photos = consultation.photoDataUris
        .map((uri) => `<div class="photo"><img src="${uri}" /></div>`)
        .join("");

    return `
      <section class="consultation">
        <div class="consultation-head">
          <span class="consultation-cid">Consultation ${escapeHtml(consultation.cid)}</span>
          <span class="consultation-meta">
            ${consultation.visitNumber ? `Visit #${consultation.visitNumber} · ` : ""}${escapeHtml(consultation.date)}
          </span>
        </div>
        <div class="consultation-uid">Record ID: ${escapeHtml(consultation.uid)}</div>
        <div class="remarks">${
            consultation.remarks ? escapeHtml(consultation.remarks).replace(/\n/g, "<br/>") : "<i>No remarks.</i>"
        }</div>
        ${photos ? `<div class="photos">${photos}</div>` : ""}
      </section>`;
};

export const buildReportHtml = (input: {
    clinic: ReportClinic;
    patient: ReportPatient;
    consultations: ReportConsultation[];
    generatedAt: string;
}): string => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, Roboto, "Segoe UI", sans-serif; color: #0f172a; padding: 28px; padding-bottom: 48px; font-size: 12px; }
  header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #0f172a; padding-bottom: 14px; }
  /* White backdrop behind the logo so transparent PNGs sit on white, never on black. */
  .logo { width: 64px; height: 64px; object-fit: contain; background: #ffffff; }
  .clinic-name { font-size: 20px; font-weight: 700; }
  .clinic-contact { margin-top: 4px; color: #475569; font-size: 11px; line-height: 1.5; }
  .doctor { margin-top: 6px; font-size: 12px; font-weight: 600; color: #0f172a; }
  .patient { display: flex; flex-wrap: wrap; gap: 6px 22px; background: #f1f5f9; border-radius: 8px; padding: 12px 14px; margin-top: 16px; }
  .field-label { color: #64748b; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; margin-right: 4px; }
  .field { font-weight: 600; }
  .consultation { margin-top: 20px; page-break-inside: avoid; }
  .consultation-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; }
  .consultation-cid { font-size: 15px; font-weight: 700; }
  .consultation-meta { color: #64748b; font-size: 11px; }
  .consultation-uid { margin-top: 4px; color: #94a3b8; font-size: 8px; font-family: Menlo, Consolas, monospace; }
  .remarks { margin-top: 10px; line-height: 1.6; white-space: normal; }
  .photos { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .photo { width: 31%; aspect-ratio: 1; }
  .photo img { width: 100%; height: 100%; object-fit: cover; border-radius: 6px; }
  /* Fixed elements repeat on every printed page — this is the per-page footer. */
  footer { position: fixed; bottom: 0; left: 28px; right: 28px; border-top: 1px solid #e2e8f0; padding: 6px 0 4px; color: #94a3b8; font-size: 8px; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  ${clinicHeader(input.clinic)}
  ${patientBlock(input.patient)}
  ${input.consultations.map(consultationSection).join("")}
  <footer>
    <span>Generated with DermaImageRecords</span>
    <span>${escapeHtml(input.generatedAt)}</span>
  </footer>
</body>
</html>`;
