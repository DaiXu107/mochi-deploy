// 验证 TA查岗互动动作：预设 6 个 action 卡入库、能被抽到、推卡渲染为单选 ask-card、回答后 TA 回应
// 用法：node tools/verify-ck-action.mjs（需先 node build.mjs）
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-ckact-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
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
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}

await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(800);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(600);
// 切到聊天页
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});})()");
await sleep(400);

// 1. 题库里有 6 个 action 预设
const bankInfo = await evalJs('window.__ckBankInfo ? JSON.stringify(window.__ckBankInfo()) : null');
check('题库加载成功', !!bankInfo, bankInfo || 'null');
const bank = bankInfo ? JSON.parse(bankInfo) : {};
check('题库总数 ≥ 23（17 问题 + 6 动作）', bank.total >= 23, 'total=' + bank.total);

// 2. 多次触发查岗，统计 action 卡出现次数（action 占 6/23≈26%，触发 40 次期望 ~10 次）
let actionHits = 0, totalTriggers = 0;
const actionTexts = new Set();
for (let i = 0; i < 40; i++) {
  // 清空聊天
  await evalJs("(function(){try{var b=document.getElementById('chat-body');if(b)b.innerHTML='';}catch(e){}return true;})()");
  // 触发一次查岗（forceIdx 循环覆盖所有题，确保抽到 action）
  const idx = i % (bank.total || 23);
  await evalJs('window.triggerCkQuestion && window.triggerCkQuestion(' + idx + ')');
  await sleep(150);
  // 检查聊天里是否出现 ask-card 且文案是动作方向文案
  const cardInfo = await evalJs("(function(){var c=document.querySelector('.msg-ask-card');if(!c)return null;var q=c.querySelector('.msg-ask-q');var tip=c.querySelector('.msg-ask-tip');return JSON.stringify({q:q?q.textContent:'',tip:tip?tip.textContent:''});})()");
  if (cardInfo) {
    totalTriggers++;
    const info = JSON.parse(cardInfo);
    // action 卡的文案以"TA 想"开头
    if (info.q && info.q.indexOf('TA 想') === 0) {
      actionHits++;
      actionTexts.add(info.q);
    }
  }
}
check('触发查岗能出卡', totalTriggers >= 30, '成功 ' + totalTriggers + '/40 次');
check('互动动作卡能被抽到', actionHits >= 5, 'action 出现 ' + actionHits + ' 次');
check('互动动作文案多样（≥2 种）', actionTexts.size >= 2, '文案种类 ' + actionTexts.size + '：' + Array.from(actionTexts).slice(0, 3).join(' / '));

// 3. 找到 action 卡并测试作答流程
await evalJs("(function(){try{var b=document.getElementById('chat-body');if(b)b.innerHTML='';}catch(e){}return true;})()");
let foundAction = false;
for (let i = 0; i < (bank.total || 23); i++) {
  await evalJs("(function(){try{var b=document.getElementById('chat-body');if(b)b.innerHTML='';}catch(e){}return true;})()");
  await evalJs('window.triggerCkQuestion && window.triggerCkQuestion(' + i + ')');
  await sleep(150);
  const q = await evalJs("(function(){var c=document.querySelector('.msg-ask-card .msg-ask-q');return c?c.textContent:'';})()");
  if (q && q.indexOf('TA 想') === 0) { foundAction = true; break; }
}
check('找到 action 卡', foundAction, foundAction ? '已找到' : '未找到');
if (foundAction) {
  // 点击卡片就地展开选项（single 类型走 ip-opt 选项按钮，不走弹窗）
  await evalJs("(function(){var c=document.querySelector('.msg-ask-card');if(c){try{c.click();}catch(e){}}return true;})()");
  await sleep(500);
  const optInfo = await evalJs("(function(){var opts=document.querySelectorAll('.ip-opt, .msg-ask-card button');var arr=[];opts.forEach(function(o){arr.push(o.textContent.trim());});return JSON.stringify({count:arr.length,opts:arr});})()");
  check('action 卡展开有选项按钮', !!optInfo, optInfo || '无选项');
  if (optInfo) {
    const oi = JSON.parse(optInfo);
    check('选项含"好呀"', oi.opts.some(p => p.indexOf('好呀') >= 0), JSON.stringify(oi.opts));
    check('选项含"不要"', oi.opts.some(p => p.indexOf('不要') >= 0), JSON.stringify(oi.opts));
    // 点击"好呀"作答
    const clicked = await evalJs("(function(){var opts=document.querySelectorAll('.ip-opt, .msg-ask-card button');for(var i=0;i<opts.length;i++){if(opts[i].textContent.indexOf('好呀')>=0){try{opts[i].click();}catch(e){}return true;}}return false;})()");
    await sleep(400);
    check('点击"好呀"作答成功', !!clicked, clicked ? '已点击' : '未找到按钮');
    // 检查 TA 回应消息出现
    const taReply = await evalJs("(function(){var ins=document.querySelectorAll('.msg-in .msg-bubble');if(!ins.length)return '';return ins[ins.length-1].textContent;})()");
    check('TA 应回应', !!taReply && taReply.length > 0, taReply ? taReply.slice(0, 40) : '无回应');
  }
}

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);