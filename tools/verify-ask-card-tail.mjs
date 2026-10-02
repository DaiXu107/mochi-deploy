// ===== 回归脚本：#337 聊天尾巴日志回放丢互动卡问题字段（卡片在、问题空白） =====
// 用法：node build.mjs && node tools/verify-ask-card-tail.mjs
// 背景（用户报障：多机型同现「联系人发的互动卡片里不显示问题」）：
//   chat.js #180 尾巴日志（防安卓 IDB 事务挂起丢消息的第二副本）chatTailAppend 只收
//   {ts,side,special,text}——ask-choose/ask-curious/ask-roast 的专用问题字段与查岗
//   askOptions 全被丢弃。IDB 整包落盘失败（一加/OPPO/真我/荣耀/小米 Edge 族实测高发）
//   后 chatTailMerge 回放出的互动卡＝special 在、问题字段空 → 渲染 choose/curious 只读
//   专用字段 → 问题位置空白。修复：日志条目带 x（互动字段包），回放还原；渲染加
//   || rec.text 自愈兜底（存量已写坏的空白记录重进聊天即恢复显示）。
// 验证（无头 Chrome 390×844）：
//   A1 修后日志条目含 x 包（发一张小问题卡后读 LS chat-tail）
//   A2 回放含 x 的小问题卡 → 卡片显示问题文本（红：无 x 回放＝空白）
//   A3 存量无 x 旧条目回放 → 渲染回退 rec.text 仍显示问题（自愈）
//   A4 查岗卡回放含 askOptions（单选可作答）
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (c, name) => { if (c) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } };

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
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
await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(3500);

// A1：发一张小问题卡，日志条目应带 x 包（choiceQuestion/choiceOptions）
await page.evaluate(async () => { if (window.enterChat) window.enterChat(); });
await page.waitForTimeout(800);
const a1 = await page.evaluate(async () => {
  window.triggerTaChooseNow && window.triggerTaChooseNow();
  window.triggerCkQuestion && window.triggerCkQuestion();
  await new Promise((r) => setTimeout(r, 1500));
  const raw = localStorage.getItem((window.activePrefix ? window.activePrefix() : 'xy-home-v2:default:') + ':chat-tail') || '[]';
  const arr = JSON.parse(raw);
  return {
    choose: arr.find((j) => j.special === 'ask-choose' && j.x && j.x.choiceQuestion) || null,
    ck: arr.find((j) => j.special === 'ask-card' && j.x && j.x.askQuestion !== undefined) || null,
  };
});
ok(!!a1.choose, 'A1 小问题卡日志条目含 x.choiceQuestion');
ok(a1.choose && Array.isArray(a1.choose.x.choiceOptions) && a1.choose.x.choiceOptions.length > 0, 'A1b 小问题卡日志条目含 x.choiceOptions');
ok(!!a1.ck, 'A1c 查岗卡日志条目含 x.askQuestion');

// A2+A3：清掉内存与 IDB 里的卡（模拟整包落盘丢失），只留日志条目回放
await page.evaluate(async () => {
  // 构造：历史只有一条普通文本；日志里三条互动卡（新格式含 x / 旧格式无 x）。
  // 日志必须走应用自己的存储接口写（直接写 localStorage 会被 idb.js 存储层缓存回写覆盖）
  const t = Date.now();
  const pre = window.activePrefix ? window.activePrefix() : 'xy-home-v2:default:';
  const tail = [
    { ts: t - 900, side: 'in', special: 'ask-choose', text: '新格式问题？', x: { choiceQuestion: '新格式问题？', choiceOptions: [{ t: '好', reply: null }], choicePref: '', choiceCat: '' } },
    { ts: t - 800, side: 'in', special: 'ask-curious', text: '旧格式好奇问题？' },
    { ts: t - 700, side: 'in', special: 'ask-card', text: '旧格式查岗在干嘛？', x: { askQuestion: '旧格式查岗在干嘛？', askOptions: [{ t: '好呀', reply: null }, { t: '不要', reply: null }], askType: 'single' } },
  ];
  window.xyStore(pre).set('chat-tail', JSON.stringify(tail));
  await window.idbSet(pre + ':chat-msgs', JSON.stringify([{ ts: t - 5000, side: 'out', text: '历史锚点消息' }]));
  try { await window.idbSet(pre + ':chat-meta', ''); } catch (e) {}
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(4000);
const a2 = await page.evaluate(async () => {
  if (window.enterChat) window.enterChat();
  await new Promise((r) => setTimeout(r, 1500));
  const qs = Array.from(document.querySelectorAll('#chat-body .msg-ask-q')).map((el) => el.textContent.trim());
  return qs;
});
ok(a2.includes('新格式问题？'), 'A2 含 x 回放的小问题卡显示问题');
ok(a2.includes('旧格式好奇问题？'), 'A3 存量无 x 旧条目回放退 rec.text 自愈显示');
ok(a2.includes('旧格式查岗在干嘛？'), 'A4 查岗卡回放显示问题');
// A4b：回放的查岗卡带选项字段（点开可作答的基础）
const a4b = await page.evaluate(async () => {
  const pre = window.activePrefix ? window.activePrefix() : 'xy-home-v2:default:';
  const v = await window.idbGet(pre + ':chat-msgs');
  const arr = typeof v === 'string' ? JSON.parse(v) : v;
  const ck = (arr || []).find((m) => m && m.special === 'ask-card');
  return ck && Array.isArray(ck.askOptions) && ck.askOptions.length === 2;
});
ok(!!a4b, 'A4b 回放后的查岗卡落库带 askOptions 两个选项');

console.log('----');
console.log('通过 ' + pass + ' / 失败 ' + fail);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
