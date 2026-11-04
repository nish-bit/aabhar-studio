import { randomUUID } from "node:crypto";

import type { ReviewStatus } from "@/lib/api-types";
import { domainErrors, DomainError } from "@/server/generation/domain-error";
import type {
  AttemptRecord,
  Bucket,
  CompleteJobParams,
  CreateJobParams,
  GeneratedImageRecord,
  GenerationRepository,
  JobOptions,
  JobRecord,
  Membership,
  ObjectStorage,
  SourceImageRecord,
} from "@/server/generation/ports";

interface LedgerEntry {
  shopId: string;
  type: "grant" | "debit" | "refund";
  amount: number;
  key: string;
}

/**
 * In-memory repository that mirrors the guarantees of the SQL functions in
 * supabase/migrations: unique idempotency keys, guarded state transitions,
 * refund at most once. Used to test the service's orchestration.
 */
export class FakeRepository implements GenerationRepository {
  members = new Map<string, Membership>();
  balances = new Map<string, number>();
  ledger: LedgerEntry[] = [];
  sources = new Map<string, SourceImageRecord & { sizeBytes: number }>();
  jobs = new Map<string, JobRecord & { idempotencyKey: string; lockedUntil: number | null; costUsdMicros: number | null }>();
  attempts: AttemptRecord[] = [];
  generated = new Map<string, GeneratedImageRecord>();
  now = () => Date.now();

  addShop(userId: string, credits: number, role: Membership["role"] = "owner"): string {
    const shopId = randomUUID();
    this.members.set(userId, { shopId, role });
    this.balances.set(shopId, credits);
    this.ledger.push({ shopId, type: "grant", amount: credits, key: `grant:trial:${shopId}` });
    return shopId;
  }

  addReadySource(shopId: string, userId: string, width = 1200, height = 1200): string {
    const id = randomUUID();
    this.sources.set(id, {
      id,
      shopId,
      uploadedBy: userId,
      fileName: "necklace.jpg",
      declaredMimeType: "image/jpeg",
      status: "ready",
      uploadPath: `${shopId}/${id}/upload.jpg`,
      storagePath: `${shopId}/${id}/source.jpg`,
      mimeType: "image/jpeg",
      width,
      height,
      createdAt: new Date().toISOString(),
      sizeBytes: 1000,
    });
    return id;
  }

  private pushLedger(entry: LedgerEntry) {
    if (this.ledger.some((l) => l.key === entry.key)) return false;
    this.ledger.push(entry);
    return true;
  }

  async getMembership(userId: string) {
    return this.members.get(userId) ?? null;
  }
  async getBalance(shopId: string) {
    return this.balances.get(shopId) ?? 0;
  }
  async createSourceImage(p: Parameters<GenerationRepository["createSourceImage"]>[0]) {
    this.sources.set(p.id, {
      id: p.id,
      shopId: p.shopId,
      uploadedBy: p.userId,
      fileName: p.fileName,
      declaredMimeType: p.declaredMimeType,
      status: "pending",
      uploadPath: p.uploadPath,
      storagePath: null,
      mimeType: null,
      width: null,
      height: null,
      createdAt: new Date(this.now()).toISOString(),
      sizeBytes: p.sizeBytes,
    });
  }
  async getSourceImage(id: string) {
    return this.sources.get(id) ?? null;
  }
  async markSourceReady(id: string, d: Parameters<GenerationRepository["markSourceReady"]>[1]) {
    const s = this.sources.get(id);
    if (s && s.status === "pending") Object.assign(s, { status: "ready", ...d });
  }
  async markSourceRejected(id: string) {
    const s = this.sources.get(id);
    if (s) s.status = "rejected";
  }
  async countRecentUploads(shopId: string, sinceIso: string) {
    return [...this.sources.values()].filter((s) => s.shopId === shopId && s.createdAt >= sinceIso).length;
  }

  async createJobWithDebit(p: CreateJobParams) {
    const existing = [...this.jobs.values()].find((j) => j.idempotencyKey === p.idempotencyKey);
    if (existing) {
      if (existing.shopId !== p.shopId) throw domainErrors.forbidden();
      return { jobId: existing.id, replayed: true, balance: this.balances.get(p.shopId) ?? 0 };
    }
    const m = this.members.get(p.userId);
    if (!m || m.shopId !== p.shopId || m.role === "viewer") throw domainErrors.forbidden();
    const src = this.sources.get(p.sourceImageId);
    if (!src || src.shopId !== p.shopId) throw domainErrors.notFound("Photo");
    if (src.status !== "ready") throw new DomainError("invalid_request", "source_not_ready", 400);
    const shopJobs = [...this.jobs.values()].filter((j) => j.shopId === p.shopId);
    if (shopJobs.filter((j) => j.status === "queued" || j.status === "processing").length >= p.maxActiveJobs) {
      throw domainErrors.tooManyActive(p.maxActiveJobs);
    }
    if (shopJobs.length >= p.dailyLimit) throw domainErrors.dailyLimit();
    const balance = this.balances.get(p.shopId) ?? 0;
    if (balance < p.creditCost) throw domainErrors.insufficientCredits(p.creditCost, balance);

    const id = randomUUID();
    this.jobs.set(id, {
      id,
      shopId: p.shopId,
      sourceImageId: p.sourceImageId,
      requestedBy: p.userId,
      presetSlug: p.presetSlug,
      presetVersion: p.presetVersion,
      instructions: p.instructions,
      creditCost: p.creditCost,
      status: "queued",
      provider: p.provider,
      model: p.model,
      errorCode: null,
      errorMessage: null,
      refunded: false,
      createdAt: new Date(this.now()).toISOString(),
      startedAt: null,
      finishedAt: null,
      idempotencyKey: p.idempotencyKey,
      lockedUntil: null,
      costUsdMicros: null,
    });
    this.balances.set(p.shopId, balance - p.creditCost);
    this.pushLedger({ shopId: p.shopId, type: "debit", amount: -p.creditCost, key: `debit:job:${id}` });
    return { jobId: id, replayed: false, balance: balance - p.creditCost };
  }

  async claimJob(jobId: string, leaseSeconds: number) {
    const j = this.jobs.get(jobId);
    if (!j || j.status !== "queued") return null;
    j.status = "processing";
    j.startedAt = new Date(this.now()).toISOString();
    j.lockedUntil = this.now() + leaseSeconds * 1000;
    return { ...j };
  }
  async getJob(jobId: string) {
    const j = this.jobs.get(jobId);
    return j ? { ...j } : null;
  }
  readonly jobOptions = new Map<string, JobOptions>();
  async setJobOptions(jobId: string, o: JobOptions) {
    this.jobOptions.set(jobId, { ...o });
  }
  async getJobOptions(jobId: string) {
    return this.jobOptions.get(jobId) ?? { photoSize: null, jewelleryType: null };
  }
  async recordAttempt(a: AttemptRecord) {
    if (this.attempts.some((x) => x.jobId === a.jobId && x.attemptNo === a.attemptNo)) {
      throw new Error("duplicate attempt");
    }
    this.attempts.push(a);
  }
  async completeJob(p: CompleteJobParams) {
    const j = this.jobs.get(p.jobId);
    if (!j || j.status !== "processing") return false;
    j.status = "succeeded";
    j.finishedAt = new Date(this.now()).toISOString();
    j.costUsdMicros = p.costUsdMicros;
    const id = randomUUID();
    this.generated.set(id, {
      id,
      jobId: j.id,
      shopId: j.shopId,
      storagePath: p.storagePath,
      width: p.width,
      height: p.height,
      reviewStatus: "pending",
    });
    return true;
  }
  async failJob(jobId: string, errorCode: string, errorMessage: string, refund: boolean) {
    const j = this.jobs.get(jobId);
    if (!j || (j.status !== "queued" && j.status !== "processing")) return false;
    j.status = "failed";
    j.errorCode = errorCode;
    j.errorMessage = errorMessage;
    j.finishedAt = new Date(this.now()).toISOString();
    if (refund && j.creditCost > 0) {
      if (this.pushLedger({ shopId: j.shopId, type: "refund", amount: j.creditCost, key: `refund:job:${j.id}` })) {
        this.balances.set(j.shopId, (this.balances.get(j.shopId) ?? 0) + j.creditCost);
        j.refunded = true;
      }
    }
    return true;
  }
  async expireStaleJobs() {
    let n = 0;
    for (const j of this.jobs.values()) {
      if (j.status === "processing" && j.lockedUntil !== null && j.lockedUntil < this.now()) {
        if (await this.failJob(j.id, "timeout", "timed out", true)) n++;
      }
    }
    return n;
  }
  async getGeneratedImageForJob(jobId: string) {
    return [...this.generated.values()].find((g) => g.jobId === jobId) ?? null;
  }
  async setReviewStatus(id: string, status: ReviewStatus) {
    const g = this.generated.get(id);
    if (g) g.reviewStatus = status;
  }

  /** Sum of ledger amounts must always equal the balance. */
  ledgerSum(shopId: string) {
    return this.ledger.filter((l) => l.shopId === shopId).reduce((a, l) => a + l.amount, 0);
  }
}

export class FakeStorage implements ObjectStorage {
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  failUpload = false;

  key(bucket: Bucket, path: string) {
    return `${bucket}/${path}`;
  }
  put(bucket: Bucket, path: string, bytes: Uint8Array, contentType = "image/jpeg") {
    this.objects.set(this.key(bucket, path), { bytes, contentType });
  }
  async createSignedUploadUrl(_bucket: Bucket, path: string) {
    return { token: "upload-token", path };
  }
  async download(bucket: Bucket, path: string) {
    const o = this.objects.get(this.key(bucket, path));
    if (!o) throw new Error("not found");
    return o.bytes;
  }
  async upload(bucket: Bucket, path: string, bytes: Uint8Array, contentType: string) {
    if (this.failUpload) throw new Error("storage down");
    this.put(bucket, path, bytes, contentType);
  }
  async remove(bucket: Bucket, paths: string[]) {
    paths.forEach((p) => this.objects.delete(this.key(bucket, p)));
  }
  async signedUrl(bucket: Bucket, path: string, ttl: number, downloadName?: string) {
    return `https://storage.test/${bucket}/${path}?ttl=${ttl}${downloadName ? `&download=${downloadName}` : ""}`;
  }
}
