// ===== #1501 二级密码不再弹窗：进入应用强制提醒整段摘除（行为断言）=====
// 作者口径（2026-09-30）「2级密码不要弹窗啊，就放在开屏爱点不点」。
// 契约：① clock.js 无强制提醒任何残留（函数/挂载/测试钩/长文案）；② 模拟进入应用（开屏 hide＋
//   数据就绪）后静置数秒不弹任何 modal（#modal-mask 保持隐藏）；③ 开屏锁卡仍是可点入口
//   （点「输入密码解锁」照常弹二级验证弹窗、输 990815 解锁）。
// 用法：node build.mjs && node tools/verify-1501-splash-only-cardlock.mjs（需本机 Chrome/Edge）
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
console.log('[verify-1501] 被测根目录: ' + root);
let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  ⤜' + detail : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srcClock = readFileSync(join(root, 'src/js/clock.js'), 'utf8');
const prodClock = (() => { try { return readFileSync(join(root, 'js/clock.js'), 'utf8'); } catch { return ''; } })();
check('S1 源 clock 无强制提醒任何残留', srcClock.indexOf('maybeCardLockReminder') === -1 && srcClock.indexOf('CARD_LOCK_REMIND') === -1 && srcClock.indexOf('__cardLockTest') === -1);
check('S2 产物 js/clock.js 同步', prodClock.indexOf('maybeCardLockReminder') === -1 && prodClock.indexOf('CARD_LOCK_REMIND') === -1);
check('S3 开屏解锁流程仍在（promptCardUnlock＋锁卡渲染未受牵连）', srcClock.includes('function promptCardUnlock') && srcClock.includes('function setupCardLockCard'));

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
const cdpPort = 9810 + Math.floor(Math.random() * 40);
const chrome = spawn(exe, ['--headless=new','--disable-gpu','--no-first-run','--user-data-dir='+join(process.env.TEMP||'/tmp','mochi-1501-'+Date.now()),'--remote-debugging-port='+cdpPort,'about:blank'], { stdio: 'ignore' });
let ws=null, msgId=0; const pend=new Map();
async function cdpConnect() {
  for (let i=0;i<60;i++){ try {
    const list = await (await fetch('http://127.0.0.1:'+cdpPort+'/json')).json();
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
  // 夹具：种 storage-guide 已读＋备份提醒当日戳（两个常驻弹窗不抢 #modal-mask，见 #1497 尺注）
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('xy-home-v2:storage-guide-shown','1250');localStorage.setItem('xy-home-v2:__last-backup-remind',String(Date.now()));}catch(e){}" });
  await goto(baseUrl + '/');
  check('B0a 组件就位', await waitCardLock());
  await sleep(2000);
  // 模拟进入应用：开屏 hide（finishEnter 之后锁卡不可见的状态）
  await ev("(function(){var s=document.getElementById('splash');if(s)s.classList.add('hide');window.__mochiDataReady=true;})()");
  await sleep(3500);
  const m1 = await ev("(function(){var m=document.getElementById('modal-mask');var st=document.getElementById('modal-static');return JSON.stringify({hidden:!m||m.hidden,txt:(st&&st.textContent||'').slice(0,24)});})()");
  check('B1 进入应用静置 3.5s：零弹窗（强制提醒已摘除）', await ev("(function(){var m=document.getElementById('modal-mask');return !m||m.hidden;})()") === true, m1);
  check('B2 强制提醒函数未挂载', await ev('typeof window.maybeCardLockReminder') === 'undefined');
  // B3 开屏锁卡仍是可点入口：点「输入密码解锁」照常弹二级验证弹窗
  await ev("(function(){var s=document.getElementById('splash');if(s)s.classList.remove('hide');})()");
  await ev("(function(){var b=document.querySelector('#splash-cardlock-actions .cardlock-btn');if(b)b.click();return true;})()");
  await sleep(700);
  check('B3 锁卡点「输入密码解锁」照常弹二级验证弹窗', await ev("(function(){var m=document.getElementById('modal-mask'),s=document.getElementById('modal-static');return !!m&&!m.hidden&&!!s&&!s.hidden&&s.textContent.indexOf('密码一共 6 位数字')>-1;})()") === true, String(await ev("(function(){var s=document.getElementById('modal-static');return s?s.textContent.slice(0,30):'';})()")));
  // B4 输 990815 解锁成功（同码）
  await ev("(function(){var i=document.getElementById('modal-input');if(i)i.value='990815';var b=document.getElementById('modal-ok');if(b)b.click();return true;})()");
  await sleep(900);
  check('B4 输 990815 解锁成功（会话闸放行）', await ev('window.cardLockOpen()') === true);
  const errs = await ev("(window.__jsErrors||[]).length") || 0;
  check('Z 启动零未捕获异常（实测 ' + errs + ' 条）', errs === 0);
} catch (e) {
  check('行为段执行完整（异常: ' + e.message + '）', false);
} finally {
  try { chrome.kill(); } catch {}
  try { server.close(); } catch {}
}
console.log('verify-1501: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
