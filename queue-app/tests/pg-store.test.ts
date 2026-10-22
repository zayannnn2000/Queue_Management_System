// The Postgres store against a real Postgres (PGlite, in-process) over the wire protocol, with the
// same migrations and client library the app uses on Supabase.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../db/migrate.mjs";
import { pgFailedAttempts, pgRecordFailedAttempt, readState, writeState } from "../lib/pg-store";
import { type Action, type QueueState, DEFAULT_SETTINGS, applyAction, buildView, roomId } from "../lib/queue";
import { buildSeedState } from "../lib/seed";

const now = Date.UTC(2026, 9, 22, 4, 12); // 10:12 in Dhaka
const PORT = 54329;
let db: PGlite;
let server: PGLiteSocketServer;
let sql: postgres.Sql;
/** Statements sent to the database (BEGIN and COMMIT included), for counting round trips. */
let statements: string[] = [];

beforeAll(async () => {
  db = await PGlite.create();
  server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });
  await server.start();
  sql = postgres(`postgres://postgres@127.0.0.1:${PORT}/postgres`, {
    prepare: false,
    max: 1,
    onnotice: () => {},
    debug: (_connection, query) => statements.push(query.trim().split(/\s+/)[0].toLowerCase()),
  });
  await migrate(sql);
});

afterAll(async () => {
  await sql?.end();
  await server?.stop();
  await db?.close();
});

/** Apply an action and store only the difference, as the API route does. */
async function act(action: Action, at: number): Promise<QueueState> {
  const stored = (await readState(sql))!;
  const next = applyAction(stored, action, at).state;
  expect(await writeState(sql, next, stored.version, stored)).toBe(true);
  return next;
}

describe("Postgres store", () => {
  it("is empty before the first write, then round-trips the sample day exactly", async () => {
    expect(await readState(sql)).toBeNull();
    const seed = buildSeedState(now, DEFAULT_SETTINGS, 1);
    expect(await writeState(sql, seed, null)).toBe(true);
    const back = await readState(sql);
    expect(back).toEqual(seed);
    expect(buildView(back!, now)).toEqual(buildView(seed, now));
  });

  it("refuses a stale write (compare-and-set on version) and changes nothing", async () => {
    const stored = (await readState(sql))!;
    const a = applyAction(stored, { type: "addWalkIn", name: "Rina Akter", service: "consultation" }, now).state;
    const b = applyAction(stored, { type: "addWalkIn", name: "Karim Sheikh", service: "consultation" }, now).state;
    expect(await writeState(sql, a, stored.version)).toBe(true);
    expect(await writeState(sql, b, stored.version)).toBe(false); // same CW token, lost the race
    const back = (await readState(sql))!;
    expect(back.customers.at(-1)!.name).toBe("Rina Akter");
    expect(back.version).toBe(a.version);
  });

  it("stores serve & call next, priority, holds and the call history", async () => {
    const room = roomId("consultation", 1);
    let s = await act({ type: "setPriority", id: "CW-005", reason: "Elderly" }, now + 1000);
    s = await act({ type: "serve", room, callNext: true }, now + 2000);
    const back = (await readState(sql))!;
    expect(back).toEqual(s);
    expect(back.customers.find((c) => c.token === "CW-005")).toMatchObject({ status: "serving", room });
    const history = await sql`select token from calls where room = ${room} order by at`;
    expect(history.map((r) => r.token)).toEqual(["CW-003", "CW-005"]);
  });

  it("archives a removed service but keeps its finished visits, and resets the day", async () => {
    let s = await act({ type: "addService", name: "Dental", letter: "D", minutes: 20, rooms: 1 }, now + 3000);
    s = await act({ type: "addWalkIn", name: "Rubina Yasmin", service: "dental" }, now + 4000);
    s = await act({ type: "cancel", id: "DW-001" }, now + 5000);
    s = await act({ type: "removeService", id: "dental" }, now + 6000);
    expect((await readState(sql))!.settings.services.map((x) => x.id)).not.toContain("dental");
    const [dental] = await sql`select archived_at from services where id = 'dental'`;
    expect(dental.archived_at).not.toBeNull();
    expect((await readState(sql))!.customers.find((c) => c.token === "DW-001")!.status).toBe("cancelled");

    s = await act({ type: "resetDay" }, now + 7000);
    expect((await readState(sql))!).toEqual(s);
    expect(await sql`select 1 from visits`).toHaveLength(0);
    expect(await sql`select 1 from calls`).toHaveLength(0);
  });

  it("reads in one statement and writes only what changed, matching a full rewrite", async () => {
    // Start from a fresh sample day (as "Load sample day" does).
    const stored = (await readState(sql))!;
    const reseeded = buildSeedState(now, stored.settings, stored.version + 1);
    expect(await writeState(sql, reseeded, stored.version, stored)).toBe(true);

    statements = [];
    await readState(sql);
    expect(statements).toEqual(["with"]); // the whole state in one round trip

    statements = [];
    const s = await act({ type: "addWalkIn", name: "Nadia Islam", service: "blood_test" }, now + 8000);
    // read; then begin, claim the version, insert the one new visit, commit
    expect(statements).toEqual(["with", "begin", "update", "insert", "commit"]);

    // A full rewrite of the same state leaves the database exactly as the diff did.
    const viaDiff = await readState(sql);
    expect(viaDiff).toEqual(s);
    const full = { ...s, version: s.version + 1 };
    expect(await writeState(sql, full, s.version, null)).toBe(true);
    expect({ ...(await readState(sql))!, version: s.version }).toEqual(viaDiff);
  });

  it("lets the database refuse two patients being seen in one room", async () => {
    const day = (await readState(sql))!.day;
    const row = (id: string) => ({
      day, id, token: id, name: "Test Patient", type: "walk_in", service: "consultation", status: "serving",
      created_at: new Date(now), room: "consultation:1",
    });
    await expect(
      sql.begin(async (tx) => {
        await tx`insert into visits ${tx([row("CW-901"), row("CW-902")])}`;
      }),
    ).rejects.toThrow(/visits_one_serving_per_room/);
  });

  it("counts failed PIN attempts within the window", async () => {
    expect(await pgRecordFailedAttempt(sql, "203.0.113.9", now, 60_000)).toBe(1);
    expect(await pgRecordFailedAttempt(sql, "203.0.113.9", now + 1000, 60_000)).toBe(2);
    expect(await pgFailedAttempts(sql, "203.0.113.9", now + 2000)).toBe(2);
    expect(await pgFailedAttempts(sql, "203.0.113.9", now + 61_000)).toBe(0);
    expect(await pgRecordFailedAttempt(sql, "203.0.113.9", now + 61_000, 60_000)).toBe(1);
  });
});
