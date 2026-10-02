// ===== 回归脚本：切换桌面联系人 → 打开聊天「所有消息变 2 条再回弹恢复」（#594）=====
// 用法：node tools/verify-chat-switch-dupe.mjs            （测仓库根的 index.html 产物）
//       MOCHI_ROOT=<已构建目录> node tools/verify-chat-switch-dupe.mjs   （测临时构建副本，红绿对照）
// 用户报障：点【联系人】切到另一个桌面，再打开聊天，聊天里的所有消息都变成 2 个，
// 然后回弹一下恢复正常 1 个（明说其他设备型号也有）。
// 根因（chat.js，零机型/零内核分支，纯数据形态）：媒体令牌化（#142/#256/#283）后同一条消息
// 在 LS 兜底快照里是原文（base64 / 语音「名称|||data:audio」），在 IndexedDB 权威副本里已是
// @@m: 令牌；loadMsgs 权威合并的去重签名只比原文 ⇒ 同一条判成两条 ⇒ 快照副本被当新消息
// append 回 msgs（两侧 ts 相同 ⇒ 排序后成对相邻）⇒ 首屏所有消息翻倍，后台归一化又按相邻
// 重复合并回 1＝「变 2 个 → 回弹恢复正常」；归一化没赶上时重复还会被整包落盘固化。
// 断言：
//   A 轴（源码锚）：mediaFormText 唯一入口在位；权威合并签名走 mediaSigPart；三处合并点都接了
//                  recKindCovers；旧「原文直比」签名不得复活。
//   B 轴（真实产物）：三种媒体存法（text 贴纸 / img 字段图片 / 语音尾形态）各建一个桌面，
//                  切过去开聊天——条数不翻倍、DOM 气泡数不翻倍、无同 ts|side 重复对、
//                  开页过程采样无「翻倍帧」，且不被误并（不同 ts 的同内容消息保留两条）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---------- A 轴：源码锚（读 src，避免「产物没接入」漏判） ----------
const chatSrc = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
check('A1 mediaFormText 唯一归一化入口在位', /function mediaFormText\(s\) \{/.test(chatSrc));
check('A2 权威合并签名走 mediaSigPart（不再直接比原文）',
  /const sigOf = \(m\) => \{ try \{ return JSON\.stringify\(\{ t: mediaSigPart\(m && m\.text\)/.test(chatSrc));
check('A3 旧「原文直比」签名不得复活（absent）', !/t: m && m\.text, s: m && m\.side/.test(chatSrc));
check('A4 权威合并接了媒体形态互补判定',
  /if \(recKindCovers\(idbKinds, m\)\) return false;/.test(chatSrc));
check('A5 读侧 LS 合并接了媒体形态互补判定',
  /!seen\.has\(lsMergeSig\(m\)\) && !recKindCovers\(lsKinds, m\)/.test(chatSrc));
check('A6 写侧 LS 快照合并接了媒体形态互补判定',
  /seen\.has\(lsMergeSig\(m\)\) \|\| recKindCovers\(kinds, m\)/.test(chatSrc));
check('A7 dupSig / lsMergeSig 共用 mediaFormText（口径不再分叉）',
  /const x = mediaFormText\(m\.text\);/.test(chatSrc) && !/window\.mochiMediaIsToken\(x\) && window\.mochiMediaExpand\) \{ const ex = window\.mochiMediaExpand\(x\); if \(ex\) x = ex; \}/.test(chatSrc));

// ---------- B 轴：真实浏览器行为 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) {
  console.log('----');
  console.log('环境不满足：找不到 Chrome/Edge（设 CHROME_PATH 后重跑）');
  process.exit(2);
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9990 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-588-' + Date.now()),
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
    if (r && r.exceptionDetails) {
      console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function bootToReady() {
  for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
  await sleep(500);
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// 三种媒体存法：LS 侧全存原文，IDB 侧全存 @@m: 令牌（令牌化竞态的真实形态）
const MODES = ['sticker', 'imgfield', 'voice'];
const N_EACH = 12;

await evalJs(`(function(){ try{ indexedDB.deleteDatabase('xy-home-v2'); }catch(e){} try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} return 1; })()`);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2200);
await bootToReady();

const seed = await evalJs(`(async function(){
  try {
    var out = { cids: {}, tokOk: {}, n: ${N_EACH} };
    var t0 = Date.now() - 3600000;
    var rawImg = 'data:image/png;base64,' + 'A'.repeat(2000);
    var rawAud = 'data:audio/webm;base64,' + 'B'.repeat(2000);
    var modes = ${JSON.stringify(MODES)};
    for (var mi = 0; mi < modes.length; mi++) {
      var mode = modes[mi];
      var cid = window.createContact('联系人' + mode);
      var ls = [], idb = [];
      for (var i = 0; i < ${N_EACH}; i++) {
        var ts = t0 + i * 1000;
        var side = (i % 2 ? 'in' : 'out');
        var a, b2;
        if (mode === 'sticker') {
          a = { side: side, ts: ts, type: 'sticker', text: rawImg };
          var tk = await window.mochiMediaTokenize(rawImg);
          out.tokOk[mode] = !!tk;
          b2 = { side: side, ts: ts, type: 'sticker', text: tk };
        } else if (mode === 'imgfield') {
          a = { side: side, ts: ts, type: 'image', text: '', img: rawImg };
          var tk2 = await window.mochiMediaTokenize(rawImg);
          out.tokOk[mode] = !!tk2;
          b2 = { side: side, ts: ts, type: 'image', text: '', img: tk2 };
        } else {
          a = { side: side, ts: ts, type: 'voice', text: '语音消息|||' + rawAud };
          var tk3 = await window.mochiMediaTokenize(rawAud);
          out.tokOk[mode] = !!tk3;
          b2 = { side: side, ts: ts, type: 'voice', text: '语音消息|||' + tk3 };
        }
        ls.push(a); idb.push(b2);
      }
      localStorage.setItem('xy-home-v2:' + cid + ':chat-msgs', JSON.stringify(ls));
      await window.idbSet('xy-home-v2:' + cid + ':chat-msgs', JSON.stringify(idb));
      out.cids[mode] = cid;
    }
    // 默认桌面：普通小历史（保证启动路径正常）
    var defArr = [];
    for (var k = 0; k < 6; k++) defArr.push({ side: (k % 2 ? 'in' : 'out'), ts: t0 + k * 1000, text: '默认桌面消息 ' + k });
    localStorage.setItem('xy-home-v2:default:chat-msgs', JSON.stringify(defArr));
    await window.idbSet('xy-home-v2:default:chat-msgs', JSON.stringify(defArr));
    return JSON.stringify(out);
  } catch (e) { return JSON.stringify({ err: String(e) }); }
})()`);
let seedObj = {};
try { seedObj = JSON.parse(seed || '{}'); } catch (e) {}
if (seedObj.err || !seedObj.cids) {
  console.error('种子写入失败', seed);
  chrome.kill(); server.close();
  process.exit(1);
}
const tokModes = Object.keys(seedObj.tokOk || {}).filter(k => seedObj.tokOk[k]);
check('B0 令牌化可用（crypto.subtle + 媒体池就绪，缺则本脚本无判别力）', tokModes.length === MODES.length,
  JSON.stringify(seedObj.tokOk));

// 重载：媒体池热缓存清空＝冷池（recKindCovers 这条兜底路径的判别前提）
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2400);
await bootToReady();

for (const mode of MODES) {
  const cid = seedObj.cids[mode];
  // 回桌面（首次进聊天让应用走一遍首屏渲染），再切到目标桌面，再打开聊天
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]'); if(a) a.click(); return 1;})()");
  await sleep(900);
  await evalJs("(function(){var b=document.getElementById('chat-back'); if(b) b.click(); return 1;})()");
  await sleep(300);
  await evalJs(`(function(){ window.setActiveContact('${cid}'); return 1; })()`);
  await sleep(1200); // 等预读/权威合并落地（用户「切过去再点聊天」的自然节奏）
  // 采样：打开聊天前后逐帧记录 DOM 气泡数 vs msgs 条数（抓「翻倍帧」）
  await evalJs(`(function(){
    window.__s = [];
    var body = document.getElementById('chat-body');
    var n = 0;
    (function raf(){
      window.__s.push({ dom: body.children.length, msgs: (window.getChatMsgs()||[]).length });
      if (++n < 150) requestAnimationFrame(raf);
    })();
    return 1;
  })()`);
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]'); if(a) a.click(); return 1;})()");
  await sleep(3200);
  const rep = await evalJs(`(function(){
    try {
      var m = window.getChatMsgs() || [];
      var body = document.getElementById('chat-body');
      var seen = {}, dup = [];
      for (var i = 0; i < m.length; i++) {
        var k = ((m[i].ts || 0) + '|' + (m[i].side || ''));
        if (seen[k]) dup.push(k); else seen[k] = 1;
      }
      var domIdx = body.querySelectorAll('[data-idx]').length;
      var s = window.__s || [];
      var maxDom = 0;
      for (var j = 0; j < s.length; j++) { if (s[j].dom > maxDom) maxDom = s[j].dom; }
      return JSON.stringify({ msgs: m.length, domIdx: domIdx, dup: dup.length, maxDom: maxDom, last: s[s.length-1] || null });
    } catch (e) { return JSON.stringify({ err: String(e) }); }
  })()`);
  let o = {};
  try { o = JSON.parse(rep || '{}'); } catch (e) {}
  check('B1[' + mode + '] 切换桌面后开聊天条数不翻倍', o.msgs === N_EACH, 'msgs=' + o.msgs + ' expect=' + N_EACH + (o.err ? ' err=' + o.err : ''));
  check('B2[' + mode + '] DOM 气泡数与记录条数一致（无成对副本）', o.domIdx === N_EACH, 'dom=' + o.domIdx + ' expect=' + N_EACH);
  check('B3[' + mode + '] 无同 ts|side 重复对', o.dup === 0, 'dup=' + o.dup);
  check('B4[' + mode + '] 开页过程逐帧无「翻倍帧」', typeof o.maxDom === 'number' && o.maxDom <= N_EACH,
    'maxDom=' + o.maxDom + ' last=' + JSON.stringify(o.last));
  // 关掉聊天页，避免影响下一个桌面
  await evalJs("(function(){var b=document.getElementById('chat-back'); if(b) b.click(); return 1;})()");
  await sleep(300);
}

// C 轴：不过度合并——同内容但不同 ts 的合法重复必须保留（防「修翻倍改成乱吞」）
const cRep = await evalJs(`(async function(){
  try {
    var cid = window.createContact('联系人Ctrl');
    var t = Date.now() - 600000;
    var raw = 'data:image/png;base64,' + 'C'.repeat(2000);
    var tk = await window.mochiMediaTokenize(raw);
    if (!tk) return JSON.stringify({ err: 'tokenize null' });
    // 两条同图不同 ts（用户人为重发）＋ 一条同 ts 但原文形态的普通文本（不得被形态判定吞掉）
    var ls = [
      { side: 'out', ts: t + 1000, type: 'sticker', text: raw },
      { side: 'out', ts: t + 9000, type: 'sticker', text: raw },
      { side: 'out', ts: t + 20000, type: 'sticker', text: tk },
      { side: 'in', ts: t + 20000, type: 'text', text: '正文不受影响' }
    ];
    var idb = [
      { side: 'out', ts: t + 1000, type: 'sticker', text: tk },
      { side: 'out', ts: t + 9000, type: 'sticker', text: tk },
      { side: 'out', ts: t + 20000, type: 'sticker', text: tk }
    ];
    localStorage.setItem('xy-home-v2:' + cid + ':chat-msgs', JSON.stringify(ls));
    await window.idbSet('xy-home-v2:' + cid + ':chat-msgs', JSON.stringify(idb));
    return JSON.stringify({ cid: cid });
  } catch (e) { return JSON.stringify({ err: String(e) }); }
})()`);
let cObj = {};
try { cObj = JSON.parse(cRep || '{}'); } catch (e) {}
if (cObj.cid) {
  await evalJs(`(function(){ window.setActiveContact('${cObj.cid}'); return 1; })()`);
  await sleep(1200);
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]'); if(a) a.click(); return 1;})()");
  await sleep(2500);
  const cOut = await evalJs(`(function(){
    try {
      var m = window.getChatMsgs() || [];
      var media = 0, text = 0, tsList = [];
      for (var i = 0; i < m.length; i++) {
        if (m[i].type === 'sticker') { media++; tsList.push(m[i].ts); }
        if (m[i].type === 'text' || !m[i].type) text++;
      }
      return JSON.stringify({ total: m.length, media: media, text: text, tsList: tsList });
    } catch (e) { return JSON.stringify({ err: String(e) }); }
  })()`);
  let co = {};
  try { co = JSON.parse(cOut || '{}'); } catch (e) {}
  check('C1 同图不同 ts 的两条合法重复都保留（不误吞）', co.media === 3, 'media=' + co.media + ' total=' + co.total);
  check('C2 与令牌记录同 ts 的普通文本不被形态判定吞掉', co.text === 1, 'text=' + co.text);
} else {
  check('C1 同图不同 ts 的两条合法重复都保留（不误吞）', false, cObj.err || 'seed fail');
  check('C2 与令牌记录同 ts 的普通文本不被形态判定吞掉', false, 'seed fail');
}

chrome.kill();
server.close();
const pass = results.filter(r => r.ok).length;
console.log('----');
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
