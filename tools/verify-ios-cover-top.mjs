// verify-ios-cover-top.mjs — #537 iOS 独立应用【普通态·覆盖形态】整页上移/底部白条/底部栏不贴底
// 背景（用户报障，iPhone 17 + 自带 Safari 主屏幕打开＝standalone，iOS 18.7 / Safari 26.6.1；
// 用户明说其他设备型号也有、要求不要再让不同机型的适配 bug 反复出现）：
//   「集体屏幕上移，底下有白条，底部栏不贴手机底部」。
// 诊断 SIG（v3.26.709）：screen=956 inner=894 vv=894 env=62 var=62 diff=62 √ standalone
//   .phone 计算高=956 底边=925 tabbar 底边=873；✗顶部重叠（sb 顶位 0px 应 ≥62）
//   ✗底部少填 31px 白带（期望底 956 实测 925）。
// 根因两条（都是「覆盖形态」的既有链缺口，非机型特判）：
//   ①html/body 停在 100dvh(894) 而 .phone 被写到整块物理屏 956（#179/#277 的 expBase=envTop+inner）
//     → 子元素比容器高 62px，html/body 是 display:flex + align-items:center，整块上移
//     (956−894)/2=31px：顶部钻进系统状态栏、底部露 31px 白带、tabbar 随之上移（925/873 两数
//     与「上移 31px」完全吻合）。
//   ②覆盖形态在 CSS 侧只有 ios-fs-active（全屏模式）链有避让：普通态既无 .phone 顶部 padding、
//     窄屏 @media 的状态栏安全区留白又被后加载的同特异性 .statusbar{padding:4px…} 压死
//     （#114 同根因）→ Mochi/时间/电量那行常驻钻在系统状态栏里；.phone 的 18px 底部内边距
//     还与 tabbar 的 --mochi-safe-bottom(34px) 叠成 52px 空档＝「底部栏不贴手机底部」。
// 修复：#209 单一事实源新增 iosCover（判定器）→ 执行器挂 html.ios-cover-top → base.css
//   把 html/body 钉到与 .phone 同高 + 顶对齐（①），并让该形态 .statusbar 自身抬升、
//   .phone 底部内边距归零（②）。
//
// 验证方式（无头 Chrome 加载构建产物，440×894 模拟用户的布局视口）：
//   S1 覆盖形态几何：--mochi-ios-h=956 + .phone 高 956 → .phone 顶=0/底=956、html/body 高=956
//      （修前＝顶 −31/底 925，S1b 现场还原证明断言有鉴别力）、tabbar 贴 .phone 底
//   S2 非覆盖形态零回归：--mochi-ios-h 缺失或=可视高（保留 18.3 / 已避让 / iPad 数值）→
//      .phone 仍在原位（顶=0），html/body 高度=修前（100dvh）不变
//   S3 状态栏避让：html.ios-cover-top + --mochi-safe-top=62 → .statusbar padding-top=76
//      （=14+62，落在系统状态栏下方）；无该类时仍是 4px（保留/浏览器形态不受影响）
//   S4 底部贴合：ios-cover-top 下 .phone padding-bottom=0（tabbar 直接贴物理屏底，
//      只留自身 --mochi-safe-bottom 避让 Home 指示条）
//   S5 接线（静态锚）：执行器挂类以判定器 iosCover 为唯一开关、全屏态恒不挂；
//      base.css 规则在产物里在位。
// 无头局限：Chrome 的 100vh 恒等于模拟视口高，无法复现 iOS standalone 的「100vh=整块物理屏」，
//   故 S1 以显式 --mochi-ios-h + .phone 高（＝真机实测的两个读数）驱动 flex 居中算式，
//   与真机同一条 CSS 路径；真机最终观感仍需按 FIX-REGRESSION #537 的清单复核。
// 用法：node tools/verify-ios-cover-top.mjs（退出码 0=全过 1=断言失败 2=环境不满足）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const indexHtml = join(root, 'index.html');
try { if (!statSync(indexHtml).isFile()) throw new Error('nf'); } catch (e) {
  console.error('找不到 ' + indexHtml + '——请先 node build.mjs');
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('环境不满足：找不到 Chrome/Edge（可用 CHROME_PATH 指定）'); process.exit(2); }

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

// 用户真机读数（诊断 v3.26.709）：布局视口 894、物理屏 956、顶部安全区 62
const INNER_H = 894, SCREEN_H = 956, ENV_TOP = 62;

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')); }
};

async function runScenario(setupJs) {
  const port = 9700 + Math.floor(Math.random() * 400);
  const proc = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vioc-' + Date.now() + '-' + Math.floor(Math.random() * 1e6)),
    '--remote-debugging-port=' + port, 'about:blank'
  ], { stdio: 'ignore' });
  const kill = () => { try { proc.kill(); } catch (e) {} };
  process.on('exit', kill);
  let ws = null, id = 0; const pend = new Map();
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        break;
      }
    } catch (e) {}
    await sleep(150);
  }
  if (!ws) { kill(); throw new Error('no cdp'); }
  const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evl = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 440, height: INNER_H, deviceScaleFactor: 3, mobile: true });
  await send('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3800);
  const r = await evl(`(() => {
    ${setupJs}
    // 采集：.phone 顶/底、html/body 计算高、状态栏 padding-top、.phone padding-bottom、tabbar 底边
    // （变量名避开 setup 里的 d/ph，避免同一作用域重复声明）
    const cD = document.documentElement, cB = document.body;
    const cPh = document.querySelector('.phone');
    const cSb = document.querySelector('.statusbar');
    const cTb = document.querySelector('.tabbar');
    const cPr = cPh.getBoundingClientRect();
    return {
      phoneTop: Math.round(cPr.top), phoneBottom: Math.round(cPr.bottom), phoneH: Math.round(cPr.height),
      htmlH: Math.round(parseFloat(getComputedStyle(cD).height) || 0),
      bodyH: Math.round(parseFloat(getComputedStyle(cB).height) || 0),
      bodyAlign: getComputedStyle(cB).alignItems,
      sbPadTop: cSb ? getComputedStyle(cSb).paddingTop : null,
      phonePadBottom: getComputedStyle(cPh).paddingBottom,
      tabBottom: cTb ? Math.round(cTb.getBoundingClientRect().bottom) : null,
      innerH: window.innerHeight,
      cls: cD.className
    };
  })()`);
  kill();
  return r;
}

// ===== S1 覆盖形态几何（用户报障现场）=====
console.log('[S1] 覆盖形态：.phone 整屏 + 容器同高顶对齐（修「整页上移/底部白条」）');
{
  const r = await runScenario(`
    const d = document.documentElement;
    d.classList.add('ios-pwa-standalone','ios-vv-fit','ios-cover-top');
    d.style.setProperty('--mochi-safe-top', '${ENV_TOP}px');
    d.style.setProperty('--mochi-ios-h', '${SCREEN_H}px');
    // 真机 100vh=整块物理屏（956）；无头 Chrome 的 100vh=模拟视口高，故按真机读数把
    // .phone 高度显式钉到 956——flex 居中算式与真机完全同源
    const ph = document.querySelector('.phone'); ph.style.height = '${SCREEN_H}px';
  `);
  check('S1 .phone 顶位=0（不再被 flex 居中上移 31px）', r.phoneTop === 0, 'top=' + r.phoneTop);
  check('S1 .phone 底边=956（铺满整块物理屏，无 31px 白条）', r.phoneBottom === SCREEN_H, 'bottom=' + r.phoneBottom);
  check('S1 html/body 与 .phone 同高（容器不矮于子元素）', r.htmlH === SCREEN_H && r.bodyH === SCREEN_H, 'html=' + r.htmlH + ' body=' + r.bodyH);
  check('S1 收起居中（align-items:flex-start）', r.bodyAlign === 'flex-start', 'align=' + r.bodyAlign);
  check('S1 tabbar 贴 .phone 底边（底部栏不再悬空）', r.tabBottom === SCREEN_H, 'tab=' + r.tabBottom + ' phone底=' + r.phoneBottom);
  // S1b 现场还原：回到修前几何（容器 100dvh=894 + 居中）→ 必须复现「顶 −31 / 底 925」
  const rRed = await runScenario(`
    const d = document.documentElement;
    d.classList.add('ios-pwa-standalone','ios-vv-fit');
    d.style.setProperty('--mochi-ios-h', '${SCREEN_H}px');
    const ph = document.querySelector('.phone'); ph.style.height = '${SCREEN_H}px';
    // 还原修前：html/body 高度回 100dvh（=本例可视高 894）、居中
    d.style.height = '100dvh'; document.body.style.height = '100dvh';
    d.style.alignItems = 'center'; document.body.style.alignItems = 'center';
  `);
  check('S1b RED 基线：修前几何复现顶 −31/底 925（断言有鉴别力）',
    rRed.phoneTop === -31 && rRed.phoneBottom === 925, 'top=' + rRed.phoneTop + ' bottom=' + rRed.phoneBottom);
}

// ===== S2 非覆盖形态零回归（保留 18.3 / 已避让 / iPad 数值本来就等于可视高）=====
console.log('[S2] 非覆盖形态零回归（保留/已避让：--mochi-ios-h=可视高）');
{
  const r = await runScenario(`
    const d = document.documentElement;
    d.classList.add('ios-pwa-standalone','ios-vv-fit');
    // 保留(15Pro/18.3)、已避让(16Pro/26.1)、iPad 三形态的 expBase 都=inner，写值=894；
    // 不挂 ios-cover-top（这三个形态避让链各自在位）
    d.style.setProperty('--mochi-ios-h', '${INNER_H}px');
    const ph = document.querySelector('.phone'); ph.style.height = '${INNER_H}px';
  `);
  check('S2 .phone 仍在原位（顶=0/底=可视高）', r.phoneTop === 0 && r.phoneBottom === INNER_H, 'top=' + r.phoneTop + ' bottom=' + r.phoneBottom);
  check('S2 html/body 高度=可视高（与修前 100dvh 等价）', r.htmlH === INNER_H && r.bodyH === INNER_H, 'html=' + r.htmlH + ' body=' + r.bodyH);
  check('S2 未挂 ios-cover-top 时状态栏 padding-top 保持 4px（不误抬）', r.sbPadTop === '4px', 'sb=' + r.sbPadTop);
  check('S2 .phone 底部内边距保持 18px（非覆盖形态观感不变）', r.phonePadBottom === '18px', 'pad=' + r.phonePadBottom);
  check('S2 非覆盖形态 html/body 不被钉高（零回归：修法只作用于 .ios-cover-top）', r.htmlH === INNER_H && r.bodyH === INNER_H, 'html=' + r.htmlH + ' body=' + r.bodyH);
}

// ===== S3/S4 覆盖形态的状态栏抬升 + 底部贴合 =====
console.log('[S3] 覆盖形态：状态栏自身抬升到系统状态栏下方（修「顶部重叠」）');
{
  const r = await runScenario(`
    const d = document.documentElement;
    d.classList.add('ios-pwa-standalone','ios-vv-fit','ios-cover-top');
    d.style.setProperty('--mochi-safe-top', '${ENV_TOP}px');
    d.style.setProperty('--mochi-ios-h', '${SCREEN_H}px');
  `);
  check('S3 状态栏 padding-top=76px（14+62，落在系统状态栏下方）', r.sbPadTop === (14 + ENV_TOP) + 'px', 'sb=' + r.sbPadTop);
  check('S4 .phone 底部内边距=0（tabbar 只留自身 safe-bottom 避让，贴合物理屏底）', r.phonePadBottom === '0px', 'pad=' + r.phonePadBottom);
}

// ===== S5 接线（静态锚，防「名字保留逻辑改坏」与跨机型回归）=====
console.log('[S5] 接线锚点');
{
  const ma = readFileSync(join(root, 'src/js/mobile-adapt.js'), 'utf8');
  const css = readFileSync(join(root, 'src/css/base.css'), 'utf8');
  const built = readFileSync(indexHtml, 'utf8');
  const dj = readFileSync(join(root, 'src/js/device.js'), 'utf8');
  check('S5 判定器给出 iosCover 形态位（非保留/非 iPad/非 force 的 standalone+env[20,160]）',
    /const iosCover = standalone && !forceCover && !resStand && !ipadForm && envTop >= 20 && envTop <= 160;/.test(dj));
  check('S5 执行器按判定器挂/摘 ios-cover-top', /d\.classList\.toggle\('ios-cover-top', _wantIosCover\)/.test(ma));
  check('S5 全屏态恒不挂 ios-cover-top（避免与 .phone padding 双倍避让）',
    /var _wantIosCover = !!_f\.iosCover && !_fsState\(\);/.test(ma));
  check('S5 base.css 有覆盖形态状态栏抬升规则', /html\.ios-cover-top \.phone \.statusbar \{\s*\n\s*padding-top:max\(calc\(14px \+ var\(--mochi-safe-top, 0px\)\), 14px\);/.test(css));
  check('S5 base.css 有 .phone 底部内边距归零规则', /html\.ios-cover-top \.phone \{ padding-bottom:0; \}/.test(css));
  check('S5 base.css 独立应用 html/body 钉高+顶对齐（#537 主修复，作用域收在 .ios-cover-top）',
    /html\.ios-pwa-standalone\.ios-cover-top,\s*\nhtml\.ios-pwa-standalone\.ios-cover-top body \{ height:var\(--mochi-ios-h, 100dvh\); min-height:0; align-items:flex-start; \}/.test(css));
  check('S5 产物已接入（ios-cover-top 类名 + 同高顶对齐规则都在 index.html）',
    built.indexOf('ios-cover-top') >= 0 && /align-items:flex-start; \}/.test(built));
  check('S5 诊断③覆盖形态改用有效顶位（iosCover 与浏览器壳同口径，修好不再恒红）',
    /const sbEffTop = \(Fm\.coverBrowser \|\| Fm\.iosCover\) \? inp\.sbTop \+ \(parseFloat\(inp\.sbPadTop\) \|\| 0\) : inp\.sbTop;/.test(dj));
}

// ===== S6 诊断判定端到端（用户那 18 条红点＝监视自动采集刷的错误环；修好应全绿）=====
console.log('[S6] 诊断判定端到端（用户报障信号 → ✗ 消除）');
{
  const dj = readFileSync(join(root, 'src/js/device.js'), 'utf8');
  const cm = dj.match(/window\.mochiViewportForm = function \(sig\) \{[\s\S]*?\n\};/);
  const jm = dj.match(/function screenDiagJudge\(inp\) \{[\s\S]*?\n  \}/);
  check('S6 判定器/判定文本可提取', !!cm && !!jm);
  if (cm && jm) {
    const judge = new Function(`'use strict';${cm[0].replace('window.mochiViewportForm = ', 'return ')}`)();
    const body = jm[0].replace(/^function screenDiagJudge\(inp\) \{/, '').replace(/\n  \}$/, '');
    const run = (inp) => Function('inp', 'window', `'use strict'; ${body}`)(inp, { mochiViewportForm: judge });
    // 用户诊断原文（v3.26.709）：env 62 / inner 894 / screen 956 / sb 0 / tab 873 / phone 底 925
    const base = { scale: 1, envTop: ENV_TOP, varTop: ENV_TOP, diff: ENV_TOP, standalone: true,
      innerH: INNER_H, screenH: SCREEN_H, vvH: INNER_H, innerW: 440, phoneW: 440,
      envBottom: 34, fsActive: false, kb: null, kbAnd: null, phoneInlineH: '', phoneAlignSelf: '',
      isMobileDev: true, iosMajor: 18, safMajor: 26 };
    // 报障现场（修前）：.phone 被 flex 居中上移 31 → 底 925、tab 873、状态栏 padding 仍 4px
    let F = run({ ...base, phoneBottom: 925, tabBottom: 873, sbTop: 0, sbPadTop: '4px', htmlClass: '' });
    check('S6 报障现场复现 ✗底部少填 31px（RED 基线，与用户报告一致）',
      F.some(f => !f.ok && f.name === '底部少填 31px 白带'));
    check('S6 报障现场复现 ✗顶部重叠（RED 基线，sb 顶位 0 应 ≥62）',
      F.some(f => !f.ok && f.name === '顶部重叠'));
    // 修复后稳态：容器顶对齐 → .phone 底 956；状态栏被 ios-cover-top 抬到 14+62；tabbar 贴底 922
    F = run({ ...base, phoneBottom: SCREEN_H, tabBottom: SCREEN_H - 34, sbTop: 0, sbPadTop: '76px',
      htmlClass: 'ios-pwa-standalone ios-vv-fit ios-cover-top' });
    check('S6 修复后稳态全绿（用户那批 ✗ 不再产生，错误环不再被自动采集刷）',
      !F.some(f => !f.ok), F.some(f => !f.ok) ? '首个红项: ' + F.find(f => !f.ok).name : '');
    check('S6 修复后形态文案标注「独立应用覆盖（#537）」（现场可对号）',
      F.some(f => f.name.indexOf('独立应用覆盖（#537') > 0));
  }
}

console.log('\n=====');
console.log('结果：' + pass + ' 通过 ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
