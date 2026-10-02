// ===== #409 专项回归：此间多联系人「名字串桌」根治（v3.33.x） =====
// 覆盖：
//   T1 撞名绑架根治：梦角名与别的联系人 TA 身份撞名时，标记（cjian-belong-v2）已落盘则
//      绝不每次启动搬桌（修前红：旧逻辑按名认亲每次启动把梦角强行搬去撞名桌面）
//   T2 一次性救回：标记清掉后首次跑仍按名认亲救存量错放（无 cid 旧数据），随后 cid 权威
//      不再反复搬；标记自动落盘（幂等，只在注册表就绪的成功路径落）
//   T3 联系人改名跟随：renameContact 后该桌面与旧名同名的梦角跟随新名（lbl-partner 同步）
//   T4 播种昵称链：cs-lbl-partner（聊天昵称）优先，梦角名与聊天里看到的名字一致
//   Z  全程无未捕获异常
// 红对照：MOCHI_CJIAN_FILE=<旧版 cjian.js 路径> MOCHI_EXPECT=red node tools/verify-cjian-belong.mjs
//   ——旧代码下 T1 应表现为「被绑架到撞名桌面」（断言按 red 语义翻转）。
// 自组装临时 index.html 运行时验证，不依赖也不触发 node build.mjs，多会话并行可安全跑。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECT = process.env.MOCHI_EXPECT || 'green'; // green=新代码应绿 / red=旧代码复现绑架
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
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => '(function () { try {\n' + srcOf(f) + '\n} catch (__e) { try { console.error("[JS] " + f, __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();').join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-test-build').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-cj-belong-' + Date.now());
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-cj-belong-prof-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
async function reload(ms) { await cdp('Page.navigate', { url: baseUrl + '/index.html' }); await sleep(ms || 4500); }

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}

try {
  await cdpConnect();
  const jsErrors = [];
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  const rawHandler = ws.onmessage;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(JSON.stringify(m.params).slice(0, 200));
    if (rawHandler) rawHandler(ev);
  };

  await reload();
  const cta = await evalJs(`(function () {
    const R = 'xy-home-v2';
    window.renameContact('default', '宝宝'); // 注册表名 + default 桌面 lbl-partner 同步为 宝宝
    const cta = window.createContact('小星');
    window.xyStore(R + ':cta').set('lbl-partner', '小星');
    // 模拟「改名漂移」（旧版本/桌面昵称编辑路径，不走 renameContact 事件）：default TA 改叫
    // 宝贝、新联系人 cta 认领旧名 宝宝——本桌梦角 dK（自动播种名 宝宝，cid=default）从此撞名
    const reg = JSON.parse(window.xyStore(R).get('contacts'));
    reg.find(function (x) { return x.id === 'default'; }).name = '宝贝';
    reg.find(function (x) { return x.id === cta; }).name = '宝宝';
    window.xyStore(R).set('contacts', JSON.stringify(reg));
    window.xyStore(R + ':default').set('lbl-partner', '宝贝');
    window.xyStore(R + ':' + cta).set('lbl-partner', '宝宝');
    window.xyStore(R + ':default').set('cjian-roster', JSON.stringify([{ id: 'dK', name: '宝宝', offsetMin: 0, cid: 'default' }]));
    window.xyStore(R + ':default').set('cjian-seeded', '1');
    window.xyStore(R + ':' + cta).set('cjian-seeded', '1');
    window.xyStore(R).set('cjian-belong-v2', '1'); // T1：标记已落盘（正常在用设备的状态）
    return cta;
  })()`);
  ok('预置：双联系人注册表 + 撞名梦角 dK 就位', !!cta, cta);
  await reload();

  console.log('\n== T1 撞名绑架根治（标记已落盘 → cid 权威不搬桌） ==');
  const t1 = await evalJs(`(function () {
    const cta = ${JSON.stringify(cta)};
    const rd = JSON.parse(localStorage.getItem('xy-home-v2:default:cjian-roster') || '[]');
    const rc = JSON.parse(localStorage.getItem('xy-home-v2:' + cta + ':cjian-roster') || '[]');
    return {
      inDefault: rd.some(function (x) { return x.id === 'dK'; }),
      inCta: rc.some(function (x) { return x.id === 'dK'; }),
      dKCid: (rd.find(function (x) { return x.id === 'dK'; }) || rc.find(function (x) { return x.id === 'dK'; }) || {}).cid
    };
  })()`);
  if (EXPECT === 'red') {
    ok('【修前红】旧逻辑把撞名梦角绑架到 cta 桌面（复现串桌）', t1 && t1.inCta && !t1.inDefault, t1);
  } else {
    ok('撞名梦角 dK 留在原桌面 default（不再每次启动被搬走）', t1 && t1.inDefault && !t1.inCta, t1);
    ok('dK 的 cid 归属保持 default', t1 && t1.dKCid === 'default', t1);
  }
  if (EXPECT === 'red') {
    console.log('\n（red 对照模式：仅验证 T1 复现，跳过其余断言）');
  } else {
    console.log('\n== T2 一次性救回（标记清掉 → 按名认亲救存量 + 标记自动落盘） ==');
    await evalJs(`(function () {
      const R = 'xy-home-v2';
      // 先把 dK 名字对齐本桌身份（模拟用户已手动理顺），避免救回轮次干扰
      const rd = JSON.parse(window.xyStore(R + ':default').get('cjian-roster'));
      rd.forEach(function (x) { if (x.id === 'dK') x.name = '宝贝'; });
      window.xyStore(R + ':default').set('cjian-roster', JSON.stringify(rd));
      window.xyStore(R).remove('cjian-belong-v2'); // 清标记：模拟存量待救设备首次升级
      window.xyStore(R + ':' + ${JSON.stringify(cta)}).set('lbl-partner', '小星'); // cta 的 TA 身份指向 小星（dL2 的名字）
      // 注入无 cid 的存量错放梦角：名叫 小星（cta 的 TA 身份），物理躺在 default
      const rd2 = JSON.parse(window.xyStore(R + ':default').get('cjian-roster'));
      rd2.push({ id: 'dL2', name: '小星', offsetMin: 0 });
      window.xyStore(R + ':default').set('cjian-roster', JSON.stringify(rd2));
      return true;
    })()`);
    await reload();
    const t2 = await evalJs(`(function () {
      const cta = ${JSON.stringify(cta)};
      const rd = JSON.parse(localStorage.getItem('xy-home-v2:default:cjian-roster') || '[]');
      const rc = JSON.parse(localStorage.getItem('xy-home-v2:' + cta + ':cjian-roster') || '[]');
      const l2 = rc.find(function (x) { return x.id === 'dL2'; }) || rd.find(function (x) { return x.id === 'dL2'; }) || {};
      return {
        l2InCta: rc.some(function (x) { return x.id === 'dL2'; }),
        l2Cid: l2.cid, mark: localStorage.getItem('xy-home-v2:cjian-belong-v2'),
        rootGone: !localStorage.getItem('xy-home-v2:cjian-rehome-v1') || true
      };
    })()`);
    ok('无 cid 存量梦角 dL2 按名认亲救回到 cta 桌面', t2 && t2.l2InCta, t2);
    ok('救回同时补上显式 cid=' + cta, t2 && t2.l2Cid === cta, t2);
    ok('救回标记 cjian-belong-v2 已自动落盘（此后 cid 权威）', t2 && t2.mark === '1', t2);
    await reload();
    const t2b = await evalJs(`(function () {
      const cta = ${JSON.stringify(cta)};
      const rc = JSON.parse(localStorage.getItem('xy-home-v2:' + cta + ':cjian-roster') || '[]');
      const rd = JSON.parse(localStorage.getItem('xy-home-v2:default:cjian-roster') || '[]');
      return { dup: rc.filter(function (x) { return x.id === 'dL2'; }).length, backInDefault: rd.some(function (x) { return x.id === 'dL2'; }), dKStable: rd.some(function (x) { return x.id === 'dK'; }) };
    })()`);
    ok('再加载：dL2 无重复、不回搬（救回幂等且稳定）', t2b && t2b.dup === 1 && !t2b.backInDefault, t2b);
    ok('cid 权威：dK（名字已对齐）继续留在 default', t2b && t2b.dKStable, t2b);

    console.log('\n== T3 联系人改名跟随（renameContact → 同名梦角跟随新名） ==');
    await evalJs(`(function () {
      const R = 'xy-home-v2';
      const c3 = window.createContact('阿澈');
      window.xyStore(R + ':' + c3).set('lbl-partner', '阿澈');
      window.xyStore(R + ':' + c3).set('cjian-roster', JSON.stringify([{ id: 'dF', name: '阿澈', offsetMin: 0, cid: c3 }]));
      window.xyStore(R + ':' + c3).set('cjian-seeded', '1');
      window.renameContact(c3, '小澈'); // 注册表改名 + lbl-partner 同步 + 派发 contact-renamed
      return c3;
    })()`);
    await sleep(300);
    const t3 = await evalJs(`(function () {
      const c3 = (window.getContacts() || []).find(function (x) { return x.name === '小澈'; });
      if (!c3) return { found: false };
      const rc = JSON.parse(window.xyStore('xy-home-v2:' + c3.id).get('cjian-roster') || '[]');
      return { found: true, lbl: window.xyStore('xy-home-v2:' + c3.id).get('lbl-partner'), dF: (rc.find(function (x) { return x.id === 'dF'; }) || {}).name };
    })()`);
    ok('梦角 dF 跟随改名为「小澈」', t3 && t3.dF === '小澈', t3);
    ok('该桌面 lbl-partner 同步为新名（名字与身份保持同步）', t3 && t3.lbl === '小澈', t3);

    console.log('\n== T4 播种昵称链（cs-lbl-partner 优先 → 梦角名与聊天一致） ==');
    const seededName = await evalJs(`(function () {
      const R = 'xy-home-v2';
      const c4 = window.createContact('路人甲');
      window.xyStore(R + ':' + c4).set('cs-lbl-partner', '泽泽'); // 聊天设置昵称（聊天顶栏显示名）
      window.xyStore(R + ':' + c4).remove('lbl-partner'); // 桌面昵称未设 → 旧链会退回注册名「路人甲」
      window.setActiveContact(c4);
      window.openCjian();
      const rc = JSON.parse(window.xyStore(R + ':' + c4).get('cjian-roster') || '[]');
      window.closeCjian();
      window.setActiveContact('default');
      return rc.length ? rc[0].name : '';
    })()`);
    ok('首次打开此间播种的梦角名叫「泽泽」（聊天昵称），不再叫注册名「路人甲」', seededName === '泽泽', seededName);
  }

  console.log('\n== Z 全程无未捕获异常 ==');
  ok('无 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3));

  console.log('\n结果: ' + pass + ' 过 / ' + fail + ' 败' + (EXPECT === 'red' ? '（red 对照）' : ''));
  chrome.kill();
  server.close();
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.error('验证失败:', e && e.message || e);
  try { chrome.kill(); } catch (x) {}
  try { server.close(); } catch (x) {}
  process.exit(2);
}
