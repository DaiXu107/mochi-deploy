// ===== 专项验证 #694 + #712：多字卡「拼接符号」七枚内置 chips（默认全开 + 逐项开关 + 选中态不被 hover 压掉）
//       ＋ #712 内置「——」默认开、自定义符号「＋」添加 / 点本体开关 / 「×」删除、join 只取 on=1 =====
// 用户原话（2026-09-17）：「拼接符号，我需要默认空格、。！？...... 全部开启，然后用户可以自己选择开启或关闭某个」
//   ＋「现在我开关好像交互有点问题，就是这个句号点击开，点击关按钮没有颜色变化」。
// 用户原话（2026-09-18）：「拼接符号新增一个：—— 默认开启」「系统自带的不变，只能开关，但是用户可以自己添加」。
// 本脚本锁定以下不可回退的性质：
//   A 默认：七枚（空格/，/。/！/？/....../——）全部选中，含句号（此前默认 py-punct-per=0）与「——」（#712）；
//   B 逐项开关：点一下关、再点一下开，存储键即时落盘并 toast 反馈，至少保留一个；
//   C 选中态颜色：真实鼠标悬停在选中 chip 上时底色必须仍是选中色（原实现 .ppy-chip.sel
//     特异性 0,2,0 被 `.gs-row .tag:hover` 0,3,0 压掉 → 手指点上去 :hover 常驻，看着像没生效）；
//   I/J/L/M 自定义符号（#712）：「＋」弹窗添加（去重/上限/空值）、点本体开关落盘、「×」删除、
//     自定义选中时内置可全关（「至少保留一个」按内置+自定义合计判）；
//   K join 行为（#712）：只开「——」＝全拼「——」；自定义 on=1 入池、on=0 不入池；池全空回退空格。
// 用法：node tools/verify-punct-chips.mjs   （RED 对照：MOCHI_PUNCT_OLD=1 会用旧选择器口径重跑 C 门）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
// MOCHI_ROOT=<副本> 可对隔离副本（含其 index.html 产物）直测；MOCHI_PUNCT_SRC=1 强制走 src 自组装
const RW = process.env.MOCHI_ROOT ? normalize(process.env.MOCHI_ROOT) : root;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function read(p) { return readFileSync(join(RW, p), 'utf8'); }
const b = read('build.mjs');
function arrOf(n) { const m = b.match(new RegExp('const ' + n + '\\s*=\\s*\\[([\\s\\S]*?)\\]')); return m ? m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : []; }
let css = '', js = '';
for (const f of arrOf('cssFiles')) { try { css += read('src/css/' + f) + '\n'; } catch (e) {} }
for (const f of arrOf('jsFiles')) { try { js += '/* ' + f + ' */\n' + read('src/js/' + f) + '\n'; } catch (e) {} }
const RED = process.env.MOCHI_PUNCT_OLD === '1';
if (RED) {
  // RED 基线：把选中态选择器还原成修复前的裸 .ppy-chip.sel（会被 .gs-row .tag:hover 压过）
  css = css.replace(/\.ppy-chips \.ppy-chip\.sel[^{]*\{[^}]*\}/g, '')
           .replace(/\[data-theme="dark"\] \.ppy-chips \.ppy-chip\.sel[^{]*\{[^}]*\}/g, '')
           .replace('.ppy-chip.dis {', '.ppy-chip.sel { background:var(--ink,#111); color:#fff; border-color:var(--ink,#111); }\n[data-theme="dark"] .ppy-chip.sel { background:var(--btn-bg,#eee); color:var(--btn-ink,#111); border-color:var(--btn-bg,#eee); }\n.ppy-chip.dis {');
  // 默认值也退回 #650 口径（句号默认关）
  js = js.replace("'py-punct-space': 1, 'py-punct-dou': 1, 'py-punct-per': 1", "'py-punct-space': 1, 'py-punct-dou': 1, 'py-punct-per': 0");
}
let page = null;
try { if (!RED && process.env.MOCHI_PUNCT_SRC !== '1') page = read('index.html'); } catch (e) {}
const target = page ? '真实产物 index.html' : 'src 自组装';
if (!page) page = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>' + css + '</style></head><body>' + read('src/template.html') +
  '<scr' + 'ipt>window.__APP_VERSION__="t";</scr' + 'ipt><scr' + 'ipt>' + js + '</scr' + 'ipt></body></html>';
console.log('# 验证对象：' + target + (RED ? '（RED 基线：旧选择器 + 句号默认关）' : ''));
const server = createServer((q, r) => { try { const p = q.url.split('?')[0]; if (p === '/blank.html') { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<html><body>b</body></html>'); return; } if (p === '/test.html') { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(page); return; } r.writeHead(404); r.end(); } catch (e) {} });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const cands = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const cp = cands.find(p => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const tmp = join(os.tmpdir(), 'verifypunct-' + Date.now()); const port = 13100 + Math.floor(Math.random() * 90);
const ch = spawn(cp, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + tmp, '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 100; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find(t => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
const cdp = (m, p = {}) => { const i = ++id; return new Promise(r => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); }); };
async function ev(e) { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return { __exc: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text }; return r && r.result ? r.result.value : null; }
const results = [];
const chk = (n, ok, d) => { results.push(ok); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  [' + String(d).slice(0, 300) + ']')); };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: base + '/blank.html' }); await sleep(400);

// 打开「回复设置 → 字卡与概率」页并把 statusbar/开屏收掉（并行在途稿会干扰点击）
async function openPage() {
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady') === true) break; await sleep(300); }
  await ev("(function(){var mm=document.getElementById('splash-mandatory');if(mm&&!mm.hidden){var men=document.getElementById('splash-mandatory-enter');if(men)men.click();}var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide')){sp.classList.add('hide');sp.hidden=true;}return true;})()");
  await sleep(400);
  await ev("(function(){var ok=document.getElementById('modal-ok');var m=document.getElementById('modal-mask');if(m&&!m.hidden){if(ok)ok.click();if(!m.hidden){m.hidden=true;m.style.display='none';}}return true;})()");
  await sleep(200);
  return ev(`(function(){
    var page=document.getElementById('page-reply-settings'); if(!page) return 'no-page';
    [].forEach.call(document.querySelectorAll('.page'),function(p){ p.hidden = (p!==page); });
    var tab=page.querySelector('.rps-tab[data-rps="cards"]'); if(tab) tab.click();
    var box=document.getElementById('ppy-chips'); if(!box) return 'no-box';
    var pan=box.closest('.rps-panel'); if(pan) pan.hidden=false;
    return 'ok';
  })()`);
}
await cdp('Page.navigate', { url: base + '/test.html' }); await sleep(2500);
chk('S0 回复设置页可打开、pply-chips 存在', (await openPage()) === 'ok', 'open-failed');

// ---- A. 默认七枚全开（含句号 #694、含「——」#712） ----
const A = await ev(`(function(){
  var box=document.getElementById('ppy-chips');
  var chips=[].map.call(box.querySelectorAll('.ppy-chip[data-k]'),function(c){return c.dataset.k+':'+(c.classList.contains('sel')?'1':'0');});
  var cfg=window.replyCfg?window.replyCfg():{};
  return JSON.stringify({ n:box.querySelectorAll('.ppy-chip[data-k]').length, chips:chips.join(','),
    def:['py-punct-space','py-punct-dou','py-punct-per','py-punct-ex','py-punct-q','py-punct-el','py-punct-dash','py-punct-nl'].map(function(k){return cfg[k];}).join(','),
    en:cfg['py-punct-en'] });
})()`);
const oA = JSON.parse(String(A));
chk('A1 八枚符号 chip 顺序为 空格/，/。/！/？/....../——/换行（#1198 末枚默认关）', oA.n === 8 && oA.chips === 'py-punct-space:1,py-punct-dou:1,py-punct-per:1,py-punct-ex:1,py-punct-q:1,py-punct-el:1,py-punct-dash:1,py-punct-nl:0', A);
chk('A2 默认配置：七键全为 1（含句号 py-punct-per、「——」py-punct-dash）＋#1198「换行」默认 0', oA.def === '1,1,1,1,1,1,1,0', A);
chk('A3 拼接随机标点总开关默认开', oA.en === 1, A);

// ---- C1. 真实悬停：选中态不被 hover 压掉 ----
async function chipRect(k) {
  return ev(`(function(){
    var c=document.querySelector('#ppy-chips .ppy-chip[data-k="${k}"]');
    c.scrollIntoView({block:'center'});
    var r=c.getBoundingClientRect();
    return { x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2), top:Math.round(r.top), bottom:Math.round(r.bottom), ih:window.innerHeight };
  })()`);
}
const bg = (k) => ev(`(function(){var c=document.querySelector('#ppy-chips .ppy-chip[data-k="${k}"]');var s=getComputedStyle(c);return JSON.stringify({bg:s.backgroundColor,color:s.color});})()`);
const hover = async (k) => { const r = await chipRect(k); await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y, button: 'none', buttons: 0 }); await sleep(140); };
const hoverNone = async () => { await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2, button: 'none', buttons: 0 }); await sleep(140); };
const clickKey = (k) => ev(`(function(){document.querySelector('#ppy-chips .ppy-chip[data-k="${k}"]').click();return true;})()`);
await hoverNone();
const selBase = JSON.parse(String(await bg('py-punct-per')));          // 「。」选中·未悬停
chk('C0 「。」默认即选中态（底色为深色、非透明）', selBase.bg === 'rgb(17, 17, 17)' && selBase.color === 'rgb(255, 255, 255)', JSON.stringify(selBase));
await clickKey('py-punct-dou'); await hoverNone();
const unselBase = JSON.parse(String(await bg('py-punct-dou')));        // 「，」未选中·未悬停
chk('C2 选中态与未选中态底色可辨（不再一模一样）', selBase.bg !== unselBase.bg, JSON.stringify({ selBase, unselBase }));
await clickKey('py-punct-dou'); await hover('py-punct-dou');
const selHover = JSON.parse(String(await bg('py-punct-dou')));         // 「，」选中·悬停（bug 现场：旧版会变浅灰）
chk('C1 悬停在选中的 chip 上底色仍是选中色（原 bug：被 :hover 浅灰压掉）', selHover.bg === selBase.bg && selHover.color === selBase.color,
  JSON.stringify({ selBase, selHover, unselBase }));

// ---- B. 逐项开关（指针停在 chip 上的点按场景） ----
await hover('py-punct-per');
await clickKey('py-punct-per'); await sleep(140);
const B1 = await ev(`(function(){var c=document.querySelector('#ppy-chips .ppy-chip[data-k="py-punct-per"]');
  var st=null; for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i); if(/reply-py-punct-per$/.test(k)) st=localStorage.getItem(k);}
  return JSON.stringify({ sel:c.classList.contains('sel'), store:st, cfg:window.replyCfg()['py-punct-per'],
    toast:(document.getElementById('cc-toast')||{}).textContent||'' });})()`);
const oB1 = JSON.parse(String(B1));
chk('B1 点「。」即取消选中并落盘 0、toast 提示已关闭', oB1.sel === false && oB1.cfg === 0 && String(oB1.store) === '0' && /拼接符号 。/.test(oB1.toast) && /（关）/.test(oB1.toast), B1);
const bgPerOff = JSON.parse(String(await bg('py-punct-per'))); // 指针仍停在上面（:hover 常驻）
chk('B2 取消选中后「。」底色立刻变为非选中色（hover 常驻也不变回选中样）', bgPerOff.bg !== selBase.bg, JSON.stringify({ bgPerOff, selBase }));
await clickKey('py-punct-per'); await sleep(140);
const B3 = await ev(`(function(){var c=document.querySelector('#ppy-chips .ppy-chip[data-k="py-punct-per"]');
  var st=null; for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i); if(/reply-py-punct-per$/.test(k)) st=localStorage.getItem(k);}
  return JSON.stringify({ sel:c.classList.contains('sel'), store:st, cfg:window.replyCfg()['py-punct-per'],
    toast:(document.getElementById('cc-toast')||{}).textContent||'' });})()`);
const oB3 = JSON.parse(String(B3));
chk('B3 再点「。」恢复选中、落盘 1、toast 提示已开启', oB3.sel === true && oB3.cfg === 1 && String(oB3.store) === '1' && /（开）/.test(oB3.toast), B3);
const bgPerOn = JSON.parse(String(await bg('py-punct-per')));
chk('B4 恢复选中后底色回到选中色', bgPerOn.bg === selBase.bg, JSON.stringify({ bgPerOn, selBase }));

// ---- E. 至少保留一个 ----
await clickKey('py-punct-per'); await sleep(80);
for (const k of ['py-punct-dou', 'py-punct-ex', 'py-punct-q', 'py-punct-el', 'py-punct-dash']) { await clickKey(k); await sleep(60); }
const E1 = JSON.parse(String(await ev(`(function(){
  document.querySelector('#ppy-chips .ppy-chip[data-k="py-punct-space"]').click();
  var c=document.querySelector('#ppy-chips .ppy-chip[data-k="py-punct-space"]');
  return JSON.stringify({ sel:c.classList.contains('sel'), cfg:window.replyCfg()['py-punct-space'], toast:(document.getElementById('cc-toast')||{}).textContent||'' });
})()`)));
chk('E1 关掉最后一枚时被拦下（保持选中 + 提示至少保留一个）', E1.sel === true && E1.cfg === 1 && /至少保留一个/.test(E1.toast), JSON.stringify(E1));

// 恢复全开，供 F（持久化）用
for (const k of ['py-punct-space', 'py-punct-dou', 'py-punct-per', 'py-punct-ex', 'py-punct-q', 'py-punct-el', 'py-punct-dash']) { await clickKey(k); await sleep(60); }
await clickKey('py-punct-per'); await sleep(120); // 「。」再次关掉，验证重载后仍记得

// ---- F. 持久化：重载后逐项状态被记住 ----
await cdp('Page.reload'); await sleep(2500);
await openPage();
const F = JSON.parse(String(await ev(`(function(){
  var cfg=window.replyCfg();
  return JSON.stringify({ per:cfg['py-punct-per'], others:['py-punct-space','py-punct-dou','py-punct-ex','py-punct-q','py-punct-el','py-punct-dash'].map(function(k){return cfg[k];}).join(','),
    selPer:document.querySelector('#ppy-chips .ppy-chip[data-k="py-punct-per"]').classList.contains('sel'),
    selN:document.querySelectorAll('#ppy-chips .ppy-chip.sel').length });
})()`)));
chk('F1 重载后「。」仍是用户关闭的状态（存储生效、不回到默认）', F.per === 0 && F.selPer === false, JSON.stringify(F));
chk('F2 重载后其余六枚仍选中（6 枚 sel，无自定义 chip）', F.others === '1,1,1,1,1,1' && F.selN === 6, JSON.stringify(F));

// ---- I. #712 内置「——」逐项开关（与其他内置同款：点关→落盘 0，点开→落盘 1） ----
await clickKey('py-punct-dash'); await sleep(140);
const I1 = JSON.parse(String(await ev(`(function(){
  var c=document.querySelector('#ppy-chips .ppy-chip[data-k="py-punct-dash"]');
  var st=null; for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i); if(/reply-py-punct-dash$/.test(k)) st=localStorage.getItem(k);}
  return JSON.stringify({ sel:c.classList.contains('sel'), store:st, cfg:window.replyCfg()['py-punct-dash'],
    toast:(document.getElementById('cc-toast')||{}).textContent||'' });})()`)));
chk('I1 点「——」取消选中、落盘 0、toast 提示已关闭', I1.sel === false && I1.cfg === 0 && String(I1.store) === '0' && /拼接符号 ——/.test(I1.toast) && /（关）/.test(I1.toast), JSON.stringify(I1));
await clickKey('py-punct-dash'); await sleep(140);
const I2 = JSON.parse(String(await ev(`(function(){
  var c=document.querySelector('#ppy-chips .ppy-chip[data-k="py-punct-dash"]');
  var st=null; for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i); if(/reply-py-punct-dash$/.test(k)) st=localStorage.getItem(k);}
  return JSON.stringify({ sel:c.classList.contains('sel'), store:st, cfg:window.replyCfg()['py-punct-dash'] });})()`)));
chk('I2 再点「——」恢复选中、落盘 1', I2.sel === true && I2.cfg === 1 && String(I2.store) === '1', JSON.stringify(I2));

// ---- J. #712 「＋」添加自定义符号（弹窗输入 → chip 出现且选中、JSON 落盘、cfg 附带） ----
async function addCustom(val) {
  await ev(`(function(){var b=document.getElementById('ppy-add');if(!b)return 'no-add';b.click();var i=document.getElementById('modal-input');if(!i)return 'no-input';i.value=${JSON.stringify(val)};return 'set';})()`);
  await sleep(140);
  await ev("(function(){var ok=document.getElementById('modal-ok');if(ok)ok.click();return true;})()");
  await sleep(200);
}
await addCustom('～');
const J = JSON.parse(String(await ev(`(function(){
  var c=document.querySelector('#ppy-chips .ppy-chip[data-c="0"]');
  var st=null; for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i); if(/reply-py-punct-custom$/.test(k)) st=localStorage.getItem(k);}
  var cfgS=window.replyCfg()['py-punct-custom'];
  return JSON.stringify({ has:!!c, txt:c?c.textContent:'', sel:c?c.classList.contains('sel'):false, store:st, cfgS:cfgS,
    toast:(document.getElementById('cc-toast')||{}).textContent||'' });})()`)));
chk('J1 添加后自定义 chip「～」出现且默认选中（带 × 删除钮）', J.has === true && J.txt === '～×' && J.sel === true, JSON.stringify(J));
chk('J2 自定义符号 JSON 落盘 [{s:～,on:1}]、随 replyCfg 附带', J.store === '[{"s":"～","on":1}]' && J.cfgS === '[{"s":"～","on":1}]', JSON.stringify(J));
chk('J3 添加 toast 提示「已保存：添加拼接符号 ～（开）」', /添加拼接符号 ～/.test(J.toast) && /（开）/.test(J.toast), JSON.stringify(J));
// 去重：内置符号值拒绝添加
await addCustom('，');
const J4 = JSON.parse(String(await ev(`(function(){
  var box=document.getElementById('ppy-chips');
  var st=null; for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i); if(/reply-py-punct-custom$/.test(k)) st=localStorage.getItem(k);}
  return JSON.stringify({ n:box.querySelectorAll('.ppy-chip[data-c]').length, toast:(document.getElementById('cc-toast')||{}).textContent||'' });})()`)));
chk('J4 与内置同值（，）被拒、提示走开关、列表不变', J4.n === 1 && /系统自带/.test(J4.toast), JSON.stringify(J4));

// ---- K. #712 join 行为：——入池、自定义 on=1 入池 / on=0 不入、池空回退空格 ----
const K = JSON.parse(String(await ev(`(function(){
  function trial(cfg){ var out=[]; for(var i=0;i<40;i++) out.push(window.pyJoinCards(['甲','乙'],cfg)); return out; }
  // #956 起「多字卡回复」（py-en）也是拼卡上游闸门：本段构造的 cfg 必须显式带 py-en:1，
  // 否则等于总开关关闭（关＝只回退空格），K 段「只开——」「自定义入池」等判据会全部失配
  var base={'py-en':1,'py-punct-en':1,'py-punct-space':0,'py-punct-dou':0,'py-punct-per':0,'py-punct-ex':0,'py-punct-q':0,'py-punct-el':0};
  var d=Object.assign({},base,{'py-punct-dash':1,'py-punct-custom':'[]'});
  var onlyDash=d?trial(d):[];
  var badDash=onlyDash.filter(function(r){return r!=='甲——乙';}).length;
  var c1=Object.assign({},base,{'py-punct-dash':0,'py-punct-custom':'[{"s":"～","on":1}]'});
  var custOn=trial(c1);
  var okCust=custOn.every(function(r){return r==='甲～乙';});
  var c2=Object.assign({},base,{'py-punct-dash':0,'py-punct-custom':'[{"s":"～","on":0}]'});
  var custOff=trial(c2);
  var okOff=custOff.every(function(r){return r==='甲 乙';});
  var c3=Object.assign({},base,{'py-punct-dash':1,'py-punct-custom':'[{"s":"～","on":1}]'});
  var both=trial(c3);
  var uniq={}; both.forEach(function(r){uniq[r]=1;});
  var okBoth=uniq['甲——乙']===1 && uniq['甲～乙']===1 && Object.keys(uniq).length===2;
  return JSON.stringify({ badDash:badDash, okCust:okCust, okOff:okOff, okBoth:okBoth });
})()`)));
chk('K1 只开「——」＝每处都拼「——」', K.badDash === 0, JSON.stringify(K));
chk('K2 自定义符号 on=1 入池（全拼「～」）', K.okCust === true, JSON.stringify(K));
chk('K3 自定义符号 on=0 不入池、池空回退空格（原行为）', K.okOff === true, JSON.stringify(K));
chk('K4 「——」+自定义同开＝两符号随机混拼（无第三种结果）', K.okBoth === true, JSON.stringify(K));

// ---- L. #712 自定义 chip 点「×」删除（chip 消失、存储收回 []） ----
await ev("(function(){var x=document.querySelector('#ppy-chips .ppy-chip[data-c=\"0\"] .ppy-x');if(x)x.click();return true;})()");
await sleep(160);
const L = JSON.parse(String(await ev(`(function(){
  var box=document.getElementById('ppy-chips');
  var st=null; for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i); if(/reply-py-punct-custom$/.test(k)) st=localStorage.getItem(k);}
  return JSON.stringify({ n:box.querySelectorAll('.ppy-chip[data-c]').length, store:st,
    toast:(document.getElementById('cc-toast')||{}).textContent||'' });})()`)));
chk('L1 点「×」即删（chip 消失、存储收回 []、toast 提示已删除）', L.n === 0 && L.store === '[]' && /已删除拼接符号/.test(L.toast), JSON.stringify(L));

// ---- M. #712 至少保留一个按「内置+自定义」合计判：自定义选中时内置可全关、删/关最后一个被拦 ----
await addCustom('###');
const M0 = JSON.parse(String(await ev(`(function(){
  var c=document.querySelector('#ppy-chips .ppy-chip[data-c="0"]');
  return JSON.stringify({ has:!!c, sel:c?c.classList.contains('sel'):false });})()`)));
chk('M0 自定义「###」已添加且选中', M0.has === true && M0.sel === true, JSON.stringify(M0));
// 注：「。」（per）在 F 段后本就是用户关闭态，这里不再点它（点了会把它打开）；其余六枚逐个关掉
for (const k of ['py-punct-space', 'py-punct-dou', 'py-punct-ex', 'py-punct-q', 'py-punct-el', 'py-punct-dash']) { await clickKey(k); await sleep(60); }
const M1 = JSON.parse(String(await ev(`(function(){
  var cfg=window.replyCfg();
  var builtinOn=['py-punct-space','py-punct-dou','py-punct-per','py-punct-ex','py-punct-q','py-punct-el','py-punct-dash'].filter(function(k){return cfg[k]===1;}).length;
  var c=document.querySelector('#ppy-chips .ppy-chip[data-c="0"]');
  return JSON.stringify({ builtinOn:builtinOn, custSel:c?c.classList.contains('sel'):false });})()`)));
chk('M1 自定义选中时，七枚内置可以全部关掉（不再被「至少一个」拦）', M1.builtinOn === 0 && M1.custSel === true, JSON.stringify(M1));
await clickKey('py-punct-dash'); await sleep(120); // 内置全关后「——」仍可点亮
const M2 = JSON.parse(String(await ev(`(function(){
  var c=document.querySelector('#ppy-chips .ppy-chip[data-k="py-punct-dash"]');
  return JSON.stringify({ sel:c.classList.contains('sel') });})()`)));
await clickKey('py-punct-dash'); await sleep(120); // 再关（自定义仍选中＝「——」非最后一个，允许）
const M3 = JSON.parse(String(await ev(`(function(){
  var c=document.querySelector('#ppy-chips .ppy-chip[data-c="0"]');
  var r={ dashSel:document.querySelector('#ppy-chips .ppy-chip[data-k="py-punct-dash"]').classList.contains('sel'),
    selBefore:c?c.classList.contains('sel'):false, toast:(document.getElementById('cc-toast')||{}).textContent||'' };
  c.click(); // 自定义是唯一选中 → 点关被拦
  var c2=document.querySelector('#ppy-chips .ppy-chip[data-c="0"]');
  r.selAfter=c2?c2.classList.contains('sel'):false;
  r.toast2=(document.getElementById('cc-toast')||{}).textContent||'';
  var st=null; for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i); if(/reply-py-punct-custom$/.test(k)) st=localStorage.getItem(k);}
  r.store=st;
  var x=c2.querySelector('.ppy-x'); if(x)x.click(); // 点 × 删除最后一个选中同样被拦
  var c3=document.querySelector('#ppy-chips .ppy-chip[data-c="0"]');
  r.delBlocked=!!c3;
  return JSON.stringify(r);})()`)));
chk('M2 内置全关后「——」仍可点亮', M2.sel === true, JSON.stringify(M2));
chk('M3 关掉最后一个选中（自定义）被拦下：选中保持、提示保留一个（「——」已先关掉）',
  M3.dashSel === false && M3.selBefore === true && M3.selAfter === true && /至少保留一个/.test(M3.toast2), JSON.stringify(M3));
chk('M4 删除最后一个选中（自定义「×」）同样被拦、存储不变',
  M3.delBlocked === true && M3.store === '[{"s":"###","on":1}]', JSON.stringify(M3));
// 收尾：点亮「空格」「，」供 G（暗色 hover 对照用 per/dou 状态差异）——per 已关、dou 重新点亮
await clickKey('py-punct-dou'); await sleep(80);

// ---- G. 暗色主题同款关系（选中色不被 hover 覆盖） ----
await ev("document.documentElement.setAttribute('data-theme','dark')");
await sleep(150);
const rPer2 = await chipRect('py-punct-per');
await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rPer2.x, y: rPer2.y, button: 'none', buttons: 0 });
await sleep(120);
const gSel = JSON.parse(String(await bg('py-punct-per')));
const gR = await chipRect('py-punct-dou');
await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gR.x, y: gR.y, button: 'none', buttons: 0 });
await sleep(120);
const gUnsel = JSON.parse(String(await bg('py-punct-dou')));
chk('G1 暗色下选中态同样不被 hover 覆盖（且与未选态可辨）', gSel.bg !== gUnsel.bg && gSel.color !== gUnsel.color, JSON.stringify({ gSel, gUnsel }));
await ev("document.documentElement.setAttribute('data-theme','light')");

// ---- H. 零未捕获异常 ----
const errs = await ev("JSON.stringify((window.__jsErrors||[]).slice(-4))");
chk('H1 全程零未捕获异常', String(errs).length <= 2, errs);

ch.kill(); try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {} server.close();
const f = results.filter(x => !x).length;
console.log((RED ? '[RED 基线] ' : '') + (f ? ('FAILED ' + f + '/' + results.length) : ('ALL PASS ' + results.length + '/' + results.length)));
process.exit(f ? 1 : 0);
