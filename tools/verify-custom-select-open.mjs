// ===== 回归：全站自定义下拉（.mochi-custom-select）点了不展开 =====
// 用法：node tools/verify-custom-select-open.mjs
//       SRCDIR=<src 快照目录> node tools/verify-custom-select-open.mjs   # 红绿对照
//
// 背景（2026-09-16 用户报障 vivo X200s + Edge，且明说其他设备型号也有）：
//   「音乐功能中选择导入哪个歌单的按键都点了展开不了不能选择，很多按钮失效了」。
// 根因（v3.28.x 全站原生 select 替换引入，设备无关，纯逻辑）：
//   ta-ask.js attachCustom.openList() 打开时写 `list.style.display = ''`（只清内联样式），
//   而 chat-pages.css `.mochi-custom-select-list{display:none}` 是默认收起态——
//   清空内联后回落样式表仍是 none，浮层（portal 到 body）永远打不开；原生 select 又已被
//   `select.mochi-custom-select-native{display:none}` 隐藏 → 全站所有下拉都「点了没反应」。
// 修复：openList() 显式写 `display:'block'`（收起仍由 closeAll 写 'none'）。
//
// 验证方式：无头 Chrome + 内存拼装页面（不写产物）；先在 body 注入一个 select.tc-input
//   （走 ensureCustomSelects 观察器自动 attach），再模拟真实点触发器 → 断言浮层 computed
//   display 非 none、有渲染盒、可命中、点选回写 value+派发 change、点选后收起；并走真实
//   音乐页「链接添加」面板复验。全部用 getComputedStyle/rect/事件，不看代码名。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const srcDir = process.env.SRCDIR ? normalize(process.env.SRCDIR) : join(root, 'src');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = chromeCandidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge（可用 CHROME_PATH 指定）'); process.exit(1); }

const buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8');
function arrFromBuild(name) {
  const m = buildSrc.match(new RegExp('const ' + name + ' = (\\[[^\\n]*\\]);'));
  if (!m) throw new Error('build.mjs 未找到 ' + name);
  return JSON.parse(m[1].replace(/'/g, '"'));
}
const cssFiles = arrFromBuild('cssFiles');
const jsFiles = arrFromBuild('jsFiles');
const readSrc = (p) => readFileSync(join(srcDir, p), 'utf8');
const wrapFile = (f, code) => '(function () { try {\n' + code + '\n} catch (__e) { if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();';

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-cso-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 80; i++) {
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
    if (r && r.exceptionDetails) { return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

const server = createServer((req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/' || u === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
    const p = normalize(join(root, u));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': extname(p) === '.css' ? 'text/css' : 'text/javascript' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cssCode = cssFiles.map((f) => '<style>' + readSrc('css/' + f) + '</style>').join('\n');
const jsCode = jsFiles.map((f) => wrapFile(f, readSrc('js/' + f))).join('\n');
const staticHtml = readFileSync(join(srcDir, 'template.html'), 'utf8')
  .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<link[^>]*rel="stylesheet"[^>]*>/gi, '');
const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + cssCode + '</head><body>' + staticHtml +
  '<div id="cc-toast" class="cc-toast"></div>' + '<script>' + jsCode + '</script></body></html>';

// 打开浮层后读取其真实可见性（computed display + 渲染盒 + 命中）
const LIST_STATE = `(function(){
  var l=document.querySelector('body > .mochi-custom-select-list') || document.querySelector('.mochi-custom-select-list');
  if(!l) return {missing:true};
  var cs=getComputedStyle(l); var r=l.getBoundingClientRect();
  var hit=null; if(r.width&&r.height){ var el=document.elementFromPoint(r.left+r.width/2, Math.min(r.top+r.height/2, r.bottom-1)); hit= el? (el.className||el.tagName):null; }
  return { display:cs.display, w:Math.round(r.width), h:Math.round(r.height), parentBody:(l.parentNode===document.body), hit:String(hit), opts:l.querySelectorAll('.mochi-cs-opt').length };
})()`;

let pass = 0, fail = 0;
function report(id, name, ok, msg) {
  if (ok) { pass++; console.log('PASS ' + id + '  ' + name); }
  else { fail++; console.log('FAIL ' + id + '  ' + name + (msg ? '  → ' + msg : '')); }
}

try {
  // ===== S 段：静态锚点 =====
  for (const [id, name, ok] of [
    ['S1', 'openList 显式 display:block（原 display:"" 已消失）', /document\.body\.appendChild\(list\);\s*\n\s*\/\/[^\n]*\n\s*list\.style\.display = 'block';/.test(readSrc('js/ta-ask.js')) || (/list\.style\.display = 'block';/.test(readSrc('js/ta-ask.js')) && !/list\.style\.display = '';/.test(readSrc('js/ta-ask.js')))],
    ['S2', '原生 select 仍被隐藏（须自定义浮层接管）', /select\.mochi-custom-select-native \{ display:none; \}/.test(readSrc('css/chat-pages.css'))],
    ['S3', '浮层默认收起态仍是 display:none（block 必须由 JS 打开时写）', /\.mochi-custom-select-list \{\s*\n?\s*display:none;/.test(readSrc('css/chat-pages.css'))]
  ]) report(id, name, ok, ok ? '' : '源锚点缺失');
  const staticFail = fail;

  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 3.5, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  await evalJs('window.location.href = ' + JSON.stringify(baseUrl + '/') + '; true;');
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(400);
  await evalJs(`(function(){ var sp=document.getElementById('splash'); if(sp) sp.classList.add('hide'); var m=document.getElementById('modal-mask'); if(m) m.hidden=true; document.body.classList.remove('scroll-lock'); return true; })();`);
  await sleep(300);

  // 注入一个通用 select.tc-input（走 ensureCustomSelects 观察器自动 attach）；
  // 全程按「注入 select 自己的 wrap/list 引用」断言，避免命中模板里其它已 attach 的下拉。
  const attached = await evalJs(`(function(){
    var s=document.createElement('select'); s.className='tc-input'; s.id='vcs-test';
    s.innerHTML='<option value="default">我的音乐库</option><option value="spl_x">测试歌单</option><option value="__new__">＋ 新建歌单…</option>';
    window.__vcsChange=0; s.addEventListener('change',function(){ window.__vcsChange++; });
    document.body.appendChild(s);
    window.__vcsSel=s;
    return true;
  })()`);
  for (let i = 0; i < 30; i++) {
    if (await evalJs(`(function(){ var s=window.__vcsSel; var w=s&&s.previousElementSibling; return !!(w&&w.classList&&w.classList.contains('mochi-custom-select')); })()`)) break;
    await sleep(100);
  }
  await evalJs(`(function(){ var s=window.__vcsSel; window.__vcsWrap=s.previousElementSibling; window.__vcsTrig=window.__vcsWrap.querySelector('.mochi-custom-select-trig'); window.__vcsList=window.__vcsWrap.querySelector('.mochi-custom-select-list'); return true; })()`);
  const inspect = (ref) => evalJs(`(function(l){ if(!l) return {missing:true}; var cs=getComputedStyle(l); var r=l.getBoundingClientRect();
    var hit=null; if(r.width&&r.height){ var el=document.elementFromPoint(r.left+r.width/2, Math.min(r.top+r.height/2, r.bottom-1)); hit= el? (el.className||el.tagName):null; }
    return { display:cs.display, w:Math.round(r.width), h:Math.round(r.height), parentBody:(l.parentNode===document.body), inDoc:document.body.contains(l), hit:String(hit) }; })(${ref})`);

  const wrapState = await evalJs(`(function(){
    var s=document.getElementById('vcs-test'); var w=window.__vcsWrap;
    return { hasWrap:!!w, nativeDisplay:getComputedStyle(s).display, label:w? (w.querySelector('.mochi-custom-select-label')||{}).textContent : null };
  })()`);
  report('B1', '原生 select 被替换为自定义触发器且原生隐藏', attached === true && !!wrapState && wrapState.hasWrap === true && wrapState.nativeDisplay === 'none', JSON.stringify(wrapState));

  // B2：点触发器 → 浮层可见
  await evalJs(`window.__vcsTrig.click(); true;`);
  await sleep(150);
  let st = await inspect('window.__vcsList');
  report('B2', '点触发器浮层真的展开（computed display 非 none 且有渲染盒）', !!st && !st.missing && st.display !== 'none' && st.w > 0 && st.h > 0, JSON.stringify(st));
  const b3 = await evalJs(`(function(){ return { opts: window.__vcsList.querySelectorAll('.mochi-cs-opt').length }; })()`);
  report('B3', '浮层 portal 到 body（不被面板/overflow 裁剪遮挡）且菜单项已渲染', !!st && st.parentBody === true && !!b3 && b3.opts >= 3, JSON.stringify({ list: st, opt: b3 }));

  // B4：点一个「与当前不同」的选项 → 回写 value + 派发 change
  await evalJs(`(function(){ var bs=window.__vcsList.querySelectorAll('.mochi-cs-opt'); for(var i=0;i<bs.length;i++){ if(bs[i].textContent==='测试歌单'){ bs[i].click(); return true; } } return false; })()`);
  await sleep(120);
  const selRes = await evalJs(`(function(){ var s=document.getElementById('vcs-test'); var w=window.__vcsWrap; return { value:s.value, change:window.__vcsChange, wrapOpen:w.className.indexOf('open')>=0 }; })()`);
  report('B4', '点选写回原生 value 并派发 change（既有消费方兼容）', !!selRes && selRes.change >= 1 && selRes.value === 'spl_x' && selRes.wrapOpen === false, JSON.stringify(selRes));
  const st2 = await inspect('window.__vcsList');
  report('B5', '点选后浮层收起', !!st2 && (st2.display === 'none' || st2.inDoc === false), JSON.stringify(st2));

  // B6：再次打开后点触发器收起
  await evalJs(`window.__vcsTrig.click(); true;`);
  await sleep(120);
  const st3 = await inspect('window.__vcsList');
  await evalJs(`window.__vcsTrig.click(); true;`);
  await sleep(120);
  const st4 = await inspect('window.__vcsList');
  report('B6', '可重复开合（开→可见，再点→收起）', !!st3 && st3.display !== 'none' && st3.h > 0 && !!st4 && (st4.display === 'none' || st4.inDoc === false), JSON.stringify({ open: st3, closed: st4 }));

  // B7：真实音乐页「链接添加」面板里的下拉同样能开
  await evalJs(`(function(){ var el=document.querySelector('.app[data-app="music"]'); if(el) el.click(); return true; })();`);
  await sleep(300);
  await evalJs(`(function(){ var b=document.getElementById('music-add-url'); if(b) b.click(); return true; })();`);
  await sleep(300);
  const musicRes = await evalJs(`(function(){
    var panel=document.getElementById('tc-body'); if(!panel) return 'no-panel';
    var w=panel.querySelector('.mochi-custom-select'); if(!w) return 'no-wrap';
    var l=w.querySelector('.mochi-custom-select-list');
    w.querySelector('.mochi-custom-select-trig').click();
    var cs=getComputedStyle(l); var r=l.getBoundingClientRect();
    var b=l.querySelector('.mochi-cs-opt'); var hit=null;
    if(b){ var br=b.getBoundingClientRect(); var el=document.elementFromPoint(br.left+br.width/2, br.top+br.height/2); hit= el? (el.className||el.tagName):null; }
    return { display:cs.display, w:Math.round(r.width), h:Math.round(r.height), parentBody:(l.parentNode===document.body), hit:String(hit), label:w.querySelector('.mochi-custom-select-label').textContent };
  })()`);
  report('B7', '音乐「导入到歌单」下拉可展开且菜单项可命中（用户报障现场）', !!musicRes && musicRes.display !== 'none' && musicRes.w > 0 && musicRes.h > 0 && musicRes.parentBody === true && /mochi-cs-opt/.test(String(musicRes.hit)), JSON.stringify(musicRes));

  const errs = (await evalJs('(window.__jsErrors || []).slice(0, 5)')) || [];
  report('B8', '零未捕获异常', !(Array.isArray(errs) && errs.length), JSON.stringify(errs));

  console.log('\n结果: ' + pass + '/' + (pass + fail) + ' 通过' + (staticFail ? '（静态段有红）' : ''));
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
process.exit(fail ? 1 : 0);
