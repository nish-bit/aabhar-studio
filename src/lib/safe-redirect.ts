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
    // Never "continue" to the sign-in pages themselves: a signed-in user sent to /login is sent on
    // to `next` again, and /auth/* are one-shot endpoints. Both would bounce or loop.
    const target = normalisedPathname(url.pathname, base);
    if (target === null || isSignInPath(target)) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** /login and /auth, and anything under them. `pathname` must already be normalised. */
function isSignInPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/") || pathname === "/auth" || pathname.startsWith("/auth/");
}

/**
 * The pathname as a server might finally see it, for the sign-in check only (the returned path is
 * never rewritten): percent-decoded until stable (at most 3 rounds, so "%256Cogin" is caught too),
 * re-resolved after each round so decoded "..", "." and "\" segments collapse, then lowercased so
 * "/LOGIN" and "/Auth/callback" match. Malformed encoding in the path as given, or encoding still
 * nested after 3 rounds, gives null. A later round that can't decode (a literal "%" produced by
 * "%25", as in "/app/100%25") just stops: that text is what the server sees.
 */
function normalisedPathname(pathname: string, base: string): string | null {
  let current = pathname;
  for (let round = 0; round < 3; round++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return round === 0 ? null : current.toLowerCase();
    }
    // Control characters smuggled in encoded form are never part of a real app path.
    if (/[\u0000-\u001f\u007f]/.test(decoded)) return null;
    const resolved = new URL(decoded.startsWith("/") ? decoded : `/${decoded}`, base).pathname;
    if (resolved === current) return current.toLowerCase();
    current = resolved;
  }
  return null; // still changing after 3 rounds
}
