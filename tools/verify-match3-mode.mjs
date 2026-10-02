// ===== 验证 #453：消消乐模式拆分（默认简单无道具 / 可选道具模式）=====
// 内存拼装 src（与 build.mjs 同序、不写产物）→ 无头 Chrome 实测：
//   A 模式 UI（m3-mode 默认 simple、开局 overlay 说明随模式、lastMode 持久化+重开恢复）
//   B 简单模式确定性构造四连交换 → 零道具生成（st.genSpecial===null 且全盘无特殊值）
//   C 道具模式：横四连→line-h / 竖四连→line-v / L·T 同色交叉→bomb / 五连→rainbow
//   D 直线道具行为（clearWithSpecials 纯函数）：↔️清整行 / ↕️清整列 / 直线扫中炸弹连锁引爆
//   E isRainbow 值域修正：直线道具 30+/40+ 不被判成彩虹、allMoves 不吞直线道具
// 棋盘用「条纹底板 (r*3+c)%6」确定性构造（底板无既有三连），fast 模式秒结动画。
// 用法：node tools/verify-match3-mode.mjs（需 playwright 可用，不依赖构建产物）。
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, normalize, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');

// —— 与 build.mjs 同序内存拼装（不写产物）；每文件独立 try/catch 包裹同 build 语义（单文件抛错不连坐） ——
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const arr = (name) => new Function('return ' + bm.match(new RegExp('const ' + name + ' = (\\[.*?\\]);', 's'))[1])();
const css = arr('cssFiles').map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
const js = arr('jsFiles').map((f) => {
  const code = readFileSync(join(root, 'src', 'js', f), 'utf8');
  return '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} } })();';
}).join('\n');
let html = readFileSync(join(root, 'src', 'template.html'), 'utf8').replace('__APP_VERSION__', 'v3.26.0-test');
html = html.replace('</head>', '<style>' + css + '</style></head>');
html = html.replace('</body>', '<script>' + js + '<\/script></body>');
const tmpPage = join(tmpdir(), 'mochi-m3-mode-test-' + Date.now() + '.html');
writeFileSync(tmpPage, html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
const cons = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') cons.push(m.text().slice(0, 160)); });

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

async function setMode(v) {
  await page.evaluate((val) => {
    const m = document.getElementById('m3-mode');
    m.value = val; m.dispatchEvent(new Event('change'));
  }, v);
}
async function reopenPanel() {
  await page.evaluate(() => { window.closeMatch3Panel(); window.openMatch3Panel(); });
}
async function waitDealDone() {
  await page.waitForFunction(() => window.__m3Debug.st() && window.__m3Debug.st().started && !window.__m3Debug.st().lock, null, { timeout: 8000 });
}
// 条纹底板 + overlay 直换 st.grid，直调 doSwap（绕过回合点击），fast 模式下等结算完成
async function runSwap(a, b, overlay) {
  await page.evaluate(([pa, pb, ov]) => {
    const d = window.__m3Debug;
    const g = [];
    for (let r = 0; r < 8; r++) { const row = []; for (let c = 0; c < 8; c++) row.push((r * 3 + c) % 6); g.push(row); }
    (ov || []).forEach((p) => { g[p[0]][p[1]] = p[2]; });
    d.st().grid = g;
    window.__m3LastSwap = null;
    d.doSwap(pa, pb, true, (ok, gain) => { window.__m3LastSwap = { ok: ok, gain: gain }; });
  }, [a, b, overlay]);
  await page.waitForFunction(() => window.__m3LastSwap && window.__m3Debug.st() && !window.__m3Debug.st().lock, null, { timeout: 8000 });
  return page.evaluate(() => ({ last: window.__m3LastSwap, gen: window.__m3Debug.st().genSpecial, grid: window.__m3Debug.st().grid }));
}
function maxSpecial(grid) {
  let m = 0;
  grid.forEach((row) => row.forEach((v) => { if (v >= 10 && v > m) m = v; }));
  return m;
}

await page.goto('file://' + tmpPage);
try {
  await page.waitForFunction(() => typeof window.openMatch3Panel === 'function', null, { timeout: 20000 });
} catch (e) {
  const probe = await page.evaluate(() => ({
    m3: typeof window.__m3Debug, idb: typeof window.idbSet, chat: typeof window.chatAddSystem,
    panelHidden: (document.getElementById('chat-match3-panel') || {}).hidden
  })).catch(() => ({}));
  console.error('拼装页加载失败：', JSON.stringify(probe), '\npageerrors:', errors.slice(0, 5).join(' | '), '\nconsole.errors:', cons.slice(0, 8).join(' | '));
  await browser.close();
  process.exit(1);
}
// 必须走 splash-enter（同 verify.mjs）：只点 #splash 不解除开屏，整棵 .phone 仍 visibility:hidden，
// 而 innerText 对隐形子树返回空串 → A2/A3 一直在读空说明文字判红（#1027 批同修）。
await page.evaluate(() => {
  const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
  const s = document.getElementById('splash'); if (s && !s.classList.contains('hide')) { s.classList.add('hide'); s.hidden = true; }
});
await page.waitForTimeout(800);
await page.evaluate(() => {
  document.querySelectorAll('.page').forEach((p) => { p.hidden = (p.id !== 'page-chat'); });
  window.openMatch3Panel();
});
await page.evaluate(() => { window.__m3Debug.fast = true; });

// ---- A 模式 UI（开局 overlay 随模式下拉实时切换；此刻无对局 → 走 showStartOverlay）----
const ui = await page.evaluate(() => ({
  has: !!document.getElementById('m3-mode'),
  val: (document.getElementById('m3-mode') || {}).value,
  note: (document.getElementById('m3-ov-body') || {}).innerText || ''
}));
check('A1 头部存在模式下拉且默认简单', ui.has && ui.val === 'simple', 'value=' + ui.val);
check('A2 简单模式开局说明标注「无道具」', /简单模式/.test(ui.note) && /无道具/.test(ui.note));

await setMode('item');
await reopenPanel();
const noteItem = await page.evaluate(() => (document.getElementById('m3-ov-body') || {}).innerText || '');
check('A3 道具模式开局说明列出三类道具', /道具模式/.test(noteItem) && /炸弹/.test(noteItem) && /彩虹/.test(noteItem) && /直线/.test(noteItem));

// A4 持久化回读：change 已把 lastMode 存档，重开面板应从战绩恢复下拉
await setMode('simple');
await reopenPanel();
const persist1 = await page.evaluate(() => {
  let key = null;
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(':match3-stats') >= 0) key = k; }
  let stats = null;
  try { stats = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) {}
  return { lastMode: stats && stats.lastMode, sel: document.getElementById('m3-mode').value };
});
check('A4 lastMode 存档并随重开面板恢复（回 simple）', persist1.lastMode === 'simple' && persist1.sel === 'simple', JSON.stringify(persist1));

// ---- B 简单模式：确定性四连交换也零道具 ----
await page.evaluate(() => { document.getElementById('m3-btn-start').click(); });
await waitDealDone();
check('B0 默认开局 st.mode=simple', await page.evaluate(() => window.__m3Debug.st().mode === 'simple'));
// 横四连板：row4 = [2,1,2,2,3,0,3,0]，(3,1) 埋 2，交换 (3,1)↔(4,1) 后 row4 c0..c3 成 2 的横四连
const H4_OVERLAY = [[4, 0, 2], [4, 2, 2], [4, 3, 2], [3, 1, 2]];
const rSimple = await runSwap([3, 1], [4, 1], H4_OVERLAY);
check('B1 简单模式四连交换有效消除', !!(rSimple.last && rSimple.last.ok === true), 'gain=' + (rSimple.last && rSimple.last.gain));
check('B2 简单模式零道具生成（genSpecial=null）', rSimple.gen === null, 'gen=' + rSimple.gen);
check('B3 简单模式结算后全盘无特殊值', maxSpecial(rSimple.grid) === 0, 'max=' + maxSpecial(rSimple.grid));

// ---- C 道具模式：三类道具生成 ----
await setMode('item');
await page.evaluate(() => window.__m3Debug.newGame());
await waitDealDone();
check('C0 切到道具模式后开局 st.mode=item', await page.evaluate(() => window.__m3Debug.st().mode === 'item'));

const rH = await runSwap([3, 1], [4, 1], H4_OVERLAY);
check('C1 道具模式横四连生成 ↔️ 直线道具（line-h）', rH.gen === 'line-h', 'gen=' + rH.gen);
check('C1b 生成物落在值域 30~35', rH.gen === 'line-h' && maxSpecial(rH.grid) >= 30 && maxSpecial(rH.grid) <= 35, 'max=' + maxSpecial(rH.grid));

// 竖四连：col1 = [2,4,2,2]（(1,1) 为洞），(1,0) 埋 2，交换 (1,0)↔(1,1)
const V4_OVERLAY = [[0, 1, 2], [2, 1, 2], [3, 1, 2], [1, 0, 2]];
const rV = await runSwap([1, 0], [1, 1], V4_OVERLAY);
check('C2 道具模式竖四连生成 ↕️ 直线道具（line-v）', rV.gen === 'line-v', 'gen=' + rV.gen);
check('C2b 生成物落在值域 40~45', rV.gen === 'line-v' && maxSpecial(rV.grid) >= 40 && maxSpecial(rV.grid) <= 45, 'max=' + maxSpecial(rV.grid));

// L/T：col3 rows2/3/5=4 + row4 c2/c4/c5=4，交换 (4,2)↔(4,3) 同时补齐竖四连+横三连（交叉于 (4,3)）
const LT_OVERLAY = [[2, 3, 4], [3, 3, 4], [5, 3, 4], [4, 2, 4], [4, 4, 4], [4, 5, 4]];
const rL = await runSwap([4, 2], [4, 3], LT_OVERLAY);
check('C3 道具模式 L/T 交叉生成 💥 炸弹（bomb）', rL.gen === 'bomb', 'gen=' + rL.gen);
check('C3b 生成物落在值域 10~15', rL.gen === 'bomb' && maxSpecial(rL.grid) >= 10 && maxSpecial(rL.grid) <= 15, 'max=' + maxSpecial(rL.grid));

// 五连：row4 c0..c4 全 2，(3,1) 埋 2 补洞 → rainbow 优先
const R5_OVERLAY = [[4, 0, 2], [4, 2, 2], [4, 3, 2], [4, 4, 2], [3, 1, 2]];
const rR = await runSwap([3, 1], [4, 1], R5_OVERLAY);
check('C4 道具模式五连生成 🌈 彩虹（rainbow）', rR.gen === 'rainbow', 'gen=' + rR.gen);

// ---- D 直线道具行为（纯函数 clearWithSpecials）----
const dLine = await page.evaluate(() => {
  const d = window.__m3Debug;
  const mk = () => { const g = []; for (let r = 0; r < 8; r++) { const row = []; for (let c = 0; c < 8; c++) row.push((r * 3 + c) % 6); g.push(row); } return g; };
  const gH = mk(); gH[2][3] = d.LINE_H; // ↔️ 在 (2,3)
  const cH = d.clearWithSpecials(gH, [[2, 3]]);
  const gV = mk(); gV[2][3] = d.LINE_V; // ↕️ 在 (2,3)
  const cV = d.clearWithSpecials(gV, [[2, 3]]);
  // 连锁：↔️(2,2) 清整行扫到 💥(2,7)，炸弹 3×3 应被连带引爆
  const gC = mk(); gC[2][2] = d.LINE_H; gC[2][7] = d.BOMB_BASE + 1;
  const cC = d.clearWithSpecials(gC, [[2, 2]]);
  const has = (arr2, p) => arr2.some((q) => q[0] === p[0] && q[1] === p[1]);
  return {
    rowFull: cH.length === 8 && cH.every((p) => p[0] === 2),
    colFull: cV.length === 8 && cV.every((p) => p[1] === 3),
    chainN: cC.length, chainBomb: has(cC, [1, 6]) && has(cC, [3, 7]) && has(cC, [2, 7])
  };
});
check('D1 ↔️ 被消除清整行（8 格）', dLine.rowFull === true);
check('D2 ↕️ 被消除清整列（8 格）', dLine.colFull === true);
check('D3 直线扫中炸弹连锁引爆（8+4=12 格）', dLine.chainN === 12 && dLine.chainBomb === true, 'n=' + dLine.chainN + ' bomb邻域=' + dLine.chainBomb);

// ---- E isRainbow 值域修正 + allMoves 不吞直线道具 ----
const e = await page.evaluate(() => {
  const d = window.__m3Debug;
  const g = [];
  for (let r = 0; r < 8; r++) { const row = []; for (let c = 0; c < 8; c++) row.push((r * 3 + c) % 6); g.push(row); }
  g[5][5] = d.LINE_H; g[6][6] = d.RAINBOW; g[5][6] = d.BOMB_BASE + 2;
  let moves;
  try { moves = d.allMoves(g); } catch (err) { return { throw: String(err) }; }
  return {
    rb: d.isRainbow(d.RAINBOW), rbH: d.isRainbow(d.LINE_H), rbV: d.isRainbow(d.LINE_V),
    colH: d.colorOf(d.LINE_H + 3), colV: d.colorOf(d.LINE_V + 2),
    moves: moves.length, throw: null
  };
});
check('E1 彩虹判定：20 是彩虹', e.rb === true);
check('E2 直线道具 30/40 不是彩虹（裸 >=RAINBOW 会误判）', e.rbH === false && e.rbV === false);
check('E3 直线道具按携带色参与匹配', e.colH === 3 && e.colV === 2);
check('E4 allMoves 含直线/炸弹棋盘不抛错且有解', e.throw === null && typeof e.moves === 'number', 'moves=' + e.moves + (e.throw ? ' err=' + e.throw : ''));

// ---- G #481 回归：TA 回合不得覆写 st.mode（道具开关）----
// 根因复现：#301 taTurn 曾把 TA 出手风格（serious/normal/sandbag/blunder）写进 st.mode，
// 与 #453 的道具开关 st.mode('item'/'simple') 撞名——TA 第一次行动后道具模式永远不再生成道具。
await page.evaluate(() => {
  const d = window.__m3Debug;
  const g = [];
  for (let r = 0; r < 8; r++) { const row = []; for (let c = 0; c < 8; c++) row.push((r * 3 + c) % 6); g.push(row); }
  // 埋一个保证有解的交换：g[4][0]=g[4][2]=2、g[5][1]=2 → TA 换 (5,1)↔(4,1) 凑横向三连（条纹底板本身无解，见 E4 moves=0）
  g[4][0] = 2; g[4][2] = 2; g[5][1] = 2;
  d.st().grid = g; d.st().score = 0; d.st().turn = 2; // 清分防误触结算、轮到 TA
  d.taTurn();
});
await page.waitForFunction(() => window.__m3Debug.st() && window.__m3Debug.st().turn === 1 && !window.__m3Debug.st().lock, null, { timeout: 8000 });
const gSt = await page.evaluate(() => ({ mode: window.__m3Debug.st().mode, ta: window.__m3Debug.st().taMode }));
check('G1 TA 行动后 st.mode 仍为 item（#481：出手风格走 taMode 独立字段）', gSt.mode === 'item', JSON.stringify(gSt));
check('G2 TA 出手风格记录在 taMode（四值之一）', ['serious', 'normal', 'sandbag', 'blunder'].indexOf(gSt.ta) >= 0, 'taMode=' + gSt.ta);

// ---- A5 对局结束后重开仍恢复上次模式（道具）----
await page.evaluate(() => {
  window.__m3Debug.st().started = false; // 模拟对局已结束，让 openMatch3Panel 走恢复分支
  window.closeMatch3Panel(); window.openMatch3Panel();
});
const persist2 = await page.evaluate(() => ({ sel: document.getElementById('m3-mode').value }));
check('A5 重开面板恢复上次模式（item）', persist2.sel === 'item', JSON.stringify(persist2));

check('F 全程零未捕获页面错误', errors.length === 0, errors.join(' | ').slice(0, 200));

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
await browser.close();
try { unlinkSync(tmpPage); } catch (e) {}
process.exit(fail ? 1 : 0);
