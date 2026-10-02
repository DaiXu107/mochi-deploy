// ===== 回归：网易云歌单导入「只能导入 10 首」+ 移动端歌单链接漏判 =====
// 用法：node tools/verify-music-playlist.mjs
//       SRCDIR=<src 快照目录> node tools/verify-music-playlist.mjs   # 对任意快照（如 HEAD）红绿对照
//
// 背景（2026-09-10 用户反馈 iPhone 14 Pro + Safari，并明说其他机型也有）：
//   【音乐】粘贴网易云歌单链接，62 首的歌单只导入 10 首。
// 根因（与机型/浏览器无关，纯上游数据面）：
//   ① 网易 playlist/detail 的 tracks 对**用户自建歌单**只给首屏 10 首（trackIds/trackCount
//      才是全量），只读 tracks 的 meting 实例必然回 10 首（官方榜单则全给）；旧
//      fetchNeteasePlaylist 串行问源、「第一个非空源即收口」→ 第一路 injahow 永远以 10 首
//      抢收，后面的全量源根本没机会。实测 18366934337：qijieya 62 / injahow 10。
//   ② extractPlaylistId 漏判移动端「复制链接」的 m/playlist#!?id=xxx（旧分隔符类不含 !），
//      整张歌单被 extractNeteaseSongId 当单曲导入（用户诊断里 music.163.com/song?id=<歌单ID>
//      的失败请求即证据）。
// 修复：多源并发 + 取最长（同数取靠前者）；曲目数恰为 10 = 截断特征不可信收口，给慢源
//   1.5s 宽限、8s 硬兜底；已知全量数与实取数之差如实提示「另有 N 首未取到，可重导补齐」
//   （去重只跳已有，重导确实能补齐）；各实例封面 URL 归一到 injahow 以走 #216 迁移链。
//
// 验证方式：无头 Chrome + 内存拼装页面（不写产物）；桩 fetch 只喂 canned body（其余一律
//   reject，绝不打真网络），走真实 UI 路径（音乐页「链接添加」→ 贴链接 → 确认）断言入库
//   结果与 toast；SRCDIR 指向 HEAD 快照（`git archive HEAD src | tar -x -C <dir>`）实测
//   **9/23**——红项恰为 S1/S2/S3/S5/S6/S7/S9（七条源锚点缺失）+ P1（「导入 10 首，应为 62」
//   ＝用户屏上原文复现）/P5/P6（只认 injahow 单实例，实例一挂整单失败）/P7（移动端分享链
//   被当单曲，「链接音乐已添加」1 首）/P9/P10（无缺口提示、重导补不齐）/P14（混合批 11 首）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const srcDir = process.env.SRCDIR ? normalize(process.env.SRCDIR) : join(root, 'src');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = chromeCandidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge（可用 CHROME_PATH 指定）'); process.exit(1); }

// 打包清单直接读 build.mjs，避免与 src 新增文件脱节
const buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8');
function arrFromBuild(name) {
  const m = buildSrc.match(new RegExp('const ' + name + ' = (\\[[^\\n]*\\]);'));
  if (!m) throw new Error('build.mjs 未找到 ' + name + '（数组格式变了）');
  return JSON.parse(m[1].replace(/'/g, '"'));
}
const cssFiles = arrFromBuild('cssFiles');
const jsFiles = arrFromBuild('jsFiles');
const readSrc = (p) => readFileSync(join(srcDir, p), 'utf8');
const wrapFile = (f, code) => '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] " + f, __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();';

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-mpl-' + Date.now()),
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

const server = createServer((req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/' || u === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
    let p = normalize(join(root, u));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': extname(p) === '.css' ? 'text/css' : 'text/javascript' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cssCode = cssFiles.map((f) => '<style>' + readSrc('css/' + f) + '</style>').join('\n');
const jsCode = jsFiles.map((f) => wrapFile(f, readSrc('js/' + f))).join('\n');
const staticHtml = readFileSync(join(srcDir, 'template.html'), 'utf8')
  .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<link[^>]*rel="stylesheet"[^>]*>/gi, '');
const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + cssCode + '</head><body>' + staticHtml +
  '<div id="cc-toast" class="cc-toast"></div>' + '<script>' + jsCode + '</script>' + '</body></html>';

// ---- 桩数据规格（写进 localStorage.__plStub，INIT_SCRIPT 在页面脚本前装好 fetch 桩）----
// qj/ij/im = 各 meting 实例返回的曲目数，或 'fail'(网络失败) / 'bad'(非数组)
// of = 官方 v6 兜底源的 tracks 曲目数或 'fail'；ofTotal = trackCount（0=不给）；ofFee = 每 ofFee 首标 fee=1（0=无）
const STUB_JS = `
(function () {
  var spec = {};
  try { spec = JSON.parse(localStorage.getItem('__plStub') || '{}'); } catch (e) {}
  var ID0 = 1000;
  function metingBody(host, n) {
    var arr = [];
    for (var i = 0; i < n; i++) {
      var id = ID0 + i;
      arr.push({ name: '歌' + id, artist: 'A' + i, url: host + '?server=netease&type=url&id=' + id,
        pic: host + '?server=netease&type=pic&id=' + (9000000 + id), lrc: '' });
    }
    return JSON.stringify(arr);
  }
  function officialBody(n, total, feeEvery) {
    var tr = [];
    for (var i = 0; i < n; i++) {
      var id = ID0 + i;
      tr.push({ id: id, name: '官' + id, ar: [{ name: 'A' + i }], al: { picUrl: 'https://p1.music.126.net/x/' + (777 + id) + '.jpg' }, dt: 180000 + i * 1000, fee: (feeEvery && i % feeEvery === 0) ? 1 : 0 });
    }
    var pl = { tracks: tr };
    if (total) pl.trackCount = total;
    return JSON.stringify({ playlist: pl });
  }
  function ok(body) { return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })); }
  function bad() { return Promise.resolve(new Response('{"error":"unknown playlist id"}', { status: 200, headers: { 'Content-Type': 'application/json' } })); }
  window.__plReq = [];
  window.fetch = function (input, opts) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    url = String(url);
    var low = url.toLowerCase();
    window.__plReq.push(url.slice(0, 120));
    function pick(v, host) { return v === 'fail' ? Promise.reject(new Error('stub-down')) : (v === 'bad' ? bad() : ok(metingBody(host, v | 0))); }
    if (low.indexOf('type=playlist') >= 0) {
      if (low.indexOf('qijieya') >= 0) return pick(spec.qj, 'https://api.qijieya.cn/meting/');
      if (low.indexOf('i-meto') >= 0) return pick(spec.im, 'https://api.i-meto.com/meting/api');
      if (low.indexOf('injahow') >= 0) return pick(spec.ij, 'https://api.injahow.cn/meting/');
      return Promise.reject(new Error('stub-unknown-playlist-host'));
    }
    // 官方 v6（cors.sh 明文拼接 / allorigins 整串编码两种形态）
    if (/playlist(%2f|\\/|%5c)detail/i.test(low) || low.indexOf('/api/v6/playlist/detail') >= 0) {
      if (spec.of === 'fail') return Promise.reject(new Error('stub-proxy-dead'));
      return ok(officialBody(spec.of | 0, spec.ofTotal | 0, spec.ofFee | 0));
    }
    // 其余（封面代理/歌曲详情/播放直链/version.json…）一律失败，保证零真网络依赖
    return Promise.reject(new Error('stub-off'));
  };
  // Audio mock：时长探测立即 onerror（探测不参与本脚本断言，也别打真网络）
  window.Audio = function () {
    var el = { paused: true, ended: false, duration: 0, currentTime: 0, readyState: 0, volume: 1, muted: false, preload: '', src: '', referrerPolicy: '', buffered: { length: 0, end: function () { return 0; } }, style: {}, onplay: null, onpause: null, onended: null, onerror: null, onloadedmetadata: null, addEventListener: function () {}, play: function () { return Promise.resolve(); }, pause: function () {}, load: function () {}, removeAttribute: function () {}, parentNode: { removeChild: function () {} } };
    Object.defineProperty(el, 'src', { set: function (v) { el.__src = v; setTimeout(function () { if (el.onerror) el.onerror(); }, 0); }, get: function () { return el.__src || ''; } });
    return el;
  };
  // toast 收集器（2s 即逝，轮询兜住）
  window.__toasts = [];
  setInterval(function () {
    var t = document.getElementById('cc-toast');
    if (t && String(t.className).indexOf('show') >= 0 && t.textContent && window.__toasts.indexOf(t.textContent) < 0) window.__toasts.push(t.textContent);
  }, 80);
})();
`;

const LIB_READ = `(function(){ try { return JSON.parse(window.storeFor('default').get('music-library') || '[]'); } catch (e) { return null; } })()`;

const cases = [
  {
    id: 'P1', name: '用户自建歌单：全量源 62 + 截断源 10 → 导入 62 首（本次反馈主案）',
    stub: { qj: 62, ij: 10, im: 'fail', of: 'fail' },
    input: 'https://music.163.com/playlist?id=18366934337',
    check: (lib, toasts) => {
      if (!lib || lib.length !== 62) return { ok: false, msg: '导入 ' + (lib && lib.length) + ' 首，应为 62' };
      if (!lib.some(m => m.neteaseId === '1061')) return { ok: false, msg: '第 62 首（截断源没有的曲目）未入库' };
      if (/数据源受限/.test(toasts.join('|'))) return { ok: false, msg: '完整导入却误报缺口' };
      return { ok: true };
    }
  },
  {
    id: 'P2', name: '全量源死亡：截断源 10 首仍能导入（best-effort 不倒退）',
    stub: { qj: 'fail', ij: 10, im: 'fail', of: 'fail' },
    input: 'https://music.163.com/playlist?id=18366934337',
    check: (lib) => (lib && lib.length === 10 ? { ok: true } : { ok: false, msg: '导入 ' + (lib && lib.length) + ' 首，应为 10' })
  },
  {
    id: 'P3', name: '截断特征 10：两源各 10 首仍照导不误伤',
    stub: { qj: 10, ij: 10, im: 'fail', of: 'fail' },
    input: 'https://music.163.com/playlist?id=18366934337',
    check: (lib) => (lib && lib.length === 10 ? { ok: true } : { ok: false, msg: '导入 ' + (lib && lib.length) + ' 首，应为 10' })
  },
  {
    id: 'P4', name: '官方榜 200 首（非截断）→ 全量导入并快速收口',
    stub: { qj: 'fail', ij: 200, im: 'fail', of: 'fail' },
    input: 'https://music.163.com/playlist?id=3778678',
    check: (lib) => (lib && lib.length === 200 ? { ok: true } : { ok: false, msg: '导入 ' + (lib && lib.length) + ' 首，应为 200' })
  },
  {
    id: 'P5', name: '入库播放直链一律 injahow 规范形态，不残留列表实例域名',
    stub: { qj: 62, ij: 'fail', im: 'fail', of: 'fail' },
    input: 'https://music.163.com/playlist?id=18366934337',
    check: (lib) => {
      if (!lib || lib.length !== 62) return { ok: false, msg: '前置导入不符预期 n=' + (lib && lib.length) };
      if (lib.some(m => String(m.url).indexOf('qijieya') >= 0)) return { ok: false, msg: '库里残留 qijieya 播放直链' };
      if (!lib.every(m => /^https:\/\/api\.injahow\.cn\/meting\/\?type=url&id=\d+$/.test(String(m.url)))) return { ok: false, msg: '播放直链未归一' };
      return { ok: true };
    }
  },
  {
    id: 'P6', name: '封面 URL 归一到 injahow 图片代理（#216 迁移链只认它）',
    stub: { qj: 62, ij: 'fail', im: 'fail', of: 'fail' },
    input: 'https://music.163.com/playlist?id=18366934337',
    check: (lib) => {
      if (!lib || !lib.length) return { ok: false, msg: '未导入' };
      var re = /^https:\/\/api\.injahow\.cn\/meting\/\?server=netease&type=pic&id=\d+$/;
      if (!lib.every(m => re.test(String(m.cover)))) return { ok: false, msg: '封面未归一：' + lib[0].cover };
      return { ok: true };
    }
  },
  {
    id: 'P7', name: '移动端「复制链接」m/playlist#!?id=xxx 识别为歌单（旧判当单曲）',
    stub: { qj: 62, ij: 10, im: 'fail', of: 'fail' },
    input: '分享一个歌单 https://music.163.com/m/playlist#!?id=18366934337&t=3 @网易云音乐',
    check: (lib) => {
      if (!lib || lib.length !== 62) return { ok: false, msg: '导入 ' + (lib && lib.length) + ' 首；歌单链接被当单曲会得 1 首' };
      if (lib.some(m => m.neteaseId === '18366934337')) return { ok: false, msg: '歌单 ID 被当成一首歌入库' };
      return { ok: true };
    }
  },
  {
    id: 'P8', name: '官方 v6 兜底活着且给全量：导入 62 且 fee=1 前置过滤、时长到位',
    stub: { qj: 'fail', ij: 'fail', im: 'fail', of: 62, ofTotal: 62, ofFee: 20 },
    input: 'https://music.163.com/playlist?id=18366934337',
    check: (lib, toasts) => {
      if (!lib || lib.length !== 58) return { ok: false, msg: '导入 ' + (lib && lib.length) + ' 首，应为 62-4(VIP)=58' };
      if (lib.some(m => m.neteaseId === '1000')) return { ok: false, msg: 'fee=1 曲目仍入库' };
      if (lib[0].duration < 180) return { ok: false, msg: '时长未随官方详情补全：' + lib[0].duration };
      if (!/VIP 歌曲 4 首未导入/.test(toasts.join('|'))) return { ok: false, msg: 'toast 未报 VIP 数：' + toasts.join('|') };
      return { ok: true };
    }
  },
  {
    id: 'P9', name: '已知全量 62 实取 10 → 如实提示「另有 52 首未取到」',
    stub: { qj: 'fail', ij: 'fail', im: 'fail', of: 10, ofTotal: 62 },
    input: 'https://music.163.com/playlist?id=18366934337',
    check: (lib, toasts) => {
      if (!lib || lib.length !== 10) return { ok: false, msg: '导入 ' + (lib && lib.length) + ' 首，应为 10' };
      if (!/另有 52 首未取到/.test(toasts.join('|'))) return { ok: false, msg: 'toast 未如实报缺口：' + toasts.join('|') };
      return { ok: true };
    }
  },
  {
    id: 'P10', name: '重导同一链接补齐缺口（去重只跳已有）→ +52 首、跳过 10 首',
    stub: { qj: 62, ij: 10, im: 'fail', of: 'fail' },
    seed: 10, input: 'https://music.163.com/playlist?id=18366934337',
    check: (lib, toasts) => {
      if (!lib || lib.length !== 62) return { ok: false, msg: '库内 ' + (lib && lib.length) + ' 首，应为 10+52=62' };
      if (!/跳过已有 10 首/.test(toasts.join('|'))) return { ok: false, msg: 'toast 未报跳过：' + toasts.join('|') };
      var ids = {}; lib.forEach(m => { ids[m.neteaseId] = (ids[m.neteaseId] || 0) + 1; });
      if (Object.keys(ids).some(k => ids[k] > 1)) return { ok: false, msg: '出现重复曲目' };
      return { ok: true };
    }
  },
  {
    id: 'P11', name: '单曲链接不误判为歌单（放宽正则后的反向对照）',
    stub: { qj: 62, ij: 10, im: 'fail', of: 'fail' },
    input: 'https://music.163.com/#/song?id=27538343',
    check: (lib) => {
      if (!lib || lib.length !== 1) return { ok: false, msg: '入库 ' + (lib && lib.length) + ' 首，单曲链接应得 1 首' };
      if (lib[0].neteaseId !== '27538343') return { ok: false, msg: 'neteaseId=' + lib[0].neteaseId };
      return { ok: true };
    }
  },
  {
    id: 'P12', name: 'mp3 外链 / 纯数字 ID 仍走单曲（不被歌单正则吞掉）',
    stub: { qj: 62, ij: 10, im: 'fail', of: 'fail' },
    input: 'http://music.163.com/song/media/outer/url?id=27538343.mp3\n28815250',
    check: (lib) => {
      if (!lib || lib.length !== 2) return { ok: false, msg: '入库 ' + (lib && lib.length) + ' 首，应为 2' };
      if (lib.some(m => m.neteaseId === '18366934337')) return { ok: false, msg: '误当歌单导入' };
      return { ok: true };
    }
  },
  {
    id: 'P13', name: '全部源失败：如实报「歌单导入失败」且库不变、无未捕获异常',
    stub: { qj: 'fail', ij: 'fail', im: 'fail', of: 'fail' },
    input: 'https://music.163.com/playlist?id=18366934337',
    check: (lib, toasts, errs) => {
      if (lib && lib.length) return { ok: false, msg: '失败场景却有 ' + lib.length + ' 首入库' };
      if (!/歌单导入失败/.test(toasts.join('|'))) return { ok: false, msg: 'toast 未报失败：' + toasts.join('|') };
      if (errs && errs.length) return { ok: false, msg: '未捕获异常：' + errs.join(' | ').slice(0, 120) };
      return { ok: true };
    }
  },
  {
    id: 'P14', name: '多播混合：歌单链接 + 单曲链接同批导入（62+1）',
    stub: { qj: 62, ij: 10, im: 'fail', of: 'fail' },
    input: 'https://music.163.com/playlist?id=18366934337\nhttps://music.163.com/#/song?id=27538343',
    check: (lib) => {
      if (!lib || lib.length !== 63) return { ok: false, msg: '入库 ' + (lib && lib.length) + ' 首，应为 63' };
      if (!lib.some(m => m.neteaseId === '27538343')) return { ok: false, msg: '单曲行未导入' };
      return { ok: true };
    }
  }
];

// ---- 静态接线断言（不走浏览器，SRCDIR 直接读源文件）----
const mp = readSrc('js/music-player.js');
function staticChecks() {
  const out = [];
  const body = (mp.match(/function fetchNeteasePlaylist\(id, cb\) \{[\s\S]*?\n  \}\n/) || [''])[0];
  out.push(['S1 取最长而非首个非空（旧 tryNext/首源即收口 已消失）', body.indexOf('tryNext') < 0 && body.indexOf('if (res && res.length) cb(res);') < 0]);
  out.push(['S2 截断特征常量存在且用于收口判定', /var NETEASE_TRACKS_TRUNC = 10;/.test(mp) && /n !== NETEASE_TRACKS_TRUNC/.test(body)]);
  out.push(['S3 全量 meting 实例接入（qijieya type=playlist）', /api\.qijieya\.cn\/meting\/\?server=netease&type=playlist/.test(body)]);
  out.push(['S4 官方 v6 兜底排在 meting 之后（同源数不抢既有链路）', body.indexOf('type=playlist') < body.indexOf('proxy.cors.sh')]);
  out.push(['S5 trackCount 缺口回传（totalKnown → miss）', /total: parseInt\(pl\.trackCount, 10\)/.test(mp) && /const miss = Math\.max\(0, \(totalKnown \|\| 0\) - tracks\.length\)/.test(mp)]);
  out.push(['S6 封面归一到 injahow 图片代理', /function canonicalMetingPicUrl\(pic\)/.test(mp) && /api\.injahow\.cn\/meting\/\?server=netease&type=pic/.test(mp)]);
  const plCls = (mp.match(/playlist\[([^\]]*)\]/) || ['', ''])[1];
  out.push(['S7 歌单正则覆盖移动端 #!?id= 形态', plCls.indexOf('!') >= 0 && plCls.indexOf('#') >= 0]);
  out.push(['S8 修复逻辑零机型分支（函数体内无 UA/iOS/安卓/Via 判定）', !/isIOS|isAndroid|isVia|navigator\.userAgent|userAgent|webdriver/i.test(body)]);
  out.push(['S9 缺口提示两处面板都接线', (mp.match(/数据源受限，另有 /g) || []).length === 2]);
  return out;
}

let pass = 0, fail = 0;
function report(id, name, ok, msg) {
  if (ok) { pass++; console.log('PASS ' + id + '  ' + name); }
  else { fail++; console.log('FAIL ' + id + '  ' + name + (msg ? '  → ' + msg : '')); }
}

try {
  for (const [id, ok] of staticChecks()) report(id, '静态接线', ok, ok ? '' : '源文件锚点缺失');
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: STUB_JS });

  let navigated = false;
  for (const c of cases) {
    const t0 = Date.now();
    let ok = false, msg = '';
    try {
      if (!navigated) {
        await evalJs('window.location.href = ' + JSON.stringify(baseUrl + '/') + '; true;');
        for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
        await sleep(400);
        navigated = true;
      }
      // 每例独立冷启：清库 + 写桩规格 → reload（INIT_SCRIPT 在页面脚本前生效）
      await evalJs(`(function(){ localStorage.setItem('__plStub', ${JSON.stringify(JSON.stringify(c.stub))});
        var s = window.storeFor('default'); s.set('music-library', '[]'); s.set('music-playlists', '[]');
        return true; })();`);
      if (c.seed) {
        await evalJs(`(function(){ var a=[]; for (var i=0;i<${c.seed};i++){ var id=1000+i; a.push({ id:'seed_'+id, neteaseId:String(id), name:'预置'+id, artist:'A', url:'https://api.injahow.cn/meting/?type=url&id='+id, source:'url', duration:180, playlistId:'default', addedAt:1 }); }
          window.storeFor('default').set('music-library', JSON.stringify(a)); return true; })();`);
      }
      await evalJs('window.location.reload(); true;');
      for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
      await sleep(400);
      await evalJs(`(function(){ var el=document.querySelector('.app[data-app="music"]'); if(el) el.click(); return true; })();`);
      await sleep(300);
      const opened = await evalJs(`(function(){ var b=document.getElementById('music-add-url'); if(!b) return 'NO-BTN'; b.click(); return 'OK'; })();`);
      await sleep(300);
      const filled = await evalJs(`(function(){ var ta=document.getElementById('sm-url-link'); if(!ta) return 'NO-TA'; ta.value = ${JSON.stringify(c.input)}; var b=document.getElementById('sm-url-ok'); if(!b) return 'NO-OK'; b.click(); return 'OK'; })();`);
      if (opened !== 'OK' || filled !== 'OK') throw new Error('面板驱动失败 ' + opened + '/' + filled);
      // 等导入落定（toast 出现结果词或库数量稳定）
      let lib = null, toasts = [], errs = [];
      for (let i = 0; i < 60; i++) {
        await sleep(250);
        lib = await evalJs(LIB_READ);
        toasts = (await evalJs('window.__toasts || []')) || [];
        if (Array.isArray(toasts) && toasts.some(t => /已导入|已添加|导入失败|首歌单/.test(t))) break;
      }
      errs = (await evalJs('(window.__jsErrors || []).slice(0, 5)')) || [];
      const r = c.check(Array.isArray(lib) ? lib : null, Array.isArray(toasts) ? toasts : [], Array.isArray(errs) ? errs : []);
      ok = !!(r && r.ok); msg = r && r.msg ? r.msg : '';
      if (!ok && msg) msg += '  [toasts=' + JSON.stringify(toasts).slice(0, 160) + ']';
    } catch (e) { ok = false; msg = '异常: ' + (e && e.message || e); }
    report(c.id, c.name + ' (' + (Date.now() - t0) + 'ms)', ok, msg);
  }
  console.log('\n结果: ' + pass + '/' + (pass + fail) + ' 通过');
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
process.exit(fail ? 1 : 0);
