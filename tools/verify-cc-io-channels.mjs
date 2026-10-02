// ===== 回归脚本：#603 字卡库「导出数据 / 导入数据」在壳浏览器上点了没反应 =====
// 用法：node build.mjs && node tools/verify-cc-io-channels.mjs
// 背景（红米 K70 至尊版 / MIUI 自带浏览器，用户明说其他机型也有）：
//   「公用字卡 / 专属字卡 的导出数据和导入数据 点了没有任何反应」「字卡文件点不出来，导入不进去」。
// 判据（不依赖任何机型分支，全部是纯行为断言）：
//   ① 导入：模式弹窗有「粘贴文本导入」第四条路，且这条路不经过文件选择器也能把卡真的并进库；
//   ② 文件选择的 input 常驻复用（旧实现 1.5s 后把元素摘出文档，选大文件回来 change 不派发）；
//   ③ 导出：「导出选中字卡」先给导出方式（导出文件=走 data-backup 三级降级链 / 复制文字），
//      导出文件必须落到 window.mochiExportFile（原实现自己造 blob + 裸 a[download]）；
//   ④ 0 张字卡时汇总行写明原因（原实现按钮 disabled，点上去一片沉默）。
// RED 基线：把 src/js/chatcard.js 换回 HEAD 版复跑，S1~S7 与 B1~B8 应大面积转红。

let pass = 0, fail = 0;
const check = (name, ok, info) => {
  if (ok) { pass++; console.log('PASS  ' + name + (info ? '  [' + info + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (info ? '  [' + info + ']' : '')); }
};
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 端口契约：并发时 runner 用 MOCHI_CDP_PORT 下发空闲端口；MOCHI_VERIFY_ROOT 指向临时副本
// 目录时用副本的 index.html（不碰仓库产物，构建者之外的会话也能自查）
const root = normalize(process.env.MOCHI_VERIFY_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- S 段：源码锚（不依赖产物，构建前也能跑）----------
const src = readFileSync(join(root, 'src/js/chatcard.js'), 'utf8');
const has = (s) => src.indexOf(s) >= 0;
check('S1 文件选择 input 常驻复用的单一实例（旧实现每次新建、1.5s 后摘除）', has('let ccFileInput = null, ccPickSeq = 0;'));
check('S2 旧的「blur 后 1.5s 把 input 摘出文档」不得复活（选大文件回来 change 不派发＝选了没反应）',
  !has('if (input.parentNode) input.remove(); } catch (e) {} }, 1500);'));
check('S3 导出落到 data-backup 的三级降级保存链（分享面板→保存框→确认后下载）', has('window.mochiExportFile(json, fname, title)'));
check('S4 导出提供第二种通道「复制文字」', has("'导出文件（推荐）'") && has("'复制文字'"));
check('S5 导入模式弹窗有第四条路「粘贴文本导入」', has("{ label: '粘贴文本导入', value: 'paste' }"));
check('S6 粘贴通道与文件通道汇入同一条解析链', has("typeof f._pasteText === 'string'"));
check('S7 0 张字卡时汇总行说明原因（原实现 disabled 且沉默）', has('当前没有可导出的字卡'));
check('S8 未引入按机型分支的能力判断（同一链路服务所有浏览器）',
  !/MiuiBrowser|XiaoMi/i.test(src.slice(src.indexOf('#603'), src.indexOf('#603') + 4000)));

// ---------- B 段：无头行为 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.log('（无 Chrome/Edge：跳过 B 段，S 段已跑）'); console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败'); process.exit(fail ? 1 : 0); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9920 + Math.floor(Math.random() * 30));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-cc-io-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(500);
  }
  throw new Error('cdp connect fail');
}
function cdp(method, params) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); });
}
async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return '<<EXC ' + (r.result.exceptionDetails.text || '') + '>>';
  return r.result && r.result.result ? r.result.result.value : undefined;
}
const KILL_SPLASH = "(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();"
  + "var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;s.style.display='none';}"
  + "document.querySelectorAll('.splash-mandatory').forEach(function(x){x.hidden=true;x.style.display='none';});return true;})()";
const SEED = `(function(){
  var lib = { text:[['日常',['你好呀','在吗','想你了']]], kaomoji:[['颜',['(￣▽￣)']]], emoji:[], sticker:[], image:[], poke:[], voice:[] };
  window.activeStore().set('cc-groups', JSON.stringify(lib));
  return 1;
})()`;

async function boot() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2600);
  // 并发套件下首启可能被别的 Chrome 抢 CPU，就绪等待放宽到 ~24s（B0 假红过一次）
  for (let i = 0; i < 80; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
  await ev(KILL_SPLASH);
  await sleep(500);
}
// 进字卡库列表页，并清掉首启弹窗（字卡使用提醒每天首次进页会弹一次）
async function gotoCardLib() {
  await ev("(function(){var t=document.querySelector('.tab[data-page=\\\"page-chatcard\\\"]');if(t)t.click();return !!t;})()");
  await sleep(700);
  await ev("(function(){var li=document.getElementById('li-custom-cards');if(li)li.click();return !!li;})()");
  await sleep(2200);
  for (let i = 0; i < 6; i++) {
    const m = await ev("(function(){var m=document.getElementById('modal-mask');return (m&&!m.hidden)?(document.getElementById('modal-title')||{}).textContent:'';})()");
    const cm = await ev("(function(){var c=document.getElementById('cc-scope-mask');return (c&&!c.hidden)?'1':'';})()");
    if (!m && !cm) break;
    if (m) await ev("(function(){var b=document.getElementById('modal-cancel');if(b)b.click();return 1;})()");
    if (cm) await ev("(function(){var b=document.getElementById('csn-ok');if(b)b.click();return 1;})()");
    await sleep(600);
  }
}
// 插桩必须每次导航后重做（页面作用域）：记录导出/剪贴板/文件选择器调用 + JS 错误
async function instrument() {
  await ev(`(function(){
    window.__rec = { exportFile: [], clip: [], inputClicks: [], errs: [], input: null };
    window.mochiExportFile = function (json, fname, title) {
      window.__rec.exportFile.push({ fname: fname, title: title, len: String(json||'').length, head: String(json||'').slice(0,1) });
      return Promise.resolve('ok');
    };
    try {
      navigator.clipboard.writeText = function (t) { window.__rec.clip.push(String(t||'').length); return Promise.resolve(); };
    } catch (e) {}
    var oc = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file') {
        window.__rec.inputClicks.push({ id: this.id, same: window.__rec.input === this });
        window.__rec.input = this;   // 记住节点身份，第二次调用比对是否复用同一个
      }
      return oc.apply(this, arguments);
    };
    window.addEventListener('error', function (e) { window.__rec.errs.push(String(e.message)); });
    return 'ok';
  })()`);
}
// 种子 + 重载：写进 LS 后必须重载，让启动恢复链把它读成正式库（照 tools/verify-cc-link-btn-export.mjs
// 的既有做法）。不能只写不重载——启动后几秒应用自己的写回会把这份「外来的」键覆盖掉（实测：
// 写完 2~3 秒内被清空，断言随之全假红）。重载后确认列表页确实读到了种子，没读到就再来一轮。
async function seedAndEnterLib() {
  for (let i = 0; i < 4; i++) {
    await ev(SEED);
    await sleep(500);
    await boot();
    await instrument();
    await gotoCardLib();
    const bar = String(await ev("(function(){var el=document.getElementById('cc-groups-bar');return el?el.textContent:'';})()"));
    if (bar.indexOf('日常') >= 0) return bar;
  }
  return '';
}

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  // 壳浏览器 UA（小米自带）——只为对齐报障环境，代码里不该有任何按它的分支
  await cdp('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (Linux; U; Android 16; zh-cn; 2407FRK8EC Build/BP2A.250605.031.A3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.7049.79 Mobile Safari/537.36 XiaoMi/MiuiBrowser/20.27.1010901',
    platform: 'Linux aarch64'
  });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 744, deviceScaleFactor: 3.4, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  await boot();
  check('B0 应用启动完成（模块全部就绪）', (await ev('!!window.__mochiDataReady')) === true);

  // 种子（写完重载，见 seedAndEnterLib 注释）；导航会重置插桩，故种完再插
  const seededBar = await seedAndEnterLib();
  check('B1 字卡库列表已读到种子字卡（前置校验，防「卡没进库」造成假绿）',
    /日常/.test(seededBar), String(seededBar).replace(/\s+/g, ' ').slice(0, 60));

  // ---- ② 文件选择 input 常驻 ----
  await ev("(function(){var b=document.getElementById('cc-import-data');if(b)b.click();return 1;})()");
  await sleep(300);
  const pills = await ev("(function(){var o=[];document.querySelectorAll('#modal-pills .pill').forEach(function(p){o.push(p.textContent);});return o.join(' | ');})()");
  check('B2 导入弹窗有第四条路「粘贴文本导入」', String(pills).indexOf('粘贴文本导入') >= 0, pills);
  await ev("(function(){var b=document.getElementById('modal-ok');if(b)b.click();return 1;})()"); // 默认 merge → 弹文件选择器
  await sleep(500);
  const pick1 = await ev('JSON.stringify(window.__rec.inputClicks)');
  check('B3 「追加字卡」走到文件选择器（input.click 有记录）', String(pick1).indexOf('"id":"cc-file-pick"') >= 0, pick1);
  await sleep(2300); // 旧实现此刻已把 input 从文档摘掉
  const alive = await ev("(function(){var i=document.getElementById('cc-file-pick');return !!i && !!i.parentNode;})()");
  check('B4 文件选择 input 常驻在文档里（＞2.2s 仍在；旧实现 1.5s 后已被摘除）', alive === true);
  await ev("(function(){var b=document.getElementById('cc-import-data');if(b)b.click();return 1;})()");
  await sleep(300);
  await ev("(function(){var b=document.getElementById('modal-ok');if(b)b.click();return 1;})()");
  await sleep(500);
  const reuse = await ev("(function(){var r=window.__rec.inputClicks;return r.length>=2 && r[r.length-1].same;})()");
  check('B5 第二次选文件复用同一个 input 节点（不再每次新建）', reuse === true);

  // ---- ③ 粘贴文本导入通道 ----
  const payload = JSON.stringify({ text: [['粘贴组', ['粘贴进来的第一句', '粘贴进来的第二句']]], kaomoji: [], emoji: [], sticker: [], image: [], poke: [], voice: [] });
  await ev("(function(){var b=document.getElementById('cc-import-data');if(b)b.click();return 1;})()");
  await sleep(300);
  await ev("(function(){var ps=document.querySelectorAll('#modal-pills .pill');for(var i=0;i<ps.length;i++){if(ps[i].textContent==='粘贴文本导入'){ps[i].click();return 1;}}return 0;})()");
  await sleep(300);
  await ev("(function(){var b=document.getElementById('modal-ok');if(b)b.click();return 1;})()");
  await sleep(500);
  const ptitle = await ev("(document.getElementById('modal-title')||{}).textContent");
  const pta = await ev("(function(){var t=document.getElementById('modal-textarea');return !!(t && !t.hidden);})()");
  check('B6 选「粘贴文本导入」弹出粘贴框（不经过文件选择器）', ptitle === '粘贴字卡数据' && pta === true, ptitle + ' / textarea=' + pta);
  await ev(`(function(){var t=document.getElementById('modal-textarea');t.value=${JSON.stringify(payload)};return 1;})()`);
  await ev("(function(){var b=document.getElementById('modal-ok');if(b)b.click();return 1;})()");
  await sleep(1200);
  const gotPaste = await ev("(function(){try{var s=JSON.parse(window.activeStore().get('cc-groups')||'{}');var g=(s.text||[]).filter(function(x){return x[0]==='粘贴组';});return g.length?g[0][1].join(','):'';}catch(e){return 'ERR '+e.message;}})()");
  check('B7 粘贴的字卡真的并进库里（含新建分组）', String(gotPaste).indexOf('粘贴进来的第一句') >= 0 && String(gotPaste).indexOf('粘贴进来的第二句') >= 0, gotPaste);
  const keptOld = await ev("(function(){try{var s=JSON.parse(window.activeStore().get('cc-groups')||'{}');return (s.text||[]).filter(function(x){return x[0]==='日常';}).length;}catch(e){return -1;}})()");
  check('B8 粘贴按「追加字卡」并入，原有字卡不被清空', keptOld === 1);
  // 空粘贴：给提示且不动库
  await ev("(function(){var b=document.getElementById('cc-import-data');if(b)b.click();return 1;})()");
  await sleep(300);
  await ev("(function(){var ps=document.querySelectorAll('#modal-pills .pill');for(var i=0;i<ps.length;i++){if(ps[i].textContent==='粘贴文本导入'){ps[i].click();return 1;}}return 0;})()");
  await sleep(250);
  await ev("(function(){var b=document.getElementById('modal-ok');if(b)b.click();return 1;})()");
  await sleep(350);
  await ev("(function(){var t=document.getElementById('modal-textarea');t.value='   ';return 1;})()");
  await ev("(function(){var b=document.getElementById('modal-ok');if(b)b.click();return 1;})()");
  await sleep(600);
  const emptyToast = await ev("(document.getElementById('cc-toast')||{}).textContent");
  const stillThere = await ev("(function(){try{var s=JSON.parse(window.activeStore().get('cc-groups')||'{}');return (s.text||[]).filter(function(x){return x[0]==='粘贴组';}).length;}catch(e){return -1;}})()");
  check('B9 粘贴空白给明确提示、字卡库不动（不静默）', String(emptyToast).indexOf('没有粘贴到内容') >= 0 && stillThere === 1, String(emptyToast).slice(0, 40));

  // ---- ④ 导出：导出方式二选一 + 走统一保存链 ----
  await ev("(function(){var b=document.getElementById('cc-export');if(b)b.click();return 1;})()");
  await sleep(400);
  const sum0 = await ev("(document.getElementById('ce-summary')||{}).textContent");
  check('B10 导出弹窗汇总行有字卡（前置校验）', /[1-9]\d* 张字卡/.test(String(sum0)), String(sum0).slice(0, 50));
  await ev("(function(){var b=document.getElementById('ce-do');if(b)b.click();return 1;})()");
  await sleep(900);
  const expTitle = await ev("(document.getElementById('modal-title')||{}).textContent");
  const expPills = await ev("(function(){var o=[];document.querySelectorAll('#modal-pills .pill').forEach(function(p){o.push(p.textContent);});return o.join(' | ');})()");
  check('B11 「导出选中字卡」给导出方式选择（导出文件 / 复制文字）', expTitle === '导出字卡数据' && String(expPills).indexOf('导出文件') >= 0 && String(expPills).indexOf('复制文字') >= 0, expTitle + ' | ' + expPills);
  // 选「导出文件」
  await ev("(function(){var ps=document.querySelectorAll('#modal-pills .pill');for(var i=0;i<ps.length;i++){if(ps[i].textContent.indexOf('导出文件')>=0){ps[i].click();return 1;}}return 0;})()");
  await sleep(900);
  const rec1 = await ev('JSON.stringify(window.__rec.exportFile)');
  const e1 = JSON.parse(rec1 || '[]')[0] || {};
  check('B12 导出文件走 window.mochiExportFile（不再自己造 blob + 裸 a[download]）', (JSON.parse(rec1 || '[]')).length === 1, rec1);
  check('B13 导出文件名为 mochi字卡库数据.json、内容是 JSON 对象', e1.fname === 'mochi字卡库数据.json' && e1.head === '{' && e1.len > 20, e1.fname + '/' + e1.len + 'B');
  // 再导一次选「复制文字」
  await ev("(function(){var b=document.getElementById('cc-export');if(b)b.click();return 1;})()");
  await sleep(400);
  await ev("(function(){var b=document.getElementById('ce-do');if(b)b.click();return 1;})()");
  await sleep(900);
  await ev("(function(){var ps=document.querySelectorAll('#modal-pills .pill');for(var i=0;i<ps.length;i++){if(ps[i].textContent==='复制文字'){ps[i].click();return 1;}}return 0;})()");
  await sleep(900);
  const clip = await ev('JSON.stringify(window.__rec.clip)');
  check('B14 「复制文字」把字卡 json 写进剪贴板（文件通道全断时的第二条路）', (JSON.parse(clip || '[]')).length === 1 && JSON.parse(clip || '[]')[0] > 20, clip);

  // ---- ⑤ 0 张字卡时说明原因 ----
  await ev("(function(){window.activeStore().set('cc-groups', JSON.stringify({text:[],kaomoji:[],emoji:[],sticker:[],image:[],poke:[],voice:[]}));try{window.xyStore('xy-home-v2').set('cc-groups-public', JSON.stringify({text:[],kaomoji:[],emoji:[],sticker:[],image:[],poke:[],voice:[]}));}catch(e){}return 1;})()");
  await sleep(400);
  await gotoCardLib();
  await ev("(function(){var b=document.getElementById('cc-export');if(b)b.click();return 1;})()");
  await sleep(400);
  const sumEmpty = await ev("(document.getElementById('ce-summary')||{}).textContent");
  check('B15 没有可导出字卡时汇总行写明原因（原实现按钮 disabled、点上去一片沉默）',
    String(sumEmpty).indexOf('当前没有可导出的字卡') >= 0, String(sumEmpty).slice(0, 60));
  await ev("(function(){var b=document.getElementById('ce-close');if(b)b.click();return 1;})()");

  const errs = await ev('JSON.stringify((window.__rec||{}).errs || [])');
  check('B16 全程 0 个未捕获 JS 异常', String(errs) === '[]', errs);
} catch (e) {
  console.error('DIAG ERR', e);
  fail++;
}
try { chrome.kill(); } catch (e) {}
server.close();
console.log('');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
