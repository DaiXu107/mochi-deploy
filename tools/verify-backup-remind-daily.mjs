// ===== 回归验证：#900 每日备份提醒「从来没弹过」根治 + 人话警示 + 醒目配色 =====
// 报障（用户直派）：「每天的备份提醒没有触发；并且没有写人话提醒：关于数据被清空的问题，
// 不管你是什么浏览器、什么手机，都会自动清除数据，就是设备限制，要备份使用；人话提醒颜色要显眼」。
// 根因（无头取证）：
//   ① 时机：提醒只在「数据就绪」那一刻试一次，而那一刻开屏（#splash z-999）必然还在——
//      弹窗 .modal-mask(z-90) 在 .phone 内（开屏期间整棵 visibility:hidden）、顶条 z-998 也在
//      开屏之下 ⇒ 弹在看不见的地方，旧版却照样写 __last-backup-remind 冷却 ⇒ 当天再也不会第二次弹；
//      期间任何复用同一个 #modal-mask 的弹窗（打卡/引导/字卡锁…）还会把这张隐形弹窗顶掉＝彻底看不见。
//   ② 冷却按「距今满 24 小时」算：每天比前一天早一秒打开就永远凑不满 24h（提醒无限往后漂）。
//   ③ 只在页面装载时判一次：PWA + 后台保活让应用常驻数天不刷新 ⇒「每天」根本不会有第二次。
// 修复（零机型分支）：
//   splashGone() 闸门（开屏没关就不试、也不写冷却）+ 冷却改按自然日 dayKey 比较 +
//   前 10 分钟每 2s、之后每 60s 的复查时间线 + visibilitychange 回到前台即补一次 +
//   只有真渲染出来（弹窗返回 'ok'／顶条 getClientRects>0）才写冷却 +
//   文案改大白话（任何手机/浏览器都会自动清数据＝设备限制，只能靠定期导出备份）+
//   顶条红橙渐变醒目配色（#backup-remind-bar）+ 弹窗警示形态（openModal opts.warn → .modal--warn）。
// 用法：node tools/verify-backup-remind-daily.mjs
//       SRCDIR=<src目录> node tools/verify-backup-remind-daily.mjs   # 红绿对照（对纯 HEAD 源应红）
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const srcDir = process.env.SRCDIR ? normalize(process.env.SRCDIR) : join(root, 'src');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}

// ---- S 组：源码逻辑锚（不依赖浏览器，红绿对照时对纯 HEAD 源应红） ----
const pwaSrc = readFileSync(join(srcDir, 'js', 'pwa.js'), 'utf8');
const cssSrc = readFileSync(join(srcDir, 'css', 'base.css'), 'utf8');
const persSrc = readFileSync(join(srcDir, 'js', 'personalize.js'), 'utf8');
const darkSrc = readFileSync(join(srcDir, 'css', 'dark.css'), 'utf8');
console.log('S 源码锚');
ok('S1 开屏未关时不弹（splashGone 闸门参与判定）', /if \(!splashGone\(\)\) return;/.test(pwaSrc));
ok('S2 冷却按自然日比较（不是「距今满 24 小时」）', /dayKey\(lastRemind\) === dayKey\(Date\.now\(\)\)/.test(pwaSrc) && !/Date\.now\(\) - lastRemind < INTERVAL/.test(pwaSrc));
ok('S3 常驻复查时间线（每 60s + 回到前台补一次）', /setInterval\(function \(\) \{ try \{ tryShow\(\); \} catch \(e\) \{\} \}, 60000\);/.test(pwaSrc) && /'visibilitychange'/.test(pwaSrc));
ok('S4 只有真渲染出来才写冷却（弹窗 ok／顶条有矩形；busy 让路不写）', /if \(r === 'ok'\) \{ markReminded\(\); return; \}/.test(pwaSrc) && /if \(r === 'busy'\) return;/.test(pwaSrc) && /return bar\.getClientRects\(\)\.length > 0;/.test(pwaSrc));
ok('S5 人话文案在位（设备限制 · 自动清空 · 定期导出）', /自动清除网页存的数据/.test(pwaSrc) && /这是设备本身的限制/.test(pwaSrc) && /必须定期导出备份/.test(pwaSrc));
ok('S6 顶条文案也讲人话（旧「建议导出数据备份」口径已换）', /手机和浏览器都会自动清空数据/.test(pwaSrc));
ok('S7 顶条醒目配色（红橙渐变钉在 #backup-remind-bar，不污染其它顶条）', /#backup-remind-bar \{[^}]*linear-gradient\(90deg,#e8382c/.test(cssSrc));
ok('S8 弹窗警示形态 CSS 在位（.modal--warn 红描边/红标题/红底说明）', /\.modal\.modal--warn \{/.test(cssSrc) && /\.modal\.modal--warn \.modal-title/.test(cssSrc) && /\.modal\.modal--warn \.modal-static/.test(cssSrc));
ok('S9 openModal 支持 opts.warn（每次开弹窗重设类＝天然复位）', /classList\.toggle\('modal--warn', !!opts\.warn\)/.test(persSrc));
ok('S10 备份弹窗按 warn 形态调用（并开 staticEmph＝重点单独上色）', /big: true, warn: true, staticEmph: true, pillSubmit: true/.test(pwaSrc));
// 用户跟进①「标的不同颜色吧」→ 只给底色不够；用户跟进②「文字全都变成红色了」→ 整块染红＝满屏皆重点。
// 口径＝正文普通色，只有 **…** 圈出的 .modal-static-key 红；S11~S15 钉这一对边界。
ok('S11 重点片段染红（.modal-static-key）+ 左侧红竖条标注在位', /\.modal\.modal--warn \.modal-static \.modal-static-key \{ color:#c92a1f/.test(cssSrc) && /border-left:4px solid #e8382c/.test(cssSrc));
ok('S12 深色主题把重点片段提亮成亮红（扁平选择器，禁原生嵌套）', /\[data-theme="dark"\] \.modal\.modal--warn \.modal-static \.modal-static-key \{ color:#ff8a7a;/.test(darkSrc));
{
  const warnBlock = /\.modal\.modal--warn \.modal-static \{([^}]*)\}/.exec(cssSrc);
  ok('S13 说明块本体不再带 color（正文整块染红＝用户报的「全都变红」，不得回流）', !!warnBlock && !/[^-]color:/.test(warnBlock[1] + ';'), warnBlock ? warnBlock[1].trim() : '规则不见');
}
ok('S14 重点只走 textContent 挂载（** 拆分 → <b class=modal-static-key>，调用方文本永不被当 HTML）',
  /const segs = String\(opts\.staticText \|\| ''\)\.split\('\*\*'\);/.test(persSrc) && /key\.className = 'modal-static-key';\s*\n\s*key\.textContent = segs\[i\];/.test(persSrc));
{
  const marks = (pwaSrc.match(/\*\*[^*]+\*\*/g) || []);
  ok('S15 文案里恰好三处重点被圈（少＝重点没标，多＝又回到满屏皆红）', marks.length === 3 && /自动清除网页存的数据/.test(marks.join('|')) && /必须定期导出备份/.test(marks.join('|')), marks.map((m) => m.slice(2, -2)).join(' / '));
}

// ---- 测试专用组装：按 build.mjs 同顺序拼临时 index.html（不碰仓库产物） ----
const buildSrc = readFileSync(join(process.env.SRCDIR ? normalize(process.env.SRCDIR + '/..') : root, 'build.mjs'), 'utf8');
const grab = (name) => JSON.parse(buildSrc.match(new RegExp('const ' + name + " = (\\[[^\\]]*\\])"))[1].replace(/'/g, '"'));
const cssFiles = grab('cssFiles'), jsFiles = grab('jsFiles');
let html = readFileSync(join(srcDir, 'template.html'), 'utf8');
html = html.replace('/*__STYLES__*/', () => cssFiles.map((f) => readFileSync(join(srcDir, 'css', f), 'utf8')).join('\n'));
html = html.replace('/*__SCRIPTS__*/', () => jsFiles.map((f) => '(function(){ try {\n' + readFileSync(join(srcDir, 'js', f), 'utf8') + '\n} catch(e){ console.error("[JS]", e && e.message); } })();').join('\n'));
html = html.split('__BUILD_INFO__').join('verify-900').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-verify-900-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), html);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(tmpRoot, rel)), hit = false;
    try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) { p = normalize(join(root, rel)); try { hit = statSync(p).isFile(); } catch (e) {} }
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true });
const pageErrors = [];

/**
 * 起一个会话。opts.keys＝额外预置键；opts.noModal＝把 openModal 摘掉（逼出顶条兜底形态）。
 * 其余干扰项（打卡/来电/查岗/应用锁/夜间）全部关掉，把变量收窄到备份提醒本身。
 */
async function boot(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const errsLocal = [];
  ctx.on('page', (p) => { p.on('pageerror', (e) => errsLocal.push(String(e && e.message).slice(0, 160))); });
  await ctx.addInitScript(([o]) => {
    if (!/^https?:/.test(location.href)) return; // about:blank 上无 localStorage 权限（环境噪声）
    const G = 'xy-home-v2:';
    localStorage.setItem(G + 'contacts', JSON.stringify([{ id: 'default', name: '小美' }]));
    localStorage.setItem(G + 'active-contact', 'default');
    localStorage.setItem(G + 'migrated-v1', '1');
    localStorage.setItem(G + 'applock-en', '0');
    localStorage.setItem(G + 'applock-qa-en', '0');
    localStorage.setItem(G + 'desk-checkin-en', '0');
    localStorage.setItem(G + 'desk-call-en', '0');
    localStorage.setItem(G + 'psync-en', '0');
    localStorage.setItem(G + 'bg-notify', '0');
    // 关掉「其他互动功能字卡」总开关：ta-ask 的「回答TA的询问」等弹窗共用全站唯一
    // #modal-mask，会在时间轴里把备份提醒弹窗顶掉＝假红（同 verify-call-busy-gate 收窄变量口径）
    localStorage.setItem(G + 'default:dcf-enabled', '0');
    // 5 天前做过一次完整备份、今天还没提醒过 ⇒ 该弹每日备份提醒
    localStorage.setItem(G + '__last-backup', String(Date.now() - 5 * 86400000));
    for (const k in (o.keys || {})) {
      const v = o.keys[k];
      if (v === null) localStorage.removeItem(G + k); else localStorage.setItem(G + k, String(v));
    }
    if (o.noModal) {
      const iv = setInterval(function () { try { window.openModal = undefined; } catch (e) {} }, 50);
      setTimeout(function () { clearInterval(iv); }, 8000);
    }
    if (o.stealModal) {
      // 现场复刻「别的弹窗先占住全站唯一 #modal-mask」（打卡/引导/字卡锁同形态）
      const steal = function () {
        const m = document.getElementById('modal-mask');
        if (!m) return false;
        m.hidden = false; m.dataset.steal = '1';
        return true;
      };
      if (!steal()) {
        const iv = setInterval(function () { if (steal()) clearInterval(iv); }, 16);
        setTimeout(function () { clearInterval(iv); }, 8000);
      }
    }
  }, [opts]);
  const page = await ctx.newPage();
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  page.setDefaultTimeout(30000);
  return {
    ctx, page, errsLocal,
    async close() { pageErrors.push(...errsLocal); try { await ctx.close(); } catch (e) {} },
    snap: () => page.evaluate(() => {
      const vis = (el) => !!(el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().height > 8);
      // 颜色取证（与机型/内核无关，只读计算样式）：归一化 → 沿父链合成实际底色 → WCAG 对比度
      const toRgb = (v) => {
        const s = String(v || '').trim();
        const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
        if (h) { const x = h[1].length === 3 ? h[1].split('').map((c) => c + c).join('') : h[1]; return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16), 1]; }
        const m = /rgba?\(([^)]+)\)/i.exec(s);
        if (!m) return null;
        const p = m[1].split(/[,\s/]+/).filter((x) => x !== '').map(parseFloat);
        return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
      };
      const effBg = (el) => {
        const ov = []; let n = el;
        while (n && n.nodeType === 1) {
          const c = toRgb(getComputedStyle(n).backgroundColor);
          if (c && c[3] >= 0.999) { let base = c.slice(0, 3); for (let i = ov.length - 1; i >= 0; i--) { const o = ov[i]; base = [0, 1, 2].map((k) => base[k] * (1 - o[3]) + o[k] * o[3]); } return base; }
          if (c && c[3] > 0.001) ov.push(c);
          n = n.parentElement;
        }
        let base = [255, 255, 255];
        for (let i = ov.length - 1; i >= 0; i--) { const o = ov[i]; base = [0, 1, 2].map((k) => base[k] * (1 - o[3]) + o[k] * o[3]); }
        return base;
      };
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const ratio = (a, b) => { if (!a || !b) return -1; const l1 = lum(a), l2 = lum(b); return +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2)); };
      const dist = (a, b) => (!a || !b ? -1 : Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])));
      const s = document.getElementById('splash');
      const mask = document.getElementById('modal-mask');
      const box = mask ? mask.querySelector('.modal') : null;
      const stat = document.getElementById('modal-static');
      const bar = document.getElementById('backup-remind-bar');
      const title = document.getElementById('modal-title');
      const ink = toRgb(getComputedStyle(document.documentElement).getPropertyValue('--ink'));
      const statRgb = stat ? toRgb(getComputedStyle(stat).color) : null;
      const keys = stat ? Array.prototype.slice.call(stat.querySelectorAll('.modal-static-key')) : [];
      const keyRgb = keys.length ? toRgb(getComputedStyle(keys[0]).color) : null;
      const keyLen = keys.reduce((n, k) => n + String(k.textContent || '').length, 0);
      const statLen = stat ? String(stat.textContent || '').length : 0;
      return {
        dataReady: !!window.__mochiDataReady,
        splashUp: !!s && s.isConnected && !s.classList.contains('hide'),
        maskVisible: vis(mask) && !!box && vis(box),
        ourModal: !!(vis(mask) && box && vis(box) && /数据会被自动清空/.test(title ? title.textContent : '')),
        title: title ? title.textContent : '',
        staticText: stat && !stat.hidden ? String(stat.textContent || '') : '',
        warnClass: !!(box && box.classList.contains('modal--warn')),
        titleColor: box ? getComputedStyle(box.querySelector('.modal-title')).color : '',
        staticColor: stat ? getComputedStyle(stat).color : '',
        // 正文本体＝普通说明色（用户反馈「整块都红了」＝这一项一旦偏离 --ink 就是过度染色）
        staticVsInk: dist(statRgb, ink),
        staticContrast: stat ? ratio(statRgb, effBg(stat)) : -1,
        inkContrast: stat ? ratio(ink, effBg(stat)) : -1,
        // 重点片段（**…**）才是被标红的部分
        keyCount: keys.length,
        keyColor: keys.length ? getComputedStyle(keys[0]).color : '',
        keyVsInk: dist(keyRgb, ink),
        keyContrast: keys.length ? ratio(keyRgb, effBg(keys[0])) : -1,
        redShare: statLen ? +(keyLen / statLen).toFixed(3) : 0,
        staticAccent: stat ? (getComputedStyle(stat).borderLeftWidth + ' ' + getComputedStyle(stat).borderLeftStyle + ' ' + getComputedStyle(stat).borderLeftColor) : '',
        theme: document.documentElement.getAttribute('data-theme') || 'light',
        barVisible: vis(bar),
        barText: bar ? String((document.getElementById('backup-remind-txt') || {}).textContent || '') : '',
        barBg: bar ? String(getComputedStyle(bar).backgroundImage || '') + '|' + String(getComputedStyle(bar).backgroundColor) : '',
        barTxtColor: bar ? getComputedStyle(document.getElementById('backup-remind-txt')).color : '',
        remind: localStorage.getItem('xy-home-v2:__last-backup-remind'),
        backup: localStorage.getItem('xy-home-v2:__last-backup')
      };
    }),
    // 真实进入形态：clock.js finishEnter 给 splash 加 .hide（400ms 后移除节点）
    enter: () => page.evaluate(() => {
      const s = document.getElementById('splash');
      if (s) { s.classList.add('hide'); setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 400); }
      return true;
    }),
    wait: async (ms) => { await page.waitForTimeout(ms); },
    waitForSnap: async (pred, ms) => {
      const deadline = Date.now() + (ms || 12000);
      while (Date.now() < deadline) {
        const st = await pred();
        if (st.hit) return st;
        await page.waitForTimeout(400);
      }
      return pred();
    },
    clickPill: (label) => page.evaluate((l) => {
      const bs = Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill'));
      const b = bs.filter((x) => x.textContent.trim() === l)[0];
      if (!b) return false;
      b.click();
      const ok = document.getElementById('modal-ok');
      if (ok) ok.click();
      return true;
    }, label)
  };
}

const DAY = 86400000;
// Node 侧解析页内返回的 getComputedStyle 颜色串（'rgb(r, g, b)' / 'rgba(r, g, b, a)'）
function toRgbArr(v) {
  const m = /rgba?\(([^)]+)\)/i.exec(String(v || ''));
  if (!m) return null;
  const p = m[1].split(/[,\s/]+/).filter((x) => x !== '').map(parseFloat);
  return p.length >= 3 ? [p[0], p[1], p[2]] : null;
}

console.log('\nB1 开屏期间不弹、不烧冷却（旧版＝弹在看不见的地方还写冷却）');
{
  const b = await boot();
  await b.wait(6000);
  const st = await b.snap();
  ok('B1a 开屏仍在时弹窗没弹', st.splashUp && !st.maskVisible, st);
  ok('B1b 开屏仍在时顶条没亮', !st.barVisible);
  ok('B1c 开屏期间没偷写冷却（旧版此处已写＝当天再也不弹）', !st.remind, st);
  await b.close();
}

console.log('\nB2 进入桌面后自动弹出（醒目警示形态 + 人话文案）');
{
  const b = await boot();
  await b.wait(1500);
  await b.enter();
  const r = await b.waitForSnap(async () => { const st = await b.snap(); return { hit: st.ourModal, st }; }, 15000);
  const st = r.st;
  ok('B2a 进入后每日提醒真的弹出来了', st.ourModal, st);
  ok('B2b 标题讲清「数据会被自动清空」', /数据会被自动清空/.test(st.title), st.title);
  ok('B2c 弹窗为警示形态（.modal--warn）且标题红色', st.warnClass && /232, *56, *44/.test(st.titleColor), { w: st.warnClass, c: st.titleColor });
  ok('B2d 说明里写人话：任何手机/浏览器都会自动清数据＝设备限制', /不管用什么手机、什么浏览器/.test(st.staticText) && /设备本身的限制/.test(st.staticText), st.staticText.slice(0, 80));
  ok('B2e 说明里写清对策：必须定期导出备份', /必须定期导出备份/.test(st.staticText));
  ok('B2f 距上次备份天数有落进文案（5 天）', /距上次完整备份已经 5 天/.test(st.staticText), st.staticText.slice(0, 40));
  ok('B2g 弹出后写冷却（今天不再第二次打断）', !!st.remind);
  // 用户跟进①「标的不同颜色」＋跟进②「文字全都变成红色了」＝只标重点：正文普通色、**…** 圈出的才红
  const kr = toRgbArr(st.keyColor);
  ok('B2h 重点片段标了红字（红通道压过绿蓝，且与正文 --ink 明显不同色）',
    !!kr && kr[0] > kr[1] + 60 && kr[0] > kr[2] + 60 && st.keyVsInk >= 60, { c: st.keyColor, vsInk: st.keyVsInk });
  ok('B2i 染了色的重点仍看得清（对比度 ≥4.5:1）', st.keyContrast >= 4.5, { keyContrast: st.keyContrast, inkContrast: st.inkContrast });
  ok('B2j 不只靠颜色传达：左侧 4px 红竖条在位', /^4px solid/.test(st.staticAccent) && /232, *56, *44/.test(st.staticAccent), st.staticAccent);
  ok('B2k 正文本体回到普通说明色（整块染红＝用户报的「全都变红」，不得回流）', st.staticVsInk <= 8, { c: st.staticColor, vsInk: st.staticVsInk });
  ok('B2l 星号不泄漏成文本、且恰好三处重点被解析成节点', !/\*\*/.test(st.staticText) && st.keyCount === 3, { keys: st.keyCount, head: st.staticText.slice(0, 60) });
  ok('B2m 红字只占正文一小部分（≤1/3＝重点真的只是重点）', st.redShare > 0 && st.redShare <= 0.34, { redShare: st.redShare });
  await b.close();
}

console.log('\nB3 当天已提醒过 / 刚备份过 / 空数据＝都不再打断');
{
  const b = await boot({ keys: { '__last-backup-remind': Date.now() } });
  await b.wait(1200); await b.enter(); await b.wait(6000);
  const st = await b.snap();
  ok('B3a 今日已提醒过 ⇒ 不弹', !st.maskVisible && !st.barVisible, st);
  await b.close();
}
{
  // 冷却键＝昨天 23:59（自然日已经过去，但距今不足 24 小时）：按 24h 计时的旧版会把它
  // 一直往后漂（每天早一秒打开就永远凑不满 24 小时＝用户所见「从来没弹过」）
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const b = await boot({ keys: { '__last-backup-remind': startOfToday - 60000, '__last-backup': Date.now() - 30 * DAY } });
  await b.wait(1200); await b.enter();
  const r = await b.waitForSnap(async () => { const st = await b.snap(); return { hit: st.ourModal, st }; }, 12000);
  ok('B3b 昨天 23:59 提醒过、今天照样弹（自然日冷却；旧版按 24h 计时此处永远不弹）', r.st.ourModal, r.st);
  await b.close();
}
{
  const b = await boot({ keys: { '__last-backup': Date.now() - 3600000 } });
  await b.wait(1200); await b.enter(); await b.wait(6000);
  const st = await b.snap();
  ok('B3c 1 小时前刚完整备份过 ⇒ 不打扰', !st.maskVisible && !st.barVisible, st);
  await b.close();
}
{
  const b = await boot({ keys: { '__last-backup': null } });
  await b.wait(1200); await b.enter();
  const r = await b.waitForSnap(async () => { const st = await b.snap(); return { hit: st.ourModal, st }; }, 15000);
  ok('B3d 从没做过完整备份 ⇒ 提醒点名「备份聊天不算完整备份」', /还没做过一次完整的数据备份/.test(r.st.staticText) && /备份聊天/.test(r.st.staticText), r.st.staticText.slice(0, 60));
  await b.close();
}

console.log('\nB4 顶条兜底（弹窗组件不可用时）＝醒目红条 + 人话文案');
{
  const b = await boot({ noModal: true });
  await b.wait(1200); await b.enter();
  const r = await b.waitForSnap(async () => { const st = await b.snap(); return { hit: st.barVisible, st }; }, 14000);
  const st = r.st;
  ok('B4a 弹窗组件不可用时顶条确实亮了', st.barVisible, st);
  ok('B4b 顶条文案是人话（含「自动清空数据」）', /手机和浏览器都会自动清空数据/.test(st.barText), st.barText);
  ok('B4c 顶条配色醒目（红橙渐变底 + 白字）', /linear-gradient/.test(st.barBg) && /255, *255, *255/.test(st.barTxtColor), { bg: st.barBg.slice(0, 60), c: st.barTxtColor });
  ok('B4d 顶条亮起来才写冷却', !!st.remind);
  await b.close();
}

console.log('\nB5 别的弹窗占用全站唯一 #modal-mask ⇒ 让路不硬顶，且不被顶掉后下一轮补弹');
{
  const b = await boot({ stealModal: true });
  await b.wait(1200); await b.enter(); await b.wait(5000);
  const mid = await b.snap();
  ok('B5a 被占用时不写冷却也不亮顶条（旧版会弹完就记当天已提醒）', !mid.remind && !mid.barVisible, mid);
  const freed = await b.page.evaluate(() => { const m = document.getElementById('modal-mask'); if (m) { m.hidden = true; delete m.dataset.steal; } return true; });
  void freed;
  const r = await b.waitForSnap(async () => { const st = await b.snap(); return { hit: st.ourModal, st }; }, 12000);
  ok('B5b 对方关掉后备份提醒自己补上', r.st.ourModal, r.st);
  ok('B5c 补上后备案文案照常是人话警示形态', /数据会被自动清空/.test(r.st.title) && r.st.warnClass, r.st.title);
  await b.close();
}

console.log('\nB6 常驻应用跨天复查（不刷新也能第二天提醒）');
{
  const b = await boot();
  await b.wait(1200); await b.enter();
  const r = await b.waitForSnap(async () => { const st = await b.snap(); return { hit: st.ourModal, st }; }, 15000);
  ok('B6a 首轮弹出并写冷却', r.st.ourModal && !!r.st.remind, r.st);
  // 把冷却键挪到「昨天此刻」＝模拟应用一直开着跨到第二天（常驻不刷新）
  await b.page.evaluate(() => { localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now() - 86400000)); });
  const r2 = await b.waitForSnap(async () => { const st = await b.snap(); return { hit: st.ourModal, st }; }, 90000);
  ok('B6b 跨天后不刷新也会再次提醒（60s 复查时间线）', r2.st.ourModal, r2.st);
  await b.close();
}

console.log('\nB7 点「去备份」仍走原导出链路（提醒本身不改功能）');
{
  const b = await boot();
  await b.wait(1200); await b.enter();
  const r = await b.waitForSnap(async () => { const st = await b.snap(); return { hit: st.ourModal, st }; }, 15000);
  ok('B7a 弹窗里三个操作按钮在位（去备份 / 备份聊天 / 稍后）', await b.page.evaluate(() => {
    const t = Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill')).map((x) => x.textContent.trim()).join(',');
    return /去备份/.test(t) && /备份聊天/.test(t) && /稍后/.test(t);
  }));
  const clicked = await b.clickPill('稍后');
  ok('B7b 「稍后」可点且弹窗收起', clicked);
  await b.wait(4000);
  const st = await b.snap();
  ok('B7c 选稍后后当天不再重复弹', !st.ourModal && !st.barVisible, st);
  await b.close();
}

console.log('\nB8 深色主题下人话正文同样是「被标了不同颜色」（浅色那套深红在深底上看不清）');
{
  const b = await boot();
  await b.wait(1200); await b.enter();
  const r0 = await b.waitForSnap(async () => { const st = await b.snap(); return { hit: st.ourModal, st }; }, 15000);
  ok('B8a 浅色下先弹出（前提成立）', r0.st.ourModal, r0.st);
  await b.page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
  await b.wait(600);
  const st = await b.snap();
  ok('B8b 主题确实切到深色（没被静默复位＝否则下面全是假绿）', st.theme === 'dark' && st.ourModal, { theme: st.theme, up: st.ourModal });
  const dr = toRgbArr(st.keyColor);
  ok('B8c 深色下重点片段提亮成亮红（与深色卡面的普通近白文字明显不同色）',
    !!dr && dr[0] > dr[1] + 60 && dr[0] > dr[2] + 60 && st.keyVsInk >= 60, { c: st.keyColor, vsInk: st.keyVsInk });
  ok('B8d 深色下重点对比度 ≥4.5:1（浅色那套 #c92a1f 在深底上约 2.7:1＝看不见）', st.keyContrast >= 4.5, { contrast: st.keyContrast });
  ok('B8e 深色下标题也提亮成红系（不是浅色的 #e8382c 暗红）', /255, *122, *107/.test(st.titleColor), st.titleColor);
  ok('B8f 深色下正文本体仍是深色普通文字色（没被整块染色）', st.staticVsInk <= 8, { c: st.staticColor, vsInk: st.staticVsInk });
  await b.close();
}

await browser.close();
try { rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
server.close();

console.log('\nZ 未捕获异常');
ok('Z1 全程零未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 6));
console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
