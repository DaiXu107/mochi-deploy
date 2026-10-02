// ===== 专项验证：群聊设置「美化聊天」升成独立顶部 tag + 完整美化（含边看边调）（v3.34.x #697） =====
// 需求（用户原话）：「你要设置里的美化聊天功能没有在顶部变成单独tag，而且没有和聊天里一样的，
//   完整的美化功能包括边看边调功能。」（确认过＝群聊设置面板）
// 用例组：
//   A 源码锚：美化 tag 进 GTABS、renderBeautyView(host)、切 tag 记忆、边看边调入口/抽屉、
//             新增三组键（气泡透明度/栏位不透明度/位置微调）、CSS 作用域规则
//   B 运行时（无头 Chrome 走自组装 src 页）：
//     B1 顶部七个 tag（#794 起含成员/群聊）；B2 点「美化」tag 出美化段 + 边看边调入口；B3 新增行都在；
//     B4 改值后面板重建仍停在「美化」（不弹回形象）；
//     B5 点边看边调 → 设置面板收起 + 底部抽屉出现；B6 三胶囊；
//     B7 气泡透明度滑杆 → 气泡底色变 rgba + 落库；
//     B8 栏位下移滑杆 → --cs-head-inset + 留白 ::before 真的增高（参与 flex 布局）；
//     B9 ✕ 关抽屉；E 零 JS 异常
// 用法：
//   node tools/verify-gc-beauty-tag.mjs          # GREEN（对 src）
//   node tools/verify-gc-beauty-tag.mjs --red    # RED 判别力基线（把本批代码抠掉）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const RED = process.argv.includes('--red');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
let cssFiles = [], jsFiles = [];
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  cssFiles = (bm.match(/const cssFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  jsFiles = (bm.match(/const jsFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}
// --red：还原「美化只是通用 tag 下一行、没有独立 tag / 没有边看边调 / 没有栏位三组」的修前形态
const overrides = {};
if (RED) {
  const gcs = readFileSync(join(root, 'src/js/group-chat.js'), 'utf8');
  const tabsNew = "[['profile', '形象'], ['members', '成员'], ['group', '群聊'], ['reply', '回复'], ['beauty', '美化'], ['general', '通用'], ['data', '数据']]";
  const tabsOld = "[['profile', '形象'], ['members', '成员'], ['group', '群聊'], ['reply', '回复'], ['general', '通用'], ['data', '数据']]";
  if (gcs.indexOf(tabsNew) < 0) { console.error('RED 模式：group-chat.js 里找不到 #697 的 GTABS'); process.exit(1); }
  let red = gcs.replace(tabsNew, tabsOld);
  red = red.replace('rootEl.insertBefore(liveBtn, rootEl.firstChild);', '/* red: 入口摘掉 */');
  red = red.replace(/if \(gcSetTab === 'beauty' && !secs\.beauty\.innerHTML\) renderBeautyView\(secs\.beauty\);/, '');
  overrides['group-chat.js'] = red;
  const gcss = readFileSync(join(root, 'src/css/group-chat.css'), 'utf8');
  overrides['group-chat.css'] = gcss
    .replace('#page-group-chat::before { height:var(--cs-head-inset, 0px); }', '')
    .replace('#page-group-chat > .chat-head { background:rgba(var(--cs-bar-rgb), var(--cs-head-opacity, .92)); }', '');
}
const gsSrc = overrides['group-chat.js'] !== undefined ? overrides['group-chat.js'] : readFileSync(join(root, 'src/js/group-chat.js'), 'utf8');
const gcssSrc = overrides['group-chat.css'] !== undefined ? overrides['group-chat.css'] : readFileSync(join(root, 'src/css/group-chat.css'), 'utf8');

let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => {
  const src = overrides[f] !== undefined ? overrides[f] : readFileSync(join(root, 'src/js', f), 'utf8');
  return '(function () { try {\n' + src + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
}).join('\n'));
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => {
  const src = overrides[f] !== undefined ? overrides[f] : readFileSync(join(root, 'src/css', f), 'utf8');
  return src;
}).join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-gc-beauty-tag' + (RED ? '-red' : '')).split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-gcb-' + Date.now());
const profDir = join(process.env.TEMP || '/tmp', 'mochi-gcb-prof-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/__seed') { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end('<!doctype html><title>seed</title>'); return; }
    let p = normalize(join(tmpRoot, rel));
    if (!p.startsWith(tmpRoot)) { res.writeHead(403); res.end(); return; }
    let hit = false;
    try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) { p = normalize(join(root, rel)); if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; } try { hit = statSync(p).isFile(); } catch (e) {} }
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profDir, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  + ' + name); }
  else { fail++; console.log('  x ' + name + (extra !== undefined ? ' -- ' + JSON.stringify(extra) : '')); }
}

console.log('== A 源码锚（' + (RED ? 'RED 覆盖后' : 'src') + '） ==');
ok('A1 GTABS 含独立「美化」tag', gsSrc.indexOf("['beauty', '美化']") >= 0);
ok('A2 renderBeautyView(host) 支持渲染进 tag 段', gsSrc.indexOf('function renderBeautyView(host)') >= 0 && gsSrc.indexOf('const rootEl = host || settingsBody;') >= 0);
ok('A3 切 tag 记忆（gcSetTab）改值重建不弹回形象', gsSrc.indexOf('gcSetTab = tab.dataset.gt;') >= 0 && gsSrc.indexOf("if (t[0] !== gcSetTab) s.hidden = true;") >= 0);
ok('A4 边看边调入口 + 底部抽屉（与单聊 #673 同款）', gsSrc.indexOf('gc-live-adjust') >= 0 && gsSrc.indexOf('function openGcBeautyDrawer()') >= 0 && gsSrc.indexOf("hdTxt.textContent = '边看边调（即时生效）';") >= 0);
ok('A5 新增三组键进默认值与方案键清单', gsSrc.indexOf("'bubble-op': 100, 'head-op': 92, 'input-op': 92, 'head-inset': 0, 'input-inset': 0,") >= 0
  && gsSrc.indexOf("'bubble-op', 'head-op', 'input-op', 'head-inset', 'input-inset',") >= 0);
ok('A6 applyGcBeauty 输出 --cs-* 栏位变量', ['--cs-head-opacity', '--cs-input-opacity', '--cs-head-inset', '--cs-input-inset'].every(v => gsSrc.indexOf("setProperty('" + v + "'") >= 0));
ok('A7 气泡透明度→rgba 写回底色变量', gsSrc.indexOf('function gcApplyBubbleSurfaceWith(op)') >= 0 && gsSrc.indexOf("'rgba(' + rgb.join(',') + ','") >= 0);
ok('A8 CSS 作用域规则（留白 + 顶/底栏底色）', gcssSrc.indexOf('#page-group-chat::before { height:var(--cs-head-inset, 0px); }') >= 0
  && gcssSrc.indexOf('#page-group-chat > .chat-head { background:rgba(var(--cs-bar-rgb), var(--cs-head-opacity, .92)); }') >= 0
  && gcssSrc.indexOf('#page-group-chat > .chat-input-row { background:rgba(var(--cs-bar-rgb), var(--cs-input-opacity, .92)); }') >= 0);
ok('A9 「通用」里「美化聊天」入口切到「美化」tag（#816：旧 gcBeautyView 子视图已退役，全站只剩美化 tag 一套）',
  gsSrc.indexOf("bRow.addEventListener('click', () => { gcSetTab = 'beauty'; renderSettingsPanel(); });") >= 0
  && gsSrc.indexOf('gcBeautyView = true') < 0 && gsSrc.indexOf("let gcBeautyView") < 0);

await cdpConnect();
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
const SEED = `(function () {
  localStorage.clear();
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{ id: 'default', name: '宝贝' }, { id: 'cta', name: '小桃' }]));
  localStorage.setItem('xy-home-v2:active-contact', 'cta');
  return true;
})()`;
await cdp('Page.navigate', { url: 'about:blank' });
await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'all' });
await cdp('Page.navigate', { url: baseUrl + '/__seed' });
await sleep(600);
await evalJs(SEED);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }

// 打开群聊页 + 群聊设置面板（直接显示页面，不依赖桌面导航）
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-group-chat');});return 1;})()");
await evalJs("(function(){var el=document.getElementById('gc-more-settings');if(el){el.click();return 1;}return 0;})()");
await sleep(500);

console.log('== B 顶部 tag 与美化段 ==');
const b1 = await evalJs("(function(){var b=document.getElementById('gc-set-body');if(!b)return null;return {open:!document.getElementById('gc-settings-panel').hidden,tabs:Array.from(b.querySelectorAll('.gc-set-tabs .them-tab')).map(function(t){return t.textContent;}),vis:Array.from(b.querySelectorAll('.gc-set-sec')).filter(function(s){return !s.hidden;}).map(function(s){return s.dataset.gt;})};})()");
ok('B1 面板打开 + 顶部七个 tag（#794 起：形象/成员/群聊/回复/美化/通用/数据），「美化」仍在顶部',
  !!(b1 && b1.open && b1.tabs.join('/') === '形象/成员/群聊/回复/美化/通用/数据' && b1.tabs.indexOf('美化') >= 0), b1);
ok('B1b 默认仍显示「形象」段（不改变进面板落点）', !!(b1 && b1.vis.join() === 'profile'), b1);

const b2 = await evalJs("(function(){var t=document.querySelector('#gc-set-body .gc-set-tabs .them-tab[data-gt=\"beauty\"]');if(!t)return null;t.click();return 1;})()");
await sleep(250);
const b2r = await evalJs("(function(){var s=document.querySelector('#gc-set-body .gc-set-sec[data-gt=\"beauty\"]');if(!s)return null;return {hidden:s.hidden,live:!!document.getElementById('gc-live-adjust'),text:(s.textContent||'')};})()");
ok('B2 点「美化」tag → 美化段显示且有「边看边调」入口', !!(b2 && b2r && b2r.hidden === false && b2r.live === true), b2r && b2r.live);
ok('B3 美化段含新增三组行（气泡透明度/顶栏·底栏不透明度/顶栏下移/底栏上移）',
  !!(b2r && ['气泡透明度', '顶栏不透明度', '底栏不透明度', '顶栏下移', '底栏上移'].every(s => b2r.text.indexOf(s) >= 0)), b2r && b2r.text);

console.log('== C 改值重建仍停在「美化」 ==');
await evalJs("(function(){var s=document.querySelector('#gc-set-body .gc-set-sec[data-gt=\"beauty\"]');if(!s)return 0;var rows=Array.from(s.querySelectorAll('.set-row'));var r=rows.find(function(x){return x.innerText.indexOf('时间轴样式')>=0;});if(r){r.click();return 1;}return 0;})()");
await sleep(300);
await evalJs("(function(){var m=document.getElementById('tc-mask')||document.querySelector('#modal-mask');var bs=Array.from(document.querySelectorAll('.pill,.cc-pill,.tc-pill,button')).filter(function(b){return b.textContent.trim()==='隐藏';});if(bs.length){bs[0].click();return 1;}return 0;})()");
await sleep(400);
const c1 = await evalJs("(function(){var active=document.querySelector('#gc-set-body .gc-set-tabs .them-tab.active');var s=document.querySelector('#gc-set-body .gc-set-sec[data-gt=\"beauty\"]');return {tab:active?active.textContent:null,hidden:s?s.hidden:null,store:(window.xyStore?window.xyStore('xy-home-v2').get('gc-beauty'):'')||''};})()");
ok('C1 改完设置项 → 面板重建后 active tag 仍是「美化」（不弹回形象）', !!(c1 && c1.tab === '美化' && c1.hidden === false), c1);

console.log('== D 边看边调抽屉 ==');
await evalJs("(function(){var b=document.getElementById('gc-live-adjust');if(b){b.click();return 1;}return 0;})()");
await sleep(350);
const d1 = await evalJs("(function(){var d=document.getElementById('gc-beauty-drawer');var p=document.getElementById('gc-settings-panel');return {panel:p?p.hidden:null,drawer:!!d,disp:d?getComputedStyle(d).display:null,title:d&&d.children[1]?d.children[1].textContent:''};})()");
ok('D1 点入口 → 设置面板收起（群聊露出）+ 底部抽屉 display:flex', !!(d1 && d1.panel === true && d1.drawer && d1.disp === 'flex'), d1);
ok('D2 抽屉标题＝边看边调（即时生效）', !!(d1 && d1.title && d1.title.indexOf('边看边调（即时生效）') >= 0), d1 && d1.title);
const d3 = await evalJs("(function(){var d=document.getElementById('gc-beauty-drawer');var chips=Array.from(d.querySelectorAll('button[data-sec]')).map(function(c){return c.textContent;});return {n:chips.length,labels:chips};})()");
ok('D3 三个分区胶囊（气泡/栏位/字体 · 其他）', !!(d3 && d3.n === 3 && d3.labels.join('/') === '气泡/栏位/字体 · 其他'), d3);

const SET_SLIDER = (label, val) => `(function(){ var d=document.getElementById('gc-beauty-drawer'); if(!d) return null;
  var rs=d.querySelectorAll('input[type=range]');
  for (var i=0;i<rs.length;i++){ var lb=rs[i].parentNode.querySelector('span');
    if(lb && lb.textContent===${JSON.stringify(label)}){ rs[i].value='${val}'; rs[i].dispatchEvent(new Event('input',{bubbles:true})); return rs[i].value; } }
  return null; })()`;

// D4：气泡透明度 → 气泡底色变 rgba（真计算样式），且落库
const s4 = await evalJs(SET_SLIDER('气泡透明度', 30));
await sleep(200);
const d4 = await evalJs("(function(){var p=document.getElementById('page-group-chat');var probe=document.createElement('div');probe.className='msg msg-in';probe.innerHTML='<div class=\"msg-bubble\">x</div>';probe.style.position='absolute';probe.style.left='-9999px';p.appendChild(probe);var bg=getComputedStyle(probe.querySelector('.msg-bubble')).backgroundColor;probe.remove();var raw=(window.xyStore?window.xyStore('xy-home-v2').get('gc-beauty'):'{}')||'{}';var o={};try{o=JSON.parse(raw);}catch(e){}return {varv:p.style.getPropertyValue('--msg-in-bg'),bg:bg,stored:o['bubble-op']};})()");
ok('D4 气泡透明度滑杆 30% → --msg-in-bg / 真实气泡底色都是 0.3 alpha（改哪看哪）',
  s4 === '30' && !!(d4 && /^rgba\(255,\s*255,\s*255,\s*0?\.3\)$/.test(d4.bg) && d4.stored === 30), { s4, d4 });

// D5：切「栏位」→ 顶栏下移 20px → 留白 ::before 真增高（参与 flex 布局）+ 底色变量
const secBar = await evalJs("(function(){var d=document.getElementById('gc-beauty-drawer');var c=d.querySelector('button[data-sec=\"bar\"]');if(c){c.click();return true;}return false;})()");
await sleep(200);
const s5 = await evalJs(SET_SLIDER('顶栏下移', 20));
await sleep(200);
const d5 = await evalJs("(function(){var p=document.getElementById('page-group-chat');var before=getComputedStyle(p,'::before');return {varv:p.style.getPropertyValue('--cs-head-inset'),h:before.height,disp:before.display};})()");
ok('D5 「栏位」下移滑杆 20px → --cs-head-inset=20px 且 ::before 留白高度=20px（消息区随之缩短）',
  secBar === true && s5 === '20' && !!(d5 && d5.varv === '20px' && d5.h === '20px'), { s5, d5 });

const s6 = await evalJs(SET_SLIDER('顶栏不透明度', 0));
await sleep(200);
const d6 = await evalJs("(function(){var p=document.getElementById('page-group-chat');var head=p.querySelector('.chat-head');return {varv:p.style.getPropertyValue('--cs-head-opacity'),bg:getComputedStyle(head).backgroundColor,stored:(function(){try{return JSON.parse((window.xyStore?window.xyStore('xy-home-v2').get('gc-beauty'):'{}')||'{}')['head-op'];}catch(e){return null;}})()};})()");
ok('D6 顶栏不透明度 0% → 顶栏底色透明（rgba(...,0)）且落库', s6 === '0' && !!(d6 && /,\s*0\)$/.test(d6.bg || '') && d6.stored === 0), { s6, d6 });

console.log('== E 关闭与健康 ==');
const e1 = await evalJs("(function(){var d=document.getElementById('gc-beauty-drawer');var bs=d.querySelectorAll('button');for(var i=0;i<bs.length;i++){if(bs[i].textContent==='\u2715'){bs[i].click();return true;}}return false;})()");
await sleep(350);
const e1r = await evalJs("(function(){var d=document.getElementById('gc-beauty-drawer');var p=document.getElementById('gc-settings-panel');var a=document.querySelector('#gc-set-body .gc-set-tabs .them-tab.active');return {disp:d?getComputedStyle(d).display:null,panel:p?!p.hidden:null,tab:a?a.textContent:null,store:(window.xyStore?window.xyStore('xy-home-v2').get('gc-beauty'):'')||''};})()");
ok('E1 ✕ 关抽屉 → 回群聊设置「美化」tag（设置仍在位，不是关掉就回默认）', e1 === true && !!(e1r && e1r.disp === 'none' && e1r.panel === true && e1r.tab === '美化' && e1r.store.indexOf('bubble-op') >= 0), e1r);
const e2 = await evalJs("(function(){return (window.__jsErrors||[]).slice(0,5);})()");
ok('E2 全程零 JS 异常', Array.isArray(e2) && e2.length === 0, e2);
// E3：#376 口径不变——关面板再开回到「形象」（独立 tag 也要复位，别停在美化）
await evalJs("(function(){var b=document.getElementById('gc-set-close');if(b){b.click();return 1;}return 0;})()");
await sleep(250);
await evalJs("(function(){var el=document.getElementById('gc-more-settings');if(el){el.click();return 1;}return 0;})()");
await sleep(400);
const e3 = await evalJs("(function(){var a=document.querySelector('#gc-set-body .gc-set-tabs .them-tab.active');return a?a.textContent:null;})()");
ok('E3 关面板重开回到「形象」（#376 口径不变，不残留在美化 tag）', e3 === '形象', e3);

console.log('\n' + (RED ? '[RED 基线] ' : '') + '通过 ' + pass + ' / 失败 ' + fail);
try { chrome.kill(); } catch (e) {}
try { rmSync(tmpRoot, { recursive: true, force: true }); rmSync(profDir, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
