// ===== 常驻回归：#1225 桌面全屏合成层的「亮屏离开桌面 60s」释放闸 =====
// 病灶（本机两份真机诊断实证，iPhone 16 Pro Max / iOS 18.7，主屏幕独立应用）：
//   perfcheck 30 秒＝掉帧率 34%、前台冻结 32 次、最慢一帧 2449ms，而 76% 的帧在 设置、桌面只占 17%；
//   同一份诊断「本页被系统回收过 28 次」。#754 把三张 .page-slide 提到独立合成层（will-change:transform）
//   治的是桌面**翻页**每帧重栅格整屏大图（实测平均 186ms→17ms），代价是三张常驻全屏纹理
//   （440×956@3x 每张≈15MB、共≈45MB 显存）**人不在桌面时也照样常驻**——正是把 iOS 推到整页回收、
//   把每次「切回来」变成整站冷启动（5.2MB 脚本重编＋十几 MB 本地数据重回填）的那笔常驻显存；
//   回收同时掐掉未提交的写库窗口（＝用户报的「聊天记录丢失」的同源线索，写库侧属聊天域，另批处理）。
// 修法：desktop-slider 只在「桌面 hidden 且亮屏」时起一轮 60s 计时，命中给 <html> 挂 desk-layer-cold，
//   home.css 在该类下把三张层的 will-change 收回 auto；回到桌面（hidden 翻回 false／从后台回前台且
//   当前就在桌面）当场撤闸，**后台期不计时**（iOS 挂起时 GPU 本就作废，不该把重新提升的成本压进
//   用户报的「切回来」窗口）。判据只有「桌面这一页可见与否＋亮屏多久」，零机型、零 UA 分支。
// 刻意不做：① 不动 #147 的壁纸层（`#phone-bg-layer` 常驻那一层，撤了＝「退聊天回桌面巨卡」复发）；
//   ② 不在「桌面隐藏」那一刻无条件释放（那正是本批要治的 hot path 上多一次纹理重上传）；
//   ③ 不加任何机型/系统版本白名单。
// 断言（判别力＝纯 HEAD 副本必红下面标 (R) 的那些；其余两侧同绿＝对照组，证邻居一件没被改坏）：
//   S 组＝逻辑锚（src ＋ 产物双查）：闸的起表/撤闸/首屏补起/回前台重裁决/后台不计时代码 (R)、
//         CSS 释放规则（src＋产物＋必须落在触屏块内）(R)；
//         邻居锚：#754 提升行、#147 壁纸常驻层、#976 的 150ms 延迟恢复档位与观察器原有校正逻辑；
//         零机型分支：产物 js/desktop-slider.js 内无 userAgent 嗅探、home.css 无非媒体查询白名单。
//   B 组＝真浏览器（393×852 ＋ 触屏形态（setTouchEmulationEnabled，实测只有它能让 Blink 报
//         hover:none/pointer:coarse），setTimeout 的 60000 档缩到 700ms）：
//     B1 触屏形态生效（不生效＝整组假绿，直接 SKIP 退出 2）
//     B3 人在桌面待满 1.4s（＞缩放后的 700ms）也**不摘**＝#147 常驻语义没被动
//     B4 真用户路径：点「设置」tab → 桌面页真 hidden (输入条件) → 满 700ms 自动挂闸 (R) →
//        三张 .page-slide 计算 will-change 真变 auto (R) → 相位日志记到 desk-layer-cold (R)
//     B5 点回桌面 tab → 当场撤闸（不等 60s、不靠下一次交互）(R 的反向半边)
//   Z1 全程零未捕获 JS 异常
// 本批另一半（最慢帧现场归因尺子＝perf-check.js ＋ 恢复模糊打戳＝tabs.js/desktop-slider.js 两处接线）
//   **刻意未入库**：`src/js/perf-check.js` 此刻是并行会话 #1226 的在途未构建文件（同文件并发＝本仓禁令），
//   补丁与本电池的尺子断言留在 `C:\Users\Administrator\m1225\staged\`，待 #1226 收口后在最新 tip 上重放。
// 红绿对照（两侧同一支脚本、同一负载，实测 2026-09-25）：绿侧（本批副本）＝**36 通过 / 0 失败**；
//   红侧（纯 HEAD 副本 44872e9）＝14 通过 / **22 失败**，红的恰是本批新契约半边：S1~S6（闸的六段代码）、
//   S9（两枚相位点）、S10（60s 常量）、S11~S13（CSS 释放规则的 src／产物／触屏块内位置）、
//   B4b/B4c/B4d（真路径自动挂闸→will-change 真变 auto→相位日志）、B5c（撤闸留 warm 点）。
//   两侧皆绿＝对照组，证邻居一件没被改坏：S7/S8（#976 的 150ms 档位与位置校正）、S14（#754 提升行）、
//   S15（#147 壁纸常驻层）、S16/S17（零机型分支）、B1（触屏形态）、B3（在桌面永不摘层＝不许修过头）、
//   B4a（真路径的输入条件）、B5/B5b（回桌面当场恢复）、Z1（零未捕获异常）。
// 用法：node tools/verify-1225-desk-layer-cold.mjs
//       MOCHI_SERVE_ROOT=<产物目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）。
//       MOCHI_CDP_PORT=<端口> 每支电池给不同端口（固定端口撞车＝整支静默挂死）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9740 + Math.floor(Math.random() * 40));
const userDataDir = join(tmpdir(), 'mochi-1225-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + userDataDir,
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map(); const jsExcepts = [];
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
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
          if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params && m.params.exceptionDetails;
            const desc = (d && ((d.exception && d.exception.description) || d.text)) || 'err';
            jsExcepts.push(String(desc).split('\n').slice(0, 2).join(' | ').slice(0, 180));
          }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return 'EVAL_ERR:' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
const check = (d, ok, detail) => { if (ok) { pass++; console.log('  PASS  ' + d + (detail !== undefined ? '  [' + detail + ']' : '')); } else { fail++; console.log('  FAIL  ' + d + (detail !== undefined ? '  [' + detail + ']' : '')); } };

// ---------- S 组：逻辑锚（src ＋ 产物双查）----------
console.log('[S] 逻辑锚（src + 产物双查）');
const rd = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const srcSlider = rd('src/js/desktop-slider.js'), prodSlider = rd('js/desktop-slider.js');
const srcCss = rd('src/css/home.css'), html = rd('index.html');
const SLIDER = [
  ['S1 释放闸计时器本体（删＝离开桌面永不释放，闸形同虚设）',
    'deskColdT = setTimeout(function () { deskColdT = 0; setDeskCold(true); }, DESK_COLD_MS);'],
  ['S2 离开桌面才起表，且起表后立即返回（缺＝撤闸分支被合并进校正逻辑，回到桌面不再当场恢复）',
    'if (phonePage.hidden) { deskColdArm(true); return; }'],
  ['S3 撤闸＝setDeskCold(false)（**#147 的常驻语义靠这一句保住**）',
    'if (!arm) { setDeskCold(false); return; }'],
  ['S4 后台期不计时（删成照常计时＝把重新提升的成本压进用户报的「切回来」窗口）',
    "if (typeof document !== 'undefined' && document.hidden) return;"],
  ['S5 从后台回前台重新裁决（缺＝挂起期整段被当成「离开桌面满 60s」，回前台第一帧正好掉层）',
    'if (phonePage.hidden) deskColdArm(true); else deskColdArm(false);'],
  ['S6 首屏就不在桌面时补起一轮（缺＝深链/上次停在别的页时这一轮根本不计时）',
    'deskColdArm(!!phonePage.hidden);'],
  ['S7 #976 邻居锚：滑动停手 150ms 后摘 desk-swiping 这一拍未动（本批不许改延迟恢复模糊的档位）',
    "document.documentElement.classList.remove('desk-swiping');"],
  ['S8 #976 邻居锚：摘类后仍回到同一个位置校正（观察器重写只加了闸的收支，校正一字未动）',
    'refreshCache();'],
  ['S9 闸挂/摘各写一枚相位点（缺＝下一份真机诊断看不见这条闸到底咬合过没有）',
    "window.__mochiPhase(on ? 'desk-layer-cold' : 'desk-layer-warm')"]
];
SLIDER.forEach(([n, needle]) => {
  check(n + '（src）', srcSlider.indexOf(needle) >= 0);
  check(n + '（产物 js/desktop-slider.js）', prodSlider.indexOf(needle) >= 0);
});
check('S10 60s 常量＝60000（改成秒级＝正常来回里掉层＝#147 复发；改成无穷＝本批等于没做）', srcSlider.indexOf('const DESK_COLD_MS = 60000;') >= 0 && prodSlider.indexOf('const DESK_COLD_MS = 60000;') >= 0);
// CSS 两条规则（CSS 不进 js 产物，产物侧查 index.html；minify 后保留原样空格，实测）
const COLD = 'html.desk-layer-cold .desktop-pages.has-page-bg .page-slide { will-change: auto; }';
check('S11 释放规则在 src/css/home.css', srcCss.indexOf(COLD) >= 0);
check('S12 释放规则进了产物 index.html', html.indexOf(COLD) >= 0);
check('S13 释放规则锁在触屏块内（@media (hover: none) and (pointer: coarse) 之后、该块闭合之前＝电脑端外壳零变化）', (() => {
  const i = srcCss.indexOf('@media (hover: none) and (pointer: coarse)');
  const j = srcCss.indexOf('html.desk-layer-cold .desktop-pages.has-page-bg .page-slide');
  const k = srcCss.indexOf('\n}', j);
  return i >= 0 && j > i && k > j;
})());
check('S14 #754 邻居锚：三张桌面页仍提到独立合成层（删＝本批变成「只是没有层」＝桌面翻页卡顿复发）', srcCss.indexOf('.desktop-pages.has-page-bg .page-slide { will-change: transform; }') >= 0 && html.indexOf('.desktop-pages.has-page-bg .page-slide { will-change: transform; }') >= 0);
check('S15 #147 邻居锚：壁纸层常驻合成层规则未动（本批刻意不撤它）', srcCss.indexOf('#phone-bg-layer { transform:translateZ(0); }') >= 0);
check('S16 零机型分支：产物 js/desktop-slider.js 内无 userAgent 嗅探', prodSlider.indexOf('userAgent') < 0 && srcSlider.indexOf('userAgent') < 0);
check('S17 零机型分支：home.css 去掉注释后无机型字符串（判据只有媒体查询）', /iPhone|iPod|SM-|Redmi|Pixel|Mac OS X/.test(srcCss.replace(/\/\*[\s\S]*?\*\//g, '')) === false);

// ---------- 浏览器 ----------
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true });
// 触屏形态实测口径（探针实测：无头里 hover/pointer 媒体查询不是 setEmulatedMedia 改的，
// 是 setTouchEmulationEnabled 改的——maxTouchPoints>0 才让 Blink 报 hover:none + pointer:coarse）
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
// 60s 闸缩到 700ms（只认这一个整数值，别的定时器一律不改），并预置引导已完成
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
(function(){
  var _st = window.setTimeout;
  window.setTimeout = function(fn, ms){ return _st.call(window, fn, ms === 60000 ? 700 : ms); };
  try{ localStorage.setItem('xy-home-v2:__guide-done','1'); localStorage.setItem('xy-home-v2:__onboard-done','1'); }catch(e){}
})();` });

await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 90; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
// 开屏必须摘节点（base.css 的 `.splash:not(.hide) ~ .phone{visibility:hidden}` 只看兄弟关系，
// 留着整页不可见＝后面所有可见性判据全是假红）
await evalJs("(function(){var sp=document.getElementById('splash');if(sp&&sp.parentNode)sp.parentNode.removeChild(sp);['modal-mask','qa-mask','pc-sheet-mask','backup-remind-bar'].forEach(function(id){var e=document.getElementById(id);if(e){e.hidden=true;e.style.display='none';}});return true;})()");
await sleep(800);

// 读「闸状态＋三张层的实际计算值」的一把尺（两侧共用，不依赖产品代码自证）
const STATE = `(function(){var dp=document.querySelector('.desktop-pages');if(dp)dp.classList.add('has-page-bg');
  var sl=document.querySelector('.desktop-pages .page-slide');
  return JSON.stringify({cold:document.documentElement.classList.contains('desk-layer-cold'), wc: sl?getComputedStyle(sl).willChange:'(无 .page-slide)'});})()`;

// B1 触屏形态（不生效就是环境问题，SKIP 而不是假红/假绿）
const mm = await evalJs(`(function(){return [matchMedia('(hover: none)').matches, matchMedia('(pointer: coarse)').matches, matchMedia('(hover: none) and (pointer: coarse)').matches].join(',');})()`);
if (String(mm).split(',')[2] !== 'true') {
  console.log('SKIP: 无头内核未报 hover:none/pointer:coarse（读到 ' + JSON.stringify(mm) + '）——触屏块内的 CSS 断言无法实测');
  try { ws.close(); } catch (e) {}
  chrome.kill();
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
  server.close();
  process.exit(2);
}
check('B1 触屏形态生效（hover:none + pointer:coarse）', true, mm);

// B3 人在桌面时永不摘层（待满 >缩放后的 700ms 也不算冷）
await sleep(1500);
const stay = await evalJs(STATE);
check('B3 人在桌面时永不摘层（cold=false 且 will-change=transform＝#147 常驻语义一字未动）', JSON.parse(stay).cold === false && /transform/.test(JSON.parse(stay).wc), stay);

// B4 真用户路径：点「设置」tab → 桌面 hidden → 满 700ms 自动挂闸并把三张层的 will-change 收回 auto
await evalJs("(function(){var t=document.querySelector('.tab[data-page=\"page-setting\"]'); if(t) t.click(); return !!t;})()");
await sleep(150);
check('B4a 点设置 tab 后桌面页真的隐藏（观察器的输入条件在真路径上成立；两侧同绿＝对照组）', (await evalJs("document.getElementById('page-phone').hidden")) === true);
await sleep(1100);
const coldOn = await evalJs(STATE);
check('B4b 离开桌面满 700ms（＝真机 60s）自动挂上释放闸', JSON.parse(coldOn).cold === true, coldOn);
check('B4c 挂闸后三张桌面页的 will-change 真变 auto（＝约 45MB 全屏纹理确实交还）', /\bauto\b/.test(JSON.parse(coldOn).wc), coldOn);
const ph = await evalJs("(window.__mochiPhaseLog||[]).filter(function(e){return e.tag==='desk-layer-cold'||e.tag==='desk-layer-warm';}).map(function(e){return e.tag;}).join(',')");
check('B4d 相位日志记到 desk-layer-cold（下一份真机诊断能看见这条闸咬合过没有）', String(ph).indexOf('desk-layer-cold') >= 0, ph);

// B5 回到桌面当场撤闸（不等 60s、不靠下一次交互）
await evalJs("(function(){var t=document.querySelector('.tab[data-page=\"page-phone\"]'); if(t) t.click(); return 1;})()");
await sleep(200);
const warm = await evalJs(STATE);
check('B5 回到桌面当场撤闸（cold=false）', JSON.parse(warm).cold === false, warm);
check('B5b 撤闸当帧 will-change 已回到 transform（提升在第一次翻页前就恢复＝不引入新卡顿）', /transform/.test(JSON.parse(warm).wc), warm);
const ph2 = await evalJs("(window.__mochiPhaseLog||[]).filter(function(e){return e.tag==='desk-layer-warm';}).length");
check('B5c 撤闸也留相位点（desk-layer-warm）', Number(ph2) >= 1, ph2);

// Z1 零未捕获异常
check('Z1 全程零未捕获 JS 异常', jsExcepts.length === 0, jsExcepts.slice(0, 3).join(' / '));

console.log('\n===== verify-1225-desk-layer-cold 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
try { ws.close(); } catch (e) {}
chrome.kill();
try { rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);
