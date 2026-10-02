// ===== 回归：后台通知「已看过消息重弹」修复（bg-keep.js v3.12.x 两道闸门） =====
// 用户反馈：刚聊完就切浏览器后台，回前台时系统通知栏弹出几分钟前已在聊天页看过的消息。
// 根因：bgNotifyCheck 只判断页面隐藏，对内容无记忆——切后台后保活定时器继续跑，
//       回复链/主动发送/查岗卡产出与刚才对话相同或延续的内容就原样再发通知。
// 修复：① 隐藏 <15s 过渡期不弹；② 与最近 30 分钟 TA 已说内容 / 最近 10 分钟已弹
//       通知相同的文本（归一化指纹）不再重弹。消息本体照常进聊天记录与角标。
//
// 用例：
//   T1 探针存在且结构完整（bgNotifyGateInfo）
//   T2 刚进聊天记录的 TA 消息文本 → dupInChat=true（会被闸门②拦下）
//   T3 30 分钟窗口外的旧消息 / 无关文本 → dupInChat=false（不误伤）
//   T4 页面可见态 → tooFreshHidden=true（当前状态本就不该发后台通知）
//   T5 dataURL/语音段归一化——带图消息与纯文字同指纹可去重
//   T6 bgNotifyCheck 接线完好（函数存在），页面加载无 JS 异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-bgnotify-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' —— ' + JSON.stringify(extra) : '')); }
}

try {
  await cdpConnect();
  const jsErrors = [];
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  ws.onmessage2 = null;
  // 收集运行时异常
  const rawHandler = ws.onmessage;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(JSON.stringify(m.params).slice(0, 200));
    if (rawHandler) rawHandler(ev);
  };

  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4500); // 等开屏/数据就绪

  console.log('\n== T1 探针存在且结构完整 ==');
  const probe = await evalJs(`(function(){ try { return typeof window.bgNotifyGateInfo === 'function' ? window.bgNotifyGateInfo('探针自检') : null; } catch(e){ return { err: String(e) }; } })()`);
  ok('bgNotifyGateInfo 可调用', !!probe && typeof probe === 'object' && !probe.err, probe);
  ok('返回字段齐全（hiddenForMs/tooFreshHidden/dupNotified/dupInChat）',
    probe && ['hiddenForMs', 'tooFreshHidden', 'dupNotified', 'dupInChat'].every(k => k in probe), probe);

  console.log('\n== T2 刚入记录的 TA 消息 → 自查豁免（#129 修正：探针按产品口径传 refTs=到达时刻） ==');
  await evalJs(`window.chatAddSystem && window.chatAddSystem('今晚一起去吃火锅呀'); true`);
  await sleep(120);
  const d2 = await evalJs(`window.bgNotifyGateInfo('今晚一起去吃火锅呀', undefined, Date.now())`);
  ok('刚到达的新消息不自查判重（不再被自己吞掉弹窗）', d2 && d2.dupInChat === false, d2);

  console.log('\n== T2b 第二条相同文本（超过 2.5s 新鲜窗后到达）→ 真重复仍被拦 ==');
  // 闸门豁免窗=到达时刻 ±2.5s 内的同文本视为同一波到达不判重；真重复需等首条老化出窗
  await evalJs(`window.chatAddSystem && window.chatAddSystem('今晚一起去吃火锅呀'); true`);
  await sleep(2700);
  const d2b = await evalJs(`window.bgNotifyGateInfo('今晚一起去吃火锅呀', undefined, Date.now())`);
  ok('第二条相同消息 → dupInChat=true（真重复仍去重）', d2b && d2b.dupInChat === true, d2b);

  console.log('\n== T3 窗口外旧消息/无关文本不误伤 ==');
  await evalJs(`(function(){ try { var a = window.getChatMsgs(); a.push({ side:'in', text:'很久很久以前的老消息', ts: Date.now() - 40*60000 }); } catch(e){} return true; })()`);
  const d3old = await evalJs(`window.bgNotifyGateInfo('很久很久以前的老消息')`);
  ok('40 分钟前的旧消息 → dupInChat=false（超窗正常提醒）', d3old && d3old.dupInChat === false, d3old);
  const d3new = await evalJs(`window.bgNotifyGateInfo('一条全新的没说过的消息')`);
  ok('全新文本 → dupInChat=false', d3new && d3new.dupInChat === false && d3new.dupNotified === false, d3new);

  console.log('\n== T4 切后台过渡期判定（#129 修正：无头页恒 visible，须伪造 visibilitychange——v3.16 起 lastHiddenAt 只在真实切后台事件置位） ==');
  await evalJs(`(function(){
    try {
      Object.defineProperty(document, 'visibilityState', { get: function(){ return 'hidden'; }, configurable: true });
      Object.defineProperty(document, 'hidden', { get: function(){ return true; }, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      return 'hidden-emulated';
    } catch(e){ return 'err:' + e.message; }
  })()`);
  await sleep(150);
  const d4 = await evalJs(`window.bgNotifyGateInfo('任意文本')`);
  ok('切后台后 tooFreshHidden=true（过渡期内积压不弹）', d4 && d4.tooFreshHidden === true, d4);
  // FIX 2026-09-17 #673：过渡期由「一律不弹」改为「只拦看过的内容」——此刻仍处过渡窗内，
  //   全新消息必须放行、聊天近期已有内容必须拦截（#498 防重弹面不失守）
  const d4new = await evalJs(`window.bgNotifyGateInfo('过渡期全新的TA回复' + Date.now())`);
  ok('过渡期内全新消息 transitionBlocks=false（放行：不再整条吞 TA 新回复）', d4new && d4new.transitionBlocks === false && d4new.tooFreshHidden === true, d4new);
  // 重放内容须在聊天数组尾部且新近才会被 recentChatDup 扫到（T3 在数组末尾追加了 40 分钟前旧消息，
  // 从尾部扫描会先撞到它并 break）——这里现场追加再判，避免探测顺序依赖
  await evalJs(`window.chatAddSystem && window.chatAddSystem('过渡期重复内容验证'); true`);
  await sleep(120);
  const d4dup = await evalJs(`window.bgNotifyGateInfo('过渡期重复内容验证')`);
  ok('过渡期内聊天已有内容 transitionBlocks=true（重放仍拦：#498 不失守）', d4dup && d4dup.transitionBlocks === true, d4dup);
  await evalJs(`(function(){
    try {
      Object.defineProperty(document, 'visibilityState', { get: function(){ return 'visible'; }, configurable: true });
      Object.defineProperty(document, 'hidden', { get: function(){ return false; }, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      return 'visible-restored';
    } catch(e){ return 'err:' + e.message; }
  })()`);
  await sleep(150);
  const d4b = await evalJs(`window.bgNotifyGateInfo('任意文本')`);
  ok('回前台后 tooFreshHidden 复位 false', d4b && d4b.tooFreshHidden === false, d4b);

  console.log('\n== T5 归一化：带图/带语音段的文本与可见文字同指纹 ==');
  // 旧式语音消息：入库「名称|||音频dataURL」，两条相同名称入库后，探针应命中（去重仍有效）
  await evalJs(`window.chatAddSystem && window.chatAddSystem('看这个|||data:audio/mp3;base64,AAAA BBBB'); true`);
  await evalJs(`window.chatAddSystem && window.chatAddSystem('看这个|||data:audio/mp3;base64,EEEE FFFF'); true`);
  await sleep(120);
  const d5a = await evalJs(`window.bgNotifyGateInfo('看这个|||data:audio/mp3;base64,CCCC DDDD')`);
  ok('语音段剥离后同指纹命中', d5a && d5a.dupInChat === true, d5a);
  // 旧式纯图消息：两条相同图入库后，探针同图应命中（去重仍有效）；不同图不互判
  await evalJs(`window.chatAddSystem && window.chatAddSystem('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg'); true`);
  await evalJs(`window.chatAddSystem && window.chatAddSystem('data:image/png;base64,AAAAAAAAAAAAAAAA'); true`);
  await sleep(120);
  const d5b = await evalJs(`window.bgNotifyGateInfo('data:image/png;base64,ZZZZZZZZZZZZZZZZZZZZ')`);
  ok('图片 dataURL 归一化后不同图不互判重复', d5b && d5b.dupInChat === false, d5b);

  console.log('\n== T5b v3.13.x 附件指纹：不同图片不再互判重复 ==');
  // 真实链路：纯图消息的 text 是 [图片] 占位、img 才是图片 dataURL（showDeskPopup→bgNotifyCheck）
  // 先入库两条相同图，使"上一条同图在记录中"成立；再入库一条不同图用于负例
  await evalJs(`window.chatAddSystem && window.chatAddSystem('data:image/png;base64,AAAAAAAAAAAAAAAAAAAA'); true`);
  await evalJs(`window.chatAddSystem && window.chatAddSystem('data:image/png;base64,AAAAAAAAAAAAAAAAAAAA'); true`);
  await evalJs(`window.chatAddSystem && window.chatAddSystem('data:image/png;base64,BBBBBBBBBBBBBBBBBBBB'); true`);
  await sleep(120);
  const d5b1 = await evalJs(`window.bgNotifyGateInfo('[图片]', 'data:image/png;base64,CCCCCCCCCCCCCCCCCCCC')`);
  ok('不同图片 → dupInChat=false（不再被 [附件] 归一化误杀）', d5b1 && d5b1.dupInChat === false, d5b1);
  // 与上一条同图（倒数第二条）探针 → 命中
  const d5b2 = await evalJs(`window.bgNotifyGateInfo('[图片]', 'data:image/png;base64,AAAAAAAAAAAAAAAAAAAA')`);
  ok('同图再次到达（上一条同图在记录中）→ dupInChat=true（仍可去重）', d5b2 && d5b2.dupInChat === true, d5b2);
  console.log('\n== T7 真实到达链路：隐藏态新消息不被自查判重 ==');
  // 模拟 bgNotifyCheck 在 hidden 时收到刚入库的聊天消息（自查判重会吞通知的复现场景）
  // 用未入库的探针文本（模拟"刚刚到达"），recentChatDup 应放行（不自查）
  const t7pre = await evalJs(`window.bgNotifyGateStats ? JSON.stringify(window.bgNotifyGateStats()) : null`);
  const t7 = await evalJs(`window.bgNotifyGateInfo('全新到聊天记录的消息XYZ')`);
  ok('新消息探针 dupInChat=false（不被自己吞掉）', t7 && t7.dupInChat === false, t7);
  const t7b = await evalJs(`window.bgNotifyGateStats && typeof window.bgNotifyGateStats === 'function'`);
  ok('bgNotifyGateStats 拦截统计可用', t7b === true);

  console.log('\n== T8 接线完好 & 无 JS 异常 ==');
  const t8 = await evalJs(`typeof window.bgNotifyCheck === 'function' && typeof window.showDeskPopup === 'function'`);
  ok('bgNotifyCheck/showDeskPopup 均在', t8 === true);
  ok('加载至今无未捕获异常', jsErrors.length === 0, jsErrors.slice(0, 3));

} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
