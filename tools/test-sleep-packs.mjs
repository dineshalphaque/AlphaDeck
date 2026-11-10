// Checks that the away screen closes Alpha Deck's icon pack picker: sleep() closes it without going back to Jump To, and
// Escape still returns to Jump To with the iconpack row focused.
// Usage: node tools/test-sleep-packs.mjs   (set CHROME to the Chrome binary; needs Node 22+)
import { createServer } from 'node:http';
import { createReadStream, mkdtempSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const WWW = fileURLToPath(new URL('../app/src/main/assets/www/', import.meta.url));
const CHROME = process.env.CHROME || 'google-chrome';
const PORT = 9338;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = createServer((req, res) => {
  const p = normalize(join(WWW, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!p.startsWith(WWW)) { res.writeHead(403).end(); return; }
  stat(p).then(s => { if (!s.isFile()) throw 0; res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); createReadStream(p).pipe(res); },
    () => res.writeHead(404).end());
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const dir = mkdtempSync(join(tmpdir(), 'sleep-packs-'));
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
let ws, code = 1;
const close = async () => {
  try { ws?.close(); } catch {}
  chrome.kill('SIGKILL');
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
  const run = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const key = async (k, hold = 0) => {
    const printable = k.length === 1;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...(printable ? { text: k } : {}), key: k, code: k, windowsVirtualKeyCode: k === 'Enter' ? 13 : k === 'ArrowUp' ? 38 : k === 'ArrowDown' ? 40 : 0 });
    if (hold) await sleep(hold);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k });
  };
  const st = () => run(`({ packsOpen, jumpOpen, trapped: popups.length > 0, sleeping, visible: !$('packs').hidden, jl: cur?.dataset.jl ?? null, tabs: document.querySelectorAll('.hd-tab[data-f]').length })`);
  const openPacks = async (nth = 0) => {   // nth: which visible app tile Jump To is opened from
    await send('Page.navigate', { url: base + 'index.html?nosetup' });
    await sleep(2500);
    await run(`TV.focus([...document.querySelectorAll('.section:not(.is-off) [data-app]')].filter(e => e.offsetParent)[${nth}])`);
    await sleep(150);
    await key('j'); await sleep(350);
    await run(`(() => { const r = jList.querySelector('[data-jl="iconpack"]'); cur = null; TV.focus(r); })()`);
    await sleep(150);
    await key('Enter'); await sleep(500);
    return run(`packsOpen`);
  };

  let fails = 0;

  // (1) the away screen closes the picker and does not go back to Jump To
  let opened = await openPacks();
  const openOk = opened === true;
  await run(`sleep()`);
  await sleep(300);
  await key('ArrowDown'); await sleep(600);   // longer than the old closePackPicker() setTimeout
  let a = await st();
  let ok = openOk && a.packsOpen === false && a.visible === false && a.jumpOpen === false && a.sleeping === false &&
    a.trapped === false && a.tabs === 3;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} packs-away: opened=${opened} packsOpen=${a.packsOpen} hidden=${!a.visible} jumpOpen=${a.jumpOpen} sleeping=${a.sleeping} trapped=${a.trapped} tabs=${a.tabs}`);

  // (2) Escape still returns to Jump To with the iconpack row focused
  opened = await openPacks();
  const openOk2 = opened === true;
  await key('Escape'); await sleep(500);
  a = await st();
  ok = openOk2 && a.packsOpen === false && a.jumpOpen === true && a.jl === 'iconpack';
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} packs-Back: packsOpen=${a.packsOpen} jumpOpen=${a.jumpOpen} jl=${a.jl}`);
  await key('Escape'); await sleep(400);   // close Jump To again so the harness ends clean

  // (3) the picker is on the pop-up stack: only its rows take the remote, focus starts on the current pack
  opened = await openPacks();
  const so = await run(`(() => ({ stack: popups.map(l => l.id).join(',') || '-', pk: cur?.dataset.pk ?? null, iconPack,
    stray: [...document.querySelectorAll('.stage [data-f]')].filter(el => !$('packs').contains(el)).length,
    rows: pkList.querySelectorAll('[data-f]').length }))()`);
  ok = opened === true && so.stack === 'packs' && so.stray === 0 && so.rows > 0 && so.pk === so.iconPack;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} packs-stack:open stack=${so.stack} stray=${so.stray} rows=${so.rows} cur=${so.pk} iconPack=${so.iconPack}`);

  // (4) OK on the current pack closes the picker the same way as Back: Jump To again on the iconpack row
  await key('Enter'); await sleep(600);
  a = await st();
  const okStack = await run(`popups.map(l => l.id).join(',') || '-'`);
  ok = a.packsOpen === false && a.visible === false && a.jumpOpen === true && a.jl === 'iconpack' && okStack === 'jump';
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} packs-OK: packsOpen=${a.packsOpen} hidden=${!a.visible} stack=${okStack} jl=${a.jl}`);

  // (5) known, pre-existing (post-refactor list): IconPack -> Jump To -> close Jump To leaves nothing focused
  await key('Escape'); await sleep(400);
  const kj = await run(`({ stack: popups.map(l => l.id).join(',') || '-', cur: cur ? (cur.dataset.app ?? cur.dataset.tab ?? (cur.id || cur.className)) : null })`);
  console.log(`KNOWN packs-Jump-close: stack=${kj.stack} cur=${kj.cur} (pre-existing, not counted)`);

  // (6) closeAll() (the away screen's path) does not reopen Jump To; focus goes to the first control of the
  //     active section, as untrap(null) did, not to the tile Jump To was opened from
  opened = await openPacks(2);
  await run(`closeAll()`); await sleep(600);
  const nj = await run(`(() => ({ stack: popups.map(l => l.id).join(',') || '-', jumpOpen, hidden: $('packs').hidden,
    first: cur === document.querySelector('.section:not(.is-off) [data-f]'), app: cur?.dataset.app ?? null,
    tabs: document.querySelectorAll('.hd-tab[data-f]').length }))()`);
  ok = opened === true && nj.stack === '-' && nj.jumpOpen === false && nj.hidden === true && nj.first === true && nj.tabs === 3;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} packs-noJump: stack=${nj.stack} jumpOpen=${nj.jumpOpen} hidden=${nj.hidden} firstControl=${nj.first} cur=${nj.app} tabs=${nj.tabs}`);

  code = fails ? 1 : 0;
} catch (e) {
  console.log('FAIL ' + (e?.message || e));
  code = 1;
} finally {
  await close();
}
process.exit(code);
