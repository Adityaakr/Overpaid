// Black-on-transparent logo masks for the template's custom logo icon set.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const OUT = path.resolve(__dirname, '../../apps/web/public/mk/icons');
const FONT = `<link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,500;14..32,600;14..32,700&display=swap" rel="stylesheet">`;
const txt = (t, size = 26, w = 600) => `<span style="font:${w} ${size}px/1 Inter;font-variation-settings:'opsz' 32;letter-spacing:-0.04em;color:#000;white-space:nowrap">${t}</span>`;
const dots = `<svg width="28" height="28" viewBox="0 0 30 30"><g fill="#000">${[[15, 4, 3], [15, 26, 3], [5, 9.5, 2.6], [25, 9.5, 2.6], [5, 20.5, 2.6], [25, 20.5, 2.6], [15, 15, 4.2]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g></svg>`;
const mGlyph = `<svg width="26" height="26" viewBox="0 0 30 30"><path d="M3 25V5l12 11L27 5v20" stroke="#000" stroke-width="4" fill="none" stroke-linejoin="round"/></svg>`;
const hex = `<svg width="24" height="26" viewBox="0 0 30 32"><path d="M15 2 28 9.5v13L15 30 2 22.5v-13z" fill="#000"/></svg>`;
const cloud = `<svg width="30" height="24" viewBox="0 0 32 26"><path d="M9 22h15a6 6 0 0 0 0-12 9 9 0 0 0-17 3 4.5 4.5 0 0 0 2 9z" fill="#000"/></svg>`;
const row = (...parts) => `<div style="display:flex;align-items:center;gap:7px">${parts.join('')}</div>`;
// Ombud mark: a ring with a watching dot, the vigil.
const mark = `<svg width="56" height="56" viewBox="0 0 56 56"><circle cx="28" cy="28" r="20" fill="none" stroke="#000" stroke-width="8"/><circle cx="33" cy="33" r="7" fill="#000"/></svg>`;
const items = [
  ['logo-3', row(mGlyph, txt('Masumi', 25)), 'trust', 102, 30],
  ['logo-1', row(txt('x402', 27, 700)), 'trust', 78, 30],
  ['logo-9', row(txt('AWS', 26, 700)), 'trust', 57, 30],
  ['logo-8', row(txt('Aiken', 19, 700)), 'trust', 50, 30],
  ['logo-10', row(dots), 'trust', 44, 30],
  ['logo-5', row(cloud, txt('Bedrock', 25)), 'trust', 130, 30],
  ['vector', mark, 'mark'],
  ['logo-cr', row(txt('C+R Research', 30, 700)), 'card'],
  ['logo-ftc', row(txt('FTC', 34, 700)), 'card'],
  ['logo-bankrate', row(txt('Bankrate', 32, 700)), 'card'],
  ['logo-zscaler', row(txt('Zscaler', 32, 700)), 'card'],
];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
  const p = await b.newPage({ deviceScaleFactor: 4 });
  for (const [name, html, , w, h] of items) {
    const box = w ? `width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;` : 'display:inline-block;';
    await p.setContent(`<!doctype html><html><head>${FONT}<style>html,body{margin:0;background:transparent}#c{${box}padding:0}</style></head><body><div id="c">${html}</div></body></html>`);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(150);
    await p.locator('#c').screenshot({ path: path.join(OUT, name + '.png'), omitBackground: true });
  }
  await b.close();
  console.log('ok');
})();
