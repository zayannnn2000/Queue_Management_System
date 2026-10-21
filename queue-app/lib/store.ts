// Persistence for the single shared queue state.
// Upstash Redis when its env vars are set (Vercel Marketplace), otherwise process memory (local dev).
// Writes are compare-and-set on `version`, so concurrent staff actions never overwrite each other.

import "server-only";
import { Redis } from "@upstash/redis";
import { type QueueState, createState, rolloverIfNewDay, upgradeState } from "./queue";

export type StorageKind = "redis" | "memory";

const STATE_KEY = "queue:state";
const VERSION_KEY = "queue:version";

// KEYS[1]=state, KEYS[2]=version; ARGV[1]=expected version ("-1" if none), ARGV[2]=state JSON, ARGV[3]=new version
const CAS_SCRIPT = `
local current = redis.call('GET', KEYS[2])
if (current or '-1') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], ARGV[3])
return 1
`;

interface Store {
  kind: StorageKind;
  read(): Promise<QueueState | null>;
  /** Writes `next` only if the stored version is still `expected` (null = nothing stored). */
  write(next: QueueState, expected: number | null): Promise<boolean>;
}

function redisStore(redis: Redis): Store {
  return {
    kind: "redis",
    read: () => redis.get<QueueState>(STATE_KEY),
    async write(next, expected) {
      const ok = await redis.eval(
        CAS_SCRIPT,
        [STATE_KEY, VERSION_KEY],
        [String(expected ?? -1), JSON.stringify(next), String(next.version)],
      );
      return ok === 1;
    },
  };
}

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

const redisUrl = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

const store = redis ? redisStore(redis) : memoryStore;
export const storageKind: StorageKind = store.kind;

// ---- Failed PIN attempts, per client, expiring after `windowMs` ----

const memoryAttempts = globalThis as unknown as { __pinAttempts?: Map<string, { count: number; until: number }> };

export async function failedAttempts(client: string, now: number): Promise<number> {
  const key = `queue:pin-fail:${client}`;
  if (redis) return (await redis.get<number>(key)) ?? 0;
  const entry = memoryAttempts.__pinAttempts?.get(key);
  return entry && entry.until > now ? entry.count : 0;
}

export async function recordFailedAttempt(client: string, now: number, windowMs: number): Promise<number> {
  const key = `queue:pin-fail:${client}`;
  if (redis) {
    const count = await redis.incr(key);
    if (count === 1) await redis.pexpire(key, windowMs);
    return count;
  }
  const map = (memoryAttempts.__pinAttempts ??= new Map());
  const entry = map.get(key);
  const count = entry && entry.until > now ? entry.count + 1 : 1;
  map.set(key, { count, until: entry && entry.until > now ? entry.until : now + windowMs });
  return count;
}

export async function clearFailedAttempts(client: string): Promise<void> {
  const key = `queue:pin-fail:${client}`;
  if (redis) await redis.del(key);
  else memoryAttempts.__pinAttempts?.delete(key);
}

/** Current state, rolled over to a fresh queue if the clinic-local date has changed. */
export async function loadState(now: number): Promise<QueueState> {
  const stored = await store.read();
  const state = stored ? rolloverIfNewDay(upgradeState(stored, now), now) : createState(now);
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
    const current = stored ? rolloverIfNewDay(upgradeState(stored, now), now) : createState(now);
    const result = apply(current);
    if (result.state === stored) return result;
    if (await store.write(result.state, stored?.version ?? null)) return result;
  }
  throw new Error("The queue is busy. Please try again.");
}
