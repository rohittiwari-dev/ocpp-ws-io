import { type NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "ocpp_sim_auth";
const MAX_AGE_SECS = 10 * 24 * 60 * 60; // 10 days

export async function POST(req: NextRequest) {
  const authEnabled = process.env.ALLOW_AUTH === "true";

  // If auth is disabled, auto-approve
  if (!authEnabled) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, "1", {
      maxAge: MAX_AGE_SECS,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    return res;
  }

  const body = await req.json().catch(() => ({}));
  const { username, password } = body as {
    username?: string;
    password?: string;
  };

  const validUser = process.env.MASTER_USERNAME;
  const validPass = process.env.MASTER_PASSWORD;
  console.log(username, password, validUser, validPass);
  if (username === validUser && password === validPass) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, "1", {
      maxAge: MAX_AGE_SECS,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    return res;
  }

  return NextResponse.json(
    { ok: false, error: "Invalid credentials" },
    { status: 401 },
  );
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return res;
}
