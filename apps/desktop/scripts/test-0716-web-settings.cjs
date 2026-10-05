// 0.7.16, at the Owner's request: on the web site the Owner manages the settings (keys, OmniRoute, models, pictures,
// video, providers) from Setări, like in Windows. They are saved on the server (lib/serversettings.cjs) over .env.
const fs = require("fs"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");
const { createServerSettings, SECRET_KEYS, MASK } = require("../lib/serversettings.cjs");

function expect(v, m) { if (!v) throw new Error(m); }

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-websettings-"));
  // What deploy/hetzner/.env gives apps/cloud/server.cjs.
  const envConfig = () => ({ baseUrl: "http://127.0.0.1:9/v1", apiKey: "sk-omni-env", model: "", ownerEmail: "owner@example.com", allowRegistration: true,
    webSearchEnabled: false, githubAutoContext: false, openAiApiKey: "sk-openai-env", groqApiKey: "", videoCostPolicy: undefined });
  const settings = createServerSettings(path.join(root, "data"));
  const getOmniConfig = () => settings.apply(envConfig());
  const gw = startLocalGateway({ dataDir: path.join(root, "data"), port: 8879, host: "127.0.0.1", getOmniConfig,
    serverSettings: { publicView: () => settings.publicView(envConfig()), save: (input) => settings.save(input, envConfig()) } });
  const win = startLocalGateway({ dataDir: path.join(root, "win"), port: 8880, host: "127.0.0.1", getOmniConfig: envConfig });
  const call = (port, p, token, method = "GET", body) => fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const register = async (port, email) => (await (await call(port, "/auth/register", null, "POST", { email, password: "password123", name: email })).json()).token;
  try {
    const owner = await register(8879, "owner@example.com"), user = await register(8879, "ana@example.com");

    let r = await call(8879, "/api/server/settings", user);
    expect(r.status === 403, "another account must not read the server settings: " + r.status);
    r = await call(8879, "/api/server/settings", user, "PUT", { openAiApiKey: "sk-stolen" });
    expect(r.status === 403 && settings.read().openAiApiKey === undefined, "another account must not change them");

    r = await call(8879, "/api/server/settings", owner); let j = await r.json();
    expect(r.status === 200 && j.data.openAiApiKey === MASK && j.data.apiKey === MASK && j.data.groqApiKey === "" && j.data.serverSettings === true, "the Owner sees the settings, keys masked: " + JSON.stringify(j).slice(0, 300));
    expect(!JSON.stringify(j).includes("sk-openai-env") && !JSON.stringify(j).includes("sk-omni-env"), "no key may leave the server in clear");
    expect(!("ownerEmail" in j.data) && !("allowRegistration" in j.data), "the Owner email and sign-up rules stay in .env");

    // Save: new key, paid video allowed, Cerebras and Groq left out; a masked key keeps its value; .env-only fields ignored.
    r = await call(8879, "/api/server/settings", owner, "PUT", { ...j.data, xaiApiKey: " xai-new-key ", videoCostPolicy: "allow_paid", blockedProviders: "cerebras, GROQ ,bad value!", imageProviderMode: "nonsense", ownerEmail: "evil@example.com", allowRegistration: true, baseUrl: "javascript:alert(1)" });
    j = await r.json();
    expect(r.status === 200 && j.ok && j.config.xaiApiKey === MASK, "the Owner saves: " + JSON.stringify(j).slice(0, 300));
    let cfg = getOmniConfig();
    expect(cfg.xaiApiKey === "xai-new-key" && cfg.openAiApiKey === "sk-openai-env" && cfg.apiKey === "sk-omni-env", "new key saved without spaces, masked keys kept: " + JSON.stringify({ x: cfg.xaiApiKey, o: cfg.openAiApiKey }));
    expect(cfg.videoCostPolicy === "allow_paid" && cfg.blockedProviders === "cerebras,groq", "settings applied over .env: " + JSON.stringify({ v: cfg.videoCostPolicy, b: cfg.blockedProviders }));
    expect(cfg.ownerEmail === "owner@example.com" && cfg.allowRegistration === true && cfg.baseUrl === "http://127.0.0.1:9/v1" && cfg.imageProviderMode === undefined, "Owner email, sign-up, an invalid address and an invalid choice are not taken");
    if (process.platform !== "win32") expect((fs.statSync(settings.file).mode & 0o777) === 0o600, "the settings file is readable only by the service");
    // Only what differs from .env is stored: a later change in .env (here the OmniRoute address) still applies.
    expect(!("baseUrl" in settings.read()) && !("model" in settings.read()) && !("webSearchEnabled" in settings.read()), "unchanged settings must not be pinned in the file: " + Object.keys(settings.read()).join(","));

    // A key that came from .env can be removed from the site.
    r = await call(8879, "/api/server/settings", owner, "PUT", { openAiApiKey: "__CLEAR__" });
    expect(r.status === 200 && getOmniConfig().openAiApiKey === "" && (await r.json()).config.openAiApiKey === "", "a key from .env can be removed");
    // The gateway uses the change right away (no 2-second wait): Groq is gone from the model list's direct APIs.
    r = await call(8879, "/api/server/settings", owner, "PUT", { groqApiKey: "gsk-test", blockedProviders: "" , directChatEnabled: true });
    const realFetch = globalThis.fetch;
    const models = await (await realFetch("http://127.0.0.1:8879/api/models", { headers: { authorization: "Bearer " + owner } })).json();
    expect((models.data || []).some((x) => /^groq\//.test(x.id || x)), "a key saved on the site is used at once: " + JSON.stringify(models).slice(0, 200));

    // Windows keeps its own settings in the app: no such route there.
    const winOwner = await register(8880, "owner@example.com");
    r = await call(8880, "/api/server/settings", winOwner);
    expect(r.status === 404, "the Windows gateway has no server settings route: " + r.status);

    // Same secret keys as the Windows app, and the cloud server reads the saved settings.
    const mainSrc = fs.readFileSync(path.join(__dirname, "..", "main.cjs"), "utf8");
    const winKeys = JSON.parse(mainSrc.match(/const SECRET_KEYS = (\[[^\]]*\])/)[1]);
    expect(JSON.stringify([...winKeys].sort()) === JSON.stringify([...SECRET_KEYS].sort()), "lib/serversettings.cjs and main.cjs must list the same keys");
    const serverSrc = fs.readFileSync(path.join(__dirname, "..", "..", "cloud", "server.cjs"), "utf8");
    expect(/createServerSettings\(dataDir\)/.test(serverSrc) && /serverSettings\.apply\(envConfig\(\)\)/.test(serverSrc) && /serverSettings\.save\(input, envConfig\(\)\)/.test(serverSrc), "apps/cloud/server.cjs must use the saved settings");
  } finally {
    await gw.close(); await win.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("0.7.16 web settings for the Owner OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
