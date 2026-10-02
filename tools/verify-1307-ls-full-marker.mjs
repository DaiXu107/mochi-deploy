// ===== 常驻回归脚本 #1307：localStorage 整域配额被同源兄弟站点吃满时，「只写 localStorage 的标记」静默失效 =====
// 用法：node tools/verify-1307-ls-full-marker.mjs
//       SRCDIR=<工程根目录> node tools/verify-1307-ls-full-marker.mjs   # 同尺 A/B（对纯 HEAD 源应红）
// 报障（用户实报 2026-09-26，一加 Ace 5 + Edge，且明说「其他设备型号也有出现」）：
//   ① 「已经备份了，还是不断弹出备份的弹窗」；② 「原来加的字卡、表情包，在一起的天数都没有了」。
// 同一台机的诊断单当场证据（零机型／零 UA 分支＝判据只取「内核有没有抛」「键在哪一层」两个事实）：
//   「localStorage 状态：写入失败(QuotaExceededError)」＋「LS 写探针：写入失败」
//   ＋「localStorage 整域 187 键 ≈10.0 MB（非本项目 94 键 ≈9.4 MB，最大 ml2_lf_ml2_p=2.0 MB）」
//   ＝GitHub Pages 一个源一份 localStorage，兄弟站点把配额占满，本站每一次写都被内核拒绝。
// 根因：
//   A）备份弹窗的冷却与「最近成功导出」两枚标记（__last-backup / __last-backup-remind）以及
//      Edge 安装提示的 __edge-backup-hint-done 全是裸 localStorage 写 + catch 吞 ⇒ 标记永远读成 0，
//      pwa.js 的 due() 永远为真，而它挂在每 2s 一次的快轮询上 ⇒ 用户刚关掉又弹＝「备份过了还在弹」。
//   B）love-start（在一起天数）等 xyStore 键在这类设备上值只活在 IndexedDB（LS 那档每次都抛），
//      而 personalize.js 的 updateLove/renderDeskAnniv 只在模块求值时同步跑一次——那一刻 idbRestore
//      还没回填完、LS 又读不到 ⇒ 桌面/设置渲染成「请先设置」，之后补齐也没人回头再刷（同 #289 打卡按钮）。
//      字卡库/表情包那一族早有自己的 hydrate 通道（chatcard.js __xyIdbDeferredKeys + idbHydrateKey），
//      本批不碰；诊断单里 cc-groups-public 22.43MB、my-emoji-groups 705.8KB、自定义字卡 1327 张都还在库里
//      ＝那两样属显示层空窗／另一存储分区，不由本批的标记层收口（见 WORKLOG「同族残余」）。
// 修复：标记改走 xyStore（内存缓存 + LS 快照 + IndexedDB；idbRestore 对本键无排除规则＝启动自动带回内存），
//      days 一族补上 mochi-restore-done / mochi-wrj-heal 重放（照抄 #289 那条已验证的路）。
// 断言（全部只取「弹出次数／键在哪一层／DOM 文本」，不取耗时＝耗时随机器负载漂移）：
//   S1~S7  源码逻辑锚
//   E0     夹具真把 LS 填到内核抛错（填不满＝下面几组不作数，不报假绿）
//   T1     满库当场：备份提醒照旧会弹一次（受保护的产品功能没被削弱）
//   T2     关掉之后 7s 内不第二次弹（＝「不断弹出」本体）
//   T3     冷却标记落进可读回的持久层；T3b 它在裸 LS 里确实没有（＝不是靠老路留下的）
//   T4     只在 IndexedDB 里的那枚时间戳经启动回填读得回（本批依赖的机制）
//   T4b    冷却标记真的落在 IndexedDB（跨重启的那一份）
//   T5     重新加载（LS 仍满、标记在库里）＝不再弹（＝用户那句「已经备份了还在弹」）
//   T6a~d  在一起天数：值只在 IndexedDB 时，回填完成后桌面天数卡／纪念日卡／设置页按钮真的渲染出来
//   T7a~c  对照：LS 正常时「刚备份过＝不打扰」这条老语义照旧成立；满库时 xyStore.set 不向上抛、
//          值读得回（老降级路完好）
//   Z1     全程零未捕获 JS 异常
// RED 基线（纯 HEAD 源组装的产物）：S1~S7＋T2＋T3＋T4b＋T5＋T6a~d 红；
// E0／T1／T3b／T4／T7a~c／Z1 两侧皆绿＝夹具真实且旧契约未动。
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = resolve(normalize(process.env.SRCDIR || process.argv[2] || here));
console.log('test root = ' + root);
const srcDir = join(root, 'src');
let pass = 0, fail = 0;
const ok = (cond, name, x) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (x !== undefined ? '  [' + JSON.stringify(x).slice(0, 240) + ']' : '')); } };

// ---- S 组：源码逻辑锚（不依赖浏览器；红绿对照时对纯 HEAD 源应红） ----
console.log('\n== S 源码锚 ==');
const pwaSrc = readFileSync(join(srcDir, 'js', 'pwa.js'), 'utf8');
const dbSrc = readFileSync(join(srcDir, 'js', 'data-backup.js'), 'utf8');
const perSrc = readFileSync(join(srcDir, 'js', 'personalize.js'), 'utf8');
ok(/function markReminded\(\) \{ flagSet\('__last-backup-remind', String\(Date\.now\(\)\)\); \}/.test(pwaSrc),
  'S1 冷却标记写入口改走 xyStore（裸写＋catch 吞＝永远读成 0）');
ok(/const lastRemind = ts\('__last-backup-remind'\)/.test(pwaSrc) && /function ts\(key\) \{ try \{ return Number\(flagGet\(key\)\) \|\| 0;/.test(pwaSrc),
  'S2 读侧同一把尺子（读 flagGet，回落裸 LS 一次以兼容老数据）');
ok(/if \(!flagGet\('contacts'\)\) return false;/.test(pwaSrc),
  'S3 contacts 也按 xyStore 键读（裸读 LS 在满库设备上读空＝整族静默不弹）');
ok(/hintFlag\.set\('__edge-backup-hint-done'/.test(pwaSrc) && /!hintGet\('__last-backup'\)/.test(pwaSrc),
  'S4 Edge 安装提示的已提示标记同族收口（否则每次点安装都重弹一次）');
ok(/window\.xyStore\('xy-home-v2'\)\.set\('__last-backup', String\(Date\.now\(\)\)\)/.test(dbSrc),
  'S5 导出成功标记落进持久层（这一枚是「我已经备份过了」的唯一凭据）');
ok(/const replayDeskAnnivAfterRestore = \(\) => \{/.test(perSrc)
  && /document\.addEventListener\('mochi-restore-done', replayDeskAnnivAfterRestore\)/.test(perSrc)
  && /document\.addEventListener\('mochi-wrj-heal', replayDeskAnnivAfterRestore\)/.test(perSrc),
  'S6 在一起天数补上回填后重放（#289 同一条路：restore-done + wrj-heal 双通道）');
{
  const body = perSrc.split('const replayDeskAnnivAfterRestore')[1] || '';
  ok(/syncLoveDateBtn\(store\.get\('love-start'\)\)/.test(body) && /updateLove\(\)/.test(body) && /renderDeskAnniv\(\)/.test(body),
    'S7 重放覆盖三处读数（设置页按钮文字／桌面天数卡／纪念日倒计时卡）');
}

// ---- 测试专用组装：按 build.mjs 同顺序拼临时 index.html（不碰仓库产物） ----
const buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8');
const grab = (name) => JSON.parse(buildSrc.match(new RegExp('const ' + name + " = (\\[[^\\]]*\\])"))[1].replace(/'/g, '"'));
const cssFiles = grab('cssFiles'), jsFiles = grab('jsFiles');
let html = readFileSync(join(srcDir, 'template.html'), 'utf8');
html = html.replace('/*__STYLES__*/', () => cssFiles.map((f) => readFileSync(join(srcDir, 'css', f), 'utf8')).join('\n'));
html = html.replace('/*__SCRIPTS__*/', () => jsFiles.map((f) => '(function(){ try {\n' + readFileSync(join(srcDir, 'js', f), 'utf8') + '\n} catch(e){ console.error("[JS]", e && e.message); } })();').join('\n'));
html = html.split('__BUILD_INFO__').join('verify-1307').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-verify-1307-' + Date.now());
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

/**
 * 起一个「满库老用户」会话（＝复现报障那一刻的现场）：
 *   1) 第一次导航 LS 还空：把干扰开关关掉，再用页面自己的 idbSet 把 __last-backup / love-start
 *      写成「只在 IndexedDB」，随后从 LS 删掉 ⇒ 等价于「写 LS 一直失败、值只在库里」的这台机；
 *      （刻意不种 __last-backup-remind＝今天还没提醒过，弹窗该出现）
 *   2) 把 LS 填到内核抛错为止（每发 ≈400KB，与 #1305 同一夹具）；
 *   3) 重新加载 ⇒ 此后这个上下文里每一次 LS 写都会被内核拒绝。
 */
async function bootFull(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  ctx.on('page', (p) => { p.on('pageerror', (e) => pageErrors.push(String(e && e.message).slice(0, 160))); });
  await ctx.addInitScript(([o]) => {
    if (!/^https?:/.test(location.href)) return; // about:blank 上无 localStorage 权限（环境噪声）
    const G = 'xy-home-v2:';
    // 现场本体＝「内核把本站每一次 localStorage 写都拒掉」（诊断单读数：LS 写探针失败、整域 10MB
    // 里 9.4MB 是同源兄弟站点的键）。真实填充（fillLs）只保证「当场确实抛过」，但应用启动时会自己
    // 删掉一些键把空间腾回来 ⇒ 后续小值写入又能成功＝夹具不守恒；故再把这一拒按前缀固定下来。
    // 装成不可枚举自身属性（#1305 同一课：三处 Object.keys(localStorage) 会把可枚举的 setItem
    // 当成一条真键数进去），并且落在 device.js 那层看护之前＝看护层把自己的包装套在我们外面，
    // 被拒那一发照样入账并照原样上抛，调用方 catch／降级语义一字不变。
    try {
      const native = Storage.prototype.setItem;
      Object.defineProperty(window.localStorage, 'setItem', {
        value: function (k, v) {
          if (String(k).indexOf('xy-home-v2:') === 0) {
            const err = new Error('verify-1307 夹具：同源配额已满');
            err.name = 'QuotaExceededError';
            throw err;
          }
          return native.call(this, k, v);
        },
        writable: true, configurable: true, enumerable: false
      });
      // 夹具自己预置的键走原型那一档（＝等价「这台机在配额被占满之前早就写好的那 93 条键」）；
      // 之后应用自己写进来的每一发都被上面拒掉——这才是报障那一刻的现场。
      var nSet = function (k, v) { try { native.call(window.localStorage, k, v); } catch (e) {} };
    } catch (e) { var nSet = function (k, v) { try { localStorage.setItem(k, v); } catch (e2) {} }; }
    nSet(G + 'contacts', JSON.stringify([{ id: 'default', name: '小美' }]));
    nSet(G + 'active-contact', 'default');
    nSet(G + 'migrated-v1', '1');
    nSet(G + 'applock-en', '0');
    nSet(G + 'applock-qa-en', '0');
    nSet(G + 'desk-checkin-en', '0');
    nSet(G + 'desk-call-en', '0');
    nSet(G + 'psync-en', '0');
    nSet(G + 'bg-notify', '0');
    // 关掉「其他互动功能字卡」总开关：ta-ask 等弹窗共用全站唯一 #modal-mask，会在时间轴里把
    // 备份提醒顶掉＝假红（与 verify-backup-remind-daily 同口径收窄变量）
    nSet(G + 'default:dc-enabled', '0');
    // 弹窗计数：全站唯一 #modal-mask 每次从隐藏变可见且标题是本提醒 ⇒ +1（只数次数，不取耗时）
    const hook = () => {
      const m = document.getElementById('modal-mask');
      if (!m) return false;
      if (m.__c1307) return true;
      new MutationObserver(() => {
        try {
          if (m.hidden) return;
          const t = document.getElementById('modal-title');
          if (/数据会被自动清空/.test(t ? t.textContent : '')) window.__popN = (window.__popN || 0) + 1;
        } catch (e) {}
      }).observe(m, { attributes: true, attributeFilter: ['hidden'] });
      m.__c1307 = 1;
      return true;
    };
    if (!hook()) { const iv = setInterval(() => { if (hook()) clearInterval(iv); }, 16); setTimeout(() => clearInterval(iv), 12000); }
    if (window.__seeding) return;
    window.__seeding = 1;
    const seed = async () => {
      if (!window.idbSet) { setTimeout(seed, 50); return; }
      try {
        await window.idbSet(G + '__last-backup', String(Date.now() - (o.daysBack || 5) * 86400000));
        if (o.loveStart) await window.idbSet(G + 'default:love-start', o.loveStart);
        try { localStorage.removeItem(G + '__last-backup'); localStorage.removeItem(G + '__last-backup-remind'); localStorage.removeItem(G + 'default:love-start'); } catch (e) {}
        window.__seeded = 1;
      } catch (e) { window.__seeded = 'ERR'; }
    };
    setTimeout(seed, 60);
  }, [{ daysBack: opts.daysBack, loveStart: opts.loveStart }]);
  const page = await ctx.newPage();
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  page.setDefaultTimeout(30000);
  const api = {
    ctx, page,
    async close() { try { await ctx.close(); } catch (e) {} },
    wait: (ms) => page.waitForTimeout(ms),
    enter: () => page.evaluate(() => {
      const s = document.getElementById('splash');
      if (s) { s.classList.add('hide'); setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 400); }
      return true;
    }),
    waitFor: async (fn, ms) => {
      const deadline = Date.now() + (ms || 20000);
      while (Date.now() < deadline) {
        if (await fn()) return true;
        await page.waitForTimeout(250);
      }
      return false;
    },
    seedDone: () => api.waitFor(() => page.evaluate(() => window.__seeded === 1), 25000),
    fillLs: () => page.evaluate(() => {
      const chunk = new Array(200001).join('x'); // ≈400KB/发，与 #1305 同一夹具
      let err = '', n = 0;
      try { for (let i = 0; i < 200; i++) { localStorage.setItem('__1307_fill' + i, chunk); n++; } } catch (e) { err = (e && e.name) || '异常'; }
      window.__fillErr = err;
      // 内核真墙之外，再确认本站前缀这一发当场被拒（＝后面所有断言的前提，随每次导航都成立）
      let probe = '';
      try { localStorage.setItem('xy-home-v2:__1307_probe', 'x'); } catch (e) { probe = (e && e.name) || '异常'; }
      return { err, n, probe };
    }),
    reload: () => page.reload({ waitUntil: 'domcontentloaded' }),
    snap: () => page.evaluate(() => {
      const G = 'xy-home-v2:';
      const vis = (el) => !!(el && !el.hidden && el.getClientRects().length > 0);
      const mask = document.getElementById('modal-mask');
      const title = document.getElementById('modal-title');
      const txt = (id) => { const e = document.getElementById(id); return e ? String(e.textContent || '').trim() : ''; };
      const raw = (k) => { try { return localStorage.getItem(G + k); } catch (e) { return 'READ_ERR'; } };
      const viaStore = (k) => { try { return window.xyStore ? String(window.xyStore('xy-home-v2').get(k)) : 'NOSTORE'; } catch (e) { return 'ERR'; } };
      return {
        dataReady: !!window.__mochiDataReady,
        // 每次读数都顺手确认这一发仍被拒（夹具守恒：应用启动会自己删键腾出空间，只看一次不算数）
        probeLive: (() => { try { localStorage.setItem('xy-home-v2:__1307_live', 'x'); return ''; } catch (e) { return (e && e.name) || '异常'; } })(),
        popN: window.__popN || 0,
        ourModal: !!(vis(mask) && /数据会被自动清空/.test(title ? title.textContent : '')),
        remindLs: raw('__last-backup-remind'),
        remindFlag: viaStore('__last-backup-remind'),
        backupFlag: viaStore('__last-backup'),
        loveDays: txt('love-days'),
        memDays: txt('mem-love-days'),
        dateBtn: txt('love-date-btn-txt'),
        probeErr: window.__fillErr || ''
      };
    }),
    idbOf: (k) => page.evaluate((kk) => (window.idbGet ? window.idbGet(kk) : Promise.resolve('NOFN')), k),
    clickPill: (label) => page.evaluate((l) => {
      const bs = Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill'));
      const b = bs.filter((x) => x.textContent.trim() === l)[0];
      if (!b) return false;
      b.click();
      const okBtn = document.getElementById('modal-ok');
      if (okBtn) okBtn.click();
      return true;
    }, label)
  };
  return api;
}

const DAY = 86400000;
const loveExpected = 300;
const loveISO = (function () {
  const d = new Date(Date.now() - loveExpected * DAY);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
})();

console.log('\n== 满库现场（E0／T1~T6）==');
{
  const b = await bootFull({ daysBack: 5, loveStart: loveISO });
  const seeded = await b.seedDone();
  const fill = await b.fillLs();
  ok(seeded === true && /Quota|exceed|超出|配额/i.test(fill.probe),
    'E0 夹具当场成立：真实填充把内核问墙 ＋ 本站前缀这一发被拒（不报假绿）', { realFill: fill.err || '未抛(给的量大)', n: fill.n, probe: fill.probe, seeded });
  await b.reload();
  await b.wait(1200);
  await b.enter();
  // T1 提醒本身照旧会弹（修复不能把受保护的产品提醒弄没）
  await b.waitFor(async () => (await b.snap()).popN > 0, 30000);
  const s1 = await b.snap();
  ok(s1.popN >= 1, 'T1 满库当天仍然弹提醒（备份提醒逻辑一字未削弱）', { popN: s1.popN, ready: s1.dataReady });
  // T3 冷却标记进可读回的持久层；T3b 它在裸 LS 里没有＝走的是新路（重载后只剩内存/IDB 那两档）
  ok(Number(s1.remindFlag) > 0, 'T3 冷却标记写进了可读回的持久层（红侧此处＝裸写被吞、xyStore 读空）', s1.remindFlag);
  ok(s1.remindLs === null && /Quota|exceed|配额/i.test(s1.probeLive), 'T3b 该标记在裸 LS 里确实没有（对照：证明它不是靠老路留下的）', { ls: s1.remindLs, probe: s1.probeLive });
  // T2 关掉之后不再每 2s 重弹
  await b.clickPill('稍后');
  await b.wait(7000);
  const s2 = await b.snap();
  ok(s2.popN === 1 && !s2.ourModal, 'T2 关掉后 7s 内没有第二次弹出（＝「不断弹出备份弹窗」本体）', { popN: s2.popN, modal: s2.ourModal });
  // T6 在一起天数：值只在 IDB 时，回填完成后真的渲染出来
  ok(/^\d+ 天$/.test(s2.loveDays) && Number(s2.loveDays.replace(/\D/g, '')) === loveExpected,
    'T6a 桌面「我们在一起 N 天」按库里的 love-start 渲染（红侧停在空）', { loveDays: s2.loveDays, want: loveExpected + ' 天' });
  ok(/^\d+$/.test(s2.memDays) && Number(s2.memDays) === loveExpected, 'T6b 纪念日卡天数同源（同一次 store.get 读数）', s2.memDays);
  ok(/年.*月.*日/.test(s2.dateBtn) && !/点击设置日期/.test(s2.dateBtn), 'T6c 设置页日期按钮不再停在「点击设置日期」', s2.dateBtn);
  await b.close();
}

console.log('\n== 重新加载（T4/T4b/T5/T6d）==');
{
  const b = await bootFull({ daysBack: 5, loveStart: loveISO });
  const seeded = await b.seedDone();
  await b.fillLs();
  await b.reload();
  await b.wait(1200);
  await b.enter();
  await b.waitFor(async () => (await b.snap()).popN > 0, 30000);
  await b.clickPill('稍后');
  // 等冷却标记真的落进 IndexedDB 再走下一次导航（不等＝绿侧可能因写库没完成而误红）
  const landed = await b.waitFor(async () => /^\d{13}$/.test(String(await b.idbOf('xy-home-v2:__last-backup-remind'))), 15000);
  await b.wait(1500);
  // 第二次导航＝用户第二天再打开：LS 依旧满，标记只可能来自库里
  await b.reload();
  await b.wait(1200);
  await b.enter();
  const ready = await b.waitFor(async () => (await b.snap()).dataReady, 30000);
  await b.wait(9000);
  const s = await b.snap();
  ok(ready && s.popN === 0, 'T5 重新加载后（LS 仍满、标记在库里）不再弹＝「已经备份了还在弹」收口', { popN: s.popN, ready: s.dataReady, remind: s.remindFlag });
  ok(Number(s.backupFlag) > 0, 'T4 只在 IndexedDB 里的那枚时间戳经启动回填读得回（本批依赖的机制）', s.backupFlag);
  ok(/^\d+ 天$/.test(s.loveDays), 'T6d 重载后天数依旧渲染（回填完成后重放，不靠运气时序）', s.loveDays);
  const idbRemind = String(await b.idbOf('xy-home-v2:__last-backup-remind'));
  ok(/^\d{13}$/.test(idbRemind), 'T4b 冷却标记真的落在 IndexedDB（跨重启的那一份）', idbRemind);
  await b.close();
}

console.log('\n== 对照（T7：两侧皆绿＝没修过头）==');
{
  // 对照（LS 正常）：刚备份过（1 小时前）＝今天该安静——新的读侧必须照样认这枚标记
  //（红侧同样绿＝这条老语义没被动过；本批只搬「写去哪」，不搬「什么时候该闭嘴」）
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  ctx.on('page', (p) => { p.on('pageerror', (e) => pageErrors.push(String(e && e.message).slice(0, 160))); });
  await ctx.addInitScript(() => {
    if (!/^https?:/.test(location.href)) return;
    const G = 'xy-home-v2:';
    localStorage.setItem(G + 'contacts', JSON.stringify([{ id: 'default', name: '小美' }]));
    localStorage.setItem(G + 'active-contact', 'default');
    localStorage.setItem(G + 'migrated-v1', '1');
    localStorage.setItem(G + 'applock-en', '0');
    localStorage.setItem(G + 'desk-checkin-en', '0');
    localStorage.setItem(G + 'bg-notify', '0');
    localStorage.setItem(G + 'default:dc-enabled', '0');
    localStorage.setItem(G + '__last-backup', String(Date.now() - 3600000)); // 1 小时前刚导出过
  });
  const p = await ctx.newPage();
  await p.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); setTimeout(() => { if (s.parentNode) s.parentNode.removeChild(s); }, 400); } });
  await p.waitForTimeout(9000);
  const fresh = await p.evaluate(() => {
    const mask = document.getElementById('modal-mask');
    const t = document.getElementById('modal-title');
    return {
      modalUp: !!(mask && !mask.hidden && /数据会被自动清空/.test(t ? t.textContent : '')),
      viaStore: window.xyStore ? String(window.xyStore('xy-home-v2').get('__last-backup')) : 'NOSTORE',
      ready: !!window.__mochiDataReady
    };
  });
  ok(!fresh.modalUp && /^\d{13}$/.test(fresh.viaStore), 'T7a 刚备份过（1 小时内）＝照旧不打扰，且新读侧认这枚标记', fresh);
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  ctx.on('page', (p) => { p.on('pageerror', (e) => pageErrors.push(String(e && e.message).slice(0, 160))); });
  const p2 = await ctx.newPage();
  await p2.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  const r = await p2.evaluate(() => {
    const chunk = new Array(200001).join('x');
    let err = '';
    try { for (let i = 0; i < 200; i++) localStorage.setItem('__1307_t7' + i, chunk); } catch (e) { err = (e && e.name) || '异常'; }
    let threw = '', back = 'NOSTORE';
    try { window.xyStore('xy-home-v2').set('__1307_probe', 'hello-1307'); } catch (e) { threw = (e && e.name) || '异常'; }
    try { back = String(window.xyStore('xy-home-v2').get('__1307_probe')); } catch (e) { back = 'ERR'; }
    return { err, threw, back };
  });
  ok(/Quota|exceed|超出|配额/i.test(r.err), 'T7b 这一组的环境同样真抛错（不报假绿）', r.err || '没抛错');
  ok(!r.threw && r.back === 'hello-1307', 'T7c 满库时 xyStore.set 不向上抛、值读得回（老降级路完好）', r);
  await ctx.close();
}

console.log('\n== Z 收尾 ==');
ok(pageErrors.length === 0, 'Z1 全程零未捕获 JS 异常', pageErrors.slice(0, 3));
try { await browser.close(); } catch (e) {}
try { server.close(); } catch (e) {}
try { rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
console.log('\n结果：通过 ' + pass + ' · 失败 ' + fail);
process.exit(fail ? 1 : 0);
