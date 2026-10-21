import { SESSION_COOKIE } from "@/lib/auth";

// POST /api/logout → clears the staff session cookie ("Lock" in the front desk).
export async function POST() {
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return response;
}
