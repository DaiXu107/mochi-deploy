// ===== 专项回归：跨桌面查岗/来电「开了却一次都不触发」（incoming-requests.js v3.26.x #260）=====
// 用户报障（iPhone 12 Pro / iOS Safari 17.1.1，明说其他机型也有）：多角色 + 跨桌面查岗/
// 打电话常开 + 频率「标准」，连续一星期多没有任何一次触发。
// 根因（本脚本逐条钉住）：跨桌面请求的前台弹窗只活在当前页面会话，而 pending 记录存
// localStorage 会跨刷新存活；任何「没走 openModal 回调就把弹窗弄没」的路径（刷新 / iOS
// 回收重载 / 返回键 / 被别的 openModal 顶掉 / #257 逃生门复位）都会留下一条永久 pending，
// hasPending 从此永久挡掉该联系人的一切跨桌面查岗/来电/求聊天——联系人逐个被卡死后＝全局零触发。
// 同一条链路上还有三处放大器：只有页面活着且在前台才掷（iOS 后台冻结定时器）、首查 30~90s
// 的启动延迟（短会话一次都掷不到）、全站共用一个 #modal-mask 导致同一轮多次投递互相顶掉。
//
// 用例（除 T10/T11 外全部为无头真实行为断言，不是字符串比对）：
//   T1  自动投递链路 + 同一轮不互相顶掉（只投一条，第二条冷却不被消耗）
//   T2  跨会话陈旧 pending 自愈释放 + 释放后恢复投递 + 保留 seen 痕迹 + 新 foreign pending 不抢
//   T3  本会话弹窗被别的弹窗顶掉 → 下一轮对账释放 pending
//   T4  浮层长期占屏：先让路 ≤BUSY_ESCAPE 轮，到上限后照投（不变成新的永不触发）
//   T5  正在打字（IME 组合态）绝不顶掉，让路期间不消耗冷却
//   T6  应用锁/问答门在屏时整轮不掷，解锁后当轮恢复
//   T7  「稍后」应答正常释放，释放后该联系人可再次触发
//   T8  同一联系人未处理期间不重复投递
//   T10 源码静态接线（探针/自愈/对账/闸门/首查提前/回前台补掷/设备无关）
//   T11 全程无未捕获异常
// 回前台补掷（visibilitychange）只由 T10 静态钉住：无头里定时器本来就在跑，
// 无法把「补的那一次」和「正常轮询那一次」区分开，不做假行为断言。
//
// 用法：node tools/verify-desk-incoming.mjs
//       SRCDIR=<src目录> node tools/verify-desk-incoming.mjs   # 对任意源快照做红绿对照
//       PRODUCT=1 node tools/verify-desk-incoming.mjs          # 追加构建产物静态断言
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const srcDir = process.env.SRCDIR ? normalize(process.env.SRCDIR) : join(root, 'src');

let pass = 0, fail = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}

// ---- 测试专用组装：按 build.mjs 同顺序拼临时 index.html（不碰仓库产物，避免与构建者撞车）----
const buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8');
const grab = (name) => JSON.parse(buildSrc.match(new RegExp('const ' + name + " = (\\[[^\\]]*\\])"))[1].replace(/'/g, '"'));
const cssFiles = grab('cssFiles'), jsFiles = grab('jsFiles');
let html = readFileSync(join(srcDir, 'template.html'), 'utf8');
html = html.replace('/*__STYLES__*/', () => cssFiles.map((f) => readFileSync(join(srcDir, 'css', f), 'utf8')).join('\n'));
html = html.replace('/*__SCRIPTS__*/', () => jsFiles.map((f) => '(function(){ try {\n' + readFileSync(join(srcDir, 'js', f), 'utf8') + '\n} catch(e){ console.error("[JS]", e && e.message); } })();').join('\n'));
html = html.split('__BUILD_INFO__').join('verify-desk').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-deskincoming-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), html);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(tmpRoot, rel)), hit = false;
    try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) { p = normalize(join(root, rel)); try { hit = statSync(p).isFile(); } catch (e) {} }
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true });
const pageErrors = [];

/**
 * 起一个干净的页面会话（独立 context = 独立 localStorage）。
 * opts: { stale:'old'|'fresh'|null, mode, random:'hit'|'miss' }
 * 占用态（浮层/锁屏/打字）一律用 occupyAndRoll/lockAndRoll/focusAndRoll 现场原子布置，
 * 不与启动时序赛跑。
 */
async function boot(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageErrorsLocal = [];
  ctx.on('page', (p) => { p.on('pageerror', (e) => { pageErrorsLocal.push(String(e && e.message).slice(0, 160)); }); });
  await ctx.addInitScript(([o]) => {
    if (!/^https?:/.test(location.href)) return; // about:blank 无 localStorage，别在这里造异常
    localStorage.setItem('xy-home-v2:contacts', JSON.stringify([
      { id: 'default', name: '小美' }, { id: 'cmtprobe1', name: '阿明' }, { id: 'cmtprobe2', name: '小雪' }
    ]));
    localStorage.setItem('xy-home-v2:active-contact', 'default');
    localStorage.setItem('xy-home-v2:desk-freq-mode', o.mode || 'std');
    localStorage.setItem('xy-home-v2:desk-checkin-en', '1');
    localStorage.setItem('xy-home-v2:desk-call-en', '1');
    localStorage.setItem('xy-home-v2:migrated-v1', '1');
    localStorage.setItem('xy-home-v2:applock-en', '0');
    localStorage.setItem('xy-home-v2:applock-qa-en', '0');
    localStorage.setItem('xy-home-v2:bg-notify', '0');
    localStorage.setItem('xy-home-v2:psync-en', '0');
    if (o.stale === 'old' || o.stale === 'fresh') {
      const t = Date.now() - (o.stale === 'old' ? 2 * 24 * 3600 * 1000 : 1000);
      // 跨会话孤儿：没有 sid（旧版本留下的）或 sid 是别人的，都只可能是「上一个页面会话」投的
      localStorage.setItem('xy-home-v2:incoming-requests', JSON.stringify([
        { cid: 'cmtprobe1', kind: 'call', text: '', ts: t, status: 'pending', sid: 's-foreign' },
        { cid: 'cmtprobe2', kind: 'checkin', text: '在干嘛呢', ts: t, status: 'pending' }
      ]));
    }
    Math.random = () => (o.random === 'miss' ? 0.9 : 0.001);
    // 长跑定时器压缩：首查 12s / 轮询 60s → 百毫秒级，让「多轮」在同一秒内可测
    const _st = window.setTimeout, _si = window.setInterval;
    window.setTimeout = function (fn, d) { return _st(fn, Math.min(d || 0, 400), ...[].slice.call(arguments, 2)); };
    window.setInterval = function (fn, d) { return _si(fn, Math.max(300, Math.min(d || 300, 500)), ...[].slice.call(arguments, 2)); };
  }, [opts]);
  const page = await ctx.newPage();
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  page.setDefaultTimeout(20000);
  return {
    ctx, page,
    async close() {
      pageErrors.push(...pageErrorsLocal);
      try { await ctx.close(); } catch (e) {}
    },
    state: () => page.evaluate(() => {
      const last = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('xy-home-v2:incoming-last:') === 0) last[k.slice('xy-home-v2:incoming-last:'.length)] = localStorage.getItem(k);
      }
      const mask = document.getElementById('modal-mask');
      const title = document.getElementById('modal-title');
      return {
        probe: window.__mochiIncomingProbe ? window.__mochiIncomingProbe() : null,
        queue: JSON.parse(localStorage.getItem('xy-home-v2:incoming-requests') || '[]'),
        last,
        maskOpen: !!(mask && !mask.hidden),
        maskTitle: title ? title.textContent : ''
      };
    }),
    waitFor: (fn, arg, ms) => page.waitForFunction(fn, arg, { timeout: ms || 15000 }).then(() => true).catch(() => false),
    setOpenModal: (t) => page.evaluate((title) => { window.openModal(title, '', function () {}, { noInput: true, staticText: '占位' }); return true; }, t),
    // 同一次 evaluate 里「打开占用浮层 + 概率切到必中」——保证让路计数从这一刻才起算
    occupyAndRoll: () => page.evaluate(() => {
      window.Math.random = () => 0.001;
      const el = document.getElementById('tc-mask') || document.getElementById('qa-mask');
      if (el) el.hidden = false;
      return !!el;
    }),
    lockAndRoll: () => page.evaluate(() => {
      window.Math.random = () => 0.001;
      let el = document.getElementById('applock-mask');
      if (!el) { el = document.createElement('div'); el.id = 'applock-mask'; document.documentElement.appendChild(el); }
      el.hidden = false;
      return true;
    }),
    focusAndRoll: () => page.evaluate(() => {
      window.Math.random = () => 0.001;
      // 用 contenteditable 探针（Android 上真正在打字的就是 ce-box 这种节点）：
      // input/textarea 会被 mobile-adapt 的 ceConvert 搬走，焦点观测不到。
      const box = document.createElement('div');
      box.id = 'probe-kb'; box.contentEditable = 'true'; box.textContent = '正在打';
      document.body.appendChild(box); box.focus();
      // 持焦：整个被测窗口都要能观测到「用户在框里」，否则断言会随页面其它聚焦漂移
      window.__probeKbHold = window.__probeKbHold || setInterval(function () {
        const t = document.getElementById('probe-kb');
        if (t && document.activeElement !== t) t.focus();
      }, 100);
      return document.activeElement === box;
    }),
    releaseAll: () => page.evaluate(() => {
      ['tc-mask', 'qa-mask', 'call-mask'].forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = true; });
      const a = document.getElementById('applock-mask'); if (a) a.hidden = true;
      const ae = document.activeElement; if (ae && ae.blur) ae.blur();
      return true;
    })
  };
}

const PEND = (s, cid) => s.queue.filter((x) => x.status === 'pending' && (!cid || x.cid === cid)).length;
const MODAL = /来查岗了|来电了|想找你聊天/;

try {
  // ================= T1 自动投递 + 同一轮不互相顶掉 =================
  console.log('\n== T1 自动投递链路与同轮互斥 ==');
  {
    const s0 = await boot({ mode: 'std', random: 'hit' });
    const got = await s0.waitFor(() => {
      const q = JSON.parse(localStorage.getItem('xy-home-v2:incoming-requests') || '[]');
      return q.some((x) => x.status === 'pending');
    }, null, 12000);
    await s0.waitFor(() => (window.__mochiIncomingProbe ? window.__mochiIncomingProbe().ticks : 99) >= 4, null, 6000);
    const st = await s0.state();
    ok('轮询会自动投出跨桌面请求弹窗（链路通）', got && st.maskOpen && MODAL.test(st.maskTitle), st.maskTitle);
    ok('同一轮只投一条（其余联系人不抢同一个 #modal-mask）', PEND(st) === 1, st.queue.map((x) => x.cid + ':' + x.status));
    const cooled = Object.keys(st.last);
    ok('被让路的联系人不消耗冷却（只有投出的那条写 incoming-last）', cooled.length === 1, st.last);
    ok('投递记录带本会话归属 sid（跨会话孤儿的判定依据）', !!st.queue[0] && typeof st.queue[0].sid === 'string' && st.queue[0].sid.length > 1, st.queue[0]);
    ok('探针在线且 live=1（活弹窗登记，供对账）', !!st.probe && st.probe.live === 1 && st.probe.pending === 1, st.probe);
    ok('探针档位读全局频率模式（std=2%/30min）', !!st.probe && st.probe.mode === 'std' && st.probe.prob === 2 && st.probe.cool === 30, st.probe);
    await s0.close();
  }

  // ================= T2 跨会话陈旧 pending 自愈 =================
  console.log('\n== T2 陈旧孤儿 pending 自愈（用户「一周 0 次」的现场）==');
  {
    const s1 = await boot({ mode: 'std', random: 'hit', stale: 'old' });
    const healed = await s1.waitFor(() => {
      const q = JSON.parse(localStorage.getItem('xy-home-v2:incoming-requests') || '[]');
      return !q.some((x) => x.status === 'pending' && Date.now() - (x.ts || 0) > 10 * 60 * 1000);
    }, null, 12000);
    const st = await s1.state();
    ok('跨会话陈旧 pending 被释放（不再永久挡住该联系人）', healed && PEND(st) <= 1, st.queue.map((x) => x.cid + ':' + x.status));
    ok('释放后恢复投递（弹窗真的弹出来了）', st.maskOpen && MODAL.test(st.maskTitle), st.maskTitle);
    const seenKeep = st.queue.filter((x) => x.status === 'seen' && x.kind === 'checkin');
    ok('释放是转 seen 留痕，不是悄悄删条目（历史可见）', seenKeep.length >= 1, st.queue);
    const rel = (st.probe && st.probe.releases) || [];
    ok('释放动作进了诊断可见的释放日志', rel.some((r) => /孤儿|pending/.test(r)), rel);
    await s1.close();
  }
  {
    const s2 = await boot({ mode: 'std', random: 'hit', stale: 'fresh' });
    await sleep(1600); // 让 queue() 真跑上几轮，取样太早会把「没来得及自愈」看成「不抢」
    const st = await s2.state();
    const freshAlive = st.queue.filter((x) => x.cid === 'cmtprobe1' && x.status === 'pending');
    ok('未超存活的 foreign pending 不抢（别的标签页正在处理，不去动它）', freshAlive.length === 1, st.queue.map((x) => x.cid + ':' + x.status));
    await s2.close();
  }

  // ================= T3 本会话弹窗被顶掉 → 对账释放 =================
  console.log('\n== T3 活弹窗被别的弹窗顶掉后对账释放 ==');
  {
    const s3 = await boot({ mode: 'std', random: 'hit' });
    await s3.waitFor(() => {
      const q = JSON.parse(localStorage.getItem('xy-home-v2:incoming-requests') || '[]');
      return q.some((x) => x.status === 'pending');
    }, null, 12000);
    const before = await s3.state();
    const cid = (before.queue.filter((x) => x.status === 'pending')[0] || {}).cid || '';
    ok('前置：该联系人已有一条 pending 且弹窗在屏', !!cid && before.maskOpen, before.queue);
    await s3.setOpenModal('占位弹窗顶它');
    const released = await s3.waitFor((c) => {
      const q = JSON.parse(localStorage.getItem('xy-home-v2:incoming-requests') || '[]');
      return !q.some((x) => x.cid === c && x.status === 'pending');
    }, cid, 8000);
    const st = await s3.state();
    ok('弹窗消失未应答 → 下一轮对账释放该 pending（旧版此处永久卡死）', released && PEND(st, cid) === 0, { cid, q: st.queue.map((x) => x.cid + ':' + x.status) });
    ok('对账后不再登记为活弹窗（live 归零）', !!st.probe && st.probe.live === 0, st.probe);
    ok('释放原因是「弹窗消失」，写进释放日志', ((st.probe && st.probe.releases) || []).some((r) => /弹窗消失/.test(r)), st.probe && st.probe.releases);
    await s3.close();
  }

  // ================= T4 浮层占屏：让路上限后照投 =================
  console.log('\n== T4 浮层占用先让路、到上限照投 ==');
  {
    const s4 = await boot({ mode: 'std', random: 'miss' });
    await s4.waitFor(() => (window.__mochiIncomingProbe ? window.__mochiIncomingProbe().ticks : 0) >= 2, null, 8000);
    const occupied = await s4.occupyAndRoll();
    const base = ((await s4.state()).probe || {}).ticks || 0;
    await sleep(1400); // ≈3 个轮询周期：让路窗口用固定时长取，不靠探针计数（探针缺失时会假绿）
    const st3 = await s4.state();
    const elapsed = st3.probe ? st3.probe.ticks - base : 99;
    ok('前置：占用浮层可控（#tc-mask 存在且能置为可见）', occupied === true, occupied);
    ok('浮层占用时先让路（连续几轮不投，不顶掉用户正在看的弹层）', elapsed >= 2 && PEND(st3) === 0, { elapsed, q: st3.queue.map((x) => x.cid + ':' + x.status) });
    ok('让路期间不消耗冷却', Object.keys(st3.last).length === 0, st3.last);
    ok('让路计数与上限口径可见（闸门=浮层占用让路 n/3）', /浮层占用让路/.test((st3.probe || {}).gate || ''), st3.probe && st3.probe.gate);
    const escaped = await s4.waitFor(() => {
      const q = JSON.parse(localStorage.getItem('xy-home-v2:incoming-requests') || '[]');
      return q.some((x) => x.status === 'pending');
    }, null, 12000);
    const st4 = await s4.state();
    ok('长期占屏到上限后照投（软互斥不会变成新的永不触发）', escaped && PEND(st4) === 1 && MODAL.test(st4.maskTitle), { gate: st4.probe && st4.probe.gate, title: st4.maskTitle, q: st4.queue.map((x) => x.cid + ':' + x.status) });
    await s4.close();
  }

  // ================= T5 打字期绝不顶 =================
  console.log('\n== T5 正在打字时不抢焦点 ==');
  {
    const s5 = await boot({ mode: 'std', random: 'miss' });
    await s5.waitFor(() => (window.__mochiIncomingProbe ? window.__mochiIncomingProbe().ticks : 0) >= 2, null, 8000);
    await s5.focusAndRoll();
    const many = await s5.waitFor(() => (window.__mochiIncomingProbe ? window.__mochiIncomingProbe().ticks : 0) >= 8, null, 10000);
    const st = await s5.state();
    const focused = await s5.page.evaluate(() => document.activeElement && document.activeElement.id === 'probe-kb');
    ok('前置：整段被测窗口焦点一直在打字框里（否则这条断言是假绿）', focused === true, focused);
    ok('打字期多轮过去仍不投递（IME 组合中的字不会被抢焦点丢掉）', many && PEND(st) === 0 && !MODAL.test(st.maskTitle), { pend: PEND(st), gate: st.probe && st.probe.gate });
    ok('闸门口径=输入中暂停（诊断能直接说出为什么没弹）', /输入中暂停/.test((st.probe || {}).gate || ''), st.probe && st.probe.gate);
    await s5.close();
  }

  // ================= T6 锁屏期不投 + 解锁恢复 =================
  console.log('\n== T6 应用锁/问答门在屏时不投 ==');
  {
    const s6 = await boot({ mode: 'std', random: 'miss' });
    await s6.waitFor(() => (window.__mochiIncomingProbe ? window.__mochiIncomingProbe().ticks : 0) >= 2, null, 8000);
    await s6.lockAndRoll();
    await s6.waitFor(() => (window.__mochiIncomingProbe ? window.__mochiIncomingProbe().ticks : 0) >= 7, null, 10000);
    const st1 = await s6.state();
    ok('锁屏期整轮不掷（弹窗不会压在锁屏底下、解完锁才发现）', PEND(st1) === 0 && !MODAL.test(st1.maskTitle), { pend: PEND(st1), maskTitle: st1.maskTitle, gate: st1.probe && st1.probe.gate });
    ok('锁屏闸门口径=锁屏中', /锁屏中/.test((st1.probe || {}).gate || ''), st1.probe && st1.probe.gate);
    await s6.releaseAll();
    const back = await s6.waitFor(() => {
      const q = JSON.parse(localStorage.getItem('xy-home-v2:incoming-requests') || '[]');
      return q.some((x) => x.status === 'pending');
    }, null, 10000);
    const st2 = await s6.state();
    ok('解锁后当轮即恢复投递（不用等冷却/下一次冷启动）', back && PEND(st2) === 1, { pend: PEND(st2), gate: st2.probe && st2.probe.gate });
    await s6.close();
  }

  // ================= T7/T8 手动触发 → 「稍后」正常释放 → 可再触发；未处理期间不重复 =================
  console.log('\n== T7/T8 应答链路与去重 ==');
  {
    const s7 = await boot({ mode: 'std', random: 'miss' });
    await s7.waitFor(() => !!window.triggerIncomingCheckin, null, 8000);
    const first = await s7.page.evaluate(() => window.triggerIncomingCheckin('cmtprobe1'));
    const st1 = await s7.state();
    ok('手动触发跨桌面查岗成功（开关开+题库有题）', first === true && st1.maskOpen && /来查岗了/.test(st1.maskTitle), { first, title: st1.maskTitle });
    const second = await s7.page.evaluate(() => window.triggerIncomingCheckin('cmtprobe1'));
    const st2 = await s7.state();
    // #1478 重基线（本批改的是「什么时候落盘」，不是「要不要记这一条」）：库里这一键还没回话的窗口里，
    //   整包写回会被扣一拍、等权威并集再落，所以「LS 立刻看得见这一条」不再是契约。判据改成
    //   「LS 那份有且只有这一条，或页面自己那本账（探针 qids）记着这一条 pending」——两个读数都拿不到
    //   才算红；LS 里叠出第二条仍然算红。核心守卫一字未减：同一联系人未处理期间不许再投第二条。
    const t8Ls = st2.queue.filter((x) => x.cid === 'cmtprobe1');
    const t8Page = ((st2.probe || {}).qids || []).filter((s) => s.indexOf('cmtprobe1:pending') === 0);
    ok('同一联系人未处理期间不重复投递（不叠弹窗、不叠记录）', second === false && t8Ls.length <= 1 && (t8Ls.length === 1 || t8Page.length === 1), { second, q: st2.queue.map((x) => x.cid + ':' + x.status), qids: (st2.probe || {}).qids });
    const clicked = await s7.page.evaluate(() => {
      const pills = Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill'));
      const later = pills.filter((b) => /稍后/.test(b.textContent))[0];
      if (!later) return 'no-pill';
      later.click();
      document.getElementById('modal-ok').click();
      return 'ok';
    });
    await new Promise((r) => setTimeout(r, 600));
    const st3 = await s7.state();
    ok('点「稍后」+确认 → pending 正常释放（happy path 没被守卫挡住）', clicked === 'ok' && PEND(st3) === 0 && !st3.maskOpen, { clicked, pend: PEND(st3) });
    ok('应答后不再登记活弹窗', !!st3.probe && st3.probe.live === 0, st3.probe);
    const third = await s7.page.evaluate(() => window.triggerIncomingCheckin('cmtprobe1'));
    ok('释放后该联系人可以再次触发（队列没被卡死）', third === true, third);
    await s7.page.evaluate(() => {
      const pills = Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill'));
      const later = pills.filter((b) => /稍后/.test(b.textContent))[0];
      if (later) later.click();
      document.getElementById('modal-ok').click();
    });
    await s7.close();
  }

  // ================= T10 源码静态接线 =================
  console.log('\n== T10 源码静态接线 ==');
  {
    const ir = readFileSync(join(srcDir, 'js', 'incoming-requests.js'), 'utf8');
    const dv = readFileSync(join(srcDir, 'js', 'device.js'), 'utf8');
    ok('投递记录写会话归属 + 陈旧孤儿按 TTL 释放（自愈本体）', /req\.sid = SESSION_ID/.test(ir) && /x\.sid !== SESSION_ID && now - \(x\.ts \|\| 0\) > PENDING_TTL_MS/.test(ir));
    ok('活弹窗登记表 + 对账释放（弹窗消失即解锁该联系人）', /liveModals\[req\.cid\] = title/.test(ir) && /titleEl\.textContent === liveModals\[cid\]/.test(ir));
    ok('前台浮层互斥清单含通话面板（顶掉弹窗的三条路径都挡）', /\['modal-mask', 'tc-mask', 'qa-mask', 'call-mask'\]/.test(ir));
    ok('锁屏/打字/浮层三态闸门齐备，让路上限后有照投（防饿死）', /if \(hardLocked\(\)\) return;/.test(ir) && /if \(typingBusy\(\)\) return;/.test(ir) && /busyTicks <= BUSY_ESCAPE/.test(ir) && /busyTicks = 0; escape = true/.test(ir));
    ok('首查提前到 12s（短会话也掷得到）+ 回前台补掷一次', /setTimeout\(startIncomingTick, 12000\)/.test(ir) && /'visibilitychange'/.test(ir));
    ok('跨桌面调度不掺机型分支（设备无关，不会按型号复发）', !/userAgent|iPhone|iPad/.test(ir));
    ok('诊断信息里打印跨桌面来消息现场（下次报障有第一手数据）', dv.includes("'跨桌面来消息体检：轮询 '") && /window\.__mochiIncomingProbe && window\.__mochiIncomingProbe\(\)/.test(dv));
    if (process.env.PRODUCT) {
      let built = '';
      try { built = readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) {}
      ok('构建产物已接入本批修复（产物与 src 同步）', built.includes('跨桌面来消息体检') && /x\.sid !== SESSION_ID/.test(built));
    } else {
      console.log('  ℹ INFO: 未设 PRODUCT=1，跳过产物断言（构建由构建者统一执行）');
    }
  }

  // ================= T11 无未捕获异常 =================
  console.log('\n== T11 运行期异常 ==');
  ok('全部场景加载至今无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 4));
} finally {
  try { await browser.close(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败' + (process.env.SRCDIR ? '（SRCDIR=' + process.env.SRCDIR + '）' : ''));
process.exit(fail ? 1 : 0);
