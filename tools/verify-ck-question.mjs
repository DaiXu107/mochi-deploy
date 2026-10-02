// ===== 回归脚本：TA 主动查岗（查岗问题卡） =====
// 用法：node build.mjs && node tools/verify-ck-question.mjs
// 复现路径（无头 Chrome，390×844 手机视口）：
//   1. 查岗题库可触发（triggerCkQuestion）：提示语 + ask-card 进聊天，单选卡渲染选项提示。
//   2. 单选卡点击就地点选（ip-opt 按钮 = 题库选项）→ chatAskReply 作答 → 我的回答 + TA 预设回应。
//   3. 文字题卡点击出输入框，作答后 answered。
//   4. 自动弹窗路径（ckq-popup-prob=100）：openModal pills 弹窗 → 点选 → 确定 → 作答。
//   5. askOptions/askType 透传修复验证：刷新后已作答单选卡点开仍能列出选项（数据持久化）。
//   6. 开关/冷却：ckq-en=0 时 ckQuestionTry 返回 false；触发后冷却期内返回 false。
//   7. 设置页：查岗 tab/面板存在，ckq-prob 默认 8（v3.12.x 互动卡降频：15→8，冷却30不变）。
// 前置：禁用自动回复（rs-min/max=9999s、rn-prob=0、as-en=0）避免「正在输入」行竞态。
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
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
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-ckq-' + Date.now()),
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
    if (r && r.exceptionDetails) {
      console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);
// 前置：禁用自动回复 + 查岗自动弹窗（弹窗单独用例再开）
await evalJs("(function(){var st=window.activeStore();st.set('reply-rs-min','9999');st.set('reply-rs-max','9999');st.set('reply-rn-prob','0');st.set('reply-as-en','0');st.set('reply-ckq-en','1');st.set('reply-ckq-popup-prob','0');st.set('reply-ckq-cool','30');return true;})()");
// 进入聊天页
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return !!a;})()");
await sleep(1200);

// ---- 1. 模块与题库就绪 ----
check('查岗模块已加载（ckQuestionTry 存在）', (await evalJs('typeof window.ckQuestionTry')) === 'function');
const bankInfo = await evalJs("(function(){var src=window.ckQuestionTry?1:0;return {trig:typeof window.triggerCkQuestion, bank:window.__ckqBank||'n/a'};})()");
const singleCount = await evalJs("(function(){return document.querySelectorAll('.msg-ask-card').length;})()");

// 触发一道单选题（forceIdx=0：你在干嘛呀？）
await evalJs('window.triggerCkQuestion(0); true;');
await sleep(400);
const card1 = await evalJs(`(function(){
  const cards = Array.from(document.querySelectorAll('.msg-ask-card'));
  const c = cards.find(x => x.textContent.indexOf('你在干嘛呀') >= 0);
  if (!c) return null;
  const parent = c.closest('.msg-ask');
  return {
    tip: c.querySelector('.msg-ask-tip') ? c.querySelector('.msg-ask-tip').textContent : '',
    idx: parent ? parent.dataset.idx : ''
  };
})()`);
check('查岗提示语进聊天', (await evalJs("(function(){return Array.from(document.querySelectorAll('#chat-body *')).some(function(el){return el.childNodes.length===1&&el.childNodes[0].nodeType===3&&el.textContent.trim()==='TA 来查岗了。';});})()")) === true);
check('单选查岗卡渲染（含选项提示）', !!card1 && card1.tip === '点击选择你的答案', card1 ? 'idx=' + card1.idx + ' tip=' + card1.tip : 'card not found');

// ---- 2. 单选卡就地点选 ----
const optTxt = await evalJs(`(function(){
  const c = Array.from(document.querySelectorAll('.msg-ask-card')).find(x => x.textContent.indexOf('你在干嘛呀') >= 0);
  if (!c) return null;
  c.click();
  return null;
})()`);
await sleep(300);
const opts = await evalJs(`(function(){
  const wrap = document.querySelector('.msg-ask .msg-inplace');
  if (!wrap) return null;
  return Array.from(wrap.querySelectorAll('.ip-opt')).map(b => b.textContent.trim());
})()`);
check('点卡展开 5 个选项', !!opts && opts.length === 5 && opts.indexOf('在想你') >= 0 && opts.indexOf('在等你的消息') >= 0, opts ? opts.join('/') : 'no opts');
// 点「在想你」
await evalJs(`(function(){
  const b = Array.from(document.querySelectorAll('.msg-ask .ip-opt')).find(x => x.textContent.trim() === '在想你');
  if (b) b.click();
  return !!b;
})()`);
await sleep(600);
const singleAnswered = await evalJs(`(function(){
  const c = Array.from(document.querySelectorAll('.msg-ask-card')).find(x => x.textContent.indexOf('你在干嘛呀') >= 0);
  if (!c) return null;
  const t = c.textContent;
  // 注意：模板串里正则反斜杠必须写双份（\\s 模板串转义成 s 会破坏 [\\s\\S] 类）
  return {
    answered: c.classList.contains('answered'),
    hasCheck: t.indexOf('✓ 已回答：在想你') >= 0,
    hasTaReply: /TA：[\\s\\S]+/.test(t) && t.indexOf('TA：') >= 0 && t.replace(/.*TA：/, '').trim().length > 0
  };
})()`);
const outMsg = await evalJs(`(function(){
  const el = Array.from(document.querySelectorAll('#chat-body .msg-out')).filter(x => {
    const b = x.querySelector('.msg-bubble');
    return b && b.textContent.trim() === '在想你';
  });
  return el.length > 0;
})()`);
check('单选作答完成（answered+我的回答+TA 回应）', !!singleAnswered && singleAnswered.answered && singleAnswered.hasCheck && singleAnswered.hasTaReply, singleAnswered ? JSON.stringify(singleAnswered) : 'card gone');
check('我的回答以 out 消息发出', outMsg === true);

// ---- 3. 文字题 ----
await evalJs('window.triggerCkQuestion(10); true;'); // forceIdx=10：快说说，今天过得怎么样？（text）
await sleep(400);
const textCard = await evalJs(`(function(){
  const c = Array.from(document.querySelectorAll('.msg-ask-card')).find(x => x.textContent.indexOf('快说说，今天过得怎么样') >= 0);
  if (!c) return null;
  return { tip: c.querySelector('.msg-ask-tip') ? c.querySelector('.msg-ask-tip').textContent : '' };
})()`);
check('文字题卡渲染（文字输入提示）', !!textCard && textCard.tip === '点击回答 TA 的提问', textCard ? textCard.tip : 'not found');
await evalJs(`(function(){
  const c = Array.from(document.querySelectorAll('.msg-ask-card')).find(x => x.textContent.indexOf('快说说，今天过得怎么样') >= 0);
  if (c) c.click();
  return !!c;
})()`);
await sleep(300);
const textInputReady = await evalJs(`(function(){
  const inp = document.querySelector('.msg-ask .ip-input');
  const send = document.querySelector('.msg-ask .ip-send');
  return !!inp && !!send;
})()`);
check('文字题点卡出输入框+发送按钮', textInputReady === true);
const textAnswered = await evalJs(`(function(){
  // 安卓路径：.ip-input 会被 mobile-adapt 转成 ce-box（幽灵 input 在 DOM 后），
  // 必须走 input.__ceBox.textContent 写入（直接给 ghost input 设 value 被代理读空）
  const inp = document.querySelector('.msg-ask input.ip-input');
  const send = document.querySelector('.msg-ask .ip-send');
  if (!inp || !send) return 'no-input';
  if (inp.__ceBox) {
    inp.__ceBox.textContent = '今天有好好吃饭，也有想你';
    inp.__ceBox.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    inp.value = '今天有好好吃饭，也有想你';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }
  send.click();
  return 'clicked';
})()`);
await sleep(600);
const textDone = await evalJs(`(function(){
  const c = Array.from(document.querySelectorAll('.msg-ask-card')).find(x => x.textContent.indexOf('快说说，今天过得怎么样') >= 0);
  if (!c) return null;
  const t = c.textContent;
  return { answered: c.classList.contains('answered'), hasAnswer: t.indexOf('今天有好好吃饭，也有想你') >= 0, hasTaReply: t.indexOf('TA：') >= 0 };
})()`);
check('文字题作答完成（我的回答+TA 回应）', !!textDone && textDone.answered && textDone.hasAnswer && textDone.hasTaReply, textDone ? JSON.stringify(textDone) : (textAnswered === 'clicked' ? 'card gone' : textAnswered));

// ---- 4. 自动弹窗路径（单选 pills） ----
await evalJs("(function(){var st=window.activeStore();st.set('reply-ckq-popup-prob','100');return true;})()");
await evalJs('window.triggerCkQuestion(1); true;'); // forceIdx=1：现在在哪里呀？
await sleep(1000);
const modal1 = await evalJs(`(function(){
  const mask = document.getElementById('modal-mask');
  if (!mask || mask.hidden) return null;
  const st = document.querySelector('#modal-mask .modal-static, #modal-static, .modal-static');
  return {
    title: (document.querySelector('#modal-mask .modal-title, .modal-title') || {}).textContent || '',
    static: (st || {}).textContent || '',
    pills: Array.from(document.querySelectorAll('#modal-mask .pill, .modal .pill, .pill')).map(p => p.textContent.trim()),
    noInput: !(document.querySelector('#modal-mask input[type=text], .modal input[type=text]'))
  };
})()`);
check('查岗自动弹窗出现（标题+问题+选项）', !!modal1 && modal1.title === '查岗回答' && modal1.static.indexOf('现在在哪里呀') >= 0 && modal1.pills.length === 5, modal1 ? JSON.stringify(modal1) : 'modal not shown');
await evalJs(`(function(){
  const b = Array.from(document.querySelectorAll('.pill')).find(x => x.textContent.trim() === '在被窝里');
  if (b) b.click();
  const ok = document.getElementById('modal-ok');
  if (ok) ok.click();
  return true;
})()`);
await sleep(700);
const modalAnswered = await evalJs(`(function(){
  const c = Array.from(document.querySelectorAll('.msg-ask-card')).find(x => x.textContent.indexOf('现在在哪里呀') >= 0);
  if (!c) return null;
  const t = c.textContent;
  return { answered: c.classList.contains('answered'), hasAnswer: t.indexOf('✓ 已回答：在被窝里') >= 0, hasTaReply: t.indexOf('TA：') >= 0 };
})()`);
check('弹窗作答完成（在被窝里+TA 回应）', !!modalAnswered && modalAnswered.answered && modalAnswered.hasAnswer && modalAnswered.hasTaReply, modalAnswered ? JSON.stringify(modalAnswered) : 'card gone');

// ---- 5. askOptions/askType 持久化（刷新后记录仍在，含选项数据） ----
await cdp('Page.reload');
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);
await evalJs("(function(){var st=window.activeStore();st.set('reply-rs-min','9999');st.set('reply-rs-max','9999');st.set('reply-rn-prob','0');st.set('reply-as-en','0');st.set('reply-ckq-popup-prob','0');return true;})()");
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return !!a;})()");
await sleep(1200);
// a) 已作答单选卡刷新后仍渲染 answered 状态
const persisted = await evalJs(`(function(){
  const c = Array.from(document.querySelectorAll('.msg-ask-card')).find(x => x.textContent.indexOf('现在在哪里呀') >= 0);
  if (!c) return null;
  return { answered: c.classList.contains('answered'), hasAnswer: c.textContent.indexOf('✓ 已回答：在被窝里') >= 0 };
})()`);
// b) 聊天记录里的 ask-card 记录持久化了 askType/askOptions（透传修复的直接证据）
const recPersisted = await evalJs(`(function(){
  try {
    const raw = localStorage.getItem(window.activePrefix() + ':chat-msgs');
    const msgs = JSON.parse(raw || '[]');
    const rec = msgs.find(r => r.special === 'ask-card' && r.askQuestion && r.askQuestion.indexOf('现在在哪里呀') >= 0);
    if (!rec) return null;
    return {
      askType: rec.askType,
      optCount: Array.isArray(rec.askOptions) ? rec.askOptions.length : 0,
      askAnswer: rec.askAnswer,
      askReply: rec.askReply ? 'yes' : ''
    };
  } catch (e) { return 'err:' + e.message; }
})()`);
check('刷新后已作答单选卡渲染 answered', !!persisted && persisted.answered && persisted.hasAnswer, persisted ? JSON.stringify(persisted) : 'card gone');
check('聊天记录持久化 askType/askOptions/回答', !!recPersisted && recPersisted.askType === 'single' && recPersisted.optCount === 5 && recPersisted.askAnswer === '在被窝里' && recPersisted.askReply === 'yes', recPersisted ? JSON.stringify(recPersisted) : 'rec not found');
// c) 刷新后新触发的单选卡选项仍正常展开（askOptions 渲染链路完整）
await evalJs('window.triggerCkQuestion(2); true;'); // 和谁在一起？
await sleep(400);
await evalJs(`(function(){
  const c = Array.from(document.querySelectorAll('.msg-ask-card')).find(x => x.textContent.indexOf('和谁在一起') >= 0);
  if (c) c.click();
  return !!c;
})()`);
await sleep(300);
const reloadOpts = await evalJs(`(function(){
  const wrap = document.querySelector('.msg-ask .msg-inplace');
  if (!wrap) return null;
  return Array.from(wrap.querySelectorAll('.ip-opt')).map(b => b.textContent.trim());
})()`);
check('刷新后单选卡点开仍有 4 个选项', !!reloadOpts && reloadOpts.length === 4 && reloadOpts.indexOf('一个人') >= 0 && reloadOpts.indexOf('不告诉你') >= 0, reloadOpts ? reloadOpts.join('/') : 'no opts');

// ---- 6. 开关与冷却 ----
await evalJs("(function(){var st=window.activeStore();st.set('reply-ckq-en','0');return true;})()");
const offRet = await evalJs('window.ckQuestionTry(window.replyCfg())');
check('ckq-en=0 时 ckQuestionTry 返回 false（不触发）', offRet === false);
await evalJs("(function(){var st=window.activeStore();st.set('reply-ckq-en','1');st.set('reply-ckq-popup-prob','0');return true;})()");
await evalJs('window.triggerCkQuestion(2); true;'); // 和谁在一起？
await sleep(300);
const coolRet = await evalJs('window.ckQuestionTry(window.replyCfg())');
check('触发后冷却期内 ckQuestionTry 返回 false', coolRet === false);
// 删除已写入的键 → replyCfg 回退默认值（验证 DEFAULTS：概率15/冷却30/弹窗70）
const cfg0 = await evalJs("(function(){var st=window.activeStore();st.remove('reply-ckq-prob');st.remove('reply-ckq-cool');st.remove('reply-ckq-popup-prob');var c=window.replyCfg();return {prob:c['ckq-prob'],cool:c['ckq-cool'],popup:c['ckq-popup-prob']};})()");
check('设置默认值正确（概率8/冷却30/弹窗70）', cfg0 && cfg0.prob === 8 && cfg0.cool === 30 && cfg0.popup === 70, cfg0 ? JSON.stringify(cfg0) : 'n/a');

// ---- 7. 设置页面板 ----
const panel = await evalJs(`(function(){
  const en = document.getElementById('ckq-en');
  const prob = document.getElementById('ckq-prob-val');
  const pnl = document.querySelector('[data-rpanel="ck"]');
  const tab = document.querySelector('.fav-tab[data-rp="ck"]');
  return { hasEn: !!en, hasProb: !!prob, hasPanel: !!pnl, hasTab: !!tab, probVal: prob ? prob.value : '' };
})()`);
check('回复设置-查岗面板完整（开关/概率/冷却/自动弹窗）', !!panel && panel.hasEn && panel.hasProb && panel.hasPanel && panel.hasTab, panel ? JSON.stringify(panel) : 'n/a');

// ---- 收尾 ----
const pass = results.filter(r => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 项通过');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);
