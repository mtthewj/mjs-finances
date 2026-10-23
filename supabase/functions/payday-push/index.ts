// MJ's Finances push notifications (Supabase Edge Function "payday-push").
//
// Two ways in:
// - The Thursday cron job (no body). At 11pm Pacific on the night before a payday, it sends each
//   person one "payday tonight" alert. Any other time it does nothing, and push_log makes sure
//   the same payday is never sent twice.
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
  if (now.weekday !== "Thu" || now.hour !== 23) return json({ skipped: "Only runs Thursdays at 11pm Pacific." });
  const payday = addDays(now.day, 1);
  let sent = 0;
  for (const userId of await paidOn(payday)) {
    const { error } = await admin.from("push_log").insert({ user_id: userId, kind: "payday", day: payday });
    if (error) continue; // already sent for this payday
    sent += await sendTo(userId, {
      title: "Payday tonight",
      body: "Your paycheck should be landing about now. Once it's in, log it, then make the card payment and savings transfer.",
      tag: "payday-" + payday,
    });
  }
  return json({ payday, sent });
});
