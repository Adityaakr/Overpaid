// Viewport screenshots while scrolling down, so scroll-linked effects show their in-context state.
// node seq.js <url> <width> <height> <outPrefix> [step]
const { chromium } = require('playwright');
(async () => {
  const [url, width, height, pre, stepArg] = process.argv.slice(2);
  const b = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
  const p = await b.newPage({ viewport: { width: +width, height: +height } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
  await p.waitForTimeout(2000);
  const total = await p.evaluate(() => document.documentElement.scrollHeight);
  const step = +(stepArg || height);
  let i = 0;
  for (let y = 0; y < total; y += step) {
    await p.mouse.wheel(0, 0);
    await p.evaluate((yy) => window.scrollTo(0, yy), y);
    await p.waitForTimeout(1300);
    await p.screenshot({ path: `${pre}-${String(i++).padStart(2, '0')}.png` });
  }
  console.log('total', total, 'shots', i, 'errors', errs.length);
  errs.slice(0, 5).forEach((e) => console.log(' -', e.slice(0, 200)));
  await b.close();
})();
