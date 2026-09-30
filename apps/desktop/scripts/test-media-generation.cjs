const http=require("http");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {startLocalGateway}=require("../local-gateway.cjs");

function expect(v,m){if(!v)throw new Error(m)}
function listen(server){return new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>resolve(server.address().port))})}
function closeServer(server){return new Promise(resolve=>server.close(resolve))}
async function readBody(req){let b="";for await(const c of req)b+=c;return b}

async function main(){
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
  const mp4=Buffer.concat([
    Buffer.from([0,0,0,24]),Buffer.from("ftyp","ascii"),Buffer.from("isom0000isomiso2","ascii"),Buffer.alloc(64,0)
  ]);

  const omni=http.createServer(async(req,res)=>{
    if(req.url==="/v1/models"){
      res.setHeader("content-type","application/json");
      return res.end(JSON.stringify({data:[{id:"runway/gen-3",type:"video"},{id:"openai/gpt-image-2",type:"image"}]}));
    }
    if(req.url==="/v1/images/generations"&&req.method==="POST"){
      await readBody(req);
      res.setHeader("content-type","application/json");
      return res.end(JSON.stringify({created:Date.now(),data:[{b64_json:png.toString("base64")}]}));
    }
    if(req.url==="/v1/videos/generations"&&req.method==="POST"){
      await readBody(req);
      res.setHeader("content-type","application/json");
      return res.end(JSON.stringify({id:"job-1",status:"queued"}));
    }
    if(req.url==="/v1/videos/job-1"&&req.method==="GET"){
      res.setHeader("content-type","application/json");
      return res.end(JSON.stringify({id:"job-1",status:"completed",video:{url:`http://127.0.0.1:${omni.address().port}/media/test.mp4`}}));
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
      baseUrl:`http://127.0.0.1:${omniPort}/v1`,
      apiKey:"",
      model:"Ai principal",
      imageModel:"openai/gpt-image-2",
      videoModel:"runway/gen-3"
    })
  });
  const base="http://127.0.0.1:8799";
  try{
    await new Promise(r=>setTimeout(r,120));
    let r=await fetch(base+"/auth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Media Test",email:"media@example.com",password:"1234567890"})});
    const auth=await r.json();expect(r.ok&&auth.token,"Register failed");
    const headers={authorization:`Bearer ${auth.token}`,"content-type":"application/json"};

    r=await fetch(base+"/api/generate/image",{method:"POST",headers,body:JSON.stringify({prompt:"A blue square"})});
    const image=await r.json();expect(r.ok,image.error||"Image generation failed");
    expect(image.data?.kind==="image","Generated image kind missing");
    r=await fetch(base+`/api/files/${image.data.id}`,{headers:{authorization:`Bearer ${auth.token}`}});
    const imageBytes=Buffer.from(await r.arrayBuffer());
    expect(r.ok&&imageBytes.subarray(0,8).equals(png.subarray(0,8)),"Generated image file is not a real PNG");

    r=await fetch(base+"/api/generate/video",{method:"POST",headers,body:JSON.stringify({prompt:"A short test video"})});
    const video=await r.json();expect(r.ok,video.error||"Video generation failed");
    expect(video.data?.kind==="video","Generated video kind missing");
    r=await fetch(base+`/api/files/${video.data.id}`,{headers:{authorization:`Bearer ${auth.token}`}});
    const videoBytes=Buffer.from(await r.arrayBuffer());
    expect(r.ok&&videoBytes.subarray(4,8).toString("ascii")==="ftyp","Generated video file is not MP4-like");

    const lib=await fetch(base+"/api/library",{headers:{authorization:`Bearer ${auth.token}`}}).then(x=>x.json());
    expect(lib.data.some(x=>x.id===image.data.id&&x.kind==="image"),"Image not saved to library");
    expect(lib.data.some(x=>x.id===video.data.id&&x.kind==="video"),"Video not saved to library");
    console.log("MEDIA_GENERATION_TESTS_PASSED");
  } finally {
    await gateway.close();
    await closeServer(omni);
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
}

main().catch(err=>{console.error(err);process.exit(1)});
