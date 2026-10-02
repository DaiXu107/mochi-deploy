// ===== 回归脚本：#1257 朋友圈发布配图令牌化（池先落盘、引用后落库；写池失败回退内联原件）=====
// 用法：node tools/verify-1257-feed-publish-tokenize.mjs [被检 feed.js 路径]
// 纯 Node 行为断言（vm 抠真实 feedTokImgs 函数体，不开浏览器）：
//   背景（OPPO Reno16 Chrome 实报「朋友圈一发图片就没有了」，多机型同形）：旧 publish 把原图
//   dataURL 直存 post.imgs → 主键 feed-posts 被顶过 200KB 大键线（只进 IDB+内存、不进 LS），
//   剥图快照 imgs 恒空；Android 页面被回收（该机诊断 83 次）掐掉未提交 IDB 事务 → 刷新后
//   只剩无图快照兜底＝图没了。改法＝图体进媒体池、动态只留 @@m: 令牌，且池写成功前引用不落库。
//   红侧对照：git show HEAD:src/js/feed.js（修复前）跑本脚本应恰红掉新契约。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { normalize, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2]
  ? normalize(process.argv[2])
  : normalize(join(here, '../src/js/feed.js'));
const src = readFileSync(target, 'utf8');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' —— ' + extra : '')); }
}

// —— 大括号配平抠出 async function feedTokImgs 真身 ——
function extract(name) {
  const i = src.indexOf('async function ' + name);
  if (i < 0) return null;
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); }
  }
  return null;
}
const fnSrc = extract('feedTokImgs');
console.log('#1257 feed 发布令牌化 — 被测：' + target);
ok(!!fnSrc, 'S0 feedTokImgs 函数体可抠出（红侧＝修复前无此函数）');
if (!fnSrc) { console.log('结果 ' + pass + '/' + fail); process.exit(fail ? 1 : 0); }

const ctx = vm.createContext({ console, setTimeout, Promise });
ctx.window = ctx;
const feedTokImgs = vm.runInContext('(' + fnSrc + ')', ctx);

const BIG = 'data:image/png;base64,' + 'A'.repeat(2048);
const BIG2 = '  data:image/jpeg;base64,' + 'B'.repeat(2048) + '  '; // 前后空白，应 trim 入池
const TOK1 = '@@m:' + '1'.repeat(32);
const TOK2 = '@@m:' + '2'.repeat(32);

function stub({ tokMap, flush, hasTokenize = true }) {
  const seen = { tok: [], flushCalls: 0 };
  if (hasTokenize) {
    ctx.window.mochiMediaTokenize = (u) => { seen.tok.push(u); return Promise.resolve(tokMap ? tokMap(u) : null); };
  } else delete ctx.window.mochiMediaTokenize;
  ctx.window.mochiMediaFlush = () => { seen.flushCalls++; return flush(); };
  return seen;
}

// S1 全令牌化＋池落盘成功 → 返回令牌数组
{
  const seen = stub({ tokMap: (u) => (u === BIG ? TOK1 : u.trim() === BIG2.trim() ? TOK2 : null), flush: () => Promise.resolve(true) });
  const out = await feedTokImgs([BIG, BIG2]);
  ok(out[0] === TOK1 && out[1] === TOK2, 'S1 池写成功→引用为令牌', JSON.stringify(out.map(s => String(s).slice(0, 12))));
  ok(seen.flushCalls === 1, 'S1b 引用落库前先冲池（flush 恰一次）');
}
// S2 池写失败（flush false）→ 整批退回原 dataURL（＝旧行为，引用绝不先于池落库，#186 纪律）
{
  stub({ tokMap: () => TOK1, flush: () => Promise.resolve(false) });
  const inp = [BIG];
  const out = await feedTokImgs(inp);
  ok(out[0] === BIG, 'S2 写池失败→回退内联原件', String(out[0]).slice(0, 12));
}
// S3 flush 抛错 → 同样回退，不 reject
{
  stub({ tokMap: () => TOK1, flush: () => { throw new Error('boom'); } });
  let threw = false, out = null;
  try { out = await feedTokImgs([BIG]); } catch (e) { threw = true; }
  ok(!threw && out && out[0] === BIG, 'S3 flush 抛错→静默回退原件不炸发布');
}
// S4 部分令牌化（小图 tokenize 返回 null）＋混合数组原样保留
{
  const small = 'data:image/png;base64,' + 'C'.repeat(8);
  stub({ tokMap: (u) => (u === BIG ? TOK1 : null), flush: () => Promise.resolve(true) });
  const out = await feedTokImgs([BIG, small]);
  ok(out[0] === TOK1 && out[1] === small, 'S4 未入池条目原样保留（混排不吞图）');
}
// S5 池 API 缺席 → 原样直通且不调 flush
{
  const seen = stub({ hasTokenize: false, flush: () => Promise.resolve(true) });
  const out = await feedTokImgs([BIG]);
  ok(out[0] === BIG && seen.flushCalls === 0, 'S5 无媒体池环境→行为等同旧版');
}
// S6 入池实参为 trim 后规范形态（#948 同口径：内核给出前导空白载荷）
{
  const seen = stub({ tokMap: () => TOK1, flush: () => Promise.resolve(true) });
  await feedTokImgs([BIG2]);
  ok(seen.tok.length === 1 && seen.tok[0] === BIG2.trim(), 'S6 tokenize 收到 trim 后载荷');
}
// S7 空数组/无图发布 → 原样返回，不为空引用付一次 flush
{
  const seen = stub({ tokMap: () => TOK1, flush: () => Promise.resolve(true) });
  const out = await feedTokImgs([]);
  ok(Array.isArray(out) && out.length === 0 && seen.flushCalls === 0, 'S7 纯文字发布零开销');
}
// S8 tokenize 自身 reject 也不炸（真实 API 不 reject，防外部实现回潮）
{
  ctx.window.mochiMediaTokenize = () => Promise.reject(new Error('x'));
  ctx.window.mochiMediaFlush = () => Promise.resolve(true);
  let threw = false, out = null;
  try { out = await feedTokImgs([BIG]); } catch (e) { threw = true; }
  ok(!threw && out && out[0] === BIG, 'S8 tokenize reject→原件保留');
}

// —— 静态契约（发布接线三针）——
{
  const i = src.indexOf('async function publish');
  ok(i >= 0, 'B1 publish 已 async 化（可 await 池回执）');
  const seg = src.slice(i, i + 1400);
  ok(/imgsArr = await feedTokImgs\(rawImgs\)/.test(seg), 'B2 引用取自 await 后的令牌数组');
  ok(/_feedPubBusy = true;[\s\S]*await feedTokImgs/.test(seg), 'B3 令牌化窗口内重入闸在场（防双击双发）');
  const post = src.match(/const post = \{[^\n]*imgs: imgsArr[\s\S]{0,120}?\bsave\(list\);/);
  ok(!!post, 'B4 先令牌、后 save（imgs: imgsArr → save(list) 顺序不可反）');
  ok(!/imgs: pickedImgs\.slice\(\)/.test(src), 'B5 旧「原图直存 post.imgs」写法已清除');
  const body = fnSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/userAgent|iPhone|Android|Chrome|HarmonyOS/i.test(body), 'Z1 零机型／零 UA 分支（判定只取池回执）');
}
console.log('结果 ' + pass + '/' + fail);
process.exit(fail ? 1 : 0);
