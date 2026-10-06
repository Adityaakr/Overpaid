// Re-renders Necta phone screens with Ombud content.
// Keeps the original PNG as the base, paints over only the text regions, and draws new text on top.
// Usage: node render.js [screenName ...]   (default: all)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const specs = require('./specs');

const IMG = path.resolve(__dirname, '../necta/img');
const OUT = path.resolve(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

// Inter metrics: with line-height equal to font-size, the baseline sits 0.864em below the box top.
const BASELINE = { Inter: 0.864, Poppins: 0.85 };

function patchHtml(p, base, w, h) {
  const style = `position:absolute;left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;`;
  if (p.clone) {
    // Copy a text-free area of the same image, offset by dx/dy, to keep gradients intact.
    const dx = p.clone.dx || 0;
    const dy = p.clone.dy || 0;
    return `<div style="${style}background:url('${base}') ${-(p.x + dx)}px ${-(p.y + dy)}px / ${w}px ${h}px no-repeat;"></div>`;
  }
  const radius = p.circle ? 'border-radius:50%;' : p.radius ? `border-radius:${p.radius}px;` : '';
  return `<div style="${style}background:${p.fill || '#000'};${radius}"></div>`;
}

function textHtml(t) {
  const fs_ = t.fs;
  const font = t.font || 'Inter';
  const top = t.base - (BASELINE[font] || 0.864) * fs_;
  const common = `position:absolute;top:${top}px;font:${t.wt || 400} ${fs_}px/${fs_}px '${font}';color:${t.c || '#fff'};white-space:nowrap;letter-spacing:${t.ls || 0}em;`;
  let pos;
  if (t.align === 'right') pos = `right:${t.W - t.x}px;text-align:right;`;
  else if (t.align === 'center') pos = `left:${t.x}px;transform:translateX(-50%);text-align:center;`;
  else pos = `left:${t.x}px;`;
  return `<div style="${common}${pos}">${t.html || escapeHtml(t.t)}</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pageHtml(spec) {
  const base = 'data:image/png;base64,' + fs.readFileSync(path.join(IMG, spec.base)).toString('base64');
  const { w, h } = spec;
  const interp = (spec.patches || []).filter((p) => p.interp);
  const patches = (spec.patches || []).filter((p) => !p.interp).map((p) => patchHtml(p, base, w, h)).join('\n');
  const texts = (spec.texts || []).map((t) => textHtml({ ...t, W: w })).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>html,body{margin:0;background:transparent}#s{position:relative;width:${w}px;height:${h}px;overflow:hidden}
</style></head>
<body><div id="s"><canvas id="c" width="${w}" height="${h}" style="position:absolute;left:0;top:0"></canvas>
<script>
// Inpaint 'interp' patches: per column, blend linearly between the pixel rows just above and below the patch.
(function(){const img=new Image();img.onload=function(){const c=document.getElementById('c'),x=c.getContext('2d');x.drawImage(img,0,0);
const P=${JSON.stringify(interp)};for(const p of P){const d=x.getImageData(p.x,p.y-1,p.w,p.h+2);const W=p.w,H=p.h+2;
for(let i=0;i<W;i++){const t=[0,1,2,3].map(k=>d.data[(i)*4+k]),b=[0,1,2,3].map(k=>d.data[((H-1)*W+i)*4+k]);
for(let j=1;j<H-1;j++){const f=j/(H-1);for(let k=0;k<4;k++)d.data[(j*W+i)*4+k]=t[k]*(1-f)+b[k]*f;}}x.putImageData(d,p.x,p.y-1);}
window.__ready=true;};img.src=${JSON.stringify(base)};})();
</script>
${patches}
${spec.extra || ''}
${texts}
</div></body></html>`;
}

(async () => {
  const want = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const spec of specs) {
    if (want.length && !want.includes(spec.name)) continue;
    const file = path.join(OUT, spec.name + '.html');
    fs.writeFileSync(file, pageHtml(spec));
    await page.setViewportSize({ width: spec.w, height: spec.h });
    await page.goto('file://' + file);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => window.__ready === true);
    await page.waitForTimeout(150);
    await page.locator('#s').screenshot({ path: path.join(OUT, spec.name + '.png'), omitBackground: true });
    // Side-by-side comparison against the original, for review.
    const cmp = `<!doctype html><body style="margin:0;background:#888;display:flex;gap:16px;padding:16px">
<img src="file://${path.join(IMG, spec.base)}" style="width:${spec.w / 2}px"><img src="file://${path.join(OUT, spec.name + '.png')}" style="width:${spec.w / 2}px"></body>`;
    fs.writeFileSync(path.join(OUT, spec.name + '.cmp.html'), cmp);
    await page.setViewportSize({ width: spec.w + 48, height: spec.h / 2 + 32 });
    await page.goto('file://' + path.join(OUT, spec.name + '.cmp.html'));
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(OUT, spec.name + '.cmp.png') });
    console.log('rendered', spec.name);
  }
  await browser.close();
})();
