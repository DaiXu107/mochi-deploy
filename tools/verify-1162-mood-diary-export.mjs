// ===== 常驻回归：#1162 心情日记导出误报「这个桌面没有数据」＋回填未齐时保存整包覆盖 =====
// 用户报障原话（vivo X200s/Edge）：「心情日记数据丢失。想导出来着，不知道为什么说我这个桌面没有数据，
// 我只有一个联系人桌面」。诊断包确认 cid=default、日记键就在 IDB 里。
// 两条真缺陷（零机型分支）：
//  ① feature-data.js 的 allKeys 把 idbListKeys() 的 null（契约＝「这次没读到」，见 idb.js #90 注）
//    和「确认空库」混为一谈：读失败瞬间 LS 快照又不在（大键只进 IDB / 另一会话在跑）→ 键清单为空
//    → 来一句「在本桌面还没有数据」，把一次读取失败说成事实。修法：null 时 800ms 退避重试一次；
//    仍失败则带 incomplete 标记，文案改诚实（「不代表没有数据——稍等片刻再导出」），清空/计数同理。
//  ② mood-diary.js 保存走 loadAll→改→saveAll 整包回写；IDB 回填未完时读到空包，一按保存就把
//    数据库里更早的日记整包盖掉（#850 同族、不可逆）——用户「数据丢失」的写侧通道。修法：
//    pending 且读到空时拒写并提示（mochiOnDataReady 会自动重渲，稍等再记即可）。
// 断言（红侧＝上一提交产物）：
//  S 组 产物源锚：S1 退避重试行／S2 incomplete 契约传播／S3 日记保存挡 pending 行
//  B 组 正常路径：LS 有日记键 → 导出成功、载荷含该键（两色都应绿＝清除语义没被改坏）
//  C 组 关键差分：日记键只在 IDB（LS 无痕）＋ idbListKeys 先 null 后恢复 →
//    绿侧重试读到权威清单 → 导出成功载荷含键；红侧把 null 当空 → 弹「没有数据」＝报障原话复发
//  D 组 清单仍读不到 → 文案必须诚实（含「不代表没有数据」），不得说「没有数据」
//  E 组 回填 pending＋读到空 → 保存被挡：出守卫 toast 且 mood-diary 键没被写出去（红侧直接写＝假「已保存」真覆盖）
//  Z1 全程零未捕获 JS 异常
// 用法：node tools/verify-1162-mood-diary-export.mjs
//       MOCHI_SERVE_ROOT=<产物目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = 'http://127.0.0.1:' + port + '/';

const R = { pass: 0, fail: 0, lines: [] };
const ok = (n, c, d) => { c ? R.pass++ : R.fail++; R.lines.push((c ? '  ✅ ' : '  ❌ ') + n + (d ? ' — ' + d : '')); };

// ---------- S 组：产物源锚 ----------
{
  const fd = (() => { try { return readFileSync(join(root, 'js/feature-data.js'), 'utf8'); } catch (e) { return ''; } })();
  const md = (() => { try { return readFileSync(join(root, 'js/mood-diary.js'), 'utf8'); } catch (e) { return ''; } })();
  ok('S1 IDB 清单读不到时退避重试在位', fd.includes('setTimeout(function () { res(window.idbListKeys()); }, 800);'));
  ok('S2 严格清单→incomplete 契约传播在位', fd.includes('out.incomplete = idbKeys === null;'));
  ok('S3 日记保存挡回填未齐在位', md.includes('if (!Object.keys(dd.d).length && window.mochiDataPending && window.mochiDataPending())'));
}

// ---------- 启动 headless ----------
const userDir = join(process.env.TEMP || '/tmp', 'mochi-v1162-' + Date.now());
const args = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + userDir,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=390,844', 'about:blank'];
const cp = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error('DevTools 端口未就绪')), 20000);
  cp.stderr.on('data', (d) => {
    buf += d.toString();
    const m = buf.match(/ws:\/\/[^\s]+/);
    if (m) { clearTimeout(t); resolve(m[0]); }
  });
  cp.on('exit', () => reject(new Error('Chrome 提前退出')));
});
const dbg = wsUrl.replace(/^ws:\/\/([^/]+)\/.*$/, 'http://$1');
const targets = await (await fetch(dbg + '/json/list')).json();
let page = targets.find((t) => t.type === 'page');
if (!page) page = await (await fetch(dbg + '/json/new?about:blank')).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const waits = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waits.has(m.id)) { const w = waits.get(m.id); waits.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params) => new Promise((res, rej) => { const id = ++mid; waits.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params: params || {} })); });
const evalJs = async (expr, awaitPromise) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
  if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');

// 每文档夹具：toast 捕获（window.toast 包装 ＋ mood-diary 等自带 #cc-toast 通道的轮询镜像），异常采集
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
(function(){ try{
  window.__toasts = [];
  function pushToast(msg){ msg=String(msg||'').trim(); if(!msg) return; var a=window.__toasts; if(a[a.length-1]!==msg) a.push(msg); if(a.length>40) a.shift(); }
  function mirror(){ try{
    if (typeof window.toast === 'function' && !window.toast.__cap) {
      var real = window.toast; var f = function(m){ pushToast(m); return real.apply(null, arguments); };
      f.__cap = 1; window.toast = f;
    }
  }catch(e){} }
  setInterval(function(){ mirror(); try{ var el=document.getElementById('cc-toast');
    if (el && el.classList.contains('show')) pushToast(el.textContent); }catch(e){} }, 120);
  if (sessionStorage.getItem('__p1162-errors') === null) sessionStorage.setItem('__p1162-errors','[]');
  var errs = JSON.parse(sessionStorage.getItem('__p1162-errors') || '[]');
  window.addEventListener('error', function(ev){ errs.push(String(ev.message||ev.error) + ' @ ' + String(ev.filename||'').split('/').pop() + ':' + ev.lineno); sessionStorage.setItem('__p1162-errors', JSON.stringify(errs.slice(0,5))); });
  window.addEventListener('unhandledrejection', function(ev){ errs.push('rej:'+String(ev.reason)); sessionStorage.setItem('__p1162-errors', JSON.stringify(errs.slice(0,5))); });
}catch(e){} })();
` });

const nav = async () => { await send('Page.navigate', { url: base }); await sleep(2500); };
const dismiss = () => evalJs("(function(){try{var s=document.getElementById('splash');if(s)s.remove();var q=document.getElementById('qa-mask');if(q)q.remove();}catch(e){}return 1})()");
const ready = async () => { // 等应用壳起来（mochiFeatureData / activeStore 可用）
  for (let i = 0; i < 30; i++) {
    const r = await evalJs("(function(){return !!(window.mochiFeatureData && window.activeStore)})()").catch(() => false);
    if (r) return true;
    await sleep(300);
  }
  return false;
};
// 全场清扫：LS 的 xy-home-v2:* ＋ 日记键的完整复位
// 必须走 activeStore().remove()：裸 localStorage.removeItem 清不掉 xyStore 内存缓存，
// 也清不掉写日志（__wr-journal / IDB __wr-j: 标记）——重启后写日志会把值回放进 LS＝串场假数据。
const wipe = async () => {
  await evalJs(`(function(){
    try{ window.activeStore && window.activeStore().remove('mood-diary'); }catch(e){}
    var kill=[]; try{ for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i); if(k&&k.indexOf('xy-home-v2:')===0) kill.push(k);} }catch(e){}
    try{ for(var j=0;j<kill.length;j++) localStorage.removeItem(kill[j]); }catch(e){}
    try{ localStorage.removeItem('xy-home-v2:__wr-journal'); }catch(e){}
    return kill.length;
  })()`);
  // IDB 侧写日志标记也要清：否则启动回放把日记键又种回 LS
  await evalJs(`(function(){ return (window.idbGetAllKeys?window.idbGetAllKeys():Promise.resolve([])).then(function(a){
      var mk=a.filter(function(k){ return String(k).indexOf('mood-diary')>=0; });
      return Promise.all(mk.map(function(k){ return window.idbDelete(k).catch(function(){}); })).then(function(){ return mk.length });
    }) })()`, true);
  await sleep(350);
};
// 导出驱动：桩 mochiExportFile（只证键清单/载荷/文案，不触发真下载），点开放模确认
const runExport = async (extraStub) => evalJs(`(function(){
  try{
    window.__fd = { calls: [], json: '', toasts: '' };
    if (${extraStub ? 'true' : 'false'}) { ${extraStub || ''} }
    window.mochiExportFile = function (json, fname) { window.__fd.calls.push(1); window.__fd.json = String(json).slice(0, 4000); return Promise.resolve('ok'); };
    window.__fd.toastBase = (window.__toasts||[]).length;
    window.mochiFeatureData.exportFeature('mood');
    return 1;
  }catch(e){ return 'ERR:'+e; }
})()`);
const finishExport = async () => {
  // 等确认模态或 toast 落地（最多 6s），有模态就点确定
  const snap = `(function(){var m=document.getElementById('modal-mask');return {open:!!(m&&!m.hidden), calls:(window.__fd&&window.__fd.calls.length)||0, json:(window.__fd&&window.__fd.json)||'', toasts:(window.__toasts||[]).slice((window.__fd&&window.__fd.toastBase)||0).join(' | ')};})()`;
  for (let i = 0; i < 30; i++) {
    const r = await evalJs(snap).catch(() => null);
    if (!r) { await sleep(200); continue; }
    if (r.calls > 0) return r;
    if (r.open) {
      await evalJs("(function(){var b=document.getElementById('modal-ok')||document.querySelector('#modal-mask button');if(b)b.click();return 1})()");
      await sleep(500);
      const r2 = await evalJs(snap).catch(() => null);
      return r2 || r;
    }
    if (r.toasts) return r; // 没有模态直接给了 toast（空清单/诚实文案路径）
    await sleep(200);
  }
  return await evalJs(snap).catch(() => null);
};

const DIARY_VAL = JSON.stringify({ d: { '2026-09-01': { m: '😊', n: 'test-marker', ts: 1 } } });

// ---------- B 组：LS 有数据 → 导出成功（语义没被改坏） ----------
await nav(); await dismiss();
ok('B0 应用壳就绪', await ready() === true);
await wipe();
await evalJs(`(function(){ try{ window.activeStore().set('mood-diary', ${JSON.stringify(DIARY_VAL)}); }catch(e){ return 'ERR:'+e } return 1 })()`);
await nav(); await dismiss(); await ready();
await evalJs("(function(){window.__toasts=[];return 1})()");
await runExport(false);
let res = await finishExport();
ok('B1 本机 LS 有日记 → 导出成功且载荷含该键', !!(res && res.calls > 0 && /test-marker/.test(res.json || '')), res ? ('calls=' + res.calls + ' toasts=' + String(res.toasts).slice(0, 60)) : '-');

// ---------- C 组：键只在 IDB ＋ 清单先读失败 → 重试后必须把数据导出来（红侧＝「没有数据」复发） ----------
await wipe();
await nav(); await dismiss(); await ready();
// 启动完成后只往 IDB 落一份 LS 没有的日记键（idbSet 不碰 xyStore 内存/LS）——
// 复刻真机「大键只进 IDB / LS 快照不在」的现场；键名必须精确等于注册表 res /^mood-diary$/
await evalJs(`(function(){ return Promise.resolve(window.idbSet('xy-home-v2:default:mood-diary', ${JSON.stringify(DIARY_VAL)})).then(function(){ return 'set' }, function(e){ return 'ERR:' + e }) })()`, true);
await evalJs("(function(){try{localStorage.removeItem('xy-home-v2:default:mood-diary')}catch(e){}return 1})()");
await evalJs("(function(){window.__toasts=[];return 1})()");
// 桩 idbListKeys：第一次返回 null（＝这次没读到），800ms 重试时交还真身 → 只有「重试」修法能拿到清单
await runExport(`var real=window.idbListKeys; var n=0;
  window.idbListKeys=function(){ n++; if(n===1) return Promise.resolve(null); window.idbListKeys=real; return real.apply(null, arguments); };`);
res = await finishExport();
{
  const okC = !!(res && res.calls > 0 && /mood-diary/.test(res.json || '') && /test-marker/.test(res.json || ''));
  ok('C1 IDB 清单首读失败 → 退避重试后照常导出（红侧＝把 null 当空弹「没有数据」）', okC, res ? ('calls=' + res.calls + ' toasts=' + String(res.toasts).slice(0, 80)) : '-');
  ok('C2 全程不得出现「在本桌面还没有数据」', !(res && /还没有数据/.test(String(res.toasts))), res ? String(res.toasts).slice(0, 90) : '-');
}
// ---------- D 组：清单始终读不到 → 文案必须诚实 ----------
await wipe();
await nav(); await dismiss(); await ready();
await evalJs("(function(){window.__toasts=[];return 1})()");
await runExport(`window.idbListKeys=function(){ return Promise.resolve(null); };`);
res = await finishExport();
{
  const dbgKeys = await evalJs(`(function(){var a=[];try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf('mood')>=0)a.push(k+'='+String(localStorage.getItem(k)).slice(0,20))}}catch(e){}return a.join(' , ')||'(LS 无 mood 键)'})()`);
  ok('D1 读不到清单时报「不代表没有数据·稍等再导出」，不报「没有数据」', !!(res && /不代表没有数据/.test(String(res.toasts)) && !/在本桌面还没有数据/.test(String(res.toasts))), res ? ('toasts=' + String(res.toasts).slice(0, 120) + ' calls=' + res.calls + ' [' + dbgKeys + ']') : '-');
}
// ---------- E 组：回填 pending＋读到空 → 保存必须被挡（防整包覆盖） ----------
await wipe();
await nav(); await dismiss(); await ready();
// 前置：确保这台桌面上 mood-diary 确实读不到（走 activeStore().remove 全链路复位）
await evalJs(`(function(){ try{ window.activeStore().remove('mood-diary'); return 1 }catch(e){ return 'ERR:'+e } })()`);
await sleep(400);
const e0 = await evalJs(`(function(){ try{ return String(window.activeStore().get('mood-diary')) }catch(e){ return 'ERR:'+e } })()`);
ok('E0 夹具前置：日记读到空包（守卫的前提条件成立）', e0 === 'null' || e0 === 'undefined' || !e0, '当前值 ' + String(e0).slice(0, 40));
// 写监视：任何 mood-diary 落盘（xyStore 的 LS 镜像 ＋ idbSet 异步镜像）都记账
await evalJs(`(function(){
  window.__wr = 0;
  try{
    var real = window.xyStore;
    window.xyStore = function(){ var st = real.apply(null, arguments); var s = st.set;
      st.set = function(k, v){ if (String(k).indexOf('mood-diary') === 0) window.__wr++; return s.apply(st, arguments); };
      return st;
    };
  }catch(e){}
  try{ var ri = window.idbSet; window.idbSet = function(k, v){ if (String(k).indexOf('mood-diary') >= 0) window.__wr++; return ri.apply(null, arguments); }; }catch(e){}
  window.__mochiDataReady = false;
  window.mochiDataPending = function(){ return true; };
  window.__toasts = [];
  return 1;
})()`);
await evalJs("(function(){ if (window.openMoodDiary) { window.openMoodDiary(); return 1 } var p=document.getElementById('page-mood'); if(p)p.hidden=false; return 2 })()");
await sleep(300);
await evalJs("(function(){var g=document.getElementById('mood-emoji-grid'); if(g&&g.firstElementChild) g.firstElementChild.click(); var b=document.getElementById('mood-save'); if(b)b.click(); return 1})()");
await sleep(900);
{
  const st = await evalJs(`(function(){
    var toasts=(window.__toasts||[]).join(' | ');
    var lsV=null; try{ lsV=localStorage.getItem('xy-home-v2:default:mood-diary'); }catch(e){}
    return { toasts: toasts, ls: !!lsV, wr: window.__wr };
  })()`).catch(() => null);
  ok('E1 pending＋空包时保存被挡（守卫 toast 在位）', !!(st && /数据还在从本机数据库读取/.test(String(st.toasts))), st ? String(st.toasts).slice(0, 90) : '-');
  ok('E2 mood-diary 键没有被写出去（整包覆盖通道关死；红侧＝直接写盘）', !!(st && st.ls === false && st.wr === 0), st ? ('ls=' + st.ls + ' 写账=' + st.wr) : '-');
}
// ---------- Z ----------
const errs = await evalJs("JSON.parse(sessionStorage.getItem('__p1162-errors')||'[]')").catch(() => []);
ok('Z1 全程零未捕获 JS 异常', (errs || []).length === 0, JSON.stringify(errs));

console.log('===== #1162 心情日记导出误报「没有数据」＋防回填期覆盖 =====');
console.log('root = ' + root);
R.lines.forEach((l) => console.log(l));
console.log('结果：通过 ' + R.pass + ' / 失败 ' + R.fail);
try { ws.close(); } catch (e) {}
try { cp.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(R.fail ? 1 : 0);
