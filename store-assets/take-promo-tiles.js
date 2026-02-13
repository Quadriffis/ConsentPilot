const { chromium } = require('playwright');
const path = require('path');

const DEMO_URL = 'file://' + path.resolve(__dirname, 'promo-tiles.html');
const OUTPUT_DIR = __dirname;

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(DEMO_URL, { waitUntil: 'networkidle' });

  // Small promo tile: 440x280
  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'promo-small-440x280.png'),
    clip: { x: 0, y: 0, width: 440, height: 280 },
  });
  console.log('Small promo tile: 440x280');

  // Marquee promo tile: 1400x560
  // The marquee div starts after the small tile (280px) + spacer (40px) = 320px
  const marqueeBox = await page.locator('#tileMarquee').boundingBox();
  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'promo-marquee-1400x560.png'),
    clip: { x: marqueeBox.x, y: marqueeBox.y, width: 1400, height: 560 },
  });
  console.log('Marquee promo tile: 1400x560');

  await browser.close();
  console.log('\nDone! Promo tiles saved to store-assets/');
})();
