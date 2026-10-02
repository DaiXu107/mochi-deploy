// ===== 回归验证 #1026：输入框提示文字（「说点什么…」）颜色与显隐可控 =====
// 用法：node build.mjs && node tools/verify-1026-chat-placeholder.mjs
//       隔离副本加 --root=<目录>（按 <root>/index.html 起服务，src 静态项也从该目录读）
// 背景（用户直派「聊天设置里【说点什么...】这一行输入栏的文字无法更换颜色或关闭」）：那行字由
//       .chat-input:empty::before 画，原颜色写死（单聊 #b5b5b5、群聊 #aaa），设置里没有入口——
//       唯一相近的「对方正在输入文字颜色」管的是气泡上方那条提示，与它无关。
//       dark.css 的 [data-theme="dark"] .chat-input:empty::before 权重高于裸类选择器且加载在后，
//       所以新规则必须带 #page-chat / #page-group-chat 前缀才压得住（＝「改了等于没改」这一类，
//       纯文本哨兵拦不住，故 B4 专门断言深色下用户色仍生效）。
// 检查项：S 静态锚；B 无头行为（默认跟随主题 → 用户色覆盖 → 深浅两套都覆盖成功 →
//           开关一点即隐藏 → 落库 → 输入栏几何不变 → 重载后预置值仍生效）。
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const argRoot = (process.argv.find((a) => a.startsWith('--root=')) || '').split('=')[1];
const root = argRoot ? normalize(argRoot) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
const read = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch (e) { return ''; } };

// ---------------- S 组：静态锚 ----------------
const css = read('src/css/chat-main.css');
const js = read('src/js/chat-settings.js');
const tpl = read('src/template.html');
check('S1 CSS 取用户色变量（写回死色＝设置里换色无效）', /color:var\(--chat-ph-ink, var\(--hint-ink\)\)/.test(css));
check('S2 显隐走 visibility 变量（display 会让输入栏几何跟着变）', /visibility:var\(--chat-ph-visibility, visible\)/.test(css) && !/--chat-ph-display/.test(css));
check('S3 两条 id 前缀选择器在位（压过 dark.css 与 group-chat.css）', /#page-chat \.chat-input:empty::before/.test(css) && /#page-group-chat \.chat-input:empty::before/.test(css));
check('S4 JS 写入 ＋ 未设置即删变量（回落主题灰）', /setVar\(root, '--chat-ph-visibility', 'hidden'\)/.test(js) && /delVar\(root, '--chat-ph-visibility'\)/.test(js) && /delVar\(root, '--chat-ph-ink'\)/.test(js));
check('S5 两键随聊天美化方案走', /'cs-ph-ink', 'cs-ph-show'/.test(js));
check('S6 设置页两行入口 + 色板行接线', /id="cs-ph-show"/.test(tpl) && /id="cs-ph-ink"/.test(tpl) && /bindBubbleColorRow\('cs-ph-ink'/.test(js));

// ---------------- 静态服务器 ----------------
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_12 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.7 Mobile/15E148 Safari/604.1';

let browser = null;
// 两个输入框的占位符计算样式 + 输入框几何 + 本桌面的两键现值（一次取回）
const probe = (page) => page.evaluate(`(function(){
  function one(id){
    var el=document.getElementById(id); if(!el) return {miss:id};
    var cs=getComputedStyle(el,'::before');
    var r=el.getBoundingClientRect();
    return {color:cs.color, vis:cs.visibility, disp:cs.display, h:Math.round(r.height), w:Math.round(r.width)};
  }
  var p=document.getElementById('page-chat'); if(p) p.hidden=false;
  var g=document.getElementById('page-group-chat'); if(g) g.hidden=false;
  return JSON.stringify({chat:one('chat-input'), gc:one('gc-input'),
    store:Object.keys(localStorage).filter(function(k){return /:cs-ph-(ink|show)$/.test(k);}).map(function(k){return k.split(':').pop()+'='+localStorage.getItem(k);}).join(','),
    dark:document.documentElement.getAttribute('data-theme')||''});
})()`);
async function open(seed) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  await ctx.addInitScript(`(function(){ try {
    localStorage.setItem('xy-home-v2:__last-backup-ok', String(Date.now()));
    localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now()));
    ${Object.keys(seed || {}).map((k) => 'localStorage.setItem(' + JSON.stringify(k) + ',' + JSON.stringify(seed[k]) + ');').join('\n')}
  } catch (e) {} })()`);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 30000 });
  for (let i = 0; i < 40; i++) { if (await page.evaluate('!!window.__mochiDataReady').catch(() => 0)) break; await sleep(250); }
  await page.evaluate("(function(){var s=document.getElementById('splash');if(s&&s.parentNode)s.parentNode.removeChild(s);return 1;})()");
  await sleep(500);
  return { page, errs, ctx };
}
const cidKey = (page, suffix) => page.evaluate("(function(){try{return window.activePrefix() + ':' + '" + suffix + "';}catch(e){return 'xy-home-v2:default:" + suffix + "';}})()");

const PICK = '#d6336c', PICK_RGB = 'rgb(214, 51, 108)';
try {
  const { chromium } = await import('playwright');
  browser = await chromium.launch();

  // B1/B2 默认：跟随主题灰，单聊与群聊同源
  const A = await open({});
  let s = JSON.parse(await probe(A.page));
  check('B1 默认提示文字为浅灰 rgb(181,181,181)（未被写死值覆盖）', s.chat.color === 'rgb(181, 181, 181)' && s.gc.color === 'rgb(181, 181, 181)', JSON.stringify({ c: s.chat.color, g: s.gc.color }));
  check('B2 默认可见', s.chat.vis === 'visible' && s.gc.vis === 'visible', s.chat.vis + '/' + s.gc.vis);
  const keyInk = await cidKey(A.page, 'cs-ph-ink');
  const keyShow = await cidKey(A.page, 'cs-ph-show');
  await A.ctx.close();

  // B3/B4 用户色：浅色与深色两套都要盖住（深色曾被 dark.css 抢权重）
  const B = await open({ [keyInk]: PICK });
  s = JSON.parse(await probe(B.page));
  check('B3 设了用户色后浅色主题变色（单聊＋群聊同源）', s.chat.color === PICK_RGB && s.gc.color === PICK_RGB, JSON.stringify({ c: s.chat.color, g: s.gc.color, k: keyInk }));
  await B.ctx.close();
  const C = await open({ [keyInk]: PICK, 'xy-home-v2:theme-mode': 'dark' });
  s = JSON.parse(await probe(C.page));
  check('B4 深色主题下仍取用户色（压过 dark.css 主题规则）', s.dark === 'dark' && s.chat.color === PICK_RGB && s.gc.color === PICK_RGB, 'dark=' + s.dark + ' ' + JSON.stringify({ c: s.chat.color, g: s.gc.color }));
  await C.ctx.close();
  const D = await open({ 'xy-home-v2:theme-mode': 'dark' });
  s = JSON.parse(await probe(D.page));
  check('B5 深色未设置时回落深灰 rgb(102,102,102)（旧行为不变）', s.dark === 'dark' && s.chat.color === 'rgb(102, 102, 102)', JSON.stringify({ c: s.chat.color, g: s.gc.color, dark: s.dark }));
  await D.ctx.close();

  // B6~B9 隐藏开关：即时生效 + 落库 + 输入栏几何不动
  const E = await open({});
  await E.page.evaluate("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();var b=document.getElementById('chat-settings-btn');if(b)b.click();return 1;})()");
  // 基线要取稳态：进设置页/开聊天页后 mobile-adapt 会把整页铺满（body.full），
  // .chat-input-row 宽 354→390 与占位符无关（对照实测：不点开关也漂同一量）。故先轮询到连续两次同值再比。
  const settled = async () => {
    let prev = null;
    for (let i = 0; i < 20; i++) {
      await sleep(300);
      const cur = JSON.parse(await probe(E.page));
      if (prev && prev.chat.w === cur.chat.w && prev.chat.h === cur.chat.h && prev.gc.w === cur.gc.w) return cur;
      prev = cur;
    }
    return prev;
  };
  const geo0 = await settled();
  const hasRow = await E.page.evaluate("(function(){var c=document.getElementById('cs-ph-show');if(!c)return 'no-row';c.click();return 'clicked';})()");
  const geo1 = await settled();
  check('B6 设置页开关存在且一点即隐藏（两页同时）', hasRow === 'clicked' && geo1.chat.vis === 'hidden' && geo1.gc.vis === 'hidden', hasRow + ' ' + geo1.chat.vis + '/' + geo1.gc.vis);
  check('B7 开关落库为 hide', /cs-ph-show=hide/.test(geo1.store), geo1.store);
  check('B8 隐藏后输入栏几何一字不动（只是不显示那几个字）', geo1.chat.h === geo0.chat.h && geo1.chat.w === geo0.chat.w, geo0.chat.h + 'x' + geo0.chat.w + ' → ' + geo1.chat.h + 'x' + geo1.chat.w);
  await E.page.evaluate("(function(){var c=document.getElementById('cs-ph-show');if(c)c.click();return 1;})()");
  await sleep(400);
  const geo2 = JSON.parse(await probe(E.page));
  check('B9 再点一次恢复显示', geo2.chat.vis === 'visible' && geo2.gc.vis === 'visible', geo2.chat.vis);
  check('Z1 全流程零页面异常', E.errs.length === 0, E.errs.slice(0, 3).join(' | '));
  await E.ctx.close();

  // B10 预置值启动即生效（读库路径，而非只有点开关才生效）
  const F = await open({ [keyShow]: 'hide' });
  s = JSON.parse(await probe(F.page));
  check('B10 重载后预置 hide 仍隐藏（启动即应用）', s.chat.vis === 'hidden' && s.gc.vis === 'hidden', s.chat.vis);
  check('Z2 预置场景零页面异常', F.errs.length === 0, F.errs.slice(0, 3).join(' | '));
  await F.ctx.close();
} catch (e) {
  console.log('运行失败：' + (e && e.message ? e.message : e));
  check('B0 环境可跑（playwright / 产物加载）', false, e && e.message ? e.message : String(e));
} finally {
  try { if (browser) await browser.close(); } catch (e) {}
  try { server.close(); } catch (e) {}
}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
