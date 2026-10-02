// ===== 验证 #550：设置页顶部搜索「精准搜索」修复 =====
// 用户反馈「设置里顶部的导航栏输入框，不能精准搜索」。根因：
// ① settings-help.js 往每行 .txt 注入「功能说明」.tag 胶囊，旧搜索把胶囊文本一并匹配
//    → 搜「功能 / 说明」几乎全行命中（噪声）；② 只做整串子串匹配，口语词
//    （壁纸/通知/概率/夜间…）0 命中，多词 AND 也不支持；③ 零命中/命中稀疏时
//    空分组与全部分区仍显示，页面看似没反应。
// 修复（personalize.js bindSettingsSearch）：取词剔除 .tag + 同义词别名表 +
// 多词 AND + 空组/空分区隐藏 + 零命中空态提示（#549 的「功能大全」跳转行保持不变）。
// 内存拼装 src（与 build.mjs 同序、不写产物）→ 无头 Chrome 实测行为。
// 用法：node tools/verify-settings-search.mjs（需本机 Chrome/Edge）。
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

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const cdpPort = 9800 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vsss-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
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
// 开屏 / 问答门 / 新手引导 / 快捷掩码全部拿掉，直接打开设置页
await ev(`(()=>{ const s=document.getElementById('splash'); if(s) s.remove();
  const q=document.getElementById('qa-mask'); if(q) q.hidden=true;
  const g=document.querySelector('.mg-guide-mask'); if(g) g.remove();
  const m=document.getElementById('modal-mask'); if(m) m.hidden=true;
  document.querySelectorAll('.page').forEach(p=>p.hidden=true);
  const sp=document.getElementById('page-setting'); if(sp) sp.hidden=false; })()`);
await sleep(300);

let fail = 0;
const A = (name, ok, extra) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + extra : '')); if (!ok) fail++; };
const search = (q) => ev(`(()=>{ const i=document.getElementById('set-search-input'); i.value=${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); return 1; })()`);
const visRows = () => ev(`[...document.querySelectorAll('#page-setting .set-row')].filter(r=>r.style.display!=='none').map(r=>r.id||((r.querySelector('.txt')||{}).textContent||'').trim().slice(0,12))`);
const rowVisible = (sel) => ev(`(()=>{ const r=document.querySelector(${JSON.stringify(sel)}); return !!r && r.style.display!=='none'; })()`);
const errs = () => ev('window.__jsErrors ? window.__jsErrors.length : -1');

// S 静态断言：修复锚点在 src 里
const pjs = readFileSync(join(root, 'src', 'js', 'personalize.js'), 'utf8');
A('S1 取词剔除「功能说明」.tag 胶囊（querySelectorAll(\'.tag\').remove）', pjs.includes("c.querySelectorAll('.tag').forEach(x => x.remove());"));
A('S2 同义词别名表在位（深色模式→夜间等）', pjs.includes("'深色模式': '夜间"));
A('S3 零命中空态提示在位', pjs.includes('没有匹配的设置项'));

// B0 基线
const total = (await visRows()).length;
A('B0 设置页渲染行数 ≥25', total >= 25, 'total=' + total);

// B1 噪声修复：搜「功能说明」→ 0 命中（修复前 ≈28 行全中）
await search('功能说明');
let v = await visRows();
A('B1 搜「功能说明」零命中（胶囊文本不入匹配）', v.length === 0, 'hits=' + v.length);

// B2 搜「功能」→ 只剩真正含「功能」的行（功能大全/功能诊断/功能介绍等 ≤5 行），开启群聊等不再误中
await search('功能');
v = await visRows();
const grpChatGone = !(await rowVisible('#sf-group-chat-row'));
const fhub = await rowVisible('#row-featurehub');
// 上限 9：设置页里正文/DESC/标题真实含「功能」的行已有 9 个（功能大全/功能诊断/查看存储/字卡使用状态自检
// + 各功能数据管理 + 关于批的 功能介绍 与 3 条 FAQ 名含「功能」）；关键是「功能说明」胶囊不制造噪声（见 B1）且开启群聊不误中。
A('B2 搜「功能」无胶囊噪声（开启群聊行不误中、功能大全在列）', grpChatGone && fhub && v.length > 0 && v.length <= 9, 'hits=' + v.length + ' [' + v.join(',') + ']');

// B3 占位符示例词逐一可命中（修复前壁纸/通知/概率均 0 命中）
await search('壁纸'); v = await visRows();
A('B3a 搜「壁纸」命中「手机桌面美化」且仅 1 行', (await rowVisible('#row-appearance')) && v.length === 1, 'hits=' + v.length);
await search('通知'); v = await visRows();
A('B3b 搜「通知」命中「离线消息提醒」', v.some(x => String(x).indexOf('离线消息提醒') >= 0) || (await ev(`[...document.querySelectorAll('#page-setting .set-row')].some(r=>r.style.display!=='none'&&(r.querySelector('.txt')||{}).textContent.indexOf('离线消息提醒')>=0)`)), '[' + v.join(',') + ']');
await search('概率'); v = await visRows();
A('B3c 搜「概率」命中「回复设置」', await rowVisible('#row-general'), 'hits=' + v.length);
await search('备份'); v = await visRows();
A('B3d 搜「备份」命中「导出数据」', await rowVisible('#row-export'), 'hits=' + v.length);

// B4 复合口语词 + 多词 AND
await search('夜间模式');
A('B4a 搜「夜间模式」命中「深色模式」', await rowVisible('#row-theme-mode'));
await search('夜间 模式');
A('B4b 多词 AND「夜间 模式」命中「深色模式」', await rowVisible('#row-theme-mode'));
// #1470：设置里那行开关更名「夜间免打扰模式」——新名要能搜到本行，旧名「夜间模式」也不能把人留在原地（说明里登记的原名＋深色模式口语别名同时在列）
await search('夜间免打扰');
A('B4c 搜「夜间免打扰」命中「夜间免打扰模式」行（新名可搜）', await rowVisible('#sf-night-mode-row'));

// B5 大小写
await search('iOS');
A('B5 搜「iOS」大小写不敏感受命中（使用说明在列）', await rowVisible('#row-guide'));

// B10 拼音首字母（#573 轻量表）：搜「ssms」命中「深色模式」
await search('ssms'); v = await visRows();
A('B10 搜「ssms」命中「深色模式」', await rowVisible('#row-theme-mode'), 'hits=' + v.length);

// B11 说明文案数据驱动（#573 settings-help DESC 并入素材）：「总入口」只出现在美化行说明里
await search('总入口'); v = await visRows();
A('B11 搜「总入口」命中「手机桌面美化」（说明文案可搜）', await rowVisible('#row-appearance'), 'hits=' + v.length);

// B6 零命中空态：提示出现、行全隐、#549 跳转行仍在
await search('zzz绝不存在的词');
v = await visRows();
const tipShown = await ev(`(()=>{ const t=document.getElementById('set-search-empty-tip'); return !!t && !t.hidden; })()`);
const jumpShown = await ev(`(()=>{ const b=document.getElementById('set-search-input'); if(!b) return false; let n=b.nextSibling; while(n&&n.nodeType!==1)n=n.nextSibling; return !!n&&!n.hidden&&n.textContent.indexOf('功能大全')>=0; })()`);
A('B6 零命中→空态提示出现、行全隐、功能大全跳转在位', v.length === 0 && tipShown && jumpShown, 'hits=' + v.length + ' tip=' + tipShown + ' jump=' + jumpShown);

// B7 空组/空分区隐藏：搜「壁纸」（命中在通用区）→ 其他 4 个分区隐藏、通用区内无关分组隐藏
await search('壁纸');
const secHidden = await ev(`(()=>{ const p=document.getElementById('page-setting'); const out={}; p.querySelectorAll('.them-sec').forEach(s=>{ out[s.dataset.sec]=s.hidden; }); return JSON.stringify(out); })()`);
const grpHidden = await ev(`(()=>{ const r=document.getElementById('sf-group-chat-row'); const g=r?r.closest('.set-group'):null; return g?g.style.display==='none':'norow'; })()`);
A('B7 空分区/空分组隐藏（chat/system/tools/about 隐、群聊分组隐）', (() => { try { const o = JSON.parse(secHidden); return o.chat === true && o.system === true && o.tools === true && o.about === true && grpHidden === true; } catch (e) { return false; } })(), 'secs=' + secHidden + ' grp=' + grpHidden);

// B8 清空恢复：行数回基线、提示消失、互斥分区恢复（只有当前 tag 显示）、分组恢复
await search('');
await sleep(100);
v = await visRows();
const tipGone = await ev(`(()=>{ const t=document.getElementById('set-search-empty-tip'); return !!t && t.hidden; })()`);
const basicOnly = await ev(`(()=>{ const p=document.getElementById('page-setting'); const out={}; p.querySelectorAll('.them-sec').forEach(s=>{ out[s.dataset.sec]=s.hidden; }); return JSON.stringify(out); })()`);
const grpBack = await ev(`(()=>{ const r=document.getElementById('sf-group-chat-row'); const g=r?r.closest('.set-group'):null; return g?g.style.display!=='none':'norow'; })()`);
A('B8 清空恢复基线视图（行数/提示/分区互斥/分组）', v.length >= total && tipGone && (() => { try { const o = JSON.parse(basicOnly); return o.basic === false && o.chat === true; } catch (e) { return false; } })() && grpBack, 'rows=' + v.length + '/' + total + ' secs=' + basicOnly);

// B9 全程零 JS 错误
const e = await errs();
A('B9 零 JS 错误', e === 0, 'errs=' + e);

console.log(fail === 0 ? 'ALL PASS' : 'FAIL ' + fail);
process.exit(fail === 0 ? 0 : 1);
