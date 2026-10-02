// ===== 验证脚本：公用/专属字卡 分组停用开关（v3.30.x，构建后无头 Chrome） =====
// 用法：node build.mjs && node tools/verify-cc-group-off.mjs
// 覆盖：① 分组 header 出现眼睛开关；② 停用专属分组 → 回复池/面板不再含该组（其余保留）；
//       ③ 停用公用分组 → 各桌面回复池均剔除；④ 重新启用 → 恢复；⑤ 同名分组跨作用域互不影响。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) {
  console.error('找不到 Chrome/Edge，请设置环境变量 CHROME_PATH 指定浏览器路径');
  process.exit(1);
}
if (typeof WebSocket !== 'function') {
  console.error('需要 Node 21+（内置 WebSocket），当前 Node ' + process.version);
  process.exit(1);
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    let p = normalize(join(root, decodeURIComponent(u.pathname)));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-ccgo-' + Date.now()),
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
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) {
      console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
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

// ---- 注入测试数据：专属两组 + 公用一组（含与专属同名「专属甲」测跨作用域隔离）----
// 注：必须先置 cc-scope-migrated=1 拦住 v3.11.x 存量归属迁移——无头环境只有 default
// 联系人时，迁移会把 default:cc-groups 搬进 cc-groups-public 并清空专属键（篡改 seed）。
const seed = await evalJs(`(function(){
  var own = { text: [['专属甲', ['专属甲字卡1', '专属甲字卡2']], ['专属乙', ['专属乙字卡1']]] };
  var pub = { text: [['专属甲', ['公用甲字卡1']], ['公用丙', ['公用丙字卡1']]] };
  window.xyStore('xy-home-v2').set('cc-scope-migrated', '1');
  window.activeStore().set('cc-groups', JSON.stringify(own));
  window.xyStore('xy-home-v2').set('cc-groups-public', JSON.stringify(pub));
  window.xyStore('xy-home-v2').set('cc-groups-public-off', '');
  window.activeStore().set('cc-groups-off', '');
  return true;
})()`);
check('注入测试字卡数据（专属甲/专属乙 + 公用甲同名/公用丙）', seed === true);

// 进入：底部 tab「字卡库」→ 列表页「自定义聊天字卡」→ 自定义字卡页（专属）
await evalJs("(function(){var t=document.querySelector('.tab[data-page=\"page-chatcard\"]');if(t)t.click();return !!t;})()");
await sleep(700);
await evalJs("(function(){var li=document.getElementById('li-custom-cards');if(li)li.click();return !!li;})()");
await sleep(900);

// ① 分组 header 出现眼睛开关按钮
const hasToggle = await evalJs("(function(){var h=document.querySelector('#cc-list .cc-group-header[data-g=\"专属甲\"]');return !!(h&&h.querySelector('.ccg-toggle'));})()");
check('分组 header 出现眼睛开关按钮', hasToggle === true);
const toggles = await evalJs("(function(){return document.querySelectorAll('#cc-list .ccg-toggle').length;})()");
check('当前分类分组均带开关（text 分类 2 组）', toggles === 2, 'count=' + toggles);

// ② 回复池初始含三组字卡
const pool0 = await evalJs("(function(){var c=window.getCustomCards()||[];return {a:c.indexOf('专属甲字卡1')>=0,b:c.indexOf('专属乙字卡1')>=0,p:c.indexOf('公用丙字卡1')>=0,pa:c.indexOf('公用甲字卡1')>=0};})()");
check('初始回复池含 专属甲/专属乙/公用丙/公用甲(同名)', pool0 && pool0.a && pool0.b && pool0.p && pool0.pa,
  JSON.stringify(pool0));

// ③ 点击「专属甲」开关停用
await evalJs("(function(){var t=document.querySelector('#cc-list .cc-group-header[data-g=\"专属甲\"] .ccg-toggle');if(t)t.click();return !!t;})()");
await sleep(300);
const offStored = await evalJs("(function(){try{return JSON.parse(window.activeStore().get('cc-groups-off')||'null');}catch(e){return null;}})()");
check('专属停用键已写入 cc-groups-off', offStored && offStored.text && offStored.text.indexOf('专属甲') >= 0, JSON.stringify(offStored));
const hdrOff = await evalJs("(function(){var h=document.querySelector('#cc-list .cc-group-header[data-g=\"专属甲\"]');return !!(h&&h.classList.contains('off')&&h.querySelector('.ccg-off-tag'));})()");
check('停用分组 header 带 .off + 「已停用」标签', hdrOff === true);

// ④ 回复池剔除专属甲、其余保留（含同名公用甲）
const pool1 = await evalJs("(function(){var c=window.getCustomCards()||[];return {a:c.indexOf('专属甲字卡1')>=0,b:c.indexOf('专属乙字卡1')>=0,p:c.indexOf('公用丙字卡1')>=0,pa:c.indexOf('公用甲字卡1')>=0};})()");
check('停用后回复池剔除专属甲、专属乙/公用丙/公用甲(同名)保留', pool1 && !pool1.a && pool1.b && pool1.p && pool1.pa,
  JSON.stringify(pool1));

// ⑤ 面板 getScopedGroups 同样剔除（主动展示也不出现）
const scoped1 = await evalJs("(function(){var g=window.getScopedGroups('text','own')||[];return g.map(function(x){return x[0];});})()");
check('getScopedGroups(own) 不含专属甲、含专属乙', scoped1 && scoped1.indexOf('专属甲') < 0 && scoped1.indexOf('专属乙') >= 0,
  JSON.stringify(scoped1));

// ⑥ 切公用作用域：停用公用丙
await evalJs("(function(){var b=document.getElementById('cc-back');if(b)b.click();return true;})()");
await sleep(600);
await evalJs("(function(){var li=document.getElementById('li-custom-cards-public');if(li)li.click();return !!li;})()");
await sleep(900);
const pubHasToggle = await evalJs("(function(){var h=document.querySelector('#cc-list .cc-group-header[data-g=\"公用丙\"]');return !!(h&&h.querySelector('.ccg-toggle'));})()");
check('公用作用域分组 header 也有开关', pubHasToggle === true);
await evalJs("(function(){var t=document.querySelector('#cc-list .cc-group-header[data-g=\"公用丙\"] .ccg-toggle');if(t)t.click();return !!t;})()");
await sleep(300);
const pubOffStored = await evalJs("(function(){try{return JSON.parse(window.xyStore('xy-home-v2').get('cc-groups-public-off')||'null');}catch(e){return null;}})()");
check('公用停用键已写入全局 cc-groups-public-off', pubOffStored && pubOffStored.text && pubOffStored.text.indexOf('公用丙') >= 0,
  JSON.stringify(pubOffStored));

// ⑦ 回专属视角：回复池应剔除公用丙（公用停用对当前桌面也生效）；同名「公用甲」不受公用丙影响
await evalJs("(function(){var b=document.getElementById('cc-back');if(b)b.click();return true;})()");
await sleep(600);
const pool2 = await evalJs("(function(){var c=window.getCustomCards()||[];return {a:c.indexOf('专属甲字卡1')>=0,b:c.indexOf('专属乙字卡1')>=0,p:c.indexOf('公用丙字卡1')>=0,pa:c.indexOf('公用甲字卡1')>=0};})()");
check('公用丙停用后回复池剔除公用丙、专属乙/公用甲保留、专属甲仍停用', pool2 && !pool2.a && pool2.b && !pool2.p && pool2.pa,
  JSON.stringify(pool2));

// ⑧ 重新启用专属甲 → 回复池恢复
await evalJs("(function(){var li=document.getElementById('li-custom-cards');if(li)li.click();return !!li;})()");
await sleep(900);
await evalJs("(function(){var t=document.querySelector('#cc-list .cc-group-header[data-g=\"专属甲\"] .ccg-toggle');if(t)t.click();return !!t;})()");
await sleep(300);
const pool3 = await evalJs("(function(){var c=window.getCustomCards()||[];return {a:c.indexOf('专属甲字卡1')>=0,b:c.indexOf('专属乙字卡1')>=0,p:c.indexOf('公用丙字卡1')>=0};})()");
check('重新启用专属甲后回复池恢复（含专属甲；公用丙仍停用）', pool3 && pool3.a && pool3.b && !pool3.p, JSON.stringify(pool3));

chrome.kill();
server.close();
const fails = results.filter((r) => !r.ok);
console.log('\n== 分组停用开关验证 ' + (results.length - fails.length) + '/' + results.length + ' ==');
process.exit(fails.length ? 1 : 0);
