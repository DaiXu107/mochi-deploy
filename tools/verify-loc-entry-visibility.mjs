// ===== 回归脚本：#875 「TA在身边」入口在寻踪内常显化（藏是设计，但不能被读成寻踪的附加说明） =====
// 用法：node build.mjs && node tools/verify-loc-entry-visibility.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-loc-entry-visibility.mjs   （红绿对照：测纯 HEAD 副本时本批应红）
// 背景（用户直派两问）：①「联系人给我发送【隔着世界在你身边】，这个是【TA在身边】功能里的吗」——
//   是：该句出自 src/js/loc-lib.js 的「感知」字卡组，聊天里那条由 TA 自动换位 doLocAuto 每 2~6 小时
//   掷出（70% 抽「陪伴卡」池，池里五分之一就是这句），受「换位发到聊天」开关控制，走 chatAddIn 以
//   side='in' 落地（＝看起来是 TA 发来的）。②「【TA在身边】功能按钮不明显，好多不知道有这个功能」，
//   并明确纠正「我就是想藏在这个寻踪功能里」——所以本批**不加任何新入口**，只让已经打开寻踪的人看得见。
// 根因（零机型分支，纯入口形态问题）：位置面板的唯一入口是寻踪半框与寻踪页里那两颗按钮，而它们是
//   全宽浅色虚线的次要按钮（display:block / text-align:center / border:1px dashed / 13px），排在
//   面板内容最底部 —— 与上面三行「TA 在哪里/在做什么/想对你说」（11px 灰标签＋16px 加粗值）相比
//   语气是「附加说明」，文案后半句「看看 TA 在哪」又是个动词短语，于是被读成「再看一次日常的另一个
//   按钮」。连带功能后果：「TA 自动换位 / 换位提醒弹窗 / 换位发到聊天」三个开关只住在位置面板里，
//   用户收到自动换位消息想关掉时，唯一路径就是这颗看不清的按钮 ⇒ 找不到功能也关不掉。
// 修复：两处入口改「图标＋主标题＋副标题＋箭头」功能卡（主标题点名功能、副标题点出面板里有什么、
//   含换位开关），放置与点击行为一字未动（仍是 #ck-loc-entry / #ck-loc-entry-desk → openLocPanel）。
// 断言面：S 产物锚（新形态在位＋旧弱形态不回流）/ B 聊天寻踪半框入口（结构·样式·体量·不出可视区·
//   点开行为·面板内容）/ B9 桌面寻踪页同款 / B10 暗色下仍成立 / Z 零异常。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const art = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const artifactHtml = art('index.html');
const artifactTpl = art('src/template.html');
const artifactCss = art('src/css/chat-pages.css');

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(tmpdir(), 'mochi-loc-entry-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const events = [];
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
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
          if (m.method === 'Runtime.exceptionThrown') events.push('exception:' + JSON.stringify(m.params.exceptionDetails).slice(0, 200));
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.log('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}
async function bootToChat() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 90; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
  // 开屏必须走 .hide（base.css `.splash:not(.hide) ~ .phone{visibility:hidden}`——只 hidden/display:none 会让整棵页面树量成不可见）
  await evalJs(`(function(){ var s=document.querySelector('.splash'); if(s) s.classList.add('hide'); var q=document.getElementById('qa-close'); if(q) q.click(); })()`);
  await sleep(400);
  await evalJs(`(function(){ var a=document.querySelector('.app[data-app="chat"]'); if(a) a.click(); })()`);
  await sleep(900);
  await evalJs(`(function(){ var a=document.getElementById('chat-partner-av'); if(a) a.click(); })()`);
  await sleep(700);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// 入口四件套的产物/源码形态（新形态在位 = 图标块紧跟在按钮开标签之后）
const NEW_CHAT = 'id="ck-loc-entry"><span class="ck-loc-ico">';
const NEW_DESK = 'id="ck-loc-entry-desk"><span class="ck-loc-ico">';
const SUBTITLE = '方位感知·位置时间线·换位开关';
const CSS_CARD = '.ck-loc-entry { display:flex; align-items:center; gap:9px; width:100%;';

// ---- S. 产物锚（本批改动的逻辑形态；两套读法：构建产物 index.html ＋ src 源） ----
const inBuilt = (s) => artifactHtml.indexOf(s) >= 0;
const inTpl = (s) => artifactTpl.indexOf(s) >= 0;
check('S1 聊天寻踪半框入口已改功能卡（图标块紧跟按钮开标签）', inBuilt(NEW_CHAT), '产物');
check('S2 桌面寻踪页入口同款（两入口形态一致）', inBuilt(NEW_DESK), '产物');
check('S3 副标题点出「换位开关」（用户找不到的就是它）', inBuilt(SUBTITLE), '产物');
check('S4 旧弱按钮形态不回流（全宽浅色虚线次要按钮；回流＝用户又读成寻踪的附加说明）',
  artifactTpl.indexOf('>TA在身边 · 看看 TA 在哪</button>') < 0 && artifactCss.indexOf('border:1px dashed rgba(0,0,0,.18); border-radius:12px;') < 0);
check('S5 入口卡 flex 形态在源码（退回 display:block 居中＝弱按钮复发）', artifactCss.indexOf(CSS_CARD) >= 0);
check('S6 点击接线未断（两个 id 仍被 p2-features.js 取用）',
  art('src/js/p2-features.js').indexOf("getElementById('ck-loc-entry')") >= 0 && art('src/js/p2-features.js').indexOf("getElementById('ck-loc-entry-desk')") >= 0);

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await bootToChat();

// ---- B1~B6. 聊天寻踪半框里的入口形态 ----
const probe = `(function(){
  var panel=document.getElementById('ck-panel');
  var btn=document.getElementById('ck-loc-entry');
  if(!panel || panel.hidden === true) return { panelOpen: false };
  if(!btn) return { panelOpen: true, btn: false };
  var cs=getComputedStyle(btn);
  var t=btn.querySelector('.ck-loc-t'), s=btn.querySelector('.ck-loc-s'), ico=btn.querySelector('.ck-loc-ico');
  var box=document.getElementById('ck-panel-body');
  var br=btn.getBoundingClientRect(), boxr=box?box.getBoundingClientRect():null;
  return {
    panelOpen: true, btn: true,
    rect: { w: Math.round(br.width), h: Math.round(br.height), bottom: Math.round(br.bottom) },
    boxBottom: boxr ? Math.round(boxr.bottom) : null,
    boxScroll: box ? (box.scrollHeight - box.clientHeight) : null,
    display: cs.display, borderStyle: cs.borderTopStyle, radius: cs.borderTopLeftRadius,
    text: (btn.textContent||'').trim(),
    hasIco: !!ico, hasTitle: !!t, hasSub: !!s, hasArrow: !!btn.querySelector('.ck-loc-arrow'),
    icoBg: ico ? getComputedStyle(ico).backgroundImage.slice(0, 24) : '',
    icoW: ico ? Math.round(ico.getBoundingClientRect().width) : 0,
    titleSize: t ? parseFloat(getComputedStyle(t).fontSize) : 0,
    titleWeight: t ? getComputedStyle(t).fontWeight : '',
    titleColor: t ? getComputedStyle(t).color : '',
    subSize: s ? parseFloat(getComputedStyle(s).fontSize) : 0,
    subColor: s ? getComputedStyle(s).color : ''
  };
})()`;
const b = await evalJs(probe);
check('B1 点聊天顶部头像打开寻踪半框，入口按钮在其中（夹具前提）', !!(b && b.panelOpen && b.btn), JSON.stringify(b || {}).slice(0, 120));
check('B2 入口已不是纯文字按钮：图标＋主标题＋副标题＋箭头四件套齐备（修复前一个都没有）',
  !!(b && b.hasIco && b.hasTitle && b.hasSub && b.hasArrow), b && ('ico=' + b.hasIco + ' title=' + b.hasTitle + ' sub=' + b.hasSub + ' arrow=' + b.hasArrow));
check('B3 主标题点名功能（"TA在身边 · 位置感知"）', !!(b && b.hasTitle && b.text.indexOf('位置感知') >= 0), b && b.text.slice(0, 40));
check('B4 副标题含「换位开关」（收到自动换位消息想关掉的用户靠它找到开关）', !!(b && b.hasSub && b.text.indexOf('换位开关') >= 0), b && b.text.slice(0, 60));
check('B5 样式为功能卡而非弱按钮：display:flex ＋ 实线边框（修复前 block ＋ dashed）',
  !!(b && b.display === 'flex' && b.borderStyle === 'solid'), b && (b.display + ' / ' + b.borderStyle));
check('B6 视觉体量上升：图标块有底色渐变、主标题 ≥14px（修复前 13px）、副标题为次要色',
  !!(b && /gradient/.test(b.icoBg || '') && b.icoW >= 30 && b.titleSize >= 14 && b.subSize > 0 && b.subColor !== b.titleColor),
  b && ('icoBg=' + b.icoBg + ' icoW=' + b.icoW + ' title=' + b.titleSize + 'px sub=' + b.subSize + 'px'));

// ---- B7. 变高之后仍在半框可视区内（排在最底部＋变高＝若要滚动才看得到，等于没修） ----
check('B7 入口在半框可视区内、无需滚动（改后变高，必须仍一眼看到）',
  !!(b && b.rect && b.boxBottom != null && b.rect.bottom <= b.boxBottom + 1),
  b && ('btnBottom=' + b.rect.bottom + ' boxBottom=' + b.boxBottom + ' 需滚动=' + b.boxScroll + 'px'));

// ---- B8. 点它仍然打开位置面板，且面板里确实有副标题承诺的内容 ----
const opened = await evalJs(`(function(){
  var btn=document.getElementById('ck-loc-entry'); if(!btn) return 'no-btn';
  btn.click();
  var p=document.getElementById('loc-panel');
  var ck=document.getElementById('ck-panel');
  return {
    open: p ? !p.hidden : null, full: p ? p.className.indexOf('loc-full') >= 0 : null,
    ckClosed: ck ? ck.hidden : null,
    switches: ['loc-auto-tg','loc-bubble-tg','loc-chat-tg'].filter(function(id){ return !!document.getElementById(id); }).length,
    hasAsk: !!document.getElementById('loc-ask-btn')
  };
})()`);
await sleep(600);
check('B8 点入口仍然打开位置面板（放置与点击行为一字未动）', !!(opened && opened.open === true && opened.full === true), JSON.stringify(opened).slice(0, 120));
check('B9 位置面板里三枚换位开关俱在（副标题承诺的内容真实存在；#1436 续批起回到三枚＝感知一下是按钮不是开关）', !!(opened && opened.switches === 3), opened && ('开关=' + opened.switches + '/3'));

// ---- B10. 桌面寻踪页那颗同款 ----
await evalJs(`(function(){ var p=document.getElementById('loc-panel'); if(p) p.hidden=true; var b=document.getElementById('loc-back'); if(b) b.click(); })()`);
await sleep(400);
const desk = await evalJs(`(function(){
  if(!window.openCheckinPage) return 'no-api';
  document.querySelectorAll('.page').forEach(function(p){ p.hidden=true; });
  window.openCheckinPage();
  var pg=document.getElementById('page-checkin');
  var btn=document.getElementById('ck-loc-entry-desk');
  if(!pg || pg.hidden) return { page: false };
  if(!btn) return { page: true, btn: false };
  var cs=getComputedStyle(btn), t=btn.querySelector('.ck-loc-t');
  var br=btn.getBoundingClientRect();
  return {
    page: true, btn: true, display: cs.display, borderStyle: cs.borderTopStyle,
    h: Math.round(br.height), w: Math.round(br.width),
    text: (btn.textContent||'').trim(),
    hasIco: !!btn.querySelector('.ck-loc-ico'), hasArrow: !!btn.querySelector('.ck-loc-arrow'),
    titleSize: t ? parseFloat(getComputedStyle(t).fontSize) : 0
  };
})()`);
await sleep(500);
check('B10 桌面寻踪页入口同款（同样四件套＋flex 实线卡，不是只有聊天那处改了）',
  !!(desk && desk.btn && desk.hasIco && desk.hasArrow && desk.display === 'flex' && desk.borderStyle === 'solid' && desk.titleSize >= 14),
  JSON.stringify(desk || {}).slice(0, 140));
check('B11 桌面寻踪页入口含功能名与换位开关（文案与聊天那处一致）',
  !!(desk && desk.btn && desk.text.indexOf('位置感知') >= 0 && desk.text.indexOf('换位开关') >= 0), desk && desk.text.slice(0, 60));

// ---- B12. 暗色主题下入口仍成立（强调靠图标块与字号，不靠底色） ----
// 注意：不要在这里隐藏任何 .page——隐藏全部可见页会触发应用自带的「整屏空白自愈」，
// 且被隐藏页里的元素量出来必然是 0x0（本轮踩过）。B10 已把寻踪页开在屏幕上，直接量即可。
const dark = await evalJs(`(function(){
  document.documentElement.setAttribute('data-theme','dark');
  var btn=document.getElementById('ck-loc-entry-desk');
  var cs=getComputedStyle(btn), t=btn.querySelector('.ck-loc-t'), ico=btn.querySelector('.ck-loc-ico');
  var br=btn.getBoundingClientRect();
  var out={
    display: cs.display, h: Math.round(br.height), w: Math.round(br.width),
    titleColor: t ? getComputedStyle(t).color : '',
    icoBg: ico ? getComputedStyle(ico).backgroundImage.slice(0, 24) : '',
    icoW: ico ? Math.round(ico.getBoundingClientRect().width) : 0
  };
  document.documentElement.removeAttribute('data-theme');
  return out;
})()`);
await sleep(300);
const parseRgb = (s) => { const m = String(s || '').match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/); return m ? [+m[1], +m[2], +m[3]] : null; };
const lum = (c) => c ? (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 : null;
const tLum = lum(parseRgb(dark && dark.titleColor));
check('B12 暗色主题下入口仍可见且有对比（图标块渐变与体量在暗色下照常成立）',
  !!(dark && dark.display === 'flex' && dark.w > 0 && dark.h >= 50 && /gradient/.test(dark.icoBg || '') && dark.icoW >= 30 && tLum != null && tLum > 0.3),
  dark && ('display=' + dark.display + ' ' + dark.w + 'x' + dark.h + ' titleColor=' + dark.titleColor + ' icoW=' + dark.icoW));

// ---- B13. 小屏（360×640）：改后按钮变高，仍必须不滚动就能看到（半框 max-height 56%） ----
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 2, mobile: true });
await bootToChat();
const small = await evalJs(probe);
check('B13 小屏 360×640 下半框内入口仍在可视区、无需滚动（按钮变高后最容易被挤出屏的一档）',
  !!(small && small.btn && small.boxBottom != null && small.rect.bottom <= small.boxBottom + 1 && small.rect.h >= 50),
  small && ('按钮 ' + small.rect.w + 'x' + small.rect.h + ' btnBottom=' + small.rect.bottom + ' boxBottom=' + small.boxBottom + ' 需滚动=' + small.boxScroll + 'px'));

// ---- Z. 零未捕获异常 ----
const jsErrors = await evalJs(`(function(){ return (window.__jsErrors||[]).slice(-5).join(' | '); })()`);
check('Z1 全程零未捕获异常', events.length === 0 && !jsErrors, (events[0] || '') + ' | ' + (jsErrors || ''));

await server.close(); chrome.kill();
const failed = results.filter(r => !r.ok).length;
console.log('\n' + (results.length - failed) + '/' + results.length + (failed ? ' 失败 ' + failed : ' 全绿'));
process.exit(failed ? 1 : 0);
