// verify-1199-mem-warn-bar.mjs — 内存回收警告条「关不掉 / 总是弹 / 方法没用」三处行为断言
// 报障（用户实报 + 截图）：「图上弹窗无法关闭，并且总是错误出现这个弹窗」「而且这上面写的方法也没有用啊」
// 缺陷面（HEAD）：
//  ①线上这条**没有关闭键**（#1063 加的「×」从未构建入库，HEAD/origin 的 src 与产物里查无 mem-warn-x），
//    只能干等 60s 自动收起；文案里的裸 <b>「去看怎么清」被 flex 压成一列竖排字＝关闭键即使有也被挤出屏幕。
//  ②门槛含「累计 ≥10 次」这个永不衰减的历史值，diedAt 定长只留 10 条（「近两天 10 次」是饱和值），
//    且两条取证路对同一次回收各记一次账＝老设备一旦跨过每天复弹。
//  ③方法给的是 Chrome「内存节省程序 / 始终保持活动」——只管浏览器标签页，桌面快捷方式与独立 PWA
//    进程不受它约束，安卓端真正收回后台的是系统省电与后台管控＝照做没用。
// 用法：node tools/verify-1199-mem-warn-bar.mjs [rootDir]（缺省＝仓库根；传 HEAD 导出树＝RED 基线）
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return null; } };
const bg = read('src/js/bg-keep.js');
const dev = read('src/js/device.js');
const css = read('src/css/base.css');
const prod = read('index.html');
const prodBg = read('js/bg-keep.js');

let pass = 0, fail = 0;
const t = (name, ok, detail) => { if (ok) pass++; else fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ← ' + detail : '')); };
if (bg == null || css == null || dev == null) { console.log('FAIL 找不到源文件（root=' + root + '）'); process.exit(1); }

console.log('【S 源级锚：三条根因各自被钉住】');
t('S1 警告条有关闭键', bg.includes('id="mem-warn-x"'));
t('S2 有「不再提示」永久静音键', bg.includes("gSet(MEM_NOTE_OFF, '1')") && bg.includes("const MEM_NOTE_OFF = '__ka-mem-note-off'"));
t('S3 挂条前先过永久静音闸', bg.includes('if (memNoteOff()) return;') && bg.includes('if (memNoteOff()) { kaDiedNotice = false; return; }'));
t('S4 门槛只看近两天（累计数不再当门槛）', bg.includes('if (recent >= 3) {') && !bg.includes('total >= 10'));
t('S5 顶条冷却 24h→7 天', bg.includes("kaNoticeCool('__ka-mem-note-at', 7 * 24 * 3600 * 1000)"));
t('S6 两条取证路同事件去重', bg.includes('if (kaDiedNotice) return;'));
t('S7 近两天计数按 48h 时间窗算（不再数定长数组）', bg.includes('const cut = Date.now() - 48 * 3600 * 1000;') && bg.includes('kaEv.diedAt.length > 30'));
t('S8 提示条不再指控「内存不够」', !bg.includes('手机内存不够'));
t('S9 没用的旧方法不再出现在提示条与诊断建议里', !bg.includes('内存节省程序」关掉') && !dev.includes('内存节省程序」关掉'));
t('S10 方法换成系统省电/后台管控＋最近任务锁定', bg.includes('允许后台活动') && bg.includes('锁定') && dev.includes('允许后台活动'));
t('S11 CSS：文案独占一行（否则芯片被压成竖排、关闭键挤出屏幕）', css.includes('#mem-warn-bar .vub-txt { flex:1 1 100%; }'));
t('S12 CSS：关闭键绝对定位钉右上角（不参与 flex 流）', css.includes('#mem-warn-bar #mem-warn-x { position:absolute;'));
t('S13 CSS：本条刻意不重写 display（会打掉 [hidden] 收起能力）', !/#mem-warn-bar \{[^}]*display/.test(css));
t('S14 CSS：顶条里的裸 <b> 不参与压缩（pwa.js「点此重试」同族护栏）', css.includes('.ver-update-bar > b { flex:none; white-space:nowrap; }'));
if (prod != null && prodBg != null) {
  t('S15 产物已接入（关闭键＋CSS 两条）', prodBg.includes('id="mem-warn-x"') && prod.includes('#mem-warn-bar .vub-txt { flex:1 1 100%; }') && prod.includes('.ver-update-bar > b { flex:none; white-space:nowrap; }'));
}
{ // S16 存活标记的声明必须早于 sessBootCheck() 里的同步赋值（否则 TDZ 被外层 try 吞掉＝通用路径永不弹）
  const decl = bg.indexOf('let kaDiedNotice');
  const firstWrite = bg.indexOf('kaDiedNotice = true');
  const call = bg.indexOf('sessBootCheck();');
  t('S16 通用存活路径不再踩 TDZ（声明早于赋值与调用）', decl >= 0 && firstWrite > decl && call > decl, 'decl=' + decl + ' write=' + firstWrite + ' call=' + call);
}

// ---- B 组：把 showMemWarnBar / tryShowKaDiedNotice 连同自家依赖切出来，在 mock 环境里真跑 ----
const a = bg.indexOf('const MEM_NOTE_OFF');
const bEnd = bg.indexOf('function nbPermPendingNotice');
if (a < 0 || bEnd < 0) { console.log('FAIL B0 提示条代码段提取失败（HEAD 红基线属预期）'); }
else {
  const body = bg.slice(a, bEnd);
  function mkEnv({ ev = {}, off = false, timers = [] }) {
    const nodes = {};
    const mkNode = (name) => ({
      name, id: name === 'vub-txt' ? '' : name, textContent: '', _ls: {},
      addEventListener(k, fn) { (this._ls[k] = this._ls[k] || []).push(fn); },
      click() { (this._ls.click || []).forEach((f) => f({ stopPropagation() {}, target: { id: this.id } })); },
    });
    const bar = {
      id: '', className: '', style: {}, hidden: false, appended: false, _ls: {},
      addEventListener(k, fn) { (bar._ls[k] = bar._ls[k] || []).push(fn); },
      querySelector(sel) { const key = sel.replace(/^[#.]/, ''); return nodes[key] || (nodes[key] = mkNode(key)); },
      set innerHTML(v) { bar._html = v; }, get innerHTML() { return bar._html || ''; },
    };
    const store = Object.assign({}, ev);
    if (off) store.__ka_mem_note_off = '1';
    const gk = (k) => String(k).replace(/-/g, '_');
    const env = {
      document: {
        visibilityState: 'visible',
        createElement: () => bar,
        getElementById: (id) => (bar.appended && bar.id === id ? bar : null),
        querySelector: () => null,
        body: { appendChild(el) { el.appended = true; } },
      },
      window: { openModal: (title, v, fn, opts) => { env.modals.push({ title, fn, opts }); return { okText: (s) => { env.modals[env.modals.length - 1].ok = s; } }; } },
      gGet: (k) => store[gk(k)] ?? null,
      gSet: (k, v) => { store[gk(k)] = v; },
      kaNoticeCool: (k, ms) => (env._cool || {})[gk(k)] || false,
      kaNoticeStamp: (k) => { (env._stamped = env._stamped || []).push(k); },
      kaNoticeAfterSplash: (fn) => fn(),
      toast: (s, ms) => { env.toasts.push([s, ms]); },
      kaEv: { stall: 0, died: 0, diedAt: [], ...(ev.__ka_ev || {}) },
      kaEvSave: () => { env.saved = (env.saved || 0) + 1; },
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); },
      openModal: (title, v, fn, opts) => { env.modals.push({ title, fn, opts }); return { okText: (s) => { env.modals[env.modals.length - 1].ok = s; } }; },
      modals: [], toasts: [], bar, nodes, store, timers,
    };
    return env;
  }
  const load = (env) => new Function('env', `
    const gGet=env.gGet, gSet=env.gSet, kaNoticeCool=env.kaNoticeCool, kaNoticeStamp=env.kaNoticeStamp,
      kaNoticeAfterSplash=env.kaNoticeAfterSplash, toast=env.toast, document=env.document, window=env.window,
      kaEv=env.kaEv, kaEvSave=env.kaEvSave, setTimeout=env.setTimeout, openModal=env.window.openModal;
    let kaDiedNotice = true;
    ${body}
    return { showMemWarnBar, tryShowKaDiedNotice, recentDiedCount, memNoteOff, MEM_HOW_TO };
  `)(env);

  console.log('【B 行为：挂条 / 关闭 / 永久静音 / 门槛】');
  { // B1 挂出三枚控件，且不再横排挤压
    const env = mkEnv({}); const m = load(env);
    m.showMemWarnBar(4);
    const html = env.bar.innerHTML;
    t('B1 挂出「怎么清 / 不再提示 / ×」三枚控件', html.includes('id="mem-warn-how"') && html.includes('id="mem-warn-off"') && html.includes('id="mem-warn-x"'), html.slice(0, 70));
    t('B2 控件走全站 .vub-act 芯片（不是裸 <b>）', html.includes('class="vub-act"') && !/<b>/.test(html));
    t('B3 文案只报「近两天几次」，不再甩累计大数', env.nodes['vub-txt'] && env.nodes['vub-txt'].textContent.includes('近两天有 4 次') && !env.nodes['vub-txt'].textContent.includes('内存不够'), env.nodes['vub-txt'] && env.nodes['vub-txt'].textContent.slice(0, 40));
    t('B4 60s 自动收起仍在', env.timers.some((x) => x.ms === 60000));
  }
  { // B5 点 ×：当场收起，但不写永久键（冷却另有 7 天）
    const env = mkEnv({}); const m = load(env);
    m.showMemWarnBar(4);
    env.nodes['mem-warn-x'].click();
    t('B5 点 × 当场收起', env.bar.hidden === true);
    t('B6 点 × 不写永久静音（只是这一轮不再弹）', env.store.__ka_mem_note_off === undefined);
  }
  { // B7 点「不再提示」：写永久键并收起；再挂一次直接 return
    const env = mkEnv({}); const m = load(env);
    m.showMemWarnBar(4);
    env.nodes['mem-warn-off'].click();
    t('B7 点「不再提示」写入永久静音键', env.store.__ka_mem_note_off === '1' && env.bar.hidden === true);
    t('B8 memNoteOff 回读为真', m.memNoteOff() === true);
    const before = env.nodes['vub-txt'] ? env.nodes['vub-txt'].textContent : '';
    m.showMemWarnBar(9);
    t('B9 已永久静音后 showMemWarnBar 不再挂条', env.nodes['vub-txt'].textContent === before);
  }
  { // B10 「怎么清」＝开弹窗给真做得到的方法，确认键才跳查看存储
    const env = mkEnv({}); const m = load(env);
    m.showMemWarnBar(4);
    env.nodes['mem-warn-how'].click();
    const mo = env.modals[0];
    t('B10 点「怎么清」开的是全站弹窗（openModal），不是 alert', !!mo && !!mo.opts && mo.opts.staticText === m.MEM_HOW_TO);
    t('B11 方法里是系统省电/后台管控＋锁定＋别划掉，不是 Chrome 标签页开关', /允许后台活动/.test(m.MEM_HOW_TO) && /锁定/.test(m.MEM_HOW_TO) && !/内存节省程序/.test(m.MEM_HOW_TO));
    t('B12 确认键改口「去清存储」，点它才走设置路径', mo && mo.ok === '去清存储' && typeof mo.fn === 'function');
  }
  { // B13~B16 门槛：累计再高也不弹，只有近两天 ≥3 才升级成顶条
    const day = 86400000;
    const mk = (died, diedAt, cool) => {
      const env = mkEnv({ ev: { __ka_ev: { stall: 0, died, diedAt } } });
      const m = load(env);
      env._cool = cool || {};
      m.tryShowKaDiedNotice();
      return { env, m };
    };
    { const { env } = mk(99, [], {}); env.kaEv.died = 99; t('B13 累计 99 次但近两天 0 次 → 不弹顶条（走 toast）', !env.bar.appended && env.toasts.length === 1); }
    { const { env } = mk(0, [Date.now(), Date.now() - day, Date.now() - 2 * day], {}); t('B14 近两天 3 次 → 升级成顶条', env.bar.appended === true); }
    { const { env } = mk(0, [Date.now() - 3 * day, Date.now() - 4 * day, Date.now() - 5 * day], {}); t('B15 三天前的记录不再算进「近两天」', !env.bar.appended); }
    { const { env } = mk(0, [Date.now(), Date.now(), Date.now()], { __ka_mem_note_at: true }); t('B16 7 天冷却内不重复弹', !env.bar.appended && env.toasts.length === 0); }
    { const env = mkEnv({ ev: {}, off: true }); const m = load(env); env.kaEv.diedAt = [Date.now(), Date.now(), Date.now()]; m.tryShowKaDiedNotice(); t('B17 用户点过「不再提示」→ 顶条与 toast 全静默', !env.bar.appended && env.toasts.length === 0); }
    { const env = mkEnv({}); const m = load(env); env.kaEv.diedAt = [Date.now(), Date.now() - 10 * 86400000, Date.now() - 20 * 86400000]; const n = m.recentDiedCount(); t('B18 过期记录被就地清掉（计数＝时间窗真值）', n === 1 && env.kaEv.diedAt.length === 1 && env.saved > 0, 'n=' + n); }
  }
}

// ---- C 组：真浏览器量形（用户报障第一句＝「关不掉」，只有真排版能证明关闭键在屏幕内）----
// 走真实启动链：种 __ka-ev（近两天 3 次）→ 重载 → 开屏关掉 → 顶条由自家代码挂出 → 量三枚芯片几何。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { rmSync, statSync } from 'node:fs';
import { normalize, extname } from 'node:path';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROMES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean);
const chromePath = CHROMES.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath || typeof WebSocket !== 'function') {
  console.log('SKIP C 组（无头浏览器环境不满足：chrome=' + !!chromePath + ' WebSocket=' + (typeof WebSocket === 'function') + '）');
} else {
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
  const udd = join(process.env.TEMP || '/tmp', 'mochi-1199-' + Date.now());
  const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 80));
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + udd, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
  let ws = null, msgId = 0;
  const pend = new Map();
  const cdp = (method, params = {}) => new Promise((res) => { const id = ++msgId; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  async function evalJs(expr) {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.log('EVAL-ERR', JSON.stringify(r.exceptionDetails).slice(0, 160)); return null; }
    return r && r.result ? r.result.value : null;
  }
  try {
    for (let i = 0; i < 60; i++) {
      try {
        const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
        const page = list.find((x) => x.type === 'page');
        if (page) {
          ws = new WebSocket(page.webSocketDebuggerUrl);
          await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
          ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
          break;
        }
      } catch (e) {}
      await sleep(150);
    }
    if (!ws) throw new Error('无法连接无头浏览器');
    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const SEED = `(function(){var now=Date.now();localStorage.setItem('xy-home-v2:__ka-ev',JSON.stringify({stall:0,died:9,diedAt:[now,now-60000,now-120000]}));
      localStorage.setItem('xy-home-v2:__sess-alive',JSON.stringify({t:now-60000,closed:false}));
      localStorage.removeItem('xy-home-v2:__ka-mem-note-at');localStorage.removeItem('xy-home-v2:__ka-died-note-at');
      localStorage.removeItem('xy-home-v2:__ka-mem-note-off');
      var d=new Date();localStorage.setItem('xy-home-v2:age-confirmed','1');
      localStorage.setItem('xy-home-v2:splash-seen:'+d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2),'1');return true;})()`;
    let seedId = null;
    const setSeed = async (extra) => {
      if (seedId) { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: seedId }); seedId = null; }
      const r = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: SEED + (extra || '') });
      seedId = r && r.identifier;
    };
    // 开屏是进入页面的必经闸门（必读滚动 + 「点击进入」），不真实走完就没有「开屏已关」，顶条按 #900 口径不弹
    const dismissSplash = async () => {
      await evalJs("(function(){var sb=document.getElementById('splash-box');if(sb){sb.scrollTop=sb.scrollHeight;sb.dispatchEvent(new Event('scroll'));}var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();return true;})()");
      await sleep(600);
      await evalJs("(function(){var ms=document.getElementById('splash-mandatory-scroll');if(ms){ms.scrollTop=ms.scrollHeight;ms.dispatchEvent(new Event('scroll'));}return true;})()");
      await sleep(400);
      await evalJs("(function(){var me=document.getElementById('splash-mandatory-enter');if(me)me.click();return true;})()");
      await sleep(600);
      await evalJs("(function(){var c=document.getElementById('splash-confirm');if(c&&!c.hidden){var b=c.querySelector('#splash-confirm-ok');if(b)b.click();}return true;})()");
      await sleep(600);
    };
    const waitBar = async (ms) => {
      for (let i = 0; i < Math.round(ms / 250); i++) {
        if (await evalJs("!!document.getElementById('mem-warn-bar')")) return true;
        await sleep(250);
      }
      return false;
    };
    console.log('【C 真浏览器：顶条挂出后的实际排版（390×844）】');
    // C 第一轮：种子＝近两天 3 次＋上次没正常收尾 → 顶条应由自家代码挂出
    await setSeed('');
    await cdp('Page.navigate', { url: baseUrl + '/index.html' });
    await sleep(2500);
    for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
    await dismissSplash();
    const shown = await waitBar(4000);
    t('C1 近两天 3 次 → 真页面里顶条挂出', shown === true);
    const geo = await evalJs(`(function(){
      var b=document.getElementById('mem-warn-bar'); if(!b) return null;
      var g=function(id){var e=document.getElementById(id); if(!e) return null; var r=e.getBoundingClientRect();
        return {w:Math.round(r.width),h:Math.round(r.height),l:Math.round(r.left),rt:Math.round(r.right),tt:Math.round(r.top)};};
      return {vw:window.innerWidth, bar:g('mem-warn-bar'), txt:(function(){var e=b.querySelector('.vub-txt');var r=e.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)};})(),
        how:g('mem-warn-how'), off:g('mem-warn-off'), x:g('mem-warn-x')};
    })()`);
    const inView = (c) => !!c && c.l >= 0 && c.rt <= geo.vw + 1 && c.h > 0;
    const oneLine = (c) => !!c && c.h <= 40;
    t('C2 关闭键「×」在屏幕内（报障第一句＝它被挤出屏幕）', inView(geo && geo.x), JSON.stringify(geo && geo.x));
    t('C3 「×」没被压成一列竖排字（高 ≤40px）', oneLine(geo && geo.x), 'h=' + (geo && geo.x && geo.x.h));
    t('C4 「怎么清」「不再提示」各自单行（旧版竖排＝被压到一字符宽）', oneLine(geo && geo.how) && oneLine(geo && geo.off), JSON.stringify(geo && [geo.how, geo.off]));
    t('C5 文案独占一行（宽 ≥ 视口一半，不再与芯片抢横向空间）', !!geo && geo.txt.w >= geo.vw * 0.5, JSON.stringify(geo && [geo.txt, geo.vw]));
    t('C6 顶条整体没超出屏幕（右沿不越界）', !!geo && geo.bar.rt <= geo.vw + 1, JSON.stringify(geo && geo.bar));
    const clicked = await evalJs(`(function(){var x=document.getElementById('mem-warn-x'); if(!x) return 'no-x';
      x.click(); var b=document.getElementById('mem-warn-bar');
      return {hidden: b.hidden, disp: getComputedStyle(b).display, off: localStorage.getItem('xy-home-v2:__ka-mem-note-off')};})()`);
    t('C7 点「×」当场收起（display:none），且不写永久静音', !!clicked && clicked.disp === 'none' && clicked.hidden === true && clicked.off === null, JSON.stringify(clicked));
    // C 第二轮：同样的种子，但先置「不再提示」→ 不该再挂条
    await setSeed(";localStorage.setItem('xy-home-v2:__ka-mem-note-off','1');");
    await cdp('Page.navigate', { url: baseUrl + '/index.html' });
    await sleep(2500);
    for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
    await dismissSplash();
    const again = await waitBar(3000);
    t('C8 点过「不再提示」后，同样条件下永不再挂条（永久静音真落盘）', again === false);
    // C 第三轮：累计很高但近两天 0 次 → 不弹顶条（本次报障第二句「总是错误出现」的主根因）
    await setSeed("(function(){localStorage.setItem('xy-home-v2:__ka-ev',JSON.stringify({stall:0,died:72,diedAt:[Date.now()-5*86400000,Date.now()-6*86400000]}));return true;})()");
    await cdp('Page.navigate', { url: baseUrl + '/index.html' });
    await sleep(2500);
    for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
    await dismissSplash();
    const stale = await waitBar(2500);
    t('C9 累计 72 次但近两天 0 次 → 不再弹顶条（旧版「累计≥10」＝老设备每天复弹）', stale === false);
  } catch (e) {
    console.log('FAIL C 组执行异常：' + (e && e.message)); fail++;
  } finally {
    try { chrome.kill(); } catch (e) {}
    try { server.close(); } catch (e) {}
    try { rmSync(udd, { recursive: true, force: true }); } catch (e) {}
  }
}

console.log(`\n合计 ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
