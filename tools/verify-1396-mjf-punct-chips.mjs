// ===== 专项验证 #1396：梦角自由造句「可用标点」= 与 #650/#712 同款 chips 池 =====
// 用户原话（2026-09-29）：「梦角自由造句（截字重造句）的可用标点（空格分隔）与【每条消息使用多字卡
//   回复拼接随机标点：拼接符号 空格 ， 。 ！ ？ ...... —— 换行 ＋】的不一样」「设计不完整」。
// 旧形态是一个 132px 文本框：看不见有哪些候选、永远选不到「空格/换行」（按空白切分＋保存时把换行
//   替成空格）、没有去重与校验、留空还静默回落默认池、句号靠「在默认池里写三遍」加权。
// 本尺锁定改后的不可回退性质（真·浏览器里点真·chip，走真·replyCfg→dreamFreePick 那条链）：
//   U0 设置页 craft 面板里那一行是 .ppy-chips 容器（不是 input）；
//   U1 内置十枚顺序/文案＝空格/，/。/！/？/....../——/换行/~/……（与「拼接符号」同一套 ＋ 两枚句尾专用），
//      从没配置过时的点亮态＝老默认池的去重集（。 ~ ！ ……）；
//   U2 没点过 chip ⇒ 新键不落盘、出句池逐字等于 #953 那个默认池（含句号写三遍）＝存量零变化；
//   U3 旧文本框配过的池（reply-mjf-punct-pool 原串）⇒ 点亮态按旧串显示、旧串仍是唯一判据（不写新键）；
//   U4/U5 点一下取消并整套落盘、再点恢复，toast 逐字反馈；
//   U6 至少保留一枚（关掉最后一枚被拦、不落盘）；
//   U7/U8 「＋」添加自定义（去重／超 6 字被拦／与内置同值被拦）、点本体开关、点「×」删除；
//   U10 「句尾标点」开关关掉 ⇒ chips 置灰＋整行 .45＋出句池为 null（不补标点），重新打开解除＝U10b；
//   U11 端到端：用点出来的「！」单枚池 ⇒ 真·dreamFreePick 出句 40/40 以「！」收尾；
//   U12 全程零未捕获异常；
//   U13 390 宽下十一枚药丸全在本行内、自动换行、无溢出与零尺寸；
//   U14 跨桌面读出（replyCfgFor）同样带这串。
// 用法：MOCHI_ROOT=<副本> node tools/verify-1396-mjf-punct-chips.mjs
//   绿侧＝含本批 src 且已 build 的副本；RED 对照＝同 tip 纯 HEAD 副本（U0~U11 与 U13/U14 应红在
//   「那一栏还是文本框／新键没人附带／池整条不认」，U0 与 U13 的读数逐字就是症状本体；
//   U10b 与 U12 两侧同绿＝旧语义未动、全程零异常）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const RW = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let page = '';
try { page = readFileSync(join(RW, 'index.html'), 'utf8'); } catch (e) {}
if (!page) { console.log('SKIP: 找不到 ' + join(RW, 'index.html') + '（请指向已构建的副本）'); process.exit(2); }
console.log('# 验证对象：' + join(RW, 'index.html') + '（' + page.length + ' 字节）');

// ⚠ 产物形态：JS 早已外置（index.html 里 85 个 <script src="js/*.js">），所以本尺必须把整个副本
//   目录当静态站伺服，只递一个 index.html 会「容器在、JS 全没跑」＝假红（verify-punct-chips 那族
//   尺子的存量红就是这个来路）。
const server = createServer((q, r) => {
  try {
    const p = decodeURIComponent((q.url || '/').split('?')[0]);
    if (p === '/blank.html') { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<html><body>b</body></html>'); return; }
    const rel = p.replace(/^\/+/, '').replace(/\.\./g, '');
    const f = join(RW, rel === '' ? 'index.html' : rel);
    if (!f.startsWith(RW)) { r.writeHead(403); r.end(); return; }
    const ct = /\.js$/.test(f) ? 'text/javascript;charset=utf-8' : /\.css$/.test(f) ? 'text/css;charset=utf-8'
      : /\.json$/.test(f) ? 'application/json' : /\.svg$/.test(f) ? 'image/svg+xml' : /\.png$/.test(f) ? 'image/png' : 'text/html;charset=utf-8';
    r.writeHead(200, { 'Content-Type': ct }); r.end(readFileSync(f));
  } catch (e) { try { r.writeHead(404); r.end(); } catch (e2) {} }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const cands = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const cp = cands.find(p => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!cp) { console.log('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
const tmp = join(os.tmpdir(), 'verify1396-' + Date.now()); const port = 13200 + Math.floor(Math.random() * 90);
const ch = spawn(cp, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + tmp, '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 100; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
    const pg = l.find(t => t.type === 'page');
    if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; }
  } catch (e) {}
  await sleep(150);
}
const cdp = (m, p = {}) => { const i = ++id; return new Promise(r => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); }); };
async function ev(e) {
  const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return { __exc: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
  return r && r.result ? r.result.value : null;
}
const results = [];
const chk = (n, ok, d) => { results.push(ok); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  [' + String(d).slice(0, 300) + ']')); };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: base + '/blank.html' }); await sleep(400);
await cdp('Page.navigate', { url: base + '/index.html' }); await sleep(2500);
// 环境闸：JS 真跑起来了没（没起来＝站没伺服对，不是回归，给 SKIP/2 而不是堆一串假红）
const boot = await ev("(function(){return JSON.stringify({cfg:typeof window.replyCfg,dream:typeof window.dreamFreePick,ready:!!window.__mochiDataReady,err:(window.__jsErrors||[]).slice(0,2)});})()");
if (!/"cfg":"function"/.test(String(boot))) {
  console.log('SKIP: 页面 JS 未运行（环境不满足，不算回归）→ ' + boot);
  ch.kill(); try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {} server.close();
  process.exit(2);
}

// 打开「回复设置 → 拼字造句」面板（梦角自由造句那一组）。开屏/弹窗按 #1390 那批的教训真收掉。
async function openCraft() {
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady') === true) break; await sleep(300); }
  await ev("(function(){var mm=document.getElementById('splash-mandatory');if(mm&&!mm.hidden){var men=document.getElementById('splash-mandatory-enter');if(men)men.click();}var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide')){sp.classList.add('hide');sp.hidden=true;}return true;})()");
  await sleep(400);
  await ev("(function(){var ok=document.getElementById('modal-ok');var m=document.getElementById('modal-mask');if(m&&!m.hidden){if(ok)ok.click();if(!m.hidden){m.hidden=true;m.style.display='none';}}return true;})()");
  await sleep(200);
  return ev(`(function(){
    var page=document.getElementById('page-reply-settings'); if(!page) return 'no-page';
    [].forEach.call(document.querySelectorAll('.page'),function(p){ p.hidden = (p!==page); });
    var tab=page.querySelector('.rps-tab[data-rps="craft"]'); if(tab) tab.click();
    var box=document.getElementById('mjf-punct-pool'); if(!box) return 'no-box';
    var pan=box.closest ? box.closest('.rps-panel') : null; if(pan) pan.hidden=false;
    return box.tagName;
  })()`);
}
const craftTag = await openCraft();
chk('U0 那一行是 chips 容器（DIV.ppy-chips）而不是文本框', String(craftTag) === 'DIV', '容器 tagName=' + JSON.stringify(craftTag));

const chipState = () => ev(`(function(){
  var box=document.getElementById('mjf-punct-pool'); if(!box) return 'no-box';
  var b=[].map.call(box.querySelectorAll('.ppy-chip[data-p]'),function(c){return c.dataset.p+':'+(c.classList.contains('sel')?'1':'0');});
  var t=[].map.call(box.querySelectorAll('.ppy-chip[data-p]'),function(c){return c.textContent;});
  var c=[].map.call(box.querySelectorAll('.ppy-chip[data-i]'),function(x){return x.dataset.i+':'+x.textContent.replace('×','')+':'+(x.classList.contains('sel')?'1':'0');});
  var st=null; for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i); if(/reply-mjf-punct-set$/.test(k)) st=localStorage.getItem(k);}
  var legacy=null; for(var j=0;j<localStorage.length;j++){var k2=localStorage.key(j); if(/reply-mjf-punct-pool$/.test(k2)) legacy=localStorage.getItem(k2);}
  return JSON.stringify({n:b.length,order:t.join('/'),chips:b.join(','),cust:c.join('|'),store:st,legacy:legacy,
    cfgSet:(window.replyCfg?window.replyCfg()['mjf-punct-set']:'no-cfg'),
    pool:typeof window.dreamFreePunctPool==='function'?JSON.stringify(window.dreamFreePunctPool(window.replyCfg?window.replyCfg():{})):'no-fn',
    toast:(document.getElementById('cc-toast')||{}).textContent||''});
})()`);
const clickP = (p) => ev(`(function(){var c=document.querySelector('#mjf-punct-pool .ppy-chip[data-p="${p}"]');if(!c)return 'no-chip';c.click();return 'ok';})()`);
const parse = s => { try { return JSON.parse(String(s)); } catch (e) { return {}; } };
const j = v => JSON.stringify(v);

const S1 = parse(await chipState());
chk('U1 内置十枚、顺序与文案＝空格/，/。/！/？/....../——/换行/~/……', S1.n === 10 && S1.order === '空格/，/。/！/？/....../——/换行/~/……', j(S1));
chk('U1b 没配置过时点亮态＝老默认池那一集（。 ~ ！ …… 四枚）', S1.chips === 'sp:0,dou:0,per:1,ex:1,q:0,el:0,dash:0,nl:0,tilde:1,ell:1', S1.chips);
chk('U2 未点过 chip＝新键不落盘，而旧池仍是默认池（句号写三遍一字未动）', S2ok(S1), j(S1));
function S2ok(o) {
  return (o.store == null || o.store === '' || o.store === 'undefined') && (o.legacy == null || o.legacy === '')
    && o.pool === '["。","。","。","~","！","……"]';
}

// U3 旧文本框配过的池 → 点亮态按旧串显示，且仍然不写新键（存量不被动）
await ev("(function(){var s=window.activeStore();s.set('reply-mjf-punct-pool','！ ？');document.dispatchEvent(new Event('contact-switched'));return true;})()");
await sleep(200);
const S3 = parse(await chipState());
chk('U3 旧串「！ ？」→ 点亮态显示为 ！/？ 两枚、新键仍不落盘、出句池就是这两枚',
  S3.chips === 'sp:0,dou:0,per:0,ex:1,q:1,el:0,dash:0,nl:0,tilde:0,ell:0' && (S3.store == null || S3.store === '' || S3.store === 'undefined') && S3.pool === '["！","？"]', j(S3));

// U4/U5 点一下取消（整套落盘）、再点恢复
await clickP('q'); await sleep(160);
const S4 = parse(await chipState());
chk('U4 点「？」取消选中 → 整套池落盘（十项、q 为 0）且出句池只剩「！」',
  S4.chips === 'sp:0,dou:0,per:0,ex:1,q:0,el:0,dash:0,nl:0,tilde:0,ell:0' && S4.pool === '["！"]' && /"s":"？","on":0/.test(String(S4.store)) && /句尾标点 ？/.test(S4.toast) && /（关）/.test(S4.toast), j(S4));
chk('U4b 落盘的就是十枚内置整套（旧串那两枚没被丢＝迁移不丢配置）', (String(S4.store).match(/"s":/g) || []).length === 10 && String(S4.store).indexOf('"s":"。","on":0') > -1, S4.store);
await clickP('q'); await sleep(160);
const S5 = parse(await chipState());
chk('U5 再点「？」恢复选中、落盘 on=1、toast 提示已开启', /"s":"？","on":1/.test(String(S5.store)) && /（开）/.test(S5.toast), j(S5));

// U6 至少保留一枚：先把「？」关掉，只剩「！」亮着，再点「！」应被拦下
await clickP('q'); await sleep(140);
const S6pre = parse(await chipState());
await clickP('ex'); await sleep(160);
const S6 = parse(await chipState());
chk('U6a 只剩一枚亮着时关掉它被拦下（提示至少保留一枚）',
  S6pre.pool === '["！"]' && /至少保留一枚/.test(S6.toast), j({ S6pre, S6 }));
chk('U6b 拦下之后落盘与出句池都仍是「！」一枚（没被写坏）',
  /"s":"！","on":1/.test(String(S6.store)) && S6.pool === '["！"]', j(S6));

// U7 「＋」添加自定义：正常添加 / 与内置同值被拒 / 重复被拒 / 超 6 字被拒
async function addCustom(val) {
  await ev(`(function(){var b=document.getElementById('mjfp-add');if(!b)return 'no-add';b.click();var i=document.getElementById('modal-input');if(!i)return 'no-input';i.value=${JSON.stringify(val)};return 'set';})()`);
  await sleep(160);
  await ev("(function(){var ok=document.getElementById('modal-ok');if(ok)ok.click();return true;})()");
  await sleep(220);
}
await addCustom('!!!');
const S7 = parse(await chipState());
chk('U7 添加自定义「!!!」→ chip 出现且带 ×、选中、整套落盘、出句池含它',
  /!!!:1/.test(S7.cust) && /"s":"!!!","on":1/.test(String(S7.store)) && S7.pool === '["！","!!!"]' && /添加句尾标点 !!!/.test(S7.toast), j(S7));
await addCustom('，');
const S8 = parse(await chipState());
chk('U8a 与内置同值（，）被拒、提示点亮 chip 即可、列表不变', S8.pool === '["！","!!!"]' && /系统自带/.test(S8.toast), j(S8));
await addCustom('!!!');
const S8b = parse(await chipState());
chk('U8b 重复添加被拒（已存在）', /已存在/.test(S8b.toast) && (String(S8b.store).match(/"s":"!!!"/g) || []).length === 1, j(S8b));
await addCustom('1234567');
const S8c = parse(await chipState());
chk('U8c 超 6 个字符被拒', /最长 6 个字符/.test(S8c.toast) && S8c.pool === '["！","!!!"]', j(S8c));

// U9 自定义点本体开关（on=0 不入池）、点「×」删除
await ev("(function(){var c=document.querySelector('#mjf-punct-pool .ppy-chip[data-i]');if(c)c.click();return true;})()");
await sleep(160);
const S9 = parse(await chipState());
chk('U9a 点自定义 chip 本体＝取消选中、on=0、出句池只剩「！」', S9.pool === '["！"]' && /!!!:0/.test(S9.cust), j(S9));
await ev("(function(){var x=document.querySelector('#mjf-punct-pool .ppy-chip[data-i] .ppy-x');if(x)x.click();return true;})()");
await sleep(180);
const S10 = parse(await chipState());
chk('U9b 点「×」删除自定义（chip 消失、串里不再有它）', S10.cust === '' && S10.pool === '["！"]' && String(S10.store).indexOf('!!!') < 0, j(S10));

// U10 「句尾标点」开关关掉＝置灰 + 一枚都不补
await ev("(function(){var s=document.getElementById('mjf-punct');if(s){s.checked=false;s.dispatchEvent(new Event('change'));}return true;})()");
await sleep(240);
const S11 = parse(await ev(`(function(){
  var box=document.getElementById('mjf-punct-pool');
  var dis=[].filter.call(box.querySelectorAll('.ppy-chip'),function(c){return c.classList.contains('dis');}).length;
  var row=document.getElementById('mjf-punct-pool-row');
  return JSON.stringify({n:box.querySelectorAll('.ppy-chip').length,dis:dis,op:row?row.style.opacity:'no-row',
    pool:typeof window.dreamFreePunctPool==='function'?JSON.stringify(window.dreamFreePunctPool(window.replyCfg())):'no-fn'});
})()`));
chk('U10 关掉「句尾标点」→ 全部 chip 置灰＋整行 .45＋出句池为 null（不补任何标点）',
  S11.n > 0 && S11.dis === S11.n && S11.op === '0.45' && S11.pool === 'null', j(S11));
await ev("(function(){var s=document.getElementById('mjf-punct');if(s){s.checked=true;s.dispatchEvent(new Event('change'));}return true;})()");
await sleep(240);
const S12 = await ev("(function(){var box=document.getElementById('mjf-punct-pool');return [].filter.call(box.querySelectorAll('.ppy-chip'),function(c){return c.classList.contains('dis');}).length;})()");
chk('U10b 重新打开后解除置灰', Number(S12) === 0, 'dis=' + S12);

// U11 端到端：此刻用户用点出来的池就剩「！」一枚 ⇒ 真·dreamFreePick 出句全部以「！」收尾
const S13 = parse(await ev(`(function(){
  if(typeof window.dreamFreePick!=='function') return JSON.stringify({err:'no-pick'});
  window.getCustomCards=function(){return ['今天也要好好爱自己哦','抱抱你然后亲亲你一下','最喜欢你想你的样子了'];};
  var cfg=Object.assign({},window.replyCfg(),{'mjf-en':1,'mjf-prob':100,'mjf-src-def':0,'mjf-src-dict':0,'mjf-w-def':0,'mjf-w-dict':0,'mjf-w-cc':100});
  var out=[],bad=[];
  for(var i=0;i<40;i++){ var r=window.dreamFreePick(cfg); if(r&&typeof r.text==='string'){ out.push(r.text); if(r.text.slice(-1)!=='！') bad.push(r.text); } }
  return JSON.stringify({n:out.length,bad:bad.slice(0,3),pool:typeof window.dreamFreePunctPool==='function'?JSON.stringify(window.dreamFreePunctPool(cfg)):'no-fn',set:String(window.replyCfg()['mjf-punct-set']||'').slice(0,40)});
})()`));
chk('U11 端到端：用点出来的「！」单枚池 ⇒ 真·dreamFreePick 40/40 以「！」收尾', S13.n >= 40 && S13.bad.length === 0 && S13.pool === '["！"]', j(S13));

const errs = await ev("JSON.stringify((window.__jsErrors||[]).slice(-4))");
chk('U12 全程零未捕获异常', String(errs).length <= 2, errs);

// U13 几何：十枚＋「＋」在 390 宽的手机上必须换行排好、不越出本行与视口（药丸复用 .ppy-chips，
// 其 max-width:62% 与 flex-wrap 是本批唯一的布局依赖，改坏＝chip 被挤出手机框或压成一列）
const G = parse(await ev(`(function(){
  var box=document.getElementById('mjf-punct-pool'); if(!box) return JSON.stringify({err:'no-box'});
  var row=box.closest ? box.closest('.gs-row') : null;
  var rb=row?row.getBoundingClientRect():{left:0,right:window.innerWidth,width:window.innerWidth};
  var bb=box.getBoundingClientRect();
  var chips=[].slice.call(box.querySelectorAll('.ppy-chip'));
  var out=chips.filter(function(c){var r=c.getBoundingClientRect(); return r.left<rb.left-1||r.right>rb.right+1||r.width<6||r.height<6;}).length;
  var lines={}; chips.forEach(function(c){ lines[Math.round(c.getBoundingClientRect().top)]=1; });
  return JSON.stringify({n:chips.length,out:out,rows:Object.keys(lines).length,boxW:Math.round(bb.width),rowW:Math.round(rb.width),vw:window.innerWidth,vis:getComputedStyle(box).visibility});
})()`));
chk('U13 390 宽下十一枚药丸全部落在本行内、自动换行、无溢出与零尺寸',
  G.n >= 11 && G.out === 0 && G.rows >= 2 && G.boxW > 0 && G.boxW <= G.rowW + 1 && G.boxW <= G.vw && G.vis === 'visible', j(G));

// U14 跨桌面读出：replyCfgFor 那行附带必须在位（删掉＝别的桌面来消息时读不到自己配的点标点池，
// 静默回默认池——#953d 当年就是为这条单独设的针，本批新键同罪同罚）
const S14 = parse(await ev(`(function(){
  var cid=''; try{ var a=window.getActiveContact&&window.getActiveContact(); cid=a?(a.id||a.cid||a.c||''):''; }catch(e){}
  var mine=window.replyCfg?window.replyCfg()['mjf-punct-set']:'no-cfg';
  var theirs='no-fn'; try{ var o=window.replyCfgFor?window.replyCfgFor(cid):null; theirs=o?String(o['mjf-punct-set']):'no-obj'; }catch(e){ theirs='exc:'+e.message; }
  return JSON.stringify({cid:String(cid||''),mineType:typeof mine,theirType:typeof theirs,same:String(theirs)===String(mine),len:String(mine==null?'':mine).length});
})()`));
chk('U14 replyCfgFor 也带这串（跨桌面回复认自己桌面的池，不是 undefined）',
  S14.mineType === 'string' && S14.theirType === 'string' && S14.theirType !== 'undefined' && S14.same === true && S14.len > 0, j(S14));

ch.kill(); try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {} server.close();
const f = results.filter(x => !x).length;
console.log((f ? ('FAILED ' + f + '/' + results.length) : ('ALL PASS ' + results.length + '/' + results.length)) + '  (root=' + RW + ')');
process.exit(f ? 1 : 0);
