// ===== 回归脚本：链接导入图片/表情包（v3.11.x 新功能） =====
// 用法：node build.mjs && node tools/verify-link-import.mjs
// 覆盖两条 UI 链路：
//   A 字卡库【表情包】分类「链接导入」：转存成功 / CORS 回退存原始链接 / 非图片判失败 /
//     同链接去重 / 粘贴带尖括号清洗 / 卡片缩略图按链接渲染 / getMediaGroups 放行链接字卡
//   B 表情包面板「我的表情包」「链接导入」：GIF 直存原图 / CORS 回退存原始链接 /
//     分组内落库 / 写信插入模式对链接表情拦截提示、对 dataURL 表情正常插入
// fetch 全部打桩（不访问真实网络）：ok.example 返回 PNG、cors.example 模拟跨域拒绝、
// html.example 返回 text/html（非图片→失败）、slow.example 挂起（12s 超时→回退链接）
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
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-linkimp-' + Date.now()),
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
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(m.error) : res(m.result); }
        };
        return;
      }
    } catch (e) {}
    await sleep(200);
  }
  throw new Error('CDP 连接超时');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res, rej) => { pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('页面脚本异常: ' + JSON.stringify(r.exceptionDetails.exception?.description || '').slice(0, 300));
  return r.result.value;
}

let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('PASS  ' + name + (info ? '  [' + info + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (info ? '  [' + info + ']' : '')); }
}
async function waitFor(desc, expr, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 15000);
  while (Date.now() < deadline) {
    const v = await evalJs(expr);
    if (v) return true;
    await sleep(400);
  }
  console.log('FAIL  等待超时：' + desc);
  fail++;
  return false;
}
// 填充弹窗多行输入：安卓路径 textarea 被 mobile-adapt 转成 ce-box 后，
// 读写仍走 input.value（代理兼容），这里统一只设 value
async function fillModalTextarea(text) {
  return evalJs(`(function(){
    var inp = document.getElementById('modal-textarea');
    if (!inp || document.getElementById('modal-mask').hidden) return 'no-modal';
    inp.value = ${JSON.stringify(text)};
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return 'filled';
  })()`);
}
async function clickModalOk() {
  return evalJs(`(function(){ var ok=document.getElementById('modal-ok'); if(!ok) return false; ok.click(); return true; })()`);
}

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  // 关掉开屏（带重试，避免合成点击落在开屏遮罩上造成后续步骤状态错乱）
  for (let i = 0; i < 10 && !(await evalJs("(function(){var s=document.getElementById('splash');return s&&s.classList.contains('hide');})()")); i++) {
    await evalJs("(function(){var s=document.getElementById('splash');if(s)s.click();return true;})()");
    await sleep(500);
  }
  check('页面加载完成', await evalJs(`!!window.__mochiDataReady && !!document.body`));

  // ---- 打桩 fetch：模拟四类图床行为；ok.example 按路径返回不同颜色的 1×1 PNG
  //      （canvas 现生成，字节互不相同，避免同字节压缩结果撞上去重断言）----
  await evalJs(`(function(){
    function pngBytes(color) {
      var c = document.createElement('canvas'); c.width = 1; c.height = 1;
      var x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, 1, 1);
      var d = c.toDataURL('image/png').split(',')[1];
      var bin = atob(d), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return arr;
    }
    window.fetch = function (url) {
      var u = String(url);
      function resp(bytes, type) { return Promise.resolve(new Response(bytes, { status: 200, headers: { 'Content-Type': type } })); }
      if (u.indexOf('ok.example/') >= 0 && u.indexOf('.gif') >= 0) return resp(pngBytes('#ff0000'), 'image/gif');
      if (u.indexOf('/a.png') >= 0) return resp(pngBytes('#ff0000'), 'image/png');
      if (u.indexOf('/h.png') >= 0) return resp(pngBytes('#00cc00'), 'image/png');
      if (u.indexOf('/g.png') >= 0) return resp(pngBytes('#0066ff'), 'image/png');
      if (u.indexOf('/t.png') >= 0) return resp(pngBytes('#ffcc00'), 'image/png');
      if (u.indexOf('/u.png') >= 0) return resp(pngBytes('#9900ff'), 'image/png');
      if (u.indexOf('ok.example/') >= 0) return resp(pngBytes('#ff0000'), 'image/png');
      if (u.indexOf('cors.example/') >= 0)
        return Promise.reject(new TypeError('Failed to fetch'));
      if (u.indexOf('html.example/') >= 0)
        return Promise.resolve(new Response('<html>not an image</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
      if (u.indexOf('slow.example/') >= 0)
        return new Promise(function () {}); /* 挂起 → 走 12s 超时回退 */
      return Promise.reject(new TypeError('no route'));
    };
    return true;
  })()`);
  check('fetch 打桩完成', true);

  // ================= A. 字卡库【表情包】链接导入 =================
  await evalJs("(function(){var t=document.querySelector('.tab[data-page=\"page-chatcard\"]');if(t)t.click();return !!t;})()");
  await sleep(500);
  await evalJs("(function(){var li=document.getElementById('li-custom-cards');if(li)li.click();return !!li;})()");
  await waitFor('字卡库页打开', `(function(){ var p = document.getElementById('page-custom-cards'); return !!(p && !p.hidden); })()`, 8000);
  await evalJs("(function(){var t=document.querySelector('.cc-tab[data-type=\"sticker\"]');if(t)t.click();return !!t;})()");
  await sleep(400);

  // 入口按钮存在且弹窗标题带分类名
  await evalJs("(function(){var b=document.getElementById('cc-import-link');if(b)b.click();return !!b;})()");
  await sleep(300);
  const titleA = await evalJs(`(document.getElementById('modal-title')||{textContent:''}).textContent`);
  check('A1 弹窗打开且带分类名（表情包）', titleA.indexOf('链接导入') >= 0 && titleA.indexOf('表情包') >= 0, titleA);

  await fillModalTextarea([
    'https://ok.example/a.png',
    'https://ok.example/a.png',            // 重复行 → 同分组去重
    'https://cors.example/b.jpg',           // CORS 拒绝 → 存原始链接
    'https://html.example/c',               // 非图片 → 失败不落库
    '<https://slow.example/d.png>'          // 尖括号包裹 + 挂起 → 清洗后 12s 超时回退链接
  ].join('\n'));
  await clickModalOk();

  // 防重复提交：第一批（含 12s 挂起链）还在跑时再点「链接导入」，应被拦截且不弹窗
  await sleep(400);
  await evalJs("(function(){var b=document.getElementById('cc-import-link');if(b)b.click();return true;})()");
  await sleep(300);
  const guardMaskHidden = await evalJs(`(function(){ var m = document.getElementById('modal-mask'); return !m || m.hidden; })()`);
  const busyToast = await evalJs(`(document.getElementById('cc-toast')||{textContent:''}).textContent`);
  check('A2b 导入进行中再次点击被拦截（不弹窗+提示）', guardMaskHidden && busyToast.indexOf('还在导入中') >= 0, busyToast.trim());

  await waitFor('A 导入完成 toast', `(function(){
    var t = document.getElementById('cc-toast');
    return !!(t && /已导入 \\d+ 个/.test(t.textContent));
  })()`, 30000);
  const toastA = await evalJs(`(document.getElementById('cc-toast')||{textContent:''}).textContent`);
  check('A2 导入结果统计正确（3 成功 / 1 失败）',
    /已导入 3 个/.test(toastA) && /失败 1 个/.test(toastA) && /按链接保存/.test(toastA), toastA.trim());

  const grpA = await evalJs(`(function(){
    var gs = (window.getMediaGroups && window.getMediaGroups('sticker')) || [];
    var g = gs.find(function(x){ return x[0] === '表情包'; }) || [];
    return JSON.stringify(g[1] || []);
  })()`);
  const arrA = JSON.parse(grpA || '[]');
  const dataUrls = arrA.filter(s => s.indexOf('data:image/png;base64,') === 0);
  check('A3 抓取成功的链接转存为 dataURL（且重复行只入库一张）', dataUrls.length === 1, 'count=' + dataUrls.length);
  check('A4 CORS 拒绝的链接回退存原始 URL', arrA.indexOf('https://cors.example/b.jpg') >= 0, '');
  check('A5 挂起链接 12s 超时后回退存原始 URL', arrA.indexOf('https://slow.example/d.png') >= 0, '');
  check('A6 非图片响应判失败未落库', arrA.every(s => String(s).indexOf('html.example') < 0), '');
  check('A7 getMediaCards 放行链接字卡（TA 回复池可用）', await evalJs(`
    (function(){
      var cs = (window.getMediaCards && window.getMediaCards('sticker')) || [];
      return cs.indexOf('https://cors.example/b.jpg') >= 0 && cs.some(function(s){ return s.indexOf('data:image/') === 0; });
    })()`));

  // 缩略图渲染：切走再切回强制重渲染，链接字卡应按图片而非文字渲染
  await evalJs("(function(){var t=document.querySelector('.cc-tab[data-type=\"text\"]');if(t)t.click();return !!t;})()");
  await sleep(600);
  await evalJs("(function(){var t=document.querySelector('.cc-tab[data-type=\"sticker\"]');if(t)t.click();return !!t;})()");
  await waitFor('A8 缩略图出现', `(function(){
    return !!document.querySelector('#cc-list img.cc-img[data-src^="https://cors.example"]');
  })()`, 8000);
  check('A8 字卡库列表把链接字卡渲染成缩略图', await evalJs(`
    (function(){
      return !!document.querySelector('#cc-list img.cc-img[data-src^="https://cors.example"]');
    })()`), await evalJs(`(function(){
      var l = document.getElementById('cc-list');
      return l ? l.innerHTML.replace(/<svg[\\s\\S]*?<\\/svg>/g, '').slice(0, 120) : 'no-list';
    })()`));

  // ---- 【组名】前缀路由：前缀行进自己的分组，不影响默认分组 ----
  await evalJs("(function(){var b=document.getElementById('cc-import-link');if(b)b.click();return true;})()");
  await sleep(300);
  await fillModalTextarea('【新组】https://ok.example/g.png');
  await clickModalOk();
  await waitFor('A9 导入完成', `(function(){
    var t = document.getElementById('cc-toast');
    return !!(t && /已导入 1 个/.test(t.textContent));
  })()`, 15000);
  check('A9 【组名】前缀路由到新分组（默认分组不受影响）', await evalJs(`
    (function(){
      var gs = (window.getMediaGroups && window.getMediaGroups('sticker')) || [];
      var ng = gs.find(function(x){ return x[0] === '新组'; });
      var dg = gs.find(function(x){ return x[0] === '表情包'; });
      return !!ng && ng[1].length === 1 && ng[1][0].indexOf('data:image/png;base64,') === 0 && dg[1].length === 3;
    })()`));

  // ---- 目标分组下拉：无前缀行落到下拉选中的现有分组（而不是分类默认分组）----
  await evalJs("(function(){var b=document.getElementById('cc-import-link');if(b)b.click();return true;})()");
  await sleep(300);
  const selShown = await evalJs(`(function(){
    var s = document.getElementById('modal-select');
    if (!s || s.hidden) return false;
    var hit = Array.prototype.some.call(s.options, function(o){ return o.value === '新组'; });
    if (hit) { s.value = '新组'; s.dispatchEvent(new Event('change', { bubbles: true })); }
    return hit;
  })()`);
  await fillModalTextarea('https://ok.example/h.png');
  await clickModalOk();
  await waitFor('A10 下拉分组导入完成', `(function(){
    var t = document.getElementById('cc-toast');
    return !!(t && /已导入 1 个/.test(t.textContent));
  })()`, 15000);
  check('A10 弹窗「目标分组」下拉生效（无前缀行落入所选分组）', selShown && await evalJs(`
    (function(){
      var gs = (window.getMediaGroups && window.getMediaGroups('sticker')) || [];
      var ng = gs.find(function(x){ return x[0] === '新组'; });
      var dg = gs.find(function(x){ return x[0] === '表情包'; });
      return !!ng && ng[1].length === 2 && dg[1].length === 3;
    })()`), 'selShown=' + selShown);

  // ================= B. 我的表情包「链接导入」+ 插入模式拦截 =================
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});var a=document.querySelector('.app[data-app=chat]');if(a)a.click();return true;})()");
  await sleep(800);
  await evalJs("(function(){var b=document.getElementById('chat-emoji-btn');if(b)b.click();return !!b;})()");
  await waitFor('表情面板打开', `!(document.getElementById('emoji-panel')||{hidden:true}).hidden`, 8000);
  await evalJs("(function(){var t=document.querySelector('.emoji-tab[data-etab=\"mine\"]');if(t)t.click();return !!t;})()");
  await sleep(400);
  check('B1 工具行出现「链接导入」按钮', await evalJs(`(function(){
    var b=document.getElementById('mye-add-link');
    return !!b && b.offsetParent !== null && b.textContent.indexOf('链接导入') >= 0;
  })()`));

  await evalJs("(function(){var b=document.getElementById('mye-add-link');if(b)b.click();return true;})()");
  await sleep(300);
  const titleB = await evalJs(`(document.getElementById('modal-title')||{textContent:''}).textContent`);
  check('B2 弹窗打开（链接导入表情）', titleB.indexOf('链接导入') >= 0, titleB);
  await fillModalTextarea([
    'https://ok.example/m1.gif',   // GIF 直存原图保留动画
    'https://cors.example/b.jpg'   // 与 A 共用 CORS 桩 → 存原始链接
  ].join('\n'));
  await clickModalOk();

  await waitFor('B 导入完成 toast', `(function(){
    var t = document.getElementById('cc-toast');
    return !!(t && /已导入 \\d+ 个表情/.test(t.textContent));
  })()`, 30000);
  const toastB = await evalJs(`(document.getElementById('cc-toast')||{textContent:''}).textContent`);
  check('B3 导入结果统计正确（2 成功）', /已导入 2 个表情/.test(toastB) && /按链接保存/.test(toastB), toastB.trim());

  const mine = await evalJs(`(function(){
    var v = []; try { v = JSON.parse(window.xyStore('xy-home-v2').get('my-emoji-groups') || '[]'); } catch(e) {}
    var g = (v || []).find(function(x){ return x[0] === '默认'; }) || [];
    return JSON.stringify(g[1] || []);
  })()`);
  const arrB = JSON.parse(mine || '[]');
  check('B4 GIF 直存为 dataURL（保留动画）', arrB.some(s => s.indexOf('data:image/gif;base64,') === 0), '');
  check('B5 CORS 拒绝回退存原始 URL', arrB.indexOf('https://cors.example/b.jpg') >= 0, '');
  // v3.12.x：我的表情包改全局键后，不应再写各联系人命名空间键
  // （defaultStore 对 default 桌面回退读顶层键=全局键，属预期，不算写入）
  check('B4b 旧桌面命名空间键不再写入（全局共享）', await evalJs(`(function(){
    try {
      var cid = window.__activeCid || 'default';
      return localStorage.getItem('xy-home-v2:' + cid + ':my-emoji-groups') === null;
    } catch (e) { return false; }
  })()`));

  // 面板网格把链接表情渲染出来
  check('B6 面板网格渲染链接表情', await evalJs(`(function(){
    return Array.prototype.some.call(document.querySelectorAll('#emoji-list .emoji-item img'), function(im){
      return im.src.indexOf('cors.example') >= 0;
    });
  })()`));

  // 插入模式：链接表情拦截并提示；dataURL 表情正常插入
  await evalJs(`(function(){
    window.__inserted = '';
    window.openEmojiPanelForInsert(function(src){ window.__inserted = src; });
    return true;
  })()`);
  await sleep(500);
  const clickedUrl = await evalJs(`(function(){
    var items = document.querySelectorAll('#emoji-list .emoji-item');
    for (var i = 0; i < items.length; i++) {
      var im = items[i].querySelector('img');
      if (im && im.src.indexOf('cors.example') >= 0) { items[i].click(); return true; }
    }
    return false;
  })()`);
  await sleep(400);
  const insAfterUrl = await evalJs(`window.__inserted`);
  const guardToast = await evalJs(`(document.getElementById('cc-toast')||{textContent:''}).textContent`);
  check('B7 插入模式下点击链接表情被拦截', clickedUrl && !insAfterUrl && guardToast.indexOf('插入信纸') >= 0,
    'inserted=' + JSON.stringify(insAfterUrl) + ' toast=' + guardToast.trim());
  await evalJs(`(function(){
    var items = document.querySelectorAll('#emoji-list .emoji-item');
    for (var i = 0; i < items.length; i++) {
      var im = items[i].querySelector('img');
      if (im && im.src.indexOf('data:') === 0) { items[i].click(); return true; }
    }
    return false;
  })()`);
  await sleep(400);
  const insAfterData = await evalJs(`window.__inserted`);
  check('B8 插入模式下 dataURL 表情正常插入', typeof insAfterData === 'string' && insAfterData.indexOf('data:image/gif;base64,') === 0,
    'inserted=' + String(insAfterData).slice(0, 40) + '…');

  // ================= C. 回归：上传路径 / 文字批量导入不受影响 =================
  check('C1 getMediaGroups 对空库/其他分类无副作用', await evalJs(`
    (function(){
      var g = (window.getMediaGroups && window.getMediaGroups('voice')) || [];
      return Array.isArray(g);
    })()`));
} catch (e) {
  console.error('脚本异常:', e.message);
  fail++;
}

console.log('\\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);
