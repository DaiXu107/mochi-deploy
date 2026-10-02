// ===== 专项验证：来源标签 chip（opts.tag）与正文重复时不重复渲染字卡 =====
// 用户反馈：触发摸鱼抓包后，聊天里「抓包回应字卡一行 + [摸鱼抓包]标签行同文一行」内容重复。
// 修复（chat.js v3.16.x）：renderMsg / 收藏视图渲染 mood 行时，label===正文 → 只留标签胶囊；
// 真实情绪/心意/交流意图字卡 label≠正文不受影响。
// #677：opts.tagExtra 附加来源 chip 与 opts.tag 并列（两枚同时渲染、持久化）。
// #726：词典逐卡连发不再挂「多字卡回复」来源 chip（T9 真实链路）；单气泡拼字保持两枚并列（T10）。
// 用法：node tools/verify-tag-chip-dedupe.mjs（自组装 src 页面，不依赖构建产物）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function read(p) { return readFileSync(join(root, p), 'utf8'); }
const buildSrc = read('build.mjs');
function arrOf(name) {
  const m = buildSrc.match(new RegExp('const ' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\]'));
  return m ? m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];
}
const cssFiles = arrOf('cssFiles'), jsFiles = arrOf('jsFiles');
let css = '', js = '';
for (const f of cssFiles) { try { css += read('src/css/' + f) + '\n'; } catch (e) {} }
for (const f of jsFiles) { try { js += read('src/js/' + f) + '\n'; } catch (e) {} }
const tpl = read('src/template.html').replace(/__APP_VERSION__/g, 'test');
const page = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>' + css + '</style></head><body>' + tpl +
  '<scr' + 'ipt>window.__APP_VERSION__="test";</scr' + 'ipt>' +
  '<scr' + 'ipt>' + js + '</scr' + 'ipt></body></html>';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    if (req.url.split('?')[0] === '/blank.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body>blank</body></html>'); return; }
    if (req.url.split('?')[0] === '/test.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page); return; }
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

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const tmpDir = join(os.tmpdir(), 'mochi-tag-dedupe-' + Date.now());
const cdpPort = 10200 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + tmpDir, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} try { rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {} });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const pg = list.find((t) => t.type === 'page');
      if (pg) {
        ws = new WebSocket(pg.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { return { __exc: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text) }; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail && !ok ? '  [' + String(detail).slice(0, 300) + ']' : '')); }

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// 静态断言（读 src 源码）
const chatSrc = read('src/js/chat.js');
check('S1 renderMsg mood 行含 dupBody 去重分支', chatSrc.includes('dupBody'));
check('S2 收藏视图 mood 行含 dupFav 去重分支', chatSrc.includes('dupFav'));

// 种两条「旧版持久化格式」消息：A=标签 chip（label=正文，应去重）；B=真实情绪字卡（label≠正文，应保留 label）
// 走 activeStore 三写（memoryCache/LS/IDB），再整页重载让聊天从存储真实加载（首启欢迎语会覆盖预置 LS，WORKLOG 已知坑）
const SEED = `(function(){
  var st = window.activeStore(); if (!st) return 'no-store';
  var now = Date.now();
  var msgs=[
    {side:'in',text:'呀…被你看到了',ts:now-60000,mood:[{tag:'摸鱼抓包',label:'呀…被你看到了'}]},
    {side:'in',text:'今天聊得好开心呀',ts:now-30000,mood:[{tag:'情绪',label:'开心'}]}
  ];
  st.set('chat-msgs', JSON.stringify(msgs));
  return 'seeded';
})()`;

async function boot() {
  await cdp('Page.navigate', { url: baseUrl + '/test.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(400);
  await evalJs("(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return true;})()");
  await sleep(700);
  await evalJs("(function(){var m=document.getElementById('cc-scope-mask');if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();}return true;})()");
  await sleep(400);
}

await cdp('Page.navigate', { url: baseUrl + '/blank.html' });
await sleep(500);
await boot();
const seedR = await evalJs(SEED);
check('T0 存储层写入两条历史消息', seedR === 'seeded', String(seedR));
await boot();

// 点桌面聊天图标正常进聊天页
await evalJs("(function(){var a=document.querySelector('.app[data-app=chat]');if(a){a.click();return 'click';}document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat')});return 'force';})()");
await sleep(900);

const t1 = await evalJs(`(function(){
  var rows=Array.prototype.map.call(document.querySelectorAll('#page-chat .msg-mood'),function(x){
    return {tag:(x.querySelector('.msg-mood-tag')||{}).textContent||'',body:Array.prototype.map.call(x.querySelectorAll(':scope > span:not(.msg-mood-tag)'),function(s){return s.textContent}).join('|')};
  });
  return JSON.stringify(rows);
})()`);
let rows = [];
try { rows = JSON.parse(t1); } catch (e) {}

const chip = rows.find(r => r.tag === '摸鱼抓包');
check('T1 摸鱼抓包标签 chip 存在', !!chip, t1);
check('T2 标签右侧不再重复渲染同文字卡', chip && chip.body === '', chip ? chip.body : '(missing)');
const real = rows.find(r => r.tag === '情绪');
check('T3 真实情绪字卡 label 照常显示（开心）', real && real.body === '开心', real ? real.body : '(missing)');
const bubbles = await evalJs(`JSON.stringify(Array.prototype.map.call(document.querySelectorAll('#page-chat .msg-in .msg-bubble > span:first-child'),function(x){return x.textContent}))`);
check('T4 两条气泡正文本身不受影响', bubbles && bubbles.indexOf('呀…被你看到了') >= 0 && bubbles.indexOf('今天聊得好开心呀') >= 0, bubbles);

// 撤回详情折叠区仍能看到完整 tag：label（历史可追溯），不随展示层去重丢失
const recDetailKept = chatSrc.indexOf("escTxt(md.tag || '') + '：' + escTxt(md.label || '')") >= 0;
check('S3 撤回详情仍保留 tag：label 完整信息', recDetailKept);

// addIn opts.tag 新链路端到端：发一条带标签消息 → 只出现标签胶囊
await evalJs("(function(){try{window.chatAddIn('测试标签去重正文',{tag:'测试来源'});}catch(e){}return true;})()");
await sleep(500);
const t5 = await evalJs(`(function(){
  var rows=Array.prototype.map.call(document.querySelectorAll('#page-chat .msg-mood'),function(x){
    var tg=(x.querySelector('.msg-mood-tag')||{}).textContent||'';
    if(tg!=='测试来源') return null;
    return Array.prototype.map.call(x.querySelectorAll(':scope > span:not(.msg-mood-tag)'),function(s){return s.textContent}).join('|');
  }).filter(function(v){return v!==null});
  return JSON.stringify(rows);
})()`);
check('T5 chatAddIn(tag) 新消息同样只留标签不重复正文', t5 === '[""]', t5);

// #677 多字卡回复 tag：opts.tagExtra 附加来源 chip 与 opts.tag 并存（不替换词典/词典拼字 tag）
const chipsOf = (needle) => `(function(){
  var out=null;
  Array.prototype.forEach.call(document.querySelectorAll('#page-chat .msg-in .msg-bubble'),function(b){
    if((b.textContent||'').indexOf(${JSON.stringify(needle)})>=0){
      var mm=b.querySelector('.msg-moods');
      out=Array.prototype.map.call(mm?mm.querySelectorAll('.msg-mood-tag'):[],function(x){return x.textContent});
    }
  });
  return JSON.stringify(out);
})()`;

// #843 现行口径 + #773c 契约：夹具正文必须真是「两张卡空格相连」，否则重载归一化时
// pyChipDropIfSingle 会按「一条消息只有一段＝不是拼出来的多张」合法删掉「多字卡回复」chip（旧夹具用单段假文本＝T8 长期假红）
await evalJs("(function(){try{window.chatAddIn('今晚的月色真美 我有点想你了',{tag:'词典拼句',tagExtra:[{tag:'多字卡回复',label:''}],tagNoDup:true});}catch(e){}return true;})()");
await evalJs("(function(){try{window.chatAddIn('多字卡并存二段正文 第二张卡',{tag:'多字卡回复',tagNoDup:true});}catch(e){}return true;})()");
await sleep(500);
const t6 = await evalJs(chipsOf('今晚的月色真美'));
check('T6 词典拼句 tag 与多字卡回复 tag 同时渲染（并存不互斥）', t6 === '["词典拼句","多字卡回复"]', t6);
const t7 = await evalJs(chipsOf('多字卡并存二段正文'));
check('T7 只有多字卡回复时单独渲染一枚 chip', t7 === '["多字卡回复"]', t7);

// 持久化：重进聊天（整页重载 + 从存储真实加载）后两枚 chip 仍在
await cdp('Page.navigate', { url: baseUrl + '/blank.html' });
await sleep(400);
await boot();
await evalJs("(function(){var a=document.querySelector('.app[data-app=chat]');if(a){a.click();return 'click';}document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat')});return 'force';})()");
await sleep(900);
const t8 = await evalJs(chipsOf('今晚的月色真美'));
check('T8 重进聊天后两枚 chip 随消息持久化仍在', t8 === '["词典拼句","多字卡回复"]', t8);

// ===== #726 词典逐卡连发 不再挂「多字卡回复」来源 chip（走真实回复链路，不是造一条消息）=====
// 用户报障：字卡 tag 出现「词典逐卡连发」时，错误的也显示了「多字卡回复」的 tag。
// 根因：replyOnce 在 genOneReply 之后立刻取 pyMultiDrawn 挂 chip；词典拼字是「整条换血」——
//   逐卡连发每条气泡只装一张词典卡、来源就是词典，那枚 chip 标的是已被丢弃的那次多字卡抽卡。
// 断言：#726 逐卡连发批里任何一条气泡都不得出现「多字卡回复」；单气泡拼字（一条气泡多张卡，
//   #693 用户口径「可同时出现」）保持两枚 chip 并列——两侧都测，防本批把 #693 一起收掉。
const setReply = (obj) => evalJs('(function(){var o=' + JSON.stringify(obj) + ';for(var k in o){try{window.saveReplyCfg(k,o[k]);}catch(e){}}return true;})()');
// 前置：#319 系统内置字卡二级锁在干净 profile 里默认锁定＝getDefaultCardGroups('dict') 恒空
//   ＝拼字整条不触发（T9/T10 自 #319 起长期红即此因：断言测的是「没发生」，不是行为回归）
await evalJs("(function(){try{window.xyStore('xy-home-v2').set('cardlock-state','open');}catch(e){}document.dispatchEvent(new Event('mochi-cardlock-open'));return true;})()");
const lockOpen9 = await evalJs("(function(){try{return !!window.cardLockOpen();}catch(e){return false;}})()");
check('T9p 前置·二级锁已解锁（否则词典抽卡池恒空，T9/T10 全测「没发生」）', lockOpen9 === true, 'cardLockOpen=' + lockOpen9);
// 词典场景闸是 per-cid 键：聊天使用=开、聊天概率=100（否则拼字可能整条不触发、断言测的是「没发生」）
await evalJs("(function(){try{var s=window.activeStore();if(s){s.set('dict-use-chat','1');s.set('dict-overall-chat','100');}}catch(e){}return true;})()");
// py-prob=100 恒命中「多字卡回复」抽卡、py-min=py-max=2 → n>=2 必置位 pyMultiDrawn（＝修复前必挂 chip 的前置）
// qs-prob=100 拼字恒命中；rc-prob=0 防撤回把气泡换成墓碑；cs-normal=0 → count=1、delay 300~1000ms
await setReply({ 'py-en': 1, 'py-prob': 100, 'py-min': 2, 'py-max': 2, 'qs-en': 1, 'qs-prob': 100, 'rc-prob': 0, 'touch-prob': 0, 'rn-prob': 0 });
await evalJs("(function(){window.maybeMusicRequest=null;window.tryTaMoodShare=function(){return null;};window.periodCheckCare=null;window.triggerEmotionChain=function(){return null;};window.callMaybeTrigger=null;window.maybeAutoGift=null;return true;})()");
// 只贴一层 wrapper 强制拼字形态（one=true 单气泡 / false 逐卡连发），不动其它行为
const forceSpellForm = (one) => evalJs("(function(){var o=window.quoteSpellPick;window.quoteSpellPick=function(c){var r=o?o(c):null;if(r&&r.segs)r.one=" + one + ";return r;};return true;})()");
const inCount = () => evalJs("document.querySelectorAll('#chat-body .msg.msg-in').length");
const chipsAfter = (n0) => evalJs(`(function(){
  var all=[].slice.call(document.querySelectorAll('#chat-body .msg.msg-in'));
  return JSON.stringify(all.slice(${n0}).map(function(x){
    return [].map.call(x.querySelectorAll('.msg-mood-tag'),function(t){return t.textContent});
  }));
})()`);
const rowsOf = (s) => { try { return JSON.parse(s) || []; } catch (e) { return []; } };

await forceSpellForm(false);
const n9 = await inCount();
await evalJs('(function(){try{window.continueChat();}catch(e){}return true;})()');
await sleep(7000);
const t9 = await chipsAfter(n9);
const t9rows = rowsOf(t9).filter(r => r.indexOf('词典逐卡连发') >= 0);
check('T9a 真实链路发出词典逐卡连发批（≥1 条气泡带该 tag）', t9rows.length >= 1, t9);
// #843：连发每条气泡只装一张卡＝「词典」口径，玩法标记「词典逐卡连发」并列；#726 契约＝不得出现「多字卡回复」
check('T9b 逐卡连发每条气泡恰「词典」＋「词典逐卡连发」两枚，不出现「多字卡回复」', t9rows.length >= 1 && t9rows.every(r => r.length === 2 && r[0] === '词典' && r[1] === '词典逐卡连发'), t9);

await forceSpellForm(true);
const n10 = await inCount();
await evalJs('(function(){try{window.continueChat();}catch(e){}return true;})()');
await sleep(5000);
const t10 = await chipsAfter(n10);
const DICT_TAGS = ['词典', '词典拼字', '词典拼句', '词典拼词'];
// 单气泡拼字行＝带词典长度 tag、且不带「词典逐卡连发」（连发行的 #726 契约由 T9b 守）
const t10rows = rowsOf(t10).filter(r => r.indexOf('词典逐卡连发') < 0 && r.some(t => DICT_TAGS.indexOf(t) >= 0));
check('T10a 真实链路发出单气泡拼字（≥1 条气泡带词典长度 tag）', t10rows.length >= 1, t10);
// #693 口径：拼字 tag 永不被「多字卡回复」替换——每行必含词典 tag，其余至多一枚「多字卡回复」
check('T10b 单气泡拼字行词典 tag 恒在（不被多字卡回复替换），并列至多再加一枚「多字卡回复」（#693）', t10rows.every(r => r.some(t => DICT_TAGS.indexOf(t) >= 0) && r.every(t => DICT_TAGS.indexOf(t) >= 0 || t === '多字卡回复') && r.length <= 2), t10);

// 源码接线锚点：genOneReply 判定置位 + replyOnce 各分支挂 tag（防重写抹掉）
check('S4 多字卡置位按实际拼出的 segs.length（#773 收口旧「按掷出的 n」），且整条替换成一张卡时回冲', chatSrc.includes('if (segs.length >= 2) pyMultiDrawn = true;') && chatSrc.includes('t = replyWord; pyMultiDrawn = false;'));
check('S5 replyOnce 取用判定（词典单气泡/梦角换血不回冲）', chatSrc.includes('const pyMultiHit = pyMultiDrawn;'));
check('S6 词典单气泡/梦角分支并列挂 tagExtra（逐卡连发不挂见 S9）', (chatSrc.match(/tagExtra: pyMultiExtra,\r?\n/g) || []).length === 2 && !chatSrc.includes('tagExtra: si === 0 ? pyMultiExtra : null,'));
check('S7 普通回复路径挂多字卡回复 tag', chatSrc.includes("tag: pyMultiHit ? '多字卡回复' : undefined"));
check('S8 addIn 合并 opts.tag 与 opts.tagExtra 而非替换', chatSrc.includes('_tagMood ? _tagMood.concat(_tagExtra) : _tagExtra'));
// #843 后连发分支形态＝tag:'词典' + tagExtra 玩法标记；#726 契约按块级取证：整块不得引用 pyMultiExtra
const _lianfa = chatSrc.slice(chatSrc.indexOf('} else if (rep.spell) {'), chatSrc.indexOf('} else if (rep.mjFree) {'));
check('S9 #726 逐卡连发分支不挂「多字卡回复」（块内零 pyMultiExtra）＋#843 单卡挂「词典」与玩法 tagExtra 并列', _lianfa.includes("tag: '词典',") && _lianfa.includes("tagExtra: [{ tag: '词典逐卡连发', label: '' }]") && !_lianfa.includes('pyMultiExtra'), _lianfa.length + ' 字节');

const errs = await evalJs('JSON.stringify(window.__jsErrors || [])');
check('E1 全程无 JS 异常', errs === '[]', String(errs));

server.close();
try { chrome.kill(); } catch (e) {}
const pass = results.filter(r => r.ok).length;
console.log('----');
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
