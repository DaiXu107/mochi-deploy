// 红包半框「设置」·TA 申请心意币 概率/每日上限 行为验证（无头 Chrome，测构建产物 index.html）
// 立项：用户反馈「联系人申请心意币的上限和概率没有设置出来可供调整，放在发红包的红包设置里」——
// 两行移入聊天页红包半框「设置」（按每个联系人独立设置），存钱罐右上角设置里原来的申请两步删除。
// 断言：①两行在 #rp-settings 内且随「设置」按钮显形；②点行→弹窗→写入当前联系人命名空间并回显；
// ③window.rpAskProbRate / rpAskDailyMax 的读取口径（本联系人值优先，未设过回退旧存钱罐全局根键）；
// ④上限真的闸门：概率 100% + 上限 2 时，反复触发回前台补触发通道只产生 2 条申请卡。
// 用法：node build.mjs && node tools/verify-rp-ask-coin.mjs（隔离验证：MOCHI_ROOT=<副本目录>）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

const cdpPort = 9800 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-dask-' + Date.now()),
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
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
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
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EX:' + JSON.stringify(r.exceptionDetails).slice(0, 200);
    return r && r.result ? r.result.value : null;
  } catch (e) { return 'ERR:' + e.message; }
}

let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); } };

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
async function boot() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html?x=' + Date.now() });
  await sleep(2600);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
  await sleep(700);
}
await boot();

// —— A1 静态：两行在 #rp-settings 内 ——
const a1 = await evalJs(`(function(){
  var p=document.getElementById('cs-rp-ask-prob'), m=document.getElementById('cs-rp-ask-daily-max');
  var box=document.getElementById('rp-settings');
  return JSON.stringify({prob:!!p,max:!!m,inBox:!!(p&&m&&box&&box.contains(p)&&box.contains(m)),
    pv:p&&p.querySelector('.val')?p.querySelector('.val').textContent:'',
    mv:m&&m.querySelector('.val')?m.querySelector('.val').textContent:'',
    fn:typeof window.rpAskProbRate+'|'+typeof window.rpAskDailyMax});
})()`);
const o1 = JSON.parse(String(a1));
ok(o1.prob && o1.max && o1.inBox, 'A1 红包设置里有「申请概率 / 每日申请上限」两行', a1);
ok(o1.pv === '4%' && o1.mv === '不限', 'A2 默认显示 4% / 不限（与 chat.js 默认一致）', a1);
ok(o1.fn === 'function|function', 'A3 chat.js 已挂出 rpAskProbRate / rpAskDailyMax', o1.fn);

// —— A4 点「设置」按钮后两行可见 ——
await evalJs("(function(){var b=document.getElementById('more-rp');if(b)b.click();return true;})()");
await sleep(500);
await evalJs("(function(){var b=document.getElementById('rp-settings-btn');if(b)b.click();return true;})()");
await sleep(500);
const a4 = await evalJs(`(function(){
  var p=document.getElementById('cs-rp-ask-prob'), m=document.getElementById('cs-rp-ask-daily-max');
  var vis=function(e){return !!(e&&e.getClientRects().length)};
  return JSON.stringify({panel:document.getElementById('rp-settings')?document.getElementById('rp-settings').hidden:'no',p:vis(p),m:vis(m)});
})()`);
ok(/"p":true,"m":true/.test(String(a4)), 'A4 打开红包设置后两行可见', a4);

// —— A5 读值口径（先清掉本联系人已写的值，回退默认/旧全局根键）——
const a5 = await evalJs(`(function(){
  var out={};
  var ns=window.activePrefix();
  var del=function(k){try{window.xyStore(ns).remove(k);}catch(e){}};
  var setRoot=function(k,v){try{window.xyStore('xy-home-v2').set(k,v);}catch(e){}};
  del('cs-rp-ask-prob'); del('cs-rp-ask-daily-max');
  out.dflt=window.rpAskProbRate()+'|'+window.rpAskDailyMax();
  setRoot('piggy-coin-prob', JSON.stringify({deposit:.1,withdraw:.2,ask:.5}));
  setRoot('piggy-coin-ask-limit','7');
  out.legacy=window.rpAskProbRate()+'|'+window.rpAskDailyMax();
  try{window.xyStore(ns).set('cs-rp-ask-prob','30');window.xyStore(ns).set('cs-rp-ask-daily-max','3');}catch(e){}
  out.own=window.rpAskProbRate()+'|'+window.rpAskDailyMax();
  out.rowText=(document.getElementById('cs-rp-ask-prob-val')||{}).textContent+'/'+(document.getElementById('cs-rp-ask-daily-max-val')||{}).textContent;
  if(window.csRpSettingsSync)window.csRpSettingsSync();
  out.rowAfterSync=(document.getElementById('cs-rp-ask-prob-val')||{}).textContent+'/'+(document.getElementById('cs-rp-ask-daily-max-val')||{}).textContent;
  try{window.xyStore('xy-home-v2').remove('piggy-coin-prob');window.xyStore('xy-home-v2').remove('piggy-coin-ask-limit');}catch(e){}
  return JSON.stringify(out);
})()`);
const o5 = JSON.parse(String(a5));
ok(o5.dflt === '0.04|0', 'A5a 未设过且无旧全局值＝默认 4% / 不限', a5);
ok(o5.legacy === '0.5|7', 'A5b 未单独设过的联系人回退旧存钱罐全局根键（50% / 7 次）', a5);
ok(o5.own === '0.3|3', 'A5c 本联系人设过 30% / 3 次＝以自己的值为准', a5);
ok(o5.rowAfterSync === '30%/3 次', 'A5d 设置行回显与存储一致（csRpSettingsSync 刷四行）', a5);

// —— A6 点行 → 弹窗输入 → 写入当前联系人命名空间 ——
const a6 = await evalJs(`(function(){
  document.getElementById('cs-rp-ask-prob').click();
  var i=document.getElementById('modal-input');
  return JSON.stringify({modal:i?String(i.hidden):'no', tag:i?i.tagName:'', ce:!!(i&&i.parentNode&&i.parentNode.querySelector('.ce-box'))});
})()`);
const o6 = JSON.parse(String(a6));
const typed = await evalJs(`(function(){
  var i=document.getElementById('modal-input');
  var target=i;
  var box=i&&i.parentNode?i.parentNode.querySelector('.ce-box'):null;
  if(box){box.textContent='18';box.dispatchEvent(new InputEvent('input',{bubbles:true}));}
  else{i.value='18';i.dispatchEvent(new Event('input',{bubbles:true}));}
  var b=document.getElementById('modal-ok'); if(b)b.click();
  return String(target?target.value:'');
})()`);
await sleep(600);
const a6b = await evalJs(`(function(){
  return JSON.stringify({stored:String(window.activeStore().get('cs-rp-ask-prob')),
    rootHas:localStorage.getItem('xy-home-v2:'+((window.__activeCid||'default'))+':cs-rp-ask-prob'),
    rate:window.rpAskProbRate(), row:(document.getElementById('cs-rp-ask-prob-val')||{}).textContent});
})()`);
const o6b = JSON.parse(String(a6b));
ok(o6b.rate === 0.18, 'A6 弹窗输入 18 → 写当前联系人键并生效为 18%', JSON.stringify({ a6, typed: String(typed), a6b: String(a6b) }));
ok(o6b.row === '18%', 'A6b 行内显示同步为 18%', a6b);

// —— A7 上限闸门：概率 100% + 每日上限 2 → 触发三次只落两条申请卡 ——
await evalJs(`(function(){
  var s=window.activeStore();
  s.set('cs-rp-ask-prob','100'); s.set('cs-rp-ask-daily-max','2');
  var d=new Date().toISOString().slice(0,10); try{s.remove('ml2_ask_daily_'+d);}catch(e){}
  if(window.csRpSettingsSync)window.csRpSettingsSync();
  return true;
})()`);
await sleep(300);
const countAsk = async () => Number(await evalJs("(function(){var a=[].slice.call(document.querySelectorAll('.msg-poke'));return a.filter(function(e){return /向 Mochi 申请了心意币/.test(e.textContent)}).length;})()")) || 0;
const before = await countAsk();
for (let i = 0; i < 3; i++) {
  await evalJs("(function(){document.dispatchEvent(new Event('mochi-fg-resume'));return true;})()");
  await sleep(7500);
}
const after = await countAsk();
const a7 = await evalJs(`(function(){
  var d=new Date().toISOString().slice(0,10);
  return JSON.stringify({cnt:Number(window.activeStore().get('ml2_ask_daily_'+d))||0, max:window.rpAskDailyMax()});
})()`);
ok(after - before === 2, 'A7 上限 2 生效：触发三次只在聊天落 2 条申请卡（前 ' + before + ' 后 ' + after + '）', a7);
ok(/"cnt":2/.test(String(a7)), 'A7b 每日申请计数停在 2（=上限）', a7);

// —— A8 产物侧：存钱罐那两步已删（防「两处各存一份、互相覆盖」回流）——
const built = readFileSync(join(root, 'index.html'), 'utf8');
ok(!built.includes('设置 · 申请概率') && !built.includes('设置 · 申请每日上限'), 'A8 存钱罐设置里的申请两步已删除');
ok(built.includes('已移到聊天页红包的「设置」里'), 'A8b 存钱罐设置里留有去处指引文案');

console.log(fail ? ('FAIL ' + pass + '/' + (pass + fail)) : ('ALL PASS ' + pass + '/' + (pass + fail)));
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
