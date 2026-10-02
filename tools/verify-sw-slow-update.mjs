// ===== 回归脚本：index 更新通道弱网慢路径重试（#942）=====
// 背景（用户直派「这个问题不能解决？」＝跟进「刷新很多次也停在旧版」家族）：四条 index 更新
// 通道（install 预缓存 / activate 补拉 / PRECACHE_NOW「刷新使用新版」落盘 / 导航后台静默刷新）
// 此前都只给 30s 长超时，~30KB/s 弱网传完 1.4~4MB 需要 50~130s ⇒ 30s 必然超时＝四条通道全灭，
// 新版永远落不了缓存。修法＝fetchIndexRes 助手：超时/失败后补一发不带超时的 fetch 慢慢传完。
// 判别力：红基线（纯 HEAD 源码，无 fetchIndexRes）S 组全红＋U2 红；U1/U3 两侧同绿＝防修过头闸。
// 用法：node tools/verify-sw-slow-update.mjs  （MOCHI_ROOT=<目录> 可验任意副本，默认本仓）
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const src = readFileSync(join(__root, 'src', 'pwa', 'sw.js'), 'utf8');
const buildSrc = readFileSync(join(__root, 'build.mjs'), 'utf8');

let pass = 0, fail = 0;
const chk = (name, ok, detail) => { if (ok) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, detail || ''); } };

// —— S 组：四条通道都改走 fetchIndexRes（源锚）——
chk('S1 install 预缓存 index 走慢路径', /fetchIndexRes\(url, isIndexUrl\(url\) \? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT\)/.test(src), '');
chk('S2 activate 补拉走慢路径', /fetchIndexRes\('\.\/index\.html', INDEX_NETWORK_TIMEOUT\)/.test(src), '');
chk('S3 PRECACHE_NOW 落盘走慢路径', /fetchIndexRes\(u, isIndexUrl\(u\) \? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT\)/.test(src), '');
chk('S4 导航后台静默刷新走慢路径', /e\.waitUntil\(\s*\n\s*fetchIndexRes\(req, INDEX_NETWORK_TIMEOUT\)/.test(src), '');
chk('S5 慢路径重试体不带超时（catch 后 fetch(url)）', /return fetchWithTimeout\(url, ms\)\.catch\(\(\) => fetch\(url\)\);/.test(src), '');
chk('S6 build.mjs 登记 #942a~f 六条哨兵', (buildSrc.match(/#942[a-f] /g) || []).length === 6, '');
chk('S7 产物侧 swNeedles 列表同步换锚（防哑哨兵）', buildSrc.includes("'fetchIndexRes(u, isIndexUrl(u) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT)'") && buildSrc.includes('"fetchIndexRes(\'./index.html\', INDEX_NETWORK_TIMEOUT)"'), '');

// —— P 组：页面侧「正在下载」全程反馈与失败如实告知（#944，src/js/pwa.js）——
const pwa = (() => { try { return readFileSync(join(__root, 'src', 'js', 'pwa.js'), 'utf8'); } catch (e) { return ''; } })();
chk('P1 点击即出进度文案（弱网可能要一两分钟）', pwa.includes("setUi('正在下载新版…网络慢时可能需要一两分钟，请保持页面打开', '正在下载…');"), '');
chk('P2 失败如实告知＋重试入口（不再无声停旧版）', pwa.includes("setUi('新版没下载完（网络太慢）。已取消本次刷新，网络好转后会再次提醒；也可点「重试刷新」再试', '重试刷新');"), '');
chk('P3 ack 挪到下载确认成功后（下载失败不写「已确认」）', pwa.includes('if (!auto && ackTs > 0) verMarkAck(ackTs);'), '');
chk('P4 手动通道不再 2.5s 无条件重载（仅自动通道保留）', /if \(auto\) \{\s*\n\s*setTimeout\(function \(\) \{ if \(!done\) doReload\(\); \}, 2500\);/.test(pwa) && (pwa.match(/, 2500\)/g) || []).length === 1, '');
chk('P5 手动等待上限 180s 常量在位', /const VER_DL_WAIT = 180000;/.test(pwa), '');
chk('P6 点击传入版本 ts（成功时写 ack 用）', pwa.includes('refreshNow(false, 0, onlineTs)'), '');
chk('P7 失败回滚 notify 记录（本版本之后还能再提醒）', pwa.includes("localStorage.removeItem('xy-home-v2:ver-update-notify');"), '');
chk('P8 build.mjs 登记 #944a~f 六条哨兵', (buildSrc.match(/#944[a-f] /g) || []).length === 6, '');

// —— U 组：行为断言（把 fetchWithTimeout/fetchIndexRes 两个函数的源码提出来，
//      注入受控 mock fetch 真跑：慢＝第一次到点超时 reject、第二次慢慢成功）——
function extractFn(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  return null;
}
const ftSrc = extractFn('fetchWithTimeout');
const frSrc = extractFn('fetchIndexRes');
chk('U0 两个函数源码可提取', !!ftSrc && !!frSrc, '');
if (ftSrc && frSrc) {
  const make = (fetchMock, timers) => new Function('fetch', 'setTimeout', 'clearTimeout', 'PromiseRef', `
    const setTimeoutRef = setTimeout, clearTimeoutRef = clearTimeout;
    ${ftSrc}\n${frSrc}\nreturn { fetchIndexRes };`
  ).call(null, fetchMock,
    // setTimeout/clearTimeout 用真实定时器，但把耗时记录进 timers 供断言
    (fn, ms) => { const t = { ms }; timers.push(t); const id = setTimeout(fn, ms); t.cancel = () => clearTimeout(id); return id; },
    (id) => clearTimeout(id));
  void make;

  // U1 快路径：一次成功＝只发一次请求、不触发第二次（零变化闸）
  {
    let calls = 0;
    const okRes = { ok: true, status: 200 };
    const api = new Function('fetch', `
      ${ftSrc}\n${frSrc}\nreturn fetchIndexRes('https://x/index.html', 50);`).call(null, (u) => { calls++; return Promise.resolve(okRes); });
    const r = await api;
    chk('U1 快路径一次成功零重试', calls === 1 && r === okRes, 'calls=' + calls);
  }
  // U2 慢路径：第一次超时失败 → 必须有第二次不带超时的重试并成功
  {
    let calls = 0;
    const slowRes = { ok: true, status: 200, body: 'slow-full' };
    const api = new Function('fetch', 'INDEX_MS', `
      ${ftSrc}\n${frSrc}\nreturn fetchIndexRes('https://x/index.html', INDEX_MS);`)
      .call(null, (u) => {
        calls++;
        if (calls === 1) return new Promise((_, rej) => { /* 永不 resolve＝靠超时掐断 */ const t = setTimeout(() => rej(new Error('should-not-fire')), 3000); t.unref && t.unref(); });
        return new Promise((res) => setTimeout(() => res(slowRes), 200)); // 第二次"传很久"但 < 断言窗
      }, 60);
    const t0 = Date.now();
    const r = await api;
    const waited = Date.now() - t0;
    chk('U2 超时后补发慢重试并成功', calls === 2 && r === slowRes, 'calls=' + calls);
    chk('U3 重试不受首超时预算截断（>首超时时长才成功）', waited >= 200, 'waited=' + waited + 'ms');
  }
  // U4 两次都失败＝按失败抛出（调用方 catch 走原有兜底，不得假成功）
  {
    let calls = 0;
    const api = new Function('fetch', `
      ${ftSrc}\n${frSrc}\nreturn fetchIndexRes('https://x/index.html', 50).then(() => 'ok', () => 'fail');`)
      .call(null, (u) => { calls++; return Promise.reject(new Error('net-down')); });
    const r = await api;
    chk('U4 双失败如实失败（不假成功）', calls === 2 && r === 'fail', 'calls=' + calls + ' r=' + r);
  }
}

// —— U5~U7：refreshNow 行为断言（提取 _prMsg~refreshNow 段源码，注入受控桩真跑）——
function extractSlice(src, startMark, endMark) {
  const i = src.indexOf(startMark);
  const j = src.indexOf(endMark, i);
  return i >= 0 && j >= 0 ? src.slice(i, j + endMark.length) : null;
}
const rnSrc = pwa ? extractSlice(pwa, 'let _prMsg = null;', '\n  }' + '\n  // #570') : null;
chk('U5 refreshNow 段源码可提取', !!rnSrc, '');
function runRefreshNow(stub, waitMs) {
  const code = rnSrc.replace('const VER_DL_WAIT = 180000;', 'const VER_DL_WAIT = ' + (waitMs || 180000) + ';');
  return new Function('navigator', 'document', 'location', 'window', 'localStorage', 'verMarkAck', 'showVerBar', 'autoReloadAllowed', `
    ${code}
    return refreshNow;`).call(null,
    stub.navigator, stub.document, stub.location, stub.window, stub.localStorage, stub.verMarkAck, stub.showVerBar, stub.autoReloadAllowed);
}
if (rnSrc) {
  const makeStub = () => {
    const st = {
      reloaded: 0, acked: [], posted: [], listeners: [],
      navigator: { serviceWorker: { controller: { postMessage: (m) => st.posted.push(m) }, addEventListener: (t, f) => st.listeners.push(f), removeEventListener: () => {} } },
      document: { getElementById: (id) => id === 'ver-update-bar' ? st.bar : (id === 'ver-update-refresh' ? st.btn : null) },
      location: { reload: () => { st.reloaded++; } },
      window: {},
      localStorage: { _m: { 'xy-home-v2:ver-update-notify': '999|456' }, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } },
      verMarkAck: (ts) => st.acked.push(ts),
      showVerBar: () => {},
      autoReloadAllowed: () => true
    };
    st.bar = { querySelector: () => st.txt }; st.txt = { textContent: '' }; st.btn = { textContent: '', onclick: null };
    return st;
  };
  const fire = (st) => st.listeners.forEach((f) => f({ data: { type: 'PRECACHE_DONE' } }));
  // U6 快成功：点击出进度、不立刻重载；收到 PRECACHE_DONE 才写 ack＋重载
  {
    const st = makeStub();
    const rn = runRefreshNow(st, 60000);
    rn(false, 0, 999);
    const early = { reloaded: st.reloaded, txt: st.txt.textContent, btn: st.btn.textContent };
    fire(st);
    await new Promise((r) => setTimeout(r, 30));
    chk('U6a 点击出进度且未立刻重载', early.reloaded === 0 && /正在下载新版/.test(early.txt) && early.btn === '正在下载…', JSON.stringify(early));
    chk('U6b 回执后才写 ack 并重载（且只重载一次）', st.acked.includes(999) && st.reloaded === 1, JSON.stringify({ acked: st.acked, reloaded: st.reloaded }));
  }
  // U7 超时：不重载、如实告知、按钮变重试、notify 记录回滚
  {
    const st = makeStub();
    const rn = runRefreshNow(st, 80);
    rn(false, 0, 999);
    await new Promise((r) => setTimeout(r, 250));
    chk('U7 超时不重载＋如实文案＋重试按钮＋notify 回滚', st.reloaded === 0 && /新版没下载完/.test(st.txt.textContent) && st.btn.textContent === '重试刷新' && st.localStorage.getItem('xy-home-v2:ver-update-notify') === null, JSON.stringify({ reloaded: st.reloaded, txt: st.txt.textContent, btn: st.btn.textContent, ls: st.localStorage._m }));
  }
}

console.log(fail === 0 ? `\n${pass} 通过 / 0 失败  [root=${__root}]` : `\n${pass} 通过 / ${fail} 失败  [root=${__root}]`);
process.exit(fail === 0 ? 0 : 1);
