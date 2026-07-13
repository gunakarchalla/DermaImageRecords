/**
 * Shared validation for user-visible identifiers that become folder names (the patient's
 * EMR number, the consultation ID). The dataset must open cleanly on Linux, macOS, iOS,
 * Windows, and Android — and sync to Google Drive — so a name has to be valid on the
 * strictest platform (Windows) and unambiguous on case-insensitive filesystems.
 *
 * Case is preserved exactly as typed; uniqueness is enforced case-insensitively via
 * `folderNameKey`. Input is normalized to NFC so macOS (NFD) and Android (NFC) devices
 * can never create two byte-different folders for the same visible name.
 */

/** `< > : " / \ | ? *` are invalid on Windows; `~` is reserved for this app's temp folders. */
const FORBIDDEN_CHARS = /[<>:"/\\|?*~]/;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f]/;

/** Device names Windows refuses as file/folder names, with or without an extension. */
const WINDOWS_RESERVED = new Set([
    "con", "prn", "aux", "nul",
    "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
    "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/** The one true stored form: Unicode-normalized and trimmed. Case is left as typed. */
export const canonicalizeFolderName = (raw: string | null | undefined): string =>
    (raw ?? "").normalize("NFC").trim();

/** Comparison key for uniqueness on case-insensitive filesystems. */
export const folderNameKey = (name: string): string =>
    canonicalizeFolderName(name).toLowerCase();

export type FolderNameRules = {
    /** Route segments this name must not shadow (compared case-insensitively). */
    reserved: readonly string[];
    maxLength: number;
    /** How the identifier is called in user-facing error messages, e.g. "EMR number". */
    label: string;
};

/**
 * Validate an already-canonicalized identifier. Returns a message to show the user,
 * or `null` when the value is acceptable as a folder name on every platform.
 */
export const validateFolderName = (canonical: string, rules: FolderNameRules): string | null => {
    const { reserved, maxLength, label } = rules;

    if (!canonical) return `Enter a ${label}, or generate one.`;
    if (canonical.length > maxLength) {
        return `A ${label} can be at most ${maxLength} characters.`;
    }
    if (FORBIDDEN_CHARS.test(canonical) || CONTROL_CHARS.test(canonical)) {
        return `A ${label} can't contain any of  < > : " / \\ | ? * ~`;
    }
    if (canonical.startsWith(".") || canonical.endsWith(".")) {
        return `A ${label} can't start or end with a dot.`;
    }

    const key = canonical.toLowerCase();
    if (WINDOWS_RESERVED.has(key)) {
        return `"${canonical}" can't be used as a ${label}. Please choose another.`;
    }
    if (reserved.some((name) => name.toLowerCase() === key)) {
        return `"${canonical}" is reserved. Please choose another ${label}.`;
    }

    return null;
};
