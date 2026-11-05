
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir, cpus, totalmem, platform, release, arch } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Store, initializeState, reconcile } from "../packages/core/dist/index.js";
const count=Number(process.argv[2]||1000);
if(!Number.isInteger(count)||count<1||count>50000)throw new Error("Usage: node scripts/benchmark.mjs [1..50000]");
const root=await mkdtemp(join(tmpdir(),"timewarp-bench-"));
let store;
try{
  await mkdir(join(root,"src"));
  const create=performance.now();
  for(let n=0;n<count;n++)await writeFile(join(root,"src","file-"+n+".ts"),"export const value = "+n+";\n");
  const generationMs=performance.now()-create;
  store=new Store(root,true);
  const baseline=performance.now();
  await initializeState(store);
  const baselineMs=performance.now()-baseline;
  const session=store.startSession();
  await writeFile(join(root,"src","file-0.ts"),"export const value = 999999;\n");
  const begin=performance.now();
  const changed=await reconcile(store,session.id);
  const reconcileMs=performance.now()-begin;
  store.endSession(session.id);
  console.log(JSON.stringify({
    fileCount:count,
    generationMs:Math.round(generationMs),
    baselineMs:Math.round(baselineMs),
    reconcileMs:Math.round(reconcileMs),
    changes:changed.changes,
    node:process.version,
    platform:platform(),release:release(),arch:arch(),
    cpus:cpus().length,totalMemBytes:totalmem(),
    rssBytes:process.memoryUsage().rss
  },null,2));
}finally{store?.close();await rm(root,{recursive:true,force:true});}
