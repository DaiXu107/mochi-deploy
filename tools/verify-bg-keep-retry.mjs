// ===== 回归：后台保活退避补播（bg-keep.js v3.13.x） =====
// 用户反馈：网页音乐能与别的 App 双开，但后台保活不行——保活音频每 5 秒无条件
// 抢回播放权，与其它 App 的系统音频焦点无限拉锯。修复：外部打断按连击指数退避
// （base→2*base→…→max 封顶），补播失败自动翻倍续期；稳定播放够久才复位连击。
// 测试通过拦截 document.createElement('audio') 注入可编程桩（支持事件监听），
// 并用 __kaRetryBaseMs/__kaRetryMaxMs/__kaStableMs 把退避参数压到秒级，无需等待真实时长。
//
// 用例：
//   T1 参数覆盖生效 + 启动建桩成功（play 被调用）
//   T2 外部 pause 打断 → 排退避补播（间隔 ≥ base）
//   T3 补播失败（play 返回 rejected）→ 下次间隔翻倍
//   T4 连续多次打断 → 间隔封顶 max
//   T5 音乐播放中（__musicPlaying）→ 不抢播（不触发退避补播）
//   T6 无 JS 异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-bgkeep-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
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
  await sleep(4000);
  // 注入：退避参数压秒级 + 拦截 createElement('audio') + 打开保活开关
  await evalJs(`
    (function () {
      window.__kaRetryBaseMs = 500;
      window.__kaRetryMaxMs = 4000;
      window.__kaStableMs = 2000;
      window.__kaPlayCalls = 0;
      window.__kaPauseSim = 0;
      window.__kaPlayReject = false;
      window.__kaEl = null;
      function FakeAudio() {
        var self = this;
        this.paused = true; this.loop = true; this.volume = 0.05; this._src = ''; this._ls = {};
        this.addEventListener = function (ev, fn) { (self._ls[ev] = self._ls[ev] || []).push(fn); };
        this._fire = function (ev) { var a = self._ls[ev] || []; for (var i = 0; i < a.length; i++) { try { a[i](); } catch (e) {} } };
        Object.defineProperty(this, 'src', {
          get: function () { return self._src; },
          set: function (v) { self._src = v; }
        });
        this.play = function () {
          window.__kaPlayCalls++;
          if (window.__kaPlayReject) return Promise.reject(new Error('rejected'));
          self.paused = false;
          try { self._fire('play'); } catch (e) {}
          if (window.__kaPauseSim > 0) {
            window.__kaPauseSim--;
            setTimeout(function () { self.paused = true; try { self._fire('pause'); } catch (e) {} }, 0);
          }
          return Promise.resolve();
        };
        this.pause = function () { self.paused = true; };
        this.load = function () {};
        this.setAttribute = function () {};
        this.removeAttribute = function () {};
        window.__kaEl = self;
      }
      var origCE = document.createElement.bind(document);
      document.createElement = function (tag) {
        if (String(tag).toLowerCase() === 'audio') return new FakeAudio();
        return origCE(tag);
      };
      var kb = document.getElementById('bg-keepalive');
      if (kb && !kb.checked) { kb.checked = true; kb.dispatchEvent(new Event('change')); }
      else if (!kb) { console.error('no bg-keepalive btn'); }
      return true;
    })()
  `);
  await sleep(400);

  console.log('\n== T1 参数覆盖生效 + 启动建桩 ==');
  const t1 = await evalJs(`window.__kaRetryBaseMs === 500 && window.__kaRetryMaxMs === 4000`);
  ok('参数覆盖窗口生效', t1 === true);
  const plays = await evalJs(`window.__kaPlayCalls`);
  ok('保活启动即 play 过一次（桩已生效）', plays >= 1, plays);
  const hasEl = await evalJs(`!!window.__kaEl`);
  ok('音频桩实例已捕获（__kaEl）', hasEl === true);

  console.log('\n== T2 外部 pause 打断 → 退避排程 ==');
  const b2 = await evalJs(`window.__kaPlayCalls`);
  await evalJs(`window.__kaEl.paused = true; window.__kaEl._fire('pause'); true`);
  await sleep(150);
  const d2 = await evalJs(`window.__kaNextDelayMs`);
  ok('打断后进入退避（间隔 ≥ base 500）', typeof d2 === 'number' && d2 >= 500, d2);
  // 等退避定时器到点 → play 应再次被调用
  await sleep(600);
  const a2 = await evalJs(`window.__kaPlayCalls`);
  ok('退避到期后自动补播（play 次数 +1）', a2 > b2, { b2, a2 });

  console.log('\n== T3 补播失败 → 下次翻倍 ==');
  await evalJs(`window.__kaPlayReject = true; window.__kaEl.paused = true; window.__kaEl._fire('pause'); true`);
  await sleep(700); // 等 base 间隔的退避触发 play（rejected）
  await evalJs(`window.__kaPlayReject = false;`);
  await sleep(700); // 翻倍后的排程触发
  const d3 = await evalJs(`window.__kaNextDelayMs`);
  ok('补播失败后间隔翻倍（>= 2*base 1000）', typeof d3 === 'number' && d3 >= 1000, d3);

  console.log('\n== T4 连续多次打断 → 封顶 max ==');
  // 先把状态清干净：等排程跑完，再连续打断数次，每次等它到点
  await evalJs(`window.__kaPauseSim = 0; window.__kaEl.paused = true; true`);
  let last = 0;
  for (let i = 0; i < 4; i++) {
    await evalJs(`window.__kaEl.paused = true; window.__kaEl._fire('pause'); true`);
    await sleep(300 + 500 * i); // 每轮等当前退避到点
    last = await evalJs(`window.__kaNextDelayMs`);
  }
  ok('退避封顶 ≤ max(4000)', typeof last === 'number' && last <= 4000, last);
  ok('退避达到封顶（≥ 2000）', typeof last === 'number' && last >= 2000, last);

  console.log('\n== T5 音乐播放中 → 不抢播 ==');
  const c5 = await evalJs(`window.__kaPlayCalls`);
  await evalJs(`window.__musicPlaying = true; true`);
  await sleep(300);
  const c5b = await evalJs(`window.__kaPlayCalls`);
  ok('音乐在播时不抢播（play 次数不变）', c5b === c5, { c5, c5b });
  await evalJs(`window.__musicPlaying = false; true`);
  await sleep(200);

  console.log('\n== T6 无 JS 异常 ==');
  ok('加载至今无未捕获异常', jsErrors.length === 0, jsErrors.slice(0, 3));

} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
