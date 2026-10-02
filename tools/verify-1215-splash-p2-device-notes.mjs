// verify-1215-splash-p2-device-notes.mjs — #1215 开屏第二页补「关于设备兼容问题 / 和自己修 bug 的方法」＋#1215b 置顶与折叠（常驻）
// 用户直派（2026-09-25）：①「开屏公告的第二页新增内容：关于设备兼容问题和自己修bug」并给定稿原文
//   （设备 bug 大多是机型差异／没有他机只能盲修／iOS 无真机测不出／七百多次部署与医院陪护／开源可自己调；
//    自修方法＝下载全部代码 + 按【设备型号 + 浏览器 + 问题 + 设备诊断 docx】报给 AI + 只讲操作流程不讲角色名 + 别 100% 依赖 AI + 停更后不处理任何事务）。
// ②同日追改：「把今天最新的刚刚叫你加的内容放在第二页的公告放在最顶上，默认打开，其他的折叠起来」
//   → 两张新卡置顶默认展开；09.12 / 09.14 / 09.21 / 09.22×2 这五张更早的公告整体包进原生 <details>（默认收起）。
//   本批**改掉**了 #995/#1022 的「按日期顺序追加在页尾」旧口径，顺序断言（S6/B4）按新口径写。
// 落点：src/template.html 的 #splash-mandatory 内（页 2 强制公告，从不被 notice.json 在线覆盖）。
// 零 JS／零动画：折叠用原生 details/summary，门控（clock.js mandBottom/finishEnter）一字未动；
//   样式只新增 base.css 的 .splash-mandatory-fold*（方法五条借用早已定义、此前空着的 .mnum）。
// 断言面：src 十三段原文逐字在位且顺序正确、新卡置顶且五张既有卡整体在默认收起的折叠块里 ／
//   产物接入＋八条 needle 在产物逐条命中＋哨兵八行在登记 ／ 无头实测走真实进入流程后页 2 渲染十三段、
//   方法五条按 .mnum 真渲染成列表（加粗＋项目符号）、折叠块初始不占高度、点开展开后既有五张卡全文可读且门控仍须再滑到底、
//   既有卡片原句未动、零 JS 异常。
// 用法：node tools/verify-1215-splash-p2-device-notes.mjs
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

// ===== 原文十三段（与 src 一字不差；改文案必须连本脚本一起改） =====
// 排版口径（不改内容）：小写 ios/ai 统一为 iOS/AI、中英文间补空格（与 #995、#1022 同口径）；方法组第一条对齐补「。」。
const CARD1 = [
  '关于设备 bug 的问题，已经解释过很多次了：大多是不同手机型号导致的。作者自己的手机使用一直是正常的，正常使用下网站本身没什么 bug，大功能小功能都是正常的。',
  '因为我没有其他人的手机型号，一直以来帮修都是盲修。再加上手机型号差异非常多，问题会反复出现。这个网站功能太多，不同手机型号可能在某个功能上出现小 bug，但一般正常聊天和大部分功能都没问题。',
  'iOS 更是因为设备限制会卡顿，但我没有 iOS 手机，无法测出问题，而且不同型号可能有不同的卡顿问题。安卓还挺正常的使用很流畅，但是 iOS 好像都卡顿。主要就是 iOS 的问题我修不了，安卓目前出现的都是小问题还好，就是一些不同设备导致出现的各种奇奇怪怪的小问题。',
  '不是不帮，我已经修尽力了。从开始内测至今，网站已经部署更新七百多次，除了前几天在医院陪护，每天除了吃饭睡觉都在调整网站功能和帮修问题，一直在熬夜，然后这两天实在是撑不住了睡觉去了。如果不信，github 库里也有代码上传的记录。',
  '如果因为手机型号问题觉得这个网站 bug 很多——代码都是开源的，可以自己调。永久停更后也建议有能力的朋友自己修，有自己的真机验证，会好修很多很多。'
];
const CARD2 = [
  '自己修 bug 的方法：',
  '把代码和文件夹全部下载到电脑本地。',
  '按【设备型号 + 浏览器 + 问题 + 设备诊断 docx】的格式报给 AI。',
  '不清楚怎么报，就把问题描述得越详细越好。',
  '注意：不要跟 AI 说「梦角什么什么」，要说你的操作流程和哪个功能异常。',
  '设备诊断信息我设置了几个自测功能，就是你遇到什么问题，就导出什么文件，一起给 AI。',
  '推荐 AI 修问题，但建议不要 100% 依赖 AI，AI 会出错和骗人，也需要一直调整。',
  '之前一直都是尽力帮修，月底后永久停更，不处理任何事务。建议要么凑合用，要么自己调，代码一直是开源的。'
];
const ALL = CARD1.concat(CARD2);
const STEPS = CARD2.slice(1, 6);
const H1 = '关于设备兼容问题';
const H2 = '和自己修 bug 的方法';
const ID1 = 'splash-mandatory-device-bug';
const ID2 = 'splash-mandatory-fix-guide';
const FOLD_ID = 'splash-mandatory-older';
// 五张既有卡（#1215b 起整体进默认收起的折叠块）：标题与 id 都要保持原样
const PREV = ['月底停更，说点心里话', '关于不再更新网站后的建议', '关于让 AI 修，先说清楚几句', '一些其他事情', '关于「收费」，一并说清楚'];
const PREV_IDS = ['splash-mandatory-aicaveat', 'splash-mandatory-respect', 'splash-mandatory-fee-rumor'];
const OLDER_CARD_IDS = PREV_IDS; // 折叠块内的具名卡
const ENDMARK = '—— 公告完 ——';
const NEEDLES = ['id="' + ID1 + '"', 'id="' + ID2 + '"', '一直以来帮修都是盲修', '如果不信，github 库里也有代码上传的记录。', '【设备型号 + 浏览器 + 问题 + 设备诊断 docx】', '要说你的操作流程和哪个功能异常', '月底后永久停更，不处理任何事务', 'id="' + FOLD_ID + '"'];
const REG = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

// ===== S 系列：src 静态（逐字在位、顺序、落在正确容器里） =====
const tpl = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const mandStart = tpl.indexOf('id="splash-mandatory-scroll"');
const mandEnd = tpl.indexOf('splash-mandatory-foot');
const mand = (mandStart > 0 && mandEnd > mandStart) ? tpl.slice(mandStart, mandEnd) : '';
ok(mand.length > 0, 'S1 找到页 2（#splash-mandatory）区块');

const missing = ALL.filter((p) => !mand.includes(p));
ok(missing.length === 0, 'S2 十三段原文在页 2 区块内逐字在位（一字未删/未改写）', missing.length ? 'missing ' + missing.length + ': ' + missing[0].slice(0, 24) : '');

const idxAll = ALL.map((p) => mand.indexOf(p));
ok(idxAll.every((v, i) => v > 0 && (i === 0 || v > idxAll[i - 1])), 'S3 十三段按原话顺序排列（不被重排）', JSON.stringify(idxAll));

const iH1 = mand.indexOf('<div class="splash-mandatory-h">' + H1 + '<'), iH2 = mand.indexOf('<div class="splash-mandatory-h">' + H2 + '<');
ok(iH1 > 0 && iH2 > iH1, 'S4 两张新卡的标题在位且先后顺序正确（' + H1 + ' → ' + H2 + '）');
ok(mand.includes('id="' + ID1 + '"') && mand.includes('id="' + ID2 + '"'), 'S5 两张新卡各自带 id 锚点（供哨兵/脚本/后续重锚定位）');

// #1215b 新口径：最新一批置顶，更早的整体进折叠块（旧口径「按日期追加在页尾」已被本批改掉）
const iFoldOpen = mand.indexOf('<details class="splash-mandatory-fold"');
const iFoldClose = mand.indexOf('</details>');
const iEnd = mand.lastIndexOf(ENDMARK);
const iPrevIds = OLDER_CARD_IDS.map((p) => mand.indexOf(p));
const iFirstOldCard = mand.indexOf('<div class="splash-mandatory-date">2026.09.12<');
ok(iFoldOpen > 0 && iFoldClose > iFoldOpen && iEnd > iFoldClose, 'S6 存在一个成对的折叠块，且整块位于「—— 公告完 ——」之前');
ok(iH1 > 0 && iH2 > 0 && iH2 < iFoldOpen, 'S7 两张新卡排在折叠块之前＝页 2 置顶（#1215b：最新的默认打开）', 'h2=' + iH2 + ' fold=' + iFoldOpen);
ok(iFirstOldCard > iFoldOpen && iFirstOldCard < iFoldClose && iPrevIds.every((v) => v > iFoldOpen && v < iFoldClose),
  'S8 09.12 起那五张更早的公告整体在折叠块内（#1022/#995 的卡片一张没被挤出折叠）', JSON.stringify(iPrevIds));
ok(iPrevIds.every((v, i) => i === 0 || v > iPrevIds[i - 1]), 'S9 折叠块内既有卡保持原日期先后（只包不重排）', JSON.stringify(iPrevIds));
ok(tpl.includes('#1215b'), 'S10 src 注释登记了追改批号 #1215b（下次收口按号核对；旧口径那句也已改写）');

let nj = '';
try { nj = readFileSync(join(root, 'src', 'pwa', 'notice.json'), 'utf8'); } catch (e) {}
ok(nj.length > 0 && !ALL.some((p) => nj.includes(p)), 'S11 未误入 notice.json（强制页从不在线覆盖）');

// 零新增 JS／零动画（#1182 白屏教训）：折叠必须是原生 details，且默认不带展开属性
const foldTag = mand.slice(iFoldOpen, mand.indexOf('>', iFoldOpen) + 1);
ok(/^<details class="splash-mandatory-fold" id="splash-mandatory-older">$/.test(foldTag),
  'S12 折叠块＝原生 details、默认收起（标签上出现 open／或改成 JS 切换＝撤销了「其他折叠起来」）', foldTag);
ok(mand.includes('<summary class="splash-mandatory-fold-sum">'), 'S12b 折叠块标题用 summary（可点、可读、无需 JS）');
const css = readFileSync(join(root, 'src', 'css', 'base.css'), 'utf8');
const foldCss = css.slice(css.indexOf('.splash-mandatory-fold'), css.indexOf('.splash-mandatory-end'));
ok(css.includes('.splash-mandatory-body .mnum') && css.includes('.splash-mandatory-body .mnum::before'),
  'S13 零新增列表样式：.mnum 的既有条目与项目符号定义仍在 base.css 原处');
ok(foldCss.includes('.splash-mandatory-fold-sum::after') && !/animation|splash-fade-up/.test(foldCss),
  'S13b 折叠样式自带展开/收起指示且零动画（#1182：本页可见性不得依赖动画播完）');
ok((mand.match(/class="mnum"/g) || []).length === STEPS.length, 'S14 方法五条正好各占一个 .mnum 条目（不多不少＝没顺手把别段也改成列表）', String((mand.match(/class="mnum"/g) || []).length));

// ===== P 系列：产物接入 + 哨兵登记 =====
const idx = readFileSync(join(root, 'index.html'), 'utf8');
const pMiss = ALL.filter((p) => !idx.includes(p));
ok(pMiss.length === 0, 'P1 产物 index.html 已带十三段原文', pMiss.length ? 'missing ' + pMiss.length : '');
ok(idx.includes('id="' + ID1 + '"') && idx.includes('id="' + ID2 + '"') && idx.includes('id="' + FOLD_ID + '"'), 'P2 产物里两张新卡与折叠块锚点在位');
const nMiss = NEEDLES.filter((p) => !idx.includes(p));
ok(nMiss.length === 0, 'P3 八条 needle 在产物里逐条命中（＝哨兵钉的不是死文本）', nMiss.length ? 'missing: ' + nMiss[0].slice(0, 30) : '');
const bjs = readFileSync(join(root, 'build.mjs'), 'utf8');
const regMiss = REG.filter((s) => !bjs.includes("{ name: '#1215" + s));
ok(regMiss.length === 0, 'P4 八行 FIX_SENTINELS 已登记（#1215a~h）', regMiss.length ? '缺 ' + regMiss.join(',') : '');
ok(idx.includes('.splash-mandatory-fold-sum'), 'P5 折叠样式已接入产物（CSS 合并链未漏）');

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

const st = await page.evaluate((a) => {
  const m = document.getElementById('splash-mandatory');
  const sc = document.getElementById('splash-mandatory-scroll');
  const en = document.getElementById('splash-mandatory-enter');
  const kids = sc ? Array.prototype.slice.call(sc.children) : [];
  const kidTag = (id) => { const e = document.getElementById(id); return e && e.parentNode === sc ? Array.prototype.indexOf.call(sc.children, e) : -1; };
  const fold = document.getElementById(a.foldId);
  const oldInFold = a.oldIds.map((id) => { const e = document.getElementById(id); return !!(fold && e && fold.contains(e)); });
  const oldHeights = a.oldIds.map((id) => { const e = document.getElementById(id); return e ? Math.round(e.getBoundingClientRect().height) : -1; });
  const guide = document.getElementById(a.id2);
  const steps = guide ? Array.from(guide.querySelectorAll('p.mnum')) : [];
  const stepInfo = steps.map((el) => {
    const cs = getComputedStyle(el), bf = getComputedStyle(el, '::before');
    return { fw: cs.fontWeight, bullet: (bf.content || '').replace(/"/g, ''), txt: (el.textContent || '').trim() };
  });
  return {
    shown: !!m && !m.hidden,
    text: m ? (m.textContent || '') : '',
    disabled: !!en && en.classList.contains('is-disabled'),
    topPos: [kidTag(a.id1), kidTag(a.id2)],
    tlPos: kidTag("splash-mandatory-timeline"),
    foldPos: fold && fold.parentNode === sc ? Array.prototype.indexOf.call(sc.children, fold) : -1,
    firstChildIsHead: !!(kids[0] && kids[0].classList.contains('splash-mandatory-head')),
    kidsCount: kids.length,
    foldOpen: !!fold && fold.open,
    oldInFold: oldInFold,
    // 收起的 details 里 offsetHeight/rect 仍会算出旧值（内核用 content-visibility 藏），
    // 「看不见」只能问 checkVisibility()
    oldVisible: a.oldIds.map((id) => { const e = document.getElementById(id); return !!e && e.checkVisibility(); }),
    foldH: fold ? Math.round(fold.getBoundingClientRect().height) : -1,
    stepCount: steps.length,
    stepInfo: stepInfo,
    firstCardTopIsNew: kids.length ? (kids[1] && kids[1].id === a.id1) : false,
    scrollH: sc ? sc.scrollHeight : 0,
    clientH: sc ? sc.clientHeight : 0
  };
}, { id1: ID1, id2: ID2, foldId: FOLD_ID, oldIds: OLDER_CARD_IDS });
ok(st.shown, 'B1 点「我已阅读并知晓」后强制公告层照常弹出（进入流程未被文案改动打断）');
const bMiss = ALL.filter((p) => !st.text.includes(p));
ok(bMiss.length === 0, 'B2 页 2 实测渲染出全部十三段原文', bMiss.length ? 'missing ' + bMiss.length + ': ' + bMiss[0].slice(0, 24) : '');
ok(st.text.includes(H1) && st.text.includes(H2), 'B3 两个新标题在页 2 屏上可读');
ok(st.foldOpen === false && st.oldInFold.every(Boolean) && st.oldVisible.every((v) => v === false),
  'B4 折叠块初始收起、五张既有卡整体在其内且全部判为不可见（＝用户要的「其他折叠起来」真的收住了）',
  'open=' + st.foldOpen + ' inFold=' + JSON.stringify(st.oldInFold) + ' visible=' + JSON.stringify(st.oldVisible));
ok(st.firstChildIsHead && st.tlPos === 1 && st.topPos[0] === 2 && st.topPos[1] === 3 && st.foldPos === 4,
  'B5 滚动容器结构＝标题条→停更时间线卡→置顶两张新卡→折叠块（#1373 换锚：作者直派时间线卡放最顶；「置顶默认展开、全程零 JS」这条契约没放宽，只是往后挪一格）',
  JSON.stringify({ head: st.firstChildIsHead, tlPos: st.tlPos, topPos: st.topPos, foldPos: st.foldPos, kids: st.kidsCount }));
ok(st.stepCount === STEPS.length && st.stepInfo.every((s, i) => s.txt === STEPS[i] && +s.fw >= 700 && s.bullet.includes('·')),
  'B6 方法五条按既有 .mnum 真的渲染成列表（加粗＋项目符号），不是一堆裸段落', st.stepCount + ' 条');
ok(st.scrollH > st.clientH, 'B7 页 2 内容高于视口（折叠后仍靠滑动阅读，不是一屏塞满）', st.scrollH + '/' + st.clientH);
ok(PREV.every((p) => st.text.includes(p)), 'B8 既有五张卡原句未动（本批只挪位置、没删内容）');
ok(st.disabled, 'B9 未滑到底时确认按钮仍置灰（挪位＋折叠未破坏「必须滑到底」门控）');

// 滑到底 → 解禁 → 展开折叠块 → 内容变长应重新置灰（展开的部分也得读完），再滑到底 → 再解禁
await page.evaluate(() => { const s = document.getElementById('splash-mandatory-scroll'); if (s) s.scrollTop = s.scrollHeight; });
await sleep(400);
const ready1 = await page.waitForFunction(() => {
  const e = document.getElementById('splash-mandatory-enter');
  return !!e && !e.classList.contains('is-disabled');
}, null, { timeout: 6000 }).then(() => true).catch(() => false);
ok(ready1, 'B10 滑到底后确认按钮解禁（可点进入）');
const grew = await page.evaluate((fid) => {
  const s = document.getElementById('splash-mandatory-scroll');
  const f = document.getElementById(fid);
  // 折叠块不存在（＝本批未落地的基线副本）时不得抛异常：返回 null 让 B11/B12 各判一条红，
  // 红侧要的是「缺了哪条契约」，不是一句 page.evaluate TypeError（脚本崩掉＝后面 B13/B14/Z1 全部没跑）
  if (!f) return null;
  const before = s.scrollHeight;
  f.open = true;
  s.dispatchEvent(new Event('scroll'));
  return new Promise((r) => setTimeout(() => r(JSON.stringify({
    before: before, after: s.scrollHeight,
    oldVisible: ['splash-mandatory-aicaveat', 'splash-mandatory-respect', 'splash-mandatory-fee-rumor']
      .map((id) => Math.round(document.getElementById(id).getBoundingClientRect().height)),
    disabled: document.getElementById('splash-mandatory-enter').classList.contains('is-disabled'),
    hintBack: !document.getElementById('splash-mandatory-hint').hidden
  })), 350));
}, FOLD_ID);
const gr = JSON.parse(grew || '{"missingFold":true}');
ok(gr.after > gr.before && gr.oldVisible.every((h) => h > 0), 'B11 点开后五张既有卡真的长出高度（折叠不是「藏起来不给看」）', grew === null ? '折叠块不存在' : grew);
ok(gr.disabled === true && gr.hintBack === true, 'B12 展开后须重新滑到底才能进入（门控咬得住变长的正文，提示条同步回来）', grew === null ? '折叠块不存在' : grew);
if (grew !== null) {
  await page.evaluate(() => { const s = document.getElementById('splash-mandatory-scroll'); s.scrollTop = s.scrollHeight; });
  await sleep(400);
}
const ready2 = await page.waitForFunction(() => {
  const e = document.getElementById('splash-mandatory-enter');
  return !!e && !e.classList.contains('is-disabled');
}, null, { timeout: 6000 }).then(() => true).catch(() => false);
ok(grew !== null && ready2, 'B13 展开后再滑到底，确认按钮重新解禁（不会永久卡死进不去）', grew === null ? '折叠块不存在' : '');
if (ready2) await page.evaluate(() => { const e = document.getElementById('splash-mandatory-enter'); if (e) e.click(); });
await sleep(900);
const entered = await page.evaluate(() => {
  const m = document.getElementById('splash-mandatory');
  const s = document.getElementById('splash');
  return { mandGone: !m || m.hidden, splashGone: !s || s.classList.contains('hide') || s.hidden };
});
ok(entered.mandGone && entered.splashGone, 'B14 确认后正常进入应用（门控收尾未被破坏）', JSON.stringify(entered));
ok(pageErrors.length === 0, 'Z1 全程零 JS 异常', pageErrors.slice(0, 2).join(' | '));

await browser.close();
srv.close();
console.log('\n' + (fail === 0 ? '✅' : '❌') + ' verify-1215-splash-p2-device-notes: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
