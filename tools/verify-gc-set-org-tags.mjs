// ===== 专项验证：群聊设置 UI 重设计——「成员」「群聊」升顶部 tag +「回复」tag 镜像全部群聊回复参数（#794） =====
// 需求（用户原话）：「群聊功能里的群聊设置的UI还可以重新设计，因为有的功能没有放在顶部的tag啊」
// 用例组：
//   A 源码锚：GTABS 七 tag、fillMembersList/fillGroupsList 同源双渲染（三点菜单面板与设置 tag
//             内嵌段共用一份 DOM 生成）、设置面板两嵌入段构建、回复段 14 个镜像 stepper +
//             4 个镜像开关（gc-py-en / gc-cs-*，走 window.replyCfg/saveReplyCfg）
//   B 运行时（无头 Chrome 走自组装 src 页；种子预置一个自定义群「测试群」覆盖自定义群分支）：
//     B1 面板打开 + 顶部七 tag；B2 默认落点仍是「形象」；
//     B3「成员」tag：成员列表（我+成员）、default 群无移除/添加、有跟随说明；
//     B4 三点菜单只剩「群聊设置」（#816：成员/切换群聊入口已摘）；
//     B5「群聊」tag：群列表 + 新建群聊行 + 当前标记 + 自定义群删除按钮；
//     B6 内嵌段点群即切群（「当前」随新群移动、设置面板不关）；
//     B7 自定义群下成员 tag 出现「移除」与「＋ 添加成员」；
//     B8「回复」tag：17 个 stepper（3 原有 + 14 镜像……实际 3+2+9+3=17）data-k 全集在位、4 开关在位；
//     B9 镜像 stepper 行为（点 + 写全局 reply-gc-*）；B10 镜像开关行为（gc-cs-trigger-bar 翻转落库）；
//     C 零 JS 异常
// 用法：node tools/verify-gc-set-org-tags.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
let cssFiles = [], jsFiles = [];
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  cssFiles = (bm.match(/const cssFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  jsFiles = (bm.match(/const jsFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}
const gsSrc = readFileSync(join(root, 'src/js/group-chat.js'), 'utf8');

let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => {
  const src = readFileSync(join(root, 'src/js', f), 'utf8');
  return '(function () { try {\n' + src + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
}).join('\n'));
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-gc-set-org-tags').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-gcorg-' + Date.now());
const profDir = join(process.env.TEMP || '/tmp', 'mochi-gcorg-prof-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/__seed') { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end('<!doctype html><title>seed</title>'); return; }
    let p = normalize(join(tmpRoot, rel));
    if (!p.startsWith(tmpRoot)) { res.writeHead(403); res.end(); return; }
    let hit = false;
    try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) { p = normalize(join(root, rel)); if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; } try { hit = statSync(p).isFile(); } catch (e) {} }
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profDir, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  + ' + name); }
  else { fail++; console.log('  x ' + name + (extra !== undefined ? ' -- ' + JSON.stringify(extra) : '')); }
}

console.log('== A 源码锚（src/js/group-chat.js） ==');
ok('A1 GTABS 七 tag（含成员/群聊）', gsSrc.indexOf("[['profile', '形象'], ['members', '成员'], ['group', '群聊'], ['reply', '回复'], ['beauty', '美化'], ['general', '通用'], ['data', '数据']]") >= 0);
ok('A2 fillMembersList/fillGroupsList 同源拆分', gsSrc.indexOf('function fillMembersList(el)') >= 0 && gsSrc.indexOf('function fillGroupsList(el)') >= 0);
ok('A3 两面板渲染同步设置 tag 内嵌段', gsSrc.indexOf("document.querySelector('#gc-set-body .gc-set-members-list')") >= 0
  && gsSrc.indexOf("document.querySelector('#gc-set-body .gc-set-groups-list')") >= 0);
ok('A4 三点菜单面板不回退（membersBody/gpBody 仍由 fill* 填充）', gsSrc.indexOf('fillMembersList(membersBody)') >= 0 && gsSrc.indexOf('fillGroupsList(gpBody)') >= 0);
ok('A5 设置面板构建成员/群聊两嵌入段', gsSrc.indexOf("memList.className = 'gc-set-members-list'") >= 0 && gsSrc.indexOf("gpList.className = 'gc-set-groups-list'") >= 0);
const MIRROR_ROWS = [
  ['回复条数最少', 'gc-reply-min', 1, 10, 1],
  ['回复条数最多', 'gc-reply-max', 1, 20, 1],
  ['拍一拍概率', 'gc-touch-prob', 0, 100, 5],
  ['表情包概率', 'gc-sticker-prob', 0, 100, 5],
  ['emoji 概率', 'gc-emoji-prob', 0, 100, 5],
  ['图片概率', 'gc-image-prob', 0, 100, 5],
  ['语音概率', 'gc-voice-prob', 0, 100, 5],
  ['颜文字附加概率', 'gc-kaomoji-prob', 0, 100, 5],
  ['引用概率', 'gc-quote-prob', 0, 100, 5],
  ['撤回概率', 'gc-rc-prob', 0, 100, 5],
  ['撤回补发概率', 'gc-rc-refix', 0, 100, 5],
  ['触发概率', 'gc-py-prob', 0, 100, 5],
  ['最少条数', 'gc-py-min', 1, 10, 1],
  ['最多条数', 'gc-py-max', 2, 10, 1]
];
const MIRROR_KEYS = MIRROR_ROWS.map((r) => r[1]);
ok('A6 回复段 14 个镜像 stepper 全在位（标签+键+边界与全站模板同口径）',
  MIRROR_ROWS.every((r) => gsSrc.indexOf("rStep('" + r[0] + "', '" + r[1] + "', " + r[2] + ', ' + r[3] + ', ' + r[4] + ')') >= 0));
ok('A7 镜像开关四个（gc-py-en + gc-cs-*）走 saveReplyCfg 全局路由', gsSrc.indexOf('const gcReplyToggleRow = (label, sub, key) => {') >= 0
  && gsSrc.indexOf("只用一张字卡', 'gc-py-en')") >= 0
  && gsSrc.indexOf("立即回复', 'gc-cs-normal')") >= 0
  && gsSrc.indexOf("'', 'gc-cs-trigger-name')") >= 0
  && gsSrc.indexOf("'', 'gc-cs-trigger-bar')") >= 0
  && gsSrc.indexOf('window.saveReplyCfg(key, cb.checked ? 1 : 0)') >= 0);

await cdpConnect();
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
const SEED = `(function () {
  localStorage.clear();
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{ id: 'default', name: '宝贝' }, { id: 'cta', name: '小桃' }]));
  localStorage.setItem('xy-home-v2:active-contact', 'cta');
  localStorage.setItem('xy-home-v2:gc-groups', JSON.stringify([{ id: 'gtest1', name: '测试群', members: ['cta'], ts: Date.now() }]));
  return true;
})()`;
await cdp('Page.navigate', { url: 'about:blank' });
await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'all' });
await cdp('Page.navigate', { url: baseUrl + '/__seed' });
await sleep(600);
await evalJs(SEED);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }

await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-group-chat');});return 1;})()");
await evalJs("(function(){var el=document.getElementById('gc-more-settings');if(el){el.click();return 1;}return 0;})()");
await sleep(600);

const tabClick = (gt) => "(function(){var t=document.querySelector('#gc-set-body .gc-set-tabs .them-tab[data-gt=\"" + gt + "\"]');if(!t)return 0;t.click();return 1;})()";

console.log('== B 运行时（种子：2 联系人 + 自定义群「测试群」） ==');
const b1 = await evalJs("(function(){var b=document.getElementById('gc-set-body');if(!b)return null;return {open:!document.getElementById('gc-settings-panel').hidden,tabs:Array.from(b.querySelectorAll('.gc-set-tabs .them-tab')).map(function(t){return t.textContent;}),vis:Array.from(b.querySelectorAll('.gc-set-sec')).filter(function(s){return !s.hidden;}).map(function(s){return s.dataset.gt;})};})()");
ok('B1 面板打开 + 顶部七 tag（形象/成员/群聊/回复/美化/通用/数据）',
  !!(b1 && b1.open && b1.tabs.join('/') === '形象/成员/群聊/回复/美化/通用/数据'), b1 && b1.tabs);
ok('B2 默认落点仍是「形象」段', !!(b1 && b1.vis.join() === 'profile'), b1 && b1.vis);

// B3 成员 tag（当前 default 群）
ok('B3a 点「成员」tag 切换成功', await evalJs(tabClick('members')) === 1);
await sleep(250);
const b3 = await evalJs("(function(){var s=document.querySelector('#gc-set-body .gc-set-sec[data-gt=\"members\"]');if(!s||s.hidden)return null;var rows=s.querySelectorAll('.gc-set-members-list .gc-mp-item');return {rows:rows.length,rm:s.querySelectorAll('.gc-mp-rm').length,add:!!s.querySelector('.gc-mp-add'),note:(s.textContent||'').indexOf('默认群聊的成员跟随全部联系人')>=0,me:!!Array.from(rows).find(function(r){return r.querySelector('.gc-mp-tag');})};})()");
ok('B3b 成员列表 = 我 + 2 联系人，含「我」标', !!(b3 && b3.rows === 3 && b3.me), b3);
ok('B3c default 群：无移除/无添加 + 有跟随说明', !!(b3 && b3.rm === 0 && !b3.add && b3.note), b3);

// B4 三点菜单只剩「群聊设置」一项（#816：「群成员」「切换群聊」与 tag 完全重复，入口已摘）
const b4 = await evalJs("(function(){var m=document.getElementById('gc-more-menu');return {settings:!!document.getElementById('gc-more-settings'),membersGone:!document.getElementById('gc-more-members'),groupsGone:!document.getElementById('gc-more-groups')};})()");
ok('B4 三点菜单只剩群聊设置（成员/切换群聊入口已摘除）', !!(b4 && b4.settings && b4.membersGone && b4.groupsGone), b4);

// B5 群聊 tag：群列表
ok('B5a 点「群聊」tag 切换成功', await evalJs(tabClick('group')) === 1);
await sleep(250);
const b5 = await evalJs("(function(){var s=document.querySelector('#gc-set-body .gc-set-sec[data-gt=\"group\"]');if(!s||s.hidden)return null;var items=s.querySelectorAll('.gc-set-groups-list .gc-gp-item');var cur=s.querySelector('.gc-set-groups-list .gc-gp-item.cur');return {groups:items.length,hasNew:!!s.querySelector('.gc-gp-new'),delBtns:s.querySelectorAll('.gc-gp-del').length,curIsTest:!!(cur&&(cur.textContent||'').indexOf('测试群')>=0),curTagged:!!cur};})()");
ok('B5b 群列表 = 默认 + 测试群，含「新建群聊」与自定义群删除按钮', !!(b5 && b5.groups === 2 && b5.hasNew && b5.delBtns === 1), b5);
ok('B5c 「当前」标记在默认群（不在测试群）', !!(b5 && b5.curTagged && !b5.curIsTest), b5);

// B6 内嵌段点「测试群」→ 切群，设置面板不关
await evalJs("(function(){var rows=document.querySelectorAll('#gc-set-body .gc-set-groups-list .gc-gp-item');var t=Array.from(rows).find(function(r){return (r.textContent||'').indexOf('测试群')>=0;});if(!t)return 0;t.click();return 1;})()");
await sleep(600);
const b6 = await evalJs("(function(){var p=document.getElementById('gc-settings-panel');var cur=document.querySelector('#gc-set-body .gc-set-groups-list .gc-gp-item.cur');var vis=Array.from(document.querySelectorAll('#gc-set-body .gc-set-sec')).filter(function(s){return !s.hidden;}).map(function(s){return s.dataset.gt;});return {open:p?!p.hidden:false,curIsTest:!!(cur&&(cur.textContent||'').indexOf('测试群')>=0),vis:vis};})()");
ok('B6 内嵌切群成功：「当前」移到测试群、面板仍开、tag 不弹回', !!(b6 && b6.open && b6.curIsTest && b6.vis.join() === 'group'), b6);

// B7 自定义群下成员 tag：移除 + 添加成员
ok('B7a 切到成员 tag', await evalJs(tabClick('members')) === 1);
await sleep(250);
const b7 = await evalJs("(function(){var s=document.querySelector('#gc-set-body .gc-set-sec[data-gt=\"members\"]');if(!s||s.hidden)return null;return {rows:s.querySelectorAll('.gc-set-members-list .gc-mp-item').length,rm:s.querySelectorAll('.gc-mp-rm').length,add:!!s.querySelector('.gc-mp-add')};})()");
ok('B7b 自定义群：成员=我+1，出现「移除」与「＋ 添加成员」', !!(b7 && b7.rows === 2 && b7.rm === 1 && b7.add), b7);

// 切回默认群，再验证回复 tag（避免后续断言受自定义群影响）
await evalJs(tabClick('group'));
await sleep(200);
await evalJs("(function(){var rows=document.querySelectorAll('#gc-set-body .gc-set-groups-list .gc-gp-item');var d=Array.from(rows).find(function(r){return (r.textContent||'').indexOf('全部联系人')>=0||!r.querySelector('.gc-gp-del');});if(!d)return 0;d.click();return 1;})()");
await sleep(600);

// B8 回复 tag 结构
ok('B8a 点「回复」tag 切换成功', await evalJs(tabClick('reply')) === 1);
await sleep(250);
const REPLY_KEYS = ['gc-prob', 'gc-rs-min', 'gc-rs-max'].concat(MIRROR_KEYS);
const b8 = await evalJs("(function(){var s=document.querySelector('#gc-set-body .gc-set-sec[data-gt=\"reply\"]');if(!s||s.hidden)return null;var ks=Array.from(s.querySelectorAll('.gc-set-stepper .stepper')).map(function(x){return x.getAttribute('data-k');});var tg=Array.from(s.querySelectorAll('.gc-set-toggle input')).length;return {steppers:ks.length,keys:ks,toggles:tg,titles:['回复条数','内容概率','多字卡回复','让对方继续说'].every(function(t){return (s.textContent||'').indexOf(t)>=0;})};})()");
ok('B8b 回复段 17 个 stepper，data-k 全集在位', !!(b8 && b8.steppers === 17 && REPLY_KEYS.every((k) => b8.keys.indexOf(k) >= 0)), b8 && { n: b8.steppers, keys: b8.keys });
ok('B8c 四个镜像开关 + 四个分组标题在位', !!(b8 && b8.toggles === 4 && b8.titles), b8 && { tg: b8.toggles, titles: b8.titles });

// B9 镜像 stepper 行为：gc-reply-max 默认 2，点 + → 3（写全局 reply-gc-gc-reply-max）
await evalJs("(function(){var el=document.querySelector('#gc-set-body .stepper[data-k=\"gc-reply-max\"] .stp-max');if(el){el.click();return 1;}return 0;})()");
await sleep(300);
let g = await evalJs("(function(){return JSON.stringify(window.groupChatCfg()['gc-reply-max']);})()");
ok('B9 镜像 stepper 点 + 生效（回复条数最多 2→3，写全局）', g === '3', g);

// B10 镜像开关行为：gc-cs-trigger-bar 默认 0 → 点开关 → 1 落库 → 再点回 0
const tgl = "(function(){var s=document.querySelector('#gc-set-body .gc-set-sec[data-gt=\"reply\"]');var rows=Array.from(s.querySelectorAll('.gc-set-toggle'));var r=rows.find(function(x){return (x.textContent||'').indexOf('底部聊天栏按钮触发')>=0;});if(!r)return 0;r.querySelector('input').click();return 1;})()";
ok('B10a 找到底部聊天栏按钮触发开关并点击', await evalJs(tgl) === 1);
await sleep(300);
g = await evalJs("(function(){return JSON.stringify(window.groupChatCfg()['gc-cs-trigger-bar']);})()");
ok('B10b 开关打开 → gc-cs-trigger-bar=1（saveReplyCfg 全局路由）', g === '1', g);
ok('B10c 再点回关 → 归 0', await evalJs(tgl) === 1);
await sleep(300);
g = await evalJs("(function(){return JSON.stringify(window.groupChatCfg()['gc-cs-trigger-bar']);})()");
ok('B10d 关闭后归 0', g === '0', g);

// C 零 JS 异常
const errs = await evalJs('JSON.stringify(window.__jsErrors || [])');
ok('C 零 JS 异常', errs === '[]', errs);

console.log('');
console.log('通过 ' + pass + ' / 断言失败 ' + fail);
try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(fail ? 1 : 0);
