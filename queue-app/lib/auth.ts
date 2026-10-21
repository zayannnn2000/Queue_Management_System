// Shared staff PIN. The PIN lives only in the STAFF_PIN environment variable; staff who enter it get a
// signed, httpOnly session cookie for one shift. Web Crypto only, so it runs in the proxy and in routes.
// When STAFF_PIN is not set the front desk stays open (local development, first deploy).

export const SESSION_COOKIE = "hygieia_staff";
export const SESSION_HOURS = 12;
export const SESSION_MS = SESSION_HOURS * 60 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MS = 5 * 60 * 1000;
export const PIN_PATTERN = /^\d{4,8}$/;

export function configuredPin(): string | null {
  const pin = process.env.STAFF_PIN?.trim();
  return pin ? pin : null;
}

const encoder = new TextEncoder();

async function hmac(keyMaterial: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyMaterial),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Signing key: changing the PIN (or AUTH_SECRET) signs everyone out. */
function keyFor(pin: string, secret = process.env.AUTH_SECRET ?? ""): string {
  return `hygieia-staff|${secret}|${pin}`;
}

/** Constant-time PIN comparison (both sides hashed to the same length first). */
export async function pinMatches(input: string, pin: string): Promise<boolean> {
  const [a, b] = await Promise.all([hmac("pin-compare", input), hmac("pin-compare", pin)]);
  return sameBytes(a, b);
}

/** Cookie value: `<issuedAt>.<signature>`. */
export async function signSession(pin: string, issuedAt: number, secret?: string): Promise<string> {
  const sig = await hmac(keyFor(pin, secret), `staff:${issuedAt}`);
  return `${issuedAt}.${toBase64Url(sig)}`;
}

export async function verifySession(
  value: string | undefined,
  pin: string,
  now: number,
  secret?: string,
): Promise<boolean> {
  if (!value) return false;
  const dot = value.indexOf(".");
  const issuedAt = Number(value.slice(0, dot));
  if (dot < 1 || !Number.isFinite(issuedAt) || issuedAt > now || now - issuedAt > SESSION_MS) return false;
  const expected = await signSession(pin, issuedAt, secret);
  return sameBytes(encoder.encode(value), encoder.encode(expected));
}

/** True when the request may use staff features: no PIN configured, or a valid session cookie. */
export async function isStaff(cookieValue: string | undefined, now: number): Promise<boolean> {
  const pin = configuredPin();
  if (!pin) return true;
  return verifySession(cookieValue, pin, now);
}

/** Route-handler check, independent of the proxy: reads the session cookie from the request. */
export async function requestIsStaff(request: Request, now: number): Promise<boolean> {
  const header = request.headers.get("cookie") ?? "";
  const value = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return isStaff(value, now);
}

export const SIGNED_OUT = { ok: false, error: "Signed out. Enter the staff PIN again." } as const;

/** Only same-site staff paths are allowed as the post-sign-in destination. */
export function safeNext(next: string | null | undefined): string {
  return next && /^\/staff(\/[\w-]*)*$/.test(next) ? next : "/staff";
}
