// Swap text inside raster UI images while keeping the rest of the art untouched.
// For each replacement: locate the words with Tesseract (or use a manual rect), fill the box
// with the surrounding background, and draw the new text at the same size, color and baseline.
// Usage: node ocrpatch.js <specs.json> [name...]
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { PNG } = require('pngjs');
const { chromium } = require('playwright');

const IMG = path.resolve(__dirname, '../../apps/web/public/mk/img');
const OUT = path.resolve(__dirname, '../../apps/web/public/mk/ombud');
fs.mkdirSync(OUT, { recursive: true });

function readImage(file) {
  const tmp = path.join(__dirname, '.tmp', `ocrp-${path.basename(file)}.png`);
  execSync(`sips -s format png "${file}" --out "${tmp}"`, { stdio: 'ignore' });
  const png = PNG.sync.read(fs.readFileSync(tmp));
  // OCR reads a copy flattened onto white (transparent pixels confuse it).
  const flat = new PNG({ width: png.width, height: png.height });
  for (let i = 0; i < png.data.length; i += 4) {
    const a = png.data[i + 3] / 255;
    for (let k = 0; k < 3; k++) flat.data[i + k] = Math.round(png.data[i + k] * a + 255 * (1 - a));
    flat.data[i + 3] = 255;
  }
  const flatPath = tmp.replace(/\.png$/, '-flat.png');
  fs.writeFileSync(flatPath, PNG.sync.write(flat));
  return { png, pngPath: tmp, flatPath };
}

function ocr(pngPath, scale) {
  let src = pngPath;
  if (scale && scale !== 1) {
    const up = pngPath.replace('.png', `-x${scale}.png`);
    const w = +execSync(`sips -g pixelWidth "${pngPath}"`).toString().match(/pixelWidth: (\d+)/)[1];
    execSync(`sips --resampleWidth ${Math.round(w * scale)} "${pngPath}" --out "${up}"`, { stdio: 'ignore' });
    src = up;
  }
  const { spawnSync } = require('child_process');
  const res = spawnSync('tesseract', [src, 'stdout', '--psm', '11', 'tsv'], { encoding: 'utf8' });
  const tsv = res.stdout || '';
  const rows = tsv.trim().split('\n').slice(1).map((l) => l.split('\t'));
  return rows
    .filter((r) => r.length >= 12 && r[11].trim() && +r[10] > 10)
    .map((r) => ({ text: r[11].trim(), left: +r[6] / scale, top: +r[7] / scale, width: +r[8] / scale, height: +r[9] / scale, block: r[2], par: r[3], line: r[4] }));
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9$%+.,:&]/g, '');

function findWords(words, find, nth = 0) {
  const toks = find.split(/\s+/).map(norm).filter(Boolean);
  const hits = [];
  for (let i = 0; i < words.length; i++) {
    let ok = true;
    for (let k = 0; k < toks.length; k++) {
      const w = words[i + k];
      if (!w || norm(w.text) !== toks[k]) { ok = false; break; }
      if (k > 0 && Math.abs(w.top - words[i].top) > words[i].height) { ok = false; break; }
    }
    if (ok) hits.push(words.slice(i, i + toks.length));
  }
  const h = hits[nth];
  if (!h) return null;
  const l = Math.min(...h.map((w) => w.left));
  const t = Math.min(...h.map((w) => w.top));
  const r = Math.max(...h.map((w) => w.left + w.width));
  const b = Math.max(...h.map((w) => w.top + w.height));
  return { x: l, y: t, w: r - l, h: b - t, text: h.map((w) => w.text).join(' ') };
}

function px(png, x, y) {
  x = Math.max(0, Math.min(png.width - 1, Math.round(x)));
  y = Math.max(0, Math.min(png.height - 1, Math.round(y)));
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
}
const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

function sampleBg(png, r, pad) {
  const pts = [];
  for (let x = r.x - pad; x <= r.x + r.w + pad; x += 1) {
    pts.push(px(png, x, r.y - pad), px(png, x, r.y + r.h + pad));
  }
  for (let y = r.y - pad; y <= r.y + r.h + pad; y += 1) {
    pts.push(px(png, r.x - pad, y), px(png, r.x + r.w + pad, y));
  }
  pts.sort((a, b) => lum(a) - lum(b));
  const m = pts[Math.floor(pts.length / 2)];
  return `rgb(${m[0]},${m[1]},${m[2]})`;
}

function sampleInk(png, r, bg) {
  const bgL = lum(bg.match(/\d+/g).map(Number));
  const pts = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) pts.push(px(png, x, y));
  pts.sort((a, b) => Math.abs(lum(b) - bgL) - Math.abs(lum(a) - bgL));
  const top = pts.slice(0, Math.max(1, Math.floor(pts.length * 0.06)));
  const c = [0, 1, 2].map((k) => Math.round(top.reduce((s, p) => s + p[k], 0) / top.length));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const hasDesc = (s) => /[gjpqy,]/.test(s);
const hasAsc = (s) => /[A-Zbdfhklt0-9$%#&]/.test(s);

async function run(specs, only) {
  const browser = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const spec of specs) {
    if (only.length && !only.includes(spec.name)) continue;
    const file = path.join(spec.from === 'ombud' ? OUT : IMG, spec.src);
    const { png, pngPath, flatPath } = readImage(file);
    const words = ocr(flatPath, spec.ocrScale || 1);
    const ops = [];
    for (const r of spec.replace) {
      let box = r.rect ? { x: r.rect[0], y: r.rect[1], w: r.rect[2], h: r.rect[3], text: r.find || '' } : findWords(words, r.find, r.nth || 0);
      if (!box) {
        console.log(`  ! ${spec.name}: not found "${r.find}"`);
        continue;
      }
      const pad = r.pad ?? Math.max(2, Math.round(box.h * 0.18));
      const bg = r.bg || sampleBg(png, box, pad + 1);
      const ink = r.color || sampleInk(png, box, bg);
      const t = box.text || r.find || '';
      const desc = r.desc ?? hasDesc(t);
      const asc = hasAsc(t);
      const fs_ = r.size || box.h / ((desc ? 0.24 : 0) + (asc ? 0.74 : 0.55));
      const baseline = r.baseline ?? (desc ? box.y + box.h - 0.24 * fs_ : box.y + box.h);
      ops.push({ box, pad, bg, ink, fs: fs_, baseline, to: r.to, weight: r.weight || 500, align: r.align || 'left', ls: r.ls ?? -0.02, clear: r.clear });
    }
    const w = png.width, h = png.height;
    const data = 'data:image/png;base64,' + fs.readFileSync(pngPath).toString('base64');
    const html = `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500;14..32,600;14..32,700&display=swap" rel="stylesheet">
<style>html,body{margin:0;background:transparent}#s{position:relative;width:${w}px;height:${h}px;overflow:hidden}#s>img{position:absolute;inset:0;width:${w}px;height:${h}px}
.t{position:absolute;white-space:pre;font-family:Inter;font-variation-settings:'opsz' 32}</style></head><body><div id="s"><img src="${data}">
${ops.map((o) => `<div style="position:absolute;left:${o.box.x - o.pad}px;top:${o.box.y - o.pad}px;width:${o.box.w + o.pad * 2}px;height:${o.box.h + o.pad * 2}px;background:${o.bg};${o.clear ? '' : ''}"></div>`).join('\n')}
${ops.filter((o) => o.to !== '').map((o) => {
  const top = o.baseline - 0.864 * o.fs;
  const pos = o.align === 'right' ? `right:${w - (o.box.x + o.box.w)}px;text-align:right;` : o.align === 'center' ? `left:${o.box.x + o.box.w / 2}px;transform:translateX(-50%);` : `left:${o.box.x}px;`;
  return `<div class="t" style="${pos}top:${top}px;font-size:${o.fs}px;line-height:${o.fs}px;font-weight:${o.weight};color:${o.ink};letter-spacing:${o.ls}em">${o.to.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`;
}).join('\n')}
</div></body></html>`;
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    const outName = spec.out || spec.src.replace(/\.(jpe?g|png)$/, '.png');
    await page.locator('#s').screenshot({ path: path.join(OUT, outName), omitBackground: true });
    console.log(`ok ${spec.name} (${ops.length} swaps) -> ${outName}`);
  }
  await browser.close();
}

const [specFile, ...only] = process.argv.slice(2);
run(JSON.parse(fs.readFileSync(specFile, 'utf8')), only);
