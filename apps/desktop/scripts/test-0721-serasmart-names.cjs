// 0.7.19–0.7.21: the product is Serasmart AI everywhere. The visible name and the domain live in lib/brand.json; since
// 0.7.21 the technical names are Serasmart too (variables, data files, Windows app, server folders, database). The old
// names survive only in the bridges that carry existing data across, listed below.
const fs = require("fs"), os = require("os"), path = require("path"), { execFileSync } = require("child_process");

function expect(v, m) { if (!v) throw new Error(m); }
const root = path.join(__dirname, "..", "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const brand = require("../lib/brand.json");
const OLD = ["AI", "Stoica"].join(" "), OLD_ENV = ["AI", "STOICA", ""].join("_"), OLD_DASH = ["ai", "stoica"].join("-"), OLD_FLAT = "ai" + "stoica";

// 1. One place for the name and the domain.
expect(brand.name === "Serasmart AI" && brand.short === "Serasmart" && brand.domain, "brand.json: " + JSON.stringify(brand));
const lib = require("../lib/brand.cjs");
expect(lib.BRAND_NAME === brand.name && lib.BRAND_SHORT === brand.short && lib.BRAND_DOMAIN === brand.domain, "lib/brand.cjs reads brand.json");
for (const v of [brand.name, brand.short, brand.domain]) expect(read("apps/server/brand.cjs").includes(`"${v}"`), `apps/server/brand.cjs has the default ${v}`);
expect(/import brand from "\.\.\/\.\.\/lib\/brand\.json"/.test(read("apps/desktop/renderer/src/brand.js")), "the interface reads brand.json");
expect(/COPY apps\/desktop\/lib\/brand\.json \.\/lib\/brand\.json/.test(read("apps/cloud/Dockerfile")) && /COPY apps\/server\/brand\.cjs/.test(read("apps/server/Dockerfile")), "the Docker images get the brand files");

// 2. The old names appear only in the bridges (and the domain aistoica.ro, which stays until the launch).
const BRIDGES = new Set([
  "apps/desktop/lib/envcompat.cjs", "apps/desktop/lib/store.cjs", "apps/desktop/main.cjs", "apps/desktop/renderer/src/core.jsx",
  "apps/mobile/app/index.js", "apps/desktop/local-gateway.cjs", "apps/server/ai-policy.cjs", "apps/desktop/lib/memory.cjs", "apps/cloudflare/src/index.js",
  "apps/cloud/docker-compose.yml", "deploy/hetzner/docker-compose.yml", "deploy/hetzner/claude-mcp.override.yml",
  "deploy/hetzner/update.sh", "deploy/hetzner/update-runner.sh", "deploy/hetzner/install-updater.sh", "deploy/hetzner/setup-web.sh", "deploy/hetzner/migrate-to-serasmart.sh",
  "apps/mobile/eas.json", "CLAUDE.md"
]);
const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n")
  .filter((f) => f && !/\.(png|webp|ico|jpe?g|gif|pdf|woff2?|ttf|zip|sqlite)$/i.test(f) && !f.startsWith(".claude/") && !f.endsWith("package-lock.json") && !/\/scripts\/test-/.test(f) && !f.includes("test-worker"));
const stray = [];
for (const f of files) {
  if (BRIDGES.has(f) || !fs.existsSync(path.join(root, f))) continue;
  const lines = read(f).split("\n");
  lines.forEach((line, i) => {
    const clean = line.replace(/aistoica\.ro/g, "").replace(/AI Stoica Performance Max/g, "").replace(/andrei18stoica/g, "");
    if (clean.includes(OLD) || clean.includes(OLD_ENV) || clean.toLowerCase().includes(OLD_DASH) || clean.toLowerCase().includes(OLD_FLAT) || /Stoica Enterprises/i.test(clean))
      stray.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
  });
}
expect(!stray.length, "old names outside the bridges:\n" + stray.slice(0, 40).join("\n"));

// 3. The bridges work.
// The data file: ai-stoica-data.json becomes serasmart-data.json, with its backup, nothing lost.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "names-"));
  fs.writeFileSync(path.join(dir, `${OLD_DASH}-data.json`), JSON.stringify({ users: [{ id: "u1", email: "a@b.ro" }] }));
  fs.writeFileSync(path.join(dir, `${OLD_DASH}-data.json.bak`), "{}");
  const { createStore } = require("../lib/store.cjs");
  const store = createStore(dir);
  expect(store.read().users[0]?.email === "a@b.ro" && fs.existsSync(path.join(dir, "serasmart-data.json")) && fs.existsSync(path.join(dir, "serasmart-data.json.bak")) && !fs.existsSync(path.join(dir, `${OLD_DASH}-data.json`)), "the data file is renamed with its backup");
  fs.rmSync(dir, { recursive: true, force: true });
}
// The server variables: an old .env still works, a new value wins.
{
  const { applyEnvCompat } = require("../lib/envcompat.cjs");
  const env = applyEnvCompat({ [OLD_ENV + "OWNER_EMAIL"]: "old@x.ro", [OLD_ENV + "CHAT_FALLBACK"]: "true", SERASMART_CHAT_FALLBACK: "false" });
  expect(env.SERASMART_OWNER_EMAIL === "old@x.ro" && env.SERASMART_CHAT_FALLBACK === "false", "AI_STOICA_* fill SERASMART_* when it is not set");
  expect(/require\("\.\/envcompat\.cjs"\)/.test(read("apps/desktop/lib/brand.cjs")) && /^require\("\.\/lib\/envcompat\.cjs"\)/.test(read("apps/cloud/server.cjs")), "the services load the bridge first");
  for (const f of ["apps/cloud/docker-compose.yml", "deploy/hetzner/docker-compose.yml"]) {
    const plain = read(f).match(/\$\{SERASMART_[A-Z0-9_]+(?::?-[^$}]*)?\}/g) || [];
    expect(!plain.length, `${f}: every SERASMART_ variable falls back to the old name: ${plain.slice(0, 3)}`);
  }
}
// The Windows app: new name and id, the old data folder is copied once, and the installer upgrades the old app in place.
{
  const pkg = JSON.parse(read("apps/desktop/package.json"));
  expect(pkg.build.productName === "Serasmart AI" && pkg.build.appId === "ro.serasmart.ai" && pkg.name === "serasmart-desktop", "Windows app name and id");
  const { UUID } = require("builder-util-runtime");
  const oldGuid = UUID.v5("ro.stoica." + OLD_FLAT, UUID.parse("50e065bc-3134-11e6-9bab-38c9862bdaf3"));
  expect(pkg.build.nsis.guid === oldGuid, "the installer keeps the old install GUID, so the update replaces the old app instead of installing a second one");
  const main = read("apps/desktop/main.cjs");
  expect(main.includes(`LEGACY_DATA_DIR_NAME = "${OLD}"`) && /migrateLegacyDataDir\(\);\s*\n\s*const gotSingleInstanceLock/.test(main) && /fs\.cpSync\(legacy, target/.test(main), "the old data folder is copied before the app starts");
}
// The browser and the phone: the saved login and settings move to the new key names.
expect(read("apps/desktop/renderer/src/core.jsx").includes('key.startsWith("aiStoica")') && read("apps/desktop/renderer/src/core.jsx").includes(`key.startsWith("${OLD_DASH}-")`), "browser keys move to the new names");
expect(/LEGACY_TOKEN_KEY="aiStoicaMobileTokenV4"/.test(read("apps/mobile/app/index.js")), "the phone app keeps its login");
// Saved conversations point to their pictures with the old prefix: still read.
expect(read("apps/desktop/local-gateway.cjs").includes(`LEGACY_LIBRARY_REF="${OLD_FLAT}-library://"`) && /libraryRefId\(url\)/.test(read("apps/desktop/local-gateway.cjs")), "old picture references in conversations still open");
// The server: scripts find the checkout where it is, move the shared folder and the services, and the one-time move.
for (const f of ["update.sh", "update-runner.sh", "install-updater.sh"]) expect(/BASH_SOURCE\[0\]/.test(read("deploy/hetzner/" + f)), `${f} finds its own checkout`);
const inst = read("deploy/hetzner/install-updater.sh");
expect(inst.includes(`/var/lib/${OLD_DASH}-update`) && inst.includes(`${OLD_DASH}-update.path`) && /ln -s "\$DIR" "\$LEGACY_DIR"/.test(inst), "the update button's folder and services move to the new names");
const mig = read("deploy/hetzner/migrate-to-serasmart.sh");
expect(/pg_dumpall/.test(mig) && /ALTER DATABASE \$OLD_NAME RENAME TO \$NEW_NAME/.test(mig) && /ALTER ROLE \$OLD_NAME RENAME TO \$NEW_NAME/.test(mig) && /APPLY=0/.test(mig) && /usermod -l/.test(mig), "the one-time server move: backup first, database, user, dry run by default");
execFileSync("bash", ["-n", path.join(root, "deploy/hetzner/migrate-to-serasmart.sh")]);

// 4. The default assistants saved under the old name take the new one when the service starts.
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brand-"));
  try {
    fs.writeFileSync(path.join(dir, "serasmart-data.json"), JSON.stringify({ users: [], assistants: [
      { id: "a1", userId: "u1", name: OLD, builtIn: true, systemPrompt: `Ești ${OLD}, asistentul principal ${OLD}. Răspunde clar.` },
      { id: "a2", userId: "u1", name: `${OLD} Code`, codeAssistant: true },
      { id: "a3", userId: "u1", name: "Contabil", systemPrompt: "x" }
    ] }));
    const { startLocalGateway } = require("../local-gateway.cjs");
    const gw = startLocalGateway({ dataDir: dir, port: 8886, host: "127.0.0.1", getOmniConfig: () => ({}) });
    await new Promise((r) => setTimeout(r, 200));
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "serasmart-data.json"), "utf8")).assistants;
    await gw.close();
    expect(saved[0].name === "Serasmart AI" && /^Ești Serasmart AI, asistentul AI principal/.test(saved[0].systemPrompt), "the default assistant: " + JSON.stringify(saved[0]));
    expect(saved[1].name === "Serasmart Code" && saved[2].name === "Contabil", "the Code assistant is renamed, the user's own are not");
    console.log("0.7.21 Serasmart names OK");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exit(1); });
