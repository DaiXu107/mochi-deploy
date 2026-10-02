// ===== #1497 二级密码还原同码 990815＋每次加载重新上锁（行为断言）=====
// 作者推翻 #1495 分码口径（原话「我一直都是要同一个密码990815，只是说输两次密码」）。
// 契约：① 密码=990815（与问答暗号同串，995180 拒绝）；② 会话闸——解锁态只活本页生命周期，
//   每次加载从锁定开始＝「重新输入解锁」；③ 解锁就地生效不刷新（刷新即回锁死循环已摘）；
//   ④ 全角/夹空白归一化保留；⑤ 同码文案全面还原（「不是同一个」绝迹）。
// 用法：node build.mjs && node tools/verify-1497-session-relock.mjs（需本机 Chrome/Edge）
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
console.log('[verify-1497] 被测根目录: ' + root);
let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  ⤜' + detail : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- S 静态锚 ----------
const srcLock = readFileSync(join(root, 'src/js/card-lock.js'), 'utf8');
const prodLock = (() => { try { return readFileSync(join(root, 'js/card-lock.js'), 'utf8'); } catch { return ''; } })();
const srcClock = readFileSync(join(root, 'src/js/clock.js'), 'utf8');
const prodClock = (() => { try { return readFileSync(join(root, 'js/clock.js'), 'utf8'); } catch { return ''; } })();
const srcApplock = readFileSync(join(root, 'src/js/applock.js'), 'utf8');
const prodApplock = (() => { try { return readFileSync(join(root, 'js/applock.js'), 'utf8'); } catch { return ''; } })();
const prodIndex = readFileSync(join(root, 'index.html'), 'utf8');

check('S1 源 card-lock 同码散列＋持久化闸＋归一化（无 pwver 残留；#1511 起会话闸撤销＝解锁持久化）', srcLock.includes("'4240701628'") && srcLock.includes("stGet() === 'open'") && srcLock.includes("fnv1a('mochi#' + normCode(pw))") && !srcLock.includes('1062906492') && !srcLock.includes('pwverOk') && !srcLock.includes('sessionOpen'));
check('S2 产物 js/card-lock.js 同步（外置件不落库＝线上没这批）', prodLock.includes("'4240701628'") && prodLock.includes("stGet() === 'open'"));
check('S3 clock 解锁就地生效（无刷新死循环）＋同码口径还原（#1501 起提醒面摘除＝是同一个 计 2）', srcClock.includes("okState.textContent = '验证通过'") && !srcClock.includes('验证通过，页面即将刷新') && !srcClock.includes('不是同一个') && (srcClock.match(/是同一个/g) || []).length >= 2);
check('S4 applock 三入口归一化在位＋同码尾句还原', (srcApplock.match(/normCode\(v\) === QA_SKIP_CODE/g) || []).length === 3 && srcApplock.includes('卡的二级验证密码是同一个（同一串 6 位数字）'));
check('S5 index.html 同码还原（旧分码句与 995180 绝迹）', prodIndex.includes('是同一个（同一串 6 位数字') && !prodIndex.includes('不是同一个') && !prodIndex.includes('995180'));

// ---------- 归一化单元验证（从产物源码原样抽取） ----------
try {
  const m = /function normCode\(v\) \{[\s\S]*?\n\}/.exec(prodApplock);
  check('S6 产物 applock normCode 可抽取', !!m);
  if (m) {
    const normCode = new Function('return ' + m[0])();
    check('S6a 全角９９０８１５→990815', normCode('９９０８１５') === '990815');
    check('S6b 夹空白「 99 0815 」→990815', normCode(' 99 0815 ') === '990815');
  }
} catch (e) { check('S6 normCode 抽取执行（异常: ' + e.message + '）', false); }

// ---------- B 行为断言（无头真跑产物） ----------
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>{try{return statSync(p).isFile()}catch(e){return false}});
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0] || '/')));
  if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (statSync(p).isDirectory()) p = join(p, 'index.html');
  try { res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); }
  catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9790 + Math.floor(Math.random() * 40);
const chrome = spawn(exe, ['--headless=new','--disable-gpu','--no-first-run','--user-data-dir='+join(process.env.TEMP||'/tmp','mochi-1497-'+Date.now()),'--remote-debugging-port='+cdpPort,'about:blank'], { stdio: 'ignore' });
let ws=null, msgId=0; const pend=new Map();
async function cdpConnect() {
  for (let i=0;i<60;i++){ try {
    const list = await (await fetch('http://127.0.0.1:'+cdpPort+'/json')).json();
    // 首个 page target 可能是扩展后台页（audio.html）——连错页面＝组件永远不就位；排除扩展页
    const page = list.find(t=>t.type==='page' && !/^chrome-extension/.test(t.url||''));
    if (page){ ws=new WebSocket(page.webSocketDebuggerUrl); await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;}); break; }
  } catch {} await sleep(500);
  }
  if (!ws) throw new Error('no CDP');
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
}
function send(method, params={}) {
  return new Promise((res) => { const id=++msgId; pend.set(id,res); ws.send(JSON.stringify({id,method,params})); });
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : undefined;
}
async function goto(url) { await send('Page.enable'); await send('Page.navigate', { url }); }
async function waitCardLock(timeout=20000) { for (let i=0;i<timeout/300;i++){ if (await ev('!!window.cardLockTryUnlock')) return true; await sleep(300); } return false; }

await cdpConnect();
try {
  // B0 新装/每次加载：从锁定开始（会话闸）
  await goto(baseUrl + '/');
  check('B0a 组件就位', await waitCardLock());
  await sleep(1200);
  check('B0 每次加载＝锁定态（重新输入解锁）', await ev('window.cardLockOpen()') === false);

  // B1/B2 同码解锁、分码旧串拒绝
  check('B1 cardLockTryUnlock(990815)=ok（同码解锁）', await ev("window.cardLockTryUnlock('990815').ok")===true);
  check('B2 解锁后会话闸放行', await ev('window.cardLockOpen()')===true);
  check('B3 995180 拒绝（#1495 分码串不作数）', await ev("window.cardLockTryUnlock('995180').ok")===false);
  check('B4 全角９９０８１５＝输对（全角归一化保留）', await ev("window.cardLockTryUnlock('９９０８１５').ok")===true);
  check('B5 夹空白「99 0815」＝输对（空白归一化保留）', await ev("window.cardLockTryUnlock(' 99 0815 ').ok")===true);
  check('B6 解锁写诊断留痕 state=open', await ev("localStorage.getItem('xy-home-v2:cardlock-state')")==='open');

  // B7 解锁后就地生效不刷新：页面未重载（__mochiBootAt 不变）
  const bootAt1 = await ev('window.__mochiBootAt');
  await sleep(1200);
  const bootAt2 = await ev('window.__mochiBootAt');
  check('B7 解锁后页面未自动刷新（解锁就地生效）', bootAt1 === bootAt2 && await ev('window.cardLockOpen()')===true, 'bootAt ' + bootAt1 + '→' + bootAt2);

  // B8 重载后仍解锁（#1511 持久化：解锁态跨刷新保留＝「已解锁就不要每次重新解锁」）
  await goto(baseUrl + '/');
  check('B8a 组件就位（重载）', await waitCardLock());
  await sleep(1200);
  check('B8 重载后仍解锁（持久化还原）', await ev('window.cardLockOpen()') === true);
  // B9 开屏锁卡已解锁态渲染「重新上锁」入口
  check('B9 开屏锁卡渲染已解锁（重新上锁）', (await ev("(function(){var b=document.querySelector('#splash-cardlock-actions .cardlock-btn');return b?b.textContent:'';})()"))==='重新上锁');

  // Z 零未捕获异常
  const errs = await ev("(window.__jsErrors||[]).length") || 0;
  check('Z 启动零未捕获异常（实测 ' + errs + ' 条）', errs === 0);
} catch (e) {
  check('行为段执行完整（异常: ' + e.message + '）', false);
} finally {
  try { chrome.kill(); } catch {}
  try { server.close(); } catch {}
}
console.log('verify-1497: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
