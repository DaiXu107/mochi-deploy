// ===== 回归脚本（#1483）：字卡库【公用/专属】导出/导入数据必须覆盖「梦角自由造句」（及 13 功能分类） =====
// 症状（作者原话 2026-09-30）：「字卡库的【公用字卡】和【专属字卡】为什么导入数据和导出数据
//   不包括【梦角自由造句】这个tag里的字卡 帮我全部检查修复」。
// 根因（两处不对称，零机型分支）：
//   ① 导出弹窗 EXPORT_CATS（chatcard.js）列了 20 个分类却没有 mjfree——#353 起 mjfree 卡就存
//      公用/专属两库（管理页有 tab、dream-free 自动入库），弹窗没这栏＝造句卡永远选不中、导不出；
//   ② 导入解析面 applyImportData 本应用格式分支只认 7 聊天分类——v3.32.x 起导出弹窗就含
//      13 功能分类、#1483 起含 mjfree，导入侧却把它们静默丢弃（混导时 toast 只数聊天卡，
//      纯功能/造句文件直接误报「文件里没有可导入的字卡」）。
// 断言面：
//   S1~S4 产物源码级四锚（导出栏/导入解析面/文案表/备份提取识别面）——纯 HEAD 必红＝判别面；
//   B0/B2b 聊天分类导出与功能分类导出（存量契约，两侧同绿＝夹具诚实、没修过头）；
//   B1/B6 公用/专属两入口导出弹窗出现「梦角自由造句 N」chip（纯 HEAD 必红）；
//   B2    点导出后落文件的 json 里 mjfree 深度等于种子的组（纯 HEAD 必红＝症状本体）；
//   B3    粘贴导入后权威键里 mjfree/功能分类落库、聊天分类照旧（纯 HEAD 必红）；
//   B4    造句 tab 上「导入到「梦角自由造句」」档名（纯 HEAD 退化成「当前分类」必红）；
//   B5    全量备份提取识别面：库里只有功能/造句卡的备份也能提取导入（纯 HEAD 必红）；
//   Z1    零 window 报错。
// 用法：node tools/verify-1483-cc-io-mjfree.mjs（MOCHI_ROOT=目录 可指向隔离副本）
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
// verify-suite:timeout=120000
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，设 CHROME_PATH'); process.exit(1); }

// ---- S 组：产物源码级四锚（判别面：纯 HEAD 全红） ----
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' —— ' + String(detail).slice(0, 240) : '')); }
}
{
  let cc = '';
  try { cc = readFileSync(join(root, 'js', 'chatcard.js'), 'utf8'); } catch (e) {}
  check('S1 导出弹窗 EXPORT_CATS 含「梦角自由造句」栏', cc.includes("['mjfree', '梦角自由造句']"), 'js/chatcard.js 无该分类行');
  check('S2 导入解析面走 CC_ALL_TYPES 全分类', cc.includes('CC_ALL_TYPES.forEach(k => {'), 'applyImportData 本应用格式分支仍只认 7 聊天分类');
  check('S3 导入文案表认 mjfree', cc.includes("mjfree: '梦角自由造句' };"), 'CAT_NAMES 无 mjfree');
  check('S4 全量备份提取识别面扩全分类', cc.includes('CC_ALL_TYPES.some(t => Array.isArray(parsed[t]) && parsed[t].length)'), '备份提取仍按 7 聊天分类识别');
}

// ---- 行为夹具 ----
const PUB_KEY_RAW = JSON.stringify({
  text: [['种子组A', ['公用文字卡1']]],
  fish: [['摸鱼种子组', ['摸鱼卡1', '摸鱼卡2']]],
  mjfree: [['造句种子组', ['造句卡甲', '造句卡乙']]]
});
const OWN_KEY_RAW = JSON.stringify({
  text: [['专属种子组', ['专属文字卡1']]],
  mjfree: [['专属造句组', ['专属造句卡1', '专属造句卡2']]]
});
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9930 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1483-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  throw new Error('无法连接 CDP');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const clearGates = () => ev("(function(){var ids=['qa-mask','applock-mask','modal-mask','tc-mask','call-mask'];ids.forEach(function(id){var e=document.getElementById(id);if(e&&!e.hidden)e.hidden=true;});return true;})()");
// 占位弹窗（备份提醒等）点掉——openModal 不叠开，不点掉会吃掉后续弹窗
async function drainModals() {
  for (let i = 0; i < 4; i++) {
    const st = await ev("(function(){var m=document.getElementById('modal-mask');if(!m||m.hidden)return 'closed';var bs=[].slice.call(document.querySelectorAll('#modal-mask button'));for(var i=0;i<bs.length;i++){if(/稍后|以后|取消|知道了|关闭/.test(bs[i].textContent||'')){bs[i].click();return 'clicked';}}var ok=document.getElementById('modal-ok');if(ok){ok.click();return 'clicked:ok';}return 'stuck';})()");
    await sleep(300);
    if (st === 'closed') break;
  }
  await clearGates();
}

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
await cdp('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true });

// 第一遍：裸启动 → 种双库（LS＋IDB 同写）→ reload 让应用按种子库起
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
const seeded = await ev(`(async function(){
  try {
    localStorage.setItem('xy-home-v2:cc-groups-public', ${JSON.stringify(PUB_KEY_RAW)});
    localStorage.setItem('xy-home-v2:default:cc-groups', ${JSON.stringify(OWN_KEY_RAW)});
    // v3.11.x 一次性拆分迁移的标记——不种它，boot 会把 default:cc-groups 当「拆分前存量」
    // 搬进公用键并清掉源键（幂等标记 cc-scope-migrated），两把种子全被改写＝夹具全假
    localStorage.setItem('xy-home-v2:cc-scope-migrated', '1');
    if (window.idbSet) {
      await window.idbSet('xy-home-v2:cc-groups-public', ${JSON.stringify(PUB_KEY_RAW)});
      await window.idbSet('xy-home-v2:default:cc-groups', ${JSON.stringify(OWN_KEY_RAW)});
      await window.idbSet('xy-home-v2:cc-scope-migrated', '1');
    }
    return true;
  } catch (e) { return 'err:' + (e && e.message); }
})()`);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(700);
await ev("(function(){var s=document.getElementById('splash');if(s&&s.parentNode)s.parentNode.removeChild(s);return true;})()");
await sleep(500);
await clearGates(); await drainModals();
// 种库自证：应用侧读到的公用库确实带造句组（否则后面的导出红没有意义）
{
  const seen = await ev(`(function(){
    try {
      var raw = window.xyStore('xy-home-v2').get('cc-groups-public');
      var g = JSON.parse(raw || 'null') || {};
      var cards = function (t) { var n = 0; (g[t] || []).forEach(function (x) { n += (x[1] || []).length; }); return n; };
      var names = function (t) { return (g[t] || []).map(function (x) { return x[0]; }); };
      return JSON.stringify({ mjCards: cards('mjfree'), fishCards: cards('fish'), textCards: cards('text'), mjNames: names('mjfree'), fishNames: names('fish'), textNames: names('text'), seeded: ${JSON.stringify(seeded)} });
    } catch (e) { return JSON.stringify({ err: String(e && e.message) }); }
  })()`);
  const j = JSON.parse(seen || '{}');
  check('B0a 种库自证：公用键＝公用种子本体（造句 2/摸鱼 2/文字 1 张、组名逐个对上＝没被启动迁移搬库）',
    j.mjCards === 2 && j.fishCards === 2 && j.textCards === 1 && j.mjNames[0] === '造句种子组' && j.fishNames[0] === '摸鱼种子组' && j.textNames[0] === '种子组A', seen);
}

// 打开【公用字卡】管理页
await ev("(function(){var li=document.getElementById('li-custom-cards-public');if(li)li.click();return !!li;})()");
await sleep(1800);
await clearGates(); await drainModals();

// 导出弹窗 chip 读取器
const CHIP = `(function(){
  var m = document.getElementById('cc-export-mask');
  if (!m || m.hidden) return JSON.stringify({ noDialog: true });
  var chips = [].slice.call(m.querySelectorAll('.cc-g-chip')).map(function(b){return (b.textContent||'').trim();});
  return JSON.stringify({ chips: chips });
})()`;

console.log('--- B1 公用字卡导出弹窗：出现「梦角自由造句 2」chip ---');
{
  await clearGates();
  await ev("(function(){var b=document.getElementById('cc-export');if(b)b.click();return true;})()");
  await sleep(900);
  await clearGates();
  const j = JSON.parse(await ev(CHIP) || '{}');
  const mj = (j.chips || []).find(function (c) { return c.indexOf('梦角自由造句') === 0; });
  check('B1 导出弹窗有「梦角自由造句」分类 chip', !!mj, JSON.stringify(j).slice(0, 200));
  check('B1b chip 计数＝种子的 2 张', mj === '梦角自由造句 2', 'chip=' + mj);
  check('B2b 存量契约：功能分类「摸鱼」chip 照旧在（v3.32.x 起就有，两侧同绿）', (j.chips || []).some(function (c) { return c.indexOf('摸鱼') === 0; }), JSON.stringify(j.chips));
}

console.log('--- B2 真点导出：落文件的 json 里 mjfree 深度等于种子 ---');
{
  await ev("(function(){window.__cap=null;window.__capName=null;window.mochiExportFile=function(json,fname){window.__cap=json;window.__capName=fname;return Promise.resolve('saved');};return true;})()");
  await clearGates();
  await ev("(function(){var b=document.getElementById('ce-do');if(b)b.click();return true;})()");
  await sleep(1200);
  // ccExportOffer 的弹窗是 pillSubmit：点「导出文件（推荐）」胶囊即提交
  await clearGates();
  const clicked = await ev(`(function(){
    var pills = [].slice.call(document.querySelectorAll('#modal-pills .pill'));
    var t = pills.filter(function(p){return /导出文件/.test(p.textContent||'');})[0];
    if (t) { t.click(); return 'pill:' + (t.textContent||'').trim(); }
    var ok = document.getElementById('modal-ok'); if (ok) { ok.click(); return 'ok'; }
    return 'none';
  })()`);
  await sleep(1000);
  const cap = await ev("(function(){return JSON.stringify({has:!!window.__cap,name:window.__capName||null,click:window.__lastClick||null});})()");
  let out = null, parsed = null;
  try { parsed = JSON.parse(await ev('window.__cap') || 'null'); } catch (e) {}
  out = parsed;
  const mj = out && Array.isArray(out.mjfree) ? out.mjfree : null;
  check('B2 导出文件捕获成功', !!out, 'click=' + clicked + ' cap=' + cap);
  check('B2b 聊天分类照旧导出（种子组A 在 out.text，两侧同绿）', !!(out && out.text && out.text.some(function (g) { return g[0] === '种子组A'; })), JSON.stringify(out && out.text));
  check('B2c 功能分类照旧导出（摸鱼种子组 在 out.fish，两侧同绿）', !!(out && out.fish && out.fish.some(function (g) { return g[0] === '摸鱼种子组'; })), JSON.stringify(out && out.fish));
  check('B2d out.mjfree 深度等于种子组「造句种子组」2 张', JSON.stringify(mj) === JSON.stringify([['造句种子组', ['造句卡甲', '造句卡乙']]]), 'out.mjfree=' + JSON.stringify(mj));
  await ev("(function(){var c=document.getElementById('modal-cancel');if(c)c.click();return true;})()");
  await sleep(300); await clearGates();
}

console.log('--- B3 粘贴导入：功能/造句分类落库、聊天分类照旧 ---');
{
  const payload = JSON.stringify({
    text: [['聊天导入组', ['导入的聊天卡1']]],
    fish: [['功能导入组', ['导入的摸鱼卡1', '导入的摸鱼卡2']]],
    mjfree: [['造句导入组', ['导入的造句卡1', '导入的造句卡2', '导入的造句卡3']]]
  });
  await drainModals();
  await clearGates();
  await ev("(function(){var b=document.getElementById('cc-import-data');if(b)b.click();return true;})()");
  await sleep(800); await clearGates();
  // 选「粘贴文本导入」档 → 确定 → 第二个弹窗（textarea）→ 填内容 → 确定
  await ev(`(function(){
    var pills = [].slice.call(document.querySelectorAll('#modal-pills .pill'));
    var t = pills.filter(function(p){return /粘贴文本导入/.test(p.textContent||'');})[0];
    if (t) t.click();
    return JSON.stringify({ found: !!t });
  })()`);
  await sleep(200);
  await ev("(function(){var ok=document.getElementById('modal-ok');if(ok)ok.click();return true;})()");
  await sleep(800); await clearGates();
  const filled = await ev(`(function(){
    var ta = document.getElementById('modal-textarea');
    if (!ta) return 'no-textarea';
    ta.value = ${JSON.stringify(payload)};
    return 'filled';
  })()`);
  await ev("(function(){var ok=document.getElementById('modal-ok');if(ok)ok.click();return true;})()");
  // 落盘收敛等待：轮询权威键直到三组齐/超时
  let got = null;
  for (let i = 0; i < 25; i++) {
    await sleep(400);
    got = await ev(`(function(){
      try {
        var g = JSON.parse(window.xyStore('xy-home-v2').get('cc-groups-public') || '{}');
        var find = function(t, n){ var a=(g[t]||[]).filter(function(x){return x[0]===n;})[0]; return a ? a[1].length : 0; };
        return JSON.stringify({ textG: find('text','聊天导入组'), fishG: find('fish','功能导入组'), mjG: find('mjfree','造句导入组') });
      } catch (e) { return JSON.stringify({ err: String(e && e.message) }); }
    })()`);
    const j = JSON.parse(got || '{}');
    if (j.textG && j.fishG && j.mjG) break;
  }
  const j = JSON.parse(got || '{}');
  check('B3 聊天分类照旧导入（聊天导入组 1 张，两侧同绿）', j.textG === 1, got);
  check('B3b 功能分类不再被丢（功能导入组 2 张——纯 HEAD＝0）', j.fishG === 2, got);
  check('B3c 造句分类不再被丢（造句导入组 3 张——纯 HEAD＝0，症状本体）', j.mjG === 3, got);
}

console.log('--- B4 造句 tab 上「导入到当前分类」档名 ---');
{
  await drainModals();
  await clearGates();
  await ev("(function(){var t=document.querySelector('.cc-tab[data-type=mjfree]');if(t)t.click();return true;})()");
  await sleep(900); await clearGates();
  await ev("(function(){var b=document.getElementById('cc-import-data');if(b)b.click();return true;})()");
  await sleep(800); await clearGates();
  const labels = await ev(`(function(){
    return JSON.stringify([].slice.call(document.querySelectorAll('#modal-pills .pill')).map(function(p){return (p.textContent||'').trim();}));
  })()`);
  const arr = JSON.parse(labels || '[]');
  const cur = arr.find(function (x) { return x.indexOf('导入到「') === 0; });
  check('B4 档名＝导入到「梦角自由造句」（纯 HEAD 退化成「当前分类」）', cur === '导入到「梦角自由造句」', labels);
  await ev("(function(){var c=document.getElementById('modal-cancel');if(c)c.click();return true;})()");
  await sleep(300); await clearGates();
}

console.log('--- B5 全量备份提取：只有功能/造句卡的字卡库也认 ---');
{
  const backup = JSON.stringify({
    app: 'mochi-zika', time: Date.now(),
    ls: { 'xy-home-v2:cc-groups-public': JSON.stringify({ text: [], fish: [['备份提取鱼组', ['备份鱼卡1']]], mjfree: [['备份提取句组', ['备份句1', '备份句2']]] }) },
    idb: {}
  });
  await drainModals();
  await clearGates();
  await ev("(function(){var b=document.getElementById('cc-import-data');if(b)b.click();return true;})()");
  await sleep(800); await clearGates();
  await ev(`(function(){
    var pills = [].slice.call(document.querySelectorAll('#modal-pills .pill'));
    var t = pills.filter(function(p){return /粘贴文本导入/.test(p.textContent||'');})[0];
    if (t) t.click();
    return true;
  })()`);
  await sleep(200);
  await ev("(function(){var ok=document.getElementById('modal-ok');if(ok)ok.click();return true;})()");
  await sleep(800); await clearGates();
  await ev(`(function(){
    var ta = document.getElementById('modal-textarea');
    if (ta) ta.value = ${JSON.stringify(backup)};
    return true;
  })()`);
  await ev("(function(){var ok=document.getElementById('modal-ok');if(ok)ok.click();return true;})()");
  let got = null;
  for (let i = 0; i < 25; i++) {
    await sleep(400);
    got = await ev(`(function(){
      try {
        var g = JSON.parse(window.xyStore('xy-home-v2').get('cc-groups-public') || '{}');
        var find = function(t, n){ var a=(g[t]||[]).filter(function(x){return x[0]===n;})[0]; return a ? a[1].length : 0; };
        return JSON.stringify({ fishB: find('fish','备份提取鱼组'), mjB: find('mjfree','备份提取句组') });
      } catch (e) { return JSON.stringify({ err: String(e && e.message) }); }
    })()`);
    const j = JSON.parse(got || '{}');
    if (j.fishB && j.mjB) break;
  }
  const j = JSON.parse(got || '{}');
  check('B5 备份提取：功能组落库（备份提取鱼组 1 张——纯 HEAD 整份误报「没有可导入的字卡」）', j.fishB === 1, got);
  check('B5b 备份提取：造句组落库（备份提取句组 2 张）', j.mjB === 2, got);
}

console.log('--- B6 专属字卡入口同样覆盖 ---');
{
  await drainModals();
  await clearGates();
  await ev("(function(){var b=document.getElementById('cc-back');if(b)b.click();return true;})()");
  await sleep(900); await clearGates(); await drainModals();
  await ev("(function(){var li=document.getElementById('li-custom-cards');if(li)li.click();return !!li;})()");
  await sleep(1800); await clearGates(); await drainModals();
  await clearGates();
  await ev("(function(){var b=document.getElementById('cc-export');if(b)b.click();return true;})()");
  await sleep(900); await clearGates();
  const j = JSON.parse(await ev(CHIP) || '{}');
  const mj = (j.chips || []).find(function (c) { return c.indexOf('梦角自由造句') === 0; });
  check('B6 专属字卡导出弹窗有「梦角自由造句 2」chip', mj === '梦角自由造句 2', JSON.stringify(j).slice(0, 200));
  await ev("(function(){var b=document.getElementById('ce-close');if(b)b.click();return true;})()");
}

console.log('--- Z 零异常 ---');
{
  const errs = await ev('(window.__jsErrors || []).slice(0, 6)');
  check('Z1 零 window 报错', !errs || errs.length === 0, errs && errs.length ? JSON.stringify(errs).slice(0, 240) : '');
}

console.log('\n===== ' + pass + ' 过 / ' + fail + ' 挂（#1483 字卡库导出/导入覆盖梦角自由造句，产物：' + root + '）=====');
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);
