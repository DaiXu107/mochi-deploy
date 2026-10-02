// #936 常驻行为回归：牌面图鉴「批量上传（按文件名自动对应牌）」认不出阿拉伯数字牌名
// 用户反馈：文件名写成「宝剑1」这类带阿拉伯数字的牌名，批量上传全部落进「没识别到对应牌」。
// 根因：牌库里小阿卡纳 40 张的名字是中文数字（宝剑王牌 / 宝剑二 … 宝剑十），而匹配器只做
//       「文件名 === 牌名」与「文件名含牌名子串」两路，数字写法一条都进不了候选。
// 修法：匹配前把全角数字折算半角；收集候选时把牌名再展开一份数字别名（王牌→A/1/0、结尾中文
//       数字→1..10）去匹配，并对「数字结尾的别名」加粘连数字守卫（宝剑11 不得读成 宝剑1+1）；
//       命中后返回的仍是库里真名，其余口径（纯编号 / 前缀序号 / 体系前缀 / 跨体系同名）不动。
// 断言全部走真实链路：点「牌面图鉴」→点「批量上传」拿到常驻 file input → 塞 DataTransfer
// 文件列表 → 派发 change → 读 divine-faces-idx / 轻提示 / 未识别弹窗。红绿两侧测同一行为。
// 断言：
//   S1~S5 产物锚（别名展开、粘连数字守卫、补零折算、全角折算、说明文案）；
//   B1 用户原报「宝剑1.png」＝宝剑王牌；
//   B2 四花色 ×1..10 共 40 个数字文件名一批全部命中对应牌（期望值从页面真牌库反查）；
//   B3 A / 0 / 01 / 全角 与中文数字写法都落到同一张牌；
//   B4 含前后缀的长文件名仍命中；
//   B5 纯编号 / 前缀序号 / 体系前缀语义一字未变；
//   B6 大阿卡纳·宫廷牌·雷诺曼牌名零回归；B6b 同名跨体系无前缀按当前管理页签取体系；
//   B7 不存在的牌号与无关文件名整批仍不识别（防修过头：不放宽成前缀模糊）；
//   B8 命中的文件真落库（原图+缩略图、牌库 icon 换成合成键、图鉴计数跟上），无关文件被跳过；
//   Z 全程零 JS 异常。
// 用法：node tools/verify-divination-face-filename.mjs [被测根目录]（缺省＝脚本所在仓库）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(resolve(process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..'));
if (!existsSync(join(root, 'index.html'))) { console.error('产物不在：' + root); process.exit(2); }
console.log('被测产物：' + root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' ← ' + detail : '')); }
};

// ---- S 组：锚点（外置件 js/<file> 与内联 index.html 两种落点都认）----
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const divCode = (() => { try { return readFileSync(join(root, 'js', 'divination.js'), 'utf8'); } catch (e) { return ''; } })() + indexHtml;
console.log('S 产物锚');
ok('S1 候选收集按牌名展开数字别名（王牌→A/1/0、中文数字→阿拉伯数字）',
  divCode.includes('varifyName(c.name).forEach') && divCode.includes('const CN_DIGIT = {'));
ok('S2 数字别名带粘连数字守卫（不存在的宝剑11 不得读成宝剑1）',
  divCode.includes('if (!/[0-9０-９]$/.test(v)) return s.indexOf(v) >= 0;') && divCode.includes('if (!DIGIT.test(s.charAt(i + v.length))) return true;'));
ok('S3 补零写法折算（宝剑01→宝剑1，且不误折宝剑100/权杖00）', divCode.includes("s = s.replace(/(\\D)0+([1-9])/, '$1$2');"));
ok('S4 全角数字折算半角后再匹配', divCode.includes('s = s.replace(/[０-９]/g,'));
ok('S5 批量上传说明文案列出数字牌名写法', divCode.includes('· 数字牌名：<b>宝剑1.png</b>'));

// ---- 无头浏览器 ----
const candidates = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9870 + Math.floor(Math.random() * 20));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-936-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
try {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        break;
      }
    } catch (e) {}
    await sleep(150);
  }
  if (!ws) throw new Error('无法连接无头浏览器');
} catch (e) { console.error('SKIP: ' + e.message); chrome.kill(); server.close(); process.exit(2); }

function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: '(async()=>{' + expr + '})()', awaitPromise: true, returnByValue: true, userGesture: true });
    if (r && r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300) };
    return r && r.result ? r.result.value : null;
  } catch (e) { return { __err: String(e).slice(0, 120) }; }
}
const J = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : (v || {}); } catch (e) { return {}; } };

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "(function(){var ids=['qa-mask','tc-mask','call-mask','img-view-mask'];var sweep=function(){for(var i=0;i<ids.length;i++){var e=document.getElementById(ids[i]);if(e&&!e.hidden)e.hidden=true;}};setInterval(sweep,300);document.addEventListener('DOMContentLoaded',sweep);})()" });

await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if ((await evalJs('return !!window.__mochiDataReady')) === true) break; await sleep(300); }
await evalJs("var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}} return true;");
await sleep(600);
await evalJs("var c=document.getElementById('splash-confirm-ok');if(c&&!c.hidden){try{c.click();}catch(e){}} return true;");
await sleep(400);

// 进占卜页 → 开「牌面图鉴」浮层 → 点一次「批量上传」把常驻选择器接上真实 onFiles
await evalJs(`var d=document.getElementById('page-divine'); if(d){document.querySelectorAll('.page').forEach(function(p){p.hidden=true;}); d.hidden=false;}
  var b=document.getElementById('div-faces-btn'); if(b) b.click(); return !!b;`);
await sleep(700);
await evalJs("var t=document.getElementById('divf-batch'); if(t) t.click(); return !!t;");
await sleep(1200);
const picked = await evalJs("return !!document.getElementById('dev-divf-batch-pick');");
ok('B0 前提：点「批量上传」后常驻文件选择器已就位', picked === true, String(picked));

// 一批上传 → 返回落库牌集 / 轻提示 / 未识别弹窗 / 图鉴计数
async function upload(names, mode) {
  const r = await evalJs(`
    var g = window.xyStore('xy-home-v2');
    var inp = document.getElementById('dev-divf-batch-pick');
    if (!inp) return JSON.stringify({ err: 'no-input' });
    var want = ${JSON.stringify(mode || 'tarot')};
    var mb = document.querySelector('.divf-mode[data-fmode="' + want + '"]');
    if (mb && !mb.classList.contains('sel')) mb.click();
    // 复位索引：每批的落库集合就是这一批的匹配结果（逐张精确归因）
    g.set('divine-faces-idx', '[]');
    var tt = document.getElementById('cc-toast'); if (tt) tt.textContent = '';
    var mm = document.getElementById('modal-mask');
    if (mm && !mm.hidden) { var mk = document.getElementById('modal-ok'); if (mk) mk.click(); await new Promise(function (r) { setTimeout(r, 200); }); }
    function png(seed) {
      var cv = document.createElement('canvas'); cv.width = 160; cv.height = 240;
      var cx = cv.getContext('2d'); var h = 0; var s = String(seed);
      for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffffff;
      cx.fillStyle = 'rgb(' + (h & 255) + ',' + ((h >> 8) & 255) + ',' + ((h >> 16) & 255) + ')';
      cx.fillRect(0, 0, 160, 240);
      cx.fillStyle = 'rgba(255,255,255,.6)'; cx.fillRect(20, 30, 120, 180);
      return new Promise(function (res) { cv.toBlob(function (bl) { res(bl); }, 'image/png'); });
    }
    var names = ${JSON.stringify(names)};
    return Promise.all(names.map(function (n) { return png(n).then(function (bl) { return new File([bl], n, { type: 'image/png' }); }); }))
      .then(function (files) {
        var dt = new DataTransfer();
        files.forEach(function (f) { dt.items.add(f); });
        inp.files = dt.files;
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return new Promise(function (res) {
          var t0 = Date.now();
          (function wait() {
            var tx = (document.getElementById('cc-toast') || {}).textContent || '';
            var done = /批量导入|没识别到对应牌/.test(tx);
            if (done || Date.now() - t0 > 30000) {
              var idx = []; try { idx = JSON.parse(g.get('divine-faces-idx') || '[]'); } catch (e) {}
              var mask = document.getElementById('modal-mask');
              res(JSON.stringify({
                keys: idx.map(function (x) { return x.m + '|' + x.n; }).sort(),
                toast: tx, n: idx.length, ms: Date.now() - t0,
                modal: (mask && !mask.hidden) ? (((document.getElementById('modal-title') || {}).textContent || '') + '|' + ((document.getElementById('modal-static') || {}).textContent || '')) : '',
                gal: (document.getElementById('divf-gal-count') || {}).textContent || ''
              }));
              return;
            }
            setTimeout(wait, 120);
          })();
        });
      });
  `);
  return J(r);
}

// 一批文件名 → 断言落库集合（cases: [文件名, 期望 'mode|牌名' 或 null]；期望值由真牌库反查，不硬编码牌名）
const deck = await evalJs(`return { tarot: (window.__TAROT__||[]).map(function(c){return c.name;}), leno: (window.__LENO__||[]).map(function(c){return c.name;}) };`);
const SUITS = ['权杖', '圣杯', '宝剑', '星币'];
const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const T = (n) => 'tarot|' + n;
const L = (n) => 'lenormand|' + n;
async function expectSet(cases, mode, label) {
  const names = cases.map(c => c[0]);
  const res = await upload(names, mode);
  const want = [];
  const bad = [];
  cases.forEach(([, wantKey]) => {
    if (!wantKey) return;
    if (want.indexOf(wantKey) < 0) want.push(wantKey);
  });
  const got = res.keys || [];
  want.forEach(k => { if (got.indexOf(k) < 0) bad.push('缺 ' + k); });
  got.forEach(k => { if (want.indexOf(k) < 0) bad.push('多 ' + k); });
  if (res.__err) bad.push('ERR ' + res.__err);
  ok(label, !res.__err && !res.err && bad.length === 0 && /\d/.test(res.toast || ''),
    bad.join(' ') + ' toast=' + (res.toast || '') + ' ms=' + res.ms);
  return res;
}

// ---- B1 用户原报 ----
console.log('B1 用户原报文件名');
await expectSet([['宝剑1.png', T('宝剑王牌')]], 'tarot', 'B1 「宝剑1.png」批量上传后落库到「宝剑王牌」');

// ---- B2 四花色 × 1..10 ----
const b2cases = [];
for (const su of SUITS) for (let n = 1; n <= 10; n++) {
  const nm = su + (n === 1 ? '王牌' : CN[n]);
  b2cases.push([su + n + '.png', deck.tarot.indexOf(nm) >= 0 ? T(nm) : null]);
}
console.log('B2 数字牌名全覆盖（一批 40 个文件）');
const missing = b2cases.filter(c => c[1] === null).map(c => c[0]);
ok('B2a 前提：牌库四花色 × 王牌/二…十 共 40 张齐全', missing.length === 0, missing.join(' '));
const dup = deck.tarot.filter((v, i) => deck.tarot.indexOf(v) !== i);
ok('B2b 前提：塔罗牌库无重名（落库集合可精确归因）', dup.length === 0, dup.join(' '));
await expectSet(b2cases, 'tarot', 'B2 四花色 ×1..10 共 40 个数字文件名一批全部命中对应牌');

// ---- B3 别名 / 补零 / 全角 与中文写法等价 ----
console.log('B3 别名与原写法等价');
await expectSet([
  ['圣杯A.png', T('圣杯王牌')], ['星币0.png', T('星币王牌')], ['宝剑01.png', T('宝剑王牌')],
  ['权杖9.png', T('权杖九')], ['宝剑10.png', T('宝剑十')], ['宝剑十.png', T('宝剑十')],
  ['圣杯１.png', T('圣杯王牌')], ['权杖１０.png', T('权杖十')]
], 'tarot', 'B3 A / 0 / 01 / 全角数字与中文数字写法都落到同一张牌');

// ---- B4 含前后缀的长文件名 ----
console.log('B4 长文件名子串');
await expectSet([
  ['塔罗-宝剑1.png', T('宝剑王牌')], ['宝剑3-正位.jpg', T('宝剑三')], ['宝剑十10.png', T('宝剑十')],
  ['我的宝剑8(1).png', T('宝剑八')], ['牌面-圣杯7-背.png', T('圣杯七')]
], 'tarot', 'B4 含前后缀的长文件名仍按数字/中文牌名命中');

// ---- B5 既有编号/前缀口径不动 ----
console.log('B5 前缀序号与体系前缀');
const last = String(deck.tarot.length - 1);
await expectSet([
  ['07-战车.png', T('战车')], ['00.png', T(deck.tarot[0])], [last + '.png', T(deck.tarot[deck.tarot.length - 1])],
  ['tarot-10-命运之轮.png', T('命运之轮')], ['塔罗-宝剑2.png', T('宝剑二')], ['12.png', T(deck.tarot[12])],
  ['塔罗2.png', T(deck.tarot[2])], ['雷诺曼-骑士.png', deck.leno.indexOf('骑士') >= 0 ? L('骑士') : null]
], 'tarot', 'B5 纯编号/前缀序号/体系前缀语义一字未变');

// ---- B6 大阿卡纳 / 宫廷牌 / 雷诺曼零回归 ----
console.log('B6 其余牌名照常');
ok('B6a 前提：雷诺曼牌库含「四叶草」「锚」', deck.leno.indexOf('四叶草') >= 0 && deck.leno.indexOf('锚') >= 0, JSON.stringify(deck.leno.slice(0, 5)));
await expectSet([
  ['愚人.png', T('愚人')], ['世界.png', T('世界')], ['宝剑侍从.png', T('宝剑侍从')], ['宝剑王后.png', T('宝剑王后')],
  ['星币骑士.png', T('星币骑士')]
], 'tarot', 'B6 大阿卡纳/宫廷牌牌名匹配零回归');
const lenoCases = [['四叶草.png', L('四叶草')], ['锚.png', L('锚')], ['蛇.png', deck.leno.indexOf('蛇') >= 0 ? L('蛇') : null], ['雷诺曼-骑士.png', L('骑士')]];
await expectSet(lenoCases.filter(c => c[1]), 'lenormand', 'B6b 雷诺曼牌名在当前页签体系下命中');
const both = deck.tarot.filter(n => deck.leno.indexOf(n) >= 0);
ok('B6c 前提：存在同名跨体系的牌（太阳/月亮/星星…）', both.length > 0, JSON.stringify(both.slice(0, 6)));
if (both.length) {
  const nm = both[0];
  await expectSet([[nm + '.png', L(nm)]], 'lenormand', 'B6d 同名跨体系无前缀＝按当前管理页签取体系（雷诺曼页签 → ' + nm + ' 归雷诺曼）');
  await expectSet([[nm + '.png', T(nm)]], 'tarot', 'B6e 同一文件切回塔罗页签后归塔罗');
}

// ---- B7 不存在的牌号 / 无关文件名整批不认（防修过头）----
console.log('B7 判别力');
const negNames = ['宝剑11.png', '圣杯11.png', '宝剑20.png', '宝剑111.png', '权杖00.png', '星币000.png', 'IMG_2024.png', '照片 1.png', '无牌名文件.png'];
const negRes = await upload(negNames, 'tarot');
ok('B7 不存在的牌名/无关文件名仍然不识别（不放宽成前缀模糊）',
  !negRes.__err && !negRes.err && (negRes.keys || []).length === 0 && (negRes.toast || '').indexOf('没识别到对应牌') >= 0,
  JSON.stringify({ keys: negRes.keys, toast: negRes.toast, err: negRes.__err || negRes.err }));
ok('B7b 未识别文件逐个列进弹窗（用户能看到该改哪个文件名）',
  (negRes.modal || '').indexOf('宝剑11.png') >= 0 && (negRes.modal || '').indexOf('以下 9 个文件') >= 0, String(negRes.modal).slice(0, 120));

// ---- B8 命中的文件真落库并接线到牌库 ----
console.log('B8 落库与图标接线');
const b8 = await upload(['宝剑1.png', '宝剑2.png', '宝剑10.png', '这张没有对应牌.png'], 'tarot');
const b8sorted = [...(b8.keys || [])].sort();
ok('B8a 数字文件名批量导入 3 张、跳过 1 个',
  !b8.__err && JSON.stringify(b8sorted) === JSON.stringify(['tarot|宝剑十', 'tarot|宝剑二', 'tarot|宝剑王牌'].sort()) &&
  /批量导入 3 张牌面/.test(b8.toast || '') && /跳过 1 个/.test(b8.toast || ''),
  JSON.stringify({ keys: b8.keys, toast: b8.toast }));
const b8b = await evalJs(`
  var g = window.xyStore('xy-home-v2');
  function len(k){ var v = g.get(k) || ''; return v.length; }
  var c = (window.__TAROT__||[]).find(function(x){ return x.name === '宝剑王牌'; });
  var svg = String((window.__TAROT_ICONS__ || {})[c ? c.icon : ''] || '');
  var hm = svg.match(/href="(data:image[^"]{0,30})/);
  var img = document.querySelector('#divf-grid .divf-cell img');
  return JSON.stringify({
    icon: c ? c.icon : '',
    hrefHead: hm ? hm[1] : '',
    face: len('divine-face-tarot-' + encodeURIComponent('宝剑王牌')),
    thb: len('divine-face-thb-tarot-' + encodeURIComponent('宝剑王牌')),
    gal: (document.getElementById('divf-gal-count') || {}).textContent || '',
    gridImg: !!img && String(img.getAttribute('src') || '').indexOf('data:image/') === 0
  });
`);
const bb = J(b8b);
ok('B8b 原图＋缩略图落库、牌库 icon 换成合成键并注册成 dataURL',
  bb.icon === '@df:tarot:宝剑王牌' && bb.hrefHead.indexOf('data:image') === 0 && bb.face > 1000 && bb.thb > 200,
  JSON.stringify(bb));
ok('B8c 图鉴页计数与实际张数一致、格子渲染出上传的图',
  /已上传 3 张/.test(bb.gal || '') && bb.gridImg === true, JSON.stringify({ gal: bb.gal, gridImg: bb.gridImg }));

// ---- Z 零异常 ----
const zerr = await evalJs(`return (window.__jsErrors || []).slice(-6).join(' | ');`);
ok('Z 全程零 JS 异常', !zerr, String(zerr));

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
await cdp('Browser.close').catch(() => {});
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);
