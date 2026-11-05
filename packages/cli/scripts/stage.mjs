
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
const out=new URL("../release/",import.meta.url);
await mkdir(new URL("./ui/",out),{recursive:true});
await build({
  entryPoints:[fileURLToPath(new URL("../dist/cli.js",import.meta.url))],
  bundle:true,platform:"node",format:"esm",target:"node22",
  outfile:fileURLToPath(new URL("./cli.js",out)),
  legalComments:"none"
});
for(const name of ["index.html","style.css","app.js"])await copyFile(new URL("../ui/"+name,import.meta.url),new URL("./ui/"+name,out));
await writeFile(new URL("./package.json",out),JSON.stringify({
  name:"timewarp-dev",version:"0.1.0",description:"Your AI broke your project? Rewind everything.",
  type:"module",license:"MIT",bin:{timewarp:"./cli.js"},
  engines:{node:">=22.13.0"},
  repository:{type:"git",url:"https://github.com/l3nnardwlg/TimeWarp.git"}
},null,2)+"\n");
await copyFile(new URL("../README.md",import.meta.url),new URL("./README.md",out));
