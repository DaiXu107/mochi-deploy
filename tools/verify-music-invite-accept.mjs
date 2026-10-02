// ===== #904/#994 音乐·听歌邀请「一起听」接受后静默死亡 兜底验证 =====
// 用户实报（红米 K80 Chrome PWA，两次同症状）：邀请弹窗点「一起听」→ 小框不出现、没播放、无提示。
// 缺陷面（零机型分支，判据全取元素状态/时序/几何事实）：
//   A（#904a）残留来电 hold：musicHoldForCall(true) 后未释放（stale callHoldPending），
//     startPlayback 在 hold 门上静默 return——没声、没提示、被 hold 藏起的悬浮小框不回来。
//   B（#904b）同意后 4 秒起播校验：歌被外部打停（paused）且前台无人拉起＝永不响也不提示。
//   C（#994a/b/c）邀请面板「渲染」与「按钮接线」必须成对：音乐设置「诊断邀请 → 强制触发一次」
//     弹出的邀请面板原先是手抄的一份只有渲染、没挂点击处理器＝用户点「一起听」零反应。
//   D（#994d）起播校验原第一行「拿不到 currentId/audio 就 return」把「本地音频异步读未回/
//     读失败」整段静默掉：没 audio＝没小框没声音没提示。修后 4s→9s 两段盯 + 自动重跑一次起播
//     + 如实告知，绝不再全程沉默。
//   E（#994f）小框恢复位置未按视口钳制：保存位置落在视口外时音乐在播、hidden=false，但屏幕上
//     什么都看不到＝「没出现悬浮小框」。
//   F（#994e）本地歌邀请弹窗期预热音频：同意那一刻同步命中内存缓存 ⇒ 小框/声音当场就有。
//   G（#994g）跨桌面失效（弹窗期间切了联系人）不再静默丢弃，如实提示且仍不跨桌面写。
// 用法：node tools/verify-music-invite-accept.mjs（需先 node build.mjs；MOCHI_ROOT 可指副本）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

function makeWavDataUrl(seconds, sr) {
  const n = sr * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt32LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / sr * 440) * 4000), 44 + i * 2);
  return 'data:audio/wav;base64,' + buf.toString('base64');
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-mia-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}

const wav = makeWavDataUrl(40, 8000);
const SONG_URL = 'mia1';
const GS = JSON.stringify({ floatEn: true, reqProb: 100, cooldownMs: 0, taNextProb: 0, taRandProb: 0, taModeProb: 0, taFavProb: 0, taReserveProb: 0, taPauseProb: 0 });

async function seedStore(opts) {
  const lib = JSON.stringify([opts.local
    ? { id: opts.local, name: '邀请本地歌', artist: '', url: '', source: 'local', duration: 30, playlistId: 'default', addedAt: Date.now() }
    : { id: SONG_URL, name: '邀请验证歌', artist: '', url: wav, source: 'url', duration: 40, playlistId: 'default', addedAt: Date.now() }]);
  const fp = opts.floatPos ? "st.set('music-float-pos'," + JSON.stringify(JSON.stringify({ left: opts.floatPos[0], top: opts.floatPos[1] })) + ");" : "st.remove('music-float-pos');";
  await evalJs("(function(){var st=window.storeFor('default');st.set('music-library'," + JSON.stringify(lib) + ");st.set('music-global'," + JSON.stringify(GS) + ");st.set('music-history','[]');" + fp + "return true;})()");
  // 听歌记录同时清 IDB 权威副本，否则 idbRestore 回填会带回上一组的记录（G2 判据会被旧记录污染）
  await evalJs("(async function(){try{await window.idbDelete('xy-home-v2:default:music-history');}catch(e){}return true;})()");
}
async function instrument(opts) {
  await evalJs(`(function(){
    window.__va = { plays:0, toasts:[], idb:[], idbMark:0 };
    var OP = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function(){ window.__va.plays++; return OP.apply(this, arguments); };
    var mo = new MutationObserver(function(){
      var t = document.getElementById('cc-toast');
      if (t && t.className.indexOf('show') >= 0 && window.__va.toasts[window.__va.toasts.length-1] !== t.textContent) window.__va.toasts.push(t.textContent);
    });
    mo.observe(document.body, { attributes:true, childList:true, characterData:true, subtree:true });
    var OG = window.idbGet;
    window.idbGet = function(k){
      window.__va.idb.push(String(k));
      ${opts.hangIdb ? "if (String(k).indexOf('music-file') >= 0) return new Promise(function(){});" : ''}
      return OG.apply(this, arguments);
    };
    return true;})()`);
}
async function load(opts) {
  // 装置竞态闸：确认真的换了新文档（否则会在上一页还在时就把数据写进旧文档，验收结果无法归因）
  await evalJs("(function(){window.__navMark=1;return true;})()");
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 40; i++) { if ((await evalJs('typeof window.__navMark')) === 'undefined') break; await sleep(150); }
  await sleep(2400);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(400);
  await evalJs("(function(){var s=document.getElementById('splash');if(s)s.remove();document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
  await instrument(opts);
  if (opts.local) {
    // 曲目 id 每组唯一（mialD / mialF）：同一浏览器 profile 下前一组读过的键会被 hydrate 进
    // LS/内存缓存，复用同一 id 会让本组一开局就是「热」的，预热动作与同步命中都无法归因
    await evalJs("(function(){try{localStorage.removeItem('xy-home-v2:default:music-file:" + opts.local + "');localStorage.removeItem('xy-home-v2:music-file:" + opts.local + "');}catch(e){}return true;})()");
    // 只写不读回：idbGet 读大键会把值 hydrate 进内存/LS，那样「接受时同步命中」就成了装置假象而非预热功劳
    const wrote = await evalJs("(async function(){var ok=await window.idbSet('xy-home-v2:default:music-file:" + opts.local + "', " + JSON.stringify(wav) + ");return JSON.stringify({ok:ok});})()");
    console.log('  · 本地歌落盘预检(' + opts.local + '):', wrote);
    if (!wrote || wrote.indexOf('"ok":true') < 0) check('P0 装置前置：本地歌已写入 IndexedDB', false, wrote);
  }
  // 基线刻度：此后新增的 IDB 读取才算「本次动作引起的」（启动期本身会读一些音乐键，不设刻度 F1 无判别力）
  await evalJs('(function(){window.__va.idbMark = window.__va.idb.length;return true;})()');
  await sleep(200);
}
// 种数据 → 刷新 → 就绪（idbRestore 偶发回填清库，最多重试 6 次）
async function boot(opts) {
  for (let att = 0; att < 6; att++) {
    await seedStore(opts);
    await load(opts);
    if (opts.openPanel === false) return true;
    await evalJs("(function(){window.maybeMusicRequest();return true;})()");
    await sleep(300);
    if (await evalJs("!!document.getElementById('sm-req-yes')")) return true;
    await sleep(600);
  }
  return false;
}
async function acceptInvite() {
  for (let i = 0; i < 10; i++) {
    const y = await evalJs("(function(){var y=document.getElementById('sm-req-yes');if(y){y.click();return true;}return false;})()");
    if (y) break;
    await sleep(400);
  }
  await evalJs("(function(){var y=document.getElementById('sm-req-yes');if(y)y.click();return true;})()");
}
const audioState = () => evalJs("(function(){var as=document.querySelectorAll('audio');for(var i=as.length-1;i>=0;i--){if(as[i].src)return JSON.stringify({paused:as[i].paused,ct:+as[i].currentTime.toFixed(1),srcSet:true});}return 'nosong';})()");
const floatRect = () => evalJs("(function(){var f=document.getElementById('sm-float');if(!f)return 'nofloat';if(f.hidden)return 'hidden';var r=f.getBoundingClientRect();return JSON.stringify({l:Math.round(r.left),t:Math.round(r.top),r:Math.round(r.right),b:Math.round(r.bottom),inView:(r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<window.innerWidth&&r.top<window.innerHeight)});})()");
async function waitPlaying(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const st = await audioState();
    if (st && String(st).indexOf('"paused":false') >= 0) return true;
    await sleep(500);
  }
  return false;
}

console.log('--- #904/#994 听歌邀请接受后静默死亡 兜底验证 ---');
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ===== A. 残留来电 hold（#904a）：hold 未释放时接受邀请，新播放必须不被吞 =====
if (!(await boot({ openPanel: true }))) { console.log('FAIL  A0 邀请弹窗未能弹出'); results.push({ desc: 'A0', ok: false }); }
await evalJs("(function(){if(window.musicHoldForCall)window.musicHoldForCall(true);return true;})()"); // 模拟来电 hold 且从未释放
await sleep(300);
await acceptInvite();
check('A1 残留 hold 下接受邀请，音乐照常起播（不被 callHoldPending 静默吞掉）', await waitPlaying(7000), await audioState());
// 切到聊天页再查小框：桌面页（page-phone）上音乐小组件在场，小框按设计让位（floatOwnSurfaceShown）
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
await sleep(500);
check('A2 悬浮小框从 hold 隐藏态恢复显示', (await evalJs("(function(){var f=document.getElementById('sm-float');return f?!f.hidden:false;})()")) === true, 'sm-float hidden=' + await evalJs("(function(){var f=document.getElementById('sm-float');return f?f.hidden:'nofloat';})()"));

// ===== B. 起播校验兜底（#904b）：播放被外部打停后 4 秒内自动拉起 =====
if (!(await boot({ openPanel: true }))) { console.log('FAIL  B0 邀请弹窗未能弹出'); results.push({ desc: 'B0', ok: false }); }
await acceptInvite();
check('B1 接受邀请正常起播', await waitPlaying(7000), await audioState());
const playsBefore = await evalJs('window.__va.plays') || 0;
await evalJs("(function(){var as=document.querySelectorAll('audio');for(var i=as.length-1;i>=0;i--){if(as[i].src){as[i].pause();break;}}return true;})()"); // 模拟外部打停（无任何恢复路径接管）
await sleep(5200); // 4 秒校验窗 + 起播余量
const playsAfter = await evalJs('window.__va.plays') || 0;
check('B2 被外部打停后校验兜底自动补播（play 被再次调用）', playsAfter > playsBefore, 'before=' + playsBefore + ' after=' + playsAfter);
const st2 = await audioState();
check('B3 补播后音乐恢复播放', st2 && String(st2).indexOf('"paused":false') >= 0, st2);

// ===== C. #994a/b/c 诊断入口的邀请面板必须与聊天邀请同一实现（按钮有接线） =====
if (!(await boot({ openPanel: false }))) { console.log('FAIL  C0 初始化失败'); results.push({ desc: 'C0', ok: false }); }
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-music');});return true;})()");
await sleep(300);
const diagOpened = await evalJs("(function(){var b=document.getElementById('music-set');if(b){b.click();return true;}return false;})()");
await sleep(400);
const diagBtn = await evalJs("(function(){var b=document.getElementById('sm-diag-req');if(b){b.click();return true;}return false;})()");
await sleep(400);
const forceOpened = await evalJs("(function(){var b=document.getElementById('sm-diag-force');if(b){b.click();return true;}return false;})()");
await sleep(400);
check('C1 诊断邀请入口能弹出邀请面板（诊断按钮在位且面板有渲染）', diagOpened === true && diagBtn === true && forceOpened === true && (await evalJs("!!document.getElementById('sm-req-yes')")) === true, 'set=' + diagOpened + ' diag=' + diagBtn + ' force=' + forceOpened);
await acceptInvite();
check('C2 诊断入口的邀请面板点「一起听」能起播（不再是只渲染没接线的死按钮）', await waitPlaying(7000), await audioState());
check('C3 诊断入口接受后面板关闭（死按钮形态下会停在原地）', (await evalJs("(function(){var m=document.getElementById('tc-mask');return m?m.hidden:'nomask';})()")) === true, 'tc-mask.hidden=' + await evalJs("(function(){var m=document.getElementById('tc-mask');return m?m.hidden:'nomask';})()"));

// ===== D. #994d 本地音频异步读未回/读失败：不再全程静默 =====
if (!(await boot({ local: 'mialD', hangIdb: true, openPanel: true }))) { console.log('FAIL  D0 邀请弹窗未能弹出'); results.push({ desc: 'D0', ok: false }); }
await acceptInvite();
await sleep(11500); // 4s（第一段）→ 9s（第二段：如实告知 + 自动重跑）
const dToasts = (await evalJs('JSON.stringify(window.__va.toasts)')) || '[]';
const dAudio = await audioState();
check('D1 本地音频读不回来时不再零反馈（9 秒内给出如实提示）', /读取较慢|没能播放出来/.test(dToasts), dToasts);
check('D2 该场景确实没有起播（对照：修前就是「无框无声无提示」）', dAudio === 'nosong' || String(dAudio).indexOf('"paused":true') >= 0, dAudio);
const dFloat = await floatRect();
check('D3 该场景也没有悬浮小框（对照：小框依赖 audio 存在）', dFloat === 'hidden' || dFloat === 'nofloat', dFloat);

// ===== E. #994f 小框恢复位置按视口钳制（保存位置在视口外＝「没出现悬浮小框」） =====
if (!(await boot({ floatPos: ['900px', '1200px'], openPanel: true }))) { console.log('FAIL  E0 邀请弹窗未能弹出'); results.push({ desc: 'E0', ok: false }); }
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
await acceptInvite();
await waitPlaying(7000);
await sleep(600);
const eRect = await floatRect();
check('E1 小框 DOM 上确实处于显示态（对照项：红侧也是 false＝DOM 认为显示了，用户却看不到）', eRect !== 'hidden' && eRect !== 'nofloat', eRect);
check('E2 小框几何落在当前视口内（修前实测整体在视口外 inView=false＝屏幕上什么都看不到）', /"inView":true/.test(String(eRect)), eRect);

// ===== F. #994e 本地歌邀请弹窗期预热：把「同意那一刻的异步读」提前到弹窗期 =====
// 判据取用户可见效果：面板打开后（预热窗口已过）把该曲目的 IDB 读取挂死——预热过则同意时
// 同步命中内存缓存照常起播；没预热则同意那一刻才开始读、读被挂死＝点了同意不起播（老症状）。
if (!(await boot({ local: 'mialF', openPanel: true }))) { console.log('FAIL  F0 邀请弹窗未能弹出'); results.push({ desc: 'F0', ok: false }); }
await sleep(900); // 留出弹窗期的预热窗口
const fWarm = (await evalJs('JSON.stringify(window.__va.idb.slice(window.__va.idbMark))')) || '[]';
const fSync = await evalJs("(function(){try{var v=window.storeFor('default').get('music-file:mialF');return v?('sync:len'+String(v).length):'sync:none';}catch(e){return 'sync:err';}})()");
console.log('  · 弹窗期读数：新增 IDB 读取=' + fWarm + ' / 同步副本=' + fSync);
check('F1 弹窗期确实发起了该曲目的读取（预热动作，非等用户点同意）', fWarm.indexOf('xy-home-v2:default:music-file:mialF') >= 0, fWarm.slice(0, 240));
// 此后所有 music-file 读取挂死（模拟真机「读得慢/读不回来」）
await evalJs("(function(){var OG=window.idbGet;window.idbGet=function(k){window.__va.idb.push(String(k));if(String(k).indexOf('music-file')>=0)return new Promise(function(){});return OG.apply(this,arguments);};return true;})()");
await acceptInvite();
const fOk = await waitPlaying(7000);
check('F2 预热后即使此刻读取挂死，接受邀请仍当场起播（红侧：同步副本冷＋读被挂死＝不起播，正是老症状）', fOk, JSON.stringify({ audio: await audioState(), plays: await evalJs('window.__va.plays'), toasts: await evalJs('JSON.stringify(window.__va.toasts)') }));

// ===== G. #994g 跨桌面失效（弹窗期间切联系人）不再静默丢弃 =====
if (!(await boot({ openPanel: true }))) { console.log('FAIL  G0 邀请弹窗未能弹出'); results.push({ desc: 'G0', ok: false }); }
await evalJs("(function(){window.__activeCid='other';return true;})()"); // 模拟弹窗期间切换联系人
await acceptInvite();
await sleep(900);
const gToasts = (await evalJs('JSON.stringify(window.__va.toasts)')) || '[]';
check('G1 跨桌面失效时如实提示（不再点了零反馈）', /已切换联系人|失效/.test(gToasts), gToasts);
const gHist = (await evalJs("(function(){try{return String(window.storeFor('default').get('music-history')||'');}catch(e){return '';}})()")) || '';
check('G2 跨桌面失效时仍不跨桌面写入（防串写不回退）', gHist.indexOf('接受了 TA 的听歌邀请') < 0, gHist.slice(0, 120));

// ===== Z. 全程零新增 JS 异常 =====
check('Z1 全程零新增 JS 异常', (await evalJs('window.__jsErrors ? window.__jsErrors.length : 0')) === 0, await evalJs("JSON.stringify((window.__jsErrors||[]).slice(0,3))"));

const pass = results.filter(r => r.ok).length;
console.log('--- ' + pass + '/' + results.length + ' ---');
chrome.kill(); server.close();
process.exit(pass === results.length ? 0 : 1);
