const fs = require("fs");
const path = require("path");
const { startLocalGateway } = require("./local-gateway.cjs");

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const dataDir = process.env.DATA_DIR || "/data";
const env = name => String(process.env[name] || "").trim();

// "Ai principal"/"AI Stoica" are automatic-routing names that the gateway refuses (409); an empty model lets the gateway choose.
function defaultModel() {
  const value = env("AI_STOICA_DEFAULT_MODEL") || env("AI_STOICA_MODEL");
  return /^ai[ _-]*(principal|stoica)$/i.test(value) ? "" : value;
}

const DIRECT_KEYS = {
  cerebrasApiKey: "CEREBRAS_API_KEY", groqApiKey: "GROQ_API_KEY", geminiApiKey: "GEMINI_API_KEY",
  openAiApiKey: "OPENAI_API_KEY", openRouterApiKey: "OPENROUTER_API_KEY", mistralApiKey: "MISTRAL_API_KEY",
  cloudflareAccountId: "CLOUDFLARE_ACCOUNT_ID", cloudflareApiToken: "CLOUDFLARE_API_TOKEN"
};

function getOmniConfig() {
  const model = defaultModel();
  return {
    baseUrl: (env("OMNIROUTE_BASE_URL") || "http://omniroute:20128/v1").replace(/\/+$/, ""),
    apiKey: env("OMNIROUTE_API_KEY"),
    model,
    defaultModel: model,
    speechModel: env("AI_STOICA_SPEECH_MODEL") || "openai/whisper-1",
    speechLanguage: env("AI_STOICA_SPEECH_LANGUAGE") || "ro",
    // Public server: only the first account can sign up unless AI_STOICA_OPEN_REGISTRATION=true.
    allowRegistration: env("AI_STOICA_OPEN_REGISTRATION").toLowerCase() === "true",
    ownerEmail: env("AI_STOICA_OWNER_EMAIL").toLowerCase(),
    controlApiUrl: env("AI_STOICA_CLOUD_API_URL").replace(/\/+$/, ""),
    githubToken: env("AI_STOICA_GITHUB_TOKEN"),
    githubRepo: env("AI_STOICA_GITHUB_REPO"),
    githubBranch: env("AI_STOICA_GITHUB_BRANCH") || "main",
    trustProxy: Number(env("AI_STOICA_TRUST_PROXY") || 1),
    ...Object.fromEntries(Object.entries(DIRECT_KEYS).map(([key, name]) => [key, env(name)]))
  };
}

if (!env("AI_STOICA_OWNER_EMAIL")) console.warn("[AI Stoica] AI_STOICA_OWNER_EMAIL is not set: no account on this server is Owner (GitHub Solve, code run and server tools stay locked).");

// The Docker image builds the web interface into ./web; with it, https://domain/ is AI Stoica in the browser
// and can be installed as an app on iPhone and Android (PWA). AI_STOICA_WEB=false turns it off.
const webDir = path.join(__dirname, "web");
const webEnabled = env("AI_STOICA_WEB").toLowerCase() !== "false" && fs.existsSync(path.join(webDir, "index.html"));

const gateway = startLocalGateway({
  dataDir,
  port,
  host,
  serviceName: "AI Stoica Cloud Gateway",
  getOmniConfig,
  webDir: webEnabled ? webDir : undefined
});

console.log(`AI Stoica Cloud Gateway listening on ${host}:${port}${webEnabled ? " (web interface on)" : ""}`);

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down AI Stoica Cloud Gateway...`);
  const force = setTimeout(() => process.exit(1), 10000);
  force.unref();
  try { await gateway.close(); } finally { process.exit(0); }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
