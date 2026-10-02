// #921 行为断言：后台通知「就绪即补发」队列（swNotifyLater）。
// 修前缺陷：单发闸 `if (swLaterTimer) return;` —— SW 未就绪等待窗（弱网/SW 被回收/刚更新完）
// 里到达的第 2 条及以后的通知被整条静默吞掉（不补发、chanOut 也不回报），
// 表现为「时不时收不到后台弹窗」、零机型分支、多设备同现。
// 本脚本从 src/js/bg-keep.js 按锚点截取 kaWithTimeout + swNotifyLater 队列实现，
// 在 vm 沙箱里用可控的 navigator.serviceWorker 桩真实执行，断言等待窗内每条都补发。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';

const root = process.env.MOCHI_BG_KEEP_ROOT
  ? path.resolve(process.env.MOCHI_BG_KEEP_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, process.env.MOCHI_BG_KEEP_FILE || 'src/js/bg-keep.js'), 'utf8');

function cut(fromAnchor, toAnchor) {
  const a = src.indexOf(fromAnchor);
  const b = src.indexOf(toAnchor, a);
  if (a < 0 || b < 0) throw new Error('锚点缺失: ' + fromAnchor + ' / ' + toAnchor);
  return src.slice(a, b);
}
const ka = cut('function kaWithTimeout(p, ms) {', 'function kaSWReady()');
const later = cut("let lastNotifyChannel = '';", 'function showSysNotification(');

let fails = 0;
function check(name, ok) {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name);
  if (!ok) fails++;
}

function makeSandbox(swStub, visState) {
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Error, Date, JSON, Object,
    navigator: swStub,
    window: {},
    document: {
      // #1291：补发只在「页面仍隐藏」时执行——回前台后才就绪的那一批按新契约作废，
      //   所以可见性必须可控（默认 hidden＝#921 原始场景：SW 掉线期间用户在后台）
      visibilityState: visState || 'hidden',
      addEventListener: function () {},
      getElementById: function () { return null; }
    },
  };
  vm.createContext(sandbox);
  const code = ka + '\n' + later + '\nthis.__api = { swNotifyLater, getLast: function(){ return lastNotifyChannel; } };';
  vm.runInContext(code, sandbox);
  return sandbox.__api;
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// S1 源级：单发闸若还存在，必须在入队之后（先 push 再挂闸＝防重复定时器；先 return＝吞通知）
  const fnA = src.indexOf('function swNotifyLater(title, opts, chanOut) {');
  const fnB = src.indexOf('\n  function ', fnA + 10);
  const body = fnA >= 0 && fnB > fnA ? src.slice(fnA, fnB) : '';
  const iP = body.indexOf('swLaterQueue.push(');
  const iG = body.indexOf('if (swLaterTimer) return;');
  check('S1 单发闸（若在）不得先于入队（修前形态＝等待窗内后续通知整条吞）',
    iP >= 0 && (iG < 0 || iG > iP));
check('S2 存在队列容器 swLaterQueue', src.indexOf('swLaterQueue.push(') >= 0);

(async function main() {
  // B1 ready 慢 80ms：等待窗内连到 3 条 → 3 条全部补发、全部报 'sw'
  {
    let shown = [];
    const swStub = {
      serviceWorker: {
        get ready() { return sleep(80).then(function () { return { showNotification: function (t, o) { shown.push({ t: t, o: o }); return Promise.resolve(); } }; }); }
      }
    };
    const api = makeSandbox(swStub, 'hidden');
    const chans = [[], [], []];
    api.swNotifyLater('A', { body: '1', icon: 'data:image/png;base64,xxx', image: 'data:image/png;base64,yyy' }, function (c) { chans[0].push(c); });
    api.swNotifyLater('B', { body: '2', badge: 'data:image/png;base64,zzz' }, function (c) { chans[1].push(c); });
    api.swNotifyLater('C', { body: '3' }, function (c) { chans[2].push(c); });
    await sleep(300);
    check('B1 等待窗内 3 条全部补发（修前只发 A、B/C 整条丢）', shown.length === 3 && shown[0].t === 'A' && shown[1].t === 'B' && shown[2].t === 'C');
    check('B2 三条通道均如实报 sw', chans.every(function (c) { return c.length === 1 && c[0] === 'sw'; }));
    check('B3 补发剥媒体字段 + urgency high（求稳口径不变）',
      shown.length === 3 && shown.every(function (s) { return !s.o.icon && !s.o.badge && !s.o.image && s.o.urgency === 'high'; }));
  }
  // B2 ready reject：三条全部报 none（不再像修前那样第 2 条起连回报都没有）
  {
    const swStub = { serviceWorker: { get ready() { return Promise.reject(new Error('no-sw')); } } };
    const api = makeSandbox(swStub, 'hidden');
    const chans = [[], [], []];
    api.swNotifyLater('A', {}, function (c) { chans[0].push(c); });
    api.swNotifyLater('B', {}, function (c) { chans[1].push(c); });
    api.swNotifyLater('C', {}, function (c) { chans[2].push(c); });
    await sleep(80);
    check('B4 ready 失败三条均报 none', chans.every(function (c) { return c.length === 1 && c[0] === 'none'; }));
  }
  // B3 flush 后新到通知开启新一轮等待窗（幂等闸不得把后续轮次一起挡死）
  {
    let n = 0;
    const swStub = { serviceWorker: { get ready() { n++; return sleep(20).then(function () { return { showNotification: function () {} }; }); } } };
    const api = makeSandbox(swStub, 'hidden');
    api.swNotifyLater('R1', {}, function () {});
    await sleep(100);
    api.swNotifyLater('R2', {}, function () {});
    await sleep(100);
    check('B5 flush 后新一轮补发正常（R1/R2 各发一次）', n === 2);
  }
  // B4 无 serviceWorker 环境：立即报 none、不挂队列不炸
  {
    const api = makeSandbox({});
    const chans = [];
    api.swNotifyLater('X', {}, function (c) { chans.push(c); });
    check('B6 无 SW 环境立即报 none', chans.length === 1 && chans[0] === 'none');
  }
  // B5 #1291 新契约：回前台后才就绪＝这批补发作废（用户已在应用内看到消息本体），
  //    一条都不许再交出去、通道如实报 none（旧写法＝回前台又把旧消息/已结束通话通知炸一遍）
  {
    let shown = [];
    const swStub = {
      serviceWorker: {
        get ready() { return sleep(80).then(function () { return { showNotification: function (t, o) { shown.push({ t: t, o: o }); return Promise.resolve(); } }; }); }
      }
    };
    const api = makeSandbox(swStub, 'visible');
    const chans = [[], [], []];
    api.swNotifyLater('V1', { body: '1' }, function (c) { chans[0].push(c); });
    api.swNotifyLater('V2', { body: '2' }, function (c) { chans[1].push(c); });
    api.swNotifyLater('V3', { body: '3' }, function (c) { chans[2].push(c); });
    await sleep(300);
    check('B7 回前台后就绪：一条都不补发（RED 本体，旧写法＝3）', shown.length === 0);
    check('B8 作废的每条通道如实报 none（不当成通道故障、不记已弹）',
      chans.every(function (c) { return c.length === 1 && c[0] === 'none'; }));
  }

  console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILED');
  process.exit(fails === 0 ? 0 : 1);
})();
