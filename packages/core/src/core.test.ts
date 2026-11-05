
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rename, unlink, mkdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.js";
import { initializeState, checkpoint, verifyCheckpoint } from "./snapshots.js";
import { reconcile } from "./recorder.js";
import { planRestore, restore, undo, recover } from "./restore.js";
import { blobPath, assertSafeRelative, assertNoSymlink } from "./files.js";
import { unifiedDiff } from "./diff.js";
async function fixture(fn:(s:Store,dir:string)=>Promise<void>){
  const dir=await mkdtemp(join(tmpdir(),"timewarp-test-"));
  const s=new Store(dir,true);
  try{await fn(s,dir);}finally{s.close();await rm(dir,{recursive:true,force:true});}
}
test("initializes a durable baseline and verifies SHA-256",async()=>{
  await fixture(async(s,dir)=>{
    await writeFile(join(dir,"hello.txt"),"original\n");
    const cp=await initializeState(s);
    assert.equal(cp.fileCount,1);
    assert.equal((await verifyCheckpoint(s,cp.id)).verified,1);
    const digest=s.checkpointFiles(cp.id).get("hello.txt")!.sha;
    assert.equal(digest.length,64);
    const after=new Store(dir);
    assert.equal(after.checkpoints(1)[0]!.id,cp.id);
    after.close();
  });
});
test("records actual create, edit, rename, deletion events",async()=>{
  await fixture(async(s,dir)=>{
    await initializeState(s);
    const session=s.startSession();
    await writeFile(join(dir,"one.txt"),"alpha");
    assert.equal((await reconcile(s,session.id)).changes,1);
    await writeFile(join(dir,"one.txt"),"beta");
    await reconcile(s,session.id);
    await rename(join(dir,"one.txt"),join(dir,"two.txt"));
    await reconcile(s,session.id);
    await unlink(join(dir,"two.txt"));
    await reconcile(s,session.id);
    const types=s.events(20).map(e=>e.eventType);
    for(const kind of ["created","modified","renamed","deleted"])assert.ok(types.includes(kind as never),kind);
    assert.ok(s.events(20).every(e=>e.source==="filesystem"&&e.agentId===null));
  });
});
test("ignored paths never enter snapshots",async()=>{
  await fixture(async(s,dir)=>{
    await mkdir(join(dir,"node_modules"));
    await writeFile(join(dir,"node_modules","secret.txt"),"private");
    await writeFile(join(dir,".timewarpignore"),"ignored.txt\n");
    await writeFile(join(dir,"ignored.txt"),"private");
    await writeFile(join(dir,"included.txt"),"included");
    const cp=await initializeState(s),paths=[...s.checkpointFiles(cp.id).keys()];
    assert.ok(paths.includes("included.txt"));
    assert.ok(!paths.includes("ignored.txt"));
    assert.ok(!paths.some(x=>x.startsWith("node_modules")));
  });
});
test("restore previews, saves safety checkpoint and undo is reversible",async()=>{
  await fixture(async(s,dir)=>{
    const path=join(dir,"app.ts");
    await writeFile(path,"working\n");
    const baseline=await initializeState(s);
    await writeFile(path,"AI BROKE IT\n");
    await writeFile(join(dir,"new.txt"),"new file");
    const session=s.startSession();
    await reconcile(s,session.id);
    const plan=await planRestore(s,baseline.id);
    assert.equal(plan.modified,1);
    assert.equal(plan.deleted,1);
    assert.equal(await readFile(path,"utf8"),"AI BROKE IT\n");
    const result=await restore(s,baseline.id);
    assert.equal(result.changed,2);
    assert.equal(await readFile(path,"utf8"),"working\n");
    await assert.rejects(readFile(join(dir,"new.txt")));
    assert.equal((await verifyCheckpoint(s,result.safetyCheckpointId)).files,2);
    await undo(s);
    assert.equal(await readFile(path,"utf8"),"AI BROKE IT\n");
    assert.equal(await readFile(join(dir,"new.txt"),"utf8"),"new file");
  });
});
test("corrupt object blocks restore before changing working files",async()=>{
  await fixture(async(s,dir)=>{
    const path=join(dir,"file.txt");
    await writeFile(path,"safe");
    const cp=await initializeState(s);
    await writeFile(path,"changed");
    const sha=s.checkpointFiles(cp.id).get("file.txt")!.sha;
    await writeFile(blobPath(s,sha),"tampered");
    await assert.rejects(restore(s,cp.id),/corrupted/);
    assert.equal(await readFile(path,"utf8"),"changed");
  });
});
test("pending interrupted restore can be recovered idempotently",async()=>{
  await fixture(async(s,dir)=>{
    const path=join(dir,"data.txt");
    await writeFile(path,"before");
    const cp=await initializeState(s);
    const safety=await checkpoint(s,"safety");
    s.addRestore("crashed",cp.id,safety.id,{checkpointId:cp.id,operations:[],created:0,modified:0,deleted:0});
    await writeFile(path,"partial");
    assert.equal((await recover(s)).recovered,1);
    assert.equal(await readFile(path,"utf8"),"before");
    assert.equal((await recover(s)).recovered,0);
  });
});
test("blocks traversal and symlink escapes",async()=>{
  await fixture(async(s,dir)=>{
    assert.throws(()=>assertSafeRelative(s,"../outside.txt"),/Unsafe/);
    assert.throws(()=>assertSafeRelative(s,".timewarp/timeline.sqlite"),/Protected/);
    const dest=await mkdtemp(join(tmpdir(),"timewarp-outside-"));
    try{
      try{await symlink(dest,join(dir,"escape"),"dir");}
      catch{return;}
      await assert.rejects(assertNoSymlink(s,"escape/secret.txt"),/Symlink/);
    }finally{await rm(dest,{recursive:true,force:true});}
  });
});
test("text diff is real and non-identical",()=>{
  const result=unifiedDiff("a\nb\n","a\nc\n");
  assert.ok(result.includes("-b"));
  assert.ok(result.includes("+c"));
});
