-- MJ's Finances: one table holds every record, and row-level security
-- makes sure each login can only see and change its own rows.
create table if not exists public.docs (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  collection text        not null,
  id         text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, collection, id)
);

alter table public.docs enable row level security;

create policy "read own rows"   on public.docs for select using (auth.uid() = user_id);
create policy "add own rows"    on public.docs for insert with check (auth.uid() = user_id);
create policy "change own rows" on public.docs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own rows" on public.docs for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.docs to authenticated;
