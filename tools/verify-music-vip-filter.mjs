// ===== 回归脚本：歌单导入自动移除 VIP 歌曲 + 非手势播放被拒不弹「被拦截」提示 =====
// 用法：node build.mjs && node tools/verify-music-vip-filter.mjs
// 背景（用户反馈）：
//   ① 聊天时正常听歌也会突然中断并弹「点击播放被浏览器拦截」——自动切歌/断链重试
//      等非手势上下文里 audio.play() 被拒是常态，旧逻辑一律弹提示吓用户；
//   ② 导入网易云歌单时需要自动去掉 VIP 歌曲（网页外链根本播不了）。
// 实现：
//   ① startPlayback 的拒绝处理按「最近用户手势」分流（handlePlayReject）：手势内才
//      弹提示，非手势静默走补播反击（armAutoResume + scheduleBgResume）；
//   ② v6 解析源携带 fee；meting 源导入后由 enrichImportedDurations 同一趟 v6 详情
//      识别 fee=1/4 并移除本批 VIP（只动本批，不碰已有歌曲），toast 提示移除数。
// 验证（stub 网易云接口：meting 歌单返回 3 首——1 VIP + 2 免费；v6 返回 fee/dt）：
//   1) 批量面板粘贴歌单链接导入 → VIP 曲目不入最终曲库
//   2) 免费曲目时长经 v6 快路径补全（03:00 / 03:20）
//   3) toast 出现「已自动移除 1 首 VIP/付费歌曲」
//   4) 无手势上下文 play() 被拒 → 不弹「被浏览器拦截」
//   5) 手势上下文（pointerdown 后立刻播）被拒 → 弹「被浏览器拦截」提示
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9950 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vip-' + Date.now()),
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

const METING_JSON = JSON.stringify([
  { name: 'VIP试听曲', artist: 'Viper', url: 'https://api.injahow.cn/meting/?server=netease&type=url&id=111', pic: '', lrc: '' },
  { name: '免费歌A', artist: 'Free', url: 'https://api.injahow.cn/meting/?server=netease&type=url&id=222', pic: '', lrc: '' },
  { name: '免费歌B', artist: 'Free', url: 'https://api.injahow.cn/meting/?server=netease&type=url&id=333', pic: '', lrc: '' },
]);
const V6_JSON = JSON.stringify({
  playlist: { tracks: [
    { id: 111, name: 'VIP试听曲', ar: [{ name: 'Viper' }], al: { picUrl: '' }, dt: 100000, fee: 1 },
    { id: 222, name: '免费歌A', ar: [{ name: 'Free' }], al: { picUrl: '' }, dt: 180000, fee: 0 },
    { id: 333, name: '免费歌B', ar: [{ name: 'Free' }], al: { picUrl: '' }, dt: 200000, fee: 0 },
  ] },
});

const INIT_SCRIPT = `
// ---- 网易云接口 stub：meting 歌单（无 fee）+ v6 详情（带 fee/dt）----
(function(){
  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  window.__fetched = [];
  window.fetch = function (input, opts) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    window.__fetched.push(String(url).slice(0, 140));
    if (url.indexOf('meting') >= 0 && url.indexOf('type=playlist') >= 0) {
      return Promise.resolve(new Response(${JSON.stringify(METING_JSON)}, { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (url.indexOf('music.163.com/api/v6/playlist/detail') >= 0 || url.indexOf('music.163.com%2Fapi%2Fv6%2Fplaylist%2Fdetail') >= 0) {
      return Promise.resolve(new Response(${JSON.stringify(V6_JSON)}, { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return origFetch ? origFetch(input, opts) : Promise.reject(new Error('no-fetch'));
  };
})();
// ---- Audio mock：可切换 rejectMode 模拟严格内核拒绝无手势播放 ----
window.__au = { list: [], log: [], lastPlayed: null, rejectMode: false };
window.Audio = function () {
  var idx = window.__au.list.length;
  var el = {
    __idx: idx,
    paused: true, ended: false, duration: 0, currentTime: 0,
    readyState: 4, networkState: 1, volume: 1, muted: false,
    preload: '', src: '', referrerPolicy: '',
    buffered: { length: 0, end: function () { return 0; } },
    style: {}, parentNode: { removeChild: function () {} },
    onplay: null, onpause: null, onended: null, onerror: null, onloadedmetadata: null,
    removeAttribute: function () {}, load: function () {},
    addEventListener: function () {}
  };
  el.play = function () {
    if (window.__au.rejectMode) {
      window.__au.log.push({ act: 'reject', inst: idx, t: Date.now() });
      // v3.26.x：模拟真实浏览器的自动播放拦截——错误对象挂 name='NotAllowedError'
      //（真实内核是 DOMException.name；旧 mock 只把名字放 message，播放器按 err.name
      // 区分错误类型后会误判成源加载失败走换源兜底，测试场景失真）
      var re = new Error('The play method is not allowed by the user agent');
      re.name = 'NotAllowedError';
      return Promise.reject(re);
    }
    el.paused = false;
    window.__au.log.push({ act: 'play', inst: idx, t: Date.now() });
    window.__au.lastPlayed = el;
    if (el.onplay) el.onplay();
    return Promise.resolve();
  };
  el.pause = function () { el.paused = true; if (el.onpause) el.onpause(); };
  el.systemPause = function () { el.paused = true; if (el.onpause) el.onpause(); };
  window.__au.list.push(el);
  return el;
};
// ---- toast 收集器（2s 即逝，轮询兜住）----
window.__toasts = [];
setInterval(function () {
  var t = document.getElementById('cc-toast');
  if (t && String(t.className).indexOf('show') >= 0 && t.textContent && window.__toasts.indexOf(t.textContent) < 0) window.__toasts.push(t.textContent);
}, 100);
`;

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

  // ---- 第 1 次加载：清空曲库，保证导入结果干净 ----
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(500);
  await evalJs(`try { window.storeFor('default').set('music-library', '[]'); 'OK'; } catch(e){ 'ERR:'+e.message; }`);

  // ---- 第 2 次加载：驱动批量导入面板粘贴歌单链接 ----
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(900);
  await evalJs(`(function(){ var el=document.querySelector('.app[data-app="music"]'); if(el)el.click(); return !!el; })()`);
  await sleep(400);
  const panel = await evalJs(`(function(){
    var b=document.getElementById('music-batch'); if(!b)return 'NO-BTN';
    b.click(); return 'OK';
  })()`);
  await sleep(350);
  const pasted = await evalJs(`(function(){
    var ta=document.getElementById('sm-batch-input'); if(!ta)return 'NO-TA';
    ta.value='https://music.163.com/playlist?id=555'; return 'OK';
  })()`);
  await evalJs(`(function(){ var b=document.getElementById('sm-batch-ok'); if(b)b.click(); return !!b; })()`);

  // ---- 轮询导入+VIP移除完成：库里只剩 2 首免费歌且时长已补 ----
  let lib = null;
  for (let i = 0; i < 40; i++) {
    lib = await evalJs(`(function(){
      try{
        var arr=JSON.parse(window.storeFor('default').get('music-library')||'[]');
        var ids=arr.map(function(m){return m.neteaseId;});
        var d={}; arr.forEach(function(m){ d[m.neteaseId]=m.duration; });
        return { n:arr.length, ids:ids, d:d };
      }catch(e){ return null; }
    })()`);
    if (lib && lib.n === 2 && lib.ids.indexOf('111') < 0 && lib.d['222'] === 180 && lib.d['333'] === 200) break;
    await sleep(300);
  }
  check('批量面板打开并可粘贴', panel === 'OK' && pasted === 'OK', panel + '/' + pasted);
  check('VIP 曲目(111)已被移除，仅剩免费歌', lib && lib.n === 2 && lib.ids.indexOf('111') < 0 && lib.ids.indexOf('222') >= 0 && lib.ids.indexOf('333') >= 0, JSON.stringify(lib));
  check('免费歌时长经 v6 快路径补全（180s/200s）', !!(lib && lib.d['222'] === 180 && lib.d['333'] === 200), JSON.stringify(lib ? lib.d : {}));
  const toasts = await evalJs('JSON.stringify(window.__toasts)');
  check('toast 提示已自动移除 VIP 歌曲', !!(toasts && toasts.indexOf('已自动移除 1 首 VIP') >= 0), toasts);

  // ---- 场景：无手势上下文播放被拒 → 不弹「被浏览器拦截」 ----
  await evalJs('(function(){ window.__au.rejectMode = true; return true; })()');
  await sleep(4300); // 等 lastGestureAt 天然过期（若有残留）
  const noG1 = await evalJs(`(function(){
    var before = window.__toasts.filter(function(t){ return t.indexOf('被浏览器拦截')>=0; }).length;
    var row=document.querySelector('#music-lib-list .sm-song'); if(row)row.click();
    return { before:before };
  })()`);
  await sleep(800);
  const noG2 = await evalJs(`(function(){
    var after = window.__toasts.filter(function(t){ return t.indexOf('被浏览器拦截')>=0; }).length;
    return { after:after, rejects: window.__au.log.filter(function(e){return e.act==='reject';}).length };
  })()`);
  check('无手势上下文 play() 被拒 → 不弹拦截提示', noG2.after === noG1.before && noG2.rejects >= 2, JSON.stringify(noG1) + '→' + JSON.stringify(noG2));

  // ---- 场景：手势上下文被拒 → 弹提示（用户点了一下没声音要知道原因）----
  const g1 = await evalJs(`(function(){
    document.dispatchEvent(new Event('pointerdown')); // 模拟真实触摸
    var row=document.querySelector('#music-lib-list .sm-song'); if(row)row.click();
    return true;
  })()`);
  await sleep(700);
  const g2 = await evalJs(`(function(){
    var hit = window.__toasts.filter(function(t){ return t.indexOf('被浏览器拦截')>=0; }).length;
    return { hit:hit };
  })()`);
  check('手势上下文被拒 → 弹拦截提示', g1 && g2.hit > noG2.after, 'hits=' + JSON.stringify(g2));

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
