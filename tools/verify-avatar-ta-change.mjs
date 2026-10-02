// ===== 专项验证：联系人（TA）主动换头像后聊天顶栏/消息气泡必须跟随 =====
// 用户反馈：TA 主动触发的更换头像，聊天顶部栏头像没换或聊天里的头像没换。
// 根因（v3.14.x 修复）：池内 >200KB 图（备份导入旧池常见）原样写入 cs-avatar-* 后被
// xyStore 移出 localStorage 只存 IDB，下次启动读空回退旧桌面头像；且 fillAvatar 渲染
// 上限 500KB 与 applyAvatarImg 无上限不对称。修复：写聊天键前统一压缩 <200KB +
// 哈希防重复触发 + 可见性恢复/回前台/storage 事件显示收敛兜底。
// 场景：
//   T0 启动即换路径（小图基线）——真实点击聊天图标进入
//   T1 聊天页打开时 60s 轮询触发——顶栏+全部已渲染气泡立即更新
//   T2 聊天页隐藏时轮询触发——真实进入后为新图
//   T3 大图（~600KB SVG）主动换——cs 压缩落 localStorage、跨会话启动早期即为新图（修复核心）
//   T4 显示收敛兜底——存储已换、DOM 停旧态时 visibilitychange 重刷
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9890 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-avfix-' + Date.now()),
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
  throw new Error('cdp fail');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JSERR', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function gotoApp(waitMs = 1000) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(150); }
  await sleep(waitMs);
}
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + String(detail).slice(0, 240) + ']' : ''));
}
const svgUrl = (hex) => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#' + hex + '"/></svg>');
const RED = svgUrl('ff2255'), GOLD = svgUrl('ffaa22'), BLUE = svgUrl('2255ee'), TEAL = svgUrl('0a9c8a');
// 大但合法的 SVG（带显式宽高，canvas 可绘制）：~600KB，超过 LS_BIG_LIMIT(200KB)
function bigSvg(hex) {
  let s = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#' + hex + '"/>';
  for (let i = 0; i < 9000; i++) {
    s += '<circle cx="' + (i % 512) + '" cy="' + ((i * 7) % 512) + '" r="1" fill="#ffffff" fill-opacity="0.02"/>';
  }
  s += '</svg>';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(s);
}
const BIGGOLD = bigSvg('ffaa22');

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function seedPool(img, current) {
  await evalJs(`(function(){
    const s = window.activeStore();
    s.set('avatar-partner', '');
    s.set('cs-avatar-partner', ${JSON.stringify(current)});
    s.remove('avatar-lib-cur-hash'); s.remove('avatar-me-lib-cur-hash');
    s.set('avatar-lib', JSON.stringify([${JSON.stringify(img)}]));
    s.set('avatar-lib-enabled', '1');
    s.set('avatar-lib-last', String(Date.now()));
    s.set('avatar-lib-next', '8');
    return true;
  })()`);
}
function zeroTimerWithPool(img) {
  return evalJs(`(function(){ const s=window.activeStore();
    s.set('avatar-lib', JSON.stringify([${JSON.stringify(img)}]));
    s.set('avatar-lib-enabled','1'); s.set('avatar-lib-last','0'); s.set('avatar-lib-next','0');
    try { s.remove && s.remove('avatar-lib-cur-hash'); } catch(e){}
    try { localStorage.removeItem('xy-home-v2:default:avatar-lib-cur-hash'); } catch(e){}
    return true; })()`);
}
// 真实 UI 进入聊天页（桌面点聊天图标 → enterChat：fillAvatar 头部 + renderWindow 全量渲染）
async function enterChatReal() {
  const ok = await evalJs(`(function(){
    var el = document.querySelector('.app[data-app="chat"]');
    if (!el) return false;
    el.click();
    var pg = document.getElementById('page-chat');
    return !!pg && !pg.hidden;
  })()`);
  await sleep(450);
  return ok;
}
// mark: 期望的当前色值标记（小图直接匹配色值；大图场景用 structural 判断）
async function avatarState(mark) {
  return await evalJs(`(function(){
    function has(el, m){ return !!el && String(el.innerHTML||'').indexOf(m)>=0; }
    var top = document.getElementById('chat-partner-av');
    var avs = Array.from(document.querySelectorAll('.msg-in .msg-av'));
    var marks = { red:'ff2255', gold:'ffaa22', blue:'2255ee', teal:'0a9c8a' };
    function cnt(m){ return avs.filter(function(a){ return String(a.innerHTML).indexOf(m)>=0; }).length; }
    function cntSvg(){ return avs.filter(function(a){ return String(a.innerHTML).indexOf('<svg')>=0; }).length; }
    var cs = String(window.activeStore().get('cs-avatar-partner')||'');
    var markedTotal = 0;
    avs.forEach(function(a){ var h=String(a.innerHTML); if(h.indexOf('<img')>=0||h.indexOf('<svg')>=0){ markedTotal++; } });
    var oddSample = '';
    for (var i=0;i<avs.length;i++){ var h=String(avs[i].innerHTML);
      if ((h.indexOf('<img')<0 && h.indexOf('<svg')<0) || (h.indexOf('<img')>=0 && ['ff2255','ffaa22','2255ee','0a9c8a','image/jpeg'].every(function(m){return h.indexOf(m)<0;}))) { oddSample = h.slice(0,90); break; } }
    var topStr = top ? String(top.innerHTML||'') : '';
    return {
      csLen: cs.length,
      csIsJpeg: cs.indexOf('data:image/jpeg') === 0,
      csMark: Object.keys(marks).filter(function(k){ return cs.indexOf(marks[k])>=0; }).join('|') || 'none',
      topMark: Object.keys(marks).filter(function(k){ return topStr.indexOf(marks[k])>=0; }).join('|') || (topStr.indexOf('<svg')>=0 ? 'svg' : 'none'),
      topIsImg: topStr.indexOf('<img')>=0,
      counts: Object.keys(marks).map(function(k){ return k+':'+cnt(marks[k]); }).join(',') + ',jpeg:' + cnt('image/jpeg') + ',svg:' + cntSvg(),
      total: avs.length,
      marked: markedTotal,
      oddSample: oddSample,
      sysFound: (window.getChatMsgs?window.getChatMsgs():[]).some(function(m){ return /更换了头像/.test(String(m&&m.text||'')); })
    };
  })()`);
}

// ================= T0 启动即换路径（小图基线，真实入口） =================
{
  await gotoApp();
  await evalJs(`window.chatAddIn('早上好'); window.chatAddIn('吃了吗'); true;`);
  await seedPool(GOLD, RED);
  await gotoApp(); // 计时归零前先推远——这里直接归零再重载
  await zeroTimerWithPool(GOLD);
  await gotoApp();
  await enterChatReal();
  const st = await avatarState('gold');
  check('T0.1 启动换后 cs=GOLD', st.csMark === 'gold', st.csMark + '/' + st.csLen);
  check('T0.2 顶栏=GOLD', st.topMark === 'gold', st.topMark);
  check('T0.3 全部 TA 气泡=GOLD/无残留红 (' + st.counts + '/marked:' + st.marked + ')',
    st.marked >= 2 && st.counts.indexOf('red:0') === 0 && (st.counts.indexOf('gold:' + st.marked) >= 0 || st.counts.indexOf('jpeg:' + st.marked) >= 0), st.counts + '/odd:' + st.oddSample);
  check('T0.4 「更换了头像」系统消息已入历史', st.sysFound, '');
}

// ================= T1 聊天页打开时轮询触发（核心场景） =================
{
  await seedPool(BLUE, RED);
  await enterChatReal();
  await evalJs(`window.chatAddIn('在忙吗'); true;`);
  await sleep(300);
  let st = await avatarState('red');
  check('T1.1 触发前顶栏+全部气泡=RED (' + st.counts + '/top:' + st.topMark + ')',
    st.marked >= 1 && st.topMark === 'red' && st.counts.indexOf('red:' + st.marked) >= 0, st.counts + '/top:' + st.topMark);
  await zeroTimerWithPool(GOLD);
  console.log('…… 等待 62s 轮询触发');
  await sleep(62000);
  st = await avatarState('gold');
  check('T1.2 轮询后 cs=GOLD', st.csMark === 'gold', st.csMark);
  check('T1.3 顶栏立即=GOLD', st.topMark === 'gold', st.topMark);
  check('T1.4 所有已渲染气泡立即变GOLD/无残留红 (' + st.counts + ')',
    st.marked >= 1 && st.counts.indexOf('red:0') === 0 && (st.counts.indexOf('gold:' + st.marked) >= 0 || st.counts.indexOf('jpeg:' + st.marked) >= 0), st.counts + '/odd:' + st.oddSample);
}

// ================= T2 聊天页隐藏时轮询触发，真实进入 =================
{
  await seedPool(GOLD, GOLD); // 当前=GOLD
  await enterChatReal();
  await sleep(200);
  await evalJs(`document.getElementById('page-chat').hidden = true; true;`);
  await zeroTimerWithPool(BLUE);
  console.log('…… 等待 62s 轮询触发（聊天页隐藏）');
  await sleep(62000);
  await enterChatReal();
  const st = await avatarState('blue');
  check('T2.1 cs=BLUE', st.csMark === 'blue', st.csMark);
  check('T2.2 顶栏=BLUE', st.topMark === 'blue', st.topMark);
  check('T2.3 气泡=BLUE/无残留金 (' + st.counts + ')',
    st.marked >= 1 && st.counts.indexOf('gold:0') >= 0 && (st.counts.indexOf('blue:' + st.marked) >= 0 || st.counts.indexOf('jpeg:' + st.marked) >= 0), st.counts + '/odd:' + st.oddSample);
}

// ================= T3 大图主动换（修复核心）：压缩落 LS + 跨会话立即可读 =================
{
  await seedPool(RED, RED); // 当前=RED 小图；池=[大GOLD]
  await zeroTimerWithPool(BIGGOLD);
  // 池是大键（只在 IDB），启动首检会因池未回填而跳过；产品靠 60s 轮询在回填完成后触发。
  // #129 修正：回填速度随全库体积浮动（#160 后库显著变大），固定 65s 常错过唯一轮询点——
  // 改自适应轮询：盯 avatar-lib-last 推进（换入前先推进周期）或 cs 变 jpeg，命中即提前收工
  await gotoApp();
  // #129 修正：池是大键（只在 IDB），累积 profile 下启动回填可能超预算挂起 → 页内 getLib()
  // 永远为空 → 轮询永远跳过（空 profile 探针 5s 即恢复，验证产品切换链路本身正常）。
  // 池不可读时从当前页面直接重种（s.set 三写、memoryCache 立即可读），继续测真实的
  // 「60s 轮询 → jpeg 压缩 → cs 落 LS」链路——这才是 T3 的被测核心
  // 池不可读或被应用首启默认池种子（~214B，含与 cs 相同的 RED→「随机到当前头像跳过」永跳）
  // 覆盖时，强制重种到 [BIGGOLD]；以「池 JSON 长度===BIGGOLD」为就绪条件
  for (let i = 0; i < 12; i++) {
    const len = await evalJs(`String((window.activeStore().get('avatar-lib')||'')).length`);
    if (Number(len) === BIGGOLD.length) break;
    await sleep(2000);
    await zeroTimerWithPool(BIGGOLD);
  }
  const seedAt = Date.now();
  console.log('…… 自适应等待（IDB 回填 + 60s 轮询触发大图更换，上限 130s）');
  let st = null;
  for (let i = 0; i < 44; i++) {
    await sleep(3000);
    st = await avatarState('');
    const last = parseInt(await evalJs(`String(window.activeStore().get('avatar-lib-last')||'0')`), 10);
    if ((st.csIsJpeg && st.csLen > 1000) || (last > seedAt && st.csIsJpeg)) break;
  }
  check('T3.1 大图已压缩写入（jpeg 且 <200KB，原 ' + BIGGOLD.length + 'B → ' + st.csLen + 'B）',
    st.csIsJpeg && st.csLen > 0 && st.csLen < 200 * 1024, 'len=' + st.csLen + ' jpeg=' + st.csIsJpeg);
  check('T3.2 cs 键同步落在 localStorage（跨会话立即可读）', await evalJs(
    `!!localStorage.getItem('xy-home-v2:default:cs-avatar-partner')`), '');
  check('T3.3 顶栏显示新图（非默认人形）', st.topIsImg, st.topMark);
  // 跨会话：重载后【早期】窗口顶栏就应是新图（修复前此处回退旧桌面头像/空）
  await gotoApp(400);
  const early = await evalJs(`(function(){
    var top = document.getElementById('chat-partner-av');
    var h = top ? String(top.innerHTML||'') : '';
    return { isImg: h.indexOf('<img')>=0, isJpeg: h.indexOf('data:image/jpeg')>=0,
      lsHas: !!localStorage.getItem('xy-home-v2:default:cs-avatar-partner'),
      oldRed: h.indexOf('ff2255')>=0 };
  })()`);
  check('T3.4 重载早期：localStorage 有压缩键 + 顶栏已是新 jpeg 图（无旧图回退窗口）',
    early && early.lsHas && early.isImg && early.isJpeg && !early.oldRed, JSON.stringify(early));
}

// ================= T4 显示收敛兜底：存储已换、DOM 停旧态 → visibilitychange 重刷 =================
{
  await seedPool(TEAL, TEAL); // 存储换成 TEAL（模拟另一上下文/迟到路径写入）
  await enterChatReal();
  const r = await evalJs(`(function(){
    var top = document.getElementById('chat-partner-av');
    var before = String(top.innerHTML||'');
    top.innerHTML = '<b>stale</b>'; // 人为把界面打回旧态
    document.dispatchEvent(new Event('visibilitychange'));
    return { changed: String(document.getElementById('chat-partner-av').innerHTML||'').indexOf('0a9c8a')>=0 };
  })()`);
  check('T4.1 可见性恢复后顶栏按存储值收敛为新图', r && r.changed, JSON.stringify(r));
}

const passed = results.filter((x) => x.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill();
server.close();
process.exit(passed === results.length ? 0 : 1);
