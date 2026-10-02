// ===== 专项验证：#1191 「()」这类空括号壳被判成颜文字卡 → 被 #1051 的硬换行接在文字卡后面单独成一行 =====
// 用户实报（#1152 之后仍复发）：「换行还是有问题为什么／【背包 ⏎ ()】这个内容也自动换行」。
// 根因：#1152 只挡住了「括号里装着中文句子」（含可读文字＝文字卡），而 "()"、"（）"、"( )" 这类
//   空壳既无可读文字也无颜文字面部符号，chatIsBracketedKaomojiCard 的「括号成对」条仍成立
//   ＝进颜文字池；genReplyText 末尾颜文字用硬换行相接（#1051 把连接符空格改成换行，为治
//   「末尾颜文字被裁＝显示不全」）→ 气泡两行「背包 / ()」。
// 修法（零机型分支，与用户选定口径「不算颜文字，整条一行」一致）：括号判据再加一道闸——
//   把括号与空白全剥掉后什么都不剩＝壳不是脸 → 回落成普通文字卡（颜文字池空＝没有末尾卡可接行）。
//   群聊两处入池路径借同一导出判据（window.chatIsBracketedKaomojiCard），本批不写第二份括号规则。
// 断言面：
//   S1＝产物里壳闸在位；S2＝壳闸与 #1152 中文句子闸同条判据里的先后次序；S3＝#1152 闸未被本批换掉；
//   S4＝末尾颜文字与文字卡相接的接线在位（#1212 后连接符为实测值，只拦「写死空格」，两侧皆绿）；
//   S5＝群聊仍借同一判据；
//   B1~B12＝判据行为（空壳/中文卡→false；真颜文字各种形态→true 且结果与改前逐条不变）；
//   C1＝用户实报形态端到端（「背包」＋"()" 同池 → 气泡「背包」零 <br>）；
//   C2＝全角空括号（）同口径；C3＝对照组：文字卡＋真颜文字仍相接成一条气泡、末尾未被裁。
// 纯基线（HEAD 无本批）应恰红 S1/S2 ＋ B1~B3（"()"、"（）"、"( )" 被判 true）＋ C1 ＋ C2；
//   判别主力＝S1/S2 锚与 C1/C2 行为面。
// 本脚本经 #1212 改口径：原 S4/C3 把「连接符写死 '\n'」当判据，而 #1212 按用户澄清（「行末放不下、
//   防止截断才换行」）把连接符交给实测——写死换行与写死空格同样是错的，故两条改为形态无关的对照。
// 用法：node tools/verify-1191-empty-bracket-kaomoji.mjs
//   红对照：MOCHI_ROOT=<纯 HEAD 副本> node tools/verify-1191-empty-bracket-kaomoji.mjs
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
const udd = join(process.env.TEMP || '/tmp', 'mochi-1191-' + Date.now());
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
const N_SHELL = '!CHAT_BRACKET_SHELL_RE.test(c) &&';
const N_CJK = '!(CHAT_READABLE_RE.test(c) && !CHAT_KAOMOJI_FACE_RE.test(c))';
t('S1 括号判据含「空括号壳」排除闸', count(art.chat, N_SHELL) === 1,
  '命中=' + count(art.chat, N_SHELL));
t('S2 壳闸与 #1152 中文句子闸同在这条判据里（先后次序＝两条闸都在同一条 return 上）',
  art.chat.indexOf(N_SHELL) > 0 && art.chat.indexOf(N_CJK) > art.chat.indexOf(N_SHELL), '');
t('S3 #1152 的「戴括号中文句子」闸仍在（本批不许把它换掉）', count(art.chat, N_CJK) === 1,
  '命中=' + count(art.chat, N_CJK));
// #1212 口径：连接符从「写死硬换行」改成「实测决定」（放得下同行空格、放不下才 '\n'）。
// 本条只证「末尾颜文字仍接在文字卡后面、连接符由代码决定」，两种形态都算在位；
// 唯一判红＝写死空格相接（#1051 原报障形态：软换行点被部分内核无视 → 末行显示不全）。
const JOIN_CHAT = ["reply += chatKaoJoinSep(reply, kj) + kj;", "reply += '\\n' + kj;"];
const JOIN_GC = ["t += (window.chatKaoJoinSep ? window.chatKaoJoinSep(t, gkj, page, body) : '\\n') + gkj;", "t += '\\n' + pick(pool.kaomoji);"];
const hasJoin = (art, forms) => forms.some((n) => count(art, n) === 1);
t('S4 末尾颜文字与文字卡相接的接线在位（#1212 后连接符为实测值；写死空格＝#1051 复发判红）',
  hasJoin(art.chat, JOIN_CHAT) && hasJoin(art.gc, JOIN_GC)
    && count(art.chat, "reply += ' ' + kj") === 0 && count(art.gc, "t += ' ' + pick") === 0,
  'chat=' + JOIN_CHAT.map((n) => count(art.chat, n)).join('/') + ' gc=' + JOIN_GC.map((n) => count(art.gc, n)).join('/'));
t('S5 群聊借同一判据（本批不写第二份括号规则）', count(art.gc, 'window.chatIsBracketedKaomojiCard ? window.chatIsBracketedKaomojiCard(c) :') === 1,
  '命中=' + count(art.gc, 'window.chatIsBracketedKaomojiCard ? window.chatIsBracketedKaomojiCard(c) :'));

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

  // ===== B 组：判据行为（走 window.chatIsKaomojiCard 单一出口）=====
  const CASES = [
    ['()', false], ['（）', false], ['( )', false], ['【】', false],
    ['背包', false], ['远(离我很远、或感觉疏离)', false], ['(开心)', false],
    ['(￣▽￣)', true], ['(¬‿¬)', true], ['( ˘ ˘ )zZ', true], ['ᕙ(⇀‸↼‶)ᕗ', true], ['(*´▽`*)', true]
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
    // #1203：同 1152——末尾追加颜文字卡已收进「多字卡回复」总开关，本组要测的就是那条追加链路，
    // 故开总开关、只把抽卡概率归零（py-prob=0）锁住「一张文字卡」形态，判据口径不变。
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
  const lastIn = () => evalJs("(function(){var ms=(window.getChatMsgs&&window.getChatMsgs())||[];" +
    "var txt=null;for(var i=ms.length-1;i>=0;i--){var r=ms[i];if(r&&r.side==='in'&&r.text){txt=String(r.text);break;}}" +
    "if(txt===null)return null;" +
    "var sp=document.querySelectorAll('#chat-body .msg-in .msg-bubble');" +
    "var html=sp.length?sp[sp.length-1].innerHTML:'';" +
    "return JSON.stringify({text:txt,html:html});})()");
  async function send(cards) {
    await setup(cards);
    await evalJs("(function(){document.getElementById('chat-input').innerText='在吗';document.getElementById('chat-send').click();return true;})()");
    await sleep(9000);
    const raw = await lastIn();
    return raw ? JSON.parse(raw) : null;
  }
  await evalJs('(function(){Math.random=function(){return 0.3;};return true;})()');

  // C1 用户实报形态：池＝「背包」＋空括号卡「()」，kaomoji-prob=100。
  //   旧判据把 () 收进颜文字池 → 气泡「背包\n()」＝报障的那两行；改后 () 是一张文字卡，
  //   颜文字池空＝没有末尾卡可接 → 气泡只有「背包」一行、零 <br>。
  const c1 = await send(['背包', '()']);
  t('C1 「背包」＋空括号卡同池时不再被硬换行断开（用户实报形态）',
    !!c1 && c1.text === '背包' && c1.html.indexOf('<br>') < 0,
    c1 ? 'text=' + JSON.stringify(c1.text) + ' br=' + c1.html.indexOf('<br>') : '未取到最新一条 in 气泡');

  // C2 全角空括号同形态（字卡库里的 （） 与 () 同族）
  const c2 = await send(['背包', '（）']);
  t('C2 全角空括号（）同口径不再断开',
    !!c2 && c2.text === '背包' && c2.html.indexOf('<br>') < 0,
    c2 ? 'text=' + JSON.stringify(c2.text) + ' br=' + c2.html.indexOf('<br>') : '未取到最新一条 in 气泡');

  // C3 对照组：文字卡＋真颜文字卡仍是一张气泡两张卡（#851/#1051 不许回退成丢卡）。
  // #1212 后连接符不再写死：行末放得下＝同行、放不下才换行，两种形态都算对；判红＝颜文字没接上、
  // 或同行把气泡撑到横向溢出（＝#1051 的「末尾显示不全」）。
  const c3 = await send(['背包', '(◕‿◕)']);
  const c3over = await evalJs("(function(){var sp=document.querySelectorAll('#chat-body .msg-in .msg-bubble');" +
    "for(var i=sp.length-1;i>=0;i--){if(sp[i].textContent.indexOf('背包')>=0)" +
    "return String(sp[i].scrollWidth-sp[i].clientWidth);}return '-1';})()");
  t('C3 文字卡＋真颜文字卡仍相接成一条气泡，且末尾颜文字未被裁（#1051 口径＋#1212 实测连接符）',
    !!c3 && /^背包[ \n]\(◕‿◕\)$/.test(c3.text) && Number(c3over) <= 1,
    c3 ? 'text=' + JSON.stringify(c3.text) + ' overflow=' + c3over : '未取到最新一条 in 气泡');

  console.log(pass + ' 通过 / ' + fail + ' 失败');
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { rmSync(udd, { recursive: true, force: true }); } catch (e) {}
}
process.exitCode = fail ? 1 : 0;
