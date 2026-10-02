// ===== 常驻回归脚本 #1356：①在飞的 TA 回复要过得了页面回收 ②一条动态里不许把同一张卡原样重复
// 用法：node tools/verify-1356-feed-card-diversity.mjs [被测根目录]（或 SERVE_ROOT=…）
//
// 现场（用户 2026-09-28 直派：荣耀畅玩40Plus(RKY-AN00)／Android 12／夸克 10.18.6；随附
//   mochi-diag-2026-09-28-05-36-59…：LS 写探针「写入失败(QuotaExceededError)」、整域 4035 键 ≈20MB
//   其中第三方站点占 18MB、本页被系统回收过 59 次、回复时间=1~540s、回复字卡池 池text=1／自定义字卡=515）：
//   ①「发消息联系人不显示正在输入中了，就莫名其妙的感觉消息被吞了」
//      ＝TA 的被动回复只活在一枚 setTimeout 里（chat.js scheduleReply），页面被回收/重开＝那一发
//      连同定时器一起消失；重开后屏上最后一条永远是【自己发的】，既没有「正在输入中」也永远不来回音。
//      无头实测（红侧逐字读数）：回复设 8~8s，发出 2s 后重开页面 → 此后 40s 内
//      taRepliesAfterMine 恒 0、typing 恒 0、库里最后一条永远是那条 out。
//      这台机「回收 59 次 × 等待窗最长 540 秒」⇒ 几乎每一发回复都跨过一次回收；
//      Chromium/WebKit/各家安卓内核都会这么杀页面＝用户口径的「其他设备型号也有出现」。
//   ②「朋友圈还老是只发一个反复的文字比如：1 1 1 1 1 1 1 或 1 2 1 2 1 2」
//      ＝makePicker 那句「池子抽完一轮后重新洗牌再继续」在池子只剩 1~2 张时是空头承诺——重洗回来
//      还是同一张，而 genPostContent 照「每条拼 minCardsPost~maxCardsPost（默认 4~15）张」硬抽。
//      无头实测：库内只剩 1 张文字卡（其余 514 张是媒体/颜文字/令牌形态，被 #948 四道守卫剔出文字池）
//      且系统预设按 #319 默认锁定时 feedPoolFor textN=2 ⇒ 生成的动态逐字复现用户给的两种形态。
//
// 收口（两处，判据一律零机型／零 UA 分支）：
//   A feed.js #1356a~c：makePicker 加「抽干」一档（noWrap 时抽完返回 undefined）；两个生成器
//     ①要拼的张数取「设定」与「这一轮真拿得出的不重复张数」的较小者，②文字桶抽干后落到站内
//     现成的内置对话兜底池 fb（旧写法只在池子全空时用它），两条腿都抽干＝收笔。池子够深时逐字行为不变。
//   B chat.js #1356d~f：权威落定那一刻（与 #180 尾巴日志回放、#1200 中转箱回填同一段）按 msgs 自己
//     认一次「欠」：最后一条是本场开始之前自己发的正文卡、其后没有任何 in 侧内容、且仍在产品自己
//     定义的「TA 最长会打多久」(#1326 chatTypingHorizonMs) 之内 ⇒ 先亮「正在输入中」再走同一条
//     replyOnce 管线补投。零新增存储键（口径同 #1180「计数源＝msgs 自身…重载天然复原」）；
//     夜间静默／#1180 限流／无回应档照旧各自拦这一发。
//
// 断言（feed 半边）：
//   S 组 本批新契约的逻辑锚（名字在、实现被换掉照样红）；S4~S6 顺带守住已落库的 chat 半边
//   A 组 朋友圈生成：A1 夹具诚实（池子真被压到 ≤3 张）／A2 症状本体＝连发 12 条不许有原样重复的卡／
//     A3 不许修过头＝正文不许被收成空／A4 池子够深时照旧按设定铺开多张／A5 富池连发 12 条也零重复
//   Z1 全程零未捕获 JS 异常
// 注：②的 chat 半边（补投只补一发／计数钩子在场／旧尾巴与系统卡不算欠）由常驻件
//   tools/verify-1356-owed-reply.mjs 守着——那条尺子的夹具对「重开后产品自带随机链往聊天插 in 侧内容」更稳，
//   本脚本不重复跑聊天时序，免得两处夹具互相污染。
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
const feedSrc = readFileSync(join(root, 'js/feed.js'), 'utf8');
const chatSrc = readFileSync(join(root, 'js/chat.js'), 'utf8');
console.log('\nS 组 本批新契约的逻辑锚');
t(feedSrc.includes('if (noWrap && dealt) return undefined;'), 'S1 抽取器有「抽干」这一档（#1356a）');
t(feedSrc.includes('!(take(pick.text) || take(pick.fb))'), 'S2 评论/回复这一族：抽干落兜底池、两腿都干即收笔（#1356b）');
t(feedSrc.includes('take(pick.text, textParts) || take(pick.fb, textParts)'), 'S3 TA 发动态这一族同一条口径（#1356c）');
t(chatSrc.includes('last.ts >= CHAT_SESSION_START'), 'S4 欠账只认上一场留下的那一条（#1356d）');
t(chatSrc.includes('if (age > chatTypingHorizonMs()) return;'), 'S5 期限从「TA 最长会打多久」读，不从机型读（#1356e）');
t(chatSrc.includes('chatReplyDebtCheck(myPrefix)'), 'S6 权威落定那一刻回头看 msgs 自己（#1356f）');
t(!/Quark|HONOR|RKY-AN00|iPhone/i.test(feedSrc.replace(/\/\/.*$/gm, '')), 'S7 本批两个文件里零机型／零 UA 字面量（注释除外）');

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
const idbPut = (key, val) => page.evaluate(async ([k, v]) => {
  const db = await new Promise((res, rej) => { const rq = indexedDB.open('mochi-db', 1); rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains('kv')) rq.result.createObjectStore('kv'); }; rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(new Error('open')); });
  await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = rej; });
  db.close();
  return true;
}, [key, val]);

// ————— A 组：朋友圈生成不许把同一张卡原样重复 —————
console.log('\nA 组 朋友圈生成（薄字卡池）');
const TEXT_CARD = '今晚月色真美';
const pad = 'A'.repeat(300);
const thinLib = JSON.stringify({
  text: [['默认组', [TEXT_CARD]]],
  kaomoji: [['默认组', ['(￣▽￣)', '(ノД`)・゜・。', '(๑•̀ㅂ•́)و✧']]],
  emoji: [['默认组', ['🙂', '😊']]],
  sticker: [['默认组', Array.from({ length: 120 }, (_, i) => 'data:image/png;base64,' + pad + i)]],
  image: [['默认组', Array.from({ length: 40 }, (_, i) => 'data:image/png;base64,' + pad + 'y' + i)]],
  poke: [['默认组', ['拍了拍脑袋']]], voice: []
});
await boot();
await idbPut('xy-home-v2:cc-groups-public', thinLib);
// 关掉夜间静默：这一组要量的是生成器本身，夜间档另有 verify-night-mode-silence 守着
await page.evaluate(() => { try { window.setNightModeEn && window.setNightModeEn(false); } catch (e) {} });
await page.reload({ waitUntil: 'domcontentloaded' });
await boot();
const pool = await page.evaluate(() => (window.feedPoolFor ? window.feedPoolFor('default') : null));
t(!!pool && pool.textN > 0 && pool.textN <= 3, 'A1 夹具诚实：系统预设锁定时文字桶真的只剩 ≤3 张（否则下面全组读数无意义）', JSON.stringify(pool));
const genThin = await page.evaluate(() => {
  const out = [];
  if (!window.feedGenProbe) return out;
  for (let i = 0; i < 12; i++) out.push(window.feedGenProbe('default'));
  return out;
});
const dupOf = (content) => {
  const toks = String(content || '').split(' ').filter((s) => s);
  const seen = new Set(); const rep = [];
  toks.forEach((s) => { if (seen.has(s)) rep.push(s); seen.add(s); });
  return rep;
};
const thinDups = genThin.map((g) => dupOf(g && g.content)).filter((a) => a.length);
// 探针在场性先行：读数拿不到时下面几条会「假绿」（两侧同 0/0 往往只是没跑起来）
t(genThin.length === 12 && genThin.every((g) => g && typeof g.content === 'string'), 'A1b 探针在场：12 次生成都要拿得到读数（否则下面几条无意义）', '拿到 ' + genThin.filter((g) => g).length + '/12');
t(genThin.length === 12 && thinDups.length === 0, 'A2 症状本体：薄池连发 12 条动态，一条里都不该出现原样重复的卡（＝用户所见「1 1 1 1」「1 2 1 2」）',
  '重复的条数=' + thinDups.length + ' 样例=' + JSON.stringify((genThin[0] || {}).content || '').slice(0, 90) + ' 红侧样例重复=' + JSON.stringify((thinDups[0] || [])[0] || ''));
const cardN = (g) => (g ? String(g.content || '').split(' ').filter((s) => s).length + (g.imgN || 0) : 0);
t(genThin.length === 12 && genThin.every((g) => cardN(g) > 0), 'A3 不许修过头：一条动态不许被收成空白（少拼一张可以，一张不发不行）',
  '空条数=' + genThin.filter((g) => cardN(g) === 0).length);
// 解锁系统预设 ⇒ 池子够深（这才是绝大多数设备的日常形态）
await page.evaluate(() => { try { window.xyStore('xy-home-v2').set('cardlock-state', 'open'); document.dispatchEvent(new Event('mochi-cardlock-open')); } catch (e) {} });
await page.waitForTimeout(500);
const poolRich = await page.evaluate(() => (window.feedPoolFor ? window.feedPoolFor('default') : null));
const genRich = await page.evaluate(() => {
  const out = [];
  if (!window.feedGenProbe) return out;
  for (let i = 0; i < 12; i++) out.push(window.feedGenProbe('default'));
  return out;
});
const richCounts = genRich.map(cardN);
t(!!poolRich && poolRich.textN > 200, 'A4a 解锁后池子真的变深了（富池夹具成立）', JSON.stringify(poolRich));
t(Math.max.apply(null, richCounts) >= 4, 'A4b 旧契约：池子够深时照旧按「每条拼 4~15 张」的设定铺开（新闸不许把动态一律收成一句）', '最长一条张数=' + Math.max.apply(null, richCounts));
const richDups = genRich.map((g) => dupOf(g && g.content)).filter((a) => a.length);
t(genRich.length === 12 && richDups.length === 0, 'A5 旧契约：富池连发 12 条同样零原样重复（判据不是只挑窄池才成立）');


console.log('\nZ 组 全程零未捕获异常');
t(errs.length === 0, 'Z1 被测产物在本电池全程没有抛出未捕获异常', errs.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log('\n结果：' + pass + ' 绿 / ' + fail + ' 红 —— ' + root);
process.exit(fail ? 1 : 0);
