// ===== 专项验证：#980 备份提醒补「iOS 在主屏幕使用」相关口径（用户直派 2026-09-21） =====
// 用户原话：「关于提醒备份里 ios需要添加在主屏幕使用的相关的，也需要加上去黑字」
// 口径：把「iPhone 不装到主屏幕会被系统 7 天规则清空 → 必须先导出、装到主屏幕、再从桌面图标导入」
// 这条根因补进备份提醒链的四处（使用说明「数据与备份」章 / 使用说明「iPhone / iOS 使用与限制」章 /
// 设置「导出数据」胶囊 / 备份提醒顶条的 iOS 分支），全部写成站内普通正文＋<b> 加粗（黑字），
// 不新增红/橙强调色；非 iOS 用户的文案与形态一字不变（零回归面）。
// 用法：node tools/verify-980-backup-ios-homescreen.mjs
//       SRCDIR=<src目录> node tools/verify-980-backup-ios-homescreen.mjs   # 红绿对照（纯 HEAD 源应大面积红）
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const srcDir = process.env.SRCDIR ? normalize(process.env.SRCDIR) : join(root, 'src');
const buildSrcPath = existsSync(join(srcDir, '..', 'build.mjs')) ? join(srcDir, '..', 'build.mjs') : join(root, 'build.mjs');

let pass = 0, fail = 0, skip = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}
function cnt(hay, needle) { return hay.split(needle).length - 1; }

// ---- S 组：src 静态锚（不依赖浏览器，红绿对照时对纯 HEAD 源应红）----
console.log('S src 锚');
const tplSrc = readFileSync(join(srcDir, 'template.html'), 'utf8');
const helpSrc = readFileSync(join(srcDir, 'js', 'settings-help.js'), 'utf8');
const pwaSrc = readFileSync(join(srcDir, 'js', 'pwa.js'), 'utf8');
const buildSrc = readFileSync(buildSrcPath, 'utf8');

// 使用说明 4 数据与备份：计数与条目数
const chIdx = tplSrc.indexOf('数据与备份</span>');
const chBody = chIdx >= 0 ? tplSrc.slice(tplSrc.indexOf('<div class="lg-body">', chIdx), tplSrc.indexOf('</details>', chIdx)) : '';
const chCount = /数据与备份<\/span><span class="lg-count">(\d+)<\/span>/.exec(tplSrc);
const chItems = cnt(chBody, '<div class="lic-li">');
ok('S1 「数据与备份」章新增 iPhone/iPad 必做条（删＝备份章不再告诉 iPhone 用户不装到主屏幕会被系统清空）',
  /iPhone \/ iPad 必做<\/b>：把本站<b>「添加到主屏幕」<\/b>/.test(tplSrc));
ok('S2 该条讲清「7 天规则」根因（删＝只剩「要装到主屏幕」的命令，看不到为什么要装）',
  tplSrc.includes('Apple 会在<b>连续 7 天没打开本站</b>后自动清空它的全部本地数据（这是 Safari 的隐私策略，网站躲不过），这也是 iPhone 上「数据总是丢」最常见的原因'));
ok('S3 该条讲清「两套独立存储」＋导出/导入顺序（删＝用户装到桌面后看到空数据，以为数据丢了）',
  tplSrc.includes('切过去之前先在 设置 → 通用 →「导出数据」导一份，切过去后在桌面应用里走「导入数据」恢复'));
ok('S4 该章计数与实际条目数一致且已随新增条同步（7→8）', !!chCount && Number(chCount[1]) === chItems && chItems === 8, { count: chCount && chCount[1], items: chItems });
ok('S5 该章原有 7 条一字未删（用户约束：不要删除我的内容）',
  ['所有数据<b>只存在你自己的浏览器里，没有云端</b>', '导出备份：<b>设置 → 通用 → 导出数据</b>', '恢复 / 换机：新设备用', '顶部会有<b>备份提醒</b>', '<b>每个功能都能单独搬家</b>', '聊天记录可在 <b>聊天设置 → 数据</b> 里单独导出', '各联系人是独立命名空间']
    .every((k) => tplSrc.includes(k)));
ok('S6 「iPhone / iOS 使用与限制」推荐用法补「不装到主屏幕＝数据会被系统清掉」（删＝推荐用法只剩「更好用」）',
  tplSrc.includes('<b>更重要的是数据：不装到主屏幕，数据会被系统清掉。</b>')
  && tplSrc.includes('Safari 的隐私策略，网站躲不过）；<b>添加到主屏幕后从桌面图标打开，就不受这条限制</b>'));
ok('S7 iOS 章原推荐用法一字未删', tplSrc.includes('好处是：没有浏览器工具栏、能真全屏、也不跟一堆标签页抢内存')
  && tplSrc.includes('注意这<b>不是</b>「装了就能多用内存」——存的东西多了，装在桌面上一样会被系统关掉重开。）'));
ok('S8 设置「导出数据」胶囊补 iOS 主屏幕口径', helpSrc.includes('Safari 标签页连续 7 天没打开会被系统自动清空全部数据')
  && helpSrc.includes('iPhone / iPad 更稳妥的用法：把本站「添加到主屏幕」后从桌面图标使用'));
ok('S9 胶囊原有 iOS 口径与导出说明一字未删', helpSrc.includes('iOS Safari 可能被系统清空存储，建议定期导出完整备份。')
  && helpSrc.includes('「仅聊天记录」不算全量备份，不更新定期备份提醒的导出时间。'));
ok('S10 提醒顶条走唯一 iOS 判定源 mochiIosTabRisk（不得新增 UA 分支）',
  pwaSrc.includes('const iosTab = !!(window.mochiIosTabRisk && window.mochiIosTabRisk());')
  && /function showBar\(days, everBacked\) \{[\s\S]{0,420}mochiIosTabRisk/.test(pwaSrc));
ok('S11 顶条只在 iOS 高危分支追加文案，其它平台拼空串（零回归面＝非 iOS 文案逐字不变）',
  pwaSrc.includes("+ (iosTab ? '｜iPhone：导出后请「添加到主屏幕」，改用桌面图标打开' : '');")
  && pwaSrc.includes("? '⚠ 手机和浏览器都会自动清空数据（设备限制，躲不掉）· 距上次备份已 ' + days + ' 天，快导出备份'")
  && pwaSrc.includes(": '⚠ 手机和浏览器都会自动清空数据，一清就全没 · 你还没导出过完整备份'"));
ok('S12 文案加长后顶条允许窄屏换行（删＝320px 级屏「去备份」被挤出屏外，#939 续二同源）',
  pwaSrc.includes("if (iosTab) { bar.style.flexWrap = 'wrap'; bar.style.rowGap = '6px'; }"));
ok('S13 备份弹窗 iOS 第④条与「怎么装到桌面」引导仍在位（本批未动，防被顺带改坏）',
  pwaSrc.includes('④ 你现在是用 Safari 打开的（没添加到主屏幕）')
  && pwaSrc.includes("if (iosTab) pills.push({ label: '怎么装到桌面', value: 'install' });")
  && pwaSrc.includes("window.openModal('装到桌面 · 让数据不被自动清空'"));
// 哨兵体检（本批自查）：六条已登记 + needle 在各自登记文件里唯一
const sentNames = ['#980a', '#980b', '#980c', '#980d', '#980e', '#980f'];
ok('S14 六条哨兵已登记进 build.mjs FIX_SENTINELS', sentNames.every((n) => buildSrc.includes("name: '" + n)));
ok('S15 六条 needle 各自在登记文件里唯一（哑哨兵体检）', (function () {
  const map = {
    'template.html': ['iPhone / iPad 必做</b>：把本站<b>「添加到主屏幕」</b>', '数据与备份</span><span class="lg-count">8</span>', '<b>更重要的是数据：不装到主屏幕，数据会被系统清掉。</b>'],
    'js/settings-help.js': ['Safari 标签页连续 7 天没打开会被系统自动清空全部数据'],
    'js/pwa.js': ['iPhone：导出后请「添加到主屏幕」，改用桌面图标打开', "bar.style.flexWrap = 'wrap';"],
  };
  const all = [...map['template.html'], ...map['js/settings-help.js'], ...map['js/pwa.js']];
  if (new Set(all).size !== all.length) return false; // 多条共用同一 needle＝互相掩盖
  for (const f of Object.keys(map)) {
    const s = readFileSync(join(srcDir, f), 'utf8');
    for (const nd of map[f]) if (cnt(s, nd) !== 1) return false;
  }
  return true;
})());

// ---- 测试专用组装：按 build.mjs 同顺序拼临时 index.html（不碰仓库产物） ----
const grab = (name) => JSON.parse(buildSrc.match(new RegExp('const ' + name + " = (\\[[^\\]]*\\])"))[1].replace(/'/g, '"'));
const cssFiles = grab('cssFiles'), jsFiles = grab('jsFiles');
let html = readFileSync(join(srcDir, 'template.html'), 'utf8');
html = html.replace('/*__STYLES__*/', () => cssFiles.map((f) => readFileSync(join(srcDir, 'css', f), 'utf8')).join('\n'));
html = html.replace('/*__SCRIPTS__*/', () => jsFiles.map((f) => '(function(){ try {\n' + readFileSync(join(srcDir, 'js', f), 'utf8') + '\n} catch(e){ console.error("[JS]", e && e.message); } })();').join('\n'));
html = html.split('__BUILD_INFO__').join('verify-980').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-verify-980-' + Date.now());
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

const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-S9180) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

/**
 * 起一个会话。ua＝覆盖 UA（设备判定走 device.js 的 UA 口）；noModal＝摘掉 openModal 逼出顶条兜底形态。
 * 预置：有联系人数据 + 5 天前备份过 + 今天没提醒过 ⇒ 该弹每日备份提醒。
 */
async function boot(opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: opts.width || 390, height: opts.height || 844 },
    ...(opts.ua ? { userAgent: opts.ua } : {}),
  });
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
    if (o.noModal) {
      const iv = setInterval(function () { try { window.openModal = undefined; } catch (e) {} }, 50);
      setTimeout(function () { clearInterval(iv); }, 8000);
    }
  }, [opts]);
  const page = await ctx.newPage();
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  page.setDefaultTimeout(30000);
  return {
    ctx, page,
    async close() { try { await ctx.close(); } catch (e) {} },
    enter: () => page.evaluate(() => {
      const s = document.getElementById('splash');
      if (s) { s.classList.add('hide'); setTimeout(() => { if (s.parentNode) s.parentNode.removeChild(s); }, 400); }
      return true;
    }),
    wait: (ms) => page.waitForTimeout(ms),
    waitBar: async (ms) => {
      const deadline = Date.now() + (ms || 14000);
      const read = () => page.evaluate(() => {
        const bar = document.getElementById('backup-remind-bar');
        const txt = document.getElementById('backup-remind-txt');
        const vw = document.documentElement.clientWidth;
        const box = (id) => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return { l: +r.left.toFixed(1), r: +r.right.toFixed(1), h: +r.height.toFixed(1) }; };
        return {
          isIOS: !!(window.mochiDevice && window.mochiDevice.isIOS),
          risk: !!(window.mochiIosTabRisk && window.mochiIosTabRisk()),
          visible: !!(bar && !bar.hidden && bar.getClientRects().length > 0),
          text: txt ? String(txt.textContent || '') : '',
          wrap: bar ? getComputedStyle(bar).flexWrap : '',
          rowGap: bar ? getComputedStyle(bar).rowGap : '',
          barBox: box('backup-remind-bar'), goBox: box('backup-remind-go'), chatBox: box('backup-remind-chat'),
          vw,
        };
      });
      let st = await read();
      while (!st.visible && Date.now() < deadline) { await page.waitForTimeout(400); st = await read(); }
      return st;
    },
    modalText: async () => page.evaluate(() => {
      const m = document.getElementById('modal-mask');
      const t = document.querySelector('.modal-title');
      const st = document.querySelector('.modal-static');
      const pills = Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill')).map((x) => x.textContent.trim());
      return { open: !!(m && !m.hidden && t && /数据会被自动清空/.test(t.textContent)), title: t ? t.textContent : '', text: st ? String(st.textContent || '') : '', pills, warn: !!(document.querySelector('.modal') && /\bmodal--warn\b/.test(document.querySelector('.modal').className)) };
    }),
    waitModal: async (ms) => {
      const deadline = Date.now() + (ms || 15000);
      let st = await page.evaluate(() => ({ open: !!(document.getElementById('modal-mask') && !document.getElementById('modal-mask').hidden) }));
      while (!st.open && Date.now() < deadline) { await page.waitForTimeout(400); st = await page.evaluate(() => ({ open: !!(document.getElementById('modal-mask') && !document.getElementById('modal-mask').hidden) })); }
      return st.open;
    },
  };
}

console.log('\nB1 iOS 标签页（未装到主屏幕）＝顶条追加「装到主屏幕」指路');
{
  const b = await boot({ ua: UA_IOS, noModal: true });
  await b.wait(1200); await b.enter();
  const st = await b.waitBar();
  ok('B1a 设备判定确实是 iOS 标签页高危场景（前提成立，否则下面断言不算数）', st.isIOS && st.risk, { isIOS: st.isIOS, risk: st.risk });
  ok('B1b 顶条亮起且文案含 iOS 主屏幕指路', st.visible && /iPhone：导出后请「添加到主屏幕」，改用桌面图标打开/.test(st.text), st.text);
  ok('B1c 顶条原有人话文案一字未删', /手机和浏览器都会自动清空数据/.test(st.text), st.text);
  ok('B1d 文案加长后顶条开启换行（窄屏按钮不被挤出屏）', st.wrap === 'wrap', { wrap: st.wrap, rowGap: st.rowGap });
  await b.close();
}

console.log('\nB2 安卓 / 桌面＝顶条文案与形态零改动（零回归面）');
{
  const b = await boot({ ua: UA_ANDROID, noModal: true });
  await b.wait(1200); await b.enter();
  const st = await b.waitBar();
  ok('B2a 非 iOS 不追加 iOS 指路', st.visible && !/iPhone/.test(st.text), st.text);
  ok('B2b 非 iOS 顶条不开启换行（原形态不变）', st.wrap === 'nowrap', { wrap: st.wrap });
  ok('B2c 非 iOS 文案与旧版逐字一致', /^⚠ 手机和浏览器都会自动清空数据（设备限制，躲不掉）· 距上次备份已 \d+ 天，快导出备份$/.test(st.text), st.text);
  await b.close();
}

console.log('\nB3 窄屏（320px）iOS 顶条：加长文案不把「去备份」按钮挤出屏外');
{
  const b = await boot({ ua: UA_IOS, noModal: true, width: 320, height: 640 });
  await b.wait(1200); await b.enter();
  const st = await b.waitBar();
  ok('B3a 窄屏顶条亮起', st.visible, st.text);
  ok('B3b 两枚操作按钮都完整落在屏内（点得到）',
    !!st.goBox && !!st.chatBox && st.goBox.r <= st.vw + 0.5 && st.chatBox.r <= st.vw + 0.5 && st.goBox.l >= -0.5 && st.chatBox.l >= -0.5,
    { vw: st.vw, go: st.goBox, chat: st.chatBox });
  await b.close();
}

console.log('\nB4 弹窗形态：iOS 第④条仍在 + 非 iOS 不多出 iOS 段落（本批未改口径）');
{
  const bi = await boot({ ua: UA_IOS });
  await bi.wait(1200); await bi.enter();
  const open = await bi.waitModal();
  const mi = await bi.modalText();
  ok('B4a iOS 弹窗照常弹出（提醒链未被打坏）', open && mi.open, { open, mi });
  ok('B4b iOS 弹窗仍带第④条与「怎么装到桌面」入口', /④ 你现在是用 Safari 打开的（没添加到主屏幕）/.test(mi.text) && mi.pills.indexOf('怎么装到桌面') >= 0, mi.pills);
  await bi.close();
  const ba = await boot({ ua: UA_ANDROID });
  await ba.wait(1200); await ba.enter();
  await ba.waitModal();
  const ma = await ba.modalText();
  ok('B4c 非 iOS 弹窗不含第④条与装到桌面入口（零回归面）', !/④ 你现在是用 Safari 打开的/.test(ma.text) && ma.pills.indexOf('怎么装到桌面') < 0, ma.pills);
  ok('B4d 非 iOS 弹窗正文与旧版一致（三条主干文案在位）', /① 数据会被自动清掉，躲不过/.test(ma.text) && /② 怎么办/.test(ma.text) && /③ 如果数据总也存不住/.test(ma.text), ma.text.slice(0, 60));
  await ba.close();
}

console.log('\nB5 使用说明页：数据与备份章计数与实际条目一致（无头真实 DOM 口径）');
{
  const b = await boot({ ua: UA_ANDROID });
  await b.wait(1200); await b.enter();
  await b.page.evaluate(() => { const r = document.getElementById('row-guide'); if (r) r.click(); });
  await b.wait(500);
  const st = await b.page.evaluate(() => {
    const g = [...document.querySelectorAll('#page-guide .lic-grp')].filter((x) => /数据与备份/.test(((x.querySelector('.lg-name') || {}).textContent || '')))[0];
    if (!g) return null;
    return { count: Number((g.querySelector('.lg-count') || {}).textContent || 0), items: g.querySelectorAll('.lic-li').length, hasIos: /iPhone \/ iPad 必做/.test(g.textContent || ''), text: g.textContent || '' };
  });
  ok('B5a 数据与备份章渲染在位', !!st, st);
  ok('B5b 计数 8 与实际条目 8 一致', !!st && st.count === 8 && st.items === 8, st && { count: st.count, items: st.items });
  ok('B5c 新增条在页面上真的渲染出来（含 7 天规则与两套存储口径）', !!st && st.hasIos && /连续 7 天没打开本站/.test(st.text) && /两套独立存储/.test(st.text));
  await b.close();
}

// ---- P 组：构建产物锚（未构建时按环境跳过）----
console.log('\nP 产物锚');
function phas(file, needle) {
  const p = join(root, file);
  if (!existsSync(p)) { skip++; return null; }
  return readFileSync(p, 'utf8').includes(needle);
}
{
  const pi = phas('index.html', 'iPhone / iPad 必做</b>：把本站<b>「添加到主屏幕」</b>');
  if (pi !== null) {
    ok('P1 产物 index.html 含新增 iOS 备份条', pi);
    ok('P2 产物含 iOS 章补句与提醒条 iOS 追加文案',
      readFileSync(join(root, 'index.html'), 'utf8').includes('<b>更重要的是数据：不装到主屏幕，数据会被系统清掉。</b>')
      && readFileSync(join(root, 'index.html'), 'utf8').includes('iPhone：导出后请「添加到主屏幕」，改用桌面图标打开'));
  }
  const ps = phas('js/settings-help.js', 'Safari 标签页连续 7 天没打开会被系统自动清空全部数据');
  if (ps !== null) ok('P3 产物 js/settings-help.js 含导出数据胶囊 iOS 口径', ps);
}

await browser.close();
try { rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}

console.log('\n===== #980 结果：' + pass + ' 通过 / ' + fail + ' 失败 / ' + skip + ' 跳过（产物缺失）=====');
process.exit(fail ? 1 : 0);
