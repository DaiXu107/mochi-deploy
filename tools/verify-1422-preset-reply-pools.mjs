// ===== 专项回归：六池「互动必答句」接入系统预设字卡（#1422） =====
// 起因（作者 2026-09-29）：#1417/#1420 查完跳转后，追问「还有没有其他系统预设字卡是同样问题」，
//   查出 6 个系统预设话术池共 31 句在字卡库里根本没有页面——旧搜索钩子登记过其中 5 池，
//   于是症状是「搜得到、看不到、关不掉」。作者点名：把这 6 个池加进系统预设页。
// 归属（作者选项框定的两条口径，别自行改向）：
//   ① 落点＝字卡库→系统预设字卡→【其他互动功能字卡 → 互动回应】新增六组（与「邀请TA·接受／拒绝」
//      「游戏胜负平·回应」同页同类）；
//   ② 二级锁（#319）＝「浏览受锁、回应不受锁」——锁定时库里看不到也搜不到，但 TA 照样按它们回话
//      （否则会出现「拒绝了 TA 的贴贴邀请之后一句话都不回」）。
// 机制：数据源＝default-cards-data.js 的 DEFAULT_CARD_DATA.interact 六组；出口＝default-cards.js 的
//   window.getPresetGroupLines(分组名, 兜底数组)（认 dc-off-interact:<文案> 与 dc-groups-off 整组停用，
//   不读 LOCKED）；消费点＝chat.js presetReplyPick 三处＋「我发出的邀请」预设视图过滤、feed.js feedFallbackPool。
//   分组成员被全部关掉＝返回空数组＝真停用，调用方什么都不发（不回落兜底、不抓别的组顶）。
// 用例：
//   S1~S8 源码静态（六组在位／句子逐字未改／裸取已清／旧重复搜索登记已撤／豁免的实现判据／空值守卫）
//   B1~B8 行为（无头真点：句数→库里可见→逐句开关→整组停用→全关不回落→端到端回应→端到端婉拒→锁豁免）
//   Z1 零未捕获异常；--mutate 反向对照（摘掉开关过滤，B3/B4/B5/B7 必须变红）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MUT = process.argv.includes('--mutate');
const read = (p) => readFileSync(join(root, 'src', p), 'utf8');

const GROUPS = [
  ['贴贴·回应', 5], ['贴贴·婉拒', 4], ['游戏邀请·婉拒', 4],
  ['朋友圈·TA的点评', 6], ['朋友圈·TA的回复', 8], ['我发出的邀请', 4]
];
let pass = 0, fail = 0, reds = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; reds.push(name); console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
};

// ---------- S 源码静态 ----------
const chatSrc = read('js/chat.js'), feedSrc = read('js/feed.js'),
  dcSrc = read('js/default-cards.js'), dataSrc = read('js/default-cards-data.js'),
  auditSrc = read('js/card-audit.js');
console.log('\n== S 源码静态 ==');
ok('S1 六组各恰一次 push 进 DEFAULT_CARD_DATA.interact',
  GROUPS.every(([g]) => dataSrc.split('DEFAULT_CARD_DATA.interact.push(["' + g + '"').length - 1 === 1));
// S2 逐字未改：拿迁出前（HEAD）代码里的数组当尺子，句序与句面都要一致
const HEAD_CHAT = (() => { try { return execFileSync('git', ['-C', root, 'show', 'HEAD:src/js/chat.js'], { maxBuffer: 64e6 }).toString(); } catch (e) { return ''; } })();
const HEAD_FEED = (() => { try { return execFileSync('git', ['-C', root, 'show', 'HEAD:src/js/feed.js'], { maxBuffer: 64e6 }).toString(); } catch (e) { return ''; } })();
const headArr = (src, name) => {
  const i = src.indexOf('const ' + name + ' = [');
  if (i < 0) return null;
  const seg = src.slice(i, src.indexOf('];', i) + 2);
  return (seg.match(/'([^']*)'/g) || []).map((s) => s.slice(1, -1));
};
const dataGroup = (name) => {
  const i = dataSrc.indexOf('DEFAULT_CARD_DATA.interact.push(["' + name + '"');
  if (i < 0) return null;
  const seg = dataSrc.slice(i, dataSrc.indexOf(']);', i) + 3);
  return (seg.match(/"([^"]*)"/g) || []).slice(1).map((s) => s.slice(1, -1));
};
const ORIGINS = [['贴贴·回应', HEAD_CHAT, 'CUDDLE_REPLIES'], ['贴贴·婉拒', HEAD_CHAT, 'CUDDLE_DECLINE'],
  ['游戏邀请·婉拒', HEAD_CHAT, 'INVITE_DECLINE'], ['我发出的邀请', HEAD_CHAT, 'MY_INVITE_PRESETS'],
  ['朋友圈·TA的点评', HEAD_FEED, 'TA_COMMENT_POOL'], ['朋友圈·TA的回复', HEAD_FEED, 'TA_REPLY_POOL']];
ok('S2 夹具诚实：HEAD 里六个原数组都抽到了', ORIGINS.every(([, s, n]) => (headArr(s, n) || []).length > 0),
  ORIGINS.map(([, s, n]) => n + '=' + (headArr(s, n) || []).length));
ok('S3 句子逐字未改（组内容与迁出前数组同序同字）',
  ORIGINS.every(([g, s, n]) => {
    const a = headArr(s, n) || [], b = dataGroup(g) || [];
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }), ORIGINS.map(([g, s, n]) => g + ': ' + (headArr(s, n) || []).length + ' vs ' + (dataGroup(g) || []).length));
ok('S4 chat.js 裸取旧数组已清（pick(CUDDLE_REPLIES)/pick(CUDDLE_DECLINE)/pick(declinePool || INVITE_DECLINE) 全 0）',
  !/pick\(CUDDLE_REPLIES\)/.test(chatSrc) && !/pick\(CUDDLE_DECLINE\)/.test(chatSrc) && !/pick\(declinePool \|\| INVITE_DECLINE\)/.test(chatSrc));
ok('S5 三个出口在位：presetReplyPick 按组名取（回应1／婉拒2／游戏邀请婉拒默认+caller）',
  (chatSrc.match(/presetReplyPick\('贴贴·回应'/g) || []).length === 1 &&
  (chatSrc.match(/presetReplyPick\('贴贴·婉拒'/g) || []).length === 2 &&
  (chatSrc.match(/'游戏邀请·婉拒'/g) || []).length >= 2);
ok('S6 feed.js 两处以经 feedFallbackPool（裸 uniqArr(TA_COMMENT_POOL.concat 已清）',
  (feedSrc.match(/const fb = feedFallbackPool\(\);/g) || []).length === 2 && !/uniqArr\(TA_COMMENT_POOL\.concat/.test(feedSrc));
ok('S7 旧的重复搜索登记已撤（chat 三池 cat 三条＋feed 整块「朋友圈互动」）',
  !/cat: '贴贴·回应'/.test(chatSrc) && !/cat: '贴贴·婉拒'/.test(chatSrc) && !/cat: '游戏邀请·婉拒'/.test(chatSrc) &&
  !/name: '朋友圈互动'/.test(feedSrc));
const helperBody = (dcSrc.match(/window\.getPresetGroupLines = function[\s\S]*?\n  \};/) || [''])[0];
ok('S8 豁免的实现判据：getPresetGroupLines 函数体内不读 LOCKED()', helperBody.length > 0 && !helperBody.includes('LOCKED()'), helperBody.slice(0, 60));
ok('S9 getLibPool 的第 4 参只放宽豁免调用方（老调用仍受锁）', /if \(LOCKED\(\) && !exemptLock\)/.test(dcSrc));
ok('S10 feed.js 两处空值守卫在位（兜底池被关空了也不把 undefined 写进动态）',
  (feedSrc.match(/const fb = feedFallbackPool\(\);/g) || []).length === 2); // #1356 收口批重锚：_t 守卫被 take() 有意取代（同向更严），改钉两处兜底池取值
ok('S11「浏览受锁、回应不受锁」的口径在字卡使用自检里写明', auditSrc.includes('浏览受锁、回应不受锁'));

// ---------- 夹具 ----------
const buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8');
const arrOf = (name) => {
  const m = buildSrc.match(new RegExp('const ' + name + ' = \\[([^\\]]*)\\]'));
  return m ? m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];
};
const cssFiles = arrOf('cssFiles'), jsFiles = arrOf('jsFiles');
const mutate = (f, code) => (!MUT || f !== 'default-cards.js') ? code
  : code.replace("return off ? arr.filter(c => !off('interact', c)) : arr;", 'return arr; /* MUTATE */');
let testHtml = read('template.html')
  .replace('/*__SCRIPTS__*/', () => jsFiles.map((f) => '(function () { try {\n' + mutate(f, read('js/' + f)) + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();').join('\n'))
  .replace('/*__STYLES__*/', () => cssFiles.map((f) => read('css/' + f)).join('\n'))
  .split('__BUILD_INFO__').join('verify-test-build').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
if (MUT) ok('M1 变异注入生效（开关过滤被摘掉）', !testHtml.includes("return off ? arr.filter(c => !off('interact', c)) : arr;"));

const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-1422-root-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const p = normalize(join(tmpRoot, rel));
    if (!p.startsWith(tmpRoot)) { res.writeHead(403); res.end(); return; }
    let hit = false; try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cands = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const exe = cands.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!exe) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const profile = join(process.env.TEMP || '/tmp', 'mochi-1422-profile-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9880 + Math.floor(Math.random() * 60));
const chrome = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 80; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const pg = l.find((t) => t.type === 'page');
    if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((r2, j) => { ws.onopen = r2; ws.onerror = j; }); break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('连不上 CDP'); chrome.kill('SIGKILL'); process.exit(1); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const cdp = (method, params = {}) => { const i2 = ++msgId; return new Promise((r2) => { pend.set(i2, r2); ws.send(JSON.stringify({ id: i2, method, params })); }); };
async function evalJs(e) {
  const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return { __err: String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 200) };
  return r && r.result ? r.result.value : null;
}
const exceptions = [];
await cdp('Runtime.enable'); await cdp('Page.enable');
const rawH = ws.onmessage;
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') exceptions.push(JSON.stringify(m.params).slice(0, 160)); if (rawH) rawH(ev); };
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(5200);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
await sleep(400);
await evalJs("(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return 1;})()");
await sleep(600);
// 进聊天页（贴贴链路要求聊天可见）：先清掉可能占着的层，再点桌面「聊天」应用图标——
// 口径照 tools/verify-ta-invite.mjs 的 T5（点 .tab[data-page] 进不去，贴贴链路会静默返回 false）
await evalJs("(function(){ ['modal-mask','tc-mask','qa-mask'].forEach(function(id){ var el=document.getElementById(id); if(el) el.hidden=true; }); return 1; })()");
await evalJs("(function(){var app=document.querySelector('.app[data-app=\"chat\"]');if(app)app.click();return 1;})()");
await sleep(600);

console.log('\n== B 行为（真无头：开关→整组停用→端到端→锁豁免）==');
// F1 夹具自证：解锁位写下去立刻读回（xyStore 是全局根键，不是 per-cid）
const f1 = await evalJs("(function(){try{window.xyStore('xy-home-v2').set('cardlock-state','open');return {open:window.cardLockOpen(),back:window.xyStore('xy-home-v2').get('cardlock-state')};}catch(e){return{err:String(e)};}})()");
ok('F1 夹具自证：解锁写下去当场读回（cardLockOpen=true）', !!f1 && f1.open === true && f1.back === 'open', f1);

const WANT = JSON.stringify(GROUPS.map((x) => x[0]));
const b1 = await evalJs("(function(){try{var d=(window.DEFAULT_CARD_DATA||{}).interact||[];var got=d.filter(function(x){return " + WANT + ".indexOf(x[0])>=0;}).map(function(x){return x[0]+':'+x[1].length;});return {got:got,all:d.map(function(x){return x[0];})};}catch(e){return{err:String(e)};}})()");
ok('B1 六组都在 DEFAULT_CARD_DATA.interact 且句数＝5/4/4/6/8/4',
  !!b1 && GROUPS.every(([g, n]) => (b1.got || []).indexOf(g + ':' + n) >= 0), b1);

const b2 = await evalJs("(function(){try{var g=(window.getDefaultCardGroups&&window.getDefaultCardGroups('interact'))||[];var names=g.map(function(x){return x[0];});return {names:names};}catch(e){return{err:String(e)};}})()");
ok('B2 库里能看到：解锁态下「互动回应」这一类列出这六组',
  !!b2 && GROUPS.every(([g]) => (b2.names || []).indexOf(g) >= 0), b2 && b2.names && b2.names.slice(-8));

// B3 逐句开关（走真实写入：activeStore 的 dc-off-interact:<文案>）
const b3 = await evalJs("(function(){try{var g=window.getPresetGroupLines('贴贴·回应',[]);var first=g[0];window.activeStore().set('dc-off-interact:'+first,'1');var after=window.getPresetGroupLines('贴贴·回应',[]);var keys=after.length;window.activeStore().remove('dc-off-interact:'+first);var back=window.getPresetGroupLines('贴贴·回应',[]);return {before:g.length,after:after.length,hasFirst:after.indexOf(first)>=0,back:back.length,off:first};}catch(e){return{err:String(e)};}})()");
ok('B3 逐句开关生效：关一句少一句，且写回后能恢复（不是假绿）',
  !!b3 && b3.after === b3.before - 1 && b3.hasFirst === false && b3.back === b3.before, b3);

// B4 整组停用（dc-groups-off.interact）＋隔壁组只让「同句重字」那一笔（开关按文案存，
//   「嗯嗯，说得对」同时写在点评与回复两组里，停用任一组都会摘掉它——与站内所有 dc-off-* 同构，
//   不是本批新语义，也不是连坐 bug）
const b4 = await evalJs("(function(){try{var st=window.activeStore();var d=(window.DEFAULT_CARD_DATA||{}).interact||[];var gm=function(n){var x=d.filter(function(y){return y[0]===n;})[0];return x?x[1]:[];};var pin=gm('朋友圈·TA的点评'),rep=gm('朋友圈·TA的回复');var shared=rep.filter(function(c){return pin.indexOf(c)>=0;}).length;var before=window.getPresetGroupLines('朋友圈·TA的回复',[]).length;st.set('dc-groups-off',JSON.stringify({interact:['朋友圈·TA的点评']}));var off=window.getPresetGroupLines('朋友圈·TA的点评',[]);var other=window.getPresetGroupLines('朋友圈·TA的回复',[]).length;st.remove('dc-groups-off');var backPin=window.getPresetGroupLines('朋友圈·TA的点评',[]).length;var backRep=window.getPresetGroupLines('朋友圈·TA的回复',[]).length;return {shared:shared,before:before,off:off.length,other:other,backPin:backPin,backRep:backRep,pinLen:pin.length};}catch(e){return{err:String(e)};}})()");
ok('B4 整组停用生效：该组清空、撤停用能恢复', !!b4 && b4.off === 0 && b4.backPin === b4.pinLen && b4.backRep === b4.before, b4);
ok('B4b 隔壁组只少「两组共有的同句」（按文案存的开关，不是连坐）',
  !!b4 && b4.before - b4.other === b4.shared && b4.shared === 1, b4);

// B5 全关＝真停用，不回落代码兜底数组
const b5 = await evalJs("(function(){try{var st=window.activeStore();var all=window.getPresetGroupLines('贴贴·婉拒',[]);all.forEach(function(c){st.set('dc-off-interact:'+c,'1');});var after=window.getPresetGroupLines('贴贴·婉拒',['兜底甲','兜底乙','兜底丙','兜底丁']);st.remove('dc-groups-off');all.forEach(function(c){st.remove('dc-off-interact:'+c);});return {before:all.length,afterLen:after.length,leaked:after.length>0};}catch(e){return{err:String(e)};}})()");
ok('B5 一组全关＝返回空数组（真停用），绝不回落兜底句', !!b5 && b5.before === 4 && b5.afterLen === 0, b5);

// B7 端到端·回应：库里只留一句，同意贴贴后 TA 说的必须正是那句
const b7 = await evalJs("(function(){try{var st=window.activeStore();var g=window.getPresetGroupLines('贴贴·回应',[]);var keep=g[g.length-1];g.forEach(function(c){if(c!==keep)st.set('dc-off-interact:'+c,'1');});window.__b7keep=keep;window.__tiOrig=window.taInvitePickAny;window.taInvitePickAny=function(){return {kind:'cuddle',text:'想贴贴了，你可以过来一点吗？'};};window.__b7n0=(window.getChatMsgs()||[]).length;return {ok:!!window.triggerTaInviteNow&&window.triggerTaInviteNow(),keep:keep};}catch(e){return{err:String(e)};}})()");
await sleep(1900);
await evalJs("(function(){var mask=document.getElementById('modal-mask');if(!mask||mask.hidden)return 1;var btns=mask.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.trim()==='同意'){btns[i].click();break;}}var okb=mask.querySelector('.modal-btn.ok');if(okb)okb.click();return 1;})()");
await sleep(2600);
const b7r = await evalJs("(function(){try{var a=window.getChatMsgs();var rec=a[a.length-1];var keep=window.__b7keep;var g=window.getPresetGroupLines('贴贴·回应',[]);(window.__tiOrig)&&(window.taInvitePickAny=window.__tiOrig);var st=window.activeStore();['嗯……蹭到了。暖暖的，很喜欢。','那我要贴很久哦，不许偷偷跑掉。','手被握住了，就这样待一会儿。','感觉到了，你在旁边。很安心。'].forEach(function(c){st.remove('dc-off-interact:'+c);});return {last:rec?String(rec.text||''):'',side:rec&&rec.side,keep:keep,poolNow:window.getPresetGroupLines('贴贴·回应',[]).length,len:a.length,n0:window.__b7n0};}catch(e){return{err:String(e)};}})()");
ok('B7 端到端·回应：库里只留一句，同意后 TA 说的正是那句（开关真驱动了发出的话）',
  !!b7r && b7r.side === 'in' && !!b7r.keep && String(b7r.last).indexOf(b7r.keep) >= 0 && b7r.poolNow === 5, { b7, b7r });

// B8 端到端·婉拒：只留一句，拒绝后我方气泡正是那句
const b8 = await evalJs("(function(){try{var st=window.activeStore();var g=window.getPresetGroupLines('贴贴·婉拒',[]);var keep=g[0];g.forEach(function(c){if(c!==keep)st.set('dc-off-interact:'+c,'1');});window.__b8keep=keep;window.__tiOrig2=window.taInvitePickAny;window.taInvitePickAny=function(){return {kind:'cuddle',text:'想贴贴了，你可以过来一点吗？'};};return {ok:!!window.triggerTaInviteNow&&window.triggerTaInviteNow(),keep:keep};}catch(e){return{err:String(e)};}})()");
await sleep(1900);
await evalJs("(function(){var mask=document.getElementById('modal-mask');if(!mask||mask.hidden)return 1;var btns=mask.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.trim()==='拒绝'){btns[i].click();break;}}var okb=mask.querySelector('.modal-btn.ok');if(okb)okb.click();return 1;})()");
await sleep(2600);
const b8r = await evalJs("(function(){try{var a=window.getChatMsgs();var keep=window.__b8keep;var out=null;for(var i=a.length-1;i>=0;i--){var m=a[i];if(m&&m.side==='out'&&String(m.text||'').indexOf(keep)>=0){out=m;break;}}var st=window.activeStore();['下次再贴吧，先记着这笔~','等会儿补给你，说话算数','先欠着，攒到晚上一起还~','今天想先自己待会儿，明天加倍还你'].forEach(function(c){st.remove('dc-off-interact:'+c);});if(window.__tiOrig2)window.taInvitePickAny=window.__tiOrig2;return {found:!!out,text:out?String(out.text||''):'',poolNow:window.getPresetGroupLines('贴贴·婉拒',[]).length};}catch(e){return{err:String(e)};}})()");
ok('B8 端到端·婉拒：库里只留一句，拒绝后发的正是那句',
  !!b8r && b8r.found === true && b8r.poolNow === 4, { b8, b8r });

// B9 真 UI 闭环：在【其他互动功能字卡→互动回应】页里搜这句 → 点它那一行的开关 → 取句池真的少一句
//   （证「库里看得到／搜得到／点得动」三件事都来自新数据源，而不是旧的模块自登记钩子）
await evalJs("(function(){try{document.querySelectorAll('.page').forEach(function(p){p.hidden=true;});var lib=document.getElementById('page-chatcard');if(lib)lib.hidden=false;var li=document.getElementById('li-fun-cards');if(li)li.click();var tab=document.querySelector('#fc-tabs .cc-tab[data-type=\"interact\"]');if(tab)tab.click();var inp=document.getElementById('fc-search-input');if(inp){inp.value='感觉到了，你在旁边';inp.dispatchEvent(new Event('input',{bubbles:true}));}return 1;}catch(e){return String(e);}})()");
await sleep(900);
// ⚠ 这一页的搜索是「跨全库」的（v3.26.x），命中行可能属于别的分类——所以判据不能是「第一个命中行」，
//   必须按整句精确取那一行，并核对写下去的键确实是 dc-off-interact:<那句>（写错分类＝真 bug）。
const b9 = await evalJs("(function(){try{var S='感觉到了，你在旁边。很安心。';var items=Array.prototype.slice.call(document.querySelectorAll('#fc-list .cc-item'));var hit=null;items.forEach(function(el){if(!hit&&String(el.textContent||'').indexOf(S)>=0)hit=el;});if(!hit)return {found:false,rows:items.length,hits:items.map(function(el){return String(el.textContent||'').replace(/\\s+/g,' ').slice(0,26);})};var txt=String(hit.textContent||'').replace(/\\s+/g,' ').trim();var snap=function(){var o=[];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf(':dc-off-')>=0)o.push(k.split(':dc-off-')[1]+'='+(localStorage.getItem(k)||''));}return o.sort();};var s0=snap();var cb=hit.querySelector('input');if(!cb)return{found:true,noInput:true,txt:txt.slice(0,40)};var before=window.getPresetGroupLines('贴贴·回应',[]).length;cb.click();var s1=snap();var pool=window.getPresetGroupLines('贴贴·回应',[]);var gone=pool.indexOf(S)<0;var added=s1.filter(function(x){return s0.indexOf(x)<0;});var cb2=hit.querySelector('input');if(cb2)cb2.click();var s2=snap();var back=window.getPresetGroupLines('贴贴·回应',[]).length;return {found:true,rows:items.length,txt:txt.slice(0,44),before:before,after:pool.length,gone:gone,back:back,added:added,reEnabled:(s2.indexOf('interact:'+S+'=0')>=0)};}catch(e){return{err:String(e)};}})()");
// 再点回来时站内写的是 '0'（不是删键）——所有 dc-off-* 都这副样子，判据按「值回到 0」而非「键消失」
ok('B9 库内点那一行的小开关＝真驱动取句池（写的是 dc-off-interact:<那句>=1，再点回到 0、池子恢复）',
  !!b9 && b9.found === true && b9.gone === true && b9.after === b9.before - 1 && b9.back === b9.before &&
  b9.added.length === 1 && b9.added[0] === 'interact:' + '感觉到了，你在旁边。很安心。=1' && b9.reEnabled === true, b9);

// B10 撤掉旧钩子后「搜得到」没丢：字卡库列表页的跨分类搜索仍命中这句，且来源是库（默认聊天字卡
//   那条登记项遍历 DEFAULT_CARD_DATA 全部分类），而不是已被删掉的模块自登记钩子（防重复列两行）
const b10 = await evalJs("(function(){try{var fns=window.__cardSearchFns||[];var q='感觉到了，你在旁边';var hits=[];fns.forEach(function(r){try{(r.fn(q)||[]).forEach(function(x){if(String(x.t||'').indexOf(q)>=0)hits.push({mod:r.name,cat:x.cat});});}catch(e){}});return {hits:hits,regNames:fns.map(function(x){return x.name;})};}catch(e){return{err:String(e)};}})()");
ok('B10 库内搜索仍命中这句，且来源＝遍历字卡库数据的那条登记（旧自登记钩子已不再重复列）',
  !!b10 && b10.hits.length === 1 && b10.hits[0].mod === '默认聊天字卡' && b10.regNames.indexOf('朋友圈互动') < 0, b10);

// B6 锁豁免：锁定后「库里看不到」但「TA 照样会说」
const b6 = await evalJs("(function(){try{window.xyStore('xy-home-v2').set('cardlock-state','locked');var open=window.cardLockOpen();var drawn=window.getPresetGroupLines('贴贴·回应',[]).length;var browsable=(window.getDefaultCardGroups&&window.getDefaultCardGroups('interact')||[]).length;var invitelock=window.getLibPool?window.getLibPool('interact','贴贴·回应',[]).length:-1;window.xyStore('xy-home-v2').set('cardlock-state','open');return {open:open,drawn:drawn,browsable:browsable,invitelock:invitelock,reopen:window.cardLockOpen()};}catch(e){return{err:String(e)};}})()");
ok('B6 作者定的口径＝浏览受锁、回应不受锁（锁定：库里 0 组、取句仍 5 句；对照：未豁免的 getLibPool 给 0）',
  !!b6 && b6.open === false && b6.browsable === 0 && b6.invitelock === 0 && b6.drawn === 5 && b6.reopen === true, b6);
ok('Z1 全程零未捕获异常', exceptions.length === 0, exceptions.slice(0, 2));

if (MUT) {
  const hit = ['B3 逐句开关生效：关一句少一句，且写回后能恢复（不是假绿）', 'B4 整组停用生效：该组清空、撤停用能恢复',
    'B5 一组全关＝返回空数组（真停用），绝不回落兜底句', 'B7 端到端·回应：库里只留一句，同意后 TA 说的正是那句（开关真驱动了发出的话）',
        'B8 端到端·婉拒：库里只留一句，拒绝后发的正是那句',
    'B9 库内点那一行的小开关＝真驱动取句池（写的是 dc-off-interact:<那句>=1，再点回到 0、池子恢复）'];
  const wentRed = hit.filter((n) => reds.indexOf(n) >= 0).length;
  ok('M2 变异稿（摘掉开关过滤）确实让 B3/B4/B5/B7/B8 变红＝尺子真在量开关', wentRed >= 4, { wentRed, reds });
}

try { chrome.kill('SIGKILL'); } catch (e) {}
try { server.close(); } catch (e) {}
try { rmSync(tmpRoot, { recursive: true, force: true }); rmSync(profile, { recursive: true, force: true }); } catch (e) {}
console.log('\n' + (MUT ? '[变异稿] ' : '[本批稿] ') + '结果: ' + pass + ' 通过 / ' + fail + ' 失败');
if (!MUT) process.exit(fail ? 1 : 0);
