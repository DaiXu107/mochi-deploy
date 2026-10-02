// ===== 回归脚本：#1033＋#1041 拍卖会自制拍品（编辑台）=====
// 用法：node build.mjs && node tools/verify-1033-au-custom-add.mjs
// 背景：#1033 根治「➕自制拍品点了没反应」（ctl 不存在的方法掐断推进回调）；#1041 把三步纯文字
//   弹窗升级为全屏编辑台（用户选定方案 A：emoji 自选＋商品图片内嵌＋蒙面显式开关＋库条点选即改）。
// 本脚本盯三件事：①#1033 语义本体＝保存链每一步都有就地反馈、绝不静默冻结（校验失败留在原地换提示）；
//   ②编辑台行为（emoji/预览/开关/编辑/删除/上限/同名）；③图片白名单（恶意 img 串不得进 innerHTML）
//   ＋图片贯通（背包/记录出图）＋零 window error。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9860 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-ed1041-' + Date.now()),
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
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);

let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}
// A0 开屏关闭（同族三条件口径）
let splashClosed = false;
for (let i = 0; i < 30 && !splashClosed; i++) {
  const s = await evalJs(`(function(){
    var mm = document.getElementById('splash-mandatory');
    if (mm && !mm.hidden) {
      var sc = document.getElementById('splash-mandatory-scroll');
      if (sc) sc.scrollTop = sc.scrollHeight;
      var men = document.getElementById('splash-mandatory-enter');
      if (men && !men.classList.contains('is-disabled')) { men.click(); return 'mclicked'; }
      return 'mwait';
    }
    var sp = document.getElementById('splash');
    if (!sp || sp.classList.contains('hide')) return 'closed';
    var sb = document.getElementById('splash-box');
    if (sb) sb.scrollTop = sb.scrollHeight;
    var se = document.getElementById('splash-enter');
    if (se && !se.disabled) { se.click(); return 'clicked'; }
    return 'wait';
  })()`);
  splashClosed = s === 'closed';
  if (!splashClosed) await sleep(300);
}
const splashDiag = await evalJs(`(function(){
  var sp = document.getElementById('splash');
  return { disp: sp ? getComputedStyle(sp).display : null, hidden: sp ? sp.hidden : null };
})()`);
chk('A0 开屏已关闭（同族三条件口径）', splashClosed || splashDiag.disp === 'none' || splashDiag.hidden === true, JSON.stringify(splashDiag));

// 进拍卖会（面板自绑定入口，同 verify-1032 口径）
await evalJs(`(function(){ var app = document.querySelector('.app[data-app="chat"]'); if (app) app.click(); return 1; })()`);
await sleep(1200);
const opened = await evalJs(`(function(){
  var b = document.getElementById('more-auction');
  if (b) { b.click(); return 'btn'; }
  if (window.openAuctionPanel) { window.openAuctionPanel(); return 'api'; }
  return 'no-entry';
})()`);
await sleep(600);
await evalJs(`(function(){ var b = document.getElementById('au-intro-start'); if (b) b.click(); return 1; })()`);
await sleep(400);
chk('A1 拍卖会面板可打开', opened === 'btn' || opened === 'api', String(opened));

// 存取自制库（xyStore 优先，退回 localStorage——与 auction.js lsGet 读径同序）
const readCustom = async () => JSON.parse(await evalJs(`(function(){
  var pre = (window.activePrefix && window.activePrefix()) || 'xy-home-v2';
  var s = '';
  try { if (window.xyStore) s = window.xyStore(pre).get('auction-custom') || ''; } catch (e) {}
  if (!s) { try { s = localStorage.getItem(pre + ':auction-custom') || ''; } catch (e) {} }
  var a = []; try { a = JSON.parse(s) || []; } catch (e) {}
  return JSON.stringify(Array.isArray(a) ? a : []);
})()`));
async function seedCustom(val) { return seedKey('auction-custom', val); }
async function seedKey(key, val) {
  await evalJs(`(function(){
    var pre = (window.activePrefix && window.activePrefix()) || 'xy-home-v2';
    var s = JSON.stringify(${JSON.stringify(val)});
    try { if (window.xyStore) { window.xyStore(pre).set(${JSON.stringify(key)}, s); return 1; } } catch (e) {}
    try { localStorage.setItem(pre + ':' + key, s); } catch (e) {}
    return 0;
  })()`);
}
const edState = async () => JSON.parse(await evalJs(`(function(){
  var ed = document.getElementById('au-editor');
  var hint = document.getElementById('au-ed-hint');
  var g = document.getElementById('au-ed-grid');
  var pv = document.getElementById('au-ed-preview');
  var chipOn = ed ? ed.querySelector('.au-ed-chip.on') : null;
  return JSON.stringify({
    open: ed ? !ed.hidden : null,
    title: (document.getElementById('au-ed-title') || {}).textContent || '',
    nIco: g ? g.querySelectorAll('.au-ed-ico').length : -1,
    icoOn: g ? Array.prototype.map.call(g.querySelectorAll('.au-ed-ico.on'), function (b) { return b.getAttribute('data-ico'); }).join(',') : '',
    hint: hint ? { text: hint.textContent, hidden: hint.hidden } : null,
    preview: pv ? pv.textContent : '',
    previewImg: pv ? pv.querySelectorAll('.au-ed-pimg').length : -1,
    delHidden: (document.getElementById('au-ed-del') || {}).hidden,
    chipOn: chipOn ? chipOn.getAttribute('data-i') : null,
    name: (document.getElementById('au-ed-name') || {}).value || '',
    base: (document.getElementById('au-ed-base') || {}).value || '',
    mystery: !!(document.getElementById('au-ed-mystery') || {}).checked
  });
})()`));
const setField = (id, v) => evalJs(`(function(){
  var el = document.getElementById(${JSON.stringify(id)});
  if (!el) return 0;
  el.value = ${JSON.stringify(v)};
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 1;
})()`);
const click = (sel) => evalJs(`(function(){ var b = document.querySelector(${JSON.stringify(sel)}); if (b) { b.click(); return 1; } return 0; })()`);

// A2 ➕ 打开编辑台（新件态）
await seedCustom([]);
chk('A2 点 ➕ 打开全屏编辑台（hidden 解除＋新件标题＋删除键隐藏）', await click('#au-add') && (await sleep(250), (await edState()).open === true) , 'click#au-add');
let S = await edState();
chk('A3 新件态：标题「自制新拍品」、无库条选中、emoji 格 24 款', S.open === true && S.title.indexOf('自制新拍品') >= 0 && S.nIco === 24 && S.delHidden === true, JSON.stringify(S));

// B1 emoji 自选：点第 5 格（🏮）→ 选中态＋预览脸更新
await click('#au-ed-grid .au-ed-ico:nth-child(5)');
await sleep(150);
S = await edState();
chk('B1 emoji 点选即选中（.on 唯一）且预览脸跟随', S.icoOn === '\u{1F3EE}', JSON.stringify({ on: S.icoOn }));
// B2 实时预览：填名称/底价 → 预览行就地反映
await setField('au-ed-name', '星星灯牌');
await setField('au-ed-base', '52');
await sleep(150);
S = await edState();
chk('B2 实时预览含名称与起拍价', S.preview.indexOf('星星灯牌') >= 0 && S.preview.indexOf('¥52') >= 0, S.preview);
// B3 #1033 语义本体：空名称保存＝就地提示不冻结
await setField('au-ed-name', '');
await click('#au-ed-save');
await sleep(150);
S = await edState();
chk('B3 空名称保存就地换提示（弹窗/编辑台不冻结、不关闭）', S.open === true && S.hint && S.hint.hidden === false && S.hint.text.indexOf('名称') >= 0, JSON.stringify(S.hint));
// B4 非法底价同样就地拦
await setField('au-ed-name', '星星灯牌');
await setField('au-ed-base', 'abc');
await click('#au-ed-save');
await sleep(150);
S = await edState();
chk('B4 非法底价就地拦（提示「大于 0」，编辑台仍开）', S.open === true && S.hint && S.hint.text.indexOf('大于 0') >= 0, JSON.stringify(S.hint));
// B5 蒙面开关：开 → 预览演示 🎁＋「神秘拍品」
await setField('au-ed-base', '52');
await evalJs(`(function(){ var c = document.getElementById('au-ed-mystery'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
await sleep(150);
S = await edState();
chk('B5 蒙面开关即时演示（预览名＝神秘拍品）', S.mystery === true && S.preview.indexOf('神秘拍品') >= 0 && S.preview.indexOf('星星灯牌') < 0, JSON.stringify({ m: S.mystery, pv: S.preview }));
// B6 保存入库：字段全对（ico 自选值、base 分、mystery 1）
await click('#au-ed-save');
await sleep(250);
let C = await readCustom();
S = await edState();
chk('B6 保存收台且入库一条（自选 emoji＋底价分＋蒙面 1）', S.open === false && C.length === 1 && C[0].ico === '\u{1F3EE}' && C[0].base === 5200 && C[0].mystery === 1 && C[0].name === '星星灯牌', JSON.stringify({ open: S.open, c: C[0] }));
// B7 库条点选即改：➕ 重开 → 点库条 → 值回填＋删除键现身
await click('#au-add');
await sleep(200);
chk('B7 库条渲染（已有 1/20 · 点选即改）', (await evalJs(`(function(){ var l = document.getElementById('au-ed-lib'); return l && l.querySelectorAll('.au-ed-chip').length; })()`)) === 1, 'chips');
await click('#au-ed-lib .au-ed-chip');
await sleep(200);
S = await edState();
chk('B8 点库条进编辑态（名称/底价回填、删除键现身、标题带名）', S.open === true && S.name === '星星灯牌' && S.base === '52' && S.delHidden === false && S.title.indexOf('星星灯牌') >= 0 && S.chipOn === '0', JSON.stringify(S));
// B9 改底价保存＝原位替换不增条
await setField('au-ed-base', '66');
await click('#au-ed-save');
await sleep(250);
C = await readCustom();
chk('B9 编辑保存原位替换（仍 1 条、底价 6600）', C.length === 1 && C[0].base === 6600, JSON.stringify(C));
// B10 删除明面化：点库条→删除→openModal 确认→库空
await click('#au-add');
await sleep(150);
await click('#au-ed-lib .au-ed-chip');
await sleep(150);
await click('#au-ed-del');
await sleep(250);
const delModal = JSON.parse(await evalJs(`(function(){
  var m = document.getElementById('modal-mask');
  var s = document.getElementById('modal-static');
  var ok = document.getElementById('modal-ok');
  return JSON.stringify({ open: !!m && !m.hidden, text: s ? s.textContent : '', ok: ok ? ok.textContent : '' });
})()`));
chk('B10 删除先弹不可撤回确认（含拍品名＋按钮文案「删除」）', delModal.open === true && delModal.text.indexOf('星星灯牌') >= 0 && delModal.ok === '删除', JSON.stringify(delModal));
await click('#modal-ok');
await sleep(250);
C = await readCustom();
S = await edState();
chk('B11 确认后删除生效（库空＋编辑台收起）', C.length === 0 && S.open === false, JSON.stringify({ n: C.length, open: S.open }));
// C1 图片白名单：收藏条目 img 塞恶意串 → 背包渲染不得产出该 img（auSafeImg 丢弃、回退 emoji）
const evil = '" onerror="alert(1)';
await seedKey('auction-items', [{ ico: '\u{1F3B9}', img: 'x" src="y' + evil, name: '坏图灯', fen: 1000, ts: Date.now() }]);
await evalJs(`(function(){ var b = document.getElementById('au-bag'); if (b) b.click(); return 1; })()`);
await sleep(300);
const bagImg = JSON.parse(await evalJs(`(function(){
  var ov = document.getElementById('au-overlay');
  var tile = ov ? ov.querySelector('.au-bag-tile') : null;
  return JSON.stringify({
    imgs: tile ? tile.querySelectorAll('img').length : -1,
    bad: document.querySelectorAll('#au-overlay img[src*="onerror"]').length,
    emoji: tile ? tile.textContent : ''
  });
})()`));
chk('C1 恶意 img 串被白名单丢弃（回退 emoji、不产出 img 节点）', bagImg.imgs === 0 && bagImg.bad === 0 && bagImg.emoji.indexOf('\u{1F3B9}') >= 0, JSON.stringify(bagImg));
// C2 合法 dataURL 贯通：背包出图
const tinyJpeg = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';
await seedKey('auction-items', [{ ico: '\u{1F3B9}', img: 'data:image/jpeg;base64,' + tinyJpeg, name: '好图灯', fen: 1000, ts: Date.now() }]);
await evalJs(`(function(){ var b = document.getElementById('au-bag'); if (b) b.click(); return 1; })()`);
await sleep(300);
const bagImg2 = await evalJs(`(function(){
  var ov = document.getElementById('au-overlay');
  var im = ov ? ov.querySelector('.au-bag-tile img') : null;
  return im && im.src.indexOf('data:image/jpeg') === 0 ? 'ok' : String(im && im.src).slice(0, 40);
})()`);
chk('C2 合法内嵌图贯通背包卡（.au-bag-img 出图）', bagImg2 === 'ok', String(bagImg2));
await evalJs(`(function(){ var b = document.getElementById('au-btn-start'); if (b) b.click(); return 1; })()`);
await sleep(200);
// C3 满 20 拦截（就地提示、不加条）
await seedCustom(Array.from({ length: 20 }, (_, i) => ({ ico: '\u{1F381}', name: '占位' + i, desc: 'd', base: 1000, wish: 'w', mystery: 0 })));
await click('#au-add');
await sleep(200);
await setField('au-ed-name', '第二十一');
await setField('au-ed-base', '1');
await click('#au-ed-save');
await sleep(200);
S = await edState();
C = await readCustom();
chk('C3 满 20 保存就地拦（提示「先删一个」、仍 20 条、编辑台不关）', S.open === true && S.hint && S.hint.text.indexOf('20') >= 0 && C.length === 20, JSON.stringify({ hint: S.hint, n: C.length }));
// C4 同名拦截（想改走库条）
await setField('au-ed-name', '占位0');
await sleep(50);
await click('#au-ed-save');
await sleep(200);
S = await edState();
chk('C4 同名保存就地拦（提示走库条编辑）', S.open === true && S.hint && S.hint.text.indexOf('同名') >= 0, JSON.stringify(S.hint));
await click('#au-ed-cancel');
await sleep(150);
await seedCustom([]);
// Z 全程零页面错误
const errs = await evalJs(`JSON.stringify(window.__jsErrors || [])`);
chk('Z 全程零 window error（含 ctl.val 同款 TypeError 复发面）', errs === '[]', String(errs).slice(0, 300));

console.log(`\nverify-1033-au-custom-add: ${pass} PASS / ${fail} FAIL`);
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);
