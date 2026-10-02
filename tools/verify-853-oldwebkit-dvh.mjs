// ===== #853 行为验证：老 WebKit（iOS<15.4，如 iPad7 的 Safari 15.3）高度链不得塌成 auto =====
// 背景：WebKit<15.4 对不认识的 dvh/svh 单位不是 Chromium 那种「解析期丢弃＝退回上一条 vh」，
// 而是把声明留到计算期失败＝整个 height 属性作废成 auto。于是 .phone 变成内容自然高：内容 короткое
// 时底部栏悬空、长内容时被撑到视口外（诊断实况 phone=794/1319/2254、文档可滚 600+px），
// 表现＝顶部/底部按钮轮流点不到、聊天下滑到底整页被拽回顶。修法＝dvh/svh 尾声明一律收进
// @supports (height: 100dvh)（老内核根本看不到），并留 vh 基线。
//
// 本脚本在 Chromium 里**模拟老 WebKit 语义**（这是唯一能在无头环境复现该机型缺陷的办法）：
//   ① 条件含 dvh/svh/lvh 的 @supports 块整块跳过（老内核条件为假）；
//   ② 其余声明块里「胜出」的声明若含 dvh/svh/lvh，改写成无兜底的未定义 var —— 计算期失效，
//      等价于老 WebKit 的「属性作废」（CSSStyleDeclaration 对同属性重复声明只留最后一条，
//      与老内核「胜出声明说了算」同语义）。
// 断言：模拟态下 .phone 高度恒等于视口高、文档不可滚；再往页面塞 1600px 长内容复检一次
//      （正是用户快照 phone=2254 那一态）。
// 用法：node tools/verify-853-oldwebkit-dvh.mjs [被测根目录，默认仓库根]
// 需要 Node 21+（内置 fetch / WebSocket）与本机 Chrome/Edge（CHROME_PATH 可指定）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize((process.argv[2] || (dirname(fileURLToPath(import.meta.url)) + '/..')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
  .find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' }[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const cdpPort = 9600 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-853v-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
await sleep(1500);
const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json();
const target = list.find((t) => t.type === 'page' && !/^chrome/.test(t.url)) || list.find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pend = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const cb = pend.get(m.id); pend.delete(m.id); cb(m); } });
const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalIn = async (expr) => {
  const res = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (res.result && res.result.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(res.result.exceptionDetails).slice(0, 300));
  return res.result && res.result.result ? res.result.result.value : undefined;
};

// 老 WebKit 语义模拟器
const OLDWEBKIT = `(() => {
  let ruled = 0, rew = 0;
  function fix(rule) {
    if (rule.cssRules && rule.cssRules.length) {
      for (let i = rule.cssRules.length - 1; i >= 0; i--) {
        const r = rule.cssRules[i];
        if (r.conditionText && /(dvh|svh|lvh)/.test(r.conditionText)) { rule.deleteRule(i); continue; }
        fix(r);
      }
    }
    if (rule.style && rule.style.length) {
      const props = [];
      for (let i = 0; i < rule.style.length; i++) props.push(rule.style[i]);
      for (const p of props) {
        const v = rule.style.getPropertyValue(p);
        if (/(dvh|svh|lvh)/.test(v)) { try { rule.style.setProperty(p, 'var(--__undef853)', rule.style.getPropertyPriority(p)); rew++; } catch (e) {} }
      }
    }
    ruled++;
  }
  for (const sh of document.styleSheets) { try { fix(sh) } catch (e) {} }
  return { ruled: ruled, rew: rew };
})()`;

const MEASURE = `(() => {
  const ph = document.querySelector('.phone'), tb = document.querySelector('.tabbar');
  return {
    phoneH: Math.round(parseFloat(getComputedStyle(ph).height)),
    varIosH: document.documentElement.style.getPropertyValue('--mochi-ios-h'),
    tabBottom: tb && !tb.hidden ? Math.round(tb.getBoundingClientRect().bottom) : null,
    scrollMax: Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
  };
})()`;
const TALL = "(() => { const d = document.createElement('div'); d.id = '__tall853'; d.style.height = '1600px'; document.getElementById('page-phone').appendChild(d); return 1; })()";

const results = [];
let fail = 0;
function ok(name, cond, detail) {
  results.push((cond ? 'PASS  ' : 'FAIL  ') + name + '  [' + detail + ']');
  if (!cond) fail++;
}

for (const [w, h, tablet, label] of [[810, 972, true, 'iPad竖屏 810x972'], [810, 1080, true, 'iPad满屏 810x1080'], [390, 844, false, 'iPhone 390x844']]) {
  await cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await cmd('Page.navigate', { url: base + '/index.html' });
  await sleep(2600);
  if (tablet) { await evalIn("document.documentElement.classList.add('tablet')"); await sleep(600); }
  const native = await evalIn(MEASURE);
  const emuInfo = await evalIn(OLDWEBKIT);
  await sleep(700);
  const emu = await evalIn(MEASURE);
  ok(label + '（老 WebKit 模拟）'.slice(0, 200) + ' .phone 定高贴合视口', Math.abs(emu.phoneH - h) <= 2 && emu.scrollMax === 0,
    'phoneH=' + emu.phoneH + ' 视口=' + h + ' 可滚=' + emu.scrollMax);
  await evalIn(TALL);
  await sleep(600);
  const tall = await evalIn(MEASURE);
  ok(label + ' 长内容 +1600px 仍定高/不可滚', Math.abs(tall.phoneH - h) <= 2 && tall.scrollMax === 0,
    'phoneH=' + tall.phoneH + ' 可滚=' + tall.scrollMax);
  ok(label + ' 底部导航栏在视口内', tall.tabBottom == null || tall.tabBottom <= h + 2, 'tabBottom=' + tall.tabBottom);
  ok(label + ' 底部导航栏未悬空过高', tall.tabBottom == null || tall.tabBottom >= h - Math.round(h * 0.15), 'tabBottom=' + tall.tabBottom);
  await evalIn("(() => { const t = document.getElementById('__tall853'); if (t) t.remove(); return 1; })()");
  if (label === 'iPad竖屏 810x972') {
    ok('模拟器确实改写了老内核可见的 dvh 声明（防假绿）', emuInfo && emuInfo.rew > 0, '改写 ' + (emuInfo && emuInfo.rew) + ' 条');
    ok('现代引擎原生态仍贴合视口（未被本批改坏）', Math.abs(native.phoneH - h) <= 2, 'phoneH=' + native.phoneH);
  }
}

console.log(results.join('\n'));
console.log('\n#853 老 WebKit 高度链：' + (fail ? '❌ ' + fail + ' 条不合格' : '✅ 全部通过（' + results.length + ' 条）'));
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);
