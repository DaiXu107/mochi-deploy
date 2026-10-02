// ===== 验证：#400 装修意图标记第二批——经期倒计时卡可删除 + 群聊图标可挪位 =====
// 回归 v3.26.x #400（无头探针实证，#380/#393 意图被自动逻辑覆盖同族）：
//   A. 装修「移出此页」删掉的经期倒计时卡，刷新后被 ensureDeskPeriod 自动补位拉回，
//      且每删一次多建一整页（实测 3 页变 4 页）；修复=移除标记 desk-period-removed，
//      组件库显式加回时清除；
//   B. 群聊图标从组件库加到其他页，退出装修即被 applyGroupChatMode 强制拽回聊天右侧；
//      修复=位置标记 group-chat-desk-pin（同 #393 divination-desk-pin 约定），关群聊清除。
// 用法：node tools/verify-desk-intent-markers.mjs（需先 node build.mjs）
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
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 400));
const userDataDir = join(process.env.TEMP || '/tmp', 'mochi-dpint-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + userDataDir,
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
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return null;
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) { results.push(!!ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

const posOf = (sel) => evalJs(`(function(){ var n=document.querySelector('${sel}'); if(!n) return 'MISSING';
  var pool=document.getElementById('desk-widget-pool'); if(pool&&n.parentNode===pool) return 'POOL';
  var s=n.closest('.page-slide'); return s?'page'+Array.prototype.indexOf.call(document.querySelectorAll('.page-slide'),s)+(n.closest('.app-grid')?'(grid)':'(widget)'):'other'; })()`);
const pageCnt = () => evalJs('document.querySelectorAll(".page-slide").length');
const getStore = (k) => evalJs(`(function(){ try { return window.activeStore().get('${k}') || ''; } catch(e){ return 'ERR'; } })()`);

const nav = async () => {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
  await sleep(400);
  await evalJs("(function(){var c=document.getElementById('splash-confirm-ok');if(c&&!c.hidden)c.click();return 1;})()");
  await sleep(400);
  await evalJs("(function(){var s=document.getElementById('splash');if(s)s.classList.add('hide');return 1;})()");
  await sleep(700);
};
const enterDecor = async () => { await evalJs(`(function(){ var r=document.getElementById('row-custom-icon'); if(r) r.click(); return 1; })()`); await sleep(600); };
const exitDecor = async () => { await evalJs(`(function(){ if(window.exitDecor) window.exitDecor(); return 1; })()`); await sleep(500); };
// 装修模式点卡片菜单 → 点 pill → 点确定
const cardOut = async (cardBg) => {
  await evalJs(`(function(){ var c=document.querySelector('[data-card-bg="${cardBg}"]'); if(!c) return -1; c.click(); return 1; })()`);
  await sleep(500);
  return evalJs(`(function(){
    var btns=[].slice.call(document.querySelectorAll('#modal-pills button'));
    var b=btns.find(function(x){return (x.textContent||'').indexOf('移出此页')>=0;});
    if(!b) return -1; b.click();
    var ok=document.getElementById('modal-ok'); if(ok) ok.click();
    return 1;
  })()`);
};
// 装修组件库把图标/组件加到当前页
const libAdd = async (name) => {
  await evalJs(`(function(){ var b=document.getElementById('decor-add-widget'); if(b) b.click(); return 1; })()`);
  await sleep(500);
  const r = await evalJs(`(function(){
    var l=document.querySelector('.desk-lib'); if(!l) return -1;
    var t=[].slice.call(l.querySelectorAll('.desk-lib-icon,.desk-lib-item')).find(function(x){return (x.textContent||'').indexOf('${name}')>=0;});
    if(!t) return -2; var b=t.querySelector('.dl-btn')||t; if(b.disabled) return -3; b.click(); return 1;
  })()`);
  await sleep(600);
  return r;
};

console.log('== A. 经期倒计时卡：移出 → 刷新不复活、不多建页 ==');
await nav();
await enterDecor();
const outR = await cardOut('desk-period');
check('A1 装修菜单「移出此页」执行成功', outR === 1, 'r=' + outR);
check('A2 移出后经期卡在隐藏池', await posOf('[data-desk-widget="desk-period"]') === 'POOL');
const layHas = await evalJs(`(function(){ try { var v=window.activeStore().get('desk-layout'); return v? v.indexOf('desk-period')>=0 : 'nolay'; } catch(e){ return 'ERR'; } })()`);
check('A3 布局已保存且不含 desk-period', layHas === false, 'lay=' + layHas);
await exitDecor();
const pagesBefore = await pageCnt();
await nav(); // 刷新（修前此处：卡被拉回 + 新建一页 3→4）
await sleep(1000);
check('A4 刷新后经期卡仍在隐藏池（不再自动补位）', await posOf('[data-desk-widget="desk-period"]') === 'POOL');
check('A5 刷新后页数不变（不再多建一页）', await pageCnt() === pagesBefore, pagesBefore + '→' + await pageCnt());
check('A6 移除标记已落盘', await getStore('desk-period-removed') === '1');

console.log('== B. 经期卡从组件库加回 = 清除标记 ==');
await enterDecor();
const addR = await libAdd('经期倒计时');
await exitDecor();
check('B1 组件库加回经期卡成功', addR === 1, 'r=' + addR);
check('B2 加回后不在隐藏池', await posOf('[data-desk-widget="desk-period"]') !== 'POOL');
check('B3 移除标记已清除', await getStore('desk-period-removed') !== '1', 'v=' + await getStore('desk-period-removed'));

console.log('== C. 群聊图标：加到第二页 → 退装修留得住 ==');
await evalJs(`(function(){ window.xyStore('xy-home-v2').set('group-chat-enabled','1'); document.dispatchEvent(new Event('group-chat-mode-changed')); return 1; })()`);
await sleep(500);
check('C1 开群聊：群聊图标默认在首页聊天右侧', await posOf('.app[data-app="group-chat"]') === 'page0(grid)');
await enterDecor();
await evalJs(`(function(){ var pb=document.getElementById('desktop-pages'); pb.scrollLeft = pb.clientWidth; return 1; })()`);
await sleep(400);
const gcR = await libAdd('群聊');
await exitDecor();
check('C2 组件库把群聊图标加到第二页成功', gcR === 1, 'r=' + gcR);
check('C3 退装修后群聊图标留在第二页（不再被拽回）', await posOf('.app[data-app="group-chat"]') === 'page1(grid)', '@' + await posOf('.app[data-app="group-chat"]'));
check('C4 位置标记已落盘', await getStore('group-chat-desk-pin') === '1');

console.log('== D. 关/开群聊：标记清除 + 默认位恢复 ==');
await evalJs(`(function(){ window.xyStore('xy-home-v2').set('group-chat-enabled','0'); document.dispatchEvent(new Event('group-chat-mode-changed')); return 1; })()`);
await sleep(500);
check('D1 关群聊：群聊图标回隐藏池', await posOf('.app[data-app="group-chat"]') === 'POOL');
check('D2 关群聊：位置标记已清除', await getStore('group-chat-desk-pin') !== '1');
await evalJs(`(function(){ window.xyStore('xy-home-v2').set('group-chat-enabled','1'); document.dispatchEvent(new Event('group-chat-mode-changed')); return 1; })()`);
await sleep(500);
check('D3 重开群聊：群聊图标回首页默认位', await posOf('.app[data-app="group-chat"]') === 'page0(grid)');

chrome.kill();
server.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' 断言通过');
process.exit(pass === results.length ? 0 : 1);
