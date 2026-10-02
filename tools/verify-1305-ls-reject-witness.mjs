// ===== 常驻回归脚本 #1305：iPhone 15 Pro Max + Safari 实报「系统一直说储存空间不足」——被拒那一刻的现场账
// 用法：node tools/verify-1305-ls-reject-witness.mjs [被测根目录]（或 SERVE_ROOT=…；首行打印被测根目录，防喂错产物）
// 症状（用户实报 2026-09-26，同一台机的诊断单同时写着「localStorage 状态：正常（可写可读回）」）：
//   站内 128 个 localStorage.setItem 直写点各自 catch 掉写失败并降级到 IDB/内存，LS 随后又能写了；
//   旧诊断只在**导出当场**探一次写＝永远正常，那一拒是谁写的、多大、当时整域多少，一条没留下。
// 判据（零机型／零 UA 分支＝只有「内核有没有抛」这一个事实）：入口包一次 Storage 实例的 setItem，
//   抛了才记账、记完照原样再抛。装成不可枚举自身属性——三处 Object.keys(localStorage) 会把可枚举
//   的 setItem 当成一条真键数进去（idb.js #139 大键清扫／data-backup.js／personalize.js）。
// 断言：
//   S1~S5 静态锚（产物＋src 各在位、本批新增块零机型分支、包完必 rethrow 的针在）
//   R1 安装态：包装已装 ＋ enumerable:false ＋ Object.keys 里看不见它
//   R2 成功路径零开销：50 次正常写不入账、相位账本里一条 'ls-rej:' 都没有
//   R3 真拒绝（先把 LS 填到内核抛错，再写一发注定被拒的大值）：抛错名在、计数 +1、现场含键名/体积/
//      当时整域多少键多少体积/最大键是哪条/前台标记，＋「出自」那一帧指到真文件行且不含本包装自己的函数名
//   R4 调用方语义一字不变：被拒那一发照样抛给调用方（错名与填充时同一）＋ xyStore 公共写入口在 LS 满时
//      不向上抛、值读得回（降级到内存/IDB 这条老路不能被看护层破坏）
//   R5 一次拒绝只记一条（幂等安装：重复装直接返回）；装满过程那 26 次成功写一条都不记
//   R6 导出件里「状态：正常」与「写入拒绝 N 次」两行**同时**出现（＝本批要治的那个假阴性），
//      且【结论】段把它点名成一条问题
//   R7 sessionStorage 同样被看护
//   R8 连发 8 次被拒：现场逐条入账（8 条），整库扫描只做一次（快照 2s 节流＝每发都扫会把它弄得更卡）
//   Z1 全程零未捕获 JS 异常
// RED 基线（纯 HEAD 重出的产物）：R1/R3/R4/R5/R6/R7/R8 与 S1~S5 红；R2/Z1 两侧皆绿。
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = resolve(normalize(process.argv[2] || process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || here));
console.log('serve root = ' + root);
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

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };
// device.js 在产物里是内联进 index.html 的（与既有 153 条 js/device.js 登记同尺：读不到 js 文件就回落 index.html）
const art = (f) => { try { return readFileSync(existsSync(join(root, 'js', f)) ? join(root, 'js', f) : join(root, 'index.html'), 'utf8'); } catch (e) { return ''; } };
const src = (f) => { try { return readFileSync(join(root, 'src', f), 'utf8'); } catch (e) { return ''; } };

console.log('\n== S 静态锚 ==');
const dev = art('device.js'), devSrc = src('js/device.js');
ok(dev.includes('if (orig.__mochiLsWitness) return;') && dev.includes('value: wrapped, writable: true, configurable: true, enumerable: false') && dev.includes('record(name, k, v, e);'),
  'S1 看护三件套在产物：幂等守卫＋不可枚举安装＋被拒当场记账');
ok(dev.includes("throw e; // 照原样抛") && dev.includes('return orig.call(this, k, v);'),
  'S2 包完必 rethrow（吞掉＝调用方那 128 个 catch/降级全被改变语义）');
ok(dev.includes("'localStorage 写入拒绝 ' + window.__mochiStorRejN + ' 次") && dev.includes("'      出自 ' + it.at"),
  'S3 诊断【数据】段两行在产物（计数行＋那一帧的行）');
ok(dev.includes('/^localStorage 写入拒绝 (\\d+) 次/'), 'S4 【结论】段点名这一项在产物');
ok(devSrc.includes('if (window.localStorage) wrap(window.localStorage,') && devSrc.includes('if (window.sessionStorage) wrap(window.sessionStorage,'),
  'S5 src 侧同锚（两个 Storage 实例都装）');
const zone = devSrc.slice(devSrc.indexOf('#1305 localStorage 写入拒绝现场账'), devSrc.indexOf('#1295 桌面图层现场读数'))
  // 注释里那句报障描述本来就写着机型名（「iPhone 15 Pro Max + Safari 实报…」）——只扫代码行
  .split('\n').filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln)).join('\n');
ok(zone.length > 500 && !/userAgent|navigator\.vendor|iPhone|iPad|iPod|XiaoMi|Redmi|isIOS|isAndroid/i.test(zone),
  'S6 本批新增逻辑零机型／零 UA 分支', '命中机型判定');

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1600);
await page.evaluate(() => {
  const s = document.querySelector('.splash'); if (s) s.remove();
  document.querySelectorAll('.backup-remind-bar, .ver-update-bar').forEach((n) => n.remove());
  const mm = document.getElementById('modal-mask'); if (mm) mm.hidden = true;
});
await page.waitForTimeout(600);

console.log('\n== R 运行时 ==');
// P0 先证「页面真的加载了」：相对 root 会被服务的 403 打回空白页，那时所有运行时断言一起变红，
// 看起来像「修复没生效」，实际是喂错产物——这一行把两种红分开。
const p0 = await page.evaluate(() => ({ path: location.pathname, ph: typeof window.__mochiPhase, keys: Object.keys(localStorage).length }));
ok(p0.path === '/index.html' && p0.ph === 'function',
  'P0 页面真加载且产物真跑起来（红＝喂错根目录／被 403，不是本批的锅）', JSON.stringify(p0));
const r1 = await page.evaluate(() => {
  const d = Object.getOwnPropertyDescriptor(localStorage, 'setItem');
  return {
    arr: Array.isArray(window.__mochiStorRej), n: window.__mochiStorRejN || 0,
    marked: typeof localStorage.setItem === 'function' && localStorage.setItem.__mochiLsWitness === 1,
    enumerable: d ? d.enumerable === true : null,
    inKeys: Object.keys(localStorage).filter((k) => k === 'setItem').length,
    ssMarked: typeof sessionStorage.setItem === 'function' && sessionStorage.setItem.__mochiLsWitness === 1
  };
});
ok(r1.arr && r1.n === 0 && r1.marked, 'R1 看护已装且开局零记录（新会话）', JSON.stringify(r1));
ok(r1.enumerable === false && r1.inKeys === 0,
  'R1b 装成不可枚举自身属性（可枚举＝idb.js #139 大键清扫等三处 Object.keys(localStorage) 会把它当一条真键数进去）', JSON.stringify({ en: r1.enumerable, inKeys: r1.inKeys }));

const r2 = await page.evaluate(() => {
  for (let i = 0; i < 50; i++) localStorage.setItem('__1305_ok' + i, 'v' + i);
  const ph = (window.__mochiPhaseLog || []).filter((x) => String(x.tag).indexOf('ls-rej:') === 0).length;
  for (let i = 0; i < 50; i++) localStorage.removeItem('__1305_ok' + i);
  return { n: window.__mochiStorRejN || 0, len: (window.__mochiStorRej || []).length, ph };
});
ok(r2.n === 0 && r2.len === 0 && r2.ph === 0, 'R2 成功路径零记账零开销（不读值不算长度＝50 次正常写不入账、相位账本无痕）', JSON.stringify(r2));

// R3~R8：先把 LS 填到内核拒绝为止（＝复现报障那一刻的满库现场），再在满库下逐条问四个问题
const r34 = await page.evaluate(async () => {
  const out = { fillErr: '', fillN: 0, fillRejs: 0, probeErr: '', probeDelta: 0, k: '', bytes: 0, errName: 0, keys: 0, lsBytes: 0, maxK: '', at: '', bg: -1, storeThrew: '', storeBack: '', burstN: 0, burstKc: 0, keysAt: 0, keyBack: 0 };
  const mark = () => window.__mochiStorRejN || 0;
  try {
    const a = mark();
    const chunk = new Array(200001).join('x'); // 20 万字符 ≈400KB
    try { for (let i = 0; i < 400; i++) { localStorage.setItem('__1305_fill' + i, chunk); out.fillN++; } } catch (e) { out.fillErr = (e && e.name) || '异常'; }
    out.fillRejs = mark() - a; // 26 次成功写＋最后 1 次被拒＝只记 1 条（成功路径不入账）
    if (!out.fillErr) return out; // 填不满＝环境给的量太大，后面几组不作数（不报假绿）
    // ① 注定被拒的一发大值：必须照旧抛给调用方，且恰好记一条，现场里键名/体积/错误名/整域/那一帧齐
    const b = mark();
    const huge = new Array(20 * 1024 * 1024 + 1).join('y'); // 2 千万字符 ≈40MB，任何内核都给不出
    let caught = '';
    try { localStorage.setItem('__1305_huge', huge); } catch (e) { caught = (e && e.name) || '异常'; }
    const last = (window.__mochiStorRej || []).slice(-1)[0] || {};
    out.probeErr = caught; out.probeDelta = mark() - b;
    out.k = last.k || ''; out.bytes = last.bytes || 0; out.errName = last.err || '';
    out.keys = last.keys || 0; out.lsBytes = last.lsBytes || 0; out.maxK = last.maxK || '';
    out.at = last.at || ''; out.bg = typeof last.bg === 'number' ? last.bg : -1;
    // ② xyStore 公共写入口在满库下不得把异常抛给业务层，值还要读得回（内存/IDB 降级是它的老路）
    try {
      const st = window.xyStore ? window.xyStore('__1305') : null;
      if (!st) out.storeThrew = 'no-xyStore';
      else {
        st.set('store', 'hello-1305');
        out.storeBack = String(st.get('store') || '');
      }
    } catch (e) { out.storeThrew = (e && e.name) || '异常'; }
    // ③ 连发被拒：现场逐条都要记，整库扫描只做一次（每发都扫＝看护层把要取证的那一段弄得更卡）
    // 先等过 2s 节流窗：否则①那一发的快照还热着，本组会「零扫描假绿」。
    await new Promise((r) => setTimeout(r, 2100));
    let kc = 0;
    const c = mark();
    // 计数挂在 Storage.prototype 上——`localStorage.key = fn` 在 Blink/WebKit 会被命名属性写入器
    // 吃掉变成一条真键（setItem('key', …)），既数不到也脏了库（本批要防的就是这种误伤）。
    // ⚠️ 必须按描述符还原：`key` 就是 Storage.prototype 自己的属性，`delete proto.key` 会把
    //    **原生方法整条删掉**（实测：之后诊断【数据】段 `localStorage.key(i)` 直接 TypeError →
    //    「localStorage 不可访问」，红成"修复没生效"的假象）。
    const proto = Object.getPrototypeOf(localStorage);
    const origKey = proto.key;
    const keyDesc = Object.getOwnPropertyDescriptor(proto, 'key');
    try {
      proto.key = function (i) { kc++; return origKey.call(this, i); };
      for (let j = 0; j < 8; j++) { try { localStorage.setItem('__1305_burst' + j, huge); } catch (e) {} }
    } finally {
      if (keyDesc) Object.defineProperty(proto, 'key', keyDesc);
      else proto.key = origKey;
    }
    out.keyBack = typeof localStorage.key === 'function' ? 1 : 0;
    out.burstKc = kc;
    out.burstN = mark() - c;
    out.keysAt = localStorage.length;
  } finally {
    Object.keys(localStorage).forEach((k) => { if (k.indexOf('__1305') === 0) localStorage.removeItem(k); });
  }
  return out;
});
ok(/Quota|超出|配额|exceed/i.test(r34.fillErr),
  'R3a 环境真把 LS 填到被内核拒绝（填不满＝这一组不作数，不报假绿）', r34.fillErr || '没抛错');
ok(r34.probeErr === r34.fillErr && r34.probeErr !== '',
  'R3b 被拒的写照原样抛给调用方（看护层吞异常＝128 个直写点的降级逻辑集体失效，本批最贵的过头）', r34.probeErr);
ok(r34.probeDelta === 1 && r34.fillRejs === 1,
  'R5 一次拒绝只记一条（幂等安装＋记完就抛，不串成链；装满过程的 26 次成功写一条都不记）',
  JSON.stringify({ probe: r34.probeDelta, fill: r34.fillRejs, ok: r34.fillN }));
ok(r34.k === '__1305_huge' && r34.bytes > 1024 * 1024 && r34.errName === r34.fillErr,
  'R3c 现场账里有：哪条键／多大／错误名', JSON.stringify({ k: r34.k, b: r34.bytes, e: r34.errName }));
ok(r34.keys > 0 && r34.lsBytes > 1024 * 1024 && r34.maxK && r34.maxK.indexOf('__1305_fill') === 0,
  'R3d 现场账里有：当时整域多少键／多少体积／最大键是哪条（＝下一次导出件能直接定名）', JSON.stringify({ keys: r34.keys, bytes: r34.lsBytes, max: r34.maxK }));
ok(r34.bg === 0, 'R3e 现场账里有：那一刻在前台还是后台', String(r34.bg));
ok(/:\d+/.test(r34.at) && r34.at.indexOf('__mochiLsSetItemWitness') < 0,
  'R3f「出自」那一帧指到真文件:行且已跳过本包装自己（＝下一批改哪个文件不用再猜）', r34.at.slice(0, 90));
ok(r34.storeThrew === '' && r34.storeBack === 'hello-1305',
  'R4 xyStore 写入口在 LS 满时不向上抛、值读得回（内存/IDB 降级这条老路没被看护层破坏）', JSON.stringify({ threw: r34.storeThrew, back: r34.storeBack }));
ok(r34.burstN === 8 && r34.burstKc >= 1 && r34.burstKc <= Math.max(120, r34.keysAt * 2) && r34.keyBack === 1,
  'R8 连发 8 次被拒：现场逐条入账（8 条），整库扫描只做一次（＝key() 调用数 ≈ 键数而非 8×键数），且原生 key() 完好归还', JSON.stringify({ n: r34.burstN, kc: r34.burstKc, keys: r34.keysAt, keyBack: r34.keyBack }));

const r7 = await page.evaluate(() => {
  let threw = '';
  try { sessionStorage.setItem('__1305_ss', 'x'); sessionStorage.removeItem('__1305_ss'); } catch (e) { threw = (e && e.name) || '异常'; }
  return { marked: typeof sessionStorage.setItem === 'function' && sessionStorage.setItem.__mochiLsWitness === 1, threw };
});
ok(r7.marked && r7.threw === '', 'R7 sessionStorage 同样被看护（正常写不受影响）', JSON.stringify(r7));

// R6 真点【设备诊断】导出行：治的那个假阴性＝「状态：正常」与「写入拒绝 N 次」必须同时在场
const preDiag = await page.evaluate(() => ({ n: window.__mochiStorRejN || 0, len: (window.__mochiStorRej || []).length, keyFn: typeof localStorage.key }));
await page.evaluate(() => { const mm = document.getElementById('modal-mask'); if (mm) mm.hidden = true; const r = document.getElementById('row-diagnostics'); if (r) r.click(); });
let diagTxt = '';
try {
  await page.waitForFunction(() => {
    const el = document.getElementById('modal-textarea') || document.getElementById('modal-input');
    const t = el ? (el.value || el.textContent || '') : '';
    return t.includes('【结论】') && t.includes('localStorage');
  }, null, { timeout: 20000 });
} catch (e) {}
diagTxt = await page.evaluate(() => { const el = document.getElementById('modal-textarea') || document.getElementById('modal-input'); return el ? (el.value || el.textContent || '') : ''; });
const DBGON = process.env.DBG === '1';
if (DBGON) console.log('  ·[DBG] len=' + diagTxt.length + ' lines=' + JSON.stringify(diagTxt.split(/\r?\n/).filter((l) => /localStorage|【数据】|不可访问/.test(l)).slice(0, 8)));
// 红时把当场读数一起吐出来：n=0 与「整段被 catch 成不可访问」是两种完全不同的病因
const dbg = () => JSON.stringify(Object.assign({ txtLen: diagTxt.length }, preDiag));
await page.evaluate(() => { const mm = document.getElementById('modal-mask'); if (mm) mm.hidden = true; });
const rejLine = /^localStorage 写入拒绝 \d+ 次/m.exec(diagTxt);
ok(!!rejLine, 'R6a 诊断单【数据】段真有「localStorage 写入拒绝 N 次」行', diagTxt.slice(0, 60) + ' | ' + dbg());
ok(/localStorage 状态：正常（可写可读回）/.test(diagTxt) && !!rejLine,
  'R6b 同一份导出件里「状态：正常」与「写入拒绝 N 次」并存＝本批要治的假阴性当场可见', '缺一条即说明只留了导出当场的探针 | ' + dbg());
ok(/出自 \S+/.test(diagTxt), 'R6c 明细行带「出自 文件:行」', (diagTxt.match(/出自 [^\n]*/) || [''])[0].slice(0, 90));
ok(/localStorage 本会话写入被拒 \d+ 次/.test(diagTxt), 'R6d【结论】段把这一项点名成问题（用户只看结论时不等于没发生）', (diagTxt.match(/写入被拒[^\n]*/) || [''])[0].slice(0, 60));

ok(errs.length === 0, 'Z1 全程零未捕获 JS 异常', JSON.stringify(errs));
await ctx.close();
await browser.close();
server.close();
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
