// ===== 专项脚本：来源标签 chip 去重——气泡正文不再在标签行重复渲染（v3.16.x） =====
// 用法：node build.mjs && node tools/verify-tag-chip-dedup.mjs
// 背景（用户反馈）：触发摸鱼抓包后，联系人消息=「字卡一行」+下一行「[摸鱼抓包] 同一句字卡」，
//   内容重复。修复：renderMsg 渲染 rec.mood 时，label 与气泡正文完全相同的来源标签 chip
//   （opts.tag 生成）只渲染 chip、不再重复右侧文案；真实情绪字卡（label≠正文）不受影响。
// 验证：
//   A 组静态（读 src）：chat.js 两处 mood 渲染（聊天 renderMsg + 收藏详情）均带去重判断。
//   B 组运行时（构建产物）：chatAddIn(…,{tag:'摸鱼抓包'}) → 气泡正文出现一次、
//     标签行只剩 chip 无同文；真实情绪 mood（label≠正文）照常渲染 tag+label；
//     刷新持久化后仍正确；全程无 JS 异常。

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// ---------------- A 组：静态断言 ----------------
const chatSrc = readFileSync(join(root, 'src', 'js', 'chat.js'), 'utf8');
check('A1 聊天 renderMsg mood 渲染带同文去重（dupBody）', chatSrc.includes('const dupBody ='));
check('A2 收藏详情 mood 渲染带同文去重（dupFav）', chatSrc.includes('const dupFav ='));
check('A3 去重命中时只出 msg-mood-tag 不出 label span', /msg-mood-tag">\s*' \+ mt \+ '<\/span>' \+ \(dupBody \? '' : '<span>' \+ ml \+ '<\/span>'\)/.test(chatSrc));

if (!results.every(r => r.ok)) { console.log('\n静态断言未全绿，停止运行时验证'); process.exit(1); }

// ---------------- 运行时准备 ----------------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const { spawn } = await import('node:child_process');
const { createServer } = await import('node:http');
const { rmSync } = await import('node:fs');
const { normalize, extname } = await import('node:path');

const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const tmpProfile = join(process.env.TEMP || '/tmp', 'mochi-tagdedup-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + tmpProfile,
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} try { rmSync(tmpProfile, { recursive: true, force: true }); } catch (e) {} });

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
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 500)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);

const MARK = '被你抓包了……脸有点烫XYZ';
const OTHER = '情绪卡内容完全不同QWE';

// 找最后一条带指定 tag chip 的收件气泡，返回 {body, moodRow} 计数信息
const probe = `(function(){
  var out={};
  var msgs=[].slice.call(document.querySelectorAll('#chat-body .msg-in'));
  for(var i=msgs.length-1;i>=0;i--){
    var b=msgs[i].querySelector('.msg-bubble');if(!b)continue;
    var rows=[].slice.call(b.querySelectorAll('.msg-mood'));var hit=null;
    for(var j=0;j<rows.length;j++){var tg=rows[j].querySelector('.msg-mood-tag');if(tg&&tg.textContent==='摸鱼抓包'){hit=rows[j];break;}}
    if(!hit)continue;
    var bodyTxt=b.childNodes.length?b.textContent:'';
    out.bodyCount=bodyTxt.split(${JSON.stringify(MARK)}).length-1;
    out.rowText=hit.textContent;
    out.rowHasDup=hit.textContent.indexOf(${JSON.stringify(MARK)})>=0;
    return JSON.stringify(out);
  }
  return JSON.stringify({miss:true});
})()`;

// ---- B1 标签 chip：正文一次 + 标签行不再重复 ----
await evalJs("(function(){window.chatAddIn(" + JSON.stringify(MARK) + ", { tag: '摸鱼抓包' }); return 1;})()");
let b1 = {};
for (let t = 0; t < 6; t++) {
  await sleep(500);
  b1 = JSON.parse(await evalJs(probe) || '{}');
  if (!b1.miss && b1.bodyCount === 1 && !b1.rowHasDup) break;
}
check('B1 气泡正文渲染恰好一次', b1.bodyCount === 1, JSON.stringify(b1));
check('B2 标签行只剩「摸鱼抓包」chip、无重复文案', b1.rowText === '摸鱼抓包' && !b1.rowHasDup, JSON.stringify(b1));

// ---- B3 真实情绪 mood（label≠正文）照常渲染 tag+label ----
// 注：换独立正文文本——addRec 有 1200ms 同文去重守卫（chat.js），与 B1 同文会被吞
const MARK2 = '情绪气泡正文本身ZZZ';
await evalJs("(function(){window.chatAddIn(" + JSON.stringify(MARK2) + ", { mood: [{ tag: '情绪', label: " + JSON.stringify(OTHER) + " }] }); return 1;})()");
let b3 = {};
for (let t = 0; t < 6; t++) {
  await sleep(500);
  b3 = JSON.parse(await evalJs("(function(){var msgs=[].slice.call(document.querySelectorAll('#chat-body .msg-in'));for(var i=msgs.length-1;i>=0;i--){var b=msgs[i].querySelector('.msg-bubble');if(!b)continue;if(b.textContent.indexOf(" + JSON.stringify(MARK2) + ")<0)continue;var rows=[].slice.call(b.querySelectorAll('.msg-mood'));for(var j=0;j<rows.length;j++){var tg=rows[j].querySelector('.msg-mood-tag');if(!tg||tg.textContent!=='情绪')continue;return JSON.stringify({row:rows[j].textContent,hasOther:rows[j].textContent.indexOf(" + JSON.stringify(OTHER) + ")>=0});}}return '{}';})()") || '{}');
  if (b3.hasOther) break;
}
check('B3 真实情绪字卡 label 照常显示（tag+label 都在）', b3.hasOther === true && String(b3.row || '').indexOf('情绪') >= 0, JSON.stringify(b3));

// ---- B4 刷新持久化：rec.mood 存储不变，进聊天渲染仍不重复 ----
await sleep(1200);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);
await evalJs("(function(){try{window.enterChat();}catch(e){} return true;})()");
await sleep(1000);
let b4 = {};
for (let t = 0; t < 6; t++) {
  await sleep(500);
  b4 = JSON.parse(await evalJs(probe) || '{}');
  if (!b4.miss && b4.bodyCount === 1 && !b4.rowHasDup) break;
}
check('B4 重进聊天后标签行依旧只有 chip、正文一次', b4.bodyCount === 1 && !b4.rowHasDup, JSON.stringify(b4));
const persisted = await evalJs("(function(){var raw=localStorage.getItem(window.activePrefix()+':chat-msgs')||'';return raw.indexOf('摸鱼抓包')>=0?'persisted':'not-found';})()");
check('B5 标签随消息持久化未受影响', persisted === 'persisted', persisted);

// ---- B6 全程零 JS 异常（console.error 由 exceptionDetails 兜底，这里查页面错误钩子）----
const errs = await evalJs('window.__jsErrors ? window.__jsErrors.length : 0');
check('B6 运行时无 JS 异常', !errs, String(errs));

const pass = results.filter(r => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 项通过');
process.exit(pass === results.length ? 0 : 1);
