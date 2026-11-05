
import { mkdir, copyFile } from "node:fs/promises";
await mkdir(new URL("../dist/ui/",import.meta.url),{recursive:true});
for(const name of ["index.html","app.js","style.css"])await copyFile(new URL("../ui/"+name,import.meta.url),new URL("../dist/ui/"+name,import.meta.url));
