// demo-audit.mjs — Playwright capture of /demo at 4 widths x 3 flow states.
// Usage: node scripts/demo-audit.mjs   (env: AUDIT_BASE, AUDIT_TAG, AUDIT_OUT, PW_EXECUTABLE)
import { chromium } from '@playwright/test';

const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:3000';
const TAG = process.env.AUDIT_TAG || 'before';
const OUT = process.env.AUDIT_OUT || '.qa/demo/' + TAG;

const WIDTHS = [360, 768, 1024, 1440];

const fs = await import('node:fs');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE || '/usr/bin/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 200)));

async function measure() {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const vw = doc.clientWidth;
    const overflowX = doc.scrollWidth - vw;
    // any element wider than the viewport
    const wide = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width > vw + 2 && r.left >= -1) wide.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 50), w: Math.round(r.width) });
    }
    return { vw, scrollW: doc.scrollWidth, overflowX, wide: wide.slice(0, 8) };
  });
}

async function shot(name) {
  await page.screenshot({ path: OUT + '/' + name + '.png', fullPage: false }).catch(() => {});
}

// --- initial state at each width ---
for (const w of WIDTHS) {
  consoleErrors.length = 0;
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto(BASE + '/demo', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const m = await measure();
  await shot('initial-' + w);
  console.log(JSON.stringify({ state: 'initial', width: w, ...m, errs: consoleErrors.length }));
}

// --- drive the full flow at 1440 and 360 ---
async function runFlow(w) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto(BASE + '/demo', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await shot('flow-' + w + '-0-initial');

  // step 1: checkout
  await page.locator('button[aria-label*="Run checkout"]').first().click();
  await page.locator('button[aria-label*="Run usage"]:not([disabled])').first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  await shot('flow-' + w + '-1-checkout');

  // step 2: usage
  await page.locator('button[aria-label*="Run usage"]').first().click();
  await page.locator('button[aria-label*="File dispute"]:not([disabled])').first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  await shot('flow-' + w + '-2-usage');

  // step 3: dispute
  await page.locator('button[aria-label*="File dispute"]').first().click();
  await page.locator('h2:has-text("Live verdict")').first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await shot('flow-' + w + '-3-verdict');

  const m = await measure();
  console.log(JSON.stringify({ state: 'flow-done', width: w, ...m, errs: consoleErrors.length }));
  return m;
}

await runFlow(1440);
await runFlow(360);

await browser.close();
console.log('DONE tag=' + TAG);
