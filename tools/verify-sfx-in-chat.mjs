// ===== 回归脚本：单聊「联系人发消息」无音效（v3.26.x 修复） =====
// 用法：node build.mjs && node tools/verify-sfx-in-chat.mjs
// 背景（用户反馈，红米 Turbo4 Pro + Via 浏览器）：音效设置里选了内置音效，
//   但联系人发消息不响，其他音效（发送/铃声）正常。
// 根因：sfx-in（联系人发送和回复消息）只在群聊 group-chat.js 触发，
//   chat.js 单聊 addIn 从未调用 playSfx('in') → 所有手机单聊收 TA 消息都静音。
// 修复：chat.js addIn 统一触发 playSfx('in')（silent 与已读回执 special:'read' 不播）；
//   sfx.js playBuiltin 等待 AudioContext resume 完成再 start（Via/WebView 定时触发更稳）。
// 验证（new-document 注入 playSfx 计数包装——不拦截真实播放）：
//   单聊 in 音效触发/静默分支 + 音效设置页三卡片结构 + 胶囊选择 + 自定义上传态操作行 + 清除回落。
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
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-sfxin-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
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
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 500)); return null; }
  return r && r.result ? r.result.value : null;
}
async function gotoApp(reload) {
  if (reload) await cdp('Page.reload', { ignoreCache: false });
  else await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// ---- 种子（每次 new document 前执行）----
// 音效内置选择键只种一次（sessionStorage 标记跨 reload 保持；后续用例自己改状态）。
// playSfx 计数包装：getter 返回「计数+透传真实实现」的包装函数——sfx.js 的
// `window.playSfx = fn` 赋值走 setter 存原始实现，不覆盖包装逻辑。
const boot = `
(function () {
  var P = 'xy-home-v2:default:';
  if (!sessionStorage.getItem('__sfx-seeded')) {
    localStorage.setItem(P + 'sfx-in-b', 'bubble');
    localStorage.setItem(P + 'sfx-out-b', 'tick');
    localStorage.setItem(P + 'sfx-ring-b', 'ring-warm');
    sessionStorage.setItem('__sfx-seeded', '1');
  }
  // 受控 IDB 桩：防止 idbRestore 用 IDB 快照覆盖（本测试不种 IDB）
  var gStub = function (k) { return Promise.resolve(undefined); };
  var sStub = function (k, v) { return Promise.resolve(true); };
  var dStub = function () { return Promise.resolve(true); };
  Object.defineProperty(window, 'idbGet', { configurable: false, get: function () { return gStub; }, set: function () {} });
  Object.defineProperty(window, 'idbSet', { configurable: false, get: function () { return sStub; }, set: function () {} });
  Object.defineProperty(window, 'idbDelete', { configurable: false, get: function () { return dStub; }, set: function () {} });
  // playSfx 调用计数（不拦截真实播放行为）
  window.__sfxCalls = [];
  var _sfxImpl = null;
  Object.defineProperty(window, 'playSfx', {
    configurable: true,
    get: function () {
      var f = _sfxImpl;
      if (!f) return function () {};
      return function (type, opts) {
        try { (window.__sfxCalls = window.__sfxCalls || []).push(String(type)); } catch (e) {}
        return f(type, opts);
      };
    },
    set: function (fn) { _sfxImpl = fn; }
  });
})();
`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- 全新档案空跑一次（初始化标记落地），随后注入种子重载 ----
await gotoApp();
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: boot });
await gotoApp(true);

// ---- A. 单聊 in 音效触发（核心回归门：修复前 chat.js 从不调 playSfx('in')） ----
const inCnt = () => evalJs(`(window.__sfxCalls || []).filter(function(t){ return t === 'in'; }).length`);
let c0 = await inCnt();
check('A1 加载后未自动播放 in 音效', c0 === 0, 'count=' + c0);

// 普通 TA 消息（无 silent）→ 应触发 in 音效
await evalJs(`window.chatAddIn('测试消息：在吗'); true`);
await sleep(150);
let c1 = await inCnt();
check('A2 单聊 addIn 普通消息触发 in 音效（修复前为 0）', c1 === c0 + 1, 'before=' + c0 + ' after=' + c1);

// silent 消息（小游戏互动/后台批量/静默通知）→ 不播
await evalJs(`window.chatAddIn('游戏互动消息', { silent: true }); true`);
await sleep(150);
let c2 = await inCnt();
check('A3 silent 消息不播 in 音效', c2 === c1, 'count=' + c2);

// 已读回执（special: read）→ 不播
await evalJs(`window.chatAddIn('', { special: 'read' }); true`);
await sleep(150);
let c3 = await inCnt();
check('A4 已读回执（special:read）不播 in 音效', c3 === c2, 'count=' + c3);

// 拍一拍（special: poke）→ 播（TA 主动行为，系统通知语义）
await evalJs(`window.chatAddIn('TA 拍了拍你', { special: 'poke' }); true`);
await sleep(150);
let c4 = await inCnt();
check('A5 拍一拍（special:poke）播 in 音效', c4 === c3 + 1, 'before=' + c3 + ' after=' + c4);

// ---- B. 音效设置页 UI（v3.26.x 重设计：三卡片 + 动态操作行） ----
await evalJs(`(function(){ var row = document.getElementById('row-sfx-settings'); if (row) row.click(); return !!row; })()`);
await sleep(300);
const pageVisible = await evalJs(`(function(){ var p = document.getElementById('page-sfx-settings'); return p && !p.hidden; })()`);
check('B1 点击设置行进入音效设置页', !!pageVisible);

const cardOk = await evalJs(`(function(){
  var need = ['sfx-ring-presets', 'sfx-in-presets', 'sfx-out-presets', 'sfx-ring-tools', 'sfx-in-tools', 'sfx-out-tools'];
  for (var i = 0; i < need.length; i++) { if (!document.getElementById(need[i])) return need[i]; }
  return 'ok';
})()`);
check('B2 三张卡片结构齐全（presets+tools 容器各 3 个）', cardOk === 'ok', cardOk);

const toolsTxt = await evalJs(`(function(){
  var el = document.getElementById('sfx-in-tools');
  return el ? (el.textContent || '').trim() : '';
})()`);
check('B3 无自定义时操作行只显示「上传自定义音频」', toolsTxt === '上传自定义音频', toolsTxt);

// 点「气泡」胶囊 → 应用并试听，胶囊高亮
const bubblePicked = await evalJs(`(function(){
  var el = document.getElementById('sfx-in-presets');
  var bs = el.querySelectorAll('.sfx-preset');
  for (var i = 0; i < bs.length; i++) { if ((bs[i].textContent || '').trim() === '气泡') { bs[i].click(); return true; } }
  return false;
})()`);
await sleep(200);
const inBVal = await evalJs(`localStorage.getItem('xy-home-v2:default:sfx-in-b')`);
const inOn = await evalJs(`(function(){
  var el = document.getElementById('sfx-in-presets');
  var bs = el.querySelectorAll('.sfx-preset');
  for (var i = 0; i < bs.length; i++) { if ((bs[i].textContent || '').trim() === '气泡' && bs[i].className.indexOf('on') >= 0) return true; }
  return false;
})()`);
const valTxt = await evalJs(`document.getElementById('sfx-in-val') ? document.getElementById('sfx-in-val').textContent : ''`);
check('B4 点「气泡」胶囊 → sfx-in-b 写入且高亮', bubblePicked && inBVal === 'bubble' && inOn && valTxt === '气泡', 'val=' + valTxt);

// 模拟已上传自定义音频 → 重载后操作行变为 试听/清除
await evalJs(`localStorage.setItem('xy-home-v2:default:sfx-in', 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='); true`);
await gotoApp(true);
const toolsTxt2 = await evalJs(`(function(){
  var el = document.getElementById('sfx-in-tools');
  return el ? (el.textContent || '').trim() : '';
})()`);
check('B5 有自定义音频时操作行=「试听自定义 清除自定义」', toolsTxt2 === '试听自定义清除自定义', toolsTxt2);
const valTxt2 = await evalJs(`document.getElementById('sfx-in-val') ? document.getElementById('sfx-in-val').textContent : ''`);
check('B6 自定义态状态值显示「自定义」', valTxt2 === '自定义', 'val=' + valTxt2);

// 点「清除自定义」→ 键删除、回落内置胶囊、操作行回到上传
await evalJs(`(function(){
  var el = document.getElementById('sfx-in-tools');
  var bs = el.querySelectorAll('button');
  for (var i = 0; i < bs.length; i++) { if ((bs[i].textContent || '').indexOf('清除') >= 0) { bs[i].click(); return true; } }
  return false;
})()`);
await sleep(200);
const inKeyGone = await evalJs(`localStorage.getItem('xy-home-v2:default:sfx-in') === null`);
const toolsTxt3 = await evalJs(`(function(){
  var el = document.getElementById('sfx-in-tools');
  return el ? (el.textContent || '').trim() : '';
})()`);
const bubbleOn2 = await evalJs(`(function(){
  var el = document.getElementById('sfx-in-presets');
  var bs = el.querySelectorAll('.sfx-preset');
  for (var i = 0; i < bs.length; i++) { if ((bs[i].textContent || '').trim() === '气泡' && bs[i].className.indexOf('on') >= 0) return true; }
  return false;
})()`);
check('B7 清除自定义 → 键删除 + 回落到内置气泡 + 操作行回上传', inKeyGone && bubbleOn2 && toolsTxt3 === '上传自定义音频', 'tools=' + toolsTxt3);

// ---- 收尾 ----
try { chrome.kill(); } catch (e) {}
server.close();
const failed = results.filter((r) => !r.ok);
console.log('\n结果：' + (results.length - failed.length) + '/' + results.length + ' 通过');
if (failed.length) { console.log('未通过：' + failed.map((f) => f.desc).join(' | ')); process.exit(1); }
