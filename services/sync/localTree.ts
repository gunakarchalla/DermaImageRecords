import * as Crypto from "expo-crypto";
import { Directory, File } from "expo-file-system";

import { listEntriesSafe } from "../storage/fsUtils";
import { isTempFolderName } from "../storage/records";
import { getDatasetRootDirectoryAsync, initStorageAsync } from "../storage/roots";

/**
 * A snapshot of the local dataset keyed by relPath ("patients/ABC/consultations/001/…",
 * "/"-separated, rooted at the dataset root). JSON files carry a content fingerprint so
 * the diff can tell "changed since last sync" without re-reading at compare time; photos
 * are immutable-by-name, so presence is identity.
 */

export type LocalNode = {
    relPath: string;
    isDir: boolean;
    /** md5 of the JSON content (JSON files only — the LWW/state fingerprint). */
    jsonFingerprint: string | null;
    /** Absolute URI (files only), for uploads. */
    uri: string | null;
    mimeType: string;
};

const mimeForName = (name: string): string => {
    const lower = name.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".json")) return "application/json";
    return "application/octet-stream";
};

const walkAsync = async (
    dir: Directory,
    prefix: string,
    out: Map<string, LocalNode>,
): Promise<void> => {
    for (const entry of listEntriesSafe(dir)) {
        if (isTempFolderName(entry.name)) continue;
        const relPath = `${prefix}${entry.name}`;

        if (entry instanceof Directory) {
            out.set(relPath, {
                relPath,
                isDir: true,
                jsonFingerprint: null,
                uri: null,
                mimeType: "folder",
            });
            await walkAsync(entry, `${relPath}/`, out);
            continue;
        }

        const isJson = entry.name.toLowerCase().endsWith(".json");
        let jsonFingerprint: string | null = null;
        if (isJson) {
            try {
                jsonFingerprint = await Crypto.digestStringAsync(
                    Crypto.CryptoDigestAlgorithm.MD5,
                    await (entry as File).text(),
                );
            } catch {
                // Unreadable JSON: fingerprint stays null; the diff treats it as changed
                // and the reconcile pass decides with full content in hand.
            }
        }

        out.set(relPath, {
            relPath,
            isDir: false,
            jsonFingerprint,
            uri: entry.uri,
            mimeType: mimeForName(entry.name),
        });
    }
};

/** Walk the dataset root. Requires storage to be initialised (never prompts). */
export const buildLocalTreeAsync = async (): Promise<Map<string, LocalNode>> => {
    await initStorageAsync();
    const root = await getDatasetRootDirectoryAsync();
    const out = new Map<string, LocalNode>();
    await walkAsync(root, "", out);
    return out;
};
