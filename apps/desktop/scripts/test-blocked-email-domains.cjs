// Spam-bot email domains (uberip.com always, SERASMART_BLOCKED_EMAIL_DOMAINS too) cannot register or sign in,
// on the web version and on Windows, before anything is stored or sent to Serasmart Cloud.
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");

function expect(v, m) { if (!v) throw new Error(m); }
function request(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: body ? { "content-type": "application/json" } : {} }, (res) => {
      let data = ""; res.setEncoding("utf8"); res.on("data", (c) => data += c); res.on("end", () => resolve({ status: res.statusCode, body: data, json: (() => { try { return JSON.parse(data); } catch { return {}; } })() }));
    });
    req.on("error", reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}

async function main() {
  process.env.SERASMART_BLOCKED_EMAIL_DOMAINS = " @Spam.example , ";
  const { startLocalGateway } = require("../local-gateway.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "serasmart-blocked-"));
  const cfg = { baseUrl: "http://127.0.0.1:65530/v1", model: "test/m", webSearchEnabled: false, githubAutoContext: false, directChatEnabled: false };
  const port = 8879;
  const gw = startLocalGateway({ dataDir: path.join(root, "data"), port, host: "127.0.0.1", getOmniConfig: () => cfg });
  try {
    for (let i = 0; i < 50; i++) { try { await request(port, "GET", "/health"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    for (const email of ["5wx3th65ofawn0@uberip.com", " X@UberIP.com ", "bot@mail.uberip.com", "bot@spam.example"]) {
      let r = await request(port, "POST", "/auth/register", { email, password: "password123", name: "Bot" });
      expect(r.status === 400 && r.json.error === "This email address is not accepted.", `register ${email}: ${r.status} ${r.body}`);
      r = await request(port, "POST", "/auth/login", { email, password: "password123" });
      expect(r.status === 403 && r.json.status === "blocked", `login ${email}: ${r.status} ${r.body}`);
    }
    const stored = JSON.stringify(fs.readdirSync(path.join(root, "data")).map((f) => { try { return fs.readFileSync(path.join(root, "data", f), "utf8"); } catch { return ""; } }));
    expect(!/uberip|spam\.example/i.test(stored), "blocked sign-ups must not be stored");
    const r = await request(port, "POST", "/auth/register", { email: "om@notuberip.com", password: "password123", name: "Om" });
    expect(r.status === 200 && r.json.token, "a domain that only ends with the same letters is not blocked: " + r.body);
    console.log("BLOCKED_EMAIL_DOMAINS_TESTS_PASSED");
  } finally {
    try { gw?.close?.(); } catch {}
    try { gw?.server?.close?.(); } catch {}
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
