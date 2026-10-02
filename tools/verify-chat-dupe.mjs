// ===== 复现/回归脚本：聊天消息重复（OPPO 默认浏览器用户反馈） =====
// 用法：node build.mjs && node tools/verify-chat-dupe.mjs
// 用户反馈：OPPO Reno15c 默认浏览器，「聊天记录有的时候会重复的发，我和联系人
// 发送的任何消息都重复了变成2条」。
// 验证两类重复根因：
//   A. LS 有损快照 × IDB 权威合并翻倍：writeLsSnapshot 超限时剥掉 img/voice，
//      冷启动先读 LS 有损副本，IDB 读回权威后按「text+side+ts+img前32字符」指纹
//      去重——有损副本 img='' 指纹必不等于 IDB 完整版指纹 → 被当新消息 append →
//      图片/语音类历史永久翻倍并回写 IDB。
//      断言：合并后条数 = IDB 权威条数（有损副本不得重复计入）；二次刷新仍不翻倍。
//   B. 发送路径重复触发兜底：同一文本在防重发窗口内第二次走 addMsg（输入法重组/
//      自动填充把已清空输入"复活"后再点发送等场景）应被吞掉；窗口外重发放行。
//      断言：窗口内重复发送只产生 1 条 out 记录；>窗口后允许再发。
//   C. 存量重复自愈：历史里已存在的重复对。#814（2026-09-19）契约改版——normCollapseRange 只回并
//      【同毫秒】重投副本（dts!==0 一律保留）：跨毫秒的存量内容重复对不再被刷新侧回吞（旧契约把
//      「TA 真发的合法第二条」一起吞＝用户报的「消息被吞」，见 tools/verify-msg-swallow.mjs S1~S4）；
//      同毫秒副本对仍收敛为 1（dupSig 内容判据保留）。发件侧实时 800ms 机械双派发窗口（B 组）零改动。
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9930 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-chatdupe-' + Date.now()),
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
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

const KEY = 'xy-home-v2:default:chat-msgs';
// 构造种子历史：3 条纯文本 + 2 条带图（img 用短 dataURL 形态即可命中指纹逻辑）
function seedJs(fullExtra, t0) {
  const t = t0 || (Date.now() - 100000);
  const recs = [
    { side: 'out', text: '早上好', ts: t + 1000 },
    { side: 'in', text: '早上好呀', ts: t + 2000 },
    { side: 'out', text: '看这个图', ts: t + 3000, img: 'data:image/jpeg;base64,' + 'A'.repeat(40) },
    { side: 'in', text: '哈哈好可爱', ts: t + 4000 },
    { side: 'in', text: '我也发一个', ts: t + 5000, img: 'data:image/png;base64,' + 'B'.repeat(40) }
  ];
  if (fullExtra === 'dupe') {
    // C 组用：历史里已存在重复对（历史 bug 写入的存量脏数据）。#814 契约：跨毫秒对保留、同毫秒对收敛
    // 1) 相邻同文本快速重复（Δts=120ms，跨毫秒）→ 按 #814b 保留 2 条（不再刷新侧回吞）
    recs.push({ side: 'out', text: '晚上吃什么', ts: t + 6000 });
    recs.push({ side: 'out', text: '晚上吃什么', ts: t + 6120 });
    // 2) 超出收敛窗口（Δts=15000ms>2500ms）的同文本人工重发 → 必须保留 2 条
    recs.push({ side: 'out', text: '明天见', ts: t + 7000 });
    recs.push({ side: 'out', text: '明天见', ts: t + 22000 });
    // 3) 异侧（我发+TA回）同文本 → 保留 2 条
    recs.push({ side: 'out', text: '哈哈', ts: t + 9000 });
    recs.push({ side: 'in', text: '哈哈', ts: t + 9050 });
    // 4) 相邻同内容系统提示（poke 双发形态，Δts=50ms 跨毫秒）→ 按 #814b 保留 2 条
    recs.push({ side: 'in', special: 'poke', text: '拍了拍你', ts: t + 9200 });
    recs.push({ side: 'in', special: 'poke', text: '拍了拍你', ts: t + 9250 });
    // 5) 非相邻（中间隔着其他消息）同文本 → 保留 2 条
    recs.push({ side: 'out', text: '在吗', ts: t + 9400 });
    recs.push({ side: 'out', text: '别的', ts: t + 9450 });
    recs.push({ side: 'out', text: '在吗', ts: t + 9500 });
    // 6) 两张完全相同的互动卡片（ask-card 双发/合并翻倍形态，Δts=20ms 跨毫秒）→ 按 #814b 保留 2 条；
    //    紧接着另一张【不同问题】的卡片 → 保留（不同内容不误删）
    recs.push({ side: 'in', special: 'ask-card', askQuestion: '今晚吃什么', askType: 'text', askStatus: 'pending', ts: t + 9600 });
    recs.push({ side: 'in', special: 'ask-card', askQuestion: '今晚吃什么', askType: 'text', askStatus: 'pending', ts: t + 9620 });
    recs.push({ side: 'in', special: 'ask-card', askQuestion: '周末去哪玩', askType: 'text', askStatus: 'pending', ts: t + 9700 });
    // 7) 相邻同图片消息（同 img dataURL，Δts=50ms 跨毫秒）→ 按 #814b 保留 2 条
    recs.push({ side: 'in', text: 'img1', img: 'data:image/png;base64,' + 'C'.repeat(40), ts: t + 9800 });
    recs.push({ side: 'in', text: 'img1', img: 'data:image/png;base64,' + 'C'.repeat(40), ts: t + 9850 });
    // 8) 【同毫秒】重投副本对（ts 完全相同）→ 仍收敛为 1（#814b 保留的同毫秒回并路径＋dupSig 判据）
    recs.push({ side: 'out', text: '同毫秒副本', ts: t + 9900 });
    recs.push({ side: 'out', text: '同毫秒副本', ts: t + 9900 });
  }
  const lite = recs.map(m => (m.img ? Object.assign({}, m, { img: '' }) : m));
  return { full: JSON.stringify(recs), lite: JSON.stringify(lite), n: recs.length };
}

// 种子时间基准＝「现在往前 100s」，一次算好供写入与断言共用（开屏注入的记录 ts≈现在，落在窗口外，
// 所以条数断言只统计种子区间内的记录，不再被应用自注入的当日提醒之类的记录污染）。
const SEED_T = Date.now() - 100000;

async function loadFresh(seedMode) {
  const base = seedMode ? SEED_T : 0;
  await cdp('Page.navigate', { url: 'about:blank' });
  await evalJs(`(function(){ try{ indexedDB.deleteDatabase('xy-home-v2'); }catch(e){} try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} return 1; })()`);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2000);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
  await sleep(500);
  if (seedMode) {
    const s = seedJs(seedMode === 'dupe' ? 'dupe' : '', base);
    const okSeed = await evalJs(`(async function(){
      try {
        localStorage.setItem('${KEY}', ${JSON.stringify(s.lite)});
        await window.idbSet('${KEY}', ${JSON.stringify(s.full)});
        return { n: ${s.n}, ok: true };
      } catch (e) { return { ok: false, err: String(e) }; }
    })()`);
    if (!okSeed || !okSeed.ok) { console.error('种子写入失败', okSeed); process.exit(1); }
    // 重载让 loadMsgs 走「LS 有损预载 + IDB 权威合并」完整链路
    await cdp('Page.navigate', { url: baseUrl + '/index.html' });
    await sleep(2200);
    for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
    await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
    await sleep(2500); // 等 IDB 合并回调跑完
  }
}

// ---- A+C. LS 有损快照合并 + 存量重复自愈 ----
await loadFresh('dupe'); // 种子含存量重复（C）：文本对/超窗对/异侧/系统提示/非相邻/卡片对/图片对/同毫秒对
const baseN = seedJs('dupe', SEED_T).n - 1; // 期望干净条数 = 种子数 - 1（仅同毫秒副本对收敛；跨毫秒存量对按 #814b 契约保留）
const a = await evalJs(`(function(){
  try {
    var all = window.getChatMsgs() || [];
    var m = all.filter(function (r) { return r && r.ts >= ${SEED_T} && r.ts <= ${SEED_T} + 30000; });
    // 与 collapseRapidDups 同口径（dupSig）检查：只查【数组相邻】的重复对
    function sig(x){
      if(!x) return '';
      var sp=x.special||''; var extra='';
      if(sp==='ask-card'||sp==='ask') extra=String(x.askQuestion||'')+'|'+JSON.stringify(x.askOptions||[])+'|'+String(x.askType||'');
      else if(sp==='ask-choose') extra=String(x.choiceQuestion||'')+'|'+JSON.stringify(x.choiceOptions||[])+'|'+String(x.choicePref||'')+'|'+String(x.choiceCat||'');
      else if(sp==='ask-curious') extra=String(x.curiousQuestion||'')+'|'+JSON.stringify(x.curiousQuick||[])+'|'+String(x.curiousCat||'');
      else if(sp==='ask-roast') extra=String(x.roastText||'')+'|'+String(x.roastCat||'');
      else if(sp==='invite') extra=String(x.inviteContent||x.text||'');
      else if(sp==='gift'||sp==='flower') extra=String(x.flName||'')+'|'+String(x.flEmoji||'')+'|'+String(x.flWish||'');
      var nt=(x.type==='text'||!x.type)?'':String(x.type||'');
      return JSON.stringify({s:x.side||'',t:nt,sp:sp,x:x.text||'',im:!!x.img,vc:!!x.voice,e:extra});
    }
    var badDup = [];
    for (var i = 1; i < m.length; i++) {
      var p = m[i-1], q = m[i];
      if (!p || !q || !p.side || p.side !== q.side) continue;
      if (sig(p) !== sig(q)) continue;
      var hasContent=(p.text&&p.text.length)||p.img||p.voice||!!p.special||(p.parts&&p.parts.length);
      if(!hasContent) continue;
      var isMedia=!!p.img||!!p.voice||!!p.special;
      var dts = (q.ts||0) - (p.ts||0);
      var cap = isMedia ? 60000 : 2500;
      if (dts >= 0 && dts <= cap) badDup.push((p.text||'').slice(0,10) + '@' + dts + '@' + p.special);
    }
    var cnt = function(side, text){ var n=0; m.forEach(function(r){ if ((r.side||'')===side && (r.text||'')===text) n++; }); return n; };
    var cntAsk = function(q){ var n=0; m.forEach(function(r){ if (r.special==='ask-card' && r.askQuestion===q) n++; }); return n; };
    var cntImg = function(){ var n=0; m.forEach(function(r){ if (r.img && (r.text||'')==='img1') n++; }); return n; };
    return JSON.stringify({ total: m.length, allTotal: all.length, badDup: badDup,
      cntNight: cnt('out','晚上吃什么'), cntBye: cnt('out','明天见'),
      cntPoke: cnt('in','拍了拍你'), cntZaima: cnt('out','在吗'), cntOther: cnt('out','别的'),
      cntAskSame: cntAsk('今晚吃什么'), cntAskDiff: cntAsk('周末去哪玩'), cntImg: cntImg(),
      cntSameMs: cnt('out','同毫秒副本') });
  } catch (e) { return JSON.stringify({ err: String(e) }); }
})()`) || '{}';
{
  let aObj = {}; try { aObj = JSON.parse(a); } catch (e) {}
  const bd = JSON.stringify(aObj.badDup || []);
  check('AC1 合并后条数正确（有损副本不计入+同毫秒副本已收敛）', aObj.total === baseN, 'seedTotal=' + aObj.total + ' expect=' + baseN + ' 含注入=' + aObj.allTotal);
  check('AC2 刷新只并同毫秒副本：窗口内残留对恰为 4 对种子（跨毫秒存量按 #814b 保留、无多余回吞）',
    Array.isArray(aObj.badDup) && aObj.badDup.length === 4
    && bd.indexOf('晚上吃什么@120') >= 0 && bd.indexOf('拍了拍你@50') >= 0
    && bd.indexOf('@20@ask-card') >= 0 && bd.indexOf('img1@50') >= 0, bd);
  check('AC4 跨毫秒存量文本对保留 2 条（#814：不追溯删）', aObj.cntNight === 2, 'cnt=' + aObj.cntNight);
  check('AC6 跨毫秒同内容系统提示(poke)保留 2 条（#814：不追溯删）', aObj.cntPoke === 2, 'cnt=' + aObj.cntPoke);
  check('AC7 完全相同互动卡片保留 2 / 不同问题卡片保留（#814：不追溯删）', aObj.cntAskSame === 2 && aObj.cntAskDiff === 1, 'same=' + aObj.cntAskSame + ' diff=' + aObj.cntAskDiff);
  check('AC8 跨毫秒同图片消息保留 2 条（#814：不追溯删）', aObj.cntImg === 2, 'cnt=' + aObj.cntImg);
  check('AC9 同毫秒同文副本已收敛为 1 条（#814b 保留的同毫秒回并路径）', aObj.cntSameMs === 1, 'cnt=' + aObj.cntSameMs);
  check('AC3 超窗(>2.5s)/异侧/非相邻的合法重复原样保留',
    aObj.cntBye === 2 && aObj.cntZaima === 2 && aObj.cntOther === 1,
    'bye=' + aObj.cntBye + ' zaima=' + aObj.cntZaima + ' other=' + aObj.cntOther);
}
// 回写后二次刷新，确认没有把重复固化进 IDB / 自愈结果持久
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2200);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
await sleep(2500);
const a2 = await evalJs(`(function(){
  try { var a=window.getChatMsgs()||[]; var s=a.filter(function(r){ return r && r.ts >= ${SEED_T} && r.ts <= ${SEED_T} + 30000; });
    return JSON.stringify({ seed: s.length, injected: a.length - s.length }); } catch (e) { return JSON.stringify({ err: String(e) }); }
})()`) || '{}';
{
  let o = {}; try { o = JSON.parse(a2); } catch (e) {}
  check('AC5 二次刷新条数稳定（自愈已回写）', o.seed === baseN, 'seed=' + o.seed + ' expect=' + baseN + ' 另有开屏注入=' + o.injected);
}

// ---- B. 发送路径防重发窗口 ----
// 场景：输入法重组/自动填充把已清空的输入复活 → 同文本短时间内第二次 addMsg。
// 窗口内第二次必须被吞掉；窗口过后允许再次发送。
// v3.12.x：窗口 2500ms——覆盖荣耀 200 Pro Edge / 雨见 等内核「同一次点按派发两次
// click」的双发场景（两次事件间隔实测可达 1.2~2s，旧 1200ms 窗口漏网出双条）。
const b = await evalJs(`(async function(){
  try {
    var inp = document.getElementById('chat-input');
    var send = document.getElementById('chat-send');
    if (!inp || !send) return JSON.stringify({ err: 'no input/send' });
    var before = window.getChatMsgs().filter(function(r){ return r.side === 'out'; }).length;
    inp.innerText = '在吗';
    send.click();                       // 第 1 次：正常发送
    inp.innerText = '在吗';             // 模拟输入法复活文本
    send.click();                       // 窗口内第 2 次：应被吞掉
    inp.innerText = '在吗';             // iOS 候选词确认→重组回补点可达 1s+，仍属窗口内
    await new Promise(function(r){ setTimeout(r, 900); });
    send.click();                       // 距上次成功发送 ~900ms < 2500ms：仍应被吞掉
    var midCount = window.getChatMsgs().filter(function(r){ return r.side === 'out'; }).length;
    // v3.12.x：荣耀/雨见双发区间——距上次成功发送 1.6s（>旧窗口 1.2s，<新窗口 2.5s）：
    // 第二次 click 应被吞掉，不再产出第 2 条
    inp.innerText = '在吗';
    await new Promise(function(r){ setTimeout(r, 700); });
    send.click();
    var mid2Count = window.getChatMsgs().filter(function(r){ return r.side === 'out'; }).length;
    await new Promise(function(r){ setTimeout(r, 1300); });
    inp.innerText = '在吗';
    send.click();                       // 窗口外（距首次发送 >2.9s）：放行
    var endCount = window.getChatMsgs().filter(function(r){ return r.side === 'out'; }).length;
    return JSON.stringify({ before: before, mid: midCount, mid2: mid2Count, end: endCount });
  } catch (e) { return JSON.stringify({ err: String(e) }); }
})()`) || '{}';
{
  let o = {}; try { o = JSON.parse(b); } catch (e) {}
  if (o.err) check('B1 防重发窗口', false, o.err);
  else {
    check('B1 窗口内重复发送只发 1 条', o.mid - o.before === 1, 'mid-before=' + (o.mid - o.before));
    check('B3 双发区间（1.2~2.5s）仍只发 1 条', o.mid2 - o.before === 1, 'mid2-before=' + (o.mid2 - o.before));
    check('B2 窗口外重发放行', o.end - o.mid2 === 1, 'end-mid2=' + (o.end - o.mid2));
  }
}

chrome.kill();
server.close();
const pass = results.filter(r => r.ok).length;
console.log('----');
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
