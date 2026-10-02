// #521 批量问卷聊天长卡片 行为验证（无头 Chrome，测构建产物 index.html）
// 立项：用户反馈「【问问ta】的【批量设置问卷】发送出来的格式没有变成单个问题时一样的长卡片」。
// 根因（src/js/ta-ask.js surveySend）：单题发出走 pushAsk → chatAddSystem(special:'ask-card')，
// chat.js 有专门卡片渲染分支；批量问卷只发一行 special:'ask-msg' 小字，TA 的作答也只是普通
// 文本消息，整条链路在聊天里没有卡片。修复（方案A：封面进度卡）：
//   ① surveySend 额外插入一张 special:'ask-survey' 长卡片（题列表快照随消息持久化）；
//   ② ta-ask.js 逐题作答/交卷时 surveySyncCard → chat.js 的 chatSyncSurveyCard 按 surveyTs
//      定位记录、原地重画卡片（同一 DOM 节点，不整窗重建）；
//   ③ chat-main.css / dark.css 提供卡片样式壳。
// 判别器：①聊天里出现 .msg-survey-card（而非只有 ask-msg 小字）；②头部题数/进度文案正确；
//   ③进度回写后同一 DOM 节点仍在（原地更新，节点被打 __sm 标记）；④交卷态 done/答案渲染；
//   ⑤点击卡片打开问卷详情页。
// 用法：node build.mjs && node tools/verify-ask-survey-card.mjs
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
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+（内置 WebSocket）'); process.exit(1); }

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vasc-' + Date.now()),
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
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
await sleep(600);
await evalJs('(function(){if(window.enterChat)window.enterChat();return true;})()');
await sleep(1200);

// —— S0 种入一张「你发出的问卷」长卡片（2 题：1 单选 + 1 文字），答案为空（作答中）——
const seeded = await evalJs(`(function(){
  if (!window.chatImportMsgs) return 'no-fn';
  var ts=Date.now();
  var arr=[{side:'out',type:'text',text:'问卷发出去咯',ts:ts-1000}];
  arr.push({side:'in',special:'ask-survey',text:'问卷（2 题）',ts:ts,
    surveyTs:ts,
    surveyQs:[
      {type:'single',text:'更喜欢哪种约会',options:['看电影','去公园','在家待着']},
      {type:'text',text:'最近有什么心事',options:[]}
    ],
    surveyStatus:'sent',surveyAnswers:[]});
  window.__surveyTs=ts;
  return window.chatImportMsgs(arr)?'true':'false';
})()`);
ok(seeded === 'true', 'S0 种入问卷长卡片记录（2 题：1 单选 + 1 文字）', String(seeded));
await sleep(1200);

// —— S1 卡片渲染：长卡片本体 + 头部题数 + 进度文案 + 题列表结构 ——
const s1 = JSON.parse(await evalJs(`(function(){
  var card=document.querySelector('.msg-survey-card');
  if(!card) return JSON.stringify({card:false});
  // 原地更新判别标记：打在外层 .msg-survey 包裹节点 + 前一条普通消息节点上。
  // 进度回写只重画包裹节点 innerHTML、不整窗重建 ⇒ 两者都应存活（整窗重建会换掉全部节点）。
  var wrap=card.closest('.msg-survey'); if(wrap) wrap.__sm=true;
  var sib=document.querySelector('.msg-out'); if(sib) sib.__sib=true;
  var head=card.querySelector('.msg-survey-head');
  var tip=card.querySelector('.msg-survey-tip');
  return JSON.stringify({
    card:true,
    headText: head?head.textContent:'',
    tip: tip?tip.textContent:'',
    noEmoji: card.textContent.indexOf('\uD83D\uDCC4') < 0,
    items: card.querySelectorAll('.msg-survey-item').length,
    opts: card.querySelectorAll('.msg-survey-item .msg-survey-opt').length,
    answers: card.querySelectorAll('.msg-survey-a').length
  });
})()`) || '{}');
ok(s1.card === true, 'S1 聊天里出现 .msg-survey-card 长卡片（用户报的「只有小字没卡片」）');
ok(s1.headText.indexOf('你发出的问卷') >= 0 && s1.headText.indexOf('2 题') >= 0, 'S1 卡片头部=「你发出的问卷 · 2 题」', s1.headText);
ok(s1.noEmoji === true, 'S1 卡片无 📄 emoji（用户要求删掉）', String(s1.noEmoji));
ok(s1.tip.indexOf('已答 0/2') >= 0, 'S1 底部提示含进度 0/2', s1.tip);
ok(s1.items === 2, 'S1 题列表渲染 2 题', String(s1.items));
ok(s1.opts === 3, 'S1 单选题 3 个选项 chip', String(s1.opts));
ok(s1.answers === 0, 'S1 未作答时无答案行', String(s1.answers));

// —— S2 逐题作答进度回写：同一 DOM 节点原地更新（不整窗重建） ——
await evalJs('window.chatSyncSurveyCard(window.__surveyTs,"sent",["看电影"])');
await sleep(400);
const s2 = JSON.parse(await evalJs(`(function(){
  var card=document.querySelector('.msg-survey-card');
  if(!card) return JSON.stringify({card:false});
  var wrap=card.closest('.msg-survey');
  var tip=card.querySelector('.msg-survey-tip');
  var a=card.querySelector('.msg-survey-a');
  var sib=document.querySelector('.msg-out');
  return JSON.stringify({card:true, sameNode:!!(wrap&&wrap.__sm), sibAlive:!!(sib&&sib.__sib), tip:tip?tip.textContent:'', a:a?a.textContent:'',
    answered:card.querySelectorAll('.msg-survey-item.answered').length});
})()`) || '{}');
ok(s2.card === true && s2.sameNode === true && s2.sibAlive === true, 'S2 进度回写后未整窗重建（问卷包裹节点与前一条消息节点均存活）', JSON.stringify(s2));
ok(s2.tip.indexOf('已答 1/2') >= 0, 'S2 进度更新为已答 1/2', s2.tip);
ok(s2.answered === 1 && s2.a.indexOf('看电影') >= 0, 'S2 第 1 题出现答案行「TA：看电影」', s2.a);

// —— S3 交卷：卡片转 done 态、答案逐题补齐、节点仍在 ——
await evalJs('window.chatSyncSurveyCard(window.__surveyTs,"done",["看电影","最近有点累"])');
await sleep(400);
const s3 = JSON.parse(await evalJs(`(function(){
  var card=document.querySelector('.msg-survey-card');
  if(!card) return JSON.stringify({card:false});
  var wrap=card.closest('.msg-survey');
  var tip=card.querySelector('.msg-survey-tip');
  return JSON.stringify({card:true, sameNode:!!(wrap&&wrap.__sm), done:card.classList.contains('done'),
    tip:tip?tip.textContent:'', answers:card.querySelectorAll('.msg-survey-a').length,
    sel: (card.querySelector('.msg-survey-opt.sel')||{}).textContent||'',
    last: (card.querySelectorAll('.msg-survey-a')[1]||{}).textContent||''});
})()`) || '{}');
ok(s3.card === true && s3.sameNode === true, 'S3 交卷后未整窗重建（问卷包裹节点存活）', JSON.stringify(s3));
ok(s3.done === true && s3.tip.indexOf('已交卷') >= 0, 'S3 卡片转 .done 态、底部提示=已交卷', s3.done + '/' + s3.tip);
ok(s3.answers === 2, 'S3 两题答案行齐全', String(s3.answers));
ok(s3.sel === '看电影', 'S3 选项对齐单题 chip 且 TA 选中的那个高亮 .sel', s3.sel);
ok(s3.last.indexOf('最近有点累') >= 0, 'S3 文字题答案渲染正确', s3.last);

// —— S4 点击卡片打开只读「问卷详情」面板（不再跳批量设置问卷页；#713 起为 openTCPanel 面板＋收藏操作条） ——
await evalJs("(function(){var c=document.querySelector('.msg-survey-card');if(c)c.click();return true;})()");
await sleep(500);
const s4 = JSON.parse(await evalJs(`(function(){
  var p=document.getElementById('page-ta-ask-survey');
  var mask=document.getElementById('tc-mask');
  return JSON.stringify({surveyPageOpen:!!(p&&!p.hidden), panelOpen:!!(mask&&!mask.hidden),
    title:(document.getElementById('tc-panel-title')||{}).textContent||'',
    body:(document.getElementById('tc-body')||{}).textContent||'',
    favCard:!!document.getElementById('sv-fav-card'),
    favAll:!!document.getElementById('sv-fav-allbtn'),
    favSel:!!document.getElementById('sv-fav-sel'),
    cbs:document.querySelectorAll('#sv-detail-list .sv-fav-cb').length});
})()`) || '{}');
ok(s4.panelOpen === true && s4.surveyPageOpen === false, 'S4 点击卡片打开只读问卷详情面板、不再跳批量设置问卷页', JSON.stringify({open:s4.panelOpen, page:s4.surveyPageOpen}));
ok(s4.title === '问卷详情' && /更喜欢哪种约会/.test(s4.body || '') && /TA：/.test(s4.body || ''), 'S4 详情面板含题干与 TA 作答', (s4.body || '').slice(0, 60));
ok(s4.favCard === true && s4.favAll === true && s4.favSel === true && s4.cbs === 2, 'S4 详情面板有整卡收藏＋单题批量收藏操作条（#713）', JSON.stringify({c:s4.favCard,a:s4.favAll,s:s4.favSel,cbs:s4.cbs}));
await evalJs("(function(){var b=document.getElementById('tc-mask-close');if(b)b.click();return true;})()");
await sleep(200);

// —— S4b 自绘时间选择器（#523）：在手机框内弹出、不飞出屏幕，可设置并回显 ——
// 背景：两处时间入口原用原生 <input type="datetime-local">，用户报「浏览器自带的选择器会飞出屏幕」。
// 点整行文字（不是右侧按钮）也要能打开——用户可能点标签文字
await evalJs("(function(){var b=document.getElementById('ta-survey-deadline');var row=b&&b.closest('.gs-row');var sp=row&&row.querySelector('span');if(sp){sp.click();}else if(b){b.click();}return true;})()");
await sleep(300);
const s4b = JSON.parse(await evalJs(`(function(){
  var m=document.getElementById('dl-picker-mask');
  if(!m||m.hidden) return JSON.stringify({open:false});
  var box=m.querySelector('.modal');
  var r=box?box.getBoundingClientRect():null;
  var inp=document.getElementById('dl-picker-secs');
  return JSON.stringify({open:true,
    inViewport: !!(r && r.top>=0 && r.left>=0 && r.bottom<=window.innerHeight+1 && r.right<=window.innerWidth+1),
    cur: (document.getElementById('dl-picker-cur')||{}).textContent||'',
    mins: inp?String(inp.value||''):'?',
    hasMins: !!(m.querySelector('#dl-picker-secs')),
    pills: m.querySelectorAll('#dl-picker-quick .pill').length,
    inputs: m.querySelectorAll('.dl-picker-in').length});
})()`) || '{}');
ok(s4b.open === true, 'S4b 点时间入口弹出 App 内自绘选择器（非原生 datetime-local）', JSON.stringify(s4b));
ok(s4b.inViewport === true, 'S4b 选择器完整落在屏幕内（不飞出屏幕）', JSON.stringify(s4b));
ok(s4b.hasMins === true && s4b.pills === 0, 'S4b 最简形态：只有一个秒输入框（无胶囊/六档）', JSON.stringify({secs:s4b.hasMins, pills:s4b.pills}));
ok(s4b.mins === '60', 'S4b 默认 60 秒', s4b.mins);
ok(/\d+月\d+日 周./.test(s4b.cur || '') && /秒/.test(s4b.cur || ''), 'S4b 顶部显示到点绝对时刻 + 相对秒数', s4b.cur);
// 手动输入 30 秒 → 顶部实时同步 → 确定
await evalJs("(function(){var i=document.getElementById('dl-picker-secs');if(i){i.value='30';i.dispatchEvent(new Event('input',{bubbles:true}));}return true;})()");
await sleep(150);
const s4c = await evalJs("(function(){return (document.getElementById('dl-picker-cur')||{}).textContent||'';})()");
ok(/（30 秒后）/.test(s4c || ''), 'S4b 手动输入 30 后顶部同步为「30 秒后」', s4c);
await evalJs("(function(){var b=document.getElementById('dl-picker-ok');if(b)b.click();return true;})()");
await sleep(300);
const s4d = JSON.parse(await evalJs(`(function(){
  var m=document.getElementById('dl-picker-mask');
  var b=document.getElementById('ta-survey-deadline');
  return JSON.stringify({closed:!!(m&&m.hidden), btn:(b?b.textContent:'')});
})()`) || '{}');
ok(s4d.closed === true, 'S4b 确定后选择器关闭', JSON.stringify(s4d));
ok(/\d+月\d+日 周./.test(s4d.btn || ''), 'S4b 到点时间已写入并回显到按钮（落库后 surveyRender 回显）', JSON.stringify(s4d));

// —— S6 批量问卷「TA 的作答发送到聊天消息」开关（#523）：默认开、可关且落库回填 ——
// 背景：批量问卷每题答案都发到聊天＝消息太多，用户要求像单题一样可在发出前勾选是否发送到聊天。
const s6a = JSON.parse(await evalJs(`(function(){
  var c=document.getElementById('ta-survey-chat');
  return JSON.stringify({exists:!!c, on:!!(c&&c.checked)});
})()`) || '{}');
ok(s6a.exists === true && s6a.on === true, 'S6 选项存在且默认勾选（与单题一致会发到聊天）', JSON.stringify(s6a));
await evalJs("(function(){var c=document.getElementById('ta-survey-chat');if(c){c.checked=false;c.dispatchEvent(new Event('change',{bubbles:true}));}return true;})()");
await sleep(200);
await evalJs('(function(){if(window.openAskSurvey)window.openAskSurvey();return true;})()');
await sleep(300);
const s6b = JSON.parse(await evalJs("(function(){var c=document.getElementById('ta-survey-chat');return JSON.stringify({on:!!(c&&c.checked)});})()") || '{}');
ok(s6b.on === false, 'S6 取消勾选后落库并回填为关（题多可避免逐条刷聊天）', JSON.stringify(s6b));

// —— S7 发出后自动返回聊天 + 已交卷不重复发（#523）——
// 用户报：①点【发出问卷给TA】没关闭批量设置页返回聊天；②收到两条一样的「TA 交卷了（共 N 题）」。
await evalJs(`(function(){
  var d={text:'【Q1】\n一\n【Q2】\n一', settings:{prob:0,deadline:0,sendToChat:false}, qs:[{type:'text',text:'Q1',options:[]},{type:'text',text:'Q2',options:[]}], answers:[], status:'draft', sentAt:0};
  window.activeStore().set('ta-survey', JSON.stringify(d));
  if(window.openAskSurvey)window.openAskSurvey();
  return true;
})()`);
await sleep(300);
// 直接写题目框并触发 change（surveySend 以题目框内容为准重解析）
await evalJs("(function(){var t=document.getElementById('ta-survey-text');if(t){t.value='【Q1】\\n一\\n【Q2】\\n一';t.dispatchEvent(new Event('change',{bubbles:true}));}return true;})()");
await sleep(200);
const s7before = await evalJs("(function(){return (window.chatExportMsgs()||[]).filter(function(m){return m.special==='ask-survey'}).length;})()");
await evalJs("(function(){var b=document.getElementById('ta-survey-send');if(b)b.click();return true;})()");
await sleep(500);
const s7 = JSON.parse(await evalJs(`(function(){
  var sp=document.getElementById('page-ta-ask-survey');
  var cp=document.getElementById('page-chat');
  var ms=window.chatExportMsgs()||[];
  var n=ms.filter(function(m){return m.special==='ask-survey'}).length;
  var d=null; try{d=JSON.parse(window.activeStore().get('ta-survey'))}catch(e){}
  return JSON.stringify({surveyHidden:!!(sp&&sp.hidden), chatVisible:!!(cp&&!cp.hidden), cards:n, status:d&&d.status});
})()`) || '{}');
ok(s7.surveyHidden === true && s7.chatVisible === true, 'S7 点【发出问卷给TA】后自动关闭设置页并回聊天', JSON.stringify(s7));
ok(s7.cards === Number(s7before) + 1 && s7.status === 'sent', 'S7 发出后插入问卷卡片且状态=sent', JSON.stringify(s7));

// 已交卷（done）后再点发送：应能直接再发一轮（用户要「重复提交给联系人作答」）
await evalJs("(function(){ var d=JSON.parse(window.activeStore().get('ta-survey')); d.status='done'; d.answers=['A1','A2']; window.activeStore().set('ta-survey', JSON.stringify(d)); return true; })()");
const s7cards = await evalJs("(function(){return (window.chatExportMsgs()||[]).filter(function(m){return m.special==='ask-survey'}).length;})()");
await evalJs("(function(){var b=document.getElementById('ta-survey-send');if(b)b.click();return true;})()");
await sleep(400);
const s7b = JSON.parse(await evalJs(`(function(){
  var ms=window.chatExportMsgs()||[];
  var n=ms.filter(function(m){return m.special==='ask-survey'}).length;
  var d=null; try{d=JSON.parse(window.activeStore().get('ta-survey'))}catch(e){}
  return JSON.stringify({cards:n, status:d&&d.status, answers:d&&(d.answers?d.answers.length:0), doneMsgAt:d&&d.doneMsgAt});
})()`) || '{}');
ok(s7b.status === 'sent' && s7b.cards === Number(s7cards) + 1 && s7b.answers === 0, 'S7 已交卷后可再次提交一轮（新卡片 + 作答清零 + 状态 sent）', JSON.stringify(s7b));

// —— S5 静态断言：渲染分支/回写助手/发出插卡/CSS 壳/暗色适配 全部在位 ——
const chatSrc = readFileSync(new URL('../src/js/chat.js', import.meta.url), 'utf8');
const taAskSrc = readFileSync(new URL('../src/js/ta-ask.js', import.meta.url), 'utf8');
const cssSrc = readFileSync(new URL('../src/css/chat-main.css', import.meta.url), 'utf8');
const darkSrc = readFileSync(new URL('../src/css/dark.css', import.meta.url), 'utf8');
ok(chatSrc.includes("if (rec.special === 'ask-survey') {"), 'S5 chat.js 有 ask-survey 渲染分支');
ok(chatSrc.includes('window.chatSyncSurveyCard = function (surveyTs, status, answers) {'), 'S5 chat.js 有进度回写助手 chatSyncSurveyCard');
ok(taAskSrc.includes("special: 'ask-survey',"), 'S5 ta-ask.js surveySend 插入 ask-survey 卡片');
ok(taAskSrc.includes('surveySyncCard(cur)') && taAskSrc.includes('surveySyncCard(d2)'), 'S5 ta-ask.js 逐题作答与交卷两处都回写卡片');
ok(cssSrc.includes('.msg-survey-card') && cssSrc.includes('.msg-survey-head') && cssSrc.includes('.msg-survey-tip'), 'S5 chat-main.css 卡片样式壳（标题/提示类在位）');
ok(darkSrc.includes('[data-theme="dark"] .msg-survey-card'), 'S5 dark.css 卡片暗色适配');
// #523 自绘时间选择器替代原生 datetime-local（原生弹层会飘出屏幕）
ok(taAskSrc.includes('function openDeadlinePicker(') && taAskSrc.includes('function dlPickerInit() {'), 'S5 ta-ask.js 自绘时间选择器在位（静态绑定 dlPickerInit）');
ok(taAskSrc.includes("document.getElementById('dl-picker-mask')"), 'S5 选择器挂载/关闭路径在位');
const tplSrc = readFileSync(new URL('../src/template.html', import.meta.url), 'utf8');
ok(!/type="datetime-local"/.test(tplSrc), 'S5 template 已无原生 datetime-local 输入（两处时间入口改按钮）');
ok(tplSrc.includes('id="ta-ask-deadline" class="tc-input deadline-btn"') && tplSrc.includes('id="ta-survey-deadline" class="tc-input deadline-btn"'), 'S5 两处时间入口为自绘按钮');
ok(tplSrc.includes('id="ta-survey-chat"'), 'S5 template 有「TA 的作答发送到聊天消息」开关');
ok(tplSrc.includes('TA 的每条作答都发送到聊天消息'), 'S5 开关文案写明「每条作答都发送到聊天」（用户要求说清楚）');
ok(taAskSrc.includes('window.openSurveyDetail = function (rec) {'), 'S5 ta-ask.js 只读问卷详情弹窗 openSurveyDetail 在位');
ok(tplSrc.includes('id="dl-picker-mask"') && tplSrc.includes('id="dl-picker-secs"') && tplSrc.indexOf('id="dl-picker-quick"') < 0, 'S5 template 预置最简秒选择器静态 DOM（单个输入框）');
ok(taAskSrc.includes("cur.settings.sendToChat !== false"), 'S5 ta-ask.js 逐条发答受 sendToChat 门控（关＝只写卡片不刷聊天）');
ok(taAskSrc.includes('function surveyGoChat() {') && taAskSrc.includes('surveyGoChat();'), 'S5 ta-ask.js 发出后自动回聊天 surveyGoChat 在位');
ok(taAskSrc.includes('d.answers = []; d.doneMsgAt = 0;'), 'S5 ta-ask.js 已交卷可直接重发一轮（发出时清零作答与提醒位）');
ok(taAskSrc.includes('const notify = d2.doneMsgAt !== d2.sentAt;'), 'S5 ta-ask.js 同一轮只提醒一次交卷消息（防重复）');

console.log(fail ? ('FAIL ' + pass + '/' + (pass + fail)) : ('ALL PASS ' + pass + '/' + (pass + fail)));
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
