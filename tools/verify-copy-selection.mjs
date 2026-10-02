// ===== verify-copy-selection.mjs：#261 复制残留选区 / 死选区回收 行为断言 =====
// 用法：node build.mjs && node tools/verify-copy-selection.mjs
// 需要：Node 21+（内置 fetch / WebSocket）+ 本机 Chrome/Edge（找不到时用 CHROME_PATH 指定）
//
// 修的是用户报障「桌面的今日情话右边出现了【全选】的黑色按钮，退出重进也没消失」
// （荣耀畅玩40 Plus + 夸克；用户明说其他机型也有 → 与机型无关的通用缺陷）。
// 黑色【全选】不是本项目的 DOM（全站扫过：只有各批量管理条里的 .fb-btn/.ti-batch-btn…
// 且都不在桌面、都随页面 hidden 一起不渲染），它是**浏览器原生的文字选择工具条**，
// 以「文档选区 / 文本控件选区」为宿主。本项目有两处会造出没人收的选区：
//   ① 复制兜底路径（device.js copyText/sdCopy/fCopy）用隐藏 textarea select() 全选后
//      execCommand('copy')，选区原地留着、800ms 后连节点一起 removeChild；
//   ② 桌面 home.css 虽已 user-select:none，但部分内核照样自造选区。
// 选区一旦指向已脱离文档的节点，内核的「结束选择」通知就发不出去，工具条便永久停在
// 屏幕原位（浮层归浏览器所有，切后台/重进都不销毁）。
// ⚠ 实测修正（B3a）：Blink 移除选区宿主时不是留孤儿，而是把选区**重挂到 document.body**
//   且仍然活着。回收器按设计不碰 body 级活选区（碰了就是吃掉用户正当的整页全选 = 新 bug），
//   所以**主防线是复制站点当场塌选区**（device.js mochiKillCopySelection），
//   全局回收器只是兜内核在桌面内自造选区（user-select:none 被某些内核无视）的那一层。
//
// 本脚本能证的：选区有没有被收干净（两半修复都可断言，且带旧路径对照组）。
// 本脚本不能证的：原生工具条本身（浏览器 UI 层，无头环境画不出来）——
//   所以每条「回收」断言都先立「选区确实已建立」的前置，双向咬合，防止白给。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const skipped = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
// 环境观察不到（该内核不把文本控件选区暴露给文档选区）≠ 回归：记 SKIP 但必须打印出来
function skip(desc, detail) {
  skipped.push(desc);
  console.log('SKIP  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}

// ---------- 静态组：源码 / 产物接线（不需要浏览器，先跑，挂了就不用起 Chrome） ----------
const srcDevice = readFileSync(join(root, 'src/js/device.js'), 'utf8');
const srcAdapt = readFileSync(join(root, 'src/js/mobile-adapt.js'), 'utf8');
const built = readFileSync(join(root, 'index.html'), 'utf8');

// 每处 execCommand('copy') 之后必须紧跟收选区调用（漏一处＝那条全选仍会留给延迟移除变孤儿）
// ①注释行不算站点：device.js 的 #261 注释里就写着 execCommand('copy')，算进去会虚增漏站。
// ②允许清单只收 AI-A 的 divination.js copyFallback（跨域未改，已 WORKLOG「需要对方处理」）——
//   它是子集语义：对方将来自己修好 → 该站点变覆盖，照样绿；新增任何别的未覆盖复制站点 → 红。
const ALLOW_UNCOVERED = [/execCommand\((['"])copy\1\s*\)\s*;?\s*toast\(/];   // divination.js copyFallback 一行式
function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}
function copySites(text) {
  const lines = text.split('\n');
  const sites = [];
  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i])) continue;
    if (!/execCommand\((['"])copy\1/.test(lines[i])) continue;
    const near = lines.slice(i, i + 4).join('\n');
    sites.push({
      covered: /mochiKillCopySelection/.test(near),
      allowed: ALLOW_UNCOVERED.some((re) => re.test(lines[i])),
      text: lines[i].trim().slice(0, 56)
    });
  }
  return sites;
}
const srcCover = copySites(srcDevice);
check('S1 src/js/device.js 三处复制站点后都当场收选区（无漏站）',
  srcCover.length === 3 && srcCover.every((s) => s.covered),
  srcCover.filter((s) => s.covered).length + '/' + srcCover.length);
const builtCover = copySites(built);
const badSites = builtCover.filter((s) => !s.covered && !s.allowed);
check('S2 产物 index.html 全站点覆盖（未覆盖者仅限已知跨域站点，新增漏站即红）',
  builtCover.filter((s) => s.covered).length >= 3 && badSites.length === 0,
  'covered=' + builtCover.filter((s) => s.covered).length +
  ' 跨域待处理=' + builtCover.filter((s) => !s.covered && s.allowed).length +
  (badSites.length ? ' 新增漏站=' + badSites.map((s) => s.text).join(' | ') : ''));
check('S3 回收器判定范围未放宽（活选区只在「非编辑区 + 桌面内」才收）',
  srcAdapt.includes('if (editable || !desk || !desk.contains(host)) return false;'));
check('S4 回收器事件已接线（pointerdown/touchstart/selectionchange/visibilitychange 四路）',
  ["addEventListener('pointerdown', reapSoon, true)",
   "addEventListener('touchstart', reapSoon, true)",
   "addEventListener('selectionchange', reapSoon)",
   "addEventListener('visibilitychange', reapSoon)"].every((s) => srcAdapt.includes(s)));

// ---------- 起无头 Chrome（390×844 手机视口：viewport<=900 命中 isMobile → mobile-adapt 才生效） ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置环境变量 CHROME_PATH'); process.exit(1); }

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

const cdpPort = 9500 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-copysel-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
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
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('no running browser（无法连接无头浏览器）');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const J = async (expr) => { try { return JSON.parse(await evalJs(expr) || '{}'); } catch (e) { return {}; } };

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
// 开屏公告 / 问答门：无头 UA 命中自动化豁免，这里只需点掉开屏进入桌面
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return 1;})()");
await sleep(900);

const env = await J("(function(){var d=window.mochiDevice||{};return JSON.stringify({desk:!!document.getElementById('page-phone'),mobile:!!d.isMobile,reap:typeof window.__mochiReapSelection,kill:typeof window.mochiKillCopySelection});})()");
check('S5 桌面页已就绪（进的就是报障现场 #page-phone）', env.desk === true);
check('S6 手机端判定已启用（回收器注册在 mobile-adapt 的手机/平板分支内）', env.mobile === true, 'isMobile=' + env.mobile);
check('S7 死选区回收器已接入产物', env.reap === 'function', env.reap);
check('S8 复制收选区器已接入产物', env.kill === 'function', env.kill);

/* ---- 页面侧小工具：在指定父节点里造一段可选文字并选中 ---- */
const SEL_HELPERS = `
var H = {
  mkText: function (parent, id, text) {
    var old = document.getElementById(id); if (old) old.remove();
    var el = document.createElement('span'); el.id = id; el.textContent = text;
    parent.appendChild(el);
    return el;
  },
  selectIn: function (el) {
    var s = window.getSelection(); s.removeAllRanges();
    var r = document.createRange(); r.selectNodeContents(el); s.addRange(r);
    return { count: s.rangeCount, text: String(s.toString()).slice(0, 8) };
  },
  count: function () { var s = window.getSelection(); return s ? s.rangeCount : -1; }
};`;

/* ---- A 组：复制站点（根因①） ---- */
const a1 = await J(`(function(){${SEL_HELPERS}
  var ta = document.createElement('textarea');
  ta.value = '复制残留选区回归文本 ABCDEFGHIJ';
  ta.setAttribute('readonly','');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;width:10px;height:10px;opacity:0;';
  document.body.appendChild(ta);
  window.__t = ta;
  ta.select();
  return JSON.stringify({ ctrlSel: ta.selectionEnd - ta.selectionStart, len: ta.value.length, docSel: H.count() });
})()`);
check('A1 前置咬合：select() 后控件选区确实是全文（能造出选区，后面才算数）',
  a1.ctrlSel === a1.len && a1.len > 0, 'ctrlSel=' + a1.ctrlSel + ' len=' + a1.len + ' docSel=' + a1.docSel);
const a2 = await J(`(function(){${SEL_HELPERS}
  var ta = window.__t; if (!ta) return JSON.stringify({err:'no ta'});
  window.mochiKillCopySelection(ta);
  var r = { ctrlSel: ta.selectionEnd - ta.selectionStart, docSel: H.count() };
  ta.remove(); return JSON.stringify(r);
})()`);
check('A2 复制点收选区后：控件选区塌回 0（全选不再留给延迟 removeChild）', a2.ctrlSel === 0, JSON.stringify(a2));
check('A3 复制点收选区后：文档选区为 0', a2.docSel === 0, 'rangeCount=' + a2.docSel);

// 聚焦态才是内核真会画工具条的形态：文档选区必须一并收掉。
// readonly 与产品复制节点一致（且 ceConvert 遇 readOnly 直接跳过，测试节点不会被转成 .ce-box）。
// 只断言「两级选区塌回 0」：无头内核 blur() 不保证改 activeElement，而工具条的宿主是选区不是焦点。
const a4 = await J(`(function(){${SEL_HELPERS}
  var ta = document.createElement('textarea');
  ta.value = '聚焦态全选残留文本 0123456789';
  ta.setAttribute('readonly','');
  ta.style.cssText = 'position:fixed;left:0;top:0;width:120px;height:40px;opacity:0;';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  var before = { docSel: H.count(), ctrlSel: ta.selectionEnd - ta.selectionStart, act: document.activeElement === ta };
  window.mochiKillCopySelection(ta);
  var after = { docSel: H.count(), ctrlSel: ta.selectionEnd - ta.selectionStart, act: document.activeElement === ta };
  ta.blur(); ta.remove();
  return JSON.stringify({ before: before, after: after });
})()`);
if (!(a4.before && a4.before.docSel >= 1)) {
  skip('A4 聚焦全选会暴露成文档选区（该内核未暴露，回收无从谈起）', JSON.stringify(a4.before));
} else {
  check('A4 聚焦态：文档选区与控件选区双双塌回 0（工具条失去宿主）',
    a4.after.docSel === 0 && a4.after.ctrlSel === 0, JSON.stringify(a4));
}

/* ---- B 组：死选区回收器（根因②+ 兜底） ---- */
// B1 桌面内活选区 → 回收
const b1 = await J(`(function(){${SEL_HELPERS}
  var desk = document.getElementById('page-phone');
  var el = H.mkText(desk, '__v-desk', '桌面内被内核自造选区的文字');
  var made = H.selectIn(el);
  var reaped = window.__mochiReapSelection();
  var after = H.count();
  el.remove();
  return JSON.stringify({ made: made, reaped: reaped, after: after });
})()`);
check('B1 桌面内活选区当场被回收（内核无视 user-select:none 的兜底）',
  b1.made && b1.made.count >= 1 && b1.reaped === true && b1.after === 0, JSON.stringify(b1));

// B2 不靠手调：下一次按下即自愈（用户「重进没消掉」的那个当场就消）
const b2 = await J(`(function(){${SEL_HELPERS}
  var desk = document.getElementById('page-phone');
  var el = H.mkText(desk, '__v-desk2', '靠事件自愈的桌面选区');
  var made = H.selectIn(el);
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  var after = H.count();
  el.remove();
  return JSON.stringify({ made: made.count, after: after });
})()`);
check('B2 下一次触摸按下即自动回收（已卡住的用户不必重进）',
  b2.made >= 1 && b2.after === 0, JSON.stringify(b2));

// B3 宿主被移除后的残留选区：这是本 bug 的直接病根，也是「回收器管不到、必须源头收干净」的证据。
// 实测 Blink 行为：移除选区宿主时选区不会变孤儿，而是被**重挂到 document.body**（仍然活着）。
// 回收器按设计不碰 body 级活选区（放宽就会吃掉用户正当的整页全选 = 新 bug），
// 所以这条路径的唯一防线是复制站点当场塌选区——A/B 两组双向咬合把这句话钉死。
const b3a = await J(`(function(){${SEL_HELPERS}
  var el = H.mkText(document.body, '__v-orphan', '会被移除的复制节点残留选区');
  var made = H.selectIn(el);
  el.remove();                                  // 旧代码路径：不塌选区直接移除节点
  var reaped = window.__mochiReapSelection();   // 只作诊断打印，不判定（Blink 会把它重挂到 body）
  return JSON.stringify({ made: made.count, reaped: reaped, after: H.count() });
})()`);
check('B3a 对照（旧路径）：宿主移除后选区依然活着 → 残留机制真实存在，回收器不接管此态',
  b3a.made >= 1 && b3a.after >= 1, JSON.stringify(b3a));
const b3b = await J(`(function(){${SEL_HELPERS}
  var el = H.mkText(document.body, '__v-orphan2', '新路径会先塌选区再移除的节点');
  var made = H.selectIn(el);
  window.mochiKillCopySelection(el);            // 新路径：复制点当场收
  el.remove();
  return JSON.stringify({ made: made.count, after: H.count() });
})()`);
check('B3b 新路径：先收选区再移除节点 → 文档里不留任何活选区（源头收干净才是主防线）',
  b3b.made >= 1 && b3b.after === 0, JSON.stringify(b3b));

// B4 切前台补收（用户试过的「退出重进」路径）
const b4 = await J(`(function(){${SEL_HELPERS}
  var desk = document.getElementById('page-phone');
  var el = H.mkText(desk, '__v-vis', '切回前台时要被收掉的选区');
  var made = H.selectIn(el);
  document.dispatchEvent(new Event('visibilitychange'));
  var after = H.count();
  el.remove();
  return JSON.stringify({ made: made.count, after: after });
})()`);
check('B4 前后台切换（visibilitychange）也补收一次', b4.made >= 1 && b4.after === 0, JSON.stringify(b4));

// B5 三条「不误清」反向断言：修复不得越界（越界就是新 bug，且是机型相关的行为差异）
const b5a = await J(`(function(){${SEL_HELPERS}
  var ci = document.getElementById('chat-input');
  if (!ci) return JSON.stringify({ err: 'no chat-input' });
  ci.textContent = '聊天输入框里正在编辑的一段文字';
  var made = H.selectIn(ci);
  var reaped = window.__mochiReapSelection();
  var after = H.count();
  ci.textContent = '';
  return JSON.stringify({ made: made.count, reaped: reaped, after: after });
})()`);
check('B5a 不误清：聊天输入框（contenteditable）里的选区原样保留',
  b5a.made >= 1 && b5a.reaped === false && b5a.after === b5a.made, JSON.stringify(b5a));

// readonly：ceConvert 遇 readOnly 直接跳过，测的就是原生 textarea 本身
// （否则节点被转成 .ce-box、值搬走，断言量的是另一个东西）
const b5b = await J(`(function(){${SEL_HELPERS}
  var ta = document.createElement('textarea');
  ta.value = '弹窗手动全选复制的退路文本 WXYZ';
  ta.setAttribute('readonly','');
  ta.style.cssText = 'position:fixed;left:0;top:0;width:160px;height:48px;';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  var made = { ctrlSel: ta.selectionEnd - ta.selectionStart, len: ta.value.length, docSel: H.count() };
  var reaped = window.__mochiReapSelection();
  var after = { ctrlSel: ta.selectionEnd - ta.selectionStart, docSel: H.count() };
  ta.blur(); ta.remove();
  return JSON.stringify({ made: made, reaped: reaped, after: after });
})()`);
check('B5b 不误清：原生 textarea 的全选留着（弹窗「手动全选复制」退路不被打断）',
  b5b.made && b5b.made.ctrlSel === b5b.made.len && b5b.made.len > 0 &&
  b5b.reaped === false && b5b.after.ctrlSel === b5b.made.ctrlSel,
  JSON.stringify(b5b));

const b5c = await J(`(function(){${SEL_HELPERS}
  var el = H.mkText(document.body, '__v-outside', '桌面之外的正常可选文字');
  var made = H.selectIn(el);
  var reaped = window.__mochiReapSelection();
  var after = H.count();
  el.remove();
  return JSON.stringify({ made: made.count, reaped: reaped, after: after });
})()`);
check('B5c 不误清：桌面之外、非编辑区的活选区不动（作用域被放宽就该红）',
  b5c.made >= 1 && b5c.reaped === false && b5c.after >= 1, JSON.stringify(b5c));

// B6 无选区时幂等无副作用
const b6 = await J(`(function(){
  var s = window.getSelection(); if (s && s.removeAllRanges) s.removeAllRanges();
  var r1 = window.__mochiReapSelection();
  var threw = false;
  try { window.__mochiReapSelection(); } catch (e) { threw = true; }
  return JSON.stringify({ r1: r1, threw: threw });
})()`);
check('B6 无选区时幂等返回 false 且不抛错', b6.r1 === false && b6.threw === false, JSON.stringify(b6));

/* ---- C 组：既有防线没被我的改动顶掉 ---- */
const d1 = await J(`(function(){
  var el = document.getElementById('love-quote');
  if (!el) return JSON.stringify({ err: 'no love-quote' });
  var cs = getComputedStyle(el);
  var desk = getComputedStyle(document.getElementById('page-phone'));
  return JSON.stringify({ q: cs.userSelect + '/' + cs.webkitUserSelect, desk: desk.userSelect });
})()`);
check('C1 桌面禁选 CSS 仍在（#page-phone 与今日情话正文 user-select:none，v3.14.x 防线未被顶掉）',
  d1.desk === 'none' && /^none/.test(String(d1.q)), JSON.stringify(d1));

// 页面报错采集：任何一条断言把产品跑崩了都要在这里现形
const errs = await evalJs("JSON.stringify((window.__jsErrors||[]).slice(-3))");
check('C2 全程零未捕获 JS 错误（回收器/复制点不改坏任何页面逻辑）',
  !errs || errs === '[]' || errs === 'null', errs);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok);
console.log('\n结果：' + (results.length - fails.length) + '/' + results.length + ' 项通过' +
  (skipped.length ? '，' + skipped.length + ' 项 SKIP（环境观察不到，非回归）' : ''));
fails.forEach((f) => console.log('  ✗ ' + f.desc));
process.exit(fails.length ? 1 : 0);
