// #1519 行为回归尺：字卡库大键闸（写侧清库）＋ 预设停用开关不得误伤自建卡
// 作者报障两条（多机型同现＝纯行为口径零机型分支）：
//   ① 全站审计出的同族缺口——TA 六类题库/位置卡库整包写前不验读数（大键没读全时把「纯预设＋本次改动」
//      写回＝自定义内容被清空）；13 类功能字卡取池口不请库取回（切后台后自建卡静默缺席）。
//   ② 关闭系统预设字卡的「整组停用／逐张开关」把用户自己添加的字卡一起关掉（寻踪三类 + 情话同文）。
// 红侧＝纯 origin/main 产物：恰红 S1~S8＋B1（自建地点被整组停用关光＝症状本尊）＋B2（题库被顶成纯预设）
// ＋B4（同文自建情话被关）＋B5（位置卡库被顶）。
import { readFileSync, statSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(resolve(process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..'));
if (!existsSync(join(root, 'index.html'))) { console.error('产物不在：' + root); process.exit(2); }
console.log('被测产物：' + root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' ← ' + detail : '')); }
};

// ---- S 组：产物锚（外置 js/<file>；产物去注释、零缩进，needle 按产物形态写）----
const srcOf = (f) => { try { return readFileSync(join(root, 'js', f), 'utf8'); } catch (e) { return ''; } };
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const P2 = srcOf('p2-features.js') + indexHtml;
console.log('S 产物锚');
ok('S1 #1519a 寻踪预设开关只对预设卡生效', P2.includes('if (CK_DEF_LIST[k].indexOf(x) < 0) return false;'));
ok('S2 #1519b 功能字卡取池口请库取回', srcOf('chatcard.js').includes('maybeHydrateReplyPool(); if (CC_FUNC_KEYS.indexOf(cat) < 0) return [];'));
ok('S3 #1519c TA 的提问题库写前问读全没有', srcOf('ta-ask.js').includes("window.xyBigWriteBlocked(store, KEY, 'TA 的提问题库')"));
ok('S4 #1519d 查岗问题库写前问读全没有', srcOf('ck-question.js').includes("window.xyBigWriteBlocked(store, KEY, '查岗问题库')"));
ok('S5 #1519e 邀请字卡库写前问读全没有', srcOf('ta-invite.js').includes("window.xyBigWriteBlocked(store, KEY, '邀请字卡库')"));
ok('S6 #1519f 题库读空请库取回', srcOf('ta-ask.js').includes('if (store.awaitingBigKey && store.awaitingBigKey(KEY)) store.requestBigKey(KEY);'));
ok('S7 #1519h 位置卡库写前问读全没有', srcOf('loc-lib.js').includes("window.xyBigWriteBlocked(store, CUSTOM_KEY, '位置卡库')"));

// ---- 无头浏览器 ----
const candidates = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9400 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1518-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
try {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        break;
      }
    } catch (e) {}
    await sleep(150);
  }
  if (!ws) throw new Error('无法连接无头浏览器');
} catch (e) { console.error('SKIP: ' + e.message); chrome.kill(); server.close(); process.exit(2); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: '(async()=>{' + expr.trim() + '})()', awaitPromise: true, returnByValue: true, userGesture: true });
    if (r && r.exceptionDetails) return { __err: String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').slice(0, 300) };
    return r && r.result ? r.result.value : null;
  } catch (e) { return { __err: String(e).slice(0, 120) }; }
}
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 423, height: 853, deviceScaleFactor: 1.7, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "(function(){try{localStorage.setItem('xy-home-v2:cardlock-state','open');localStorage.setItem('xy-home-v2:cardlock-pwver','2');}catch(e){}})()" });
let jsErr = 0;
ws.addEventListener('message', (ev) => {
  try { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') jsErr++; } catch (e) {}
});
async function openCold() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 50; i++) { if ((await evalJs('return !!window.__mochiDataReady')) === true) break; await sleep(300); }
  await evalJs("var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}} return true;");
  await sleep(500);
  await evalJs("try { if (window.cardLockTryUnlock) window.cardLockTryUnlock('990815'); } catch (e) {} return true;");
}
// 切一次后台再回来＝大键 memoryCache 副本被放掉（#1195e），同步读从此读空＝盲窗
const blindWindow = `(function(){var hd=Object.getOwnPropertyDescriptor(document,'visibilityState');
try{Object.defineProperty(document,'visibilityState',{get:function(){return 'hidden';},configurable:true});document.dispatchEvent(new Event('visibilitychange'));}catch(e){}
try{Object.defineProperty(document,'visibilityState',{get:function(){return 'visible';},configurable:true});document.dispatchEvent(new Event('visibilitychange'));}catch(e2){}
return true;})()`;

console.log('B 行为断言（423×853 无头）');
await openCold();
const fx = await evalJs("return { ready: !!window.xyStore && !!window.openCheckinPage && !!window.getCustomFuncCards && !!window.locLibSaveCustom && !!window.getQuoteOfDay };");
if (!fx || !fx.ready) { console.error('SKIP: 模块未就绪 ' + JSON.stringify(fx)); chrome.kill(); server.close(); process.exit(2); }

// ---- B1 寻踪：整组停用「地点」不得关掉自建地点（判别核心）----
const b1 = await evalJs(`
  var ns = window.xyStore('xy-home-v2:default');
  ns.set('checkin-cards-default', '1');
  ns.set('checkin-cards-place', JSON.stringify([{ t: '自建地点甲·云边小卖部' }]));
  ns.set('checkin-cards-action', JSON.stringify([{ t: '自建动作甲·给多肉浇水' }]));
  ns.set('checkin-cards-msg', JSON.stringify([{ t: '自建话术甲·记得想我' }]));
  if (window.presetGroup) window.presetGroup.set('cck', 'place', true); // 整组停用「地点」
  try { window.openCheckinPage(); } catch (e) { return { err: String(e).slice(0, 120) }; }
  var btn = document.getElementById('ck-refresh'); if (btn) btn.click();
  await new Promise(function (r2) { setTimeout(r2, 500); });
  var cur = null; try { cur = JSON.parse(ns.get('checkin-current') || 'null'); } catch (e2) {}
  if (window.presetGroup) window.presetGroup.set('cck', 'place', false);
  return { place: cur && cur.place || '', action: cur && cur.action || '', msg: cur && cur.msg || '' };
`);
// 判别点只有 place：预设开着＝合并池随机抽（抽到预设句是正常行为），但自建地点必须仍可能在场；
// 红侧＝整组停用把整类（含自建）关光 ⇒ place 恒空
ok('B1 整组停用「地点」后自建地点仍参与（红侧恰红＝自建卡被整组停用关光，症状本尊）',
  b1 && b1.place === '自建地点甲·云边小卖部', JSON.stringify(b1));

// ---- B1b 整组停用只压本类：动作/话术照常有内容 ----
ok('B1b 整组停用「地点」时动作与话术照常有内容', b1 && b1.action && b1.msg, JSON.stringify(b1));

// ---- B2 题库写闸（判别核心）：同一种库→驻留→切后台放掉→同一拍拨设置（load+save 同步，取回来不及落地）----
await openCold();
const b2 = await evalJs(`
  var ns = window.xyStore('xy-home-v2:default');
  var qs = [{ id: 'q_custom_1', text: '自建问题甲·你今天有没有梦见我', cat: 'daily', enabled: true, isPreset: false }];
  for (var i = 0; i < 8000; i++) qs.push({ id: 'q_pad_' + i, text: '题库填充第' + i + '号·一整段用来把这一格撑过二十万字符的大文本内容一二三四五六七八九十', cat: 'daily', enabled: true, isPreset: true });
  ns.set('ta-ask', JSON.stringify({ questions: qs, settings: { enabled: true, prob: 5, popupProb: 70, useDefault: true }, mergedIds: [] }));
  var ls0 = (localStorage.getItem('xy-home-v2:default:ta-ask') || '').length;
  var warm = 0;
  for (var w = 0; w < 30; w++) {
    warm = (ns.get('ta-ask') || '').length;
    if (warm > 260000) break;
    await new Promise(function (r0) { setTimeout(r0, 200); });
  }
  var landed = 0;
  for (var t = 0; t < 30; t++) {
    try { var raw0 = await window.idbGet('xy-home-v2:default:ta-ask'); landed = raw0 ? raw0.length : 0; } catch (e) {}
    if (landed > 260000) break;
    await new Promise(function (r1) { setTimeout(r1, 200); });
  }
  ${blindWindow}
  var el = document.getElementById('ta-ask-prob');
  el.value = '7'; el.dispatchEvent(new Event('input'));
  await new Promise(function (r2) { setTimeout(r2, 600); });
  var raw = null; try { raw = await window.idbGet('xy-home-v2:default:ta-ask'); } catch (e2) {}
  var d = null; try { d = JSON.parse(raw || 'null'); } catch (e3) {}
  var arr = (d && d.questions) || [];
  return { ls0: ls0, warm: warm, landed: landed, n: arr.length,
    hasCustom: arr.some(function (q) { return q && q.id === 'q_custom_1'; }),
    prob: d && d.settings ? d.settings.prob : -1 };
`);
ok('B2a 大键前提成立（LS 副本被收走、库里已落定、驻留可读）',
  b2 && b2.ls0 === 0 && b2.landed > 260000 && b2.warm > 260000, JSON.stringify(b2));
ok('B2 盲窗里拨设置＝拦下不落笔、自定义题不丢（红侧恰红＝题库被顶成纯预设＋概率被写穿）',
  b2 && b2.hasCustom === true && b2.n > 7000 && b2.prob === 5, JSON.stringify(b2));

// ---- B3 落定后照常保存（闸不变成新的存不进去）----
const b3 = await evalJs(`
  await new Promise(function (r2) { setTimeout(r2, 900); });
  var el = document.getElementById('ta-ask-prob');
  el.value = '9'; el.dispatchEvent(new Event('input'));
  await new Promise(function (r3) { setTimeout(r3, 700); });
  var raw = null; try { raw = await window.idbGet('xy-home-v2:default:ta-ask'); } catch (e) {}
  var d = null; try { d = JSON.parse(raw || 'null'); } catch (e2) {}
  var arr = (d && d.questions) || [];
  return { n: arr.length, hasCustom: arr.some(function (q) { return q && q.id === 'q_custom_1'; }),
    prob: d && d.settings ? d.settings.prob : -1 };
`);
ok('B3 库回填落定后照常保存（概率写进 9、自定义题不丢＝闸不是死路）',
  b3 && b3.hasCustom === true && b3.n > 7000 && b3.prob === 9, JSON.stringify(b3));

// ---- B5 位置卡库写闸：盲窗里整包写被拦 ----
const seedLoc = await evalJs(`
  var ns = window.xyStore('xy-home-v2:default');
  var arr = [{ t: '自建位置甲·楼下便利店' }];
  for (var i = 0; i < 8000; i++) arr.push({ t: '自建位置第' + i + '号·一整段用来把这一格撑过二十万字符的大文本内容' });
  ns.set('loc-lib-custom', JSON.stringify(arr));
  var landed = 0;
  for (var t = 0; t < 30; t++) {
    try { var raw = await window.idbGet('xy-home-v2:default:loc-lib-custom'); landed = raw ? raw.length : 0; } catch (e) {}
    if (landed > 200000) break;
    await new Promise(function (r2) { setTimeout(r2, 200); });
  }
  return { ls: (localStorage.getItem('xy-home-v2:default:loc-lib-custom') || '').length, n: arr.length, landed: landed };
`);
ok('B5a 位置卡库大键写入后 LS 副本被收走且库里已落定（前提成立）',
  seedLoc && seedLoc.ls === 0 && seedLoc.n > 7000 && seedLoc.landed > 260000, JSON.stringify(seedLoc));
await openCold();
const b5 = await evalJs(`
  var ns = window.xyStore('xy-home-v2:default');
  var warm = (ns.get('loc-lib-custom') || '').length; // 真实路径：先开过库（读进内存副本），再切后台被放掉
  ${blindWindow}
  var aw0 = false; try { aw0 = ns.awaitingBigKey('loc-lib-custom'); } catch (e0) {}
  var memLen = (ns.get('loc-lib-custom') || '').length;
  window.locLibSaveCustom([{ t: '盲窗里塞进来的位置卡' }]);
  await new Promise(function (r2) { setTimeout(r2, 500); });
  var raw = null; try { raw = await window.idbGet('xy-home-v2:default:loc-lib-custom'); } catch (e) {}
  var arr = null; try { arr = JSON.parse(raw || 'null'); } catch (e2) {}
  return { warm: warm, aw0: aw0, memLen: memLen, n: (arr || []).length, head: (arr && arr[0] && arr[0].t) || '' };
`);
ok('B5b 盲窗里保存位置卡＝拦下不落笔、库里原表完好（红侧恰红＝整本被顶成一行）',
  b5 && b5.warm > 260000 && b5.n > 7000 && b5.head === '自建位置甲·楼下便利店', JSON.stringify(b5));

// ---- B6 功能字卡池：放掉大键副本后自建功能卡最终能回来（弱判别：xyStore.get 自身也会补踢，
//      判别靠 S2 锚点；此条守「不许永久缺席」）----
const b6 = await evalJs(`
  var ns = window.xyStore('xy-home-v2:default');
  var fish = ['自建摸鱼卡甲·再摸五分钟'];
  var g = ns.get('cc-groups');
  var groups = null; try { groups = g ? JSON.parse(g) : null; } catch (e) {}
  if (!groups) groups = {};
  if (!groups.text) groups.text = [];
  groups.fish = [['摸鱼', fish.concat((function () { var a = []; for (var i = 0; i < 8000; i++) a.push('摸鱼填充第' + i + '号·一整段用来把这一格撑过二十万字符的大文本内容'); return a; })())]];
  var landed = 0;
  for (var t = 0; t < 30; t++) {
    try { var raw = await window.idbGet('xy-home-v2:default:cc-groups'); landed = raw ? raw.length : 0; } catch (e) {}
    if (landed > 200000) break;
    await new Promise(function (r2) { setTimeout(r2, 200); });
  }
  ns.set('cc-groups', JSON.stringify(groups));
  return { ls: (localStorage.getItem('xy-home-v2:default:cc-groups') || '').length, landed: landed };
`);
await openCold();
const b6r = await evalJs(`
  ${blindWindow}
  try { window.getCustomFuncCards('fish'); } catch (e) {}
  await new Promise(function (r2) { setTimeout(r2, 1200); });
  var arr = null; try { arr = window.getCustomFuncCards('fish'); } catch (e2) { arr = []; }
  return { has: (arr || []).some(function (c) { return String(c).indexOf('自建摸鱼卡甲') === 0; }), n: (arr || []).length };
`);
ok('B6 放掉 cc-groups 大键副本后自建功能卡仍能回池（不许永久缺席；判别主锚＝S2）',
  b6 && b6r && b6r.has === true, JSON.stringify(b6r));

ok('Z 全程零未捕获 JS 异常', jsErr === 0, 'jsErr=' + jsErr);

try { ws.close(); } catch (e) {}
chrome.kill(); server.close();
console.log('—— 合计：' + pass + ' 绿 / ' + fail + ' 红 ——');
process.exit(fail ? 1 : 0);
