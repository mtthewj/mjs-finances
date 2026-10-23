// MJ's Finances push notifications and reminders (Supabase Edge Function "payday-push").
//
// Two ways in:
// - The hourly cron job (no body). It sends whatever is due this hour in Pacific time, based on each
//   person's alert settings (the "reminders" docs the app saves):
//     payday  Thursday 11pm before each payday (on unless turned off)
//     food    weekly, on the chosen day and hour
//     gas     weekly, on the chosen day and hour
//     c-...   custom: every N days, weeks or months from a start date, at the chosen hour
//   push_log makes sure nothing is sent twice for the same day.
// - The app's "Send a test" button ({"test":true} plus the person's login). It sends a test to
//   that person's devices only.
//
// Needs one secret, VAPID_PRIVATE_KEY, set under Edge Functions > Secrets.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = "BMQBKLRuxoTY1Lu62FdZMNhntUjcqWGn8YnDinWEJhhb1R4YbFQS_7zDBLGNGTt15w9dRon20IXNhEvhKVzUDEQ";
const SITE = "https://mtthewj.github.io/mjs-finances/";

const secretKey = (() => {
  try { const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); if (keys.default) return keys.default; } catch { /* fall back */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
})();
const admin = createClient(Deno.env.get("SUPABASE_URL"), secretKey, { auth: { persistSession: false } });
webpush.setVapidDetails(SITE, VAPID_PUBLIC_KEY, Deno.env.get("VAPID_PRIVATE_KEY"));

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Today's date, hour and weekday in Pacific time, plus date math on "YYYY-MM-DD" strings.
function pacific(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(now).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: p.weekday };
}
const addDays = (day, n) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);

// Custom reminders repeat every N days, weeks or months from their start date.
function isDue(r, day) {
  const every = Math.max(1, Number(r.every) || 1), diff = daysBetween(r.start, day);
  if (!r.start || diff < 0) return false;
  if (r.unit === "day") return diff % every === 0;
  if (r.unit === "week") return diff % (7 * every) === 0;
  const [sy, sm, sd] = r.start.split("-").map(Number), [y, m, d] = day.split("-").map(Number);
  const months = (y - sy) * 12 + (m - sm), lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return months % every === 0 && d === Math.min(sd, lastDay); // the 31st falls back to the month's last day
}

async function sendTo(userId, payload) {
  const { data: subs } = await admin.from("push_subscriptions").select("endpoint,subscription").eq("user_id", userId);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(s.subscription, JSON.stringify(payload), { TTL: 6 * 3600, urgency: "high" });
      sent++;
    } catch (e) {
      // The phone dropped this subscription (app deleted, notifications turned off): forget it.
      if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", s.endpoint);
      else console.error("push failed", e?.statusCode, e?.body ?? e?.message);
    }
  }
  return sent;
}

// Who gets paid tomorrow: anyone whose 14-day payday cycle lands on it, or who has a paycheck scheduled for it.
async function paidOn(day) {
  const users = new Set();
  const { data: settings } = await admin.from("docs").select("user_id,data").eq("collection", "settings").eq("id", "main");
  for (const s of settings ?? []) {
    const first = s.data?.firstPayday;
    if (first && daysBetween(first, day) >= 0 && daysBetween(first, day) % 14 === 0) users.add(s.user_id);
  }
  const { data: checks } = await admin.from("docs").select("user_id").eq("collection", "schedule").eq("data->>cat", "income").eq("data->>date", day);
  for (const c of checks ?? []) users.add(c.user_id);
  return users;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({}));

  if (body.test) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data } = await admin.auth.getUser(token);
    if (!data?.user) return json({ error: "Sign in first." }, 401);
    const sent = await sendTo(data.user.id, { title: "MJ's Finances", body: "Test alert. Payday reminders will show up just like this.", tag: "test" });
    return json({ sent });
  }

  const now = pacific();
  const { data: subs } = await admin.from("push_subscriptions").select("user_id");
  const people = [...new Set((subs ?? []).map((s) => s.user_id))];
  let sent = 0;
  const once = async (userId, kind, day, payload) => {
    const { error } = await admin.from("push_log").insert({ user_id: userId, kind, day });
    if (!error) sent += await sendTo(userId, payload); // an error means it already went out
  };

  const payday = addDays(now.day, 1);
  const paidTomorrow = now.weekday === "Thu" && now.hour === 23 ? await paidOn(payday) : new Set();
  for (const userId of people) {
    const { data: rows } = await admin.from("docs").select("id,data").eq("user_id", userId).eq("collection", "reminders");
    const rem = Object.fromEntries((rows ?? []).map((r) => [r.id, r.data]));
    if (paidTomorrow.has(userId) && rem.payday?.enabled !== false) {
      await once(userId, "payday", payday, { title: "Payday tonight", body: "Your paycheck should be landing about now. Once it's in, log it, then make the card payment and savings transfer.", tag: "payday-" + payday });
    }
    for (const [id, r] of Object.entries(rem)) {
      if (!r?.enabled || Number(r.hour) !== now.hour) continue;
      if (id === "food" && r.day === now.weekday) await once(userId, "food", now.day, { title: "Food check-in", body: "Log anything you've spent on food this week.", tag: "food" });
      else if (id === "gas" && r.day === now.weekday) await once(userId, "gas", now.day, { title: "Gas check-in", body: "Log any gas you've bought.", tag: "gas" });
      else if (r.kind === "custom" && isDue(r, now.day)) await once(userId, id, now.day, { title: "Reminder", body: String(r.text || "").slice(0, 120), tag: id });
    }
  }
  return json({ hour: now.hour, sent });
});
