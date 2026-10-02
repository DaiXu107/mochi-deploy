// ===== 验证 #1473：后台弹窗「收不到」说明里的手机系统勿扰/免打扰那一族 =====
// 用户直派（2026-09-30）：「有人手机收不到后台通知弹窗，是手机开了【免打扰模式】的影响，帮我写进
// 后台弹窗通知的说明里，并帮我检查还有没有其他原因」。网页读不到系统勿扰状态，所以这类机器的形态＝
// 「测试」体检全绿、通知真进了系统队列，屏幕上却什么都没有——旧说明通篇没这条。
// 断言面（跑已构建产物，不是 src 拼装）：设置页「后台通知」功能说明弹窗实读＋行下小字＋使用说明第 10 节
// （声明计数＝实际条目、新增那条以「收不到 ④」起头）＋开屏公告离线兜底末章要点数＋设置搜索「勿扰」命中本行＋零 JS 异常。
// 用法：node tools/verify-1473-notify-dnd-docs.mjs [--root=<已构建副本目录>]（需本机 Chrome/Edge）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = normalize((process.argv.find(a => a.startsWith('--root=')) || '').split('=')[1] || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(normalize(root))) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const chromePath = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean).find(p => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(2); }
const port = 13700 + Math.floor(Math.random() * 90);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(tmpdir(), 'mochi-1473-' + Date.now()), '--remote-debugging-port=' + port], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 80; i++) {
  try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find(t => t.type === 'page');
    if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {}
  await sleep(150);
}
const cdp = (method, params = {}) => new Promise(res => { const i = ++msgId; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 140); return r && r.result ? r.result.value : undefined; };

let pass = 0, fail = 0;
const A = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' | ' + extra : '')); } };

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/' });
await sleep(2600);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
// 开屏公告离线兜底末章（必须在拆罩之前读，splash.remove() 会把节点整棵摘掉）
const splash = await ev(`(()=>{ const wraps=[...document.querySelectorAll('.splash-sec-wrap')]; const w=wraps[wraps.length-1];
  if(!w) return null; const t=w.textContent||''; return { head:(w.querySelector('.splash-sec')||{}).textContent||'', bullets:w.querySelectorAll('.splash-bullet').length, dnd:t.indexOf('勿扰')>=0 }; })()`);
await ev(`(()=>{ const s=document.getElementById('splash'); if(s) s.remove();
  const q=document.getElementById('qa-mask'); if(q) q.hidden=true;
  const g=document.querySelector('.mg-guide-mask'); if(g) g.remove();
  const m=document.getElementById('modal-mask'); if(m) m.hidden=true; })()`);
await sleep(400);
await ev(`(()=>{ document.querySelectorAll('.page').forEach(p=>p.hidden=true); const sp=document.getElementById('page-setting'); if(sp) sp.hidden=false; })()`);
await sleep(300);

const openCapsule = (sel) => ev(`(()=>{ const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return 0;
  const row=el.closest('.set-row, .gs-row'); if(!row) return 0;
  const t=[...row.querySelectorAll('[data-setdesc]')].find(x=>x.getAttribute('data-setdesc')===${JSON.stringify(sel)});
  if(!t) return 0; t.click(); return 1; })()`);
const modalText = () => ev(`(()=>{ const el=document.getElementById('modal-static'); const m=document.getElementById('modal-mask'); return (el && m && !m.hidden) ? el.textContent : ''; })()`);

// R1 设置页「后台通知」功能说明弹窗＝屏上真读得到勿扰那一条，且标签没当字面量显示
await openCapsule('#bg-notify'); await sleep(250);
const mt = String(await modalText());
A('R1 功能说明弹窗含「勿扰 / 免打扰」压制条', mt.indexOf('勿扰') >= 0 && mt.indexOf('通知栏') >= 0, 'len=' + mt.length);
A('R1b 弹窗文本里没有字面 <b> 标签（settings-help 走 textContent）', mt.indexOf('<b>') < 0 && mt.indexOf('</b>') < 0);
A('R1c 弹窗文本没有 undefined／NaN', mt.indexOf('undefined') < 0 && mt.indexOf('NaN') < 0);
await ev(`(()=>{ const m=document.getElementById('modal-mask'); if(m) m.hidden=true; })()`);

// R2 行下小字（不点弹窗也能看见）
const subTxt = await ev(`(()=>{ const e=document.getElementById('bg-notify-sub'); return e ? (e.textContent||'') : ''; })()`);
A('R2 「后台通知」行下小字含勿扰自查一句', String(subTxt).indexOf('勿扰') >= 0 && String(subTxt).indexOf('下拉通知栏') >= 0, 'len=' + String(subTxt).length);

// R3 使用说明第 10 节：实际条数＝声明计数，新增那条在屏上
await ev(`(()=>{ const r=document.getElementById('row-guide'); if(r) r.click(); return 1; })()`); await sleep(400);
const g10 = await ev(`(()=>{ const g=[...document.querySelectorAll('#page-guide .lic-grp')].find(x=>/后台弹窗/.test((x.querySelector('.lg-name')||{}).textContent||'') && /怎么用/.test((x.querySelector('.lg-name')||{}).textContent||''));
  if(!g) return null; const lis=[...g.querySelectorAll('.lic-li')];
  const mine=lis.filter(li=>/勿扰/.test(li.textContent||''));
  const first = mine[0] ? (mine[0].textContent || '') : '';
  return { declared:Number((g.querySelector('.lg-count')||{}).textContent||0), items:lis.length,
    mineN:mine.length, mineHead:mine[0]?mine[0].textContent.replace(/\\s+/g,' ').trim().slice(0,60):'',
    mineHasSelfCheck: first.indexOf('下拉通知栏')>=0,
    tagLeak:lis.some(li=>/<b>|<\\/b>/.test(li.textContent||'')), night:(lis.find(li=>/后半夜/.test(li.textContent||''))||{}).textContent||'' }; })()`);
A('R3 第 10 节声明计数＝实际条目数（16）', !!g10 && g10.declared === g10.items && g10.items === 16, JSON.stringify(g10 && { d: g10.declared, i: g10.items }));
A('R3b 第 10 节有且只有 1 条讲系统勿扰', !!g10 && g10.mineN === 1, g10 && g10.mineHead);
A('R3c 该条以「收不到 ④」起头且给出一步自查', !!g10 && /收不到 ④/.test(g10.mineHead) && g10.mineHasSelfCheck === true, g10 && g10.mineHead);
A('R3d 渲染文本无字面标签', !!g10 && !g10.tagLeak);
A('R3e 「收不到 ②」补上了夜间档（后半夜本来没东西可弹）', !!g10 && /后半夜/.test(g10.night) && /夜间免打扰模式|夜间模式/.test(g10.night), String(g10 && g10.night).replace(/\s+/g, ' ').slice(0, 60));

// R4 开屏公告离线兜底末章（断网用户看到的那份；值在拆罩前已取）
A('R4 公告末章离线兜底含勿扰条且要点 7 条', !!splash && /后台通知相关设置/.test(splash.head) && splash.dnd && splash.bullets === 7, JSON.stringify(splash));

// R5 设置搜索「勿扰」应点亮「后台通知」行（新文案可发现性）
await ev(`(()=>{ document.querySelectorAll('.page').forEach(p=>p.hidden=true); const sp=document.getElementById('page-setting'); if(sp) sp.hidden=false; return 1; })()`); await sleep(200);
const searchOk = await ev(`(()=>{ const i=document.getElementById('set-search-input'); if(!i) return 'no-search'; i.value='勿扰'; i.dispatchEvent(new Event('input'));
  const r=document.querySelector('#bg-notify'); const row=r?r.closest('.set-row, .gs-row'):null; return row ? (row.style.display!=='none') : 'no-row'; })()`);
A('R5 设置页搜「勿扰」命中「后台通知」行', searchOk === true, String(searchOk));
await ev(`(()=>{ const i=document.getElementById('set-search-input'); if(i){ i.value=''; i.dispatchEvent(new Event('input')); } return 1; })()`);

A('Z1 全程零 JS 异常', Number(await ev('(window.__jsErrors||[]).length')) === 0, 'jsErrors=' + await ev('JSON.stringify((window.__jsErrors||[]).slice(0,2)).slice(0,160)'));

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n== #1473 后台弹窗勿扰说明·渲染面: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);
