// ===== 专项验证：吃什么·TA 饭点概率提醒（梦角发字卡到聊天）+ 字卡库【系统预设字卡→吃什么】tab =====
// 用法：node tools/verify-eat-remind.mjs（需先 node build.mjs）
// 覆盖：静态接线 / 运行时概率触发（补丁 Date 定格晚餐窗口 18:30 + Math.random=0 + prob=100，
//       启动即查一次路径）/ 窗口内 done 去重 / 总开关关闭不触发 /
//       字卡库 tab 渲染分组 + 逐张开关写 dc-off-eat:* 与 libPool 抽取联动 / 页面开关与概率弹窗 UI
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'application/x-ico' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 400));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-eatrm-' + Date.now()),
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

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// ---- S 组：静态接线（读构建产物） ----
const built = readFileSync(join(root, 'index.html'), 'utf8');
check('S1 构建产物含 DEFAULT_CARD_DATA.eat（提醒吃饭/追问关心 两组）', built.indexOf('DEFAULT_CARD_DATA.eat') >= 0 && built.indexOf('"提醒吃饭"') >= 0 && built.indexOf('"追问关心"') >= 0);
check('S2 字卡库注册【吃饭】tab（v3.16.x 独立页 #fc-tabs 静态预置）', /data-type="eat">吃饭<\/button>/.test(readFileSync(join(root, 'src', 'template.html'), 'utf8')) && /data-type="eat"/.test(built));
check('S3 吃什么页含 TA 提醒开关/概率按钮 + 饭点窗口表', built.indexOf('eat-remind-toggle') >= 0 && built.indexOf('eat-remind-prob') >= 0 && built.indexOf('EAT_REMIND_WINDOWS') >= 0);
// #93：吃饭提醒的后台通知统一由 chatAddIn 内部 addRec→showDeskMsg 发，eatRemindFire 不再自己调 bgNotifyCheck
// （背靠背各发一条、去重指纹异步登记来不及拦 → 后台弹两条）。产物整行去缩进，函数体可按顶层 function 边界切。
const fireStart = built.indexOf('function eatRemindFire(');
const fireEnd = built.indexOf('\nfunction ', fireStart + 10);
const fireBody = fireStart < 0 ? '' : built.slice(fireStart, fireEnd > fireStart ? fireEnd : fireStart + 4000);
check('S4 触发链路：eatRemindFire 走 chatAddIn 且不再自己 bgNotifyCheck（#93 后台双弹修复）+ done 去重键', fireBody.length > 200 && /window\.chatAddIn/.test(fireBody) && fireBody.indexOf('bgNotifyCheck') < 0 && built.indexOf("'eat-remind-done:'") >= 0, '函数体 ' + fireBody.length + ' 字符');
check('S5 启动即查一次（打开应用恰在窗口内可立即触发）', /eatRemindMaybe\(\);\s*\/\/\s*启动即查一次/.test(built));
check('S6 夜宵专属话术分组（夜宵提醒/夜宵关心）+ 抽取池常量 DEF_EAT_REMIND_NIGHT', built.indexOf('"夜宵提醒"') >= 0 && built.indexOf('"夜宵关心"') >= 0 && built.indexOf('DEF_EAT_REMIND_NIGHT') >= 0);

// ---- 运行时环境：补丁 Date 定格在晚餐窗口内（18:30）+ Math.random=0 + prob=100 ----
// addScriptToEvaluateOnNewDocument 每次导航自动注入；不动 eat-remind-en（各场景自管）
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
(function () {
  var _D = Date; var H = 18, M = 30;
  function F(...a) {
    if (!(this instanceof F)) {
      if (a.length === 0) { var d0 = new _D(); d0.setHours(H, M, 0, 0); return d0.toString(); }
      return _D.apply(null, a).toString();
    }
    if (a.length === 0) { var d = new _D(); d.setHours(H, M, 0, 0); return d; }
    return new (Function.prototype.bind.apply(_D, [null].concat(a)))();
  }
  F.prototype = _D.prototype;
  F.parse = _D.parse; F.UTC = _D.UTC;
  F.now = function () { var d = new _D(); d.setHours(H, M, 0, 0); return d.getTime(); };
  window.Date = F;
})();
(function () { Math.random = function () { return 0; }; })();
try { localStorage.setItem('xy-home-v2:default:eat-remind-prob', '100'); } catch (e) {}
` });

async function readyPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(700);
}
async function lsSet(key, val) { await evalJs("(function(){localStorage.setItem('xy-home-v2:default:'+" + JSON.stringify(key) + ',' + JSON.stringify(val) + ');return true;})()'); }
async function lsDel(key) { await evalJs("(function(){localStorage.removeItem('xy-home-v2:default:'+" + JSON.stringify(key) + ');return true;})()'); }
async function lsGet(key) { return evalJs("(function(){try{return localStorage.getItem('xy-home-v2:default:'+" + JSON.stringify(key) + ");}catch(e){return null;}})()"); }
// 统计聊天记录里梦角提醒话术的条数（LS 快照 xy-home-v2:<cid>:chat-msgs）
async function countRemindMsgs() {
  const v = await evalJs(`(function(){
    try {
      var raw = localStorage.getItem('xy-home-v2:default:chat-msgs') || '[]';
      var arr = JSON.parse(raw); if (!Array.isArray(arr)) arr = [];
      var pools = ['到饭点啦','该吃饭了哦','记得吃热乎的','别忙忘了吃饭','我看着呢，快去吃饭','放下手里的事','饭要按时吃','好好吃饭的人','饿了就去做点吃的','去吃饭吧，吃完跟我说说'];
      var n = 0;
      arr.forEach(function (m) {
        var t = (m && m.text) || '';
        if (m && m.side === 'in' && pools.some(function (p) { return t.indexOf(p) >= 0; })) n++;
      });
      return JSON.stringify({ total: arr.length, remind: n });
    } catch (e) { return JSON.stringify({ err: String(e) }); }
  })()`);
  try { return JSON.parse(v || '{}'); } catch (e) { return {}; }
}
async function todayKeyInPage() {
  return evalJs("(function(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');})()");
}

// ---- T1 运行时触发：en 默认开 + prob=100 + 窗口内 → 启动即发一张提醒字卡进聊天 ----
await readyPage(); // 首次导航建立档案数据
let t0 = await countRemindMsgs(); // 本次导航时 done 尚无标记，应已触发过一次
check('T1 窗口内启动即触发：聊天里出现 1 条梦角提醒字卡', t0.remind === 1, JSON.stringify(t0));
const dayKey = await todayKeyInPage();
let t1d = await lsGet('eat-remind-done:dinner:' + dayKey);
check('T1 done 标记已写入（eat-remind-done:dinner:<今天>）', t1d === '1', String(t1d));

// ---- T2 窗口内去重：重载后不再追加第二条 ----
await readyPage();
let t2 = await countRemindMsgs();
check('T2 同一饭点窗口重载不重复触发', t2.remind === 1, JSON.stringify(t2));

// ---- T3 总开关关闭 + 清 done → 重载也不触发 ----
await lsSet('eat-remind-en', '0');
await lsDel('eat-remind-done:dinner:' + dayKey);
await readyPage();
let t3 = await countRemindMsgs();
check('T3 关闭「TA 提醒」后清掉 done 也不触发', t3.remind === 1, JSON.stringify(t3));

// ---- T4 字卡库【其他互动功能字卡】新增「吃什么」tab + 分组渲染 + 逐张开关联动抽取池 ----
await readyPage(); // en 仍为 '0'，调度器不触发，计数不受 UI 操作影响
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=true;});var li=document.getElementById('li-fun-cards');if(li)li.click();return true;})()");
await sleep(800);
let tabInfo = JSON.parse(await evalJs(`(function(){
  var b = document.querySelector('#fc-tabs [data-type="eat"]');
  if (!b) return JSON.stringify({ has: false });
  b.click();
  return JSON.stringify({ has: true, label: b.textContent });
})()`) || '{}');
await sleep(700);
check('T4 【其他互动功能字卡】出现「吃饭」tab 且可切换', tabInfo.has && tabInfo.label === '吃饭', JSON.stringify(tabInfo));
let grp = JSON.parse(await evalJs(`(function(){
  var hs = Array.prototype.slice.call(document.querySelectorAll('#fc-list .cc-group-header'));
  return JSON.stringify({ names: hs.map(function (h) { return (h.querySelector('.ccg-name') || {}).textContent || ''; }), items: document.querySelectorAll('#fc-list .cc-item').length });
})()`) || '{}');
check('T4 「吃什么」tab 渲染 提醒吃饭/追问关心 两分组 + 卡片列表', grp.names.indexOf('提醒吃饭') >= 0 && grp.names.indexOf('追问关心') >= 0 && grp.items > 0, JSON.stringify(grp));
let offRes = JSON.parse(await evalJs(`(function(){
  try {
    var it = document.querySelector('#fc-list .cc-item');
    if (!it) return JSON.stringify({ err: 'no item' });
    var txtEl = it.querySelector('.t');
    var txt = txtEl ? txtEl.textContent.replace(/\\s*系统$/, '').trim() : '';
    var input = it.querySelector('input[type="checkbox"]');
    if (!input) return JSON.stringify({ err: 'no toggle' });
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return JSON.stringify({ txt: txt, stored: localStorage.getItem('xy-home-v2:default:dc-off-eat:' + txt) });
  } catch (e) { return JSON.stringify({ err: String(e) }); }
})()`) || '{}');
check('T4 单卡开关写入 dc-off-eat:<文案>', !offRes.err && offRes.stored === '1', JSON.stringify(offRes));
let poolFiltered = JSON.parse(await evalJs('(function(){try{var pool=window.getLibPool?window.getLibPool("eat","提醒吃饭",[]):[];var filtered=window.isDefaultCardOff?pool.filter(function(c){return !window.isDefaultCardOff("eat",c);}):pool;var gone=true;try{gone=filtered.indexOf(' + JSON.stringify(offRes.txt || '') + ')<0;}catch(e){}return JSON.stringify({before:pool.length,after:filtered.length,removedGone:gone});}catch(e){return JSON.stringify({err:String(e)});}})()') || '{}');
check('T4 关闭的字卡退出抽取池（libPool 联动过滤）', poolFiltered.before > poolFiltered.after && poolFiltered.removedGone, JSON.stringify(poolFiltered));

// ---- T5 吃什么页 UI：开关标签/状态翻转 + 概率弹窗写入 ----
await lsDel('eat-remind-en'); // 恢复默认开
await readyPage();
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"eat\"]');if(a)a.click();return true;})()");
await sleep(500);
let ui1 = JSON.parse(await evalJs(`(function(){
  var pg = document.getElementById('page-eat'); var t = document.getElementById('eat-remind-toggle'); var p = document.getElementById('eat-remind-prob');
  return JSON.stringify({ shown: !!t && !!p && pg && !pg.hidden, tl: t ? t.textContent : '', pl: p ? p.textContent : '' });
})()`) || '{}');
check('T5 打开吃什么页显示「TA 提醒：开」+「触发概率 100%」', ui1.shown && ui1.tl === 'TA 提醒：开' && /100%/.test(ui1.pl), JSON.stringify(ui1));
await evalJs("(function(){var b=document.getElementById('eat-remind-toggle');if(b)b.click();return true;})()");
await sleep(300);
let ui2 = JSON.parse(await evalJs(`(function(){
  var t = document.getElementById('eat-remind-toggle');
  return JSON.stringify({ tl: t ? t.textContent : '', en: localStorage.getItem('xy-home-v2:default:eat-remind-en') });
})()`) || '{}');
check('T5 点开关翻转为「关」并持久化 eat-remind-en=0', ui2.tl === 'TA 提醒：关' && ui2.en === '0', JSON.stringify(ui2));
await evalJs("(function(){var b=document.getElementById('eat-remind-prob');if(b)b.click();return true;})()");
await sleep(400);
await evalJs("(function(){var i=document.getElementById('modal-input');if(i){i.value='25';i.dispatchEvent(new Event('input',{bubbles:true}));}return true;})()");
await evalJs("(function(){var b=document.getElementById('modal-ok');if(b)b.click();return true;})()");
await sleep(300);
let ui3 = JSON.parse(await evalJs(`(function(){
  var p = document.getElementById('eat-remind-prob');
  return JSON.stringify({ pl: p ? p.textContent : '', v: localStorage.getItem('xy-home-v2:default:eat-remind-prob') });
})()`) || '{}');
check('T5 概率弹窗输入 25 保存 → 键写入 + 标签更新', ui3.v === '25' && /25%/.test(ui3.pl), JSON.stringify(ui3));

// ---- T6 夜宵窗口（22:00）触发用夜宵专属话术池，不复用「到饭点啦」等通用文案 ----
// 再注入 Date 补丁定格 22:00（新文档加载时覆盖前一个注入的 18:30）+ Math.random=0 + prob=100
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
(function () {
  var _D = Date; var H = 22, M = 0;
  function F(...a) {
    if (!(this instanceof F)) {
      if (a.length === 0) { var d0 = new _D(); d0.setHours(H, M, 0, 0); return d0.toString(); }
      return _D.apply(null, a).toString();
    }
    if (a.length === 0) { var d = new _D(); d.setHours(H, M, 0, 0); return d; }
    return new (Function.prototype.bind.apply(_D, [null].concat(a)))();
  }
  F.prototype = _D.prototype;
  F.parse = _D.parse; F.UTC = _D.UTC;
  F.now = function () { var d = new _D(); d.setHours(H, M, 0, 0); return d.getTime(); };
  window.Date = F;
})();
(function () { Math.random = function () { return 0; }; })();
try { localStorage.setItem('xy-home-v2:default:eat-remind-prob', '100'); } catch (e) {}
` });
await lsDel('eat-remind-en'); // 恢复默认开
// T5 曾把 en=0/prob=25 写入 LS+IDB 且 __wr-journal 有日志；T6 导航后启动回放
//（先于 idbRestore）会把 journal 旧值铺回 LS，retainValue 以 LS 为准 → 夜宵触发被 en=0 挡掉。
// 处理：① 清全局 journal（idb.js WRJ_KEY）；② 三层一致写 en=1/prob=100（IDB 权威）；
// ③ restore 完成后 IDB 的 __wr-j: 标记还会以权威值再修正一次。
await evalJs(`(function(){ localStorage.removeItem('xy-home-v2:__wr-journal'); return true; })()`);
await evalJs(`(function(){ return window.idbSet ? window.idbSet('xy-home-v2:default:eat-remind-en', '1').then(function(){ return window.idbSet('xy-home-v2:default:eat-remind-prob', '100'); }) : Promise.resolve(true); })()`);
await lsSet('eat-remind-en', '1');
await lsSet('eat-remind-prob', '100');
await lsDel('eat-remind-done:nightcap:' + dayKey); // 清夜宵窗口 done（dayKey 同日）
async function countNightMsgs() {
  const v = await evalJs(`(function(){
    try {
      var raw = localStorage.getItem('xy-home-v2:default:chat-msgs') || '[]';
      var arr = JSON.parse(raw); if (!Array.isArray(arr)) arr = [];
      var nightPools = ['夜深了，饿不饿','这个点还没睡呀','饿着肚子睡觉可不好','夜宵别吃太撑','偷偷问一句，今晚想吃夜宵吗','去煮碗热乎的面吧','深夜的胃','别只啃饼干','吃夜宵的人，今晚会做甜甜的梦','留一盏灯'];
      var dayPools = ['到饭点啦','该吃饭了哦','饭要按时吃','好好吃饭的人','别忙忘了吃饭'];
      var night = 0, day = 0, total = arr.length;
      arr.forEach(function (m) {
        var t = (m && m.text) || '';
        if (m && m.side === 'in') {
          if (nightPools.some(function (p) { return t.indexOf(p) >= 0; })) night++;
          if (dayPools.some(function (p) { return t.indexOf(p) >= 0; })) day++;
        }
      });
      return JSON.stringify({ total: arr.length, night: night, day: day, texts: arr.slice(-6).map(function (m) { return (m.side || '') + ':' + String(m.text || '').slice(0, 30); }) });
    } catch (e) { return JSON.stringify({ err: String(e) }); }
  })()`);
  try { return JSON.parse(v || '{}'); } catch (e) { return {}; }
}
let nb0 = await countNightMsgs();
await readyPage(); // 新导航 → 22:00 生效 → 启动即触发夜宵提醒
let nb1 = await countNightMsgs();
check('T6 夜宵窗口触发：新增 1 条夜宵专属话术进聊天', nb1.night - nb0.night === 1, JSON.stringify({ before: { total: nb0.total, night: nb0.night }, after: { total: nb1.total, night: nb1.night } }));
check('T6 夜宵触发未混入「到饭点啦」等通用吃饭文案', nb1.day === nb0.day, JSON.stringify({ before: nb0, after: nb1 }));
let t6d = await lsGet('eat-remind-done:nightcap:' + dayKey);
check('T6 夜宵窗口 done 标记已写入（eat-remind-done:nightcap:<今天>）', t6d === '1', String(t6d));

// 清理测试注入键（仅 default 桌面测试键，不触用户真实数据语义）
await lsDel('eat-remind-en');

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
