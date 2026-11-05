
import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
const size=256;
function crc32(buf){
  let crc=0xffffffff;
  for(const byte of buf){
    crc^=byte;
    for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
function chunk(type,data){
  const name=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name,data])));
  return Buffer.concat([len,name,data,crc]);
}
function segmentDistance(x,y,ax,ay,bx,by){
  const dx=bx-ax,dy=by-ay;
  const t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(x-(ax+t*dx),y-(ay+t*dy));
}
const raw=Buffer.alloc((size*4+1)*size);
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const sx=x/2,sy=y/2,cx=64,cy=64;
  const px=Math.max(Math.abs(sx-cx)-28,0),py=Math.max(Math.abs(sy-cy)-28,0);
  const edge=Math.hypot(px,py);
  const within=Math.max(0,Math.min(1,(31-edge)*2));
  const a=Math.atan2(sy-cy,sx-cx);
  // Rounded TimeWarp dial, circular rewind arrow and clock hand.
  const radius=Math.hypot(sx-cx,sy-cy);
  const ring=Math.abs(radius-34)<4.5 && (a>-2.45||a< -2.9);
  const rewind=segmentDistance(sx,sy,27,36,27,55)<4.2 ||
    segmentDistance(sx,sy,27,55,46,55)<4.2;
  const clock=segmentDistance(sx,sy,65,42,65,65)<4 ||
    segmentDistance(sx,sy,65,65,83,78)<4;
  const white=ring||rewind||clock;
  const i=y*(size*4+1)+1+x*4;
  if(x===0)raw[y*(size*4+1)]=0;
  const grad=(sx+sy)/256;
  raw[i]=white?255:Math.round(108+35*grad);
  raw[i+1]=white?255:Math.round(84+49*grad);
  raw[i+2]=white?255:Math.round(227+24*grad);
  raw[i+3]=Math.round(within*255);
}
const ihdr=Buffer.alloc(13);
ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
const png=Buffer.concat([
  Buffer.from([137,80,78,71,13,10,26,10]),
  chunk("IHDR",ihdr),
  chunk("IDAT",deflateSync(raw,{level:9})),
  chunk("IEND",Buffer.alloc(0))
]);
const dest=new URL("../src-tauri/icons/",import.meta.url);
await mkdir(dest,{recursive:true});
await writeFile(new URL("icon.png",dest),png);
console.log("Generated native TimeWarp icon.png ("+png.length+" bytes).");
