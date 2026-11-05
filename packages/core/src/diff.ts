
import { readFile } from "node:fs/promises";
import { blobPath } from "./files.js";
import { Store } from "./store.js";
import { type FileRecord } from "./types.js";
export interface ChangedFile {path:string; status:"added"|"removed"|"modified";before:string|null;after:string|null;}
export function compareFileMaps(a:Map<string,FileRecord>,b:Map<string,FileRecord>):ChangedFile[]{
  const names=[...new Set([...a.keys(),...b.keys()])].sort();
  const result:ChangedFile[]=[];
  for(const path of names){
    const x=a.get(path),y=b.get(path);
    if(x?.sha===y?.sha && x?.mode===y?.mode)continue;
    result.push({path,status:!x?"added":!y?"removed":"modified",before:x?.sha??null,after:y?.sha??null});
  }
  return result;
}
export function compareCheckpoints(s:Store,a:string,b:string):ChangedFile[]{
  return compareFileMaps(s.checkpointFiles(a),s.checkpointFiles(b));
}
export async function blobText(s:Store,sha:string|null):Promise<string|null>{
  if(!sha)return "";
  const {size}=await import("node:fs/promises").then(fs=>fs.stat(blobPath(s,sha)));
  if(size>512*1024)return null;
  const data=await readFile(blobPath(s,sha));
  if(data.includes(0))return null;
  return data.toString("utf8");
}
export function unifiedDiff(before:string,after:string,limit=1200):string{
  const a=before.split("\n"),b=after.split("\n");
  if(a.length>limit||b.length>limit)return "Diff truncated: source exceeds "+limit+" lines.";
  const n=a.length,m=b.length;
  const matrix=new Uint16Array((n+1)*(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)
    matrix[i*(m+1)+j]=a[i]===b[j]?matrix[(i+1)*(m+1)+j+1]!+1:Math.max(matrix[(i+1)*(m+1)+j]!,matrix[i*(m+1)+j+1]!);
  let i=0,j=0;const result=["--- before","+++ after"];
  while(i<n||j<m){
    if(i<n&&j<m&&a[i]===b[j]){result.push(" "+a[i]!);i++;j++;}
    else if(j<m&&(i===n||matrix[i*(m+1)+j+1]!>=matrix[(i+1)*(m+1)+j]!)){result.push("+"+b[j]!);j++;}
    else{result.push("-"+a[i]!);i++;}
  }
  return result.join("\n");
}
export async function diffBlob(s:Store,before:string|null,after:string|null):Promise<string>{
  const a=await blobText(s,before),b=await blobText(s,after);
  if(a===null||b===null)return "Binary or large file: textual diff not available.";
  return unifiedDiff(a,b);
}
