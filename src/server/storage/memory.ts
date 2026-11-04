import type { Bucket, ObjectStorage } from "@/server/generation/ports";

/**
 * In-memory ObjectStorage for tests and local demo scripts.
 * Signed URLs are fake and only meaningful within the process.
 */
export class MemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  private key(bucket: string, path: string) {
    return `${bucket}/${path}`;
  }
  put(bucket: string, path: string, bytes: Uint8Array, contentType = "application/octet-stream") {
    this.objects.set(this.key(bucket, path), { bytes, contentType });
  }
  get(bucket: string, path: string) {
    return this.objects.get(this.key(bucket, path)) ?? null;
  }
  async createSignedUploadUrl(_bucket: Bucket, path: string) {
    return { token: "memory-upload-token", path };
  }
  async download(bucket: Bucket, path: string) {
    const o = this.objects.get(this.key(bucket, path));
    if (!o) throw new Error(`not found: ${bucket}/${path}`);
    return o.bytes;
  }
  async upload(bucket: Bucket, path: string, bytes: Uint8Array, contentType: string) {
    this.put(bucket, path, bytes, contentType);
  }
  async remove(bucket: Bucket, paths: string[]) {
    paths.forEach((p) => this.objects.delete(this.key(bucket, p)));
  }
  async signedUrl(bucket: Bucket, path: string, ttl: number, downloadName?: string) {
    return `memory://${bucket}/${path}?ttl=${ttl}${downloadName ? `&download=${encodeURIComponent(downloadName)}` : ""}`;
  }
}
