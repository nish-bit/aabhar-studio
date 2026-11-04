import { ensureUserShop } from "@/server/auth/ensure-shop";
import type { CatalogueLayout, CatalogueOrientation, CatalogueSpec } from "@/lib/catalogue";
import type { Db, SqlParam } from "@/server/db/sql";

/**
 * SQL for catalogues. Every statement is scoped by shop_id, which callers
 * take from the signed-in user's membership — never from the request — so a
 * catalogue or item id from another shop simply isn't found.
 */

export interface CatalogueRow {
  id: string;
  shopId: string;
  name: string;
  layout: CatalogueLayout;
  orientation: CatalogueOrientation;
  coverTitle: string;
  coverSubtitle: string;
  showPrices: boolean;
  priceNote: string;
  includeCover: boolean;
  includeContactPage: boolean;
  version: number;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CatalogueItemRow {
  id: string;
  catalogueId: string;
  position: number;
  generatedImageId: string | null;
  imagePath: string | null;
  name: string;
  sku: string;
  description: string;
  pricePaise: number | null;
  specs: CatalogueSpec[];
}

export interface BusinessProfileRow {
  businessName: string;
  logoPath: string | null;
  logoMimeType: string | null;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  address: string;
}

export interface ApprovedImageRow {
  generatedImageId: string;
  storagePath: string;
  fileName: string;
  presetSlug: string;
  reviewedAt: string | null;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));

const CATALOGUE_COLUMNS = `
  id, shop_id as "shopId", name, layout::text as layout, orientation::text as orientation,
  cover_title as "coverTitle", cover_subtitle as "coverSubtitle", show_prices as "showPrices",
  price_note as "priceNote", include_cover as "includeCover", include_contact_page as "includeContactPage",
  version, updated_at as "updatedAt", deleted_at as "deletedAt"`;

function toCatalogue(r: Record<string, unknown>): CatalogueRow {
  return { ...(r as unknown as CatalogueRow), updatedAt: iso(r.updatedAt), deletedAt: isoOrNull(r.deletedAt) };
}

function parseSpecs(v: unknown): CatalogueSpec[] {
  const arr = typeof v === "string" ? (JSON.parse(v) as unknown) : v;
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x): x is { label: unknown; value: unknown } => typeof x === "object" && x !== null)
    .map((x) => ({ label: String(x.label ?? ""), value: String(x.value ?? "") }));
}

export class CatalogueRepository {
  constructor(private readonly db: Db) {}

  async countActive(shopId: string): Promise<number> {
    const rows = await this.db.query<{ n: number }>(`select count(*)::int as n from public.catalogues where shop_id = $1 and deleted_at is null`, [shopId]);
    return rows[0]?.n ?? 0;
  }

  /* ------------------------------------------------------------- membership */
  /** Sets up the user's own shop if it's missing (idempotent). See src/server/auth/ensure-shop.ts. */
  ensureUserShop(userId: string): Promise<boolean> {
    return ensureUserShop(this.db, userId);
  }

  async membership(userId: string): Promise<{ shopId: string; role: "owner" | "editor" | "viewer" } | null> {
    const rows = await this.db.query<{ shopId: string; role: "owner" | "editor" | "viewer" }>(
      `select shop_id as "shopId", role::text as role from public.shop_members where user_id = $1 order by created_at limit 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  /* ------------------------------------------------------------- catalogues */
  async list(shopId: string, deleted: boolean) {
    const rows = await this.db.query<Record<string, unknown>>(
      `select ${CATALOGUE_COLUMNS},
              (select count(*)::int from public.catalogue_items i where i.catalogue_id = c.id) as "itemCount",
              (select g.storage_path from public.catalogue_items i
                 join public.generated_images g on g.id = i.generated_image_id
                where i.catalogue_id = c.id order by i.position limit 1) as "coverPath"
         from public.catalogues c
        where c.shop_id = $1 and (c.deleted_at is not null) = $2
        order by ${deleted ? "c.deleted_at" : "c.updated_at"} desc
        limit 200`,
      [shopId, deleted],
    );
    return rows.map((r) => ({ ...toCatalogue(r), itemCount: r.itemCount as number, coverPath: (r.coverPath as string | null) ?? null }));
  }

  async get(shopId: string, id: string, opts: { includeDeleted?: boolean } = {}): Promise<CatalogueRow | null> {
    const rows = await this.db.query<Record<string, unknown>>(
      `select ${CATALOGUE_COLUMNS} from public.catalogues
        where id = $1 and shop_id = $2 ${opts.includeDeleted ? "" : "and deleted_at is null"}`,
      [id, shopId],
    );
    return rows[0] ? toCatalogue(rows[0]) : null;
  }

  async create(shopId: string, userId: string, name: string): Promise<CatalogueRow> {
    const rows = await this.db.query<Record<string, unknown>>(
      `insert into public.catalogues (shop_id, name, created_by) values ($1, $2, $3) returning ${CATALOGUE_COLUMNS}`,
      [shopId, name, userId],
    );
    return toCatalogue(rows[0]!);
  }

  /**
   * Update settings with optimistic concurrency. Returns null when the
   * version doesn't match (someone else saved first) or it isn't found.
   */
  async updateSettings(
    shopId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<Omit<CatalogueRow, "id" | "shopId" | "version" | "updatedAt" | "deletedAt">>,
  ): Promise<CatalogueRow | null> {
    const columns: Record<string, string> = {
      name: "name",
      layout: "layout",
      orientation: "orientation",
      coverTitle: "cover_title",
      coverSubtitle: "cover_subtitle",
      showPrices: "show_prices",
      priceNote: "price_note",
      includeCover: "include_cover",
      includeContactPage: "include_contact_page",
    };
    const sets: string[] = [];
    const params: SqlParam[] = [id, shopId, expectedVersion];
    for (const [key, column] of Object.entries(columns)) {
      const value = patch[key as keyof typeof patch];
      if (value === undefined) continue;
      params.push(value as SqlParam);
      const cast = key === "layout" ? "::public.catalogue_layout" : key === "orientation" ? "::public.catalogue_orientation" : "";
      sets.push(`${column} = $${params.length}${cast}`);
    }
    sets.push("version = version + 1", "updated_at = now()");
    const rows = await this.db.query<Record<string, unknown>>(
      `update public.catalogues set ${sets.join(", ")}
        where id = $1 and shop_id = $2 and version = $3 and deleted_at is null
        returning ${CATALOGUE_COLUMNS}`,
      params,
    );
    return rows[0] ? toCatalogue(rows[0]) : null;
  }

  /**
   * Mark the catalogue as edited after an item change. Only updated_at moves:
   * `version` guards the catalogue's own settings, so editing products in one
   * place doesn't make a settings save elsewhere look like a conflict.
   */
  private async touch(db: Db, shopId: string, id: string) {
    await db.query(`update public.catalogues set updated_at = now() where id = $1 and shop_id = $2`, [id, shopId]);
  }

  async softDelete(shopId: string, id: string): Promise<boolean> {
    const rows = await this.db.query(
      `update public.catalogues set deleted_at = now(), updated_at = now() where id = $1 and shop_id = $2 and deleted_at is null returning id`,
      [id, shopId],
    );
    return rows.length > 0;
  }

  async restore(shopId: string, id: string): Promise<boolean> {
    const rows = await this.db.query(
      `update public.catalogues set deleted_at = null, updated_at = now(), version = version + 1
        where id = $1 and shop_id = $2 and deleted_at is not null returning id`,
      [id, shopId],
    );
    return rows.length > 0;
  }

  /** Copy a catalogue and all its items in one transaction. */
  async duplicate(shopId: string, userId: string, id: string, newName: string): Promise<CatalogueRow | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.query<Record<string, unknown>>(
        `insert into public.catalogues (shop_id, name, layout, orientation, cover_title, cover_subtitle, show_prices,
                                        price_note, include_cover, include_contact_page, created_by)
         select shop_id, $3, layout, orientation, cover_title, cover_subtitle, show_prices,
                price_note, include_cover, include_contact_page, $4
           from public.catalogues where id = $1 and shop_id = $2 and deleted_at is null
         returning ${CATALOGUE_COLUMNS}`,
        [id, shopId, newName, userId],
      );
      if (!rows[0]) return null;
      const copy = toCatalogue(rows[0]);
      await tx.query(
        `insert into public.catalogue_items (catalogue_id, shop_id, generated_image_id, position, name, sku, description, price_paise, specs)
         select $1, shop_id, generated_image_id, position, name, sku, description, price_paise, specs
           from public.catalogue_items where catalogue_id = $2 and shop_id = $3`,
        [copy.id, id, shopId],
      );
      return copy;
    });
  }

  /* ------------------------------------------------------------------ items */
  async items(shopId: string, catalogueId: string): Promise<CatalogueItemRow[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      `select i.id, i.catalogue_id as "catalogueId", i.position, i.generated_image_id as "generatedImageId",
              g.storage_path as "imagePath", i.name, i.sku, i.description,
              i.price_paise::float8 as "pricePaise", i.specs
         from public.catalogue_items i
         left join public.generated_images g on g.id = i.generated_image_id and g.shop_id = i.shop_id
        where i.catalogue_id = $1 and i.shop_id = $2
        order by i.position`,
      [catalogueId, shopId],
    );
    return rows.map((r) => ({
      ...(r as unknown as CatalogueItemRow),
      pricePaise: r.pricePaise === null ? null : Number(r.pricePaise),
      specs: parseSpecs(r.specs),
    }));
  }

  /**
   * Append approved images from this shop, skipping ones already in the
   * catalogue. Images that aren't approved or belong to another shop are
   * ignored. Returns how many were added.
   */
  async addItems(shopId: string, catalogueId: string, generatedImageIds: string[], maxItems: number): Promise<{ added: number; rejected: number }> {
    return this.db.transaction(async (tx) => {
      const locked = await tx.query(
        `select id from public.catalogues where id = $1 and shop_id = $2 and deleted_at is null for update`,
        [catalogueId, shopId],
      );
      if (locked.length === 0) throw new Error("catalogue_not_found");

      const valid = await tx.query<{ id: string }>(
        `select g.id from public.generated_images g
          where g.id = any($1::uuid[]) and g.shop_id = $2 and g.review_status = 'approved'
            and not exists (select 1 from public.catalogue_items i where i.catalogue_id = $3 and i.generated_image_id = g.id)`,
        [`{${generatedImageIds.join(",")}}`, shopId, catalogueId],
      );
      // Keep the order the user selected them in.
      const validSet = new Set(valid.map((v) => v.id));
      const ordered = [...new Set(generatedImageIds)].filter((id) => validSet.has(id));

      const [{ count, next }] = await tx.query<{ count: number; next: number }>(
        `select count(*)::int as count, coalesce(max(position) + 1, 0)::int as next from public.catalogue_items where catalogue_id = $1`,
        [catalogueId],
      ) as [{ count: number; next: number }];
      if (count + ordered.length > maxItems) throw new Error("too_many_items");

      for (const [i, imageId] of ordered.entries()) {
        await tx.query(
          `insert into public.catalogue_items (catalogue_id, shop_id, generated_image_id, position) values ($1, $2, $3, $4)`,
          [catalogueId, shopId, imageId, next + i],
        );
      }
      if (ordered.length > 0) await this.touch(tx, shopId, catalogueId);
      return { added: ordered.length, rejected: new Set(generatedImageIds).size - ordered.length };
    });
  }

  async updateItem(
    shopId: string,
    catalogueId: string,
    itemId: string,
    patch: { name?: string; sku?: string; description?: string; pricePaise?: number | null; specs?: CatalogueSpec[] },
  ): Promise<boolean> {
    const sets: string[] = [];
    const params: SqlParam[] = [itemId, catalogueId, shopId];
    const push = (column: string, value: SqlParam, cast = "") => {
      params.push(value);
      sets.push(`${column} = $${params.length}${cast}`);
    };
    if (patch.name !== undefined) push("name", patch.name);
    if (patch.sku !== undefined) push("sku", patch.sku);
    if (patch.description !== undefined) push("description", patch.description);
    if (patch.pricePaise !== undefined) push("price_paise", patch.pricePaise, "::bigint");
    if (patch.specs !== undefined) push("specs", JSON.stringify(patch.specs), "::jsonb");
    if (sets.length === 0) return true;
    sets.push("updated_at = now()");
    return this.db.transaction(async (tx) => {
      const rows = await tx.query(
        `update public.catalogue_items set ${sets.join(", ")}
          where id = $1 and catalogue_id = $2 and shop_id = $3
            and exists (select 1 from public.catalogues c where c.id = $2 and c.shop_id = $3 and c.deleted_at is null)
          returning id`,
        params,
      );
      if (rows.length > 0) await this.touch(tx, shopId, catalogueId);
      return rows.length > 0;
    });
  }

  async removeItem(shopId: string, catalogueId: string, itemId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.query(
        `delete from public.catalogue_items where id = $1 and catalogue_id = $2 and shop_id = $3 returning id`,
        [itemId, catalogueId, shopId],
      );
      if (rows.length === 0) return false;
      // Close the gap so positions stay 0..n-1.
      await tx.query(
        `update public.catalogue_items i set position = r.rn - 1
           from (select id, row_number() over (order by position) as rn from public.catalogue_items where catalogue_id = $1) r
          where i.id = r.id`,
        [catalogueId],
      );
      await this.touch(tx, shopId, catalogueId);
      return true;
    });
  }

  /** Set the full order. The list must contain exactly the catalogue's current items. */
  async reorder(shopId: string, catalogueId: string, itemIds: string[]): Promise<"ok" | "not_found" | "mismatch"> {
    return this.db.transaction(async (tx) => {
      const locked = await tx.query(
        `select id from public.catalogues where id = $1 and shop_id = $2 and deleted_at is null for update`,
        [catalogueId, shopId],
      );
      if (locked.length === 0) return "not_found";
      const current = await tx.query<{ id: string }>(`select id from public.catalogue_items where catalogue_id = $1 and shop_id = $2`, [catalogueId, shopId]);
      const currentSet = new Set(current.map((r) => r.id));
      if (itemIds.length !== currentSet.size || new Set(itemIds).size !== itemIds.length || !itemIds.every((id) => currentSet.has(id))) {
        return "mismatch";
      }
      // The (catalogue_id, position) constraint is deferred, so swaps are fine within the transaction.
      for (const [position, id] of itemIds.entries()) {
        await tx.query(`update public.catalogue_items set position = $1 where id = $2`, [position, id]);
      }
      await this.touch(tx, shopId, catalogueId);
      return "ok";
    });
  }

  /* ------------------------------------------------------- approved images */
  async approvedImages(shopId: string, limit: number, beforeIso: string | null): Promise<ApprovedImageRow[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      `select g.id as "generatedImageId", g.storage_path as "storagePath", s.file_name as "fileName",
              j.preset_slug as "presetSlug", g.reviewed_at as "reviewedAt", g.created_at as "createdAt"
         from public.generated_images g
         join public.generation_jobs j on j.id = g.job_id
         join public.source_images s on s.id = j.source_image_id
        where g.shop_id = $1 and g.review_status = 'approved' and ($2::timestamptz is null or g.created_at < $2::timestamptz)
        order by g.created_at desc
        limit $3`,
      [shopId, beforeIso, limit],
    );
    return rows.map((r) => ({
      generatedImageId: r.generatedImageId as string,
      storagePath: r.storagePath as string,
      fileName: r.fileName as string,
      presetSlug: r.presetSlug as string,
      reviewedAt: isoOrNull(r.reviewedAt),
    }));
  }

  /* -------------------------------------------------------- business profile */
  async businessProfile(shopId: string): Promise<BusinessProfileRow> {
    const rows = await this.db.query<BusinessProfileRow>(
      `select business_name as "businessName", logo_path as "logoPath", logo_mime_type as "logoMimeType",
              phone, whatsapp, email, website, address
         from public.business_profiles where shop_id = $1`,
      [shopId],
    );
    return (
      rows[0] ?? { businessName: "", logoPath: null, logoMimeType: null, phone: "", whatsapp: "", email: "", website: "", address: "" }
    );
  }

  async updateBusinessProfile(shopId: string, patch: Partial<Omit<BusinessProfileRow, "logoPath" | "logoMimeType">>): Promise<void> {
    const columns: Record<string, string> = {
      businessName: "business_name",
      phone: "phone",
      whatsapp: "whatsapp",
      email: "email",
      website: "website",
      address: "address",
    };
    const params: SqlParam[] = [shopId];
    const cols: string[] = [];
    const sets: string[] = [];
    for (const [key, column] of Object.entries(columns)) {
      const value = patch[key as keyof typeof patch];
      if (value === undefined) continue;
      params.push(value);
      cols.push(column);
      sets.push(`${column} = excluded.${column}`);
    }
    if (cols.length === 0) return;
    await this.db.query(
      `insert into public.business_profiles (shop_id, ${cols.join(", ")})
       values ($1, ${cols.map((_, i) => `$${i + 2}`).join(", ")})
       on conflict (shop_id) do update set ${sets.join(", ")}, updated_at = now()`,
      params,
    );
  }

  async setLogo(shopId: string, path: string | null, mimeType: string | null): Promise<void> {
    await this.db.query(
      `insert into public.business_profiles (shop_id, logo_path, logo_mime_type) values ($1, $2, $3)
       on conflict (shop_id) do update set logo_path = excluded.logo_path, logo_mime_type = excluded.logo_mime_type, updated_at = now()`,
      [shopId, path, mimeType],
    );
  }

  /* ----------------------------------------------------------------- exports */
  async recordExport(e: {
    shopId: string;
    catalogueId: string;
    kind: "pdf" | "images_zip" | "preview";
    storagePath: string;
    bytes: number;
    pageCount: number | null;
    catalogueVersion: number;
    userId: string;
  }): Promise<{ id: string; createdAt: string }> {
    const rows = await this.db.query<{ id: string; createdAt: unknown }>(
      `insert into public.catalogue_exports (catalogue_id, shop_id, kind, storage_path, bytes, page_count, catalogue_version, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, created_at as "createdAt"`,
      [e.catalogueId, e.shopId, e.kind, e.storagePath, e.bytes, e.pageCount, e.catalogueVersion, e.userId],
    );
    return { id: rows[0]!.id, createdAt: iso(rows[0]!.createdAt) };
  }
}
