// ===== 专项：经期关心字卡（库内分组 + 触发概率重设计 + 统计卡重叠修复） =====
// 用法：node tools/verify-period-care.mjs
// 背景（用户反馈三点）：
//   ① 经期触发的梦角关心字卡在字卡库【系统预设字卡】里没有对应分组可查看；
//   ② 经期只有第一天触发关心、之后几乎不再触发——旧三层门控叠加（chat 回复路径预掷
//      20% × 连发衰减至 20% × 当日基数 85/60/35），第 2 天起单次触发率仅 ~12%；
//   ③ 统计卡 UI 字与图形重叠（趋势图均值标签压折线；相位分布「第N天」标签压下一行）。
// 验证：
//   A 组源码静态断言；B 组运行时——种入经期数据后驯化 Math.random 控制触发路径，
//   包装 chatAddIn 计数验证 触发/同日冷却/库内逐张开关联动/第5+天可达；
//   C 组运行时 UI——字卡库【经期关心】tab 渲染与开关写入；经期页统计卡几何断言
//   （相位分布标签落在专属槽内不压下一行、趋势图均值文字已移出 SVG）。
// 自组装临时站点（同 verify-pomo-bell 先例）：不依赖也不触发 node build.mjs；
//   结束时删除临时目录（2026-08-25 教训：1500+ 个 mochi-* 残目录曾把 C 盘塞满导致写入事故）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : ''));
}

// ---- A 组：源码静态断言 ----
{
  const dataSrc = readFileSync(join(root, 'src', 'js', 'default-cards-data.js'), 'utf8');
  const libM = dataSrc.match(/DEFAULT_CARD_DATA\.period\s*=\s*\[([\s\S]*?)\n\];/);
  const lib = libM ? libM[1] : '';
  check('A1 default-cards-data.js 新增 DEFAULT_CARD_DATA.period「经期关心」预设池（≥18 条）',
    /["']经期关心["']/.test(lib) && (lib.match(/["'][^"'\n]{6,}["']/g) || []).length >= 18);
  check('A2 预设池含代表性文案（红糖水/热水袋/情绪低落）',
    lib.includes('记得喝点红糖水') && lib.includes('热水袋') && lib.includes('情绪低落'));

  const tplSrc = readFileSync(join(root, 'src', 'template.html'), 'utf8');
  const cardsSrc = readFileSync(join(root, 'src', 'js', 'default-cards.js'), 'utf8');
  // v3.16.x：功能 tab 拆到独立页 #fc-tabs，模板静态预置（data-type=period 等）
  check('A3 template.html #fc-tabs 预置「经期」tab（data-type=period，与 摸鱼/吃饭 按用户词汇命名连排）',
    /data-type="fish">摸鱼<\/button>[\s\S]*?data-type="eat">吃饭<\/button>[\s\S]*?data-type="period">经期<\/button>/.test(tplSrc) && /dc-off-<分类>:\*/.test(cardsSrc));

  // chat.js 曾事故重建为 minified（注释丢失），断言锚定调用点本身：唯一调用 + 邻域无预掷门控
  const chatSrc = readFileSync(join(root, 'src', 'js', 'chat.js'), 'utf8');
  const calls = chatSrc.match(/try \{ window\.periodCheckCare && window\.periodCheckCare\(\); \} catch \(e\) \{\}/g) || [];
  let a4ok = calls.length === 1;
  if (a4ok) {
    const i = chatSrc.indexOf('window.periodCheckCare');
    a4ok = !/Math\.random\(\) \* 100 < 20/.test(chatSrc.slice(Math.max(0, i - 260), i + 120));
  }
  check('A4 chat.js 回复路径不再 20% 预掷门控（直接调用 periodCheckCare）', a4ok, { calls: calls.length });

  const pSrc = readFileSync(join(root, 'src', 'js', 'period.js'), 'utf8');
  // #559：PERIOD_CARE_LINES 由旧 IIFE 直读 g[0] 改为 cardGroupLines('经期关心', 兜底)——
  //   仍是 DEFAULT_CARD_DATA.period 单一数据源 + 数据缺失兜底，锚点随实现更新、意图不变
  check('A5 period.js 关心语改从 DEFAULT_CARD_DATA.period 单一数据源取（带兜底；#559 起经 cardGroupLines）',
    /PERIOD_CARE_LINES = cardGroupLines\('经期关心', PERIOD_CARE_FALLBACK\)/.test(pSrc) &&
    /function cardGroupLines\(name, fb\)/.test(pSrc) &&
    /PERIOD_CARE_FALLBACK/.test(pSrc));
  check('A6 抽取过滤同时认 库内开关 dc-off-period 与旧 period-care-off',
    /careLineBlocked/.test(pSrc) && /isDefaultCardOff\('period'/.test(pSrc));
  const careM = pSrc.match(/function checkCare\(\)[\s\S]*?\n  \}/);
  const cb = careM ? careM[0] : '';
  check('A7 checkCare 新概率：经期第1-2天90%/第3-4天70%/第5+天55%/非经期75%',
    /baseProb = 90/.test(cb) && /baseProb = 70/.test(cb) && /baseProb = 55/.test(cb) && /var baseProb = 75/.test(cb));
  check('A8 连发衰减机制已移除（无 careStreak/careLastTs），同日冷却保留',
    !/careStreak|careLastTs/.test(pSrc) && /notifyCfg\.fired\[careKey\]\) return;/.test(cb));
  check('A9 趋势图均值文字标签移出 SVG（改 ps-trend-cap 说明行 + y 轴上下界刻度）',
    !/<text[^>]*>均值 /.test(pSrc.match(/trendHtml = [\s\S]*?<\/svg>/)[0]) &&
    /ps-trend-cap/.test(pSrc) && /text-anchor="end">' \+ fN\(hi\)/.test(pSrc));
  const cssSrc = readFileSync(join(root, 'src', 'css', 'chat-pages.css'), 'utf8');
  check('A10 相位分布柱状图容器预留底部标签槽（height46+padding14），数字不再越界压行',
    /\.ps-phase-bars \{[^}]*height:46px[^}]*padding-bottom:14px/.test(cssSrc));
  // v3.14.x 续：系统功能直发聊天的字卡带来源标签 chip
  // v3.15.x：新增 opts.tagNoDup——只留 chip 不重复正文（摸鱼抓包回应用）
  check('A11 addIn 支持 opts.tag（→ rec.mood 标签 chip，复用现成渲染+持久化链路；tagNoDup 只留 chip）',
    /const _tagMood = opts\.tag \? \[\{ tag: String\(opts\.tag\), label: opts\.tagNoDup \? '' : String\(text\) \}\] : null;/.test(chatSrc) &&
    /mood: opts\.mood \|\| _tagMood \|\| undefined/.test(chatSrc));
  const perSrc2 = readFileSync(join(root, 'src', 'js', 'period.js'), 'utf8');
  const p2Src = readFileSync(join(root, 'src', 'js', 'p2-features.js'), 'utf8');
  // #559：经期发送点标签改语境三元（经期中=经期关心/经前预警日·推迟=经期预警），锚点随实现更新
  check('A12 发送点带语境标签（#1474 后=症状/经期/预警三词三元 ×1）、喝水提醒 ×2、吃饭提醒 ×2、摸鱼抓包 ×1',
    (perSrc2.match(/tag: kind === 'sym' \? '症状关心' : \(kind === 'in' \? '经期关心' : '经期预警'\)/g) || []).length === 1 &&
    (p2Src.match(/tag: '喝水提醒'/g) || []).length === 2 &&
    (p2Src.match(/tag: '吃饭提醒'/g) || []).length === 2 &&
    (p2Src.match(/tag: '摸鱼抓包'/g) || []).length === 1);
}

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

// 组装临时站点：index.html 由 src 源文件现场拼接（文件清单从 build.mjs 提取，防手抄漂移）
const tmpSite = mkdtempSync(join(tmpdir(), 'mochi-period-care-'));
const html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
let outHtml = '';
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  const cm = bm.match(/cssFiles\s*=\s*\[([\s\S]*?)\]/);
  const jm = bm.match(/jsFiles\s*=\s*\[([\s\S]*?)\]/);
  const parseArr = (m) => (m ? [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]) : []);
  const cssFiles = parseArr(cm), jsFiles = parseArr(jm);
  const cssAll = cssFiles.map(f => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
  const jsAll = jsFiles.map((f) => {
    try { return readFileSync(join(root, 'src', 'js', f), 'utf8'); } catch (e) { return ''; }
  }).join('\n');
  if (!/DEFAULT_CARD_DATA\.period/.test(jsAll)) { console.error('JS 拼接缺少经期关心预设池'); process.exit(1); }
  outHtml = html.replace('/*__STYLES__*/', () => cssAll).replace('/*__SCRIPTS__*/', () => jsAll);
}
writeFileSync(join(tmpSite, 'index.html'), outHtml);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(tmpSite, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(tmpSite)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[ext(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
function ext(p) { const i = p.lastIndexOf('.'); return i < 0 ? '' : p.slice(i); }
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-period-care-prof-' + Date.now()),
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

await cdpConnect();
await cdp('Page.enable');
// #1407⑦ 之后必须把「驯化随机」提到文档起始：本探针原来是在导航后 500ms 才把 Math.random 钉成
//   恒不触发，而本批新加的「IDB 回填落地后重读＋补跑」跑得更早（restore-done +200ms），
//   于是启动期那一发用真随机抢掉了当天名额 → 后面每次触发都数到 0（假红）。
//   addScriptToEvaluateOnNewDocument 在任何脚本之前落地，启动期所有触发点都被钉住（同 _dbg-scroll 先例）。
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__origRandom=Math.random;Math.random=function(){return 0.999;};' });
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function navigate() {
  // 导航前清掉上一场景持久化的同日冷却键（否则下个场景的触发测试会被吃掉名额）
  await evalJs("(function(){try{window.xyStore('xy-home-v2').remove('period-notify');}catch(e){}return 1;})()");
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(500);
  // 立即驯化 Math.random→恒不触发（99.9>所有基数），防启动 5s 兜底 checkCare 抢跑消耗当日名额
  await evalJs("window.__origRandom=Math.random;Math.random=function(){return 0.999;};1");
  await sleep(1900);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
  await sleep(2300);
  await evalJs("(function(){var m=document.getElementById('cc-scope-mask');if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();}return 1;})()");
  await sleep(3800); // 越过启动期 checkCare/checkNotify 定时器（已被驯化，不会发卡）
}

// 经全局 store 种数据（走 xyStore 同步写 LS+IDB，绕过会被启动恢复覆盖的裸 LS 写）
async function seedRecords(startDaysAgo, periodLen) {
  return evalJs(`(function(){
    var d=new Date();d.setDate(d.getDate()-${startDaysAgo});
    var p=function(n){return (n<10?'0':'')+n;};
    var s=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
    window.xyStore('xy-home-v2').set('period-records',JSON.stringify([{id:'seed1',start:s,end:null}]));
    ${periodLen ? "window.xyStore('xy-home-v2').set('period-cfg',JSON.stringify({cycleLen:28,periodLen:" + periodLen + ",lutealPhase:14}));" : ''}
    return s;
  })()`);
}
async function armAndCount() {
  // 解除驯化改为必中 + 包装 chatAddIn 计数命中预设池的插入（只包一层防重复计数）
  return evalJs(`(function(){
    try {
      var lines=(window.DEFAULT_CARD_DATA&&window.DEFAULT_CARD_DATA.period&&window.DEFAULT_CARD_DATA.period[0][1])||[];
      var set={};lines.forEach(function(l){set[l]=1;});
      if(!window.__careWrapped){
        window.__careWrapped=true;
        var orig=window.chatAddIn;
        window.chatAddIn=function(t,o){
          if(set[t]||(o&&o.tag)==='症状关心'){window.__careCount=(window.__careCount||0)+1;window.__lastCareLine=t;window.__lastTag=(o&&o.tag)||'';} // #1474 重基线：场景带 3 天内症状时优先发「症状关心」（语料不在经期池），按 tag 认账
          return orig.apply(this,arguments);
        };
      }
      window.__careCount=0;
      Math.random=function(){return 0;};
      window.periodCheckCare();
      return JSON.stringify({count:window.__careCount,total:(window.__careTotal=(window.__careTotal||0)+window.__careCount)});
    } catch(e){ return 'err:'+e.message; }
  })()`);
}
async function clearLibToggles() {
  await evalJs("(function(){var ls=(window.DEFAULT_CARD_DATA.period[0][1]);ls.forEach(function(l){window.xyStore('xy-home-v2:default').remove('dc-off-period:'+l);});return 1;})()");
}

// ===== B 组：运行时触发链路 =====
await navigate();
const s1date = await seedRecords(2); // 今天=经期第3天（70% 档）
check('B0 种入经期记录成功（start=今-2）', /^20\d\d-/.test(s1date || ''), s1date);

await navigate();
{
  const r1 = JSON.parse(await armAndCount() || '{}');
  check('B1 经期第3天触发一条关心字卡（chatAddIn 计数=1）', r1.count === 1, r1);
  const tagInfo = JSON.parse(await evalJs("(function(){return JSON.stringify({tag:window.__lastTag});})()") || '{}');
  // DOM 断言：插入的气泡内渲染出「经期关心」标签 chip，且随消息持久化（rec.mood）
  const chip = await evalJs(`(function(){
    var msgs=[].slice.call(document.querySelectorAll('#chat-body .msg-in'));
    for(var i=msgs.length-1;i>=0;i--){
      var b=msgs[i].querySelector('.msg-bubble');if(!b)continue;
      var tag=b.querySelector('.msg-mood-tag');
      if(tag&&tag.textContent==='经期关心')return 'chip-ok';
    }
    return 'no-chip';
  })()`);
  check('B1b 触发字卡带「经期关心」来源标注（opts.tag 传入 + 气泡内 chip 渲染）',
    tagInfo.tag === '经期关心' && chip === 'chip-ok', { tag: tagInfo.tag, dom: chip });
  await sleep(1500); // 等 saveMsgs 防抖把快照写进 LS
  const persist = await evalJs("(function(){var raw=localStorage.getItem(window.activePrefix()+':chat-msgs')||'';return raw.indexOf('经期关心')>=0?'persisted':'not-found';})()");
  check('B1c 标签随消息持久化（chat-msgs 快照含「经期关心」，重进聊天仍在）', persist === 'persisted', persist);
  const fired = await evalJs("(function(){var n=JSON.parse(localStorage.getItem('xy-home-v2:period-notify')||'{}');var k=Object.keys(n.fired||{});return JSON.stringify({keys:k});})()");
  check('B2 同日冷却键已持久化（#1407⑧ 起两侧共用 today_said_inPeriod）', /_said_inPeriod/.test(fired || ''), fired);
  const r2 = JSON.parse(await armAndCount() || '{}');
  check('B3 同一天重复调用不再追加（本次增量=0、累计仍=1）', r2.count === 0 && r2.total === 1, r2);
}

await navigate();
{
  // 库内全部关闭 → 静默；放开一张 → 恢复触发（dc-off-period 与实际抽取联动）
  await evalJs("(function(){var ls=(window.DEFAULT_CARD_DATA.period[0][1]);ls.forEach(function(l){window.xyStore('xy-home-v2:default').set('dc-off-period:'+l,'1');});return ls.length;})()");
  const rOff = JSON.parse(await armAndCount() || '{}');
  check('B4 库内全部逐张关闭后不再触发（计数=0）', rOff.count === 0 && rOff.total === 0, rOff);
  await evalJs("(function(){var l=window.DEFAULT_CARD_DATA.period[0][1][0];window.xyStore('xy-home-v2:default').remove('dc-off-period:'+l);return 1;})()");
  const dbg = await evalJs("(function(){var l=(window.DEFAULT_CARD_DATA.period[0][1]||[])[0]||'';return JSON.stringify({nsKey:localStorage.getItem('xy-home-v2:default:dc-off-period:'+l),isOff:window.isDefaultCardOff?(''+window.isDefaultCardOff('period',l)):'no-fn'});})()");
  console.log('  [dbg B5]', dbg);
  const rOn = JSON.parse(await armAndCount() || '{}');
  check('B5 放开其中一张即恢复触发（计数=1）', rOn.count === 1, rOn);
  const which = await evalJs("(function(){return window.__lastCareLine||'';})()");
  const expectFirst = await evalJs("(function(){return (window.DEFAULT_CARD_DATA.period[0][1]||[])[0]||'';})()");
  check('B6 抽中的正是放开的那张', !!which && which === expectFirst, { got: which, expect: expectFirst });
}

await navigate();
await clearLibToggles();           // 清掉 B4 场景遗留的「全部关闭」开关
await seedRecords(6, 8);           // 经期长度设 8 天 → 今天=经期第7天（55% 档，验证第5+天不再被衰减锁死）
await navigate();
{
  const r = JSON.parse(await armAndCount() || '{}');
  check('B7 经期第7天同样可触发（计数=1，旧版此档叠加后≈4%）', r.count === 1, r);
}

// ===== C 组：运行时 UI =====
await navigate();
{
  // 种历史周期 + 症状（≥3 次周期供趋势图；症状分布在两个周期内供相位分布）
  await evalJs(`(function(){
    var p=function(n){return (n<10?'0':'')+n;};
    function ds(off){var d=new Date();d.setDate(d.getDate()-off);return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());}
    // 三次周期：起点差 28 天与 16 天（都落在 cycleStats 的 15-60 有效口径内，趋势图可渲染）
    window.xyStore('xy-home-v2').set('period-records',JSON.stringify([
      {id:'a',start:ds(44),end:ds(40)},{id:'b',start:ds(16),end:ds(12)},{id:'c',start:ds(0),end:null}
    ]));
    var daily={};
    daily[ds(42)]={symptoms:['cramp','fatigue']};
    daily[ds(41)]={symptoms:['cramp']};
    daily[ds(10)]={symptoms:['cramp','headache']};
    daily[ds(9)]={symptoms:['headache']};
    daily[ds(5)]={symptoms:['cramp']};
    daily[ds(3)]={symptoms:['cramp','backache']};
    window.xyStore('xy-home-v2').set('period-daily',JSON.stringify(daily));
    return 'ok';
  })()`);
}
await navigate();
{
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"period\"]');if(a)a.click();return 1;})()");
  await sleep(900);
  const ui = JSON.parse(await evalJs(`(function(){
    try {
      var card=document.getElementById('period-stats-card');
      if(!card)return JSON.stringify({err:'no-stats-card'});
      var svg=card.querySelector('svg.ps-trend');
      var cap=card.querySelector('.ps-trend-cap');
      var texts=svg?[].slice.call(svg.querySelectorAll('text')).map(function(t){return t.textContent;}):[];
      var bars=card.querySelector('.ps-phase-bars');
      var cs=bars?getComputedStyle(bars):null;
      // 标签槽几何：每个相位行的数字标签必须整部落在本行容器底边之上（不越界到下一行）
      var rows=[].slice.call(card.querySelectorAll('.ps-phase-row'));
      var overlaps=0,laneOk=0;
      rows.forEach(function(row,i){
        var lab=row.querySelector('.ps-phase-bar i');
        var rr=row.getBoundingClientRect();
        if(!lab)return;
        var lr=lab.getBoundingClientRect();
        if(lr.bottom<=rr.bottom+0.5&&lr.top>=rr.top)laneOk++;
        if(i<rows.length-1){
          var nr=rows[i+1].getBoundingClientRect();
          if(lr.bottom>nr.top+0.5)overlaps++;
        }
      });
      // 柱体不越过绘图区底边（容器内容区高=46-14）
      var barOut=0;
      [].slice.call(card.querySelectorAll('.ps-phase-bar')).forEach(function(b){
        var br=b.getBoundingClientRect(),pr=b.parentElement.getBoundingClientRect();
        if(br.bottom>pr.bottom-14+1.5)barOut++;
      });
      return JSON.stringify({
        capText:cap?cap.textContent:'',
        svgTexts:texts,
        barsH:cs?cs.height:'',barsPad:cs?cs.paddingBottom:'',
        rows:rows.length,laneOk:laneOk,overlaps:overlaps,barOut:barOut
      });
    } catch(e){ return JSON.stringify({err:e.message}); }
  })()` ) || '{}');
  check('C1 统计卡渲染（趋势图+相位分布都在）', ui.rows >= 2 && (ui.svgTexts || []).length >= 2, { rows: ui.rows });
  check('C2 均值文字已移出图形区（说明行含「均值」，SVG 内 text 全为数字刻度）',
    /均值/.test(ui.capText || '') && (ui.svgTexts || []).every(t => /^[\d.\-–~]+$/.test(t)), { cap: ui.capText, texts: ui.svgTexts });
  check('C3 相位分布容器 46px 高 + 14px 底部标签槽', ui.barsH === '46px' && ui.barsPad === '14px', { h: ui.barsH, pad: ui.barsPad });
  check('C4 数字标签全部落在各自槽内（laneOk=行数）且零越界压行（overlaps=0）',
    ui.laneOk === ui.rows && ui.overlaps === 0, { laneOk: ui.laneOk, overlaps: ui.overlaps });
  check('C5 柱体全部收在 32px 绘图区内（barOut=0）', ui.barOut === 0, { barOut: ui.barOut });
}

// C6：字卡库【其他互动功能字卡】出现「经期关心」tab，20 张可查看、逐张开关写库
await navigate();
{
  await evalJs("(function(){var li=document.getElementById('li-fun-cards');if(li)li.click();return 1;})()");
  await sleep(600);
  const tab = await evalJs("(function(){var b=document.querySelector('#fc-tabs [data-type=\"period\"]');if(!b)return 'no-tab';b.click();return 'ok';})()");
  await sleep(700);
  // v3.26.x：预设字卡列表改视口虚拟窗口（DOM 只保留视口附近约 24 行），本类 28 行不再
  // 一次全渲染 → 先用分组条筛出「经期关心」单组（21 行必定在窗口内）再断言
  await evalJs(`(async function(){
    var c=[].slice.call(document.querySelectorAll('#fc-groups-bar .cc-g-chip')).find(function(x){return x.textContent==='经期关心';});
    if(c){c.click();await new Promise(function(r){setTimeout(r,400);});}
    return !!c;
  })()`);
  const lib = JSON.parse(await evalJs(`(function(){
    var heads=[].slice.call(document.querySelectorAll('#fc-list .cc-group-header')).map(function(h){return h.textContent;});
    var items=[].slice.call(document.querySelectorAll('#fc-list .cc-item'));
    var first=items[0]?items[0].querySelector('.t'):null;
    var line=first?first.textContent.replace('系统','').trim():'';
    var inp=items[0]?items[0].querySelector('input'):{checked:true};
    inp.checked=false;
    inp.dispatchEvent(new Event('change',{bubbles:true}));
    var stored=localStorage.getItem('xy-home-v2:default:dc-off-period:'+line);
    inp.checked=true;
    inp.dispatchEvent(new Event('change',{bubbles:true}));
    var stored2=localStorage.getItem('xy-home-v2:default:dc-off-period:'+line);
    var all=[].slice.call(document.querySelectorAll('#fc-groups-bar .cc-g-chip')).find(function(x){return x.textContent==='全部';});
    if(all)all.click();
    return JSON.stringify({heads:heads,n:items.length,line:line,offKey:stored,onKey:stored2});
  })()` ) || '{}');
  check('C6 字卡库出现「经期关心」tab 且点击切换生效', tab === 'ok' && /经期关心/.test(JSON.stringify(lib.heads)), { tab, heads: lib.heads });
  check('C7 分组下 20 张预设全部可查看', lib.n === 20, { n: lib.n });
  check('C8 逐张开关写入 dc-off-period 键（关=1/开=0）', lib.offKey === '1' && lib.onKey === '0', { off: lib.offKey, on: lib.onKey });
}

// C9：390px 视口下【其他互动功能字卡】12 个 tab 全部可见（换行铺开，不再横向滑出屏幕）
await navigate();
{
  await evalJs("(function(){var li=document.getElementById('li-fun-cards');if(li)li.click();return 1;})()");
  await sleep(600);
  const tabs = JSON.parse(await evalJs(`(function(){
    var bar=document.getElementById('fc-tabs');
    if(!bar)return JSON.stringify({err:'no-bar'});
    var cs=getComputedStyle(bar);
    var items=[].slice.call(bar.querySelectorAll('.cc-tab'));
    var vw=document.documentElement.clientWidth;
    var out=items.filter(function(t){var r=t.getBoundingClientRect();return r.right>vw+0.5||r.left<-0.5;}).map(function(t){return t.textContent;});
    var ys={};items.forEach(function(t){var r=t.getBoundingClientRect();ys[Math.round(r.top)]=1;});
    return JSON.stringify({n:items.length,wrap:cs.flexWrap,overflowX:cs.overflowX,offscreen:out,rows:Object.keys(ys).length,
      labels:items.map(function(t){return t.textContent;})});
  })()` ) || '{}');
  // v3.16.x：功能触发字卡独立成页（#fc-tabs），功能 tab 全量预置在模板
  // （v3.26.x 补 music 音乐 tab：492f082 起 template/FUNC_KEYS 已含，本表原缺 → C10 误报）
  const want = ['摸鱼','吃饭','经期','喝水','花园','同频','伸手','此间','房间','存钱罐','漂流瓶','互动回应','音乐'];
  check('C9 tab 条换行铺开（flex-wrap=wrap、无溢出）', tabs.wrap === 'wrap' && (tabs.offscreen || []).length === 0 && tabs.overflowX !== 'auto',
    { wrap: tabs.wrap, off: tabs.offscreen });
  check('C10 全部分类 tab 存在且在屏内（功能触发 tab 按用户词汇命名连排，含此间/漂流瓶/音乐，共13个）',
    tabs.n === want.length && (tabs.labels || []).join(',') === want.join(','),
    { n: tabs.n, labels: tabs.labels });
}

// ===== E 组（2026-09-29 作者复报「关心根本没发到聊天里，只显示在经期页里」）=====
// 「发到聊天」有两道闸，而拦人的那一道不住在本模块里：经期页的「梦角关心」开关（careEnabled）×
// 字卡库「其他互动功能字卡」族的 dcf-care（总开关 ×「TA的关心（经期）」概率，合成一个数）。
// 后者能在本模块外把整条乘成 0%，而页内开关照旧显示「已开启」、语料照旧列着＝一条都不发也没人
// 说一声（静默失败）。本批只补「当场说清楚」，不改任何发送判据。
{
  await navigate();
  await seedRecords(2);
  await evalJs("(function(){ try { window.activeStore().set('dcf-care','0'); } catch(e){} var a=document.querySelector('.app[data-app=\"period\"]'); if(a) a.click(); var b=document.getElementById('period-notify-btn'); if(b) b.click(); return 1; })()");
  await sleep(900);
  const tip0 = String(await evalJs("(function(){ var p=document.getElementById('period-notify-pop'); var t=p?p.querySelector('.dp-tip'):null; return t? t.textContent : 'NO-TIP'; })()") || '');
  check('E1 概率被字卡库乘成 0% → 经期页「提醒设置」底部当场写明发不出去＋打开方式（红侧＝整场静默）',
    tip0.indexOf('字卡库') >= 0 && tip0.indexOf('0%') >= 0, tip0.slice(0, 96));
  const sent0 = JSON.parse(await armAndCount() || '{}');
  check('E2 同一状态下确实一条都不发（发送判据本批一字未动，两侧皆绿＝这是既有行为）', sent0.count === 0, sent0);

  await evalJs("(function(){ try { window.activeStore().remove('dcf-care'); } catch(e){} Math.random=function(){return 0.999;}; var p=document.getElementById('period-notify-pop'); if(p) p.remove(); var a=document.querySelector('.app[data-app=\"period\"]'); if(a) a.click(); var b=document.getElementById('period-notify-btn'); if(b) b.click(); return 1; })()");
  await sleep(900);
  const tip1 = String(await evalJs("(function(){ var p=document.getElementById('period-notify-pop'); var t=p?p.querySelector('.dp-tip'):null; return t? t.textContent : 'NO-TIP'; })()") || '');
  check('E3 概率回到大于 0% → 这句自己撤掉（不是常驻恐吓文案）', tip1.indexOf('字卡库') < 0, tip1.slice(0, 72));
  const sent1 = JSON.parse(await armAndCount() || '{}');
  check('E4 概率放开后照发一条（本批没把链路改坏；#1474 起场景带症状时发的是症状关心，计数按 tag 认账）', sent1.count === 1, sent1);

  // 本来就是经期页这个开关关的 → 不该再指去字卡库（指错地方＝第二种谎）
  await evalJs("(function(){ try { window.activeStore().set('dcf-care','0'); } catch(e){} Math.random=function(){return 0.999;}; var st=window.xyStore('xy-home-v2'); var n={}; try{ n=JSON.parse(st.get('period-notify')||'{}'); }catch(e2){} n.careEnabled=false; st.set('period-notify',JSON.stringify(n)); var p=document.getElementById('period-notify-pop'); if(p) p.remove(); var a=document.querySelector('.app[data-app=\"period\"]'); if(a) a.click(); var b=document.getElementById('period-notify-btn'); if(b) b.click(); return 1; })()");
  await sleep(900);
  const tip2 = String(await evalJs("(function(){ var p=document.getElementById('period-notify-pop'); var t=p?p.querySelector('.dp-tip'):null; return t? t.textContent : 'NO-TIP'; })()") || '');
  check('E5 「梦角关心」是这里自己关的 → 不去指字卡库（只在被外面拦住时才指路）', tip2.indexOf('字卡库') < 0, tip2.slice(0, 72));

  // 页内那份语料列表：同一条历史上能存两遍，用户看到的就是「重复很多条」
  const firstLines = await evalJs("(function(){ var l=window.DEFAULT_CARD_DATA.period[0][1]; return JSON.stringify([l[0], l[0], l[1], l[2]]); })()");
  await evalJs(`(function(){ window.xyStore('xy-home-v2').set('period-care-lines', ${JSON.stringify(firstLines)}); return 1; })()`);
  await evalJs("(function(){ var m=document.getElementById('period-care-pop'); if(m) m.remove(); var p=document.getElementById('period-notify-pop'); var b=p&&p.querySelector('.dp-care-mgr'); if(b) b.click(); return 1; })()");
  await sleep(800);
  const rows = JSON.parse(await evalJs("(function(){ var p=document.getElementById('period-care-pop'); if(!p) return '{}'; return JSON.stringify({ n: p.querySelectorAll('.care-row').length, off: p.querySelectorAll('.care-txt').length, empty: !!p.querySelector('.period-empty') }); })()") || '{}');
  check('E6 同一句关心语在页内只列一遍（种 4 条含 1 条重复 → 应见 3 行；红侧＝4 行＝用户所见「重复很多条」）',
    rows.n === 3 && rows.off === 3, Object.assign({ stored: await evalJs("(function(){ var v=window.xyStore('xy-home-v2').get('period-care-lines'); return (typeof v) + ':' + String(v).slice(0,60); })()") }, rows));
  const afterAdd = await evalJs("(function(){ var p=document.getElementById('period-care-pop'); if(!p) return 'no-pop'; var i=p.querySelector('input.dp-care-input'); if(i) i.value='zz 自测新增的一条关心语'; var a=p.querySelector('.dp-add-btn'); if(a) a.click(); return JSON.stringify({ n: p.querySelectorAll('.care-row').length, stored: JSON.parse(window.xyStore('xy-home-v2').get('period-care-lines')||'[]').length }); })()");
  const aa = JSON.parse(afterAdd || '{}');
  check('E7 去重不打断新增：加一条后列表 4 行、写回的清单也是 4 条（没有把重复又写回去）',
    aa.n === 4 && aa.stored === 4, afterAdd);
  await evalJs("(function(){ window.xyStore('xy-home-v2').remove('period-care-lines'); var p=document.getElementById('period-care-pop'); if(p) p.remove(); return 1; })()");

  // F 组：作者明确不要新限制——频率与概率口径必须逐字未动
  const careSrc = readFileSync(join(root, 'src', 'js', 'period.js'), 'utf8');
  check('F1 fired 记账键仍带语境（本批没把「每语境每天一条」折成「每天一条」）',
    careSrc.indexOf("today + '_said_' + ctx") >= 0, careSrc.indexOf("today + '_said_' + ctx") >= 0 ? '在位' : '被改窄');
  check('F1b #1407⑧：通知侧走的是同一枚键（两边各记各的＝同一天两句同义话，正是本批收掉的）',
    careSrc.indexOf("function said(c) { return !!notifyCfg.fired[today + '_said_' + c]; }") >= 0 && careSrc.indexOf("markSaid('inPeriod')") >= 0, '');
  check('F2 经期天数深浅的概率基数（90/70/55）与当日基数 75 一字未动',
    careSrc.indexOf('baseProb = 90') >= 0 && careSrc.indexOf('baseProb = 70') >= 0 && careSrc.indexOf('baseProb = 55') >= 0 && careSrc.indexOf('var baseProb = 75') >= 0, '');
  check('F3 深夜静默（23:00–06:00 不发也不占名额）那道闸未被本批碰过',
    careSrc.indexOf("if (_h >= 23 || _h < 6) return;") >= 0, '');
  const libSrc = readFileSync(join(root, 'src', 'js', 'default-cards.js'), 'utf8');
  const tplSrc = readFileSync(join(root, 'src', 'template.html'), 'utf8');
  check('F4 字卡库说明里那句说反了的指路（「两者都关才真的完全关」）已改，且写明是「与」的关系',
    libSrc.indexOf('两者都关才真的完全关') < 0 && libSrc.indexOf('任一成立就一条都不发') >= 0, '');
  check('F5 使用说明那条镜像同步补上「两道闸是与的关系、被拦时页内会当场写出」',
    tplSrc.indexOf('任一边关掉就一条都不发') >= 0, '');
}

const pass = results.filter(r => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 项通过');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
try { rmSync(tmpSite, { recursive: true, force: true }); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);
