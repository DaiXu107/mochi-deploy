// ===== 扩展验证脚本：检查多个页面的手机端布局 =====
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
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9300 + Math.floor(Math.random() * 500));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-' + Date.now()),
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
await cdp('Page.enable');
await cdp('Runtime.enable');

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

async function runViewport(w, h) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(900);

  // Check home page (page-phone)
  const home = JSON.parse(await evalJs("(function(){var ph=document.querySelector('.phone');var pr=ph.getBoundingClientRect();var st=document.querySelector('.statusbar');return JSON.stringify({zoom:getComputedStyle(ph).zoom,statusbar:getComputedStyle(st).display,phoneW:Math.round(pr.width),innerW:innerWidth});})()") || '{}');
  check(w + 'x' + h + ' 首页 无整页缩放', home.zoom === '1', String(home.zoom));
  check(w + 'x' + h + ' 首页 状态栏显示', home.statusbar === 'flex', home.statusbar);
  check(w + 'x' + h + ' 首页 手机屏占满', home.phoneW >= home.innerW - 20, home.phoneW + ' vs ' + home.innerW);

  // Check chat page
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});})()");
  await sleep(500);
  const chat = JSON.parse(await evalJs("(function(){var ph=document.querySelector('.phone');var pr=ph.getBoundingClientRect();var pg=document.getElementById('page-chat');var ch=pg.querySelector('.chat-head');var ir=pg.querySelector('.chat-input-row');if(!ch||!ir)return '{}';return JSON.stringify({head:true,inputBottom:Math.round(ir.getBoundingClientRect().bottom-pr.top),phoneH:Math.round(pr.height)});})()") || '{}');
  check(w + 'x' + h + ' 聊天页 顶栏存在', chat.head === true);
  if (chat.head === true) check(w + 'x' + h + ' 聊天页 输入栏贴底', chat.inputBottom >= chat.phoneH - 5, chat.inputBottom + ' vs ' + chat.phoneH);

  // Check settings page (page-setting)
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-setting');});})()");
  await sleep(300);
  const setting = JSON.parse(await evalJs("(function(){var ph=document.querySelector('.phone');var pr=ph.getBoundingClientRect();var pg=document.getElementById('page-setting');var hasContent=pg&&!pg.hidden&&pg.children.length>0&&pg.getBoundingClientRect().height>120;return JSON.stringify({phoneH:Math.round(pr.height),hasContent:!!hasContent});})()") || '{}');
  check(w + 'x' + h + ' 设置页 内容存在', setting.hasContent === true);

  // Check calendar page (page-calendar)
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-calendar');});})()");
  await sleep(300);
  const cal = JSON.parse(await evalJs("(function(){var ph=document.querySelector('.phone');var pr=ph.getBoundingClientRect();var pg=document.getElementById('page-calendar');var hasContent=pg&&pg.querySelector('.cal-scroll');return JSON.stringify({phoneH:Math.round(pr.height),hasContent:!!hasContent});})()") || '{}');
  check(w + 'x' + h + ' 日历页 内容存在', cal.hasContent === true);

  // Check mail page (page-mail)
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-mail');});})()");
  await sleep(300);
  const mail = JSON.parse(await evalJs("(function(){var ph=document.querySelector('.phone');var pr=ph.getBoundingClientRect();var pg=document.getElementById('page-mail');var hasContent=pg&&pg.querySelector('#mail-in-list');return JSON.stringify({phoneH:Math.round(pr.height),hasContent:!!hasContent});})()") || '{}');
  check(w + 'x' + h + ' 信箱页 内容存在', mail.hasContent === true);

  // Check feed page (page-feed)
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-feed');});})()");
  await sleep(300);
  const feed = JSON.parse(await evalJs("(function(){var ph=document.querySelector('.phone');var pr=ph.getBoundingClientRect();var pg=document.getElementById('page-feed');var hasContent=pg&&!pg.hidden&&pg.children.length>0&&pg.getBoundingClientRect().height>120;return JSON.stringify({phoneH:Math.round(pr.height),hasContent:!!hasContent});})()") || '{}');
  check(w + 'x' + h + ' 朋友圈页 内容存在', feed.hasContent === true);

  // Check divination page (page-divine，旧 id page-divination 已改名)
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-divine');});})()");
  await sleep(300);
  const div = JSON.parse(await evalJs("(function(){var ph=document.querySelector('.phone');var pr=ph.getBoundingClientRect();var pg=document.getElementById('page-divine');var hasContent=pg&&!pg.hidden&&pg.children.length>0&&pg.getBoundingClientRect().height>120;return JSON.stringify({phoneH:Math.round(pr.height),hasContent:!!hasContent});})()") || '{}');
  check(w + 'x' + h + ' 占卜页 内容存在', div.hasContent === true);

  // Check memory page (page-memory)
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-memory');});})()");
  await sleep(300);
  const mem = JSON.parse(await evalJs("(function(){var ph=document.querySelector('.phone');var pr=ph.getBoundingClientRect();var pg=document.getElementById('page-memory');var hasContent=pg&&pg.querySelector('.mem-scroll');return JSON.stringify({phoneH:Math.round(pr.height),hasContent:!!hasContent});})()") || '{}');
  check(w + 'x' + h + ' 纪念页 内容存在', mem.hasContent === true);

  // Check chat-card page (page-chatcard)
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chatcard');});})()");
  await sleep(300);
  const cc = JSON.parse(await evalJs("(function(){var ph=document.querySelector('.phone');var pr=ph.getBoundingClientRect();var pg=document.getElementById('page-chatcard');var hasContent=pg&&!pg.hidden&&pg.children.length>0&&pg.getBoundingClientRect().height>120;return JSON.stringify({phoneH:Math.round(pr.height),hasContent:!!hasContent});})()") || '{}');
  check(w + 'x' + h + ' 字卡库页 内容存在', cc.hasContent === true);
}

for (const [w, h] of [[390, 844], [360, 640]]) {
  try { await runViewport(w, h); }
  catch (e) { console.error('视口 ' + w + 'x' + h + ' 检查异常: ' + e); }
}

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);