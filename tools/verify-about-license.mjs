// ===== 专项验证：功能介绍与二传二改说明（合并页重构烟雾测试） =====
// 用法：node tools/verify-about-license.mjs
// 从当前 src/ 自组装临时页面测试，不依赖仓库根的构建产物。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => readFileSync(join(root, 'src', f), 'utf8');

const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'group-chat.js', 'decision.js', 'group-decision.js'];
let html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const styles = cssFiles.map((f) => read(join('css', f))).join('\n');
const scripts = jsFiles.map((f) => '(function () { try {\n' + read(join('js', f)) + '\n} catch (__e) {} })();').join('\n');
html = html.replace('/*__STYLES__*/', styles);
html = html.replace('/*__SCRIPTS__*/', scripts);
html = html.split('__BUILD_INFO__').join('verify-about');
html = html.split('__BUILD_TS__').join(String(Date.now()));
html = html.split('__APP_VERSION__').join('v3.14.x-verify');
const tmpHtml = join(tmpdir(), 'mochi-about-' + Date.now() + '.html');
writeFileSync(tmpHtml, html);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    // 首页一律回自组装页（仓库根存在旧构建产物 index.html，不能让它漏出来）
    if (req.url === '/' || req.url.split('?')[0] === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9950 + Math.floor(Math.random() * 49));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(tmpdir(), 'mochi-ab-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

// 进入设置页
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-setting');});return true;})()");
await sleep(400);

// T1 设置页只有合并入口
let r1 = J(await evalJs("(function(){var ra=document.getElementById('row-about');var rl=document.getElementById('row-license');var txt=ra?ra.querySelector('.txt').textContent:'';return JSON.stringify({hasAbout:!!ra,label:txt,noLicense:!rl});})()"));
check('T1 合并入口存在、旧许可入口已删', r1.hasAbout && r1.noLicense && r1.label.indexOf('功能介绍') >= 0 && r1.label.indexOf('许可') >= 0, r1.label);

// T2 点击进入合并页：hero / 原版徽章 / 版本号已替换
await evalJs("(function(){var b=document.getElementById('row-about');if(b)b.click();return true;})()");
await sleep(400);
let r2 = J(await evalJs("(function(){var pg=document.getElementById('page-about');var badge=document.querySelector('#page-about .lic-badge');var ver=document.querySelector('#page-about .lic-ver');var grps=document.querySelectorAll('#page-about .lic-grp').length;return JSON.stringify({open:pg?!pg.hidden:false,badge:badge?badge.textContent:'',ver:ver?ver.textContent:'',verOk:ver?ver.textContent.indexOf('__APP_VERSION__')<0:false,grps:grps});})()"));
check('T2 合并页打开：原版徽章+版本号+分组数', r2.open && r2.badge === '原版' && r2.verOk && r2.grps >= 22, JSON.stringify(r2));

// T3 折叠交互：首个默认展开，点第二个 summary 可展开
let r3a = J(await evalJs("(function(){var d=document.querySelectorAll('#page-about details.lic-grp');return JSON.stringify({firstOpen:d[0]?d[0].open:false,secondOpen:d[1]?d[1].open:false,total:d.length});})()"));
await evalJs("(function(){var d=document.querySelectorAll('#page-about details.lic-grp');if(d[1])d[1].querySelector('summary').click();return true;})()");
await sleep(200);
let r3b = J(await evalJs("(function(){var d=document.querySelectorAll('#page-about details.lic-grp');return JSON.stringify({secondOpenNow:d[1]?d[1].open:false});})()"));
check('T3 分组折叠交互正常（默认开第一个，点击可展开第二个）', r3a.firstOpen && !r3a.secondOpen && r3b.secondOpenNow, JSON.stringify(r3a) + '→' + JSON.stringify(r3b));

// T4 原版定位文案：新表述在、旧「基于星言修改」表述已清；「关于星言字卡与灵感来源」卡已整卡删除
let r4 = J(await evalJs("(function(){var h=document.getElementById('page-about');var t=h?h.innerHTML:'';return JSON.stringify({original:t.indexOf('原创独立作品（即原版）')>=0,noOldBase:t.indexOf('基于')<0||t.indexOf('星言字卡』修改')<0&&t.indexOf('星言字卡】修改')<0,starCardGone:t.indexOf('关于星言字卡与灵感来源')<0&&t.indexOf('禁止二传二改')<0});})()"));
check('T4 许可区：原创定位齐全、星言卡已删', r4.original && r4.noOldBase && r4.starCardGone, JSON.stringify(r4));

// T5 许可（LICENSE）卡置于顶部、位于功能清单之前；「关于星言字卡与灵感来源」卡已整卡删除，旧「许可与署名/README 配文」已移除
let r5 = J(await evalJs("(function(){var pg=document.getElementById('page-about');var cards=Array.prototype.slice.call(pg.querySelectorAll('.cal-card'));var li=-1,ab=-1,fe=-1;for(var i=0;i<cards.length;i++){var h=cards[i].querySelector('.lic-h');var ht=h?(h.textContent||''):'';if(li<0&&ht.indexOf('许可')>=0)li=i;if(ab<0&&ht.indexOf('关于星言字卡与灵感来源')>=0)ab=i;if(fe<0&&cards[i].querySelector('.lic-grp'))fe=i;}var html=pg.innerHTML;return JSON.stringify({li:li,ab:ab,fe:fe,top:li>=1&&ab<0&&fe>li,noOld:html.indexOf('README 配文')<0&&html.indexOf('许可与署名')<0});})()"));
check('T5 许可卡置顶且先于功能清单，星言卡与旧块已删', r5.top && r5.noOld, JSON.stringify(r5));

// T6 返回按钮回设置页；旧 license 页不存在
await evalJs("(function(){var b=document.getElementById('about-back');if(b)b.click();return true;})()");
await sleep(300);
let r6 = J(await evalJs("(function(){var st=document.getElementById('page-setting');var lp=document.getElementById('page-license');return JSON.stringify({backToSetting:st?!st.hidden:false,licenseGone:!lp});})()"));
check('T6 返回设置页正常、旧许可页已删除', r6.backToSetting && r6.licenseGone);

try { chrome.kill(); } catch (e) {}
server.close();
const pass = results.filter((r) => r.ok).length;
console.log('\n== 功能介绍与许可合并页验证: ' + pass + '/' + results.length + ' ==');
process.exit(pass === results.length ? 0 : 1);
