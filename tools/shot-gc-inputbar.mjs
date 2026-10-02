// 群聊输入栏统一改造验证：
// ① 群聊输入栏与普通聊天同构（更多功能/表情包/输入框/插入图片/发送，各 3 个图标按钮、等高）
// ② 更多功能面板打开 → @群成员 入口 → 成员面板 → 点选插入 @昵称
// ③ 文字发送 / 表情包面板复用（data: 与链接表情均可直接发出）
// ④ 截图对比两页输入栏
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

const cdpPort = 9800 + Math.floor(Math.random() * 150);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-shot-' + Date.now()),
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
          if (process.env.CDP_DEBUG && m.id) console.log('[raw]', m.id, JSON.stringify(m).slice(0, 200));
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => {
    pend.set(id, (r) => {
      if (r === undefined) console.error('[cdp-no-result]', method);
      else if (r && r.error) console.error('[cdp-error]', method, JSON.stringify(r.error));
      res(r);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
  // cdp 解析为完整消息：r.result = CDP result 字段，其内层 .result 才是 RemoteObject
  return r && r.result && r.result.result ? r.result.result.value : null;
}
let pass = 0, fail = 0;
function check(name, ok, extra) { if (ok) { pass++; console.log('PASS', name, extra || ''); } else { fail++; console.log('FAIL', name, extra || ''); } }

// 1x1 红色 png
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
// 页面加载前种入「我的表情包」（含一个链接表情，验证群聊发送放行 URL）+ 开启群聊桌面开关
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
  try {
    localStorage.setItem('xy-home-v2:default:my-emoji-groups', JSON.stringify([
      ['测试', ['${TINY_PNG}']],
      ['链接', ['https://example.com/sticker-url-test.png']]
    ]));
    localStorage.setItem('xy-home-v2:group-chat-enabled', '1');
  } catch (e) {}
` });

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2200);
await evalJs(`document.getElementById('splash-confirm-ok')?.click()`);
await sleep(800);

// ---- 打开普通聊天页（对比基准）----
await evalJs(`(function(){document.querySelectorAll('.page').forEach(p=>p.hidden=true);document.getElementById('page-chat').hidden=false;})()`);
await sleep(400);
const chatRow = await evalJs(`(() => {
  const row = document.querySelector('#page-chat .chat-input-row');
  const btns = [...row.querySelectorAll('.ch-input-btn')].filter(b => getComputedStyle(b).display !== 'none');
  const r = row.getBoundingClientRect();
  return JSON.stringify({ btnCount: btns.length, ids: [...row.children].map(c => c.id || c.className.split(' ')[0]), h: Math.round(r.height), bottom: Math.round(window.innerHeight - r.bottom) });
})()`);
console.log('[普通聊天]', chatRow);
const shotChat = await cdp('Page.captureScreenshot', { format: 'png' });
writeFileSync('tools/shot-gc-normal-chat.png', Buffer.from(shotChat.result.data, 'base64'));

// ---- 打开群聊页 ----
await evalJs(`(function(){document.querySelectorAll('.page').forEach(p=>p.hidden=true);document.getElementById('page-group-chat').hidden=false;})()`);
await sleep(400);
const gcRow = await evalJs(`(() => {
  const row = document.querySelector('#page-group-chat .chat-input-row');
  const btns = [...row.querySelectorAll('.ch-input-btn')].filter(b => getComputedStyle(b).display !== 'none');
  const r = row.getBoundingClientRect();
  return JSON.stringify({ btnCount: btns.length, ids: [...row.children].map(c => c.id || c.className.split(' ')[0]), h: Math.round(r.height), bottom: Math.round(window.innerHeight - r.bottom) });
})()`);
console.log('[群聊]    ', gcRow);
const cj = JSON.parse(chatRow), gj = JSON.parse(gcRow);
check('群聊输入栏与普通聊天同构（按钮数一致）', cj.btnCount === gj.btnCount && gj.btnCount === 3, 'chat=' + cj.btnCount + ' gc=' + gj.btnCount);
check('群聊输入栏高度与普通聊天一致', cj.h === gj.h, 'chat=' + cj.h + ' gc=' + gj.h);
check('群聊输入栏贴底位置一致', cj.bottom === gj.bottom, 'chat=' + cj.bottom + ' gc=' + gj.bottom);

// ---- 更多功能面板 → @流程 ----
await evalJs(`document.getElementById('gc-input-more-btn').click()`);
await sleep(300);
const moreOpen = await evalJs(`(() => {
  const p = document.getElementById('gc-more-panel');
  const at = document.getElementById('gc-more-at');
  return p && !p.hidden && at && at.textContent.indexOf('@群成员') >= 0;
})()`);
check('更多功能面板打开且含「@群成员」入口', !!moreOpen);
const shotMore = await cdp('Page.captureScreenshot', { format: 'png' });
writeFileSync('tools/shot-gc-more-panel.png', Buffer.from(shotMore.result.data, 'base64'));

await evalJs(`document.getElementById('gc-more-at').click()`);
await sleep(300);
const atState = await evalJs(`(() => {
  const mp = document.getElementById('gc-more-panel');
  const ap = document.getElementById('gc-at-panel');
  const items = ap ? ap.querySelectorAll('.gc-at-item').length : 0;
  return JSON.stringify({ moreHidden: mp.hidden, atOpen: ap && !ap.hidden, items });
})()`);
const atj = JSON.parse(atState);
check('@面板从更多功能打开（更多面板已收起）', atj.moreHidden && atj.atOpen && atj.items > 0, atState);

await evalJs(`(function(){var it=document.querySelector('#gc-at-panel .gc-at-item');if(it)it.click();})()`);
await sleep(300);
const atInserted = await evalJs(`document.getElementById('gc-input').innerText`);
check('点选成员插入 @昵称到输入框', /^@\S+\s?$/.test(atInserted || ''), JSON.stringify(atInserted));

// ---- 发送文字（带 @ 前缀一起发）----
await evalJs(`(function(){var i=document.getElementById('gc-input');i.innerText=i.innerText+'你好呀';})()`);
await evalJs(`document.getElementById('gc-send').click()`);
await sleep(400);
const sentText = await evalJs(`(() => {
  const msgs = document.querySelectorAll('#gc-body .msg-out .msg-bubble');
  const last = msgs[msgs.length - 1];
  return last ? last.textContent : '';
})()`);
check('文字消息发送成功（含 @昵称 + 正文）', (sentText || '').indexOf('你好呀') >= 0, JSON.stringify(sentText));
const draftHidden = await evalJs(`document.getElementById('gc-draft').hidden`);
check('发送后草稿条保持隐藏', draftHidden === true);

// ---- 表情包面板（复用聊天页面板）----
await evalJs(`document.getElementById('gc-emoji-btn').click()`);
await sleep(500);
const emojiState = await evalJs(`(() => {
  const ep = document.getElementById('emoji-panel');
  const modeOff = !document.body.classList.contains('mail-emoji-mode');
  const tabs = ep ? ep.querySelectorAll('.emoji-tab').length : 0;
  return JSON.stringify({ open: ep && !ep.hidden, bottomNormal: modeOff, tabs });
})()`);
const ej = JSON.parse(emojiState);
check('群聊打开聊天页同一个表情包面板', ej.open && ej.tabs >= 2, emojiState);
check('面板贴输入栏上方（无 mail-emoji-mode 压低）', ej.bottomNormal);
const shotEmoji = await cdp('Page.captureScreenshot', { format: 'png' });
writeFileSync('tools/shot-gc-emoji-panel.png', Buffer.from(shotEmoji.result.data, 'base64'));

// 切到「我的表情包」→ 点 data: 表情 → 应直接作为表情消息发出
await evalJs(`(function(){var t=document.querySelector('.emoji-tab[data-etab="mine"]');if(t)t.click();})()`);
await sleep(300);
// 面板设计：进入分组需先点分组 chip（「点击上方分组查看表情包」）→ 点「测试」分组
const chipData = await evalJs(`(function(){
  var chips=[...document.querySelectorAll('#emoji-groups *')].filter(function(e){return e.children.length===0&&e.textContent.trim();});
  var t=chips.find(function(c){return c.textContent.trim().indexOf('测试')===0;});
  if(t){t.click();return true;}
  return false;
})()`);
await sleep(300);
// 按 src 找到 data: 表情再点（分组栏渲染顺序不定，不能假设第一个 grid 就是目标）
const pickedData = await evalJs(`(function(){
  var imgs=[...document.querySelectorAll('#emoji-list .emoji-item img')];
  var t=imgs.find(function(im){return (im.getAttribute('src')||'').indexOf('data:image/png')===0;});
  if(t){t.closest('.emoji-item').click();return true;}
  return false;
})()`);
await sleep(400);
const stickerSent = await evalJs(`(() => {
  var imgs = document.querySelectorAll('#gc-body .msg-out .msg-bubble img.msg-img-sm');
  var last = imgs[imgs.length - 1];
  var ep = document.getElementById('emoji-panel');
  return JSON.stringify({ picked: ${pickedData}, count: imgs.length, isData: !!(last && last.src.indexOf('data:image/png') === 0), panelClosed: ep.hidden });
})()`);
const sj = JSON.parse(stickerSent);
check('点选 data: 表情直接发进群聊且面板关闭', sj.picked && sj.count >= 1 && sj.isData && sj.panelClosed, stickerSent + ' chip=' + chipData);

// 再开面板 → 链接表情 → allowUrl 放行
await evalJs(`document.getElementById('gc-emoji-btn').click()`);
await sleep(400);
await evalJs(`(function(){var t=document.querySelector('.emoji-tab[data-etab="mine"]');if(t)t.click();})()`);
await sleep(250);
// 「链接」分组：切分组 chip 后点 URL 表情
const urlPick = await evalJs(`(function(){
  var chips=[...document.querySelectorAll('#emoji-groups .emoji-chip,#emoji-groups [class*=chip]')];
  var target=chips.find(function(c){return c.textContent.indexOf('链接')>=0;});
  if(target)target.click();
  return chips.length;
})()`);
await sleep(250);
const pickedUrl = await evalJs(`(function(){
  var imgs=[...document.querySelectorAll('#emoji-list .emoji-item img')];
  var t=imgs.find(function(im){return (im.getAttribute('src')||'').indexOf('https://example.com/')===0;});
  if(t){t.closest('.emoji-item').click();return true;}
  return false;
})()`);
await sleep(400);
const urlSent = await evalJs(`(() => {
  var imgs = document.querySelectorAll('#gc-body .msg-out .msg-bubble img.msg-img-sm');
  var last = imgs[imgs.length - 1];
  return JSON.stringify({ picked: ${pickedUrl}, total: imgs.length, lastIsUrl: !!(last && last.src.indexOf('https://example.com/') === 0) });
})()`);
const uj = JSON.parse(urlSent);
check('链接保存的表情在群聊可直接发送（allowUrl 生效）', uj.picked && uj.total >= 2 && uj.lastIsUrl, urlSent + ' chips=' + urlPick);

// ---- 插入图片按钮存在且可点（headless 不弹文件框，仅验证 handler 无异常）----
const imgBtnOk = await evalJs(`(() => {
  var b = document.getElementById('gc-img-btn');
  if (!b) return false;
  try { b.click(); } catch (e) { return false; }
  return true;
})()`);
check('插入图片按钮存在且点击无异常', !!imgBtnOk);

const shotGc = await cdp('Page.captureScreenshot', { format: 'png' });
writeFileSync('tools/shot-gc-input-final.png', Buffer.from(shotGc.result.data, 'base64'));

console.log('\\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
ws.close();
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);