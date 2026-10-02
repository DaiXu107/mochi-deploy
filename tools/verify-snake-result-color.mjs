// ===== 回归 #604：贪吃蛇 ①「我输了显示我赢」 ②对局结束时两只蛇的颜色不对 =====
// 用户原话（明说其他设备型号也有、要求不要覆盖式改动引发跨机型反复）：
//   「贪吃蛇有bug，我输了显示我赢，还有个可能就是对局结束时，两只蛇的颜色不对」
//
// ① 胜负原口径「谁分高谁赢」：撞死只是收局条件，胜负仍比分数 —— 我方撞死、分数却领先
//    对方时弹「你赢了」（零机型分支，任何机型浏览器必现，与设备无关）。
//    现按存活判：撞死的一方输；同一 tick 头对头一起撞死＝平局；coop 队友死＝队伍输。
// ② drawSnake 把死掉的蛇整条换成中性灰 —— 收局后画布停在冻结的最后一帧，灰化让场上颜色
//    与结算页的 🟢P1 / 🟠P2 对不上，两条一起撞死时更是两条全灰（＝用户说的「颜色不对」）。
//    现保留本蛇配色，死亡改由 × 眼 + 画布 snk-die 抖动/红晕（#352）表达。
//
// 用法：node tools/verify-snake-result-color.mjs
//   SERVE_DIR=<构建目录>  默认仓库根（跑根目录 index.html 产物）
//   SRC_DIR=<源码目录>    默认仓库根 src（静态锚点用；RED 基线时指旧源码）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_DIR || here);
const srcRoot = normalize(process.env.SRC_DIR || join(here, 'src'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, extra) { results.push({ desc, ok: !!ok }); console.log((ok ? '✅' : '❌') + ' ' + desc + (extra ? '  [' + extra + ']' : '')); }

// ---------- S 组：源码逻辑锚点（防静默回退，不依赖构建） ----------
let src = '';
try { src = readFileSync(join(srcRoot, 'js', 'snake-game.js'), 'utf8'); } catch (e) {}
check('S1 撞死的一方输（存活判定锚在位）', src.includes("if (!myAlive && oppAlive) result = 'lose';"));
check('S2 coop 队友死＝队伍输（myAlive 含 P2 存活）', src.includes('const myAlive = !!state.player.alive && !(state.p2 && !state.p2.alive);'));
check('S3 死亡不再刷中性灰（浅色 #cfcfd4 已移除）', !src.includes('#cfcfd4'));
check('S4 死亡不再刷中性灰（暗色 #4a4a52 已移除）', !src.includes('#4a4a52'));
check('S5 死亡保留本蛇配色（bodyC/headC 直取入参）', src.includes('const bodyC = bodyColor;') && src.includes('const headC = headColor;'));

// ---------- 无头浏览器 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const profile = join(process.env.TEMP || '/tmp', 'mochi-snake-rescolor-' + Date.now());
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const waitReady = async () => { for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) return; await sleep(200); } };

// ---------- 驱动：按意图给 P1/P2 发转向 ----------
const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const KEYMAP = { up: 'w', down: 's', left: 'a', right: 'd' };
const ST = async () => { const s = await evalJs('JSON.stringify(window.__snakeState && window.__snakeState())'); return s ? JSON.parse(s) : null; };
function snakeOf(st, which) { return which === 'p1' ? st.player : (st.mode === 'pvp' ? st.opp : st.p2); }
async function sendDir(which, dir) {
  if (which === 'p1') await evalJs(`(function(){var b=document.querySelector('#snake-dpad [data-dir="${dir}"]');if(b)b.click();return 1;})()`);
  else await evalJs(`(function(){document.dispatchEvent(new KeyboardEvent('keydown',{key:'${KEYMAP[dir]}',bubbles:true}));return 1;})()`);
}
function occupied(st, which, cell) {
  const me = snakeOf(st, which);
  const all = [st.player, st.p2, st.opp].filter(Boolean);
  for (const s of all) {
    const lim = s === me ? s.body.length - 1 : s.body.length;   // 自己的尾尖本 tick 让位
    for (let i = 0; i < lim; i++) if (s.body[i].x === cell.x && s.body[i].y === cell.y) return true;
  }
  return false;
}
function openSpace(st, sx, sy) {
  const occ = {};
  [st.player, st.p2, st.opp].filter(Boolean).forEach((s) => s.body.forEach((p) => { occ[p.x + ',' + p.y] = 1; }));
  const seen = {}; seen[sx + ',' + sy] = 1;
  const q = [[sx, sy]]; let n = 0;
  while (q.length && n < 120) {
    const c = q.shift(); n++;
    for (const k of ['up', 'down', 'left', 'right']) {
      const nx = c[0] + DIRS[k].x, ny = c[1] + DIRS[k].y, key = nx + ',' + ny;
      if (nx < 0 || nx >= st.gw || ny < 0 || ny >= st.gh) continue;
      if (seen[key] || occ[key]) continue;
      seen[key] = 1; q.push([nx, ny]);
    }
  }
  return n;
}
// intent: {mode:'to',x,y} | {mode:'wall'} | {mode:'safe'} | {mode:'fixed',dir}
function chooseDir(st, which, intent) {
  const me = snakeOf(st, which);
  if (!me || !me.alive) return null;
  const h = me.body[0], d = me.dir;
  const pool = ['up', 'down', 'left', 'right'].filter((k) => !(DIRS[k].x === -d.x && DIRS[k].y === -d.y));
  if (intent.mode === 'fixed') return intent.dir;
  if (intent.mode === 'wall') {
    const order = [
      { k: 'left', v: h.x }, { k: 'right', v: st.gw - 1 - h.x },
      { k: 'up', v: h.y }, { k: 'down', v: st.gh - 1 - h.y }
    ].sort((a, b) => a.v - b.v);
    for (const o of order) if (pool.indexOf(o.k) >= 0) return o.k;
    return null;
  }
  if (intent.mode === 'to') {
    const dx = intent.x - h.x, dy = intent.y - h.y;
    const ordered = Math.abs(dx) >= Math.abs(dy)
      ? [dx > 0 ? 'right' : dx < 0 ? 'left' : null, dy > 0 ? 'down' : dy < 0 ? 'up' : null]
      : [dy > 0 ? 'down' : dy < 0 ? 'up' : null, dx > 0 ? 'right' : dx < 0 ? 'left' : null];
    for (const k of ordered) {
      if (!k || pool.indexOf(k) < 0) continue;
      const c = { x: h.x + DIRS[k].x, y: h.y + DIRS[k].y };
      if (c.x < 0 || c.x >= st.gw || c.y < 0 || c.y >= st.gh) continue;
      if (occupied(st, which, c)) continue;
      return k;
    }
    intent = { mode: 'safe' };   // 目标不可直达 → 退化为安全走位
  }
  let best = null, bestScore = -1;
  for (const k of pool) {
    const c = { x: h.x + DIRS[k].x, y: h.y + DIRS[k].y };
    if (c.x < 0 || c.x >= st.gw || c.y < 0 || c.y >= st.gh) continue;
    if (occupied(st, which, c)) continue;
    const sc = openSpace(st, c.x, c.y);
    if (sc > bestScore) { bestScore = sc; best = k; }
  }
  return best;
}
async function snapshot() {
  const raw = await evalJs(`(function(){
    const st = window.__snakeState();
    const res = document.getElementById('snake-result');
    const t = res ? res.querySelector('.snake-res-title') : null;
    const c = document.getElementById('snake-canvas');
    const cnt = { green: 0, orange: 0, blue: 0, gray: 0, grayDark: 0 };
    try {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const named = [['green',[52,199,89]],['orange',[255,159,10]],['blue',[90,200,250]],['gray',[207,207,212]],['grayDark',[74,74,82]]];
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 200) continue;
        for (const [n, rgb] of named) {
          if (Math.abs(d[i] - rgb[0]) <= 12 && Math.abs(d[i + 1] - rgb[1]) <= 12 && Math.abs(d[i + 2] - rgb[2]) <= 12) { cnt[n]++; break; }
        }
      }
    } catch (e) { cnt.err = '' + e; }
    return JSON.stringify({
      title: t ? t.textContent : null,
      rows: res ? res.textContent : '',
      colors: cnt,
      status: st && st.status, mode: st && st.mode,
      p1: st && { alive: st.player.alive, score: st.player.score },
      p2: st && st.p2 && { alive: st.p2.alive, score: st.p2.score },
      opp: st && { alive: st.opp.alive, score: st.opp.score, ctrl: st.opp.ctrl }
    });
  })()`);
  return raw ? JSON.parse(raw) : null;
}
// 跑一局：cfg = { mode, wall, intent, timeout, settle }
async function runGame(cfg) {
  await evalJs(`window.openSnakePanel(); 1`);
  await sleep(350);
  await evalJs(`(function(){
    var m=document.getElementById('snake-mode'); m.value='${cfg.mode}'; m.dispatchEvent(new Event('change',{bubbles:true}));
    var f=document.getElementById('snake-food'); f.value='8'; f.dispatchEvent(new Event('change',{bubbles:true}));
    var d=document.getElementById('snake-diff'); d.value='easy'; return 1;})()`);
  await sleep(250);
  const wallOn = await evalJs(`document.getElementById('snake-wall').classList.contains('on')`);
  if (!!cfg.wall !== !!wallOn) { await evalJs(`document.getElementById('snake-wall').click(); 1`); await sleep(150); }
  await evalJs(`document.getElementById('snake-start').click(); 1`);
  for (let i = 0; i < 80; i++) { const st = await ST(); if (st && st.status === 'playing') break; await sleep(80); }
  const t0 = Date.now();
  const timeout = cfg.timeout || 30000;
  let last = null;
  while (Date.now() - t0 < timeout) {
    const st = await ST();
    if (!st) break;
    last = st;
    if (st.status !== 'playing') break;
    const acts = cfg.intent(st);
    if (acts) {
      for (const [which, intent] of acts) {
        if (!intent) continue;
        const dir = chooseDir(st, which, intent);
        if (dir) await sendDir(which, dir);
      }
    }
    await sleep(cfg.interval || 70);
  }
  await sleep(cfg.settle || 1200);   // 700ms 后弹结算
  return await snapshot();
}

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');

// ---------- L 组：默认形态（迷你框回归） ----------
// 用户报「好多手机使用这个功能是迷你框，无法正常玩」——默认全屏判据原只看
// window.innerWidth < 900：①桌面版网站模式（device.js 已 force-mobile 成手机形态，
// innerWidth 仍是 980）；②手机横屏（视口 ≥900）→ 都判成桌面停在半框，画布自查一路
// 收到 6px 格子下限（实测 980×600 下 176px、横屏 932 下 90px）。
// ⚠️ 顺序敏感：真桌面用例必须跑在开启触摸仿真之前（无触摸时 pointer:coarse=false 才
// 是真桌面形态；CDP 的触摸仿真开了之后同一 target 上关不掉）。
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
async function setEnv(w, h, ua, touch) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: !!touch });
  if (touch) await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp('Emulation.setUserAgentOverride', { userAgent: ua });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady(); await sleep(1200);
}
async function probeLayout() {
  await evalJs('window.enterChat && window.enterChat(); 1');
  await sleep(300);
  await evalJs('window.openSnakePanel && window.openSnakePanel(); 1');
  await sleep(650);
  const raw = await evalJs(`(function(){
    const p = document.getElementById('chat-snake-panel');
    const c = document.getElementById('snake-canvas');
    const r = p.getBoundingClientRect();
    const d = window.mochiDevice || {};
    return JSON.stringify({
      fs: p.classList.contains('snake-fs'),
      cover: Math.round(r.width) >= window.innerWidth - 2 && Math.round(r.height) >= window.innerHeight - 2,
      canvas: [Math.round(c.getBoundingClientRect().width), Math.round(c.getBoundingClientRect().height)],
      innerW: window.innerWidth, innerH: window.innerHeight,
      isMobile: !!d.isMobile, isTablet: !!d.isTablet,
      forceMobile: document.documentElement.classList.contains('force-mobile')
    });
  })()`);
  await evalJs('window.closeSnakePanel && window.closeSnakePanel(); 1');
  await sleep(200);
  return raw ? JSON.parse(raw) : null;
}
const minSide = (l) => (l && l.canvas ? Math.min(l.canvas[0], l.canvas[1]) : 0);
const fmtL = (l) => (l ? 'fs=' + l.fs + ' cover=' + l.cover + ' canvas=' + l.canvas.join('×') + ' innerW=' + l.innerW + ' isMobile=' + l.isMobile + ' forceMobile=' + l.forceMobile : 'null');

await setEnv(1280, 800, DESKTOP_UA, false);          // 真桌面：无触摸 + 宽屏
const L0 = await probeLayout();
check('L0 真桌面（1280×800 无触摸）保持半框、画布仍可玩（原行为不变）',
  L0 && !L0.fs && !L0.cover && minSide(L0) >= 200, fmtL(L0));

// ---- 以下用例统一开触摸仿真（等价手机）----
await setEnv(390, 844, ANDROID_UA, true);
const L1 = await probeLayout();
check('L1 安卓竖屏（390×844）全屏 + 画布够大',
  L1 && L1.fs && L1.cover && minSide(L1) >= 250, fmtL(L1));

await setEnv(980, 1743, DESKTOP_UA, true);           // 桌面版网站模式（force-mobile 族）
const L2 = await probeLayout();
check('L2 桌面版网站模式竖屏（980×1743，force-mobile）全屏 + 画布够大',
  L2 && L2.fs && L2.cover && minSide(L2) >= 250, fmtL(L2));

await setEnv(980, 600, DESKTOP_UA, true);            // 桌面版网站模式横屏（原 176px）
const L3 = await probeLayout();
check('L3 桌面版网站模式横屏（980×600）全屏 + 画布够大（原 176px 没法玩）',
  L3 && L3.fs && minSide(L3) >= 250, fmtL(L3));

await setEnv(932, 430, ANDROID_UA, true);            // 手机横屏（原 90px）
const L4 = await probeLayout();
// 430px 高的横屏全屏后画布高度就是 200 出头（表头/计分/方向键都要占位），取 180 判「不再塌到没法玩」
check('L4 手机横屏（932×430）全屏 + 画布够大（原 90px 没法玩）',
  L4 && L4.fs && minSide(L4) >= 180, fmtL(L4));

// ---- B/C 组：回到标准手机视口 ----
await setEnv(390, 844, ANDROID_UA, true);

// ---- B1（pvp）：P1 撞死且分数领先 → 必须「P2 赢了」（旧口径会显示「P1 赢了」）----
async function pvpVictimDies(which) {
  return await runGame({
    mode: 'pvp', timeout: 32000,
    intent: (st) => {
      const a = which === 'p1' ? st.player : st.opp;
      const b = which === 'p1' ? st.opp : st.player;
      const mine = which === 'p1' ? 'p1' : 'p2', other = which === 'p1' ? 'p2' : 'p1';
      if (a.score > b.score + 5) return [[mine, { mode: 'wall' }], [other, { mode: 'safe' }]];
      const h = a.body[0];
      let best = null, bd = 1e9;
      st.foods.forEach((f) => { const d = Math.abs(f.x - h.x) + Math.abs(f.y - h.y); if (d < bd) { bd = d; best = f; } });
      return [[mine, best ? { mode: 'to', x: best.x, y: best.y } : { mode: 'safe' }], [other, { mode: 'safe' }]];
    }
  });
}
let r1 = await pvpVictimDies('p1');
check('B1 pvp：P1 撞死（分数领先）→ 结算「P2 赢了」',
  r1 && r1.title === 'P2 赢了',
  'title=' + (r1 && r1.title) + ' p1=' + JSON.stringify(r1 && r1.p1) + ' p2=' + JSON.stringify(r1 && r1.opp));

let r2 = await pvpVictimDies('p2');
check('B2 pvp：P2 撞死（分数领先）→ 结算「P1 赢了」',
  r2 && r2.title === 'P1 赢了',
  'title=' + (r2 && r2.title) + ' p1=' + JSON.stringify(r2 && r2.p1) + ' p2=' + JSON.stringify(r2 && r2.opp));

// ---- B3（pvp）：头对头同一 tick 一起撞死 → 平局 ----
let laneRow = null;
const r3 = await runGame({
  mode: 'pvp', timeout: 25000, interval: 55,
  intent: (st) => {
    if (laneRow === null) laneRow = st.opp.body[0].y;   // 记下 P2 所在行（不写死地图尺寸）
    const h = st.player.body[0];
    return [['p1', h.y !== laneRow ? { mode: 'to', x: h.x, y: laneRow } : { mode: 'fixed', dir: 'right' }],
      ['p2', { mode: 'fixed', dir: 'left' }]];
  }
});
// pvp 模式第二条人类蛇是 state.opp（ctrl='p2'），state.p2 为 null —— 别按 p2 字段取
function secondSnake(r) { return r && (r.mode === 'pvp' ? r.opp : r.p2); }
check('B3 pvp：头对头一起撞死 → 平局（不是单方获胜）',
  r3 && r3.title === '平局' && r3.p1 && !r3.p1.alive && secondSnake(r3) && !secondSnake(r3).alive,
  'title=' + (r3 && r3.title) + ' p1alive=' + (r3 && r3.p1 && r3.p1.alive) + ' p2alive=' + (secondSnake(r3) && secondSnake(r3).alive));

// ---- B4（duo）：玩家撞死且分数领先 → 不得「你赢了」 ----
async function duoPlayerDies() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await runGame({
      mode: 'duo', timeout: 32000,
      intent: (st) => {
        if (st.player.score > st.opp.score + 5) return [['p1', { mode: 'wall' }]];
        const h = st.player.body[0];
        let best = null, bd = 1e9;
        st.foods.forEach((f) => { const d = Math.abs(f.x - h.x) + Math.abs(f.y - h.y); if (d < bd) { bd = d; best = f; } });
        return [['p1', best ? { mode: 'to', x: best.x, y: best.y } : { mode: 'safe' }]];
      }
    });
    if (r && r.p1 && !r.p1.alive && r.opp && r.opp.alive) return r;   // 我方先撞死才算有效样本
  }
  return null;
}
const r4 = await duoPlayerDies();
check('B4 duo：玩家撞死（分数领先）→ 结算不是「你赢了」',
  r4 && r4.title === 'TA 赢了',
  'title=' + (r4 && r4.title) + ' p1=' + JSON.stringify(r4 && r4.p1) + ' opp=' + JSON.stringify(r4 && r4.opp));

// ---- B5（coop）：队友 P2 撞死 → 不得「组队获胜」 ----
async function coopMateDies() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await runGame({
      mode: 'coop', timeout: 32000,
      intent: (st) => {
        const mate = st.p2;
        if (!mate) return [['p1', { mode: 'safe' }]];
        const team = st.player.score + mate.score;
        if (team > st.opp.score + 5) return [['p2', { mode: 'wall' }], ['p1', { mode: 'safe' }]];
        const h = mate.body[0];
        let best = null, bd = 1e9;
        st.foods.forEach((f) => { const d = Math.abs(f.x - h.x) + Math.abs(f.y - h.y); if (d < bd) { bd = d; best = f; } });
        return [['p2', best ? { mode: 'to', x: best.x, y: best.y } : { mode: 'safe' }], ['p1', { mode: 'safe' }]];
      }
    });
    if (r && r.p2 && !r.p2.alive && r.opp && r.opp.alive && r.p1 && r.p1.alive) return r;
  }
  return null;
}
const r5 = await coopMateDies();
check('B5 coop：队友撞死（队伍分数领先）→ 结算不是「组队获胜」',
  r5 && r5.title === 'TA 赢了',
  'title=' + (r5 && r5.title) + ' p2=' + JSON.stringify(r5 && r5.p2) + ' opp=' + JSON.stringify(r5 && r5.opp));

// ---- C 组：收局冻结帧的颜色身份 ----
const GREEN = 300, OTHER = 300, GRAY = 200;
check('C1 duo 收局帧：我方仍为 P1 绿、TA 仍为蓝、无中性灰',
  r4 && r4.colors.green > GREEN && r4.colors.blue > OTHER && r4.colors.gray < GRAY && r4.colors.grayDark < GRAY,
  JSON.stringify(r4 && r4.colors));
check('C2 pvp 收局帧（P2 撞死）：P1 绿 + P2 橙都在、无中性灰',
  r2 && r2.colors.green > GREEN && r2.colors.orange > OTHER && r2.colors.gray < GRAY && r2.colors.grayDark < GRAY,
  JSON.stringify(r2 && r2.colors));
check('C3 pvp 收局帧（两条一起撞死）：绿 + 橙都在、无中性灰',
  r3 && r3.colors.green > GREEN && r3.colors.orange > OTHER && r3.colors.gray < GRAY && r3.colors.grayDark < GRAY,
  JSON.stringify(r3 && r3.colors));

chrome.kill(); server.close();
const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过' + (passed === results.length ? '  ALL PASS' : ''));
process.exit(passed === results.length ? 0 : 1);
