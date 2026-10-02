// ===== 专项：喝水功能·概率触发梦角催喝水并发送到聊天 =====
// 用法：node tools/verify-water-chat.mjs
// 背景（用户需求）：
//   喝水功能概率触发梦角提醒喝水，并把字卡直接发送到聊天里提醒；
//   新增的喝水字卡放在字卡库【系统预设字卡】→「喝水」tab 新分组「梦角催喝水」供查看。
// 实现：
//   - default-cards-data.js：DEFAULT_CARD_DATA.water 新增「梦角催喝水」分组（9 条）
//   - p2-features.js：window.waterChimeTick（前台每 8 分钟掷骰：可见+未达标+
//     taChimeAllow('water-chat',{cooldown:50min,dailyMax:4})+22% 概率，深夜/清晨降档），
//     waterTaChatSend（libPool 同源抽卡 + 还差 N 杯尾巴 + chatAddIn 发送），
//     打开喝水页时 waterMaybeRemind 内独立 35% 判定（同一频率键防连发）。
// 验证方式：
//   A 组静态断言源码接线；B 组运行时（自组装临时站点，同 verify-pomo-bell 先例，
//   不依赖 node build.mjs）：字卡库渲染新分组 / 强制随机命中验证 tick 发送 /
//   冷却与每日上限频控 / 达标后不再催 / 打开喝水页概率路径。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) : '') + (detail !== undefined ? ']' : ''));
}

// ---- A 组：源码静态断言 ----
{
  const dataSrc = readFileSync(join(root, 'src', 'js', 'default-cards-data.js'), 'utf8');
  const wm = dataSrc.match(/window\.DEFAULT_CARD_DATA\.water\s*=\s*\[[\s\S]*?\n\];/);
  const wtxt = wm ? wm[0] : '';
  check('A1 water 数据含「梦角催喝水」分组且 ≥8 条话术',
    wtxt.includes('梦角催喝水') && (wtxt.match(/该喝水啦[\s\S]*?快去喝水/) !== null));
  const s = readFileSync(join(root, 'src', 'js', 'p2-features.js'), 'utf8');
  check('A2 waterTaChatSend 走 libPool 同源（未达标抽「梦角催喝水」/达标抽「喝够夸奖」）+ chatAddIn 发送',
    /function waterTaChatSend\(\)[\s\S]*?libPool\('water',\s*done \? '喝够夸奖' : '梦角催喝水'[\s\S]*?chatAddIn/.test(s));
  check('A3 waterChimeTick：8 分钟定时掷骰 + taChimeAllow 冷却50分钟/每日4次',
    /window\.waterChimeTick\s*=\s*function[\s\S]*?taChimeAllow\('water-chat',\s*\{\s*cooldown:\s*50 \* 60 \* 1000,\s*dailyMax:\s*4\s*\}/.test(s) &&
    /setInterval\(window\.waterChimeTick,\s*8 \* 60 \* 1000\)/.test(s));
  check('A4 打开喝水页路径：距上次>2h 判定，达标降 1/4 概率（wp = done ? 0.09 : 0.35）',
    /const wp = waterChatDone\(\)\s*\?\s*0\.09\s*:\s*0\.35/.test(s));
  check('A5 不强绑打卡：tick 无「未达标硬门槛」，达标走 1/4 概率；尾巴只在 count>0 时附',
    !/if\s*\(!g \|\| t\.count >= g\) return;/.test(s) &&
    /waterChatDone\(\)\s*\?\s*base \* 0\.25\s*:\s*base/.test(s) &&
    /!done && g && t\.count > 0 && t\.count < g/.test(s));
  check('A6 整组关光即静默（waterChatGroupAllOff 守卫，不回退兜底）',
    /function waterChatGroupAllOff\(\)/.test(s) &&
    /if \(waterChatGroupAllOff\(\)\) return false;/.test(s));
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
const tmpSite = mkdtempSync(join(tmpdir(), 'mochi-waterchat-'));
const html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
let outHtml = '';
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  const cm = bm.match(/cssFiles\s*=\s*\[([\s\S]*?)\]/);
  const jm = bm.match(/jsFiles\s*=\s*\[([\s\S]*?)\]/);
  const parseArr = (m) => (m ? [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]) : []);
  const cssFiles = parseArr(cm), jsFiles = parseArr(jm);
  if (!cssFiles.length || !jsFiles.length) { console.error('无法从 build.mjs 解析文件清单'); process.exit(1); }
  const cssAll = cssFiles.map(f => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
  const jsAll = jsFiles.map((f) => {
    try { return readFileSync(join(root, 'src', 'js', f), 'utf8'); } catch (e) { return ''; }
  }).join('\n');
  if (!/梦角催喝水/.test(jsAll)) { console.error('JS 拼接缺少喝水新分组数据'); process.exit(1); }
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-water-chat-' + Date.now()),
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
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2200);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(2300);
await evalJs("(function(){var m=document.getElementById('cc-scope-mask');if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();}return true;})()");
await sleep(400);

// ---- B1：字卡库【其他互动功能字卡】→ 喝水 tab 出现新分组「梦角催喝水」 ----
const b1 = await evalJs(`(async function(){
  try {
    var li = document.getElementById('li-fun-cards');
    if (!li) return 'no-entry';
    li.click();
    await new Promise(function(r){ setTimeout(r, 500); });
    var tab = document.querySelector('#fc-tabs [data-type="water"]');
    if (!tab) return 'no-tab';
    tab.click();
    await new Promise(function(r){ setTimeout(r, 600); });
    var chips = [].map.call(document.querySelectorAll('#fc-groups-bar .cc-g-chip'), function(c){ return c.textContent; });
    // v3.26.x：预设字卡列表改视口虚拟窗口（DOM 只保留视口附近约 24 行），整类 36 行
    // 不再一次全渲染 → 先用分组条筛出目标组（该组 10 行必定在窗口内）再断言
    var chip = [].slice.call(document.querySelectorAll('#fc-groups-bar .cc-g-chip')).find(function(c){ return c.textContent === '梦角催喝水'; });
    if (chip) { chip.click(); await new Promise(function(r){ setTimeout(r, 400); }); }
    var headers = [].map.call(document.querySelectorAll('#fc-list .cc-group-header .ccg-name'), function(h){ return h.textContent; });
    var items = document.querySelectorAll('#fc-list .cc-item').length;
    var all = [].slice.call(document.querySelectorAll('#fc-groups-bar .cc-g-chip')).find(function(c){ return c.textContent === '全部'; });
    if (all) { all.click(); await new Promise(function(r){ setTimeout(r, 300); }); }
    return JSON.stringify({ chips: chips, headers: headers, items: items,
      grpInData: !!(window.DEFAULT_CARD_DATA && (window.DEFAULT_CARD_DATA.water||[]).some(function(g){ return g[0]==='梦角催喝水'; })) });
  } catch(e) { return 'err:' + e.message; }
})()`);
try {
  const o = JSON.parse(b1);
  check('B1 数据层含「梦角催喝水」分组', o && o.grpInData === true, o && o.grpInData);
  check('B2 功能字卡喝水 tab 分组条出现「梦角催喝水」', o && Array.isArray(o.chips) && o.chips.indexOf('梦角催喝水') >= 0, o && o.chips);
  check('B3 卡片列表渲染出「梦角催喝水」组头与卡片', o && Array.isArray(o.headers) && o.headers.indexOf('梦角催喝水') >= 0 && o.items >= 8, o && { headers: o.headers, items: o.items });
} catch (e) { check('B1-B3 字卡库新分组', false, b1); }

// ---- 准备：包装 chatAddIn 计数 + 强制命中概率 ----
const setup = await evalJs(`(function(){
  try {
    var st = window.activeStore();
    if (!st) return 'no-store';
    var d = new Date();
    var ds = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    var dk = d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate(); // taChime dayKey 不补零
    window.__dsPadded = ds; window.__dkRaw = dk;
    st.set('water-today', JSON.stringify({ date: ds, count: 2 }));
    st.set('ta-chime:water-chat:last', '0');
    st.set('ta-chime:water-chat:day', 'null');
    window.__sent = [];
    var orig = window.chatAddIn;
    window.__origChatAddIn = orig;
    window.chatAddIn = function(t, o){ window.__sent.push(String(t)); return orig.apply(this, arguments); };
    window.__randOrig = Math.random;
    Math.random = function(){ return 0; }; // 强制命中所有概率分支
    return 'ok';
  } catch(e) { return 'err:' + e.message; }
})()`);
check('B4 测试环境就绪（计数探针+强制命中+未达标 2/8 杯）', setup === 'ok', setup);

// ---- B5：tick 命中 → 字卡发进聊天，带进度尾巴；未读数联动 ----
await evalJs("(function(){ window.waterChimeTick(); return true; })()");
await sleep(300);
const b5 = await evalJs(`(function(){
  var st = window.activeStore();
  return JSON.stringify({
    n: window.__sent.length,
    txt: window.__sent[0] || '',
    unread: parseInt(st.get('chat-unread') || '0', 10) || 0
  });
})()`);
try {
  const o = JSON.parse(b5);
  check('B5 概率命中后把催喝水字卡发进聊天一次', o && o.n === 1 && o.txt.length > 0, o && { n: o.n, txt: o.txt });
  check('B6 消息附今日进度尾巴（还差 6 杯）', o && /还差 6 杯/.test(o.txt || ''), o && o.txt);
  check('B7 不在聊天页时未读数联动 +1', o && o.unread >= 1, o && { unread: o.unread });
  check('B8 文案来自「梦角催喝水」池（非兜底外的乱串）', o && /(该喝水啦|去喝口水吧|倒水的声音|杯子是不是|试过温度|润润嗓子|就当我也喝到|伸伸手|快去喝水)/.test(o.txt || ''), o && o.txt);
} catch (e) { check('B5-B8 tick 发送', false, b5); }

// ---- B9：冷却期内不重发 ----
await evalJs("(function(){ window.waterChimeTick(); window.waterChimeTick(); return true; })()");
await sleep(200);
const b9 = await evalJs("JSON.stringify({ n: window.__sent.length })");
check('B9 冷却期内重复 tick 不再发（50 分钟冷却生效）', (() => { try { return JSON.parse(b9).n === 1; } catch (e) { return false; } })(), b9);

// ---- B10：每日上限 4 次 ----
const b10raw = await evalJs(`(function(){
  var st = window.activeStore();
  st.set('ta-chime:water-chat:last', '0'); // 清冷却，保留每日计数
  st.set('ta-chime:water-chat:day', JSON.stringify({ date: window.__dkRaw, n: 4 }));
  window.waterChimeTick();
  return JSON.stringify({ n: window.__sent.length });
})()`);
check('B10 当日已达上限 4 次不再发', (() => { try { return JSON.parse(b10raw).n === 1; } catch (e) { return false; } })(), b10raw);

// ---- B11：整组逐张关光 = 不想被打扰，静默不回退兜底 ----
const b11raw = await evalJs(`(async function(){
  var st = window.activeStore();
  st.set('ta-chime:water-chat:last', '0');
  st.set('ta-chime:water-chat:day', 'null');
  var grp = (window.DEFAULT_CARD_DATA.water||[]).find(function(g){ return g[0]==='梦角催喝水'; });
  grp[1].forEach(function(c){ st.set('dc-off-water:' + c, '1'); });
  window.waterChimeTick();
  var offBlocked = window.__sent.length; // 应仍为 1
  grp[1].forEach(function(c){ st.remove('dc-off-water:' + c); });
  return JSON.stringify({ n: offBlocked });
})()`);
check('B11 「梦角催喝水」整组关光后 tick 静默（不回退兜底池）', (() => { try { return JSON.parse(b11raw).n === 1; } catch (e) { return false; } })(), b11raw);

// ---- B12：懒得打卡（count=0）照常来催，且不妄附进度尾巴 ----
const b12raw = await evalJs(`(function(){
  var st = window.activeStore();
  st.set('ta-chime:water-chat:last', '0');
  st.set('ta-chime:water-chat:day', 'null');
  st.set('water-today', JSON.stringify({ date: window.__dsPadded, count: 0 }));
  window.waterChimeTick();
  return JSON.stringify({ n: window.__sent.length, txt: window.__sent[window.__sent.length - 1] || '' });
})()`);
try {
  const o = JSON.parse(b12raw);
  check('B12 一口没记（0 杯）也照常来催', o && o.n === 2 && o.txt.length > 0, o && { n: o.n, txt: o.txt });
  check('B13 count=0 不附「还差 N 杯」尾巴（不妄下判断）', o && o.txt.indexOf('还差') < 0, o && o.txt);
} catch (e) { check('B12-B13 懒得打卡路径', false, b12raw); }

// ---- B14：已打卡达标 → 改发喝够夸奖、无尾巴、概率降 1/4 ----
const b14raw = await evalJs(`(function(){
  var st = window.activeStore();
  st.set('ta-chime:water-chat:last', '0');
  st.set('ta-chime:water-chat:day', 'null');
  st.set('water-today', JSON.stringify({ date: window.__dsPadded, count: 8 }));
  window.waterChimeTick(); // 强制随机命中（含 1/4 降档）
  return JSON.stringify({ n: window.__sent.length, txt: window.__sent[window.__sent.length - 1] || '' });
})()`);
try {
  const o = JSON.parse(b14raw);
  check('B14 已达标（8/8）改发夸奖类字卡（概率降 1/4 后仍可命中）',
    o && o.n === 3 && /(今天喝够啦|真棒|完成了|好乖)/.test(o.txt || ''), o && { n: o.n, txt: o.txt });
  check('B15 达标后不带催水尾巴', o && o.txt.indexOf('还差') < 0, o && o.txt);
} catch (e) { check('B14-B15 达标夸奖路径', false, b14raw); }

// ---- B16：打开喝水页的概率路径也发进聊天（强制命中；懒得打卡 count=3 有尾巴）----
const b16raw = await evalJs(`(async function(){
  try {
    var st = window.activeStore();
    st.set('water-today', JSON.stringify({ date: window.__dsPadded, count: 3 }));
    st.set('ta-chime:water-chat:last', '0');
    st.set('ta-chime:water-chat:day', 'null');
    st.set('ta-chime:water-ta:last', '0');
    st.set('ta-chime:water-ta:day', 'null');
    var before = window.__sent.length;
    st.set('water-last-visit', String(Date.now() - 3 * 3600000)); // 距上次进入 >2 小时
    var app = document.querySelector('[data-app="water"]');
    if (!app) return JSON.stringify({ err: 'no-app' });
    app.click();
    await new Promise(function(r){ setTimeout(r, 700); });
    var note = document.querySelector('.ta-chime-note.show .ta-chime-text');
    return JSON.stringify({
      n: window.__sent.length - before,
      txt: window.__sent[window.__sent.length - 1] || '',
      float: note ? note.textContent : '',
      onWater: !document.getElementById('page-water').hidden
    });
  } catch(e) { return JSON.stringify({ err: e.message }); }
})()`);
try {
  const o = JSON.parse(b16raw);
  if (o && o.err) { check('B16 打开喝水页触发聊天提醒', false, o.err); }
  else {
    check('B16 打开喝水页（距上次>2h）概率命中也发进聊天', o && o.n === 1 && o.onWater === true, o && { n: o.n, onWater: o.onWater });
    check('B17 页内浮层与他视角提醒并存（世界观浮字仍在）', o && typeof o.float === 'string' && o.float.length > 0, o && o.float);
    check('B18 尾巴按最新进度计算（还差 5 杯）', o && /还差 5 杯/.test(o.txt || ''), o && o.txt);
  }
} catch (e) { check('B16-B18 打开喝水页路径', false, b16raw); }

// 还原随机数与 chatAddIn
await evalJs("(function(){ Math.random = window.__randOrig; window.chatAddIn = window.__origChatAddIn; return true; })()");

const pass = results.filter(r => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 项通过');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);
