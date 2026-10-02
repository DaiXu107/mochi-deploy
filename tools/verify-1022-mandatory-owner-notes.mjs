// verify-1022-mandatory-owner-notes.mjs — #1022 开屏第二页（进入前 · 作者必读公告）补作者定稿原文（常驻）
// 用户直派（2026-09-22）：「开屏第二页增加内容」，并给出定稿原文（两段主题：①造谣 / 恶意引流与不署名 /
//   网站一直公开免费、从没要求点赞关注评论；②澄清「收费」传闻——星言字卡与 mochi 字卡都是自费制作、
//   没收过一分钱，并担心停更后有人借网站名义收费），随后同批追加「还差最后一段话」的收尾段。
// 落点：src/template.html 的 #splash-mandatory 内、#995 的 AI 卡之后、`—— 公告完 ——` 之前（页 2 最末）；
//   拆两张卡（#splash-mandatory-respect / #splash-mandatory-fee-rumor），原文一字未删。
//   #1045（2026-09-22）作者本人改稿：第二卡第二段改写（语气收敛、口径不变），B[1] 基线随定稿同步更新。
// 不进 notice.json：#995 起即定「强制页从不在线覆盖，notice.json 只覆盖页 1 公告列表与摘要」。
// 断言面：src 十段原文逐字在位且顺序正确、两张卡在 #995 卡之后且在「公告完」之前 ／ 产物 index.html 接入 ／
//   无头实测走真实进入流程后页 2 渲染出全部十段、卡片顺序正确、既有卡片原句未动、滑到底门控未被加长破坏、
//   零 JS 异常 ／ 本批未登记哨兵（内容型批次）时不得误报。
// 用法：node tools/verify-1022-mandatory-owner-notes.mjs
//   MOCHI_SERVE_ROOT=<仓外副本目录> 可指向隔离副本（默认 = 本仓根）
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.MOCHI_SERVE_ROOT || here);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;
console.log('serve root = ' + root);

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };

// ===== 原文十段（与 src 一字不差；改文案必须连本脚本一起改） =====
const A = [
  '虽然我对这些事情其实不是很想提，但网站月底就永久停更了，还是作为信息留存写进来。',
  '说实话自从开始做网站，发生了很多事情，实在是沧桑了许多。造谣的人，别关注我，我不伺候。',
  '希望彼此尊重。用网站引流可以，但请先学会尊重创作者。讨厌恶意引流、二传链接不标注任何署名，也很讨厌用我网站还造谣我的人。人与人之间基本的尊重，总该要有吧。',
  '我知道很多人就是拿了链接就跑了，我一直也没有要求过任何人必须关注或点赞才能拿到链接，链接一直是公开的。',
  '但看到还有人没有标注任何署名，发帖要求「评论祝福才能给链接」类似的事情，甚至有人指出作者在哪里网站是公开免费的后反而被拉黑，发帖人说求链接「没收费就不错了」。',
  '有没有可能，我的网站一直都是公开的、免费的呢？作者本人发链接，都没要求过任何人必须点赞、关注、评论，才能拿到链接，更没有收费。虽然我不常看这些事，但也不是完全不知道，总会有人看到然后告诉我啊。这完全是不尊重我的作品，也不尊重我的使用规则。就感觉真心一直被辜负。'
];
const B = [
  '还有个问题就是，不管是 2026 年 7 月搓的星言字卡，还是 8 月搓的 mochi 字卡，作者一直都是自费制作的。这两个字卡网站都是免费网站，没有收过任何人一分钱，有人想悄悄给我塞钱，我也都拒绝了。',
  // #1045（2026-09-22）作者本人改稿：中段「却对外说…这不是自相矛盾吗？…也是力竭了。」→「有对外说类似…完全自相矛盾，…请不要在外面乱传。」（语气收敛、口径不变），其余各段一字未动
  '我一直都说这是免费网站，有人不清楚现状有对外说类似「网站是免费的，但除了作者谁都不要给钱」——完全自相矛盾，这网站本来就是免费的，一直是免费的，请不要在外面乱传。我真怕有人在外面乱传，明明网站一直是免费的，却被说成「免费但作者私下收费」之类的话。',
  '还有更怕永久停更后有人借着这个网站的名义收费，到时候真传成「这网站收费」，也是说不清了。',
  '说实话，这个网站是我用了非常多的精力和心血做成的，我做不到对外面那些话语完全零反应。就算对我的网站，我的话不认可，也请互相尊重彼此。'
];
const ALL = A.concat(B);
const H1 = '一些其他事情';
const H2 = '关于「收费」，一并说清楚';
const PREV = ['月底停更，说点心里话', '关于不再更新网站后的建议', '关于让 AI 修，先说清楚几句'];
const ENDMARK = '—— 公告完 ——';

// ===== S 系列：src 静态（逐字在位、顺序、落在正确容器里） =====
const tpl = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const mandStart = tpl.indexOf('id="splash-mandatory-scroll"');
const mandEnd = tpl.indexOf('splash-mandatory-foot');
const mand = (mandStart > 0 && mandEnd > mandStart) ? tpl.slice(mandStart, mandEnd) : '';
ok(mand.length > 0, 'S1 找到页 2（#splash-mandatory）区块');

const missing = ALL.filter((p) => !mand.includes(p));
ok(missing.length === 0, 'S2 十段原文在页 2 区块内逐字在位（一字未删/未改写）', missing.length ? 'missing ' + missing.length + ': ' + missing[0].slice(0, 24) : '');

const idxAll = ALL.map((p) => mand.indexOf(p));
ok(idxAll.every((v, i) => v > 0 && (i === 0 || v > idxAll[i - 1])), 'S3 十段按原话顺序排列（不被重排）', JSON.stringify(idxAll));

const iH1 = mand.indexOf(H1), iH2 = mand.indexOf(H2), iEnd = mand.lastIndexOf(ENDMARK);
const iPrev = PREV.map((p) => mand.indexOf(p));
ok(iH1 > 0 && iH2 > iH1, 'S4 两张新卡的标题在位且先后顺序正确（' + H1 + ' → ' + H2 + '）');
ok(iPrev.every((v) => v > 0 && v < iH1), 'S5 新内容排在 #995 的 AI 卡之后（页 2 末段＝按日期顺序追加）', JSON.stringify(iPrev));
ok(iEnd > iH2 && iEnd > idxAll[idxAll.length - 1], 'S6 新内容整体位于「—— 公告完 ——」结束标记之前', 'end=' + iEnd);
ok(tpl.includes('#1022'), 'S7 src 注释登记本批批号 #1022（便于下次收口按号核对）');

// 页 2 是强制页、从不在线覆盖：本批不进 notice.json（#995 起的既定口径）
let nj = '';
try { nj = readFileSync(join(root, 'src', 'pwa', 'notice.json'), 'utf8'); } catch (e) {}
ok(nj.length > 0 && !ALL.some((p) => nj.includes(p)), 'S8 未误入 notice.json（强制页从不在线覆盖）');

// ===== P 系列：产物接入（index.html 内联模板） =====
const idx = readFileSync(join(root, 'index.html'), 'utf8');
const pMiss = ALL.filter((p) => !idx.includes(p));
ok(pMiss.length === 0, 'P1 产物 index.html 已带十段原文', pMiss.length ? 'missing ' + pMiss.length : '');
ok(idx.includes('id="splash-mandatory-respect"') && idx.includes('id="splash-mandatory-fee-rumor"'), 'P2 产物里两张新卡锚点在位');

// ===== B 系列：无头实测（走真实进入流程） =====
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));

await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded', timeout: 40000 });
await page.waitForFunction(() => !!document.querySelector('.splash-notice-list'), null, { timeout: 20000 }).catch(() => {});
await sleep(1500);
// 第一页照常：滑到底 + 勾年龄 → 点「我已阅读并知晓」
await page.evaluate(() => {
  const b = document.getElementById('splash-box'); if (b) b.scrollTop = b.scrollHeight;
  const c = document.getElementById('splash-age-check');
  if (c && !c.checked) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }
});
await sleep(900);
await page.evaluate(() => { const b = document.getElementById('splash-enter'); if (b) b.click(); });
await sleep(800);

const st = await page.evaluate(() => {
  const m = document.getElementById('splash-mandatory');
  const en = document.getElementById('splash-mandatory-enter');
  const ids = ['splash-mandatory-aicaveat', 'splash-mandatory-respect', 'splash-mandatory-fee-rumor'];
  const pos = ids.map((id) => { const e = document.getElementById(id); return e ? Array.prototype.indexOf.call(e.parentNode.children, e) : -1; });
  return {
    shown: !!m && !m.hidden,
    text: m ? (m.textContent || '') : '',
    disabled: !!en && en.classList.contains('is-disabled'),
    pos: pos,
    scrollH: (() => { const s = document.getElementById('splash-mandatory-scroll'); return s ? s.scrollHeight : 0; })(),
    clientH: (() => { const s = document.getElementById('splash-mandatory-scroll'); return s ? s.clientHeight : 0; })()
  };
});
ok(st.shown, 'B1 点「我已阅读并知晓」后强制公告层照常弹出（进入流程未被文案改动打断）');
const bMiss = ALL.filter((p) => !st.text.includes(p));
ok(bMiss.length === 0, 'B2 页 2 实测渲染出全部十段原文', bMiss.length ? 'missing ' + bMiss.length + ': ' + bMiss[0].slice(0, 24) : '');
ok(st.text.includes(H1) && st.text.includes(H2), 'B3 两个新标题在页 2 屏上可读');
ok(st.pos.every((v) => v >= 0) && st.pos[1] > st.pos[0] && st.pos[2] > st.pos[1], 'B4 新卡渲染在 #995 的 AI 卡之后（DOM 顺序正确）', JSON.stringify(st.pos));
ok(st.scrollH > st.clientH, 'B5 页 2 内容高于视口（加长后仍靠滑动阅读，不是一屏塞满）', st.scrollH + '/' + st.clientH);
ok(PREV.every((p) => st.text.includes(p)), 'B6 既有卡片原句未动（本批只追加）');
ok(st.disabled, 'B7 未滑到底时确认按钮仍置灰（加长未破坏「必须滑到底」门控）');

// 滑到底 → 按钮解禁 → 真进入
await page.evaluate(() => { const s = document.getElementById('splash-mandatory-scroll'); if (s) s.scrollTop = s.scrollHeight; });
await sleep(400);
const ready = await page.waitForFunction(() => {
  const e = document.getElementById('splash-mandatory-enter');
  return !!e && !e.classList.contains('is-disabled');
}, null, { timeout: 6000 }).then(() => true).catch(() => false);
ok(ready, 'B8 滑到底后确认按钮解禁（可点进入）');
if (ready) await page.evaluate(() => { const e = document.getElementById('splash-mandatory-enter'); if (e) e.click(); });
await sleep(900);
const entered = await page.evaluate(() => {
  const m = document.getElementById('splash-mandatory');
  const s = document.getElementById('splash');
  return { mandGone: !m || m.hidden, splashGone: !s || s.classList.contains('hide') || s.hidden };
});
ok(entered.mandGone && entered.splashGone, 'B9 确认后正常进入应用（门控收尾未被破坏）', JSON.stringify(entered));
ok(pageErrors.length === 0, 'Z1 全程零 JS 异常', pageErrors.slice(0, 2).join(' | '));

await browser.close();
srv.close();
console.log('\n' + (fail === 0 ? '✅' : '❌') + ' verify-1022-mandatory-owner-notes: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
