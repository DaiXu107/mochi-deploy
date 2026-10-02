// ===== 回归验证：#678 通话中仍被跨桌面来电打扰（OPPO Reno6 5G + 雨见浏览器，明说多机型）=====
// 报障：「明明一直通话中联系人还是会打电话过来」。
// 根因（incoming-requests.js 缺「电话占用」闸门）：
//   ① 跨桌面来电调度只靠 layerBusy() 看 #call-mask——通话最小化到悬浮小框后 call-mask 是
//      hidden，占用判定彻底失效，通话中照样弹「XX 来电了」；
//   ② 即使用大面板，浮层让路上限（BUSY_ESCAPE 3 轮）到期后交付被 force，硬顶通话画面；
//   ③ 切到别的桌面后，正在通话的联系人不再是「激活桌面」→ 连正在跟你通话的人都会再打一次。
//   ④ 弹窗里的「接听」会按 #441 设计直接挂断当前通话，代价是中断一通真实的电话。
// 修复（零机型分支）：call.js 新增 window.callInProgress()（currentCall 兜底读 call-active
//   标记，刷新/后台重建期间也算占用）；incoming-requests.js 通话中不掷来电 + deliver()
//   对 kind==='call' 硬闸（不入队、不写冷却、手动触发同样受闸）。
// 本脚本对「通话最小化后切桌面」的真实现场做行为断言（layerBusy 全绿=闸门是否真的在挡，
// 由修复前的 RED 对照证明）：
//   A. 基线：无通话时跨桌面来电照常投递（闸门不误伤）
//   B. 通话中（小框态，call-mask 隐藏）：跨桌面来电不再投递、冷却不被消耗
//   C. 通话中：手动触发 triggerIncomingCallReq 同样被拦
//   D. 挂断后：同一联系人恢复可投（闸门不是永久封锁）
//   E. 门语义：来电响铃/接通小框态为真；currentCall 为空但 call-active 标记新鲜也为真
//   F. 同桌面来电回归：通话中 triggerIncomingCall 不再启第二通电话
//   G. 静态接线（源文件逻辑锚点）+ 全程无未捕获异常
// 用法：node tools/verify-call-busy-gate.mjs
//       SRCDIR=<src目录> node tools/verify-call-busy-gate.mjs   # 对任意源快照做红绿对照
//       PRODUCT=1 node tools/verify-call-busy-gate.mjs          # 追加构建产物静态断言
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
html = html.split('__BUILD_INFO__').join('verify-busy').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-callbusy-' + Date.now());
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
 * 起一个干净页面会话。opts.callEn：起始跨桌面来电开关（'0' 起＝先不掷，用于把通话先立起来）。
 * 查岗/求聊天一律关闭，把这一轮的唯一变量收窄到「跨桌面来电」。
 */
async function boot(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const errsLocal = [];
  ctx.on('page', (p) => { p.on('pageerror', (e) => { errsLocal.push(String(e && e.message).slice(0, 160)); }); });
  await ctx.addInitScript(([o]) => {
    if (!/^https?:/.test(location.href)) return;
    localStorage.setItem('xy-home-v2:contacts', JSON.stringify([
      { id: 'default', name: '小美' }, { id: 'cmtprobe1', name: '阿明' }, { id: 'cmtprobe2', name: '小雪' }
    ]));
    localStorage.setItem('xy-home-v2:active-contact', 'default');
    localStorage.setItem('xy-home-v2:desk-freq-mode', 'freq');
    localStorage.setItem('xy-home-v2:desk-checkin-en', '0');   // 收窄变量：只留来电分支
    localStorage.setItem('xy-home-v2:desk-call-en', o.callEn === undefined ? '1' : o.callEn);
    localStorage.setItem('xy-home-v2:migrated-v1', '1');
    localStorage.setItem('xy-home-v2:applock-en', '0');
    localStorage.setItem('xy-home-v2:applock-qa-en', '0');
    localStorage.setItem('xy-home-v2:bg-notify', '0');
    localStorage.setItem('xy-home-v2:psync-en', '0');
    // 本桌面「联系人主动来电」概率归零：本脚本钉的是跨桌面来电闸门，别让同桌面定时器
    // 在压缩时间轴里自己响个不停（那会把「空闲态」基线搅成「永远通话中」的假红）。
    localStorage.setItem('xy-home-v2:default:reply-call-incoming', '0');
    // 备份提醒条/弹窗会在启动后占住 #modal-mask（浮层让路会让跨桌面弹窗投不出来）
    localStorage.setItem('xy-home-v2:__last-backup', String(Date.now()));
    localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now()));
    Math.random = () => 0.001;                                  // 概率必中
    const _st = window.setTimeout, _si = window.setInterval;    // 定时器压缩：轮询 60s → 0.5s
    window.setTimeout = function (fn, d) { return _st(fn, Math.min(d || 0, 400), ...[].slice.call(arguments, 2)); };
    window.setInterval = function (fn, d) { return _si(fn, Math.max(300, Math.min(d || 300, 500)), ...[].slice.call(arguments, 2)); };
  }, [opts]);
  const page = await ctx.newPage();
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  page.setDefaultTimeout(20000);
  return {
    ctx, page,
    async close() { pageErrors.push(...errsLocal); try { await ctx.close(); } catch (e) {} },
    state: () => page.evaluate(() => {
      const last = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('xy-home-v2:incoming-last:') === 0) last[k.slice('xy-home-v2:incoming-last:'.length)] = localStorage.getItem(k);
      }
      const mask = document.getElementById('modal-mask');
      const title = document.getElementById('modal-title');
      const cm = document.getElementById('call-mask');
      const mini = document.getElementById('call-mini');
      return {
        queue: JSON.parse(localStorage.getItem('xy-home-v2:incoming-requests') || '[]'),
        last,
        maskOpen: !!(mask && !mask.hidden),
        maskTitle: title ? title.textContent : '',
        callMaskOpen: !!(cm && !cm.hidden),
        callMiniOpen: !!(mini && !mini.hidden),
        call: window.getCallState ? window.getCallState() : null,
        busy: window.callInProgress ? window.callInProgress() : null
      };
    }),
    waitFor: (fn, arg, ms) => page.waitForFunction(fn, arg, { timeout: ms || 15000 }).then(() => true).catch(() => false),
    // 接通一通来电并最小化到悬浮小框＝报障现场（layerBusy 看不到 call-mask）
    startCallMini: () => page.evaluate(() => {
      window.triggerIncomingCall();
      document.getElementById('call-answer-btn').click();
      document.getElementById('call-minimize-btn').click();
      return window.getCallState();
    })
  };
}

const pendCall = (s, cid) => s.queue.filter((x) => x.status === 'pending' && x.kind === 'call' && (!cid || x.cid === cid)).length;

try {
  // ================= A 基线：无通话时跨桌面来电照常投递 =================
  console.log('\n== A 基线（无通话）：来电链路通、闸门不误伤 ==');
  {
    const s = await boot();
    const got = await s.waitFor(() => JSON.parse(localStorage.getItem('xy-home-v2:incoming-requests') || '[]')
      .some((x) => x.status === 'pending' && x.kind === 'call'), null, 12000);
    const st = await s.state();
    ok('A1 无通话时自动投出跨桌面来电弹窗', got && st.maskOpen && /来电了/.test(st.maskTitle), st.maskTitle);
    ok('A2 闸门在无通话时为假（不误伤）', st.busy === false, st.busy);
    await s.close();
  }

  // ================= B/C/D 通话中（小框态）：不投递、手动触发被拦、挂断后恢复 =================
  console.log('\n== B/C/D 通话中（call-mask 隐藏的小框态）==');
  {
    const s = await boot({ callEn: '0' });   // 先关跨桌面来电，把通话立起来再开
    await s.waitFor(() => window.__mochiIncomingProbe && window.__mochiIncomingProbe().ticks >= 2, null, 6000);
    const pre = await s.state();
    ok('B0 通话前：闸门为假、队列空', pre.busy === false && pendCall(pre) === 0, pre.busy);

    const cs = await s.startCallMini();
    const inCall = await s.state();
    ok('B1 已进入通话且最小化到小框（call-mask 隐藏＝layerBusy 失效现场）',
      !!cs && cs.status === 'connected' && inCall.callMaskOpen === false && inCall.callMiniOpen === true,
      { cs, mask: inCall.callMaskOpen, mini: inCall.callMiniOpen });
    ok('B2 通话占用门为真', inCall.busy === true, inCall.busy);

    // 开启跨桌面来电，跑若干轮（压缩定时器下 3s ≈ 6 轮）
    await s.page.evaluate(() => { window.setDeskCallEn(true); });
    await sleep(3000);
    const during = await s.state();
    ok('B3 通话中不再投递跨桌面来电（修复前此处会弹出「XX 来电了」）', pendCall(during) === 0, during.queue.map((x) => x.cid + ':' + x.kind + ':' + x.status));
    ok('B4 通话中没有被弹窗顶屏', !/来电了/.test(during.maskTitle), during.maskTitle);
    ok('B5 通话中不消耗来电冷却（挂断后当轮即可触发）',
      !Object.keys(during.last).some((k) => k.indexOf('call:') === 0), during.last);

    const manual = await s.page.evaluate(() => window.triggerIncomingCallReq('cmtprobe2'));
    const afterManual = await s.state();
    ok('C1 通话中手动触发跨桌面来电被拦（返回 false、不入队、不弹窗）',
      manual === false && pendCall(afterManual) === 0 && !/来电了/.test(afterManual.maskTitle),
      { manual, title: afterManual.maskTitle });

    const sameCid = await s.page.evaluate(() => { window.triggerIncomingCall(); return window.getCallState(); });
    ok('F1 同桌面来电回归：通话中不再启第二通电话（状态仍是原来那通）',
      !!sameCid && sameCid.status === 'connected', sameCid);

    // 挂断 → 闸门应立刻放开，同一联系人当轮可触发
    await s.page.evaluate(() => window.hangupCall());
    const afterHang = await s.state();
    ok('D0 挂断后闸门为假', afterHang.busy === false, afterHang.busy);
    const recovered = await s.waitFor(() => JSON.parse(localStorage.getItem('xy-home-v2:incoming-requests') || '[]')
      .some((x) => x.status === 'pending' && x.kind === 'call'), null, 10000);
    const stD = await s.state();
    ok('D1 挂断后来电恢复投递（闸门不是永久封锁）', recovered && /来电了/.test(stD.maskTitle), stD.maskTitle);
    await s.close();
  }

  // ================= E 门语义：响铃态 / 标记兜底 =================
  console.log('\n== E callInProgress 判定语义 ==');
  {
    const s = await boot({ callEn: '0' });
    await s.waitFor(() => window.__mochiIncomingProbe && window.__mochiIncomingProbe().ticks >= 1, null, 6000);
    const idle = await s.state();
    ok('E0 空闲：无通话且无标记 → 假', idle.busy === false, idle.busy);

    const ringing = await s.page.evaluate(() => { window.triggerIncomingCall(); return { busy: window.callInProgress ? window.callInProgress() : null, cs: window.getCallState() }; });
    ok('E1 来电响铃（尚未接通）也算占用 → 真', ringing.busy === true && !!ringing.cs && ringing.cs.status === 'ringing', ringing);
    await s.page.evaluate(() => window.hangupCall());

    // 刷新/后台重建窗口：currentCall 已空、call-active 标记仍在（心跳 ts 新鲜）→ 仍算占用
    const marker = await s.page.evaluate(() => {
      const KEY = 'xy-home-v2:call-active';
      const gate = () => (window.callInProgress ? window.callInProgress() : null);
      const payload = JSON.stringify({ cid: 'default', direction: 'in', status: 'connected', startTime: Date.now() - 60000, connectedTime: Date.now() - 60000, name: '阿明', av: '', ts: Date.now() });
      sessionStorage.setItem(KEY, payload);
      const fresh = gate();
      sessionStorage.setItem(KEY, JSON.stringify({ cid: 'default', connectedTime: Date.now() - 60000, ts: Date.now() - 11 * 60 * 1000 }));
      const stale = gate();
      sessionStorage.removeItem(KEY); localStorage.removeItem(KEY);
      return { fresh, stale, after: gate() };
    });
    ok('E2 currentCall 为空但标记新鲜 → 仍算占用（刷新/后台重建窗口）', marker.fresh === true, marker);
    ok('E3 标记超窗（>10 分钟，早已结束）→ 不算占用', marker.stale === false && marker.after === false, marker);
    await s.close();
  }
} finally {
  await browser.close().catch(() => {});
}

// ================= G 静态接线（源文件逻辑锚点） =================
console.log('\n== G 静态接线 ==');
{
  const callSrc = readFileSync(join(srcDir, 'js', 'call.js'), 'utf8');
  const incSrc = readFileSync(join(srcDir, 'js', 'incoming-requests.js'), 'utf8');
  ok('G1 call.js 暴露 callInProgress（currentCall 分支）',
    callSrc.includes('window.callInProgress = function () {') && callSrc.includes('if (currentCall) return true;'));
  ok('G2 call.js 标记兜底读 call-active（含 10 分钟新鲜度窗）',
    /sessionStorage\.getItem\(CALL_ACTIVE_KEY\) \|\| localStorage\.getItem\(CALL_ACTIVE_KEY\)/.test(callSrc) &&
    /Date\.now\(\) - \(info\.ts \|\| 0\) <= 600000\) return true/.test(callSrc));
  ok('G3 incoming-requests.js 调度层通话中不掷来电',
    incSrc.includes("if (deskCallEn() && !(window.callInProgress && window.callInProgress())) {"));
  ok('G4 incoming-requests.js 交付层对来电硬闸（手动触发同样受闸）',
    incSrc.includes("if (req.kind === 'call' && window.callInProgress && window.callInProgress()) return false;"));
  const gateIdx = incSrc.indexOf("if (req.kind === 'call' && window.callInProgress && window.callInProgress()) return false;");
  const forceIdx = incSrc.indexOf("if (!force && !document.hidden && layerBusy()) return false;");
  ok('G5 闸门在 force 之前（顶屏让路不能绕过）', gateIdx > 0 && forceIdx > 0 && gateIdx < forceIdx, { gateIdx, forceIdx });
  if (process.env.PRODUCT) {
    const prod = readFileSync(join(root, 'index.html'), 'utf8');
    ok('G6 构建产物已接入（callInProgress + 两处闸门）',
      prod.includes('window.callInProgress = function () {') && prod.includes("if (req.kind === 'call' && window.callInProgress && window.callInProgress()) return false;"));
  }
}

const uniqErrs = Array.from(new Set(pageErrors));
ok('H1 全程无未捕获异常', uniqErrs.length === 0, uniqErrs.slice(0, 3));

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail === 0 ? 0 : 1);
