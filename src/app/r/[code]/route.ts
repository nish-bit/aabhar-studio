import { NextResponse } from "next/server";

import { REFERRAL_CODE_RE, REFERRAL_COOKIE } from "@/server/referrals/service";

/**
 * Invite links (/r/ABCD2345): remember the code for the sign-in callback,
 * then show the homepage. The cookie is only sent to /auth/callback, which
 * records the referral if this turns out to be a brand-new account.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const url = new URL(req.url);
  const res = NextResponse.redirect(new URL("/", url.origin), { status: 303 });
  const normalized = code.toUpperCase();
  if (REFERRAL_CODE_RE.test(normalized)) {
    res.cookies.set(REFERRAL_COOKIE, normalized, {
      path: "/auth/callback",
      maxAge: 30 * 86_400,
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
    });
  }
  return res;
}
