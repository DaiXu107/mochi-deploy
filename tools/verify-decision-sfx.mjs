// ===== #968 决定结果发到聊天不响「联系人发送和回复消息」音效 =====
// 用户报障（2026-09-21，原话）：「为什么聊天和群聊里，帮我决定和多人决定的功能。结果发送到聊天，
//   发送没有触发发消息的音效。」后续澄清：「我就是默认开启结果发送到聊天，需要触发联系人发消息的音效。」
// 根因（纯逻辑、零机型分支）：
//   决定结果经 chatAddIn 以 side:'in'（联系人回复样式）落聊天，调用点带 silent:true。这枚标记
//   当初（#492 之前就在）只用来压「桌面消息横幅」——那时 addIn 根本没有音效。v3.26.x 给 addIn
//   加「联系人发消息音效」后，闸门写成 `!opts.silent`（chat.js），于是同一枚标记顺手把音效也摁掉
//   ＝单聊决定结果一声不响。群聊那一路（group-chat.js gcSendDecisionText）不走 addIn，直接
//   playSfxGc('in')，所以群聊本来就有声。
// 修复：#968 单聊两处（decision.js / group-decision.js）在投递后补 `window.playSfx('in')`——
//   silent 保留（横幅语义不动），只补音效；四个入口（单聊/群聊 × 帮我决定/多人决定）听感一致。
// 场景（修前产物 B1/B2 红＝症状复现）：
//   B1 单聊·帮我决定 出结果 → 响收消息音效 + 答案落聊天          （修前：答案落、音效无）
//   B2 单聊·多人决定 出结果 → 响收消息音效 + 答案落聊天          （修前：答案落、音效无）
//   B3 关掉「结果发送到聊天」→ 不响、不落聊天（防修过头：音效只随投递走）
//   B4 群聊上下文出结果 → playSfxGc('in') + 系统消息落群聊        （修前就绿＝群聊本有声，守卫不被改坏）
// 用法：node tools/verify-decision-sfx.mjs [被测根]（默认脚本所在仓库根；需先 node build.mjs）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..');
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
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}

// ---- S1/S2 静态锚：产物里两处补音效 + 群聊那一路照旧（免起浏览器即可判死的部分）----
{
  const rd = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
  const d = rd('js/decision.js'), gd = rd('js/group-decision.js'), gc = rd('js/group-chat.js');
  check('S1 js/decision.js 帮我决定结果补响收消息音效（#968a）',
    d.indexOf("window.playSfx('in'); } catch (e) {} // FIX 2026-09-21 #968 帮我决定结果响收消息音效") >= 0, '');
  check('S2 js/group-decision.js 多人决定结果补响收消息音效（#968b）',
    gd.indexOf("window.playSfx('in'); } catch (e) {} // FIX 2026-09-21 #968 多人决定结果响收消息音效") >= 0, '');
  check('S3 群聊那一路仍走 playSfxGc(in)（本批不动，守卫不被改坏）',
    gc.indexOf("if (window.playSfxGc) window.playSfxGc('in'); // #698d") >= 0, '');
  // 防修过头：silent 不能顺手删（它仍管桌面横幅语义；删了＝决定结果去弹桌面横幅）
  check('S4 两处仍保留 silent: true（silent 的横幅语义不动，只补音效）',
    d.indexOf('{ enter: true, silent: true, follow: true, dedupExempt: true }') >= 0 &&
    gd.indexOf('{ enter: true, silent: true, follow: true, dedupExempt: true }') >= 0, '');
}

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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (10050 + Math.floor(Math.random() * 50));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-dsfx-' + Date.now()),
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
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(800);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(600);
}
// 音效桩：只记账不发声（headless 无音频输出；且避免 AudioContext 初始化噪音）。
// 两个入口都要包——production 里 chat.js addIn 查 window.playSfx、group-chat.js 查 window.playSfxGc。
async function installSfxSpy() {
  await evalJs(`(function(){
    window.__sfxLog = [];
    window.playSfx = function(t){ try{ window.__sfxLog.push('playSfx:'+t); }catch(e){} };
    window.playSfxGc = function(t){ try{ window.__sfxLog.push('playSfxGc:'+t); }catch(e){} };
    return true;
  })()`);
}
const resetLog = () => evalJs('(function(){window.__sfxLog=[];return true;})()');
const readLog = async () => JSON.parse(await evalJs('JSON.stringify(window.__sfxLog||[])') || '[]');
// 聊天里某段特征串的条数——DOM（屏上所见）与 LS 快照（可能滞后）两路都读，附诊断字段
const chatCount = async (token) => JSON.parse(await evalJs(`(function(){
  var p=document.getElementById('page-chat');
  var cb=document.getElementById('chat-body');
  var dom=(cb&&cb.innerText||'').split(${JSON.stringify(token)}).length-1;
  var store=-1; try{ var a=JSON.parse(window.activeStore().get('chat-msgs')||'[]'); store=a.filter(function(m){return String((m&&m.text)||'').indexOf(${JSON.stringify(token)})>=0;}).length; }catch(e){}
  return JSON.stringify({ pageHidden: p?p.hidden:null, nodes: cb?cb.querySelectorAll('[data-idx]').length:-1, dom:dom, store:store, textLen: cb?(cb.innerText||'').length:-1 });
})()`) || {});
const gcCount = (token) => evalJs(`(function(){
  var m=[]; try{ m=window.groupChatGetMsgs()||[]; }catch(e){ return -1; }
  return m.filter(function(x){ return String((x&&x.text)||'').indexOf(${JSON.stringify(token)})>=0; }).length;
})()`);

await openPage();
await installSfxSpy();

// ---- B1 单聊·帮我决定 ----
console.log('--- B1 单聊·帮我决定：出结果要响「联系人发消息」音效并落聊天 ---');
{
  const before = await chatCount('【帮我决定】');
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return true;})()");
  await sleep(700);
  await evalJs('(function(){if(window.openDecision)window.openDecision();return true;})()');
  await sleep(400);
  const grp = await evalJs("(function(){var p=document.getElementById('page-group-chat');return !(p&&!p.hidden);})()");
  await evalJs("(function(){var q=document.getElementById('dec-q-a');if(q)q.value='#968B1 今晚吃火锅吗？';var t=document.getElementById('dec-think-a-val');if(t)t.value='1';return true;})()");
  await resetLog();
  await evalJs("(function(){var b=document.getElementById('dec-go-a');if(b)b.click();return true;})()");
  await sleep(1900);
  const log = await readLog();
  const after = await chatCount('【帮我决定】');
  check('B1a 单聊·帮我决定 结果落聊天', after.dom >= before.dom + 1 || after.store >= before.store + 1, 'before=' + JSON.stringify(before) + ' after=' + JSON.stringify(after));
  check('B1b 单聊·帮我决定 响收消息音效 playSfx:in（修前无任何音效）', log.indexOf('playSfx:in') >= 0, JSON.stringify(log));
  check('B1c 单聊上下文不走群聊音效通道', log.indexOf('playSfxGc:in') < 0, 'notGroup=' + grp + ' log=' + JSON.stringify(log));
}

// ---- B2 单聊·多人决定 ----
console.log('--- B2 单聊·多人决定：同款 ---');
{
  const before = await chatCount('【多人决定】');
  await evalJs('(function(){if(window.openGroupDecision)window.openGroupDecision();return true;})()');
  await sleep(400);
  await evalJs("(function(){var q=document.getElementById('gd-q-a');if(q)q.value='#968B2 中午吃什么？';var t=document.getElementById('gd-think-a-val');if(t)t.value='1';return true;})()");
  await resetLog();
  await evalJs("(function(){var b=document.getElementById('gd-go-a');if(b)b.click();return true;})()");
  await sleep(1900);
  const log = await readLog();
  const after = await chatCount('【多人决定】');
  check('B2a 单聊·多人决定 结果落聊天', after.dom >= before.dom + 1 || after.store >= before.store + 1, 'before=' + JSON.stringify(before) + ' after=' + JSON.stringify(after));
  check('B2b 单聊·多人决定 响收消息音效 playSfx:in（修前无任何音效）', log.indexOf('playSfx:in') >= 0, JSON.stringify(log));
}

// ---- B3 防修过头：关掉「结果发送到聊天」＝不投递，也就不该响 ----
console.log('--- B3 关掉「结果发送到聊天」：不落聊天、不响（音效只随投递走） ---');
{
  await evalJs("(function(){if(window.openDecision)window.openDecision();return true;})()");
  await sleep(300);
  await evalJs("(function(){var t=document.querySelector('#chat-decision-body .dc-tab[data-dtab=\"history\"]');if(t)t.click();return true;})()");
  await sleep(300);
  const hasRow = await evalJs("(function(){var c=document.getElementById('dec-reply-chat');return !!c;})()");
  await evalJs("(function(){var c=document.getElementById('dec-reply-chat');if(c&&c.checked){c.checked=false;c.dispatchEvent(new Event('change',{bubbles:true}));}return true;})()");
  const off = await evalJs("(function(){try{var s=JSON.parse(window.xyStore('xy-home-v2').get('decision-settings')||'{}');return s.replyToChat===false;}catch(e){return null;}})()");
  await evalJs("(function(){var t=document.querySelector('#chat-decision-body .dc-tab[data-dtab=\"typea\"]');if(t)t.click();return true;})()");
  await sleep(300);
  const before = await chatCount('【帮我决定】');
  await evalJs("(function(){var q=document.getElementById('dec-q-a');if(q)q.value='#968B3 不该发出去的问题';var t=document.getElementById('dec-think-a-val');if(t)t.value='1';return true;})()");
  await resetLog();
  await evalJs("(function(){var b=document.getElementById('dec-go-a');if(b)b.click();return true;})()");
  await sleep(1900);
  const log = await readLog();
  const after = await chatCount('【帮我决定】');
  check('B3a 关掉开关后答案不落聊天', hasRow === true && off === true && after.dom === before.dom && after.store === before.store, 'row=' + hasRow + ' off=' + off + ' before=' + JSON.stringify(before) + ' after=' + JSON.stringify(after));
  check('B3b 关掉开关后不响收消息音效（音效不脱钩投递）', log.indexOf('playSfx:in') < 0, JSON.stringify(log));
}

// ---- B4 群聊上下文（守卫：本来就响，别被改坏） ----
console.log('--- B4 群聊上下文：走 playSfxGc(in)（修前已绿＝本批不动的既有行为） ---');
{
  const before = await gcCount('【帮我决定】');
  // B3 把「结果发送到聊天」关掉了（全局设置，持久化），这里先按真实 UI 路径开回来
  await evalJs("(function(){if(window.openDecision)window.openDecision();return true;})()");
  await sleep(300);
  await evalJs("(function(){var t=document.querySelector('#chat-decision-body .dc-tab[data-dtab=\"history\"]');if(t)t.click();return true;})()");
  await sleep(300);
  await evalJs("(function(){var c=document.getElementById('dec-reply-chat');if(c&&!c.checked){c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));}return true;})()");
  const backOn = await evalJs("(function(){try{var s=JSON.parse(window.xyStore('xy-home-v2').get('decision-settings')||'{}');return s.replyToChat===true;}catch(e){return null;}})()");
  await evalJs("(function(){var p=document.getElementById('chat-decision-panel');if(p)p.hidden=true;return true;})()");
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"group-chat\"]');if(a)a.click();return true;})()");
  await sleep(900);
  const inGc = await evalJs("(function(){var p=document.getElementById('page-group-chat');return !!(p&&!p.hidden)&&!!(window.gcIsVisible&&window.gcIsVisible());})()");
  await evalJs('(function(){if(window.openDecision)window.openDecision();return true;})()');
  await sleep(400);
  await evalJs("(function(){var q=document.getElementById('dec-q-a');if(q)q.value='#968B4 群聊里今晚吃火锅吗？';var t=document.getElementById('dec-think-a-val');if(t)t.value='1';return true;})()");
  await resetLog();
  await evalJs("(function(){var b=document.getElementById('dec-go-a');if(b)b.click();return true;})()");
  await sleep(1900);
  const log = await readLog();
  const after = await gcCount('【帮我决定】');
  check('B4a 群聊上下文识别正确（结果应发到群聊）', inGc === true && backOn === true, 'inGc=' + inGc + ' replyToChat 开回来=' + backOn);
  check('B4b 群聊决定结果落群聊', after === before + 1, 'before=' + before + ' after=' + after);
  check('B4c 群聊那一路响 playSfxGc:in（既有行为，守卫）', log.indexOf('playSfxGc:in') >= 0, JSON.stringify(log));
  check('B4d 群聊不走单聊 playSfx 通道（不重复响两条）', log.indexOf('playSfx:in') < 0, JSON.stringify(log));
}

const pass = results.filter(r => r.ok).length;
console.log('');
console.log('=== verify-decision-sfx: ' + pass + '/' + results.length + ' ===');
results.forEach(r => { if (!r.ok) console.log('  FAIL: ' + r.desc); });
chrome.kill();
server.close();
process.exit(pass === results.length ? 0 : 1);
