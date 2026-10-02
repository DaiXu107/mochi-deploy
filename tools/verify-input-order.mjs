// ===== 回归脚本：#660 输入栏按钮位置（统一管理）=====
// 用法：node tools/verify-input-order.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-input-order.mjs   （测临时构建副本，红绿对照）
// 用户需求（2026-09-17）：聊天设置里能自定义底部输入栏这一排图标的左右位置，并且要把
// 「打开开关后才出现的」语音（麦克风）与批量发送按钮一并纳入——位置管理与各按钮的开关
// 互不冲突、互不影响，是一个统一管理入口。
// 断言：
//   A 轴（源码锚）：模板里两处输入栏都挂了 data-io 令牌 + 设置行 #cs-input-order 在位；
//                   chat.js 持有令牌表 / flex order 落点 / 改完即时重排接线；
//                   面板写回存档、开合同步 hidden（滚动锁）；登记进移动端浮层清单；
//                   功能介绍页有条目；数据就绪后补算一次输入栏按钮显隐（#660附）。
//   B 轴（真实产物）：默认顺序 = 麦克风→继续说→更多→表情→输入框→图片→批量发送，发送恒最后；
//                     开三个开关后按钮按默认位置出现；设置行开面板 → 列表 7 项、面板期背景被锁；
//                     调整顺序 → 存档 cs-input-order 生效、两排同步换位、发送仍在最后；
//                     刷新后保持（存档与视觉两层都查）；
//                     有开关的按钮被移到新位置后关掉再打开，它出现在保存的位置（不是回原位）；
//                     恢复默认 → 顺序回默认且存档键被清掉；零 JS 异常。
//   #660附 判别点：把「继续说」开关打开后刷新，聊天输入栏的「继续说」按钮必须仍然可见
//                 （旧产物里冷启动恒隐藏，要切一次联系人才出现——本条在修复前恰红）。
// RED 判别（修复前旧产物实测）：A 轴全红（无令牌/无入口/无面板）；把 chat.js 的
//   `el.style.order = ...` 一行去掉、只留函数名与全局 API 后，B 轴 6 条转红——「名字在、
//   逻辑变」也拦得住；去掉 chat.js 末尾的 restore-done 补算监听，#660附 那条转红。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---------- A 轴：源码锚 ----------
// 读进来统一把 CRLF 折成 LF 再比对：仓库里各文件的换行并不一致（同一份 src 既可能被
// 编辑器整体重写成 CRLF、也可能是 LF），锚点里带 \n 的多行特征不该因此假红
// （build.mjs 的哨兵侧是逐行 trim 后再比，天然不受影响；这里补上同一层健壮性）。
const rd = (p) => { try { return readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n'); } catch (e) { return ''; } };
const tpl = rd('src/template.html'), chat = rd('src/js/chat.js'), cs = rd('src/js/chat-settings.js'),
      gc = rd('src/js/group-chat.js'),
      hub = rd('src/js/feature-hub.js'), ma = rd('src/js/mobile-adapt.js');

const ioCount = (src, tok) => (src.match(new RegExp('data-io="' + tok + '"', 'g')) || []).length;
check('A1 两处输入栏都挂令牌（聊天页 + 群聊各 7 个 data-io）',
  ioCount(tpl, 'mic') === 2 && ioCount(tpl, 'input') === 2 && ioCount(tpl, 'batch') === 2,
  'mic=' + ioCount(tpl, 'mic') + ' input=' + ioCount(tpl, 'input') + ' batch=' + ioCount(tpl, 'batch'));
check('A2 设置行 #cs-input-order + 当前状态回显位在位',
  tpl.includes('id="cs-input-order"') && tpl.includes('id="cs-input-order-val"'));
check('A3 令牌表与默认顺序（7 项，含开关型的 mic/continue/batch 与输入框）',
  chat.includes("const INPUT_IO_TOKENS = ['mic', 'continue', 'more', 'emoji', 'input', 'img', 'batch'];"));
check('A4 顺序落在 flex order（不动 DOM 结构）', chat.includes('el.style.order = String(INPUT_IO_ORDER_BASE'));
check('A5 发送按钮固定收尾（恒在最后，不参与排序）', chat.includes('send.style.order = String(INPUT_IO_SEND_ORDER)'));
check('A6 改完即时重排接线 + 切联系人/回填后就绪重排',
  chat.includes("document.addEventListener('chat-input-order-changed', applyInputBtnOrder);")
  && chat.includes("document.addEventListener('contact-switched', applyInputBtnOrder);"));
check('A7 面板把调整写回 cs-input-order 存档', cs.includes('window.mochiInputOrder.write(order);'));
check('A8 抽屉开合同步 hidden（滚动锁监听 hidden，只改 display 要等 1s 看门狗）',
  cs.includes('d.hidden = false;') && cs.includes('m.hidden = true;'));
check('A9 面板有稳定钩子（回归/自动化按令牌定位移向按钮）',
  cs.includes("rowEl.setAttribute('data-io-row', t);") && cs.includes("mv.setAttribute('data-io-move', String(dir));"));
check('A10 面板登记进移动端浮层清单（否则面板期底层设置页仍可滑动；#1120 起登记名＝抽屉 id）', ma.includes("'#io-order-drawer',"));
check('A11 功能介绍页有条目', hub.includes("'#cs-input-order'"));
check('A12 #660附 数据就绪后补算三个开关按钮显隐（删掉＝「继续说」开着却在冷启动后不显示）',
  chat.includes("try { syncMicBtn(); } catch (e) {}\ntry { syncBatchBtn(); } catch (e) {}\ntry { if (window.applyContinueSayUI) window.applyContinueSayUI(); } catch (e) {}"));
// v3.27.x：群聊设置侧入口（用户「群聊设置里可以和聊天设置里一样移动这个按钮的位置」）——
// 面板只有一份（chat-settings.js 暴露、group-chat.js 调用），顺序本就是两页共用的 cs-input-order
check('A13 面板对外暴露成共享入口（群聊设置复用同一份，不做第二套排序 UI）',
  cs.includes('window.mochiInputOrderPanel = {') && cs.includes('open: openInputOrderPanel') && cs.includes('valueText:'));
check('A14 群聊设置「通用」里有「输入栏按钮位置」一行并打开同一个面板',
  gc.includes("id = 'gc-input-order-row'") && gc.includes('window.mochiInputOrderPanel.open()'));
// A15 群聊顶部那枚恒显继续说（#674）已按用户要求彻底撤销（#797 定口径＋2026-09-23 二次直派补完）：
// 唯一入口＝底部输入栏那枚，位置/显隐与单聊同源（verify-gc-continue A2/A3 钉住）。此针与删除型
// 哨兵 #674（absent）同位——template 里回流一个 DOM 节点就报红。
check('A15 群聊顶部继续说入口已彻底移除、不得回流（与删除型哨兵 #674 同位）',
  !tpl.includes('gc-head-continue') && !gc.includes('gc-head-continue') && !gc.includes('gcHeadContinueBtn'));
if (results.some(r => !r.ok)) {
  console.log('----');
  console.log('A 轴有 FAIL：源码锚缺失（功能被覆盖或未接入），B 轴跳过');
  process.exit(1);
}

// ---------- B 轴：真实浏览器行为 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) {
  console.log('----');
  console.log('环境不满足：找不到 Chrome/Edge（设 CHROME_PATH 后重跑）');
  process.exit(2);
}

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (10260 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-660v-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const jsErrors = [];
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
          if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params && m.params.exceptionDetails;
            jsErrors.push((d && d.exception && d.exception.description || d && d.text || 'js error').slice(0, 200));
          }
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
      jsErrors.push((r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval err').slice(0, 200));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function bootToReady() {
  for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
  await sleep(500);
  // 全新环境启动会弹「数据备份提醒」（产品功能，会挂 scroll-lock）：不关掉它会污染
  // 「面板开了/关了背景锁状态」的判定。这里先按取消（保底按确定）收掉，再开始测。
  await evalJs(`(function(){
    var m=document.getElementById('modal-mask');
    if (m && getComputedStyle(m).display !== 'none') {
      var c=document.getElementById('modal-cancel');
      if (c && !c.hidden) c.click();
      else { var o=document.getElementById('modal-ok'); if (o) o.click(); }
    }
    return 1;
  })()`);
  await sleep(400);
}
const openChat = async () => {
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]'); if(a) a.click(); return 1;})()");
  await sleep(700);
};
const backToChat = async () => { // 从聊天设置返回聊天页（视觉顺序只能在聊天页可见时按 left 量）
  await evalJs("(function(){var b=document.getElementById('cs-back'); if(b) b.click(); return 1;})()");
  await sleep(500);
};
const openPanel = async () => {
  await evalJs("(function(){var s=document.getElementById('chat-settings-btn'); if(s) s.click(); return 1;})()");
  await sleep(450);
  await evalJs("(function(){var t=document.querySelector('#cs-func-tags .them-tab[data-ft=\"msg\"]'); if(t) t.click(); return 1;})()");
  await sleep(150);
  await evalJs("(function(){var r=document.getElementById('cs-input-order'); if(r) r.click(); return 1;})()");
  // #1120：点行＝切到聊天页并开底部抽屉；滚动锁由 mobile-adapt 巡检补挂（hidden 未变化＝
  // 观察器不触发），所以这里等过 1s 看门狗再判 B4/B5。
  await sleep(1300);
};
// 视觉顺序：按实际布局的 left 排序可见令牌 + 全体令牌的 order 值 + 发送按钮是否仍在最后
const VISUAL = `(function(){
  var row=document.querySelector('#page-chat .chat-input-row'); if(!row) return 'no-row';
  var els=Array.prototype.slice.call(row.querySelectorAll('[data-io]'));
  var vis=els.filter(function(e){ var r=e.getBoundingClientRect(); return r.width>0; });
  vis.sort(function(a,b){ return a.getBoundingClientRect().left-b.getBoundingClientRect().left; });
  var send=row.querySelector('.chat-send');
  var sr=send?send.getBoundingClientRect():null;
  var lastVis=vis.length?vis[vis.length-1].getBoundingClientRect():null;
  var grow=document.querySelector('#page-group-chat .chat-input-row');
  return JSON.stringify({
    visible: vis.map(function(e){ return e.getAttribute('data-io'); }).join(','),
    orderAttr: els.map(function(e){ return e.getAttribute('data-io')+':'+e.style.order; }).join(','),
    sendLast: !!(sr && lastVis && sr.left>=lastVis.left),
    gcOrder: grow?Array.prototype.slice.call(grow.querySelectorAll('[data-io]')).map(function(e){ return e.getAttribute('data-io')+':'+e.style.order; }).join(','):'none',
    continueBtn: (function(){ var b=document.getElementById('chat-continue-btn'); return b?(b.style.display==='none'?'hidden':'shown'):'missing'; })()
  });
})()`;
// 期望的 order 值串：按【DOM 顺序】列出各令牌当前拿到的 order（= 10 + 存档下标*10）
const orderAttrOf = (arr) => ['mic', 'continue', 'more', 'emoji', 'input', 'img', 'batch']
  .map((t) => t + ':' + (10 + arr.indexOf(t) * 10)).join(',');

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(1500);
  await evalJs("(function(){ try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} return 1; })()");
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2200);
  await bootToReady();
  await openChat();

  const DEF = ['mic', 'continue', 'more', 'emoji', 'input', 'img', 'batch'];
  let b = await evalJs(VISUAL);
  let o = null; try { o = JSON.parse(b); } catch (e) {}
  check('B1 默认排序值写在每个令牌上（10 起递增，发送 999 恒最后）',
    !!o && o.orderAttr === orderAttrOf(DEF) && o.sendLast, b);
  check('B2 默认可见顺序（三个开关未开时）= 更多→表情→输入框→图片，发送在最后',
    !!o && o.visible === 'more,emoji,input,img' && o.sendLast, b);
  check('B2b 群聊输入栏默认就拿到同一份顺序（两排共用）', !!o && o.gcOrder === o.orderAttr, b);

  // B3 打开三个开关（走真实开关 UI）→ 语音/继续说/批量发送按默认位置现身
  await evalJs(`(function(){
    var v=document.getElementById('cs-voice-send'); if(v && !v.checked) v.click();
    var bb=document.getElementById('cs-batch-send'); if(bb && !bb.checked) bb.click();
    var c=document.getElementById('cs-trigger-bar'); if(c && !c.checked) c.click();
    return 1;
  })()`);
  await sleep(500);
  b = await evalJs(VISUAL);
  o = null; try { o = JSON.parse(b); } catch (e) {}
  check('B3 开开关后三个按钮按默认位置出现（麦克风→继续说→…→批量发送）',
    !!o && o.visible === DEF.join(','), b);

  // B4/B5 设置行 → 面板：列表 7 项 + 说明 + 面板期背景被锁
  await openPanel();
  const b45 = await evalJs(`(function(){
    var m=document.getElementById('io-order-drawer');
    if (!m || m.style.display !== 'flex' || m.hidden) return 'panel-closed';
    var rows=m.querySelectorAll('[data-io-row]');
    var txt=(m.textContent||'');
    return JSON.stringify({
      n: rows.length,
      seq: Array.prototype.map.call(rows, function(r){ return r.getAttribute('data-io-row'); }).join(','),
      hasSend: txt.indexOf('发送') >= 0,
      hint: txt.indexOf('不影响各按钮的开关与显隐') >= 0,
      lock: document.body.classList.contains('scroll-lock'),
      overflow: getComputedStyle(document.body).overflow,
      openList: (window.scrollLockInfo ? (window.scrollLockInfo() || {}).open || [] : []).join(',')
    });
  })()`);
  o = null; try { o = JSON.parse(b45); } catch (e) {}
  check('B4 面板打开且按当前顺序列出全部 7 项（含开关型按钮与输入框）+ 说明在位',
    !!o && o.n === 7 && o.seq === DEF.join(',') && o.hasSend && o.hint, b45);
  check('B5 面板打开时背景立刻被锁（hidden 同步＝不等 1s 看门狗；锁的正是本面板）',
    !!o && o.lock === true && o.overflow === 'hidden' && o.openList.indexOf('#io-order-drawer') >= 0, b45);

  // B6 把「插入图片」左移 3 次 → 越过输入框到左侧；存档与面板列表同步
  for (let i = 0; i < 3; i++) {
    await evalJs(`(function(){var r=document.querySelector('#io-order-drawer [data-io-row="img"] [data-io-move="-1"]'); if(r){r.click(); return 1;} return 0;})()`);
    await sleep(150);
  }
  const AFTER_IMG = ['mic', 'continue', 'img', 'more', 'emoji', 'input', 'batch'];
  let b6 = await evalJs(`(function(){
    var p=document.getElementById('io-order-drawer');
    return JSON.stringify({
      perCid: localStorage.getItem('xy-home-v2:default:cs-input-order'),
      seq: Array.prototype.map.call(p.querySelectorAll('[data-io-row]'), function(r){ return r.getAttribute('data-io-row'); }).join(','),
      posNote: (p.textContent||'').indexOf('第 4 位') >= 0
    });
  })()`);
  o = null; try { o = JSON.parse(b6); } catch (e) {}
  let saved = null; try { saved = JSON.parse(o.perCid); } catch (e) {}
  check('B6 左移 3 次：存档 cs-input-order（每联系人键）= 图片落到输入框左侧第 4 位',
    !!(saved && saved.join(',') === AFTER_IMG.join(',')) && o.seq === AFTER_IMG.join(','), b6);

  // B7 把「麦克风」右移 6 次到最右 → 位置管理连开关型按钮一起管
  for (let i = 0; i < 6; i++) {
    await evalJs(`(function(){var r=document.querySelector('#io-order-drawer [data-io-row="mic"] [data-io-move="1"]'); if(r){r.click(); return 1;} return 0;})()`);
    await sleep(150);
  }
  const AFTER_MIC = ['continue', 'img', 'more', 'emoji', 'input', 'batch', 'mic'];
  const b7 = await evalJs(`localStorage.getItem('xy-home-v2:default:cs-input-order')`);
  saved = null; try { saved = JSON.parse(b7); } catch (e) {}
  check('B7 麦克风右移 6 次到最右（开关型按钮同样可管）',
    !!(saved && saved.join(',') === AFTER_MIC.join(',')), b7);

  // B8 关面板回聊天页 → 那排真的换位、发送仍在最后、群聊同步
  await evalJs("(function(){var m=document.getElementById('io-order-drawer'); if(m){ m.hidden=true; m.style.display='none'; } return 1;})()");
  await backToChat();
  b = await evalJs(VISUAL);
  o = null; try { o = JSON.parse(b); } catch (e) {}
  check('B8 聊天页那排真的换位（麦克风在最右）且发送仍在最后',
    !!o && o.visible === AFTER_MIC.join(',') && o.sendLast, b);
  check('B8b 群聊输入栏同步换位', !!o && o.gcOrder === orderAttrOf(AFTER_MIC), b);
  const lockAfterClose = await evalJs(`(function(){
    var m=document.getElementById('modal-mask');
    return JSON.stringify({ lock: document.body.classList.contains('scroll-lock'),
      info: window.scrollLockInfo ? window.scrollLockInfo() : null,
      modal: m ? { hidden: m.hidden, display: getComputedStyle(m).display, title: (document.getElementById('modal-title')||{}).textContent } : 'none' });
  })()`);
  let lk = null; try { lk = JSON.parse(lockAfterClose); } catch (e) {}
  check('B8c 面板关闭后背景解锁（残留锁会让设置页/聊天页整体滑不动）',
    !!lk && lk.lock === false, lockAfterClose);

  // B9 刷新：存档与视觉两层都保持；#660附「继续说」按钮冷启动仍可见
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2300);
  await bootToReady();
  await openChat();
  b = await evalJs(VISUAL);
  o = null; try { o = JSON.parse(b); } catch (e) {}
  check('B9 刷新后自定义顺序保持（order 值来自存档，与显隐无关）',
    !!o && o.orderAttr === orderAttrOf(AFTER_MIC), b);
  check('B9b 刷新后视觉顺序仍是自定义的那份', !!o && o.visible === AFTER_MIC.join(','), b);
  check('B10 [#660附] 开关开着的「继续说」按钮冷启动后仍可见（旧产物此处恒隐藏，要切联系人才出现）',
    !!o && o.continueBtn === 'shown', b);

  // B11 位置与开关互不影响：关掉「录音」→ 只少了它、其余相对位置不变；再打开 → 回到保存的最右位
  await evalJs("(function(){var v=document.getElementById('cs-voice-send'); if(v && v.checked) v.click(); return 1;})()");
  await sleep(400);
  b = await evalJs(VISUAL);
  o = null; try { o = JSON.parse(b); } catch (e) {}
  check('B11 关掉「录音」开关：只少了麦克风，其余按钮位置纹丝不动',
    !!o && o.visible === ['continue', 'img', 'more', 'emoji', 'input', 'batch'].join(','), b);
  await evalJs("(function(){var v=document.getElementById('cs-voice-send'); if(v && !v.checked) v.click(); return 1;})()");
  await sleep(400);
  b = await evalJs(VISUAL);
  o = null; try { o = JSON.parse(b); } catch (e) {}
  check('B12 再打开开关：麦克风回到保存的最右位（不是回原位＝位置与显隐两套配置互不覆盖）',
    !!o && o.visible === AFTER_MIC.join(','), b);

  // B13 恢复默认 → 存档键被清掉 + 设置行回显 + 两排回默认
  await openPanel();
  await evalJs(`(function(){
    var m=document.getElementById('io-order-drawer');
    var bs=m.querySelectorAll('button');
    for (var i=0;i<bs.length;i++) { if (bs[i].textContent === '恢复默认排列') { bs[i].click(); return 1; } }
    return 0;
  })()`);
  await sleep(300);
  const b13 = await evalJs(`JSON.stringify({ perCid: localStorage.getItem('xy-home-v2:default:cs-input-order'), rowVal: (document.getElementById('cs-input-order-val')||{}).textContent })`);
  o = null; try { o = JSON.parse(b13); } catch (e) {}
  check('B13 恢复默认：存档键被清掉 + 设置行回显「默认排列」',
    !!o && !o.perCid && o.rowVal === '默认排列', b13);
  await evalJs("(function(){var m=document.getElementById('io-order-drawer'); if(m){ m.hidden=true; m.style.display='none'; } return 1;})()");
  await backToChat();
  b = await evalJs(VISUAL);
  o = null; try { o = JSON.parse(b); } catch (e) {}
  check('B14 恢复默认后两排顺序回默认、发送仍在最后',
    !!o && o.visible === DEF.join(',') && o.orderAttr === orderAttrOf(DEF) && o.gcOrder === orderAttrOf(DEF) && o.sendLast, b);

  // B15 功能介绍页入口真能进：按 feature-hub 的 go 数组原样点（聊天 app → 聊天设置 → 本行），
  //     **不预先切到「消息」子标签**——真实用户从功能大全点进来时那行正被分类过滤器藏着，
  //     这条断言就是查「藏着也是可点的」，同时覆盖「面板不是只在设置页里能打开」。
  await evalJs("(function(){var b=document.getElementById('cs-back'); if(b) b.click(); return 1;})()");
  await sleep(300);
  await evalJs("(function(){var m=document.getElementById('io-order-drawer'); if(m){ m.hidden=true; m.style.display='none'; } return 1;})()");
  await sleep(150);
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]'); if(a) a.click(); var s=document.getElementById('chat-settings-btn'); if(s) s.click(); var r=document.getElementById('cs-input-order'); if(r) r.click(); return 1;})()");
  await sleep(400);
  const b15 = await evalJs(`(function(){
    var m=document.getElementById('io-order-drawer');
    if (!m || m.style.display !== 'flex' || m.hidden) return 'panel-closed';
    return JSON.stringify({ seq: Array.prototype.map.call(m.querySelectorAll('[data-io-row]'), function(r){ return r.getAttribute('data-io-row'); }).join(',') });
  })()`);
  o = null; try { o = JSON.parse(b15); } catch (e) {}
  check('B15 功能介绍页入口（功能大全 → 聊天设置 → 本行，不先切子标签）也能开面板且列全 7 项',
    !!o && o.seq === DEF.join(','), b15);

  check('B16 全程零 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));

  // B17 切联系人时面板必须收掉：面板是挂在 body 上的固定浮层（不在 .page 里，切页面不会跟着
  //     隐藏），留着就是「盖在桌面上、内容是上一个联系人」的僵尸层。这里不真切桌面，直接派发
  //     contact-switched（就是切桌面时那条事件），断言面板被收掉。
  await evalJs("(function(){var r=document.getElementById('cs-input-order'); if(r) r.click(); return 1;})()");
  await sleep(250);
  const openedForSwitch = await evalJs("(function(){var m=document.getElementById('io-order-drawer'); return !!(m && m.style.display==='flex' && !m.hidden);})()");
  await evalJs("document.dispatchEvent(new Event('contact-switched')); 1");
  await sleep(250);
  const afterSwitch = await evalJs("(function(){var m=document.getElementById('io-order-drawer'); return JSON.stringify({ hidden: !!m.hidden, display: m.style.display, lock: document.body.classList.contains('scroll-lock') }); })()");
  o = null; try { o = JSON.parse(afterSwitch); } catch (e) {}
  check('B17 切联系人后面板自动收掉（不留僵尸浮层）+ 背景解锁',
    openedForSwitch === true && !!o && o.hidden === true && o.display === 'none' && o.lock === false, afterSwitch);

  // B18 群聊设置侧入口（v3.27.x 用户直派「群聊设置里可以和聊天设置里一样移动这个按钮的位置」）：
  //     群聊页 → 三点菜单 → 群聊设置 → 「通用」tag → 「输入栏按钮位置」，点开必须就是同一个
  //     面板（不是第二套 UI），且在这里移一次群聊输入栏立刻跟着换位（两页共用一份 cs-input-order）。
  //     每步都带空值判断：旧产物里没有这一行时只让 B18/B18b 报红，不抛异常（否则污染 B16 零异常判定）。
  await evalJs("(function(){var m=document.getElementById('io-order-drawer'); if(m){ m.hidden=true; m.style.display='none'; } document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-group-chat');}); return 1;})()");
  await sleep(250);
  await evalJs("(function(){var mo=document.getElementById('gc-more-btn'); if(mo) mo.click(); return 1;})()");
  await sleep(200);
  await evalJs("(function(){var s=document.getElementById('gc-more-settings'); if(s) s.click(); return 1;})()");
  await sleep(400);
  await evalJs("(function(){var t=document.querySelector('#gc-set-body .gc-set-tabs .them-tab[data-gt=\"general\"]'); if(t) t.click(); return 1;})()");
  await sleep(250);
  const b18a = await evalJs(`(function(){
    var r=document.getElementById('gc-input-order-row');
    var p=document.getElementById('gc-settings-panel');
    if (!r) return JSON.stringify({ row: false, settingsOpen: !!p && p.hidden === false });
    r.click();
    var m=document.getElementById('io-order-drawer');
    return JSON.stringify({
      row: true,
      settingsOpen: !!p && p.hidden === false,
      open: !!(m && m.style.display === 'flex' && !m.hidden),
      n: m ? m.querySelectorAll('[data-io-row]').length : 0,
      seq: m ? Array.prototype.map.call(m.querySelectorAll('[data-io-row]'), function(x){ return x.getAttribute('data-io-row'); }).join(',') : '',
      val: ((r.querySelector('.gc-set-desk')||{}).textContent) || ''
    });
  })()`);
  o = null; try { o = JSON.parse(b18a); } catch (e) {}
  check('B18 群聊设置「通用」里的入口点开同一个排序面板（列全 7 项 + 回显当前排列）',
    !!o && o.row === true && o.settingsOpen === true && o.open === true && o.n === 7 && o.seq === DEF.join(',') && o.val === '默认排列', b18a);
  const b18b = await evalJs(`(function(){
    var m=document.getElementById('io-order-drawer');
    var r=m && m.querySelector('[data-io-row="img"]');
    var mv=r && r.querySelector('[data-io-move="-1"]');
    if (mv) mv.click();
    var row=document.querySelector('#page-group-chat .chat-input-row');
    var g=function(t){ var e=row && row.querySelector('[data-io="'+t+'"]'); return e?e.style.order:null; };
    var rr=document.getElementById('gc-input-order-row');
    return JSON.stringify({ img: g('img'), more: g('more'), val: rr ? (((rr.querySelector('.gc-set-desk')||{}).textContent) || '') : '' });
  })()`);
  await sleep(300);
  o = null; try { o = JSON.parse(b18b); } catch (e) {}
  // 期望值按 chat.js 的 10+下标*10 现算：默认序里 img 在下标 5＝60，左移一次与输入框换位
  // → img 下标 4＝50、more 仍下标 2＝30。（这条原先写死 '20'，是 #660 早期口径；A15 长期挂红
  //  把 B 轴整段 gate 掉了，所以一直没人看见它也对不上。）
  check('B18b 在群聊侧面板里移一次：群聊输入栏立刻换位 + 行内回显转「已自定义」',
    !!o && o.img === '50' && o.more === '30' && o.val === '已自定义', b18b);
  await evalJs("(function(){var m=document.getElementById('io-order-drawer'); if(m){ var bs=m.querySelectorAll('button'); for(var i=0;i<bs.length;i++){ if(bs[i].textContent==='恢复默认排列'){ bs[i].click(); break; } } m.hidden=true; m.style.display='none'; } return 1;})()");
  await sleep(250);
} catch (e) {
  check('B 轴执行异常：' + (e && e.message), false);
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}

const pass = results.filter(r => r.ok).length;
console.log('----');
console.log('verify-input-order: ' + pass + '/' + results.length + (pass === results.length ? ' 全绿' : ' 有 FAIL'));
process.exit(pass === results.length ? 0 : 1);
