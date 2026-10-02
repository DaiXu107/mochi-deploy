// ===== #799 小游戏道具提醒（消消乐 / 连连看）行为断言 =====
// 用户反馈：两个游戏都没有「道具提醒」，消消乐切「💣 道具」下拉后盘面毫无变化——
// 那容易被读成「点一下就在使用道具」，实际是切换模式（新对局生效、道具靠消除生成、
// 再交换引爆），玩家不知道怎么用。本脚本按用户视角断言：
//   A 消消乐：开局说明含道具用法；信息条常驻「当前模式 + 💡 余量」；提示用满灰化且再点出声；
//            对局中切下拉→常驻「点这里立刻重开一局换上」且本局模式不变、点这句红字真的就地重开成道具模式；重开→模式 chip 跟着换；
//            场上留有道具时，玩家回合状态行直接说清怎么用（↔️/↕️/💥/🌈 各一条）。
//   B 连连看：开局说明含道具；信息条把 💡/🔀 标成「提示×N / 洗牌×N」（原先只有裸数字）；
//            玩家回合状态行带道具提醒；提示/洗使用满→按钮灰化 + 再点有回应；道具全用完→状态行改口；
//            连点错 3 次→气泡提醒还有道具。
// 用法：node tools/verify-game-prop-reminder.mjs [页面.html]（默认 index.html，需先构建）
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';

const target = process.argv[2] || 'index.html';
const url = /^https?:/.test(target) ? target : pathToFileURL(target).href;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
const txt = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? (el.innerText || el.textContent || '') : '';
}, sel);
// TA 气泡（.tg-bubble.show）：用完道具/连点错时的口头提醒都走这里
const bubble = (stage) => page.evaluate((sid) => {
  const b = document.querySelector('#' + sid + ' .tg-bubble.show');
  return b ? b.textContent : '';
}, stage);
async function openPanel(fn, panelId) {
  await page.evaluate(([f, id]) => {
    document.querySelectorAll('.page').forEach((p) => { p.hidden = (p.id !== 'page-chat'); });
    try { document.getElementById('qa-mask') && (document.getElementById('qa-mask').hidden = true); } catch (e) {}
    window[f]();
    document.getElementById(id).hidden = false;
  }, [fn, panelId]);
  await page.waitForTimeout(120);
}

await page.goto(url);
await page.waitForFunction(() => typeof window.openMatch3Panel === 'function', null, { timeout: 20000 });
// 必须走 splash-enter（同 verify.mjs）：只点 #splash 不解除开屏，整棵 .phone 仍是
// visibility:hidden —— 真 page.click 会被判「element is not visible」，溢出/命中类断言全在空跑。
await page.evaluate(() => {
  const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
  const s = document.getElementById('splash'); if (s && !s.classList.contains('hide')) { s.classList.add('hide'); s.hidden = true; }
});
await page.waitForTimeout(600);

// ================= A 消消乐 =================
await openPanel('openMatch3Panel', 'chat-match3-panel');
await page.evaluate(() => { window.__m3Debug.fast = true; });

// A0 开局覆盖层就把「道具有哪些、怎么用」说清（道具模式那条必须写明「交换才引爆」）
await page.evaluate(() => {
  const m = document.getElementById('m3-mode');
  m.value = 'item'; m.dispatchEvent(new Event('change'));
});
const m3ovItem = await txt('#m3-ov-body');
check('A0a 开局说明（道具模式）写清生成条件与引爆方式', /💣 道具模式/.test(m3ovItem) && /交换/.test(m3ovItem) && /引爆/.test(m3ovItem) && /不是点一下就用/.test(m3ovItem), JSON.stringify(m3ovItem.replace(/\s+/g, ' ').slice(0, 140)));
await page.evaluate(() => {
  const m = document.getElementById('m3-mode');
  m.value = 'simple'; m.dispatchEvent(new Event('change'));
});
const m3ov = await txt('#m3-ov-body');
check('A0b 开局说明（简单模式）点明切模式要重开＋💡 提示次数', /再开一局才生效/.test(m3ov) && /💡 提示/.test(m3ov) && /3 次/.test(m3ov), JSON.stringify(m3ov.replace(/\s+/g, ' ').slice(0, 140)));

// A1 简单模式开局：信息条常驻「当前模式」＋「💡 余量」（原来只有分数，切没切道具看不出来）
await page.evaluate(() => {
  const m = document.getElementById('m3-mode');
  m.value = 'simple'; m.dispatchEvent(new Event('change'));
  document.getElementById('m3-btn-start').click();
});
await page.waitForFunction(() => window.__m3Debug.st() && window.__m3Debug.st().started && !window.__m3Debug.st().lock, null, { timeout: 8000 });
let info = await txt('#m3-info');
check('A1 简单模式信息条常驻模式与提示余量', /🌿 简单模式/.test(info) && /💡 提示×3/.test(info), JSON.stringify(info));

// A2 用掉一次提示 → 信息条余量当场跟着减
await page.evaluate(() => document.getElementById('m3-hint').click());
info = await txt('#m3-info');
check('A2 用掉一次提示后余量变 ×2', /💡 提示×2/.test(info), JSON.stringify(info));

// A3 提示用满 3 次 → 按钮灰化（仍可点），再点必须出声
await page.evaluate(() => { document.getElementById('m3-hint').click(); document.getElementById('m3-hint').click(); });
const offStyle = await page.evaluate(() => {
  const b = document.getElementById('m3-hint');
  return { off: b.classList.contains('game-prop-off'), op: getComputedStyle(b).opacity, hints: window.__m3Debug.st().hints, title: b.title };
});
check('A3a 提示用尽后按钮灰化（class + 计算样式）', offStyle.hints === 0 && offStyle.off === true && parseFloat(offStyle.op) < 0.6, JSON.stringify(offStyle));
check('A3b 道具按钮 title 写明用法与余量', /提示/.test(offStyle.title) && /次/.test(offStyle.title), offStyle.title);
await page.evaluate(() => document.getElementById('m3-hint').click());
await page.waitForTimeout(150);
check('A3c 用尽后再点有回应（原先静默＝像按钮坏了）', /用完/.test(await bubble('m3-stage')), JSON.stringify(await bubble('m3-stage')));

// A4 对局中切「💣 道具」：本局模式不许偷偷变，但要常驻「重开才生效」
await page.evaluate(() => {
  const m = document.getElementById('m3-mode');
  m.value = 'item'; m.dispatchEvent(new Event('change'));
});
info = await txt('#m3-info');
const pend = await txt('.m3-mode-pending');
const a4 = await page.evaluate(() => ({ mode: window.__m3Debug.st().mode, info: document.getElementById('m3-info').textContent }));
check('A4a 对局中切模式：本局模式仍是 simple 且 chip 未偷改', a4.mode === 'simple' && /🌿 简单模式/.test(a4.info), JSON.stringify(a4));
check('A4b 信息条常驻「点这里立刻重开」警示（#1030：不再是执行不了的「重开一局才换」）', /已选💣 道具模式/.test(pend) && /点这里立刻重开/.test(pend), JSON.stringify(pend));
check('A4c 切模式当场状态行回显用法（不是点一下就用道具）', /道具模式已选/.test(await txt('#m3-status')) && /交换/.test(await txt('#m3-status')), JSON.stringify(await txt('#m3-status')));

// A4d #1030 用户真实路径：对局中切道具后，面板上必须真有能点的东西把新模式落地。
// 旧断言只验「程序里调 newGame 会变成道具模式」，而用户能摸到的入口一个都没有
// （开局覆盖层已隐藏、结束游戏只在通关结算出现、✕ 只关面板不清棋局）→ 红字必须自身可点。
// tapPendingChip：真 page.click 红字并等重开落地；红基线（无接线）时不崩、只判红。
async function tapPendingChip(want) {
  let clicked = true;
  try { await page.click('.m3-mode-pending', { timeout: 4000 }); } catch (e) { clicked = false; }
  let landed = true;
  try {
    await page.waitForFunction((w) => {
      const s = window.__m3Debug.st();
      return s && !s.lock && (w.mode == null || s.mode === w.mode) && (w.diff == null || s.diff === w.diff);
    }, want, { timeout: 8000 });
  } catch (e) { landed = false; }
  const after = await page.evaluate(() => {
    const s = window.__m3Debug.st();
    return { mode: s.mode, diff: s.diff, score: s.score, hints: s.hints, target: s.target, pending: !!document.querySelector('.m3-mode-pending') };
  });
  return { clicked, landed, after };
}
const beforeChip = await page.evaluate(() => ({ score: window.__m3Debug.st().score, hints: window.__m3Debug.st().hints }));
const chip1 = await tapPendingChip({ mode: 'item' });
check('A4d 点红字就地重开：本局模式变 item', chip1.clicked && chip1.landed && chip1.after.mode === 'item', JSON.stringify(chip1));
// 进这一屏时提示已被 A2/A3 用满（0/3）；真重开才会回到 3/3 —— 红基线点了没反应照样是 0
check('A4e 点红字是真的开新局（提示余量 0/3 → 3/3）', beforeChip.hints === 0 && chip1.after.hints === 3, JSON.stringify({ before: beforeChip, after: chip1.after }));
check('A4f 重开后「点这里重开」红字自动收回', chip1.after.pending === false, JSON.stringify(chip1.after));

// A5 反方向：再切回「🌿 简单」并点红字 → 真的重开成本局简单模式（分数清零＝确实换了局）
await page.evaluate(() => {
  const m = document.getElementById('m3-mode');
  m.value = 'simple'; m.dispatchEvent(new Event('change'));
  window.__m3Debug.st().score = 123;   // 给本局留个非零分，重开必须清零（否则换回简单也可能只是巧合）
});
const chip2 = await tapPendingChip({ mode: 'simple' });
check('A5 再点红字换回 🌿 简单模式且真的换了局（分数 123→0）', chip2.clicked && chip2.after.mode === 'simple' && chip2.after.score === 0 && chip2.after.pending === false, JSON.stringify(chip2));
info = await txt('#m3-info');
check('A5b 信息条 chip 跟着换成 🌿 简单模式', /🌿 简单模式/.test(info), JSON.stringify(info));

// A5c #1030 难度下拉是同一个陷阱（切了只对下一局生效，而面板上原本没有任何重开入口）：
// 对局中切难度也要挂出同一颗可点红字，点它本局真的换成新难度（目标分跟着变）。
await page.evaluate(() => {
  const d = document.getElementById('m3-diff');
  d.value = 'casual'; d.dispatchEvent(new Event('change'));
});
const pendDiff = await txt('.m3-mode-pending');
check('A5c 对局中切难度也挂出「点这里立刻重开」红字', /休闲/.test(pendDiff) && /点这里立刻重开/.test(pendDiff), JSON.stringify(pendDiff));
const chip3 = await tapPendingChip({ diff: 'casual' });
check('A5d 点红字后本局难度变 casual（目标分 600→300）', chip3.clicked && chip3.landed && chip3.after.diff === 'casual' && chip3.after.target === 300, JSON.stringify(chip3));

// A6 场上留有未引爆道具 → 玩家回合状态行直接说清怎么用（四种道具各一条）
// 前置：场上有道具只在「💣 道具模式」成立，A5 结束时本局是简单模式，这里显式带回道具模式
await page.evaluate(() => {
  document.getElementById('m3-mode').value = 'item';
  window.__m3Debug.st().mode = 'item';
});
const useTips = await page.evaluate(() => {
  const d = window.__m3Debug, s = d.st();
  const out = {};
  try {
    const probe = (v) => {
      s.grid.forEach((row) => row.fill(0));
      s.grid[3][3] = v;
      s.turn = 1; s.over = false;
      d.showTurnStatus();
      d.updateInfo();
      return { status: document.getElementById('m3-status').textContent, info: document.getElementById('m3-info').textContent };
    };
    out.lineH = probe(d.LINE_H);
    out.lineV = probe(d.LINE_V);
    out.bomb = probe(d.BOMB_BASE);
    out.rainbow = probe(d.RAINBOW);
    s.grid.forEach((row) => row.fill(0));
    d.showTurnStatus();
    d.updateInfo();
    out.none = document.getElementById('m3-status').textContent;
    out.noneInfo = document.getElementById('m3-info').textContent;
  } catch (e) { out.__err = String(e && e.message || e); }
  return out;
});
check('A6f 探针可用（缺钩件即旧产物，判红不崩）', !useTips.__err, useTips.__err || '');
check('A6g 场上有道具时信息条常驻待引爆胶囊（状态行可能被挤出可视区）', /⚡ ↔️ 在场上·交换进三连即引爆/.test(useTips.lineH.info || ''), JSON.stringify(useTips.lineH.info));
check('A6h 场上没道具时胶囊收回', !/⚡/.test(useTips.noneInfo || ''), JSON.stringify(useTips.noneInfo));
check('A6a ↔️ 横向道具的用法提醒', /↔️/.test(useTips.lineH.status) && /交换进三连/.test(useTips.lineH.status) && /整行/.test(useTips.lineH.status), JSON.stringify(useTips.lineH.status));
check('A6b ↕️ 纵向道具的用法提醒', /↕️/.test(useTips.lineV.status) && /整列|一列/.test(useTips.lineV.status), JSON.stringify(useTips.lineV.status));
check('A6c 💥 炸弹的用法提醒', /💥/.test(useTips.bomb.status) && /3×3/.test(useTips.bomb.status), JSON.stringify(useTips.bomb.status));
check('A6d 🌈 彩虹的用法提醒', /🌈/.test(useTips.rainbow.status) && /交换/.test(useTips.rainbow.status), JSON.stringify(useTips.rainbow.status));
check('A6e 场上没道具时回到普通回合提示', /你的回合/.test(useTips.none) && !/交换进三连/.test(useTips.none), JSON.stringify(useTips.none));

// A7 提醒文案变长后不得撑破半框（390 窄屏实测）
const m3fit = await page.evaluate(() => {
  const p = document.getElementById('chat-match3-panel');
  const sc = p.querySelector('.poke-card-scroll');
  const info = document.getElementById('m3-info');
  return { pOverflow: p.scrollWidth - p.clientWidth, scOverflow: sc.scrollWidth - sc.clientWidth, infoOverflow: info.scrollWidth - info.clientWidth, infoLines: Math.round(info.getClientRects().length ? info.offsetHeight / 16 : 0) };
});
check('A7 消消乐半框不被长文案撑破（无横向溢出）', m3fit.pOverflow <= 0 && m3fit.scOverflow <= 0 && m3fit.infoOverflow <= 0, JSON.stringify(m3fit));

// ================= B 连连看 =================
await openPanel('openLinkupPanel', 'chat-linkup-panel');
await page.evaluate(() => { window.__lkDebug.fast = true; });

const lkov = await txt('#lk-ov-body');
check('B0 开局说明含道具与入口（点右上角图标）', /💡 提示 ×3/.test(lkov) && /🔀 洗牌 ×2/.test(lkov) && /右上角/.test(lkov), JSON.stringify(lkov.replace(/\s+/g, ' ').slice(0, 140)));

await page.evaluate(() => document.getElementById('lk-btn-start').click());
await page.waitForFunction(() => window.__lkDebug.st() && window.__lkDebug.st().started, null, { timeout: 8000 });
await page.waitForTimeout(400);

// B1 信息条把裸数字标成道具名＋次数（原先「💡 3」没人知道是什么）
info = await txt('#lk-info');
check('B1 信息条标注道具与余量', /💡 提示×3/.test(info) && /🔀 洗牌×2/.test(info), JSON.stringify(info));

// B2 玩家回合状态行带道具提醒
check('B2 玩家回合状态行提醒可以用道具', /你的回合/.test(await txt('#lk-status')) && /找不到就点上方/.test(await txt('#lk-status')), JSON.stringify(await txt('#lk-status')));

// B3 用掉一次当场减数
await page.evaluate(() => document.getElementById('lk-hint').click());
info = await txt('#lk-info');
check('B3 用掉一次提示后余量变 ×2', /💡 提示×2/.test(info), JSON.stringify(info));

// B4 提示用满 → 灰化 + 再点出声
await page.evaluate(() => { document.getElementById('lk-hint').click(); document.getElementById('lk-hint').click(); document.getElementById('lk-hint').click(); });
const lkOff = await page.evaluate(() => {
  const b = document.getElementById('lk-hint');
  return { hints: window.__lkDebug.st().hints, off: b.classList.contains('game-prop-off'), op: getComputedStyle(b).opacity, title: b.title };
});
check('B4a 提示用尽后按钮灰化且 title 带用法', lkOff.hints === 0 && lkOff.off === true && parseFloat(lkOff.op) < 0.6 && /点亮一对/.test(lkOff.title), JSON.stringify(lkOff));
await page.evaluate(() => document.getElementById('lk-hint').click());
await page.waitForTimeout(150);
check('B4b 提示用尽后再点有回应', /用完/.test(await bubble('lk-stage')), JSON.stringify(await bubble('lk-stage')));

// B5 洗牌用满同样处理（死局自动洗不占用次数；每次点击会锁输入，必须等动画链落地再点下一次）
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => document.getElementById('lk-shuffle').click());
  await page.waitForFunction(() => window.__lkDebug.st() && !window.__lkDebug.st().lock, null, { timeout: 8000 });
  await page.waitForTimeout(120);
}
const shOff = await page.evaluate(() => {
  const b = document.getElementById('lk-shuffle');
  return { n: window.__lkDebug.st().shuffles, off: b.classList.contains('game-prop-off') };
});
await page.waitForTimeout(150);
check('B5 洗牌用尽后灰化＋再点有回应', shOff.n === 0 && shOff.off === true && /洗牌用完/.test(await bubble('lk-stage')), JSON.stringify([shOff, await bubble('lk-stage')]));

// B6 两个道具都用完 → 状态行改口，不再提示「点上方」
await page.evaluate(() => { try { window.__lkDebug.showTurnStatus(); } catch (e) {} });
check('B6 道具全用完后状态行改口', /道具用完啦/.test(await txt('#lk-status')), JSON.stringify(await txt('#lk-status')));

// B7 连点错 3 次：提醒一句还有道具可用（用户最容易在这种时刻放弃）
await page.evaluate(() => {
  const s = window.__lkDebug.st();
  s.turn = 1; s.lock = false; s.over = false; s.hints = 2;
  s.misPicks = 2;                       // 已错两次，这一次凑满三次
  const tiles = [...document.querySelectorAll('#lk-board .lk-tile')].filter((t) => t.textContent);
  const a = tiles[0];
  const b = tiles.find((t) => t.textContent !== a.textContent);
  a.click(); b.click();
});
await page.waitForTimeout(200);
check('B7 连点错三次提醒有道具', /💡|🔀/.test(await bubble('lk-stage')), JSON.stringify(await bubble('lk-stage')));

const lkfit = await page.evaluate(() => {
  const p = document.getElementById('chat-linkup-panel');
  const sc = p.querySelector('.poke-card-scroll');
  const info = document.getElementById('lk-info');
  const stt = document.getElementById('lk-status');
  return { pOverflow: p.scrollWidth - p.clientWidth, scOverflow: sc.scrollWidth - sc.clientWidth, infoOverflow: info.scrollWidth - info.clientWidth, stOverflow: stt.scrollWidth - stt.clientWidth };
});
check('B8 连连看半框不被长文案撑破（无横向溢出）', lkfit.pOverflow <= 0 && lkfit.scOverflow <= 0 && lkfit.infoOverflow <= 0 && lkfit.stOverflow <= 0, JSON.stringify(lkfit));

check('Z0 全程无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log('verify-game-prop-reminder: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
