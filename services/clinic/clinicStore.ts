import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";

import { bumpDatasetRevision } from "../datasetRevision";
import { encodeLogoAsync } from "../storage/imageEncoding";
import {
    listFilesByName,
} from "../storage/records";
import {
    replaceFileInDirectoryAsync,
    safeDeleteFile,
    writeJsonToDir,
} from "../storage/fsUtils";
import { getDatasetRootDirectoryAsync, initStorageAsync } from "../storage/roots";

/**
 * The clinic/hospital letterhead: name, contact details, and a logo, shown on PDF
 * reports. Stored as `clinic.json` (+ a content-addressed `clinic-logo-*` image) at the
 * DATASET root — so it exports, imports, and syncs across devices like any record
 * (generic LWW by `updatedAt`; no uid needed, there is exactly one per dataset).
 */

const CLINIC_FILE_NAME = "clinic.json";
const LOGO_PREFIX = "clinic-logo-";

export type PersistedClinicProfile = {
    schema: 1;
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    /** The treating doctor, shown on report letterheads. */
    doctorName?: string;
    department?: string;
    /** Relative file name of the logo image at the dataset root. */
    logo?: string;
    updatedAt: string;
};

export type ClinicProfile = PersistedClinicProfile & {
    /** Resolved (never persisted): absolute URI of the logo on this device. */
    logoUri?: string;
};

export type ClinicProfileInput = {
    name: string;
    address: string;
    phone: string;
    email: string;
    doctorName: string;
    department: string;
    /** A newly picked image to become the logo; omit to keep the current one. */
    logoSourceUri?: string;
};

export const readClinicProfileAsync = async (): Promise<ClinicProfile | null> => {
    await initStorageAsync();
    const root = await getDatasetRootDirectoryAsync();
    const files = listFilesByName(root);
    const file = files.get(CLINIC_FILE_NAME);
    if (!file) return null;

    try {
        const persisted = JSON.parse(await file.text()) as PersistedClinicProfile;
        return {
            ...persisted,
            logoUri: persisted.logo ? files.get(persisted.logo)?.uri : undefined,
        };
    } catch {
        return null;
    }
};

export const saveClinicProfileAsync = async (input: ClinicProfileInput): Promise<ClinicProfile> => {
    await initStorageAsync();
    const root = await getDatasetRootDirectoryAsync();
    const existing = await readClinicProfileAsync();

    let logo = existing?.logo;
    let logoUri = existing?.logoUri;

    if (input.logoSourceUri) {
        // Content-addressed stem: a changed logo is a new file name, so image caches and
        // sync both see it as a fresh file. PNG keeps transparent backgrounds transparent.
        const stem = `${LOGO_PREFIX}${Crypto.randomUUID().slice(0, 8)}`;
        const encoded = await encodeLogoAsync(input.logoSourceUri);
        const destination = await replaceFileInDirectoryAsync(root, `${stem}.png`, encoded.mimeType);
        destination.write(await new File(encoded.uri).bytes());
        await safeDeleteFile(encoded.uri);

        // Delete previous logo files.
        for (const [name, file] of listFilesByName(root)) {
            if (name.startsWith(LOGO_PREFIX) && name !== destination.name) {
                await safeDeleteFile(file);
            }
        }

        logo = destination.name;
        logoUri = destination.uri;
    }

    const persisted: PersistedClinicProfile = {
        schema: 1,
        name: input.name.trim() || undefined,
        address: input.address.trim() || undefined,
        phone: input.phone.trim() || undefined,
        email: input.email.trim() || undefined,
        doctorName: input.doctorName.trim() || undefined,
        department: input.department.trim() || undefined,
        logo,
        updatedAt: new Date().toISOString(),
    };
    await writeJsonToDir(root, CLINIC_FILE_NAME, persisted);

    bumpDatasetRevision();
    return { ...persisted, logoUri };
};
