// ===== 专项验证 #527b：边看边调「紧凑底部条」布局与交互行为断言（无头 Chrome） =====
// 背景（用户真机反馈）：初版把「边看边调」做成 56vh 抽屉 + 每行一个原生 <input type=color>，
// 原生取色器在真机被渲染成一大块（每行约 100px），内容远超高度 → 用户原话
// 「边看边调的页面还是没用啊，把全部基本遮挡完了」。现改为 44vh + 分区胶囊互斥 +
// 就地调色盘（点色块即时生效，不用原生取色器）。本脚本锁定这几条不可回退的性质。
// 用法：node tools/verify-beauty-drawer-layout.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function read(p) { return readFileSync(join(root, p), 'utf8'); }
const b = read('build.mjs');
function arrOf(n) { const m = b.match(new RegExp('const ' + n + '\\s*=\\s*\\[([\\s\\S]*?)\\]')); return m ? m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : []; }
let css = '', js = '';
for (const f of arrOf('cssFiles')) { try { css += read('src/css/' + f) + '\n'; } catch (e) {} }
for (const f of arrOf('jsFiles')) { try { js += '/* ' + f + ' */\n' + read('src/js/' + f) + '\n'; } catch (e) {} }
const page = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>' + css + '</style></head><body>' + read('src/template.html') +
  '<scr' + 'ipt>window.__APP_VERSION__="t";</scr' + 'ipt><scr' + 'ipt>' + js + '</scr' + 'ipt></body></html>';
const server = createServer((q, r) => { try { const p = q.url.split('?')[0]; if (p === '/blank.html') { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<html><body>b</body></html>'); return; } if (p === '/test.html') { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(page); return; } r.writeHead(404); r.end(); } catch (e) {} });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const cands = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const cp = cands.find(p => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const tmp = join(os.tmpdir(), 'verifydrawer-' + Date.now()); const port = 12700 + Math.floor(Math.random() * 90);
const ch = spawn(cp, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + tmp, '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 100; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find(t => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
const cdp = (m, p = {}) => { const i = ++id; return new Promise(r => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); }); };
async function ev(e) { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return { __exc: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text }; return r && r.result ? r.result.value : null; }
const results = [];
const chk = (n, ok, d) => { results.push(ok); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  [' + String(d).slice(0, 300) + ']')); };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: base + '/blank.html' }); await sleep(400);
await cdp('Page.navigate', { url: base + '/test.html' }); await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady') === true) break; await sleep(300); }
// 关掉开屏与「数据备份提醒」弹窗（后者是并行会话在途稿，会干扰点击）
await ev("(function(){var mm=document.getElementById('splash-mandatory');if(mm&&!mm.hidden){var men=document.getElementById('splash-mandatory-enter');if(men)men.click();}var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide')){sp.classList.add('hide');sp.hidden=true;}return true;})()");
await sleep(500);
await ev("(function(){var ok=document.getElementById('modal-ok');var m=document.getElementById('modal-mask');if(m&&!m.hidden){if(ok)ok.click();if(!m.hidden){m.hidden=true;m.style.display='none';}}return true;})()");
await sleep(400);
await ev("(function(){var r=document.getElementById('row-appearance');if(r)r.click();return true;})()");
await sleep(400);
await ev("(function(){var b=document.getElementById('dq-drawer');if(b)b.click();return true;})()");
await sleep(700);

async function shot(name) { const r = await cdp('Page.captureScreenshot', { format: 'png' }); if (r && r.data) writeFileSync(join(root, 'tools', name), Buffer.from(r.data, 'base64')); }

const m0 = await ev(`(function(){
  var d=document.getElementById('beauty-drawer'); var r=d.getBoundingClientRect();
  var phone=document.querySelector('.phone'); var pr=phone.getBoundingClientRect();
  return JSON.stringify({ h:Math.round(r.height), top:Math.round(r.top), vh:window.innerHeight,
    pctOfVh: Math.round(r.height/window.innerHeight*100),
    desktopVisiblePct: Math.round((r.top-pr.top)/pr.height*100),
    colorItems: d.querySelectorAll('div[style*="border-radius:9px"]').length,
    sections: [].map.call(d.querySelectorAll('button'),function(b){return b.textContent;}).filter(function(t){return t==='颜色'||t==='尺寸'||t==='背景';}),
    overflow: d.scrollHeight > d.clientHeight });
})()`);
const o0 = JSON.parse(String(m0));
chk('D1 抽屉高度 ≤ 40vh（不再盖掉大半个桌面）', o0.pctOfVh <= 40, m0);
chk('D2 桌面可见 ≥ 60%', o0.desktopVisiblePct >= 60, m0);
chk('D3 三个分区胶囊齐全', o0.sections.length === 3, m0);
chk('D4 初始内容不需要滚动（紧凑到一屏放下）', o0.overflow === false, m0);
await shot('_drawer_v2.png');

// 点「主题色」→ 调色盘展开
// 点「主题色」（父 DIV，内含空白色块 SPAN + 文字 SPAN）——按结构定位，不依赖样式字符串
const clicked = await ev("(function(){var d=document.getElementById('beauty-drawer');var els=d.querySelectorAll('div');for(var i=0;i<els.length;i++){var e=els[i];if((e.textContent||'').trim()==='主题色'&&e.querySelectorAll('span').length===2){e.click();return 'ok';}}return 'no-match';})()");
chk('D5a 找到并点击「主题色」候选项', clicked === 'ok', clicked);
chk('D5 点颜色项展开就地调色盘（含色块+手输）', await ev("(function(){var d=document.getElementById('beauty-drawer');return /正在调/.test(d.textContent)&&/手输色值/.test(d.textContent);})()") === true);
// 点第 3 个调色块（红）→ 即时改主题色
const before = await ev("getComputedStyle(document.documentElement).getPropertyValue('--btn-bg').trim()");
const dotClicked = await ev("(function(){var d=document.getElementById('beauty-drawer');var dots=[];Array.prototype.forEach.call(d.querySelectorAll('span'),function(s){var cs=getComputedStyle(s);if(cs.width==='23px'&&cs.borderRadius==='7px')dots.push(s);});if(dots[2]){dots[2].click();return 'ok:'+dots.length;}return 'no-dots';})()");
console.log('   (点击调色块 =', dotClicked, ')');
await sleep(350);
const after = await ev("getComputedStyle(document.documentElement).getPropertyValue('--btn-bg').trim()");
const stored = await ev("localStorage.getItem('xy-home-v2:accent-color')");
chk('D6 点色块即时生效（CSS 变量已变）', String(before) !== String(after) && /^#/.test(String(after)), 'before=' + before + ' after=' + after);
chk('D7 选色已落库（accent-color）', /^#/.test(String(stored)), stored);
await shot('_drawer_v2_palette.png');

// 切到「背景」分区
await ev("(function(){var d=document.getElementById('beauty-drawer');Array.prototype.forEach.call(d.querySelectorAll('button'),function(b){if(b.textContent==='背景')b.click();});return true;})()");
await sleep(400);
const bgTxt = await ev("document.getElementById('beauty-drawer').textContent");
chk('D8 切分区后显示背景项（模糊/遮罩/壁纸入口）', /背景模糊/.test(String(bgTxt)) && /背景遮罩/.test(String(bgTxt)) && /更换壁纸/.test(String(bgTxt)), bgTxt);
// 切到「尺寸」
await ev("(function(){var d=document.getElementById('beauty-drawer');Array.prototype.forEach.call(d.querySelectorAll('button'),function(b){if(b.textContent==='尺寸')b.click();});return true;})()");
await sleep(400);
const szTxt = await ev("document.getElementById('beauty-drawer').textContent");
chk('D9 尺寸分区含圆角滑杆 + 手机端字号提示', /组件圆角/.test(String(szTxt)) && /图标圆角/.test(String(szTxt)) && /仅电脑端/.test(String(szTxt)), szTxt);

// 折叠
await ev("(function(){var d=document.getElementById('beauty-drawer');Array.prototype.forEach.call(d.querySelectorAll('button'),function(b){if(b.textContent==='收起')b.click();});return true;})()");
await sleep(400);
const mFold = await ev(`(function(){var d=document.getElementById('beauty-drawer');var r=d.getBoundingClientRect();
  return JSON.stringify({h:Math.round(r.height), pctOfVh:Math.round(r.height/window.innerHeight*100), hasExpand:[].some.call(d.querySelectorAll('button'),function(b){return b.textContent==='展开';})});})()`);
const of = JSON.parse(String(mFold));
chk('D10 折叠后只剩标题行（高度 < 15vh）且按钮变「展开」', of.pctOfVh < 15 && of.hasExpand === true, mFold);

// 关闭回美化页
await ev("(function(){var d=document.getElementById('beauty-drawer');Array.prototype.forEach.call(d.querySelectorAll('button'),function(b){if(b.textContent==='\\u2715')b.click();});return true;})()");
await sleep(400);
chk('D11 关闭后回美化页且抽屉隐藏', await ev("(function(){var d=document.getElementById('beauty-drawer');return getComputedStyle(d).display==='none'&&!document.getElementById('page-theme').hidden;})()") === true);
chk('D12 零未捕获异常（本次交互全程）', (await ev("JSON.stringify(window.__jsErrors||[])")).length <= 2, await ev("JSON.stringify((window.__jsErrors||[]).slice(-3))"));

ch.kill(); try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {} server.close();
const f = results.filter(x => !x).length;
console.log(f ? ('FAILED ' + f + '/' + results.length) : ('ALL PASS ' + results.length + '/' + results.length));
process.exit(f ? 1 : 0);
