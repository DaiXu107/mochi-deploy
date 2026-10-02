// ===== 回归验证：聊天昵称与桌面彻底解耦（FIX-REGRESSION #45） =====
// 背景：用户要求聊天设置「联系人昵称/我的昵称」不跟随桌面——聊天域只读 cs-lbl-*，
// 未设时走取名链 cs-lbl-partner → 联系人名片名 → 称呼词（#775a；我的昵称侧默认「我」）；
// 桌面美化昵称只影响桌面。本脚本走真实链路：
// 设桌面昵称 → 刷新 → 断言聊天页顶栏/聊天设置行不受影响 → 走弹窗设聊天昵称
// → 断言生效+持久化 → 再断言桌面键未被波及。
// 用法：node tools/verify-chat-nick-independent.mjs
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

async function bootTo(pathId) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 25000 });
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate('!!window.__mochiDataReady')) break;
    await sleep(300);
  }
  await page.evaluate("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(600);
  if (pathId) await page.evaluate("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='" + pathId + "');});return true;})()");
  await sleep(300);
}

// 1. 注入桌面昵称（模拟用户在桌面美化里设过昵称），清掉聊天专用键
await bootTo(null);
await page.evaluate("(function(){var s=window.activeStore(); s.set('lbl-partner','桌面昵称甲'); s.set('lbl-user','桌面我甲'); s.remove('cs-lbl-partner'); s.remove('cs-lbl-user'); return true;})()");

// 2. 刷新后：聊天页顶栏不显示桌面昵称；聊天设置行显示「未设置」；桌面键仍在
await bootTo('page-chat-settings');
const h1 = await page.evaluate("document.getElementById('chat-partner-name').textContent");
check('未设聊天昵称时顶栏不跟随桌面昵称', h1 !== '桌面昵称甲', 'header=' + h1);
const r1 = await page.evaluate("(function(){return {p:(document.getElementById('cs-lbl-partner-val')||{}).textContent, u:(document.getElementById('cs-lbl-user-val')||{}).textContent};})()");
// #775a 起未设聊天昵称时显示的是「联系人名片名」（不再是写死的 TA）；本夹具默认名片名＝「默认」。
// 立意不变：它跟的是名片名，绝不跟桌面美化昵称。
const cardName = await page.evaluate("(window.contactNameFor && window.contactNameFor(window.__activeCid)) || 'TA'");
check('设置行未设时显示「未设置（当前显示「名片名」）」', r1.p === '未设置（当前显示「' + cardName + '」）', JSON.stringify(r1) + ' card=' + cardName);
check('设置行未设时显示「未设置（默认 我）」', r1.u === '未设置（默认 我）', JSON.stringify(r1));
const d1 = await page.evaluate("window.activeStore().get('lbl-partner')");
check('桌面昵称键未被清除', d1 === '桌面昵称甲', 'lbl-partner=' + d1);
const pn1 = await page.evaluate("window.chatPartnerName()");
check('chatPartnerName 未设时取名片名（且不等于桌面昵称）', pn1 === cardName && pn1 !== '桌面昵称甲', 'chatPartnerName=' + pn1 + ' card=' + cardName);

// 3. 走真实弹窗设聊天昵称（联系人 + 我的）
await page.evaluate("(function(){document.getElementById('cs-lbl-partner').click();return true;})()");
await sleep(350);
await page.evaluate("(function(){var i=document.getElementById('modal-input'); i.value='小甜甜'; i.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('modal-ok').click(); return true;})()");
await sleep(350);
await page.evaluate("(function(){document.getElementById('cs-lbl-user').click();return true;})()");
await sleep(350);
await page.evaluate("(function(){var i=document.getElementById('modal-input'); i.value='甜甜我'; i.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('modal-ok').click(); return true;})()");
await sleep(350);
const r2 = await page.evaluate("(function(){return {p:(document.getElementById('cs-lbl-partner-val')||{}).textContent, u:(document.getElementById('cs-lbl-user-val')||{}).textContent, cs: window.activeStore().get('cs-lbl-partner')};})()");
check('设置联系人昵称后行值生效', r2.p === '小甜甜', JSON.stringify(r2));
check('设置我的昵称后行值生效', r2.u === '甜甜我', JSON.stringify(r2));

// 4. 刷新持久化 + 生效域断言
await bootTo('page-chat-settings');
const h2 = await page.evaluate("document.getElementById('chat-partner-name').textContent");
const pn2 = await page.evaluate("window.chatPartnerName()");
check('刷新后聊天昵称持久化并显示在顶栏', h2 === '小甜甜' && pn2 === '小甜甜', 'header=' + h2 + ' chatPartnerName=' + pn2);
const d2 = await page.evaluate("(function(){return {dp: window.activeStore().get('lbl-partner'), du: window.activeStore().get('lbl-user')};})()");
check('桌面昵称保持独立未被波及', d2.dp === '桌面昵称甲' && d2.du === '桌面我甲', JSON.stringify(d2));

// 5. 清空聊天昵称 → 回默认 TA/我（不再显示桌面昵称）
await page.evaluate("(function(){var s=window.activeStore(); s.remove('cs-lbl-partner'); s.remove('cs-lbl-user'); return true;})()");
await bootTo('page-chat-settings');
const h3 = await page.evaluate("document.getElementById('chat-partner-name').textContent");
const r3 = await page.evaluate("(document.getElementById('cs-lbl-partner-val')||{}).textContent");
check('清空后顶栏回默认（不显示桌面昵称）', h3 !== '桌面昵称甲', 'header=' + h3);
check('清空后行值回「未设置（当前显示「名片名」）」', r3 === '未设置（当前显示「' + cardName + '」）', 'row=' + r3);

if (pageErrors.length) console.log('页面错误: ' + pageErrors.join(' | '));
const fails = results.filter(r => !r.ok).length;
console.log(fails ? ('RESULT: ' + fails + ' FAIL') : 'RESULT: ALL PASS');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
