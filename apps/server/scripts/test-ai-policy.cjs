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
function ctx({role="user",paidEnabled=true,permissions={}}={}) {
  return {user:{role},paidEnabled,permissions:{...defaults,...permissions},combinations:combos};
}
function allowed(context, model){return evaluateModelAccess(context,model).allowed}
function deniedReason(context, model){const r=evaluateModelAccess(context,model);expect(!r.allowed,model+" should be denied");return r.reason}

expect(allowed(ctx(),"groq/llama-3.3-70b-versatile"),"Groq free model should be allowed");
expect(allowed(ctx(),"Free Mix"),"Free Mix should be allowed");
expect(!allowed(ctx(),"openai/gpt-5"),"OpenAI must be blocked by default");
expect(!allowed(ctx(),"anthropic/claude-sonnet"),"Claude must be blocked by default");
expect(!allowed(ctx(),"GPT + Claude"),"Paid combination must be blocked by default");
expect(!allowed(ctx(),"Ai principal"),"Ai principal managed route must be blocked without paid permissions");
expect(!allowed(ctx(),"AI Stoica"),"AI Stoica managed route must be blocked without paid permissions");
expect(!allowed(ctx(),"mystery-model"),"Unknown model must fail closed for normal users");
expect(!allowed(ctx(),"openrouter/auto"),"OpenRouter auto must be blocked by default because it can incur costs");
expect(allowed(ctx({permissions:{openrouter:true}}),"openrouter/meta-llama/llama-3.3"),"OpenRouter requires explicit permission when paid AI is enabled");

expect(allowed(ctx({permissions:{openai:true}}),"openai/gpt-5"),"Explicit OpenAI permission should allow GPT when paid AI is on");
expect(!allowed(ctx({permissions:{openai:true}}),"Ai principal"),"Ai principal must still require Claude permission");
expect(allowed(ctx({permissions:{openai:true,anthropic:true}}),"Ai principal"),"Ai principal should work only when both paid permissions are granted");
expect(allowed(ctx({permissions:{openai:true,anthropic:true}}),"GPT + Claude"),"Paid combination should work with both permissions");

expect(!allowed(ctx({paidEnabled:false,permissions:{openai:true,anthropic:true}}),"openai/gpt-5"),"Global paid switch must override individual OpenAI permission");
expect(!allowed(ctx({role:"owner",paidEnabled:false}),"openai/gpt-5"),"Global paid switch must also protect Owner from accidental paid use");
expect(allowed(ctx({role:"owner",paidEnabled:false}),"mystery-model"),"Owner may use unknown non-classified models");
expect(!allowed(ctx({permissions:{chat:false}}),"groq/llama-3.3-70b-versatile"),"Chat permission must be enforced");
expect(deniedReason(ctx(),"Ai principal").length>0,"Denied decision should explain the reason");
const disabledCtx=ctx({permissions:{openai:true,anthropic:true}});
disabledCtx.combinations=[...combos,{id:"disabled-paid",name:"Disabled Paid",providers:["openai"],paid_required:true,enabled:false}];
expect(!allowed(disabledCtx,"disabled-paid"),"Disabled combination must stay blocked even when provider permission exists");

console.log("AI_POLICY_TESTS_PASSED");
