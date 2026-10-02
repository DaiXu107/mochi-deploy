// ===== 专项脚本：主页新增「摸鱼抓包」双向记录（v3.15.x） =====
// 用法：node build.mjs && node tools/verify-fish-catch-record.mjs
// 背景（用户需求）：
//   把「我抓到联系人摸鱼」（p2-features.js 桌面浮字点击抓包成功）与
//   「被联系人抓到我摸鱼」（personalize.js 摸鱼+1 点太快被反向抓包）两类事件
//   写入主页记录：新 tab「摸鱼抓包」，最新在前，全量保留不设上限（用户要求），按桌面隔离。
// 验证：
//   A 组静态（读 src 源码）：template 新 tab/面板锚点齐全；records.js 导出
//     addFishCatchRecord + 渲染接线；p2-features 抓包成功写 'me' 记录；
//     personalize 被 TA 抓包写 'ta' 记录；功能介绍页文案同步。
//   B 组运行时（构建产物）：API 存在；写入两条 → 主页「摸鱼抓包」tab 渲染出
//     双向条目（含昵称/时间/详情）；上限 50 条裁剪；空态文案；存储键按桌面命名；
//     全程无 JS 异常。
// 说明：真实触发路径依赖 60s 定时器与随机概率，无头环境以静态断言覆盖触发点，
//   运行时直接走 addFishCatchRecord 公共入口（records.js 真实代码路径）。

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- A 组：静态断言 ----------------
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

const tpl = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const recSrc = readFileSync(join(root, 'src', 'js', 'records.js'), 'utf8');
const p2Src = readFileSync(join(root, 'src', 'js', 'p2-features.js'), 'utf8');
const perSrc = readFileSync(join(root, 'src', 'js', 'personalize.js'), 'utf8');

check('A1 template 主页新增「摸鱼抓包」tab 按钮', tpl.includes('data-htab="catch"') && tpl.includes('>摸鱼抓包</button>'));
check('A2 template catch 面板 + home-catch 容器', /data-hpanel="catch"[^>]*hidden/.test(tpl) && tpl.includes('id="home-catch"'));
check('A3 records.js 导出 addFishCatchRecord 且键为 records-fishcatch', recSrc.includes('window.addFishCatchRecord') && recSrc.includes("records-fishcatch"));
check('A4 records.js 渲染接线 htab=catch', /showOnly === 'catch'[\s\S]{0,60}renderCatch\(\)/.test(recSrc));
check('A5 records.js 双向标签（抓到 TA 摸鱼 / TA 抓到我摸鱼）', recSrc.includes('抓到 ') && recSrc.includes(' 抓到我摸鱼'));
check('A6 p2-features 抓包成功写入 me 记录', /addFishCatchRecord\('me'/.test(p2Src) && p2Src.indexOf('fish-catch-day') < p2Src.indexOf("addFishCatchRecord('me'"));
check('A7 personalize 被反向抓包写入 ta 记录', /addFishCatchRecord\('ta'/.test(perSrc) && perSrc.indexOf('fish-caught-me:last') < perSrc.indexOf("addFishCatchRecord('ta'"));
check('A8 功能介绍页主页统计文案已含摸鱼抓包', tpl.includes('摸鱼抓包（我抓到 TA / 被 TA 抓到 双向记录）'));

if (!results.every(r => r.ok)) { console.log('\n静态断言未全绿，停止运行时验证'); process.exit(1); }

// ---------------- 运行时准备 ----------------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const { spawn } = await import('node:child_process');
const { createServer } = await import('node:http');
const { rmSync } = await import('node:fs');
const { normalize, extname } = await import('node:path');

const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const tmpProfile = join(process.env.TEMP || '/tmp', 'mochi-fishcatch-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + tmpProfile,
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} try { rmSync(tmpProfile, { recursive: true, force: true }); } catch (e) {} });

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
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 500)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);

const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

// ---- T1 API 已导出 ----
const t1 = await evalJs('typeof window.addFishCatchRecord');
check('T1 addFishCatchRecord 已导出', t1 === 'function', String(t1));

// ---- T2 写入双向两条 → 主页「摸鱼抓包」tab 正确渲染 ----
await evalJs("(function(){window.addFishCatchRecord('me','抓包成功！双方摸鱼值 +3');window.addFishCatchRecord('ta','点这么快，老板就在身后吧？这次给你记成工作值啦。');return true;})()");
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-phone');});var a=document.querySelector('.app[data-app=\"home\"]');if(a)a.click();return true;})()");
await sleep(600);
await evalJs("(function(){var t=document.querySelector('#page-home .fav-tab[data-htab=\"catch\"]');if(t)t.click();return true;})()");
await sleep(400);
const t2 = J(await evalJs("(function(){var panel=document.querySelector('#page-home .cal-card[data-hpanel=\"catch\"]');var el=document.getElementById('home-catch');var items=el?el.querySelectorAll('.tc-listitem'):[];var txt=el?el.textContent:'';return JSON.stringify({panelOpen:panel?!panel.hidden:false,n:items.length,meHit:/抓到 .+ 摸鱼/.test(txt),taHit:/.+ 抓到我摸鱼/.test(txt),bonus:txt.indexOf('+3')>=0,detail:txt.indexOf('老板就在身后')>=0,time:items.length?!!items[0].querySelector('.tc-li-time'):false,name:txt.match(/抓到 (.+?) 摸鱼/)?txt.match(/抓到 (.+?) 摸鱼/)[1]:''});})()"));
check('T2 catch tab 打开且渲染 2 条双向记录', t2.panelOpen && t2.n === 2, JSON.stringify(t2));
check('T3 我抓到 TA 行含昵称/奖励详情', t2.meHit && t2.bonus, t2.name + ' / +3');
check('T4 被 TA 抓到行含调侃详情', t2.taHit && t2.detail);
check('T5 条目带时间戳', t2.time);

// ---- T6 不设上限：全部保留且最新在前 ----
await evalJs("(function(){for(var i=0;i<55;i++)window.addFishCatchRecord(i%2?'ta':'me','压测 '+i);return true;})()");
const t6 = J(await evalJs("(function(){try{var arr=JSON.parse(localStorage.getItem('xy-home-v2:default:records-fishcatch')||'[]');return JSON.stringify({len:arr.length,newest:arr[0]&&arr[0].text||''});}catch(e){return JSON.stringify({len:-1,err:String(e)});}})()"));
check('T6 记录不裁剪全量保留（57 条）且最新在前', t6.len === 57 && t6.newest === '压测 54', JSON.stringify(t6));

// ---- T7 空态文案 ----
await evalJs("(function(){window.activeStore().remove('records-fishcatch');var t=document.querySelector('#page-home .fav-tab[data-htab=\"av\"]');if(t)t.click();var c=document.querySelector('#page-home .fav-tab[data-htab=\"catch\"]');if(c)c.click();return true;})()");
await sleep(300);
const t7 = J(await evalJs("(function(){var el=document.getElementById('home-catch');return JSON.stringify({empty:el?el.textContent.indexOf('暂无摸鱼抓包记录')>=0:false});})()"));
check('T7 清空后显示空态文案', t7.empty);

// ---- T8 无 JS 异常 ----
const errs = await evalJs('JSON.stringify(window.__jsErrors || [])');
check('T8 全程无 JS 异常', errs === '[]', String(errs));

chrome.kill();
server.close();
const fails = results.filter(r => !r.ok);
console.log('\n===== 结果：' + (results.length - fails.length) + '/' + results.length + ' 通过 =====');
process.exit(fails.length ? 1 : 0);
