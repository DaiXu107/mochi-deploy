// ===== 回归验证（#572d）：点【撤回了一条消息】查看原文＝「就地展开 / 再点收回」 =====
// 用户最终确认要的就是这个模式：「点一下那条消息在聊天流里变回原文、再点变回提示」。中途做过的
// 浮层版（#572b/#572c）已撤销（浮层再像也是弹窗，不是「消息在聊天流里变回原文」）。本脚本锁住这套
// 交互与两条不给退的边界：
//   ① 展开/收回必须可逆——往返后气泡高度、列表 scrollHeight/scrollTop 回到原值（无残留漂移）；
//   ② 无快照（rec.orig）的存量老消息展开时**不得直出 rec.text**——那是「点开整屏 base64」的来源
//      （旧实现 rec.orig || rec.text；语音那条实测气泡 45px→1599px、列表 1492→3038），必须走安全兜底
//      （图片给 <img>、语音给名称、文本转义），口径同群聊 #244。
// 注：就地展开会让气泡当场变高、列表被推动（下面消息下移 dH，开内核滚动锚定时改成上面上移 dH）——
// 这是该模式自带语义、不是回归，用户明确要它，所以本脚本**不**断言「列表零位移」。
// 用法：node tools/verify-recall-view.mjs  （BROWSER=webkit 可选；VERIFY_ROOT=目录 指向隔离构建）
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = process.env.VERIFY_ROOT ? normalize(process.env.VERIFY_ROOT) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

const results = [];
let skipped = 0;
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
function skip(desc, why) { skipped++; console.log('SKIP  ' + desc + '  [' + why + ']'); }

const engine = process.env.BROWSER || 'chromium';
const { chromium, webkit } = await import('playwright');
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

const MARK = '围巾';
const LONG_ORIG = '今天降温了记得多穿一件外套，我把' + MARK + '洗好放在门口了，出门别忘带伞。再冷也要记得吃早饭。';
const QUOTE_ORIG = '<div class="msg-quote"><span class="msg-quote-text">被引用的原话</span></div><span style="opacity:.85">我把' + MARK + '洗好放门口了</span>';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const TOTAL = 8;
const RECALL_IDX = 3;       // 有快照（纯文本原文）
const RECALL_IDX_2 = 4;     // 有快照（带引用块 HTML）
const NO_SNAP_IDX = 5;      // 无快照的存量老消息（text 就是 dataURL —— 旧实现点开会直出整屏 base64）

function seedMsgs(group) {
  const msgs = [];
  for (let i = 0; i < TOTAL; i++) msgs.push(group
    ? { side: i % 2 ? 'in' : 'out', text: '群消息 ' + i, ts: Date.now() - (TOTAL - i) * 60000, cid: 'c1' }
    : { side: i % 2 ? 'in' : 'out', text: '测试消息 ' + i, ts: Date.now() - (TOTAL - i) * 60000, initiative: i % 2 === 1 });
  const base = group ? { cid: 'c1' } : { initiative: true };
  msgs[RECALL_IDX] = Object.assign({ side: 'in', text: LONG_ORIG, ts: Date.now() - 5 * 60000, retracted: true, orig: LONG_ORIG }, base);
  msgs[RECALL_IDX_2] = Object.assign({ side: 'in', text: '带引用的原文', ts: Date.now() - 4 * 60000, retracted: true, orig: QUOTE_ORIG }, base);
  msgs[NO_SNAP_IDX] = Object.assign({ side: 'in', text: PNG, type: 'image', ts: Date.now() - 3 * 60000, retracted: true }, base); // 无 orig
  return msgs;
}

async function clearOverlays() {
  await page.evaluate(`(function(){
    var s = document.getElementById('splash');
    if (s) { s.classList.add('hide'); s.style.display = 'none'; s.style.pointerEvents = 'none'; }
    var b = document.getElementById('splash-box'); if (b) b.style.display = 'none';
    ['modal-mask', 'applock-mask'].forEach(function (id) { var m = document.getElementById(id); if (m) { m.hidden = true; } });
    return true;
  })()`);
  await sleep(120);
}
async function boot(entries) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 25000 });
  for (let i = 0; i < 50; i++) { if (await page.evaluate('!!window.__mochiDataReady')) break; await sleep(300); }
  await page.evaluate(`(async function(){
    for (const it of ${JSON.stringify(entries)}) {
      const raw = JSON.stringify(it.arr);
      if (window.idbSet) { try { await window.idbSet(it.key, raw); } catch (e) {} }
      try { localStorage.setItem(it.key, raw); } catch (e) {}
    }
    // 关掉「联系人主动发消息」与撤回掷签，免得后台插消息干扰量测
    try { localStorage.setItem('xy-home-v2:reply-as-en', '0'); } catch (e) {}
    try { localStorage.setItem('xy-home-v2:reply-rc-en', '0'); } catch (e) {}
    try { if (window.idbSet) { await window.idbSet('xy-home-v2:reply-as-en', '0'); await window.idbSet('xy-home-v2:reply-rc-en', '0'); } } catch (e) {}
    return true;
  })()`);
  await sleep(600);
  await page.reload({ waitUntil: 'load', timeout: 25000 });
  for (let i = 0; i < 50; i++) { if (await page.evaluate('!!window.__mochiDataReady')) break; await sleep(300); }
  await clearOverlays();
}
// 单聊种子走产品自己的整包替换入口（同 data-backup 导入）：直接写 LS/IDB 会跟「防抖落盘 / LS 快照 +
// IDB 权威合并 / 账本」抢时序，实测偶发首屏只渲出几条＝假红
async function seedViaImport(arr) {
  const r = await page.evaluate(`(function(){ try { return window.chatImportMsgs ? String(window.chatImportMsgs(${JSON.stringify(arr)})) : 'no-api'; } catch (e) { return 'err:' + e.message; } })()`);
  await sleep(800);
  return r;
}
function bubbleFn(container, idxAttr, idx) {
  return `(function(){
    var el = document.querySelector('${container} .msg[data-${idxAttr}="${idx}"]');
    var b = el && el.querySelector('.msg-bubble');
    var c = document.querySelector('${container}');
    if (!b) return 'null';
    return JSON.stringify({ html: b.innerHTML, text: b.textContent, showing: b.dataset.showing || '0',
      h: Math.round(b.getBoundingClientRect().height),
      scrollTop: Math.round(c.scrollTop), scrollHeight: Math.round(c.scrollHeight),
      x: Math.round(b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2),
      y: Math.round(b.getBoundingClientRect().top + b.getBoundingClientRect().height / 2),
      inView: (b.getBoundingClientRect().top > 0 && b.getBoundingClientRect().bottom < window.innerHeight) });
  })()`;
}
async function tapBubble(container, idxAttr, idx) {
  await clearOverlays();
  try {
    await page.locator(`${container} .msg[data-${idxAttr}="${idx}"] .msg-bubble`).first().tap({ timeout: 5000 });
  } catch (e) {
    await clearOverlays();
    await page.evaluate(`(function(){
      var b = document.querySelector('${container} .msg[data-${idxAttr}="${idx}"] .msg-bubble');
      if (b) b.click();
      return true;
    })()`);
  }
  await sleep(350);
}
async function waitBubble(container, idxAttr, idx, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 12000)) {
    const raw = await page.evaluate(bubbleFn(container, idxAttr, idx));
    if (raw && raw !== 'null') {
      const o = JSON.parse(raw);
      if (o && o.inView) return o;
    }
    await sleep(400);
  }
  return null;
}

async function runCase(label, container, idxAttr, group, openFn, waitMs) {
  const seed = seedMsgs(group);
  await boot([{ key: group ? 'xy-home-v2:group-chat-msgs' : 'xy-home-v2:chat-msgs', arr: seed }]);
  await page.evaluate(openFn);
  await sleep(waitMs);
  if (!group) await seedViaImport(seed); // 群聊没有对应导入入口，走存储播种（该页渲染稳定）
  await clearOverlays();
  await page.evaluate(`(function(){var b=document.getElementById('${container.slice(1)}'); b.scrollTop = b.scrollHeight; return true;})()`);
  await sleep(300);

  let before = await waitBubble(container, idxAttr, RECALL_IDX, 12000);
  if (!before) {
    await page.reload({ waitUntil: 'load', timeout: 25000 });
    for (let i = 0; i < 50; i++) { if (await page.evaluate('!!window.__mochiDataReady')) break; await sleep(300); }
    await clearOverlays();
    await page.evaluate(openFn);
    await sleep(waitMs);
    if (!group) await seedViaImport(seed);
    await clearOverlays();
    await page.evaluate(`(function(){var b=document.getElementById('${container.slice(1)}'); b.scrollTop = b.scrollHeight; return true;})()`);
    await sleep(300);
    before = await waitBubble(container, idxAttr, RECALL_IDX, 12000);
  }
  check(label + ' T0 撤回提示渲染且在视口内', !!before, before ? ('初始 ' + before.h + 'px') : 'no-bubble');
  if (!before) return;

  // ---- T1 点开＝就地展开成原文快照 ----
  await tapBubble(container, idxAttr, RECALL_IDX);
  const open = JSON.parse(await page.evaluate(bubbleFn(container, idxAttr, RECALL_IDX)));
  check(label + ' T1 点开就地展开成原文（同一份快照，逐字节一致）',
    open.showing === '1' && open.html === LONG_ORIG,
    'showing=' + open.showing + ' 与快照一致=' + (open.html === LONG_ORIG));
  check(label + ' T2 展开后气泡变高、提示文案消失', open.h > before.h + 4 && open.text.indexOf('撤回了一条消息') < 0,
    before.h + 'px → ' + open.h + 'px');

  // ---- T3 再点收回＝回到提示，且往返可逆（无残留漂移）----
  await tapBubble(container, idxAttr, RECALL_IDX);
  const closed = JSON.parse(await page.evaluate(bubbleFn(container, idxAttr, RECALL_IDX)));
  check(label + ' T3 再点收回＝回到「撤回了一条消息」且高度复原',
    closed.showing !== '1' && closed.text.indexOf('撤回了一条消息') >= 0 && Math.abs(closed.h - before.h) <= 2,
    closed.h + 'px（初始 ' + before.h + 'px）');
  check(label + ' T4 往返后列表滚动状态无残留漂移',
    Math.abs(closed.scrollHeight - before.scrollHeight) <= 2 && Math.abs(closed.scrollTop - before.scrollTop) <= 2,
    'scrollHeight ' + before.scrollHeight + '→' + closed.scrollHeight + ' / scrollTop ' + before.scrollTop + '→' + closed.scrollTop);

  // ---- T5 带 HTML 的原文快照（引用块）照旧原样渲染 ----
  await page.evaluate(`(function(){var b=document.querySelector('${container} .msg[data-${idxAttr}="${RECALL_IDX_2}"] .msg-bubble'); if(b) b.click(); return true;})()`);
  await sleep(300);
  const q = JSON.parse(await page.evaluate(`(function(){
    var b = document.querySelector('${container} .msg[data-${idxAttr}="${RECALL_IDX_2}"] .msg-bubble');
    return JSON.stringify({ showing: b.dataset.showing || '0', hasQuote: !!b.querySelector('.msg-quote'), html: b.innerHTML });
  })()`));
  check(label + ' T5 带引用块的原文快照原样展开', q.showing === '1' && q.hasQuote === true && q.html === QUOTE_ORIG,
    'showing=' + q.showing + ' 引用块=' + q.hasQuote);
  await page.evaluate(`(function(){var b=document.querySelector('${container} .msg[data-${idxAttr}="${RECALL_IDX_2}"] .msg-bubble'); if(b) b.click(); return true;})()`);
  await sleep(200);

  // ---- T6 无快照的存量老消息：不得直出 base64（安全兜底） ----
  await tapBubble(container, idxAttr, NO_SNAP_IDX);
  const noSnap = JSON.parse(await page.evaluate(`(function(){
    var b = document.querySelector('${container} .msg[data-${idxAttr}="${NO_SNAP_IDX}"] .msg-bubble');
    return JSON.stringify({ showing: b.dataset.showing || '0', text: b.textContent, img: !!b.querySelector('img'),
      htmlLen: b.innerHTML.length, h: Math.round(b.getBoundingClientRect().height) });
  })()`));
  const dump = noSnap.text.indexOf('base64') >= 0 || noSnap.htmlLen > 4000;
  check(label + ' T6 无快照老消息展开不直出 base64/长文本（走安全兜底）', noSnap.showing === '1' && !dump,
    '文本含 base64=' + (noSnap.text.indexOf('base64') >= 0) + ' innerHTML=' + noSnap.htmlLen + 'B 高=' + noSnap.h + 'px 图=' + noSnap.img);
}

await runCase('单聊', '#chat-body', 'idx', false,
  "(function(){if(window.enterChat) window.enterChat();document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()", 1400);

await runCase('群聊', '#gc-body', 'gc-idx', true,
  "(function(){var app=document.querySelector('.app[data-app=\"group-chat\"]');if(app)app.click();return true;})()", 2200);

check('无 JS 报错', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

const pass = results.filter((r) => r.ok).length;
console.log('\n结果: ' + pass + '/' + results.length + ' 通过' + (skipped ? '，' + skipped + ' 项环境不满足' : ''));
await browser.close();
server.close();
process.exit(pass === results.length ? 0 : 1);
