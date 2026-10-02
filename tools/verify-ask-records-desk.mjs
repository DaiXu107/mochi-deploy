// ===== 回归脚本 #625：提问记录页「在联系人桌面发生的记录切回主页看不到」=====
// 用法：node tools/verify-ask-records-desk.mjs            # 打构建产物 index.html（需先构建）
//       node tools/verify-ask-records-desk.mjs --tmp      # 从 src 临时拼装（免构建、不写产物）
// verify-suite:timeout=300000
//
// 用户反馈（Redmi Note 12 Turbo / Chrome，v3.26.721，其他机型同报）：
//   「联系人提的问题和吐槽都不能在主页的【提问记录】里同步更新；主页里的记录也没能同步更新」
// 根因（零机型分支，纯逻辑）：提问记录页 5 个分类里，只有「TA的询问」做了跨桌面汇总，
//   小问题/好奇/吐槽/邀请·问问 仍 `tcLoad().history` 一类「只读当前桌面命名空间」。
//   而记录按设计写在【发生所在联系人桌面】⇒ 在联系人桌面产生的吐槽/小问题/好奇/邀请
//   切回主页（default）一律看不到＝用户所说的「不同步」。
// 修复：五个分类统一走 allDeskHistories()（各桌面合并 + ts 倒序），清空同口径清全桌面。
//
// 断言分四组：A 吐槽全链路（触发→作答→切桌面可见）、B 其余分类汇总、
//            C 清空口径 + 题库不被误伤、D 排序/单桌面/老档回退等边界。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || __root);
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

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
// --tmp：按 build.mjs 的 jsFiles/cssFiles 顺序从 src 拼一页（免构建、不写产物）
let tmpPage = null;
if (process.argv.includes('--tmp')) {
  const buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8');
  const cssList = Function('"use strict";return ' + buildSrc.match(/const cssFiles = (\[[^\]]+\]);/)[1])();
  const jsList = Function('"use strict";return ' + buildSrc.match(/const jsFiles = (\[[^\]]+\]);/)[1])();
  let tpl = readFileSync(join(root, 'src', 'template.html'), 'utf8');
  const css = cssList.map(f => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
  const js = jsList.map(f => readFileSync(join(root, 'src', 'js', f), 'utf8')).join('\n;\n');
  if (tpl.indexOf('/*__STYLES__*/') >= 0) tpl = tpl.replace('/*__STYLES__*/', () => css);
  else tpl = tpl.replace('</head>', () => '<style>' + css + '</style></head>');
  if (tpl.indexOf('/*__SCRIPTS__*/') >= 0) tpl = tpl.replace('/*__SCRIPTS__*/', () => js);
  else tpl = tpl.replace('</body>', () => '<script>' + js + '</scr' + 'ipt></body>');
  tmpPage = join(root, 'tmp-625-ask-records.html');
  writeFileSync(tmpPage, tpl);
}

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9920 + Math.floor(Math.random() * 70));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-askrec-' + Date.now()),
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
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
const jsErrors = [];
await cdp('Log.enable').catch(() => {});
ws.addEventListener('message', (ev) => {
  try { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') jsErrors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || 'err'); } catch (e) {}
});
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + (tmpPage ? '/tmp-625-ask-records.html' : '/index.html') });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);

let pass = 0, fail = 0;
const failed = [];
function check(desc, ok, detail) {
  if (ok) pass++; else { fail++; failed.push(desc); }
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + String(detail).slice(0, 200) + ']' : ''));
}

// ---- 工具 ----
async function enterChat() {
  await evalJs(`(function(){ var app = document.querySelector('.app[data-app="chat"]'); if (app) app.click(); return true; })()`);
  await sleep(800);
}
async function openRecords() {
  await evalJs(`(function(){ var app = document.querySelector('.app[data-app="interact"]'); if (app) app.click(); return true; })()`);
  await sleep(400);
}
async function panel(id) {
  const n = await evalJs(`(function(){ var el=document.getElementById(${JSON.stringify(id)}); return el ? el.querySelectorAll('.tc-listitem').length : -1; })()`);
  const texts = await evalJs(`(function(){ var el=document.getElementById(${JSON.stringify(id)}); if(!el) return null; return JSON.stringify(Array.prototype.slice.call(el.querySelectorAll('.tc-li-q')).map(function(x){return x.textContent;})); })()`);
  let list = [];
  try { list = JSON.parse(texts || '[]'); } catch (e) {}
  return { n, list };
}
// 找到最后一张指定 special 的未作答卡并作答（used for roast / curious，两者共用 qa-input/qa-send）
async function answerLastCard(special, statusKey, answer) {
  const idx = await evalJs(`(function(){
    var arr = window.getChatMsgs ? window.getChatMsgs() : [];
    for (var i = arr.length - 1; i >= 0; i--) { var r = arr[i]; if (r && r.special === ${JSON.stringify(special)} && r[${JSON.stringify(statusKey)}] !== 'answered') return i; }
    return -1;
  })()`);
  if (idx === null || idx < 0) return 'no card';
  const opener = special === 'ask-roast' ? 'openRoast' : 'openCurious';
  await evalJs(`window.${opener}(${idx}); true`);
  await sleep(300);
  await evalJs(`(function(){ var i=document.getElementById('qa-input'); if(i) i.value=${JSON.stringify(answer)}; return true; })()`);
  await sleep(150);
  await evalJs(`(function(){ var b=document.getElementById('qa-send'); if(b) b.click(); return true; })()`);
  await sleep(600);
  return 'ok';
}
// 直接按应用自身的持久化形态给指定桌面播种（读改写，不破坏题库）
async function seedDesk(cid, key, patch) {
  return await evalJs(`(function(){
    try {
      var st = window.xyStore('xy-home-v2:' + ${JSON.stringify(cid)});
      var raw = st.get(${JSON.stringify(key)});
      var d = raw ? JSON.parse(raw) : {};
      if (Array.isArray(d)) d = d.concat(${JSON.stringify(patch)});
      else { d.history = (d.history || []); d.history = ${JSON.stringify(patch)}.concat(d.history); }
      st.set(${JSON.stringify(key)}, JSON.stringify(d));
      return 'ok';
    } catch (e) { return 'err:' + e.message; }
  })()`);
}
async function deskLen(cid, key) {
  return await evalJs(`(function(){
    try {
      var raw = window.xyStore('xy-home-v2:' + ${JSON.stringify(cid)}).get(${JSON.stringify(key)});
      if (!raw) return 0;
      var d = JSON.parse(raw);
      if (Array.isArray(d)) return d.length;
      return (d.history || []).length;
    } catch (e) { return -1; }
  })()`);
}
async function deskQuestions(cid, key) {
  return await evalJs(`(function(){
    try {
      var raw = window.xyStore('xy-home-v2:' + ${JSON.stringify(cid)}).get(${JSON.stringify(key)});
      if (!raw) return 0;
      var d = JSON.parse(raw);
      return (d.questions || []).length;
    } catch (e) { return -1; }
  })()`);
}
async function setDesk(cid, key, json) {
  return await evalJs(`(function(){ try { window.xyStore('xy-home-v2:' + ${JSON.stringify(cid)}).set(${JSON.stringify(key)}, ${JSON.stringify(json)}); return 'ok'; } catch(e){ return 'err:'+e.message; } })()`);
}

// ============ 种子：两个联系人桌面 ============
const cidA = await evalJs(`window.createContact('记录甲');`);
check('S0 种子：创建联系人桌面 A', !!cidA, String(cidA));
await evalJs(`window.setActiveContact(${JSON.stringify(cidA)}); true`);
await sleep(600);

// ============ A 组：吐槽（用户报的原话场景）全链路 ============
await enterChat();
await evalJs(`window.triggerTaRoastNow(); true`);
await sleep(800);
const roastAns = await answerLastCard('ask-roast', 'roastStatus', '行吧我知道了');
check('A1 在联系人桌面 A 触发并作答一次吐槽', roastAns === 'ok', roastAns);
const aHist = await deskLen(cidA, 'ta-roast');
check('A2 吐槽记录按设计落在「发生所在桌面 A」', aHist === 1, 'n=' + aHist);

await evalJs(`window.setActiveContact('default'); true`);
await sleep(700);
await openRecords();
const roastOnDefault = await panel('ar-roast');
check('A3 切回主页（default）能在【提问记录·吐槽】看到 A 的吐槽（修复前：暂无吐槽记录）', roastOnDefault.n >= 1, JSON.stringify(roastOnDefault));
// A4 负向回归：原有「TA的询问」跨桌面汇总不得因本次重写而失效（播种保证确定性）
await seedDesk(cidA, 'ta-ask', [{ q: '询问甲题', a: '', reply: '', ts: Date.now() - 10000, status: 'pending' }]);
await evalJs(`window.renderAskRecords(); true`);
await sleep(200);
const askOnDefault = await panel('ar-ask');
check('A4 「TA的询问」原有跨桌面汇总不回归（负向：不因本次改动失效）', askOnDefault.n >= 1 && askOnDefault.list.join('|').indexOf('询问甲题') >= 0, JSON.stringify(askOnDefault));

// ============ B 组：小问题 / 好奇 / 邀请·问问 三个分类同口径 ============
const bSeed = [
  { q: '小问题甲题', my: '选项一', reply: '好呀', match: '✦ 刚好想到了一起', ts: Date.now() - 60000 },
  { q: '好奇甲题', my: '我的回答', reply: '我记住啦', ts: Date.now() - 50000 }
];
await seedDesk(cidA, 'ta-choose', [bSeed[0]]);
await seedDesk(cidA, 'ta-curious', [bSeed[1]]);
await setDesk(cidA, 'invite-ask-history', JSON.stringify([{ type: 'invite', q: '邀请甲内容', a: '接受', ts: Date.now() - 40000 }]));
await openRecords();
const chOnDefault = await panel('ar-choose');
check('B1 主页可见联系人桌面 A 的小问题记录', chOnDefault.n >= 1 && chOnDefault.list.join('|').indexOf('小问题甲题') >= 0, JSON.stringify(chOnDefault));
const cuOnDefault = await panel('ar-curious');
check('B2 主页可见联系人桌面 A 的好奇记录', cuOnDefault.n >= 1 && cuOnDefault.list.join('|').indexOf('好奇甲题') >= 0, JSON.stringify(cuOnDefault));
const inOnDefault = await panel('ar-invite');
check('B3 主页可见联系人桌面 A 的邀请/问问记录', inOnDefault.n >= 1 && inOnDefault.list.join('|').indexOf('邀请甲内容') >= 0, JSON.stringify(inOnDefault));

// 反向：切到 A 也能看到 default 桌面产生的记录（双向可见，不是单向聚合）
await seedDesk('default', 'ta-roast', [{ roast: '主页桌面吐槽', my: '我的回话', reply: '行吧', cat: 'light', ts: Date.now() - 30000 }]);
await seedDesk('default', 'ta-curious', [{ q: '主页桌面好奇', my: '答案', reply: '回应', ts: Date.now() - 20000 }]);
await evalJs(`window.setActiveContact(${JSON.stringify(cidA)}); true`);
await sleep(700);
await openRecords();
const roastOnA = await panel('ar-roast');
check('B4 切到联系人桌面 A 也能看到主页桌面产生的吐槽（双向）', roastOnA.n >= 2 && roastOnA.list.join('|').indexOf('主页桌面吐槽') >= 0, JSON.stringify(roastOnA.list));
const cuOnA = await panel('ar-curious');
check('B5 切到联系人桌面 A 也能看到主页桌面产生的好奇（双向）', cuOnA.n >= 2 && cuOnA.list.join('|').indexOf('主页桌面好奇') >= 0, JSON.stringify(cuOnA.list));

// ============ C 组：排序 + 清空口径 + 题库不被误伤 ============
// C1 排序：A 桌面 ts 更新的一条应排在 default 那条之前（全分类统一 ts 倒序）
await seedDesk('default', 'ta-curious', [{ q: '更旧的题', my: 'x', reply: 'y', ts: Date.now() - 500000 }]);
await evalJs(`window.setActiveContact('default'); true`);
await sleep(600);
await openRecords();
const order = await panel('ar-curious');
check('C1 多桌面合并后按时间倒序（最新的在前）', order.list[0] === '主页桌面好奇', JSON.stringify(order.list));

// C2 清空：清空「吐槽」应清掉全桌面（否则别桌记录立刻又出现＝清了个寂寞）
const beforeQs = await deskQuestions(cidA, 'ta-roast');
check('C2 清空前 A 桌面吐槽题库非空（用于验证清空不误伤题库）', beforeQs > 0, 'questions=' + beforeQs);
await evalJs(`document.getElementById('ar-roast-clear').click(); true`);
await sleep(400);
await evalJs(`document.getElementById('modal-ok').click(); true`);
await sleep(600);
const lenA = await deskLen(cidA, 'ta-roast');
const lenDef = await deskLen('default', 'ta-roast');
check('C3 清空吐槽后 A 桌面记录清空', lenA === 0, 'n=' + lenA);
check('C4 清空吐槽后主页桌面记录同样清空（全桌面口径）', lenDef === 0, 'n=' + lenDef);
const afterQs = await deskQuestions(cidA, 'ta-roast');
check('C5 清空只清记录，题库/设置不被误伤（读改写保留）', afterQs === beforeQs && afterQs > 0, 'before=' + beforeQs + ' after=' + afterQs);
const roastAfterClear = await panel('ar-roast');
check('C6 清空后列表即时显示为空态', roastAfterClear.n === 0, JSON.stringify(roastAfterClear));

// ============ D 组：边界 ============
// D1 老档回退：default 桌面的记录只存在旧顶层键时，在别的桌面也应看得到
//（须先清掉命名空间键，否则命名空间优先＝分不出回退是否生效）
await evalJs(`(function(){ try { window.xyStore('xy-home-v2:default').remove('ta-curious'); window.xyStore('xy-home-v2').set('ta-curious', JSON.stringify({ history: [{ q: '旧顶层键题', my: 'a', reply: 'b', ts: Date.now() }], questions: [] })); } catch(e){} return true; })()`);
await evalJs(`window.setActiveContact(${JSON.stringify(cidA)}); true`);
await sleep(600);
await openRecords();
const legacy = await panel('ar-curious');
check('D1 default 桌面老档（旧顶层键）在联系人桌面也可见', legacy.list.join('|').indexOf('旧顶层键题') >= 0, JSON.stringify(legacy.list));

// D2 只有当前桌面有记录时列表照常渲染（单桌面不回归）
await setDesk(cidA, 'ta-roast', JSON.stringify({ history: [{ roast: '单桌面吐槽', my: 'm', reply: 'r', ts: Date.now() }], questions: [{ id: 'x', text: 't' }], settings: {}, groups: [] }));
await evalJs(`(function(){ localStorage.removeItem('xy-home-v2:ta-roast'); return true; })()`);
await sleep(300);
await openRecords();
const single = await panel('ar-roast');
check('D2 仅当前桌面有记录时正常显示（单桌面不回归）', single.n === 1 && single.list[0] === '单桌面吐槽', JSON.stringify(single));

// D3 无 JS 异常
check('D3 全程无未捕获 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));

console.log('\n结果: ' + pass + ' 过 / ' + fail + ' 败' + (tmpPage ? '（--tmp 拼装页）' : '（真实 index.html）'));
if (fail) console.log('失败项：' + failed.join(' | '));
try { if (tmpPage) (await import('node:fs')).unlinkSync(tmpPage); } catch (e) {}
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
