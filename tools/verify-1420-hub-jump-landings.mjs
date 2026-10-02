// ===== 专项回归：功能大全 → 字卡库每一枚入口的「真实落点」（#1420，#1417 同族全站扫） =====
// 起因（作者）：#1417 修完贴贴那发错跳后要求「检查还有没有其他系统预设字卡是同样问题」。
// 本族症状有两种：①**串页**＝大全条目名与点开后露出的那一页对不上（#1417 那种整组末段串一格）；
// ②**没人直达**＝字卡库里有这枚入口，功能大全里却没有一条 `go` 指向它＝用户只能盲翻。
// 判据（零机型／零 UA 分支，只问几何与文本）：不靠名字猜——在真无头里「开大全→搜该条目名→点那一行」，
// 读三样：当前哪一页 hidden=false、那一页的页名（.ch-name）、有没有弹「入口暂不可达」。
// 夹具：按 build.mjs 真 jsFiles/cssFiles 从 src/ 现装配（不读产物＝未构建也能验）。
// 用法：node tools/verify-1420-hub-jump-landings.mjs [--report]
//   --report＝只列表不判红（用来生成/复核下面的 ROSTER 与覆盖率）；默认模式＝按下述断言判。
// 断言：
//   A1 每条「大全→#li-*」条目点下去恰好一页可见（零停在原地／零两页同开）
//   A2 落点页 id 逐条等于 ROSTER（写死的事实源＝串页再犯必红）
//   A3 覆盖率：系统预设字卡那一组每枚入口都被 ≥1 条大全条目直达
//   A4 可自定义字卡那一组同上（缺的那枚点名报出，属待作者点头项则进白名单）
//   A5 零「入口暂不可达」toast
//   A6 零未捕获异常（文件选择类两枚进白名单：它们真去点 input[type=file]）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPORT = process.argv.includes('--report');

// ---------- 静态：模板里字卡库两组的入口 ----------
const tplSrc = readFileSync(join(root, 'src/template.html'), 'utf8');
const hubSrc = readFileSync(join(root, 'src/js/feature-hub.js'), 'utf8');
const sectionAt = (id) => tplSrc.indexOf('id="' + id + '"');
const SEC = { custom: sectionAt('cc-sect-custom'), preset: sectionAt('cc-sect-preset') };
const items = [];
{
  const re = /class="chat-item glass" id="(li-[^"]+)"/g;
  let m;
  while ((m = re.exec(tplSrc))) {
    const at = m.index;
    const sec = at > SEC.preset ? 'preset' : (at > SEC.custom ? 'custom' : 'other');
    const mm = tplSrc.slice(at, at + 700).match(/class="n">([^<]+)</);
    items.push({ id: m[1], sec, name: mm ? mm[1] : '' });
  }
}
const byId = {};
items.forEach((it) => { byId[it.id] = it; });

// ---------- 静态：功能大全里所有以 #li-* 收尾的条目 ----------
function parseGo(src, from) {
  let i = from; const sels = [];
  while (i < src.length) {
    while (i < src.length && src[i] !== "'" && src[i] !== '"' && src[i] !== ']') i++;
    if (src[i] === ']') return sels;
    const q = src[i++]; let s = '';
    while (i < src.length && src[i] !== q) { if (src[i] === '\\') { s += src[i]; i++; } s += src[i]; i++; }
    i++; sels.push(s);
  }
  return sels;
}
const hubRows = [];
{
  let at = 0;
  while (true) {
    const g = hubSrc.indexOf('go: [', at);
    if (g < 0) break;
    const line = hubSrc.slice(hubSrc.lastIndexOf('{ n: ', g), g);
    const nm = line.match(/\{ n: (['"])(.*?)\1, d: /);
    const dm = line.match(/d: (['"])(.*?)\1, k:/);
    const sels = parseGo(hubSrc, g + 5);
    // 链尾可能再指一页里的子标签（#1417 给贴贴补的第三段），所以「字卡库那枚入口」要往回找
    const liSeg = sels.filter((s) => /^#li-/.test(s)).pop() || '';
    if (nm && liSeg) hubRows.push({ n: nm[2], d: dm ? dm[2] : '', sels, last: liSeg.slice(1) });
    at = g + 5;
  }
}
const targeted = {};
hubRows.forEach((r) => { targeted[r.last] = (targeted[r.last] || []).concat(r.n); });
const covered = (sec) => items.filter((it) => it.sec === sec && !targeted[it.id]);

console.log('字卡库入口总数：' + items.length + '（可自定义 ' + items.filter((i) => i.sec === 'custom').length +
  '／系统预设 ' + items.filter((i) => i.sec === 'preset').length + '）；大全里以 #li-* 收尾的条目：' + hubRows.length);
if (REPORT) {
  console.log('\n== 覆盖率缺口（字卡库有这枚入口，功能大全里没有任何直达条目） ==');
  ['preset', 'custom'].forEach((sec) => {
    const miss = covered(sec);
    console.log('· ' + sec + ' 组缺 ' + miss.length + ' 枚：' + (miss.map((i) => i.id + '「' + i.name + '」').join('、') || '无'));
  });
  console.log('\n== 每条大全条目的落点（行为侧待跑） ==');
  hubRows.forEach((r) => console.log('  ' + r.n + ' -> #' + r.last + '（字卡库实名「' + (byId[r.last] ? byId[r.last].name : '不在两组内') + '」）'));
}

// ---------- 落点事实源（32 条逐条肉眼核过：页名与条目语义对得上；串页再犯必红） ----------
// 两条「导出/导入」是动作类（点了不换页，留在字卡库开文件选择／下载），故意钉 page-chatcard。
const ROSTER = {
  '批量提问问卷': 'page-ta-ask-survey',
  '词典字卡': 'page-dict-cards',
  '公用自定义字卡': 'page-custom-cards',
  '公用 / 专属自定义字卡': 'page-custom-cards',
  '系统预设字卡': 'page-default-cards',
  '聊天情绪字卡': 'page-mood-cards',
  '聊天回应字卡': 'page-reply-cards',
  '语录字卡': 'page-quote-cards',
  '今日情话·我的添加': 'page-quote-cards',
  '其他互动功能字卡': 'page-fun-cards',
  '功能字卡·公用': 'page-custom-cards',
  '功能字卡·专属': 'page-custom-cards',
  'TA 的提问字卡': 'page-ta-ask',
  'TA的询问·我的添加': 'page-ta-ask',
  'TA 的心情字卡': 'page-ta-mood',
  'TA 的选择题字卡': 'page-ta-choose',
  'TA的小问题·我的添加': 'page-ta-choose',
  'TA 的好奇字卡': 'page-ta-curious',
  'TA的好奇·我的添加': 'page-ta-curious',
  'TA 的吐槽字卡': 'page-ta-roast',
  'TA的吐槽·我的添加': 'page-ta-roast',
  'TA 的邀请字卡': 'page-ta-invite',
  'TA的邀请·我的添加': 'page-ta-invite',
  '字卡库完整导出': 'page-chatcard',
  '字卡库完整导入': 'page-chatcard',
  '查岗互动字卡': 'page-ta-checkin',
  'TA的查岗·我的添加': 'page-ta-checkin',
  '寻踪日常字卡': 'page-checkin-cards',
  '寻踪日常·我的添加': 'page-checkin-cards',
  'TA在身边位置卡': 'page-loc-cards',
  '桌面查岗字卡': 'page-deskcheck',
  '贴贴邀请字卡': 'page-ta-invite'
};

// ---------- 装配夹具 ----------
const buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8');
const arrOf = (name) => {
  const m = buildSrc.match(new RegExp('const ' + name + ' = \\[([^\\]]*)\\]'));
  return m ? m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];
};
const cssFiles = arrOf('cssFiles'), jsFiles = arrOf('jsFiles');
let testHtml = tplSrc
  .replace('/*__SCRIPTS__*/', () => jsFiles.map((f) => '(function () { try {\n' + readFileSync(join(root, 'src/js', f), 'utf8') + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();').join('\n'))
  .replace('/*__STYLES__*/', () => cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'))
  .split('__BUILD_INFO__').join('verify-test-build').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');

const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-1420-root-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const p = normalize(join(tmpRoot, rel));
    if (!p.startsWith(tmpRoot)) { res.writeHead(403); res.end(); return; }
    let hit = false; try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cands = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const exe = cands.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!exe) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const profile = join(process.env.TEMP || '/tmp', 'mochi-1420-profile-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9820 + Math.floor(Math.random() * 60));
const chrome = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 80; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const pg = l.find((t) => t.type === 'page');
    if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((r2, j) => { ws.onopen = r2; ws.onerror = j; }); break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('连不上 CDP'); chrome.kill('SIGKILL'); process.exit(1); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const cdp = (method, params = {}) => { const i2 = ++msgId; return new Promise((r2) => { pend.set(i2, r2); ws.send(JSON.stringify({ id: i2, method, params })); }); };
async function evalJs(e) {
  const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 160) };
  return r && r.result ? r.result.value : null;
}
const exceptions = [];
await cdp('Runtime.enable'); await cdp('Page.enable');
const rawH = ws.onmessage;
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') exceptions.push(JSON.stringify(m.params).slice(0, 160)); if (rawH) rawH(ev); };
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(5200);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
await sleep(400);
await evalJs("(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return 1;})()");
await sleep(600);

// 点大全里那一行，量「屏上露出来的是哪一页／那一页的页名／有没有不可达 toast」
const probe = (name, id) => evalJs(`(function(){try{
  window.mochiFeatureHubOpen(${JSON.stringify(name)});
  var rows=Array.prototype.slice.call(document.querySelectorAll('#fhub-body .set-row'));
  var hit=rows.filter(function(r){if(r.style.display==='none')return false;var t=r.querySelector('.txt');return t&&t.firstChild&&String(t.firstChild.nodeValue).trim()===${JSON.stringify(name)};})[0];
  if(!hit) return {found:false, n:rows.filter(function(r){return r.style.display!=='none';}).length};
  hit.click();
  var vis=Array.prototype.slice.call(document.querySelectorAll('.page')).filter(function(p){return !p.hidden;});
  var t=document.getElementById('cc-toast');
  var one=vis.length===1?vis[0]:null;
  var tabSel=one?one.querySelector('.cc-tab[data-tab].sel'):null;
  var catSel=one?one.querySelector('.cc-tab[data-cat].sel'):null;
  var panels={}; var visPanel=null;
  if(one) Array.prototype.slice.call(one.querySelectorAll('[id$="-sys-panel"],[id$="-mine-panel"]')).forEach(function(el){panels[el.id]=!el.hidden; if(!el.hidden&&!visPanel) visPanel=el;});
  // 内容层读数：库里那枚入口右上角的数字（badge），与点开后那一屏真正露出的行数／文字量／空态字样
  var lib=document.getElementById('page-chatcard');
  var badge=null;
  if(lib){ var bel=lib.querySelector('#' + ${JSON.stringify(id)} + ' > .t'); if(bel) badge=(bel.textContent||'').trim(); }
  var scope=visPanel||one||document;
  var blocks=scope.querySelectorAll('.ta-row,.dc-row,.cc-item,.mg-block,.set-group > .chat-item').length;
  var txt=(scope.textContent||'');
  return {found:true,
    pages:vis.map(function(p){return p.id;}),
    pageName:one?((one.querySelector('.ch-name')||{}).textContent||'').trim():'',
    tab:tabSel?tabSel.dataset.tab:null,
    cat:catSel?catSel.dataset.cat:null,
    panels:panels,
    panel:visPanel?visPanel.id:null,
    badge:badge,
    rows:blocks,
    txtLen:txt.length,
    empty:/暂无|没有.{0,6}(字卡|内容|添加)|未添加/.test(txt),
    toast:t?(t.textContent||''):''};
}catch(e){return {err:String(e)};}})()`);

const land = {};
for (const r of hubRows) {
  const res = await probe(r.n, r.last);
  land[r.n] = res;
  await sleep(120);
}

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; if (!REPORT) console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' —— ' + JSON.stringify(x) : '')); } };

console.log('\n== 逐条真实落点 ==');
hubRows.forEach((r) => {
  const L = land[r.n] || {};
  console.log('  ' + (L.found ? (L.pages || []).join('+') : '(搜不到该行)') +
    ' | 页名「' + (L.pageName || '') + '」 | tab=' + (L.tab || '-') + ' cat=' + (L.cat || '-') +
    ' | 库内数字=' + (L.badge === null || L.badge === undefined ? '-' : L.badge) +
    ' 屏上块=' + L.rows + ' 字数=' + L.txtLen + ' 空态字样=' + (L.empty ? 'Y' : 'N') +
    ' | 字卡库实名「' + (byId[r.last] ? byId[r.last].name : '?') + '」 :: ' + r.n);
});

if (!REPORT) {
  console.log('\n== 断言 ==');
  hubRows.forEach((r) => {
    const L = land[r.n] || {};
    ok('A1 ' + r.n + '：点下去恰好一页可见', L.found === true && Array.isArray(L.pages) && L.pages.length === 1, L);
    if (ROSTER[r.n]) ok('A2 ' + r.n + '：落点＝' + ROSTER[r.n], L.pages && L.pages[0] === ROSTER[r.n], L.pages);
    // A7 第二型「同页错栏」：那一页有 sys/mine 两面板时，条目名里的「·我的添加」必须与露出来的面板一致
    const pn = L.panels || {};
    const hasBoth = Object.keys(pn).some((k) => /-sys-panel$/.test(k)) && Object.keys(pn).some((k) => /-mine-panel$/.test(k));
    if (hasBoth) {
      const wantMine = /·我的添加$/.test(r.n);
      const sysOn = Object.keys(pn).filter((k) => /-sys-panel$/.test(k)).some((k) => pn[k] === true);
      const mineOn = Object.keys(pn).filter((k) => /-mine-panel$/.test(k)).some((k) => pn[k] === true);
      ok('A7 ' + r.n + '：栏位＝' + (wantMine ? '我的添加' : '系统预设') + '（tab=' + (L.tab || '-') + '）',
        wantMine ? (mineOn && !sysOn) : (sysOn && !mineOn), pn);
    }
  });
  const cuddle = land['贴贴邀请字卡'] || {};
  ok('A8 贴贴那条停在选择中的分类＝cuddle（不是默认的猜拳栏）', cuddle.cat === 'cuddle', { cat: cuddle.cat, tab: cuddle.tab });
  // A9 内容层「没显示」：库内右上角有数字（>0）的入口，点开那一屏必须有文字且不带空态字样。
  //（判据里刻意不用「块数」——各预设页的行 markup 类名不一（.ta-row/.tc-row/自绘行），
  //  拿统一选择器数块会误红；字数＋空态字样两条同时判才稳。）
  const blank = hubRows.filter((r) => {
    const L = land[r.n] || {};
    const b = Number(L.badge);
    return L.found && isFinite(b) && b > 0 && (L.empty === true || !(L.txtLen >= 40));
  }).map((r) => r.n + '(库内标' + (land[r.n] || {}).badge + '·字数' + (land[r.n] || {}).txtLen + '·空态' + ((land[r.n] || {}).empty ? 'Y' : 'N') + ')');
  ok('A9 零「库里有数、点开是空」的入口', blank.length === 0, blank);
  ok('A3 系统预设字卡组每枚入口都有大全直达', covered('preset').length === 0, covered('preset').map((i) => i.id + '「' + i.name + '」'));
  ok('A4 可自定义字卡组每枚入口都有大全直达', covered('custom').length === 0, covered('custom').map((i) => i.id + '「' + i.name + '」'));
  const unreachable = hubRows.filter((r) => land[r.n] && land[r.n].toast && land[r.n].toast.indexOf('入口暂不可达') >= 0).map((r) => r.n);
  ok('A5 零「入口暂不可达」', unreachable.length === 0, unreachable);
  ok('A6 全程零未捕获异常', exceptions.length === 0, exceptions.slice(0, 3));
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
}

try { chrome.kill('SIGKILL'); } catch (e) {}
try { server.close(); } catch (e) {}
try { rmSync(tmpRoot, { recursive: true, force: true }); rmSync(profile, { recursive: true, force: true }); } catch (e) {}
if (!REPORT) process.exit(fail ? 1 : 0);
