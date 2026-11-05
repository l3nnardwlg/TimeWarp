
import { createReadStream, createWriteStream, constants, existsSync } from "node:fs";
import { mkdir, lstat, readdir, unlink, rename, chmod, readFile, open, statfs } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { Store } from "./store.js";
import { TimeWarpError, type FileRecord } from "./types.js";
const defaultSegments = new Set([".git",".timewarp","node_modules",".next","dist","build","coverage",".turbo",".cache","target",".venv","venv"]);
function globToRegex(glob: string): RegExp {
  // Trailing slash denotes a directory and all descendants.
  if(glob.endsWith("/"))glob=glob.slice(0,-1);
  let result = "";
  for(let i=0;i<glob.length;i++){
    const c=glob[i]!;
    if(c==="*"){if(glob[i+1]==="*"){result+=".*";i++;}else result+="[^/]*";}
    else if(c==="?")result+=".";
    else result+=".+^$[]{}()|\\".includes(c)?"\\"+c:c;
  }
  return new RegExp("^(?:.*/)?" + result + "(?:/.*)?$");
}
export async function exclusions(s:Store): Promise<(p:string)=>boolean> {
  let content="";
  try { content=await readFile(join(s.root,".timewarpignore"),"utf8"); } catch { /* optional */ }
  const rules=content.split(/\r?\n/).map(x=>x.trim()).filter(x=>x && !x.startsWith("#")).map(x=>({negate:x.startsWith("!"),regex:globToRegex((x.startsWith("!")?x.slice(1):x).replace(/^\//,""))}));
  return p=>{
    const parts=p.split("/");
    if(parts.some(x=>defaultSegments.has(x)))return true;
    let ignored=false;
    for(const r of rules)if(r.regex.test(p))ignored=!r.negate;
    return ignored;
  };
}
export function assertSafeRelative(s:Store,p:string):string {
  if(!p || p.includes("\0") || isAbsolute(p) || p.includes("\\") || p.split("/").some(x=>x===".."||x==="."||!x)) throw new TimeWarpError("Unsafe relative path: " + p,"UNSAFE_PATH");
  const target=resolve(s.root,...p.split("/"));
  if(target===s.root || !target.startsWith(s.root+sep)) throw new TimeWarpError("Path escapes project: " + p,"UNSAFE_PATH");
  if(p.split("/").some(x=>defaultSegments.has(x))) throw new TimeWarpError("Protected path: " + p,"UNSAFE_PATH");
  return target;
}
export async function assertNoSymlink(s:Store,p:string):Promise<string>{
  const target=assertSafeRelative(s,p);
  let cur=s.root;
  for(const segment of p.split("/")){
    cur=join(cur,segment);
    try{ const st=await lstat(cur); if(st.isSymbolicLink())throw new TimeWarpError("Symlink traversal is forbidden: "+p,"UNSAFE_PATH");}
    catch(e){ if((e as NodeJS.ErrnoException).code==="ENOENT")break;throw e; }
  }
  return target;
}
export async function walk(s:Store):Promise<{files: Array<{path:string;size:number;mode:number;mtimeMs:number}>; dirs:string[]}>{
  const ignore=await exclusions(s);
  const files:Array<{path:string;size:number;mode:number;mtimeMs:number}>=[];
  const dirs:string[]=[];
  const pending=[""];
  while(pending.length){
    const base=pending.pop()!;
    const directory=base?await assertNoSymlink(s,base):s.root;
    let entries;
    try{entries=await readdir(directory,{withFileTypes:true});}
    catch(e){throw new TimeWarpError("Cannot scan "+directory+": "+String(e),"SCAN_FAILED");}
    for(const entry of entries){
      const p=base?base+"/"+entry.name:entry.name;
      if(ignore(p) || entry.isSymbolicLink())continue;
      if(entry.isDirectory()){dirs.push(p);pending.push(p);continue;}
      if(!entry.isFile())continue;
      const st=await lstat(join(directory,entry.name));
      if(!st.isFile())continue;
      if(st.size>s.config.maxFileBytes)throw new TimeWarpError("File exceeds maxFileBytes: "+p+" ("+st.size+" bytes). Exclude it in .timewarpignore or increase the limit.","FILE_TOO_LARGE");
      files.push({path:p,size:st.size,mode:st.mode & 0o777,mtimeMs:st.mtimeMs});
    }
  }
  files.sort((a,b)=>a.path.localeCompare(b.path));
  dirs.sort();
  return {files,dirs};
}
export async function hashFile(path:string):Promise<string>{
  const h=createHash("sha256");
  for await(const chunk of createReadStream(path))h.update(chunk);
  return h.digest("hex");
}
export function blobPath(s:Store,sha:string):string {
  if(!/^[a-f0-9]{64}$/.test(sha))throw new TimeWarpError("Invalid blob digest.","INVALID_BLOB");
  return join(s.dir,"objects",sha.slice(0,2),sha);
}
export async function recordBlob(s:Store,p:string):Promise<FileRecord>{
  const target=await assertNoSymlink(s,p);
  await mkdir(join(s.dir,"tmp"),{recursive:true,mode:0o700});
  for(let attempt=0;attempt<3;attempt++){
    const handle=await open(target,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before=await handle.stat();
    if(!before.isFile()){await handle.close();throw new TimeWarpError("Not a regular file: "+p,"NOT_A_FILE");}
    if(before.size>s.config.maxFileBytes){await handle.close();throw new TimeWarpError("File too large to snapshot: "+p,"FILE_TOO_LARGE");}
    const tmp=join(s.dir,"tmp",randomUUID()+".blob");
    const hash=createHash("sha256");
    let changed=false;
    try{
      await pipeline(handle.createReadStream({autoClose:false}),new Transform({transform(chunk:Buffer,_enc,cb){hash.update(chunk);cb(null,chunk);}}),createWriteStream(tmp,{flags:"wx",mode:0o600}));
      const after=await handle.stat();
      changed=after.size!==before.size || after.mtimeMs!==before.mtimeMs || after.ino!==before.ino;
      if(!changed){
        const sha=hash.digest("hex");
        const dest=blobPath(s,sha);
        await mkdir(dirname(dest),{recursive:true,mode:0o700});
        if(existsSync(dest))await unlink(tmp);
        else{try{await rename(tmp,dest);}catch(e){if(existsSync(dest))await unlink(tmp);else throw e;}}
        return {path:p,sha,size:after.size,mode:after.mode&0o777,mtimeMs:after.mtimeMs};
      }
    }catch(e){try{await unlink(tmp);}catch{}throw e;}
    finally{await handle.close();}
    if(changed)await unlink(tmp);
  }
  throw new TimeWarpError("File kept changing during snapshot: "+p,"CONCURRENT_CHANGE");
}
export async function verifyBlob(s:Store,sha:string):Promise<void>{
  const p=blobPath(s,sha);
  if(!existsSync(p) || await hashFile(p)!==sha)throw new TimeWarpError("Snapshot object missing or corrupted: "+sha,"CORRUPT_BLOB");
}
export async function currentFiles(s:Store):Promise<Map<string,FileRecord>>{
  const snapshot=await walk(s); const result=new Map<string,FileRecord>();
  for(const item of snapshot.files)result.set(item.path,await recordBlob(s,item.path));
  return result;
}
export async function diskAvailable(s:Store):Promise<number>{
  try{const st=await statfs(s.root);return Number(st.bavail)*Number(st.bsize);}
  catch{return Number.MAX_SAFE_INTEGER;}
}
export async function writeBlobAtomic(s:Store,p:string,sha:string,mode=0o644):Promise<void>{
  const dest=await assertNoSymlink(s,p);
  await verifyBlob(s,sha);
  await mkdir(dirname(dest),{recursive:true,mode:0o700});
  await assertNoSymlink(s,p);
  const tmp=join(dirname(dest),".timewarp-restore-"+randomUUID());
  try{
    await pipeline(createReadStream(blobPath(s,sha)),createWriteStream(tmp,{flags:"wx",mode:0o600}));
    if(await hashFile(tmp)!==sha)throw new TimeWarpError("Temporary restore file failed verification.","CORRUPT_BLOB");
    await chmod(tmp,mode & 0o777);
    await assertNoSymlink(s,p);
    await rename(tmp,dest);
  }finally{try{await unlink(tmp);}catch{}}
}
export async function deleteSafe(s:Store,p:string):Promise<void>{
  const dest=await assertNoSymlink(s,p);
  try{await unlink(dest);}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
}
export async function ensureReadable(s:Store,p:string):Promise<void>{
  const dest=await assertNoSymlink(s,p);
  const fh=await open(dest,"r"); await fh.close();
}
