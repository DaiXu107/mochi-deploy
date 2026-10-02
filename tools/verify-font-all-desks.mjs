// ===== 回归脚本 #628：上传字体「无法应用到全部桌面」 =====
// 用户原话：「上传字体，无法应用到全部桌面」
//
// 结论（用户选定的方案）：字体【按桌面各存各的】（键 cs-font，per-cid，与壁纸/气泡/字号同桌面美化
//   一致——每个联系人桌面可以各自排版）；缺的是「一次性推给其它桌面」这一步 ⇒ 字体面板新增
//   「同步到全部桌面」按钮（聊天设置入口 + 桌面美化入口各一颗，实现只有一份，见 syncFontAllDesks）。
//   另外本号初版（中间版本）曾把字体改成【根键全局单值】，那个版本的用户升级后由
//   demoteFontGlobal() 把根键值回填给各桌面再删根键，避免只剩 default 桌面看得到字体。
//
// 用法：node tools/verify-font-all-desks.mjs             # 打真实产物 index.html（需先构建）
//       node tools/verify-font-all-desks.mjs --tmp       # 从 src 临时拼装（免构建）
//       node tools/verify-font-all-desks.mjs --legacy    # RED 基线：用 git HEAD 的源文件拼装修前版本，
//                                                        # 断言「没有同步按钮、点不了同步」确实发生
// verify-suite:timeout=200000
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const LEGACY = process.argv.includes('--legacy');
const useTmp = LEGACY || process.argv.includes('--tmp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---------- A 轴：源码锚（--legacy 跳过：修前版本本来就该没有） ----------
const srcOf = (f, fromHead) => (fromHead
  ? execFileSync('git', ['show', 'HEAD:src/' + f], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
  : readFileSync(join(root, 'src', f), 'utf8'));
const csSrc = srcOf('js/chat-settings.js', LEGACY);
const psSrc = srcOf('js/personalize.js', LEGACY);
const ctSrc = srcOf('js/contacts.js', LEGACY);
if (!LEGACY) {
  check('A1 两个入口的面板都有「同步到全部桌面」按钮',
    // 按钮文案在 HTML 串里（不带引号），锚取「同步到全部桌面</button>」；
    // 实现里的弹窗标题是「同步字体到全部桌面」，不撞
    /同步到全部桌面<\/button>/.test(csSrc) && /id="cs-font-sync"/.test(csSrc) && /id="cs-font-sync"/.test(psSrc));
  check('A2 同步实现真把当前桌面字体写到其它桌面（不是只改当前桌面）',
    /others\.forEach\(\(id\) => \{ try \{ window\.storeFor\(id\)\.set\(FONT_KEY, v\); n\+\+; \} catch \(e\) \{\} \}\);/.test(csSrc));
  check('A3 字体仍按桌面存（fontVal 走 activeStore，不是根键）',
    /function fontVal\(\) \{ return store\.get\(FONT_KEY\) \|\| ''; \}/.test(csSrc) &&
    !/xyStore\('xy-home-v2'\)\.set\(FONT_KEY/.test(csSrc));
  check('A4 中间版根键残留在启动 + restore-done 两处回填（demoteFontGlobal）',
    /function demoteFontGlobal\(\) \{/.test(csSrc) && /demoteFontGlobal\(\);/.test(csSrc) && /demoteFontGlobal\(\); \} catch/.test(csSrc));
  check('A5 contacts.js EXCLUDE 排除 cs-font（挡中间版残留根键被 migrateLegacy 迁走）',
    // 按「条目 + 逗号」判（不看数组尾部 `];`）：后来者追加条目会把 `];` 顶走使断言假红（#319 同坑）
    /'cs-font',/.test(ctSrc));
}

// ---------- 拼装页面 ----------
const buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8');
const cssList = Function('"use strict";return ' + buildSrc.match(/const cssFiles = (\[[^\]]+\]);/)[1])();
const jsList = Function('"use strict";return ' + buildSrc.match(/const jsFiles = (\[[^\]]+\]);/)[1])();
let tmpPage = null;
if (useTmp) {
  let tpl = readFileSync(join(root, 'src', 'template.html'), 'utf8');
  const headOf = new Set(['personalize.js', 'chat-settings.js', 'contacts.js']);
  const css = cssList.map(f => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
  const js = jsList.map(f => (LEGACY && headOf.has(f))
    ? execFileSync('git', ['show', 'HEAD:src/js/' + f], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
    : readFileSync(join(root, 'src', 'js', f), 'utf8')).join('\n;\n');
  if (tpl.indexOf('/*__STYLES__*/') >= 0) tpl = tpl.replace('/*__STYLES__*/', () => css);
  else tpl = tpl.replace('</head>', () => '<style>' + css + '</style></head>');
  if (tpl.indexOf('/*__SCRIPTS__*/') >= 0) tpl = tpl.replace('/*__SCRIPTS__*/', () => js);
  else tpl = tpl.replace('</body>', () => '<script>' + js + '</scr' + 'ipt></body>');
  tmpPage = join(root, 'tmp-628-font-' + (LEGACY ? 'legacy' : 'tmp') + '.html');
  writeFileSync(tmpPage, tpl);
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL = 'http://127.0.0.1:' + server.address().port + (tmpPage ? '/' + tmpPage.split(/[\\/]/).pop() : '/index.html');

// 300KB 假字体：>200KB = idb.js 的「大键」门槛（只进 IndexedDB + 内存缓存），顺带覆盖
// 「上传型字体跨桌面复制 / 刷新后靠 IDB 回填」这两条最容易漏的路径
const fontPath = join(tmpdir(), 'mochi-628-font-' + Date.now() + '.ttf');
writeFileSync(fontPath, Buffer.alloc(300 * 1024, 7));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
// 本 app 会注册 Service Worker（pwa.js → sw.js）并在 install 时预缓存 index.html：
// 合成测试页若被 SW 的缓存接管，reload 后会跑【真实产物】而不是刚改的 src ——
// 实测症状是「A 轴锚点全绿、B 轴行为却还是修前的老样子」。直接拦掉 sw.js + 清缓存。
await page.route('**/sw.js', (r) => r.abort());
await page.addInitScript(() => {
  try {
    if (navigator.serviceWorker) {
      Object.defineProperty(navigator.serviceWorker, 'register', { value: () => Promise.resolve({ scope: '/', unregister: () => Promise.resolve(true) }) });
    }
  } catch (e) {}
  try { if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))); } catch (e) {}
});

const bootReady = async () => {
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => !!window.__mochiDataReady)) break;
    await sleep(300);
  }
  await page.evaluate(() => {
    const s = document.getElementById('splash'); if (s) s.remove();
    const q = document.getElementById('qa-mask'); if (q) q.hidden = true;
    const g = document.querySelector('.mg-guide-mask'); if (g) g.remove();
    const m = document.getElementById('modal-mask'); if (m) m.hidden = true;
    const t = document.getElementById('tc-mask'); if (t) t.hidden = true;
  });
  await sleep(500);
};
const reload = async () => { await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(1500); await bootReady(); };

// 页内状态快照：字体实际生效情况 + 当前/default 桌面的键值 + 根键
const SNAP = `(function(){ try {
  var st = document.getElementById('cs-font-style');
  var act = (window.getActiveContact && window.getActiveContact()) || 'default';
  var get = function(id){ try { return window.storeFor(id).get('cs-font'); } catch(e){ return 'ERR'; } };
  return JSON.stringify({
    active: act,
    cur: get(act),
    def: get('default'),
    root: window.xyStore('xy-home-v2').get('cs-font'),
    bodyInline: document.body.style.fontFamily,
    styleTagIsData: st ? String(st.textContent).indexOf('data:') > 0 : false,
    hasTag: !!st,
    computed: getComputedStyle(document.body).fontFamily,
    deskVal: (document.getElementById('desk-cs-font-val') || {}).textContent || null,
    csVal: (document.getElementById('cs-font-val') || {}).textContent || null
  });
} catch(e){ return JSON.stringify({ err: String(e) }); } })()`;
const snap = async () => JSON.parse((await page.evaluate(SNAP)) || '{}');
const at = async (cid) => { await page.evaluate((id) => window.switchContact(id), cid); await sleep(650); };

// 聊天设置入口面板
const openFontPanel = async () => {
  await page.evaluate(() => {
    document.querySelectorAll('.page').forEach((p) => { p.hidden = true; });
    const cs = document.getElementById('page-chat-settings'); if (cs) cs.hidden = false;
  });
  await sleep(150);
  await page.evaluate(() => document.getElementById('cs-font').click());
  await sleep(250);
};
// 桌面美化入口面板（设置 → 外观 → 全局字体）
const openDeskFontPanel = async () => {
  await page.evaluate(() => {
    document.querySelectorAll('.page').forEach((p) => { p.hidden = true; });
    const p = document.getElementById('page-theme') || document.getElementById('page-phone');
    if (p) p.hidden = false;
  });
  await sleep(150);
  await page.evaluate(() => { const r = document.getElementById('row-desk-cs-font'); if (r) r.scrollIntoView(); });
  await page.evaluate(() => document.getElementById('row-desk-cs-font').click());
  await sleep(250);
};
const closeFloats = async () => {
  await page.evaluate(() => {
    const t = document.getElementById('tc-mask'); if (t) t.hidden = true;
    const m = document.getElementById('modal-mask'); if (m) m.hidden = true;
  });
};
const applyFontName = async (name, openPanel) => {
  await (openPanel || openFontPanel)();
  const ok = await page.evaluate(() => !!document.getElementById('cs-font-ok'));
  if (!ok) return false;
  await page.evaluate((n) => { document.getElementById('cs-font-name').value = n; }, name);
  await page.evaluate(() => document.getElementById('cs-font-ok').click());
  await sleep(400);
  await closeFloats();
  return true;
};
// 走面板里的「同步到全部桌面」→ 点确认胶囊 → 点「确定」
const syncViaPanel = async (openPanel) => {
  await openPanel();
  const hasBtn = await page.evaluate(() => !!document.getElementById('cs-font-sync'));
  if (!hasBtn) { await closeFloats(); return false; }
  await page.evaluate(() => document.getElementById('cs-font-sync').click());
  await sleep(300);
  const hasPills = await page.evaluate(() => { const p = document.getElementById('modal-pills'); return !!(p && p.children.length); });
  if (!hasPills) { await closeFloats(); return false; }
  await page.evaluate(() => { const p = document.getElementById('modal-pills'); if (p.children[0]) p.children[0].click(); });
  await sleep(120);
  await page.evaluate(() => { const b = document.getElementById('modal-ok'); if (b) b.click(); });
  await sleep(500);
  await closeFloats();
  return true;
};
const captureFileInput = () => page.evaluate(() => {
  window.__capInput = null;
  if (!window.__origCreate) {
    window.__origCreate = document.createElement.bind(document);
    document.createElement = function (t) {
      const el = window.__origCreate(t);
      if (String(t).toLowerCase() === 'input') window.__capInput = el;
      return el;
    };
  }
  return 1;
});
const uploadViaPanel = async (openPanel) => {
  await openPanel();
  await captureFileInput();
  await page.evaluate(() => document.getElementById('cs-font-upload').click());
  await sleep(200);
  const ok = await page.evaluate(() => {
    const el = window.__capInput;
    if (!el) return false;
    el.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(el);
    return true;
  });
  if (!ok) { await closeFloats(); return false; }
  await page.locator('body > input[type=file]').last().setInputFiles(fontPath);
  await sleep(1200);
  await closeFloats();
  return true;
};
const createAndSwitchTo = async (name) => {
  const cid = await page.evaluate((n) => window.createContact(n), name);
  await page.evaluate((id) => window.switchContact(id), cid);
  await sleep(600);
  return cid;
};

// ---------- B 轴：真实行为 ----------
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await sleep(1500);
await page.evaluate(() => { try { indexedDB.deleteDatabase('xy-home-v2'); } catch (e) {} try { localStorage.clear(); } catch (e) {} });
await reload();

// B1：A(default) 桌面应用字体名 → 本桌面生效，值写在【本桌面】的键里、根键为空
await applyFontName('MochiFontProbe');
let s = await snap();
check('B1 当前桌面应用字体名后立即生效', String(s.bodyInline).indexOf('MochiFontProbe') >= 0, JSON.stringify(s.bodyInline));
check('B2 值写在本桌面的键里（cs-font 仍按桌面存，不写根键）',
  s.def === 'MochiFontProbe' && s.root === null, 'def=' + s.def + ' root=' + s.root);

// B3：字体按桌面独立 —— 换到别的桌面不该自动带上，也不该被误清
const cidB = await createAndSwitchTo('乙');
s = await snap();
check('B3 另一个桌面仍是自己的字体（不该自动带上别人的）',
  String(s.computed).indexOf('MochiFontProbe') < 0 && !s.cur, 'cur=' + s.cur + ' computed=' + s.computed);
await at('default');
s = await snap();
check('B4 切回原桌面字体还在（切换不误清）', String(s.bodyInline).indexOf('MochiFontProbe') >= 0, String(s.bodyInline));

// B5/B6：用户报障点的解法 —— 面板里的「同步到全部桌面」
const okB5 = await syncViaPanel(openFontPanel);
await at(cidB);
s = await snap();
check('B5 点「同步到全部桌面」后别的桌面拿到了同一字体',
  s.cur === 'MochiFontProbe' && String(s.computed).indexOf('MochiFontProbe') >= 0,
  'cur=' + s.cur + ' computed=' + String(s.computed).slice(0, 40));

// B7：桌面美化入口（设置 → 外观 → 全局字体）也有同一颗按钮，且能用
const okB7 = await syncViaPanel(openDeskFontPanel);
check('B6 桌面美化入口同样有「同步到全部桌面」按钮且点击可用', okB5 && okB7);

// B8/B9：上传型字体（>200KB 大键）也要能跨桌面复制、刷新后仍在（当前在 B 桌面）
check('B8 从桌面美化入口真实走一遍「上传字体」（300KB dataURL）', await uploadViaPanel(openDeskFontPanel));
s = await snap();
check('B9 上传型字体先落在当前桌面（@font-face + dataURL）',
  s.styleTagIsData && String(s.cur).indexOf('data:') === 0, 'cur=' + String(s.cur).slice(0, 24) + ' tag=' + s.hasTag);
await syncViaPanel(openDeskFontPanel);
await at('default');
s = await snap();
check('B10 上传的字体同步到其它桌面后同样生效（同一个 dataURL）',
  s.styleTagIsData && String(s.computed).indexOf('cs-custom-font') >= 0,
  'active=' + s.active + ' computed=' + String(s.computed).slice(0, 40));
await reload();
s = await snap();
check('B11 刷新（重进）后上传字体仍生效（IDB 大键回填 + 兜底重应用）',
  s.styleTagIsData && String(s.computed).indexOf('cs-custom-font') >= 0,
  'tag=' + s.hasTag + ' computed=' + String(s.computed).slice(0, 40));

// B12：「恢复默认」只清当前桌面，其它桌面不受影响
const beforeB = await page.evaluate(() => { try { return window.storeFor('cmu-none').get('cs-font'); } catch (e) { return ''; } });
await at(cidB);
await openFontPanel();
const hasClear = await page.evaluate(() => !!document.getElementById('cs-font-clear'));
if (hasClear) await page.evaluate(() => document.getElementById('cs-font-clear').click());
await sleep(400);
await closeFloats();
s = await snap();
check('B12 「恢复默认」只清当前桌面（按桌面独立，不误清别的桌面）',
  !s.cur && s.styleTagIsData === false, 'cur=' + s.cur);
await at('default');
s = await snap();
check('B13 别的桌面的字体不受「恢复默认」影响',
  s.styleTagIsData && String(s.cur).indexOf('data:') === 0, 'cur=' + String(s.cur).slice(0, 24));

// B14：反向兼容 —— 中间版（曾把字体改成根键全局单值）的用户：根键值回填到各桌面后删根键
await page.evaluate(() => {
  const r = window.xyStore('xy-home-v2');
  window.storeFor('default').remove('cs-font');
  window.storeFor(window.getActiveContact()).remove('cs-font');
  r.set('cs-font', 'LegacyFontX');
});
await reload();
s = await snap();
check('B14 中间版残留根键回填到各桌面并删除（用过那版的用户字体不丢）',
  s.cur === 'LegacyFontX' && s.root === null, 'active=' + s.active + ' cur=' + s.cur + ' root=' + s.root);
await at(cidB);
s = await snap();
check('B15 回填后另一个桌面也有该字体', s.cur === 'LegacyFontX', 'cur=' + s.cur);

check('B16 全程无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
server.close();
if (tmpPage) { try { unlinkSync(tmpPage); } catch (e) {} }
try { unlinkSync(fontPath); } catch (e) {}

// ---------- 汇总 ----------
// RED 基线模式：修前版本既没有同步按钮也没有根键回填 —— B5/B6/B10/B14/B15 应红，
// 断言它们确实红了，脚本才算验证过自己的判别力。
const RED_EXPECT = ['B5', 'B6', 'B10', 'B14', 'B15'];
const pass = results.filter(r => r.ok).length;
console.log('----');
if (LEGACY) {
  const redHit = RED_EXPECT.filter((t) => results.some((r) => !r.ok && r.desc.indexOf(t + ' ') === 0));
  const redMiss = RED_EXPECT.filter((t) => !redHit.includes(t));
  console.log('[RED 基线 · git HEAD 修前版本] ' + pass + '/' + results.length + ' 通过');
  console.log('预期红点命中 ' + redHit.length + '/' + RED_EXPECT.length + (redMiss.length ? '（未红：' + redMiss.join('、') + '）' : ''));
  process.exit(redMiss.length === 0 ? 0 : 1);
}
console.log(pass + '/' + results.length + ' passed' + (useTmp ? '（--tmp 拼装页）' : '（真实 index.html）'));
process.exit(pass === results.length ? 0 : 1);
