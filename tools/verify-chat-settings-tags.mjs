// ===== v3.34.x 验证脚本：#524 聊天设置「功能」页二级 tag 分类整理 =====
// 用法：node tools/verify-chat-settings-tags.mjs
// 背景（用户反馈三条）：①删掉「功能」页二级 tag 里的「全部」；②「允许删除联系人消息」
//   从「数据」分区搬进消息输入分类；③分类名「消息输入」不合适要改。
// 改动：template.html 删 data-ft="all" tab + 把 cs-del-ta-msg 行搬进 data-tag="msg"
//   新组「消息管理」（原在 data-sec="data"）+「消息输入」改名「消息」；
//   chat-settings.js initCsFuncTags 抽出 applyFilter，进页按默认选中项过滤（不再默认全显）。
// 断言：S* 静态锚（src 直查），R* 运行时（无头 Chrome 走真实产物）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const serveDir = normalize(process.env.SERVE_DIR || root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

const tmpl = readFileSync(join(root, 'src/template.html'), 'utf8');
const csJs = readFileSync(join(root, 'src/js/chat-settings.js'), 'utf8');

// ---- 静态锚 ----
check('S1 二级 tag 行不再有 data-ft="all"（用户点名删除的「全部」）', !tmpl.includes('data-ft="all"'));
check('S2 二级 tag 只剩 形象/消息/显示 三项，且「消息输入」「界面」两个旧名都已替换',
  /<div class="them-tab active" data-ft="profile">形象<\/div>\s*<div class="them-tab" data-ft="msg">消息<\/div>\s*<div class="them-tab" data-ft="ui">显示<\/div>/.test(tmpl)
  && !/data-ft="msg">消息输入</.test(tmpl) && !/data-ft="ui">界面</.test(tmpl));
check('S3 「允许删除联系人消息」行落在 data-tag="msg" 的「消息管理」组里',
  /<div class="gs-title" data-tag="msg">消息管理<\/div>\s*<div class="set-group glass" data-tag="msg">[\s\S]{0,900}?id="cs-del-ta-msg"/.test(tmpl));
// 数据分区（data-sec="data" 开标签到本页闭合之间的最后一段）里不再出现该行：
// 用「cs-del-ta-msg 行出现在 data-sec="data" 之后」判否——该行已挪到 function 分区。
const dataSecIdx = tmpl.indexOf('<div class="them-sec" data-sec="data" hidden>');
const dtmIdx = tmpl.indexOf('id="cs-del-ta-msg"');
check('S4 数据分区里已无 cs-del-ta-msg（该行位置在数据分区开标签之前）',
  dataSecIdx > 0 && dtmIdx > 0 && dtmIdx < dataSecIdx, 'dataSec@' + dataSecIdx + ' row@' + dtmIdx);
check('S5 该行 id 仍唯一（未留两份）', (tmpl.match(/id="cs-del-ta-msg"/g) || []).length === 1);
check('S6 initCsFuncTags 有 applyFilter 且进页按默认选中项过滤',
  csJs.includes('function applyFilter(ft)') && csJs.includes("applyFilter(def ? (def.dataset.ft || 'all') : 'all');"));

// ---- 运行时 ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(serveDir, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(serveDir)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const chromePath = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

const cdpPort = 9300 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-cstag-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
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
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EVAL-ERR ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 300);
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const J = async (expr) => {
  try { const v = await evalJs('JSON.stringify(' + expr + ')'); return JSON.parse(v || '{}'); }
  catch (e) { return {}; }
};

try {
  await connect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }

  // 打开聊天设置页 → 切到「功能」主 tag（不依赖桌面导航，直接显示页面）
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat-settings');});return 1;})()");
  await evalJs("(function(){var t=document.querySelector('#cs-tabs .them-tab[data-tab=\"function\"]');if(t)t.click();return 1;})()");
  await sleep(300);

  // 二级 tag 栏
  const tabs = await evalJs("JSON.stringify(Array.from(document.querySelectorAll('#cs-func-tags .them-tab')).map(function(t){return t.textContent.trim();}))");
  check('R1 二级 tag 三项且无「全部」', tabs === JSON.stringify(['形象', '消息', '显示']), tabs);

  // 进页默认过滤：只有「形象」组可见
  const vis0 = await J("(function(){var sec=document.querySelector('.them-sec[data-sec=\"function\"]');var g=Array.from(sec.querySelectorAll('.gs-title[data-tag],.set-group[data-tag]'));return {vis:g.filter(function(e){return !e.hidden;}).map(function(e){return e.dataset.tag;}),all:g.length,active:document.querySelector('#cs-func-tags .them-tab.active').dataset.ft};})()");
  check('R2 进页默认选中「形象」且只显示 profile 组', vis0.active === 'profile' && Array.isArray(vis0.vis) && vis0.vis.length > 0 && vis0.vis.every(function (t) { return t === 'profile'; }), JSON.stringify(vis0));

  // 切到「消息」：可见组全是 msg，且「允许删除联系人消息」行真可见
  await evalJs("(function(){document.querySelector('#cs-func-tags .them-tab[data-ft=\"msg\"]').click();return 1;})()");
  await sleep(200);
  const visMsg = await J("(function(){var sec=document.querySelector('.them-sec[data-sec=\"function\"]');var g=Array.from(sec.querySelectorAll('.gs-title[data-tag],.set-group[data-tag]'));var row=document.getElementById('cs-del-ta-msg');var secData=document.querySelector('.them-sec[data-sec=\"data\"]');return {vis:g.filter(function(e){return !e.hidden;}).map(function(e){return e.dataset.tag;}),rowVisible:!!(row&&row.offsetParent!==null),rowInDataSec:!!(secData&&secData.contains(row)),labels:g.filter(function(e){return !e.hidden&&e.classList.contains('gs-title');}).map(function(e){return e.textContent.trim();})};})()");
  check('R3「消息」分类只显示 msg 组且组数 >0', Array.isArray(visMsg.vis) && visMsg.vis.length > 0 && visMsg.vis.every(function (t) { return t === 'msg'; }), JSON.stringify(visMsg.vis));
  check('R4 切到「消息」后「允许删除联系人消息」行可见（offsetParent 非空）', visMsg.rowVisible === true);
  check('R5 该行不属于「数据」分区', visMsg.rowInDataSec === false);
  check('R6「消息」分类含「消息管理」分组标题', (visMsg.labels || []).indexOf('消息管理') >= 0, JSON.stringify(visMsg.labels));

  // 切到「界面」：该行随之隐藏
  await evalJs("(function(){document.querySelector('#cs-func-tags .them-tab[data-ft=\"ui\"]').click();return 1;})()");
  await sleep(200);
  const visUi = await J("(function(){var sec=document.querySelector('.them-sec[data-sec=\"function\"]');var g=Array.from(sec.querySelectorAll('.gs-title[data-tag],.set-group[data-tag]'));var row=document.getElementById('cs-del-ta-msg');return {vis:g.filter(function(e){return !e.hidden;}).map(function(e){return e.dataset.tag;}),rowVisible:!!(row&&row.offsetParent!==null)};})()");
  check('R7「显示」分类只显示 ui 组', Array.isArray(visUi.vis) && visUi.vis.length > 0 && visUi.vis.every(function (t) { return t === 'ui'; }), JSON.stringify(visUi.vis));
  check('R8 切到「显示」后该行隐藏（未随其他分类透出）', visUi.rowVisible === false);

  // 开关仍然可用：点一下 → 落盘 → 再点回原值（该 toggle 绑在 checkbox 的 change 上，非行点击）
  const before = await evalJs("(function(){try{return String(window.activeStore().get('cs-del-ta-msg'));}catch(e){return 'ERR';}})()");
  await evalJs("(function(){document.querySelector('#cs-func-tags .them-tab[data-ft=\"msg\"]').click();return 1;})()");
  await sleep(150);
  await evalJs("(function(){document.getElementById('cs-del-ta-msg').click();return 1;})()");
  await sleep(250);
  const after = await evalJs("(function(){try{return String(window.activeStore().get('cs-del-ta-msg'));}catch(e){return 'ERR';}})()");
  check('R9 该开关搬组后仍可点动并落盘（值发生变化）', before !== 'ERR' && after !== 'ERR' && before !== after, before + ' -> ' + after);
  await evalJs("(function(){document.getElementById('cs-del-ta-msg').click();return 1;})()");
  await sleep(250);
  const back = await evalJs("(function(){try{return String(window.activeStore().get('cs-del-ta-msg'));}catch(e){return 'ERR';}})()");
  const backChecked = await evalJs("(function(){var c=document.getElementById('cs-del-ta-msg');return c?String(c.checked):'ERR';})()");
  // 原值可能是未设键（null），关掉后写成 '0'——两者在 dtmGet（=== '1'）下同义，按语义判而非按字面
  check('R10 再次点击回到关闭态（键值非 1 且 checkbox 未勾）', back !== 'ERR' && back !== '1' && backChecked === 'false', back + ' checked=' + backChecked);

  // 无未捕获异常
  const errs = await evalJs("JSON.stringify(window.__jsErrors||[])");
  check('R11 全程无未捕获 JS 异常', errs === '[]' || errs === null, errs);
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
}

const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' 通过');
process.exit(pass === results.length ? 0 : 1);
