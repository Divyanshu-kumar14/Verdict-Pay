#!/usr/bin/env node
/**
 * design-gate - run the design-taste-frontend inspector against the PRODUCTION build.
 *
 * The inspector is the same gate the design skill uses, in app mode (--app), driven by the
 * dealt direction sheet in .taste-skill/direction.json. It renders every route in a real
 * Chrome, measures it and exits non-zero on any FAIL.
 *
 *   node scripts/design-gate.mjs                # every route, widths 1440,768,390
 *   node scripts/design-gate.mjs --routes /     # one route
 *   node scripts/design-gate.mjs --widths 1440  # one width
 *
 * Requires: a running VerdictPay API (the pages poll it) and an installed Chrome.
 * Builds the frontend first, because the last gate must run against the production build.
 *
 * The gate origin MUST be in the API's ALLOWED_ORIGINS, otherwise every page renders its
 * error states and the measurements are meaningless. The gate refuses to run if the API
 * does not answer a preflight from this origin. The default port 3000 matches the
 * ALLOWED_ORIGINS shipped in .env; use --port only for an origin you have also allowed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, '..');
const REPO = resolve(FRONTEND, '..');
const INSPECT = process.env.TASTE_INSPECT || '/home/rtx/.dsh/skills/design-taste-frontend/scripts/inspect.mjs';

const argv = process.argv.slice(2);
const flag = (name, def) => { const i = argv.indexOf('--' + name); return i === -1 ? def : argv[i + 1]; };
const has = (name) => argv.includes('--' + name);

const PORT = Number(flag('port', '3000'));
const WIDTHS = String(flag('widths', '1440,768,390'));
const API_BASE = process.env.DESIGN_GATE_API || 'http://127.0.0.1:8000';
const KEEP = has('keep');
const SKIP_BUILD = has('no-build');

function fail(msg) { console.error('\nDESIGN GATE BLOCKED: ' + msg + '\n'); process.exit(2); }

if (!existsSync(INSPECT)) fail('inspector not found at ' + INSPECT + ' (set TASTE_INSPECT).');
if (!existsSync(join(REPO, '.taste-skill', 'direction.json'))) fail('no dealt direction sheet at .taste-skill/direction.json - run the skill draw step first.');

const env = { ...process.env };
for (const f of [join(REPO, '.env'), join(FRONTEND, '.env.local')]) {
  if (!existsSync(f)) continue;
  for (const raw of readFileSync(f, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(k in env)) env[k] = v;
  }
}
const API_KEY = env.VERDICTPAY_API_KEY || 'dev-verdictpay-key';
const BASE = 'http://127.0.0.1:' + PORT;

async function api(path) {
  const res = await fetch(API_BASE + path, { headers: { 'X-API-Key': API_KEY } });
  if (!res.ok) throw new Error(path + ' -> HTTP ' + res.status);
  return res.json();
}

// 1. The API must be up: the routes poll it, and a dead API measures a skeleton.
try {
  await api('/api/v1/health');
} catch (err) {
  fail('the VerdictPay API is unreachable at ' + API_BASE + ' (' + err.message + ').\n' +
    '  Start it first:   make stack        # seeds the demo DB and boots the API on :8000\n' +
    '  Then rerun:       node frontend/scripts/design-gate.mjs');
}

// 1b. This origin must be allowed, or every page paints its CORS error states and the
//     inspector ends up grading a screen that never loaded any data.
if (PORT !== 3000) {
  try {
    const pre = await fetch(API_BASE + '/api/v1/disputes?page=1&per_page=1', {
      method: 'OPTIONS',
      headers: {
        Origin: BASE,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'x-api-key',
      },
    });
    const allow = pre.headers.get('access-control-allow-origin');
    if (allow !== BASE && allow !== '*') {
      fail('the API does not allow the origin ' + BASE + ' (it answered with ' + (allow || 'no access-control-allow-origin') + ').\n' +
        '  Every page would render its error states, so the measurements would be worthless.\n' +
        '  Either add ' + BASE + ' to ALLOWED_ORIGINS in .env and restart the API, or run the gate on the shipped default: node frontend/scripts/design-gate.mjs');
    }
  } catch (err) {
    fail('the CORS preflight to ' + API_BASE + ' failed (' + err.message + ').');
  }
}

// 2. A real case id, so the detail route measures a populated screen.
let caseId = null;
try {
  const page = await api('/api/v1/disputes?page=1&per_page=1');
  caseId = page?.data?.[0]?.dispute_id || null;
} catch { /* the detail route is simply skipped below */ }

const routes = has('routes')
  ? String(flag('routes', '')).split(',').map((s) => s.trim()).filter(Boolean)
  : ['/', '/disputes', caseId ? '/disputes/' + caseId : null, '/timeline', '/analytics', '/veto-lab', '/settings'].filter(Boolean);

// 3. Build, because a dev server trips the dev-server WARN and stale assets lie.
if (!SKIP_BUILD) {
  console.log('building the production frontend...');
  const build = spawnSync('pnpm', ['build'], { cwd: FRONTEND, env, stdio: 'inherit' });
  if (build.status !== 0) fail('pnpm build failed; the gate must measure a production build.');
}

/* detached:true puts the server in its own process group, so stop() can take
   down next-server too - pnpm does not forward the signal on its own. */
/* The port must be free BEFORE we build. A server left over from an earlier build keeps
   answering, and once .next has been replaced it serves HTML whose client chunks no longer
   exist - every route then dies with ChunkLoadError and the inspector grades an error page.
   Waiting for the spawn to report EADDRINUSE is too late and racy, so check first. */
try {
  const probe = await fetch(BASE + '/', { signal: AbortSignal.timeout(1500) });
  if (probe.status < 500) {
    fail('port ' + PORT + ' is already serving a page, so this run cannot own it.\n' +
      '  A server from an earlier build answers with HTML that points at assets this build\n' +
      '  replaced, and every route dies with ChunkLoadError.\n' +
      '  Stop it and rerun:   ss -ltnp | grep :' + PORT + '   then kill the pid (lsof is not installed everywhere)');
  }
} catch { /* nothing is listening: this is the normal case */ }
const server = spawn('pnpm', ['exec', 'next', 'start', '-p', String(PORT)], {
  cwd: FRONTEND,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let serverLog = '';
server.stdout.on('data', (b) => { serverLog += b.toString(); });
server.stderr.on('data', (b) => { serverLog += b.toString(); });

function stop() {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    try {
      server.kill('SIGTERM');
    } catch {}
  }
}
/* --keep leaves the production server up so the report can be read in a browser. */
if (!KEEP) process.on('exit', stop);

let ready = false;
for (let i = 0; i < 60; i += 1) {
  try { const res = await fetch(BASE + '/'); if (res.status < 500) { ready = true; break; } } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) fail('next start never answered on ' + BASE + '.\n' + serverLog.slice(-2000));

/* 3b. The server that answered must be OURS and must serve its own stylesheet. A leftover
   next start from an earlier build answers 200 with HTML that points at asset hashes this
   build no longer has; every page then renders unstyled and the inspector grades Times New
   Roman on white instead of the design. That is a measurement failure, not a design finding. */
if (serverLog.includes('EADDRINUSE')) {
  stop();
  fail('port ' + PORT + ' is already taken by another server, which answered instead of this run.\n' +
    '  Stop it and rerun:   ss -ltnp | grep :' + PORT + '   then kill the pid (lsof is not installed everywhere)');
}
const homeHtml = await (await fetch(BASE + '/')).text();
const cssHref = (homeHtml.match(/\/_next\/static\/css\/[^"']+\.css/) || [])[0];
if (!cssHref) fail('the page served at ' + BASE + ' links no stylesheet, so the gate would grade unstyled HTML.');
const cssRes = await fetch(BASE + cssHref);
if (cssRes.status !== 200) {
  fail('the served page links ' + cssHref + ' but that asset answers HTTP ' + cssRes.status + '.\n' +
    '  The build on disk is newer than the server that answered, so every page renders unstyled.\n' +
    '  Kill any running next server, then rerun without --no-build.');
}

// 4. Inspect every route into one report per route.
const outRoot = join(REPO, '.taste-skill', 'inspect');
mkdirSync(outRoot, { recursive: true });
const results = [];
for (const route of routes) {
  const outDir = join(outRoot, route === '/' ? 'home' : route.replace(/^\/+/, '').replace(/[^a-z0-9]+/gi, '-'));
  rmSync(outDir, { recursive: true, force: true });
  console.log('\ninspecting ' + route);
  const res = spawnSync(process.execPath, [INSPECT, BASE + route, '--app', '--json', '--widths', WIDTHS, '--out', outDir], { cwd: REPO, env, stdio: 'inherit' });
  let report = null;
  try { report = JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')); } catch {}
  const findings = (report?.findings || []).filter((f) => f.level === 'FAIL');
  const fails = findings.map((f) => ({ rule: f.id || f.rule, width: f.width, note: f.message || f.note }));
  const warns = (report?.findings || []).filter((f) => f.level === 'WARN').map((f) => f.id || f.rule);
  results.push({ route, exit: res.status, outDir, fails, warns });
}

if (KEEP) {
  console.log('\n--keep: the production server is still up at ' + BASE + ' (Ctrl-C when done).');
} else {
  stop();
}

console.log('\n================ DESIGN GATE (app mode, ' + WIDTHS + ') ================');
let total = 0;
for (const r of results) {
  total += r.fails.length;
  console.log('\n' + r.route + '  ' + (r.fails.length === 0 ? 'PASS' : 'FAIL (' + r.fails.length + ')'));
  for (const f of r.fails) {
    console.log('   FAIL ' + f.rule + (f.width ? ' @' + f.width : '') + (f.note ? ' - ' + f.note : ''));
  }
  if (r.warns.length) console.log('   warn: ' + [...new Set(r.warns)].join(', '));
  console.log('   report: ' + r.outDir + '/report.json');
}
console.log('\n' + (total === 0 ? 'GATE PASSED: 0 FAIL findings across ' + results.length + ' route(s).' : 'GATE FAILED: ' + total + ' FAIL finding(s).'));

const summary = { at: new Date().toISOString(), base: BASE, widths: WIDTHS, api: API_BASE, totalFails: total, routes: results };
writeFileSync(join(outRoot, 'gate-summary.json'), JSON.stringify(summary, null, 1));
process.exit(total === 0 ? 0 : 1);
