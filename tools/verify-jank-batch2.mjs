// ===== 验证 #588：第二批「卡顿/误判为 bug」的性能修（三个文件各一处） =====
// 承 #584（chatcard.js 搜索防抖 + 预压缩串行化），本批继续收上一轮全站排查里
// 「成本明确、改动局部、可行为断言」的三处：
//   · src/js/gift-shop.js —— giftItemHtml 对**每件**礼物都要问一次「TA 是否正许愿这件」，
//     而 wishLoad 每次调用都是一次完整 JSON.parse；预设礼物 302 件＝每开一次心意市集/
//     聊天送礼面板就 302 次 parse（打开面板明显慢半拍）。
//   · src/js/records.js   —— 「TA的关心」页回溯源是 O(n²)：每条 ask-msg 都把整个聊天数组
//     再 some() 一遍找 30s 内的问卡；聊天上千条时点页签会明显卡住（用户感知＝点了没反应）。
//   · src/js/garden.js    —— LS 未回填时先渲染「内存态」＝用户看到一个**空花园**且无任何
//     提示，最容易当成「数据全丢了」；probeIdb 要重试约 600ms+。
//
// 断言策略：不靠「跑得快就算过」（时间断言在有并行会话的机器上不稳），改成
//   ①静态锚点；②把**真实函数从源码抽出来**在 Node 里跑并对读写次数打点——
//   「302 件礼物 → 心愿单只被读 1 次」「改心愿后缓存必须失效」；
//   ③records 那段做**新旧等价性对拍**：二分版与原来的 Math.abs(dt)<30000 全表扫
//   在随机数据 + 边界值（正好相差 30000ms）上必须逐点同判——这是「优化没改语义」的硬证据；
//   ④garden 的提示是纯告知性的一行，用「位置在 openGarden 的 junkEmpty 分支内且早于 probeIdb」
//   的结构断言守（该文件是独立 IIFE，openGarden 不是全局函数、无头里拿不到入口；真正要看的是
//   真机上点开花园有没有那句提示，已记在 FIX-REGRESSION 的【真机:待验证】里）。
// 注：时间类断言（「跑得快就算过」）在本机不可靠——同时有并行会话在写盘/构建，刻意不用。
// 用法：node tools/verify-jank-batch2.mjs
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const read = (p) => readFileSync(join(root, 'src', p), 'utf8');

let fail = 0;
const T = (name, ok, extra) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + extra : '')); if (!ok) fail++; };
// 从 src 里按花括号配平切出一段完整代码（用于把真实实现抽出来跑）
const endOfBrace = (src, iOpen) => {
  let d = 0;
  for (let i = iOpen; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (!d) return i + 1; }
  }
  return -1;
};

const gift = read('js/gift-shop.js');
const rec = read('js/records.js');
const gard = read('js/garden.js');

// —— A. 静态锚点 ——
T('A1 gift-shop 有 TA 心愿 id 集合记忆化入口', gift.indexOf('function taWishIds() {') >= 0);
T('A2 失效点挂在 wishSave（WL_TA_KEY 全部写路径都过它）',
  gift.indexOf('if (key === WL_TA_KEY) _taWishIds = null;') >= 0);
T('A3 礼物格渲染改走记忆化集合、旧写法已移除',
  gift.indexOf('const taWanted = taWishIds().has(g.id);') >= 0 &&
  gift.indexOf('const taWanted = wishLoad(WL_TA_KEY).some(') < 0);
T('A4 records 问卡时间戳预排序 + 二分判据在位', rec.indexOf('const hasAskCardNear = (t) => {') >= 0);
T('A5 ask-msg 不再对全表 some（旧写法已移除）',
  rec.indexOf('const nearCard = hasAskCardNear(t);') >= 0 &&
  rec.indexOf('const nearCard = (msgs || []).some(') < 0);
T('A6 garden 读回期提示在位', gard.indexOf('toast("正在读取本地花园数据…");') >= 0);

if (fail) { console.log('静态断言失败 ' + fail + ' 条，跳过行为部分'); process.exit(1); }

// —— B. 行为（Node）：gift-shop 心愿单记忆化 ——
// 抽出 wishLoad / wishSave / _taWishIds / taWishIds 这四段真实实现，store 用打点桩喂进去
{
  const s0 = gift.indexOf('function wishLoad(key) {');
  const s1 = gift.indexOf('function taWishIds() {');
  const s2 = s1 < 0 ? -1 : endOfBrace(gift, gift.indexOf('{', s1));
  if (s0 < 0 || s1 < 0 || s2 < 0) { T('B0 能从源码抽出 wishLoad/wishSave/taWishIds 一段', false); }
  else {
    const code = gift.slice(s0, s2);
    let reads = 0, raw = JSON.stringify([]);
    // 源码里是 store() 取 store 对象再 .get/.set，所以桩本身要是函数
    const storeStub = () => ({ get: () => { reads++; return raw; }, set: (_k, v) => { raw = v; } });
    const makeGift = new Function('store', 'WL_TA_KEY', code + '\nreturn { taWishIds: taWishIds, wishSave: wishSave, wishLoad: wishLoad };');
    const GL = 'gift-wishlist-ta';
    const g = makeGift(storeStub, GL);

    // 30 件「TA 正许愿」+ 272 件不相关（总 302 件，照预设礼物量级）
    const wl = [];
    for (let i = 0; i < 30; i++) wl.push({ giftId: 'g_' + i });
    g.wishSave(GL, wl);                       // 写入后缓存应为空
    reads = 0;
    let hit = 0, miss = 0;
    for (let i = 0; i < 302; i++) { (g.taWishIds().has('g_' + i) ? hit++ : miss++); }
    T('B1 302 件礼物查心愿只读一次存储（旧形态＝每件一次 JSON.parse）', reads === 1, 'store.get 次数=' + reads);
    T('B2 判定结果正确（30 件命中 / 272 件未命中，不是「恒 false 的空绿」）',
      hit === 30 && miss === 272, 'hit=' + hit + ' miss=' + miss);

    // 失效：写入新心愿后必须重读，且读到新值
    g.wishSave(GL, [{ giftId: 'g_999' }]);
    const after = g.taWishIds();
    T('B3 wishSave 后缓存失效：重读一次且反映新值', reads === 2 && after.has('g_999') && !after.has('g_0'),
      'store.get 次数=' + reads + ' has999=' + after.has('g_999') + ' has0=' + after.has('g_0'));

    // RED 对照：旧写法（每件一次 wishLoad）在同样 302 次循环下必然 302 次读
    reads = 0;
    for (let i = 0; i < 302; i++) { g.wishLoad(GL).some(function (x) { return x.giftId === 'g_' + i; }); }
    T('B4 RED 对照：旧写法同样 302 次循环＝302 次读（证明 B1 的指标抓得到回归）', reads === 302, 'store.get 次数=' + reads);
  }
}

// —— C. 行为（Node）：records 二分版与原全表扫「逐点等价」 ——
{
  const c0 = rec.indexOf('const askCardTs = [];');
  const cMark = rec.indexOf('const hasAskCardNear = (t) => {');
  const c1 = cMark < 0 ? -1 : endOfBrace(rec, rec.indexOf('{', cMark));
  if (c0 < 0 || c1 < 0) { T('C0 能从源码抽出 askCardTs/hasAskCardNear 一段', false); }
  else {
    const code = rec.slice(c0, c1);
    const makeNear = new Function('msgs', code + '\nreturn hasAskCardNear;');

    // 造 2000 条消息，其中 50 条问卡（时间戳刻意含重复与 0）
    const msgs = [];
    const T0 = 1700000000000;
    for (let i = 0; i < 2000; i++) {
      const ts = T0 + i * 1000;
      if (i % 40 === 0) msgs.push({ ts, special: 'ask-card', askQuestion: '在干嘛' });
      else if (i % 7 === 0) msgs.push({ ts, special: 'ask-msg', text: '查岗' });
      else msgs.push({ ts, text: 'x' });
    }
    msgs.push({ ts: 0, special: 'ask-card', askQuestion: '零时刻' });       // 边界：ts=0
    msgs.push({ ts: T0, special: 'ask-card', askQuestion: '重复时间戳' });   // 边界：重复
    const near = makeNear(msgs);
    const naive = (t) => msgs.some((o) => o && o.special === 'ask-card' && o.askQuestion && Math.abs((o.ts || 0) - t) < 30000);

    let mism = 0, checked = 0, trueCnt = 0;
    const probes = [];
    for (let i = 0; i < 1500; i++) probes.push(T0 + Math.floor(Math.random() * 2000000));
    // 边界值：正好相差 30000 / 29999 / 30001（< 是开区间，差 30000 必须判 false）
    [T0, T0 - 30000, T0 - 29999, T0 - 30001, T0 + 30000, T0 + 29999, T0 + 30001, 0, 30000, 25000].forEach((v) => probes.push(v));
    for (const t of probes) { const a = near(t), b = naive(t); checked++; if (a) trueCnt++; if (a !== b) mism++; }
    T('C1 二分版与原全表扫在随机构造 + 边界值上逐点同判（开区间 <30000 语义未变）',
      mism === 0 && checked >= 1500, '比对 ' + checked + ' 点，不一致 ' + mism);
    T('C2 对照组不是恒 false（确有命中，避免空绿）', trueCnt > 0, '命中 ' + trueCnt + ' 点');
  }
}

// —— D. garden：提示必须发生在 probeIdb 之前（否则用户先看到空花园） ——
{
  const iToast = gard.indexOf('toast("正在读取本地花园数据…");');
  const iBranch = gard.indexOf('if (junkEmpty()) {', 1600);
  const iProbe = gard.indexOf('probeIdb(function (v) {', iBranch);
  const iBody = gard.indexOf('function openGardenBody(');
  T('D1 提示在 openGarden 的 junkEmpty 分支内、且早于 probeIdb 调用',
    iBranch > 0 && iToast > iBranch && (iBody < 0 || iToast < iBody) && iProbe > iToast,
    'branch=' + iBranch + ' toast=' + iToast + ' probe=' + iProbe);
  T('D2 提示走的是本文件既有的 toast（不引入新的弹层/DOM）',
    gard.indexOf('function toast(msg)') > 0);
}

console.log(fail ? ('❌ jank-batch2 断言失败 ' + fail + ' 条') : '✅ jank-batch2 全部断言通过');
process.exit(fail ? 1 : 0);
