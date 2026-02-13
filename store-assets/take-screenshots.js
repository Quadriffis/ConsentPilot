const { chromium } = require('playwright');
const path = require('path');

const VIEWPORT = { width: 1280, height: 800 };
const DEMO_URL = 'file://' + path.resolve(__dirname, 'demo-page.html');
const OUTPUT_DIR = __dirname;

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(DEMO_URL, { waitUntil: 'networkidle' });

  // Hide the screenshot controls
  await page.evaluate(() => {
    document.getElementById('controls').style.display = 'none';
  });

  // Screenshot 1: "BEFORE" — Cookie banner visible (the problem)
  await page.evaluate(() => showBefore());
  await page.waitForTimeout(600);
  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'screenshot-1-before.png'),
    clip: { x: 0, y: 0, width: 1280, height: 800 },
  });
  console.log('Screenshot 1: Cookie banner visible (before)');

  // Screenshot 2: "ANNOTATED" — Banner with callouts showing dark patterns
  await page.evaluate(() => showAnnotated());
  await page.waitForTimeout(600);
  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'screenshot-2-annotated.png'),
    clip: { x: 0, y: 0, width: 1280, height: 800 },
  });
  console.log('Screenshot 2: Annotated dark patterns');

  // Screenshot 3: "AFTER" — Clean page, banner gone
  await page.evaluate(() => showAfter());
  await page.waitForTimeout(800);

  // Add a simulated Consent Pilot toast notification
  await page.evaluate(() => {
    const toast = document.createElement('div');
    toast.innerHTML = `
      <div style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 99999;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        border-radius: 24px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        font-weight: 500;
        color: #fff;
        background: rgba(22, 163, 74, 0.92);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      ">
        <span style="font-size: 14px;">✓</span>
        <span>Cookies rejected</span>
      </div>
    `;
    document.body.appendChild(toast);
  });
  await page.waitForTimeout(300);

  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'screenshot-3-after.png'),
    clip: { x: 0, y: 0, width: 1280, height: 800 },
  });
  console.log('Screenshot 3: Clean page after rejection');

  await browser.close();
  console.log('\nDone! Screenshots saved to store-assets/');
})();
