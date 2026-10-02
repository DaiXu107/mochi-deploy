// ===== 回归脚本：聊天设置「隐藏联系人的表情包」开关 =====
// 用法：node build.mjs && node tools/verify-hide-ta-sticker.mjs
// 背景（用户需求）：
//   聊天设置新增「隐藏联系人的表情包」开关（默认关闭，全局生效，含小字说明
//   「隐藏后只显示我的表情包」）。开启后聊天表情包面板（公用/TA 的/我的 三 tab）
//   与朋友圈评论表情面板（TA 的/我的 双 tab）都只显示「我的表情包」。
// 实现：
//   - 开关存根命名空间全局键 hide-ta-sticker（chat-settings.js 写入并广播
//     hide-ta-sticker-changed）；chat.js renderEmojiPanel 收口：隐藏非 mine tab、
//     强制 emojiMode='mine'；feed.js 每次打开评论面板按开关决定默认 tab 并隐藏 TA tab；
//   - CSS .emoji-tab[hidden]{display:none!important} 显式兜底（.emoji-tools[hidden] 先例）。
// 验证（真实 UI 点击路径 + 种子数据：专属 sticker 分组 2 张 / 公用 1 张 / 我的 3 张 / 一条动态）：
//   A 默认关：聊天面板 3 tab 可见、默认选中 TA 的、分组栏出现 TA 表情2；
//   B 开启后：设置行小字说明存在；勾选写全局键+toast；聊天面板只剩「我的」tab 可见、
//     工具行出现、点分组出 3 张表情；写信/群聊共用的插入入口同口径（同一 render 收口）；
//   C 再关回：3 tab 恢复可见；
//   D 朋友圈：开启时评论面板 TA tab 隐藏、默认选中我的、分组栏只有我的分组；
//     关闭时恢复 TA tab 可见且为默认选中。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9740 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-hts-' + Date.now()),
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
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const waitReady = async () => {
  for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) return; await sleep(200); }
};
const click = (sel) => evalJs(`(function(){ var el=document.querySelector(${JSON.stringify(sel)}); if(el){el.click(); return true;} return false; })()`);

// toast 收集器（2s 即逝，轮询兜住）
const INIT_SCRIPT = `
window.__toasts = [];
setInterval(function () {
  var t = document.getElementById('cc-toast');
  if (t && String(t.className).indexOf('show') >= 0 && t.textContent && window.__toasts.indexOf(t.textContent) < 0) window.__toasts.push(t.textContent);
}, 100);
`;

// 1x1 红色 png（dataURL，过 chatcard isMediaImg 的 data:image 前缀判断）
const TINY = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('PASS  ' + name + (info ? '  [' + info + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (info ? '  [' + info + ']' : '')); }
}

async function navigate(query) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' + (query || '') });
  for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(600);
}

// 面板状态快照：聊天 #emoji-panel / 朋友圈评论面板通用
const CHAT_SNAP = `(function(){
  var p = document.getElementById('emoji-panel');
  if (!p || p.hidden) return { open: false };
  var tabs = [].slice.call(p.querySelectorAll('.emoji-tab'));
  var vis = tabs.filter(function(t){ return !t.hidden && t.offsetWidth > 0; });
  var sel = p.querySelector('.emoji-tab.sel');
  var tools = document.getElementById('emoji-tools');
  var chips = [].slice.call(p.querySelectorAll('#emoji-groups .emoji-g-chip')).map(function(c){ return c.textContent; });
  var grid = p.querySelectorAll('#emoji-list .emoji-item').length;
  return { open: true,
    visTabs: vis.map(function(t){ return t.dataset.etab; }),
    selTab: sel ? sel.dataset.etab : null,
    taHidden: (p.querySelector('[data-etab="ta"]')||{}).hidden === true,
    pubHidden: (p.querySelector('[data-etab="public"]')||{}).hidden === true,
    toolsShown: !!tools && !tools.hidden,
    chips: chips, gridItems: grid };
})()`;
const FEED_SNAP = `(function(){
  var host = document.getElementById('feed-comment-panel');
  var p = host ? host.querySelector('.poke-card.emoji-card') : null;
  if (!host || host.hidden || !p || p.hidden) return { open: false };
  var tabs = [].slice.call(p.querySelectorAll('[data-cs-tab]'));
  var vis = tabs.filter(function(t){ return !t.hidden && t.offsetWidth > 0; });
  var sel = p.querySelector('[data-cs-tab].sel');
  var chips = [].slice.call(p.querySelectorAll('#com-sticker-groups .emoji-g-chip')).map(function(c){ return c.textContent; });
  return { open: true,
    visTabs: vis.map(function(t){ return t.getAttribute('data-cs-tab'); }),
    selTab: sel ? sel.getAttribute('data-cs-tab') : null,
    taHidden: (p.querySelector('[data-cs-tab="ta"]')||{}).hidden === true,
    chips: chips };
})()`;

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: INIT_SCRIPT });

  // ================= 预置数据：专属/公用/我的表情包 + 一条动态（重载生效） =================
  await navigate('');
  const seeded = await evalJs(`(function(){
    try {
      var tiny = ${JSON.stringify(TINY)};
      var own = { text:[], kaomoji:[], emoji:[], image:[], poke:[], voice:[], sticker:[['TA表情',[tiny,tiny]]] };
      var pub = { text:[], kaomoji:[], emoji:[], image:[], poke:[], voice:[], sticker:[['公用表情',[tiny]]] };
      window.activeStore().set('cc-groups', JSON.stringify(own));
      window.xyStore('xy-home-v2').set('cc-groups-public', JSON.stringify(pub));
      // 预置字卡归属迁移标记：单联系人新档首次启动的迁移（chatcard.js）会把 default
      // 桌面专属键异步搬进公用键并清空原键，导致种子丢失——先写标记让它短路
      window.xyStore('xy-home-v2').set('cc-scope-migrated', '1');
      window.xyStore('xy-home-v2').set('my-emoji-groups', JSON.stringify([['我的分组',[tiny,tiny,tiny]]]));
      // 朋友圈动态存根命名空间（feed.js：store = xyStore('xy-home-v2')，全局互通），不走桌面键
      window.xyStore('xy-home-v2').set('feed-posts', JSON.stringify([{ id:'hts-p1', ts: Date.now(), role:'me', content:'回归测试动态' }]));
      window.activeStore().remove('hide-ta-sticker');
      return 'OK';
    } catch (e) { return 'ERR:' + e.message; }
  })()`);
  check('预置表情包/动态种子写入成功', seeded === 'OK', String(seeded));
  await navigate('');

  // ================= A 组：默认关闭——聊天面板三分区原样 =================
  check('A 聊天页可打开', await click('.app[data-app="chat"]'));
  await sleep(500);
  check('A 表情按钮可打开面板', await click('#chat-emoji-btn'));
  await sleep(300);
  let a = await evalJs(CHAT_SNAP);
  check('A 面板打开且 3 个 tab 都可见（公用/TA/我的）', !!(a && a.open && a.visTabs.length === 3), JSON.stringify(a && a.visTabs));
  check('A 默认选中「TA 的表情包」', !!(a && a.selTab === 'ta'), 'sel=' + (a && a.selTab));
  let a2 = await evalJs(CHAT_SNAP);
  check('A 分组栏出现 TA 表情分组（TA表情2）', !!(a2 && a2.chips.join(',').indexOf('TA表情2') >= 0), JSON.stringify(a2 && a2.chips));
  // v3.12.x：部分安卓浏览器给聚焦按钮画虚线框——三个 tab 的 outline 必须统一为 none
  const outlines = await evalJs(`JSON.stringify([].slice.call(document.querySelectorAll('#emoji-panel .emoji-tab')).map(function(t){ return getComputedStyle(t).outlineStyle; }))`);
  check('A 三个 tab 聚焦外框统一为 none（防虚线框）', outlines === JSON.stringify(['none','none','none']), String(outlines));

  // 设置页开关行与小字说明
  const rowInfo = await evalJs(`(function(){
    var cb = document.getElementById('cs-hide-ta-sticker');
    var sub = document.querySelector('#cs-hide-ta-sticker-row .sub');
    var t = sub ? sub.textContent : '';
    return { has: !!cb, checked: cb ? cb.checked : null, subLen: t.length,
      subOk: t.indexOf('只显示') >= 0 && t.indexOf('我的表情包') >= 0 && t.indexOf('朋友圈') >= 0 };
  })()`);
  check('A 设置页存在「隐藏联系人的表情包」开关且默认关', !!(rowInfo && rowInfo.has && rowInfo.checked === false), JSON.stringify(rowInfo));
  check('A 开关带小字说明（含 只显示/我的表情包/朋友圈）', !!(rowInfo && rowInfo.subOk), 'subLen=' + (rowInfo && rowInfo.subLen));

  // ================= B 组：开启开关——聊天面板只剩我的表情包 =================
  check('B 勾选开关成功', await click('#cs-hide-ta-sticker'));
  await sleep(300);
  const keyOn = await evalJs(`window.xyStore('xy-home-v2').get('hide-ta-sticker')`);
  check('B 开关写入全局键 hide-ta-sticker=1', keyOn === '1', 'key=' + keyOn);
  const toasts1 = await evalJs('window.__toasts.join("|")');
  check('B 切换有 toast 提示（说明只显示我的表情包）', !!(toasts1 && toasts1.indexOf('我的表情包') >= 0), String(toasts1).slice(0, 80));

  // 面板开着时收 change 事件应已即时重渲染；关掉再开走完整路径再验一次
  await click('#emoji-close');
  await sleep(150);
  await click('#chat-emoji-btn');
  await sleep(300);
  let b = await evalJs(CHAT_SNAP);
  check('B 只剩「我的表情包」一个 tab 可见', !!(b && b.open && b.visTabs.join(',') === 'mine'), JSON.stringify(b && b.visTabs));
  check('B TA 的/公用 tab 均 hidden', !!(b && b.taHidden && b.pubHidden));
  check('B 自动选中我的表情包', !!(b && b.selTab === 'mine'), 'sel=' + (b && b.selTab));
  check('B 我的模式工具行可见（仅我的模式有工具行）', !!(b && b.toolsShown));
  check('B 分组栏只剩我的分组（我的分组3）', !!(b && b.chips.join(',').indexOf('我的分组3') >= 0 && b.chips.length === 1), JSON.stringify(b && b.chips));
  // 点分组 → 出 3 张表情
  await evalJs(`(function(){ var c=document.querySelector('#emoji-groups .emoji-g-chip'); if(c)c.click(); })()`);
  await sleep(200);
  let b2 = await evalJs(CHAT_SNAP);
  check('B 点分组后网格渲染 3 张我的表情', !!(b2 && b2.gridItems === 3), 'grid=' + (b2 && b2.gridItems));
  // 关闭开关前先关面板（避免影响下一组）
  await click('#emoji-close');

  // ================= C 组：关回——三分区恢复 =================
  check('C 取消勾选成功', await click('#cs-hide-ta-sticker'));
  await sleep(300);
  const keyOff = await evalJs(`window.xyStore('xy-home-v2').get('hide-ta-sticker')`);
  check('C 全局键复位为 0', keyOff === '0', 'key=' + keyOff);
  await click('#chat-emoji-btn');
  await sleep(300);
  let c = await evalJs(CHAT_SNAP);
  check('C 3 个 tab 恢复可见', !!(c && c.open && c.visTabs.length === 3), JSON.stringify(c && c.visTabs));
  check('C TA 的/公用 tab 不再 hidden', !!(c && !c.taHidden && !c.pubHidden));
  await click('#emoji-close');
  await sleep(150);

  // ================= D 组：朋友圈评论表情面板同口径 =================
  // 先在关闭态验证默认行为，再开启验证隐藏。
  // 动态改为进页前当次会话现种：跨会话预置的键要等 idbRestore 异步回填，
  // 首次 render 可能读到空（上面轮询已证实），现种走 memoryCache 即时可见
  const seedNow = await evalJs(`(function(){ try {
    window.xyStore('xy-home-v2').set('feed-posts', JSON.stringify([{ id:'hts-p2', ts: Date.now(), role:'me', content:'回归测试动态' }]));
    return true; } catch(e){ return false; } })()`);
  check('D 当会话种子动态写入', !!seedNow);
  check('D 朋友圈页可打开', await click('.app[data-app="feed"]'));
  await sleep(700);
  // 动态列表异步渲染：轮询等评论按钮出现（最多 6s）再点
  let dBtn = null;
  for (let i = 0; i < 30; i++) {
    dBtn = await evalJs(`(function(){ var b=document.querySelector('.feed-act[data-comment]'); if(b){b.click(); return true;} return false; })()`);
    if (dBtn) break;
    await sleep(200);
  }
  const dDiag = await evalJs(`JSON.stringify({
    postsRaw: (function(){ try { return (window.activeStore().get('feed-posts')||'null').slice(0,80); } catch(e){ return 'ERR:'+e.message; } })(),
    listLen: (document.getElementById('feed-list')||{innerHTML:''}).innerHTML.length,
    acts: document.querySelectorAll('.feed-act').length,
    feedHidden: (document.getElementById('page-feed')||{}).hidden,
    emptyTip: (document.querySelector('#feed-list .ta-empty')||{}).textContent || null
  })`);
  check('D 动态评论按钮渲染并可点', !!dBtn, dDiag);
  check('D 评论表情按钮可点（关闭态开面板）', await click('#feed-comment-sticker'));
  await sleep(300);
  let d0 = await evalJs(FEED_SNAP);
  check('D 关闭态：TA 的/我的 双 tab 可见且默认选中 TA 的', !!(d0 && d0.open && d0.visTabs.join(',') === 'ta,mine' && d0.selTab === 'ta' && !d0.taHidden), JSON.stringify(d0));
  // 关闭面板 → 开开关 → 重开
  await click('#feed-comment-panel [data-cs]');
  await sleep(150);
  check('D 勾选开关成功', await click('#cs-hide-ta-sticker'));
  await sleep(250);
  check('D 重开评论表情面板', await click('#feed-comment-sticker'));
  await sleep(300);
  let d1 = await evalJs(FEED_SNAP);
  check('D 开启态：只剩「我的表情包」tab 且自动选中', !!(d1 && d1.open && d1.visTabs.join(',') === 'mine' && d1.selTab === 'mine'), JSON.stringify(d1));
  check('D 开启态：TA tab hidden', !!(d1 && d1.taHidden));
  check('D 开启态：分组栏只有我的分组（我的分组3）', !!(d1 && d1.chips.join(',') === '我的分组3'), JSON.stringify(d1 && d1.chips));

  console.log('\n==== 结果：' + (pass + fail) + ' 项检查，' + fail + ' 项失败 ====');
  if (fail) process.exitCode = 1;
  else console.log('全部通过');
} catch (e) {
  console.error('脚本异常:', e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
  server.close();
}
process.exit(process.exitCode || 0);
