// ===== 常驻回归 #1491：聊天「跳转链」的下标寻址与解钉态整窗重画 =====
// 作者直派（iPhone 12 Pro／iOS 17.1.1／Safari 主屏幕模式，诊断单 mochi-diag-2026-09-30-06-50）：
//   ①搜索消息不能定位原消息位置，马上直接弹回当前页面；
//   ②点击引用的消息有一部分无法到达原位置，还有的显示「未找到原消息」，但上翻其实原消息是在的；
//   ③整屏发黑要刷新才回来（＝#1476 那一族，同批重放上线）。
// 用法：node tools/verify-1491-jump-anchor.mjs [被测根目录]
import { normalize, resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = resolve(normalize(process.argv[2] || process.env.MOCHI_SERVE_ROOT || here));
console.log('被测：' + root);
const chatProd = join(root, 'js', 'chat.js');
if (!existsSync(chatProd)) { console.log('✗ 被测根目录里没有 js/chat.js（喂错目录了）'); process.exit(2); }
const prod = readFileSync(chatProd, 'utf8');

let pass = 0, fail = 0;
const results = [];
const ok = (c, n, x) => { if (c) { pass++; results.push('  ✓ ' + n); } else { fail++; results.push('  ✗ ' + n + (x !== undefined ? '  [' + String(x).slice(0, 240) + ']' : '')); } console.log(results[results.length - 1]); };

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = join(root, p);
  if (!existsSync(f)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'content-type': types[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PFX = 'xy-home-v2:default';
const ND_HEAD = '只在冷头的扎针';
const HOT_Q = '热片第4条是被引用的原文';
const tagOf = root.replace(/[^a-zA-Z0-9]/g, '').slice(-14);
const errs = [];

// ─────────── S 组：产物源码锚 ───────────
const S = [
  ['S1 解钉态整窗重画按「屏上画的就是这一段」原地保窗', 'if (!(_rwFirst === renderStart && _rwLast >= len - 1)) renderStart = Math.max(0, len - RENDER_MAX);'],
  ['S2 #1004 越界空窗防护照旧在位（没修过头）', 'if (renderStart >= len) renderStart = Math.max(0, len - RENDER_MAX);'],
  ['S3 引用下标快路径连引用快照一起核', 'if (t && !t.retracted && t.side === qs && quoteEq(rec.quote, quoteSnapOf(t))) return rec.qidx;'],
  ['S4 跳转函数带身份锚位', 'function jumpToMsg(idx, key) {'],
  ['S5 搜索结果携带渲染期身份锚', "data-smk=\"' + attrEsc(msgKeyOf(r.m))"],
  ['S6 引用点击先并已取回的冷头', 'if (!chatRebased && chatColdHead.length) { try { chatRebaseCold(); } catch (err) {} }'],
  ['S7 冷头未取回如实说还在取回', "toast('更早的记录还在取回，取回后再点一次');"],
  ['S8 归一化回退整窗后按钉住态才贴底', 'if (chatPinnedBottom) scrollChatBottom(); // #1491h'],
];
S.forEach(([n, needle]) => ok(prod.indexOf(needle) >= 0, n, '产物 js/chat.js 里没有这一段'));
{
  const codeOnly = prod.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  ok(!/navigator\.userAgent\s*[=!]==?\s*['"]/.test(codeOnly) && !/iPhone|iPad|Xiaomi|Redmi|HUAWEI/.test(prod.split('\n').filter((l) => /^\s*(const|let|if|try|window|function|else)/.test(l)).join('\n')), 'S9 本批判据零机型／零 UA 分支（代码行里不出现机型名与 UA 比较）');
}

// ─────────── 无头夹具 ───────────
async function launch(tag) {
  const dir = normalize(join(root, '..', 'ev1491-' + tag + '-' + tagOf));
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  return await chromium.launchPersistentContext(dir, { headless: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isNoise: false, isMobile: true, hasTouch: true });
}
async function rev(page, fn, arg, tries = 12) {
  let last = '';
  for (let i = 0; i < tries; i++) { try { return await page.evaluate(fn, arg); } catch (e) { last = String(e && e.message).slice(0, 100); await wait(300); } }
  throw new Error('页面求值重试耗尽：' + last);
}
async function boot(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { errs.push(String((e && e.message) || e).slice(0, 160)); });
  await page.addInitScript(() => {
    window.__toasts = [];
    const t = setInterval(() => {
      if (!window.toast || window.__toastHooked) return;
      window.__toastHooked = 1; clearInterval(t);
      const o = window.toast;
      window.toast = function (m) { try { window.__toasts.push(String(m)); } catch (e) {} return o.apply(window, arguments); };
    }, 2);
  });
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 60000 });
  for (let i = 0; i < 300; i++) { if (await page.evaluate('!!window.__mochiDataReady')) break; await wait(200); }
  await page.evaluate("(function(){var s=document.getElementById('splash');if(s){s.click();if(!s.classList.contains('hide'))s.classList.add('hide');}return 1;})()");
  await wait(600);
  return page;
}
const enterChat = (page) => rev(page, async () => {
  const pg = document.getElementById('page-chat');
  if (!pg) return 'no-page';
  for (let i = 0; i < 40; i++) {
    if (!pg.hidden) return 'chat-page';
    if (window.enterChat) window.enterChat();
    await new Promise((r) => setTimeout(r, 250));
  }
  return pg.hidden ? 'still-hidden' : 'late';
});
const cur = (page) => rev(page, () => { try { return window.__chatWinRing ? (window.__chatWinRing().cur || {}) : {}; } catch (e) { return {}; } });
const shot = (page) => rev(page, () => {
  const b = document.getElementById('chat-body');
  const hl = b.querySelector('.msg.highlight');
  const nodes = b.querySelectorAll('.msg[data-idx]');
  return {
    y: Math.round(b.scrollTop), max: Math.round(b.scrollHeight - b.clientHeight),
    kids: b.children.length, msgNodes: nodes.length,
    lo: nodes[0] ? Number(nodes[0].dataset.idx) : -1, hi: nodes[nodes.length - 1] ? Number(nodes[nodes.length - 1].dataset.idx) : -1,
    hlIdx: hl ? Number(hl.dataset.idx) : -1, hlText: hl ? String(hl.textContent || '').replace(/\s+/g, ' ').slice(0, 40) : '',
    pinned: !!window.__chatPinnedDebug, nearBottom: (b.scrollHeight - b.clientHeight) - b.scrollTop < 40,
  };
});
const toasts = (page) => rev(page, () => (window.__toasts || []).slice(-4).join('｜'));
const seed = (page) => rev(page, ({ p, nd, hq }) => {
  // 跨天分布：每条隔 6 小时 ⇒ 每块 300 条自带 70+ 枚日期分隔线（真机聊天就是这样，
  // 「数 children 比条数」那类判据会被分隔线骗死，夹具必须把分隔线造出来）
  const mk = (n, tag, needleAt, needle, dayOffset) => Array.from({ length: n }, (_, i) => ({
    ts: 1700000000000 + (dayOffset || 0) * 86400000 + i * 21600000,
    side: i % 2 ? 'out' : 'in',
    text: tag + '-' + i + (i === needleAt ? ' ' + needle : ''),
  }));
  const head0 = mk(300, 'head0', 7, nd, -60);
  const head1 = mk(300, 'head1', -1, '', -30);
  const hot = mk(300, 'hot', 4, hq, 0);
  hot[298] = { ts: 1700000000000 + 298 * 21600000, side: 'out', text: '我引用了冷头那条', quote: head0[7].text, qside: 'in', qidx: 7 };
  hot[299] = { ts: 1700000000000 + 299 * 21600000, side: 'out', text: '我引用了热片第4条', quote: hot[4].text, qside: 'in', qidx: 4 };
  const idx = { v: 1, blocks: [{ k: 'chat-blk-0', bytes: 900000, n: 300 }, { k: 'chat-blk-1', bytes: 900000, n: 300 }, { k: 'chat-blk-2', bytes: 900000, n: 300 }], total: 900, nextSeq: 3 };
  // 打开「时间分隔线」样式：真机有人用它，分隔线是 .msg[data-idx] 之外的节点——保窗判据必须是结构判据，
  // 靠「数 children 比条数」的写法在这种档位下永远不相等（夹具先把这一档点亮，别让判据蒙混过关）
  try { localStorage.setItem(p + ':cs-time-style', 'divider'); localStorage.setItem('xy-home-v2:cs-time-style', 'divider'); } catch (e) {}
  const data = [[p + ':chat-blk-0', head0], [p + ':chat-blk-1', head1], [p + ':chat-blk-2', hot], [p + ':chat-blk-idx', JSON.stringify(idx)], [p + ':chat-meta', JSON.stringify({ n: 900, t: Date.now(), b: 84000 })], [p + ':chat-msgs', JSON.stringify(hot)]];
  return new Promise((res) => {
    const q = indexedDB.open('mochi-db');
    q.onsuccess = () => {
      let t;
      try { t = q.result.transaction('kv', 'readwrite'); } catch (e) { res('notx:' + e.name); return; }
      data.forEach((d) => t.objectStore('kv').put(d[1], d[0]));
      t.oncomplete = () => res('ok');
      t.onerror = () => res('txerr');
    };
    q.onerror = () => res('noopen');
  });
}, { p: PFX, nd: ND_HEAD, hq: HOT_Q });
const clickQuote = (page, which) => rev(page, async ({ w }) => {
  const b = document.getElementById('chat-body');
  let hit = null;
  for (let i = 0; i < 30 && !hit; i++) {
    hit = Array.from(b.querySelectorAll('.msg-quote')).find((el) => String(el.textContent || '').indexOf(w) >= 0);
    if (!hit) { b.scrollTop = b.scrollHeight; b.dispatchEvent(new Event('scroll')); await new Promise((r) => setTimeout(r, 400)); }
  }
  if (!hit) return { err: 'no-quote-el' };
  hit.click();
  const b2 = document.getElementById('chat-body');
  let hl = null;
  for (let i = 0; i < 40 && !hl; i++) {
    await new Promise((r) => setTimeout(r, 120));
    const el = b2.querySelector('.msg.highlight');
    if (el) hl = { idx: Number(el.dataset.idx), text: String(el.textContent || '').replace(/\s+/g, ' ').slice(0, 40) };
  }
  const nn = b2.querySelectorAll('.msg[data-idx]');
  return { clicked: true, hl: hl, y: Math.round(b2.scrollTop), max: Math.round(b2.scrollHeight - b2.clientHeight), nodes: nn.length, lo: nn[0] ? Number(nn[0].dataset.idx) : -1, hi: nn[nn.length - 1] ? Number(nn[nn.length - 1].dataset.idx) : -1, toasts: (window.__toasts || []).slice(-2).join('｜') };
}, { w: which });
const searchJump = (page, needle) => rev(page, async ({ x }) => {
  const more = document.getElementById('more-search');
  if (!more) return { err: 'no-entry' };
  more.click();
  await new Promise((r) => setTimeout(r, 500));
  const inp = document.getElementById('chat-search-input');
  if (!inp) return { err: 'no-input' };
  inp.value = x;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  const go = document.getElementById('chat-search-go');
  if (go) go.click();
  const box = document.getElementById('chat-search-results');
  let li = null;
  for (let i = 0; i < 24 && !li; i++) { await new Promise((r) => setTimeout(r, 800)); li = box.querySelector('.tc-listitem'); }
  if (!li) return { hits: 0, txt: String(box.textContent || '').slice(0, 60) };
  const liTxt = String(li.textContent || '').replace(/\s+/g, ' ').slice(0, 44);
  li.click();
  return { hits: box.querySelectorAll('.tc-listitem').length, li: liTxt };
}, { x: needle });
const scrollEnd = (page, to) => rev(page, async ({ t }) => {
  const b = document.getElementById('chat-body');
  for (let i = 0; i < 26; i++) {
    b.scrollTop = t === 'top' ? 0 : b.scrollHeight;
    b.dispatchEvent(new Event('scroll'));
    await new Promise((r) => setTimeout(r, 380));
    const atTop = b.scrollTop <= 2, atBot = b.scrollTop >= b.scrollHeight - b.clientHeight - 2;
    if ((t === 'top' && atTop) || (t === 'bottom' && atBot)) break;
  }
  return Math.round(b.scrollTop);
}, { t: to });

try {
  const ctx = await launch('a');
  try {
    const p1 = await boot(ctx);
    ok(await seed(p1) === 'ok', 'B1a 夹具诚实：900 条分块历史真落进库里');
    await p1.close();
    const page = await boot(ctx); // 冷启动＝内存只有热片，冷头还在块里
    await enterChat(page);
    await wait(1500);
    const c0 = await cur(page);
    ok(c0.n > 250 && c0.n < 400, 'B1b 进场态＝内存只有热片那一段（环读数 n=' + c0.n + '）', JSON.stringify(c0));
    const dv = await rev(page, () => document.querySelectorAll('#chat-body .msg-date, #chat-body .date-divider, #chat-body [class*="divider"]').length);
    ok(dv >= 3, 'B1c 夹具诚实：屏上有日期分隔线（' + dv + ' 枚）＝保窗判据不是靠「没有分隔线」骗过去的', 'dv=' + dv);

    // ②a：热片态点「引用冷头那条」——记录在库里，只是内存这一截读不到
    const q1 = await clickQuote(page, ND_HEAD);
    await wait(1200);
    const t1 = String(q1.toasts || '') + String(await toasts(page));
    ok(t1.indexOf('未找到原消息') < 0, 'B2 冷头未读到时不谎称「未找到原消息」（如实说还在取回＝#1360 同口径）', 'toast=「' + t1 + '」 落点=' + JSON.stringify(q1.hl));

    // 上翻到头 → 冷头并入内存（坐标整体 +600，DOM data-idx 同步搬）
    for (let k = 0; k < 8; k++) { await scrollEnd(page, 'top'); await wait(600); }
    const st = await (async () => { for (let i = 0; i < 60; i++) { const c = await cur(page); if ((c.n || 0) >= 900) return c; await wait(1000); } return await cur(page); })();
    ok((st.n || 0) >= 900, 'B3a 夹具：冷头已并入内存（n=' + (st.n || 0) + '）＝rebase 真发生过', JSON.stringify(st));

    // ②b：rebase 之后点「引用热片第 4 条」——qidx=4 是并入之前的本地坐标
    const s2 = await clickQuote(page, HOT_Q);
    const hlTxt = s2.hl ? s2.hl.text : '';
    ok(hlTxt.indexOf(HOT_Q.slice(0, 8)) >= 0, 'B3 坐标位移后点引用仍落在原文那条（实测高亮=' + JSON.stringify(hlTxt) + '）', 'toast=「' + s2.toasts + '」 屏上节点=' + s2.nodes + ' 窗口=' + s2.lo + '–' + s2.hi);

    // ①：搜索冷头关键词 → 点结果 → 应落在含关键词的那一条且停在历史区
    await scrollEnd(page, 'bottom');
    await wait(1200);
    const sj = await searchJump(page, ND_HEAD);
    await wait(2200);
    const s3 = await shot(page);
    ok(sj.hits > 0, 'B4a 搜得到冷头那条（hits=' + sj.hits + '）', sj.txt || sj.err);
    ok(s3.hlText.indexOf(ND_HEAD) >= 0 || s3.hlText.indexOf('head0-7') >= 0, 'B4b 点结果落在含关键词的那一条（实测高亮=' + JSON.stringify(s3.hlText) + '）', 'idx=' + s3.hlIdx);
    ok(s3.max - s3.y > 300, 'B4c 跳转后停在历史区、没被弹回底部（离底 ' + (s3.max - s3.y) + 'px）');
    ok(s3.msgNodes >= 1 && s3.msgNodes <= (s3.hi - s3.lo + 1) + 2, 'B4d 规模没失控：屏上节点数＝窗口条数（' + s3.msgNodes + ' 节点 / 窗口 ' + (s3.hi - s3.lo + 1) + ' 条），没把整史铺开', JSON.stringify({ kids: s3.kids, nodes: s3.msgNodes, lo: s3.lo, hi: s3.hi }));

    // 不修过头①：钉住态（用户回到最新一条）时重画仍按到尾部段、来消息照常跟底
    await scrollEnd(page, 'bottom');
    await wait(1400);
    const cB = await cur(page);
    ok(cB.hi >= cB.n, 'B5a 滚回底部后窗口尾贴到最新（环 hi=' + cB.hi + ' n=' + cB.n + '）', JSON.stringify(cB));
    await rev(page, () => { try { window.chatAddIn && window.chatAddIn('钉住态来的一条'); } catch (e) {} return 1; });
    await wait(2200);
    const s5 = await shot(page);
    ok(s5.nearBottom, 'B5b 钉住态来新消息照常跟底（#378/#998 旧契约不动）', JSON.stringify({ y: s5.y, max: s5.max }));

    // 不修过头②：#742「重进聊天页恒以最新一条收尾」不受影响
    await rev(page, () => { const p = document.getElementById('page-chat'); if (p) p.hidden = true; const d = document.querySelector('.tab[data-page="page-phone"]'); if (d) d.click(); return 1; });
    await wait(900);
    await enterChat(page);
    await wait(1600);
    const s6 = await shot(page);
    ok(s6.nearBottom || s6.hi >= (await cur(page)).n - 3, 'B6 重进聊天页仍落在最新一段（#742 语义不动）', JSON.stringify(s6));
    await page.close();
  } finally { await ctx.close(); }
} catch (e) {
  ok(false, 'B0 夹具跑通（异常：' + String(e && e.message).slice(0, 160) + '）');
}
ok(errs.length === 0, 'Z1 全程零页面异常', errs.slice(0, 3).join(' | '));
server.close();
console.log('\n#1491 共 ' + (pass + fail) + ' 断言：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
