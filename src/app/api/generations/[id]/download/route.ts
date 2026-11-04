import { NextResponse } from "next/server";
import { z } from "zod";

import { generationDeps } from "@/server/generation/deps";
import { downloadUrl } from "@/server/generation/service";
import { withUser } from "@/server/http/respond";

/** Redirect to a 2-minute signed URL that downloads the result with a sensible filename. */
export const GET = withUser<{ params: Promise<{ id: string }> }>(async (_req, user, ctx) => {
  const id = z.uuid().parse((await ctx.params).id);
  const url = await downloadUrl(generationDeps(), user.id, id);
  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "private, no-store" } });
});
