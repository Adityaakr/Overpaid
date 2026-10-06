const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const bad = new Set();
  p.on('response', (r) => { if (r.status() >= 400) bad.add(r.status() + ' ' + r.url()); });
  await p.goto(process.argv[2], { waitUntil: 'networkidle' });
  console.log([...bad].join('\n'));
  await b.close();
})();
