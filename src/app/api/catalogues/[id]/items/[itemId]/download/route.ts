import { NextResponse } from "next/server";
import { z } from "zod";

import { catalogueDeps } from "@/server/catalogue/deps";
import { itemImageDownloadUrl } from "@/server/catalogue/service";
import { withUser } from "@/server/http/respond";

export const GET = withUser<{ params: Promise<{ id: string; itemId: string }> }>(async (_req, user, ctx) => {
  const p = await ctx.params;
  const url = await itemImageDownloadUrl(catalogueDeps(), user.id, z.uuid().parse(p.id), z.uuid().parse(p.itemId));
  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "private, no-store" } });
});
