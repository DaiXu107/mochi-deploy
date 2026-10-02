// 五子棋动画行为断言（#341）：落子压下回弹 / 最后一手红点闪烁 / 胜利连线逐颗点亮+
// 余子退暗+结果浮层延迟弹出 / 悔棋退场缩没。逻辑（落子/胜负/悔棋/战绩）零改动断言。
// 用法：node tools/verify-gomoku-anim.mjs [页面.html]（默认 index.html，需先构建；
//      也可喂临时拼装页做免构建验证）。
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const target = process.argv[2] || 'index.html';
let url = target;
if (!/^https?:/.test(target)) {
  const { pathToFileURL } = await import('url');
  url = pathToFileURL(target).href;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

await page.goto(url);
await page.waitForFunction(() => typeof window.openGomokuPanel === 'function', null, { timeout: 15000 });
// 真实产物启动引导：过开屏 → 只显示聊天页 → 打开五子棋面板（临时拼装页两步自动跳过）
await page.evaluate(() => { try { const s = document.getElementById('splash'); if (s) s.click(); } catch (e) {} });
await page.waitForTimeout(800);
await page.evaluate(() => {
  document.querySelectorAll('.page').forEach((p) => { p.hidden = (p.id !== 'page-chat'); });
  window.openGomokuPanel();
});
// 先手固定为玩家（每联系人战绩键决定 nextFirst）
await page.evaluate(() => {
  const pk = (window.activePrefix ? window.activePrefix() : 'xy-home-v2') + ':gomoku-stats';
  try { localStorage.setItem(pk, JSON.stringify({ w: 0, l: 0, d: 0, nextFirst: 'you', lastDiff: 'daily' })); } catch (e) {}
});

// A 布局形态 + 落子动画：开局 → 玩家落一子
await page.evaluate(() => { document.getElementById('gk-btn-start').click(); });
await page.waitForFunction(() => window.__gkDebug && window.__gkDebug.st() && window.__gkDebug.st().started && window.__gkDebug.st().turn === 1, null, { timeout: 5000 });
const cells = await page.evaluate(() => document.querySelectorAll('#gk-board .gk-cell').length);
check('A0 棋盘 11×11=121 格', cells === 121, 'cells=' + cells);

await page.evaluate(() => { window.__gkDebug.fast = true; }); // TA 思考提速，本断言只看落子动画载体
await page.evaluate(() => { document.querySelector('#gk-board .gk-cell[data-r="5"][data-c="5"]').click(); });
const drop = await page.evaluate(() => {
  const cell = document.querySelector('#gk-board .gk-cell[data-r="5"][data-c="5"]');
  const s = cell.querySelector('.gk-stone');
  if (!s) return null;
  return {
    cls: s.className,
    anim: getComputedStyle(s).animationName,
    last: s.classList.contains('gk-last'),
    lastAnim: getComputedStyle(s, '::after').animationName
  };
});
check('A1 玩家落子石带 gk-drop 且 animation=gk-drop', !!drop && /gk-drop/.test(drop.cls) && drop.anim === 'gk-drop', drop && drop.anim);
check('A2 最后一手标记在玩家石上', !!drop && drop.last);
check('A3 最后一手红点带闪烁动画', !!drop && drop.lastAnim === 'gk-last-blink', drop && drop.lastAnim);

// B TA 接续落子：同样有落子动画，gk-last 转移到 TA 石
await page.waitForFunction(() => window.__gkDebug.st().turn === 1 && window.__gkDebug.st().moves >= 2, null, { timeout: 8000 });
const taStone = await page.evaluate(() => {
  const s = document.querySelector('#gk-board .gk-stone.gk-ta');
  return s ? { cls: s.className, last: s.classList.contains('gk-last') } : null;
});
check('B1 TA 落子石同样带 gk-drop', !!taStone && /gk-drop/.test(taStone.cls), taStone && taStone.cls);
check('B2 gk-last 已转移到 TA 石', !!taStone && taStone.last);

// C 胜利连线：造玩家四连 + 点击成五 → 连线逐颗点亮、余子退暗、浮层延迟弹出
await page.evaluate(() => {
  const pk = (window.activePrefix ? window.activePrefix() : 'xy-home-v2') + ':gomoku-stats';
  try { localStorage.setItem(pk, JSON.stringify({ w: 0, l: 0, d: 0, nextFirst: 'you', lastDiff: 'daily' })); } catch (e) {}
  window.__gkDebug.fast = false;               // 本段量浮层延迟，不提速
  window.__gkDebug.newGame();                  // 清盘重开（顺带断言 gk-dim 不残留）
  const st = window.__gkDebug.st();
  // 逻辑盘面造四连（0,0)~(0,3)，并按 drawStone 产物补 DOM 棋子（无 gk-drop，保持断言干净）
  for (let c = 0; c < 4; c++) {
    st.grid[0][c] = 1;
    const cell = document.querySelector('#gk-board .gk-cell[data-r="0"][data-c="' + c + '"]');
    const s = document.createElement('span');
    s.className = 'gk-stone gk-you';
    cell.appendChild(s);
  }
  st.moves = 4;                                // 种子 4 子补计手数，成五后共 5 手
  document.querySelector('#gk-board .gk-cell[data-r="0"][data-c="4"]').click();
});
await page.waitForTimeout(150); // 延迟 1s 内：浮层必须还没弹
const cEarly = await page.evaluate(() => {
  const ov = document.getElementById('gk-overlay');
  const board = document.getElementById('gk-board');
  const wins = [...board.querySelectorAll('.gk-stone.gk-win')];
  return {
    ovHidden: ov.hidden,
    dim: board.classList.contains('gk-dim'),
    nWin: wins.length,
    idx: wins.map((s) => s.style.getPropertyValue('--gk-win-i')).join(','),
    anim: wins.length ? getComputedStyle(wins[0]).animationName : ''
  };
});
check('C1 点击成五后浮层未立刻弹出（延迟生效）', cEarly.ovHidden === true);
check('C2 棋盘 gk-dim（余子退暗衬托）', cEarly.dim === true);
check('C3 连线 5 石全部 gk-win', cEarly.nWin === 5, 'n=' + cEarly.nWin);
check('C4 逐颗点亮 stagger 序号 0..4', cEarly.idx === '0,1,2,3,4', cEarly.idx);
check('C5 连线石点亮动画 gk-win-pulse', cEarly.anim === 'gk-win-pulse', cEarly.anim);
await page.waitForFunction(() => !document.getElementById('gk-overlay').hidden, null, { timeout: 4000 });
const cBody = await page.evaluate(() => document.getElementById('gk-ov-body').textContent);
check('C6 连线播完后结果浮层弹出且计手正确', /本局共 5 手/.test(cBody), cBody.slice(0, 40));

// D 悔棋退场：重开 → 玩家+TA 各一手 → 悔棋 → 两石缩没 → 摘除后棋盘无石、无 gk-dim 残留
await page.evaluate(() => {
  const pk = (window.activePrefix ? window.activePrefix() : 'xy-home-v2') + ':gomoku-stats';
  try { localStorage.setItem(pk, JSON.stringify({ w: 0, l: 0, d: 0, nextFirst: 'you', lastDiff: 'daily' })); } catch (e) {}
  window.__gkDebug.fast = true;
  window.__gkDebug.newGame();
});
await page.waitForFunction(() => window.__gkDebug.st().turn === 1 && window.__gkDebug.st().moves === 0, null, { timeout: 5000 });
await page.evaluate(() => { document.querySelector('#gk-board .gk-cell[data-r="2"][data-c="2"]').click(); });
await page.waitForFunction(() => window.__gkDebug.st().turn === 1 && window.__gkDebug.st().moves >= 2, null, { timeout: 8000 });
const dState = await page.evaluate(() => {
  const board = document.getElementById('gk-board');
  return {
    dimResidue: board.classList.contains('gk-dim'),
    stonesBefore: board.querySelectorAll('.gk-stone').length,
    movesBefore: window.__gkDebug.st().moves
  };
});
check('D0 重开后棋盘无 gk-dim 残留', dState.dimResidue === false);
// 悔棋段用真实速率（fast 的摘除定时器 ~40ms，采样会扑空）：先关 fast 再点悔棋
await page.evaluate(() => { window.__gkDebug.fast = false; document.getElementById('gk-undo').click(); });
await page.waitForTimeout(60);
const dVanish = await page.evaluate(() => ({
  vanish: document.querySelectorAll('#gk-board .gk-stone.gk-vanish').length,
  moves: window.__gkDebug.st().moves,
  gridZero: window.__gkDebug.st().grid[2][2] === 0
}));
check('D1 悔棋后两石进入退场动画（gk-vanish）', dVanish.vanish === 2, 'n=' + dVanish.vanish);
check('D2 悔棋逻辑即时生效（回退 2 手、格清零）', dVanish.moves === dState.movesBefore - 2 && dVanish.gridZero);
await page.waitForTimeout(500);
const dAfter = await page.evaluate(() => document.querySelectorAll('#gk-board .gk-stone').length);
check('D3 退场动画播完后棋盘无残石', dAfter === 0, 'n=' + dAfter);
check('E0 全程零 JS 报错', errors.length === 0, errors.join(' | ').slice(0, 200));

await browser.close();
console.log('verify-gomoku-anim: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
