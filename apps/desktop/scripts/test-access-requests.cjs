// Permite / Refuză from the Owner's phone notification: the gateway passes /auth/access-requests/<token> to Serasmart AI
// Cloud without a login (the phone's service worker has none), counts failed links, and the service worker and the
// web interface carry the push handlers, the two buttons and the Settings tab.
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
function request(port, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) } }, (res) => {
      let data = ""; res.setEncoding("utf8"); res.on("data", (c) => data += c); res.on("end", () => resolve({ status: res.statusCode, body: data, json: (() => { try { return JSON.parse(data); } catch { return {}; } })() }));
    });
    req.on("error", reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}

async function main() {
  const good = "a".repeat(64), seen = [];
  const cloud = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      seen.push({ method: req.method, url: req.url, body, auth: req.headers.authorization || "" });
      res.setHeader("content-type", "application/json");
      if (req.url === "/auth/register") { res.statusCode = 202; return res.end(JSON.stringify(JSON.parse(body).email === "vechi@example.com" ? { ok: true, status: "pending", message: "Cont creat." } : { ok: true, status: "verify_email", email: "maria@gmail.com", message: "Ți-am trimis un cod." })); }
      if (req.url === "/auth/login") { res.statusCode = 403; return res.end(JSON.stringify({ error: "Confirmă mai întâi emailul.", status: "verify_email", email: "maria@gmail.com" })); }
      if (req.url === "/auth/verify-email") { const ok = JSON.parse(body).code === "123456"; res.statusCode = ok ? 202 : 400; return res.end(JSON.stringify(ok ? { ok: true, status: "pending", message: "Email confirmat." } : { error: "Codul nu este corect." })); }
      if (req.url === "/auth/resend-code") return res.end(JSON.stringify({ ok: true, message: "Ți-am trimis un cod nou." }));
      if (req.url === `/auth/access-requests/${good}` && req.method === "GET") return res.end(JSON.stringify({ request: { name: "Maria", email: "maria@gmail.com" } }));
      if (req.url === `/auth/access-requests/${good}` && req.method === "POST") return res.end(JSON.stringify({ ok: true, status: JSON.parse(body).decision === "allow" ? "active" : "rejected", name: "Maria", email: "maria@gmail.com" }));
      res.statusCode = 404; res.end(JSON.stringify({ error: "Cererea nu mai există." }));
    });
  }).listen(8883, "127.0.0.1");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "serasmart-access-"));
  const cfg = { baseUrl: "http://127.0.0.1:65530/v1", model: "test/m", webSearchEnabled: false, githubAutoContext: false, directChatEnabled: false, controlApiUrl: "http://127.0.0.1:8883" };
  const local = { ...cfg, controlApiUrl: "" };
  const gw = startLocalGateway({ dataDir: path.join(root, "a"), port: 8881, host: "127.0.0.1", getOmniConfig: () => cfg });
  const off = startLocalGateway({ dataDir: path.join(root, "b"), port: 8882, host: "127.0.0.1", getOmniConfig: () => local });
  try {
    for (let i = 0; i < 50; i++) { try { await request(8881, "GET", "/health"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    // Sign-up through the web site: the email-code step and the "waiting for approval" answer come through as they are.
    let r = await request(8881, "POST", "/auth/register", { email: "maria@gmail.com", password: "parola123", name: "Maria" });
    expect(r.status === 202 && r.json.status === "verify_email", "register asks for the email code: " + r.body);
    r = await request(8881, "POST", "/auth/register", { email: "vechi@example.com", password: "parola123", name: "Vechi" });
    expect(r.status === 202 && r.json.status === "pending", "a pending sign-up is not an invalid answer: " + r.body);
    r = await request(8881, "POST", "/auth/login", { email: "maria@gmail.com", password: "parola123" });
    expect(r.status === 403 && r.json.status === "verify_email", "login keeps the verify_email status: " + r.body);
    r = await request(8881, "POST", "/auth/verify-email", { email: "maria@gmail.com", code: "000000" });
    expect(r.status === 400 && r.json.error === "Codul nu este corect.", "a wrong code is refused: " + r.body);
    r = await request(8881, "POST", "/auth/verify-email", { email: "maria@gmail.com", code: "123456" });
    expect(r.status === 202 && r.json.status === "pending", "the right code passes: " + r.body);
    r = await request(8881, "POST", "/auth/resend-code", { email: "maria@gmail.com" });
    expect(r.status === 200, "resend passes through: " + r.body);
    r = await request(8882, "POST", "/auth/verify-email", { email: "maria@gmail.com", code: "123456" });
    expect(r.status === 404, "no email codes without Serasmart Cloud");

    r = await request(8881, "GET", `/auth/access-requests/${good}`);
    expect(r.status === 200 && r.json.request?.name === "Maria", "GET passes through without login: " + r.body);
    r = await request(8881, "POST", `/auth/access-requests/${good}`, { decision: "allow" });
    expect(r.status === 200 && r.json.status === "active", "POST allow passes through: " + r.body);
    expect(seen.some((x) => x.method === "POST" && JSON.parse(x.body).decision === "allow"), "the decision reaches the Cloud");
    for (let i = 0; i < 30; i++) await request(8881, "GET", `/auth/access-requests/${"b".repeat(64)}`);
    r = await request(8881, "GET", `/auth/access-requests/${good}`);
    expect(r.status === 429, "guessing links is rate limited, got " + r.status);
    r = await request(8882, "GET", `/auth/access-requests/${good}`);
    expect(r.status === 404, "without Serasmart Cloud there are no access requests");

    const sw = fs.readFileSync(path.join(__dirname, "..", "renderer", "public", "sw.js"), "utf8");
    for (const s of ['addEventListener("push"', 'addEventListener("notificationclick"', 'action: "allow", title: "Permite"', 'action: "deny", title: "Refuză"', "/auth/access-requests/", "requireInteraction"]) expect(sw.includes(s), "sw.js must contain " + s);
    const ui = fs.readFileSync(path.join(__dirname, "..", "renderer", "src", "accessRequest.jsx"), "utf8");
    for (const s of ["export function AccessRequestDialog", "export function PhoneNotifications", "/api/admin/push/subscribe", "applicationServerKey", 'get("access")']) expect(ui.includes(s), "accessRequest.jsx must contain " + s);
    const main = fs.readFileSync(path.join(__dirname, "..", "renderer", "src", "main.jsx"), "utf8");
    expect(main.includes('authPost("/auth/verify-email"') && main.includes('authPost("/auth/resend-code"') && main.includes('autoComplete="one-time-code"'), "the sign-in screen must have the email-code step");
    expect(main.includes("<AccessRequestDialog/>") && main.includes('["notify",Bell,"Notifications",true]') && main.includes("{webServer&&<PhoneNotifications/>}"), "main.jsx must mount the dialog, and the Owner on the site gets phone notifications in the Notifications tab (0.7.23)");
    console.log("ACCESS_REQUEST_TESTS_PASSED");
  } finally {
    cloud.close();
    for (const g of [gw, off]) { try { g?.close?.(); } catch {} try { g?.server?.close?.(); } catch {} }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
