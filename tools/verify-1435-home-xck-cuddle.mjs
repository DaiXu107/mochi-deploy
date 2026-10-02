// ===== 专项回归 #1435：主页三栏记录（对我查岗／跨桌面查岗／邀请贴贴）＋两类弹窗的「等人」口径 =====
// 作者原话（2026-09-29，四条）：
//   ①「现在桌面的【主页】功能里缺少联系人【邀请贴贴】和【联系人对我查岗】和【联系人跨桌面查岗】的记录」
//   ②「跨桌面查岗查我的记录错过了弹窗没有选择【确认】不会显示在那个联系人的聊天里，保持这个规则，
//      但可以保存到那个联系人的【联系人跨桌面查岗】的记录里」
//   ③「新增当我把浏览器放在后台时，收到了联系人跨桌面查岗的消息弹窗，跨桌面查岗可以和联系人打电话一样等我几分钟」
//   ④「【邀请贴贴】弹窗是和其他提问弹窗一样不会自己关闭，切换后台回来也能看到」
// 落点与判据（三处最容易改错的地方，本脚本各钉一族）：
//   A. 三栏记录的**身份判据**：查岗卡与询问卡同为 special='ask-card'，唯一分别是 ta-ask.js:918 带 askTs、
//      跨桌面那张带 deskCk（chat.js:7533）。判据写成「!askTs && !deskCk」；谁把它简化成
//      「special==='ask-card'」，询问就会冒充查岗（「TA的关心」原来就是这个毛病）。
//   B. 「错过未回应」**只进记录、不进聊天**：②是两句话，只钉后半句会退化成「错过就塞进聊天」，
//      只钉前半句会让错过彻底无痕。所以既有正向（记录里出现 missed）也有反向（聊天条数一字不动）。
//   C. 贴贴弹窗**不许再「有别的层就当作同意」**：旧 openInviteConfirm 第一行就是这个语义，
//      反向断言钉住「占屏期间聊天里绝不出现『你接受了』」，正向断言钉住「层空下来之后会补弹」。
// 用法：node tools/verify-1435-home-xck-cuddle.mjs
//       SRCDIR=<src目录> PRODUCT=1 node tools/verify-1435-home-xck-cuddle.mjs   # 红绿对照
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, statSync, rmSync } from 'node:fs';
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
const srcOf = (rel) => { try { return readFileSync(join(srcDir, rel), 'utf8'); } catch (e) { return ''; } }
const prodOf = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch (e) { return ''; } }

// ---------- 源码 / 产物静态断言（S 组）----------
const srcRec = srcOf('js/records.js');
const srcIr = srcOf('js/incoming-requests.js');
const srcChat = srcOf('js/chat.js');
const srcTpl = srcOf('template.html');
const srcCall = srcOf('js/call.js');
const srcHub = srcOf('js/feature-hub.js');
const srcNotice = srcOf('pwa/notice.json');
const srcFd = srcOf('js/feature-data.js');
const bm = prodOf('build.mjs');

console.log('\n== S 源码静态：三栏记录的身份判据与落点 ==');
{
  const tabs = ['ck', 'xck', 'cuddle'];
  const tabMiss = tabs.filter((t) => srcTpl.indexOf('data-htab="' + t + '"') < 0 || srcTpl.indexOf('id="home-' + t + '"') < 0);
  ok('S1 主页三栏的 tab 与面板锚点齐备（ck／xck／cuddle 各自成对）', tabMiss.length === 0, tabMiss);
  const fnMiss = ['function renderCkPanel()', 'function renderXckPanel()', 'function renderCuddlePanel()'].filter((n) => srcRec.indexOf(n) < 0);
  ok('S2 records.js 三个渲染函数都在（缺一个＝那一栏点开永远是空的）', fnMiss.length === 0, fnMiss);
  const dispMiss = ["if (showOnly === 'ck') {", "if (showOnly === 'xck') {", "if (showOnly === 'cuddle') {"].filter((n) => srcRec.indexOf(n) < 0);
  ok('S3 render() 里三条分派都在（tab 点了不渲染＝分派丢了）', dispMiss.length === 0, dispMiss);
  ok('S4 对我查岗的身份判据是「非询问、非跨桌面」两条同时排（简化成只判 ask-card 就会把 TA 的询问当查岗）',
    srcRec.includes('m.special === \'ask-card\' && m.askQuestion && !m.askTs && !m.deskCk'));
  ok('S5 跨桌面栏的结局三值齐全（replied／later／missed），错过那一行明写「没点【确认】，聊天里没有这条」',
    /replied: '点了「现在回TA」/.test(srcRec) && /later: '选了稍后/.test(srcRec) && /missed: '错过未回应（没点【确认】，聊天里没有这条）/.test(srcRec));
  ok('S6 「TA的关心」不再列查岗两类（作者①的「移出来，各归各 tab」；旧行标签字符串必须整体消失）',
    !srcRec.includes("'桌面查岗 · '") && !srcRec.includes('KIND_ICON.checkin'), [srcRec.includes("'桌面查岗 · '"), srcRec.includes('KIND_ICON.checkin')]);
  ok('S7 贴贴记录是一条邀请一行：同 ts 去重＋结局就地改（写成 push 第二次就多出一行）',
    srcRec.includes('list.some(x => x && x.ts === rec.ts)') && srcRec.includes('x.res = res; hit = true;'));
  ok('S8 贴贴记录按 ts 摘行、不按渲染下标（#1403 那族 unshift＋下标删错行的事故不再犯）',
    srcRec.includes('const left = arr.filter(x => x && Number(x.ts) !== ts);') && !/catchesLoad\(\)[\s\S]{0,80}splice\(/.test(srcRec.slice(srcRec.indexOf('renderCuddlePanel'))));
  ok('S9 贴贴数组不封顶（作者「我都要保存历史记录」＝只靠折叠与按条删，谁加 slice 谁推翻口径）',
    !/records-cuddle'[^]{0,80}\.slice\(0,/.test(srcRec));
  ok('S10 新键 records-cuddle / records-cuddle-pending 由 feature-data 的 /^records-(?!coin)/ 认领（换机导得出去、清得掉）',
    srcFd.includes('/^records-(?!coin)/') && srcChat.includes("const CP_KEY = 'records-cuddle-pending';"));
}

console.log('\n== S 源码静态：跨桌面查岗「挂起等人」与「错过不落聊天」==');
{
  ok('S11 后台挂起时长与通话同口径＝3 分钟（作者③「和联系人打电话一样」）',
    srcIr.includes('const CK_BG_HOLD_MS = 3 * 60 * 1000;') && srcCall.includes('const CALL_HOLD_MS = 3 * 60 * 1000;'));
  ok('S12 后台命中的查岗打挂起标记并随队列落盘（丢了这行＝回前台认不出哪条在等）',
    srcIr.includes("if (document.hidden && req.kind === 'checkin') req.bgHold = 1;"));
  ok('S13 回前台/每轮轮询都有挂起收尾（重投或记错过），且收尾排在夜间/锁屏闸之前（否则夜间模式会让它永不回账）',
    srcIr.includes('function resumeHeldCheckins() {') &&
    srcIr.indexOf('resumeHeldCheckins();') < srcIr.indexOf('if (window.nightModeActive && window.nightModeActive()) return;'),
    [srcIr.indexOf('resumeHeldCheckins();'), srcIr.indexOf('if (window.nightModeActive && window.nightModeActive()) return;')]);
  // 反向：错过那一次绝不落聊天——「只写记录」这条函数体里不许出现任何写聊天的调用
  const missedBody = (srcIr.split('function recordMissedCheckin(req) {')[1] || '').split('\n  }')[0];
  ok('S14 错过未回应的落账体只写记录，一次都不碰聊天（作者②前半句「不进聊天」是硬规则）',
    missedBody.length > 0 && !/chatAppendDeskCkTo|chatAddIn|chatAddSystem|chatAppendDeskTextTo/.test(missedBody) &&
    missedBody.includes("'desk-checkin'") && missedBody.includes("'missed'"), missedBody.slice(0, 90));
  // 反向：后台分支里那句「命中即把卡写进 TA 桌面聊天」的裸调用必须消失（「稍后」那条带 try 包裹的仍在）
  ok('S15 后台命中不再「直接塞卡进聊天」（删除型：那行裸调用不在；点「稍后」那条带 try 的仍在，两码事）',
    !/^\s*if \(window\.chatAppendDeskCkTo\) window\.chatAppendDeskCkTo\(req\.cid, req\.q\);$/m.test(srcIr) &&
    srcIr.includes('try { if (window.chatAppendDeskCkTo) window.chatAppendDeskCkTo(req.cid, req.q); } catch (e) {}'));
  ok('S16 前台弹窗本体收在 showPopup 一处，首次投递与挂起重投共用（拆成两份＝默认选中与回调口径会分家）',
    srcIr.includes('function showPopup(req) {') && (srcIr.split('showPopup(').length - 1) >= 3 &&
    srcIr.includes("pill: req.kind === 'call' ? undefined : 'reply'"));
  ok('S17 弹窗被顶/关闭未应答的查岗走同一条对账补记（与 #441 那族来电补记并排，不是新写一套）',
    srcIr.includes("var wasCk = queue().filter(function (x) { return x.cid === cid && x.status === 'pending' && x.kind === 'checkin'; }).pop() || null;") &&
    /if \(wasCk\) recordMissedCheckin\(wasCk\);/.test(srcIr));
  ok('S18 跨桌面求聊天/来电的后台口径一字未动（作者只点名查岗，顺手改坏隔壁那条是要命的）',
    srcIr.includes("if (window.chatAppendDeskTextTo) window.chatAppendDeskTextTo(req.cid, req.text || '想你了，来聊聊天吧。');") &&
    srcIr.includes('if (window.callHoldIncoming) window.callHoldIncoming(name, req.cid, av);'));
}

console.log('\n== S 源码静态：贴贴弹窗不自动关＋挂起重投 ==');
{
  ok('S19 贴贴这一路先走挂起入口（别的层占屏／后台／正好刷新都不算回答）',
    srcChat.includes('if (_cuddleInv && window.queueCuddleInvite) {') && srcChat.includes('window.queueCuddleInvite = function (payload) {'));
  ok('S20 挂起键 10 分钟上限（作者选的那档：10 分钟内回来就还在，超时记错过）',
    srcChat.includes("const CP_HOLD_MS = 10 * 60 * 1000;"));
  ok('S21 贴贴弹窗本体没有「已有层就 onAccept」那句（旧 openInviteConfirm 的静默同意是这次要根治的根因）',
    !(function () { const body = (srcChat.split('function _cpOpen(p, cid) {')[1] || '').split('\nreturn true;\n}')[0]; return /onAccept\(\)/.test(body); })());
  ok('S22 回答后同时回收挂起键＋改写记录结局（只回收键＝记录永远挂着待回应；只改记录＝下次回来又弹一遍）',
    srcChat.includes('window.clearCuddleInvitePending(cid, p.ts)') && srcChat.includes("window.setCuddleRecordResult(cid, p.ts, accepted ? 'replied' : 'declined')"));
  ok('S23 回前台/切桌面/数据就绪三个时机都补投（作者④的「切换后台回来也能看到」覆盖这三条路径）',
    /\['mochi-fg-resume', 'contact-switched', 'mochi-restore-done'\]/.test(srcChat) && srcChat.includes('window.mochiOnDataReady'));
  ok('S24 心跳只在有挂起时存在、落定即停（不留常驻定时器是这一族的硬约束）',
    srcChat.includes('if (!_cpTimer) _cpTimer = setInterval(_cpTick, CP_TICK_MS);') && srcChat.includes('if (!_cpAny()) _cpStop();'));
  ok('S25 本批三处判据零机型／零 UA 分支（不允许按 iPhone/Android/Chrome 分岔）',
    !/iPhone|iPad|userAgent|Android|HarmonyOS/.test(srcIr) &&
    !/iPhone|iPad|userAgent|Android|HarmonyOS/.test(srcRec) &&
    !/iPhone|iPad|userAgent/.test((srcChat.split('const CP_KEY')[1] || '').split('\n};\n')[0]));
  const sent = ['#1435a', '#1435b', '#1435c', '#1435d', '#1435e', '#1435f', '#1435g', '#1435h', '#1435i', '#1435j', '#1435k', '#1435l', '#1435m', '#1435n', '#1435o', '#1435p', '#1435q', '#1435r', '#1435s', '#1435t'];
  const sentMissing = sent.filter((n) => bm.indexOf(n) < 0);
  ok('S26 build.mjs：#1435a~t 二十条哨兵在位', sentMissing.length === 0, sentMissing);
  // 每条针不只是「名字在册」——逐条把它登记的 needle 拿去自己那个 src 文件里数一次（名字在、锚指空＝哑针）
  const entries = (bm.split('\n').filter((l) => /^  \{ name: '#1435/.test(l)));
  const dumb = [];
  for (const l of entries) {
    let e = null;
    try { e = new Function('return {' + l.trim().replace(/^\{ /, '').replace(/ \},?$/, '') + '}')(); } catch (err) { dumb.push(['解析失败', l.slice(0, 18)]); continue; }
    const s = srcOf(e.file.startsWith('pwa/') ? e.file : (e.file === 'template.html' ? 'template.html' : e.file));
    const c = s.split(e.needle).length - 1;
    if (c !== 1) dumb.push([e.name.slice(0, 7), c]);
  }
  ok('S26b 二十条针各自在自己文件里恰好命中一次（哑哨兵＝闸门瞎掉，比缺针更坏）', entries.length === 20 && dumb.length === 0, dumb);
  ok('S27 文案面同步：功能大全两行主页条目＋跨桌面查岗功能说明（#1502 起开屏公告不再复述该章，改判「不得回流」）',
    srcHub.includes('联系人跨桌面查岗（含错过未回应的）') && srcIr.includes('快回来回应，TA 会等你几分钟') &&
    srcNotice.indexOf('关于查岗与贴贴：主页多了三栏记录') < 0 &&
    (() => { try { const d = JSON.parse(srcNotice); return /关于后台通知相关设置/.test(d.sections[d.sections.length - 1].h); } catch (e) { return false; } })());
  // #1416 那族口径：整栏 innerHTML 重画的列表必须把月块开合态交给 mochiHistFold 的模块级 map，
  // 且每张列表一枚自己的前缀——不写 key 就全站的月块共用 'hist'，在查岗栏展开「8 月」会顺手掀开别栏。
  const foldKeys = ["key: 'records-ck'", "key: 'records-xck'", "key: 'records-cuddle'"];
  const keyMiss = foldKeys.filter((k) => srcRec.indexOf(k) < 0);
  ok('S28 三个新栏各自带折叠态前缀（开合态活过整栏重画，且不与别栏共用同一个 hist 桶）', keyMiss.length === 0, keyMiss);
}

// ---------- 无头行为断言 ----------
// SKIP_UI=1：只跑 S 组静态断言（变异对照时用——把某条机制改坏后先看哪几条针应红，不必等两分钟无头）
if (process.env.SKIP_UI) {
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败（SKIP_UI=1，未跑无头行为组）');
  process.exit(fail ? 1 : 0);
}
// 测试专用组装：按 build.mjs 同顺序拼临时 index.html（不碰仓库产物，避免与构建者撞车）
const buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8');
const grab = (name) => JSON.parse(buildSrc.match(new RegExp('const ' + name + " = (\\[[^\\]]*\\])"))[1].replace(/'/g, '"'));
const cssFiles = grab('cssFiles'), jsFiles = grab('jsFiles');
let html = readFileSync(join(srcDir, 'template.html'), 'utf8');
html = html.replace('/*__STYLES__*/', () => cssFiles.map((f) => readFileSync(join(srcDir, 'css', f), 'utf8')).join('\n'));
html = html.replace('/*__SCRIPTS__*/', () => jsFiles.map((f) => '(function(){ try {\n' + readFileSync(join(srcDir, 'js', f), 'utf8') + '\n} catch(e){ console.error("[JS]", e && e.message); } })();').join('\n'));
html = html.split('__BUILD_INFO__').join('verify-1435').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-p1435-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), html);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(tmpRoot, decodeURIComponent(req.url.split('?')[0])));
    if (!statSync(p).isFile()) p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!statSync(p).isFile()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true });
const pageErrors = [];
const D = 'xy-home-v2:default:';
const A = 'xy-home-v2:cmtprobe1:'; // 阿明（第二个桌面，用来测跨桌面）

/**
 * 起一个干净会话（独立 context＝独立 localStorage）。
 * opts.seed：一段字符串，在 addInitScript 里 eval（种聊天/记录/挂起键）
 * opts.advanceMs：把 Date.now 往前拨（测超时用，自己推钟而不是等）
 * opts.hiddenNow：开局就把 document.hidden/visibilityState 钉成后台
 */
async function boot(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const local = [];
  ctx.on('page', (p) => { p.on('pageerror', (e) => { local.push(String(e && e.message).slice(0, 160)); }); });
  await ctx.addInitScript(([seed, advanceMs, hiddenNow]) => {
    if (!/^https?:/.test(location.href)) return; // about:blank 没有 localStorage，别在这里造异常（Z1 会误报）
    localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{ id: 'default', name: '小美' }, { id: 'cmtprobe1', name: '阿明' }]));
    localStorage.setItem('xy-home-v2:active-contact', 'default');
    localStorage.setItem('xy-home-v2:desk-checkin-en', '1');
    localStorage.setItem('xy-home-v2:desk-call-en', '0');
    localStorage.setItem('xy-home-v2:desk-freq-mode', 'std');
    localStorage.setItem('xy-home-v2:migrated-v1', '1');
    localStorage.setItem('xy-home-v2:applock-en', '0');
    localStorage.setItem('xy-home-v2:applock-qa-en', '0');
    localStorage.setItem('xy-home-v2:applock-qaskip', '1');
    localStorage.setItem('xy-home-v2:bg-notify', '0');
    localStorage.setItem('xy-home-v2:psync-en', '0');
    localStorage.setItem('xy-home-v2:onboarding-done', '1');
    // 两枚常驻引导弹层先静音（不静音它们会抢走全站唯一的 #modal-mask，本批所有弹窗断言全变假红）：
    //   · clock.js:328「系统字卡未解锁」——cardLockOpen() 为真就不弹
    //   · storage-guide.js:57「更新完成 · 存储修复引导」——GUIDE_ID 旗标对上就不弹
    localStorage.setItem('xy-home-v2:cardlock-state', 'open');
    localStorage.setItem('xy-home-v2:storage-guide-shown', '1250');
    localStorage.setItem('xy-home-v2:__last-backup', String(Date.now())); // 产品内建的备份提醒别在中途抢 #modal-mask
    if (seed) { try { (new Function(seed))(); } catch (e) {} }
    // 一切自动触发全部落空：只测显式调用，屏上不会自己冒出别的弹窗。
    // 0.999 而不是 0.9——hit(p) 判的是 Math.random()*100 < p，钉 0.9 时所有 p>90 的闸（摸鱼/打工那类
    // 每日结算）照样必中，夹具里就会攒出一串「能摸到我吗」的自动拍一拍，与本次要落的系统消息抢同一次
    // 读改写（聊天数组是整份 store.set 写回的），把刚落的消息顶掉＝P5 假红。
    Math.random = () => 0.999;
    if (advanceMs) { const _n = Date.now.bind(Date); Date.now = () => _n() + advanceMs; }
    if (hiddenNow) {
      window.__forceHidden = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => !!window.__forceHidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__forceHidden ? 'hidden' : 'visible') });
    }
    const _st = window.setTimeout, _si = window.setInterval;
    window.setTimeout = function (fn, d) { return _st(fn, Math.min(d || 0, 300), ...[].slice.call(arguments, 2)); };
    window.setInterval = function (fn, d) { return _si(fn, Math.max(240, Math.min(d || 300, 400)), ...[].slice.call(arguments, 2)); };
  }, [opts.seed || '', opts.advanceMs || 0, !!opts.hiddenNow]);
  const page = await ctx.newPage();
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  page.setDefaultTimeout(15000);
  // 开屏与常驻引导层一律先撤掉（不撤会把后面的断言全变成假红）
  await page.evaluate(() => {
    try { const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click(); } catch (x) {}
    try { const s = document.getElementById('splash'); if (s && !s.classList.contains('hide')) { s.classList.add('hide'); s.hidden = true; } } catch (x) {}
    ['modal-mask', 'tc-mask', 'qa-mask', 'call-mask', 'applock-mask'].forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = true; });
    return true;
  });
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 12000 }).catch(() => {});
  // 引导弹层的第二道闸：旗标同时写进 IDB（idbRestore 会用 IDB 值回填 LS，只写 LS 会被顶掉），
  // 并挂一把「只摘引导层、不摘被测层」的小扫罩——它认标题，不认 mask 本身。
  await page.evaluate(() => {
    try { if (window.idbSet) { window.idbSet('xy-home-v2:storage-guide-shown', '1250'); window.idbSet('xy-home-v2:cardlock-state', 'open'); } } catch (e) {}
    if (window.__ckGuideSweep) return true;
    window.__ckGuideSweep = setInterval(() => {
      try {
        const mask = document.getElementById('modal-mask');
        const t = document.getElementById('modal-title');
        if (mask && !mask.hidden && t && /存储修复引导|系统字卡未解锁|更新完成|字卡不多/.test(t.textContent)) mask.hidden = true;
      } catch (e) {}
    }, 250);
    return true;
  });
  await sleep(500);
  // 系统通知改成本机可数的桩（不改变被测逻辑，只是让「发了什么」可断言）
  await page.evaluate(() => {
    window.__nb = [];
    const _o = window.bgNotifyCheck;
    window.bgNotifyCheck = function (t, ts, o) { window.__nb.push({ t: String(t), o: o && o.name }); if (_o) { try { return _o(t, ts, o); } catch (e) {} } return true; };
    return true;
  });
  return {
    ctx, page, local,
    async close() { pageErrors.push(...local); try { await ctx.close(); } catch (e) {} },
    ev: (fn, arg) => page.evaluate(fn, arg),
    wait: (fn, arg, ms) => page.waitForFunction(fn, arg, { timeout: ms || 12000 }).then(() => true).catch(() => false),
    openHome: async (tab) => {
      await page.evaluate(() => {
        const app = document.querySelector('.app[data-app="home"]');
        if (app) app.click();
        return true;
      });
      await sleep(400);
      if (tab) {
        await page.evaluate((t) => {
          const b = document.querySelector('#page-home .fav-tab[data-htab="' + t + '"]');
          if (b) b.click();
          return true;
        }, tab);
        await sleep(400);
      }
      return page.evaluate((t) => {
        const el = document.getElementById('home-' + t);
        const vis = !!el && !el.closest('.cal-card').hidden;
        return { vis, text: el ? el.textContent : '', rows: el ? el.querySelectorAll('.tc-listitem').length : -1, dels: el ? el.querySelectorAll('.hist-del').length : -1, blocks: el ? el.querySelectorAll('details.dc-h-more').length : -1 };
      }, tab);
    },
    state: () => page.evaluate(() => ({
      queue: JSON.parse(localStorage.getItem('xy-home-v2:incoming-requests') || '[]'),
      mask: !document.getElementById('modal-mask').hidden,
      maskTitle: document.getElementById('modal-title') ? document.getElementById('modal-title').textContent : '',
      pills: Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill')).map((b) => ({ t: b.textContent, on: b.classList.contains('on') })),
      okText: (document.getElementById('modal-ok') || {}).textContent,
      nb: window.__nb || [],
      chatD: JSON.parse(localStorage.getItem('xy-home-v2:default:chat-msgs') || '[]').length,
      chatA: JSON.parse(localStorage.getItem('xy-home-v2:cmtprobe1:chat-msgs') || '[]').length,
      careD: JSON.parse(localStorage.getItem('xy-home-v2:default:records-care') || '[]'),
      careA: JSON.parse(localStorage.getItem('xy-home-v2:cmtprobe1:records-care') || '[]'),
      cuD: JSON.parse(localStorage.getItem('xy-home-v2:default:records-cuddle') || '[]'),
      pendD: localStorage.getItem('xy-home-v2:default:records-cuddle-pending'),
      probe: window.__mochiIncomingProbe ? window.__mochiIncomingProbe() : null
    })),
    setHidden: (v) => page.evaluate((x) => {
      if (!Object.getOwnPropertyDescriptor(document, 'hidden') || !document.__ckPatched) {
        window.__forceHidden = !!x;
        try {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => !!window.__forceHidden });
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__forceHidden ? 'hidden' : 'visible') });
          document.__ckPatched = 1;
        } catch (e) {}
      } else { window.__forceHidden = !!x; }
      document.dispatchEvent(new Event('visibilitychange'));
      return document.hidden;
    }, v),
    fgResume: () => page.evaluate(() => { document.dispatchEvent(new Event('mochi-fg-resume')); return true; }),
    // 夹具诚实：别的桌面的聊天必须走**应用自己的写口**（idbSet＋LS 双写）落一份，IDB 里真有这个键。
    // 只直写 localStorage 是个现实中不存在的状态——#358 那道「防整包覆盖」守卫会认定「探测在说谎」，
    // 宁可 5×2s 重试也不写回（正确行为），而我的轮询预算比它短 ⇒ X9 会假红成「稍后没落卡」。
    seedDeskChat: (cid, n) => page.evaluate(async ([c, cnt]) => {
      const key = 'xy-home-v2:' + c + ':chat-msgs';
      const arr = [];
      for (let i = 0; i < cnt; i++) arr.push({ side: 'out', text: '原有第 ' + i + ' 条', ts: Date.now() - 90000 + i });
      const s = JSON.stringify(arr);
      try { if (window.idbSet) await window.idbSet(key, s); } catch (e) {}
      try { localStorage.setItem(key, s); } catch (e) {}
      return true;
    }, [cid, n]),
    answerModal: (pillText) => page.evaluate((t) => {
      const pills = Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill'));
      const hit = pills.filter((b) => b.textContent.indexOf(t) >= 0)[0];
      if (hit) hit.click();
      const okb = document.getElementById('modal-ok');
      if (okb) okb.click();
      return true;
    }, pillText)
  };
}

// 常见种子：三种卡各一张（桌内查岗／带 askTs 的询问／带 deskCk 的跨桌面），外加一条提示语与番茄陪伴记录
const SEED_CHAT = "localStorage.setItem('xy-home-v2:default:chat-msgs', JSON.stringify([" +
  "{side:'in',text:'在干嘛呢？抬头看看我',special:'ask-card',askQuestion:'在干嘛呢？抬头看看我',askType:'text',ts:Date.now()-60000}," +
  "{side:'in',text:'你今天心情怎么样',special:'ask-card',askQuestion:'你今天心情怎么样',askType:'text',askTs:Date.now()-50000,ts:Date.now()-50000}," +
  "{side:'in',text:'刚才那道题',special:'ask-card',askQuestion:'刚才那道题答过了',askType:'text',deskCk:true,deskCkDir:'toMe',askAnswer:'答过了',ts:Date.now()-40000}," +
  "{side:'in',text:'TA 来查岗了。',special:'ask-msg',ts:Date.now()-40000}," +
  "{side:'in',text:'已回答的那道',special:'ask-card',askQuestion:'晚饭吃了吗',askAnswer:'吃了，面',askType:'text',ts:Date.now()-30000}" +
  "]));";
const SEED_CARE = "localStorage.setItem('xy-home-v2:default:records-care', JSON.stringify([" +
  "{kind:'pomo',text:'',ts:Date.now()-20000}," +
  "{kind:'desk-checkin',text:'在忙什么呢',ts:Date.now()-15000,res:'missed'}," +
  "{kind:'desk-checkin',text:'现在方便吗',ts:Date.now()-10000,res:'replied'}" +
  "]));" +
  "localStorage.setItem('xy-home-v2:cmtprobe1:records-care', JSON.stringify([{kind:'desk-checkin',text:'睡了吗',ts:Date.now()-9000,res:'later'}]));";

try {
  // ================= G 主页三栏记录 =================
  console.log('\n== G 主页三栏记录（真实渲染）==');
  {
    const s = await boot({ seed: SEED_CHAT + SEED_CARE });
    const ck = await s.openHome('ck');
    // 种子五条消息里，这一栏只该有两条：桌内查岗未答 ＋ 桌内查岗已答。
    // 第三条带 askTs（询问）、第四条带 deskCk（跨桌面）按身份判据排掉；那条「TA 来查岗了。」提示语
    // 与 deskCk 卡同一毫秒，被 30s 内的问卡守卫（#588 那条二分）判为重复而不单列——是设计，不是漏。
    ok('G1 「联系人对我查岗」点开就有内容，且只列该列的两条（多余的那两类一条都不许混进来）', ck.vis && ck.rows === 2, ck);
    ok('G2 桌内查岗卡列出来了，且带问题原文', /在干嘛呢？抬头看看我/.test(ck.text), ck.text.slice(0, 120));
    ok('G3 TA 的询问（带 askTs）没有混进查岗栏（作者要的是「查岗」，不是所有 ask-card）', !/你今天心情怎么样/.test(ck.text), ck.text.slice(0, 200));
    ok('G4 跨桌面那张卡（deskCk）不在「对我查岗」里（它归另一栏）', !/刚才那道题答过了/.test(ck.text), ck.text.slice(0, 200));
    ok('G5 已回答／待回答两种状态都如实写（没答的不谎称「已回答」）', /已回答：吃了，面/.test(ck.text) && /还没回答/.test(ck.text), ck.text.slice(0, 200));
    const xck = await s.openHome('xck');
    ok('G6 「联系人跨桌面查岗」按联系人聚合：小美两条＋阿明一条都在', xck.vis && xck.rows >= 3 && /阿明/.test(xck.text), xck);
    ok('G7 错过未回应那行明写「没点【确认】，聊天里没有这条」（作者②的后半句在界面上可见）', /错过未回应（没点【确认】，聊天里没有这条）/.test(xck.text), xck.text.slice(0, 240));
    ok('G8 点了确认／选了稍后的各标自己的结局，没答的不会被冒充', /点了「现在回TA」/.test(xck.text) && /选了稍后/.test(xck.text), xck.text.slice(0, 240));
    ok('G9 跨桌面卡与它的记录同一次事件只出一行（±90s 去重仍在，不重复列）', !/刚才那道题答过了/.test(xck.text) || xck.rows <= 4, xck.rows);
    const care = await s.openHome('care');
    ok('G10 「TA的关心」里查岗两类已经不出现（作者选「各归各 tab」），番茄陪伴照旧在', care.vis && /番茄钟陪伴/.test(care.text) && !/查岗/.test(care.text), care.text.slice(0, 200));
    ok('G11 关心栏仍是汇总视图：只折叠，没有按条删除按钮（#1403 那条设计决定不被顺手推翻）', care.dels === 0, care);
    const cu = await s.openHome('cuddle');
    ok('G12 贴贴栏空态说得过去（没有记录时说「暂无」，不谎报也不留白）', cu.vis && /暂无贴贴邀请记录/.test(cu.text), cu.text.slice(0, 120));
    await s.close();
  }

  // ================= H 折叠与按条删（贴贴是自己的数组）=================
  console.log('\n== H 贴贴记录：一条邀请一行＋折叠＋按条删 ==');
  {
    const old = Date.now() - 45 * 864e5;
    const s = await boot({ seed: "localStorage.setItem('xy-home-v2:default:records-cuddle', JSON.stringify([{ts:" + (Date.now() - 5000) + ",text:'来贴贴嘛',res:'pending'},{ts:" + old + ",text:'想蹭蹭你',res:'replied'}]));" });
    await s.ev(() => { try { window.addCuddleRecordFor('default', { ts: Date.now() - 4000, text: '抱抱', res: 'pending' }); } catch (e) {} return true; });
    // 用数组里真实那个 ts 改结局（自己另算一次 Date.now 会差出几百毫秒，就成了「尺子以为没改」的假红）
    const upd = await s.ev(() => {
      try {
        const l = JSON.parse(localStorage.getItem('xy-home-v2:default:records-cuddle') || '[]');
        const row = l.filter((x) => x && x.text === '来贴贴嘛')[0];
        if (!row) return { ok: false };
        const before = l.length;
        const hit = window.setCuddleRecordResult('default', row.ts, 'declined');
        const after = JSON.parse(localStorage.getItem('xy-home-v2:default:records-cuddle') || '[]');
        return { ok: hit === true && after.length === before, rows: after.length };
      } catch (e) { return { ok: false, err: String(e) }; }
    });
    const cu = await s.openHome('cuddle');
    ok('H1 三条邀请三行（今天两条直显＋更早折进月块，不封顶不裁条）', cu.rows >= 2 && cu.blocks >= 1 && /抱抱/.test(cu.text), cu);
    ok('H2 同一 ts 的结局被就地改写且不增行（写成再 push 一条就多出一行「你拒绝了」）', upd.ok === true && /你拒绝了/.test(cu.text) && cu.rows === 3, { upd, rows: cu.rows });
    ok('H3 更早那条按月折进月块，条数标注在 summary 上', /想蹭蹭你/.test(cu.text) && /\d+ 条/.test(cu.text), cu.text.slice(0, 220));
    // 摘掉中间那一条（认 data-hist-label，别认「第一枚」——列表是 unshift 序，认第一枚会连坐隔壁那条）
    await s.ev(() => {
      const b = Array.prototype.slice.call(document.querySelectorAll('#home-cuddle .hist-del')).filter((x) => /来贴贴嘛/.test(x.getAttribute('data-hist-label') || ''))[0];
      if (b) b.click();
      return true;
    });
    await sleep(500);
    const modalTitle = await s.ev(() => (document.getElementById('modal-title') || {}).textContent);
    ok('H4 删除前先问一次（走全站唯一弹窗方案，不用 confirm）', /删除这条贴贴邀请记录/.test(String(modalTitle)), modalTitle);
    await s.ev(() => { const b = document.getElementById('modal-ok'); if (b) b.click(); return true; });
    await sleep(600);
    const cu2 = await s.openHome('cuddle');
    const st = await s.state();
    ok('H5 删一条只少那一条（3→2），不是清空、也不是整月', cu2.rows === 2 && /抱抱/.test(cu2.text), cu2);
    ok('H6 摘掉的是点中的那条（按 ts 摘行；按下标删会在 unshift 之后删错行）', st.cuD.length === 2 && !st.cuD.some((x) => x.text === '来贴贴嘛') && st.cuD.some((x) => x.text === '抱抱'), st.cuD);
    await s.close();
  }

  // ================= P 贴贴弹窗：不自动关＋占屏让路＋回前台重投 =================
  console.log('\n== P 贴贴弹窗（作者④）==');
  {
    const s = await boot({});
    const r = await s.ev(() => { try { return window.queueCuddleInvite({ name: '小美', text: '来贴贴嘛' }); } catch (e) { return 'ERR:' + e.message; } });
    await sleep(600);
    const st = await s.state();
    ok('P1 触发即弹出「小美 的贴贴邀请」（弹窗本体只有一份）', r === true && st.mask && /小美 的贴贴邀请/.test(st.maskTitle), st.maskTitle);
    ok('P2 同意／拒绝两枚胶囊齐备且默认选中「同意」（沿用邀请弹窗原口径）', st.pills.length === 2 && !!st.pills.filter((p) => p.t.indexOf('同意') >= 0 && p.on)[0], st.pills);
    ok('P3 挂起键与主页记录同时落下（res=pending）', !!st.pendD && st.cuD.length === 1 && st.cuD[0].res === 'pending', st.cuD);
    // 不自动关：点遮罩无效 + 时间流逝也不收
    await s.ev(() => { const m = document.getElementById('modal-mask'); if (m) m.click(); return true; });
    await sleep(2500);
    const st2 = await s.state();
    ok('P4 点遮罩不关、且没有自动关闭定时器（放着 2 秒多仍在屏上）', st2.mask === true, st2.maskTitle);
    // 回答：同意 → 系统消息 + 结局改写 + 挂起回收
    await s.answerModal('同意');
    await sleep(800);
    const st3 = await s.state();
    // 扫整表而不是「最后 4 条」：夹具里 TA 的自动行为仍可能往聊天追加（见 boot 里钉 Math.random 那段），
    // 只看尾巴会把刚落的系统消息挤出窗口＝假红。判据是「这条系统消息在不在」，不是「在第几条」。
    // 再给 3 秒轮询：落库是整份数组写回，与别的写入者抢一次时最坏会晚一帧。
    const landed = await s.wait(() => {
      try { return (JSON.parse(localStorage.getItem('xy-home-v2:default:chat-msgs') || '[]')).some((m) => /你接受了 小美 的贴贴邀请/.test(String(m.text || ''))); } catch (e) { return false; }
    }, null, 3000);
    const allMsgs = await s.ev(() => {
      try { return (JSON.parse(localStorage.getItem('xy-home-v2:default:chat-msgs') || '[]')).map((m) => String(m.text || '').slice(0, 30)); } catch (e) { return []; }
    });
    ok('P5 点同意：系统消息落进聊天（不是只震动一下）', landed === true, allMsgs.slice(-5));
    ok('P6 回答后挂起键被回收，记录结局改成「已同意」（同一条不重复弹）', st3.pendD === null && st3.cuD.length === 1 && st3.cuD[0].res === 'replied', st3.cuD);
    await s.close();
  }
  {
    const s = await boot({});
    // 屏幕上正有别的东西：贴贴必须让路，而且绝不能「当作同意」
    await s.ev(() => { window.openModal('占位弹窗', '', function () {}, { noInput: true, staticText: '别的层占着屏' }); return true; });
    const r = await s.ev(() => { try { return window.queueCuddleInvite({ name: '小美', text: '来贴贴嘛' }); } catch (e) { return 'ERR:' + e.message; } });
    await sleep(700);
    const st = await s.state();
    const chatRaw = await s.ev(() => localStorage.getItem('xy-home-v2:default:chat-msgs') || '');
    ok('P7 占屏时贴贴不抢弹窗（屏幕上是占位那一条）', r === true && /占位弹窗/.test(st.maskTitle), st.maskTitle);
    ok('P8 占屏期间绝不被「静默当作同意」：聊天里没有接受字样，记录仍是待回应', !/你接受了/.test(chatRaw) && st.cuD.length === 1 && st.cuD[0].res === 'pending', { chat: chatRaw.slice(0, 120), cu: st.cuD });
    ok('P9 挂起键留在原处等下一轮（这就是「切后台回来还能看到」的凭据）', !!st.pendD, st.pendD);
    // 层空下来 + 回前台信号 → 补弹
    await s.ev(() => { document.getElementById('modal-mask').hidden = true; return true; });
    await s.fgResume();
    await sleep(700);
    const st2 = await s.state();
    ok('P10 层空下来后补弹同一条（mochi-fg-resume 那条通道真的会重投）', st2.mask && /小美 的贴贴邀请/.test(st2.maskTitle), st2.maskTitle);
    await s.close();
  }
  {
    const s = await boot({ hiddenNow: true });
    await s.ev(() => { try { window.queueCuddleInvite({ name: '小美', text: '在后台发的那条' }); } catch (e) {} return true; });
    await sleep(700);
    const st = await s.state();
    ok('P11 页面在后台时不弹（弹了也看不见），但挂起键与记录照旧落下', st.mask === false && !!st.pendD && st.cuD.length === 1, st);
    await s.setHidden(false);
    await s.fgResume();
    await sleep(700);
    const st2 = await s.state();
    ok('P12 切回前台就看到它（作者④点名的这条路径）', st2.mask && /贴贴邀请/.test(st2.maskTitle), st2.maskTitle);
    await s.close();
  }
  {
    // 冷启动带着 11 分钟前的挂起：应当收口成「错过未回应」，而不是把旧邀请再弹一遍
    const s = await boot({ seed: "localStorage.setItem('xy-home-v2:default:records-cuddle', JSON.stringify([{ts:" + (Date.now() - 11 * 60000) + ",text:'很久以前那条',res:'pending'}]));localStorage.setItem('xy-home-v2:default:records-cuddle-pending', JSON.stringify({ts:" + (Date.now() - 11 * 60000) + ",text:'很久以前那条',name:'小美'}));" });
    await s.fgResume();
    const got = await s.wait(() => {
      try { const l = JSON.parse(localStorage.getItem('xy-home-v2:default:records-cuddle') || '[]'); return l.length === 1 && l[0].res === 'missed' && !localStorage.getItem('xy-home-v2:default:records-cuddle-pending'); } catch (e) { return false; }
    }, null, 12000);
    const st = await s.state();
    ok('P13 超过 10 分钟没回来＝记录标「错过未回应」并清掉挂起（不无限期 nag）', got && st.cuD[0].res === 'missed', st.cuD);
    const cu = await s.openHome('cuddle');
    ok('P14 错过的那一条在主页那一栏看得见（作者①要的「记录」包括错过的）', /错过未回应/.test(cu.text), cu.text.slice(0, 160));
    await s.close();
  }

  // ================= X 跨桌面查岗：后台挂起等人 + 错过只进记录 =================
  console.log('\n== X 跨桌面查岗（作者②③）==');
  {
    const s = await boot({ hiddenNow: true, seed: "localStorage.setItem('xy-home-v2:cmtprobe1:chat-msgs', JSON.stringify([{side:'out',text:'先说一句',ts:Date.now()-90000}]));localStorage.setItem('xy-home-v2:default:records-care', JSON.stringify([{kind:'pomo',text:'',ts:Date.now()-1000}]));" });
    await s.seedDeskChat('cmtprobe1', 1); // 走应用写口，见 boot() 里 seedDeskChat 那段注释
    await s.wait(() => (window.__mochiIncomingProbe ? window.__mochiIncomingProbe().ticks : 0) >= 2, null, 12000);
    const before = await s.state();
    const fired = await s.ev(() => { try { return window.triggerIncomingCheckin('cmtprobe1'); } catch (e) { return 'ERR:' + e.message; } });
    await sleep(700);
    const st = await s.state();
    const held = st.queue.filter((x) => x.cid === 'cmtprobe1' && x.kind === 'checkin');
    ok('X1 后台命中真的投出去了（返回 true，不是静默 return）', fired === true, fired);
    ok('X2 那条以「挂起」姿态留在队列里（bgHold=1、status=pending）', held.length === 1 && held[0].bgHold === 1 && held[0].status === 'pending', held);
    ok('X3 通知文案写明「快回来回应，TA 会等你几分钟」（作者③要的和打电话一样）', st.nb.some((n) => /快回来回应，TA 会等你几分钟/.test(n.t)), st.nb);
    ok('X4 后台命中不再把卡塞进 TA 桌面的聊天（对比组：条数一字不动）', st.chatA === before.chatA, { before: before.chatA, after: st.chatA });
    ok('X5 挂起阶段也还不写记录（结局未定，不能提前冒充「已回应／错过」）', st.careA.length === 0 && st.careD.length === before.careD.length, { careA: st.careA.length, careD: st.careD.length });
    // 回前台 → 重投同一个窗
    await s.setHidden(false);
    const shown = await s.wait(() => /来查岗了/.test((document.getElementById('modal-title') || {}).textContent || '') && !document.getElementById('modal-mask').hidden, null, 12000);
    const st2 = await s.state();
    ok('X6 回到前台弹的是同一个窗（标题／胶囊／默认选中都沿用那一份）', shown && /来查岗了/.test(st2.maskTitle) && !!st2.pills.filter((p) => /现在回TA/.test(p.t) && p.on)[0], { title: st2.maskTitle, pills: st2.pills });
    ok('X7 重投后这条不再是「挂起」（改交弹窗对账，避免重复投递）', st2.queue.filter((x) => x.cid === 'cmtprobe1' && x.status === 'pending').every((x) => !x.bgHold), st2.queue);
    ok('X8 此刻仍未进聊天、仍未写记录（点了【确认】才算数——作者②前半句）', st2.chatA === before.chatA && st2.careA.length === 0, st2.careA);
    // 点「稍后」→ 卡落聊天 + 记录 res=later
    await s.answerModal('稍后');
    // 跨桌面追加是「异步读 IDB → 合并 → 写回」还带重试预算（chatAppendDeskRec/#1200），
    // 定长 sleep 会在它重试期间读数＝假红。改成轮询等它落地，并把中转箱一起打出来：
    // 轮询到＝时序；轮询不到而箱里有货＝真没落聊天（那是应用缺陷，不是尺子的问题）。
    const grew = await s.wait(() => {
      try { return (JSON.parse(localStorage.getItem('xy-home-v2:cmtprobe1:chat-msgs') || '[]')).length > 1; } catch (e) { return false; }
    }, null, 12000); // 收口批补二：预算 8s→12s——应用写口自带 5×2s 重试（见上注释），8s 窗低于其最坏 10s＝本注释自己预言过的假红形态
    const st3 = await s.state();
    const inbox = await s.ev(() => { try { return JSON.parse(localStorage.getItem('xy-home-v2:cmtprobe1:chat-desk-inbox') || '[]').length; } catch (e) { return -1; } });
    ok('X9 选「稍后」：卡落进 TA 桌面聊天可补答，记录写「选了稍后」', grew && st3.chatA === before.chatA + 1 && st3.careA.some((x) => x.kind === 'desk-checkin' && x.res === 'later'), { chatA: st3.chatA, 中转箱: inbox, careA: st3.careA });
    await s.close();
  }
  {
    // 错过：弹窗开着时被顶掉/关闭，没点【确认】
    const s = await boot({ seed: "localStorage.setItem('xy-home-v2:cmtprobe1:chat-msgs', JSON.stringify([{side:'out',text:'先说一句',ts:Date.now()-90000}]));" });
    await s.seedDeskChat('cmtprobe1', 1); // 走应用写口，见 boot() 里 seedDeskChat 那段注释
    await s.wait(() => (window.__mochiIncomingProbe ? window.__mochiIncomingProbe().ticks : 0) >= 2, null, 12000);
    const before = await s.state();
    await s.ev(() => { try { return window.triggerIncomingCheckin('cmtprobe1'); } catch (e) { return false; } });
    await s.wait(() => /来查岗了/.test((document.getElementById('modal-title') || {}).textContent || ''), null, 10000);
    const openBefore = await s.state();
    ok('X10 前台触发时弹窗确实开着（后面的「错过」才有对照对象）', openBefore.mask === true, openBefore.maskTitle);
    // 模拟「被别的弹窗顶掉／返回键关掉」：直接把层撤了，回调永不触发
    await s.ev(() => { document.getElementById('modal-mask').hidden = true; return true; });
    await s.setHidden(false); // 借通道让对账立刻跑一轮
    const done = await s.wait(() => {
      try { const l = JSON.parse(localStorage.getItem('xy-home-v2:cmtprobe1:records-care') || '[]'); return l.some((x) => x.kind === 'desk-checkin' && x.res === 'missed'); } catch (e) { return false; }
    }, null, 12000);
    const st = await s.state();
    ok('X11 没点【确认】的那一次被记成「错过未回应」（作者②后半句：要保存到那个联系人的记录里）', done && st.careA.some((x) => x.res === 'missed'), st.careA);
    ok('X12 同一时间那条查岗没有进聊天（作者②前半句：保持不进聊天的规则）', st.chatA === before.chatA, { before: before.chatA, after: st.chatA });
    ok('X13 队列里那条被转成 seen 留痕，不会永久卡住这个联系人的后续触发', st.queue.filter((x) => x.cid === 'cmtprobe1' && x.status === 'pending').length === 0, st.queue);
    await s.close();
  }
  {
    // 超时：后台挂起后 4 分钟才回来（自己推钟，不等真时间）
    const s = await boot({ hiddenNow: true, advanceMs: 0, seed: "localStorage.setItem('xy-home-v2:cmtprobe1:chat-msgs', JSON.stringify([{side:'out',text:'先说一句',ts:Date.now()-90000}]));" });
    await s.seedDeskChat('cmtprobe1', 1); // 走应用写口，见 boot() 里 seedDeskChat 那段注释
    await s.wait(() => (window.__mochiIncomingProbe ? window.__mochiIncomingProbe().ticks : 0) >= 2, null, 12000);
    const before = await s.state();
    await s.ev(() => { try { window.triggerIncomingCheckin('cmtprobe1'); } catch (e) {} return true; });
    await sleep(500);
    const held = await s.state();
    ok('X14 挂起已就位（bgHold=1）', held.queue.some((x) => x.cid === 'cmtprobe1' && x.bgHold === 1), held.queue);
    // 把时钟往前推 4 分钟（超过 3 分钟挂起窗口），再回前台
    await s.ev(() => { const _n = Date.now.bind(Date); Date.now = () => _n() + 4 * 60 * 1000; return true; });
    await s.setHidden(false);
    await sleep(900);
    const st = await s.state();
    ok('X15 超过 3 分钟才回来＝不再补弹（窗口过了就过了，不搞「永远等你」）', !/来查岗了/.test(st.maskTitle) || st.mask === false, { mask: st.mask, title: st.maskTitle });
    ok('X16 超时同样收口成「错过未回应」，且不落聊天', st.careA.some((x) => x.res === 'missed') && st.chatA === before.chatA, { careA: st.careA, chatA: st.chatA });
    await s.close();
  }

  // ================= N 邻族不被连坐 + 桌面隔离 =================
  console.log('\n== N 归属与邻族 ==');
  {
    const s = await boot({ seed: SEED_CHAT + SEED_CARE + "localStorage.setItem('xy-home-v2:cmtprobe1:records-cuddle', JSON.stringify([{ts:" + (Date.now() - 3000) + ",text:'阿明桌面的那条',res:'pending'}]));" });
    const d1 = await s.openHome('cuddle');
    ok('N1 贴贴记录按桌面命名空间隔离：小美桌面没有阿明那条', !/阿明桌面的那条/.test(d1.text), d1.text.slice(0, 140));
    await s.ev(() => { try { window.setActiveContact('cmtprobe1'); } catch (e) {} return true; });
    await sleep(900);
    const d2 = await s.openHome('cuddle');
    ok('N2 切到阿明桌面就看得见它那一条（记录归属那条邀请自己的桌面）', /阿明桌面的那条/.test(d2.text), d2.text.slice(0, 160));
    const x2 = await s.openHome('xck');
    ok('N3 跨桌面栏在切换后仍聚合所有联系人的查岗（不是只显示当前桌面的）', /小美/.test(x2.text) && /阿明/.test(x2.text), x2.text.slice(0, 200));
    await s.close();
  }
  {
    // 求聊天与来电这两条隔壁路径必须一字不变（作者只点名查岗）
    const s = await boot({ hiddenNow: true });
    await s.wait(() => (window.__mochiIncomingProbe ? window.__mochiIncomingProbe().ticks : 0) >= 2, null, 12000);
    const before = await s.state();
    await s.ev(() => { try { window.__irChatProbe && window.__irChatProbe(); } catch (e) {} return true; });
    const okSeed = await s.ev(() => {
      // 直接走投递口：求聊天在后台仍应「把话写进 TA 桌面聊天 + 立刻 seen」
      try {
        const q = JSON.parse(localStorage.getItem('xy-home-v2:incoming-requests') || '[]');
        q.push({ cid: 'cmtprobe1', kind: 'chat', text: '想和你聊聊天，你有空吗？', ts: Date.now(), status: 'pending', sid: 's-foreign-probe' });
        localStorage.setItem('xy-home-v2:incoming-requests', JSON.stringify(q));
        return true;
      } catch (e) { return false; }
    });
    await sleep(900);
    const st = await s.state();
    ok('N4 求聊天的后台口径没被连坐（后台仍走「写进聊天＋通知」，不挂起）', okSeed === true && st.chatA >= before.chatA, { before: before.chatA, after: st.chatA });
    ok('N5 探针里 holding 与 pending 分得开（诊断读数不糊）', !!st.probe && typeof st.probe.holding === 'number', st.probe);
    await s.close();
  }

  // ================= Z 零未捕获异常 =================
  console.log('\n== Z 运行期 ==');
  // 底噪豁免（红侧＝纯 HEAD 副本同现，与本批无关，实测来自无头里 IDB 事务在页面关闭时被掐断）：
  // 只豁免这一条明确的环境信息，其余异常一律算红——不做「全静默」那种把尺子弄瞎的写法。
  const AMBIENT = /Failed to read the 'result' property from 'IDBRequest'/;
  const real = pageErrors.filter((e) => !AMBIENT.test(e));
  ok('Z1 全部场景加载至今无未捕获异常（豁免 IDB 关页底噪 ' + (pageErrors.length - real.length) + ' 条，红侧同现）', real.length === 0, real.slice(0, 4));
  if (process.env.PRODUCT) {
    const pHtml = prodOf('index.html'), pRec = prodOf('js/records.js'), pIr = prodOf('js/incoming-requests.js'), pChat = prodOf('js/chat.js');
    const prodMiss = [];
    if (!pHtml.includes('id="home-xck"')) prodMiss.push('index.html:home-xck');
    if (!pHtml.includes('id="home-cuddle"')) prodMiss.push('index.html:home-cuddle');
    if (!pRec.includes('function renderCkPanel()')) prodMiss.push('js/records.js:renderCkPanel');
    if (!pIr.includes('function resumeHeldCheckins()')) prodMiss.push('js/incoming-requests.js:resumeHeldCheckins');
    if (!pChat.includes("const CP_KEY = 'records-cuddle-pending';")) prodMiss.push('js/chat.js:CP_KEY');
    ok('Z2 产物已接入本批（src 与产物同步；构建由构建者统一执行）', prodMiss.length === 0, prodMiss);
  } else {
    console.log('  ℹ 未设 PRODUCT=1，跳过产物断言');
  }
} finally {
  try { await browser.close(); } catch (e) {}
  try { server.close(); } catch (e) {}
  for (let i = 0; i < 3; i++) { try { rmSync(tmpRoot, { recursive: true, force: true }); break; } catch (e) { await sleep(300); } }
}
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败' + (process.env.SRCDIR ? '（SRCDIR=' + srcDir + '）' : ''));
process.exit(fail ? 1 : 0);
