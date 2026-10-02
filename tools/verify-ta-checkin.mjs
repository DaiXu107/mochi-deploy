// ===== 专项回归：TA主动查岗字卡库「TA的查岗」（ck-question.js v3.13.x） =====
// 用户反馈：联系人对我进行查岗时，字卡库里没有【TA的查岗】字卡库——预设问题没入库、不能自定义新增。
// 修复：18 张预设查岗问题入库（逐条开关/不可删/useDefault 总开关）+ 自定义新增（文字/单选）
//       + 分组 + 批量导入文字题 + 跨分类搜索 + 字卡库双入口 + 计数 + IDB 权威恢复。
// 用例：
//   T1 入库：__ckBankInfo total/preset=17、mine=0、useDefault=true；字卡库双入口存在
//   T2 管理页：主入口进系统预设视图（分类子标签渲染）、我的添加入口进自定义视图、返回键
//   T3 自定义新增：批量导入 2 条文字题 → 单选题表单（选项~回应;回应 解析）→ 删除一条
//   T4 开关口径：关 1 张预设 enabledPool-1；关「使用系统预设」只剩自定义；恢复后回到全量
//   T5 触发链路：triggerCkQuestion 推卡入聊天记录；ckQuestionTry 无开关拒绝/开开关概率100命中
//   T6 搜索注册 + 入口计数刷新
//   T7 IndexedDB 权威持久化（保存后有键）
//   T8 构建产物静态断言（页面/入口/键/FULL_PAGES/迟到弹窗守卫保留）
//   T9 加载至今无未捕获异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
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
// ---- 测试专用组装：按 build.mjs 同顺序把 template+css+js 拼成临时 index.html ----
// 不执行 node build.mjs、不碰仓库产物（多会话并行时避免构建冲突/扫入对方半成品）。
// 服务器优先回临时目录，未命中回退仓库根目录（图标/manifest 等静态资源照常可取）。
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'period.js', 'accounting.js', 'garden.js', 'decision.js', 'pong.js', 'snake-game.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'mobile-adapt.js'];
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => '(function () { try {\n' + readFileSync(join(root, 'src/js', f), 'utf8') + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();').join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-test-build').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-tacheckin-root-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(tmpRoot, rel));
    if (!p.startsWith(tmpRoot)) { res.writeHead(403); res.end(); return; }
    let hit = false;
    try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) {
      p = normalize(join(root, rel));
      if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
      try { hit = statSync(p).isFile(); } catch (e) {}
    }
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-tacheckin-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  await sleep(4500);

  console.log('\n== T1 题库入库 ==');
  const info1 = await evalJs('window.__ckBankInfo ? window.__ckBankInfo() : null');
  ok('__ckBankInfo 探针可用', !!info1, info1);
  ok('total=17 / preset=17 / mine=0', info1 && info1.total === 17 && info1.preset === 17 && info1.mine === 0, info1);
  ok('enabledPool=17 且 useDefault=true', info1 && info1.enabledPool === 17 && info1.useDefault === true, info1);
  const entries = await evalJs("({ sys: !!document.getElementById('li-ta-checkin'), mine: !!document.getElementById('li-ta-checkin-mine'), page: !!document.getElementById('page-ta-checkin'), tSys: (document.querySelector('#li-ta-checkin > .t')||{}).textContent, tMine: (document.querySelector('#li-ta-checkin-mine > .t')||{}).textContent })");
  ok('字卡库双入口 + 管理页锚点存在', entries && entries.sys && entries.mine && entries.page, entries);
  ok('入口计数初始 17 / 0', entries && entries.tSys === '17' && entries.tMine === '0', entries);
  console.log('\n== T2 管理页导航 ==');
  await evalJs("document.getElementById('li-ta-checkin').click(); true");
  await sleep(150);
  let st = await evalJs("({ pageHidden: document.getElementById('page-ta-checkin').hidden, sysHidden: document.getElementById('ckq-sys-panel').hidden, mineHidden: document.getElementById('ckq-mine-panel').hidden, tabs: Array.from(document.querySelectorAll('#ckq-sys-cats .cc-tab[data-cat]')).map(function(t){ return t.dataset.cat; }), rows: document.querySelectorAll('#ckq-sys-cats input[data-idx]').length, tabbarHidden: (document.querySelector('.tabbar')||{}).hidden })");
  ok('主入口进系统预设视图', st && st.pageHidden === false && st.sysHidden === false && st.mineHidden === true, st);
  ok('分类子标签渲染出 single/text 两类', st && Array.isArray(st.tabs) && st.tabs.indexOf('single') >= 0 && st.tabs.indexOf('text') >= 0, st && st.tabs);
  ok('预设题行已渲染（单选类 10 行）', st && st.rows === 10, st && st.rows);
  ok('全屏页隐藏底部 tabbar（FULL_PAGES 生效）', st && st.tabbarHidden === true, st && st.tabbarHidden);
  await evalJs("document.getElementById('ckq-back').click(); true");
  await sleep(100);
  await evalJs("document.getElementById('li-ta-checkin-mine').click(); true");
  await sleep(150);
  st = await evalJs("({ pageHidden: document.getElementById('page-ta-checkin').hidden, mineHidden: document.getElementById('ckq-mine-panel').hidden, batch: !!document.getElementById('ckq-batch'), emptyTip: (document.querySelector('#ckq-mine-cats .ta-empty')||{}).textContent || '' })");
  ok('「我的添加」入口进自定义视图（批量导入框可见）', st && st.pageHidden === false && st.mineHidden === false && st.batch === true, st);
  ok('空态提示展示', typeof (st && st.emptyTip) === 'string' && st.emptyTip.indexOf('暂未添加') >= 0, st && st.emptyTip);
  console.log('\n== T3 自定义新增 ==');
  await evalJs("(function(){ var ta=document.getElementById('ckq-batch'); ta.value='测试文字题甲\\n测试文字题乙'; document.getElementById('ckq-batch-add').click(); return true; })()");
  await sleep(150);
  let info = await evalJs('window.__ckBankInfo()');
  ok('批量导入 2 条文字题后 mine=2', info && info.mine === 2, info);
  const addRes = await evalJs("(function(){\n  try {\n    var sel = document.querySelector('#ckq-mine-cats .ta-type');\n    if (!sel) return 'no-form';\n    sel.value = 'single';\n    sel.dispatchEvent(new Event('change', { bubbles: true }));\n    var inp = document.getElementById('ckq-new-ctext');\n    var opts = document.getElementById('ckq-opts-ctext');\n    if (!inp || !opts) return 'no-inputs';\n    inp.value = '测试单选题？';\n    opts.value = '选项一~回应一;回应二\\n选项二';\n    var btn = document.querySelector('#ckq-mine-cats .ta-add-btn');\n    btn.click();\n    return 'ok';\n  } catch (e) { return String(e); }\n})()");
  await sleep(150);
  info = await evalJs('window.__ckBankInfo()');
  ok('单选题表单添加成功（mine=3）', addRes === 'ok' && info && info.mine === 3, { addRes, info });
  const singleQ = await evalJs("(function(){\n  try {\n    var d = JSON.parse(window.activeStore().get('ta-checkin'));\n    var q = d.questions.filter(function(x){ return x.isPreset !== true && x.type === 'single'; })[0];\n    if (!q) return null;\n    return { text: q.text, cat: q.cat, n: q.options.length, o0t: q.options[0].t, o0r: JSON.stringify(q.options[0].reply), o1rStr: typeof q.options[1].reply === 'string' };\n  } catch (e) { return String(e); }\n})()");
  ok('单选题解析：选项+「~」多条回应数组', singleQ && singleQ.text === '测试单选题？' && singleQ.cat === 'single' && singleQ.n === 2 && singleQ.o0t === '选项一' && singleQ.o0r === JSON.stringify(['回应一', '回应二']) && singleQ.o1rStr === true, singleQ);
  // 删除一条自定义（.ta-del）
  const delRes = await evalJs("(function(){\n  var btns = document.querySelectorAll('#ckq-mine-cats .ta-del');\n  if (!btns.length) return 'none';\n  btns[btns.length - 1].click();\n  return 'ok';\n})()");
  await sleep(150);
  info = await evalJs('window.__ckBankInfo()');
  ok('删除一条自定义后 mine=2', delRes === 'ok' && info && info.mine === 2, { delRes, info });

  console.log('\n== T4 开关口径 ==');
  await evalJs("document.getElementById('ckq-back').click(); true");
  await sleep(100);
  await evalJs("document.getElementById('li-ta-checkin').click(); true");
  await sleep(150);
  await evalJs("(function(){ var cb = document.querySelector('#ckq-sys-cats input[data-idx]'); cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
  info = await evalJs('window.__ckBankInfo()');
  ok('关掉 1 张预设后 enabledPool=18（16 预设启用 + 2 自定义），题仍在库 total=19', info && info.enabledPool === 18 && info.total === 19, info);
  await evalJs("(function(){ var el = document.getElementById('ckq-default'); el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
  await sleep(150);
  info = await evalJs('window.__ckBankInfo()');
  ok('关闭「使用系统预设」后只剩自定义（enabledPool=2）', info && info.useDefault === false && info.enabledPool === 2, info);
  await evalJs("(function(){ var el = document.getElementById('ckq-default'); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
  await sleep(100);
  // 恢复那张预设开关
  await evalJs("(function(){ var cbs = document.querySelectorAll('#ckq-sys-cats input[data-idx]'); for (var i=0;i<cbs.length;i++){ if(!cbs[i].checked){ cbs[i].checked = true; cbs[i].dispatchEvent(new Event('change',{bubbles:true})); break; } } return true; })()");
  info = await evalJs('window.__ckBankInfo()');
  ok('恢复后 enabledPool 回到全量（17+2=19）', info && info.useDefault === true && info.enabledPool === 19, info);
  console.log('\n== T5 触发链路 ==');
  await evalJs("(function(){ ['modal-mask','tc-mask','qa-mask'].forEach(function(id){ var el=document.getElementById(id); if(el) el.hidden=true; }); return true; })()");
  const trig = await evalJs('window.triggerCkQuestion()');
  await sleep(600);
  const tail = await evalJs("(function(){\n  try {\n    var a = window.getChatMsgs(); var card = null;\n    for (var i = a.length - 1; i >= 0; i--) { if (a[i] && a[i].special === 'ask-card') { card = a[i]; break; } }\n    return { ok: !!card, q: card ? (card.askQuestion || '') : '', type: card ? card.askType : '', lastAt: window.activeStore().get('ckq-last-at') || '' };\n  } catch (e) { return String(e); }\n})()");
  ok('triggerCkQuestion 返回 true', trig === true, trig);
  ok('查岗卡写入聊天记录（题面来自题库）', tail && tail.ok === true && tail.q && typeof tail.q === 'string' && tail.lastAt !== '', tail);
  // 卡片题面必须是库内某题文本
  const qInBank = await evalJs("(function(){ try { var a=window.getChatMsgs(); var card=null; for(var i=a.length-1;i>=0;i--){ if(a[i]&&a[i].special==='ask-card'){card=a[i];break;} } var d=JSON.parse(window.activeStore().get('ta-checkin')); return d.questions.some(function(q){return q.text===card.askQuestion;}); } catch(e){ return String(e); } })()");
  ok('卡片题面与字卡库题目匹配', qInBank === true, qInBank);
  // v3.13.x：互动卡全局闸门——上面 triggerCkQuestion 手动触发也会标记闸门，
  // 这里先清掉再验自动路径，避免闸门拦截 prob=100 的确定性用例
  await evalJs("window.activeStore().set('interact-card-last', '0'); true");
  const gate1 = await evalJs('window.ckQuestionTry({})');
  const gate2 = await evalJs("window.ckQuestionTry({ 'ckq-en': 1, 'ckq-prob': 100, 'ckq-cool': 0, 'ckq-popup-prob': 0 })");
  ok('ckQuestionTry：无开关拒绝 / 开关+概率100 命中推卡', gate1 === false && gate2 === true, { gate1, gate2 });
  console.log('\n== T6 搜索注册 + 计数刷新 ==');
  const searchRes = await evalJs("(function(){ try { var f = (window.__cardSearchFns||[]).filter(function(x){ return x.name === 'TA的查岗'; })[0]; if (!f) return null; var r1 = f.fn('在干嘛'); var r2 = f.fn('测试'); return { hit: r1.length >= 1, mineHit: r2.length >= 1 }; } catch (e) { return String(e); } })()");
  ok('跨分类搜索注册且能命中预设/自定义', searchRes && searchRes.hit === true && searchRes.mineHit === true, searchRes);
  const counts = await evalJs("(function(){ window.refreshCkCardCounts(); return { tSys: (document.querySelector('#li-ta-checkin > .t')||{}).textContent, tMine: (document.querySelector('#li-ta-checkin-mine > .t')||{}).textContent }; })()");
  ok('入口计数刷新（系统 17 / 自定义 2）', counts && counts.tSys === '17' && counts.tMine === '2', counts);

  console.log('\n== T7 IndexedDB 权威持久化 ==');
  await evalJs("window.activeStore().set('ta-checkin', window.activeStore().get('ta-checkin')); true");
  await sleep(400);
  const idbVal = await evalJs("(async function(){ try { var v = await window.idbGet(window.activePrefix() + ':ta-checkin'); if (v === undefined || v === null) return 'EMPTY'; var d = typeof v === 'string' ? JSON.parse(v) : v; return d && d.questions ? d.questions.length : 'BAD'; } catch (e) { return String(e); } })()");
  ok('IDB 中 ta-checkin 有权威数据（≥19 题）', typeof idbVal === 'number' && idbVal >= 19, idbVal);
  console.log('\n== T8 源码静态断言（构建产物状态另见 INFO） ==');
  const tpl = readFileSync(join(root, 'src/template.html'), 'utf8');
  ok('template.html 含 page-ta-checkin 管理页与双入口', tpl.includes('page-ta-checkin') && tpl.includes('li-ta-checkin') && tpl.includes('li-ta-checkin-mine'));
  const tabsSrc = readFileSync(join(root, 'src/js/tabs.js'), 'utf8');
  ok('tabs.js FULL_PAGES 含 page-ta-checkin', tabsSrc.includes("'page-ta-checkin'"));
  const ckSrc = readFileSync(join(root, 'src/js/ck-question.js'), 'utf8');
  ok('ck-question.js 迟到弹窗守卫（popSchedAt）保留', ckSrc.includes('popSchedAt'));
  ok('旧硬编码 QUESTIONS 数组已移除（改为 DEFAULT_QUESTIONS 题库）', !/const QUESTIONS = \[/.test(ckSrc) && ckSrc.includes('DEFAULT_QUESTIONS'));
  // 构建产物是否已收口（信息性输出，不计入通过/失败——构建由构建者统一执行）
  let builtHas = false;
  try { builtHas = readFileSync(join(root, 'index.html'), 'utf8').includes('page-ta-checkin'); } catch (e) {}
  console.log(builtHas ? '  ℹ INFO: index.html 已包含本次改动（已构建收口）' : '  ℹ INFO: index.html 尚未包含本次改动（等待构建者执行 node build.mjs 后重新运行本脚本可多 1 项通过）');

  console.log('\n== T9 无未捕获异常 ==');
  ok('加载至今无未捕获异常', jsErrors.length === 0, jsErrors.slice(0, 3));

} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
