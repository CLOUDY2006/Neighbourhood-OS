-- Older installs used the "neighborhood" spelling. Rename those tables, columns, constraints and indexes in place so existing data is kept.
do $$
declare t text; r record;
begin
  if to_regclass('public.neighborhoods') is not null and to_regclass('public.neighbourhoods') is null then
    alter table public.neighborhoods rename to neighbourhoods;
  end if;
  foreach t in array array['members', 'photos', 'audit_log', 'channels'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'neighborhood_id') then
      execute format('alter table public.%I rename column neighborhood_id to neighbourhood_id', t);
    end if;
  end loop;
  for r in select conrelid::regclass as tbl, conname from pg_constraint where connamespace = 'public'::regnamespace and conname like '%neighborhood%' loop
    execute format('alter table %s rename constraint %I to %I', r.tbl, r.conname, replace(r.conname, 'neighborhood', 'neighbourhood'));
  end loop;
  for r in select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'i' and relname like '%neighborhood%' loop
    execute format('alter index public.%I rename to %I', r.relname, replace(r.relname, 'neighborhood', 'neighbourhood'));
  end loop;
end $$;

create table if not exists neighbourhoods (
  id text primary key,
  kind text not null check (kind in ('cell', 'named')),
  name text not null,
  center_lat double precision not null,
  center_lng double precision not null,
  radius_m integer not null check (radius_m between 200 and 2000),
  created_by uuid,
  created_at timestamptz not null default now(),
  version integer not null default 1,
  doc jsonb not null,
  map jsonb,
  map_fetched_at timestamptz
);
create index if not exists neighbourhoods_center_idx on neighbourhoods (center_lat, center_lng);
create index if not exists neighbourhoods_name_idx on neighbourhoods (lower(name));

create table if not exists members (
  neighbourhood_id text not null references neighbourhoods(id) on delete cascade,
  user_id uuid not null,
  display_name text not null,
  role text not null default 'resident' check (role in ('resident', 'admin')),
  coordinator_requested_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (neighbourhood_id, user_id)
);
create index if not exists members_user_idx on members (user_id);

create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  neighbourhood_id text not null references neighbourhoods(id) on delete cascade,
  user_id uuid not null,
  mime text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);
create index if not exists photos_user_idx on photos (user_id);

create table if not exists audit_log (
  id bigserial primary key,
  neighbourhood_id text not null references neighbourhoods(id) on delete cascade,
  user_id uuid,
  who text not null,
  action text not null,
  detail jsonb,
  at timestamptz not null default now()
);
create index if not exists audit_neighbourhood_idx on audit_log (neighbourhood_id, at desc);

alter table neighbourhoods enable row level security;
alter table members enable row level security;
alter table photos enable row level security;
alter table audit_log enable row level security;

create table if not exists channels (
  user_id uuid not null,
  neighbourhood_id text not null references neighbourhoods(id) on delete cascade,
  kind text not null check (kind in ('push', 'email', 'sms', 'whatsapp')),
  target text not null,
  verified boolean not null default true,
  code text,
  code_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, neighbourhood_id, kind)
);
create index if not exists channels_target_idx on channels (target) where kind in ('sms', 'whatsapp');
alter table channels enable row level security;

-- A report started by WhatsApp or SMS waits here until it has both a description and a place (kept 30 minutes).
create table if not exists text_drafts (
  user_id uuid not null,
  neighbourhood_id text not null references neighbourhoods(id) on delete cascade,
  text text,
  photo uuid,
  lat double precision,
  lng double precision,
  approx boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, neighbourhood_id)
);
alter table text_drafts enable row level security;

-- Two roles only. Anyone saved as a volunteer or moderator becomes a resident.
update members set role = 'resident' where role in ('volunteer', 'moderator');
alter table members drop constraint if exists members_role_check;
alter table members add constraint members_role_check check (role in ('resident', 'admin'));

-- Neighbourhood chat. Every message belongs to exactly one neighbourhood and one room in it.
-- The server checks the sender's own membership row in that neighbourhood, so rooms never span areas.
-- `rev` changes whenever a message is added, hidden, restored or deleted, so clients can poll for changes cheaply.
create sequence if not exists chat_rev_seq;
create table if not exists chat_messages (
  id bigserial primary key,
  neighbourhood_id text not null references neighbourhoods(id) on delete cascade,
  room text not null check (room in ('all', 'volunteers', 'coordinators')), -- 'volunteers' stays allowed only so old messages remain valid; the app no longer uses that room
  user_id uuid not null,
  display_name text not null,
  body text not null check (char_length(body) <= 500),
  state text not null default 'ok' check (state in ('ok', 'hidden', 'deleted')),
  reports uuid[] not null default '{}',
  rev bigint not null default nextval('chat_rev_seq'),
  created_at timestamptz not null default now()
);
create index if not exists chat_room_idx on chat_messages (neighbourhood_id, room, id desc);
create index if not exists chat_rev_idx on chat_messages (neighbourhood_id, room, rev);
create index if not exists chat_user_idx on chat_messages (user_id);
create index if not exists chat_created_idx on chat_messages (created_at);
alter table chat_messages enable row level security;