/**
 * Minimal SQL interface used by the catalogue repository. Production uses a
 * direct Postgres connection to Supabase (postgres.js); tests use PGlite.
 * Both run exactly the same SQL text with $1-style parameters.
 */
export type SqlParam = string | number | boolean | null | Date;

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: SqlParam[]): Promise<T[]>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}
