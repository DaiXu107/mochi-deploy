// ===== 专项验证：群聊设置「莫名其妙设计」清一批（#816） =====
// 需求（用户原话）：「你检查一下有没有莫名其妙的设计？」→ 审计 5 点 → 「帮我修复。全部都要修」
// 用例组：
//   A 源码锚：旧子视图链路清零（gcBeautyView/gc-set-back）、入口新 handler、应用收预览条、
//             标题带群名、字卡说明在回复段、菜单节点摘除
//   B 运行时（无头 Chrome 走自组装 src 页；种子：自定义群「测试群」为当前群）：
//     B1 面板标题 =「群聊设置 · 测试群」；
//     B2 「通用」→点「美化聊天」→ 落在「美化」tag、无返回条、有边看边调；
//     B3 「字卡来源」说明在「回复」tag、不在「通用」tag；
//     B4 三点菜单只剩「群聊设置」；
//     B5 预览 A 不结账 → 应用后预览条被收掉（预览/应用不打架）；
//     C 零 JS 异常
// 用法：node tools/verify-gc-set-coherence.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
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
const gsSrc = readFileSync(join(root, 'src/js/group-chat.js'), 'utf8');

let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => {
  const src = readFileSync(join(root, 'src/js', f), 'utf8');
  return '(function () { try {\n' + src + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
}).join('\n'));
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-gc-set-coherence').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-gccoh-' + Date.now());
const profDir = join(process.env.TEMP || '/tmp', 'mochi-gccoh-prof-' + Date.now());
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9500 + Math.floor(Math.random() * 90));
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

console.log('== A 源码锚（src/js/group-chat.js） ==');
ok('A1 旧子视图清零（无 gcBeautyView 赋值/声明、无返回条）', gsSrc.indexOf('gcBeautyView = true') < 0
  && gsSrc.indexOf('let gcBeautyView') < 0 && gsSrc.indexOf('gc-set-back') < 0);
ok('A2 「美化聊天」入口真切美化 tag', gsSrc.indexOf("bRow.addEventListener('click', () => { gcSetTab = 'beauty'; renderSettingsPanel(); });") >= 0);
ok('A3 应用方案时收掉预览条并清暂存', gsSrc.indexOf('应用时收掉可能挂着的「预览」条并清暂存') >= 0
  && gsSrc.indexOf("gcPreviewBackup = null;") >= 0 && gsSrc.indexOf("getElementById('gc-beauty-preview-bar')") >= 0);
ok('A4 面板标题带自定义群名（default 群不叠字）', gsSrc.indexOf("curGid !== 'default' && gName ? '群聊设置 · ' + gName : '群聊设置'") >= 0);
ok('A5 字卡来源说明只在回复段（全文恰一次、且在继续说说明之后）',
  gsSrc.split('成员回复内容来自').length === 2
  && gsSrc.indexOf('成员回复内容来自') > gsSrc.indexOf("csNote.textContent = '点顶部昵称（群名）"));
ok('A6 三点菜单节点 JS 摘除', gsSrc.indexOf('if (moreMembers) moreMembers.remove();') >= 0 && gsSrc.indexOf('if (moreGroups) moreGroups.remove();') >= 0);

await cdpConnect();
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
const SEED = `(function () {
  localStorage.clear();
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{ id: 'default', name: '宝贝' }, { id: 'cta', name: '小桃' }]));
  localStorage.setItem('xy-home-v2:active-contact', 'cta');
  localStorage.setItem('xy-home-v2:gc-groups', JSON.stringify([{ id: 'gtest1', name: '测试群', members: ['cta'], ts: Date.now() }]));
  localStorage.setItem('xy-home-v2:gc-cur-gid', 'gtest1');
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

await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-group-chat');});return 1;})()");
await evalJs("(function(){var el=document.getElementById('gc-more-settings');if(el){el.click();return 1;}return 0;})()");
await sleep(600);
const tabClick = (gt) => "(function(){var t=document.querySelector('#gc-set-body .gc-set-tabs .them-tab[data-gt=\"" + gt + "\"]');if(!t)return 0;t.click();return 1;})()";

console.log('== B 运行时（种子：当前群=测试群） ==');
// B1 标题带群名
const b1 = await evalJs("(function(){var h=document.querySelector('#gc-settings-panel .gc-set-head span');return h?h.textContent:'';})()");
ok('B1 面板标题 =「群聊设置 · 测试群」', b1 === '群聊设置 · 测试群', b1);

// B2 美化聊天入口 → 落在美化 tag（无返回条、有边看边调）
ok('B2a 切到「通用」tag', await evalJs(tabClick('general')) === 1);
await sleep(250);
await evalJs("(function(){var rows=document.querySelectorAll('#gc-set-body .gc-set-sec[data-gt=\"general\"] .gc-set-link');var el=Array.from(rows).find(function(x){return (x.textContent||'').indexOf('美化聊天')>=0;});if(el){el.click();return 1;}return 0;})()");
await sleep(500);
const b2 = await evalJs("(function(){var b=document.getElementById('gc-set-body');var a=document.querySelector('#gc-set-body .gc-set-tabs .them-tab.active');return {tab:a?a.textContent:null,back:!!b.querySelector('.gc-set-back'),live:!!document.getElementById('gc-live-adjust')};})()");
ok('B2b 点「美化聊天」→ 落在「美化」tag、无返回条、有边看边调', !!(b2 && b2.tab === '美化' && !b2.back && b2.live), b2);

// B3 字卡来源说明：回复段有、通用段没有
await evalJs(tabClick('reply'));
await sleep(250);
const b3 = await evalJs("(function(){var r=document.querySelector('#gc-set-body .gc-set-sec[data-gt=\"reply\"]');var g=document.querySelector('#gc-set-body .gc-set-sec[data-gt=\"general\"]');return {inReply:r?(r.textContent||'').indexOf('成员回复内容来自')>=0:false,inGeneral:g?(g.textContent||'').indexOf('成员回复内容来自')>=0:true};})()");
ok('B3 「字卡来源」说明在「回复」tag、不在「通用」tag', !!(b3 && b3.inReply && !b3.inGeneral), b3);

// B4 三点菜单只剩群聊设置
await evalJs("(function(){var b=document.getElementById('gc-more-btn');if(b)b.click();return 1;})()");
await sleep(300);
const b4 = await evalJs("(function(){var m=document.getElementById('gc-more-menu');return {open:!m.hidden,items:m.querySelectorAll('.gc-more-item').length,first:(m.querySelector('.gc-more-item')||{}).id};})()");
ok('B4 三点菜单只剩「群聊设置」一项', !!(b4 && b4.open && b4.items === 1 && b4.first === 'gc-more-settings'), b4);
await evalJs("(function(){var m=document.getElementById('gc-more-menu');if(m)m.hidden=true;return 1;})()");

// B5 预览不结账 → 应用后预览条被收掉（种子方案走应用层 xyStore 写入，直写 LS 会被存储层打回）
await evalJs("(function(){window.xyStore('xy-home-v2').set('gc-beauty-schemes',JSON.stringify([{name:'方案X',time:Date.now(),data:{'out-bg':'#123456'}}]));return 1;})()");
await evalJs('(function(){window.openGcBeautySchemes();return 1;})()');
await sleep(400);
await evalJs("(function(){var m=document.getElementById('gc-beauty-scheme-manager');var bs=Array.from(m.querySelectorAll('button')).filter(function(x){return x.textContent.trim()==='预览';});if(bs[0])bs[0].click();return 1;})()");
await sleep(400);
const b5a = await evalJs("(function(){var p=document.getElementById('gc-beauty-preview-bar');return p?getComputedStyle(p).display:null;})()");
ok('B5a 点「预览」→ 底部预览条出现', b5a === 'flex', b5a);
await evalJs('(function(){window.openGcBeautySchemes();return 1;})()');
await sleep(400);
await evalJs("(function(){var m=document.getElementById('gc-beauty-scheme-manager');var bs=Array.from(m.querySelectorAll('button')).filter(function(x){return x.textContent.trim()==='应用';});if(bs[0])bs[0].click();return 1;})()");
await sleep(400);
await evalJs("(function(){var ok=document.getElementById('modal-ok');if(ok)ok.click();return 1;})()");
await sleep(400);
const b5b = await evalJs("(function(){var p=document.getElementById('gc-beauty-preview-bar');var m=document.getElementById('gc-beauty-scheme-manager');return {bar:p?getComputedStyle(p).display:null,managerOpen:m?!m.hidden:null};})()");
ok('B5b 应用方案后预览条被收掉（不打架）', !!(b5b && b5b.bar === 'none' && b5b.managerOpen === false), b5b);

// C 零 JS 异常
const errs = await evalJs('JSON.stringify(window.__jsErrors || [])');
ok('C 零 JS 异常', errs === '[]', errs);

console.log('');
console.log('通过 ' + pass + ' / 断言失败 ' + fail);
try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(fail ? 1 : 0);
