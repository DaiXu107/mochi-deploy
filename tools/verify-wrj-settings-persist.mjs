// ===== 回归验证：小键写日志（__wr-journal）修「Edge 杀进程回滚 LS → 设置开关回退」 =====
// 背景（FIX-REGRESSION #40）：荣耀 200 Pro Edge 上切设置开关后很快退出浏览器，
// Edge 把 localStorage 最近一次磁盘提交整批回滚（同步 setItem 不报错但落盘丢失）；
// 重启后 idbRestore retainValue 以「LS 有值且未标脏」为准 → 永远取回回滚后的旧值，
// 设置回退（Via/雨见等 WebView 系浏览器无此回滚故正常）。
// 修复：xyStore.set 对 ≤64KB 值同步记 {k,v,t} 进 __wr-journal（LS+IDB 双持久化）；
//       启动同步回放 LS 日志；restore 完成后异步合并 IDB 日志并广播 mochi-wrj-heal。
// 场景：
//   T1 LS 值被回滚、LS 日志幸存 → 同步回放恢复（先于模块初始化读值）
//   T2 LS 值与 LS 日志同批回滚、IDB 日志幸存 → restore 完成后异步合并恢复 + heal 事件
//   T3 dc-use-feed 同 T1（defaultCardUse 读取正确）
//   T4 本会话新写入不被旧日志覆盖（时间戳守卫）
// 用法：node tools/verify-wrj-settings-persist.mjs   （CHANNEL=chrome 可选）
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const engine = process.env.BROWSER || 'chromium';
const channel = process.env.CHANNEL || undefined;
const { chromium } = await import('playwright');
const browser = await chromium.launch(channel ? { channel } : undefined);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
// heal 事件计数跨 reload 持久（sessionStorage），否则 reload 后监听器丢失
await ctx.addInitScript("(function(){ try { if (sessionStorage.getItem('wrj-heal-count') === null) sessionStorage.setItem('wrj-heal-count','0'); } catch (e) {} document.addEventListener('mochi-wrj-heal', function () { try { sessionStorage.setItem('wrj-heal-count', String((parseInt(sessionStorage.getItem('wrj-heal-count') || '0', 10) || 0) + 1)); } catch (e) {} }); })();");

async function boot() {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 25000 });
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate('!!window.__mochiDataReady')) break;
    await sleep(300);
  }
  await page.evaluate("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(800);
  await sleep(1500);
}

// 等 IDB 里出现该键的写标记 __wr-j:<key>（idbSet 异步，轮询到提交完成）
async function waitIdbJournal(key, val) {
  for (let i = 0; i < 25; i++) {
    const ok = await page.evaluate(`(async function(){
      try {
        if (!window.idbGet) return false;
        const t = await window.idbGet('xy-home-v2:__wr-j:' + ${JSON.stringify(key)});
        return typeof t === 'number' && t > 0;
      } catch (e) { return false; }
    })()`);
    if (ok) return true;
    await sleep(200);
  }
  return false;
}

async function storeGet(key) {
  return page.evaluate(`(function(){ try { return window.activeStore().get(${JSON.stringify(key)}); } catch (e) { return '(err)'; } })()`);
}

// ---------- 会话 A：写入开关（journal 应记录） ----------
await boot();
check('T0 开屏数据就绪无 JS 错误', pageErrors.length === 0, pageErrors[0] || '');

await page.evaluate("(function(){ window.activeStore().set('cs-voice-send','1'); window.activeStore().set('dc-use-feed','0'); return true; })()");
check('T0.1 会话 A：写入后读取正确', (await storeGet('cs-voice-send')) === '1' && (await storeGet('dc-use-feed')) === '0');
const j1 = await waitIdbJournal('xy-home-v2:default:cs-voice-send', '1');
const j2 = await waitIdbJournal('xy-home-v2:default:dc-use-feed', '0');
check('T0.2 写日志已持久化进 IDB（cs-voice-send / dc-use-feed）', j1 && j2);

// heal 事件监听（addInitScript 已注册，sessionStorage 计数跨 reload 有效）

// ---------- 模拟 Edge 杀进程回滚：T2 场景 —— LS 值 + LS 日志同批回滚 ----------
await page.evaluate("(function(){ try { localStorage.setItem('xy-home-v2:default:cs-voice-send','0'); localStorage.setItem('xy-home-v2:default:dc-use-feed','1'); localStorage.removeItem('xy-home-v2:__wr-journal'); } catch (e) {} return true; })()");
check('T0.3 已模拟回滚：LS 值=旧值、LS 日志被清', (await page.evaluate("localStorage.getItem('xy-home-v2:default:cs-voice-send')")) === '0');

// ---------- 会话 B：重启（T2：LS 日志没了，靠 IDB 日志异步合并） ----------
await boot();
let healed = false;
for (let i = 0; i < 25; i++) {
  const v = await storeGet('cs-voice-send');
  if (v === '1') { healed = true; break; }
  await sleep(200);
}
check('T2 LS 值+LS 日志同批回滚后，重启经 IDB 日志合并恢复 cs-voice-send=1', healed, 'get=' + (await storeGet('cs-voice-send')));
let healedFeed = false;
for (let i = 0; i < 25; i++) {
  if ((await storeGet('dc-use-feed')) === '0') { healedFeed = true; break; }
  await sleep(200);
}
check('T2 同链路恢复 dc-use-feed=0', healedFeed, 'get=' + (await storeGet('dc-use-feed')));
check('T2 广播了 mochi-wrj-heal 事件', (await page.evaluate("sessionStorage.getItem('wrj-heal-count')")) >= '1');

// ---------- T4：本会话新写入不被旧日志覆盖 ----------
await page.evaluate("(function(){ window.activeStore().set('cs-voice-send','0'); return true; })()");
await sleep(300);
check('T4 会话内改回 0 立即生效（日志时间戳守卫）', (await storeGet('cs-voice-send')) === '0');
// 再模拟一次「值回滚、日志幸存」的重启（T1：同步回放路径）
await page.evaluate("(function(){ try { localStorage.setItem('xy-home-v2:default:cs-voice-send','1'); } catch (e) {} return true; })()"); // 模拟旧值残留？不——T1 应是：会话写 0 后 LS 被回滚成更旧的 1，日志(0)幸存
await boot();
check('T1 LS 值被回滚成旧值、日志(0)幸存 → 同步回放恢复 0', (await storeGet('cs-voice-send')) === '0', 'get=' + (await storeGet('cs-voice-send')));

// ---------- T3：dc-use 读取接口（defaultCardUse） ----------
check('T3 defaultCardUse("feed") === false（朋友圈使用关闭已持久化）', await page.evaluate('window.defaultCardUse("feed") === false'));

await browser.close();
server.close();
const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过' + (fails ? '（存在失败！）' : ''));
process.exit(fails ? 1 : 0);
