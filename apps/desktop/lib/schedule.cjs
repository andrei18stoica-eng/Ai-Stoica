// Automation schedules: validation and next-run computation in the user's time zone.
const FREQUENCIES = ["once", "hourly", "interval", "daily", "weekly", "selected_days", "monthly"];
const TIMING_MODES = ["exact_schedule", "condition_watch"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formatters = new Map();

function validTimeZone(tz) {
  const value = String(tz || "").trim();
  if (!value || value.length > 64) return "";
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return value; } catch { return ""; }
}
function partsIn(ts, tz) {
  const key = tz || "";
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" });
    formatters.set(key, f);
  }
  const o = {};
  for (const p of f.formatToParts(new Date(ts))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, wd: WEEKDAYS.indexOf(o.weekday) };
}
function offsetAt(ts, tz) {
  const p = partsIn(ts, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ts / 1000) * 1000;
}
function zonedToUtc(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetAt(guess, tz);
  return guess - offsetAt(first, tz);
}
function parseTime(value) {
  const m = String(value ?? "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}
function toBool(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return null;
}
function toTimestamp(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : /^\d+$/.test(String(value).trim()) ? Number(value) : Date.parse(String(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function intIn(value, min, max) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function nextRun(a, from = Date.now()) {
  const freq = a.frequency || "daily";
  if (freq === "once") return Number(a.runAt || 0) || null;
  if (freq === "hourly") return from + 3600000;
  if (freq === "interval") return from + (intIn(Number(a.intervalHours), 1, 168) || 1) * 3600000;
  const tz = validTimeZone(a.timeZone);
  const [hh, mm] = parseTime(a.time) || [9, 0];
  const p = partsIn(from, tz);
  if (freq === "monthly") {
    const md = intIn(Number(a.monthday), 1, 28) || 1;
    for (let k = 0; k < 3; k++) {
      const dt = new Date(Date.UTC(p.y, p.m - 1 + k, md));
      const ts = zonedToUtc(dt.getUTCFullYear(), dt.getUTCMonth() + 1, md, hh, mm, tz);
      if (ts > from) return ts;
    }
    return null;
  }
  const weekday = intIn(Number(a.weekday), 0, 6);
  const days = Array.isArray(a.days) ? a.days.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6) : [];
  if (freq === "weekly" && weekday === null) return null;
  if (freq === "selected_days" && !days.length) return null;
  for (let k = 0; k <= 8; k++) {
    const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + k));
    const wd = dt.getUTCDay();
    if (freq === "weekly" && wd !== weekday) continue;
    if (freq === "selected_days" && !days.includes(wd)) continue;
    const ts = zonedToUtc(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), hh, mm, tz);
    if (ts > from) return ts;
  }
  return null;
}

// Validates a create (prev = null) or update (prev = stored item) request. Returns {error} or {value}.
function validateAutomation(body = {}, prev = null, now = Date.now()) {
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const pick = (k, def) => (has(k) ? body[k] : prev ? prev[k] : def);
  const out = {};
  const title = String(pick("title", "") ?? "").trim();
  if (!title) return { error: "Titlul automatizării este obligatoriu." };
  if (title.length > 120) return { error: "Titlul automatizării poate avea cel mult 120 de caractere." };
  const prompt = String(pick("prompt", "") ?? "").trim();
  if (!prompt) return { error: "Instrucțiunea automatizării este obligatorie." };
  if (prompt.length > 8000) return { error: "Instrucțiunea automatizării poate avea cel mult 8000 de caractere." };
  const frequency = String(pick("frequency", "daily") || "daily");
  if (!FREQUENCIES.includes(frequency)) return { error: "Frecvența automatizării nu este validă." };
  const time = String(pick("time", "09:00") ?? "09:00");
  if (!parseTime(time)) return { error: "Ora trebuie să fie în formatul HH:MM (00:00–23:59)." };
  const weekday = intIn(pick("weekday", 1), 0, 6);
  if (weekday === null) return { error: "Ziua săptămânii trebuie să fie un număr între 0 și 6." };
  const rawDays = pick("days", []);
  const daysList = Array.isArray(rawDays) ? rawDays.map((x) => intIn(x, 0, 6)) : null;
  if (!daysList || daysList.some((x) => x === null)) return { error: "Zilele selectate trebuie să fie numere între 0 și 6." };
  const days = [...new Set(daysList)].sort();
  if (frequency === "selected_days" && !days.length) return { error: "Alege cel puțin o zi pentru automatizare." };
  const monthday = intIn(pick("monthday", 1), 1, 28);
  if (monthday === null) return { error: "Ziua din lună trebuie să fie între 1 și 28." };
  const intervalHours = intIn(pick("intervalHours", 1), 1, 168);
  if (intervalHours === null) return { error: "Intervalul trebuie să fie între 1 și 168 de ore." };
  const enabled = toBool(has("enabled") ? body.enabled : undefined, prev ? prev.enabled !== false : true);
  if (enabled === null) return { error: "Câmpul „enabled” trebuie să fie true sau false." };
  const notify = toBool(has("notify") ? body.notify : undefined, prev ? prev.notify !== false : true);
  if (notify === null) return { error: "Câmpul „notify” trebuie să fie true sau false." };
  const rawRunAt = pick("runAt", null);
  const runAt = toTimestamp(rawRunAt);
  if (rawRunAt != null && rawRunAt !== "" && runAt === null) return { error: "Data programată nu este validă." };
  if (frequency === "once" && enabled) {
    if (!runAt) return { error: "Alege data și ora pentru automatizarea unică." };
    if (runAt <= now) return { error: "Data programată a trecut. Alege o dată și o oră viitoare." };
  }
  let timingMode = String(pick("timingMode", "exact_schedule") || "exact_schedule");
  if (timingMode === "flexible_schedule") timingMode = "exact_schedule";
  if (!TIMING_MODES.includes(timingMode)) return { error: "Modul de rulare nu este valid." };
  const trigger = String(pick("trigger", "") ?? "").trim().slice(0, 60);
  const timeZone = has("timeZone") ? validTimeZone(body.timeZone) || (prev && prev.timeZone) || "" : (prev && prev.timeZone) || "";
  Object.assign(out, { title, prompt, frequency, time, weekday, days, monthday, intervalHours, enabled, notify, runAt: runAt || null, timingMode, trigger, timeZone });
  return { value: out };
}

module.exports = { FREQUENCIES, nextRun, validateAutomation, validTimeZone, parseTime, toBool, partsIn, zonedToUtc };
