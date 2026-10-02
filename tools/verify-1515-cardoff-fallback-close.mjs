// #1515 行为回归尺：「禁止使用的字卡」#1498 残留消费方收口——过闸后为空时**不得**回落未过闸兜底。
// 用户复报（iPhone 15 Pro Max / Safari，明说其他设备型号也有）：「禁止使用的字卡，联系人还是能使用」；
// 其诊断单 ts=18:35 构建（早于 #1498 落库 19:36/上线 21:26），主症状随更新即愈；本尺钉的是
// #1498 刻意未动清单里同族的「过闸后为空 ⇒ 回落内置兜底」残留（全部机型无关，纯判据缺失）：
//   ① p2-features libPool/fishPool/tpPool：「arr.length ? arr : fallback」把刚关掉的句子原样捡回
//     （DEF_* 兜底与库内分组同源同文＝逐张关光/整组停用等于没关，#1498 在 room/garden/music 修掉的同族）；
//   ② 7 个游戏/结算回应点「pool[random] || fb[0]」/字面兜底（拍卖×3/四子棋/连线/消消乐/五子棋/
//     记忆翻牌/chat 单局邀请）＝整组停用后每局固定发未入库兜底句（#1315 在 ta-ask 修过的「开关成装饰」同型）；
//   ③ fishing pickPool/giftNoteFor 裸兜底回落；
//   ④ 各消费点空池盲索引吐 undefined（TA：undefined / 「undefined（还差N杯）」/ 点击崩）。
// 断言：
//   S1~S18 源码/产物锚（两池兜底闸、tpPool 尾闸、各消费点空池守卫、7 游戏点静默化）；
//   S19 旧病句清零（|| fb[0] / 裸兜底回落行在这些文件里不得再出现）；
//   B1 全关 ⇒ __p2LibPoolProbe 空池（不再回落兜底）；B2 只关一张 ⇒ 只掉那张（零误伤）；
//   B3 未关 ⇒ 池照旧非空；B4 全关 ⇒ __p2FishPoolProbe 空池；
//   B5 #1498 的 gateCardFallback 出口仍工作（邻批回归守卫）；
//   Z 全程零 JS 异常。
// 用法：node tools/verify-1515-cardoff-fallback-close.mjs [被测根目录]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
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

// ---- S 组：源码/产物锚（外置 js/<file> 与内联 index.html 两种落点都认）----
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const srcOf = (f) => { try { return readFileSync(join(root, 'js', f), 'utf8'); } catch (e) { return ''; } };
const code = (f) => srcOf(f) + indexHtml;
console.log('S 源码/产物锚');
const p2 = code('p2-features.js');
ok('S1 p2 libPool 兜底过闸（#1515a）', p2.includes('return arr.length ? arr.slice() : (window.gateCardFallback ? window.gateCardFallback(cat, fallback) : (fallback || []).slice());'));
ok('S2 p2 fishPool 兜底过闸（#1515b）', p2.includes("return arr.length ? arr : (window.gateCardFallback ? window.gateCardFallback('fish', fallback) : fallback.slice());"));
ok('S3 p2 tpPool 尾行兜底过闸（#1515c）', p2.includes("return pool.length ? pool : (window.gateCardFallback ? window.gateCardFallback('sync', DEF_STATUS) : DEF_STATUS.slice());"));
ok('S4 p2 聊天催水空池不发（#1515d）', p2.includes('if (!m) return false; // #1515 全关＝不发'));
ok('S5 p2 存钱罐取款关心空池不追问（#1515e）', p2.includes("if (q) { var care = libPool('piggy', '取款关心', PIGGY_CARE); if (care.length) { var careTxt = 'TA：' + care["));
ok('S6 p2 摸鱼浮字空池不烧冷却（#1515f）', p2.includes('if (!note) { lastTa = cur; return; } // #1515 全关＝不浮字不吃冷却'));
ok('S7 p2 存钱罐存/取回应空池不出声', p2.includes('const _in = piggyInPool(); if (_in.length) piggyShowMsg(piggyPick(_in));') && p2.includes("const _out = libPool('piggy', '取款回应', DEF_PIGGY_OUT); if (_out.length) piggyShowMsg(piggyPick(_out));"));
ok('S8 p2 塞硬币彩蛋空池静默', p2.includes('if (!note) return; // #1515 全关＝彩蛋静默'));
ok('S9 p2 同频状态/敲一敲/没接住空池守卫', p2.includes('if (el && a.length) el.textContent') && p2.includes('if (r && hint) hint.textContent') && p2.includes('if (hint && miss.length) hint.textContent'));
ok('S10 p2 伸手触感/被动碰空池守卫', (p2.match(/txt != null/g) || []).length >= 3);
ok('S11 p2 喝水夸奖/鼓励/提醒/页内空池守卫', p2.includes('if (p.length) waterShowMsg(p[') && p2.includes('if (e.length) waterShowMsg(e[') && p2.includes('if (msgs.length) waterShowMsg(msgs[') && p2.includes('praise.length ?'));
ok('S12 p2 水滴 TA 提醒空池不崩', p2.includes('if (!taFmt.length || !m) return; // #1515 全关＝不出声'));
ok('S13 拍卖三处回应空池静默', ["// #1515 整组停用＝静默（TA 抱走）", "// #1515 整组停用＝静默（流拍）", "// #1515 整组停用＝静默（被拍走）"].every(t => code('auction.js').includes(t)));
ok('S14 四子棋回应空池静默', code('connect-four.js').includes("// #1515 整组停用＝静默（四子棋）"));
ok('S15 连线回应空池静默', code('linkup.js').includes("// #1515 整组停用＝静默（连线）"));
ok('S16 消消乐回应空池静默', code('match3.js').includes("// #1515 整组停用＝静默（消消乐）"));
ok('S17 五子棋回应空池静默', code('gomoku.js').includes("// #1515 整组停用＝静默（五子棋）"));
ok('S18 记忆翻牌回应空池静默', code('memory-game.js').includes("// #1515 整组停用＝静默（记忆翻牌）"));
ok('S19 单局邀请结算空池不落消息', code('chat.js').includes("if (say) addRec({ side: 'in', text: say, nightAllow: true, rateAllow: true });"));
ok('S20 钓鱼 pickPool 兜底过闸＋寄语空则不发言', code('fishing.js').includes("return window.gateCardFallback ? window.gateCardFallback('interact', fb) : fb; }") && code('fishing.js').includes("return pool && pool.length ? pick(pool) : ''; // #1515 全关＝无寄语") && (code('fishing.js').match(/if \(note\) sendTaLine/g) || []).length >= 1);
console.log('S19 旧病句清零');
const au = code('auction.js'), c4 = code('connect-four.js'), lk = code('linkup.js'), m3 = code('match3.js'), gk = code('gomoku.js'), mg = code('memory-game.js'), fs = code('fishing.js');
ok('S21 「|| fb[0]」残留清零（7 文件）', ![au, c4, lk, m3, gk, mg, fs].some(c => c.includes('|| fb[0]')));
ok('S22 p2 裸兜底回落行清零', !p2.includes('return arr.length ? arr.slice() : (fallback || []).slice();') && !p2.includes('return pool.length ? pool : DEF_STATUS.slice();') && !p2.includes("return arr.length ? arr : fallback.slice();"));
ok('S23 字面兜底句残留清零', !code('chat.js').includes(": '再来一局？';") && !mg.includes(": '一起找完了。';") && !fs.includes(': pick(builtin);'));

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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9560 + Math.floor(Math.random() * 20));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1513-' + Date.now()),
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
// 二级锁（#319）必须在文档脚本之前解锁，否则取池口一律空池＝断言假绿
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "(function(){try{localStorage.setItem('xy-home-v2:cardlock-state','open');localStorage.setItem('xy-home-v2:cardlock-pwver','2');}catch(e){}})()" });
let jsErr = 0;
ws.addEventListener('message', (ev) => {
  try { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') jsErr++; } catch (e) {}
});

console.log('B 行为断言（423×853 无头）');
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 50; i++) { if ((await evalJs('return !!window.__mochiDataReady')) === true) break; await sleep(300); }

// 夹具：不存在的分组名＋自带给 fallback ⇒ getLibPool 必走 fallback 腿，判据与库内数据无关（确定性）
// RED 对照说明：纯 #1498 tip（本批改动前）——
//   B1/B4 读数 = ['甲','乙'] 整串（裸兜底原样回落＝症状本尊）或 noProbe（探针是本批新增）；
//   S1~S23 大面积失锚。
const F='不存在的组_1513', FB="['甲','乙']";
const b1 = await evalJs(`try { window.__idcoOrig = window.isDefaultCardOff; window.isDefaultCardOff = function(){ return true; };
  var p = window.__p2LibPoolProbe ? window.__p2LibPoolProbe('water','${F}',${FB}) : null; return p; } catch(e){ return { __err:String(e).slice(0,200) }; }`);
ok('B1 全关 ⇒ p2 libPool 空池（不再回落兜底）', Array.isArray(b1) && b1.length === 0, '读数=' + JSON.stringify(b1) + '（RED=整串兜底/noProbe）');
const b2 = await evalJs(`try { window.isDefaultCardOff = function(cat,c){ return c==='甲'; };
  var p = window.__p2LibPoolProbe ? window.__p2LibPoolProbe('water','${F}',${FB}) : null; return p; } catch(e){ return { __err:String(e).slice(0,200) }; }`);
ok('B2 只关一张 ⇒ 只掉那张（零误伤）', Array.isArray(b2) && b2.length === 1 && b2[0] === '乙', '读数=' + JSON.stringify(b2));
const b3 = await evalJs(`try { if (window.__idcoOrig) window.isDefaultCardOff = window.__idcoOrig;
  var p = window.__p2LibPoolProbe ? window.__p2LibPoolProbe('water','${F}',${FB}) : null; return p; } catch(e){ return { __err:String(e).slice(0,200) }; }`);
ok('B3 未关 ⇒ 池照旧非空（判据不误伤正常使用）', Array.isArray(b3) && b3.length === 2, '读数=' + JSON.stringify(b3));
const b4 = await evalJs(`try { window.isDefaultCardOff = function(){ return true; };
  var p = window.__p2FishPoolProbe ? window.__p2FishPoolProbe('摸鱼浮字_1513',${FB}) : null;
  if (window.__idcoOrig) window.isDefaultCardOff = window.__idcoOrig; return p; } catch(e){ return { __err:String(e).slice(0,200) }; }`);
ok('B4 全关 ⇒ p2 fishPool 空池', Array.isArray(b4) && b4.length === 0, '读数=' + JSON.stringify(b4));
const b5 = await evalJs(`try { window.isDefaultCardOff = function(){ return true; };
  var p = window.gateCardFallback ? window.gateCardFallback('main',['兜底甲']) : null;
  if (window.__idcoOrig) window.isDefaultCardOff = window.__idcoOrig; return p; } catch(e){ return { __err:String(e).slice(0,200) }; }`);
ok('B5 #1498 gateCardFallback 出口仍工作（邻批守卫）', Array.isArray(b5) && b5.length === 0, '读数=' + JSON.stringify(b5));
ok('Z 全程零 JS 异常', jsErr === 0, '异常数=' + jsErr);

console.log('\\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);
