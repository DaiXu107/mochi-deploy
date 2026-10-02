// ===== 专项回归：联系人性别→TA 称呼跟随（contacts.js + 各模块渲染出口） =====
// 用户需求：所有弹窗/消息里的 他/TA 按联系人性别显示为 他/她；不设置默认 TA；
//          桌面切换联系人的管理弹窗里可设置，并带小字说明。
// 用例：
//   T1 助手 API 可用且未设置时默认 TA
//   T2 桌面浮字（taChimeShow）未设置：他→TA
//   T3 联系人管理弹窗：称呼按钮 + 小字说明 + 三选项胶囊
//   T4 设置「她」后：taWord/taFit/浮字/聊天收件气泡 全部跟随；我方消息保持原话；「其他」不受影响
//   T5 改回「不设置」恢复默认
//   T6 加载至今无未捕获异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
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
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'period.js', 'accounting.js', 'garden.js', 'decision.js', 'pong.js', 'snake-game.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'mobile-adapt.js'];
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => '(function () { try {\n' + readFileSync(join(root, 'src/js', f), 'utf8') + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();').join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-test-build').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-tagender-root-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(tmpRoot, rel));
    if (!p.startsWith(tmpRoot)) { res.writeHead(403); res.end(); return; }
    let hit = false;
    try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) {
      p = normalize(join(root, rel));
      if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
      try { hit = statSync(p).isFile(); } catch (e) {}
    }
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-tagender-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}
try {
  await cdpConnect();
  const jsErrors = [];
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  const rawHandler = ws.onmessage;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(JSON.stringify(m.params).slice(0, 200));
    if (rawHandler) rawHandler(ev);
  };

  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4500);

  console.log('\n== T1 助手 API ==');
  const api = await evalJs("({ fit: typeof window.taFit, word: typeof window.taWord, wordFor: typeof window.taWordFor, gender: typeof window.partnerGenderFor })");
  ok('taFit/taWord/taWordFor/partnerGenderFor 均已暴露', api && ['function'].every(x => [api.fit, api.word, api.wordFor, api.gender].indexOf(x) >= 0), api);
  ok('未设置默认 TA', api && (await evalJs('window.taWord()')) === 'TA');

  console.log('\n== T2 浮字默认（他→TA） ==');
  await evalJs("window.taChimeShow('他在那边也偷了个懒'); true");
  await sleep(80);
  const chime1 = await evalJs("(document.querySelector('.ta-chime-note .ta-chime-text')||{}).textContent");
  ok('未设置时浮字显示 TA', chime1 === 'TA在那边也偷了个懒', chime1);

  console.log('\n== T3 管理弹窗 UI ==');
  await evalJs("window.openContactManager(); true");
  await sleep(150);
  const ui = await evalJs("({ visible: document.getElementById('contact-manager').style.display === 'flex', genBtns: Array.from(document.querySelectorAll('#contact-manager button')).filter(b => b.textContent === '称呼').length, hint: (document.querySelector('#contact-manager div div')||{}).textContent || '', rowHint: Array.from(document.querySelectorAll('#contact-manager div')).some(d => d.textContent.indexOf('称呼') >= 0) })");
  ok('管理弹窗打开且有「称呼」按钮', ui && ui.visible && ui.genBtns >= 1, ui);
  ok('头部小字说明提到称呼设置', ui && ui.hint.indexOf('称呼') >= 0, ui && ui.hint);
  // 点开称呼弹窗看 pills 与小字说明
  await evalJs("Array.from(document.querySelectorAll('#contact-manager button')).find(b => b.textContent === '称呼').click(); true");
  await sleep(150);
  const modal = await evalJs("({ pills: Array.from(document.querySelectorAll('.modal-pills .pill, #modal-pills .pill')).map(b => b.textContent), stat: (document.getElementById('modal-static')||{textContent:''}).textContent })");
  ok('称呼弹窗三选项（他/她/不设置）', modal && modal.pills.length === 3 && modal.pills.join('|').indexOf('她') >= 0 && modal.pills.join('|').indexOf('不设置') >= 0, modal && modal.pills);
  ok('弹窗内有小字说明（跟随性别+不改原文）', modal && modal.stat.indexOf('小字说明') >= 0 && modal.stat.indexOf('不会改动已保存的消息原文') >= 0, modal && modal.stat.slice(0, 60));
  await evalJs("(document.querySelector('.modal-cancel, #modal-cancel')||{click(){}}).click(); true");

  console.log('\n== T4 设置「她」后全链路跟随 ==');
  await evalJs("window.xyStore('xy-home-v2:default').set('partner-gender','she'); true");
  await evalJs("window.dispatchEvent(new CustomEvent('ta-word-changed')); true");
  await sleep(200);
  ok('taWord 变为 她', (await evalJs('window.taWord()')) === '她');
  await evalJs("window.taChimeShow('他在那边也偷了个懒'); true");
  await sleep(80);
  ok('浮字跟随显示 她', (await evalJs("(document.querySelector('.ta-chime-note .ta-chime-text')||{}).textContent")) === '她在那边也偷了个懒');
  // 聊天：in 方消息替换、out 方保持原话、「其他」保护
  const chatRes = await evalJs("(function () { window.chatAddIn('他今天也在想你'); window.chatAddIn('其他的事不管'); window.chatSendMsg('想他了'); var bubbles = document.querySelectorAll('.msg-bubble'); var last = Array.prototype.slice.call(bubbles, -3).map(function (b) { return b.textContent; }); return last; })()");
  ok('收件气泡 他→她', chatRes && String(chatRes[0]).indexOf('她今天也在想你') >= 0, chatRes);
  ok('「其他」不被误替换', chatRes && String(chatRes[1]).indexOf('其他的事不管') >= 0, chatRes);
  ok('我方消息保持原话（想他了）', chatRes && String(chatRes[2]).indexOf('想他了') >= 0, chatRes);

  console.log('\n== T5 改回不设置 ==');
  await evalJs("window.xyStore('xy-home-v2:default').set('partner-gender',''); true");
  ok('恢复默认 TA', (await evalJs("window.taFit('他在那边')")) === 'TA在那边');

  console.log('\n== T7 摸鱼浮字预设池（字卡库新分类） ==');
  const pool = await evalJs("({ n10: window.getFishPool ? window.getFishPool('摸鱼浮字', []).length : -1, n6: window.getFishPool ? window.getFishPool('抓包回应', []).length : -1, hasOrigin: window.getFishPool ? window.getFishPool('摸鱼浮字', []).indexOf('ta在那边也偷了个懒') >= 0 : false })");
  // v3.23.x c9703a6 起预设字卡「他」统一改中性占位 ta，原句期望同步对齐数据
  ok('getFishPool 两分组（浮字 10 条 / 抓包 6 条）', pool && pool.n10 === 10 && pool.n6 === 6, pool);
  ok('含原句「ta在那边也偷了个懒」', pool && pool.hasOrigin, pool);
  const tab = await evalJs("(function(){ var t = document.querySelector('#fc-tabs [data-type=\"fish\"]'); if (!t) return { tab: false }; var pg = document.getElementById('page-fun-cards'); pg.hidden = false; document.getElementById('fc-tabs').querySelector('[data-type=\"fish\"]').click(); var headers = Array.prototype.map.call(document.querySelectorAll('#fc-list .ccg-name'), function (x) { return x.textContent; }); var cards = document.querySelectorAll('#fc-list .cc-item').length; return { tab: true, headers: headers, cards: cards }; })()");
  ok('「摸鱼浮字」tab 已注入且可点击', tab && tab.tab === true, tab);
  ok('渲染两组卡片共 16 张', tab && tab.headers.join(',') === '摸鱼浮字,抓包回应' && tab.cards === 16, tab && { h: tab.headers, c: tab.cards });
  const offTest = await evalJs("(function(){ var first = document.querySelector('#fc-list .cc-item .t'); if (!first) return { ok: false }; var txtNode = first.childNodes[0]; var txt = String(txtNode.textContent || '').trim(); var input = document.querySelector('#fc-list .cc-item input'); input.click(); var key = null; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k.indexOf(':dc-off-fish:' + txt) >= 0) key = k; } return { ok: true, txt: txt, saved: !!key, key: key, restored: (input.checked = true, input.dispatchEvent(new Event('change', { bubbles: true })), true) }; })()");
  ok('逐张开关写入 dc-off-fish:* 且可恢复', offTest && offTest.ok && offTest.saved && offTest.key === 'xy-home-v2:default:dc-off-fish:' + offTest.txt, offTest);
  await evalJs("document.getElementById('page-fun-cards').hidden = true; true");

  console.log('\n== T8 花园/同频/伸手/喝水/存钱罐 预设池 ==');
  const pools = await evalJs("({ tabs: ['garden','sync','reach','water','piggy'].map(function(k){ return !!document.querySelector('#fc-tabs [data-type=\"'+k+'\"]'); }).every(Boolean), g: window.getLibPool('garden','梦角悄悄话',[]).length, s: window.getLibPool('sync','TA 此刻',[]).length, r: window.getLibPool('reach','悄悄话',[]).length, w: window.getLibPool('water','提醒模板',[]).length, wt: window.getLibPool('water','TA 提醒句式',[]).length, p: window.getLibPool('piggy','存入碎碎念',[]).length })");
  ok('五个新 tab 全部注入', pools && pools.tabs === true, pools);
  ok('池数据齐全（园7/同8/伸6/水4/句式4/罐5）', pools && pools.g === 7 && pools.s === 8 && pools.r === 6 && pools.w === 4 && pools.wt === 4 && pools.p === 5, pools);
  // v3.26.x：预设字卡列表改视口虚拟窗口（DOM 只保留视口附近约 24 行，整类 36 行不再
  // 一次全渲染）→ 改为逐分组筛选累加统计（每组 ≤9 张必定落在窗口内）
  const waterTab = await evalJs(`(async function(){
    var pg = document.getElementById('page-fun-cards'); pg.hidden = false;
    document.querySelector('#fc-tabs [data-type="water"]').click();
    await new Promise(function(r){ setTimeout(r, 300); });
    var names = [].slice.call(document.querySelectorAll('#fc-groups-bar .cc-g-chip')).map(function(c){ return c.textContent; }).filter(function(n){ return n !== '全部'; });
    var out = {};
    for (var i = 0; i < names.length; i++) {
      var chip = [].slice.call(document.querySelectorAll('#fc-groups-bar .cc-g-chip')).find(function(c){ return c.textContent === names[i]; });
      chip.click();
      await new Promise(function(r){ setTimeout(r, 250); });
      var hs = [].slice.call(document.querySelectorAll('#fc-list .cc-group-header .ccg-name')).map(function(x){ return x.textContent; });
      out[names[i]] = { rendered: document.querySelectorAll('#fc-list .cc-item').length, head: hs.join(',') };
    }
    var all = [].slice.call(document.querySelectorAll('#fc-groups-bar .cc-g-chip')).find(function(c){ return c.textContent === '全部'; });
    if (all) all.click();
    pg.hidden = true;
    return { groups: Object.keys(out).join(','), sum: Object.keys(out).reduce(function(s, k){ return s + out[k].rendered; }, 0), detail: out };
  })()`);
  ok('喝水 tab 6 组共 30 张（逐组筛选累加，虚拟窗口下 DOM 只保留视口附近行）',
    waterTab && waterTab.groups === '提醒模板,TA 提醒句式,ta视角温柔提醒,喝够夸奖,继续鼓励,梦角催喝水' && waterTab.sum === 30 &&
    Object.keys(waterTab.detail).every(function (k) { return waterTab.detail[k].head === k; }), waterTab);

  console.log('\n== T6 无 JS 异常 ==');
  ok('加载与操作全程无未捕获异常', jsErrors.length === 0, jsErrors.slice(0, 3));

  console.log('\n结果: ' + pass + '/' + (pass + fail) + ' 项通过');
  process.exitCode = fail ? 1 : 0;
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
