// ===== 回归脚本：#700 音乐「本地上传 m4a 放不出来」+「网易云分享链接导进去放不出/无反应」=====
// 用法：node build.mjs && node tools/verify-music-local-m4a.mjs（MOCHI_VERIFY_ROOT 可指向隔离副本）
// 背景（荣耀X50i/Edge 实报、多机型同现，用户直派 2026-09-17）：
//   ① 本地上传的 m4a「导入一直不成功/无法播放」——加密格式（音乐 App 下载/缓存）与无损
//      ALAC m4a 在安卓 Chromium 上必然 MediaError.code=4，旧代码导入时探测 onerror 不看不报、
//      播放时 blob↔dataURL 双路白试 8 秒只给一句笼统提示；面板说明还让用户「先下载成音频
//      文件再上传」（事实：App 下载的多带加密）＝用户指「说明有错误」。
//   ② 网易云分享短链（163cn.tv）导入后点播放毫无反应——解析用的公共 CORS 代理
//      （proxy.cors.sh 域名失联/allorigins 超时，2026-09 实测）全挂后，旧代码导入与播放
//      两处解析失败都静默 return；而短链歌本身往往免费可播（injahow 302→https CDN 实测）。
// 检查：
//   A1 添加本地音乐面板说明含「带了加密/转成」纠错且保留「不能直接导入」（运行时真实 DOM）
//   A2 功能介绍页「音乐」组含「上传音乐只认不加密的标准音频」
//   A3 常见问题「上传的音乐播不了？」条目含本地文件解释 + 短链替代导入路径
//   B1 sniffAudioMime / mimeFromName 行为断言（从 src 抽真实函数体跑：ftyp/fLaC/OggS/
//      RIFF/ID3/MP3帧/AAC帧/垃圾数据/超短串/非 ArrayBuffer）
//   C1 播放对 MediaError.code=4 跳过徒劳重试并给「转成 mp3」精确提示（源码接线）
//   C2 导入探测计数反馈 + 列表「放不了」徽标 + 真播放自愈清除（源码接线）
//   C3 fetchNeteaseInfo 歌名识别首选 meting song 源（排在死代理抓页之前）
//   C4 短链解析失败两处 toast 都不再静默（源码接线）
//   D1 短链歌点播放＝解析失败时必须有 toast（不再静默返回）——stub 掉 fetch 强制解析失败，
//      真实点击库内 163cn.tv 歌曲行，断言 #cc-toast 出现「解析失败」指引
//   E1（#709）confirmVipViaMeting 行为断言（抽真实函数体＋stub fetch）：302→非 VIP；
//      200+text/html→VIP；200+audio/*→非 VIP；fetch 拒绝（离线）→非 VIP（宁可不删）
//   E2（#709）时长探测失败仅对 sm_pl_ 歌单批次二次确认＋_vipChecked 去重（源码接线）
//   E3（#709）v6 fee 路径与探测兜底共用 removeBatchVipSongs（源码接线）
//   E4（#709）已死 meting 镜像 api.i-meto.com 已从歌单源移除（401 刷「网络失败」日志）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_VERIFY_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
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
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-m4a-' + Date.now()),
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

let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('PASS  ' + name + (info ? '  [' + info + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (info ? '  [' + info + ']' : '')); }
}

// 打开「添加本地音乐」面板并取回面板内所有 hint 文本
async function openLocalPanelHints() {
  const r = await evalJs(`(function(){
    var app=document.querySelector('.app[data-app="music"]'); if(app)app.click();
    var b=document.getElementById('music-upload'); if(!b)return 'NO-BTN';
    b.click();
    var mask=document.getElementById('tc-mask');
    if(!mask)return 'NO-MASK';
    return JSON.stringify({
      title: (document.getElementById('tc-panel-title')||{}).textContent || '',
      hints: Array.prototype.map.call(mask.querySelectorAll('#tc-body .sm-fld-hint'), function(h){ return h.textContent; }).join(' || ')
    });
  })()`);
  await evalJs(`(function(){ var mask=document.getElementById('tc-mask'); if(mask)mask.hidden=true; return true; })()`);
  await sleep(120);
  if (!r || r === 'NO-BTN' || r === 'NO-MASK') return null;
  try { return JSON.parse(r); } catch (e) { return null; }
}

// B1：从 src 抽真实 sniffAudioMime / mimeFromName 函数体跑行为断言
function extractFn(srcText, name) {
  const m = srcText.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}'));
  if (!m) return null;
  try { return new Function('return (' + m[0] + ')')(); } catch (e) { return null; }
}

try {
  // ---- B1 不需要浏览器：直接对源码函数体做行为断言 ----
  const mpSrc = readFileSync(join(root, 'src/js/music-player.js'), 'utf8');
  const sniff = extractFn(mpSrc, 'sniffAudioMime');
  const fromName = extractFn(mpSrc, 'mimeFromName');
  check('B1.0 从 src 抽到 sniffAudioMime / mimeFromName 函数体', !!sniff && !!fromName);
  if (sniff && fromName) {
    const ab = (arr) => new Uint8Array(arr).buffer;
    const s2b = (s) => Array.from(s).map((c) => c.charCodeAt(0));
    const cases = [
      ['m4a/MP4 容器（ftyp 在第 4 字节）→ audio/mp4', ab([0, 0, 0, 24].concat(s2b('ftypM4A '), [0, 0, 0, 0])), 'audio/mp4'],
      ['FLAC（fLaC 魔数）→ audio/flac', ab(s2b('fLaC').concat([0, 0, 0, 0, 0, 0, 0, 0])), 'audio/flac'],
      ['OGG（OggS 魔数）→ audio/ogg', ab(s2b('OggS').concat([0, 0, 0, 0, 0, 0, 0, 0])), 'audio/ogg'],
      ['WAV（RIFF….WAVE）→ audio/wav', ab(s2b('RIFF').concat([0, 0, 0, 0], s2b('WAVE'), [0, 0, 0, 0])), 'audio/wav'],
      ['MP3（ID3 头）→ audio/mpeg', ab(s2b('ID3').concat([3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), 'audio/mpeg'],
      ['MP3（裸帧 0xFF 0xFB）→ audio/mpeg', ab([0xFF, 0xFB, 0x90, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 'audio/mpeg'],
      ['AAC ADTS（0xFF 0xF1）→ audio/aac', ab([0xFF, 0xF1, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 'audio/aac'],
      ['垃圾数据 → 空串（交给 file.type）', ab([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]), ''],
      ['超短 buffer → 空串（不抛错）', ab([0, 0, 0, 0]), ''],
      ['非 ArrayBuffer 入参 → 空串（不抛错）', '不是buffer', ''],
    ];
    for (const [name, input, want] of cases) {
      let got = null, err = null;
      try { got = sniff(input); } catch (e) { err = e.message; }
      check('B1 ' + name, got === want, err ? ('异常:' + err) : ('got=' + JSON.stringify(got)));
    }
    const exts = [['x.mp3', 'audio/mpeg'], ['y.M4A', 'audio/mp4'], ['z.flac', 'audio/flac'], ['无扩展名', ''], ['w.xyz', '']];
    for (const [n, want] of exts) {
      const got = fromName(n);
      check('B1 扩展名推断 ' + n + ' → ' + (want || '空串'), got === want, 'got=' + JSON.stringify(got));
    }
  }

  // ---- A/C/D 需要真实产物 ----
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  // ---- 第 1 次加载：预置一首 163cn.tv 短链歌（D1 用）----
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(500);
  await evalJs(`try {
    window.storeFor('default').set('music-library', JSON.stringify([
      { id: 't700short', neteaseId: '', name: '短链测试歌', artist: '', url: 'https://163cn.tv/vrfy700', source: 'url', duration: 0, playlistId: 'default', addedAt: Date.now() }
    ]));
    'OK';
  } catch(e){ 'ERR:'+e.message; }`);

  // ---- 第 2 次加载：跑断言 ----
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(900);

  // A1 本地上传面板说明纠错
  const localPanel = await openLocalPanelHints();
  const hp = (localPanel && localPanel.hints) || '';
  check('A1 本地面板说明含「大多带了加密」纠错',
    hp.indexOf('大多带了加密') >= 0, localPanel ? localPanel.hints.slice(0, 60) : '面板打不开');
  check('A2 本地面板说明含「转成 mp3」可执行建议',
    hp.indexOf('转成') >= 0 && hp.indexOf('mp3') >= 0);
  check('A3 本地面板保留「分享链接不能直接导入」（#608 既有防呆不回退）',
    hp.indexOf('不能直接导入') >= 0);

  // A2/A3 功能介绍页两组（静态 DOM）
  const groups = await evalJs(`(function(){
    var out={};
    Array.prototype.forEach.call(document.querySelectorAll('#page-about .lic-grp, #page-guide .lic-grp'), function(g){
      var n=(g.querySelector('.lg-name')||{}).textContent||'';
      var c=(g.querySelector('.lg-count')||{}).textContent||'';
      out[n.trim()]={ count:c.trim(), items:g.querySelectorAll('.lg-body .lic-li').length, text:(g.querySelector('.lg-body')||{}).textContent||'' };
    });
    return JSON.stringify(out);
  })()`);
  let g = null;
  try { g = JSON.parse(groups || 'null'); } catch (e) {}
  const musicGrp = g && g['音乐'];
  const faqGrp = g && g['常见问题'];
  const countOk = (grp) => !!(grp && String(grp.items) === grp.count); // 编辑条目不增减＝计数不变量保持
  check('A4 功能介绍「音乐」组含「上传音乐只认不加密的标准音频」且计数一致',
    !!(musicGrp && musicGrp.text.indexOf('上传音乐只认不加密的标准音频') >= 0 && countOk(musicGrp)),
    musicGrp ? ('count=' + musicGrp.count + '/items=' + musicGrp.items) : '未取到音乐组');
  check('A5 常见问题「上传的音乐播不了？」含本地加密解释＋短链替代导入路径且计数一致',
    !!(faqGrp && faqGrp.text.indexOf('大多带加密') >= 0 && faqGrp.text.indexOf('music.163.com/song?id=数字') >= 0 && countOk(faqGrp)),
    faqGrp ? ('count=' + faqGrp.count + '/items=' + faqGrp.items) : '未取到常见问题组');

  // C 源码接线（防「名字保留、逻辑被改」——哨兵之外的第二道行为面）
  check('C1 播放对 code=4 跳过徒劳重试（lastErrCode 判定在 watchdog 内）',
    /lastErrCode === 4/.test(mpSrc) && mpSrc.indexOf('建议转成 mp3 再重新上传') >= 0);
  check('C2 导入探测计数 + 「放不了」徽标 + onplay 自愈三件套在位',
    mpSrc.indexOf('probeBad++;') >= 0 &&
    mpSrc.indexOf('sm-src-bad">放不了') >= 0 &&
    mpSrc.indexOf('delete m.probeFail; saveLibrary(); renderLibrary();') >= 0);
  const metingIdx = mpSrc.indexOf('meting/?server=netease&type=song&id=');
  const deadProxyIdx = mpSrc.indexOf("proxy.cors.sh/' + songPageUrl");
  check('C3 歌名识别首选 meting song 源（排在死代理抓页之前）',
    metingIdx >= 0 && deadProxyIdx >= 0 && metingIdx < deadProxyIdx,
    'meting@' + metingIdx + ' < proxy@' + deadProxyIdx);
  check('C4 短链解析失败两处 toast 都不再静默',
    mpSrc.indexOf('分享链接解析失败（解析服务受限）') >= 0 &&
    mpSrc.indexOf('网易云分享链接解析失败：先用浏览器打开这条链接') >= 0);

  // ---- E（#709）：歌单导入 VIP 移除的 meting 兜底 ----
  const metUrlFn = extractFn(mpSrc, 'neteaseMetingUrl');
  const confVipFn = extractFn(mpSrc, 'confirmVipViaMeting');
  check('E1.0 从 src 抽到 neteaseMetingUrl / confirmVipViaMeting 函数体', !!metUrlFn && !!confVipFn);
  if (metUrlFn && confVipFn) {
    // 注入 neteaseMetingUrl/mochiSafeCancelBody/fetch 后原样执行函数体（零改动）
    const injected = new Function('neteaseMetingUrl', 'mochiSafeCancelBody', 'fetch',
      'return (' + confVipFn.toString().replace(/^function confirmVipViaMeting\(id, cb\) \{/, 'function (id, cb) {') + ')');
    const mkRes = (redirected, ct) => ({ redirected, headers: { get: () => ct }, body: null });
    const cases = [
      ['E1 302 跳转（免费歌）→ 非 VIP', Promise.resolve(mkRes(true, 'text/html')), false],
      ['E1 200+text/html 无跳转（VIP/失效）→ VIP', Promise.resolve(mkRes(false, 'text/html')), true],
      ['E1 200+audio/* 无跳转（直链音频）→ 非 VIP', Promise.resolve(mkRes(false, 'audio/mpeg')), false],
      ['E1 fetch 拒绝（离线）→ 非 VIP（宁可不删）', Promise.reject(new Error('offline')), false],
    ];
    for (const [name, fetchP, want] of cases) {
      let got = null, err = null;
      try {
        got = await new Promise((resolve) => {
          let timer = setTimeout(() => resolve('超时未回调'), 4000);
          try {
            injected(metUrlFn, () => {}, () => fetchP)('12345', (isVip) => { clearTimeout(timer); resolve(isVip); });
          } catch (e) { clearTimeout(timer); resolve('异常:' + e.message); }
        });
      } catch (e) { err = e.message; }
      check(name, got === want, err ? ('异常:' + err) : ('got=' + JSON.stringify(got)));
    }
  }
  check('E2 时长探测失败仅对 sm_pl_ 歌单批次二次确认＋_vipChecked 去重（源码接线）',
    mpSrc.indexOf("if (m && m.neteaseId && /^sm_pl_/.test(m.id) && !m._vipChecked && findTrack(m.id))") >= 0 &&
    mpSrc.indexOf('confirmVipViaMeting(m.neteaseId') >= 0 &&
    mpSrc.indexOf('removeBatchVipSongs([mm]') >= 0);
  check('E3 v6 fee 路径与探测兜底共用 removeBatchVipSongs',
    mpSrc.indexOf('removeBatchVipSongs(vipTracks)') >= 0 &&
    mpSrc.indexOf('function removeBatchVipSongs(tracks)') >= 0);
  check('E4 已死 meting 镜像 api.i-meto.com 已从歌单源移除（qijieya/injahow 仍在）',
    mpSrc.indexOf('i-meto.com/meting/api') < 0 &&
    mpSrc.indexOf('api.qijieya.cn/meting/?server=netease&type=playlist') >= 0 &&
    mpSrc.indexOf('api.injahow.cn/meting/?type=playlist') >= 0);

  // D1 行为验证：stub 掉 fetch（强制所有解析代理瞬间失败）→ 真点库内短链歌 → 必须有 toast 指引
  const d1 = await evalJs(`(async function(){
    try {
      var app=document.querySelector('.app[data-app="music"]'); if(app)app.click();
      await new Promise(function(r){ setTimeout(r, 300); });
      window.__origFetch = window.fetch;
      window.fetch = function(){ return Promise.reject(new Error('verify-stub-offline')); };
      var row=document.querySelector('.sm-song[data-id="t700short"]');
      if(!row) return 'NO-ROW';
      row.click();
      var t0=Date.now(), toastText='';
      while (Date.now()-t0 < 8000) {
        await new Promise(function(r){ setTimeout(r, 250); });
        var t=document.getElementById('cc-toast');
        toastText=(t&&t.textContent)||'';
        if (toastText.indexOf('解析失败') >= 0) break;
      }
      window.fetch = window.__origFetch;
      return JSON.stringify({ toast: toastText.slice(0, 80) });
    } catch(e) {
      try { window.fetch = window.__origFetch; } catch(x){}
      return 'ERR:' + e.message;
    }
  })()`);
  let d1r = null;
  try { d1r = JSON.parse(d1 || 'null'); } catch (e) {}
  check('D1 短链歌点播放＝解析失败时给出指引 toast（不再无声无反应）',
    !!(d1r && d1r.toast && d1r.toast.indexOf('解析失败') >= 0), d1r ? ('toast=' + d1r.toast) : String(d1).slice(0, 80));

  const errs = await evalJs("(function(){ var e=window.__jsErrors; if(!e)return 'ok'; try{ return e.length ? JSON.stringify(e).slice(0,200) : 'ok'; }catch(x){ return 'ok'; } })()");
  check('A6 全程零未捕获 JS 异常', errs === 'ok', String(errs).slice(0, 120));

  console.log('\n==== 结果：' + (pass + fail) + ' 项检查，' + fail + ' 项失败 ====');
  if (fail) process.exitCode = 1;
  else console.log('全部通过');
} catch (e) {
  console.error('脚本异常:', e.message);
  process.exitCode = 1;
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
