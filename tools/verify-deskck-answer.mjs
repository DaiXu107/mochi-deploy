// ===== 专项验证：#648 跨桌面查岗「要不要来查查我呀？」弹窗作答后聊天互动卡片必须同步更新 =====
// 用户报障：联系人弹窗叫我查岗（要不要来查查我呀？）→ 点【好呀】→ 聊天里的互动卡片没有变化，需要再点一次。
// 根因：查岗自动弹窗作答链路把「推卡瞬间抓的 msgs 下标」直接交给 chatAskReply，而 msgs 会被
//       loadMsgs IDB 合并 / chatTailMerge 回放插入整体重排（#407 下标位移同族）；下标过期后
//       msgs[msgIdx] 不再是未作答 ask-card → chatAskReply 静默 return＝回答丢失、卡片不变；
//       用户再点卡片（实时 DOM 下标）才成功＝「需要再点一次」。修复＝ta-ask.js v3.6.x
//       locateCardIdx 同款守卫：槽位失效时从末尾回退找最近未作答同类卡（chatAskReply 内 +
//       ta-ask 包装层探针同步重定位，防查岗卡误进「TA的询问」记录）。
// 用例组：
//   A 后台落卡 → 点卡片就地展开 → 点选项 → 卡片变 answered（真实 UI 回归）
//   B 前台「来查岗了」弹窗 → 确认 → 自动弹窗点【好呀】→ 卡片变 answered（真实 UI 回归）
//   C 过期下标作答（RED 判别点）：chatAskReply(0,…) 指向 ask-msg 提示条 → 回答必须落到
//     最新未作答查岗卡上（rec + DOM 双确认），且「TA的询问」记录不被污染、重复作答不双写
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
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
let cssFiles = [], jsFiles = [];
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  cssFiles = (bm.match(/const cssFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  jsFiles = (bm.match(/const jsFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => '(function () { try {\n' + readFileSync(join(root, 'src/js', f), 'utf8') + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();').join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-deskck-answer').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-deskck-verify-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(tmpRoot, rel));
    if (!p.startsWith(tmpRoot)) { res.writeHead(403); res.end(); return; }
    let hit = false;
    try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) {
      p = normalize(join(root, rel));
      if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
      try { hit = statSync(p).isFile(); } catch (e) {}
    }
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-deskck-verify-prof-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 160; i++) {
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
    await sleep(250);
  }
  throw new Error('无法连接 Chrome');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}
await cdpConnect();

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}
async function navigate(url) { await cdp('Page.navigate', { url }); await sleep(4200); }

// 状态快照：聊天里 ask-card 的 DOM 状态 + 存储层最新 ask-card + 询问记录条数
const SNAP = `(function () {
  const cards = Array.prototype.map.call(document.querySelectorAll('#chat-body .msg-ask'), function (el) {
    const card = el.querySelector('.msg-ask-card');
    return {
      idx: el.dataset.idx,
      answered: !!(card && card.classList.contains('answered')),
      text: (card && card.querySelector('.msg-ask-q') ? card.querySelector('.msg-ask-q').textContent : ''),
      ans: (card && card.querySelector('.msg-ask-a') ? card.querySelector('.msg-ask-a').textContent : '')
    };
  });
  let rec = null, recIdx = -1, outs = 0;
  try {
    const arr = (window.getChatMsgs ? window.getChatMsgs() : []);
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] && arr[i].special === 'ask-card') {
        rec = { askStatus: arr[i].askStatus || '', askAnswer: arr[i].askAnswer || '', deskCkDir: arr[i].deskCkDir || '', text: arr[i].text || '' };
        recIdx = i; break;
      }
    }
    outs = arr.filter(function (m) { return m && m.side === 'out'; }).length;
  } catch (e) {}
  let askHist = -1;
  try {
    const d = JSON.parse(localStorage.getItem('xy-home-v2:cta:ta-ask') || 'null');
    if (d && Array.isArray(d.history)) askHist = d.history.length;
  } catch (e) {}
  return { cards: cards, rec: rec, recIdx: recIdx, outs: outs, askHist: askHist, errs: (window.__jsErrors || []).slice(-3) };
})()`;

// 强制 buildDeskCkCard 走 meToTa（联系人申请我查 TA →「要不要来查查我呀？」+好呀/不要）
const FORCE_METOTA = `(function () {
  window.buildDeskCkCard = function () {
    return { deskCkDir: 'meToTa', text: '要不要来查查我呀？', hint: '联系人想让你来查岗 TA。', opts: [{ t: '好呀', reply: null }, { t: '不要', reply: null }], askType: 'single' };
  };
  return true;
})()`;

const SEED = `(function () {
  localStorage.clear();
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify([
    { id: 'default', name: '宝贝' },
    { id: 'cta', name: '小桃' }
  ]));
  localStorage.setItem('xy-home-v2:active-contact', 'default');
  localStorage.setItem('xy-home-v2:cta:reply-ckq-popup-prob', '100');
  return true;
})()`;
const RESET = `(function(){ try { indexedDB.deleteDatabase('mochi-db'); } catch (e) {}; return true; })()`;

async function freshSeed() {
  await navigate(baseUrl + '/index.html'); // 先到真实 origin（about:blank 上 localStorage 被拒）
  await evalJs(RESET + '; ' + SEED);
  await navigate(baseUrl + '/index.html'); // 重载让种子生效
}

console.log('== 链路 A：后台落卡 → 点卡片就地展开 → 点选项 ==');
await freshSeed();
await evalJs("(function(){ if (window.setActiveContact) window.setActiveContact('cta'); return true; })()");
await sleep(2500);
await evalJs("(function(){ if (window.enterChat) window.enterChat(); return true; })()");
await sleep(1000);
await evalJs(FORCE_METOTA + " ; (function(){ try { window.chatAppendDeskCkTo('cta', { type:'single', text:'测试题?' }); return true; } catch (e) { return String(e); } })()");
await sleep(800);
let st = await evalJs(SNAP);
const a1 = st && st.cards.find(c => c.text.indexOf('要不要来查查我呀') >= 0);
ok('A1 落卡在聊天里且未作答', a1 && !a1.answered, st && st.cards);
ok('A2 无 JS 异常', st && st.errs.length === 0, st && st.errs);
await evalJs("(function(){ const el=document.querySelector('#chat-body .msg-ask .msg-ask-card'); if (el) el.click(); return true; })()");
await sleep(600);
const ipN = await evalJs("(function(){ return document.querySelectorAll('#chat-body .msg-inplace .ip-opt').length; })()");
ok('A2 就地展开出选项按钮', ipN >= 2, ipN);
await evalJs("(function(){ const os=document.querySelectorAll('#chat-body .msg-inplace .ip-opt'); for (let i=0;i<os.length;i++){ if(os[i].textContent==='好呀'){ os[i].click(); break; } } return true; })()");
await sleep(1200);
st = await evalJs(SNAP);
ok('A3 rec.askStatus=answered', st && st.rec && st.rec.askStatus === 'answered', st && st.rec);
ok('A3 卡片 DOM 变 answered', st && st.cards.some(c => c.text.indexOf('要不要来查查我呀') >= 0 && c.answered), st && st.cards);
ok('A3 查岗卡不进「TA的询问」记录', st && st.askHist <= 0, st && st.askHist);

console.log('== 链路 B：前台「来查岗了」弹窗 → 确认 → 自动弹窗点【好呀】 ==');
await freshSeed();
await evalJs("(function(){ return window.triggerIncomingCheckin ? window.triggerIncomingCheckin('cta') : false; })()");
await sleep(700);
st = await evalJs("(function(){ var m=document.getElementById('modal-mask'), t=document.getElementById('modal-title'); return { open: !!(m && !m.hidden), title: t ? t.textContent : '' }; })()");
ok('B1 「来查岗了」弹窗出现', st && st.open && st.title.indexOf('来查岗了') >= 0, st);
await evalJs(FORCE_METOTA + " ; (function(){ document.getElementById('modal-ok').click(); return true; })()");
let saw = null;
for (let i = 0; i < 34; i++) {
  await sleep(300);
  const t = await evalJs("(function(){ var m=document.getElementById('modal-mask'), ti=document.getElementById('modal-title'); return { open: !!(m && !m.hidden), title: ti ? ti.textContent : '' }; })()");
  if (t && t.open && t.title === '查岗回答') { saw = t; break; }
}
ok('B2 自动弹窗「查岗回答」出现', !!saw, saw);
if (saw) {
  await evalJs("(function(){ const ps=document.getElementById('modal-pills').children; for (let i=0;i<ps.length;i++){ if(ps[i].textContent==='好呀'){ ps[i].click(); break; } } return true; })()");
  await sleep(1500);
}
st = await evalJs(SNAP);
ok('B3 rec.askStatus=answered', st && st.rec && st.rec.askStatus === 'answered', st && st.rec);
ok('B3 卡片 DOM 变 answered 且显示已答', st && st.cards.some(c => c.text.indexOf('要不要来查查我呀') >= 0 && c.answered && c.ans.indexOf('好呀') >= 0), st && st.cards);
ok('B3 无 JS 异常', st && st.errs.length === 0, st && st.errs);

console.log('== 链路 C：过期下标作答（RED 判别点：修复前此回答被静默丢弃） ==');
await freshSeed();
await evalJs("(function(){ if (window.setActiveContact) window.setActiveContact('cta'); return true; })()");
await sleep(2500);
await evalJs("(function(){ if (window.enterChat) window.enterChat(); return true; })()");
await sleep(1000);
// ckq-popup-prob=0 关掉自动弹窗，保持现场纯净；推一张 deskCk meToTa 卡（hint 占 idx0 → 卡在 idx1）
await evalJs(FORCE_METOTA + " ; (function(){ return window.ckQuestionFire ? (window.ckQuestionFire({ type:'single', text:'测试题?' }, { 'ckq-popup-prob': 0 }) || false) : false; })()");
await sleep(800);
st = await evalJs(SNAP);
ok('C1 查岗卡已推入且未作答', st && st.rec && !st.rec.askStatus && st.rec.deskCkDir === 'meToTa', st && st.rec);
ok('C1 卡片 DOM 未作答', st && st.cards.some(c => c.text.indexOf('要不要来查查我呀') >= 0 && !c.answered), st && st.cards);
const recIdx = st ? st.recIdx : -1;
ok('C2 卡片下标>0（idx0 被 ask-msg 提示条占用＝过期下标现场成立）', recIdx > 0, recIdx);
// 以过期下标 0（指向 ask-msg 提示条）作答——修复前 msgs[0] 非 ask-card → 静默丢回答
const cRet = await evalJs("(function(){ try { return window.chatAskReply(0, '好呀', null) === undefined ? 'undefined' : 'reply'; } catch (e) { return 'err:' + e.message; } })()");
await sleep(1000);
st = await evalJs(SNAP);
ok('C3 过期下标作答：rec.askStatus=answered（回答不丢）', st && st.rec && st.rec.askStatus === 'answered', st && st.rec);
ok('C3 过期下标作答：卡片 DOM 变 answered（用户可见，无需再点一次）', st && st.cards.some(c => c.text.indexOf('要不要来查查我呀') >= 0 && c.answered && c.ans.indexOf('好呀') >= 0), st && st.cards);
ok('C3 回答气泡已发出（out 侧 1 条）', st && st.outs === 1, st && st.outs);
ok('C3 查岗卡不进「TA的询问」记录（包装层 deskCk 旁路在错位下标下仍生效）', st && st.askHist <= 0, st && st.askHist);
// 重复作答守卫：再以过期下标调用 → 已无未作答卡 → 静默返回，不双写
const outBefore = st.outs;
await evalJs("(function(){ try { window.chatAskReply(0, '好呀', null); } catch (e) {} return true; })()");
await sleep(600);
st = await evalJs(SNAP);
ok('C4 重复作答不双写（out 仍 1 条）', st && st.outs === outBefore, st && { outs: st.outs, before: outBefore });
ok('C4 无 JS 异常', st && st.errs.length === 0, st && st.errs);

console.log('----');
console.log('通过 ' + pass + ' / 失败 ' + fail);
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);
