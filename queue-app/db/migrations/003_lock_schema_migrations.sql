-- The migration log (created by db/migrate.mjs) is server-only too: without row-level security,
-- Supabase would expose it to the browser's key.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    alter table schema_migrations enable row level security;
  end if;
end
$$;
