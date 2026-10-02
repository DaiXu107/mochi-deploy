// ===== 专项验证：回复设置「其他」tab + 联系人主动邀请（v3.9.x / v3.14.x 更新） =====
// 链路：设置页「回复设置」有 6 个 tab（聊天/群聊/信箱/朋友圈/查岗/其他）→
//       其他面板含 猜拳/游戏/贴贴 邀请开关+概率（默认开，8%/5%/5%，v3.14.x 加贴贴门）→
//       replyCfg 默认值正确 → 开关关闭后落库并生效 → 聊天页可见时
//       tryActiveInvite 按概率发邀请消息并弹窗让我同意/拒绝，同意才打开对应半框（猜拳 / Pong / 贪吃蛇）、
//       拒绝则发一条拒绝消息；半框不再自动打开 →
//       三类开关全关时不发邀请（走普通主动消息）→ 全程无 JS 异常。
// 注：默认值断言曾写 15%/10%（v3.9.x 初版），实际 v3.9.x 后期已降至 8%/5%，
//     本次随贴贴门一并修正；第 5 节猜拳同意链路修复依赖 chat.js window.openRpsPanel 导出（v3.14.x）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
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
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-iv-' + Date.now()),
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
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "(function(){window.__smokeErrs=[];window.addEventListener('error',function(e){try{window.__smokeErrs.push(String(e.message||e.error||'err'));}catch(_){}});})()" });

async function enterApp() {
  await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();return true;})()");
  await sleep(400);
  await evalJs("(function(){var c=document.getElementById('splash-confirm');if(c&&!c.hidden){var b=c.querySelector('#splash-confirm-ok');if(b)b.click();}return true;})()");
  await sleep(900);
}
async function enterChat() {
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return true;})()");
  await sleep(700);
}
async function enterReplySettings() {
  await evalJs("(function(){var b=document.getElementById('chat-settings-btn');if(b)b.click();return true;})()");
  await sleep(400);
  await evalJs("(function(){var b=document.getElementById('row-general');if(b)b.click();return true;})()");
  await sleep(400);
}
async function setCfg(k, v) {
  await evalJs("(function(){window.saveReplyCfg(" + JSON.stringify(k) + ", " + JSON.stringify(v) + ");return true;})()");
  await sleep(200);
}
async function cfgVal(k) {
  return await evalJs("(function(){var c=window.replyCfg();return c[" + JSON.stringify(k) + "];})()");
}
// 强制 Math.random 返回固定值（0 → hit(任意正概率) 命中、游戏随机选 Pong），用完恢复
async function freezeRandom() {
  await evalJs("(function(){window.__realRandom = Math.random; Math.random = function(){return 0;}; return true;})()");
}
async function restoreRandom() {
  await evalJs("(function(){if(window.__realRandom){Math.random=window.__realRandom;window.__realRandom=null;}return true;})()");
}

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await sleep(800);
await enterApp();

// ==================== 1. 设置页「其他」tab ====================
await enterChat();
await enterReplySettings();
const pageShown = await evalJs("(function(){var p=document.getElementById('page-reply-settings');return !!p&&!p.hidden;})()");
check('回复设置页已进入', pageShown === true);
const tabInfo = JSON.parse(await evalJs("(function(){var tabs=[].slice.call(document.querySelectorAll('#page-reply-settings .fav-tab')).map(function(t){return t.dataset.rp;});var otherTab=document.querySelector('#page-reply-settings .fav-tab[data-rp=\"other\"]');var panel=document.querySelector('#page-reply-settings .gs-panel[data-rpanel=\"other\"]');return JSON.stringify({tabs:tabs,hasTab:!!otherTab,panelHidden:panel?panel.hidden:null});})()") || '{}');
check('回复设置页含其他 tab（聊天/群聊/信箱/朋友圈/查岗/其他）', tabInfo.tabs && tabInfo.tabs.length >= 5 && tabInfo.tabs.indexOf('other') >= 0, JSON.stringify(tabInfo.tabs));
check('其他 tab 存在且面板默认隐藏', tabInfo.hasTab === true && tabInfo.panelHidden === true, JSON.stringify({ hasTab: tabInfo.hasTab, panelHidden: tabInfo.panelHidden }));

await evalJs("(function(){var t=document.querySelector('#page-reply-settings .fav-tab[data-rp=\"other\"]');if(t)t.click();return true;})()");
await sleep(300);
const panelShown = await evalJs("(function(){var p=document.querySelector('#page-reply-settings .gs-panel[data-rpanel=\"other\"]');return !!p&&!p.hidden;})()");
check('点击其他 tab 后面板显示', panelShown === true);

// ==================== 2. 其他面板控件与默认值 ====================
const ctl = JSON.parse(await evalJs("(function(){var rows=[].slice.call(document.querySelectorAll('#page-reply-settings .gs-panel[data-rpanel=\"other\"] .stepper')).map(function(st){return {k:st.dataset.k,v:st.querySelector('input.stp-val')?st.querySelector('input.stp-val').value:null};});var rpsEn=document.getElementById('ai-rps-en');var gameEn=document.getElementById('ai-game-en');var title=[].slice.call(document.querySelectorAll('#page-reply-settings .gs-panel[data-rpanel=\"other\"] .gs-title')).map(function(t){return t.textContent;});return JSON.stringify({steppers:rows,rpsEn:rpsEn?rpsEn.checked:null,gameEn:gameEn?gameEn.checked:null,title:title});})()") || '{}');
const vmap = {};
(ctl.steppers || []).forEach(s => { vmap[s.k] = s.v; });
check('其他面板含 3 个 stepper（猜拳/游戏/贴贴邀请概率）', vmap['ai-rps-prob'] !== undefined && vmap['ai-game-prob'] !== undefined && vmap['ai-cuddle-prob'] !== undefined, 'keys=' + Object.keys(vmap).join(','));
check('默认值：ai-rps-prob=8 / ai-game-prob=5 / ai-cuddle-prob=5', vmap['ai-rps-prob'] === '8' && vmap['ai-game-prob'] === '5' && vmap['ai-cuddle-prob'] === '5', vmap['ai-rps-prob'] + '/' + vmap['ai-game-prob'] + '/' + vmap['ai-cuddle-prob']);
check('默认值：猜拳/游戏邀请开关均开启', ctl.rpsEn === true && ctl.gameEn === true, 'rps=' + ctl.rpsEn + ' game=' + ctl.gameEn);
// FIX（#165 脚本侧）：「其他」面板后来新增「联系人跨桌面查岗/打电话」分组（#150/#159 同期），
// 标题数不再恒为 1——断言改为「存在主动邀请分组标题」，不再约束总数
check('面板有「联系人主动邀请」分组标题', (ctl.title || []).some(t => t.indexOf('主动邀请') >= 0), JSON.stringify(ctl.title));

// ==================== 3. replyCfg 默认值 ====================
const cfg0 = {
  rpsEn: await cfgVal('ai-rps-en'), rpsProb: await cfgVal('ai-rps-prob'),
  gameEn: await cfgVal('ai-game-en'), gameProb: await cfgVal('ai-game-prob'),
  cuddleEn: await cfgVal('ai-cuddle-en'), cuddleProb: await cfgVal('ai-cuddle-prob')
};
check('replyCfg 默认值：rps 1/8、game 1/5、cuddle 1/5',
  cfg0.rpsEn === 1 && cfg0.rpsProb === 8 && cfg0.gameEn === 1 && cfg0.gameProb === 5 && cfg0.cuddleEn === 1 && cfg0.cuddleProb === 5, JSON.stringify(cfg0));

// ==================== 4. 开关关闭 → 落库生效 ====================
await setCfg('ai-game-en', 0);
const cfg1 = { gameEn: await cfgVal('ai-game-en'), gameProb: await cfgVal('ai-game-prob') };
check('关闭游戏邀请后 replyCfg 读到 0', cfg1.gameEn === 0, JSON.stringify(cfg1));
const lsVal = await evalJs("(function(){try{var pre='xy-home-v2:'+(window.__activeCid||'default')+':reply-ai-game-en';return localStorage.getItem(pre);}catch(e){return null;}})()");
check('游戏邀请开关已写入 localStorage（当前联系人命名空间）', lsVal === '0', lsVal);
await setCfg('ai-game-en', 1);
check('重新开启游戏邀请后回复默认', (await cfgVal('ai-game-en')) === 1);

// ==================== 5. 聊天页触发：猜拳邀请 → 弹窗同意/拒绝 ====================
await evalJs("(function(){var b=document.getElementById('reply-back');if(b)b.click();return true;})()");
await sleep(300);
await evalJs("(function(){var b=document.getElementById('cs-back');if(b)b.click();return true;})()");
await sleep(300);
await enterChat();
const chatShown = await evalJs("(function(){var p=document.getElementById('page-chat');return !!p&&!p.hidden;})()");
check('聊天页可见（邀请需要聊天页可见才触发）', chatShown === true);

// 确定性：固定随机 + 猜拳概率 100、游戏概率 0
await setCfg('ai-rps-en', 1); await setCfg('ai-rps-prob', 100); await setCfg('ai-game-prob', 0);
await freezeRandom();
const rpsRet = await evalJs("(function(){return window.tryActiveInvite(window.replyCfg());})()");
check('猜拳邀请触发（tryActiveInvite 返回 true）', rpsRet === true, String(rpsRet));
let rpsMsg = '';
for (let i = 0; i < 20; i++) {
  rpsMsg = await evalJs("(function(){var bs=document.querySelectorAll('#chat-body .msg-poke');if(!bs.length)return '';var t=bs[bs.length-1].textContent||'';return t;})()") || '';
  if (rpsMsg.indexOf('猜拳') >= 0) break;
  await sleep(200);
}
check('猜拳邀请消息已发送（.msg-poke 居中卡片，含「猜拳」）', rpsMsg.indexOf('猜拳') >= 0, rpsMsg);
let maskVisible = false, pillsOk = false, rpsPanelClosed = true;
for (let i = 0; i < 30; i++) {
  const st = JSON.parse(await evalJs("(function(){var m=document.getElementById('modal-mask');var pills=document.querySelectorAll('#modal-pills button');var labels=[].slice.call(pills).map(function(b){return b.textContent;});var rp=document.getElementById('chat-rps-panel');return JSON.stringify({mask:m?!m.hidden:false,pills:labels,rpHidden:rp?rp.hidden:true});})()") || '{}');
  maskVisible = st.mask; pillsOk = st.pills.indexOf('同意') >= 0 && st.pills.indexOf('拒绝') >= 0; rpsPanelClosed = st.rpHidden;
  if (maskVisible && pillsOk) break;
  await sleep(250);
}
check('邀请弹窗已弹出（modal-mask 可见）', maskVisible === true);
check('弹窗含「同意」「拒绝」两个选项', pillsOk === true);
check('弹窗弹出时半框未自动打开（需先同意）', rpsPanelClosed === true);
// FIX（#165 脚本侧）：弹窗出现/半框打开均为异步，固定 400ms 单次点击偶发赶不上——
// 「点同意+确定」改为轮询重试，「半框打开」改为轮询等待（断言口径不变）
let rpsPanelOpen = false;
for (let i = 0; i < 20 && !rpsPanelOpen; i++) {
  await evalJs("(function(){var pills=document.querySelectorAll('#modal-pills button');for(var i=0;i<pills.length;i++){if(pills[i].textContent.indexOf('同意')>=0){pills[i].click();break;}}var ok=document.getElementById('modal-ok');if(ok)ok.click();return true;})()");
  for (let j = 0; j < 4; j++) {
    await sleep(250);
    rpsPanelOpen = await evalJs("(function(){var p=document.getElementById('chat-rps-panel');return !!p&&!p.hidden;})()") || false;
    if (rpsPanelOpen) break;
  }
}
check('点「同意」+确定后猜拳半框打开', rpsPanelOpen === true);
await evalJs("(function(){var b=document.getElementById('chat-rps-close');if(b)b.click();return true;})()");
await sleep(300);

// ==================== 6. 聊天页触发：游戏邀请 → 点拒绝 ====================
await setCfg('ai-rps-en', 0); await setCfg('ai-game-en', 1); await setCfg('ai-game-prob', 100);
const gameRet = await evalJs("(function(){return window.tryActiveInvite(window.replyCfg());})()");
check('游戏邀请触发（tryActiveInvite 返回 true）', gameRet === true, String(gameRet));
let gameMsg = '';
for (let i = 0; i < 20; i++) {
  gameMsg = await evalJs("(function(){var bs=document.querySelectorAll('#chat-body .msg-poke');if(!bs.length)return '';return bs[bs.length-1].textContent||'';})()") || '';
  if (gameMsg.indexOf('Pong') >= 0 || gameMsg.indexOf('贪吃蛇') >= 0) break;
  await sleep(200);
}
check('游戏邀请消息已发送（.msg-poke 居中卡片，Pong 或 贪吃蛇）', gameMsg.indexOf('Pong') >= 0 || gameMsg.indexOf('贪吃蛇') >= 0, gameMsg);
let gMaskVisible = false;
for (let i = 0; i < 20; i++) {
  gMaskVisible = await evalJs("(function(){var m=document.getElementById('modal-mask');return m?!m.hidden:false;})()") || false;
  if (gMaskVisible) break;
  await sleep(200);
}
check('游戏邀请弹窗已弹出', gMaskVisible === true);
const outBefore = await evalJs("(function(){return document.querySelectorAll('#chat-body .msg-out').length;})()") || 0;
// 点拒绝 → 点确定 → 发拒绝消息 + 半框不打开
await evalJs("(function(){var pills=document.querySelectorAll('#modal-pills button');for(var i=0;i<pills.length;i++){if(pills[i].textContent.indexOf('拒绝')>=0){pills[i].click();break;}}var ok=document.getElementById('modal-ok');if(ok)ok.click();return true;})()");
await sleep(400);
const maskAfterReject = await evalJs("(function(){var m=document.getElementById('modal-mask');return m?!m.hidden:false;})()") || false;
const outAfter = await evalJs("(function(){return document.querySelectorAll('#chat-body .msg-out').length;})()") || 0;
const gamePanelClosed = await evalJs("(function(){var p=document.getElementById('chat-pong-panel');var s=document.getElementById('chat-snake-panel');return (!p||p.hidden)&&(!s||s.hidden);})()") || false;
check('点「拒绝」+确定后弹窗关闭', maskAfterReject === false);
check('点「拒绝」+确定后发出一条拒绝消息（.msg-out +1）', outAfter === outBefore + 1, outBefore + '->' + outAfter);
check('点「拒绝」+确定后半框未打开', gamePanelClosed === true);

// ==================== 7. 全部关闭 → 不触发邀请 ====================
// v3.14.x：贴贴门独立（ai-cuddle-en），三类全关才算「邀请全关」
await setCfg('ai-rps-en', 0); await setCfg('ai-game-en', 0); await setCfg('ai-cuddle-en', 0);
const offRet = await evalJs("(function(){return window.tryActiveInvite(window.replyCfg());})()");
check('猜拳/游戏/贴贴开关全关时不触发邀请（返回 false）', offRet === false, String(offRet));
// 仅贴贴开时抽到的是贴贴卡（固定随机 0 → 100% 命中）
await setCfg('ai-cuddle-en', 1); await setCfg('ai-cuddle-prob', 100);
const cudRet = await evalJs("(function(){return window.tryActiveInvite(window.replyCfg());})()");
let cudMsg = '';
for (let i = 0; i < 20; i++) {
  cudMsg = await evalJs("(function(){var bs=document.querySelectorAll('#chat-body .msg-poke');if(!bs.length)return '';return bs[bs.length-1].textContent||'';})()") || '';
  if (cudMsg.indexOf('贴贴') >= 0 || cudMsg.indexOf('牵') >= 0 || cudMsg.indexOf('抱') >= 0) break;
  await sleep(200);
}
check('仅贴贴门开时发出贴贴邀请（含贴贴/牵手/抱话术）', cudRet === true && (cudMsg.indexOf('贴贴') >= 0 || cudMsg.indexOf('牵') >= 0 || cudMsg.indexOf('抱') >= 0), cudMsg);
await setCfg('ai-cuddle-prob', 5);

await restoreRandom();

// ==================== 8. 无 JS 异常 ====================
const errs = await evalJs('(window.__smokeErrs||[]).length') || 0;
check('全程无 JS 异常', errs === 0, String(errs));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
