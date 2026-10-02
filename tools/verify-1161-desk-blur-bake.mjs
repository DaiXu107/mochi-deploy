// ===== 常驻回归：#1161 桌面壁纸「背景模糊」滑动时闪失、过几秒才恢复（vivo X200s/Edge 实报，多机型同现）=====
// 用户报障原话：「当我滑动界面时，手机桌面美化里的壁纸里的『背景模糊』会失效，过几秒才恢复」。
// 根因不是浏览器怪癖，是我们自己的机制：#240 把模糊挂成壁纸层常驻全屏 filter:blur(0~20px)，
// #976 为了滑动不掉帧又在滑页期把滤镜摘掉（html.desk-swiping → filter:none）。照片级大纹理
// 每次「摘→恢复」都要整幅重新栅格化，弱机/高 DPR 下数百毫秒到数秒＝用户看到的「闪失几秒」。
// 修法（零机型分支）：blur>0 时把壁纸原图经 canvas 降采样＋轻度模糊「烘焙」成小纹理直接铺
// ——运行时不挂任何 filter，滑动/翻页零重算；烘焙不可用（渐变预设/解码失败）才回旧滤镜路径。
// 断言（红侧＝上一提交产物：壁纸层原图 PNG 直铺＋desk-blur-on 全屏滤镜）：
//  T 组 照片壁纸烘焙路径：
//     T1 图层纹理＝烘焙出的 JPEG 小图（红侧＝原图 PNG）
//     T2 烘焙完成后 .phone 不挂 .desk-blur-on（运行时零滤镜＝本修的立身之本）
//     T3 滑动暂停类（html.desk-swiping）来回去计算 filter 恒为 none（闪失根因消失的直接证据）
//     T4 烘焙宽度≈950/半径（blur10→95±）：证「半径参与烘焙」而不是摆样子
//     T5 壁纸键不被烘焙结果回写污染（phone-bg 仍是 PNG 原图）
//     T6 换半径 20 → 重烘 ≈48 宽（烘焙随半径自适应）
//  F 组 回退不糊弄：坏图判烘焙不可用→旧滤镜必须回来（F1 类在、F2 计算值 blur>0，不是清晰裸图）
//  P 组 渐变预设（无原图可烘）：P1 不产 JPEG、P2 旧滤镜路径保持（blur(8px)）
//  Z1 全程零未捕获 JS 异常
// 用法：node tools/verify-1161-desk-blur-bake.mjs
//       MOCHI_SERVE_ROOT=<产物目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = 'http://127.0.0.1:' + port + '/';

const R = { pass: 0, fail: 0, lines: [] };
const ok = (n, c, d) => { c ? R.pass++ : R.fail++; R.lines.push((c ? '  ✅ ' : '  ❌ ') + n + (d ? ' — ' + d : '')); };

// ---------- S 组：产物源锚 ----------
{
  const pz = (() => { try { return readFileSync(join(root, 'js/personalize.js'), 'utf8'); } catch (e) { return ''; } })();
  ok('S1 烘焙画布在位（白底 jpeg 输出行）', pz.includes("g.fillStyle = '#ffffff'; g.fillRect(0, 0, cw, ch);"));
  ok('S2 applyBgBlur 收进烘焙漏斗', pz.includes('deskBlurPx = px;'));
  ok('S3 图层纹理由烘焙状态裁决', pz.includes('paintBgLayerImage(deskBlurReady() ? deskBlurBaked : deskWallSrc);'));
}

// ---------- 启动 headless ----------
const userDir = join(process.env.TEMP || '/tmp', 'mochi-v1161-' + Date.now());
const args = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + userDir,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=390,844', 'about:blank'];
const cp = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error('DevTools 端口未就绪')), 20000);
  cp.stderr.on('data', (d) => {
    buf += d.toString();
    const m = buf.match(/ws:\/\/[^\s]+/);
    if (m) { clearTimeout(t); resolve(m[0]); }
  });
  cp.on('exit', () => reject(new Error('Chrome 提前退出')));
});
const dbg = wsUrl.replace(/^ws:\/\/([^/]+)\/.*$/, 'http://$1');
const targets = await (await fetch(dbg + '/json/list')).json();
let page = targets.find((t) => t.type === 'page');
if (!page) page = await (await fetch(dbg + '/json/new?about:blank')).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const waits = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waits.has(m.id)) { const w = waits.get(m.id); waits.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params) => new Promise((res, rej) => { const id = ++mid; waits.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params: params || {} })); });
const evalJs = async (expr, awaitPromise) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
  if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');

// 每个新文档装异常采集
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
(function(){ try{
  if (sessionStorage.getItem('__p1161-errors') === null) sessionStorage.setItem('__p1161-errors','[]');
  var errs = JSON.parse(sessionStorage.getItem('__p1161-errors') || '[]');
  window.addEventListener('error', function(ev){ errs.push(String(ev.message||ev.error)); sessionStorage.setItem('__p1161-errors', JSON.stringify(errs.slice(0,5))); });
  window.addEventListener('unhandledrejection', function(ev){ errs.push('rej:'+String(ev.reason)); sessionStorage.setItem('__p1161-errors', JSON.stringify(errs.slice(0,5))); });
}catch(e){} })();
` });

const nav = async (url) => { await send('Page.navigate', { url }); await sleep(2500); };
const dismiss = () => evalJs("(function(){try{var s=document.getElementById('splash');if(s)s.remove();var q=document.getElementById('qa-mask');if(q)q.remove();}catch(e){}return 1})()");

// 场景夹具：写 LS 种子 + 删 IDB 同名镜像键（防 idbRestore 把上一场景的值回填回来串场）
const seedScene = async (js) => {
  await evalJs(`(function(){try{var s=document.getElementById('splash');if(s)s.remove();}catch(e){}})();
    (function(){
      var P='xy-home-v2:default:';
      ['phone-bg','bg-blur','phone-bg-preset','phone-bg-solid'].forEach(function(k){ try{localStorage.removeItem(P+k);}catch(e){} });
      return 1;
    })()`);
  await evalJs(js, true);
  await evalJs("(function(){var P='xy-home-v2:default:';['phone-bg','bg-blur','phone-bg-preset','phone-bg-solid'].forEach(function(k){try{window.idbDelete&&window.idbDelete(P+k)}catch(e){}});return 1})()");
  await sleep(300);
};
const layerState = () => evalJs(`(function(){
  var l=document.getElementById('phone-bg-layer'); if(!l) return {no:1};
  var ph=document.querySelector('.phone');
  var cs=getComputedStyle(l);
  return { cls: !!(ph&&ph.classList.contains('desk-blur-on')),
    filter: String(cs.filter||'') + '|' + String(cs.webkitFilter||''),
    url: String(l.style.backgroundImage||'') };
})()`);
const jpegWidth = async (url) => {
  const m = /data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/.exec(String(url || ''));
  if (!m) return -1;
  return await evalJs('new Promise(function(res){var im=new Image();im.onload=function(){res(im.naturalWidth)};im.onerror=function(){res(-1)};im.src="data:image/jpeg;base64,' + m[1] + '";})', true).catch(() => -1);
};
const waitJpeg = async (ms) => { const t0 = Date.now(); for (;;) { const s = await layerState().catch(() => null); if (s && !s.no && s.url.indexOf('data:image/jpeg') >= 0) return s; if (Date.now() - t0 > ms) return s; await sleep(200); } };

const PNG_WALL = `(function(){
  var c=document.createElement('canvas');c.width=200;c.height=400;var g=c.getContext('2d');
  var gr=g.createLinearGradient(0,0,200,400);gr.addColorStop(0,'#ff6b9d');gr.addColorStop(.5,'#6ba7ff');gr.addColorStop(1,'#222');
  g.fillStyle=gr;g.fillRect(0,0,200,400);
  for(var i=0;i<40;i++){g.fillStyle='rgba(255,255,255,'+((i%7+1)/10)+')';g.fillRect((i*37)%180,(i*53)%380,20,20);}
  localStorage.setItem('xy-home-v2:default:phone-bg', c.toDataURL('image/png'));
  return 1;
})()`;

// ---------- T 组：照片壁纸烘焙（bg-blur=10，预期烘焙宽≈95） ----------
await nav(base); await dismiss(); await sleep(800);
await seedScene(PNG_WALL + ";localStorage.setItem('xy-home-v2:default:bg-blur','10');1");
await nav(base); await dismiss();
let st = await waitJpeg(8000);
ok('T1 图层铺的是烘焙出的 JPEG 小纹理（红侧＝原图 PNG 直铺）', !!(st && !st.no && st.url.indexOf('data:image/jpeg') >= 0), st ? ('前缀 ' + st.url.slice(0, 30) + ' len=' + st.url.length) : '无 #phone-bg-layer');
ok('T2 烘焙完成后不挂 .desk-blur-on（运行时零全屏滤镜）', !!(st && !st.no && st.cls === false), st ? ('cls=' + st.cls + ' filter=' + st.filter) : '-');
{
  const fOf = (s) => String(s && s.filter || '').split('|')[0].trim();
  const isNone = (s) => fOf(s) === 'none';
  const t1 = st;
  await evalJs("document.documentElement.classList.add('desk-swiping');1");
  await sleep(300);
  const pause = await layerState();
  await evalJs("document.documentElement.classList.remove('desk-swiping');1");
  await sleep(600);
  const t2 = await layerState();
  ok('T3 滑动暂停来回去计算 filter 恒为 none（闪失根因消失）', isNone(t1) && isNone(pause) && isNone(t2), '前=' + fOf(t1) + ' 暂停中=' + fOf(pause) + ' 后=' + fOf(t2));
  const w = await jpegWidth((t2 && t2.url) || (st && st.url) || '');
  ok('T4 烘焙宽度≈950/半径（blur10→95±4；证半径参与烘焙）', w > 88 && w < 102, '实测宽 ' + w);
}
{
  const bgv = await evalJs("(function(){var v=localStorage.getItem('xy-home-v2:default:phone-bg')||'';return {pre:v.slice(0,15),len:v.length}})()");
  ok('T5 壁纸键未被烘焙结果回写（仍是 PNG 原图）', String(bgv.pre).indexOf('data:image/pn') === 0, bgv.pre + '… len=' + bgv.len);
}
// 换半径 20 → 重烘（≈48 宽）
await seedScene(PNG_WALL + ";localStorage.setItem('xy-home-v2:default:bg-blur','20');1");
await nav(base); await dismiss();
const st20 = await waitJpeg(8000);
const w20 = await jpegWidth(st20 && st20.url);
ok('T6 改半径 20 → 重烘 ≈48 宽（烘焙随半径自适应）', w20 > 40 && w20 < 56, '实测宽 ' + w20 + (st20 ? '，url前缀 ' + String(st20.url).slice(0, 22) : ''));
// ---------- F 组：解码失败 → 旧滤镜兜底 ----------
await seedScene("localStorage.setItem('xy-home-v2:default:phone-bg','data:image/png;base64,QQ==');localStorage.setItem('xy-home-v2:default:bg-blur','8');1");
await nav(base); await dismiss();
let fb = null;
{
  const t0 = Date.now();
  for (;;) {
    fb = await layerState().catch(() => null);
    if (fb && !fb.no && fb.cls === true && /blur\(/.test(fb.filter)) break;
    if (Date.now() - t0 > 12000) break;
    await sleep(300);
  }
}
ok('F1 坏图判烘焙不可用后 .desk-blur-on 兜底在位（5s 看门狗后滤镜回来）', !!(fb && !fb.no && fb.cls), fb ? ('cls=' + fb.cls + ' filter=' + fb.filter) : '-');
ok('F2 兜底路径计算滤镜 blur>0（不是清晰裸图）', !!(fb && /blur\(\s*[1-9]/.test(String(fb.filter))), fb ? String(fb.filter) : '-');
// ---------- P 组：渐变预设走旧滤镜（无原图可烘） ----------
await seedScene("localStorage.setItem('xy-home-v2:default:phone-bg-preset','暖阳');localStorage.setItem('xy-home-v2:default:bg-blur','8');1");
await nav(base); await dismiss();
await sleep(1600);
{
  const p = await layerState();
  ok('P1 渐变预设：不产 JPEG 烘焙纹理（烘焙不适用路径）', !!(p && !p.no && p.url.indexOf('data:image/jpeg') < 0 && p.url.length > 0), p ? ('url前缀=' + p.url.slice(0, 24)) : '-');
  ok('P2 渐变预设：旧滤镜路径保持（desk-blur-on＋blur(8px)）', !!(p && p.cls && /blur\(8px/.test(String(p.filter))), p ? ('cls=' + p.cls + ' filter=' + p.filter) : '-');
}
// ---------- Z ----------
const errs = await evalJs("JSON.parse(sessionStorage.getItem('__p1161-errors')||'[]')").catch(() => []);
ok('Z1 全程零未捕获 JS 异常', (errs || []).length === 0, JSON.stringify(errs));

console.log('===== #1161 桌面壁纸模糊烘焙进纹理 =====');
console.log('root = ' + root);
R.lines.forEach((l) => console.log(l));
console.log('结果：通过 ' + R.pass + ' / 失败 ' + R.fail);
try { ws.close(); } catch (e) {}
try { cp.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(R.fail ? 1 : 0);
