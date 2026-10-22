// Applies db/migrations/*.sql in order, once each (tracked in schema_migrations).
// Usage: node db/migrate.mjs
// Runs on every Vercel deploy before the build (`vercel-build`), so the database never falls
// behind the code; if it fails, the build fails and the current deployment stays live.
// Uses POSTGRES_URL_NON_POOLING, falling back to POSTGRES_URL / DATABASE_URL if that can't connect.
// The app seeds the fictional sample day itself on its first request to an empty database.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

/** @param {import("postgres").Sql} sql @returns {Promise<string[]>} the files applied now */
export async function migrate(sql) {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
  const applied = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(name)) continue;
    const text = readFileSync(path.join(dir, name), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into schema_migrations (name) values (${name})`;
    });
    applied.push(name);
  }
  return applied;
}

/** A connected client: the direct URL if it answers, else the pooled one. */
export async function connect() {
  const urls = [process.env.POSTGRES_URL_NON_POOLING, process.env.POSTGRES_URL, process.env.DATABASE_URL].filter(Boolean);
  for (const url of urls) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 10, ssl: local ? false : "require", onnotice: () => {} });
    try {
      await sql`select 1`;
      return sql;
    } catch (err) {
      console.warn(`Couldn't connect with one database URL (${err.code ?? err.message}); trying the next.`);
      await sql.end({ timeout: 1 });
    }
  }
  return null;
}

/** No database configured at all: fine for a preview or local build (the app uses memory), not for production. */
export function skipWithoutDatabase() {
  if (process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL) return false;
  if (process.env.VERCEL_ENV === "production") return false;
  console.warn("No database configured for this build; skipping (the app will keep its queue in memory).");
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (skipWithoutDatabase()) process.exit(0);
  const sql = await connect();
  if (!sql) {
    console.error("No database reachable. Set POSTGRES_URL (Vercel's Supabase integration does), or DATABASE_URL locally.");
    process.exit(1);
  }
  try {
    const applied = await migrate(sql);
    console.log(applied.length ? `Applied ${applied.join(", ")}` : "Database is up to date.");
  } finally {
    await sql.end();
  }
}
