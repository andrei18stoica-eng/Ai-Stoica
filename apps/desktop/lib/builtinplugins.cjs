// Plugins that work the moment they are added (0.7.18): public services that need no account, no key and no OAuth.
// Before, every plugin in the Director needed the user's own API, webhook or OAuth client, so none worked out of the box.
// The gateway passes `request(url)` (its safeRequest, with the same network guard as the other plugins).

// Whole words, Romanian letters included (JavaScript's \b does not see «ă», «î», «ș», «ț» as letters).
function words(alternatives) { return new RegExp(`(?:^|[^\\p{L}])(?:${alternatives})(?![\\p{L}])`, "iu"); }

const BUILTIN_PLUGINS = {
  weather: {
    name: "Vremea",
    description: "Vremea acum și prognoza pe 3 zile pentru orice oraș (Open-Meteo, fără cont).",
    trigger: "@vremea",
    url: "https://api.open-meteo.com/v1/forecast",
    keywords: words("vremea|vreme|prognoz[aă]|temperatur[aăi]|plou[aăe]|ninge|grade afar[aă]|meteo")
  },
  bnr: {
    name: "Curs BNR",
    description: "Cursul valutar oficial BNR de azi: euro, dolar, liră și celelalte (bnr.ro).",
    trigger: "@curs",
    url: "https://curs.bnr.ro/nbrfxrates.xml",
    keywords: words("curs(ul)? (valutar|bnr|euro|dolar|leu)|c[aâ]t e(ste)? (un )?(euro|dolar(ul)?|lira)|cursul bnr|eur\/ron|usd\/ron")
  },
  wikipedia: {
    name: "Wikipedia",
    description: "Caută în Wikipedia (română, apoi engleză) și aduce rezumatul articolului.",
    trigger: "@wiki",
    url: "https://ro.wikipedia.org/w/api.php",
    keywords: words("wikipedia|wiki")
  },
  time: {
    name: "Ora exactă",
    description: "Ora și data exacte în România și în marile orașe ale lumii.",
    trigger: "@ora",
    url: "builtin://ora-exacta",
    keywords: words("ce or[aă] e|c[aâ]t e ceasul|ora exact[aă]|ce dat[aă] e|ce zi e azi")
  }
};

const WEATHER_CODES = {
  0: "senin", 1: "predominant senin", 2: "parțial noros", 3: "înnorat", 45: "ceață", 48: "ceață cu chiciură",
  51: "burniță slabă", 53: "burniță", 55: "burniță puternică", 61: "ploaie slabă", 63: "ploaie", 65: "ploaie puternică",
  66: "ploaie înghețată", 67: "ploaie înghețată puternică", 71: "ninsoare slabă", 73: "ninsoare", 75: "ninsoare puternică",
  77: "grăunțe de zăpadă", 80: "averse slabe", 81: "averse", 82: "averse puternice", 85: "averse de ninsoare", 86: "averse puternice de ninsoare",
  95: "furtună", 96: "furtună cu grindină", 99: "furtună puternică cu grindină"
};

// "cum e vremea în Cluj-Napoca mâine?" → "Cluj-Napoca"; no place named → București.
function placeFrom(message) {
  const text = String(message || "").replace(/@\S+/g, " ");
  // (No \b before «în»: in JavaScript «î» is not a word character, so \b would never match there.)
  const m = text.match(/(?:^|[\s,(])(?:în|in|la|din|pentru|pt\.?)\s+([A-ZĂÂÎȘŞȚŢ][\p{L}.'-]+(?:[\s-][A-ZĂÂÎȘŞȚŢ][\p{L}.'-]+){0,3})/u);
  return (m ? m[1] : "București").trim().slice(0, 80);
}

async function weather(message, request) {
  const place = placeFrom(message);
  const geo = JSON.parse(await (await request(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=ro&format=json`)).text() || "{}");
  const loc = geo?.results?.[0];
  if (!loc) return `Vremea: nu am găsit localitatea „${place}”.`;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}`
    + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m"
    + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3";
  const w = JSON.parse(await (await request(url)).text() || "{}");
  const c = w.current || {}, d = w.daily || {};
  const days = (d.time || []).map((day, i) => `${day}: ${WEATHER_CODES[d.weather_code?.[i]] || "—"}, ${d.temperature_2m_min?.[i]}…${d.temperature_2m_max?.[i]} °C, șanse de precipitații ${d.precipitation_probability_max?.[i] ?? "?"}%`);
  return [
    `Vremea în ${loc.name}${loc.admin1 ? ", " + loc.admin1 : ""}${loc.country ? ", " + loc.country : ""} (sursa: Open-Meteo, ${c.time || "acum"}):`,
    `Acum: ${c.temperature_2m} °C (resimțit ${c.apparent_temperature} °C), ${WEATHER_CODES[c.weather_code] || "—"}, umiditate ${c.relative_humidity_2m}%, vânt ${c.wind_speed_10m} km/h.`,
    ...days
  ].join("\n");
}

// The XML moved to curs.bnr.ro (October 2026); www.bnr.ro/nbrfxrates.xml now returns the HTML home page.
async function bnr(_message, request) {
  const xml = await (await request("https://curs.bnr.ro/nbrfxrates.xml")).text();
  const date = (xml.match(/<Cube date="([^"]+)"/) || [])[1] || "";
  const rates = [...xml.matchAll(/<Rate currency="([A-Z]{3})"(?: multiplier="(\d+)")?>([\d.]+)<\/Rate>/g)]
    .map(([, cur, mult, val]) => ({ cur, mult: Number(mult || 1), val: Number(val) }));
  if (!rates.length) return "Curs BNR: răspunsul BNR nu a conținut cursuri.";
  const first = ["EUR", "USD", "GBP", "CHF", "HUF", "MDL"];
  rates.sort((a, b) => (first.indexOf(a.cur) + 1 || 99) - (first.indexOf(b.cur) + 1 || 99));
  return [`Cursul oficial BNR din ${date} (lei pentru o unitate de valută; sursa: bnr.ro):`, ...rates.map(r => `${r.mult > 1 ? r.mult + " " : "1 "}${r.cur} = ${r.val} RON`)].join("\n");
}

function wikiQuery(message) {
  return String(message || "").replace(/@\S+/g, " ").replace(/\b(caut[aă]|pe|în|in|wikipedia|wiki|despre|ce (este|e)|cine (este|e|a fost)|spune-mi|te rog)\b/gi, " ").replace(/[?!.]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

async function wikipedia(message, request) {
  const q = wikiQuery(message);
  if (!q) return "Wikipedia: scrie ce să caut, de exemplu «@wiki Mihai Eminescu».";
  for (const lang of ["ro", "en"]) {
    const s = JSON.parse(await (await request(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=1&utf8=1`)).text() || "{}");
    const title = s?.query?.search?.[0]?.title;
    if (!title) continue;
    const page = JSON.parse(await (await request(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`)).text() || "{}");
    if (page?.extract) return `Wikipedia (${lang}) — ${page.title}:\n${String(page.extract).slice(0, 3000)}\nSursa: ${page.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`}`;
  }
  return `Wikipedia: nu am găsit un articol pentru „${q}”.`;
}

function time(_message, _request, now = new Date()) {
  const zones = [["România", "Europe/Bucharest"], ["Londra", "Europe/London"], ["New York", "America/New_York"], ["Los Angeles", "America/Los_Angeles"], ["Tokyo", "Asia/Tokyo"], ["Dubai", "Asia/Dubai"]];
  const fmt = (tz) => new Intl.DateTimeFormat("ro-RO", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(now);
  return ["Ora exactă (ceasul serverului):", ...zones.map(([n, tz]) => `${n}: ${fmt(tz)}`)].join("\n");
}

const RUNNERS = { weather, bnr, wikipedia, time };

async function runBuiltinPlugin(key, message, { request } = {}) {
  const run = RUNNERS[key];
  if (!run) throw new Error("Plugin inclus necunoscut.");
  return String(await run(message, request) || "").slice(0, 12000);
}

// An installed built-in plugin also answers when the message is plainly about its subject ("cum e vremea mâine?").
function builtinKeywordMatch(key, text) {
  const p = BUILTIN_PLUGINS[key];
  return !!p && p.keywords.test(String(text || ""));
}

function publicBuiltinList(installedKeys = new Set()) {
  return Object.entries(BUILTIN_PLUGINS).map(([key, p]) => ({ key, name: p.name, description: p.description, trigger: p.trigger, installed: installedKeys.has(key) }));
}

module.exports = { BUILTIN_PLUGINS, runBuiltinPlugin, builtinKeywordMatch, publicBuiltinList, placeFrom, wikiQuery };
