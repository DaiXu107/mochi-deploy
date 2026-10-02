// #769 底部导航栏美化（三按钮上传图标图片 + 栏透明度/底色/圆角/模糊/图标大小）行为验证
// 测构建产物 index.html（先 node build.mjs；或 SERVE_ROOT 指向隔离构建根跑 RED 基线）。
// 图片选择器无法在无头环境真弹相册，「上传链」用 activeStore 注键 + contact-switched 重刷
// 走与上传成功后完全相同的渲染函数（paintTabIcon / applyTabbarStyle），断言观感与防线。
// 用法：node build.mjs && node tools/verify-tabbar-beauty.mjs
// 用法（RED 基线）：SERVE_ROOT=<HEAD 隔离根> node tools/verify-tabbar-beauty.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.SERVE_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+（内置 WebSocket）'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vttb-' + Date.now()),
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
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };
const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2600);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;s.style.display='none';}return true;})()");
await sleep(700);

// ---- T1 设置页入口行在位；点击＝唤起边看边调并停在「底部栏」分区（改哪看哪）----
const t1 = J(await evalJs(`(function(){
  var row=document.getElementById('row-tabbar-beauty');if(!row)return JSON.stringify({err:'no-row'});
  row.click();
  var d=document.getElementById('beauty-drawer');
  var chip=d&&d.querySelector('[data-sec="tabbar"]');
  var on=chip&&chip.style.borderColor&&chip.style.borderColor.indexOf('rgb')>=0;
  return JSON.stringify({drawer:!!(d&&d.getClientRects().length>0),desk:!document.getElementById('page-phone').hidden,chip:!!chip});
})()`));
ok(t1.drawer === true && t1.desk === true && t1.chip === true,
  'T1 「底部栏美化」行→抽屉打开且切到桌面、「底部栏」分区胶囊在位', JSON.stringify(t1));

// ---- T2 分区控件齐全：3 上传按钮 + 5 滑杆 + 颜色块 + 恢复默认 ----
const t2 = J(await evalJs(`(function(){
  var d=document.getElementById('beauty-drawer');if(!d)return JSON.stringify({err:'no-drawer'});
  var txt=d.innerText||'';
  return JSON.stringify({
    up:['首页','字卡','设置'].every(function(n){return txt.indexOf(n+'按钮图片')>=0;}),
    s1:txt.indexOf('图片透明度')>=0,s2:txt.indexOf('背景透明度')>=0,s3:txt.indexOf('整栏透明度')>=0,
    s4:txt.indexOf('栏圆角')>=0,s5:txt.indexOf('背景模糊')>=0,s6:txt.indexOf('图标大小')>=0,
    col:txt.indexOf('栏背景色')>=0,rst:txt.indexOf('恢复底部栏默认')>=0,
    ranges:d.querySelectorAll('input[type=range]').length});
})()`));
ok(t2.up === true && t2.s1 && t2.s2 && t2.s3 && t2.s4 && t2.s5 && t2.s6 && t2.col && t2.rst && t2.ranges >= 6,
  'T2 「底部栏」分区控件齐全（3 上传按钮 + 图片/背景/整栏透明度 + 圆角/模糊/图标大小滑杆 + 栏背景色 + 恢复默认）', JSON.stringify(t2));

// ---- T3 注键模拟上传成功→渲染链：img 顶上、svg 隐藏、图片透明度只作用 img ----
const t3 = J(await evalJs(`(function(){
  var s=window.activeStore();
  s.set('tab-icon-page-phone', ${JSON.stringify(PNG1)});
  s.set('tab-icon-opacity', '30');
  document.dispatchEvent(new Event('contact-switched'));
  var tab=document.querySelector('.tabbar .tab[data-page="page-phone"]');
  var svg=tab.querySelector('svg'), img=tab.querySelector('img');
  var otherTab=document.querySelector('.tabbar .tab[data-page="page-setting"]');
  return JSON.stringify({
    img:!!img, src:!!img&&img.src.indexOf('data:image/png')===0,
    svgHidden:!!svg&&svg.style.display==='none',
    imgOp:img?getComputedStyle(img).opacity:'',
    svgOp:otherTab&&otherTab.querySelector('svg')?getComputedStyle(otherTab.querySelector('svg')).opacity:'',
    tabOp:otherTab?getComputedStyle(otherTab).opacity:''});
})()`));
ok(t3.img === true && t3.src === true && t3.svgHidden === true && Math.abs(parseFloat(t3.imgOp) - 0.3) < 0.01,
  'T3 自定义图片渲染链（img 顶上 + svg 隐藏 + 图片透明度 30% 作用到 img）', JSON.stringify(t3));
ok(t3.tabOp === '1',
  'T3b 默认 SVG 按钮不受「图片透明度」影响（applyAppIconOpacity 同口径，误伤＝线框图标集体变淡）', JSON.stringify(t3));

// ---- T4 整栏透明度防线：拉到 0，背景全透但图标保 12% 下限 + faint 显形类 ----
// 注：.tab 有 opacity .18s transition，同帧 getComputedStyle 可能读到动画起点值——先过完渡
await evalJs(`(function(){
  var s=window.activeStore();
  s.set('tabbar-whole-op', '0');
  document.dispatchEvent(new Event('contact-switched'));
  return true;
})()`);
await sleep(450);
const t4 = J(await evalJs(`(function(){
  var bar=document.querySelector('.tabbar');
  var tab=document.querySelector('.tabbar .tab[data-page="page-setting"]');
  return JSON.stringify({
    icoOp:getComputedStyle(tab).opacity,
    icoVar:getComputedStyle(document.documentElement).getPropertyValue('--tabbar-ico-a').trim(),
    bgA:getComputedStyle(document.documentElement).getPropertyValue('--tabbar-bg-a').trim(),
    faint:bar.classList.contains('tabbar-faint')});
})()`));
ok(t4.icoOp === '0.12' && t4.bgA === '0' && t4.faint === true,
  'T4 整栏透明度=0 时背景全透、图标仍留 12% 下限、挂 tabbar-faint（防「栏消失找不回」双保险第一道）', JSON.stringify(t4));

// ---- T5 背景透明度叠乘 + 模糊挂类 ----
await evalJs(`(function(){
  var s=window.activeStore();
  s.remove('tabbar-whole-op'); s.set('tabbar-bg-op', '50'); s.set('tabbar-blur', '8');
  document.dispatchEvent(new Event('contact-switched'));
  return true;
})()`);
await sleep(450);
const t5 = J(await evalJs(`(function(){
  var bar=document.querySelector('.tabbar');
  return JSON.stringify({
    bgA:getComputedStyle(document.documentElement).getPropertyValue('--tabbar-bg-a').trim(),
    icoOp:getComputedStyle(bar.querySelector('.tab')).opacity,
    blur:bar.classList.contains('tabbar-blur-on'),
    blurVar:getComputedStyle(document.documentElement).getPropertyValue('--tabbar-blur').trim()});
})()`));
ok(t5.bgA === '0.5' && t5.icoOp === '1' && t5.blur === true && t5.blurVar === '8px',
  'T5 「背景透明度」只稀释底色（图标恒 1）；模糊>0 挂 tabbar-blur-on 并写 --tabbar-blur', JSON.stringify(t5));

// ---- T6 图标大小/圆角逐变量 + 触摸显形规则在样式表（:active 无法无头按压，查规则存在）----
const t6 = J(await evalJs(`(function(){
  var s=window.activeStore();
  s.set('tabbar-icon-size', '30'); s.set('tabbar-radius', '10');
  document.dispatchEvent(new Event('contact-switched'));
  var svg=document.querySelector('.tabbar .tab svg');
  var sheetOn=[...document.styleSheets].some(function(sh){
    try{return [...sh.cssRules].some(function(r){return (r.cssText||'').indexOf('.tabbar.tabbar-faint:active .tab')>=0;});}catch(e){return false;}
  });
  return JSON.stringify({svgW:svg?getComputedStyle(svg).width:'',
    radius:getComputedStyle(document.querySelector('.tabbar')).borderRadius,
    sheetOn:sheetOn});
})()`));
ok(t6.svgW === '30px' && t6.radius.indexOf('10px') === 0 && t6.sheetOn === true,
  'T6 图标大小/栏圆角即时生效 + tabbar-faint 触摸显形规则在样式表（按压瞬间图标全可见）', JSON.stringify(t6));

// ---- T7 换图后路由不受影响：点字卡/设置按钮照切页 ----
const t7 = J(await evalJs(`(function(){
  document.querySelector('.tabbar .tab[data-page="page-chatcard"]').click();
  var a=!document.getElementById('page-chatcard').hidden && document.getElementById('page-phone').hidden;
  document.querySelector('.tabbar .tab[data-page="page-setting"]').click();
  var b=!document.getElementById('page-setting').hidden;
  return JSON.stringify({a:a,b:b});
})()`));
ok(t7.a === true && t7.b === true, 'T7 底部栏换图/换样式后三按钮路由零影响（tabs.js data-page 契约）', JSON.stringify(t7));

// ---- T8 reload 持久化（boot 期 restoreTabbarIcons 从 LS 副本还原全部观感）----
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2400);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;s.style.display='none';}return true;})()");
await sleep(700);
const t8 = J(await evalJs(`(function(){
  var tab=document.querySelector('.tabbar .tab[data-page="page-phone"]');
  var svg=tab.querySelector('svg'), img=tab.querySelector('img');
  return JSON.stringify({img:!!img, svgHidden:!!svg&&svg.style.display==='none',
    size:getComputedStyle(document.querySelector('.tabbar .tab svg')).width,
    blur:document.querySelector('.tabbar').classList.contains('tabbar-blur-on')});
})()`));
ok(t8.img === true && t8.svgHidden === true && t8.size === '30px' && t8.blur === true,
  'T8 重开 App 后底部栏自定义完整还原（图片/图标大小/模糊，无需重新上传）', JSON.stringify(t8));

// ---- T9 抽屉「恢复底部栏默认」一键清空（img 移除、svg 复位、变量与类全清、键清）----
const t9 = J(await evalJs(`(function(){
  document.getElementById('row-tabbar-beauty').click();
  var d=document.getElementById('beauty-drawer');
  var rst=[...d.querySelectorAll('button')].find(function(b){return b.textContent==='恢复底部栏默认';});
  if(!rst)return JSON.stringify({err:'no-rst'});
  rst.click();
  var tab=document.querySelector('.tabbar .tab[data-page="page-phone"]');
  var svg=tab.querySelector('svg');
  var rs=getComputedStyle(document.documentElement);
  var leftover=Object.keys(localStorage).filter(function(k){return k.indexOf('tab-icon')>=0||k.indexOf('tabbar-')>=0;}).length;
  return JSON.stringify({img:!!tab.querySelector('img'),svgShown:!!svg&&svg.style.display==='',
    bgVar:rs.getPropertyValue('--tabbar-bg-a').trim(),icoVar:rs.getPropertyValue('--tabbar-ico-a').trim(),
    faint:document.querySelector('.tabbar').classList.contains('tabbar-faint'),
    blur:document.querySelector('.tabbar').classList.contains('tabbar-blur-on'), leftover:leftover});
})()`));
ok(t9.err==null && t9.img === false && t9.svgShown === true && t9.bgVar === '' && t9.icoVar === '' && t9.faint === false && t9.blur === false && t9.leftover === 0,
  'T9 「恢复底部栏默认」清空整族键+变量+类，默认 SVG 图标复位', JSON.stringify(t9));

console.log('\\n#769 底部导航栏美化：' + pass + ' PASS / ' + fail + ' FAIL');
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
