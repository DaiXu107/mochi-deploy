// 连连看动画行为断言（#341）：连线走线 SVG / 消除爆开（先演后清）/ 洗牌翻乱回摆 / 开局发牌 / 动画链锁不串步。
// 用法：node tools/verify-linkup-anim.mjs [页面.html]（默认 index.html，需先构建；
//      也可喂临时拼装页做免构建验证，同 verify-match3-anim 的做法）。
import { chromium } from 'playwright';

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
await page.waitForFunction(() => typeof window.openLinkupPanel === 'function', null, { timeout: 15000 });
// 真实启动引导：过开屏 → 只显示聊天页 → 打开连连看面板 → 开始对局（对齐 verify-match3-anim）
await page.evaluate(() => { try { const s = document.getElementById('splash'); if (s) s.click(); } catch (e) {} });
await page.waitForTimeout(800);
await page.evaluate(() => {
  document.querySelectorAll('.page').forEach((p) => { p.hidden = (p.id !== 'page-chat'); });
  window.openLinkupPanel();
});
await page.evaluate(() => { document.getElementById('lk-btn-start').click(); });
await page.waitForFunction(() => window.__lkDebug && window.__lkDebug.st() && window.__lkDebug.st().started, null, { timeout: 5000 });
await page.waitForTimeout(700); // 等开局发牌波次走完

// A 动画载体：棋盘可承载走线覆盖层 + 四套动画类在 CSS 里真正生效
const shape = await page.evaluate(() => {
  const b = document.getElementById('lk-board');
  const t = b.querySelector('.lk-tile');
  const mk = (cls) => { t.classList.add(cls); const n = getComputedStyle(t).animationName; t.classList.remove(cls); return n; };
  let hasPathRule = false;
  try {
    for (const ss of document.styleSheets) {
      for (const r of ss.cssRules) {
        if (r.selectorText && r.selectorText.indexOf('.lk-pathline') >= 0) hasPathRule = true;
      }
    }
  } catch (e) {}
  return {
    boardPos: getComputedStyle(b).position,
    pop: mk('lk-pop'), shufin: mk('lk-shufin'), shufout: mk('lk-shufout'), born: mk('lk-born'),
    hasPathRule
  };
});
check('A1 棋盘 position:relative（可承载走线 SVG）', shape.boardPos === 'relative', shape.boardPos);
check('A2 消除爆开动画类生效（lkpop）', shape.pop === 'lkpop', shape.pop);
check('A3 洗牌回摆动画类生效（lkshufin）', shape.shufin === 'lkshufin', shape.shufin);
check('A4 洗牌翻乱动画类生效（lkshufout）', shape.shufout === 'lkshufout', shape.shufout);
check('A5 开局发牌动画类生效（lkborn）', shape.born === 'lkborn', shape.born);
check('A6 连线走线规则在样式表（.lk-pathline）', shape.hasPathRule);

// B 玩家配对：出现连线 SVG（≥2 点）+ 爆开期间字还在（先演后清）→ 收尾 lk-gone 清字、锁解除、剩余 -2
const before = await page.evaluate(() => {
  const st = window.__lkDebug.st();
  const pairs = window.__lkDebug.allPairs(st);
  return pairs.length ? { remaining: st.remaining, a: pairs[0][0], b: pairs[0][1] } : null;
});
check('B0 开局存在可连对', !!before);

if (before) {
  await page.evaluate((p) => {
    const q = (rc) => document.querySelector('#lk-board .lk-tile[data-r="' + rc[0] + '"][data-c="' + rc[1] + '"]');
    q(p.a).click(); q(p.b).click();
  }, before);
  // 采样窗口内捕捉：pop 且字未清（先演后清的铁证）+ 走线 SVG 出现
  let sawPopWithGlyph = false, sawLine = false, linePts = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 1200) {
    const s = await page.evaluate(() => {
      const pops = [...document.querySelectorAll('#lk-board .lk-tile.lk-pop')];
      const svg = document.querySelector('#lk-board .lk-pathline polyline');
      return {
        popGlyph: pops.length === 2 && pops.every((x) => x.textContent.length > 0),
        pts: svg ? svg.getAttribute('points').split(' ').length : 0
      };
    });
    if (s.popGlyph) sawPopWithGlyph = true;
    if (s.pts >= 2) { sawLine = true; linePts = s.pts; }
    if (sawPopWithGlyph && sawLine) break;
    await page.waitForTimeout(40);
  }
  check('B1 爆开期间两张牌字仍在（先演后清）', sawPopWithGlyph);
  check('B2 连线走线 SVG 出现（≥2 个途经点）', sawLine, 'pts=' + linePts);
  await page.waitForFunction(() => { const st = window.__lkDebug.st(); return st && !st.lock && !st.over; }, null, { timeout: 6000 });
  const settled = await page.evaluate((p) => {
    const st = window.__lkDebug.st();
    const q = (rc) => document.querySelector('#lk-board .lk-tile[data-r="' + rc[0] + '"][data-c="' + rc[1] + '"]');
    const ea = q(p.a), eb = q(p.b);
    return {
      lock: !!st.lock,
      remaining: st.remaining, delta: p.remaining - st.remaining,
      gone: ea.classList.contains('lk-gone') && eb.classList.contains('lk-gone'),
      cleared: ea.textContent === '' && eb.textContent === '',
      popLeft: document.querySelectorAll('#lk-board .lk-tile.lk-pop').length
    };
  }, before);
  check('B3 该对真实消除（剩余 -2）', settled.delta === 2 && settled.remaining >= 0, JSON.stringify(settled));
  check('B4 收尾后 lk-gone 清字、无残留 pop 类、锁已解', settled.gone && settled.cleared && settled.popLeft === 0 && !settled.lock, JSON.stringify(settled));
}

// C 等回到玩家回合（TA 用同一条动画链消完一手），棋盘一致：gone 数 = 总数 - remaining
await page.waitForFunction(() => { const st = window.__lkDebug.st(); return st && !st.over && st.turn === 1 && !st.lock; }, null, { timeout: 15000 });
const consist = await page.evaluate(() => {
  const st = window.__lkDebug.st();
  const tiles = document.querySelectorAll('#lk-board .lk-tile');
  let gone = 0, alive = 0;
  tiles.forEach((x) => { if (x.classList.contains('lk-gone')) gone++; else if (x.textContent.length > 0) alive++; });
  return { gone, alive, remaining: st.remaining, total: st.rows * st.cols };
});
check('C1 动画链走完棋盘一致（gone+alive=总数、alive=remaining）', consist.gone + consist.alive === consist.total && consist.alive === consist.remaining, JSON.stringify(consist));

// C2 无效点选：抖动照旧、不新增爆开/走线（上一手 TA 的走线有 480ms 生命周期，用相对断言）
const pre = await page.evaluate(() => ({
  mis: window.__lkDebug.st().misPicks,
  pop: document.querySelectorAll('#lk-board .lk-tile.lk-pop').length,
  line: document.querySelectorAll('#lk-board .lk-pathline').length
}));
const mis0 = await page.evaluate(() => {
  const st = window.__lkDebug.st();
  for (let c = 0; c + 1 < st.cols; c++) {
    if (st.grid[0][c] >= 0 && st.grid[0][c + 1] >= 0 && st.grid[0][c] !== st.grid[0][c + 1]) return { a: [0, c], b: [0, c + 1] };
  }
  return null;
});
if (mis0) {
  await page.evaluate((p) => {
    const q = (rc) => document.querySelector('#lk-board .lk-tile[data-r="' + rc[0] + '"][data-c="' + rc[1] + '"]');
    q(p.a).click(); q(p.b).click();
  }, mis0);
  await page.waitForTimeout(120);
  const mis = await page.evaluate(() => {
    const st = window.__lkDebug.st();
    return {
      mis: st.misPicks,
      shake: document.querySelectorAll('#lk-board .lk-tile.lk-shake').length,
      pop: document.querySelectorAll('#lk-board .lk-tile.lk-pop').length,
      line: document.querySelectorAll('#lk-board .lk-pathline').length
    };
  });
  check('C2 点错记失误并抖动、不新增爆开/走线', mis.mis === pre.mis + 1 && mis.shake >= 1 && mis.pop <= pre.pop && mis.line <= pre.line, JSON.stringify({ pre, mis }));
  await page.waitForFunction(() => { const st = window.__lkDebug.st(); return !st.lock; }, null, { timeout: 4000 });
}

// D 手动洗牌：翻乱（lkshufout）→ 回摆（lkshufin）→ 解锁且有解、gone 数不变
await page.evaluate(() => { window.__lkDebug.st().shuffles = 3; });
const goneBefore = await page.evaluate(() => document.querySelectorAll('#lk-board .lk-tile.lk-gone').length);
await page.evaluate(() => { document.getElementById('lk-shuffle').click(); });
let sawOut = false, sawIn = false;
const t1 = Date.now();
while (Date.now() - t1 < 1500) {
  const s = await page.evaluate(() => ({
    out: document.querySelectorAll('#lk-board .lk-tile.lk-shufout').length,
    in: document.querySelectorAll('#lk-board .lk-tile.lk-shufin').length
  }));
  if (s.out > 0) sawOut = true;
  if (s.in > 0) sawIn = true;
  if (sawOut && sawIn) break;
  await page.waitForTimeout(30);
}
check('D1 洗牌翻乱动画出现（lkshufout）', sawOut);
check('D2 洗牌回摆动画出现（lkshufin）', sawIn);
await page.waitForFunction(() => { const st = window.__lkDebug.st(); return st && !st.lock; }, null, { timeout: 4000 });
const sh = await page.evaluate((goneBefore) => {
  const st = window.__lkDebug.st();
  const gone = document.querySelectorAll('#lk-board .lk-tile.lk-gone').length;
  const inLeft = document.querySelectorAll('#lk-board .lk-tile.lk-shufin').length;
  return { solvable: window.__lkDebug.allPairs(st).length > 0, goneSame: gone === goneBefore, inLeft };
}, goneBefore);
check('D3 洗牌后有解、gone 数不变、无残留动画类', sh.solvable && sh.goneSame && sh.inLeft === 0, JSON.stringify(sh));

// E 快速倍率下动画链不串步（fastMul 调试口兼容）
await page.evaluate(() => { window.__lkDebug.fast = true; });
const fbefore = await page.evaluate(() => {
  const st = window.__lkDebug.st();
  const pairs = window.__lkDebug.allPairs(st);
  return pairs.length ? { remaining: st.remaining, a: pairs[0][0], b: pairs[0][1] } : null;
});
if (fbefore) {
  await page.evaluate((p) => {
    const q = (rc) => document.querySelector('#lk-board .lk-tile[data-r="' + rc[0] + '"][data-c="' + rc[1] + '"]');
    q(p.a).click(); q(p.b).click();
  }, fbefore);
  await page.waitForFunction(() => { const st = window.__lkDebug.st(); return !st.lock && !st.over; }, null, { timeout: 6000 });
  const f = await page.evaluate((p) => {
    const st = window.__lkDebug.st();
    return { delta: p.remaining - st.remaining, pop: document.querySelectorAll('#lk-board .lk-tile.lk-pop').length };
  }, fbefore);
  check('E1 fast 倍率下消除链完整（剩余 -2、无残留 pop）', f.delta === 2 && f.pop === 0, JSON.stringify(f));
}
await page.evaluate(() => { window.__lkDebug.fast = false; });

check('F0 页面无 JS 报错', errors.length === 0, errors.join(' | ').slice(0, 200));

await browser.close();
console.log('verify-linkup-anim: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
