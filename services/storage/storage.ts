import * as Crypto from "expo-crypto";
import { File, type Directory } from "expo-file-system";

import { STORAGE } from "../../constants/storage";
import type {
    Consultation,
    ConsultationInput,
    Patient,
    PatientCreateInput,
    PatientUpdateInput,
    PhotoEntry,
} from "../../types/models";
import { toPersistedConsultation, toPersistedPatient } from "../../types/models";
import {
    CidTakenError,
    nextSequentialCid,
    requireValidCid,
} from "../consultation/cid";
import { bumpDatasetRevision } from "../datasetRevision";
import { consultationIndexService } from "../indexing/consultationIndexService";
import { patientIndexService } from "../indexing/patientIndexService";
import { EmrNumberTakenError, requireValidEmrNumber } from "../patient/emr";
import { folderNameKey } from "./folderNames";
import {
    findChildDirectory,
    getOrCreateChildDirectoryAsync,
    listEntriesSafe,
    replaceFileInDirectoryAsync,
    safeDeleteDir,
    safeDeleteFile,
    writeJsonToDir,
} from "./fsUtils";
import { encodeImageForStorageAsync, encodeThumbnailAsync } from "./imageEncoding";
import {
    listFilesByName,
    readConsultationRecordAsync,
    readPatientAsync,
    readPatientRecordAsync,
    resolveConsultation,
    resolvePatient,
} from "./records";
import {
    getExistingConsultationDir,
    getExistingPatientDir,
    getOrCreateConsultationsRootDirAsync,
    getOrCreatePatientDirAsync,
    getPatientsRootDirectoryAsync,
    initStorageAsync,
} from "./roots";

const newUid = () => Crypto.randomUUID();

/** Zero-padded photo number for `<EMR>-<CID>-<NN>` names; grows past 99 naturally. */
const padPhotoNumber = (n: number) => String(n).padStart(2, "0");

/** Write `bytes-producing` encoded image into `dir` as `name`. SAF needs create-then-write. */
const writeEncodedImageAsync = async (
    encoded: { uri: string; mimeType: string },
    dir: Directory,
    name: string,
): Promise<File> => {
    const destination = await replaceFileInDirectoryAsync(dir, name, encoded.mimeType);
    // NOTE: We cannot reliably use File.copy() to SAF/content URIs.
    const bytes = await new File(encoded.uri).bytes();
    destination.write(bytes);
    await safeDeleteFile(encoded.uri);
    return destination;
};

/**
 * Encode + store one photo and its thumbnail under the consultation's human-readable
 * naming scheme. Returns the persisted entry and the resolved URIs.
 */
const savePhotoToDirAsync = async (
    sourceUri: string,
    dir: Directory,
    emr: string,
    cid: string,
    photoNumber: number,
): Promise<{ entry: PhotoEntry; uri: string; thumbUri: string | null }> => {
    const stem = `${emr}-${cid}-${padPhotoNumber(photoNumber)}`;

    const encoded = await encodeImageForStorageAsync(sourceUri);
    const photoFile = await writeEncodedImageAsync(encoded, dir, `${stem}.${encoded.ext}`);

    // A failed thumbnail must never fail the save; grids fall back to the full image.
    let thumb: string | undefined;
    let thumbUri: string | null = null;
    try {
        const thumbsDir = await getOrCreateChildDirectoryAsync(dir, STORAGE.thumbsFolderName);
        const encodedThumb = await encodeThumbnailAsync(photoFile.uri);
        const thumbFile = await writeEncodedImageAsync(encodedThumb, thumbsDir, `${stem}.jpg`);
        thumb = `${STORAGE.thumbsFolderName}/${stem}.jpg`;
        thumbUri = thumbFile.uri;
    } catch {
        thumb = undefined;
    }

    return {
        entry: {
            uid: newUid(),
            file: photoFile.name,
            thumb,
            capturedAt: new Date().toISOString(),
        },
        uri: photoFile.uri,
        thumbUri,
    };
};

/**
 * Write a newly picked profile photo (+ thumbnail) under a fresh content-addressed stem
 * and delete any previous `profile-*` files. Returns the relative names + resolved URIs.
 */
const writeProfilePhotoAsync = async (dir: Directory, sourceUri: string) => {
    const stem = `${STORAGE.profilePhotoPrefix}${newUid().slice(0, 8)}`;

    const encoded = await encodeImageForStorageAsync(sourceUri);
    const photoFile = await writeEncodedImageAsync(encoded, dir, `${stem}.${encoded.ext}`);

    let profileThumb: string | undefined;
    let profileThumbUri: string | undefined;
    try {
        const thumbsDir = await getOrCreateChildDirectoryAsync(dir, STORAGE.thumbsFolderName);
        const encodedThumb = await encodeThumbnailAsync(photoFile.uri);
        const thumbFile = await writeEncodedImageAsync(encodedThumb, thumbsDir, `${stem}.jpg`);
        profileThumb = `${STORAGE.thumbsFolderName}/${stem}.jpg`;
        profileThumbUri = thumbFile.uri;
    } catch {
        profileThumb = undefined;
    }

    // Delete stale profile photos (previous stems and their thumbs).
    for (const [name, file] of listFilesByName(dir)) {
        if (name.startsWith(STORAGE.profilePhotoPrefix) && name !== photoFile.name) {
            await safeDeleteFile(file);
        }
    }
    const thumbsDir = findChildDirectory(dir, STORAGE.thumbsFolderName);
    if (thumbsDir) {
        for (const [name, file] of listFilesByName(thumbsDir)) {
            if (name.startsWith(STORAGE.profilePhotoPrefix) && name !== `${stem}.jpg`) {
                await safeDeleteFile(file);
            }
        }
    }

    return {
        profilePhoto: photoFile.name,
        profileThumb,
        profilePhotoUri: photoFile.uri,
        profileThumbUri,
    };
};

export const initStorage = async () => {
    await initStorageAsync();
};

export const getPatient = async (patientId: string): Promise<Patient | null> => {
    await initStorage();
    const dir = getExistingPatientDir(patientId);
    if (!dir) return null;
    return readPatientAsync(dir);
};

export const deletePatient = async (patientId: string) => {
    await initStorage();
    const dir = getExistingPatientDir(patientId);

    // If the folder is missing (deleted externally), treat it as already deleted on disk.
    // The filesystem is the source-of-truth; the SQLite DB is rebuildable cache/index.
    if (dir) {
        await safeDeleteDir(dir);
    }

    // Always keep SQLite index in sync, even when the folder is already gone.
    await patientIndexService.deletePatientAsync(patientId);
    await consultationIndexService.deleteConsultationsByPatientAsync(patientId);

    bumpDatasetRevision();
};

/**
 * Create a patient under the folder named by their EMR number.
 *
 * The EMR is the identity (see types/models.ts), so this is the only place one is ever
 * assigned. Uniqueness is checked case-insensitively against the disk rather than the
 * index, and checked *before* `getOrCreatePatientDirAsync` — that helper adopts an
 * existing folder by design, which would silently merge two patients onto one record.
 */
export const createPatientAsync = async (input: PatientCreateInput): Promise<Patient> => {
    await initStorage();

    const emrNumber = requireValidEmrNumber(input.emrNumber);

    // Case-insensitive clash check: a case-insensitive filesystem would conflate folders
    // that differ only in case, so we must too.
    const emrKey = folderNameKey(emrNumber);
    const patientsRoot = await getPatientsRootDirectoryAsync();
    for (const entry of listEntriesSafe(patientsRoot)) {
        if (!(entry instanceof File) && folderNameKey(entry.name) === emrKey) {
            const owner = await readPatientRecordAsync(entry as Directory);
            throw new EmrNumberTakenError(emrNumber, owner?.name);
        }
    }

    const dir = await getOrCreatePatientDirAsync(emrNumber);
    const now = new Date().toISOString();

    const patient: Patient = {
        schema: 2,
        uid: newUid(),
        id: emrNumber,
        emrNumber,
        name: input.name.trim(),
        age: input.age,
        gender: input.gender,
        phone: input.phone?.trim() || undefined,
        createdAt: now,
        updatedAt: now,
    };

    if (input.profilePhotoUri) {
        const saved = await writeProfilePhotoAsync(dir, input.profilePhotoUri);
        patient.profilePhoto = saved.profilePhoto;
        patient.profileThumb = saved.profileThumb;
        patient.profilePhotoUri = saved.profilePhotoUri;
        patient.profileThumbUri = saved.profileThumbUri;
    }

    await writeJsonToDir(dir, STORAGE.patientFileName, toPersistedPatient(patient));
    await patientIndexService.upsertPatientAsync(patient);

    bumpDatasetRevision();
    return patient;
};

/**
 * Update a patient's details. The EMR cannot change — `PatientUpdateInput` has no such field,
 * and identity is re-derived from the folder we found rather than from anything the caller
 * passed. If the existing record can't be read, the update aborts: silently re-minting
 * `uid`/`createdAt` would corrupt identity and history.
 */
export const updatePatientAsync = async (patientId: string, input: PatientUpdateInput): Promise<Patient> => {
    await initStorage();

    const dir = getExistingPatientDir(patientId);
    if (!dir) throw new Error("That patient no longer exists on this device.");

    const existing = await readPatientRecordAsync(dir);
    if (!existing) {
        throw new Error("This patient's record could not be read, so it wasn't changed.");
    }
    const resolved = resolvePatient(dir, existing);

    const patient: Patient = {
        ...existing,
        name: input.name.trim(),
        age: input.age,
        gender: input.gender,
        phone: input.phone?.trim() || undefined,
        updatedAt: new Date().toISOString(),
        profilePhotoUri: resolved.profilePhotoUri,
        profileThumbUri: resolved.profileThumbUri,
    };

    const hasNewProfilePhoto = Boolean(
        input.profilePhotoUri && input.profilePhotoUri !== resolved.profilePhotoUri,
    );
    if (hasNewProfilePhoto && input.profilePhotoUri) {
        const saved = await writeProfilePhotoAsync(dir, input.profilePhotoUri);
        patient.profilePhoto = saved.profilePhoto;
        patient.profileThumb = saved.profileThumb;
        patient.profilePhotoUri = saved.profilePhotoUri;
        patient.profileThumbUri = saved.profileThumbUri;
    }

    await writeJsonToDir(dir, STORAGE.patientFileName, toPersistedPatient(patient));
    await patientIndexService.upsertPatientAsync(patient);

    bumpDatasetRevision();
    return patient;
};

export const getConsultation = async (patientId: string, consultationId: string): Promise<Consultation | null> => {
    await initStorage();
    const dir = getExistingConsultationDir(patientId, consultationId);
    if (!dir) return null;
    const persisted = await readConsultationRecordAsync(dir);
    return persisted ? resolveConsultation(dir, persisted) : null;
};

export const deleteConsultation = async (patientId: string, consultationId: string) => {
    await initStorage();

    const patientDir = getExistingPatientDir(patientId);

    const dir = getExistingConsultationDir(patientId, consultationId);
    if (dir) {
        await safeDeleteDir(dir);
    }

    // Always keep SQLite index in sync, even when the folder is already gone.
    await consultationIndexService.deleteConsultationAsync(patientId, consultationId);

    // Deleting a consultation is a patient record mutation; keep patient metadata/index in
    // sync. The visit number is derived from `createdAt` order, so the remaining visits
    // simply re-label themselves — there is no counter to maintain.
    const patient = patientDir ? await readPatientRecordAsync(patientDir) : null;
    if (patient && patientDir) {
        patient.updatedAt = new Date().toISOString();
        await writeJsonToDir(patientDir, STORAGE.patientFileName, patient);
        await patientIndexService.upsertPatientAsync(resolvePatient(patientDir, patient));
    }

    bumpDatasetRevision();
};

/** List the patient's existing consultation folder names (one disk listing). */
const listConsultationNames = (consultationsDir: Directory): string[] =>
    listEntriesSafe(consultationsDir)
        .filter((entry) => !(entry instanceof File))
        .map((entry) => entry.name);

export const saveConsultation = async (
    patientId: string,
    consultationId: string | null,
    input: ConsultationInput,
): Promise<Consultation> => {
    await initStorage();

    // Never create the patient folder from here: `patientId` is the EMR, and a stale route
    // param would otherwise materialise an empty patient that owns that EMR forever.
    const patientDirectory = getExistingPatientDir(patientId);
    if (!patientDirectory) throw new Error("That patient no longer exists on this device.");

    const patient = await readPatientRecordAsync(patientDirectory);
    if (!patient) {
        throw new Error("This patient's record could not be read, so nothing was saved.");
    }

    const consultationsDir = await getOrCreateConsultationsRootDirAsync(patientDirectory);

    // Creating assigns the CID (user-chosen or next sequential); editing keeps the folder
    // the id already names. The folder name is the identity — an edit must never conjure
    // a new folder, and a missing/corrupt record aborts rather than re-minting identity.
    let dir: Directory;
    let existing: Awaited<ReturnType<typeof readConsultationRecordAsync>> = null;
    let cid: string;
    let uid: string;
    let createdAt: string;
    let nextPhotoNumber: number;

    const now = new Date().toISOString();

    if (consultationId === null) {
        const existingNames = listConsultationNames(consultationsDir);
        if (input.cid) {
            cid = requireValidCid(input.cid);
            const key = folderNameKey(cid);
            if (existingNames.some((name) => folderNameKey(name) === key)) {
                throw new CidTakenError(cid);
            }
        } else {
            cid = nextSequentialCid(existingNames);
        }
        uid = newUid();
        createdAt = now;
        nextPhotoNumber = 1;
        dir = await getOrCreateChildDirectoryAsync(consultationsDir, cid);
    } else {
        const found = getExistingConsultationDir(patientId, consultationId);
        if (!found) throw new Error("That consultation no longer exists on this device.");
        dir = found;
        existing = await readConsultationRecordAsync(dir);
        if (!existing) {
            throw new Error("This consultation's record could not be read, so nothing was saved.");
        }
        cid = existing.cid;
        uid = existing.uid;
        createdAt = existing.createdAt;
        nextPhotoNumber = existing.nextPhotoNumber;
    }

    // Diff photos against what is on disk. Existing photos are matched by their resolved
    // URI; anything unmatched in the incoming list is a new capture/pick to encode. Photo
    // numbers are never reused — edits and re-adds always mint the next number.
    const resolvedExisting = existing ? resolveConsultation(dir, existing) : null;
    const entryByUri = new Map<string, { entry: PhotoEntry; uri: string; thumbUri: string | null }>();
    resolvedExisting?.photos.forEach((entry, index) => {
        entryByUri.set(resolvedExisting.photoUris[index], {
            entry,
            uri: resolvedExisting.photoUris[index],
            thumbUri: resolvedExisting.thumbUris[index],
        });
    });

    const incomingSet = new Set(input.photoUris);
    const thumbsDir = findChildDirectory(dir, STORAGE.thumbsFolderName);
    const thumbFilesByName = thumbsDir ? listFilesByName(thumbsDir) : null;

    // Delete files (and their thumbs) the user removed.
    for (const [uri, kept] of entryByUri) {
        if (incomingSet.has(uri)) continue;
        await safeDeleteFile(uri);
        if (kept.entry.thumb) {
            const thumbName = kept.entry.thumb.split("/").pop();
            const thumbFile = thumbName ? thumbFilesByName?.get(thumbName) : null;
            if (thumbFile) await safeDeleteFile(thumbFile);
        }
    }

    // Rebuild in incoming order so edited photos stay at the same position.
    const photos: PhotoEntry[] = [];
    const photoUris: string[] = [];
    const thumbUris: (string | null)[] = [];
    const seen = new Set<string>();

    for (const uri of input.photoUris) {
        if (seen.has(uri)) continue;
        seen.add(uri);

        const kept = entryByUri.get(uri);
        if (kept) {
            photos.push(kept.entry);
            photoUris.push(kept.uri);
            thumbUris.push(kept.thumbUri);
            continue;
        }

        const saved = await savePhotoToDirAsync(uri, dir, patient.emrNumber, cid, nextPhotoNumber);
        nextPhotoNumber += 1;
        photos.push(saved.entry);
        photoUris.push(saved.uri);
        thumbUris.push(saved.thumbUri);
    }

    const consultation: Consultation = {
        schema: 2,
        uid,
        id: cid,
        cid,
        patientId,
        patientUid: patient.uid,
        remarks: input.remarks.trim(),
        photos,
        nextPhotoNumber,
        createdAt,
        updatedAt: now,
        photoUris,
        thumbUris,
    };

    await writeJsonToDir(dir, STORAGE.consultationFileName, toPersistedConsultation(consultation));

    // Keep patient metadata in sync for sorting by last modified. The visit number is derived
    // from `createdAt` order, so there is no counter to advance here.
    patient.updatedAt = now;
    await writeJsonToDir(patientDirectory, STORAGE.patientFileName, patient);
    await patientIndexService.upsertPatientAsync(resolvePatient(patientDirectory, patient));

    // Update index (consultation row + gallery photo rows).
    await consultationIndexService.upsertConsultationAsync(consultation);

    bumpDatasetRevision();
    return consultation;
};
