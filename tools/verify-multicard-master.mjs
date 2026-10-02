// ===== 专项验证：#167 多字卡回复总开关（荣耀平板10Pro+Edge 用户报障：关了多字卡仍回多条） =====
// 用法：node tools/verify-multicard-master.mjs（无头浏览器行为断言，冻结 Math.random 做确定性对照）
//   rand=0.3 → hit(50) 命中（多字卡拼接 3 张）、count=randInt(1,2)=1
//   rand=0.9 → hit(任意≤90) 不中、count=randInt(1,2)=2
// 断言语义（#167 终版）：S0 默认 py-en 开 → 1 气泡拼 3 卡；
//   S1 UI 真点关闭 py-en（回复条数保持默认 1~2）→ 总开关强制单条 = 只回 1 个气泡
//   （未含 #167 的旧产物上此用例实测 2 = 修复未构建，FAIL 属预期）；
//   S2 UI 重新开启 py-en → 开启时行为不变：按回复条数拆 2 条。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
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
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
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
const udd = join(process.env.TEMP || '/tmp', 'mochi-mc-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 80));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + udd, '--remote-debugging-port=' + cdpPort, 'about:blank'
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
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r && r.exceptionDetails) { console.log('EVAL-ERR', JSON.stringify(r.exceptionDetails).slice(0, 200)); return null; }
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
const t = (n, c, d) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, d || ''); } };

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();return true;})()");
  await sleep(500);
  await evalJs("(function(){var c=document.getElementById('splash-confirm');if(c&&!c.hidden){var b=c.querySelector('#splash-confirm-ok');if(b)b.click();}return true;})()");
  await sleep(900);
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return true;})()");
  await sleep(800);

  // 压噪：把所有会加消息/换回复形态的概率门全部关掉，只留「回复条数」这一个变量
  const NOISE = { 'rn-prob': 0, 'touch-prob': 0, 'sticker-prob': 0, 'emoji-prob': 0, 'image-prob': 0, 'voice-prob': 0,
    'kaomoji-prob': 0, 'quote-prob': 0, 'rc-prob': 0, 'rc-refix': 0, 'cf-prob': 0, 'as-en': 0, 'call-incoming': 0,
    'ckq-en': 0, 'ai-rps-en': 0, 'ai-game-en': 0, 'ai-cuddle-en': 0, 'ai-cc-en': 0, 'desk-call-prob': 0, 'rs-min': 1, 'rs-max': 2 };
  const seedNoise = () => evalJs('(function(){var o=' + JSON.stringify(NOISE) + ';for(var k in o)window.saveReplyCfg(k,o[k]);return true;})()');
  const patchExtras = () => evalJs("(function(){window.tryTaMoodShare=function(){return null;};window.maybeMusicRequest=null;window.callMaybeTrigger=null;window.maybeAutoGift=null;window.periodCheckCare=null;window.triggerEmotionChain=function(){return null;};return true;})()");
  const freeze = (v) => evalJs('(function(){window.__realRandom=Math.random;Math.random=function(){return ' + v + ';};return true;})()');
  const unfreeze = () => evalJs('(function(){if(window.__realRandom){Math.random=window.__realRandom;window.__realRandom=null;}return true;})()');
  const inCount = () => evalJs("document.querySelectorAll('#chat-body .msg.msg-in').length");
  const inTexts = () => evalJs("JSON.stringify([].slice.call(document.querySelectorAll('#chat-body .msg.msg-in .msg-bubble')).map(function(b){return (b.innerText||'').trim().slice(0,50);}))");
  async function sendOnce(label, expectCount) {
    const before = await inCount();
    await evalJs("(function(){document.getElementById('chat-input').innerText='你好呀';document.getElementById('chat-send').click();return true;})()");
    await sleep(8000);
    const after = await inCount();
    const n = after - before;
    t(label + '：TA 回 ' + expectCount + ' 个气泡（实测 ' + n + '）', n === expectCount, 'texts=' + (await inTexts()));
    return n;
  }

  await seedNoise(); await patchExtras();

  // S0：默认（py-en 未写过=默认开 1），冻结 0.3 → 多字卡拼接命中，count=1
  await freeze(0.3);
  t('S0 前置 py-en 默认=1', (await evalJs('window.replyCfg()["py-en"]')) === 1);
  await sendOnce('S0 默认（多字卡开）', 1);
  await unfreeze();

  // S1：UI 真点关闭「多字卡回复」，回复条数保持默认 1~2，冻结 0.9 →
  //     #167 总开关语义：关=回复条数强制 1 → 只回 1 个气泡
  //     （在未含 #167 的旧产物上这里会实测 2 = 修复未构建，FAIL 属预期）
  await evalJs("(function(){document.getElementById('py-en').click();return true;})()");
  await sleep(300);
  const pyAfter = await evalJs('window.replyCfg()["py-en"]');
  const lsKey = await evalJs("(function(){for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(/reply-py-en$/.test(k))return k+'='+localStorage.getItem(k);}return 'none';})()");
  t('S1 UI 点关多字卡后 cfg=0 且落盘', pyAfter === 0 && /reply-py-en.*=0/.test(lsKey), 'cfg=' + pyAfter + ' ls=' + lsKey);
  await freeze(0.9);
  await sendOnce('S1 多字卡关（总开关强制单条，回复条数仍默认1~2）', 1);
  await unfreeze();

  // S2：UI 重新开启「多字卡回复」，冻结 0.9 → 开启时行为不变：count=2 拆 2 条
  await evalJs("(function(){document.getElementById('py-en').click();return true;})()");
  await sleep(300);
  const pyOn = await evalJs('window.replyCfg()["py-en"]');
  t('S2 UI 重新开启后 cfg=1', pyOn === 1, 'cfg=' + pyOn);
  await freeze(0.9);
  await sendOnce('S2 多字卡开（按回复条数拆条）', 2);
  await unfreeze();

  console.log(pass + ' 通过 / ' + fail + ' 失败');
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { rmSync(udd, { recursive: true, force: true }); } catch (e) {}
}
process.exitCode = fail ? 1 : 0;
