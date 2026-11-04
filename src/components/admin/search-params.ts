export type RawSearchParams = Record<string, string | string[] | undefined>;

/** First value of a query parameter, or null. */
export const one = (sp: RawSearchParams, key: string): string | null => {
  const v = sp[key];
  return typeof v === "string" && v !== "" ? v : null;
};

/** Parses with a zod-like schema; invalid filters fall back to defaults instead of erroring. */
export function parseFilters<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }, sp: RawSearchParams): T {
  const flat = Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string" && v !== ""));
  const r = schema.safeParse(flat);
  if (r.success) return r.data;
  const fallback = schema.safeParse({});
  return fallback.success ? fallback.data : ({} as T);
}
