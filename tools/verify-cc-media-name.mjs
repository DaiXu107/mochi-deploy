// ===== 验证 #680：字卡库「图片/表情包名称」编辑 + 按名称搜索（未命名不参与搜索）=====
// 用户需求（2026-09-17）：「公用字卡和专属字卡里要新增图片和表情包，也可以编辑名称，然后可以搜索，
// 如果没有上传名称搜索的时候不应该搜索出来」＋顶部搜索不再直出 @@m: 令牌乱码。
// 内存拼装 src（与 build.mjs 同序、不写产物）→ 无头 Chrome 实测行为。
// 用法：node tools/verify-cc-media-name.mjs（需本机 Chrome/Edge）。
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
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const cdpPort = 9700 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vccn-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
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
await ev(`(()=>{ const s=document.getElementById('splash'); if(s) s.remove(); const q=document.getElementById('qa-mask'); if(q) q.hidden=true;
  const g=document.querySelector('.mg-guide-mask'); if(g) g.remove(); const m=document.getElementById('modal-mask'); if(m) m.hidden=true;
  document.querySelectorAll('.page').forEach(p=>p.hidden=true); })()`);

let fail = 0;
const A = (name, ok, extra) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + extra : '')); if (!ok) fail++; };

const TOK = '@@m:' + 'b'.repeat(32);
const IMG = 'data:image/png;base64,iVBORw0KGgo=';
const inject = async () => {
  await ev(`(()=>{ const st=window.activeStore();
    st.set('cc-media-names', '{}');
    st.set('cc-groups', JSON.stringify({ text:[], sticker:[['贴纸组',[${JSON.stringify(TOK)}]]], image:[['图片组',[${JSON.stringify(IMG)}]]], poke:[], voice:[] }));
    if (window.ccReloadGroupsAfterExternalWrite) window.ccReloadGroupsAfterExternalWrite();
    return 1; })()`);
  await sleep(250);
};
const tab = async (type) => { await ev(`(()=>{ const t=document.querySelector('#cc-tabs .cc-tab[data-type="${type}"]'); if(t) t.click(); return 1; })()`); await sleep(250); };
const badge = () => ev(`JSON.stringify({
  caps:[...document.querySelectorAll('#cc-list .cc-name-cap')].map(e=>e.textContent),
  btns:[...document.querySelectorAll('#cc-list .cc-name-edit')].map(e=>e.textContent),
  items:document.querySelectorAll('#cc-list .cc-item').length
})`);
const inlineSearch = async (q) => {
  await ev(`(()=>{ const i=document.getElementById('cc-search-input');
    const box=document.querySelector('.ce-box[data-for="cc-search-input"]'); if(box) box.textContent=${JSON.stringify(q)};
    i.value=${JSON.stringify(q)}; i.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
  await sleep(400);
  return ev(`document.querySelectorAll('#cc-list .cc-item').length`);
};
const setModal = async (v) => ev(`(()=>{ const i=document.getElementById('modal-input');
  const box=document.querySelector('.ce-box[data-for="modal-input"]'); if(box) box.textContent=${JSON.stringify(v)};
  i.value=${JSON.stringify(v)}; i.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('modal-ok').click(); return 1; })()`);
const dismissModal = () => ev(`(()=>{ document.querySelectorAll('.modal-mask').forEach(function(m){ m.hidden=true; }); const m=document.getElementById('modal-mask'); if(m) m.hidden=true; return 1; })()`);

// 进「专属字卡」管理页，等启动期异步落定（避免与注入竞争）
await ev(`document.getElementById('li-custom-cards').click()`);
await sleep(3000);
await dismissModal();
await sleep(300);

// ==== A1~A4：表情包（令牌卡）名称编辑 + 标签即时显示 + 内联按名称搜索 ====
await inject(); await tab('sticker');
let b = JSON.parse(await badge());
A('A1 未命名贴纸：显示「＋」按钮且无名称标签', b.items >= 1 && b.caps.length === 0 && b.btns.indexOf('＋') >= 0, JSON.stringify(b));

await ev(`document.querySelector('#cc-list .cc-name-edit').click()`);
await sleep(250);
const mt = await ev(`(()=>{ const m=document.getElementById('modal-mask'); const t=document.getElementById('modal-title'); return JSON.stringify({ hidden:!m||m.hidden, title:t?t.textContent:'' }); })()`);
A('A2 点名称按钮弹出「编辑图片名称」', (() => { try { const o = JSON.parse(mt); return !o.hidden && o.title === '编辑图片名称'; } catch (e) { return false; } })(), mt);

await setModal('可爱猫猫');
await sleep(350);
const storedName = await ev(`(()=>{ try { const o=JSON.parse(window.activeStore().get('cc-media-names')||'{}'); return Object.keys(o).map(k=>o[k]).join(','); } catch(e){ return 'ERR'; } })()`);
b = JSON.parse(await badge());
A('A3a 名称写入 cc-media-names（键为内容身份）', storedName === '可爱猫猫', 'stored=' + storedName);
A('A3b 卡片标签即时显示名称（无重渲染闪烁）', b.caps.indexOf('可爱猫猫') >= 0 && b.btns.indexOf('改') >= 0, JSON.stringify(b));

A('A4a 内联搜名称命中该卡', (await inlineSearch('可爱猫猫')) >= 1);
A('A4b 内联搜不存在的词零卡', (await inlineSearch('zzz绝不存在')) === 0);
await inlineSearch('');

// ==== A5：图片（dataURL）未命名不参与内联搜索、仍可点「＋」命名 ====
await inject(); await tab('image');
A('A5a 未命名图片搜 data: 特征零命中', (await inlineSearch('base64')) === 0);
await inlineSearch('');
b = JSON.parse(await badge());
A('A5b 未命名图片列表项有「＋」无标签', b.items >= 1 && b.caps.length === 0 && b.btns.indexOf('＋') >= 0, JSON.stringify(b));

// ==== A6：清空名称后标签消失（在图片卡上做：dataURL 卡不会被标「图片丢失」）====
await inject(); await tab('image');
await ev(`document.querySelector('#cc-list .cc-name-edit').click()`);
await sleep(250);
await setModal('临时名');
await sleep(350);
b = JSON.parse(await badge());
A('A6a 图片命名后显示名称标签', b.caps.indexOf('临时名') >= 0 && b.btns.indexOf('改') >= 0, JSON.stringify(b));
await ev(`document.querySelector('#cc-list .cc-name-edit').click()`);
await sleep(250);
await setModal('');
await sleep(350);
const cleared = await ev(`(()=>{ try { return window.activeStore().get('cc-media-names')||'{}'; } catch(e){ return 'ERR'; } })()`);
b = JSON.parse(await badge());
A('A6b 清空名称后 cc-media-names 为空且标签消失', (cleared === '{}' || cleared === '') && b.caps.length === 0 && b.btns.indexOf('＋') >= 0, 'v=' + cleared + ' ' + JSON.stringify(b));

// ==== A7：公用作用域独立存储 + 顶部搜索认公用名称 ====
const TOK2 = '@@m:' + 'c'.repeat(32);
await ev(`(()=>{ const gs=window.xyStore('xy-home-v2');
  gs.set('cc-media-names-public', '{}');
  gs.set('cc-groups-public', JSON.stringify({ text:[], sticker:[['公用贴纸组',[${JSON.stringify(TOK2)}]]], image:[], poke:[], voice:[] }));
  return 1; })()`);
await ev(`(()=>{ const p=document.getElementById('li-custom-cards-public'); if(p) p.click(); return 1; })()`);
await sleep(900);
await dismissModal();
await tab('sticker');
await ev(`(()=>{ const n=document.querySelector('#cc-list .cc-name-edit'); if(n) n.click(); return 1; })()`);
await sleep(250);
await setModal('公用猫猫');
await sleep(350);
const pubNames = await ev(`(()=>{ try { const o=JSON.parse(window.xyStore('xy-home-v2').get('cc-media-names-public')||'{}'); return Object.keys(o).map(k=>o[k]).join(','); } catch(e){ return 'ERR'; } })()`);
const ownNames = await ev(`(()=>{ try { return window.activeStore().get('cc-media-names')||''; } catch(e){ return 'ERR'; } })()`);
A('A7a 公用命名写 cc-media-names-public 且专属键不受影响', pubNames === '公用猫猫' && (ownNames === '{}' || ownNames === ''), 'pub=' + pubNames + ' own=' + ownNames);

await ev(`(()=>{ const p=document.getElementById('page-chatcard'); document.querySelectorAll('.page').forEach(function(x){x.hidden=true;}); if(p) p.hidden=false; return 1; })()`);
await sleep(200);
await ev(`(()=>{ const i=document.getElementById('chatcard-search'); const box=document.querySelector('.ce-box[data-for="chatcard-search"]'); if(box) box.textContent='公用猫猫'; i.value='公用猫猫'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
await sleep(500);
const rows = await ev(`JSON.stringify([...document.querySelectorAll('#page-chatcard .cc-search-result .tc-qtext')].map(e=>e.textContent))`);
A('A7b 顶部搜索按公用名称命中且无令牌乱码', (() => { try { const r = JSON.parse(rows); return r.length > 0 && r.indexOf('公用猫猫') >= 0 && r.every(t => t.indexOf('@@m:') < 0); } catch (e) { return false; } })(), rows);

// A8 零 JS 错误
const e = await ev('window.__jsErrors ? window.__jsErrors.length : -1');
A('A8 零 JS 错误', e === 0, 'errs=' + e);

console.log(fail === 0 ? 'ALL PASS' : 'FAIL ' + fail);
process.exit(fail === 0 ? 0 : 1);
