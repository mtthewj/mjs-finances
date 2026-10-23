-- Switch the alert job to hourly so weekly and custom reminders can go out. Safe to run more than once.
select cron.schedule(
  'mjs-finances-payday-push',
  '7 * * * *',
  $$ select net.http_post(
       url := 'https://htmhaucwkxphpswmpyxb.supabase.co/functions/v1/payday-push',
       body := '{}'::jsonb,
       headers := '{"Content-Type": "application/json"}'::jsonb
     ) $$
);
