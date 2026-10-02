// ===== #1474 症状关心——经期页记了症状，梦角按概率发进聊天并进「TA 的关心记录」按月折叠 =====
// 作者拍板（2026-09-30）：「症状缓解建议」要像梦角关心那样由联系人概率触发发到聊天（带标签），
// 自动进主页「TA 的关心记录」按月折叠。此前它只是经期页内一张静态卡，无聊天链路、无收纳。
// 本尺三件事：
//   A 组锚点：sym 语境判定 / 发送带「症状关心」标签 / records 回收 / 保存后当场触发（src+产物双查）＋语料池 11 症状在位＋旧单选发送行不回流。
//   B 组行为（无头真跑产物）：真点日格弹层勾症状保存 → 聊天多一条「症状关心」in 消息；fired 每日一条；
//     3 天窗外不提；两道闸（careEnabled / dcf-care）各关一腿不发；深夜静默不发不写 fired；
//     经期中＋有症状＝症状优先（不发经期关心）；无症状日照走经期关心（存量不回归）；主页关心记录渲染出「症状关心」行。
//   Z 组全程零未捕获异常。
// 判据零机型／零 UA 分支：只取「这条 daily 记了几个症状」「这条消息带什么 tag」「fired 键写没写」。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
console.log('被测根目录:', root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9880 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1474-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : '')); }
const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const cnt = (hay, n) => hay.split(n).length - 1;
if (!read('index.html')) { console.error('根目录没有 index.html＝产物未构建，退出（不当成断言失败）'); process.exit(2); }

// ---- A 组：锚点（src + 产物各查一次）----
const PSRC = read('src/js/period.js'), PPROD = read('js/period.js');
const RSRC = read('src/js/records.js'), RPROD = read('js/records.js');
check('A1 sym 语境判定在位（近 3 天窗＋随机取一；删＝记了症状聊天里永远没人问）',
  cnt(PSRC, "shouldCare = true; ctx = 'sym'; kind = 'sym';") === 1 && cnt(PPROD, "shouldCare = true; ctx = 'sym'; kind = 'sym';") === 1,
  'src ' + cnt(PSRC, "shouldCare = true; ctx = 'sym'; kind = 'sym';") + ' / 产物 ' + cnt(PPROD, "shouldCare = true; ctx = 'sym'; kind = 'sym';"));
check('A2 发送带「症状关心」标签（三词三元；摘掉标签＝消息无来源、记录页收不到）',
  cnt(PSRC, "kind === 'sym' ? '症状关心' : (kind === 'in' ? '经期关心' : '经期预警')") === 1 && cnt(PPROD, "kind === 'sym' ? '症状关心' : (kind === 'in' ? '经期关心' : '经期预警')") === 1);
check('A3 主页关心记录回收症状关心（删＝聊天里发了、记录页永远不出现）',
  cnt(RSRC, "tag === '症状关心'") === 1 && cnt(RPROD, "tag === '症状关心'") === 1);
check('A4 日格弹层保存症状后当场过关心链（删＝只能等下次联系人回复被动触发）',
  cnt(PSRC, 'if (syms.length) { try { checkCare(); } catch (e) {} }') === 1 && cnt(PPROD, 'if (syms.length) { try { checkCare(); } catch (e) {} }') === 1);
const poolKeys = (PSRC.match(/SYM_CARE_LINES = \{[\s\S]*?\n  \};/) || [''])[0];
check('A5 语料池 11 个症状 key 在位（src），产物同在',
  (poolKeys.match(/\w+: \[/g) || []).length === 11 && cnt(PPROD, 'SYM_CARE_LINES') >= 1,
  'src keys ' + (poolKeys.match(/\w+: \[/g) || []).length);
check('A6 旧单选发送行不回流（原「只认 in/warn」的两支取行已被三支取代）',
  cnt(PPROD, "var line = kind === 'in' ? pickCareLine() : pickWarnLine(ctx, tier);") === 0);
check('A7 当日基数 85%（症状档；原 90/70/55/75 四档一字不动）',
  cnt(PPROD, "if (kind === 'sym') baseProb = 85;") === 1 && cnt(PPROD, 'baseProb = 90') === 1 && cnt(PPROD, 'baseProb = 75') === 1);

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await sleep(1500);
await evalJs(`(function(){
  window.__errs = [];
  window.addEventListener('error', function(e){ window.__errs.push(String(e.message)); });
  // 钉死随机：dcf 闸（0*100>=100 为 false→放行）、基数（0>85 为 false→放行）、症状与语料随机都取第 0 个
  Math.random = function(){ return 0; };
  return 1;
})()`);

const dsOf = (off) => { const d = new Date(); d.setDate(d.getDate() + off);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// 种数据并重开经期页（app click 会重读 store 并整页重渲染＝种数据后唯一的生效入口）
async function reset(recs, daily, notifyExtra) {
  await evalJs(`(function(){
    var st = window.xyStore('xy-home-v2');
    st.set('period-migrated','1');
    st.set('period-records', JSON.stringify(${JSON.stringify(recs || [])}));
    st.set('period-cfg', JSON.stringify({ cycleLen: 28, periodLen: 5, lutealPhase: 14 }));
    st.set('period-daily', JSON.stringify(${JSON.stringify(daily || {})}));
    st.set('period-notify', JSON.stringify(Object.assign({ enabled: false, advanceDays: [3,1,0], hour: 9, careEnabled: true, fired: {} }, ${JSON.stringify(notifyExtra || {})})));
    st.set('chat-msgs', '[]');
    try { window.activeStore().remove('dcf-care'); } catch (e) {}
    document.querySelector('.app[data-app="period"]').click();
    return 1;
  })()`);
  await sleep(700);
}
// 读聊天里的「关心类」in 消息——内存优先（chatAddIn 进内存数组、chat-msgs 键走低频空闲落盘，
// 读存储会拿到空＝假「没发」），getChatMsgs 不在时回落存储（与 records.js renderCarePanel 同款双源）。
// 只认三枚 care 标签＝开机时 ta-ask/动态等系统杂音（无 tag）天然不进账。
const CARE_TAGS = ['症状关心', '经期关心', '经期预警'];
const careMsgs = () => evalJs(`(function(){
  var arr = null;
  try { if (window.getChatMsgs) arr = window.getChatMsgs() || []; } catch (e) {}
  if (!arr) { try { arr = JSON.parse(window.xyStore('xy-home-v2').get('chat-msgs') || '[]') || []; } catch (e) { arr = []; } }
  var want = ${JSON.stringify(CARE_TAGS)};
  return arr.filter(function(m){ return m && m.side === 'in' && want.indexOf((m.mood && m.mood[0] && m.mood[0].tag) || '') >= 0; }).map(function(m){
    return { tag: (m.mood && m.mood[0] && m.mood[0].tag) || '', text: String(m.text || '').slice(0, 30), ts: m.ts || 0 };
  });
})()`);
// 场景内判定一律用「调用前后按 tag 计数的差值」——checkCare 在环境里有多处异步触发点
// （开页/restore 补读/5 分钟拍/回复后），绝对计数会被别处的插入打碎＝脆断（#1324 同族教训）
const countTag = (arr, t) => arr.filter((m) => m.tag === t).length;
const firedKey = (k) => evalJs(`(function(){
  try { var n = JSON.parse(window.xyStore('xy-home-v2').get('period-notify') || '{}') || {};
    return !!(n.fired && n.fired[${JSON.stringify(k)}]); } catch (e) { return false; }
})()`);
// 真点日格弹层勾症状并保存（#1474d 的行为面：保存后当场触发）
async function tapAndSaveSym(off, sym) {
  await evalJs(`(function(){
    function ds(n){ var d = new Date(); d.setDate(d.getDate()+n);
      return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
    var c = document.querySelector('#period-grid .pc-cell[data-date="'+ds(${off})+'"]');
    if (!c) return 'nocell';
    c.click();
    return 'sent';
  })()`);
  await sleep(600);
  const r = await evalJs(`(function(){
    var pop = document.getElementById('period-day-pop');
    if (!pop) return 'nopop';
    var b = pop.querySelector('.dp-sym[data-sym="${sym}"]');
    if (!b) return 'nosym';
    b.click();
    pop.querySelector('.dp-save').click();
    return 'saved';
  })()`);
  await sleep(800);
  return r;
}
const callCare = () => evalJs(`(function(){ try { window.periodCheckCare(); return 'ok'; } catch (e) { return 'err:' + e.message; } })()`);

// ---- B1/B2：记症状当场发一条带标签的关心；fired 每日一条落位 ----
await reset([], {});
check('B0 经期页可打开', await evalJs(`!document.getElementById('page-period').hidden`));
const b1before = await careMsgs();
const b1save = await tapAndSaveSym(0, 'cramp');
const b1msgs = await careMsgs();
const b1sym = countTag(b1msgs, '症状关心') - countTag(b1before, '症状关心');
check('B1 点日格勾「痛经」保存 → 当场差值恰一条「症状关心」（正文取痛经语料）',
  b1save === 'saved' && b1sym === 1 && ((b1msgs.filter((m) => m.tag === '症状关心').pop()) || {}).text.indexOf('痛经') >= 0,
  b1save + ' / 差值 ' + b1sym + ' / ' + JSON.stringify(b1msgs.filter((m) => m.tag !== '')));
check('B2 fired 键 today_said_sym 落位（每日一条的闸）', await firedKey(dsOf(0) + '_said_sym'), dsOf(0) + '_said_sym');
const b3before = await careMsgs();
await callCare(); await sleep(300);
const b3after = await careMsgs();
check('B3 同天再触发不追加任何 care 消息（fired 已占）',
  countTag(b3after, '症状关心') === countTag(b3before, '症状关心') && countTag(b3after, '经期关心') === countTag(b3before, '经期关心'),
  'sym ' + countTag(b3after, '症状关心') + '→' + countTag(b3before, '症状关心'));

// ---- B4：3 天窗外的症状不提 ----
await reset([{ id: 'h', start: dsOf(-10), end: dsOf(-6) }], { [dsOf(-4)]: { symptoms: ['cramp'] } });
const b4before = await careMsgs();
await callCare(); await sleep(300);
const b4after = await careMsgs();
check('B4 症状在 4 天前（窗外）→ 不发（过时的关心很怪）',
  countTag(b4after, '症状关心') === countTag(b4before, '症状关心') && countTag(b4after, '经期关心') === countTag(b4before, '经期关心'),
  '差值 sym ' + (countTag(b4after, '症状关心') - countTag(b4before, '症状关心')));

// ---- B5a/B5b：两道闸各关一腿 ----
await reset([], { [dsOf(0)]: { symptoms: ['cramp'] } }, { careEnabled: false });
const b5abefore = await careMsgs();
await callCare(); await sleep(300);
const b5aafter = await careMsgs();
check('B5a 经期页「梦角关心」开关关 → 不发',
  countTag(b5aafter, '症状关心') === countTag(b5abefore, '症状关心') && countTag(b5aafter, '经期关心') === countTag(b5abefore, '经期关心'),
  '差值 sym ' + (countTag(b5aafter, '症状关心') - countTag(b5abefore, '症状关心')));
await reset([], { [dsOf(0)]: { symptoms: ['cramp'] } });
await evalJs(`window.activeStore().set('dcf-care','0');'s'`);
const b5bbefore = await careMsgs();
await callCare(); await sleep(300);
const b5bafter = await careMsgs();
check('B5b 字卡库概率乘成 0%（dcf-care=0）→ 不发',
  countTag(b5bafter, '症状关心') === countTag(b5bbefore, '症状关心') && countTag(b5bafter, '经期关心') === countTag(b5bbefore, '经期关心'),
  '差值 sym ' + (countTag(b5bafter, '症状关心') - countTag(b5bbefore, '症状关心')));

// ---- B6：深夜静默（23:00–06:00 不发不写 fired）----
// 先覆写 Date 再种数据开页：reset 的 app click 自带一次 checkCare 触发（开页判定），
// 正常时间下那一次就把 fired 占了＝深夜断言永远踩在别人的写入上（首轮实测踩过）
await evalJs(`(function(){
  window.__RealDate = Date;
  window.Date = class extends Date { getHours(){ return 23; } };
  return 1;
})()`);
await reset([], { [dsOf(0)]: { symptoms: ['cramp'] } });
const b6before = await careMsgs();
await callCare(); await sleep(300);
const b6after = await careMsgs();
const b6fired = await firedKey(dsOf(0) + '_said_sym');
await evalJs(`(function(){ window.Date = window.__RealDate; return 1; })()`);
check('B6 深夜静默（getHours=23）→ 不发且不写 fired（白天再触发照常补）',
  countTag(b6after, '症状关心') === countTag(b6before, '症状关心') && !b6fired,
  '差值 sym ' + (countTag(b6after, '症状关心') - countTag(b6before, '症状关心')) + ' / fired=' + b6fired);

// ---- B7：经期中＋有症状＝症状优先（不发经期关心）----
// baseline 取 reset 之前：种数据后 app click 开页自带一次 checkCare（发消息＋占 fired），
// 该次结算落在 baseline 与 after 之间＝断言对象就是「这一场景该发的那一条」
const b7before = await careMsgs();
await reset([{ id: 'p', start: dsOf(0), end: dsOf(4) }], { [dsOf(0)]: { symptoms: ['headache'] } });
const b7after = await careMsgs();
const b7sym = countTag(b7after, '症状关心') - countTag(b7before, '症状关心');
const b7in = countTag(b7after, '经期关心') - countTag(b7before, '经期关心');
check('B7 经期中＋记了头痛 → 开页触发恰发一条「症状关心」（头痛语料）、零条经期关心',
  b7sym === 1 && b7in === 0 && ((b7after.filter((m) => m.tag === '症状关心').pop()) || {}).text.indexOf('头疼') >= 0,
  '差值 sym ' + b7sym + ' / 经期 ' + b7in);
check('B7b fired 只占 sym 键，inPeriod 键未被写（同天只发一条不双发）',
  await firedKey(dsOf(0) + '_said_sym') && !(await firedKey(dsOf(0) + '_said_inPeriod')));

// ---- B8：无症状日＋经期中＝走原经期关心链（存量不回归）----
const b8before = await careMsgs();
await reset([{ id: 'p', start: dsOf(0), end: dsOf(4) }], {});
const b8after = await careMsgs();
const b8sym = countTag(b8after, '症状关心') - countTag(b8before, '症状关心');
const b8in = countTag(b8after, '经期关心') - countTag(b8before, '经期关心');
check('B8 无症状日＋经期中 → 开页触发恰发一条「经期关心」、零条症状关心（sym 分支没抢走存量语境）',
  b8in === 1 && b8sym === 0, '差值 sym ' + b8sym + ' / 经期 ' + b8in);

// ---- B9：主页「TA 的关心记录」渲染出「症状关心」行（回收＝聊天消息本身，按月折叠现成）----
// 内存与存储同种（renderCarePanel 读内存优先；只写存储会被内存数组盖读不到）
await evalJs(`(function(){
  var rec = { ts: Date.now(), side: 'in', text: '看到你记了痛经。热水袋焐一焐小腹，我陪你窝一会儿。', mood: [{ tag: '症状关心' }] };
  try { if (window.getChatMsgs) window.getChatMsgs().push(rec); } catch (e) {}
  var arr = []; try { arr = JSON.parse(window.xyStore('xy-home-v2').get('chat-msgs') || '[]') || []; } catch (e) {}
  arr.push(rec);
  window.xyStore('xy-home-v2').set('chat-msgs', JSON.stringify(arr));
  return 1;
})()`);
await evalJs(`document.querySelector('.app[data-app="home"]').click();'h'`);
await sleep(700);
await evalJs(`(function(){ var t = document.querySelector('#page-home .fav-tab[data-htab="care"]'); if (t) t.click(); return 1; })()`);
await sleep(500);
const b9dom = await evalJs(`(function(){
  var el = document.getElementById('home-care'); if (!el) return 'noel';
  return { hasRow: el.textContent.indexOf('症状关心') >= 0, hasText: el.textContent.indexOf('痛经') >= 0,
    folded: !!el.querySelector('[data-fold], .fold-head, details') || el.innerHTML.indexOf('fold') >= 0 };
})()`);
check('B9 主页「TA 的关心记录」出现「症状关心」行（正文可读）',
  b9dom && b9dom.hasRow === true && b9dom.hasText === true, JSON.stringify(b9dom));

// ---- Z1：全程零未捕获异常 ----
check('Z1 全程零未捕获异常', await evalJs(`JSON.stringify(window.__errs || [])`) === '[]', await evalJs(`JSON.stringify(window.__errs || [])`));

const pass = results.filter((r) => r.ok).length;
console.log(''); console.log('合计: ' + pass + ' 通过 / ' + (results.length - pass) + ' 失败 / ' + results.length + ' 条');
chrome.kill(); server.close();
process.exit(pass === results.length ? 0 : 1);
