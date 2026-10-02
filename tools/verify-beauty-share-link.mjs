// ===== 专项验证 #602：桌面美化「分享当前美化链接」全链路行为断言（无头 Chrome，不写产物） =====
// 背景（用户问「生成链接发给对方 · 打开自动弹导入 真的有用吗」→ 实测发现整条链路是坏的）：
//   ① 接收端 location.hash.slice(7) 少切一位（#beauty= 是 8 字符）→ b64 变 =xxx → atob 抛
//      Invalid character 被最外层空 catch 吞掉 → 对方打开不弹导入、无任何提示；
//   ② hash 处理块写在 personalize 外层 IIFE 里，`return` 会穿透 → 用途不符/命中 0 项的坏链接
//      会把其后所有初始化（如 #row-theme-mode 绑定）整段跳过；
//   ③ 个别客户端把片段里的 + 编码成 %2B → atob 再崩；
//   ④ 复制失败时弹窗传 noInput:true 把 input 隐藏 → 提示「请手动复制链接」却看不到链接；
//   ⑤ 本地 file:// 打开时 location.origin 为 "null"，生成的链接对方打不开；
//   ⑥ 链接被聊天软件截断后接收端静默失败；启动弹窗可能顶掉导入提示。
// 本脚本走真实点击链路（页面由 src 组装、不依赖构建产物）：
//   S 静态锚 / A 生成端范围收口 / B 接收端导入+不改主题 / C 坏链接明确报错且不破坏初始化 /
//   D %2B 片段兼容 / E 复制全失败时弹窗可见链接本体。
// 用法：node tools/verify-beauty-share-link.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function read(p) { return readFileSync(join(root, p), 'utf8'); }
const buildSrc = read('build.mjs');
function arrOf(name) {
  const m = buildSrc.match(new RegExp('const ' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\]'));
  return m ? m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];
}
const cssFiles = arrOf('cssFiles'), jsFiles = arrOf('jsFiles');
let css = '', js = '';
for (const f of cssFiles) { try { css += read('src/css/' + f) + '\n'; } catch (e) {} }
for (const f of jsFiles) { try { js += '/* ' + f + ' */\n' + read('src/js/' + f) + '\n'; } catch (e) {} }
const tpl = read('src/template.html');
const page = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>' + css + '</style></head><body>' + tpl +
  '<scr' + 'ipt>window.__APP_VERSION__="test";</scr' + 'ipt>' +
  '<scr' + 'ipt>' + js + '</scr' + 'ipt></body></html>';

const server = createServer((req, res) => {
  try {
    const p = req.url.split('?')[0].split('#')[0];
    if (p === '/blank.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body>blank</body></html>'); return; }
    if (p === '/test.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page); return; }
    res.writeHead(404); res.end('nf');
  } catch (e) { res.writeHead(500); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const pageUrl = baseUrl + '/test.html';

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const tmpDir = join(os.tmpdir(), 'mochi-beauty-share-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (10500 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + tmpDir, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const pg = list.find((t) => t.type === 'page');
      if (pg) {
        ws = new WebSocket(pg.webSocketDebuggerUrl);
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
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return { __exc: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text) };
  return r && r.result ? r.result.value : null;
}

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (ok ? '' : '  [' + String(detail).slice(0, 500) + ']')); }

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// 打桩：clipboard 捕获；execCommand 受 __diag.execOk 控制（headless 下真实 execCommand 行为不稳）
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
window.__diag = { clip: null, execOk: false };
try {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: function (t) { window.__diag.clip = t; return Promise.resolve(); } }, configurable: true });
} catch (e) {}
try { document.execCommand = function () { return !!window.__diag.execOk; }; } catch (e) {}
try { localStorage.setItem('xy-home-v2:__last-backup', String(Date.now())); } catch (e) {}
` });

async function dismissSplash() {
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(200);
  await evalJs("(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return true;})()");
  await sleep(100);
  // 每日首次开屏要求滑到底才可进入；无头里直接补 .hide 收起（产品判定 splash 收起即看 .hide / 已移除）
  await evalJs("(function(){var s=document.getElementById('splash'); if(s) s.classList.add('hide'); return true;})()");
  await sleep(300);
}
async function settle() {
  let hits = 0;
  for (let i = 0; i < 60; i++) {
    const raw = await evalJs("(function(){try{return JSON.stringify({rs:document.readyState, has:!!window.xyStore});}catch(e){return JSON.stringify({rs:'err'});}})()");
    let o = null; try { o = JSON.parse(String(raw)); } catch (e) {}
    if (o && o.rs === 'complete' && o.has) hits++; else hits = 0;
    if (hits >= 2) break;
    await sleep(250);
  }
  await sleep(200);
}
async function loadApp() {
  await cdp('Page.navigate', { url: baseUrl + '/blank.html' });
  await sleep(350);
  await cdp('Page.navigate', { url: pageUrl });
  await sleep(2100);
  await dismissSplash();
  await settle();
}
// 注意：只改 hash 的导航不会重新加载文档（handleSharedBeauty 只在加载时跑），
// 必须先到 blank 再进目标 URL，才是真正的「对方打开链接」。
async function navigateTo(url) {
  await cdp('Page.navigate', { url: baseUrl + '/blank.html' });
  await sleep(350);
  await cdp('Page.navigate', { url });
  await sleep(2300);
  await dismissSplash();
  await settle();
}
const modalInfo = `(function(){
  var m=document.getElementById('modal-mask');
  var st=document.getElementById('modal-static');
  return JSON.stringify({ open: m?!m.hidden:false, title: document.getElementById('modal-title')?document.getElementById('modal-title').textContent:'',
    stat: st && !st.hidden ? st.textContent : '', inputHidden: document.getElementById('modal-input')?document.getElementById('modal-input').hidden:null,
    inputVal: document.getElementById('modal-input')?document.getElementById('modal-input').value:'' });
})()`;
async function getModal() { try { return JSON.parse(String(await evalJs(modalInfo))); } catch (e) { return {}; } }
// 导入提示现在是「延迟到无其它弹窗时再弹」，用轮询等它出现
async function waitModal(re, ms) {
  const end = Date.now() + (ms || 6000);
  while (Date.now() < end) {
    const m = await getModal();
    if (m.open && re.test(String(m.title))) return m;
    // 目标提示是「延迟到无其它弹窗时再弹」：把挡在前面的启动弹窗关掉（模拟用户点掉它），
    // 这正是启动弹窗优先级修复要验证的行为——关掉后导入提示应随即出现。
    if (m.open) await closeModal();
    await sleep(200);
  }
  return await getModal();
}
async function closeModal() {
  await evalJs("(function(){var m=document.getElementById('modal-mask'); if(m) m.hidden=true; return true;})()");
  await sleep(150);
}
const readKey = (k) => evalJs(`(function(){
  try { var v = window.xyStore(window.activePrefix()).get(${JSON.stringify(k)}); if (v !== null && v !== undefined) return v; } catch (e) {}
  var v2=localStorage.getItem('xy-home-v2:default:${k}');
  if (v2===null) v2=localStorage.getItem('xy-home-v2:${k}');
  return v2;
})()`);
const showThemeScheme = `(function(){
  document.querySelectorAll('.page').forEach(function(p){p.hidden = p.id !== 'page-theme';});
  return true;
})()`;

// ============ S. 静态锚（修复逻辑必须在位） ============
check('S1 接收端前缀偏移 slice(8) 在位', js.indexOf('location.hash.slice(8)') >= 0);
check('S2 hash 处理包在独立函数 handleSharedBeauty', js.indexOf('(function handleSharedBeauty() {') >= 0);
check('S3 生成端剔除主题 __theme__', js.indexOf("if (k === '__theme__') return;") >= 0);
check('S4 生成端剔除图片组件清单 desk-images', js.indexOf("k === 'desk-images' || bigImg") >= 0);
check('S5 接收端导入前丢弃 __theme__', js.indexOf("delete data['__theme__']") >= 0);
check('S6 复制回退含 execCommand 且失败弹窗展示链接（copyFrom/showShareLink）', js.indexOf('const copyFrom = (text) =>') >= 0 && js.indexOf('const showShareLink = () =>') >= 0);
check('S7 生成端拦截本地文件方式（非 http(s) 不生成坏链接）', js.indexOf('!/^https?:$/.test(location.protocol)') >= 0);
check('S8 接收端对损坏/截断链接给出明确提示', js.indexOf('这条分享链接不完整或已损坏') >= 0);
check('S9 导入提示延迟到无其它弹窗时再弹（启动弹窗优先级）', js.indexOf('let quietMs = 0;') >= 0);
check('S10 分享链接硬上限已收到 16000', js.indexOf('const SHARE_URL_MAX = 16000;') >= 0);

// ============ A. 生成端：链接范围收口 ============
await loadApp();
const SEED = {
  'widget-bg-color': '#f5f0eb',
  'widget-btn-color': '#ff8800',
  'desk-card-radius': '18',
  'phone-bg-preset': '海洋'
};
await evalJs(`(function(){
  var seed=${JSON.stringify(SEED)};
  Object.keys(seed).forEach(function(k){ localStorage.setItem('xy-home-v2:default:'+k, seed[k]); });
  localStorage.setItem('xy-home-v2:theme-mode', 'dark');
  localStorage.setItem('xy-home-v2:default:desk-images', JSON.stringify([{id:'x1'}]));
  localStorage.setItem('xy-home-v2:default:desk-image-src-x1', 'data:image/png;base64,AAAA');
  localStorage.setItem('xy-home-v2:default:app-icon-chat', 'data:image/png;base64,BBBB');
  return true;
})()`);
await sleep(250);
await evalJs('window.__diag.clip=null');
await evalJs(showThemeScheme);
await evalJs("document.getElementById('row-beauty-share').click()");
await sleep(500);
const sharedUrl = await evalJs('(function(){return window.__diag.clip?String(window.__diag.clip):null;})()');
check('A1 点「分享当前美化链接」生成并通过复制通道拿到链接', !!sharedUrl && sharedUrl.indexOf('#beauty=') >= 0, sharedUrl);
let decoded = null;
if (sharedUrl && sharedUrl.indexOf('#beauty=') >= 0) {
  try { decoded = JSON.parse(decodeURIComponent(escape(Buffer.from(sharedUrl.split('#beauty=')[1], 'base64').toString('binary')))); } catch (e) { decoded = { __fail: e.message }; }
}
check('A2 链接可 base64 解出 JSON 且含种入的配色键', decoded && decoded['widget-bg-color'] === '#f5f0eb' && decoded['phone-bg-preset'] === '海洋', JSON.stringify(decoded && { a: decoded['widget-bg-color'], b: decoded['phone-bg-preset'] }));
check('A3 链接不含主题 __theme__（不改对方深色模式）', !!decoded && decoded['__theme__'] === undefined, decoded && decoded['__theme__']);
const hasImg = !!decoded && Object.keys(decoded).some(k => (k === 'desk-images' || k.indexOf('desk-image-src-') === 0 || k.indexOf('app-icon-') === 0) || (typeof decoded[k] === 'string' && decoded[k].indexOf('data:') === 0));
check('A4 链接不含图片本体/图片组件清单/自定义图标图', !!decoded && !hasImg, decoded && Object.keys(decoded).filter(k => /desk-images|desk-image-src|app-icon/.test(k) || String(decoded[k]).indexOf('data:') === 0).join(','));
const toastTxt = await evalJs("(function(){var t=document.getElementById('cc-toast');return t?t.textContent:'';})()");
check('A5 复制成功提示说明范围（不含图片）', /不含图片/.test(String(toastTxt)), toastTxt);

// ============ B. 接收端：打开链接弹导入 + 应用 + 不改主题 ============
// 清掉种入键，让「导入后应用」是可验证的真效果（同源 localStorage 会跨导航保留）
await evalJs(`(function(){
  var ks=${JSON.stringify(Object.keys(SEED))};
  ks.forEach(function(k){ try{localStorage.removeItem('xy-home-v2:default:'+k);}catch(e){} try{localStorage.removeItem('xy-home-v2:'+k);}catch(e){} });
  localStorage.setItem('xy-home-v2:theme-mode','light');
  return true;
})()`);
await sleep(200);
const clearedBg = await readKey('widget-bg-color');
check('B0 清空前置（widget-bg-color 已不存在，确保 B3 是真导入）', clearedBg === null || clearedBg === undefined, clearedBg);
await navigateTo(pageUrl + sharedUrl.slice(sharedUrl.indexOf('#beauty=')));
const m1 = await waitModal(/导入分享的美化方案/);
check('B1 对方打开分享链接 → 弹出「导入分享的美化方案？」', m1.open === true && /导入分享的美化方案/.test(String(m1.title)), JSON.stringify(m1));
check('B2 导入弹窗如实说明范围（不含图片、不改深色模式）', /不含图片/.test(String(m1.stat)) && /深色模式/.test(String(m1.stat)), m1.stat);
const tok = await evalJs('(function(){window.__tok=String(Math.random());return window.__tok;})()');
await evalJs("(function(){var ps=document.querySelectorAll('#modal-pills .pill');for(var i=0;i<ps.length;i++){if(ps[i].textContent==='导入'){ps[i].click();return true;}}return false;})()");
let reloaded = false;
for (let i = 0; i < 30; i++) {
  await sleep(200);
  const t = await evalJs('window.__tok');
  if (t !== tok) { reloaded = true; break; }
}
if (reloaded) { await dismissSplash(); await settle(); } else { await settle(); }
check('B3 点「导入」后配色键已应用', (await readKey('widget-bg-color')) === '#f5f0eb', await readKey('widget-bg-color'));
check('B4 导入不改对方主题（theme-mode 仍为 light）', (await readKey('theme-mode')) === 'light', await readKey('theme-mode'));

// ============ C. 坏链接必须明确报错，且不破坏后续初始化 ============
const badKind = Buffer.from(JSON.stringify({ __kind__: 'mochi-chat-beauty', 'cs-out-bg': '#112233' })).toString('base64');
await navigateTo(pageUrl + '#beauty=' + badKind);
const mBad = await getModal();
check('C1 用途不符的链接不弹导入窗', mBad.open !== true || !/导入分享的美化方案/.test(String(mBad.title)), JSON.stringify(mBad));
await evalJs("document.getElementById('row-theme-mode').click()");
await sleep(300);
const mTheme = await getModal();
check('C2 坏链接后初始化未被跳过（#row-theme-mode 仍能弹窗）', /深色模式/.test(String(mTheme.title)), JSON.stringify(mTheme));
await closeModal();
// 非法 base64：原来静默，现在必须明确告知
await navigateTo(pageUrl + '#beauty=%@@invalid@@%');
const mInv = await waitModal(/无法读取/);
check('C3 非法链接不再静默：弹「分享链接无法读取」并引导导出文件', mInv.open === true && /无法读取/.test(String(mInv.title)) && /导出美化方案/.test(String(mInv.stat)), JSON.stringify(mInv));
await closeModal();
await evalJs("document.getElementById('row-theme-mode').click()");
await sleep(300);
const mTheme2 = await getModal();
check('C4 非法片段后初始化仍在（#row-theme-mode 可弹窗）', /深色模式/.test(String(mTheme2.title)), JSON.stringify(mTheme2));
await closeModal();
// 被截断的真实链接（模拟聊天软件截断）：也必须明确告知，不能静默
const truncB64 = String(sharedUrl.split('#beauty=')[1] || '').slice(0, 18);
await navigateTo(pageUrl + '#beauty=' + truncB64);
const mTr = await waitModal(/无法读取/);
check('C5 被截断的链接 → 明确提示无法读取（不再静默失败）', mTr.open === true && /无法读取/.test(String(mTr.title)), JSON.stringify(mTr));
await closeModal();

// ============ D. %2B 片段兼容 ============
// 构造一个 base64 里确实含 '+' 的合法分享数据（随机 pad 直到出现 +），再把 + 换成 %2B
let plusB64 = null;
for (let cp = 0x100; cp < 0x8000 && !plusB64; cp++) {
  if (cp >= 0xD800 && cp <= 0xDFFF) continue;
  const j = JSON.stringify(Object.assign({}, decoded || {}, { __pad: String.fromCodePoint(cp) }));
  const b = Buffer.from(j, 'utf8').toString('base64');
  if (b.indexOf('+') >= 0) plusB64 = b;
}
check('D0 构造出含 + 的 base64（前置条件）', !!plusB64 && plusB64.indexOf('+') >= 0, plusB64 && plusB64.slice(0, 40));
await navigateTo(pageUrl + '#beauty=' + String(plusB64).replace(/\+/g, '%2B'));
const mPct = await waitModal(/导入分享的美化方案/);
check('D1 片段里 + 被编码成 %2B 时仍能弹导入', mPct.open === true && /导入分享的美化方案/.test(String(mPct.title)), JSON.stringify(mPct));
await closeModal();

// ============ E. 复制全失败 → 弹窗可见链接本体（原实现 input 被 noInput 隐藏） ============
await loadApp();
await evalJs("(function(){try{Object.defineProperty(navigator,'clipboard',{value:{writeText:function(){return Promise.reject(new Error('x'));}},configurable:true});}catch(e){} return true;})()");
await evalJs('window.__diag.execOk=false');
await evalJs(showThemeScheme);
await evalJs("document.getElementById('row-beauty-share').click()");
await sleep(1600);
const mFall = await getModal();
check('E1 复制全失败时弹「分享链接」窗', mFall.open === true && /分享链接/.test(String(mFall.title)), JSON.stringify(mFall));
check('E2 弹窗里能看到链接本体（可长按复制）', String(mFall.stat).indexOf('#beauty=') >= 0, String(mFall.stat).slice(0, 160));

chrome.kill();
try { rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
server.close();
const fails = results.filter((o) => !o.ok).length;
console.log(fails ? ('FAIL ' + fails + '/' + results.length) : ('ALL PASS ' + results.length + '/' + results.length));
process.exit(fails ? 1 : 0);
