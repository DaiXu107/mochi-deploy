// #623 查岗互动卡片的作答弹窗默认选中「同意」侧（用户 2026-09-16 直派）。
// 用户原话：「关于联系人发送的查岗互动卡片，和桌面查岗互动卡片，都没有默认是在【同意】的地方，
// 我每次都要多点几遍」。
// 旧行为（两处，都要多点一下）：①跨桌面查岗/求聊天弹窗（incoming-requests deliver）无预设胶囊——
// 必须先点「现在回TA」再点【确认】；②联系人查岗作答弹窗（ck-question openCkReply）无预设选项。
// 期望：打开即选中同意侧（现在回TA / 同意 / 好呀），点一次【确认】就完成；中性选项（在家/在外面）
// 保持不预设（否则一次【确定】就把随便一个答案提交了）；来电「接听」保持必须显式选择。
// 顺带锁住同批修掉的**弹窗与卡面不同源**缺陷：跨桌面查岗卡 meToTa 方向（卡面「要不要来查查我呀？」
// ＋好呀/不要）此前弹窗拿原始题库题，题面与选项都和聊天里的卡对不上。
// 用法：node tools/verify-checkin-agree-default.mjs （需已构建 index.html；CHROME_PATH 可指定浏览器）
// RED 基线复跑：把产物复制一份并去掉两处预设（incoming-requests 的 `pill: req.kind === 'call' ? …`
// 行、ck-question 的 `pill: isSingle ? affirmOptValue(optList) : undefined,` 行＋`openCkReply(msgIdx, q, …)`
// 的第三参），再 MOCHI_PAGE=<那份副本> 跑本脚本。
//   ⚠ Git Bash 会把形如 /tools/x.html 的环境变量值当路径改写成 C:/Program Files/Git/tools/x.html，
//   导航到非法 URL → 页面停在 about:blank → 脚本「全红但全错」（本脚本踩过）。故这里对 PAGE 做兜底
//   规范化；RED 基线请用 MSYS_NO_PATHCONV=1 跑，或把 MOCHI_PAGE 写成不带前导斜杠的相对名。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { statSync, readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
let PAGE = process.env.MOCHI_PAGE || '/index.html';
// 环境变量被 Git Bash 改写成 Windows 绝对路径时（C:/Program Files/Git/tools/…）只取文件名
if (/^[A-Za-z]:[\\/]/.test(PAGE)) PAGE = '/' + PAGE.split(/[\\/]/).pop();
else if (PAGE[0] !== '/') PAGE = '/' + PAGE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let SW_SEEN = false;
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail).slice(0, 240) + ']' : ''));
}

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);
const browserPath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!browserPath) { console.error('找不到 Edge/Chrome，请设置 CHROME_PATH'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (26000 + Math.floor(Math.random() * 2000));
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-ck-agree-' + Date.now()),
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
      console.log('  [eval err]', ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').slice(0, 250));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function waitFor(expr, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await evalJs(expr)) return true; await sleep(200); }
  return false;
}

// 弹窗快照：是否打开、标题、静态说明、胶囊文案、被预设（.on）的胶囊、确认按钮文案
const MODAL = `(function(){
  var m=document.getElementById('modal-mask');
  var st=document.getElementById('modal-static');
  var pills=Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill'));
  return {
    open: !!m && !m.hidden,
    title: (document.getElementById('modal-title')||{}).textContent||'',
    staticText: (st && !st.hidden) ? (st.textContent||'') : '',
    pills: pills.map(function(p){return (p.textContent||'').trim();}),
    on: pills.filter(function(p){return p.classList.contains('on');}).map(function(p){return (p.textContent||'').trim();}),
    okText: (document.getElementById('modal-ok')||{}).textContent||''
  };
})()`;
// 聊天里最后一张 ask-card 的数据（题面/选项/作答状态）
const LAST_CARD = `(function(){
  var msgs = window.getChatMsgs ? window.getChatMsgs() : [];
  for (var i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i] && msgs[i].special === 'ask-card') {
      var r = msgs[i];
      return {
        q: r.askQuestion || r.text || '',
        opts: (r.askOptions || []).map(function(o){return String(o && o.t != null ? o.t : o);}),
        deskCk: !!r.deskCk, dir: r.deskCkDir || null,
        status: r.askStatus || '', answer: r.askAnswer || ''
      };
    }
  }
  return null;
})()`;
const clickOk = "document.getElementById('modal-ok').click(); 1";
// 直接点【确认】（不点任何胶囊）＝验证「默认选中」是否真的把同意侧带下去了
const closeModal = "(function(){var m=document.getElementById('modal-mask');if(m)m.hidden=true;return 1;})()";
const MODAL_OPEN = "(function(){var m=document.getElementById('modal-mask');return !!m&&!m.hidden;})()";
// 清场：关掉遗留弹窗，并等「上一张卡排程中的自动弹窗」露头后一并关掉
//（发卡后 400ms 才弹，用例之间不清场会把上一题当成下一题读＝假绿/假红，本脚本踩过）
async function settle() {
  for (let i = 0; i < 10; i++) {
    await evalJs(closeModal);
    await sleep(450);
    const open = await evalJs(MODAL_OPEN);
    if (!open) return true;
  }
  return false;
}

async function boot() {
  await cdp('Page.navigate', { url: baseUrl + PAGE });
  await sleep(2500);
  await waitFor("(function(){return !!window.__mochiDataReady && typeof window.ckQuestionFire==='function' && typeof window.triggerIncomingCheckin==='function';})()", 24000);
  SW_SEEN = SW_SEEN || (await evalJs("(function(){return !!(navigator.serviceWorker&&navigator.serviceWorker.controller);})()"));
  await evalJs("(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');if(s.parentNode)s.parentNode.removeChild(s);}return 1;})()");
  await sleep(700);
  // 全新 profile 会弹「数据备份提醒」等系统浮层（产品功能，受保护）——不绕过其逻辑，只点掉挡住落点的弹窗
  for (let i = 0; i < 6; i++) {
    const vis = await evalJs("(function(){var m=document.getElementById('modal-mask');return !!m&&!m.hidden;})()");
    if (!vis) break;
    await evalJs("(function(){var m=document.getElementById('modal-mask');var btns=m.querySelectorAll('.modal-btns button,.modal-pills button');if(!btns.length)return 0;btns[btns.length-1].click();return btns.length;})()");
    await sleep(600);
  }
  await evalJs(closeModal);
}
// 手动发一张查岗卡（forceQ，不受题库/冷却影响）；popupProb=100 保证必弹窗；round 钉死方向掷签
function fireQ(q, rnd) {
  const arg = JSON.stringify(q);
  if (rnd === undefined) return `(function(){return window.ckQuestionFire(${arg}, {'ckq-popup-prob':100});})()`;
  return `(function(){var _r=Math.random;Math.random=function(){return ${rnd};};try{return window.ckQuestionFire(${arg},{'ckq-popup-prob':100});}finally{Math.random=_r;}})()`;
}
// 非跨桌面（普通联系人查岗卡）路径：ckQuestionFire 恒带 deskCk 标记，走不到「题库题/互动动作」那条
// 分支——改用题库注入 + triggerCkQuestion(下标)，并把该桌面的弹窗概率设 100（去掉随机不弹）。
const Q_ACTION = { id: 'v623a', cat: 'action', type: 'action', text: '摸摸头', taToMe: 'TA 想摸摸你的头', meToTa: 'TA 想让你摸摸 TA 的头', accept: ['乖，过来。', '嗯，轻轻的。'], reject: ['哼，不要。', '下次吧。'] };
const Q_YESNO = { id: 'v623b', cat: 'single', type: 'single', text: '今晚陪我一下好不好？', options: [{ t: '同意', reply: ['好呀，我记着了。'] }, { t: '拒绝', reply: ['那下次吧。'] }] };
const Q_NEUTRAL = { id: 'v623c', cat: 'single', type: 'single', text: '现在在哪里呀？', options: [{ t: '在家', reply: ['那我放心了。'] }, { t: '在外面', reply: ['路上小心。'] }, { t: '在公司', reply: ['别太累。'] }] };
function bankPut(q) {
  const arg = JSON.stringify(q);
  return `(function(){
  var st = window.xyStore(window.activePrefix());
  var d = null; try { d = JSON.parse(st.get('ta-checkin') || 'null'); } catch (e) { d = null; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
  if (!Array.isArray(d.questions)) d.questions = [];
  d.questions = d.questions.filter(function (x) { return !(x && String(x.id || '').indexOf('v623') === 0); });
  var q = ${arg}; q.enabled = true;
  d.questions.push(q);
  st.set('ta-checkin', JSON.stringify(d));
  st.set('reply-ckq-popup-prob', '100'); // 弹窗必弹（replyCfg 读 reply-<k>）
  return d.questions.length - 1;
})()`;
}
async function fireBankQuestion(q) {
  const idx = await evalJs(bankPut(q));
  if (typeof idx !== 'number' || idx < 0) return false;
  return await evalJs('window.triggerCkQuestion(' + idx + ')');
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Page.bringToFront');
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('xy-home-v2:applock-qa-en','0');localStorage.setItem('xy-home-v2:applock-en','0');localStorage.setItem('xy-home-v2:__last-backup-remind',String(Date.now()));}catch(e){}" });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1.5, mobile: true, screenWidth: 390, screenHeight: 844 });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23127PN0CC) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36' });
// 挡掉 Service Worker（sw.js 导航分支缓存优先，会让 MOCHI_PAGE 指定的 RED 副本被换回真 index.html＝假绿）
await cdp('Network.enable');
await cdp('Network.setBypassServiceWorker', { bypass: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "(function(){try{if(!navigator.serviceWorker)return;var reg={scope:'/',update:function(){return Promise.resolve();},unregister:function(){return Promise.resolve(false);},addEventListener:function(){},showNotification:function(){return Promise.resolve();},getNotifications:function(){return Promise.resolve([]);},installing:null,waiting:null,active:null};navigator.serviceWorker.register=function(){return Promise.resolve(reg);};Object.defineProperty(navigator.serviceWorker,'ready',{get:function(){return Promise.resolve(reg);}});}catch(e){}})()" });

// ================= S0 环境闸门 =================
await boot();
const env = await evalJs("(function(){return {data:!!window.__mochiDataReady, fire:typeof window.ckQuestionFire==='function', trig:typeof window.triggerIncomingCheckin==='function', modal:!!document.getElementById('modal-mask'), pills:!!document.getElementById('modal-pills'), hidden:!!document.hidden};})()");
check('S0 环境闸门：数据就绪 + 查岗弹窗/跨桌面触发钩子齐备 + 页面在前台', !!(env && env.data && env.fire && env.trig && env.modal && env.pills && env.hidden === false), env);
const noModal = await evalJs("(function(){var m=document.getElementById('modal-mask');return !m||m.hidden;})()");
check('S0b 环境闸门：起手没有任何浮层占着（否则弹窗路径被 cardPopupBusy 挡住）', noModal === true, noModal);

// ================= H1 桌面查岗（跨桌面）弹窗：默认选中「现在回TA」 =================
const h1 = await evalJs("window.triggerIncomingCheckin('default')");
await sleep(700);
const h1m = await evalJs(MODAL);
check('H1-1 跨桌面查岗弹窗已打开（标题…来查岗了）', !!(h1m && h1m.open && /来查岗了/.test(h1m.title)) && h1 === true, { ret: h1, modal: h1m });
check('H1-2 胶囊两枚：稍后 / 现在回TA', !!(h1m && h1m.pills.length === 2 && h1m.pills[0] === '稍后' && h1m.pills[1] === '现在回TA'), h1m && h1m.pills);
check('H1-3 同意侧默认选中（旧版：一个都没选中＝用户报的「没有默认在同意」）', !!(h1m && h1m.on.length === 1 && h1m.on[0] === '现在回TA'), h1m && h1m.on);
await evalJs(clickOk);
// 点了确认后这张弹窗必须离场（旧版：pillVal 为 null → 留原地说「请先选择」）
const h1gone = await waitFor("(function(){var m=document.getElementById('modal-mask');var t=(document.getElementById('modal-title')||{}).textContent||'';return !(m&&!m.hidden&&/来查岗了/.test(t));})()", 3000);
check('H1-4 不点胶囊直接点【确认】即离场（旧版会留在原地提示先选）', h1gone === true, await evalJs(MODAL));
const h1card = await waitFor("(function(){var c=" + LAST_CARD + ";return !!(c&&c.deskCk);})()", 9000);
const h1c = await evalJs(LAST_CARD);
check('H1-5 同意后切过去当场发了那张桌面查岗卡（证明回传值就是「现在回TA」）', h1card === true && !!(h1c && h1c.deskCk), h1c);
await settle(); // 这张卡自己的自动弹窗也清掉，别污染 H2 之后的用例

// ================= H2 跨桌面来电弹窗：刻意不预设（误触确认代价高） =================
await evalJs("(function(){if(window.setDeskCallEn)window.setDeskCallEn(true);return 1;})()"); // 跨桌面来电默认关闭（#448），先打开
await sleep(400);
const h2 = await evalJs("window.triggerIncomingCallReq('default')");
await sleep(700);
const h2m = await evalJs(MODAL);
check('H2-1 跨桌面来电弹窗打开且胶囊是 稍后 / 接听', !!(h2m && h2m.open && h2m.pills.length === 2 && h2m.pills[1] === '接听') && h2 === true, { ret: h2, modal: h2m });
check('H2-2 来电不预设同意侧（接听会先挂断进行中的通话，必须显式选择）', !!(h2m && h2m.open && h2m.on.length === 0), h2m && h2m.on);
await evalJs("(function(){var p=document.querySelectorAll('#modal-pills .pill')[0];if(p)p.click();return 1;})()"); // 点「稍后」收尾
await sleep(500);
await evalJs(clickOk);
await sleep(500);
await settle();

// ================= H3 联系人查岗互动卡（互动动作）：默认选中「好呀」并可直接提交 =================
await evalJs("(function(){if(window.enterChat)window.enterChat();return 1;})()");
await sleep(800);
await settle();
const h3 = await fireBankQuestion(Q_ACTION);
await sleep(1400);
const h3m = await evalJs(MODAL);
check('H3-1 互动动作弹窗打开（标题 互动回应）且选项是 好呀/不要', !!(h3m && h3m.open && h3m.title === '互动回应' && h3m.pills.join('/') === '好呀/不要') && h3 === true, { ret: h3, modal: h3m });
check('H3-2 「好呀」默认选中（同意侧）', !!(h3m && h3m.on.length === 1 && h3m.on[0] === '好呀'), h3m && h3m.on);
await evalJs(clickOk);
const h3done = await waitFor("(function(){var c=" + LAST_CARD + ";return !!(c&&c.status==='answered'&&c.answer==='好呀');})()", 6000);
const h3c = await evalJs(LAST_CARD);
check('H3-3 直接点【确认】＝按「好呀」作答（卡片就地转为已回答）', h3done === true && !!(h3c && h3c.answer === '好呀'), h3c);
await settle();

// ================= H4 单选题里带「同意」选项：同样默认选中 =================
const h4 = await fireBankQuestion(Q_YESNO);
await sleep(1400);
const h4m = await evalJs(MODAL);
check('H4-1 单选题弹窗胶囊 同意/拒绝', !!(h4m && h4m.open && h4m.pills.join('/') === '同意/拒绝') && h4 === true, { ret: h4, modal: h4m });
check('H4-2 「同意」默认选中', !!(h4m && h4m.on.length === 1 && h4m.on[0] === '同意'), h4m && h4m.on);
await evalJs(clickOk);
const h4done = await waitFor("(function(){var c=" + LAST_CARD + ";return !!(c&&c.status==='answered'&&c.answer==='同意');})()", 6000);
check('H4-3 直接点【确认】＝按「同意」作答', h4done === true, await evalJs(LAST_CARD));
await settle();

// ================= H5 中性选项（在家/在外面/在公司）：不预设，防一次【确定】把随便一个答案交上去 =================
const h5 = await fireBankQuestion(Q_NEUTRAL);
await sleep(1400);
const h5m = await evalJs(MODAL);
check('H5-1 中性单选题弹窗打开、三枚胶囊都在', !!(h5m && h5m.open && h5m.pills.length === 3) && h5 === true, { ret: h5, modal: h5m });
check('H5-2 中性选项一个都不预设（旧行为不变）', !!(h5m && h5m.on.length === 0), h5m && h5m.on);
await evalJs("(function(){var p=document.querySelectorAll('#modal-pills .pill')[0];if(p)p.click();return 1;})()"); // 点第一个选项提交，收尾
await sleep(600);
await settle();

// ================= H6 跨桌面查岗卡 meToTa 方向：弹窗与卡面同源 + 「好呀」默认选中 =================
const h6 = await evalJs(fireQ(Q_NEUTRAL, 0.9)); // 0.9 ⇒ buildDeskCkCard 走 meToTa（卡面「要不要来查查我呀？」＋好呀/不要）
await sleep(1400);
const h6m = await evalJs(MODAL);
const h6c = await evalJs(LAST_CARD);
check('H6-1 meToTa 方向卡面就是「要不要来查查我呀？」＋好呀/不要（前置条件）', !!(h6c && h6c.q === '要不要来查查我呀？' && h6c.opts.join('/') === '好呀/不要') && h6 === true, { ret: h6, card: h6c });
check('H6-2 弹窗题面与卡面一致（旧版拿原始题库题＝弹出另一道题）', !!(h6m && h6m.open && h6m.staticText.indexOf('要不要来查查我呀？') >= 0), h6m && h6m.staticText);
check('H6-3 弹窗选项与卡面一致（旧版会是「在家/在外面/在公司」，压根没有同意侧可选）', !!(h6m && h6m.pills.join('/') === '好呀/不要'), h6m && h6m.pills);
check('H6-4 桌面查岗卡的「好呀」默认选中', !!(h6m && h6m.on.length === 1 && h6m.on[0] === '好呀'), h6m && h6m.on);
await evalJs("(function(){var ps=document.querySelectorAll('#modal-pills .pill');if(ps[1])ps[1].click();return 1;})()"); // 点「不要」收尾（pillSubmit 即提交）
await sleep(700);
await settle();

// ================= H7 跨桌面查岗卡 toMe 方向：卡面＝题库题，弹窗同样跟着卡面 =================
const h7 = await evalJs(fireQ(Q_NEUTRAL, 0.1)); // 0.1 ⇒ toMe：卡面就是题库题本身
await sleep(1400);
const h7m = await evalJs(MODAL);
const h7c = await evalJs(LAST_CARD);
check('H7-1 toMe 方向卡面＝题库题（前置条件）', !!(h7c && h7c.q === '现在在哪里呀？' && h7c.opts.join('/') === '在家/在外面/在公司') && h7 === true, { ret: h7, card: h7c });
check('H7-2 弹窗题面与卡面一致', !!(h7m && h7m.open && h7m.staticText.indexOf('现在在哪里呀？') >= 0), h7m && h7m.staticText);
check('H7-3 弹窗选项与卡面一致且不预设（中性题不猜答案）', !!(h7m && h7m.pills.join('/') === h7c.opts.join('/') && h7m.on.length === 0), h7m && { pills: h7m.pills, on: h7m.on });
await evalJs("(function(){var ps=document.querySelectorAll('#modal-pills .pill');if(ps[1])ps[1].click();return 1;})()");
await sleep(700);
await settle();

// ================= S9 无 JS 错误污染 + 自证闸门 =================
const errs = await evalJs("(function(){return (window.__jsErrors||[]).filter(function(e){return /openCkReply|ckQuestion|affirm|incoming|modal/i.test(String((e&&e.message)||e));}).length;})()");
check('S9-1 相关路径零 JS 错误', errs === 0, errs);
const swNow = await evalJs("(function(){return !!(navigator.serviceWorker&&navigator.serviceWorker.controller);})()");
check('S9-2 自证闸门：全程未被 Service Worker 接管（否则可能测到缓存里的 index.html＝假绿）', SW_SEEN === false && swNow === false, { boot: SW_SEEN, end: swNow });

browser.kill();
server.close();
const pass = results.filter((r) => r.ok).length;
console.log('\n' + pass + '/' + results.length + ' 通过');
process.exit(pass === results.length ? 0 : 1);
