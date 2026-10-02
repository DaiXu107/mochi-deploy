// ===== 专项验证 #1340：小米15/Edge（桌面快捷方式）「页面可以上下滑动飞出屏幕，全屏也会有空白」 =====
// 用户实报（安装到桌面快捷方式打开；明说其他设备型号也有出现、要求不要覆盖式修补）。诊断单
// mochi-screen-diag-2026-09-27-01-54-…docx 现场：screen 370×822／inner==vv==369×762／
// standalone=false／本机手调 h+12 shift+15／整张单全 ✓ bad:[]。
//
// 无头同尺量出来的两处根因（都与机型／内核无关）：
//  ① 文档从来没有「不可滚」这条约束。#185（iPad 独立应用「文档可滚时橡皮筋把整页来回拽＝滑动
//     位置会飞、一弹一弹」）与 #537（iOS 覆盖形态「flex 居中把 .phone 整块挪走 31px＝顶部重叠＋
//     底部白带」）各自撞见过同一物理后果，但两道收口都写死在 iOS standalone 的选择器上；竖屏
//     浏览器形态只锁了 overflow-x ⇒ 壳与视口差出的那一格同时是「白带」和「可拖走的量」。实测
//     本机真值 shift=15：文档底 777／视口 762 ⇒ 真手指一拖整页被拖走 15px 且松手不回位。
//  ② #916 的稳态高度对账拿【底边】当尺寸尺（`.phone 底边 − innerHeight`）。底边＝顶边＋壳高，
//     而顶边会被任何一格平移挪走（用户手调整体位移 #707／内核 style.top 平移 #236·#1330）⇒
//     凡顶边不在 0 的机器偏差恒等于那段位移（shift=15 ⇒ 永久 +15px＞8）＝钉高一经挂上永不摘除；
//     钉的值又是「挂上那一刻」的视口高，视口一变高没人让它作废 ⇒ 实测 762→822 那 2~3s 里壳高
//     仍 762 而盒子已 822，body flex 居中把 60px 劈成顶 45／底 15 两条白带（＝「全屏也会有空
//     白」）；反向变矮时同一格变成「整页可拖走 60px」。
// 本批收口（判据只取「文档能不能被拖走」「这一格壳多高」两个事实，零机型／零 UA 分支）：
//  ① base.css 竖屏形态（含 force-mobile 复刻）根不可滚＋壳顶对齐，刻意不动 .ios-pwa-standalone；
//  ② mobile-adapt.js 对账改量【盒高】vs innerHeight，且钉高一经挂上就当拍跟随视口（两拍闸只管
//     要不要开始钉，#916 的职责一字未动，由 E 组守着）。
// ⚠️ 分工：本批【不管】「位移轴越界本身该不该夹回」与「屏幕适配诊断的纵尺」——那是 #1322 在同一
//    台机（370×822／shift+15 同形）上正在收的两件，两处各写一份＝同一事实两个主人＝用户所厌的
//    覆盖式修补。本批的两条与那条互余：那条让位移不越界，本批让「无论谁把壳撑歪，整页拖不走、
//    差出来的一律留在下沿、钉高不再拿位置当尺寸」。
// 用法：node tools/verify-1340-doc-fit-invariant.mjs [被测根目录]（或 MOCHI_ROOT=…）
// 同尺 A/B：字面同一把尺子分别打两侧，只看失败条名。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const target = normalize(process.argv[2] || process.env.MOCHI_ROOT || here);
console.log('被测根目录 = ' + target);
if (!existsSync(join(target, 'index.html'))) { console.error('被测根目录没有 index.html（产物未构建？）'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('✅ ' + name); } else { fail++; console.log('❌ ' + name); } };
const rd = (...p) => { try { return readFileSync(join(target, ...p), 'utf8'); } catch (e) { return ''; } };

// ---------- S 组：静态锚（CSS 走 minifyCss，needle 按产物原文；device.js／base.css 内联在 index.html） ----------
const idx = rd('index.html');
const jsMA = rd('js', 'mobile-adapt.js');
ok('S1 竖屏形态根不可滚＋壳顶对齐在产物（删回只锁 overflow-x＝整页又能被拖走，本批复报）',
  idx.includes('html:not(.ios-pwa-standalone), html:not(.ios-pwa-standalone) body { overflow:hidden; align-items:flex-start; }'));
ok('S2 force-mobile 复刻同一对约束在产物（漏一份＝手机伪装桌面 UA 时媒体查询不命中，整页照旧可拖走）',
  idx.includes('html.force-mobile:not(.ios-pwa-standalone), html.force-mobile:not(.ios-pwa-standalone) body { overflow:hidden; align-items:flex-start; }'));
ok('S3 #916 尺子改量盒高（顶边去哪不管；改回底边＝把一格平移当偏差，钉高永不摘除）',
  jsMA.includes('var _aPhH = Math.round(_aPhone.getBoundingClientRect().height);')
    && jsMA.includes("var _aDev = (_aPhH > 0) ? (_aPhH - _aExpB) : 0;"));
ok('S4 钉高一经挂上当拍跟随视口（删＝视口变高后还要压 2~3s 过期内联高＝「全屏也会有空白」本体）',
  jsMA.includes("if (_aFitPin && _aPhone.style.height !== _aExpB + 'px') {"));
ok('S5 删除型：#916 旧底边尺不得回流（拿 .phone 底边当尺寸的写法必须整行消失）',
  !jsMA.includes('var _aPbNow = Math.round(_aPhone.getBoundingClientRect().bottom);')
    && !idx.includes('var _aPbNow = Math.round(_aPhone.getBoundingClientRect().bottom);'));
ok('S6 邻居旧针一字未动（#916a 两拍行／#209 清扫行／#1330a 键盘期不补平移那行）',
  jsMA.includes('if (_aFitPend === _aExpB) {')
    && jsMA.includes('if (_hNow > 0 && _hNow >= _aH - 12 && (window.innerHeight || 0) >= _aIH - 12) {')
    && jsMA.includes('var _voidPan = (_aIH - (window.innerHeight || 0)) > 60;'));

// ---------- 运行时夹具 ----------
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = chromeCandidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge：运行时组跳过（环境不满足，不算回归）'); console.log('\n#1340 verify：通过 ' + pass + ' / 失败 ' + fail + ' / 运行时未跑'); process.exit(fail ? 1 : 0); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(target, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(target)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9100 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1340-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const uncaught = [];
try {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
          else if (m.method === 'Runtime.exceptionThrown') uncaught.push(String((m.params.exceptionDetails || {}).error || '').slice(0, 120));
        };
        break;
      }
    } catch (e) {}
    await sleep(150);
  }
  if (!ws) throw new Error('CDP 连接失败');
} catch (e) { console.error(e.message); try { chrome.kill(); } catch (e2) {} server.close(); process.exit(2); }

const cdp = (method, params = {}) => new Promise((res) => { const id = ++msgId; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : undefined; };
// 触摸仿真必须显式打开：#916 稳态对账的闸门里有 pointer:coarse，没开 E 组永远量不到钉高
// （第一版就把这条当成「修复没生效」报过一次——E1 现在把 coarse 一起打在读数里，这类夹具谎当场可见）
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

// 一次读数：整页那一格。⚠️ 两个口径分得很清：
//   slack ＝ 文档比视口高出的那一格（= 结构上「有多少可拖量」，本批不承诺它为 0——那是 #1322 的
//           位移夹回职责），dragged ＝ 真手指拖完之后文档实际被拖走了几 px（＝本批的承诺）。
const PROBE = `(() => {
  const d = document.documentElement, b = document.body, ph = document.querySelector('.phone');
  const r = ph.getBoundingClientRect();
  return {
    ih: innerHeight, vvH: Math.round((window.visualViewport || {}).height || 0),
    slack: Math.max(d.scrollHeight, b.scrollHeight) - innerHeight,
    scrolled: Math.round(window.scrollY || d.scrollTop || b.scrollTop || 0),
    pTop: Math.round(r.top), pBottom: Math.round(r.bottom), pH: Math.round(r.height),
    inlineH: ph.style.height || '', align: ph.style.alignSelf || '',
    bodyAlign: getComputedStyle(b).alignItems,
    lock: b.classList.contains('scroll-lock'),
    modalOpen: (() => { const m = document.getElementById('modal-mask'); return !!m && !m.hidden && m.getClientRects().length > 0; })(),
    adj: (window.mochiScreenAdj ? window.mochiScreenAdj.all() : null)
  };
})()`;

// 把页面归位到未滚动状态再量「白带多宽」：文档坐标系与视口坐标系就此对齐（判可拖量本免疫）
async function zero() {
  await ev(`(() => { try { window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; } catch (e) {} return 1; })()`);
  await sleep(180);
}

// 真手指纵向拖（Input.dispatchTouchEvent）
// 慢拖＋拖完等 1.4s：惯性/合成落定要时间——快拖只发一轮位移时 HEAD 侧会「看起来拖不动」，那是
// 夹具太快不是修复好（B 组第一版就这么假绿过一次），落定后的读数才算数。
// ⚠️ 符号口径＝「dy>0 = 手指向上划 = 内容向下滚」。第一版方向写反（手指往下划）而文档本就在
// scrollTop:0，内核无事可滚 ⇒ 「拖不动」在 HEAD 侧也全绿＝把断言达成装成达成。
async function swipe(dy) {
  await zero();
  const pt = (y) => [{ x: 190, y, radiusX: 6, radiusY: 6, force: 1 }];
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(620) });
  for (let i = 1; i <= 12; i++) { await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(620 - Math.round(dy * i / 12)) }); await sleep(40); }
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(1400);
}

// 等现场安静：进应用后备份提醒／存储修复引导会连着弹（受保护的产品提醒，只【点掉】不改逻辑）。
// 弹层一开 body 就挂 scroll-lock＝整页被弹层锁住，此后任何「拖得动/拖不动」的读数都没有意义。
async function quiet(rounds = 12) {
  let stable = 0;
  for (let i = 0; i < rounds; i++) {
    const st = await ev(`(() => { const m = document.getElementById('modal-mask');
      return { open: !!m && !m.hidden && m.getClientRects().length > 0, lock: document.body.classList.contains('scroll-lock') }; })()`);
    if (!st.open && !st.lock) { if (++stable >= 2) return true; } else stable = 0;
    if (st.open) await ev(`(() => { const m = document.getElementById('modal-mask'); if (m.hidden || !m.getClientRects().length) return 0;
      const c = document.getElementById('modal-cancel'), k = document.getElementById('modal-ok');
      const btn = (c && !c.hidden) ? c : (k && !k.hidden ? k : null); if (btn) btn.click(); return 1; })()`);
    await sleep(500);
  }
  return false;
}

// 真手指拖，但只认「拖的那一刻现场是安静的」：脏了就重来（至多 4 次），最后一次读数交给断言
async function swipeClean(dy) {
  let st = null;
  for (let i = 0; i < 4; i++) {
    if (!(await quiet(4))) { await sleep(600); continue; }
    await swipe(dy);
    st = await ev(PROBE);
    if (!st.lock && !st.modalOpen) return st;
  }
  return st || await ev(PROBE);
}

async function waitForReady() {
  for (let i = 0; i < 150; i++) { if (await ev('!!window.__mochiDataReady')) return true; await sleep(200); }
  return false;
}

// 手调轴在 #707 那个 IIFE 的解析期就读进内存（loadAdj），写完必须整页重载才作数＝两步加载
async function loadAndEnter(writeAdj) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: 369, height: 762, deviceScaleFactor: 3, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html?x=' + Date.now() });
  await waitForReady();
  await sleep(800);
  if (writeAdj) await ev(`(() => { try { ${writeAdj} } catch (e) {} return 1; })()`);
  await cdp('Page.navigate', { url: baseUrl + '/index.html?y=' + Date.now() });
  await waitForReady();
  await sleep(1000);
  await ev(`(() => { const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click(); const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; } return 1; })()`);
  await sleep(1500);
  return quiet();
}

let runtimeRan = false;
try {
  // ===== P 组：夹具真实（两侧都该绿；红＝读数无意义） =====
  const ready = await loadAndEnter(`['shift','h','top','bottom','desk'].forEach(function(k){localStorage.removeItem('xy-home-v2:screen-adj-'+k)})`);
  const p = await ev(PROBE);
  ok('P0 页面真加载（inner==vv==762／数据就绪）', p.ih === 762 && p.vvH === 762);
  ok('P1 现场已安静（通用提醒弹窗连弹已点掉、body 无 scroll-lock）＝弹层在场时整页本就被锁，读数无意义', ready && !p.lock && !p.modalOpen);
  ok('P2 零手调稳态：壳铺满整格（顶0／底=视口／可拖量 0）＝症状不在场时的基线', p.pTop === 0 && p.pBottom === 762 && p.slack === 0);
  runtimeRan = true;

  // ===== A 组：零手调对照（两侧皆绿＝本批没修过头、也没误伤 #916） =====
  const a1 = await swipeClean(200);
  ok('A1 零手调·真手指上拖 200px 文档纹丝不动（scrolled=' + a1.scrolled + ' 顶=' + a1.pTop + ' lock=' + a1.lock + '）',
    a1.scrolled === 0 && a1.pTop === 0 && !a1.lock && !a1.modalOpen);
  ok('A2 健康稳态对账零写入（.phone 无内联高＝#916 不误伤健康机器）', a1.inlineH === '');
  ok('A3 竖屏形态 body 已顶对齐（实测 align-items=' + a1.bodyAlign + '）——HEAD＝center，差出来那一格被劈成上下两条',
    a1.bodyAlign === 'flex-start' || a1.bodyAlign === 'start');

  // ===== E 组：#916 旧契约不缩尺（注入「内核 dvh 报小」的等价形态；同场继续量） =====
  await ev(`(() => { const st = document.createElement('style'); st.id = 'p1340-dvh-lag'; st.textContent = '.phone{height:699px}'; document.head.appendChild(st); return 1; })()`);
  const KBDIAG = `(() => { const ph = document.querySelector('.phone'); const k = window.__mochiAndroidKb ? window.__mochiAndroidKb() : null;
    return { inline: ph.style.height, phH: Math.round(ph.getBoundingClientRect().height), lock: document.body.classList.contains('scroll-lock'),
      coarse: matchMedia('(pointer: coarse)').matches, standalone: matchMedia('(display-mode: standalone)').matches,
      kb: k && { kbActive: k.kbActive, prov: k.prov, vpPin: k.vpPin, fullInner: k.fullInner, fullVv: k.fullVv, vvNow: k.vvNow } }; })()`;
  let e1 = null;
  for (let i = 0; i < 30; i++) { await sleep(600); e1 = await ev(KBDIAG); if (e1.inline === '762px') break; }
  ok('E1 dvh 报小 63px 时钉高仍在（内联高=' + (e1.inline || '(空)') + ' 量得 ' + e1.phH + 'px／钉高侧现场 ' + JSON.stringify(e1) + '）＝#916 职责一字未动',
    e1.inline === '762px' && !e1.standalone);
  const e2 = await ev(PROBE);
  ok('E2 钉高发病期内整页拖不走（可拖量=' + e2.slack + '＝壳比盒子矮，本就无溢出可滚）', e2.slack <= 0);
  await ev(`(() => { const st = document.getElementById('p1340-dvh-lag'); if (st) st.remove(); return 1; })()`);
  let released = false;
  for (let i = 0; i < 24; i++) { await sleep(600); if ((await ev(`document.querySelector('.phone').style.height`)) === '') { released = true; break; } }
  ok('E3 撤掉模拟后钉高摘除回落 CSS', released);
  await quiet(4); await zero();
  const e4 = await ev(PROBE);
  ok('E4 复原后壳重新铺满（顶' + e4.pTop + ' 底' + e4.pBottom + '）', e4.pTop === 0 && e4.pBottom === 762 && !e4.lock);

  // ===== A5：聊天页贴底（根不可滚没把贴底/内部滚动弄坏） =====
  await ev(`(() => { const a = document.querySelector('.app[data-app="chat"]'); if (a) a.click(); return 1; })()`);
  await sleep(2600);
  await quiet(6);
  const a5 = await ev(`(() => { const i = document.querySelector('.chat-input'); const r = i ? i.getBoundingClientRect() : null;
    const cb = document.getElementById('chat-body'); return { bottom: r ? Math.round(r.bottom) : null, top: r ? Math.round(r.top) : null,
      cbScroll: cb ? (cb.scrollHeight > cb.clientHeight) : false }; })()`);
  ok('A5 聊天页输入栏仍贴视口底（底=' + (a5.bottom || '?') + '／视口 762）', !!a5.bottom && a5.bottom <= 764 && a5.bottom >= 700 && a5.top > 0);

  // ===== B 组：症状一本体（本机真值 shift=15） =====
  await loadAndEnter(`localStorage.setItem('xy-home-v2:screen-adj-shift','15'); localStorage.setItem('xy-home-v2:screen-adj-h','12')`);
  await sleep(1200);
  await quiet(6); await zero();
  const b0 = await ev(PROBE);
  ok('B0 该轴读数真实在场（shift=15 确实落进 mochiScreenAdj，两侧同值＝夹具真实）', !!b0.adj && b0.adj.shift === 15);
  ok('B0b 位移在场时钉高不挂（内联高="' + b0.inlineH + '"）——HEAD＝尺子把位移当偏差，一经挂上永不摘', b0.inlineH === '');
  const b2 = await swipeClean(160);
  ok('B2 真手指上拖 160px 拖不动整页（scrolled=' + b2.scrolled + ' 顶=' + b2.pTop + ' 可拖量=' + b2.slack + ' lock=' + b2.lock + '）——HEAD＝整页被拖走 15px 且松手不回位',
    b2.scrolled === 0 && !b2.lock && !b2.modalOpen);

  // ===== C 组：症状二本体（视口 762→822＝Edge 工具条收起／进全屏） =====
  // 先让看门狗跑满几拍：HEAD 侧要等它把钉高挂上（实测约 3s：1s 节拍×两拍确认＋vv 稳 1.2s）才有
  // 「过期内联高」可留；不 settle 就变视口，两侧都从【没钉】起步＝白带那两格在 HEAD 侧也会假绿。
  await quiet(4); await zero();
  await sleep(4200);
  const preC = await ev(PROBE);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 369, height: 822, deviceScaleFactor: 3, mobile: true });
  let worstGapBottom = 0, worstGapTop = 0, worstDragged = 0;
  const samples = [];
  for (let i = 0; i < 5; i++) {
    await sleep(450);
    await zero();
    const s = await ev(PROBE);
    samples.push(s.ih + ':顶' + s.pTop + '/高' + s.pH + '/底' + s.pBottom + (s.inlineH ? '/pin' + s.inlineH : ''));
    worstGapBottom = Math.max(worstGapBottom, 822 - s.pBottom);
    worstGapTop = Math.max(worstGapTop, s.pTop - 15);
    worstDragged = Math.max(worstDragged, s.scrolled);
  }
  ok('C1 视口变高全过程壳底不留白带：距视口底最大 ' + worstGapBottom + 'px（变高前沿 ' + (preC.inlineH ? '钉高在位=' + preC.inlineH : '无内联钉高') + '；读数 ' + samples.join(' | ') + '）——HEAD＝差 15px 压 2~3s', worstGapBottom <= 2);
  ok('C2 顶带不超位移本身：壳顶相对 15 最大多出 ' + worstGapTop + 'px（居中劈带＝用户所见「上面空一条」）——HEAD＝多出 30px', worstGapTop <= 2);
  ok('C3 视口变高期间整页仍拖不动（最大被拖走 ' + worstDragged + 'px）', worstDragged === 0);

  // ===== D 组：反向（822→762＝工具条回弹／退出全屏）——过期内联高的正面形态 =====
  await quiet(4); await zero();
  await sleep(3000);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 369, height: 762, deviceScaleFactor: 3, mobile: true });
  let worstH = 0, worstDraggedD = 0;
  const samplesD = [];
  for (let i = 0; i < 5; i++) {
    await sleep(450);
    await zero();
    const s = await ev(PROBE);
    samplesD.push(s.ih + ':高' + s.pH + (s.inlineH ? '/pin' + s.inlineH : '') + '/拖' + s.scrolled);
    worstH = Math.max(worstH, s.pH);
    worstDraggedD = Math.max(worstDraggedD, s.scrolled);
  }
  ok('D1 视口变矮当拍壳高就等视口（全过程壳高最大 ' + worstH + '，读数 ' + samplesD.join(' | ') + '）——HEAD＝内联钉在 822 把整页撑成可拖走', worstH <= 762);
  const d2 = await swipeClean(200);
  ok('D2 反向之后真手指上拖 200px 仍拖不动（scrolled=' + d2.scrolled + ' 可拖量=' + d2.slack + '）——HEAD＝整页又被拖走', d2.scrolled === 0);

  // ===== G 组：不变量与来源无关（换一个「撑高壳」的源头，照样拖不走） =====
  await ev(`(() => { const st = document.createElement('style'); st.id = 'p1340-tall'; st.textContent = '.phone{height:900px}'; document.head.appendChild(st); return 1; })()`);
  await sleep(700);
  const g0 = await ev(PROBE);
  ok('G0 夹具真实：壳被人为撑到 900（可拖量=' + g0.slack + '＞0）＝「文档确有溢出」这一前提在场', g0.slack > 60);
  const g1 = await swipeClean(300);
  ok('G1 溢出来源换成「内容撑高」时不变量照样成立：真手指拖 300px 被拖走 ' + g1.scrolled + 'px（可拖量=' + g1.slack + '）', g1.scrolled === 0);
  await ev(`(() => { const st = document.getElementById('p1340-tall'); if (st) st.remove(); return 1; })()`);
  await sleep(700);
  const g2 = await ev(PROBE);
  ok('G2 撤掉人为撑高后回位（顶' + g2.pTop + ' 底' + g2.pBottom + ' 钉高=' + (g2.inlineH || '无') + '）', g2.pTop <= 15 && g2.slack <= 15);
} catch (e) {
  if (runtimeRan) { fail++; console.log('❌ 运行时组执行异常：' + (e && e.message)); }
  else { console.error('运行时未跑（环境）：' + (e && e.message)); }
} finally {
  try { chrome.kill(); } catch (e) {}
  server.close();
}

ok('Z1 全程零未捕获异常（' + uncaught.length + '）', uncaught.length === 0);
console.log('\n#1340 verify-1340-doc-fit-invariant：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
