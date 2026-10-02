// ===== 专项验证：漂流瓶（drift-bottle.js，聊天更多功能【互动】入口）=====
// 用法：node tools/verify-drift-bottle.mjs
// 注意：不依赖仓库根目录的构建产物——本脚本从当前 src/ 临时组装页面（镜像
// build.mjs 的拼接顺序，含 drift-bottle.css/js 注册），避免与并行会话的官方构建互相干扰。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => readFileSync(join(root, 'src', f), 'utf8');
let pass = 0, fail = 0;
function check(desc, ok, detail) {
  if (ok) { pass++; console.log('PASS  ' + desc + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + desc + (detail ? '  [' + detail + ']' : '')); }
}

// ---- A. 静态断言（源码级） ----
const tpl = read('template.html');
check('A1 更多面板有 more-drift 按钮且归【互动】分类', /id="more-drift"[^>]*data-mcat="chat"/.test(tpl));
check('A2 page-drift 页面锚点齐全（back/pick/put/open/list/stats/info）',
  ['id="page-drift"', 'id="drift-back"', 'id="drift-pick"', 'id="d-put"', 'id="d-open"', 'id="d-list"', 'id="d-stats"', 'id="drift-info-btn"'].every(s => tpl.includes(s)));
const bld = readFileSync(join(root, 'build.mjs'), 'utf8');
check('A3 build.mjs 已注册 drift-bottle.css 与 drift-bottle.js', bld.includes("'drift-bottle.css'") && bld.includes("'drift-bottle.js'"));
check('A4 tabs.js FULL_PAGES 含 page-drift', read('js/tabs.js').includes("'page-drift'"));
const dcd = read('js/default-cards-data.js');
check('A5 DEFAULT_CARD_DATA.drift 三组话术（TA的话/TA的回应/海风）', ['["TA的话"', '["TA的回应"', '["海风"'].every(s => dcd.includes(s)));
check('A6 字卡库注册「漂流瓶」tab', /data-type="drift">漂流瓶<\/button>/.test(read('template.html')));

// ---- 从当前 src 临时组装 index.html（顺序与 build.mjs 一致，不做压缩） ----
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css', 'drift-bottle.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'period.js', 'accounting.js', 'garden.js', 'room.js', 'drift-bottle.js', 'decision.js', 'group-decision.js', 'pong.js', 'snake-game.js', 'breakout.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'mobile-adapt.js'];
let html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const styles = cssFiles.map((f) => read(join('css', f))).join('\n');
const scripts = jsFiles.map((f) => {
  const code = read(join('js', f));
  return '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[JS] ' + f + '" + String(__e && __e.message || __e)); } })();';
}).join('\n');
html = html.replace('/*__STYLES__*/', styles);
html = html.replace('/*__SCRIPTS__*/', scripts);
html = html.split('__BUILD_INFO__').join('verify-drift');
html = html.split('__BUILD_TS__').join(String(Date.now()));
html = html.split('__APP_VERSION__').join('v3.16.x-verify');
const tmpHtml = join(tmpdir(), 'mochi-drift-verify-' + Date.now() + '.html');
writeFileSync(tmpHtml, html);

// ---- 静态服务：根路径回临时组装页，其余资源走仓库根 ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    if (req.url === '/' || req.url.split('?')[0] === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 150));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(tmpdir(), 'mochi-drift-' + Date.now()),
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
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  JS异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').split('\n')[0]); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function loadApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(700);
}
await loadApp();

// ---- B. 运行时验证 ----
// 从聊天页打开更多面板并进入漂流瓶（每次整页重载后都要重新走一遍）
async function gotoChatAndOpenDrift() {
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
  await sleep(300);
  await evalJs("(function(){var m=document.getElementById('chat-more-panel');if(m)m.hidden=false;var b=document.getElementById('more-drift');if(b)b.click();return true;})()");
  await sleep(500);
}
const jsErrCountExpr = '((window.__jsErrors&&window.__jsErrors.length)||0)';
check('B1 页面加载无 JS 异常', await evalJs(jsErrCountExpr) === 0,
  JSON.stringify(await evalJs('(window.__jsErrors||[])')));
check('B2 getLibPool 三组池同源可读（TA的话/TA的回应/海风）', await evalJs("(function(){try{return [window.getLibPool('drift','TA的话',[]).length>3, window.getLibPool('drift','TA的回应',[]).length>3, window.getLibPool('drift','海风',[]).length>5].every(Boolean);}catch(e){return false;}})()"));
check('B3 字卡库「其他互动功能字卡」页有「漂流瓶」tab chip', await evalJs("!!document.querySelector('#fc-tabs [data-type=\"drift\"]')"));

// 清空漂流瓶数据后重载，保证确定性
await evalJs("(function(){try{window.activeStore().remove('drift-data');}catch(e){}return true;})()");
await loadApp();

// 进入聊天页 → 打开更多面板 → 点漂流瓶
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
await sleep(400);
await evalJs("(function(){var m=document.getElementById('chat-more-panel');if(m)m.hidden=false;return true;})()");
await sleep(250);
await evalJs("(function(){var b=document.getElementById('more-drift');if(b)b.click();return true;})()");
await sleep(500);
check('B4 点 more-drift 进入 page-drift 且更多面板收起', await evalJs("!document.getElementById('page-drift').hidden && document.getElementById('chat-more-panel').hidden"));
check('B5 全屏页隐藏底部 tabbar', await evalJs("!!document.querySelector('.tabbar') && document.querySelector('.tabbar').hidden === true"));
check('B6 海面场景渲染（两层波浪+漂浮瓶）', await evalJs("(function(){var s=document.getElementById('drift-sea');return !!s && !!s.querySelector('.ds-wave.w1') && !!s.querySelector('.ds-wave.w2') && !!document.getElementById('drift-bob');})()"));

// 捡瓶（强制 TA 瓶）：首捡 +2 心意币、记录入 got、冷却生效
const w0 = await evalJs("(function(){try{return JSON.parse(window.activeStore().get('gift-wallet')||'{\"myBalance\":99999999}').myBalance;}catch(e){return 99999999;}})()");
await evalJs("window.__driftNext('ta')");
await evalJs("(function(){document.getElementById('drift-pick').click();return true;})()");
await sleep(1400);
check('B7 TA 瓶开瓶卡出现且带签名（—— TA昵称）', await evalJs("(function(){var o=document.getElementById('d-open');if(o.hidden)return false;var h=o.querySelector('.do-head');var sg=o.querySelector('.do-sig');var pn=window.activeStore().get('cs-lbl-partner')||window.activeStore().get('lbl-partner')||'TA';return !!h&&h.textContent.indexOf('💙')>=0&&!!sg&&sg.textContent.indexOf('—')>=0&&sg.textContent.indexOf(pn)>=0;})()"));
const w1 = await evalJs("(function(){try{return JSON.parse(window.activeStore().get('gift-wallet')).myBalance;}catch(e){return -1;}})()");
check('B8 每日首捡 +2 心意币入 gift-wallet 同一本账', w1 - w0 === 200, 'delta=' + (w1 - w0));
check('B9 记录入 got（kind=ta, from=ta）', await evalJs("(function(){var st=window.__driftState();return st.got.length===1&&st.got[0].kind==='ta'&&st.got[0].from==='ta'&&st.day.taGot===1&&st.day.picks===1;})()"));
check('B10 捡瓶后按钮进入冷却禁用态', await evalJs("document.getElementById('drift-pick').disabled === true"));

// 特殊瓶 +5（写存储后整页重载：模块 boot 时从存储重读 cdUntil/day，绕开 20s 冷却）
const w1b = w1;
await evalJs("(function(){var st=window.__driftState();st.cdUntil=0;st.day.picks=1;window.activeStore().set('drift-data',JSON.stringify(st));return true;})()");
await loadApp();
await gotoChatAndOpenDrift();
await evalJs("window.__driftNext('special')");
await evalJs("(function(){document.getElementById('drift-pick').click();return true;})()");
await sleep(1400);
const w2 = await evalJs("(function(){try{return JSON.parse(window.activeStore().get('gift-wallet')).myBalance;}catch(e){return -1;}})()");
check('B11 特殊瓶 +5 心意币（非首捡不叠加 +2）', w2 - w1b === 500, 'delta=' + (w2 - w1b));

// 收藏切换
await evalJs("(function(){var f=document.getElementById('d-fav');if(f)f.click();return true;})()");
check('B12 开瓶卡上可收藏（♥ 已收藏）', await evalJs("(function(){var f=document.getElementById('d-fav');return !!f&&f.textContent.indexOf('♥')>=0;})()"));
await evalJs("(function(){document.getElementById('d-ok').click();return true;})()");
check('B13 收好按钮收起开瓶卡', await evalJs("document.getElementById('d-open').hidden === true"));

// 放一个瓶子（textarea 弹窗）
const mineBefore = await evalJs('window.__driftState().mine.length');
await evalJs("(function(){document.getElementById('d-put').click();return true;})()");
await sleep(400);
await evalJs("(function(){var ta=document.getElementById('modal-textarea');ta.value='今天也要好好陪我。';return !ta.hidden;})()");
await evalJs("(function(){document.getElementById('modal-ok').click();return true;})()");
await sleep(400);
const stAfterPut = await evalJs('window.__driftState()');
check('B14 我也放一个 → mine +1 且文本正确', stAfterPut && stAfterPut.mine.length === mineBefore + 1 && stAfterPut.mine[stAfterPut.mine.length - 1].text === '今天也要好好陪我。');
check('B15 放瓶即排期漂回（backAt 未来）与回应（willReply 时 replyAt 未来）', stAfterPut && stAfterPut.mine[stAfterPut.mine.length - 1].backAt > Date.now());

// 统计行与列表 tab
check('B16 统计行渲染计数', await evalJs("(function(){var t=document.getElementById('d-stats').textContent;return /我放入 1/.test(t)&&/收藏/.test(t);})()"));
await evalJs("(function(){document.querySelectorAll('#page-drift .d-tab')[1].click();return true;})()");
await sleep(250);
check('B17 捡到的列表渲染记录行', await evalJs("document.querySelectorAll('#d-list .dl-row').length >= 2"));

// 漂回来的瓶子（种一条 pendingBack 记录 → 整页重载让模块重读 → 下一瓶必是它）
await evalJs("(function(){var now=Date.now();window.activeStore().set('drift-data',JSON.stringify({mine:[{id:'tb1',text:'今天也要好好陪我。',ts:now-3*86400000,fav:0,backed:true,pendingBack:true,gone:false}],got:[],day:{date:'',picks:0,coin:0,taGot:0},lastVisit:now-50*3600000,cdUntil:0}));return true;})()");
await loadApp();
await gotoChatAndOpenDrift();
await evalJs("(function(){document.getElementById('drift-pick').click();return true;})()");
await sleep(1400);
check('B18 熟悉的瓶子优先漂回：显示原句+「这是你以前写下的话」', await evalJs("(function(){var o=document.getElementById('d-open');if(o.hidden)return false;var h=o.querySelector('.do-head');var tx=o.querySelector('.do-txt');var sg=o.querySelector('.do-sig');return !!h&&h.textContent.indexOf('熟悉')>=0&&tx.textContent==='今天也要好好陪我。'&&!!sg&&sg.textContent.indexOf('以前写下')>=0;})()"));
check('B19 漂回消耗 pendingBack 并落 got(kind=back)', await evalJs("(function(){var st=window.__driftState();return st.got.some(function(g){return g.kind==='back';})&&!st.mine.some(function(m){return m.pendingBack;});})()"));
await evalJs("(function(){document.getElementById('d-ok').click();return true;})()");

// 双人漂流瓶：TA 的回应到点生成 + 聊天一次性轻提示（stub chatAddIn 捕获；种数据后整页重载）
await evalJs("(function(){var now=Date.now();var st=window.__driftState();st.cdUntil=0;st.mine.push({id:'tr1',text:'如果你能看到，就来找我。',ts:now-86400000,fav:0,willReply:true,replyAt:now-1000,noticed:false});window.activeStore().set('drift-data',JSON.stringify(st));return true;})()");
await loadApp();
await evalJs("window.__captured=[];window.chatAddIn=function(t,o){window.__captured.push([t,o&&o.tag]);};true");
await gotoChatAndOpenDrift();
await sleep(400);
check('B20 回应到点生成 got(kind=reply, 来自TA) 且 mine.replied 落位', await evalJs("(function(){var st=window.__driftState();var r=st.got.filter(function(g){return g.kind==='reply';});var m=st.mine.filter(function(x){return x.id==='tr1';})[0];return r.length===1&&r[0].from==='ta'&&r[0].text.length>0&&m&&typeof m.replied==='number';})()"));
check('B21 聊天轻提示恰好一次且带「漂流瓶」标签', await evalJs("(function(){var c=window.__captured||[];return c.length===1&&c[0][1]==='漂流瓶'&&c[0][0].indexOf('漂回来')>=0;})()", JSON.stringify(await evalJs('window.__captured'))));
// B22 提示只发一次：关页（落盘 noticed）→ 重开 → captured 不增长
await evalJs("(function(){document.getElementById('drift-back').click();return true;})()");
await sleep(300);
await evalJs("(function(){var m=document.getElementById('chat-more-panel');if(m)m.hidden=false;document.getElementById('more-drift').click();return true;})()");
await sleep(500);
check('B22 提示只发一次（再次开关页面不重复）', await evalJs('(window.__captured||[]).length === 1'));

// 返回键回聊天
await evalJs("(function(){document.getElementById('drift-back').click();return true;})()");
await sleep(350);
check('B23 从聊天进入返回回聊天页', await evalJs("!document.getElementById('page-chat').hidden && document.getElementById('page-drift').hidden"));

// 数据按桌面命名空间隔离（键名含 cid）
check('B24 存储键走联系人桌面命名空间', await evalJs("(function(){try{var cid=window.__activeCid||'default';return localStorage.getItem('xy-home-v2:'+cid+':drift-data')!==null;}catch(e){return false;}})()"));

// ---- C. TA 瓶优先抽聊天历史字卡（含一条混合气泡多张字卡逐段拆） ----
// 种一份可控的聊天记录：可收的纯文本 + parts 混合气泡（两张 text 字卡打包一条）
// + 各类必须被排除的形态（语音|||/图片/红包/系统/撤回/超长/我方消息）
const SEED_MSGS = [
  { side: 'out', text: '我自己说的话不算候选', ts: 1000 },
  { side: 'in', text: '过来一点。', ts: 1001 },
  { side: 'in', type: 'voice', text: 'voice.amr|||data:audio|||3', ts: 1002 },
  { side: 'in', type: 'sticker', text: 'data:image/png;base64,xxx', ts: 1003 },
  { side: 'in', text: '看看这张', img: 'data:image/png;base64,yyy', ts: 1004 },
  { side: 'in', text: '红包收好了', rpAmount: 100, ts: 1005 },
  { side: 'in', text: '【系统】这是一条提示', special: 'poke', ts: 1006 },
  { side: 'in', text: '这条被撤回了不该出现', retracted: true, ts: 1007 },
  { side: 'in', text: '超出上限的一百字以上长文本'.padEnd(120, '啊'), ts: 1008 },
  { side: 'in', askQuestion: '吃饭了吗？', text: '问问组件不进瓶', ts: 1009 },
  // 混合气泡：一条 rec 打包两张字卡 + 两张贴纸——两张字卡各自独立成候选
  { side: 'in', type: 'text', text: '别急，慢慢来。', ts: 1010,
    parts: [{ k: 'text', v: '别急，' }, { k: 'img', v: 'data:image/gif;base64,z', sub: 'sticker' }, { k: 'text', v: '慢慢来。' }, { k: 'img', v: 'data:image/png;base64,w', sub: 'image' }] },
  { side: 'in', text: '我在。今天也陪着你。', ts: 1011 }
];
async function seedChatAndDrift(msgs) {
  // 注意：chat.js 会把聊天记录镜像进 IndexedDB，启动时 idbRestore 会用 IDB 副本回填 LS——
  // 种子必须 LS+IDB 双写，否则下一轮 boot 被 IDB 旧值复活（WORKLOG 已知坑）
  const expr = "(function(){var cid=window.__activeCid||'default';var k='xy-home-v2:'+cid+':chat-msgs';var v=" + JSON.stringify(JSON.stringify(msgs)) + ";localStorage.setItem(k,v);try{if(window.idbSet)window.idbSet(k,v);}catch(e){}window.activeStore().set('drift-data',JSON.stringify({mine:[],got:[],histSeen:[],day:{date:'',picks:0,coin:0,taGot:0},lastVisit:Date.now()-72*3600000,cdUntil:0}));return true;})()";
  await evalJs(expr);
  await sleep(300);
  await loadApp();
  await gotoChatAndOpenDrift();
}
async function pickTa() {
  await evalJs("window.__driftNext('ta')");
  await evalJs("(function(){document.getElementById('drift-pick').click();return true;})()");
  await sleep(1350);
}

// B26 历史优先：TA 瓶内容必来自种入的可收集合（若回退字卡库会拿到「想你了。就说这一句。」等库句 → FAIL）
await seedChatAndDrift(SEED_MSGS);
await pickTa();
check('B26 TA瓶优先取聊天历史字卡（过滤语音/图片/红包/系统/撤回/超长/我方）',
  await evalJs("(function(){var t=window.__driftState().got[0].text;return ['过来一点。','我在。今天也陪着你。','别急，','慢慢来。'].indexOf(t)>=0;})()"),
  JSON.stringify(await evalJs('window.__driftState().got[0].text')));

// B27 多张字卡逐段拆：只留 parts 混合气泡可收 → 每次必是其中一张，绝不合并整条、绝不落空、绝不用库句
const PARTS_ONLY = [
  { side: 'in', type: 'voice', text: 'v.amr|||x|||1', ts: 1 },
  { side: 'in', text: '长文本占位'.padEnd(110, '嗯'), ts: 2 },
  { side: 'in', type: 'text', text: '', ts: 3,
    parts: [{ k: 'img', v: 'data:image/png;base64,a', sub: 'sticker' }, { k: 'text', v: '海边的风' }, { k: 'text', v: '把话捎给你' }] }
];
let partsOk = true;
for (let i = 0; i < 3; i++) {
  await seedChatAndDrift(PARTS_ONLY);
  await pickTa();
  const t = await evalJs('window.__driftState().got[0].text');
  if (!(t === '海边的风' || t === '把话捎给你')) { partsOk = false; console.log('  第' + (i + 1) + '捡异常结果: ' + JSON.stringify(t)); break; }
  await evalJs("(function(){document.getElementById('d-ok').click();return true;})()");
}
check('B27 一条消息多张字卡逐段独立漂出（不合并/不落空/不串到表情贴图）', partsOk);

// B28 无历史时回退字卡库【漂流瓶·TA的话】：聊天记录置空（LS+IDB 双清）再捡，内容必须是库句而非空白
// （库句可能带 {n} 占位符——比对前先按 TA 名归一）
await evalJs("(function(){var cid=window.__activeCid||'default';var k='xy-home-v2:'+cid+':chat-msgs';var v='[]';localStorage.setItem(k,v);try{if(window.idbSet)window.idbSet(k,v);}catch(e){}window.activeStore().set('drift-data',JSON.stringify({mine:[],got:[],histSeen:[],day:{date:'',picks:0,coin:0,taGot:0},lastVisit:0,cdUntil:0}));return true;})()");
await sleep(300);
await loadApp();
await gotoChatAndOpenDrift();
await pickTa();
check('B28 聊天记录为空时回退字卡库「TA的话」分组',
  await evalJs("(function(){var pn=window.activeStore().get('cs-lbl-partner')||window.activeStore().get('lbl-partner')||'TA';var lib=(window.DEFAULT_CARD_DATA.drift||[]).filter(function(g){return g[0]==='TA的话';})[0];if(!lib)return false;var t=window.__driftState().got[0].text;return lib[1].map(function(s){return String(s).replace(/\\{n\\}/g,pn);}).indexOf(t)>=0;})()"),
  JSON.stringify(await evalJs('window.__driftState().got[0].text')));
await evalJs("(function(){document.getElementById('d-ok').click();return true;})()");

// ---- D. 概率表设计验证（钉死 Math.random 做确定性断言，不做统计抽样）----
// 钉 random=0.92 的落点推导（total=100 时 special 区间终点=100-taW）：
//   ta=5→92∈[85,95)特殊；ta=7→92∈[83,93)特殊；ta=9→92∈[91,100)TA；dry保底段更靠前必TA
function todayOutMsgs(n) {
  const t = Date.now();
  return Array.from({ length: n }, (_, i) => ({ side: 'out', text: '我今天说的话' + i, ts: t }));
}
// dry/lastVisit 要进 rollKind 的内存 d，必须经 boot 重读；聊天记录则相反——boot 后会被
// idbRestore 副本复活+后台防抖存档覆写，所以「写聊天LS + 钉随机 + peek」合成单条原子表达式
async function seedDry(dry) {
  await evalJs("(function(){window.activeStore().set('drift-data',JSON.stringify({mine:[],got:[],histSeen:[],dry:" + dry + ",day:{date:'',picks:0,coin:0,taGot:0},lastVisit:Date.now()-3600000,cdUntil:0}));return true;})()");
  await sleep(200);
  await loadApp();
}
async function peekPinned(msgs) {
  return await evalJs("(function(){var cid=window.__activeCid||'default';localStorage.setItem('xy-home-v2:'+cid+':chat-msgs'," + JSON.stringify(JSON.stringify(msgs)) + ");var o=Math.random;Math.random=function(){return 0.92;};var k=window.__driftPeek();Math.random=o;return k;})()");
}
await seedDry(0);
const p1 = await peekPinned([]);                                    // 无互动、dry=0
await seedDry(11);
const p2 = await peekPinned([]);                                    // 保底临界前
await seedDry(12);
const p3 = await peekPinned([]);                                    // 软保底启动
await seedDry(20);
const p4 = await peekPinned([]);                                    // 软保底封顶段
await seedDry(0);
const p5 = await peekPinned(todayOutMsgs(1));                       // 今天发过 1 条（ta=7）
const p6 = await peekPinned(todayOutMsgs(6));                       // 聊得比较多（ta=9）
check('D1 基础概率：无互动无保底时 0.9 落点=特殊瓶（ta权重仍为5）', p1 === 'special', p1);
check('D2 软保底边界：连续11捡未出TA仍是普通档，第12捡起加权翻出TA', p2 === 'special' && p3 === 'ta' && p4 === 'ta', [p2, p3, p4].join(','));
check('D3 梯度互动：今日1条消息(ta=7)不够翻越，≥6条(ta=9)翻越', p5 === 'special' && p6 === 'ta', [p5, p6].join(','));

// 待回应堆叠上限：海上同时最多 2 个未回应瓶子，超出的不再排期回应
async function putWithPending(pendingN) {
  await evalJs("(function(){var now=Date.now();var pend=[];for(var i=0;i<" + pendingN + ";i++)pend.push({id:'pp'+i,text:'待回应'+i,ts:now,fav:0,willReply:true,replyAt:now+86400000});window.activeStore().set('drift-data',JSON.stringify({mine:pend,got:[],histSeen:[],dry:0,day:{date:'',picks:0,coin:0,taGot:0},lastVisit:Date.now(),cdUntil:0}));return true;})()");
  await loadApp();
  await gotoChatAndOpenDrift();
  await evalJs("window.__origRnd=Math.random;Math.random=function(){return 0.001;};true"); // 钉低：若无上限必排期回应
  await evalJs("(function(){document.getElementById('d-put').click();return true;})()");
  await sleep(400);
  await evalJs("(function(){var ta=document.getElementById('modal-textarea');ta.value='测试堆叠的瓶子';return true;})()");
  await evalJs("(function(){document.getElementById('modal-ok').click();return true;})()");
  await sleep(400);
  const st = await evalJs('window.__driftState()');
  await evalJs("if(window.__origRnd)Math.random=window.__origRnd;true");
  return st ? st.mine[st.mine.length - 1] : null;
}
const putCapped = await putWithPending(2);
const putFree = await putWithPending(1);
check('D4 回应堆叠上限：已有2个未回应时新瓶不排期；只有1个时正常排期',
  putCapped && putCapped.willReply === false && putFree && putFree.willReply === true,
  'capped=' + (putCapped && putCapped.willReply) + ' free=' + (putFree && putFree.willReply));

check('B34 全程无新增 JS 异常', await evalJs('((window.__jsErrors&&window.__jsErrors.length)||0)') === 0, JSON.stringify(await evalJs('(window.__jsErrors||[])')));

console.log('\n===== 漂流瓶专项验证：' + pass + ' 通过 / ' + fail + ' 失败 =====');
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
