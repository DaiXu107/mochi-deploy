// verify-1415-ask-multi.mjs — #1415「多选题」这一档全链路是否真的通（作者直派）
// 作者原话（2026-09-29）：「问问ta 功能没有设置联系人答题可多选的功能」「批量设置问卷也没有设置问卷
//   答题可以多选」。
// 病灶不在某一处写坏，而是整条链少一档：题型只有 text/single 两值，于是「解析→随机作答→卡片回显→
//   手动勾选→收藏回库」五处都没有 multi 这条分支可走。判据一律零机型／零 UA 分支，只问屏上真出了什么、
//   落库那一串长什么样。
// 本尺钉住四件事：
//   ① 多选题能开出来（半框第三枚按钮＋批量问卷题干里的「多选」标记都能解析成 multi）；
//   ② TA 答多选题真的一次答好几个（答案串里确有「、」，且每一段都落在该题选项集合内＝不是随口拼的）；
//   ③ 单选题一字未被动过（点一下即落地、答案不含「、」）——这是「覆盖式修补」最容易撞坏的一侧；
//   ④ 我自己答 TA 的多选题是「勾选＋提交」两拍，且重开卡片能看见我勾的那几个还亮着。
// 用法：node build.mjs && node tools/verify-1415-ask-multi.mjs
//       红侧／隔离副本：SERVE_ROOT=<纯 HEAD 副本> node tools/verify-1415-ask-multi.mjs
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || here);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
console.log('serve root = ' + root);

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + String(x).slice(0, 200) + ']' : '')); } };
// 外置 js 不在 index.html 里（#860b 全外置），按产物侧真实形态读
const jsOf = (f) => { try { return readFileSync(join(root, 'js', f), 'utf8'); } catch (e) { try { return readFileSync(join(root, 'index.html'), 'utf8'); } catch (e2) { return ''; } } };
const htmlOf = () => { try { return readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) { return ''; } };
const count = (s, needle) => s.split(needle).length - 1;

// ================= S 组：产物源码级（两侧同尺，红侧＝纯 HEAD） =================
console.log('S 组 产物源码级');
{
  const ask = jsOf('ta-ask.js'), chat = jsOf('chat.js'), idx = htmlOf();
  // S1 随 #1480 改口（2026-09-30）：解析出口改走 sq 组装（为了按题限选 multiMax），守的还是
  // 「multi 这一档真的被分流出来」——旧 needle 钉的那行单行 push 已退役，改口必须连本脚本一起改。
  ok(count(ask, "const sq = { type: cur.multi ? 'multi' : 'single', text: cur.text, options: cur.opts.slice() };") === 1,
    'S1 问卷解析器有分流出口（红侧读数＝只有 single/text 两档，多选题在解析那一步就没了）',
    'count=' + count(ask, "const sq = { type: cur.multi"));

  ok(count(ask, 'askMultiMarkOf(') === 3 && count(ask, 'function askMultiMarkOf(') === 1,
    'S2 「多选」标记只有一处定义、两处消费（问卷解析＋题库批量导入）＝两入口不会各写一套判据',
    'def=' + count(ask, 'function askMultiMarkOf(') + ' use=' + count(ask, 'askMultiMarkOf('));

  ok(count(chat, 'data-atype="multi"') === 1 && count(chat, 'data-atype="single"') === 1 && count(chat, 'data-atype="text"') === 1,
    'S3 半框题型三枚齐备且各一枚（文字回复／单选题／多选题）',
    'text=' + count(chat, 'data-atype="text"') + ' single=' + count(chat, 'data-atype="single"') + ' multi=' + count(chat, 'data-atype="multi"'));

  ok(count(chat, "store.get('ask-multi-max')") === 1 && count(chat, "store.set('ask-multi-max'") === 1,
    'S4 上限那把尺只有一个读写点（两处界面共用它；各留一份＝半框拖到 3、问卷里还是另一套）',
    'get=' + count(chat, "store.get('ask-multi-max')") + ' set=' + count(chat, "store.set('ask-multi-max'"));

  ok(count(chat, "if (window.chatAskReply) window.chatAskReply(idx, String(o.t || ''), o.reply);") === 1,
    'S5 单选题「点一下即落地」那条老路径原样还在（加多选题不该把单选改成两拍＝覆盖式修补）',
    'count=' + count(chat, "window.chatAskReply(idx, String(o.t || ''), o.reply)"));

  ok(count(idx, '.msg-inplace .ip-opt-chk.on { border-color:var(--ink); background:rgba(0,0,0,.04); font-weight:600; }') === 1
    && count(idx, '[data-theme="dark"] .msg-inplace .ip-opt-box { background:var(--dark-card); border-color:rgba(255,255,255,.34); }') === 1,
    'S6 勾选态在浅色与暗色两条产物样式里都落到了（暗色沿用浅色那套＝黑底上看不见框）',
    'light=' + count(idx, '.ip-opt-chk.on { border-color') + ' dark=' + count(idx, '[data-theme="dark"] .msg-inplace .ip-opt-box'));

  // 本批新增代码块里不许出现机型／UA 判据（全站铁律）：拿新增的标识串当尺，扫它前后各 600 字符
  const uaBad = /navigator\.userAgent|iPhone|iPad|HarmonyOS|Xiaomi|Redmi|MicroMessenger/i;
  const win = (s, needle, span) => { const i = s.indexOf(needle); return i < 0 ? '' : s.slice(Math.max(0, i - span), i + needle.length + span); };
  ok(!uaBad.test(win(chat, 'function mochiPickMulti', 900)) && !uaBad.test(win(ask, 'function askMultiMarkOf', 900)) && !uaBad.test(win(chat, 'function askMultiMaxLoad', 900)),
    'S7 本批三处新增逻辑里零机型／零 UA 分支（判据只取题目自身的结构事实）');

  ok(count(ask, "'】我的选择：' + ans") === 1 && count(ask, "const isPick = (q.type === 'single' || q.type === 'multi')") === 1,
    'S8 多选题逐条发进聊天时同样带「我的选择：」（漏了它＝多选题念成一条自由文本，与单选不同口径）',
    'isPick=' + count(ask, "const isPick = (q.type === 'single' || q.type === 'multi')"));
}

// ================= 无头启动 =================
console.log('A 组 无头行为');
const { browser, page, jsErrors } = await (async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text().slice(0, 160)); });
  await p.addInitScript(() => {
    try { localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now())); } catch (e) {}
    try { localStorage.setItem('xy-home-v2:storage-guide-shown', '1415'); } catch (e) {}
  });
  await p.goto(baseUrl + '/index.html');
  await p.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 25000 }).catch(() => {});
  await p.evaluate(() => {
    const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
    const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; s.style.display = 'none'; }
    const q = document.getElementById('qa-mask'); if (q) { q.style.setProperty('display', 'none', 'important'); q.hidden = true; }
    document.querySelectorAll('.guide-mask, .onboarding-mask').forEach((m) => { m.style.display = 'none'; });
    // 思考时间收到 1 秒档（用户可见设置里就有这一行）——作答落地才比得起，且下面 A4x 立刻读回自证
    try { window.activeStore().set('ask-think-secs', '1'); } catch (x) {}
  });
  await p.waitForTimeout(900);
  return { browser: b, page: p, jsErrors: errs };
})();

const ev = (expr) => page.evaluate(expr);
// 进聊天页：底部导航在聊天页会被藏掉，先判元素在不在再点（同 tools/probe-* 的进页守卫）
async function enterChatPage() {
  await ev(`(function(){
    const b=document.querySelector('[data-go="chat"]');
    if(b&&b.offsetParent!==null) b.click();
    else if(window.enterChat) window.enterChat();
  })()`);
  await page.waitForTimeout(500);
}
const askOpen = () => ev(`(function(){var b=document.getElementById('more-ask');if(!b)return 'no-entry';b.click();return 'clicked';})()`);
const typeBtn = (t) => ev(`(function(){var b=document.querySelector('.chat-ask-type [data-atype="${t}"]');if(!b)return 'nobtn';b.click();return 1;})()`);

await enterChatPage();

// ---- A1 面板三枚题型按钮 ----
ok(await askOpen() === 'clicked', 'A1a 「更多」里那枚【问问TA】入口在位（红侧＝整条链没有可开的门）');
await page.waitForTimeout(400);
{
  const r = await ev(`(function(){
    const row=document.querySelector('.chat-ask-type');
    if(!row) return {none:1};
    const bs=[...row.querySelectorAll('.chat-ask-type-btn')];
    return {n:bs.length, texts:bs.map(b=>b.textContent.trim()), sel:(bs.find(b=>b.classList.contains('sel'))||{}).dataset?bs.find(b=>b.classList.contains('sel')).dataset.atype:'', rowHidden:row.hidden};
  })()`);
  ok(r.n === 3 && r.texts.join('/') === '文字回复/单选题/多选题', 'A1b 屏上真的有三枚、文案逐字如此', JSON.stringify(r));
  ok(r.sel === 'text' && r.rowHidden === false, 'A1c 默认选中「文字回复」且这一行在问问TA 模式下可见', JSON.stringify(r));
}

// ---- A2/A3 切档后选项框与上限行的收放 ----
await typeBtn('multi'); await page.waitForTimeout(250);
{
  const r = await ev(`(function(){
    const o=document.getElementById('chat-ask-opts');
    const m=document.querySelector('.chat-ask-multi-row');
    const box=o&&(o.__ceBox||o);
    return {optsHidden:o?o.hidden:'noopt', ph:o?o.placeholder:'', multiHidden:m?m.hidden:'norow', multiVal:m?m.querySelector('.stp-val').value:''};
  })()`);
  ok(r.optsHidden === false, 'A2a 选「多选题」后选项框真的展开了（隐藏态＝根本没法出题）', JSON.stringify(r));
  ok(/多选/.test(r.ph), 'A2b 选项框那句提示改口说多选（写「TA会选一个」＝指错地方）', r.ph);
  ok(r.multiHidden === false && String(r.multiVal) === '3', 'A2c 「最多选几个」那行随多选题出现，默认 3', JSON.stringify(r));
}
await typeBtn('single'); await page.waitForTimeout(200);
{
  const r = await ev(`(function(){const m=document.querySelector('.chat-ask-multi-row');const o=document.getElementById('chat-ask-opts');return {m:m?m.hidden:'',o:o?o.hidden:''};})()`);
  ok(r.m === true && r.o === false, 'A3 单选题收掉上限行但保留选项框（单选题永远抽 1 个，那根杆对它没意义）', JSON.stringify(r));
}

// ---- A4 上限写下去当场读回，关面板重开还在 ----
// 读数一律走应用自己那个 getter（window.askMultiMaxLoad）而不是另起一个 activeStore() 实例：
// 后者带自己的内存缓存，刚写进去的值它可能还看不见＝量具误红（实测踩过两次）。
ok(await ev(`(function(){return window.activeStore().get('ask-think-secs');})()`) === '1',
  'A3b 思考时间那格 1 秒真的落库了（本尺后面全指望它，设定没落地＝整组白测）');
// 一次只点一下、点完等值到位再点下一下：两发挤在同一个 evaluate 里时读回会被上一次的重排打断
async function bumpMax(times) {
  for (let i = 0; i < times; i++) {
    await ev(`(function(){var b=document.querySelector('.chat-ask-multi-row .stp-max');if(b)b.click();})()`);
    await page.waitForTimeout(120);
  }
}
const maxNow = () => ev(`(function(){return typeof window.askMultiMaxLoad==='function'?String(window.askMultiMaxLoad()):'nogetter';})()`);
{
  ok(await maxNow() === '3', 'A4-0 出厂默认档＝3（不是把默认值当成上一次留下的读数）');
  await bumpMax(2);
  await page.waitForTimeout(200);
  const read = await ev(`(function(){return {ui:(document.querySelector('.chat-ask-multi-row .stp-val')||{}).value, via:typeof window.askMultiMaxLoad==='function'?String(window.askMultiMaxLoad()):'nogetter'};})()`);
  ok(String(read.ui) === '5' && read.via === '5', 'A4a 拖两下「+」＝屏上读数与应用取数同时到 5（只改 DOM 不落库＝下次打开打回原形）', JSON.stringify(read));
  await ev(`(function(){var b=document.getElementById('chat-ask-cancel');if(b)b.click();})()`);
  await page.waitForTimeout(300);
  await askOpen(); await page.waitForTimeout(300);
  await typeBtn('multi'); await page.waitForTimeout(200);
  const again = await ev(`(function(){return (document.querySelector('.chat-ask-multi-row .stp-val')||{}).value;})()`);
  ok(String(again) === '5', 'A4b 关面板再开仍是 5（per-cid 持久化，不是一次性读数）', again);
}

// ---- A5 上限钉在 6 不再涨 ----
{
  await bumpMax(4);
  await page.waitForTimeout(200);
  const r = await ev(`(function(){return {ui:(document.querySelector('.chat-ask-multi-row .stp-val')||{}).value, via:typeof window.askMultiMaxLoad==='function'?String(window.askMultiMaxLoad()):'nogetter'};})()`);
  ok(String(r.ui) === '6' && r.via === '6', 'A5 连点「+」到 6 就钉住（越界既不打回默认、也不越界落库）', JSON.stringify(r));
}

// ---- A6 端到端：多选题发卡 → TA 一次答好几个 ----
let askCardIdx = -1;
{
  await ev(`(function(){
    const i=document.getElementById('chat-ask-input'); const b=i&&(i.__ceBox||i);
    if(b){ if(b.__ceInp){b.textContent='周末想做点什么？'; b.dispatchEvent(new Event('input',{bubbles:true})); } else b.value='周末想做点什么？'; }
    const o=document.getElementById('chat-ask-opts'); const ob=o&&(o.__ceBox||o);
    if(ob){ if(ob.__ceInp){ob.textContent='吃火锅\\n看电影\\n去爬山\\n待在家'; ob.dispatchEvent(new Event('input',{bubbles:true}));} else ob.value='吃火锅\\n看电影\\n去爬山\\n待在家'; }
    const mb=document.querySelector('.chat-ask-type [data-atype="multi"]'); if(mb) mb.click();
  })()`);
  // 上限从 A5 停着的 6 收到 2 这个确定值：cap=2 ⇒ 区间塌成「必选 2 个」，段数才可断言
  await page.waitForTimeout(150);
  for (let i = 0; i < 4; i++) { await ev(`(function(){var b=document.querySelector('.chat-ask-multi-row .stp-min');if(b)b.click();})()`); await page.waitForTimeout(120); }
  await page.waitForTimeout(250);
  const snap = await ev(`(function(){
    const i=document.getElementById('chat-ask-input'), o=document.getElementById('chat-ask-opts');
    return {q:i?i.value:'', opts:o?o.value:'', max:typeof window.askMultiMaxLoad==='function'?String(window.askMultiMaxLoad()):'nogetter'};
  })()`);
  ok(snap.q === '周末想做点什么？' && snap.opts.split('\n').length === 4 && snap.max === '2',
    'A6a 题目与四个选项真进了输入层、上限钉到 2（读写走代理值，屏上没东西后面全测不到）', JSON.stringify(snap));
  const beforeN = await ev(`(function(){return (window.getChatMsgs?window.getChatMsgs():[]).length;})()`);
  await ev(`(function(){document.getElementById('chat-ask-ok').click();})()`);
  await page.waitForTimeout(400);
  const sent = await ev(`(function(){
    const ms=window.getChatMsgs?window.getChatMsgs():[];
    for(let i=ms.length-1;i>=0;i--){const r=ms[i];if(r&&r.special==='ask')return {askType:r.askType,st:r.askStatus,n:(r.askOptions||[]).length,idx:i};}
    return {};
  })()`);
  askCardIdx = Number(sent.idx);
  ok(sent.askType === 'multi' && sent.n === 4 && String(sent.st) === 'pending', 'A6b 落库那条卡片的题型就是 multi、四个选项都在', JSON.stringify(sent));
  await ev(`(function(){var b=document.getElementById('chat-ask-close');if(b)b.click();})()`);
  // 作答是延迟落地的（思考时间 1 秒＋落地一拍）——必须等它，不许拿「刚发出那一瞬」的读数下结论
  await page.waitForFunction(`(function(){const ms=window.getChatMsgs?window.getChatMsgs():[];const r=ms[${askCardIdx}];return !!(r&&r.askStatus==='answered');})()`, null, { timeout: 9000 }).catch(() => {});
  const got = await ev(`(function(){
    const ms=window.getChatMsgs?window.getChatMsgs():[];const r=ms[${askCardIdx}];
    return r?{st:r.askStatus,a:r.askAnswer||''}:{};
  })()`);
  ok(got.st === 'answered' && got.a.indexOf('、') > 0, 'A6c TA 那一发真的多选（答案串里有「、」；红侧读数＝永远只有一项）', JSON.stringify(got));
  const set = ['吃火锅', '看电影', '去爬山', '待在家'];
  const segs = String(got.a || '').split('、');
  ok(segs.length === 2 && segs.every(s => set.indexOf(s) >= 0) && new Set(segs).size === 2,
    'A6d 上限 2 ⇒ 恰好两段、每段都是题目里的选项且不重复（拼出来的串看着多选其实瞎写＝这一条红）', got.a);
  const cardTxt = await ev(`(function(){
    const e=document.querySelector('.msg-ask[data-idx="${askCardIdx}"] .msg-ask-card');return e?e.textContent:'';})()`);
  ok(/✓/.test(cardTxt) && segs.every(s => cardTxt.indexOf(s) >= 0), 'A6e 聊天里那张卡也念出多选的整串（不只落库）', cardTxt.slice(0, 90));
  // 「已答」与「回答气泡入列」是相邻两步，轮询可能只抓到前者——等条数真的涨上去再判
  await page.waitForFunction(`(function(){return (window.getChatMsgs?window.getChatMsgs():[]).length >= ${beforeN} + 2;})()`, null, { timeout: 4000 }).catch(() => {});
  const afterN = await ev(`(function(){return (window.getChatMsgs?window.getChatMsgs():[]).length;})()`);
  ok(afterN >= beforeN + 2, 'A6f 卡片与 TA 的回答各插入一条（不是原地改了别张）', { beforeN, afterN });
  // 存量竞态观测（不是本批引入，也不由本尺判红判绿）：首答那一刻内存已 answered，
  // 落盘那一份可能还停在 pending 且少一条——量到就把读数打出来，要修的是 chat.js 的持久层。
  const race = await ev(`(function(){
    let arr=null; try{ arr=JSON.parse(window.activeStore().get('chat-msgs')||'[]'); }catch(e){}
    const mem=window.getChatMsgs?window.getChatMsgs():[];
    const m=mem[${askCardIdx}]||{}, d=(arr&&arr[${askCardIdx}])||{};
    return {memLen:mem.length, diskLen:Array.isArray(arr)?arr.length:'?', memSt:m.askStatus, diskSt:d.askStatus};
  })()`);
  console.log('   NOTE 首答落盘窗口 mem/disk＝' + JSON.stringify(race) + (race.memSt !== race.diskSt ? '（不一致＝撞上存量竞态）' : '（一致）'));
}

// ---- A9 已答多选题的回显判据（只量判据本身：现写内存态→点卡→看亮哪几行） ----
// 不去依赖 TA 那一发有没有落盘——上面 NOTE 那道持久层窗口与本批无关，攥着它比＝尺子忽红忽绿。
{
  const found = await ev(`(function(){
    const ms=window.getChatMsgs?window.getChatMsgs():[];
    for(let i=ms.length-1;i>=0;i--){const r=ms[i];if(r&&r.special==='ask'&&r.askType==='multi'&&Array.isArray(r.askOptions)&&r.askOptions.length>=4)return i;}
    return -1;
  })()`);
  const want = await ev(`(function(){
    const ms=window.getChatMsgs?window.getChatMsgs():[]; const r=ms[${found}];
    if(!r) return '';
    r.askStatus = 'answered';
    r.askAnswer = String(r.askOptions[0].t) + '、' + String(r.askOptions[2].t);   // 挑第 1、3 个，故意不连续
    document.querySelectorAll('.msg-ask[data-idx="${found}"] .msg-inplace').forEach(e => e.remove());
    const e=document.querySelector('.msg-ask[data-idx="${found}"] .msg-ask-card'); if(e)e.click();
    return r.askAnswer;
  })()`);
  await page.waitForTimeout(400);
  const back = await ev(`(function(){
    const it=document.querySelector('.msg-ask[data-idx="${found}"] .msg-inplace');
    if(!it) return {none:1};
    const rows=[...it.querySelectorAll('.ip-opt-row')];
    return {total:rows.length, sel:rows.filter(r=>r.classList.contains('sel')).map(r=>(r.querySelector('.ip-opt-t')||{}).textContent).sort()};
  })()`);
  const wantSegs = String(want || '').split('、').sort();
  ok(back.total === 4 && wantSegs.length === 2 && back.sel.join('/') === wantSegs.join('/'),
    'A9 已答多选题重开卡片：亮的正是答案里那两段、其余不亮（单选式「整串比全文」＝一灰到底）', JSON.stringify({ back, wantSegs }));
}

// ---- A7 单选题没被传染 ----
{
  await askOpen(); await page.waitForTimeout(300);
  await ev(`(function(){
    const i=document.getElementById('chat-ask-input'); const b=i&&(i.__ceBox||i);
    if(b){ if(b.__ceInp){b.textContent='现在几点想去睡？'; b.dispatchEvent(new Event('input',{bubbles:true}));} else b.value='现在几点想去睡？'; }
    const o=document.getElementById('chat-ask-opts'); const ob=o&&(o.__ceBox||o);
    if(ob){ if(ob.__ceInp){ob.textContent='十点\\n十一点\\n十二点'; ob.dispatchEvent(new Event('input',{bubbles:true}));} else ob.value='十点\\n十一点\\n十二点'; }
    document.querySelector('.chat-ask-type [data-atype="single"]').click();
    document.getElementById('chat-ask-ok').click();
  })()`);
  await page.waitForTimeout(300);
  const sIdx = await ev(`(function(){
    const ms=window.getChatMsgs?window.getChatMsgs():[];
    for(let i=ms.length-1;i>=0;i--){const r=ms[i];if(r&&r.special==='ask'&&r.askType==='single')return i;}
    return -1;
  })()`);
  await page.waitForFunction(`(function(){const ms=window.getChatMsgs?window.getChatMsgs():[];const r=ms[${sIdx}];return !!(r&&r.askStatus==='answered');})()`, null, { timeout: 9000 }).catch(() => {});
  const got = await ev(`(function(){
    const ms=window.getChatMsgs?window.getChatMsgs():[];const r=ms[${sIdx}];
    return r?{st:r.askStatus,a:r.askAnswer||''}:{};
  })()`);
  ok(got.st === 'answered' && ['十点', '十一点', '十二点'].indexOf(got.a) >= 0,
    'A7 单选题仍只抽 1 个、且绝不带「、」（多选题加进来最容易顺手把单选改成多选的邻座）', JSON.stringify(got));
}

// ---- A8/A9/A10 手动作答那两拍 ----
async function makeCard(extra, text) {
  return await ev(`(function(){
    const el=window.chatAddSystem(${JSON.stringify(text)}, ${JSON.stringify(extra)});
    return el?el.dataset.idx:'no-el';
  })()`);
}
{
  const idx = await makeCard({ special: 'ask-card', askQuestion: '冰箱里还剩什么？', askType: 'multi', askTs: Date.now(), askOptions: [{ t: '牛奶', reply: '那就喝牛奶' }, { t: '鸡蛋', reply: '' }, { t: '西瓜', reply: '西瓜得留着' }] }, '冰箱里还剩什么？');
  await page.waitForTimeout(350);
  const tip = await ev(`(function(){const e=document.querySelector('.msg-ask[data-idx="${idx}"] .msg-ask-tip');return e?e.textContent:'(no-tip)';})()`);
  ok(/多选/.test(tip) && /提交/.test(tip), 'A8a 未答多选题的提示写明「可多选，选完点提交」（沿用单选那句＝人不知道还要点第二下）', tip);
  await ev(`(function(){const e=document.querySelector('.msg-ask[data-idx="${idx}"] .msg-ask-card');if(e)e.click();})()`);
  await page.waitForTimeout(350);
  let st = await ev(`(function(){
    const it=document.querySelector('.msg-ask[data-idx="${idx}"] .msg-inplace');
    if(!it) return {none:1};
    const rows=[...it.querySelectorAll('.ip-opt-chk')];
    const b=it.querySelector('.ip-multi-submit');
    return {rows:rows.length, btnText:b?b.textContent:'', disabled:b?!!b.disabled:'nobtn', sub:!!b};
  })()`);
  ok(st.rows === 3 && st.sub === true && st.disabled === true, 'A8b 展开出三行勾选＋一枚禁用的提交按钮（没勾就没法提交）', JSON.stringify(st));
  await ev(`(function(){const it=document.querySelector('.msg-ask[data-idx="${idx}"] .msg-inplace');if(!it)return;const rs=it.querySelectorAll('.ip-opt-chk');if(rs[0])rs[0].click();if(rs[2])rs[2].click();})()`);
  await page.waitForTimeout(250);
  st = await ev(`(function(){
    const it=document.querySelector('.msg-ask[data-idx="${idx}"] .msg-inplace');
    if(!it) return {none:1};
    const rs=[...it.querySelectorAll('.ip-opt-chk')];
    const b=it.querySelector('.ip-multi-submit');
    return {on:rs.filter(r=>r.classList.contains('on')).length, text:b?b.textContent:'', dis:b?!!b.disabled:'nobtn'};
  })()`);
  ok(st.on === 2 && /已选 2 个/.test(st.text) && st.dis === false, 'A8c 勾两行 → 两行亮起来、按钮改口「已选 2 个」并可点（勾选态必须有可见读数）', JSON.stringify(st));
  await ev(`(function(){const b=document.querySelector('.msg-ask[data-idx="${idx}"] .ip-multi-submit');if(b)b.click();})()`);
  await page.waitForTimeout(500);
  st = await ev(`(function(){
    const ms=window.getChatMsgs?window.getChatMsgs():[];const r=ms[${idx}];
    const card=document.querySelector('.msg-ask[data-idx="${idx}"] .msg-ask-card');
    return {st:r?r.askStatus:'?',a:r?r.askAnswer:'',txt:card?card.textContent:''};
  })()`);
  ok(st.st === 'answered' && st.a === '牛奶、西瓜', 'A8d 提交后落库的答案是「牛奶、西瓜」（按题目原序，不是点击顺序）', JSON.stringify(st));
  ok(/已回答：牛奶、西瓜/.test(st.txt), 'A8e 卡片上念得出这一串', st.txt.slice(0, 90));
}
{
  const idx = await makeCard({ special: 'ask-card', askQuestion: '现在想喝哪杯？', askType: 'single', askTs: Date.now(), askOptions: [{ t: '美式', reply: '' }, { t: '拿铁', reply: '' }] }, '现在想喝哪杯？');
  await page.waitForTimeout(300);
  await ev(`(function(){const e=document.querySelector('.msg-ask[data-idx="${idx}"] .msg-ask-card');if(e)e.click();})()`);
  await page.waitForTimeout(300);
  const st = await ev(`(function(){
    const it=document.querySelector('.msg-ask[data-idx="${idx}"] .msg-inplace');
    const ms=window.getChatMsgs?window.getChatMsgs():[];const r=ms[${idx}];
    return {noSubmit:!(it&&it.querySelector('.ip-multi-submit')), oneClick:!!(it&&it.querySelector('.ip-opt')), st:r?r.askStatus:'?', a:r?r.askAnswer:''};
  })()`);
  ok(st.noSubmit && st.oneClick && st.st !== 'answered', 'A10 单选题展开后没有提交按钮、点一下才算（两拍没有泄漏到单选侧）', JSON.stringify(st));
  await ev(`(function(){const it=document.querySelector('.msg-ask[data-idx="${idx}"] .msg-inplace');const b=it&&it.querySelector('.ip-opt');if(b)b.click();})()`);
  await page.waitForTimeout(400);
  const st2 = await ev(`(function(){const ms=window.getChatMsgs?window.getChatMsgs():[];const r=ms[${idx}];return {st:r?r.askStatus:'?',a:r?r.askAnswer:''};})()`);
  ok(st2.st === 'answered' && ['美式', '拿铁'].indexOf(st2.a) >= 0, 'A10b 单选题点一下立刻落地', JSON.stringify(st2));
}

// ---- A11 问卷卡片里多选题的选项高亮 ----
{
  const idx = await makeCard({
    special: 'ask-survey', surveyTs: Date.now(), surveyStatus: 'done',
    surveyQs: [{ type: 'multi', text: '周末想安排点什么？', options: ['火锅', '烧烤', '剧本杀'] }],
    surveyAnswers: ['火锅、剧本杀'],
  }, '问卷（1 题）');
  await page.waitForTimeout(400);
  const st = await ev(`(function(){
    const e=document.querySelector('.msg-survey[data-idx="${idx}"] .msg-survey-card');
    if(!e) return {none:1};
    return {sel:[...e.querySelectorAll('.msg-survey-opt.sel')].map(x=>x.textContent), all:[...e.querySelectorAll('.msg-survey-opt')].length};
  })()`);
  ok(st.all === 3 && st.sel.sort().join('/') === '剧本杀/火锅', 'A11 问卷卡片里多选题亮两个选项（红侧＝一个都不亮）', JSON.stringify(st));
}

// ---- A12/A13 批量问卷页的解析与状态行 ----
{
  await ev(`(function(){ if(window.openAskSurvey) window.openAskSurvey(); })()`);
  await page.waitForTimeout(400);
  const onSurvey = await ev(`(function(){const p=document.getElementById('page-ta-ask-survey');return p?!p.hidden:'nopage';})()`);
  ok(onSurvey === true, 'A12a 批量设置问卷页打得开（红侧＝没有这一页可测）', onSurvey);
  const text = '【今晚想吃点什么？（多选）】\n火锅\n烧烤\n寿司\n【今晚想吃什么？】\n面\n饭\n【今天过得怎么样？】\n一\n';
  await ev(`(function(){
    const t=document.getElementById('ta-survey-text'); const b=t&&(t.__ceBox||t);
    if(b){ if(b.__ceInp){ b.textContent=${JSON.stringify(text)}; b.dispatchEvent(new Event('input',{bubbles:true})); b.dispatchEvent(new Event('change',{bubbles:true})); } else { b.value=${JSON.stringify(text)}; t.dispatchEvent(new Event('change',{bubbles:true})); } }
  })()`);
  await page.waitForTimeout(400);
  // 草稿态那一行才统计题型；发出之后走的是「TA 作答中」那一支，别拿错分支当读数
  const stLine = await ev(`(function(){const e=document.getElementById('ta-survey-status');return e?e.textContent:'';})()`);
  ok(/多选 1 题/.test(stLine) && /单选 1 题/.test(stLine), 'A13 草稿状态行报出「多选 1 题／单选 1 题」（不统计＝用户无从知道那句标记生没生效）', stLine.slice(0, 140));
  await ev(`(function(){ document.getElementById('ta-survey-send').click(); })()`);
  await page.waitForTimeout(600);
  const d = await ev(`(function(){ try { return JSON.parse(window.activeStore().get('ta-survey')||'{}'); } catch (e) { return {err:String(e)}; } })()`);
  const qs = Array.isArray(d.qs) ? d.qs : [];
  ok(qs.length === 3 && qs[0].type === 'multi' && qs[1].type === 'single' && qs[2].type === 'text',
    'A12b 三种题型各归其位（多选/单选/文字）——红侧读数＝第一题被解析成 single，「多选」二字还挂在题干上',
    JSON.stringify(qs.map(q => q.type + ':' + q.text)));
  ok(qs[0] && qs[0].text === '今晚想吃点什么？' && qs[0].options.length === 3,
    'A12c 标记从题干里剥掉了、选项一个不少（屏上问题不该带「（多选）」四个字）', JSON.stringify(qs[0]));
}

// ---- A14 老记录形状不打架 ----
{
  const idx = await makeCard({ special: 'ask-card', askQuestion: '（老数据）随便一题', askOptions: ['旧甲', '旧乙'], askStatus: 'answered', askAnswer: '旧甲' }, '（老数据）随便一题');
  await page.waitForTimeout(350);
  const st = await ev(`(function(){
    const e=document.querySelector('.msg-ask[data-idx="${idx}"] .msg-ask-card');
    return e?e.textContent:'(no-card)';
  })()`);
  ok(st.indexOf('undefined') < 0 && st.indexOf('NaN') < 0 && /已回答/.test(st),
    'A14a 缺 askType 的老询问卡照旧渲染成「已回答」态，屏上没有 undefined/NaN（答案格为空是量具所致：chatAddSystem 的字段白名单不收 askAnswer，不是应用丢的）', st.slice(0, 90));
  await ev(`(function(){const e=document.querySelector('.msg-ask[data-idx="${idx}"] .msg-ask-card');if(e)e.click();})()`);
  await page.waitForTimeout(300);
  const st2 = await ev(`(function(){const e=document.querySelector('.msg-ask[data-idx="${idx}"] .msg-inplace');return e?e.textContent:'(none)';})()`);
  ok(st2 === '(none)' || st2.indexOf('undefined') < 0, 'A14b 老卡点开不报错、不写出 undefined', String(st2).slice(0, 90));
}

// ---- Z1 零异常 ----
ok(jsErrors.length === 0, 'Z1 全程零 JS 异常／零 console error', jsErrors.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log('\n合计 绿 ' + pass + ' / 红 ' + fail);
process.exit(fail ? 1 : 0);
