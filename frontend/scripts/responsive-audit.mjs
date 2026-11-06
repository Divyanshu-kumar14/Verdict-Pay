// responsive-audit.mjs — Playwright sweep: horizontal-overflow + clipped tables + console errors
// across 5 routes x 7 widths against the local production build (next start).
import { chromium } from '@playwright/test';

const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:3000';
const TAG = process.env.AUDIT_TAG || 'before';
const OUT = process.env.AUDIT_OUT || '.qa/responsive/' + TAG;

const ROUTES = [
  { path: '/', slug: 'home' },
  { path: '/disputes', slug: 'disputes' },
  { path: '/timeline', slug: 'timeline' },
  { path: '/analytics', slug: 'analytics' },
  { path: '/settings', slug: 'settings' },
];
const WIDTHS = [360, 390, 430, 768, 1024, 1280, 1440];

const results = [];
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE || '/usr/bin/chromium' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('React DevTools')) consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 200)));

for (const route of ROUTES) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE + route.path, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500); // let 2s/5s/15s polls land real data
  for (const width of WIDTHS) {
    consoleErrors.length = 0;
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(700); // reflow + repaint at new width
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const scrollW = doc.scrollWidth;
      const vw = doc.clientWidth;
      const overflowX = scrollW - vw;
      // clipped tables / any element poking past its scrollparent
      const clipped = [];
      for (const t of document.querySelectorAll('table')) {
        const tr = t.getBoundingClientRect();
        if (tr.width > vw + 1) clipped.push({ cls: t.className.slice(0,40), w: Math.round(tr.width), vw });
      }
      return { scrollW, vw, overflowX, tables: clipped.length, clipped };
    });
    results.push({ route: route.slug, width, ...m, consoleErrors: [...consoleErrors] });
    const shot = OUT + '/' + route.slug + '-' + width + '.png';
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
    console.log(JSON.stringify({ route: route.slug, width, overflowX: m.overflowX, tables: m.clipped.length, errs: consoleErrors.length }));
  }
}

await browser.close();
// dump summary
const fs = await import('node:fs');
fs.mkdirSync(OUT, { recursive: true });
const overflowRows = results.filter(r => r.overflowX > 1);
const clippedRows = results.filter(r => r.tables > 0);
const errRows = results.filter(r => r.consoleErrors.length > 0);
const summary = { tag: TAG, base: BASE, total: results.length, overflow: overflowRows.length, clippedTables: clippedRows.length, consoleErrorRoutes: errRows.length, overflowRows, clippedRows, errRows: errRows.map(r => ({ route: r.route, width: r.width, errs: r.consoleErrors })) };
fs.writeFileSync(OUT + '/summary.json', JSON.stringify(summary, null, 2));
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify({ overflow: overflowRows.length, clippedTables: clippedRows.length, consoleErrorRoutes: errRows.length }, null, 2));
console.log('overflow rows:', JSON.stringify(overflowRows.map(r => r.route + '@' + r.width + ' +' + r.overflowX + 'px'), null, 2));
