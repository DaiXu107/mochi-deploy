// ===== 验证 #583：字卡自检页补「回复设置 → 聊天」侧的链路闸门 =====
// 用户原话：「字卡使用状态自检里，还需要可以把回复设置里的聊天设置那些全部检查加进去，怎么优化」。
// 背景：自检页原先只盖「卡池有没有货」（锁 / 开关 / 概率 / 分组停用 / 单卡关闭 / 媒体健康），
//   回复设置那半边——词典拼字、梦角自由造句、多字卡回复、自定义字卡占比、附加件、已读不回——
//   完全没进去。而「字卡用不到」有一半原因正在这半边（池子满的，但这条回复根本没走到出卡那一步）。
// 同批修掉的口径错误（本节的核心断言）：原先那张「系统预设 ↔ 自定义字卡占比」卡把预设占比
//   直接串成 dc-overall-chat 的原值，同时漏了三道真实闸门——dc-use-chat 场景开关、总档缩放
//   (dcpEff)、以及 csp-cust。消费端 chat.js genReplyText 是在默认字卡覆盖点**之前**按
//   csp-cust 掷签保留自定义文本，因此两者不是「互补的 100%」：
//     预设真正落进回复的概率 = 总档缩放后的聊天概率 ×(1 − csp-cust%)
//   默认值下 30% → 实际 15%（原先高报一倍，用户照它调参会调反）。
// 内存拼装 src（与 build.mjs 同序、不写产物）→ 无头 Chrome 实测，构建前后都能跑。
// 用法：node tools/verify-card-audit-reply-chain.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => readFileSync(join(root, 'src', p), 'utf8');

const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const arr = (name) => new Function('return ' + bm.match(new RegExp('const ' + name + ' = (\\[.*?\\]);', 's'))[1])();
const css = arr('cssFiles').map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
const js = arr('jsFiles').map((f) => readFileSync(join(root, 'src', 'js', f), 'utf8')).join('\n');
let html = read('template.html').replace('__APP_VERSION__', 'v3.26.0-test');
html = html.replace('</head>', '<style>' + css + '</style></head>');
// 错误捕获脚本要在业务 js 之前挂上，才能把启动期异常也记进 __errs
html = html.replace('</body>',
  '<script>window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String(e.message||e));});<\/script>' +
  '<script>' + js + '<\/script></body>');

let fail = 0;
const T = (name, ok, extra) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + extra : '')); if (!ok) fail++; };

// —— 静态断言 ——
const auditSrc = read('js/card-audit.js');
T('S1 预设覆盖率按「总档缩放 ×(1−csp-cust)」算（退回旧串法＝又高报一倍）',
  auditSrc.indexOf('var presetFinal = (lock || !dcEn || !dcUseChat) ? 0 : Math.round(dcOvEff * (100 - cspCust) / 100);') >= 0);
T('S2 旧的「互补占比」口径已移除（系统预设 X% / 自定义 (100−X)% 的说法不成立）',
  auditSrc.indexOf('系统预设 ↔ 自定义字卡占比') < 0 && auditSrc.indexOf('var customShare = 100 - sysShare') < 0);
T('S3 回复设置侧闸门真的读了 csp-cust / dc-use-chat / qs-* / mjf-* / py-en',
  ['csp-cust', 'dc-use-chat', 'qs-prob', 'mjf-prob', 'py-en'].every((k) => auditSrc.indexOf("'" + k + "'") >= 0));
T('S4 「调整」直达 回复设置→聊天 tab 的跳转分支在位',
  auditSrc.indexOf("if (key.indexOf('@reply:') === 0) return openReplyPage(key.slice(7));") >= 0);
T('S5 默认聊天字卡漏斗已补「聊天场景」与「总档」两道真实闸门',
  auditSrc.indexOf("{ t: '聊天场景', ok: dcUseChat }, { t: '总档', ok: all > 0 },") >= 0);
T('S6 附加件全 0 有「全部恢复默认」且逐键回默认（#1451 重锚：改写为 fixOne——先记撤销、再 replySet 写 reply- 前缀键）',
  auditSrc.indexOf("function fixOne(a) { recordUndo('own', 'reply-' + a[0]); if (replySet(a[0], a[2])) okAny = true; }") >= 0 &&
  auditSrc.indexOf('ATTACH.forEach(fixOne);') >= 0);
if (fail) { console.log('静态断言已有失败，跳过无头部分'); process.exit(1); }

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

const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
  const map = { '/manifest.json': 'pwa/manifest.json', '/notice.json': 'pwa/notice.json', '/sw.js': 'pwa/sw.js' };
  if (map[url]) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(read(map[url])); return; }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vca-rc-' + Date.now()),
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

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;s.style.display='none';}return true;})()");
await sleep(700);

// 二级锁：干净 profile 里 cardlock-state 未设＝isOpen() false＝按「锁定」算，会把这里的
// 每一道闸门都染成 ✕、覆盖率恒 0。本节验的是「解锁态下的回复设置闸门」，
// 故先显式置 open 并补发事件（card-audit 监听该事件重渲染）。
await evalJs("(function(){try{window.xyStore('xy-home-v2').set('cardlock-state','open');}catch(e){}document.dispatchEvent(new Event('mochi-cardlock-open'));return true;})()");
await sleep(300);
const unlocked = await evalJs("(function(){try{return !!window.cardLockOpen();}catch(e){return null;}})()");
T('B1 测试前置：二级锁已置为解锁态', unlocked === true, 'cardLockOpen=' + unlocked);

// 种入一组确定的键，让下方期望值可精确断言（不依赖各键出厂默认）
// #1451：回复设置侧的键真实存名一律带 reply- 前缀（设置页 saveReplyCfg 写、体检页 replyRaw 读的同一份）。
//   夹具此前按裸键写、按裸键读——模拟的不是任何真实用户动作；体检页改读真源后裸键种子不再被读到（实测 8 条红）。
//   裸键（dc-* / dict-* / rc-enabled / rcard-prob）保持原样：它们本来就是各模块 window.activeStore() 直读的。
//   （reply-dcp-all 在调用处本来就写了前缀，不在映射表内。）
const REPLY_SEED = ['csp-cust', 'qs-en', 'qs-prob', 'mjf-en', 'mjf-prob', 'py-en', 'py-prob', 'rn-prob',
  'sticker-prob', 'image-prob', 'touch-prob', 'emoji-prob', 'voice-prob', 'kaomoji-prob', 'quote-prob'];
const rk = (k) => (REPLY_SEED.indexOf(k) >= 0 ? 'reply-' + k : k);
const seed = async (obj) => {
  const mapped = {};
  Object.keys(obj).forEach((k) => { mapped[rk(k)] = obj[k]; });
  return evalJs("(function(o){try{var s=window.activeStore();Object.keys(o).forEach(function(k){s.set(k,String(o[k]));});}catch(e){}return true;})(" + JSON.stringify(mapped) + ")");
};
const refresh = async () => { await evalJs("(function(){var r=document.getElementById('card-audit-refresh');if(r)r.click();return true;})()"); await sleep(1000); };
const openAudit = async () => {
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=true;});var s=document.getElementById('page-setting');if(s)s.hidden=false;return true;})()");
  await sleep(150);
  await evalJs("(function(){var r=document.getElementById('row-card-audit');if(r)r.click();return true;})()");
  await sleep(1300);
};
const bodyText = async () => (await evalJs("(function(){var b=document.getElementById('card-audit-body');return b?b.textContent:'';})()")) || '';

// B2 新节渲染
await seed({ 'dc-enabled': 1, 'dc-use-chat': 1, 'dc-overall-chat': 30, 'reply-dcp-all': 100, 'csp-cust': 50, 'qs-en': 1, 'qs-prob': 25, 'mjf-en': 1, 'mjf-prob': 20, 'py-en': 1, 'rn-prob': 20 });
await openAudit();
let body = await bodyText();
T('B2 渲染「回复链路（回复设置 → 聊天）」节', body.indexOf('回复链路（回复设置 → 聊天）') >= 0);
T('B3 机制竞争表含 词典拼字 / 梦角自由造句 / 多字卡回复 / 聊天回应字卡',
  ['词典拼字', '梦角自由造句', '多字卡回复', '聊天回应字卡'].every((s) => body.indexOf(s) >= 0));
T('B4 旧的「系统预设 ↔ 自定义占比」卡已不在',
  body.indexOf('系统预设 ↔ 自定义字卡占比') < 0);

// B5 ★核心 RED 判据★ 默认值下覆盖率必须是 15% 而不是 30%（旧口径直接把 dc-overall-chat 当占比）
//    30 ×(总档100%)× (1 − 50%) = 15
T('B5 预设覆盖率＝总档缩放 ×(1−csp-cust)＝15%（旧口径会显示 30%，回退即红）',
  body.indexOf('预设默认字卡覆盖 15%') >= 0,
  (body.match(/预设默认字卡覆盖 \d+%/) || ['未匹配'])[0]);
// B6 总档打折后同步缩到 8%（30×50%=15，再 ×50% = 7.5 → 四舍五入 8）
await seed({ 'reply-dcp-all': 50 });
await refresh();
body = await bodyText();
T('B6 总档 50% 时覆盖率同步缩到 8%（说明总档真的参与了这一签）',
  body.indexOf('预设默认字卡覆盖 8%') >= 0,
  (body.match(/预设默认字卡覆盖 \d+%/) || ['未匹配'])[0]);
// B7 csp-cust=0：预设吃满（30%），且本行要提示「自定义字卡基本不出现」并给修复
await seed({ 'reply-dcp-all': 100, 'csp-cust': 0 });
await refresh();
body = await bodyText();
T('B7 csp-cust=0 时覆盖率回升到 30% 且提示「自定义字卡基本不出现」',
  body.indexOf('预设默认字卡覆盖 30%') >= 0 && body.indexOf('自定义字卡基本不出现') >= 0);
T('B8 「一键恢复字卡链路」按钮出现', (await evalJs("(function(){return document.querySelectorAll('#card-audit-body [data-fix=\"__allfix-reply\"]').length;})()")) >= 1);

// B8b 聊天回应字卡：总开关关着时「恢复」必须把开关一并打开
//     （只写 rcard-prob 是空转——概率本来就非 0，按钮点了等于没反应）
await seed({ 'rc-enabled': 0, 'rcard-prob': 25 });
await refresh();
const rcClicked = await evalJs("(function(){var b=document.querySelector('#card-audit-body [data-fix=\"inl-rs-rc\"]');if(!b)return false;b.click();return true;})()");
await sleep(1000);
const rcAfter = await evalJs("(function(){try{return String(window.activeStore().get('rc-enabled'));}catch(e){return null;}})()");
T('B8b 聊天回应字卡「恢复」把总开关一并打开（只写 rcard-prob 是空转）',
  rcClicked === true && rcAfter === '1', 'clicked=' + rcClicked + ' rc-enabled=' + rcAfter);

// B9 回复设置侧闸门关掉时要进结论清单（qs-en=0）
await seed({ 'qs-en': 0 });
await refresh();
body = await bodyText();
T('B9 「词典拼字」总开关关闭进问题清单', body.indexOf('词典拼字」总开关关闭') >= 0);

// B10 「一键恢复字卡链路」真的把回复设置侧写回默认
await evalJs("(function(){var b=document.querySelector('#card-audit-body [data-fix=\"__allfix-reply\"]');if(b)b.click();return true;})()");
await sleep(1100);
const restored = await evalJs("(function(){try{var s=window.activeStore();return JSON.stringify({qs:s.get('reply-qs-en'),csp:s.get('reply-csp-cust')});}catch(e){return '{}';}})()");
const R = (() => { try { return JSON.parse(restored || '{}'); } catch (e) { return {}; } })();
T('B10 一键恢复字卡链路：qs-en→1 且 csp-cust→50（两键同一批修好）',
  String(R.qs) === '1' && String(R.csp) === '50', restored);

// B11 「调整」直达 回复设置 → 聊天 tab
await openAudit();
const jumped = await evalJs(`(function(){
  var el=document.querySelector('#card-audit-body [data-jump="@reply:chat"]');
  if(!el) return JSON.stringify({no:true});
  el.click();
  var rp=document.getElementById('page-reply-settings');
  var panel=document.querySelector('#page-reply-settings .gs-panel[data-rpanel="chat"]');
  var tab=document.querySelector('#page-reply-settings .fav-tab[data-rp="chat"]');
  return JSON.stringify({no:false,vis:!!rp&&!rp.hidden,panelVis:!!panel&&!panel.hidden,tabSel:!!tab&&tab.classList.contains('sel')});
})()`);
const J = (() => { try { return JSON.parse(jumped || '{}'); } catch (e) { return {}; } })();
T('B11 点「调整」直达 回复设置页的「聊天」分类', J.no === false && J.vis === true && J.panelVis === true && J.tabSel === true, jumped);

// B12 默认聊天字卡节的漏斗补了「聊天场景」「总档」
await openAudit();
body = await bodyText();
T('B12 默认聊天字卡漏斗出现「聊天场景」「总档」闸门', body.indexOf('聊天场景') >= 0 && body.indexOf('总档') >= 0);

// —— 复查轮补的三条（每条都对应一个本轮真改掉的缺陷）——

// B14 mediaOff：只有「表情包/图片」两项为 0 时也要单独报（这两项抽的正是字卡库里的
//     sticker/image 卡），且修复按钮只补这两键、不动用户有意留着的其它附加件
await seed({ 'sticker-prob': 0, 'image-prob': 0, 'touch-prob': 7, 'emoji-prob': 6, 'voice-prob': 11, 'kaomoji-prob': 4, 'quote-prob': 31 });
await refresh();
body = await bodyText();
T('B14a 仅表情包/图片为 0 时进问题清单（全 7 项为 0 之外的第二档信号）',
  body.indexOf('表情包概率') >= 0 && body.indexOf('图片概率') >= 0 && body.indexOf('不会在聊天里出现') >= 0);
const attFix = await evalJs(`(function(){
  var b=document.querySelector('#card-audit-body [data-fix="inl-rs-attach"]');
  var diag={lk:(function(){try{return window.cardLockOpen();}catch(e){return 'err';}})(),
            st:(function(){try{return window.activeStore().get('reply-sticker-prob');}catch(e){return 'err';}})()};
  if(!b) return JSON.stringify({no:true, diag:diag});
  var t=b.textContent; b.click();
  return JSON.stringify({no:false,txt:t, diag:diag});
})()`);
await sleep(1000);
const attAfter = await evalJs("(function(){try{var s=window.activeStore();return JSON.stringify({st:s.get('reply-sticker-prob'),im:s.get('reply-image-prob'),tc:s.get('reply-touch-prob'),qt:s.get('reply-quote-prob')});}catch(e){return '{}';}})()");
const A = (() => { try { return JSON.parse(attAfter || '{}'); } catch (e) { return {}; } })();
T('B14b 该修复只补表情包/图片两键，不动其它附加件（touch/quote 保持用户值）',
  A.st === '10' && A.im === '5' && A.tc === '7' && A.qt === '31', attAfter + ' btn=' + attFix);

// B15 py-prob=0：与「开关关着」是两个闸门，同一颗按钮要一起收口
await seed({ 'py-en': 1, 'py-prob': 0 });
await refresh();
const pyFix = await evalJs("(function(){var b=document.querySelector('#card-audit-body [data-fix=\"inl-rs-py\"]');if(!b)return false;b.click();return true;})()");
await sleep(1000);
const pyAfter = await evalJs("(function(){try{var s=window.activeStore();return JSON.stringify({en:s.get('reply-py-en'),pr:s.get('reply-py-prob')});}catch(e){return '{}';}})()");
const P = (() => { try { return JSON.parse(pyAfter || '{}'); } catch (e) { return {}; } })();
T('B15 py-prob=0 时「恢复概率」把概率写回 50、开关不被误改',
  pyFix === true && P.pr === '50' && P.en === '1', pyAfter);

// B16 rn-prob>60：大批消息只显示回执，字卡基本看不到——要进清单（但只算 warn）
await seed({ 'rn-prob': 80 });
await refresh();
body = await bodyText();
T('B16 已读不回 80% 进问题清单并说明后果', body.indexOf('大多数消息只会显示回执') >= 0);

// B17 聊天回应字卡行同时给出存盘值与生效值（总档缩放下光看生效值会以为是设置被改了）
await seed({ 'rn-prob': 20, 'rc-enabled': 1, 'rcard-prob': 30, 'reply-dcp-all': 50 });
await refresh();
body = await bodyText();
T('B17 聊天回应字卡行给出「存盘 30% · 生效 15%」对照',
  body.indexOf('整条替换 存盘 30% · 生效 15%') >= 0,
  (body.match(/整条替换[^｜]{0,40}/) || ['未匹配'])[0]);

// B18 全程无 JS 异常
const errs = await evalJs('JSON.stringify((window.__errs||[]).slice(0,4))');
const E = (() => { try { return JSON.parse(errs || '[]'); } catch (e) { return []; } })();
T('B18 全程无 JS 异常', E.length === 0, E.join(' / '));

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n== #583 字卡自检·回复链路验证: ' + (fail === 0 ? 'ALL PASS' : fail + ' FAIL') + ' ==');
process.exit(fail === 0 ? 0 : 1);
