import { isRemoteFolder, type RemoteFile } from "./driveClient";

/**
 * Rebuild the remote dataset tree from a flat Drive listing. Drive has no paths — files
 * point at parent ids — so we walk each file's parent chain up to the dataset root.
 * Files whose chain doesn't reach the root (moved out in the Drive UI, or other app
 * artifacts) are strays and simply ignored: sync tracks ids, not names, so renaming or
 * moving the root folder itself changes nothing.
 */

export type RemoteNode = {
    relPath: string;
    id: string;
    isDir: boolean;
    md5: string | null;
    size: number | null;
};

export type RemoteTree = {
    /** Files and folders under the dataset root, keyed by relPath. */
    byRelPath: Map<string, RemoteNode>;
    /** Folder ids by relPath ("" = the root itself), for creating children. */
    dirIdByRelPath: Map<string, string>;
};

export const buildRemoteTree = (files: RemoteFile[], rootId: string): RemoteTree => {
    const byId = new Map(files.map((f) => [f.id, f]));

    /** relPath relative to the root, "" for the root, or null when unreachable. */
    const relPathOf = (file: RemoteFile, seen: Set<string>): string | null => {
        if (file.id === rootId) return "";
        const parentId = file.parents[0];
        if (!parentId || seen.has(file.id)) return null;
        seen.add(file.id);

        if (parentId === rootId) return file.name;
        const parent = byId.get(parentId);
        if (!parent) return null;
        const parentPath = relPathOf(parent, seen);
        if (parentPath === null) return null;
        return parentPath === "" ? file.name : `${parentPath}/${file.name}`;
    };

    const byRelPath = new Map<string, RemoteNode>();
    const dirIdByRelPath = new Map<string, string>([["", rootId]]);

    for (const file of files) {
        if (file.id === rootId) continue;
        const relPath = relPathOf(file, new Set());
        if (relPath === null || relPath === "") continue;

        const isDir = isRemoteFolder(file);
        byRelPath.set(relPath, {
            relPath,
            id: file.id,
            isDir,
            md5: file.md5Checksum,
            size: file.size,
        });
        if (isDir) dirIdByRelPath.set(relPath, file.id);
    }

    return { byRelPath, dirIdByRelPath };
};
