// ===== 验证脚本：iOS Safari 语音字卡上传（accept 放宽 + 非音频兜底校验）=====
// 用法：node build.mjs && node tools/verify-voice-ios-upload.mjs
// 需要：Node 21+（内置 fetch / WebSocket）+ 本机 Chrome/Edge（CHROME_PATH 可指定）
// 背景：iOS「文件」选择器按 accept="audio/*" 过滤——只放行系统识别为音频的文件，
//       amr/silk/无扩展名等语音导出文件被灰显不可选 → 公用/专属字卡语音无法上传
//       （用户反馈「梦角语音文件上传不了」）。
// 修复：语音分类 accept 放宽为空（全文件可选）+ 上传后按 MIME/扩展名校验，
//       非音频（图片/文档/视频）直接跳过，绝不当作音频存库。
// 检查项：
//   T1 公用·语音分类点上传：accept 放宽为空（iOS Files 全文件可选）
//   T2 公用·混合上传（amr+mp3 成功；png/txt/mp4 跳过）：语音库只入音频、MIME 归一
//   T3 专属·语音分类：accept 同样放宽，amr 正常入库（专属键）
//   T4 图片分类回归：accept 仍为 image/*（只放宽语音，不误伤图片/表情包）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 测试文件（任意字节即可：上传流程只校验 MIME/扩展名，不解析内容）----
const testDir = join(root, 'tools', '_ios-test');
mkdirSync(testDir, { recursive: true });
writeFileSync(join(testDir, '语音1.amr'), Buffer.from('AMR-TEST-001'));
writeFileSync(join(testDir, '歌曲.mp3'), Buffer.from('MP3-TEST-002'));
writeFileSync(join(testDir, '图片.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
writeFileSync(join(testDir, '文档.txt'), Buffer.from('hello'));
writeFileSync(join(testDir, '视频.mp4'), Buffer.from('MP4-TEST-003'));
const fAmr = join(testDir, '语音1.amr').replace(/\\/g, '/');
const fMp3 = join(testDir, '歌曲.mp3').replace(/\\/g, '/');
const fPng = join(testDir, '图片.png').replace(/\\/g, '/');
const fTxt = join(testDir, '文档.txt').replace(/\\/g, '/');
const fMp4 = join(testDir, '视频.mp4').replace(/\\/g, '/');

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-voice-ios-upload-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
let fileChooserResolve = null;
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
          else if (m.method === 'Page.fileChooserOpened' && fileChooserResolve) {
            fileChooserResolve(m.params); fileChooserResolve = null;
          }
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
function waitFileChooser(timeout = 8000) {
  return new Promise((res) => {
    fileChooserResolve = res;
    setTimeout(() => { if (fileChooserResolve) { fileChooserResolve = null; res(null); } }, timeout);
  });
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('DOM.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
async function openApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2000);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');var c=document.getElementById('splash-confirm');if(c)c.hidden=true;if(s){s.classList.add('hide');setTimeout(function(){if(s.parentNode)s.parentNode.removeChild(s);},50);}return true;})()");
  await sleep(600);
}
// 点击一次上传：等待动态 input 挂载，返回其 accept 值 + DOM nodeId
async function clickUploadAndGetAccept() {
  await evalJs('window.__accLog = []; true');
  await evalJs("(function(){var b=document.getElementById('cc-import');if(!b)return false;b.click();return true;})()");
  await sleep(250);
  const acc = await evalJs('window.__accLog && window.__accLog.length ? window.__accLog[window.__accLog.length - 1] : null');
  // 定位 hook 标记的动态 file input（headless 下 fileChooser 拦截事件不可靠，直接注文件）
  const doc = await cdp('DOM.getDocument');
  const q = await cdp('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file][data-mochi-pick]' });
  return { accept: acc, nodeId: q && q.nodeId ? q.nodeId : null };
}
// 往动态 input 注入文件（模拟用户在 iOS「文件」里选中这些文件）
async function injectFiles(nodeId, files) {
  const r = await cdp('DOM.setFileInputFiles', { files, nodeId });
  return !!(r && r.errorId == null);
}
// 读取当前作用域语音分组内容
async function readVoice(scope) {
  const expr = scope === 'public'
    ? "localStorage.getItem('xy-home-v2:cc-groups-public')"
    : "localStorage.getItem(window.activePrefix() + ':cc-groups')";
  const raw = await evalJs(expr);
  if (!raw) return [];
  try {
    const g = JSON.parse(raw);
    const vs = (g.voice || []);
    const arr = [];
    vs.forEach((grp) => { if (Array.isArray(grp) && Array.isArray(grp[1])) grp[1].forEach((c) => arr.push(c)); });
    return arr;
  } catch (e) { return ['PARSE_ERR']; }
}
async function openVoicePage(scope) {
  const liId = scope === 'public' ? 'li-custom-cards-public' : 'li-custom-cards';
  const ok = await evalJs("(function(){var b=document.getElementById('" + liId + "');if(!b)return false;b.click();return true;})()");
  await sleep(800);
  // 切到语音分类（分类 tab 在 #cc-tabs 内；.cc-top-tabs 是「可自定义/预设」分区切换）
  await evalJs("(function(){var t=document.querySelector('#cc-tabs .cc-tab[data-type=\"voice\"]');if(!t)return false;t.click();return true;})()");
  await sleep(500);
  return ok;
}
// ---- T1：公用·语音分类上传 accept 放宽为空 ----
await openApp();
// hook 必须注入在页面加载完成后（navigate 会重置页面状态）
await evalJs(`(function(){
  if (window.__accHookDone) return true;
  var orig = document.createElement.bind(document);
  document.createElement = function(tag) {
    var el = orig(tag);
    if (String(tag).toLowerCase() === 'input') {
      try {
        Object.defineProperty(el, 'accept', {
          set: function(v) { window.__accLog.push(String(v == null ? '' : v)); },
          get: function() { return ''; },
          configurable: true
        });
      } catch (e) {}
      try { el.setAttribute('data-mochi-pick', '1'); } catch (e) {}
    }
    return el;
  };
  window.__accHookDone = true;
  return true;
})()`);
await openVoicePage('public');
let r = await clickUploadAndGetAccept();
check('T1 公用·语音上传 accept 放宽为空（iOS Files 全文件可选）', r.accept === '', 'accept="' + r.accept + '"');
// 把选择器关掉（不给文件），避免残留状态
if (r.nodeId) { try { await cdp('DOM.setFileInputFiles', { files: [], nodeId: r.nodeId }); } catch (e) {} }

// ---- T2：公用·混合上传：amr+mp3 成功，png/txt/mp4 跳过 ----
const pubBefore = await readVoice('public');
r = await clickUploadAndGetAccept();
if (r.nodeId) {
  await injectFiles(r.nodeId, [fAmr, fMp3, fPng, fTxt, fMp4]);
  await sleep(1800);
}
const pubAfter = await readVoice('public');
check('T2a 公用·语音库新增 2 条（amr+mp3）', pubAfter.length - pubBefore.length === 2, '新增 ' + (pubAfter.length - pubBefore.length));
const hasAmr = pubAfter.some((c) => c.indexOf('语音1|||data:audio/amr;base64,') === 0);
const hasMp3 = pubAfter.some((c) => c.indexOf('歌曲|||data:audio/mpeg;base64,') === 0);
check('T2b 公用·amr 入库且 MIME 归一为 audio/amr', hasAmr, JSON.stringify(pubAfter.filter((c) => c.indexOf('语音1') === 0)));
check('T2c 公用·mp3 入库且 MIME 为 audio/mpeg', hasMp3, JSON.stringify(pubAfter.filter((c) => c.indexOf('歌曲') === 0)));
const leaked = pubAfter.some((c) => c.indexOf('图片') === 0 || c.indexOf('文档') === 0 || c.indexOf('视频') === 0);
check('T2d 公用·png/txt/mp4 全部跳过，未污染语音库', !leaked, leaked ? '发现污染条目' : '干净');

// ---- T3：专属·语音分类 accept 放宽 + amr 入库 ----
await evalJs("(function(){var b=document.getElementById('cc-back');if(b)b.click();return !!b;})()");
await sleep(500);
await openVoicePage('own');
const ownBefore = await readVoice('own');
r = await clickUploadAndGetAccept();
check('T3a 专属·语音上传 accept 同样放宽为空', r.accept === '', 'accept="' + r.accept + '"');
if (r.nodeId) {
  await injectFiles(r.nodeId, [fAmr]);
  await sleep(1800);
}
const ownAfter = await readVoice('own');
const ownHasAmr = ownAfter.some((c) => c.indexOf('语音1|||data:audio/amr;base64,') === 0);
check('T3b 专属·amr 正常入库（专属键）', ownAfter.length - ownBefore.length === 1 && ownHasAmr, '新增 ' + (ownAfter.length - ownBefore.length));

// ---- T4：图片分类回归：accept 仍为 image/* ----
await evalJs("(function(){var b=document.getElementById('cc-back');if(b)b.click();return !!b;})()");
await sleep(500);
await evalJs("(function(){var t=document.querySelector('#cc-tabs .cc-tab[data-type=\"image\"]');if(!t)return false;t.click();return true;})()");
await sleep(400);
r = await clickUploadAndGetAccept();
check('T4 图片分类 accept 仍为 image/*（未误伤）', r.accept === 'image/*', 'accept="' + r.accept + '"');
if (r.nodeId) { try { await cdp('DOM.setFileInputFiles', { files: [], nodeId: r.nodeId }); } catch (e) {} }

// ---- 汇总 ----
const failed = results.filter((x) => !x.ok).length;
console.log('\n结果：' + (results.length - failed) + '/' + results.length + ' 通过' + (failed ? '（' + failed + ' 项失败）' : ''));
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(failed ? 1 : 0);
