import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { catalogueDeps } from "@/server/catalogue/deps";
import { renderCatalogue } from "@/server/catalogue/service";
import { BUCKETS } from "@/server/generation/ports";
import { withUser } from "@/server/http/respond";
import { enforceRateLimit } from "@/server/http/rate-limit";

export const maxDuration = 120;

/** Same layout as the export, with screen-resolution images. */
export const GET = withUser<{ params: Promise<{ id: string }> }>(async (_req, user, ctx) => {
  await enforceRateLimit("cataloguePreview", user.id);
  const id = z.uuid().parse((await ctx.params).id);
  const deps = catalogueDeps();
  const { pdf, catalogue } = await renderCatalogue(deps, user.id, id, "preview");

  // Serverless responses are size-limited (4.5 MB on Vercel); large previews go via storage.
  if (pdf.byteLength > 4_000_000) {
    const path = `${catalogue.shopId}/${id}/preview-${catalogue.version}-${randomUUID()}.pdf`;
    await deps.storage.upload(BUCKETS.catalogues, path, new Uint8Array(pdf), "application/pdf");
    // Tracked so the retention job deletes it (previews are kept for a day).
    await deps.repo.recordExport({
      shopId: catalogue.shopId, catalogueId: id, kind: "preview", storagePath: path, bytes: pdf.byteLength,
      pageCount: null, catalogueVersion: catalogue.version, userId: user.id,
    });
    return NextResponse.redirect(await deps.storage.signedUrl(BUCKETS.catalogues, path, 300), 303);
  }
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline; filename=\"preview.pdf\"",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
