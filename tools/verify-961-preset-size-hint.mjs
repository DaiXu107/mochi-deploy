// ===== 回归脚本：#961 字卡库顶部标红提醒 + 二级密码解锁成功弹窗（行为断言）=====
// 用法：node tools/verify-961-preset-size-hint.mjs（需本机 Chrome/Edge；MOCHI_ROOT 指定隔离副本）
// 需求（用户直派）：①「默认聊天字卡」和「聊天默认字卡·词典」数量太多——在字卡库顶部标红提醒；
//   字卡太多、不适用时建议关闭词典；②这个提醒在解锁二级密码时也要弹窗说明给用户。
// 覆盖：
//   S1~S5 源码接线（文案唯一来源 / 两页红条容器 / default-cards 填充 / 红条视觉 / 模板锚点）
//   A1~A3 字卡库两页顶部红条：有文案、两页同文案、视觉为红色（计算色 = #b3261e）
//   B1~B2 锁定态 + 错密码 stay/hint（原行为未破）
//   B3~B5 对密码 → 弹「解锁成功 · 字卡使用提醒」（含体量提醒正文、只能点「知道了」关闭、页面尚未刷新）
//   B6~B7 点「知道了」→ 落库确认后确实刷新；刷新后已解锁且红条仍在
//   Z1 全程零 pageerror
// RED 基线（纯 HEAD + 仅哨兵行）：S1~S5 全红、A1~A3 全红、B3a/B3b/B4/B5/B7 全红
//   （B1/B2a/B2b/B6/Z1 两侧同绿＝防修过头闸：B6 只证「刷新链仍在」，必须与 B5 同看
//    才表示「提醒先弹、关掉后才刷新」＝本批语义）。
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.MOCHI_ROOT ? normalize(process.env.MOCHI_ROOT) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exe = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!exe) { console.log('SKIP: 本机没有 Chrome/Edge'); process.exit(2); }

const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const TIP = '字卡太多不用全开';

let pass = 0, fail = 0;
const results = [];
function check(d, ok, detail) {
  results.push(!!ok);
  if (ok) { pass++; console.log('  PASS ' + d); } else { fail++; console.log('  FAIL ' + d + (detail ? '  [' + detail + ']' : '')); }
}

// ---------------- S：源码接线（绿/红副本都能读，红副本应全红） ----------------
console.log('— S 源码接线 —');
{
  const cl = read('src/js/card-lock.js');
  const dc = read('src/js/default-cards.js');
  const clock = read('src/js/clock.js');
  const tpl = read('src/template.html');
  const css = read('src/css/setting.css');
  check('S1 文案唯一来源在 card-lock.js（window.mochiPresetSizeTip 且以「' + TIP + '」开头）',
    cl.includes("window.mochiPresetSizeTip = '" + TIP), 'card-lock.js 缺常量');
  check('S2 default-cards.js 填充两个红条容器（#dc-size-hint / #dict-size-hint）',
    dc.includes("['dc-size-hint', 'dict-size-hint'].forEach"), 'default-cards.js 未接填充');
  check('S3 模板两个红条锚点齐备（默认聊天字卡页 + 词典页）',
    tpl.includes('id="dc-size-hint"') && tpl.includes('id="dict-size-hint"'),
    [!tpl.includes('id="dc-size-hint"') && '缺 dc-size-hint', !tpl.includes('id="dict-size-hint"') && '缺 dict-size-hint'].filter(Boolean).join('；'));
  check('S4 红条视觉复用 #390 领词典锁定条（.dc-size-hint 并入同一红色规则）',
    css.includes('.dict-lock-hint, .dc-size-hint {'), 'setting.css 未并入 .dc-size-hint');
  check('S5 clock.js 解锁成功后弹提醒 + #1497 解锁就地生效（不刷新）',
    clock.includes("window.openModal('解锁成功 · 字卡使用提醒'") &&
    clock.includes("okState.textContent = '验证通过'") &&
    !clock.includes("cardLockConfirmPersisted('open', goReloadAfterPersist)"),
    [!clock.includes("window.openModal('解锁成功 · 字卡使用提醒'") && '缺弹窗',
      !clock.includes("okState.textContent = '验证通过'") && '缺就地生效锚',
      clock.includes("cardLockConfirmPersisted('open', goReloadAfterPersist)") && '#404 解锁刷新锚仍在＝会话闸死循环回流'].filter(Boolean).join('；'));
}

// ---------------- 起无头浏览器 + 静态服务 ----------------
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0] || '/')));
  if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try { if (statSync(p).isDirectory()) p = join(p, 'index.html'); } catch (e) { res.writeHead(404); res.end('nf'); return; }
  try { res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); }
  catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9990 + Math.floor(Math.random() * 40);
const chrome = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-961-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
const pageErrors = [];
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
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
          if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params && m.params.exceptionDetails;
            pageErrors.push((d && (d.exception && d.exception.description || d.text)) || 'unknown');
          }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('no cdp');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expr) { try { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true }); return r && r.result ? r.result.value : null; } catch (e) { return null; } }
async function waitReady() {
  // 就绪判据不挂本批新增锚点（#dc-size-hint）——否则纯 HEAD 红副本会「页面没就绪」，
  // 后面所有 UI 断言一起变成无法归因的红，红基线失去判别力。
  for (let i = 0; i < 60; i++) {
    if (await ev('document.readyState==="complete" && typeof window.cardLockOpen==="function" && !!document.getElementById("dc-list")')) return true;
    await sleep(250);
  }
  return false;
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
console.log('— 1 启动 —');
check('startup 页面就绪', await waitReady());

// ---------------- A：字卡库顶部标红提醒 ----------------
console.log('— A 字卡库顶部标红提醒 —');
const bannerText = 'String((function(){var e=document.getElementById("dc-size-hint");return e?e.textContent:null;})())';
check('A1 默认聊天字卡页顶部红条有文案且含「' + TIP + '」',
  await ev('(function(){var e=document.getElementById("dc-size-hint");return !!(e&&e.textContent.indexOf("' + TIP + '")>-1);})()') === true,
  String(await ev(bannerText)).slice(0, 60));
check('A2 词典页顶部红条有文案且与默认聊天字卡页同一份',
  await ev('(function(){var a=document.getElementById("dc-size-hint"),b=document.getElementById("dict-size-hint");return !!(a&&b&&b.textContent&&b.textContent===a.textContent);})()') === true);
check('A3 红条视觉为红色（计算色 = rgb(179, 38, 30) ＝ #b3261e）',
  await ev('(function(){var e=document.getElementById("dc-size-hint");if(!e)return null;var c=getComputedStyle(e).color;return (c==="rgb(179, 38, 30)"||c==="rgba(179, 38, 30, 1)")?true:c;})()') === true,
  String(await ev('(function(){var e=document.getElementById("dc-size-hint");return e?getComputedStyle(e).color:"no-el";})()')));

// ---------------- B：二级密码解锁成功弹窗 ----------------
console.log('— B 二级密码解锁流程 —');
check('B1 起始为锁定态', await ev('window.cardLockOpen()===false') === true);
// 错密码：stay + hint（原行为未破）
await ev('document.querySelector("#splash-cardlock-actions .cardlock-btn").click()');
await sleep(700);
check('B2a 解锁弹窗打开', await ev('(function(){var m=document.getElementById("modal-mask");return !!m&&!m.hidden;})()') === true);
await ev('(function(){var i=document.getElementById("modal-input");if(i)i.value="000000";var b=document.getElementById("modal-ok");if(b)b.click();return true;})()');
await sleep(500);
check('B2b 错密码 stay（弹窗未关）+ 提示文案',
  await ev('(function(){var m=document.getElementById("modal-mask"),s=document.getElementById("modal-static");return !!m&&!m.hidden&&!!s&&!s.hidden&&s.textContent.indexOf("密码不对")>-1;})()') === true);
await ev('window.__m961mark="A";');
await ev('(function(){var i=document.getElementById("modal-input");if(i)i.value="990815";var b=document.getElementById("modal-ok");if(b)b.click();return true;})()');
await sleep(1200);
const noticeTitle = 'String((function(){var t=document.querySelector(".modal-t")||document.querySelector("#modal-mask .modal-title");return t?t.textContent:"";})())';
const noticeStatic = 'String((function(){var s=document.getElementById("modal-static");return s?s.textContent:"";})())';
check('B3a 对密码后弹「解锁成功 · 字卡使用提醒」',
  String(await ev(noticeTitle)).indexOf('解锁成功 · 字卡使用提醒') > -1, String(await ev(noticeTitle)).slice(0, 40));
check('B3b 提醒正文含体量提醒全文（与字卡库红条同一份文案）',
  String(await ev(noticeStatic)).indexOf('字卡太多不用全开') > -1 &&
  String(await ev(noticeStatic)).indexOf('建议把词典关掉') > -1);
check('B4 提醒弹窗不可点遮罩/取消绕过（取消按钮隐藏＝只能点「知道了」）',
  await ev('(function(){var c=document.getElementById("modal-cancel");return !!c&&c.hidden===true;})()') === true);
check('B5 提醒未关时页面尚未刷新（标记还在）', await ev('window.__m961mark==="A"') === true);
// 点「知道了」→ 关提醒；#1497 解锁就地生效＝不刷新（刷新会话闸下＝当场打回锁定）
await ev('(function(){var b=document.getElementById("modal-ok");if(b)b.click();return true;})()');
let reloaded = false;
for (let i = 0; i < 10; i++) {
  await sleep(300);
  if (await ev('typeof window.__m961mark==="undefined"') === true) { reloaded = true; break; }
}
check('B6 #1497 点「知道了」后不刷新（解锁就地保持）', reloaded === false && await ev('window.cardLockOpen()===true') === true);
await sleep(600);
check('B7 解锁保持且字卡库红条仍在',
  await ev('window.cardLockOpen()===true') === true &&
  await ev('(function(){var e=document.getElementById("dc-size-hint");return !!(e&&e.textContent.indexOf("' + TIP + '")>-1);})()') === true);
check('Z1 全程零 pageerror', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

console.log('\nverify-961：通过 ' + pass + ' / 断言失败 ' + fail);
try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(fail ? 1 : 0);
