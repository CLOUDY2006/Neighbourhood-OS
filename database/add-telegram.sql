-- Run once in the Supabase SQL editor (the server also does this itself at startup).
create table if not exists text_drafts (
  user_id uuid not null,
  neighbourhood_id text not null references neighbourhoods(id) on delete cascade,
  text text, photo uuid, lat double precision, lng double precision,
  approx boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, neighbourhood_id)
);
alter table text_drafts enable row level security;
alter table channels drop constraint if exists channels_kind_check;
alter table channels add constraint channels_kind_check check (kind in ('push', 'email', 'sms', 'whatsapp', 'telegram'));
create index if not exists channels_tg_idx on channels (target) where kind = 'telegram';