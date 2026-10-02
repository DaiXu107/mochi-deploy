// ===== #514 专项回归：此间梦角归属自愈（多桌面「名字串桌」存量救济） =====
// 覆盖：
//   H1 错放自愈：桌面 B 名单里挂着桌面 A 的梦角（早期版本按名认亲/「认不到家归当前桌面」
//      把错误归属固化进 cid 字段）→ 打开此间自动搬回 A
//   H2 搬空后重新播种：H1 之后 B 桌面用「自己的名字」种下本尊（不再显示 A 的名字）
//   H3 目标已有本尊不搬（防重复）
//   H4 手动添加/改名的梦角（manual 标记）永不自动搬（#409 担心的「手动改名被反复绑架」）
//   H5 本尊名字漂移对齐：带 own 标记（自动播种）的梦角名字恒等于本桌有效昵称
//   H6 撞名不搬：两个桌面身份都含该名字（hits=2）→ 宁不搬不错搬
//   H7 单桌面不受影响
//   Z  全程无未捕获异常
// 红对照：MOCHI_CJIAN_FILE=<旧版 cjian.js 路径> MOCHI_EXPECT=red node tools/verify-cjian-heal.mjs
//   ——旧代码无 window.cjianHealBelonging，H1/H2 必红（断言按 red 语义翻转）。
// 自组装临时 index.html 运行时验证，不依赖也不触发 node build.mjs，多会话并行可安全跑。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'period.js', 'accounting.js', 'garden.js', 'decision.js', 'pong.js', 'snake-game.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'mobile-adapt.js'];
function srcOf(f) {
  if (f === 'cjian.js' && process.env.MOCHI_CJIAN_FILE) return readFileSync(process.env.MOCHI_CJIAN_FILE, 'utf8');
  return readFileSync(join(root, 'src/js', f), 'utf8');
}
let testHtml;
if (process.env.MOCHI_INDEX_FILE) {
  // 产物模式：直接验已构建的 index.html（BUGS.md「产物必须同步」的收口校验用）
  testHtml = readFileSync(process.env.MOCHI_INDEX_FILE, 'utf8');
} else {
  testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
  testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
  testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => '(function () { try {\n' + srcOf(f) + '\n} catch (__e) { try { console.error("[JS] " + f, __e && __e.message || __e); } catch (x) {} } })();').join('\n'));
  testHtml = testHtml.split('__BUILD_INFO__').join('verify-test-build').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
}
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-cj-heal-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(tmpRoot, rel));
    if (!p.startsWith(tmpRoot)) { res.writeHead(403); res.end(); return; }
    let hit = false;
    try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) {
      p = normalize(join(root, rel));
      if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
      try { hit = statSync(p).isFile(); } catch (e) {}
    }
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-cj-heal-prof-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}
async function reload(ms) { await cdp('Page.navigate', { url: baseUrl + '/index.html' }); await sleep(ms || 4600); }

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}

// 共用页内小工具（注入到页面，供场景复用）
const HELPERS = `
window.__T = {
  R: 'xy-home-v2',
  roster: function (cid) {
    try { var v = window.xyStore('xy-home-v2:' + cid).get('cjian-roster'); return v ? JSON.parse(v) : []; } catch (e) { return []; }
  },
  setRoster: function (cid, arr) { window.xyStore('xy-home-v2:' + cid).set('cjian-roster', JSON.stringify(arr)); },
  names: function (cid) { return window.__T.roster(cid).map(function (c) { return c.name; }); },
  seeded: function (cid) { return window.xyStore('xy-home-v2:' + cid).get('cjian-seeded'); }
};`;

try {
  await cdpConnect();
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  const jsErrors = [];
  const rawHandler = ws.onmessage;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(JSON.stringify(m.params).slice(0, 200));
    if (rawHandler) rawHandler(ev);
  };

  // ---- 基础环境：default 桌面改名「应星」，新建「景元」桌面 ----
  // 每个场景前清空该 origin 的全部存储（localStorage + IndexedDB），避免上一场景残留的
  // 桌面名单被本场景的自愈逻辑搬来搬去（首版曾因此把 H3 残留的应星梦角搬进 H4 的应星桌面）。
  async function boot2() {
    try { await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'all' }); } catch (e) {}
    await reload();
    await evalJs(HELPERS);
    const ids = await evalJs(`(function () {
      const R = 'xy-home-v2';
      window.renameContact('default', '应星');
      const gid = window.createContact('景元');
      window.xyStore(R + ':default').set('lbl-partner', '应星');
      window.xyStore(R + ':' + gid).set('lbl-partner', '景元');
      return { gid: gid };
    })()`);
    return ids || {};
  }

  // ================= H1/H2 错放自愈 + 搬空后重新播种 =================
  {
    const { gid } = await boot2();
    const r = await evalJs(`(function () {
      const T = window.__T, R = 'xy-home-v2';
      // 应星桌面：本尊被早期版本搬走了（空）
      T.setRoster('default', []);
      window.xyStore(R + ':default').set('cjian-seeded', '1');
      // 景元桌面：挂着应星的梦角，且 cid 被固化在景元（错放）
      T.setRoster('${gid}', [{ id: 'dX', name: '应星', offsetMin: 0, cid: '${gid}' }]);
      window.xyStore(R + ':${gid}').set('cjian-seeded', '1');
      window.setActiveContact('${gid}');
      window.openCjian();                       // 打开此间（内部先 healBelonging 再 seedIfEmpty）
      return {
        healed: typeof window.cjianHealBelonging === 'function',
        inYing: T.roster('default').map(function (c) { return c.name + '|' + c.id + '|' + c.cid; }),
        inJing: T.roster('${gid}').map(function (c) { return c.name + '|' + c.id + '|' + c.cid; }),
        cardNames: Array.prototype.map.call(document.querySelectorAll('#cj-list .cj-card-name'), function (e) { return e.textContent; }),
        chips: Array.prototype.map.call(document.querySelectorAll('#cj-groups .cj-gchip'), function (e) { return e.textContent + (e.className.indexOf(' on') >= 0 ? '[on]' : ''); })
      };
    })()`);
    console.log('H1/H2 =', JSON.stringify(r));
    const inYing = (r && r.inYing) || [];
    const inJing = (r && r.inJing) || [];
    if (EXPECT === 'red') {
      // 旧代码：无自愈能力 → 应星仍挂在景元桌面，应星桌面仍空
      ok('RED H1 旧代码不自愈（应星仍错放在景元桌面）', inJing.some((s) => s.indexOf('应星|') === 0) && !inYing.some((s) => s.indexOf('应星|') === 0), r);
    } else {
      ok('H1 错放梦角已搬回「应星」桌面', inYing.some((s) => s.indexOf('应星|') === 0), r);
      ok('H1 cid 字段随搬移同步（权威归属与物理位置一致）', inYing.some((s) => s.indexOf('|default') > 0), r);
      ok('H1 景元桌面不再挂着应星的梦角', !inJing.some((s) => s.indexOf('应星|') === 0), r);
      ok('H2 景元桌面本尊重新播种（自己的名字）', inJing.some((s) => s.indexOf('景元|') === 0), r);
      ok('H2 卡片左侧名字与分组一致', Array.isArray(r && r.cardNames) && r.cardNames.join(',') === '景元', r && r.cardNames);
      ok('H2 分组高亮在景元（「全部」居首，#615）', Array.isArray(r && r.chips) && r.chips.join(',') === '全部,应星,景元[on]', r && r.chips);
    }
  }

  // ================= H3 目标已有本尊 → 不搬（防重复） =================
  if (EXPECT !== 'red') { // H3~H7 依赖修复后的产品函数 window.cjianHealBelonging；RED 对照只验 H1/H2
  {
    const { gid } = await boot2();
    const r = await evalJs(`(function () {
      const T = window.__T, R = 'xy-home-v2';
      // 应星桌面已有本尊「应星」；景元桌面另有一个同名的错位副本
      T.setRoster('default', [{ id: 'dY', name: '应星', offsetMin: 0, cid: 'default', own: 1 }]);
      T.setRoster('${gid}', [{ id: 'dX', name: '应星', offsetMin: 0, cid: '${gid}' }]);
      window.xyStore(R + ':default').set('cjian-seeded', '1');
      window.xyStore(R + ':${gid}').set('cjian-seeded', '1');
      const before = T.names('${gid}').join(',');
      window.cjianHealBelonging();
      return { before: before, inJing: T.names('${gid}'), inYing: T.names('default'), cntYing: T.roster('default').length };
    })()`);
    console.log('H3 =', JSON.stringify(r));
    ok('H3 目标已有本尊时不搬（不制造重复）', (r && r.inJing.join(',')) === '应星' && (r && r.cntYing) === 1, r);
  }

  // ================= H4 manual 标记的梦角不搬 =================
  {
    const { gid } = await boot2();
    const r = await evalJs(`(function () {
      const T = window.__T, R = 'xy-home-v2';
      T.setRoster('default', []);
      T.setRoster('${gid}', [{ id: 'dM', name: '应星', offsetMin: 0, cid: '${gid}', manual: 1 }]);
      window.xyStore(R + ':default').set('cjian-seeded', '1');
      window.xyStore(R + ':${gid}').set('cjian-seeded', '1');
      window.cjianHealBelonging();
      return { inJing: T.names('${gid}'), inYing: T.names('default') };
    })()`);
    console.log('H4 =', JSON.stringify(r));
    ok('H4 用户手动添加/改名的梦角永不自动搬', (r && r.inJing.join(',')) === '应星' && (r && r.inYing.length) === 0, r);
  }

  // ================= H5 本尊名字漂移对齐（own 标记） =================
  {
    const { gid } = await boot2();
    const r = await evalJs(`(function () {
      const T = window.__T, R = 'xy-home-v2';
      // 应星桌面本尊名字停在旧昵称「小旧」，桌面昵称已改成「应星」
      T.setRoster('default', [{ id: 'dS', name: '小旧', offsetMin: 0, cid: 'default', own: 1 }]);
      window.xyStore(R + ':default').set('cs-lbl-partner', '');
      T.setRoster('${gid}', []);
      window.xyStore(R + ':${gid}').set('cjian-seeded', '1');
      window.cjianHealBelonging();
      return { inYing: T.names('default'), inJing: T.names('${gid}') };
    })()`);
    console.log('H5 =', JSON.stringify(r));
    ok('H5 自动播种的本尊名字跟随本桌有效昵称', (r && r.inYing.join(',')) === '应星', r);
  }

  // ================= H6 撞名不搬（hits=2） =================
  {
    const r0 = await boot2();
    const gid = r0.gid;
    const r = await evalJs(`(function () {
      const R = 'xy-home-v2';
      const gid2 = window.createContact('应星');           // 第二个也叫「应星」的桌面 → 撞名
      window.xyStore(R + ':' + gid2).set('lbl-partner', '应星');
      const T = window.__T;
      T.setRoster('${gid}', [{ id: 'dZ', name: '应星', offsetMin: 0, cid: '${gid}' }]);
      T.setRoster(gid2, []);
      window.xyStore(R + ':${gid}').set('cjian-seeded', '1');
      window.cjianHealBelonging();
      return { inJing: T.names('${gid}'), gid2: T.names(gid2) };
    })()`);
    console.log('H6 =', JSON.stringify(r));
    ok('H6 撞名（两个桌面同身份）宁不搬不错搬', (r && r.inJing.join(',')) === '应星' && (r && r.gid2.length) === 0, r);
  }

  // ================= H7 单桌面不受影响 =================
  {
    try { await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'all' }); } catch (e) {}
    await reload();
    await evalJs(HELPERS);
    const r = await evalJs(`(function () {
      const R = 'xy-home-v2';
      window.renameContact('default', '应星');
      window.xyStore(R + ':default').set('lbl-partner', '应星');
      const T = window.__T;
      T.setRoster('default', [{ id: 'd1', name: '应星', offsetMin: 0, cid: 'default', own: 1 }]);
      window.xyStore(R + ':default').set('cjian-seeded', '1');
      window.cjianHealBelonging();
      return { n: T.roster('default').length, names: T.names('default'), cid: (T.roster('default')[0] || {}).cid };
    })()`);
    console.log('H7 =', JSON.stringify(r));
    ok('H7 单桌面名单零改动', (r && r.n) === 1 && (r && r.names.join(',')) === '应星' && (r && r.cid) === 'default', r);
  }
  }

  // ================= Z 零异常 =================
  ok('Z 全程无未捕获异常', jsErrors.length === 0, jsErrors.slice(0, 3));

  console.log('\n' + (EXPECT === 'red' ? '[RED 对照] ' : '') + '通过 ' + pass + ' / 失败 ' + fail);
  chrome.kill(); server.close();
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.error('ERR', e && e.message);
  try { chrome.kill(); } catch (x) {}
  try { server.close(); } catch (x) {}
  process.exit(1);
}
