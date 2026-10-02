// ===== 专项回归：TA的邀请字卡库 + 更多功能「邀请」手动触发（ta-invite.js / chat.js v3.14.x） =====
// 用户反馈：①字卡库系统预设里没有【TA的邀请】字卡库；②聊天更多功能→TA的提问分类缺少
//          【邀请】让对方现在邀请一次的功能；③邀请缺少正常情侣的贴贴互动内容。
// 实现：新建 ta-invite.js（预设 20 条入库：4 猜拳+3 Pong+3 贪吃蛇+v3.14.x 贴贴 10 条，逐条开关/
//       总开关/自定义/分组/批量导入/搜索/双入口/IDB 权威恢复）；chat.js tryActiveInvite 改从库抽
//       （保持 ai-rps-en/prob、ai-game-en/prob、ai-cuddle-en/prob 门控语义）+ triggerTaInviteNow
//       手动触发；贴贴同意后轻震动 + TA 回应一句（CUDDLE_REPLIES），拒绝走专属婉拒池；
//       template.html 加字卡库双入口、管理页 page-ta-invite、more-grid-ask 邀请按钮、贴贴设置行。
// 用例：
//   T1 入库：__tiBankInfo total/preset=20、mine=0；双入口与计数
//   T2 管理页：主入口系统预设视图（4 分类子标签）、我的添加入口、返回、全屏态无 tabbar
//   T3 自定义：批量导入 2 条 Pong + 表单加 1 条贪吃蛇 + 删除 1 条
//   T4 抽取门控：rps 门 100% 出猜拳；仅游戏门开时出 Pong/贪吃蛇；仅贴贴门开出贴贴；三关返回 null；useDefault 关只用自定义
//   T5 手动触发：triggerTaInviteNow 发邀请消息 + 弹同意/拒绝确认弹窗；拒绝后发婉拒消息
//   T5b 贴贴同意链路：固定抽到贴贴卡 → 同意 → 无半框、TA 回应一句贴贴的话（主动爱心）
//       #1422：回应句的判据从「关键词猜」（蹭到/贴/握住/充电）改成「等于库内『贴贴·回应』组里的某一句」。
//       旧判据是 4/5 概率的假绿尺子——池内第 4 句「感觉到了，你在旁边。很安心。」一个关键词都不含，
//       抽到它必红（本仓库实测连红过一次）；池子现进 DEFAULT_CARD_DATA.interact，正好按同源池精确判。
//   T5c #510 贴贴拒绝链路：固定抽到贴贴卡 → 拒绝 → 系统消息「你拒绝了 × 的贴贴邀请」+ 婉拒话术
//       （用户报「联系人发来的亲亲/贴贴申请弹窗，同意后系统消息里没有相关消息」——同意/拒绝均补
//         chatAddSystem 留痕，口径同换头像邀请/听歌邀请；猜拳/游戏类邀请不补，对局结果另有系统消息）
//   T6 更多功能面板按钮存在且可触发
//   T7 搜索注册 + 计数刷新
//   T8 IndexedDB 权威持久化
//   T9 源码静态断言（页面/入口/FULL_PAGES/jsFiles/chat 接线/贴贴门）
//   T10 加载至今无未捕获异常
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
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'period.js', 'accounting.js', 'garden.js', 'decision.js', 'pong.js', 'snake-game.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'mobile-adapt.js'];
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => '(function () { try {\n' + readFileSync(join(root, 'src/js', f), 'utf8') + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();').join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-test-build').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-tainvite-root-' + Date.now());
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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-tainvite-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
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

  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4500);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(300);
  await evalJs("(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return true;})()");
  await sleep(400);

  console.log('\n== T1 题库入库 ==');
  const info1 = await evalJs('window.__tiBankInfo ? window.__tiBankInfo() : null');
  ok('__tiBankInfo 探针可用', !!info1, info1);
  ok('total=20 / preset=20 / mine=0', info1 && info1.total === 20 && info1.preset === 20 && info1.mine === 0, info1);
  const entries = await evalJs("({ sys: !!document.getElementById('li-ta-invite'), mine: !!document.getElementById('li-ta-invite-mine'), page: !!document.getElementById('page-ta-invite'), btn: !!document.getElementById('more-invite-now'), tSys: (document.querySelector('#li-ta-invite > .t')||{}).textContent })");
  ok('字卡库双入口 + 管理页 + 更多功能按钮存在', entries && entries.sys && entries.mine && entries.page && entries.btn, entries);
  ok('入口计数初始 20', entries && entries.tSys === '20', entries);

  console.log('\n== T2 管理页导航 ==');
  await evalJs("(function(){var e=document.getElementById('li-ta-invite');if(e)e.click();return true;})()");
  await sleep(150);
  let st = await evalJs("({ pageHidden: document.getElementById('page-ta-invite').hidden, sysHidden: document.getElementById('ti-sys-panel').hidden, tabs: Array.from(document.querySelectorAll('#ti-sys-cats .cc-tab[data-cat]')).map(function(t){return t.dataset.cat;}), rows: document.querySelectorAll('#ti-sys-cats input[data-idx]').length, tabbarHidden: (document.querySelector('.tabbar')||{}).hidden })");
  ok('主入口进系统预设视图', st && st.pageHidden === false && st.sysHidden === false, st);
  ok('分类子标签 rps/pong/snake/cuddle 渲染', st && Array.isArray(st.tabs) && st.tabs.indexOf('rps') >= 0 && st.tabs.indexOf('pong') >= 0 && st.tabs.indexOf('snake') >= 0 && st.tabs.indexOf('cuddle') >= 0, st && st.tabs);
  ok('猜拳类预设 4 行', st && st.rows === 4, st && st.rows);
  ok('全屏页隐藏底部 tabbar', st && st.tabbarHidden === true, st && st.tabbarHidden);
  await evalJs("(function(){var b=document.getElementById('ti-back');if(b)b.click();return true;})()");
  await sleep(120);
  await evalJs("(function(){var e=document.getElementById('li-ta-invite-mine');if(e)e.click();return true;})()");
  await sleep(150);
  st = await evalJs("({ pageHidden: document.getElementById('page-ta-invite').hidden, mineHidden: document.getElementById('ti-mine-panel').hidden, batchKind: !!document.getElementById('ti-batch-kind') })");
  ok('「我的添加」入口进自定义视图（批量导入类型下拉可见）', st && st.pageHidden === false && st.mineHidden === false && st.batchKind === true, st);

  console.log('\n== T3 自定义新增 ==');
  // 批量导入到 Pong 类型
  await evalJs("(function(){ document.getElementById('ti-batch-kind').value='pong'; var ta=document.getElementById('ti-batch'); ta.value='测试Pong邀请一\\n测试Pong邀请二'; document.getElementById('ti-batch-add').click(); return true; })()");
  await sleep(150);
  let info = await evalJs('window.__tiBankInfo()');
  ok('批量导入 2 条 Pong 后 mine=2', info && info.mine === 2, info);
  // 表单加一条贪吃蛇（未分组·贪吃蛇区块出现行内表单）
  const addRes = await evalJs("(function(){\n  try {\n    var forms = document.querySelectorAll('#ti-mine-cats .ta-add-btn');\n    var target = null;\n    for (var i=0;i<forms.length;i++){ if(forms[i].getAttribute('data-cat')==='snake'){ target=forms[i]; break; } }\n    if(!target){\n      var sel=document.querySelector('#ti-mine-cats .ti-type'); if(!sel) return 'no-form';\n      sel.value='snake'; target=document.querySelector('#ti-mine-cats .ta-add-btn'); if(!target) return 'no-btn';\n    }\n    var key=target.getAttribute('data-key');\n    var inp=document.getElementById('ti-new-'+key);\n    inp.value='测试贪吃蛇邀请';\n    target.click();\n    return 'ok';\n  } catch(e){ return String(e); }\n})()");
  await sleep(150);
  info = await evalJs('window.__tiBankInfo()');
  ok('表单添加贪吃蛇话术（mine=3）', addRes === 'ok' && info && info.mine === 3, { addRes, info });
  const kinds = await evalJs("(function(){ try{ var d=JSON.parse(window.activeStore().get('ta-invite')); return d.questions.filter(function(q){return q.isPreset!==true;}).map(function(q){return q.kind;}); }catch(e){ return String(e); } })()");
  ok('kind 归类正确（pong×2 + snake×1）', Array.isArray(kinds) && kinds.filter(function(k){return k==='pong';}).length===2 && kinds.indexOf('snake')>=0, kinds);
  // 删除一条
  await evalJs("(function(){var b=document.querySelectorAll('#ti-mine-cats .ta-del');if(b.length)b[b.length-1].click();return true;})()");
  await sleep(150);
  info = await evalJs('window.__tiBankInfo()');
  ok('删除一条后 mine=2', info && info.mine === 2, info);

  console.log('\n== T4 抽取门控 ==');
  const gate = await evalJs("(function(){\n  function tryN(n, c){ var ks={}; for(var i=0;i<n;i++){ var q=window.taInviteDraw(c); if(!q) return null; ks[q.kind]=(ks[q.kind]||0)+1; } return ks; }\n  return {\n    rpsOnly: tryN(20, { 'ai-rps-en':1, 'ai-rps-prob':100, 'ai-game-en':0 }),\n    gameOnly: tryN(30, { 'ai-rps-en':0, 'ai-game-en':1, 'ai-game-prob':100 }),\n    cuddleOnly: tryN(25, { 'ai-rps-en':0, 'ai-game-en':0, 'ai-cuddle-en':1, 'ai-cuddle-prob':100 }),\n    none: window.taInviteDraw({ 'ai-rps-en':0, 'ai-game-en':0, 'ai-cuddle-en':0 })\n  };\n})()");
  ok('rps 门 100% 时只出猜拳', gate && gate.rpsOnly && Object.keys(gate.rpsOnly).length === 1 && gate.rpsOnly.rps === 20, gate && gate.rpsOnly);
  ok('仅游戏门开时只出 Pong/贪吃蛇', gate && gate.gameOnly && !gate.gameOnly.rps && (gate.gameOnly.pong || 0) + (gate.gameOnly.snake || 0) === 30, gate && gate.gameOnly);
  ok('仅贴贴门开时只出贴贴', gate && gate.cuddleOnly && !gate.cuddleOnly.rps && !gate.cuddleOnly.pong && !gate.cuddleOnly.snake && gate.cuddleOnly.cuddle === 25, gate && gate.cuddleOnly);
  ok('三开关关闭返回 null', gate && gate.none === null, gate && gate.none);
  const gd = await evalJs("(function(){ var d=JSON.parse(window.activeStore().get('ta-invite')); d.settings.useDefault=false; window.activeStore().set('ta-invite', JSON.stringify(d)); var out=[]; for(var i=0;i<15;i++){ var q=window.taInviteDraw({ 'ai-rps-en':1,'ai-rps-prob':100,'ai-game-en':1,'ai-game-prob':100 }); if(q) out.push(q.isPreset!==true); } d.settings.useDefault=true; window.activeStore().set('ta-invite', JSON.stringify(d)); return out.length>0 && out.every(function(x){return x===true;}); })()");
  ok('useDefault 关闭后自动链路只抽自定义', gd === true, gd);

  console.log('\n== T5 手动触发链路 ==');
  await evalJs("(function(){ ['modal-mask','tc-mask','qa-mask'].forEach(function(id){ var el=document.getElementById(id); if(el) el.hidden=true; }); return true; })()");
  await evalJs("(function(){var app=document.querySelector('.app[data-app=\"chat\"]');if(app)app.click();return true;})()");
  await sleep(500);
  const before = await evalJs('(window.getChatMsgs()||[]).length');
  const trig = await evalJs('!!window.triggerTaInviteNow && window.triggerTaInviteNow()');
  await sleep(1900); // typing 700~1400ms + 余量
  const invState = await evalJs("(function(){\n  try {\n    var a = window.getChatMsgs(); var rec = a[a.length-1];\n    var mask = document.getElementById('modal-mask');\n    var modalText = mask && !mask.hidden ? mask.textContent : '';\n    var hasAgree = modalText.indexOf('同意') >= 0 && modalText.indexOf('拒绝') >= 0;\n    return { grew: a.length > " + '0' + ", lastInitiative: !!(rec && rec.special === 'poke' && rec.initiative), text: rec ? String(rec.text||'').slice(0,60) : '', modalOpen: !!(mask && !mask.hidden), hasAgree: hasAgree, prevLen: " + before + ", len: a.length };\n  } catch(e){ return String(e); }\n})()");
  ok('triggerTaInviteNow 返回 true', trig === true, trig);
  ok('聊天末尾新增主动邀请消息', invState && invState.lastInitiative === true && invState.len > invState.prevLen, invState);
  ok('弹出同意/拒绝确认弹窗', invState && invState.modalOpen === true && invState.hasAgree === true, invState);
  // 点「拒绝」pill → 点「确定」提交 → 发一条婉拒消息
  await evalJs("(function(){\n  var mask=document.getElementById('modal-mask');\n  var btns=mask.querySelectorAll('button');\n  for(var i=0;i<btns.length;i++){ if(btns[i].textContent.trim()==='拒绝'){ btns[i].click(); break; } }\n  var okBtn=mask.querySelector('.modal-btn.ok'); if(okBtn) okBtn.click();\n  return true;\n})()");
  await sleep(400);
  const declined = await evalJs("(function(){ try{ var a=window.getChatMsgs(); var rec=a[a.length-1]; return { out: rec && rec.side==='out', len: a.length }; }catch(e){ return String(e); } })()");
  ok('拒绝后发出婉拒消息（我方气泡）', declined && declined.out === true, declined);

  console.log('\n== T5b 贴贴同意链路 ==');
  // 固定抽到贴贴卡 → 触发 → 点「同意」→ 不开游戏半框，TA 回应一句贴贴的话（主动爱心）
  const stubRes = await evalJs("(function(){ window.__tiOrigPickAny = window.taInvitePickAny; window.taInvitePickAny = function(){ return { kind:'cuddle', text:'想贴贴了，你可以过来一点吗？' }; }; return true; })()");
  const n0c = await evalJs('(window.getChatMsgs()||[]).length');
  const trigC = await evalJs('!!window.triggerTaInviteNow && window.triggerTaInviteNow()');
  await sleep(1900); // typing 700~1400ms + 弹窗
  const agreeRes = await evalJs("(function(){\n  var mask=document.getElementById('modal-mask');\n  if(!mask || mask.hidden) return 'no-modal';\n  var btns=mask.querySelectorAll('button');\n  for(var i=0;i<btns.length;i++){ if(btns[i].textContent.trim()==='同意'){ btns[i].click(); break; } }\n  var okBtn=mask.querySelector('.modal-btn.ok'); if(okBtn) okBtn.click();\n  return 'agreed';\n})()");
  await sleep(2400); // 同意后回应延迟 600~1200ms + 余量
  ok('贴贴卡触发返回 true', stubRes === true && trigC === true, { stubRes, trigC });
  const cuddleState = await evalJs("(function(){\n  try {\n    var a = window.getChatMsgs();\n    var rec = a[a.length-1];\n    var sysRec = a[a.length-2];\n    var mask = document.getElementById('modal-mask');\n    return {\n      grew: a.length > " + n0c + ", lastIn: !!(rec && rec.side==='in'), lastInitiative: !!(rec && rec.initiative),\n      isReply: (function(){ if(!rec||!rec.text) return false; var g=(window.getPresetGroupLines&&window.getPresetGroupLines('贴贴·回应',[]))||[]; return g.some(function(s){return String(rec.text).indexOf(s)>=0;}); })(),\n      sysPoke: !!(sysRec && sysRec.side === 'in' && sysRec.special === 'poke' && String(sysRec.text || '').indexOf('你接受了') >= 0),\n      sysText: sysRec ? String(sysRec.text || '') : '',\n      // 主动爱心角标在「邀请消息」上（TA 主动发起）；贴贴回应属应答，按现契约不带角标\n      invInitiative: !!(a[a.length-3] && a[a.length-3].special === 'poke' && a[a.length-3].initiative === true && a[a.length-3].gInv === 'cuddle'),\n      modalClosed: !!(mask && mask.hidden), len: a.length\n    };\n  } catch(e){ return String(e); }\n})()");
  ok('点同意后弹窗关闭且无游戏半框路径', agreeRes === 'agreed' && cuddleState && cuddleState.modalClosed === true, { agreeRes, cuddleState });
  ok('TA 回应一句贴贴的话（联系人气泡，消息数 +3：邀请+系统消息+回应）', cuddleState && cuddleState.grew === true && cuddleState.lastIn === true && cuddleState.isReply === true && cuddleState.len === n0c + 3, { n0c, cuddleState });
  ok('邀请消息本身带主动爱心角标（initiative + gInv=cuddle）', cuddleState && cuddleState.invInitiative === true, { cuddleState });
  // #510：同意后必须留下系统消息（用户报「同意后系统消息里没有相关消息」）——顺序：系统消息在 TA 回应之前
  ok('#510 同意后系统消息留痕「你接受了 × 的贴贴邀请」', cuddleState && cuddleState.sysPoke === true, { cuddleState });
  await evalJs("(function(){ window.taInvitePickAny = window.__tiOrigPickAny; return true; })()");

  console.log('\n== T5c 贴贴拒绝链路（#510 拒绝留痕） ==');
  // 同样固定抽到贴贴卡 → 触发 → 点「拒绝」→ 系统消息 + 婉拒话术（原只有婉拒话术）
  await evalJs("(function(){ window.__tiOrigPickAny2 = window.taInvitePickAny; window.taInvitePickAny = function(){ return { kind:'cuddle', text:'抱一下再忙别的嘛，就一下下。' }; }; return true; })()");
  const n0r = await evalJs('(window.getChatMsgs()||[]).length');
  await evalJs('!!window.triggerTaInviteNow && window.triggerTaInviteNow()');
  await sleep(1900);
  const rejRes = await evalJs("(function(){\n  var mask=document.getElementById('modal-mask');\n  if(!mask || mask.hidden) return 'no-modal';\n  var btns=mask.querySelectorAll('button');\n  for(var i=0;i<btns.length;i++){ if(btns[i].textContent.trim()==='拒绝'){ btns[i].click(); break; } }\n  var okBtn=mask.querySelector('.modal-btn.ok'); if(okBtn) okBtn.click();\n  return 'declined';\n})()");
  await sleep(600);
  const rejState = await evalJs("(function(){\n  try {\n    var a = window.getChatMsgs();\n    var last = a[a.length-1];\n    var sysRec = a[a.length-2];\n    return {\n      lastOut: !!(last && last.side === 'out'),\n      sysPoke: !!(sysRec && sysRec.side === 'in' && sysRec.special === 'poke' && String(sysRec.text || '').indexOf('你拒绝了') >= 0),\n      sysText: sysRec ? String(sysRec.text || '') : '',\n      len: a.length, n0: " + n0r + "\n    };\n  } catch(e){ return String(e); }\n})()");
  await evalJs("(function(){ window.taInvitePickAny = window.__tiOrigPickAny2; return true; })()");
  ok('贴贴拒绝后仍发婉拒话术（我方气泡）', rejRes === 'declined' && rejState && rejState.lastOut === true, { rejRes, rejState });
  ok('#510 拒绝后系统消息留痕「你拒绝了 × 的贴贴邀请」', rejState && rejState.sysPoke === true, { rejState });
  ok('#510 贴贴拒绝新增 3 条（邀请消息 + 系统消息 + 婉拒话术，无其他副作用）', rejState && rejState.len === n0r + 3, { n0r, rejState });

  console.log('\n== T6 更多功能面板按钮触发 ==');
  const moreRes = await evalJs("(function(){\n  try {\n    var mb=document.getElementById('chat-more-btn'); if(mb) mb.click();\n    var askTab=document.getElementById('more-tab-ask'); if(askTab) askTab.click();\n    var btn=document.getElementById('more-invite-now'); if(!btn) return 'no-btn';\n    var n0=(window.getChatMsgs()||[]).length;\n    btn.click();\n    var panel=document.getElementById('chat-more-panel');\n    return { ok:true, panelClosed: panel? !!panel.hidden : true, n0:n0, n1:(window.getChatMsgs()||[]).length };\n  } catch(e){ return String(e); }\n})()");
  await sleep(1600);
  const moreGrew = await evalJs('((window.getChatMsgs()||[]).length)');
  ok('面板内【邀请】按钮点击即发起邀请且收起面板', moreRes && moreRes.ok === true && moreRes.panelClosed === true && moreGrew > moreRes.n0, { moreRes, moreGrew });

  console.log('\n== T7 搜索注册 + 计数刷新 ==');
  const searchRes = await evalJs("(function(){ try { var f=(window.__cardSearchFns||[]).filter(function(x){return x.name==='TA的邀请';})[0]; if(!f) return null; return { hit: f.fn('猜拳').length>=1, mineHit: f.fn('测试').length>=1 }; }catch(e){ return String(e);} })()");
  ok('跨分类搜索命中预设/自定义', searchRes && searchRes.hit === true && searchRes.mineHit === true, searchRes);
  const counts = await evalJs("(function(){ window.refreshTiCardCounts(); return { tSys:(document.querySelector('#li-ta-invite > .t')||{}).textContent, tMine:(document.querySelector('#li-ta-invite-mine > .t')||{}).textContent }; })()");
  ok('入口计数刷新（系统 20 / 自定义 2）', counts && counts.tSys === '20' && counts.tMine === '2', counts);

  console.log('\n== T8 IndexedDB 权威持久化 ==');
  await evalJs("window.activeStore().set('ta-invite', window.activeStore().get('ta-invite')); true");
  await sleep(400);
  const idbVal = await evalJs("(async function(){ try { var v=await window.idbGet(window.activePrefix()+':ta-invite'); if(v===undefined||v===null) return 'EMPTY'; var d=typeof v==='string'?JSON.parse(v):v; return d&&d.questions?d.questions.length:'BAD'; }catch(e){ return String(e);} })()");
  ok('IDB 中 ta-invite 有权威数据（≥20 条）', typeof idbVal === 'number' && idbVal >= 20, idbVal);

  console.log('\n== T9 源码静态断言 ==');
  const tpl = readFileSync(join(root, 'src/template.html'), 'utf8');
  ok('template 含 page-ta-invite / 双入口 / more-invite-now', tpl.includes('page-ta-invite') && tpl.includes('li-ta-invite') && tpl.includes('li-ta-invite-mine') && tpl.includes('more-invite-now'));
  const tabsSrc = readFileSync(join(root, 'src/js/tabs.js'), 'utf8');
  ok('tabs.js FULL_PAGES 含 page-ta-invite', tabsSrc.includes("'page-ta-invite'"));
  const buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8');
  ok("build.mjs jsFiles 含 'ta-invite.js'", buildSrc.includes("'ta-invite.js'"));
  const chatSrc = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
  ok('chat.js 已接线（taInviteDraw/triggerTaInviteNow/sendTaInvite）', chatSrc.includes('window.taInviteDraw') && chatSrc.includes('window.triggerTaInviteNow') && chatSrc.includes('sendTaInvite'));
  ok('chat.js 贴贴链路（cuddle 回应/婉拒池）', chatSrc.includes("cuddle: { title: '贴贴邀请' }") && chatSrc.includes('CUDDLE_REPLIES') && chatSrc.includes('CUDDLE_DECLINE'));
  ok('template 批量导入含贴贴选项 + 设置行 ai-cuddle-en/prob', tpl.includes('<option value="cuddle">导入到 · 贴贴邀请</option>') && tpl.includes('id="ai-cuddle-en"') && tpl.includes('data-k="ai-cuddle-prob"'));
  let builtHas = false;
  try { builtHas = readFileSync(join(root, 'index.html'), 'utf8').includes('page-ta-invite'); } catch (e) {}
  console.log(builtHas ? '  ℹ INFO: index.html 已包含本次改动（已构建收口）' : '  ℹ INFO: index.html 尚未包含本次改动（等待构建者执行 node build.mjs）');

  console.log('\n== T10 无未捕获异常 ==');
  ok('加载至今无未捕获异常', jsErrors.length === 0, jsErrors.slice(0, 3));

} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
