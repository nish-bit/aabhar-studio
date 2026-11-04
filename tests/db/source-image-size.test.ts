import { randomUUID } from "node:crypto";

import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, createUser } from "../support/pglite-db";

/** Migration 20261103000200: no minimum photo size; the 12,000 px maximum stays. */
let pg: PGlite;

beforeAll(async () => {
  ({ pg } = await createTestDatabase());
}, 60_000);

async function readySource(width: number, height: number) {
  const u = await createUser(pg);
  const id = randomUUID();
  await pg.query(
    `insert into public.source_images (id, shop_id, uploaded_by, file_name, declared_mime_type, declared_bytes, upload_path,
       storage_path, mime_type, width, height, status)
     values ($1, $2, $3, 'small.jpg', 'image/jpeg', 30000, $4, $5, 'image/jpeg', $6, $7, 'ready')`,
    [id, u.shopId, u.userId, `${u.shopId}/${id}/upload.jpg`, `${u.shopId}/${id}/source.jpg`, width, height],
  );
}

describe("source image size rules", () => {
  it("accepts small photos such as 500×666", async () => {
    await expect(readySource(500, 666)).resolves.toBeUndefined();
  });

  it("still rejects photos over 12,000 px", async () => {
    await expect(readySource(12_001, 900)).rejects.toThrow(/check/i);
  });
});
