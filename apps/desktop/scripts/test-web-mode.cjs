// Web version / installable phone app (PWA): with webDir the service serves the interface and accepts its own origin;
// without webDir (Windows) it stays limited to the AI Stoica window.
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const cfg = { baseUrl: "http://127.0.0.1:65530/v1", model: "test/m", webSearchEnabled: false, githubAutoContext: false, directChatEnabled: false };

// Raw http so the Host header can be a public domain (as behind Caddy).
function request(port, method, p, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) } }, (res) => {
      let data = ""; res.setEncoding("utf8"); res.on("data", (c) => data += c); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-web-"));
  const webDir = path.join(root, "web"); fs.mkdirSync(path.join(webDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(webDir, "index.html"), "<!doctype html><title>AI Stoica</title><div id=root></div>");
  fs.writeFileSync(path.join(webDir, "sw.js"), "self.addEventListener('fetch',()=>{});");
  fs.writeFileSync(path.join(webDir, "assets", "index-abc123.js"), "console.log(1)");
  const site = { host: "ai.example.ro", origin: "https://ai.example.ro" };
  const web = startLocalGateway({ dataDir: path.join(root, "web-data"), port: 8871, host: "0.0.0.0", getOmniConfig: () => cfg, webDir });
  const desk = startLocalGateway({ dataDir: path.join(root, "desk-data"), port: 8872, host: "0.0.0.0", getOmniConfig: () => cfg });
  try {
    let r = await request(8871, "GET", "/", { Host: site.host });
    expect(r.status === 200 && /text\/html/.test(r.headers["content-type"]) && r.body.includes("id=root"), "web: / should serve index.html");
    expect(/frame-src 'self'/.test(r.headers["content-security-policy"]) && /img-src 'self' data: blob: https:/.test(r.headers["content-security-policy"]), "web: interface needs its own CSP: " + r.headers["content-security-policy"]);
    expect(r.headers["cache-control"] === "no-cache", "web: index.html must be re-checked so updates arrive");
    r = await request(8871, "GET", "/assets/index-abc123.js", { Host: site.host });
    expect(r.status === 200 && /immutable/.test(r.headers["cache-control"]), "web: hashed assets should be cached long");
    r = await request(8871, "GET", "/sw.js", { Host: site.host });
    expect(r.status === 200 && r.headers["cache-control"] === "no-cache", "web: service worker must not be cached");

    r = await request(8871, "GET", "/health", { Host: site.host, Origin: site.origin });
    expect(r.status === 200, "web: the page's own origin must be allowed, got " + r.status);
    r = await request(8871, "POST", "/auth/register", { Host: site.host, Origin: site.origin }, { email: "web@example.com", password: "password123", name: "Web" });
    expect(r.status !== 403 && JSON.parse(r.body).token, "web: register from the page's own origin should work: " + r.body);
    r = await request(8871, "GET", "/health", { Host: site.host, Origin: "https://evil.example" });
    expect(r.status === 403, "web: other sites must still be refused, got " + r.status);
    r = await request(8871, "GET", "/nu-exista", { Host: site.host });
    expect(r.status === 404 && /json/.test(r.headers["content-type"]), "web: unknown addresses still answer JSON 404");

    r = await request(8872, "GET", "/", { Host: site.host });
    expect(r.status === 404 && /json/.test(r.headers["content-type"]), "desktop: no interface is served without webDir");
    r = await request(8872, "GET", "/health", { Host: site.host, Origin: site.origin });
    expect(r.status === 403, "desktop: a same-host origin must stay refused without webDir, got " + r.status);

    const renderer = path.join(__dirname, "..", "renderer");
    const manifest = JSON.parse(fs.readFileSync(path.join(renderer, "public", "manifest.webmanifest"), "utf8"));
    expect(manifest.display === "standalone" && manifest.start_url && manifest.icons.length >= 3, "PWA manifest incomplete");
    for (const icon of manifest.icons) expect(fs.existsSync(path.join(renderer, "public", icon.src)), "missing icon " + icon.src);
    expect(fs.existsSync(path.join(renderer, "public", "icons", "apple-touch-icon.png")) && fs.existsSync(path.join(renderer, "public", "sw.js")), "apple-touch-icon or sw.js missing");
    const html = fs.readFileSync(path.join(renderer, "index.html"), "utf8");
    expect(html.includes('rel="manifest"') && html.includes("apple-touch-icon") && /frame-src 'self'/.test(html), "index.html must link the manifest and allow its own frames");
    expect(fs.readFileSync(path.join(renderer, "src", "core.jsx"), "utf8").includes("IS_WEB ? window.location.origin"), "web interface must use its own address as gateway");
    // The web version must have the same models and media providers as Windows: every key in the Windows
    // settings is read by apps/cloud/server.cjs, and every variable it reads reaches the web service on both servers.
    const repo = path.join(__dirname, "..", "..", "..");
    const winKeys = [...new Set(fs.readFileSync(path.join(__dirname, "..", "main.cjs"), "utf8").match(/\b[a-zA-Z]+(?:ApiKey|ApiToken|Token|AccountId)\b/g))];
    const cloudServer = fs.readFileSync(path.join(repo, "apps", "cloud", "server.cjs"), "utf8");
    for (const k of winKeys) expect(new RegExp("\\b" + k + "\\s*:").test(cloudServer), "apps/cloud/server.cjs does not read the Windows key " + k);
    const envNames = [...cloudServer.matchAll(/env\("([A-Z0-9_]+)"\)|:\s*"([A-Z0-9_]+)"/g)].map(m => m[1] || m[2]).filter(n => /_(KEY|TOKEN|ID)$/.test(n));
    for (const compose of [["apps", "cloud", "docker-compose.yml"], ["deploy", "hetzner", "docker-compose.yml"]]) {
      const text = fs.readFileSync(path.join(repo, ...compose), "utf8");
      for (const n of envNames) expect(text.includes(n + ": ${" + n), compose.join("/") + " does not pass " + n + " to the web service");
    }
    console.log("Web mode checks OK");
  } finally {
    await web.close(); await desk.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
