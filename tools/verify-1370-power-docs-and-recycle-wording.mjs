// ===== 常驻回归脚本 #1370：手机「省电 / 后台管控把网页收回」这件事，用户在屏上真能读到（使用说明＋关于＋功能说明三面镜子同口径）
// 用法：node tools/verify-1370-power-docs-and-recycle-wording.mjs [被测根目录]（或 SERVE_ROOT=…；首行打印被测根目录，防喂错产物）
//   跨引擎形态：USE_WEBKIT=1 换 WebKit 复跑同一把尺（同一份断言、同一台 360×752 现场）
//
// 需求（用户 2026-09-28 直派）：「那需要在使用说明和功能里说明 手机需要关省电模式之类的防止卡顿」。
//   取证时顺带量到第二件事：#1199 那次已经按用户实报「上面写的方法也没有用」把【诊断】里的建议改对了
//   （真正收回后台网页的是系统省电与后台管控；Edge「睡眠标签页」/ Chrome「内存节省程序」只管浏览器标签页，
//   桌面快捷方式与独立 PWA 不受它约束），但同一句话在【设置页行下红条 #bg-keep-sub】、
//   【settings-help 功能说明「后台保活」「后台通知」】、【使用说明第 10 节两条】里还留着旧的结论
//   ——用户按哪一面镜子做都不一定对，三处文案互相打架。
//
// 本批（纯文案面，零机型／零 UA 分支：判据只取「这句话在不在用户看得见的页面上」）：
//   使用说明第 11 节新增三条（这一型「卡」的长相＋安卓四步＋PWA≠标签页的纠偏＋iPhone 两条）、
//   第 10 节前提 5 与「挂久了会截断/失效」两条补齐（最近任务锁定／别划掉／桌面图标改那两处没用）、
//   第 12 节「保活 / 通知被系统悄悄杀掉」同口径、关于 #about-perf-note 补三步、
//   #bg-keep-sub 与 settings-help 两条里把「最有效的一步＝关 Chrome 内存节省程序」整句撤掉换成系统侧动作。
//
// 断言：
//   S 组 产物静态锚（不开浏览器）：S1 本批八处新文案在产物里各命中恰 1 次／S2 被撤的旧结论在两个产物文件里 0 命中
//     （红侧＝各 1 次命中）／S3 #1199 那面已经改对的镜子（js/device.js 诊断【保活现场】）一字未动／
//     S4 第 11 节标题上的条数＝src 实际条数（防漂移）／S5 指路口径统一（两处功能说明都写「详见 使用说明第 11 节」）
//   A 组 本批新契约（无头真跑产物、360×752 报障机型现场、真走 设置→关于→使用说明 与功能说明胶囊）：
//     A1 第 11 节展开后「还有一类「卡」＝手机把网页收回了」那条在屏上（红侧＝整条不存在）／
//     A2 同条里安卓四步的关键动作都在屏上／A3 「标签页开关管不到桌面 PWA」那条纠偏在屏上／
//     A4 iPhone 两条（装桌面躲 7 天规则＋别开低电量模式）在屏上／A5 第 10 节前提 5 补齐／
//     A6 第 10 节「挂久了会截断/失效」那条补齐／A7 第 12 节保活条补齐／
//     A8 #bg-keep-sub 屏上文本的最有效一步指向系统设置（红侧逐字＝Chrome 设置→性能→内存节省程序）／
//     A9 真点「后台保活」功能说明胶囊：弹窗文本同口径且旧句不在／A10 真点「后台通知」胶囊同一条／
//     A11 关于 #about-perf-note 屏上文本含三步与指路／A12 第 11 节屏上条数＝标题上的条数／
//     A13 说明页页内搜索「省电」命中这一条动作清单（写进去还要找得到）
//   B 组 旧契约不许动（两侧皆绿＝本批只加不改旧内容）：B1 第 11 节「千万别做：别用清除本地数据治卡顿」仍在／
//     B2 #884 那条「低电量模式把整机调半速」原话仍在／B3 #bg-keep-sub 行下红条本体仍在（#977a）／
//     B4 设置搜索「卡顿」仍命中使用说明行／B5 使用说明页节号连续且本批不新增节／
//     B6 「后台保活」功能说明里三条硬限制原文未动（本批只换那一句）
//   Z 组 全程零未捕获 JS 异常
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = resolve(normalize(process.argv[2] || process.env.SERVE_ROOT || here));
const USE_WEBKIT = !!process.env.USE_WEBKIT;
console.log('serve root = ' + root + '  engine = ' + (USE_WEBKIT ? 'webkit' : 'chromium'));
if (!existsSync(join(root, 'index.html'))) {
  console.error('✗ 被测根目录没有 index.html（喂错目录了：所有断言会一起红，看起来像「修复没生效」）');
  process.exit(2);
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (/\/$/.test(req.url.split('?')[0])) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port + '/';

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + String(x).slice(0, 320) + ']' : '')); } };
const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const hits = (hay, needle) => hay.split(needle).length - 1;

// ── S 组：产物静态锚 ──
const idx = read('index.html');
const shProd = read('js/settings-help.js');
// device.js 是内联件（在 index.html 里，不在 js/ 下）——#1199 那面镜子要从产物 index.html 里读
const devProd = idx;
console.log('—— S 组 产物静态锚');
const NEW = [
  ['第 11 节新增「另一种卡＝手机把网页收回了」条目标题', '<b>还有一类「卡」不是数据多，是手机把网页收回了</b>'],
  ['安卓四步里的系统级动作（别让它「优化」这个应用）', '别让它「优化」这个应用'],
  ['「标签页开关管不到桌面 PWA」纠偏', '<b>去改那两处没有用</b>'],
  ['#bg-keep-sub 的最有效一步指向系统设置', '止住它最有效的一步＝去 系统设置 → 应用'],
  ['iPhone 两条（别开低电量模式）', '② <b>别开「低电量模式」</b>'],
  ['第 10 节前提 5 补齐桌面 PWA 纠偏', '已加到桌面的本站是独立应用，改那两处没有用'],
  ['第 12 节保活条补齐', '对已加到桌面的本站没有用'],
  ['关于 #about-perf-note 补「另一种卡」三步', '<b>另一种「卡」不是数据多，是手机把网页收回了</b>'],
];
ok(NEW.every(([, s]) => hits(idx, s) === 1), 'S1 本批八处新文案在产物 index.html 里各命中恰 1 次',
  NEW.map(([n, s]) => (hits(idx, s) === 1 ? '' : n + '=' + hits(idx, s))).join(' '));
const OLD = ['【止住回收最有效的一步】Chrome：设置 → 性能', '止住它最有效的一步＝Chrome 设置→性能'];
ok(hits(shProd, OLD[0]) === 0 && hits(idx, OLD[1]) === 0, 'S2 被撤的旧结论在两个产物文件里 0 命中（复活＝同一件事三面镜子互相打架）',
  'settings-help=' + hits(shProd, OLD[0]) + ' index=' + hits(idx, OLD[1]));
ok(devProd.includes('只管浏览器标签页，桌面快捷方式与独立 PWA 不受它约束'),
  'S3 #1199 那面已经改对的镜子（诊断【保活现场】）一字未动', 'hit=' + (devProd.includes('只管浏览器标签页，桌面快捷方式与独立 PWA 不受它约束') ? 1 : 0));
const tplSrc = read('src/template.html');
const sec11 = (() => {
  // 锚在 summary 那一行（「手机卡顿怎么办」这句在别的节里也出现，按标题串找会找到错的那一节）
  const i = tplSrc.indexOf('<span class="lg-num">11</span><span class="lg-name">手机卡顿怎么办（安卓 / iPhone）</span>');
  if (i < 0) return { declared: 0, actual: 0, missing: true };
  const declared = Number((/lg-count">(\d+)</.exec(tplSrc.slice(i, i + 200)) || [0, 0])[1]);
  const next = tplSrc.indexOf('<span class="lg-num">', i + 10);
  const body = tplSrc.slice(i, next < 0 ? tplSrc.length : next);
  return { declared, actual: body.split('<div class="lic-li"').length - 1 };
})();
ok(sec11.declared === sec11.actual && sec11.actual >= 20, 'S4 第 11 节标题上的条数＝src 实际条数（防漂移，两侧皆须成立）', JSON.stringify(sec11));
const sHelp = read('js/settings-help.js');
ok(hits(sHelp, '详见 使用说明第 11 节') === 1 && hits(idx, '使用说明第 11 节') >= 2, 'S5 各面镜子都指回同一节（口径统一，不各说各话）', 'sh=' + hits(sHelp, '详见 使用说明第 11 节') + ' idx=' + hits(idx, '使用说明第 11 节'));

// ── 浏览器现场 ──
const browser = await (USE_WEBKIT ? webkit : chromium).launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 360, height: 752 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e && e.message).slice(0, 160)));
await page.addInitScript(() => {
  window.__modals = [];
  const poll = setInterval(() => {
    try {
      if (typeof window.openModal === 'function' && !window.openModal.__mcap) {
        const real = window.openModal;
        const wrap = function (t, v, cb, o) {
          try { window.__modals.push({ title: String(t || ''), text: String((o && o.staticText) || '') }); if (window.__modals.length > 24) window.__modals.shift(); } catch (e) {}
          return real.apply(null, arguments);
        };
        wrap.__mcap = 1; window.openModal = wrap;
      }
    } catch (e) {}
  }, 60);
  setTimeout(() => clearInterval(poll), 60000);
});
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.mochiDataState && window.mochiDataState() === 'ready', null, { timeout: 60000 }).catch(() => {});
await page.evaluate(() => {
  const s = document.querySelector('.splash'); if (s) s.remove();
  document.querySelectorAll('.backup-remind-bar, .ver-update-bar').forEach((n) => n.remove());
  const mm = document.getElementById('modal-mask'); if (mm) mm.hidden = true;
});
await page.waitForTimeout(600);

const ev = (fn, arg) => page.evaluate(fn, arg);
// 展开说明页某一节并读出该节每条文本（走产品自己的入口链：点设置 tab → 关于 tag → 使用说明行）
const openGuide = async () => ev(() => {
  const t = document.querySelector('.tab[data-page="page-setting"]'); if (t) t.click();
  return !!t;
});
const clickAboutTab = () => ev(() => {
  const t = document.querySelector('#set-tabs .them-tab[data-tab="about"]'); if (t) t.click();
  return !!t;
});
const enterGuide = () => ev(() => {
  const r = document.getElementById('row-guide'); if (r) r.click();
  const g = document.getElementById('page-guide');
  return !!g && !g.hidden;
});
const secRead = (num) => ev((want) => {
  const grp = [].slice.call(document.querySelectorAll('#page-guide .lic-grp')).find((g) => {
    const n = g.querySelector('.lg-num'); return n && n.textContent.trim() === want;
  });
  if (!grp) return { exists: false, hidden: true, name: '', count: 0, items: [], texts: [] };
  if (grp.tagName === 'DETAILS') grp.open = true;
  const li = [].slice.call(grp.querySelectorAll('.lic-li'));
  return {
    exists: true,
    hidden: grp.hidden === true || grp.offsetParent === null,
    name: (grp.querySelector('.lg-name') || {}).textContent || '',
    count: Number((grp.querySelector('.lg-count') || {}).textContent || 0),
    items: li.length,
    texts: li.map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
  };
}, String(num));

console.log('—— A 组 本批新契约（屏上真读得到）');
ok(await openGuide() && await clickAboutTab(), 'A0a 能进设置页并切到「关于」tag（夹具诚实）');
ok(await enterGuide(), 'A0b 点「使用说明」行进入说明页（夹具诚实）');
const s11 = await secRead('11');
const t11 = (s11.texts || []).join('\n');
const has11 = (kw) => t11.includes(kw);
ok(s11.exists && has11('还有一类「卡」不是数据多，是手机把网页收回了'), 'A1 第 11 节展开后有「另一种卡＝手机把网页收回了」这一条（红侧＝整条不存在）',
  'exists=' + s11.exists);
ok(has11('无限制 / 允许后台活动') && has11('最近任务') && has11('不要横向划掉它') && has11('别让它「优化」这个应用') && has11('叫法各不相同'),
  'A2 同条里安卓四步的关键动作都在屏上（省电策略／最近任务锁定／别划掉／各家叫法不同）');
ok(has11('一个容易白忙活的地方') && has11('睡眠标签页') && has11('独立应用') && has11('去改那两处没有用'),
  'A3 「Edge 睡眠标签页 / Chrome 内存节省程序管的是标签页，桌面 PWA 改那两处没有用」这条纠偏在屏上');
ok(has11('别开「低电量模式」') && has11('7 天规则') && has11('被系统回收过'),
  'A4 iPhone 侧两条（装到桌面躲 7 天规则＋别开低电量模式）与回收计数指路在屏上');
const s10 = await secRead('10');
const t10 = (s10.texts || []).join('\n');
ok(t10.includes('无限制 / 允许后台活动') && t10.includes('别横向划掉') && t10.includes('已加到桌面的本站是独立应用，改那两处没有用'),
  'A5 第 10 节「前提 5 · 别限制后台」补齐两步＋桌面 PWA 纠偏（红侧＝只有一句「不受限制」）', 'n=' + s10.items);
ok(t10.includes('已经加到手机桌面的本站是独立应用，那两处管不到它'),
  'A6 第 10 节「挂久了会截断/失效」那条不再只让用户去改标签页名单（红侧＝只有「永不睡眠」名单那句）');
const s12 = await secRead('12');
const t12 = (s12.texts || []).join('\n');
ok(t12.includes('省电 / 电池策略') && t12.includes('无限制 / 允许后台活动') && t12.includes('对已加到桌面的本站没有用'),
  'A7 第 12 节「保活 / 通知被系统悄悄杀掉」给的是系统侧动作＋纠偏（红侧＝只说「把该浏览器设为不受限制」）');

// 设置页 #bg-keep-sub（系统 tag 的行下红条）
const subTxt = await ev(() => {
  const sys = document.querySelector('#set-tabs .them-tab[data-tab="system"]'); if (sys) sys.click();
  const el = document.getElementById('bg-keep-sub');
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
});
ok(subTxt.includes('止住它最有效的一步＝去 系统设置 → 应用') && !subTxt.includes('止住它最有效的一步＝Chrome 设置→性能'),
  'A8 设置页「后台保活」行下红条：最有效那一步指向系统设置（红侧逐字＝Chrome 设置→性能→内存节省程序）', 'len=' + subTxt.length);

// 真点功能说明胶囊（文案从 openModal 入参取，不读 #modal-static：站内别的模态也会开）
const capsule = async (sel) => {
  await ev((s) => {
    const tag = document.querySelector('[data-setdesc="' + s + '"]');
    window.__modals.length = 0;
    if (tag) tag.click();
    return !!tag;
  }, sel);
  await page.waitForTimeout(260);
  return ev(() => {
    const list = window.__modals.filter((m) => /^【/.test(m.title));
    const last = list[list.length - 1] || { title: '', text: '' };
    const mm = document.getElementById('modal-mask'); if (mm) mm.hidden = true;
    return { title: last.title, text: last.text };
  });
};
const mk = await capsule('#bg-keepalive');
ok(mk.title.includes('后台保活') && mk.text.includes('系统设置 → 应用') && mk.text.includes('无限制 / 允许后台活动') && mk.text.includes('管不到它') && !mk.text.includes('内存节省程序」关掉'),
  'A9 真点「后台保活」功能说明：弹窗文本给系统侧动作且不再让用户去关标签页开关（红侧＝只教关内存节省程序）', 'title=' + mk.title + ' len=' + mk.text.length);
const mn = await capsule('#bg-notify');
ok(mn.title.includes('后台通知') && mn.text.includes('【止住回收最有效的一步】先去 系统设置 → 应用') && !mn.text.includes('【止住回收最有效的一步】Chrome：设置 → 性能'),
  'A10 真点「后台通知」功能说明：「止住回收最有效的一步」那章的动作在系统侧（红侧逐字＝Chrome：设置 → 性能）', 'title=' + mn.title + ' len=' + mn.text.length);

const aboutTxt = await ev(() => {
  const ab = document.querySelector('#set-tabs .them-tab[data-tab="about"]'); if (ab) ab.click();
  const el = document.getElementById('about-perf-note');
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
});
ok(aboutTxt.includes('另一种「卡」不是数据多，是手机把网页收回了') && aboutTxt.includes('无限制 / 允许后台活动') && aboutTxt.includes('最近任务里把本站') && aboutTxt.includes('使用说明第 11 节'),
  'A11 关于页那条警示条屏上文本含三步与指路（红侧＝只讲省电模式调半速）', 'len=' + aboutTxt.length);
ok(s11.count === s11.items && s11.items === sec11.actual, 'A12 第 11 节屏上条数＝标题上的条数＝src 条数（三处一致，改条目必须同改计数）',
  'screen=' + s11.items + ' badge=' + s11.count + ' src=' + sec11.actual);

// 写进去还要找得到：说明页页内搜索按 .lic-li 文本过滤（personalize.js 的 guide-search），新条目必须被搜到
await openGuide(); await clickAboutTab(); await enterGuide(); await page.waitForTimeout(300);
const gs = await ev(() => {
  const i = document.getElementById('guide-search');
  if (!i) return { err: 'no-search-box' };
  i.value = '省电'; i.dispatchEvent(new Event('input'));
  const grp = [].slice.call(document.querySelectorAll('#page-guide .lic-grp')).find((g) => {
    const n = g.querySelector('.lg-num'); return n && n.textContent.trim() === '11';
  });
  if (!grp) return { err: 'no-sec-11' };
  if (grp.tagName === 'DETAILS') grp.open = true;
  const vis = [].slice.call(grp.querySelectorAll('.lic-li')).filter((li) => li.style.display !== 'none' && !li.hidden);
  const out = {
    visN: vis.length,
    act: vis.some((x) => /无限制\s*\/\s*允许后台活动/.test(x.textContent)),
    hit: vis.map((x) => x.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)).join(' | ').slice(0, 200),
  };
  i.value = ''; i.dispatchEvent(new Event('input'));
  return out;
});
ok(gs.visN >= 1 && gs.act === true, 'A13 说明页页内搜索「省电」能命中这一条动作清单（写进去还要找得到；红侧＝搜不到系统省电那四步）', JSON.stringify(gs));

console.log('—— B 组 旧契约不许动（两侧皆绿）');
ok(t11.includes('千万别做') && t11.includes('不要用「清除本地数据」来治卡顿'), 'B1 第 11 节「千万别做：别用清除本地数据治卡顿」原条仍在（本批只加不改旧内容）');
ok(aboutTxt.includes('低电量模式') && aboutTxt.includes('关掉立刻恢复'), 'B2 #884 那条「省电模式把整机调半速」原话仍在');
ok(subTxt.includes('两条必知限制') && subTxt.includes('别的 App 刷视频、听音乐会把保活截断'), 'B3 #bg-keep-sub 行下红条本体与两条限制仍在（#977a 口径）', 'len=' + subTxt.length);
const searchHit = await ev(() => {
  const i = document.getElementById('set-search-input');
  if (!i) return 'no-search-box';
  i.value = '卡顿'; i.dispatchEvent(new Event('input'));
  const row = document.getElementById('row-guide');
  const vis = !!row && row.style.display !== 'none' && !row.hidden;
  i.value = ''; i.dispatchEvent(new Event('input'));
  return vis ? 'ok' : 'miss';
});
ok(searchHit === 'ok', 'B4 设置搜索「卡顿」仍命中使用说明行（改文案不许把命中改掉）', searchHit);
const nums = await ev(() => [].slice.call(document.querySelectorAll('#page-guide .lic-grp .lg-num')).map((n) => n.textContent.trim()).join(','));
const numList = nums.split(',').map(Number);
ok(numList.length >= 14 && numList.every((n, k) => n === k + 1), 'B5 使用说明页节号连续（本批只加条目、不加节；红侧同绿＝旧契约）', nums);
ok(mk.text.includes('别的 App 刷视频') && mk.text.includes('不联网上传') && mk.text.includes('这是手机 / 浏览器的限制'),
  'B6 「后台保活」功能说明里三条硬限制原文未动（本批只换那一句结论）', 'len=' + mk.text.length);

ok(errs.length === 0, 'Z1 全程零未捕获 JS 异常', errs.slice(0, 4).join(' | '));
console.log('\n===== 读数：' + pass + ' 绿 / ' + fail + ' 红 =====');
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
