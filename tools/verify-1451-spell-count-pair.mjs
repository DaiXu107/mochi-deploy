// verify-1451-spell-count-pair.mjs —— #1451「每次拼字最少/最多张数」单开一对 + 单气泡正文走连接符池
// 用户实报「我设置的是触发拼字卡时默认 2~5 字卡，但是现在一直都是触发 5 字卡」——本尺子钉三件事：
//   ① 设置页两格 → getCfg 折成 qs-min/qs-max（单一来源）→ 抽卡侧只认这两个数；
//   ② 缺键＝跟随「多字卡回复」的最少/最多条数（老存档零变化）；单设/收口/倒挂/越界都在设置层收干净；
//   ③ 单气泡拼字正文吃「拼接随机标点」符号池（#1451 D6：此前该形态正文用空格硬拼绕过池子，
//      设置页却写着用同一套池——池只剩「，」时气泡里必须出现「，」）。
// 跑法：node tools/verify-1451-spell-count-pair.mjs [--no-cdp]
//   --no-cdp＝只跑 A/B/C 三段（纯 node）；D 段要本机 Chrome/Edge，取不到按环境缺口 exit 2。
// verify-suite:timeout=180000
import { readFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import vm from 'node:vm';
import { join, dirname, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NO_CDP = process.argv.includes('--no-cdp');
let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra ? ' —— ' + extra : '')); }
};
const read = (p) => readFileSync(join(root, p), 'utf8');

// —— 从源码里抠出一个具名函数（按花括号配平，防把隔壁函数一起带走）——
function sliceFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  return '';
}

// ================= A. 源码接线（改坏即报红） =================
const qs = read('src/js/quote-spell.js');
const rs = read('src/js/reply-settings.js');
const chat = read('src/js/chat.js');
const tpl = read('src/template.html');
const ca = read('src/js/card-audit.js');
const bm = read('build.mjs');

ok(qs.includes("const pmin = Math.max(1, Math.min(10, Number(c['qs-min']) || 2));") &&
   qs.includes("const pmax = Math.max(pmin, Math.min(10, Number(c['qs-max']) || 5));"),
   'A1 quote-spell.js 抽卡张数只认 cfg 里的 qs-min/qs-max（引擎不再自己读存储）');
ok(!qs.includes("c['py-min']") && !qs.includes("c['py-max']"),
   'A2 quote-spell.js 不再直接读 py-min/py-max（两处各算一份＝设置页与实际出牌打架）');

ok(rs.includes('const spPair = spellPairFrom(ls, out);') && rs.includes("out['qs-min'] = spPair.min;") &&
   rs.includes("out['qs-max'] = spPair.max;") && rs.includes("out['qs-pair-own'] = spPair.own;"),
   'A3 reply-settings.js getCfg 把拼字一对折好放进 cfg（qs-min/qs-max/qs-pair-own 单一来源）');
ok(rs.includes("const spPair2 = spellPairFrom(s || ls, out);") && rs.includes("out['qs-pair-own'] = spPair2.own;"),
   'A4 replyCfgFor（跨桌面来消息）按目标桌面折同一对');
ok(rs.includes("'qs-min': 'qs-max', 'qs-max': 'qs-min',"),
   'A5 PAIR_SIB 登记 qs 一对（写一格即收口另一格）');
ok(rs.includes('function syncSpellPairReadout() {') && (rs.match(/syncSpellPairReadout\(\);/g) || []).length >= 2,
   'A6 设置页读数行 syncSpellPairReadout 定义＋在 syncUI 里被调');
ok(rs.includes('data-k="qs-min"') === false && tpl.includes('data-k="qs-min"') && tpl.includes('data-k="qs-max"') &&
   tpl.includes('id="qs-range-readout"'),
   'A7 template.html 两格＋读数行在位（且没有被写进 JS）');

ok(chat.includes('m = addIn(rep.text, {') && !chat.includes("addIn(rep.spell.join(' ')"),
   'A8 chat.js 单气泡正文走 rep.text（#1451 D6：不再用空格硬拼绕过符号池）');
ok(chat.includes("window.__spellLog.push(spellSegs.length + (spellOne ? '单' : '连'));"),
   'A9 chat.js 拼字现场账（诊断里能看到每次几张、走哪个形态）');

ok(ca.includes('function replyRaw(k) {') && ca.includes('function replyNum(k, d)') && ca.includes('function replySet(k, v)'),
   'A10 card-audit.js 回复侧读数/写入口（replyRaw/replyNum/replySet）在位');
ok(ca.includes("replyNum('qs-prob', 25)") && ca.includes("replyBool('qs-en', true)") &&
   ca.includes("recordUndo('own', 'reply-qs-en')"),
   'A11 card-audit.js 体检读数与修复都走真源（qs 家族抽查）');
{
  const dead = ['qs-prob', 'py-prob', 'rn-prob', 'mjf-prob', 'csp-cust', 'as-prob', 'ckq-en', 'ckq-prob', 'cf-prob', 'sticker-prob', 'image-prob', 'touch-prob', 'quote-prob'];
  const left = dead.filter(k => ca.includes("store('" + k + "')"));
  ok(left.length === 0, 'A12 card-audit.js 无回复键裸读残留（reply- 命名空间的键不再走 store()）', left.join(','));
}
ok((bm.match(/name: '#1451/g) || []).length >= 8,
   'A13 build.mjs 登记表挂满 #1451 哨兵（a~h 共 8 条，删一条即报红）');

// ================= B. 引擎真跑（VM 载入 src/js/quote-spell.js） =================
{
  const w = {};
  w.window = w;
  w.getDefaultCardGroups = (cat) => {
    const d = w.DEFAULT_CARD_DATA || {};
    const base = d[cat] || [];
    const ext = cat === 'dict' ? (d.dict_ext || []) : [];
    return base.concat(ext);
  };
  w.isDefaultCardOff = () => false;
  w.defaultCardCat = () => true;
  vm.runInNewContext(read('src/js/default-cards-data.js'), w, { filename: 'default-cards-data.js' });
  vm.runInNewContext(read('src/js/dict-ext-data.js'), w, { filename: 'dict-ext-data.js' });
  vm.runInNewContext(qs, w, { filename: 'quote-spell.js' });
  const pick = w.quoteSpellPick;
  const BASE = { 'py-en': 1, 'qs-en': 1, 'qs-prob': 100, 'qs-cc': 0, 'qs-one': 1, 'qs-multi': 0 };

  // B1 单设 3~3：命中即恒 3 张
  let all3 = true, n3 = 0;
  for (let i = 0; i < 200; i++) {
    const r = pick(Object.assign({}, BASE, { 'qs-min': 3, 'qs-max': 3 }));
    if (!r || r.segs.length !== 3) { all3 = false; break; }
    n3++;
  }
  ok(all3 && n3 === 200, 'B1 qs-min=qs-max=3 → 200 掷全部 3 张（恒值区间不再随机）', 'n=' + n3);

  // B2 单设 2~5：四桶都出、分布大致均匀（每桶 22%~28%，4000 掷）
  const bucket = { 2: 0, 3: 0, 4: 0, 5: 0 };
  for (let i = 0; i < 4000; i++) {
    const r = pick(Object.assign({}, BASE, { 'qs-min': 2, 'qs-max': 5 }));
    bucket[r.segs.length]++;
  }
  const lo = Math.floor(4000 * 0.22), hi = Math.ceil(4000 * 0.28);
  ok([2, 3, 4, 5].every(k => bucket[k] >= lo && bucket[k] <= hi),
     'B2 qs-min~qs-max=2~5 → 四桶分布均匀（各 ' + lo + '~' + hi + ' 之间）', JSON.stringify(bucket));

  // B3 缺键回退 2~5（老存档零变化）：不低于 2、不高于 5、且两端都出现过
  let mn = 99, mx = 0;
  for (let i = 0; i < 800; i++) {
    const r = pick(Object.assign({}, BASE));
    mn = Math.min(mn, r.segs.length); mx = Math.max(mx, r.segs.length);
  }
  ok(mn >= 2 && mx <= 5 && mn === 2 && mx === 5, 'B3 缺键（老存档）回退 2~5：实测 ' + mn + '~' + mx);

  // B4 倒挂/越界输入直接喂引擎也不许出区间外的张数（设置层收口之外的兜底）
  let ok4 = true, seen = new Set();
  for (let i = 0; i < 200; i++) {
    const r = pick(Object.assign({}, BASE, { 'qs-min': 8, 'qs-max': 2 }));
    if (!r || r.segs.length !== 8) { ok4 = false; break; }
    seen.add(r.segs.length);
  }
  ok(ok4 && seen.size === 1 && seen.has(8), 'B4 倒挂输入 qs-min=8/qs-max=2 → 引擎收口恒 8（不会掷出 2~7）', [...seen].join(','));

  // B5 命中拼字就绝不少于 2 张（1 张的拼字会被 chat.js 静默丢掉＝用户感知为「不触发」）
  let never1 = true;
  for (let i = 0; i < 300; i++) { const r = pick(Object.assign({}, BASE, { 'qs-min': 2, 'qs-max': 5 })); if (r.segs.length < 2) never1 = false; }
  ok(never1, 'B5 拼字最小 2 张（1 张不会成拼字形态）');
}

// ================= C. 设置层折对（抠 reply-settings.js 真函数跑） =================
{
  const src = sliceFn(rs, 'rawNumFrom');
  const src2 = sliceFn(rs, 'spellPairFrom');
  ok(!!src && !!src2, 'C0 抠出 rawNumFrom / spellPairFrom 真函数体');
  const make = new Function(src + '\n' + src2 + '\nreturn spellPairFrom;');
  const spellPairFrom = make();
  const storeOf = (obj) => ({ get: (k) => (k in obj ? obj[k] : null) });
  const run = (obj, out) => spellPairFrom(storeOf(obj), out || {});

  let r = run({}, { 'py-min': 2, 'py-max': 5 });
  ok(r.min === 2 && r.max === 5 && r.own === 0, 'C1 两枚都缺键 → 跟随 py 对 2~5（own=0）', JSON.stringify(r));
  r = run({}, { 'py-min': 3, 'py-max': 8 });
  ok(r.min === 3 && r.max === 8 && r.own === 0, 'C2 两枚都缺键 → 跟随 py 对 3~8', JSON.stringify(r));
  r = run({ 'reply-qs-min': '4' }, { 'py-min': 2, 'py-max': 5 });
  ok(r.min === 4 && r.max === 5 && r.own === 0, 'C3 只设最少=4 → 最少 4、最多仍跟随 5（own=0＝仍算跟随）', JSON.stringify(r));
  r = run({ 'reply-qs-min': '3', 'reply-qs-max': '3' }, { 'py-min': 2, 'py-max': 5 });
  ok(r.min === 3 && r.max === 3 && r.own === 1, 'C4 单设一对 3~3 → 恒 3（own=1）', JSON.stringify(r));
  r = run({ 'reply-qs-min': '8', 'reply-qs-max': '2' }, { 'py-min': 2, 'py-max': 5 });
  ok(r.min === 8 && r.max === 8 && r.own === 1, 'C5 倒挂 8/2 → 收口成 8~8（区间不许倒挂）', JSON.stringify(r));
  r = run({ 'reply-qs-min': '0' }, { 'py-min': 2, 'py-max': 5 });
  ok(r.min === 1 && r.max === 5, 'C6 越界最少=0 → 钳到 1', JSON.stringify(r));
  r = run({ 'reply-qs-max': '99' }, { 'py-min': 2, 'py-max': 5 });
  ok(r.min === 2 && r.max === 10, 'C7 越界最多=99 → 钳到 10', JSON.stringify(r));
  r = run({ 'reply-qs-min': 'abc', 'reply-qs-max': '3' }, { 'py-min': 2, 'py-max': 5 });
  ok(r.min === 2 && r.max === 3 && r.rawMin === null, 'C8 脏值最少=abc → 当缺键跟随（不吃 NaN）', JSON.stringify(r));
}

// ================= D. 端到端（无头 Chrome + 真产物） =================
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });

if (NO_CDP) {
  console.log('（--no-cdp：D 段端到端跳过）');
} else if (!chromePath) {
  console.error('找不到 Chrome/Edge（D 段端到端跑不了；A~C 结果见上）');
} else {
  await runCdp();
}

async function runCdp() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
  // 服务的是本副本根目录产物（跑前先 node build.mjs，产物才是新代码）
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
  const udd = join(process.env.TEMP || '/tmp', 'mochi-v1451-' + Date.now());
  // 端口按批次取随机段，避免并发跑套件时与别支撞车（撞车＝本机 CDP 连不上，整支假红）
  const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 90));
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + udd, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
    throw new Error('无法连接无头浏览器');
  }
  const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
  async function evalJs(expr) {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('页面 JS 异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  }

  try {
    await cdpConnect();
    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('xy-home-v2:cardlock-state','open');" });
    await cdp('Page.navigate', { url: baseUrl + '/index.html' });
    await sleep(2500);
    for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
    await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();return true;})()");
    await sleep(500);
    await evalJs("(function(){var c=document.getElementById('splash-confirm');if(c&&!c.hidden){var b=c.querySelector('#splash-confirm-ok');if(b)b.click();}return true;})()");
    await sleep(900);
    await evalJs("(function(){var a=document.querySelector('.tab[data-tab=\"chat\"]');if(a)a.click();return true;})()");
    await sleep(800);

    // 静音一切会抢答/加料的机制，只留拼字；csp-cust=100＝自定义侧全保留不影响拼字命中后的正文
    const NOISE = {
      'rn-prob': 0, 'touch-prob': 0, 'sticker-prob': 0, 'emoji-prob': 0, 'image-prob': 0, 'voice-prob': 0,
      'kaomoji-prob': 0, 'quote-prob': 0, 'rc-prob': 0, 'rc-refix': 0, 'cf-prob': 0, 'as-en': 0,
      'ckq-en': 0, 'ai-rps-en': 0, 'ai-game-en': 0, 'ai-cuddle-en': 0, 'ai-cc-en': 0,
      'rs-min': 1, 'rs-max': 2, 'reply-min': 1, 'reply-max': 1, 'csp-cust': 100,
      'qs-en': 1, 'qs-prob': 100, 'qs-one': 1, 'qs-multi': 0, 'qs-cc': 0,
      'py-en': 1, 'py-punct-en': 1,
      'py-punct-space': 0, 'py-punct-dou': 1, 'py-punct-per': 0, 'py-punct-ex': 0, 'py-punct-q': 0, 'py-punct-el': 0, 'py-punct-dash': 0, 'py-punct-nl': 0,
    };
    await evalJs('(function(){var o=' + JSON.stringify(NOISE) + ';for(var k in o)window.saveReplyCfg(k,o[k]);' +
      'window.getCustomCards=function(){return [];};' +
      'window.getDefaultCards=function(){return {type:"text",text:"底层一张卡"};};' +
      'window.getReplyCard=function(){return "";};' +
      'window.dreamFreePick=function(){return null;};window.tryTaMoodShare=function(){return null;};' +
      'window.maybeMusicRequest=null;window.callMaybeTrigger=null;window.maybeAutoGift=null;window.periodCheckCare=null;' +
      'window.triggerEmotionChain=function(){return null;};window.periodWarmText=null;window.chatAddSystem=function(){return null;};' +
      'return true;})()');
    // 写后读回：设定值必须真落进 getCfg（否则下面读到的都是假绿）
    const back = JSON.parse(await evalJs("JSON.stringify((function(){var c=window.replyCfg?window.replyCfg():{};return {qsEn:c['qs-en'],prob:c['qs-prob'],one:c['qs-one'],dou:c['py-punct-dou'],space:c['py-punct-space'],pyMin:c['py-min'],pyMax:c['py-max']};})())") || 'null');
    ok(back && back.qsEn === 1 && back.prob === 100 && back.one === 1 && back.dou === 1 && back.space === 0,
      'D0 配置写后读回（qs-en=1 / qs-prob=100 / 单气泡 / 池只有「，」）', JSON.stringify(back));

    // 观测点＝① __spellLog 现场账（n＋单/连，生成那一刻记的真实张数与形态；rec 上不落 spell 字段，
    //   它只在渲染分支里用）② 屏上气泡与 rec.text（引用/收藏源）文本 ③ rec.mood 的词典 tag
    async function sendAndRead(label) {
      const idx0 = await evalJs('(((window.getChatMsgs&&window.getChatMsgs())||[]).length)');
      const log0 = await evalJs('((window.__spellLog||[]).length)');
      await evalJs("(function(){document.getElementById('chat-input').innerText='在吗';document.getElementById('chat-send').click();return true;})()");
      await sleep(9000);
      const rec = JSON.parse(await evalJs("(function(){var ms=(window.getChatMsgs&&window.getChatMsgs())||[];for(var i=ms.length-1;i>=" + idx0 + ";i--){var r=ms[i];if(r&&r.side==='in')return JSON.stringify({t:r.text,mood:(r.mood||[]).map(function(x){return x&&x.tag;})});}return 'null';})()") || 'null');
      const bubble = await evalJs("(function(){var ns=document.querySelectorAll('#chat-body .msg-in .msg-bubble');if(!ns.length)return null;return ns[ns.length-1].textContent;})()");
      const logNew = JSON.parse(await evalJs('JSON.stringify(((window.__spellLog||[]).slice(' + log0 + ')))') || '[]');
      console.log('· [' + label + '] 现场账=' + JSON.stringify(logNew) + ' 屏上气泡=' + JSON.stringify(bubble) +
        ' rec.t=' + JSON.stringify(rec && rec.t) + ' mood=' + JSON.stringify(rec && rec.mood) +
        ' 逗号数=' + ((bubble || '').match(/，/g) || []).length);
      return { rec, bubble, logNew, label };
    }

    // D1/D2/D3：单设 3~3 —— 命中即 3 张；正文＝连接符池（「，」）；气泡与 rec.text 同源
    await evalJs("(function(){window.saveReplyCfg('qs-min',3);window.saveReplyCfg('qs-max',3);return true;})()");
    const cfg1 = JSON.parse(await evalJs("JSON.stringify((function(){var c=window.replyCfg();return {min:c['qs-min'],max:c['qs-max'],own:c['qs-pair-own']};})())") || 'null');
    ok(cfg1 && cfg1.min === 3 && cfg1.max === 3 && cfg1.own === 1, 'D1 写「每次拼字 3~3」后 replyCfg 读数＝单设 3~3', JSON.stringify(cfg1));
    const r1 = await sendAndRead('3~3');
    ok(r1.logNew.length >= 1 && r1.logNew.every(e => e === '3单'),
      'D2 单设 3~3 → 真产物每次命中都是 3 张、单气泡形态（拼字现场账）', JSON.stringify(r1.logNew));
    ok(r1.rec && (r1.rec.mood || []).some(t => String(t || '').indexOf('词典') === 0),
      'D2b 单气泡落账形态（收件挂「词典」tag；逐卡连发那支会挂「词典逐卡连发」）', JSON.stringify(r1.rec && r1.rec.mood));
    ok(r1.bubble && r1.bubble.indexOf('，') >= 0 && r1.rec && r1.rec.t && r1.rec.t.indexOf('，') >= 0 &&
       ((r1.bubble || '').match(/，/g) || []).length >= 2,
      'D3 #1451 D6：池只剩「，」→ 单气泡正文（屏上气泡与 rec.text）都出现「，」且至少两道连接符',
      JSON.stringify({ bubble: r1.bubble, text: r1.rec && r1.rec.t }));

    // D4：删掉拼字那对 + py 4~4 —— 缺键跟随 py 对，每掷都 4 张
    await evalJs("(function(){var s=window.activeStore();s.remove('reply-qs-min');s.remove('reply-qs-max');window.saveReplyCfg('py-min',4);window.saveReplyCfg('py-max',4);return true;})()");
    const cfg2 = JSON.parse(await evalJs("JSON.stringify((function(){var c=window.replyCfg();return {min:c['qs-min'],max:c['qs-max'],own:c['qs-pair-own'],pymin:c['py-min'],pymax:c['py-max']};})())") || 'null');
    ok(cfg2 && cfg2.own === 0 && cfg2.min === 4 && cfg2.max === 4,
      'D4 删键后跟随「多字卡回复」4~4（own=0、生效 4~4）', JSON.stringify(cfg2));
    const r2 = await sendAndRead('follow');
    ok(r2.logNew.length >= 1 && r2.logNew.every(e => e === '4单'),
      'D5 真产物：跟随 py 4~4 → 每次命中都抽 4 张', JSON.stringify(r2.logNew));

    const errs = await evalJs('(window.__jsErrors||[]).slice(-3)');
    ok(!errs || !errs.length, 'D6 全程零页面错误', JSON.stringify(errs));
  } catch (e) {
    fail++;
    console.log('❌ D 段端到端异常：' + e.message);
  } finally {
    try { chrome.kill(); } catch (e) {}
    try { server.close(); } catch (e) {}
  }
}

console.log('\n—— verify-1451：通过 ' + pass + ' / 失败 ' + fail + ' ——');
if (fail) process.exit(1);
process.exit(0);
