// ===== 「TA 记账提醒」真页面冒烟：记账页设置行 + 弹窗两阶段 + 真实聊天投递链（chip 落盘） =====
// 跑法：node build.mjs 之后 node tools/verify-acc-remind-browser.mjs（可 MOCHI_ROOT=../mochi-acc 指向仓外副本）
// 与 tools/verify-acc-remind.mjs 的分工：那边是纯 node 单元级（提取函数体＋stub，证「闸门逻辑」），
// 这边证「接上真产物以后确实能发出去」——chatAddIn 的 tag 是否真渲染成 .msg-mood-tag、
// 当天状态是否跨重载生效、静默时段与「今天已记账」在真实 store（含 memoryCache）下是否成立。
// 注意：裸 localStorage.removeItem 绕不过 xyStore 的内存缓存，复位一律走 window.activeStore()。
// 若 T1 就红且 src/js/accounting.js 里锚点仍在＝产物滞后于源码，先重跑 node build.mjs 再定性。
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(process.env.MOCHI_ROOT || process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const srv = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const failures = [];
const note = (id, ok, why) => { console.log((ok ? 'PASS ' : 'FAIL ') + id + (why ? '  [' + why + ']' : '')); if (!ok) failures.push(id + '｜' + why); };
const E = (expr) => page.evaluate('(() => ' + expr + ')()');
// 当天状态键（default 桌面命名空间）
const DAY_KEY = 'xy-home-v2:default:acc-remind-day';

// 把「现在」钉到 h 点：桩必须返回真实 Date 实例（todayStr 与消息时间戳都要用），并补 now/UTC。
// 真实 Date 存 window.__RD，探针结束立即还原——否则应用的 60s 首掷/5min 定时器会在假时钟下越窗投递。
const PIN = (h) => 'if (!window.__RD) window.__RD = window.Date; var R = window.__RD;' +
  ' var P = function () { return new R(' + (new Date()).getFullYear() + ', ' + (new Date()).getMonth() + ', ' + (new Date()).getDate() + ', ' + h + ', 0, 0); };' +
  'P.now = function () { return R.now(); }; P.UTC = R.UTC; P.parse = R.parse; window.Date = P;';
const TODAY = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(new Date().getDate()).padStart(2, '0');
const YESTERDAY = (() => { const d = new Date(Date.now() - 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();

// 掷骰探针：rand=0 ⇒ 任意 >0% 概率必命中；返回聊天增量＋chip＋当天状态
function probe(h, times) {
  return page.evaluate('(function(){' + PIN(h) +
    ' var rr = Math.random; Math.random = function () { return 0; };' +
    ' var n0 = document.querySelectorAll("#chat-body .msg").length;' +
    ' for (var i = 0; i < ' + (times || 1) + '; i++) { try { window.accRemindTick(); } catch (e) { window.Date = window.__RD; Math.random = rr; return { err: String(e) }; } }' +
    ' Math.random = rr; window.Date = window.__RD;' +
    ' var chips = Array.prototype.filter.call(document.querySelectorAll("#chat-body .msg-mood-tag"), function (x) { return x.textContent === "记账提醒"; }).length;' +
    ' var last = document.querySelector("#chat-body .msg:last-child");' +
    ' return { added: document.querySelectorAll("#chat-body .msg").length - n0, chip: chips, side: last ? last.className : "", text: last ? (last.textContent || "") : "", env: { ready: !!window.__mochiDataReady, hidden: document.hidden, tick: typeof window.accRemindTick }, st: localStorage.getItem("' + DAY_KEY + '") };' +
    '})()');
}

async function boot() {
  await page.goto(base + '/index.html');
  await page.waitForFunction('!!window.__mochiDataReady', null, { timeout: 30000 }).catch(() => {});
  await page.evaluate("(() => { var e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click(); var s = document.getElementById('splash'); if (s && !s.classList.contains('hide')) { s.classList.add('hide'); s.hidden = true; } var q = document.getElementById('qa-mask'); if (q) q.remove(); })()");
  await sleep(800);
}

await boot();

// A 默认关闭：设置行已注入概览卡下方，徽标「已关闭」，未写过任何开关键
note('T1-设置行存在', await E(`!!document.getElementById('acc-remind-row')`));
note('T1-默认关闭徽标', (await E(`(document.getElementById('acc-remind-badge')||{}).textContent`)) === '已关闭');
note('T1-未写开关键', await E(`localStorage.getItem('xy-home-v2:default:acc-remind-on') === null`));
note('T1-无JS错误', await E(`(window.__jsErrors||[]).length === 0`), String(await E(`JSON.stringify(window.__jsErrors||[])`)));

// B 关闭态：钉在白天＋rand=0（本应必命中）仍零投递、零写状态
const t2 = await probe(12, 2);
note('T2-关闭态零投递', t2.added === 0 && t2.chip === 0 && t2.st === null, JSON.stringify(t2));

// C 记账页内点设置行 → 弹窗两枚 pill ＋「当前关闭」说明
await page.evaluate(`(() => { var a = document.querySelector('.app[data-app="accounting"]'); if (a) a.click(); return !!a; })()`);
await sleep(500);
note('T3-记账页内设置行可见', await page.evaluate(`(() => { var r = document.getElementById('acc-remind-row'); return !!r && r.offsetParent !== null && !document.getElementById('page-accounting').hidden; })()`));
await page.evaluate(`document.getElementById('acc-remind-row').click()`);
await sleep(400);
const modal = await E(`({ open: !document.getElementById('modal-mask').hidden, pills: Array.prototype.map.call(document.querySelectorAll('#modal-pills button'), function (b) { return b.textContent; }), title: document.getElementById('modal-title').textContent, hint: document.getElementById('modal-static').textContent })`);
note('T3-弹窗打开', modal.open === true, JSON.stringify(modal).slice(0, 200));
note('T3-两枚 pill＋说明', modal.pills.length === 2 && /开启提醒/.test(modal.pills[0]) && /每天概率 30%/.test(modal.pills[1]) && /关闭/.test(modal.hint), JSON.stringify(modal.pills));

// D 点「开启提醒」→ 确定：写键、徽标随动、弹窗就地换文案不关窗（单弹窗两阶段，不开第二层）
await page.evaluate(`(() => { Array.prototype.filter.call(document.querySelectorAll('#modal-pills button'), function (x) { return /开启提醒/.test(x.textContent); })[0].click(); })()`);
await page.evaluate(`document.getElementById('modal-ok').click()`);
await sleep(400);
note('T4-开关键=1', await E(`localStorage.getItem('xy-home-v2:default:acc-remind-on') === '1'`));
note('T4-徽标已开启 30%', /已开启 · 30%/.test(await E(`(document.getElementById('acc-remind-badge')||{}).textContent`) || ''));
note('T4-弹窗就地更新', /关闭提醒/.test(await E(`Array.prototype.map.call(document.querySelectorAll('#modal-pills button'), function (b) { return b.textContent; }).join('|')`) || ''));

// E 投递：真实 chatAddIn 链落一条 in 气泡，带「记账提醒」来源 chip，当天封口
const t5 = await probe(12);
note('T5-落聊天 1 条＋chip', t5.added === 1 && t5.chip === 1, JSON.stringify(t5).slice(0, 300));
note('T5-in 侧气泡', /msg-in/.test(t5.side), t5.side);
note('T5-文案出自池子', /(记账|记一笔|账还没记|小账本|收支)/.test(t5.text), t5.text.slice(0, 40));
note('T5-当天状态封口', /"done":1/.test(t5.st || ''), String(t5.st));

// F 一天最多一条：同日连掷 6 次不再新增
const t6 = await probe(12, 6);
note('T6-当天不再发', t6.added === 0 && t6.chip === 1, JSON.stringify({ added: t6.added, chip: t6.chip }));

// G 概率两阶段：同一弹窗就地换输入框 → 88 → 落盘＋徽标随动
await page.evaluate(`(() => { document.getElementById('modal-mask').hidden = true; })()`);
await page.evaluate(`document.getElementById('acc-remind-row').click()`);
await sleep(300);
await page.evaluate(`(() => { Array.prototype.filter.call(document.querySelectorAll('#modal-pills button'), function (x) { return /每天概率/.test(x.textContent); })[0].click(); })()`);
await page.evaluate(`document.getElementById('modal-ok').click()`);
await sleep(300);
const p2 = await E(`({ title: document.getElementById('modal-title').textContent, val: document.getElementById('modal-input').value, ph: document.getElementById('modal-input').placeholder, pillsHidden: document.getElementById('modal-pills').hidden })`);
note('T7-就地进入概率输入', /概率/.test(p2.title) && p2.val === '30' && !!p2.ph && p2.pillsHidden === true, JSON.stringify(p2));
await page.evaluate(`(() => { var i = document.getElementById('modal-input'); i.value = '88'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await page.evaluate(`document.getElementById('modal-ok').click()`);
await sleep(300);
note('T7-概率写盘 88', await E(`localStorage.getItem('xy-home-v2:default:acc-remind-prob') === '88'`));
note('T7-徽标随动', /88%/.test(await E(`(document.getElementById('acc-remind-badge')||{}).textContent`) || ''));

// H 重载后（走真实 memoryCache 回填）：设置仍在、当天不重复发
await boot();
await sleep(1200);
note('T8-重启后仍开启 88%', /已开启 · 88%/.test(await E(`(document.getElementById('acc-remind-badge')||{}).textContent`) || ''));
const t8 = await probe(12, 3);
note('T8-当天状态跨重启生效', t8.added === 0 && /"done":1/.test(t8.st || ''), JSON.stringify({ added: t8.added, st: t8.st }));

// I 今天已经记过一笔 ⇒ 不催（复位走 activeStore，裸删 localStorage 清不掉内存缓存）
await page.evaluate(`(() => {
  window.activeStore().remove('acc-remind-day');
  var k = 'xy-home-v2:default:accounting-records';
  var list = JSON.parse(localStorage.getItem(k) || '[]');
  list.push({ id: 'smoke1', type: 'expense', amount: 12, category: '餐饮', note: '冒烟', date: '${TODAY}', time: Date.now() });
  localStorage.setItem(k, JSON.stringify(list));
})()`);
const t9 = await probe(12);
note('T9-已记账不催', t9.added === 0 && /"done":1/.test(t9.st || ''), JSON.stringify({ added: t9.added, st: t9.st }));

// J 静默时段：23 点既不投递也不写当天状态（明天仍按概率判）
await page.evaluate(`(() => {
  window.activeStore().remove('acc-remind-day');
  var k = 'xy-home-v2:default:accounting-records';
  localStorage.setItem(k, JSON.stringify(JSON.parse(localStorage.getItem(k) || '[]').filter(function (r) { return r.id !== 'smoke1'; })));
})()`);
const t10 = await probe(23);
note('T10-深夜静默', t10.added === 0 && t10.st === null, JSON.stringify({ added: t10.added, st: t10.st }));

// K 换日：状态里是昨天的 ⇒ 今天重新掷并投递
await page.evaluate(`window.activeStore().set('acc-remind-day', JSON.stringify({ date: '${YESTERDAY}', hit: 1, done: 1 }))`);
const t11 = await probe(12);
note('T11-换日重掷并投递', t11.added === 1, JSON.stringify({ added: t11.added, st: t11.st }));

note('T12-全程无 JS 错误', await E(`(window.__jsErrors||[]).length === 0`), String(await E(`JSON.stringify((window.__jsErrors||[]).slice(0,3))`)));

await browser.close();
srv.close();
if (failures.length) { console.error('FAIL ' + failures.length + ' 条：\n- ' + failures.join('\n- ') + '\n（若 T1 设置行就红：产物可能滞后于 src，先 node build.mjs 再复跑）'); process.exit(1); }
console.log('OK 记账提醒真页面冒烟：T1~T12 全过');
process.exit(0);
