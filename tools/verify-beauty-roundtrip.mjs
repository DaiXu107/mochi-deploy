// ===== 专项验证 #527：桌面/聊天美化「全键往返 + 导入安全网」行为断言（无头 Chrome） =====
// 背景（用户问「会不会丢已保存的美化 / 会不会导不进去」时的实测发现）：
//   ① BEAUTY_KEYS 是方案/导出/分享/撤销的【唯一】数据源，却漏了 5 个已被「恢复全部默认」
//      删除的键（phone-bg-pos-x/-y/-size、phone-bg-solid、app-name-color）——存了方案再应用，
//      壁纸定位缩放回默认，且撤销快照里没有它们，点完「恢复全部默认」救不回来；
//   ② 方案 JSON 无用途标记，把聊天美化 JSON 粘进桌面导入框 = 解析通过、命中 0 项、
//      却提示「已导入」；
//   ③ 导入/应用/撤销收尾固定 800ms 后强制刷新，不等 IndexedDB 落盘，大键（4.5MB 壁纸）
//      有刷新后丢失的窗口。
// 本脚本断言「导出 → 清空 → 导入」逐键相等，以及用途校验/零命中/备份上限的行为。
// 断言全部走真实点击链路（页面由 src 组装，不依赖构建产物）。
// 用法：node tools/verify-beauty-roundtrip.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function read(p) { return readFileSync(join(root, p), 'utf8'); }
const buildSrc = read('build.mjs');
function arrOf(name) {
  const m = buildSrc.match(new RegExp('const ' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\]'));
  return m ? m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];
}
const cssFiles = arrOf('cssFiles'), jsFiles = arrOf('jsFiles');
let css = '', js = '';
for (const f of cssFiles) { try { css += read('src/css/' + f) + '\n'; } catch (e) {} }
for (const f of jsFiles) { try { js += '/* ' + f + ' */\n' + read('src/js/' + f) + '\n'; } catch (e) {} }
const tpl = read('src/template.html');
const page = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>' + css + '</style></head><body>' + tpl +
  '<scr' + 'ipt>window.__APP_VERSION__="test";</scr' + 'ipt>' +
  '<scr' + 'ipt>' + js + '</scr' + 'ipt></body></html>';

const server = createServer((req, res) => {
  try {
    const p = req.url.split('?')[0];
    if (p === '/blank.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body>blank</body></html>'); return; }
    if (p === '/test.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page); return; }
    res.writeHead(404); res.end('nf');
  } catch (e) { res.writeHead(500); res.end(); }
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

const tmpDir = join(os.tmpdir(), 'mochi-beauty-rt-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (10200 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + tmpDir, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const pg = list.find((t) => t.type === 'page');
      if (pg) {
        ws = new WebSocket(pg.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
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
  if (r && r.exceptionDetails) return { __exc: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text) };
  return r && r.result ? r.result.value : null;
}

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (ok ? '' : '  [' + String(detail).slice(0, 500) + ']')); }

// 每次文档创建都注入剪贴板打桩（导入自动刷新后仍生效）
await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
window.__diag = { clip: null };
try {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: function (t) { window.__diag.clip = t; return Promise.resolve(); } }, configurable: true });
} catch (e) {}
` });

async function loadApp() {
  await cdp('Page.navigate', { url: baseUrl + '/blank.html' });
  await sleep(400);
  await cdp('Page.navigate', { url: baseUrl + '/test.html' });
  await sleep(2200);
  await waitReady();
}
const showThemeScheme = `(function(){
  document.querySelectorAll('.page').forEach(function(p){p.hidden = p.id !== 'page-theme';});
  var sec=document.querySelector('.them-sec[data-sec=scheme]'); if(sec) sec.hidden=false;
  return true;
})()`;
const modalInfo = `(function(){
  var pills=[].map.call(document.querySelectorAll('#modal-pills .pill'),function(p){return p.textContent;});
  var st=document.getElementById('modal-static');
  return JSON.stringify({ hidden: document.getElementById('modal-mask').hidden, title: document.getElementById('modal-title').textContent,
    pills: pills, stat: st && !st.hidden ? st.textContent.slice(0,80) : '' });
})()`;
// 导出到剪贴板（复制文字通道），返回解析后的对象
async function exportViaClipboard() {
  await evalJs('(function(){window.__diag.clip=null;return true;})()');
  await evalJs(showThemeScheme);
  await evalJs("(function(){var r=document.getElementById('row-beauty-export'); r.click(); return 'ok';})()");
  await sleep(350);
  await evalJs("(function(){var ps=document.querySelectorAll('#modal-pills .pill'); for (var i=0;i<ps.length;i++){ if(ps[i].textContent==='复制文字') ps[i].click(); } return true;})()");
  await sleep(150);
  await evalJs("(function(){document.getElementById('modal-ok').click(); return true;})()");
  await sleep(450);
  const raw = await evalJs('(function(){return window.__diag.clip?String(window.__diag.clip):null;})()');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return { __parseFail: String(e && e.message) }; }
}
async function dismissSplash() {
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(250);
  await evalJs("(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return true;})()");
  await sleep(400);
}
async function waitReady() {
  await dismissSplash();
  await settle();
}
// 等「新文档完全就绪」：判据必须比 __mochiDataReady 严——旧文档里它早已是 true，
// 且导航过程中 eval 可能命中正在拆掉的旧文档或空白新文档（读到 null）。
// 现在要求：readyState==='complete' + 连续两次成功读到同一个 key，才算稳定。
async function settle() {
  let hits = 0;
  for (let i = 0; i < 60; i++) {
    const raw = await evalJs("(function(){try{return JSON.stringify({rs:document.readyState, has:!!window.xyStore, tok:window.__tok===undefined});}catch(e){return JSON.stringify({rs:'err'});}})()");
    let o = null; try { o = JSON.parse(String(raw)); } catch (e) {}
    if (o && o.rs === 'complete' && o.has) hits++; else hits = 0;
    if (hits >= 2) break;
    await sleep(250);
  }
  await sleep(200);
}
// 导入成功路径会在写入后重载页面（这是本修复的行为：先等大键落盘再刷新）。
// 测试必须感知这次重载并等新文档稳定——见 settle() 注释（旧文档 __mochiDataReady 恒 true，
// 直接轮询它会提前放行，后续写入被新文档加载覆盖）。
async function importJson(obj) {
  await evalJs(showThemeScheme);
  await evalJs("(function(){window.__tok=String(Math.random());return true;})()");
  const tok = await evalJs('window.__tok');
  await evalJs("document.getElementById('row-beauty-import').click()");
  await sleep(300);
  const payload = JSON.stringify(obj);
  // #1488 尺子重基线：同 verify-beauty-io——#755 后真链是 window.mochiFilePick，截 opts 喂 onFiles。
  await evalJs(`(function(){
    window.__origPick=window.mochiFilePick;
    window.__pickOpts=null;
    window.mochiFilePick=function(o){ window.__pickOpts=o; return 'surf'; };
    var b=document.getElementById('modal-file');
    if(b)b.click();
    return !!b;
  })()`);
  await sleep(200);
  await evalJs(`(function(){
    var o=window.__pickOpts;
    if(!o||!o.onFiles) return 'no-opts';
    o.onFiles([new File([${JSON.stringify(payload)}],'beauty.json',{type:'application/json'})]);
    window.mochiFilePick=window.__origPick;
    return true;
  })()`);
  // 判定本次是「重载路径」还是「提前返回路径（用途不符/零命中，不重载）」
  let reloaded = false;
  for (let i = 0; i < 25; i++) {
    await sleep(200);
    const t = await evalJs('window.__tok');
    if (t !== tok) { reloaded = true; break; } // 新文档：__tok 不存在
    if (i >= 2) {
      const mh = await evalJs("(function(){var m=document.getElementById('modal-mask');return m?(m.hidden?'closed':'open'):'gone';})()");
      if (mh === 'closed') break; // 提前返回路径：弹窗已关且无导航
    }
  }
  if (reloaded) { await dismissSplash(); await settle(); }
  else await settle();
}
// 读当前空间下某键的值（走 xyStore：内存缓存优先，与业务读取一致；回退旧顶层键）
const readKey = (k) => evalJs(`(function(){
  try { var v = window.xyStore(window.activePrefix()).get(${JSON.stringify(k)}); if (v !== null && v !== undefined) return v; } catch (e) {}
  var v2=localStorage.getItem('xy-home-v2:default:${k}');
  if (v2===null) v2=localStorage.getItem('xy-home-v2:${k}');
  return v2;
})()`);
// 全局方案/撤销键读写（走 xyStore('xy-home-v2')，与业务同一路径——内存缓存优先，
// 直接写 localStorage 会被内存缓存遮蔽，是本脚本踩过的坑）
const gGet = (k) => evalJs(`(function(){ try { return window.xyStore('xy-home-v2').get(${JSON.stringify(k)}); } catch(e){ return null; } })()`);
const gSet = (k, v) => evalJs(`(function(){ try { window.xyStore('xy-home-v2').set(${JSON.stringify(k)}, ${JSON.stringify(v)}); return true; } catch(e){ return false; } })()`);

await loadApp();

// ============ A. 导出必须包含全部美化键（含此前漏掉的 5 个） ============
// 5 个历史漏键 + 若干代表键，逐个种入再导出，断言全部出现在导出 JSON 里
const SEED = {
  'phone-bg-pos-x': '37',
  'phone-bg-pos-y': '62',
  'phone-bg-size': '150',
  'phone-bg-solid': '#123456',
  'app-name-color': '#abcdef',
  'widget-bg-color': '#f5f0eb',
  'widget-btn-color': '#ff8800',
  'widget-heart-color': '#e05555',
  'desk-card-radius': '18',
  'ico-radius': '12',
  'desk-font-size': '108',
  'desk-card-scale': '95',
  'bg-blur': '6',
  'bg-mask-op': '25',
  'phone-bg-preset': '海洋'
};
await evalJs(`(function(){
  var seed=${JSON.stringify(SEED)};
  Object.keys(seed).forEach(function(k){ localStorage.setItem('xy-home-v2:default:'+k, seed[k]); });
  return true;
})()`);
await sleep(200);
const exp = await exportViaClipboard();
check('A1 导出成功且为对象（复制文字通道拿到 JSON）', exp && typeof exp === 'object' && !exp.__parseFail, JSON.stringify(exp).slice(0, 200));
check('A2 导出带用途标记 __kind__ = mochi-desk-beauty', !!exp && exp['__kind__'] === 'mochi-desk-beauty', exp && exp['__kind__']);
const missing = [];
for (const k of Object.keys(SEED)) if (!exp || exp[k] === undefined) missing.push(k);
check('A3 全部种入键都出现在导出里（0 漏键）', missing.length === 0, 'missing=' + missing.join(','));
check('A4 历史漏键 phone-bg-pos-x/-y/-size 已在导出内', !!exp && exp['phone-bg-pos-x'] === '37' && exp['phone-bg-pos-y'] === '62' && exp['phone-bg-size'] === '150', exp && JSON.stringify({ x: exp['phone-bg-pos-x'], y: exp['phone-bg-pos-y'], s: exp['phone-bg-size'] }));
check('A5 历史漏键 phone-bg-solid / app-name-color 已在导出内', !!exp && exp['phone-bg-solid'] === '#123456' && exp['app-name-color'] === '#abcdef', exp && JSON.stringify({ solid: exp['phone-bg-solid'], an: exp['app-name-color'] }));

// ============ B. 往返：清空 → 导入 → 逐键相等 ============
await evalJs(`(function(){
  var ks=${JSON.stringify(Object.keys(SEED))};
  ks.forEach(function(k){ try{ localStorage.removeItem('xy-home-v2:default:'+k); }catch(e){} try{ localStorage.removeItem('xy-home-v2:'+k); }catch(e){} });
  return true;
})()`);
await sleep(200);
const cleared = await readKey('phone-bg-pos-x');
check('B1 清空生效（前置条件，phone-bg-pos-x 已不存在）', cleared === null, cleared);
const payload = Object.assign({}, exp);
await importJson(payload);
const diffs = [];
for (const k of Object.keys(SEED)) {
  const got = await readKey(k);
  if (String(got) !== String(SEED[k])) diffs.push(k + ': want=' + SEED[k] + ' got=' + got);
}
check('B2 导入后逐键相等（含 5 个历史漏键，全键无丢失）', diffs.length === 0, diffs.join(' | '));

// ============ C. 用途标记：聊天美化 JSON 不得被桌面导入接受 ============
const beforeTheme = await readKey('theme-mode');
await importJson({ '__kind__': 'mochi-chat-beauty', 'cs-out-bg': '#112233', 'cs-in-bg': '#445566' });
const cWarn = await evalJs(`(function(){ var h=document.getElementById('cc-toast')||document.querySelector('.cc-toast'); return h?h.textContent:''; })()`);
const afterCsApplied = await evalJs(`(function(){
  for (var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(/cs-out-bg$/.test(k)) return localStorage.getItem(k); }
  return null;
})()`);
check('C1 聊天美化 JSON 导入桌面 → 不写入任何聊天键（命中 0 项）', afterCsApplied === null, afterCsApplied);
check('C2 用途不符时给出明确提示（提示文本可在页面/DOM 观察到）', /不是桌面美化方案|没有识别到桌面美化项/.test(String(cWarn)), 'toast=' + String(cWarn).slice(0, 120));

// ============ D. 零命中数据：不生成垃圾备份 ============
const beforeSchemes = await evalJs(`(function(){ try{ return (JSON.parse(window.xyStore('xy-home-v2').get('beauty-schemes')||'[]')).length; }catch(e){ return -1; } })()`);
await importJson({ 'not-a-beauty-key': 'x', 'another': 'y' });
const afterSchemes = await evalJs(`(function(){ try{ return (JSON.parse(window.xyStore('xy-home-v2').get('beauty-schemes')||'[]')).length; }catch(e){ return -1; } })()`);
check('D1 零命中导入不追加「导入前备份」方案（不产生垃圾备份）', beforeSchemes === afterSchemes, 'before=' + beforeSchemes + ' after=' + afterSchemes);
check('D2 原始美化未被改动（theme-mode 保持）', (await readKey('theme-mode')) === beforeTheme, 'before=' + beforeTheme + ' after=' + (await readKey('theme-mode')));

// ============ E. 有效导入会生成「导入前备份」（安全网在位） ============
await gSet('beauty-schemes', '[]');
await importJson({ 'widget-bg-color': '#abcdef', '__kind__': 'mochi-desk-beauty' });
const e1 = await gGet('beauty-schemes');
check('E1 有效导入 → 自动生成「导入前备份」方案', /导入前备份/.test(String(e1)), String(e1).slice(0, 200));
check('E2 导入值已生效（widget-bg-color=#abcdef）', (await readKey('widget-bg-color')) === '#abcdef', await readKey('widget-bg-color'));

// ============ F. 导入前备份数量上限（不无限膨胀） ============
// 预置 8 份自动备份 + 1 份用户自命名，再导入一次 → 自动备份总数应 ≤5、用户方案保留
const preseed = [];
for (let i = 0; i < 8; i++) preseed.push({ name: '导入前备份 01-0' + i + ' 10:0' + i, time: 1000 + i, data: { 'widget-bg-color': '#00000' + i } });
preseed.push({ name: '我自己的方案', time: 999, data: { 'widget-bg-color': '#111111' } });
await gSet('beauty-schemes', JSON.stringify(preseed));
const preseedBack = await gGet('beauty-schemes');
check('F0 预置生效（读回 9 条，证明走的是业务同一路径）', (() => { try { return JSON.parse(preseedBack).length === 9; } catch (e) { return false; } })(), String(preseedBack).slice(0, 120));
await importJson({ 'widget-btn-color': '#00ff00', '__kind__': 'mochi-desk-beauty' });
const f1 = await evalJs(`(function(){
  var arr=[]; try{ arr=JSON.parse(window.xyStore('xy-home-v2').get('beauty-schemes')||'[]'); }catch(e){}
  var autos=arr.filter(function(s){ return String(s.name||'').indexOf('导入前备份')===0; }).length;
  var mine=arr.filter(function(s){ return s.name==='我自己的方案'; }).length;
  return JSON.stringify({ autos: autos, mine: mine, total: arr.length });
})()`);
const f1o = JSON.parse(String(f1));
check('F1 自动备份数量被限制在 5 份内（不无限膨胀）', f1o.autos <= 5, f1);
check('F2 用户自己命名的方案一份不动', f1o.mine === 1, f1);

// ============ G. 撤销栈按桌面隔离（跨桌面不串美化） ============
await gSet('beauty-undo-stack', '[]');
await gSet('beauty-schemes', '[]');
const g1 = await evalJs(`(function(){
  // 造第二个联系人命名空间的撤销栈，确认它与本桌面各存一份互不影响
  window.xyStore('xy-home-v2:someone').set('beauty-undo-stack', JSON.stringify([{time:1,data:{'widget-bg-color':'#from-someone'}}]));
  return JSON.stringify({ someone: !!window.xyStore('xy-home-v2:someone').get('beauty-undo-stack') });
})()`);
check('G1 他桌面撤销栈独立存在（前置条件）', /"someone":true/.test(String(g1)), g1);
// 真实触发一次压栈（有效导入会 pushBeautyUndo），断言落在当前命名空间而非全局根键
await importJson({ 'ico-shape': 'circle', '__kind__': 'mochi-desk-beauty' });
const g2 = await evalJs(`(function(){
  var mine = null, root = null;
  try { mine = window.xyStore('xy-home-v2:default').get('beauty-undo-stack'); } catch(e){}
  try { root = window.xyStore('xy-home-v2').get('beauty-undo-stack'); } catch(e){}
  var n=0; try{ n = JSON.parse(mine||'[]').length; }catch(e){}
  var rn=0; try{ rn = JSON.parse(root||'[]').length; }catch(e){}
  return JSON.stringify({ mineLen: n, rootLen: rn });
})()`);
check('G2 压栈写入当前桌面命名空间（default:beauty-undo-stack 非空）', /"mineLen":[1-9]/.test(String(g2)), g2);
check('G3 不再写入全局根键（跨桌面不再串美化）', /"rootLen":0/.test(String(g2)), g2);

chrome.kill();
try { rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
server.close();
const fails = results.filter((o) => !o.ok).length;
console.log(fails ? ('FAIL ' + fails + '/' + results.length) : ('ALL PASS ' + results.length + '/' + results.length));
process.exit(fails ? 1 : 0);
