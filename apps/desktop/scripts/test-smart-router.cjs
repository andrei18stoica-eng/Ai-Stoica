const { classifyTask, routeQuestion } = require("../smart-router.cjs");

function expect(v,m){if(!v)throw new Error(m)}

const models=[
  {id:"openai/gpt-5",provider:"openai"},
  {id:"anthropic/claude-sonnet-4.5",provider:"anthropic"},
  {id:"google/gemini-2.5-pro",provider:"gemini"},
  {id:"cerebras/gpt-oss-120b",provider:"cerebras"},
  {id:"groq/llama-3.3-70b-versatile",provider:"groq"},
  {id:"openai/whisper-1",provider:"openai"},
  {id:"runway/gen-3",provider:"runway"}
];

function route(prompt){
  return routeQuestion(models,[{role:"user",content:prompt}],5);
}

let r=route("Scrie o funcție TypeScript care validează un JWT și repară bug-ul din acest cod.");
expect(r.task==="coding","Coding classification failed");
expect(r.selectedModel==="openai/gpt-5","Coding should prefer GPT-5 in this catalog");

r=route("Demonstrează teorema și rezolvă ecuația x^2 - 5x + 6 = 0 explicând logic.");
expect(r.task==="reasoning","Reasoning classification failed");
expect(r.selectedModel==="openai/gpt-5","Reasoning should prefer GPT-5 in this catalog");

r=route("Analizează juridic acest contract și explică prevederile legale și riscurile.");
expect(r.task==="legal_analysis","Legal classification failed");
expect(r.selectedModel==="anthropic/claude-sonnet-4.5","Legal analysis should prefer Claude Sonnet in this catalog");

r=route("Analizează acest document PDF și fă o sinteză structurată.");
expect(r.task==="long_context","Long-context classification failed");
expect(r.selectedModel==="google/gemini-2.5-pro","Long context should prefer Gemini Pro in this catalog");

r=route("Scrie o poveste creativă scurtă despre un oraș futurist.");
expect(r.task==="creative","Creative classification failed");
expect(r.selectedModel==="anthropic/claude-sonnet-4.5","Creative task should prefer Claude Sonnet in this catalog");

r=route("Ce este un API?");
expect(r.task==="fast","Fast classification failed");
expect(r.selectedModel==="cerebras/gpt-oss-120b","Fast task should prefer Cerebras in this catalog");

r=routeQuestion(models,[{role:"user",content:[
  {type:"text",text:"Ce observi în această imagine?"},
  {type:"image_url",image_url:{url:"data:image/png;base64,AAAA"}}
]}],5);
expect(r.task==="vision","Vision classification failed");
expect(r.selectedModel==="openai/gpt-5","Vision should prefer a multimodal-capable top model in this catalog");

expect(!r.candidates.some(x=>/whisper|runway/i.test(x.id)),"Non-chat media models must not enter the chat router");

console.log("SMART_ROUTER_TESTS_PASSED");
