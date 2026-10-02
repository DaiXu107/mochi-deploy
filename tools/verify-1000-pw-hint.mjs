// ===== 常驻回归：#1000 二级验证密码 / 暗号 提示口径＝指路「开屏第一页的章节目录」（不是第二页「进入前 · 作者必读公告」上的日期）=====
// 用户 2026-09-21 直派（原话）：「关于2级密码和暗号需要提醒。时间就在开屏第一页的某个目录，不要看第二页。」
// 背景（零机型分支，纯文案层）：旧的密码/暗号提示只写「生日写在开屏（公告）的目录里，不是最底下的部署时间」——
//   而点「我已阅读并知晓」之后那一屏的标题正是「进入前 · 作者必读公告」，页面上还并排显示两个大日期
//   （2026.09.12 / 2026.09.14），用户把那一页当成「开屏公告」、拿那两个日期去凑 6 位密码，两个入口都卡住。
//   本批把全部入口的提示改成：答案在开屏<b>第一页</b>的章节里（第一页顶部有「目录」可逐章翻），
//   并明写不是<b>第二页</b>「进入前 · 作者必读公告」上的那两个日期；同时每处都点明「二级验证密码」与
//   「暗号」是同一串 6 位数字（两个入口都用它）。
// 断言：
//  S 组＝源码/产物锚（红侧必红）：旧口径消失（删除型）／静态兜底锁卡 tip＋clock＋applock 三处新口径／
//       （#1216 起「必读摘要」整块撤除：原判摘要的第 4 条与 S7 的 notice 侧计数改判「摘要里没有」，
//        哨兵 #1000b 随之转删除型＝该 needle 在产物里必须为 0 次）
//       clock.js 三处（锁定态 tip / 解锁弹窗 / 进入后提醒）／applock.js 三处（跳过问答 / 关应用锁 / 验证身份）／
//       每处都写明「不是第二页…那两个日期」／密码与暗号互指仍在／八条哨兵登记与 needle 各自唯一
//  B 组＝行为面（真浏览器 390×844）：锁卡 tip 渲染出来就带指路／摘要块渲染后不存在（#1216）／点「输入密码解锁」弹窗带指路且错码仍只提示不关窗／
//       第一页确实能找到那个日期（8.15 在开屏第一页的章节里＝提示不说谎）／第二页确实是那两个日期（提示排除的正是它）
//  Z 组＝全程零未捕获 JS 异常
// 用法：node tools/verify-1000-pw-hint.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-1000-pw-hint.mjs   （红绿对照务必显式传）
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (d, ok, detail) => {
  if (ok) { pass++; console.log('  PASS  ' + d + (detail !== undefined && detail !== '' ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + d + (detail !== undefined && detail !== '' ? '  [' + detail + ']' : '')); }
};
const count = (t, p) => t.split(p).length - 1;
const read = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch (e) { return ''; } };

// ---------- S 组：源码 / 产物锚 ----------
console.log('[S] 源码与产物锚（' + root + '）');
const tpl = read('src/template.html');
const notice = read('notice.json');
const noticeSrc = read('src/pwa/notice.json');
const clockSrc = read('src/js/clock.js');
const appSrc = read('src/js/applock.js');
const buildSrc = read('build.mjs');

const OLD_JS_HINT = '生日写在开屏公告的目录里';
const OLD_TPL_HINT = '生日写在开屏目录里';
const OLD_EXCL = '不是第二页「进入前 · 作者必读公告」上那两个日期';
const PAGE2 = '第二页最顶那张时间线卡都写着';

check('S1 旧口径已从密码侧源码消失（删除型：把答案指向「开屏公告」的说法不得回流）',
  count(clockSrc, OLD_JS_HINT) === 0 && count(appSrc, OLD_JS_HINT) === 0,
  'clock=' + count(clockSrc, OLD_JS_HINT) + ' applock=' + count(appSrc, OLD_JS_HINT));
check('S2 旧口径已从静态兜底/摘要源头消失（删除型）',
  count(tpl, OLD_TPL_HINT) === 0 && count(noticeSrc, OLD_TPL_HINT) === 0,
  'template=' + count(tpl, OLD_TPL_HINT) + ' notice.src=' + count(noticeSrc, OLD_TPL_HINT));

check('S3 开屏锁卡静态兜底明确指路第一页章节（不是「答案就在开屏里」这种没方向的写法）',
  tpl.includes('答案就在开屏第一页的章节目录里') && !tpl.includes('答案就在开屏里可以找到'));
check('S4 摘要撤除后暗号指路的落点＝锁卡静态 tip ＋ clock/applock 各一处（#1216 直派删掉必读摘要；两份摘要源都不再复述）',
  tpl.includes('答案就在开屏第一页的章节目录里') &&
  count(tpl, '生日写在开屏第一页的章节目录里——点开第一页顶部的「目录」') === 0 &&
  count(noticeSrc, '生日写在开屏第一页的章节目录里——点开第一页顶部的「目录」') === 0 &&
  count(clockSrc, '生日写在开屏第一页的章节目录里') === 1 && count(appSrc, '生日写在开屏第一页的章节目录里') === 1);
check('S5 clock.js 两处口径各就位（锁定态 tip / 解锁弹窗；#1501 起进入后提醒弹窗已整段摘除）',
  clockSrc.includes('生日写在开屏第一页的章节目录里（点开第一页顶部的「目录」逐章翻一下就能找到）') &&
  clockSrc.includes('生日就在开屏第一页的章节目录里（点开顶部的「目录」逐章翻一下就能找到）') &&
  clockSrc.indexOf('要回开屏第一页的章节里找') === -1);
check('S6 applock.js 三处口径各就位（跳过问答 / 输暗号关应用锁 / 验证身份）',
  appSrc.includes('mochi 字卡的生日写在开屏第一页的章节目录里（点开第一页顶部的「目录」逐章翻一下就能找到）') &&
  count(appSrc, '生日就在开屏第一页的章节目录里（点开第一页顶部的「目录」，逐章翻一下就能找到）；') === 2);

const page2Hits = {
  template: count(tpl, PAGE2), notice: count(noticeSrc, PAGE2),
  clock: count(clockSrc, PAGE2), applock: count(appSrc, PAGE2)
};
// 2026-09-28 作者换口径（原话：「第一页的某个目录里和第二页里都写着，日期一直都是很简单的字面意思的密码，不是隐藏答案」）：
//   旧的那句「排除第二页日期」在四个源里必须归零（＝删除型，回流即红）；新口径逐入口都要在。
//   template 侧给下限、notice 侧给上限＝同一把尺量两种底本：HEAD 底本摘要块已随 #1216 撤除（notice=0、template=tip+注释=2），
//   旧的在途稿还留着摘要行（notice=1、template=3）——两种底本都不该看见旧句，也不该少掉任何一处新句。
const exclHits = { template: count(tpl, OLD_EXCL), notice: count(noticeSrc, OLD_EXCL), clock: count(clockSrc, OLD_EXCL), applock: count(appSrc, OLD_EXCL) };
check('S7a 旧那句「排除第二页日期」在四个源里归零（2026-09-28 换口径：时间线卡上了第二页顶，这句会变成误导）',
  exclHits.template === 0 && exclHits.notice === 0 && exclHits.clock === 0 && exclHits.applock === 0,
  JSON.stringify(exclHits));
check('S7b 每个入口都写明「第一页的章节目录里和第二页最顶那张时间线卡都写着」（#1501 起提醒面摘除＝clock 2 / applock 3 定点；摘要侧随底本有无，取区间）',
  page2Hits.clock === 2 && page2Hits.applock === 3 && page2Hits.template >= 2 && page2Hits.notice <= 1,
  JSON.stringify(page2Hits));
check('S8 密码与暗号互指仍在（同一串 6 位数字，两个入口都用它）',
  clockSrc.includes('这个密码与开屏问答页的「暗号」是同一个（同一串 6 位数字）：在开屏问答页点「输暗号跳过问答」用的也是它。') &&
  appSrc.includes('这个暗号与开屏公告区「防未成年人·内置字卡锁定」卡的二级验证密码是同一个') &&
  tpl.includes('解锁用的密码与开屏问答页的「暗号」是同一个'));
check('S9 使用说明两处「忘记密码」也补了同一指路',
  count(tpl, '暗号／二级验证密码的答案在开屏<b>第一页</b>的章节里') === 2);

const sentIds = ['#1000a', '#1000b', '#1000c', '#1000e', '#1000f', '#1000g', '#1000h']; // #1000d 随 #1501 退役（进入后提醒弹窗整段摘除，见 FIX-REGRESSION #1501）
const missSent = sentIds.filter((id) => buildSrc.indexOf("name: '" + id + ' ') < 0);
check('S10 哨兵 #1000a~h 登记（#1000d 随 #1501 退役除外）', missSent.length === 0, missSent.join(','));
// 哑哨兵体检：needle 必须在各自登记 file 内唯一（多条共用同一 needle 会被构建体检点名）
const uniq = [
  ['index.html', '答案就在开屏第一页的章节目录里'],
  ['js/clock.js', '生日写在开屏第一页的章节目录里（点开第一页顶部的「目录」逐章翻一下就能找到）'],
  ['js/applock.js', 'mochi 字卡的生日写在开屏第一页的章节目录里']
];
const uniqBad = uniq.filter(([f, n]) => count(read(f), n) !== 1).map(([f, n]) => f + ' :: ' + n.slice(0, 20));
check('S11 正向哨兵 needle 各自在登记 file 内唯一（哑哨兵体检）', uniqBad.length === 0, uniqBad.join(' | '));
// #1000b 随 #1216 的摘要块撤除转成删除型：这条 needle 在产物里必须为 0 次（复述回来＝摘要复活）
const B_NEEDLE = '生日写在开屏第一页的章节目录里——点开第一页顶部的「目录」';
const absentNeedles = ["needle: '生日写在开屏公告的目录里，不是开屏最底下的部署时间', absent: true", "needle: '生日写在开屏公告的目录里——注意不是', absent: true", "needle: '" + B_NEEDLE + "', absent: true"];
check('S12 删除型哨兵登记形态正确且旧口径在产物里确实不存在（#1000g/#1000h 旧文案 ＋ #1000b 转删除型后的摘要那条）',
  absentNeedles.every((n) => buildSrc.includes(n)) && count(read('js/clock.js'), OLD_JS_HINT) === 0 && count(read('js/applock.js'), OLD_JS_HINT) === 0 &&
  count(read('index.html'), B_NEEDLE) === 0);

// #1000 第二段：公告章节日期改 4 位写法（用户直派）——两份源＋产物同口径，点号写法不得回流
check('S13 两源＋产物均为 4 位日期写法（0812／0815~0829／0829）',
  noticeSrc.includes('0812 开搓，0815~0829 内测') && tpl.includes('0812 开搓，0815~0829 内测') &&
  notice.includes('0812 开搓，0815~0829 内测') && read('index.html').includes('0812 开搓，0815~0829 内测'));
check('S14 点号写法已从两源与产物消失（删除型）',
  !noticeSrc.includes('8.12 开搓') && !tpl.includes('8.12 开搓') && !read('index.html').includes('8.12 开搓'));

// ---------- B 组：真浏览器 ----------
console.log('[B] 真浏览器 390×844');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
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
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push(String(e && e.message || e).slice(0, 160)));
await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
// 开屏渲染依赖外置 js（一文件一资源）：等锁卡按钮出线再断言
await page.waitForFunction(() => {
  const a = document.getElementById('splash-cardlock-actions');
  return !!a && !!a.querySelector('button');
}, null, { timeout: 20000 }).catch(() => {});

const tip = await page.evaluate(() => {
  const t = document.getElementById('splash-cardlock-tip');
  return t ? t.textContent : '';
});
check('B1 开屏锁卡 tip 渲染出来就带指路（第一页章节 + 两页都写着 + 两个入口同码）',
  tip.includes('开屏第一页的章节目录里') && tip.includes('第二页最顶那张时间线卡都写着') && tip.includes('「暗号」是同一个'),
  tip.slice(0, 46));

const summary = await page.evaluate(() => {
  const s = document.querySelector('.splash-summary');
  return s ? s.textContent : '';
});
check('B2 必读摘要块在渲染后的开屏里不存在（#1216 用户直派删掉；在线 summary 是空数组＝clock.js 判 length 才建块，复活即红）',
  summary === '', '摘要文本长 ' + summary.length);

// 提示不说谎①：那个日期（8.15）确实在开屏第一页的章节里
// 提示不说谎①：那个日期（8.15）确实在开屏第一页的章节里。⚠ 探针范围＝#splash-box（第一页本体）——
//   「进入前 · 作者必读公告」（#splash-mandatory）也挂在 #splash 底下，而 2026-09-28 那个停更时间线卡按作者定稿
//   写的是 2026.08.12 这种点号形式；整块 #splash 一起量＝把第一页的 4 位口径误判成「点号写法回流」（本批第一次跑就是这条红）。
const page1Text = await page.evaluate(() => { const b = document.getElementById('splash-box'); return (b ? b.textContent : '').replace(/\s+/g, ''); });
check('B3 第一页正文里确实写着那个日期、且是 4 位写法（0815 内测起）＝「在第一页的章节里找」与「原样写成 4 位数」都说谎不得',
  page1Text.includes('0815') && page1Text.includes('0812') && !/8\.15/.test(page1Text));
// 提示不说谎②（2026-09-28 换口径后翻面）：既然九处指路都说「第二页最顶那张时间线卡也写着」，第二页顶上就必须真能看到那个日期
const page2 = await page.evaluate(() => {
  const m = document.getElementById('splash-mandatory');
  return m ? m.textContent : '';
});
check('B4 第二页最顶那张卡确实写着 2026.08.12（＝「两页都写着」不说谎；旧写法判的是「第二页只有诱饵日期」，随换口径作废）',
  page2.includes('2026.08.12') && page2.indexOf('2026.08.12') < page2.indexOf('2026.09.12'),
  '页2 长度 ' + page2.length + '，含 08.12＝' + page2.includes('2026.08.12'));

// 输入解锁弹窗：仍带公式与指路；错码只提示不关窗（行为零回归）
const btn = await page.$('#splash-cardlock-actions button');
if (btn) await btn.click(); else await page.evaluate(() => { const b = document.querySelector('#splash-cardlock-actions button'); if (b) b.click(); });
await sleep(500);
const modal = await page.evaluate(() => {
  const st = document.getElementById('modal-static');
  const mask = document.getElementById('modal-mask');
  return { text: st && !st.hidden ? st.textContent : '', open: !!mask && !mask.hidden };
});
check('B5 点「输入密码解锁」弹窗带指路（第一页章节＋两页都写着＋与暗号同码）',
  modal.open && modal.text.includes('开屏第一页的章节目录里') && modal.text.includes('第二页最顶那张时间线卡都写着') && modal.text.includes('「暗号」是同一个'),
  modal.text.slice(0, 46));
await page.evaluate(() => {
  const inp = document.getElementById('modal-input');
  if (inp) { inp.value = '990101'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
});
await page.evaluate(() => { const b = document.getElementById('modal-ok'); if (b) b.click(); });
await sleep(600);
const afterWrong = await page.evaluate(() => {
  const mask = document.getElementById('modal-mask');
  const st = document.getElementById('modal-static');
  return { open: !!mask && !mask.hidden, hint: st && !st.hidden ? st.textContent : '' };
});
check('B6 输错密码仍只提示不关窗（本次改动不碰校验链）',
  afterWrong.open === true && /密码不对/.test(afterWrong.hint), JSON.stringify(afterWrong));

check('Z 全程零未捕获 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));

await browser.close();
srv.close();
console.log('\n' + (fail ? '❌' : '✅') + ' verify-1000-pw-hint: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
