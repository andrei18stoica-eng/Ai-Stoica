const fs=require("fs");
const http=require("http");
const os=require("os");
const path=require("path");
const {startLocalGateway}=require("../local-gateway.cjs");

function expect(v,m){if(!v)throw new Error(m)}

// Local mode (no AI Stoica Cloud): the PC account must be able to use the free API keys
// configured on this PC, while code execution stays Owner-only.
async function main(){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),"ai-stoica-local-"));
  const port=8811;
  const cfg={
    baseUrl:"http://127.0.0.1:65531/v1",
    controlApiUrl:"",
    apiKey:"",
    model:"",
    webSearchEnabled:false,
    githubAutoContext:false,
    directChatEnabled:true,
    directChatCostPolicy:"free_only",
    directChatProviderOrder:"groq",
    groqApiKey:"test-groq-key",
    groqModel:"llama-3.3-70b-versatile",
    imageCostPolicy:"free_only",
    imageProviderOrder:"cloudflare",
    cloudflareAccountId:"local-account",
    cloudflareApiToken:"local-token"
  };
  const gateway=startLocalGateway({dataDir,port,host:"127.0.0.1",getOmniConfig:()=>cfg});
  const base="http://127.0.0.1:"+port;
  const realFetch=globalThis.fetch;
  const png=Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000","hex");
  globalThis.fetch=async (url,init)=>{
    const target=String(url);
    if(target==="https://api.groq.com/openai/v1/chat/completions"){
      return new Response(JSON.stringify({choices:[{message:{content:"LOCAL_GROQ_OK"}}]}),{status:200,headers:{"content-type":"application/json"}});
    }
    if(target==="https://api.cloudflare.com/client/v4/accounts/local-account/ai/run/@cf/black-forest-labs/flux-1-schnell"){
      return new Response(JSON.stringify({result:{image:png.toString("base64")}}),{status:200,headers:{"content-type":"application/json"}});
    }
    return realFetch(url,init);
  };
  try{
    await new Promise(r=>setTimeout(r,100));
    let r=await fetch(base+"/auth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"local@example.com",password:"password123",name:"Local"})});
    let data=await r.json();
    expect(r.ok,data.error||"register failed");
    const headers={authorization:"Bearer "+data.token,"content-type":"application/json"};

    r=await fetch(base+"/api/tools/code/run",{method:"POST",headers,body:JSON.stringify({language:"javascript",code:"console.log(1)"})});
    expect(r.status===403,"Code execution must stay Owner-only in local mode");

    r=await fetch(base+"/api/models",{headers});
    data=await r.json();
    expect(r.ok,data.error||"models failed");
    expect((data.data||[]).some(x=>String(x?.id||x)==="groq/llama-3.3-70b-versatile"),"Local mode must list the direct free models");

    r=await fetch(base+"/api/chat",{method:"POST",headers,body:JSON.stringify({messages:[{role:"user",content:"salut"}]})});
    data=await r.json();
    expect(r.ok,data.error||"local direct chat failed");
    expect(data?.choices?.[0]?.message?.content==="LOCAL_GROQ_OK","Local direct chat answer mismatch");

    r=await fetch(base+"/api/generate/image",{method:"POST",headers,body:JSON.stringify({prompt:"un câine"})});
    data=await r.json();
    expect(r.ok,data.error||"local image generation failed");
    expect(data.data?.provider==="cloudflare-direct","Local image must use the configured free Cloudflare key");

    r=await fetch(base+"/api/automations",{method:"POST",headers,body:JSON.stringify({title:"Test",prompt:"Spune OK",frequency:"daily",time:"09:00",model:""})});
    expect(r.status===400,"Automation without a model must return a clear 400 error");

    // Settings > "Testează cheile"
    r=await fetch(base+"/api/providers/test",{method:"POST",headers,body:"{}"});
    data=await r.json();
    expect(r.ok,data.error||"provider test failed");
    expect(data.data?.some(x=>x.provider==="groq"&&x.ok),"Provider test must report Groq as working");

    // Only the AI Stoica window may call the local service.
    r=await realFetch(base+"/api/models",{headers:{...headers,origin:"https://site-strain.example"}});
    expect(r.status===403,"Requests from foreign websites must be blocked");
    r=await realFetch(base+"/api/models",{headers:{...headers,origin:"null"}});
    expect(r.status!==403,"Requests from the desktop window (Origin null) must be allowed");
    const hostStatus=await new Promise((resolve,reject)=>{
      const q=http.request({host:"127.0.0.1",port,path:"/health",headers:{host:"atacator.example:"+port}},res=>{res.resume();resolve(res.statusCode)});
      q.on("error",reject);q.end();
    });
    expect(hostStatus===403,"DNS-rebinding host names must be blocked");

    // Uploaded documents are read so the AI can use them.
    r=await realFetch(base+"/api/library/upload",{method:"POST",headers:{authorization:headers.authorization,"content-type":"application/octet-stream","x-file-name":encodeURIComponent("notițe.txt"),"x-file-type":"text/plain"},body:Buffer.from("Parola de Wi-Fi a biroului este în sertar.","utf8")});
    data=await r.json();
    expect(r.ok,data.error||"upload failed");
    let indexed=null;
    for(let i=0;i<40&&!indexed;i++){
      await new Promise(res=>setTimeout(res,100));
      const db=JSON.parse(fs.readFileSync(path.join(dataDir,"ai-stoica-data.json"),"utf8"));
      const item=db.library.find(x=>x.id===data.data.id);
      if(item?.textStatus==="ok")indexed=item;
    }
    expect(indexed&&indexed.text.includes("Wi-Fi"),"Uploaded text file was not indexed for the AI");

    // Old sessions without an expiry are refused after 30 days.
    const jwt=require("jsonwebtoken");
    const secret=fs.readFileSync(path.join(dataDir,"auth-secret.txt"),"utf8").trim();
    const userId=JSON.parse(fs.readFileSync(path.join(dataDir,"ai-stoica-data.json"),"utf8")).users[0].id;
    const legacy=jwt.sign({sub:userId,email:"local@example.com",iat:Math.floor(Date.now()/1000)-40*86400},secret);
    r=await realFetch(base+"/auth/me",{headers:{authorization:"Bearer "+legacy}});
    expect(r.status===401,"A 40-day-old session without expiry must be refused");
    r=await realFetch(base+"/auth/me",{headers});
    data=await r.json();
    expect(r.ok&&jwt.decode(data.token)?.exp,"/auth/me must return a renewed session with an expiry");

    console.log("LOCAL_MODE_TESTS_PASSED");
  } finally {
    globalThis.fetch=realFetch;
    await gateway.close();
    fs.rmSync(dataDir,{recursive:true,force:true});
  }

  // A normal Cloud account must stay logged in while the Cloud server is unreachable.
  const cloudDir=fs.mkdtempSync(path.join(os.tmpdir(),"ai-stoica-cloud-down-"));
  const cloudPort=8812;
  const cloudGateway=startLocalGateway({dataDir:cloudDir,port:cloudPort,host:"127.0.0.1",getOmniConfig:()=>({...cfg,controlApiUrl:"http://127.0.0.1:65532"})});
  try{
    await new Promise(r=>setTimeout(r,100));
    const r=await fetch("http://127.0.0.1:"+cloudPort+"/api/conversations",{headers:{authorization:"Bearer cloud-session-token"}});
    expect(r.status===503,"Cloud outage must return 503 (stay logged in), not 401 — got "+r.status);
    console.log("CLOUD_OUTAGE_TEST_PASSED");
  }finally{
    await cloudGateway.close();
    fs.rmSync(cloudDir,{recursive:true,force:true});
  }

  // Public servers (apps/cloud): only the first account can sign up unless registration is opened.
  const publicDir=fs.mkdtempSync(path.join(os.tmpdir(),"ai-stoica-public-"));
  const publicPort=8813;
  const publicGateway=startLocalGateway({dataDir:publicDir,port:publicPort,host:"127.0.0.1",getOmniConfig:()=>({...cfg,allowRegistration:false})});
  try{
    await new Promise(r=>setTimeout(r,100));
    const reg=(email)=>fetch("http://127.0.0.1:"+publicPort+"/auth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password:"password123"})});
    let r=await reg("first@example.com");
    expect(r.ok,"The first account must be allowed on a closed server");
    r=await reg("stranger@example.com");
    expect(r.status===403,"A second sign-up must be refused when registration is closed");
    console.log("CLOSED_REGISTRATION_TEST_PASSED");
  }finally{
    await publicGateway.close();
    fs.rmSync(publicDir,{recursive:true,force:true});
  }
}

main().catch(e=>{console.error(e);process.exit(1)});
