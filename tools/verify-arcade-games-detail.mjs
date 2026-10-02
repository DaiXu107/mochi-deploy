// ===== verify-arcade-games-detail.mjs =====
// 2026-09-16 小游戏细节优化批次的行为锚点断言（S 层源码断言，无需无头浏览器）。
// 覆盖：游乐室三件套全游戏接入 / UTC→本地日封顶键 / AudioContext resume / 切后台处理 /
//       先落盘后发钱 / 跨桌面串档守卫 / 各游戏单点修复。
// 用法：node tools/verify-arcade-games-detail.mjs（在仓库根目录）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
let pass = 0, fail = 0;
const fails = [];
function src(p) { return readFileSync(join(root, 'src', p), 'utf8'); }
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  ok  ' + name); }
  else { fail++; fails.push(name); console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}
function has(needle, file) { return src(file).indexOf(needle) >= 0; }
function noUtcDay(file) { return src(file).indexOf('toISOString().slice(0, 10)') < 0; }
function hasLocalDay(file) {
  const s = src(file);
  return s.indexOf("getFullYear() + '-'") >= 0 || s.indexOf("d.getFullYear() + '-'") >= 0 || s.indexOf('dt.getFullYear()') >= 0;
}

console.log('== arcade.js 游乐室聚合 ==');
check('A1 幸运池补入 fishing/ms/brick', has("{ k: 'fishing', name: '双人钓鱼' }, { k: 'ms', name: '合作扫雷' }, { k: 'brick', name: '双人打砖块' }", join('js', 'arcade.js')));
check('A2 贪吃蛇战绩键改读 snake-score（snake-stats 全仓无写入者）', has("snake: 'snake-score'", join('js', 'arcade.js')) && !has("'snake-stats'", join('js', 'arcade.js')));
check('A3 聚合页补钓鱼/扫雷/打砖块三行', has("readJson('fishing-stats'", join('js', 'arcade.js')) && has("readJson('ms-stats'", join('js', 'arcade.js')) && has("readJson('brick-stats'", join('js', 'arcade.js')));

console.log('== snake-game.js ==');
const snk = join('js', 'snake-game.js');
check('S1 游乐室打卡+胜利掉落', has("window.arcadeMarkLuckyPlayed) window.arcadeMarkLuckyPlayed('snake')", snk) && has("window.arcadeTryDrop('snake')", snk));
check('S2 rAF dt 钳制 250ms（防切后台快进狂奔）', has('Math.min(now - lastFrameTime, 250)', snk));
check('S3 切后台自动暂停+存档', has("document.hidden && state && state.status === 'playing') { saveGame(); togglePause(); }", snk));
check('S4 AudioContext suspended→resume', has("audioCtx.state === 'suspended' && audioCtx.resume", snk));
check('S5 网格离屏缓存 drawBackground', has('function drawBackground()', snk) && has('drawBackground();', snk));
check('S6 半框旋转 refitAll', has('refitAll();   // FIX 2026-09-16：原只处理全屏', snk));
check('S7 死变量 loopTimer 已清', !src(snk).includes('loopTimer'));

console.log('== pong.js ==');
const pong = join('js', 'pong.js');
check('P1 游乐室三件套（mult 在发奖处）', has("window.arcadeMult('pong')", pong) && has("window.arcadeMarkLuckyPlayed('pong')", pong) && has("window.arcadeTryDrop('pong')", pong));
check('P2 输局改发平局档 ¥5.2（原与胜局同额）', has('(playerWin ? pongWinFen : 520)', pong));
check('P3 rAF dt 钳制 + visibility 存档', has('Math.min(ts - lastTs, 250)', pong) && has('document.hidden && running && state && state.status !== \'ended\'', pong));
check('P4 比分脏标记（不再每帧 innerHTML）', has('scoreCache.key !== key', pong));
check('P5 键盘 60Hz interval 已删、并入主循环', !src(pong).includes('setInterval(') && has('function applyKeys()', pong));
check('P6 blur 清键盘状态', has("window.addEventListener('blur', () => { Object.keys(keys)", pong));
check('P7 封顶键本地日期', noUtcDay(pong) && hasLocalDay(pong));

console.log('== breakout.js ==');
const brk = join('js', 'breakout.js');
check('B1 跨刷新存档 brick-saved', has("':brick-saved'", brk) && has('function saveGame()', brk) && has('function loadSavedBrick()', brk));
check('B2 关面板落盘 + 结束清档', has('if (canPersist(state)) saveGame();', brk) && has('clearSavedBrick();   // 对局已结束', brk));
check('B3 serve/clearing 回场缓冲', has("state.serveAt = performance.now() + 900;", brk));
check('B4 blur 清方向键', has('keys.left = false; keys.right = false;', brk));
check('B5 游乐室三件套 + 战绩键', has("window.arcadeMult('brick')", brk) && has("window.arcadeTryDrop('brick')", brk) && has("':brick-stats'", brk));
check('B6 renderInfo dataset 缓存', has("scoreEl.dataset.h !== String(s.score)", brk));
check('B7 封顶键本地日期', noUtcDay(brk) && hasLocalDay(brk));

console.log('== memory-game.js ==');
const mem = join('js', 'memory-game.js');
check('M1 游乐室三件套', has("window.arcadeMult('memory')", mem) && has("window.arcadeMarkLuckyPlayed('memory')", mem) && has("window.arcadeTryDrop('memory')", mem));
check('M2 先记账后发钱（写失败不发）', src(mem).indexOf("storeKey('memory-coin-day'), JSON.stringify(daily)") < src(mem).indexOf('giftWalletChange(grantFen, grantFen'), 'order');
check('M3 TA 回合点牌轻提示', has("hint(T('TA') + '翻牌中 · 等它翻完')", mem));
check('M4 resize 重适配 + 手势解锁 AudioContext', has("window.addEventListener('resize', () => { try { if (!panel.hidden) fitBoard(); } catch (e) {} });", mem) && has('pointerdown', mem));

console.log('== connect-four.js ==');
const c4 = join('js', 'connect-four.js');
check('C1 游乐室三件套', has("window.arcadeMult('c4')", c4) && has("window.arcadeMarkLuckyPlayed('c4')", c4) && has("window.arcadeTryDrop('c4')", c4));
check('C2 落子动画回调不再在面板隐藏时补调度', has('if (!panel.hidden) scheduleTaMove(', c4));
check('C3 状态栏名字转义 escName', has('function escName()', c4) && has("escName() + '正在想……'", c4));
check('C4 封顶键本地日期', noUtcDay(c4) && hasLocalDay(c4));

console.log('== coop-mine.js ==');
const ms = join('js', 'coop-mine.js');
check('W1 游乐室三件套', has("window.arcadeMult('ms')", ms) && has("window.arcadeMarkLuckyPlayed('ms')", ms) && has("window.arcadeTryDrop('ms')", ms));
check('W2 封顶键本地日期', noUtcDay(ms) && hasLocalDay(ms));
check('W3 长按守卫（未开局/终局不起定时器）', has('if (!st || !st.started || st.over) return;', ms));
check('W4 AudioContext resume', has("audioCtx.state === 'suspended' && audioCtx.resume", ms));

console.log('== fishing.js ==');
const fish = join('js', 'fishing.js');
check('F1 日封顶 ¥104 + 先落盘后入账', has('function grantFishCoin(', fish) && has("writeJSON('fishing-coin-day'", fish) && has('try { saveToday(t); } catch (e)', fish));
check('F2 游乐室三件套', has("window.arcadeMult('fishing')", fish) && has("window.arcadeMarkLuckyPlayed('fishing')", fish) && has("window.arcadeTryDrop('fishing')", fish));
check('F3 结算文案不再被同帧清空（keep+2.5s 自清）', has("statusEl.dataset.keep = '1';", fish) && has("statusEl._keepT = setTimeout(", fish));
check('F4 厨房页签倒计时就地更新（不再每 1.2s 重建 innerHTML）', has('function updateCookProgress()', fish) && !src(fish).includes("'cook:' + Math.floor(Date.now() / 1000)"));
check('F5 resume 带 catch', has('r.catch(function () {})', fish));

console.log('== gomoku.js ==');
const gk = join('js', 'gomoku.js');
check('G1 封顶键本地日期', noUtcDay(gk) && hasLocalDay(gk));
check('G2 换联系人清 st（防跨桌面续局串档）', has('closePanel(); st = null;', gk));
check('G3 chatAddIn 前置 cid 守卫', has('const cidAtEnd = prefix();', gk));
check('G4 头部难度下拉', has("document.getElementById('gk-diff')", gk) && has('gk-diff', 'template.html'));
check('G5 isFull 死形参清理', has('function isFull() { return st.moves >= N * N; }', gk));

console.log('== match3.js ==');
const m3 = join('js', 'match3.js');
check('T1 封顶键本地日期', noUtcDay(m3) && hasLocalDay(m3));
check('T2 换联系人清 st', has('closePanel(); st = null;', m3));
check('T3 doSwap/doRainbowSwap 快照守卫', (src(m3).match(/if \(st !== s\) return;/g) || []).length >= 4, 'guards=' + (src(m3).match(/if \(st !== s\) return;/g) || []).length);
check('T4 提示每局 3 次', has('hints: 3,', m3) && has("taSay('💡 提示用完啦，重开一局才恢复')", m3));
check('T5 洗牌期间上锁', has('st.lock = true;   // FIX 2026-09-16：洗牌滑行期间原先可点选', m3));
check('T6 发牌定时器收句柄', has('let dealT = null;', m3) && has('if (dealT) { clearTimeout(dealT); dealT = null; if (st && st.lock) st.lock = false; }', m3));
check('T7 滑动交换', has('let swipeBase = null, swipeFired = false;', m3) && has('playerSwap(from, [r2, c2]);', m3));
check('T8 AudioContext resume', has("audioCtx.state === 'suspended' && audioCtx.resume", m3));

console.log('== linkup.js ==');
const lk = join('js', 'linkup.js');
check('L1 封顶键本地日期', noUtcDay(lk) && hasLocalDay(lk));
check('L2 换联系人清 st', has('closePanel(); st = null;', lk));
check('L3 结算展示实际入账（高档超封顶不虚标）', has('已达今日上限', lk) && has('var nominal = Math.round(DIFFS[st.diff].coin * mult);', lk));
check('L4 提示高亮 2.5s 自清', has('hintClearT = setTimeout(', lk));
check('L5 窄屏跌破 24px 一次性提示', has('narrowTipShown = true;', lk));
check('L6 重开补调度加 !st.lock 守卫', has('if (st.turn === 2 && !thinkT && !st.lock) scheduleTaTurn(', lk));
check('L7 AudioContext resume', has("audioCtx.state === 'suspended' && audioCtx.resume", lk));

console.log('== auction.js ==');
const au = join('js', 'auction.js');
check('U1 拍得接 TryDrop', has("window.arcadeTryDrop('auction')", au));
check('U2 persist 返回落盘结果 + hammer 原子性回滚', has('let ok = false;', au) && has('if (!persist(bagKey(), bag) || !persist(statsKey(), s))', au) && has('walletDeduct(-st.cur);', au));
check('U3 落槌 openModal 二次确认', has("window.openModal('确认落槌'", au));
check('U4 自制拍品名转义', has('function esc(s)', au) && has('esc(item.name)', au) && has('esc(it.name)', au));
check('U5 回寄键 persist 双写 + 加入 idb 回填', has('function savePending(a) { persist(giftsKey(), a); }', au) && has("'au-gifts-pending'].forEach", au));
check('U6 hammer 防二次扣款守卫', has("if (!st || st.phase !== 'bidding') return;", au));

console.log('== chat.js / css / template ==');
const chat = join('js', 'chat.js');
check('H1 rpGameCoinGrant 封顶键本地日期', has('function rpLocalDay()', chat) && has("'ml2_coin_' + gameKey + '_' + rpLocalDay()", chat));
check('H2 snake 奖励接 arcadeMult', has("window.arcadeMult('snake')", chat));
const css = src(join('css', 'chat-pages.css'));
check('Y1 pong-fs 补 100dvh+安全区', css.includes('#chat-pong-panel.pong-fs { position:fixed !important; top:0 !important; right:0 !important; bottom:0 !important; left:0 !important; z-index:9999; border-radius:0; max-height:none !important; height:100vh; height:100dvh;'));
check('Y2 pong-overlay-btn 补 touch-action', css.includes('.pong-overlay-btn { padding:8px 24px; border-radius:20px; border:none; background:#3a7fd5; color:#fff; font-size:14px; font-weight:600; cursor:pointer; touch-action:manipulation;'));
check('Z1 template.html 五子棋难度下拉', has('gk-diff', 'template.html'));

console.log('\n通过 ' + pass + ' / ' + (pass + fail) + (fail ? '\n失败项：\n- ' + fails.join('\n- ') : ''));
process.exit(fail ? 1 : 0);
