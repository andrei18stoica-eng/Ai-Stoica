const PAID_PROVIDERS = new Set(["openai","anthropic","openrouter"]);
const KNOWN_PROVIDERS = ["cerebras","gemini","groq","cloudflare","openrouter","openai","anthropic"];

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
  const first = raw.split("/")[0];
  const prefixMap = {
    openai:"openai", anthropic:"anthropic", claude:"anthropic",
    google:"gemini", gemini:"gemini", cerebras:"cerebras", groq:"groq",
    cloudflare:"cloudflare", "@cf":"cloudflare", openrouter:"openrouter"
  };
  if (prefixMap[first]) return [prefixMap[first]];

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
  return n === "ai principal" ||
    n === "ai stoica" ||
    n === "aistoica" ||
    n.startsWith("ai principal ") ||
    n.startsWith("ai stoica ");
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

  if (PAID_PROVIDERS.has(provider)) {
    if (!isOwner && !paidEnabled) {
      return { allowed:false, reason:"Serviciile AI plătite nu sunt activate de Owner pentru acest cont." };
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

function evaluateModelAccess(context, model) {
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
      return { model:requested, allowed:false, providers, paidRequired:true, source:"combination", combinationId:combo.id, reason:"Combinația folosește AI plătit, iar accesul nu este activat de Owner pentru acest cont." };
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
      return { model:requested, allowed:false, providers, paidRequired:true, source:"managed_alias", reason:"AI principal / AI Stoica poate include servicii plătite, iar accesul nu este activat de Owner pentru acest cont." };
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
  KNOWN_PROVIDERS,
  normalizeKey,
  providerSignals,
  providerAccess,
  evaluateModelAccess
};
