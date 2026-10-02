// ===== 回归脚本 #626：寻踪「更新了一条日常」系统消息改昵称后同 ts 变两条 =====
// 用法：node tools/verify-checkin-daily-dup.mjs            # 打构建产物 index.html（需先构建）
//       node tools/verify-checkin-daily-dup.mjs --tmp      # 从 src 临时拼装（免构建、不写产物）
// verify-suite:timeout=200000
//
// 用户反馈：「联系人更新日常，聊天里的系统消息会显示 2 条，重复一条」（同会话不用刷新就出现）。
// 根因（零机型分支，纯逻辑）：寻踪系统消息正文内嵌联系人昵称（p2-features `name + ' 更新了一条日常'`）。
//   改昵称时 chat.js 的 sysNickSweepMsgs 会把 msgs 里这条清扫成 `{ta} 更新了一条日常` 并落盘，
//   但 chat-tail 兜底日志里仍是「旧名 更新了一条日常」；下次 loadMsgs 的 chatTailMerge 按
//   ts|side|正文 签名判不出同一条 ⇒ 把旧名那条当「未落盘的新消息」补回 ⇒ 同一 ts 两条、
//   文字不同又永远合不掉（相邻重复归一化按 dupSig 文本比对，{ta} 与旧名不相等）。
// 修复：凡清扫 msgs 的 oldName，同步清扫 chat-tail（chatTailSweepNick）；两处清扫点都接。
//
// 断言：A 源码锚（清扫尾巴的唯一入口 + 两个清扫点都接线）；B 真实产物（改名后 msgs/尾巴/重载各一）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || __root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---------- A 轴：源码锚 ----------
const chatSrc = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
check('A1 chatTailSweepNick 唯一入口在位（尾巴日志昵称清扫）',
  /function chatTailSweepNick\(oldName, slot\) \{/.test(chatSrc));
check('A2 改名钩子 chatSysNickChanged 接了尾巴清扫',
  /sysNickSweepMsgs\(msgs, oldName, slot\)\) saveMsgs\(\);\s*try \{ chatTailSweepNick\(oldName, slot\); \}/.test(chatSrc));
check('A3 sysNickCatchup 两处清扫点都接了尾巴清扫',
  (chatSrc.match(/chatTailSweepNick\(hist\[/g) || []).length >= 2 && /chatTailSweepNick\(hist\[hist\.length - 1\], slotKey\)/.test(chatSrc));

// ---------- 浏览器 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.log('环境不满足：找不到 Chrome/Edge（设 CHROME_PATH 后重跑）'); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
let tmpPage = null;
if (process.argv.includes('--tmp')) {
  const buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8');
  const cssList = Function('"use strict";return ' + buildSrc.match(/const cssFiles = (\[[^\]]+\]);/)[1])();
  const jsList = Function('"use strict";return ' + buildSrc.match(/const jsFiles = (\[[^\]]+\]);/)[1])();
  let tpl = readFileSync(join(root, 'src', 'template.html'), 'utf8');
  const css = cssList.map(f => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
  const js = jsList.map(f => readFileSync(join(root, 'src', 'js', f), 'utf8')).join('\n;\n');
  if (tpl.indexOf('/*__STYLES__*/') >= 0) tpl = tpl.replace('/*__STYLES__*/', () => css);
  else tpl = tpl.replace('</head>', () => '<style>' + css + '</style></head>');
  if (tpl.indexOf('/*__SCRIPTS__*/') >= 0) tpl = tpl.replace('/*__SCRIPTS__*/', () => js);
  else tpl = tpl.replace('</body>', () => '<script>' + js + '</scr' + 'ipt></body>');
  tmpPage = join(root, 'tmp-626-checkin-daily.html');
  writeFileSync(tmpPage, tpl);
}

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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9810 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-626-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

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
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function bootReady() {
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
  await sleep(800);
}
const URL = baseUrl + (tmpPage ? '/tmp-626-checkin-daily.html' : '/index.html');
const CNT = `(function(){ try {
  var arr = (window.getChatMsgs && window.getChatMsgs()) || [];
  var hits = arr.filter(function(m){ return m && String(m.text||'').indexOf('更新了一条日常') >= 0; });
  var tail = []; try { tail = JSON.parse(localStorage.getItem('xy-home-v2:default:chat-tail')||'[]').filter(function(j){ return String(j.text||'').indexOf('更新了一条日常') >= 0; }); } catch(e) {}
  var body = document.getElementById('chat-body'); var dom = 0;
  if (body) Array.prototype.forEach.call(body.children, function(n){ if ((n.textContent||'').indexOf('更新了一条日常') >= 0) dom++; });
  return JSON.stringify({ n: hits.length, texts: hits.map(function(m){ return m.text; }), tail: tail.map(function(j){ return j.text; }), dom: dom });
} catch(e){ return JSON.stringify({ err: String(e) }); } })()`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await evalJs("(function(){ try{ indexedDB.deleteDatabase('xy-home-v2'); }catch(e){} try{ localStorage.clear(); }catch(e){} return 1; })()");

// B0：冷启动 → 自动寻踪只产生 1 条「更新了一条日常」系统消息（名字为默认兜底 TA）
await cdp('Page.navigate', { url: URL });
await sleep(2400);
await bootReady();
for (let i = 0; i < 12; i++) { const t = (await evalJs(CNT)) || '{}'; if (JSON.parse(t).n >= 1) break; await sleep(500); }
await sleep(800);
let o = JSON.parse((await evalJs(CNT)) || '{}');
check('B0 冷启动自动寻踪只产生 1 条「更新了一条日常」系统消息', o.n === 1, JSON.stringify(o));

// B1：改聊天昵称（TA → 小满）——历史系统消息被清扫成 {ta}
await evalJs("(function(){ window.activeStore().set('cs-lbl-partner','小满'); if (window.chatSysNickChanged) window.chatSysNickChanged('TA'); return 1; })()");
await sleep(1500);
o = JSON.parse((await evalJs(CNT)) || '{}');
check('B1 改名后 msgs 仍只有 1 条（尾巴清扫未把旧名补回）', o.n === 1, JSON.stringify(o));
// #766 之后日志条目被权威历史覆盖即退休，故此处的不变量是「日志里没有带旧名的条目」：
// 既可能是清扫后的 {ta} 形态，也可能整条已退休（空）——两种都算职责完成。
// 原缺陷形态（旧名原文躺在日志里等着被回放进已改名的历史）仍然必红。
check('B2 尾巴日志里没有带旧名的条目（已清扫或已随历史退休）',
  Array.isArray(o.tail) && o.tail.every((t) => t.indexOf('{ta}') === 0) && o.tail.every((t) => t.indexOf('TA 更新') < 0), JSON.stringify(o.tail));

// B3：重载（loadMsgs → chatTailMerge 的确定性回放路径），断言不翻倍
await cdp('Page.navigate', { url: URL });
await sleep(2400);
await bootReady();
await evalJs("window.enterChat && window.enterChat(); 1");
await sleep(1500);
o = JSON.parse((await evalJs(CNT)) || '{}');
check('B3 重载后 msgs 仍只有 1 条（原文不再被补齐）', o.n === 1, JSON.stringify(o));
check('B4 重载后 DOM 只渲染 1 条', o.dom === 1, 'dom=' + o.dom);

chrome.kill();
server.close();
if (tmpPage) { try { unlinkSync(tmpPage); } catch (e) {} }
const pass = results.filter(r => r.ok).length;
console.log('----');
console.log(pass + '/' + results.length + ' passed' + (tmpPage ? '（--tmp 拼装页）' : '（真实 index.html）'));
process.exit(pass === results.length ? 0 : 1);
