// ===== 应用锁（隐私防护）专项回归 =====
// 用法：node build.mjs && node tools/verify-applock.mjs
// 需要：Node 21+（fetch/WebSocket）+ 本机 Chrome/Edge（可用 CHROME_PATH 指定）
// 覆盖：A 冷启动锁屏出现  B 错误密码  C 正确密码解锁+会话标记  D 刷新不重锁（仅密码锁）
//       E 会话清除后重锁  F 异常态(en=1 无密码)自愈关闭  G 忘密码问答重置全流程
//       H 静态防线（EXCLUDE/模板/产物接线）
//       I 开屏问答门（未输暗号时每次加载必问/答对放行/暗号 990815 永久跳过）
//       J 问答门+数字密码双重验证  K/M 静态防线  N 默认开启（模拟真机）
// 说明：开屏问答门为固定 2 道题，无「编辑问答题」入口（v3.3x 起移除编辑）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function h53(str) {
  const s = String(str);
  let h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16);
}
const P = 'xy-home-v2:';

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
import { extname } from 'node:path';

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 150));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-applock-' + Date.now()),
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
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function nav(u, waitMs) {
  await cdp('Page.navigate', { url: u });
  await sleep(waitMs || 900);
}
// 在站点上下文写键并刷新（必须先 navigate 到本站在执行——about:blank 无同源 localStorage）
async function seedAndReload(o) {
  // 通过页面内 xyStore 双写（LS+IDB）——与真实开启路径一致；裸写 LS 会因 LS/IDB
  // 不一致被启动恢复逻辑当孤儿处理，无法反映真实行为
  await evalJs(`(function(){
    try{sessionStorage.removeItem('mochi-applock-ok');}catch(e){}
    var G='xy-home-v2';
    function rm(k){try{if(window.xyStore)window.xyStore(G).remove(k);}catch(e){}try{localStorage.removeItem(G+':'+k);}catch(e2){}}
    ['applock-en','applock-pin','applock-qa','applock-qa-en','applock-qalist','applock-qaskip'].forEach(rm);
    var ks=${JSON.stringify(o)};
    for(var k in ks){try{if(window.xyStore)window.xyStore(G).set(k,ks[k]);else localStorage.setItem(G+':'+k,ks[k]);}catch(e){try{localStorage.setItem(G+':'+k,ks[k]);}catch(e2){}}}
    return 1;
  })()`);
  await sleep(600); // 等 xyStore 的异步 IDB 写完成，保证双写一致
  await cdp('Page.reload');
  await sleep(1300);
}
async function clearSessAndReload() {
  await evalJs("try{sessionStorage.removeItem('mochi-applock-ok')}catch(e){}");
  await cdp('Page.reload');
  await sleep(1300);
}
async function lockState() {
  return evalJs(`(function(){
    var m=document.getElementById('applock-mask');
    if(!m)return JSON.stringify({has:false,shown:false,sess:sessionStorage.getItem('mochi-applock-ok')||'',lsEn:localStorage.getItem('${P}applock-en')||'',lsPin:!!localStorage.getItem('${P}applock-pin')});
    var b=m.querySelector('.applock-box');
    var qa=m.querySelector('#qa-page-ok');
    var tEl=b?b.querySelector('.applock-title'):(qa?m.querySelector('.splash-mandatory-title'):null);
    return JSON.stringify({
      has:true,shown:m.hidden!==true,
      qaPage:!!qa,
      qaInputs:m.querySelectorAll('[id^="qa-ans-"]').length,
      title:tEl?tEl.textContent:'',
      err:(b&&b.querySelector('#applock-err')?b.querySelector('#applock-err'):m.querySelector('#applock-err'))?((b&&b.querySelector('#applock-err')?b.querySelector('#applock-err'):m.querySelector('#applock-err')).textContent):'',
      sess:sessionStorage.getItem('mochi-applock-ok')||'',
      lsEn:localStorage.getItem('${P}applock-en')||'',
      lsPin:!!localStorage.getItem('${P}applock-pin')
    });
  })()`);
}
async function qaFill(idx, v) {
  await evalJs(`(function(){var el=document.getElementById('qa-ans-'+${idx});if(el)el.value=${JSON.stringify(String(v))};return 1;})()`);
  await sleep(100);
}
async function qaPageSubmit() {
  await evalJs(`(function(){var el=document.getElementById('qa-page-ok');if(el)el.click();return 1;})()`);
  await sleep(250);
}
async function clickKeys(str) {
  await evalJs(`(function(){var s=${JSON.stringify(String(str))};for(var i=0;i<s.length;i++){var el=document.querySelector('.applock-key[data-k="'+s[i]+'"]');if(el)el.click();}return 1;})()`);
  await sleep(120);
}
async function clickOk() {
  await evalJs(`(function(){var el=document.getElementById('applock-ok');if(el)el.click();return 1;})()`);
  await sleep(180);
}
async function typeText(v) {
  await evalJs(`(function(){var el=document.getElementById('applock-txt');if(el){el.value=${JSON.stringify(v)};}return 1;})()`);
  await sleep(100);
}
async function clickSubmit() {
  await evalJs(`(function(){var el=document.querySelector('[data-submit="1"]');if(el)el.click();return 1;})()`);
  await sleep(200);
}
async function clickLink(labelOrAct) {
  await evalJs(`(function(){var els=[].slice.call(document.querySelectorAll('#applock-mask [data-link]'));for(var i=0;i<els.length;i++){var t=els[i].getAttribute('data-link');if(t===${JSON.stringify(labelOrAct)}||els[i].textContent.indexOf(${JSON.stringify(labelOrAct)})>=0){els[i].click();return 1;}}return 0;})()`);
  await sleep(200);
}
await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}

// 先进入站点（空库首启），后续所有写键都在本站在执行
await nav(baseUrl + '/index.html', 1500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__applockReady')) break; await sleep(250); }

// ---- A. 冷启动锁屏出现 ----
await seedAndReload({ 'applock-en': '1', 'applock-pin': h53('1234') });
let st = JSON.parse(await lockState() || '{}');
check('A1 已启用应用锁：冷启动出现锁屏遮罩', st.has && st.shown === true, JSON.stringify(st));
check('A2 锁屏标题为「应用锁已开启」', st.title === '应用锁已开启', st.title);
// A3 视觉层断言：遮罩必须真正挂上 CSS（position:fixed 全屏浮层 + 背景），
// 否则如 v3.31.x 早期 bug——只设了 id 没设 class、CSS 用 .applock-mask 类选择器——
// DOM 在、hidden=false，但只是无样式普通 div，用户根本看不见锁屏（无头只查 DOM 抓不到）。
const vs = JSON.parse(await evalJs("(function(){var m=document.getElementById('applock-mask');if(!m)return JSON.stringify({has:false});var cs=getComputedStyle(m);return JSON.stringify({has:true,cls:m.className||'',pos:cs.position,z:cs.zIndex,bg:cs.background&&cs.background!=='none'?true:false,display:cs.display});})()") || '{}');
check('A3 遮罩已挂 .applock-mask 样式（fixed+高 z+遮底）', vs.has && vs.cls.indexOf('applock-mask') >= 0 && vs.pos === 'fixed' && vs.z === '999999' && vs.bg === true, JSON.stringify(vs));

// ---- B. 错误密码 ----
await clickKeys('9999');
await clickOk();
st = JSON.parse(await lockState() || '{}');
check('B1 错误密码：仍在锁屏', st.shown === true, 'shown=' + st.shown);
check('B2 错误密码：提示「密码不正确」', st.err && st.err.indexOf('密码不正确') >= 0, st.err);

// ---- C. 正确密码解锁 ----
await clickKeys('1234');
await clickOk();
st = JSON.parse(await lockState() || '{}');
check('C1 正确密码：锁屏消失', st.has && st.shown === false, JSON.stringify(st));
check('C2 解锁后 sessionStorage 置位', st.sess === '1', st.sess);

// ---- D. 同标签刷新不重锁（本会话已解锁） ----
await cdp('Page.reload');
await sleep(1200);
st = JSON.parse(await lockState() || '{}');
check('D1 同标签刷新：不再要求解锁（会话保留则不建锁层）', !(st.has && st.shown === true), JSON.stringify(st));

// ---- E. 会话清除（等效新开标签/冷启动）后重锁 ----
await clearSessAndReload();
st = JSON.parse(await lockState() || '{}');
check('E1 会话清除+刷新：锁屏重现', st.has && st.shown === true, JSON.stringify(st));

// ---- F. 异常态自愈：en=1 但无密码 → 自动关闭防锁死 ----
await seedAndReload({ 'applock-en': '1' });
st = JSON.parse(await lockState() || '{}');
check('F1 en=1 无密码：不显示锁屏', !(st.has && st.shown === true), JSON.stringify(st));
check('F2 en=1 无密码：applock-en 被自愈置 0', st.lsEn === '0', st.lsEn);

// ---- R. 刷新后锁不能被误关（IDB 有密码、LS 快照缺密码时）----
// v3.32.x 自愈加固：读到 en=1 但同步读不到 pin，先异步确认 IDB 里也有密码——
// 有则回填本机并正常锁屏，绝不能像旧逻辑那样直接 setEn(false)（安卓「数据主要在
// IndexedDB、LS 仅快照」下刷新首帧 pin 未回填即被当异常态关锁=门户大开，用户反馈
// 「刷新后应用锁被关了，开关也变关」）。真异常（双端都无密码）关闭逻辑仍由 F 保。
await seedAndReload({ 'applock-en': '1', 'applock-pin': h53('1234') });
await evalJs("try{localStorage.removeItem('" + P + "applock-pin');}catch(e){}"); // LS 删 pin、IDB 保留
await cdp('Page.reload');
await sleep(1400);
st = JSON.parse(await lockState() || '{}');
check('R1 IDB 有密码+LS 缺密码：刷新后仍锁屏且开关不被误关', st.shown === true && st.lsEn === '1', JSON.stringify(st));
await clickKeys('1234'); await clickOk();
st = JSON.parse(await lockState() || '{}');
check('R2 该场景下密码仍可正常解锁', st.shown === false, JSON.stringify(st));

// ---- G. 忘记密码→安全问答→重设密码全流程 ----
await seedAndReload({ 'applock-en': '1', 'applock-pin': h53('5678'), 'applock-qa': JSON.stringify({ q: '第一次见面的城市？', h: h53('北京') }) });
st = JSON.parse(await lockState() || '{}');
check('G1 预置问答后冷启动锁屏', st.has && st.shown === true);
await clickLink('忘记密码');
st = JSON.parse(await lockState() || '{}');
check('G2 点「忘记密码」出现安全问答输入屏', st.title === '安全问题', st.title);
await typeText('上海');
await clickSubmit();
st = JSON.parse(await lockState() || '{}');
check('G3 错误答案：提示不正确并停留', st.shown === true && st.err.indexOf('不正确') >= 0, st.err);
await typeText('北京');
await clickSubmit();
st = JSON.parse(await lockState() || '{}');
check('G4 正确答案：进入重设密码第一屏', st.title === '重设密码' || st.title === '再输入一次确认' || st.shown === true, st.title);
await clickKeys('8888');
await clickOk();
st = JSON.parse(await lockState() || '{}');
check('G5 重设第二屏：再次输入', /确认/.test(st.title), st.title);
await clickKeys('8888');
await clickOk();
st = JSON.parse(await lockState() || '{}');
check('G6 重设完成：锁屏消失且会话已解锁', st.shown === false && st.sess === '1', JSON.stringify(st));
// 验证新密码生效、旧密码失效
await clearSessAndReload();
await clickKeys('5678');
await clickOk();
st = JSON.parse(await lockState() || '{}');
check('G7 旧密码已失效：仍锁屏', st.shown === true && st.err.indexOf('不正确') >= 0, st.err);
await clickKeys('8888');
await clickOk();
st = JSON.parse(await lockState() || '{}');
check('G8 新密码可解锁', st.shown === false, JSON.stringify(st));

// ---- P. 设置安全问答 → 点【完成】后面板必须关闭（#271，防「点完成无反应」回流） ----
// 复现开启应用锁→设 PIN→引导设安全问答→输答案→点「完成」：
// 旧版完成后只 save+toast、不清遮罩，面板滞留在此屏＝用户以为「点完成无反应」。修复＝完成即关闭。
await seedAndReload({ 'applock-qa-en': '0' });
// 打开设置页应用锁开关（走真实 bindSettings 的 flowNewPin → askQaSetup 引导链）
await evalJs(`(function(){var c=document.getElementById('applock-en');if(!c)return 0;c.checked=true;c.dispatchEvent(new Event('change'));return 1;})()`);
await sleep(400);
st = JSON.parse(await lockState() || '{}');
check('P1 开启应用锁：进入设置解锁密码屏', st.shown === true && st.title === '设置解锁密码', st.title);
await clickKeys('1234'); await clickOk();
st = JSON.parse(await lockState() || '{}');
check('P2 第一遍密码：进入确认屏', st.shown === true && /确认/.test(st.title), st.title);
await clickKeys('1234'); await clickOk();
await sleep(600); // 等 enable done 后 setTimeout(300) 弹「设置安全问题」
st = JSON.parse(await lockState() || '{}');
check('P3 密码设好：引导设置安全问题屏出现（en=1/pin 已落库）', st.shown === true && st.title === '设置安全问题' && st.lsEn === '1' && st.lsPin === true, JSON.stringify(st));
await typeText('我们第一次见面的城市？'); await clickSubmit();
st = JSON.parse(await lockState() || '{}');
check('P4 输完问题进答案屏', st.shown === true && st.title === '设置答案', st.title);
await typeText('巴黎'); await clickSubmit();
await sleep(300);
st = JSON.parse(await lockState() || '{}');
check('P5 点【完成】后遮罩关闭（#271 核心：不再滞留此屏）', st.shown === false, JSON.stringify(st));
const qaStored = await evalJs("localStorage.getItem('" + P + "applock-qa')");
check('P6 完成同时已保存安全问答', !!qaStored && qaStored.indexOf('我们第一次见面的城市') >= 0, String(qaStored));
// 清理：关掉开关，避免后续组被锁屏挡住
await evalJs(`(function(){var c=document.getElementById('applock-en');if(c){c.checked=false;c.dispatchEvent(new Event('change'));}return 1;})()`);
await sleep(200);
await seedAndReload({}); // 重置为无锁态，抹掉刚才的数据

// ---- H. 静态防线 ----
// #860（PERF-PLAN 阶段 1b）：core 全外置后 applock.js 等代码在 js/<file> 产物里——
// 「产物含 xxx」判据一律走全产物池（index.html + js/*.js），否则整组假红。
const artifact = (function () {
  let pool = readFileSync(join(root, 'index.html'), 'utf8');
  try {
    const jsDir = join(root, 'js');
    for (const f of readdirSync(jsDir)) if (f.endsWith('.js')) pool += '\n' + readFileSync(join(jsDir, f), 'utf8');
  } catch (e) { /* 未构建时池里只有 index.html */ }
  return pool;
})();
const tpl = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const contacts = readFileSync(join(root, 'src', 'js', 'contacts.js'), 'utf8');
check('H1 模板含设置入口开关 #applock-en', tpl.indexOf('id="applock-en"') >= 0);
check('H2 contacts EXCLUDE 含应用锁+问答门键', contacts.indexOf("'applock-qa-en', 'applock-qalist', 'applock-qaskip'") >= 0);
check('H3 产物含锁屏样式 .applock-mask', artifact.indexOf('.applock-mask') >= 0);
check('H4 产物含脚本就绪标志 __applockReady', artifact.indexOf('window.__applockReady') >= 0);
check('H5 产物含 FLOAT 注册 #applock-mask', artifact.indexOf('#applock-mask') >= 0);
check('H6 产物含密码摘要函数 cyrb53(不存明文)', /function h53\(str\)/.test(artifact) || artifact.indexOf('2654435761') >= 0);
check('H7 产物含自愈加固 selfHealChecked（IDB 有密码先回填不放关锁，防「刷新后锁被关」回流）', artifact.indexOf('gSet(K_PIN, v); evalLock()') >= 0);

// ---- I. 开屏问答门：开启后冷启动先问答，答对放行（#1503 起为单页问答页，两题同页一次提交）----
// 只开问答门（无数字密码），题目用默认两道：mj→梦角 / 知晓→是
await seedAndReload({ 'applock-qa-en': '1' });
st = JSON.parse(await lockState() || '{}');
check('I1 问答门开启：冷启动出现公告式问答页', st.has && st.shown === true && st.qaPage === true && st.qaInputs === 2 && st.title.indexOf('开屏问答') === 0, JSON.stringify(st));

// 答错第一题 → 报错点名哪题
await qaFill(0, '梦角x');
await qaFill(1, '是');
await qaPageSubmit();
st = JSON.parse(await lockState() || '{}');
check('I2 答错提示且仍锁屏', st.shown === true && st.err.indexOf('不对') >= 0, st.err);

// 两题都对 → 放行（无密码锁）；#1511 答对一次＝本机永久放行（qaskip 落库，与输暗号等效）
await qaFill(0, '梦角');
await qaFill(1, '是');
await qaPageSubmit();
// #299：问答通过且本机未设密码锁时弹一次性「小提醒：应用锁」info pad——点【知道了】才算放行
await sleep(300);
await evalJs("(function(){var b=document.querySelector('#applock-mask .al-primary[data-ok=\"1\"]');if(b)b.click();return 1;})()");
await sleep(200);
st = JSON.parse(await lockState() || '{}');
check('I3 全部答对解锁进入（含 #299 一次性小提醒放行）', st.shown === false, JSON.stringify(st));
check('I3b 答对即本机永久放行（#1511：qaskip 已落库）', (await evalJs("localStorage.getItem('" + P + "applock-qaskip')")) === '1');

// #1511：答对后同标签刷新不再问答（对比 v3.32.x 旧口径「每次加载都问」，已按作者口径翻转）
await cdp('Page.reload');
await sleep(1200);
st = JSON.parse(await lockState() || '{}');
check('I4 答对后刷新不再问答（本机永久放行）', st.shown === false, JSON.stringify(st));

// 测暗号通路：恢复本机问答 → 再问；输暗号 990815 永久跳过
await seedAndReload({ 'applock-qa-en': '1', 'applock-qaskip': '0' });
st = JSON.parse(await lockState() || '{}');
check('I5 恢复本机问答后再问', st.shown === true && st.qaPage === true, st.title);
await clickLink('skipqa');
st = JSON.parse(await lockState() || '{}');
check('I6 出现暗号输入屏', st.shown === true && st.title.indexOf('跳过') >= 0, st.title);
await typeText('990815');
await clickSubmit();
st = JSON.parse(await lockState() || '{}');
check('I7 输对暗号放行', st.shown === false, JSON.stringify(st));

// 之后新会话也不再问（本机已跳过）
await clearSessAndReload();
st = JSON.parse(await lockState() || '{}');
check('I8 暗号后本机永久不再问答', st.shown === false, JSON.stringify(st));
check('I9 qaskip 标记已落库', (await evalJs("localStorage.getItem('" + P + "applock-qaskip')")) === '1');

// 恢复本机问答 → 重新要问答
await seedAndReload({ 'applock-qa-en': '1', 'applock-qaskip': '0' });
st = JSON.parse(await lockState() || '{}');
check('I10 恢复后重新问答', st.shown === true && st.qaPage === true, st.title);
await qaFill(0, '梦角'); await qaFill(1, '是'); await qaPageSubmit();
st = JSON.parse(await lockState() || '{}');
check('I11 恢复后答对放行', st.shown === false, JSON.stringify(st));

// ---- J. 双重验证：问答门 + 数字密码锁都开 → 先问答后密码 ----
await seedAndReload({ 'applock-qa-en': '1', 'applock-en': '1', 'applock-pin': h53('1234') });
st = JSON.parse(await lockState() || '{}');
check('J1 双重开启：先出问答页', st.shown === true && st.qaPage === true, st.title);
await qaFill(0, '梦角'); await qaFill(1, '是'); await qaPageSubmit();
st = JSON.parse(await lockState() || '{}');
check('J2 问答通过进入密码屏', st.shown === true && st.title.indexOf('应用锁已开启') === 0, st.title);
await clickKeys('4321'); await clickOk();
st = JSON.parse(await lockState() || '{}');
check('J3 密码错仍锁', st.shown === true && st.err.indexOf('不正确') >= 0, st.err);
await clickKeys('1234'); await clickOk();
st = JSON.parse(await lockState() || '{}');
check('J4 密码对解锁进入', st.shown === false, JSON.stringify(st));

// ---- K. 静态防线 ----
check('K1 模板含问答门开关 #applock-qa-en', tpl.indexOf('id="applock-qa-en"') >= 0);
check('K2 contacts EXCLUDE 含问答门三键', contacts.indexOf("'applock-qa-en', 'applock-qalist', 'applock-qaskip'") >= 0);
check('K3 产物含问答门暗号 990815 常量', artifact.indexOf("QA_SKIP_CODE = '990815'") >= 0 || artifact.indexOf("'990815'") >= 0);
check('K4 产物含问答屏入口 skipqa', artifact.indexOf('skipqa') >= 0);
check('K5 产物不再含题目管理面板（data-qal 增删改按钮已移除）', artifact.indexOf('data-qal') < 0);
check('K6 产物不含题目列表样式 .al-qa-row（编辑面板已移除）', artifact.indexOf('.al-qa-row') < 0);
check('K7 产物含固定 2 道默认题（梦角）', artifact.indexOf('梦角') >= 0);

// ---- M. 静态防线 ----
check('M1 产物含 __applockQaTest 验证钩子', artifact.indexOf('__applockQaTest') >= 0);

// ---- N. 默认开启（v3.32.x）：键未显式设置 = 真机默认开 ----
// 无头默认 navigator.webdriver=true → applock 把「未设键」当关（保护 278 个空库回归脚本）。
// 本组注入脚本把 webdriver 覆盖为 false 模拟真机 + 移除开屏（等价用户已点进入），
// 验证：清空全部锁键（不设 applock-qa-en）后冷启动仍应出现问答屏。
const injR = await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source:
    "try{Object.defineProperty(navigator,'webdriver',{get:function(){return false;}});}catch(e){}" +
    "try{Object.defineProperty(navigator,'userAgent',{get:function(){return 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1';}});}catch(e){}" +
    "var __qg=setInterval(function(){try{var s=document.getElementById('splash');if(s&&s.parentNode){s.parentNode.removeChild(s);clearInterval(__qg);}}catch(e){}},100);"
});
await seedAndReload({});
await sleep(1000);
st = JSON.parse(await lockState() || '{}');
check('N1 键未设+真机语义：默认出现问答屏', st.has && st.shown === true && st.title.indexOf('开屏问答') === 0, st.title);
await qaFill(0, '梦角'); await qaFill(1, '是'); await qaPageSubmit();
st = JSON.parse(await lockState() || '{}');
check('N2 默认开启下答对两题放行', st.shown === false, JSON.stringify(st));
try { if (injR && injR.identifier) await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: injR.identifier }); } catch (e) {}

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
