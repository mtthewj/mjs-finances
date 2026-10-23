-- Push notifications for MJ's Finances. Paste into Supabase > SQL Editor and run once.

-- 1. Each phone or browser that turns on alerts. Only you can see or change your own.
create table if not exists public.push_subscriptions (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "read own subscriptions" on public.push_subscriptions;
drop policy if exists "add own subscriptions" on public.push_subscriptions;
drop policy if exists "change own subscriptions" on public.push_subscriptions;
drop policy if exists "remove own subscriptions" on public.push_subscriptions;
create policy "read own subscriptions" on public.push_subscriptions for select using (auth.uid() = user_id);
create policy "add own subscriptions" on public.push_subscriptions for insert with check (auth.uid() = user_id);
create policy "change own subscriptions" on public.push_subscriptions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "remove own subscriptions" on public.push_subscriptions for delete using (auth.uid() = user_id);
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- 2. A note of each alert sent, so the same payday is never sent twice. Only the server touches it.
create table if not exists public.push_log (
  user_id uuid not null references auth.users on delete cascade,
  kind text not null,
  day date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, day)
);
alter table public.push_log enable row level security;

-- 3. Every hour at :07, ask the payday-push function to send whatever alerts are due
--    (payday, weekly food and gas, custom reminders). The function works in Pacific time.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;
select cron.schedule(
  'mjs-finances-payday-push',
  '7 * * * *',
  $$ select net.http_post(
       url := 'https://htmhaucwkxphpswmpyxb.supabase.co/functions/v1/payday-push',
       body := '{}'::jsonb,
       headers := '{"Content-Type": "application/json"}'::jsonb
     ) $$
);
