// ===== 回归脚本：大歌单导入时长补全失控 + 正在播放行封面被放大（v3.10.x 修复） =====
// 用法：node build.mjs && node tools/verify-music-dur-cover.mjs
// 背景（用户反馈）：① 网易云链接导入歌单、歌曲过多时，时长一直显示 00:00——旧
//   runDurProbe 的 running 标志被同步排空的 next() 提前清掉，每首歌各自起一批
//   「并发4」，实际几百首同时 new Audio 抢连接，12s 超时内大多失败；
//   ② 音乐封面莫名其妙被放大、不显示完整——正在播放行 .active 规则用 background
//   简写（优先级 0,3,0）重置了 .has-cov 的 background-size:cover，90×90 原图按
//   自然尺寸画进 34px 缩略图＝只看到左上局部。
// 修复：music-player.js 改 worker pool（active 计数 + pump，恒定 ≤4 并发）+
//   saveLibrarySoon 节流；chat-pages.css 增加 .sm-song.active .sm-song-ico.has-cov
//   高优先级规则恢复 cover/center。
// 验证（mock window.Audio 计数并发，24 首缺时长的网易云歌在启动时自动探测）：
//   1) 探测并发峰值 ≤ 4 且 ≥ 2（旧实现为 24）
//   2) 全部歌曲时长写回曲库并持久化（saveLibrarySoon 节流后仍落盘）
//   3) 打开音乐页，列表行显示时长文本 02:03
//   4) 非激活行缩略图 background-size = cover
//   5) .active 行缩略图 background-size = cover（本次 CSS 修复点；修复前为 auto）
//   6) .active 行缩略图 background-position = center
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const N_TRACKS = 24;

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-durcov-' + Date.now()),
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
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const waitReady = async () => {
  for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) return; await sleep(200); }
};

// 1×1 方形 PNG（封面用 dataURI，避免测试期真实请求网易云封面接口）
const DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
// 每次导航前注入：mock Audio 统计瞬时并发（探测池走 new Audio 取 metadata）
const INIT_SCRIPT = `
window.__probeStats = { cur: 0, max: 0, done: 0 };
window.Audio = function () {
  var s = window.__probeStats;
  s.cur++; if (s.cur > s.max) s.max = s.cur;
  var self = this;
  this.preload = ''; this.src = ''; this.referrerPolicy = ''; this.duration = 0;
  this.onloadedmetadata = null; this.onerror = null;
  this.removeAttribute = function () {}; this.load = function () {};
  setTimeout(function () {
    s.cur--; s.done++;
    self.duration = 123.4;
    if (self.onloadedmetadata) self.onloadedmetadata();
  }, 200 + Math.floor(Math.random() * 160));
};`;

let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('PASS  ' + name + (info ? '  [' + info + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (info ? '  [' + info + ']' : '')); }
}

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: INIT_SCRIPT });

  // ---- 第 1 次加载：写入 24 首缺时长的网易云测试曲（带封面）----
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(800);
  const seed = await evalJs(`(function(){
    var arr=[];
    for (var i=0;i<${N_TRACKS};i++) arr.push({ id:'sm_vt_'+i, neteaseId:'90000'+i, name:'回归测试曲'+i, artist:'Verify',
      cover:${JSON.stringify(DATA_URI)}, url:'', source:'url', duration:0, playlistId:'default', addedAt:Date.now() });
    try { window.storeFor('default').set('music-library', JSON.stringify(arr)); return true; } catch(e){ return 'ERR:'+e.message; }
  })()`);
  check('预置 24 首测试曲入库', seed === true, String(seed));

  // ---- 第 2 次加载：启动即触发 probeAllMissingDurations（mock Audio 已就位）----
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  let stats = null;
  for (let i = 0; i < 100; i++) {
    stats = await evalJs('(function(){var s=window.__probeStats;if(!s)return null;var lib=null;try{lib=JSON.parse(window.storeFor("default").get("music-library")||"[]");}catch(e){}return{s:s,vt:lib?lib.filter(function(t){return /^sm_vt_/.test(t.id)&&t.duration>0;}).length:-1};})()');
    if (stats && stats.s.done >= N_TRACKS && stats.s.cur === 0 && stats.vt >= N_TRACKS) break;
    await sleep(250);
  }
  if (!stats) stats = { s: { max: -1, done: 0 }, vt: -1 };
  check('探测并发峰值 ≤ 4（旧实现全部同时起）', stats.s.max >= 2 && stats.s.max <= 4, 'max=' + stats.s.max);
  check('24 首全部探测完成', stats.s.done >= N_TRACKS, 'done=' + stats.s.done);
  check('时长已全部写回曲库（节流保存落盘）', stats.vt >= N_TRACKS, 'written=' + stats.vt);

  // ---- 打开音乐页：列表显示补全后的时长 ----
  await evalJs(`(function(){ var el=document.querySelector('.app[data-app="music"]'); if(el)el.click(); return !!el; })()`);
  await sleep(600);
  const ui = await evalJs(`(function(){
    var rows=document.querySelectorAll('#music-lib-list .sm-song');
    var durs=[], cov=0;
    rows.forEach(function(r){ var d=r.querySelector('.sm-song-dur'); if(d)durs.push(d.textContent);
      var ic=r.querySelector('.sm-song-ico'); if(ic&&ic.classList.contains('has-cov'))cov++; });
    return { count: rows.length, durs: durs.slice(0,3), covCount: cov };
  })()`);
  check('音乐页列表渲染出测试曲', ui && ui.count >= N_TRACKS, 'rows=' + (ui ? ui.count : 0));
  check('列表行显示补全后的时长 02:03', ui && ui.durs.length > 0 && ui.durs.every(t => t === '02:03'), JSON.stringify(ui ? ui.durs : []));

  // ---- 封面级联：非激活 / .active 行的缩略图 background-size ----
  const css = await evalJs(`(function(){
    var URI=${JSON.stringify(DATA_URI)};
    var box=document.getElementById('music-lib-list'); if(!box)return null;
    var mk=function(cls){ var d=document.createElement('div'); d.className='sm-song'+(cls?' '+cls:'');
      d.innerHTML='<span class="sm-song-ico has-cov" style="background-image:url(\\''+URI+'\\')"></span>';
      box.appendChild(d); return d; };
    var a=mk(''), b=mk('active');
    var ga=getComputedStyle(a.querySelector('.sm-song-ico')), gb=getComputedStyle(b.querySelector('.sm-song-ico'));
    var r={ plainSize:ga.backgroundSize, actSize:gb.backgroundSize, actPos:gb.backgroundPosition };
    a.remove(); b.remove(); return r;
  })()`);
  check('非激活行封面 background-size=cover', css && css.plainSize === 'cover', css && css.plainSize);
  check('.active 行封面 background-size=cover（放大裁切修复点）', css && css.actSize === 'cover', css && css.actSize);
  check('.active 行封面 background-position=center', css && /center|50%\s*50%/.test(css.actPos), css && css.actPos);

  console.log('\n==== 结果：' + (pass + fail) + ' 项检查，' + fail + ' 项失败 ====');
  if (fail) process.exitCode = 1;
  else console.log('全部通过');
} catch (e) {
  console.error('脚本异常:', e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
  server.close();
}
process.exit(process.exitCode || 0);
