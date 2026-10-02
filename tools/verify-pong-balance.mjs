// ===== 专项回归：双人 Pong 难度平衡（pong.js v3.12.x 锁定式进攻误差重做） =====
// verify-suite:timeout=900000
// 用户反馈：「双人pong还是难度太高」「都难，我赢不了」。
// 根因：AI 的 predictErr/missRate 原实现是每帧重掷的噪声，挡板连续追踪时互相平均掉，
//       配置表里的失误率形同虚设——低难档 AI 实际几乎不失误。v3.12.x 改为每次球飞向 TA
//       只掷一次（approachErr/approachMiss），并分离玩家/TA 挡板高度（ppH）、分档球速上限（maxBall）。
// 本脚本不依赖真人手感：注入虚拟时钟 + 固定种子随机数，页面内同步快进跑完整对局；
// 「机器人玩家」走真实鼠标事件路径（mousedown/mousemove → inputY）操控右侧挡板，
// 按反应间隔/瞄准误差/手速三参数分三档水平，统计各难度对各水平机器人的胜率。
// 用例：
//   T1 结构：默认难度=休闲、获胜分提示随难度联动
//   T2 胜率矩阵：休闲×弱/中机器人应大比分能赢；简单×中机器人应多数能赢；
//      普通×中机器人互有胜负；困难×中机器人应难赢、×强机器人也不该被无脑碾压
//   T3 对局保存/恢复冒烟：中途关闭→重开出现「继续上局」→恢复后继续进行
//   T4 旧版存档兼容：无 approachErr/ppH/maxBall 字段的老存档恢复不产生 NaN、可正常打完
//   T5 全程无未捕获 JS 异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
// ---- 测试专用组装：template + 仅 pong.js（前置注入虚拟时钟 shim），不碰仓库构建产物 ----
const SHIM = `
window.__VC = { t: 0, q: [], seq: 0 };
// 原点必须钉死 0：读加载时的真实 performance.now 会让「固定种子」矩阵逐次跑随页面加载耗时
// 漂移原点，恰好卡在 >= 判据边缘的帧窗口（hard×strong 长回合）偶发多跑/少跑一帧→超时与否不复现（#784 排查时实测同码三跑 1 红）。
try { performance.now = function () { return __VC.t; }; } catch (e) {}
window.requestAnimationFrame = function (cb) { __VC.q.push(cb); return ++__VC.seq; };
window.cancelAnimationFrame = function () {};
(function () { // 固定种子随机数：同一代码版本下胜率矩阵可复现
  var s = 20260825;
  Math.random = function () {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    var z = Math.imul(s ^ s >>> 15, 1 | s);
    z = z + Math.imul(z ^ z >>> 7, 61 | z) ^ z;
    return ((z ^ z >>> 14) >>> 0) / 4294967296;
  };
})();
(function () { // 记录球绘制坐标（挡板是 fillRect，arc 且半径>=5 的只有球）
  var orig = CanvasRenderingContext2D.prototype.arc;
  CanvasRenderingContext2D.prototype.arc = function (x, y, r) {
    if (this.canvas && this.canvas.id === 'pong-canvas' && r >= 5) window.__ball = { x: x, y: y };
    return orig.apply(this, arguments);
  };
})();
`;
const jsFiles = ['__shim', 'pong.js'];
const sources = jsFiles.map((f) => f === '__shim' ? SHIM : readFileSync(join(root, 'src/js', f), 'utf8'));
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', '');
testHtml = testHtml.replace('/*__SCRIPTS__*/', sources.map((s, i) => '(function () { try {\n' + s + '\n} catch (__e) { if (window.__jsErrors) window.__jsErrors.push("f' + i + ':" + String(__e && __e.message || __e)); } })();').join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-test-build').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-pongbal-root-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(tmpRoot, rel));
    if (!p.startsWith(tmpRoot)) { res.writeHead(403); res.end(); return; }
    let hit = false;
    try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 200));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-pongbal-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 500)); return null; }
  return r && r.result ? r.result.value : null;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}

// ---- 页面内驱动器：注入到全局，供各用例调用 ----
// 机器人：每 REACT 帧（反应间隔）重新预测落点并叠加高斯瞄准误差，手指移动限速 HAND_SPEED px/帧，
// 经真实 MouseEvent 路径进 inputY（与真人输入同管线）。预测含上下墙反弹折叠。
const DRIVER = `
window.__pongDrv = (function () {
  var BOTX = 400 - 14 - 8 - 7;
  function gauss() { var u = 0, v = 0; while (u === 0) u = Math.random(); while (v === 0) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  var D = {
    setup: function () {
      var c = document.getElementById('pong-canvas');
      c.getBoundingClientRect = function () { return { top: 0, left: 0, right: 400, bottom: 300, width: 400, height: 300, x: 0, y: 0 }; };
      return true;
    },
    start: function (diff) {
      try { localStorage.removeItem((window.activePrefix && window.activePrefix() || 'xy-home-v2') + ':pong-saved'); } catch (e) {}
      var sel = document.getElementById('pong-diff'); sel.value = diff; sel.dispatchEvent(new Event('change', { bubbles: true }));
      window.openPongPanel();
      this.bot = null;
      document.getElementById('pong-overlay-btn').click();
      var c = document.getElementById('pong-canvas');
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, clientY: 150, bubbles: true }));
      return document.getElementById('pong-overlay').hidden === true;
    },
    predict: function (bx, by, vx, vy) {
      if (!(vx > 0.0001)) return by;
      var lo = 6, hi = 294, span = hi - lo;
      var t = (BOTX - bx) / vx;
      if (t < 0) return by;
      var y = by + vy * t;
      var yy = (y - lo) % (2 * span); if (yy < 0) yy += 2 * span;
      return lo + (yy <= span ? yy : 2 * span - yy);
    },
    tick: function (botCfg) {
      var b = window.__ball;
      if (!this.bot) this.bot = { last: b ? { x: b.x, y: b.y } : null, finger: 150, want: 150, n: 0 };
      var B = this.bot;
      B.n++;
      if (b) {
        var vx = b.x - (B.last ? B.last.x : b.x), vy = b.y - (B.last ? B.last.y : b.y);
        B.last = { x: b.x, y: b.y };
        if (B.n % botCfg.react === 0 || Math.abs(B.want - B.finger) > 120) {
          var py = this.predict(b.x, b.y, vx, vy);
          B.want = py + gauss() * botCfg.sigma;
        }
      }
      var d = B.want - B.finger;
      var stp = Math.max(-botCfg.speed, Math.min(botCfg.speed, d));
      B.finger = Math.max(10, Math.min(290, B.finger + stp));
      var c = document.getElementById('pong-canvas');
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: B.finger, bubbles: true }));
      var q = window.__VC.q.splice(0);
      window.__VC.t += 1000 / 60;
      for (var i = 0; i < q.length; i++) { try { q[i](window.__VC.t); } catch (e) {} }
    },
    result: function () {
      var ov = document.getElementById('pong-overlay'), ti = document.getElementById('pong-overlay-title');
      // 实际 DOM 文本格式：「N TA:M 你」（TA 分数在前、你的分数在后）
      var sc = document.getElementById('pong-score').textContent || '';
      var m = sc.match(/(\\d+)\\s*TA\\s*:\\s*你\\s*(\\d+)/);
      if (ov && !ov.hidden && ti && /赢|平局/.test(ti.textContent)) return { done: true, ta: m ? +m[1] : -1, you: m ? +m[2] : -1, title: ti.textContent };
      return { done: false, ta: m ? +m[1] : 0, you: m ? +m[2] : 0 };
    },
    again: function () { document.getElementById('pong-overlay-btn').click(); this.bot = null; },
    scoreText: function () { return document.getElementById('pong-score').textContent; }
  };
  return D;
})();
`;

// ---- 单元格模拟：某难度 × 某机器人打 N 局，返回胜率与平均比分 ----
// 纯帧数上限（每局 3 万帧 ≈ 虚拟 8 分钟）保证确定性；不引入墙钟截断。
async function simulateCell(diff, botName, games) {
  // 三档拟人水平：react=反应间隔帧数，sigma=瞄准高斯误差(px)，speed=手速上限(px/帧)
  const bots = { weak: { react: 26, sigma: 34, speed: 5 }, medium: { react: 15, sigma: 20, speed: 7 }, strong: { react: 6, sigma: 8, speed: 10.5 } };
  const cfg = JSON.stringify(bots[botName]);
  const expr = `(async function () {
    var D = window.__pongDrv, cfg = ${cfg}, out = [];
    D.start('${diff}');
    for (var g = 0; g < ${games}; g++) {
      var frames = 0, r = null;
      while (frames < 80000) {
        D.tick(cfg); frames++;
        r = D.result();
        if (r.done) break;
      }
      out.push({ you: r.you, ta: r.ta, done: r.done });
      if (g < ${games - 1}) D.again();
    }
    var wins = out.filter(function (x) { return x.you > x.ta; }).length;
    var sumYou = out.reduce(function (a, x) { return a + x.you; }, 0), sumTa = out.reduce(function (a, x) { return a + x.ta; }, 0);
    return { diff: '${diff}', bot: '${botName}', games: ${games}, wins: wins, winRate: +(wins / ${games}).toFixed(2), avgYou: +(sumYou / ${games}).toFixed(2), avgTa: +(sumTa / ${games}).toFixed(2), allDone: out.every(function (x) { return x.done; }), scores: out.map(function (x) { return x.you + ':' + x.ta; }).join(',') };
  })()`;
  return evalJs(expr);
}

try {
  await cdpConnect();
  const jsErrors = [];
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  const rawHandler = ws.onmessage;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(JSON.stringify(m.params).slice(0, 200));
    if (rawHandler) rawHandler(ev);
  };

  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(1800);

  console.log('\n== T1 结构 ==');
  ok('默认难度=休闲（casual）', await evalJs(`document.getElementById('pong-diff').value`) === 'casual');
  ok('静态获胜分提示=先得 3 分', ((await evalJs(`document.getElementById('pong-win-tip').textContent`)) || '').indexOf('先得 3 分') >= 0);
  ok('驱动器注入 + 画布矩形桩生效', await evalJs(DRIVER + ' window.__pongDrv.setup()') === true);
  const tipHard = await evalJs(`(function(){ var s=document.getElementById('pong-diff'); s.value='hard'; s.dispatchEvent(new Event('change',{bubbles:true})); return document.getElementById('pong-win-tip').textContent; })()`);
  ok('切到困难档提示联动为「先得 5 分获胜」', tipHard.indexOf('先得 5 分') >= 0, tipHard);
  await evalJs(`(function(){ var s=document.getElementById('pong-diff'); s.value='casual'; s.dispatchEvent(new Event('change',{bubbles:true})); return 1; })()`);

  console.log('\n== T2 胜率矩阵（虚拟时钟快进，固定种子） ==');
  const cells = [
    ['casual', 'weak', 12], ['casual', 'medium', 10],
    ['easy', 'medium', 10],
    ['normal', 'medium', 10],
    ['hard', 'medium', 10], ['hard', 'strong', 10],
  ];
  const results = {};
  for (const [diff, bot, n] of cells) {
    const r = await simulateCell(diff, bot, n);
    results[diff + '/' + bot] = r;
    console.log(`  · ${diff.padEnd(6)} × ${bot.padEnd(6)} 胜率 ${(r && r.winRate) ?? '?'} （场均 你 ${r && r.avgYou} : ${r && r.avgTa} TA）${r && !r.allDone ? ' ⚠ 有未完赛(超时)' : ''}`);
  }
  ok('休闲 × 弱机器人 胜率 ≥ 0.5（新手也能赢）', results['casual/weak'] && results['casual/weak'].winRate >= 0.5, results['casual/weak']);
  ok('休闲 × 中机器人 胜率 ≥ 0.85', results['casual/medium'] && results['casual/medium'].winRate >= 0.85, results['casual/medium']);
  ok('简单 × 中机器人 胜率 ≥ 0.55', results['easy/medium'] && results['easy/medium'].winRate >= 0.55, results['easy/medium']);
  ok('普通 × 中机器人 互有胜负（0.15~0.95）', results['normal/medium'] && results['normal/medium'].winRate >= 0.15 && results['normal/medium'].winRate <= 0.95, results['normal/medium']);
  ok('困难 × 中机器人 胜率 ≤ 0.45（仍是硬仗）', results['hard/medium'] && results['hard/medium'].winRate <= 0.45, results['hard/medium']);
  const wr = (k) => (results[k] ? results[k].winRate : -1);
  ok('同水平机器人下胜率随难度单调不增（休闲≥简单≥普通≥困难）', wr('casual/medium') >= wr('easy/medium') && wr('easy/medium') >= wr('normal/medium') && wr('normal/medium') >= wr('hard/medium'), { casual: wr('casual/medium'), easy: wr('easy/medium'), normal: wr('normal/medium'), hard: wr('hard/medium') });
  ok('全部对局正常完赛（无卡死超时）', Object.values(results).every((r) => r && r.allDone), Object.values(results).map((r) => r && r.allDone));

  console.log('\n== T3 对局保存/恢复冒烟（关面板→整页刷新→恢复） ==');
  // 注：同会话关面板后重开走「内存续局」直达对局（设计如此）；「继续上局」按钮对应的是
  // 刷新页面后从 localStorage 恢复的路径，故这里关闭后真的整页重载一次。
  const smokeA = await evalJs(`(function () {
    var D = window.__pongDrv, cfg = { react: 6, sigma: 6, speed: 9 }, out = {};
    D.start('easy');
    for (var i = 0; i < 12000; i++) {
      D.tick(cfg);
      var r0 = D.result();
      if (r0.done) break;
      if (r0.you + r0.ta >= 2) break;
    }
    var mid = D.result();
    out.midScore = mid.ta + ':' + mid.you;
    out.midLive = !mid.done;
    window.closePongPanel();
    var key = (window.activePrefix && window.activePrefix() || 'xy-home-v2') + ':pong-saved';
    try { out.savedRaw = !!localStorage.getItem(key); } catch (e) { out.savedRaw = 'err'; }
    return out;
  })()`);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(1800);
  await evalJs(DRIVER);
  const smokeB = await evalJs(`(function () {
    var D = window.__pongDrv, cfg = { react: 6, sigma: 6, speed: 9 }, out = {};
    D.setup();
    window.openPongPanel();
    out.resumeTip = /未完成/.test((document.getElementById('pong-overlay-body') || {}).textContent || '');
    out.btn2Visible = document.getElementById('pong-overlay-btn2').hidden === false;
    document.getElementById('pong-overlay-btn2').click();
    for (var j = 0; j < 12000; j++) { D.tick(cfg); if (D.result().done) break; }
    var fin = D.result();
    out.finished = fin.done;
    out.finalScore = fin.ta + ':' + fin.you;
    return out;
  })()`);
  const smoke = Object.assign({}, smokeA, smokeB);
  ok('制造进行中对局（≥2 分且未完赛）', smoke && /^\d+:\d+$/.test(smoke.midScore) && smoke.midLive === true && +(smoke.midScore.split(':')[0]) + +(smoke.midScore.split(':')[1]) >= 2, smoke);
  ok('关面板后对局已写入存档', smoke && smoke.savedRaw === true, smoke);
  ok('刷新后重开出现「未完成的对局」+ 继续按钮', smoke && smoke.resumeTip === true && smoke.btn2Visible === true, smoke);
  ok('恢复后能正常打到完赛', smoke && smoke.finished === true, smoke);

  console.log('\n== T4 旧版存档兼容（无新字段） ==');
  const legacy = await evalJs(`(function () {
    var D = window.__pongDrv, cfg = { react: 5, sigma: 5, speed: 9.5 }, out = {};
    var key = (window.activePrefix && window.activePrefix() || 'xy-home-v2') + ':pong-saved';
    try { localStorage.removeItem(key); } catch (e) {}
    // 手工构造 v3.11.x 老格式存档：无 approachErr/approachMiss/prevVx，params 无 ppH/maxBall
    var old = { diff: 'easy', playerScore: 2, opponentScore: 3, status: 'rally',
      ball: { x: 200, y: 150, vx: -3.8, vy: 1.2, speed: 4.4 },
      player: { y: 110, vy: 0, targetY: 110 }, opponent: { y: 90, vy: 0, targetY: 90, aiNextAt: 0, reactUntil: 0 },
      countdown: 0, countdownAt: 0, scorePauseUntil: 0, gameTime: 42000, roundStartTs: 38000,
      rallyHits: 3, playerStreak: 0, opponentStreak: 1, maxPlayerStreak: 1, maxOpponentStreak: 1, totalRounds: 5,
      beh: { active: null, cooldown: {}, consecCatch: 2 }, flashPaddle: 0, flashWall: 0, flashScore: 0,
      lastHit: 0, taBubble: null, sayCooldown: 0, emojiCooldown: 0, serveDir: 1, playerRallyHits: 1,
      params: { reactDelay: [0.55, 0.85], maxSpeed: 2.2, predictErr: 36, missRate: 0.16, paddleH: 94, ballR: 7, winScore: 4, fumble: 0.15 } };
    out.setOk = true;
    try { localStorage.setItem(key, JSON.stringify(old)); } catch (e) { out.setOk = String(e && e.message || e); }
    out.savedRaw = !!localStorage.getItem(key);
    window.openPongPanel();
    out.resumeOffered = document.getElementById('pong-overlay-btn2').hidden === false;
    document.getElementById('pong-overlay-btn2').click();
    for (var j = 0; j < 6000; j++) { D.tick(cfg); if (D.result().done) break; }
    var fin = D.result();
    out.finished = fin.done;
    out.finalScore = fin.ta + ':' + fin.you;
    out.noNaN = !/NaN|null/.test(document.getElementById('pong-score').textContent || 'NaN');
    try { localStorage.removeItem(key); } catch (e) {}
    return out;
  })()`);
  ok('老存档被识别并提供继续', legacy && legacy.resumeOffered === true, legacy);
  ok('老存档恢复后可正常完赛（无 NaN）', legacy && legacy.finished === true && legacy.noNaN === true, legacy);

  console.log('\n== T5 稳定性 ==');
  ok('全程无未捕获 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3));

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  if (fail > 0) process.exitCode = 1;
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
