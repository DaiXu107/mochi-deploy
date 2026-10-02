// #532 字卡使用状态自检（设置→工具 #row-card-audit）行为验证（无头 Chrome，测构建产物 index.html）
// 立项：用户点名「自定义字卡 + 系统预设字卡 + 二级密码锁 + 分组分类太多，要一个统一自检系统」。
// 覆盖：①静态归属（template 工具段入口 + 独立页 + build.mjs 登记）；②打开渲染八/九节；
//   ③设置入口角标 data-ca-issues；④「一键修复」真的写回默认值（reply-dcp-all 0→100）；
//   ⑤问题行可点击跳转（data-jump 落到目标页）；⑥#page-card-audit 正确闭合不吞 tabbar；
//   ⑦#583 回复链路节（系统预设 ↔ 自定义「互补占比」口径已被改写，见 B3h/B3h2/B3j）。
//   ⑧#932 B13：整组停用（#926 的 dc-groups-off）纳入自检——角标 +1、逐分类报警点名组名、
//     内容闸按「单卡∪分组」合并、停到清空时给「启用分组」、点它确认后名单该分类清空且组内单卡值不动。
//   ⑨B10/B12e 存量误红收口：#746 起最终文件名由 device.js 的 diagExportDocx 拼装（basePrefix＋
//     ISO 时间＋.docx），旧断言拿 mock 收到的前缀查「.docx」永远红；现 B10 查前缀契约、B12e 打真链。
//   ⚠️ 本脚本跑的是构建产物；#583 的覆盖率/总档/一键恢复等行为细节在
//   tools/verify-card-audit-reply-chain.mjs（内存拼装 src，构建前后都能跑）。
// 用法：node build.mjs && node tools/verify-card-audit.mjs
// 用法（RED 基线/隔离根）：SERVE_ROOT=<目录> node tools/verify-card-audit.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.SERVE_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};

// ===== 静态 =====
const tpl = readFileSync(join(root, 'src', 'template.html'), 'utf8');
let buildSrc = '';
try { buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8'); } catch (e) {}
const iTools = tpl.indexOf('data-sec="tools"');
const iAbout = tpl.indexOf('data-sec="about"');
ok(iTools > 0 && iAbout > iTools && tpl.slice(iTools, iAbout).includes('id="row-card-audit"'), 'S1 入口 #row-card-audit 落在设置【工具】段');
ok(tpl.includes('id="page-card-audit"') && tpl.includes('id="card-audit-body"'), 'S2 独立页 #page-card-audit / #card-audit-body 存在');
ok(/jsFiles[^\n]*'card-audit\.js'/.test(buildSrc), 'S3 build.mjs 的 jsFiles 已登记 card-audit.js');
ok((readFileSync(join(root, 'src', 'js', 'settings-help.js'), 'utf8')).includes("sel: '#row-card-audit'"), 'S4 settings-help 登记了本行「功能说明」');

// ===== 行为 =====
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+（内置 WebSocket）'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vca-' + Date.now()),
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
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
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
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;s.style.display='none';}return true;})()");
await sleep(700);

// 二级锁前置（#583 起补齐）：干净 profile 里 cardlock-state 未设 → cardLockOpen() 为 false
// → 自检页把「系统预设字卡被二级密码锁整体锁停」当成本次结论，第四节据此不渲染
// `inl-dcp` 等修复按钮（注册条件带 `!lock`），B4b 会点不到按钮而假红。
// 实测（无头实测同 profile）：cardlock-state=null / cardLockOpen()=false / inl-dcp 按钮数=0。
// 本脚本要验的是「一键修复真的写回默认」，必须在解锁态下测，故这里显式置 open 并补发事件。
await evalJs("(function(){try{window.xyStore('xy-home-v2').set('cardlock-state','open');}catch(e){}document.dispatchEvent(new Event('mochi-cardlock-open'));return true;})()");
await sleep(300);
ok((await evalJs('(function(){try{return !!window.cardLockOpen();}catch(e){return null;}})()')) === true,
  'B0 前置：二级锁已置解锁态（未设键＝锁定，会让带 !lock 的修复按钮不渲染而假红）');

// B1 入口行在工具段且带角标锚
const entry = J(await evalJs(`(function(){var r=document.getElementById('row-card-audit');if(!r)return JSON.stringify({found:false});var sec=r.closest('.them-sec');return JSON.stringify({found:true,sec:sec?sec.dataset.sec:null,issues:r.getAttribute('data-ca-issues')});})()`));
ok(entry.found === true && entry.sec === 'tools', 'B1 入口行在【工具】段', JSON.stringify(entry));

// B2 打开自检页
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=true;});var s=document.getElementById('page-setting');if(s)s.hidden=false;return true;})()");
await sleep(200);
await evalJs("(function(){var r=document.getElementById('row-card-audit');if(r)r.click();return true;})()");
await sleep(1400);
const opened = J(await evalJs("(function(){var p=document.getElementById('page-card-audit');return JSON.stringify({vis:!!p&&!p.hidden, inSetting:!!(p&&p.closest&&p.closest('#page-setting'))});})()"));
ok(opened.vis === true && opened.inSetting === false, 'B2 点入口进入独立自检页', JSON.stringify(opened));

// B3 报告渲染多节
const body = await evalJs("(function(){var b=document.getElementById('card-audit-body');return b?b.textContent:'';})()") || '';
ok(body.indexOf('自检结论') >= 0, 'B3a 渲染「自检结论」节', body.slice(0, 40));
ok(body.indexOf('二级密码锁') >= 0, 'B3b 渲染「二级密码锁」节');
ok(body.indexOf('其他互动功能字卡') >= 0, 'B3c 渲染「其他互动功能字卡」节');
ok(body.indexOf('各桌面专属字卡概览') >= 0, 'B3d 渲染「各桌面概览」节');
ok(body.indexOf('卡数据健康') >= 0, 'B3e 渲染「卡数据健康」节');
const jumps = await evalJs("(function(){return document.querySelectorAll('#card-audit-body [data-jump]').length;})()");
ok(Number(jumps) >= 1, 'B3f 问题行带可点击跳转锚 (data-jump)', 'count=' + jumps);
ok(body.indexOf('平均每') >= 0, 'B3g 概率带人话换算（平均每 N 条回复 / 次触发）');
// #583：原先那节「系统预设 ↔ 自定义字卡占比」是错的（漏 dc-use-chat 场景闸、漏总档缩放、
// 也漏 csp-cust），已改写成「回复链路（回复设置 → 聊天）」。行为细节见
// tools/verify-card-audit-reply-chain.mjs（覆盖率数值 / 总档缩放 / 一键恢复 / 直达 tab）。
ok(body.indexOf('回复链路（回复设置 → 聊天）') >= 0, 'B3h 渲染「回复链路（回复设置 → 聊天）」节');
ok(body.indexOf('系统预设 ↔ 自定义字卡占比') < 0, 'B3h2 旧的「互补占比」口径已不在（回退即红）');
const ratioBars = await evalJs("(function(){return document.querySelectorAll('#card-audit-body .ca-ratio-bar').length;})()");
ok(Number(ratioBars) >= 1, 'B3i 预设覆盖率条存在', 'count=' + ratioBars);
const replyJumps = await evalJs("(function(){return document.querySelectorAll('#card-audit-body [data-jump=\"@reply:chat\"]').length;})()");
ok(Number(replyJumps) >= 1, 'B3j 回复设置侧行带「调整」直达 回复设置→聊天', 'count=' + replyJumps);

// B4 修复：确认预览弹窗 → 写回默认 → 单级撤销
await evalJs("(function(){try{window.activeStore().set('reply-dcp-all','0');window.activeStore().set('dcf-fish','0');}catch(e){}var r=document.getElementById('card-audit-refresh');if(r)r.click();return true;})()");
await sleep(1400);
const before = J(await evalJs("(function(){try{return JSON.stringify({all:window.activeStore().get('reply-dcp-all'),fish:window.activeStore().get('dcf-fish')});}catch(e){return '{}';}})()"));
ok(String(before.all) === '0', 'B4a 修复前 reply-dcp-all=0（种入生效）', JSON.stringify(before));
await evalJs("(function(){var b=document.querySelector('#card-audit-body [data-fix=\"inl-dcp\"]');if(b)b.click();return true;})()");
await sleep(400);
const cfm = J(await evalJs("(function(){var m=document.getElementById('modal-mask');var t=document.getElementById('modal-title');return JSON.stringify({open:!!m&&!m.hidden,title:t?t.textContent:''});})()"));
ok(cfm.open === true && (cfm.title || '').indexOf('确认修复') >= 0, 'B4a2 点修复弹「确认修复」预览弹窗', JSON.stringify(cfm));
await evalJs("(function(){var o=document.getElementById('modal-ok');if(o)o.click();return true;})()");
await sleep(800);
const after = await evalJs("(function(){try{return String(window.activeStore().get('reply-dcp-all'));}catch(e){return null;}})()");
ok(after === '100', 'B4b 确认后 reply-dcp-all 回到 100', 'after=' + after);
await evalJs("(function(){var u=document.getElementById('card-audit-undo');if(u)u.click();return true;})()");
await sleep(800);
const undone = await evalJs("(function(){try{return String(window.activeStore().get('reply-dcp-all'));}catch(e){return null;}})()");
ok(undone === '0', 'B4c「撤销上次」把 reply-dcp-all 还原为 0', 'undone=' + undone);

// B5 跳转：点 data-jump 跳到目标（customOwn → 字卡库/专属页）
await evalJs("(function(){var r=document.getElementById('row-card-audit');if(r)r.click();return true;})()");
await sleep(1200);
const jumped = J(await evalJs(`(function(){var el=document.querySelector('#card-audit-body [data-jump="customOwn"]');if(!el)return JSON.stringify({no:true});el.click();var audit=document.getElementById('page-card-audit');var cc=document.getElementById('page-custom-cards');return JSON.stringify({no:false,auditHidden:!!audit&&audit.hidden,ccVis:!!cc&&!cc.hidden});})()`));
ok(jumped.no === false && jumped.auditHidden === true, 'B5 点跳转后离开自检页、跳到目标页', JSON.stringify(jumped));

// B6 结构兜底：#page-card-audit 未吞 tabbar
const nest = J(await evalJs("(function(){var tb=document.querySelector('.tabbar');var p=document.getElementById('page-card-audit');return JSON.stringify({inside:!!(tb&&p&&p.contains(tb))});})()"));
ok(nest.inside === false, 'B6 #page-card-audit 正确闭合（tabbar 未被吞）', JSON.stringify(nest));

// B7/B8 大库未取回：顶部提示 + 「点此加载完整字卡」真的调 hydrateLibScopes
await evalJs("(function(){try{window.libScopesDeferred=function(){return true;};}catch(e){}var r=document.getElementById('card-audit-refresh');if(r)r.click();return true;})()");
await sleep(1300);
const loadBtn = await evalJs("(function(){return document.querySelectorAll('#card-audit-body [data-load]').length;})()");
ok(Number(loadBtn) >= 1, 'B7 字卡未取回时显示「点此加载完整字卡」', 'count=' + loadBtn);
await evalJs("(function(){window.__hydrated=false;var o=window.hydrateLibScopes;if(o){window.hydrateLibScopes=function(s,cb){window.__hydrated=true;return o.apply(this,arguments);};}var b=document.querySelector('#card-audit-body [data-load]');if(b)b.click();return true;})()");
await sleep(500);
const hydrated = await evalJs("window.__hydrated===true");
ok(hydrated === true, 'B8 点「加载完整字卡」触发 hydrateLibScopes', 'hydrated=' + hydrated);

// B9 批量修复：进入勾选模式后每行出现复选框；「应用所选」按 hidden 显隐（#618）
// #618 根因：`.storage-clear{display:block}` 作者样式盖过 UA `[hidden]{display:none}`，
//   导致未进批量模式「应用所选」也常驻可见、点了只提示「请先勾选」→ 用户以为批量修复没用。
//   断言 computed display（不是 hidden 属性，属性一直是 true 但 CSS 不生效）。
const applyHiddenBefore = await evalJs("(function(){var b=document.getElementById('card-audit-apply');return b?getComputedStyle(b).display:null;})()");
ok(applyHiddenBefore === 'none', 'B9a 未进批量模式时「应用所选」按 hidden 隐藏（#618，显示值=' + applyHiddenBefore + '）', 'display=' + applyHiddenBefore);
await evalJs("(function(){try{window.libScopesDeferred=function(){return false;};}catch(e){}var p=document.getElementById('card-audit-pick');if(p)p.click();return true;})()");
await sleep(1300);
const picks = await evalJs("(function(){return document.querySelectorAll('#card-audit-body .ca-pick').length;})()");
ok(Number(picks) >= 1, 'B9 批量修复模式注入可勾选复选框', 'count=' + picks);
const applyShownAfter = await evalJs("(function(){var b=document.getElementById('card-audit-apply');return b?getComputedStyle(b).display:null;})()");
ok(applyShownAfter && applyShownAfter !== 'none', 'B9b#618）', 'display=' + applyShownAfter);
// B9c 勾选态 → 应用所选 计数联动 + 真写回（选第一项取消勾选，确认计数下降）
const pickCountBefore = await evalJs("(function(){var b=document.getElementById('card-audit-apply');return b?b.textContent:'';})()");
await evalJs("(function(){var c=document.querySelector('#card-audit-body .ca-pick');if(c){c.checked=false;c.dispatchEvent(new Event('change',{bubbles:true}));}return true;})()");
await sleep(200);
const pickCountAfter = await evalJs("(function(){var b=document.getElementById('card-audit-apply');return b?b.textContent:'';})()");
ok(pickCountBefore !== pickCountAfter, 'B9c 取消勾选后「应用所选」计数联动', pickCountBefore + ' -> ' + pickCountAfter);

// B10 导出文件：走 docx 主链 #746（mock mochiDiagExportDocx，不真的落盘）
await evalJs("(function(){window.__exported=null;window.mochiDiagExportDocx=function(t,f,fm,tf,st){window.__exported={len:(t||'').length,f:f,st:st};return true;};var b=document.getElementById('card-audit-export');if(b)b.click();return true;})()");
await sleep(300);
const exp = J(await evalJs("(function(){return JSON.stringify(window.__exported||{});})()"));
ok(exp && exp.len > 0 && exp.f === 'mochi-card-audit-', 'B10 「导出文件」走 docx 主链（把 basePrefix 交给 mochiDiagExportDocx，最终文件名见 B12e 真链）', JSON.stringify(exp));

// B11 #677 单卡关闭计数必须按【值】而不是「键在不在」
//   根因：default-cards.js 的 setCardOff 写 off ? '1' : '0'，重新打开也不删键；
//   旧实现按键存在计数 ⇒ ①曾经关过又打开的卡被当成关闭（凭空报「已全部单卡关闭」）；
//   ②「恢复单卡」写 '0' 后计数不变 ⇒ 告警与按钮原样重画＝用户说的「按恢复没有反应」。
await evalJs("(function(){var p=document.getElementById('card-audit-pick');if(p&&document.getElementById('card-audit-apply').hidden===false)p.click();return true;})()");
await sleep(300);
const seedOff = J(await evalJs(`(function(){var d=(window.DEFAULT_CARD_DATA&&window.DEFAULT_CARD_DATA.touch)||[];var out=[];d.forEach(function(g){if(Array.isArray(g)&&Array.isArray(g[1]))g[1].forEach(function(c){out.push(c);});});var st=window.activeStore();out.forEach(function(c){st.set('dc-off-touch:'+c,'1');});return JSON.stringify({n:out.length,first:out[0]||''});})()`));
ok(seedOff.n > 0, 'B11 前置：把「拍一拍」分类全部预设卡置为关闭（值=1）', JSON.stringify(seedOff));
await evalJs("(function(){var r=document.getElementById('card-audit-refresh');if(r)r.click();return true;})()");
await sleep(1500);
const allOff = J(await evalJs(`(function(){var b=document.getElementById('card-audit-body');var t=b?b.textContent:'';var pre=(window.activePrefix?window.activePrefix():'x')+':dc-off-';var st=window.activeStore();var idx={};var n=0;for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(!k||k.indexOf(pre)!==0)continue;var rest=k.slice(pre.length);if(st.get(rest)!=='1')continue;var c=rest.indexOf(':');var cat=c<0?rest:rest.slice(0,c);idx[cat]=(idx[cat]||0)+1;n++;}var d=(window.DEFAULT_CARD_DATA&&window.DEFAULT_CARD_DATA.touch)||[];var tt=0;d.forEach(function(g){if(Array.isArray(g)&&Array.isArray(g[1]))tt+=g[1].length;});return JSON.stringify({warn:t.indexOf('已全部单卡关闭')>=0,btn:document.querySelectorAll('#card-audit-body [data-fix="inl-dc-off-touch"]').length,prefix:window.activePrefix?window.activePrefix():null,replicated:idx,presetTouch:tt,bodyLen:t.length,head:t.slice(0,60)});})()`));
ok(allOff.warn === true && allOff.btn >= 1, 'B11a 全部真关闭时照旧报「已全部单卡关闭」并给「恢复单卡」按钮', JSON.stringify(allOff));

await evalJs("(function(){var b=document.querySelector('#card-audit-body [data-fix=\"inl-dc-off-touch\"]');if(b)b.click();return true;})()");
await sleep(400);
await evalJs("(function(){var o=document.getElementById('modal-ok');if(o)o.click();return true;})()");
await sleep(1200);
const afterFix = J(await evalJs(`(function(){var d=(window.DEFAULT_CARD_DATA&&window.DEFAULT_CARD_DATA.touch)||[];var ks=[];d.forEach(function(g){if(Array.isArray(g)&&Array.isArray(g[1]))g[1].forEach(function(c){ks.push(c);});});var st=window.activeStore();var vals=ks.map(function(c){return st.get('dc-off-touch:'+c);});var b=document.getElementById('card-audit-body');var t=b?b.textContent:'';return JSON.stringify({allZero:vals.every(function(v){return v==='0';}),vals:vals.slice(0,3),warn:t.indexOf('已全部单卡关闭')>=0,btn:document.querySelectorAll('#card-audit-body [data-fix="inl-dc-off-touch"]').length});})()`));
ok(afterFix.allZero === true, 'B11b 「恢复单卡」把所有卡写回 0（开启）', JSON.stringify(afterFix.vals));
ok(afterFix.warn === false && afterFix.btn === 0, 'B11c 修复后告警与按钮一起消失（旧实现：键仍在 → 计数不变 → 原样重画＝「按恢复没反应」）', JSON.stringify(afterFix));
// B11d：值=0 的旧键不得再被算成「关闭」（重新打开过的卡）
const reqZero = J(await evalJs(`(function(){var b=document.getElementById('card-audit-body');return JSON.stringify({warn:(b?b.textContent:'').indexOf('已全部单卡关闭')>=0});})()`));
ok(reqZero.warn === false, 'B11d 值=0 的历史键不被计入「单卡关闭」（键在不在 ≠ 关没关）', JSON.stringify(reqZero));

// ===== B13 #932：整组停用（#926 的 dc-groups-off）纳入自检 =====
//   此前本页只按 dc-off-* 逐张统计：用户把整个分组停用时该分类明明抽不到卡，自检却报
//   「未发现明显问题」、一键修复也不接管＝自检比功能少一道闸。B13 覆盖三态：
//   停一组（也要报警）→ 停到清空（内容闸 ✕ + 可修）→ 点「启用分组」（报警消失、抽取回来、单卡值不动）。
const gMain = J(await evalJs(`(function(){
  var d=(window.DEFAULT_CARD_DATA&&window.DEFAULT_CARD_DATA.main)||[];
  var names=[],cards=[];
  d.forEach(function(g){ if(!Array.isArray(g))return; names.push(g[0]); if(Array.isArray(g[1])) g[1].forEach(function(c){cards.push(c);}); });
  return JSON.stringify({names:names, cards:cards.length, c0:cards[0]||'', c1:cards[1]||''});
})()`));
const setGroups = (obj) => evalJs('(function(){window.activeStore().set("dc-groups-off", ' + JSON.stringify(JSON.stringify(obj)) + ');return true;})()');
const clearGroups = () => evalJs('(function(){window.activeStore().remove("dc-groups-off");return true;})()');
const clickFix = (sel) => evalJs('(function(){var b=document.querySelector(\'#card-audit-body [data-fix="' + sel + '"]\');if(!b)return "nobtn";b.click();return "clicked";})()');
const okModal = () => evalJs('(function(){var o=document.getElementById("modal-ok");if(o)o.click();return true;})()');
const refreshAudit = () => evalJs("(function(){var r=document.getElementById('card-audit-refresh');if(r)r.click();return true;})()");
const bodyTxt = async () => (await evalJs("(function(){var b=document.getElementById('card-audit-body');return b?b.textContent:'';})()")) || '';
const mainRow = async () => J(await evalJs(`(function(){
  var rows=[].slice.call(document.querySelectorAll('#card-audit-body .storage-row'));var r=null;
  rows.forEach(function(x){ if(r)return; var s=x.querySelector('span'); if(s&&s.textContent.indexOf('dc-cat-main')>=0) r=x; });
  if(!r) return JSON.stringify({found:false});
  var f=r.nextElementSibling;
  var b=document.getElementById('card-audit-body');var t=b?b.textContent:'';
  var q=function(s){return document.querySelectorAll('#card-audit-body [data-fix="'+s+'"]').length;};
  return JSON.stringify({found:true, row:r.textContent, funnel:(f&&f.classList.contains('ca-funnel'))?f.textContent:'',
    body:t.indexOf('个分组被整组停用')>=0, gbtn:q('inl-dc-goff-main'), offbtn:q('inl-dc-off-main'), allfix:q('__allfix'),
    goff:window.activeStore().get('dc-groups-off')});
})()`));

// 采样前先让角标落回当前真实状态：前面 B1~B11 各段改过一堆闸门键，而角标只在那四个事件
// 里重算，直接取到的 badge0 是积压的旧值（实测 5→2 把本批的 +1 淹没）——先刷一次，
// 之后 dc-groups-off 就是两次采样之间唯一的起变量。
const readBadge = () => evalJs("(function(){var r=document.getElementById('row-card-audit');return r?Number(r.getAttribute('data-ca-issues')||0):-1;})()");
await evalJs("(function(){document.dispatchEvent(new Event('mochi-cardlock-open'));return true;})()");
await sleep(800);
const badge0 = Number(await readBadge());
await setGroups({ main: [gMain.names[0]] });
await evalJs("(function(){document.dispatchEvent(new Event('mochi-cardlock-open'));return true;})()");   // refreshAll → updateBadge
await sleep(600);
const badge1 = Number(await readBadge());
ok(badge0 >= 0 && badge1 > badge0, 'B13a 只停一个分组也让入口角标 +1（quickIssueCount 认 dc-groups-off）', badge0 + ' -> ' + badge1);
await refreshAudit();
await sleep(1400);
const r13b = await mainRow();
ok(r13b.found === true && r13b.body === true && r13b.gbtn >= 1, 'B13b 整组停用出报警（点名组名）＋该行带「启用分组」按钮', JSON.stringify({ body: r13b.body, gbtn: r13b.gbtn, row: (r13b.row || '').slice(0, 70) }));
ok(r13b.row.indexOf('整组停用 1 组') >= 0 && r13b.funnel.indexOf('✕内容') < 0, 'B13b2 未清空分类时仍显示「整组停用 1 组·M 张」且内容闸保持 ✓', JSON.stringify({ row: (r13b.row || '').slice(0, 90), funnel: (r13b.funnel || '').slice(0, 90) }));

await setGroups({ main: gMain.names });
await evalJs('(function(){window.activeStore().set(' + JSON.stringify('dc-off-main:' + gMain.c0) + ',"1");return true;})()');
await refreshAudit();
await sleep(1500);
const r13c = await mainRow();
const t13c = await bodyTxt();
ok(r13c.funnel.indexOf('✕内容') >= 0 && t13c.indexOf('全部关闭（单卡关闭 1 张、整组停用 ' + gMain.names.length + ' 个分组）') >= 0,
  'B13c 停到清空＝内容闸 ✕，报警按「单卡 1 张 + 整组 N 组」合并口径点名', JSON.stringify({ funnel: (r13c.funnel || '').slice(0, 90), hit: t13c.indexOf('全部关闭（单卡关闭 1 张') }));
ok(r13c.gbtn >= 1 && r13c.offbtn >= 1 && r13c.allfix >= 1, 'B13c2 清空态同时给「启用分组」「恢复单卡」并纳入一键修复', JSON.stringify({ gbtn: r13c.gbtn, offbtn: r13c.offbtn, allfix: r13c.allfix }));

const c13d = await clickFix('inl-dc-goff-main');
await sleep(400);
await okModal();
await sleep(1400);
const r13d = J(await evalJs(`(function(){
  var b=document.getElementById('card-audit-body');var t=b?b.textContent:'';
  var api=window.defaultCardApiFor(window.activeStore());
  var raw=window.activeStore().get('dc-groups-off');
  var left=null; try{ var o=JSON.parse(raw||'{}'); left=Array.isArray(o.main)?o.main.length:0; }catch(e){ left='parse'; }
  return JSON.stringify({left:left, alarm:t.indexOf('个分组被整组停用')>=0,
    gbtn:document.querySelectorAll('#card-audit-body [data-fix="inl-dc-goff-main"]').length,
    stillOff:api.isOff('main', ${JSON.stringify(gMain.c0)}), backOn:api.isOff('main', ${JSON.stringify(gMain.c1)})});
})()`));
ok(c13d === 'clicked' && r13d.left === 0 && r13d.alarm === false && r13d.gbtn === 0,
  'B13d 点「启用分组」确认后：该分类名单清空、报警与按钮一起消失（不是「点了没反应」）', JSON.stringify({ c: c13d, left: r13d.left, alarm: r13d.alarm, gbtn: r13d.gbtn }));
ok(r13d.stillOff === true && r13d.backOn === false, 'B13d2 只放开分组：组内那张单卡关闭的卡仍是关闭，其余恢复可用', JSON.stringify({ stillOff: r13d.stillOff, backOn: r13d.backOn }));
const r13e = await mainRow();
ok(r13e.funnel.indexOf('✕内容') < 0, 'B13e 恢复后内容闸回到 ✓（该分类重新有可用内容）', (r13e.funnel || '').slice(0, 90));
await clearGroups();
await evalJs("(function(){var p='dc-off-main:'+" + JSON.stringify(JSON.stringify(gMain.c0)) + ";window.activeStore().set(p,'0');return true;})()");
await refreshAudit();
await sleep(1200);
const r13f = await mainRow();
ok(r13f.body === false && r13f.gbtn === 0 && r13f.row.indexOf('整组停用') < 0, 'B13f 名单清空后页面回到无分组停用形态（无残留报警/按钮）', JSON.stringify({ body: r13f.body, gbtn: r13f.gbtn, row: (r13f.row || '').slice(0, 70) }));

// B12 #677 导出报告绝不能为空 ＋ #746 docx 口径
//   根因：lastText 只在 build() 末行赋值，而 build() 没有兜底；未打开过自检页（或 build
//   中途抛错被 openAudit/refreshAll 吞掉）时 lastText 恒为空串 ⇒ 导出文件里 report 为空
//   ＝用户报的「自检报告导出没有内容」。修复：exportReport 现取一次 + 兜底头 + 错误可见。
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2600);
await evalJs("(function(){window.__exported=null;window.mochiDiagExportDocx=function(t,f,fm,tf,st){window.__exported={len:(t||'').length,f:f,st:st,text:t};return true;};return true;})()");
// 关键：完全不打开自检页就点导出（旧实现此时 lastText='' → report 空串）
await evalJs("(function(){var b=document.getElementById('card-audit-export');if(b)b.click();return true;})()");
await sleep(600);
const exp2 = J(await evalJs("(function(){var x=window.__exported||{};var t=x.text||'';return JSON.stringify({len:t.length,head:t.slice(0,500),all:t,f:x.f});})()"));
ok(exp2 && exp2.len > 200 && exp2.all.indexOf('自检结论') >= 0, 'B12a 未打开自检页直接导出→docx 仍是真实自检正文（旧实现 report 为空串）', 'len=' + (exp2 && exp2.len));
ok(exp2 && exp2.all.indexOf('二级密码锁') >= 0 && exp2.all.indexOf('卡数据健康') >= 0, 'B12b docx 导出报告含完整分节正文', (exp2 && exp2.all || '').slice(0, 30));
ok(exp2 && exp2.head.indexOf('版本：') >= 0 && exp2.head.indexOf('时间：') >= 0 && exp2.head.indexOf('设备：') >= 0 && exp2.head.indexOf('当前桌面：') >= 0, 'B12c docx 头部承接原 JSON payload 字段（版本/时间/设备/桌面）', (exp2 && exp2.head || '').slice(0, 120));
ok(exp2 && exp2.all.indexOf('自检中途出错') < 0, 'B12d 正常路径无内部错误行（buildError 空时不写「自检中途出错：」）', (exp2 && exp2.head || '').slice(0, 120));
// B12e 最终文件名：#746 起由 device.js 的 diagExportDocx 统一拼装（basePrefix＋ISO 时间＋.docx），
//   所以 .docx 只能在真链上断言（查 mock 收到的前缀＝永远红＝存量误红，本批收掉）。
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2600);
const expName = J(await evalJs(`(function(){
  var real = window.mochiDiagExportDocx;
  if (typeof real !== 'function') return JSON.stringify({ err: 'no-real-fn' });
  var got = null;
  window.mochiExportBlob = function (blob, fname) { got = { size: blob && blob.size, name: fname }; return Promise.resolve('ok'); };
  try { real('mochi 自检真链正文 · verify-card-audit', 'mochi-card-audit-', null, function () {}, 'verify'); } catch (e) { got = { err: String(e) }; }
  window.mochiExportBlob = undefined;
  return JSON.stringify(got || { err: 'not-called' });
})()`));
ok(!expName.err && /\.docx$/.test(expName.name || '') && (expName.name || '').indexOf('mochi-card-audit-') === 0 && expName.size > 64,
  'B12e 真链（device.js）拼出的导出名以 .docx 结尾、前缀正确、blob 非空壳', JSON.stringify(expName));
// B12f 兜底链：mochiDiagExportDocx 不在（旧产物/极端内核）→ 退回原 JSON 链，绝不空手
await evalJs("(function(){window.__exported2=null;window.mochiDiagExportDocx=undefined;window.mochiExportFile=function(j,f){window.__exported2={len:(j||'').length,f:f};return Promise.resolve('ok');};var b=document.getElementById('card-audit-export');if(b)b.click();return true;})()");
await sleep(400);
const exp3 = J(await evalJs("(function(){var x=window.__exported2||{};return JSON.stringify({len:x.len,f:x.f});})()"));
ok(exp3 && exp3.len > 0 && (exp3.f || '').indexOf('.json') > 0, 'B12f docx 入口缺失时退回 JSON 兜底链（仍可导出，不空手）', JSON.stringify(exp3));

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n== 字卡使用状态自检验证: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);
