// ===== #497 存储可见性三件·行为级回归（personalize.js 查看存储占比 / img-compress 入口锚点 / data-backup.js 导出前实测体积）=====
// 用法：先 `node build.mjs`，再 `node tools/verify-storage-export-info.mjs`
// 被测对象是**产物 index.html**（用户实际打开的那一份）。
// 断言：
//   T1     小库导出：先弹「选择导出范围」（#582 起每次导出都选一次范围），选完整备份后打包完成出现「备份已打包完成」弹窗
//          （measureProject 统计进度遮罩不卡死流程）
//   T2     查看存储占比：「浏览器整域已用/配额」含「（占 X%）」；「本项目占用合计」含「占浏览器配额」
//          （原实现只有绝对字节＝用户报「内存占比显示不全」）
//   T3     设置页「压缩图片」入口：点击 row-img-compress 触发扫描并弹「压缩图片」弹窗
//          （img-compress.js 上线时漏加 template 锚点＝功能全站无入口）
//   T4     查看存储页压缩卡：#st-img-compress / #st-img-compress-btn 在位，点按钮同样触发扫描弹窗
//   T5     大库导出：IDB 种 2×90MB + 音乐键后点导出 → 弹「选择导出范围」，正文含「占配额」「预估文件：
//          完整 …、不含音乐 …、仅聊天记录 …」，且 完整 > 不含音乐，五枚 pills（含取消）在位
//   T6     全程无 JS 运行时错误
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const artifact = readFileSync(join(root, 'index.html'), 'utf8');
if (!artifact.includes('id="row-img-compress"')) {
  console.log('ENV  产物里还没有 #497 改动——请先执行 node build.mjs 再跑本脚本');
  process.exit(2);
}

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(2); }

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(artifact);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9970 + Math.floor(Math.random() * 9));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-st-info-' + Date.now()),
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
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
async function waitFor(expr, tries = 80, step = 250) {
  for (let i = 0; i < tries; i++) { if (await evalJs(expr)) return true; await sleep(step); }
  return false;
}
async function modalOpen() {
  return evalJs("(function(){var m=document.getElementById('modal-mask');return m&&!m.hidden;})()");
}
async function modalText() {
  return evalJs("(function(){return (document.getElementById('modal-title')||{}).textContent+'\\n'+((document.getElementById('modal-static')||{}).textContent||'');})()") || '';
}
async function closeModal() {
  await evalJs("(function(){var b=document.getElementById('modal-cancel');if(b)b.click();return true;})()");
  await sleep(300);
}
async function coldStart() {
  await cdp('Page.navigate', { url: baseUrl + '/' });
  await sleep(2000);
  await waitFor("typeof window.xyStore === 'function' && typeof window.idbListKeys === 'function'");
  await waitFor('!!window.__mochiDataReady');
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(600);
}
// 把设置页滚出来直接点行（行在 hidden 页里 JS click 也生效，无需真实导航）
const clickRow = (id) => evalJs(`(function(){var el=document.getElementById('${id}');if(!el)return 'missing';el.click();return 'ok';})()`);

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ===== T1 小库导出：不弹选范围，能走完打包 =====
await coldStart();
await evalJs("window.runBackupExport(); true");
const t1ModeModal = await waitFor("(function(){var t=(document.getElementById('modal-title')||{}).textContent||'';return t.indexOf('选择导出范围')>=0;})()", 30, 250);
if (t1ModeModal) await evalJs("(function(){var ok=document.getElementById('modal-ok');if(ok)ok.click();return 1;})()");
const t1Done = await waitFor("(function(){var t=(document.getElementById('modal-title')||{}).textContent||'';return t.indexOf('备份已打包完成')>=0;})()", 120, 500);
check('T1 小库导出：范围弹窗→完整备份→打包完成', t1ModeModal && t1Done, '范围弹窗=' + t1ModeModal + ' 打包完成=' + t1Done);
if (t1Done) await closeModal();

// ===== T2 查看存储：两条占用行带配额占比 =====
await clickRow('row-storage-view');
const t2Quota = await waitFor("(function(){var el=document.getElementById('st-quota');return el&&el.textContent.indexOf('（占 ')>=0;})()", 40, 250);
const t2Self = await waitFor("(function(){var el=document.getElementById('st-self');return el&&el.textContent.indexOf('占浏览器配额')>=0;})()", 40, 250);
const t2SelfTxt = await evalJs("(function(){var el=document.getElementById('st-self');return el?el.textContent:'';})()");
check('T2 整域已用/配额行带百分比', t2Quota, t2Quota ? '' : 'st-quota 无「（占 」');
check('T2 本项目占用合计带配额占比', t2Self, t2Self ? '' : 'st-self=' + t2SelfTxt);

// ===== T3 设置页「压缩图片」入口（img-compress.js 接线锚点补齐后才有此行） =====
const t3row = await clickRow('row-img-compress');
const t3modal = t3row === 'ok' && await waitFor("(async function(){for(var i=0;i<40;i++){var m=document.getElementById('modal-mask');if(m&&!m.hidden&&((document.getElementById('modal-title')||{}).textContent||'').indexOf('压缩图片')===0)return true;await new Promise(function(r){setTimeout(r,250);});}return false;})()", 1, 250);
const t3txt = t3modal ? await modalText() : '';
check('T3 设置页压缩图片入口触发扫描弹窗', t3modal, t3modal ? '' : '点击结果=' + t3row);
if (t3modal) check('T3b 弹窗带压缩规则/空库说明', t3txt.indexOf('压缩规则') >= 0 || t3txt.indexOf('没有可压缩') >= 0, t3txt.slice(0, 120));
if (await modalOpen()) await closeModal();

// ===== T4 查看存储页压缩卡锚点 + 按钮 =====
const t4els = await evalJs("(function(){return !!document.getElementById('st-img-compress')&&!!document.getElementById('st-img-compress-btn');})()");
const t4click = t4els ? await clickRow('st-img-compress-btn') : 'missing';
const t4modal = t4click === 'ok' && await waitFor("(function(){var m=document.getElementById('modal-mask');return m&&!m.hidden&&((document.getElementById('modal-title')||{}).textContent||'').indexOf('压缩图片')===0;})()", 60, 250);
check('T4 查看存储页压缩入口在位且可用', t4els && t4modal, '锚点=' + t4els + ' 弹窗=' + t4modal);
if (await modalOpen()) await closeModal();

// ===== T5 大库导出：实测体积弹窗（占比 + 各模式导出文件预估） =====
const seeded = await evalJs(`(async function(){
  try {
    var big = 'x'.repeat(90*1024*1024);
    await window.idbSet('xy-home-v2:tmpv-497-a', big);
    await window.idbSet('xy-home-v2:tmpv-497-b', big);
    await window.idbSet('xy-home-v2:default:music-file:v497', 'm'.repeat(2*1024*1024));
    return 'ok';
  } catch (e) { return 'err:' + (e&&e.message||e); }
})()`);
check('S5 播种 182MB 测试数据', seeded === 'ok', seeded);
await evalJs("window.runBackupExport(); true");
const t5modal = await waitFor("(function(){var t=(document.getElementById('modal-title')||{}).textContent||'';return t.indexOf('选择导出范围')>=0;})()", 160, 500);
const t5txt = t5modal ? await modalText() : '';
const hasPct = t5txt.indexOf('占配额') >= 0;
const hasFull = t5txt.indexOf('预估文件：完整') >= 0;
const hasNoMusic = t5txt.indexOf('不含音乐') >= 0;
function parseMB(s) { const m = /([\d.]+)\s*(B|KB|MB|GB)/.exec(s); if (!m) return NaN; const v = parseFloat(m[1]); return m[2] === 'GB' ? v * 1024 : m[2] === 'KB' ? v / 1024 : m[2] === 'B' ? v / 1048576 : v; }
let fullMB = NaN, noMusicMB = NaN;
if (hasFull && hasNoMusic) {
  const seg = t5txt.slice(t5txt.indexOf('预估文件：完整'));
  const afterFull = seg.slice(seg.indexOf('完整') + 2, seg.indexOf('、不含音乐'));
  const nmStart = seg.indexOf('不含音乐') + 4;
  const nmEnd = seg.indexOf('、仅聊天记录') >= 0 ? seg.indexOf('、仅聊天记录') : nmStart + 40;
  fullMB = parseMB(afterFull); noMusicMB = parseMB(seg.slice(nmStart, nmEnd));
}
const t5pills = await evalJs("(function(){var p=document.getElementById('modal-pills');if(!p||p.hidden)return 0;return p.querySelectorAll('button,.mp-item,[class*=pill]').length;})()");
const t5labels = await evalJs("(function(){var p=document.getElementById('modal-pills');if(!p||p.hidden)return '';return JSON.stringify(Array.prototype.map.call(p.querySelectorAll('button,.mp-item,[class*=pill]'),function(x){return x.textContent;}));})()");
check('T5 大库导出弹「选择导出范围」（#582：每次导出都选一次范围）', t5modal, t5modal ? '' : (t5txt || '弹窗未出现').slice(0, 120));
check('T5a 弹窗带配额占比', hasPct, t5txt.split('\n')[0]);
check('T5b 弹窗带各模式导出文件预估且 完整>不含音乐', hasFull && hasNoMusic && fullMB > noMusicMB, 'full=' + fullMB + 'MB noMusic=' + noMusicMB + 'MB');
check('T5c 范围 pills 在位（完整/不含音乐/只备份文字/仅聊天记录/取消）', t5pills >= 5 && String(t5labels).indexOf('取消') >= 0, 'pills=' + t5pills + ' ' + String(t5labels).slice(0, 120));
if (await modalOpen()) await closeModal();
await evalJs("(async function(){try{await window.idbDelete('xy-home-v2:tmpv-497-a');await window.idbDelete('xy-home-v2:tmpv-497-b');await window.idbDelete('xy-home-v2:default:music-file:v497');}catch(e){}return true;})()");

// ===== T6 全程无 JS 运行时错误 =====
const errs = JSON.parse(await evalJs("(function(){ return JSON.stringify((window.__jsErrors||[]).slice(0,8)); })()") || '[]');
check('T6 全程无 JS 运行时错误', errs.length === 0, errs.join(' | ').slice(0, 300));

const pass = results.filter((r) => r.ok).length;
console.log(`\n结果：通过 ${pass} / ${results.length}（断言失败 ${results.length - pass}）`);
try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(results.some((r) => !r.ok) ? 1 : 0);
