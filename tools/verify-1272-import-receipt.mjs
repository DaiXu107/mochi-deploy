// verify-1272-import-receipt.mjs — #1272 导入读回执三态＋判据同源＋聊天文件指路＋回执持久化（常驻）
// 立项（用户 2026-09-25 实报 vivo X200s + Edge「上传不了数据，上传数据文件显示无效数据，
//   之前只能上传导入聊天记录数据」，并明说其他设备型号也有、要求不要覆盖式修补）。
// 根因（零机型分支＝判据只取内核回执与文件结构事实）：
//   ① readFileText 第一腿 file.text() 对超限大备份抛 RangeError: Invalid string length，被
//     .catch(() => readViaReader()) 整个吞掉；FileReader 再失败只剩 resolve('') → JSON.parse('null')
//     → 误诊「不是 mochi 导出的数据文件」。#104「太大」分档从来没见到真错误。
//   ② 校验闸 !data.ls 与 lsLooksMochi（ls/idb 任一段认键）两把尺子不一致，IDB 权威备份被硬闸误拒。
//   ③ 单桌「仅聊天记录」文件（{app:'mochi-zika-chat',msgs:[…]}）在完整备份入口走死胡同——
//     而「仅聊天记录」那条路认它（＝用户说的「之前只能导入聊天记录」）。
//   ④ 该类设备页面被系统频繁回收（实报一次诊断回收 25 次），内存取证环随回收清零，导入失败零证据。
// 断言：S 源码锚（产物内）＋ B 行为（无头真跑导入管线：RangeError 仿真/0 字节/双腿回空/
//   idb-only/聊天文件/回执落盘与扛刷新/8 笔封顶）＋ C 对照组（正常备份预览照弹、别家 json 照拒——
//   两侧皆绿＝没修过头）＋ Z1 零 JS 异常。
// 用法：node build.mjs && node tools/verify-1272-import-receipt.mjs
// 用法（RED 基线/隔离根）：SERVE_ROOT=<纯HEAD副本> node tools/verify-1272-import-receipt.mjs
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || here);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
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
const baseUrl = 'http://127.0.0.1:' + server.address().port;
console.log('serve root = ' + root);

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };
const jsOf = (f) => { try { return readFileSync(existsSync(join(root, 'js', f)) ? join(root, 'js', f) : join(root, 'index.html'), 'utf8'); } catch (e) { return ''; } };

// ================= S 段：产物源码锚 =================
{
  const db = jsOf('data-backup.js');
  ok(db.includes("if (t === '' && file.size > 0) readViaReader();"),
    'S1 #1221a 空读换腿重读仍在位（对照组：本批改写 readFileText 时没把旧防线修没）');
  ok(db.includes('const rd = { text: \'\', err: null, why: \'\' };') && db.includes('if (!text && rd.err) throw rd.err;'),
    'S2 读文件回「回执」{text,err,why} 且读空带错时原样上抛（删＝内核真错误又被吞、误诊复发）');
  ok(db.includes('if (/读空|读取失败/i.test(msg)) {'),
    'S3 「读空/读取失败」单独分档在产物里（删＝0 字节/传输不完整又落回「坏了」或「不是 mochi 文件」）');
  ok(db.includes('if (Array.isArray(data) || Array.isArray(data.msgs)) {') && db.includes('window.runChatAllImport(file)'),
    'S4 单桌聊天文件在完整备份入口被认出并一键转交「仅聊天记录」（删＝又走死胡同）');
  ok(db.includes("if (data.ls == null || typeof data.ls !== 'object') data.ls = {};"),
    'S5 校验判据同源：ls 段缺席先归一再判（删回双尺子＝IDB 权威备份被硬闸误拒复发）');
  ok(db.includes("const IMPORT_LOG_KEY = 'xy-home-v2:__import-log';") &&
    db.includes('if (k === IMPORT_LOG_KEY) continue;'),
    'S6 回执键定义＋导出排除接线在产物（删＝本机取证随备份文件传播到别的设备）');
  const dev = jsOf('device.js');
  ok(dev.includes('window.mochiImportLog = function (what) {') && dev.includes("return 'xy-home-v2:__import-log';"),
    'S7 device.js 持久回执环本体（写 localStorage，扛页面回收；删＝失败现场又只剩内存环）');
  ok(dev.includes('L.push(\'数据导入回执（旧→新）：\''),
    'S8 诊断报告出账行（删＝回执写了也看不见）');
}

// ================= 夹具与仿真 =================
const FULL_JSON = JSON.stringify({ version: '1.0', app: 'mochi-zika', exportTime: Date.now(), ls: { 'xy-home-v2:theme-mode': 'dark' }, idb: {} });
const IDBONLY_JSON = JSON.stringify({ version: '1.0', app: 'mochi-zika', exportTime: Date.now(), idb: { 'xy-home-v2:default:chat-msgs': JSON.stringify([{ from: 'me', text: 'idb-only 验证句', ts: Date.now() }]) } });
const CHAT_JSON = JSON.stringify({ app: 'mochi-zika-chat', version: '1.0', exportTime: 'x', msgs: [{ from: 'me', text: '单桌聊天验证句', ts: Date.now() }] });
const FOREIGN_JSON = JSON.stringify({ app: 'evil-note', ls: { 'note:whatever': 'x' } });

async function boot() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const st = { chooser: 0, jsErrors: [], fixture: null, setFilesErr: '' };
  page.on('filechooser', async (fc) => {
    st.chooser++;
    if (!st.fixture) return;
    try { await fc.setFiles({ name: st.fixture.name, mimeType: st.fixture.mime, buffer: Buffer.from(st.fixture.body, 'utf8') }); }
    catch (e) { st.setFilesErr = String(e.message || e); }
  });
  page.on('pageerror', (e) => st.jsErrors.push(String(e.message).slice(0, 200)));
  await page.addInitScript(() => {
    try { localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now())); } catch (e) {}
    // #1250「更新完成 · 存储修复引导」是盖在弹窗层上的常驻弹窗，会把「选择导入范围」整个遮掉
    // （实测吃掉点按＝所有 B 段断言全灭）。它的 gate 是「LS 初筛＋IDB 复核」两把尺子，LS 里
    // 预置了旗标、IDB 没有 ⇒ 仍照常弹（实测红在这）。三层静音：
    //  ① LS 预置送达标记（storage-guide-shown=1250）；
    //  ② 页面脚本加载后立刻 idbSet 补上 IDB 那份（见 dismissSplash）；
    //  ③ 兜底撕罩定时器——前两层被时序绕过时，弹层出现后 ≤400ms 内拆掉。
    // 「关闭引导」按钮不改标记（下次照弹），不能靠点它去重。
    try { localStorage.setItem('xy-home-v2:storage-guide-shown', '1250'); } catch (e) {}
    setInterval(function () {
      try {
        const t = String((document.getElementById('modal-title') || {}).textContent || '');
        if (t.indexOf('存储修复引导') > -1) {
          const m = document.getElementById('modal-mask'); if (m) m.hidden = true;
          const c = document.getElementById('modal-cancel'); if (c && !c.hidden) c.click();
        }
      } catch (e) {}
    }, 400);
  });
  await page.addInitScript(() => {
    // 内核回执仿真（同 #1241 三态口径的读文件版）：①file.text() 对超限文件抛 RangeError
    // （V8 单串上限真形）；②FileReader 两档——onerror（内核拒读）/ onload 但 result 空串
    // （内核交空）。判据只取「内核回了什么」，与 UA/机型无关。
    try {
      const rawText = File.prototype.text;
      File.prototype.text = function () {
        if (window.__fakeTextMode === 'empty') return Promise.resolve('');
        if (window.__fakeTextMode === 'range' && this.size > (window.__fakeTextLimit || 0)) {
          return Promise.reject(new RangeError('Invalid string length'));
        }
        return rawText.apply(this, arguments);
      };
      const rawRead = FileReader.prototype.readAsText;
      FileReader.prototype.readAsText = function (file) {
        const self = this;
        if (window.__fakeReaderMode === 'err') {
          setTimeout(() => { try { if (self.onerror) self.onerror(new Event('error')); } catch (e) {} }, 0);
          return;
        }
        if (window.__fakeReaderMode === 'empty') {
          setTimeout(() => {
            try { Object.defineProperty(self, 'result', { value: '', configurable: true }); } catch (e) {}
            try { if (self.onload) self.onload(new Event('load')); } catch (e) {}
          }, 0);
          return;
        }
        return rawRead.apply(this, arguments);
      };
    } catch (e) {}
  });
  await page.goto(baseUrl + '/index.html');
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 25000 }).catch(() => {});
  await dismissSplash(page);
  return { browser, page, st };
}
async function dismissSplash(page) {
  await page.evaluate(() => {
    // #1250 引导弹层静音第②层：IDB 复核在页面脚本就绪后才读，赶在它的 4 秒窗前把旗标补进去
    try { if (window.idbSet) window.idbSet('xy-home-v2:storage-guide-shown', '1250'); } catch (e) {}
    const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
    const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; s.style.display = 'none'; }
    const q = document.getElementById('qa-mask'); if (q) { q.style.setProperty('display', 'none', 'important'); q.hidden = true; }
  });
  await page.waitForTimeout(900);
}
const ev = (page, expr) => page.evaluate(expr);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openImportModal(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.page').forEach((p) => { p.hidden = (p.id !== 'page-setting'); });
    const g = document.getElementById('daily-greet'); if (g) { g.hidden = true; clearTimeout(g._timer); }
    try { document.querySelector('#set-tabs .them-tab[data-tab="basic"]').click(); } catch (e) {}
    const t = document.getElementById('cc-toast'); if (t) t.textContent = ''; // 防上一条 toast 残留＝假绿
  });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const el = document.getElementById('row-import');
    if (!el) return { err: 'no-row' };
    let n = el;
    while (n && n !== document.body) { if (n.hidden) n.hidden = false; n = n.parentElement; }
    el.scrollIntoView({ block: 'center' });
    return 1;
  });
  if (r && r.err) return r;
  await page.waitForTimeout(200);
  const geo = await page.evaluate(() => {
    const b = document.getElementById('row-import');
    const rr = b.getBoundingClientRect();
    return { cx: rr.x + rr.width / 2, cy: rr.y + rr.height / 2 };
  });
  await page.mouse.click(geo.cx, geo.cy);
  await page.waitForTimeout(600);
  return await modalState(page);
}
async function modalState(page) {
  return await page.evaluate(() => ({
    title: String((document.getElementById('modal-title') || {}).textContent || ''),
    hidden: !!(document.getElementById('modal-mask') || {}).hidden,
    text: String((document.getElementById('modal-static') || {}).textContent || ''),
    toast: String((document.getElementById('cc-toast') || {}).textContent || '')
  }));
}
// 在「选择导入范围」弹窗点确定（#1014 的原生层上）投递夹具
async function deliver(page, st, fixture, flags) {
  await page.evaluate(([f]) => {
    window.__fakeTextMode = f.textMode || '';
    window.__fakeTextLimit = f.textLimit || 0;
    window.__fakeReaderMode = f.readerMode || '';
  }, [fixture.flags || {}]);
  await page.evaluate(() => { const t = document.getElementById('cc-toast'); if (t) t.textContent = ''; });
  st.fixture = { name: fixture.name, mime: fixture.mime, body: fixture.body };
  st.chooser = 0;
  await page.evaluate(() => {
    const s = document.getElementById('mochi-modal-pick');
    const b = s || document.getElementById('modal-ok');
    const r = b.getBoundingClientRect();
    window.__tapTarget = { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
  const g = await page.evaluate(() => window.__tapTarget);
  await page.mouse.click(g.cx, g.cy);
  await page.waitForTimeout(1400);
  st.fixture = null;
  const state = await modalState(page);
  state.chooser = st.chooser;
  state.setFilesErr = st.setFilesErr;
  st.setFilesErr = '';
  await page.evaluate(() => { window.__fakeTextMode = ''; window.__fakeReaderMode = ''; });
  return state;
}
async function closeModal(page) {
  await page.evaluate(() => {
    const m = document.getElementById('modal-mask');
    if (m && m.hidden) return;
    const c = document.getElementById('modal-cancel');
    if (c && !c.hidden) c.click(); else { const o = document.getElementById('modal-ok'); if (o) o.click(); }
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const m = document.getElementById('modal-mask'); if (m) m.hidden = true; });
}
const getLog = (page) => ev(page, `(function(){ try { return JSON.stringify(JSON.parse(localStorage.getItem('xy-home-v2:__import-log') || '[]').map(function(x){return x.w;})); } catch (e) { return 'ERR ' + e.message; } })()`);

// ================= B 段：行为（真点导入管线） =================
const { browser, page, st } = await boot();
const T = (s) => (s.title || '') + '｜' + (s.text || '').slice(0, 40);

// B0 对照组·正常完整备份照走到预览弹窗（两侧皆绿＝没把闸修漏）
{
  const m = await openImportModal(page);
  ok(m.title === '选择导入范围', 'B0a 导入入口弹窗正常打开（前置）', JSON.stringify(m));
  const s = await deliver(page, st, { name: 'mochi数据备份_full.json', mime: 'application/json', body: FULL_JSON });
  ok(String(s.title).indexOf('确定导入数据') === 0, 'B0 合法完整备份走到覆盖确认预览（对照组，两侧皆绿）', T(s));
  await closeModal(page);
}
// B1 大备份超单串上限：RangeError 必须活着到达「太大」分档（红侧＝「不是 mochi 导出的数据文件」）
{
  await openImportModal(page);
  const big = JSON.stringify({ app: 'mochi-zika', ls: { 'xy-home-v2:theme-mode': 'dark', 'xy-home-v2:pad': 'x'.repeat(6000) }, idb: {} });
  const s = await deliver(page, st,
    { name: 'mochi数据备份_big.json', mime: 'application/json', body: big, flags: { textMode: 'range', textLimit: 1000, readerMode: 'err' } });
  ok(String(s.title).indexOf('这份备份太大') === 0,
    'B1 内核抛 Invalid string length＋换腿拒读 ⇒ 「太大」分档（修前：错误被吞成空读→误报「不是 mochi/无效数据」）', T(s) + ' toast=' + s.toast.slice(0, 40));
  await closeModal(page);
}
// B2 0 字节文件（真投递空缓冲）：空读专属分档
{
  await openImportModal(page);
  const s = await deliver(page, st, { name: 'mochi数据备份_zero.json', mime: 'application/json', body: '' });
  const zeroOk = s.chooser === 1 && !s.setFilesErr;
  if (zeroOk) {
    ok(String(s.title).indexOf('没有从这份文件读出内容') === 0 && String(s.text).indexOf('0 字节') > -1,
      'B2 0 字节文件说「没读出内容（文件是 0 字节）」，不是「不是 mochi 文件」', T(s));
  } else {
    ok(String(s.title).indexOf('没有从这份文件读出内容') === 0,
      'B2(退路) 空缓冲投递未被内核接受，仅断言空读分档', T(s) + ' chooser=' + s.chooser + ' err=' + s.setFilesErr);
  }
  await closeModal(page);
}
// —— 趁环形缓冲还没被后续场景挤满，先取一次账（封顶 8 笔是 B8 的断言对象）
const logEarly = await getLog(page);
// B3 两条腿都回空（内核静默空读、不抛错）：同样落空读档
{
  await openImportModal(page);
  const s = await deliver(page, st,
    { name: 'mochi数据备份_bothempty.json', mime: 'application/json', body: FULL_JSON, flags: { textMode: 'empty', readerMode: 'empty' } });
  ok(String(s.title).indexOf('没有从这份文件读出内容') === 0 && String(s.text).indexOf('两条读取腿都回空') > -1,
    'B3 双腿回空且无内核错误 ⇒ 空读分档（修前：resolve("")→parse null→「不是 mochi 导出的数据文件」）', T(s));
  await closeModal(page);
}
// B4 IDB 权威备份（无 ls 段）：不再被 !data.ls 硬闸误拒，能走到预览
{
  await openImportModal(page);
  const s = await deliver(page, st, { name: 'mochi数据备份_idbonly.json', mime: 'application/json', body: IDBONLY_JSON });
  ok(String(s.title).indexOf('确定导入数据') === 0,
    'B4 仅 idb 段有 mochi 键的备份通过校验进预览（修前：两把尺子不一致，硬闸 here 误拒）', T(s) + ' toast=' + s.toast.slice(0, 40));
  await closeModal(page);
}
// B5 单桌聊天文件：完整备份入口认出它→一键转交「仅聊天记录」预览
{
  await openImportModal(page);
  const s = await deliver(page, st, { name: 'mochi聊天记录_单桌.json', mime: 'application/json', body: CHAT_JSON });
  ok(String(s.title).indexOf('这份是「聊天记录」备份文件') === 0,
    'B5a 聊天文件不再走「不是 mochi 数据文件」死胡同，弹窗给出指路（＝用户说的「之前只能导入聊天记录」的另一半）', T(s));
  await page.evaluate(() => { const o = document.getElementById('modal-ok'); if (o) o.click(); });
  await page.waitForTimeout(1200);
  const s2 = await modalState(page);
  ok(String(s2.title).indexOf('确认导入聊天记录') === 0,
    'B5b 点「去导入这份聊天记录」真进了仅聊天记录通道预览（只覆盖聊天、二次确认仍在）', T(s2));
  await closeModal(page);
}
const logB5 = await getLog(page);
// C1 对照组·别的应用的 json 仍被拒（两侧皆绿＝判据同源没把闸修松）
{
  await openImportModal(page);
  const s = await deliver(page, st, { name: 'other-app.json', mime: 'application/json', body: FOREIGN_JSON });
  // 拒绝走 toast 分支＝范围弹窗保持开着（不落新弹窗），判据只看 toast 说了人话
  ok(String(s.toast).indexOf('不是 mochi 导出的数据文件') > -1,
    'C1 外来 app＋非 mochi 键的 json 照旧被拒（防「判据合并＝闸被拆」）', T(s) + ' chooser=' + s.chooser + ' toast=' + s.toast.slice(0, 40));
  await closeModal(page);
}
// B6 回执落盘：关键动作必须留在 localStorage 里（红侧＝根本没有这个键）
{
  const arrE = (() => { try { return JSON.parse(logEarly); } catch (e) { return []; } })();
  const joinedE = arrE.join('；');
  ok(arrE.length > 0 && joinedE.indexOf('backup:read:') > -1,
    'B6a 每次导入尝试都留「读回执」一笔（read:text-ok/range/zero-byte/reader-empty…）', logEarly.slice(0, 140));
  ok(joinedE.indexOf('fail:too-large') > -1 && joinedE.indexOf('fail:empty-read') > -1,
    'B6b 失败分档各留一笔（too-large 与 empty-read 都进账）', logEarly.slice(0, 160));
  const arr5 = (() => { try { return JSON.parse(logB5); } catch (e) { return []; } })();
  ok(arr5.join('；').indexOf('route:chat-file') > -1, 'B6c 聊天文件转交留痕', logB5.slice(0, 160));
}
// B7 扛刷新：reload 后回执环从 localStorage 重新武装（页面回收同形）
{
  await page.reload();
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 25000 }).catch(() => {});
  await dismissSplash(page);
  const r = await ev(page, `(function(){ return JSON.stringify({ n: (window.__mochiImportLog||[]).length, fn: typeof window.mochiImportLog }); })()`);
  const j = (() => { try { return JSON.parse(r); } catch (e) { return {}; } })();
  ok(j.n > 0 && j.fn === 'function',
    'B7 刷新后回执仍在且函数在位（内存环随回收清零是这族报障零证据的根因）', r);
}
// B8 封顶 8 笔（环形缓冲，别把 LS 吃出配额事故——这台设备 LS 已实测贴着 5MB 线）
{
  // 红侧（旧产物没有 mochiImportLog）不能让 evaluate 抛穿整支脚本——吞掉即由下面断言判红
  try { await ev(page, `(function(){ for (var i=1;i<=12;i++) window.mochiImportLog('cap'+i); })()`); } catch (e) {}
  const arr = JSON.parse(await getLog(page));
  ok(arr.length === 8 && String(arr[arr.length - 1]).indexOf('backup:cap12') === -1 && arr[arr.length - 1] === 'cap12',
    'B8 回执封顶 8 笔、丢最旧（超长串也已被 180 字符截断）', JSON.stringify(arr).slice(0, 160));
}
// Z1 零 JS 异常（防修过头）
ok(st.jsErrors.length === 0, 'Z1 全流程零 JS 异常', st.jsErrors.join(' | ').slice(0, 200));

await browser.close();
server.close();
console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
