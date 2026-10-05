// "Actualizează site-ul" (Owner): the site only drops a request file; the server's own service runs update.sh and
// writes the result. Checks the gateway routes (Owner only), deploy/hetzner/update-runner.sh with a simulated git
// checkout (manual update, hourly check, automatic update, failure) and install-updater.sh with a simulated systemd.
const fs = require("fs"), os = require("os"), path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { startLocalGateway } = require("../local-gateway.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const DEPLOY = path.join(__dirname, "..", "..", "..", "deploy", "hetzner");

async function gatewayRoutes() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-update-"));
  const updateDir = path.join(root, "update"); fs.mkdirSync(updateDir);
  const cfg = { baseUrl: "http://127.0.0.1:65530/v1", model: "", webSearchEnabled: false, githubAutoContext: false, ownerEmail: "owner@example.com" };
  const gw = startLocalGateway({ dataDir: path.join(root, "data"), port: 8876, host: "127.0.0.1", getOmniConfig: () => cfg, updateDir });
  const plain = startLocalGateway({ dataDir: path.join(root, "data2"), port: 8877, host: "127.0.0.1", getOmniConfig: () => cfg });
  const call = (port, p, token, method = "GET", body) => fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const register = async (port, email) => (await (await call(port, "/auth/register", null, "POST", { email, password: "password123", name: email })).json()).token;
  try {
    const owner = await register(8876, "owner@example.com"), user = await register(8876, "ana@example.com");
    let r = await call(8876, "/api/server/update", user); let j = await r.json();
    expect(r.status === 200 && j.data.enabled === false, "another account must not see the update section");
    r = await call(8876, "/api/server/update", user, "POST", {});
    expect(r.status === 403 && !fs.existsSync(path.join(updateDir, "request")), "another account must not start an update");

    r = await call(8876, "/api/server/update", owner); j = await r.json();
    expect(j.data.enabled === true && j.data.installed === false && /update\.sh/.test(j.data.setupHint), "before the server service is installed the Owner gets the command to run: " + JSON.stringify(j));
    r = await call(8876, "/api/server/update", owner, "POST", {});
    expect(r.status === 503, "no request while the server service is missing: " + r.status);

    fs.writeFileSync(path.join(updateDir, "installed"), "x");
    fs.writeFileSync(path.join(updateDir, "available.json"), JSON.stringify({ current: { version: "0.7.15" }, latest: { version: "0.7.16" }, behind: 3 }));
    r = await call(8876, "/api/server/update", owner, "POST", {});
    const req = JSON.parse(fs.readFileSync(path.join(updateDir, "request"), "utf8"));
    expect(r.status === 202 && req.by === "owner@example.com", "the Owner's button must drop the request: " + r.status);
    r = await call(8876, "/api/server/update", owner); j = await r.json();
    expect(j.data.pending === true && j.data.available.latest.version === "0.7.16", "the status must show the pending request and the new version: " + JSON.stringify(j));

    fs.writeFileSync(path.join(updateDir, "status.json"), JSON.stringify({ state: "running" }));
    r = await call(8876, "/api/server/update", owner, "POST", {});
    expect(r.status === 409, "no second request while an update runs: " + r.status);

    r = await call(8876, "/api/server/update", owner, "PATCH", { auto: true });
    expect(r.status === 200 && fs.existsSync(path.join(updateDir, "auto")), "automatic updates on");
    r = await call(8876, "/api/server/update", owner, "PATCH", { auto: false });
    expect(r.status === 200 && !fs.existsSync(path.join(updateDir, "auto")), "automatic updates off");
    r = await call(8876, "/api/server/update", owner, "PATCH", { auto: "poate" });
    expect(r.status === 400, "auto must be true or false");
    r = await call(8876, "/api/server/update", user, "PATCH", { auto: true });
    expect(r.status === 403, "another account must not change automatic updates");

    const owner2 = await register(8877, "owner@example.com");
    r = await call(8877, "/api/server/update", owner2); j = await r.json();
    expect(j.data.enabled === false, "the Windows app (no update folder) has no site update section");
  } finally {
    await gw.close(); await plain.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function sh(cwd, cmd, args, env = {}) {
  return execFileSync(cmd, args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function runnerScript() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-runner-"));
  try {
    const origin = path.join(tmp, "origin.git"), work = path.join(tmp, "work"), root = path.join(tmp, "root"), dir = path.join(tmp, "update");
    sh(tmp, "git", ["init", "-q", "--bare", "-b", "main", origin]);
    sh(tmp, "git", ["clone", "-q", origin, work]);
    const commit = (version, script) => {
      fs.writeFileSync(path.join(work, "package.json"), JSON.stringify({ name: "ai-stoica", version }, null, 2) + "\n");
      fs.mkdirSync(path.join(work, "deploy", "hetzner"), { recursive: true });
      fs.writeFileSync(path.join(work, "deploy", "hetzner", "update.sh"), script);
      sh(work, "git", ["add", "-A"]); sh(work, "git", ["commit", "-q", "-m", "v" + version]); sh(work, "git", ["push", "-q", "origin", "HEAD:main"]);
    };
    const goodUpdate = "#!/usr/bin/env bash\nset -e\ncd \"$(dirname \"$0\")/../..\"\ngit pull -q --ff-only origin main\necho 'AI Stoica API is healthy.'\n";
    commit("1.0.0", goodUpdate);
    sh(tmp, "git", ["clone", "-q", origin, root]);
    commit("1.0.1", goodUpdate);
    const env = { AI_STOICA_ROOT: root, AI_STOICA_UPDATE_DIR: dir };
    const runner = path.join(DEPLOY, "update-runner.sh");
    const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));

    // Hourly check: sees the new version, does not install it while automatic updates are off.
    spawnSync("bash", [runner, "check"], { env: { ...process.env, ...env }, encoding: "utf8" });
    let a = read("available.json");
    expect(a.behind === 1 && a.current.version === "1.0.0" && a.latest.version === "1.0.1", "the check must find the new version: " + JSON.stringify(a));
    expect(!fs.existsSync(path.join(dir, "status.json")), "without automatic updates the check must not install");

    // Automatic updates on: the check installs it.
    fs.writeFileSync(path.join(dir, "auto"), "x");
    spawnSync("bash", [runner, "check"], { env: { ...process.env, ...env }, encoding: "utf8" });
    let s = read("status.json"); a = read("available.json");
    expect(s.state === "ok" && s.version === "1.0.1" && /healthy/.test(s.log) && a.behind === 0, "automatic update must install the new version: " + JSON.stringify({ s, a }));
    fs.rmSync(path.join(dir, "auto"));

    // The button's request, with an update that fails: the error and the log reach the site; the request is consumed.
    commit("1.0.2", "#!/usr/bin/env bash\necho 'eroare de test la docker build' >&2\nexit 1\n");
    sh(root, "git", ["pull", "-q", "--ff-only", "origin", "main"]);
    fs.writeFileSync(path.join(dir, "request"), "{}");
    const r = spawnSync("bash", [runner, "run"], { env: { ...process.env, ...env }, encoding: "utf8" });
    s = read("status.json");
    expect(r.status !== 0 && s.state === "error" && /eroare de test/.test(s.log) && !fs.existsSync(path.join(dir, "request")), "a failed update must be reported with its log: " + JSON.stringify(s));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

function installer() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-installer-"));
  try {
    const bin = path.join(tmp, "bin"), units = path.join(tmp, "units"), dir = path.join(tmp, "update"), log = path.join(tmp, "calls.log");
    fs.mkdirSync(bin); fs.mkdirSync(units);
    for (const [name, body] of Object.entries({
      id: "#!/bin/sh\n[ \"$1\" = -u ] && echo 0 || /usr/bin/id \"$@\"\n",
      chown: `#!/bin/sh\necho "chown $*" >> ${log}\n`,
      systemctl: `#!/bin/sh\necho "systemctl $*" >> ${log}\n`
    })) { fs.writeFileSync(path.join(bin, name), body); fs.chmodSync(path.join(bin, name), 0o755); }
    const env = { ...process.env, PATH: bin + ":" + process.env.PATH, AI_STOICA_ROOT: "/opt/ai-stoica", AI_STOICA_UPDATE_DIR: dir, AI_STOICA_SYSTEMD_DIR: units };
    let r = spawnSync("bash", [path.join(DEPLOY, "install-updater.sh")], { env, encoding: "utf8" });
    expect(r.status === 0, "installer: " + r.stdout + r.stderr);
    const service = fs.readFileSync(path.join(units, "ai-stoica-update.service"), "utf8"), pathUnit = fs.readFileSync(path.join(units, "ai-stoica-update.path"), "utf8");
    expect(/ExecStart=\/bin\/bash \/opt\/ai-stoica\/deploy\/hetzner\/update-runner\.sh run/.test(service) && pathUnit.includes(`PathExists=${dir}/request`), "the units must run the fixed script when the site drops a request");
    expect(/OnUnitActiveSec=1h/.test(fs.readFileSync(path.join(units, "ai-stoica-update-check.timer"), "utf8")), "hourly check timer");
    let calls = fs.readFileSync(log, "utf8");
    expect(calls.includes(`chown 1000:1000 ${dir}`) && calls.includes("daemon-reload") && calls.includes("enable --now ai-stoica-update.path") && calls.includes("enable --now ai-stoica-update-check.timer") && fs.existsSync(path.join(dir, "installed")), "installer must hand the folder to the site's user and enable the units: " + calls);
    fs.writeFileSync(log, "");
    r = spawnSync("bash", [path.join(DEPLOY, "install-updater.sh"), "--quiet"], { env, encoding: "utf8" });
    calls = fs.readFileSync(log, "utf8");
    expect(r.status === 0 && !calls.includes("daemon-reload") && r.stdout.trim() === "", "a second run with nothing changed must not reload systemd and stays quiet: " + calls + r.stdout);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

(async () => {
  await gatewayRoutes();
  if (process.platform === "win32") { console.log("0.7.16 site update checks OK (server scripts skipped on Windows)"); return; }
  runnerScript();
  installer();
  console.log("0.7.16 site update checks OK");
})().catch((e) => { console.error(e); process.exit(1); });
