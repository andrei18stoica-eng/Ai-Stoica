const PAID_PROVIDERS = new Set(["openai","anthropic","openrouter","xai","deepseek","together","fireworks","perplexity","moonshot","zai"]);
// Free for the accounts: the free tiers of these APIs (also through OmniRoute), OpenRouter's ":free" models and the
// OmniRoute services that need no account at all. The Owner can still switch one off per account (permission = false).
const FREE_PROVIDERS = ["cerebras","gemini","groq","cloudflare","mistral","nvidia","github","cohere","huggingface","pollinations","openrouter-free","omniroute-free"];
const KNOWN_PROVIDERS = [...FREE_PROVIDERS, ...PAID_PROVIDERS, "personal"];
// OmniRoute connections made with the Owner's own login, subscription or browser session (Codex, Claude Code, GitHub
// Copilot, Kiro, Grok CLI, Cursor, the "-web" accounts…): their terms forbid sharing the account, so only the Owner uses
// them. Kept in step with PERSONAL_PREFIXES in apps/desktop/local-gateway.cjs (test-0716-shared-access.cjs).
const PERSONAL_PREFIXES = [
  "cx","codex","codex-app-server","cxa","cc","claude","claude-code","gc","grok-cli","gemini-cli","gweb","gemini-web","cgpt-web","chatgpt-web",
  "gh","ghe-copilot","copilot-web","m365copilot","kr","kiro","amazon-q","cu","cursor","kc","kilocode","cl","cline","cp","clinepass",
  "ag","agy","antigravity","tr","trae","dv","dva","devin-cli","devin-desktop","gld","gitlab-duo","cbcn","codebuddy-cn","of","openference",
  "rc","raycast","xao","qw","qwen-code","aug","auggie","zed-hosted","gw","grok-web","zw","zai-web","nw","notion-web","t3chat","ybw","tasw","cnl"
];
// OmniRoute services without an account (Pollinations, Cloudflare Playground, DuckDuckGo AI, Felo…).
const KEYLESS_PREFIXES = ["pol","pollinations","cfp","cloudflare-playground","ddgw","duckduckgo-web","felo","felo-web","veo-free","veoaifree-web","tllm","theoldllm","pepper","chipotle"];
// "github/…" here is GitHub Models (AI Stoica's direct API, free). OmniRoute's own "github" is GitHub Copilot, a
// subscription: the gateway knows the two apart (OmniRoute's list) and stops Copilot before asking here (isPersonalModel).
const PREFIX_PROVIDERS = {
  openai:"openai", anthropic:"anthropic",
  google:"gemini", gemini:"gemini", cerebras:"cerebras", groq:"groq",
  cloudflare:"cloudflare", "@cf":"cloudflare", cf:"cloudflare", "cloudflare-ai":"cloudflare", openrouter:"openrouter",
  mistral:"mistral", nvidia:"nvidia", github:"github", cohere:"cohere", huggingface:"huggingface", hf:"huggingface",
  xai:"xai", grok:"xai", deepseek:"deepseek", ds:"deepseek", together:"together", fireworks:"fireworks",
  perplexity:"perplexity", pplx:"perplexity", moonshot:"moonshot", kimi:"moonshot", zai:"zai", glm:"zai"
};

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function providerSignals(model) {
  const raw = String(model || "").toLowerCase().trim();
  const found = new Set();
  // GPT-OSS is open-weight and never billed by OpenAI: "openai/gpt-oss-…" is Groq's name, "gpt-oss-…" Cerebras'.
  if (/^openai\/gpt[-_. ]?oss/.test(raw)) return ["groq"];
  if (/^gpt[-_. ]?oss/.test(raw)) return ["cerebras"];
  const first = raw.includes("/") ? raw.split("/")[0] : "";
  if (KEYLESS_PREFIXES.includes(first)) return ["omniroute-free"];
  if (PERSONAL_PREFIXES.includes(first) || /-web$/.test(first)) return ["personal"];
  if (raw.endsWith(":free") && (first === "openrouter" || !first)) return ["openrouter-free"];
  if (Object.hasOwn(PREFIX_PROVIDERS, first)) return [PREFIX_PROVIDERS[first]];

  if (/openai|chatgpt/i.test(raw)) found.add("openai");
  if (!/gpt[-_. ]?oss/i.test(raw) && /(^|[\s_.:-])gpt(?:[\s_.:-]|\d)|(^|[\s_.:-])o[134](?:[\s_.:-]|$)/i.test(raw)) found.add("openai");
  if (/anthropic|claude/i.test(raw)) found.add("anthropic");
  if (/gemini|(^|[\s_.:-])google(?:[\s_.:-]|$)/i.test(raw)) found.add("gemini");
  if (/cerebras/i.test(raw)) found.add("cerebras");
  if (/(^|[\s_.:-])groq(?:[\s_.:-]|$)/i.test(raw)) found.add("groq");
  if (/cloudflare|@cf\//i.test(raw)) found.add("cloudflare");
  if (/openrouter/i.test(raw)) found.add("openrouter");

  return [...found];
}

function isManagedPaidAlias(model) {
  const n = normalizeKey(model);
  return n === "ai principal" || n === "ai stoica" || n === "aistoica";
}

function comboForModel(combinations, model) {
  const n = normalizeKey(model);
  return (Array.isArray(combinations) ? combinations : []).find((combo) => {
    if (!combo) return false;
    return normalizeKey(combo.id) === n || normalizeKey(combo.name) === n;
  }) || null;
}

function providerAccess(context, provider) {
  const user = context?.user || {};
  const permissions = context?.permissions || {};
  const paidEnabled = context?.paidEnabled === true;
  const isOwner = user.role === "owner";

  if (!KNOWN_PROVIDERS.includes(provider)) {
    return { allowed: isOwner, reason: isOwner ? "" : "Furnizorul modelului nu este aprobat pentru acest cont." };
  }
  if (provider === "personal") {
    return { allowed: isOwner, reason: isOwner ? "" : "Modelul folosește abonamentul personal al Owner-ului (Codex, Claude Code, Copilot, Kiro, conturi web): condițiile furnizorului nu permit împărțirea contului. Alege un model gratuit din listă." };
  }

  if (PAID_PROVIDERS.has(provider)) {
    if (!isOwner && !paidEnabled) {
      return { allowed:false, reason:"AI-ul plătit este disponibil doar pentru Owner sau pentru conturile cărora Owner le activează explicit accesul." };
    }
    if (!isOwner && permissions[provider] !== true) {
      const label = provider === "openai" ? "OpenAI / GPT" : provider === "anthropic" ? "Claude / Anthropic" : "OpenRouter";
      return { allowed:false, reason:`Contul nu are permisiune pentru ${label}.` };
    }
    return { allowed:true, reason:"" };
  }

  if (!isOwner && permissions[provider] === false) {
    return { allowed:false, reason:`Contul nu are permisiune pentru furnizorul ${provider}.` };
  }
  return { allowed:true, reason:"" };
}

// Owner's per-model choice for one account (Control Center): "allow" opens a model the general permissions keep closed,
// "deny" closes one they leave open. Stored in permissions.model_overrides as { "<model id>": "allow" | "deny" }.
function modelOverride(permissions, model) {
  const map = permissions && typeof permissions.model_overrides === "object" && !Array.isArray(permissions.model_overrides) ? permissions.model_overrides : null;
  if (!map) return "";
  const key = String(model || "").trim().toLowerCase();
  for (const [k, v] of Object.entries(map)) if (String(k).trim().toLowerCase() === key) return v === "allow" || v === "deny" ? v : "";
  return "";
}

function evaluateModelAccess(context, model) {
  const decision = evaluateBase(context, model);
  if (context?.user?.role === "owner") return decision;
  const override = modelOverride(context?.permissions, model);
  if (override === "deny") return { ...decision, allowed:false, source:"override", reason:"Owner-ul a blocat acest model pentru contul tău." };
  // The Owner's own subscriptions (Codex, Claude Code, "-web" accounts…) are never opened by a button.
  if (override === "allow" && context?.permissions?.chat === true && !(decision.providers || []).includes("personal")) return { ...decision, allowed:true, source:"override", reason:"" };
  return decision;
}

function evaluateBase(context, model) {
  const requested = String(model || "").trim();
  const user = context?.user || {};
  const permissions = context?.permissions || {};
  const isOwner = user.role === "owner";

  if (!requested) {
    return { model:requested, allowed:false, providers:[], paidRequired:false, source:"invalid", reason:"Modelul lipsește." };
  }

  if (!isOwner && permissions.chat !== true) {
    return { model:requested, allowed:false, providers:[], paidRequired:false, source:"chat", reason:"Chat AI este dezactivat pentru acest cont." };
  }

  const combo = comboForModel(context?.combinations, requested);
  if (combo) {
    const providers = Array.isArray(combo.providers) ? combo.providers.map(x => String(x).toLowerCase()) : [];
    const paidRequired = combo.paid_required === true || providers.some(p => PAID_PROVIDERS.has(p));
    if (combo.enabled === false) {
      return { model:requested, allowed:false, providers, paidRequired, source:"combination", combinationId:combo.id, reason:"Combinația AI este dezactivată." };
    }
    if (!isOwner && paidRequired && context?.paidEnabled !== true) {
      return { model:requested, allowed:false, providers, paidRequired:true, source:"combination", combinationId:combo.id, reason:"AI-ul plătit este disponibil doar pentru Owner sau pentru conturile cărora Owner le activează explicit accesul." };
    }
    for (const provider of providers) {
      const access = providerAccess(context, provider);
      if (!access.allowed) {
        return { model:requested, allowed:false, providers, paidRequired, source:"combination", combinationId:combo.id, reason:access.reason };
      }
    }
    return { model:requested, allowed:true, providers, paidRequired, source:"combination", combinationId:combo.id, reason:"" };
  }

  if (isManagedPaidAlias(requested)) {
    const providers = ["openai","anthropic"];
    if (!isOwner && context?.paidEnabled !== true) {
      return { model:requested, allowed:false, providers, paidRequired:true, source:"managed_alias", reason:"AI-ul plătit este disponibil doar pentru Owner sau pentru conturile cărora Owner le activează explicit accesul." };
    }
    for (const provider of providers) {
      const access = providerAccess(context, provider);
      if (!access.allowed) {
        return { model:requested, allowed:false, providers, paidRequired:true, source:"managed_alias", reason:access.reason };
      }
    }
    return { model:requested, allowed:true, providers, paidRequired:true, source:"managed_alias", reason:"" };
  }

  const providers = providerSignals(requested);
  if (!providers.length) {
    if (isOwner) {
      return { model:requested, allowed:true, providers:[], paidRequired:false, source:"owner_unknown", reason:"" };
    }
    return {
      model:requested,
      allowed:false,
      providers:[],
      paidRequired:false,
      source:"unknown",
      reason:"Modelul nu are un furnizor verificabil. Accesul este blocat pentru conturile normale."
    };
  }

  const paidRequired = providers.some(p => PAID_PROVIDERS.has(p));
  for (const provider of providers) {
    const access = providerAccess(context, provider);
    if (!access.allowed) {
      return { model:requested, allowed:false, providers, paidRequired, source:"provider", reason:access.reason };
    }
  }
  return { model:requested, allowed:true, providers, paidRequired, source:"provider", reason:"" };
}

module.exports = {
  PAID_PROVIDERS,
  FREE_PROVIDERS,
  KNOWN_PROVIDERS,
  PERSONAL_PREFIXES,
  KEYLESS_PREFIXES,
  normalizeKey,
  providerSignals,
  providerAccess,
  modelOverride,
  evaluateModelAccess
};
