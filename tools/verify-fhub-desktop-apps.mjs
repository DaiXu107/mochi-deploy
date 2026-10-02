// ===== 验证「功能大全 · 桌面补全批」：桌面图标索引 + 各桌面应用页内入口 =====
// 背景（用户 2026-09-19 实报）：「功能大全里还缺少桌面的应用啊。根本没有补全这个项目的全部」。
// 改前 29 个桌面图标虽各自散在四个主题组里（搜得到），但没有任何一处完整对应「桌面上有哪些应用」；
// 各桌面应用的页内入口（市集心愿单/音乐设置/记账设置/房间家具仓…）也一条没有，点进去只能到应用首页。
// 本脚本对新增内容逐条做**真实用户路径**验证：在功能大全里按行名找到那一行 → 点它 →
// 断言落到了期望的页面（子页面/面板/弹窗同上），再复位进下一条。不写死总条数（并行批只增不减），
// 但**写死**这份清单本身——条目被删或被改坏都会红。
// 另含两条反向断言：①会直接改数据的动作入口不得混进目录（经期「标记今天开始」点一下当场记一笔、
// 提醒开关点一下当场翻转、音乐「清理会员歌曲」点一下当场删歌）；②心情日记必须落到日记页而不是日历首页。
// 用法：node tools/verify-fhub-desktop-apps.mjs（需本机 Chrome/Edge）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => readFileSync(join(root, 'src', p), 'utf8');

// —— 与 build.mjs 同序拼装（不压缩，仅拼接） ——
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
  const map = { '/manifest.json': 'pwa/manifest.json', '/notice.json': 'pwa/notice.json', '/sw.js': 'pwa/sw.js' };
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
const cdpPort = 9800 + Math.floor(Math.random() * 150);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-fhubapp-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} server.close(); });

let ws = null, msgId = 0; const pend = new Map();
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
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expr) { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : undefined; }

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Page.navigate', { url: baseUrl + '/' });
await sleep(2800);
await ev(`(()=>{ const s=document.getElementById('splash'); if(s) s.remove(); const q=document.getElementById('qa-mask'); if(q) q.hidden=true; })()`);

let fail = 0;
const A = (name, ok, extra) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + extra : '')); if (!ok) fail++; };

// —— 期望落点表：桌面图标 29 个（桌面第 1/2/3 页顺序） + 各应用页内入口 49 条 ——
const APPS = [
  ['聊天（桌面图标）', 'page-chat'], ['群聊（桌面图标）', 'page-group-chat'], ['主页（桌面图标）', 'page-home'],
  ['信箱（桌面图标）', 'page-mail'], ['朋友圈（桌面图标）', 'page-feed'], ['日历（桌面图标）', 'page-calendar'],
  ['纪念（桌面图标）', 'page-memory'], ['占卜（桌面图标）', 'page-divine'], ['收藏（桌面图标）', 'page-fav'],
  ['音乐（桌面图标）', 'page-music'], ['聊天统计（桌面图标）', 'page-stats'], ['提问记录（桌面图标）', 'page-interact'],
  ['寻踪（桌面图标）', 'page-checkin'], ['花园（桌面图标）', 'page-garden'], ['此间（桌面图标）', 'page-cjian'],
  ['同频（桌面图标）', 'page-tongpin'], ['伸手（桌面图标）', 'page-shenshou'],
  ['经期记录（桌面图标）', 'page-period'], ['记账（桌面图标）', 'page-accounting'], ['梦角档案（桌面图标）', 'page-memo-arc'],
  ['我的档案（桌面图标）', 'page-my-arc'], ['房间（桌面图标）', 'page-room'], ['喝水（桌面图标）', 'page-water'],
  ['吃什么（桌面图标）', 'page-eat'], ['存钱罐（桌面图标）', 'page-piggy'], ['番茄钟（桌面图标）', 'page-pomodoro'],
  ['心意市集（桌面图标）', 'page-market'], ['心意柜（桌面图标）', 'page-giftbox'], ['备忘录（桌面图标）', 'page-memo']
];
const SUBS = [
  // 互动与心意
  ['朋友圈 · 发动态', 'page-feed'], ['朋友圈 · 互动通知', 'page-feed'], ['朋友圈 · 好友动态列表', 'page-feed-friends'],
  ['信箱 · 写信', 'page-mail-write'],
  ['心意市集 · 心愿单', 'page-market'], ['心意市集 · 商品管理', 'page-market'],
  ['心意市集 · 上传商品', 'page-market'], ['心意市集 · 我的商品', 'page-market'],
  ['心意柜 · 看 TA 的心愿单', 'page-giftbox'], ['心意柜 · 设置', 'page-giftbox'],
  ['同频 · 换一个状态', 'page-tongpin'], ['同频 · 添加状态字卡', 'page-tongpin'],
  ['伸手 · 添加悄悄话字卡', 'page-shenshou'],
  ['此间 · 梦角管理', 'page-cjian'], ['此间 · 感知此间', 'page-cjian'],
  ['房间 · 家具仓', 'page-room'], ['房间 · 感应', 'page-room'], ['房间 · 装扮', 'page-room'],
  ['音乐 · 上传音乐', 'page-music'], ['音乐 · 链接添加', 'page-music'], ['音乐 · 批量导入', 'page-music'],
  ['音乐 · 批量管理', 'page-music'], ['音乐设置', 'page-music'],
  ['占卜 · 牌面与牌阵', 'page-divine'], ['收藏 · 管理', 'page-fav'],
  // 手机桌面与工具
  ['喝水 · 设每日目标', 'page-water'], ['喝水 · 单次容量', 'page-water'], ['喝水 · TA 的提醒字卡', 'page-water'],
  ['吃什么 · 转盘抽取', 'page-eat'], ['吃什么 · 编辑菜单', 'page-eat'], ['吃什么 · 添加菜名', 'page-eat'],
  ['吃什么 · 触发概率', 'page-eat'],
  ['存钱罐 · 存一笔', 'page-piggy'], ['存钱罐 · 取一笔', 'page-piggy'],
  ['存钱罐 · 新建小心愿', 'page-piggy'], ['存钱罐 · TA 的碎碎念', 'page-piggy'],
  ['番茄钟 · 设时长', 'page-pomodoro'], ['番茄钟 · 陪伴模式', 'page-pmp-chat'], ['番茄钟 · 夸夸字卡', 'page-pomodoro'],
  ['备忘录 · 提醒概率', 'page-memo'],
  // 记录与统计
  ['心情日记', 'page-mood'], ['日历 · 编辑我的留言', 'page-calendar'],
  ['纪念 · 添加纪念日', 'page-memory'], ['纪念 · 恋爱纪念日', 'page-memory'],
  ['经期记录 · 设置', 'page-period'], ['经期记录 · 提醒', 'page-period'],
  ['记账 · 设置', 'page-accounting'], ['梦角档案 · 管理', 'page-memo-arc'],
  ['寻踪 · 刷新 TA 的日常', 'page-checkin'], ['寻踪 · TA在身边 / 位置感知', 'page-checkin']
];
// 反向断言：这些「点了当场改数据」的动作入口不得被当成跳转目标收进目录
const BANNED = ['经期 · 标记今天开始', '经期 · 记录今天', '吃什么 · 问TA', '吃什么 · TA提醒',
  '备忘录 · 提醒开关', '备忘录 · 清已完成', '备忘录 · 发到聊天', '音乐 · 清理会员歌曲',
  '番茄钟 · 铃声', '同频 · 发到聊天', '伸手 · 发到聊天', '提问记录 · 清空', '花园 · 杂交', '花园 · 补种'];

// —— 复位：回到设置页（功能大全的入口来源），关掉弹窗/残留页 ——
const reset = () => ev(`(()=>{
  document.querySelectorAll('.page').forEach(p=>p.hidden=true);
  const s=document.getElementById('page-setting'); if(s) s.hidden=false;
  const m=document.getElementById('modal-mask'); if(m) m.hidden=true;
  const t=document.getElementById('cc-toast'); if(t) t.className='cc-toast';
})()`);

// 按行名精确匹配点一行（＝用户点搜索结果那一下），返回是否找到并点到
const clickRow = (nm) => ev(`(()=>{
  const rows=[...document.querySelectorAll('#fhub-body .set-row')];
  const r=rows.find(x=>{const t=x.querySelector('.txt'); return t&&t.firstChild&&t.firstChild.textContent.trim()===${JSON.stringify(nm)};});
  if(!r) return false;
  r.click(); return true;
})()`);

// #1452（阶段 A）：目录改「首开才建」——先点设置行入口把目录建出来，再量分组数/组内条目（契约不变：
// 开页后仍是 10 组、桌面应用组 = 29 图标 + 1 条找回说明；B4 会再点一次入口，幂等）。
await ev(`document.getElementById('row-featurehub').click()`);
await sleep(150);

// ---- B1 分组数=10（桌面补全批新增【桌面应用】组） ----
const gs = await ev(`document.querySelectorAll('#fhub-body .gs-title').length`);
A('B1 分组数=10（新增【桌面应用】组）', gs === 10, '实际 ' + gs);

// ---- B2 桌面应用组存在且条目数 = 29 图标 + 1 找回说明 ----
const dp = await ev(`(()=>{
  const t=[...document.querySelectorAll('#fhub-body .gs-title')].find(x=>x.textContent.trim()==='桌面应用');
  if(!t) return 'NO_TITLE';
  const card=t.nextElementSibling; if(!card) return 'NO_CARD';
  const rows=[...card.querySelectorAll('.set-row')];
  return rows.length+'|'+rows.map(r=>{const x=r.querySelector('.txt'); return x&&x.firstChild?x.firstChild.textContent.trim():'';}).join(',');
})()`);
const [dpN, dpNames] = String(dp).split('|');
A('B2 桌面应用组 = 29 图标 + 1 条「图标不见了怎么找回」', Number(dpN) === 30, '实际 ' + dpN);

// ---- B3 29 个图标一个不少（组内行名精确覆盖） ----
const missingIcon = APPS.filter(([n]) => (',' + dpNames + ',').indexOf(',' + n + ',') < 0).map(([n]) => n);
A('B3 29 个桌面图标全部在组内', missingIcon.length === 0, missingIcon.length ? '缺 ' + JSON.stringify(missingIcon) : '缺 0 个');

// ---- B4/B5 逐条走真实用户路径：找到行 → 点 → 落在期望页面 ----
await ev(`document.getElementById('row-featurehub').click()`);
await sleep(150);
const badApp = [];
for (const [nm, expect] of APPS) {
  await reset();
  const found = await clickRow(nm);
  await sleep(240);
  const pages = await ev(`[...document.querySelectorAll('.page')].filter(p=>!p.hidden).map(p=>p.id)`);
  if (!found || !pages || pages.indexOf(expect) < 0) badApp.push(nm + '→' + JSON.stringify(pages) + (found ? '' : '(行未找到)'));
}
A('B4 29 个桌面图标逐条点击落点正确', badApp.length === 0, badApp.length ? badApp.join('; ') : '29/29');

const badSub = [];
for (const [nm, expect] of SUBS) {
  await reset();
  const found = await clickRow(nm);
  await sleep(600); // #1471 跨页链尾步延后 350ms 落点，窗口随之放宽（原 240ms 会读到尾步落地前的旧页＝错拍假红）
  const pages = await ev(`[...document.querySelectorAll('.page')].filter(p=>!p.hidden).map(p=>p.id)`);
  if (!found || !pages || pages.indexOf(expect) < 0) badSub.push(nm + '→' + JSON.stringify(pages) + (found ? '' : '(行未找到)'));
}
A('B5 50 条应用页内入口逐条点击落点正确', badSub.length === 0, badSub.length ? badSub.join('; ') : SUBS.length + '/' + SUBS.length);

// ---- B6 反向：会直接改数据的动作入口不得混进目录 ----
const bannedHit = [];
for (const nm of BANNED) {
  const hit = await ev(`(()=>{
    const rows=[...document.querySelectorAll('#fhub-body .set-row')];
    return rows.some(x=>{const t=x.querySelector('.txt'); return t&&t.firstChild&&t.firstChild.textContent.trim()===${JSON.stringify(nm)};});
  })()`);
  if (hit) bannedHit.push(nm);
}
A('B6 改数据的动作入口未被收进目录（防误点）', bannedHit.length === 0, bannedHit.length ? JSON.stringify(bannedHit) : '0 条');

// ---- B7 搜索「桌面图标」能搜到桌面图标条目（装修挪过图标的人找得回） ----
await ev(`(()=>{const i=document.getElementById('row-featurehub'); if(i) i.click();})()`);
await sleep(120);
await ev(`(()=>{const i=document.getElementById('fhub-search'); i.value='桌面图标'; i.dispatchEvent(new Event('input'));})()`);
await sleep(120);
const sHit = await ev(`[...document.querySelectorAll('#fhub-body .set-row')].filter(r=>r.style.display!=='none' && r.textContent.indexOf('桌面图标')>=0).length`);
A('B7 搜「桌面图标」有命中', sHit >= 29, '命中 ' + sHit + ' 条');
await ev(`(()=>{const i=document.getElementById('fhub-search'); i.value=''; i.dispatchEvent(new Event('input'));})()`);

// ---- B8 心情日记落点＝日记页（改前只到日历首页，用户点了看不到日记） ----
await reset();
await ev(`document.getElementById('row-featurehub').click()`);
await sleep(120);
await clickRow('心情日记');
await sleep(600); // #1471 该行是跨页链（.app[calendar]→#cal-mood-entry），尾步 350ms 落点，窗口随之放宽（原 260ms）
A('B8 心情日记直达日记页 page-mood（修复前停在日历首页）', await ev(`!document.getElementById('page-mood').hidden`));

// ---- B9 「图标不见了」这条走位置提示（where 条目不静默） ----
await reset();
await ev(`document.getElementById('row-featurehub').click()`);
await sleep(120);
await clickRow('桌面图标不见了 / 怎么找回');
await sleep(120);
A('B9 「图标不见了」出位置提示 toast', await ev(`(()=>{const t=document.getElementById('cc-toast'); return !!t && t.className.includes('show') && t.textContent.includes('找回');})()`));

console.log(fail === 0 ? '== 桌面补全批全部通过 ==' : ('== 失败 ' + fail + ' 项 =='));
process.exit(fail === 0 ? 0 : 1);
