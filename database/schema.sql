create table if not exists neighborhoods (
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
create index if not exists neighborhoods_center_idx on neighborhoods (center_lat, center_lng);
create index if not exists neighborhoods_name_idx on neighborhoods (lower(name));

create table if not exists members (
  neighborhood_id text not null references neighborhoods(id) on delete cascade,
  user_id uuid not null,
  display_name text not null,
  role text not null default 'resident' check (role in ('resident', 'volunteer', 'moderator', 'admin')),
  coordinator_requested_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (neighborhood_id, user_id)
);
create index if not exists members_user_idx on members (user_id);

create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  neighborhood_id text not null references neighborhoods(id) on delete cascade,
  user_id uuid not null,
  mime text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);
create index if not exists photos_user_idx on photos (user_id);

create table if not exists audit_log (
  id bigserial primary key,
  neighborhood_id text not null references neighborhoods(id) on delete cascade,
  user_id uuid,
  who text not null,
  action text not null,
  detail jsonb,
  at timestamptz not null default now()
);
create index if not exists audit_neighborhood_idx on audit_log (neighborhood_id, at desc);

alter table neighborhoods enable row level security;
alter table members enable row level security;
alter table photos enable row level security;
alter table audit_log enable row level security;

create table if not exists channels (
  user_id uuid not null,
  neighborhood_id text not null references neighborhoods(id) on delete cascade,
  kind text not null check (kind in ('push', 'email', 'sms', 'whatsapp')),
  target text not null,
  verified boolean not null default true,
  code text,
  code_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, neighborhood_id, kind)
);
create index if not exists channels_target_idx on channels (target) where kind in ('sms', 'whatsapp');
alter table channels enable row level security;

alter table members drop constraint if exists members_role_check;
alter table members add constraint members_role_check check (role in ('resident', 'volunteer', 'moderator', 'admin'));
