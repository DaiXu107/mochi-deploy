// ===== 回归验证：#775 改了「我 / 联系人」的昵称，聊天里已发出的拍一拍仍是旧名 =====
// 用户原话（2026-09-18）：「当联系人给我和联系人换了昵称，但是聊天消息里的拍一拍的昵称还是
//   没有变化……这个问题其他设备型号也有出现。有的手机没有，有的手机有。」
//
// 为什么「有的手机有、有的手机没有」——与机型/内核无关，取决于三件设备侧状态：
//   ① 该设备设过 cs-lbl-partner 没有（没设过 → 顶栏回退联系人名片名、拍一拍回退字面「TA」，
//      两条链分叉＝看着像「改名没生效」）；
//   ② 历史里的系统消息是「字面旧名」还是「{ta}/{me} 占位符」（新装干净、老装留字面名）；
//   ③ 改名后聊天窗有没有真的被重画（刷新/重进＝整窗重建会好；从聊天设置点返回按钮、
//      或同窗原地补丁命中＝停在旧名，直到下次刷新）。
// 三处都不带机型分支，本脚本按这三条分别断言（红基线跑 HEAD 副本、绿基线跑工作区）。
//
// 断言分组：
//   A 取名链一份：未设聊天昵称时顶栏与拍一拍都回退「联系人名片名」（#775/#775a/#775g）
//   B 聊天设置改「联系人昵称」→ 历史字面旧名清扫 + 点返回按钮后屏上立刻是新名（#775d/#775b）
//   C 聊天设置改「我的昵称」→ {me} 侧同样跟随（#775c；旧实现在这里只写键、不扫历史）
//   D 昵称池换「我的昵称」→ 与聊天设置同一条钩子（#775c3）
//   E 联系人管理改名（renameContact）→ 顶栏 + 屏上拍一拍都跟随（#775f）
//   F 数据面：清扫只作用于可清扫类型，普通气泡正文永不改（防过度清扫）
//
// 用法：node tools/verify-poke-nick.mjs            # 打构建产物 index.html
//       node tools/verify-poke-nick.mjs --tmp      # 从 src 临时拼装（免构建，不写产物）
//       红基线（改前必红的对照）：在主仓执行，把页面指向仓外 HEAD 副本——
//         mkdir -p ../mochi-775-red && git archive HEAD | tar -x -C ../mochi-775-red
//         VERIFY_ROOT=../mochi-775-red node tools/verify-poke-nick.mjs --tmp
//       （严禁在仓库内建 git worktree：Windows 下清理会打回主树未提交改动）
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync, unlinkSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// root 可由 VERIFY_ROOT 指到仓外副本（跑 HEAD 红基线用；脚本本身仍在主仓执行＝playwright 只装一处）
const root = normalize(process.env.VERIFY_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
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
  tmpPage = join(root, 'tmp-775-poke-nick.html');
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
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + String(detail).slice(0, 240) + ']' : ''));
}

const { chromium } = await import('playwright');
let browser = null;
try {
  const fs = await import('node:fs');
  const exe = ['C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p));
  browser = exe ? await chromium.launch({ executablePath: exe, headless: true }) : await chromium.launch();

  const errors = [];
  // seed: { root: {k:v}, cid: {k:v}, msgs: [rec...] }；每颗独立 context（LS/IDB 随 context 隔离）
  async function scenario(seed, fn) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript((seed) => {
      try {
        const kill = [];
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf('xy-home-v2:') === 0) kill.push(k); }
        kill.forEach(k => localStorage.removeItem(k));
        localStorage.setItem('xy-home-v2:applock-qaskip', '1');
        Object.keys(seed.root || {}).forEach(k => localStorage.setItem('xy-home-v2:' + k, seed.root[k]));
        Object.keys(seed.cid || {}).forEach(k => localStorage.setItem('xy-home-v2:default:' + k, seed.cid[k]));
        if (seed.msgs) localStorage.setItem('xy-home-v2:default:chat-msgs', JSON.stringify(seed.msgs));
      } catch (e) {}
      // 浮层清扫器（仅测试环境）：ta-ask 会按随机时钟弹「TA 询问」#qa-mask，实测会抢走
      // 点击命中点与输入框聚焦＝假红。modal-mask 不扫（改昵称弹窗正是被测对象）。
      const ids = ['qa-mask', 'tc-mask', 'call-mask', 'applock-mask', 'img-view-mask'];
      const sweep = () => { for (let i = 0; i < ids.length; i++) { const e = document.getElementById(ids[i]); if (e && !e.hidden) e.hidden = true; } };
      setInterval(sweep, 300);
      document.addEventListener('DOMContentLoaded', sweep);
    }, seed);
    await page.goto(baseUrl + (tmpPage ? '/tmp-775-poke-nick.html' : '/index.html'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mochiDataReady === true, null, { timeout: 30000 }).catch(() => {});
    await sleep(400);
    await dismissSplash(page);
    try { await fn(page); } catch (e) { check('（场景异常）' + String(e && e.message || e).slice(0, 140), false); }
    await ctx.close();
  }

  // 开屏必读/公告浮层（z999）没真正收起时，所有点击都会被它吃掉（全书假阴性）——
  // 必须滚到底＋勾年龄＋逐级点「进入」，直到 #splash 收起（同 verify-chat-bg-pos 的 boot 段）
  const dismissSplash = async (page) => {
    for (let i = 0; i < 12; i++) {
      const st = await page.evaluate(() => {
        const s = document.getElementById('splash');
        if (!s || s.classList.contains('hide') || s.hidden) return 'gone';
        const m = document.getElementById('splash-mandatory');
        if (m && !m.hidden) {
          const sc = document.getElementById('splash-mandatory-scroll'); if (sc) sc.scrollTop = sc.scrollHeight;
          const b0 = document.getElementById('splash-box'); if (b0) b0.scrollTop = b0.scrollHeight;
          const e = document.getElementById('splash-mandatory-enter');
          return 'mand:' + (e ? (e.classList.contains('is-disabled') ? 'wait' : 'ready') : 'noel');
        }
        const b = document.getElementById('splash-box'); if (b) b.scrollTop = b.scrollHeight;
        const c = document.getElementById('splash-age-check');
        if (c && !c.checked) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }
        const e2 = document.getElementById('splash-enter');
        return 'main:' + (e2 && e2.classList.contains('is-disabled') ? 'wait' : 'ready');
      });
      if (st === 'gone') break;
      if (st === 'main:ready') await page.evaluate(() => document.getElementById('splash-enter').click());
      else if (st === 'mand:ready') await page.evaluate(() => document.getElementById('splash-mandatory-enter').click());
      await sleep(250);
    }
    await page.evaluate(() => {
      const ids = ['qa-mask', 'tc-mask', 'call-mask', 'applock-mask', 'img-view-mask'];
      ids.forEach(id => { const e = document.getElementById(id); if (e) e.hidden = true; });
      return true;
    });
  };

  const probe = (page) => page.evaluate(() => {
    const s = window.activeStore();
    const jarr = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
    return {
      header: String((document.getElementById('chat-partner-name') || {}).textContent || ''),
      body: String((document.getElementById('chat-body') || {}).textContent || '').replace(/\s+/g, ' '),
      msgs: (window.getChatMsgs ? window.getChatMsgs() : []).map(m => String(m && m.text || '')),
      lp: s.get('cs-lbl-partner'), lu: s.get('cs-lbl-user'),
      hist: jarr(s.get('sysmsg-nick-hist')), uhist: jarr(s.get('sysmsg-user-nick-hist')),
      taName: window.chatPartnerName ? window.chatPartnerName() : '(no-chatPartnerName)',
      meName: window.chatUserName ? window.chatUserName() : '(no-chatUserName)',
    };
  });

  // 聊天窗里某条拍一拍的可见文本（按关键字取所在行）
  const lineOf = (body, key) => {
    const i = body.indexOf(key);
    return i < 0 ? '' : body.slice(Math.max(0, i - 30), i + 60);
  };

  // 进聊天页并等历史落屏（LS 种子经 loadMsgs → 权威/兜底两条路径都要等到条数齐）
  const enterAndWaitMsgs = async (page, n) => {
    await page.evaluate(() => { try { window.enterChat(); } catch (e) {} });
    for (let i = 0; i < 30; i++) {
      const got = await page.evaluate((want) => (window.getChatMsgs ? window.getChatMsgs().length : 0) >= want, n);
      if (got) return true;
      await sleep(400);
    }
    return false;
  };

  // 改名清扫要 chatDbReady 才落地（未就绪时钩子只记 hist 就返回）。用一个「屏上不存在」的
  // 探针名反复敲钩子，探测到 swept 键出现＝权威已就绪（与 verify-nick-interact 同法）。
  const waitChatReady = async (page) => {
    for (let i = 0; i < 40; i++) {
      const swept = await page.evaluate(() => {
        try { window.chatSysNickChanged('__ready-probe-' + Date.now()); } catch (e) {}
        return window.activeStore().get('sysmsg-nick-swept');
      });
      if (swept !== null && swept !== undefined) return true;
      await sleep(400);
    }
    return false;
  };

  // 走真实入口改昵称：聊天设置页对应行 → openModal → 填值 → 确定 → 返回聊天页（全程不刷新）
  const openChatSettings = (page) => page.evaluate(() => {
    const btn = document.getElementById('chat-settings-btn');
    if (btn) btn.click();
    const cs = document.getElementById('page-chat-settings');
    return !!(cs && !cs.hidden);
  });
  const renameViaSettings = async (page, rowId, val) => {
    const shown = await openChatSettings(page);
    await sleep(200);
    await page.evaluate((id) => { const r = document.getElementById(id); if (r) r.click(); }, rowId);
    await page.waitForSelector('#modal-mask:not([hidden])', { timeout: 8000 });
    // 安卓上 input 会被 mobile-adapt 换成 contenteditable，读写必须走产品口径（value + input 事件）
    await page.evaluate((v) => {
      const el = document.getElementById('modal-input');
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('modal-ok').click();
    }, val);
    await page.waitForFunction(() => { const m = document.getElementById('modal-mask'); return !m || m.hidden; }, null, { timeout: 8000 });
    await sleep(250);
    // 点返回按钮回聊天：这条路径只把 page-chat 的 hidden 翻回 false，不走 enterChat、不重渲
    const back = await page.evaluate(() => {
      const b = document.getElementById('cs-back'); if (b) b.click();
      const chat = document.getElementById('page-chat');
      return !!(chat && !chat.hidden);
    });
    await sleep(400);
    return { shown, back };
  };

  const poke = (text, extra) => Object.assign({ side: 'in', text, special: 'poke', ts: Date.now() - 60000 }, extra || {});

  // ============ A 取名链一份：未设聊天昵称 → 顶栏与拍一拍都跟联系人名片名 ============
  await scenario({
    root: { contacts: JSON.stringify([{ id: 'default', name: '小满' }]) },
    msgs: [poke('{ta} 拍了拍 {me} 的脑袋')],
  }, async (page) => {
    const n = await enterAndWaitMsgs(page, 1);
    check('A0 夹具：种子历史已落入聊天（占位符形态）', n, 'msgs=' + n);
    await waitChatReady(page);
    const r = await probe(page);
    check('A1 chatPartnerName() 未设聊天昵称时回退联系人名片名「小满」（不是字面 TA）',
      r.taName === '小满', 'taName=' + r.taName + ' / lp=' + String(r.lp));
    check('A2 聊天顶栏＝「小满」（与拍一拍同一条链）', r.header === '小满', 'header=' + r.header);
    check('A3 屏上拍一拍回填成「小满」，不再是「TA 拍了拍」',
      /小满\s*拍了拍/.test(r.body) && r.body.indexOf('TA 拍了拍') < 0, lineOf(r.body, '拍了拍') || r.body.slice(0, 120));
  });

  // ============ B 聊天设置改「联系人昵称」→ 历史字面旧名跟随（不刷新页面） ============
  await scenario({
    root: { contacts: JSON.stringify([{ id: 'default', name: '旧名甲' }]) },
    msgs: [poke('旧名甲 拍了拍 我的脑袋'), { side: 'out', text: '今天也要好好的呀', ts: Date.now() - 30000 }],
  }, async (page) => {
    const n = await enterAndWaitMsgs(page, 2);
    check('B0 夹具：种子历史已落屏（含字面旧名拍一拍）', n, 'msgs=' + n);
    await waitChatReady(page);
    let r = await probe(page);
    check('B0b 改名前屏上确实是旧名（对照组）', r.body.indexOf('旧名甲') >= 0, lineOf(r.body, '旧名甲'));

    const navB = await renameViaSettings(page, 'cs-lbl-partner', '新名乙');
    check('B0c 前置：聊天设置页已打开、「返回」已回到聊天页（红的是夹具不是产品时先看这条）',
      navB.shown && navB.back, JSON.stringify(navB));
    r = await probe(page);
    check('B1 数据面：历史里的字面旧名已清扫成 {ta} 占位符（原文不再写死）',
      r.msgs.some(t => t.indexOf('{ta}') >= 0) && !r.msgs.some(t => t.indexOf('旧名甲') >= 0),
      JSON.stringify(r.msgs.slice(0, 2)));
    check('B2 改名历史已记录（sysmsg-nick-hist 含旧名）', r.hist.indexOf('旧名甲') >= 0, JSON.stringify(r.hist));
    // 不对整块 body 做全局负判据：ta-ask 会在跑测中途随机弹「{当前显示名}想问你一个问题。」，
    // 烤的是注入那一刻的名字，与本次改名无关（G3 同款教训）。负判据放在数据面。
    const pokeLineB = lineOf(r.body, '拍了拍');
    check('B3 用户可见面：点「返回」回聊天后，屏上拍一拍已是新名（无需刷新/重进）',
      pokeLineB.indexOf('新名乙') >= 0 && pokeLineB.indexOf('旧名甲') < 0 && !r.msgs.some(t => t.indexOf('旧名甲') >= 0),
      'poke=' + pokeLineB + ' | histOld=' + r.msgs.some(t => t.indexOf('旧名甲') >= 0));
    check('B4 普通气泡不受影响（只有可清扫类型跟随）',
      r.body.indexOf('今天也要好好的呀') >= 0, lineOf(r.body, '今天也要'));
  });

  // ============ C 聊天设置改「我的昵称」→ {me} 侧跟随（旧实现只写键、不扫历史） ============
  await scenario({
    root: { contacts: JSON.stringify([{ id: 'default', name: '小满' }]) },
    cid: { 'cs-lbl-user': '阿珍' },
    msgs: [poke('小满 拍了拍 阿珍 的脑袋')],
  }, async (page) => {
    const n = await enterAndWaitMsgs(page, 1);
    check('C0 夹具：含「我的旧昵称」字面的拍一拍已落屏', n, 'msgs=' + n);
    await waitChatReady(page);
    let r = await probe(page);
    check('C0b 改名前屏上是「阿珍」', r.body.indexOf('阿珍') >= 0, lineOf(r.body, '阿珍'));

    const navC = await renameViaSettings(page, 'cs-lbl-user', '阿强');
    check('C0c 前置：改「我的昵称」的弹窗路径走通（设置页开＋返回到聊天页）',
      navC.shown && navC.back, JSON.stringify(navC));

    r = await probe(page);
    check('C1 数据面：我的旧昵称被清扫成 {me} 占位符',
      r.msgs.some(t => t.indexOf('{me}') >= 0) && !r.msgs.some(t => t.indexOf('阿珍') >= 0),
      JSON.stringify(r.msgs));
    check('C2 我的改名历史单独记账（sysmsg-user-nick-hist 含旧名，不与 TA 的混用）',
      r.uhist.indexOf('阿珍') >= 0, JSON.stringify(r.uhist));
    check('C3 屏上拍一拍已改口「阿强」（聊天设置这条路径接了钩子）',
      r.body.indexOf('阿强') >= 0 && r.body.indexOf('阿珍') < 0, lineOf(r.body, '拍了拍'));
  });

  // ============ D 昵称池换「我的昵称」＝同一条钩子 ============
  await scenario({
    root: { contacts: JSON.stringify([{ id: 'default', name: '小满' }]) },
    cid: {
      'cs-lbl-user': '阿珍', 'nick-me-lib': JSON.stringify(['池名丁']),
      'nick-me-lib-last': String(Date.now()), 'nick-me-lib-next': '8',
      'nick-lib-last': String(Date.now()), 'nick-lib-next': '8',
    },
    msgs: [poke('小满 拍了拍 阿珍 的脑袋')],
  }, async (page) => {
    const n = await enterAndWaitMsgs(page, 1);
    check('D0 夹具：种子已落屏', n, 'msgs=' + n);
    await waitChatReady(page);
    const opened = await page.evaluate(() => {
      const b = document.getElementById('more-avatar'); if (!b) return 'no-btn';
      b.click();
      const c = document.getElementById('avlib-card');
      return c && !c.hidden ? 'ok' : 'closed';
    });
    check('D0b 头像和昵称互动半框已打开', opened === 'ok', opened);
    await page.evaluate(() => { const e = document.getElementById('avlib-kind-name'); if (e) e.click(); });
    await sleep(200);
    await page.evaluate(() => { const e = document.getElementById('avlib-tab-b'); if (e) e.click(); });
    await sleep(200);
    await page.evaluate(() => {
      const cell = document.querySelector('#avlib-me-nick-list .avlib-name-cell .avlib-name-txt');
      if (cell) cell.click();
    });
    await sleep(500);
    const r = await probe(page);
    check('D1 昵称池换我的昵称后 cs-lbl-user＝「池名丁」', r.lu === '池名丁', String(r.lu));
    check('D2 同一条 me 槽钩子生效：历史字面旧名已清扫成 {me}',
      r.msgs.some(t => t.indexOf('{me}') >= 0) && !r.msgs.some(t => t.indexOf('阿珍') >= 0),
      JSON.stringify(r.msgs));
    check('D3 屏上拍一拍显示新名「池名丁」', r.body.indexOf('池名丁') >= 0 && r.body.indexOf('阿珍') < 0,
      lineOf(r.body, '拍了拍'));
  });

  // ============ E 联系人管理改名（renameContact）→ 顶栏 + 屏上跟随 ============
  await scenario({
    root: { contacts: JSON.stringify([{ id: 'default', name: '名片旧名' }]) },
    msgs: [poke('名片旧名 拍了拍 我'), poke('{ta} 拍了拍 {me} 的脑袋')],
  }, async (page) => {
    const n = await enterAndWaitMsgs(page, 2);
    check('E0 夹具：名片旧名字面历史 + 占位符历史各一条', n, 'msgs=' + n);
    await waitChatReady(page);
    let r = await probe(page);
    check('E0b 改名前顶栏＝名片旧名', r.header === '名片旧名', r.header);
    await page.evaluate(() => { try { window.renameContact('default', '名片新名'); } catch (e) {} });
    await sleep(500);
    r = await probe(page);
    check('E1 聊天顶栏立刻按同一条链重取＝「名片新名」（contact-renamed 监听）',
      r.header === '名片新名', 'header=' + r.header);
    check('E2 字面旧名已清扫成 {ta} 且 hist 记录了名片旧名',
      r.msgs.some(t => t.indexOf('{ta}') >= 0) && !r.msgs.some(t => t.indexOf('名片旧名') >= 0) && r.hist.indexOf('名片旧名') >= 0,
      JSON.stringify([r.msgs, r.hist]));
    check('E3 屏上拍一拍已是「名片新名」',
      r.body.indexOf('名片新名') >= 0 && r.body.indexOf('名片旧名') < 0, lineOf(r.body, '拍了拍'));
  });

  // ============ F 防过度清扫：普通气泡正文里的名字不动 + 改名事件记录豁免 ============
  await scenario({
    root: { contacts: JSON.stringify([{ id: 'default', name: '小满' }]) },
    cid: { 'cs-lbl-partner': '旧名甲' },
    msgs: [
      { side: 'out', text: '我给旧名甲买花了', ts: Date.now() - 900000 },
      poke('旧名甲 拍了拍 我', { nickKeep: true, ts: Date.now() - 600000 }),
      poke('旧名甲 拍了拍 我', { ts: Date.now() - 300000 }),
    ],
  }, async (page) => {
    const n = await enterAndWaitMsgs(page, 3);
    check('F0 夹具：普通气泡 + nickKeep 记录 + 普通拍一拍各一条（时间戳拉开防相邻重复收敛）', n, 'msgs=' + n);
    await waitChatReady(page);
    await renameViaSettings(page, 'cs-lbl-partner', '新名乙');
    const r = await probe(page);
    check('F1 普通气泡正文永不被改写（普通消息不是系统标记，绝不扫）',
      r.msgs.some(t => t === '我给旧名甲买花了'), JSON.stringify(r.msgs));
    check('F2 nickKeep 事件记录保留当时事实（写的是那一次发生了什么，不随后续改名改写）',
      r.msgs.filter(t => t === '旧名甲 拍了拍 我').length === 1, JSON.stringify(r.msgs));
    check('F3 未豁免的那条照常跟随（清扫范围精确，不多扫也不漏扫）',
      r.msgs.filter(t => t === '{ta} 拍了拍 我').length === 1, JSON.stringify(r.msgs));
  });

  // ============ G 字面默认称呼「TA」也跟随显示链（#775i 旧名别名） ============
  // 早期历史里系统消息是把「TA」两个字**写死**在正文里的（当时聊天昵称回退值就是 'TA'）。
  // #775 把取名链改成「cs-lbl-partner → 联系人名片名 → 称呼词」后，改名基线不再是 'TA'，
  // 若不补这一环，那批写死 'TA' 的行就再也没人清扫（红基线靠 oldEff='TA' 顺带扫掉＝覆盖面缩水）。
  await scenario({
    root: { contacts: JSON.stringify([{ id: 'default', name: '小满' }]) },
    msgs: [{ side: 'in', text: 'TA想问你一个问题。', special: 'ask-msg', ts: Date.now() - 120000 }],
  }, async (page) => {
    const n = await enterAndWaitMsgs(page, 1);
    check('G0 夹具：字面「TA」开头的 ask-msg 已落屏', n, 'msgs=' + n);
    let r = await probe(page);
    check('G1 屏上按同一条取名链渲染（字面 TA 位置显示的是当前显示名，不是死板的「TA」）',
      /小满\s*想问你一个问题/.test(r.body) && r.body.indexOf('TA想问你一个问题') < 0, lineOf(r.body, '想问你一个问题'));
    await waitChatReady(page);
    await renameViaSettings(page, 'cs-lbl-partner', '新名乙');
    r = await probe(page);
    check('G2 改名后别名已记入改名历史（hist 含 TA＝其余桌面靠惰性补扫也能跟上）',
      r.hist.indexOf('TA') >= 0, JSON.stringify(r.hist));
    check('G3 写死的字面 TA 已清扫成 {ta} 占位符（跑测期间 ta-ask 还会随机新增字面 TA 的提问，那条由取名链兜住，故按条数判）',
      r.msgs.filter(t => t === '{ta}想问你一个问题。').length >= 1, JSON.stringify(r.msgs));
    check('G4 屏上已是新名', r.body.indexOf('新名乙') >= 0, lineOf(r.body, '想问你一个问题'));
  });

  check('Z1 全程无未捕获 JS 错误', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  if (browser) await browser.close();
  server.close();
  if (tmpPage) { try { unlinkSync(tmpPage); } catch (e) {} }
}

const pass = results.filter(r => r.ok).length;
const fail = results.length - pass;
console.log('\n合计 ' + pass + '/' + results.length + (fail ? '（失败 ' + fail + '）' : ''));
process.exit(fail ? 1 : 0);
