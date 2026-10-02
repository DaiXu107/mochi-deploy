// ===== 专项回归 #1477：红包卡点击必须按「身份」而不是按「画时的下标」取记录 =====
// 作者转报：「联系人发的0元红包无法点击领取」。
// 根因（无头复现实录，tools/tmp-probe 全家已删、判据沉淀进本尺）：
//   红包领取/退回点击读 `msgs[dataset.idx]`，而 msgs 可能在卡片画好之后被重排——权威读库合并、
//   尾巴日志回放、空权威重建（enterConfirmedEmpty）都按 ts 插删＋排序；normCell 又给「无 ts 的
//   存量记录」盖【加载时刻】的 Date.now()＝该记录每次首遇都变「最新一条」，下一次升序排序被挪到
//   数组末尾。DOM 的 data-idx 还是旧顺序（#407 同族：中段位移而 DOM 未重渲）⇒ 点卡片实际读到一条
//   别的消息，`special!=='redpacket'` 静默返回＝「卡片写着 待领取，点了没反应」。
//   0 元只是把人引到这张卡的钩子（占位符口径「0 为心意红包」＝面板可造 side=in ¥0.00）；
//   基础链路对 0 元本来就没有拦截（探针 A 组实测能领），坏的是「下标失真」这一层。
// 修法（三层，零机型分支）：
//   ① msgRecFromEl：下标快路径＋data-mk（#491 渲染期身份锚）校验，对不上就按锚反查、命中顺手把
//      节点下标修回真值；红包长按/领取两分支换用（#407/#491 菜单快照同族第三面收口）。
//   ② normCell 盖章改「自身事件时间」（rpTs/askTs/surveyTs/dAt，与 msgRecTsOf 同链）＝消掉漂移驱动。
//   ③ 口径对齐：待领取文案/领取守卫统一按「side==='out' 才是等 TA」＋falsy rpStatus 视为待领取
//      ＝卡片显示「联系人 发出·待领取」就一定点得动。
// 用法：node tools/verify-1477-rp-claim-identity.mjs
//       SRCDIR=<未打补丁的 src 目录> node tools/verify-1477-rp-claim-identity.mjs   # RED 对照
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const srcDir = process.env.SRCDIR ? normalize(process.env.SRCDIR) : join(root, 'src');
let pass = 0, fail = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra).slice(0, 200) : '')); }
}
const srcOf = (rel) => { try { return readFileSync(join(srcDir, rel), 'utf8'); } catch (e) { return ''; } };
const srcChat = srcOf('js/chat.js');
const srcBM = srcOf('../build.mjs') || readFileSync(join(root, 'build.mjs'), 'utf8');

console.log('\n== S 源码静态：解析器/盖章链/口径对齐在位 ==');
{
  ok('S1 msgRecFromEl 的身份校验快路径（下标取到的必须与 data-mk 同一身份）',
    srcChat.includes('const okFast = !!(rec && _mk && msgKeyOf(rec) === _mk);'));
  ok('S2 红包领取分支走身份解析＋显示状态 tie-break（还是裸 msgs[dataset.idx]＝主症状在）',
    srcChat.includes('const rpHit = msgRecFromEl(rpItem, function (m) { return rpStatusText(m) === rpShown; });'));
  ok('S3 红包长按退回分支走身份解析＋显示状态 tie-break',
    srcChat.includes('const rpHitD = msgRecFromEl(rpItem, function (m) { return rpStatusText(m) === rpShownD; });'));
  ok('S4 身份反查命中后把节点下标修回真值（后续按 idx 的就地状态补丁才能找到节点）',
    srcChat.includes('if (j >= 0) { item.dataset.idx = String(j); return { rec: msgs[j], idx: j }; }'));
  ok('S5 normCell 无 ts 存量改盖自身事件时间（盖 Date.now()＝漂移驱动在）',
    srcChat.includes('if (!r.ts) { r.ts = (r.rpTs || r.askTs || r.surveyTs || r.dAt) || Date.now(); c = true; }') &&
    !srcChat.includes('if (!r.ts) { r.ts = Date.now(); c = true; }'));
  ok('S6 msgRecTsOf 时间 fallback 链在位（msgKeyOf 与盖章共用同一取值）',
    srcChat.includes('function msgRecTsOf(rec) {') &&
    srcChat.includes('return (rec && (rec.ts || rec.rpTs || rec.askTs || rec.surveyTs || rec.dAt)) || 0;'));
  ok('S7 msgKeyOf 末段拼卡片身份字段（红包同毫秒同侧两张分得开；裸 text 签名分不开＝#796 同族洞）',
    srcChat.includes("return msgRecTsOf(rec) + '|' + (rec.side || '') + '|' + (rec.type || '') + '|' + String(rec.text || '').slice(0, 80) + chatRecCardExtra(rec);"));
  ok('S8 待领取文案与「联系人 发出」渲染同侧判据（side 缺失的历史卡＝待我领取）',
    srcChat.includes("return rec.side === 'out' ? (window.taFit ? window.taFit('待TA领取') : '待TA领取') : '待领取';"));
  ok('S9 领取守卫对齐：falsy rpStatus 视为待领取、side 缺失可领（旧严格口径＝显示可领点不动）',
    srcChat.includes("if ((rpRec.rpStatus || 'pending') !== 'pending') return;") &&
    srcChat.includes("if (rpRec.side === 'out') { toast(window.taFit ? window.taFit('等待 TA 领取') : '等待 TA 领取'); return; }"));
  ok('S10 msgRecFromEl 恰好两个调用点（长按＋领取；再多＝别处也在裸解析，该收口没收）',
    (srcChat.match(/msgRecFromEl\(rpItem/g) || []).length === 2);
  const sent = ['#1477a', '#1477b', '#1477c', '#1477d', '#1477e', '#1477f', '#1477g'];
  const miss = sent.filter((n) => srcBM.indexOf(n) < 0);
  ok('S11 build.mjs：#1477a~g 七条哨兵在位', miss.length === 0, miss);
}

// ---------- 无头行为：预置/面板两种来源 × 各种记录形态，点了必须真能领 ----------
const grab = (n) => JSON.parse(srcBM.match(new RegExp('const ' + n + ' = (\\[[^\\]]*\\])'))[1].replace(/'/g, '"'));
let html = readFileSync(join(srcDir, 'template.html'), 'utf8');
html = html.replace('/*__STYLES__*/', () => grab('cssFiles').map((f) => readFileSync(join(srcDir, 'css', f), 'utf8')).join('\n'));
html = html.replace('/*__SCRIPTS__*/', () => grab('jsFiles').map((f) => '(function(){ try {\n' + readFileSync(join(srcDir, 'js', f), 'utf8') + '\n} catch(e){ console.error("[JS]", e && e.message); } })();').join('\n'));
html = html.split('__BUILD_INFO__').join('verify-1477').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmp = join(process.env.TEMP || '/tmp', 'mochi-v1477-' + Date.now());
mkdirSync(tmp, { recursive: true });
writeFileSync(join(tmp, 'index.html'), html);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  const p = normalize(join(tmp, decodeURIComponent(req.url.split('?')[0])));
  let b = null;
  try { b = readFileSync(p); } catch (e) { b = null; }
  if (b === null) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
  res.end(b);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true });
const pageErrors = [];

const SEED_BASE = `localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{ id: 'default', name: '小美' }]));
  localStorage.setItem('xy-home-v2:active-contact', 'default');
  localStorage.setItem('xy-home-v2:migrated-v1', '1');
  localStorage.setItem('xy-home-v2:applock-en', '0');
  localStorage.setItem('xy-home-v2:applock-qa-en', '0');
  localStorage.setItem('xy-home-v2:applock-qaskip', '1');
  localStorage.setItem('xy-home-v2:bg-notify', '0');
  localStorage.setItem('xy-home-v2:cardlock-state', 'open');
  localStorage.setItem('xy-home-v2:storage-guide-shown', '1250');
  localStorage.setItem('xy-home-v2:__last-backup', String(Date.now()));
  Math.random = () => 0.999;`;

// 起会话；seedRecs 为启动前写进 LS 权威键的红包记录数组（可空）
async function boot(seedRecs) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  ctx.on('page', (p) => { p.on('pageerror', (e) => pageErrors.push(String(e && e.message).slice(0, 120))); });
  await ctx.addInitScript(new Function('recs', SEED_BASE + `
    if (recs && recs.length) {
      localStorage.setItem('xy-home-v2:chat-msgs', JSON.stringify(recs));
      try { indexedDB.deleteDatabase('xy-home-v2'); } catch (e) {}
    }
  `), seedRecs);
  const page = await ctx.newPage();
  await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    try { const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click(); } catch (x) {}
    try { const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; } } catch (x) {}
    window.__sweep = setInterval(() => {
      try {
        const m = document.getElementById('modal-mask'), t = document.getElementById('modal-title');
        if (m && !m.hidden && t && /存储修复引导|系统字卡未解锁|更新完成/.test(t.textContent)) m.hidden = true;
      } catch (e) {}
    }, 200);
    return true;
  });
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => { try { window.enterChat && window.enterChat(); } catch (e) {} return true; });
  await page.waitForFunction(() => !!(window.__chatDbReady && window.__chatDbReady()), null, { timeout: 15000 }).catch(() => {});
  await sleep(1400);
  return { ctx, page };
}

// 面板发一张红包（side: 'out'|'in'，金额字符串）
async function panelSend(page, side, amt) {
  await page.evaluate((cfg) => {
    document.getElementById('more-rp').click();
    document.querySelector('.rp-side[data-rpside="' + cfg.side + '"]').click();
    document.getElementById('rp-custom').value = cfg.amt;
    document.getElementById('rp-send-btn').click();
  }, { side: side, amt: amt });
  await sleep(400);
}

// 点第 n 张红包卡（0 起），读全部红包卡状态＋poke 留痕＋钱包
async function clickRp(page, nth) {
  await page.locator('#chat-body .msg-rp-card').nth(nth).click();
  await sleep(1300);
  return readRpState(page);
}
async function readRpState(page) {
  return page.evaluate(() => ({
    cards: Array.from(document.querySelectorAll('#chat-body .msg-rp')).map((el) => ({
      idx: el.dataset.idx,
      amt: (el.querySelector('.msg-rp-amt') || {}).textContent,
      side: (el.querySelector('.msg-rp-side') || {}).textContent,
      status: (el.querySelector('.msg-rp-status') || {}).textContent
    })),
    pokes: Array.from(document.querySelectorAll('#chat-body .msg-poke')).map((p) => p.textContent).filter((t) => /领取/.test(t)),
    toast: (document.getElementById('cc-toast') || {}).textContent || '',
    wallet: (function () { try { return JSON.parse(localStorage.getItem('xy-home-v2:gift-wallet') || 'null'); } catch (e) { return null; } })()
  }));
}

console.log('\n== B 行为：预置记录（含画后重排/缺字段形态）点了必须真能领 ==');
const T1H = Date.now() - 60 * 60 * 1000; // 一小时前发＝早于盖章判据的分辨阈、又新于 24h 过期窗
{
  // B1 主症状复现形态：无 ts 的存量 0 元红包（唯一金额来源＝面板「0 为心意红包」）
  const { ctx, page } = await boot([{ side: 'in', special: 'redpacket', rpAmount: 0, rpWish: '心意', rpStatus: 'pending', rpTs: T1H }]);
  const r = await clickRp(page, 0);
  ok('B1 无 ts 的存量 0 元红包（画后必被重排）点击即领取', r.cards[0] && r.cards[0].status === '已领取' && r.pokes.some((t) => t.indexOf('¥0.00') >= 0), r.cards);
  // B8 盖章判据：落盘后 ts 必须等于自身 rpTs（一小时前），不许是「加载时刻」
  const saved = await page.evaluate(() => {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!/:chat-msgs$/.test(k)) continue;
        const m = (JSON.parse(localStorage.getItem(k) || '[]') || []).find((x) => x && x.special === 'redpacket');
        if (m) return m;
      }
    } catch (e) {}
    return null;
  });
  ok('B8 盖章用记录自身事件时间（ts===rpTs；盖成加载时刻＝每次首遇都跳到「最新」）',
    !!saved && saved.ts === T1H, saved ? { ts: saved.ts, rpTs: saved.rpTs } : 'no-rec');
  await ctx.close();
}
{
  // B2/B3/B4 各自独立启动——多个缺字段卡同屏时，领取后的快照回滚链会互相污染读数（存量缺陷，见 FIX-REGRESSION）
  const { ctx, page } = await boot([{ special: 'redpacket', rpAmount: 2.33, rpWish: '旧', rpStatus: 'pending', rpTs: T1H }]); // 缺 side
  const before = await page.evaluate(() => {
    const el = document.querySelector('#chat-body .msg-rp');
    return el ? {
      side: (el.querySelector('.msg-rp-side') || {}).textContent,
      status: (el.querySelector('.msg-rp-status') || {}).textContent
    } : null;
  });
  ok('B2a 缺 side 的历史卡显示「联系人发出·待领取」（自相矛盾的「待TA领取」退出屏面）',
    before && before.side.indexOf('小美') >= 0 && before.status === '待领取', before);
  const r1 = await clickRp(page, 0);
  ok('B2b 缺 side 的历史卡点击即领取', r1 && r1.cards[0].status === '已领取', r1 && r1.cards[0]);
  await ctx.close();
}
{
  const { ctx, page } = await boot([{ side: 'in', special: 'redpacket', rpWish: '旧', rpTs: T1H }]); // 缺 rpStatus
  const r2 = await clickRp(page, 0);
  ok('B3 缺 rpStatus 的历史卡点击即领取（falsy 状态与卡片文案同口径）', r2 && r2.cards[0] && r2.cards[0].status === '已领取', r2 && r2.cards[0]);
  await ctx.close();
}
{
  const { ctx, page } = await boot([{ side: 'in', special: 'redpacket', rpWish: '旧', rpStatus: 'pending', rpTs: T1H }]); // 缺 rpAmount
  const r3 = await clickRp(page, 0);
  ok('B4 缺 rpAmount 的历史卡显示 ¥0.00 且点击即领取', r3 && r3.cards[0] && r3.cards[0].amt === '¥0.00' && r3.cards[0].status === '已领取', r3 && r3.cards[0]);
  await ctx.close();
}

console.log('\n== B 行为：面板现发（回归面——修完不许把原本能领的弄坏） ==');
{
  const { ctx, page } = await boot([]);
  await panelSend(page, 'in', '0');
  let r = await clickRp(page, 0);
  ok('B5 面板现发 side=in ¥0.00（占位符口径「0 为心意红包」）点击即领取', r.cards[0].status === '已领取' && r.pokes.some((t) => t.indexOf('¥0.00') >= 0), r.cards[0]);
  await ctx.close();
}
{
  const { ctx, page } = await boot([]);
  await panelSend(page, 'in', '5');
  const r1 = await clickRp(page, 0);
  // B6 只断言本批口径：领取当刻＝单次入账、单条留痕、卡片就地转已领取。
  // 已知存量（两侧同红、留待持久化批）：领取后 ~0.8s 的快照回滚链会把记录滚回「待领取」，
  // 二次点击可重复入账——那是「LS 快照/重读链覆盖内存新状态」一族的病（#942/#1443 同族），
  // 不是本批解析器的产物（纯 HEAD 实测同病），不进本批判据。
  ok('B6 ¥5 领取单次入账（+500、一条留痕、状态就地转已领取）',
    r1.wallet && r1.wallet.myBalance === 52500 && r1.pokes.filter((t) => t.indexOf('¥5.00') >= 0).length === 1 && r1.cards[0].status === '已领取',
    { wallet: r1.wallet, pokes: r1.pokes, card: r1.cards[0] });
  await ctx.close();
}
{
  const { ctx, page } = await boot([]);
  await panelSend(page, 'out', '1');
  const r = await clickRp(page, 0);
  ok('B7 自己发的红包点击＝「等待 TA 领取」提示且状态不动（对齐后不许越权可领）',
    r.cards[0].status === '待TA领取' && r.toast.indexOf('等待') >= 0 && (!r.wallet || r.wallet.myBalance === 51900),
    { card: r.cards[0], toast: r.toast, wallet: r.wallet });
  await ctx.close();
}

console.log('\n== pageerrors（非 localStorage 首页噪音） ==');
const realErr = pageErrors.filter((e) => e.indexOf('localStorage') < 0);
console.log(realErr.length ? realErr.join('\n') : '（无）');
ok('B9 全程零 JS 异常', realErr.length === 0, realErr.length);

await browser.close();
server.close();
console.log('\n== 结果：' + pass + ' 绿 / ' + fail + ' 红 ==');
process.exit(fail ? 1 : 0);
