// ===== 回归脚本：#511 拍一拍手势泄漏族 + 进聊天气泡「先变 2 条再恢复」=====
// 背景（用户报障，三条同批）：
//   ① 桌面点开【聊天】进页面，联系人最新一条消息莫名其妙变成 2 个，然后再恢复正常；
//   ② 聊天联系人头像有时候没打开拍一拍页面，直接点击头像就发出了拍一拍；
//   ③ 「我的拍一拍」tab 下打开拍一拍功能页，默认就打开了输入框并弹出输入法。
// 根因（src/js/chat.js，零机型分支）：
//   ②③ 同源：点头像的 touch/pointer 路在 touchend 里【同步】打开面板并渲染字卡/输入行，
//       紧接着浏览器补发的合成 click 落点已在面板内部——落在字卡上 → sendPoke + 关面板
//       （表现为「面板没出来就拍了我一下」）；落在输入框上 → 聚焦弹输入法（输入行仅
//       mine tab 显示，故只有「我的拍一拍」复现）。上一轮修复只声明了 pokeOpenClickGate
//       却【从未赋值】（闸恒为 0）＝拦截器形同虚设，报障复发。
//   ① LS 快照与内存 msgs 的合并签名只比 ts|side|原文前 64 字符：同一逻辑消息 LS 侧是原始
//       base64、内存侧已令牌化（#256）→ 判两条 → 首帧渲染 2 个气泡，随后后台归一化（dupSig
//       展开令牌）又合并回 1＝「变 2 个又恢复正常」。写快照（mergeLsSnapshotWith）与读快照
//      （loadMsgs）两处各有一份同款内联签名，只修一处等于半修。
// 修复：
//   #511a lsMergeSig()：合并签名统一为「展开媒体令牌 + special/type + 长度 + 前 96 字符」，
//         两处合并点共用（导出 window.__lsMergeSig 供本脚本直接断言）。
//   #511b pokeArmClickGate/pokeGateActive/pokeDisarmClickGate：仅【手势开路】布闸
//         （openPokeCard(true)，鼠标点击/菜单入口不布），闸内吞掉面板内第一次 click 即失效，
//         700ms 时间窗兜底；拦截范围＝整个 poke-card（字卡/分组/tab/输入行）。
//   #511c focusin 兜底：部分内核对 input 的聚焦在 touchstart 阶段已定，click 层 preventDefault
//         拦不住 → 闸内被聚焦的输入框主动 blur；openPokeCard 内同步补一次 pokeInput.blur()。
// 断言（无头 390×844 + CDP 真实触摸管线）：
//   S1-S4 静态锚：闸有赋值、拦截在 poke-card 层、focusin 兜底、两处合并点都走 lsMergeSig。
//   B1-B3 合并签名口径：跨形式（base64 ↔ 同内容令牌）判同、不同条判异、去重后只剩 1 条。
//   A1 触屏轻点头像 → 拍一拍面板打开（基线，防修坏手势入口）。
//   A2 闸内对字卡派发 click（模拟补发的合成 click）→ 绝不发出拍一拍（②复现点，旧版必红）。
//   A3 闸内对输入框 click/focus → 不保持焦点（③复现点，旧版必红）。
//   A4 闸过期后点字卡 → 正常发出拍一拍（不误伤真实点击）。
//   A5 非手势入口打开 → 立即点字卡 → 正常发出（fromGesture 门控不误伤菜单入口）。
// 用法（收口后）：node build.mjs && node tools/verify-poke-tap-leak.mjs
// 用法（预收口验证隔离构建）：SERVE_ROOT=<隔离构建目录> node tools/verify-poke-tap-leak.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || __root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { console.error('SRV403', req.url); res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9950 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-pokegate-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
let jsErrors = 0;
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
          if (m.method === 'Runtime.exceptionThrown') jsErrors++;
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);

let pass = 0, fail = 0, skip = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}
function note(name, detail) { skip++; console.log('  ⚠ SKIP', name, detail || ''); }

// —— 关开屏（clock.js 门控：滑到底 + 点进入；兜底强制隐藏，仅测试夹具）——
let splashClosed = false;
for (let i = 0; i < 30 && !splashClosed; i++) {
  const s = await evalJs(`(function(){
    var mm = document.getElementById('splash-mandatory');
    if (mm && !mm.hidden) {
      var sc = document.getElementById('splash-mandatory-scroll');
      if (sc) sc.scrollTop = sc.scrollHeight;
      var men = document.getElementById('splash-mandatory-enter');
      if (men && !men.classList.contains('is-disabled')) { men.click(); return 'mclicked'; }
      return 'mwait';
    }
    var sp = document.getElementById('splash');
    if (!sp || sp.classList.contains('hide')) return 'closed';
    var sb = document.getElementById('splash-box');
    if (sb) sb.scrollTop = sb.scrollHeight;
    var se = document.getElementById('splash-enter');
    if (se && !se.disabled) { se.click(); return 'clicked'; }
    return 'wait';
  })()`);
  splashClosed = s === 'closed';
  if (!splashClosed) await sleep(300);
}
if (!splashClosed) {
  await evalJs(`(function(){var mm=document.getElementById('splash-mandatory');if(mm&&!mm.hidden){var sc=document.getElementById('splash-mandatory-scroll');if(sc)sc.scrollTop=sc.scrollHeight;var men=document.getElementById('splash-mandatory-enter');if(men)men.click();mm.hidden=true;}var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide')){sp.classList.add('hide');sp.hidden=true;}return true;})()`);
  await sleep(500);
}
chk('前置 开屏已关闭', true);
// 清场：TA 主动行为随机弹的遮罩会抢 elementFromPoint/坐标触摸
const clearMasks = () => evalJs(`(function(){['tc-mask','qa-mask','call-mask'].forEach(function(id){var e=document.getElementById(id);if(e){e.hidden=true;}});return true;})()`);
await clearMasks();

// —— S1-S4 静态锚：修复源逻辑在位（脚本侧双保险，别等构建哨兵）——
const chatSrc = (() => {
  for (const p of [join(root, 'src', 'js', 'chat.js'), join(__root, 'src', 'js', 'chat.js')]) {
    try { return readFileSync(p, 'utf8'); } catch (e) {}
  }
  return '';
})();
chk('S1 点击闸有赋值锚（openPokeCard 内按 fromGesture 布闸）', chatSrc.indexOf('if (fromGesture) pokeArmClickGate();') >= 0);
chk('S2 拦截在 poke-card 层锚（覆盖字卡以外的输入行）', chatSrc.indexOf("pokeCard.addEventListener('click'") >= 0 && chatSrc.indexOf("pokeCard.addEventListener('focusin'") >= 0);
chk('S3 两处合并点统一走 lsMergeSig 锚', chatSrc.indexOf('msgsNow.map(lsMergeSig)') >= 0 && chatSrc.indexOf('lsArr.map(lsMergeSig)') >= 0);
chk('S4 旧内联 sig2 已无残留（半修会让写侧继续存两份）', chatSrc.indexOf('const sig2 =') < 0);
chk('S5 开面板主动失焦锚（pokeInput.blur）', chatSrc.indexOf('try { pokeInput.blur(); } catch (e) {}') >= 0);

// —— B1-B3 合并签名口径（直接调用产品函数，非复刻实现）——
const sigFnOk = await evalJs("typeof window.__lsMergeSig === 'function'");
chk('B0 window.__lsMergeSig 可测性出口在位', sigFnOk === true);
const sigProbe = await evalJs(`(async function(){
  var durl = 'data:image/png;base64,' + 'QUJD'.repeat(400);
  var tok = await window.mochiMediaTokenize(durl);
  if (!tok || !window.mochiMediaIsToken(tok)) return { err: 'tokenize-null' };
  var ex = window.mochiMediaExpand(tok);
  var a = { ts: 1700000000000, side: 'in', text: durl };
  var b = { ts: 1700000000000, side: 'in', text: tok };
  var c = { ts: 1700000000001, side: 'in', text: durl };
  var d = { ts: 1700000000000, side: 'out', text: durl };
  var sigA = window.__lsMergeSig(a), sigB = window.__lsMergeSig(b);
  var list = [a, b, c, d];
  var set = new Set(list.map(window.__lsMergeSig));
  return { expanded: ex === durl, same: sigA === sigB, diffTs: sigA !== window.__lsMergeSig(c), diffSide: sigA !== window.__lsMergeSig(d), uniq: set.size, sigA: sigA.slice(0, 40) };
})()`);
console.log('SIGPROBE', JSON.stringify(sigProbe));
if (sigProbe && !sigProbe.err) {
  chk('B1 跨形式同一条（LS 原文 base64 ↔ 内存令牌）合并签名相等', sigProbe.same === true, JSON.stringify(sigProbe));
  chk('B2 不同 ts / 不同 side 仍判为两条（不引入误合并）', sigProbe.diffTs === true && sigProbe.diffSide === true, JSON.stringify(sigProbe));
  chk('B3 跨形式两份同一条经签名去重后只剩 1 条', sigProbe.uniq === 3, 'uniq=' + String(sigProbe.uniq));
} else {
  note('B1-B3 跳过（令牌化不可用）', JSON.stringify(sigProbe));
}

// —— 进聊天 ——
const pokeHidden = () => evalJs("(function(){var p=document.getElementById('poke-card');return p?p.hidden:null;})()");
const closePoke = () => evalJs("(function(){var p=document.getElementById('poke-card');if(p)p.hidden=true;return true;})()");
const pokeMsgCount = () => evalJs("document.querySelectorAll('#chat-body .msg-poke').length");
await evalJs('window.enterChat(); true');
await sleep(1200);
await clearMasks();
const n0 = await evalJs("document.querySelectorAll('.msg-in .msg-av').length");
if (!n0) { await evalJs("window.chatAddIn('联系人发来的第一条测试消息'); true"); await sleep(900); }
// 诊断：基线（旧产物）上若拿不到收件消息，靠这几项定位是 API 缺失还是渲染未就绪
const ecDiag = await evalJs("(function(){return {enterChat:typeof window.enterChat,chatAddIn:typeof window.chatAddIn,msgs:document.querySelectorAll('#chat-body .msg').length,ins:document.querySelectorAll('.msg-in').length,outs:document.querySelectorAll('.msg-out').length,errs:(window.__jsErrors&&__jsErrors.length)||0,ready:!!window.__mochiDataReady};})()");
console.log('ENTERCHAT', JSON.stringify(ecDiag));
const avN = await evalJs("document.querySelectorAll('.msg-in .msg-av').length");
chk('前置 聊天空有收到的消息（.msg-in 头像可点）', avN > 0, 'msg-in count=' + String(avN));

const rectOf = (sel) => evalJs(`(function(){var el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;var r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return null;return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),w:Math.round(r.width),h:Math.round(r.height),visible:r.top>=0&&r.bottom<=innerHeight};})()`);
async function tap(x, y) {
  const t = Date.now() / 1000;
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: t, touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }] });
  await sleep(40);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: t + 0.08, touchPoints: [] });
}
// 模拟「浏览器手势后补发的合成 click」：直接派发 click 到目标元素（CDP 脚本事件不自动补发）
const fireClick = (sel) => evalJs(`(function(){var t=document.querySelector(${JSON.stringify(sel)});if(!t)return 'no-target';t.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));return 'fired';})()`);

const av = await rectOf('.msg-in .msg-av');
chk('A0 找到收件头像且可见', !!av, JSON.stringify(av));

// 每次点按都重新取头像坐标：消息列表在断言之间会重渲/位移，沿用旧坐标会静默点空
// （首次 RED 实测正是如此——面板没打开却当成"闸生效"假绿）。
// 另外必须间隔 > pokeTapGuard(800ms)：三路共用防重入窗内再作手势会被让位，点按落空。
// 取一个「确实落在视口内、且避开底部面板/输入栏」的收件头像坐标——列表会随 TA 回应增长，
// 固定取第一个头像会在多轮断言后落到视口外，点按静默落空（RED 实测踩过）。
const avRect = () => evalJs(`(function(){
  var list=document.querySelectorAll('.msg-in .msg-av');
  for(var i=0;i<list.length;i++){
    var r=list[i].getBoundingClientRect();
    if(r.width>0&&r.height>0&&r.top>=70&&r.bottom<=innerHeight-160){
      return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
    }
  }
  return null;
})()`);
async function openPokeByAvatar(attempt) {
  attempt = attempt || 0;
  await sleep(attempt ? 700 : 900);
  const r = await avRect();
  if (!r) return { ok: false, reason: 'no-av' };
  await closePoke();
  await tap(r.x, r.y);
  await sleep(160); // 仍处于 700ms 闸窗内
  const h = await pokeHidden();
  // 无头首轮冷启偶发抖动（进页后第一次触摸被吃掉）：重试一次，避免把抖动记成回归
  if (h !== false && attempt < 1) return openPokeByAvatar(attempt + 1);
  return { ok: h === false, x: r.x, y: r.y, hidden: h, attempt: attempt };
}
async function ensureTab(kind) {
  // 断言统一走「我的拍一拍」（mine）tab：该 tab 自带 6 张预设卡（pokeTabGroups 的 __preset 组），
  // 无卡库数据也能点；而 ta/public tab 依赖字卡库作用域数据（hydrate 异步、干净环境为空）。
  // 报障③（打开拍一拍页默认弹输入法）也只在 mine tab 复现——输入行仅该 tab 显示。
  await evalJs("(function(){var t=document.querySelector('.poke-tab-" + kind + "');if(t)t.click();return true;})()");
  await sleep(150);
}
const cardCount = () => evalJs("document.querySelectorAll('#poke-list .cc-item').length");

// —— A1 触屏轻点头像 → 面板开（基线，防修坏手势入口）——
if (av) {
  await ensureTab('mine');
  const r1 = await openPokeByAvatar();
  console.log('A1', JSON.stringify(r1));
  chk('A1 触屏轻点头像→拍一拍面板打开（手势入口不回归）', r1.ok === true, 'poke-card.hidden=' + String(r1.hidden));
  const cc1 = await cardCount();
  const dbg1 = await evalJs(`(function(){
    var pl = document.getElementById('poke-list');
    var sel = document.querySelector('.poke-tab.sel');
    return { tab: sel ? sel.dataset.ptab : null, cards: document.querySelectorAll('#poke-list .cc-item').length,
      kids: pl ? pl.children.length : -1, first: pl && pl.firstElementChild ? (pl.firstElementChild.className || pl.firstElementChild.tagName) : null,
      html: pl ? pl.innerHTML.slice(0, 120) : null };
  })()`);
  console.log('DIAG 面板内部', JSON.stringify(dbg1));
  chk('A1b 面板内有可点字卡（后续泄漏断言的对象存在）', cc1 > 0, 'cards=' + String(cc1));
  // 诊断：指尖坐标下的元素（复现「漏出发拍一拍/输入框被聚焦」的真实落点）
  const hit = await evalJs(`(function(){var e=document.elementFromPoint(${r1.x},${r1.y});if(!e)return null;var z='outside';if(e.closest&&e.closest('.cc-item'))z='cc-item';else if(e.closest&&e.closest('.poke-input-row'))z='poke-input-row';else if(e.closest&&e.closest('#poke-card'))z='poke-card-inner';return {tag:e.tagName,zone:z};})()`);
  console.log('DIAG 指尖落点', JSON.stringify(hit));
  await closePoke();
}

// —— A2 闸内对字卡派发 click（模拟补发的合成 click）→ 绝不发出拍一拍（②复现点）——
if (av) {
  await ensureTab('mine');
  const r2 = await openPokeByAvatar();
  if (!r2.ok) {
    note('A2 跳过：拍一拍面板未打开（点按落空）', JSON.stringify(r2));
  } else {
    const before = await pokeMsgCount();
    const fired = await fireClick('#poke-list .cc-item');
    await sleep(200);
    const after = await pokeMsgCount();
    const stillOpen = await pokeHidden();
    console.log('A2 fired=' + String(fired) + ' before=' + String(before) + ' after=' + String(after) + ' stillOpen=' + String(stillOpen === false));
    if (fired !== 'fired') note('A2 跳过：面板内无字卡目标', '');
    else chk('A2 手势泄漏的合成 click 落在字卡上→不发出拍一拍（旧版必红）', after === before, 'poke msgs ' + String(before) + '→' + String(after));
    chk('A2b 闸内那次 click 被吞后不连带关掉面板', stillOpen === false, 'poke-card.hidden=' + String(stillOpen));
    await closePoke();
  }
}

// —— A3 闸内对输入框点击/聚焦 → 不保持焦点（③复现点；输入行仅 mine tab 显示）——
if (av) {
  await ensureTab('mine');
  const r3 = await openPokeByAvatar();
  const rowVis = await evalJs(`(function(){
    var rows=document.querySelectorAll('.poke-input-row');
    var list=[]; rows.forEach(function(r){ var b=r.getBoundingClientRect(); list.push({ parent:(r.parentElement&&r.parentElement.id)||(r.parentElement&&r.parentElement.className)||'?', hidden:!!r.hidden, w:Math.round(b.width) }); });
    var i=document.querySelector('#poke-card .poke-input, .poke-input'), pc=document.getElementById('poke-card');
    var pr=pc?pc.getBoundingClientRect():null;
    return { rows:list, hasInput:!!i, cardHidden:pc?!!pc.hidden:null, cardW:pr?Math.round(pr.width):null, cardH:pr?Math.round(pr.height):null };
  })()`);
  console.log('A3 输入行状态', JSON.stringify(rowVis), '面板开=' + String(r3.ok));
  if (!r3.ok) {
    note('A3 跳过：拍一拍面板未打开（点按落空）', JSON.stringify(r3));
  } else {
    chk('A3 前置「我的拍一拍」tab 下输入行已展开（报障前提）', !!(rowVis && rowVis.hasInput && rowVis.rows.some(function (x) { return x.parent === 'poke-card' && x.hidden === false; })), JSON.stringify(rowVis.rows));
    // 判别力夹具：无头下真实输入框可能不参与布局（宽度 0、focus 无效）＝断言会假绿，
    // 故在面板内自建一个必然可聚焦的 input，保证每条「闸内/闸外」断言都有真实判别力。
    // 注意：本环境走安卓路径（mobile-adapt 把 input 转成 contenteditable 的 .ce-box 代理，
    // 代理继承原 input 的 className），故焦点判定一律看 className 指纹而非 id——
    // 否则真机/无头两端都会把「聚焦在代理上」误判成「没聚焦」。
    await evalJs("(function(){var d=document.createElement('input');d.id='__gate_probe';d.className='gate-probe-x';d.type='text';var p=document.getElementById('poke-card');if(p)p.appendChild(d);return !!p;})()");
    await sleep(120); // 等 mobile-adapt 完成 ce-box 转换
    const focusedByClass = (cls) => evalJs("(function(){var a=document.activeElement;if(!a)return false;return !!(a.classList&&a.classList.contains(" + JSON.stringify(cls) + "));})()");
    // ① 真实输入框：闸内泄漏 click 不聚焦（本组闸由 r3 的手势布下，此处尚未被消耗）
    await fireClick('#poke-card .poke-input, .poke-input');
    const ae1 = await focusedByClass('poke-input');
    chk('A3 闸内泄漏 click 落到输入框→不聚焦、不弹输入法（旧版必红）', ae1 === false, 'poke-input focused=' + String(ae1));
    // ② 真实输入框：重新布闸后程序化聚焦应被 focusin 兜底收回（闸会被 ① 消耗，必须重新手势布闸）
    const r3b = await openPokeByAvatar();
    await evalJs("(function(){var i=document.getElementById('poke-input')||document.querySelector('#poke-card .poke-input, .poke-input');if(i)i.focus();return true;})()");
    await sleep(120);
    const ae2 = await focusedByClass('poke-input');
    console.log('A3b 面板开=' + String(r3b.ok) + ' 强制 focus 后聚焦=' + String(ae2));
    chk('A3b 闸内程序化聚焦被 focusin 兜底收回（内核 touchstart 期已定焦的场景）', ae2 === false, 'poke-input focused=' + String(ae2));
    // ③ 夹具：闸内聚焦面板内元素 → 焦点被收回
    const r3c = await openPokeByAvatar();
    await evalJs("(function(){var d=document.getElementById('__gate_probe');if(d)d.focus();return true;})()");
    await sleep(120);
    const pr1 = await focusedByClass('gate-probe-x');
    console.log('A3c 面板开=' + String(r3c.ok) + ' 闸内夹具聚焦=' + String(pr1));
    chk('A3c 闸内聚焦面板内元素→焦点被收回（夹具，旧版必红）', pr1 === false, 'probe focused=' + String(pr1));
    // ④ 夹具：闸窗外聚焦同一元素 → 正常生效（不误伤用户/系统聚焦）
    await sleep(1000); // 越过 700ms 闸窗
    await evalJs("(function(){var d=document.getElementById('__gate_probe');if(d)d.focus();return true;})()");
    await sleep(120);
    const pr2 = await focusedByClass('gate-probe-x');
    console.log('A3d 闸窗外聚焦=' + String(pr2) + ' active=' + JSON.stringify(await evalJs("(function(){var a=document.activeElement;return a?{id:a.id||null,tag:a.tagName,cls:String(a.className||'').slice(0,30)}:null;})()")));
    chk('A3d 闸窗外聚焦同一元素→正常生效（不误伤）', pr2 === true, 'probe focused=' + String(pr2));
    await evalJs("(function(){var ls=document.querySelectorAll('.__gate_probe_cleanup');var d=document.getElementById('__gate_probe');if(d&&d.parentNode)d.parentNode.removeChild(d);return true;})()");
    await closePoke();
  }
}

// —— A4 闸过期后点字卡 → 正常发出拍一拍（不误伤真实点击）——
if (av) {
  await ensureTab('mine');
  const r4 = await openPokeByAvatar();
  if (!r4.ok) {
    note('A4 跳过：拍一拍面板未打开（点按落空）', JSON.stringify(r4));
  } else {
    await sleep(900); // 越过 700ms 闸窗
    const before4 = await pokeMsgCount();
    await fireClick('#poke-list .cc-item');
    await sleep(250);
    const after4 = await pokeMsgCount();
    console.log('A4 before=' + String(before4) + ' after=' + String(after4));
    chk('A4 闸过期后点字卡→正常发出拍一拍（不误伤用户真实点击）', after4 > before4, 'poke msgs ' + String(before4) + '→' + String(after4));
    await closePoke();
    await sleep(300);
  }
}

// —— A5 非手势入口（更多面板的拍一拍按钮）打开 → 不布闸 → 立即点字卡应正常发出 ——
if (av) {
  await ensureTab('mine');
  await closePoke();
  await sleep(900); // 清掉任何遗留闸窗，保证本组只测「非手势入口」
  const viaMenu = await evalJs("(function(){var b=document.getElementById('more-poke');if(!b)return 'no-entry';b.click();return document.getElementById('poke-card').hidden?'closed':'opened';})()");
  await sleep(100);
  const before5 = await pokeMsgCount();
  await fireClick('#poke-list .cc-item');
  await sleep(250);
  const after5 = await pokeMsgCount();
  console.log('A5 viaMenu=' + String(viaMenu) + ' before=' + String(before5) + ' after=' + String(after5));
  if (viaMenu === 'no-entry') note('A5 跳过：未找到更多面板拍一拍入口', '');
  else chk('A5 非手势入口打开面板后立即点字卡→照常发出（fromGesture 门控不误伤）', viaMenu === 'opened' && after5 > before5, 'poke msgs ' + String(before5) + '→' + String(after5));
  await closePoke();
}

const jsErrCount = await evalJs('(window.__jsErrors && __jsErrors.length) || 0');
chk('终态 无未捕获 JS 异常', jsErrCount === 0 && jsErrors === 0, 'cdp=' + String(jsErrors) + ' app=' + String(jsErrCount));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

console.log('（作用域：' + (process.env.SERVE_ROOT ? 'SERVE_ROOT=' + process.env.SERVE_ROOT : '仓库根目录产品') + '）');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败 / ' + skip + ' 跳过');
process.exit(fail ? 1 : 0);
