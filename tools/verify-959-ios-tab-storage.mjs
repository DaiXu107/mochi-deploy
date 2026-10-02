// ===== 回归验证：#959 iPhone / iOS Safari 标签页（未添加到主屏幕）「总是丢数据」风险面 =====
// 报障（用户实报）：iPhone 12 Pro、iOS 自带 Safari、没安装快捷方式到桌面，「总是丢失数据」；
//   用户明说其他机型也有。
// 根因（与机型无关，是平台存储策略）：WebKit ITP 在「连续 7 个 Safari 使用日无第一方互动」后
//   清空该源全部可写存储（localStorage/IndexedDB/Cache/SW）；标签页里 navigator.storage.persist()
//   几乎不授予，唯一豁免＝「添加到主屏幕」（主屏应用独立存储桶、不计入 7 天计时）。
// 本批修复：
//   ① pwa.js 持久化申请加「首次用户手势补申请」（冷启动被拒后本会话仍有第二次机会）；
//   ② 每日备份提醒在 iOS 标签页分支点名 7 天清空规则 + 加「怎么装到桌面」pill，打开分步引导，
//      写清「先导出备份→安装→在桌面应用里导入」（主屏与 Safari 是两套独立存储）；
//   ③ 开屏 iOS 安装提示点明 7 天清空风险。
//   零机型分支：Android / 桌面文案与流程一字不变（非 iOS 分支不出现任何新增内容）。
// 用法：node tools/verify-959-ios-tab-storage.mjs
//       SRCDIR=<src目录> node tools/verify-959-ios-tab-storage.mjs   # 红绿对照（对纯 HEAD 源应红）
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const srcDir = process.env.SRCDIR ? normalize(process.env.SRCDIR) : join(root, 'src');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}

// ---- S 组：源码逻辑锚（不依赖浏览器，红绿对照时对纯 HEAD 源应红） ----
const pwaSrc = readFileSync(join(srcDir, 'js', 'pwa.js'), 'utf8');
const tplSrc = readFileSync(join(srcDir, 'template.html'), 'utf8');
console.log('S 源码锚');
ok('S1 iOS 标签页高危判定函数在位（读 device.js 唯一判定源 + standalone 判据）',
  /window\.mochiIosTabRisk = function \(\) \{/.test(pwaSrc) && /navigator\.standalone === true/.test(pwaSrc) && /display-mode: standalone/.test(pwaSrc));
ok('S2 持久化首次手势补申请在位（删＝冷启动被拒后本会话再无机会）',
  /\[ 'touchend'|'touchend', 'pointerup', 'click', 'keydown'/.test(pwaSrc) && /_persistGestureDone/.test(pwaSrc));
ok('S3 备份弹窗 iOS 标签页分支文案在位（点名 Safari 7 天清空）',
  /你现在是用 Safari 打开的（没添加到主屏幕）/.test(pwaSrc) && /连续 7 天没打开本应用/.test(pwaSrc));
ok('S4 「怎么装到桌面」pill 接线在位（删＝高危场景没有可执行入口）',
  /label: '怎么装到桌面', value: 'install'/.test(pwaSrc) && /openIosInstallGuide\(\)/.test(pwaSrc));
ok('S5 分步引导写清「先导出再安装、主屏与 Safari 存储分开需导入」',
  /主屏幕应用和 Safari 是两套独立存储，不先导出/.test(pwaSrc));
ok('S6 开屏 iOS 安装提示点明 7 天清空风险（template.html）',
  /Safari 标签页 7 天不用会被系统清空数据/.test(tplSrc));
ok('S7 非 iOS 分支 pills 初值仍是「去备份/备份聊天」（iOS 专属项只 push，不改通用流程）',
  /const pills = \[\s*\{ label: '去备份', value: 'go' \},\s*\{ label: '备份聊天', value: 'chat' \}\s*\];/.test(pwaSrc)
  && /if \(iosTab\) pills\.push\(\{ label: '怎么装到桌面', value: 'install' \}\);/.test(pwaSrc));
ok('S8 关于段 iOS 7 天规则提醒条在位（用户直派「写在关于里提醒 iOS 用户」）',
  /id="about-ios-pwa-note"/.test(tplSrc) && /连续 7 天没打开本站/.test(tplSrc) && /主屏幕应用和 Safari 是两套独立存储/.test(tplSrc));
ok('S9 关于段 iOS 提醒条只对 iOS 显示（非 iOS 隐藏、JS 未跑保留）',
  /getElementById\('about-ios-pwa-note'\)/.test(pwaSrc) && /_aboutIos\.hidden = true/.test(pwaSrc));

// ---- 测试专用组装：按 build.mjs 同顺序拼临时 index.html（不碰仓库产物） ----
const buildSrc = readFileSync(join(process.env.SRCDIR ? normalize(process.env.SRCDIR + '/..') : root, 'build.mjs'), 'utf8');
const grab = (name) => JSON.parse(buildSrc.match(new RegExp('const ' + name + " = (\\[[^\\]]*\\])"))[1].replace(/'/g, '"'));
const cssFiles = grab('cssFiles'), jsFiles = grab('jsFiles');
let html = readFileSync(join(srcDir, 'template.html'), 'utf8');
html = html.replace('/*__STYLES__*/', () => cssFiles.map((f) => readFileSync(join(srcDir, 'css', f), 'utf8')).join('\n'));
html = html.replace('/*__SCRIPTS__*/', () => jsFiles.map((f) => '(function(){ try {\n' + readFileSync(join(srcDir, 'js', f), 'utf8') + '\n} catch(e){ console.error("[JS]", e && e.message); } })();').join('\n'));
html = html.split('__BUILD_INFO__').join('verify-959').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-verify-959-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), html);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(tmpRoot, rel)), hit = false;
    try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) { p = normalize(join(root, rel)); try { hit = statSync(p).isFile(); } catch (e) {} }
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true });
const pageErrors = [];

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function boot(opts = {}) {
  const ctxOpts = { viewport: { width: 390, height: 844 } };
  if (opts.ios) ctxOpts.userAgent = IPHONE_UA;
  const ctx = await browser.newContext(ctxOpts);
  const errsLocal = [];
  ctx.on('page', (p) => { p.on('pageerror', (e) => errsLocal.push(String(e && e.message).slice(0, 160))); });
  await ctx.addInitScript(([o]) => {
    if (!/^https?:/.test(location.href)) return;
    const G = 'xy-home-v2:';
    localStorage.setItem(G + 'contacts', JSON.stringify([{ id: 'default', name: '小美' }]));
    localStorage.setItem(G + 'active-contact', 'default');
    localStorage.setItem(G + 'migrated-v1', '1');
    localStorage.setItem(G + 'applock-en', '0');
    localStorage.setItem(G + 'applock-qa-en', '0');
    localStorage.setItem(G + 'desk-checkin-en', '0');
    localStorage.setItem(G + 'desk-call-en', '0');
    localStorage.setItem(G + 'psync-en', '0');
    localStorage.setItem(G + 'bg-notify', '0');
    localStorage.setItem(G + 'default:dcf-enabled', '0');
    localStorage.setItem(G + '__last-backup', String(Date.now() - 5 * 86400000));
    for (const k in (o.keys || {})) {
      const v = o.keys[k];
      if (v === null) localStorage.removeItem(G + k); else localStorage.setItem(G + k, String(v));
    }
  }, [opts]);
  const page = await ctx.newPage();
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  page.setDefaultTimeout(30000);
  const snap = () => page.evaluate(() => {
    const vis = (el) => !!(el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().height > 8);
    const mask = document.getElementById('modal-mask');
    const box = mask ? mask.querySelector('.modal') : null;
    const stat = document.getElementById('modal-static');
    const title = document.getElementById('modal-title');
    const pills = Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill')).map((x) => x.textContent.trim());
    const aboutIos = document.getElementById('about-ios-pwa-note');
    return {
      ios: !!(window.mochiDevice || {}).isIOS,
      iosTabRisk: typeof window.mochiIosTabRisk === 'function' ? window.mochiIosTabRisk() : null,
      aboutIosPresent: !!aboutIos,
      aboutIosHidden: aboutIos ? !!aboutIos.hidden : null,
      ourModal: !!(vis(mask) && box && vis(box) && /数据会被自动清空/.test(title ? title.textContent : '')),
      guideModal: !!(vis(mask) && box && vis(box) && /装到桌面/.test(title ? title.textContent : '')),
      title: title ? title.textContent : '',
      staticText: stat && !stat.hidden ? String(stat.textContent || '') : '',
      pills: pills
    };
  });
  return {
    ctx, page, errsLocal,
    async close() { pageErrors.push(...errsLocal); try { await ctx.close(); } catch (e) {} },
    snap,
    enter: () => page.evaluate(() => {
      const s = document.getElementById('splash');
      if (s) { s.classList.add('hide'); setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 400); }
      return true;
    }),
    wait: (ms) => page.waitForTimeout(ms),
    waitForSnap: async (pred, ms) => {
      const deadline = Date.now() + (ms || 12000);
      while (Date.now() < deadline) {
        const st = await pred();
        if (st.hit) return st;
        await page.waitForTimeout(400);
      }
      return pred();
    },
    clickPill: (label) => page.evaluate((l) => {
      const b = Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill')).filter((x) => x.textContent.trim() === l)[0];
      if (!b) return false;
      b.click();
      return true;
    }, label)
  };
}

console.log('\nB1 非 iOS（对照）：备份提醒不含 iOS 专属内容，pills 保持三档');
{
  const b = await boot();
  await b.wait(1500); await b.enter();
  const r = await b.waitForSnap(async () => { const st = await b.snap(); return { hit: st.ourModal, st }; }, 15000);
  const st = r.st;
  ok('B1a 非 iOS 会话照常弹每日备份提醒', st.ourModal, { title: st.title });
  ok('B1b 非 iOS 判定为 false（不走高危分支）', st.ios === false && st.iosTabRisk === false, { ios: st.ios, risk: st.iosTabRisk });
  ok('B1c 非 iOS 文案不含「用 Safari 打开的」高危段', !/你现在是用 Safari 打开的/.test(st.staticText), st.staticText.slice(0, 80));
  ok('B1d 非 iOS pills 恰为 去备份/备份聊天/稍后（无「怎么装到桌面」）',
    st.pills.join(',') === '去备份,备份聊天,稍后', st.pills);
  ok('B1e 非 iOS 隐藏关于段 iOS 提醒条（安卓用户不被 iPhone 专属提醒打扰）',
    st.aboutIosPresent === true && st.aboutIosHidden === true, { present: st.aboutIosPresent, hidden: st.aboutIosHidden });
  await b.close();
}

console.log('\nB2 iOS 标签页：点名 7 天清空 + 提供「怎么装到桌面」分步引导');
{
  const b = await boot({ ios: true });
  await b.wait(1500); await b.enter();
  const r = await b.waitForSnap(async () => { const st = await b.snap(); return { hit: st.ourModal, st }; }, 15000);
  const st = r.st;
  ok('B2a iOS 会话照常弹每日备份提醒', st.ourModal, { title: st.title });
  ok('B2b iOS + 非 standalone 判定为高危', st.ios === true && st.iosTabRisk === true, { ios: st.ios, risk: st.iosTabRisk });
  ok('B2c 文案点名「用 Safari 打开的（没添加到主屏幕）」', /你现在是用 Safari 打开的（没添加到主屏幕）/.test(st.staticText), st.staticText.slice(0, 120));
  ok('B2d 文案讲清 7 天规则', /连续 7 天没打开本应用/.test(st.staticText));
  ok('B2e 出现「怎么装到桌面」pill', st.pills.indexOf('怎么装到桌面') >= 0, st.pills);
  ok('B2f 通用三档仍保留', /去备份/.test(st.pills.join(',')) && /备份聊天/.test(st.pills.join(',')) && /稍后/.test(st.pills.join(',')), st.pills);
  const clicked = await b.clickPill('怎么装到桌面');
  const g = await b.waitForSnap(async () => { const s2 = await b.snap(); return { hit: s2.guideModal, st: s2 }; }, 8000);
  ok('B2g 点「怎么装到桌面」打开分步引导弹窗', clicked && g.st.guideModal, { title: g.st.title });
  ok('B2h 引导写清「先导出备份」这一步', /先导出备份/.test(g.st.staticText), g.st.staticText.slice(0, 100));
  ok('B2i 引导写清主屏与 Safari 是两套独立存储、需导入', /两套独立存储/.test(g.st.staticText) && /导入数据/.test(g.st.staticText));
  ok('B2j 引导步骤含「添加到主屏幕」路径', /添加到主屏幕/.test(g.st.staticText) && /分享/.test(g.st.staticText));
  ok('B2k iOS 显示关于段 7 天规则提醒条（用户直派「写在关于里提醒 iOS 用户」）',
    g.st.aboutIosPresent === true && g.st.aboutIosHidden === false, { present: g.st.aboutIosPresent, hidden: g.st.aboutIosHidden });
  await b.close();
}

console.log('\nZ 全程零页面异常（pwa 相关）');
{
  const bad = pageErrors.filter((e) => /pwa|mochiIosTabRisk|openIosInstallGuide/i.test(e));
  ok('Z1 无 pwa 相关 pageerror', bad.length === 0, bad.slice(0, 4));
}

await browser.close();
server.close();
console.log('\n' + '='.repeat(52));
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
