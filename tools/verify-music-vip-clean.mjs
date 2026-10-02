// ===== 回归：音乐「已删歌曲复活」+「清理会员歌曲」 =====
// 用法：node tools/verify-music-vip-clean.mjs（内存拼装页面，不执行 build.mjs、不改 index.html）
// 修复点：
//  ① mergeDesksMusic 改一次性迁移（music-merge-done 标记 + 清源桌面 music-* 键）——
//     共享库删除的歌曲不再被旧桌面备份复活
//  ② 音乐页新增「清理会员歌曲」按钮——批量查网易云 fee，确认后移除会员/付费歌曲
// 实现：每个用例用真实页面 reload 模拟冷启动（同 profile localStorage 保留），
//       杜绝模块闭包/监听器跨用例累积。
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

const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'period.js', 'accounting.js', 'garden.js', 'room.js', 'decision.js', 'pong.js', 'snake-game.js', 'breakout.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'mobile-adapt.js'];
const readSrc = (p) => readFileSync(join(root, 'src', p), 'utf8');
function wrapFile(f, code) {
  return '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] " + f, __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
}

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9300 + Math.floor(Math.random() * 500));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-mvip-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
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
function cdp(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pend.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('页面 JS 异常: ' + JSON.stringify({
    text: r.exceptionDetails.text,
    line: r.exceptionDetails.lineNumber,
    col: r.exceptionDetails.columnNumber,
    exc: r.exceptionDetails.exception && r.exceptionDetails.exception.description
  }));
  return r.result && r.result.value;
}
const server = createServer((req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
    let p = normalize(join(root, u));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': extname(p) === '.css' ? 'text/css' : 'text/javascript' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

// ---- 内存拼装页面（与 build.mjs 同构，但不写任何产物文件） ----
const cssCode = cssFiles.map((f) => '<style>' + readSrc('css/' + f) + '</style>').join('\n');
const jsCode = jsFiles.map((f) => wrapFile(f, readSrc('js/' + f))).join('\n');
const staticHtml = readFileSync(join(root, 'src/template.html'), 'utf8')
  .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<link[^>]*rel="stylesheet"[^>]*>/gi, '');
const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + cssCode + '</head><body>' + staticHtml +
  '<div id="cc-toast" class="cc-toast"></div>' +
  '<script>' + jsCode + '</script>' +
  '</body></html>';

// ---- 测试数据 ----
const mkLib = () => [
  { id: 's1', neteaseId: '111111', name: '免费歌A', artist: 'A', url: 'https://api.injahow.cn/meting/?type=url&id=111111', source: 'url', duration: 200, playlistId: 'default', addedAt: 1 },
  { id: 's2', neteaseId: '222222', name: 'VIP歌B', artist: 'B', url: 'https://api.injahow.cn/meting/?type=url&id=222222', source: 'url', duration: 210, playlistId: 'default', addedAt: 1 },
  { id: 's3', neteaseId: '333333', name: '免费歌C', artist: 'C', url: 'https://api.injahow.cn/meting/?type=url&id=333333', source: 'url', duration: 180, playlistId: 'default', addedAt: 1 }
];
const mergeProbe = `
  const cid = 'cuser1';
  const s = window.storeFor(cid);
  s.set('music-library', JSON.stringify([
    { id: 's_l', name: '旧桌面本地歌', artist: '', url: '', source: 'local', duration: 120, playlistId: 'spl_x', addedAt: 1 }
  ]));
  s.set('music-playlists', JSON.stringify([{ id: 'spl_x', name: '旧桌面歌单', createdAt: 1 }]));
  s.set('music-history', JSON.stringify([{ id: 'smh_x', trackId: 's_l', trackName: '旧桌面本地歌', triggerType: '接受', ts: 1 }]));
  s.set('music-my-history', JSON.stringify([{ id: 'smymh_x', trackId: 's_l', trackName: '旧桌面本地歌', ts: 1 }]));
  window.xyStore('xy-home-v2').set('contacts', JSON.stringify([{ id: 'default', name: '默认' }, { id: cid, name: '小A' }]));
`;
const resetKeys = `
  const D = window.xyStore('xy-home-v2:default');
  D.remove('music-library'); D.remove('music-playlists'); D.remove('music-history'); D.remove('music-my-history'); D.remove('music-merge-done');
  const cid = 'cuser1';
  const s = window.storeFor(cid);
  s.remove('music-library'); s.remove('music-playlists'); s.remove('music-history'); s.remove('music-my-history');
  try { localStorage.removeItem('__testFeeMap'); } catch (e) {}
`;

// 用例结构：stage1 写存储 → (可选 stage2 再写 + 二次 reload) → check 在页面内断言
const cases = [
  { id: 'T1', name: '首次合并：并入共享库 + 清源桌面键 + 置标记', feeMap: {}, stage1: mergeProbe, check: `
    const cid = 'cuser1';
    const s = window.storeFor(cid);
    if (s.get('music-library')) return { ok: false, msg: '源桌面 music-library 未被清除' };
    if (s.get('music-playlists')) return { ok: false, msg: '源桌面 music-playlists 未被清除' };
    if (s.get('music-history')) return { ok: false, msg: '源桌面 music-history 未被清除' };
    if (s.get('music-my-history')) return { ok: false, msg: '源桌面 music-my-history 未被清除' };
    const st = window.xyStore('xy-home-v2:default');
    const lib = JSON.parse(st.get('music-library') || '[]');
    if (!lib.some(m => m.id === 's_l')) return { ok: false, msg: '合并歌曲 s_l 未进共享库' };
    const pl = JSON.parse(st.get('music-playlists') || '[]');
    if (!pl.some(p => p.id === 'spl_x')) return { ok: false, msg: '合并歌单 spl_x 未进共享库' };
    const his = JSON.parse(st.get('music-history') || '[]');
    const myh = JSON.parse(st.get('music-my-history') || '[]');
    if (!his.some(h => h.id === 'smh_x')) return { ok: false, msg: '合并历史 smh_x 未进共享库' };
    if (!myh.some(h => h.id === 'smymh_x')) return { ok: false, msg: '合并我的历史 smymh_x 未进共享库' };
    if (st.get('music-merge-done') !== '1') return { ok: false, msg: 'music-merge-done 未置位' };
    return { ok: true };
  ` },
  { id: 'T2', name: '共享库删除歌曲后重启不复活', feeMap: {}, stage1: mergeProbe, stage2: `
    const st = window.xyStore('xy-home-v2:default');
    const lib1 = JSON.parse(st.get('music-library') || '[]');
    st.set('music-library', JSON.stringify(lib1.filter(m => m.id !== 's_l')));
  `, check: `
    const st = window.xyStore('xy-home-v2:default');
    const lib2 = JSON.parse(st.get('music-library') || '[]');
    if (lib2.some(m => m.id === 's_l')) return { ok: false, msg: '已删除歌曲 s_l 复活了' };
    return { ok: true };
  ` },
  { id: 'T3', name: '旧备份恢复源桌面键后重启，删除的歌仍不复活', feeMap: {}, stage1: mergeProbe, stage2: `
    const st = window.xyStore('xy-home-v2:default');
    const lib1 = JSON.parse(st.get('music-library') || '[]');
    st.set('music-library', JSON.stringify(lib1.filter(m => m.id !== 's_l')));
    const cid = 'cuser1';
    const s = window.storeFor(cid);
    s.set('music-library', JSON.stringify([
      { id: 's_l', name: '旧桌面本地歌', artist: '', url: '', source: 'local', duration: 120, playlistId: 'spl_x', addedAt: 1 }
    ]));
    s.set('music-playlists', JSON.stringify([{ id: 'spl_x', name: '旧桌面歌单', createdAt: 1 }]));
  `, check: `
    const st = window.xyStore('xy-home-v2:default');
    const lib2 = JSON.parse(st.get('music-library') || '[]');
    if (lib2.some(m => m.id === 's_l')) return { ok: false, msg: '已删除歌曲 s_l 复活了' };
    return { ok: true };
  ` },
  { id: 'T4', name: '会员歌清理：列出并移除，免费歌保留', feeMap: { '111111': 0, '222222': 1, '333333': 0 }, stage1: `
    window.xyStore('xy-home-v2:default').set('music-library', JSON.stringify(${JSON.stringify(mkLib())}));
  `, check: `
    const st = window.xyStore('xy-home-v2:default');
    window.__activeCid = 'default';
    const btn = document.getElementById('music-vip-clean');
    if (!btn) return { ok: false, msg: '未找到 music-vip-clean 按钮' };
    btn.click();
    for (let i = 0; i < 80; i++) { if (document.getElementById('sm-vip-ok')) break; await new Promise(r => setTimeout(r, 30)); }
    const mask = document.getElementById('tc-mask');
    if (!mask || mask.hidden) return { ok: false, msg: '未弹出清理面板' };
    const panel = document.getElementById('tc-body');
    const txt = panel ? (panel.textContent || '') : '';
    if (txt.indexOf('VIP歌B') < 0) return { ok: false, msg: '面板未列出会员歌 VIP歌B: ' + txt.slice(0, 120) };
    if (txt.indexOf('免费歌A') >= 0 || txt.indexOf('免费歌C') >= 0) return { ok: false, msg: '面板误列免费歌' };
    document.getElementById('sm-vip-ok').click();
    const lib = JSON.parse(st.get('music-library') || '[]');
    if (lib.some(m => m.id === 's2')) return { ok: false, msg: '会员歌 s2 未被移除' };
    if (!lib.some(m => m.id === 's1') || !lib.some(m => m.id === 's3')) return { ok: false, msg: '免费歌被误删' };
    return { ok: true };
  ` },
  { id: 'T5', name: '全部免费歌：提示未发现、不弹面板、不误删', feeMap: { '111111': 0 }, stage1: `
    window.xyStore('xy-home-v2:default').set('music-library', JSON.stringify([
      { id: 'f1', neteaseId: '111111', name: '免费歌A', artist: 'A', url: 'https://api.injahow.cn/meting/?type=url&id=111111', source: 'url', duration: 200, playlistId: 'default', addedAt: 1 }
    ]));
  `, check: `
    const st = window.xyStore('xy-home-v2:default');
    window.__activeCid = 'default';
    document.getElementById('music-vip-clean').click();
    await new Promise(r => setTimeout(r, 250));
    const mask = document.getElementById('tc-mask');
    if (mask && !mask.hidden) return { ok: false, msg: '免费歌列表不应弹出清理面板' };
    const lib = JSON.parse(st.get('music-library') || '[]');
    if (!lib.some(m => m.id === 'f1')) return { ok: false, msg: '免费歌被误删' };
    return { ok: true };
  ` },
  { id: 'T6', name: '无网易云链接歌曲：提示、不弹面板', feeMap: {}, stage1: `
    window.xyStore('xy-home-v2:default').set('music-library', JSON.stringify([
      { id: 'loc1', name: '本地歌', artist: '', url: '', source: 'local', duration: 100, playlistId: 'default', addedAt: 1 }
    ]));
  `, check: `
    window.__activeCid = 'default';
    document.getElementById('music-vip-clean').click();
    await new Promise(r => setTimeout(r, 150));
    const mask = document.getElementById('tc-mask');
    if (mask && !mask.hidden) return { ok: false, msg: '无网易云歌曲不应弹出清理面板' };
    return { ok: true };
  ` },
  { id: 'T7', name: '#254 探测全部失败：提示检测失败、不弹面板、不误删', feeMap: { '111111': 'fail', '222222': 'fail' }, stage1: `
    window.xyStore('xy-home-v2:default').set('music-library', JSON.stringify([
      { id: 'f1', neteaseId: '111111', name: '免费歌A', artist: 'A', url: 'https://api.injahow.cn/meting/?type=url&id=111111', source: 'url', duration: 200, playlistId: 'default', addedAt: 1 },
      { id: 'f2', neteaseId: '222222', name: '探不到歌B', artist: 'B', url: 'https://api.injahow.cn/meting/?type=url&id=222222', source: 'url', duration: 210, playlistId: 'default', addedAt: 1 }
    ]));
  `, check: `
    const st = window.xyStore('xy-home-v2:default');
    window.__activeCid = 'default';
    document.getElementById('music-vip-clean').click();
    await new Promise(r => setTimeout(r, 400));
    const mask = document.getElementById('tc-mask');
    if (mask && !mask.hidden) return { ok: false, msg: '探测全失败不应弹出清理面板' };
    const lib = JSON.parse(st.get('music-library') || '[]');
    if (!lib.some(m => m.id === 'f1') || !lib.some(m => m.id === 'f2')) return { ok: false, msg: '探测失败歌曲被误删' };
    return { ok: true };
  ` },
  { id: 'T8', name: '#254 部分探测不到：只移除判死歌曲，探不到的保留', feeMap: { '111111': 1, '222222': 'fail', '333333': 0 }, stage1: `
    window.xyStore('xy-home-v2:default').set('music-library', JSON.stringify([
      { id: 'f1', neteaseId: '111111', name: 'VIP歌A', artist: 'A', url: 'https://api.injahow.cn/meting/?type=url&id=111111', source: 'url', duration: 200, playlistId: 'default', addedAt: 1 },
      { id: 'f2', neteaseId: '222222', name: '探不到歌B', artist: 'B', url: 'https://api.injahow.cn/meting/?type=url&id=222222', source: 'url', duration: 210, playlistId: 'default', addedAt: 1 },
      { id: 'f3', neteaseId: '333333', name: '免费歌C', artist: 'C', url: 'https://api.injahow.cn/meting/?type=url&id=333333', source: 'url', duration: 180, playlistId: 'default', addedAt: 1 }
    ]));
  `, check: `
    const st = window.xyStore('xy-home-v2:default');
    window.__activeCid = 'default';
    document.getElementById('music-vip-clean').click();
    for (let i = 0; i < 80; i++) { if (document.getElementById('sm-vip-ok')) break; await new Promise(r => setTimeout(r, 30)); }
    const mask = document.getElementById('tc-mask');
    if (!mask || mask.hidden) return { ok: false, msg: '应弹出清理面板' };
    const txt = document.getElementById('tc-body').textContent || '';
    if (txt.indexOf('VIP歌A') < 0) return { ok: false, msg: '面板未列出判死的 VIP歌A' };
    if (txt.indexOf('探不到歌B') >= 0) return { ok: false, msg: '面板误列探测不到的歌B' };
    document.getElementById('sm-vip-ok').click();
    const lib = JSON.parse(st.get('music-library') || '[]');
    if (lib.some(m => m.id === 'f1')) return { ok: false, msg: '判死歌曲 f1 未被移除' };
    if (!lib.some(m => m.id === 'f2') || !lib.some(m => m.id === 'f3')) return { ok: false, msg: '探不到/免费歌曲被误删' };
    return { ok: true };
  ` }
];

// ---- 执行 ----
let pass = 0, fail = 0;
async function loadPage() {
  await evalJs('window.location.reload(); true;');
  await sleep(700);
  for (let i = 0; i < 40; i++) {
    const ready = await evalJs('window.__mochiDataReady ? true : (document.readyState === "complete" ? true : false);');
    if (ready) break;
    await sleep(150);
  }
  await sleep(250);
}
async function injectStub(feeMap) {
  await evalJs(`(function () {
    // #254 起探测走 meting ?type=url 播放同源通道（旧 song/detail 代理已死）。
    // feeMap 语义：1=不可播（200+text/html 空正文无跳转，VIP 同判据）；0=可播
    // （200+audio/*）；'fail'=网络失败（探测不到，必须不计账防误删）。
    window.fetch = function (url, opts) {
      const u = String(url);
      if (u.indexOf('meting') >= 0 && u.indexOf('type=url') >= 0) {
        try {
          const m = u.match(/id=([0-9]+)/);
          const id = m ? m[1] : '';
          const fm = ${JSON.stringify(feeMap || {})};
          const mode = (id in fm) ? fm[id] : 0;
          if (mode === 'fail') return Promise.reject(new Error('stubbed-net-down'));
          if (mode === 1) return Promise.resolve(new Response('', { status: 200, headers: { 'Content-Type': 'text/html' } }));
          return Promise.resolve(new Response('', { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }));
        } catch (e) { return Promise.reject(e); }
      }
      return Promise.reject(new Error('stubbed-offline'));
    };
    true;
  })();`);
}

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await evalJs('window.location.href = ' + JSON.stringify(baseUrl + '/') + '; true;');
  await loadPage();

  for (const c of cases) {
    let result;
    try {
      // 阶段 1：写入测试数据（跨 reload 保留在 localStorage）
      await evalJs('(function () { ' + resetKeys + '\n })(); true;');
      if (c.stage1) await evalJs('(function () { ' + c.stage1 + '\n })(); true;');
      await evalJs('localStorage.setItem("__testFeeMap", ' + JSON.stringify(JSON.stringify(c.feeMap || {})) + '); true;');
      // 冷启动（reload）
      await loadPage();
      const fm = JSON.parse(await evalJs('localStorage.getItem("__testFeeMap") || "{}"'));
      await injectStub(fm);
      // 阶段 2（可选）：二次操作 + 二次冷启动
      if (c.stage2) {
        await evalJs('(function () { ' + c.stage2 + '\n })(); true;');
        await loadPage();
        await injectStub(fm);
      }
      await evalJs('window.__activeCid = "default"; true;');
      result = await evalJs('(async function () { ' + c.check + '\n })();');
    } catch (e) {
      result = { ok: false, msg: '异常: ' + (e && e.message || e) };
    }
    if (result && result.ok) { pass++; console.log('PASS ' + c.id + '  ' + c.name); }
    else { fail++; console.log('FAIL ' + c.id + '  ' + c.name + (result && result.msg ? '  → ' + result.msg : '')); }
  }

  console.log('\n结果: ' + pass + '/' + (pass + fail) + ' 通过');
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
process.exit(fail ? 1 : 0);
