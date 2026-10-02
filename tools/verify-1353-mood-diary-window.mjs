// ===== 常驻回归：#1353 心情日记「只能记三天、第四天把之前的清空」＋「日历上也不显示TA的心情」 =====
// 用户实报（vivo X200s／Edge 152、华为 nova12 活力版／Edge，均附「其他设备型号也有出现」「不要覆盖式修补」）：
//  「心情日记功能只能记录对方三天心情。第四天会把之前的清空只剩第四天的心情记录，然后记录三天心情后再次清空」
//  「日历上也不显示TA的心情」
// 两条互不相同的真缺陷（无头纯产物实测复现；判据一律零机型／零 UA 分支）：
//  ① 整本写回把「本机此刻同步读到的那份」当全量：localStorage 立刻整包、IndexedDB 也整包盖。而真机上本机这份
//    经常就是少的——LS 配额满时 setItem 静默抛＝LS 停在旧包（报障件逐字「LS 写探针：写入失败(QuotaExceededError)」，
//    另一台整域 5.8MB／1845 键），而 xyStore.get 只认内存与 LS，库里那份更新的被旧包整场遮住；页面被系统回收
//    （同一件实测回收 139 次／56 次）后内存清零、这一格又还挂在启动回填挂起名单上＝读到 NULL＝「用户没记过」。
//    一次最正常的「记下今天」把库里更早的日记整包顶掉＝「第四天把之前的清空」。基线实测：库里 6 天＋LS 落后两天
//    的旧包 → 点一次保存 → 库里剩 3 天（中间几天永久消失），toast 照旧谎报「记下啦」。
//  ② 「那天有没有互动」每次现算，输入＝此刻本机那一段聊天（大历史只有尾部窗口／LS 精简快照只剩最近若干天／
//    这一格还没回填）——已经出现过的日子随窗口滑动凭空消失；日历那句入口卡开页画的是终态文案「今天还没有互动」，
//    聊天读回来后也不重画＝整场挂着谎话（纯产物实测：LS 无 chat-msgs 快照、库里 5 天聊天完好的那一发，日历整场
//    说「今天还没有互动」，同一场日记页却明明显示着 TA 今天的心情）。
// 断言组（红侧＝纯底本产物，逐条见 WORKLOG）：
//  S  产物逻辑锚（取逻辑表达式，不取名字）
//  A  本机那份（落后旧包／读空／库里那一发读不到）不许顶掉库里那本；同一天取 ts 新的；合并落地后月视图画回来
//  B  记下过的日子不随聊天窗口滑动消失；今日那条从台账认出
//  C  没读到聊天＝不知道（日记与日历都不许宣布「没互动」）；聊天读回来那一刻日历那句自己补渲
//  D  旧契约：真没互动也没记下的日子仍然不画 TA／旧包形态（无 days 字段）照读／#1162b 回填未齐挡整包写回照旧
//  Z  全程零未捕获 JS 异常
// 用法：node tools/verify-1353-mood-diary-window.mjs [被测产物根目录]
//       对照时务必显式传纯底本目录（缺省回退仓库根产物）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.argv[2] || process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
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
const base = 'http://127.0.0.1:' + server.address().port + '/';

const R = { pass: 0, fail: 0, lines: [] };
const ok = (n, c, d) => { c ? R.pass++ : R.fail++; R.lines.push((c ? '  ✅ ' : '  ❌ ') + n + (d ? ' — ' + d : '')); };

// ---------- S 组：产物逻辑锚 ----------
{
  const rd = (f) => { try { return readFileSync(join(root, f), 'utf8'); } catch (e) { return ''; } };
  const md = rd('js/mood-diary.js'), cal = rd('js/calendar.js');
  ok('S1 整本写回前先与库里那份按日并集（删＝一次保存顶掉库里历史复发）', md.includes('function unionPkg(lib, ours) {'));
  ok('S2 IDB 那一腿必须等库里那份读回来才写（删＝本机这份直接整包盖库）', md.includes('queueLibMerge(false);'));
  ok('S3 库里那一发读不到＝取消整本写回＋补试只发一次（删＝把一次超时讲成库里没有）',
    md.includes('&& info.ambiguous) { bail(); return; }') && md.includes('if (!retry) { setTimeout(queueLibMerge, 4000, true); return; }'));
  ok('S4 本机这份先落内存＋LS（保存手感、回收兜底都不变）', md.includes('window.idbMemoSet(libKey(), s)'));
  ok('S5 互动日从「每次现算」改成「记下」：看到一次就落账', md.includes('pkg.days = set;'));
  ok('S6 「没读到聊天」与「真没互动」分成两种答案', md.includes('function interactionUnknown(dateKey) {'));
  ok('S7 并回来的日子重认一遍，且只重画月视图（不盖用户正在输入的备注）',
    md.includes('if (grewDy) _interactCache.built = false;') && !/function queueLibMerge[\s\S]{0,1800}renderToday\(\)/.test(md));
  ok('S8 日历入口卡不许对「不知道」宣布「还没有互动」', cal.includes('((md && md.taUnknown) ? (window.mochiLoadingText'));
  ok('S9 记下互动日那一刻广播、日历那句跟着补渲（删＝谎话整场挂着＝用户原话「日历上也不显示TA的心情」）',
    md.includes("document.dispatchEvent(new Event('mood-interact-recorded'))") &&
    cal.includes("document.addEventListener('mood-interact-recorded'"));
  ok('S10 旧契约 #1162b 回填未齐挡整包写回仍在位（两侧皆绿＝本批没拆邻批的闸）',
    md.includes('if (!Object.keys(dd.d).length && window.mochiDataPending && window.mochiDataPending())'));
  ok('S11 旧契约 #338 TA 心情独立哈希仍在位（两侧皆绿）', md.indexOf("hashStr('ta-mood-indep|'") >= 0);
}

// ---------- headless ----------
const userDir = join(process.env.TEMP || '/tmp', 'mochi-v1353-' + Date.now());
const cp = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + userDir,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=360,740', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error('DevTools 端口未就绪')), 20000);
  cp.stderr.on('data', (d) => { buf += d.toString(); const m = buf.match(/ws:\/\/[^\s]+/); if (m) { clearTimeout(t); resolve(m[0]); } });
  cp.on('exit', () => reject(new Error('Chrome 提前退出')));
});
const dbg = wsUrl.replace(/^ws:\/\/([^/]+)\/.*$/, 'http://$1');
const tlist = await (await fetch(dbg + '/json/list')).json();
const page = tlist.find((t) => t.type === 'page') || await (await fetch(dbg + '/json/new?about:blank')).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const waits = new Map();
ws.addEventListener('message', (ev2) => {
  const m = JSON.parse(ev2.data);
  if (m.id && waits.has(m.id)) { const w = waits.get(m.id); waits.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params) => new Promise((res, rej) => { const id = ++mid; waits.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params: params || {} })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: 'Promise.resolve(' + expr + ')', returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  const v = r.result.value;
  return typeof v === 'string' ? v : JSON.stringify(v);
};
await send('Page.enable'); await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
(function(){ try{
  if (sessionStorage.getItem('__p1353-errors') === null) sessionStorage.setItem('__p1353-errors','[]');
  var errs = JSON.parse(sessionStorage.getItem('__p1353-errors') || '[]');
  window.addEventListener('error', function(e){ errs.push(String(e.message||e.error) + ' @ ' + String(e.filename||'').split('/').pop() + ':' + e.lineno); sessionStorage.setItem('__p1353-errors', JSON.stringify(errs.slice(0,6))); });
  window.addEventListener('unhandledrejection', function(e){ errs.push('rej:'+String(e.reason)); sessionStorage.setItem('__p1353-errors', JSON.stringify(errs.slice(0,6))); });
}catch(e){} })();
` });

const nav = async (ms) => { await send('Page.navigate', { url: base }); await sleep(ms || 4200); };
const dismiss = () => ev("(function(){try{var s=document.getElementById('splash');if(s)s.remove();var q=document.getElementById('qa-mask');if(q)q.remove();var b=document.getElementById('backup-remind-bar');if(b)b.remove();}catch(e){}return 1})()");
const ready = async () => {
  for (let i = 0; i < 40; i++) {
    if ((await ev("(function(){return !!(window.activeStore && window.idbSet && window.openMoodDiary)})()")) === 'true') {
      await ev("(function(){ if (!window.__idbTrue) window.__idbTrue = window.idbGet; return 1 })()"); // 抓一份没被夹具包过的 idbGet，读数用它
      return true;
    }
    await sleep(300);
  }
  return false;
};
const waitToast = async (frag, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 4000)) {
    const s = await ev("(function(){var e=document.getElementById('cc-toast');return e?(e.className.indexOf('show')>=0?e.textContent:''):''})()");
    if (s.indexOf(frag) >= 0) return s;
    await sleep(150);
  }
  return '';
};
// 全场清扫：LS/内存/IDB 三路连同写日志（__wrj:／__wr-journal）一起复位——只清 LS 的话，上一组的包会被
// 冻结日志回放进场＝串场假数据（B1 曾被上一组记下的「今天」污染过）
const wipe = async () => {
  await ev(`(function(){
    try{ for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i); if(k&&k.indexOf('xy-home-v2:')===0) localStorage.removeItem(k);} }catch(e){}
    try{ localStorage.removeItem('xy-home-v2:__wr-journal'); }catch(e){}
    try{ sessionStorage.clear(); sessionStorage.setItem('__p1353-errors','[]'); }catch(e){}
    return 1;
  })()`);
  await ev(`(function(){ return (window.idbGetAllKeys?window.idbGetAllKeys():Promise.resolve([])).then(function(ks){
      var mk=(ks||[]).filter(function(k){ return String(k).indexOf('xy-home-v2:')===0; });
      return Promise.all(mk.map(function(k){ return (window.idbDelete?window.idbDelete(k):Promise.resolve()).catch(function(){}); })).then(function(){ return mk.length; });
    }) })()`);
  await sleep(300);
};
// 夹具：libDays＝库里那本有的日子（back 值）；lsDays＝本机那份；chatFrom/chatTo＝本机聊天尾巴覆盖的 back 区间
const seed = (o) => ev(`(function(){
  var pad=function(n){return (n<10?'0':'')+n}, dk=function(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())};
  var now=new Date(), K=function(back){return dk(new Date(now.getFullYear(),now.getMonth(),now.getDate()-back))};
  var msgs=[]; for(var back=${'chatFrom' in o ? o.chatFrom : 11}; back>=${'chatTo' in o ? o.chatTo : 0}; back--){ var b=new Date(now.getFullYear(),now.getMonth(),now.getDate()-back).getTime();
    for(var i=0;i<3;i++) msgs.push({ts:b+(i+1)*60000, side:i%2?'in':'out', text:'m'+back+'_'+i, id:'m'+back+'_'+i}); }
  var mk=function(dlist,note){ var p={d:{},days:{}}; dlist.forEach(function(back,idx){ var k=K(back); p.d[k]={m:'😊',n:note+idx,ts:Date.now()-back*86400000+idx}; p.days[k]=1; }); if (${o.noDays ? 'true' : 'false'}) { p.days={}; } return p; };
  var lib = (${JSON.stringify(o.libDays || [])}).length ? mk(${JSON.stringify(o.libDays)},'库里') : null;
  var ls  = (${JSON.stringify(o.lsDays || [])}).length ? mk(${JSON.stringify(o.lsDays)},'本机') : null;
  localStorage.setItem('xy-home-v2:active-contact','default');
  if (${o.lsChat === false ? 'false' : 'true'}) localStorage.setItem('xy-home-v2:default:chat-msgs', JSON.stringify(msgs));
  if (ls) localStorage.setItem('xy-home-v2:default:mood-diary', JSON.stringify(ls));
  else if (${'lsRaw' in o ? JSON.stringify(o.lsRaw) : 'null'}) localStorage.setItem('xy-home-v2:default:mood-diary', ${'lsRaw' in o ? JSON.stringify(o.lsRaw) : 'null'});
  var ps=[];
  if (lib) ps.push(window.idbSet('xy-home-v2:default:mood-diary', JSON.stringify(lib)));
  ps.push(window.idbSet('xy-home-v2:default:chat-msgs', JSON.stringify(msgs)));
  return Promise.all(ps).then(function(){return 'seeded'},function(e){return 'seed-ERR:'+e});
})()`);
const libDays = () => ev("(function(){ return (window.__idbTrue||window.idbGet)('xy-home-v2:default:mood-diary').then(function(v){ try{ var o=JSON.parse(v||'null'); var d=(o&&o.d)||{}; return JSON.stringify({n:Object.keys(d).length, days:Object.keys((o&&o.days)||{}).length, notes:Object.keys(d).sort().map(function(k){return d[k].n}).join('|')}) }catch(e){ return '{\"err\":1}' } }) })()");
const pkgNow = () => ev("(function(){ try{ var o=JSON.parse(window.activeStore().get('mood-diary')||'null'); var d=(o&&o.d)||{}; var fresh=Object.keys(d).filter(function(k){return d[k].n==='本次新写的备注'}); return JSON.stringify({keys:Object.keys(d).length, days:Object.keys((o&&o.days)||{}).length, fresh:fresh.length}) }catch(e){ return '{\"err\":1}' } })()");
const gridRead = `(function(){
  var mine=[],ta=[]; document.querySelectorAll('#mood-month-grid .mood-day').forEach(function(c){
    var fs=c.querySelectorAll('.mood-dfaces i'), dn=+((c.querySelector('.mood-dnum')||{}).textContent||0);
    if(fs[0]&&fs[0].textContent) mine.push(dn); if(fs[1]&&fs[1].textContent) ta.push(dn); });
  return JSON.stringify({cells:document.querySelectorAll('#mood-month-grid .mood-day').length, mine:mine.length, mineList:mine, ta:ta.length, taList:ta, taLine:(document.getElementById('mood-ta-line')||{}).textContent||''});
})()`;
const openDiary = async () => { await ev("(function(){ window.openMoodDiary(); return 1 })()"); await sleep(600); };
const clickSave = async (waitMs) => {
  await ev("(function(){ var b=document.querySelector('#mood-emoji-grid .mood-emoji-item'); if(b) b.click(); return 1 })()");
  await sleep(150);
  await ev("(function(){ var n=document.getElementById('mood-note'); if(n) n.value='本次新写的备注'; return 1 })()");
  await ev("(function(){ var s=document.getElementById('mood-save'); if(s) s.click(); return 1 })()");
  await sleep(waitMs || 2000); // 与库里那份合并那一发要落地（慢内核给足）
};
const setLedger = (backs) => ev(`(function(){
  var pad=function(n){return (n<10?'0':'')+n}; var now=new Date();
  var p=JSON.parse(window.activeStore().get('mood-diary')||'null') || {d:{}};
  p.days = p.days || {};
  ${JSON.stringify(backs)}.forEach(function(back){ var d=new Date(now.getFullYear(),now.getMonth(),now.getDate()-back); p.days[d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())]=1; });
  window.activeStore().set('mood-diary', JSON.stringify(p));
  return 'ledger=' + Object.keys(p.days).length;
})()`);
// 让「这一发本机读不到聊天」成立：内存/LS/IDB 三条来路一起断＋权威未达（＝刚回收、这一格还没读回来）
const stubChatUnread = () => ev(`(function(){
  try{ window.activeStore().remove('chat-msgs'); }catch(e){}
  localStorage.removeItem('xy-home-v2:default:chat-msgs');
  window.__gcmReal = window.getChatMsgs; window.getChatMsgs = function(){ return []; };
  var rg = window.idbGet; window.__igReal = rg;
  window.idbGet = function(k, i){ if(String(k).indexOf('chat-msgs') >= 0){ if (i && typeof i === 'object') i.ambiguous = true; return Promise.resolve(undefined); } return rg.apply(null, arguments); };
  window.__rdyReal = window.__chatDbReady; window.__chatDbReady = function(){ return false; };
  return 'chat-unread';
})()`);
const unstubChat = (withTodayMsgs) => ev(`(function(){
  window.idbGet = window.__igReal || window.idbGet;
  if (window.__rdyReal) window.__chatDbReady = window.__rdyReal;
  if (${withTodayMsgs ? 'true' : 'false'}) { var now=new Date(), b=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime(), a=[]; for(var i=0;i<3;i++) a.push({ts:b+(i+1)*60000, side:i%2?'in':'out', text:'new'+i, id:'new'+i}); window.getChatMsgs=function(){return a}; }
  else window.getChatMsgs = window.__gcmReal || window.getChatMsgs;
  return 'chat-restored';
})()`);
const stubLibUnread = () => ev("(function(){ var rg=window.idbGet; window.__igLib=rg; window.idbGet=function(k,i){ if(String(k).indexOf('mood-diary')>=0){ if(i&&typeof i==='object') i.ambiguous=true; return Promise.resolve(undefined); } return rg.apply(null,arguments); }; return 'lib-unread' })()");
const unstubLib = () => ev("(function(){ if(window.__igLib) window.idbGet=window.__igLib; return 1 })()");
// 进日历页＝点桌面「日历」应用图标（openCalPage 的真实入口；先回桌面再点，避开别的页残留）
const goCalTab = async () => {
  await ev("(function(){ var t=document.querySelector('.tab[data-page=page-phone]'); if(t) t.click(); return 1 })()");
  await sleep(500);
  await ev('(function(){ var a=document.querySelector(\'.app[data-app="calendar"]\'); if(a) a.click(); return 1 })()');
  await sleep(900);
};
const onCalPage = () => ev("(function(){ var p=document.getElementById('page-calendar'); return p?String(p.hidden):'NO' })()");
const calEntry = () => ev("(function(){ var e=document.getElementById('mood-entry-ta'); return e?(e.textContent||''):'(无元素)' })()");

console.log('root=' + root);
await nav(); await dismiss();
if (!await ready()) { console.log('SKIP: 应用壳未起来'); ws.close(); cp.kill(); server.close(); process.exit(2); }

// ============ A 组：本机那份（落后旧包）不许顶掉库里那本 ============
await wipe();
await seed({ libDays: [10, 9, 8, 7, 6, 5], lsDays: [4, 3], chatFrom: 4, chatTo: 3 });
await nav(); await dismiss(); await ready();
const a0 = await libDays();
const aLocalBefore = JSON.parse(await pkgNow());
ok('A1 夹具诚实：库里那本 6 天完好', a0.indexOf('"n":6') >= 0, a0);
ok('A2 夹具诚实：本机这一份同步读数只剩落后的两天（LS 旧包遮住库里那本＝用户所见「之前的被清空」那一眼）',
  aLocalBefore.keys === 2, JSON.stringify(aLocalBefore));
await openDiary();
await clickSave();
const a1 = await libDays();
ok('A3 点一次「记下今天」后库里那本＝完整历史＋今天（红侧＝被顶成 3 天，中间几天永久消失）',
  a1.indexOf('"n":9') >= 0, '保存前 ' + a0 + ' → 保存后 ' + a1);
ok('A4 同一天取 ts 新的：今天这一条不复制成两条，旧日子一条不少', (await pkgNow()).indexOf('"fresh":1') >= 0, await pkgNow());
const healed = JSON.parse(await ev(gridRead));
ok('A5 合并落地后月视图把库里那些旧日子画回来（用户看得见「没被清空」）', healed.mine >= 9, 'mine=' + healed.mine + ' ' + JSON.stringify(healed.mineList));
await nav(); await dismiss(); await ready();
ok('A6 再回收一次，库里那本仍完整（不可逆丢失被止住）', (await libDays()).indexOf('"n":9') >= 0, await libDays());

// 读空＋库里那一发读不到＝这一趟不许整本写回
await wipe();
await seed({ libDays: [10, 9, 8, 7, 6, 5], lsRaw: '{"d":{}}', chatFrom: 4, chatTo: 3 });
await nav(); await dismiss(); await ready();
await stubLibUnread();
await openDiary();
await clickSave();
ok('A7 本机读空＋库里那一发读不到时，整本写回取消（红侧＝「只含今天」的包直接盖掉库里 6 天）',
  (await libDays()).indexOf('"n":6') >= 0, await libDays());
await unstubLib();
await openDiary();
await clickSave();
ok('A8 补试读到库里那份后并回来（取消那一发不是永久不写；今天这条落得进库）', (await libDays()).indexOf('"n":7') >= 0, await libDays());

// ============ B 组：记下过的日子不随聊天窗口滑动消失 ============
await wipe();
// 本机那份聊天尾巴只覆盖 back 2..1；日记里 12 天都在（库里＋本机），但互动台账先清空＝第一轮只能现算
await seed({ libDays: [11, 10, 9, 8, 7, 6, 5, 4, 3, 2], lsDays: [11, 10, 9, 8, 7, 6, 5, 4, 3, 2], chatFrom: 2, chatTo: 1, noDays: true });
await nav(); await dismiss(); await ready();
const backDay = async (back) => JSON.parse(await ev(`(function(){ var d=new Date(); d.setDate(d.getDate()-${back}); return JSON.stringify(d.getDate()) })()`));
const D5 = await backDay(5);
await openDiary();
const gNowin = JSON.parse(await ev(gridRead));
ok('B1 夹具诚实：台账空着时，TA 只能从「本机这一份聊天尾巴」现算出来（只有最近两三天，back=5 那天不在其中）',
  gNowin.ta <= 5 && gNowin.taList.indexOf(Number(D5)) < 0, 'ta=' + gNowin.ta + ' ' + JSON.stringify(gNowin.taList) + ' D5=' + D5);
await setLedger([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
await nav(); await dismiss(); await ready();
await openDiary();
const gLedger = JSON.parse(await ev(gridRead));
ok('B2 尾巴外的那一天（back=5）在记下之后仍画得出 TA 心情（红侧＝那一格只剩「我」的脸＝「第四天把之前的清空」）',
  gLedger.taList.indexOf(Number(D5)) >= 0, 'D5=' + D5 + ' 记下并重开 taList=' + JSON.stringify(gLedger.taList) + ' 第一轮参照=' + JSON.stringify(gNowin.taList));
ok('B3 记下过的日子不再随窗口滑动消失：网格里 TA 仍十二天（红侧＝只剩尾巴那两三天）',
  gLedger.ta >= 12, '第一轮 ta=' + gNowin.ta + ' → 记下并重开 ta=' + gLedger.ta + ' ' + JSON.stringify(gLedger.taList));

// ============ C 组：没读到聊天＝不知道，读到那一刻日历补渲 ============
await wipe();
await seed({ libDays: [3, 2, 1], lsDays: [3, 2, 1], chatFrom: 3, chatTo: 1 });
await nav(); await dismiss(); await ready();
await stubChatUnread();
await ev("(function(){ var p=JSON.parse(window.activeStore().get('mood-diary')||'null')||{d:{}}; p.days={}; window.activeStore().set('mood-diary', JSON.stringify(p)); return 1 })()");
await goCalTab();
const calShown = await onCalPage();
const calUnknown = await calEntry();
await openDiary();
const gUnknown = JSON.parse(await ev(gridRead));
const mdUnknown = await ev("(function(){ var m=window.moodDiaryToday(); return JSON.stringify({ta:!!m.ta, unknown:!!m.taUnknown}) })()");
ok('C1 这一发没读到聊天时，日记那行出读取态而不是宣布「还没有互动」（红侧＝谎报）',
  gUnknown.taLine.indexOf('还没有互动') < 0 && /读取|稍等|正在/.test(gUnknown.taLine), gUnknown.taLine);
ok('C2 moodDiaryToday 如实报「不知道」（红侧＝没有这个字段，日历把未知当终态）', mdUnknown.indexOf('"unknown":true') >= 0, mdUnknown);
ok('C3 日历入口卡同口径：不说「今天还没有互动」（红侧＝用户原话「日历上也不显示TA的心情」）',
  calUnknown.indexOf('还没有互动') < 0, '日历页hidden=' + calShown + ' 文案=' + calUnknown);
await unstubChat(true);          // 聊天读回来了（今天有消息）
await openDiary();               // 记下今天那一刻广播
await sleep(1000);
const calHealed = await calEntry();
ok('C4 聊天读回来、互动日记下的那一刻，日历那句自己补渲成心情（红侧＝停在谎话不动，要重开一次才对）',
  /😊|🥰|😄|😌|🤒|😔|😢|😡|😴/.test(calHealed), calHealed);

// ============ D 组：旧契约／夹具诚实（两侧皆绿＝本批没修过头、没拆邻批的闸） ============
await wipe();
await seed({ libDays: [2, 1], lsDays: [2, 1], chatFrom: 2, chatTo: 0 });
await nav(); await dismiss(); await ready();
await ev("(function(){ var p=JSON.parse(window.activeStore().get('mood-diary')||'null')||{d:{}}; p.days={}; window.activeStore().set('mood-diary', JSON.stringify(p)); return 1 })()");
await nav(); await dismiss(); await ready();
await openDiary();
const gd = JSON.parse(await ev(gridRead));
ok('D1 真没互动、又没记下的日子仍然不画 TA（不许修成「一律显示」）',
  gd.ta >= 1 && gd.ta <= 4 && gd.ta < gd.cells, 'ta=' + gd.ta + ' cells=' + gd.cells);
// 旧版包形态：只有 {d:{...}}，没有 days 字段
await wipe();
await seed({ libDays: [2, 1], lsDays: [2, 1], chatFrom: 2, chatTo: 0 });
await ev("(function(){ var p=JSON.parse(window.activeStore().get('mood-diary')||'null')||{d:{}}; delete p.days; window.activeStore().set('mood-diary', JSON.stringify(p)); var raw=window.idbGet('xy-home-v2:default:mood-diary'); return 1 })()");
await ev("(function(){ return window.idbGet('xy-home-v2:default:mood-diary').then(function(v){ var o=JSON.parse(v||'{}'); delete o.days; return window.idbSet('xy-home-v2:default:mood-diary', JSON.stringify(o)) }) })()");
await nav(); await dismiss(); await ready();
await openDiary();
const gOld = JSON.parse(await ev(gridRead));
ok('D2 旧包形态（只含 d、没有 days）照样读得到、月视图照旧画（升级不挡老数据）', gOld.mine === 2, 'mine=' + gOld.mine);
// #1162b：回填未齐＋读到空 → 挡整包写回（这条聊天读不到，免得互动台账那一发把包写出去）
await wipe();
await seed({ libDays: [], lsDays: [], chatFrom: 2, chatTo: 0 });
await nav(); await dismiss(); await ready();
await stubChatUnread();
await ev("(function(){ localStorage.removeItem('xy-home-v2:default:mood-diary'); try{ window.activeStore().remove('mood-diary'); }catch(e){} var mp=window.mochiDataPending; window.__mp1353=mp; window.mochiDataPending=function(){return true}; return 1 })()");
await openDiary();
await ev("(function(){ var b=document.querySelector('#mood-emoji-grid .mood-emoji-item'); if(b) b.click(); var t=document.getElementById('cc-toast'); if(t){t.className='cc-toast';t.textContent='';} var s=document.getElementById('mood-save'); if(s) s.click(); return 1 })()");
const guarded = await waitToast('稍等几秒再记', 3000);
ok('D3 #1162b 回填未齐挡整包写回照旧生效（两侧皆绿＝本批没绕过邻批的闸）', guarded.indexOf('稍等几秒再记') >= 0, guarded || '无守卫 toast');
await ev("(function(){ if(window.__mp1353) window.mochiDataPending=window.__mp1353; return 1 })()");

// ============ Z 组 ============
const errs = await ev("(function(){try{return sessionStorage.getItem('__p1353-errors')||'[]'}catch(e){return '[]'}})()");
ok('Z1 全程零未捕获 JS 异常／rejection', errs === '[]', errs === '[]' ? '' : String(errs).slice(0, 300));

console.log('\n===== #1353 心情日记（整本写回顶掉库里／TA 心情随窗口消失／日历那句谎报） =====');
console.log(R.lines.join('\n'));
console.log(`读数：${R.pass} 绿 / ${R.fail} 红   root=${root}`);
ws.close(); cp.kill(); server.close();
process.exit(R.fail ? 1 : 0);
