// ===== 验证 #549：新手引导 / 设置搜索直达功能大全 / 字卡库空状态可点 =====
// 内存拼装 src（与 build.mjs 同序、不写产物）→ 无头 Chrome 实测，构建前后都可跑。
// 用法：node tools/verify-onboarding-guide.mjs（需本机 Chrome/Edge）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => readFileSync(join(root, 'src', p), 'utf8');

const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const arr = (name) => new Function('return ' + bm.match(new RegExp('const ' + name + ' = (\\[.*?\\]);', 's'))[1])();
const css = arr('cssFiles').map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
const js = arr('jsFiles').map((f) => readFileSync(join(root, 'src', 'js', f), 'utf8')).join('\n');
let html = read('template.html').replace('__APP_VERSION__', 'v3.26.0-test');
html = html.replace('</head>', '<style>' + css + '</style></head>');
html = html.replace('</body>', '<script>' + js + '<\/script></body>');

let fail = 0;
const T = (name, ok, extra) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + extra : '')); if (!ok) fail++; };

// —— 静态断言（不依赖浏览器） ——
T('S1 onboarding.js 已登记进 jsFiles', arr('jsFiles').indexOf('onboarding.js') >= 0);
T('S2 __guide-done 已列入 contacts.js 全局系统键', read('js/contacts.js').indexOf("'__guide-done'") >= 0);
T('S3 personalize.js 含设置搜索直达跳转行', read('js/personalize.js').indexOf('jumpBtn.textContent') >= 0);
T('S4 feature-hub.js 暴露 window.mochiFeatureHubOpen', read('js/feature-hub.js').indexOf('window.mochiFeatureHubOpen = function') >= 0);
T('S5 chatcard.js 空状态按钮已接线', read('js/chatcard.js').indexOf('__ccEmptyActBound') >= 0);
if (fail) { console.log('静态断言已有失败，跳过无头部分'); process.exit(1); }

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
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const cdpPort = 9900 + Math.floor(Math.random() * 150);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-og-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} server.close(); });

let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expr) { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : undefined; }

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Page.navigate', { url: baseUrl + '/' });
await sleep(2600);
await ev(`(()=>{ const s=document.getElementById('splash'); if(s) s.remove(); const q=document.getElementById('qa-mask'); if(q) q.hidden=true; })()`);

// B1 引导函数存在
T('B1 window.openMochiGuide 已定义', await ev(`typeof window.openMochiGuide === 'function'`));
// B2 打开引导
await ev(`window.openMochiGuide()`);
await sleep(120);
T('B2 引导弹层可见（3 步）', await ev(`(()=>{const m=document.querySelector('.mg-guide-mask'); return !!m && !m.hidden && m.querySelectorAll('[data-gstep]').length===3;})()`));
// B2a #577（用户 2026-09-16：引导没说明「桌面昵称和聊天昵称独立、需单独设置」）——第 1 步必须
// 渲染出补充提示块，并写明「两套 / 不同步」+「聊天设置 → 形象」这条单独设置路径。
T('B2a 引导第 1 步写明桌面 / 聊天两套昵称及聊天侧设置路径', await ev(`(()=>{const w=document.querySelector('[data-gstep="name"] .mg-guide-warn'); if(!w) return false; const t=w.textContent; return t.indexOf('两套')>=0 && t.indexOf('不同步')>=0 && t.indexOf('聊天设置')>=0 && t.indexOf('形象')>=0;})()`));
T('B2b 引导提示块有可见样式（未设样式＝说明退回裸文字）', await ev(`(()=>{const w=document.querySelector('[data-gstep="name"] .mg-guide-warn'); if(!w) return false; const s=getComputedStyle(w); return s.display==='block' && parseFloat(s.fontSize)>0;})()`));
// B2c #577b（用户追加 2026-09-16：「聊天里的更换头像，你没说可以直接在聊天设置里更换，
// 或在聊天输入栏左边打开更多功能里的【头像互动】上传头像库可互动」）——第 1 步还要给出
// 「更多功能 → 头像互动」这条换聊天头像的路，并与 .mg-guide-warn 区分成独立蓝色提示块。
T('B2c 引导第 1 步补「更多功能 → 头像互动」换聊天头像路径', await ev(`(()=>{const p=document.querySelector('[data-gstep="name"] .mg-guide-tip'); if(!p) return false; const t=p.textContent; return t.indexOf('更多功能')>=0 && t.indexOf('头像互动')>=0 && t.indexOf('头像库')>=0 && t.indexOf('随机换头像')>=0;})()`));
T('B2d 头像互动提示块与昵称提示块样式区分且可点区不受影响', await ev(`(()=>{const p=document.querySelector('[data-gstep="name"] .mg-guide-tip'); const w=document.querySelector('[data-gstep="name"] .mg-guide-warn'); if(!p||!w) return false; const a=getComputedStyle(p), b=getComputedStyle(w); return a.display==='block' && a.backgroundColor!==b.backgroundColor && document.querySelectorAll('[data-gstep]').length===3;})()`));
// B3 点第 3 步 → 进聊天页
await ev(`document.querySelector('[data-gstep="chat"]').click()`);
await sleep(150);
T('B3 点「开始聊天」跳到聊天页且引导收起', await ev(`!document.getElementById('page-chat').hidden && document.querySelector('.mg-guide-mask').hidden`));
// B4 关闭写标记
await ev(`localStorage.removeItem('xy-home-v2:__guide-done'); window.openMochiGuide()`);
await sleep(80);
await ev(`document.querySelector('[data-gact="done"]').click()`);
await sleep(80);
T('B4 关闭引导写入 __guide-done', await ev(`!!localStorage.getItem('xy-home-v2:__guide-done')`));

// B5 设置搜索 → 直达功能大全（带关键词）
await ev(`(()=>{const t=document.querySelector('.tab[data-page="page-setting"]'); if(t) t.click();})()`);
await sleep(120);
await ev(`(()=>{const i=document.getElementById('set-search-input'); i.value='红包'; i.dispatchEvent(new Event('input'));})()`);
await sleep(100);
T('B5a 搜索时出现「在功能大全中搜索」入口', await ev(`(()=>{const j=document.querySelector('#page-setting [data-og="x"], #page-setting div[style*="rgba(47,111,208"]'); const b=document.querySelectorAll('#page-setting div'); let hit=null; for(const d of b){ if(d.textContent && d.textContent.indexOf('在「功能大全」中搜索')===0 && d.style && d.style.cursor==='pointer'){hit=d;break;} } return !!hit && !hit.parentElement.hidden;})()`));
await ev(`(()=>{ let hit=null; for(const d of document.querySelectorAll('#page-setting div')){ if(d.textContent && d.textContent.indexOf('在「功能大全」中搜索')===0 && d.style && d.style.cursor==='pointer'){hit=d;break;} } if(hit) hit.click(); })()`);
await sleep(150);
T('B5b 点击后打开功能大全并带入关键词', await ev(`!document.getElementById('page-featurehub').hidden && document.getElementById('fhub-search').value==='红包'`));
T('B5c 命中过滤（红包相关行可见）', await ev(`[...document.querySelectorAll('#fhub-body .set-row')].filter(r=>r.style.display!=='none').length >= 1`));
await ev(`document.getElementById('fhub-back').click()`);
await sleep(100);
T('B5d 返回回设置页', await ev(`!document.getElementById('page-setting').hidden`));

// B6 字卡库专属字卡空状态可点
await ev(`(()=>{const t=document.querySelector('.tab[data-page="page-chatcard"]'); if(t) t.click();})()`);
await sleep(150);
await ev(`document.getElementById('li-custom-cards').click()`);
await sleep(200);
T('B6 空字卡列表出现「批量导入字卡」按钮', await ev(`!!document.querySelector('#cc-list [data-cc-empty="import"]')`));

console.log(fail === 0 ? '== 全部通过 ==' : ('== 失败 ' + fail + ' 项 =='));
process.exit(fail === 0 ? 0 : 1);
