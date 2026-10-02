// ===== 回归脚本：#335 问问TA文字题回应接聊天字卡/词典开关（settings.useChatReply） =====
// 用法：node build.mjs && node tools/verify-ask-chat-reply.mjs
// 背景（用户反馈：问问TA文字题的回答只会用「询问·回应」预设池/字卡库，联系人用不上
//   系统预设字卡的默认聊天字卡和词典）：ta-ask.js openAskReply 只把预设池随机一条传给
//   chatAskReply，经 pickAskCardReply 做 90/10 混合；getDefaultCards/quoteSpellPick 两条
//   普通聊天回应链路都不参与。修复：TA的询问设置页新增「文字题回应接聊天字卡/词典」
//   开关（默认关=原行为）；开启后 taAskTextReply 按普通聊天同源顺序生成回应——
//   ① getDefaultCards('chat') 整体概率抽默认聊天字卡 ② quoteSpellPick 拼字概率抽词典
//   语录（问答卡只回一条，固定单气泡空格连卡）③ 都未命中＝原预设池行为；生成结果经
//   chatAskReply 新增第4参 opts.raw 直传，不再被 pickAskCardReply 二次混合。
// 验证：
//   S1~S7 静态断言：开关行/开关门/抽取顺序/raw 直传/回显与保存/哨兵登记
//   R1 页面加载零 JS 报错
//   R2 设置页开关点选 → settings.useChatReply 持久化（ta-ask 键）
//   R3 刷新回显：开关状态与存储一致（renderAskSettings）
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (c, name) => { if (c) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } };

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// —— S 静态断言 ——
const taAskSrc = read('src/js/ta-ask.js');
const chatSrc = read('src/js/chat.js');
const tplSrc = read('src/template.html');
const bmSrc = read('build.mjs');

ok(tplSrc.includes('id="ta-ask-chatcard"'), 'S1 template.html 设置页开关行（ta-ask-chatcard）');
ok(taAskSrc.includes('if (!(d.settings && d.settings.useChatReply)) return null;'), 'S2 开关门：useChatReply 关=直接返回 null（原预设池行为）');
const iDef = taAskSrc.indexOf("window.getDefaultCards('chat')");
const iSpell = taAskSrc.indexOf('window.quoteSpellPick(window.replyCfg())');
ok(iDef > -1 && iSpell > -1 && iDef < iSpell, 'S3 生成顺序：默认聊天字卡整体概率先抽、词典拼字后替换（同普通聊天）');
ok(/taAskTextReply\(\)[\s\S]{0,200}chatAskReply\(msgIdx, answer, chatReply, \{ raw: true \}\)/.test(taAskSrc), 'S4 openAskReply：chatReply 命中时 raw 直传 chatAskReply');
ok(chatSrc.includes('if (opts && opts.raw && preset) {'), 'S5 chat.js chatAskReply raw 直传分支（跳过 90/10 混合）');
ok(taAskSrc.includes("ccEl.checked = !!s.useChatReply") && taAskSrc.includes('d.settings.useChatReply = askChatCard.checked;'), 'S6 开关回显 + change 保存 useChatReply');
ok(bmSrc.includes('#335 文字题聊天链路回应·开关门') && bmSrc.includes('#335 文字题聊天链路回应·raw 直传'), 'S7 build.mjs 两条 #335 哨兵在位');

// —— R 运行时断言（无头 Chrome 390×844） ——
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push(String(e && e.message || e)));
await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(3500);

ok(jsErrors.length === 0, 'R1 页面加载零 JS 报错' + (jsErrors.length ? '（' + jsErrors[0] + '）' : ''));

// R2：进入 TA的询问设置页，点开关 → 存储持久化
await page.evaluate(() => {
  document.querySelectorAll('.page').forEach(p => { p.hidden = true; });
  const pg = document.getElementById('page-ta-ask'); if (pg) pg.hidden = false;
});
await page.waitForTimeout(300);
const box = await page.$('#ta-ask-chatcard');
ok(!!box, 'R2a 设置页开关控件存在');
if (box) {
  // 程序化触发真实 change 监听器（页面切换态下控件可见性不稳定，点选语义等价）
  await page.evaluate(() => {
    const el = document.getElementById('ta-ask-chatcard');
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const saved = await page.evaluate(() => {
    const st = (window.activeStore && window.activeStore()) || null;
    const raw = st ? st.get('ta-ask') : (localStorage.getItem('xy-home-v2:ta-ask') || '');
    try { return JSON.parse(raw).settings.useChatReply === true; } catch { return false; }
  });
  ok(saved, 'R2b 点选开关后 settings.useChatReply=true 已写盘');
}

// R3：刷新后回显与存储一致
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(3000);
const echoed = await page.evaluate(() => {
  const el = document.getElementById('ta-ask-chatcard');
  return !!(el && el.checked);
});
ok(echoed, 'R3 刷新后开关回显=开（renderAskSettings 读存储）');

await browser.close();
server.close();
console.log(fail ? `verify-ask-chat-reply：${pass} 通过 / ${fail} 失败` : `verify-ask-chat-reply：${pass}/${pass} 全过`);
process.exit(fail ? 1 : 0);
