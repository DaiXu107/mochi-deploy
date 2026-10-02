// ===== 回归验证：#616 新增【昵称互动】并入原【头像互动】并改名【头像和昵称互动】 =====
// 用户原话：「我想新增一个和聊天里的【头像互动】逻辑和机制一样的【昵称互动】功能，
//   可以存入多个文字昵称，联系人给我还有自己更换聊天昵称，直接在【头像互动】功能里加，
//   【头像互动】的功能名字修改为【头像和昵称互动】」
//
// 本脚本断言的是「改完之后用户点得到、点得动」这件事，而不是「代码里有没有那段字符串」——
// 哨兵（build.mjs #616a~d）只证代码在，这里证行为对：
//   A 半框两级切换：上排切「头像 / 昵称」、下排切「TA / 我的」，四个 pane 一次只露一个
//   B 昵称池增删清：添加（含同名查重）/ 单条删除 / 清空 + 空态
//   C TA 昵称池点选换昵称：直接换 / 同意 / 拒绝 三条概率分支（Math.random 钉死序列）
//   D 我的昵称池点选换我的昵称
//   E 定时随机更换：开关 + 到期即换 + 关闭不换；同时护栏「头像侧同机制未被改坏」
//   F 换昵称接 chat.js 改名钩子：历史系统消息里的旧昵称被清扫成 {ta}（改完名旧消息跟着变）
//   G 与头像解耦：换昵称不动 cs-avatar-partner，换头像不动 cs-lbl-partner
//
// 用法：node tools/verify-nick-interact.mjs            # 打 index.html（需先 node build.mjs）
//       node tools/verify-nick-interact.mjs --tmp      # 从 src 临时拼装（免构建，不写产物）
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
// --tmp：按 build.mjs 的 jsFiles/cssFiles 顺序从 src 拼一页（免构建、不写产物，改完 src 立刻能跑）
let tmpPage = null;
if (process.argv.includes('--tmp')) {
  const buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8');
  const cssList = Function('"use strict";return ' + buildSrc.match(/const cssFiles = (\[[^\]]+\]);/)[1])();
  const jsList = Function('"use strict";return ' + buildSrc.match(/const jsFiles = (\[[^\]]+\]);/)[1])();
  let tpl = readFileSync(join(root, 'src', 'template.html'), 'utf8');
  const css = cssList.map(f => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
  const js = jsList.map(f => readFileSync(join(root, 'src', 'js', f), 'utf8')).join('\n;\n');
  if (tpl.indexOf('/*__STYLES__*/') >= 0) tpl = tpl.replace('/*__STYLES__*/', () => css);
  else tpl = tpl.replace('</head>', () => '<style>' + css + '</style></head>');
  if (tpl.indexOf('/*__SCRIPTS__*/') >= 0) tpl = tpl.replace('/*__SCRIPTS__*/', () => js);
  else tpl = tpl.replace('</body>', () => '<script>' + js + '</scr' + 'ipt></body>');
  tmpPage = join(root, 'tmp-616-nick.html');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(tmpPage, tpl);
}

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

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + String(detail).slice(0, 260) + ']' : ''));
}

const { chromium } = await import('playwright');
let browser = null;
try {
  // 用本机 Edge/Chrome 内核（与用户设备同 Blink 引擎）；无则退回 Playwright 自带
  const fs = await import('node:fs');
  const exe = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p));
  browser = exe ? await chromium.launch({ executablePath: exe, headless: true }) : await chromium.launch();

  const errors = [];
  // 每个场景一颗独立 context：addInitScript 在任何页面脚本前清空本项目 LS 并写入种子
  async function scenario(seed, fn) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript((seed) => {
      try {
        // 应用锁问答门未越过时所有交互被它吃掉（全书假阴性）——脚本必须预置跳过标记
        localStorage.setItem('xy-home-v2:applock-qaskip', '1');
        const kill = [];
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf('xy-home-v2:') === 0) kill.push(k); }
        kill.forEach(k => localStorage.removeItem(k));
        localStorage.setItem('xy-home-v2:applock-qaskip', '1');
        Object.keys(seed || {}).forEach(k => localStorage.setItem('xy-home-v2:default:' + k, seed[k]));
      } catch (e) {}
    }, seed);
    // --tmp：打从 src 临时拼装的页（免构建验证用）；默认打构建产物 index.html
    await page.goto(baseUrl + (tmpPage ? '/tmp-616-nick.html' : '/index.html'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mochiDataReady === true, null, { timeout: 30000 }).catch(() => {});
    await sleep(500);
    await dismissSplash(page);
    try { await fn(page); } catch (e) { check('（场景异常）' + String(e && e.message || e).slice(0, 120), false); }
    await ctx.close();
  }

  // ---- 页面操作小工具 ----
  // 开屏必读/公告浮层（#splash，z999）盖住全屏时，真实鼠标点会被它吃掉 —— 必须显式越过；
  // 越过前先把必读卡滚到底并点「进入」（与 verify-all-pages / verify-about-cat 同法）。
  const dismissSplash = (page) => page.evaluate(() => {
    try {
      const mm = document.getElementById('splash-mandatory');
      if (mm && !mm.hidden) {
        const sc = document.getElementById('splash-mandatory-scroll'); if (sc) sc.scrollTop = sc.scrollHeight;
        const me = document.getElementById('splash-mandatory-enter'); if (me && !me.hidden) me.click();
        mm.hidden = true;
      }
      const sp = document.getElementById('splash');
      if (sp) { sp.classList.add('hide'); sp.hidden = true; }
      const mask = document.getElementById('modal-mask');
      if (mask && !mask.hidden) mask.hidden = true;
    } catch (e) {}
    return true;
  });
  const openLib = async (page) => {
    await dismissSplash(page);
    return page.evaluate(() => {
      window.enterChat();
      const btn = document.getElementById('more-avatar');
      if (!btn) return 'no-btn';
      btn.click();
      const c = document.getElementById('avlib-card');
      return c && !c.hidden ? 'ok' : 'closed';
    });
  };
  const paneState = (page) => page.evaluate(() => {
    const g = (id) => { const el = document.getElementById(id); return el ? !el.hidden : null; };
    const act = (id) => { const el = document.getElementById(id); return !!(el && el.classList.contains('active')); };
    return {
      paneA: g('avlib-pane-a'), paneB: g('avlib-pane-b'), paneC: g('avlib-pane-c'), paneD: g('avlib-pane-d'),
      kindAvatar: act('avlib-kind-avatar'), kindName: act('avlib-kind-name'),
      tabA: act('avlib-tab-a'), tabB: act('avlib-tab-b'),
      tabATxt: (document.getElementById('avlib-pool-name') || {}).textContent,
      tabBTxt: (document.getElementById('avlib-me-tab-name') || {}).textContent,
      title: (document.getElementById('avlib-card') || {}).textContent.slice(0, 40),
      countA: (document.getElementById('avlib-count') || {}).textContent,
      countB: (document.getElementById('avlib-me-count') || {}).textContent,
      cells: document.querySelectorAll('#avlib-nick-list .avlib-name-cell').length,
      meCells: document.querySelectorAll('#avlib-me-nick-list .avlib-name-cell').length,
      nowCells: document.querySelectorAll('#avlib-nick-list .avlib-name-cell.avlib-now').length,
      meNow: document.querySelectorAll('#avlib-me-nick-list .avlib-name-cell.avlib-now').length,
      nickEmpty: !document.getElementById('avlib-nick-empty').hidden,
      gridCells: document.querySelectorAll('#avlib-grid .avlib-cell').length,
      names: Array.prototype.map.call(document.querySelectorAll('#avlib-nick-list .avlib-name-txt'), e => e.textContent),
      meNames: Array.prototype.map.call(document.querySelectorAll('#avlib-me-nick-list .avlib-name-txt'), e => e.textContent),
    };
  });
  const nick = (page) => page.evaluate(() => {
    const s = window.activeStore();
    const par = () => { try { return JSON.parse(s.get('nick-lib') || '[]'); } catch (e) { return []; } };
    const me = () => { try { return JSON.parse(s.get('nick-me-lib') || '[]'); } catch (e) { return []; } };
    return {
      lib: par(), meLib: me(),
      partner: s.get('cs-lbl-partner'), user: s.get('cs-lbl-user'),
      avatarPartner: s.get('cs-avatar-partner'),
      last: s.get('nick-lib-last'), meLast: s.get('nick-me-lib-last'),
      header: (document.getElementById('chat-partner-name') || {}).textContent,
      hist: (function () { try { return JSON.parse(s.get('sysmsg-nick-hist') || '[]'); } catch (e) { return []; } })(),
      msgs: (window.getChatMsgs ? window.getChatMsgs() : []).map(m => String(m && m.text || '')),
    };
  });
  // 添加昵称走「多行批量」弹窗（一行一个）——这里真实走一遍：点按钮 → 确认弹窗用的是
  // 多行框（不是单行输入）→ 把整段文本（含换行/空行/重复行）写进去 → 点确定。
  // 填值必须是「直写 value + 派发 input 事件」——与 verify-chat-nick-independent /
  // verify-cjian 等同法：安卓上该框会被 mobile-adapt 换成 .ce-box 内容可编辑层，
  // Playwright 的 page.fill 落不到代理上（实测填完读回仍是空串），必须走产品自己的读写口径。
  // 返回弹窗形态供断言（textareaShown / inputHidden），顺带证明「改成多行框」这条需求落地了。
  const addNick = async (page, btnId, text) => {
    await page.click('#' + btnId);
    await page.waitForSelector('#modal-mask:not([hidden])', { timeout: 5000 });
    const shape = await page.evaluate(() => ({
      textareaShown: !document.getElementById('modal-textarea').hidden,
      inputHidden: document.getElementById('modal-input').hidden,
      rows: document.getElementById('modal-textarea').rows,
      ph: document.getElementById('modal-textarea').placeholder,
      staticTxt: document.getElementById('modal-static').textContent,
    }));
    await page.evaluate((t) => {
      const el = document.getElementById('modal-textarea');
      el.value = t;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('modal-ok').click();
    }, text);
    await page.waitForFunction(() => { const m = document.getElementById('modal-mask'); return !m || m.hidden; }, null, { timeout: 5000 });
    await sleep(120);
    return shape;
  };
  const toastTxt = (page) => page.evaluate(() => {
    const t = document.getElementById('cc-toast');
    return t ? t.textContent : '';
  });
  // chat.js 的改名清扫要 chatDbReady 才落地（未就绪时 chatSysNickChanged 只记 hist 返回，
  // 防早期覆盖权威数据）。这里用一次「不同名」探针改名探测就绪——就绪后 sysmsg-nick-swept
  // 才会被写；未就绪则等下一轮（聊天记录回填完成 / 15s 保险丝）。
  const waitChatReady = async (page) => {
    for (let i = 0; i < 44; i++) {
      const swept = await page.evaluate(() => {
        try { window.chatSysNickChanged('zz-ready-probe'); } catch (e) {}
        return window.activeStore().get('sysmsg-nick-swept');
      });
      if (swept !== null && swept !== undefined) return true;
      await sleep(500);
    }
    return false;
  };
  // 钉死 Math.random 序列后点第 idx 条昵称（三条概率分支靠序列区分）
  const clickNickWith = (page, listSel, idx, seq) => page.evaluate(([sel, i, s]) => {
    const cells = document.querySelectorAll(sel + ' .avlib-name-cell .avlib-name-txt');
    if (!cells[i]) return 'no-cell';
    const orig = Math.random;
    const q = s.slice();
    Math.random = () => (q.length ? q.shift() : orig());
    try { cells[i].click(); } finally { Math.random = orig; }
    return 'ok';
  }, [listSel, idx, seq]);

  // ================= S0 环境闸门 =================
  await scenario({}, async (page) => {
    const r = await page.evaluate(() => {
      const b = document.getElementById('more-avatar');
      return {
        btnTxt: b ? b.textContent.trim() : null,
        btnTitle: b ? b.getAttribute('title') : null,
        card: !!document.getElementById('avlib-card'),
        kinds: !!document.getElementById('avlib-kind-avatar') && !!document.getElementById('avlib-kind-name'),
        paneC: !!document.getElementById('avlib-pane-c'), paneD: !!document.getElementById('avlib-pane-d'),
        lock: !!document.getElementById('applock-mask') && !document.getElementById('applock-mask').hidden,
      };
    });
    check('S0.1 更多功能按钮文案＝头像和昵称互动', r.btnTxt === '头像和昵称互动', r.btnTxt);
    check('S0.2 按钮 title＝头像和昵称互动', r.btnTitle === '头像和昵称互动', r.btnTitle);
    check('S0.3 半框 + 大类切换 + 昵称两个 pane 锚点齐备', r.card && r.kinds && r.paneC && r.paneD, JSON.stringify(r));
    check('S0.4 无未越过的应用锁遮罩（手势不被吃）', !r.lock, 'lock=' + r.lock);
  });

  // ================= A 两级切换 =================
  await scenario({}, async (page) => {
    const o = await openLib(page);
    check('A0 点更多功能→头像和昵称互动：半框打开', o === 'ok', o);
    let s = await paneState(page);
    check('A1 默认「头像」大类，只露 pane-a', s.kindAvatar && s.paneA && !s.paneB && !s.paneC && !s.paneD, JSON.stringify([s.paneA, s.paneB, s.paneC, s.paneD]));
    check('A1b 标题含「头像和昵称互动」', String(s.title).indexOf('头像和昵称互动') >= 0, s.title);
    check('A1c 头像大类页签＝「TA 的头像库」', String(s.tabATxt).indexOf('头像库') >= 0, s.tabATxt);

    await page.click('#avlib-kind-name'); await sleep(120);
    s = await paneState(page);
    check('A2 切「昵称」：只露 pane-c', s.kindName && s.paneC && !s.paneA && !s.paneB && !s.paneD, JSON.stringify([s.paneA, s.paneB, s.paneC, s.paneD]));
    check('A3 页签文案跟随大类＝「TA 的昵称库」/「我的昵称库」',
      String(s.tabATxt).indexOf('昵称库') >= 0 && String(s.tabBTxt).indexOf('昵称库') >= 0, s.tabATxt + ' / ' + s.tabBTxt);

    await page.click('#avlib-tab-b'); await sleep(120);
    s = await paneState(page);
    check('A4 切「我的」页签：只露 pane-d', s.tabB && s.paneD && !s.paneC && !s.paneA && !s.paneB, JSON.stringify([s.paneA, s.paneB, s.paneC, s.paneD]));

    await page.click('#avlib-kind-avatar'); await sleep(120);
    s = await paneState(page);
    check('A5 切回「头像」大类：只露 pane-b（两个大类互不串台）', s.kindAvatar && s.tabB && s.paneB && !s.paneA && !s.paneC && !s.paneD, JSON.stringify([s.paneA, s.paneB, s.paneC, s.paneD]));

    await page.click('#avlib-tab-a'); await sleep(120);
    s = await paneState(page);
    check('A6 回「TA + 头像」：只露 pane-a', s.paneA && !s.paneB && !s.paneC && !s.paneD, JSON.stringify([s.paneA, s.paneB, s.paneC, s.paneD]));

    // 关掉再打开：两个大类状态保持，且默认仍是头像大类
    await page.click('#avlib-close'); await sleep(100);
    await openLib(page); await sleep(150);
    s = await paneState(page);
    check('A7 关闭再打开：半框仍在且只露一个 pane', s.paneA + s.paneB + s.paneC + s.paneD === 1, JSON.stringify([s.paneA, s.paneB, s.paneC, s.paneD]));
  });

  // ================= B 昵称池增删清 =================
  await scenario({}, async (page) => {
    await openLib(page);
    await page.click('#avlib-kind-name'); await sleep(120);
    let s = await paneState(page);
    check('B0 空池时显示空态文案', s.cells === 0 && s.nickEmpty, 'cells=' + s.cells + '/empty=' + s.nickEmpty);

    // B1 弹窗形态：必须是**多行批量**框（用户反馈「添加昵称不能批量添加，一行一个」）——
    // 单行 input 隐藏、textarea 显示，且占位/说明写明「一行一个」
    const shape = await addNick(page, 'avlib-nick-add', '小满');
    let n = await nick(page);
    s = await paneState(page);
    check('B1a 添加弹窗是多行框（单行输入已隐藏）', shape.textareaShown && shape.inputHidden && shape.rows >= 3,
      JSON.stringify(shape));
    check('B1b 框内占位/说明写明「一行一个」可批量',
      String(shape.ph).indexOf('一行一个') >= 0 && String(shape.staticTxt).indexOf('一行一个') >= 0,
      shape.ph + ' || ' + shape.staticTxt);
    check('B1c 单条添加「小满」入池（计数/胶囊/空态同步）',
      n.lib.length === 1 && n.lib[0] === '小满' && s.cells === 1 && !s.nickEmpty && s.countA === '1',
      JSON.stringify({ lib: n.lib, cells: s.cells, empty: s.nickEmpty, cnt: s.countA }));

    await addNick(page, 'avlib-nick-add', '小满');
    n = await nick(page);
    check('B2 同名查重：不重复入池', n.lib.length === 1, JSON.stringify(n.lib));

    // B3 批量：一次贴 6 行（1 空行 + 1 重复行 + 1 个首尾带空格的），应只新增 3 条
    await addNick(page, 'avlib-nick-add', '阿澈\n\n  深夜的雾  \r\n小满\n阿澈\n南风');
    n = await nick(page);
    s = await paneState(page);
    check('B3a 批量添加：混着空行/重复行/首尾空格，新增 3 条且去重去空行',
      JSON.stringify(n.lib) === JSON.stringify(['小满', '阿澈', '深夜的雾', '南风']),
      JSON.stringify(n.lib));
    check('B3b 计数与胶囊数同步＝4', s.cells === 4 && s.countA === '4', 'cells=' + s.cells + '/cnt=' + s.countA);
    const bt = await toastTxt(page);
    check('B3c 批量提示如实报数（3 个新增 + 2 个已存在）', /已添加\s*3\s*个昵称/.test(bt) && /2\s*个已存在/.test(bt), bt);

    // B3d 全是重复：一条都不加，且给出「都已经在池子里」的提示（不静默无反应）
    await addNick(page, 'avlib-nick-add', '小满\n南风');
    n = await nick(page);
    const bt2 = await toastTxt(page);
    check('B3d 全部已存在时不重复入池且明确提示', n.lib.length === 4 && /已经在池子里/.test(bt2), n.lib.length + ' | ' + bt2);

    // B3e 超长行按 30 字截断（与聊天设置改昵称的单条上限同口径），不整行丢弃
    const long40 = '长'.repeat(40);
    await addNick(page, 'avlib-nick-add', long40);
    n = await nick(page);
    check('B3e 超长昵称按 30 字截断保留（不无声丢弃）',
      n.lib.length === 5 && n.lib[4].length === 30 && n.lib[4] === '长'.repeat(30),
      'len=' + (n.lib[4] || '').length);

    // 删除「阿澈」（第 2 个胶囊的 ✕）
    await page.evaluate(() => {
      const cells = document.querySelectorAll('#avlib-nick-list .avlib-name-cell');
      cells[1].querySelector('.avlib-name-del').click();
    });
    await sleep(150);
    n = await nick(page);
    s = await paneState(page);
    check('B4 点 ✕ 删除单条「阿澈」：剩 4 条且不含阿澈',
      n.lib.length === 4 && n.lib.indexOf('阿澈') < 0 && s.cells === 4, JSON.stringify([n.lib, s.cells]));

    // 清空
    await page.click('#avlib-nick-clear');
    await page.waitForSelector('#modal-mask:not([hidden])', { timeout: 5000 });
    await page.click('#modal-ok');
    await page.waitForFunction(() => { const m = document.getElementById('modal-mask'); return !m || m.hidden; }, null, { timeout: 5000 });
    await sleep(150);
    n = await nick(page);
    s = await paneState(page);
    check('B5 清空昵称池：池空 + 空态回来', n.lib.length === 0 && s.cells === 0 && s.nickEmpty, JSON.stringify([n.lib, s.cells, s.nickEmpty]));
  });

  // 注意：以下场景都要把随机计时钉死在「未到期」上（last=现在 / next=8 小时）——
  // 昵称池非空 + last=0/next=0 会在**模块加载时**立即触发一次随机更换（与头像池同机制），
  // 那样 cs-lbl-partner 在点选前就已经变成池里某条，随后的点击成了同值写入（不触发改写钩子），
  // 断言会「因为错误的理由侥幸通过」。E 组才是故意留零计时测「到期即换」的场景。
  // 四个计时键无条件打底，调用方传的种子覆盖同键（这样无论场景种子写不写都能钉住）
  const pinTimer = (o) => Object.assign({
    'nick-lib-last': String(Date.now()), 'nick-lib-next': '8',
    'nick-me-lib-last': String(Date.now()), 'nick-me-lib-next': '8',
  }, o);

  // ================= C TA 昵称池点选（三条概率分支） =================
  await scenario(pinTimer({ 'nick-lib': JSON.stringify(['小满', '阿澈']) }), async (page) => {
    await openLib(page);
    await page.click('#avlib-kind-name'); await sleep(150);

    // C1 直接切换：第 2 个随机数 >= 0.5（inviteHit=false）
    await clickNickWith(page, '#avlib-nick-list', 0, [0.5, 0.9, 0.5]);
    await sleep(300);
    let n = await nick(page);
    let s = await paneState(page);
    check('C1.1 直接切换：cs-lbl-partner＝「小满」', n.partner === '小满', String(n.partner));
    check('C1.2 聊天顶栏跟随＝「小满」', n.header === '小满', String(n.header));
    // 用户反馈（2026-09-16）：「联系人更换了昵称的系统消息没有显示联系人更换了什么昵称」
    // ——文案必须写明「谁把谁的昵称换成了什么」，不能只写「XX 更换了昵称」
    check('C1.3 系统消息写明换成了什么昵称（含「换成了「小满」」）',
      n.msgs.some(t => t.indexOf('换成了「小满」') >= 0), n.msgs.filter(t => /昵称/.test(t)).slice(-2).join(' | '));
    check('C1.3b 系统消息写明是「我把 TA 的昵称」换的（不只是「更换了昵称」）',
      n.msgs.some(t => /我把\s*\S*\s*的聊天昵称换成了/.test(t)), n.msgs.filter(t => /昵称/.test(t)).slice(-2).join(' | '));
    const kept = await page.evaluate(() => (window.getChatMsgs() || []).filter(m => m && m.nickKeep === true).length);
    check('C1.3c 消息带 nickKeep 标记（豁免后续改名清扫）', kept >= 1, 'nickKeep 条数=' + kept);
    // 渲染面：nickKeep 消息原样呈现。若走常规 pokePersonMap，「我把 TA 的昵称换成了「小满」」
    // 会被回填成「我把 小满 的昵称换成了「小满」」＝自己说自己，用户读不出发生了什么。
    const cBody = await page.evaluate(() => String((document.getElementById('chat-body') || {}).textContent || ''));
    check('C1.3d 聊天窗里这条原样呈现（泛指 TA 未被回填成新昵称，不出现「小满…「小满」」的自指句）',
      cBody.indexOf('我把 TA 的聊天昵称换成了「小满」') >= 0 && cBody.indexOf('我把 小满 的聊天昵称换成了「小满」') < 0,
      cBody.replace(/\s+/g, ' ').slice(-120));
    check('C1.4 当前生效那条高亮（.avlib-now 恰一条）', s.nowCells === 1, 'now=' + s.nowCells);
    check('C1.5 换昵称不动头像（cs-avatar-partner 未被写）', !n.avatarPartner, String(n.avatarPartner));

    // C2 同意：inviteHit=true(0.1<50)、agreeHit=true(0.5<70)
    await clickNickWith(page, '#avlib-nick-list', 1, [0.5, 0.1, 0.5]);
    await sleep(300);
    n = await nick(page);
    check('C2.1 同意分支：昵称真的换成「阿澈」', n.partner === '阿澈', String(n.partner));
    check('C2.2 系统消息含「同意了…换昵称邀请」',
      n.msgs.some(t => /同意了.*的换昵称邀请/.test(t)), n.msgs.filter(t => /邀请/.test(t)).slice(-2).join(' | '));

    // C3 拒绝：inviteHit=true、agreeHit=false(0.9>=70)
    const before = n.partner;
    await clickNickWith(page, '#avlib-nick-list', 0, [0.5, 0.1, 0.9]);
    await sleep(300);
    n = await nick(page);
    check('C3.1 拒绝分支：昵称保持原值（不写回池里那条）', n.partner === before, String(n.partner) + ' / before=' + before);
    check('C3.2 系统消息含「拒绝了…换昵称邀请」',
      n.msgs.some(t => /拒绝了.*的换昵称邀请/.test(t)), n.msgs.filter(t => /邀请/.test(t)).slice(-2).join(' | '));

    // C4 手动换后重置计时（1-8 小时后才可能再随机换）
    const last = Number(n.last || 0);
    check('C4 手动点选后重置随机计时（nick-lib-last 已推进）', last > Date.now() - 60000, 'delta=' + (Date.now() - last) + 'ms');
  });

  // ================= D 我的昵称池点选 =================
  await scenario(pinTimer({ 'nick-me-lib': JSON.stringify(['小满', '阿澈']) }), async (page) => {
    await openLib(page);
    await page.click('#avlib-kind-name'); await sleep(120);
    await page.click('#avlib-tab-b'); await sleep(120);
    let s = await paneState(page);
    check('D0 我的昵称池胶囊已渲染', s.meCells === 2, 'meCells=' + s.meCells);

    await clickNickWith(page, '#avlib-me-nick-list', 1, []);
    await sleep(300);
    let n = await nick(page);
    s = await paneState(page);
    check('D1 cs-lbl-user＝「阿澈」', n.user === '阿澈', String(n.user));
    // 用户报的「顶栏没变化」多半出在这条路：「我的昵称库」改的是**我**的昵称，顶栏显示的是
    // **联系人**的名字、本来就不该变。旧文案「阿澈 更换了昵称」主语是换后的我的昵称，读起来
    // 像「联系人改名了」→ 必须写明「我把自己…」才不会让人以为顶栏坏了。
    check('D2 系统消息写明「我把自己的昵称换成了「阿澈」」（不会被误读成联系人改名）',
      n.msgs.some(t => t.indexOf('我把自己的聊天昵称换成了「阿澈」') >= 0),
      n.msgs.filter(t => /昵称/.test(t)).slice(-2).join(' | '));
    check('D3 我的昵称那条高亮', s.meNow === 1, 'meNow=' + s.meNow);
    check('D4 换我的昵称不影响 TA 的昵称键；顶栏显示联系人名字、本就不该变',
      !n.partner && n.header !== '阿澈', 'partner=' + n.partner + '/header=' + n.header);
  });

  // ================= E 定时随机更换（加载即到期路径） =================
  await scenario({
    'nick-lib': JSON.stringify(['小满', '阿澈']), 'nick-lib-enabled': '1',
    'nick-lib-last': '0', 'nick-lib-next': '0',
  }, async (page) => {
    await page.evaluate(() => { window.enterChat(); });
    await sleep(400);
    const n = await nick(page);
    check('E1.1 到期即随机换：cs-lbl-partner 落在池里', ['小满', '阿澈'].indexOf(n.partner) >= 0, String(n.partner));
    check('E1.2 换完推进计时（nick-lib-last > 0）', Number(n.last || 0) > 0, 'last=' + n.last);
    // 「联系人自己换昵称」这条是用户唯一能看见 TA 改名的地方：顶栏必须跟着变，
    // 系统消息必须写明换成了什么（旧文案「小满 更换了昵称」看不出「换成了」）
    check('E1.3 聊天顶栏已跟到新昵称', n.header === n.partner, 'header=' + n.header + '/partner=' + n.partner);
    check('E1.4 系统消息写明「TA 把聊天昵称换成了「XXX」」',
      n.msgs.some(t => t.indexOf('TA 把聊天昵称换成了「' + n.partner + '」') >= 0),
      n.msgs.filter(t => /昵称/.test(t)).slice(-2).join(' | '));
  });

  await scenario({
    'nick-lib': JSON.stringify(['小满', '阿澈']), 'nick-lib-enabled': '0',
    'nick-lib-last': '0', 'nick-lib-next': '0',
  }, async (page) => {
    const n = await nick(page);
    check('E2 开关关闭时到期也不换（cs-lbl-partner 保持未设）', !n.partner, String(n.partner));
  });

  // ============ E4 昵称事件消息不被后续改名改写（nickKeep 豁免）============
  // 关键正确性：池里换两次名后，第一条记录必须仍写「换成了「小满」」。
  // 没有 nickKeep 豁免时，第二次改名会把 '小满' 清扫成 {ta}，第一条记录被改写成
  // 「换成了「阿澈」」——两条记录一模一样，用户就永远看不出哪次换成了什么。
  await scenario(pinTimer({ 'nick-lib': JSON.stringify(['小满', '阿澈']) }), async (page) => {
    await page.evaluate(() => { window.enterChat(); });
    await waitChatReady(page);
    await openLib(page);
    await page.click('#avlib-kind-name'); await sleep(150);
    await clickNickWith(page, '#avlib-nick-list', 0, [0.5, 0.9, 0.5]); // → 小满
    await sleep(300);
    await clickNickWith(page, '#avlib-nick-list', 1, [0.5, 0.9, 0.5]); // → 阿澈（触发对 '小满' 的清扫）
    await sleep(400);
    const n = await nick(page);
    const nickMsgs = n.msgs.filter(t => t.indexOf('聊天昵称换成了') >= 0);
    check('E4.1 两次换名各留一条记录', nickMsgs.length >= 2, JSON.stringify(nickMsgs));
    check('E4.2 第一条记录仍如实写着换成了「小满」（未被第二次改名改写成阿澈）',
      nickMsgs.some(t => t.indexOf('换成了「小满」') >= 0), JSON.stringify(nickMsgs));
    check('E4.3 第二条记录写的是换成了「阿澈」',
      nickMsgs.some(t => t.indexOf('换成了「阿澈」') >= 0), JSON.stringify(nickMsgs));
    check('E4.4 当前昵称仍是「阿澈」（清扫照常作用于别的消息，只是不动昵称事件记录）',
      n.partner === '阿澈' && n.header === '阿澈', n.partner + '/' + n.header);
  });

  // E3 护栏：头像池仍是同一套「到期即换」机制（本次改动不得改坏头像侧）
  await scenario({
    'avatar-lib': JSON.stringify(['data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#ff2255"/></svg>')]),
    'avatar-lib-enabled': '1', 'avatar-lib-last': '0', 'avatar-lib-next': '0',
  }, async (page) => {
    const r = await page.evaluate(() => String(window.activeStore().get('cs-avatar-partner') || ''));
    check('E3 头像侧回归护栏：头像池到期仍会自动换上（未被昵称改动带坏）', r.indexOf('data:image/') === 0, r.slice(0, 40));
  });

  // ================= F 改名钩子：历史系统消息跟随新昵称 =================
  await scenario(pinTimer({ 'nick-lib': JSON.stringify(['小满']) }), async (page) => {
    // 先造一条含「TA」（当前生效昵称默认值）的系统消息，再换昵称
    const setup = await page.evaluate(() => {
      window.enterChat();
      window.chatAddSystem('我 更换了 TA 的头像');
      return (window.getChatMsgs() || []).length;
    });
    check('F0 预置系统消息已落（含旧昵称 TA）', setup > 0, 'msgs=' + setup);
    const ready = await waitChatReady(page); // 清扫要 chatDbReady 才落地
    check('F0b 聊天记录已就绪（改名清扫的前提）', ready, 'chatDbReady=' + ready);

    await openLib(page);
    await page.click('#avlib-kind-name'); await sleep(150);
    await clickNickWith(page, '#avlib-nick-list', 0, [0.5, 0.9, 0.5]);
    await sleep(400);
    const n = await nick(page);
    check('F1 改名后旧昵称已进改名历史（sysmsg-nick-hist 含 TA）', n.hist.indexOf('TA') >= 0, JSON.stringify(n.hist));
    check('F2 历史系统消息里的旧昵称被清扫成 {ta} 占位符（渲染时替换成当前昵称）',
      n.msgs.some(t => t.indexOf('{ta}') >= 0 && t.indexOf('更换了') >= 0),
      n.msgs.filter(t => /更换了/.test(t)).slice(-2).join(' | '));
    // F3 用户实际看到的：聊天窗里那条旧消息已经改口叫新昵称（清scape 的落地效果）
    const body = await page.evaluate(() => String((document.getElementById('chat-body') || {}).textContent || ''));
    check('F3 聊天窗里旧消息已改口成新昵称（用户可见面）',
      /更换了\s*小满\s*的头像/.test(body) && body.indexOf('更换了 TA 的头像') < 0,
      body.replace(/\s+/g, ' ').slice(-160));
  });

  // ================= G 与头像彻底解耦 =================
  await scenario(pinTimer({ 'nick-lib': JSON.stringify(['小满', '阿澈']) }), async (page) => {
    await page.evaluate(() => { window.activeStore().set('cs-avatar-partner', 'AV_KEEP'); });
    await openLib(page);
    await page.click('#avlib-kind-name'); await sleep(150);
    await clickNickWith(page, '#avlib-nick-list', 1, [0.5, 0.9, 0.5]);
    await sleep(250);
    const n = await nick(page);
    check('G1 换昵称不动聊天头像键 cs-avatar-partner', n.avatarPartner === 'AV_KEEP', String(n.avatarPartner));
    check('G2 昵称确实换了（对照组：点第 2 条＝阿澈）', n.partner === '阿澈', String(n.partner));
  });

  // ============ H 昵称清洗：零宽字符不能再变成「空昵称」 ============
  // 用户报障（2026-09-16）：消息渲染成「我的昵称换成了「」」——引号里是空的。
  // 根因：U+200B 零宽空格等既不是 JS WhiteSpace 也不可见，`'\u200B'.trim()` 原样保留，
  // 于是「看着是空的名字」进了池子。H 组从三个面堵：入库前剥掉、脏数据读时净化、空名不发邀请。
  const ZW = '\u200B\u200B';            // 纯零宽字符（渲染出来什么都没有）
  const ZWNAME = '\u200B夏夏\u200D';    // 带零宽包裹的正常名字
  await scenario({}, async (page) => {
    await openLib(page);
    await page.click('#avlib-kind-name'); await sleep(120);
    // H1 纯零宽行被跳过并如实提示（不让用户看着粘了东西却什么都没进）
    await addNick(page, 'avlib-nick-add', ZW + '\n夏夏\n   \n' + ZWNAME);
    const n = await nick(page);
    // 四行：纯零宽 / 夏夏 / 纯空格 / 零宽包裹的夏夏 → 剥壳后 = ['夏夏','夏夏'] → 去重后只留一条
    check('H1.1 纯零宽行与纯空行都不入池；带零宽包裹的正常名剥壳后与已有条去重',
      JSON.stringify(n.lib) === JSON.stringify(['夏夏']), JSON.stringify(n.lib));
    check('H1.2 没有任何「看着是空」的条目（长度>0）', n.lib.every(x => x.length > 0), JSON.stringify(n.lib));
    const t1 = await toastTxt(page);
    check('H1.3 提示如实报出「跳过 N 个空行」（不让用户粘了东西却查无此条）', /跳过\s*2\s*个空行/.test(t1), t1);
    // H2 池里不含零宽字符（写进 cs-lbl-* 之前就剥干净了）
    check('H2 入库值不含零宽/方向控制字符', n.lib.every(x => !/[\u200B-\u200F\u202A-\u202E\uFEFF]/.test(x)), JSON.stringify(n.lib));
  });

  // H3 脏数据（历史遗留的纯零宽条目）读时净化：不再出现点不到的空白胶囊
  await scenario({
    'nick-me-lib': JSON.stringify([ZW, '夏夏']),
    'nick-me-lib-last': String(Date.now()), 'nick-me-lib-next': '8',
  }, async (page) => {
    await openLib(page);
    await page.click('#avlib-kind-name'); await sleep(120);
    await page.click('#avlib-tab-b'); await sleep(150);
    const s = await paneState(page);
    check('H3 脏池里的纯零宽条目读时被净化（只留 1 条、且是能读出来的名字）',
      s.meCells === 1 && s.meNames.length === 1 && s.meNames[0] === '夏夏',
      'meCells=' + s.meCells + '/meNames=' + JSON.stringify(s.meNames));
  });

  // ============ I 换昵称邀请：昵称必须写出、且不再弹黑色小字 ============
  // 用户要求（2026-09-16）：「我同意了 TA 的换昵称邀请，我的昵称换成了「」」这个消息不用发送黑色的提示弹窗。
  // 用 Math.random 全局钉死（0.1）让加载期的 checkMeNickRefresh 走「选池里第 0 条 + 邀请分支」，
  // 这是唯一能确定性触发该弹窗的入口（showMeNickInvite 未导出）。
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => {
      try {
        localStorage.setItem('xy-home-v2:applock-qaskip', '1');
        const kill = [];
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf('xy-home-v2:') === 0) kill.push(k); }
        kill.forEach(k => localStorage.removeItem(k));
        localStorage.setItem('xy-home-v2:applock-qaskip', '1');
        localStorage.setItem('xy-home-v2:default:nick-me-lib', JSON.stringify(['夏夏']));
        localStorage.setItem('xy-home-v2:default:nick-me-lib-last', '0');
        localStorage.setItem('xy-home-v2:default:nick-me-lib-next', '0');
        // 0.1：池下标 floor(0.1*1)=0 → '夏夏'；invite = 10 < 50 → 走邀请分支
        Math.random = function () { return 0.1; };
      } catch (e) {}
    });
    await page.goto(baseUrl + (tmpPage ? '/tmp-616-nick.html' : '/index.html'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mochiDataReady === true, null, { timeout: 30000 }).catch(() => {});
    await sleep(900);
    const shown = await page.evaluate(() => {
      const m = document.getElementById('modal-mask');
      return {
        mask: !!(m && !m.hidden),
        title: (document.getElementById('modal-title') || {}).textContent || '',
        staticTxt: (document.getElementById('modal-static') || {}).textContent || '',
      };
    });
    check('I0 邀请弹窗弹出且写出要换成的昵称', shown.mask && shown.title.indexOf('换昵称邀请') >= 0 && shown.staticTxt.indexOf('夏夏') >= 0,
      JSON.stringify(shown));
    await page.evaluate(() => {
      const t = document.getElementById('cc-toast'); if (t) t.className = 'cc-toast'; // 清掉开屏期间的旧 toast 状态
      const pills = document.querySelectorAll('#modal-pills .pill');
      if (pills[0]) pills[0].click();
      document.getElementById('modal-ok').click();
    });
    await sleep(400);
    const after = await page.evaluate(() => {
      const t = document.getElementById('cc-toast');
      return {
        user: window.activeStore().get('cs-lbl-user'),
        msgs: (window.getChatMsgs() || []).map(m => String(m.text)).filter(x => /昵称/.test(x)),
        toastShown: !!(t && /(^|\s)show(\s|$)/.test(t.className)),
        toastText: t ? t.textContent : '',
      };
    });
    check('I1 同意后我的昵称＝夏夏', after.user === '夏夏', String(after.user));
    check('I2 系统消息写出换成了什么（引号内不为空）',
      after.msgs.some(x => x.indexOf('我同意了 TA 的换昵称邀请，我的昵称换成了「夏夏」') >= 0), JSON.stringify(after.msgs));
    check('I3 不出现空引号「」（用户报障的形态）',
      !after.msgs.some(x => x.indexOf('「」') >= 0), JSON.stringify(after.msgs));
    check('I4 这条不再弹黑色小字提示', !after.toastShown, 'toastShown=' + after.toastShown + ' | ' + after.toastText);
    await ctx.close();
  }

  // ===== J 其他功能跟桌面昵称 + 昵称互动小字说明（#616 用户要求）=====
  // 用户原话：「关于聊天昵称，因为变更多，只需要更换聊天里的昵称；其他功能里的昵称跟随
  // 设置里的桌面联系人昵称就行（并且昵称互动里需要小字说明）」。
  // 口径：桌面昵称优先、聊天昵称兜底，所以这里同时钉住两侧——其他功能必须跟「桌面甲」，
  // 聊天顶栏必须仍跟「聊天乙」（聊天没被反向带跑）。
  await scenario(pinTimer({
    'lbl-partner': '桌面甲', 'cs-lbl-partner': '聊天乙',
    'nick-lib': JSON.stringify(['池子丙']),
  }), async (page) => {
    // J1 小字说明在两个昵称池都在、且写明「其他功能跟桌面昵称」
    await openLib(page);
    await page.click('#avlib-kind-name'); await sleep(150);
    const noteA = await page.evaluate(() => {
      const pane = document.getElementById('avlib-pane-c');
      const el = pane && pane.querySelector('.avlib-note');
      return el ? el.textContent : '';
    });
    await page.click('#avlib-tab-b'); await sleep(150);
    const noteB = await page.evaluate(() => {
      const pane = document.getElementById('avlib-pane-d');
      const el = pane && pane.querySelector('.avlib-note');
      return el ? el.textContent : '';
    });
    const noteOk = (s) => s.indexOf('聊天里') >= 0 && s.indexOf('其他功能') >= 0 && s.indexOf('桌面昵称') >= 0;
    check('J1.1 TA 的昵称库有小字说明（说明只改聊天、其他功能跟桌面昵称）', noteOk(noteA), noteA);
    check('J1.2 我的昵称库有小字说明（同口径）', noteOk(noteB), noteB);
    check('J1.3 说明写明了去哪儿改桌面昵称',
      noteA.indexOf('设置') >= 0 && noteA.indexOf('桌面') >= 0, noteA);
    await page.click('#avlib-close'); await sleep(120);

    // J2 聊天顶栏仍走聊天昵称（不能因为「其他功能改桌面」把聊天也带跑）
    const header = await page.evaluate(() => (document.getElementById('chat-partner-name') || {}).textContent);
    check('J2 聊天顶栏仍显示聊天昵称「聊天乙」（聊天页未被反向改写）', header === '聊天乙', String(header));

    // J3 此间（其他功能）：自动播种的梦角名跟桌面昵称，不跟聊天昵称。
    // 必须**打开两次**：openCjian 里是 healBelonging()（漂移对齐）→ seedIfEmpty()（播种）的
    // 顺序，首次打开时花名册还空着、对齐无卡可纠，只走播种；第二次打开的对齐才会把名字
    // 纠成「本尊有效昵称」——那一步才是 effNick 的落点，只开一次测不到它。
    const cjNames = await page.evaluate(async () => {
      if (!window.openCjian) return ['(no-openCjian)'];
      const read = () => Array.prototype.map.call(document.querySelectorAll('#cj-list .cj-card-name'), e => e.textContent);
      window.openCjian();
      await new Promise(r => setTimeout(r, 350));
      window.openCjian(); // 第二次：触发本尊名字漂移对齐（effNick 的落点）
      await new Promise(r => setTimeout(r, 350));
      return read();
    });
    check('J3 此间梦角名跟桌面昵称「桌面甲」（播种 + 漂移对齐两步都不跟聊天昵称）',
      cjNames.indexOf('桌面甲') >= 0 && cjNames.indexOf('聊天乙') < 0, JSON.stringify(cjNames));

    // J4 小游戏（Pong 面板）：伙伴名跟桌面昵称
    await page.evaluate(() => { document.querySelectorAll('.page').forEach(p => { p.hidden = true; }); document.getElementById('page-chat').hidden = false; });
    const pongName = await page.evaluate(() => {
      if (!window.openPongPanel) return '(no-openPongPanel)';
      window.openPongPanel();
      return (document.getElementById('pong-partner-name') || {}).textContent || '';
    });
    await sleep(200);
    const pongName2 = await page.evaluate(() => (document.getElementById('pong-partner-name') || {}).textContent || '');
    check('J4 Pong 面板伙伴名跟桌面昵称「桌面甲」', (pongName2 || pongName) === '桌面甲', String(pongName2 || pongName));
  });

  check('Z1 全程无未捕获 JS 错误', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  if (browser) await browser.close();
  server.close();
  if (tmpPage) { try { (await import('node:fs')).unlinkSync(tmpPage); } catch (e) {} }
}

const pass = results.filter(r => r.ok).length;
const fail = results.length - pass;
console.log('\n合计 ' + pass + '/' + results.length + (fail ? '（失败 ' + fail + '）' : ''));
process.exit(fail ? 1 : 0);
