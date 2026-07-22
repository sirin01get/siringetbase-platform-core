// Email hashing for the global directory (GLOBAL/01 §B): the lookup key is
// a SHA-256 of the normalized email, computed by the REGIONAL instance
// before any cross-instance call — raw email never leaves regional auth.
// Normalization must be identical everywhere or the same person gets two
// directory rows, which is the exact merge problem the directory exists to
// prevent — hence one shared function with unit tests, not per-caller
// lowercasing.

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function emailHash(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeEmail(email));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
