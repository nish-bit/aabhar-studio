import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Bucket, ObjectStorage } from "./ports";

/** ObjectStorage backed by private Supabase Storage buckets. */
export class SupabaseObjectStorage implements ObjectStorage {
  constructor(private readonly db: SupabaseClient) {}

  async createSignedUploadUrl(bucket: Bucket, path: string) {
    const { data, error } = await this.db.storage.from(bucket).createSignedUploadUrl(path, { upsert: false });
    if (error || !data) throw new Error(`createSignedUploadUrl: ${error?.message}`);
    return { token: data.token, path: data.path };
  }

  async download(bucket: Bucket, path: string): Promise<Uint8Array> {
    const { data, error } = await this.db.storage.from(bucket).download(path);
    if (error || !data) throw new Error(`download: ${error?.message}`);
    return new Uint8Array(await data.arrayBuffer());
  }

  async upload(bucket: Bucket, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const { error } = await this.db.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
    if (error) throw new Error(`upload: ${error.message}`);
  }

  async remove(bucket: Bucket, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const { error } = await this.db.storage.from(bucket).remove(paths);
    if (error) throw new Error(`remove: ${error.message}`);
  }

  async signedUrl(bucket: Bucket, path: string, expiresInSeconds: number, downloadName?: string): Promise<string> {
    const { data, error } = await this.db.storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds, downloadName ? { download: downloadName } : undefined);
    if (error || !data) throw new Error(`createSignedUrl: ${error?.message}`);
    return data.signedUrl;
  }
}
