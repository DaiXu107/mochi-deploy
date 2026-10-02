// ===== 回归：聊天统计-情绪表达「文字字卡」排名剔除表情/颜文字（p2-features.js v3.12.x） =====
// 用户反馈：常用字卡前五名被纯 emoji 和颜文字霸榜，看不到联系人平时说得最多的话。
// 根因：emoji/颜文字字卡发出时 type 就是 'text'（chat.js 的分类只在发送端选卡用），
//       统计页把所有非图片消息文本都计入文字榜。
// 修复：按内容过滤——去掉符号后不含可读文字（汉字/假名/字母/数字）的消息不入榜；
//       带括号特征且可读部分只剩假名的颜文字兜底剔除；表情包/图片/语音/链接消息同样排除。
//
// 用例：
//   T1 种入混合消息后打开统计页，「文字字卡」只统计可读文字消息，前五名按次数排序
//   T2 纯 emoji/颜文字/符号/链接/表情包/语音均不出现在情绪表达任何榜单里
//   T3 「常用文字」高亮为次数最多的真实文字；条目计数正确（4 种）
//   T4 mood 三类榜单（情绪/心意/交流意图）不受过滤影响
//   T5 加载至今无未捕获异常
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-exprrank-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}

try {
  await cdpConnect();
  const jsErrors = [];
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  const rawHandler = ws.onmessage;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(JSON.stringify(m.params).slice(0, 200));
    if (rawHandler) rawHandler(ev);
  };

  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4500); // 等开屏/数据就绪

  // 种入混合消息：真实文字 + 纯 emoji + 颜文字 + 符号 + 链接表情包 + dataURL 表情包 + 语音
  // （直接 push 进 getChatMsgs 内存数组——renderStats 即读该数组）
  const seeded = await evalJs(`(function(){
    try {
      var arr = window.getChatMsgs();
      if (!arr || typeof arr.push !== 'function') return 'no getChatMsgs';
      var t = Date.now() - 60000;
      var add = function(side, text, type, extra) {
        var m = Object.assign({ side: side, text: text, ts: t += 1000 }, extra || {});
        if (type) m.type = type;
        arr.push(m);
      };
      add('in', '想你了');                                   // ×3 文字
      add('in', '想你了');
      add('in', '想你了', null, { mood: [{ tag: '心意', label: '想你' }] });
      add('in', '晚安~😊'); add('in', '晚安~😊');            // ×2 文字+emoji 混排 → 算文字
      add('in', '今天好累啊', null, { mood: [{ tag: '心情', label: '委屈' }] });
      add('in', '在吗');
      add('in', '😂'); add('in', '😂'); add('in', '😂'); add('in', '😂'); add('in', '😂');   // ×5 纯 emoji
      add('in', '😀'); add('in', '😀'); add('in', '😀'); add('in', '😀');                    // ×4 BMP emoji
      add('in', '(◕ᴗ◕✿)'); add('in', '(◕ᴗ◕✿)'); add('in', '(◕ᴗ◕✿)');                        // ×6 颜文字
      add('in', '(◕ᴗ◕✿)'); add('in', '(◕ᴗ◕✿)'); add('in', '(◕ᴗ◕✿)');
      add('in', 'ヾ(≧▽≦)ノ'); add('in', 'ヾ(≧▽≦)ノ');                                      // 假名颜文字
      add('in', '？？？'); add('in', '。。。');                                              // 纯符号
      add('in', '❤️'); add('in', '❤️');
      add('in', 'https://example.com/sticker.png', 'sticker');                               // ×7 链接表情包
      add('in', 'https://example.com/sticker.png', 'sticker');
      add('in', 'https://example.com/sticker.png', 'sticker');
      add('in', 'https://example.com/sticker.png', 'sticker');
      add('in', 'https://example.com/sticker.png', 'sticker');
      add('in', 'https://example.com/sticker.png', 'sticker');
      add('in', 'https://example.com/sticker.png', 'sticker');
      add('out', 'data:image/png;base64,iVBORw0KGgo=', 'sticker', { parts: [{ k: 'img', v: 'data:image/png;base64,iVBORw0KGgo=' }] }); // 表情包
      add('in', 'voice001|||data:audio/mp3;base64,AAAA', 'voice');                           // 语音
      add('out', '收到啦', null, { mood: [{ tag: '交流意图', label: '回应' }] });             // 交流意图
      return true;
    } catch(e){ return String(e); }
  })()`);
  ok('前置：混合消息种入成功', seeded === true, seeded);

  // 打开聊天统计页并切到「情绪表达」
  await evalJs(`(function(){ var a=document.querySelector('.app[data-app="stats"]'); if(a) a.click(); return !!a; })()`);
  await sleep(300);
  await evalJs(`(function(){ var b=document.querySelector('#page-stats .fav-tab[data-stab="expr"]'); if(b) b.click(); return !!b; })()`);
  await sleep(300);

  const secHtml = await evalJs(`(function(){
    var el = document.querySelector('#st-expr-content .stats-sec');
    return el ? el.innerHTML : '';
  })()`);

  console.log('\n== T1 文字字卡只统计可读文字，前五名排序正确 ==');
  const names = await evalJs(`Array.from(document.querySelectorAll('#st-expr-content .stats-sec:first-child .stats-item-name')).map(function(x){return x.textContent;})`);
  const nums = await evalJs(`Array.from(document.querySelectorAll('#st-expr-content .stats-sec:first-child .stats-item-num')).map(function(x){return x.textContent;})`);
  ok('前两名依次为 想你了(3)/晚安~😊(2)', names[0] === '想你了' && nums[0] === '3' && names[1] === '晚安~😊' && nums[1] === '2', { names, nums });
  ok('种入的真实文字均在榜（今天好累啊/在吗）', names.indexOf('今天好累啊') >= 0 && names.indexOf('在吗') >= 0, names);
  ok('「文字+emoji 混排」保留（晚安~😊 在榜）', names.indexOf('晚安~😊') >= 0, names);
  // 运行期查岗等定时器可能补发真实文字消息，属正常入榜；这里校验次数严格降序
  const desc = nums.every((v, i) => i === 0 || Number(nums[i - 1]) >= Number(v));
  ok('榜单按次数降序排列', desc === true, { names, nums });

  console.log('\n== T2 表情/颜文字/符号/媒体均不入榜 ==');
  const polluted = await evalJs(`(function(){
    var el = document.getElementById('st-expr-content');
    var h = el ? el.innerHTML : '';
    return ['😂','😀','❤','(◕ᴗ◕✿)','ヾ','？？？','。。。','https:','base64','|||'].filter(function(s){ return h.indexOf(s) >= 0; });
  })()`);
  ok('情绪表达整块不含 emoji/颜文字/符号/链接/语音残留', polluted.length === 0, polluted);
  ok('「文字字卡」区段存在且有内容', secHtml.indexOf('stats-top') >= 0, secHtml.slice(0, 120));

  console.log('\n== T3 常用文字高亮与条目计数 ==');
  const topName = await evalJs(`(function(){
    var el = document.querySelector('#st-expr-content .stats-sec:first-child .stats-top-name');
    return el ? el.textContent : '';
  })()`);
  ok('「常用文字」高亮为「想你了」', topName.indexOf('想你了') >= 0, topName);
  const kindCount = await evalJs(`(function(){
    var el = document.querySelector('#st-expr-content .stats-sec:first-child .stats-sec-count');
    return el ? el.textContent : '';
  })()`);
  // 种入的可读文字共 4 种（27 条表情类全部剔除）；运行期定时器补发的文字消息可再增加
  ok('条目计数 ≥ 4 种且不含表情类', /^([4-9]|\d{2,}) 种$/.test(kindCount), kindCount);

  console.log('\n== T4 mood 三类榜单不受影响 ==');
  const moodOk = await evalJs(`(function(){
    var h = document.getElementById('st-expr-content') ? document.getElementById('st-expr-content').innerHTML : '';
    return { emo: h.indexOf('委屈') >= 0, heart: h.indexOf('想你') >= 0, intent: h.indexOf('回应') >= 0 };
  })()`);
  ok('情绪字卡计入「委屈」', moodOk && moodOk.emo === true, moodOk);
  ok('心意字卡计入「想你」', moodOk && moodOk.heart === true);
  ok('交流意图计入「回应」', moodOk && moodOk.intent === true);

  console.log('\n== T5 无未捕获异常 ==');
  ok('加载至今无未捕获异常', jsErrors.length === 0, jsErrors.slice(0, 3));

} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
