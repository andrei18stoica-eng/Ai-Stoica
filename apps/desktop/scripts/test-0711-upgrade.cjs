// 0.7.11 upgrade paths: LAN plugins on the desktop, per-email login limit, first Cloud login keeps local data.
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-upgrade-"));
  const lan = http.createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true, from: "lan" })); });
  const lanPort = await listen(lan);
  const cloud = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/auth/login") return res.end(JSON.stringify({ token: "cloud-token-1", user: { id: "cloud-42", email: "andrei@example.com", name: "Andrei", role: "user", status: "active" }, permissions: {} }));
      if (req.url === "/auth/me") return res.end(JSON.stringify({ user: { id: "cloud-42", email: "andrei@example.com", name: "Andrei", role: "user", status: "active" }, permissions: {} }));
      res.statusCode = 404; res.end(JSON.stringify({ error: "nu" }));
    });
  });
  const cloudPort = await listen(cloud);
  const localCfg = { baseUrl: "http://127.0.0.1:65530/v1", model: "test/m", webSearchEnabled: false, githubAutoContext: false, directChatEnabled: false };
  let gw = startLocalGateway({ dataDir: dir, port: 8851, host: "127.0.0.1", getOmniConfig: () => localCfg });
  const base = "http://127.0.0.1:8851";
  const post = (p, body, token) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) });
  try {
    await new Promise((r) => setTimeout(r, 150));
    let r = await post("/auth/register", { email: "andrei@example.com", password: "parola-buna-1", name: "Andrei" });
    let j = await r.json(); expect(r.ok, "register: " + j.error);
    const token = j.token;

    // A plugin on the PC / local network keeps working in the desktop app.
    r = await post("/api/plugins", { name: "n8n local", url: `http://127.0.0.1:${lanPort}/hook`, method: "POST" }, token);
    j = await r.json(); expect(r.ok, "plugin create: " + j.error);
    r = await post(`/api/plugins/${j.data.id}/test`, {}, token); j = await r.json();
    expect(r.ok && JSON.stringify(j).includes("lan"), "LAN plugin must work on the desktop: " + JSON.stringify(j).slice(0, 200));

    // Wrong passwords for one email never block another, and a correct login clears the count.
    for (let i = 0; i < 6; i++) await post("/auth/login", { email: "andrei@example.com", password: "gresit" });
    r = await post("/auth/login", { email: "andrei@example.com", password: "parola-buna-1" }); expect(r.ok, "correct login after 6 mistakes must work");
    for (let i = 0; i < 9; i++) { r = await post("/auth/login", { email: "andrei@example.com", password: "gresit" }); expect(r.status === 401, "count must restart after a correct login (got " + r.status + ")"); }
    for (let i = 0; i < 11; i++) await post("/auth/login", { email: "altcineva@example.com", password: "x" });
    r = await post("/auth/login", { email: "andrei@example.com", password: "parola-buna-1" }); expect(r.ok, "another email's mistakes must not lock this account");
    r = await post("/api/conversations", { title: "Conversație locală", messages: [{ role: "user", content: "salut" }] }, token);
    expect(r.ok, "conversation create");
    await gw.close();

    // Same PC, Cloud configured later: the first Cloud login links the local account (same email + same password).
    const cloudCfg = { ...localCfg, controlApiUrl: `http://127.0.0.1:${cloudPort}` };
    gw = startLocalGateway({ dataDir: dir, port: 8851, host: "127.0.0.1", getOmniConfig: () => cloudCfg });
    await new Promise((r) => setTimeout(r, 150));
    r = await post("/auth/login", { email: "andrei@example.com", password: "parola-buna-1" }); j = await r.json();
    expect(r.ok, "cloud login: " + j.error);
    const db = JSON.parse(fs.readFileSync(path.join(dir, "ai-stoica-data.json"), "utf8"));
    const users = db.users.filter((u) => u.email === "andrei@example.com");
    expect(users.length === 1 && users[0].cloudUserId === "cloud-42", "local account must be linked, not duplicated: " + JSON.stringify(users.map((u) => u.cloudUserId)));
    r = await fetch(base + "/api/conversations", { headers: { authorization: "Bearer " + j.token } }); j = await r.json();
    expect(r.ok && (j.data || []).some((c) => c.title === "Conversație locală"), "local conversations must stay visible after switching to Cloud");
    console.log("UPGRADE_0711_TESTS_PASSED");
  } finally {
    await gw.close(); lan.close(); cloud.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
