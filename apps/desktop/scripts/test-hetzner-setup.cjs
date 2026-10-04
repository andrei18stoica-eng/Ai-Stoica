// Moving to the server: Settings → "Copiază cheile pentru server" (lib/serverenv.cjs) and deploy/hetzner/setup-web.sh,
// the one-command server setup (site, phone app, OmniRoute) run with fake docker, curl, DNS and network tools.
// Checks .env edits (kept values, pasted keys, no duplicates), the OmniRoute key check and the docker command order.
const fs = require("fs"), os = require("os"), path = require("path"), { spawnSync } = require("child_process");
const { SERVER_ENV, serverEnvLines } = require("../lib/serverenv.cjs");

function expect(v, m) { if (!v) throw new Error(m); }

const repo = path.join(__dirname, "..", "..", "..");
// The copied keys: every Windows key, under the names the web service reads and the setup script accepts.
const main = fs.readFileSync(path.join(__dirname, "..", "main.cjs"), "utf8");
const secretKeys = JSON.parse(main.match(/const SECRET_KEYS = (\[[^\]]*\])/)[1]);
for (const k of [...secretKeys, "cloudflareAccountId"]) expect(SERVER_ENV[k], "Copiază cheile pentru server misses " + k);
const cloudServer = fs.readFileSync(path.join(repo, "apps", "cloud", "server.cjs"), "utf8");
const setupScript = fs.readFileSync(path.join(repo, "deploy", "hetzner", "setup-web.sh"), "utf8");
for (const name of Object.values(SERVER_ENV)) {
  expect(cloudServer.includes('"' + name + '"'), "apps/cloud/server.cjs does not read " + name);
  expect(new RegExp("\\b" + name + "\\b").test(setupScript.match(/AI_KEYS=\(([^)]*)\)/)[1]) || name === "OMNIROUTE_API_KEY", "setup-web.sh does not accept " + name);
}
const exported = serverEnvLines({ apiKey: "sk-good", groqApiKey: " gsk_x ", geminiApiKey: "has space", hfToken: "" });
expect(exported.text === "OMNIROUTE_API_KEY=sk-good\nGROQ_API_KEY=gsk_x\n" && exported.count === 2 && exported.skipped.join() === "GEMINI_API_KEY", "export lines wrong: " + JSON.stringify(exported));
expect(/ipcMain\.handle\("server-env:copy"[\s\S]*?return \{ ok: true, count, skipped \}/.test(main), "the keys must go to the clipboard only, never back to the interface");
expect(fs.readFileSync(path.join(__dirname, "..", "preload.cjs"), "utf8").includes('copyServerKeys: () => ipcRenderer.invoke("server-env:copy")'), "preload must expose copyServerKeys");

// The setup script runs on the Linux server: its scenarios need bash and Linux tools (the Windows build skips them).
if (process.platform === "win32" || spawnSync("bash", ["--version"]).error) {
  console.log("Copy-keys checks OK; setup-web.sh scenarios skipped (they run on Linux)");
  process.exit(0);
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-setup-"));
const deploy = path.join(root, "deploy", "hetzner"), bin = path.join(root, "bin"), log = path.join(root, "calls.log");
fs.mkdirSync(deploy, { recursive: true }); fs.mkdirSync(bin);
fs.copyFileSync(path.join(repo, "deploy", "hetzner", "setup-web.sh"), path.join(deploy, "setup-web.sh"));
fs.copyFileSync(path.join(repo, "deploy", "hetzner", ".env.example"), path.join(deploy, ".env.example"));
const meminfo = path.join(root, "meminfo");
fs.writeFileSync(meminfo, "MemTotal:        8000000 kB\nSwapTotal:             0 kB\n");

const tool = (name, body) => fs.writeFileSync(path.join(bin, name), "#!/usr/bin/env bash\n" + body + "\n", { mode: 0o755 });
tool("docker", `echo "docker $*" >> "$FAKE_LOG"; exit 0`);
tool("sleep", "exit 0");
tool("hostname", `echo "178.104.117.42 10.0.0.2 172.17.0.1 "`);
tool("ss", "exit 0");
tool("getent", `[ -n "$FAKE_DNS_IP" ] || exit 2; echo "$FAKE_DNS_IP   STREAM $2"`);
// curl: OmniRoute accepts only "sk-good"; the site reports OmniRoute connected.
tool("curl", `url=""; auth=""; fmt=""; out=""; fail=0
while [ $# -gt 0 ]; do case "$1" in -H) auth="$2"; shift ;; -w) fmt="$2"; shift ;; -o) out="$2"; shift ;; --max-time) shift ;;
  http*) url="$1" ;; -[!-]*) [[ "$1" == *f* ]] && fail=1 ;; esac; shift; done
echo "curl $url" >> "$FAKE_LOG"
case "$url" in
  */api/health) code=200; body='{"ok":true}' ;;
  */v1/models) if [ "$auth" = "Authorization: Bearer sk-good" ]; then code=200; else code=401; fi; body='{}' ;;
  http://127.0.0.1:8788/health) code=200; body='{"ok":true,"omni":true,"omniNeedsKey":false}' ;;
  https://*/health) code=200; body='{"ok":true}' ;;
  *) code=404; body='' ;;
esac
[ "$out" = /dev/null ] || printf '%s' "$body"
[ -z "$fmt" ] || printf '%s' "$code"
[ "$fail" = 1 ] && [ "$code" -ge 400 ] && exit 22
exit 0`);

const envFile = path.join(deploy, ".env");
const readEnv = () => fs.readFileSync(envFile, "utf8");
const value = (name) => { const m = readEnv().match(new RegExp("^" + name + "=(.*)$", "m")); return m ? m[1] : null; };
const count = (name) => (readEnv().match(new RegExp("^" + name + "=", "gm")) || []).length;
function run(input, extraEnv = {}) {
  fs.writeFileSync(log, "");
  const r = spawnSync("bash", [path.join(deploy, "setup-web.sh")], {
    input: input.join("\n") + "\n", encoding: "utf8", timeout: 30000,
    env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, FAKE_LOG: log, AI_STOICA_MEMINFO: meminfo, ...extraEnv }
  });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || ""), calls: fs.readFileSync(log, "utf8") };
}

try {
  // 1. A server that already runs the API: .env exists with the Owner and the database password.
  fs.writeFileSync(envFile, fs.readFileSync(path.join(deploy, ".env.example"), "utf8")
    .replace("POSTGRES_PASSWORD=CHANGE_ME_RANDOM", "POSTGRES_PASSWORD=pg-secret-1")
    .replace("OWNER_EMAIL=owner@exemplu.ro", "OWNER_EMAIL=andrei@example.ro"), { mode: 0o600 });
  let r = run([
    "",        // site address [aistoica.ro]
    "",        // OmniRoute version [3.8.51]
    "d",       // paste the keys copied from Windows
    ...serverEnvLines({ apiKey: "sk-good", groqApiKey: "gsk_test123", hfToken: "hf_a/b+c==&d" }).text.trim().split("\n"), "CEREBRAS_API_KEY=csk-1\r",
    "EVIL_VARIABLE=1", "GEMINI_API_KEY=bad value", "",
    ""         // Enter after the database import
  ], { FAKE_DNS_IP: "178.104.117.42" });
  expect(r.status === 0, "setup failed:\n" + r.out);
  expect(value("COMPOSE_PROFILES") === "edge,web" && count("COMPOSE_PROFILES") === 1, "COMPOSE_PROFILES must be turned on once: " + value("COMPOSE_PROFILES"));
  expect(value("AI_STOICA_WEB_DOMAIN") === "aistoica.ro" && value("OMNIROUTE_VERSION") === "3.8.51", "domain or OmniRoute version not set");
  expect(/^[0-9a-f]{64}$/.test(value("OMNIROUTE_WS_BRIDGE_SECRET")) && /^[0-9a-f]{16}$/.test(value("OMNIROUTE_INITIAL_PASSWORD")), "OmniRoute secrets must be generated");
  expect(value("OMNIROUTE_API_KEY") === "sk-good" && value("GROQ_API_KEY") === "gsk_test123" && value("HF_TOKEN") === "hf_a/b+c==&d" && value("CEREBRAS_API_KEY") === "csk-1", "pasted keys must be saved exactly: " + readEnv().split("\n").filter(l => /KEY|TOKEN/.test(l)).join(" | "));
  expect(value("GEMINI_API_KEY") === "" && !readEnv().includes("EVIL_VARIABLE"), "unknown names and values .env cannot hold must be skipped");
  expect(value("POSTGRES_PASSWORD") === "pg-secret-1" && value("OWNER_EMAIL") === "andrei@example.ro", "existing values must stay");
  expect((fs.statSync(envFile).mode & 0o777) === 0o600, ".env must stay private (600)");
  expect(fs.readdirSync(deploy).some(f => f.startsWith(".env.backup-")), ".env must be backed up first");
  const order = ["docker compose up -d omniroute", "docker compose up -d --build web", "docker compose up -d caddy"].map(c => r.calls.indexOf(c));
  expect(order.every(i => i >= 0) && order[0] < order[1] && order[1] < order[2], "docker commands missing or out of order:\n" + r.calls);
  expect(r.calls.includes("curl https://aistoica.ro/health") && /https:\/\/aistoica\.ro merge/.test(r.out) && /vede OmniRoute/.test(r.out), "site checks missing:\n" + r.out);
  expect(/ssh -L 20129:127\.0\.0\.1:20128 root@178\.104\.117\.42/.test(r.out), "the import tunnel must name this server's public address");
  expect(!r.out.includes("sk-good") && !r.out.includes("gsk_test123"), "keys must never be printed in full");

  // 2. Run again: values are kept, no duplicates; a key OmniRoute refuses is asked for again.
  fs.appendFileSync(envFile, "OMNIROUTE_API_KEY=sk-old\n");
  r = run(["", "n", "", "", "sk-bad", "sk-good"], { FAKE_DNS_IP: "178.104.117.42" });
  expect(r.status === 0, "second run failed:\n" + r.out);
  expect(value("OMNIROUTE_API_KEY") === "sk-good" && count("OMNIROUTE_API_KEY") === 1, "the refused key must be replaced once: " + value("OMNIROUTE_API_KEY"));
  expect(count("COMPOSE_PROFILES") === 1 && count("OMNIROUTE_WS_BRIDGE_SECRET") === 1 && value("GROQ_API_KEY") === "gsk_test123", "a second run must not duplicate or lose values");
  expect((r.out.match(/OmniRoute refuză cheia/g) || []).length === 2, "both refused keys must be reported:\n" + r.out);

  // 3. DNS not set yet: say what record to add, still start everything, do not wait for HTTPS.
  r = run(["", "n", "", ""], {});
  expect(r.status === 0 && /tip A, nume @, valoare 178\.104\.117\.42/.test(r.out) && !r.calls.includes("curl https://"), "missing DNS must be explained:\n" + r.out);

  // 4. A new server without .env: created from the example with a random database password and the Owner.
  fs.rmSync(envFile);
  r = run(["andrei@example.ro", "parola-owner-1", "", "", "n", "", "", ""], { FAKE_DNS_IP: "178.104.117.42" });
  expect(r.status === 0, "setup on a new server failed:\n" + r.out);
  expect(/^[0-9a-f]{64}$/.test(value("POSTGRES_PASSWORD")) && value("OWNER_EMAIL") === "andrei@example.ro" && value("OWNER_INITIAL_PASSWORD") === "parola-owner-1", "new .env not filled: " + readEnv().slice(0, 600));
  console.log("Hetzner setup script checks OK");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
