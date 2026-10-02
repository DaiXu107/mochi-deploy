// ===== 验证脚本：#441 媒体池核对/重建「大库冻结=点了没反应」修复 行为级回归 =====
// 背景：红米K80 实报「核对图片是否齐全/重建媒体池点击没有反应，也没有成功失败提示弹窗」——
// 聊天记录在 IDB 是数组直存（大桌面单键 40MB+），旧逻辑整包 JSON.stringify＝几十秒长任务
// 冻结主线程＝页面假死、零进度反馈；锁屏/切后台页面被杀＝扫描永不完成＝永远等不到弹窗。
// 修复=逐条小 stringify（令牌 44 字符完整落在单条消息内，按条切分不切断令牌）+ 定期让出
// 主线程 + 逐键进度回传（arguments[0]，零参签名不变保 #423 哨兵）+ 三按钮异常补弹窗。
// 本脚本从 src/js/media-pool.js 提取真实 mochiMediaCoverage/mochiMediaGC 配 mock IDB 做断言。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const pool = readFileSync(join(root, 'src/js/media-pool.js'), 'utf8');
const personalize = readFileSync(join(root, 'src/js/personalize.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } }

// --- 提取「window.xxx = function () { … };」完整语句（花括号计数） ---
function extractStmt(src, header) {
  const i = src.indexOf(header);
  if (i < 0) throw new Error('源码中找不到 ' + header);
  let j = src.indexOf('{', i), depth = 0, out = '';
  for (let k = i; k < src.length; k++) {
    const ch = src[k];
    if (ch === '{') { depth++; if (depth === 1) j = k; }
    else if (ch === '}') { depth--; if (depth === 0) { out = src.slice(i, k + 1) + ';'; break; } }
  }
  return out;
}

const FULLC = 'xy-home-v2:media:';
const HA = 'a'.repeat(32), HB = 'b'.repeat(32), HX = 'c'.repeat(32);
const IMG_OK = 'data:image/png;base64,' + 'A'.repeat(1200);

// --- 构造 mock 环境：chat-msgs 为数组直存形态（#430 大记录形态），池含 1 有效 1 空串 ---
function makeEnv(chatVal) {
  const keys = ['xy-home-v2:c1:chat-msgs', FULLC + HA, FULLC + HB, FULLC + HX];
  const data = {};
  data['xy-home-v2:c1:chat-msgs'] = chatVal;
  data[FULLC + HA] = IMG_OK;   // 有效
  data[FULLC + HB] = '';       // 空串=缺失
  data[FULLC + HX] = IMG_OK;   // 与任何引用无关（GC 孤儿候选）
  const lsKeys = ['xy-home-v2:c1:chat-tail'];
  const ls = {
    getItem: (k) => (k === 'xy-home-v2:c1:chat-tail' ? '快照里也引用 @@m:' + HB : null),
    get length() { return lsKeys.length; },
    key: (i) => lsKeys[i]
  };
  const w = {
    mochiMediaFlush: () => Promise.resolve(true),
    idbListKeys: () => Promise.resolve(keys),
    idbGet: (k) => Promise.resolve(data[k]),
    idbGetMany: (ks) => { const o = {}; ks.forEach((k) => { o[k] = data[k]; }); return Promise.resolve(o); },
    idbDelete: () => Promise.resolve(true)
  };
  return { w, ls, data, keys };
}

// ===== T1 行为级：coverage 数组分扫路径 + 进度回传 + 结果口径不变 =====
const covStmt = extractStmt(pool, 'window.mochiMediaCoverage = function () {');
const makeCov = new Function('window', 'FULL', 'localStorage', covStmt + '\nreturn window.mochiMediaCoverage;');
const env1 = makeEnv([{ text: '你好呀' }, { img: '@@m:' + HA }, { text: 'x', parts: [{ v: '看看 @@m:' + HB + ' 好看吗' }] }]);
const progCalls = [];
const coverage = makeCov(env1.w, FULLC, env1.ls);
const rep1 = await coverage(function (done, total, label) { progCalls.push([done, total, label]); });
ok('C1 数组直存聊天记录逐条分扫可解出令牌（referenced=2）', rep1.ok === true && rep1.referenced === 2);
ok('C2 池内口径不变：有效 1 + 空串缺失 1', rep1.inPool === 1 && rep1.missing === 1);
ok('C3 进度回传按引用键数触发（≥2 次，done 递增）', progCalls.length >= 2 && progCalls[0][0] === 1 && progCalls[0][1] >= 2);
ok('C4 进度带阶段标签（聊天/收藏 vs 本地快照）', progCalls.some((c) => c[2] === '聊天/收藏') && progCalls.some((c) => c[2] === '本地快照'));

// ===== T2 行为级：GC 分扫路径 + 序列化失败保守中止（宁可漏删绝不误删语义保留） =====
const gcStmt = extractStmt(pool, 'window.mochiMediaGC = function () {');
const makeGC = new Function('window', 'FULL', 'map', 'writeBuf', 'inflight', 'localStorage', gcStmt + '\nreturn window.mochiMediaGC;');
const env2 = makeEnv([{ text: 'x' }, { img: '@@m:' + HA }]);
const gc = makeGC(env2.w, FULLC, new Map(), [], {}, env2.ls);
const rep2 = await gc();
ok('G1 GC 数组分扫：keep={HA}，孤儿=池内无引用的 HX', rep2.ok === true && rep2.orphans.length === 1 && rep2.orphans[0] === FULLC + HX);
const env3 = makeEnv((() => { const c = {}; c.self = c; return [c]; })()); // 循环引用=stringify 抛错
const gc2 = makeGC(env3.w, FULLC, new Map(), [], {}, env3.ls);
const rep3 = await gc2();
ok('G2 单条序列化失败→整次保守中止（不删任何键）', rep3.ok === false && (rep3.reason || '').indexOf('引用数据序列化失败') >= 0 && rep3.orphans.length === 0);

// ===== S 结构级：重建三阶段进度+让出、personalize 三按钮接线与异常弹窗 =====
ok('S1 重建①池体检批间进度+让出', pool.includes("'核对池内条目'") && /await yieldUI\(\); \/\/ #441 批间让出主线程（池 741\+ 条×大值，连读会冻结 UI）/.test(pool));
ok('S2 重建②扫描阶段进度+让出', pool.includes("prog(i, srcKeys.length, '扫描本机副本')") && /scanValue\(vals\[k\]\); vals\[k\] = null; \}\);\s*\n\s*await yieldUI\(\);/.test(pool));
ok('S3 重建③哈希阶段进度', pool.includes("prog(i, dataList.length, '校验哈希')"));
ok('S4 零参签名不变（#423/#419 哨兵锚点不动）', pool.includes('window.mochiMediaRebuild = function () {') && pool.includes('window.mochiMediaCoverage = function () {') && pool.includes('window.mochiMediaGC = function () {'));
ok('S5 核对按钮实时进度接线（personalize）', personalize.includes('window.mochiMediaCoverage(function (done, total, label)'));
ok('S6 重建按钮实时进度接线（personalize）', personalize.includes('window.mochiMediaRebuild(function (done, total, label)'));
ok('S7 孤儿扫描按钮实时进度接线（personalize）', personalize.includes('window.mochiMediaGC(function (done, total)'));
ok('S8 三按钮异常从静默改为弹窗提示（核对/重建/孤儿扫描）', (personalize.match(/没有改动任何数据。\\n\\n可稍后重试/g) || []).length >= 2 && /扫描中途出错，没有删除任何内容/.test(personalize));
ok('S9 开始扫描即时 toast（可感知反馈）', (personalize.match(/请留在本页/g) || []).length >= 3);

console.log('\n' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
