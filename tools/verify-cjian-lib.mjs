// ===== 专项：此间（梦角世界）字卡库【系统预设字卡→此间】分组 + 感知播报同源联动 =====
// 用法：node tools/verify-cjian-lib.mjs
// 背景（用户反馈）：喝水/房间/同频/伸手/花园 等功能分类在【系统预设字卡】里找不到查看入口，
//   且「此间」从未入库——本轮把全部功能池 tab 连排最前并新增「此间」分组：
//   DEFAULT_CARD_DATA.cjian 四组（在场感知/空闲状态 供查看；感知·气息/感知·落空 为
//   点「感应」时的随机播报句），cjian.js 经 getLibPool('cjian',分组,兜底) 抽取 +
//   isDefaultCardOff 过滤，全关回退内置兜底。
// 自组装临时站点：不依赖也不触发 node build.mjs；结束删除临时目录。
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : ''));
}

// ---- A 组：源码静态断言 ----
{
  const dataSrc = readFileSync(join(root, 'src', 'js', 'default-cards-data.js'), 'utf8');
  const m = dataSrc.match(/DEFAULT_CARD_DATA\.cjian\s*=\s*\[([\s\S]*?)\n\];/);
  const lib = m ? m[1] : '';
  const groups = (lib.match(/\["([^"]+)",\s*\[/g) || []).map(s => s.replace(/[^\u4e00-\u9fa5·]/g, ''));
  check('A1 新增 DEFAULT_CARD_DATA.cjian 预设池，四组齐全（在场感知/空闲状态/感知·气息/感知·落空）',
    !!m && ['在场感知', '空闲状态', '感知·气息', '感知·落空'].every(g => groups.some(x => x.indexOf(g) >= 0)),
    { groups: groups });
  const quoted = (lib.match(/"[^"]*"|'[^']*'/g) || []);
  check('A2 预设池共 17 条文案（5+6+4+2，不含组名）', quoted.length - groups.length === 17, { n: quoted.length - groups.length });
  check('A3 播报池含内置兜底原句（气息/落空 各至少含一句与 cjian.js 兜底一致）',
    lib.includes('可以感觉到一点熟悉的气息') && lib.includes('没有感觉到谁'));

  const tplSrc = readFileSync(join(root, 'src', 'template.html'), 'utf8');
  // v3.16.x：功能触发字卡已从「聊天默认字卡」拆到独立页 page-fun-cards（#fc-tabs），
  // 摸鱼/吃饭/经期/喝水/花园/同频/伸手/此间/房间/存钱罐/漂流瓶/互动回应 全量预置
  const fcTabs = (tplSrc.match(/<div class="card-tabs" id="fc-tabs">([\s\S]*?)<\/div>/) || [])[1] || '';
  const fcOrder = (fcTabs.match(/data-type="([^"]+)"/g) || []).map(s => s.replace(/data-type="/, '').replace(/"/, ''));
  const wantOrder = ['fish', 'eat', 'period', 'water', 'garden', 'sync', 'reach', 'cjian', 'room', 'piggy', 'drift', 'interact'];
  check('A4 功能类 tab 独立成页（#fc-tabs）且顺序正确（摸鱼…存钱罐，漂流瓶，互动回应末位）',
    fcOrder.join(',') === wantOrder.join(','), { fcOrder: fcOrder });
  check('A5 三类改名仍在（摸鱼/吃饭/经期 短标签）',
    /data-type="fish">摸鱼<\/button>[\s\S]*?data-type="eat">吃饭<\/button>[\s\S]*?data-type="period">经期<\/button>/.test(fcTabs));

  const cjSrc = readFileSync(join(root, 'src', 'js', 'cjian.js'), 'utf8');
  check('A6 cjian.js 感知播报接同源池：cjLine 助手 + getLibPool(cjian,group) + isDefaultCardOff 过滤，两处调用点',
    /function cjLine\(group,\s*fallbackArr\)/.test(cjSrc) &&
    /getLibPool\('cjian',\s*group/.test(cjSrc) &&
    /isDefaultCardOff && window\.isDefaultCardOff\('cjian',\s*t\)/.test(cjSrc) &&
    /cjLine\('感知·气息'/.test(cjSrc) && /cjLine\('感知·落空'/.test(cjSrc));
}

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

// 组装临时站点（文件清单从 build.mjs 提取，防手抄漂移）
const tmpSite = mkdtempSync(join(tmpdir(), 'mochi-cjian-lib-'));
const html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
let jsList = [], cssList = [];
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  const cm = bm.match(/cssFiles\s*=\s*\[([\s\S]*?)\]/);
  const jm = bm.match(/jsFiles\s*=\s*\[([\s\S]*?)\]/);
  const parseArr = (m) => (m ? [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]) : []);
  cssList = parseArr(cm); jsList = parseArr(jm);
  // 并行会话可能正在保存文件（截断态会让拼接页整包 JS 失效）——等待全部可解析再组装
  let okAll = false, broken = '';
  for (let i = 0; i < 30 && !okAll; i++) {
    broken = '';
    for (const f of jsList) {
      const p = join(root, 'src', 'js', f);
      try { if (spawnSync(process.execPath, ['--check', p]).status !== 0) { broken = f; break; } } catch (e) { broken = f; break; }
    }
    if (!broken) okAll = true; else { console.log('  [wait] ' + broken + ' 暂不可解析（并行会话写入中?），2s 后重试…'); await sleep(2000); }
  }
  if (!okAll) { console.error('src/js 存在持续无法解析的文件：' + broken + '（并行会话半成品？）'); process.exit(1); }
  const cssAll = cssList.map(f => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
  const jsAll = jsList.map((f) => {
    try { return readFileSync(join(root, 'src', 'js', f), 'utf8'); } catch (e) { return ''; }
  }).join('\n');
  if (!/DEFAULT_CARD_DATA\.cjian/.test(jsAll)) { console.error('JS 拼接缺少此间预设池'); process.exit(1); }
  writeFileSync(join(tmpSite, 'index.html'), html.replace('/*__STYLES__*/', () => cssAll).replace('/*__SCRIPTS__*/', () => jsAll));
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(tmpSite, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(tmpSite)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extnameOf(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
function extnameOf(p) { const b = p.split(/[\\/]/).pop() || ''; const i = b.lastIndexOf('.'); return i < 0 ? '' : b.slice(i); }
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 400));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(tmpdir(), 'mochi-cjian-lib-' + Date.now()),
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
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  JS异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').split('\n')[0]); return null; }
    return r ? r.result.value : null;
  } catch (e) { return null; }
}
await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2600);

// ---- B 组：运行时 UI 与联动 ----
// B1/B2/B3：字卡库【其他互动功能字卡】出现「此间」tab、渲染四组 17 张、单卡开关写入 dc-off-cjian
await evalJs("(function(){var li=document.getElementById('li-fun-cards');document.querySelectorAll('.page').forEach(function(p){p.hidden=true;});if(li)li.click();return 1;})()");
await sleep(700);
// B0 入口角标动态化——「聊天默认字卡」角标=四大基础分类总数；
// 「其他互动功能字卡」角标=功能分类总数（动态统计，不再写死 3260）
const badge = JSON.parse(await evalJs(`(function(){
  var D=window.DEFAULT_CARD_DATA||{};
  var BASE=['main','kaomoji','emoji','touch'];
  var FUNC=['fish','eat','period','water','garden','sync','reach','cjian','room','piggy','drift','interact'];
  function sum(keys){var n=0;keys.forEach(function(k){(D[k]||[]).forEach(function(g){n+=(g[1]||[]).length;});});return n;}
  var el=document.querySelector('#li-default-cards .t');
  var fel=document.getElementById('fc-lib-count');
  return JSON.stringify({badge:el?el.textContent:'',base:sum(BASE),funBadge:fel?fel.textContent:'',fun:sum(FUNC)});
})()`) || '{}');
check('B0 两个入口角标分别=基础/功能分类实际总数（动态统计，不再写死 3260）',
  badge.badge === String(badge.base) && Number(badge.base) > 4000 &&
  badge.funBadge === String(badge.fun) && Number(badge.fun) > 500, badge);
const tabInfo = JSON.parse(await evalJs(`(function(){
  var b=document.querySelector('#fc-tabs [data-type="cjian"]');
  if(!b)return JSON.stringify({has:false});
  document.querySelectorAll('#fc-tabs .cc-tab').forEach(function(t){t.classList.remove('sel');});
  b.classList.add('sel');b.click();
  return JSON.stringify({has:true,label:b.textContent});
})()`) || '{}');
check('B1 【其他互动功能字卡】出现「此间」tab 且可点击', tabInfo.has && tabInfo.label === '此间', tabInfo);
await sleep(600);
const grp = JSON.parse(await evalJs(`(function(){
  var hs=[].slice.call(document.querySelectorAll('#fc-list .cc-group-header'));
  return JSON.stringify({names:hs.map(function(h){return (h.querySelector('.ccg-name')||{}).textContent||'';}),
    counts:hs.map(function(h){return (h.querySelector('.ccg-count')||{}).textContent||'';}),
    items:document.querySelectorAll('#fc-list .cc-item').length});
})()`) || '{}');
check('B2 「此间」tab 渲染四组 17 张（在场感知5/空闲状态6/感知·气息4/感知·落空2）',
  grp.names.join(',') === '在场感知,空闲状态,感知·气息,感知·落空' && grp.counts.join(',') === '5,6,4,2' && grp.items === 17,
  grp);
const tog = JSON.parse(await evalJs(`(function(){
  try{
    var it=[].slice.call(document.querySelectorAll('#fc-list .cc-item')).find(function(x){return (x.textContent||'').indexOf('没有感觉到谁')>=0;});
    if(!it)return JSON.stringify({err:'no-item'});
    var input=it.querySelector('input');
    input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));
    var offKey='dc-off-cjian:'+decodeURIComponent('%E6%B2%A1%E6%9C%89%E6%84%9F%E8%A7%89%E5%88%B0%E8%B0%81');
    var vOff=localStorage.getItem('xy-home-v2:default:'+offKey);
    input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));
    var vOn=localStorage.getItem('xy-home-v2:default:'+offKey);
    return JSON.stringify({off:vOff,on:vOn});
  }catch(e){return JSON.stringify({err:String(e)});}
})()`) || '{}');
check('B3 单卡开关写入 dc-off-cjian 键（关=1/开=0）', tog.off === '1' && tog.on === '0', tog);

// ---- C 组：感应播报同源抽取 + 逐张开关联动 + 全关回退兜底 ----
// 种子：default 桌一个梦角「测试梦角」，状态钉在 near（必进近旁分支）
const seed = await evalJs(`(function(){
  try{
    var st=window.storeFor('default');
    st.set('cjian-roster',JSON.stringify([{id:'d1',name:'测试梦角',offsetMin:0}]));
    var now=Date.now();
    st.set('cjian-state',JSON.stringify({d1:{p:'near',a:'free',sinceP:now,sinceA:now,cdP:40*60000,cdA:20*60000}}));
    window.openCjian();
    return 'seeded';
  }catch(e){return String(e);}
})()`);
await sleep(400);
check('C0 种子就绪（名单+状态+打开此间）', seed === 'seeded', seed);

// C1 池同源：改小「感知·气息」池为单一探针句 → 感应输出应使用它
const c1 = await evalJs(`(function(){
  try{
    var g=window.DEFAULT_CARD_DATA.cjian.find(function(x){return x[0]==='感知·气息';});
    g[1].length=0;g[1].push('TEST气息句');
    var r=window.cjianPerceive();
    return JSON.stringify({hit:(r.lines||[]).some(function(l){return l==='「测试梦角」\\nTEST气息句';}),lines:r.lines});
  }catch(e){return JSON.stringify({err:String(e)});}
})()`);
const c1p = JSON.parse(c1 || '{}');
check('C1 感应播报走库内池（输出=「测试梦角」+探针句）', c1p.hit === true, c1p);

// C2 逐张关闭联动：关掉探针句 → 输出回退到内置兜底句（池过滤后为空 → fallbackArr）
await sleep(4300); // 感应 4s 冷却
const c2 = await evalJs(`(function(){
  try{
    window.storeFor('default').set('dc-off-cjian:TEST气息句','1');
    var r=window.cjianPerceive();
    return JSON.stringify({lines:r.lines,fallbackHit:(r.lines||[]).indexOf('「测试梦角」\\n可以感觉到一点熟悉的气息。')>=0,testLeft:(r.lines||[]).some(function(l){return l.indexOf('TEST气息句')>=0;})});
  }catch(e){return JSON.stringify({err:String(e)});}
})()`);
const c2p = JSON.parse(c2 || '{}');
check('C2 关掉该卡后不再抽到，回退内置兜底句', c2p.fallbackHit === true && c2p.testLeft === false, c2p);

// C3 落空分支同源：梦角状态钉 far + Math.random 驯化 0.99（40% 远旁判定必不中）→ 走「感知·落空」池
await sleep(4300);
const c3 = await evalJs(`(function(){
  try{
    var g=window.DEFAULT_CARD_DATA.cjian.find(function(x){return x[0]==='感知·落空';});
    g[1].length=0;g[1].push('TEST落空句');
    var stJson=JSON.parse(window.storeFor('default').get('cjian-state'));
    stJson.d1.p='far';stJson.d1.sinceP=Date.now();
    window.storeFor('default').set('cjian-state',JSON.stringify(stJson));
    var _r=Math.random;Math.random=function(){return 0.99;};
    var r;try{r=window.cjianPerceive();}finally{Math.random=_r;}
    return JSON.stringify({first:r.lines&&r.lines[0],ok:r.lines&&r.lines[0]==='TEST落空句'});
  }catch(e){return JSON.stringify({err:String(e)});}
})()`);
const c3p = JSON.parse(c3 || '{}');
check('C3 无所感觉时走「感知·落空」池（首行=探针句）', c3p.ok === true, c3p);

const pass = results.filter(r => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 项通过');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
try { rmSync(tmpSite, { recursive: true, force: true }); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);
