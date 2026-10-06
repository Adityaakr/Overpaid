// Stat tiles that replace the stock portraits on the evidence cards. Content sits in a centred band so the
// tile survives cover-cropping into the landscape frames used at every breakpoint (up to ~1.8:1).
const path = require('path');
const { chromium } = require('playwright');
const OUT = path.resolve(__dirname, '../../apps/web/public/mk/ombud');
const FONT = `<link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500&display=swap" rel="stylesheet">`;
const tiles = [
  ['stat-cr', '42%', 'forgot they were still paying for a subscription', 'rgba(217,255,92,0.35)'],
  ['stat-ftc', '76%', 'of subscription sites used a possible dark pattern', 'rgba(224,197,182,0.45)'],
  ['stat-bankrate', '$244', 'in unused gift cards and credit, on average', 'rgba(192,173,255,0.45)'],
  ['stat-zscaler', '4/26', 'AI models paid after hidden page instructions', 'rgba(184,222,255,0.45)'],
];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
  const p = await b.newPage({ viewport: { width: 800, height: 800 }, deviceScaleFactor: 1 });
  for (const [name, big, cap, glow] of tiles) {
    await p.setContent(`<!doctype html><html><head>${FONT}<style>html,body{margin:0}
      #t{width:800px;height:800px;background:radial-gradient(70% 60% at 30% 25%, ${glow}, transparent 70%), radial-gradient(60% 60% at 85% 90%, rgba(255,255,255,0.08), transparent 70%), #35363b;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:72px;box-sizing:border-box;font-family:Inter;font-variation-settings:'opsz' 32;color:#fff}
      .big{font-size:${big.length > 3 ? 150 : 180}px;line-height:1;letter-spacing:-0.06em;font-weight:400}
      .cap{margin-top:20px;font-size:32px;line-height:1.3;letter-spacing:-0.02em;color:rgba(255,255,255,0.7);max-width:520px}</style></head>
      <body><div id="t"><div class="big">${big}</div><div class="cap">${cap}</div></div></body></html>`);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(150);
    await p.locator('#t').screenshot({ path: path.join(OUT, name + '.png') });
  }
  await b.close();
  console.log('ok');
})();
