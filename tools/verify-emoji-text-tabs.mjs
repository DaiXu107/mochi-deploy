// ===== 回归脚本：表情包面板【颜文字】【emoji】分类 + 我的文字库 + 隐藏开关（#636） =====
// 用法：node build.mjs && node tools/verify-emoji-text-tabs.mjs
// 背景（用户需求）：
//   聊天表情包面板在 公用/TA 的/我的 三分区之外，新增【颜文字】【emoji】两个一级分类
//   （取字卡库同名分类的 公用/专属 两作用域 + 面板自建「我的」文字库），与表情包同模式；
//   颜文字渲染为文字卡、emoji 为大字号字形；点卡片＝发纯文字消息；「我的」支持批量导入
//   一行一个（【分组名】前缀可选）；聊天设置→表情包 加「隐藏颜文字/隐藏emoji」两开关
//   （全局键 hide-tab-kaomoji / hide-tab-emoji，默认关＝显示）。
// 实现：chat.js emojiCat 分类行（JS 注入 .emoji-cats）+ renderEmojiTextPanel 文字网格；
//   my-text-groups 全局键；chat-settings.js 注入两开关行（广播 hide-tab-changed）。
// #666 追加（2026-09-17 用户直派）：A/B/F2 三条 computed border-right 断言——emoji 4 列网格
//   同挂 .emoji-grid-text，那条给 2 列文字网格用的「2n 去右线」会把第 2 格右线也摘掉＝
//   一行四格里中间两个之间缺一条竖线（用户报障）。
// 注意：本文件字符串里不要出现反引号（颜文字测试样本一律选不含 ` 的），避免模板串转义事故。
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
const userDataDir = join(process.env.TEMP || '/tmp', 'mochi-etext-' + Date.now());
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
// #666：1px 在本页运行环境里会被算成 0.666667px 之类的小数（页面缩放/DPR），
// 所以竖线断言只判「有没有线」（Y/N），不判绝对值——判的是「行内竖线在不在」这个行为。
function borderSig(list) {
  return (list || []).map(function (v) { return parseFloat(v) > 0 ? 'Y' : 'N'; }).join('');
}
// #666：sticker 分类的网格是异步填充的（#435 懒加载/面板水合），断言前先等网格出现
async function waitGrid(maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (await evalJs(`!!document.querySelector('#emoji-list .emoji-grid')`)) return true;
    await sleep(150);
  }
  return false;
}

async function navigate(query) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' + (query || '') });
  for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(600);
}

// 面板快照：分类行 + 作用域 tab + 分组 chips + 文字网格 + 工具行
const SNAP = `(function(){
  var p = document.getElementById('emoji-panel');
  if (!p || p.hidden) return { open: false };
  var cats = [].slice.call(p.querySelectorAll('.emoji-cats .emoji-cat-chip'));
  var tabs = [].slice.call(p.querySelectorAll('#emoji-panel .emoji-tab'));
  var visTabs = tabs.filter(function(t){ return !t.hidden && t.offsetWidth > 0; });
  var chips = [].slice.call(p.querySelectorAll('#emoji-groups .emoji-g-chip')).map(function(c){ return c.textContent; });
  var items = [].slice.call(p.querySelectorAll('#emoji-list .emoji-text-item')).map(function(d){
    return (d.childNodes.length && d.childNodes[0].nodeType === 3) ? d.childNodes[0].textContent : d.textContent;
  });
  var grid = p.querySelector('#emoji-list .emoji-grid');
  // #666：网格列数 + 每格 computed 右边线宽——用来验「一行 N 个」时的竖线是否断在行内
  var cols = 0, hborders = [];
  if (grid) {
    try { cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(function(s){ return s; }).length; } catch (e) {}
    hborders = [].slice.call(p.querySelectorAll('#emoji-list .emoji-grid > .emoji-item')).map(function(d){
      return getComputedStyle(d).borderRightWidth;
    });
  }
  var tt = document.getElementById('emoji-text-tools');
  return { open: true,
    cols: cols,
    hborders: hborders,
    cats: cats.map(function(c){ return { cat: c.dataset.ecat, hidden: c.hidden === true, sel: c.classList.contains('sel') }; }),
    visTabs: visTabs.map(function(t){ return t.dataset.etab; }),
    taLabel: (p.querySelector('[data-etab="ta"]')||{}).textContent || '',
    pubLabel: (p.querySelector('[data-etab="public"]')||{}).textContent || '',
    chips: chips,
    textItems: items,
    gridClass: grid ? grid.className : '',
    toolsShown: !!tt && !tt.hidden,
    batchCount: (document.getElementById('emoji-batch-count')||{}).textContent || '' };
})()`;

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  // ================= 预置数据（重载生效） =================
  await navigate('');
  const seeded = await evalJs(`(function(){
    try {
      var tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      var own = { text:[], image:[], poke:[], voice:[], sticker:[['TA表情',[tiny,tiny]]],
        kaomoji:[['开心',['(＝^ω^＝)','(￣▽￣)~*']]], emoji:[['常用',['😂','🥰']],['四列组',['😀','😁','😃','😄']]] };
      var pub = { text:[], image:[], poke:[], voice:[], sticker:[],
        kaomoji:[['公用开心',['(◕‿◕)']]], emoji:[['公用E',['😭','🙄']]] };
      window.activeStore().set('cc-groups', JSON.stringify(own));
      window.xyStore('xy-home-v2').set('cc-groups-public', JSON.stringify(pub));
      window.xyStore('xy-home-v2').set('cc-scope-migrated', '1');
      window.xyStore('xy-home-v2').set('my-emoji-groups', JSON.stringify([['我的分组',[tiny,tiny,tiny]]]));
      window.xyStore('xy-home-v2').set('my-text-groups', JSON.stringify({ kaomoji:[['我的颜文字组',['(´∀｀)']]], emoji:[['我的E组',['😎']]] }));
      window.xyStore('xy-home-v2').remove('hide-tab-kaomoji');
      window.xyStore('xy-home-v2').remove('hide-tab-emoji');
      window.activeStore().remove('hide-ta-sticker');
      return 'OK';
    } catch (e) { return 'ERR:' + e.message; }
  })()`);
  check('预置字卡/文字库种子写入成功', seeded === 'OK', String(seeded));
  await navigate('');

  // ================= A：sticker 既有路径零回归 + 分类行出现 =================
  check('A 聊天页可打开', await click('.app[data-app="chat"]'));
  await sleep(500);
  check('A 表情按钮可打开面板', await click('#chat-emoji-btn'));
  await sleep(350);
  await waitGrid(3000);
  let a = await evalJs(SNAP);
  check('A 分类行 3 个 chip 且默认选中表情包', !!(a && a.open && a.cats.length === 3 && a.cats[0].cat === 'sticker' && a.cats[0].sel && !a.cats[1].sel), JSON.stringify(a && a.cats));
  check('A sticker：3 个作用域 tab 可见', !!(a && a.visTabs.join(',') === 'public,ta,mine'), JSON.stringify(a && a.visTabs));
  check('A sticker：分组栏照旧（TA表情2）且无文字网格', !!(a && a.chips.join(',').indexOf('TA表情2') >= 0 && a.textItems.length === 0), JSON.stringify(a && a.chips));
  check('A sticker：图片工具行显示、文字工具行隐藏', !!(a && a.toolsShown === false), '');
  // 相邻面：#666 只动「文字网格」的去右线规则，sticker 的 4 列网格必须一字不变
  // （sticker 分组默认不自动选中——先点分组 chip 再等网格落地）
  check('A 点选 sticker 分组（等待网格渲染）', !!(await click('#emoji-groups .emoji-g-chip')) && (await waitGrid(3000)));
  await sleep(300);
  let a2 = await evalJs(SNAP);
  check('A sticker 4 列网格行内竖线完整（第 1/2 格都留右线，只行尾去线）', !!(a2 && a2.cols === 4 && borderSig(a2.hborders) === 'YY'), JSON.stringify({ cols: a2 && a2.cols, b: a2 && a2.hborders }));

  // ================= B：颜文字分类（TA 专属）+ 点卡片发纯文字 =================
  check('B 切到颜文字分类', await click('.emoji-cats .emoji-cat-chip[data-ecat="kaomoji"]'));
  await sleep(300);
  let b = await evalJs(SNAP);
  check('B 作用域 tab 文案跟随分类（TA 的颜文字）', !!(b && /的颜文字$/.test(b.taLabel || '')), b && b.taLabel);
  check('B TA 专属颜文字分组自动选中（开心2）', !!(b && b.chips.join(',').indexOf('开心2') >= 0), JSON.stringify(b && b.chips));
  check('B 文字网格渲染专属卡（2 张，首张内容正确）', !!(b && b.textItems.length === 2 && b.textItems[0] === '(＝^ω^＝)'), JSON.stringify(b && b.textItems));
  check('B 颜文字 2 列网格：行内留线、行尾去线（Y,N）', !!(b && b.cols === 2 && borderSig(b.hborders) === 'YN'), JSON.stringify({ cols: b && b.cols, b: b && b.hborders }));
  // ===== B2（#691）：点卡片的两种模式——默认「填入输入栏」，设置里可切成「点击直接发送」 =====
  // 用户直派：「点击后输入聊天输入栏，我自己选择发；或者手动打开『直接点击就发送』的功能」。
  // 默认（键缺省）＝填入输入栏：点一下只追加进 #chat-input，不发消息、面板不关（可连点）。
  const modeDefault = await evalJs(`(function(){ try { var v = window.xyStore('xy-home-v2').get('chat-textcard-direct'); return (v === null || v === undefined) ? '__none__' : String(v); } catch(e){ return 'ERR'; } })()`);
  check('B2 模式键缺省（＝填入输入栏）', modeDefault === '__none__', String(modeDefault));
  check('B2 点卡片（默认模式）', await click('#emoji-list .emoji-text-item'));
  await sleep(250);
  const ins = await evalJs(`(function(){
    var p = document.getElementById('emoji-panel'), i = document.getElementById('chat-input'), body = document.getElementById('chat-body');
    return { open: !!(p && !p.hidden), text: i ? i.textContent : null,
      bubble: !!body && body.textContent.indexOf('(＝^ω^＝)') >= 0 }; })()`);
  check('B2 默认模式：文字填入输入栏', !!(ins && ins.text === '(＝^ω^＝)'), JSON.stringify(ins && ins.text));
  check('B2 默认模式：不发出消息（聊天区无该内容）', !!(ins && ins.bubble === false), '');
  check('B2 默认模式：面板保持打开（可继续点）', !!(ins && ins.open === true), '');
  check('B2 连点第二张', await evalJs(`(function(){ var its=document.querySelectorAll('#emoji-list .emoji-text-item'); if(its[1]){ its[1].click(); return true; } return false; })()`));
  await sleep(250);
  const appended = await evalJs(`(function(){ var i=document.getElementById('chat-input'); return i ? i.textContent : null; })()`);
  check('B2 连点＝尾部追加不清空', appended === '(＝^ω^＝)(￣▽￣)~*', String(appended));
  // 切成「点击直接发送」：模式在点击时现读，无需重开面板
  await evalJs(`(function(){ var i=document.getElementById('chat-input'); if(i) i.textContent=''; return true; })()`);
  await evalJs(`window.xyStore('xy-home-v2').set('chat-textcard-direct','1')`);
  check('B2 开「点击直接发送」后点同一张卡片', await click('#emoji-list .emoji-text-item'));
  await sleep(300);
  const dir = await evalJs(`(function(){
    var p = document.getElementById('emoji-panel'), body = document.getElementById('chat-body'), i = document.getElementById('chat-input');
    return { open: !!(p && !p.hidden), bubble: !!body && body.textContent.indexOf('(＝^ω^＝)') >= 0, text: i ? i.textContent : null }; })()`);
  check('B2 直接发送：内容作为纯文字消息发出', !!(dir && dir.bubble === true), JSON.stringify(dir));
  check('B2 直接发送：面板关闭且不碰输入栏', !!(dir && dir.open === false && dir.text === ''), JSON.stringify(dir));
  await evalJs(`window.xyStore('xy-home-v2').remove('chat-textcard-direct')`); // 复原缺省，后续段落按默认模式走

  // ================= C：公用作用域 =================
  check('C 重开面板', await click('#chat-emoji-btn'));
  await sleep(300);
  check('C 重开后记住颜文字分类', await click('.emoji-cats .emoji-cat-chip[data-ecat="kaomoji"]'));
  await sleep(250);
  check('C 切到公用作用域', await click('#emoji-panel .emoji-tab[data-etab="public"]'));
  await sleep(300);
  let c = await evalJs(SNAP);
  check('C 公用 tab 文案与公用分组（公用开心1）', !!(c && /公用颜文字/.test(c.pubLabel || '') && c.chips.join(',').indexOf('公用开心1') >= 0), JSON.stringify({ pub: c && c.pubLabel, chips: c && c.chips }));
  check('C 公用网格内容正确', !!(c && c.textItems.length === 1 && c.textItems[0] === '(◕‿◕)'), JSON.stringify(c && c.textItems));
  // #842（用户直派：颜文字/emoji 没有最近使用）：B2 点过卡后，文字分类分组条最前也该有最近使用 chip
  check('C 颜文字分类也有「⏱最近使用」chip 且排最前', !!(c && c.chips.length && c.chips[0].indexOf('最近使用') >= 0), JSON.stringify(c && c.chips));

  // ================= D：我的 + 批量导入（一行一个 + 【分组名】前缀 + 去重） =================
  check('D 切到我的作用域', await click('#emoji-panel .emoji-tab[data-etab="mine"]'));
  await sleep(300);
  let d = await evalJs(SNAP);
  check('D 文字工具行出现', !!(d && d.toolsShown), '');
  check('D 我的颜文字分组渲染（我的颜文字组1）', !!(d && d.chips.join(',').indexOf('我的颜文字组1') >= 0 && d.textItems.length === 1 && d.textItems[0] === '(´∀｀)'), JSON.stringify({ chips: d && d.chips, items: d && d.textItems }));
  check('D 点「批量导入」弹窗', await click('#emoji-text-tools .emoji-tool'));
  await sleep(350);
  const modalUp = await evalJs(`(function(){ var t=document.getElementById('modal-textarea'); var m=document.getElementById('modal-mask'); return !!(t && m && !m.hidden && !t.hidden); })()`);
  check('D 导入弹窗带多行输入框', !!modalUp);
  const importText = '(｡•ᴗ•｡)\n【新组】(๑•́ ₃ •̀๑)\n(｡•ᴗ•｡)'; // 一行一个：第1/3行同文（去重），第2行带【分组名】前缀
  await evalJs("(function(){ var t=document.getElementById('modal-textarea'); if(t) t.value = " + JSON.stringify(importText) + "; return true; })()");
  check('D 确认导入', await click('#modal-ok'));
  await sleep(400);
  // 弹窗确认的 click 会冒泡到 document 的「面板外点击关闭」（与既有链接导入同行为）——按需重开
  const reopenD = await evalJs(`(function(){ var p=document.getElementById('emoji-panel'); return !!(p && !p.hidden); })()`);
  if (!reopenD) { await click('#chat-emoji-btn'); await sleep(300); }
  check('D 重开面板（记住分类与我的作用域）后重取快照', await click('#emoji-panel .emoji-tab[data-etab="mine"]'));
  await sleep(250);
  let d2 = await evalJs(SNAP);
  check('D 导入后分组出现（我的颜文字组2 + 新组1）', !!(d2 && d2.chips.join(',').indexOf('我的颜文字组2') >= 0 && d2.chips.join(',').indexOf('新组1') >= 0), JSON.stringify(d2 && d2.chips));
  check('D 组内去重（重复行被跳过：种子卡+新导入=2 张，顺序不变）', !!(d2 && d2.textItems.length === 2 && d2.textItems[0] === '(´∀｀)' && d2.textItems[1] === '(｡•ᴗ•｡)'), JSON.stringify(d2 && d2.textItems));
  const stored = await evalJs(`(function(){ try { var v=JSON.parse(window.xyStore('xy-home-v2').get('my-text-groups')||'null'); return JSON.stringify({ k:(v.kaomoji||[]).map(function(g){return g[0]+':'+g[1].length;}), e:(v.emoji||[]).map(function(g){return g[0]+':'+g[1].length;}) }); } catch(e){ return 'ERR:'+e.message; } })()`);
  // 新建分组 unshift 在前（与链接导入同序），这里按集合比较
  let storedOk = false; try { const got = JSON.parse(stored); storedOk = JSON.stringify({ k: got.k.slice().sort(), e: got.e }) === JSON.stringify({ k: ['我的颜文字组:2', '新组:1'].sort(), e: ['我的E组:1'] }); } catch (e) {}
  check('D my-text-groups 落库（kaomoji 2 组 2+1，emoji 原样）', storedOk, String(stored));

  // ================= E：批量管理（全选/删除，删空分组自动清） =================
  check('E 进入批量管理', await click('#emoji-text-tools .emoji-tool:nth-child(2)'));
  await sleep(300);
  check('E 批量工具条出现', await evalJs(`(function(){ var b=document.getElementById('emoji-batch'); return !!(b && !b.hidden); })()`));
  check('E 全选当前分组', await click('#emoji-batch-all'));
  await sleep(250);
  let e1 = await evalJs(SNAP);
  check('E 计数与勾选（已选 2 个）', !!(e1 && /已选 2 个/.test(e1.batchCount || '')), e1 && e1.batchCount);
  // #842：批量勾选只对分组原卡有意义，批量模式下不出最近 chip（与表情包同口径）
  check('E 我的批量管理模式下不出现「⏱最近使用」chip', !!(e1 && e1.chips.filter(function (t) { return t.indexOf('最近使用') >= 0; }).length === 0), JSON.stringify(e1 && e1.chips));
  check('E 点删除弹确认', await click('#emoji-batch-del'));
  await sleep(300);
  check('E 确认删除', await click('#modal-ok'));
  await sleep(400);
  const reopenE = await evalJs(`(function(){ var p=document.getElementById('emoji-panel'); return !!(p && !p.hidden); })()`);
  if (!reopenE) { await click('#chat-emoji-btn'); await sleep(300); }
  // #842：文字分类也有「⏱最近使用」chip（B2 点过的那张仍能从 TA 池解析到），它不是分组残留——比分组 chips 时先剔除
  let e2 = await evalJs(SNAP);
  const e2Groups = (e2 && e2.chips ? e2.chips : []).filter(function (t) { return t.indexOf('最近使用') < 0; });
  check('E 删空分组自动清（分组 chips 只剩 新组1，自动落到新组）', !!(e2 && e2Groups.join(',') === '新组1' && e2.textItems.length === 1 && e2.textItems[0] === '(๑•́ ₃ •̀๑)'), JSON.stringify({ chips: e2 && e2.chips, items: e2 && e2.textItems }));
  check('E 退出批量', await click('#emoji-batch-exit'));
  await sleep(250);

  // ================= F：emoji 分类（先切回 TA 作用域，验证作用域记忆跨分类保留） =================
  check('F 切到 emoji 分类', await click('.emoji-cats .emoji-cat-chip[data-ecat="emoji"]'));
  await sleep(250);
  check('F 切回 TA 作用域', await click('#emoji-panel .emoji-tab[data-etab="ta"]'));
  await sleep(300);
  let f = await evalJs(SNAP);
  check('F emoji 分组自动选中（常用2）与内容', !!(f && f.chips.join(',').indexOf('常用2') >= 0 && f.textItems.join(',') === '😂,🥰'), JSON.stringify({ chips: f && f.chips, items: f && f.textItems }));
  check('F emoji 网格走 4 列大字号样式', !!(f && /emoji-grid-emoji/.test(f.gridClass || '')), f && f.gridClass);

  // ================= F2（#666）：emoji 4 列网格的行内竖线不能断 =================
  // 用户报障：「emoji 里正常显示是一行四个，但是中间的两个没有线分开，缺一条线」。
  // 根因＝emoji 网格同挂 .emoji-grid-text，2n 去右线规则特异性更高 → 第 2 格右线（中间竖线）被摘。
  // 判别口径：4 列时右边线序列必须是 1px,1px,1px,0px（前三格留、第 4 格行尾去）。
  check('F2 切到 4 个 emoji 的分组', await evalJs(`(function(){ var cs=document.querySelectorAll('#emoji-groups .emoji-g-chip'); for (var i=0;i<cs.length;i++){ if (cs[i].textContent.indexOf('四列组')===0){ cs[i].click(); return true; } } return false; })()`));
  await sleep(300);
  let f2 = await evalJs(SNAP);
  check('F2 该分组仍是 4 列网格', !!(f2 && f2.cols === 4 && f2.textItems.length === 4), JSON.stringify({ cols: f2 && f2.cols, items: f2 && f2.textItems }));
  check('F2 每行只在第 4 格去右线（Y,Y,Y,N＝中间竖线不断）', !!(f2 && borderSig(f2.hborders) === 'YYYN'), JSON.stringify(f2 && f2.hborders));

  // ================= G：隐藏开关（设置行注入 + 分类 chip 隐藏/回落） =================
  const rowsInjected = await evalJs(`(function(){
    var r1 = document.getElementById('cs-hide-tab-kaomoji-row');
    var r2 = document.getElementById('cs-hide-tab-emoji-row');
    var b1 = r1 ? r1.querySelector('input') : null;
    return { r1: !!r1, r2: !!r2, cb: !!b1, checked: b1 ? b1.checked : null };
  })()`);
  check('G 设置页两开关行已注入且默认关', !!(rowsInjected && rowsInjected.r1 && rowsInjected.r2 && rowsInjected.cb && rowsInjected.checked === false), JSON.stringify(rowsInjected));

  // ===== G2（#691）：点卡片模式开关行——注入位置/小字说明/拨动写键 =====
  const modeRow = await evalJs(`(function(){
    var r = document.getElementById('cs-chat-textcard-direct-row');
    if (!r) return { row: false };
    var sub = r.querySelector('.txt .sub'), box = r.querySelector('input');
    return { row: true, cls: r.className, sub: sub ? sub.textContent : '', box: !!box,
      checked: box ? box.checked : null, knob: !!r.querySelector('.toggle .tk') }; })()`);
  check('G2 模式开关行已注入（set-row + 开关，默认关）', !!(modeRow && modeRow.row && modeRow.box && modeRow.knob && modeRow.cls.indexOf('set-row') >= 0 && modeRow.checked === false), JSON.stringify(modeRow));
  check('G2 小字说明写清两种模式与作用范围', !!(modeRow && /填进聊天输入栏/.test(modeRow.sub) && /立刻发出/.test(modeRow.sub) && /表情包图片不受影响/.test(modeRow.sub)), modeRow && modeRow.sub);
  const modeToggleWritten = await evalJs(`(function(){
    var r = document.getElementById('cs-chat-textcard-direct-row'); if (!r) return null;
    var b = r.querySelector('input'); b.checked = true;
    b.dispatchEvent(new Event('change', { bubbles: true }));
    return window.xyStore('xy-home-v2').get('chat-textcard-direct'); })()`);
  check('G2 拨开关写入全局键 chat-textcard-direct=1', modeToggleWritten === '1', String(modeToggleWritten));
  await evalJs(`window.xyStore('xy-home-v2').remove('chat-textcard-direct')`); // 复原缺省
  await evalJs(`window.xyStore('xy-home-v2').set('hide-tab-kaomoji','1')`);
  await click('#emoji-close');
  await sleep(200);
  check('G 重开面板', await click('#chat-emoji-btn'));
  await sleep(300);
  let g1 = await evalJs(SNAP);
  const kamo = g1 && g1.cats.filter(function (c) { return c.cat === 'kaomoji'; })[0];
  check('G 隐藏后颜文字 chip 不可见', !!(g1 && g1.open && kamo && kamo.hidden === true && kamo.sel === false), JSON.stringify(g1 && g1.cats));
  await evalJs(`window.xyStore('xy-home-v2').remove('hide-tab-kaomoji')`);
  await click('#emoji-close');
  await sleep(200);
  check('G 重开面板（恢复显示）', await click('#chat-emoji-btn'));
  await sleep(300);
  let g2 = await evalJs(SNAP);
  const kamo2 = g2 && g2.cats.filter(function (c) { return c.cat === 'kaomoji'; })[0];
  check('G 恢复后颜文字 chip 可见', !!(g2 && g2.open && kamo2 && kamo2.hidden === false), JSON.stringify(g2 && g2.cats));

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
  // 事故教训（WORKLOG 2026-09-16 ENOSPC）：无头 Chrome 临时目录用完即删
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
}
process.exit(process.exitCode || 0);
