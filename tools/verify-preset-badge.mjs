// ===== 回归 #822：系统预设字卡「数据包没装载」时必须说真话，不能再装成「只有几百张」 =====
// 背景（用户形态）：解锁开屏二级密码后，字卡库 → 系统预设字卡 顶部 tab 徽标仍像「只解开了几百个」，
//   其他互动功能字卡等条目数量也不对。实测根因与密码无关：徽标是代码从数据算出来的，锁定/解锁
//   两态同为 22933，二级锁从不参与计数。真形态＝ build.mjs 按 500KB 拆 script 块，
//   default-cards-data.js＋dict-ext-data.js＋reply/fav-settings 同块内联（现第 6 块），该块
//   parse 失败＝块内四个文件一起死（块内 try/catch 只兜运行期错，语法错在 parse 期兜不住）→
//   default-cards.js 的兜底把 DATA 换成空壳 → 四枚入口角标全 0、分区 tab 徽标残留尾部模块
//   一千多、进默认字卡页显示「暂无默认字卡」，且 __jsErrors 为空＝零报错零提示，用户只能读成
//   「密码没解开全部」。
// 修复（零机型/零 UA 分支，判据取数据本身）：
//   ① default-cards.js：PRESET_KEYS 全库合计为 0 即判「数据包未加载」，入口角标改写 '—'
//      （区别于真·0 条），并在系统预设分区顶部挂一条指名自愈路径的提示（#cc-preset-data-hint），
//      判定函数暴露为 window.defaultCardDataMissing；
//   ② chatcard.js：分区 tab 徽标在缺失时同样写 '—'，不再显示残留小数字；点分区即按当前 DOM
//      重算徽标（原口径只靠 MutationObserver 防抖与 mochi-restore-done，计数写入早于观察器
//      挂载时永久停在旧值）。
// 断言（本脚本绿＝修复在位；把本批 src 退回纯 HEAD 再构建 → B 组全红＝判别力确认）：
//   A 组 正常产物：缺失判据为 false、四枚角标与分区徽标等于独立重算值、提示不显示、点分区同步重算
//   B 组 数据块被抹掉的产物：提示可见并指名自愈路径、四枚角标与分区徽标都是 '—'、判据为 true
// 用法：node tools/verify-preset-badge.mjs
//       仓外副本验证：SERVE_DIR=<构建目录> node tools/verify-preset-badge.mjs
//       红基线：另建一份 git archive HEAD 副本（不含本批 src）build 后用同一 SERVE_DIR 跑
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.SERVE_DIR || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);
const chromePath = chromeCandidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

// ---- 服务端：正常产物直接给；?broken=1 时把内置字卡数据包所在的整个 script 块抹成空块 ----
// 模拟线上真实故障（弱网截断/旧缓存/该内核拦掉这块脚本都会让整块连坐），不是脚本自己造的假场景：
// 块内 default-cards-data.js 一死，DATA 就是空壳，页面回到「静默显示 0」的那条路。
const DATA_CHUNK_MARKER = '__mochiLoaded.push("default-cards-data.js")';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
// 两组各用一个端口＝两个 origin：A 组首次启动会注册 SW，SW 对 index.html 是缓存优先，
// B 组若共用 origin 会拿到 A 组缓存的正常文档（数据块完好）＝夹具失效（实测踩过）。
function makeServer(alwaysBroken) {
  return createServer((req, res) => {
    try {
      const u = decodeURIComponent(req.url.split('?')[0]);
      let p = normalize(join(root, u));
      if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
      if (statSync(p).isDirectory()) p = join(p, 'index.html');
      const q = (req.url.split('?')[1] || '').split('&');
      const broken = alwaysBroken || q.some((s) => s.indexOf('broken=') === 0);
      if (u.endsWith('.html') && broken) {
        const html = readFileSync(p, 'utf8');
        let hit = 0;
        const out = html.replace(/<script>([\s\S]*?)<\/script>/g, (all, body) => {
          if (body.indexOf(DATA_CHUNK_MARKER) < 0) return all;
          hit++;
          return '<script>/* 本块被 verify 抹掉：模拟数据包整块未执行 */</script>';
        });
        // #860（PERF-PLAN 阶段 1b）：数据包已外置为 js/default-cards-data.js，index.html
        // 里不再有装载它的 script 块——本分支命中 0 是预期形态而非故障，交给下面的 .js
        // 分支按内容命中兜住（同一次请求可能先到 .html 再到 .js，两者取其一即可）。
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(out);
        return;
      }
      // #860：外置的数据包文件被按「内容含 $DATA_CHUNK_MARKER」命中 → 回空体，
      // 模拟「该文件整段未执行」（弱网截断/404/内核拦掉），DATA 即空壳 → 页面走「静默显示 0」那条路。
      if (broken && u.endsWith('.js') && u.indexOf('default-cards-data') >= 0) {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end('/* 本文件被 verify 抹掉：模拟数据包整块未执行 */');
        return;
      }
      res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
      res.end(readFileSync(p));
    } catch (e) { res.writeHead(404); res.end('nf'); }
  });
}
const server = makeServer(false);
const serverBroken = makeServer(true);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
await new Promise((r) => serverBroken.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const baseUrlBroken = 'http://127.0.0.1:' + serverBroken.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 90));
const profile = join(process.env.TEMP || '/tmp', 'mochi-822-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

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
const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
const evalJs = async (expr) => {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 260)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
};
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail === undefined ? '' : '  [' + JSON.stringify(detail) + ']'));
}

// 进应用并打开字卡库的系统预设分区（夹具：开屏必须滑到底再点进入，二级锁置为已解锁）
async function boot(tag, broken) {
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('xy-home-v2:cardlock-state','open');}catch(e){}" });
  await cdp('Page.navigate', { url: (broken ? baseUrlBroken : baseUrl) + '/index.html?' + (broken ? 'broken=1&' : '') + 'v822=' + tag + Date.now() });
  for (let i = 0; i < 120; i++) {
    if (await evalJs("!!window.xyStore && !!window.__mochiLoaded && (!window.__mochiExtFiles || window.__mochiExtFiles.every(function(f){return window.__mochiLoaded.indexOf(f)>=0;}))")) break;
    await sleep(250);
  }
  await sleep(1200);
  await evalJs("(function(){var b=document.getElementById('splash-box');if(b)b.scrollTop=b.scrollHeight;var e=document.getElementById('splash-enter');if(e)e.click();return 1;})()");
  await sleep(700);
  await evalJs("(function(){document.querySelectorAll('#qa-mask,#tc-mask,#modal-mask,.tc-mask,.modal-mask').forEach(function(m){m.hidden=true;});return 1;})()");
  // 进字卡库 → 点「系统预设字卡」分区
  await evalJs("(function(){var t=document.querySelector('.tab[data-page=\"page-chatcard\"]');if(t)t.click();return 1;})()");
  await sleep(600);
  await evalJs("(function(){var b=document.querySelector('.cc-tab[data-ccsect=\"preset\"]');if(b)b.click();return 1;})()");
  await sleep(600);
}

// 独立重算（不读页面写好的数字，自己从 window.DEFAULT_CARD_DATA 求和）——与修复本体不同源，
// 才能证明「页面上的数字确实等于数据」，而不是「修复自己算自己看」。
const RECOMPUTE = "(function(){" +
  "var D=window.DEFAULT_CARD_DATA||{};" +
  "var BASE=['main','kaomoji','emoji','touch'];" +
  "var FUNC=['fish','eat','period','water','garden','sync','reach','cjian','room','piggy','drift','interact','music'];" +
  "var sum=function(ks){var n=0;ks.forEach(function(k){(D[k]||[]).forEach(function(g){n+=(g&&g[1]?g[1].length:0);});});return n;};" +
  "return JSON.stringify({base:sum(BASE),func:sum(FUNC),dict:sum(['dict']),dk:sum(['deskcheck']),all:sum(BASE.concat(FUNC,['dict','deskcheck']))});" +
  "})()";
const UI = "(function(){" +
  "var g=function(id){var e=document.getElementById(id);return e?String(e.textContent):null;};" +
  "var btn=document.querySelector('.cc-tab[data-ccsect=\"preset\"]');" +
  "var em=btn?btn.querySelector('.cc-tab-n'):null;" +
  "var hint=document.getElementById('cc-preset-data-hint');" +
  "var sect=document.getElementById('cc-sect-preset');" +
  "var domSum=0;if(sect)sect.querySelectorAll('.chat-item .t').forEach(function(t){var v=parseInt(String(t.textContent).replace(/[^\\d]/g,''),10);if(!isNaN(v)&&v>0)domSum+=v;});" +
  "return JSON.stringify({" +
  "libCount:g('dc-lib-count'),dictCount:g('dc-dict-count'),funcCount:g('fc-lib-count'),dkCount:g('dk-lib-count')," +
  "tabBadge:em?String(em.textContent):null,domSum:domSum," +
  "hintExists:!!hint,hintShown:!!(hint&&!hint.hidden&&hint.offsetParent!==null),hintText:hint?String(hint.textContent).slice(0,240):''," +
  "missing:(window.defaultCardDataMissing?window.defaultCardDataMissing():'no-fn')," +
  "reRender:(typeof window.__ccRenderTabTotals)" +
  "});" +
  "})()";

// ================= A 组：正常产物 =================
await boot('a', false);
const A_re = JSON.parse(await evalJs(RECOMPUTE) || 'null');
const A_ui = JSON.parse(await evalJs(UI) || 'null');
check('A0 数据包真值在位（重算合计 >2 万，四分类分别非空）',
  !!A_re && A_re.all > 20000 && A_re.base > 4000 && A_re.dict > 900 && A_re.func > 900 && A_re.dk > 0, A_re);
check('A1 正常态判据为 false（没缺不报警，防「狼来了」）',
  A_ui && A_ui.missing === false, A_ui && A_ui.missing);
check('A2 四枚入口角标 = 独立重算值（默认/词典/功能/查岗逐一对账）',
  A_ui && A_re && A_ui.libCount === String(A_re.base) && A_ui.dictCount === String(A_re.dict) &&
  A_ui.funcCount === String(A_re.func) && A_ui.dkCount === String(A_re.dk),
  A_ui && [A_ui.libCount, A_ui.dictCount, A_ui.funcCount, A_ui.dkCount]);
check('A3 系统预设分区 tab 徽标 = 分区内条目之和且量级正确（不是「几百」）',
  A_ui && A_re && Number(A_ui.tabBadge) === A_ui.domSum && Number(A_ui.tabBadge) > 20000,
  A_ui && [A_ui.tabBadge, A_ui.domSum]);
check('A4 正常态不弹「数据包未加载」提示（缺失才亮，不误伤）',
  A_ui && (!A_ui.hintExists || !A_ui.hintShown), A_ui && [A_ui.hintExists, A_ui.hintShown]);
check('A5 重算出口已暴露给分区切换（window.__ccRenderTabTotals 为函数）',
  A_ui && A_ui.reRender === 'function', A_ui && A_ui.reRender);

// A6 点分区即同步重算（#822d）：改一条条目计数 → 不点（观察器防抖 120ms，此刻仍是旧值）
// → 点另一分区 → 同一 tick 内徽标必须已经跟上新值。全程在一次 eval 里，无计时器竞态。
const A6 = await evalJs("(function(){" +
  "var btns=[].slice.call(document.querySelectorAll('.cc-tab[data-ccsect]'));" +
  "var badgeOf=function(k){var b=btns.filter(function(x){return x.getAttribute('data-ccsect')===k;})[0];var e=b&&b.querySelector('.cc-tab-n');return e?String(e.textContent):null;};" +
  "var body=document.getElementById('cc-sect-custom');" +
  "var t=body?body.querySelector('.chat-item .t'):null;" +
  "if(!t)return 'no-anchor';" +
  "var old=Number(String(t.textContent).replace(/[^\\d]/g,''))||0;" +
  "var b0=badgeOf('custom');" +
  "t.textContent=String(old+1000);" +
  "var b1=badgeOf('custom');" +
  "var p=btns.filter(function(x){return x.getAttribute('data-ccsect')==='preset';})[0];" +
  "if(p)p.click();" +
  "var b2=badgeOf('custom');" +
  "t.textContent=String(old);" +
  "if(p)p.click();" +
  "return JSON.stringify([b0,b1,b2,Number(b0||0)+1000===Number(b2||-1)]);" +
  "})()");
check('A6 点分区当场按 DOM 重算徽标（改一条→点分区→同一 tick 跟上新值；不点则不跟）',
  (() => { try { const a = JSON.parse(A6); return a.length === 4 && a[3] === true && a[1] === a[0]; } catch (e) { return false; } })(), A6);
const A_errs = await evalJs("(window.__jsErrors||[]).slice(0,3).join(' | ')");
check('A7 A 组全程零 JS 报错', !A_errs, A_errs);

// ================= B 组：数据包整块未执行（缺陷本体）=================
await boot('b', true);
const B_re = JSON.parse(await evalJs(RECOMPUTE) || 'null');
const B_ui = JSON.parse(await evalJs(UI) || 'null');
check('B0 夹具生效：数据包真的整块没执行（重算合计为 0）',
  !!B_re && B_re.all === 0, B_re);
check('B1 缺数据时判据为 true（不再靠机型/UA 猜）',
  B_ui && B_ui.missing === true, B_ui && B_ui.missing);
check('B2 系统预设分区顶部亮出「数据包未加载」提示（可见、在预设分区里）',
  B_ui && B_ui.hintExists && B_ui.hintShown && /数据包未加载/.test(B_ui.hintText || ''),
  B_ui && [B_ui.hintExists, B_ui.hintShown]);
check('B3 提示文案指名自愈路径（点明不是密码问题 + 更新入口 + 诊断报告出口）',
  B_ui && /不是二级密码/.test(B_ui.hintText) && /更新/.test(B_ui.hintText) && /设备兼容诊断/.test(B_ui.hintText),
  B_ui && B_ui.hintText.slice(0, 90));
check('B4 四枚入口角标改写破折号（区别于真·0 条，不再谎报「一张都没有」）',
  B_ui && B_ui.libCount === '—' && B_ui.dictCount === '—' && B_ui.funcCount === '—' && B_ui.dkCount === '—',
  B_ui && [B_ui.libCount, B_ui.dictCount, B_ui.funcCount, B_ui.dkCount]);
check('B5 分区 tab 徽标不再显示残留小数字（那串会被读成「只解开了几百张」）',
  B_ui && B_ui.tabBadge === '—', B_ui && B_ui.tabBadge);

const pass = results.filter((r) => r.ok).length;
console.log('— 合计 ' + pass + '/' + results.length + ' —');
await cdp('Browser.close').catch(() => {});
chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
server.close();
serverBroken.close();
process.exit(pass === results.length ? 0 : 1);
