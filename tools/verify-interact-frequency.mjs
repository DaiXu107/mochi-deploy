// ===== 专项：互动卡整体降频第二轮（ta-ask.js / ck-question.js v3.13.x） =====
// 用户反馈「联系人发互动卡片的频率还是太高」：
//   根因① v3.12.x 只降了代码默认概率——设置对象一旦保存就固化旧值，老设备从不跟随新默认；
//   根因② v3.12.x 说好的「吐槽同步降半」漏改（默认还是 15）；
//   根因③ 五类互动卡（询问/小问题/好奇/吐槽/查岗）各自独立计时，冷却互不相干，叠加仍显密集。
// 修复：全局闸门（任一互动卡发出后 60 分钟内其余类型不再自动触发）+ 存量概率一次性迁移
//       （历史默认值 → 5%，自定义值不动）+ 默认概率统一降到 5%（查岗兜底 15→8 对齐 reply-settings）。
//
// 用例：
//   S1 存量迁移：询问库存旧默认 prob=20 → 触发一次 Load 后吸附为 5 且打标记
//   S2 存量迁移（吐槽）：旧默认 prob=30 → 吸附为 5
//   S3 自定义保留：小问题库 prob=42（用户自定义）→ 迁移后保持 42 不动
//   S4 新装默认：清库后手动触发 → 四类库 settings.prob 均为 5（新默认）
//   S5 全局闸门·查岗端到端：清闸门 → ckQuestionTry(prob=100) 命中并标记闸门；
//      紧接第二次同类调用被闸门拦截；把闸门时间戳拨回 61 分钟前 → 放行
//   S6 闸门探针：__interactGateInfo() open/waitMs 随时间戳正确翻转
//   S7 源码静态断言：四类 maybeTrigger 均接闸门 + migrateInteractProb 四个库都接入 + 构建产物含闸门
//   S8 加载至今无未捕获异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
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
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-interactfreq-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' —— ' + JSON.stringify(extra) : '')); }
}

// 读某互动卡库 settings 的探针表达式
const readSettings = (key) => `(function(){ try { var d=JSON.parse(window.activeStore().get('${key}')||'null')||{}; return d.settings||{}; } catch(e){ return {}; } })()`;
// 种入某库 settings（保留其他字段）
const seedSettings = (key, patch) => `(function(){ try {
  var s=window.activeStore(); var d={}; try{ d=JSON.parse(s.get('${key}')||'{}')||{}; }catch(e){ d={}; }
  d.settings=Object.assign({}, d.settings||{}, ${JSON.stringify(patch)});
  s.set('${key}', JSON.stringify(d)); return true; } catch(e){ return String(e); } })()`;

try {
  await cdpConnect();
  const jsErrors = [];
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  const rawHandler = ws.onmessage;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(JSON.stringify(m.params).slice(0, 200));
    if (rawHandler) rawHandler(ev);
  };

  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4500); // 等开屏/数据就绪

  console.log('\n== S1/S2/S3 存量概率迁移 ==');
  // FIX（#164 脚本侧）：种前先清四库——页面初始化偶发会先把带 probLowV313=true 标记的默认
  // settings 落盘（时序竞态），Object.assign 种子合并会保留旧标记，迁移函数见标记即跳过，
  // 导致「flag 已打但 prob 未吸附」的假阳性抖动。清库后种子即「无标记的存量老设备」，语义不变。
  await evalJs("(function(){ var s=window.activeStore(); ['ta-ask','ta-choose','ta-curious','ta-roast'].forEach(function(k){ s.set(k,''); }); return true; })()");
  // 关掉自动弹窗避免测试期间抢焦点；种入旧默认值 / 自定义值
  await evalJs(seedSettings('ta-ask', { enabled: true, prob: 20, popupProb: 0 }));
  await evalJs(seedSettings('ta-roast', { enabled: true, prob: 30, popupProb: 0 }));
  await evalJs(seedSettings('ta-choose', { enabled: true, prob: 42, popupProb: 0 }));
  // 手动触发一次让 taAskLoad/trLoad 跑迁移（顺带断言卡片照常入聊天）
  await evalJs("window.activeStore().set('interact-card-last','0'); window.triggerTaAskNow(); true");
  await evalJs('window.triggerTaRoastNow(); true');
  await sleep(300);
  const askS = await evalJs(readSettings('ta-ask'));
  ok('询问：旧默认 prob=20 吸附为 5 且打迁移标记', askS && askS.prob === 5 && askS.probLowV313 === true, askS);
  const trS = await evalJs(readSettings('ta-roast'));
  ok('吐槽：旧默认 prob=30 吸附为 5（v3.12.x 漏改补上）', trS && trS.prob === 5 && trS.probLowV313 === true, trS);
  const tcS = await evalJs(readSettings('ta-choose'));
  ok('小问题：自定义 prob=42 保持不动', tcS && tcS.prob === 42, tcS);

  console.log('\n== S4 新装默认（清库后触发即建 settings）==');
  await evalJs("(function(){ var s=window.activeStore(); ['ta-ask','ta-choose','ta-curious','ta-roast'].forEach(function(k){ s.set(k,''); }); s.set('interact-card-last','0'); return true; })()");
  await evalJs("window.triggerTaAskNow(); window.triggerTaChooseNow(); window.triggerTaCuriousNow(); window.triggerTaRoastNow(); true");
  await sleep(300);
  const fresh = {};
  for (const k of ['ta-ask', 'ta-choose', 'ta-curious', 'ta-roast']) fresh[k] = await evalJs(readSettings(k));
  ok('新装四类库默认概率均为 5%', ['ta-ask', 'ta-choose', 'ta-curious', 'ta-roast'].every((k) => fresh[k] && fresh[k].prob === 5), fresh);

  console.log('\n== S5/S6 全局闸门 ==');
  await evalJs("window.activeStore().set('interact-card-last','0'); true");
  const g1 = await evalJs("window.ckQuestionTry({ 'ckq-en': 1, 'ckq-prob': 100, 'ckq-cool': 0, 'ckq-popup-prob': 0 })");
  const gi1 = await evalJs('window.__interactGateInfo()');
  ok('查岗命中推卡并标记闸门（返回 true）', g1 === true, g1);
  ok('闸门已关（open=false · waitMs>0 · lastAt 刚刚）', gi1 && gi1.open === false && gi1.waitMs > 55 * 60000, gi1);
  const g2 = await evalJs("window.ckQuestionTry({ 'ckq-en': 1, 'ckq-prob': 100, 'ckq-cool': 0, 'ckq-popup-prob': 0 })");
  ok('60 分钟窗口内同类型再触发被闸门拦截（返回 false）', g2 === false, g2);
  await evalJs(`(function(){ var s=window.activeStore(); s.set('interact-card-last', String(Date.now() - 61*60000)); return true; })()`);
  const gi2 = await evalJs('window.__interactGateInfo()');
  const g3 = await evalJs("window.ckQuestionTry({ 'ckq-en': 1, 'ckq-prob': 100, 'ckq-cool': 0, 'ckq-popup-prob': 0 })");
  ok('拨回 61 分钟前后闸门放行（open=true · 再次命中）', gi2 && gi2.open === true && g3 === true, { gi2, g3 });

  console.log('\n== S7 源码静态断言 ==');
  const taSrc = readFileSync(join(root, 'src/js/ta-ask.js'), 'utf8');
  const ckSrc = readFileSync(join(root, 'src/js/ck-question.js'), 'utf8');
  const gateCalls = (taSrc.match(/if \(!interactGateOk\(\)\) return;/g) || []).length;
  // FIX（#164 脚本侧）：同频 cc 互动卡（maybeTriggerTACC）加入后全局闸门接入点 4→5，断言随之更新
  ok('ta-ask.js 五类 maybeTrigger 均接全局闸门（5 处）', gateCalls === 5, { gateCalls });
  ok('ta-ask.js 四个库均接入存量迁移且旧默认值映射正确',
    taSrc.includes('migrateInteractProb(d, KEY, [20, 10])') &&
    taSrc.includes('migrateInteractProb(d, KEY2, [15, 8])') &&
    taSrc.includes('migrateInteractProb(d, KEY3, [15, 8])') &&
    taSrc.includes('migrateInteractProb(d, KEY4, [30, 15])'));
  ok('ck-question.js 接闸门 + 兜底概率对齐 8', ckSrc.includes('window.interactGateOk') && /let prob = 8;/.test(ckSrc));
  const built = readFileSync(join(root, 'index.html'), 'utf8');
  ok('构建产物包含全局闸门与迁移逻辑', built.includes('INTERACT_GATE_MS') && built.includes('probLowV313'));

  console.log('\n== S8 无未捕获异常 ==');
  ok('加载至今无未捕获异常', jsErrors.length === 0, jsErrors.slice(0, 3));

} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
