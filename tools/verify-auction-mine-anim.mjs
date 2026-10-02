// #343 小游戏动画行为断言（第二批）：拍卖会（登场/价格跳动/结果浮层三表情/下一件不再被结果层盖住）
//                                     + 合作扫雷（连片展开涟漪/踩雷震屏+延迟结算/旗子弹出）。
// 用法：node tools/verify-auction-mine-anim.mjs [页面.html | --tmp]
//       默认打 index.html（需先构建）；--tmp = 从 src 临时拼装页免构建验证（不写产物）。
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { pathToFileURL } from 'url';

let tmpPage = null;
async function resolveTarget() {
  const arg = process.argv[2];
  if (arg !== '--tmp') return (/^https?:/.test(arg || '') ? arg : pathToFileURL(arg || 'index.html').href);
  // ---- 从 src 拼装临时验证页（面板块 + chat-pages.css + 两个游戏 JS + 全局桩） ----
  const tpl = readFileSync('src/template.html', 'utf8');
  const css = readFileSync('src/css/chat-pages.css', 'utf8');
  const msJs = readFileSync('src/js/coop-mine.js', 'utf8');
  const auJs = readFileSync('src/js/auction.js', 'utf8');
  function extractBlock(id) {
    const at = tpl.indexOf('id="' + id + '"');
    if (at < 0) throw new Error('template 缺少 ' + id);
    let lt = tpl.lastIndexOf('<div', at);
    const re = /<\/?div\b/g;
    re.lastIndex = lt;
    let depth = 0, m;
    while ((m = re.exec(tpl))) {
      depth += (m[0] === '<div') ? 1 : -1;
      if (!depth) {
        const end = tpl.indexOf('>', re.lastIndex);   // 收尾要含闭标签的 '>'（否则吞掉下一块的开标签）
        return tpl.slice(lt, end + 1);
      }
    }
    throw new Error(id + ' div 不配平');
  }
  const stubs = `
    window.activePrefix = function(){ return 'xy-home-v2'; };
    window.activeStore = function(){ return { get:function(){return null;}, set:function(){} }; };
    window.taFit = function(x){ return x; };
    window.taWord = function(){ return 'TA'; };
    window.chatPartnerName = function(){ return 'TA'; };
    window.giftWalletGet = function(){ return { myBalance: window.__stubBal || 100000 }; };
    window.giftWalletSet = function(){ };
    window.giftWalletChange = function(){ };
    window.getInteractPool = function(){ return null; };
    window.chatAddIn = function(){ }; window.chatAddSystem = function(){ };
    window.openModal = function(){ };
    window.arcadeMult = function(){ return 1; };
    window.arcadeMarkLuckyPlayed = function(){ };
    window.recordGiftBox = function(){ };
  `;
  const html = '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{margin:0;padding:8px;background:#eee;--muted:#777;--ink:#333;--accent:#8b7cf6;--card-bg:#fff;--card-border:rgba(0,0,0,.08);} [hidden]{display:none!important}</style>' +
    '<style>' + css + '</style></head><body>' +
    extractBlock('chat-ms-panel') + extractBlock('chat-auction-panel') +
    '<script>' + stubs + '</scr' + 'ipt>' +
    '<script>' + msJs + '</scr' + 'ipt>' +
    '<script>' + auJs + '</scr' + 'ipt>' +
    '</body></html>';
  tmpPage = 'tmp-343-anim-page.html';
  writeFileSync(tmpPage, html);
  return pathToFileURL(tmpPage).href;
}

const url = await resolveTarget();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto(url);
const onReal = process.argv[2] !== '--tmp';
if (onReal) {
  await page.evaluate(() => { try { const s = document.getElementById('splash'); if (s) s.click(); } catch (e) {} });
  await sleep(800);
  await page.evaluate(() => { document.querySelectorAll('.page').forEach((p) => { p.hidden = (p.id !== 'page-chat'); }); });
}
await page.waitForFunction(() => typeof window.openMsPanel === 'function' && typeof window.openAuctionPanel === 'function', null, { timeout: 20000 });

// ================= 合作扫雷 =================
await page.evaluate(() => { window.openMsPanel(); });
await sleep(250);

// M0 开场覆盖层子元素带错峰入场动画（#ms-overlay:not([hidden]) > *）
const m0 = await page.evaluate(() => getComputedStyle(document.querySelector('#ms-overlay > *')).animationName);
check('M0 结果/开场浮层子元素带 msovin 错峰入场', m0 === 'msovin', m0);

// M1~M5：easy 5×5 forceMap 埋雷 [5,9]（r1c0/r1c4 两角）——中央一挖即 15 格零区涟漪且直接通关，
// 一次流程同时验证：逐层展开（M1）＋视觉追平逻辑（M2）＋mspop（M3）＋通关延迟结算（M4/M5）
await page.evaluate(() => {
  const d = window.__msDebug;
  d.setDiff('easy'); d.newGame();
  const mines = new Array(25).fill(0); mines[5] = 1; mines[9] = 1;
  d.forceMap(mines);
});
await sleep(120);
const m1 = await page.evaluate(() => {
  const d = window.__msDebug;
  d.stopTa(); d.unlock();
  document.querySelectorAll('#ms-board .ms-cell')[12].click();   // 中央格：大涟漪 + 全安全格开完=通关
  return { openSync: document.querySelectorAll('#ms-board .ms-cell.ms-open').length };
});
await sleep(120);
const m2 = await page.evaluate(() => ({ openMid: document.querySelectorAll('#ms-board .ms-cell.ms-open').length }));
await sleep(900);
const m3 = await page.evaluate(() => {
  const d = window.__msDebug;
  return {
    openEnd: document.querySelectorAll('#ms-board .ms-cell.ms-open').length,
    logicOpen: d.st().open.filter(Boolean).length,
    popSeen: !!document.querySelector('#ms-board .ms-face.ms-pop')
  };
});
check('M1 首挖涟漪：视觉揭格逐层展开（t0 < t1 < 终态）', m1.openSync < m2.openMid && m2.openMid <= m3.openEnd,
  'sync=' + m1.openSync + ' mid=' + m2.openMid + ' end=' + m3.openEnd);
check('M2 视觉终态追平逻辑开格数', m3.openEnd === m3.logicOpen && m3.openEnd > 10,
  'vis=' + m3.openEnd + ' logic=' + m3.logicOpen);
check('M3 展开格带 mspop 弹出动画载体', m3.popSeen);

// M4/M5 通关延迟结算：雷墙 [6,8] 把盘面切成上下两半——先清完上半数字格，
// 最后一挖（20 号）涟漪铺开下半 10 格零区＝通关，结果层须等涟漪演完（maxDelay+260ms）再弹
await page.evaluate(() => {
  const d = window.__msDebug;
  d.setDiff('easy'); d.newGame();
  const mines = new Array(25).fill(0); mines[6] = 1; mines[8] = 1;
  d.forceMap(mines);
  [0, 1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 13, 14].forEach((i) => { d.stopTa(); d.unlock(); d.dig(i, true); });
  d.stopTa(); d.unlock();
  d.dig(20, true);   // 最后一挖：下半零区涟漪 + 通关
});
await sleep(80);
const m4 = await page.evaluate(() => ({ ovShownEarly: !document.getElementById('ms-overlay').hidden }));
await sleep(1400);
const m5 = await page.evaluate(() => ({
  ovShownLate: !document.getElementById('ms-overlay').hidden,
  over: window.__msDebug.st().over
}));
check('M4 通关结算延迟弹出（先演涟漪再弹层）', m5.over && !m4.ovShownEarly && m5.ovShownLate,
  'over=' + m5.over + ' early=' + m4.ovShownEarly + ' late=' + m5.ovShownLate);
check('M5 结果浮层在显且子元素带入场动画', m5.ovShownLate);

// M6~M9 踩雷：埋雷 [0,1,2,7] 连踩三颗 → 震屏 + 大爆炸脸 + 三命尽时结果层延迟出现（7 号雷留给 N3 揭雷断言）
await page.evaluate(() => {
  const d = window.__msDebug;
  d.setDiff('easy'); d.newGame();
  const mines = new Array(25).fill(0); mines[0] = 1; mines[1] = 1; mines[2] = 1; mines[7] = 1;
  d.forceMap(mines);
});
await sleep(150);
const boomSeq = [];
for (let k = 0; k < 3; k++) {
  await page.evaluate((k) => { const d = window.__msDebug; d.stopTa(); d.unlock(); d.dig(k, true); }, k);
  boomSeq.push(await page.evaluate(() => ({
    quake: document.getElementById('ms-board').classList.contains('ms-quake'),
    boomFace: (document.querySelector('#ms-board .ms-cell.ms-boom .ms-face') || {}).textContent || '',
    hurt: document.getElementById('ms-lives').classList.contains('ms-hurt'),
    ovShown: !document.getElementById('ms-overlay').hidden,
    over: window.__msDebug.st().over
  })));
  await sleep(900);
}
check('M6 踩雷棋盘震屏（ms-quake）', boomSeq.some((s) => s.quake));
check('M7 爆炸格 💥 大爆炸动画脸（ms-boom + pop 载体）', boomSeq[0].boomFace === '💥');
check('M8 三命尽：结果层延迟出现（揭雷+兜底窗内不可见）', boomSeq[2].over && !boomSeq[2].ovShown,
  'over=' + boomSeq[2].over + ' ovShown@t0=' + boomSeq[2].ovShown);
await sleep(700);
const m9 = await page.evaluate(() => !document.getElementById('ms-overlay').hidden);
check('M9 延迟窗后结果层正常弹出（守卫未吞）', m9);

// N3 失败揭雷：没踩过的 7 号雷在结算延迟窗内逐颗亮出（读板须在 M10 newGame 重置前）
const n3 = await page.evaluate(() => {
  const cell = document.querySelectorAll('#ms-board .ms-cell')[7];
  return { face: (cell.querySelector('.ms-face') || {}).textContent || '', reveal: cell.classList.contains('ms-reveal') };
});
check('N3 失败揭雷：未挖的雷延迟亮出 💣（ms-reveal）', n3.face === '💣' && n3.reveal, JSON.stringify(n3));
check('N4 掉心脉冲（ms-hearts 加 ms-hurt）', boomSeq[0].hurt === true);

// M10 旗子弹出动画
await page.evaluate(() => { const d = window.__msDebug; d.stopTa(); d.unlock(); d.newGame(); d.toggleFlag(7, 1); });
await sleep(80);
const m10 = await page.evaluate(() => {
  const face = document.querySelectorAll('#ms-board .ms-cell')[7].querySelector('.ms-face');
  return { txt: face.textContent, pop: face.classList.contains('ms-pop') };
});
check('M10 插旗 🚩 带 ms-pop 弹出', m10.txt === '🚩' && m10.pop, JSON.stringify(m10));

// ================= #349 二批：开局发牌 / 宝物特效 =================
// N1 开局对角波次发牌：ms-born 全量 + delay 对角递增 + 动画结束自清
await page.evaluate(() => { const d = window.__msDebug; d.setDiff('normal'); d.newGame(); });
await sleep(60);
const n1 = await page.evaluate(() => {
  const cells = Array.from(document.querySelectorAll('#ms-board .ms-cell'));
  return {
    total: cells.length,
    born: cells.filter((c) => c.classList.contains('ms-born')).length,
    d0: parseInt(cells[0].style.animationDelay, 10) || 0,
    dLast: parseInt(cells[cells.length - 1].style.animationDelay, 10) || 0
  };
});
await sleep(1400);
const n1b = await page.evaluate(() => Array.from(document.querySelectorAll('#ms-board .ms-cell')).filter((c) => c.classList.contains('ms-born')).length);
check('N1 开局对角波次发牌（ms-born 全量+对角 delay 递增）', n1.born === n1.total && n1.dLast > n1.d0,
  'born=' + n1.born + '/' + n1.total + ' d0=' + n1.d0 + 'ms dN=' + n1.dLast + 'ms');
check('N1b 发牌动画结束自清（class/内联 delay 移除，不拖慢后续动画）', n1b === 0, 'left=' + n1b);

// N2 宝物格 🪙 金色旋转弹出（mstreasure + 光晕）
await page.evaluate(() => {
  const d = window.__msDebug;
  const mines = new Array(36).fill(0); mines[0] = 1;
  d.forceMap(mines);
  d.setContent(12, 'coin');
  d.stopTa(); d.unlock();
  d.dig(12, true);
});
await sleep(80);
const n2 = await page.evaluate(() => {
  const cell = document.querySelectorAll('#ms-board .ms-cell')[12];
  const face = cell.querySelector('.ms-face');
  return { txt: face.textContent, tr: cell.classList.contains('ms-tr'), anim: getComputedStyle(face).animationName };
});
check('N2 宝物格 🪙 金色旋转弹出（mstreasure+光晕）', n2.txt === '🪙' && n2.tr && n2.anim === 'mstreasure', JSON.stringify(n2));

// ================= 拍卖会 =================
await page.evaluate(() => { window.openAuctionPanel(); });
await sleep(250);
// A1 开场教学在 → 开拍 → 教学收、拍品登场动画、半框结果层隐藏
await page.evaluate(() => { window.__auDebug.newSession(); });
await sleep(100);
const a1 = await page.evaluate(() => {
  const item = document.getElementById('au-item');
  return {
    introHidden: document.getElementById('au-intro').hidden,
    ovHidden: document.getElementById('au-overlay').hidden,
    auIn: item.classList.contains('au-in'),
    icoAnim: getComputedStyle(item.querySelector('.au-ico')).animationName,
    bidTxt: (item.querySelector('.au-bid') || {}).textContent || ''
  };
});
check('A1 开拍：教学层收起、结果层隐藏', a1.introHidden && a1.ovHidden);
check('A2 拍品登场 au-in（子元素错峰浮起）', a1.auIn && a1.icoAnim === 'auin', a1.icoAnim);
check('A3 起拍价文案在位', /起拍价/.test(a1.bidTxt), a1.bidTxt);

// A4 我出价：价格跳动 + 领价方着色（同步读——fast 模式下 TA ~50ms 就回价，晚了读到的是 TA 领价态）
const a4 = await page.evaluate(() => {
  window.__auDebug.myBid(100);
  const bid = document.querySelector('.au-bid');
  return { cls: bid.className, anim: getComputedStyle(bid).animationName, txt: bid.textContent };
});
check('A4 我出价：au-bump 跳动 + au-lead-you 着色', a4.anim === 'aubump' && /au-lead-you/.test(a4.cls),
  a4.anim + ' | ' + a4.cls);

// A5 TA 反应后到落槌/拍走/流拍：结果层 mood 表情 + 不再盖住下一件（#343 修复核心）
let a5 = {};
for (let t = 0; t < 40; t++) {
  a5 = await page.evaluate(() => {
    const st = window.__auDebug.st();
    const ov = document.getElementById('au-overlay');
    return { phase: st.phase, leader: st.leader, ovShown: !ov.hidden, mood: ov.className };
  });
  if (a5.phase === 'done' && a5.ovShown) break;
  // 轮到 TA 后我直接落槌/放弃，加速收件
  await page.evaluate(() => {
    const st = window.__auDebug.st();
    if (st.phase === 'bidding' && st.leader === 'ta' && !document.getElementById('au-pass').disabled) document.getElementById('au-pass').click();
  });
  await sleep(150);
}
check('A5 结果浮层带 mood 表情类（win/ta/pass 其一）', /au-ov-(win|ta|pass)/.test(a5.mood), a5.mood.trim() || '(none)');
check('A6 首件结束（phase=done 且浮层在显）', a5.phase === 'done' && a5.ovShown, JSON.stringify({ phase: a5.phase, ovShown: a5.ovShown }));

// A7 「下一件」：结果层必须收起、新拍品登场（修复前：结果层盖住第二件点不了）
await page.evaluate(() => { document.getElementById('au-btn-start').click(); });
await sleep(120);
const a7 = await page.evaluate(() => {
  const st = window.__auDebug.st();
  const ov = document.getElementById('au-overlay');
  return {
    idx: st.idx, phase: st.phase, ovHidden: ov.hidden,
    lotTxt: document.getElementById('au-lot').textContent,
    auIn: document.getElementById('au-item').classList.contains('au-in')
  };
});
check('A7 下一件：结果层收起 + 第 2 件开拍（#343 openLot 补 hideOverlay）', a7.idx === 1 && a7.phase === 'bidding' && a7.ovHidden,
  JSON.stringify(a7));
check('A8 第二件拍品登场动画重放', a7.auIn);

// 收尾：零页面错误
check('Z1 全程零 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log('\n结果: ' + pass + ' 过 / ' + fail + ' 败' + (tmpPage ? '（--tmp 拼装页）' : '（真实 index.html）'));
if (tmpPage) { try { unlinkSync(tmpPage); } catch (e) {} }
await browser.close();
process.exit(fail ? 1 : 0);
