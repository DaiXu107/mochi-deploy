// ===== 专项验证：①离线消息提醒（Periodic Background Sync，零后端）②TA 分享自建字卡 =====
// A 组静态：SW 源/产物含 periodicsync 处理、模板锚点齐全、DEFAULTS/三处开关数组/
//           EXCLUDE 登记、ta-ask 触发器与 fg-resume 挂钩、bg-keep 快照与补投递导出。
// B 组运行时（无头 Chrome 跑最新构建产物）：
//   T1 测试钩子就位；T2 快照结构与非空兜底；T3 自建卡池过滤（排除语音/图片/链接/超长）；
//   T4 概率门控确定性触发（消息入库+initiative+tag）；T5 冷却去重；T6 开关关闭静默；
//   T7 离线队列按联系人安全补投递+幂等+异桌面保留；T8 设置页状态行渲染。
import { spawn } from 'node:child_process';
import { readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

let pass = 0, fail = 0;
function check(name, cond, detail) { console.log((cond ? '  [PASS] ' : '  [FAIL] ') + name + (detail !== undefined ? '  实际=' + JSON.stringify(detail) : '')); if (cond) pass++; else fail++; }

// ---------- A 组：静态 ----------
console.log('A组 静态断言');
const swSrc = readFileSync(join(root, 'src/pwa/sw.js'), 'utf8');
const swBuilt = readFileSync(join(root, 'sw.js'), 'utf8');
const tpl = readFileSync(join(root, 'src/template.html'), 'utf8');
const rset = readFileSync(join(root, 'src/js/reply-settings.js'), 'utf8');
const ctact = readFileSync(join(root, 'src/js/contacts.js'), 'utf8');
const task = readFileSync(join(root, 'src/js/ta-ask.js'), 'utf8');
const bkeep = readFileSync(join(root, 'src/js/bg-keep.js'), 'utf8');

check('A1 SW源含 periodicsync 监听与快照/队列键',
  swSrc.includes("addEventListener('periodicsync'") && swSrc.includes("'xy-home-v2:psync-snap'") && swSrc.includes("'xy-home-v2:psync-queue'"));
check('A2 构建产物 sw.js 已带 periodicsync 段', swBuilt.includes("addEventListener('periodicsync'") && swBuilt.includes('PSYNC_TAG'));
check('A3 notificationclick 仅处理 mochi-ta-msg 标签', swSrc.includes("e.notification.tag !== PSYNC_TAG"));
check('A4 设置页 psync-en 开关行 + psync-status 说明行',
  tpl.includes('id="psync-en"') && tpl.includes('id="psync-status"'));
check('A5 回复设置 ai-cc-en 开关行 + ai-cc-prob stepper(step=1)',
  tpl.includes('id="ai-cc-en"') && /data-k="ai-cc-prob"[^>]*data-step="1"/.test(tpl));
{
  const n = (rset.match(/'ai-rps-en', 'ai-game-en', 'ai-cuddle-en', 'ai-cc-en', 'ckq-en'\]/g) || []).length;
  const d = rset.includes("'ai-cc-en': 1") && rset.includes("'ai-cc-prob': 4");
  check('A6 DEFAULTS 声明 + 三处开关数组均含 ai-cc-en', d && n === 3, { arraysHit: n });
}
check('A7 contacts EXCLUDE 登记三个 psync 根键',
  ctact.includes("'psync-snap', 'psync-queue', 'psync-en']"));
check('A8 ta-ask 第五触发器：定义+定时器+fg-resume 挂钩+window 导出',
  task.includes('function maybeTriggerTACC()') && task.includes('setInterval(maybeTriggerTACC, 240000)') &&
  task.includes("typeof maybeTriggerTACC === 'function'") && task.includes('window.maybeTriggerTACC = maybeTriggerTACC'));
check('A9 bg-keep：快照/补投递导出 + 内置兜底池',
  bkeep.includes('window.__psyncBuildSnapshot') && bkeep.includes('window.__psyncDrain') && bkeep.includes('PSYNC_BUILTIN'));

// ---------- B 组：运行时 ----------
const tmpDir = mkdtempSync(join(tmpdir(), 'mochi-verify-psync-cc-'));
writeFileSync(join(tmpDir, 'index.html'), readFileSync(join(root, 'index.html'), 'utf8'));
writeFileSync(join(tmpDir, 'sw.js'), swBuilt);
writeFileSync(join(tmpDir, 'manifest.json'), readFileSync(join(root, 'manifest.json'), 'utf8'));
for (const f of ['icon-192.png', 'icon-512.png']) { try { writeFileSync(join(tmpDir, f), readFileSync(join(root, f))); } catch (e) {} }
const baseUrl = 'file:///' + normalize(tmpDir).split(sep).join('/') + '/index.html';
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 200));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-audio-output', '--disable-component-extensions-with-background-pages',
  '--user-data-dir=' + join(tmpdir(), 'mochi-psync-prof-' + Date.now()),
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
  if (r && r.exceptionDetails) { console.error('JS 异常:', String((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}

let ranB = false;
try {
  await cdpConnect();
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(800);
  await evalJs(`(function(){var b=document.querySelector('.splash-confirm-btn')||document.getElementById('splash-confirm-ok');if(b)b.click();var s=document.getElementById('splash');if(s)s.hidden=true;return true;})()`);
  await sleep(300);
  await evalJs(`(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()`);
  await sleep(400);
  ranB = true;
  console.log('B组 运行时断言');

  // T1 钩子就位
  const hooks = await evalJs(`({a:typeof window.__psyncBuildSnapshot,b:typeof window.__psyncDrain,c:typeof window.maybeTriggerTACC,d:typeof window.__taCcPool})`);
  check('T1 四个测试钩子全部暴露', !!hooks && hooks.a === 'function' && hooks.b === 'function' && hooks.c === 'function' && hooks.d === 'function', hooks);

  // T2 快照结构与兜底非空
  const snap = await evalJs(`window.__psyncBuildSnapshot().then(function(s){return {v:s.v,cid:s.cid,name:!!s.name,n:s.texts.length,kinds:s.texts.map(function(x){return x.k;}),plain:s.texts.every(function(x){return typeof x.t==='string'&&x.t&&x.t.length<=60&&x.t.indexOf('|||')<0&&x.t.indexOf('data:')!==0&&x.t.indexOf('http')!==0;})};})`);
  check('T2 快照 v1/cid/name/texts 非空且全为可发纯文本', !!snap && snap.v === 1 && snap.n > 0 && snap.plain === true, snap);

  // T3 自建卡池过滤（chatcard.js 内存缓存无外部刷新事件，按仓库惯例临时覆写
  // getCustomCards 提供数据源；__taCcPool 的过滤逻辑与触发链路均为真实代码）
  const seeded = await evalJs(`(function(){
    window.__origGetCustomCards = window.getCustomCards;
    window.getCustomCards = function(){ return ['今晚想吃火锅呀','data:image/png;base64,AAA','voice|||data:audio/mp3;base64,AA','https://x.com/a.png',''+'x'.repeat(80)]; };
    return JSON.stringify(window.__taCcPool());
  })()`);
  let pool = []; try { pool = JSON.parse(seeded); } catch (e) {}
  check('T3 池只留纯文本卡（排除 data:/https:/|||/>60字）', pool.length === 1 && pool[0] === '今晚想吃火锅呀', pool);

  // 准备确定性触发环境
  await evalJs(`(function(){
    var st=window.xyStore('xy-home-v2:default');
    st.set('reply-ai-cc-en','1'); st.set('reply-ai-cc-prob','100');
    st.set('ta-cc-state','{}'); st.set('interact-card-last','0');
    window.__origRandom=Math.random; Math.random=function(){return 0;};
    return true;})()`);
  const cntOf = `(function(){var m=window.getChatMsgs?window.getChatMsgs():[];var n=0;for(var i=0;i<m.length;i++){if(m[i]&&m[i].text==='今晚想吃火锅呀'&&m[i].side==='in')n++;}return n;})()`;
  const cnt0 = await evalJs(cntOf);

  // T4 确定性触发（断言只盯目标文本，其他模块的定时消息不构成干扰）
  await evalJs('window.maybeTriggerTACC(); true');
  await sleep(300);
  const hit4 = await evalJs(`(function(){var m=window.getChatMsgs?window.getChatMsgs():[];for(var i=m.length-1;i>=Math.max(0,m.length-10);i--){var l=m[i];if(l&&l.text==='今晚想吃火锅呀'&&l.side==='in')return {ini:!!l.initiative,tag:l.mood&&l.mood[0]&&l.mood[0].tag};}return null;})()`);
  check('T4 命中后 TA 发出自建卡文本（in/initiative/tag 来源标注）',
    !!hit4 && hit4.ini === true && hit4.tag === '用了你建的字卡', hit4);

  // T5 冷却：立刻二次调用不再发
  await evalJs('window.maybeTriggerTACC(); true');
  await sleep(200);
  const cnt2 = await evalJs(cntOf);
  check('T5 冷却生效（90 分钟内不重复触发）', cnt2 === cnt0 + 1, { cnt0, cnt2 });

  // T6 总开关关闭即静默
  await evalJs(`(function(){window.xyStore('xy-home-v2:default').set('reply-ai-cc-en','0');window.xyStore('xy-home-v2:default').set('ta-cc-state','{}');return true;})()`);
  await evalJs('window.maybeTriggerTACC(); true');
  await sleep(200);
  const cnt3 = await evalJs(cntOf);
  check('T6 ai-cc-en=0 时完全静默', cnt3 === cnt0 + 1, { cnt3 });
  await evalJs(`(function(){Math.random=window.__origRandom||Math.random;if(window.__origGetCustomCards)window.getCustomCards=window.__origGetCustomCards;return true;})()`);

  // T7 离线队列补投递：本桌面的投、别桌面的留、重复幂等
  await evalJs(`window.idbSet('xy-home-v2:psync-queue',[{t:'离线补投递测试消息ABC',cid:'default',ts:Date.now()-1000},{t:'别桌面的消息',cid:'otherdesk',ts:Date.now()}]);true`);
  const d1 = await evalJs('window.__psyncDrain(true)');
  await sleep(300);
  const qAfter = await evalJs(`window.idbGet('xy-home-v2:psync-queue')`);
  const hasAbc = await evalJs(`(function(){var m=window.getChatMsgs?window.getChatMsgs():[];for(var i=m.length-1;i>=Math.max(0,m.length-10);i--){if(m[i]&&m[i].text==='离线补投递测试消息ABC'&&m[i].side==='in')return true;}return false;})()`);
  check('T7a 补投递本桌面 1 条且入聊天记录', d1 === 1 && hasAbc === true, { d1, hasAbc });
  check('T7b 异桌面条目保留在队列', Array.isArray(qAfter) && qAfter.length === 1 && qAfter[0].cid === 'otherdesk', qAfter);
  const d2 = await evalJs('window.__psyncDrain(true)');
  check('T7c 二次 drain 幂等（已投递的不重发）', d2 === 0, d2);

  // T8 设置页状态行
  const ui = await evalJs(`(function(){var t=document.getElementById('psync-en');var s=document.getElementById('psync-status');return {t:!!t,s:!!s&&(s.textContent||'').length>0};})()`);
  check('T8 设置页开关与状态说明渲染', !!ui && ui.t === true && ui.s === true, ui);
} catch (e) {
  console.error('B组异常:', e && e.message || e); fail++;
} finally {
  try { if (ws) ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  try { rmSync(join(tmpdir(), 'mochi-psync-prof-' + cdpPort), { recursive: true, force: true }); } catch (e) {}
}
if (!ranB) console.error('(B组未执行——连接失败)');
console.log('\\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
