// ===== 回归验证：#262 表情「内容为空」误报（动图被当坏图，多机型通病）=====
// 背景：iPhone 17 + Safari 反馈「消息提示表情内容为空，去字卡库却无可清理表情包」。根因＝
// #205 用 canvas 采样 alpha 判空，而 canvas 画动画图只画得出第一帧，表情包 GIF 的首帧经常
// 是全透明清屏帧（字卡库 GIF 直存原图保留动画）→ 正常播放的动图被判坏图并引导用户去清理。
// 无头 Chrome 与 WebKit 实测同果＝引擎无关，任何机型只要库里有一张这种动图就中招。
// 用法：node build.mjs && node tools/verify-media-empty.mjs      （BROWSER=webkit 可选，
//       建议双引擎各跑一次：iOS 侧的判定只能靠 WebKit 兜）
// 覆盖：
//   S 纯逻辑门禁（Node 里直接跑 src 抽取的 alphaCheckable）：静态 PNG/GIF 可判；多帧 GIF /
//     APNG / 远程 http / 媒体池令牌 / 超 96KB / 坏头 / 非 base64 一律不判
//   A 无头端到端判空行为：真空白静态图（PNG 与单帧 GIF）仍出占位；透明首帧的 GIF/APNG 保留
//     <img> 且无占位（＝本 bug，修复前这两条必红）；正常图不受影响
//   B 家族不回归：#202 远程图「加载失败」占位、#186 令牌缺池「图片丢失」占位仍然生效
//   C 占位「点此恢复显示」出口：点击后原 <img> 复位且不再复判
// 需要：Node 18+，playwright 已安装（npm i --no-save playwright），且已构建 index.html。
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---- 测试图（全部压到 <1024 字符，避开 #142 媒体池令牌化，走纯 dataURL 路径）----
const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAGklEQVR4nO3QAQ0AAADCoPdP7ewBESgAAD4wCRgAAequ/qQAAAAASUVORK5CYII=';
const BLANK_GIF = 'data:image/gif;base64,R0lGODlhKAAoAIAAAAAAAAAAACH5BAEAAAAALAAAAAAoACgAQAhDAAEIHEiwoMGDCBMqXMiwocOHECNKnEixosWLGDNq3Mixo8ePIEOKHEmypMmTKFOqXMmypcuXMGPKnEmzps2bOAkGBAA7';
const NORMAL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAS0lEQVR4nGNgGOqAEca4o6Hxn5oGq9y4ATabiYHGgGnUggEPIhZCCpSvX8crf1dTE6/8aCQTBKNBNATywV0C6ZwQGI3kERBEQx8AAIIOCFsOwzMNAAAAAElFTkSuQmCC';
// 2 帧 GIF：首帧整幅全透明、次帧才有画面（disposal=2 清屏帧，微信/QQ 表情常见）
const ANIM_GIF_BLANK_FIRST = 'data:image/gif;base64,R0lGODlhIAAgAIEAAAAAAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQJBgAAACwAAAAAIAAgAAAINQABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJUmRAACH5BAkeAAAALAIAAgAcABwAgQCW/wAAAAAAAAAAAAhaAAMIHEgQgMGDBgkqXDgQocODDBk+nAgxokCKGAFYzJhRIseOBT9yDCkSY8OSIwOgHLmypcuXMGPKnEmz5kuVNS/m1CmTZEyFPRfC3NjSIk+RRn1STOrxodGAADs=';
// 同上但容器是 APNG（acTL 在首个 IDAT 之前）
const ANIM_APNG_BLANK_FIRST = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAAgAAAAIAAAAAAAAAAAAAMAMgAAyp/EogAAABpJREFUeJztwQEBAAAAgiD/r25IQAEAAADvBhAgAAEZQzTuAAAAGmZjVEwAAAABAAAAHAAAABwAAAACAAAAAgADAAoAAOg6Z/oAAACUZmRBVAAAAAJ4nO2WQQ6AIAwEbZ+7D+K7GMNB0UpKZIsx7tVkhm01KIs3Kefmc4h4MPJY1CmWYSKnWCmyBkMpsgZLabIbplJlBtveITF6PgEtqTjCG0pIu0Mm7TAwGinb8gu/MFL4buohgciklwYBLVEcEz8LEFtiZ9cNGVLUzOtIR0pxZdk7HCGFzXjRj3Cv2DmVFYsjMJ+7ZSHmAAAAAElFTkSuQmCC';
const MISSING_TOKEN = '@@m:0000000000000000000000000000dead';
let DEAD_URL = 'https://example.invalid/no-here.png'; // S6 用字面量；浏览器组启动后换成本测试服的 404 路径

// ================= S 组：纯逻辑门禁（源码抽取，零浏览器依赖） =================
const chatSrc = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
function extractFn(name) {
  const lines = chatSrc.split('\n');
  const s = lines.findIndex((l) => l.startsWith('function ' + name + '('));
  if (s < 0) return null;
  let depth = 0;
  for (let i = s; i < lines.length; i++) {
    depth += (lines[i].match(/{/g) || []).length - (lines[i].match(/}/g) || []).length;
    if (i > s && depth === 0) return lines.slice(s, i + 1).join('\n');
  }
  return null;
}
const capLine = chatSrc.split('\n').find((l) => l.startsWith('const EMPTY_SNIFF_MAX_B64'));
const gateSrc = extractFn('alphaCheckable');
check('S0 源码里 alphaCheckable / 嗅探阈值仍在（门禁本体没被删）', !!gateSrc && !!capLine);
const alphaCheckable = gateSrc && capLine
  ? new Function(capLine + '\n' + gateSrc + '\nreturn alphaCheckable;')()
  // 门禁整个不存在（＝修复前的源码）：按「无门禁、任何 src 一律送去采样」建模，
  // 让 S4~S12 与 A3/A4 如实报红，而不是抛错把脚本打死在半路拿不到浏览器组结论。
  : () => true;
check('S1 全透明静态 PNG → 允许判空（#205 原场景不失守）', alphaCheckable(BLANK_PNG) === true);
check('S2 单帧全透明 GIF → 允许判空（静态坏图仍能发现）', alphaCheckable(BLANK_GIF) === true);
check('S3 正常静态 PNG → 允许判空（判据本身不偏袒）', alphaCheckable(NORMAL_PNG) === true);
check('S4 【本 bug】首帧透明多帧 GIF → 不判', alphaCheckable(ANIM_GIF_BLANK_FIRST) === false);
check('S5 【本 bug】APNG（acTL）→ 不判', alphaCheckable(ANIM_APNG_BLANK_FIRST) === false);
check('S6 远程 http 图（可能是任意动图/跨域）→ 不判', alphaCheckable(DEAD_URL) === false);
check('S7 媒体池令牌 → 不判（交给 #186/#202 的加载失败路径）', alphaCheckable(MISSING_TOKEN) === false);
check('S8 超 96KB 载荷（大动图）→ 不判且不做 atob', alphaCheckable(BLANK_PNG.slice(0, 22) + 'A'.repeat(200 * 1024)) === false);
check('S9 GIF 头被截断 → 不判', alphaCheckable('data:image/gif;base64,R0lG') === false);
check('S10 非法 base64 → 不判', alphaCheckable('data:image/png;base64,!!!!not base64!!!!') === false);
check('S11 非 base64 dataURL → 不判', alphaCheckable('data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')) === false);
check('S12 缺图化 JPEG（无透明通道）→ 不判', alphaCheckable('data:image/jpeg;base64,' + 'AAAAAAAA'.repeat(20)) === false);

// ================= 浏览器组：真实渲染链路 =================
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (p === root || statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
DEAD_URL = baseUrl + '/no-such-sticker-9x7.png'; // 同源 404＝稳定快失败的「加载失败」样本
check('V0 产物 index.html 存在（先跑 node build.mjs）', existsSync(join(root, 'index.html')));
if (!results[results.length - 1].ok) { server.close(); process.exit(1); }

const engine = process.env.BROWSER || 'chromium';
const { chromium, webkit } = await import('playwright');
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

const MSGS = [
  { side: 'out', text: BLANK_PNG, type: 'sticker', ts: 1 },                 // 0 真空白静态 PNG → 应出占位
  { side: 'out', text: BLANK_GIF, type: 'sticker', ts: 2 },                 // 1 真空白单帧 GIF → 应出占位
  { side: 'in', text: ANIM_GIF_BLANK_FIRST, type: 'sticker', initiative: true, ts: 3 }, // 2 动图（首帧透明）→ 必须保留
  { side: 'in', text: ANIM_APNG_BLANK_FIRST, type: 'sticker', initiative: true, ts: 4 }, // 3 APNG → 必须保留
  { side: 'out', text: NORMAL_PNG, type: 'sticker', ts: 5 },                // 4 正常静态图 → 必须保留
  { side: 'out', text: DEAD_URL, type: 'sticker', ts: 6 },                  // 5 远程不可达 → #202 占位
  { side: 'in', text: MISSING_TOKEN, type: 'sticker', initiative: true, ts: 7 } // 6 令牌缺池 → #186 占位
];

async function toChat() {
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate('!!window.__mochiDataReady')) break;
    await sleep(300);
  }
  await page.evaluate("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(700);
  await page.evaluate("(function(){if(window.enterChat) window.enterChat();document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
  await sleep(2600); // 判空=首采+350ms 复采；#202 失败占位=1.5s
}

await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 25000 });
await toChat();
await page.evaluate(`(async function(){
  const key = window.activePrefix() + ':chat-msgs';
  const raw = JSON.stringify(${JSON.stringify(MSGS)});
  if (window.idbSet) await window.idbSet(key, raw);
  try { localStorage.setItem(key, raw); } catch (e) {}
  return true;
})()`);
await sleep(700);
await page.reload({ waitUntil: 'load', timeout: 25000 });
await toChat();

async function bubble(i) {
  return page.evaluate((n) => {
    const m = document.querySelector('#page-chat .msg[data-idx="' + n + '"]');
    const b = m && m.querySelector('.msg-bubble');
    if (!b) return null;
    return { img: !!b.querySelector('img'), txt: b.textContent.replace(/\s+/g, ' ').slice(0, 90) };
  }, i);
}
const b = [];
for (let i = 0; i < MSGS.length; i++) b.push(await bubble(i));

check('A0 七条表情消息都渲染出气泡', b.every((x) => x !== null), JSON.stringify(b.map((x) => !!x)));
check('A1 真空白静态 PNG → 显示「没有画面」占位', !!b[0] && !b[0].img && b[0].txt.indexOf('没有画面') >= 0, b[0] && b[0].txt);
check('A2 真空白单帧 GIF → 显示「没有画面」占位', !!b[1] && !b[1].img && b[1].txt.indexOf('没有画面') >= 0, b[1] && b[1].txt);
check('A3 【本 bug 核心】首帧全透明的多帧 GIF → <img> 保留且不出占位', !!b[2] && b[2].img && b[2].txt.indexOf('没有画面') < 0, b[2] && b[2].txt);
check('A4 【本 bug 核心】APNG → <img> 保留且不出占位', !!b[3] && b[3].img && b[3].txt.indexOf('没有画面') < 0, b[3] && b[3].txt);
check('A5 正常静态图 → <img> 保留且无任何占位', !!b[4] && b[4].img && b[4].txt.indexOf('画面') < 0, b[4] && b[4].txt);
check('B1 #202 远程图不可达 → 仍显示「加载失败」占位（家族不回归）', !!b[5] && !b[5].img && b[5].txt.indexOf('加载失败') >= 0, b[5] && b[5].txt);
check('B2 #186 令牌缺池 → 仍显示「图片丢失」占位（家族不回归）', !!b[6] && !b[6].img && b[6].txt.indexOf('图片丢失') >= 0, b[6] && b[6].txt);

const c1 = await page.evaluate("(function(){" +
  "var b=document.querySelector('#page-chat .msg[data-idx=\"0\"] .msg-bubble');" +
  "var u=null; b.querySelectorAll('span').forEach(function(s){ if(!u && s.textContent.trim()==='点此恢复显示') u=s; });" +
  "if(!u) return 'no-undo';" +
  "u.click();" +
  "return JSON.stringify({ img: !!b.querySelector('img'), txt: b.textContent.replace(/\\s+/g,' ').slice(0,60) });" +
  "})()");
check('C1 占位「点此恢复显示」→ 原 <img> 复位、占位文案消失', c1 !== 'no-undo' && JSON.parse(c1).img === true && JSON.parse(c1).txt.indexOf('没有画面') < 0, c1);
await sleep(900);
const c2 = await bubble(0);
check('C2 恢复后 350ms 复采窗口过去仍不复判（误判可自服）', !!c2 && c2.img === true, c2 && c2.txt);

await browser.close();
server.close();
const fails = results.filter((r) => !r.ok);
console.log('\n===== 汇总（' + engine + '）：' + (results.length - fails.length) + '/' + results.length + ' 通过 =====');
if (pageErrors.length) console.log('  [pageerror] ' + pageErrors.join(' | ').slice(0, 500));
process.exit(fails.length ? 1 : 0);
