// ===== 专项回归：#500 三级链（情绪/心意/交流意图）单卡开关 =====
//   用户反馈「手动关闭没有用，会频繁使用」：心意卡与交流意图卡在字卡库里没有列表
//   ＝没有关闭入口，且三类共用 mc-off-mood 键（同名卡互相误伤）。
//   本脚本断言：三类分栏可见可切、逐张关闭生效、同名跨类不互相误伤、旧键兼容。
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
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css', 'drift-bottle.css'];
const jsFiles = ['device.js', 'idb.js', 'contacts.js', 'card-lock.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'ta-mood-data.js', 'ta-mood.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'mobile-adapt.js'];
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => '(function () { try {\n' + readFileSync(join(root, 'src/js', f), 'utf8') + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} } })();').join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-test-build').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-moodoff-root-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-moodoff-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
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
if (!ws) { console.error('无法连接调试端口'); process.exit(1); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}
// 抽 n 次，统计某类字卡是否出现过指定内容
const DRAW = `var DRAW = function (type, target, n) {
  var hit = 0, any = 0;
  for (var k = 0; k < n; k++) {
    var c = window.triggerEmotionChain();
    if (!c) continue;
    for (var j = 0; j < c.length; j++) {
      if (type === 'heart' && (c[j].type === 'heart')) { any++; if (c[j].content === target) hit++; }
      if (type === 'intent' && (c[j].type === 'intent')) { any++; if (c[j].content === target) hit++; }
      if (type === 'mood' && (c[j].type === 'mood')) { any++; if (c[j].content === target) hit++; }
    }
  }
  return { hit: hit, any: any };
};`;
try {
  await cdp('Runtime.enable'); await cdp('Page.enable');
  const jsErrors = [];
  const rawHandler = ws.onmessage;
  ws.onmessage = (m) => {};
  ws.onmessage = (evt) => {
    const m = JSON.parse(evt.data);
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(JSON.stringify(m.params).slice(0, 200));
    if (rawHandler) rawHandler(evt);
  };
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4500);

  console.log('\n== A 三类分栏 UI ==');
  const a1 = await ev("(function(){var bar=document.getElementById('mc-type-bar');return {bar:!!bar,chips:bar?bar.children.length:0,names:bar?Array.from(bar.children).map(function(c){return c.textContent;}):[]};})()");
  ok('A1 三类分栏存在且为情绪/心意/交流意图', a1 && a1.chips === 3 && a1.names.join(',') === '情绪,心意,交流意图', a1);

  const a2 = await ev("(function(){var bar=document.getElementById('mc-type-bar');bar.children[1].click();var items=document.querySelectorAll('#mc-list .cc-item');var t=document.getElementById('mc-group-title').textContent;return {title:t,items:items.length,toggles:document.querySelectorAll('#mc-list input[type=checkbox]').length};})()");
  ok('A2 切到「心意」后有卡片列表与单卡开关（此前为 0＝无入口）', a2 && a2.items > 0 && a2.toggles === a2.items && a2.title === '心意分组', a2);

  const a3 = await ev("(function(){var bar=document.getElementById('mc-type-bar');bar.children[2].click();var items=document.querySelectorAll('#mc-list .cc-item');var t=document.getElementById('mc-group-title').textContent;var ph=document.getElementById('mc-search-input').placeholder;return {title:t,items:items.length,toggles:document.querySelectorAll('#mc-list input[type=checkbox]').length,ph:ph};})()");
  ok('A3 切到「交流意图」后有卡片列表与单卡开关', a3 && a3.items > 0 && a3.toggles === a3.items && a3.title === '交流意图分组', a3);

  const a4 = await ev("(function(){var g=[];var t=MOOD_FOLLOWUP_DATA;[['heart',t.heart.length],['intent',t.intent.length],['mood',t.mood.length]].forEach(function(x){g.push(x);});return {counts:g};})()");
  ok('A4 三类数据齐备（情绪/心意/交流意图分组数）', a4 && a4.counts[0][1] === 9 && a4.counts[1][1] === 8 && a4.counts[2][1] === 11, a4);

  console.log('\n== B 逐张关闭生效（三类各测）==');
  const b1 = await ev("(function(){" + DRAW + "var ls=window.activeStore();ls.set('mc-enabled','1');ls.set('mh-mood','1');ls.set('mh-heart','1');ls.set('mh-intent','1');var before=DRAW('heart','陪伴',2500);ls.set('mc-off-heart:陪伴','1');var after=DRAW('heart','陪伴',2500);return {before:before,after:after};})()");
  ok('B1 心意卡关闭后不再被抽（关闭前命中>0、关闭后=0）', b1 && b1.before.hit > 0 && b1.after.hit === 0, b1);

  const b2 = await ev("(function(){" + DRAW + "var ls=window.activeStore();ls.set('mc-off-heart:陪伴','0');var before=DRAW('intent','回应你',2500);ls.set('mc-off-intent:回应你','1');var after=DRAW('intent','回应你',2500);return {before:before,after:after};})()");
  ok('B2 交流意图卡关闭后不再被抽', b2 && b2.before.hit > 0 && b2.after.hit === 0, b2);

  console.log('\n== C 跨类隔离（同名卡不再互相误伤）==');
  const c1 = await ev("(function(){" + DRAW + "var ls=window.activeStore();ls.set('mc-off-intent:回应你','0');var has=MOOD_FOLLOWUP_DATA.mood.some(function(g){return g.cards.some(function(c){return c.content==='想念';});});var hasHeart=MOOD_FOLLOWUP_DATA.heart.some(function(g){return g.cards.some(function(c){return c.content==='想念';});});ls.set('mc-off-mood:想念','1');var h=DRAW('heart','想念',2500);var m=DRAW('mood','想念',2500);return {hasMood:has,hasHeart:hasHeart,heart:h,mood:m};})()");
  ok('C1 关掉情绪卡「想念」后，心意同名卡仍可抽（旧实现两者共键＝一起消失）', c1 && c1.hasMood && c1.hasHeart && c1.heart.hit > 0, c1);
  ok('C2 同一时刻情绪卡「想念」确实被关停', c1 && c1.mood.hit === 0, c1 && c1.mood);

  console.log('\n== D 旧键兼容（存量关闭不复活）==');
  const d1 = await ev("(function(){" + DRAW + "var ls=window.activeStore();ls.set('mc-off-mood:想念','0');var onlyHeart='分享';var inMood=MOOD_FOLLOWUP_DATA.mood.some(function(g){return g.cards.some(function(c){return c.content===onlyHeart;});});ls.set('mc-off-heart:'+onlyHeart,'');ls.set('mc-off-mood:'+onlyHeart,'1');var r=DRAW('heart',onlyHeart,2500);return {inMood:inMood,hit:r.hit,any:r.any};})()");
  ok('D1 旧键 mc-off-mood:<无同名情绪卡> 仍能关停心意卡（存量关闭不复活）', d1 && d1.inMood === false && d1.hit === 0 && d1.any > 0, d1);

  console.log('\n== E 整类总开关 ==');
  const e1 = await ev("(function(){" + DRAW + "var ls=window.activeStore();ls.set('mc-off-mood:'+'分享','0');var el=document.getElementById('mc-enabled');el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));var h=DRAW('heart','陪伴',300);var i=DRAW('intent','回应你',300);var m=DRAW('mood','开心',300);var rc=window.getReplyCard()||'';var tm=window.tryTaMoodShare()||null;return {heart:h.any,intent:i.any,mood:m.any};})()");
  ok('E1 关掉「使用情绪字卡」后三类全停', e1 && e1.heart === 0 && e1.intent === 0 && e1.mood === 0, e1);

  const e2 = await ev("(function(){var ls=window.activeStore();var el=document.getElementById('mc-enabled');el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));return {mc:ls.get('mc-enabled'),mood:ls.get('mh-mood'),heart:ls.get('mh-heart'),intent:ls.get('mh-intent')};})()");
  ok('E2 重开后三类键同步为 1', e2 && e2.mood === '1' && e2.heart === '1' && e2.intent === '1', e2);

  console.log('\n== F 锁定态下仍可用（#499 豁免不回退）==');
  const f1 = await ev("(function(){ if(window.cardLockRelock) window.cardLockRelock(); var locked=!(window.cardLockOpen&&window.cardLockOpen()); var got=0; for(var k=0;k<25;k++){ if(window.triggerEmotionChain()) got++; } var rc=0; for(var j=0;j<40;j++){ if(window.getReplyCard()) rc++; } return {locked:locked, chainCalls:got, rcCalls:rc}; })()");
  ok('F1 锁定态情绪链与回应字卡照常触发（#499 豁免不回退）', f1 && f1.locked === true && f1.chainCalls > 0 && f1.rcCalls > 0, f1);

  console.log('\n== G 零 JS 异常 ==');
  ok('G1 加载至今无未捕获异常', jsErrors.length === 0, jsErrors.slice(0, 3));
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
console.log('\n===== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
