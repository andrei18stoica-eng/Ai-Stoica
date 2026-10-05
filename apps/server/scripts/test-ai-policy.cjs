const { evaluateModelAccess } = require("../ai-policy.cjs");

function expect(condition, message) {
  if (!condition) throw new Error(message);
}
const combos=[
  {id:"free-mix",name:"Free Mix",providers:["cerebras","gemini","groq","cloudflare"],paid_required:false,enabled:true},
  {id:"gpt-claude",name:"GPT + Claude",providers:["openai","anthropic"],paid_required:true,enabled:true},
  {id:"gpt-claude-gemini",name:"GPT + Claude + Gemini",providers:["openai","anthropic","gemini"],paid_required:true,enabled:true}
];
const defaults={
  chat:true,cerebras:true,gemini:true,groq:true,cloudflare:true,openrouter:false,
  openai:false,anthropic:false
};
function ctx({role="user",paidEnabled=true,personalPaid=false,permissions={}}={}) {
  return {user:{role},paidEnabled,personalPaid,permissions:{...defaults,...permissions},combinations:combos};
}
function allowed(context, model){return evaluateModelAccess(context,model).allowed}
function deniedReason(context, model){const r=evaluateModelAccess(context,model);expect(!r.allowed,model+" should be denied");return r.reason}

expect(allowed(ctx(),"groq/llama-3.3-70b-versatile"),"Groq free model should be allowed");
expect(allowed(ctx(),"Free Mix"),"Free Mix should be allowed");
expect(allowed(ctx(),"cerebras/gpt-oss-120b"),"Cerebras GPT-OSS should remain a free-provider model");
expect(allowed(ctx(),"groq/openai/gpt-oss-120b"),"Groq-hosted GPT-OSS must use Groq permission, not OpenAI permission");
expect(!allowed(ctx(),"openai/gpt-5"),"OpenAI must be blocked by default");
expect(!allowed(ctx(),"anthropic/claude-sonnet"),"Claude must be blocked by default");
expect(!allowed(ctx(),"GPT + Claude"),"Paid combination must be blocked by default");
expect(!allowed(ctx(),"Ai principal"),"Legacy direct Ai principal route must remain blocked without paid permissions");
expect(!allowed(ctx(),"AI Stoica"),"Legacy direct AI Stoica route must remain blocked without paid permissions");
expect(!allowed(ctx(),"mystery-model"),"Unknown model must fail closed for normal users");
expect(!allowed(ctx(),"openrouter/auto"),"OpenRouter auto must be blocked by default because it can incur costs");
expect(allowed(ctx({permissions:{openrouter:true}}),"openrouter/meta-llama/llama-3.3"),"OpenRouter requires explicit permission when paid AI is enabled");

expect(allowed(ctx({permissions:{openai:true}}),"openai/gpt-5"),"Explicit OpenAI permission should allow GPT when paid AI is on");
expect(!allowed(ctx({permissions:{openai:true}}),"Ai principal"),"Legacy direct Ai principal must still require all paid-provider permissions");
expect(allowed(ctx({permissions:{openai:true,anthropic:true}}),"Ai principal"),"Legacy direct Ai principal may work only when all required paid permissions are granted");
expect(allowed(ctx({permissions:{openai:true,anthropic:true}}),"GPT + Claude"),"Paid combination should work with both permissions");

expect(!allowed(ctx({paidEnabled:false,permissions:{openai:true,anthropic:true}}),"openai/gpt-5"),"Global paid switch must override individual OpenAI permission");
expect(allowed(ctx({role:"owner",paidEnabled:false}),"openai/gpt-5"),"Owner must retain OpenAI access when paid AI is off for other accounts");
expect(allowed(ctx({role:"owner",paidEnabled:false}),"anthropic/claude-sonnet"),"Owner must retain Anthropic access");
expect(allowed(ctx({role:"owner",paidEnabled:false}),"GPT + Claude"),"Owner must retain paid combinations");
expect(allowed(ctx({role:"owner",paidEnabled:false}),"mystery-model"),"Owner may use unknown non-classified models");
expect(!allowed(ctx({permissions:{chat:false}}),"groq/llama-3.3-70b-versatile"),"Chat permission must be enforced");
expect(!allowed(ctx({permissions:{chat:false}}),"Ai principal"),"Legacy direct alias must still obey the chat permission");
const disabledCtx=ctx({permissions:{openai:true,anthropic:true}});
disabledCtx.combinations=[...combos,{id:"disabled-paid",name:"Disabled Paid",providers:["openai"],paid_required:true,enabled:false}];
expect(!allowed(disabledCtx,"disabled-paid"),"Disabled combination must stay blocked even when provider permission exists");

expect(allowed(ctx({paidEnabled:false}),"openai/gpt-oss-120b"),"Groq-named GPT-OSS is a free open-weight model, not paid OpenAI");
expect(!allowed(ctx({paidEnabled:false,permissions:{groq:false}}),"openai/gpt-oss-120b"),"Groq-named GPT-OSS obeys the Groq permission");
expect(allowed(ctx({paidEnabled:false}),"gpt-oss-120b"),"Bare GPT-OSS (Cerebras naming) is free");
expect(!allowed(ctx(),"openai/gpt-5-oss-like"),"Real OpenAI models stay paid");
expect(!allowed(ctx(),"constructor/x"),"Prototype keys are not providers");
expect(evaluateModelAccess(ctx({role:"owner"}),"constructor/x").providers.every(p=>typeof p==="string"),"Providers are always strings");
expect(evaluateModelAccess(ctx(),"AI Stoica Performance Max").source==="unknown","Only the exact legacy alias names count as the paid managed alias");
// 0.7.17: paid access of the account itself (paid, or offered by the Owner with the button) opens GPT, Claude and the
// paid combinations without the global switch and without per-provider permissions; free models need none of it.
{
  const paid=ctx({paidEnabled:false,personalPaid:true});
  for(const m of ["openai/gpt-5","anthropic/claude-sonnet","GPT + Claude","Ai principal","openrouter/auto","groq/llama-3.3-70b-versatile"])expect(allowed(paid,m),"paid access must allow "+m);
  const free=ctx({paidEnabled:false});
  expect(/abonament sau acces oferit de Owner/.test(deniedReason(free,"openai/gpt-5"))&&/abonament/.test(deniedReason(free,"GPT + Claude")),"without paid access the reason must say how to get it");
  expect(allowed(free,"groq/llama-3.3-70b-versatile")&&allowed(free,"Free Mix"),"free models need no paid access");
}
// The other free providers (direct APIs and OmniRoute's free web video) work for every approved account too.
for(const m of ["mistral/mistral-small-latest","nvidia/meta/llama-3.3-70b-instruct","huggingface/meta-llama/Llama-3.3-70B-Instruct","veoaifree-web/veo"])expect(allowed(ctx({paidEnabled:false}),m),"free provider must be allowed: "+m);
expect(!allowed(ctx({paidEnabled:false,permissions:{mistral:false}}),"mistral/mistral-small-latest"),"the Owner can still turn a free provider off");
console.log("AI_POLICY_TESTS_PASSED");
