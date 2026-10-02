// ===== 回归脚本：#690 老内核降级（桌面壁纸层 / 背景遮罩 / 图标尺寸 / 图标间距）=====
// 背景（用户报障，明说「其他设备型号也有出现」）：「桌面滑动，桌面的三页会灰屏和卡顿，无法正常
//   滑动；进去其实比较正常，但是之后我滑动页面、以及点里面的 app 都会卡，手机还会发烫」。
// 根因之一（本脚本守的那条，零机型分支）：桌面的两个背景层当年只用 CSS `inset:0` 定位。
//   `inset` 简写是 2020 年才有的（Safari 14.1 / Chromium 87），老内核**整条声明静默丢弃**、
//   不报错 —— 空 div 没有 top/left/right/bottom → 收缩成 0×0（实测：老内核解析结果 0×0，
//   现代内核 390×844）→ 桌面壁纸整层不显示、「换壁纸 / 调背景遮罩」怎么点都没变化，桌面只剩
//   .phone 底色＝用户眼里的「三页灰白」。同批老内核还会丢掉 min()（图标盒塌成 svg 的 28px）
//   与 grid 的 gap 简写（图标行距归零），三页一起错位。
// 修法：给这三处都补「老内核也认」的等价兜底（四条长手 + 宽高 / 纯像素 width+height /
//   grid-gap），现代内核取值完全不变（assert 里对同一条基线同时校验）。
// 本脚本怎么判：
//   S1~S9 静态锚点：九条兜底/仪器表达式逐个在 src 里点名（少一条就报哪一条）。
//   B 组  行为断言（真渲染）：**把页面 CSS 里的 inset / min() / gap 简写整条抽掉**（＝老内核
//         解析后的等价结果）再断言四个可见量仍正确——壁纸层与遮罩层仍是整屏、图标仍是 58px、
//         图标网格行距仍是 14px。现代内核基线（未抽掉）同批断言，防止「兜底把现代内核改坏」。
//   C 组  仪器断言：桌面翻页帧耗时采样确实在翻页后落键（下次报「滑三页卡」时有真机读数）。
// 用法：node build.mjs && node tools/verify-old-engine-degrade.mjs
//   MOCHI_ROOT=<已构建目录> 可测隔离副本（不写产物）。RED 判别：把 src 里任一条兜底删掉再构建，
//   对应 B 项必红（0×0 / 28px / 0px）。
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail === undefined ? '' : '  [' + detail + ']'));
}

// ---------- S 组：静态锚点（src 点名）----------
const srcText = (p) => { try { return readFileSync(join(root, 'src', p), 'utf8'); } catch (e) { return ''; } };
const homeCss = srcText('css/home.css');
const sliderJs = srcText('js/desktop-slider.js');
const personalizeJs = srcText('js/personalize.js');
const deviceJs = srcText('js/device.js');

check('S1 css/home.css 有 .app-grid 的 grid-gap 兜底（老内核不认 gap 简写）',
  homeCss.includes('grid-gap:14px 8px; gap:14px 8px;'));
check('S2 css/home.css 有 .app-ico 的纯像素兜底（紧邻 min() 一行之前）',
  /width:58px; height:58px;\s*\n\s*width:min\(58px, 21vw\); height:min\(58px, 21vw\);/.test(homeCss));
check('S3 css/home.css 有 .phone-bg-mask 的四长手 + 宽高兜底',
  homeCss.includes('top:0; right:0; bottom:0; left:0; width:100%; height:100%;'));
check('S4 css/home.css 模糊外扩时让出宽高（#240 模糊边缘发虚防回归）',
  homeCss.includes('width:auto !important; height:auto !important;'));
check('S5 css/home.css 图标悬停放大已收进 @media (hover:hover)（触摸端 :hover 粘滞防回归）',
  /@media \(hover:hover\) \{\s*\n\s*\.app:hover \.app-ico \{/.test(homeCss) || homeCss.includes('@media (hover:hover) {\n  .app:hover .app-ico {'));
check('S6 js/personalize.js 壁纸层内联样式带四长手 + 宽高兜底（只用 inset 会 0×0）',
  personalizeJs.includes("top:0;right:0;bottom:0;left:0;width:100%;height:100%;"));
check('S7 js/desktop-slider.js 有翻页帧耗时采样（写 __diag-deskperf）',
  sliderJs.includes("'xy-home-v2:__diag-deskperf'") && sliderJs.includes('localStorage.setItem(PERF_KEY, JSON.stringify({'));
check('S8 js/device.js 诊断输出老内核降级项',
  deviceJs.includes("'老内核降级项：inset='"));
check('S9 js/device.js 诊断输出桌面翻页帧耗时',
  deviceJs.includes("'桌面翻页帧耗时（'"));
check('S10 翻页帧耗时键进了「清理错误诊断记录」清单（诊断缓存清了它也要跟着清）',
  personalizeJs.includes("'xy-home-v2:__diag-deskperf'"));

// ---------- 起服务 + 真渲染 ----------
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

let browser = null, pageErrors = [];
try {
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 60000 });
  for (let i = 0; i < 60; i++) { if (await page.evaluate('!!window.__mochiDataReady')) break; await sleep(300); }
  // 关开屏（直接摘掉遮盖层，与 clock.js 的终态一致：.splash.hide + hidden）
  await page.evaluate("(function(){var s=document.getElementById('splash'); if(s){s.classList.add('hide'); s.hidden=true; s.style.display='none';} return 'ok';})()");
  await sleep(1200);

  // 四个可见量一起量：壁纸层 / 遮罩层 / 图标盒 / 图标网格行距
  const PROBE = `(function(){
    var ph=document.querySelector('.phone'); var pr=ph.getBoundingClientRect();
    var bg=document.getElementById('phone-bg-layer'); var br=bg?bg.getBoundingClientRect():null;
    var mk=document.querySelector('.phone-bg-mask'); var mr=mk?mk.getBoundingClientRect():null;
    var ico=document.querySelector('#desktop-pages .app .app-ico'); var ir=ico?ico.getBoundingClientRect():null;
    var grid=document.querySelector('#desktop-pages .app-grid'); var gs=grid?getComputedStyle(grid):null;
    return JSON.stringify({
      phone:[Math.round(pr.width),Math.round(pr.height)],
      bg: br?[Math.round(br.width),Math.round(br.height)]:null,
      mask: mr?[Math.round(mr.width),Math.round(mr.height)]:null,
      ico: ir?[Math.round(ir.width),Math.round(ir.height)]:null,
      rowGap: gs?gs.rowGap:null, colGap: gs?gs.columnGap:null
    });
  })()`;

  const modern = JSON.parse(await page.evaluate(PROBE));
  check('B1 现代内核基线：壁纸层＝整屏', modern.bg && Math.abs(modern.bg[0] - modern.phone[0]) <= 1 && Math.abs(modern.bg[1] - modern.phone[1]) <= 1, JSON.stringify(modern.bg) + ' vs phone ' + JSON.stringify(modern.phone));
  check('B2 现代内核基线：背景遮罩层＝整屏', modern.mask && Math.abs(modern.mask[0] - modern.phone[0]) <= 1 && Math.abs(modern.mask[1] - modern.phone[1]) <= 1, JSON.stringify(modern.mask));
  check('B3 现代内核基线：桌面图标 58px', modern.ico && Math.abs(modern.ico[0] - 58) <= 1, JSON.stringify(modern.ico));
  check('B4 现代内核基线：图标网格行距 14px', modern.rowGap === '14px', String(modern.rowGap));

  // —— 老内核模拟：把产物 CSS 里三类「新语法」整条抽掉（＝老内核 parse 后的等价结果）——
  //    ① 所有 inset:<0…> 的简写声明；② min() 相关声明；③ .app-grid 的 gap 简写。
  //    做法：读出全部 <style> 文本 → 字符串切除 → 关掉原表、注入改后副本（选择器全不动）。
  const emu = await page.evaluate(`(function(){
    var texts=[]; var sheets=document.querySelectorAll('style');
    for (var i=0;i<sheets.length;i++) texts.push(sheets[i].textContent||'');
    var css=texts.join('\\n');
    var before=css.length;
    css=css.replace(/inset:\\s*0[^;{}]*;/g,'');                       // inset:0 / inset:0 0 0 0
    css=css.replace(/width:min\\(58px, 21vw\\); height:min\\(58px, 21vw\\);/g,''); // 图标 min()
    css=css.replace(/width:min\\(88vw,380px\\);/g,'');                   // 组件库面板 min()
    css=css.replace(/grid-gap:14px 8px; gap:14px 8px;/g,'grid-gap:14px 8px;'); // 只留老内核认的 grid-gap
    var removed=before-css.length;
    for (var j=0;j<sheets.length;j++) sheets[j].media='not all';       // 关掉原表
    var st=document.createElement('style'); st.id='emu-old-css'; st.textContent=css;
    document.head.appendChild(st);
    var b=document.getElementById('phone-bg-layer'); if(b) b.style.inset=''; // 内联简写同样抽掉
    return JSON.stringify({ removed: removed, hasInset: css.indexOf('inset:') >= 0 });
  })()`);
  const emuInfo = JSON.parse(emu);
  check('B5 老内核模拟已生效（确实切掉了 inset/min() 声明）', emuInfo.removed > 0, 'removed=' + emuInfo.removed);
  await sleep(400);

  const old = JSON.parse(await page.evaluate(PROBE));
  check('B6 老内核模拟：壁纸层仍＝整屏（兜底生效，不会 0×0）', old.bg && Math.abs(old.bg[0] - old.phone[0]) <= 1 && Math.abs(old.bg[1] - old.phone[1]) <= 1, JSON.stringify(old.bg));
  check('B7 老内核模拟：背景遮罩层仍＝整屏（「背景遮罩」滑块仍有效）', old.mask && Math.abs(old.mask[0] - old.phone[0]) <= 1 && Math.abs(old.mask[1] - old.phone[1]) <= 1, JSON.stringify(old.mask));
  check('B8 老内核模拟：桌面图标仍 58px（不塌成 svg 的 28px）', old.ico && Math.abs(old.ico[0] - 58) <= 1, JSON.stringify(old.ico));
  check('B9 老内核模拟：图标网格行距仍 14px（grid-gap 兜底）', old.rowGap === '14px', String(old.rowGap));

  // ---------- C 组：翻页帧耗时仪器 ----------
  await page.evaluate("(function(){document.documentElement.removeAttribute('style');var e=document.getElementById('emu-old-css');if(e)e.remove();var ss=document.querySelectorAll('style');for(var i=0;i<ss.length;i++)ss[i].media='';return 'ok';})()");
  await sleep(300);
  const perf1 = await page.evaluate(`(function(){
    try{ localStorage.removeItem('xy-home-v2:__diag-deskperf'); }catch(e){}
    var d=document.getElementById('desktop-pages');
    d.dispatchEvent(new Event('scroll'));   // 等价于用户翻页一次（采样器由 scroll 事件启动）
    return 'ok';
  })()`);
  await sleep(2200); // 采满 60 帧（≈1s）后落键
  const perf = await page.evaluate("(function(){ try { return localStorage.getItem('xy-home-v2:__diag-deskperf') || ''; } catch(e){ return ''; } })()");
  let perfObj = null;
  try { perfObj = JSON.parse(perf); } catch (e) {}
  check('C1 翻页后写入帧耗时采样键（n=60 帧）', !!perfObj && perfObj.n === 60, perf || '(空)');
  check('C2 采样数值可用（mean/p90/worst 为正且有序）',
    !!perfObj && perfObj.mean > 0 && perfObj.p90 >= perfObj.mean && perfObj.worst >= perfObj.p90,
    perfObj ? ('mean=' + perfObj.mean + ' p90=' + perfObj.p90 + ' worst=' + perfObj.worst) : '');
  check('C3 采样记录了桌面页数', !!perfObj && perfObj.pages === 3, perfObj ? String(perfObj.pages) : '');

  check('E1 全程无 JS 异常', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
} catch (e) {
  check('E0 脚本执行未抛错', false, String(e && e.message).slice(0, 300));
} finally {
  if (browser) await browser.close();
  server.close();
}

const pass = results.filter((r) => r.ok).length;
console.log('\n' + pass + '/' + results.length + ' 通过' + (pass === results.length ? '  ✅ ALL PASS' : '  ❌ 有失败项'));
process.exit(pass === results.length ? 0 : 1);
