// ===== 验证：#148 防骗+署名禁倒卖声明「运行时回填」（防倒卖核心机制） =====
// 回归背景：
//   1) 置顶声明是二传者最想删的内容——静态 DOM 可被从二传部署里删掉/改掉；
//   2) 该回填机制 f7a8b5c 首建后曾被 0965278 清理整块移除（修复被并行会话覆盖实例）。
// 机制（clock.js 顶部 IIFE）：JS 常量兜底 + fetch 官方 notice.json(alert/alert2) 强刷
//   「开屏合并置顶声明 data-anti-scam=1（#621 起防骗+署名并成一张「免费 · 署名 · 防倒卖」）+ 设置页 set-alert」；
//   缺失重建插最顶、文案被改（标题+全部特征词 marks 不在位）重写回官方版。
// 用例（模拟二传者各种删改手段）：
//   1) 官方正常加载：合并声明卡在必读区最顶（#976 前为公告区最顶）、文案官方版、
//      #613 免费声明（没有收过任何人一分钱…禁止以盈利为目的）在合并卡里（#1216 起开屏只剩这一处权威落点）、设置页声明含署名禁倒卖句
//      （#620 起摘要首条曾是「原公告已移动至设置→关于」提示；#1216 整块摘要撤除，该条改判「摘要块不存在」）
//   2) 静态条被整体删除（二传改 HTML）→ 回填重建合并卡到最顶
//   3) 静态条文案被篡改成收费内容 → 回填重写回官方版
//   4) 官方 notice.json 不可达（断网/被墙）→ 静态兜底仍在
//   5) 删条+断网叠加（离线二传副本）→ 仍从 JS 常量重建
//   6) 加载后运行时删条 → pwa.js 看门狗 5s 内补回（第二锚点）
//   7) 官方远程下发时效公告 bulletin → 开屏显示「公告」条
//   8) bulletin 过期 → 自动摘除
// 用法：node tools/verify-anti-scam-backfill.mjs（需先 node build.mjs，需本机 Chrome/Edge；
//       用例 4/5/7/8 会真实拦截 ling233330-star.github.io 请求，不依赖外网）
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
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

// —— 模拟二传者改副本：对构建产物 index.html 做字符串手术 ——
const RE_B1 = /<div class="splash-alert" data-anti-scam="1">[\s\S]*?<\/p>\s*<\/div>/;
const modes = {
  // 删条：整块移除合并静态置顶声明（保留其余页面）
  strip(html) { return html.replace(RE_B1, ''); },
  // 篡改文案：标题保留、正文改成收费内容（特征词 全部消失 → marked() 判不在位）
  tamper(html) {
    return html
      .replace(RE_B1, '<div class="splash-alert" data-anti-scam="1">\n          <div class="splash-alert-t">免费 · 署名 · 防倒卖</div>\n          <p><strong>Mochi字卡高级版每月收费。</strong>购买后解锁全部功能与隐藏字卡。</p>\n        </div>');
  }
};

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  try {
    const [path, query] = req.url.split('?');
    let p = normalize(join(root, decodeURIComponent(path)));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    let body = readFileSync(p, 'utf8');
    const mode = new URLSearchParams(query || '').get('mode');
    if (p.endsWith('index.html') && mode && modes[mode]) {
      const out = modes[mode](body);
      if (out === body) { res.writeHead(500); res.end('mode surgery no-op'); return; } // 正则失配=产物结构变了，脚本必须红
      body = out;
    }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-backfill-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0, eventHandler = null;
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
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
          if (m.method && eventHandler) eventHandler(m.method, m.params);
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
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return { __err: String(r.exceptionDetails.text || '') };
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function waitReady() {
  await sleep(2000);
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(250); }
  await ev("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
  await sleep(800);
}
async function load(mode) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' + (mode ? '?mode=' + mode : '') });
  await waitReady();
}
async function waitCond(expr, timeout = 6000) {
  const t0 = Date.now();
  for (;;) {
    if (await ev(expr)) return true;
    if (Date.now() - t0 > timeout) return false;
    await sleep(250);
  }
}

const B1_OK = "(function(){var b=document.querySelector('#splash-mustread .splash-alert[data-anti-scam=\"1\"]');var t=(b?b.textContent:'').replace(/\\s+/g,'');return !!b&&t.indexOf('免费·署名·防倒卖')>-1&&t.indexOf('免费')>-1&&t.indexOf('诈骗')>-1&&t.indexOf('署名')>-1&&t.indexOf('倒卖')>-1&&t.indexOf('小红书@言序（1842523578）')>-1;})()";
// #621：防骗卡 + 署名禁倒卖卡合并为一张（tag '1'，标题「免费 · 署名 · 防倒卖」），补回锚点 = 必读区最顶
// #976（2026-09-21）：7 张必读卡整组前移到 #splash-mustread（品牌卡之前），本脚本作用域随之由 #splash-notice
//   改为 #splash-mustread（「公告区最顶」口径平移为「必读区最顶」）；计数类断言改用 .splash-box 全范围（卡 + 必读摘要）。
const B1_TOP = "(function(){var n=document.getElementById('splash-mustread');var b=n.querySelector('.splash-alert[data-anti-scam=\"1\"]');var d=n.querySelector('.splash-alert[data-anti-scam=\"d\"]');var l=n.querySelector('.splash-alert[data-anti-scam=\"l\"]');return !!b&&n.firstElementChild===b&&!!d&&!!l;})()";
// #613 免费声明（「本站完全免费，没有收过任何人一分钱…禁止以盈利为目的」）在合并卡里 + 必读摘要内，其余位置不再重复
const B1_FREE = "(function(){var b=document.querySelector('#splash-mustread .splash-alert[data-anti-scam=\"1\"]');if(!b)return false;var t=b.textContent;return t.indexOf('没有收过任何人一分钱')>-1&&t.indexOf('禁止以盈利为目的')>-1&&t.indexOf('个人出资和花费时间搭建的')>-1;})()";
// #620 起必读摘要首条为「原公告部分内容已移动至设置→关于」提示，免费声明移到其后：两条都在摘要内
// v8.44 #1216（2026-09-25 用户直派「必读摘要删掉，这些内容在开屏最顶已经有了」）：必读摘要块在两份源同批撤除，
//   #620 那条「摘要含原公告已移动 + 免费声明」的判据改口为「摘要块不存在」；免费声明的权威落点只剩合并卡一处，
//   计数断言相应从「恰好两处」收到「恰好一处」（原两处里的那处正是被撤除的摘要）。
const NO_SUMMARY = "(function(){return !document.querySelector('.splash-summary');})()";
const FREE_ONLY_ONE = "(function(){var t=document.getElementById('splash-box');if(!t)return false;var ps=t.querySelectorAll('p'),n=0;for(var i=0;i<ps.length;i++){if(ps[i].textContent.indexOf('没有收过任何人一分钱')>-1)n++;}return n===1;})()";
const SET_OK = "(function(){var b=document.querySelector('#page-setting .set-alert');var t=b?b.textContent:'';return !!b&&t.indexOf('小红书@言序（1842523578）')>-1&&t.indexOf('免费')>-1&&t.indexOf('倒卖')>-1;})()";
// 拦截官方 notice.json：mode='abort' 模拟断网/官方源不可达；mode=对象 → 用假官方应答 fulfill（测 bulletin 远程下发）
async function interceptOfficial(mode) {
  if (!mode) { eventHandler = null; await cdp('Fetch.disable'); return; }
  await cdp('Fetch.enable', { patterns: [{ urlPattern: 'https://ling233330-star.github.io/*', requestStage: 'Request' }] });
  eventHandler = (method, params) => {
    if (method !== 'Fetch.requestPaused') return;
    if (mode === 'abort' || params.request.url.indexOf('notice.json') === -1) {
      cdp('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Aborted' });
      return;
    }
    cdp('Fetch.fulfillRequest', {
      requestId: params.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
      body: Buffer.from(JSON.stringify(mode)).toString('base64')
    });
  };
}
// 官方 notice.json 应答底稿（与本地兜底一致，保证测 bulletin 时不触发固定条重写干扰）
const OFFICIAL_JSON = {
  alert: 'Mochi字卡网站完全免费，作者只有小红书这一个账号：小红书@言序（1842523578）。如有出现任何收费情况，均为诈骗，注意防止被骗。',
  alert2: '二传、分享本站链接必须标注作者署名：小红书 @言序（1842523578），禁止删除或修改。严禁冒为自己制作、删除篡改署名，或以任何形式收费倒卖本站链接、安装包——本站完全免费，收费即诈骗。如果你是花钱买来的链接：你被骗了，请拒付退款并举报卖家。'
};

// ============ 用例 1：官方正常加载 ============
console.log('\n===== 用例1 官方正常加载：合并声明卡在公告区最顶（#621）+ 免费声明在卡与必读摘要 =====');
await load();
check('合并置顶条在位且文案官方版（免费/署名/防倒卖）', await waitCond(B1_OK));
check('合并声明卡位于必读区最顶（第一个元素子节点）', await ev(B1_TOP) === true);
check('#613 合并卡正文含免费声明（没有收过任何人一分钱 / 个人出资 / 禁止以盈利为目的）', await waitCond(B1_FREE));
check('#1216 必读摘要块已整块撤除（静态与在线同批清空；原 #620 判据改口）', await waitCond(NO_SUMMARY));
check('#613 免费声明全文只出现一处（合并卡；#1216 撤除摘要后旧的第二处不复存在，也不得复述到别处）', await waitCond(FREE_ONLY_ONE));
check('设置页底部声明含署名+免费+禁倒卖', await waitCond(SET_OK));

// ============ 用例 2：二传副本删掉静态置顶条 → 回填重建 ============
console.log('\n===== 用例2 二传副本删条 → 重建到最顶 =====');
await load('strip');
check('删除后回填重建合并声明卡且文案官方版', await waitCond(B1_OK));
check('重建的合并卡插回必读区最顶', await ev(B1_TOP) === true);
check('#613 重建的合并卡（JS 常量兜底）同样含免费声明句', await waitCond(B1_FREE));

// ============ 用例 3：二传副本篡改文案 → 重写回官方版 ============
console.log('\n===== 用例3 二传副本篡改成收费文案 → 重写官方版 =====');
await load('tamper');
check('合并声明卡被重写回官方版（收费篡改文案被清除）', await waitCond(B1_OK + "&&(document.querySelector('#splash-mustread .splash-alert[data-anti-scam=\"1\"]').textContent.indexOf('高级版')===-1)"));

// ============ 用例 4：官方 notice.json 不可达 → 静态兜底仍在 ============
console.log('\n===== 用例4 官方源不可达（拦截 ling233330-star.github.io）→ 兜底在位 =====');
await interceptOfficial('abort');
await load();
check('官方源失败后合并声明卡仍在（静态兜底）', await waitCond(B1_OK));

// ============ 用例 5：删条+断网叠加 → JS 常量重建 ============
console.log('\n===== 用例5 离线二传副本删条 → JS 常量重建 =====');
await load('strip');
check('断网+删条后合并声明卡仍被重建（常量兜底）', await waitCond(B1_OK));
await interceptOfficial(null);

// ============ 用例 6：加载后运行时删条 → pwa.js 看门狗 5s 内补回 ============
console.log('\n===== 用例6 运行时删条 → pwa.js 看门狗（第二锚点）补回 =====');
await load();
await ev("(function(){var n=document.getElementById('splash-box');var a=n.querySelectorAll('.splash-alert[data-anti-scam=\"1\"]');for(var i=0;i<a.length;i++)a[i].remove();return a.length;})()");
await sleep(6500); // 看门狗 5s 一跳
check('运行时删除后看门狗补回合并声明卡', await waitCond(B1_OK, 3000));

// ============ 用例 7：官方远程下发时效公告 → 开屏显示「公告」条 ============
console.log('\n===== 用例7 官方 notice.json 下发 bulletin → 远程公告显示 =====');
await interceptOfficial(Object.assign({}, OFFICIAL_JSON, { bulletin: { text: '测试公告：若你打开的地址并非官方发布，即为倒卖副本', until: 4102444800000 } }));
await load();
check('远程公告条显示且标题为「公告」', await waitCond("(function(){var b=document.querySelector('#splash-mustread .splash-alert[data-anti-scam=\"3\"]');return !!b&&b.textContent.indexOf('倒卖副本')>-1&&b.querySelector('.splash-alert-t').textContent==='公告';})()"));
check('下发公告时合并固定声明不受影响仍在位', (await ev(B1_OK)) === true);

// ============ 用例 8：公告过期 → 自动摘除 ============
console.log('\n===== 用例8 bulletin 过期 → 自动摘除 =====');
await interceptOfficial(Object.assign({}, OFFICIAL_JSON, { bulletin: { text: '过期公告', until: 1000 } }));
await load();
await sleep(1500);
check('过期公告条不存在（未渲染）', await ev("document.querySelector('#splash-mustread .splash-alert[data-anti-scam=\"3\"]')===null") === true);
await interceptOfficial(null);

const passN = results.filter(r => r.ok).length;
console.log('\n===== 结果: ' + passN + '/' + results.length + ' =====');
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(passN === results.length ? 0 : 1);
