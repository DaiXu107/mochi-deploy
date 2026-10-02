// ===== 验证 #1188：「邀请TA」半框的「邀请记录」（今天直列 / 更早按日折叠 / 日期组分页）=====
// 需求（用户直派）：「邀请卡片功能缺少邀请历史记录」＋「当天的历史记录只显示当天的，其他时间的
//   记录默认折叠，分页加载」。
// 断言：S 静态锚（模板块、分组判据、分页判据、清空只摘邀请、两路落库带结果、模式接线、CSS 折叠规则、
//   文案面、哨兵登记）；B 行为（无头真实页：种三天以上的邀请记录 → 开半框 → 今天直列 / 折叠组数 /
//   展开收起 / 加载更多 / 重开复位 / 问问模式不显示 / 点字卡发一条后记录带结果 / 清空不动问问记录）；
//   Z 零 JS 异常。
// 用法：node tools/verify-1188-invite-history.mjs [--root=<已构建副本目录>]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize((process.argv.find((a) => a.startsWith('--root=')) || '').split('=')[1] || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => { try { return readFileSync(join(root, f), 'utf8'); } catch (e) { return ''; } };
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); } };

// ---- S 静态（判据本体，不认名字）----
const ck = read('src/js/chat.js');
const tpl = read('src/template.html');
const css = read('src/css/chat-main.css');
const dk = read('src/css/dark.css');
const fh = read('src/js/feature-hub.js');
const bm = read('build.mjs');
ok(tpl.includes('id="chat-ask-hist"') && tpl.includes('id="chat-ask-hist-toggle"') && tpl.includes('id="chat-ask-hist-list"'),
  'S1 半框内「邀请记录」块三件套在模板里（静态锚，与 JS 渲染两端同步）');
ok(ck.includes('const today = g.groups.filter(x => x.key === todayKey);') && ck.includes("const past = g.groups.filter(x => x.key !== todayKey);"),
  'S2 今天与更早分组（删＝「当天只显示当天、其他折叠」的口径整体没了）');
ok(ck.includes('const shown = past.slice(0, ihPastShown);') && ck.includes('ihPastShown += IH_PAGE_DAYS;'),
  'S3 更早日期组分页＋「加载更多」推进游标（删＝日期组无限铺开或翻页死掉）');
ok(ck.includes("const keep = Array.isArray(all) ? all.filter(x => x && x.type !== 'invite') : [];"),
  'S4 清空只摘邀请、同键里的问问记录原样保留（写成整键清空＝顺带删掉「问问TA」历史）');
ok(ck.includes("window.chatDeskHistPush(myCid, { type: 'invite', q: content, a: reply || status, st: status, ts: recTs });")
  && ck.includes("list.unshift({ type: 'invite', q: content, a: reply || status, st: status, ts: recTs });"),
  'S5 两条落库路径都带结果字段 st（缺一路＝那条路来的记录看不出接受还是拒绝）');
ok(ck.includes('if (invHist) invHist.hidden = !isInvite;'),
  'S6 记录块只在「邀请TA」模式显示（删＝问问TA 半框也挂一枚无关记录行）');
ok(css.includes('.chat-ask-hist-list[hidden] { display:none; }') && css.includes('.chat-ask-hist[hidden] { display:none; }'),
  'S7 display:flex 会盖掉 hidden，折叠规则显式补上（缺＝列表永远收不起来）');
ok(dk.includes('[data-theme="dark"] .ih-day-btn'), 'S8 暗色主题下折叠行/翻页钮有对应规则');
ok(tpl.includes('【📜 邀请记录】') && fh.includes("n: '邀请记录（我发出的邀请）'"),
  'S9 文案面两处齐（功能介绍页 + 功能大全可搜索条目——用户报的正是「不知道去哪看」）');
ok((bm.match(/'#1188[a-f]/g) || []).length === 6, 'S10 六条哨兵登记在位', '实数=' + (bm.match(/'#1188[a-f]/g) || []).length);

// ---- B 行为 ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(normalize(root))) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port + '/index.html';

const chromePath = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge（CHROME_PATH）'); process.exit(1); }
const port = 13700 + Math.floor(Math.random() * 200);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(tmpdir(), 'mochi-1188-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 80; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 200); return r && r.result ? r.result.value : null; };

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// 每次导航前种记录：今天 3 条（带结果）＋更早 6 个自然日各 2 条＋同键混 2 条「问问」记录
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    (function () {
      try { localStorage.setItem('xy-home-v2:applock-qaskip', '1'); } catch (e) {}
      var now = Date.now();
      var d0 = new Date(now); d0.setHours(0, 0, 0, 0);
      var t0 = d0.getTime();
      var base = t0 + Math.max(30000, Math.floor((now - t0) / 2));
      var H = [];
      for (var i = 0; i < 3; i++) H.push({ type: 'invite', q: '1188今天' + i, a: '好，我答应你。', st: '接受', ts: base - i * 1000 });
      for (var d = 1; d <= 6; d++) for (var j = 0; j < 2; j++) H.push({ type: 'invite', q: '1188前' + d + '-' + j, a: '这次不行。', st: '拒绝', ts: t0 - d * 86400000 + 43200000 + j * 60000 });
      H.push({ type: 'ask', q: '1188问问保留1', a: '嗯嗯', ts: base - 600000 });
      H.push({ type: 'ask', q: '1188问问保留2', a: '好呀', ts: t0 - 3 * 86400000 + 43200000 });
      try { localStorage.setItem('xy-home-v2:default:invite-ask-history', JSON.stringify(H)); } catch (e) {}
      window.__seedN = H.length;
    })();
  `
});
await cdp('Page.navigate', { url: origin });
await sleep(3000);
for (let i = 0; i < 60; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
await ev("(function(){var b=document.getElementById('splash-enter')||document.getElementById('splash-btn');if(b){b.click();}return 1;})()");
await sleep(600);
await ev("document.querySelector('.app[data-app=\"chat\"]').click(); 1;");
await sleep(500);
const openInvite = async () => { await ev("document.getElementById('more-invite').click(); 1;"); await sleep(400); };
const closeInvite = async () => { await ev("(function(){var p=document.getElementById('chat-ask-panel');if(p&&!p.hidden){var b=document.getElementById('chat-ask-close');if(b)b.click();}return 1;})()"); await sleep(300); };
// TA 的跟发提问卡可能自己弹开回答弹窗（popupProb 默认 70%）——先把任何在开的 modal 关掉，
// 否则 B13a 会把它当「清空确认弹窗」判成假绿
const killModal = () => ev("(function(){var m=document.getElementById('modal-mask');if(m&&!m.hidden){var c=document.getElementById('modal-cancel');if(c)c.click();}return 1;})()");
const snap = () => ev(`(function(){
  var box=document.getElementById('chat-ask-hist'), list=document.getElementById('chat-ask-hist-list'), tg=document.getElementById('chat-ask-hist-toggle');
  if(!box||!list||!tg) return JSON.stringify({none:1});
  return JSON.stringify({
    box:!box.hidden, open:!list.hidden, tg:tg.textContent,
    items:list.querySelectorAll('.tc-listitem').length,
    days:list.querySelectorAll('.ih-day-btn').length,
    day0:(list.querySelector('.ih-day-btn')||{}).textContent||'',
    today:(list.querySelector('.ih-day-today')||{}).textContent||'',
    more:(function(){var m=document.getElementById('ih-more');return m?m.textContent:'';})(),
    empty:(function(){var e=list.querySelector('.ta-empty');return e?e.textContent:'';})()
  });})()`);
const S = async () => JSON.parse(await snap());

ok(JSON.stringify(await ev("(function(){var a=JSON.parse(localStorage.getItem('xy-home-v2:default:invite-ask-history')||'[]');return [a.length,a.filter(function(x){return x.type==='invite';}).length,a.filter(function(x){return x.type==='ask';}).length];})()")) === '[17,15,2]',
  'B0 夹具已落库（17 条＝15 邀请 + 2 问问；写不进当前桌面命名空间则后面全不可信）');

await openInvite();
let s = await S();
ok(s.none !== 1 && s.box === true, 'B1 打开「邀请TA」半框时记录块随之显示', JSON.stringify(s));
await closeInvite();
await ev("document.getElementById('more-ask').click(); 1;"); await sleep(400);
ok(JSON.parse(await snap()).box === false, 'B2 切到「问问TA」模式记录块收起（不在别的模式里挂一枚无关行）');
await closeInvite();

await openInvite();
s = await S();
ok(s.open === false && /邀请记录（15）/.test(s.tg), 'B3 默认列表收起，标题带总条数（只数邀请＝15，不含问问那 2 条）', JSON.stringify(s));
await ev("document.getElementById('chat-ask-hist-toggle').click(); 1;"); await sleep(300);
s = await S();
ok(s.open === true && s.items === 3 && /今天 · 3 条/.test(s.today),
  'B4 展开后「今天」直接列出（3 条），更早的一条都不铺开', JSON.stringify({ items: s.items, today: s.today }));
ok(s.days === 5 && /还有 1 天 · 2 条/.test(s.more),
  'B5 更早的记录按自然日各折成一行、一次只给 5 组，其余藏在「加载更多（还有 1 天 · 2 条）」后面', JSON.stringify({ days: s.days, more: s.more }));
const before = s.items;
await ev("document.querySelector('#chat-ask-hist-list .ih-day-btn').click(); 1;"); await sleep(300);
s = await S();
ok(s.items === before + 2 && /▴/.test(s.day0), 'B6 点日期行就地展开该组（多 2 条）并翻成 ▴', JSON.stringify({ items: s.items, day0: s.day0 }));
await ev("document.querySelector('#chat-ask-hist-list .ih-day-btn').click(); 1;"); await sleep(300);
s = await S();
ok(s.items === before && /▾/.test(s.day0), 'B7 再点收回该组（折叠可逆）', 'items=' + s.items);
await ev("document.getElementById('ih-more').click(); 1;"); await sleep(300);
s = await S();
ok(s.days === 6 && s.more === '', 'B8 点「加载更多」再放 5 组（6 组放完后按钮自己消失）', JSON.stringify({ days: s.days, more: s.more }));
await closeInvite();
await openInvite();
s = await S();
ok(s.open === false, 'B9 重开半框复位成「列表收起」（不带着上次的展开态）');
await ev("document.getElementById('chat-ask-hist-toggle').click(); 1;"); await sleep(300);
s = await S();
ok(s.days === 5 && s.items === 3, 'B10 重开后半分页游标复位（仍只露 5 组、今天仍只 3 条）', JSON.stringify({ days: s.days, items: s.items }));

// B11 真实发一条邀请（点「我的邀请」第一张字卡）→ 记录带结果落地
await ev("document.querySelector('#invite-list .cc-item').click(); 1;");
await sleep(6000);
const afterSend = JSON.parse(await ev("(function(){var a=JSON.parse(localStorage.getItem('xy-home-v2:default:invite-ask-history')||'[]');var v=a.filter(function(x){return x.type==='invite';});var n=v.filter(function(x){return /^1188/.test(x.q||'');}).length;return JSON.stringify([v.length,n,String((v[0]||{}).st||'')]);})()"));
ok(afterSend[0] === 16 && afterSend[1] === 15 && ['接受', '拒绝', '未回应'].indexOf(afterSend[2]) >= 0,
  'B11 点字卡发出邀请后新增 1 条邀请记录、且带 TA 的结果（' + afterSend.join('/') + '）');
await openInvite();
await ev("document.getElementById('chat-ask-hist-toggle').click(); 1;"); await sleep(300);
s = await S();
ok(s.items === 4 && /今天 · 4 条/.test(s.today), 'B12 新发的那条当天可见（今天 4 条）', JSON.stringify({ items: s.items, today: s.today }));

// B13 清空：只清邀请，问问记录必须一根毛都不掉
await killModal(); await sleep(200);
await ev("document.getElementById('chat-ask-hist-clear').click(); 1;"); await sleep(400);
const maskState = JSON.parse(await ev("(function(){var m=document.getElementById('modal-mask'),t=document.getElementById('modal-title');return JSON.stringify([m&&!m.hidden?1:0,(t&&t.textContent)||'']);})()"));
ok(maskState[0] === 1 && /清空本桌面的全部邀请记录/.test(maskState[1]),
  'B13a 清空走 openModal 确认（不是 alert/confirm，也不一点就删）', JSON.stringify(maskState));
await ev("document.getElementById('modal-ok').click(); 1;"); await sleep(400);
const cleared = JSON.parse(await ev("(function(){var a=JSON.parse(localStorage.getItem('xy-home-v2:default:invite-ask-history')||'[]');return JSON.stringify([a.length,a.filter(function(x){return x.type==='invite';}).length,a.filter(function(x){return x.type==='ask';}).length]);})()"));
ok(cleared[0] === 2 && cleared[1] === 0 && cleared[2] === 2, 'B14 清空后只剩 2 条问问记录（邀请清零、问问原样保留）', cleared.join('/'));
await ev("document.getElementById('chat-ask-hist-toggle').click(); 1;"); await sleep(300);
s = await S();
ok(/还没有邀请记录/.test(s.empty) && s.items === 0 && s.days === 0 && s.more === '', 'B15 空态给可执行提示，且不再渲染折叠行/翻页按钮', JSON.stringify(s));

ok(Number(await ev('(window.__jsErrors||[]).length')) === 0, 'Z1 全程零 JS 异常', await ev('JSON.stringify((window.__jsErrors||[]).slice(0,2))'));

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n== #1188 邀请记录（邀请TA 半框）验证: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);
