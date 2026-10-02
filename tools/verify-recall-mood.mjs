// ===== 回归验证（#572e）：点开撤回消息查看原文——原文内容与「情绪字卡 tag」都要正常显示 =====
// 背景：撤回消息点开是「就地展开 rec.orig 快照」（快照＝撤回瞬间气泡的 innerHTML，情绪块 .msg-moods
// 就在其中，所以 tag 随快照一起回来）。但**无快照的存量老消息**走 #572d 的安全兜底（旧口径只给文本），
// 那一路会把 tag 丢掉；#572e 起兜底也按 renderMsg 同款标记渲染情绪块（并跳过 rec.retractedMood 里
// 已被撤回的条目）。本脚本同时锁两条路径 + 部分撤回的 tag 过滤。
// 断言口径：展开后 tag chip（.msg-mood-tag）必须存在、文本正确、且**真的可见**（有尺寸/未被 CSS 藏住）；
// 被撤回的 tag 不得出现。单聊 + 群聊各跑一遍。
// 用法：node tools/verify-recall-mood.mjs  （BROWSER=webkit 可选；VERIFY_ROOT=目录 指向隔离构建）
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
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

const engine = process.env.BROWSER || 'chromium';
const { chromium, webkit } = await import('playwright');
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

const BODY = '今天降温了记得多穿一件外套';
const TAG = '关心';
const LABEL = '我把围巾洗好放门口了';
const TAG2 = '心意';
const TAG_RETRACTED = '摸鱼抓包'; // 这条 tag 会被标记为「已撤回」，展开时不得出现
const TOTAL = 8;
const SNAP_GONE = 0;   // 有快照（正常路径：快照里带情绪块）
const SNAP_NONE = 1;   // 无快照（存量老消息：走安全兜底）
const SNAP_PART = 2;   // 无快照 + 部分 tag 已撤回

function seedBase(group, i) {
  return group
    ? { side: i % 2 ? 'in' : 'out', text: '群消息 ' + i, ts: Date.now() - (TOTAL - i) * 60000, cid: 'c1' }
    : { side: i % 2 ? 'in' : 'out', text: '测试消息 ' + i, ts: Date.now() - (TOTAL - i) * 60000, initiative: i % 2 === 1 };
}
function seedMsgs(group, snapForFirst) {
  const msgs = [];
  for (let i = 0; i < TOTAL; i++) msgs.push(seedBase(group, i));
  const base = group ? { cid: 'c1' } : { initiative: true };
  const MOODS = [{ tag: TAG, label: LABEL }, { tag: TAG2, label: '想你了' }];
  // ① 有快照：撤回时存的快照里带情绪块（第一次导入时先按未撤回渲染，取真实快照喂回来）
  msgs[SNAP_GONE] = Object.assign({ side: 'in', text: BODY, ts: Date.now() - 6 * 60000, mood: MOODS, retracted: true,
    orig: snapForFirst || '<span style="opacity:.85">' + BODY + '</span>' }, base);
  // ② 无快照（存量老消息）：不得丢 tag
  msgs[SNAP_NONE] = Object.assign({ side: 'in', text: BODY, ts: Date.now() - 5 * 60000, mood: MOODS, retracted: true }, base);
  // ③ 无快照 + 部分 tag 已撤回（retractedMood[0] 对应 TAG/TAG_RETRACTED）
  msgs[SNAP_PART] = Object.assign({ side: 'in', text: BODY, ts: Date.now() - 4 * 60000,
    mood: [{ tag: TAG_RETRACTED, label: '被抓到了' }, { tag: TAG2, label: '想你了' }], retractedMood: [0], retracted: true }, base);
  return msgs;
}

async function clearOverlays() {
  await page.evaluate(`(function(){
    var s = document.getElementById('splash');
    if (s) { s.classList.add('hide'); s.style.display = 'none'; s.style.pointerEvents = 'none'; }
    var b = document.getElementById('splash-box'); if (b) b.style.display = 'none';
    ['modal-mask', 'applock-mask'].forEach(function (id) { var m = document.getElementById(id); if (m) m.hidden = true; });
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
async function seedViaImport(arr) {
  const r = await page.evaluate(`(function(){ try { return window.chatImportMsgs ? String(window.chatImportMsgs(${JSON.stringify(arr)})) : 'no-api'; } catch (e) { return 'err:' + e.message; } })()`);
  await sleep(800);
  return r;
}
async function waitBubble(container, idxAttr, idx, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 12000)) {
    const raw = await page.evaluate(`(function(){
      var b = document.querySelector('${container} .msg[data-${idxAttr}="${idx}"] .msg-bubble');
      if (!b) return 'null';
      var r = b.getBoundingClientRect();
      return JSON.stringify({ inView: r.top > 0 && r.bottom < window.innerHeight, h: Math.round(r.height) });
    })()`);
    if (raw && raw !== 'null' && JSON.parse(raw).inView) return JSON.parse(raw);
    await sleep(400);
  }
  return null;
}
// 读一条气泡展开后的内容与 tag 明细（含"是否真的可见"）
function probeFn(container, idxAttr, idx) {
  return `(function(){
    var b = document.querySelector('${container} .msg[data-${idxAttr}="${idx}"] .msg-bubble');
    if (!b) return 'null';
    var tags = Array.from(b.querySelectorAll('.msg-mood-tag')).map(function(t){
      var r = t.getBoundingClientRect();
      var cs = getComputedStyle(t);
      return { text: t.textContent, visible: (r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0') };
    });
    var moods = b.querySelector('.msg-moods');
    var mr = moods ? moods.getBoundingClientRect() : null;
    return JSON.stringify({ showing: b.dataset.showing || '0', text: b.textContent,
      tags: tags, moodBlockVisible: !!(mr && mr.width > 0 && mr.height > 0),
      labels: Array.from(b.querySelectorAll('.msg-mood > span:not(.msg-mood-tag)')).map(function(s){ return s.textContent; }),
      h: Math.round(b.getBoundingClientRect().height) });
  })()`;
}
async function tapBubble(container, idxAttr, idx) {
  await clearOverlays();
  try {
    await page.locator(`${container} .msg[data-${idxAttr}="${idx}"] .msg-bubble`).first().tap({ timeout: 5000 });
  } catch (e) {
    await clearOverlays();
    await page.evaluate(`(function(){ var b = document.querySelector('${container} .msg[data-${idxAttr}="${idx}"] .msg-bubble'); if (b) b.click(); return true; })()`);
  }
  await sleep(350);
}

async function runCase(label, container, idxAttr, group, openFn, waitMs) {
  // —— 先用「未撤回」渲染一次，取 app 自己产出的真实快照（含情绪块），再喂回撤回记录 ——
  const draft = seedMsgs(group, null).map(m => Object.assign({}, m, { retracted: false, orig: undefined }));
  await boot([{ key: group ? 'xy-home-v2:group-chat-msgs' : 'xy-home-v2:chat-msgs', arr: draft }]);
  await page.evaluate(openFn);
  await sleep(waitMs);
  if (!group) await seedViaImport(draft);
  await clearOverlays();
  const realSnap = await page.evaluate(`(function(){
    var b = document.querySelector('${container} .msg[data-${idxAttr}="${SNAP_GONE}"] .msg-bubble');
    return b ? b.innerHTML : null;
  })()`);
  check(label + ' T0 未撤回时情绪 tag 正常渲染（快照取样前提）',
    !!realSnap && realSnap.indexOf(TAG) >= 0 && realSnap.indexOf('msg-mood-tag') >= 0,
    realSnap ? ('快照 ' + realSnap.length + 'B') : 'no-bubble');

  // —— 换成「已撤回」的记录（①带真实快照 ②无快照 ③无快照+部分 tag 已撤回）——
  const seeded = seedMsgs(group, realSnap);
  await boot([{ key: group ? 'xy-home-v2:group-chat-msgs' : 'xy-home-v2:chat-msgs', arr: seeded }]);
  await page.evaluate(openFn);
  await sleep(waitMs);
  if (!group) await seedViaImport(seeded);
  await clearOverlays();
  await page.evaluate(`(function(){var b=document.getElementById('${container.slice(1)}'); b.scrollTop = b.scrollHeight; return true;})()`);
  await sleep(300);

  const ready = await waitBubble(container, idxAttr, SNAP_GONE, 12000);
  check(label + ' T1 撤回提示渲染且在视口内', !!ready, ready ? ('初始 ' + ready.h + 'px') : 'no-bubble');
  if (!ready) return;

  // ① 有快照：内容 + tag + 文案都要回来
  await tapBubble(container, idxAttr, SNAP_GONE);
  const a = JSON.parse(await page.evaluate(probeFn(container, idxAttr, SNAP_GONE)));
  check(label + ' T2 有快照：展开后原文正文正常显示', a.showing === '1' && a.text.indexOf(BODY) >= 0, (a.text || '').slice(0, 20));
  check(label + ' T3 有快照：tag 正常显示（文本正确且可见）',
    a.tags.length >= 2 && a.tags.some(t => t.text === TAG && t.visible) && a.tags.some(t => t.text === TAG2 && t.visible),
    JSON.stringify(a.tags));
  check(label + ' T4 有快照：tag 的说明文案也在', a.labels.some(s => s.indexOf(LABEL) >= 0 || s.indexOf('门口') >= 0), JSON.stringify(a.labels));
  check(label + ' T5 有快照：情绪块整体可见（未被 CSS 藏住）', a.moodBlockVisible === true, 'visible=' + a.moodBlockVisible);
  await tapBubble(container, idxAttr, SNAP_GONE);
  const back = JSON.parse(await page.evaluate(probeFn(container, idxAttr, SNAP_GONE)));
  check(label + ' T6 收回＝回到撤回提示', back.showing !== '1' && back.text.indexOf('撤回了一条消息') >= 0, (back.text || '').slice(0, 14));

  // ② 无快照（存量老消息）：#572e 起兜底也要给 tag
  await tapBubble(container, idxAttr, SNAP_NONE);
  const b2 = JSON.parse(await page.evaluate(probeFn(container, idxAttr, SNAP_NONE)));
  check(label + ' T7 无快照：展开后原文正文正常显示（安全兜底）', b2.showing === '1' && b2.text.indexOf(BODY) >= 0, (b2.text || '').slice(0, 20));
  check(label + ' T8 无快照：tag 不丢失（#572e）',
    b2.tags.length >= 2 && b2.tags.some(t => t.text === TAG && t.visible) && b2.tags.some(t => t.text === TAG2 && t.visible),
    JSON.stringify(b2.tags));
  await tapBubble(container, idxAttr, SNAP_NONE);

  // ③ 无快照 + 部分 tag 已撤回：被撤的那条不得出现，其余照常
  await tapBubble(container, idxAttr, SNAP_PART);
  const b3 = JSON.parse(await page.evaluate(probeFn(container, idxAttr, SNAP_PART)));
  check(label + ' T9 已撤回的 tag 不得出现（retractedMood 过滤）',
    b3.showing === '1' && !b3.tags.some(t => t.text === TAG_RETRACTED) && b3.tags.some(t => t.text === TAG2 && t.visible),
    JSON.stringify(b3.tags));
  await tapBubble(container, idxAttr, SNAP_PART);
}

await runCase('单聊', '#chat-body', 'idx', false,
  "(function(){if(window.enterChat) window.enterChat();document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()", 1400);

await runCase('群聊', '#gc-body', 'gc-idx', true,
  "(function(){var app=document.querySelector('.app[data-app=\"group-chat\"]');if(app)app.click();return true;})()", 2200);

check('无 JS 报错', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

const pass = results.filter((r) => r.ok).length;
console.log('\n结果: ' + pass + '/' + results.length + ' 通过');
await browser.close();
server.close();
process.exit(pass === results.length ? 0 : 1);
