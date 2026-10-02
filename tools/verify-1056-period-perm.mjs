// ===== 验证 #1056：通知权限「被浏览器静默拒绝/列表里找不到本站」的可恢复性 =====
// 背景（红米 K80 + Chrome 151 实报，附诊断 docx 与截图）：授权框从不出现，点「测试」时
//   请求直接被挡成拒绝（default → denied），网站设置列表里也找不到本站——#1017 已记录成因
//   （授权框反复弹出会被 Chrome 判「骚扰」自动挡，旧版一次点按发 2+ 次请求正是推手）。
//   网页侧无法再弹授权框（浏览器设计），唯一出路＝网站设置手动允许/手动添加本站网址；
//   原文案只指到「网站设置 → 通知 → 允许」，列表里没有本站时用户无处可点。
// 修法（本批四处）：①bg-keep 标红条/测试结果/被拒弹条三处指路补「手动添加」＋成因说明；
//   ②使用说明前提2 撤「拒绝后开关自动弹回」旧口径（与 #1014「开关只记意图」矛盾）＋补手动添加；
//   ③period.js 经期提醒接 #1014/#1017 同款纪律（此前裸调授权请求：被拒后每次开启都空发
//     一次请求再喂浏览器自动挡；权限不到位时提醒整条静默失效无提示）；
//   ④fullscreen.js 六处裸系统通知兜底改站内 toast（通知被拒设备上原兜底会静默失败）。
// 断言：S 静态锚；B 行为（真实构建页 + Notification 桩 permission='denied'：经期提醒开开关
//   不得发起授权请求、当场 toast 指路含「手动添加」、弹层提示行在位）；Z 零页面异常。
// 用法：node tools/verify-1056-period-perm.mjs [--root=<已构建副本目录>]
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

// ===== S 静态锚 =====
const per = read('src/js/period.js');
const fsJs = read('src/js/fullscreen.js');
const bgk = read('src/js/bg-keep.js');
const shelp = read('src/js/settings-help.js');
const tpl = read('src/template.html');

ok(per.includes('function periodPermHint()'), 'S1 经期权限指引函数在位');
ok(per.includes("if (Notification.permission === 'denied') { toast(periodPermHint()); return; }"), 'S2 经期提醒被拒时不再空发授权请求、直接指路');
ok(!/Notification\.requestPermission\(\);\s*\} catch/.test(per), 'S3 裸调授权请求（无 then/catch）已撤除');
ok(per.includes('此权限与设置→系统→「后台通知」共用'), 'S4 经期指路写明权限与后台通知共用');
ok(per.includes('手动添加本站网址'), 'S5 经期指路补「手动添加」');
ok(!fsJs.includes('new Notification('), 'S6 fullscreen.js 六处系统通知兜底已全部改站内 toast', '残留=' + (fsJs.match(/new Notification\(/g) || []).length);
ok(bgk.includes("「添加网站例外」→ 输入 ' + location.origin"), 'S7 测试结果补「添加网站例外」＋真实网址行');
ok(bgk.includes('浏览器已把本站通知记成「屏蔽」'), 'S8 标红条写明「自动挡、多半不是你点了拒绝」');
    ok(bgk.includes('两条路恢复：① 地址栏左侧图标 → 权限 → 通知 → 改「允许」；② Chrome 右上角 ⋮ → 设置 → 网站设置 → 通知 → 「添加网站例外」'), 'S8b 标红条含两条完整恢复路径（ⓘ 与 添加网站例外）');
    ok(bgk.includes('换 Edge / 电脑打开本站'), 'S8c 第三层出口在位（自动屏蔽无法解除时换浏览器＋数据迁移）');
ok(bgk.includes('列表里没有本站就在「允许」里手动添加本站网址'), 'S9 被拒弹条补「手动添加」');
ok(!tpl.includes('开关会自动弹回关闭'), 'S10 使用说明撤「拒绝后开关自动弹回」旧口径（与 #1014 行为矛盾）');
ok(tpl.includes('手动输入本站网址'), 'S11 使用说明前提2 补「添加网站例外→手动输入本站网址」');
ok(shelp.includes('此权限与「经期提醒」共用'), 'S12 后台通知胶囊写明与经期提醒共用权限');

// ===== B 行为：真实构建页 + Notification 桩（permission='denied'）=====
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

const chromePath = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge（CHROME_PATH）'); process.exit(1); }
const port = 9950 + Math.floor(Math.random() * 40);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(tmpdir(), 'mochi-1056-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; return; }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__:' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').split('\n')[0]; return r && r.result ? r.result.value : null; };
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

await connect();
await cdp('Page.enable'); await cdp('Runtime.enable');
// 在任何页面脚本之前装 Notification 桩：permission='denied'，requestPermission 计数
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "(function(){var n=0;window.__rpCalls=function(){return n;};window.Notification={permission:'denied',requestPermission:function(){n++;return Promise.resolve('denied');}};})()" });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/index.html' });
await sleep(3000);
for (let i = 0; i < 50; i++) { if ((Number(await ev('(window.__mochiLoaded||[]).length')) || 0) >= 78) break; await sleep(400); }
await ev("(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;}var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();return true;})()");
await sleep(600);

// 进经期页 → 开提醒设置弹层
await ev("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-period');});return true;})()");
await sleep(300);
const popOpen = await ev("(function(){var b=document.getElementById('period-notify-btn');if(!b)return 'no-btn';b.click();var p=document.getElementById('period-notify-pop');return p?'open':'no-pop';})()");
ok(popOpen === 'open', 'B1 提醒设置弹层能打开', String(popOpen));
await sleep(200);
const tip = String(await ev("(function(){var p=document.getElementById('period-notify-pop');return p&&p.querySelector('.dp-tip')?p.querySelector('.dp-tip').textContent:'';})()"));
ok(tip.indexOf('屏蔽') >= 0 && tip.indexOf('手动添加') >= 0, 'B2 弹层提示行：被拒时当场写明「被自动挡」＋「手动添加」', tip.slice(0, 80));

// 点「启用提醒」开关：denied 分支 → 不得发起授权请求，当场 toast 指路
await ev("(function(){var t=document.querySelector('#period-notify-pop .dp-toggle');if(t)t.click();return true;})()");
await sleep(400);
const rp = Number(await ev('window.__rpCalls()'));
ok(rp === 0, 'B3 被拒时点开关不再发起授权请求（不再喂浏览器「反复弹授权」自动屏蔽）', 'requestPermission 调用=' + rp);
let toast = String(await ev("(function(){var t=document.getElementById('cc-toast');return t?(t.textContent||''):'';})()"));
ok(toast.indexOf('屏蔽') >= 0 && toast.indexOf('手动添加') >= 0, 'B4 开关当场 toast 指路（含「屏蔽」成因与「手动添加」出路）', toast.slice(0, 90));
const on = await ev("(function(){var t=document.querySelector('#period-notify-pop .dp-toggle');return t?t.classList.contains('on'):null;})()");
ok(on === true, 'B5 开关保持开启（#1014 语义：只记意图，不因被拒回弹）');

ok(Number(await ev('(window.__jsErrors||[]).length')) === 0, 'Z1 全程零 JS 异常');

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n== #1056 通知权限可恢复性验证: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);
