// ===== #373~#376 验证脚本：群聊设置面板四件修复（美化方案预览还原/应用覆盖、导入串群、导出令牌展开、美化子视图复位） =====
// 用法：两步——
//   1) 副本构建（不碰共享产物）：复制 src/+build.mjs 到临时目录后在该目录 node build.mjs
//   2) SERVE_DIR=<副本目录> MOCHI_VERIFY_ROOT=<副本目录> node tools/verify-gc-settings-fixes.mjs
// 断言：S* 静态锚（src 直查） / U* 纯逻辑单测 / R* 运行时（无头 Chrome 走真实副本产物）。
// R6/R7 是 #373 的判别断言：旧实现下 R6「还原后壁纸残留」、R7「应用后壁纸残留」必红。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname as ext } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_VERIFY_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const serveDir = normalize(process.env.SERVE_DIR || root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---- S* 静态锚（对 src 断言；minifyJs 会改产物局部变量名，故锚 src） ----
const src = readFileSync(join(root, 'src/js/group-chat.js'), 'utf8');
check('S1 #373a 预览备份为全量快照（未设键存原始值）',
  src.includes('gcPreviewBackup = {};') && src.includes("gcPreviewBackup[k] = gcBeautyStored[k] !== undefined ? gcBeautyStored[k] : '';"));
check('S2 #373b 应用方案先清方案外键回默认',
  src.includes('if (!(s.data && s.data[k] !== undefined))') && src.includes("gcBeautySet(k, '')"));
check('S3 #374 导入整份备份兜底优先当前群消息键',
  src.includes('const ck = groupMsgKey(curGid);') && src.includes('const raw = (data.idb && data.idb[ck]) || data.ls[ck] || (data.idb && data.idb[MSG_KEY]) || data.ls[MSG_KEY];'));
check('S4 #375 导出展开媒体令牌 + 文件名清洗 + 本地日期',
  src.includes('window.mochiMediaExpandAsync(k,') && src.includes("replace(/[\\\\/:*?\"<>|]/g, '_')") && !src.includes("toISOString().slice(0, 10)"));
check('S5 #376 关闭设置面板复位顶部 tag（#816 起 gcBeautyView 子视图退役，复位只剩 gcSetTab 一件事）',
  src.includes("gcSetTab = 'profile'; if (settingsPanel) settingsPanel.hidden = true;") && src.includes("if (e.target === settingsPanel) { gcSetTab = 'profile'; settingsPanel.hidden = true; }"));

// ---- U* 纯逻辑单测（#374 键优先级 / #375 令牌展开+清洗） ----
(function () {
  const MSG_KEY = 'xy-home-v2:group-chat-msgs';
  const groupMsgKey = (gid) => gid === 'default' ? MSG_KEY : 'xy-home-v2:gc-msgs-' + gid;
  const pickRaw = (data, curGid) => {
    const ck = groupMsgKey(curGid);
    return (data.idb && data.idb[ck]) || data.ls[ck] || (data.idb && data.idb[MSG_KEY]) || data.ls[MSG_KEY];
  };
  const d1 = { idb: { 'xy-home-v2:gc-msgs-g9': '[9条]', [MSG_KEY]: '[默认群条]' }, ls: {} };
  const d2 = { idb: { [MSG_KEY]: '[默认群条]' }, ls: { 'xy-home-v2:gc-msgs-g9': '[ls九条]' } };
  const d3 = { idb: {}, ls: { [MSG_KEY]: '[默认群ls条]' } };
  check('U1a #374 自定义群优先取本群 idb 键', pickRaw(d1, 'g9') === '[9条]', String(pickRaw(d1, 'g9')));
  check('U1b #374 本群只有 ls 键时取 ls', pickRaw(d2, 'g9') === '[ls九条]', String(pickRaw(d2, 'g9')));
  check('U1c #374 本群无数据回落默认群键', pickRaw(d3, 'g9') === '[默认群ls条]', String(pickRaw(d3, 'g9')));
  check('U1d #374 default 群行为不变', pickRaw(d3, 'default') === '[默认群ls条]', String(pickRaw(d3, 'default')));
  const expMap = { '@@m:abc': 'data:image/png;base64,AAA' };
  const isTok = (s) => typeof s === 'string' && s.indexOf('@@m:') === 0;
  const repStr = (s) => {
    if (typeof s !== 'string') return s;
    if (expMap[s]) return expMap[s];
    if (s.indexOf('|||') < 0) return s;
    let ch = false;
    const ps = s.split('|||').map(p => { const e2 = expMap[p]; if (e2) { ch = true; return e2; } return p; });
    return ch ? ps.join('|||') : s;
  };
  check('U2a #375 表情令牌展开', repStr('@@m:abc') === 'data:image/png;base64,AAA');
  check('U2b #375 语音段令牌展开', repStr('语音 3″|||@@m:abc') === '语音 3″|||data:image/png;base64,AAA');
  check('U2c #375 无令牌文本原样', repStr('普通|||文字') === '普通|||文字');
  const safeName = String('测/试:群*聊?').replace(/[\\/:*?"<>|]/g, '_').trim() || '群聊';
  check('U2d #375 文件名非法字符清洗', safeName === '测_试_群_聊_', safeName);
})();

// ---- R* 运行时（无头 Chrome 走副本产物） ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(serveDir, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(serveDir)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[ext(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const chromePath = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const cdpPort = 9700 + Math.floor(Math.random() * 200);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-gcfix-' + Date.now()),
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
    if (r && r.exceptionDetails) return 'EVAL-ERR ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 300);
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await connect();
await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }

const openPanel = "(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-group-chat');});var el=document.getElementById('gc-more-settings');if(el)el.click();return 1;})()";
const panelTitle = "(function(){var h=document.querySelector('#gc-settings-panel .gc-set-head span');return h?h.textContent:'NOHEAD';})()";

// R1-R2：#376 美化子视图关闭复位
await evalJs(openPanel); await sleep(500);
await evalJs("(function(){var links=Array.from(document.querySelectorAll('#gc-set-body .gc-set-link'));var el=links.find(function(x){return x.innerText.indexOf('美化聊天')>=0;});if(el)el.click();return 1;})()"); await sleep(400);
const tBeauty = await evalJs(panelTitle);
check('R1 进入美化聊天子视图标题正确', tBeauty === '美化聊天', String(tBeauty));
await evalJs("(function(){var el=document.getElementById('gc-set-close');if(el)el.click();return 1;})()"); await sleep(300);
await evalJs(openPanel); await sleep(500);
const tBack = await evalJs(panelTitle);
check('R2 #376 关闭后重开回到群聊设置主页（旧实现残留美化视图）', tBack === '群聊设置', String(tBack));

// 测试用迷你壁纸（不需要可解码，仅存取字符串）
const WALL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// R3-R4：存一个「带壁纸+自定义气泡色」的方案 A
await evalJs("(function(){window.groupChatBeautySet('bg'," + JSON.stringify(WALL) + ");window.groupChatBeautySet('out-bg','#ff0000');return 1;})()"); await sleep(300);
let bg0 = await evalJs("window.groupChatBeautyGet('bg')");
check('R3 前置：壁纸+气泡色已设置', bg0 === WALL, String(bg0).slice(0, 40));
await evalJs("window.saveGcBeautyScheme()"); await sleep(400);
await evalJs("(function(){var i=document.querySelector('#gc-beauty-save-modal input');if(i)i.value='方案A';return 1;})()");
await evalJs("(function(){var bs=Array.from(document.querySelectorAll('#gc-beauty-save-modal button'));var ok=bs.find(function(b){return b.textContent.trim()==='保存方案';});if(ok)ok.click();return 1;})()"); await sleep(400);
const schemeA = JSON.parse(await evalJs("(function(){return (window.xyStore('xy-home-v2').get('gc-beauty-schemes')||'[]');})()"));
check('R4 方案A已保存（含壁纸与自定义气泡色）', schemeA.length === 1 && schemeA[0].name === '方案A' && schemeA[0].data && schemeA[0].data.bg === WALL && schemeA[0].data['out-bg'] === '#ff0000', JSON.stringify(schemeA.map(s => s.name)));

// R5：清掉壁纸/气泡色 → 预览方案A（应恢复）→ 点还原（#373a 判别：应精确回到清掉后的原状）
await evalJs("(function(){window.groupChatBeautySet('bg','');window.groupChatBeautySet('out-bg','#111111');return 1;})()"); await sleep(300);
let cleared = await evalJs("JSON.stringify({bg:window.groupChatBeautyGet('bg'),out:window.groupChatBeautyGet('out-bg')})");
check('R5 前置：壁纸/气泡色已清回默认', cleared === '{"bg":"","out":"#111111"}', cleared);
await evalJs("window.openGcBeautySchemes()"); await sleep(400);
await evalJs("(function(){var m=document.getElementById('gc-beauty-scheme-manager');var bs=Array.from(m.querySelectorAll('button'));var pv=bs.find(function(b){return b.textContent.trim()==='预览';});if(pv)pv.click();return 1;})()"); await sleep(400);
let previewed = await evalJs("JSON.stringify({bg:window.groupChatBeautyGet('bg').indexOf('data:image/png;base64,iVBOR')===0,out:window.groupChatBeautyGet('out-bg')})");
check('R6a 预览方案A后壁纸/气泡色生效', previewed === '{"bg":true,"out":"#ff0000"}', previewed);
await evalJs("(function(){var bar=document.getElementById('gc-beauty-preview-bar');var bs=Array.from(bar.querySelectorAll('button'));var re=bs.find(function(b){return b.textContent.trim()==='还原';});if(re)re.click();return 1;})()"); await sleep(400);
let restored = await evalJs("JSON.stringify({bg:window.groupChatBeautyGet('bg'),out:window.groupChatBeautyGet('out-bg')})");
check('R6b #373a 还原后壁纸/气泡色精确复原（旧实现壁纸残留）', restored === '{"bg":"","out":"#111111"}', restored);

// R7：#373b 应用不含壁纸的方案B → 手动壁纸应被清掉（旧实现只合并不清理）
// 顺序：先在无壁纸状态保存方案B → 再手动设壁纸 → 应用方案B → 壁纸应被清
await evalJs("window.openGcBeautySchemes()"); await sleep(300);
await evalJs("window.saveGcBeautyScheme()"); await sleep(400);
await evalJs("(function(){var i=document.querySelector('#gc-beauty-save-modal input');if(i)i.value='方案B';return 1;})()");
await evalJs("(function(){var bs=Array.from(document.querySelectorAll('#gc-beauty-save-modal button'));var ok=bs.find(function(b){return b.textContent.trim()==='保存方案';});if(ok)ok.click();return 1;})()"); await sleep(400);
const schemeB = JSON.parse(await evalJs("(function(){return (window.xyStore('xy-home-v2').get('gc-beauty-schemes')||'[]');})()"));
check('R7a 方案B已保存且不含壁纸键', schemeB.length === 2 && schemeB[1].name === '方案B' && schemeB[1].data && schemeB[1].data.bg === undefined, JSON.stringify(schemeB.map(s => s.name)));
await evalJs("(function(){window.groupChatBeautySet('bg'," + JSON.stringify(WALL) + ");return 1;})()"); await sleep(300);
let manualBg = await evalJs("window.groupChatBeautyGet('bg').indexOf('data:image/png;base64,iVBOR')===0");
check('R7a2 前置：手动壁纸已设置', manualBg === true, String(manualBg));
await evalJs("(function(){var m=document.getElementById('gc-beauty-scheme-manager');var abs=Array.from(m.querySelectorAll('button')).filter(function(b){return b.textContent.trim()==='应用';});var ab=abs.find(function(b){return b.parentNode.parentNode.textContent.indexOf('方案B')>=0;});if(ab)ab.click();return 1;})()"); await sleep(400);
await evalJs("(function(){var ok=document.getElementById('modal-ok');if(ok)ok.click();return 1;})()"); await sleep(400);
let applied = await evalJs("JSON.stringify({bg:window.groupChatBeautyGet('bg'),out:window.groupChatBeautyGet('out-bg')})");
check('R7b #373b 应用无壁纸方案B后手动壁纸被清（旧实现残留；out-bg 按方案存档回默认黑）', applied === '{"bg":"","out":"#111111"}', applied);

// 收尾
chrome.kill();
server.close();
const pass = results.filter(Boolean).length;
console.log('==== ' + pass + '/' + results.length + ' 通过 ====');
process.exit(pass === results.length ? 0 : 1);
