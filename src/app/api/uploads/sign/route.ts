import { z } from "zod";

import type { SignUploadResponse } from "@/lib/api-types";
import { generationDeps } from "@/server/generation/deps";
import { signUpload } from "@/server/generation/service";
import { json, readJson, withUser } from "@/server/http/respond";

const bodySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().max(100),
  sizeBytes: z.number().int().positive(),
});

/** Issue a one-time signed upload URL for a single product photo. */
export const POST = withUser(async (req, user) => {
  const body = bodySchema.parse(await readJson(req));
  const result: SignUploadResponse = await signUpload(generationDeps(), user.id, body);
  return json(result, { status: 201 });
});
