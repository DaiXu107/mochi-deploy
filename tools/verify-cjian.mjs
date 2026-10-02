// ===== 专项回归：此间（梦角世界时间与在场感知；v3.14.x 按桌面分组 + 总览） =====
// 重设计核心：刷新机制本质是随机，梦角自己随机选择状态（受世界时辰/最近互动加权 + 冷却约束）；
//   时间连续流动（现实+偏移，十二时辰+初/正，非重抽）；每次打开此间 TA 们重新随机选择今天的轨迹。
// v3.14.x：名单/状态按桌面命名空间分离；页内顶部 chips 直接切换别的桌面梦角；
//   「全部」总览一次看完全部梦角状态；详情上一位/下一位跟随当前视图（#786a：单桌面视图只在本桌
//   名单里循环，「全部」总览才跨桌面——旧实现恒跨桌面＝用户报「单个 tag 打开后里面有别人的名字」）。
// 用例：
//   T1 更多功能面板出现「此间」入口，点击后进入 page-cjian（记录来源，可返回聊天）
//   T2 首次打开自动播种一个梦角；世界时间/时辰细分（初/正）渲染出来；桌面分组条渲染
//   T2b 分组切换与总览：chips 切换别的桌面梦角（自动播种）；「全部」按桌面分组一次看全
//   T3 时间引擎：初/正边界正确（初=时辰前半小时，正=其后）；偏移产生不同世界时辰
//   T4 状态双维：在场/空闲标签齐全，均在预设内
//   T5 感知此间：无梦角提示 / 有输出文案 / 4s 点击冷却拦截 / 一次最多改变一个梦角
//   T6 刷新机制=随机选择：冷却没过的梦角状态保持不动；冷却过了会重新随机（sinceP 更新时间戳）
//   T7 今日轴：12 行、当前时辰行反映实时状态、预测文案为可能性表述；再次打开会重新随机选择
//   T8 梦角管理：添加（名字→时间偏移两阶段，含「独立时间流」）→ 改名 → 删除
//   T8b 详情上一位/下一位：不回列表直接切换梦角，且范围＝当前视图（单桌只在本桌循环／全部跨桌面，#786a）
//   T9 梦角详情：点卡片进入 TA 的一天（12 时辰轨迹 + 世界时间 + 偏移标签），可返回
//   T9b 总览模式下管理先进「选桌面」，动作作用于所选桌面自己的名单
//   T10 突然靠近：长时间无变化+低概率事件路径不报错
//   T11 发送消息后 cjianNoteChat 打点（记在当前桌面命名空间）
//   T12 加载与操作全程无未捕获异常
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
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'period.js', 'accounting.js', 'garden.js', 'decision.js', 'pong.js', 'snake-game.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'mobile-adapt.js'];
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => '(function () { try {\n' + readFileSync(join(root, 'src/js', f), 'utf8') + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();').join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-test-build').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-cjian-root-' + Date.now());
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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-cjian-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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

  await evalJs("(function () { const t = document.querySelector('.tab[data-page=\"page-phone\"]'); if (t) t.click(); const app = document.querySelector('.app[data-app=\"chat\"]'); if (app) app.click(); return true; })()");
  await sleep(300);

  console.log('\n== T1 入口与打开 ==');
  ok('聊天页更多功能按钮存在', await evalJs("!!document.getElementById('chat-more-btn')"));
  await evalJs("document.getElementById('chat-more-btn').click(); true");
  await sleep(120);
  const cjianBtn = await evalJs("(function () { const b = document.getElementById('more-cjian'); return b ? { visible: b.offsetParent !== null, label: b.textContent.trim() } : null; })()");
  ok('更多功能面板出现「此间」入口', cjianBtn && cjianBtn.visible && cjianBtn.label === '此间', cjianBtn);
  await evalJs("document.getElementById('more-cjian').click(); true");
  await sleep(150);
  const opened = await evalJs("(function () { const p = document.getElementById('page-cjian'); return { open: !p.hidden, from: window.__cjianFrom || '', title: (document.querySelector('#page-cjian .ch-name') || {}).textContent }; })()");
  ok('点击后进入 page-cjian（记录来源 chat）', opened && opened.open && opened.from === 'chat', opened);
  ok('页面标题为「此间」', opened && opened.title === '此间', opened && opened.title);

  console.log('\n== T2 首次播种与渲染 ==');
  const hero = await evalJs("(function () { const cid = window.__activeCid || 'default'; return { seeded: !!localStorage.getItem('xy-home-v2:' + cid + ':cjian-seeded'), cards: document.querySelectorAll('#cj-list .cj-card').length, hero: document.getElementById('cj-hero-time').textContent, todayRows: document.querySelectorAll('#cj-today .cj-today-row').length, emptyHidden: document.getElementById('cj-empty').hidden }; })()");
  ok('首次打开自动播种（seed 标记 + 至少一个梦角卡片）', hero && hero.seeded && hero.cards >= 1, hero);
  ok('此刻时辰细分已渲染（初/正）', hero && /^[子丑寅卯辰巳午未申酉戌亥][初正]$/.test(hero.hero), hero && hero.hero);
  ok('今日时间轴渲染 12 行', hero && hero.todayRows === 12, hero && hero.todayRows);
  ok('有梦角时空态提示隐藏', hero && hero.emptyHidden, hero && hero.emptyHidden);
  const bar = await evalJs("(function () { const b = document.getElementById('cj-groups'); if (!b) return null; const cs = Array.prototype.map.call(b.querySelectorAll('.cj-gchip'), function (x) { return x.textContent; }); return { n: cs.length, labels: cs, on: (b.querySelector('.cj-gchip.on') || {}).textContent }; })()");
  // #615：「全部」固定居首（原排在末尾，桌面多了要横滑到底才点得到）
  ok('桌面分组条渲染（「全部」居首 + 各桌面 chips，当前桌面高亮）', bar && bar.n === 2 && bar.labels[0] === '全部' && bar.on !== '全部' && bar.on === bar.labels[bar.labels.length - 1], bar);
  // v3.14.x 回归：新梦角初始状态必须落盘，30s 心跳重渲染不得重抽
  const persist = await evalJs("(function () { const cid = window.__activeCid || 'default'; const P = 'xy-home-v2:' + cid + ':'; const r = JSON.parse(localStorage.getItem(P + 'cjian-roster') || '[]'); const id = r[0] && r[0].id; const st1 = JSON.parse(localStorage.getItem(P + 'cjian-state') || '{}'); if (!id || !st1[id]) return { hasState: false }; const before = st1[id].p + '|' + st1[id].a; window.renderCjian(false); const st2 = JSON.parse(localStorage.getItem(P + 'cjian-state') || '{}'); return { hasState: true, same: st2[id].p + '|' + st2[id].a === before, sinceKept: st2[id].sinceP === st1[id].sinceP }; })()");
  ok('新梦角初始状态已落盘（30s 重渲染不重抽、时间戳稳定）', persist && persist.hasState && persist.same && persist.sinceKept, persist);

  console.log('\n== T2b 分组切换与「全部」总览 ==');
  await evalJs("(function () { window.createContact('小柒'); return true; })()");
  await evalJs("window.openCjian(); true");
  await sleep(250);
  const bar2 = await evalJs("(function () { const b = document.getElementById('cj-groups'); return Array.prototype.map.call(b.querySelectorAll('.cj-gchip'), function (x) { return x.textContent; }); })()");
  ok('新桌面的梦角出现在分组条（「全部」居首 + 含「小柒」）', bar2 && bar2.length === 3 && bar2.indexOf('小柒') >= 0 && bar2[0] === '全部', bar2);
  // 点「小柒」直接切换查看别的桌面的梦角（自动播种，名字取该桌 TA）
  await evalJs("(function () { const cs = document.querySelectorAll('#cj-groups .cj-gchip'); for (let i = 0; i < cs.length; i++) { if (cs[i].textContent === '小柒') { cs[i].click(); break; } } return true; })()");
  await sleep(200);
  const grp = await evalJs("(function () { return { names: Array.prototype.map.call(document.querySelectorAll('#cj-list .cj-card-name'), function (x) { return x.textContent; }), rows: document.querySelectorAll('#cj-today .cj-today-row').length }; })()");
  ok('点「小柒」chip 直接切到该桌梦角（自动播种且名字=该桌TA）', grp && grp.names.length === 1 && grp.names[0] === '小柒' && grp.rows === 12, grp);
  // 「全部」总览：按桌面分组一次看完全部梦角状态
  await evalJs("(function () { const cs = document.querySelectorAll('#cj-groups .cj-gchip'); for (let i = 0; i < cs.length; i++) { if (cs[i].textContent === '全部') { cs[i].click(); break; } } return true; })()");
  await sleep(200);
  const all = await evalJs("(function () { return { heads: Array.prototype.map.call(document.querySelectorAll('#cj-list .cj-group-head'), function (x) { return x.textContent; }), cards: document.querySelectorAll('#cj-list .cj-card').length, emptyHidden: document.getElementById('cj-empty').hidden }; })()");
  ok('「全部」总览按桌面分组（两个分组头）', all && all.heads.length === 2 && all.heads[1].indexOf('小柒') >= 0, all);
  ok('「全部」总览同时显示所有桌面的梦角卡片', all && all.cards === 2 && all.emptyHidden, all);
  // 切回当前桌面（#615 起 cs[0] 是「全部」，当前桌面 chip 在其后一位）
  await evalJs("(function () { const cs = document.querySelectorAll('#cj-groups .cj-gchip'); if (cs.length > 1) cs[1].click(); return true; })()");
  await sleep(200);

  console.log('\n== T3 时间引擎 ==');
  const timeTests = await evalJs("(function () { const cur = document.getElementById('cj-hero-time').textContent; const rows = document.querySelectorAll('#cj-today .cj-today-name'); const firstRow = rows.length ? rows[0].textContent : ''; const rangeText = document.getElementById('cj-hero-range').textContent; return { cur: cur, firstRow: firstRow, rangeText: rangeText }; })()");
  ok('今日轴从当前时辰开始（首行=当前时辰）', timeTests && timeTests.firstRow === timeTests.cur.charAt(0) + '时', timeTests);
  ok('hero 副行含细分时刻区间', timeTests && /\d{2}:\d{2}–\d{2}:\d{2}/.test(timeTests.rangeText), timeTests && timeTests.rangeText);

  console.log('\n== T4 状态双维 ==');
  const tags = await evalJs("(function () { const t = document.querySelector('#cj-list .cj-card-tags'); if (!t) return null; return Array.prototype.map.call(t.querySelectorAll('.cj-tag'), function (x) { return x.textContent; }); })()");
  ok('梦角卡片显示在场+空闲两个状态', tags && tags.length === 2, tags);
  const pLabels = ['很近', '附近', '遥远', '感觉不到', '离开'];
  const aLabels = ['有空', '有事', '忙着', '休息', '睡着', '未知'];
  ok('在场标签在预设内', tags && pLabels.indexOf(tags[0]) >= 0, tags && tags[0]);
  ok('空闲标签在预设内', tags && aLabels.indexOf(tags[1]) >= 0, tags && tags[1]);

  console.log('\n== T5 感知此间 ==');
  await evalJs("window.cjianPerceive(); true");
  await sleep(50);
  const second = await evalJs("window.cjianPerceive()");
  ok('连续感知被冷却拦截（4s 内返回空）', second === null || second === undefined, second);
  await sleep(4200);
  const per = await evalJs("window.cjianPerceive()");
  ok('感知输出结构（lines 数组）', per && Array.isArray(per.lines) && per.lines.length >= 2, per && per.lines);
  ok('感知文案符合世界观（不保证有人在/不代表不在）', per && per.lines.join('').indexOf('在') >= 0, per && per.lines.join(''));
  await evalJs("window.renderCjian(true); true");

  console.log('\n== T6 刷新机制=随机选择（冷却门） ==');
  // 冷却没过：状态与时间戳都不动
  const cold = await evalJs("(function () { const cid = window.__activeCid || 'default'; const P = 'xy-home-v2:' + cid + ':'; const st = JSON.parse(localStorage.getItem(P + 'cjian-state') || '{}'); const roster = JSON.parse(localStorage.getItem(P + 'cjian-roster') || '[]'); const c = roster[0]; const s = st[c.id]; s.sinceP = Date.now(); s.cdP = 40 * 60000; s.sinceA = Date.now(); s.cdA = 20 * 60000; const beforeP = s.p, beforeA = s.a, beforeTs = s.sinceP; localStorage.setItem(P + 'cjian-state', JSON.stringify(st)); window.cjianRefresh(); const st2 = JSON.parse(localStorage.getItem(P + 'cjian-state') || '{}'); return { sameP: st2[c.id].p === beforeP, sameA: st2[c.id].a === beforeA, tsUnchanged: st2[c.id].sinceP === beforeTs }; })()");
  ok('冷却未过 → 梦角不重新选择（状态与时间戳保持不变）', cold && cold.sameP && cold.sameA && cold.tsUnchanged, cold);
  // 冷却过了：重新随机选择（sinceP 时间戳更新为新）
  const warm = await evalJs("(function () { const cid = window.__activeCid || 'default'; const P = 'xy-home-v2:' + cid + ':'; const st = JSON.parse(localStorage.getItem(P + 'cjian-state') || '{}'); const roster = JSON.parse(localStorage.getItem(P + 'cjian-roster') || '[]'); const c = roster[0]; const s = st[c.id]; s.sinceP = Date.now() - 3 * 3600 * 1000; s.cdP = 1; localStorage.setItem(P + 'cjian-state', JSON.stringify(st)); window.cjianRefresh(); const st2 = JSON.parse(localStorage.getItem(P + 'cjian-state') || '{}'); return { tsFresh: st2[c.id].sinceP >= Date.now() - 5000, cdReset: st2[c.id].cdP >= 20 * 60000 }; })()");
  ok('冷却已过 → 梦角重新随机选择（时间戳更新+冷却重置）', warm && warm.tsFresh && warm.cdReset, warm);

  console.log('\n== T7 今日轴预测 ==');
  const pred = await evalJs("(function () { const rows = document.querySelectorAll('#cj-today .cj-today-row'); if (!rows.length) return null; const r = rows[0].querySelector('.cj-today-c'); return { text: r.textContent, nRows: rows.length }; })()");
  ok('今日轴 12 行', pred && pred.nRows === 12, pred);
  ok('预测文案为可能性表述（可能在/未知/尚不可知）', pred && /可能|未知|尚不可知|在远处|离开/.test(pred.text), pred && pred.text);
  // 再次打开重新随机选择：不报错且机制存在
  const reopen = await evalJs("(function () { try { window.openCjian(); return { ok: true, rows: document.querySelectorAll('#cj-today .cj-today-row').length }; } catch (e) { return { ok: false, err: String(e) }; } })()");
  ok('再次打开可重新随机选择（不报错，仍 12 行）', reopen && reopen.ok && reopen.rows === 12, reopen);

  console.log('\n== T8 梦角管理（含独立时间流） ==');
  await evalJs("window.cjianManage(); true");
  await sleep(150);
  const mg1 = await evalJs("(function () { return Array.prototype.map.call(document.querySelectorAll('#modal-pills .pill'), function (b) { return b.textContent; }); })()");
  // 2026-09-16：#611 期望值同步——此间动作菜单自 v3.16.x 起为四项（含「时辰区间」）。
  // 档案页入口只做名单（三项）由 tools/verify-narc-manage-arc.mjs 覆盖，不在本脚本口径内。
  ok('管理弹窗四选项（添加/时辰区间/改名/删除）——单桌视图直接进动作阶段', mg1 && mg1.join('|') === '添加梦角|时辰区间|改名|删除梦角', mg1);
  await evalJs("Array.prototype.find.call(document.querySelectorAll('#modal-pills .pill'), function (b) { return b.textContent === '添加梦角'; }).click(); document.getElementById('modal-ok').click(); true");
  await sleep(120);
  const add1 = await evalJs("(function () { return { title: document.getElementById('modal-title').textContent, hasInput: document.getElementById('modal-input').hidden === false }; })()");
  ok('添加第一步：弹窗切到输入名字', add1 && add1.title.indexOf('添加梦角') >= 0 && add1.hasInput, add1);
  await evalJs("(function () { const i = document.getElementById('modal-input'); i.value = '那刻夏'; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('modal-ok').click(); true; })()");
  await sleep(120);
  const add2 = await evalJs("(function () { return { title: document.getElementById('modal-title').textContent, pills: Array.prototype.map.call(document.querySelectorAll('#modal-pills .pill'), function (b) { return b.textContent; }) }; })()");
  ok('添加第二步：时间偏移胶囊（含「独立时间流」）', add2 && add2.title.indexOf('那刻夏') >= 0 && add2.pills.indexOf('独立时间流') >= 0 && add2.pills.indexOf('与现实同步') >= 0, add2);
  await evalJs("Array.prototype.find.call(document.querySelectorAll('#modal-pills .pill'), function (b) { return b.textContent === '独立时间流'; }).click(); document.getElementById('modal-ok').click(); true");
  await sleep(200);
  const names = await evalJs("Array.prototype.map.call(document.querySelectorAll('#cj-list .cj-card-name'), function (x) { return x.textContent; })");
  ok('添加完成（独立时间流）：梦角出现在列表', names && names.indexOf('那刻夏') >= 0, names);
  // 独立时间流应生成非整点偏移（独立于现实）
  const roOff = await evalJs("(function () { const cid = window.__activeCid || 'default'; const r = JSON.parse(localStorage.getItem('xy-home-v2:' + cid + ':cjian-roster') || '[]'); const c = r.find(function (x) { return x.name === '那刻夏'; }); return c ? c.offsetMin : null; })()");
  ok('独立时间流 = 非整点随机偏移', typeof roOff === 'number' && roOff % 60 !== 0, roOff);

  console.log('\n== T8b 详情上一位/下一位（#786a：翻页范围跟随当前视图） ==');
  // 此刻处于单桌面视图（当前桌 default 的名单），另一桌面「小柒」的梦角不属于本视图
  const nCards = await evalJs("document.querySelectorAll('#cj-list .cj-card').length");
  await evalJs("(function () { const card = document.querySelector('#cj-list .cj-card'); if (card) card.click(); return true; })()");
  await sleep(150);
  const dnav1 = await evalJs("(function () { return { shown: !document.getElementById('cj-detail').hidden, name: (document.querySelector('.cj-d-name') || {}).textContent, pos: (document.querySelector('.cj-d-nav-pos') || {}).textContent, src: (document.querySelector('.cj-d-src') || {}).textContent }; })()");
  ok('详情来源标签＝当前桌面（不再挂着别桌的名字）', dnav1 && dnav1.shown && dnav1.src === '来自「默认」的此间', dnav1);
  ok('位次分母＝本桌卡片数（翻页范围不越出当前视图）', dnav1 && (!dnav1.pos ? nCards <= 1 : Number(String(dnav1.pos).split('/')[1]) === nCards), { pos: dnav1 && dnav1.pos, nCards: nCards });
  const stay = await evalJs("(function () { var out = []; for (var i = 0; i < 4; i++) { var bs = document.querySelectorAll('.cj-d-nav-btn'); if (!bs.length) break; bs[bs.length - 1].click(); var nm = document.querySelector('.cj-d-name'); out.push(nm ? nm.textContent : '?'); } return out; })()");
  await sleep(120);
  ok('单桌视图连按「下一位」不越出本桌（旧实现翻到别桌「小柒」＝用户报的串名）', (stay || []).every(function (n) { return n !== '小柒'; }), stay);
  await evalJs("(function () { document.getElementById('cj-detail-back').click(); return true; })()");
  await sleep(120);
  // 「全部」总览照旧跨桌面：从第一张卡连按下一位应见到别桌的「小柒」
  await evalJs("(function () { const cs = document.querySelectorAll('#cj-groups .cj-gchip'); for (let i = 0; i < cs.length; i++) { if (cs[i].textContent === '全部') { cs[i].click(); break; } } return true; })()");
  await sleep(200);
  await evalJs("(function () { const card = document.querySelector('#cj-list .cj-card'); if (card) card.click(); return true; })()");
  await sleep(150);
  const walkAll = await evalJs("(function () { var out = []; for (var i = 0; i < 5; i++) { var bs = document.querySelectorAll('.cj-d-nav-btn'); if (!bs.length) break; bs[bs.length - 1].click(); var nm = document.querySelector('.cj-d-name'); out.push(nm ? nm.textContent : '?'); } return out; })()");
  await sleep(120);
  ok('「全部」总览详情翻页仍跨桌面（能翻到小柒）', (walkAll || []).indexOf('小柒') >= 0, walkAll);
  await evalJs("(function () { document.getElementById('cj-detail-back').click(); return true; })()");
  // 切回当前桌面（下方 T8c 改名/删除按单桌视图口径）
  await evalJs("(function () { const cs = document.querySelectorAll('#cj-groups .cj-gchip'); if (cs.length > 1) cs[1].click(); return true; })()");
  await sleep(200);

  console.log('\n== T8c 改名/删除（作用于当前桌面名单） ==');
  await evalJs("window.cjianManage(); true");
  await sleep(120);
  await evalJs("Array.prototype.find.call(document.querySelectorAll('#modal-pills .pill'), function (b) { return b.textContent === '改名'; }).click(); document.getElementById('modal-ok').click(); true");
  await sleep(120);
  await evalJs("(function () { const p = Array.prototype.find.call(document.querySelectorAll('#modal-pills .pill'), function (b) { return b.textContent === '那刻夏'; }); if (p) p.click(); document.getElementById('modal-ok').click(); true; })()");
  await sleep(120);
  const rn1 = await evalJs("(function () { return { title: document.getElementById('modal-title').textContent, hasInput: document.getElementById('modal-input').hidden === false }; })()");
  ok('改名：切到输入新名字', rn1 && rn1.title.indexOf('那刻夏') >= 0 && rn1.hasInput, rn1);
  await evalJs("(function () { const i = document.getElementById('modal-input'); i.value = '那刻夏·改'; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('modal-ok').click(); true; })()");
  await sleep(200);
  const names2 = await evalJs("Array.prototype.map.call(document.querySelectorAll('#cj-list .cj-card-name'), function (x) { return x.textContent; })");
  ok('改名完成：列表出现新名字', names2 && names2.indexOf('那刻夏·改') >= 0, names2);
  await evalJs("window.cjianManage(); true");
  await sleep(120);
  await evalJs("Array.prototype.find.call(document.querySelectorAll('#modal-pills .pill'), function (b) { return b.textContent === '删除梦角'; }).click(); document.getElementById('modal-ok').click(); true");
  await sleep(120);
  await evalJs("(function () { const p = Array.prototype.find.call(document.querySelectorAll('#modal-pills .pill'), function (b) { return b.textContent === '那刻夏·改'; }); if (p) p.click(); document.getElementById('modal-ok').click(); true; })()");
  await sleep(200);
  const names3 = await evalJs("Array.prototype.map.call(document.querySelectorAll('#cj-list .cj-card-name'), function (x) { return x.textContent; })");
  ok('删除完成：梦角离开列表', names3 && names3.indexOf('那刻夏·改') < 0, names3);

  console.log('\n== T9 梦角详情（TA 的一天） ==');
  const detailOpen = await evalJs("(function () { const card = document.querySelector('#cj-list .cj-card'); if (!card) return { ok: false }; card.click(); return { ok: true }; })()");
  await sleep(150);
  const detail = await evalJs("(function () { return { detailShown: !document.getElementById('cj-detail').hidden, mainHidden: document.getElementById('cj-main').hidden, name: (document.querySelector('.cj-d-name') || {}).textContent, rows: document.querySelectorAll('.cj-d-row').length, offset: (document.querySelector('.cj-d-offset') || {}).textContent }; })()");
  ok('点梦角卡片进入详情（主列表隐藏）', detail && detail.detailShown && detail.mainHidden, detail);
  ok('详情显示梦角名 + 偏移标签', detail && !!detail.name && !!detail.offset, detail);
  ok('详情显示 TA 的今日 12 时辰轨迹', detail && detail.rows === 12, detail && detail.rows);
  await evalJs("document.getElementById('cj-detail-back').click(); true");
  await sleep(120);
  const detailBack = await evalJs("(function () { return { detailHidden: document.getElementById('cj-detail').hidden, mainShown: !document.getElementById('cj-main').hidden }; })()");
  ok('详情可返回列表', detailBack && detailBack.detailHidden && detailBack.mainShown, detailBack);

  console.log('\n== T9b 总览模式下管理先进「选桌面」 ==');
  await evalJs("(function () { const cs = document.querySelectorAll('#cj-groups .cj-gchip'); for (let i = 0; i < cs.length; i++) { if (cs[i].textContent === '全部') { cs[i].click(); break; } } return true; })()");
  await sleep(200);
  await evalJs("window.cjianManage(); true");
  await sleep(150);
  const pick = await evalJs("(function () { return Array.prototype.map.call(document.querySelectorAll('#modal-pills .pill'), function (b) { return b.textContent; }); })()");
  ok('总览模式打开管理：先选桌面（列出各桌面名）', pick && pick.indexOf('小柒') >= 0 && pick.indexOf('添加梦角') < 0, pick);
  await evalJs("(function () { const p = Array.prototype.find.call(document.querySelectorAll('#modal-pills .pill'), function (b) { return b.textContent === '小柒'; }); if (p) p.click(); document.getElementById('modal-ok').click(); true; })()");
  await sleep(120);
  const act = await evalJs("(function () { return { title: document.getElementById('modal-title').textContent, pills: Array.prototype.map.call(document.querySelectorAll('#modal-pills .pill'), function (b) { return b.textContent; }) }; })()");
  ok('选定桌面后进入该桌的动作菜单', act && act.title.indexOf('小柒') >= 0 && act.pills.join('|') === '添加梦角|时辰区间|改名|删除梦角', act);
  await evalJs("Array.prototype.find.call(document.querySelectorAll('#modal-pills .pill'), function (b) { return b.textContent === '删除梦角'; }).click(); document.getElementById('modal-ok').click(); true");
  await sleep(120);
  await evalJs("(function () { const ps = document.querySelectorAll('#modal-pills .pill'); if (ps.length === 1) ps[0].click(); document.getElementById('modal-ok').click(); true; })()");
  await sleep(200);
  const delCheck = await evalJs("(function () { const c = window.getContacts().find(function (x) { return x.name === '小柒'; }); const r = JSON.parse(localStorage.getItem('xy-home-v2:' + c.id + ':cjian-roster') || '[]'); return { left: r.length, emptyTip: (document.querySelector('#cj-list .cj-group-empty') || {}).textContent }; })()");
  ok('删除作用于所选桌面自己的名单（小柒桌清空并提示空态）', delCheck && delCheck.left === 0 && String(delCheck.emptyTip || '').indexOf('还没有梦角') >= 0, delCheck);

  console.log('\n== T10 突然靠近 ==');
  await evalJs("(function () { const cid = window.__activeCid || 'default'; const P = 'xy-home-v2:' + cid + ':'; const st = JSON.parse(localStorage.getItem(P + 'cjian-state') || '{}'); const roster = JSON.parse(localStorage.getItem(P + 'cjian-roster') || '[]'); if (!roster.length) return false; const c = roster[0]; const s = st[c.id] || {}; s.sinceP = Date.now() - 2 * 3600 * 1000; st[c.id] = s; localStorage.setItem(P + 'cjian-state', JSON.stringify(st)); return true; })()");
  const tickOk = await evalJs("(function () { try { window.cjianRefresh(); window.cjianPerceive(); return true; } catch (e) { return String(e); } })()");
  ok('状态更新/感知路径不报错', tickOk === true, tickOk);

  console.log('\n== T11 聊天互动钩子 ==');
  const hook = await evalJs("(function () { window.cjianNoteChat(); const cid = window.__activeCid || 'default'; const st = JSON.parse(localStorage.getItem('xy-home-v2:' + cid + ':cjian-state') || '{}'); return typeof st.__chat === 'number'; })()");
  ok('发送消息后 cjianNoteChat 打点（当前桌面命名空间）', hook === true, hook);

  console.log('\n== T12 返回聊天 ==');
  await evalJs("document.getElementById('cj-back').click(); true");
  await sleep(150);
  const back = await evalJs("(function () { return { chatOpen: !document.getElementById('page-chat').hidden, cjianHidden: document.getElementById('page-cjian').hidden }; })()");
  ok('返回聊天页（来源 chat）', back && back.chatOpen && back.cjianHidden, back);

  console.log('\n== T13 无 JS 异常 ==');
  ok('加载与操作全程无未捕获异常', jsErrors.length === 0, jsErrors.slice(0, 3));

  console.log('\n结果: ' + pass + '/' + (pass + fail) + ' 项通过');
  process.exitCode = fail ? 1 : 0;
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
