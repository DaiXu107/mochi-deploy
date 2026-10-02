// verify-1230-pick-under-finger.mjs — #1230 第十一波：程序化激活那一拍，把真·渲染的 file input 搬到手指底下
// 立项（用户 2026-09-25 iPhone 16 Pro / iOS 26.6.1 Safari·桌面图标 实报「字卡数据和聊天背景上传不了没反应」，
//   附 2026-09-22 真机诊断：文件选择取证 6 笔全是 `dev-cs-bg-pick/leg:fire`、没有一条 files=N，也没有一条
//   surf:hit ⇒ 手指没落在任何「真·可点层」上，走的是程序化腿，而那条腿对 sr-only clip 元素被内核静默拒绝）。
// 同族 #603→#1197 十波的共同错误＝**逐入口**铺层：漏一个入口、层被重渲染搬位、层的宿主 id 没解析，
//   就在那个入口上原样复发。本波不碰任何入口，只改「激活」这一件事本身（mochiFilePickFire 单点）。
// 本脚本的内核模型（**独立实现，绝不调产品代码判据**，否则等于拿修复证修复）：
//   file input 的 showPicker() / click() 只在「该元素真被渲染（有 ≥2px 的盒、没被 clip 裁掉、非
//   display:none/visibility:hidden）」且「本次手势的落点命中它或它的祖先」时才弹出选择器，否则**静默不弹**
//   （不抛异常＝JS 探测不到失败——这正是用户报的「点了没反应」的形状）。
//   两条判据都取自可观测事实，零机型 / 零 UA 分支。桌面鼠标（无触摸落点）与改前逐字相同＝脚本里的控制组。
// 取证边界（务必如实转述）：本机无头环境无法替 iOS 26 作证（同批 WebKit 激活矩阵实测：sr-only clip 元素上
//   调 showPicker＝不弹，而 .click()＝弹，与真机形态不同 ⇒ 无头 WebKit 不能当 iOS 的判据，只能作对照组）。
//   本脚本锁的是**契约**：搬层腿挂在激活单点上、几何与渲染判据成立、不双开、不吃用户下一次点击、
//   常驻 input 的 accept/multiple/回调不被裸登记抹掉、宿主 id 当场解析。真机是否弹出仍要用户复报确认。
// 用法：node build.mjs && node tools/verify-1230-pick-under-finger.mjs
// 用法（RED 基线/隔离根）：SERVE_ROOT=<纯 HEAD 副本目录> node tools/verify-1230-pick-under-finger.mjs
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || here);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
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
console.log('serve root = ' + root);

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };
// device.js 在产物里是内联件（不在 js/ 下），jsOf 取不到就回读 index.html
const jsOf = (f) => { try { return readFileSync(existsSync(join(root, 'js', f)) ? join(root, 'js', f) : join(root, 'index.html'), 'utf8'); } catch (e) { return ''; } };

// 64×64 不透明 PNG（与 verify-1002 同一夹具：走真选择器投递＝change→FileReader→压缩→落库全链路）
const PNG_B64 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAm0lEQVR4nO3WMQ6CQBBR4Rfe3uAKCm/A3s7gDQnG0BFDQqKlcDDs/j8Eq0m+mbMzwzQAAAAAAAAAAAAAAAAAAOAvnTMAAAAAAAAAAAAAAAAAAOAvJ3QCJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACf+0F0V6C9lDLmNgAAAAASUVORK5CYII=', 'base64');

// ================= S 段：产物源码锚（改名/换实现/被别的会话打回即失守） =================
{
  const dev = jsOf('device.js');
  // 函数体切片一律用「本函数定义 → 下一个 window. 定义」的 indexOf 区间：缩进/空行会被打包改动，
  // 拿 `^\n  };` 这类脆弱正则去截，整段会静默截成空串 ⇒ 断言全红（本脚本第一版就踩过）。
  const between = (src, a, b) => {
    const i = src.indexOf(a); if (i < 0) return '';
    const j = src.indexOf(b, i + a.length);
    return j < 0 ? src.slice(i) : src.slice(i, j);
  };
  const fbBody = between(dev, 'window.mochiPickFallback = function (input, tap) {', 'window.mochiFilePickFire = function');
  const fireBody = between(dev, 'window.mochiFilePickFire = function (input, opts) {', 'window.mochiFilePick = function');
  const pickBody = between(dev, 'window.mochiFilePick = function (opts) {', 'window.mochiFilePickBindHost = function');
  const surfBody = between(dev, 'window.mochiFilePickSurface = function (btn, opts) {', 'window.mochiFilePickSurfaceTap = function');
  ok(fbBody.length > 800 && fireBody.length > 400 && pickBody.length > 800 && surfBody.length > 1200,
    'S0 四段函数体都截到了（切片本身失败时别让下面一串 needle 冒充「代码丢了」）',
    [fbBody.length, fireBody.length, pickBody.length, surfBody.length].join('/'));

  ok(dev.includes('window.mochiPickFallback = function (input, tap) {') && fireBody.includes('mochiPickFallback(input, tap)'),
    'S1 搬层腿挂在**激活单点**（mochiFilePickFire 里调 mochiPickFallback）——全站 40+ 入口共用这一处，不再逐入口手抄（手抄必漏＝本族十波复发的结构性原因）');
  ok(dev.includes('window.mochiFileInputRendered = function (input) {') && dev.includes('getClientRects()') && dev.includes("cs.clipPath && cs.clipPath !== 'none'"),
    'S2 判据是「这个元素到底有没有被渲染」（盒尺寸＋clip），不是机型／UA——搬层的触发条件可观测、可复核');
  ok(fireBody.includes('__mochiLastTap') && fireBody.includes('elementFromPoint(tap.x, tap.y)') && fireBody.includes('< 1200'),
    'S3 同一次点按才算数（落点时间窗）＋落点必须命中被激活的元素或其祖先，两条都成立才搬；取不到落点一律按「没命中」');
  const fbCss = (fbBody.match(/ov\.style\.cssText = '([^']+)'/) || ['', ''])[1];
  ok(fbCss.includes('appearance:none') && fbCss.includes('pointer-events:none') && fbCss.includes('opacity:1')
    && !/display:\s*none/.test(fbCss) && !/opacity:\s*0/.test(fbCss),
    'S4 搬过去那层是「外观不可见、元素可见」（#717/#738 判据）：绝不用 display:none / opacity:0——那正是被内核拒绝激活的形态', fbCss.slice(0, 90));
  ok(fbBody.includes("ov.accept = input && input.accept ? input.accept : ''") && fbBody.includes('ov.multiple = !!(input && input.multiple)'),
    'S5 搬层必须把 accept/multiple 从被激活元素抄过来（#753 判据：漏了＝iOS 相册不在候选／多选失效）');
  ok(fbBody.includes("orig.dispatchEvent(new Event('change'))") && !/orig\.dispatchEvent\(new Event\(['"]click['"]\)/.test(fbBody),
    'S6 选完只派发 change、**不派发 click**——否则这一下会冒泡回入口按钮把自己再触发一遍＝二次弹选择器');
  ok(dev.includes("document.addEventListener('pointerup', off, { capture: true, passive: true })") && dev.includes('setTimeout(window.__mochiPickFbOff, 1200)') && !dev.includes('mochiPickFallbackArmed'),
    'S7 搬层那格的「可命中」只活到**这一下手势结束**（pointerup/touchend/mouseup 收窗＋1.2s 硬窗），不吃用户下一次点击；且不留只写不读的死变量');
  ok(pickBody.includes("input.accept = ('accept' in o) ? String(o.accept == null ? '' : o.accept) : (input.accept || '');") && pickBody.includes("if (typeof o.multiple === 'boolean') input.multiple = o.multiple;") && !pickBody.includes("input.accept = (o.accept != null && o.accept !== '')"),
    'S8 常驻 input 的 accept/multiple＝判据换成**本次提没提这一项**（#1230e 原意保住：裸登记／预建宿主不带 accept＝保留入口先设好的口径；#1413 补另一半：入口**有意**传空串＝真清空，不再把上一个分类留下的 image/* 粘到这一档上——字卡库语音档实测吃过这个亏）');
  ok(pickBody.includes("if (typeof o.onFiles === 'function') input.__mochiOnFiles = o.onFiles;") && pickBody.includes('if (input.__mochiOnFiles)'),
    'S9 回调改成粘性登记：只有本次真给了 onFiles 才覆盖，且 onchange 走它——预建宿主那次裸调用不再把前一入口的管线写没');
  ok(pickBody.includes('if (window.mochiFilePickSurfaceAll && typeof o.onFiles === ') && !pickBody.includes('if (o.btn && window.mochiFilePickSurfaceAll'),
    'S10 给同宿主各层补登记管线**不再要求调用方传 btn**（聊天壁纸面板/抽屉正是不传 btn、只按 id 登记宿主的入口）');
  ok(dev.includes('window.mochiFilePickBindHost = function (id, btn) {') && dev.includes('noClick: true'),
    'S11 预建宿主复用统一入口同一实现（noClick 绝不激活选择器）＝样式/单例/accept 口径不会和入口分叉');
  ok(surfBody.includes('window.mochiFilePickBindHost(o.owner, btn)') && surfBody.includes('if (preHost && !rec.owner) rec.owner = preHost;'),
    'S12 铺层顺序＝先登记 id → 预建宿主 → 回头补解析（反了＝选完文件「无管线可交」＝图片被静默丢掉）');
  ok(surfBody.includes("'surf:hit'") && surfBody.includes("'surf:files='") && surfBody.includes("'surf:nopipe'"),
    'S13 原生腿也有回执（弹没弹／文件回没回来／回来却没管线）——前十波只记程序化腿，每轮都在猜');
  ok(!/userAgent|navigator\.platform|iPhone|iPad/.test(fbBody + fireBody),
    'S14 本波新增两段里没有任何机型／UA 判断（红线：判据只能是时序／几何／渲染状态）');
}

// ================= 内核模型 + 起页 =================
async function boot() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const st = { chooser: 0, jsErrors: [], fixture: null, target: null };
  page.on('filechooser', async (fc) => {
    st.chooser++;
    if (!st.fixture) return; // 不投递＝保持打开（只测「有没有弹」）
    try { await fc.setFiles({ name: st.fixture.name, mimeType: st.fixture.mime, buffer: Buffer.isBuffer(st.fixture.body) ? st.fixture.body : Buffer.from(st.fixture.body, 'utf8') }); }
    catch (e) { st.jsErrors.push('setFiles:' + String(e.message || e)); }
  });
  page.on('pageerror', (e) => st.jsErrors.push(String(e.message).slice(0, 200)));
  await page.addInitScript(() => {
    try { localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now())); } catch (e) {}
    // ---- 内核模型（独立实现）：真渲染 + 手势落点命中 ⇒ 放行原生动作，否则静默不弹 ----
    window.__labTap = { x: 0, y: 0, t: 0 };
    document.addEventListener('pointerdown', function (e) {
      try { if (typeof e.clientX === 'number') window.__labTap = { x: e.clientX, y: e.clientY, t: Date.now() }; } catch (x) {}
    }, { capture: true, passive: true });
    window.__labRendered = function (el) {
      try {
        if (!el || !el.isConnected) return false;
        if (!el.getClientRects || el.getClientRects().length === 0) return false;
        var cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        var r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        if (cs.clipPath && cs.clipPath !== 'none') return false;
        if (cs.clip && cs.clip.indexOf('0px 0px 0px 0px') >= 0) return false;
        return true;
      } catch (e) { return false; }
    };
    window.__labHits = function (el) {
      try {
        var t = window.__labTap;
        if (!t || Date.now() - t.t > 1500) return false;
        var under = document.elementFromPoint(t.x, t.y);
        if (!under) return false;
        return under === el || el.contains(under) || !!(under.contains && under.contains(el));
      } catch (e) { return false; }
    };
    window.__labAllowed = function (el) { return window.__labRendered(el) && window.__labHits(el); };
    const rawClick = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function () {
      try {
        if (this && this.tagName === 'INPUT' && this.type === 'file') {
          if (!window.__labAllowed(this)) return; // 静默拒绝：不抛异常、不弹窗（＝用户看到的「没反应」）
          return rawClick.apply(this, arguments);
        }
      } catch (e) {}
      return rawClick.apply(this, arguments);
    };
    const rawPick = HTMLInputElement.prototype.showPicker;
    HTMLInputElement.prototype.showPicker = function () {
      try {
        if (this && this.type === 'file' && !window.__labAllowed(this)) throw new Error('NotAllowedError');
      } catch (e) { if (e && e.message === 'NotAllowedError') throw e; }
      return rawPick.apply(this, arguments);
    };
    // ---- 内核模型到此为止（产品代码不参与模型判定，避免拿修复证修复）----
  });
  await page.goto(baseUrl + '/index.html');
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 25000 }).catch(() => {});
  await page.evaluate(() => {
    const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
    const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; s.style.display = 'none'; }
    const q = document.getElementById('qa-mask'); if (q) { q.style.setProperty('display', 'none', 'important'); q.hidden = true; }
  });
  await page.waitForTimeout(900);
  return { browser, page, st };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 造实验场：一个普通按钮（点它＝走程序化腿，因为手指不在任何铺层上）＋同坐标处另一个按钮（测「吃点击」）
async function makeLab(page) {
  await page.evaluate(() => {
    const old = document.getElementById('lab-1230-root'); if (old) old.remove();
    const box = document.createElement('div');
    box.id = 'lab-1230-root';
    box.style.cssText = 'position:fixed;left:40px;top:300px;width:300px;height:120px;z-index:2147483000;background:rgba(0,0,0,.02);';
    box.innerHTML = '<button id="lab-btn" style="position:absolute;left:20px;top:20px;width:180px;height:48px">选文件</button>'
      + '<button id="lab-under" style="position:absolute;left:20px;top:20px;width:180px;height:48px;visibility:hidden">同坐标另一个控件</button>';
    document.body.appendChild(box);
    window.__labHitsCount = { btn: 0, under: 0 };
    document.getElementById('lab-btn').addEventListener('click', () => {
      window.__labHitsCount.btn++;
      window.mochiFilePick({
        id: 'lab-1230-host', accept: 'image/*', multiple: true,
        onFiles: (fs) => { window.__labGot = (window.__labGot || []).concat([fs.length + ':' + (fs[0] ? fs[0].name : '-')]); }
      });
    });
    document.getElementById('lab-under').addEventListener('click', () => { window.__labHitsCount.under++; });
  });
  await sleep(150);
}
async function tapBox(page, st, sel) {
  const geo = await page.evaluate((s) => {
    const b = document.querySelector(s); if (!b) return { err: 'no-el' };
    const r = b.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  }, sel);
  if (geo.err) return geo;
  st.chooser = 0;
  await page.mouse.click(geo.cx, geo.cy);
  await sleep(750);
  geo.chooser = st.chooser;
  return geo;
}
const ev = (page, expr) => page.evaluate(expr);
const pickLog = (page) => ev(page, "JSON.stringify((window.__mochiPickLog||[]).map(function(x){return String(x.s);}))");

const { browser, page, st } = await boot();

// ================= B1 主案：手指没落在铺层上＝本波修的那一下 =================
await makeLab(page);
{
  st.fixture = { name: 'lab-wallpaper.png', mime: 'image/png', body: 'LABPNG' };
  const g = await tapBox(page, st, '#lab-btn');
  const got = await ev(page, "JSON.stringify(window.__labGot||[])");
  const log = await pickLog(page);
  ok(g.chooser === 1,
    'B1a 顽固内核（sr-only clip 常驻 input ＋ 手势落点不在它身上）下点按钮：选择器恰弹 1 次——修前＝0 次，用户看到的「点了没反应」', JSON.stringify(g) + ' log=' + log);
  ok(got === '["1:lab-wallpaper.png"]', 'B1b 搬层选来的文件真的转交回**原 input 原有管线**（onFiles 收到，名字对）', got);
  ok(log.includes('fb:onscreen'), 'B1c 取证能分清这条腿（fb:onscreen）——下次真机报障直接看得出走的哪条路', log);
  ok(log.includes('leg:fire'), 'B1d 原程序化腿的取证行仍在（本波不剥旧观测）', log);
  // 不双开＝chooser 恰 1（B1a 已含）；再点一次仍可重选
  const g2 = await tapBox(page, st, '#lab-btn');
  ok(g2.chooser === 1, 'B1e 同一入口再点一次仍弹 1 次（value 已清＝允许重选同一文件，且不残留第二层）', JSON.stringify(g2));
  // 搬层那格的几何：必须真渲染（模型放行它正是因为它被渲染）、且盖住手指那一格
  const geo = await ev(page, `(function(){
    var o=document.getElementById('mochi-file-pick-fallback'); if(!o) return 'no-overlay';
    var r=o.getBoundingClientRect(), cs=getComputedStyle(o), t=window.__mochiLastTap;
    return JSON.stringify({w:Math.round(r.width),h:Math.round(r.height),
      covers:(t.x>=r.left&&t.x<=r.right&&t.y>=r.top&&t.y<=r.bottom),
      rendered: r.width>=2&&r.height>=2&&cs.display!=='none'&&cs.visibility!=='hidden'&&(!cs.clipPath||cs.clipPath==='none'),
      single: document.querySelectorAll('#mochi-file-pick-fallback').length,
      inFront: o.style.zIndex});
  })()`);
  const gj = String(geo).startsWith('{') ? JSON.parse(geo) : {};
  ok(gj.rendered === true && gj.covers === true && gj.single === 1,
    'B1f 搬过去那层真渲染、单例、且几何盖住手指落点（＝内核愿意为它弹选择器的那个前提；修前那三条腿激活的是 sr-only clip 元素）', geo);
}

// ================= B2 控制组：没有手指落点＝一律不搬（与改前逐字相同） =================
{
  await ev(page, "window.__mochiLastTap && (window.__mochiLastTap.t = 0); window.__labTap && (window.__labTap.t = 0); 1");
  const before = await pickLog(page);
  st.chooser = 0;
  st.fixture = { name: 'no-gesture.png', mime: 'image/png', body: 'X' };
  await ev(page, "window.mochiFilePick({id:'lab-1230-host', accept:'image/*', multiple:true, onFiles:(fs)=>{window.__labNoGesture=(fs||[]).length;}}); 1");
  await sleep(500);
  const chooser = st.chooser;
  const log = await pickLog(page);
  ok(chooser === 0 && !log.slice(before.length).includes('fb:onscreen'),
    'B2 程序化触发（无同手势落点）＝**不搬层**、照原三腿走：不弹也不报错，与改前逐字相同（键盘/脚本路径零行为变化）', 'chooser=' + chooser + ' new=' + log.slice(before.length));
}

// ================= B3 搬层不吃掉用户的下一次点击（对照组：两侧都该绿） =================
{
  await makeLab(page);
  st.fixture = { name: 'lab-wallpaper.png', mime: 'image/png', body: 'LABPNG' };
  const t1 = await tapBox(page, st, '#lab-btn'); // 这一下把 overlay 开在落点上
  const cnt = await ev(page, "JSON.stringify(window.__labHitsCount)");
  // 把「同坐标另一个控件」显形，然后点同一格：overlay 必须已经在这一下手势结束时收窗
  await ev(page, "document.getElementById('lab-under').style.visibility='visible'; 1");
  st.fixture = null;
  await tapBox(page, st, '#lab-under');
  const after = await ev(page, "JSON.stringify(window.__labHitsCount)");
  const hit = await ev(page, `(function(){
    var o=document.getElementById('mochi-file-pick-fallback'); if(!o) return 'no-overlay';
    var t=window.__mochiLastTap, under=document.elementFromPoint(t.x,t.y);
    return JSON.stringify({pe:getComputedStyle(o).pointerEvents, front: under===o? 'overlay' : (under&&under.id? under.id : String(under&&under.tagName))});
  })()`);
  const a = JSON.parse(after), b = JSON.parse(cnt);
  ok(a.under === b.under + 1, 'B3a 下一次点按落到**同坐标的另一个控件**上（旧落点上那块透明区没把它吃掉）', cnt + ' -> ' + after);
  const hj = String(hit).startsWith('{') ? JSON.parse(hit) : { pe: hit, front: '' };
  ok(hj.pe === 'none' && hj.front !== 'overlay',
    'B3b 手势一结束就收窗（pointer-events 回 none，命中交回页面）＝收窗不靠「下一次点按」，搬层不会截走后续点击', hit);
}

// ================= B4 壁纸那一类入口：宿主登记成 id、而统一入口 input 还不存在 =================
{
  const r = await ev(page, `(function(){
    var b=document.createElement('button'); b.id='lab-surf-btn'; b.textContent='铺层入口';
    b.style.cssText='position:fixed;left:40px;top:460px;width:200px;height:48px;z-index:2147483000';
    document.body.appendChild(b);
    var hostId='lab-host-'+Date.now();
    window.__surfOnFiles=0;
    var layer=window.mochiFilePickSurface(b,{id:'lab-surf-1230', accept:'image/*', multiple:true, owner:hostId});
    var rec=layer?layer.__mochiSurface:null;
    var host=document.getElementById(hostId);
    return JSON.stringify({layer:!!layer, ownerIsEl:!!(rec&&rec.owner&&rec.owner.nodeType===1),
      ownerIsString:!!(rec&&typeof rec.owner==='string'), hostExists:!!host, hostId:rec?rec.ownerId:'',
      layerAccept:layer?layer.accept:'-', layerMultiple:layer?String(!!layer.multiple):'-',
      hostIdMatch: !!(host && rec && rec.ownerId === host.id)});
  })()`);
  const j = JSON.parse(r);
  ok(j.layer === true && j.ownerIsEl === true && j.hostExists === true,
    'B4a 铺层这一拍就按 id 预建宿主并**回头解析成元素**（修前：宿主登记成字符串／解析成 null＝选完文件两路皆空＝图片静默丢掉）', r);
  ok(j.layerAccept === 'image/*' && j.layerMultiple === 'true' && j.hostIdMatch === true,
    'B4b 铺层自带 accept/multiple（#753 判据），且预建的宿主与登记的 id 是同一个（不出现「层指向 A、管线建在 B」）', r);
  // 原生腿选完文件 → 转交宿主 → 宿主管线（模拟：给层塞文件并派发 change）
  const pipe = await ev(page, `(function(){
    var layer=document.getElementById('lab-surf-1230'); if(!layer) return 'no-layer';
    var host=layer.__mochiSurface && layer.__mochiSurface.owner; if(!host) return 'no-owner';
    // 激活一次把管线登记到该层（＝入口按钮被点到时产品自己做的事）
    window.mochiFilePick({id:host.id, accept:'image/*', multiple:true, noClick:true, onFiles:(fs)=>{window.__surfGot=fs.length+':'+(fs[0]&&fs[0].name);}});
    try{ var dt=new DataTransfer(); dt.items.add(new File(['PNGDATA'],'bg-wallpaper.png',{type:'image/png'})); layer.files=dt.files; }catch(e){ return 'files-set:'+e.message; }
    try{ layer.onchange && layer.onchange(); }catch(e){ return 'onchange:'+e.message; }
    return JSON.stringify({got:window.__surfGot||'', log:(window.__mochiPickLog||[]).map(function(x){return String(x.s);}).join(',')});
  })()`);
  const p = String(pipe).startsWith('{') ? JSON.parse(pipe) : { got: '', log: String(pipe) };
  ok(String(p.got).indexOf('bg-wallpaper.png') >= 0 && String(p.log).indexOf('surf:files=1') >= 0,
    'B4c 原生层选来的文件经宿主转交进了管线，且取证留得下「弹了、文件回来了」这一格（修前只能记 leg:fire）', String(pipe).slice(0, 160));
  ok(String(p.log).indexOf('surf:nopipe') === -1,
    'B4d 不再出现「选择器弹了、文件回来了、却没有管线可交」的形态', String(p.log).slice(0, 160));
  await ev(page, "(function(){var b=document.getElementById('lab-surf-btn');if(b)b.remove();var l=document.getElementById('lab-surf-1230');if(l)l.remove();return 1;})()");
}

// ================= B5 裸登记不抹既有口径（常驻 input 被多入口复用） =================
{
  const r = await ev(page, `(function(){
    var a=window.mochiFilePick({id:'lab-keep-1230', accept:'.json,application/json', multiple:false, noClick:true, onFiles:(fs)=>{window.__keepGot=(fs||[]).length;}});
    if(!a) return 'no-input';
    // 第二次＝预建宿主那类裸登记（不带 accept/multiple/onFiles）
    var b=window.mochiFilePick({id:'lab-keep-1230', noClick:true});
    var same=(a===b);
    // 走一次原有管线：塞文件并派发 change
    try{ var dt=new DataTransfer(); dt.items.add(new File(['{}'],'cards.json',{type:'application/json'})); b.files=dt.files; }catch(e){ return 'files:'+e.message; }
    b.onchange && b.onchange();
    return JSON.stringify({same:same, accept:b.accept, got:window.__keepGot===undefined?'lost':window.__keepGot});
  })()`);
  const j = String(r).startsWith('{') ? JSON.parse(r) : {};
  ok(j.same === true && j.accept === '.json,application/json',
    'B5a 裸登记（不带 accept 的复用调用）不再把入口先设好的 accept 抹成空——#753「accept 必须落在任何激活之前」的口径不被本波写坏', String(r).slice(0, 160));
  ok(j.got === 1,
    'B5b 裸登记不再把前一入口的回调写没（修后＝只本次真给了回调才覆盖）：文件仍回到原管线', String(r).slice(0, 160));
}

// ================= B6 真入口端到端：聊天壁纸「＋ 上传新图」在「铺层被搬位」那一拍 =================
// 用户报的正是这条链（docx 里 6 笔全打在 dev-cs-bg-pick 上）。这里把 #991 那层物理挪走＝复现「层被
// 重渲染搬位／被别的样式覆盖」这一族复发形状：手指只剩在普通按钮上 ⇒ 走的必须是程序化腿。
{
  await page.evaluate(() => {
    document.querySelectorAll('.page').forEach((p) => { p.hidden = (p.id !== 'page-chat-settings'); });
    const t = document.querySelector('#cs-tabs .them-tab[data-tab="beautify"]'); if (t) t.click();
    const g = document.getElementById('daily-greet'); if (g) { g.hidden = true; clearTimeout(g._timer); }
    const m = document.getElementById('modal-mask'); if (m) m.hidden = true;
    const q = document.getElementById('qa-mask'); if (q) { q.style.setProperty('display', 'none', 'important'); q.hidden = true; }
  });
  await sleep(600);
  const opened = await tapBox(page, st, '#cs-bg-upload');
  const panel = await ev(page, "(function(){var p=document.getElementById('cs-bg-panel');var bs=p?p.querySelectorAll('button'):[],has=false;for(var i=0;i<bs.length;i++)if((bs[i].textContent||'').indexOf('上传新图')>=0)has=true;return JSON.stringify({exists:!!p,hasBtn:has});})()");
  const pj = JSON.parse(panel);
  ok(opened.chooser === 0 && pj.exists === true && pj.hasBtn === true,
    'B6a 状态前置：聊天壁纸「上传」行只开面板、不直接弹选择器（面板与「＋ 上传新图」都在＝后面的点按测的是真入口）', JSON.stringify(opened) + ' panel=' + panel);
  // 把层搬走（模型＝铺层失效），再物理点按面板里的「＋ 上传新图」按钮本体
  await ev(page, `(function(){
    var l=document.getElementById('cs-bg-up-tap'); if(l){ l.style.position='fixed'; l.style.left='-9999px'; l.style.top='-9999px'; }
    var p=document.getElementById('cs-bg-panel'), bs=p?p.querySelectorAll('button'):[];
    for(var i=0;i<bs.length;i++){ if((bs[i].textContent||'').indexOf('上传新图')>=0){ bs[i].id='lab-wp-btn'; bs[i].scrollIntoView({block:'center'}); return 1; } }
    return 0;
  })()`);
  await sleep(400);
  const before = await ev(page, "Object.keys(localStorage).filter(function(k){return /cs-bg/.test(k);}).length");
  const logBefore = await pickLog(page);
  st.fixture = { name: 'wp.png', mime: 'image/png', body: PNG_B64 };
  const w = await tapBox(page, st, '#lab-wp-btn');
  await sleep(2600);
  const after = await ev(page, "Object.keys(localStorage).filter(function(k){return /cs-bg/.test(k);}).length");
  const log = await pickLog(page);
  ok(w.chooser === 1, 'B6b 真入口·铺层失效那一拍：点「＋ 上传新图」选择器恰弹 1 次（修前＝0 次＝用户实报的「没反应」）', JSON.stringify(w));
  ok(Number(after) > Number(before), 'B6c 选来的图真的落库（不是「弹了但图被丢弃」；壁纸那条管线一字未改）', 'cs-bg 键数 ' + before + ' -> ' + after);
  ok(log !== logBefore && log.includes('fb:onscreen') && log.includes('files=1'),
    'B6d 取证能读出这条链走的是搬层腿且文件回到了宿主管线（fb:onscreen＋files=1）', log.slice(-90));
  st.fixture = null;
}

// ================= Z 段：零 JS 异常 =================
ok(st.jsErrors.length === 0, 'Z1 全流程零 JS 异常（防修过头）', st.jsErrors.join(' | ').slice(0, 200));

await browser.close();
server.close();
console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
