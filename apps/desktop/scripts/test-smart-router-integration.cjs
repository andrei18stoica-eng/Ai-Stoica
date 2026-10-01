const http=require("http");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {startLocalGateway}=require("../local-gateway.cjs");

function expect(v,m){if(!v)throw new Error(m)}
function listen(server){return new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>resolve(server.address().port))})}
function closeServer(server){return new Promise(resolve=>server.close(resolve))}
async function jsonBody(req){let body="";for await(const chunk of req)body+=chunk;return body?JSON.parse(body):{}}

async function main(){
  const calls=[];
  const omni=http.createServer(async(req,res)=>{
    res.setHeader("content-type","application/json");
    if(req.url==="/v1/models"&&req.method==="GET"){
      return res.end(JSON.stringify({data:[
        {id:"cerebras/gpt-oss-120b",provider:"cerebras"},
        {id:"groq/llama-3.3-70b-versatile",provider:"groq"},
        {id:"openai/whisper-1",provider:"openai"},
        {id:"runway/gen-3",provider:"runway"}
      ]}));
    }
    if(req.url==="/v1/chat/completions"&&req.method==="POST"){
      const body=await jsonBody(req);calls.push(body.model);
      if(body.model==="cerebras/gpt-oss-120b"){
        res.statusCode=503;
        return res.end(JSON.stringify({error:"temporary unavailable"}));
      }
      return res.end(JSON.stringify({choices:[{message:{content:"fallback ok"}}]}));
    }
    res.statusCode=404;res.end(JSON.stringify({error:"not found"}));
  });
  const omniPort=await listen(omni);
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),"ai-stoica-smart-route-"));
  const gateway=startLocalGateway({
    dataDir,port:8801,host:"127.0.0.1",
    getOmniConfig:()=>({
      baseUrl:"http://127.0.0.1:"+omniPort+"/v1",
      apiKey:"",
      model:"Ai principal"
    })
  });
  const base="http://127.0.0.1:8801";
  try{
    await new Promise(r=>setTimeout(r,120));
    let r=await fetch(base+"/auth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Router Test",email:"router@example.com",password:"1234567890"})});
    const auth=await r.json();expect(r.ok&&auth.token,"Register failed");
    const headers={authorization:"Bearer "+auth.token,"content-type":"application/json"};

    r=await fetch(base+"/api/router/preview",{method:"POST",headers,body:JSON.stringify({prompt:"Ce înseamnă fotosinteza?"})});
    const preview=await r.json();
    expect(r.ok,"Router preview failed");
    expect(preview.data.task==="fast","Short direct question should be classified as fast");
    expect(preview.data.selectedModel==="cerebras/gpt-oss-120b","Router should choose Cerebras first for fast response");

    r=await fetch(base+"/api/chat",{method:"POST",headers,body:JSON.stringify({model:"Ai principal",messages:[{role:"user",content:"Ce înseamnă fotosinteza?"}]})});
    const body=await r.json();
    expect(r.ok,"Smart chat fallback failed");
    expect(body.choices?.[0]?.message?.content==="fallback ok","Fallback answer missing");
    expect(calls.length===2,"Router should try exactly two candidates after first failure");
    expect(calls[0]==="cerebras/gpt-oss-120b","Router did not try preferred model first");
    expect(calls[1]==="groq/llama-3.3-70b-versatile","Router did not fall back to second-ranked model");
    expect(r.headers.get("x-ai-stoica-route")==="fast","Route category header missing");
    expect(r.headers.get("x-ai-stoica-model")==="groq/llama-3.3-70b-versatile","Final used model header missing");

    console.log("SMART_ROUTER_INTEGRATION_TESTS_PASSED");
  } finally {
    await gateway.close();
    await closeServer(omni);
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
}

main().catch(err=>{console.error(err);process.exit(1)});
