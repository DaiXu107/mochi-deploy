// 应用内「清除本地数据」彻底性行为断言（#353 / #551）：
// #353 根因＝数据双写 LS+IDB，旧逻辑只 idbClearAll（objectStore.clear()）且用
//   ||Promise.resolve(true) 掩盖失败＝清库事务失败时只清 LS、IDB 残留，启动 idbRestore
//   全量回填＝专属字卡（LS-only）真丢、其余内容全复活（红米 K70/多机型实测）。
//   修复＝idb.js 新增 idbDestroy（deleteDatabase 真删库，回填无源可依）+ personalize.js
//   清除逻辑优先真删库、失败退回 idbClearAll，去掉掩盖失败的 ||true。
// #551 根因（同族第二次复发，红米 K70 Chrome 及多机型）＝清除范围只有「当前桌面命名空间
//   xy-home-v2:<cid>:* + 2 个裸键」，根命名空间全局键（联系人列表、公用字卡
//   cc-groups-public、我的表情包 my-emoji-groups、存钱罐 piggy-*、桌面美化等）与
//   其他联系人的整个命名空间全部残留＝「没有把本地的所有数据清空」（确定性、与机型无关）。
//   修复＝清除范围升级为「全部 xy-home-v2:* 键 + 裸键」（wipeAppKeys 助手），
//   且 reload 前再补一刀（清窗口期内未挂 __resetting 屏障的模块可能重写键）。
// 用法：node tools/verify-clear-local-data.mjs        （静态 + 无头行为断言）
//       RESET_RED=1 node tools/verify-clear-local-data.mjs
//         （RED 基线：仅在内存拼装页里把清除范围回退成旧 activePrefix 逻辑，不动 src，
//           用于验证行为断言真的抓得住本次回归——预期 other-ns/root 等探针残留＝FAIL）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RED = !!process.env.RESET_RED;
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => readFileSync(join(root, 'src', p), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};

const idb = read('js/idb.js');
const pers = read('js/personalize.js');

if (!RED) {
  console.log('—— 静态断言 ——');
  // D1 真删库函数存在：deleteDatabase 是「连库删除」的唯一定性锚，clear 没有这个调用
  check('D1 idb.js 用 deleteDatabase 真删库', /indexedDB\.deleteDatabase\(DB_NAME\)/.test(idb), 'deleteDatabase 到位');
  // D2 删库前关闭现有连接（不关闭会被自身连接 onblocked 阻塞而永不落地）
  check('D2 删库前 db.close 释放连接', /d\.close\(\)/.test(idb), '先关连接再删库');
  // D3 有超时兜底，删库被其它连接占用时不永久挂起（复用 #135 防挂死经验）
  check('D3 删库带超时兜底', /setTimeout\(\(\) => fin\(false\), 6000\)/.test(idb), '6s 兜底');
  // D4 personalize 优先调 idbDestroy（真删库优先）
  check('D4 清除数据优先真删库', /window\.idbDestroy && window\.idbDestroy\(\)/.test(pers), '优先 idbDestroy');
  // D5 去掉掩盖失败的 ||Promise.resolve(true)——这是「只清 LS、IDB 残留回填复活」的直接元凶
  check('D5 不再用 ||true 掩盖清库失败', !/idbClearAll && window\.idbClearAll\(\)\) \|\| Promise\.resolve\(true\)/.test(pers), '无 ||true 掩盖');
  // D6 失败回退到 idbClearAll（仍保有兜底路径，不因删库失败而完全不清）
  check('D6 删库失败退回 idbClearAll', /idbClearAll && window\.idbClearAll\(\)\) \|\| Promise\.resolve\(false\)/.test(pers), '退回 clear');
  // S7 #551 清除范围=全部 xy-home-v2 键（wipeAppKeys 助手 + 全前缀过滤）
  check('S7 清除范围升级为全部 xy-home-v2 键', pers.indexOf("const wipeAppKeys = function () {") >= 0 && pers.indexOf(".filter(k => k.indexOf('xy-home-v2:') === 0 || BARE_KEYS.indexOf(k) >= 0)") >= 0, 'wipeAppKeys 全前缀 wipe');
  // S8 旧范围（只清 activePrefix）已不在重置链里——回流即「其他桌面/公用数据残留」
  check('S8 旧「仅当前命名空间」过滤已移除', pers.indexOf("k.indexOf(window.activePrefix() + ':') === 0 || BARE_KEYS") < 0, 'activePrefix 过滤已退场');
  // S9 reload 前补刀（清窗口期重写键）
  check('S9 reload 前再补一刀 wipe', pers.indexOf('idbDone.then(() => { wipeAppKeys(); try { location.reload(); } catch (e) {} });') >= 0, 'idbDone.then 内先 wipe 再 reload');
  // S10 settings-help 机制文案与行为对齐（旧「只清当前桌面命名空间」说明必须消失）
  const sh = read('js/settings-help.js');
  check('S10 settings-help 文案已对齐全量清除', sh.indexOf('只清当前桌面命名空间') < 0 && sh.indexOf('所有联系人桌面') >= 0, '机制说明与行为一致');
  // R1 回归清单已登记（防修复被并行会话/旧缓冲覆盖而无人察觉）
  try {
    const fx = readFileSync(root + '/FIX-REGRESSION.md', 'utf8');
    check('R1 FIX-REGRESSION 已登记 #353/#551', fx.indexOf('#353') >= 0 && fx.indexOf('#551') >= 0 && fx.indexOf('清除本地数据') >= 0, '清单在位');
  } catch (e) { check('R1 FIX-REGRESSION 已登记 #353/#551', false, '清单读取失败'); }
  // R2 哨兵已在 build.mjs 登记
  try {
    const bm = readFileSync(root + '/build.mjs', 'utf8');
    check('R2 build.mjs 登记 #353/#551 哨兵', /idbDestroy \(|deleteDatabase\(DB_NAME\)/.test(bm) && bm.indexOf("#551a") >= 0 && bm.indexOf("#551b") >= 0, '哨兵在位');
  } catch (e) { check('R2 build.mjs 登记 #353/#551 哨兵', false, 'build.mjs 读取失败'); }
}

// —— 行为断言（无头 Chrome，内存拼装 src，与 build.mjs 同序、不写产物） ——
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const arr = (name) => new Function('return ' + bm.match(new RegExp('const ' + name + ' = (\\[.*?\\]);', 's'))[1])();
const css = arr('cssFiles').map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
let js = arr('jsFiles').map((f) => readFileSync(join(root, 'src', 'js', f), 'utf8')).join('\n');
let html = read('template.html').replace('__APP_VERSION__', 'v3.26.0-test');
html = html.replace('</head>', '<style>' + css + '</style></head>');
html = html.replace('</body>', '<script>' + js + '<\/script></body>');

if (RED) {
  // 内存里把清除范围回退成旧逻辑（只清当前命名空间）——模拟回归，不动 src
  const NEW_SCOPE = ".filter(k => k.indexOf('xy-home-v2:') === 0 || BARE_KEYS.indexOf(k) >= 0)";
  const OLD_SCOPE = ".filter(k => k.indexOf(window.activePrefix() + ':') === 0 || BARE_KEYS.indexOf(k) >= 0)";
  if (!html.includes(NEW_SCOPE)) { console.error('RED 补丁锚点没找到（src 已变？）'); process.exit(1); }
  html = html.replace(NEW_SCOPE, OLD_SCOPE);
  console.log('—— RED 基线模式：内存回退为旧「仅当前命名空间」清除范围 ——');
}

const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
  const map = { '/manifest.json': 'pwa/manifest.json', '/notice.json': 'pwa/notice.json', '/sw.js': 'pwa/sw.js', '/version.json': null };
  if (url in map && map[url]) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(read(map[url])); return; }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，跳过行为断言'); process.exit(fail ? 1 : 0); }
const cdpPort = 9900 + Math.floor(Math.random() * 150);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-cld-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
chrome.on('error', () => {}); // 启动失败走下方连接超时路径，不让 error 事件炸进程
process.on('exit', () => { try { chrome.kill(); } catch (e) {} });

let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 60 && !ws; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器，跳过行为断言'); process.exit(fail ? 1 : 0); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expr) { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : undefined; }

console.log('—— 行为断言（无头） ——');
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Page.navigate', { url: baseUrl + '/' });
await sleep(2600);
await ev(`(()=>{ const s=document.getElementById('splash'); if(s) s.remove(); const q=document.getElementById('qa-mask'); if(q) q.hidden=true; })()`);

// B1 播种探针：当前命名空间 / 其他桌面命名空间 / 根命名空间全局键 / 裸键 / 外部键 / IDB
const seeded = await ev(`(async()=>{
  localStorage.setItem('xy-home-v2:default:zz-reset-probe','A');
  localStorage.setItem('xy-home-v2:other1:zz-reset-probe','B');
  localStorage.setItem('xy-home-v2:zz-root-probe','R');
  localStorage.setItem('divine-history','D');
  localStorage.setItem('zz-foreign-key','T');
  await window.idbSet('xy-home-v2:default:zz-idb-probe','I');
  return [localStorage.getItem('xy-home-v2:default:zz-reset-probe'),localStorage.getItem('xy-home-v2:other1:zz-reset-probe'),localStorage.getItem('xy-home-v2:zz-root-probe'),localStorage.getItem('divine-history'),localStorage.getItem('zz-foreign-key')].join('|');
})()`);
check('B1 探针播种到位（当前ns|其他ns|根|裸键|外部键）', seeded === 'A|B|R|D|T', String(seeded));

// B2 点「清除本地数据」→ 弹确认框
await ev(`document.getElementById('row-reset').click()`);
await sleep(300);
const modalTitle = await ev(`(document.getElementById('modal-title')||{}).textContent || ''`);
const modalOkVisible = await ev(`(()=>{const b=document.getElementById('modal-ok'); if(!b) return false; const r=b.getBoundingClientRect(); return !b.hidden && r.width>0;})()`);
check('B2 点击后弹「确认清除所有本地数据」确认框', String(modalTitle).indexOf('确认清除所有本地数据') >= 0 && !!modalOkVisible, String(modalTitle).slice(0, 24) + '…');

// B3 确认 → 清库 → 自动 reload（canary 随执行上下文重置消失即视为已重载）
await ev(`window.__zzCanary = 1`);
await ev(`document.getElementById('modal-ok').click()`);
let reloaded = false;
for (let i = 0; i < 50; i++) {
  await sleep(300);
  if (await ev(`window.__zzCanary`) === undefined) { reloaded = true; break; }
}
check('B3 确认后自动重载', reloaded);
if (reloaded) {
  await sleep(3000); // 等启动回填/首屏渲染
  const gone = await ev(`[
    localStorage.getItem('xy-home-v2:default:zz-reset-probe'),
    localStorage.getItem('xy-home-v2:other1:zz-reset-probe'),
    localStorage.getItem('xy-home-v2:zz-root-probe'),
    localStorage.getItem('divine-history'),
    localStorage.getItem('xy-home-v2:age-confirmed')
  ].map(v => v === null || v === undefined ? 'N' : String(v)).join('|')`);
  check('B4 当前桌面命名空间探针已清', gone.split('|')[0] === 'N', gone.split('|')[0]);
  // #551 核心：旧逻辑就是漏掉下面三类
  check('B5 其他桌面命名空间探针已清（#551 主症状）', gone.split('|')[1] === 'N', gone.split('|')[1]);
  check('B6 根命名空间全局键探针已清（#551 主症状）', gone.split('|')[2] === 'N', gone.split('|')[2]);
  check('B7 裸键 divine-history / age-confirmed 已清', gone.split('|')[3] === 'N' && gone.split('|')[4] === 'N', gone.split('|')[3] + '/' + gone.split('|')[4]);
  const foreign = await ev(`localStorage.getItem('zz-foreign-key')`);
  check('B8 非本应用外部键不受牵连', foreign === 'T', String(foreign));
  const idbProbe = await ev(`(async()=>{ const v = await window.idbGet('xy-home-v2:default:zz-idb-probe'); return v === undefined || v === null ? 'EMPTY' : String(v); })()`);
  check('B9 IndexedDB 已删库/清空（回填无源）', idbProbe === 'EMPTY', String(idbProbe));
  const errN = await ev(`(window.__jsErrors || []).length`);
  check('B10 全程零脚本异常', errN === 0, String(errN));
} else {
  check('B4~B9 未重载，跳过明细断言', false, 'reload 未发生');
}

try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
server.close();

console.log('verify-clear-local-data: ' + pass + ' 通过 / ' + fail + ' 失败' + (RED ? '（RED 基线：存在失败即判别力成立）' : ''));
if (RED) process.exit(0); // RED 模式只做基线观测，退出码不计入门禁
process.exit(fail ? 1 : 0);
