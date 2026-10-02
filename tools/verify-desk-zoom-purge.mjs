// ===== 回归脚本：#707 iPhone「全局滑动卡顿 + 桌面翻页灰屏」三修＋采样去污染 =====
// 背景（用户直派，同族 #690 二次复发；iPhone15ProMax Safari 26.6.1 standalone＋Via、多机型同现）：
//   「滑动卡顿无法正常使用／空白浏览器刚进应用就卡／桌面滑动卡成灰屏」。诊断实锤：
//   ①html 类带 tablet（430×932 手机被 Macintosh 伪装 UA 误判平板）；②翻页帧采样 p90≈991ms
//   而长任务为零＝渲染合成层卡；③「平均 2543ms」实为一条 144s 切后台间隙拉爆的假读数。
// 三修（全零机型分支）：
//   A device.js：Macintosh 伪装平板分支补「screen 短边 ≥600」——iPhone 全系回手机布局。
//   B zoom 声明按类门控——home.css 两条 zoom 规则加 html.desk-zoom-font/card 前缀，
//     personalize.js syncDeskZoomClass（宽窗>901px 且非平板且值≠1）挂类；手机/平板/默认值
//     零 zoom 声明（WebKit 新 zoom 实现连 zoom:1 声明也让子树进继承/布局路径）；base.css
//     的 force-mobile / tablet 两组 zoom:1 重置块随之删除。
//   C .desktop-pages 删 -webkit-overflow-scrolling:touch（legacy 动量旗标）。
//   D 采样器剔除 document.hidden 冻结帧（hid 落键＋诊断标注）。
// 本脚本怎么判：
//   S 组  产物/源码静态断言（先 node build.mjs 再跑本脚本＝测真实产物）。
//   B 组  真渲染断言：默认态零缩放类、加类+变量后缩放真生效、手机形态媒体查询仍钉 1、翻页正常。
//   C 组  采样器在「伪造 document.hidden」下剔除后台帧并把 hid 落键。
// 用法：node build.mjs && node tools/verify-desk-zoom-purge.mjs
//   MOCHI_ROOT=<已构建目录> 可测隔离副本。RED 判别：把 home.css 两条 zoom 规则的前缀去掉再构建
//   ＝S1 红；把 .desktop-pages 写回 -webkit-overflow-scrolling:touch 再构建＝S2 红；把 device.js
//   的 `&& _mScreen >= 600` 删掉再构建＝S3 红；采样器删 document.hidden 分支＝S4/C1 红。
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail === undefined ? '' : '  [' + detail + ']'));
}

// ---------- 产物与源码文本 ----------
const artText = (() => { try { return readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) { return ''; } })();
const srcText = (p) => { try { return readFileSync(join(root, 'src', p), 'utf8'); } catch (e) { return ''; } };

// ---------- S 组：静态断言 ----------
// S1 产物 CSS：凡含 zoom: 声明的行必须带 html.desk-zoom 前缀（无前缀＝手机桌面又常年带 zoom 声明跑）
const cssBlocks = [...artText.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const zoomLines = cssBlocks.split('\n').filter((l) => /(^|[\s;{])zoom:/.test(l));
check('S1 产物 CSS 中所有 zoom: 声明都带 html.desk-zoom 前缀（' + zoomLines.length + ' 条）',
  zoomLines.length >= 3 && zoomLines.every((l) => /html\.desk-zoom/.test(l)),
  zoomLines.filter((l) => !/html\.desk-zoom/.test(l)).map((l) => l.slice(0, 60)).join(' | '));
// S1b 旧的重置块不再存在（声明删除而非兜底）
check('S1b 产物 CSS 不再有 force-mobile/tablet 的 zoom:1 重置（类门控后触屏形态零声明）',
  !/html\.(force-mobile|tablet)[^{}\n]*\{[^}]*zoom:/.test(cssBlocks));
// S2 翻页层不带 legacy 动量旗标：.desktop-pages 规则块内无 -webkit-overflow-scrolling
const dpIdx = cssBlocks.indexOf('.desktop-pages{') >= 0
  ? cssBlocks.indexOf('.desktop-pages{')
  : cssBlocks.indexOf('.desktop-pages {');
let dpBlock = '';
if (dpIdx >= 0) {
  const end = cssBlocks.indexOf('}', dpIdx);
  dpBlock = cssBlocks.slice(dpIdx, end + 1);
}
check('S2 .desktop-pages 规则块已无 -webkit-overflow-scrolling（出灰屏的横向翻页层不再钉回老式滚动路径）',
  dpBlock.length > 0 && !dpBlock.includes('-webkit-overflow-scrolling'), dpBlock.slice(0, 90));
// S3 平板误判补屏宽门
check('S3 device.js Macintosh 伪装平板分支带 screen 短边 ≥600 门',
  srcText('js/device.js').includes("&& 'ontouchstart' in window && _mScreen >= 600);"));
// S4 采样器剔除后台帧
const sliderJs = srcText('js/desktop-slider.js');
check('S4 翻页采样器有 document.hidden 剔除分支（hid 计数 + 基线重置）',
  sliderJs.includes('document.hidden') && sliderJs.includes('hid++') && sliderJs.includes('last = 0;'));
// S5 诊断标注剔除帧数
check('S5 诊断【性能】标注「已剔除后台帧 N」',
  srcText('js/device.js').includes('已剔除后台帧'));
// S6 类门控函数与接线（主设置页写值 + 抽屉写值 + 弹窗 onChange）
const plzJs = srcText('js/personalize.js');
const callN = (plzJs.match(/syncDeskZoomClass\(\)/g) || []).length;
check('S6 personalize.js 有 syncDeskZoomClass 定义且接线 ≥5 处（定义 1 + 调用 ≥4）',
  plzJs.includes('function syncDeskZoomClass() {') && callN >= 5, '调用/定义合计=' + callN);

// ---------- B 组：真渲染 ----------
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const srv = createServer((req, res) => {
  let data;
  try {
    const p = join(root, decodeURIComponent((req.url || '/').split('?')[0]));
    data = readFileSync(p);
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
  } catch (e) { res.writeHead(404); res.end('nf'); return; }
  res.end(data);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port + '/index.html';
const browser = await chromium.launch({ headless: true });

async function enterApp(page) {
  for (let i = 0; i < 14; i++) {
    const done = await page.evaluate(() => {
      const ph = document.querySelector('.phone');
      if (ph && getComputedStyle(ph).visibility !== 'hidden') return true;
      const sp = document.getElementById('splash');
      if (!sp || sp.classList.contains('hide')) return true;
      const mand = document.getElementById('splash-mandatory');
      if (mand && !mand.hidden) {
        const ms = document.getElementById('splash-mandatory-scroll');
        if (ms) { ms.scrollTop = ms.scrollHeight; ms.dispatchEvent(new Event('scroll')); }
        const me = document.getElementById('splash-mandatory-enter');
        if (me && !me.classList.contains('is-disabled')) { me.click(); return false; }
        return false;
      }
      const sb = document.getElementById('splash-box');
      if (sb) { sb.scrollTop = sb.scrollHeight; sb.dispatchEvent(new Event('scroll')); }
      const age = document.getElementById('splash-age-check');
      if (age && !age.checked) { age.checked = true; age.dispatchEvent(new Event('change')); }
      const en = document.getElementById('splash-enter');
      if (en && !en.hidden) { en.click(); return false; }
      return false;
    });
    if (done === true) break;
    await sleep(450);
  }
  await sleep(600);
}

// B 组场景 1：桌面模拟器形态（宽窗 1280×900，>901px 命中类门控的宽窗条件）
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'load' });
  await sleep(2500);
  await enterApp(page);
  const st = await page.evaluate(() => {
    const d = document.documentElement;
    // CSSOM 扫描：凡选择器命中 .page-slide 且带 zoom 的规则必须带 desk-zoom 前缀
    let zoomedRules = 0, badSel = [];
    for (const ss of document.styleSheets) {
      let rules; try { rules = ss.cssRules; } catch (e) { continue; }
      for (const r of rules) {
        const st = (r.selectorText || '') + '';
        if (st.includes('.page-slide') && r.style && r.style.zoom && r.style.zoom !== '') {
          zoomedRules++;
          if (!st.includes('html.desk-zoom')) badSel.push(st);
        }
      }
    }
    const ps = document.querySelector('.page-slide');
    return {
      clsF: d.classList.contains('desk-zoom-font'),
      clsC: d.classList.contains('desk-zoom-card'),
      zoomedRules, badSel,
      psZoomDefault: ps ? getComputedStyle(ps).zoom : null
    };
  });
  check('B1 默认态（宽窗、值=100%）html 无 desk-zoom-font/card 类', !st.clsF && !st.clsC, JSON.stringify(st));
  check('B1b CSSOM 中命中 .page-slide 的 zoom 规则全部带 html.desk-zoom 前缀（' + st.zoomedRules + ' 条）',
    st.zoomedRules >= 1 && st.badSel.length === 0, st.badSel.join(' | '));
  // B2 加类+变量后缩放真生效（门控 CSS 真能改变应用值——这是本修复的承载面）
  const st2 = await page.evaluate(() => {
    const d = document.documentElement;
    const ps = document.querySelector('.page-slide');
    const before = getComputedStyle(ps).zoom;
    d.classList.add('desk-zoom-font');
    d.style.setProperty('--desk-font-scale', '1.2');
    const on = getComputedStyle(ps).zoom;
    d.classList.remove('desk-zoom-font');
    d.style.removeProperty('--desk-font-scale');
    return { before: String(before), on: String(on) };
  });
  check('B2 挂 desk-zoom-font 类 + 变量 1.2 后 .page-slide 计算缩放真变（' + st2.before + '→' + st2.on + '）',
    st2.before === '1' && parseFloat(st2.on) > 1.1 && parseFloat(st2.on) < 1.3, JSON.stringify(st2));
  // B3 翻页仍正常（圆点跟随 + deskIdx 前进），防本批改坏翻页面
  const st3 = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.deskGo(1);
    await wait(120);
    return { idx: window.deskIdx ? window.deskIdx() : -1 };
  });
  check('B3 deskGo(1) 翻页正常（deskIdx=1）', st3.idx === 1, JSON.stringify(st3));
  await ctx.close();
}

// B 组场景 2：手机形态（430×932）——即便变量被设成 1.2，也没有类挂上（JS 门控非平板+窄窗）
{
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'load' });
  await sleep(2500);
  await enterApp(page);
  const st = await page.evaluate(() => {
    const d = document.documentElement;
    d.style.setProperty('--desk-font-scale', '1.2'); // 模拟手机上残留的缩放设置（设置仍可保存）
    return {
      clsF: d.classList.contains('desk-zoom-font'),
      tablet: d.classList.contains('tablet'),
      isTablet: !!(window.mochiDevice && window.mochiDevice.isTablet),
      isIOS: !!(window.mochiDevice && window.mochiDevice.isIOS),
      uaIphone: /iphone/i.test(navigator.userAgent)
    };
  });
  // iOS 伪装 UA（Macintosh）也必须判成手机而非平板（#707 修复面）；iPhone UA 本身同样
  check('B4 手机形态（430×932）不挂缩放类、不误判平板（isTablet=false；isIOS 仍 true）',
    !st.clsF && !st.tablet && !st.isTablet && (st.isIOS || !st.uaIphone), JSON.stringify(st));
  await ctx.close();
}

// B5（#707a 判别力核心）：Macintosh 伪装 UA（iPhone「请求桌面网站」/ iPadOS 13+ 同一信号）
//   ×触摸屏 ——430×932 手机必须判手机（修复前此形态误判平板＝RED）；768×1024 照判平板（护 iPad）
{
  const macUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Safari/605.1.15';
  const probe = async (vp) => {
    const ctx = await browser.newContext({ viewport: vp, hasTouch: true, userAgent: macUA, deviceScaleFactor: 3, isMobile: true });
    // headless chromium 的 maxTouchPoints 恒为 1（<伪装分支要求的 >1），拟真成真机值 5
    await ctx.addInitScript(() => {
      try { Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5, configurable: true }); } catch (e) {}
    });
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await sleep(900); // device.js 是首个脚本，判定在加载早期已完成
    const r = await page.evaluate(() => ({
      tabletCls: document.documentElement.classList.contains('tablet'),
      isTablet: !!(window.mochiDevice && window.mochiDevice.isTablet),
      isMobile: !!(window.mochiDevice && window.mochiDevice.isMobile),
      isIOS: !!(window.mochiDevice && window.mochiDevice.isIOS),
      sw: screen.width, sh: screen.height
    }));
    await ctx.close();
    return r;
  };
  const phone = await probe({ width: 430, height: 932 });
  check('B5a Macintosh 伪装 UA + 430×932 触摸屏＝手机（不判平板；isIOS 仍 true）',
    !phone.tabletCls && !phone.isTablet && phone.isMobile && phone.isIOS, JSON.stringify(phone));
  const pad = await probe({ width: 768, height: 1024 });
  check('B5b Macintosh 伪装 UA + 768×1024 触摸屏＝平板（iPad 分支不受 #707a 影响）',
    pad.tabletCls && pad.isTablet, JSON.stringify(pad));
}

// C 组：采样器剔除伪造的后台帧
{
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'load' });
  await sleep(2500);
  await enterApp(page);
  const st = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    localStorage.removeItem('xy-home-v2:__diag-deskperf');
    // 伪造后台态：rAF 在无头里照常跑，采样器应把 hidden 期的帧剔除（hid>0、不记巨帧）
    const doc = document;
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    Object.defineProperty(doc, 'hidden', { configurable: true, get: () => true });
    const pages = document.getElementById('desktop-pages');
    pages.dispatchEvent(new Event('scroll')); // 起采
    await wait(250); // 后台态下 ~15 帧，全部应被剔除
    Object.defineProperty(doc, 'hidden', desc);
    // 恢复前台后再等采样收尾（60 帧 ≈ 1s）
    await wait(2200);
    let dp = null;
    try { dp = JSON.parse(localStorage.getItem('xy-home-v2:__diag-deskperf') || 'null'); } catch (e) {}
    return { dp, hidExpect: dp ? dp.hid >= 1 : false, sane: dp ? dp.mean < 500 : false, n: dp ? dp.n : 0 };
  });
  check('C1 采样器剔除伪造后台帧（hid>0 且落键、均值 <500ms、样本 ' + st.n + ' 帧）',
    !!st.dp && st.hidExpect && st.sane, JSON.stringify(st.dp));
  await ctx.close();
}

await browser.close();
srv.close();

const bad = results.filter((r) => !r.ok);
console.log('\n结果：' + (results.length - bad.length) + '/' + results.length + (bad.length ? '（RED：上列 FAIL 项即回归面）' : '（GREEN）'));
process.exit(bad.length ? 1 : 0);
