// ===== 回归脚本：音乐「导入来源」说明必须一直在（#608）=====
// 用法：node build.mjs && node tools/verify-music-import-sources.mjs
// 背景（用户反复反馈，本批原话）：「总是有用户以为 QQ音乐别的 app 音乐可以导入」。
//   事实：导入识别链只有网易云一套（extractNeteaseSongId / extractPlaylistId），其他
//   App 的「分享」链接会被当普通 URL 原样收下，而它打开是网页而不是音频文件，必然
//   放不出声。所以唯一防呆手段就是把「只支持 本机音频 / 网易云 / 音频直链」写在用户
//   真正会看的三个地方：添加本地音乐面板、链接添加面板、批量导入面板，以及音乐库空态、
//   功能介绍页音乐组、功能介绍页常见问题。
// 检查（均为运行时渲染出的真实 DOM 文本，不看函数名/变量名）：
//   A1 链接添加面板 hint 写明「不支持其他 App 的分享链接」并点名 QQ音乐
//   A2 批量导入面板 hint 同款声明
//   A3 添加本地音乐面板 hint 写明「分享链接不能直接导入」
//   A4 空库空态文案含来源限定（QQ音乐等其他 App 的分享链接不能导入）
//   A5 功能介绍页「音乐」组含「只有 3 种来源」条目且计数 = 11
//   A6 功能介绍页「常见问题」组含「其他 App 的歌能导入吗」条目且计数 = 15
//   A7 负向对照：三个面板 hint 必须都带「不支持 / 不能直接导入」字样——退回旧版
//      （只写「mp3 直链也可」、不提其他 App）时本项与 A1~A3 一起变红
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_VERIFY_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9950 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-msrc-' + Date.now()),
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
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const waitReady = async () => {
  for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) return; await sleep(200); }
};

let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('PASS  ' + name + (info ? '  [' + info + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (info ? '  [' + info + ']' : '')); }
}

// 打开一个添加音乐面板并取回面板内所有 hint 文本
async function openPanelAndReadHints(btnId) {
  const r = await evalJs(`(function(){
    var app=document.querySelector('.app[data-app="music"]'); if(app)app.click();
    var b=document.getElementById(${JSON.stringify(btnId)}); if(!b)return 'NO-BTN';
    b.click();
    var mask=document.getElementById('tc-mask');
    if(!mask)return 'NO-MASK';
    return JSON.stringify({
      title: (document.getElementById('tc-panel-title')||{}).textContent || '',
      hints: Array.prototype.map.call(mask.querySelectorAll('#tc-body .sm-fld-hint'), function(h){ return h.textContent; }).join(' || ')
    });
  })()`);
  await evalJs(`(function(){ var mask=document.getElementById('tc-mask'); if(mask)mask.hidden=true; return true; })()`);
  await sleep(120);
  if (!r || r === 'NO-BTN' || r === 'NO-MASK') return null;
  try { return JSON.parse(r); } catch (e) { return null; }
}

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  // ---- 第 1 次加载：清空曲库，让空态出现 ----
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(500);
  await evalJs(`try { window.storeFor('default').set('music-library', '[]'); 'OK'; } catch(e){ 'ERR:'+e.message; }`);

  // ---- 第 2 次加载：跑断言 ----
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(900);

  // A1 链接添加面板
  const urlPanel = await openPanelAndReadHints('music-add-url');
  check('A1 链接添加面板写明「不支持其他 App 的分享链接」并点名 QQ音乐',
    !!(urlPanel && urlPanel.hints.indexOf('不支持其他 App 的分享链接') >= 0 && urlPanel.hints.indexOf('QQ音乐') >= 0),
    urlPanel ? (urlPanel.title + '｜' + urlPanel.hints.slice(0, 60)) : '面板打不开');

  // A2 批量导入面板
  const batchPanel = await openPanelAndReadHints('music-batch');
  check('A2 批量导入面板同款声明',
    !!(batchPanel && batchPanel.hints.indexOf('不支持其他 App 的分享链接') >= 0 && batchPanel.hints.indexOf('QQ音乐') >= 0),
    batchPanel ? (batchPanel.title + '｜' + batchPanel.hints.slice(0, 60)) : '面板打不开');

  // A3 添加本地音乐面板
  const localPanel = await openPanelAndReadHints('music-upload');
  check('A3 添加本地音乐面板写明「分享链接不能直接导入」',
    !!(localPanel && localPanel.hints.indexOf('不能直接导入') >= 0),
    localPanel ? (localPanel.title + '｜' + localPanel.hints.slice(0, 60)) : '面板打不开');

  // A7 负向对照：三个面板都不得退回「只讲网易云与直链」的旧文案
  const allHints = [urlPanel, batchPanel, localPanel].map(p => (p && p.hints) || '');
  check('A7 三个面板都带「不支持 / 不能直接导入」字样（退回旧文案即红）',
    allHints.every(h => h.indexOf('不支持') >= 0 || h.indexOf('不能直接导入') >= 0),
    allHints.map(h => (h.indexOf('不支持') >= 0 ? '不支持' : (h.indexOf('不能直接导入') >= 0 ? '不能直接导入' : '缺失'))).join('/'));

  // A4 空库空态
  const emptyTxt = await evalJs(`(function(){
    var e=document.getElementById('music-lib-empty'); if(!e)return 'NO-EL';
    return (e.hidden ? '(hidden)' : '') + (e.textContent||'');
  })()`);
  check('A4 空态文案限定导入来源（QQ音乐等其他 App 的分享链接不能导入）',
    !!(emptyTxt && emptyTxt.indexOf('QQ音乐等其他 App 的分享链接不能导入') >= 0),
    String(emptyTxt).slice(0, 80));

  // A5/A6 功能介绍页（静态 DOM，随页面一起在文档里）
  const groups = await evalJs(`(function(){
    var out={};
    Array.prototype.forEach.call(document.querySelectorAll('#page-about .lic-grp, #page-guide .lic-grp'), function(g){
      var n=(g.querySelector('.lg-name')||{}).textContent||'';
      var c=(g.querySelector('.lg-count')||{}).textContent||'';
      out[n.trim()]={ count:c.trim(), items:g.querySelectorAll('.lg-body .lic-li').length, text:(g.querySelector('.lg-body')||{}).textContent||'' };
    });
    return JSON.stringify(out);
  })()`);
  let g = null;
  try { g = JSON.parse(groups || 'null'); } catch (e) {}
  const musicGrp = g && g['音乐'];
  const faqGrp = g && g['常见问题'];
  // 计数不写死（同一组会被并行会话继续加条目）——改为不变量：声明数 == 组内实际条目数
  const countOk = (grp) => !!(grp && String(grp.items) === grp.count);
  check('A5 功能介绍「音乐」组含「只有 3 种来源」条目且计数对得上',
    !!(musicGrp && musicGrp.text.indexOf('音乐导入只有 3 种来源') >= 0 && musicGrp.text.indexOf('不能导入') >= 0 && countOk(musicGrp)),
    musicGrp ? ('count=' + musicGrp.count + '/items=' + musicGrp.items) : '未取到音乐组');
  check('A6 功能介绍「常见问题」组含「其他 App 的歌能导入吗」条目且计数对得上',
    !!(faqGrp && faqGrp.text.indexOf('其他 App 的歌能导入吗') >= 0 && countOk(faqGrp)),
    faqGrp ? ('count=' + faqGrp.count + '/items=' + faqGrp.items) : '未取到常见问题组');

  const errs = await evalJs("(function(){ var e=window.__jsErrors; if(!e)return 'ok'; try{ return e.length ? JSON.stringify(e).slice(0,200) : 'ok'; }catch(x){ return 'ok'; } })()");
  check('A8 全程零未捕获 JS 异常', errs === 'ok', String(errs).slice(0, 120));

  console.log('\n==== 结果：' + (pass + fail) + ' 项检查，' + fail + ' 项失败 ====');
  if (fail) process.exitCode = 1;
  else console.log('全部通过');
} catch (e) {
  console.error('脚本异常:', e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
  server.close();
}
process.exit(process.exitCode || 0);
