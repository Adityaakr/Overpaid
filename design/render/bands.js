// Ink bands with x-segments and dominant (brightest-quartile) color per segment.
const fs=require('fs'),{PNG}=require('pngjs');
const f=process.argv[2], thr=+(process.argv[3]||40), gapPct=+(process.argv[4]||3);
const png=PNG.sync.read(fs.readFileSync(f)); const {width:w,height:h,data:d}=png;
const lum=(x,y)=>{const i=(y*w+x)*4; return d[i+3]>20?(d[i]+d[i+1]+d[i+2])/3:0;};
const ink=(x,y)=>lum(x,y)>thr;
let inBand=false,y0=0; const bands=[];
for(let y=0;y<h;y++){let c=0; for(let x=0;x<w;x++) if(ink(x,y)){c++;}
  if(c>0&&!inBand){inBand=true;y0=y;} if(c===0&&inBand){inBand=false;bands.push([y0,y-1]);} }
if(inBand) bands.push([y0,h-1]);
const hex=v=>v.toString(16).padStart(2,'0');
for(const [a,b] of bands){
  const col=new Array(w).fill(0); for(let y=a;y<=b;y++) for(let x=0;x<w;x++) if(ink(x,y)) col[x]=1;
  const segs=[]; let s=-1,gap=0,last=0; for(let x=0;x<w;x++){ if(col[x]){ if(s<0) s=x; gap=0; last=x;} else if(s>=0){ gap++; if(gap>Math.round(w*gapPct/100)){ segs.push([s,last]); s=-1; } } }
  if(s>=0) segs.push([s,last]);
  const out=segs.map(([p,q])=>{ const px=[]; for(let y=a;y<=b;y++) for(let x=p;x<=q;x++) if(ink(x,y)){const i=(y*w+x)*4; px.push([d[i],d[i+1],d[i+2],(d[i]+d[i+1]+d[i+2])]);}
    px.sort((m,n)=>n[3]-m[3]); const top=px.slice(0,Math.max(1,Math.floor(px.length*0.25))); const av=[0,1,2].map(k=>Math.round(top.reduce((s,p)=>s+p[k],0)/top.length));
    return `${p}-${q} #${av.map(hex).join('')}`; });
  console.log(`y ${a}-${b} (h${b-a+1}) ${out.join(' | ')}`);
}
