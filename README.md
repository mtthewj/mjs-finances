# MJ's Finances

a site to help menwoth my personal financing and daily purchasing and spending decisions.

It's a budget tracker that installs to the phone's home screen and syncs through Supabase.

- `index.html` — the whole app (layout, budgets, schedule, sync)
- `sw.js` — offline support; bump `VERSION` after changing files so phones pick up updates
- `supabase-setup.sql` — creates the `docs` table with row-level security (run once in the Supabase SQL editor)
- `supabase-2.117.2.js` — the Supabase client library, vendored so the app works offline

The Supabase URL and publishable key in `index.html` are meant to be public. Row-level security limits every row to the signed-in user. No financial data lives in this repo.
