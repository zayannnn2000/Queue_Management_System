// Postgres persistence for the queue state (Supabase in production, PGlite in tests).
// The rules stay in lib/queue.ts: this file only maps QueueState to rows and back.
//
// Round trips matter more than query cost here (a few hundred rows a day), so:
// - a read is ONE statement, sent with the simple protocol (one message, no parameters): it
//   returns the whole state as JSON and sees one consistent snapshot on its own;
// - a write is one transaction that compare-and-sets clinic.version and touches only what changed
//   since the state it was computed from, so two staff pressing Call next at the same moment can
//   never both win; the loser re-reads and retries (store.ts).
// Parameterised statements only ever run inside a transaction: through Supabase's transaction
// pooler they can otherwise be split across server connections and hang.

import type postgres from "postgres";
import type { CallRecord, Customer, PriorityReason, QueueState, Service, Settings } from "./queue";

type Sql = postgres.Sql;

const date = (n: number | undefined) => (n === undefined ? null : new Date(n));

/** A visit as the read query returns it: times already in epoch milliseconds. */
interface VisitJson {
  id: string;
  token: string;
  name: string;
  type: Customer["type"];
  service: string;
  status: Customer["status"];
  created_at: number;
  scheduled_at: number | null;
  arrived_at: number | null;
  checked_in: boolean;
  called_at: number | null;
  served_at: number | null;
  room: string | null;
  late_converted: boolean;
  priority_reason: PriorityReason | null;
  priority_at: number | null;
  hold_until: number | null;
  hold_for: string | null;
}

function toCustomer(r: VisitJson): Customer {
  const c: Customer = {
    id: r.id,
    token: r.token,
    name: r.name,
    type: r.type,
    service: r.service,
    createdAt: r.created_at,
    checkedIn: r.checked_in,
    status: r.status,
    lateConverted: r.late_converted,
  };
  if (r.scheduled_at !== null) c.scheduledAt = r.scheduled_at;
  if (r.arrived_at !== null) c.arrivedAt = r.arrived_at;
  if (r.called_at !== null) c.calledAt = r.called_at;
  if (r.served_at !== null) c.servedAt = r.served_at;
  if (r.room) c.room = r.room;
  if (r.priority_reason && r.priority_at !== null) c.priority = { reason: r.priority_reason, at: r.priority_at };
  if (r.hold_until !== null && r.hold_for) c.hold = { until: r.hold_until, for: r.hold_for };
  return c;
}

function toRow(day: string, c: Customer, ord: number) {
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

// Epoch milliseconds as a JSON number (null stays null).
const MS = (column: string) => `(extract(epoch from ${column}) * 1000)::bigint as ${column}`;

// The whole state in one statement: today's visits, active services and the latest call per room.
const READ_SQL = `
  with c as (select version, day, settings, seq from clinic where id = 1)
  select
    (select json_build_object('version', version::text, 'day', day::text, 'settings', settings, 'seq', seq) from c) as clinic,
    coalesce((
      select json_agg(s order by s.position, s.id)
      from (select id, name, letter, default_minutes, rooms, color, position from services where archived_at is null) s
    ), '[]'::json) as services,
    coalesce((
      select json_agg(v order by v.ord, v.token)
      from (
        select id, ord, token, name, type, service, status, ${MS("created_at")}, ${MS("scheduled_at")},
          ${MS("arrived_at")}, checked_in, ${MS("called_at")}, ${MS("served_at")}, room, late_converted,
          priority_reason, ${MS("priority_at")}, ${MS("hold_until")}, hold_for
        from visits where day = (select day from c)
      ) v
    ), '[]'::json) as visits,
    coalesce((
      select json_agg(k)
      from (
        select distinct on (room) room, visit_id, token, reason, ${MS("at")}
        from calls where day = (select day from c) order by room, at desc
      ) k
    ), '[]'::json) as calls`;

interface ReadRow {
  clinic: { version: string; day: string; settings: Omit<Settings, "services">; seq: Record<string, number> } | null;
  services: { id: string; name: string; letter: string; default_minutes: number; rooms: number; color: string | null }[];
  visits: VisitJson[];
  calls: { room: string; visit_id: string; token: string; reason: string; at: number }[];
}

/** The stored state, or null before the first write. Only today's (clinic.day's) visits are loaded. */
export async function readState(sql: Sql): Promise<QueueState | null> {
  const [row] = (await sql.unsafe(READ_SQL).simple()) as unknown as ReadRow[];
  if (!row?.clinic) return null;
  const lastCalls: Record<string, CallRecord> = {};
  for (const c of row.calls) {
    lastCalls[c.room] = { room: c.room, customerId: c.visit_id, token: c.token, reason: c.reason, at: Number(c.at) };
  }
  return {
    version: Number(row.clinic.version),
    day: row.clinic.day,
    settings: {
      ...row.clinic.settings,
      services: row.services.map(
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
    customers: row.visits.map(toCustomer),
    seq: row.clinic.seq,
    lastCalls,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Writes `next` in one transaction, only if clinic.version is still `expected` (null = nothing
 * stored yet). `prev` is the stored state `next` was computed from: only what differs from it is
 * written (all of it when there is no `prev` or the day changed). Returns false when another write
 * got there first; nothing is changed then.
 */
export async function writeState(
  sql: Sql,
  next: QueueState,
  expected: number | null,
  prev: QueueState | null = null,
): Promise<boolean> {
  const { services, ...rules } = next.settings;
  const base = prev && prev.day === next.day ? prev : null;
  const before = new Map((base?.customers ?? []).map((c, i) => [c.id, { c, i }]));
  const ids = next.customers.map((c) => c.id);
  const removed = base ? base.customers.filter((c) => !ids.includes(c.id)).map((c) => c.id) : null;
  const changed = next.customers
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => {
      const old = before.get(c.id);
      return !old || old.i !== i || !same(old.c, c);
    });
  const calls = Object.values(next.lastCalls).filter(
    (c) => ids.includes(c.customerId) && !(base && same(base.lastCalls[c.room], c)),
  );

  return sql.begin("read write", async (tx) => {
    const claimed =
      expected === null
        ? await tx`insert into clinic (id, version, day, settings, seq)
            values (1, ${next.version}, ${next.day}, ${tx.json(rules)}, ${tx.json(next.seq)})
            on conflict (id) do nothing returning id`
        : await tx`update clinic set version = ${next.version}, day = ${next.day}, settings = ${tx.json(rules)},
            seq = ${tx.json(next.seq)}, updated_at = now()
            where id = 1 and version = ${expected} returning id`;
    if (claimed.length === 0) return false;

    // Services: only when the list changed. Archive first, so a letter freed by a removed service
    // can be reused in the same write; past visits keep their service's name.
    if (!prev || !same(prev.settings.services, services)) {
      const serviceIds = services.map((s) => s.id);
      await tx`update services set archived_at = now() where archived_at is null and not (id = any(${serviceIds}::text[]))`;
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
    }

    // Today's visits: remove any that left the state (Reset day), then upsert new or changed ones.
    if (removed === null) {
      await tx`delete from visits where day = ${next.day} and not (id = any(${ids}::text[]))`;
    } else if (removed.length > 0) {
      await tx`delete from visits where day = ${next.day} and id = any(${removed}::text[])`;
    }
    if (changed.length > 0) {
      const rows = changed.map(({ c, i }) => toRow(next.day, c, i));
      await tx`insert into visits ${tx(rows, ...VISIT_COLUMNS)}
        on conflict (day, id) do update set ord = excluded.ord, name = excluded.name, status = excluded.status,
          scheduled_at = excluded.scheduled_at, arrived_at = excluded.arrived_at, checked_in = excluded.checked_in,
          called_at = excluded.called_at, served_at = excluded.served_at, room = excluded.room,
          late_converted = excluded.late_converted, priority_reason = excluded.priority_reason,
          priority_at = excluded.priority_at, hold_until = excluded.hold_until, hold_for = excluded.hold_for`;
    }

    // Calls are history: add each room's latest call if it's new.
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
  }) as Promise<boolean>;
}

// ---- Failed PIN attempts, per client, expiring after the window (in transactions: see above) ----

export function pgFailedAttempts(sql: Sql, client: string, now: number): Promise<number> {
  return sql.begin("read only", async (tx) => {
    const [row] = await tx<{ count: number }[]>`
      select count from login_attempts where client = ${client} and until > ${new Date(now)}`;
    return row?.count ?? 0;
  }) as Promise<number>;
}

export function pgRecordFailedAttempt(sql: Sql, client: string, now: number, windowMs: number): Promise<number> {
  return sql.begin("read write", async (tx) => {
    const [row] = await tx<{ count: number }[]>`
      insert into login_attempts (client, count, until) values (${client}, 1, ${new Date(now + windowMs)})
      on conflict (client) do update set
        count = case when login_attempts.until > ${new Date(now)} then login_attempts.count + 1 else 1 end,
        until = case when login_attempts.until > ${new Date(now)} then login_attempts.until else excluded.until end
      returning count`;
    return row.count;
  }) as Promise<number>;
}

export function pgClearFailedAttempts(sql: Sql, client: string): Promise<void> {
  return sql.begin("read write", async (tx) => {
    await tx`delete from login_attempts where client = ${client}`;
  }) as Promise<void>;
}
