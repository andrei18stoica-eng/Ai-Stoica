const http=require("http");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {startLocalGateway}=require("../local-gateway.cjs");

function expect(v,m){if(!v)throw new Error(m)}
function listen(server){return new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>resolve(server.address().port))})}
function closeServer(server){return new Promise(resolve=>server.close(resolve))}
async function readBody(req){let b="";for await(const c of req)b+=c;return b}
async function jsonBody(req){const b=await readBody(req);return b?JSON.parse(b):{}}

async function main(){
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
  const mp4=Buffer.concat([
    Buffer.from([0,0,0,24]),Buffer.from("ftyp","ascii"),Buffer.from("isom0000isomiso2","ascii"),Buffer.alloc(64,0)
  ]);
  let imageModelUsed="",videoModelUsed="",videoGenerationCalls=0;

  const cloud=http.createServer(async(req,res)=>{
    res.setHeader("content-type","application/json");
    const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
    if(req.url==="/auth/me"){
      if(!["normal-token","blocked-video-token","owner-token"].includes(token)){res.statusCode=401;return res.end(JSON.stringify({error:"bad token"}))}
      const isOwner=token==="owner-token";
      const videoAllowed=token!=="blocked-video-token";
      return res.end(JSON.stringify({
        user:{id:isOwner?"owner-media":videoAllowed?"user-media":"user-media-blocked",email:isOwner?"owner@example.com":videoAllowed?"media@example.com":"media-blocked@example.com",name:isOwner?"Owner":"Media User",role:isOwner?"owner":"user",status:"active"},
        permissions:{
          chat:true,image_generation:true,video_generation:videoAllowed,
          cloudflare:true,groq:true,cerebras:true,gemini:true,
          openrouter:false,openai:false,anthropic:false
        }
      }));
    }
    if(req.url==="/api/ai/access"&&req.method==="POST"){
      const body=await jsonBody(req);
      const models=Array.isArray(body.models)?body.models:[body.model].filter(Boolean);
      const data=models.map(model=>{
        const value=String(model);
        const isOwner=token==="owner-token";
        const allowed=isOwner||/^cloudflare\//i.test(value);
        const paidRequired=/^(openai|anthropic|openrouter|runway)\//i.test(value);
        return {model:value,allowed,paidRequired,reason:allowed?"":"Modelul nu este permis pentru acest cont."};
      });
      return res.end(JSON.stringify({data,policyEnforced:true,paidAiEnabled:false}));
    }
    if(req.url==="/health")return res.end(JSON.stringify({ok:true}));
    res.statusCode=404;res.end(JSON.stringify({error:"not found"}));
  });
  const cloudPort=await listen(cloud);

  const omni=http.createServer(async(req,res)=>{
    if(req.url==="/v1/models"){
      res.setHeader("content-type","application/json");
      return res.end(JSON.stringify({data:[
        {id:"openai/gpt-image-2",provider:"openai",type:"image"},
        {id:"broken-image-1",provider:"cloudflare",type:"image"},
        {id:"free-image-1",provider:"cloudflare",type:"image"},
        {id:"runway/gen-3",provider:"runway",type:"video"},
        {id:"broken-video-1",provider:"cloudflare",type:"video"},
        {id:"free-video-1",provider:"cloudflare",type:"video"}
      ]}));
    }
    if(req.url==="/v1/images/generations"&&req.method==="POST"){
      const body=JSON.parse(await readBody(req));imageModelUsed=body.model;
      res.setHeader("content-type","application/json");
      if(body.model==="broken-image-1"){res.statusCode=400;return res.end(JSON.stringify({error:"model endpoint mismatch"}))}
      return res.end(JSON.stringify({created:Date.now(),data:[{b64_json:png.toString("base64")}]}));
    }
    if(req.url==="/v1/videos/generations"&&req.method==="POST"){
      const body=JSON.parse(await readBody(req));videoModelUsed=body.model;videoGenerationCalls++;
      res.setHeader("content-type","application/json");
      if(body.model==="broken-video-1"){res.statusCode=400;return res.end(JSON.stringify({error:"model endpoint mismatch"}))}
      return res.end(JSON.stringify({id:"job-1",status:"queued"}));
    }
    if(req.url==="/v1/videos/job-1"&&req.method==="GET"){
      res.setHeader("content-type","application/json");
      return res.end(JSON.stringify({id:"job-1",status:"completed",video:{url:"http://127.0.0.1:"+omni.address().port+"/media/test.mp4"}}));
    }
    if(req.url==="/media/test.mp4"){
      res.setHeader("content-type","video/mp4");
      res.setHeader("content-length",String(mp4.length));
      return res.end(mp4);
    }
    res.statusCode=404;res.end("not found");
  });
  const omniPort=await listen(omni);
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),"ai-stoica-media-"));
  const gateway=startLocalGateway({
    dataDir,port:8799,host:"127.0.0.1",
    getOmniConfig:()=>({
      baseUrl:"http://127.0.0.1:"+omniPort+"/v1",
      controlApiUrl:"http://127.0.0.1:"+cloudPort,
      apiKey:"",
      model:"groq/llama-3.3-70b-versatile",
      imageModel:"openai/gpt-image-2",
      videoModel:"runway/gen-3"
    })
  });
  const base="http://127.0.0.1:8799";
  try{
    await new Promise(r=>setTimeout(r,120));
    const headers={authorization:"Bearer normal-token","content-type":"application/json"};

    let r=await fetch(base+"/api/generate/image",{method:"POST",headers,body:JSON.stringify({prompt:"A blue square"})});
    const image=await r.json();expect(r.ok,image.error||"Image generation failed");
    expect(image.data?.kind==="image","Generated image kind missing");
    expect(image.data?.model==="free-image-1","Free permitted image model was not selected");
    expect(imageModelUsed==="free-image-1","Paid configured image model should have fallen back to free permitted model");
    r=await fetch(base+"/api/files/"+image.data.id,{headers:{authorization:"Bearer normal-token"}});
    const imageBytes=Buffer.from(await r.arrayBuffer());
    expect(r.ok&&imageBytes.subarray(0,8).equals(png.subarray(0,8)),"Generated image file is not a real PNG");

    r=await fetch(base+"/api/generate/video",{method:"POST",headers,body:JSON.stringify({prompt:"A short test video"})});
    const video=await r.json();expect(r.ok,video.error||"Video generation failed");
    expect(video.data?.kind==="video","Generated video kind missing");
    expect(video.data?.model==="free-video-1","Free permitted video model was not selected");
    expect(videoModelUsed==="free-video-1","Paid configured video model should have fallen back to free permitted model");
    r=await fetch(base+"/api/files/"+video.data.id,{headers:{authorization:"Bearer normal-token"}});
    const videoBytes=Buffer.from(await r.arrayBuffer());
    expect(r.ok&&videoBytes.subarray(4,8).toString("ascii")==="ftyp","Generated video file is not MP4-like");

    const ownerHeaders={authorization:"Bearer owner-token","content-type":"application/json"};
    r=await fetch(base+"/api/generate/image",{method:"POST",headers:ownerHeaders,body:JSON.stringify({prompt:"Owner free image while paid AI is globally off"})});
    const ownerImage=await r.json();expect(r.ok,ownerImage.error||"Owner image generation failed while paid AI was off");
    expect(ownerImage.data?.model==="openai/gpt-image-2","Owner should retain configured paid image access while paid AI is off for normal accounts");

    r=await fetch(base+"/api/generate/video",{method:"POST",headers:ownerHeaders,body:JSON.stringify({prompt:"Owner free video while paid AI is globally off"})});
    const ownerVideo=await r.json();expect(r.ok,ownerVideo.error||"Owner video generation failed while paid AI was off");
    expect(ownerVideo.data?.model==="runway/gen-3","Owner should retain configured paid video access while paid AI is off for normal accounts");

    const beforeBlocked=videoGenerationCalls;
    r=await fetch(base+"/api/generate/video",{
      method:"POST",
      headers:{authorization:"Bearer blocked-video-token","content-type":"application/json"},
      body:JSON.stringify({prompt:"This must be blocked by Owner permission"})
    });
    expect(r.status===403,"Video generation must remain blocked when Owner disabled video_generation for the account");
    expect(videoGenerationCalls===beforeBlocked,"Blocked video request reached OmniRoute");

    const lib=await fetch(base+"/api/library",{headers:{authorization:"Bearer normal-token"}}).then(x=>x.json());
    expect(lib.data.some(x=>x.id===image.data.id&&x.kind==="image"),"Image not saved to library");
    expect(lib.data.some(x=>x.id===video.data.id&&x.kind==="video"),"Video not saved to library");
    console.log("MEDIA_GENERATION_TESTS_PASSED");
  } finally {
    await gateway.close();
    await closeServer(cloud);
    await closeServer(omni);
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
}

main().catch(err=>{console.error(err);process.exit(1)});
