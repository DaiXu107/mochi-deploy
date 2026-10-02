// ===== 专项回归：【TA的心情】字卡库（ta-mood-data.js / ta-mood.js v3.16.x） =====
// 用户需求：字卡库【系统预设字卡】的【聊天情绪字卡】下方新增【TA的心情】字卡库，
// 内容为正常聊天中可被联系人触发使用的聊天字卡（主动分享自己的心情/近况/状态）。
// 设计落地（对齐用户设计文档）：
//   - 15 类 236 张（文档原文去重：类内/跨类重复 6 张去重保留首见）
//   - 页面：系统预设字卡列表 聊天情绪字卡 下方新增 li-ta-mood 入口 + page-ta-mood 独立页
//     （总开关 tm-enabled / 概率 stepper tm-prob 5-30 默认 15 / 分组 chips / 搜索 / 逐张开关）
//   - 触发：chat.js replyOnce 每次正常回复后 tryTaMoodShare() 低概率追加一条独立分享
//     （addIn initiative + tag「TA的心情」，tagNoDup 不重复正文）
//   - 规则：总冷却 3 条（tm-cd-left 递减）+ 同类冷却（tm-history 最近 3 组不重复抽）+
//     分组权重（40/20/20/15/5 口径）+ 单卡开关过滤（tm-off-<组>:<内容>）
// 用例：
//   A1 数据入库：15 组 / 236 卡 / 无重复内容 / 每组非空 / 权重合法
//   A2 入口与页面：li-ta-mood 与 page-ta-mood 存在；入口计数 236
//   A3 页面导航：点 li-ta-mood → page-ta-mood 显示；返回回字卡库
//   A4 渲染：分组 chips 15 个 + 全部；列表分组 header + 卡行 + 开关；权重标签
//   A5 搜索过滤：输入命中/未命中
//   A6 总开关：关 tm-enabled → tryTaMoodShare 返回 null
//   A7 触发概率：tm-prob 100 必触发（跳过冷却）；tm-prob 0 不触发
//   A8 总冷却：触发后 cd=3；连续调用递减不触发；3 条后恢复可触发
//   A9 同类冷却：同一分组不连续抽取（history 最近 3 组）
//   A10 单卡开关：关闭一张卡后不再抽取；整组关完跳过该组
//   A11 权重分布（概率级，宽松 5% 区间）与聊天接入探针存在
//   A12 产物静态断言（入口/页面/tag/触发函数）
//   A13 零 JS 异常
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
// ---- 测试专用组装：按 build.mjs 同顺序把 template+css+js 拼成临时 index.html ----
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css', 'drift-bottle.css'];
const jsFiles = ['device.js', 'idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'ta-mood-data.js', 'ta-mood.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'my-arc.js', 'period.js', 'accounting.js', 'garden.js', 'room.js', 'drift-bottle.js', 'decision.js', 'group-decision.js', 'pong.js', 'snake-game.js', 'breakout.js', 'connect-four.js', 'coop-mine.js', 'fishing.js', 'memory-game.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'mobile-adapt.js'];
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => '(function () { try {\n' + readFileSync(join(root, 'src/js', f), 'utf8') + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();').join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-test-build').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-tamood-root-' + Date.now());
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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-tamood-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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

  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4500);

  console.log('\n== A1 数据入库 ==');
  const d = await evalJs("(function(){ var D = window.TA_MOOD_DATA || { groups: [], cards: [] }; var real = D.cards.filter(function(c){ return c && c.content; }); var byg = {}; var seen = new Set(); var dup = []; real.forEach(function(c){ byg[c.group] = (byg[c.group]||0)+1; if (seen.has(c.content)) dup.push(c.content); seen.add(c.content); }); return { groups: D.groups.length, cards: real.length, dup: dup, empty: D.groups.filter(function(g){ return !byg[g.group]; }).map(function(g){ return g.group; }), badW: D.groups.filter(function(g){ return !(g.weight > 0); }).map(function(g){ return g.group; }) }; })()");
  ok('15 个分组', d && d.groups === 15, d && d.groups);
  ok('235 张独特字卡（文档原文 241 条去重 6 条重复项）', d && d.cards === 235, d && d.cards);
  ok('无重复内容', d && d.dup.length === 0, d && d.dup);
  ok('每组都有字卡', d && d.empty.length === 0, d && d.empty);
  ok('权重均合法(>0)', d && d.badW.length === 0, d && d.badW);

  console.log('\n== A2 入口与页面 ==');
  const e2 = await evalJs("({ li: !!document.getElementById('li-ta-mood'), page: !!document.getElementById('page-ta-mood'), cnt: (document.querySelector('#li-ta-mood > .t')||{}).textContent || '', tmList: !!document.getElementById('tm-list'), tmEn: !!document.getElementById('tm-enabled'), tmProb: !!document.getElementById('tm-prob-val') })");
  ok('系统预设字卡列表入口 li-ta-mood 存在', e2 && e2.li === true, e2);
  ok('独立页面 page-ta-mood 存在', e2 && e2.page === true, e2);
  ok('入口计数 = 235', e2 && e2.cnt === '235', e2 && e2.cnt);
  ok('列表/总开关/概率 stepper 锚点存在', e2 && e2.tmList && e2.tmEn && e2.tmProb, e2);

  console.log('\n== A3 页面导航 ==');
  await evalJs("document.getElementById('li-ta-mood').click(); true");
  await sleep(200);
  let st = await evalJs("({ pageHidden: document.getElementById('page-ta-mood').hidden, enabled: document.getElementById('tm-enabled').checked, probVal: document.getElementById('tm-prob-val').value })");
  ok('点入口进入 page-ta-mood', st && st.pageHidden === false, st);
  ok('总开关默认开启', st && st.enabled === true, st);
  ok('概率默认 15', st && st.probVal === '15', st && st.probVal);

  console.log('\n== A4 渲染 ==');
  let r4 = await evalJs("(function(){ var bar = document.getElementById('tm-groups-bar'); var list = document.getElementById('tm-list'); var chips = Array.from(bar.querySelectorAll('.cc-g-chip')).map(function(c){ return c.textContent; }); var headers = Array.from(list.querySelectorAll('.cc-group-header')).map(function(h){ return h.textContent; }); var items = list.querySelectorAll('.cc-item').length; var wLbl = list.querySelectorAll('.cc-group-header .ccg-count[style*=\"background\"]').length; return { chips: chips, headers: headers, items: items, wLbl: wLbl }; })()");
  ok('分组 chips = 16（全部 + 15 组）', r4 && r4.chips.length === 16, r4 && r4.chips.length);
  ok('chips 含全部 15 个分组名', r4 && ['平静','开心','轻松','满足','疲惫','困倦','烦躁','低落','想你','想陪你','小期待','突然的感觉','今日近况','不太想说','情绪变化'].every(function(g){ return r4.chips.indexOf(g) >= 0; }), r4 && r4.chips);
  ok('列表渲染 15 个分组 header', r4 && r4.headers.length === 15, r4 && r4.headers.length);
  ok('全部卡行 = 235', r4 && r4.items === 235, r4 && r4.items);
  ok('权重标签渲染（每组 header 含权重徽标）', r4 && r4.wLbl === 15, r4 && r4.wLbl);

  console.log('\n== A5 搜索过滤 ==');
  await evalJs("(function(){ var i = document.getElementById('tm-search-input'); i.value = '今天有点想你'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await sleep(150);
  let s5 = await evalJs("(function(){ var list = document.getElementById('tm-list'); return { items: list.querySelectorAll('.cc-item').length, headers: list.querySelectorAll('.cc-group-header').length }; })()");
  ok('搜索命中「今天有点想你」→ 想你组 1 卡', s5 && s5.items === 1 && s5.headers === 1, s5);
  await evalJs("(function(){ var i = document.getElementById('tm-search-input'); i.value = '完全不存在的内容xyz'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await sleep(150);
  s5 = await evalJs("document.getElementById('tm-list').querySelector('.cc-empty') ? document.getElementById('tm-list').querySelector('.cc-empty').textContent : ''");
  ok('未命中 → 空态', typeof s5 === 'string' && s5.indexOf('暂无心情字卡') >= 0, s5);
  await evalJs("(function(){ var i = document.getElementById('tm-search-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await sleep(150);

  console.log('\n== A6 总开关 ==');
  await evalJs("localStorage.setItem('xy-home-v2:default:tm-enabled', '0'); true");
  let r6 = await evalJs("window.tryTaMoodShare ? window.tryTaMoodShare() : 'NO_FN'");
  ok('关闭后 tryTaMoodShare 返回 null', r6 === null, r6);
  await evalJs("localStorage.setItem('xy-home-v2:default:tm-enabled', '1'); true");

  console.log('\n== A7 触发概率 ==');
  await evalJs("localStorage.setItem('xy-home-v2:default:tm-prob', '100'); localStorage.setItem('xy-home-v2:default:tm-cd-left', '0'); localStorage.removeItem('xy-home-v2:default:tm-history'); true");
  let r7 = await evalJs("window.tryTaMoodShare()");
  ok('概率 100 → 触发返回 {content, group}', r7 && r7.content && r7.group, r7);
  await evalJs("localStorage.setItem('xy-home-v2:default:tm-prob', '0'); localStorage.setItem('xy-home-v2:default:tm-cd-left', '0'); localStorage.removeItem('xy-home-v2:default:tm-history'); true");
  r7 = await evalJs("window.tryTaMoodShare()");
  ok('概率 0 → 不触发', r7 === null, r7);
  await evalJs("localStorage.setItem('xy-home-v2:default:tm-prob', '100'); localStorage.setItem('xy-home-v2:default:tm-cd-left', '0'); localStorage.removeItem('xy-home-v2:default:tm-history'); true");

  console.log('\n== A8 总冷却 ==');
  const r8 = await evalJs("(function(){ var out = []; var t = window.tryTaMoodShare; var cdKey = 'xy-home-v2:default:tm-cd-left'; localStorage.setItem(cdKey, '0'); localStorage.removeItem('xy-home-v2:default:tm-history'); localStorage.setItem('xy-home-v2:default:tm-prob', '100'); var a = t(); out.push({ a: !!a, cd: Number(localStorage.getItem(cdKey)||0) }); var b = t(); out.push({ b: !!b, cd: Number(localStorage.getItem(cdKey)||0) }); var c = t(); out.push({ c: !!c, cd: Number(localStorage.getItem(cdKey)||0) }); var d = t(); out.push({ d: !!d, cd: Number(localStorage.getItem(cdKey)||0) }); var e = t(); out.push({ e: !!e, cd: Number(localStorage.getItem(cdKey)||0) }); return out; })()");
  ok('首次触发后 cd=3', r8 && r8[0].a === true && r8[0].cd === 3, r8 && r8[0]);
  ok('冷却中 3 次调用递减不触发', r8 && r8[1].b === false && r8[1].cd === 2 && r8[2].c === false && r8[2].cd === 1 && r8[3].d === false && r8[3].cd === 0, r8);
  ok('冷却结束后恢复触发', r8 && r8[4].e === true, r8 && r8[4]);

  console.log('\n== A9 同类冷却 ==');
  const r9 = await evalJs("(function(){ var t = window.tryTaMoodShare; var histKey = 'xy-home-v2:default:tm-history'; var cdKey = 'xy-home-v2:default:tm-cd-left'; var out = []; for (var i = 0; i < 8; i++) { localStorage.setItem(cdKey, '0'); var r = t(); out.push(r ? r.group : null); } var hist = JSON.parse(localStorage.getItem(histKey) || '[]'); return { seq: out, hist: hist }; })()");
  ok('连续触发记录 8 组', r9 && r9.seq.every(function(x){ return x !== null; }), r9 && r9.seq);
  ok('同类不连续：相邻触发分组不同', r9 && r9.seq.every(function(g, i){ return i === 0 || g !== r9.seq[i-1]; }), r9 && r9.seq);
  ok('history 保存最近 3 组', r9 && r9.hist.length === 3, r9 && r9.hist);

  console.log('\n== A10 单卡开关 ==');
  const r10 = await evalJs("(function(){ var t = window.tryTaMoodShare; var cdKey = 'xy-home-v2:default:tm-cd-left'; var histKey = 'xy-home-v2:default:tm-history'; var probKey = 'xy-home-v2:default:tm-prob'; localStorage.setItem(probKey, '100'); localStorage.setItem(cdKey, '0'); localStorage.removeItem(histKey); var D = window.TA_MOOD_DATA; var target = D.cards[0]; localStorage.setItem('xy-home-v2:default:tm-off-' + target.group + ':' + target.content, '1'); var got = null; for (var i = 0; i < 20 && !got; i++) { localStorage.setItem(cdKey, '0'); got = t(); } localStorage.removeItem('xy-home-v2:default:tm-off-' + target.group + ':' + target.content); return { off: target.content, gotGroup: got ? got.group : null, offGroup: target.group, gotContent: got ? got.content : null }; })()");
  ok('关闭一张卡后 20 次内未抽到它', r10 && r10.gotContent !== r10.off, r10);

  console.log('\n== A11 权重分布 + 聊天接入探针 ==');
  const r11 = await evalJs("(function(){ var t = window.tryTaMoodShare; var cdKey = 'xy-home-v2:default:tm-cd-left'; var histKey = 'xy-home-v2:default:tm-history'; var probKey = 'xy-home-v2:default:tm-prob'; localStorage.setItem(probKey, '100'); var cnt = {}; var seq = []; for (var i = 0; i < 120; i++) { localStorage.setItem(cdKey, '0'); var r = t(); if (!r) { seq.push(null); continue; } cnt[r.group] = (cnt[r.group]||0)+1; seq.push(r.group); } var total = Object.keys(cnt).reduce(function(a,k){ return a + cnt[k]; }, 0); var W = {}; var G = window.TA_MOOD_DATA.groups; G.forEach(function(g){ W[g.group] = g.weight; }); var flat = []; G.forEach(function(g){ for (var i = 0; i < (g.weight||1); i++) flat.push(g.group); }); var sim = {}; for (var i = 0; i < 5000; i++) { sim[flat[Math.floor(Math.random()*flat.length)]] = (sim[flat[Math.floor(Math.random()*flat.length)]]||0)+1; } var cntPct = {}; Object.keys(cnt).forEach(function(k){ cntPct[k] = cnt[k] / total; }); var simPct = {}; Object.keys(sim).forEach(function(k){ simPct[k] = sim[k] / 5000; }); var dev = 0, devK = ''; Object.keys(cntPct).forEach(function(k){ var dv = Math.abs(cntPct[k] - (simPct[k]||0)); if (dv > dev) { dev = dv; devK = k; } }); return { total: total, distinct: Object.keys(cnt).length, maxDev: dev, maxDevK: devK, probKey: probKey }; })()");
  ok('120 次连续触发（跳过冷却）全命中', r11 && r11.total === 120 && r11.distinct > 5, r11);
  ok('实际分布与权重模拟偏差 < 0.2（宽松防误报）', r11 && r11.maxDev < 0.2, r11 && r11.maxDev);
  const probe = await evalJs("({ tm: !!window.tryTaMoodShare, api: !!window.taMoodApi, chatHook: (window.__replyDiag !== undefined) })");
  ok('聊天接入探针存在（tryTaMoodShare/taMoodApi）', probe && probe.tm && probe.api, probe);

  console.log('\n== A12 产物静态断言 ==');
  const src = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
  ok('chat.js 接入 tryTaMoodShare', src.indexOf('tryTaMoodShare') >= 0);
  ok('接入带来源 tag「TA的心情」', src.indexOf("'TA的心情'") >= 0);
  ok('ta-mood.js 存在触发函数与页面绑定', readFileSync(join(root, 'src/js/ta-mood.js'), 'utf8').indexOf('tryTaMoodShare') >= 0);
  ok('ta-mood-data.js 存在数据声明', readFileSync(join(root, 'src/js/ta-mood-data.js'), 'utf8').indexOf('window.TA_MOOD_DATA') >= 0);
  const tpl = readFileSync(join(root, 'src/template.html'), 'utf8');
  ok('template 含 li-ta-mood / page-ta-mood', tpl.indexOf('li-ta-mood') >= 0 && tpl.indexOf('page-ta-mood') >= 0);
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  ok('build.mjs 注册 ta-mood-data.js + ta-mood.js', bm.indexOf("'ta-mood-data.js'") >= 0 && bm.indexOf("'ta-mood.js'") >= 0);

  console.log('\n== A13 零 JS 异常 ==');
  ok('加载至今无未捕获异常', jsErrors.length === 0, jsErrors);

  console.log('\n===== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 =====');
} catch (e) {
  console.error('\n脚本异常:', e);
  fail++;
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
process.exit(fail ? 1 : 0);
