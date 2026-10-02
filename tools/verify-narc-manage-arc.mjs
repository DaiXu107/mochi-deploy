// ===== 专项回归：#611 梦角档案页的「管理梦角」只做名单，不出现此间专属的「时辰区间」 =====
// 背景：梦角档案（memo-arc.js）的 #narc-manage / 「＋ 添加」是复用此间的 cjianManage() 弹窗的，
//   此间 v3.16.x 加了「时辰区间」后泄漏进了档案页——档案页是「认识 TA 的档案」，
//   世界时间/常在时辰属此间的世界设定，不该在这里设。
// 修复口径（用户点名）：档案页入口传 cjianManage({ arc: 1 })——
//   ① 动作列表 = 添加梦角 / 改名 / 删除梦角（无「时辰区间」）；
//   ② 添加流程选完时间偏移直接建档（不弹 #cj-slot-mask 时辰多选），条目无 slots 字段；
//   ③ 弹窗顶部提醒「梦角会跟着桌面联系人自动创建，一般不用手动添加」。
//   此间入口（cjianManage() 无参）能力零变化——「时辰区间」动作与时辰浮层都还在。
// 用例：
//   S0 环境闸门：页面就绪 + cjianManage/openModal 就位 + 档案页管理按钮存在
//   S1 档案页入口：动作胶囊恰为三项（不含「时辰区间」）
//   S2 档案页入口：顶部提醒文案可见（自动跟随桌面联系人创建）
//   S3 档案页添加：名字 → 时间偏移 → 不弹时辰浮层即建档，条目无 slots 字段
//   S4 此间入口：动作胶囊仍含「时辰区间」（能力保留）
//   S5 此间添加：时间偏移后照常弹时辰浮层（能力保留，取消后不留残留）
//   S6 全程无未捕获 JS 异常
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
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css', 'drift-bottle.css', 'applock.css'];
const jsFiles = ['device.js', 'idb.js', 'contacts.js', 'applock.js', 'card-lock.js', 'dcp-master.js', 'media-pool.js', 'storage-slim.js', 'img-compress.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'dict-ext-data.js', 'default-cards.js', 'quote-spell.js', 'dream-free.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'ta-mood-data.js', 'ta-mood.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'incoming-requests.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'my-arc.js', 'period.js', 'accounting.js', 'garden.js', 'room.js', 'drift-bottle.js', 'decision.js', 'group-decision.js', 'pong.js', 'snake-game.js', 'breakout.js', 'connect-four.js', 'coop-mine.js', 'fishing.js', 'memory-game.js', 'gomoku.js', 'linkup.js', 'match3.js', 'auction.js', 'arcade.js', 'mood-diary.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'feature-hub.js', 'settings-help.js', 'onboarding.js', 'page-coach.js', 'card-audit.js', 'mobile-adapt.js'];
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => '(function () { try {\n' + readFileSync(join(root, 'src/js', f), 'utf8') + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();').join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-test-build').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-narcarc-root-' + Date.now());
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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-narcarc-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
// 点胶囊（按文案）
const clickPill = (label) => `(function () { const b = Array.prototype.find.call(document.querySelectorAll('#modal-pills .pill'), function (x) { return x.textContent === '${label}'; }); if (b) b.click(); return !!b; })()`;
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

  console.log('\n== S0 环境闸门 ==');
  const env = await evalJs("(function () { const m = document.getElementById('narc-manage'); return { ready: document.readyState, fn: typeof window.cjianManage, modal: typeof window.openModal, manage: !!m, mask: !!document.getElementById('modal-mask') }; })()");
  ok('页面就绪且 cjianManage / openModal 就位', env && env.ready === 'complete' && env.fn === 'function' && env.modal === 'function', env);
  ok('梦角档案页管理按钮存在', env && env.manage, env);

  console.log('\n== S1/S2 档案页入口：只做名单 + 自动创建提醒 ==');
  // 走真实入口：点档案页右上「管理梦角」（memo-arc.js 的 #narc-manage listener）
  await evalJs("document.getElementById('narc-manage').click(); true");
  await sleep(200);
  const s1 = await evalJs("(function () { const ps = Array.prototype.map.call(document.querySelectorAll('#modal-pills .pill'), function (b) { return b.textContent; }); const st = document.getElementById('modal-static'); return { pills: ps, title: document.getElementById('modal-title').textContent, hint: st.hidden ? '' : st.textContent, mask: !!document.getElementById('cj-slot-mask') }; })()");
  ok('档案页管理弹窗打开（标题「梦角管理」）', s1 && s1.title === '梦角管理', s1 && s1.title);
  ok('动作胶囊恰为三项：添加梦角 / 改名 / 删除梦角', s1 && s1.pills.join('|') === '添加梦角|改名|删除梦角', s1 && s1.pills);
  ok('不出现此间专属的「时辰区间」', s1 && s1.pills.indexOf('时辰区间') < 0, s1 && s1.pills);
  ok('顶部提醒「梦角会跟着桌面联系人自动创建」（用户点名要的提醒）', s1 && s1.hint.indexOf('梦角会跟着桌面联系人自动创建') >= 0, s1 && s1.hint);

  console.log('\n== S3 档案页添加：选完偏移直接建档（不弹时辰浮层） ==');
  const before = await evalJs("(function () { const cid = window.__activeCid || 'default'; return JSON.parse(localStorage.getItem('xy-home-v2:' + cid + ':cjian-roster') || '[]').length; })()");
  await evalJs(clickPill('添加梦角'));
  await evalJs("document.getElementById('modal-ok').click(); true");
  await sleep(150);
  const nameStep = await evalJs("(function () { return { title: document.getElementById('modal-title').textContent, inputShown: document.getElementById('modal-input').hidden === false, hint: (document.getElementById('modal-static') || {}).textContent }; })()");
  ok('第一步切到输入梦角名字（且提醒已让位）', nameStep && nameStep.title.indexOf('添加梦角') >= 0 && nameStep.inputShown && !nameStep.hint, nameStep);
  await evalJs("(function () { const i = document.getElementById('modal-input'); i.value = '档案页新增'; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('modal-ok').click(); return true; })()");
  await sleep(150);
  const offStep = await evalJs("(function () { return { pills: Array.prototype.map.call(document.querySelectorAll('#modal-pills .pill'), function (b) { return b.textContent; }), okText: document.getElementById('modal-ok').textContent, hint: (document.getElementById('modal-static') || {}).textContent }; })()");
  ok('第二步：时间偏移胶囊保留（此间口径的世界时间）', offStep && offStep.pills.indexOf('与现实同步') >= 0 && offStep.pills.indexOf('独立时间流') >= 0, offStep && offStep.pills);
  ok('提示改指「此间」（不再承诺下一步限定时辰区间）', offStep && offStep.hint.indexOf('去「此间」设') >= 0 && offStep.hint.indexOf('下一步还能限定') < 0, offStep && offStep.hint);
  ok('按钮文案为「完成」（本步即建好，无下一步）', offStep && offStep.okText === '完成', offStep && offStep.okText);
  await evalJs(clickPill('与现实同步'));
  await evalJs("document.getElementById('modal-ok').click(); true");
  await sleep(250);
  const s3 = await evalJs("(function () { const cid = window.__activeCid || 'default'; const r = JSON.parse(localStorage.getItem('xy-home-v2:' + cid + ':cjian-roster') || '[]'); const c = r.find(function (x) { return x.name === '档案页新增'; }); return { n: r.length, found: !!c, slots: c ? c.slots : 'no-entry', mask: !!document.getElementById('cj-slot-mask'), modalHidden: document.getElementById('modal-mask').hidden }; })()");
  ok('不弹时辰多选浮层（arc 分支绕开 #cj-slot-mask）', s3 && !s3.mask, s3 && s3.mask);
  ok('选完偏移即建档（名单 +1，弹窗关闭）', s3 && s3.n === before + 1 && s3.found && s3.modalHidden, s3);
  ok('新条目无 slots 字段（世界时间按偏移连续流动 = 旧行为）', s3 && s3.slots === undefined, s3 && s3.slots);

  console.log('\n== S4/S5 此间入口：能力完整保留 ==');
  await evalJs("window.cjianManage(); true");
  await sleep(200);
  const s4 = await evalJs("(function () { const ps = Array.prototype.map.call(document.querySelectorAll('#modal-pills .pill'), function (b) { return b.textContent; }); const st = document.getElementById('modal-static'); return { pills: ps, hint: st.hidden ? '' : st.textContent }; })()");
  ok('此间管理仍有「时辰区间」（arc 开关不误伤此间）', s4 && s4.pills.indexOf('时辰区间') >= 0 && s4.pills.join('|') === '添加梦角|时辰区间|改名|删除梦角', s4 && s4.pills);
  ok('此间入口不显示档案页的自动创建提醒', s4 && !s4.hint, s4 && s4.hint);
  await evalJs(clickPill('添加梦角'));
  await evalJs("document.getElementById('modal-ok').click(); true");
  await sleep(150);
  await evalJs("(function () { const i = document.getElementById('modal-input'); i.value = '此间新增'; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('modal-ok').click(); return true; })()");
  await sleep(150);
  const s5a = await evalJs("(function () { return document.getElementById('modal-ok').textContent; })()");
  ok('此间添加第二步按钮仍是「下一步」', s5a === '下一步', s5a);
  await evalJs(clickPill('与现实同步'));
  await evalJs("document.getElementById('modal-ok').click(); true");
  await sleep(300);
  const s5 = await evalJs("(function () { const m = document.getElementById('cj-slot-mask'); return { mask: !!m, head: m ? (m.querySelector('div') || {}).textContent : '' }; })()");
  ok('此间添加仍弹时辰浮层（#cj-slot-mask 保留）', s5 && s5.mask, s5);
  // 收尾：取消掉浮层，不留残留；#892 起取消＝时辰不限定、按已选偏移照常建档（不再整个放弃添加）
  await evalJs("(function () { const m = document.getElementById('cj-slot-mask'); if (m) { const b = Array.prototype.find.call(m.querySelectorAll('button'), function (x) { return x.textContent === '取消'; }); if (b) b.click(); } return true; })()");
  await sleep(150);
  const s5b = await evalJs("(function () { const cid = window.__activeCid || 'default'; const r = JSON.parse(localStorage.getItem('xy-home-v2:' + cid + ':cjian-roster') || '[]'); const c = r.find(function (x) { return x.name === '此间新增'; }); return { mask: !!document.getElementById('cj-slot-mask'), has: !!c, slots: c ? c.slots : 'no-entry', off: c ? c.offsetMin : null }; })()");
  ok('取消时辰浮层后不留残留、仍按已选偏移建档（#892：无 slots）', s5b && !s5b.mask && s5b.has === true && !s5b.slots && s5b.off === 0, s5b);

  console.log('\n== S6 无 JS 异常 ==');
  ok('加载与操作全程无未捕获异常', jsErrors.length === 0, jsErrors.slice(0, 3));

  console.log('\n结果: ' + pass + '/' + (pass + fail) + ' 项通过');
  process.exitCode = fail ? 1 : 0;
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
