// ===== 专项回归：此间/梦角档案「按桌面分离」边缘用例（v3.14.x 补充探针） =====
// 覆盖主 verify 脚本未覆盖的高危路径：
//   E1 旧全局根键迁移：启动合并进当前桌面（状态保留）+ 根键被 IDB 回填“复活”后再次加载不重复（幂等并集）
//   E2 梦角档案当前选中被删除（在「此间」删掉）→ 重开自动回退到剩余第一位，不白屏不串档
//   E3 档案页顶部「＋添加」→ 落入【当前桌面】名单，其他桌面名单不受影响（viewCid='' 分支）
//   Z  全程无未捕获异常
// 自组装临时 index.html 运行时验证，不依赖也不触发 node build.mjs，多会话并行可安全跑。
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
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'period.js', 'accounting.js', 'garden.js', 'decision.js', 'pong.js', 'snake-game.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'mobile-adapt.js'];
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => '(function () { try {\n' + readFileSync(join(root, 'src/js', f), 'utf8') + '\n} catch (__e) { try { console.error("[JS] " + f, __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();').join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-test-build').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-cj-edge-' + Date.now());
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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-cj-edge-prof-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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

  const url = baseUrl + '/index.html';
  await cdp('Page.navigate', { url });
  await sleep(4500);

  console.log('\n== E1 旧全局根键迁移 + 复活合并幂等 ==');
  // 预置：当前桌面已有 1 个新梦角；再注入“IDB 回填复活”的旧版全局根键
  await evalJs(`(function () {
    const cid = window.__activeCid || 'default';
    const P = 'xy-home-v2:';
    localStorage.setItem(P + cid + ':cjian-roster', JSON.stringify([{ id: 'dNEW1', name: '现桌梦角', offsetMin: 0 }]));
    localStorage.setItem(P + cid + ':cjian-seeded', '1');
    localStorage.setItem(P + 'cjian-roster', JSON.stringify([{ id: 'dLEG1', name: '旧梦角', offsetMin: 0 }, { id: 'dLEG2', name: '旧梦角二', offsetMin: 60 }]));
    localStorage.setItem(P + 'cjian-state', JSON.stringify({ dLEG1: { p: 'near', a: 'free' } }));
    localStorage.setItem(P + 'cjian-seeded', '1');
    return true;
  })()`);
  await cdp('Page.navigate', { url });
  await sleep(4500);
  const mig = await evalJs(`(function () {
    const cid = window.__activeCid || 'default';
    const P = 'xy-home-v2:';
    const ns = JSON.parse(localStorage.getItem(P + cid + ':cjian-roster') || '[]');
    const ids = ns.map(function (x) { return x.id; });
    const st = JSON.parse(localStorage.getItem(P + cid + ':cjian-state') || '{}');
    return {
      rootGone: !localStorage.getItem(P + 'cjian-roster') && !localStorage.getItem(P + 'cjian-state'),
      hasNew: ids.indexOf('dNEW1') >= 0, legCount: ids.filter(function (x) { return x === 'dLEG1'; }).length,
      leg2In: ids.indexOf('dLEG2') >= 0, stKept: st.dLEG1 && st.dLEG1.p === 'near' && st.dLEG1.a === 'free',
      seeded: !!localStorage.getItem(P + cid + ':cjian-seeded')
    };
  })()`);
  ok('启动迁移：根键已清空', mig && mig.rootGone, mig);
  ok('迁移为按 id 并集：本桌原有 dNEW1 保留、dLEG1 恰好一份', mig && mig.hasNew && mig.legCount === 1, mig);
  ok('dLEG2 也并入本桌名单', mig && mig.leg2In, mig);
  ok('旧状态随迁保留（p/a 不丢）', mig && mig.stKept, mig);
  ok('seeded 标记落位（不再重复播种）', mig && mig.seeded, mig);
  // 模拟 idbRestore 迟到把根键写回 → 下次启动必须幂等合并不出重份
  await evalJs(`(function () {
    const P = 'xy-home-v2:';
    localStorage.setItem(P + 'cjian-roster', JSON.stringify([{ id: 'dLEG1', name: '旧梦角', offsetMin: 0 }, { id: 'dLEG2', name: '旧梦角二', offsetMin: 60 }]));
    localStorage.setItem(P + 'cjian-state', JSON.stringify({ dLEG1: { p: 'gone', a: 'sleep' } }));
    return true;
  })()`);
  await cdp('Page.navigate', { url });
  await sleep(4500);
  const mig2 = await evalJs(`(function () {
    const cid = window.__activeCid || 'default';
    const P = 'xy-home-v2:';
    const ns = JSON.parse(localStorage.getItem(P + cid + ':cjian-roster') || '[]');
    const ids = ns.map(function (x) { return x.id; });
    const st = JSON.parse(localStorage.getItem(P + cid + ':cjian-state') || '{}');
    return { dup: ids.filter(function (x) { return x === 'dLEG1'; }).length, total: ids.length, rootGone: !localStorage.getItem(P + 'cjian-roster'), keptNear: st.dLEG1 && st.dLEG1.p === 'near' };
  })()`);
  ok('根键复活后再加载：dLEG1 无重复（并集幂等）', mig2 && mig2.dup === 1, mig2);
  ok('复活后根键再次清空', mig2 && mig2.rootGone, mig2);
  ok('复活带去的旧状态不覆盖已迁移状态（仍为 near）', mig2 && mig2.keptNear, mig2);

  console.log('\n== E2 档案当前梦角被删除 → 回退 ==');
  await evalJs(`(function () {
    const P = 'xy-home-v2:default:';
    localStorage.setItem(P + 'cjian-roster', JSON.stringify([{ id: 'dA', name: '甲', offsetMin: 0 }, { id: 'dB', name: '乙', offsetMin: 0 }]));
    localStorage.setItem('xy-home-v2:narc-cur', 'dB');
    return true;
  })()`);
  // 在「此间」删除乙（等价存储效果），然后打开梦角档案
  await evalJs("(function () { const P = 'xy-home-v2:default:'; const r = JSON.parse(localStorage.getItem(P + 'cjian-roster')); localStorage.setItem(P + 'cjian-roster', JSON.stringify(r.filter(function (x) { return x.id !== 'dB'; }))); return true; })()");
  await evalJs("window.openNarc(); true");
  await sleep(250);
  const fb = await evalJs(`(function () {
    const hero = document.querySelector('#narc-root .narc-name');
    const chips = Array.prototype.map.call(document.querySelectorAll('#narc-root .narc-chip'), function (b) { return b.textContent.trim(); });
    const on = document.querySelector('#narc-root .narc-chip.on');
    return { hero: hero ? hero.textContent : null, chips: chips, on: on ? on.textContent.trim() : null, cur: localStorage.getItem('xy-home-v2:narc-cur') };
  })()`);
  ok('选中被删后自动回退到剩余第一位（甲）', fb && fb.hero === '甲' && fb.on === '甲', fb);
  ok('chips 正常渲染（甲 + ＋ 添加）', fb && fb.chips.length === 2 && fb.chips[1].indexOf('添加') >= 0, fb);
  ok('narc-cur 已持久化为回退后的 id（dA）', fb && fb.cur === 'dA', fb);

  console.log('\n== E3 档案页「＋添加」落入当前桌面名单 ==');
  const otherCid = await evalJs("(function () { const ex = (window.getContacts() || []).find(function (x) { return x.name === '小柒'; }); return ex ? ex.id : (window.createContact ? window.createContact('小柒') : ''); })()");
  // 预种小柒桌面名单并打上 seeded 标记（否则弹窗完成时的 renderCjian→ensureAllSeeds 会合法播种它，干扰“不受影响”断言）
  await evalJs(`(function () {
    localStorage.setItem('xy-home-v2:${otherCid}:cjian-roster', JSON.stringify([{ id: 'dX7', name: '小柒桌梦角', offsetMin: 0 }]));
    localStorage.setItem('xy-home-v2:${otherCid}:cjian-seeded', '1');
    if (window.setActiveContact) window.setActiveContact('default');
    return true;
  })()`);
  await sleep(150);
  const otherBefore = await evalJs(`(function () { return localStorage.getItem('xy-home-v2:${otherCid}:cjian-roster'); })()`);
  await evalJs("(function () { const b = document.querySelector('#narc-root .narc-addchip'); if (b) b.click(); return true; })()");
  await sleep(180);
  const mPhase1 = await evalJs("(function () { const m = document.getElementById('modal-mask'); const pills = Array.prototype.map.call(document.querySelectorAll('#modal-pills .pill'), function (b) { return b.textContent.trim(); }); return { open: m && !m.hidden, pills: pills }; })()");
  ok('＋添加 打开梦角管理弹窗（action 阶段胶囊）', mPhase1 && mPhase1.open && mPhase1.pills.indexOf('添加梦角') >= 0, mPhase1);
  await evalJs("(function () { const ps = document.querySelectorAll('#modal-pills .pill'); for (let i = 0; i < ps.length; i++) { if (ps[i].textContent.trim() === '添加梦角') { ps[i].click(); break; } } document.getElementById('modal-ok').click(); return true; })()");
  await sleep(150);
  const inp = await evalJs("(function () { const el = document.getElementById('modal-input'); el.value = '新梦角丙'; el.dispatchEvent(new Event('input', { bubbles: true })); return el ? el.value : null; })()");
  ok('进入命名阶段可输入', inp === '新梦角丙', inp);
  await evalJs("document.getElementById('modal-ok').click(); true");
  await sleep(150);
  await evalJs("(function () { const ps = document.querySelectorAll('#modal-pills .pill'); for (let i = 0; i < ps.length; i++) { if (ps[i].textContent.trim() === '与现实同步') { ps[i].click(); break; } } document.getElementById('modal-ok').click(); return true; })()");
  await sleep(220);
  const added = await evalJs(`(function () {
    const d = JSON.parse(localStorage.getItem('xy-home-v2:default:cjian-roster') || '[]');
    return { defHas: d.some(function (x) { return x.name === '新梦角丙'; }), defN: d.length };
  })()`);
  ok('新梦角写入【当前桌面】名单', added && added.defHas, added);
  const otherAfter = await evalJs(`(function () { return localStorage.getItem('xy-home-v2:${otherCid}:cjian-roster'); })()`);
  ok('其他桌面（小柒）名单不受影响', otherAfter === otherBefore, { otherBefore: otherBefore, otherAfter: otherAfter });

  console.log('\n== Z 全程无未捕获异常 ==');
  ok('无未捕获 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3));

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exitCode = fail ? 1 : 0;
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
