// ===== 验证脚本：WebKit 引擎检查（v3.16.x） =====
// 背景：npm run verify 只有无头 Chrome（Blink），而历史 bug 一大半来自 iOS Safari
//（WebKit 引擎）——dvh/svh 支持差异、contenteditable 行为、:empty::before 占位符等。
// 本脚本用 Playwright 的 WebKit 内核在 390×844 下跑同一套核心布局检查（无缩放 /
// 状态栏 / 占满视口 / 聊天贴底），并额外验证统一设备判定 mochiDevice 与设置页
// 「复制诊断信息」入口。
// 用法：npm run verify:webkit（首次需 npx playwright install webkit）
// 需要：Node 18+，playwright 已安装（npm i --no-save playwright）。
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright'; // 仅用于兜底报错提示；主跑 webkit

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 静态服务器（serve 仓库根目录） ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

async function runEngine(ua, tag) {
  let browser = null;
  try {
    const { webkit } = await import('playwright');
    browser = await webkit.launch();
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: ua
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('  [pageerror] ' + tag + ' ' + e.message); });
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 20000 });
    // 等数据就绪 + 关开屏
    for (let i = 0; i < 40; i++) {
      if (await page.evaluate('!!window.__mochiDataReady')) break;
      await sleep(300);
    }
    await page.evaluate("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
    await sleep(900);

    // 1) 统一设备判定存在且生效
    const dev = await page.evaluate("(function(){var d=window.mochiDevice||{};return JSON.stringify({defined:!!window.mochiDevice,isMobile:!!d.isMobile,isTablet:!!d.isTablet,isIOS:!!d.isIOS,isAndroid:!!d.isAndroid,isVia:!!d.isVia,cls:document.documentElement.className});})()").catch(() => '{}');
    const devJson = JSON.parse(dev || '{}');
    check(tag + ' mochiDevice 已定义', devJson.defined === true);
    check(tag + ' mochiDevice.isMobile=true', devJson.isMobile === true, String(devJson.isMobile));
    check(tag + ' mochiDevice.isIOS 与 UA 一致', devJson.isIOS === /iphone/i.test(ua), 'iOS=' + devJson.isIOS + ' UA含iphone=' + /iphone/i.test(ua));

    // 2) 布局核心检查（与 verify.mjs 等价）
    const home = JSON.parse(await page.evaluate("(function(){var ph=document.querySelector('.phone');var pr=ph.getBoundingClientRect();var st=document.querySelector('.statusbar');return JSON.stringify({zoom:getComputedStyle(ph).zoom,statusbar:getComputedStyle(st).display,phoneW:Math.round(pr.width),innerW:innerWidth});})()") || '{}');
    check(tag + ' 无整页缩放（zoom=1）', home.zoom === '1', String(home.zoom));
    check(tag + ' 状态栏正常显示', home.statusbar === 'flex', home.statusbar);
    check(tag + ' 手机屏占满视口（宽）', home.phoneW >= home.innerW - 20, home.phoneW + ' vs ' + home.innerW);

    await page.evaluate("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});})()");
    await sleep(400);
    const chat = JSON.parse(await page.evaluate("(function(){var ph=document.querySelector('.phone');var pr=ph.getBoundingClientRect();var pg=document.getElementById('page-chat');var ch=pg.querySelector('.chat-head');var ir=pg.querySelector('.chat-input-row');if(!ch||!ir)return '{}';return JSON.stringify({head:true,inputBottom:Math.round(ir.getBoundingClientRect().bottom-pr.top),phoneH:Math.round(pr.height)});})()") || '{}');
    check(tag + ' 聊天页顶栏存在', chat.head === true);
    if (chat.head === true) check(tag + ' 聊天输入栏贴底', chat.inputBottom >= chat.phoneH - 5, chat.inputBottom + ' vs ' + chat.phoneH);

    // 3) 设置页「复制诊断信息」入口存在且能弹出诊断弹窗
    await page.evaluate("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-setting');});})()");
    await sleep(300);
    const rowExists = await page.evaluate("!!document.getElementById('row-diagnostics')");
    check(tag + ' 设置页诊断入口存在', rowExists === true);
    if (rowExists) {
      // 应用自有的启动弹窗（实测无头 Chrome 会弹「回答TA的询问」）先占着全站共用弹窗 DOM
      await page.evaluate("(function(){var m=document.getElementById('modal-mask');if(m&&!m.hidden){var c=document.getElementById('modal-cancel');if(c)c.click();}})()");
      await sleep(250);
      await page.evaluate("(function(){var r=document.getElementById('row-diagnostics');r.click();})()");
      // 诊断弹窗要等 collectDiag 的 Promise 落地才挂载（实测 Chrome ~400ms / WebKit ~600ms），
      // 固定 sleep(300) 判「打不开」是脚本等待不足。轮询到标题含「诊断」为止，最多 4s。
      let modalOpen = false;
      for (let i = 0; i < 20; i++) {
        await sleep(200);
        modalOpen = await page.evaluate("(function(){var m=document.getElementById('modal-mask');var ti=document.getElementById('modal-title');return !!(m&&!m.hidden&&ti&&ti.textContent.indexOf('诊断')>=0);})()");
        if (modalOpen) break;
      }
      const diagText = await page.evaluate("(function(){var t=document.getElementById('modal-textarea');return t&&!t.hidden?t.value:'';})()").catch(() => '');
      check(tag + ' 诊断弹窗能打开', modalOpen === true);
      check(tag + ' 诊断信息含 UA', /navigator/i.test(diagText) || /UA/i.test(diagText), diagText.length > 0 ? diagText.length + ' 字符' : '空');
    }
    await browser.close();
  } catch (e) {
    check(tag + ' 引擎执行无异常', false, String(e && e.message));
    if (browser) { try { await browser.close(); } catch (e2) {} }
  }
}

const UAS = [
  { tag: 'WebKit-iPhone', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1' },
  { tag: 'WebKit-Android', ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36' }
];
for (const { tag, ua } of UAS) {
  try { await runEngine(ua, tag); }
  catch (e) { console.error(tag + ' 检查异常: ' + e); }
}

try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
