// ===== 常驻回归脚本 #1356（chat 半边）：在飞的 TA 回复要过得了页面回收 =====
// 用法：node tools/verify-1356-owed-reply.mjs [被测根目录]（或 SERVE_ROOT=…）
//
// 现场（用户 2026-09-28 直派：荣耀畅玩40Plus(RKY-AN00)／Android 12／夸克 10.18.6；2026-09-29
//   OPPO Find X9（PLJ110）／Edge 151 复报「联系人消息发不出来，对方输入中消失了之后还是一条消息
//   也没有发送出来」，两次都点名「其他设备型号也有出现、不要覆盖修改导致反复出现」）：
//   「发消息联系人不显示正在输入中了，就莫名其妙的感觉消息被吞了」
//   ＝TA 的被动回复只活在一枚 setTimeout 里（chat.js scheduleReply），页面被回收/重开＝那一发
//   连同定时器一起消失；重开后屏上最后一条永远是【自己发的】，既没有「正在输入中」也永远不来回音。
//   随附诊断件实测：本页被系统回收过 59/105 次、回复时间=1~540s ⇒ 等待窗几乎必然跨过一次回收；
//   Chromium/WebKit/各家安卓内核都会这么杀页面＝用户口径的「其他设备型号也有出现」。
//
// 收口（chat.js #1356d~f，判据零机型／零 UA 分支）：权威落定那一刻（与 #180 尾巴日志回放、
//   #1200 中转箱回填同一段）按 msgs 自己认一次「欠」：最后一条是本场开始之前自己发的正文卡、
//   其后没有任何 in 侧内容、且仍在产品自己定义的「TA 最长会打多久」(#1326 chatTypingHorizonMs)
//   之内 ⇒ 先亮「正在输入中」再走同一条 replyOnce 管线补投。零新增存储键（口径同 #1180
//   「计数源＝msgs 自身…重载/切桌面天然复原」）；夜间静默／#1180 限流／无回应档照旧各自拦这一发。
//   #1356 原批的 feed 半边（朋友圈反复同一张卡）另案，不在本脚本内。
//
// 断言：
//   S 组 本批新契约的逻辑锚（名字在、实现被换掉照样红）
//   B 组 在飞回复：B1 症状本体＝重开后 24s 内 TA 的回复要落进聊天／B2 补投只补一发／
//     B3 本批计数钩子在场（红侧＝0）／B4 补投先亮「正在输入中」／
//     B5 本场自己发的走原链路，只回一条（两侧皆绿＝旧契约没动）／
//     B6 一小时前的旧尾巴不算欠（两侧皆绿＝防「一律补投」的修过头）／
//     B7 最后一条是系统卡（special）不算欠（两侧皆绿）
//   Z1 全程零未捕获 JS 异常
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = resolve(normalize(process.argv[2] || process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || here));
if (!existsSync(join(root, 'index.html'))) {
  console.error('✗ 被测根目录没有 index.html（喂错目录了：所有断言会一起红，看起来像"修复没生效"）');
  process.exit(2);
}
console.log('serve root = ' + root);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(root, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port + '/';

let pass = 0, fail = 0;
const t = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + String(x).slice(0, 300) + ']' : '')); } };

// ————— S 组：只读产物文本的逻辑锚 —————
const chatSrc = readFileSync(join(root, 'js/chat.js'), 'utf8');
console.log('\nS 组 本批新契约的逻辑锚');
t(chatSrc.includes('last.ts >= CHAT_SESSION_START'), 'S1 欠账只认上一场留下的那一条（#1356d）');
t(chatSrc.includes('if (age > chatTypingHorizonMs()) return;'), 'S2 期限从「TA 最长会打多久」读，不从机型读（#1356e）');
t(chatSrc.includes('chatReplyDebtCheck(myPrefix)'), 'S3 权威落定那一刻回头看 msgs 自己（#1356f）');

// ————— 浏览器夹具 —————
const browser = await chromium.launch({ headless: true });
const errs = [];
// 报障机的结构条件：整域 localStorage 配额被同源第三方站点吃到 18MB ⇒ 本项目每一次 setItem 都抛
const ctx = await browser.newContext({ viewport: { width: 423, height: 853 }, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => {
  window.__lsThrowN = 0;
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (this === localStorage) {
      window.__lsThrowN++;
      const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; e.code = 22; throw e;
    }
    return orig.call(this, k, v);
  };
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

const boot = async () => {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    const s = document.querySelector('.splash'); if (s) s.remove();
    document.querySelectorAll('.backup-remind-bar, .ver-update-bar').forEach((n) => n.remove());
    const m = document.getElementById('modal-mask'); if (m) m.hidden = true;
  });
  await page.waitForFunction(() => window.mochiDataState && window.mochiDataState() === 'ready', null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
};
const openChat = async () => {
  await page.evaluate(() => {
    document.querySelectorAll('.page').forEach((p) => { p.hidden = true; });
    const pc = document.getElementById('page-chat'); if (pc) pc.hidden = false;
    if (window.enterChat) window.enterChat();
  });
  await page.waitForTimeout(2200);
};

// ————— B 组：在飞的回复要过得了回收 —————
console.log('\nB 组 上一场没落的那一发回复');
// 夹具诚实性：产品自带一批随机链（主动提问／好奇／吐槽／拍一拍／撤回／引用／无回应／主动发送）
// 会在每次重开后往聊天里插 in 侧内容，把本组的前提「末条是自己发的 out 卡」冲掉——实测同一脚本
// 在同一个 HEAD 产物上三次读数分别得 fired=0、fired≥1、末条被 ta-ask 的 in/ask-msg 改写。这些链
// 与本批修复无关，只负责把读数搅乱，故在夹具里按产品自己的存储键关掉（键表与邻族
// verify-1326-typing-and-tail-order 同一份，不新造闸门；零机型／零 UA 分支）。
const quietAuto = () => page.evaluate(() => {
  try {
    const s = window.activeStore();
    ['ta-ask', 'ta-choose', 'ta-curious', 'ta-roast', 'ta-tacc'].forEach(function (k) {
      try { const r = s.get(k); const d = r ? JSON.parse(r) : {}; d.settings = d.settings || {}; d.settings.enabled = false; s.set(k, JSON.stringify(d)); } catch (e) {}
    });
    s.set('dcf-ask', '0'); // #422「TA主动提问」总概率：五类提问链共用的那一道门
    ['as-en', 'rc-prob', 'rn-prob', 'touch-prob', 'py-en', 'quote-prob'].forEach(function (k) { s.set('reply-' + k, '0'); });
  } catch (e) {}
});
const setReply = async (sec) => {
  await quietAuto();
  await page.evaluate((s) => {
    const s2 = window.xyStore(window.activePrefix());
    s2.set('reply-rs-min', s); s2.set('reply-rs-max', s);
  }, sec);
};
const STATE = `(function(){var a=(window.getChatMsgs&&window.getChatMsgs())||[];
var mine=-1; for(var i=a.length-1;i>=0;i--){ if(a[i]&&(a[i].side||'')==='out'){ mine=i; break; } }
var inAfter=0; for(var j=mine+1;j<a.length;j++){ var r=a[j]; if(r&&(r.side||'')==='in'&&!(r.special||'')) inAfter++; }
var el=document.getElementById('chat-typing');
return JSON.stringify({n:a.length, taRepliesAfterMine:inAfter, typing: el&&!el.hidden?1:0, fired: window.__chatReplyDebtFired||0, lastSide:((a[a.length-1]||{}).side)||''});})()`;
const state = async () => { try { return JSON.parse(await page.evaluate(STATE)); } catch (e) { return {}; } };

// 造现场走产品自己的整包导入通道（它一并作废分块/尾巴日志/账本，重开之后库里就是这一份）
const seedHist = async (arr) => {
  await page.evaluate((a) => { try { window.chatImportMsgs(a); } catch (e) {} }, arr);
  await page.waitForTimeout(1600);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await boot();
  await quietAuto(); // 必须在 openChat（权威落定那一刻）之前：那一刻 msgs 的末条要还是我们种下的那条 out
  await openChat();
};
const mkArr = (lastTs, n, lastRec) => Array.from({ length: n }, (_, i) => (
  i === n - 1
    ? (lastRec || { side: 'out', text: '这一发之后页面被回收了', ts: lastTs })
    : { side: i % 2 ? 'in' : 'out', text: '历史第' + i + '条，正文长度正常。', ts: lastTs - (n - i) * 60000 }
));

// B1/B2/B3：上一场发的、没有回音的那一条 ⇒ 重开后要补投
// （回复时长设 30~30 秒＝把「TA 最长会打多久」这条线拉得比一次重开更宽，判据才有得谈）
await boot();
await setReply('30');
await seedHist(mkArr(Date.now(), 40));
let s1 = await state();
let sawTyping = s1.typing === 1;
for (let k = 0; k < 8 && !(s1.taRepliesAfterMine > 0); k++) { await page.waitForTimeout(3000); s1 = await state(); if (s1.typing === 1) sawTyping = true; }
t(s1.taRepliesAfterMine > 0, 'B1 症状本体：重开页面后 24s 内，TA 对上一场那一条的回复要真的落进聊天（红侧＝永远不出现＝用户「消息被吞」）', JSON.stringify(s1));
const fired = s1.fired;
await page.waitForTimeout(14000);
const s2 = await state();
t(s2.taRepliesAfterMine === s1.taRepliesAfterMine, 'B2 只补一发：再等 14s 不许又多出一条（同一条欠账被反复兑现）', 'before=' + s1.taRepliesAfterMine + ' after=' + s2.taRepliesAfterMine);
t(fired >= 1, 'B3 本批计数钩子在场（补投这条链真的跑过；红侧＝0）', 'fired=' + fired);
t(sawTyping || s2.taRepliesAfterMine > 0, 'B4 补投这一发仍然先亮「正在输入中」（与现场链路同一个模具）', 'typingSeen=' + sawTyping);

// B5：本场自己发的走原链路，不许被欠账判据重复兑现（旧契约，两侧皆绿）
await seedHist(mkArr(Date.now() - 3600 * 1000, 40));
const beforeOld = await state();
await page.evaluate(() => { window.chatSendMsg && window.chatSendMsg('本场发的这一发归原链路管'); });
await page.waitForTimeout(12000);
const afterOld = await state();
t(beforeOld.fired === 0 && afterOld.fired === 0, 'B5 旧契约：本场刚发的那一条不许被欠账判据重复兑现（一次回复两条气泡）', 'fired ' + beforeOld.fired + '→' + afterOld.fired);

// B6：一小时前的旧尾巴不算欠（防「一律补投」的修过头）
await seedHist(mkArr(Date.now() - 3600 * 1000, 40));
await page.waitForTimeout(9000);
const s3 = await state();
t(s3.fired === 0, 'B6 防修过头：一小时前的旧尾巴不是「欠」，不许凭空补出一条回复', JSON.stringify(s3));

// B7：最后一条是系统卡（special）不算欠
await seedHist(mkArr(Date.now(), 30, { side: 'out', special: 'gift', text: '送出一份礼物', ts: Date.now() }));
await page.waitForTimeout(9000);
const s4 = await state();
t(s4.fired === 0, 'B7 防修过头：最后一条是系统卡（special）不算「向 TA 说了一句话」，不补', JSON.stringify(s4));

console.log('\nZ 组 全程零未捕获异常');
t(errs.length === 0, 'Z1 被测产物在本电池全程没有抛出未捕获异常', errs.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log('\n结果：' + pass + ' 绿 / ' + fail + ' 红 —— ' + root);
process.exit(fail ? 1 : 0);