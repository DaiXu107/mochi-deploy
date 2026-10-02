// ===== 验证脚本：已知设备伪装场景回归矩阵（v3.16.x） =====
// 背景：git 历史里累计了多台真实报障设备（vivo Y35+Edge 桌面站点模式、OPPO/Via/
// 夸克 UA 伪装 iPhone/iPad、iPadOS 13+ MacIntel UA 等），每台都是改 device.js
// 判定逻辑时的回归风险点。本脚本用 Playwright 注入/覆写 UA、screen.width、
// visualViewport.width、window.orientation、maxTouchPoints 等指纹，还原这些
// 场景，断言 window.mochiDevice 判出预期值 + 布局兜底类到位。
// 用法：npm run verify:device（首次需 npx playwright install webkit）
// 注意：无头环境模拟不了的指纹（如 meta viewport 对 layout 的真实影响）按
//「等价信号」处理——断言目标是「伪装被识破并走手机布局」，不绑定具体分支。
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
// 每个用例独立端口（独立 origin）：WebKit 无头里同 origin 的 SW/缓存会跨上下文污染
// （实测：case1 注册 SW 后，后续部分上下文导航被拦成空文档＝mochiDevice 永不定义的假红），
// 独立 origin 从根上隔离；SW 注册另在 init script 里禁用双保险。
async function startServer() {
  const sv = createServer((req, res) => {
    try {
      let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
      if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
      if (statSync(p).isDirectory()) p = join(p, 'index.html');
      const body = readFileSync(p);
      res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
      res.end(body);
    } catch (e) { res.writeHead(404); res.end('nf'); }
  });
  await new Promise((r) => sv.listen(0, '127.0.0.1', r));
  return sv;
}

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// 指纹注入：在页面任何脚本执行前覆写 device.js 读取的原始量
// vvW 注入：window.visualViewport.width 覆盖为指定值（模拟「layout 980 但真机 CSS 宽 390」）
// maxTP 注入：navigator.maxTouchPoints 覆盖（Playwright 无头 WebKit 可能为 0）
// orient 注入：window.orientation 赋值（存在 = 移动内核特征）
// sw 注入：screen.width / availWidth 覆盖（模拟「桌面站点模式把 screen 也伪装」）
function fingerprintInject({ ua, vvW, maxTP, orient, sw }) {
  const parts = [];
  if (maxTP != null) parts.push("try{Object.defineProperty(navigator,'maxTouchPoints',{get:function(){return " + maxTP + ";}});}catch(e){}");
  if (orient != null) parts.push("try{window.orientation=" + orient + ";}catch(e){}");
  if (vvW != null) parts.push("try{Object.defineProperty(window.visualViewport,'width',{get:function(){return " + vvW + ";}});}catch(e){}");
  if (sw != null) parts.push("try{Object.defineProperty(screen,'width',{get:function(){return " + sw + ";}});Object.defineProperty(screen,'availWidth',{get:function(){return " + sw + ";}});}catch(e){}");
  return parts.join('\n');
}

// 每个用例：Playwright context 参数 + 额外指纹注入 + 期望判定
// 注意：matchMedia('(max-width:900px)') 无法用注入覆写，只能靠 viewport 宽度控制——
// 宽视口(980/1024)下该查询不命中，正好驱动 device.js 的「桌面伪装兜底」判定链。
const CASES = [
  {
    name: '真安卓 Chrome（基线）',
    ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36' },
    expect: { isMobile: true, isAndroid: true, isIOS: false, isTablet: false }
  },
  {
    name: '真 iPhone Safari（基线）',
    ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1' },
    expect: { isMobile: true, isIOS: true, isAndroid: false, isTablet: false }
  },
  {
    name: '真 iPad 老系统（UA 含 iPad 关键字）',
    ctx: { viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 12_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1' },
    expect: { isTablet: true, isMobile: false }
  },
  {
    name: '安卓机 UA 伪装 iPhone（OPPO/Via/夸克，UA 保留 Android 标识）',
    ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X; Android 13) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1' },
    expect: { isMobile: true, isIOS: false, isAndroid: true, isTablet: false }
  },
  {
    name: '安卓窄屏机 UA 伪装 iPad（OPPO/Via/夸克，UA 含 Android 标识）',
    ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X; Android 13) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1' },
    expect: { isMobile: true, isTablet: false, isAndroid: true }
  },
  {
    name: 'vivo Y35 + Edge 桌面站点模式（全套伪装，靠 visualViewport 识破）',
    ctx: { viewport: { width: 980, height: 844 }, isMobile: false, hasTouch: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0' },
    inject: fingerprintInject({ vvW: 390, maxTP: 5, orient: 0 }),
    expect: { isMobile: true, isTablet: false },
    expectForceMobile: true // 无头里 meta viewport 对 layout 不生效 → 走 force-mobile 兜底
  },
  {
    name: 'Edge 桌面站点模式（连 orientation 都伪装，仅靠 visualViewport 识破）',
    ctx: { viewport: { width: 980, height: 844 }, isMobile: false, hasTouch: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0' },
    inject: fingerprintInject({ vvW: 390, maxTP: 5 }),
    expect: { isMobile: true, isTablet: false }
  },
  {
    name: 'Edge 桌面站点模式（vv/screen 全伪装，退 UA+coarse+orientation 组合）',
    ctx: { viewport: { width: 980, height: 844 }, isMobile: false, hasTouch: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0' },
    inject: fingerprintInject({ maxTP: 5, orient: 0, sw: 980, vvW: 980 }),
    expect: { isMobile: true, isTablet: false }
  },
  {
    name: '真桌面 PC 无触摸（对照：不被误判成手机）',
    ctx: { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    expect: { isMobile: false, isTablet: false, isIOS: false, isAndroid: false }
  }
];

const { webkit } = await import('playwright');
let browser = null;
try { browser = await webkit.launch(); } catch (e) {
  console.error('WebKit 启动失败（首次运行请先 npx playwright install webkit）: ' + e.message);
  process.exit(1);
}

for (const c of CASES) {
  let ctx = null;
  const server = await startServer();
  const baseUrl = 'http://127.0.0.1:' + server.address().port;
  try {
    ctx = await browser.newContext(c.ctx);
    // Playwright WebKit 的 Service Worker 支持残缺：首个上下文注册 SW 后，同源后续
    // 上下文的导航会被 SW 拦成空响应（页面 0 script、mochiDevice 永不定义＝假红）。
    // 本脚本只测 device.js 判定链，与 SW 无关——统一禁掉注册。
    await ctx.addInitScript("try { if (navigator.serviceWorker) navigator.serviceWorker.register = function () { return Promise.reject(new Error('sw-disabled-for-device-regression-test')); }; } catch (e) {}");
    if (c.inject) await ctx.addInitScript(c.inject);
    const page = await ctx.newPage();
    await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 20000 });
    for (let i = 0; i < 40; i++) {
      if (await page.evaluate('!!window.__mochiDataReady')) break;
      await sleep(300);
    }
    // 等 device.js 的 rAF 兜底链走完（viewport 改写 / force-mobile 判定）
    await sleep(1200);
    const got = JSON.parse(await page.evaluate("(function(){var d=window.mochiDevice||{};return JSON.stringify({defined:!!window.mochiDevice,isMobile:!!d.isMobile,isTablet:!!d.isTablet,isIOS:!!d.isIOS,isAndroid:!!d.isAndroid,isVia:!!d.isVia,forceMobile:document.documentElement.classList.contains('force-mobile'),vp:(function(){var m=document.querySelector('meta[name=viewport]');return m?m.content:'';})()});})()") || '{}');
    check(c.name + '：mochiDevice 已定义', got.defined === true);
    for (const k of Object.keys(c.expect)) {
      check(c.name + '：mochiDevice.' + k + '=' + c.expect[k], got[k] === c.expect[k], String(got[k]));
    }
    if (c.expectForceMobile) {
      check(c.name + '：走 force-mobile 兜底', got.forceMobile === true, 'force-mobile=' + got.forceMobile);
    }
    await ctx.close();
  } catch (e) {
    check(c.name + '：用例执行无异常', false, String(e && e.message));
    if (ctx) { try { await ctx.close(); } catch (e2) {} }
  } finally {
    try { server.close(); } catch (e2) {}
  }
}
try { await browser.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
