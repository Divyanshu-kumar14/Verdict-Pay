/* Record the VerdictPay judge flow at 1920x1080 with video + beat screenshots.
 * Run from frontend/: node scripts/record-demo.mjs  (resolves @playwright/test from frontend)
 * Output: ~/Videos/verdict-demo/footage/ (raw.webm + shot-NN.png + beats.json timestamps)
 */
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const OUT = process.env.HOME + '/Videos/verdict-demo/footage';
mkdirSync(OUT, { recursive: true });
const T0 = Date.now();
const beats = {};
const mark = (k) => { beats[k] = +((Date.now() - T0) / 1000).toFixed(2); console.log('BEAT', k, beats[k] + 's'); };

const browser = await chromium.launch({ headless: true });
// recordVideo belongs on the context, not on launch: launch() has no context
// to attach the recording to, and browser.defaultContext() is a Puppeteer API.
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
});
const page = await ctx.newPage();
page.setDefaultTimeout(60000);

async function shot(name) {
  await page.screenshot({ path: `${OUT}/shot-${name}.png` });
  mark('shot-' + name);
}
async function clickAction(name) {
  const btn = page.getByRole('button', { name, exact: false });
  await btn.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await btn.first().click();
}

let videoPath;
try {
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  await shot('00-landing');

  await page.goto('http://localhost:3000/demo', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await shot('01-panes');

  await clickAction('Run checkout');
  await page.getByText(/CREATED|order /i).first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(2500);
  await shot('02-checkout');

  await clickAction('Run usage');
  await page.getByText(/chained/i).first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(2500);
  await shot('03-usage');

  await clickAction('Open dispute');
  await page.getByText(/internal test event|from PayPal|p\(win\)/i).first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(2500);
  await shot('04-dispute');

  await clickAction('Verify evidence');
  await page.getByText(/Chain verified/i).first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
  await shot('05-chain');

  await clickAction('Run AI analysis');
  await page.getByText(/AI analysis complete|degraded/i).first().waitFor({ timeout: 120000 });
  await page.waitForTimeout(2500);
  await shot('06-ai');

  await clickAction('Generate dossier');
  await page.getByText(/Dossier verified/i).first().waitFor({ timeout: 120000 });
  await page.waitForTimeout(2500);
  await shot('07-dossier');

  await page.goto('http://localhost:3000/disputes', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  await shot('08-queue');

  await page.goto('http://localhost:3000/analytics', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  await shot('09-analytics');

  await page.goto('http://localhost:3000/veto-lab', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot('10-veto-lab');
  await clickAction('Run veto lab');
  await page.getByTestId('control-llm').waitFor({ timeout: 120000 });
  await page.waitForTimeout(2500);
  await shot('11-veto-lab-results');
} catch (error) {
  console.log('RECORD-WARN:', String(error).split('\n')[0]);
  try { await shot('zz-last'); } catch {}
}
videoPath = await page.video().path();
mark('end');
writeFileSync(`${OUT}/beats.json`, JSON.stringify(beats, null, 2));
console.log('VIDEO-TMP:', videoPath);
await browser.close();
// normalize to mp4 30fps for editing
try {
  execSync(`ffmpeg -y -v error -i "${videoPath}" -r 30 -pix_fmt yuv420p "${OUT}/raw.mp4"`, { stdio: 'inherit' });
  console.log('RAW-MP4-OK');
} catch {
  console.log('FFMPEG-FALLBACK: keeping', videoPath);
}
