// ===== 常驻回归：#1210「写了＝到了」两处静默失败（旧键迁移删在前 / 导入兜底报假成功）=====
// 根因（零机型分支，任何存储吃紧或 IDB 事务挂起的设备都会踩）：
//  ① js/contacts.js migrateLegacy：把旧顶层键搬进 default 命名空间时，xyStore.set 之后
//    【无条件】cleanupOld（聊天键还连 IndexedDB 那份旧根键一起删）。而 set 内部 LS 写失败只是
//    打个脏标记、IDB 写是 fire-and-forget，get 又优先读内存缓存（刚 set 完必然读得到）＝证不了
//    落盘 ⇒「新键没落成、两份旧键已删」＝整段聊天记录物理消失。
//  ② js/data-backup.js 导入：IDB 兜底写入的返回值只喂给一个从没被读过的计数器，提示语按
//    「发起过写入的件数」说「大文件 N 项已存入 IndexedDB」＝假成功；而 clearLs 已清掉旧值，
//    这类键新值也没落成＝两头空，文件头承诺的「写入失败逐条回滚」那个整包 rollback() 没有调用点。
// 修法：① set 后确认新键真落了盘（小键认 LS、大键认 idbHasKey 三态的 true）才删旧键，
//    证不到就保留旧键下次启动重试（迁移幂等）；② 只报确认落成的件数/字节，未落成的键逐条还原
//    导入前的旧值，提示按真实结果说，死函数删除。
// 断言（判别器＝同 tip 纯 HEAD 副本红侧；实测修复副本 10/10 绿、纯 HEAD 恰红下面 5 条主判据）：
//   A1p 前置：旧顶层聊天键确实被搬过一次（防场景空转）
//   A1  新键两条写路都不成时旧顶层聊天键必须保留（红＝cleanupOld 无条件删，旧键当场消失）
//   A1b 闸门没把值偷偷写到别处（新键 LS 仍为空＝判据取的是真落盘）
//   A2p 前置：LS 里再播一枚无害旧键当引子（migrateLegacy 见不到任何旧键就不扫 IDB），确认 IDB 旧聊天键被搬过
//   A2  旧值只在 IndexedDB 时，新键没落成就不删 IDB 旧根键（红＝同上，历史彻底没了）
//   A3  正常设备：旧键照常迁进 default 并被清掉（两侧都该绿＝闸门没有把迁移卡死）
//   B1  导入后进度面板必须说出「N 项未能存入 IndexedDB」（红＝当场报「全部存入」）
//   B2  计数只算确认落成的键（红＝把发起次数当成功次数，报「大文件 2 项」）
//   B3  两头落空的键逐条还原导入前旧值（红＝旧值被 clearLs 清走、新值又没写进去＝两头空）
//   B4  真落成的键照常算成功且小键正常恢复（两侧都该绿＝没有改成「一律报失败」）
// 用法：node build.mjs && node tools/verify-1210-write-landed.mjs
//       红绿对照：MOCHI_SERVE_ROOT=<纯 HEAD 产物目录> node tools/verify-1210-write-landed.mjs
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.MOCHI_SERVE_ROOT || process.env.SERVE_ROOT || here);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(root, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
console.log('serve root = ' + root);

const browser = await chromium.launch({ headless: true });
let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  [' + detail + ']' : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openApp(ctx) {
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e && e.message || e).slice(0, 160)));
  await page.goto(baseUrl + '/index.html');
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => {
    const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
    const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; s.style.display = 'none'; }
    const q = document.getElementById('qa-mask'); if (q) { q.style.setProperty('display', 'none', 'important'); q.hidden = true; }
  }).catch(() => {});
  return { page, jsErrors };
}
// 等迁移整条链走完（旧键逐个过一遍才会置位），再留 2s 给未落地的 idbDelete
async function waitMigrated(page) {
  await page.waitForFunction(() => !!window.__contactsMigrated, null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(2200);
}

const G = 'xy-home-v2';
const OLD_CHAT = G + ':chat-msgs';
const NEW_CHAT = G + ':default:chat-msgs';
const CHAT_SEED = JSON.stringify([{ side: 'out', text: '1210 旧聊天记录', ts: 1700000000000 }]);

// ================= A 组：旧顶层聊天键迁移（contacts.js） =================
// A1 LS 里有旧聊天键，新键两条写路都不通 → 旧键必须留着（下次启动重试），不得当场删
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(([seed, oldK]) => {
    try { localStorage.setItem(oldK, seed); } catch (e) {}
    (function () {
      const nk = 'xy-home-v2:default:chat-msgs';
      window.__tried1210 = 0;
      try {
        const raw = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k) {
          if (k === nk) { const err = new Error('QuotaExceededError'); err.name = 'QuotaExceededError'; throw err; }
          return raw.apply(this, arguments);
        };
      } catch (e) {}
      let real;
      try {
        Object.defineProperty(window, 'idbSet', {
          configurable: true,
          get() { return function (k) { if (k === nk) { window.__tried1210++; return Promise.resolve(false); } return real ? real.apply(null, arguments) : Promise.resolve(false); }; },
          set(v) { real = v; }
        });
      } catch (e) {}
    })();
  }, [CHAT_SEED, OLD_CHAT]);
  const { page, jsErrors } = await openApp(ctx);
  await waitMigrated(page);
  const st = await page.evaluate(([oldK, newK]) => ({
    oldLs: localStorage.getItem(oldK),
    newLs: localStorage.getItem(newK),
    tried: window.__tried1210 | 0,
    migrated: !!window.__contactsMigrated
  }), [OLD_CHAT, NEW_CHAT]);
  ok(st.tried > 0, 'A1 前置：旧聊天键确实被搬过一次（否则下一条是空转）', 'idbSet(new) 次数=' + st.tried);
  ok(st.migrated && st.oldLs === CHAT_SEED, 'A1 新键没落成 → 旧聊天键保留（红＝无条件 cleanupOld，旧键当场没了）', JSON.stringify({ old: (st.oldLs || '').slice(0, 18), newLs: st.newLs, migrated: st.migrated }));
  ok(st.newLs === null, 'A1b 闸门没有偷偷把值写进别处（新键 LS 仍为空＝判据取的是真落盘）', String(st.newLs));
  if (jsErrors.length) console.log('    （A1 环境噪声：页面异常 ' + jsErrors.length + ' 条，样例 ' + jsErrors[0] + '）');
  await ctx.close();
}
// A2 旧值只在 IndexedDB（LS 没有）→ 新键没落成就不删 IDB 旧根键
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(([seed, oldK]) => {
    // migrateLegacy 的门在最前面：LS 里一个旧顶层键都没有就直接收工（不扫 IDB）——
    // 所以这条场景要再播一枚无害旧键当引子，才走得到「旧值只在 IndexedDB」那条腿。
    try { localStorage.setItem('xy-home-v2:lbl-partner', '1210 昵称'); } catch (e) {}
    // 单次装载：种子在应用脚本之前发起，迁移要等 restore-done（几秒后）才跑，来得及
    window.__seed1210 = new Promise((resolve) => {
      try {
        const req = indexedDB.open('mochi-db', 1);
        req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv'); };
        req.onsuccess = () => {
          const db = req.result;
          try {
            const tx = db.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(seed, oldK);
            tx.oncomplete = tx.onerror = tx.onabort = () => { try { db.close(); } catch (e) {} resolve(true); };
          } catch (e) { resolve(false); }
        };
        req.onerror = req.onblocked = () => resolve(false);
      } catch (e) { resolve(false); }
    });
    (function () {
      const nk = 'xy-home-v2:default:chat-msgs';
      window.__tried1210 = 0;
      try {
        const raw = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k) {
          if (k === nk) { const err = new Error('QuotaExceededError'); err.name = 'QuotaExceededError'; throw err; }
          return raw.apply(this, arguments);
        };
      } catch (e) {}
      let real;
      try {
        Object.defineProperty(window, 'idbSet', {
          configurable: true,
          get() { return function (k) { if (k === nk) { window.__tried1210++; return Promise.resolve(false); } return real ? real.apply(null, arguments) : Promise.resolve(false); }; },
          set(v) { real = v; }
        });
      } catch (e) {}
    })();
  }, [CHAT_SEED, OLD_CHAT]);
  const { page } = await openApp(ctx);
  await waitMigrated(page);
  const still = await page.evaluate(([oldK]) => new Promise((res) => {
    try { Promise.resolve(window.idbHasKey(oldK)).then((h) => res({ has: h, tried: window.__tried1210 | 0 })).catch(() => res({ has: 'E', tried: window.__tried1210 | 0 })); } catch (e) { res({ has: 'E', tried: window.__tried1210 | 0 }); }
  }), [OLD_CHAT]);
  ok(still.tried > 0, 'A2 前置：IDB 里的旧聊天键确实被迁移过一遍（否则下面那条是空转）', 'idbSet(new) 次数=' + still.tried);
  ok(still.has === true, 'A2 旧值只在 IDB 时，新键没落成就不删 IDB 旧根键（红＝idbDelete 旧根键＝历史彻底没了）', 'idbHasKey(old)=' + still.has);
  await ctx.close();
}
// A3 正常设备（不仿真写失败）：旧键照常迁进 default 并被清掉——闸门不得把迁移卡死
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(([seed, oldK]) => {
    try { localStorage.setItem(oldK, seed); } catch (e) {}
  }, [CHAT_SEED, OLD_CHAT]);
  const { page } = await openApp(ctx);
  await waitMigrated(page);
  const st = await page.evaluate(([oldK, newK]) => ({
    oldLs: localStorage.getItem(oldK),
    newLs: localStorage.getItem(newK)
  }), [OLD_CHAT, NEW_CHAT]);
  const landedNew = st.newLs === CHAT_SEED || (await page.evaluate(([newK]) => new Promise((res) => {
    try { Promise.resolve(window.idbGet(newK)).then((v) => res(typeof v === 'string' ? v : JSON.stringify(v || null))).catch(() => res('E')); } catch (e) { res('E'); }
  }), [NEW_CHAT]));
  ok(st.oldLs === null && !!landedNew, 'A3 正常设备旧键照常迁入 default 并清掉（两侧都该绿＝幂等迁移语义没变）', JSON.stringify({ old: st.oldLs, nw: String(st.newLs || landedNew).slice(0, 18) }));
  await ctx.close();
}

// ================= B 组：导入兜底写入的报功与逐条回滚（data-backup.js） =================
const BAD_K = G + ':default:big-bad1210';
const GOOD_K = G + ':default:big-good1210';
const OLD_BAD_VALUE = 'OLD-VALUE-1210';
const BIG = 'x'.repeat(300 * 1024);
const BACKUP_JSON = JSON.stringify({
  app: 'mochi-zika',
  ls: {
    [G + ':contacts']: JSON.stringify([{ id: 'default', name: '测试' }]),
    [G + ':theme-mode']: 'dark',
    [BAD_K]: BIG,
    [GOOD_K]: BIG
  },
  idb: {}
});
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(([badK, oldVal]) => {
    try { localStorage.setItem(badK, oldVal); } catch (e) {}
    try { localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now())); } catch (e) {}
    const nk = badK;
    let real;
    try {
      Object.defineProperty(window, 'idbSet', {
        configurable: true,
        get() {
          return function (k) {
            if (k === nk) return Promise.resolve(false); // 这一项的 IDB 兜底写入「发起过但没落成」
            return real ? real.apply(null, arguments) : Promise.resolve(false);
          };
        },
        set(v) { real = v; }
      });
    } catch (e) {}
  }, [BAD_K, OLD_BAD_VALUE]);
  const { page, jsErrors } = await openApp(ctx);
  const chooser = { file: null };
  page.on('filechooser', async (fc) => {
    try { await fc.setFiles({ name: 'mochi-backup-1210.json', mimeType: 'application/json', buffer: Buffer.from(BACKUP_JSON, 'utf8') }); chooser.file = 'set'; }
    catch (e) { chooser.file = 'ERR:' + (e.message || e); }
  });
  // 设置页 → 「导入数据」→ 范围弹窗选「完整备份」（默认模式）→ 物理点「确定」＝原生弹选择器
  await page.evaluate(() => {
    document.querySelectorAll('.page').forEach((p) => { p.hidden = (p.id !== 'page-settings'); });
    const r = document.getElementById('row-import'); if (r) r.click();
  });
  await page.waitForFunction(() => {
    const t = document.getElementById('modal-title');
    return !!(t && t.textContent === '选择导入范围');
  }, null, { timeout: 8000 }).catch(() => {});
  const geo = await page.evaluate(() => {
    const b = document.getElementById('modal-ok'); if (!b) return null;
    const r = b.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
  if (geo) await page.mouse.click(geo.cx, geo.cy);
  await sleep(900);
  // 第二层：内容摘要确认弹窗（普通弹窗，确定即 doImportGo）
  await page.waitForFunction(() => {
    const t = document.getElementById('modal-title');
    return !!(t && String(t.textContent).indexOf('确定导入数据') === 0);
  }, null, { timeout: 10000 }).catch(() => {});
  await page.evaluate(() => { const b = document.getElementById('modal-ok'); if (b) b.click(); });
  // 读结果面板（3.5s 后应用会自己刷新，先抢在刷新前把文案与存储状态一起取回）
  const got = await page.waitForFunction(() => {
    const t = document.getElementById('cc-ip-title'), s = document.getElementById('cc-ip-sub');
    const txt = ((t && t.textContent) || '') + '｜' + ((s && s.textContent) || '');
    return /导入完成|未能存入|写入失败/.test(txt) ? txt : false;
  }, null, { timeout: 25000 }).then((h) => h.jsonValue().catch(() => '')).catch(() => '');
  const after = await page.evaluate(([badK, goodK, oldVal, themeK]) => new Promise((res) => {
    let badLs = null, theme = null;
    try { badLs = localStorage.getItem(badK); theme = localStorage.getItem(themeK); } catch (e) {}
    Promise.resolve(window.idbHasKey(goodK)).then((g) => res({ badLs, theme, goodInIdb: g === true })).catch(() => res({ badLs, theme, goodInIdb: false }));
  }), [BAD_K, GOOD_K, OLD_BAD_VALUE, G + ':theme-mode']);
  const txt = String(got || '');
  ok(txt.indexOf('未能存入 IndexedDB') > -1, 'B1 进度面板说出「N 项未能存入 IndexedDB」（红＝当场报「已存入」的假成功）', txt.slice(0, 150) || 'no-panel' + ' chooser=' + chooser.file);
  ok(txt.indexOf('大文件 1 项') > -1 && txt.indexOf('大文件 2 项') === -1, 'B2 报功只数确认落成的键（红＝数发起次数＝大文件 2 项）', txt.slice(0, 150));
  ok(after.badLs === OLD_BAD_VALUE, 'B3 两头落空的键逐条还原导入前旧值（红＝旧值被清、新值没进＝两头空）', 'ls=' + String(after.badLs).slice(0, 20));
  ok(after.goodInIdb === true && after.theme === 'dark', 'B4 真落成的键照常计成功、小键照常恢复（两侧都该绿＝没改成一律报失败）', JSON.stringify(after));
  if (jsErrors.length) console.log('    （B 组环境噪声：页面异常 ' + jsErrors.length + ' 条，样例 ' + jsErrors[0] + '）');
  await ctx.close();
}

try { await browser.close(); } catch (e) {}
server.close();
console.log('\n结果: PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail > 0 ? 1 : 0);
