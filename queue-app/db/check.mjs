// Prints how the database is set up: tables with row-level security, the browser's read policies,
// and which tables Supabase Realtime publishes. Fails (exit 1) if a table is left open to the
// browser's key. Runs after migrations on every Vercel deploy. Usage: node db/check.mjs
import { pathToFileURL } from "node:url";
import { connect, skipWithoutDatabase } from "./migrate.mjs";

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (skipWithoutDatabase()) process.exit(0);
  const sql = await connect();
  if (!sql) process.exit(1);
  try {
    const supabase = (await sql`select 1 from pg_roles where rolname = 'anon'`).length > 0;
    const tables = await sql`
      select c.relname as table, c.relrowsecurity as rls,
        (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by 1`;
    console.table(tables);
    console.table(await sql`select tablename, policyname, roles::text, cmd from pg_policies where schemaname = 'public'`);
    console.log("Realtime publishes:", (await sql`
      select tablename from pg_publication_tables where pubname = 'supabase_realtime'`).map((r) => r.tablename));
    const open = tables.filter((t) => !t.rls);
    if (supabase && open.length > 0) {
      console.error(`Row-level security is off for: ${open.map((t) => t.table).join(", ")}`);
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}
