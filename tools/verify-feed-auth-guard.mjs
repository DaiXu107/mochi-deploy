// ===== #188 朋友圈无图·权威键守卫 行为断言 =====
// 抽 src/js/feed.js 真实源码（守卫三态 + load + feedMergeFromIdb）在桩环境下跑行为断言：
// iPad QQ浏览器/WKWebView 系 idbGet 超时返回 undefined 与「键不存在」不可分，守卫必须
// 保证「权威键仍在就绝不把剥图快照版本写回权威键」，同时「键确实不存在（新装/丢库）」
// 仍走原并集写回。运行：node tools/verify-feed-auth-guard.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src', 'js', 'feed.js'), 'utf8');

function slice(from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error('切片失败: ' + from.slice(0, 40) + ' / ' + to.slice(0, 40));
  return src.slice(a, b);
}
const guardSrc = slice('let feedAuthSeen = false;', '// v3.10.x 修复「评论聊了多个回合次日只剩一条」');
const loadSrc = slice('function load() {', '// v3.8.x：写剥图快照');
const mergeSrc = slice('function feedMergeFromIdb(v) {', '\n  try {');

// 桩：store(KV) / idbHasKey / idbGet / 10s 定时器捕获（不真等）
function harness({ lsVal = null, snap = [], idbHas = null, idbGetVal } = {}) {
  const setCalls = [];
  const timers = [];
  let renders = 0;
  const store = {
    get: (k) => (k === 'feed-posts' ? lsVal : null),
    set: (k, v) => { if (k === 'feed-posts') setCalls.push(v); },
  };
  const fakeWindow = {
    idbHasKey: idbHas === 'none' ? undefined : (() => { let n = 0; return () => { n++; return Promise.resolve(typeof idbHas === 'function' ? idbHas(n) : idbHas); }; })(),
    idbGet: () => Promise.resolve(idbGetVal),
  };
  const api = new Function('store', 'KEY', 'uid', 'window', 'loadSnap', 'normPost', 'mergePosts', 'render', 'setTimeout',
    '"use strict";\nlet feedDbReady=false;let feedPending=null;\n' + guardSrc + '\n' + loadSrc + '\n' + mergeSrc +
    '\nreturn {load, feedGuardWrite, feedMergeFromIdb,' +
    ' st: () => ({ seen: feedAuthSeen, pending: feedPending, ready: feedDbReady, retried: feedAuthRetried }),' +
    ' setPending: v => { feedPending = v; }, setReady: () => { feedDbReady = true; }};')(
    store, 'feed-posts', 'xy-home-v2', fakeWindow,
    () => snap,                       // loadSnap
    (x) => x,                         // normPost
    (a, b) => {                       // mergePosts（按 id 去重拼接，守卫断言不依赖深度合并语义）
      const m = {}; const out = [];
      (a || []).concat(b || []).forEach(p => { if (p && p.id && !m[p.id]) { m[p.id] = 1; out.push(p); } });
      return out;
    },
    () => { renders++; },             // render
    (fn, ms) => { timers.push({ fn, ms }); return 0; },
  );
  return { api, setCalls, timers, renders: () => renders };
}

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
const POST = [{ id: 'p1', ts: 1, content: 'c' }];

// T1 本会话读到过权威数据 → 写回直通
{
  const h = harness({ lsVal: null, snap: POST, idbHas: true, idbGetVal: '[{"id":"a","ts":9}]' });
  h.api.feedMergeFromIdb('[{"id":"a","ts":9}]');
  const w = await h.api.feedGuardWrite('X');
  ok(h.setCalls.indexOf('X') >= 0 && w === true, 'T1 见过权威数据后写回直通');
}

// T2 权威键在 LS/内存缓存有副本（store.get 非空）→ 不探测直接写
{
  const h = harness({ lsVal: '[{"id":"p1"}]', idbHas: true });
  let probed = false;
  h.api.feedGuardWrite('Y');
  ok(h.setCalls.indexOf('Y') >= 0, 'T2 缓存有权威副本直写');
}

// T3 权威读失败 + 权威键存在 → 拒写（核心！剥图快照版本不得盖进权威键）
{
  const h = harness({ lsVal: null, snap: POST, idbHas: true, idbGetVal: undefined });
  h.api.feedMergeFromIdb(undefined); // idbGet 超时返回 undefined
  await new Promise(r => setTimeout(r, 0));
  ok(h.setCalls.length === 0, 'T3a 权威键存在时 feedMergeFromIdb 不写回');
  ok(h.api.st().retried === 1 && h.timers.some(t => t.ms === 10000), 'T3b 拒写后安排 10s 权威重读');
  const w = await h.api.feedGuardWrite('Z');
  ok(w === false && h.setCalls.length === 0, 'T3c feedGuardWrite 拒写（返回 false 不落盘）');
  ok(h.api.st().seen === false, 'T3d 超时不得置 feedAuthSeen');
}

// T4 权威读失败 + 权威键确认不存在（新装/丢库）→ 放行写（保住原并集保数据行为）
{
  const h = harness({ lsVal: null, snap: POST, idbHas: false, idbGetVal: undefined });
  h.api.feedMergeFromIdb(undefined);
  await new Promise(r => setTimeout(r, 0));
  ok(h.setCalls.length === 1, 'T4 权威键不存在时守卫放行写回（并集保数据）');
}

// T5 探测自身失败（null=存储繁忙）→ 按「存在」处理：拒写（宁丢增量不毁权威）
{
  const h = harness({ lsVal: null, snap: POST, idbHas: null });
  const w = await h.api.feedGuardWrite('W');
  ok(w === false && h.setCalls.length === 0, 'T5 探测失败按存在处理拒写');
}

// T6 老内核无 idbHasKey 接口 → 维持旧行为直写（不因守卫断写）
{
  const h = harness({ lsVal: null, snap: POST, idbHas: 'none' });
  const w = await h.api.feedGuardWrite('V');
  ok(w === true && h.setCalls.indexOf('V') >= 0, 'T6 无探测接口维持旧行为直写');
}

// T7 拒写后 10s 重读权威成功 → 合并写回 + 置 seen + render
{
  const h = harness({ lsVal: null, snap: POST, idbHas: true, idbGetVal: '[{"id":"a","ts":9}]' });
  h.api.feedMergeFromIdb(undefined);
  await new Promise(r => setTimeout(r, 0));
  const t = h.timers.find(t2 => t2.ms === 10000);
  t.fn(); // 触发 10s 重读
  await new Promise(r => setTimeout(r, 0));
  ok(h.setCalls.some(s => s.indexOf('"id":"a"') >= 0), 'T7a 重读权威成功后合并写回');
  ok(h.api.st().seen === true, 'T7b 重读成功置 feedAuthSeen');
  ok(h.renders() >= 1, 'T7c 重读成功后重渲染');
}

// T8 重读有界（最多 2 次），病理存储下不死循环
{
  const h = harness({ lsVal: null, snap: POST, idbHas: true, idbGetVal: undefined });
  h.api.feedMergeFromIdb(undefined);
  await new Promise(r => setTimeout(r, 0));
  for (let i = 0; i < 5 && h.timers.length; i++) {
    const t = h.timers.shift(); t.fn();
    await new Promise(r2 => setTimeout(r2, 0));
  }
  ok(h.api.st().retried === 2 && h.timers.length === 0, 'T8 重读上限 2 次后不再调度');
  ok(h.setCalls.length === 0, 'T8b 全程未写权威键');
}

// T9 load() 合并 pending 不再受 !feedDbReady 前置限制（守卫拒写时增量在就绪后仍可见）
{
  const h = harness({ lsVal: null, snap: [], idbHas: true });
  h.api.setReady();
  h.api.setPending(POST);
  const list = h.api.load();
  ok(list.length === 1 && list[0].id === 'p1', 'T9 就绪后 load 仍合并 pending（拒写增量可见）');
}

// T10 权威读成功时 pending 清空（并集已落权威，不再重复合并）
{
  const h = harness({ lsVal: null, snap: POST, idbHas: true, idbGetVal: '[{"id":"a","ts":9}]' });
  h.api.setPending([{ id: 'q1', ts: 2 }]);
  h.api.feedMergeFromIdb('[{"id":"a","ts":9}]');
  await new Promise(r => setTimeout(r, 0));
  ok(h.api.st().pending === null, 'T10 权威写回成功后清空 pending');
}

console.log('\n#188 feed-auth-guard：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
