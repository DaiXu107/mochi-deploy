// ===== 回归验证 #714：电脑端宽屏（>900px 桌面模拟器外壳）视口 fixed 浮层锚回手机壳 =====
// 用法：node build.mjs && node tools/verify-desktop-shell.mjs（测真实产物 index.html）
// 背景：手机上视口=手机壳，fixed 通栏条/贴边钮贴边即贴壳；电脑上视口 1440+，
//       这些浮层会落到浏览器窗口边缘＝用户实报「很多按钮飞出屏幕」。
// 检查项：1440×900 下各浮层计算样式＝壳几何解析值（getComputedStyle 把 max()/calc()
//         解析成 px，直接断言数值）＋真元素落位在壳内；390×844 断言手机端零影响。
//         老内核不识 max()/嵌套 calc 时声明整条丢弃＝回退视口贴边（基线行为），本脚本
//         跑在新内核上，恰好能拦住「规则被删/被改」型回归。任一失败退出码 1。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || 9700 + Math.floor(Math.random() * 90);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-desk-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 2 : tol);
const px = (s) => parseFloat(String(s).replace('px', '')) || 0;

async function loadApp(w, h, urlSuffix) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' + (urlSuffix || '') });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){try{localStorage.setItem('xy-home-v2:__last-backup-ok',String(Date.now()));localStorage.setItem('xy-home-v2:__last-backup-remind',String(Date.now()));}catch(e){}var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return 1;})()");
  await sleep(800);
}

// ---- 1440×900：宽屏壳内锚定 ----
// ?pc=1 强制桌面外壳（应用自带 __layout-pref 通道）：headless 里 force-mobile 判定
// 有偶发（伪装兜底规则对仿真环境敏感），强制后断言环境确定；同时该形态正是用户电脑上的布局。
await loadApp(1440, 900, '?pc=1');
const env = JSON.parse(await evalJs("(function(){var ph=document.querySelector('.phone');var r=ph.getBoundingClientRect();return JSON.stringify({iw:innerWidth,ih:innerHeight,pl:r.left,pt:r.top,pr:r.right,pb:r.bottom});})()"));
const hGap = env.iw / 2 - 195;            // 壳左右沿距视口沿
const vGap = Math.max(24, env.ih / 2 - 422); // 壳上下沿距视口沿（900 高=28）

check('A0 前置：宽屏下手机壳宽 390 居中', near(env.pl, hGap, 3) && near(env.pr, env.iw - hGap, 3), '壳x=' + Math.round(env.pl) + ' gap=' + Math.round(hGap));

// 计算样式断言（stub 动态元素，同 CSS 类吃同一条媒体查询规则）
const csJson = JSON.parse(await evalJs("(function(){var pg=document.getElementById('page-group-chat');if(pg)pg.hidden=false;function probe(sel,cls){var el=document.querySelector(sel);if(!el){el=document.createElement('div');document.body.appendChild(el);}el.className=cls;el.hidden=false;el.style.display='flex';el.style.animation='none';var c=getComputedStyle(el);return {l:c.left,r:c.right,t:c.top,b:c.bottom};}var o={};o.vub=probe('#ver-update-bar','ver-update-bar');o.bub=probe('#backup-remind-bar','ver-update-bar');o.pwa=probe('#pwa-install','pwa-install');o.mgbar=probe('#cc-manage-bar','cc-manage-bar');o.loc=probe('#loc-panel','loc-panel');o.locf=probe('#loc-panel','loc-panel loc-full');o.mus=probe('#music-batch-bar','music-batch-bar');o.smf=probe('#sm-float','sm-float');o.gcs=probe('#gc-settings-panel','gc-settings-panel');o.gca=probe('#gc-at-panel','gc-at-panel');return JSON.stringify(o);})()") || '{}');

check('A1 顶部提醒条 top=壳顶 gap', near(px(csJson.vub.t), vGap), 'top=' + csJson.vub.t + ' 期望 ' + vGap);
check('A1 顶部提醒条 left/right=壳左右沿', near(px(csJson.vub.l), hGap) && near(px(csJson.vub.r), hGap), 'l=' + csJson.vub.l + ' r=' + csJson.vub.r + ' 期望 ' + hGap);
check('A2 备份提醒条（保护功能）同规则在位', near(px(csJson.bub.l), hGap) && near(px(csJson.bub.t), vGap), 'l=' + csJson.bub.l + ' t=' + csJson.bub.t);
check('A3 PWA 安装钮 right=壳右沿内缩16', near(px(csJson.pwa.r), hGap + 16), 'right=' + csJson.pwa.r + ' 期望 ' + (hGap + 16));
check('A3 PWA 安装钮 bottom=壳底沿下方16', near(px(csJson.pwa.b), vGap + 16), 'bottom=' + csJson.pwa.b + ' 期望 ' + (vGap + 16));
check('B1 字卡批量管理条=壳内18px', near(px(csJson.mgbar.l), hGap + 18) && near(px(csJson.mgbar.r), hGap + 18) && near(px(csJson.mgbar.b), vGap + 18), 'l=' + csJson.mgbar.l + ' r=' + csJson.mgbar.r + ' b=' + csJson.mgbar.b + ' 期望 ' + (hGap + 18));
check('B2 位置面板贴壳底通栏（壳宽）', near(px(csJson.loc.l), hGap) && near(px(csJson.loc.r), hGap) && near(px(csJson.loc.b), vGap), 'l=' + csJson.loc.l + ' r=' + csJson.loc.r + ' b=' + csJson.loc.b);
check('B2b 寻踪全屏（loc-full）=壳矩形', near(px(csJson.locf.l), hGap) && near(px(csJson.locf.r), hGap) && near(px(csJson.locf.t), vGap) && near(px(csJson.locf.b), vGap), 'l=' + csJson.locf.l + ' r=' + csJson.locf.r + ' t=' + csJson.locf.t + ' b=' + csJson.locf.b);
check('B3 音乐批量条贴壳底通栏（壳宽）', near(px(csJson.mus.l), hGap) && near(px(csJson.mus.r), hGap) && near(px(csJson.mus.b), vGap), 'l=' + csJson.mus.l + ' r=' + csJson.mus.r + ' b=' + csJson.mus.b);
check('B4 音乐悬浮小框=壳左内缩12/壳顶+80', near(px(csJson.smf.l), hGap + 12) && near(px(csJson.smf.t), vGap + 80), 'l=' + csJson.smf.l + ' t=' + csJson.smf.t + ' 期望 l=' + (hGap + 12) + ' t=' + (vGap + 80));
check('C1 群聊设置整页=壳矩形', near(px(csJson.gcs.l), hGap) && near(px(csJson.gcs.r), hGap) && near(px(csJson.gcs.t), vGap) && near(px(csJson.gcs.b), vGap), 'l=' + csJson.gcs.l + ' r=' + csJson.gcs.r + ' t=' + csJson.gcs.t + ' b=' + csJson.gcs.b);
check('C2 群聊@提及面板贴壳底（壳宽）', near(px(csJson.gca.l), hGap) && near(px(csJson.gca.r), hGap) && near(px(csJson.gca.b), vGap), 'l=' + csJson.gca.l + ' r=' + csJson.gca.r + ' b=' + csJson.gca.b);

// 真元素落位（unhide 后 rect 必须落在壳矩形内；关闭动画防上滑过渡期测到中间态；
// gc 面板嵌在 page-group-chat 内，需先显示宿主页）
const real = JSON.parse(await evalJs("(function(){var ph=document.querySelector('.phone');var pr=ph.getBoundingClientRect();var pg=document.getElementById('page-group-chat');if(pg)pg.hidden=false;function rect(sel){var el=document.querySelector(sel);if(!el)return null;el.hidden=false;el.style.animation='none';var r=el.getBoundingClientRect();return {l:Math.round(r.left),t:Math.round(r.top),r:Math.round(r.right),b:Math.round(r.bottom)};}return JSON.stringify({ph:{l:Math.round(pr.left),t:Math.round(pr.top),r:Math.round(pr.right),b:Math.round(pr.bottom)},vub:rect('#ver-update-bar'),loc:rect('#loc-panel'),gcs:rect('#gc-settings-panel')});})()") || '{}');
if (real.vub) {
  check('D1 提醒条真元素落位壳内（横向）', near(real.vub.l, real.ph.l, 3) && near(real.vub.r, real.ph.r, 3), '条=[' + real.vub.l + ',' + real.vub.r + '] 壳=[' + real.ph.l + ',' + real.ph.r + ']');
  check('D2 提醒条真元素不高于壳顶', real.vub.t >= real.ph.t - 3, '条顶=' + real.vub.t + ' 壳顶=' + real.ph.t);
}
if (real.loc) check('D3 位置面板真元素贴壳底', near(real.loc.b, real.ph.b, 3) && real.loc.l >= real.ph.l - 3 && real.loc.r <= real.ph.r + 3, '面板底=' + real.loc.b + ' 壳底=' + real.ph.b);
if (real.gcs) check('D4 群设置整页真元素=壳矩形', near(real.gcs.l, real.ph.l, 3) && near(real.gcs.r, real.ph.r, 3) && near(real.gcs.t, real.ph.t, 3), '页=[' + real.gcs.l + ',' + real.gcs.t + '→' + real.gcs.r + '] 壳=[' + real.ph.l + ',' + real.ph.t + '→' + real.ph.r + ']');

// ---- 390×844：手机端零影响（媒体查询不命中，原视口贴边保留） ----
// 清掉相位 1 的 ?pc=1 长期偏好，回到自动判定（390 宽自然命中手机布局）
await evalJs("(function(){try{localStorage.removeItem('xy-home-v2:__layout-pref');}catch(e){}return 1;})()");
await loadApp(390, 844);
const mob = JSON.parse(await evalJs("(function(){function probe(sel,cls){var el=document.querySelector(sel);if(!el){el=document.createElement('div');el.className=cls;document.body.appendChild(el);}var c=getComputedStyle(el);return {l:c.left,t:c.top,r:c.right};}var o={};o.vub=probe('#ver-update-bar','ver-update-bar');o.pwa=probe('#pwa-install','pwa-install');return JSON.stringify(o);})()") || '{}');
check('E1 手机端提醒条仍视口贴边（top=0）', px(mob.vub.t) === 0, 'top=' + mob.vub.t);
check('E2 手机端安装钮仍视口贴边（right=16）', px(mob.pwa.r) === 16, 'right=' + mob.pwa.r);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
