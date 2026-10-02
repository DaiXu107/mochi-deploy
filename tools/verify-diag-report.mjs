// ===== 回归验证：诊断信息「读取中…」截断 / 回填 / 角标 三项修复 =====
// 对应 device.js v3.26.x：软/硬双预算交付（3.5s 首屏 + 12s 终态）、终态前不自动复制、
// 迟到明细回填进可见弹窗正文、__jsErrors 预初始化并成节输出、角标按错误时间戳比较。
// 用法：仓库根目录执行  node tools/verify-diag-report.mjs
//       （临时副本验证：SERVE_DIR=<构建目录> node tools/verify-diag-report.mjs）
// 无头环境无法弹真键盘/剪贴板授权，自动复制在这里必然走「失败」分支——断言只校验
// 「有复制结果反馈」，不校验剪贴板内容。
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(process.env.SERVE_DIR || dirname(fileURLToPath(import.meta.url)) + '/..');
console.log('serve 目录:', root);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.ico': 'application/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + server.address().port + '/index.html';
const browser = await chromium.launch();
let pass = 0, fail = 0;
const t = (name, ok, info) => { console.log((ok ? '  ✅ ' : '  ❌ ') + name + (info ? '   [' + info + ']' : '')); ok ? pass++ : fail++; };

async function boot(slowMs) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  if (slowMs) await page.evaluate((ms) => {
    const delay = (fn) => function () { const a = arguments; return new Promise(res => setTimeout(() => fn.apply(window, a).then(res, res), ms)); };
    ['idbGet', 'idbGetMany', 'idbListKeys'].forEach(k => { if (window[k]) window[k] = delay(window[k]); });
  }, slowMs);
  return { ctx, page };
}
const COPY_TIP = /复制到剪贴板|复制失败|请点下方【复制】/;

// ===== 1. __jsErrors 预初始化 + 诊断成节输出 =====
console.log('\n【修复·启动异常】__jsErrors 预初始化与诊断输出');
{
  const { ctx, page } = await boot(0);
  t('产物运行时 typeof window.__jsErrors === "object"', (await page.evaluate(() => typeof window.__jsErrors)) === 'object');
  await page.evaluate(() => { window.__jsErrors.push('[JS] mail.js simulated boot failure'); });
  const text = await page.evaluate(async () => {
    document.getElementById('row-diagnostics').click();
    for (let i = 0; i < 200; i++) {
      const ta = document.getElementById('modal-textarea');
      if (ta && !ta.hidden && ta.value.length > 50) return ta.value;
      await new Promise(r => setTimeout(r, 50));
    }
    return '';
  });
  t('诊断含「启动文件异常 1 处」并列出该文件', /启动文件异常 1 处/.test(text) && text.includes('mail.js simulated boot failure'));
  await ctx.close();
}

// ===== 2. 软/硬双预算 + 未完成标注 + 终态回填 =====
console.log('\n【修复·预算】首屏 3.5s 交付 + 未读到标注 + 终态回填到可见弹窗');
{
  const { ctx, page } = await boot(5000);
  const first = await page.evaluate(async () => {
    const t0 = Date.now();
    const toastTxt = () => { const e = document.getElementById('cc-toast'); return e && e.classList.contains('show') ? e.textContent : ''; };
    document.getElementById('row-diagnostics').click();
    const clickToast = toastTxt();
    const ta = document.getElementById('modal-textarea');
    for (let i = 0; i < 200; i++) { if (ta && !ta.hidden && ta.value.length > 50) break; await new Promise(r => setTimeout(r, 50)); }
    return { ms: Date.now() - t0, clickToast, text: ta ? ta.value : '' };
  });
  t('点击瞬间即有「正在读取本机诊断数据…」反馈', first.clickToast.includes('正在读取'), first.clickToast || '无 #cc-toast');
  t('弹窗在软预算 3.5s 附近交付（不被轮询抢短、也不干等 12s）', first.ms > 3000 && first.ms < 4600, first.ms + 'ms');
  t('首屏正文 0 处裸「读取中…」冒充', (first.text.match(/读取中…|获取中…|采样中…/g) || []).length === 0);
  const marked = (first.text.match(/未读到（本机存储响应慢，稍后自动补全）/g) || []).length;
  t('未读到的行明确标注（实测 ' + marked + ' 行）', marked >= 3, marked + ' 行');
  // 终态：真实明细回填进可见正文 + 标注全部收口 + 复制反馈到位（此前 ctl.text 写隐藏 input，回填无效）
  const late = await page.evaluate(async () => {
    const VAL = () => { const ta = document.getElementById('modal-textarea'); return ta ? ta.value : ''; };
    const HINT = () => { const s = document.getElementById('modal-static'); return s && !s.hidden ? (s.textContent || '') : ''; };
    const TIP = /复制到剪贴板|复制失败|请点下方【复制】/;
    let v = '', hint = '';
    for (let i = 0; i < 220; i++) {
      v = VAL(); hint = HINT();
      if (/开关持久化体检（当前桌面/.test(v) && /桌面归属体检（当前桌面/.test(v) && !/未读到（/.test(v) && TIP.test(hint)) break;
      await new Promise(r => setTimeout(r, 200));
    }
    return { text: v, hint, wei: (v.match(/未读到（/g) || []).length, detail: /开关持久化体检（当前桌面/.test(v) && /桌面归属体检（当前桌面/.test(v) };
  });
  t('终态后真实体检明细回填进可见弹窗正文', late.detail);
  t('回填后「未读到」标注全部收口', late.wei === 0, '残留 ' + late.wei + ' 处');
  t('终态有复制结果反馈（hint 文案变化）', COPY_TIP.test(late.hint), late.hint.slice(0, 24));
  await ctx.close();
}

// ===== 3. IDB 彻底挂起：12s 硬预算必给终态 =====
console.log('\n【加固】IDB 彻底挂起时 12s 必给终态并标注「未完成」');
{
  const { ctx, page } = await boot(0);
  const r = await page.evaluate(async () => {
    ['idbGet', 'idbGetMany', 'idbListKeys'].forEach(k => { if (window[k]) window[k] = function () { return new Promise(() => {}); }; });
    const t0 = Date.now();
    document.getElementById('row-diagnostics').click();
    const ta = document.getElementById('modal-textarea');
    for (let i = 0; i < 400; i++) { if (ta && !ta.hidden && ta.value.length > 50) break; await new Promise(r2 => setTimeout(r2, 50)); }
    const firstMs = Date.now() - t0;
    let v = '';
    for (let i = 0; i < 200; i++) { v = ta ? ta.value : ''; if (/未完成（本机存储无响应/.test(v)) break; await new Promise(r2 => setTimeout(r2, 100)); }
    return { firstMs, doneMs: Date.now() - t0, text: v };
  });
  t('挂起时首屏仍在 3.5s 交付', r.firstMs > 3000 && r.firstMs < 4600, r.firstMs + 'ms');
  t('12s 硬预算给出终态并标注「未完成（本机存储无响应…）」', /未完成（本机存储无响应/.test(r.text) && r.doneMs < 15000, r.doneMs + 'ms');
  await ctx.close();
}

// ===== 4. 角标按时间戳比较 =====
console.log('\n【修复·角标】按最后一条错误时间戳判未读');
{
  const { ctx, page } = await boot(0);
  const r = await page.evaluate(async () => {
    const G = 'xy-home-v2:';
    const mk = (n, t0) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ t: t0 + i, msg: 'old' + i, dev: 'M1' })));
    const badge = () => { const b = document.querySelector('#row-diagnostics .diag-err-badge'); return b ? (b.style.display === 'none' ? '隐藏' : '显示:' + b.textContent) : '无元素'; };
    const out = {};
    const t0 = Date.now() - 100000;
    localStorage.setItem(G + '__diag-errs', mk(5, t0));
    localStorage.setItem(G + '__diag-errs-seen', String(t0 + 4));
    console.error('RING SATURATED NEW ERROR');
    await new Promise(r2 => setTimeout(r2, 300));
    out.saturated = badge();
    localStorage.setItem(G + '__diag-errs', mk(5, t0));
    localStorage.setItem(G + '__diag-errs-seen', String(t0 + 4));
    window.mochiRefreshDiagBadge();
    out.noNew = badge();
    localStorage.setItem(G + '__diag-errs', mk(5, t0));
    localStorage.setItem(G + '__diag-errs-seen', '5');
    window.mochiRefreshDiagBadge();
    out.legacy = badge();
    return out;
  });
  t('环形满 5 + 已看最后一条 + 新错误 → 显示 1（修复前恒「隐藏」）', r.saturated === '显示:1', r.saturated);
  t('确无新错误时不亮（不是无条件常亮）', r.noNew === '隐藏', r.noNew);
  t('遗留旧格式值（条数 5）自愈：视为未读并显示 5', r.legacy === '显示:5', r.legacy);
  await ctx.close();
}

// ===== 5. 关窗后的迟到回填不得污染其他弹窗（全站共用弹窗 DOM）=====
console.log('\n【守卫】诊断弹窗已关 → 迟到回填不灌进别的弹窗');
{
  const { ctx, page } = await boot(9000);
  const r = await page.evaluate(async () => {
    document.getElementById('row-diagnostics').click();
    for (let i = 0; i < 200; i++) { const ta = document.getElementById('modal-textarea'); if (ta && !ta.hidden && ta.value.length > 50) break; await new Promise(r2 => setTimeout(r2, 50)); }
    // 模拟「点遮罩关闭」：close() 只隐藏遮罩、不回调 cb（所以旧代码的 closed 一直是 false）
    document.getElementById('modal-mask').hidden = true;
    window.openModal('编辑备注', '我的内容', function () {}, { noInput: true, textarea: true });
    for (let i = 0; i < 110; i++) await new Promise(r2 => setTimeout(r2, 200));
    const ta = document.getElementById('modal-textarea');
    return { v: ta ? ta.value : '', title: (document.getElementById('modal-title') || {}).textContent };
  });
  t('迟到回填后另一个弹窗正文未被覆盖', r.v === '我的内容', '标题=' + r.title + ' 正文=' + JSON.stringify(r.v.slice(0, 16)));
  await ctx.close();
}

// ===== 6. 最近错误环形窗口 5 → 20，调用栈只给最近 3 条 =====
console.log('\n【修复·线索窗口】最近错误留 20 条（修复前 5 条）+ 栈只给最近 3 条');
{
  const { ctx, page } = await boot(0);
  const r = await page.evaluate(async () => {
    const G = 'xy-home-v2:';
    try { localStorage.removeItem(G + '__diag-errs'); } catch (e) {}
    // 真抛未捕获异常（setTimeout 里 throw → window.onerror 收到，带 e.error.stack）
    for (let i = 0; i < 30; i++) setTimeout(function () { throw new Error('SEED THROWN ' + i); }, 0);
    await new Promise(r2 => setTimeout(r2, 1200));
    let ring = [];
    try { ring = JSON.parse(localStorage.getItem(G + '__diag-errs') || '[]'); } catch (e) {}
    document.getElementById('row-diagnostics').click();
    let v = '';
    for (let i = 0; i < 220; i++) {
      const ta = document.getElementById('modal-textarea');
      v = ta ? ta.value : '';
      if (/最近错误 \d+ 条/.test(v)) break;
      await new Promise(r2 => setTimeout(r2, 50));
    }
    const seg = v.split('\n');
    const start = seg.findIndex(s => /^最近错误 \d+ 条/.test(s));
    let shown = 0, stack = 0;
    if (start >= 0) {
      for (let i = start + 1; i < seg.length; i++) {
        const s = seg[i];
        if (/^· /.test(s)) shown++;
        else if (/^ {4}/.test(s)) stack++;
        else break;
      }
    }
    return { ring: ring.length, shown, stack, head: start >= 0 ? seg[start] : '' };
  });
  t('30 次报错后环形保留 20 条（修复前只剩 5 条）', r.ring === 20, '实测 ' + r.ring + ' 条');
  t('诊断正文把 20 条线索全列出来', r.shown === 20, '正文 ' + r.shown + ' 行');
  t('调用栈只跟最近 3 条（≤12 行，报障文本不被撑爆）', r.stack > 0 && r.stack <= 12, '栈 ' + r.stack + ' 行');
  await ctx.close();
}

await browser.close(); server.close();
console.log('\n===== 合计 ' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
