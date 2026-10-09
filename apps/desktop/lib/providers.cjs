// Free direct AI providers: the models AI Stoica lists for each one and where its free key is created.
// Model lists were checked against each provider's catalog in October 2026. Every list is comma-separated
// in Settings, so a model can be added or removed without a new version.
const DIRECT_MODEL_DEFAULTS = {
  cerebrasModel: "gpt-oss-120b,qwen-3.8-27b",
  groqModel: "llama-3.3-70b-versatile,openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b,llama-3.1-8b-instant",
  geminiModels: "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite",
  mistralModel: "mistral-small-latest,mistral-medium-latest,mistral-large-latest,codestral-latest",
  nvidiaModel: "deepseek-ai/deepseek-v4.1-flash,moonshotai/kimi-k2.6,z-ai/glm-5.3,nvidia/nemotron-3-super-120b-a12b,openai/gpt-oss-20b",
  githubModelsModel: "openai/gpt-4.1-mini,openai/gpt-4.1",
  openRouterChatModel: "AUTO_FREE",
  cloudflareChatModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast,@cf/openai/gpt-oss-120b,@cf/openai/gpt-oss-20b,@cf/meta/llama-4-scout-17b-16e-instruct",
  cohereModel: "command-a-03-2025,command-a-plus-05-2026,command-a-reasoning-08-2025",
  huggingFaceChatModel: "openai/gpt-oss-120b:fastest,meta-llama/Llama-3.3-70B-Instruct,deepseek-ai/DeepSeek-R1",
  openAiChatModels: "gpt-5-mini,gpt-5-nano",
  // Grok (xAI), paid per use; names from the xAI catalog in October 2026, editable in Settings.
  xaiModels: "grok-4.6,grok-4.3"
};

// Single-model defaults shipped up to 0.7.11. A saved value equal to one of these was never chosen by the
// user, so it is upgraded to the new list (meta/llama-3.3-70b-instruct is no longer served by NVIDIA).
const OLD_DIRECT_MODEL_DEFAULTS = {
  cerebrasModel: ["gpt-oss-120b"],
  groqModel: ["llama-3.3-70b-versatile"],
  mistralModel: ["mistral-small-latest"],
  nvidiaModel: ["meta/llama-3.3-70b-instruct"],
  githubModelsModel: ["openai/gpt-4.1-mini"],
  cloudflareChatModel: ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"],
  cohereModel: ["command-a-03-2025"],
  huggingFaceChatModel: ["meta-llama/Llama-3.3-70B-Instruct"]
};

const PROVIDER_KEY_PAGES = {
  cerebras: "https://cloud.cerebras.ai/",
  groq: "https://console.groq.com/keys",
  gemini: "https://aistudio.google.com/apikey",
  mistral: "https://console.mistral.ai/api-keys",
  nvidia: "https://build.nvidia.com/explore/discover",
  github: "https://github.com/settings/personal-access-tokens/new",
  openrouter: "https://openrouter.ai/settings/keys",
  cloudflare: "https://dash.cloudflare.com/profile/api-tokens",
  cohere: "https://dashboard.cohere.com/api-keys",
  huggingface: "https://huggingface.co/settings/tokens",
  openai: "https://platform.openai.com/api-keys",
  xai: "https://console.x.ai/"
};

function upgradeModelDefaults(raw) {
  const out = {};
  for (const [key, olds] of Object.entries(OLD_DIRECT_MODEL_DEFAULTS)) {
    const value = String(raw?.[key] ?? "").trim();
    if (!value || olds.includes(value)) out[key] = DIRECT_MODEL_DEFAULTS[key];
  }
  return out;
}

// Names of OmniRoute combinations, comma-separated ("Ai principal, Gratuit"): what the Owner shares with the other accounts.
function comboNames(value) {
  const seen = new Set(), out = [];
  for (const raw of String(value || "").split(",")) {
    const name = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
    const key = name.toLowerCase();
    if (name && !seen.has(key) && out.length < 40) { seen.add(key); out.push(name); }
  }
  return out.join(",");
}

module.exports = { comboNames, DIRECT_MODEL_DEFAULTS, OLD_DIRECT_MODEL_DEFAULTS, PROVIDER_KEY_PAGES, upgradeModelDefaults };
