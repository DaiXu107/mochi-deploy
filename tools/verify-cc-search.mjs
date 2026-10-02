// ===== 验证 #557：字卡库页顶部搜索「精准化」（#chatcard-search → renderSearchResult）=====
// 用户反馈「字卡库顶部的搜索栏也不准确，不能精准搜索，每次搜索一个字，多几个字的全部出现」。
// 根因：结果列表纯子串匹配且按模块注册顺序平铺——搜单字时所有「沾边」长卡全量涌出、
// 精确卡被淹没；多词整串当单词条，「晚安 爱」恒 0 命中。
// 修复（chatcard.js renderSearchResult）：多词空格 AND + 精确/开头/包含三级排序分节。
// 内存拼装 src（与 build.mjs 同序、不写产物）→ 无头 Chrome 实测行为。
// 用法：node tools/verify-cc-search.mjs（需本机 Chrome/Edge）。
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
const cdpPort = 9500 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vcc-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
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
  document.querySelectorAll('.page').forEach(p=>p.hidden=true); const sp=document.getElementById('page-chatcard'); if(sp) sp.hidden=false; })()`);
await sleep(400);

let fail = 0;
const A = (name, ok, extra) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + extra : '')); if (!ok) fail++; };
const search = async (q) => { await ev(`(()=>{ const i=document.getElementById('chatcard-search'); i.value=${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); return 1; })()`); await sleep(200); };
const snap = () => ev(`(()=>{
  const wrap=document.querySelector('#page-chatcard .cc-search-result'); if(!wrap||wrap.hidden) return null;
  return JSON.stringify({
    heads:[...wrap.querySelectorAll('.cal-card-title')].map(e=>e.textContent.trim()),
    rows:[...wrap.querySelectorAll('.tc-qtext')].map(e=>e.textContent),
    empty:(wrap.querySelector('.ta-empty')||{}).textContent||''
  });
})()`);

// S 静态断言
const cjs = readFileSync(join(root, 'src', 'js', 'chatcard.js'), 'utf8');
A('S1 排序分节锚点在位（mochiSearch.rank 三级，#573 换公共工具）', cjs.includes('r.__rank = ms ? ms.rank(r.t, kw) : 2;'));
A('S2 多词 AND 锚点在位（最长词为锚 + terms.every）', cjs.includes('const anchor = ms ? ms.anchor(terms) : terms[0];') && cjs.includes('terms.every(function (w) { return t.indexOf(w) >= 0; })'));

// B0 环境就绪
A('B0 跨分类搜索注册方 ≥10', (await ev('(window.__cardSearchFns||[]).length')) >= 10);

// B1 精确命中置顶：搜「晚安」，整卡等于「晚安」的卡必须排第一，且出现「精确命中」分节
await search('晚安');
let s = JSON.parse(await snap());
A('B1a 搜「晚安」精确卡置顶', s.rows[0] === '晚安', 'first=' + s.rows[0]);
A('B1b 出现「精确命中」分节头', s.heads.some(h => h.indexOf('精确命中') === 0), 'heads=' + s.heads.join('/'));

// B2 单字搜索排序单调：搜「爱」，分节按 精确→开头→包含 出现，行内序与分节一致，且全部含「爱」
await search('爱');
s = JSON.parse(await snap());
const rankOf = (t) => t === '爱' ? 0 : (t.indexOf('爱') === 0 ? 1 : 2);
let mono = true, last = -1;
s.rows.forEach(t => { const rk = rankOf(t); if (rk < last) mono = false; last = rk; });
A('B2a 搜「爱」全部行含「爱」且分节序单调', s.rows.every(t => t.includes('爱')) && mono, 'n=' + s.rows.length);
A('B2b 出现「包含命中」分节（开头命中按数据可选）', s.heads.some(h => h.indexOf('包含命中') === 0), 'heads=' + s.heads.join('/'));

// B3 多词 AND：搜「偏爱 你」→ 有命中且每行同时含两词，且纯「偏爱」卡被排除（修复前整串当单词条恒 0）
await search('偏爱 你');
s = JSON.parse(await snap());
A('B3 多词「偏爱 你」AND 命中且逐行含两词', s && s.rows.length > 0 && s.rows.every(t => t.includes('偏爱') && t.includes('你')), 'n=' + (s ? s.rows.length : 0) + ' [' + (s ? s.rows.join('|') : '') + ']');

// B3b 查询侧标点归一（#573）：搜「晚安。」等价「晚安」，精确卡仍置顶
await search('晚安。');
s = JSON.parse(await snap());
A('B3b 搜「晚安。」标点归一后精确卡置顶', s && s.rows.length > 0 && s.rows[0] === '晚安' && s.heads.some(h => h.indexOf('精确命中') === 0), 'first=' + (s && s.rows[0]));

// B4 零命中空态
await search('zzz绝不存在的词');
s = JSON.parse(await snap());
A('B4 零命中显示「没有找到」空态', s && s.rows.length === 0 && (s.heads.some(h => h.indexOf('没有找到') === 0) || (s.empty || '').indexOf('没有找到') === 0), 'empty=' + (s ? s.empty : 'null'));

// B5 清空恢复：结果列表隐藏、分区视图恢复（可自定义字卡节可见）
await search('');
const restored = await ev(`(()=>{ const w=document.querySelector('#page-chatcard .cc-search-result');
  const c=document.getElementById('cc-sect-custom'); const tab=document.querySelector('.cc-top-tabs .cc-tab.sel');
  return JSON.stringify({ wrapHidden: !w || w.hidden, customVis: c && !c.hidden, tab: tab ? tab.getAttribute('data-ccsect') : '' }); })()`);
A('B5 清空恢复分区视图', (() => { try { const o = JSON.parse(restored); return o.wrapHidden && o.customVis && o.tab === 'custom'; } catch (e) { return false; } })(), restored);

// ==== #680：图片/表情包令牌不再直出乱码；媒体卡只按「用户填写的名称」参与搜索 ====
// 背景：用户报搜索「@@m:5c58a523… 自定义聊天字卡 · 图片」乱码，并要求图片/表情包可编辑
// 名称、无名称时不参与搜索。这里注入一张令牌贴纸 + 一张 dataURL 图片 + 一张语音卡实测。
const TOK = '@@m:' + 'a'.repeat(32);
await ev(`(()=>{ const st=window.activeStore();
  st.set('cc-groups', JSON.stringify({ text:[['默认分组',['测试文字卡内容']]], sticker:[['贴纸组',[${JSON.stringify(TOK)}]]], image:[['图片组',['data:image/png;base64,iVBORw0KGgo=']]], poke:[], voice:[['语音组',['早安语音'+String.fromCharCode(124,124,124)+'data:audio/mpeg;base64,AAAA']]] }));
  st.set('cc-media-names', '{}');
  if (window.ccReloadGroupsAfterExternalWrite) window.ccReloadGroupsAfterExternalWrite();
  return 1; })()`);
await sleep(200);

// B7 令牌子串（'aaaa'）不再搜出图片卡、结果里没有 @@m: 乱码
await search('aaaa');
s = JSON.parse(await snap());
A('B7a 搜令牌子串零命中（未命名图片不被搜出）', s.rows.length === 0 && !s.heads.some(h => h.indexOf('找到') === 0), 'rows=' + s.rows.length);
await search(TOK.slice(0, 20));
s = JSON.parse(await snap());
A('B7b 搜令牌前缀不直出 @@m: 乱码', s.rows.every(t => t.indexOf('@@m:') < 0) && s.rows.length === 0, 'rows=' + JSON.stringify(s.rows));
await search('base64');
s = JSON.parse(await snap());
A('B7c 搜 dataURL 特征（base64）不搜出图片卡', s.rows.length === 0, 'rows=' + s.rows.length);

// B8 文字卡搜索不回归
await search('测试文字');
s = JSON.parse(await snap());
A('B8 文字卡仍可正常搜到', s.rows.some(t => t === '测试文字卡内容'), 'rows=' + JSON.stringify(s.rows));

// B9 给令牌贴纸命名后按名称可搜，且结果显示名称而非令牌
await ev(`(()=>{ const c=${JSON.stringify(TOK)};
  const k='i'+window.ccMediaCardIdent(c);
  window.activeStore().set('cc-media-names', JSON.stringify({[k]:'我的可爱贴纸'}));
  if (window.ccReloadGroupsAfterExternalWrite) window.ccReloadGroupsAfterExternalWrite();
  return k; })()`);
await sleep(200);
await search('可爱贴纸');
s = JSON.parse(await snap());
A('B9 命名后按名称可搜到且不显示令牌', s.rows.length > 0 && s.rows[0] === '我的可爱贴纸' && s.rows.every(t => t.indexOf('@@m:') < 0), 'rows=' + JSON.stringify(s.rows));

// B10 语音卡按「名称|||」前缀可搜（不直出音频数据）
await search('早安语音');
s = JSON.parse(await snap());
A('B10 语音按名称可搜、不显示音频 dataURL', s.rows.some(t => t === '早安语音') && s.rows.every(t => t.indexOf('data:audio') < 0), 'rows=' + JSON.stringify(s.rows));

// B11 清空恢复注入前状态（避免影响后续断言）
await search('');

// B6 零 JS 错误
const e = await ev('window.__jsErrors ? window.__jsErrors.length : -1');
A('B6 零 JS 错误', e === 0, 'errs=' + e);
console.log(fail === 0 ? 'ALL PASS' : 'FAIL ' + fail);
process.exit(fail === 0 ? 0 : 1);
