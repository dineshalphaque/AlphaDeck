// Checks the Alpha Deck update check: on by default, AlphaDeck releases only, build-number compare, notify only.
// Usage: node tools/test-update-check.mjs   (set CHROME to the Chrome binary; needs Node 22+)
import { createServer } from 'node:http';
import { createReadStream, mkdtempSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const WWW = fileURLToPath(new URL('../app/src/main/assets/www/', import.meta.url));
const CHROME = process.env.CHROME || 'google-chrome';
const PORT = 9360;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2' };
const UPDATE_URL = 'https://api.github.com/repos/dineshalphaque/AlphaDeck/releases/latest';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = createServer((req, res) => {
  const p = normalize(join(WWW, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!p.startsWith(WWW)) { res.writeHead(403).end(); return; }
  stat(p).then(s => { if (!s.isFile()) throw 0; res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); createReadStream(p).pipe(res); },
    () => res.writeHead(404).end());
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const dir = mkdtempSync(join(tmpdir(), 'update-check-'));
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
let ws, fails = 0;
const close = async () => {
  try { ws?.close(); } catch {}
  chrome.kill('SIGKILL');
  server.closeAllConnections?.();
  await new Promise(r => server.close(r));
};
try {
  let page;
  for (let i = 0; i < 100 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(p => p.type === 'page'); } catch {}
    if (!page) await sleep(150);
  }
  if (!page) throw new Error('Chrome did not come up');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const run = async expr => {
    const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.text || 'page exception');
    return m.result?.result?.value;
  };
  const ok = (cond, label) => { if (cond) console.log('ok - ' + label); else { fails++; console.error('not ok - ' + label); } };
  await send('Page.navigate', { url: base + 'index.html?nosetup' });
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) {
    try { ready = await run("typeof UPD !== 'undefined' && document.readyState === 'complete'"); } catch {}
    if (!ready) await sleep(100);
  }
  if (!ready) throw new Error('Alpha Deck did not boot');

  const initial = await run("({ on: UPD.on, stored: store.get('upd-on', true) })");
  ok(initial.on === true, 'update check is on with no stored upd-on key');
  ok(initial.stored === true, 'missing upd-on reads as on');
  await run("store.set('upd-on', false)");
  ok((await run("store.get('upd-on', true)")) === false, 'stored upd-on false stays false');
  await run("store.set('upd-on', true)");

  const builds = await run("({ b12: parseBuild('v0.3-build12'), ad13: parseBuild('v0.3-ad-13'), ad14: parseBuild('0.3-ad-14'), alpha: parseBuild('Alpha Deck 0.3-ad-14'), plain: parseBuild('0.3'), first: parseBuild('v0.3-build12', 'v0.3-ad-14') })");
  ok(builds.b12 === 12, 'parseBuild v0.3-build12 -> 12');
  ok(builds.ad13 === 13, 'parseBuild v0.3-ad-13 -> 13');
  ok(builds.ad14 === 14, 'parseBuild 0.3-ad-14 -> 14');
  ok(builds.alpha === 14, 'parseBuild Alpha Deck 0.3-ad-14 -> 14');
  ok(builds.plain === null, 'parseBuild 0.3 -> null');
  ok(builds.first === 12, 'parseBuild tries strings in order');

  const fetchCase = async rel => {
    await run(`(() => {
      UPD.on = true; UPD.t = 0; UPD.latest = null; UPD.note = ''; store.set('upd-told', '');
      globalThis.__updBuild = 13; globalThis.__updUrl = '';
      globalThis.__updFetch = async (url) => { globalThis.__updUrl = String(url); return { ok: true, json: async () => (${JSON.stringify(rel)}) }; };
      return 1;
    })()`);
    await run('updCheck(true)');
    return run("({ note: UPD.note, latest: UPD.latest, url: globalThis.__updUrl, told: store.get('upd-told', '') })");
  };

  const older = await fetchCase({ tag_name: 'v0.3-build12', name: '', draft: false, prerelease: false });
  ok(older.url === UPDATE_URL, 'older: asks the AlphaDeck latest-release URL');
  ok(/Up to date/.test(older.note) && !/is out/.test(older.note), 'older build is up to date');

  const same = await fetchCase({ tag_name: 'v0.3-ad-13', name: '', draft: false, prerelease: false });
  ok(same.url === UPDATE_URL, 'same: asks the AlphaDeck latest-release URL');
  ok(/Up to date/.test(same.note) && !/is out/.test(same.note), 'same build is up to date');

  const newer = await fetchCase({ tag_name: 'v0.3-ad-14', name: '', draft: false, prerelease: false });
  ok(newer.url === UPDATE_URL, 'newer: asks the AlphaDeck latest-release URL');
  ok(newer.note.includes('Alpha Deck') && newer.note.includes('14'), 'newer v0.3-ad-14 note names Alpha Deck and 14');
  ok(!/Home Deck|glidian/i.test(newer.note), 'newer note has no Home Deck or glidian wording');
  ok(newer.told === '14', 'newer build is remembered for the once-only toast');

  const oldTag = await fetchCase({ tag_name: 'v0.3-build20', name: '', draft: false, prerelease: false });
  ok(oldTag.url === UPDATE_URL, 'old tag: asks the AlphaDeck latest-release URL');
  ok(oldTag.note.includes('Alpha Deck') && oldTag.note.includes('20'), 'v0.3-build20 is newer than build 13');

  const nameOnly = await fetchCase({ tag_name: 'nightly', name: '0.3-ad-14', draft: false, prerelease: false });
  ok(nameOnly.url === UPDATE_URL, 'name only: asks the AlphaDeck latest-release URL');
  ok(nameOnly.note.includes('Alpha Deck') && nameOnly.note.includes('14'), 'release name 0.3-ad-14 is parsed as 14');

  const titled = await fetchCase({ tag_name: '', name: 'Alpha Deck 0.3-ad-14', draft: false, prerelease: false });
  ok(titled.url === UPDATE_URL, 'title: asks the AlphaDeck latest-release URL');
  ok(titled.note.includes('Alpha Deck') && titled.note.includes('14'), 'release title Alpha Deck 0.3-ad-14 is parsed as 14');

  await run(`(() => {
    UPD.on = true; UPD.t = 0; UPD.latest = null; UPD.note = ''; store.set('upd-told', '');
    globalThis.__updBuild = 13; globalThis.__updUrl = '';
    globalThis.__updFetch = async (url) => { globalThis.__updUrl = String(url); return { ok: false, status: 500 }; };
    return 1;
  })()`);
  await run('updCheck(true)');
  const failed = await run("({ note: UPD.note, url: globalThis.__updUrl })");
  ok(failed.url === UPDATE_URL, 'failure: asked the AlphaDeck latest-release URL');
  ok(failed.note === 'Could not reach GitHub. It tries again later.', 'HTTP failure shows the GitHub error note');

  await run(`(() => {
    UPD.on = true; UPD.t = 0; UPD.latest = null; UPD.note = ''; store.set('upd-told', '');
    globalThis.__updBuild = 13;
    globalThis.__updFetch = async () => { throw new Error('offline'); };
    return 1;
  })()`);
  await run('updCheck(true)');
  ok((await run('UPD.note')) === 'Could not reach GitHub. It tries again later.', 'rejected fetch shows the GitHub error note');

  await run('UPD.on = false');
} finally {
  await close();
}
process.exitCode = fails ? 1 : 0;
