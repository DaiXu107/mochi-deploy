// ===== #786 专项回归：此间「顶部单个 tag」视图范围不越桌（不同联系人数据串了） =====
// 用户反馈（多机型同现，明说「不要覆盖修改导致不同型号设备浏览器的 bug 反复出现」）：
//   多个桌面联系人时，点此间顶部的单个联系人 tag 切过去，页面里的功能区块会出现别的联系人的名字。
// 两条根因（纯逻辑，与设备/内核无关）：
//   ① 详情「上一位/下一位」恒用 flatEntries()（全部桌面的梦角排一张表）→ 单 tag 视图里进详情
//      按「下一位」直接翻到别桌梦角，卡片名与「来自「X」的此间」都是别人的名字；
//   ② 本尊（自动播种）梦角名跟着本桌 TA 昵称链（lbl-partner→cs-lbl-partner→名片名），而昵称链
//      可能挂着**另一个联系人**的名字（联系人改过名时 renameContact 因 cur≠oldName 不同步、
//      聊天昵称被写成别的梦角名、跨桌面查岗 ensureTaName 兜过旧名）→ 卡片/今日轴显示别人的名字。
// 修复（cjian.js）：
//   #786a  详情翻页改用 scopeEntries()（跟随当前视图；「全部」总览照旧跨桌面；条目已出范围时退回全表不留死路）
//   #786b  effNick 加撞名闸门（取到的名字被别的桌面认作身份且本桌名片名不撞名 → 用名片名），
//          播种 seedIfEmpty 与自愈 healBelonging ① 共用这一条链；无撞名的常规场景零变化（#616/#409 口径原样）
// 用例：
//   V1 单 tag 列表只含本桌梦角        V2 单 tag 详情翻页只在本桌循环（含「全部」不退化为单桌的对照）
//   V3 「全部」总览详情翻页仍跨桌面   V4 单 tag 的今日轴 / 对方当前时间 / 感知结果不含别桌名字
//   N1 桌面昵称撞别桌身份名 → 本尊名退回本桌名片名（并写回 roster）
//   N2 仅聊天昵称撞名 → 同上          N3 不撞名时桌面昵称优先（#616 零变化）
//   N4 桌面昵称空、聊天昵称不撞名 → 用聊天昵称（#409 零变化）
//   N5 两桌名片名合法同名 → 不误改     N6 manual 梦角名撞别人名字 → 不搬不改（#409 手动保护）
//   Z  全程无未捕获异常
// 红对照：MOCHI_CJIAN_FILE=<HEAD 版 cjian.js> MOCHI_EXPECT=red node tools/verify-cjian-view-scope.mjs
//   ——旧代码详情翻页跨桌面 + 撞名昵称直接带跑本尊名，V2/V4/N1/N2 必红（断言按 red 语义翻转）。
// 自组装临时 index.html 运行时验证，不依赖也不触发 node build.mjs，多会话并行可安全跑。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x64)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x64)\\Microsoft\\Edge\\Application\\msedge.exe',
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
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => { try { return readFileSync(join(root, 'src/css', f), 'utf8'); } catch (e) { return ''; } }).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => '(function () { try {\n' + srcOf(f) + '\n} catch (__e) { try { console.error("[JS] " + f, __e && __e.message || __e); } catch (x) {} } })();').join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-cj-view-scope').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');

const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-cj-viewscope-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(tmpRoot, rel));
    if (!p.startsWith(tmpRoot)) { res.writeHead(403); res.end(); return; }
    if (!statSync(p).isFile()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9810 + Math.floor(Math.random() * 80));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-cj-viewscope-prof-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  throw new Error('无法连接 Chrome/Edge');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}
async function reload(ms) { await cdp('Page.navigate', { url: baseUrl + '/index.html' }); await sleep(ms || 5200); }

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}

// 页内夹具：三个桌面 default=应星 / B=景元 / C=符玄，每桌各有一枚 own 本尊 + 一枚 manual 独名梦角
const HELPERS = `
window.__T = {
  roster: function (cid) { try { var v = window.xyStore('xy-home-v2:' + cid).get('cjian-roster'); return v ? JSON.parse(v) : []; } catch (e) { return []; } },
  setRoster: function (cid, arr) { window.xyStore('xy-home-v2:' + cid).set('cjian-roster', JSON.stringify(arr)); window.xyStore('xy-home-v2:' + cid).set('cjian-seeded', '1'); },
  names: function (cid) { return window.__T.roster(cid).map(function (c) { return c.name; }); },
  chip: function (label) {
    var t = null;
    Array.prototype.forEach.call(document.querySelectorAll('#cj-groups .cj-gchip'), function (b) { if (b.textContent === label) t = b; });
    if (t) t.click();
    return !!t;
  },
  txt: function (sel) { return Array.prototype.map.call(document.querySelectorAll('#page-cjian ' + sel), function (e) { return e.textContent.replace(/\\s+/g, ' ').trim(); }); },
  // 详情「下一位」连点 n 次，回每站的名字 / 来源标签 / 位次
  walkNext: function (n) {
    var out = { visited: [], src: [], pos: [] };
    function snap() {
      var body = document.getElementById('cj-detail-body');
      var nm = body.querySelector('.cj-d-name'), sr = body.querySelector('.cj-d-src'), p = body.querySelector('.cj-d-nav-pos');
      out.visited.push(nm ? nm.textContent : '?');
      out.src.push(sr ? sr.textContent : '');
      out.pos.push(p ? p.textContent : '');
    }
    var first = document.querySelector('#cj-list .cj-card');
    if (!first) return out;
    first.click(); snap();
    for (var i = 0; i < n; i++) {
      var nxt = null;
      Array.prototype.forEach.call(document.querySelectorAll('#cj-detail-body .cj-d-nav-btn'), function (b) { if (b.textContent.indexOf('下一位') >= 0) nxt = b; });
      if (!nxt) break;
      nxt.click(); snap();
    }
    return out;
  }
};`;

// 每个场景清一次 origin：桌面名单/标记跨场景残留会让自愈逻辑把上一场景的梦角搬来搬去。
// 必须在 about:blank 上清——页面还开着时 IDB 正被占用，清完会被上一场景的快照回填，
// 注册表多出同名桌面（实测 N2 因此偶发红：撞名闸门按设计「宁不改」）。
async function boot(setupExpr) {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(500);
  try { await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'all' }); } catch (e) {}
  await sleep(800);
  await reload();
  await evalJs(HELPERS);
  const ids = await evalJs(`(function () {
    const R = 'xy-home-v2';
    window.renameContact('default', '应星');
    const B = window.createContact('景元'), C = window.createContact('符玄');
    window.xyStore(R + ':default').set('lbl-partner', '应星');
    window.xyStore(R + ':' + B).set('lbl-partner', '景元');
    window.xyStore(R + ':' + C).set('lbl-partner', '符玄');
    window.__T.setRoster('default', [
      { id: 'dOwnA', name: '应星', offsetMin: 0, cid: 'default', own: 1 },
      { id: 'dManA', name: '青枳', offsetMin: 0, cid: 'default', manual: 1 }
    ]);
    window.__T.setRoster(B, [
      { id: 'dOwnB', name: '景元', offsetMin: 0, cid: B, own: 1 },
      { id: 'dManB', name: '白蘅', offsetMin: 0, cid: B, manual: 1 }
    ]);
    window.__T.setRoster(C, [
      { id: 'dOwnC', name: '符玄', offsetMin: 0, cid: C, own: 1 },
      { id: 'dManC', name: '南星', offsetMin: 0, cid: C, manual: 1 }
    ]);
    ${setupExpr || ''}
    return { B: B, C: C };
  })()`);
  await reload();
  await evalJs(HELPERS);
  const reg = await evalJs(`(function(){var a=(window.getContacts()||[]);return {n:a.length,names:a.map(function(x){return x.name;}).join(',')};})()`);
  if (!reg || reg.n !== 3) throw new Error('夹具未隔离（注册表=' + JSON.stringify(reg) + '，应为 3 个桌面）');
  return ids || {};
}

try {
  await cdpConnect();
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  const jsErrors = [];
  const raw = ws.onmessage;
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') jsErrors.push(JSON.stringify(m.params).slice(0, 200)); if (raw) raw(ev); };

  // ================= V1~V5：常规三桌面，点顶部单个 tag =================
  {
    const { B } = await boot();
    const r = await evalJs(`(function () {
      const T = window.__T;
      window.setActiveContact('default');
      window.openCjian();
      const tapped = T.chip('景元');
      const onChip = Array.prototype.map.call(document.querySelectorAll('#cj-groups .cj-gchip'), function (b) { return b.textContent + (b.className.indexOf(' on') >= 0 ? '[on]' : ''); });
      const cards = T.txt('#cj-list .cj-card-name');
      const walk = T.walkNext(6);
      window.cjianCloseDetail();
      const today = T.txt('#cj-today .cj-today-row');
      const ta = T.txt('#cj-ta-time .cj-ta-time-item');
      try { window.cjianPerceive(); } catch (e) {}
      const perceive = T.txt('#cj-perceive-result .cj-p-line');
      // 再切「全部」总览：详情翻页应恢复跨桌面
      T.chip('全部');
      const walkAll = T.walkNext(6);
      return {
        tapped: tapped, onChip: onChip, cards: cards,
        walk: walk, walkAll: walkAll,
        today: today, ta: ta, perceive: perceive,
        rosterB: T.names('${B}')
      };
    })()`);
    console.log('V =', JSON.stringify(r));
    const foreign = ['应星', '符玄', '青枳', '南星'];
    const hasForeign = (arr) => (arr || []).some((line) => foreign.some((f) => String(line).indexOf(f) >= 0));
    ok('V0 顶部单个 tag 可点（景元）且高亮跟到该 tag', r && r.tapped && (r.onChip || []).some((c) => c === '景元[on]'), r && r.onChip);
    ok('V1 单 tag 列表只含本桌梦角', Array.isArray(r && r.cards) && r.cards.join(',') === '景元,白蘅', r && r.cards);
    if (EXPECT === 'red') {
      // 旧代码：详情翻页用全表 → 从景元桌第一张卡按下一位会走到白蘅→符玄→南星→应星→青枳→景元
      ok('RED V2 旧代码单 tag 详情翻页越出本桌（出现别桌梦角）', hasForeign((r.walk || {}).visited), r && r.walk);
    } else {
      ok('V2 单 tag 详情翻页只在本桌 2 位之间循环', Array.isArray(r.walk.visited) && r.walk.visited.length === 7 && r.walk.visited.every((n) => n === '景元' || n === '白蘅') && !hasForeign(r.walk.visited), r.walk);
      ok('V2b 位次分母＝本桌人数 2', (r.walk.pos || []).every((p) => String(p).endsWith('/2')), r.walk.pos);
      ok('V2c 来源标签恒为本桌（来自「景元」的此间）', (r.walk.src || []).every((s) => s === '来自「景元」的此间'), r.walk.src);
      ok('V3 「全部」总览详情翻页仍跨桌面（6 位全见）', (r.walkAll.visited || []).length === 7 && new Set(r.walkAll.visited).size === 6, r.walkAll);
      ok('V4a 单 tag 今日轴不含别桌名字', !(r.today || []).some((l) => foreign.some((f) => l.indexOf(f) >= 0)), r.today && r.today[0]);
      ok('V4b 单 tag「对方当前时间」只有本桌一行', (r.ta || []).length === 1 && (r.ta || []).join('').indexOf('景元') >= 0 && !hasForeign(r.ta), r.ta);
      ok('V4c 单 tag 感知结果只报本桌梦角', !(r.perceive || []).some((l) => foreign.some((f) => l.indexOf(f) >= 0)), r.perceive);
      ok('V5 本桌名单未被视图切换改动', (r.rosterB || []).join(',') === '景元,白蘅', r.rosterB);
    }
  }

  // ================= N1：桌面 TA 昵称挂着别桌身份名（lbl-partner 串名） =================
  {
    const { B } = await boot(`
      window.xyStore('xy-home-v2:' + B).set('lbl-partner', '应星');
      window.__T.setRoster(B, [
        { id: 'dOwnB', name: '应星', offsetMin: 0, cid: B, own: 1 },
        { id: 'dManB', name: '白蘅', offsetMin: 0, cid: B, manual: 1 }
      ]);`);
    const r = await evalJs(`(function () {
      const T = window.__T;
      window.setActiveContact('default');
      window.openCjian();
      T.chip('景元');
      return { cards: T.txt('#cj-list .cj-card-name'), today: T.txt('#cj-today .cj-today-row'), rosterB: T.names('${B}') };
    })()`);
    console.log('N1 =', JSON.stringify(r));
    if (EXPECT === 'red') {
      ok('RED N1 旧代码：昵称串名直接把别桌名字带进本桌卡片', (r.cards || []).some((c) => c === '应星'), r.cards);
    } else {
      ok('N1 桌面昵称撞别桌身份名 → 本尊名退回本桌名片名', (r.cards || []).join(',') === '景元,白蘅' && !(r.today || []).some((l) => l.indexOf('应星') >= 0), r);
      ok('N1b 纠偏写回 roster（不是每次渲染临时改名）', (r.rosterB || []).join(',') === '景元,白蘅', r.rosterB);
    }
  }

  // ================= N2：只有聊天昵称撞名（lbl-partner 已清空） =================
  {
    const { B } = await boot(`
      window.xyStore('xy-home-v2:' + B).remove('lbl-partner');
      window.xyStore('xy-home-v2:' + B).set('cs-lbl-partner', '应星');
      window.__T.setRoster(B, [
        { id: 'dOwnB', name: '应星', offsetMin: 0, cid: B, own: 1 },
        { id: 'dManB', name: '白蘅', offsetMin: 0, cid: B, manual: 1 }
      ]);`);
    const r = await evalJs(`(function () {
      const T = window.__T;
      window.setActiveContact('default'); window.openCjian(); T.chip('景元');
      return { cards: T.txt('#cj-list .cj-card-name'), rosterB: T.names('${B}') };
    })()`);
    console.log('N2 =', JSON.stringify(r));
    if (EXPECT === 'red') {
      ok('RED N2 旧代码：聊天昵称把别桌名字带进此间', (r.cards || []).some((c) => c === '应星'), r.cards);
    } else {
      ok('N2 仅聊天昵称撞名 → 本尊名退回本桌名片名', (r.cards || []).join(',') === '景元,白蘅' && (r.rosterB || []).join(',') === '景元,白蘅', r);
    }
  }

  // ================= N3/N4：不撞名时昵称优先（#616 / #409 零变化） =================
  {
    const { B } = await boot(`
      window.xyStore('xy-home-v2:' + B).set('lbl-partner', '宝宝');
      window.__T.setRoster(B, [{ id: 'dOwnB', name: '宝宝', offsetMin: 0, cid: B, own: 1 }]);`);
    const r = await evalJs(`(function () {
      const T = window.__T;
      window.setActiveContact('default'); window.openCjian(); T.chip('景元');
      return { cards: T.txt('#cj-list .cj-card-name'), rosterB: T.names('${B}') };
    })()`);
    console.log('N3 =', JSON.stringify(r));
    ok('N3 不撞名时桌面 TA 昵称优先（#616 取值顺序零变化）', (r.cards || []).join(',') === '宝宝', r.cards);

    const { B: B2 } = await boot(`
      window.xyStore('xy-home-v2:' + B).remove('lbl-partner');
      window.xyStore('xy-home-v2:' + B).set('cs-lbl-partner', '亲爱的');
      window.__T.setRoster(B, [{ id: 'dOwnB', name: '亲爱的', offsetMin: 0, cid: B, own: 1 }]);`);
    const r2 = await evalJs(`(function () {
      const T = window.__T;
      window.setActiveContact('default'); window.openCjian(); T.chip('景元');
      return { cards: T.txt('#cj-list .cj-card-name') };
    })()`);
    console.log('N4 =', JSON.stringify(r2));
    ok('N4 桌面昵称空、聊天昵称不撞名 → 仍用聊天昵称（#409 兜底零变化）', (r2.cards || []).join(',') === '亲爱的', r2.cards);
    void B2;
  }

  // ================= N5：两桌名片名合法同名 → 不误改 =================
  {
    const { B } = await boot(`
      window.renameContact('default', '小花');
      window.renameContact(B, '小花');
      window.xyStore('xy-home-v2:default').set('lbl-partner', '小花');
      window.xyStore('xy-home-v2:' + B).set('lbl-partner', '小花');`);
    const r = await evalJs(`(function () {
      const T = window.__T;
      window.setActiveContact('default'); window.openCjian(); T.chip('小花');
      return { chips: Array.prototype.map.call(document.querySelectorAll('#cj-groups .cj-gchip'), function (b) { return b.textContent; }), rosterB: T.names('${B}') };
    })()`);
    console.log('N5 =', JSON.stringify(r));
    ok('N5 合法同名（两桌名片名相同）不误改本尊名', (r.rosterB || []).join(',') === '小花,白蘅', r);
  }

  // ================= N6：manual 梦角名撞别人名字 → 不搬不改 =================
  {
    const { B } = await boot(`
      window.__T.setRoster(B, [
        { id: 'dOwnB', name: '景元', offsetMin: 0, cid: B, own: 1 },
        { id: 'dManX', name: '应星', offsetMin: 0, cid: B, manual: 1 }
      ]);`);
    const r = await evalJs(`(function () {
      const T = window.__T;
      const n0 = T.names('${B}').join(',');
      if (window.cjianHealBelonging) window.cjianHealBelonging();
      window.setActiveContact('default'); window.openCjian(); T.chip('景元');
      return { before: n0, after: T.names('${B}'), cards: T.txt('#cj-list .cj-card-name'), rosterA: T.names('default') };
    })()`);
    console.log('N6 =', JSON.stringify(r));
    ok('N6 手动添加/改名的梦角即便撞别桌名字也不搬不改（#409 手动保护）', (r.after || []).join(',') === '景元,应星' && (r.cards || []).join(',') === '景元,应星' && (r.rosterA || []).join(',') === '应星,青枳', r);
  }

  ok('Z 全程无未捕获 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 4));
  console.log('\n===== #786 此间单 tag 视图范围：' + pass + ' 通过 / ' + fail + ' 失败（期望 ' + EXPECT + '）=====');
  process.exitCode = fail ? 1 : 0;
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  setTimeout(() => { try { rmSync(tmpRoot, { recursive: true, force: true }); rmSync(join(process.env.TEMP || '/tmp', 'mochi-cj-viewscope-prof-latest'), { recursive: true, force: true }); } catch (e) {} }, 300);
}
