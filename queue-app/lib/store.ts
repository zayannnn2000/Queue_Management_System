// Persistence for the single shared queue state.
// Postgres (Supabase on Vercel) when a database URL is set, otherwise process memory (local dev).
// Writes are compare-and-set on `version`, so concurrent staff actions never overwrite each other.
// An empty store starts with the fictional sample day.

import "server-only";
import postgres from "postgres";
import { pgClearFailedAttempts, pgFailedAttempts, pgRecordFailedAttempt, readState, writeState } from "./pg-store";
import { DEFAULT_SETTINGS, type QueueState, rolloverIfNewDay, upgradeState } from "./queue";
import { buildSeedState } from "./seed";

export type StorageKind = "postgres" | "memory";

interface Store {
  kind: StorageKind;
  read(): Promise<QueueState | null>;
  /** Writes `next` only if the stored version is still `expected` (null = nothing stored). */
  write(next: QueueState, expected: number | null): Promise<boolean>;
}

// Supabase's pooled URL (transaction mode) needs prepare: false. Kept small: serverless instances
// each hold their own pool. One pool per process, even though Next loads this module once per
// server bundle. A local database (PGlite, `npm run db:local`) takes one connection.
const url = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
const local = url ? /@(localhost|127\.0\.0\.1)[:/]/.test(url) : false;
const pool = globalThis as unknown as { __queueSql?: postgres.Sql };
const sql = url
  ? (pool.__queueSql ??= postgres(url, {
      prepare: false,
      max: local ? 1 : 3,
      idle_timeout: 20,
      ssl: local ? false : "require",
      onnotice: () => {},
    }))
  : null;

const memory = globalThis as unknown as { __queueState?: QueueState | null };

const memoryStore: Store = {
  kind: "memory",
  read: async () => memory.__queueState ?? null,
  async write(next, expected) {
    if ((memory.__queueState?.version ?? null) !== expected) return false;
    memory.__queueState = next;
    return true;
  },
};

const store: Store = sql
  ? { kind: "postgres", read: () => readState(sql), write: (next, expected) => writeState(sql, next, expected) }
  : memoryStore;
export const storageKind: StorageKind = store.kind;

/** The state to start from: stored (upgraded, rolled over to today), or the sample day if empty. */
function current(stored: QueueState | null, now: number): QueueState {
  return stored ? rolloverIfNewDay(upgradeState(stored, now), now) : buildSeedState(now, DEFAULT_SETTINGS, 1);
}

// ---- Failed PIN attempts, per client, expiring after `windowMs` ----

const memoryAttempts = globalThis as unknown as { __pinAttempts?: Map<string, { count: number; until: number }> };

export async function failedAttempts(client: string, now: number): Promise<number> {
  if (sql) return pgFailedAttempts(sql, client, now);
  const entry = memoryAttempts.__pinAttempts?.get(client);
  return entry && entry.until > now ? entry.count : 0;
}

export async function recordFailedAttempt(client: string, now: number, windowMs: number): Promise<number> {
  if (sql) return pgRecordFailedAttempt(sql, client, now, windowMs);
  const map = (memoryAttempts.__pinAttempts ??= new Map());
  const entry = map.get(client);
  const count = entry && entry.until > now ? entry.count + 1 : 1;
  map.set(client, { count, until: entry && entry.until > now ? entry.until : now + windowMs });
  return count;
}

export async function clearFailedAttempts(client: string): Promise<void> {
  if (sql) return pgClearFailedAttempts(sql, client);
  memoryAttempts.__pinAttempts?.delete(client);
}

/** Current state, rolled over to a fresh queue if the clinic-local date has changed. */
export async function loadState(now: number): Promise<QueueState> {
  const stored = await store.read();
  const state = current(stored, now);
  if (state !== stored) await store.write(state, stored?.version ?? null);
  return state;
}

/**
 * Read → apply → compare-and-set, retrying if another request wrote in between.
 * `apply` must be pure (it may run more than once).
 */
export async function mutate<T extends { state: QueueState }>(
  now: number,
  apply: (state: QueueState) => T,
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const stored = await store.read();
    const result = apply(current(stored, now));
    if (result.state === stored) return result;
    if (await store.write(result.state, stored?.version ?? null)) return result;
  }
  throw new Error("The queue is busy. Please try again.");
}
