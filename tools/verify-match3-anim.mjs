// 消消乐动画行为断言（#340）：交换滑动 / 消除爆开 / 下落补位 / 无效交换滑回。
// 用法：node tools/verify-match3-anim.mjs [页面.html]（默认 index.html，需先构建；
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
await page.waitForFunction(() => typeof window.openMatch3Panel === 'function', null, { timeout: 15000 });
// 真实产物启动引导：过开屏 → 只显示聊天页 → 打开消消乐面板（对齐 verify-new-games 的做法）
await page.evaluate(() => { try { const s = document.getElementById('splash'); if (s) s.click(); } catch (e) {} });
await page.waitForTimeout(800);
await page.evaluate(() => {
  document.querySelectorAll('.page').forEach((p) => { p.hidden = (p.id !== 'page-chat'); });
  window.openMatch3Panel();
});
await page.evaluate(() => { document.getElementById('m3-btn-start').click(); });
await page.waitForFunction(() => window.__m3Debug && window.__m3Debug.st() && window.__m3Debug.st().started, null, { timeout: 5000 });

// A4 开局发牌波次：棋子字形带 m3-deal（animation backwards 填充=延迟格先隐形、对角波次出现）
const dealN = await page.evaluate(() => document.querySelectorAll('#m3-board .m3-glyph.m3-deal').length);
check('A4 开局发牌带对角波次动画（m3-deal）', dealN === 64, 'deal tiles=' + dealN);
await page.waitForFunction(() => window.__m3Debug.st() && !window.__m3Debug.st().lock, null, { timeout: 8000 });

// A 布局形态：棋子绝对定位 + 过渡（动画载体）
const shape = await page.evaluate(() => {
  const b = document.getElementById('m3-board');
  const t = b.querySelector('.m3-tile');
  const cs = getComputedStyle(t);
  return {
    n: b.querySelectorAll('.m3-tile').length,
    pos: cs.position,
    trans: cs.transitionProperty,
    boardPos: getComputedStyle(b).position
  };
});
check('A1 开局 64 颗棋子', shape.n === 64, 'n=' + shape.n);
check('A2 棋子绝对定位（可位移动画）', shape.pos === 'absolute', shape.pos);
check('A3 棋子带 transform 过渡（合成器动画，不进 layout）', /transform/.test(shape.trans), shape.trans);
check('A3b 棋子含内层 .m3-glyph（缩放/抖动动画载体）', await page.evaluate(() => !!document.querySelector('#m3-board .m3-tile .m3-glyph')));

// B 找一步可消交换，点击触发：爆开（m3-pop）→ 新子出生（m3-born）→ 落定 64 颗
const mv = await page.evaluate(() => {
  const st = window.__m3Debug.st();
  const moves = window.__m3Debug.allMoves(st.grid);
  return moves.length ? { a: moves[0].a, b: moves[0].b } : null;
});
check('B0 棋盘存在可消步', !!mv);

let sawPop = false, sawBorn = false, sawFloat = false;
if (mv) {
  await page.evaluate((mv) => {
    const st = window.__m3Debug.st();
    window.__m3Debug.gridBefore = st.grid.map((r) => r.slice());
    const board = document.getElementById('m3-board');
    const tiles = board.querySelectorAll('.m3-tile');
    const at = (r, c) => tiles.find ? null : null; // 占位
    // 用点击坐标定位：棋子带 _r/_c
    const el1 = [...board.querySelectorAll('.m3-tile')].find((x) => x._r === mv.a[0] && x._c === mv.a[1]);
    const el2 = [...board.querySelectorAll('.m3-tile')].find((x) => x._r === mv.b[0] && x._c === mv.b[1]);
    el1.click(); el2.click();
  }, mv);
  const t0 = Date.now();
  while (Date.now() - t0 < 1200) {
    const s = await page.evaluate(() => ({
      pop: !!document.querySelector('.m3-tile.m3-pop'),
      born: !!document.querySelector('.m3-tile.m3-born'),
      float: !!document.querySelector('.m3-float')
    }));
    if (s.pop) sawPop = true;
    if (s.born) sawBorn = true;
    if (s.float) sawFloat = true;
    if (sawPop && sawBorn && sawFloat) break;
    await page.waitForTimeout(60);
  }
  check('B1 消除段出现爆开动画（m3-pop）', sawPop);
  check('B2 下落补位出现新子出生动画（m3-born）', sawBorn);
  check('B2b 消除出现飘分（+N，m3-float）', sawFloat);
  // 等整条动画链走完且回到玩家回合（TA 可能已接续走完一手）
  await page.waitForFunction(() => {
    const st = window.__m3Debug.st();
    return st && !st.over && st.turn === 1 && !st.lock;
  }, null, { timeout: 15000 });
  const settled = await page.evaluate(() => {
    const board = document.getElementById('m3-board');
    const tiles = [...board.querySelectorAll('.m3-tile')];
    const keys = new Set(tiles.map((x) => x._r + ',' + x._c));
    const st = window.__m3Debug.st();
    return { n: tiles.length, uniq: keys.size, score: st.score, lock: st.lock };
  });
  check('B3 结算完成棋盘回到 64 颗、位置不重叠', settled.n === 64 && settled.uniq === 64, JSON.stringify(settled));
  check('B4 该步真实得分', settled.score > 0, 'score=' + settled.score);
  check('B5 结算后解锁', !settled.lock);
  // B6 下落时长按距离计（掉得远的棋子带更长的 transitionDuration，封顶 0.42s）
  const durOk = await page.evaluate(() => {
    const st = window.__m3Debug.st();
    const moves = window.__m3Debug.allMoves(st.grid);
    if (!moves.length) return 'nomove';
    const mv = moves.sort((a, b) => b.gain - a.gain)[0];
    const board = document.getElementById('m3-board');
    const e1 = [...board.querySelectorAll('.m3-tile')].find((x) => x._r === mv.a[0] && x._c === mv.a[1]);
    const e2 = [...board.querySelectorAll('.m3-tile')].find((x) => x._r === mv.b[0] && x._c === mv.b[1]);
    e1.click(); e2.click();
    return 'clicked';
  });
  let maxDur = 0;
  const t1 = Date.now();
  while (Date.now() - t1 < 1200) {
    maxDur = Math.max(maxDur, await page.evaluate(() => {
      let m = 0;
      document.querySelectorAll('#m3-board .m3-tile').forEach((x) => {
        const d = parseFloat(x.style.transitionDuration);
        if (d > m) m = d;
      });
      return m;
    }));
    if (maxDur > 0.3) break;
    await page.waitForTimeout(50);
  }
  check('B6 下落时长按距离分档（观测到 >0.3s 的长距离下落）', maxDur > 0.3, 'maxDur=' + maxDur.toFixed(2) + 's (' + durOk + ')');
  await page.waitForFunction(() => {
    const st = window.__m3Debug.st();
    return st && !st.over && st.turn === 1 && !st.lock;
  }, null, { timeout: 15000 });
  await page.evaluate(() => {
    document.querySelectorAll('#m3-board .m3-tile').forEach((x) => { x.style.transitionDuration = ''; });
  });
}

// C 无效交换：换过去又滑回来，分数不变、棋盘还原
const pair = await page.evaluate(() => {
  const st = window.__m3Debug.st();
  const g = st.grid.map((r) => r.slice());
  const moves = window.__m3Debug.allMoves(g);
  const isMove = (a, b) => moves.some((m) => (m.a[0] === a[0] && m.a[1] === a[1] && m.b[0] === b[0] && m.b[1] === b[1]) || (m.b[0] === a[0] && m.b[1] === a[1] && m.a[0] === b[0] && m.a[1] === b[1]));
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (c + 1 < 8) {
      const a = [r, c], b = [r, c + 1];
      if (!isMove(a, b)) return { a: a, b: b };
    }
  }
  return null;
});
if (pair) {
  // 等轮回到玩家（TA 可能在途中）
  await page.waitForFunction(() => {
    const st = window.__m3Debug.st();
    return st && !st.over && st.turn === 1 && !st.lock;
  }, null, { timeout: 10000 });
  await page.evaluate((pair) => {
    const board = document.getElementById('m3-board');
    const el1 = [...board.querySelectorAll('.m3-tile')].find((x) => x._r === pair.a[0] && x._c === pair.a[1]);
    const el2 = [...board.querySelectorAll('.m3-tile')].find((x) => x._r === pair.b[0] && x._c === pair.b[1]);
    el1.click(); el2.click();
  }, pair);
  await page.waitForTimeout(900);
  const inv = await page.evaluate(() => {
    const st = window.__m3Debug.st();
    return { lock: st.lock, score: st.score, misPicks: st.misPicks };
  });
  check('C1 无效交换后解锁且记失误', !inv.lock && inv.misPicks >= 1, JSON.stringify(inv));
}

// C2 死锁洗牌滑动动画：直接调 reshuffle，棋子滑到新位（m3-shuf 缩一下 + 过渡滑行），落定 64/64
const shuf = await page.evaluate(() => {
  const ok = window.__m3Debug.reshuffle();
  const durs = [...document.querySelectorAll('#m3-board .m3-tile')].filter((x) => x.style.transitionDuration).length;
  return { ok: ok, durs: durs };
});
let sawShuf = false;
const t2 = Date.now();
while (Date.now() - t2 < 500) {
  if (await page.evaluate(() => !!document.querySelector('.m3-glyph.m3-shuf'))) { sawShuf = true; break; }
  await page.waitForTimeout(50);
}
await page.waitForTimeout(700);
const afterShuf = await page.evaluate(() => {
  const tiles = [...document.querySelectorAll('#m3-board .m3-tile')];
  return { n: tiles.length, uniq: new Set(tiles.map((x) => x._r + ',' + x._c)).size };
});
check('C2a 洗牌滑动触发（成功+棋子带过渡时长）', shuf.ok === true && shuf.durs > 0, JSON.stringify(shuf));
check('C2b 洗牌缩放动画出现（m3-shuf）', sawShuf);
check('C2c 洗牌落定 64/64 不重叠', afterShuf.n === 64 && afterShuf.uniq === 64, JSON.stringify(afterShuf));

// D TA 回合动画链不卡死：等 TA 走完仍 64 颗、无重叠
await page.waitForFunction(() => {
  const st = window.__m3Debug.st();
  return st && !st.over && st.turn === 1 && !st.lock;
}, null, { timeout: 15000 });
const afterTa = await page.evaluate(() => {
  const board = document.getElementById('m3-board');
  const tiles = [...board.querySelectorAll('.m3-tile')];
  return { n: tiles.length, uniq: new Set(tiles.map((x) => x._r + ',' + x._c)).size };
});
check('D1 TA 回合后棋盘仍完整 64 颗不重叠', afterTa.n === 64 && afterTa.uniq === 64, JSON.stringify(afterTa));
check('D0 页面无 JS 报错', errors.length === 0, errors.join(' | ').slice(0, 200));

await browser.close();
console.log('verify-match3-anim: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
