-- Hygieia queue: one clinic's queue in Postgres (Supabase in production, PGlite locally).
-- The queue rules stay in lib/queue.ts; these tables store its state and keep every day's history.

-- The clinic: the version every write compare-and-sets on, today's clinic-local date, the rules
-- (grace, protection, timezone) and the last token number per prefix. No patient data, so the
-- public display may subscribe to changes of this row (see 002_supabase.sql).
create table clinic (
  id           smallint primary key default 1 check (id = 1),
  version      bigint not null,
  day          date not null,
  settings     jsonb not null,
  seq          jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

-- Services (departments). Removed ones are archived, not deleted, so past visits keep their name.
create table services (
  id               text primary key,
  name             text not null check (char_length(name) between 1 and 30),
  letter           char(1) not null check (letter ~ '^[A-Z]$'),
  default_minutes  integer not null check (default_minutes between 1 and 240),
  rooms            integer not null check (rooms between 1 and 4),
  color            text,
  position         integer not null default 0,
  archived_at      timestamptz
);
-- A token letter belongs to one active service.
create unique index services_active_letter on services (letter) where archived_at is null;

-- One row per patient per clinic day: walk-ins and appointments.
create table visits (
  day              date not null,
  id               text not null,
  -- Order in which the day's patients were added (keeps the state's order on reload).
  ord              integer not null default 0,
  token            text not null,
  name             text not null check (char_length(name) between 1 and 40),
  type             text not null check (type in ('walk_in', 'appointment')),
  service          text not null references services (id),
  status           text not null check (status in ('booked', 'waiting', 'serving', 'served', 'no_show', 'cancelled')),
  created_at       timestamptz not null,
  scheduled_at     timestamptz,
  arrived_at       timestamptz,
  checked_in       boolean not null default false,
  called_at        timestamptz,
  served_at        timestamptz,
  room             text,
  late_converted   boolean not null default false,
  priority_reason  text check (priority_reason in ('Elderly', 'Pregnant', 'Disability', 'Urgent', 'Other')),
  priority_at      timestamptz,
  hold_until       timestamptz,
  hold_for         text,
  primary key (day, id),
  check (type = 'walk_in' or scheduled_at is not null),
  -- A room sees one patient at a time. Checked at commit, so "Served & call next" can swap
  -- the two patients in one write.
  constraint visits_one_serving_per_room
    exclude using btree (day with =, room with =) where (status = 'serving') deferrable initially deferred
);
-- A token is issued once per day.
create unique index visits_day_token on visits (day, token);
create index visits_service_status on visits (day, service, status);

-- Every call: which room called whom, when, and why. The latest per room is the "last call".
create table calls (
  day          date not null,
  room         text not null,
  visit_id     text not null,
  token        text not null,
  reason       text not null,
  at           timestamptz not null,
  primary key (day, room, at),
  foreign key (day, visit_id) references visits (day, id) on delete cascade
);

-- Failed staff PIN attempts per client address, for the 5-try lock-out.
create table login_attempts (
  client   text primary key,
  count    integer not null,
  until    timestamptz not null
);
