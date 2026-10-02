// ===== 回归验证 #984：恋爱纪念日「点击设置日期无反应」（用户直派 · iPhone X / iOS16.7 / 夸克）=====
// 用法：node build.mjs && node tools/verify-love-date-entry.mjs
//       隔离副本加 --root=<目录>（脚本按 <root>/index.html 起服务，src 静态项也从该目录读）
// 背景：该入口原实现＝「透明的原生 date 控件铺满假按钮」——按钮 pointer-events:none 且无
//       任何点击处理器，点按能否生效、取回的日期字符串是什么形态，全看内核把触摸转发给原生
//       控件的行为与内核的 date 支持（date 回落 text 的内核给的是「20260601」这类无连字符串，
//       落库即脏值 → 界面出现「20260601 年 undefined 月 undefined 日」）。iPhone 夸克实报
//       「点击设置恋爱纪念日无反应」，用户明说同族机型同现。功能大全「纪念 · 恋爱纪念日」
//       的链式 .click() 也正落在这个没有处理器的按钮上＝点了没反应（点中计数还照加）。
// 修法：改站内月历弹层（#mem-date-mask，与「添加纪念日」共用 .mem-cal 渲染），按钮自己接
//       点击；日期写入收口到 setLoveStart + normDateStr（只认 YYYY-MM-DD，容忍无连字符/点/
//       斜杠历史形态）。零机型分支。
// 检查项：S 静态锚（覆盖层与 pointer-events:none 撤除、点击接线、共用月历、写入口收口）；
//         B 无头行为（真实点按开弹层／选日期落库并三处联动／取消不写／重开回显／
//           功能大全链式点击可开／脏值不渲染成 undefined／关掉后不残留覆盖层）；
//         Z 零页面异常。
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const argRoot = (process.argv.find((a) => a.startsWith('--root=')) || '').split('=')[1];
const root = argRoot ? normalize(argRoot) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
const read = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch (e) { return ''; } };

// ---------------- S 组：静态锚 ----------------
const tpl = read('src/template.html');
const css = read('src/css/chat-pages.css');
const per = read('src/js/personalize.js');
const hub = read('src/js/feature-hub.js');
const prod = read('index.html');

check('S1 纪念页按钮在位且不再有覆盖其上的原生 date 控件', /id="love-date-btn"/.test(tpl) && !/love-date-input/.test(tpl), 'love-date-input 残留=' + /love-date-input/.test(tpl));
check('S2 假按钮已撤除 pointer-events:none（按钮自己接点击）', /\.mem-date-btn\s*\{[^}]*\}/.test(css) && !/\.mem-date-btn\s*\{[^}]*pointer-events:\s*none/.test(css));
check('S3 覆盖式原生控件的 CSS 规则已撤除', !/#love-date-input/.test(css));
check('S4 按钮接线到站内月历弹层', /dateBtn\.addEventListener\('click', openLoveDateModal\)/.test(per));
check('S5 日期写入收口 setLoveStart + normDateStr 严格校验', /function setLoveStart\(v\) \{/.test(per) && /function normDateStr\(v\) \{/.test(per) && /const y = \+m\[1\], mo = \+m\[2\], d = \+m\[3\];/.test(per));
check('S6 月历渲染/导航为两弹层共用件（单一实现）', /function memCalPaint\(panel, ym, selDate, onPick\) \{/.test(per) && /function memCalNavBind\(panel, ym, onChange\) \{/.test(per) && /memCalNavBind\(memMask, mvYM, renderMemCal\);/.test(per) && /memCalNavBind\(memDateMask, mdYM, renderMemDateCal\);/.test(per));
check('S7 弹层含按年跳（选几年前的纪念日不必点几十下）', /data-nav="-12"/.test(per) && /data-nav="12"/.test(per));
check('S8 恋爱纪念日弹层存在且「确定」走 setLoveStart', /id = 'mem-date-mask'/.test(per) && /if \(!setLoveStart\(mdSel\)\)/.test(per));
check('S9 更新路径统一经 normDateStr（脏值不再渲染成 undefined）', (per.match(/normDateStr\(store\.get\('love-start'\)\)/g) || []).length >= 3, '命中 ' + (per.match(/normDateStr\(store\.get\('love-start'\)\)/g) || []).length + ' 处');
check('S10 功能大全「纪念 · 恋爱纪念日」入口仍指向该按钮（链式点击现可生效）', /go: \['\.app\[data-app="memory"\]', '#love-date-btn'\]/.test(hub));
if (prod) {
  const ext = read('js/personalize.js');
  check('S11 产物 index.html 的按钮已是弹层触发器、且无旧覆盖控件', /aria-haspopup="dialog"/.test(prod) && !/love-date-input/.test(prod), 'aria=' + /aria-haspopup="dialog"/.test(prod) + ' 旧控件=' + /love-date-input/.test(prod));
  check('S12 产物外置 js/personalize.js 含新弹层与按年跳', /mem-date-mask/.test(ext) && /data-nav="-12"/.test(ext) && /openLoveDateModal/.test(ext));
} else {
  check('S11 产物存在（未构建则跳过此项）', false, 'index.html 不存在，先 node build.mjs');
  check('S12 外置产物存在（未构建则跳过此项）', false, 'js/personalize.js 不存在，先 node build.mjs');
}

// ---------------- 静态服务器 ----------------
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_12 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.7 Mobile/15E148 Safari/604.1';

let browser = null;
// 杂音浮层清理：定期备份提醒弹窗 / 开屏问答门 / TA 的小问题 都会盖住纪念页，与本批无关
const quiet = (page) => page.evaluate(`(function(){
  try {
    localStorage.setItem('xy-home-v2:__last-backup-ok', String(Date.now()));
    localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now()));
  } catch (e) {}
  var opened = [];
  ['modal-mask','tc-mask','qa-mask'].forEach(function(id){ var m=document.getElementById(id); if(m && !m.hidden){ opened.push(id); m.hidden=true; } });
  document.body.classList.remove('scroll-lock');
  return opened.join(',');
})()`);
async function boot(page) {
  for (let i = 0; i < 40; i++) { if (await page.evaluate('!!window.__mochiDataReady').catch(() => 0)) break; await sleep(250); }
  await page.evaluate("(function(){var s=document.getElementById('splash');if(s&&s.parentNode)s.parentNode.removeChild(s);return 1;})()");
  await quiet(page);
  await sleep(400);
  await quiet(page);
}
const openMemory = (page) => page.evaluate("(function(){var a=document.querySelector('.app[data-app=\"memory\"]');if(!a)return 'no-app';a.click();var p=document.getElementById('page-memory');return (p&&!p.hidden)?'ok':'hidden';})()");
const maskState = (page) => page.evaluate(`(function(){
  var m=document.getElementById('mem-date-mask');
  if(!m) return JSON.stringify({exists:false});
  var cs=getComputedStyle(m);
  return JSON.stringify({exists:true, hidden:!!m.hidden, display:cs.display, vis:cs.visibility});
})()`);
const tapCenter = async (page, sel) => {
  const box = await page.locator(sel).first().boundingBox();
  if (!box) return false;
  await page.touchscreen.tap(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
  await sleep(350);
  return true;
};
// 不抛版本：元素不存在/不可见时返回 false，让后续断言各自报红（对照副本要能跑完整套）
const safeTap = async (page, sel) => { try { return await tapCenter(page, sel); } catch (e) { return false; } };
const safeClick = async (page, sel) => { try { await page.locator(sel).first().click({ timeout: 4000 }); return true; } catch (e) { return false; } };
// 实际落库键（多联系人命名空间前缀不确定，按后缀找）
const loveKey = (page) => page.evaluate("(function(){var ks=Object.keys(localStorage).filter(function(k){return /love-start$/.test(k);});return ks.length?ks[0]:'';})()");
const readLove = (page) => page.evaluate("(function(){var ks=Object.keys(localStorage).filter(function(k){return /love-start$/.test(k);});return ks.length?localStorage.getItem(ks[0]):'(none)';})()");

try {
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await boot(page);
  const entered = await openMemory(page);
  check('B0 进入纪念页（夹具前提）', entered === 'ok', entered);

  // B1：真实点按按钮 → 站内月历弹层出现，且点按位置命中弹层内部（不再是透明原生控件）
  const tapped = await safeTap(page, '#love-date-btn');
  const st1 = JSON.parse(await maskState(page));
  check('B1 点按「点击设置日期」当场打开站内月历弹层', tapped && st1.exists && !st1.hidden && st1.display !== 'none' && st1.vis !== 'hidden', JSON.stringify(st1));
  const hitInPanel = await page.evaluate(`(function(){
    var m=document.getElementById('mem-date-mask'); if(!m) return 'no-mask';
    var p=m.querySelector('.mem-add-panel'); if(!p) return 'no-panel';
    var b=p.getBoundingClientRect();
    var el=document.elementFromPoint(Math.round(b.left+b.width/2), Math.round(b.top+8));
    return el && p.contains(el) ? 'in-panel' : 'covered-by:' + (el ? (el.id || el.className || el.tagName) : 'null');
  })()`);
  check('B2 弹层自身可见可点（没被别的层盖住）', hitInPanel === 'in-panel', hitInPanel);

  // B3：按年跳 + 选日期 + 确定 → 落库并三处联动
  const calTitle = () => page.evaluate("(function(){var e=document.querySelector('#mem-date-mask .mem-cal-title');return e?e.textContent:'';})()");
  const before = await calTitle();
  await safeClick(page, '#mem-date-mask .mem-cal-btn[data-nav="-12"]');
  await sleep(200);
  const afterYear = await calTitle();
  const y0 = parseInt(before, 10), y1 = parseInt(afterYear, 10);
  check('B3 ‹‹ 一次按年跳（标题年份 -1）', y1 === y0 - 1, before + ' → ' + afterYear);
  const title = afterYear.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  const expect = title ? title[1] + '-' + String(title[2]).padStart(2, '0') + '-01' : '';
  await safeClick(page, '#mem-date-mask .mem-cal-cell[data-d="' + expect + '"]');
  await sleep(250);
  const selOk = await page.evaluate("!!document.querySelector('#mem-date-mask .mem-cal-cell.sel[data-d=\"" + expect + "\"]')");
  check('B4 点日期打上选中态', selOk, '期望 ' + expect);
  await safeTap(page, '#mem-date-mask .mem-add-ok');
  const after = await page.evaluate(`(function(){
    var t=document.getElementById('love-date-btn-txt');
    return JSON.stringify({
      btn:t?t.textContent:'',
      setAttr:document.getElementById('love-date-btn').getAttribute('data-set'),
      memDays:(document.getElementById('mem-love-days')||{}).textContent,
      memDate:(document.getElementById('mem-love-date')||{}).textContent,
      memNext:(document.getElementById('mem-next')||{}).textContent,
      deskDays:(document.getElementById('love-days')||{}).textContent,
      deskDate:(document.getElementById('love-date')||{}).textContent,
      maskHidden:!!(document.getElementById('mem-date-mask')||{}).hidden
    });
  })()`);
  const A = JSON.parse(after);
  const stored = await readLove(page);
  const expTxt = expect.split('-');
  check('B5 确定后按 YYYY-MM-DD 落库', stored === expect, 'stored=' + stored + '（键 ' + (await loveKey(page)) + '）期望=' + expect);
  check('B6 按钮文字显示所选日期', A.btn === expTxt[0] + ' 年 ' + expTxt[1] + ' 月 ' + expTxt[2] + ' 日' && A.setAttr === '1', A.btn);
  check('B7 纪念页相伴天数/起始行/下一纪念日三处联动', /^\d+$/.test(String(A.memDays)) && +A.memDays >= 1 && String(A.memDate).indexOf(expTxt[0] + '.' + expTxt[1] + '.' + expTxt[2]) >= 0 && /还有 \d+ 天/.test(String(A.memNext)), 'days=' + A.memDays + ' date=' + A.memDate + ' next=' + A.memNext);
  check('B8 桌面相伴天数/起始行同步', String(A.deskDays) === A.memDays + ' 天' && String(A.deskDate).indexOf(expTxt[0] + '.' + expTxt[1] + '.' + expTxt[2]) >= 0, 'desk=' + A.deskDays + ' / ' + A.deskDate);
  check('B9 确定后弹层关闭', A.maskHidden === true);

  // B10：关掉弹层后按钮位置不再被任何覆盖层占据（原方案的透明控件就在这一点上）
  await quiet(page);
  const hitAfter = await page.evaluate(`(function(){
    var b=document.getElementById('love-date-btn'); if(!b) return 'no-btn';
    var r=b.getBoundingClientRect();
    var el=document.elementFromPoint(Math.round(r.left+r.width/2), Math.round(r.top+r.height/2));
    return (el===b || b.contains(el)) ? 'self' : 'covered-by:' + (el ? (el.id || el.className || el.tagName) : 'null');
  })()`);
  check('B10 按钮本身可命中（无残留覆盖层）', hitAfter === 'self', hitAfter);

  // B11：取消不写
  await quiet(page);
  await safeTap(page, '#love-date-btn');
  const beforeCancel = await readLove(page);
  await safeClick(page, '#mem-date-mask .mem-cal-btn[data-nav="-1"]');
  await sleep(200);
  const otherCell = await page.evaluate(`(function(){
    var c=document.querySelector('#mem-date-mask .mem-cal-cell[data-d]:not(.sel)');
    if(!c) return '';
    c.click();
    return c.getAttribute('data-d');
  })()`);
  await safeTap(page, '#mem-date-mask .mem-add-cancel');
  await sleep(200);
  const afterCancel = await readLove(page);
  const cancelState = JSON.parse(await maskState(page));
  check('B11 取消不改动已存日期且弹层关闭', !!otherCell && afterCancel === beforeCancel && cancelState.hidden === true, '选了 ' + otherCell + ' 但 stored 仍 ' + afterCancel);

  // B12：重开回显已存日期（视图停在那个年月 + 选中态）
  await quiet(page);
  await safeTap(page, '#love-date-btn');
  const re = await page.evaluate(`(function(){
    var m=document.getElementById('mem-date-mask'); if(!m) return JSON.stringify({ok:false});
    return JSON.stringify({ok:true, title:m.querySelector('.mem-cal-title').textContent, sel:(m.querySelector('.mem-cal-cell.sel')||{}).getAttribute?m.querySelector('.mem-cal-cell.sel').getAttribute('data-d'):null});
  })()`);
  const R = JSON.parse(re);
  check('B12 重开回显已存日期（选中态+视图年月）', R.ok && R.sel === expect && R.title.indexOf(expTxt[0]) >= 0, JSON.stringify(R));
  await safeTap(page, '#mem-date-mask .mem-add-cancel');

  // B13：功能大全那条链式点击（.app 开页 + #love-date-btn.click()）现在真的能开弹层
  await page.evaluate("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=true;});var p=document.getElementById('page-phone');if(p)p.hidden=false;return 1;})()");
  await page.evaluate("(function(){var a=document.querySelector('.app[data-app=\"memory\"]');if(a)a.click();document.getElementById('love-date-btn').click();return 1;})()");
  await sleep(400);
  const st13 = JSON.parse(await maskState(page));
  check('B13 功能大全「纪念 · 恋爱纪念日」链式点击可开弹层（原为死入口）', st13.exists && !st13.hidden, JSON.stringify(st13));
  await safeTap(page, '#mem-date-mask .mem-add-cancel');

  // B14：脏值（date 回落 text 内核落库的「20260601」）不再渲染成 undefined，且归一化可继续用
  // 必须用「全新 context + 载入前种值」——在已有页面上种值会被 pagehide 的内存落盘冲掉（实测）。
  const key = await loveKey(page);
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  await ctx2.addInitScript(`(function(){ try {
    localStorage.setItem(${JSON.stringify(key || 'xy-home-v2:default:love-start')}, '20260601');
    localStorage.setItem('xy-home-v2:__last-backup-ok', String(Date.now()));
    localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now()));
  } catch (e) {} })()`);
  const page2 = await ctx2.newPage();
  const errs2 = [];
  page2.on('pageerror', (e) => errs2.push(e.message));
  await page2.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await boot(page2);
  await openMemory(page2);
  const seedState = await readLove(page2);
  const D = JSON.parse(await page2.evaluate(`(function(){
    var txt=(document.getElementById('love-date-btn-txt')||{}).textContent||'';
    var days=(document.getElementById('mem-love-days')||{}).textContent||'';
    var desk=(document.getElementById('love-days')||{}).textContent||'';
    return JSON.stringify({txt:txt, days:days, desk:desk});
  })()`));
  const anyUndef = /undefined|NaN/.test(D.txt + '|' + D.days + '|' + D.desk);
  check('B14 脏值不渲染成「undefined 月」等破相文案', seedState === '20260601' && !anyUndef, '种子=' + seedState + ' ' + JSON.stringify(D));
  const normOk = /2026 年 06 月 01 日/.test(D.txt) || D.txt === '点击设置日期';
  check('B15 脏值要么被归一化显示、要么退回未设置态（不留半截）', seedState === '20260601' && normOk, '显示=' + D.txt);
  check('Z2 脏值场景零页面异常', errs2.length === 0, errs2.slice(0, 3).join(' | '));
  await ctx2.close();

  check('Z1 全流程零页面异常', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  console.log('运行失败：' + (e && e.message ? e.message : e));
} finally {
  try { if (browser) await browser.close(); } catch (e) {}
  try { server.close(); } catch (e) {}
}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
