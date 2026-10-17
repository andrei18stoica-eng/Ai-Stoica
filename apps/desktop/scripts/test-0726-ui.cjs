// 0.7.26, the new interface: English by default with 24 languages (Romanian, Spanish, French and German carried with
// the app, the rest translated once on the server with the AI), a dark premium theme with blue accents and an optional
// light one, and the shell of the approved mockup. Examples on screen use no names, places or addresses.
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const SRC = path.join(__dirname, "..", "renderer", "src");
const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8");
const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();

function locales() {
  const js = read("locales.js");
  const L = JSON.parse(js.slice(js.indexOf("export const LOCALES = ") + 23).trim().replace(/;$/, ""));
  expect(Object.keys(L).join() === "ro,es,fr,de", "the four languages carried with the app: " + Object.keys(L).join());
  const keys = Object.keys(L.ro);
  expect(keys.length >= 180, "the shell's texts are translated: " + keys.length);
  for (const lang of ["es", "fr", "de"]) expect(Object.keys(L[lang]).sort().join("\n") === [...keys].sort().join("\n"), `${lang} has the same texts as ro`);
  for (const lang of Object.keys(L)) for (const k of keys) {
    const v = L[lang][k];
    expect(typeof v === "string" && v.trim(), `${lang}: «${k}» translated`);
    expect(placeholders(v) === placeholders(k), `${lang}: «${k}» keeps its {placeholders}`);
    expect(!/[<>]/.test(v), `${lang}: «${k}» has no markup`);
  }
  // Every fixed text the shell passes to tr() has its four translations.
  for (const f of ["main.jsx", "install.jsx"]) {
    const src = read(f);
    for (const m of src.matchAll(/\btr\("((?:[^"\\]|\\.)+)"/g)) expect(L.ro[m[1]] !== undefined, `${f}: «${m[1]}» is in locales.js`);
  }
  for (const [, label] of read("main.jsx").matchAll(/\[\w+,\w+,"([^"]+)",(?:null|"\w+")\]/g)) expect(L.ro[label], `side menu «${label}» translated`);
  for (const part of ["Good morning", "Good afternoon", "Good evening"]) expect(L.ro[part] && L.ro[part + ", {name}"], `greeting «${part}»`);
}

function languages() {
  const i18n = read("i18n.jsx");
  const codes = [...i18n.matchAll(/\["([a-z]{2})", "[^"]+"\]/g)].map((m) => m[1]);
  expect(codes.length === 24 && codes[0] === "en", "24 languages, English first: " + codes.join());
  expect(/const RTL = new Set\(\["ar"\]\)/.test(i18n) && /documentElement\.dir/.test(i18n), "Arabic turns the page right-to-left");
  expect(/localStorage\.getItem\(KEY\); return known\(v\) \? v : "en"/.test(i18n), "English when nothing was chosen");
  expect(/\/api\/i18n\/\$\{lang\}/.test(i18n) && /tried\.has\(/.test(i18n) && /storage\.get\(TOKEN_KEY\)/.test(i18n), "missing texts go to the server once, signed in only");
  const gw = fs.readFileSync(path.join(__dirname, "..", "local-gateway.cjs"), "utf8");
  const names = gw.match(/const I18N_NAMES=\{([^}]+)\}/)[1];
  const serverCodes = [...names.matchAll(/(\w{2}):"/g)].map((m) => m[1]);
  expect(serverCodes.join() === codes.slice(1).join(), "the server knows every language but English: " + serverCodes.join());
}

function theme() {
  const t = read("theme.js"), css = read("styles.css");
  expect(/return CHOICES\.includes\(v\) \? v : "dark"/.test(t), "dark by default");
  expect(/dataset\.theme = t/.test(t), "the theme is set on <html>");
  const dark = css.match(/:root,:root\[data-theme="dark"\]\{([^}]+)\}/), light = css.match(/:root\[data-theme="light"\]\{([^}]+)\}/);
  expect(dark && light, "dark and light token sets");
  for (const v of ["--bg", "--panel", "--surface", "--line", "--text", "--muted", "--accent", "--accent-strong", "--danger", "--success"]) {
    expect(dark[1].includes(v + ":") && light[1].includes(v + ":"), `both themes define ${v}`);
  }
  expect(/--accent:#5B9BFF/.test(dark[1]) && /--bg:#060A11/.test(dark[1]), "dark premium, blue accents");
  for (const c of [".themeSwitch", ".langMenu", ".langGrid", ".welcomeStarts", ".sideUsage", ".wordmark em"]) expect(css.includes(c), `styles for ${c}`);
  expect(/@fontsource-variable\/manrope/.test(read("main.jsx")) && /@fontsource-variable\/dm-sans/.test(read("main.jsx")), "the mockup's fonts travel with the app (no Google Fonts request)");
  const html = fs.readFileSync(path.join(SRC, "..", "index.html"), "utf8");
  expect(/<html lang="en">/.test(html) && /content="dark light"/.test(html) && !/Asistentul tău AI/.test(html), "the page head is English and allows both themes");
}

function noPersonalExamples() {
  for (const f of ["main.jsx", "install.jsx", "locales.js", "i18n.jsx", "pages/AccountSettings.jsx"]) {
    const s = read(f);
    expect(!/webserano/i.test(s), `${f}: nothing about Webserano`);
    expect(!/\bAndrei\b|Brutăria|@brutaria|\bex\. [A-Z][a-z]+"/.test(s), `${f}: no personal names in examples`);
  }
  const starts = read("main.jsx").match(/const WELCOME_STARTS=\[([\s\S]*?)\];/)[1];
  expect(!/@|https?:|str\.|street/i.test(starts), "the start suggestions name no address or place");
}

function extraCredits() {
  const ui = read("pages/Usage.jsx");
  expect(/function ExtraCreditsCard/.test(ui) && /<ExtraCreditsCard min=\{cat\.minPack\} \/><\/div>/.test(ui), "an Extra credits card in the plans grid, after the plans");
  expect(/type="number"[^>]*min=\{min\}/.test(ui) && /\/api\/credits\/price\?credits=\$\{credits\}/.test(ui), "the person types the number of credits and the price follows it");
  expect(/PACK_PRESETS = \[500, 1000, 2500, 5000, 10000\]/.test(ui) && !/function PackCalculator/.test(ui), "quick amounts; the old separate calculator is gone");
  const C = require("../lib/credits.cjs");
  for (const n of [100, 1000, 3750, 10000, 123456]) { const p = C.priceForCredits(n); expect(p && Math.round(p * 100) % 100 === 99, `${n} credits cost x,99 lei: ${p}`); }
  for (let n = 100; n < 20000; n += 100) expect(C.priceForCredits(n + 100) >= C.priceForCredits(n), "more credits never cost less: " + n);
  expect(C.priceForCredits(99) === null, "below the minimum there is no price");
}

async function gateway() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui26-"));
  let calls = 0;
  const omni = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "Ai principal", owned_by: "combo" }] }));
      calls++;
      const keys = JSON.parse(JSON.parse(b).messages.at(-1).content);
      const out = Object.fromEntries(keys.map((k) => [k, k === "Bad {n}" ? "Rău" : "IT:" + k]));
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Here:\n" + JSON.stringify(out) } }] }));
    });
  });
  const omniPort = await listen(omni);
  const cfg = { baseUrl: `http://127.0.0.1:${omniPort}/v1`, apiKey: "k", model: "Ai principal", webSearchEnabled: false, githubAutoContext: false, directChatEnabled: false, ownerEmail: "owner@example.com", creditsEnabled: true, pollinationsFreeEnabled: false };
  const gw = require("../local-gateway.cjs").startLocalGateway({ dataDir: dir, port: 8871, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8871";
  const call = async (p, { method = "GET", body, token } = {}) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, j }; };
  try {
    await call("/auth/register", { method: "POST", body: { email: "owner@example.com", password: "password123", name: "Owner" } });
    const user = (await call("/auth/register", { method: "POST", body: { email: "user@example.com", password: "password123", name: "User" } })).j.token;
    let r = await call("/api/i18n/it");
    expect(r.status === 200 && JSON.stringify(r.j.data) === "{}", "reading is open and starts empty: " + JSON.stringify(r));
    expect((await call("/api/i18n/xx")).status === 404 && (await call("/api/i18n/en")).status === 404, "unknown languages are refused");
    expect((await call("/api/i18n/it", { method: "POST", body: { keys: ["New chat"] } })).status === 401, "translating needs an account");
    r = await call("/api/i18n/it", { method: "POST", token: user, body: { keys: ["New chat", "Good evening, {name}", "Bad {n}", "<b>x</b>", 5] } });
    expect(r.status === 200 && r.j.data["New chat"] === "IT:New chat" && r.j.data["Good evening, {name}"] === "IT:Good evening, {name}", "translated and kept: " + JSON.stringify(r.j));
    expect(!("Bad {n}" in r.j.data) && !("<b>x</b>" in r.j.data), "a translation that loses a {placeholder}, and markup, are not kept");
    expect(JSON.parse(fs.readFileSync(path.join(dir, "i18n", "it.json"), "utf8"))["New chat"] === "IT:New chat", "kept on the server for every account");
    const before = calls;
    r = await call("/api/i18n/it", { method: "POST", token: user, body: { keys: ["New chat"] } });
    expect(r.status === 200 && calls === before, "a text already translated is not asked again");
    expect((await call("/api/i18n/it")).j.data["New chat"] === "IT:New chat", "and is read by everyone");
    // A few times an hour per account (the first request counted already).
    let last;
    for (let i = 0; i < 6; i++) last = await call("/api/i18n/it", { method: "POST", token: user, body: { keys: ["Text " + i] } });
    expect(last.status === 429 && /Too many translation requests/.test(last.j.error), "too many requests in an hour: " + JSON.stringify(last));
  } finally {
    await gw.close(); omni.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

(async () => { locales(); languages(); theme(); noPersonalExamples(); extraCredits(); await gateway(); console.log("0.7.26 interface OK"); })().catch((e) => { console.error(e); process.exit(1); });
