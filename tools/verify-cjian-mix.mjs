// ===== 专项验证：此间跨联系人数据串桌修复（迁移按名认亲 + 存量纠偏 + 打开才播种） =====
// 用户反馈：此间里不同联系人的数据串了，全部显示为一个联系人名字。
// 根因（v3.13→v3.14 升级语义，无头复现+截图确认）：
//   ① migrateSplit 把整份旧全局名单塞给「升级时激活的桌面」→ 旧梦角全在一个联系人名下；
//   ② 启动时给每个桌面自动播种以该桌面 TA 名命名的梦角 → 从没建过的梦角凭空出现。
// 修复（cjian.js）：迁移按名认亲归桌 / rehomeMisfiled 一次性存量纠偏 / 首次打开才播种。
// 用例组：
//   A 迁移按名认亲（归属正确/复活幂等/认不到归当前/同名歧义不误归）
//   B 存量纠偏（错放搬回+状态随迁/标记幂等不折腾用户/同名幻影替换/真身保护/歧义不动）
//   C 播种时机（启动不播种/打开才种/删光不复活）
//   D 回归（分桌面 chips/列表/总览/详情归属 + 无 JS 异常）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
let cssFiles = [], jsFiles = [];
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  cssFiles = (bm.match(/const cssFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  jsFiles = (bm.match(/const jsFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => '(function () { try {\n' + readFileSync(join(root, 'src/js', f), 'utf8') + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();').join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-cjian-mix').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-cjian-mix-' + Date.now());
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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-cjian-mix-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
// 场景隔离：清 localStorage + 删 IndexedDB（旧页卸载释放连接后删除生效）再种数据，
// 防止前序场景经 idbRestore 复活旧名单污染当前场景（xyStore.set 是 LS+IDB 双写）
async function scenario(seedExpr) {
  await evalJs("(function(){ try { indexedDB.deleteDatabase('mochi-db'); } catch (e) {};\n" + seedExpr + ";\n})()");
  await navigate(baseUrl + '/index.html');
}
// 名单观察器：动态枚举所有命名空间的 cjian-roster
async function rosters() {
  return evalJs(`(function () {
    function g(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } }
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(':cjian-roster') > 0) {
        const ns = k.slice('xy-home-v2:'.length, k.indexOf(':cjian-roster'));
        out[ns] = g(k).map(function (x) { return x.name; });
      }
    }
    out.__root = g('xy-home-v2:cjian-roster').map(function (x) { return x.name; });
    return out;
  })()`);
}
async function statesOf(ns) {
  return evalJs(`(function () { try { return JSON.parse(localStorage.getItem('xy-home-v2:${ns}:cjian-state') || '{}'); } catch (e) { return {}; } })()`);
}
// 基础注册表：default=宝贝 + cta=小桃（lbl-partner 与联系人名同设，模拟真实用户）
const REG_SEED = `(function () {
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
const NOW = Date.now();

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
  const url = baseUrl + '/index.html';
  await navigate(url); // 首次加载（空环境）

  // ============ A 迁移按名认亲 ============
  console.log('\n== A1 旧全局名单按名归桌 ==');
  await scenario(REG_SEED + `
    localStorage.setItem('xy-home-v2:cjian-roster', JSON.stringify([
      { id: 'dB1', name: '宝贝', offsetMin: 0 },
      { id: 'dX1', name: '星星', offsetMin: 120 }
    ]));
    localStorage.setItem('xy-home-v2:cjian-state', JSON.stringify({ dB1: { p: 'near', a: 'free', sinceP: ${NOW}, sinceA: ${NOW}, cdP: 1800000, cdA: 900000 } }));
    localStorage.setItem('xy-home-v2:cjian-seeded', '1');`);
  await navigate(url);
  let r = await rosters();
  ok('「宝贝」认亲归 default 桌面', r && r.default && r.default.indexOf('宝贝') >= 0, r);
  ok('认不到亲的「星星」归激活桌面 cta', r && r.cta && r.cta.indexOf('星星') >= 0, r);
  ok('根键已清', r && r.__root.length === 0, r && r.__root);
  const stA = await statesOf('default');
  ok('状态随迁（dB1.p=near 落在 default）', stA && stA.dB1 && stA.dB1.p === 'near', stA);
  const seededA = await evalJs("({ d: !!localStorage.getItem('xy-home-v2:default:cjian-seeded'), t: !!localStorage.getItem('xy-home-v2:cta:cjian-seeded') })");
  ok('两个目标桌面 seeded 标记落位', seededA && seededA.d && seededA.t, seededA);

  console.log('\n== A2 根键复活再迁移幂等 ==');
  await evalJs("(function () { localStorage.setItem('xy-home-v2:cjian-roster', JSON.stringify([{ id: 'dB1', name: '宝贝', offsetMin: 0 }, { id: 'dX1', name: '星星', offsetMin: 120 }])); localStorage.setItem('xy-home-v2:cjian-seeded', '1'); return true; })()");
  await navigate(url);
  r = await rosters();
  ok('复活根键再迁移无重复（宝贝/星星各恰一份）', r && r.default && r.cta && r.default.filter((x) => x === '宝贝').length === 1 && r.cta.filter((x) => x === '星星').length === 1, r);

  console.log('\n== A3 同名歧义不误归 ==');
  await scenario(`(function () {
    localStorage.clear();
    localStorage.setItem('xy-home-v2:contacts', JSON.stringify([
      { id: 'default', name: '宝贝' },
      { id: 'cta', name: '宝贝' }
    ]));
    localStorage.setItem('xy-home-v2:active-contact', 'cta');
    localStorage.setItem('xy-home-v2:cjian-roster', JSON.stringify([{ id: 'dB2', name: '宝贝', offsetMin: 0 }]));
    return true;
  })()`);
  await navigate(url);
  r = await rosters();
  ok('两个桌面同名身份时旧梦角归当前桌面（不赌）', r && r.cta && r.cta.indexOf('宝贝') >= 0 && (!r.default || r.default.indexOf('宝贝') < 0), r);

  // ============ B 存量纠偏 rehome ============
  console.log('\n== B1 错放梦角搬回家（状态随迁） ==');
  await scenario(REG_SEED + `
    // 模拟老版迁移后果：宝贝的真实梦角（带互动痕迹）被错放进小桃桌面
    localStorage.setItem('xy-home-v2:cta:cjian-roster', JSON.stringify([
      { id: 'dB9', name: '宝贝', offsetMin: 0 },
      { id: 'dS1', name: '星星', offsetMin: 0 }
    ]));
    localStorage.setItem('xy-home-v2:cta:cjian-state', JSON.stringify({ dB9: { p: 'far', a: 'busy', sinceP: ${NOW}, sinceA: ${NOW}, cdP: 1800000, cdA: 900000, lastPerceive: ${NOW} } }));
    localStorage.setItem('xy-home-v2:cta:cjian-seeded', '1');`);
  await navigate(url);
  r = await rosters();
  ok('「宝贝」已搬回 default 桌面', r && r.default && r.default.indexOf('宝贝') >= 0 && r.cta.indexOf('宝贝') < 0, r);
  ok('认不到亲的「星星」留在原桌面', r && r.cta && r.cta.indexOf('星星') >= 0, r);
  const stB = await statesOf('default');
  ok('状态随迁（dB9 连 lastPerceive 一起搬）', stB && stB.dB9 && stB.dB9.lastPerceive > 0 && stB.dB9.p === 'far', stB);
  const markB = await evalJs("localStorage.getItem('xy-home-v2:cjian-rehome-v1')");
  ok('纠偏标记已落盘（一次性）', markB === '1', markB);

  console.log('\n== B2 标记幂等：之后用户手动放的不再折腾 ==');
  // 「用户手动放」必须走应用存储契约（xyStore.set＝内存+LS+写日志+IDB 同步落；管理界面
  // 「添加梦角」的 saveRoster 底层就是它，真实添加自带 manual:1，cid 跟随所在桌面）。
  // 不能裸写 localStorage：idb.js 的 wrj 写日志（#339 系，杀进程回滚自愈）会把「日志里
  // 没有的 LS 直写」当系统回滚治愈回旧值——裸写版用例曾因此长红（本组旧 3 红之二），非产品缺陷。
  await evalJs("(function () { const S = window.xyStore('xy-home-v2:cta'); const l = JSON.parse(S.get('cjian-roster') || '[]'); l.push({ id: 'dB10', name: '宝贝', offsetMin: 0, cid: 'cta', manual: 1 }); S.set('cjian-roster', JSON.stringify(l)); return true; })()");
  await navigate(url);
  await evalJs("(function(){ const a=document.querySelector('.app[data-app=\"cjian\"]'); if(a) a.click(); return true; })()");
  await sleep(400);
  r = await rosters();
  ok('标记后手动放在小桃桌面的「宝贝」不被搬走（重开此间自愈后仍在）', r && r.cta && r.cta.indexOf('宝贝') >= 0, r);

  console.log('\n== B3 同名幻影替换（外来者带痕迹、家里无痕迹） ==');
  await scenario(REG_SEED + `
    // default 桌面是升级时自动播种的幻影宝贝（无任何互动痕迹）；真身在小桃桌面带痕迹
    localStorage.setItem('xy-home-v2:default:cjian-roster', JSON.stringify([{ id: 'dPH', name: '宝贝', offsetMin: 0 }]));
    localStorage.setItem('xy-home-v2:default:cjian-state', JSON.stringify({ dPH: { p: 'nearby', a: 'free', sinceP: ${NOW}, sinceA: ${NOW}, cdP: 1800000, cdA: 900000 } }));
    localStorage.setItem('xy-home-v2:default:cjian-seeded', '1');
    localStorage.setItem('xy-home-v2:cta:cjian-roster', JSON.stringify([{ id: 'dREAL', name: '宝贝', offsetMin: 0 }]));
    localStorage.setItem('xy-home-v2:cta:cjian-state', JSON.stringify({ dREAL: { p: 'near', a: 'free', sinceP: ${NOW}, sinceA: ${NOW}, cdP: 1800000, cdA: 900000, __open: ${NOW} } }));
    localStorage.setItem('xy-home-v2:cta:cjian-seeded', '1');
    localStorage.setItem('xy-home-v2:narc-dPH', JSON.stringify({ created: ${NOW} }));
    localStorage.setItem('xy-home-v2:narc-cur', 'dPH');`);
  await navigate(url);
  r = await rosters();
  ok('真身宝贝归位 default，幻影被替换', r && r.default && r.default.join(',') === '宝贝' && r.cta && r.cta.length === 0, r);
  const stB3 = await statesOf('default');
  ok('替换后保留真身状态（dREAL.p=near）', stB3 && stB3.dREAL && stB3.dREAL.p === 'near' && !stB3.dPH, stB3);
  const narcB3 = await evalJs("({ ph: localStorage.getItem('xy-home-v2:narc-dPH'), cur: localStorage.getItem('xy-home-v2:narc-cur') })");
  ok('幻影的梦角档案/当前选中已清', narcB3 && narcB3.ph === null && narcB3.cur === null, narcB3);

  console.log('\n== B4 真身保护（家里带痕迹时不替换不删除） ==');
  await scenario(REG_SEED + `
    localStorage.setItem('xy-home-v2:default:cjian-roster', JSON.stringify([{ id: 'dHOME', name: '宝贝', offsetMin: 0 }]));
    localStorage.setItem('xy-home-v2:default:cjian-state', JSON.stringify({ dHOME: { p: 'near', a: 'free', sinceP: ${NOW}, sinceA: ${NOW}, cdP: 1800000, cdA: 900000, lastPerceive: ${NOW} } }));
    localStorage.setItem('xy-home-v2:default:cjian-seeded', '1');
    localStorage.setItem('xy-home-v2:cta:cjian-roster', JSON.stringify([{ id: 'dGUEST', name: '宝贝', offsetMin: 0 }]));
    localStorage.setItem('xy-home-v2:cta:cjian-state', JSON.stringify({}));
    localStorage.setItem('xy-home-v2:cta:cjian-seeded', '1');`);
  await navigate(url);
  r = await rosters();
  ok('家里真身带痕迹、外来者无痕迹：都不动', r && r.default && r.default.join(',') === '宝贝' && r.cta && r.cta.join(',') === '宝贝', r);

  console.log('\n== B5 歧义身份不搬 ==');
  await scenario(`(function () {
    localStorage.clear();
    localStorage.setItem('xy-home-v2:contacts', JSON.stringify([
      { id: 'default', name: '宝贝' },
      { id: 'cta', name: '宝贝' }
    ]));
    localStorage.setItem('xy-home-v2:cta:cjian-roster', JSON.stringify([{ id: 'dAMB', name: '宝贝', offsetMin: 0 }]));
    return true;
  })()`);
  await navigate(url);
  r = await rosters();
  ok('两个桌面同名身份：梦角原地保留', r && r.cta && r.cta.join(',') === '宝贝' && (!r.default || r.default.length === 0), r);

  // ============ C 播种时机 ============
  console.log('\n== C1 启动不再给每个桌面播种 ==');
  await scenario(REG_SEED);
  await navigate(url);
  r = await rosters();
  ok('从未打开此间：所有桌面都没有幻影梦角', r && r.__root.length === 0 && !r.default && !r.cta, r);

  console.log('\n== C2 打开此间才种当前桌面 ==');
  await evalJs("(function(){ const a=document.querySelector('.app[data-app=\"cjian\"]'); if(a) a.click(); return true; })()");
  await sleep(400);
  r = await rosters();
  ok('激活桌面 cta 种下 starter「小桃」', r && r.cta && r.cta.join(',') === '小桃', r);
  ok('default 桌面仍未被播种', !r.default, r);
  const uiC2 = await evalJs("(function () { function t(s){return Array.prototype.map.call(document.querySelectorAll(s),function(n){return n.textContent})} return { chips: t('#cj-groups .cj-gchip').join('|'), cards: t('#cj-list .cj-card-name').join('|') }; })()");
  ok('UI 列表显示 starter 小桃、chips 正确（「全部」居首，#615）', uiC2 && uiC2.chips === '全部|宝贝|小桃' && uiC2.cards === '小桃', uiC2);

  console.log('\n== C3 删光梦角后不复活 ==');
  // 「用户删光」同 B2 走应用存储契约（管理界面删除路径同落点）；裸写 LS 会被 wrj 写日志
  // 按「系统回滚」治愈回旧值＝刚删的名单复活（存储层设计行为，非 bug；旧 3 红之一）。
  await evalJs("(function () { const S = window.xyStore('xy-home-v2:cta'); S.set('cjian-roster', '[]'); S.set('cjian-seeded', '1'); return true; })()");
  await navigate(url);
  await evalJs("(function(){ const a=document.querySelector('.app[data-app=\"cjian\"]'); if(a) a.click(); return true; })()");
  await sleep(400);
  r = await rosters();
  ok('用户删光后重开不重新播种（空态引导）', r && (!r.cta || r.cta.length === 0), r);
  const emptyC3 = await evalJs("!document.getElementById('cj-empty').hidden");
  ok('空态引导可见', emptyC3 === true, emptyC3);

  // ============ D 回归：分桌面基本盘 ============
  console.log('\n== D1 分桌面 chips/列表/总览/详情 ==');
  await scenario(REG_SEED + `
    localStorage.setItem('xy-home-v2:default:cjian-roster', JSON.stringify([{ id: 'dA1', name: '阿宝', offsetMin: 0 }]));
    localStorage.setItem('xy-home-v2:default:cjian-seeded', '1');
    localStorage.setItem('xy-home-v2:cta:cjian-roster', JSON.stringify([{ id: 'dB1x', name: '阿桃', offsetMin: 60 }]));
    localStorage.setItem('xy-home-v2:cta:cjian-seeded', '1');`);
  await navigate(url);
  await evalJs("(function(){ const a=document.querySelector('.app[data-app=\"cjian\"]'); if(a) a.click(); return true; })()");
  await sleep(300);
  let ui = await evalJs("(function () { function t(s){return Array.prototype.map.call(document.querySelectorAll(s),function(n){return n.textContent})} return { chips: t('#cj-groups .cj-gchip').join('|'), cards: t('#cj-list .cj-card-name').join('|') }; })()");
  ok('激活桌面 cta 列表只有 阿桃（「全部」居首，#615）', ui && ui.chips === '全部|宝贝|小桃' && ui.cards === '阿桃', ui);
  await evalJs("(function(){ const cs=document.querySelectorAll('#cj-groups .cj-gchip'); for(const c of cs) if(c.textContent==='全部'){c.click();break;} return true; })()");
  await sleep(250);
  ui = await evalJs("(function () { function t(s){return Array.prototype.map.call(document.querySelectorAll(s),function(n){return n.textContent})} return { heads: t('#cj-list .cj-group-head span:first-child').join('|'), cards: t('#cj-list .cj-card-name').join('|') }; })()");
  ok('总览分组与卡片归属正确', ui && ui.heads === '宝贝|小桃' && ui.cards === '阿宝|阿桃', ui);
  await evalJs("document.querySelector('#cj-list .cj-card').click(); true");
  await sleep(250);
  ui = await evalJs("({ n: (document.querySelector('#cj-detail-body .cj-d-name')||{}).textContent||'', s: (document.querySelector('#cj-detail-body .cj-d-src')||{}).textContent||'' })");
  ok('详情归属「宝贝」的此间', ui && ui.n === '阿宝' && ui.s.indexOf('宝贝') >= 0, ui);

  console.log('\n== D2 无 JS 异常 ==');
  ok('全程无未捕获异常', jsErrors.length === 0, jsErrors.slice(0, 3));

  console.log('\n结果: ' + pass + '/' + (pass + fail) + ' 项通过');
  process.exitCode = fail ? 1 : 0;
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
