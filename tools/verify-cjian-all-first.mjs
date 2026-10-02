// ===== 专项验证 #615：此间分组条「全部」总览固定排在第一位 =====
// 用户原话：「此间的【全部】应该放在第一个，目前是放在末尾，不好查看啊」。
// 根因：src/js/cjian.js 的 renderGroupBar() 先渲染各桌面 chips、最后才 chip('全部', ALL)；
//   桌面一多，「全部」被推到横向滚动条最右端，要横滑到底才点得到。
// 修复（一行次序调整）：chip('全部', ALL) 挪到 contacts().forEach(...) 之前。
// 用例组：
//   A 结构（单桌面/多桌面：chips[0] 恒为「全部」且是首个 .cj-gchip 节点）
//   B 几何（「全部」最靠左，符合「一眼就能看到」的诉求，非仅 DOM 顺序）
//   C 行为（点「全部」进总览高亮在它身上；再点桌面 chip 能切回，功能零损失）
//   D 回归（无 JS 未捕获异常）
// RED 基线：MOCHI_CJIAN_ALL_LAST=1 时把源里的两行换回旧次序再组装 —— 修复前产物应红。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const RED = process.env.MOCHI_CJIAN_ALL_LAST === '1';
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
let cssFiles = [], jsFiles = [];
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  cssFiles = (bm.match(/const cssFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  jsFiles = (bm.match(/const jsFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}
const NEW_ORDER = "chip('全部', ALL);\n    contacts().forEach(ct => chip(contactName(ct.id), ct.id));";
const OLD_ORDER = "contacts().forEach(ct => chip(contactName(ct.id), ct.id));\n    chip('全部', ALL);";
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => {
  let src = readFileSync(join(root, 'src/js', f), 'utf8');
  if (RED && f === 'cjian.js') {
    if (!src.includes(NEW_ORDER)) { console.error('RED 基线无法构造：src/js/cjian.js 里找不到修复后的两行'); process.exit(1); }
    src = src.replace(NEW_ORDER, OLD_ORDER); // 还原成修复前的「全部在末尾」
  }
  return '(function () { try {\n' + src + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
}).join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-cjian-all-first').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-cjian-allfirst-' + Date.now());
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-cjian-allfirst-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}
async function navigate(url) { await cdp('Page.navigate', { url }); await sleep(4200); }
async function scenario(seedExpr) {
  await evalJs("(function(){ try { indexedDB.deleteDatabase('mochi-db'); } catch (e) {};\n" + seedExpr + ";\n})()");
  await navigate(baseUrl + '/index.html');
}
// chips 观察器：同时取文案顺序与「全部」的几何位置（左边界、相对其它 chip 的位置）
const CHIPS = `(function () {
  const b = document.getElementById('cj-groups');
  if (!b) return { n: 0, labels: [] };
  const cs = Array.prototype.slice.call(b.querySelectorAll('.cj-gchip'));
  return {
    n: cs.length,
    labels: cs.map(function (x) { return x.textContent; }),
    on: (b.querySelector('.cj-gchip.on') || {}).textContent || '',
    firstChildText: cs.length ? cs[0].textContent : '',
    lefts: cs.map(function (x) { return Math.round(x.getBoundingClientRect().left); }),
    barLeft: Math.round(b.getBoundingClientRect().left)
  };
})()`;
const openCjian = `(function () {
  if (window.openCjian) { window.openCjian(); return true; }
  const a = document.querySelector('.app[data-app="cjian"]'); if (a) a.click();
  return true;
})()`;
async function clickChip(label) {
  return evalJs(`(function () {
    const cs = document.querySelectorAll('#cj-groups .cj-gchip');
    for (let i = 0; i < cs.length; i++) if (cs[i].textContent === ${JSON.stringify(label)}) { cs[i].click(); return true; }
    return false;
  })()`);
}

const ONE = `(function () {
  localStorage.clear();
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{ id: 'default', name: '宝贝' }]));
  localStorage.setItem('xy-home-v2:default:lbl-partner', '宝贝');
  localStorage.setItem('xy-home-v2:active-contact', 'default');
  return true;
})()`;
const TWO = `(function () {
  localStorage.clear();
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify([
    { id: 'default', name: '宝贝' },
    { id: 'cta', name: '小桃' }
  ]));
  localStorage.setItem('xy-home-v2:default:lbl-partner', '宝贝');
  localStorage.setItem('xy-home-v2:cta:lbl-partner', '小桃');
  localStorage.setItem('xy-home-v2:active-contact', 'cta');
  return true;
})()`;
// 五桌面：旧实现下「全部」被推到末尾，横滑才可见——正是用户报障的场景
const MANY = `(function () {
  localStorage.clear();
  const cs = [{ id: 'default', name: '宝贝' }, { id: 'cta', name: '小桃' }, { id: 'cB', name: '阿宝' }, { id: 'cC', name: '星星' }, { id: 'cD', name: '小鹿' }, { id: 'cE', name: '阿朝' }];
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify(cs));
  cs.forEach(function (c) { localStorage.setItem('xy-home-v2:' + c.id + ':lbl-partner', c.name); });
  localStorage.setItem('xy-home-v2:active-contact', 'cD');
  return true;
})()`;

try {
  await cdpConnect();
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  // 手机视口（与项目 verify 系列口径一致）：5 个桌面 chip 在 390px 下必然横向溢出，
  // 「全部」排末尾时才需要横滑——B3 就是给这条区分度兜底。
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  const jsErrors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  };

  // ================= A 结构：chips[0] 恒为「全部」 =================
  console.log('\n== A 结构：「全部」居首 ==');
  await scenario(ONE);
  await evalJs(openCjian);
  await sleep(400);
  let c = await evalJs(CHIPS);
  ok('A1 单桌面：chips[0] 是「全部」', c && c.n === 2 && c.labels[0] === '全部', c && c.labels);
  ok('A1b 首个 .cj-gchip 子节点即「全部」（DOM 顺序，不是仅存在）', c && c.firstChildText === '全部', c && c.firstChildText);

  await scenario(TWO);
  await evalJs(openCjian);
  await sleep(400);
  c = await evalJs(CHIPS);
  ok('A2 双桌面：chips = 全部|宝贝|小桃（原为 宝贝|小桃|全部）', c && c.n === 3 && c.labels.join('|') === '全部|宝贝|小桃', c && c.labels);
  ok('A2b 当前桌面（小桃）仍被高亮，且高亮不在「全部」上', c && c.on === '小桃' && c.on !== '全部', c && c.on);

  await scenario(MANY);
  await evalJs(openCjian);
  await sleep(400);
  c = await evalJs(CHIPS);
  ok('A3 六桌面：chips[0] 依旧是「全部」，各桌面 chip 一个不少', c && c.n === 7 && c.labels[0] === '全部' && c.labels.indexOf('阿朝') >= 0, c && c.labels);

  // ================= B 几何：「全部」最靠左，无需横滑 =================
  console.log('\n== B 几何：一眼可见 ==');
  const geo = await evalJs(`(function () {
    const b = document.getElementById('cj-groups');
    const cs = Array.prototype.slice.call(b.querySelectorAll('.cj-gchip'));
    const lefts = cs.map(function (x) { return Math.round(x.getBoundingClientRect().left); });
    const rights = cs.map(function (x) { return Math.round(x.getBoundingClientRect().right); });
    const labels = cs.map(function (x) { return x.textContent; });
    const barRect = b.getBoundingClientRect();
    const allIdx = labels.indexOf('全部');
    const allRect = allIdx >= 0 ? cs[allIdx].getBoundingClientRect() : null;
    const allLeft = allIdx >= 0 ? lefts[allIdx] : null;
    return {
      labels: labels, lefts: lefts, rights: rights, allIdx: allIdx, barLeft: Math.round(barRect.left), barRight: Math.round(barRect.right),
      // 「全部」的左边界 <= 其它每一个 chip（真正的「排在最前」几何判定）
      allLeftmost: allIdx === 0 && lefts.every(function (v) { return allLeft <= v; }),
      // 「全部」自身在可视区内（量的是「全部」那颗，不是首颗）——这才是用户「看得见」的判定
      allVisible: !!allRect && allRect.left >= barRect.left - 1 && allRect.right <= barRect.right + 1,
      scrollLeft: Math.round(b.scrollLeft)
    };
  })()`);
  ok('B1 「全部」左边界 <= 其余每个 chip（真的排在第一位，非只是 DOM 靠前）', geo && geo.allLeftmost, geo);
  ok('B2 无需横滑（scrollLeft=0）时「全部」就在可视区内——「不好查看」的诉求达成', geo && geo.allVisible && geo.scrollLeft === 0, geo);
  // 多桌面下旧实现的复发特征：末位 chip 的右边界越出可视区（要横滑才看得到）
  const tailOffscreen = geo && Math.max.apply(null, geo.rights) > geo.barRight + 4;
  ok('B3 分组条确实横向溢出（用例有区分度：末位 chip 越出右边界，必须横滑）', tailOffscreen, geo && { barLeft: geo.barLeft, barRight: geo.barRight, labels: geo.labels, rights: geo.rights, note: 'false = 视口太宽/桌面太少、用例失去区分度，需收紧 viewport 或加桌面' });

  // ================= C 行为：点「全部」= 总览，能切回 =================
  console.log('\n== C 行为：总览与切回 ==');
  await evalJs(`(function () { for (const c of document.querySelectorAll('#cj-groups .cj-gchip')) if (c.textContent !== '全部') { c.click(); break; } return true; })()`);
  await sleep(250);
  const beforeAll = await evalJs("({ heads: document.querySelectorAll('#cj-list .cj-group-head').length, cards: document.querySelectorAll('#cj-list .cj-card').length })");
  ok('C0 前置：处于单个桌面视图（无总览分组头）', beforeAll && beforeAll.heads === 0, beforeAll);

  ok('C1 点得中「全部」（首个 chip 可点击）', await clickChip('全部'));
  await sleep(300);
  const inAll = await evalJs(`(function () {
    const b = document.getElementById('cj-groups');
    return {
      on: (b.querySelector('.cj-gchip.on') || {}).textContent || '',
      heads: document.querySelectorAll('#cj-list .cj-group-head').length,
      cards: document.querySelectorAll('#cj-list .cj-card').length
    };
  })()`);
  ok('C2 点「全部」进入总览：高亮在「全部」+ 出现各桌分组头', inAll && inAll.on === '全部' && inAll.heads >= 2, inAll);
  ok('C3 总览下方仍列出梦角卡片（功能未因移位而失效）', inAll && inAll.cards >= 2, inAll);

  await clickChip('小桃');
  await sleep(300);
  const back = await evalJs(`(function () {
    const b = document.getElementById('cj-groups');
    return { on: (b.querySelector('.cj-gchip.on') || {}).textContent || '', heads: document.querySelectorAll('#cj-list .cj-group-head').length };
  })()`);
  ok('C4 再点桌面 chip 能切回单桌视图（高亮回小桃、分组头消失）', back && back.on === '小桃' && back.heads === 0, back);

  // ================= D 回归 =================
  console.log('\n== D 回归 ==');
  ok('D1 全程无未捕获 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3));

  console.log('\n结果: ' + pass + '/' + (pass + fail) + ' 项通过' + (RED ? '（RED 基线：旧次序）' : ''));
  process.exitCode = fail ? 1 : 0;
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
