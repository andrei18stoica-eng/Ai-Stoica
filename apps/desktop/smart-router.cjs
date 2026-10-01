function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isSmartAlias(value) {
  const n = normalize(value).replace(/[^a-z0-9]+/g, " ").trim();
  return n === "ai principal" || n === "ai stoica" || n === "aistoica" ||
    n === "auto" || n === "smart" || n === "smart router";
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (part && part.type === "text") return String(part.text || "");
    return "";
  }).filter(Boolean).join("\n");
}

function hasImage(messages) {
  return (Array.isArray(messages) ? messages : []).some((message) =>
    Array.isArray(message && message.content) && message.content.some((part) =>
      part && (part.type === "image_url" || part.type === "input_image" || !!part.image_url)
    )
  );
}

function latestUserText(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const latest = [...list].reverse().find((m) => m && m.role === "user");
  return contentText(latest && latest.content);
}

function classifyTask(messages) {
  const raw = latestUserText(messages);
  const t = normalize(raw);
  const image = hasImage(messages);
  const reasons = [];

  if (image) {
    reasons.push("mesajul conține imagine");
    return { task: "vision", reasons, text: raw };
  }

  const codeSignals = /(cod|code|program|javascript|typescript|python|java\b|c\+\+|c#|react|node\.?js|sql\b|bug|debug|github|docker|linux|powershell|bash|html|css|functie|function|algoritm|repository|commit|script)/;
  const apiCoding = /(creeaz|creaz|scrie|implementeaz|integreaz|conecteaz|endpoint|request|fetch|rest|graphql).*\bapi\b|\bapi\b.*(cod|endpoint|integra|request|fetch|autent)/;
  const mathSignals = /(matematic|calcul|ecuat|inecuat|integral|derivat|geometr|algebr|probabilit|statistic|demonstreaz|dovedeste|teorema|radical|fract|logaritm|trigonom|limita|matrice|vector|reasoning|logic|rationament)/;
  const legalSignals = /(juridic|legea|lege |articolul|contract|achizit|hotarare|sentinta|instanta|primarie|consiliul local|ordonanta|cod administrativ|aviz|adresa oficiala|act aditional|procedura|legalitate|contestatie|autoritate|urbanism)/;
  const researchSignals = /(cauta|cautare|research|documenteaza|surse|verifica pe internet|comparatie|compara|analiza comparativa|studiu|investigheaza|ultimele informatii|actualizat|noutati|informatii recente)/;
  const creativeSignals = /(scrie (o |un )?(poveste|poezie|scenariu|discurs|mesaj|urare)|creativ|slogan|nume de brand|campanie|idee de|brainstorm|story|poem|copywriting)/;
  const documentSignals = /(document|pdf|docx|word|contract|raport|proiect|fisier|atasament|capitol|rezumat|\bsinteza\b|analizeaza acest|analizeaza documentul)/;

  if (codeSignals.test(t) || apiCoding.test(t) || /\x60\x60\x60[\s\S]{20,}\x60\x60\x60/.test(raw)) {
    reasons.push("cerere de programare/cod");
    return { task: "coding", reasons, text: raw };
  }
  if (mathSignals.test(t) || /(?:\d+\s*[+\-*/^=]\s*\d+)|(?:[xyz]\s*[=<>])/.test(t)) {
    reasons.push("cerere de matematică/logică");
    return { task: "reasoning", reasons, text: raw };
  }
  if (legalSignals.test(t)) {
    reasons.push("cerere juridică/administrativă");
    return { task: "legal_analysis", reasons, text: raw };
  }
  if (raw.length > 5000 || documentSignals.test(t)) {
    reasons.push(raw.length > 5000 ? "context lung" : "analiză de document");
    return { task: "long_context", reasons, text: raw };
  }
  if (researchSignals.test(t)) {
    reasons.push("cerere de cercetare/comparație");
    return { task: "research", reasons, text: raw };
  }
  if (creativeSignals.test(t)) {
    reasons.push("cerere creativă");
    return { task: "creative", reasons, text: raw };
  }

  const simpleSignals = /^(ce este|ce inseamna|cine este|cat este|cat face|tradu|corecteaza|reformuleaza|da-mi|spune-mi|salut|buna|multumesc)/;
  if (t.length <= 180 && simpleSignals.test(t)) {
    reasons.push("cerere scurtă și directă");
    return { task: "fast", reasons, text: raw };
  }

  reasons.push("cerere generală");
  return { task: "general", reasons, text: raw };
}

function inferProvider(entry) {
  const explicit = normalize(entry && entry.provider || "");
  if (explicit) return explicit;
  const id = normalize(typeof entry === "string" ? entry : entry && entry.id);
  const first = id.split("/")[0];
  const prefixMap = {
    openai:"openai", anthropic:"anthropic", google:"gemini", gemini:"gemini",
    cerebras:"cerebras", groq:"groq", cloudflare:"cloudflare",
    openrouter:"openrouter", "@cf":"cloudflare"
  };
  if (prefixMap[first]) return prefixMap[first];
  if (/groq/.test(id)) return "groq";
  if (/cerebras/.test(id)) return "cerebras";
  if (/cloudflare|@cf\//.test(id)) return "cloudflare";
  if (/openrouter/.test(id)) return "openrouter";
  if (/claude|anthropic/.test(id)) return "anthropic";
  if (/gemini|google/.test(id)) return "gemini";
  if (/openai|codex|\bo[134]\b/.test(id) || (!/gpt[-_. ]?oss/.test(id) && /gpt/.test(id))) return "openai";
  return "";
}

function isChatModel(entry) {
  const id = normalize(typeof entry === "string" ? entry : entry && entry.id);
  if (!id || isSmartAlias(id)) return false;
  if (/(whisper|speech|transcri|embedding|rerank|moderation|tts|text-to-speech)/.test(id)) return false;
  if (/(image|imagen|flux|sdxl|stable diffusion|dall-e|gpt-image|video|runway|kling|veo|sora|seedance|hailuo)/.test(id)) return false;
  return true;
}

function scoreModel(entry, task) {
  const id = normalize(typeof entry === "string" ? entry : entry && entry.id);
  const meta = normalize(JSON.stringify(entry || {}));
  const provider = inferProvider(entry);
  let score = 0;

  if (/gpt-5|gpt5/.test(id)) score += 95;
  if (/claude.*opus/.test(id)) score += 95;
  if (/claude.*sonnet/.test(id)) score += 88;
  if (/gemini.*pro/.test(id)) score += 84;
  if (/gpt-4\.1|gpt-4o/.test(id)) score += 78;
  if (/gpt-oss-120b|120b/.test(id)) score += 68;
  if (/70b|72b|large/.test(id)) score += 52;
  if (/(^|[\/_.:-])(flash|mini|small|instant|turbo)(?:[\/_.:-]|$)/.test(id)) score += 18;

  const add = (rx, n) => { if (rx.test(id + " " + meta)) score += n; };

  if (task === "coding") {
    add(/codex|coder|codestral|deepseek.*coder|qwen.*coder/, 125);
    add(/claude.*(sonnet|opus)/, 92);
    add(/gpt-5|gpt-4\.1/, 88);
    add(/gemini.*pro/, 76);
    add(/gpt-oss-120b|120b/, 50);
    if (provider === "groq" || provider === "cerebras") score += 12;
  } else if (task === "reasoning") {
    add(/\bo3\b|\bo4\b|reason|thinking|deepseek.*r1|qwen.*(r1|reason)/, 125);
    add(/gpt-5/, 100);
    add(/claude.*(opus|sonnet)/, 90);
    add(/gemini.*pro/, 86);
    add(/gpt-oss-120b|120b/, 60);
  } else if (task === "legal_analysis") {
    add(/claude.*(opus|sonnet)/, 105);
    add(/gpt-5|gpt-4\.1/, 96);
    add(/gemini.*pro/, 88);
    add(/long|context|1m|2m/, 45);
  } else if (task === "long_context") {
    add(/gemini.*pro|gemini.*1\.5|gemini.*2/, 110);
    add(/claude.*(opus|sonnet)/, 105);
    add(/gpt-5|gpt-4\.1/, 92);
    add(/long|context|1m|2m|million/, 55);
  } else if (task === "research") {
    add(/gemini.*pro/, 102);
    add(/gpt-5|gpt-4\.1/, 94);
    add(/claude.*(opus|sonnet)/, 88);
    add(/search|research|ground|web/, 45);
  } else if (task === "creative") {
    add(/claude.*(opus|sonnet)/, 108);
    add(/gpt-5|gpt-4o/, 98);
    add(/gemini.*pro/, 84);
  } else if (task === "vision") {
    add(/gpt-5|gpt-4o|vision/, 115);
    add(/gemini/, 108);
    add(/claude.*(opus|sonnet)/, 96);
    add(/multimodal|vision|image input/, 55);
  } else if (task === "fast") {
    if (provider === "groq") score += 125;
    if (provider === "cerebras") score += 118;
    add(/flash|instant|turbo|mini/, 100);
    add(/gpt-oss-120b|120b/, 35);
  } else {
    add(/gpt-5/, 105);
    add(/claude.*(opus|sonnet)/, 100);
    add(/gemini.*pro/, 88);
    add(/gpt-oss-120b|120b/, 58);
    if (provider === "cerebras" || provider === "groq") score += 20;
  }

  if (/chat|instruct|assistant/.test(meta)) score += 8;
  if (/preview|experimental|deprecated/.test(meta)) score -= 18;

  return { score, provider };
}

function rankModels(entries, task, limit = 6) {
  const rows = (Array.isArray(entries) ? entries : [])
    .filter(isChatModel)
    .map((entry) => {
      const id = String(typeof entry === "string" ? entry : entry && entry.id || "").trim();
      const scored = scoreModel(entry, task);
      return { id, provider: scored.provider, score: scored.score, entry };
    })
    .filter((x) => x.id)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return rows.slice(0, Math.max(1, limit));
}

function routeQuestion(entries, messages, limit = 6) {
  const classification = classifyTask(messages);
  const ranked = rankModels(entries, classification.task, limit);
  return {
    task: classification.task,
    reasons: classification.reasons,
    selectedModel: ranked[0] ? ranked[0].id : "",
    candidates: ranked
  };
}

module.exports = {
  normalize,
  isSmartAlias,
  contentText,
  latestUserText,
  classifyTask,
  inferProvider,
  isChatModel,
  scoreModel,
  rankModels,
  routeQuestion
};
