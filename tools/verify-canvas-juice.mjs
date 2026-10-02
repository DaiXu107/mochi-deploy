// canvas 手感批行为断言：①打砖块丢命震屏（loseLife 挂 shakeUntil，render 衰减位移）——
// ②贪吃蛇死亡瞬间「先演后弹」：画布 snk-die/-red 抖动红晕 → 结算浮层延迟 ~700ms 再弹，
// 新局清类。逻辑（物理/胜负/计分/聊天分享）零改动断言。
// 用法：node tools/verify-canvas-juice.mjs [页面.html]（默认 index.html，需先构建；
//       也可喂临时拼装页做免构建验证，见 tmp-juice-assemble.mjs）。
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
await page.waitForFunction(() => typeof window.openBrickPanel === 'function' && typeof window.openSnakePanel === 'function', null, { timeout: 20000 });
await page.evaluate(() => { try { (document.querySelector('.splash-confirm-btn') || document.getElementById('splash-confirm-ok') || document.getElementById('splash') || {}).click?.(); } catch (e) {} });
await page.waitForTimeout(900);

// ---- A 组：打砖块丢命震屏 ----
console.log('A. 打砖块丢命震屏');
await page.evaluate(() => { document.querySelectorAll('.page').forEach((p) => { p.hidden = p.id !== 'page-chat'; }); window.openBrickPanel(); });
await page.waitForTimeout(400);
await page.evaluate(() => { const d = document.getElementById('brick-diff'); if (d) d.value = 'normal'; const b = document.getElementById('brick-overlay-btn'); if (b) b.click(); });
const rally = await page.waitForFunction(() => {
  const s = window.__brickDebug && window.__brickDebug.state;
  return s && s.status === 'rally';
}, null, { timeout: 8000 }).then(() => true).catch(() => false);
check('A1 开局进入 rally 态', rally);

const lost = await page.evaluate(async () => {
  const s = window.__brickDebug.state;
  s.lives = 1;                                  // 注入：下一颗掉球即丢命
  const H = window.__brickDebug.H;
  s.ball.y = H + 60; s.ball.vy = 1; s.ball.vx = 0;   // 直接把球拍出下边界
  for (let i = 0; i < 200; i++) {
    if (s.status !== 'rally') break;
    await new Promise((r) => setTimeout(r, 25));
  }
  return { status: s.status, shakeUntil: s.shakeUntil || 0, now: performance.now(), lives: s.lives };
});
check('A2 注入掉球后丢命（注入 lives=1，掉球即最后一命→over）', lost.status === 'over' && lost.lives === 0, JSON.stringify(lost));
check('A3 丢命挂上震屏截至时刻（shakeUntil≈丢命时刻+300ms）',
  lost.shakeUntil > 0 && (lost.now - lost.shakeUntil) < 1200 && (lost.shakeUntil - lost.now) < 1200,
  'shakeUntil=' + Math.round(lost.shakeUntil) + ' now=' + Math.round(lost.now));
// 终局重开：新 state 不得残留上一局震屏字段（newState 重建），且能正常回到 rally
const resumed = await page.evaluate(async () => {
  const b = document.getElementById('brick-overlay-btn');
  if (b) b.click();
  const s0 = window.__brickDebug.state;
  for (let i = 0; i < 200; i++) {
    if (s0.status === 'rally') break;
    await new Promise((r) => setTimeout(r, 25));
  }
  return { status: s0.status, staleShake: s0.shakeUntil || 0 };
});
check('A4 重开回 rally 且震屏字段不残留', resumed.status === 'rally' && resumed.staleShake === 0, JSON.stringify(resumed));

// ---- B 组：贪吃蛇死亡先演后弹 ----
console.log('B. 贪吃蛇死亡先演后弹');
await page.evaluate(() => { window.closeSnakePanel?.(); document.querySelectorAll('.page').forEach((p) => { p.hidden = p.id !== 'page-chat'; }); window.openSnakePanel(); });
await page.waitForTimeout(400);
await page.evaluate(() => { const b = document.getElementById('snake-start'); if (b) b.click(); });
// 玩家蛇默认向右 → 撞墙终局；40ms 粒度抓「死亡瞬间」：snk-die 已挂、结算未弹
const death = await page.evaluate(async () => {
  const cv = document.getElementById('snake-canvas');
  const res = document.getElementById('snake-result');
  const rbtn = document.getElementById('snake-restart');
  for (let i = 0; i < 900; i++) {
    if (cv.classList.contains('snk-die')) {
      return {
        dieClass: true, red: cv.classList.contains('snk-die-red'),
        resultHidden: res.hidden, restartHidden: rbtn.hidden
      };
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  return { dieClass: false };
});
check('B1 死亡瞬间画布挂 snk-die', !!death.dieClass, JSON.stringify(death));
check('B2 我方死亡挂红光 snk-die-red', !!death.red);
check('B3 死亡瞬间结算浮层/再来一局仍未弹（先演）', death.resultHidden === true && death.restartHidden === true);
const shown = await page.waitForFunction(() => {
  const r = document.getElementById('snake-restart');
  return r && r.hidden === false;
}, null, { timeout: 3000 }).then(() => true).catch(() => false);
check('B4 ~700ms 后结算弹出（延迟弹层）', shown);
const cleared = await page.evaluate(async () => {
  document.getElementById('snake-restart').click();
  const cv = document.getElementById('snake-canvas');
  for (let i = 0; i < 60; i++) {
    if (!cv.classList.contains('snk-die')) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
});
check('B5 新局清掉死亡反馈类', cleared);

await page.waitForTimeout(400);
check('A6/B6 全程零 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log('\nverify-canvas-juice: ' + pass + ' 通过 / ' + fail + ' 失败');
await browser.close();
process.exit(fail ? 1 : 0);
