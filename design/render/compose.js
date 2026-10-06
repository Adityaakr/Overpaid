// Carry patched panel edits into composite screenshots that contain the same panels at another scale.
// For each panel: OCR both images, find the scale+offset that maps panel words onto composite words
// (RANSAC over word pairs), diff original vs patched panel, and paste only the changed regions, scaled.
// Usage: node compose.js <composite-file> <panel-file>...   (files are basenames in public/mk/img)
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { PNG } = require('pngjs');
const { chromium } = require('playwright');

const IMG = path.resolve(__dirname, '../../apps/web/public/mk/img');
const OUT = path.resolve(__dirname, '../../apps/web/public/mk/ombud');
const TMP = path.join(__dirname, '.tmp');

function load(file) {
  const tmp = path.join(TMP, 'cmp-' + path.basename(file) + '.png');
  execSync(`sips -s format png "${file}" --out "${tmp}"`, { stdio: 'ignore' });
  return { png: PNG.sync.read(fs.readFileSync(tmp)), path: tmp };
}

function ocr(img, scale) {
  const p = img.png;
  const flat = new PNG({ width: p.width, height: p.height });
  for (let i = 0; i < p.data.length; i += 4) {
    const a = p.data[i + 3] / 255;
    for (let k = 0; k < 3; k++) flat.data[i + k] = Math.round(p.data[i + k] * a + 255 * (1 - a));
    flat.data[i + 3] = 255;
  }
  let src = img.path.replace('.png', '-flat.png');
  fs.writeFileSync(src, PNG.sync.write(flat));
  if (scale !== 1) {
    const up = src.replace('.png', '-up.png');
    execSync(`sips --resampleWidth ${Math.round(p.width * scale)} "${src}" --out "${up}"`, { stdio: 'ignore' });
    src = up;
  }
  const out = spawnSync('tesseract', [src, 'stdout', '--psm', '11', 'tsv'], { encoding: 'utf8' }).stdout || '';
  return out.trim().split('\n').slice(1).map((l) => l.split('\t'))
    .filter((r) => r.length >= 12 && r[11].trim().length >= 3 && +r[10] > 70)
    .map((r) => ({ t: r[11].trim(), x: +r[6] / scale, y: +r[7] / scale, w: +r[8] / scale, h: +r[9] / scale }));
}

function fit(pw, cw) {
  // Candidate correspondences: same text.
  const pairs = [];
  for (const a of pw) for (const b of cw) if (a.t === b.t) pairs.push([a, b]);
  const S = +process.env.SCALE;
  if (S) {
    // Known scale (measured from card edges): vote on the offset only.
    let best = null;
    for (const [a1, b1] of pairs) {
      const ox = b1.x - a1.x * S, oy = b1.y - a1.y * S;
      const near = pairs.filter(([a, b]) => Math.abs(a.x * S + ox - b.x) < 4 && Math.abs(a.y * S + oy - b.y) < 4);
      if (!best || near.length > best.n) {
        // Refine with the median offset of the agreeing words.
        const med = (v) => v.sort((p, q) => p - q)[v.length >> 1];
        best = { s: S, ox: med(near.map(([a, b]) => b.x - a.x * S)), oy: med(near.map(([a, b]) => b.y - a.y * S)), n: near.length };
      }
    }
    return best;
  }
  let best = null;
  for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
    const [a1, b1] = pairs[i], [a2, b2] = pairs[j];
    const dx = a2.x - a1.x, dy = a2.y - a1.y;
    if (Math.hypot(dx, dy) < 50) continue;
    const s = Math.hypot(b2.x - b1.x, b2.y - b1.y) / Math.hypot(dx, dy);
    if (!(s > 0.2 && s < 3)) continue;
    const ox = b1.x - a1.x * s, oy = b1.y - a1.y * s;
    let n = 0;
    for (const [a, b] of pairs) if (Math.abs(a.x * s + ox - b.x) < 4 && Math.abs(a.y * s + oy - b.y) < 4) n++;
    if (!best || n > best.n) best = { s, ox, oy, n };
  }
  return best;
}

function diffRects(o, p) {
  const C = 6, gw = Math.ceil(o.width / C), gh = Math.ceil(o.height / C);
  const g = new Uint8Array(gw * gh);
  for (let y = 0; y < o.height; y++) for (let x = 0; x < o.width; x++) {
    const i = (y * o.width + x) * 4;
    if (o.data[i + 3] < 250 || p.data[i + 3] < 250) continue;
    let d = 0;
    for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(o.data[i + k] - p.data[i + k]));
    if (d > 24) g[Math.floor(y / C) * gw + Math.floor(x / C)] = 1;
  }
  const seen = new Uint8Array(gw * gh), rects = [];
  for (let s = 0; s < g.length; s++) {
    if (!g[s] || seen[s]) continue;
    let l = 1e9, t = 1e9, r = 0, b = 0;
    const st = [s]; seen[s] = 1;
    while (st.length) {
      const c = st.pop(), cx = c % gw, cy = (c / gw) | 0;
      l = Math.min(l, cx); r = Math.max(r, cx); t = Math.min(t, cy); b = Math.max(b, cy);
      for (let yy = -2; yy <= 2; yy++) for (let xx = -2; xx <= 2; xx++) {
        const nx = cx + xx, ny = cy + yy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const n = ny * gw + nx;
        if (g[n] && !seen[n]) { seen[n] = 1; st.push(n); }
      }
    }
    rects.push([l * C - 4, t * C - 4, (r - l + 1) * C + 8, (b - t + 1) * C + 8]);
  }
  return rects;
}

(async () => {
  const [compName, ...panels] = process.argv.slice(2);
  const outName = compName.replace(/\.(jpe?g|png)$/, '.png');
  const comp = load(path.join(IMG, compName));
  const cScale = comp.png.width < 1400 ? 2 : 1;
  const cw = ocr(comp, cScale);
  const ops = [];
  for (const arg of panels) {
    // "file@x,y" pins a panel whose words are too few to place reliably.
    const [pn, at] = arg.split('@');
    const orig = load(path.join(IMG, pn));
    const patched = load(path.join(OUT, pn.replace(/\.(jpe?g)$/, '.png')));
    const m = at ? { s: +process.env.SCALE, ox: +at.split(',')[0], oy: +at.split(',')[1], n: 1 } : fit(ocr(orig, 1), cw);
    if (!m || m.n < (process.env.SCALE ? 1 : 3)) { console.log(`  ! ${pn}: no placement (${m && m.n})`); continue; }
    const rects = diffRects(orig.png, patched.png);
    console.log(`  ${pn}: scale ${m.s.toFixed(3)} at ${m.ox.toFixed(1)},${m.oy.toFixed(1)} (${m.n} words), ${rects.length} regions`);
    const data = 'data:image/png;base64,' + fs.readFileSync(patched.path).toString('base64');
    ops.push({ data, m, rects });
  }
  const browser = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
  const page = await browser.newPage();
  const base = 'data:image/png;base64,' + fs.readFileSync(comp.path).toString('base64');
  const png64 = await page.evaluate(async ({ base, ops, clip }) => {
    const img = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = s; });
    const b = await img(base);
    const c = document.createElement('canvas');
    c.width = b.width; c.height = b.height;
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(b, 0, 0);
    if (clip) { x.beginPath(); x.rect(...clip); x.clip(); }
    for (const o of ops) {
      const p = await img(o.data);
      for (const [l, t, w, h] of o.rects) {
        x.drawImage(p, l, t, w, h, o.m.ox + l * o.m.s, o.m.oy + t * o.m.s, w * o.m.s, h * o.m.s);
      }
    }
    return c.toDataURL('image/png').split(',')[1];
  }, { base, ops, clip: process.env.CLIP ? process.env.CLIP.split(',').map(Number) : null });
  fs.writeFileSync(path.join(OUT, outName), Buffer.from(png64, 'base64'));
  console.log('ok', outName);
  await browser.close();
})();
