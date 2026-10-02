// ===== 常驻回归：#1325＋#1346 各功能数据「单独导出/导入/清空」的命名空间判据（feature-data.js） =====
// #1346（用户「去把那 9 个也一并收了」）续用同一把尺子：穷举后 9 个「混合锚点」里只有 6 个真的两边都写
//   ——chat／cards／divination／myarc／piggy／games 翻 both；desktop／ask 经查没有任何顶层键（不翻）、
//   feed 本来就是 both（不动）；顺手把 first-match-wins 的旧歪账 `rp-wallet` 从 chat 归位给 gift。
//   C5 组钉的就是这一格：从**第二个联系人桌面**视角顶层那一份必须显形、别桌面的私有键照旧不许进，
//   且 `audit().stranded` 在改判后清零。本文件由 #1325 建立、#1346 续用（同一引擎的常驻回归，不另立新脚本）。
// 用户实报（vivo X200s / 安卓 Edge，且「其他设备型号也有出现」）：
//   「音乐里点击【导出数据】，我只有一个联系人，但是桌面说『本桌面暂无数据』」
// 根因（零机型／零 UA 分支＝判据只取「这一格键落在哪个命名空间」这一个事实）：
//   music-player.js:10-11 把音乐整体钉在 `xy-home-v2:default:`（MUSIC_PREFIX ＋ store=storeFor('default')，
//   文件头注释「音乐数据全局共享——所有桌面共用同一份」)，而 feature-data 登记表写的是 scope:'global'，
//   旧引擎里「global」被等同于「顶层根键」（featureOfKey 的 `if (isTop) return f`）⇒ 真数据对
//   计数／导出／清空三扇门全隐形；导入按 global 一律落到顶层＝模块读不到的地方＝第二次静默丢数据。
//   同一把尺子量出来的同族（本批一并收，见下 C 组）：群聊／备忘录／番茄钟／二级密码锁的键全在顶层根
//   命名空间（各模块注释自证），登记却是 desk ⇒ 只有「当前桌面恰好是 default」时才看得见，第二个联系人
//   桌面上这四行一律「本桌面暂无数据」；跨桌面来消息开关 desk-msg-en 两头都不落（requests=global 只认
//   顶层、desktop 的 /^desk-/ 又排在后面）；fav-ta-* / nick-me-lib* / acc-remind-* 三族键压根没登记。
//   另一族（D 组）：readValues 一次 idbGetMany 读全部键——idb.js 的实现在 4s+4s 后只回**部分**映射，
//   缺的键被当成「没有值」静默丢掉、导出照报成功；而 anchor 一修，几百个 11~33MB 的音频文件体就会直冲
//   内存（JSON.stringify(Blob)＝'{}' 的假数据）。本批按 data-backup.js 已有的那把尺收：分批 80、免读值的
//   尺寸索引（idbBigSize/__big-idx）、文件体不内联且当场说明、没读到值的项如实报数。
// 断言分组：
//   S 组 产物源锚（本批六把新针 ＋ 邻居旧针一字未动）
//   A 组 真实现场＝default 锚点的音乐数据：认领／页面计数／真点【导出数据】出文件
//   B 组 导入落点＝模块读得到的那一格（且不得在顶层造第二份）
//   C 组 联系人桌面上的根键归属（四功能＋desk-msg-en＋三族漏登记）＋ 桌面隔离没被放松
//   C4 组 #1325b 补登记的键族各有其主（26 把键按真落点测）＋ 新宽正则没捞走邻家的键
//   D 组 文件体不内联、超大项不内联、没读到值不静默成功、多键分批读（尺子取调用次数不取耗时）
//   E 组 audit()：nobody／stranded 两个体检口在种子库存上清零
//   Z1 全程零未捕获 JS 异常
// 用法：node tools/verify-1325-feature-data-ns-anchor.mjs
//       MOCHI_SERVE_ROOT=<产物目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
  .filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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
const base = 'http://127.0.0.1:' + server.address().port + '/';

const R = { pass: 0, fail: 0, lines: [] };
const ok = (n, c, d) => { c ? R.pass++ : R.fail++; R.lines.push((c ? '  ✅ ' : '  ❌ ') + n + (d ? ' — ' + d : '')); };

// ---------- S 组：产物源锚 ----------
{
  const fd = (() => { try { return readFileSync(join(root, 'js/feature-data.js'), 'utf8'); } catch (e) { return ''; } })();
  ok('S0 被测产物里有 feature-data（js/feature-data.js 非空）', fd.length > 3000, 'len=' + fd.length);
  ok('S1 共享命名空间判据在位（顶层＋登记表点名的那一格，不再等同顶层）',
    fd.includes("function isSharedNs(f, info) { return info.cid === null || (!!f.anchor && info.cid === f.anchor); }"));
  ok('S2 共享落点由登记表 anchor 决定（缺省顶层）',
    fd.includes("function sharedNsOf(f) { return f.anchor ? G + ':' + f.anchor : G; }"));
  ok('S3 音乐登记带 anchor:default（＝music-player 的 storeFor(\'default\') 事实搬进登记表）',
    /id: 'music'[^}]*scope: 'global', anchor: 'default'/.test(fd));
  ok('S4 导入落点走锚点（删＝导进模块读不到的顶层＝第二次静默丢数据）',
    fd.includes("if (f.scope === 'global' || (f.scope === 'both' && info.cid === null)) return { ns: sharedNsOf(f), suffix: info.suffix };"));
  ok('S5「没有数据」的措辞跟命名空间走（共享功能不再说「本桌面」）',
    fd.includes("function whereWord(f) { return f.scope === 'desk' ? '本桌面' : '本机'; }"));
  ok('S6 文件体不内联的家族尺在位（与 data-backup 的 MUSIC_KEY_RE 同族；Blob 项按 .size 记账）',
    fd.includes('/^music-file:/') && fd.includes("if (typeof Blob !== 'undefined' && v instanceof Blob) { bin.push(k); binBytes += v.size || 0; return; }"));
  ok('S7 取值分批＋缺项记账在位（一次读全部＝超时只回部分映射＝静默丢大项）',
    fd.includes('var unit = keys.slice(i, i + READ_BATCH)') && fd.includes("Object.defineProperty(out, 'missing', { value: missing, enumerable: false });"));
  ok('S8 audit() 体检口在位（nobody/stranded 两把尺，防下一批再脱节）',
    fd.includes('stranded: fromDefault') && fd.includes('nobody: nobody'));
  ok('S9 邻居旧针一字未动（#668b 桌面隔离／#668c 导入落桌面／#668d 媒体池随值／#1162a 清单退避）',
    fd.includes("if (info.cid === cid || (isTop && cid === 'default')) return f;")
      && fd.includes("return { ns: G + ':' + cid, suffix: info.suffix };")
      && fd.includes('var media = mediaRefsOf(values);')
      && fd.includes('setTimeout(function () { res(window.idbListKeys()); }, 800);'));
}

// ---------- headless ----------
const userDir = join(process.env.TEMP || '/tmp', 'mochi-v1325-' + Date.now());
const cp = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + userDir,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=390,844', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = ''; const t = setTimeout(() => reject(new Error('DevTools 端口未就绪')), 20000);
  cp.stderr.on('data', (d) => { buf += d.toString(); const m = buf.match(/ws:\/\/[^\s]+/); if (m) { clearTimeout(t); resolve(m[0]); } });
  cp.on('exit', () => reject(new Error('Chrome 提前退出')));
});
const dbg = wsUrl.replace(/^ws:\/\/([^/]+)\/.*$/, 'http://$1');
const targets = await (await fetch(dbg + '/json/list')).json();
let pageTarget = targets.find((t) => t.type === 'page') || await (await fetch(dbg + '/json/new?about:blank')).json();
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
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
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
(function(){ try{
  window.__toasts=[]; window.__modals=[];
  function push(m){ m=String(m||'').trim(); if(!m) return; var a=window.__toasts; if(a[a.length-1]!==m) a.push(m); if(a.length>40) a.shift(); }
  function wrapToast(){ try{ if(typeof window.toast==='function'&&!window.toast.__cap){var r=window.toast,f=function(m){push(m);return r.apply(null,arguments)};f.__cap=1;window.toast=f;} }catch(e){} }
  // 弹窗文案一律从 openModal 的入参里取，不读 #modal-static：备份提醒／更新公告自己也会开一个
  // openModal（pwa.js 的 backup-remind 与公告条），那个模态盖在屏上时读到的是别人的文案（实测假红）。
  function wrapModal(){ try{ if(typeof window.openModal==='function'&&!window.openModal.__mcap){
    var rm=window.openModal, fm=function(t,v,cb,o){ try{ window.__modals.push({title:String(t||''), text:String((o&&o.staticText)||'')}); if(window.__modals.length>24) window.__modals.shift(); }catch(e){} return rm.apply(null,arguments); };
    fm.__mcap=1; window.openModal=fm; } }catch(e){} }
  setInterval(function(){ wrapToast(); wrapModal();
    try{ var el=document.getElementById('cc-toast'); if(el&&el.classList.contains('show')) push(el.textContent); }catch(e){} },120);
  if (sessionStorage.getItem('__p1325-errors') === null) sessionStorage.setItem('__p1325-errors','[]');
  var errs = JSON.parse(sessionStorage.getItem('__p1325-errors')||'[]');
  window.addEventListener('error', function(ev){ errs.push(String(ev.message||ev.error)+' @ '+String(ev.filename||'').split('/').pop()+':'+ev.lineno); sessionStorage.setItem('__p1325-errors', JSON.stringify(errs.slice(0,6))); });
  window.addEventListener('unhandledrejection', function(ev){ errs.push('rej:'+String(ev.reason)); sessionStorage.setItem('__p1325-errors', JSON.stringify(errs.slice(0,6))); });
}catch(e){} })();` });

const nav = async () => { await send('Page.navigate', { url: base }); await sleep(2600); };
const dismiss = () => evalJs("(function(){try{var s=document.getElementById('splash');if(s)s.remove();var q=document.getElementById('qa-mask');if(q)q.remove();var c=document.getElementById('splash-mandatory-enter');if(c)c.click();}catch(e){}return 1})()");
const ready = async () => { for (let i = 0; i < 30; i++) { if (await evalJs("(function(){return !!(window.mochiFeatureData&&window.activeStore&&window.storeFor)})()").catch(() => false)) return true; await sleep(300); } return false; };
// 全场清扫：LS 的 xy-home-v2:* ＋ IDB 同族键 ＋ 写日志（否则重启回放把种子种回来＝串场假数据）
// ⚠️ 夹具纪律：xyStore 的写日志标记是 150ms 防抖落盘的（idb.js WRJ_MARK_FLUSH_MS），删完立刻走人
//    会被那一发迟到的 flush 种回去（实测：D 组导出文件里混进上一场的 default:music-*）。
//    所以删→等→再删一遍，最后交给调用方 reload。
const wipeOnce = () => evalJs(`(function(){
    var kill=[]; try{ for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i); if(k&&k.indexOf('xy-home-v2:')===0) kill.push(k);} }catch(e){}
    try{ kill.forEach(function(k){ localStorage.removeItem(k); }); }catch(e){}
    return kill.length;
  })()`);
const wipe = async () => {
  await wipeOnce();
  await evalJs(`(function(){ return (window.idbGetAllKeys?window.idbGetAllKeys():Promise.resolve([])).then(function(a){
      var mk=(a||[]).filter(function(k){ return /^xy-home-v2:/.test(String(k)); });
      return Promise.all(mk.map(function(k){ return window.idbDelete(k).catch(function(){}); })).then(function(){ return mk.length; });
    }) })()`, true);
  await sleep(700);
  await wipeOnce();
  await evalJs(`(function(){ return (window.idbGetAllKeys?window.idbGetAllKeys():Promise.resolve([])).then(function(a){
      var mk=(a||[]).filter(function(k){ return /^xy-home-v2:/.test(String(k)); });
      return Promise.all(mk.map(function(k){ return window.idbDelete(k).catch(function(){}); })).then(function(){ return mk.length; });
    }) })()`, true);
  await sleep(250);
};
// 开音乐页（#1311 夹具课：手工摘 .page 的 hidden 会让页面自己的渲染根本没跑）
const openMusic = async () => {
  const via = await evalJs("(function(){var a=document.querySelector('.app[data-app=\"music\"]');if(a){a.click();return 'icon'}return 'none'})()");
  await sleep(1600);
  return via + ':' + await evalJs("(function(){var p=document.getElementById('page-music');return p?!p.hidden:false})()");
};
// 等卡上那行计数算完（「统计中…」→「N 项 · …」）。只等卡挂上不够：计数是异步的
// （allKeys → 分批取值 → 汇总），抢在算完之前读就会把正常状态判成失败——实测「一红两绿」的抖源。
const waitCount = async (ms) => {
  const limit = Date.now() + (ms || 12000);
  for (;;) {
    const t = await evalJs("(function(){var e=document.querySelector('#page-music [data-fcount]');return e?e.textContent:''})()").catch(() => '');
    if (/^\d+ 项/.test(String(t))) return true;
    if (Date.now() > limit) return false;
    await sleep(300);
  }
};
// 等音乐页那张数据卡真的挂上（mountFdBars 在 800ms／2500ms 与 mochi-restore-done 上各跑一次，
// 数据回填慢时会更晚；不等的就会把「卡还没挂」读成「导出失败」＝实测一轮红、两轮全绿的抖动源）
const waitFdBar = async (ms) => {
  const limit = Date.now() + (ms || 10000);
  for (;;) {
    const okBar = await evalJs("(function(){return !!(document.querySelector('#page-music [data-fbar=\\\"music\\\"] [data-op=\\\"export\\\"]'))})()").catch(() => false);
    if (okBar) return true;
    if (Date.now() > limit) return false;
    await sleep(300);
  }
};
// 导出驱动：桩 mochiExportFile（只证键清单/载荷/文案，不触发真下载），真点功能页数据卡上的【导出数据】
const clickCardExport = async (stub) => evalJs(`(function(){
  try{
    window.__fd={calls:0,json:'',modal:'',toastBase:(window.__toasts||[]).length};
    window.mochiExportFile=function(j,f){ window.__fd.calls++; window.__fd.json=String(j); return Promise.resolve('ok'); };
    ${stub || ''}
    var b=document.querySelector('#page-music [data-fbar="music"] [data-op="export"]');
    if(!b) return 'NOBAR';
    b.click(); return 1;
  }catch(e){ return 'ERR:'+e; }
})()`);
const finishExport = async () => {
  const snap = `(function(){var m=document.getElementById('modal-mask');var mm=(window.__modals||[]).filter(function(x){return /^导出「/.test(x.title)});
    return {open:!!(m&&!m.hidden), modal:mm.length?mm[mm.length-1].text:'', calls:(window.__fd&&window.__fd.calls)||0,
      json:(window.__fd&&window.__fd.json)||'', toasts:(window.__toasts||[]).slice((window.__fd&&window.__fd.toastBase)||0).join(' | ')};})()`;
  for (let i = 0; i < 30; i++) {
    const r = await evalJs(snap).catch(() => null);
    if (!r) { await sleep(200); continue; }
    if (r.calls > 0) return r;
    if (r.open) {
      // 只确认自己那一个模态：备份提醒／回收提示／开屏公告同样走 openModal，撞上就把它们关掉再继续等
      const who = await evalJs("(function(){var ms=(window.__modals||[]);for(var i=ms.length-1;i>=0;i--){if(ms[i].title.indexOf('导出「')===0)return ms[i].title}var t=document.getElementById('modal-title');return t?t.textContent:''})()").catch(() => '');
      if (String(who).indexOf('导出「') !== 0) {
        await evalJs("(function(){var b=document.getElementById('modal-cancel')||document.getElementById('modal-ok');if(b)b.click();return 1})()");
        await sleep(400); continue;
      }
      await evalJs("(function(){var b=document.getElementById('modal-ok')||document.querySelector('#modal-mask button');if(b)b.click();return 1})()");
      await sleep(600);
      const r2 = await evalJs(snap).catch(() => null);
      return r2 || r;
    }
    if (r.toasts) return r;
    await sleep(200);
  }
  return await evalJs(snap).catch(() => null);
};
const claim = (key, cid) => evalJs(`(function(){ try{ window.__activeCid=${JSON.stringify(cid)}; var f=window.mochiFeatureData.featureOfKey(${JSON.stringify(key)},${JSON.stringify(cid)}); return f?f.id:null; }catch(e){ return 'ERR:'+e } })()`);
const seedViaModule = (ns, extra) => evalJs(`(function(){
  var s=window.xyStore(${JSON.stringify(ns)});
  s.set('music-playlists', JSON.stringify([{ id:'pl1', name:'锚点歌单', createdAt:1 }]));
  s.set('music-library', JSON.stringify([{ id:'sm_1', name:'锚点歌曲.mp3', source:'local', duration:1 }]));
  s.set('music-my-history', JSON.stringify([{ id:'h1', trackId:'sm_1', trackName:'锚点歌曲' }]));
  ${extra || ''}
  var ls=[]; try{ for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i); if(k&&k.indexOf('music')>=0) ls.push(k)} }catch(e){}
  return ls;
})()`);

// ---------- A 组：真实现场（用户手机上音乐就落在 xy-home-v2:default:） ----------
await nav(); await dismiss();
ok('A0 应用壳就绪（mochiFeatureData/storeFor 可用）', await ready() === true);
await wipe();
await nav(); await dismiss(); await ready();
const seededA = await seedViaModule('xy-home-v2:default');
ok('A0b 夹具前置：种子真落在 default 命名空间（模块自己那格）', /:default:music-playlists/.test(String(seededA)), String(seededA).slice(0, 120));
await nav(); await dismiss(); await ready();
{
  const keys = await evalJs("window.mochiFeatureData.keysOf('music').then(function(k){return JSON.stringify(k)})", true);
  const arr = JSON.parse(keys || '[]');
  ok('A1 keysOf(音乐) 认得 default 锚上的键（红侧＝一条都没有）',
    arr.some((k) => k === 'xy-home-v2:default:music-playlists') && arr.some((k) => k === 'xy-home-v2:default:music-library'),
    'n=' + arr.length + ' ' + arr.slice(0, 3).join(','));
  ok('A2 featureOfKey 直接判定 default:music-playlists 归音乐（红侧＝null）',
    await claim('xy-home-v2:default:music-playlists', 'default') === 'music');
  const howOpened = await openMusic();
  await waitCount();
  const bar = await evalJs("(function(){var p=document.getElementById('page-music');if(!p)return 'NOPAGE';var el=p.querySelector('[data-fcount=\"music\"]');return el?el.textContent:'NOEL'})()");
  ok('A2b 音乐页数据卡那一行报得出项数（红侧＝「本桌面暂无数据」＝用户原话）',
    /^\d+ 项/.test(String(bar)), 'bar=' + bar + ' 进页=' + howOpened);
}
{
  await waitFdBar();
  const got = await clickCardExport('');
  const res = await finishExport();
  let payload = null; try { payload = JSON.parse(res && res.json || 'null'); } catch (e) {}
  ok('A3 真点【导出数据】出文件（红侧＝toast「在本桌面还没有数据」且零文件）',
    got === 1 && !!(res && res.calls > 0) && !!(payload && payload.feature === 'music'),
    res ? ('calls=' + res.calls + ' toasts=' + String(res.toasts).slice(0, 70)) : '-');
  ok('A4 文件里就是模块读得到的那几把键',
    !!(payload && payload.keys && payload.keys['xy-home-v2:default:music-playlists'] && payload.keys['xy-home-v2:default:music-library']),
    payload ? Object.keys(payload.keys).join(',') : '-');
  ok('A4b 弹窗作用范围如实说这一份在默认桌面命名空间',
    !!(res && /所有桌面共用一份/.test(String(res.modal)) && /default/.test(String(res.modal))), String(res && res.modal).slice(0, 90));
  global.__A_FILE = payload ? JSON.stringify(payload) : '';
}

// ---------- B 组：导入落点＝模块读得到的那一格 ----------
await wipe();
await nav(); await dismiss(); await ready();
{
  // 回灌用的文件＝A 组真导出的那份（HEAD 上 A 组出不了文件，退回到同形状的等价夹具）；
  // 再把歌单名换成一个只存在于文件里的标记——否则「导入后模块读得到」会被上一场残留的种子
  // 撞绿（xyStore 有内存缓存，B1 拿名字做标记才证明这一发值确实来自文件）。
  const FALLBACK = JSON.stringify({ app: 'mochi-feature-data', version: '1.0', feature: 'music', featureName: '音乐', cid: 'default',
    keys: { 'xy-home-v2:default:music-playlists': JSON.stringify([{ id: 'pl1', name: '锚点歌单', createdAt: 1 }]),
      'xy-home-v2:default:music-library': JSON.stringify([{ id: 'sm_1', name: '锚点歌曲.mp3', source: 'local', duration: 1 }]) } });
  const aFile = global.__A_FILE || '';
  const file = String(aFile || FALLBACK).replace(/锚点歌单/g, '回灌标记歌单');
  ok('B0 夹具前置：回灌文件在场（A 组那份，或同形状等价夹具）',
    /xy-home-v2:default:music-playlists/.test(file) && /回灌标记歌单/.test(file), aFile ? '来自 A 组导出 len=' + aFile.length : 'A 组没出文件＝用等价夹具');
  const st = await evalJs(`(function(){
    window.__mochiFdNoReload = true;
    var f = new File([${JSON.stringify(file)}], 'music.json', { type: 'application/json' });
    window.mochiFeatureData.importFile('music', f);
    return 1;
  })()`);
  await sleep(800);
  await evalJs("(function(){var p=document.querySelector('#modal-pills .pill');if(p)p.click();var b=document.getElementById('modal-ok');if(b)b.click();return 1})()");
  await sleep(900);
  const landed = await evalJs(`(function(){
    var d=window.xyStore('xy-home-v2:default'), r=window.xyStore('xy-home-v2');
    var lsRoot=null, lsDef=null;
    try{ lsRoot=localStorage.getItem('xy-home-v2:music-playlists'); }catch(e){}
    try{ lsDef=localStorage.getItem('xy-home-v2:default:music-playlists'); }catch(e){}
    return JSON.stringify({ def: d.get('music-playlists') || '', root: r.get('music-playlists') || '', lsRoot: lsRoot||'', lsDef: lsDef||'', st: ${JSON.stringify(st)} });
  })()`);
  const L = JSON.parse(landed || '{}');
  ok('B1 导入后模块自己那一格真读得到**文件里**的歌单（红侧＝落到顶层，屏上什么都没有）',
    /回灌标记歌单/.test(String(L.def || '')), 'default=' + String(L.def).slice(0, 40));
  ok('B2 顶层不再被造出第二份（红侧＝xy-home-v2:music-playlists 凭空多出来，且模块读不到）',
    !L.root && !L.lsRoot && !/回灌标记/.test(String(L.root || '')), 'storeRoot=' + JSON.stringify(L.root) + ' lsRoot=' + JSON.stringify(L.lsRoot));
  ok('B2b 文件被认成音乐的数据且落了值（红侧＝JSON 解析失败＝一项都没写）',
    Number(L.st) === 1 && /回灌标记歌单/.test(String(L.def || '') + String(L.root || '')), JSON.stringify({ st: L.st }));
}

// ---------- C 组：scope 纠正（联系人桌面上根键可见）＋ 隔离没放松 ----------
{
  const rootClaims = {
    'xy-home-v2:group-chat-msgs': 'gc',
    'xy-home-v2:gc-groups': 'gc',
    'xy-home-v2:memo-app-items': 'memo',
    'xy-home-v2:pomo-cfg': 'pomo',
    'xy-home-v2:applock-pin': 'lock',
    'xy-home-v2:cardlock-state': 'lock',
    'xy-home-v2:desk-msg-en': 'requests'
  };
  const seen = {};
  for (const k of Object.keys(rootClaims)) seen[k] = await claim(k, 'czzzzz');
  const wrong = Object.keys(rootClaims).filter((k) => seen[k] !== rootClaims[k]);
  ok('C1 联系人桌面视角下，模块真写在顶层的键归到本功能（红侧＝四功能＋来消息开关一律 null）',
    wrong.length === 0, wrong.map((k) => k + '→' + seen[k]).join(' | '));
  const gaps = {
    'xy-home-v2:czzzzz:fav-ta-msg': 'fav',
    'xy-home-v2:czzzzz:nick-me-lib': 'interact',
    'xy-home-v2:czzzzz:acc-remind-on': 'accounting'
  };
  const seen2 = {};
  for (const k of Object.keys(gaps)) seen2[k] = await claim(k, 'czzzzz');
  const wrong2 = Object.keys(gaps).filter((k) => seen2[k] !== gaps[k]);
  ok('C2 三族没登记的键现在有人管（红侧＝fav-ta-*/nick-me-lib*/acc-remind-* 全 null）',
    wrong2.length === 0, wrong2.map((k) => k + '→' + seen2[k]).join(' | '));
  // 隔离没放松：别桌面的键仍然不进当前桌面
  const iso = {
    a: await claim('xy-home-v2:default:chat-msgs', 'czzzzz'),
    b: await claim('xy-home-v2:default:garden-data', 'czzzzz'),
    c: await claim('xy-home-v2:czzzzz:chat-msgs', 'czzzzz'),
    d: await claim('xy-home-v2:czzzzz:music-playlists', 'czzzzz'),
    e: await claim('xy-home-v2:default:music-playlists', 'czzzzz'),
    f: await claim('xy-home-v2:media:0123456789abcdef0123456789abcdef', 'default'),
    g: await claim('xy-home-v2:font-blob-0123456789abcdef0123456789abcdef', 'default')
  };
  ok('C3 桌面隔离没被放松（别桌面同名键不进当前桌面）', iso.a === null && iso.b === null && iso.c === 'chat',
    JSON.stringify({ a: iso.a, b: iso.b, c: iso.c }));
  ok('C3b anchor 只放宽到「共享锚」那一格：别的联系人桌面同名键仍不认，共享锚从任何桌面都认（第二桌面也能导音乐＝本批要的那一半）',
    iso.d === null && iso.e === 'music', JSON.stringify({ otherDesk: iso.d, sharedFromOther: iso.e }));
  ok('C3c 媒体池/字体包照旧不被任何功能认领（#668a 契约未动）', iso.f === null && iso.g === null,
    JSON.stringify({ m: iso.f, fb: iso.g }));
}

// ---------- C4 组：#1325b 补登记的键族（审计出的「没人认领」清单）＋ 没抢邻居 ----------
{
  // 每把键都按它**真实的落点**测（证据写进 feature-data.js 的行内批注）：
  // 顶层根键＝chat-settings.js:2691 / bg-keep.js:1150 / personalize.js:4910 / call.js:447；其余走 activeStore。
  const own = {
    'xy-home-v2:default:ask-think-secs': 'chat',
    'xy-home-v2:group-chat-enabled': 'gc',
    'xy-home-v2:czzzzz:group-chat-enabled': 'gc',
    'xy-home-v2:default:mc-enabled': 'cards',
    'xy-home-v2:default:mc-prob-heart': 'cards',
    'xy-home-v2:default:mh-heart': 'cards',
    'xy-home-v2:default:rc-enabled': 'cards',
    'xy-home-v2:default:partner-gender': 'identity',
    'xy-home-v2:default:memo': 'calendar',
    'xy-home-v2:default:today-mood': 'calendar',
    'xy-home-v2:default:ckq-last-id': 'checkin',
    'xy-home-v2:default:checkin': 'checkin',
    'xy-home-v2:default:ti-last-id': 'ask',
    'xy-home-v2:default:tabbar-blur': 'desktop',
    'xy-home-v2:default:tab-icon-home': 'desktop',
    'xy-home-v2:default:divination-desk-pin': 'desktop',
    'xy-home-v2:default:group-chat-desk-pin': 'desktop',
    'xy-home-v2:bg-keepalive': 'sys',
    'xy-home-v2:bg-notify': 'sys',
    'xy-home-v2:default:bg-notify': 'sys',
    'xy-home-v2:theme-mode': 'sys',
    'xy-home-v2:accent-color': 'sys',
    'xy-home-v2:ver-update-notify': 'sys',
    'xy-home-v2:call-active': 'call',
    'xy-home-v2:default:call-mini-pos': 'call',
    'xy-home-v2:default:call-bg': 'call',
    'xy-home-v2:czzzzz:call-half-bg': 'call'
  };
  const seen = {};
  for (const k of Object.keys(own)) seen[k] = await claim(k, k.includes(':czzzzz:') ? 'czzzzz' : (k.includes(':default:') ? 'default' : 'czzzzz'));
  const wrong = Object.keys(own).filter((k) => seen[k] !== own[k]);
  ok('C4 审计出的「没人认领」键现在各有其主（红侧＝除 call 行外全部 null）',
    wrong.length === 0, wrong.map((k) => k + '→' + seen[k]).join(' | '));
  ok('C4b 顶层根键的共享项从**联系人桌面**视角也认得（theme-mode／群聊开关／保活）',
    seen['xy-home-v2:theme-mode'] === 'sys' && seen['xy-home-v2:group-chat-enabled'] === 'gc' && seen['xy-home-v2:bg-keepalive'] === 'sys',
    JSON.stringify({ t: seen['xy-home-v2:theme-mode'], g: seen['xy-home-v2:group-chat-enabled'], k: seen['xy-home-v2:bg-keepalive'] }));
  // 不抢邻居：新加的宽正则（/^mc-/ /^mh-/ /^rc-/ /^memo$/ /^today-mood$/ /^checkin$/ /^tabbar-/ /-desk-pin$/ /^call-/）
  // 都不许把邻家已有的键捞走——first match wins，捞走就是「清空 A 顺手删了 B」。
  const keep = {
    'xy-home-v2:default:records-call-last': 'records',
    'xy-home-v2:default:rcard-prob': 'cards',
    'xy-home-v2:default:memo-app-items': 'memo',
    'xy-home-v2:default:memo-2026-09-17': 'calendar',
    'xy-home-v2:default:today-mood-2026-09-17': 'calendar',
    'xy-home-v2:default:ck-off-1': 'checkin',
    'xy-home-v2:default:desk-image-src': 'desktop',
    'xy-home-v2:default:chat-msgs': 'chat',
    'xy-home-v2:default:mood-diary': 'mood',
    'xy-home-v2:default:records-coin-ledger': 'accounting'
  };
  const seen2 = {};
  for (const k of Object.keys(keep)) seen2[k] = await claim(k, 'default');
  const stolen = Object.keys(keep).filter((k) => seen2[k] !== keep[k]);
  ok('C4c 新正则没捞走邻家的键（records-call-last/rcard-prob/memo-app-/today-mood<日期>/ck-off-/mood-diary 原位）',
    stolen.length === 0, stolen.map((k) => k + ':' + keep[k] + '→' + seen2[k]).join(' | '));
  ok('C4d bg-keepalive 已离开「桌面布局与美化」（清空美化不再顺手关掉后台保活）',
    seen['xy-home-v2:bg-keepalive'] === 'sys' && seen['xy-home-v2:default:bg-notify'] === 'sys',
    JSON.stringify({ top: seen['xy-home-v2:bg-keepalive'], desk: seen['xy-home-v2:default:bg-notify'] }));
  await evalJs("(function(){ window.__activeCid = 'default'; return 1 })()");
}

// ---------- C5 组：#1346 六个「混合锚点」功能改判后，从联系人桌面看得见顶层那一份 ----------
{
  const rootClaims = {
    'xy-home-v2:my-emoji-groups': 'chat',
    'xy-home-v2:emoji-recent': 'chat',
    'xy-home-v2:hide-ta-sticker': 'chat',
    'xy-home-v2:chat-beauty-schemes': 'chat',
    'xy-home-v2:chat-panel-prewarm': 'chat',
    'xy-home-v2:cc-groups-public': 'cards',
    'xy-home-v2:cc-groups-public-off': 'cards',
    'xy-home-v2:dict-custom-quotes': 'cards',
    'xy-home-v2:rp-wallet': 'gift',
    'xy-home-v2:divine-faces-idx': 'divination',
    'xy-home-v2:divine-face-onebased': 'divination',
    'xy-home-v2:myarc-shared': 'myarc',
    'xy-home-v2:myarc-cur': 'myarc',
    'xy-home-v2:piggy-log': 'piggy',
    'xy-home-v2:piggy-coin-prob': 'piggy',
    'xy-home-v2:au-sound': 'games'
  };
  const seen = {};
  for (const k of Object.keys(rootClaims)) seen[k] = await claim(k, 'czzzzz');   // 全部从「第二个联系人桌面」视角判
  const wrong = Object.keys(rootClaims).filter(k => seen[k] !== rootClaims[k]);
  ok('C5 六行改判后，顶层那一份从联系人桌面也认得（红侧＝除 rp-wallet 外全部 null）',
    wrong.length === 0, wrong.map(k => k + '→' + seen[k]).join(' | '));
  const iso2 = {
    a: await claim('xy-home-v2:default:chat-msgs', 'czzzzz'),      // 别人的桌面数据仍不许进来
    b: await claim('xy-home-v2:czzzzz:chat-msgs', 'czzzzz'),
    c: await claim('xy-home-v2:default:garden-data', 'czzzzz'),
    d: await claim('xy-home-v2:default:my-emoji-groups', 'czzzzz') // default 桌面上的 per-desktop 键也不该被当成共享
  };
  ok('C5b 改判没把隔离放松（default 桌面的私有键不进联系人桌面视角）',
    iso2.a === null && iso2.b === 'chat' && iso2.c === null && iso2.d === null, JSON.stringify(iso2));
  ok('C5c rp-wallet 归位 gift（旧表挂 chat 名下，chat 一翻 both 就会把钱抢进聊天）',
    seen['xy-home-v2:rp-wallet'] === 'gift', JSON.stringify({ rp: seen['xy-home-v2:rp-wallet'] }));
  await evalJs("(function(){ window.__activeCid='default'; var s=window.xyStore('xy-home-v2'); s.set('my-emoji-groups', JSON.stringify([{g:'公用一组'}])); s.set('cc-groups-public', JSON.stringify([{g:'公用字卡组'}])); return 1 })()");
  await sleep(600);
  const au = JSON.parse(await evalJs('window.mochiFeatureData.audit().then(function(r){return JSON.stringify({s:r.stranded,n:r.nobody,c:r.cid})})', true) || '{}');
  ok('C5d audit().stranded 在改判后清空（这些顶层键不再「换个桌面才认」）',
    !(au.s || []).some(k => /my-emoji-groups|cc-groups-public|chat-beauty-schemes|divine-|myarc-|piggy-|au-sound/.test(k)),
    'cid=' + au.c + ' stranded=' + JSON.stringify((au.s || []).slice(0, 3)));
}

// ---------- D 组：文件体／超大项／缺项／分批（对照场景把键放在顶层，HEAD 也看得见，才有差分） ----------
await wipe();
await nav(); await dismiss(); await ready();
await seedViaModule('xy-home-v2', "s.set('music-file:sm_body', 'data:audio/mpeg;base64,AAABBBB'.repeat(200));");
// ⚠️ 种完**不再重载**：music-player 的 mergeDesksMusic() 会在开屏把「非 default 那一份」的音乐键并进
//    default 并清掉源键——是否发生取决于上一场有没有留下 music-merge-done，把这一步插进夹具里，
//    D1 就会在「键还在」与「键被搬走」之间抖（实测同一份产物两次跑出 44/1 与 45/0 两种读数）。
//    导出引擎读的是实时清单（allKeys 走 LS＋IDB），不需要重载来「让模块看见」我的种子。
{
  await waitFdBar();
  const res = await finishExport2(await clickCardExport(''));
  let payload = null; try { payload = JSON.parse(res.json || 'null'); } catch (e) {}
  const keys = payload && payload.keys ? Object.keys(payload.keys) : [];
  ok('D1 音频文件体不进单功能导出（红侧＝文件里出现 music-file 项，值还是 Blob 字符串化出来的空壳）',
    keys.length > 0 && !keys.some((k) => /music-file:/.test(k)), keys.join(','));
  ok('D1b 当场说明文件体带不走、并指路整机备份', /音频文件体/.test(String(res.modal)) && /整机备份|设置 → 通用/.test(String(res.modal)),
    String(res.modal).slice(0, 120));
}
{
  // 超大普通键：拿 idbBigSize 那把尺（桩成 40MB）——引擎信的就是它，与 data-backup 同源
  await waitFdBar();
  const res = await finishExport2(await clickCardExport('window.idbBigSize=function(k){ return /music-library/.test(k) ? 41943040 : (window.__realBig?window.__realBig(k):null); };'));
  let payload = null; try { payload = JSON.parse(res.json || 'null'); } catch (e) {}
  const keys = payload && payload.keys ? Object.keys(payload.keys) : [];
  ok('D2 超单键上限的普通键不内联（红侧＝一次读全部＝堆爆或超时静默丢）',
    !keys.some((k) => /music-library/.test(k)), keys.join(','));
  ok('D2b 体积过大如实报在弹窗里', /体积过大/.test(String(res.modal)), String(res.modal).slice(0, 120));
}
{
  // 真机形态之一：有的键只在 IDB（>200KB 的值不落 LS 副本，见 idb.js LS_BIG_LIMIT），这一发批量读回空
  // 映射＝4s+4s 超时的等价形态。旧写法把缺的当「没有」静默丢掉，文件照出、toast 照报成功。
  // ⚠️ 夹具必须自己把两条腿铺实：只往 xyStore 种键是不够的——开屏的桌面归属迁移会把顶层键搬进
  //    default 命名空间（实测 D3 一度因此变成「所有键都读不到」＝把 D4 的症状当成 D3 的读数）。
  //    这里一条走 localStorage（保证读得到）、一条走 IDB-only（保证读不到），谁该在文件里一目了然。
  await evalJs(`(function(){
    try{ localStorage.setItem('xy-home-v2:music-smallvisible', JSON.stringify([{ id:'ok1', name:'读得到的那把' }])); }catch(e){}
    window.xyStore('xy-home-v2:default').set('music-bighidden', new Array(300001).join('x'));
    return 1;
  })()`);
  await sleep(900); // 等 xyStore 的 IDB 写落盘（大值不落 LS，只能从 IDB 清单里见到）
  await waitFdBar();
  const res = await finishExport2(await clickCardExport(`window.idbGetMany=function(){ return Promise.resolve({}); };
    var rs=window.xyStore; window.xyStore=function(){ try{ var st=rs.apply(null, arguments); return { get: function(){ return null; }, set: st.set, remove: st.remove }; }catch(e){ return { get: function(){ return null; }, set: function(){}, remove: function(){} }; }; }`));
  let payload = null; try { payload = JSON.parse(res.json || 'null'); } catch (e) {}
  const keys = payload && payload.keys ? Object.keys(payload.keys) : [];
  ok('D3 读不到值的项如实报数、且不出在文件里（红侧＝静默丢掉＋照报成功）',
    Number(res.calls) === 1 && /没读到值/.test(String(res.modal)) && !keys.some((k) => /music-bighidden/.test(k)),
    'calls=' + res.calls + ' keys=' + keys.length + ' :: ' + String(res.modal).slice(-120));
  ok('D3b 其余读得到的项照常出文件（缺项不等于全丢）',
    keys.some((k) => /music-smallvisible/.test(k)), keys.slice(0, 4).join(' , '));
}
{
  // 一项值都没读到：绝不出具「看起来成功」的空文件（#1162 同一课＝读不到 ≠ 没有）。
  // 场景挑「心情日记」：音乐那一族键 App 自己开屏就会写 music-merge-done／music-default-done（LS 读得到），
  // 拿它验「全部读不到」会被这些自发的小键破功（实测假绿过一次方向相反的版本）。
  await wipe();
  await nav(); await dismiss(); await ready();
  await evalJs(`(function(){ window.xyStore('xy-home-v2:default').set('mood-diary', new Array(300001).join('x')); return 1 })()`);
  await sleep(900);
  const res = await finishExport2(await evalJs(`(function(){
    window.__fd={calls:0,json:'',modal:'',toastBase:(window.__toasts||[]).length};
    window.mochiExportFile=function(j,f){ window.__fd.calls++; window.__fd.json=String(j); return Promise.resolve('ok'); };
    window.idbGetMany=function(){ return Promise.resolve({}); };
    var rs=window.xyStore; window.xyStore=function(){ var st=rs.apply(null, arguments); return { get: function(){ return null; }, set: st.set, remove: st.remove }; };
    window.mochiFeatureData.exportFeature('mood');
    return 1;
  })()`));
  ok('D4 一项值都没读到就不出文件，并当场说明（红侧＝出具一份空文件还报成功）',
    Number(res.calls) === 0 && /没读到|没有出具文件/.test(String(res.toasts || res.modal)),
    'calls=' + res.calls + ' :: ' + String(res.toasts || res.modal).slice(0, 110));
}
{
  await nav(); await dismiss(); await ready();   // 上一组的 xyStore/idbGetMany 桩随重载作废
  // 分批：造 200 把小键。种子刻意落在**顶层根锚点**——那是 HEAD 也看得见的那一格，
  // 两侧都会真走一次导出取值，尺子量的才是「一次读全部 vs 分批读」这一件事本身
  // （落在 default 锚上时 HEAD 压根不读，读数会变成「0 次」＝把本批的 A 组症状当成 D5 的证据）。
  const cnt = await evalJs(`(function(){
    var s=window.xyStore('xy-home-v2'); for(var i=0;i<200;i++) s.set('music-bulk-'+i, JSON.stringify([i]));
    var n=0, real=window.idbGetMany;
    // 只数「这一发导出自己的批量」：App 自己也有 idbGetMany 的用户（写日志合并 #907、媒体池等），
    // 不加这道过滤就会把后台活动计进来——实测在 HEAD 上因此假绿过一次（尺子必须只量被测那一次调用）。
    window.idbGetMany=function(ks){ if (String(ks || []).indexOf('music-bulk-') >= 0) n++; return real.apply(null, arguments); };
    window.mochiFeatureData.exportFeature('music');
    return new Promise(function(res){ setTimeout(function(){ res(n); }, 1500); });
  })()`, true);
  ok('D5 键多时分批读（idbGetMany 被调用 >1 次；红侧＝一整坨事务只调 1 次）', Number(cnt) > 1, 'idbGetMany 调用 ' + cnt + ' 次');
}

// ---------- E 组：audit() 两把尺在种子库存上清零 ----------
{
  await evalJs(`(function(){
    window.__activeCid = 'default';   // 体检按「当前桌面＝default」这一视角跑（C 组为验隔离临时改过它）
    window.xyStore('xy-home-v2').set('group-chat-msgs', '[]');
    window.xyStore('xy-home-v2').set('memo-app-items', '[]');
    window.xyStore('xy-home-v2').set('pomo-cfg', '{}');
    window.xyStore('xy-home-v2').set('applock-pin', '1');
    window.xyStore('xy-home-v2').set('theme-mode', 'dark');
    window.xyStore('xy-home-v2').set('bg-keepalive', '1');
    window.xyStore('xy-home-v2').set('call-active', '{}');
    window.xyStore('xy-home-v2').set('group-chat-enabled', '1');
    window.xyStore('xy-home-v2:default').set('desk-msg-en', '1');
    window.xyStore('xy-home-v2:default').set('tabbar-blur', '12');
    window.xyStore('xy-home-v2:default').set('mc-enabled', '1');
    window.xyStore('xy-home-v2:default').set('ckq-last-id', 'q9');
    window.xyStore('xy-home-v2:default').set('partner-gender', 'she');
    window.activeStore().set('fav-ta-msg', '30');
    return 1;
  })()`);
  const a = JSON.parse(await evalJs(`(function(){
    try{
      if (!window.mochiFeatureData.audit) return Promise.resolve(JSON.stringify({ hasAudit: 0, nobody: [], stranded: [], total: 0, cid: '-' }));
      return window.mochiFeatureData.audit().then(function(r){ r.hasAudit = 1; return JSON.stringify(r); });
    }catch(e){ return Promise.resolve(JSON.stringify({ hasAudit: 1, nobody: ['ERR:' + e], stranded: [], total: 0, cid: '-' })); }
  })()`, true) || '{}');
  ok('E0 audit() 体检口在位（红侧＝产物压根没这个口，下面三条一并红＝没有体检＝下一批还会脱节）',
    a.hasAudit === 1, 'hasAudit=' + a.hasAudit);
  const o = {
    r1: await claim('xy-home-v2:default:records-avatar', 'default'),
    r2: await claim('xy-home-v2:rp-wallet', 'default'),
    r3: await claim('xy-home-v2:default:cs-lbl-partner', 'default'),
    r4: await claim('xy-home-v2:decision-history', 'czzzzz'),
    r5: await claim('xy-home-v2:default:garden-data', 'default'),
    r6: await claim('xy-home-v2:media:0123456789abcdef0123456789abcdef', 'default')
  };
  const NEWFAM = /:music-|group-chat-msgs|group-chat-enabled|memo-app|pomo-|applock|desk-msg-en|fav-ta-|theme-mode|accent-color|bg-keepalive|bg-notify|call-active|tabbar-|tab-icon-|mc-|mh-|rc-|ckq-|checkin|ti-last-id|partner-gender|divination-desk-pin|group-chat-desk-pin|ask-think-secs|today-mood|:memo$|ver-update-notify/;
  const badNobody = (a.nobody || []).filter((k) => NEWFAM.test(k));
  console.log('  [体检·当前库存没有任何功能能认领的键 ' + (a.nobody || []).length + ' 个] ' + (a.nobody || []).slice(0, 14).join(' , '));
  console.log('  [体检·换个桌面视角就能认领的键 ' + (a.stranded || []).length + ' 个] ' + (a.stranded || []).slice(0, 14).join(' , '));
  const badStranded = (a.stranded || []).filter((k) => NEWFAM.test(k));
  ok('E1 audit.nobody 里没有本批点名的任何键族（红侧＝default:music-* 与 26 把新登记的键全都谁都不认）', a.hasAudit === 1 && badNobody.length === 0, badNobody.slice(0, 4).join(' | ') + ' (nobody 共 ' + (a.nobody || []).length + ')');
  ok('E2 audit.stranded 里没有本批点名的根键族（红侧＝换桌面才认＝scope 与模块脱节）', a.hasAudit === 1 && badStranded.length === 0, badStranded.slice(0, 4).join(' | ') + ' (stranded 共 ' + (a.stranded || []).length + ')');
  ok('E2b 种子库存里点名的键各有其主（nobody 只剩机器记账与联系人名册）',
    (a.nobody || []).every((k) => !NEWFAM.test(k)),
    'cid=' + a.cid + ' total=' + a.total);
  ok('E3 邻居归属：records-avatar→identity／cs-lbl-partner→identity／decision-history→decision 一字未动；rp-wallet 自 #1346 起归 gift（旧表挂在 chat 名下，chat 一翻 both 就会把心意币账本抢进聊天，见登记表批注）',
    o.r1 === 'identity' && o.r2 === 'gift' && o.r3 === 'identity' && o.r4 === 'decision' && o.r5 === 'garden' && o.r6 === null,
    JSON.stringify(o));
}

// ---------- Z ----------
const errs = await evalJs("JSON.parse(sessionStorage.getItem('__p1325-errors')||'[]')").catch(() => []);
ok('Z1 全程零未捕获 JS 异常', (errs || []).length === 0, JSON.stringify(errs));

// finishExport2：导出模态可能带 pill（清空/导入才有），这里统一「读到模态文案→点确定→等出文件」
async function finishExport2(got, keepToast) {
  if (got === 'NOBAR' || String(got).indexOf('ERR') === 0) return { modal: '', json: '', calls: 0, toasts: String(got) };
  const snap = `(function(){var mm=(window.__modals||[]).filter(function(x){return /^导出「/.test(x.title)});var m=document.getElementById('modal-mask');
    return {open:!!(m&&!m.hidden), modal:mm.length?mm[mm.length-1].text:'', calls:(window.__fd&&window.__fd.calls)||0, json:(window.__fd&&window.__fd.json)||'',
      toasts:(window.__toasts||[]).slice((window.__fd&&window.__fd.toastBase)||0).join(' | ')};})()`;
  for (let i = 0; i < 30; i++) {
    const r = await evalJs(snap).catch(() => null);
    if (!r) { await sleep(200); continue; }
    if (r.open) {
      // 同上：别人的模态（备份提醒／公告／回收提示）不许替我按确定
      const who2 = await evalJs("(function(){var ms=(window.__modals||[]);for(var i=ms.length-1;i>=0;i--){if(ms[i].title.indexOf('导出「')===0)return ms[i].title}var t=document.getElementById('modal-title');return t?t.textContent:''})()").catch(() => '');
      if (String(who2).indexOf('导出「') !== 0) {
        await evalJs("(function(){var b=document.getElementById('modal-cancel')||document.getElementById('modal-ok');if(b)b.click();return 1})()");
        await sleep(400); continue;
      }
      await evalJs("(function(){var b=document.getElementById('modal-ok');if(b)b.click();return 1})()");
      await sleep(700);
      const r2 = await evalJs(snap).catch(() => null);
      return r2 || r;
    }
    if (r.calls > 0) return r;
    await sleep(200);
  }
  return await evalJs(snap).catch(() => ({ modal: '', json: '', calls: 0 }));
}

console.log('===== #1325 各功能数据导出的命名空间判据（音乐「本桌面暂无数据」族） =====');
console.log('root = ' + root);
R.lines.forEach((l) => console.log(l));
console.log('结果：通过 ' + R.pass + ' / 失败 ' + R.fail);
try { ws.close(); } catch (e) {}
try { cp.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(R.fail ? 1 : 0);
