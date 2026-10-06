// Full-page screenshot of the local site after scrolling through to trigger in-view animations.
// node shot.js <url> <width> <out.png> [height]
const { chromium } = require('playwright');
(async () => {
  const [url, width, out, h] = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
  const page = await browser.newPage({ viewport: { width: +width, height: +(h || 900) } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(1500);
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total; y += 400) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out, fullPage: true });
  console.log('height', total, 'errors', errors.length);
  errors.slice(0, 15).forEach((e) => console.log(' -', e.slice(0, 300)));
  await browser.close();
})();
