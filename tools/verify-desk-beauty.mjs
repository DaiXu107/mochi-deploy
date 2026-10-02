// ===== 验证：桌面美化三处回归 =====
// 回归 v3.26.x（用户反馈）：
//   1) 恢复默认布局桌面（row-desk-reset）只点底部「确定」无反应 → 修复：ctl.pills 预选「确定恢复默认」
//   2) 装修模式点图标换图（grid 路径 + 被移出网格的独立图标委托路径 + 确认「上传图片」触发 pickFile）
//   3) 内置壁纸预设（phone-bg-preset）刷新应用 + 切 tab 后仍保留 → 修复：applyBgVisibility 认预设
// 用法：node tools/verify-desk-beauty.mjs（需先 node build.mjs，需本机 Chrome/Edge）
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 150));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-deskbeauty-' + Date.now()),
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
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return { __err: String(r.exceptionDetails.text || '') };
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function freshLoad(preseed) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2000);
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(250); }
  if (preseed) await ev('(function(){var s=window.activeStore();' + preseed + ';return true;})()');
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2000);
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(250); }
  await ev("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
  await sleep(800);
}
const modalVisible = "!document.getElementById('modal-mask').hidden";

// ============ Bug 3：内置壁纸预设 ============
console.log('\n===== Bug3 内置壁纸预设 =====');
await freshLoad(null);
// 预置 preset 后刷新
await ev("(function(){var s=window.activeStore();s.set('phone-bg-preset','晨曦');return true;})()");
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2200);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(250); }
await ev("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
await sleep(800);
const bgAfterLoad = await ev("(function(){var l=document.getElementById('phone-bg-layer');return (l&&l.style.backgroundImage)||'';})()");
check('刷新后预设壁纸已应用（#147 常驻图层有渐变背景）', String(bgAfterLoad || '').indexOf('gradient') >= 0, String(bgAfterLoad).slice(0, 60));
// 切 tab 后再切回
await ev("(function(){var t=document.querySelector('.tab[data-page=\"page-settings\"]');if(t)t.click();return true;})()");
await sleep(300);
await ev("(function(){var t=document.querySelector('.tab[data-page=\"page-phone\"]');if(t)t.click();return true;})()");
await sleep(300);
const bgAfterTab = await ev("(function(){var l=document.getElementById('phone-bg-layer');return (l?l.style.backgroundImage+'|op:'+l.style.opacity:'');})()");
check('切 tab 后预设壁纸仍在（图层 opacity 恢复 1）', String(bgAfterTab || '').indexOf('gradient') >= 0 && /op:1/.test(String(bgAfterTab)), String(bgAfterTab).slice(0, 60));

// ============ Bug 1：恢复默认桌面 ============
console.log('\n===== Bug1 恢复默认桌面（只点底部确定）=====');
await freshLoad(null);
await ev("(function(){var s=window.activeStore();s.set('desk-layout',JSON.stringify([['deco','quote-row','checkin','apps','music','p2apps','memo-row','week','weekend','desk-period','app-chat','app-mail','app-feed','app-calendar','app-memory','app-note','app-music','app-stats','app-interact','app-checkin','app-garden'],['deco','quote-row','checkin','apps']]));return true;})()");
// 点击恢复默认行
await ev("(function(){var r=document.getElementById('row-desk-reset');if(r)r.click();return true;})()");
await sleep(300);
const modal1 = await ev(modalVisible);
const pillLabel = await ev("(function(){var p=document.querySelector('#modal-pills .pill');return p?p.textContent:'';})()");
check('恢复默认弹窗已打开', modal1 === true, 'pill=' + pillLabel);
// 不点 pill，直接点底部「确定」
await ev("(function(){var o=document.getElementById('modal-ok');if(o)o.click();return true;})()");
await sleep(300);
const layAfterOk = await ev("(function(){return window.activeStore().get('desk-layout')||null;})()");
check('只点确定后 desk-layout 已被清除（恢复生效）', layAfterOk === null, String(layAfterOk).slice(0, 40));
// 对照：先点 pill 再点确定
await ev("(function(){var r=document.getElementById('row-desk-reset');if(r)r.click();return true;})()");
await sleep(250);
await ev("(function(){var p=document.querySelector('#modal-pills .pill');if(p)p.click();return true;})()");
await sleep(150);
await ev("(function(){var o=document.getElementById('modal-ok');if(o)o.click();return true;})()");
await sleep(300);
const layAfterPill = await ev("(function(){return window.activeStore().get('desk-layout')||null;})()");
check('先点 pill 再点确定 → desk-layout 清除', layAfterPill === null, String(layAfterPill).slice(0, 40));

// ============ Bug 2：装修模式点图标换图 ============
console.log('\n===== Bug2 装修模式点图标换图 =====');
await freshLoad(null);
await ev("(function(){var r=document.getElementById('row-custom-icon');if(r)r.click();return true;})()");
await sleep(300);
const decorOn = await ev("(function(){var p=document.getElementById('page-phone');var g=document.querySelector('.app-grid');return JSON.stringify({decor:p.classList.contains('decor-on'),editing:g.classList.contains('editing'),bar:!document.getElementById('decor-bar').hidden});})()");
check('进入装修模式（decor-on + editing + 装饰条）', decorOn && decorOn.indexOf('"decor":true') >= 0 && decorOn.indexOf('"editing":true') >= 0, decorOn);
// 点击桌面「聊天」图标
await ev("(function(){var app=document.querySelector('.app-grid .app[data-app=\"chat\"]');if(app){app.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));}return true;})()");
await sleep(400);
const iconModal = await ev(modalVisible);
const iconPills = await ev("(function(){return Array.prototype.map.call(document.querySelectorAll('#modal-pills .pill'),function(p){return p.textContent;}).join(',');})()");
check('装修模式点击图标弹出「图标设置」菜单', iconModal === true && String(iconPills).indexOf('上传') >= 0, String(iconPills));
// 关闭菜单
await ev("(function(){var o=document.getElementById('modal-ok');if(o)o.click();return true;})()");
await sleep(250);

// 独立组件图标（被移出 app-grid、挂到页面上的单个图标）：v3.15.x 委托路径
await freshLoad(null);
await ev("(function(){var r=document.getElementById('row-custom-icon');if(r)r.click();return true;})()");
await sleep(300);
// 物理把 chat 图标移出网格，挂到第二页（模拟「添加到此页/拖拽换页」后）
const movedOut = await ev("(function(){var app=document.querySelector('.app[data-app=\"chat\"]');var p2=document.querySelectorAll('.page-slide')[1];if(app&&p2){p2.appendChild(app);}return !!(app&&app.closest('.app-grid')===null);})()");
check('已把 chat 图标移出网格', movedOut === true, String(movedOut));
await ev("(function(){var app=document.querySelector('.app[data-app=\"chat\"]');if(app){app.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));}return true;})()");
await sleep(400);
const iconModal2 = await ev(modalVisible);
const iconPills2 = await ev("(function(){return Array.prototype.map.call(document.querySelectorAll('#modal-pills .pill'),function(p){return p.textContent;}).join(',');})()");
check('移出网格的独立图标点击也能弹「图标设置」', iconModal2 === true && String(iconPills2).indexOf('上传') >= 0, String(iconPills2));

// 上传流程：点「上传图片」pill → 确定 → pickFile 应创建隐藏 file input
await ev("(function(){var ps=document.querySelectorAll('#modal-pills .pill');for(var i=0;i<ps.length;i++){if(ps[i].textContent.indexOf('上传')>=0){ps[i].click();break;}}return true;})()");
await sleep(150);
await ev("(function(){var o=document.getElementById('modal-ok');if(o)o.click();return true;})()");
await sleep(400);
const fileInputN = await ev("(function(){return document.querySelectorAll('input[type=file]').length;})()");
check('确认「上传图片」后已创建 file input（pickFile 触发）', Number(fileInputN) >= 1, 'fileInput=' + fileInputN);
// 清残留 input（防止影响后续 freshLoad）
await ev("(function(){document.querySelectorAll('input[type=file]').forEach(function(i){try{if(i.parentNode)i.parentNode.removeChild(i);}catch(e){}});return true;})()");

// ============ Bug 5 (#219)：背景模糊/遮罩层必须盖在壁纸常驻图层之上 ============
// 回归 v3.26.x（小米15Pro/Chrome 报障「背景模糊和背景遮罩功能用不了，调整了数据背景没有
// 变化」，用户明说其他机型也有）：#147 壁纸改画到常驻图层 #phone-bg-layer（z-index:1）
// 后，.phone-bg-mask（原 z-index:0）被压在壁纸下面——白遮罩被盖=调遮罩无感，
// backdrop-filter 向下采样不含壁纸=调模糊也无感。修复：遮罩层 z-index:0→2。
console.log('\n===== Bug5 (#219) 背景模糊/遮罩层级 =====');
await freshLoad(null);
// M1 静态层级：.phone-bg-mask 计算 zIndex 必须 > #phone-bg-layer 的 zIndex
const zInfo = await ev("(function(){var m=document.querySelector('.phone-bg-mask');var l=document.getElementById('phone-bg-layer');if(!m)return 'no-mask';var zi=parseInt(getComputedStyle(m).zIndex,10);var zl=l?parseInt(getComputedStyle(l).zIndex,10):0;return JSON.stringify({zi:zi,zl:zl});})()");
try { var zObj = JSON.parse(zInfo); } catch (e) { var zObj = { zi: 0, zl: 0 }; }
check('M1 遮罩层 zIndex(' + zObj.zi + ') > 壁纸图层 zIndex(' + zObj.zl + ')（#219 核心）', zObj.zi > zObj.zl, zInfo);
// M2 模糊生效（#240 起载体=壁纸层自滤）：预置 bg-blur=12 重载 → .desk-blur-on 挂上、壁纸层 computed filter 含 blur（旧 backdrop 载体在小米15Pro/Chrome 151 真机采样不生效，已由 #240 替代）
await ev("(function(){var s=window.activeStore();s.set('bg-blur','12');return true;})()");
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2000);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(250); }
await ev("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
await sleep(800);
const blurInfo = await ev("(function(){var p=document.querySelector('.phone');var l=document.getElementById('phone-bg-layer');if(!p||!l)return 'no-layer';var c=getComputedStyle(l);return JSON.stringify({blurOn:p.classList.contains('desk-blur-on'),bf:c.filter||''});})()");
try { var bObj = JSON.parse(blurInfo); } catch (e) { var bObj = { blurOn: false, bf: '' }; }
check('M2 bg-blur=12 时 .desk-blur-on 挂上且壁纸层 filter 激活（#240 新载体）', bObj.blurOn === true && String(bObj.bf).indexOf('blur') >= 0, blurInfo);
// M3 遮罩生效：预置 bg-mask-op=60 重载 → 遮罩层背景 alpha≈0.6（半透明白真盖在壁纸上=背景变淡）
await ev("(function(){var s=window.activeStore();s.set('bg-mask-op','60');return true;})()");
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2000);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(250); }
await ev("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
await sleep(800);
const maskInfo = await ev("(function(){var m=document.querySelector('.phone-bg-mask');if(!m)return 'no-mask';var c=getComputedStyle(m).backgroundColor;var mt=c.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);return JSON.stringify({bg:c,a:mt?parseFloat(mt[4]||'1'):1});})()");
try { var mkObj = JSON.parse(maskInfo); } catch (e) { var mkObj = { a: 0 }; }
check('M3 bg-mask-op=60 时遮罩 alpha≈0.6（白遮罩真盖在壁纸上）', mkObj.a > 0.55 && mkObj.a < 0.65, maskInfo);

// ============ Bug 4：应用美化方案（桌面，只点底部确定） ============
console.log('\n===== Bug4 应用桌面美化方案（只点底部确定）=====');
await freshLoad(null);
// 预置一个方案：data.__theme__='dark' 会在应用时写 localStorage xy-home-v2:theme-mode
// 注意：beauty-schemes 是全局键（xy-home-v2:beauty-schemes），getSchemes() 走 gStore=xyStore('xy-home-v2')，
// 不能写进 activeStore() 的联系人命名空间（xy-home-v2:<cid>:），否则方案管理读不到、找不到「应用」按钮。
await ev("(function(){var g=window.xyStore('xy-home-v2');g.set('beauty-schemes',JSON.stringify([{name:'测试方案',data:{__theme__:'dark'}}]));return true;})()");
await ev("(function(){var r=document.getElementById('row-beauty-schemes');if(r)r.click();return true;})()");
await sleep(400);
const applyBtnN = await ev("(function(){var btns=Array.prototype.slice.call(document.querySelectorAll('#beauty-scheme-manager button'));var ab=btns.filter(function(b){return b.textContent.indexOf('应用')===0;})[0];if(ab)ab.click();return !!ab;})()");
check('方案管理打开且找到「应用」按钮', applyBtnN === true, 'applyBtn=' + applyBtnN);
await sleep(300);
const applyModalOn = await ev(modalVisible);
const applyPill = await ev("(function(){var p=document.querySelector('#modal-pills .pill');return p?p.textContent:'';})()");
check('应用确认弹窗已打开（单 pill「应用」）', applyModalOn === true && String(applyPill).indexOf('应用') >= 0, 'pill=' + applyPill);
// 不点 pill，直接点底部「确定」
await ev("(function(){var o=document.getElementById('modal-ok');if(o)o.click();return true;})()");
await sleep(300);
const themeAfterOk = await ev("(function(){return localStorage.getItem('xy-home-v2:theme-mode')||'';})()");
const mgrClosed = await ev("(function(){var m=document.getElementById('beauty-scheme-manager');return !m||m.hidden||m.style.display==='none';})()");
check('只点确定 → 方案已应用（theme-mode=dark）', String(themeAfterOk) === 'dark', 'theme=' + themeAfterOk);
check('应用后方案管理弹层已关闭', mgrClosed === true, 'mgrClosed=' + mgrClosed);

console.log('\n===== 汇总 =====');
const fails = results.filter(r => !r.ok);
console.log('PASS ' + (results.length - fails.length) + ' / ' + results.length + (fails.length ? '，失败 ' + fails.length + ' 项' : ''));
process.exit(fails.length ? 1 : 0);
