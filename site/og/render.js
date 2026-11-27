// Renders site/og/og.html to site/public/og.png (1200x630) with Playwright.
//   npm run og
// Needs Playwright with Chromium installed (npx playwright install chromium).
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.goto(`file://${path.join(__dirname, "og.html")}`, { waitUntil: "networkidle" }).catch(() =>
    page.goto(`file://${path.join(__dirname, "og.html")}`)
  );
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(__dirname, "../public/og.png");
  await page.screenshot({ path: out, type: "png" });
  await browser.close();
  console.log(`Wrote ${path.relative(process.cwd(), out)}`);
})();
