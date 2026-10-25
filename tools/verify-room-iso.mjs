// ===== 房间（等距 2.5D）浏览器冒烟：数据内核 + 相机 + 装修事务 + 墙面拖动 =====
// 用法：node tools/verify-room-iso.mjs（需先 node build.mjs；使用本机 Chrome/Edge，无需 playwright）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 150));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-room-iso-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
for (let i = 0; i < 80; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const tab = list.find((t) => t.type === 'page');
    if (tab) {
      ws = new WebSocket(tab.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
      };
      break;
    }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function js(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    console.error('  JS异常: ' + (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || '').split('\n')[0]);
    return null;
  }
  return r.result && r.result.result ? r.result.result.value : null;
}
const results = [];
function check(desc, ok, detail) { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3600);

check('数据内核已加载', await js('!!window.RoomCore'));
check('新版房间已接管', await js('window.__roomIso === 1'));
await js("window.openRoom && window.openRoom(); 'x'");
await sleep(900);
check('房间页已打开', (await js("document.getElementById('page-room').hidden")) === false);
check('初始家具 7 件（含墙面件）', (await js('window.__room.state().fx.length')) === 7);
check('地板家具 4 件已渲染', (await js("document.querySelectorAll('#rv-furn .rv-furn').length")) === 4);
check('TA 已渲染', !!(await js("document.querySelector('#ta svg')")));
check('HUD 显示等级/点数', /Lv\.1/.test(await js("document.querySelector('#hud .rv-statbar')?.textContent || ''")));
check('存档 schema=6', (await js('window.__room.state().schema')) === 6);

// 相机：手动缩放后 render 不再跳回默认
await js("window.__room.cam.user=true; window.__room.cam.ratio=2; window.__room.fit(true); 'x'");
const cam0 = await js("JSON.stringify(window.__room.cam)");
await js("window.__room.render(); 'x'");
const cam1 = await js("JSON.stringify(window.__room.cam)");
check('render 不重置相机', cam0 === cam1, cam0 + ' → ' + cam1);

// 数据落盘 + 重新载入
await js("(function(){const fx=window.__room.fx(); fx[0].x=1; fx[0].y=1; window.__room.save(); return true})()");
const reloaded = await js("(function(){const raw=window.storeFor(window.__activeCid||'default').get('room-data'); window.closeRoom(); window.openRoom(); return [JSON.parse(raw).fx[0].x, window.__room.state().fx[0].x]})()");
check('save / reload 落在同一份数据', JSON.stringify(reloaded) === '[1,1]', JSON.stringify(reloaded));

// 墙面件不占地板格
check('墙面件不占地板格', (await js("(function(){const d=window.__room.state();const w=d.fx.find(x=>x.t==='win_rect');const c=window.RoomCore.itemAt(d.fx,w.x,w.y,t=>/^win_|^door$|^painting$|^mirror$/.test(t));return c?c.t:null})()")) === null);

// 装修事务：改色 → 取消回滚 → 再改 → 保存落盘
const clickWall = "(function(){const sc=document.getElementById('scene');const r=sc.getBoundingClientRect();const c=window.__room.cam.s||1;const sp=window.__room.wallPoint('L',2,60);const ev=new MouseEvent('click',{bubbles:true,clientX:r.left+sp[0]*c,clientY:r.top+sp[1]*c});document.getElementById('static').dispatchEvent(ev);return window.__room.decoState()&&window.__room.decoState().wall})()";
const swatch = "(function(){const b=document.querySelectorAll('#decoBar .rv-dsw[data-col]')[1];if(!b)return false;b.click();return true})()";
const wall0 = await js("window.__room.state().walls.L.c");
await js("window.__room.deco(); 'x'");
check('进入装修并选中左墙', (await js(clickWall)) === 'L');
check('点色板可改色', await js(swatch));
const wall1 = await js("window.__room.state().walls.L.c");
await js("window.__room.deco(); 'x'");
const wall2 = await js("window.__room.state().walls.L.c");
check('取消装修回滚墙色', wall1 !== wall0 && wall2 === wall0, wall0 + ' / ' + wall1 + ' / ' + wall2);
await js("window.__room.deco(); 'x'"); await js(clickWall); await js(swatch);
const wall3 = await js("window.__room.state().walls.L.c");
await js("document.getElementById('dSave').click(); 'x'");
const stored = await js("(function(){try{return JSON.parse(window.storeFor(window.__activeCid||'default').get('room-data')).walls.L.c}catch(e){return 'ERR'}})()");
check('保存装修后落盘', wall3 !== wall0 && stored === wall3, wall3 + ' / ' + stored);

// 墙面拖动：旧代码 wdraj 拼写错误会在这里抛异常 & 位置不变
const wd0 = await js("JSON.stringify(window.__room.state().fx.filter(f=>/^win_/.test(f.t)))");
const pt = await js("(function(){const g=document.querySelector('#static [data-wi]');if(!g)return null;const r=g.getBoundingClientRect();const c=window.__room.cam.s||1;const x=r.left+r.width/2,y=r.top+r.height/2;g.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:7,clientX:x,clientY:y}));return [x,y,c]})()");
await sleep(420);
await js("(function(){const d=" + JSON.stringify(pt) + ";window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:7,clientX:d[0]+40*d[2],clientY:d[1]}));window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:7,clientX:d[0]+40*d[2],clientY:d[1]}));return true})()");
await sleep(220);
const wd1 = await js("JSON.stringify(window.__room.state().fx.filter(f=>/^win_/.test(f.t)))");
check('墙面件可拖动换位', wd0 !== wd1);

const errors = await js("(window.__jsErrors||[]).join(' | ')");
check('房间无运行时异常', !errors, errors || '');

const bad = results.filter((x) => !x).length;
console.log('\n===== verify-room-iso: ' + (results.length - bad) + '/' + results.length + ' passed ===== ' + (bad ? 'FAIL' : 'OK'));
chrome.kill();
server.close();
process.exit(bad ? 1 : 0);
