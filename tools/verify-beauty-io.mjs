// ===== 专项验证 #173：桌面美化 + 聊天美化 方案导出/导入 全链路（无头 Chrome 行为断言） =====
// 背景（用户报障：桌面美化和聊天美化的美化方案无法导出也无法导入）：
//   f4158f6 把导出收敛为裸 a[download]、导入收敛为仅文件选择后，iPhone 主屏安装
//  （standalone 无下载管理器/文件选择器常不弹）与部分壳浏览器四条路全断。
// 修复：①导出统一走 window.mochiExportFile 三级降级（分享面板→保存框→确认后下载）；
//   ②桌面导出补回「复制文字」（>3MB 拒绝）；③桌面导入补回「粘贴文本」（与文件并存）。
// 断言全部走真实点击链路（页面由 src 组装，不依赖构建产物）。
// 用法：node tools/verify-beauty-io.mjs
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

const tmpDir = join(os.tmpdir(), 'mochi-beauty-io-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 300));
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
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (ok ? '' : '  [' + String(detail).slice(0, 400) + ']')); }
const clearDiag = () => evalJs('(function(){window.__diag.anchors=[];window.__diag.blobs=[];window.__diag.clip=null;return true;})()');

// 每次文档创建都注入：a.click()/blob/剪贴板打桩（导入自动刷新后仍生效）
await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
window.__diag = { anchors: [], blobs: [], clip: null };
try {
  var _ac = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    try { window.__diag.anchors.push({ dl: this.getAttribute('download'), href: String(this.getAttribute('href') || '').slice(0, 30) }); } catch (e) {}
    return _ac.apply(this, arguments);
  };
  var _cou = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (b) { var u = _cou(b); try { window.__diag.blobs.push({ size: b.size, type: b.type }); } catch (e) {} return u; };
  try {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: function (t) { window.__diag.clip = t; return Promise.resolve(); } }, configurable: true });
  } catch (e) {}
} catch (e) {}
` });

async function loadApp() {
  await cdp('Page.navigate', { url: baseUrl + '/blank.html' });
  await sleep(400);
  await cdp('Page.navigate', { url: baseUrl + '/test.html' });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady') === true) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(300);
  await evalJs("(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return true;})()");
  await sleep(500);
}
const showThemeScheme = `(function(){
  document.querySelectorAll('.page').forEach(function(p){p.hidden = p.id !== 'page-theme';});
  var sec=document.querySelector('.them-sec[data-sec=scheme]'); if(sec) sec.hidden=false;
  return true;
})()`;
const modalInfo = `(function(){
  var pills=[].map.call(document.querySelectorAll('#modal-pills .pill'),function(p){return p.textContent;});
  var ta=document.getElementById('modal-textarea'), fb=document.getElementById('modal-file'), st=document.getElementById('modal-static');
  return JSON.stringify({ hidden: document.getElementById('modal-mask').hidden, title: document.getElementById('modal-title').textContent,
    pills: pills, taHidden: ta?ta.hidden:null, fileHidden: fb?fb.hidden:null, stat: st && !st.hidden ? st.textContent.slice(0,60) : '' });
})()`;

await loadApp();

// ============ A. 统一导出链在位 ============
check('A1 window.mochiExportFile 已定义（data-backup 暴露）', await evalJs('typeof window.mochiExportFile') === 'function');

// ============ B. 桌面导出：方式选择弹窗（无已保存方案也弹，不再裸下载） ============
await evalJs(showThemeScheme);
await clearDiag();
await evalJs("(function(){var r=document.getElementById('row-beauty-export'); r.click(); return 'ok';})()");
await sleep(400);
const b1 = await evalJs(modalInfo);
check('B1 无方案点导出 → 弹方式选择（不再直接裸下载）', /导出文件/.test(b1) && /复制文字/.test(b1) && /"hidden":false/.test(b1), b1);
check('B2 未选择前不触发下载', !(await evalJs('window.__diag.anchors.length > 0')));

// ============ C. 复制文字通道 ============
await evalJs("(function(){var ps=document.querySelectorAll('#modal-pills .pill'); for (var i=0;i<ps.length;i++){ if(ps[i].textContent==='复制文字') ps[i].click(); } return true;})()");
await sleep(150);
await evalJs("(function(){document.getElementById('modal-ok').click(); return true;})()");
await sleep(400);
const c1 = await evalJs('(function(){var t=window.__diag.clip; return t?String(t).slice(0,40):null;})()');
check('C3 复制文字 → 剪贴板拿到方案 JSON', typeof c1 === 'string' && c1.indexOf('{') === 0, c1);

// ============ D. 导出文件通道（无分享/保存框环境 → 确认后下载） ============
await clearDiag();
await evalJs("(function(){var r=document.getElementById('row-beauty-export'); r.click(); return 'ok';})()");
await sleep(300);
await evalJs("(function(){var ps=document.querySelectorAll('#modal-pills .pill'); if(ps[0]) ps[0].click(); return true;})()");
await sleep(150);
await evalJs("(function(){document.getElementById('modal-ok').click(); return true;})()");
await sleep(500);
const d1 = await evalJs(`(function(){
  var m=document.getElementById('modal-mask');
  return JSON.stringify({ title: document.getElementById('modal-title').textContent, hidden: m.hidden });
})()`);
check('D1 无分享/保存框环境 → 打包完成确认弹窗（不静默下载）', /文件已打包/.test(String(d1)), d1);
await evalJs("(function(){document.getElementById('modal-ok').click(); return true;})()");
await sleep(400);
const d2 = await evalJs('JSON.stringify(window.__diag.anchors)');
check('D2 点确定后触发下载（文件名含 mochi美化方案）', /mochi美化方案/.test(String(d2)), d2);

// ============ E. 有已保存方案：来源选择 → 方式选择（嵌套弹窗不被关） ============
await evalJs(`(function(){
  var seed=[{name:'验证方案A',time:Date.now(),data:{'desk-font-size':'18'}}];
  localStorage.setItem('xy-home-v2:beauty-schemes', JSON.stringify(seed));
  return true;
})()`);
await clearDiag();
await evalJs("(function(){var r=document.getElementById('row-beauty-export'); r.click(); return 'ok';})()");
await sleep(300);
const e1 = await evalJs(modalInfo);
check('E1 有方案先弹来源选择（含方案名）', /验证方案A/.test(String(e1)), e1);
await evalJs("(function(){var ps=document.querySelectorAll('#modal-pills .pill'); if(ps[1]) ps[1].click(); return true;})()");
await sleep(150);
await evalJs("(function(){document.getElementById('modal-ok').click(); return true;})()");
await sleep(400);
const e2 = await evalJs(modalInfo);
check('E2 选完来源进方式选择弹窗（嵌套弹窗未被外层关闭）', /"hidden":false/.test(String(e2)) && /导出文件/.test(String(e2)), e2);

// ============ F. 桌面导入：粘贴文本 + 从文件导入双通道 ============
await evalJs("(function(){var r=document.getElementById('row-beauty-import'); r.click(); return 'ok';})()");
await sleep(300);
const f1 = await evalJs(modalInfo);
check('F1 导入弹窗 = 粘贴文本框 + 从文件导入按钮并存', /"taHidden":false/.test(String(f1)) && /"fileHidden":false/.test(String(f1)), f1);
await evalJs(`(function(){
  var ta=document.getElementById('modal-textarea');
  ta.value=JSON.stringify({'__theme__':'dark'});
  document.getElementById('modal-ok').click();
  return true;
})()`);
await sleep(400);
const f2 = await evalJs(`(function(){
  var sch=[]; try{ sch=JSON.parse(localStorage.getItem('xy-home-v2:beauty-schemes')||'[]'); }catch(e){}
  return JSON.stringify({ theme: localStorage.getItem('xy-home-v2:theme-mode'),
    backup: sch.some(function(p){ return String(p.name||'').indexOf('导入前备份')===0; }) });
})()`);
check('F2 粘贴导入已应用（theme-mode=dark）+ 自动备份原美化', /"theme":"dark"/.test(String(f2)) && /"backup":true/.test(String(f2)), f2);
await evalJs("(function(){document.getElementById('row-beauty-import').click(); return true;})()");
await sleep(300);
// #1488 尺子重基线：F3 腿同 H 腿——#755 后真链是 window.mochiFilePick（txtImportAuto 选完即应用）。
await evalJs(`(function(){
  window.__origPick2=window.mochiFilePick;
  window.__pickOpts2=null;
  window.mochiFilePick=function(o){ window.__pickOpts2=o; return 'surf'; };
  var b=document.getElementById('modal-file');
  if(b)b.click();
  return !!b;
})()`);
await sleep(200);
await evalJs(`(function(){
  var o=window.__pickOpts2;
  if(!o||!o.onFiles) return 'no-opts';
  o.onFiles([new File([JSON.stringify({'__theme__':'light'})],'beauty.json',{type:'application/json'})]);
  window.mochiFilePick=window.__origPick2;
  return true;
})()`);
await sleep(400);
const f3 = await evalJs('JSON.stringify({theme: localStorage.getItem("xy-home-v2:theme-mode"), modalClosed: document.getElementById("modal-mask").hidden})');
check('F3 从文件导入选完即自动应用（theme-mode=light）', /"theme":"light"/.test(String(f3)), f3);

// ============ G. 聊天美化导出/导入 ============
await clearDiag();
const g1 = await evalJs(`(function(){
  if (!window.openChatBeautySchemes) return 'no-api';
  window.openChatBeautySchemes();
  var m=document.getElementById('chat-beauty-scheme-manager');
  var btns=[].slice.call(m.querySelectorAll('button')).filter(function(b){return b.textContent==='导出方案';});
  if(!btns.length) return 'no-btn';
  btns[0].click();
  return 'ok';
})()`);
await sleep(400);
const g2 = await evalJs(modalInfo);
check('G1 聊天导出弹方式选择（导出文件/复制文字）', /导出文件/.test(String(g2)) && /复制文字/.test(String(g2)), g2 + ' step=' + g1);
await evalJs("(function(){var ps=document.querySelectorAll('#modal-pills .pill'); for (var i=0;i<ps.length;i++){ if(ps[i].textContent==='复制文字') ps[i].click(); } return true;})()");
await sleep(150);
await evalJs("(function(){document.getElementById('modal-ok').click(); return true;})()");
await sleep(400);
const g3 = await evalJs('(function(){var t=window.__diag.clip; return t?String(t).slice(0,40):null;})()');
check('G2 聊天复制文字 → 剪贴板拿到方案 JSON', typeof g3 === 'string' && g3.indexOf('{') === 0, g3);
await evalJs("(function(){var m=document.getElementById('chat-beauty-scheme-manager'); var btns=[].slice.call(m.querySelectorAll('button')).filter(function(b){return b.textContent==='导出方案';}); if(btns.length) btns[0].click(); return true;})()");
await sleep(300);
await evalJs("(function(){var ps=document.querySelectorAll('#modal-pills .pill'); if(ps[0]) ps[0].click(); return true;})()");
await sleep(150);
await evalJs("(function(){document.getElementById('modal-ok').click(); return true;})()");
await sleep(500);
const g4 = await evalJs(`(function(){
  var t=document.getElementById('modal-title').textContent;
  if (/文件已打包/.test(t)) document.getElementById('modal-ok').click();
  return t;
})()`);
await sleep(400);
const g5 = await evalJs('JSON.stringify(window.__diag.anchors)');
check('G3 聊天导出文件 → 确认后触发下载（mochi聊天美化方案）', /mochi聊天美化方案/.test(String(g5)), g5 + ' title=' + g4);
// 聊天导入：文件 → textarea → 确定 → 应用
const h1 = await evalJs(`(function(){
  var m=document.getElementById('chat-beauty-scheme-manager');
  var btns=[].slice.call(m.querySelectorAll('button')).filter(function(b){return b.textContent==='导入方案';});
  if(btns.length) btns[0].click();
  return true;
})()`);
await sleep(300);
// #1488 尺子重基线：#755 起「从文件导入」走 window.mochiFilePick 统一真可点层，
// 旧 #modal-file-input 已不在激活链上（戳它恒空＝H1/H2 假红）。截 mochiFilePick 拿真
// opts、用真 onFiles 喂 File——测的就是产品现在的接线。
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
  o.onFiles([new File([JSON.stringify({'cs-out-bg':'#112233'})],'chat.json',{type:'application/json'})]);
  window.mochiFilePick=window.__origPick;
  return true;
})()`);
await sleep(300);
const h2 = await evalJs(`(function(){
  var ta=document.getElementById('modal-textarea');
  return ta ? ta.value.length : -1;
})()`);
check('H1 聊天导入选完文件文本进 textarea', typeof h2 === 'number' && h2 > 5, h2);
await evalJs("(function(){document.getElementById('modal-ok').click(); return true;})()");
await sleep(400);
const h3 = await evalJs(`(function(){
  var hit=null;
  for (var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(/cs-out-bg$/.test(k)) hit=localStorage.getItem(k); }
  return hit;
})()`);
check('H2 聊天方案导入已应用（cs-out-bg=#112233）', h3 === '#112233', h3);

chrome.kill();
try { rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
server.close();
const fails = results.filter((o) => !o.ok).length;
console.log(fails ? ('FAIL ' + fails + '/' + results.length) : ('ALL PASS ' + results.length + '/' + results.length));
process.exit(fails ? 1 : 0);
