// 0.7.18, from the diagnosis of 2026-10-16: skills did not exist, and no plugin worked without the user's own API,
// webhook or OAuth client. Skills are saved instructions called with /name (or always on); the built-in plugins
// (weather, BNR rates, Wikipedia, time) work as soon as they are added.
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");
const { runBuiltinPlugin, builtinKeywordMatch, placeFrom, wikiQuery } = require("../lib/builtinplugins.cjs");
const { validateSkill, skillsForMessage, slugify } = require("../lib/skills.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const reply = (text) => ({ text: async () => text });

async function units() {
  // Built-in plugins, with the network replaced by fixed answers.
  expect(placeFrom("cum e vremea în Cluj-Napoca mâine?") === "Cluj-Napoca" && placeFrom("plouă mâine?") === "București", "the place is read from the message");
  const weather = await runBuiltinPlugin("weather", "vremea la Iași", { request: async (url) => url.includes("geocoding")
    ? reply(JSON.stringify({ results: [{ name: "Iași", admin1: "Iași", country: "România", latitude: 47.16, longitude: 27.58 }] }))
    : reply(JSON.stringify({ current: { time: "2026-10-16T21:00", temperature_2m: 9.1, apparent_temperature: 7, relative_humidity_2m: 80, weather_code: 61, wind_speed_10m: 12 },
        daily: { time: ["2026-10-16"], weather_code: [63], temperature_2m_max: [12], temperature_2m_min: [6], precipitation_probability_max: [70] } })) });
  expect(/Vremea în Iași/.test(weather) && /9.1 °C/.test(weather) && /ploaie slabă/.test(weather) && /70%/.test(weather), "weather text: " + weather);
  const bnr = await runBuiltinPlugin("bnr", "", { request: async () => reply('<DataSet><Body><Cube date="2026-10-16"><Rate currency="USD">4.3512</Rate><Rate currency="HUF" multiplier="100">1.2345</Rate><Rate currency="EUR">5.0870</Rate></Cube></Body></DataSet>') });
  expect(/2026-10-16/.test(bnr) && bnr.indexOf("EUR") < bnr.indexOf("USD") && /100 HUF = 1.2345 RON/.test(bnr), "BNR rates, euro first: " + bnr);
  expect(wikiQuery("@wiki cine este Mihai Eminescu?") === "Mihai Eminescu", "the Wikipedia query is cleaned");
  const wiki = await runBuiltinPlugin("wikipedia", "@wiki Mihai Eminescu", { request: async (url) => url.includes("list=search")
    ? reply(JSON.stringify({ query: { search: [{ title: "Mihai Eminescu" }] } }))
    : reply(JSON.stringify({ title: "Mihai Eminescu", extract: "Poet romantic român.", content_urls: { desktop: { page: "https://ro.wikipedia.org/wiki/Mihai_Eminescu" } } })) });
  expect(/Poet romantic/.test(wiki) && /ro\.wikipedia\.org/.test(wiki), "Wikipedia summary: " + wiki);
  const time = await runBuiltinPlugin("time", "", {});
  expect(/România/.test(time) && /Tokyo/.test(time), "time in several cities");
  expect(builtinKeywordMatch("weather", "Cum e vremea mâine?") && builtinKeywordMatch("bnr", "cât e euro azi") && !builtinKeywordMatch("bnr", "scrie un email"), "keywords call the right plugin");

  // Skills.
  expect(slugify("Răspuns la Reclamații!") === "raspuns-la-reclamatii", "slug without diacritics");
  expect(validateSkill({ name: "", instructions: "x" }).error && validateSkill({ name: "Ok", instructions: "" }).error, "name and instructions are required");
  const list = [{ slug: "rezumat", name: "Rezumat", instructions: "R", enabled: true }, { slug: "ton", name: "Ton", instructions: "T", enabled: true, auto: true }, { slug: "off", name: "Off", instructions: "O", enabled: false, auto: true }];
  const used = skillsForMessage(list, "/rezumat textul de mai jos");
  expect(used.map(x => x.slug).join() === "rezumat,ton", "a called skill plus the always-on one, never a disabled one: " + used.map(x => x.slug));
  expect(skillsForMessage(list, "https://site.ro/rezumat").map(x => x.slug).join() === "ton", "a /word inside a link does not call a skill");
}

async function gateway() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-skills-"));
  const systems = [];
  const omni = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "Ai principal", owned_by: "combo" }] }));
      if (req.url === "/v1/chat/completions") {
        const j = JSON.parse(body); systems.push(String(j.messages.find(m => m.role === "system")?.content || ""));
        return res.end(JSON.stringify({ id: "x", model: j.model, choices: [{ index: 0, message: { role: "assistant", content: "Gata." }, finish_reason: "stop" }] }));
      }
      res.statusCode = 404; res.end("{}");
    });
  });
  const omniPort = await listen(omni);
  const cfg = { baseUrl: `http://127.0.0.1:${omniPort}/v1`, apiKey: "sk-omni", model: "Ai principal", webSearchEnabled: false, githubAutoContext: false, ownerEmail: "owner@example.com" };
  const gw = startLocalGateway({ dataDir: dir, port: 8883, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8883";
  const call = async (p, { method = "GET", body, token } = {}) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
  try {
    const token = (await call("/auth/register", { method: "POST", body: { email: "owner@example.com", password: "password123", name: "Owner" } })).j.token;
    const chat = (text) => call("/api/chat", { method: "POST", token, body: { model: "Ai principal", messages: [{ role: "user", content: text }] } });

    // Skills: the ready-made ones are listed; one is added; a custom one is created; the same command twice is refused.
    let r = await call("/api/skills", { token });
    expect(r.status === 200 && r.j.templates.length >= 5 && r.j.data.length === 0, "templates listed: " + JSON.stringify(r.j).slice(0, 200));
    r = await call("/api/skills/template", { method: "POST", token, body: { slug: "rezumat" } });
    expect(r.status === 200 && r.j.data.slug === "rezumat", "a ready-made skill is added");
    r = await call("/api/skills/template", { method: "POST", token, body: { slug: "rezumat" } });
    expect(r.status === 409, "the same command twice is refused");
    r = await call("/api/skills", { method: "POST", token, body: { name: "Ton Webserano", instructions: "Semnează mereu cu «Echipa Webserano»." } });
    expect(r.status === 200 && r.j.data.slug === "ton-webserano", "a custom skill: " + JSON.stringify(r.j));
    const custom = r.j.data;

    // In the chat: /rezumat brings its instructions; without it, nothing; always-on works without the command.
    await chat("/rezumat Ieri am avut ședința de proiect.");
    expect(/SKILL-URI ACTIVE/.test(systems.at(-1)) && /### \/rezumat/.test(systems.at(-1)), "the called skill reaches the model");
    await chat("Salut, ce faci?");
    expect(!/SKILL-URI ACTIVE/.test(systems.at(-1)), "no skill without the command");
    r = await call(`/api/skills/${custom.id}`, { method: "PATCH", token, body: { auto: true } });
    expect(r.status === 200 && r.j.data.auto === true, "always on");
    await chat("Scrie un mesaj pentru un client.");
    expect(/Echipa Webserano/.test(systems.at(-1)), "an always-on skill applies to every message");
    r = await call(`/api/skills/${custom.id}`, { method: "DELETE", token });
    expect(r.status === 200, "a skill is deleted");

    // Built-in plugins: listed, added with one click (no URL, key or OAuth), called by their subject.
    r = await call("/api/plugins/builtin", { token });
    expect(r.status === 200 && r.j.data.some(x => x.key === "weather" && !x.installed), "built-in plugins listed");
    r = await call("/api/plugins/builtin", { method: "POST", token, body: { key: "weather" } });
    expect(r.status === 200 && r.j.data.mode === "builtin" && r.j.data.enabled === true, "the weather plugin is added: " + JSON.stringify(r.j));
    const again = await call("/api/plugins/builtin", { method: "POST", token, body: { key: "weather" } });
    expect(again.j.data.id === r.j.data.id, "adding it twice keeps one");
    r = await call("/api/plugins/builtin", { method: "POST", token, body: { key: "nope" } });
    expect(r.status === 400, "an unknown built-in plugin is refused");
    await chat("Cum e vremea mâine în Brașov?");
    expect(/pluginuri conectate/.test(systems.at(-1)) && /Vremea/.test(systems.at(-1)), "a question about the weather calls the plugin: " + systems.at(-1).slice(-300));
    const list = await call("/api/plugins", { token });
    const w = list.j.data.find(x => x.mode === "builtin");
    r = await call(`/api/plugins/${w.id}`, { method: "PATCH", token, body: { url: "http://127.0.0.1:1/", enabled: false } });
    expect(r.status === 200 && r.j.data.url === "https://api.open-meteo.com/v1/forecast" && r.j.data.enabled === false, "a built-in plugin keeps its address");
  } finally {
    await gw.close(); omni.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

(async () => {
  await units();
  await gateway();
  console.log("0.7.18 skills and built-in plugins OK");
})().catch((e) => { console.error(e); process.exit(1); });
