// End-to-end check: serve dist/ with `vite preview`, drive it with headless
// Chrome via Playwright, save screenshots + output PNGs to artifacts/.
// Usage: npm run build && npm run e2e   (env: IMAGE=path, CHROME=path, DEVICE=wasm|auto)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ART = resolve(process.env.ART ?? 'artifacts');
mkdirSync(ART, { recursive: true });
const IMAGE = resolve(process.env.IMAGE ?? 'test-assets/socks-buddy-lawn.jpg');
const CHROME = process.env.CHROME ?? (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
const DEVICE = process.env.DEVICE ?? 'auto';
const PORT = 4173;
// Keep in sync with `base` in vite.config.ts (GitHub Pages project subpath).
const BASE = '/bg-remover/';
const URL_ = `http://localhost:${PORT}${BASE}?device=${DEVICE}` + (process.env.MODEL ? `&model=${process.env.MODEL}` : '') + (process.env.EXTRA_QS ?? '');
const log = { started: new Date().toISOString(), image: IMAGE, device: DEVICE, steps: [], console: [] };
const step = (name, data = {}) => {
  const e = { t: new Date().toISOString(), name, ...data };
  log.steps.push(e);
  console.log('•', name, JSON.stringify(data));
};

// STATIC=1 serves dist/ with a plain static server that sends NO COOP/COEP
// headers (like GitHub Pages), to check the coi-serviceworker fallback.
// The built app uses absolute /bg-remover/ URLs, so the static root has a
// bg-remover symlink pointing at dist/ (vite preview does this itself).
const staticRoot = process.env.STATIC ? mkdtempSync(join(tmpdir(), 'bg-pages-')) : null;
if (staticRoot) symlinkSync(resolve('dist'), join(staticRoot, 'bg-remover'));
const server = process.env.STATIC
  ? spawn('python3', ['-u', '-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', staticRoot], { stdio: 'pipe', detached: true })
  : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error('preview server did not start')), 30000);
  const onData = (d) => (d.toString().includes(String(PORT)) && (clearTimeout(to), res()));
  server.stdout.on('data', onData);
  server.stderr.on('data', onData);
});

const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: (process.env.CHROME_ARGS ?? '').split(' ').filter(Boolean) });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, serviceWorkers: process.env.NO_SW ? 'block' : 'allow' });
const page = await ctx.newPage();
page.on('console', (m) => log.console.push(`[${m.type()}] ${m.text()}`.slice(0, 500)));
page.on('pageerror', (e) => log.console.push(`[pageerror] ${e.message}`));

const st = () => page.evaluate(() => window.__bg.state());
const waitStage = async (stage, timeout = 15 * 60_000) => {
  await page.waitForFunction((s) => document.body.dataset.stage === s || document.body.dataset.stage === 'error', stage, { timeout, polling: 500 });
  const s = await st();
  if (s.stage === 'error') throw new Error('app error: ' + JSON.stringify(s.errors));
  return s;
};
const maskAt = (x, y) => page.evaluate(([x, y]) => {
  const s = window.__bg.state();
  const m = window.__bg.maskSnapshot();
  return m ? m[Math.round(y) * s.width + Math.round(x)] : null;
}, [x, y]);
const clickImage = async (x, y, opts = {}) => {
  const box = await page.locator('#overlay').boundingBox();
  const s = await st();
  await page.mouse.click(box.x + (x / s.width) * box.width, box.y + (y / s.height) * box.height, opts);
};
const download = async (name) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#downloadBtn')]);
  const p = resolve(ART, name);
  await dl.saveAs(p);
  return { suggested: dl.suggestedFilename(), saved: p };
};

try {
  // ---- first (cold) run
  const tNav = Date.now();
  await page.goto(URL_);
  let s = await waitStage('idle', 60_000);
  step('page ready', { device: s.device, crossOriginIsolated: s.crossOriginIsolated, ms: Date.now() - tNav });
  await page.screenshot({ path: resolve(ART, '01-start-th.png') });

  const t0 = Date.now();
  await page.setInputFiles('#fileInput', IMAGE);
  await page.waitForFunction(() => window.__bg.state().coverage !== null || document.body.dataset.stage === 'error', null, { timeout: 15 * 60_000, polling: 500 });
  const tAuto = Date.now() - t0;
  s = await st();
  step('auto mask ready', { device: s.device, warnings: s.warnings, wasmThreads: s.wasmThreads, wallMs: tAuto, coverage: s.coverage, timings: s.timings, downloads: s.downloads });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(ART, '02-auto-result.png') });

  s = await waitStage('ready');
  step('click-select ready', { wallMsSinceOpen: Date.now() - t0, timings: s.timings, downloads: s.downloads });
  const autoCoverage = s.coverage;
  writeFileSync(resolve(ART, 'auto-download.json'), JSON.stringify(await download('output-auto.png')));

  // ---- click selection: the dog (upper-left) and the cat (lower-right) in the sample image
  const W = s.width, H = s.height;
  const dog = { x: 0.40 * W, y: 0.40 * H };
  const cat = { x: 0.72 * W, y: 0.75 * H };
  const before = { dog: await maskAt(dog.x, dog.y), cat: await maskAt(cat.x, cat.y) };
  step('auto mask samples', before);

  // If auto kept the dog, remove it with a click; otherwise add it.
  const dogKept = before.dog > 127;
  await page.click(`[data-tool="${dogKept ? 'remove' : 'add'}"]`);
  await clickImage(dog.x, dog.y);
  s = await waitStage('ready');
  const after1 = { dog: await maskAt(dog.x, dog.y), cat: await maskAt(cat.x, cat.y) };
  step(`click ${dogKept ? 'remove' : 'add'} dog`, { coverageBefore: autoCoverage, coverageAfter: s.coverage, edits: s.edits, samples: after1, pointMs: s.timings.lastPointMs, scores: s.lastScores, choice: s.lastChoice });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(ART, '03-after-click-dog.png') });
  writeFileSync(resolve(ART, 'click-download.json'), JSON.stringify(await download('output-after-click.png')));

  // Right-click on the cat = remove it (shortcut), then undo.
  await clickImage(cat.x, cat.y, { button: 'right' });
  s = await waitStage('ready');
  step('right-click remove cat', { coverage: s.coverage, edits: s.edits, cat: await maskAt(cat.x, cat.y), catHead: await maskAt(0.53 * W, 0.62 * H), scores: s.lastScores, choice: s.lastChoice });
  for (const k of [0, 1, 2]) {
    await page.click(`[data-cand="${k}"]`);
    s = await st();
    step(`  candidate ${k}`, { coverage: s.coverage, catHead: await maskAt(0.53 * W, 0.62 * H), catBody: await maskAt(cat.x, cat.y) });
  }
  await page.click('[data-cand="2"]');
  await page.click('[data-view="overlay"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(ART, '04-overlay-cat-removed.png') });
  await page.click('#undoBtn');
  s = await st();
  step('undo', { coverage: s.coverage, edits: s.edits, cat: await maskAt(cat.x, cat.y) });

  // Brush: paint a stroke to keep a strip of grass, screenshot, then undo.
  await page.click('[data-tool="brush-add"]');
  const box = await page.locator('#overlay').boundingBox();
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.9);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width * (0.1 + 0.03 * i), box.y + box.height * 0.9);
  await page.mouse.up();
  s = await st();
  step('brush add stroke', { coverage: s.coverage, edits: s.edits, sample: await maskAt(0.2 * W, 0.9 * H) });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(ART, '05-brush-overlay.png') });
  await page.click('#undoBtn');
  await page.click('[data-view="result"]');

  // English UI
  await page.click('[data-lang="en"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(ART, '06-result-en.png') });
  await page.click('[data-lang="th"]');

  // ---- warm run: reload; models should come from the browser cache
  await page.reload();
  await waitStage('idle', 60_000);
  const t1 = Date.now();
  await page.setInputFiles('#fileInput', IMAGE);
  s = await waitStage('ready');
  step('warm run (cached models)', { wallMs: Date.now() - t1, timings: s.timings, crossOriginIsolated: s.crossOriginIsolated, device: s.device, wasmThreads: s.wasmThreads, warnings: s.warnings });
  log.ok = true;
} catch (e) {
  log.ok = false;
  log.error = String(e?.stack ?? e);
  log.finalState = await st().catch(() => null);
  console.error(e);
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(ART, 'zz-failure.png') }).catch(() => {});
} finally {
  writeFileSync(resolve(ART, 'e2e-log.json'), JSON.stringify(log, null, 2));
  await browser.close();
  server.kill('SIGTERM');
  try { process.kill(-server.pid); } catch {}
  if (staticRoot) rmSync(staticRoot, { recursive: true, force: true });
}
process.exit(log.ok ? 0 : 1);
