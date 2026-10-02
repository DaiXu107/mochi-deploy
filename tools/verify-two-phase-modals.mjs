// ===== 专项：两阶段弹窗重构（存钱罐 存入/取出/小心愿 + 记账分类管理） =====
// 用法：node tools/verify-two-phase-modals.mjs
// 背景：旧「60ms 后再开第二层 openModal」嵌套写法在真机键盘收起/再聚焦竞态下
// 第二层无法输入（红包/市集钱包弹窗同族问题）。openModal 新增控制器 ctl
// （stay/title/hint/text/pills/input/okText…），各流程改为同一弹窗内就地切阶段。
// 验证：自组装临时站点跑真实 UI（页面隐藏不影响 DOM 监听器），逐阶段断言。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
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

// ---- A 组：静态断言 ----
{
  const p2 = readFileSync(join(root, 'src', 'js', 'p2-features.js'), 'utf8');
  const acc = readFileSync(join(root, 'src', 'js', 'accounting.js'), 'utf8');
  check('A1 存钱罐三个流程均改为 ctl.stay 两阶段（不再嵌套第二层）',
    (p2.match(/ctl\.stay\(\)/g) || []).length >= 3);
  check('A2 记账 manageCats 同款重构', (acc.match(/ctl\.stay\(\)/g) || []).length >= 1 && /ctl\.pills\(null\)/.test(acc));
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

const tmpSite = mkdtempSync(join(tmpdir(), 'mochi-twophase-'));
const html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
let outHtml = '';
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  const cm = bm.match(/cssFiles\s*=\s*\[([\s\S]*?)\]/);
  const jm = bm.match(/jsFiles\s*=\s*\[([\s\S]*?)\]/);
  const parseArr = (m) => (m ? [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]) : []);
  const cssFiles = parseArr(cm), jsFiles = parseArr(jm);
  if (!cssFiles.length || !jsFiles.length) { console.error('无法从 build.mjs 解析文件清单'); process.exit(1); }
  const cssAll = cssFiles.map(f => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
  const jsAll = jsFiles.map((f) => {
    try { return readFileSync(join(root, 'src', 'js', f), 'utf8'); } catch (e) { return ''; }
  }).join('\n');
  outHtml = html.replace('/*__STYLES__*/', () => cssAll).replace('/*__SCRIPTS__*/', () => jsAll);
}
writeFileSync(join(tmpSite, 'index.html'), outHtml);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(tmpSite, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(tmpSite)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[ext(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
function ext(p) { const i = p.lastIndexOf('.'); return i < 0 ? '' : p.slice(i); }
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-twophase-' + Date.now()),
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
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) {
      console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2200);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(2300);
await evalJs("(function(){var m=document.getElementById('cc-scope-mask');if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();}return true;})()");
await sleep(400);

async function modalSnap() {
  return JSON.parse(await evalJs(`(function(){
    var mask=document.getElementById('modal-mask'),t=document.getElementById('modal-title'),
        inp=document.getElementById('modal-input'),ok=document.getElementById('modal-ok'),
        pl=document.getElementById('modal-pills');
    var pills=[].map.call(pl&&pl.querySelectorAll('.pill')||[],function(p){return p.textContent;});
    return JSON.stringify({open:!!(mask&&!mask.hidden),title:t?t.textContent:'',val:(inp&&inp.value)||'',
      inpHidden:!!(inp&&inp.hidden),okTxt:ok?ok.textContent:'',pillsHidden:!!(pl&&pl.hidden),pills:pills});
  })()`));
}
async function clickById(id) { await evalJs(`(function(){var b=document.getElementById('${id}');if(b)b.click();return true;})()`); await sleep(300); }
async function typeIn(s) { await evalJs(`(function(){var i=document.getElementById('modal-input');i.value='';i.value=${JSON.stringify(s)};return true;})()`); }
async function pillByText(txt) {
  await evalJs(`(function(){var ps=document.querySelectorAll('#modal-pills .pill');for(var i=0;i<ps.length;i++){if(ps[i].textContent===${JSON.stringify(txt)}){ps[i].click();break;}}return true;})()`);
}
async function okBtn() { await evalJs("(function(){var b=document.getElementById('modal-ok');if(b)b.click();return true;})()"); await sleep(250); }
async function lsGet(k) { return evalJs(`(function(){try{return localStorage.getItem(${JSON.stringify(k)});}catch(e){return null;}})()`); }

console.log('== 存钱罐 ==');
// P1 存入：金额 → 留言（同弹窗两阶段）
await clickById('piggy-in');
let m = await modalSnap();
check('P1a 打开存入弹窗（阶段一）', m.open && m.title === '存入金额（元）' && !m.inpHidden, m);
await typeIn('88.5');
await okBtn();
m = await modalSnap();
check('P1b 金额确认后不关窗，就地切到留言阶段', m.open && /跟TA说一句/.test(m.title) && m.val === '' && m.okTxt === '存入', m);
await typeIn('加油');
await okBtn();
m = await modalSnap();
let log = JSON.parse(await lsGet('xy-home-v2:piggy-log') || '[]');
check('P1c 留言确认后关闭并入账（含留言）', !m.open && log.length === 1 && log[0].type === 'in' && log[0].amt === 88.5 && log[0].note === '加油', { log });

// P2 取出：跳过留言直接取
await clickById('piggy-out');
await typeIn('30');
await okBtn();
m = await modalSnap();
check('P2a 取出进入用途阶段', m.open && /用在哪啦/.test(m.title) && m.okTxt === '取出', m);
await okBtn(); // 不填用途直接取出
m = await modalSnap();
log = JSON.parse(await lsGet('xy-home-v2:piggy-log') || '[]');
check('P2b 跳过留言直接取出成功', !m.open && log.length === 2 && log[1].type === 'out' && log[1].amt === 30, { log });

// P3 小心愿：名称 → 目标金额 → 监督人 chips（页内）
await clickById('piggy-set-goal');
await typeIn('一起去看海');
await okBtn();
m = await modalSnap();
check('P3a 心愿名确认后切到目标金额阶段', m.open && m.title === '目标金额（元）' && m.okTxt.indexOf('下一步') === 0, m);
await typeIn('5000');
await okBtn();
m = await modalSnap();
const shareShown = await evalJs("(function(){var b=document.getElementById('piggy-share');return !!(b&&!b.hidden);})()");
check('P3b 目标金额确认后弹窗关闭、监督人选择（页内 chips）出现', m.open === false && shareShown === true, { m, shareShown });
await evalJs("(function(){var b=document.getElementById('piggy-share');if(b)b.hidden=true;return true;})()");

console.log('== 记账 分类管理 ==');
// A组 加分类
await clickById('acc-cog');
m = await modalSnap();
check('A1a 分类管理阶段一：四个动作胶囊', m.open && m.pills.length === 4 && m.pillsHidden === false && m.inpHidden === true, m);
await pillByText('添加支出分类');
await okBtn();
m = await modalSnap();
check('A1b 同弹窗切换为输入阶段（胶囊隐藏、输入框出现）',
  m.open && /添加支出分类/.test(m.title) && !m.inpHidden && m.pillsHidden === true && m.okTxt === '添加', m);
await typeIn('宠物');
await okBtn();
m = await modalSnap();
let cats = JSON.parse(await lsGet('xy-home-v2:default:accounting-categories') || 'null');
check('A1c 添加成功并关闭（cats 含「宠物」）', !m.open && !!cats && cats.expense.indexOf('宠物') >= 0, cats && cats.expense);

// A组 删分类（含被占用守卫）
await clickById('acc-cog');
await pillByText('删除支出分类');
await okBtn();
m = await modalSnap();
check('A2a 删除阶段：输入框隐藏、分类胶囊列表出现',
  m.open && /选择要删除的支出分类/.test(m.title) && m.inpHidden === true && !m.pillsHidden && m.pills.indexOf('餐饮') >= 0, m);
await pillByText('宠物');
await okBtn();
m = await modalSnap();
cats = JSON.parse(await lsGet('xy-home-v2:default:accounting-categories') || 'null');
check('A2b 删除「宠物」成功并关闭', !m.open && cats.expense.indexOf('宠物') < 0, cats.expense);

// A3 被占用守卫：给「餐饮」种一条记录后删除应被拦截
await evalJs(`(function(){
  try{
    localStorage.setItem('xy-home-v2:default:accounting-records',JSON.stringify([{id:'t1',type:'expense',amount:12,category:'餐饮',note:'',date:'2026-08-25',time:Date.now()}]));
  }catch(e){}
  return true;
})()`);
await clickById('acc-cog');
await pillByText('删除支出分类');
await okBtn();
await pillByText('餐饮');
await okBtn();
const toastTxt = await evalJs("(function(){var t=document.getElementById('cc-toast');return t?t.textContent:'';})()");
cats = JSON.parse(await lsGet('xy-home-v2:default:accounting-categories') || 'null');
check('A3 有记录的分类删除被拦截且保留', /有记录，无法删除/.test(toastTxt || '') && cats.expense.indexOf('餐饮') >= 0, { toastTxt, e: cats.expense });
await evalJs("(function(){var b=document.getElementById('modal-cancel');if(b)b.click();return true;})()");

const pass = results.filter(r => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 项通过');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);
