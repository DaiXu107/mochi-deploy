// ===== 验证 #1059：通知逐条弹（关闭去重）开关 =====
// 用户直派：「联系人发来的多条消息我都要看到弹窗」——TA 连发多条时，默认只弹一条
//   （内容去重：同内容/近期弹过的不重弹，防同句连轰）。本批加开关：默认关闭＝保持去重；
//   打开后跳过内容类去重三闸，每条消息都单独弹系统通知；消息身份重放闸（#780，页面冻结后
//   重放的旧消息）不受影响——那类不是新消息。
// 断言：S 静态锚（开关行/助手/三闸旁路/手势绑定/全局键/胶囊）；B 行为（真实构建页 +
//   Notification 权限 granted + SW 拦截 showNotification 计数）：
//     默认态 同内容连发 3 条 → 恰 1 条；不同内容 3 条 → 3 条；
//     打开开关后 同内容连发 3 条 → 3 条；不同内容 3 条 → 3 条。
// 用法：node tools/verify-1059-notify-nodedup.mjs [--root=<已构建副本目录>]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize((process.argv.find((a) => a.startsWith('--root=')) || '').split('=')[1] || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => { try { return readFileSync(join(root, f), 'utf8'); } catch (e) { return ''; } };
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); } };

// ---- S 静态 ----
const tpl = read('src/template.html');
const bgk = read('src/js/bg-keep.js');
const shelp = read('src/js/settings-help.js');
const cont = read('src/js/contacts.js');
ok(tpl.includes('id="bg-notify-nodedup"'), 'S1 设置页有「通知逐条弹（关闭去重）」开关行');
ok(tpl.includes('默认关闭：内容相同或近期弹过的消息只弹一条'), 'S1b 行下小字写明默认与代价');
ok(bgk.includes('function bgNoDedup()'), 'S2 bgNoDedup 助手在位');
ok(bgk.includes('if (!force && !bgNoDedup() && (notifiedDup(nkey) || seenDup(nkey)))'), 'S3 已弹/已看去重闸可被开关旁路');
ok(bgk.includes('if (!force && !bgNoDedup() && recentChatDup(nkey, ts)) {'), 'S4 近期聊天内容去重闸可被旁路');
ok(bgk.includes('if (!force && !bgNoDedup() && lastHiddenAt > 0'), 'S5 切后台 15 秒闸也随开关旁路');
ok(bgk.includes('if (!d || (d.vis || d.nAt))') === false && bgk.includes("if (d && (d.vis || d.nAt)) { gateStats.replay++; return; }"), 'S6 消息身份重放闸（#780）保持原样，不受开关影响');
ok(bgk.includes("gSet('bg-notify-nodedup', '1')") && bgk.includes('kaUserGesture(e)'), 'S7 开关按手势绑定并落全局键');
ok(bgk.includes('if (!ndUserTouched) syncNoDedupUI();'), 'S8 IDB 回填后重读开关（与两开关同口径）');
ok(cont.includes("'bg-keepalive', 'bg-notify', 'bg-notify-nodedup'"), 'S9 全局键登记（跨桌面行为一致）');
ok(shelp.includes("sel: '#bg-notify-nodedup'"), 'S10 「功能说明」胶囊已登记');

// ---- B 行为 ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(normalize(root))) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port + '/index.html';

const chromePath = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge（CHROME_PATH）'); process.exit(1); }
const port = 11600 + Math.floor(Math.random() * 200);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(tmpdir(), 'mochi-1059-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 80; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 200); return r && r.result ? r.result.value : null; };

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Browser.grantPermissions', { origin: origin, permissions: ['notifications'] });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__notiCalls = [];
    window.__forceHidden = function (v) {
      window.__mochiHidden = !!v;
      try {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return window.__mochiHidden ? 'hidden' : 'visible'; } });
        Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return !!window.__mochiHidden; } });
      } catch (e) {}
      try { document.dispatchEvent(new Event('visibilitychange')); } catch (e) {}
    };
    try {
      localStorage.setItem('xy-home-v2:bg-notify', '1');
      localStorage.setItem('xy-home-v2:bg-keepalive', '1');
      localStorage.setItem('xy-home-v2:applock-qaskip', '1');
      if (window.__seedNoDedup) localStorage.setItem('xy-home-v2:bg-notify-nodedup', '1');
    } catch (e) {}
    (function () {
      const proto = window.ServiceWorkerRegistration && window.ServiceWorkerRegistration.prototype;
      if (proto && proto.showNotification && !proto.__wrapped) {
        proto.__wrapped = true;
        const orig = proto.showNotification;
        proto.showNotification = function (title, opts) {
          const o = opts || {};
          window.__notiCalls.push({ title: String(title), body: String(o.body || '').slice(0, 30), at: Date.now() });
          return orig.call(this, title, opts);
        };
      }
    })();
  `
});
await cdp('Page.navigate', { url: origin });
await sleep(3000);
for (let i = 0; i < 60; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
console.log('  DBG boot=' + JSON.stringify(await ev("(function(){return JSON.stringify({ready:!!window.__mochiDataReady,loaded:(window.__mochiLoaded||[]).length,fail:(window.__mochiExtFail||[]).slice(0,4),sdp:typeof window.showDeskPopup,rs:document.readyState,srcN:document.querySelectorAll('script[src]').length})})()")));
ok((await ev('Notification.permission')) === 'granted', 'B0 权限 granted（Browser.grantPermissions）');

async function burst(texts, tag) {
  await ev('window.__forceHidden(true)');
  await sleep(300);
  await ev('window.__notiCalls.length = 0');
  for (const t of texts) { var rr = await ev("window.showDeskPopup({ name: 'TA', text: '" + t + "', isHidden: true })"); if (String(rr).indexOf('EXC') >= 0) console.log('    send EXC: ' + String(rr).slice(0, 120)); await sleep(300); }
  await sleep(2200);
  const n = Number(await ev('window.__notiCalls.length'));
  console.log('    [' + tag + '] 实发 ' + n + ' 条');
  return n;
}

// 阶段1：默认（去重开）
const same1 = await burst(['同内容三连', '同内容三连', '同内容三连'], '默认·同内容×3');
ok(same1 === 1, 'B1 默认态：同内容连发 3 条 → 只弹 1 条（去重生效）', '实发=' + same1);
const diff1 = await burst(['默认甲', '默认乙', '默认丙'], '默认·不同内容×3');
ok(diff1 === 3, 'B2 默认态：不同内容连发 3 条 → 3 条（本就逐条弹）', '实发=' + diff1);

// 阶段2：打开「通知逐条弹（关闭去重）」（写全局键 + 重载页）
await ev("(function(){try{localStorage.setItem('xy-home-v2:bg-notify-nodedup','1');}catch(e){}return true;})()");
await cdp('Page.navigate', { url: origin });
await sleep(3000);
for (let i = 0; i < 60; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
const rg = await ev("(function(){var el=document.getElementById('bg-notify-nodedup');return el?el.checked:null;})()");
ok(rg === true, 'B3 重载后开关按存储回显为「开」', 'checked=' + rg);
const same2 = await burst(['关去重后同内容三连', '关去重后同内容三连', '关去重后同内容三连'], '关去重·同内容×3');
ok(same2 === 3, 'B4 关闭去重后：同内容连发 3 条 → 3 条都弹（用户点名的行为）', '实发=' + same2);
const diff2 = await burst(['关去重甲', '关去重乙', '关去重丙'], '关去重·不同内容×3');
ok(diff2 === 3, 'B5 关闭去重后：不同内容仍是 3 条（不误伤）', '实发=' + diff2);

ok(Number(await ev('(window.__jsErrors||[]).length')) === 0, 'Z1 全程零 JS 异常');

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n== #1059 通知逐条弹（关闭去重）验证: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);
