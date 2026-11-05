#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Store, projectRoot, initializeState, checkpoint, watchProject, reconcile, planRestore, restore, recover, undo, compareCheckpoints, diffBlob, verifyCheckpoint, garbageCollect, TimeWarpError, type TimeWarpConfig } from "@timewarp/core";
import { startServer } from "./server.js";

const HELP = [
  "TimeWarp — Your AI broke your project? Rewind everything.",
  "",
  "Usage: timewarp <command> [options]",
  "  init [path]                         Initialize project and create baseline",
  "  watch [path]                        Record changes until Ctrl+C",
  "  status                             Current project health",
  "  sessions                           List recorded sessions",
  "  timeline [--limit 100]             Chronological filesystem activity",
  "  checkpoint [label]                 Capture full project state",
  "  checkpoints                        List checkpoints",
  "  diff <checkpoint-a> <checkpoint-b>  Inspect changed files",
  "  restore <checkpoint> [--yes]       Preview or restore entire checkpoint",
  "  restore-file <path> --checkpoint <id> [--yes]",
  "  undo [--yes]                       Preview or revert latest restore",
  "  recover [--yes]                    Roll back an interrupted restore",
  "  run -- <command> [args...]         Explicitly wrap a process",
  "  ui [--port 47329]                  Start local dashboard",
  "  doctor                             Verify local store and latest checkpoint",
  "  config [key] [value]               Read or update local options",
  "  gc                                 Remove unreachable blobs",
  "",
  "Global: --project <path>  --json  --help",
  "Safety: restore, restore-file, undo and recover require --yes to modify files.",
  "No telemetry. No AI API key. Everything stays on your computer."
].join("\n");
function flag(args:string[],key:string):boolean{const i=args.indexOf(key);if(i<0)return false;args.splice(i,1);return true;}
function opt(args:string[],key:string,otherwise?:string):string|undefined{
  const i=args.indexOf(key);if(i<0)return otherwise;
  if(i===args.length-1)throw new TimeWarpError("Missing value for "+key,"ARGUMENT");
  const value=args[i+1]!;args.splice(i,2);return value;
}
const toInt=(x:string|undefined,fallback:number):number=>{
  if(x===undefined)return fallback;
  const n=Number(x);
  if(!Number.isSafeInteger(n)||n<1)throw new TimeWarpError("Expected a positive integer: "+x,"ARGUMENT");
  return n;
};
function print(value:unknown,json:boolean){
  if(json)console.log(JSON.stringify(value,null,2));
  else if(typeof value==="string")console.log(value);
  else console.log(JSON.stringify(value,null,2));
}
function openStore(path:string):Store{return new Store(projectRoot(path));}
async function withStore<T>(path:string,fn:(s:Store)=>Promise<T>|T):Promise<T>{
  const s=openStore(path);
  try{return await fn(s);}finally{s.close();}
}
const redacted=(s:string):string=>s.replace(/((?:password|token|secret|api[_-]?key|authorization)[=:])\S+/gi,"$1[REDACTED]");
async function main():Promise<void>{
  const args=process.argv.slice(2);
  const json=flag(args,"--json");
  const yes=flag(args,"--yes");
  const help=flag(args,"--help")||flag(args,"-h");
  const project=opt(args,"--project",".")!;
  if(help||args.length===0){console.log(HELP);return;}
  const cmd=args.shift()!;
  if(cmd==="init"){
    const s=new Store(resolve(args[0]??project),true);
    try{const baseline=await initializeState(s);print({project:s.root,baseline,help:"Run timewarp watch . to start recording."},json);}
    finally{s.close();}
    return;
  }
  if(cmd==="watch"){
    const path=args[0]??project;
    await withStore(path,async s=>{
      const abort=new AbortController();
      const stop=()=>abort.abort();
      process.once("SIGINT",stop);process.once("SIGTERM",stop);
      print("Recording "+s.root+" (Ctrl+C to stop). Data stays local.",json);
      try{await watchProject(s,{signal:abort.signal,onChange:n=>{if(!json)console.log("Recorded "+n+" change(s)");else print({changes:n,at:new Date().toISOString()},true);},onWarning:message=>console.error(message)});}
      finally{process.off("SIGINT",stop);process.off("SIGTERM",stop);}
    });
    return;
  }
  if(cmd==="ui"){
    const port=toInt(opt(args,"--port"),47329);
    const noBrowser=flag(args,"--no-browser");
    await withStore(project,async s=>{
      const server=await startServer(s,port);
      print("TimeWarp dashboard: "+server.url+" (local only)",json);
      if(!noBrowser)console.log("Open the address above in your browser.");
      await new Promise<void>(resolve=>{const stop=()=>resolve();process.once("SIGINT",stop);process.once("SIGTERM",stop);});
      await new Promise<void>((resolve,reject)=>server.server.close(e=>e?reject(e):resolve()));
    });
    return;
  }
  if(cmd==="run"){
    const split=args.indexOf("--");const command=split>=0?args.slice(split+1):args;
    if(!command.length)throw new TimeWarpError("Usage: timewarp run -- <command>","ARGUMENT");
    const code=await withStore(project,async s=>{
      await initializeState(s);
      const session=s.startSession("process");
      const start=new Date().toISOString();
      const visible=command.map(redacted);
      s.db.exec("CREATE TABLE IF NOT EXISTS commands(session_id TEXT PRIMARY KEY,command_json TEXT NOT NULL,cwd TEXT NOT NULL,start_at TEXT NOT NULL,end_at TEXT,exit_code INTEGER,pid INTEGER)");
      const statement=s.db.prepare("INSERT INTO commands(session_id,command_json,cwd,start_at) VALUES(?,?,?,?)");
      statement.run(session.id,JSON.stringify(visible),process.cwd(),start);
      // Spawn without shell interpolation. Stdout/stderr are inherited, never persisted.
      let exit=1;
      try{
        const child=spawn(command[0]!,command.slice(1),{cwd:process.cwd(),stdio:"inherit",shell:false,env:process.env});
        s.db.prepare("UPDATE commands SET pid=? WHERE session_id=?").run(child.pid??null,session.id);
        exit=await new Promise<number>((res,rej)=>{child.on("error",rej);child.on("exit",(n,signal)=>res(n??(signal?128:1)));});
      }finally{
        s.db.prepare("UPDATE commands SET end_at=?,exit_code=? WHERE session_id=?").run(new Date().toISOString(),exit,session.id);
        await reconcile(s,session.id);
        s.endSession(session.id);
      }
      return exit;
    });
    process.exitCode=code;return;
  }
  await withStore(project,async s=>{
    switch(cmd){
      case "status":print(s.stats(),json);break;
      case "sessions":print(s.sessions(),json);break;
      case "timeline":print(s.events(toInt(opt(args,"--limit"),100),opt(args,"--session")),json);break;
      case "checkpoint":print(await checkpoint(s,args.join(" ")||"Manual checkpoint"),json);break;
      case "checkpoints":print(s.checkpoints(),json);break;
      case "diff":{
        const [a,b]=args;
        if(!a||!b)throw new TimeWarpError("Usage: timewarp diff <checkpoint-a> <checkpoint-b>","ARGUMENT");
        const changes=compareCheckpoints(s,a,b);
        if(json){print(changes,true);break;}
        for(const change of changes){
          console.log("\n"+change.status.toUpperCase()+" "+change.path);
          console.log(await diffBlob(s,change.before,change.after));
        }
        if(!changes.length)console.log("No differences.");
        break;
      }
      case "restore":
      case "restore-file":{
        const file=cmd==="restore-file"?args.shift():undefined;
        const id=cmd==="restore-file"?opt(args,"--checkpoint"):args.shift();
        if(!id || (cmd==="restore-file"&&!file))throw new TimeWarpError("Checkpoint ID and (for restore-file) path required.","ARGUMENT");
        const plan=await planRestore(s,id,file);
        if(!yes){print({preview:plan,willModifyFiles:false,instruction:"Repeat with --yes to apply. A safety checkpoint will be created."},json);break;}
        const result=await restore(s,id,file);
        print({success:true,...result},json);
        break;
      }
      case "undo":{
        const last=s.lastSuccessful();
        if(!last)throw new TimeWarpError("No completed restore to undo.","NOT_FOUND");
        if(!yes){const plan=await planRestore(s,String(last.safety_id));print({preview:plan,willModifyFiles:false,instruction:"Use --yes to undo."},json);}
        else print(await undo(s),json);
        break;
      }
      case "recover":{
        if(!yes){print({pending:s.pending().map(r=>({id:r.id,status:r.status,safetyCheckpointId:r.safety_id})),willModifyFiles:false,instruction:"Use --yes to roll back interrupted restores."},json);break;}
        print(await recover(s),json);
        break;
      }
      case "doctor":{
        const latest=s.checkpoints(1)[0];
        const integrity=latest?await verifyCheckpoint(s,latest.id):null;
        print({ok:s.pending().length===0,project:s.root,latestCheckpoint:latest,integrity,recoveryRequired:s.pending().length>0,node:process.version},json);
        break;
      }
      case "config":{
        const [key,value]=args;
        if(!key){print(s.config,json);break;}
        if(!Object.prototype.hasOwnProperty.call(s.config,key))throw new TimeWarpError("Unknown config key: "+key,"ARGUMENT");
        if(value===undefined){print({[key]:s.config[key as keyof TimeWarpConfig]},json);break;}
        const n=toInt(value,0);
        const next={...s.config,[key]:n};
        await writeFile(s.configPath(),JSON.stringify(next,null,2)+"\n",{mode:0o600});
        print({updated:key,value:n,requiresRestart:true},json);
        break;
      }
      case "gc":print(await garbageCollect(s),json);break;
      default:throw new TimeWarpError("Unknown command: "+cmd+"\n\n"+HELP,"ARGUMENT");
    }
  });
}
main().catch(e=>{
  const message=e instanceof Error?e.message:String(e);
  console.error("TimeWarp: "+message);
  if(e instanceof TimeWarpError)process.exitCode=e.code==="ARGUMENT"?2:e.code==="CONFLICT"?3:1;
  else process.exitCode=1;
});
