// 0.7.23 (phase 3): every account has its own settings — profile, how the AI answers, default model, notifications,
// privacy (keep conversations N days, export, delete data or the account) and security (sessions, password).
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const A = require("../lib/accountsettings.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));

function units() {
  expect(A.validateAccountSettings({ tone: "angry" }).error && A.validateAccountSettings({ retentionDays: 7 }).error && A.validateAccountSettings({ notifyCredits: "no" }).error, "unknown values are refused");
  expect(A.validateAccountSettings({ name: "  " }).error && A.validateAccountSettings({ about: "x".repeat(1501) }).error, "an empty name and a too long text are refused");
  const v = A.validateAccountSettings({ name: " Ana  Pop ", nickname: "Ana", tone: "concise", responseLanguage: "en", retentionDays: 30, notifyCredits: false, unknown: 1 }).value;
  expect(v.name === "Ana Pop" && v.tone === "concise" && v.retentionDays === 30 && v.notifyCredits === false && !("unknown" in v), "valid values are kept: " + JSON.stringify(v));
  expect(A.personalizationText({}) === "", "nothing written, nothing added to the AI");
  const t = A.personalizationText({ settings: { nickname: "Ana", occupation: "contabilă", tone: "concise", responseLanguage: "en", customInstructions: "Folosește tabele." } });
  expect(/Ana/.test(t) && /contabilă/.test(t) && /scurte/.test(t) && /English/.test(t) && /Folosește tabele/.test(t), "the AI is told what the person wrote: " + t);
}

async function gateway() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "account-"));
  const systems = [];
  const omni = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "Ai principal", owned_by: "combo" }] }));
      if (req.url === "/v1/chat/completions") { const j = JSON.parse(body); systems.push(String(j.messages.find((m) => m.role === "system")?.content || "")); return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Gata." } }] })); }
      res.statusCode = 404; res.end("{}");
    });
  });
  const omniPort = await listen(omni);
  const cfg = { baseUrl: `http://127.0.0.1:${omniPort}/v1`, apiKey: "k", model: "Ai principal", webSearchEnabled: false, githubAutoContext: false, directChatEnabled: false, ownerEmail: "owner@example.com" };
  const gw = require("../local-gateway.cjs").startLocalGateway({ dataDir: dir, port: 8888, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8888";
  const call = async (p, { method = "GET", body, token } = {}) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {} return { status: r.status, j, text, headers: r.headers }; };
  try {
    const owner = (await call("/auth/register", { method: "POST", body: { email: "owner@example.com", password: "password123", name: "Owner" } })).j.token;
    let ana = (await call("/auth/register", { method: "POST", body: { email: "ana@example.com", password: "password123", name: "Ana" } })).j.token;
    const bob = (await call("/auth/register", { method: "POST", body: { email: "bob@example.com", password: "password123", name: "Bob" } })).j.token;

    // Profile and personalisation, saved for each account separately, reach the AI.
    let r = await call("/api/me/settings", { token: ana });
    expect(r.status === 200 && r.j.data.tone === "default" && r.j.data.retentionDays === 0 && r.j.data.email === "ana@example.com" && r.j.options.tones.includes("concise"), "default settings: " + JSON.stringify(r.j).slice(0, 200));
    expect((await call("/api/me/settings", { method: "PATCH", token: ana, body: { tone: "rude" } })).status === 400, "an unknown tone is refused");
    r = await call("/api/me/settings", { method: "PATCH", token: ana, body: { name: "Ana Pop", nickname: "Anuța", occupation: "contabilă", customInstructions: "Răspunde cu tabele când compari.", tone: "concise", preferredModel: "Ai principal" } });
    expect(r.status === 200 && r.j.data.name === "Ana Pop" && r.j.data.nickname === "Anuța" && r.j.data.preferredModel === "Ai principal", "settings saved: " + JSON.stringify(r.j).slice(0, 200));
    expect((await call("/api/me/settings", { token: bob })).j.data.nickname === "", "another account keeps its own settings");
    await call("/api/chat", { method: "POST", token: ana, body: { messages: [{ role: "user", content: "Salut" }] } });
    expect(/Anuța/.test(systems.at(-1)) && /contabilă/.test(systems.at(-1)) && /tabele/.test(systems.at(-1)) && /scurte/.test(systems.at(-1)), "the AI gets Ana's personalisation");
    await call("/api/chat", { method: "POST", token: bob, body: { messages: [{ role: "user", content: "Salut" }] } });
    expect(!/Anuța/.test(systems.at(-1)), "but not Bob's answers");

    // Export: everything of the account, nothing secret.
    const conv = (await call("/api/conversations", { method: "POST", token: ana, body: { title: "Bilanț", messages: [{ id: "m1", role: "user", content: "Bilanțul pe 2025" }] } })).j.data;
    await call("/api/memory", { method: "POST", token: ana, body: { text: "Lucrează la SeranoConsult." } });
    r = await call("/api/me/export", { token: ana });
    expect(r.status === 200 && /attachment; filename="serasmart-date-/.test(r.headers.get("content-disposition")) && r.j.conversations.some((c) => c.id === conv.id) && r.j.memories.length === 1 && r.j.account.settings.nickname === "Anuța", "the export has the account's data");
    expect(!/passwordHash|cloudToken|apiKey"\s*:\s*"[^"]/.test(r.text), "and no password hash, token or key");

    // Keep conversations N days: older ones go (pinned ones stay).
    const file = path.join(dir, "serasmart-data.json");
    const db = JSON.parse(fs.readFileSync(file, "utf8"));
    const convDir = path.join(dir, "conversations");
    const old = { id: "old-1", userId: db.users.find((u) => u.email === "ana@example.com").id, title: "Veche", messages: [], createdAt: Date.now() - 100 * 86400000, updatedAt: Date.now() - 100 * 86400000 };
    fs.writeFileSync(path.join(convDir, "old-1.json"), JSON.stringify(old));
    fs.writeFileSync(path.join(convDir, "old-pinned.json"), JSON.stringify({ ...old, id: "old-pinned", pinned: true }));
    fs.utimesSync(file, new Date(), new Date(Date.now() + 2000));
    r = await call("/api/me/settings", { method: "PATCH", token: ana, body: { retentionDays: 30 } });
    const ids = (await call("/api/conversations", { token: ana })).j.data.map((c) => c.id);
    expect(r.status === 200 && !ids.includes("old-1") && ids.includes("old-pinned") && ids.includes(conv.id), "conversations older than 30 days are deleted, pinned and recent ones stay: " + ids);

    // Deleting data needs the word STERGE.
    expect((await call("/api/me/delete-data", { method: "POST", token: ana, body: { scope: "memories", confirm: "da" } })).status === 400, "without STERGE nothing is deleted");
    r = await call("/api/me/delete-data", { method: "POST", token: ana, body: { scope: "memories", confirm: "sterge" } });
    expect(r.status === 200 && r.j.deleted.memories === 1 && (await call("/api/conversations", { token: ana })).j.data.length > 0, "only the memories go");

    // Sessions (local account): sign the other devices out; this one gets a new token.
    const anaOther = (await call("/auth/login", { method: "POST", body: { email: "ana@example.com", password: "password123" } })).j.token;
    await new Promise((res) => setTimeout(res, 1100));
    r = await call("/api/me/sessions/revoke-others", { method: "POST", token: ana, body: {} });
    expect(r.status === 200 && r.j.token, "the current device gets a new token");
    expect((await call("/auth/me", { token: anaOther })).status === 401 && (await call("/auth/me", { token: r.j.token })).status === 200, "the other device is signed out, this one stays");
    ana = r.j.token;
    expect((await call("/api/me/sessions", { token: ana })).j.local === true, "a local account shows this device");

    // Password.
    expect((await call("/api/me/password", { method: "POST", token: ana, body: { current: "gresit123", next: "parolanoua1" } })).status === 401, "the current password is checked");
    await new Promise((res) => setTimeout(res, 1100));
    r = await call("/api/me/password", { method: "POST", token: ana, body: { current: "password123", next: "parolanoua1" } });
    expect(r.status === 200 && r.j.token && (await call("/auth/me", { token: ana })).status === 401, "a new password signs the old sessions out");
    ana = r.j.token;
    expect((await call("/auth/login", { method: "POST", body: { email: "ana@example.com", password: "parolanoua1" } })).status === 200, "and the new password works");

    // Deleting the account.
    expect((await call("/api/me", { method: "DELETE", token: owner, body: { password: "password123" } })).status === 400, "the Owner's account cannot be deleted");
    expect((await call("/api/me", { method: "DELETE", token: ana, body: { password: "gresit" } })).status === 401, "the password is needed");
    r = await call("/api/me", { method: "DELETE", token: ana, body: { password: "parolanoua1" } });
    expect(r.status === 200 && (await call("/auth/me", { token: ana })).status === 401, "the account is deleted");
    const after = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(!after.users.some((u) => u.email === "ana@example.com") && !fs.readdirSync(convDir).some((f) => JSON.parse(fs.readFileSync(path.join(convDir, f), "utf8")).title === "Bilanț"), "with all its data");
    expect((await call("/api/me/settings", { token: bob })).status === 200, "other accounts are untouched");

    // The interface: the account tabs for every account.
    const ui = fs.readFileSync(path.join(__dirname, "..", "renderer", "src", "main.jsx"), "utf8");
    expect(/ACCOUNT_TABS=\["profile","notify","privacy","security"\]/.test(ui) && /const accountOnly=!bridge/.test(ui) && /ProfileTab account=\{account\}/.test(ui), "every account sees Profile, Notifications, Privacy and Security");
  } finally {
    await gw.close(); omni.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

(async () => { units(); await gateway(); console.log("0.7.23 account settings OK"); })().catch((e) => { console.error(e); process.exit(1); });
