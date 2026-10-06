// bands within a region: node region.js file thr x0 x1 y0 y1
const fs=require('fs'),{PNG}=require('pngjs');
const [f,thr,x0,x1,y0,y1]=process.argv.slice(2); const T=+thr;
const png=PNG.sync.read(fs.readFileSync(f)); const {width:w,data:d}=png;
const ink=(x,y)=>{const i=(y*w+x)*4; return (d[i]+d[i+1]+d[i+2])/3>T;};
const inv=process.env.DARK==='1';
const isInk=(x,y)=>inv? !ink(x,y) : ink(x,y);
let inB=false,s=0;
for(let y=+y0;y<=+y1;y++){ let minx=1e9,maxx=-1; for(let x=+x0;x<=+x1;x++) if(isInk(x,y)){ if(x<minx)minx=x; maxx=x; }
  const has=maxx>=0; if(has&&!inB){inB=true;s=y;var mn=minx,mx=maxx;} if(has&&inB){mn=Math.min(mn,minx);mx=Math.max(mx,maxx);} if(!has&&inB){inB=false; console.log(`y ${s}-${y-1} (h${y-s}) x ${mn}-${mx}`);} }
if(inB) console.log(`y ${s}-${y1} x ${mn}-${mx}`);
