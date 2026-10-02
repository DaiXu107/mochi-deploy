// 跨桌面串名串档行为断言（#349）：游戏面板的存储键必须【每次读写动态取当前桌面】，
// 不得在模块加载时冻结桌面 cid（snake 标题昵称/战绩/最高分/存档 + pong 存档）。
// 用法：node tools/verify-snake-desktop-keys.mjs [页面.html]（默认 index.html，需先构建；
//      也可喂临时拼装页做免构建验证——拼装页需在 snake.js 之前注入 activePrefix/activeStore 桩）。
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const target = process.argv[2] || 'index.html';
let url = target;
if (!/^https?:/.test(target)) {
  const { pathToFileURL } = await import('url');
  url = pathToFileURL(target).href;
}
const src = readFileSync(target, 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

// S 静态锚：冻结键必须绝迹、动态键函数必须在位（pong 项仅当目标含 pong 源码才有意义）
check('S1 贪吃蛇不再有加载时冻结的 PARTNER_KEY', !/const PARTNER_KEY/.test(src));
check('S2 乒乓不再有加载时冻结的 SAVE_KEY', !/const SAVE_KEY = \(window\.activePrefix/.test(src));
check('S3 贪吃蛇动态桌面键函数在位', /function keyScore\(\) \{ return prefix\(\) \+ ':snake-score'; \}/.test(src));
if (/window\.openPongPanel/.test(src)) {
  check('S4 乒乓存档动态键函数在位（仅真实产物含 pong 源码时核）', /function saveKey\(\) \{ return \(window\.activePrefix && window\.activePrefix\(\) \|\| 'xy-home-v2'\) \+ ':pong-saved'; \}/.test(src));
}

await page.goto(url);
await page.waitForFunction(() => typeof window.openSnakePanel === 'function', null, { timeout: 15000 });
// 真实产物启动引导（临时拼装页两步自动跳过）
await page.evaluate(() => { try { const s = document.getElementById('splash'); if (s) s.click(); } catch (e) {} });
await page.waitForTimeout(800);
// 命名空间桩：临时拼装页已在页内注入；真实产物页内现装（仅本测试会话内存态，不落盘）
await page.evaluate(() => {
  if (window.__setCid) return;
  window.__mockKv = {};
  window.__setCid = function (cid) {
    window.__activeCid = cid;
    window.activePrefix = function () { return 'xy-home-v2:' + cid; };
    window.activeStore = function () {
      return {
        get: function (k) { var v = window.__mockKv['xy-home-v2:' + cid + ':' + k]; return v === undefined ? null : v; },
        set: function (k, v) { window.__mockKv['xy-home-v2:' + cid + ':' + k] = v; },
        remove: function (k) { delete window.__mockKv['xy-home-v2:' + cid + ':' + k]; }
      };
    };
  };
  window.__setCid('cA');
});

// 桌面 A：昵称 + 战绩 + 最高分都种上；顶层留一个「串名残留」诱饵（旧顶层键不得被读到）
await page.evaluate(() => {
  window.__setCid('cA');
  window.__mockKv['xy-home-v2:cA:cs-lbl-partner'] = '小A';
  try {
    localStorage.setItem('xy-home-v2:cA:snake-score', JSON.stringify({ w: 5, l: 1, d: 2 }));
    localStorage.setItem('xy-home-v2:cA:snake-best', JSON.stringify({ normal: { score: 42, len: 13 } }));
    localStorage.setItem('xy-home-v2:lbl-partner', '串名残留');       // 旧顶层键诱饵
    localStorage.setItem('xy-home-v2:snake-best', '{"normal":{"score":1,"len":2}}'); // 旧顶层键诱饵
  } catch (e) {}
  window.openSnakePanel();
});
const a = await page.evaluate(() => ({
  name: document.getElementById('snake-partner-name').textContent,
  score: document.getElementById('snake-score').textContent,
  best: (function () { const b = document.getElementById('snake-best'); return b.hidden ? '' : b.textContent; })()
}));
check('A1 桌面A 标题显示本桌面昵称', a.name === '小A', a.name);
check('A2 桌面A 战绩读本桌面键', a.score.indexOf('胜 5') >= 0, a.score);
check('A3 桌面A 最高分读本桌面键（不吃顶层诱饵）', a.best.indexOf('42') >= 0, a.best);

// 切到桌面 B（无任何数据）：标题必须跟着 B、战绩/最高分不得再显示 A 的（旧冻结键实现在这里红）
await page.evaluate(() => {
  window.__setCid('cB');
  window.__mockKv['xy-home-v2:cB:cs-lbl-partner'] = '阿B';
  window.openSnakePanel();
});
const b = await page.evaluate(() => ({
  name: document.getElementById('snake-partner-name').textContent,
  score: document.getElementById('snake-score').textContent,
  best: (function () { const el = document.getElementById('snake-best'); return el.hidden ? '' : el.textContent; })()
}));
check('B1 切桌面后标题显示 B 昵称（不串 A）', b.name === '阿B', b.name);
check('B2 切桌面后战绩回到 B 自己的（空）', b.score.indexOf('胜 0') >= 0, b.score);
check('B3 切桌面后最高分不串 A 的 42 分（顶层遗留回退可见，A 桌面键不可见）', b.best.indexOf('42') < 0, b.best);

// 桌面 C（无任何数据）：读侧回退到无 cid 的顶层遗留键（最早版本数据不丢）
await page.evaluate(() => {
  window.__setCid('cC');
  try { localStorage.setItem('xy-home-v2:snake-best', JSON.stringify({ normal: { score: 99, len: 21 } })); } catch (e) {}
  window.openSnakePanel();
});
const c = await page.evaluate(() => {
  const el = document.getElementById('snake-best');
  return { best: el.hidden ? '' : el.textContent, name: document.getElementById('snake-partner-name').textContent };
});
check('C1 空桌面回退读到顶层遗留最高分', c.best.indexOf('99') >= 0, c.best);
check('C2 空桌面标题无昵称设置时显示 TA（不吃诱饵串名残留）', c.name === 'TA', c.name);

check('E0 全程零 JS 报错', errors.length === 0, errors.join(' | ').slice(0, 200));

await browser.close();
console.log('verify-snake-desktop-keys: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
