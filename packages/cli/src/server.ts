
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Store, checkpoint, planRestore, restore, undo, recover, compareCheckpoints, diffBlob, TimeWarpError } from "@timewarp/core";
const json=(res:ServerResponse,status:number,value:unknown)=>{
  const data=JSON.stringify(value);
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
  res.end(data);
};
async function body(req:IncomingMessage):Promise<Record<string,unknown>>{
  let data="";
  for await(const chunk of req){
    data+=String(chunk);
    if(data.length>65536)throw new TimeWarpError("Request too large.","BAD_REQUEST");
  }
  if(!data)return {};
  const result:unknown=JSON.parse(data);
  if(!result||typeof result!=="object"||Array.isArray(result))throw new TimeWarpError("Expected JSON object.","BAD_REQUEST");
  return result as Record<string,unknown>;
}
function id(v:unknown):string{
  if(typeof v!=="string"||!v||v.length>256)throw new TimeWarpError("Missing or invalid identifier.","BAD_REQUEST");
  return v;
}
export async function startServer(s:Store,port=47329):Promise<{server:Server;url:string}>{
  if(port<1024||port>65535)throw new TimeWarpError("Port must be 1024–65535.","BAD_REQUEST");
  const supplied=process.env.TIMEWARP_DASHBOARD_TOKEN;
  if(supplied && !/^[a-f0-9]{64}$/.test(supplied))throw new TimeWarpError("Invalid dashboard auth token.","BAD_CONFIG");
  const token=supplied??randomBytes(32).toString("hex");
  const server=createServer(async(req,res)=>{
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("Referrer-Policy","no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy","same-origin");
    res.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try{
      const host=req.headers.host||"";
      if(!/^((127\.0\.0\.1)|(localhost))(:[0-9]+)?$/.test(host)){json(res,403,{error:"Untrusted Host header"});return;}
      const origin=req.headers.origin;
      const localOrigin=Boolean(origin&&/^http:\/\/(127\.0\.0\.1|localhost)(:[0-9]+)?$/.test(origin));
      const tauriOrigin=Boolean(origin&&/^(tauri:\/\/localhost|https?:\/\/tauri\.localhost)$/.test(origin));
      if(origin&&!localOrigin&&!tauriOrigin){json(res,403,{error:"Untrusted origin"});return;}
      if(tauriOrigin){res.setHeader("Access-Control-Allow-Origin",origin!);res.setHeader("Vary","Origin");res.setHeader("Access-Control-Allow-Headers","Content-Type, X-Timewarp-Token");res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS");}
      if(req.method==="OPTIONS"){res.writeHead(204);res.end();return;}
      const url=new URL(req.url??"/","http://127.0.0.1:"+port);
      if(url.pathname.startsWith("/api/")){
        if(req.headers["x-timewarp-token"]!==token){json(res,403,{error:"Missing dashboard token"});return;}
        if(req.method==="GET"){
          switch(url.pathname){
            case "/api/status":json(res,200,s.stats());return;
            case "/api/sessions":json(res,200,s.sessions(100));return;
            case "/api/timeline":json(res,200,s.events(Math.min(10000,Number(url.searchParams.get("limit")||"500")||500),url.searchParams.get("session")||undefined));return;
            case "/api/checkpoints":json(res,200,s.checkpoints(100));return;
            case "/api/restore-plan":json(res,200,await planRestore(s,id(url.searchParams.get("id")),url.searchParams.get("path")||undefined));return;
            case "/api/diff":json(res,200,{diff:await diffBlob(s,url.searchParams.get("before"),url.searchParams.get("after"))});return;
            case "/api/compare":json(res,200,compareCheckpoints(s,id(url.searchParams.get("a")),id(url.searchParams.get("b"))));return;
          }
        }
        if(req.method==="POST"&&req.headers["content-type"]?.startsWith("application/json")){
          const data=await body(req);
          switch(url.pathname){
            case "/api/checkpoint":json(res,200,await checkpoint(s,typeof data.label==="string"?data.label:"Desktop checkpoint"));return;
            case "/api/restore":{
              if(data.confirm!==true)throw new TimeWarpError("Explicit restore confirmation required.","BAD_REQUEST");
              json(res,200,await restore(s,id(data.id),typeof data.path==="string"?data.path:undefined));return;
            }
            case "/api/undo":{
              if(data.confirm!==true)throw new TimeWarpError("Explicit undo confirmation required.","BAD_REQUEST");
              json(res,200,await undo(s));return;
            }
            case "/api/recover":{
              if(data.confirm!==true)throw new TimeWarpError("Explicit recovery confirmation required.","BAD_REQUEST");
              json(res,200,await recover(s));return;
            }
          }
        }
        json(res,404,{error:"API route not found"});return;
      }
      const assets:Record<string,{file:string;type:string}>={
        "/":{file:"index.html",type:"text/html; charset=utf-8"},
        "/app.js":{file:"app.js",type:"text/javascript; charset=utf-8"},
        "/style.css":{file:"style.css",type:"text/css; charset=utf-8"}
      };
      if(req.method!=="GET"||!assets[url.pathname]){json(res,404,{error:"Not found"});return;}
      const entry=assets[url.pathname]!;
      let content=await readFile(new URL("./ui/"+entry.file,import.meta.url),"utf8");
      if(entry.file==="index.html")content=content.replace("__TIMEWARP_TOKEN__",token);
      res.writeHead(200,{"Content-Type":entry.type,"Cache-Control":"no-store"});res.end(content);
    }catch(e){const status=e instanceof TimeWarpError?400:500;json(res,status,{error:e instanceof Error?e.message:String(e)});}
  });
  await new Promise<void>((resolve,reject)=>{
    server.once("error",reject);
    server.listen(port,"127.0.0.1",()=>{server.off("error",reject);resolve();});
  });
  return {server,url:"http://127.0.0.1:"+port};
}
