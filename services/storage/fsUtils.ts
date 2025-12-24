import { Directory, File } from "expo-file-system";

// Shared filesystem helpers used by storage + platform drivers.
// These helpers are intentionally defensive because SAF document providers can
// throw for operations like list/create when permissions are revoked.

export const ensureDirAsync = async (dir: Directory) => {
    // Create directory tree if missing.
    // Using `idempotent: true` makes repeated calls safe.
    dir.create({ intermediates: true, idempotent: true });
};

export const listEntriesSafe = (dir: Directory): (Directory | File)[] => {
    try {
        if (!dir.exists) return [];
        return dir.list();
    } catch {
        return [];
    }
};

export const findChildDirectory = (parent: Directory, name: string): Directory | null => {
    const entry = listEntriesSafe(parent).find((item) => item instanceof Directory && item.name === name);
    return (entry as Directory | undefined) ?? null;
};

export const findChildFile = (parent: Directory, name: string): File | null => {
    const entry = listEntriesSafe(parent).find((item) => item instanceof File && item.name === name);
    return (entry as File | undefined) ?? null;
};

export const getOrCreateChildDirectoryAsync = async (parent: Directory, name: string): Promise<Directory> => {
    await ensureDirAsync(parent);

    // IMPORTANT (SAF/content URIs): some document providers allow multiple folders with the same
    // display name under the same parent. If we call `createDirectory(name)` blindly, it may
    // succeed and create a *second* folder with the same name. Always prefer an existing child.
    const existing = findChildDirectory(parent, name);
    if (existing) return existing;

    try {
        const created = parent.createDirectory(name);
        await ensureDirAsync(created);
        return created;
    } catch {
        const existingAfterError = findChildDirectory(parent, name);
        if (existingAfterError) return existingAfterError;
        throw new Error(`Failed to access directory '${name}'.`);
    }
};

export const replaceFileInDirectoryAsync = async (parent: Directory, name: string, mimeType: string | null): Promise<File> => {
    await ensureDirAsync(parent);

    const existing = findChildFile(parent, name);
    if (existing) {
        try {
            existing.delete();
        } catch {
            // Best-effort; we will attempt to create a fresh file below.
        }
    }

    // createFile will throw if a file with the same name exists.
    // If that happens (race), list and return it.
    try {
        return parent.createFile(name, mimeType);
    } catch {
        const stillThere = findChildFile(parent, name);
        if (stillThere) return stillThere;
        throw new Error(`Failed to create file '${name}'.`);
    }
};

export const safeDeleteFile = async (fileOrUri: File | string) => {
    const file = typeof fileOrUri === "string" ? new File(fileOrUri) : fileOrUri;
    try {
        file.delete();
    } catch {
        // Best-effort cleanup; missing files or permission issues should not crash the app.
    }
};

export const safeDeleteDir = async (dir: Directory) => {
    try {
        dir.delete();
    } catch {
        // Best-effort cleanup.
    }
};

export const readJsonFromDir = async <T>(dir: Directory, name: string): Promise<T | null> => {
    const file = findChildFile(dir, name);
    if (!file || !file.exists) return null;

    try {
        const content = await file.text();
        return JSON.parse(content) as T;
    } catch (error) {
        console.error(`Failed to read JSON from ${file.uri}:`, error);
        return null;
    }
};

export const writeJsonToDir = async (dir: Directory, name: string, data: unknown) => {
    const file = await replaceFileInDirectoryAsync(dir, name, "application/json");
    file.write(JSON.stringify(data, null, 2));
};
