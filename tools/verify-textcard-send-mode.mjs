// ===== 回归脚本：颜文字/emoji 点卡片的两种模式（#691，用户直派） =====
// 用法：node build.mjs && node tools/verify-textcard-send-mode.mjs
// 需求原话：「表情包里的颜文字和 emoji 需要可以点击后输入聊天输入栏，然后我自己选择发；
//   或者手动打开『直接点击颜文字和 emoji 就发送』的功能。在聊天设置里切换模式，需要小字写清楚。」
// 口径：
//   ① 默认（键缺省）＝**填入输入栏**：点一下只把卡片文字追加进聊天/群聊输入栏，不发消息、
//      面板不关（可连点多张），发不发由用户点「发送」决定；
//   ② 打开设置里的「颜文字/emoji 点击直接发送」后＝点击即发出（含引用/日志链路，走原 sendTextCard）；
//   ③ 模式在**点击时现读**全局根键 xy-home-v2:chat-textcard-direct（'1'=直接发送），
//      改完设置无需重开面板；
//   ④ 写信/回信（以及群聊复用面板的 emojiInsertCb 插入回调）优先级更高，行为不变；
//   ⑤ 只对【颜文字】【emoji】两个文字分类生效，**表情包图片不受影响**（仍直接发送）。
// 实现面：chat.js textCardDirectMode/insertTextToChatInput + 文字卡点击三分支；
//   chat-settings.js 注入开关行 cs-chat-textcard-direct-row（小字 sub 说明）；
//   group-chat.js gcInsertTextToInput + gc 面板回调；contacts.js EXCLUDE 全局根键。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9860 + Math.floor(Math.random() * 100));
const userDataDir = join(process.env.TEMP || '/tmp', 'mochi-tcmode-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + userDataDir,
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
const click = (sel) => evalJs(`(function(){ var el=document.querySelector(${JSON.stringify(sel)}); if(el){el.click(); return true;} return false; })()`);

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
const getKey = () => evalJs(`(function(){ try { var v = window.xyStore('xy-home-v2').get('chat-textcard-direct'); return (v===null||v===undefined)?'__none__':String(v); } catch(e){ return 'ERR:'+e.message; } })()`);
const setKey = (v) => evalJs(`(function(){ try { window.xyStore('xy-home-v2').set('chat-textcard-direct', ${JSON.stringify(String(v))}); return true; } catch(e){ return false; } })()`);
const rmKey = () => evalJs(`(function(){ try { window.xyStore('xy-home-v2').remove('chat-textcard-direct'); return true; } catch(e){ return false; } })()`);

// 打开面板并切到颜文字分类；分组为空时逐个点分组 chip 找有卡的分组（不依赖具体种子分组名）
async function openPanelToKaomoji(btnSel) {
  await click(btnSel);
  await sleep(350);
  await click('.emoji-cats .emoji-cat-chip[data-ecat="kaomoji"]');
  await sleep(250);
  for (let i = 0; i < 8; i++) {
    if (await evalJs(`!!document.querySelector('#emoji-list .emoji-text-item')`)) return true;
    const clicked = await evalJs(`(function(){ var cs=document.querySelectorAll('#emoji-groups .emoji-g-chip'); if(!cs.length) return false; cs[0].click(); return true; })()`);
    if (!clicked) return false;
    await sleep(250);
  }
  return !!(await evalJs(`!!document.querySelector('#emoji-list .emoji-text-item')`));
}
// 取第 n 张卡片的文字（n=0 首张）
const itemText = (n) => evalJs(`(function(){ var d=document.querySelectorAll('#emoji-list .emoji-text-item')[${n}]; return d ? d.textContent : null; })()`);
const clickItem = (n) => evalJs(`(function(){ var d=document.querySelectorAll('#emoji-list .emoji-text-item')[${n}]; if(d){ d.click(); return true; } return false; })()`);
// 已发消息条数（chat-body / gc-body 同构 .msg-out）——判定「是否真的发出了一条新消息」。
// 不用 body 文本包含：同一张卡在前面的段落已经发过一次时，包含判定恒为真＝没有判别力（实测踩过）。
const outCount = (scope) => evalJs(`document.querySelectorAll('#${scope} .msg-out').length`);

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  // ================= 预置数据：专属字卡库带颜文字分组 =================
  await navigate('');
  const seeded = await evalJs(`(function(){
    try {
      var own = { text:[], image:[], poke:[], voice:[], sticker:[],
        kaomoji:[['开心',['(＝^ω^＝)','(￣▽￣)~*']]], emoji:[['常用',['😂','🥰']]] };
      window.activeStore().set('cc-groups', JSON.stringify(own));
      window.xyStore('xy-home-v2').set('cc-scope-migrated', '1');
      window.xyStore('xy-home-v2').remove('chat-textcard-direct');
      window.xyStore('xy-home-v2').remove('hide-tab-kaomoji');
      window.xyStore('xy-home-v2').remove('hide-tab-emoji');
      return 'OK';
    } catch (e) { return 'ERR:' + e.message; }
  })()`);
  check('预置字卡库种子写入成功', seeded === 'OK', String(seeded));
  await navigate('');

  // ================= A：聊天页默认模式＝填入输入栏 =================
  check('A 聊天页可打开', await click('.app[data-app="chat"]'));
  await sleep(500);
  check('A 面板打开并切到颜文字（有卡片）', await openPanelToKaomoji('#chat-emoji-btn'));
  check('A 模式键缺省（＝填入输入栏）', (await getKey()) === '__none__', String(await getKey()));
  const cardA = await itemText(0);
  check('A 读到首张颜文字卡', !!cardA, String(cardA));
  check('A 点卡片', await clickItem(0));
  await sleep(250);
  const s1 = await evalJs(`(function(){
    var p=document.getElementById('emoji-panel'), i=document.getElementById('chat-input'), b=document.getElementById('chat-body');
    return { open: !!(p && !p.hidden), input: i ? i.textContent : null,
      sent: !!b && b.textContent.indexOf(${JSON.stringify(cardA || '')}) >= 0 }; })()`);
  check('A 默认模式：文字填进聊天输入栏', !!(s1 && s1.input === cardA), JSON.stringify(s1 && s1.input));
  check('A 默认模式：没有发出消息', !!(s1 && s1.sent === false), JSON.stringify(s1 && s1.sent));
  check('A 默认模式：面板保持打开（可连点）', !!(s1 && s1.open === true), '');
  check('A 连点第 2 张', await clickItem(1));
  await sleep(250);
  const cardB = await itemText(1);
  const two = await evalJs(`(function(){ var i=document.getElementById('chat-input'); return i ? i.textContent : null; })()`);
  check('A 连点＝尾部追加（两张都在，顺序不变）', two === String(cardA) + String(cardB), String(two));
  check('A 仍无消息发出', !(await evalJs(`(function(){ var b=document.getElementById('chat-body'); return !!b && b.textContent.indexOf(${JSON.stringify(String(cardA))}) >= 0; })()`)), '');
  // 输入栏原有文字不被清掉
  await evalJs(`(function(){ var i=document.getElementById('chat-input'); if(i) i.textContent='你好'; return true; })()`);
  check('A 已有文字时再点一张', await clickItem(0));
  await sleep(250);
  const mix = await evalJs(`(function(){ var i=document.getElementById('chat-input'); return i ? i.textContent : null; })()`);
  check('A 不清空用户已打的字（前缀保留）', mix === '你好' + String(cardA), String(mix));
  // 点发送：填入的内容真的能自己发出去
  check('A 点「发送」', await click('#chat-send'));
  await sleep(400);
  const afterSend = await evalJs(`(function(){
    var b=document.getElementById('chat-body'), i=document.getElementById('chat-input');
    return { sent: !!b && b.textContent.indexOf('你好' + ${JSON.stringify(String(cardA))}) >= 0, input: i ? i.textContent : null }; })()`);
  check('A 自己点发送：内容作为消息发出', !!(afterSend && afterSend.sent === true), JSON.stringify(afterSend && afterSend.sent));
  check('A 发送后输入栏清空', !!(afterSend && !String(afterSend.input || '').trim()), JSON.stringify(afterSend && afterSend.input));

  // ================= B：开「点击直接发送」＝点一下即发出 =================
  // 先重开面板（点「发送」会按既有「面板外点击关闭」收起），再中途改键、不重开面板就点卡片
  // —— 这一条正是「模式在点击时现读」的判别点：若实现改成只在打开面板时读一次，这里会红。
  await click('#chat-emoji-btn'); await sleep(300);
  await click('.emoji-cats .emoji-cat-chip[data-ecat="kaomoji"]'); await sleep(250);
  check('B 面板已重开（未再开就改键）', await evalJs(`(function(){ var p=document.getElementById('emoji-panel'); return !!(p && !p.hidden); })()`));
  check('B 写入模式键 =1', await setKey('1'));
  const bBefore = await outCount('chat-body');
  check('B 点卡片', await clickItem(0));
  await sleep(400);
  const bAfter = await outCount('chat-body');
  const s2 = await evalJs(`(function(){
    var p=document.getElementById('emoji-panel'), i=document.getElementById('chat-input');
    return { open: !!(p && !p.hidden), input: i ? i.textContent : null }; })()`);
  check('B 直接发送：多出一条我方消息（msg-out +1）', bAfter === bBefore + 1, 'before=' + bBefore + ' after=' + bAfter);
  check('B 直接发送：面板关闭', !!(s2 && s2.open === false), '');
  check('B 直接发送：不往输入栏里塞东西', !!(s2 && !String(s2.input || '').trim()), JSON.stringify(s2 && s2.input));
  check('B 关闭模式键（回默认）', await rmKey());

  // ================= C：设置行的开关 + 小字说明 =================
  const rowInfo = await evalJs(`(function(){
    var r = document.getElementById('cs-chat-textcard-direct-row');
    if (!r) return { row: false };
    var sub = r.querySelector('.txt .sub'), box = r.querySelector('input');
    var prev = r.previousElementSibling;
    return { row: true, cls: r.className, sub: sub ? sub.textContent : '', box: !!box, knob: !!r.querySelector('.toggle .tk'),
      checked: box ? box.checked : null, inGroup: !!document.getElementById('cs-hide-ta-sticker-row'),
      prevId: prev ? prev.id : '' }; })()`);
  check('C 开关行已注入（set-row + toggle，与「隐藏表情包」同组）', !!(rowInfo && rowInfo.row && rowInfo.box && rowInfo.knob && rowInfo.cls.indexOf('set-row') >= 0), JSON.stringify({ row: rowInfo && rowInfo.row, cls: rowInfo && rowInfo.cls }));
  check('C 开关默认关（＝默认填入输入栏）', !!(rowInfo && rowInfo.checked === false && rowInfo.inGroup && /^cs-hide-tab-/.test(rowInfo.prevId || '')), JSON.stringify({ checked: rowInfo && rowInfo.checked, prev: rowInfo && rowInfo.prevId }));
  check('C 小字说明写清「默认填进输入栏 + 可连点 + 自己点发送」', !!(rowInfo && /填进聊天输入栏/.test(rowInfo.sub) && /连点/.test(rowInfo.sub) && /发送/.test(rowInfo.sub)), rowInfo && rowInfo.sub);
  check('C 小字说明写清「开了就立刻发出 + 只对颜文字/emoji 生效」', !!(rowInfo && /立刻发出/.test(rowInfo.sub) && /颜文字/.test(rowInfo.sub) && /emoji/.test(rowInfo.sub) && /表情包图片不受影响/.test(rowInfo.sub)), rowInfo && rowInfo.sub);
  const rowToggle = (want) => evalJs(`(function(){
    var r=document.getElementById('cs-chat-textcard-direct-row'); if(!r) return null;
    var b=r.querySelector('input'); b.checked=${want ? 'true' : 'false'};
    b.dispatchEvent(new Event('change', { bubbles: true }));
    return true; })()`);
  await rowToggle(true);
  check('C 拨开开关写入全局键 =1', (await getKey()) === '1', String(await getKey()));
  await rowToggle(false);
  check('C 拨关开关写回 =0', (await getKey()) === '0', String(await getKey()));
  // 存储位置：只应存在根键 xy-home-v2:chat-textcard-direct；出现 xy-home-v2:<cid>: 前缀的副本
  // 就是「漏进 EXCLUDE 被 migrateLegacy 当旧业务键迁走」的那条路（开关刷新后失效）。
  const scopeKeys = await evalJs(`(function(){
    try {
      var root = 'xy-home-v2:chat-textcard-direct', hits = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('chat-textcard-direct') >= 0) hits.push(k + '=' + localStorage.getItem(k));
      }
      return { root: window.xyStore('xy-home-v2').get('chat-textcard-direct'), hits: hits,
        cid: String(window.__activeCid || '') }; } catch(e){ return null; } })()`);
  check('C 键只落全局根键（无 per-cid 副本，切桌面不丢）',
    !!(scopeKeys && scopeKeys.root === '0' && scopeKeys.hits.length === 1 && scopeKeys.hits[0] === 'xy-home-v2:chat-textcard-direct=0'),
    JSON.stringify(scopeKeys));
  await rmKey();

  // ================= G：切换按钮也放进面板里 =================
  // 用户直派原话：「这个切换的按钮，需要直接在表情包页面的【颜文字】和【emoji】里放一个按钮」。
  // 口径：按钮在面板内、分类行正下方、只在【颜文字】【emoji】两个文字分类出现（表情包图片分类不出现）；
  // 与聊天设置那一行读写同一个全局键＝两处永远一致；点了就地切模式，不用重开面板。
  await rmKey();
  check('G 打开面板并切到颜文字', await openPanelToKaomoji('#chat-emoji-btn'));
  const btnInfo = () => evalJs(`(function(){
    var b = document.getElementById('emoji-text-mode-btn');
    if (!b) return { found: false };
    var r = b.getBoundingClientRect();
    return { found: true, hidden: !!b.hidden, vis: r.width > 0 && r.height > 0,
      main: (b.querySelector('.etm-main')||{}).textContent || '', sub: (b.querySelector('.etm-sub')||{}).textContent || '',
      inPanel: !!document.getElementById('emoji-panel').contains(b),
      afterCats: !!(b.previousElementSibling && b.previousElementSibling.className.indexOf('emoji-cats') >= 0) }; })()`);
  const g0 = await btnInfo();
  check('G 面板内出现切换按钮（在面板里、分类行正下方）', !!(g0 && g0.found && g0.vis && g0.inPanel && g0.afterCats), JSON.stringify(g0));
  check('G 按钮小字写清「当前＝填进输入栏 + 可连点 + 点发送才发 + 点它可切换」',
    !!(g0 && /填进输入栏/.test(g0.main) && /连点/.test(g0.sub) && /发送/.test(g0.sub) && /切换/.test(g0.sub)),
    JSON.stringify(g0 && [g0.main, g0.sub]));
  check('G 面板打开时键仍为缺省', (await getKey()) === '__none__', String(await getKey()));
  // 面板内点一下 → 切到直接发送：写键 + 就地更新文案（不重开面板、不清空输入栏）
  check('G 点面板内按钮', await click('#emoji-text-mode-btn'));
  await sleep(200);
  check('G 面板内切换＝写入全局键 =1', (await getKey()) === '1', String(await getKey()));
  const g1 = await btnInfo();
  check('G 文案就地更新为「直接发送」并说明可切回',
    !!(g1 && /直接发送/.test(g1.main) && /切换/.test(g1.sub) && /填进输入栏/.test(g1.sub)), JSON.stringify(g1 && [g1.main, g1.sub]));
  check('G 切换不关面板（可继续点卡片）', await evalJs(`(function(){ var p=document.getElementById('emoji-panel'); return !!(p && !p.hidden); })()`));
  // 面板内切换立即生效：不重开面板、不刷新页面，点卡片即发出
  // 判别点用「已发消息条数」而不是 body 文本包含——同一张卡在前面的段落已经发过一次，
  // 文本包含恒为真＝这条断言没有判别力（实测踩过）。
  const gCard = await itemText(0);
  const gBefore1 = await outCount('chat-body');
  check('G 点卡片（面板内切换后）', await clickItem(0));
  await sleep(400);
  const gAfter1 = await outCount("chat-body");
  const g2 = await evalJs(`(function(){ var p=document.getElementById('emoji-panel'); return { open: !!(p && !p.hidden) }; })()`);
  check('G 面板内切到直接发送后：点卡片即发出（msg-out +1）', gAfter1 === gBefore1 + 1, 'before=' + gBefore1 + ' after=' + gAfter1);
  check('G 直接发送后面板关闭', !!(g2 && g2.open === false), JSON.stringify(g2));
  // 再点一下切回填入输入栏，端到端复验（面板被上一步关闭，按正常入口重开）
  check('G 重开面板并切颜文字', await openPanelToKaomoji('#chat-emoji-btn'));
  await evalJs(`(function(){ var i=document.getElementById('chat-input'); if(i) i.textContent=''; return true; })()`);
  check('G 再点按钮切回', await click('#emoji-text-mode-btn'));
  await sleep(200);
  check('G 切回＝键写回 =0', (await getKey()) === '0', String(await getKey()));
  const g3 = await btnInfo();
  check('G 切回后文案变回「填进输入栏」', !!(g3 && /填进输入栏/.test(g3.main)), JSON.stringify(g3 && g3.main));
  const gBefore2 = await outCount("chat-body");
  check('G 切回后点卡片', await clickItem(0));
  await sleep(250);
  const gAfter2 = await outCount("chat-body");
  const g4 = await evalJs(`(function(){ var i=document.getElementById('chat-input'); return i ? i.textContent : null; })()`);
  check('G 切回后：只填进输入栏、未发新消息', !!((String(g4 || '') === String(gCard)) && gAfter2 === gBefore2), JSON.stringify({ input: g4, before: gBefore2, after: gAfter2 }));
  await evalJs(`(function(){ var i=document.getElementById('chat-input'); if(i) i.textContent=''; return true; })()`);
  // 设置行 ⇄ 面板 双向一致：面板里切了，设置行的勾选跟着变（同一个键；行同步由可见时的 500ms ticker 驱动）
  check('G 面板切到 =1 供设置行复验', await setKey('1'));
  await evalJs(`(function(){ var p=document.getElementById('page-chat-settings'); if(p) p.hidden=false; return true; })()`);
  await sleep(700); // 进页当帧先跑一次 + 500ms ticker
  const rowSynced = await evalJs(`(function(){ var r=document.getElementById('cs-chat-textcard-direct-row'); var b=r&&r.querySelector('input'); return b?b.checked:null; })()`);
  check('G 面板切模式后设置行勾选同步为开', rowSynced === true, String(rowSynced));
  await evalJs(`(function(){ var p=document.getElementById('page-chat-settings'); if(p) p.hidden=true; return true; })()`);
  // 分类作用域：emoji 分类也有按钮，表情包图片分类没有
  check('G 切到 emoji 分类', await click('.emoji-cats .emoji-cat-chip[data-ecat="emoji"]'));
  await sleep(300);
  const gEmoji = await btnInfo();
  check('G 【emoji】分类里同样有切换按钮', !!(gEmoji && gEmoji.found && gEmoji.vis), JSON.stringify(gEmoji));
  check('G 切回表情包分类', await click('.emoji-cats .emoji-cat-chip[data-ecat="sticker"]'));
  await sleep(300);
  const gSticker = await btnInfo();
  check('G 表情包图片分类下按钮隐藏（只对颜文字/emoji 生效）', !!(gSticker && gSticker.found && gSticker.hidden === true), JSON.stringify(gSticker));
  await rmKey();

  // ================= D：插入回调（写信/回信）优先级更高，行为不变 =================
  const inserted = await evalJs(`(function(){
    window.__ins691 = null;
    if (!window.openEmojiPanelForInsert) return 'NOFUNC';
    window.openEmojiPanelForInsert(function (t, kind) { window.__ins691 = kind + '|' + t; }, { allowUrl: true });
    return 'OK';
  })()`);
  check('D 可用插入回调模式打开面板', inserted === 'OK', String(inserted));
  await sleep(350);
  check('D 切到颜文字分类', await click('.emoji-cats .emoji-cat-chip[data-ecat="kaomoji"]'));
  await sleep(250);
  // #691i：写信/回信是「插进信纸」语义、模式键对它无效——面板内的切换按钮默认不显示，
  // 免得给了个点了没用的控件；群聊（textModeApplies:true）才显示。
  const dMailBar = await evalJs(`(function(){ var b=document.getElementById('emoji-text-mode-btn'); return b ? { found:true, hidden:!!b.hidden } : { found:false }; })()`);
  check('D 写信/回信插入模式下不显示模式切换按钮（模式键对它无效）', !!(dMailBar && dMailBar.found && dMailBar.hidden === true), JSON.stringify(dMailBar));
  await evalJs(`(function(){ var cs=document.querySelectorAll('#emoji-groups .emoji-g-chip'); if(cs.length) cs[0].click(); return true; })()`);
  await sleep(250);
  check('D 点卡片', await clickItem(0));
  await sleep(300);
  const dRes = await evalJs(`(function(){
    var p=document.getElementById('emoji-panel'); return { ins: window.__ins691, open: !!(p && !p.hidden) }; })()`);
  check('D 回调收到文字卡（kind=text），插入模式优先于「直接发送」', !!(dRes && dRes.ins === 'text|' + String(cardA)), JSON.stringify(dRes && dRes.ins));
  check('D 插入模式照旧关面板', !!(dRes && dRes.open === false), '');

  // ================= E：群聊复用同一模式（默认填入群聊输入栏） =================
  check('E 进入群聊', await click('.app[data-app="group-chat"]'));
  await sleep(600);
  const gcReady = await evalJs(`(function(){ return !!(document.getElementById('gc-input') && document.getElementById('gc-emoji-btn')); })()`);
  check('E 群聊页元素就绪', !!gcReady, '');
  check('E 打开群聊表情面板并切颜文字', await openPanelToKaomoji('#gc-emoji-btn'));
  const eBar = await evalJs(`(function(){ var b=document.getElementById('emoji-text-mode-btn'); return b ? { found:true, hidden:!!b.hidden } : { found:false }; })()`);
  check('E 群聊面板内保留模式切换按钮（群聊行为受模式键支配）', !!(eBar && eBar.found && eBar.hidden === false), JSON.stringify(eBar));
  const gcCard = await itemText(0);
  check('E 读到颜文字卡', !!gcCard, String(gcCard));
  await evalJs(`(function(){ var i=document.getElementById('gc-input'); if(i) i.textContent=''; return true; })()`);
  check('E 点卡片（默认模式）', await clickItem(0));
  await sleep(300);
  const e0 = await outCount('gc-body');
  const e1 = await evalJs(`(function(){
    var p=document.getElementById('emoji-panel'), i=document.getElementById('gc-input');
    return { open: !!(p && !p.hidden), input: i ? i.textContent : null }; })()`);
  check('E 群聊默认模式：文字填进群聊输入栏', !!(e1 && e1.input === String(gcCard)), JSON.stringify(e1 && e1.input));
  check('E 群聊默认模式：没有发出群消息（msg-out 不变）', (await outCount('gc-body')) === e0, 'before=' + e0 + ' after=' + (await outCount('gc-body')));
  // 开「直接发送」后同口径走原发送路径
  check('E 写入模式键 =1', await setKey('1'));
  check('E 重开面板并切颜文字', await openPanelToKaomoji('#gc-emoji-btn'));
  const eBefore = await outCount('gc-body');
  check('E 点卡片（直接发送模式）', await clickItem(0));
  await sleep(400);
  const eAfter = await outCount('gc-body');
  const e2 = await evalJs(`(function(){ var p=document.getElementById('emoji-panel'); return { open: !!(p && !p.hidden) }; })()`);
  check('E 群聊直接发送：多出一条群消息（msg-out +1）', eAfter === eBefore + 1, 'before=' + eBefore + ' after=' + eAfter);
  await rmKey();

  // ================= F：全程零新增 JS 异常（尤其那条程序化 input 事件） =================
  const errs = await evalJs(`(function(){ return JSON.stringify((window.__jsErrors||[]).slice(-3)); })()`);
  check('F 全程无新增 JS 异常', !errs || errs === '[]', String(errs));

  console.log('\n==== 结果：' + (pass + fail) + ' 项检查，' + fail + ' 项失败 ====');
  if (fail) process.exitCode = 1;
  else console.log('全部通过');
} catch (e) {
  console.error('脚本异常:', e.message);
  process.exitCode = 1;
} finally {
  try { if (ws) ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
}
process.exit(process.exitCode || 0);
