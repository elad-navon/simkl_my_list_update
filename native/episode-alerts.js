// Episode alerts on the phone - inside the Android app only. app.js loads
// this module there (syncEpisodeAlerts) every time fresh Airing Next rows
// arrive; a browser never loads it. The rules (which episodes, when, what it
// says) are in episode-alerts-core.js; this file only talks to the plugin.
// The plugin keeps the scheduled alerts across closing the app and
// restarting the phone, so they go off even if the app isn't opened again.
import { LocalNotifications } from "./vendor/capacitor-auth.js";
import "./episode-alerts-core.js";

const core = self.EpisodeAlerts;
let setup = null;
let running = Promise.resolve();

async function prepare() {
  try {
    await LocalNotifications.createChannel({
      id: core.CHANNEL,
      name: "Premieres and finales",
      description: "The morning a season premiere, a season finale or a new series comes out",
      importance: 4,
      visibility: 1,
      vibration: true,
    });
  } catch {
    // older Android: no channels
  }
}

// Asks once, the first time there's anything to schedule; after that
// Android's own settings decide.
async function allowed() {
  let state;
  try {
    state = (await LocalNotifications.checkPermissions()).display;
  } catch {
    return false;
  }
  if (state === "prompt" || state === "prompt-with-rationale") {
    try {
      state = (await LocalNotifications.requestPermissions()).display;
    } catch {
      return false;
    }
  }
  return state === "granted";
}

async function run(rows) {
  await (setup = setup || prepare());
  const { notifications } = await LocalNotifications.getPending();
  const plan = core.planAlerts({ rows, pending: notifications || [], now: Date.now() });
  if (plan.cancel.length) {
    await LocalNotifications.cancel({ notifications: plan.cancel.map(id => ({ id })) });
  }
  if (plan.schedule.length && (await allowed())) {
    await LocalNotifications.schedule({ notifications: plan.schedule });
  }
  return { scheduled: plan.schedule.length, cancelled: plan.cancel.length };
}

// One run at a time, in order.
export function sync(rows) {
  running = running.catch(() => {}).then(() => run(rows));
  return running;
}

// For checking on a phone (from the WebView's console): what's scheduled,
// and a sample alert in a minute.
export async function pending() {
  return ((await LocalNotifications.getPending()).notifications || []).filter(n => n.extra && n.extra.kind === core.KIND);
}
export async function test() {
  await (setup = setup || prepare());
  if (!(await allowed())) return "notifications are off";
  await LocalNotifications.schedule({
    notifications: [{
      id: 1,
      title: "Slow Horses",
      body: "Season 5 premiere today · S05E01 · Apple TV+",
      channelId: core.CHANNEL,
      schedule: { at: new Date(Date.now() + 60000), allowWhileIdle: true },
      isExactNotification: false,
      extra: { kind: "test" },
    }],
  });
  return "in about a minute";
}
