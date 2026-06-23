-- Save Food schema: a grocery list and a pantry, each row owned by one user.
-- Row-level security ensures a user can only ever read or write their own rows.
-- No sharing yet (Phase C); ownership is a single user_id column.

-- user_id defaults to auth.uid() so the client never has to send it; the RLS
-- "with check" below still guarantees it can only ever be the caller's own id.
create table if not exists list_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name       text not null,
  quantity   text,
  category   text not null,
  created_at timestamptz not null default now()
);

create table if not exists pantry_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name       text not null,
  quantity   text,
  category   text not null,
  added_at   date not null,
  expires_at date,
  created_at timestamptz not null default now()
);

-- One row per receipt scan, used by the Edge Function to enforce a per-user
-- daily cap on top of the workspace-level monthly spend limit.
create table if not exists scan_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists list_items_user_idx   on list_items (user_id);
create index if not exists pantry_items_user_idx on pantry_items (user_id);
create index if not exists scan_events_user_idx  on scan_events (user_id, created_at);

alter table list_items   enable row level security;
alter table pantry_items enable row level security;
alter table scan_events  enable row level security;

-- "Own rows only" policies. Repeated per table because Postgres policies are
-- per-table; the predicate is identical.
create policy "own list_items"   on list_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own pantry_items" on pantry_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own scan_events"  on scan_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
