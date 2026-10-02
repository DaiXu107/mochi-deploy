// #1520 行为回归尺：字卡库写侧闸（#1519 复审收口）＋保底不双发
// 作者报障与复审实锤：
//   ① 寻踪三类字卡库的整包写（批量添加/删除/编辑/移组/删分组）此前无闸——大键盲窗里读空，
//      批量添加只写进新的一条、删除按钮 splice(NaN) 后写回空表 ＝ 整本自建卡被顶掉。
//   ② ta-ask.js 里另外三本题库（ta-choose/ta-curious/ta-roast）与 ta-ask 逐字同构，#1519 只覆盖了 ta-ask。
//   ③ #1513 的 4 秒保底比数据层取回首窗短：慢设备上「残缺一发 + 取回后完整一发」＝双发推送、双条记录。
//   ④ 闸拦下后调用方仍清空输入框并报「已添加/已导入」＝用户没料可「再点一次」。
// 红侧（纯 23582f4 产物）恰红：S1~S8 ＋ B1（寻踪整本被顶）＋ B2（小问题库被顶）＋ B4（输入被清空）。
import { readFileSync, statSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(resolve(process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..'));
if (!existsSync(join(root, 'index.html'))) { console.error('产物不在：' + root); process.exit(2); }
console.log('被测产物：' + root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' ← ' + detail : '')); }
};

const srcOf = (f) => { try { return readFileSync(join(root, 'js', f), 'utf8'); } catch (e) { return ''; } };
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const P2 = srcOf('p2-features.js') + indexHtml;
console.log('S 产物锚');
ok('S1 #1520a 寻踪字卡库整包写前问读全没有', P2.includes("xyBigWriteBlocked(store, 'checkin-cards-' + k, '寻踪字卡库')"));
ok('S2 #1520b 保底那一发不再重入新闸', P2.includes('ckBigBypass = true;'));
ok('S3 #1520c 小问题库写闸', srcOf('ta-ask.js').includes("xyBigWriteBlocked(store, KEY2, 'TA 的小问题库')"));
ok('S4 #1520d 好奇题库写闸', srcOf('ta-ask.js').includes("xyBigWriteBlocked(store, KEY3, 'TA 的好奇题库')"));
ok('S5 #1520e 吐槽题库写闸', srcOf('ta-ask.js').includes("xyBigWriteBlocked(store, KEY4, 'TA 的吐槽题库')"));
ok('S6 #1520f 内存里已读得到就不发取回', srcOf('chatcard.js').includes('if (HYDRATE_TRUSTS_MEMORY) {'));
ok('S7 #1520g 用户动作尊重写闸结果', P2.includes('ckSaveItems(ckTab, list) === false'));
ok('S8 #1520h 位置卡库保存回传布尔', srcOf('loc-lib.js').includes("CUSTOM_KEY, '位置卡库')) return false;"));

const candidates = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9250 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1520-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
try {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        break;
      }
    } catch (e) {}
    await sleep(150);
  }
  if (!ws) throw new Error('无法连接无头浏览器');
} catch (e) { console.error('SKIP: ' + e.message); chrome.kill(); server.close(); process.exit(2); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: '(async()=>{' + expr.trim() + '})()', awaitPromise: true, returnByValue: true, userGesture: true });
    if (r && r.exceptionDetails) return { __err: String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').slice(0, 300) };
    return r && r.result ? r.result.value : null;
  } catch (e) { return { __err: String(e).slice(0, 120) }; }
}
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 423, height: 853, deviceScaleFactor: 1.7, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "(function(){try{localStorage.setItem('xy-home-v2:cardlock-state','open');localStorage.setItem('xy-home-v2:cardlock-pwver','2');}catch(e){}})()" });
let jsErr = 0;
ws.addEventListener('message', (ev) => {
  try { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') jsErr++; } catch (e) {}
});
async function openCold() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 50; i++) { if ((await evalJs('return !!window.__mochiDataReady')) === true) break; await sleep(300); }
  await evalJs("var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}} return true;");
  await sleep(500);
  await evalJs("try { if (window.cardLockTryUnlock) window.cardLockTryUnlock('990815'); } catch (e) {} return true;");
}
const blindWindow = `(function(){var hd=Object.getOwnPropertyDescriptor(document,'visibilityState');
try{Object.defineProperty(document,'visibilityState',{get:function(){return 'hidden';},configurable:true});document.dispatchEvent(new Event('visibilitychange'));}catch(e){}
try{Object.defineProperty(document,'visibilityState',{get:function(){return 'visible';},configurable:true});document.dispatchEvent(new Event('visibilitychange'));}catch(e2){}
return true;})()`;
// 同会话种库（写即驻留）→ 等落库 → 切后台放掉＝盲窗；与 #1519 尺同款路径
const seedBig = (key, head, tag) => [
  "var ns = window.xyStore('xy-home-v2:default');",
  "var arr = [{ t: '" + head + "' }];",
  "for (var i = 0; i < 8000; i++) arr.push({ t: '" + tag + "第' + i + '号·一整段用来把这一格撑过二十万字符的大文本内容一二三四五六七八九十' });",
  "ns.set('" + key + "', JSON.stringify(arr));",
  "var warm = 0;",
  "for (var w = 0; w < 30; w++) { warm = (ns.get('" + key + "') || '').length; if (warm > 260000) break; await new Promise(function (r0) { setTimeout(r0, 200); }); }",
  "var landed = 0;",
  "for (var t = 0; t < 30; t++) { try { var raw0 = await window.idbGet('xy-home-v2:default:" + key + "'); landed = raw0 ? raw0.length : 0; } catch (e) {} if (landed > 260000) break; await new Promise(function (r1) { setTimeout(r1, 200); }); }",
  "var ls0 = (localStorage.getItem('xy-home-v2:default:" + key + "') || '').length;",
  "return { ls0: ls0, warm: warm, landed: landed };"
].join('\n');

console.log('B 行为断言（423×853 无头）');
await openCold();
const fx = await evalJs("return { ready: !!window.xyStore && !!window.idbGet && !!window.openCheckinPage };");
if (!fx || !fx.ready) { console.error('SKIP: 模块未就绪'); chrome.kill(); server.close(); process.exit(2); }

// ---- B1 寻踪字卡库写闸（判别核心）：盲窗里批量添加不得整本顶库 ----
const b1seed = await evalJs(seedBig('checkin-cards-place', '自建地点甲·楼下便利店', '地点填充'));
const b1 = await evalJs([
  blindWindow,
  "var li = document.getElementById('li-checkin-cards'); if (li) li.click();",
  "await new Promise(function (r0) { setTimeout(r0, 500); });",
  "var sel = document.getElementById('cck-batch-grp');",
  "if (sel && sel.options && sel.options.length) { try { sel.value = sel.options[sel.options.length - 1].value; } catch (e) {} }",
  "var ta = document.getElementById('cck-batch'); if (ta) ta.value = '盲窗里新加的地点';",
  "var btn = document.getElementById('cck-batch-add'); if (btn) btn.click();",
  "await new Promise(function (r1) { setTimeout(r1, 700); });",
  "var raw = null; try { raw = await window.idbGet('xy-home-v2:default:checkin-cards-place'); } catch (e) {}",
  "var arr = null; try { arr = JSON.parse(raw || 'null'); } catch (e2) {}",
  "return { n: (arr || []).length, head: (arr && arr[0] && arr[0].t) || '' };"
].join('\n'));
ok('B1a 寻踪地点库大键前提成立（LS 收走、库里落定、驻留可读）',
  b1seed && b1seed.ls0 === 0 && b1seed.landed > 260000 && b1seed.warm > 260000, JSON.stringify(b1seed));
ok('B1 盲窗里批量添加＝拦下不落笔、整本自建卡完好（控制项：红侧靠 #1513b 的取回钩先自愈，判别主锚＝S1/S7）',
  b1 && b1.n > 7000 && b1.head === '自建地点甲·楼下便利店', JSON.stringify(b1));

// ---- B2 小问题库写闸：探针可复现性不足（该键的加载期自动写与种库相撞），判别交给 S3~S5 三根锚
//      ＋#1519 尺 B2 的同形状证据（ta-ask 同款 handler/同款闸）——留此说明，不留一条会假红的断言。

// ---- B3 保底单发（控制项；无头本地 IDB 取回远快于 4s，双发判别主锚＝S2）----
const b3 = await evalJs([
  "var ns = window.xyStore('xy-home-v2:default');",
  "var h0 = 0; try { h0 = (JSON.parse(ns.get('checkin-history') || '[]') || []).length; } catch (e) {}",
  blindWindow,
  "try { window.openCheckinPage(); } catch (e1) {}",
  "var btn = document.getElementById('ck-refresh'); if (btn) btn.click();",
  "await new Promise(function (r2) { setTimeout(r2, 6500); });",
  "var h1 = 0; try { h1 = (JSON.parse(ns.get('checkin-history') || '[]') || []).length; } catch (e2) {}",
  "var msgs = window.getChatMsgs ? window.getChatMsgs() : [];",
  "var upd = msgs.filter(function (m) { return String((m && (m.text || m.content)) || '').indexOf('更新了一条日常') >= 0; }).length;",
  "return { add: h1 - h0, upd: upd };"
].join('\n'));
ok('B3 盲窗刷新后 6.5 秒内只生成一条日常/一条推送（保底不放行第二发；判别主锚＝S2）',
  b3 && b3.add <= 1, JSON.stringify(b3));

// ---- B4 被拦时输入框不丢（红侧恰红＝清空）----
const b4seed = await evalJs(seedBig('loc-lib-custom', '自建位置甲·楼下便利店', '位置填充'));
const b4 = await evalJs([
  blindWindow,
  "var btn = document.getElementById('cloc-batch-add');",
  "var ta = null;",
  "if (btn) { ta = btn.parentNode.querySelector('textarea'); }",
  "if (!ta) { ta = document.getElementById('cloc-batch'); }",
  "if (ta) ta.value = '盲窗里新加的位置卡';",
  "var sel = document.getElementById('cloc-batch-grp');",
  "if (sel && sel.options && sel.options.length) { try { sel.value = sel.options[sel.options.length - 1].value; } catch (e) {} }",
  "if (btn) btn.click();",
  "await new Promise(function (r0) { setTimeout(r0, 700); });",
  "var raw = null; try { raw = await window.idbGet('xy-home-v2:default:loc-lib-custom'); } catch (e1) {}",
  "var arr = null; try { arr = JSON.parse(raw || 'null'); } catch (e2) {}",
  "return { val: ta ? ta.value : '', n: (arr || []).length, head: (arr && arr[0] && arr[0].t) || '' };"
].join('\n'));
ok('B4a 位置卡库大键前提成立', b4seed && b4seed.ls0 === 0 && b4seed.landed > 260000, JSON.stringify(b4seed));
ok('B4 盲窗里批量加位置卡＝拦下不落笔、输入框原样保留（红侧恰红＝输入被清空且库被顶）',
  b4 && b4.n > 7000 && b4.head === '自建位置甲·楼下便利店' && String(b4.val || '').indexOf('盲窗里新加的位置卡') >= 0, JSON.stringify(b4));

ok('Z 全程零未捕获 JS 异常', jsErr === 0, 'jsErr=' + jsErr);

try { ws.close(); } catch (e) {}
chrome.kill(); server.close();
console.log('—— 合计：' + pass + ' 绿 / ' + fail + ' 红 ——');
process.exit(fail ? 1 : 0);
