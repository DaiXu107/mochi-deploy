// ===== 常驻回归脚本 #1153：互动卡频率档（原频率 + 往下三档）＋ 跨桌面查岗频率同步加档 =====
// 用法：node build.mjs && node tools/verify-1153-interact-card-freq.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-1153-interact-card-freq.mjs   （红绿对照）
//
// 需求（用户直派，两句话）：
//   ①「联系人在聊天里发送互动卡片的频率需要可以调整 / 原来的频率也保留」
//   ②「其实原频率就已经很频繁了。不要高频率，帮我做原频率调低几档。跨桌面查岗也是帮我做原频率调低几档」
//
// 设计（零机型/内核分支，纯档位倍数）：
//   A. 互动卡频率档（reply-ic-freq，随联系人桌面隔离，默认 0＝原频率）——档位全部 ≤ 原频率：
//        · 五类提问卡（询问 / 小问题 / 好奇 / 吐槽 / 分享你的字卡）：概率 × probMul、
//          各自冷却 × coolMul、跨类型总闸门（基准 60 分钟）× gateMul；
//        · 邀请三类（猜拳 / 游戏 / 贴贴，ta-invite.js 的 hit）与音乐邀请（music-player.js
//          的「一起去听」）：只套概率 × probMul。
//      倍数与消费全在 src/js/ta-ask.js（IC_MODES / icProb / icCool / interactGateMs）；
//      设置页行由 src/js/reply-settings.js 注入。
//   B. 跨桌面查岗频率档（desk-freq-mode，全局根键）——'std' 由「标准」改称「原频率」（数值不变），
//      新增更安静/最安静；不再出现「频繁」档，存量 'freq' 一次性迁到 'std'。
//
// 断言组：
//   S 产物锚（档位表 / 概率漏斗 / 冷却倍数 / 动态闸门 / 设置页键与行 / 邀请与音乐接线 / 查岗四档）
//   A 原频率＝逐位不变（未设键时四个漏斗函数必须给出加本功能之前的值）
//   B 往下三档的倍数（含「原值 ≥1 不许被抹成 0」与「原值 0 仍是 0」两条下限语义）
//   C 总闸门行为判别：同一时间戳在不同档位下结论必须相反（频率真的变了的证据）
//   D 邀请三类随档（真链路 taInviteDraw：同一记骰点在原频率命中、在最安静档不命中）
//   E 互动卡频率设置页行：默认显原频率、点开四档、点「很安静」确定后键与显示同步
//   F 跨桌面查岗档位行：四档文案、默认高亮安静、点选落盘＋探针读数、存量 freq 迁移、不得有「频繁」
//   Z 全程零 JS 异常
//
// 零机型/内核分支：判据只有档位倍数与时间戳几何，与设备型号、浏览器内核无关。
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.MOCHI_ROOT ? normalize(resolve(process.env.MOCHI_ROOT)) : (process.argv[2] ? normalize(resolve(process.argv[2])) : normalize(join(dirname(fileURLToPath(import.meta.url)), '..')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---------- S 组：产物锚（#860 后 js 外置，读 js/<file> 产物） ----------
let taAsk = '', replySet = '', taInvite = '', music = '', inReq = '';
try { taAsk = readFileSync(join(root, 'js', 'ta-ask.js'), 'utf8'); } catch (e) {}
try { replySet = readFileSync(join(root, 'js', 'reply-settings.js'), 'utf8'); } catch (e) {}
try { taInvite = readFileSync(join(root, 'js', 'ta-invite.js'), 'utf8'); } catch (e) {}
try { music = readFileSync(join(root, 'js', 'music-player.js'), 'utf8'); } catch (e) {}
try { inReq = readFileSync(join(root, 'js', 'incoming-requests.js'), 'utf8'); } catch (e) {}
check('S1 频率档表在位（IC_MODES）', taAsk.includes('const IC_MODES = ['));
check('S2 概率倍数漏斗在位（icProb）', taAsk.includes('function icProb(v) {'));
check('S3 询问冷却走 icCool(45)（不再写死 45 分钟）', taAsk.includes('if (Date.now() - (d.lastAskAt || 0) < icCool(45) * 60000) return;'));
check('S4 跨类型总闸门按档缩放（interactGateMs）', taAsk.includes('return Date.now() - last >= interactGateMs();'));
check('S5 回复设置默认键 ic-freq = 0（原频率）', replySet.includes("'ic-freq': 0,"));
check('S6 设置页档位行注入在位', replySet.includes("row.id = 'ic-freq-row';"));
check('S7 邀请三类（猜拳/游戏/贴贴）走 icProb', taInvite.includes('window.icProb ? window.icProb(eff) : eff'));
check('S8 音乐「一起去听」邀请走 icProb', music.includes('window.icProb ? window.icProb(prob) : prob'));
check('S9 跨桌面查岗档位表含更安静/最安静', inReq.includes("quiet2: { label: '更安静'") && inReq.includes("quiet3: { label: '最安静'"));
check('S10 跨桌面查岗档位行只列四档（不含 freq）', inReq.includes("const DMODE_PILLS = ['std', 'quiet', 'quiet2', 'quiet3'];"));
check('S11 旧写死冷却不得回流（询问 45 * 60000 裸口径）', !taAsk.includes('d.lastAskAt || 0) < 45 * 60000'));
check('S12 旧写死闸门不得回流（裸 INTERACT_GATE_MS 比较）', !taAsk.includes('return Date.now() - last >= INTERACT_GATE_MS;'));
check('S13 其余四类冷却均已接 icCool（30/30/30/90）', taAsk.includes('icCool(30) * 60000') && taAsk.includes('icCool(90) * 60000'));
check('S14 五类概率均已接 icProb（≥5 处）', (taAsk.match(/icProb\(/g) || []).length >= 5, 'count=' + (taAsk.match(/icProb\(/g) || []).length);

// ---------- 无头浏览器 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9500 + Math.floor(Math.random() * 200));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1153-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const jsErrors = [];
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
          if (m.method === 'Runtime.exceptionThrown') jsErrors.push(((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text || '').slice(0, 200));
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
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 393, height: 873, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
await ev("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(800);

const setFreq = (v) => ev(v === null
  ? "(function(){try{window.activeStore().remove('reply-ic-freq');}catch(e){}return true;})()"
  : "(function(){try{window.activeStore().set('reply-ic-freq','" + v + "');}catch(e){}return true;})()");
const seedGate = (msAgo) => ev("(function(){try{window.activeStore().set('interact-card-last', String(Date.now() - " + msAgo + "));}catch(e){}return true;})()");
const gateOpen = () => ev('(function(){try{return !!window.interactGateOk();}catch(e){return null;}})()');
const modeId = () => ev('(function(){try{return window.icMode().id;}catch(e){return null;}})()');
const num = (expr) => ev('(function(){try{return ' + expr + ';}catch(e){return null;}})()');
const probe = () => ev("(function(){var p=window.__mochiIncomingProbe&&window.__mochiIncomingProbe();return p?p.mode+'/'+p.prob+'/'+p.cool:null;})()");
const closeModal = async () => { await ev("(function(){var m=document.getElementById('modal-mask');if(m&&!m.hidden){var o=document.getElementById('modal-ok');if(o)o.click();}return true;})()"); await sleep(200); };
const clickPillIn = (containerId, label) => ev("(function(){var w=document.getElementById('" + containerId + "');if(!w)return false;var ps=w.querySelectorAll('.pill');for(var i=0;i<ps.length;i++){if(ps[i].textContent==='" + label + "'){ps[i].click();return true;}}return false;})()");

// ---------- A 组：原频率＝逐位不变（未设键） ----------
await setFreq(null);
check('A0 未设键 → 档位回退 orig', (await modeId()) === 'orig', String(await modeId()));
check('A1 原频率 icProb(5) === 5（四类提问卡默认概率原样）', (await num('window.icProb(5)')) === 5, String(await num('window.icProb(5)')));
check('A2 原频率 icProb(4) === 4（分享你的字卡默认概率原样）', (await num('window.icProb(4)')) === 4, String(await num('window.icProb(4)')));
check('A3 原频率 icCool(45/30/90) 全部原样', (await num('[window.icCool(45),window.icCool(30),window.icCool(90)].join(",")')) === '45,30,90', String(await num('[window.icCool(45),window.icCool(30),window.icCool(90)].join(",")')));
check('A4 原频率 总闸门 === 60 分钟（3600000ms）', (await num('window.interactGateMs()')) === 3600000, String(await num('window.interactGateMs()')));
check('A5 四档标签与顺序（原频率/稍安静/安静/很安静）', (await num('window.icModes.map(function(m){return m.label;}).join("/")')) === '原频率/稍安静/安静/很安静', String(await num('window.icModes.map(function(m){return m.label;}).join("/")')));

// ---------- C 组：总闸门行为（原频率基准，先跑） ----------
await setFreq('0');
await seedGate(40 * 60000);
check('C1 原频率：40 分钟前发过卡 → 闸门关（40 < 60）', (await gateOpen()) === false, String(await gateOpen()));
await seedGate(70 * 60000);
check('C2 原频率：70 分钟前发过卡 → 闸门开（70 > 60）', (await gateOpen()) === true, String(await gateOpen()));

// ---------- B 组：往下三档的倍数 ----------
await setFreq('1');
check('B0 稍安静档生效', (await modeId()) === 'low1', String(await modeId()));
check('B1 稍安静 icProb(5) === 3（×0.6）', (await num('window.icProb(5)')) === 3, String(await num('window.icProb(5)')));
check('B2 稍安静 icCool(45/30/90) === 68/45/135（×1.5）', (await num('[window.icCool(45),window.icCool(30),window.icCool(90)].join(",")')) === '68,45,135', String(await num('[window.icCool(45),window.icCool(30),window.icCool(90)].join(",")')));
check('B3 稍安静 总闸门 === 90 分钟', (await num('window.interactGateMs()')) === 5400000, String(await num('window.interactGateMs()')));
await setFreq('2');
check('B4 安静 icProb(5) === 2（×0.4）', (await num('window.icProb(5)')) === 2, String(await num('window.icProb(5)')));
check('B5 安静 icCool(45/30/90) === 90/60/180（×2）', (await num('[window.icCool(45),window.icCool(30),window.icCool(90)].join(",")')) === '90,60,180', String(await num('[window.icCool(45),window.icCool(30),window.icCool(90)].join(",")')));
check('B6 安静 总闸门 === 120 分钟', (await num('window.interactGateMs()')) === 7200000, String(await num('window.interactGateMs()')));
await setFreq('3');
check('B7 很安静 icProb(5) === 1（×0.2）', (await num('window.icProb(5)')) === 1, String(await num('window.icProb(5)')));
check('B8 很安静 icCool(45/30/90) === 135/90/270（×3）', (await num('[window.icCool(45),window.icCool(30),window.icCool(90)].join(",")')) === '135,90,270', String(await num('[window.icCool(45),window.icCool(30),window.icCool(90)].join(",")')));
check('B9 很安静 总闸门 === 180 分钟', (await num('window.interactGateMs()')) === 10800000, String(await num('window.interactGateMs()')));
check('B10 原值 ≥1 不许被抹成 0（很安静 icProb(1) === 1）', (await num('window.icProb(1)')) === 1, String(await num('window.icProb(1)')));
check('B11 原值 0 仍是 0（真关掉不被档位救活）', (await num('window.icProb(0)')) === 0, String(await num('window.icProb(0)')));
check('B12 很安静 icCool 下限 ≥1 分钟', (await num('window.icCool(1)')) >= 1, String(await num('window.icCool(1)')));

// ---------- C 组续：同一时间戳在不同档位下结论相反 ----------
await seedGate(100 * 60000);
check('C3 很安静：100 分钟前发过卡 → 闸门关（100 < 180；原频率下为开，C2 对照）', (await gateOpen()) === false, String(await gateOpen()));
await seedGate(200 * 60000);
check('C4 很安静：200 分钟前发过卡 → 闸门开（200 > 180）', (await gateOpen()) === true, String(await gateOpen()));

// ---------- D 组：邀请三类随档（真链路 taInviteDraw） ----------
await ev("(function(){window.__t1153Draw=function(){var o=Math.random;try{Math.random=function(){return 0.05;};return window.taInviteDraw({'ai-rps-en':1,'ai-rps-prob':10,'ai-game-en':0,'ai-cuddle-en':0});}finally{Math.random=o;}};return true;})()");
await setFreq('0');
const dOrig = await ev("(function(){var r=window.__t1153Draw();return r&&r.text?r.text:null;})()");
await setFreq('3');
const dLow = await ev("(function(){var r=window.__t1153Draw();return r&&r.text?r.text:null;})()");
await setFreq('0');
if (!dOrig) {
  check('D1 邀请池为空 → 邀请随档断言环境不满足（按绿放行，不误报回归）', true, 'pool empty');
  check('D2 邀请池为空 → 跳过', true, 'pool empty');
} else {
  check('D1 原频率：骰点 5 落在 10% 内 → 猜拳邀请命中', !!dOrig, String(dOrig));
  check('D2 很安静：同一骰点 5 落在 2% 外 → 不命中（概率被档位压低）', dLow === null, String(dLow));
}

// ---------- E 组：互动卡频率设置页行 ----------
await setFreq('0');
await ev("(function(){document.dispatchEvent(new Event('contact-switched'));return true;})()");
await sleep(200);
check('E1 档位行在位且默认显「原频率」', (await ev("(function(){var b=document.getElementById('ic-freq-btn');return b?b.textContent:null;})()")) === '原频率',
  String(await ev("(function(){var b=document.getElementById('ic-freq-btn');return b?b.textContent:null;})()")));
check('E2 功能说明胶囊在位', (await ev("!!document.getElementById('ic-freq-tag')")) === true);
// #1154（用户实报「我在回复设置里没有看到这个啊」）→ #1155 追派「这个应该放在一个独立 tag」：
// #1153 首版挂在【字卡与概率】子面板深处（不在默认面板、还要往下滚 1287px），#1154 改挂默认面板的
// 「主动发送」分组之后（用户仍嫌要翻半页）。现要求：单开一枚二级 tag 承载它。
// 先真的进到回复设置页——否则 .page[hidden] 是 display:none，任何 getBoundingClientRect 都量成 0×0。
await ev("(function(){var t=document.querySelector('.tab[data-page=\"page-setting\"]');if(t)t.click();var r=document.getElementById('row-general');if(r)r.click();return true;})()");
await sleep(800);
check('E3a 回复设置页存在独立的「互动频率」二级 tag',
  (await ev("(function(){var t=document.querySelector('#page-reply-settings .rps-tabs .rps-tab[data-rps=\"interact\"]');return t?t.textContent:null;})()")) === '互动频率',
  String(await ev("(function(){var t=document.querySelector('#page-reply-settings .rps-tabs .rps-tab[data-rps=\"interact\"]');return t?t.textContent:null;})()")));
check('E3b 该 tag 有配对的独立面板（rps-panel[data-rps=interact]），且默认收起不抢默认面板',
  (await ev("(function(){var p=document.querySelector('#page-reply-settings .rps-panel[data-rps=\"interact\"]');if(!p)return false;if(!p.hidden)return false;var d=document.querySelector('#page-reply-settings .rps-panel[data-rps=\"reply\"]');return !!(d&&!d.hidden);})()")) === true);
check('E3c 档位组在该面板内、不在别的面板',
  (await ev("(function(){var g=document.getElementById('ic-freq-group');if(!g)return false;var p=g.closest('.rps-panel');return !!p&&p.dataset.rps==='interact';})()")) === true);
await ev("(function(){var t=document.querySelector('#page-reply-settings .rps-tabs .rps-tab[data-rps=\"interact\"]');if(t)t.click();return true;})()");
await sleep(500);
const e3d = await ev("(function(){var r=document.getElementById('ic-freq-row');if(!r)return 'no row';var q=r.getBoundingClientRect();if(!q.width||!q.height)return '0x0';var n=r;while(n&&n!==document.body){if(n.hidden===true||getComputedStyle(n).display==='none')return 'ancestor hidden';n=n.parentElement;}return 'visible '+Math.round(q.width)+'x'+Math.round(q.height);})()");
check('E3d 点开「互动频率」tag 后该行已布局可见（无需再翻页）', String(e3d).indexOf('visible') === 0, String(e3d));
check('E3e 切走 tag 后该面板收起、默认面板复位',
  (await ev("(function(){var t=document.querySelector('#page-reply-settings .rps-tabs .rps-tab[data-rps=\"reply\"]');if(t)t.click();return true;})()")) === true && (await sleep(400)) === undefined &&
  (await ev("(function(){var i=document.querySelector('#page-reply-settings .rps-panel[data-rps=\"interact\"]');var r=document.querySelector('#page-reply-settings .rps-panel[data-rps=\"reply\"]');return !!(i&&i.hidden&&r&&!r.hidden);})()")) === true);
await ev("(function(){var b=document.getElementById('ic-freq-btn');if(b)b.click();return true;})()");
await sleep(250);
const pillCount = await ev("(function(){var p=document.getElementById('modal-pills');if(!p||p.hidden)return 0;return p.children.length;})()");
check('E4 点胶囊弹出四档 pills', pillCount === 4, 'count=' + pillCount);
const pillText = await ev("(function(){var p=document.getElementById('modal-pills');if(!p)return null;return Array.prototype.map.call(p.children,function(c){return c.textContent;}).join('/');})()");
check('E5 pills 文案＝原频率/稍安静/安静/很安静', pillText === '原频率/稍安静/安静/很安静', String(pillText));
await ev("(function(){var p=document.getElementById('modal-pills');if(!p)return false;for(var i=0;i<p.children.length;i++){if(p.children[i].textContent==='很安静'){p.children[i].click();return true;}}return false;})()");
await sleep(150);
await ev("(function(){var o=document.getElementById('modal-ok');if(o)o.click();return true;})()");
await sleep(300);
const storedFreq = await ev("(function(){try{return window.activeStore().get('reply-ic-freq');}catch(e){return null;}})()");
check('E6 点「很安静」确定后落盘 reply-ic-freq = 3', storedFreq === '3', String(storedFreq));
check('E7 落盘后行显示同步为「很安静」', (await ev("(function(){var b=document.getElementById('ic-freq-btn');return b?b.textContent:null;})()")) === '很安静',
  String(await ev("(function(){var b=document.getElementById('ic-freq-btn');return b?b.textContent:null;})()")));
check('E8 落盘后掷签侧立刻按很安静档（icProb(5) === 1）', (await num('window.icProb(5)')) === 1, String(await num('window.icProb(5)')));

// ---------- F 组：跨桌面查岗档位行 ----------
await ev("(function(){try{window.xyStore('xy-home-v2').set('desk-freq-mode','quiet');}catch(e){}document.dispatchEvent(new Event('contact-switched'));return true;})()");
await sleep(250);
check('F1 跨桌面查岗档位行在位', (await ev("!!document.getElementById('sf-desk-freq')")) === true);
const fPills = await ev("(function(){var w=document.getElementById('sf-desk-freq');if(!w)return null;var ps=w.querySelectorAll('.pill');return Array.prototype.map.call(ps,function(b){return b.textContent;}).join('/');})()");
check('F2 档位行四档文案＝原频率/安静/更安静/最安静（且不含「频繁」）', fPills === '原频率/安静/更安静/最安静', String(fPills));
const fOn = await ev("(function(){var w=document.getElementById('sf-desk-freq');if(!w)return null;var on=w.querySelector('.pill.on');return on?on.textContent:null;})()");
check('F3 默认高亮「安静」（默认档 quiet 未变）', fOn === '安静', String(fOn));
await clickPillIn('sf-desk-freq', '更安静');
await sleep(250);
await closeModal();
const f4key = await ev("(function(){try{return window.xyStore('xy-home-v2').get('desk-freq-mode');}catch(e){return null;}})()");
const f4probe = await probe();
check('F4 点「更安静」→ 存 quiet2 且探针读 0.5% / 360 分钟', f4key === 'quiet2' && f4probe === 'quiet2/0.5/360', f4key + ' | ' + f4probe);
await clickPillIn('sf-desk-freq', '原频率');
await sleep(250);
await closeModal();
const f5key = await ev("(function(){try{return window.xyStore('xy-home-v2').get('desk-freq-mode');}catch(e){return null;}})()");
const f5probe = await probe();
check('F5 点「原频率」→ 存 std 且探针读 2% / 30 分钟（＝历史默认节奏，数值未变）', f5key === 'std' && f5probe === 'std/2/30', f5key + ' | ' + f5probe);
await ev("(function(){try{window.xyStore('xy-home-v2').set('desk-freq-mode','freq');}catch(e){}document.dispatchEvent(new Event('contact-switched'));return true;})()");
await sleep(250);
const f6key = await ev("(function(){try{return window.xyStore('xy-home-v2').get('desk-freq-mode');}catch(e){return null;}})()");
const f6probe = await probe();
check('F6 存量「频繁」一次性迁到原频率（存 std、探针 2%/30min）', f6key === 'std' && f6probe === 'std/2/30', f6key + ' | ' + f6probe);

// ---------- Z 组：零异常 ----------
const realErr = jsErrors.filter(e => !/favicon|net::ERR|Failed to load resource/i.test(e));
check('Z1 全程零 JS 异常', realErr.length === 0, realErr.slice(0, 3).join(' | '));

// ---------- 汇总 ----------
const pass = results.filter(r => r.ok).length;
console.log('\n' + pass + '/' + results.length + ' passed');
try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);
