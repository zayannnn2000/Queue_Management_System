-- Supabase only (skipped where the roles don't exist, e.g. PGlite in local tests).
-- Row-level security on every table: the server reaches the data with its own database login;
-- the browser's anon key may read only the clinic row (version, day, rules: no patient data), and
-- only to be told in real time that something changed. It then refetches through the staff API
-- (behind the PIN) or the public API (tokens and initials only).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    alter table clinic enable row level security;
    alter table services enable row level security;
    alter table visits enable row level security;
    alter table calls enable row level security;
    alter table login_attempts enable row level security;

    drop policy if exists "clinic version is public" on clinic;
    create policy "clinic version is public" on clinic for select to anon, authenticated using (true);
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'clinic'
     ) then
    alter publication supabase_realtime add table clinic;
  end if;
end
$$;
