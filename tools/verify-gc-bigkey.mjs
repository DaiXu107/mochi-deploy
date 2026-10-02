// ===== 专项验证：#426 群聊大键口径对齐聊天页（group-chat.js + idb.js）=====
// 背景：群聊消息此前落盘整包 JSON.stringify（IDB 字符串 + LS 全量直写无上限）。
// #426 收口：① IDB 估算 >3MB 改 structured clone 数组直存（失败回退字符串），读取双形态兼容；
// ② LS 兜底改 liteSnap 减裁（剥图/语音/长文、_lsLite 标记）+ 超限折半丢弃，恒 ≤2MB；
// ③ idb.js 群聊消息键排除出「LS→IDB 大键迁移」（lite 快照覆盖数组权威＝丢数据）与「启动回填」。
// 断言：
//   S1     源码锚点：group-chat.js 阈值分支/liteSnap/双形态读取 + idb.js isGroupMsgsKey 两处排除
//   T0     进入群聊页并清空历史
//   T1     小记录字符串路径：发小消息落盘后 IDB 值是 JSON 字符串（与旧数据一致）
//   T2     大记录数组路径：发 >3MB 消息落盘后 IDB 值是 Array（structured clone 直存）
//   T3     LS 快照封顶：大记录下 LS 副本 ≤2MB、带 _lsLite 标记、大负载已被剥离
//   T4     数组权威读取：重载页面后消息数不丢、DOM 正常渲染、IDB 值仍是 Array
//   T5     数组形态续写：重载后再发消息，落盘仍是 Array 且条数增长（合并链路不断）
// 用法：node tools/verify-gc-bigkey.mjs
// 注意：从当前 src/ 临时组装页面（镜像 build.mjs 拼接顺序），不依赖/不污染构建产物。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => readFileSync(join(root, 'src', f), 'utf8');

// ---- 从当前 src 临时组装 index.html（顺序与 build.mjs 一致，不做压缩）----
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'period.js', 'accounting.js', 'garden.js', 'room.js', 'decision.js', 'group-decision.js', 'pong.js', 'snake-game.js', 'breakout.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'mobile-adapt.js'];
let html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const styles = cssFiles.map((f) => read(join('css', f))).join('\n');
const scripts = jsFiles.map((f) => {
  const code = read(join('js', f));
  return '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} } })();';
}).join('\n');
html = html.replace('/*__STYLES__*/', styles);
html = html.replace('/*__SCRIPTS__*/', scripts);
html = html.split('__BUILD_INFO__').join('verify-gcbigkey');
html = html.split('__BUILD_TS__').join(String(Date.now()));
html = html.split('__APP_VERSION__').join('v3.42.x-verify');
const tmpHtml = join(tmpdir(), 'mochi-gcbigkey-verify-' + Date.now() + '.html');
writeFileSync(tmpHtml, html);

// ---- 静态服务：根路径回临时组装页，其余资源走仓库根 ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    if (req.url === '/' || req.url.split('?')[0] === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9500 + Math.floor(Math.random() * 150));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(tmpdir(), 'mochi-gcbigkey-' + Date.now()),
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
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  JS异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').split('\n')[0]); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

// ---- 静态断言 ----
const sGc = readFileSync(join(root, 'src', 'js', 'group-chat.js'), 'utf8');
const sIdb = readFileSync(join(root, 'src', 'js', 'idb.js'), 'utf8');
check('S1a group-chat.js 阈值分支+数组直存回退', sGc.indexOf('gcMsgsBytes(msgs) <= GC_STR_THRESHOLD') >= 0 && sGc.indexOf('await window.idbSet(key, JSON.stringify(msgs))') >= 0, '');
check('S1b group-chat.js liteSnap 减裁+折半丢弃', sGc.indexOf('function gcLiteSnapArray') >= 0 && sGc.indexOf("c._lsLite = 1") >= 0 && sGc.indexOf('GC_SNAP_LIMIT') >= 0, '');
check('S1c group-chat.js 读取端双形态兼容', sGc.indexOf('if (Array.isArray(v)) a = v;') >= 0, '');
check('S1d idb.js 群聊键排除迁移+回填（lite 快照覆盖数组权威＝丢数据）', sIdb.indexOf('function isGroupMsgsKey') >= 0 && sIdb.indexOf('if (isGroupMsgsKey(k)) continue;') >= 0 && sIdb.indexOf('!isGroupMsgsKey(k) &&') >= 0, '');

// ---- 群聊回复关到 0（只测持久化链路，不受回复时序干扰）----
await evalJs("(function(){[['gc-prob','0'],['gc-rs-min','1'],['gc-rs-max','1'],['gc-touch-prob','0'],['gc-reply-min','1'],['gc-reply-max','1'],['gc-sticker-prob','0'],['gc-emoji-prob','0'],['gc-image-prob','0'],['gc-voice-prob','0'],['gc-kaomoji-prob','0'],['gc-quote-prob','0'],['gc-rc-prob','0'],['gc-py-en','0']].forEach(function(kv){window.saveReplyCfg(kv[0],kv[1]);});return true;})()");
await evalJs("(function(){window.getContacts=function(){return [{id:'gcbk1',name:'大键测试'}];};return true;})()");

const MSG_KEY = 'xy-home-v2:group-chat-msgs';
const enterGc = "(function(){var a=document.querySelector('.app[data-app=\"group-chat\"]');if(!a)return 'no-app';a.hidden=false;a.click();return document.getElementById('page-group-chat')&&!document.getElementById('page-group-chat').hidden?'in':'not-in';})()";

// ---- T0 进入并清空 ----
await evalJs(enterGc);
await sleep(800);
let rEnter = await evalJs("(function(){var p=document.getElementById('page-group-chat');return p&&!p.hidden?'in':'out';})()");
check('T0 进入群聊页', rEnter === 'in', String(rEnter));
await evalJs("(function(){window.groupChatClear();return true;})()");
await sleep(500);

// ---- T1 小记录 → 字符串路径（与旧数据一致）----
await evalJs("(function(){var i=document.getElementById('gc-input');i.innerText='小消息锚点甲';document.getElementById('gc-send').click();return true;})()");
// 落盘走空闲回调（timeout 4s）+ 最小间隔 2.5s，等 8s 必已写
await sleep(8000);
let t1 = J(await evalJs("(function(){return window.idbGet('" + MSG_KEY + "').then(function(v){return JSON.stringify({type:typeof v,isArr:Array.isArray(v),has:String(typeof v==='string'?v:'').indexOf('小消息锚点甲')>=0});});})()"));
check('T1 小记录落盘为 JSON 字符串（旧数据形态不变）', t1.type === 'string' && t1.isArr === false && t1.has === true, JSON.stringify(t1));

// ---- T2 大记录 → 数组直存 ----
await evalJs("(function(){var i=document.getElementById('gc-input');i.innerText='M'.repeat(3400000);document.getElementById('gc-send').click();return true;})()");
await evalJs("(function(){var i=document.getElementById('gc-input');i.innerText='小消息锚点乙';document.getElementById('gc-send').click();return true;})()");
await sleep(9000);
let t2 = J(await evalJs("(function(){return window.idbGet('" + MSG_KEY + "').then(function(v){return JSON.stringify({isArr:Array.isArray(v),n:Array.isArray(v)?v.length:-1});});})()"));
check('T2 大记录（>3MB）落盘为结构化数组直存', t2.isArr === true && t2.n >= 2, JSON.stringify(t2));

// ---- T3 LS 快照封顶 + lite 标记 + 大负载剥离 ----
let t3 = J(await evalJs("(function(){var s=localStorage.getItem('" + MSG_KEY + "')||'';return JSON.stringify({len:s.length,lite:s.indexOf('_lsLite')>=0,noBigLoad:s.indexOf('MMMMMMMMMMMMMMMM')<0});})()"));
check('T3 LS 快照 ≤2MB 且带 _lsLite、大负载已剥离', t3.len > 0 && t3.len <= 2 * 1024 * 1024 && t3.lite === true && t3.noBigLoad === true, JSON.stringify({ len: t3.len, lite: t3.lite, noBigLoad: t3.noBigLoad }));

// ---- T4 重载：数组权威读取不丢 ----
const preN = (await evalJs('window.groupChatGetMsgs().length')) || 0;
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
await evalJs(enterGc);
let t4 = null;
for (let i = 0; i < 40; i++) {
  t4 = J(await evalJs("(function(){var m=window.groupChatGetMsgs?window.groupChatGetMsgs():null;if(!m)return null;var b=document.getElementById('gc-body');return JSON.stringify({n:m.length,domOut:b?b.querySelectorAll('.msg-out').length:-1});})()"));
  if (t4 && t4.n >= preN && t4.domOut >= 2) break;
  await sleep(400);
}
let t4idb = J(await evalJs("(function(){return window.idbGet('" + MSG_KEY + "').then(function(v){return JSON.stringify({isArr:Array.isArray(v)});});})()"));
check('T4 重载后数组权威完整读回（条数+DOM 渲染+IDB 仍为数组）', t4 && t4.n >= preN && t4.domOut >= 2 && t4idb.isArr === true, JSON.stringify({ t4: t4, idb: t4idb, preN: preN }));

// ---- T5 数组形态续写 ----
await evalJs("(function(){var i=document.getElementById('gc-input');i.innerText='数组形态续写锚点丙';document.getElementById('gc-send').click();return true;})()");
await sleep(9000);
let t5 = J(await evalJs("(function(){return window.idbGet('" + MSG_KEY + "').then(function(v){var m=window.groupChatGetMsgs();return JSON.stringify({isArr:Array.isArray(v),idbN:Array.isArray(v)?v.length:-1,memN:m.length,last:String(m.length?m[m.length-1].text:'').slice(0,12)});});})()"));
check('T5 数组形态续写：落盘仍是 Array 且条数增长', t5.isArr === true && t5.idbN >= t4.n + 1 && t5.last === '数组形态续写锚点丙', JSON.stringify(t5));

try { chrome.kill(); } catch (e) {}
server.close();
const pass = results.filter((r) => r.ok).length;
console.log('\n== 群聊大键口径验证: ' + pass + '/' + results.length + ' ==');
process.exit(pass === results.length ? 0 : 1);
