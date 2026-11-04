/**
 * Where to send a user after sign-in. Only same-site paths are allowed:
 * the value is resolved the way a browser would (backslashes, encoded
 * characters, control characters), and anything that leaves this origin
 * falls back to the default.
 */
export function safeNextPath(value: string | null | undefined, fallback = "/app/dashboard"): string {
  if (!value || value.length > 512) return fallback;
  // Backslashes and control characters are normalised away by browsers ("/\evil.com" → "//evil.com").
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const base = "https://app.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
