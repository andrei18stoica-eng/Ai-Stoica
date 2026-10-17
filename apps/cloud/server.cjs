require("./lib/envcompat.cjs");
const fs = require("fs");
const path = require("path");
const { startLocalGateway } = require("./local-gateway.cjs");
const { createServerSettings } = require("./lib/serversettings.cjs");

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const dataDir = process.env.DATA_DIR || "/data";
const env = name => String(process.env[name] || "").trim();

// "Ai principal"/"Serasmart AI" as the default are dropped: an empty model lets the gateway choose, and it picks your first
// OmniRoute combination ("Ai principal" when you have it).
function defaultModel() {
  const value = env("SERASMART_DEFAULT_MODEL") || env("SERASMART_MODEL");
  return /^(ai[ _-]*(principal|stoica)|serasmart([ _-]*ai)?)$/i.test(value) ? "" : value;
}

// Every key the Windows app has in Settings → API-uri AI, so the web version lists the same models and media providers.
const DIRECT_KEYS = {
  cerebrasApiKey: "CEREBRAS_API_KEY", groqApiKey: "GROQ_API_KEY", geminiApiKey: "GEMINI_API_KEY",
  openAiApiKey: "OPENAI_API_KEY", openRouterApiKey: "OPENROUTER_API_KEY", mistralApiKey: "MISTRAL_API_KEY",
  nvidiaApiKey: "NVIDIA_API_KEY", cohereApiKey: "COHERE_API_KEY", hfToken: "HF_TOKEN",
  cloudflareAccountId: "CLOUDFLARE_ACCOUNT_ID", cloudflareApiToken: "CLOUDFLARE_API_TOKEN",
  // Images and video
  pollinationsApiKey: "POLLINATIONS_API_KEY", falApiKey: "FAL_API_KEY", replicateApiToken: "REPLICATE_API_TOKEN",
  togetherApiKey: "TOGETHER_API_KEY", stabilityApiKey: "STABILITY_API_KEY",
  // Grok (xAI): chat, Grok Imagine pictures and video
  xaiApiKey: "XAI_API_KEY"
};

function envConfig() {
  const model = defaultModel();
  return {
    baseUrl: (env("OMNIROUTE_BASE_URL") || "http://omniroute:20128/v1").replace(/\/+$/, ""),
    apiKey: env("OMNIROUTE_API_KEY"),
    model,
    defaultModel: model,
    speechModel: env("SERASMART_SPEECH_MODEL") || "openai/whisper-1",
    speechLanguage: env("SERASMART_SPEECH_LANGUAGE") || "ro",
    // Public server: only the first account can sign up unless SERASMART_OPEN_REGISTRATION=true.
    allowRegistration: env("SERASMART_OPEN_REGISTRATION").toLowerCase() === "true",
    ownerEmail: env("SERASMART_OWNER_EMAIL").toLowerCase(),
    controlApiUrl: env("SERASMART_CLOUD_API_URL").replace(/\/+$/, ""),
    githubToken: env("SERASMART_GITHUB_TOKEN"),
    githubRepo: env("SERASMART_GITHUB_REPO"),
    githubBranch: env("SERASMART_GITHUB_BRANCH") || "main",
    trustProxy: Number(env("SERASMART_TRUST_PROXY") || 1),
    // The model you choose answers; with SERASMART_CHAT_FALLBACK=true the direct APIs answer when it fails.
    chatFallbackOnFailure: env("SERASMART_CHAT_FALLBACK").toLowerCase() === "true",
    // Optional fixed media models, e.g. codex/gpt-5.6-sol (images through the ChatGPT subscription in OmniRoute).
    imageModel: env("SERASMART_IMAGE_MODEL"),
    videoModel: env("SERASMART_VIDEO_MODEL"),
    // Providers left out of the chat (Settings → API-uri AI → Furnizori folosiți). Not set: Cerebras is left out.
    blockedProviders: process.env.SERASMART_BLOCKED_PROVIDERS === undefined ? undefined : env("SERASMART_BLOCKED_PROVIDERS"),
    // OmniRoute combinations the other accounts may use too (Setări → API-uri AI → «Combinații pentru toate conturile»).
    sharedCombos: env("SERASMART_SHARED_COMBOS"),
    // Who makes pictures and videos (Setări → Poze / Video → «Făcute de»). Not set: Gemini only; empty: every provider.
    imageProviders: process.env.SERASMART_IMAGE_PROVIDERS === undefined ? undefined : env("SERASMART_IMAGE_PROVIDERS"),
    videoProviders: process.env.SERASMART_VIDEO_PROVIDERS === undefined ? undefined : env("SERASMART_VIDEO_PROVIDERS"),
    // «Făcute de» is tried first; when those makers fail the other working providers are tried. true: only them.
    mediaStrict: env("SERASMART_MEDIA_STRICT").toLowerCase() === "true",
    // Plans and credits (0.7.22): off until the Owner turns them on. The Owner is never charged.
    creditsEnabled: env("SERASMART_CREDITS").toLowerCase() === "true",
    timeZone: env("SERASMART_TIME_ZONE") || "Europe/Bucharest",
    // Free tier per account and day (the Owner is unlimited): pictures, videos, files. Not set: 3 / 1 / 10.
    freeImagesPerDay: env("SERASMART_FREE_IMAGES"),
    freeVideosPerDay: env("SERASMART_FREE_VIDEOS"),
    freeDocumentsPerDay: env("SERASMART_FREE_DOCUMENTS"),
    ...Object.fromEntries(Object.entries(DIRECT_KEYS).map(([key, name]) => [key, env(name)]))
  };
}

// Settings the Owner changes on the site (Setări) are saved in the data volume and win over the .env values above.
const serverSettings = createServerSettings(dataDir);
const getOmniConfig = () => serverSettings.apply(envConfig());

if (!env("SERASMART_OWNER_EMAIL")) console.warn("[Serasmart AI] SERASMART_OWNER_EMAIL is not set: no account on this server is Owner (GitHub Solve, code run and server tools stay locked).");

// The Docker image builds the web interface into ./web; with it, https://domain/ is Serasmart AI in the browser
// and can be installed as an app on iPhone and Android (PWA). SERASMART_WEB=false turns it off.
const webDir = path.join(__dirname, "web");
const webEnabled = env("SERASMART_WEB").toLowerCase() !== "false" && fs.existsSync(path.join(webDir, "index.html"));

const gateway = startLocalGateway({
  dataDir,
  port,
  host,
  serviceName: "Serasmart Cloud Gateway",
  getOmniConfig,
  webDir: webEnabled ? webDir : undefined,
  // deploy/hetzner: folder shared with the server's update service ("Actualizează site-ul" for the Owner).
  updateDir: env("SERASMART_UPDATE_DIR") || undefined,
  // Setări on the site, for the Owner.
  serverSettings: { publicView: () => serverSettings.publicView(envConfig()), save: (input) => serverSettings.save(input, envConfig()) }
});

console.log(`Serasmart Cloud Gateway listening on ${host}:${port}${webEnabled ? " (web interface on)" : ""}`);

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down Serasmart Cloud Gateway...`);
  const force = setTimeout(() => process.exit(1), 10000);
  force.unref();
  try { await gateway.close(); } finally { process.exit(0); }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
