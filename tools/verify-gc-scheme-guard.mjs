// ===== 专项验证：群聊美化方案「防炸提醒」——含壁纸方案保存前标体积 / 管理器总数·总占用·超限提醒 / 内容相同方案拒绝重复入库（#808） =====
// 需求（用户原话）：「那需要增加提醒用户不要上传太多美化。会导致内存炸掉。关于方案还能怎么优化？」
// 背景：方案会把当前壁纸（高分辨率 JPEG dataURL，一张几百 KB～1MB+）整张打包进方案，且方案无
//      数量上限——带壁纸方案存多了 = 多份壁纸拷贝，撑爆本地存储与备份导出文件。本批零数据语义
//      变化（不动 #373「应用=真覆盖」），只做提醒与防重复。
// 用例组：
//   A 源码锚：保存弹窗含壁纸体积警告、管理器统计行、超限阈值判定、重复入库拦截
//   B 运行时（无头 Chrome 走自组装 src 页；种子 gc-beauty 预置小壁纸）：
//     B1 打开保存弹窗 → 含壁纸体积警告（⚠ 将包含当前壁纸）；
//     B2 保存方案A → 入库 1 条；B3 换名再存同一内容 → 被拒（仍是 1 条）；
//     B4 管理器显示「已存 1 个方案 · 约占 …」与「含壁纸」统计；
//     B5 方案数达阈值（≥10）→ 管理器出现「方案偏多或偏大」清理提醒；
//     B6 不含壁纸的方案保存时不出体积警告（警告只在 bg 存在时出现）；
//     C 零 JS 异常
// 用法：node tools/verify-gc-scheme-guard.mjs
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
testHtml = testHtml.split('__BUILD_INFO__').join('verify-gc-scheme-guard').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-gcsg-' + Date.now());
const profDir = join(process.env.TEMP || '/tmp', 'mochi-gcsg-prof-' + Date.now());
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 90));
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
ok('A1 保存弹窗含壁纸体积警告文案', gsSrc.indexOf('此方案将包含当前壁纸（约 ') >= 0 && gsSrc.indexOf('带壁纸的方案别存太多，否则本地存储和备份文件会被撑爆') >= 0);
ok('A2 管理器统计行（已存 N 个方案 · 约占 X）', gsSrc.indexOf("stat.textContent = '已存 ' + schemes.length + ' 个方案 · 约占 ' + gcPrettyKb(totalLen)") >= 0);
ok('A3 超限阈值判定（≥2MB 或 ≥10 个）', gsSrc.indexOf('const GC_SCHEME_WARN_LEN = 2 * 1024 * 1024;') >= 0
  && gsSrc.indexOf('const GC_SCHEME_WARN_CNT = 10;') >= 0
  && gsSrc.indexOf('totalLen >= GC_SCHEME_WARN_LEN || schemes.length >= GC_SCHEME_WARN_CNT') >= 0);
ok('A4 内容相同方案拒绝重复入库', gsSrc.indexOf('const dup = list.find(it => JSON.stringify(it.data || {}) === snap);') >= 0
  && gsSrc.indexOf('已有内容完全相同的方案「') >= 0);

await cdpConnect();
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
// 小壁纸 dataURL（真实 base64 头），让「含壁纸」分支与体积计算可断言
const TINY_BG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDA0SEhISEhISExISEhITExQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBP/AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscHRJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAAwDAQACEQMRAD8A9/oooooA//9k=';
const SEED = `(function () {
  localStorage.clear();
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{ id: 'default', name: '宝贝' }, { id: 'cta', name: '小桃' }]));
  localStorage.setItem('xy-home-v2:active-contact', 'cta');
  localStorage.setItem('xy-home-v2:gc-beauty', JSON.stringify({ 'bg': '${TINY_BG}', 'out-bg': '#111111' }));
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

const readSchemes = () => evalJs("(function(){try{return JSON.parse(localStorage.getItem('xy-home-v2:gc-beauty-schemes')||'[]').length;}catch(e){return -1;}})()");

console.log('== B 运行时（种子：gc-beauty 带小壁纸） ==');
// B1 保存弹窗：含壁纸 → 体积警告出现
await evalJs('(function(){window.saveGcBeautyScheme();return 1;})()');
await sleep(400);
const b1 = await evalJs("(function(){var x=document.getElementById('gc-beauty-save-modal');if(!x||x.hidden)return null;return {open:true,txt:(x.textContent||'')};})()");
ok('B1 保存弹窗打开且出现「将包含当前壁纸（约 …」体积警告', !!(b1 && b1.open && b1.txt.indexOf('此方案将包含当前壁纸（约 ') >= 0 && b1.txt.indexOf('KB') >= 0), b1 && b1.txt.slice(0, 60));

// B2 保存方案A → 入库 1 条
await evalJs("(function(){var i=document.querySelector('#gc-beauty-save-modal input');if(i)i.value='方案A';return 1;})()");
await evalJs("(function(){var bs=Array.from(document.querySelectorAll('#gc-beauty-save-modal button'));var b=bs.find(function(x){return x.textContent==='保存方案';});if(b)b.click();return 1;})()");
await sleep(400);
ok('B2 方案A入库（共 1 条）', await readSchemes() === 1);

// B3 换名再存同一内容 → 拒绝，仍是 1 条
await evalJs('(function(){window.saveGcBeautyScheme();return 1;})()');
await sleep(400);
await evalJs("(function(){var i=document.querySelector('#gc-beauty-save-modal input');if(i)i.value='方案B';return 1;})()");
await evalJs("(function(){var bs=Array.from(document.querySelectorAll('#gc-beauty-save-modal button'));var b=bs.find(function(x){return x.textContent==='保存方案';});if(b)b.click();return 1;})()");
await sleep(400);
const b3n = await readSchemes();
const b3t = await evalJs("(function(){var t=document.getElementById('cc-toast');return t?(t.textContent||''):'';})()");
ok('B3 内容相同的方案被拒（仍是 1 条 + 拦截提示）', b3n === 1 && b3t.indexOf('已有内容完全相同的方案') >= 0, { n: b3n, toast: b3t });

// B4 管理器统计行
await evalJs('(function(){window.openGcBeautySchemes();return 1;})()');
await sleep(400);
const b4 = await evalJs("(function(){var m=document.getElementById('gc-beauty-scheme-manager');if(!m||m.hidden)return null;return {open:true,txt:(m.textContent||'')};})()");
ok('B4 管理器显示「已存 1 个方案 · 约占 …」与「含壁纸」统计',
  !!(b4 && b4.open && b4.txt.indexOf('已存 1 个方案 · 约占 ') >= 0 && b4.txt.indexOf('1 个含壁纸') >= 0), b4 && b4.txt.indexOf('已存'));

// B5 方案数达阈值（10 个）→ 清理提醒出现（走应用自己的 xyStore 写入，LS+IDB+内存缓存一致）
await evalJs("(function(){var st=window.xyStore('xy-home-v2');var cur=JSON.parse(st.get('gc-beauty-schemes')||'[]');for(var i=0;i<9;i++){cur.push({name:'凑数'+i,time:Date.now()+i,data:{'out-bg':'#123456'}});}st.set('gc-beauty-schemes',JSON.stringify(cur));return 1;})()");
await evalJs('(function(){window.openGcBeautySchemes();return 1;})()');
await sleep(400);
const b5 = await evalJs("(function(){var m=document.getElementById('gc-beauty-scheme-manager');return {txt:(m.textContent||'')};})()");
ok('B5 方案达 10 个 → 出现「方案偏多或偏大」清理提醒', !!(b5 && b5.txt.indexOf('方案偏多或偏大') >= 0 && b5.txt.indexOf('已存 10 个方案') >= 0), b5 && b5.txt.indexOf('已存'));

// B6 不含壁纸方案：保存弹窗不出体积警告（走 applyGcBeautyData 清 bg，内存+存储同步）
await evalJs("(function(){window.applyGcBeautyData({'bg':''});return 1;})()");
await evalJs('(function(){window.saveGcBeautyScheme();return 1;})()');
await sleep(400);
const b6 = await evalJs("(function(){var x=document.getElementById('gc-beauty-save-modal');return {txt:(x.textContent||'')};})()");
ok('B6 无壁纸时保存弹窗不出现壁纸体积警告', !!(b6 && b6.txt.indexOf('此方案将包含当前壁纸') < 0));

// C 零 JS 异常
const errs = await evalJs('JSON.stringify(window.__jsErrors || [])');
ok('C 零 JS 异常', errs === '[]', errs);

console.log('');
console.log('通过 ' + pass + ' / 断言失败 ' + fail);
try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(fail ? 1 : 0);
