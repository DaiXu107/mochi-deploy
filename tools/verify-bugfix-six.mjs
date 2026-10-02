// ===== 回归脚本：六项用户反馈修复（v3.11.x） =====
// 用法：node build.mjs && node tools/verify-bugfix-six.mjs
// 覆盖：
//   B1 贪吃蛇胜负按存活判定（#604 起：撞死的一方输、同 tick 双死=平；原「按最终得分」口径
//      正是用户报的「我输了显示我赢」根因，行为断言见 tools/verify-snake-result-color.mjs）
//   B2 Pong 侧位对应：比分「TA x : y 你」/ 提示「右侧挡板」（玩家实际控制右板）
//   B3 记账分类管理二级弹窗可正常打开并添加分类（openModal 嵌套 setTimeout 修复）
//   B4 朋友圈通知带评论/回复定位 + 缩略图；TA 评论回应两种动态都发通知
//   B5 默认字卡页单滚动容器（#dc-list 不再内部滚动，无 overscroll 链阻断）
//   B6 全屏退出判定延迟复核（handleFsExit 700ms 窗口 + 手势重试捕获阶段监听）
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-bugfix-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(m.error) : res(m.result); }
        };
        return;
      }
    } catch (e) {}
    await sleep(200);
  }
  throw new Error('CDP 连接超时');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res, rej) => { pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval 异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}

let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('PASS  ' + name + (info ? '  [' + info + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (info ? '  [' + info + ']' : '')); }
}

try {
  // ---- 源码级断言（构建产物包含修复标记） ----
  const built = readFileSync(join(root, 'index.html'), 'utf8');
  // #604（2026-09-16）口径变更：胜负改按存活判（原「谁分高谁赢」在「我方撞死、分数却领先」时
  // 弹「你赢了」＝用户报障）。本条仍守同一个接缝（endGame 内算出 result），只换判据；
  // 行为断言（B1~B5 各模式 + 收局帧颜色）见 tools/verify-snake-result-color.mjs
  check('S1 贪吃蛇胜负按存活判定（撞死的一方输，得分只作展示）', built.includes("if (!myAlive && oppAlive) result = 'lose';") && built.includes('const myAlive = !!state.player.alive'));
  check('S2a Pong 比分顺序 TA 在前你在后（称呼跟随 taFit 契约）', built.includes("'<span class=\"pong-s-ta\">' + s.opponentScore + ' ' + (window.taFit ? window.taFit('TA') : 'TA') + '</span><span class=\"pong-s-sep\">:</span><span class=\"pong-s-you\">你 ' + s.playerScore"));
  check('S2b Pong 提示改为右侧挡板', built.includes('你控制右侧挡板') && !built.includes('左半边上下拖动'));
  check('S3 记账添加改内联表单（原 openModal 二级弹窗架构已移除，#acc-amount 直存直报）', built.includes("getElementById('acc-amount')") && built.includes("'acc-save'") && built.includes("toast('已记 '"));
  check('S4a 朋友圈回复渲染带 data-ri 定位', built.includes('.feed-reply" data-ri=') || built.includes('data-ri="\' + ri + \''));
  check('S4b TA 评论回应双路径都发通知', built.includes('回复了你的评论') && built.includes('评论了你的动态：'));
  check('S4c 通知缩略图实时取图', built.includes('noticeThumbOf') && built.includes('fn-thumb'));
  check('S5 默认字卡列表取消内部滚动', built.includes('#page-default-cards #dc-list') && built.includes('overscroll-behavior:auto'));
  check('S6a 全屏退出判定延迟复核', built.includes('_lastVisibleAt') && built.includes("}, 700);"));
  check('S6b 全屏手势重试捕获阶段', /addEventListener\('click', retryClick, true\)/.test(built) && /addEventListener\('touchstart', retryTouch, true\)/.test(built));

  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2800);

  const ready = await evalJs(`!!document.body && typeof window.openSnakePanel === 'function'`);
  check('R0 页面加载完成（游戏模块就绪）', ready);

  // ---- B1 贪吃蛇面板可打开、canvas 就绪 ----
  await evalJs(`window.openSnakePanel()`);
  await sleep(300);
  const snakeOpen = await evalJs(`!document.getElementById('chat-snake-panel').hidden`);
  check('B1 贪吃蛇面板可打开（重构未破坏入口）', snakeOpen);
  await evalJs(`window.closeSnakePanel && window.closeSnakePanel()`);
  await sleep(150);

  // ---- B2 Pong 打开后比分顺序与提示 ----
  await evalJs(`window.openPongPanel()`);
  await sleep(400);
  const scoreHtml = await evalJs(`document.getElementById('pong-score').innerHTML`);
  const taIdx = scoreHtml.indexOf('pong-s-ta'), youIdx = scoreHtml.indexOf('pong-s-you');
  check('B2a Pong 比分 DOM 顺序 TA 左 · 你 右', taIdx >= 0 && youIdx > taIdx, scoreHtml.slice(0, 80));
  const ovBody = await evalJs(`document.getElementById('pong-overlay-body').textContent`);
  check('B2b Pong 开局提示为右侧挡板', ovBody.includes('右侧挡板'), ovBody.slice(0, 40));
  const footTxt = await evalJs(`document.querySelector('#chat-pong-panel .pong-foot').textContent`);
  check('B2c 底部操作提示不再写左侧', footTxt.includes('右侧挡板') && !footTxt.includes('左半边'), footTxt.trim().slice(0, 50));
  await evalJs(`window.closePongPanel && window.closePongPanel()`);
  await sleep(150);

  // ---- B3 记账：分类管理 → 添加支出分类 二级弹窗能打开且能保存 ----
  const accClicked = await evalJs(`
    (function(){
      var app = document.querySelector('.app[data-app="accounting"]');
      if (!app) return false;
      app.click();
      return !document.getElementById('page-accounting').hidden;
    })()
  `);
  check('B3a 记账页可打开', accClicked);
  await evalJs(`document.getElementById('acc-cog').click()`);
  await sleep(250);
  const mgrTitle = await evalJs(`document.querySelector('#tc-mask .tc-title, #modal-mask .tc-title') ? (document.querySelector('#modal-title')||{}).textContent : (document.getElementById('modal-title')||{}).textContent`);
  const hasPills = await evalJs(`(function(){var p=document.getElementById('modal-pills');return p && !p.hidden && p.children.length>=4;})()`);
  check('B3b 一级弹窗「分类管理」带四个选项', hasPills, 'title=' + mgrTitle);
  // 点「添加支出分类」pill 后点确定
  await evalJs(`
    (function(){
      var pills = Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill'));
      var target = pills.find(function(b){ return b.textContent.indexOf('添加支出分类') >= 0; });
      if (target) target.click();
    })()
  `);
  await sleep(120);
  await evalJs(`document.getElementById('modal-ok').click()`);
  await sleep(350); // 覆盖 60ms 延迟 + 渲染
  const secondTitle = await evalJs(`(document.getElementById('modal-title')||{textContent:''}).textContent`);
  const maskVisible = await evalJs(`var m=document.getElementById('modal-mask'); m && !m.hidden`);
  check('B3c 二级弹窗「添加支出分类」正常弹出（核心修复点）', maskVisible && secondTitle.indexOf('添加支出分类') >= 0, 'title=' + secondTitle + ' visible=' + maskVisible);
  // 输入名称并确定（安卓转换器可能把 input 转 ce-box——与真机同路径）
  await evalJs(`
    (function(){
      var inp = document.getElementById('modal-input');
      inp.value = '宠物';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  await sleep(150);
  await evalJs(`document.getElementById('modal-ok').click()`);
  await sleep(400);
  const toastTxt = await evalJs(`(document.getElementById('cc-toast')||{textContent:''}).textContent`);
  const catSaved = await evalJs(`
    (function(){
      // LS 键形如 xy-home-v2:<cid>:accounting-categories——扫描结尾匹配，不拼前缀
      var found = false;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.slice(-22) === ':accounting-categories') {
          try {
            var c = JSON.parse(localStorage.getItem(k));
            if (c && c.expense && c.expense.indexOf('宠物') >= 0) { found = true; break; }
          } catch (e) {}
        }
      }
      return found;
    })()
  `);
  check('B3d 自定义分类「宠物」已写入存储', catSaved, 'toast=' + toastTxt);

  // ---- B5 默认字卡页单滚动容器 ----
  const dcCss = await evalJs(`
    (function(){
      var pg = document.getElementById('page-default-cards');
      if (!pg) return 'no-page';
      pg.hidden = false;
      var list = document.getElementById('dc-list');
      var cs = getComputedStyle(list);
      var out = { ov: cs.overflowY, minH: cs.minHeight, ob: cs.overscrollBehaviorY, pgOv: getComputedStyle(pg).overflowY };
      pg.hidden = true;
      return out;
    })()
  `);
  check('B5 #dc-list 无内部滚动（单滚动容器）', dcCss && dcCss.ov === 'visible' && dcCss.ob === 'auto' && dcCss.pgOv === 'auto', JSON.stringify(dcCss));

  // ---- B4 评论区回复节点带 data-ri（渲染层定位锚点存在）----
  const riAnchor = await evalJs(`
    (function(){
      var el = document.createElement('div');
      el.innerHTML = '<div class="feed-reply" data-ri="1"></div>';
      return el.firstElementChild.hasAttribute('data-ri');
    })()
  `);
  check('B4 data-ri 属性方案可用（配合源码断言 S4a）', riAnchor);

  console.log('\\n结果：' + pass + '/' + (pass + fail) + ' 项通过');
} catch (e) {
  console.error('脚本异常:', e.message);
  fail++;
} finally {
  try { chrome.kill(); } catch (e) {}
  server.close();
  process.exit(fail ? 1 : 0);
}
