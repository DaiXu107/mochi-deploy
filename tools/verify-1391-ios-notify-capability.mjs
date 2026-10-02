// verify-1391-ios-notify-capability.mjs —— #1391「iPhone 的后台通知弹窗被判成本机用不了」
// 用户直派「iPhone16plus Safari浏览器，后台弹窗无法使用」＋「检查 ios 使用后台通知弹窗是否有异常」
// （随附 mochi-diag-2026-09-28-16-12-40138095445724639126.docx）。
// 根因不是机型也不是内核：设置页「后台通知」那行的本机可用性判定把平台读数排在能力读数之前
// （`if (isIOS()) return {…}` 抢在 `if (!hasNotify()) …` 前面），于是任何 iPhone 一律变灰并被指去
// 应用内横幅——连报障机自己那两行读数（通知=开/granted、最近通知通道=sw，出自 bg-keep.js:879 的探针
// 与 device.js 读 bgNotifyLastChannel()）都已证明能力在场的那台也不例外。#986d 当年钉的正是
// 「门槛是通知能力不是手机系统」，针一直绿、语义被插在它前面的一行机型分支顶掉＝典型「名字在、逻辑变」。
// 判据一律只问「本机有没有 Notification 对象」「权限读数是什么」「这一行被标成什么」，零机型分支。
// 断言：
//   S 组 源码/产物锚点：能力判定排在平台判定之前（顺序断言，本批本体）＋五处旧句式为删除型＋新指路在位
//   F 组 夹具诚实：桩真落到位才给行为分（落不了就 SKIP，不混进「绿」）
//   B1 iPhone 形态＋无 Notification 对象：该行标灰，且指路把用户带去「添加到主屏幕」（HEAD 的旧文案说的是那条没用）
//   B2 iPhone 形态＋API 在场＋granted：该行【不得】被标成本机用不了（HEAD 必红＝主诉本体）
//   B3 iPhone 形态＋API 在场＋default：同上，不被标灰（HEAD 必红）
//   B4 安卓形态＋无通知能力：照常标灰并指 Chrome / Edge（回归，两侧皆绿）
//   B5 granted 时行下标红说明为空（#1014 既有口径，回归）
//   Z  全程 0 未捕获 JS 异常
// 用法：node tools/verify-1391-ios-notify-capability.mjs
//   红对照：在仓外纯 HEAD 副本里构建后跑同一把尺（期望 B1/B2/B3＋S 组数条红）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.log('SKIP 未找到 Chrome/Edge'); process.exit(0); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => { try { let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0]))); if (statSync(p).isDirectory()) p = join(p, 'index.html'); res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); } catch (e) { res.writeHead(404); res.end('nf'); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const port = 9900 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1391-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map(); const errs = [];
for (let i = 0; i < 60; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errs.push(JSON.stringify(m.params && m.params.exceptionDetails && m.params.exceptionDetails.exception)); }; break; } } catch (e) {} await sleep(150); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true }); if (r && r.exceptionDetails) return 'ERR:' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description); return r && r.result ? r.result.value : null; };
let pass = 0, fail = 0, skip = 0; const fails = [];
const A = (n, ok, extra) => { if (ok) pass++; else { fail++; fails.push(n + (extra ? ' | ' + extra : '')); } };
const S = (n) => { skip++; console.log('   SKIP ' + n + '（夹具造不出这一态＝环境缺口，不算回归）'); };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ===== S 组：源码 / 产物锚点 =====
const srcPz = readFileSync(join(root, 'src/js/personalize.js'), 'utf8');
const srcBk = readFileSync(join(root, 'src/js/bg-keep.js'), 'utf8');
const outHtml = readFileSync(join(root, 'index.html'), 'utf8');
const prod = (f) => { try { return readFileSync(join(root, 'js/' + f), 'utf8'); } catch (e) { return ''; } };
const pzProd = prod('personalize.js') || outHtml;
const bkProd = prod('bg-keep.js') || outHtml;
const shProd = prod('settings-help.js') || outHtml;
const peProd = prod('period.js') || outHtml;
// 顺序断言：能力判定必须在平台判定之前（本批本体；旧写法 isIOS 在前 → 这条必红）
const iCap = srcPz.indexOf('if (hasNotify()) return null;');
const iPlat = srcPz.indexOf("if (isIOS()) return { text: '本机是 iPhone");
A('S1 能力判定排在平台判定之前（src 顺序）', iCap >= 0 && iPlat >= 0 && iCap < iPlat, 'hasNotify@' + iCap + ' isIOS@' + iPlat);
A('S2 同一条顺序在产物里也在位（漏接入 build.mjs＝src 改了线上没改）', (() => { const a = pzProd.indexOf('if (hasNotify()) return null;'), b = pzProd.indexOf("if (isIOS()) return { text: '本机是 iPhone"); return a >= 0 && b >= 0 && a < b; })(), '产物侧 hasNotify@' + pzProd.indexOf('if (hasNotify()) return null;'));
A('S3 删除型：设置页那行不再按手机系统判「iPhone 拿不到通知」', srcPz.indexOf('本机是 iPhone / iPad：网页拿不到系统通知') < 0 && pzProd.indexOf('本机是 iPhone / iPad：网页拿不到系统通知') < 0);
A('S4 删除型：「装到主屏幕也不保证」那半句五处镜像一处不留', [srcBk, bkProd, srcPz, pzProd, shProd, outHtml].every((s) => s.indexOf('添加到主屏幕也不保证') < 0));
A('S5 删除型：行下说明与使用说明不再写「本开关在 iPhone 上无效」', outHtml.indexOf('本开关在 iPhone / iPad 上无效') < 0 && outHtml.indexOf('本开关在 iPhone 上无效') < 0 && shProd.indexOf('本开关在 iPhone / iPad 上基本无效') < 0);
A('S6 新指路在位：无通知能力的 iPhone 被带去「添加到主屏幕」（四处用户可见面各自核）', pzProd.indexOf('添加到主屏幕') >= 0 && bkProd.indexOf('iPhone / iPad 在 Safari 标签页里没有系统通知能力') >= 0 && shProd.indexOf('要 Safari 分享菜单') >= 0 && outHtml.indexOf('Safari 标签页里没有网页通知能力') >= 0 && peProd.indexOf('要在 Safari「添加到主屏幕」后从桌面图标打开本站才有') >= 0);
A('S7 判定源仍是能力探测本体（hasNotify 读的是 Notification 对象在场，不是名字）', srcPz.indexOf("return 'Notification' in window;") >= 0);

// ===== 无头行为组：三态真跑 =====
// 每态一次整页加载：onNewDocument 里先把 mochiDevice.isIOS 改成想要的平台读数，再把 Notification
// 摆成「不在场 / default / granted」其中一档，personalize.js 的 initUseMark 求值时读到的就是这一态。
let stubId = null;
async function setStub(source) {
  if (stubId) { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: stubId }); stubId = null; }
  if (source) { const r = await cdp('Page.addScriptToEvaluateOnNewDocument', { source }); stubId = r && r.identifier; }
}
const stub = (ios, perm) => `(function(){
  try{
    var __md;
    Object.defineProperty(window,'mochiDevice',{configurable:true,
      get:function(){return __md;},
      set:function(v){ if(v){ try{ v.isIOS=${ios ? 'true' : 'false'}; }catch(e){} } __md=v; }});
  }catch(e){ window.__v1391devFail=String(e&&e.message||e); }
  try{
    ${perm === 'none' ? "if(!delete window.Notification){ window.__v1391noDel=true; }" : `try{Object.defineProperty(Notification,'permission',{value:'${perm}',configurable:true});}catch(e){ window.__v1391permFail=String(e&&e.message||e); }`}
  }catch(e){ window.__v1391permFail=String(e&&e.message||e); }
})();`;
const readRow = async () => JSON.parse(await ev(`(function(){
  var inp=document.getElementById('bg-notify');
  var row=inp&&inp.closest&&inp.closest('.set-row, .gs-row');
  var hint=row&&row.nextElementSibling;
  while(hint&&!(hint.className||'').indexOf('plat-hint')>=0&&hint.classList&&!hint.classList.contains('plat-hint')) hint=hint.nextElementSibling;
  var warn=document.getElementById('bg-notify-perm-warn');
  return JSON.stringify({
    has:!!inp,
    row:!!row,
    marked:!!(row&&row.classList&&row.classList.contains('plat-off')),
    hint:(hint&&hint.textContent)||'',
    warnHidden:warn?!!warn.hidden:null,
    warnText:warn?(warn.textContent||''):'',
    permNow:('Notification' in window)?String(Notification.permission):'none',
    devIOS:(window.mochiDevice||{}).isIOS,
    fixtureErr:[window.__v1391devFail||'',window.__v1391permFail||'',window.__v1391noDel?'Notification 删不掉':''].join('')
  });
})()`));
async function load(ios, perm) {
  await setStub(stub(ios, perm));
  await cdp('Page.navigate', { url: base + '/index.html?v1391=' + Date.now() });
  await sleep(2600);
  return readRow();
}
const st1 = await load(true, 'none');
const st2 = await load(true, 'granted');
const st3 = await load(true, 'default');
const st4 = await load(false, 'none');

// F 组：夹具诚实——四态必须真的各不相同，否则行为分不算
A('F1 平台桩真落地（isIOS 读数随场景翻转）', st1.devIOS === true && st2.devIOS === true && st4.devIOS === false, JSON.stringify([st1.devIOS, st4.devIOS]));
A('F2 能力桩真落地（三态读数分别 = none / granted / default）', st1.permNow === 'none' && st2.permNow === 'granted' && st3.permNow === 'default', JSON.stringify([st1.permNow, st2.permNow, st3.permNow]));
A('F3 夹具自身无报错', [st1, st2, st3, st4].every((s) => !s.fixtureErr), [st1, st2, st3, st4].map((s) => s.fixtureErr).join(' / '));
const envOK = st1.permNow === 'none' && st2.permNow === 'granted' && st3.permNow === 'default' && st1.devIOS === true && st4.devIOS === false;

// B 组：这行被标成什么（读数只问「标没标灰／指路说什么」）
const b1 = st1;
if (!envOK) { S('B1 iPhone＋无 Notification 对象：标灰但指路给「添加到主屏幕」'); S('B2 iPhone＋granted：不被判本机用不了'); S('B3 iPhone＋default：不被判本机用不了'); S('B4 安卓＋无通知能力：照常标灰指 Chrome / Edge'); S('B5 granted 时行下标红说明收起'); }
else {
  A('B1 iPhone＋无 Notification 对象：该行标灰（能力确实不在场）', b1.marked === true && b1.has === true);
  A('B1b iPhone＋无 API：指路把用户带去「添加到主屏幕」，不再说那条没用', b1.hint.indexOf('添加到主屏幕') >= 0 && b1.hint.indexOf('也不保证') < 0, b1.hint.slice(0, 60));
  A('B2 iPhone＋API 在场＋granted：该行【不得】被标成本机用不了（本批主诉）', st2.marked === false && st2.hint === '', 'marked=' + st2.marked + ' hint=' + st2.hint.slice(0, 60));
  A('B3 iPhone＋API 在场＋default：同样不被标灰（待决不是「本机没能力」）', st3.marked === false, 'marked=' + st3.marked + ' hint=' + st3.hint.slice(0, 60));
  A('B4 安卓形态＋无通知能力：照常标灰并指 Chrome / Edge（回归）', st4.marked === true && st4.hint.indexOf('Chrome') >= 0, st4.hint.slice(0, 60));
  A('B5 granted 时行下标红说明收起（#1014 口径，回归）', st2.warnHidden === true || st2.warnText === '', 'warnHidden=' + st2.warnHidden + ' text=' + st2.warnText.slice(0, 40));
}
A('Z 全程 0 未捕获 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | ').slice(0, 160));

console.log('\n=== verify-1391 iPhone/iPad 后台通知能力判定：通过 ' + pass + ' / 失败 ' + fail + ' / 跳过 ' + skip + ' ===');
fails.forEach((f) => console.log('  ✗ ' + f));
await cdp('Browser.close').catch(() => {});
server.close(); chrome.kill();
process.exit(fail ? 1 : 0);
