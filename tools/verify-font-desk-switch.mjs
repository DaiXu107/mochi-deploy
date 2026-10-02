// ===== 回归脚本:#894 「切换桌面联系人后已上传的字体应用消失」根治 =====
// 用户实报:切换桌面联系人后,已上传的字体应用消失(设置里仍显示已上传)。
// 根因(#642「全局唯一份+轻量引用」链路,#787 之后残留的第三条腿,零机型分支):
//   cs-font 存引用 @@font:<hash>,真身 font-blob-<hash> 是 MB 级大键只进 IDB(重启后 memoryCache
//   不一定驻留)。applyFont/applyDeskCsFont 在引用未展开(补读在飞/挂起)时按【空值】处理——
//   把已注入的 @font-face 拆掉、内联 font-family 清空＝「切换后字体应用消失」;弱内核 IDB 挂起
//   (真我/荣耀 Edge 等台账实录形态)拖过 5 发补读预算后整场不再补读＝永不恢复。
// 修法:读取中(引用形态+同步读空+未判丢失)【保留已注入字体不清除】,补读落地后按真实值校正;
//   新桌面真没设字体时 rawVal 不是引用形态,照常清除(#628 按桌面独立语义不变);丢失(gone)是
//   终局,chat-settings 广播 cs-font-changed 让美化页入口同步清除。
// 用例:
//   S1~S3 三条源码锚(与 build.mjs #894a/b/c 同文)
//   T1 chat-settings.applyFont 读取中不清注入(旧代码拆掉＝红)
//   T2 gone(真丢失)照常清除 + 不误报
//   T3 空值(该桌面没设字体)照常清除(#628 语义不回归)
//   T4 dataURL 正常注入(守卫不挡正常路径)
//   T5 personalize.applyDeskCsFont(keepPending=true) 读取中保留(旧代码清掉＝红)
//   T6 personalize 广播路径(keepPending=false)读空＝确认丢失,照常清除
//   T7 personalize 正常值照常注入(守卫不挡)
//   E1~E5 端到端(真实产物):上传→同步→切换保持→重启保持→来回切保持(#628/#787 既有契约不回归)
// 用法:
//   node build.mjs && node tools/verify-font-desk-switch.mjs
//   MOCHI_ROOT=<已构建目录> node tools/verify-font-desk-switch.mjs   (红绿对照)
//   MOCHI_CS_FILE=<HEAD 版 chat-settings.js> MOCHI_PZ_FILE=<HEAD 版 personalize.js> MOCHI_EXPECT=red node …
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
// 注:chat-settings.js / personalize.js 属 core 内联(不在 35 个外置件),产物态查 index.html;
//     红对照传 MOCHI_CS_FILE/MOCHI_PZ_FILE 指向 HEAD 的 src 文件即可(函数体同文)。
const csPath = process.env.MOCHI_CS_FILE || join(root, 'index.html');
const pzPath = process.env.MOCHI_PZ_FILE || join(root, 'index.html');
const csSrc = readFileSync(csPath, 'utf8');
const pzSrc = readFileSync(pzPath, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (desc, ok, detail) => { const id = desc.split(' ')[0]; results.push([id, !!ok]); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); };

// ---- 提取函数体(花括号配平) ----
function extractFn(src, prefix) {
  const at = src.indexOf(prefix);
  if (at < 0) throw new Error('找不到 ' + prefix);
  const bodyStart = src.indexOf('{', at);
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error(prefix + ' 花括号不配平');
}

// ---- S 源码锚 ----
check('S1 #894a 读取中不清注入锚在产物', csSrc.indexOf("if (!v && rawVal.indexOf('@@font:') === 0 && !_fontBlobGone[rawVal.slice(7)]) return;") >= 0);
check('S2 #894b 丢失终局广播锚在产物', csSrc.indexOf('csFontChanged(); // #894：丢失是终局') >= 0);
check('S3 #894c 美化页读取中保留锚在产物', pzSrc.indexOf("if (!v && raw.indexOf('@@font:') === 0 && keepPending) return;") >= 0);

// ---- applyFont 单元跑法(stub DOM/store/gone) ----
// 返回 {tag: 'cs-font-style' 的最终 textContent 或 null(已删), bodyFF}
function runApplyFont(opts) {
  let tagHtml = opts.existingTag || null; // 现场已注入的 cs-font-style
  const fontVal = () => opts.rawVal || '';
  const resolved = () => opts.resolved !== undefined ? opts.resolved : (opts.rawVal && opts.rawVal.indexOf('@@font:') === 0 ? '' : opts.rawVal || '');
  const gone = opts.goneMap || {};
  const document = {
    getElementById: (id) => (id === 'cs-font-val' ? null : id === 'cs-font-style' && tagHtml ? { __fontVal: opts.existingTagVal || '', textContent: tagHtml, remove: () => { tagHtml = null; } } : null),
    createElement: () => ({ style: {} }),
    head: { appendChild: (st) => { tagHtml = st.textContent; } },
    body: { style: { fontFamily: opts.bodyFF || '' } },
    documentElement: { style: { fontFamily: '' } }
  };
  const fn = new Function('fontResolved', 'fontVal', '_fontBlobGone', 'document', '"use strict";' +
    extractFn(csSrc, 'function applyFont(') + '; return applyFont;')(resolved, fontVal, gone, document);
  try { fn(); } catch (e) { return { err: String(e) }; }
  return { tag: tagHtml, bodyFF: document.body.style.fontFamily };
}
const DATAURL = 'data:font/ttf;base64,' + 'QTBCQ0RFRg'.repeat(40);

// T1 读取中:引用形态+补读未落地+已有注入 → 保留(#894 核心;旧代码拆掉＝红)
{
  const r = runApplyFont({ rawVal: '@@font:h1', existingTag: '@font-face{...h1...}', existingTagVal: DATAURL, bodyFF: '' });
  check('T1 读取中保留已注入字体', !r.err && r.tag && String(r.tag).indexOf('h1') >= 0, JSON.stringify(r).slice(0, 120));
}
// T2 gone:真丢失 → 照常清除
{
  const r = runApplyFont({ rawVal: '@@font:h1', existingTag: '@font-face{...h1...}', existingTagVal: DATAURL, goneMap: { h1: true } });
  check('T2 丢失(gone)照常清除', !r.err && r.tag === null && r.bodyFF === '', JSON.stringify(r).slice(0, 120));
}
// T3 空值:该桌面没设字体 → 照常清除(#628 语义)
{
  const r = runApplyFont({ rawVal: '', existingTag: '@font-face{...h1...}', existingTagVal: DATAURL });
  check('T3 未设字体照常清除', !r.err && r.tag === null && r.bodyFF === '', JSON.stringify(r).slice(0, 120));
}
// T4 dataURL 正常注入
{
  const r = runApplyFont({ rawVal: DATAURL, resolved: DATAURL });
  check('T4 dataURL 正常注入', !r.err && r.tag && String(r.tag).indexOf('data:') > 0, JSON.stringify(r).slice(0, 120));
}

// ---- applyDeskCsFont 单元跑法(stub DOM/store) ----
function runDeskApply(opts) {
  let tagHtml = opts.existingTag || null;
  const deskVal = opts.rawVal || '';
  const resolved = () => (deskVal.indexOf('@@font:') === 0 ? '' : deskVal);
  const document = {
    getElementById: (id) => (id === 'desk-cs-font-val' ? { textContent: '' } : id === 'cs-font-style' && tagHtml ? { __fontVal: opts.existingTagVal || 'PREV_BLOB', textContent: tagHtml, remove: () => { tagHtml = null; } } : null),
    createElement: () => ({}),
    head: { appendChild: (st) => { tagHtml = st.textContent; } },
    body: { style: { fontFamily: opts.bodyFF || '' } },
    documentElement: { style: { fontFamily: '' } }
  };
  const store = { get: () => deskVal };
  const fn = new Function('store', 'CS_FONT_KEY', 'deskCsFontVal', 'deskCsFontValOf', 'deskCsFontResolved', 'document', '"use strict";' +
    extractFn(pzSrc, 'function applyDeskCsFont(') + '; return applyDeskCsFont;')(
    store, 'cs-font', { textContent: '' }, () => deskVal, resolved, document);
  try { fn(opts.keepPending); } catch (e) { return { err: String(e) }; }
  return { tag: tagHtml, bodyFF: document.body.style.fontFamily };
}
// T5 启动/切桌面路径:读取中保留(旧代码清掉＝红)
{
  const r = runDeskApply({ rawVal: '@@font:h1', existingTag: '@font-face{...h1...}', keepPending: true });
  check('T5 美化页读取中保留已注入字体', !r.err && r.tag && String(r.tag).indexOf('h1') >= 0, JSON.stringify(r).slice(0, 120));
}
// T6 广播路径:读空＝确认丢失 → 清除
{
  const r = runDeskApply({ rawVal: '@@font:h1', existingTag: '@font-face{...h1...}', keepPending: false });
  check('T6 美化页广播路径确认丢失照清', !r.err && r.tag === null && r.bodyFF === '', JSON.stringify(r).slice(0, 120));
}
// T7 正常值照常注入
{
  const r = runDeskApply({ rawVal: DATAURL, keepPending: true });
  check('T7 美化页 dataURL 正常注入', !r.err && r.tag && String(r.tag).indexOf('data:') > 0, JSON.stringify(r).slice(0, 120));
}

// ---- 端到端(真实产物,健康内核):#628/#787/#894 既有契约 ----
async function e2e() {
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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
  const URL = 'http://127.0.0.1:' + server.address().port + '/index.html';
  const fontPath = join(tmpdir(), 'mochi-891-font-' + Date.now() + '.ttf');
  writeFileSync(fontPath, Buffer.alloc(300 * 1024, 7));
  let chromium; try { ({ chromium } = await import('playwright')); } catch (e) { console.log('SKIP  E2E(无 playwright): ' + e.message); server.close(); return; }
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.route('**/sw.js', (r) => r.abort());
  await page.addInitScript(() => {
    try { if (navigator.serviceWorker) Object.defineProperty(navigator.serviceWorker, 'register', { value: () => Promise.resolve({ scope: '/', unregister: () => Promise.resolve(true) }) }); } catch (e) {}
    try { if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))); } catch (e) {}
  });
  const bootReady = async () => {
    for (let i = 0; i < 60; i++) { if (await page.evaluate(() => !!window.__mochiDataReady)) break; await sleep(300); }
    await page.evaluate(() => {
      ['splash', 'modal-mask', 'tc-mask'].forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = true; });
      const q = document.getElementById('qa-mask'); if (q) q.hidden = true;
      const g = document.querySelector('.mg-guide-mask'); if (g) g.remove();
    });
    await sleep(500);
  };
  const reload = async () => { await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(1500); await bootReady(); };
  const SNAP = `(function(){ try {
    var st = document.getElementById('cs-font-style');
    var act = (window.getActiveContact && window.getActiveContact()) || 'default';
    return JSON.stringify({ active: act, cur: window.storeFor(act).get('cs-font'),
      tagIsData: st ? String(st.textContent).indexOf('data:') > 0 : false });
  } catch(e){ return JSON.stringify({ err: String(e) }); } })()`;
  const snap = async () => JSON.parse((await page.evaluate(SNAP)) || '{}');
  const at = async (cid) => { await page.evaluate((id) => window.switchContact(id), cid); await sleep(700); };
  const openFontPanel = async () => {
    await page.evaluate(() => {
      document.querySelectorAll('.page').forEach((p) => { p.hidden = true; });
      const cs = document.getElementById('page-chat-settings'); if (cs) cs.hidden = false;
    });
    await sleep(150);
    await page.evaluate(() => document.getElementById('cs-font').click());
    await sleep(250);
  };
  const closeFloats = async () => { await page.evaluate(() => { const t = document.getElementById('tc-mask'); if (t) t.hidden = true; const m = document.getElementById('modal-mask'); if (m) m.hidden = true; }); };
  const captureFileInput = () => page.evaluate(() => {
    window.__capInput = null;
    if (!window.__origCreate) {
      window.__origCreate = document.createElement.bind(document);
      document.createElement = function (t) { const el = window.__origCreate(t); if (String(t).toLowerCase() === 'input') window.__capInput = el; return el; };
    }
    return 1;
  });
  const uploadViaPanel = async () => {
    await openFontPanel();
    await captureFileInput();
    await page.evaluate(() => document.getElementById('cs-font-upload').click());
    await sleep(200);
    const ok = await page.evaluate(() => { const el = window.__capInput; if (!el) return false; el.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(el); return true; });
    if (!ok) { await closeFloats(); return false; }
    await page.locator('body > input[type=file]').last().setInputFiles(fontPath);
    await sleep(1500);
    await closeFloats();
    return true;
  };

  await reload();
  const up = await uploadViaPanel();
  check('E0 上传成功', up);
  let s = await snap();
  check('E1 上传后本桌面注入', s.tagIsData === true, JSON.stringify(s));
  // 先建联系人再同步(#628 syncFontAllDesks 只推给当时已存在的桌面)
  const cid = await page.evaluate((n) => window.createContact(n), '甲');
  await at('default');
  await openFontPanel();
  await page.evaluate(() => document.getElementById('cs-font-sync').click());
  await sleep(300);
  await page.evaluate(() => { const p = document.getElementById('modal-pills'); if (p && p.children[0]) p.children[0].click(); });
  await sleep(150);
  await page.evaluate(() => { const b = document.getElementById('modal-ok'); if (b) b.click(); });
  await sleep(600);
  await closeFloats();
  await at(cid);
  s = await snap();
  check('E2 切到已同步桌面字体注入', s.tagIsData === true, JSON.stringify(s));
  await at('default');
  s = await snap();
  check('E3 切回 default 字体保持', s.tagIsData === true, JSON.stringify(s));
  await reload();
  s = await snap();
  check('E4 重启后字体恢复', s.tagIsData === true, JSON.stringify(s));
  for (let i = 0; i < 3; i++) { await at(cid); await at('default'); }
  s = await snap();
  check('E5 来回切 3 次字体保持', s.tagIsData === true, JSON.stringify(s));
  check('Z 端到端零异常', errs.length === 0, errs.join(' | ').slice(0, 200));
  await browser.close();
  server.close();
}
await e2e();

// ---- 汇总 ----
console.log('----');
const RED_IDS = ['T1', 'T5', 'S1', 'S2', 'S3'];
const fails = results.filter((x) => !x[1]).map((x) => x[0]);
if (EXPECT === 'red') {
  const unexpected = fails.filter((id) => !RED_IDS.includes(id));
  const hit = RED_IDS.filter((id) => fails.includes(id));
  console.log(hit.length ? '[red] 恰红 ' + hit.join(',') + ' ＝判别力实证' : '[red] 未命中任何预期红点!');
  if (unexpected.length) { console.log('[red] 意外红: ' + unexpected.join(',')); process.exit(1); }
  if (!hit.length) process.exit(1);
} else {
  console.log(fails.length ? 'FAIL: ' + fails.join(',') : '[green] verify-font-desk-switch 全过:S1~S3+T1~T7+E 组');
  if (fails.length) process.exit(1);
}
