// ===== 回归：通话结束后的「余波」两修（#705 墓碑清标记 + 结束重写来电冷却戳） =====
// 用户直派（vivo X200S Edge，多机型）：「接通电话后联系人还会再打电话。」
// 根因（两处，均与当日已部署批叠加）：
//   ① #698 给 recoverCall 加了 IDB 兜底回读，但 clearCallActive 的 SS/LS 清理用 removeItem、
//      IDB 墓碑是异步——挂断后页面在墓碑落地前被杀/刷新（vivo/Edge 杀渲染进程常态），
//      下次启动 SS/LS 全空 → 落进 IDB 回读 → 幽灵通话复活（凭空「正在通话」/幽灵中断记录）。
//      修复后 SS/LS 同步写 {ts:0} 墓碑：recoverCall 读到无 connectedTime 即清除返回，不再
//      落 IDB；且 idbRestore 回填「LS 已有键以 LS 为准」，墓碑压得住 IDB 旧快照。
//   ② 来电冷却戳 records-call-last 只在「联系人来电触发」时写：去电从不写、来电从触发起算
//      5 分钟——后台来电（#161 响铃挂起）等用户回来才接，接完时冷却已所剩无几＝接完/打完
//      电话 1~3 分钟后联系人又打来。修复=任何一通电话结束（endCall）都重写冷却戳。
// 用例：
//   T1 来电→接听→挂断：接通状态真实走通，挂断后 call-active={"ts":0} 墓碑（非缺失）且
//      records-call-last 刷新（RED 判别点：修复前墓碑断言红＝removeItem 留下的是缺失）
//   T2 墓碑压住 IDB 残留快照：LS=墓碑 + IDB=通话中快照 → 重载不恢复幽灵通话
//   T3 真中断恢复不误伤（#120）：LS/SS=真实通话中快照 → 重载恢复 connected
//   T4 去电（placeCall）结束后冷却戳同样刷新（修复前去电从不写＝打完马上能再来电）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.VERIFY_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => { try { let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0]))); if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; } if (statSync(p).isDirectory()) p = join(p, 'index.html'); res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); } catch (e) { res.writeHead(404); res.end('nf'); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const port = 11700 + Math.floor(Math.random() * 200);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vcrf-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 80; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 300); return r && r.result ? r.result.value : null; };

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    try { localStorage.setItem('xy-home-v2:applock-qaskip', '1'); } catch (e) {}
  `
});
const results = []; const t = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? '  ← ' + detail : '')); };
const nav = async () => {
  await cdp('Page.navigate', { url: base + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 60; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(800);
};
await nav();

// T1 来电→接听→挂断：墓碑 + 冷却戳
await ev('window.triggerIncomingCall && window.triggerIncomingCall()');
await sleep(600);
const st1 = JSON.parse(await ev('JSON.stringify(window.getCallState && window.getCallState())'));
t('T1a 来电响铃中（status=ringing）', st1 && st1.status === 'ringing', 'state=' + JSON.stringify(st1));
await ev("document.getElementById('call-answer-btn') && document.getElementById('call-answer-btn').click()");
await sleep(500);
const st2 = JSON.parse(await ev('JSON.stringify(window.getCallState && window.getCallState())'));
t('T1b 接听接通（status=connected）', st2 && st2.status === 'connected', 'state=' + JSON.stringify(st2));
await ev('window.hangupCall && window.hangupCall()');
await sleep(600);
const tomb = await ev("localStorage.getItem('xy-home-v2:call-active')");
t('T1c 挂断后 call-active={\"ts\":0} 墓碑（修复前=removeItem 缺失）', tomb === '{"ts":0}', 'call-active=' + JSON.stringify(tomb));
const cd1 = parseInt(await ev("localStorage.getItem('xy-home-v2:default:records-call-last')"), 10);
t('T1d 挂断后来电冷却戳已刷新（5s 内）', !isNaN(cd1) && Date.now() - cd1 < 5000, 'records-call-last=' + cd1);
const errs1 = await ev('(window.__jsErrors&&window.__jsErrors.length)||0');
t('T1e 零 JS 异常', errs1 === 0, 'jsErrors=' + errs1);

// T2 墓碑压住 IDB 残留：LS=墓碑 + IDB=通话中快照 → 重载不恢复幽灵
const seedIdb = await ev(`(function(){
  return window.idbSet('xy-home-v2:call-active', { cid:'default', direction:'in', status:'connected', startTime: Date.now()-60000, connectedTime: Date.now()-50000, name:'TA', av:'', ts: Date.now()-8000 }).then(function(){ return 'seeded'; });
})()`);
await ev("sessionStorage.setItem('xy-home-v2:call-active', '{\"ts\":0}');");
await nav();
await sleep(1500);
const st3 = JSON.parse(await ev('JSON.stringify(window.getCallState && window.getCallState())'));
t('T2 LS 墓碑 + IDB 残留通话中快照 → 不恢复幽灵通话（seeded=' + seedIdb + '）', st3 === null, 'state=' + JSON.stringify(st3));

// T3 真中断恢复不误伤（#120）：LS/SS=真实通话中快照 → 重载恢复 connected
const fresh = Date.now() - 5000;
const snap = JSON.stringify({ cid: 'default', direction: 'in', status: 'connected', startTime: fresh - 30000, connectedTime: fresh - 20000, name: 'TA', av: '', ts: fresh });
await ev(`try { localStorage.setItem('xy-home-v2:call-active', ${JSON.stringify(snap)}); sessionStorage.setItem('xy-home-v2:call-active', ${JSON.stringify(snap)}); } catch (e) {}`);
await nav();
await sleep(1500);
const st4 = JSON.parse(await ev('JSON.stringify(window.getCallState && window.getCallState())'));
t('T3 真中断（LS/SS 快照在）重载仍恢复 connected', st4 && st4.status === 'connected', 'state=' + JSON.stringify(st4));
await ev('window.hangupCall && window.hangupCall()');
await sleep(400);

// T4 去电结束后冷却戳刷新（修复前 placeCall 从不写冷却戳）
const cdBefore = parseInt(await ev("localStorage.getItem('xy-home-v2:default:records-call-last')"), 10) || 0;
await sleep(1100);
await ev('window.placeCall && window.placeCall()');
await sleep(4200); // 去电结果定时器 1.8~3.3s；无论忙线/拒绝/接通，挂断收尾
await ev('window.hangupCall && window.hangupCall()');
await sleep(600);
const cdAfter = parseInt(await ev("localStorage.getItem('xy-home-v2:default:records-call-last')"), 10);
t('T4 去电挂断后冷却戳刷新（> 挂断前值）', !isNaN(cdAfter) && cdAfter > cdBefore, 'before=' + cdBefore + ' after=' + cdAfter);

try { chrome.kill(); } catch (e) {}
server.close();
const pass = results.filter(r => r.ok).length;
console.log('==== verify-call-repeat-fixes: ' + pass + '/' + results.length + ' ====');
process.exit(pass === results.length ? 0 : 1);
