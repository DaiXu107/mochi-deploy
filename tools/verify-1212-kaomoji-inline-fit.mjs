// ===== 专项验证：#1212 「行末放得下的颜文字也跟着换行」→ 连接符交给排版引擎实测 =====
// 用户实报：「整理杂物 ⏎ (இωஇ) 为什么这个颜文字也换行了，我的意思是颜文字在一行的末尾无法显示完的
//   时候防止截断才换行」。
// 根因（零机型分支）：#1051 把「文字卡＋末尾颜文字卡」的连接符从空格改成 '\n'（escTxtBr → <br>）时
//   是**无条件**换行——只要命中追加（默认 kaomoji-prob 5%）就顶到下一行，完全不看行末放不放得下。
//   #1051 当年治的是「软换行点被部分内核无视 → 末行显示不全」，代价是短颜文字也永久单独一行。
// 修法：连接符由同内核自己量出来（chat.js chatKaoJoinSep）——拿气泡当前的真实可用宽排一次
//   「文字卡␣颜文字卡」，行数没多、气泡也没横向溢出＝放得下 → 用空格相接（同一行）；
//   多出一行或溢出（＝#1051 实报的「末行显示不全」形态）才回硬换行。量不到真实宽度
//   （聊天页还没布局/后台生成）保持 #1051 的安全形态＝硬换行。群聊借 window.chatKaoJoinSep 同一份测量。
// 断言面：
//   S1~S6＝本批接线锚（裁决行、宽度兜底、跨文件共用出口、单聊/群聊两个调用点、探针用完即摘）；
//   S7＝#1051b 的 chip 切分集恒含 '\n'（本批不许动数据层，两侧皆绿＝对照组）；
//   S8＝渲染层 '\n'→<br> 通路未改道（存量两行消息按原样显示；用户选定「只管新消息」）；
//   B1~B7（含 B1b）＝window.chatKaoJoinSep 行为表（宽容器短文字→' '；长文字/窄容器/超长颜文字→'\n'；
//     无布局→'\n'；空颜文字→'\n'；探针不残留；同一对文本随容器加宽从 '\n' 翻成 ' '＝换行由几何决定，
//     不是写死的，这条是打回「无条件硬换行」的主力判别）；
//   C1＝用户实报形态端到端（真入口发消息 → 「整理杂物 (இωஇ)」同行、零 <br>、气泡不横向溢出）；
//   C2＝对照组（末尾卡宽过整行、行末放不下时仍硬换行，#1051 不许回退成截断）；
//   C3＝两张卡的「多字卡回复」chip 不因连接符改道而丢（#851 口径）。
// 纯基线（HEAD 无本批）应恰红 S1~S6 ＋ B1~B7 ＋ C1；C2/C3/S7/S8 两侧皆绿＝对照组。
//   判别主力＝B6（几何决定换行）与 C1（用户实报形态）。
// 用法：node tools/verify-1212-kaomoji-inline-fit.mjs
//   红对照：MOCHI_ROOT=<纯 HEAD 副本> node tools/verify-1212-kaomoji-inline-fit.mjs
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
const udd = join(process.env.TEMP || '/tmp', 'mochi-1212-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 80));
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

// ===== S 组：产物静态锚（不需要浏览器）=====
const readArt = (f) => { try { return readFileSync(join(root, 'js', f), 'utf8'); } catch (e) { return ''; } };
const art = { chat: readArt('chat.js'), gc: readArt('group-chat.js') };
const count = (s, needle) => s.split(needle).length - 1;
t('S0 产物存在（js/chat.js + js/group-chat.js）', !!art.chat && !!art.gc, 'chat=' + art.chat.length + ' gc=' + art.gc.length);
t('S1 裁决行在位：行数变多或横向溢出才换行，否则同行', count(art.chat, "return (h2 > h1 || o2 > o1 + 1) ? '\\n' : ' ';") === 1,
  '命中=' + count(art.chat, "return (h2 > h1 || o2 > o1 + 1) ? '\\n' : ' '"));
t('S2 量不到真实宽度时回安全形态（硬换行），不赌排版', count(art.chat, "if (!page || !(bw > 0)) return '\\n';") === 1,
  '命中=' + count(art.chat, "if (!page || !(bw > 0)) return '\\n';"));
t('S3 单聊把同一份测量导出给群聊（不写第二份）', count(art.chat, 'window.chatKaoJoinSep = chatKaoJoinSep;') === 1,
  '命中=' + count(art.chat, 'window.chatKaoJoinSep = chatKaoJoinSep;'));
t('S4 单聊连接点走实测（写死换行＝放得下也换行，写死空格＝末行被裁，两种回退都判红）', count(art.chat, "reply += chatKaoJoinSep(reply, kj) + kj;") === 1,
  '命中=' + count(art.chat, "reply += chatKaoJoinSep(reply, kj) + kj;"));
t('S5 群聊连接点走实测且传自己的页/容器', count(art.gc, 'window.chatKaoJoinSep(t, gkj, page, body)') === 1,
  '命中=' + count(art.gc, 'window.chatKaoJoinSep(t, gkj, page, body)'));
t('S6 探针用完即摘（同一任务内插→量→移除，不上屏）', count(art.chat, 'if (probe.parentNode === page) page.removeChild(probe);') === 1,
  '命中=' + count(art.chat, 'if (probe.parentNode === page) page.removeChild(probe);'));
t('S7 #1051b 数据层不变式未被打回：chip 切分集恒含硬换行', count(art.chat, "if (seps.indexOf('\\n') < 0) seps.push('\\n');") >= 1,
  '命中=' + count(art.chat, "if (seps.indexOf('\\n') < 0) seps.push('\\n');"));
t('S8 渲染层未改道：text 里的换行仍逐行译成 <br>（存量「两行」旧消息照原样显示）', count(art.chat, ".replace(/\\n/g, '<br>')") >= 1,
  '命中=' + count(art.chat, ".replace(/\\n/g, '<br>')"));

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
  // 本批判据要量真实几何 ⇒ 聊天页必须真的可见（tabbar 只有 手机/字卡/设置 三枚，聊天页是桌面
  // 子页；#page-chat 在 hidden 下所有宽度为 0，helper 会走「量不到→硬换行」的安全形态）。
  // 用 app 自己的入口 window.enterChat()（bg-keep/call/cjian 都这么调），不手改页面 hidden。
  await evalJs("(function(){if(typeof window.enterChat==='function')window.enterChat();return true;})()");
  await sleep(1200);
  {
    const vis = await evalJs("(function(){var p=document.getElementById('page-chat');return p&&!p.hidden?String(p.clientWidth):'0';})()");
    t('V0 聊天页已真正打开（页面有宽度可量）', Number(vis) > 100, 'page-chat clientWidth=' + vis);
  }

  // ===== B 组：window.chatKaoJoinSep 行为表（自造定宽容器，走真排版引擎）=====
  // 容器：#page-chat 内一个 padding:0 的定宽 div（helper 读它的 clientWidth 当气泡可用宽）。
  // 同一次调用里顺带数「页内直接子节点里残留的 .msg 探针」＝探针用完即摘的行为面证据。
  const SEP = (boxStyle, text, kj, useDefault) => evalJs('(function(){' +
    'var f=window.chatKaoJoinSep; if(typeof f!=="function")return "NOFN";' +
    'var page=document.getElementById("page-chat");' +
    'var old=document.getElementById("t1212box"); if(old)old.parentNode.removeChild(old);' +
    'var box=document.createElement("div"); box.id="t1212box";' +
    'box.setAttribute("style","' + boxStyle + '"); page.appendChild(box);' +
    'var before=page.querySelectorAll(":scope > .msg").length;' +
    // useDefault＝不传页/容器，走 helper 自己的默认（单聊调用形态：量 #page-chat + 聊天窗口真实宽）
    'var r=' + (useDefault ? 'f(' + JSON.stringify(text) + ',' + JSON.stringify(kj) + ');'
      : 'f(' + JSON.stringify(text) + ',' + JSON.stringify(kj) + ',page,box);') +
    'var after=page.querySelectorAll(":scope > .msg").length;' +
    'page.removeChild(box);' +
    'return JSON.stringify({sep:r,left:before+after});})()');
  const WIDE = 'width:320px;padding:0';
  const NARROW = 'width:120px;padding:0';
  const HIDDEN = 'width:320px;padding:0;display:none';
  // SEP 返回的是字符串（找不到导出口时是 "NOFN"），一律走 P() 安全解析：红侧要的是「断言判红」，不是整脚本抛错。
  const P = (s2) => { try { const o = JSON.parse(s2); return o && typeof o === "object" ? o : null; } catch (e) { return null; } };
  const SP = (raw) => P(raw) || {};
  const SHORT = '整理杂物';
  const LONG = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十';
  const KAO = '(இωஇ)';
  const KAO2 = '(◕‿◕)(◕‿◕)(◕‿◕)(◕‿◕)(◕‿◕)(◕‿◕)(◕‿◕)';
  const BIGKAO = '(╯°□°）╯︵ ┻━┻ ʕ•ᴥ•ʔ ٩(◕‿◕)۶ (ノ゜Д゜)ノ';

  const b1 = await SEP(WIDE, SHORT, KAO);
  t('B1 宽容器＋短文字＋短颜文字 → 同行空格（#1212 主诉求）', SP(b1).sep === ' ', b1 || 'window.chatKaoJoinSep 不可用');
  const b1c = await SEP(WIDE, SHORT, '', true);
  t('B1b 探针用完即摘：每次调用后页内不留 .msg 探针', SP(b1).left === 0 && SP(b1c).left === 0,
    'left=' + (b1 ? SP(b1).left : 'null'));
  const b2 = await SEP(NARROW, LONG, KAO);
  t('B2 窄容器＋长文字（行末放不下）→ 硬换行', SP(b2).sep === '\n', b2 || 'NOFN');
  const b3 = await SEP(HIDDEN, SHORT, KAO);
  t('B3 容器没有布局（clientWidth=0）→ 回安全形态硬换行', SP(b3).sep === '\n', b3 || 'NOFN');
  const b4 = await SEP(WIDE, SHORT, '');
  t('B4 空颜文字 → 不参与测量，返回硬换行（上层本就不会追加空卡）', SP(b4).sep === '\n', b4 || 'NOFN');
  const b5 = await SEP(NARROW, SHORT, BIGKAO);
  t('B5 颜文字本身超出容器可用宽 → 硬换行（同行必定放不下）', SP(b5).sep === '\n', b5 || 'NOFN');
  // B6＝单调性：同一对文字/颜文字，容器由窄变宽必须能从换行翻成同行——写死任何一种形态都会红。
  const b6n = await SEP('width:150px;padding:0', LONG, KAO);
  const b6w = await SEP('width:320px;padding:0', LONG, KAO);
  t('B6 同一对文本随容器加宽从换行翻成同行（换行由几何决定，不是写死的）',
    b6n && SP(b6n).sep === '\n' && SP(b6w).sep === ' ',
    'narrow=' + (b6n ? JSON.stringify(SP(b6n).sep) : 'null') + ' wide=' + (b6w ? JSON.stringify(SP(b6w).sep) : 'null'));
  // B7＝默认参数路径（单聊调用形态：不传页/容器，helper 自己量 #page-chat + 聊天窗口真实气泡宽）
  const b7 = await SEP(WIDE, SHORT, KAO, true);
  t('B7 默认参数路径（单聊调用形态）也判同行', SP(b7).sep === ' ', b7 || 'NOFN');

  // ===== C 组：真链路端到端（发消息 → TA 生成回复 → 读落库原文与气泡几何）=====
  const NOISE = { 'rn-prob': 0, 'touch-prob': 0, 'sticker-prob': 0, 'emoji-prob': 0, 'image-prob': 0, 'voice-prob': 0,
    'quote-prob': 0, 'rc-prob': 0, 'rc-refix': 0, 'cf-prob': 0, 'as-en': 0, 'call-incoming': 0,
    'ckq-en': 0, 'ai-rps-en': 0, 'ai-game-en': 0, 'ai-cuddle-en': 0, 'ai-cc-en': 0, 'desk-call-prob': 0,
    'py-punct-en': 0, 'py-en': 1, 'py-prob': 0, 'rs-min': 1, 'rs-max': 2, 'reply-min': 1, 'reply-max': 1,
    'kaomoji-prob': 100, 'csp-cust': 100 };
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
  // 气泡文本一律读 textContent：本无头环境里已渲染气泡的 span 读 innerText 会拿到空串
  //   （实测同节点 textContent 有字、innerText 为 ''），用 innerText 找气泡＝永远找不到、断言空过。
  const readLast = (marker) => evalJs("(function(){var ms=(window.getChatMsgs&&window.getChatMsgs())||[];" +
    "var hit=null;for(var i=ms.length-1;i>=0;i--){var r=ms[i];if(r&&r.side==='in'&&r.text&&String(r.text).indexOf(" +
    JSON.stringify(marker) + ")>=0){hit=r;break;}}" +
    "if(!hit)return null;" +
    "var sp=document.querySelectorAll('#chat-body .msg-in .msg-bubble span');var bub=null;" +
    "for(var j=0;j<sp.length;j++){if(sp[j].textContent.indexOf(" + JSON.stringify(marker) + ")>=0){bub=sp[j].closest('.msg-bubble')||sp[j].parentNode;break;}}" +
    "if(!bub)return JSON.stringify({text:String(hit.text),bub:false,sp:sp.length," +
    "vis:(function(){var p=document.getElementById('page-chat');return p&&!p.hidden?1:0;})()});" +
    "return JSON.stringify({text:String(hit.text),html:sp[j].innerHTML,br:sp[j].innerHTML.indexOf('<br>')," +
    "ov:bub.scrollWidth-bub.clientWidth,bub:true});})()");
  async function send(cards, marker) {
    await setup(cards);
    await evalJs("(function(){document.getElementById('chat-input').innerText='在吗';document.getElementById('chat-send').click();return true;})()");
    await sleep(9000);
    const raw = await readLast(marker);
    if (!raw) return null;
    const o = JSON.parse(raw);
    o._raw = raw.slice(0, 200);
    return o;
  }
  await evalJs('(function(){Math.random=function(){return 0.3;};return true;})()');

  // C1 用户实报形态：短文字卡＋短颜文字卡 → 同一行、零 <br>、气泡不横向溢出。
  const c1 = await send([SHORT, KAO], SHORT);
  t('C1 「整理杂物」＋短颜文字同一行（用户实报形态；HEAD 无条件换行此处应红）',
    !!c1 && c1.bub && c1.text === SHORT + ' ' + KAO && c1.br < 0 && c1.ov <= 1,
    c1 ? 'text=' + JSON.stringify(c1.text) + ' br=' + c1.br + ' ov=' + c1.ov + ' RAW=' + c1._raw : '未取到该气泡');

  // C2 对照组：末尾卡本身就宽过整行（重复 7 组面部符号，宽 > 气泡可用宽）→ 行末必然放不下 →
  //   仍硬换行；且换行后 <br> 在颜文字之前（＝#1051 的「末行显示不全」不许回来）。
  const c2 = await send([LONG, KAO2], LONG);
  t('C2 行末放不下时仍硬换行且末尾颜文字完整可见（#1051 不回退）',
    !!c2 && c2.bub && new RegExp('\\n' + KAO2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$').test(c2.text) && c2.br >= 0 && c2.ov <= 1,
    c2 ? 'text=' + JSON.stringify(c2.text) + ' br=' + c2.br + ' ov=' + c2.ov + ' RAW=' + c2._raw : '未取到该气泡');

  // C3 对照：连接符改道不影响「一条气泡两张卡 → 挂多字卡回复 chip」（#851 口径）。
  const c3 = await evalJs("(function(){var ms=(window.getChatMsgs&&window.getChatMsgs())||[];" +
    "for(var i=ms.length-1;i>=0;i--){var r=ms[i];if(r&&r.side==='in'&&r.text&&r.text.indexOf(" + JSON.stringify(SHORT) + ")>=0)" +
    "return JSON.stringify((r.mood||[]).map(function(x){return x.tag;}));}return null;})()");
  const chips3 = c3 ? JSON.parse(c3) : null;
  t('C3 同行形态的两张卡仍挂「多字卡回复」chip（#851 chip 判据不受连接符影响）',
    !!chips3 && chips3.indexOf('多字卡回复') >= 0, 'chip=' + JSON.stringify(chips3 || null));

  console.log(pass + ' 通过 / ' + fail + ' 失败');
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { rmSync(udd, { recursive: true, force: true }); } catch (e) {}
}
process.exitCode = fail ? 1 : 0;
