import { afterEach, describe, expect, it } from "vitest";
import { SESSION_MS, isStaff, pinMatches, safeNext, signSession, verifySession } from "../lib/auth";

// Test PIN only; the real one lives in the STAFF_PIN environment variable.
const PIN = "4826";
const t0 = Date.UTC(2026, 9, 22, 3, 0);

afterEach(() => {
  delete process.env.STAFF_PIN;
});

describe("staff PIN", () => {
  it("matches only the exact PIN", async () => {
    expect(await pinMatches("4826", PIN)).toBe(true);
    expect(await pinMatches("4827", PIN)).toBe(false);
    expect(await pinMatches("48260", PIN)).toBe(false);
    expect(await pinMatches("", PIN)).toBe(false);
  });

  it("accepts its own session cookie within the shift", async () => {
    const cookie = await signSession(PIN, t0);
    expect(await verifySession(cookie, PIN, t0 + 60_000)).toBe(true);
    expect(await verifySession(cookie, PIN, t0 + SESSION_MS)).toBe(true);
  });

  it("rejects expired, future, tampered and other-PIN cookies", async () => {
    const cookie = await signSession(PIN, t0);
    expect(await verifySession(cookie, PIN, t0 + SESSION_MS + 1)).toBe(false);
    expect(await verifySession(cookie, PIN, t0 - 1)).toBe(false);
    expect(await verifySession(`${t0 + 1}${cookie.slice(String(t0).length)}`, PIN, t0 + 5)).toBe(false);
    expect(await verifySession(cookie, "1111", t0 + 5)).toBe(false); // changing the PIN signs everyone out
    expect(await verifySession(undefined, PIN, t0)).toBe(false);
    expect(await verifySession("garbage", PIN, t0)).toBe(false);
  });

  it("leaves the front desk open when no PIN is configured", async () => {
    expect(await isStaff(undefined, t0)).toBe(true);
    process.env.STAFF_PIN = PIN;
    expect(await isStaff(undefined, t0)).toBe(false);
    expect(await isStaff(await signSession(PIN, t0), t0 + 1)).toBe(true);
  });

  it("only returns to staff pages after sign-in", () => {
    expect(safeNext("/staff/settings")).toBe("/staff/settings");
    expect(safeNext("https://evil.example")).toBe("/staff");
    expect(safeNext("//evil.example")).toBe("/staff");
    expect(safeNext(null)).toBe("/staff");
  });
});
