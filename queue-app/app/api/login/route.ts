import {
  LOCKOUT_MS,
  MAX_ATTEMPTS,
  PIN_PATTERN,
  SESSION_COOKIE,
  SESSION_MS,
  configuredPin,
  pinMatches,
  signSession,
} from "@/lib/auth";
import { clearFailedAttempts, failedAttempts, recordFailedAttempt } from "@/lib/store";

/** Who is trying: Vercel sets x-real-ip / x-forwarded-for itself on every request it serves. */
function clientKey(request: Request): string {
  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local"
  );
}

// POST /api/login { pin } → sets the staff session cookie.
export async function POST(request: Request) {
  const pin = configuredPin();
  if (!pin) return Response.json({ ok: true, open: true });

  const now = Date.now();
  const client = clientKey(request);
  if ((await failedAttempts(client, now)) >= MAX_ATTEMPTS) {
    return Response.json(
      { ok: false, error: "Too many wrong PINs. Try again in 5 minutes." },
      { status: 429 },
    );
  }

  let input = "";
  try {
    input = String(((await request.json()) as { pin?: unknown }).pin ?? "").trim();
  } catch {
    return Response.json({ ok: false, error: "Enter the staff PIN." }, { status: 400 });
  }

  if (!PIN_PATTERN.test(input) || !(await pinMatches(input, pin))) {
    const count = await recordFailedAttempt(client, now, LOCKOUT_MS);
    const left = MAX_ATTEMPTS - count;
    return Response.json(
      {
        ok: false,
        error: left > 0 ? `That PIN isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong PINs. Try again in 5 minutes.",
      },
      { status: left > 0 ? 401 : 429 },
    );
  }

  await clearFailedAttempts(client);
  const response = Response.json({ ok: true });
  const cookie = [
    `${SESSION_COOKIE}=${await signSession(pin, now)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
  response.headers.append("Set-Cookie", cookie);
  return response;
}
