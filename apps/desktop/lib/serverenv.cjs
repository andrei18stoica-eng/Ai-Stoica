// "Copiază cheile pentru server": Settings shows saved keys masked, so the Owner moving to the server copies them
// as .env lines that deploy/hetzner/setup-web.sh accepts. Names are the ones apps/cloud/server.cjs reads.
const SERVER_ENV = {
  apiKey: "OMNIROUTE_API_KEY",
  cerebrasApiKey: "CEREBRAS_API_KEY", groqApiKey: "GROQ_API_KEY", geminiApiKey: "GEMINI_API_KEY",
  openAiApiKey: "OPENAI_API_KEY", openRouterApiKey: "OPENROUTER_API_KEY", mistralApiKey: "MISTRAL_API_KEY",
  nvidiaApiKey: "NVIDIA_API_KEY", cohereApiKey: "COHERE_API_KEY", hfToken: "HF_TOKEN",
  cloudflareAccountId: "CLOUDFLARE_ACCOUNT_ID", cloudflareApiToken: "CLOUDFLARE_API_TOKEN", githubToken: "AI_STOICA_GITHUB_TOKEN",
  pollinationsApiKey: "POLLINATIONS_API_KEY", falApiKey: "FAL_API_KEY", replicateApiToken: "REPLICATE_API_TOKEN",
  togetherApiKey: "TOGETHER_API_KEY", stabilityApiKey: "STABILITY_API_KEY"
};

// Docker Compose reads .env literally: a value with spaces, quotes, "$", "#" or backslashes is left out and named.
const ENV_SAFE = /^[^\s$#"'`\\]+$/;

function serverEnvLines(cfg = {}) {
  const lines = [], skipped = [];
  for (const [key, name] of Object.entries(SERVER_ENV)) {
    const value = String(cfg[key] || "").trim();
    if (!value) continue;
    if (ENV_SAFE.test(value)) lines.push(`${name}=${value}`);
    else skipped.push(name);
  }
  return { text: lines.length ? lines.join("\n") + "\n" : "", count: lines.length, skipped };
}

module.exports = { SERVER_ENV, serverEnvLines };
