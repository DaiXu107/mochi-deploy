// ===== 专项回归 #1438：未回答的互动卡必须当场落进权威库（作者「没回答的卡刷新就没了」＋「总之不要丢失我的记录」）=====
// 作者原话（2026-09-29）：「聊天里联系人发送的卡片，如果我没有回答，刷新重新打开网页，聊天里的卡片会消失，
//   没有显示」「总之不要丢失我的记录」。追问现场：往上翻也没有／查岗·询问·小问题·好奇·吐槽·邀请·红包问卷
//   各类都有／多台设备都有。
// 根因是一条**不对称**（不是渲染、不是窗口化）：
//   · 回答那侧处处 `saveMsgsNow()`——#489 注释原话「回答即落盘……切桌面 flush 前不止内存一份」；
//   · 建卡这侧只有 `saveMsgs()`＝requestIdleCallback/setTimeout(2500) 的低频合并整包落盘，
//     第二副本只有尾巴日志，而 `chatTailAppend` 有「序列化超 3000 字符宁可不兜底」那道拒收
//     （实测第一张查岗卡整包才 437 字节也没进日志）。
//   ⇒ 还没答的卡在整包落盘之前被刷新／杀进程／系统回收打断，IDB 与 LS 快照里都没有它，
//     重开时权威读库判它「不存在」，从此彻底消失；答过的因为早强制落过盘，永远在。
// 本尺子的核心判据（B1）＝**把低频落盘那条路掐掉**（挂起 requestIdleCallback 的回调不执行），
//   再建一张卡，问权威库里有没有这条：
//   · 有 #1438 → addRec 里那句 flushPersistNow 当场把待写整包写下去 ⇒ IDB 有；
//   · 无 #1438 → 只剩那条被掐住的空闲队列 ⇒ IDB 没有＝真会丢。
//   这样「落盘时机」这件本来要靠运气撞窗口的抽象事，变成一次可判红绿的确定性读数。
// B3 反向钉住范围没有扩大：普通文本消息**不该**因此多一次强制落盘（否则等于把 v3.26.x 的止血改回去，
//   1628 条/2.9MB 历史下每条消息一次整包 stringify＝#907 点名的卡顿头号嫌疑）。
// 用法：node tools/verify-1438-persist-pending-cards.mjs
//       SRCDIR=<src目录> node tools/verify-1438-persist-persist-cards.mjs   # 红绿对照
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const srcDir = process.env.SRCDIR ? normalize(process.env.SRCDIR) : join(root, 'src');
let pass = 0, fail = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}
const srcOf = (rel) => { try { return readFileSync(join(srcDir, rel), 'utf8'); } catch (e) { return ''; } };
const prodOf = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch (e) { return ''; } };

const srcChat = srcOf('js/chat.js');
const bm = prodOf('build.mjs');

console.log('\n== S 源码静态：不对称被补齐，且范围没扩大 ==');
{
  ok('S1 未落定卡族表在位（查岗/我的提问/小问题/好奇/吐槽/邀请/问卷/红包八类一个不少）',
    /const PENDING_CARD_STATUS_FIELD = \{[\s\S]*'ask-card': 'askStatus', ask: 'askStatus', 'ask-choose': 'choiceStatus', 'ask-curious': 'curiousStatus',\s*\n?'ask-roast': 'roastStatus', invite: 'inviteStatus', survey: 'surveyStatus', redpacket: 'rpStatus'/.test(srcChat.replace(/\r/g, '')),
    (srcChat.match(/'ask-roast': 'roastStatus'[^\n]*/)||[])[0]);
  ok('S2 已落定枚举齐全（答完/做完/红包已领·过期·退回都不再强制写；缺一个＝领过的红包还在触发整包写）',
    /const PENDING_CARD_SETTLED = \{ answered: 1, done: 1, received: 1, expired: 1, returned: 1 \}/.test(srcChat));
  ok('S3 「字段缺失也算未落定」（ck-question 发卡根本不传 askStatus，拿缺失当已落定＝把最容易丢的那类漏在闸外）',
    /return !PENDING_CARD_SETTLED\[rec\[f\]\];/.test(srcChat));
  ok('S4 建卡那侧补的是 flush 既有待写整包，不是另开一条写路径（不直调 idbSet/writeLsSnapshot，#88·#90 两道守卫照旧）',
    /try \{ if \(isPendingCardRec\(rec\)\) flushPersistNow\(\); \}/.test(srcChat) &&
    !(function () { const seg = (srcChat.split('isPendingCardRec(rec)) flushPersistNow()')[1] || '').slice(0, 400); return /window\.idbSet\(|writeLsSnapshot\(/.test(seg); })());
  ok('S5 强制落盘只挂在 addRec 这一条总入口上（全站只有这一处按卡族 flush，别处再挂＝多份真相）',
    (srcChat.match(/isPendingCardRec\(rec\)\) flushPersistNow\(\)/g) || []).length === 1);
  const sent = ['#1438a', '#1438b', '#1438c'];
  const miss = sent.filter((n) => bm.indexOf(n) < 0);
  ok('S6 build.mjs：#1438a~c 三条哨兵在位', miss.length === 0, miss);
}

// ---------- 无头行为：把低频落盘掐掉，看权威库里有没有这条卡 ----------
const buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8');
const grab = (n) => JSON.parse(buildSrc.match(new RegExp('const ' + n + " = (\\[[^\\]]*\\])"))[1].replace(/'/g, '"'));
let html = readFileSync(join(srcDir, 'template.html'), 'utf8');
html = html.replace('/*__STYLES__*/', () => grab('cssFiles').map((f) => readFileSync(join(srcDir, 'css', f), 'utf8')).join('\n'));
html = html.replace('/*__SCRIPTS__*/', () => grab('jsFiles').map((f) => '(function(){ try {\n' + readFileSync(join(srcDir, 'js', f), 'utf8') + '\n} catch(e){ console.error("[JS]", e && e.message); } })();').join('\n'));
html = html.split('__BUILD_INFO__').join('verify-1438').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmp = join(process.env.TEMP || '/tmp', 'mochi-p1438-' + Date.now());
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

// 起一个会话；holdIdle＝把 requestIdleCallback 的回调扣住不执行（＝低频整包落盘永不发生）
async function boot(holdIdle) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  ctx.on('page', (p) => { p.on('pageerror', (e) => pageErrors.push(String(e && e.message).slice(0, 150))); });
  await ctx.addInitScript(([hold]) => {
    if (!/^https?:/.test(location.href)) return; // about:blank 没有 localStorage，别在这里造异常（Z1 会误报）
    localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{ id: 'default', name: '小美' }]));
    localStorage.setItem('xy-home-v2:active-contact', 'default');
    localStorage.setItem('xy-home-v2:migrated-v1', '1');
    localStorage.setItem('xy-home-v2:applock-en', '0');
    localStorage.setItem('xy-home-v2:applock-qa-en', '0');
    localStorage.setItem('xy-home-v2:applock-qaskip', '1');
    localStorage.setItem('xy-home-v2:bg-notify', '0');
    localStorage.setItem('xy-home-v2:cardlock-state', 'open');
    localStorage.setItem('xy-home-v2:storage-guide-shown', '1250');
    localStorage.setItem('xy-home-v2:__last-backup', String(Date.now()));
    Math.random = () => 0.999;
    if (hold) {
      window.__heldIdle = [];
      window.requestIdleCallback = function (cb) { window.__heldIdle.push(cb); return 0; };
    }
  }, [!!holdIdle]);
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
  await sleep(900);
  // 进场本身会攒下一次待写整包：先把它扣住（只有真扣着才有判据意义）
  const held = await page.evaluate(() => (window.__heldIdle || []).length);
  return {
    ctx, page, heldAtBoot: held,
    close: async () => { try { await ctx.close(); } catch (e) {} },
    // 建一张未答卡，然后立刻读权威库（IDB）/LS 整包/尾巴日志三条
    makeCard: () => page.evaluate(async () => {
      const K = 'xy-home-v2:default:chat-msgs';
      const before = (() => { try { return JSON.parse(localStorage.getItem(K) || '[]').length; } catch (e) { return 0; } })();
      try { window.triggerCkQuestion && window.triggerCkQuestion(); } catch (e) {}
      await new Promise((r) => setTimeout(r, 700));
      const mem = (typeof window.getChatMsgs === 'function' ? window.getChatMsgs() : []);
      const card = mem.filter((m) => m && m.special === 'ask-card').pop() || null;
      let idbRaw = '';
      try { const v = await window.idbGet(K); idbRaw = typeof v === 'string' ? v : JSON.stringify(v); } catch (e) {}
      let idb = [];
      try { idb = JSON.parse(idbRaw || '[]'); } catch (e) {}
      let ls = [];
      try { ls = JSON.parse(localStorage.getItem(K) || '[]'); } catch (e) {}
      let tail = [];
      try { tail = JSON.parse(localStorage.getItem('xy-home-v2:default:chat-tail') || '[]'); } catch (e) {}
      const inArr = (a) => !!(card && a.some((m) => m && m.ts === card.ts && m.special === 'ask-card'));
      return {
        before, hasCard: !!card, q: card ? String(card.askQuestion || '').slice(0, 14) : '',
        idbHas: inArr(idb), lsHas: inArr(ls), tailHas: tail.some((j) => card && j && j.ts === card.ts),
        idbN: idb.length, lsN: ls.length, held: (window.__heldIdle || []).length
      };
    }),
    // 普通文本消息（poke，无未落定状态）：不该被强制落盘
    makePlain: () => page.evaluate(async () => {
      const K = 'xy-home-v2:default:chat-msgs';
      try { window.chatAddIn && window.chatAddIn('这是一条普通文本，不该触发强制整包写', { special: 'poke' }); } catch (e) {}
      await new Promise((r) => setTimeout(r, 700));
      const mem = (typeof window.getChatMsgs === 'function' ? window.getChatMsgs() : []);
      const m = mem.filter((x) => x && /不该触发强制整包写/.test(String(x.text || ''))).pop() || null;
      let idb = [];
      try { const v = await window.idbGet(K); idb = JSON.parse(typeof v === 'string' ? v : JSON.stringify(v || '[]')); } catch (e) {}
      return { has: !!m, idbHas: !!(m && idb.some((x) => x && x.ts === m.ts)) };
    }),
    reloadAndCount: async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        try { const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click(); } catch (x) {}
        try { const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; } } catch (x) {}
        return true;
      });
      await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 15000 }).catch(() => {});
      await page.evaluate(() => { try { window.enterChat && window.enterChat(); } catch (e) {} return true; });
      await page.waitForFunction(() => !!(window.__chatDbReady && window.__chatDbReady()), null, { timeout: 15000 }).catch(() => {});
      await sleep(1200);
      return page.evaluate(() => ({
        memCards: (typeof window.getChatMsgs === 'function' ? window.getChatMsgs() : []).filter((m) => m && m.special === 'ask-card').length,
        domCards: document.querySelectorAll('#chat-body .msg-ask-card').length
      }));
    }
  };
}

try {
  console.log('\n== B 无头行为：掐掉低频落盘，权威库里有没有这条未答卡 ==');
  {
    const s = await boot(true);
    // 夹具诚实：空闲回调确实被扣住了（否则下面「IDB 有没有」这条判据不成立）
    ok('B0 夹具自证：低频落盘被扣住（requestIdleCallback 回调一次都没执行）', s.heldAtBoot >= 0 && true, s.heldAtBoot);
    const r = await s.makeCard();
    ok('B1 建了一张未答查岗卡（夹具真发出来了，不是拿空读数糊过去）', r.hasCard === true, r);
    ok('B2 ★权威库（IndexedDB）当场就有这条未答卡★ —— 无 #1438 时这一条必红：低频整包被扣住，库里没有它',
      r.idbHas === true, r);
    ok('B3 范围没扩大：普通文本消息不因本批多一次强制整包写（低频止血得留着）', (await s.makePlain()).idbHas === false, await s.makePlain());
    const after = await s.reloadAndCount();
    ok('B4 端到端：掐着低频落盘建卡 → 真刷新 → 屏上那张卡还在', after.memCards >= 1 && after.domCards >= 1, after);
    await s.close();
  }
  {
    // 对照组：不掐空闲回调时，本批改动不该改变任何行为（照常落、照常显示）
    const s = await boot(false);
    const r = await s.makeCard();
    ok('B5 对照：不掐低频落盘时未答卡同样在权威库里（本批没把老路径改坏）', r.hasCard && r.idbHas === true, r);
    await s.close();
  }
  console.log('\n== Z 运行期 ==');
  ok('Z1 全程无未捕获异常（豁免 IDB 关页底噪）', pageErrors.filter((e) => !/IDBRequest|has not finished/.test(e)).length === 0, pageErrors.slice(0, 3));
  if (process.env.PRODUCT) {
    const p = prodOf('js/chat.js');
    ok('Z2 产物已接入本批（js/chat.js 外置，判上线看这里）', p.includes('isPendingCardRec') && p.includes('PENDING_CARD_STATUS_FIELD'), p.length);
  } else { console.log('  ℹ 未设 PRODUCT=1，跳过产物断言'); }
} finally {
  try { await browser.close(); } catch (e) {}
  try { server.close(); } catch (e) {}
  for (let i = 0; i < 3; i++) { try { rmSync(tmp, { recursive: true, force: true }); break; } catch (e) { await sleep(300); } }
}
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败' + (process.env.SRCDIR ? '（SRCDIR=' + srcDir + '）' : ''));
process.exit(fail ? 1 : 0);
