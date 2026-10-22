// Postgres persistence for the queue state (Supabase in production, PGlite in tests).
// The rules stay in lib/queue.ts: this file only maps QueueState to rows and back.
// Every write is one transaction that compare-and-sets clinic.version, so two staff pressing
// Call next at the same moment can never both win; the loser re-reads and retries (store.ts).

import type postgres from "postgres";
import type { CallRecord, Customer, PriorityReason, QueueState, Service, Settings } from "./queue";

type Sql = postgres.Sql;

const ms = (d: Date | null | undefined) => (d ? d.getTime() : undefined);
const date = (n: number | undefined) => (n === undefined ? null : new Date(n));

interface VisitRow {
  day: string;
  id: string;
  ord: number;
  token: string;
  name: string;
  type: Customer["type"];
  service: string;
  status: Customer["status"];
  created_at: Date;
  scheduled_at: Date | null;
  arrived_at: Date | null;
  checked_in: boolean;
  called_at: Date | null;
  served_at: Date | null;
  room: string | null;
  late_converted: boolean;
  priority_reason: PriorityReason | null;
  priority_at: Date | null;
  hold_until: Date | null;
  hold_for: string | null;
}

function toCustomer(r: VisitRow): Customer {
  const c: Customer = {
    id: r.id,
    token: r.token,
    name: r.name,
    type: r.type,
    service: r.service,
    createdAt: r.created_at.getTime(),
    checkedIn: r.checked_in,
    status: r.status,
    lateConverted: r.late_converted,
  };
  if (r.scheduled_at) c.scheduledAt = ms(r.scheduled_at);
  if (r.arrived_at) c.arrivedAt = ms(r.arrived_at);
  if (r.called_at) c.calledAt = ms(r.called_at);
  if (r.served_at) c.servedAt = ms(r.served_at);
  if (r.room) c.room = r.room;
  if (r.priority_reason && r.priority_at) c.priority = { reason: r.priority_reason, at: r.priority_at.getTime() };
  if (r.hold_until && r.hold_for) c.hold = { until: r.hold_until.getTime(), for: r.hold_for };
  return c;
}

function toRow(day: string, c: Customer, ord: number): VisitRow {
  return {
    day,
    id: c.id,
    ord,
    token: c.token,
    name: c.name,
    type: c.type,
    service: c.service,
    status: c.status,
    created_at: new Date(c.createdAt),
    scheduled_at: date(c.scheduledAt),
    arrived_at: date(c.arrivedAt),
    checked_in: c.checkedIn,
    called_at: date(c.calledAt),
    served_at: date(c.servedAt),
    room: c.room ?? null,
    late_converted: c.lateConverted,
    priority_reason: c.priority?.reason ?? null,
    priority_at: date(c.priority?.at),
    hold_until: date(c.hold?.until),
    hold_for: c.hold?.for ?? null,
  };
}

const VISIT_COLUMNS = [
  "day", "id", "ord", "token", "name", "type", "service", "status", "created_at", "scheduled_at", "arrived_at",
  "checked_in", "called_at", "served_at", "room", "late_converted", "priority_reason", "priority_at",
  "hold_until", "hold_for",
] as const;

/**
 * Every query runs inside a transaction. Through Supabase's transaction pooler, a parameterised
 * query outside one can be split across server connections and hang; inside one it stays on a
 * single connection. Reads also get one consistent snapshot of the queue.
 */
function inTx<T>(sql: Sql, mode: "read" | "write", body: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(mode === "read" ? "isolation level repeatable read read only" : "read write", body) as Promise<T>;
}

/** The stored state, or null before the first write. Only today's (clinic.day's) visits are loaded. */
export function readState(sql: Sql): Promise<QueueState | null> {
  return inTx(sql, "read", (tx) => readIn(tx));
}

async function readIn(sql: postgres.TransactionSql): Promise<QueueState | null> {
  const [clinic] = await sql<{ version: string; day: string; settings: Omit<Settings, "services">; seq: Record<string, number> }[]>`
    select version::text as version, day::text as day, settings, seq from clinic where id = 1`;
  if (!clinic) return null;
  const services = await sql<{ id: string; name: string; letter: string; default_minutes: number; rooms: number; color: string | null }[]>`
    select id, name, letter, default_minutes, rooms, color from services
    where archived_at is null order by position, id`;
  const visits = await sql<VisitRow[]>`
    select ${sql(VISIT_COLUMNS.filter((c) => c !== "day"))}, day::text as day
    from visits where day = ${clinic.day} order by ord, token`;
  const calls = await sql<{ room: string; visit_id: string; token: string; reason: string; at: Date }[]>`
    select distinct on (room) room, visit_id, token, reason, at from calls
    where day = ${clinic.day} order by room, at desc`;
  const lastCalls: Record<string, CallRecord> = {};
  for (const c of calls) {
    lastCalls[c.room] = { room: c.room, customerId: c.visit_id, token: c.token, reason: c.reason, at: c.at.getTime() };
  }
  return {
    version: Number(clinic.version),
    day: clinic.day,
    settings: {
      ...clinic.settings,
      services: services.map(
        (s): Service => ({
          id: s.id,
          name: s.name,
          letter: s.letter,
          defaultMinutes: s.default_minutes,
          rooms: s.rooms,
          ...(s.color ? { color: s.color } : {}),
        }),
      ),
    },
    customers: visits.map(toCustomer),
    seq: clinic.seq,
    lastCalls,
  };
}

/**
 * Writes `next` in one transaction, only if clinic.version is still `expected` (null = nothing
 * stored yet). Returns false when another write got there first; nothing is changed then.
 */
export async function writeState(sql: Sql, next: QueueState, expected: number | null): Promise<boolean> {
  const { services, ...rules } = next.settings;
  return inTx(sql, "write", async (tx) => {
    const claimed =
      expected === null
        ? await tx`insert into clinic (id, version, day, settings, seq)
            values (1, ${next.version}, ${next.day}, ${tx.json(rules)}, ${tx.json(next.seq)})
            on conflict (id) do nothing returning id`
        : await tx`update clinic set version = ${next.version}, day = ${next.day}, settings = ${tx.json(rules)},
            seq = ${tx.json(next.seq)}, updated_at = now()
            where id = 1 and version = ${expected} returning id`;
    if (claimed.length === 0) return false;

    // Services: upsert the current list in order; archive the rest (past visits keep their name).
    // Archive first, so a letter freed by a removed service can be reused in the same write.
    const ids = services.map((s) => s.id);
    await tx`update services set archived_at = now() where archived_at is null and not (id = any(${ids}::text[]))`;
    if (services.length > 0) {
      const rows = services.map((s, i) => ({
        id: s.id,
        name: s.name,
        letter: s.letter,
        default_minutes: s.defaultMinutes,
        rooms: s.rooms,
        color: s.color ?? null,
        position: i,
        archived_at: null,
      }));
      await tx`insert into services ${tx(rows, "id", "name", "letter", "default_minutes", "rooms", "color", "position", "archived_at")}
        on conflict (id) do update set name = excluded.name, letter = excluded.letter,
          default_minutes = excluded.default_minutes, rooms = excluded.rooms, color = excluded.color,
          position = excluded.position, archived_at = null`;
    }

    // Today's visits: remove any that left the state (Reset day), then upsert the rest.
    const visitIds = next.customers.map((c) => c.id);
    await tx`delete from visits where day = ${next.day} and not (id = any(${visitIds}::text[]))`;
    if (next.customers.length > 0) {
      const rows = next.customers.map((c, i) => toRow(next.day, c, i));
      await tx`insert into visits ${tx(rows, ...VISIT_COLUMNS)}
        on conflict (day, id) do update set ord = excluded.ord, name = excluded.name, status = excluded.status,
          scheduled_at = excluded.scheduled_at, arrived_at = excluded.arrived_at, checked_in = excluded.checked_in,
          called_at = excluded.called_at, served_at = excluded.served_at, room = excluded.room,
          late_converted = excluded.late_converted, priority_reason = excluded.priority_reason,
          priority_at = excluded.priority_at, hold_until = excluded.hold_until, hold_for = excluded.hold_for`;
    }

    // Calls are history: add the latest per room if it's new.
    const calls = Object.values(next.lastCalls).filter((c) => visitIds.includes(c.customerId));
    if (calls.length > 0) {
      const rows = calls.map((c) => ({
        day: next.day,
        room: c.room,
        visit_id: c.customerId,
        token: c.token,
        reason: c.reason,
        at: new Date(c.at),
      }));
      await tx`insert into calls ${tx(rows, "day", "room", "visit_id", "token", "reason", "at")} on conflict do nothing`;
    }
    return true;
  });
}

// ---- Failed PIN attempts, per client, expiring after the window ----

export function pgFailedAttempts(sql: Sql, client: string, now: number): Promise<number> {
  return inTx(sql, "read", async (tx) => {
    const [row] = await tx<{ count: number }[]>`
      select count from login_attempts where client = ${client} and until > ${new Date(now)}`;
    return row?.count ?? 0;
  });
}

export function pgRecordFailedAttempt(sql: Sql, client: string, now: number, windowMs: number): Promise<number> {
  return inTx(sql, "write", async (tx) => {
    const [row] = await tx<{ count: number }[]>`
      insert into login_attempts (client, count, until) values (${client}, 1, ${new Date(now + windowMs)})
      on conflict (client) do update set
        count = case when login_attempts.until > ${new Date(now)} then login_attempts.count + 1 else 1 end,
        until = case when login_attempts.until > ${new Date(now)} then login_attempts.until else excluded.until end
      returning count`;
    return row.count;
  });
}

export function pgClearFailedAttempts(sql: Sql, client: string): Promise<void> {
  return inTx(sql, "write", async (tx) => {
    await tx`delete from login_attempts where client = ${client}`;
  });
}
