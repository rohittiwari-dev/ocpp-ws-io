import { type NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "ocpp_sim_auth";

export async function GET(req: NextRequest) {
  const authEnabled = process.env.ALLOW_AUTH === "true";

  // If auth is globally disabled, always return ok
  if (!authEnabled) return NextResponse.json({ ok: true });

  const cookie = req.cookies.get(COOKIE_NAME);
  if (cookie?.value === "1") return NextResponse.json({ ok: true });

  return NextResponse.json({ ok: false }, { status: 401 });
}
