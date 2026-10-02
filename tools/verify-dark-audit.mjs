// ===== 深色模式全量页面审计（配合 tools/dark-audit-fn.js 的注入函数） =====
// 用法：node tools/verify-dark-audit.mjs        （产物 index.html，需先 node build.mjs）
//       MOCHI_DARK_AUDIT_REPORT=1 输出 JSON 明细到 tools/dark-audit-report.json
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
// 判定（只把「真看不见」计为失败，设计上的浅色强调钮不算）：
//   FAIL ① low-contrast high（文字与有效背景对比度 <1.8）
//        ② light-bg（近纯白大底）且其自身文字对比度 <2.6（白底白字）
//   INFO  其余 light-bg / grayish-bg（浅底深字=强调钮设计、半透明浅底等）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
// MOCHI_AUDIT_ROOT：隔离构建目录（只影响被服务的产物；审计函数/报告仍取仓库根）
const serveRoot = process.env.MOCHI_AUDIT_ROOT ? normalize(process.env.MOCHI_AUDIT_ROOT) : root;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    const p = normalize(join(serveRoot, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(serveRoot)) { res.writeHead(403); res.end(); return; }
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
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(2); }

const cdpPort = 9700 + Math.floor(Math.random() * 99);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-dark-audit-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
if (!ws) { console.error('无法连接无头浏览器'); process.exit(2); }
const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
const evalJs = async (expression) => {
  try {
    const r = await cdp('Runtime.evaluate', { expression, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
};

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(1500);
await evalJs("(function(){try{localStorage.setItem('xy-home-v2:theme-mode','dark');localStorage.setItem('xy-home-v2:desk-first-done','1')}catch(e){};return 1})()");
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(600);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();var c=document.getElementById('splash-confirm');if(c&&!c.hidden){var ok=document.getElementById('splash-confirm-ok');if(ok)ok.click();}c=document.getElementById('splash-confirm');if(c)c.hidden=true;return 1;})()");
await sleep(1000);

const auditFn = readFileSync(join(root, 'tools', 'dark-audit-fn.js'), 'utf8');
await evalJs(auditFn);

// 二次判定：light-bg 命中的元素，其自身文字对比度（白底白字才算真问题）
const triageFn = `(function(){
  function parseC(c){ if(!c||c.indexOf('rgb')!==0)return null; var a=c.slice(c.indexOf('(')+1,c.indexOf(')')).split(',').map(parseFloat); return {r:a[0],g:a[1],b:a[2],al:a.length>3?a[3]:1}; }
  function lum(c){ function f(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);} return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); }
  function ratio(a,b){ var l1=lum(a),l2=lum(b),hi=Math.max(l1,l2),lo=Math.min(l1,l2); return Math.round(((hi+0.05)/(lo+0.05))*100)/100; }
  function effBg(el){ var n=el,layers=[]; while(n&&n.nodeType===1){ var c=parseC(getComputedStyle(n).backgroundColor); if(c&&c.al>0.04){layers.push(c); if(c.al>=0.95)break;} n=n.parentElement; } var col={r:17,g:17,b:17,al:1}; for(var i=layers.length-1;i>=0;i--){ var L=layers[i]; col={r:L.r*L.al+col.r*(1-L.al),g:L.g*L.al+col.g*(1-L.al),b:L.b*L.al+col.b*(1-L.al),al:1}; } return col; }
  window.__triage = function(sels){
    var out=[];
    sels.forEach(function(sel){
      var el; try{ el=document.querySelector(sel); }catch(e){}
      if(!el) return;
      var hasText=false, hasSvg=false;
      for(var t=0;t<el.childNodes.length;t++){
        var nd=el.childNodes[t];
        if(nd.nodeType===3&&nd.nodeValue&&nd.nodeValue.replace(/\s+/g,'').length){hasText=true;break;}
      }
      if(!hasText&&el.querySelector&&el.querySelector('svg')) hasSvg=true;
      var fg=null,n=el;
      if(hasText){
        while(n&&n.nodeType===1&&!fg){ fg=parseC(getComputedStyle(n).color); if(fg&&fg.al>0.25)break; fg=null; n=n.parentElement; }
      }else if(hasSvg){
        var sv=el.querySelector('svg'), sc=getComputedStyle(sv).stroke;
        if(sc&&sc.indexOf('rgb')===0) fg=parseC(sc);
      }
      var eb=effBg(el);
      out.push({sel:sel, fg:fg?('rgb('+fg.r+','+fg.g+','+fg.b+')'):'(no-text/no-svg)', ratio:fg?ratio(fg,eb):null});
    });
    return out;
  };
  return 1;
})()`;
await evalJs(triageFn);

const report = [];
const fails = [];
async function auditStep(name) {
  await sleep(420);
  const issues = (await evalJs('window.__darkAudit && JSON.stringify(window.__darkAudit())')) || '[]';
  const visible = await evalJs('window.__darkVisibleInfo ? window.__darkVisibleInfo() : ""');
  let arr = []; try { arr = JSON.parse(issues); } catch (e) {}
  // light-bg 的二次判定
  const lightSels = arr.filter(i => i.type === 'light-bg').map(i => i.sel);
  let tri = [];
  if (lightSels.length) {
    const r = await evalJs('JSON.stringify(window.__triage(' + JSON.stringify(lightSels) + '))');
    try { tri = JSON.parse(r) || []; } catch (e) {}
  }
  const triMap = {}; tri.forEach(t => { triMap[t.sel] = t; });
  for (const i of arr) {
    if (i.type === 'light-bg') {
      const t = triMap[i.sel];
      if (t && t.ratio !== null && t.ratio < 2.6) { i.verdict = 'FAIL'; i.triage = t; }
      else { i.verdict = 'info'; i.triage = t || null; }
    } else if (i.type === 'low-contrast' && i.level === 'high') i.verdict = 'FAIL';
    else i.verdict = 'info';
    if (i.verdict === 'FAIL') fails.push(name + '  ' + i.sel + '  ' + i.detail + (i.triage ? '  fg=' + i.triage.fg + ' ratio=' + i.triage.ratio : ''));
  }
  report.push({ step: name, visible, issues: arr });
  const f = arr.filter(i => i.verdict === 'FAIL').length;
  console.log((f ? 'FAIL' : 'ok  ') + '  ' + name + '  [' + visible + ']  issues=' + arr.length + (f ? '  fail=' + f : ''));
  await evalJs('window.__darkReset && window.__darkReset()');
  await sleep(120);
}

const showPages = "(function(){var v=__initVis||['page-phone'];document.querySelectorAll('.page').forEach(function(p){p.hidden=(v.indexOf(p.id)<0)});return 1})()";
await evalJs('window.__initVis=' + JSON.stringify(await evalJs("(function(){var v=[];document.querySelectorAll('.page').forEach(function(p){if(!p.hidden)v.push(p.id)});return v})()")));

// ---- A. 桌面图标真实点击路径（覆盖懒渲染的应用页） ----
const apps = (await evalJs("(function(){return [].slice.call(document.querySelectorAll('.app[data-app]')).map(function(a){return a.getAttribute('data-app')}).filter(function(v,i,arr){return arr.indexOf(v)===i})})()")) || [];
for (const app of apps) {
  await evalJs(showPages);
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"" + app + "\"]');if(a)a.click();return 1})()");
  await auditStep('app:' + app);
}
// ---- B. 全部 .page 直开 ----
const pages = (await evalJs("(function(){return [].slice.call(document.querySelectorAll('.page[id]')).map(function(p){return p.id})})()")) || [];
for (const pid of pages) {
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='" + pid + "')});var t=document.querySelector('.tabbar');if(t)t.hidden=false;return 1})()");
  await auditStep('page:' + pid);
}
// ---- C. 浮层/面板直开（聊天页打底 + 聊天面板 & 全局浮层 & 游戏面板） ----
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat')});return 1})()");
const panels = ['#poke-card', '#emoji-panel', '#chat-more-panel', '#chat-search', '#chat-ask-panel', '#chat-decision-panel', '#chat-divine-panel', '#chat-rps-panel', '#chat-snake-panel', '#chat-pong-panel', '#chat-gift-panel', '#chat-call-panel', '#chat-linkup-panel', '#chat-match3-panel', '#chat-gomoku-panel', '#chat-c4-panel', '#chat-ms-panel', '#chat-auction-panel', '#chat-memory-panel', '#chat-fish-panel', '#avlib-card', '#ck-panel', '#loc-panel', '#qa-mask', '#tc-mask', '#chat-rp-panel', '#batch-panel', '#msg-actions', '#modal-mask', '#contact-manager', '#img-view-mask', '#cc-export-mask', '#cc-scope-mask', '#call-mask', '#feed-notice-panel', '#feed-comment-panel', '#desk-image-viewer'];
for (const s of panels) {
  const ex = await evalJs("(function(){var e=document.querySelector('" + s + "');return e?1:0})()");
  if (!ex) continue;
  await evalJs("(function(){var e=document.querySelector('" + s + "');e.hidden=false;if(getComputedStyle(e).display==='none')e.style.display='flex';return 1})()");
  await auditStep('panel:' + s);
}
// ---- D. 聊天更多面板内子功能（真实点击 more-tab 更接近真实内容） ----
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat')});var m=document.querySelector('#chat-more-panel');if(m){m.hidden=false;}return 1})()");
const moreTabs = await evalJs("(function(){return [].slice.call(document.querySelectorAll('#chat-more-panel .more-tab')).map(function(t){return t.textContent.trim().slice(0,8)})})()") || [];
await evalJs("(function(){var m=document.querySelector('#chat-more-panel');if(m)m.hidden=true;return 1})()");
for (const t of moreTabs) {
  await evalJs("(function(){var tabs=[].slice.call(document.querySelectorAll('#chat-more-panel .more-tab'));var b=tabs.filter(function(x){return x.textContent.trim().indexOf(" + JSON.stringify(t) + ")===0})[0];if(b)b.click();return 1})()");
  await auditStep('moretab:' + t);
}

// ---- 汇总 ----
const failsUnique = [...new Set(fails)];
console.log('\n==== 审计完成：' + report.length + ' 步，真问题 ' + failsUnique.length + ' 条 ====');
failsUnique.forEach(f => console.log('  FAIL ' + f));
if (process.env.MOCHI_DARK_AUDIT_REPORT) {
  writeFileSync(join(root, 'tools', 'dark-audit-report.json'), JSON.stringify(report, null, 1));
  console.log('明细已写 tools/dark-audit-report.json');
}
try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(failsUnique.length ? 1 : 0);
