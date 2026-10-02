// verify-1024-transfer-reuse-notice.mjs — #1024 开屏第一页新增「网站公告 · 关于转载与二次创作」
// 用户直派（2026-09-22）：「开屏第一页要写：网站公告 / 关于转载与二次创作 + 四条要求 + 侵权声明」，
// 原文逐字落库，一字未改（四条要求保留原句与句末「；」）。
// 落点：开屏第一页公告（#splash-notice）的**首个章节**（顶部最显眼的一章）＋ 必读摘要新增一条高亮；
//   两份同步——联网用户看 src/pwa/notice.json 的 sections[0]/summary（在线权威源），
//   断网/弱网用户看 src/template.html 的静态兜底 DOM（renderNotice 用在线列表整段替换静态段）。
// v8.44 #1216（2026-09-25 用户直派「必读摘要删掉，这些内容在开屏最顶已经有了」）：摘要块在两份源同批撤除，
//   本脚本原判「摘要里有转载高亮条 / 首条未被顶掉」的三条断言随之改口为「summary 已空 ＋ 静态无 .splash-summary 块 ＋
//   转载内容仍落在首章」；「为什么必须是首个章节」的理由（不点章节就看不到）在摘要撤除后更成立——章节是唯一落点。
// 不进 build.mjs 哨兵：内容型批次（同 #1022 口径），行为断言由本脚本承担。
// 用法：node tools/verify-1024-transfer-reuse-notice.mjs
//   MOCHI_SERVE_ROOT=<仓外隔离副本目录> 可指向隔离产物（默认 = 本仓根）
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.MOCHI_SERVE_ROOT || here);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = createServer((req, res) => {
  try {
    const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;
console.log('serve root = ' + root);

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };

// ===== 用户原文（逐字；改文案必须连本脚本一起改）=====
const TITLE = '网站公告 · 关于转载与二次创作';
// #1500（2026-09-30 作者直派「公告目录里的中文数字都删掉换阿拉伯数字，格式要统一」）：两源章标题统一编号
const NUM = '1、';
const LEAD = '本网站所有字卡内容遵循「开放二传二改」原则，欢迎分享与再创作。但请遵守以下要求：';
const RULES = [
  '转载或二传链接，必须保留作者署名（言序）；',
  '二次创作作品请注明「基于言序作品修改」；',
  '禁止抹除署名、伪装原创、或将内容用于恶意引流；',
  '仅分享网站聊天记录、不涉及搬运字卡的，只需标注 mochi 字卡 tag 即可。',
];
const TAIL = '未经署名转载视为侵权，作者保留追究权利。';

console.log('\n== A 在线权威源 src/pwa/notice.json ==');
let j = null;
try { j = JSON.parse(readFileSync(join(root, 'src/pwa/notice.json'), 'utf8')); } catch (e) {}
ok(!!j, 'notice.json 可解析');
const s0 = j && Array.isArray(j.sections) ? j.sections[0] : null;
ok(!!s0 && s0.h === NUM + TITLE, '首章标题＝1、网站公告 · 关于转载与二次创作', s0 && s0.h);
const flat = s0 && Array.isArray(s0.p) ? s0.p.map((x) => (x && typeof x === 'object' ? (x.b !== undefined ? x.b : x.hl) : x)) : [];
ok(flat[0] === LEAD, '首句＝开放二传二改原则 + 请遵守以下要求（逐字）', flat[0]);
RULES.forEach((r, i) => ok(flat[i + 1] === r, '第 ' + (i + 1) + ' 条要求逐字在位', flat[i + 1]));
ok(flat[5] === TAIL, '收尾＝未署名视为侵权（逐字在位）', flat[5]);
ok(!!s0 && Array.isArray(s0.p) && s0.p[5] && s0.p[5].hl === TAIL, '侵权声明走 hl 高亮条目（与页面红线口径一致）');
// v8.44 #1216（2026-09-25 用户直派「必读摘要删掉，这些内容在开屏最顶已经有了」）：summary 整段清空，
//   原「摘要新增转载高亮条 / 第一条未被顶掉」两条判据改口为「summary 已空」＋「转载章仍在首位」（本章即落点）。
ok(!!j && Array.isArray(j.summary) && j.summary.length === 0, '在线 summary 已随 #1216 整段清空（残留一条＝联网用户仍看到半块摘要，与静态兜底两份分叉）', JSON.stringify(j.summary || null).slice(0, 40));
ok(!!j && j.sections.length >= 12 && j.sections[0].h === NUM + TITLE, '转载公告落在线首章（摘要撤除后它才是唯一落点）', j && j.sections.length + ' 章');
// #1503（2026-09-30 作者直派「许可 署名 灵感来源应该也放在显眼的地方啊，和 mochi 名字解释的一起」）：该章整章
//   从公告下架、要点搬到品牌卡（与「Mochi」名字澄清同处）——原「章仍在」判据改口为「不得回流」。
ok(!!j && j.sections.every((x) => String(x.h).indexOf('许可 · 署名 · 灵感来源') < 0), '#1503 起在线源不再有「许可 · 署名 · 灵感来源」章（要点已移到品牌卡；回流＝公告与品牌卡两份口径并存）', j && j.sections.map((x) => String(x.h)).join(' / ').slice(0, 60));

console.log('\n== B 离线兜底 src/template.html ==');
const tpl = readFileSync(join(root, 'src/template.html'), 'utf8');
ok(tpl.indexOf('<p class="splash-sec">' + NUM + TITLE + '</p>') >= 0, '兜底章节标题在位');
ok(tpl.indexOf('<p class="splash-item">' + LEAD + '</p>') >= 0, '兜底首句在位');
RULES.forEach((r, i) => ok(tpl.indexOf('<p class="splash-bullet">' + r + '</p>') >= 0, '兜底第 ' + (i + 1) + ' 条要求在位'));
ok(tpl.indexOf('<p class="splash-item splash-hl">' + TAIL + '</p>') >= 0, '兜底侵权声明（高亮）在位');
ok(tpl.indexOf('<div class="splash-summary"') < 0, '静态兜底的「必读摘要」块已随 #1216 整块撤除（复活＝与开屏最顶必读卡组两份口径各说各话；哨兵 #1216a/#613 同判）');
ok((tpl.match(/<p class="splash-sec">1、网站公告 · 关于转载与二次创作<\/p>/g) || []).length === 1, '转载章标题在静态兜底里恰好一处（.splash-sec 唯一，摘要撤除后不存在第二份复述）');
// #1498（2026-09-30 作者直派「把公告里的【互助群公告】相关内容删掉」）：该章两源整块下线，本行由「章仍在」改口为
//   「章不得回流」——原先它证的是「只插入、未替换」，那层意思现由上方第 64 行（四、许可章仍在）＋第 73 行（转载章唯一）承担。
ok(tpl.indexOf('<p class="splash-sec">互助群公告</p>') < 0, '#1498 起「互助群公告」章保持删除（回流＝把整章带回开屏，与线上 notice.json 分叉）');
const o = (tpl.match(/<!--/g) || []).length, c = (tpl.match(/-->/g) || []).length;
ok(o === c, 'HTML 注释配平（未闭合注释会连锁打碎 .phone 结构，#301）', o + '/' + c);

console.log('\n== C 产物实测：真实进入流程渲染第一页 ==');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#splash-notice .splash-toc', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1000);
const r = await page.evaluate((title) => {
  const wraps = Array.from(document.querySelectorAll('#splash-notice .splash-sec-wrap'));
  const head = (w) => { const e = w.querySelector(':scope > .splash-sec'); return e ? e.textContent.trim() : ''; };
  const first = wraps[0] || null;
  const notice = document.getElementById('splash-notice');
  const toc = Array.from(document.querySelectorAll('.splash-toc-chip')).map((x) => x.textContent);
  const nchars = (s) => (s || '').replace(/\s/g, '').length;
  const norm = (s) => (s || '').replace(/\s/g, '');
  return {
    chapterCount: wraps.length,
    firstTitle: head(first),
    firstText: norm(first ? first.textContent : ''),
    tocHasIt: toc.some((x) => x.indexOf(title) >= 0),
    tocCount: toc.length,
    hasSummaryEl: !!document.querySelector('.splash-summary'),
    noticeHasTail: norm(notice.textContent).indexOf(norm('未经署名转载视为侵权，作者保留追究权利。')) >= 0,
    keepDisclaimer: norm(document.querySelector('.splash-disclaimer') ? document.querySelector('.splash-disclaimer').textContent : '').indexOf(norm('本站禁止未满 18 周岁的未成年人使用')) >= 0,
    // #1503 起该口径随许可章搬到品牌卡（.splash-brandcard，不在 #splash-notice 内）→ 判据改看整页文本
    keepPermit: norm(document.body.textContent).indexOf(norm('Mochi字卡为原创独立作品（即原版）')) >= 0,
    firstHasAll: ['网站公告·关于转载与二次创作', '本网站所有字卡内容遵循「开放二传二改」原则，欢迎分享与再创作。但请遵守以下要求：',
      '转载或二传链接，必须保留作者署名（言序）；', '二次创作作品请注明「基于言序作品修改」；',
      '禁止抹除署名、伪装原创、或将内容用于恶意引流；', '仅分享网站聊天记录、不涉及搬运字卡的，只需标注mochi字卡tag即可。',
      '未经署名转载视为侵权，作者保留追究权利。'].every((s) => norm(first ? first.textContent : '').indexOf(s) >= 0),
    ncharsFirst: nchars(first ? first.textContent : ''),
  };
}, TITLE);
ok(r.chapterCount >= 14, '第一页公告章节数 ≥ 14（#1503 起许可章与 Bug 章下架＝在线源 14 章）', r.chapterCount);
ok(r.firstTitle === NUM + TITLE, '渲染后首章就是该公告（第一眼可见）', r.firstTitle);
ok(r.firstHasAll, '首章七段原文（首句 + 四条 + 侵权声明）全部渲染到位');
ok(r.tocHasIt, '目录里能跳转到该章', r.tocCount + ' 章');
ok(!r.hasSummaryEl, '必读摘要块已整块撤除（#1216 用户直派；渲染侧也不该再出现 .splash-summary）');
ok(r.noticeHasTail, '侵权声明在页面上可见');
ok(r.keepDisclaimer, '免责声明卡的 18 周岁红线未被覆盖（摘要撤除后它的权威落点＝开屏必读卡组 .splash-disclaimer，只增不改）');
ok(r.keepPermit, '#1503 起「原创独立作品（即原版）」口径仍在（落点＝品牌卡许可块）');
ok(errs.length === 0, '全程无未捕获 JS 异常', errs.slice(0, 3));
await browser.close();
srv.close();

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
