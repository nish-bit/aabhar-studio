export interface PageInput {
  page?: number | null;
  pageSize?: number | null;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const MAX_PAGE = 10_000;

/** Clamps paging input; limit and offset are integers, safe to inline in SQL. */
export function pageOf(p: PageInput) {
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(p.pageSize ?? DEFAULT_PAGE_SIZE)));
  const page = Math.min(MAX_PAGE, Math.max(1, Math.trunc(p.page ?? 1)));
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

/** Escapes LIKE wildcards in user search text. */
export const likeEscape = (s: string) => `%${s.trim().replace(/[%_\\]/g, "\\$&")}%`;

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());

/** Tiny builder for parameterised WHERE clauses. */
export class Where {
  readonly clauses: string[] = [];
  readonly params: (string | number | boolean | null)[] = [];
  /** `sql` uses `?` for each parameter, in order. */
  add(sql: string, ...values: (string | number | boolean | null)[]) {
    let s = sql;
    for (const v of values) {
      this.params.push(v);
      s = s.replace("?", `$${this.params.length}`);
    }
    this.clauses.push(s);
    return this;
  }
  get sql() {
    return this.clauses.length ? `where ${this.clauses.join(" and ")}` : "";
  }
}
