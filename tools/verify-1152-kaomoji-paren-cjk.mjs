// ===== 专项验证：#1152 「戴括号的中文句子被判成颜文字卡 → 被 #1051 的硬换行从句子中间断开」 =====
// 用户实报：气泡里「咦」后面换行，第二行是「远(离我很远、或感觉疏离)」，
//   原话「为什么这个消息也自动换行了，我之前只要颜文字不被截断换行」。
// 根因：chat.js chatIsKaomojiCard 把「括号成对」这条规则放在可读性判定**之前**（#531 注释写的
//   「含中文/假名/字母/数字＝可读卡按原样归 text」在这张卡上没生效），于是任何带括号的中文句子
//   都进颜文字池；#1051 把末尾颜文字卡的连接符由空格改成 '\n'（escTxtBr → <br> 硬换行，
//   为的是治「末尾颜文字被裁＝显示不全」）＝这类句子卡被硬换行接在文字卡后面，句子中间断开。
// 修法（零机型分支）：括号规则加一道闸——含可读文字且不含颜文字面部符号＝文字卡不是颜文字卡；
//   判据收成 window.chatIsBracketedKaomojiCard 单一出口，群聊两处/默认字卡兜底一处共用。
// 断言面：
//   S1~S3＝单聊判据闸＋导出＋默认字卡兜底走同一判据；S4~S5＝群聊两条入池路径；
//   S6＝末尾颜文字与文字卡相接的接线仍在（#1212 后连接符为实测值，只拦「写死空格」）；
//   B1~B9＝判据行为（戴括号的中文句子→false；真颜文字（含带字母/无括号形态）→ 结果不变）；
//   C1＝真链路端到端：池里只有一张戴括号中文卡时，气泡＝该卡原文（无 <br>、无空文兜底前缀）；
//   C2＝对照组：文字卡＋真颜文字卡仍相接成一条气泡、且末尾颜文字未被裁（#1051 口径）。
// 本脚本经 #1212 改口径（原 S6/C2 把「连接符写死 '\n'」当判据；#1212 按用户澄清改成「行末放不下
//   才换行」，写死换行与写死空格同样是错的）：改后 S6/C2 在纯 HEAD 与本批两侧都应为绿＝对照组。
// 纯基线（HEAD 无本批）应恰红 S1~S5 ＋ B1~B9（基线没有 window.chatIsKaomojiCard 导出口）＋ C1 ＋ C3；
//   判别主力＝S 锚与 C1/C3 行为面（C2/S6 两侧皆绿＝#1051 对照组不许回退）。
// 用法：node tools/verify-1152-kaomoji-paren-cjk.mjs
//   红对照：MOCHI_ROOT=<纯 HEAD 副本> node tools/verify-1152-kaomoji-paren-cjk.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.MOCHI_ROOT
  ? normalize(process.env.MOCHI_ROOT)
  : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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
const udd = join(process.env.TEMP || '/tmp', 'mochi-1152-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 80));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + udd, '--remote-debugging-port=' + cdpPort, 'about:blank'
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
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r && r.exceptionDetails) { console.log('EVAL-ERR', JSON.stringify(r.exceptionDetails).slice(0, 200)); return null; }
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
const t = (n, c, d) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, d || ''); } };

// ===== S 组：产物静态锚（不依赖浏览器时序）=====
const readArt = (f) => { try { return readFileSync(join(root, 'js', f), 'utf8'); } catch (e) { return ''; } };
const art = { chat: readArt('chat.js'), gc: readArt('group-chat.js') };
t('S0 产物存在（js/chat.js + js/group-chat.js）', !!art.chat && !!art.gc, 'chat=' + art.chat.length + ' gc=' + art.gc.length);
const count = (s, needle) => s.split(needle).length - 1;
t('S1 括号判据含「戴括号的中文句子」排除闸', count(art.chat, '!(CHAT_READABLE_RE.test(c) && !CHAT_KAOMOJI_FACE_RE.test(c))') === 1,
  '命中=' + count(art.chat, '!(CHAT_READABLE_RE.test(c) && !CHAT_KAOMOJI_FACE_RE.test(c))'));
t('S2 判据导出为单一口径（window.chatIsBracketedKaomojiCard）', count(art.chat, 'window.chatIsBracketedKaomojiCard = chatIsBracketedKaomojiCard;') === 1,
  '命中=' + count(art.chat, 'window.chatIsBracketedKaomojiCard = chatIsBracketedKaomojiCard;'));
t('S3 单聊默认字卡兜底走同一判据', count(art.chat, 'else if (chatIsBracketedKaomojiCard(c)) kaomoji.push(c);') === 1,
  '命中=' + count(art.chat, 'else if (chatIsBracketedKaomojiCard(c)) kaomoji.push(c);'));
t('S4 群聊自建字卡分池走同一判据', count(art.gc, 'window.chatIsBracketedKaomojiCard ? window.chatIsBracketedKaomojiCard(c) :') === 1,
  '命中=' + count(art.gc, 'window.chatIsBracketedKaomojiCard ? window.chatIsBracketedKaomojiCard(c) :'));
t('S5 群聊默认字卡兜底走同一判据', count(art.gc, 'window.chatIsBracketedKaomojiCard ? window.chatIsBracketedKaomojiCard(card) :') === 1,
  '命中=' + count(art.gc, 'window.chatIsBracketedKaomojiCard ? window.chatIsBracketedKaomojiCard(card) :'));
// #1212 口径：连接符从「写死硬换行」改成「实测决定」（放得下用空格同行、放不下才 '\n'）。
// 本条只证「末尾颜文字仍然接在文字卡后面、且连接符由代码决定」＝两种形态都算在位；
// 唯一判红＝写死空格相接（#1051 原报障形态：软换行点被部分内核无视 → 末行显示不全）。
const JOIN_CHAT = [
  "reply += chatKaoJoinSep(reply, kj) + kj;", // #1212 实测连接符
  "reply += '\\n' + kj;", // #1051 无条件硬换行（本批之前的形态）
];
const JOIN_GC = [
  "t += (window.chatKaoJoinSep ? window.chatKaoJoinSep(t, gkj, page, body) : '\\n') + gkj;", // #1212
  "t += '\\n' + pick(pool.kaomoji);", // #1051
];
const hasJoin = (art, forms) => forms.some((n) => count(art, n) === 1);
t('S6 #1051 末尾颜文字与文字卡相接的接线在位（#1212 后连接符为实测值；写死空格＝#1051 复发判红）',
  hasJoin(art.chat, JOIN_CHAT) && hasJoin(art.gc, JOIN_GC)
    && count(art.chat, "reply += ' ' + kj") === 0 && count(art.gc, "t += ' ' + pick") === 0,
  'chat=' + JOIN_CHAT.map((n) => count(art.chat, n)).join('/') + ' gc=' + JOIN_GC.map((n) => count(art.gc, n)).join('/'));

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();return true;})()");
  await sleep(500);
  await evalJs("(function(){var c=document.getElementById('splash-confirm');if(c&&!c.hidden){var b=c.querySelector('#splash-confirm-ok');if(b)b.click();}return true;})()");
  await sleep(900);
  await evalJs("(function(){var a=document.querySelector('.tab[data-tab=\"chat\"]');if(a)a.click();return true;})()");
  await sleep(800);

  // ===== B 组：判据行为（走导出的单一出口，逐张卡问一遍）=====
  const CASES = [
    ['远(离我很远、或感觉疏离)', false], ['……（好像有谁轻轻应了一声）', false], ['下次一起(好)', false],
    ['(´･ω･`)', true], ['(^o^)', true], ['( ˘ ˘ )zZ', true], ['ᕙ(⇀‸↼‶)ᕗ', true], ['(¬‿¬)', true], ['QAQ', false]
  ];
  const bRaw = await evalJs('(function(){var cs=' + JSON.stringify(CASES) + ';var f=window.chatIsKaomojiCard;' +
    'if(typeof f!=="function")return null;' +
    'return JSON.stringify(cs.map(function(x){return !!f(x[0]);}));})()');
  const got = bRaw ? JSON.parse(bRaw) : null;
  CASES.forEach((x, i) => {
    t('B' + (i + 1) + ' chatIsKaomojiCard(' + JSON.stringify(x[0]) + ') = ' + x[1],
      !!got && got[i] === x[1], got ? '实际=' + got[i] : 'window.chatIsKaomojiCard 不可用');
  });

  // ===== C 组：真链路端到端（TA 生成回复 → 读落库气泡原文与气泡 HTML）=====
  const NOISE = { 'rn-prob': 0, 'touch-prob': 0, 'sticker-prob': 0, 'emoji-prob': 0, 'image-prob': 0, 'voice-prob': 0,
    'quote-prob': 0, 'rc-prob': 0, 'rc-refix': 0, 'cf-prob': 0, 'as-en': 0, 'call-incoming': 0,
    'ckq-en': 0, 'ai-rps-en': 0, 'ai-game-en': 0, 'ai-cuddle-en': 0, 'ai-cc-en': 0, 'desk-call-prob': 0,
    // #1203：本组测的是「颜文字卡的判别与硬换行相接」，而末尾追加颜文字卡已收进「多字卡回复」总开关
    //（关＝根本不追加＝C2 量不到 <br）。故开总开关、只把抽卡概率归零来锁住「一条气泡一张文字卡」形态，判据口径不变。
    'py-punct-en': 0, 'py-en': 1, 'py-prob': 0, 'rs-min': 1, 'rs-max': 2, 'reply-min': 1, 'reply-max': 1, 'kaomoji-prob': 100, 'csp-cust': 100 };
  const setup = (cards) => evalJs('(function(){var o=' + JSON.stringify(NOISE) + ';' +
    'for(var k in o)window.saveReplyCfg(k,o[k]);' +
    'window.getCustomCards=function(){return ' + JSON.stringify(cards) + ';};' +
    'window.getDefaultCardGroups=function(){return [];};' +
    'window.getDefaultCards=function(){return null;};' +
    'window.getReplyCard=function(){return "";};' +
    'window.quoteSpellPick=function(){return null;};window.dreamFreePick=function(){return null;};' +
    'window.tryTaMoodShare=function(){return null;};window.maybeMusicRequest=null;window.callMaybeTrigger=null;' +
    'window.maybeAutoGift=null;window.periodCheckCare=null;window.triggerEmotionChain=function(){return null;};' +
    'window.periodWarmText=null;' +
    'return true;})()');
  const C1CARD = '远(离我很远、或感觉疏离)';
  const readBubble = (marker) => evalJs("(function(){var ms=(window.getChatMsgs&&window.getChatMsgs())||[];" +
    "for(var i=ms.length-1;i>=0;i--){var r=ms[i];if(!r||r.side!=='in'||!r.text)continue;" +
    "if(String(r.text).indexOf(" + JSON.stringify(marker) + ")>=0){var sp=document.querySelectorAll('#chat-body .msg-in .msg-bubble');" +
    "var html='';for(var j=0;j<sp.length;j++){if(sp[j].innerText.indexOf(" + JSON.stringify(marker) + ")>=0){html=sp[j].innerHTML;break;}}" +
    "return JSON.stringify({text:String(r.text),html:html});}}" +
    "return null;})()");
  async function send(cards, marker) {
    await setup(cards);
    await evalJs("(function(){document.getElementById('chat-input').innerText='在吗';document.getElementById('chat-send').click();return true;})()");
    await sleep(9000);
    const raw = await readBubble(marker);
    return raw ? JSON.parse(raw) : null;
  }
  await evalJs('(function(){Math.random=function(){return 0.3;};return true;})()');

  // C1 池里只有「戴括号的中文句子」卡：它该是一张正常文字卡——原文整条出现、气泡内零硬换行
  const c1 = await send([C1CARD], C1CARD);
  t('C1 戴括号中文卡作为文字卡整条发出（无硬换行、无空文兜底前缀）',
    !!c1 && c1.text === C1CARD && c1.html.indexOf('<br>') < 0,
    c1 ? 'text=' + JSON.stringify(c1.text) + ' br=' + c1.html.indexOf('<br>') : '未找到该气泡');

  // C2 对照组：文字卡＋真颜文字卡仍是一张气泡两张卡（#851/#1051 不许回退成丢卡或两条气泡）。
  // #1212 后连接符不再写死：放得下＝同行空格、放不下＝'\n'（<br>），两种形态都算对；
  // 判红只剩「颜文字没接上/接成了第三条」与「同行但把气泡撑到横向溢出」（＝#1051 的末行显示不全）。
  const c2 = await send(['丙文字一张卡', '(◕‿◕)'], '丙文字一张卡');
  const c2over = await evalJs("(function(){var sp=document.querySelectorAll('#chat-body .msg-in .msg-bubble');" +
    "for(var i=sp.length-1;i>=0;i--){if(sp[i].textContent.indexOf('丙文字一张卡')>=0)" +
    "return String(sp[i].scrollWidth-sp[i].clientWidth);}return '-1';})()");
  t('C2 文字卡＋真颜文字卡仍相接成一条气泡，且末尾颜文字未被裁（#1051 口径＋#1212 实测连接符）',
    !!c2 && /^丙文字一张卡[ \n]\(◕‿◕\)$/.test(c2.text) && Number(c2over) <= 1,
    c2 ? 'text=' + JSON.stringify(c2.text) + ' overflow=' + c2over : '未找到该气泡');

  // C3 用户实报形态的端到端复现（不依赖导出口，纯基线也能跑）：池里同时有「咦呀一张卡」这张文字卡
  // 与「远(离我很远、或感觉疏离)」这张戴括号中文卡，kaomoji-prob=100。旧判定把后者当颜文字卡追加＝
  // 气泡里出现「文字卡\n远(…)」（＝报障的那条换行）；改后它只可能是整条正文＝气泡内零换行。
  const lastIn = () => evalJs("(function(){var ms=(window.getChatMsgs&&window.getChatMsgs())||[];" +
    "for(var i=ms.length-1;i>=0;i--){var r=ms[i];if(!r||r.side!=='in'||!r.text)continue;" +
    "return JSON.stringify({text:String(r.text)});}return null;})()");
  await setup(['咦呀一张卡', C1CARD]);
  await evalJs("(function(){document.getElementById('chat-input').innerText='在吗';document.getElementById('chat-send').click();return true;})()");
  await sleep(9000);
  {
    const raw = await lastIn();
    const c3 = raw ? JSON.parse(raw) : null;
    const txt = c3 ? c3.text : '';
    const broke = txt.indexOf('\n') >= 0 || txt.indexOf(C1CARD) > 0;
    t('C3 「文字卡＋戴括号中文卡」同池时句子不再被断开（用户实报形态）',
      !!c3 && !broke && (txt === C1CARD || txt === '咦呀一张卡'),
      c3 ? 'text=' + JSON.stringify(txt) : '未取到最新一条 in 气泡');
  }

  console.log(pass + ' 通过 / ' + fail + ' 失败');
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { rmSync(udd, { recursive: true, force: true }); } catch (e) {}
}
process.exitCode = fail ? 1 : 0;
