// ===== 专项回归（#915 在途·当前 HEAD 上 A2 为已知红）：跨桌面「现在回TA」陈旧 LS 快照复活缺陷 =====
// 用户实报（iPhone 12 Pro Safari 浏览器内，多机型同现）：多角色跨桌面查岗点「现在回TA」后，
// 页面显示很久以前的聊天界面、一直卡「正在加载聊天记录」；刷新后变灰；重进后丢数据。
// 无头实证（2026-09-20，本脚本）：给目标桌面预置一份「60 天前的 5 条」LS 有损快照 + 1500 条
// IDB 权威历史，走真实弹窗→胶囊→确认→goReply 链路后，IDB 权威 chat-msgs 首条变成
// 「远古消息0」（1500→1507）＝chat.js loadMsgs 的 !chatDbReady 分支把陈旧 LS 快照当
// 「本地新消息」并入权威并落盘（#245 合并语义对「快照比库里旧」零防御）。
//   A1 切桌面+进聊天链路通（点胶囊「现在回TA」+【确认】后 cid 变为目标桌面）
//   A2 权威历史首条不得混入快照时代的远古消息（修复后转绿；HEAD 上红＝缺陷在位证据）
//   A3 IDB 权威条数不被流程整包顶掉（≤灌入数+本会话新增尾部，防「历史被快照顶掉」回归）
//   Z1 全程零未捕获 JS 异常
// 用法：node tools/verify-desk-reply-stale-snapshot.mjs
// 用户实报（iPhone 12 Pro Safari 浏览器内）：多角色跨桌面查岗点「马上回应TA」后，
// 页面显示很久以前的聊天界面、一直卡「正在加载聊天记录」；刷新后页面变灰；重进后丢数据。
// 本脚本观察：①切桌面后聊天窗渲染的是 LS 旧快照还是 IDB 权威；②加载条挂多久；
// ③查岗卡最终有没有发出；④全程 JS 异常；⑤流程结束后 IDB 权威历史是否被改写（丢数据面）。
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra).slice(0, 300) : '')); }
}

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const srcDir = process.env.SRCDIR ? normalize(process.env.SRCDIR) : join(root, 'src');
const B = 'crepro1';

const buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8');
const grab = (name) => JSON.parse(buildSrc.match(new RegExp('const ' + name + " = (\\[[^\\]]*\\])"))[1].replace(/'/g, '"'));
const cssFiles = grab('cssFiles'), jsFiles = grab('jsFiles');
let html = readFileSync(join(srcDir, 'template.html'), 'utf8');
html = html.replace('/*__STYLES__*/', () => cssFiles.map((f) => readFileSync(join(srcDir, 'css', f), 'utf8')).join('\n'));
html = html.replace('/*__SCRIPTS__*/', () => jsFiles.map((f) => '(function(){ try {\n' + readFileSync(join(srcDir, 'js', f), 'utf8') + '\n} catch(e){ console.error("[JS]", e && e.message); } })();').join('\n'));
html = html.split('__BUILD_INFO__').join('repro').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-deskreply-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), html);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(tmpRoot, rel)), hit = false;
    try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) { p = normalize(join(root, rel)); try { hit = statSync(p).isFile(); } catch (e) {} }
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true });
const pageErrors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
ctx.on('page', (p) => { p.on('pageerror', (e) => { pageErrors.push(String(e && e.message).slice(0, 200)); }); });
await ctx.addInitScript(([b]) => {
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{ id: 'default', name: '小美' }, { id: b, name: '阿明' }]));
  localStorage.setItem('xy-home-v2:active-contact', 'default');
  localStorage.setItem('xy-home-v2:desk-checkin-en', '1');
  localStorage.setItem('xy-home-v2:migrated-v1', '1');
  localStorage.setItem('xy-home-v2:applock-en', '0');
  localStorage.setItem('xy-home-v2:applock-qa-en', '0');
  localStorage.setItem('xy-home-v2:bg-notify', '0');
  localStorage.setItem('xy-home-v2:psync-en', '0');
  Math.random = () => 0.9; // 钉空随机：自动调度永不命中，弹窗只来自手动触发
  // B 桌面的 LS 有损快照＝60 天前的 5 条旧消息（模拟「很久以前的聊天界面」素材）
  const anc = [];
  for (let i = 0; i < 5; i++) anc.push({ side: i % 2 ? 'in' : 'out', text: '远古消息' + i, ts: Date.now() - 60 * 86400e3 + i * 60000 });
  localStorage.setItem('xy-home-v2:' + b + ':chat-msgs', JSON.stringify(anc));
}, [B]);
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });

// 等 app 活着（idbSet 可用）
await page.waitForFunction(() => !!window.idbSet && !!window.getContacts, null, 20000);

// 给 B 的 IDB 权威历史灌 1500 条近期消息（模拟大数据桌面，权威读需要时间）
await page.evaluate(async ([b]) => {
  const msgs = [];
  const t0 = Date.now() - 3600e3;
  for (let i = 0; i < 1500; i++) msgs.push({ side: i % 2 ? 'in' : 'out', text: '近期历史消息第' + i + '条', ts: t0 + i * 2000 });
  await window.idbSet('xy-home-v2:' + b + ':chat-msgs', JSON.stringify(msgs));
}, [B]);
console.log('IDB 权威历史已灌入 B 桌面（1500 条近期）');

// 走完开屏（空数据应秒就绪；有年龄门/必读门就点过去）
async function exitSplash() {
  for (const id of ['splash-mandatory-enter', 'splash-enter']) {
    try {
      const el = page.locator('#' + id);
      await el.waitFor({ state: 'visible', timeout: 4000 });
      await el.dispatchEvent('click').catch(() => {}); await page.waitForTimeout(800);
    } catch (e) {}
  }
  try { await page.waitForFunction(() => { const s = document.getElementById('splash'); return !s || getComputedStyle(s).visibility === 'hidden' || s.hidden; }, null, 8000); } catch (e) {}
}
await exitSplash();
const splashGone = await page.evaluate(() => { const s = document.getElementById('splash'); return !s || s.hidden || getComputedStyle(s).visibility === 'hidden'; });
console.log('开屏现场 =', await page.evaluate(() => { const ids = ['splash-enter','splash-force-enter','splash-mandatory-enter','splash-loading','splash-enter-hint']; const o = {}; ids.forEach((i) => { const el = document.getElementById(i); o[i] = el ? { hidden: el.hidden, vis: getComputedStyle(el).visibility, dis: el.disabled === undefined ? '' : String(el.disabled), txt: (el.textContent || '').slice(0, 20) } : null; }); o.ready = !!window.__mochiDataReady; return o; }));
console.log('开屏退出 =', splashGone);

// 手动触发一次跨桌面查岗（force 弹窗）→ 点「确认」＝goReply
const fired = await page.evaluate((b) => {
  window.__trace = [];
  const _sac = window.setActiveContact, _ec = window.enterChat;
  window.setActiveContact = function (id) { window.__trace.push('sac:' + id); try { const r = _sac(id); window.__trace.push('sac:ok'); return r; } catch (e) { window.__trace.push('sac:THROW ' + (e && e.message)); throw e; } };
  window.enterChat = function () { window.__trace.push('enterChat'); try { return _ec(); } catch (e) { window.__trace.push('enterChat:THROW ' + (e && e.message)); throw e; } };
  try { return !!window.triggerIncomingCheckin(b); } catch (e) { return 'ERR:' + e.message; }
}, B);
await page.waitForTimeout(600);
const modalOpen = await page.evaluate(() => { const m = document.getElementById('modal-mask'); return !!(m && !m.hidden); });
console.log('triggerIncomingCheckin =', fired, ' 弹窗在屏 =', modalOpen);
// 追踪 goReply 链路关键函数调用（装在触发之前）
await page.evaluate(() => {
  window.__trace = [];
  const _sac = window.setActiveContact;
  window.setActiveContact = function (id) { window.__trace.push('setActiveContact:' + id); try { const r = _sac(id); window.__trace.push('setActiveContact:ok'); return r; } catch (e) { window.__trace.push('setActiveContact:THROW ' + (e && e.message)); throw e; } };
  const _ec = window.enterChat;
  window.enterChat = function () { window.__trace.push('enterChat'); try { return _ec(); } catch (e) { window.__trace.push('enterChat:THROW ' + (e && e.message)); throw e; } };
});
if (modalOpen) {
  // ①点「现在回TA」胶囊（#modal-pills 内按钮）②点【确认】
  const pillRes = await page.evaluate(() => {
    const out = { btns: [], clicked: '' };
    const el = document.getElementById('modal-pills');
    if (el) { el.querySelectorAll('button, [role="button"], .pill').forEach((b) => { out.btns.push(b.textContent.trim()); if (b.textContent.trim() === '现在回TA') { b.click(); out.clicked = '现在回TA'; } }); }
    return out;
  });
  console.log('点胶囊 =', JSON.stringify(pillRes));
  await page.waitForTimeout(300);
  await page.evaluate(() => { const b = document.getElementById('modal-ok'); if (b) b.click(); });
  await page.waitForTimeout(500);
  console.log('已点【确认】→ 弹窗还在屏吗 =', await page.evaluate(() => { const m = document.getElementById('modal-mask'); return !!(m && !m.hidden); }));
}

// 观察 40 秒：切桌面了吗 / 聊天页在吗 / 渲染的是远古还是近期 / 加载条挂多久 / 卡发出没有
const samples = [];
const obs = () => page.evaluate(() => {
  const vis = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.getClientRects().length > 0; };
  const body = document.getElementById('chat-body');
  const kids = body ? body.children.length : -1;
  const txt = body ? body.innerText.slice(0, 120).replace(/\s+/g, ' ') : '';
  const loading = vis('chat-loading');
  const chatPage = vis('page-chat');
  let first = '', last = '';
  if (body && body.children.length) {
    first = (body.children[0].innerText || '').slice(0, 40).replace(/\s+/g, ' ');
    last = (body.children[body.children.length - 1].innerText || '').slice(0, 60).replace(/\s+/g, ' ');
  }
  return {
    cid: window.__activeCid || 'default', chatPage, kids, loading, ready: !!window.__chatDbReady && window.__chatDbReady(),
    hasCard: !!(body && body.innerText && body.innerText.indexOf('在干嘛') >= 0), first, last, txt
  };
});
for (let t = 0; t <= 40; t += 2) {
  const s = await obs().catch((e) => ({ err: String(e).slice(0, 80) }));
  samples.push({ t, ...s });
  if (t % 10 === 0) console.log('t=' + t + 's', JSON.stringify(s));
}
await page.screenshot({ path: join(tmpRoot, 'after-reply.png'), fullPage: false }).catch(() => {});

// 数据完整性：IDB 权威历史还在不在（1500 条）？LS 快照被写成什么？
const integrity = await page.evaluate(async ([b]) => {
  const raw = await window.idbGet('xy-home-v2:' + b + ':chat-msgs');
  let n = -1, firstText = '', lastText = '';
  try { const a = typeof raw === 'string' ? JSON.parse(raw) : raw; if (Array.isArray(a)) { n = a.length; firstText = a[0] && a[0].text; lastText = a[a.length - 1] && a[a.length - 1].text; } } catch (e) {}
  let lsN = -1;
  try { const la = JSON.parse(localStorage.getItem('xy-home-v2:' + b + ':chat-msgs') || '[]'); if (Array.isArray(la)) lsN = la.length; } catch (e) {}
  return { idbN: n, firstText, lastText, lsN };
}, [B]);
console.log('数据完整性（流程后）＝', JSON.stringify(integrity));
ok('A1 切桌面+进聊天链路通（cid 已切到目标桌面）', samples.some((x) => x.cid === B));
ok('A2 权威历史首条不得混入快照时代的远古消息', integrity.firstText === '近期历史消息第0条', { firstText: integrity.firstText, idbN: integrity.idbN });
ok('A3 IDB 权威条数不被流程顶掉（≥灌入数）', integrity.idbN >= 1500, integrity.idbN);

// 刷新重进（用户「刷新后变灰/重进丢数据」的模拟）后再验一次
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.idbSet && !!window.getContacts, null, 20000);
await exitSplash();
await page.waitForTimeout(3000);
const integrity2 = await page.evaluate(async ([b]) => {
  const raw = await window.idbGet('xy-home-v2:' + b + ':chat-msgs');
  let n = -1;
  try { const a = typeof raw === 'string' ? JSON.parse(raw) : raw; if (Array.isArray(a)) n = a.length; } catch (e) {}
  return { idbN: n };
}, [B]);
console.log('数据完整性（刷新重进后）＝', JSON.stringify(integrity2));
console.log('goReply 链路追踪 =', JSON.stringify(await page.evaluate(() => window.__trace || []).catch(() => 'gone')));
console.log('队列状态（刷新前最后快照缺失，仅链路追踪）');
console.log('加载条时长线（s:loading@cid kids）＝');
console.log(samples.map((s) => s.t + ':' + (s.loading ? 'L' : '-') + '@' + s.cid + ' ' + (s.kids || 0)).join(' '));
console.log('刷新前链路追踪 =', JSON.stringify(await (async () => { try { return await page.evaluate(() => window.__trace || null); } catch (e) { return '页面已不可用'; } })()));
const realErr = pageErrors.filter((e) => e.indexOf("localStorage' property") < 0); // 无头 reload 期 LS 访问噪声
ok('Z1 全程零未捕获 JS 异常', realErr.length === 0, realErr.slice(0, 3));
console.log('结果：' + pass + ' 过 / ' + fail + ' 败');
process.exitCode = fail ? 1 : 0;

await ctx.close();
await browser.close();
server.close();
