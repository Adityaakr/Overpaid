// Generates Ombud replacements for the template's small assets, matching their size and style:
// trust-bar wordmarks (126x42 grey), integration app tiles (square, opaque), monogram avatars (square, opaque).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.resolve(__dirname, 'out/assets');
fs.mkdirSync(OUT, { recursive: true });
const GREY = '#94969E';
const FONT = `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&display=swap" rel="stylesheet">`;

// Simple glyphs, drawn in the grey of the original logos.
const glyph = {
  dots: `<svg width="30" height="30" viewBox="0 0 30 30"><g fill="${GREY}">${[[15, 4, 3], [15, 26, 3], [5, 9.5, 2.6], [25, 9.5, 2.6], [5, 20.5, 2.6], [25, 20.5, 2.6], [15, 15, 4.2]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g></svg>`,
  m: `<svg width="30" height="30" viewBox="0 0 30 30"><path d="M3 25V5l12 11L27 5v20" stroke="${GREY}" stroke-width="4" fill="none" stroke-linejoin="round"/></svg>`,
  code: `<svg width="30" height="30" viewBox="0 0 30 30"><path d="M10 7 3 15l7 8M20 7l7 8-7 8" stroke="${GREY}" stroke-width="3.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  cloud: `<svg width="32" height="30" viewBox="0 0 32 30"><path d="M9 24h15a6 6 0 0 0 0-12 9 9 0 0 0-17 3 4.5 4.5 0 0 0 2 9z" fill="${GREY}"/></svg>`,
  hex: `<svg width="30" height="30" viewBox="0 0 30 30"><path d="M15 2 27 9v12l-12 7L3 21V9z" fill="${GREY}"/></svg>`,
  layers: `<svg width="30" height="30" viewBox="0 0 30 30"><g fill="${GREY}"><path d="M15 3 28 10 15 17 2 10z"/><path d="M4 15.5 15 21.5l11-6 2 1.1L15 24 2 16.6z"/><path d="M4 21 15 27l11-6 2 1.1L15 29.5 2 22.1z" opacity=".7"/></g></svg>`,
};

const logos = [
  ['cardano', glyph.dots, 'Cardano'],
  ['masumi', glyph.m, 'Masumi'],
  ['x402', glyph.code, 'x402'],
  ['aws', glyph.cloud, 'AWS'],
  ['aiken', glyph.hex, 'Aiken'],
  ['bedrock', glyph.layers, 'Bedrock'],
];

// Integration tiles: what Ombud connects to.
const tileGlyph = {
  mail: `<svg width="260" height="260" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/></svg>`,
  doc: `<svg width="260" height="260" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/></svg>`,
  ada: `<div style="font:700 300px/1 Inter;color:#fff;margin-top:-10px">₳</div>`,
  m: `<div style="font:700 280px/1 Inter;color:#fff;letter-spacing:-0.04em">M</div>`,
  browser: `<svg width="270" height="270" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 9h18"/><circle cx="6" cy="6.8" r=".5" fill="#fff"/><circle cx="8" cy="6.8" r=".5" fill="#fff"/><path d="m10 13 2 2 4-4" stroke-linecap="round"/></svg>`,
  x402: `<div style="font:700 170px/1 Inter;color:#0a0a0a;letter-spacing:-0.05em">402</div>`,
};
const tiles = [
  ['tile-receipts', 'linear-gradient(160deg,#4f8cff,#1f5bff)', tileGlyph.mail],
  ['tile-statements', 'linear-gradient(160deg,#1fd16f,#00a854)', tileGlyph.doc],
  ['tile-cardano', 'linear-gradient(160deg,#2a5ada,#0033ad)', tileGlyph.ada],
  ['tile-masumi', 'linear-gradient(160deg,#9b5cff,#6a2bf0)', tileGlyph.m],
  ['tile-agentcore', 'linear-gradient(160deg,#ffb238,#ff8a00)', tileGlyph.browser],
  ['tile-x402', '#ffffff', tileGlyph.x402],
];

// Monogram avatars for the research sources in the stats slider.
const avatars = [
  ['av-cr', '#f4a7fa', 'C+R'],
  ['av-ftc', '#9fc5ff', 'FTC'],
  ['av-bankrate', '#ffd28a', 'BR'],
  ['av-cr2', '#f4a7fa', 'C+R'],
  ['av-cnbc', '#b8f0c8', 'CN'],
  ['av-ichoosr', '#ffc2a8', 'iC'],
  ['av-zscaler', '#c9b8ff', 'Z'],
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
  const page = await browser.newPage({ deviceScaleFactor: 3 });
  const shot = async (html, w, h, file, transparent) => {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<!doctype html><html><head>${FONT}<style>html,body{margin:0;background:${transparent ? 'transparent' : '#fff'}}</style></head><body>${html}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(OUT, file), omitBackground: !!transparent, clip: { x: 0, y: 0, width: w, height: h } });
  };
  for (const [name, g, text] of logos) {
    await shot(`<div style="width:126px;height:42px;display:flex;align-items:center;justify-content:center;gap:7px">${g}<span style="font:600 21px/1 Inter;color:${GREY};letter-spacing:-0.03em">${text}</span></div>`, 126, 42, `logo-${name}.png`, true);
  }
  await page.close();
  const page1 = await browser.newPage({ deviceScaleFactor: 1 });
  const shot1 = async (html, s, file) => {
    await page1.setViewportSize({ width: s, height: s });
    await page1.setContent(`<!doctype html><html><head>${FONT}<style>html,body{margin:0}</style></head><body>${html}</body></html>`);
    await page1.evaluate(() => document.fonts.ready);
    await page1.waitForTimeout(100);
    await page1.screenshot({ path: path.join(OUT, file) });
  };
  for (const [name, bg, g] of tiles) {
    await shot1(`<div style="width:512px;height:512px;background:${bg};display:flex;align-items:center;justify-content:center">${g}</div>`, 512, `${name}.png`);
  }
  for (const [name, bg, text] of avatars) {
    await shot1(`<div style="width:256px;height:256px;background:${bg};display:flex;align-items:center;justify-content:center;font:700 ${text.length > 2 ? 78 : 104}px/1 Inter;color:#0a0a0a;letter-spacing:-0.04em">${text}</div>`, 256, `${name}.png`);
  }
  await browser.close();
  console.log(fs.readdirSync(OUT).join('\n'));
})();
