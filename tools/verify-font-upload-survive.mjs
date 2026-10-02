// ===== #787 专项回归：聊天美化「上传字体莫名失效」根治（写丢 + 读烧） =====
// 用户实报（多设备型号复现）：上传的字体过阵子/重启后就没了，有时刷新又回来。
// 根因（#642「全局唯一份+轻量引用」链路，零机型分支——判据全取存储状态/时序）：
//   ①写丢：font-blob-<hash> 是 MB 级大键只进 IDB，写入走 xyStore.set 内部 fire-and-forget 的
//     idbSet，挂起内核/iOS 杀后台/配额 abort 静默失败 → toast 报成功、持久层没写进 → 重启后引用展开为空。
//     修复：fontSetDataFor 补一发带回执的 idbSet，写不进回退直存 dataURL（小字体落 LS 耐用）＋过期守卫＋silent。
//   ②读烧：fontResolved 的异步补读「一次烧毁」（_fontHydrating 不复位），弱内核撞一次 4s 挂起＝整场不补读。
//     修复：在飞标记防并发 + 每 hash 限 5 发重试 + #665a 歧义标记区分「读失败」与「真没有」（gone 才停）。
// 用例（对提取出的真实函数体做单元级行为断言，stub 掉 store/window/DOM）：
//   B1 引用+blob 在场 → 同步展开，不发读
//   B2 引用+blob 只在 IDB → 首调返回 ''，补读落地后回填 memoryCache+applyFont+广播，再调同步命中
//   B3 读失败（ambiguous）→ 不置 gone、排退避补读，下一发照发（旧代码一次烧毁＝红）
//   B4 读到「真没有」（非 ambiguous）→ 置 gone 停止重试（不再空转发读）
//   B5 重试有预算：反复触发总读数 ≤5 且失败后会再来（旧代码只读一发＝红）
//   B6 上传落盘成功 → 保留引用、不 toast、不重应用（现状行为不变）
//   B7 上传写 IDB 失败 → 引用回退直存 dataURL + 如实 toast + 重应用（旧代码静默丢＝红）
//   B8 过期守卫：回执前用户已换值 → 不覆盖现值、不 toast（旧代码无守卫＝红）
//   B9 迁移/静默路径失败 → 照样回退保数据但不弹 toast（旧代码无回退＝红）
//   S1~S5 五条哨兵锚点在位（与 build.mjs #787a~e 同文）
// 用法：
//   node tools/verify-font-upload-survive.mjs                          （绿基线，期望全绿）
//   MOCHI_CS_FILE=<HEAD 版 chat-settings.js> MOCHI_EXPECT=red node …   （红对照，期望恰 RED_IDS 红）
// 纯 node 单元验证（vm 式提取函数体＋stub），不依赖不触发 node build.mjs，多会话并行可安全跑。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const csPath = process.env.MOCHI_CS_FILE || join(root, 'src/js/chat-settings.js');
const src = readFileSync(csPath, 'utf8');

// ---- 提取函数体（花括号配平），失败=锚点没了 ----
function extractFn(prefix) {
  const at = src.indexOf(prefix);
  if (at < 0) throw new Error('找不到 ' + prefix);
  const bodyStart = src.indexOf('{', at);
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error(prefix + ' 花括号不配平');
}

const failures = [];
const note = (id, ok, why) => { if (!ok) failures.push(id + '：' + why); };

// ---- 真实 fontHash + 测试数据 ----
const fontHashReal = new Function('"use strict";' + extractFn('function fontHash(') + '; return fontHash;')();
const DATAURL = 'data:font/ttf;base64,' + 'QTBCQ0RFRg'.repeat(40); // 伪 dataURL（>200KB 形态由长度代表即可）
const HASH = fontHashReal(DATAURL);
const REF = '@@font:' + HASH;
const drain = () => new Promise((r) => setImmediate(r));

// ---- fontSetDataFor 跑法（stub：memoryCache 写入口/IDB 写回执/DOM/广播/toast） ----
function runUpload(opts) {
  const deskMap = {};
  if (opts.deskVal !== undefined) deskMap['cs-font'] = opts.deskVal;
  const calls = { blobPut: [], apply: 0, changed: 0, toast: [], idbSet: [] };
  const fontSetDataFor = new Function(
    'fontHash', '_fontBlobGone', 'fontBlobPut', 'FONT_KEY', 'window', 'applyFont', 'csFontChanged', 'toast',
    '"use strict";' + extractFn('function fontSetDataFor(') + '; return fontSetDataFor;')(
    fontHashReal,
    {},
    (h, v) => { calls.blobPut.push(h); },
    'cs-font',
    { idbSet: (k, v) => { calls.idbSet.push(k); return Promise.resolve(opts.idbOk !== false); } },
    () => { calls.apply++; },
    () => { calls.changed++; },
    (m) => { calls.toast.push(m); });
  fontSetDataFor({ get: (k) => (k in deskMap ? deskMap[k] : ''), set: (k, v) => { deskMap[k] = v; } }, DATAURL, !!opts.silent);
  return { deskMap, calls };
}

// ---- fontResolved 跑法（stub：fontVal/memoryCache/idbGet/定时器） ----
function runResolve(opts) {
  // memoryCache 键形对齐真实 xyStore：fontResolved/补读写入都传『font-blob-<hash>』（前缀由 xyStore 内部拼）
  const memory = {};
  if (opts.blob !== undefined) memory['font-blob-' + HASH] = opts.blob;
  const st = { reads: 0, timers: [], apply: 0, changed: 0, blobPut: [] };
  const _fontBlobGone = {};
  const windowStub = {
    xyStore: () => ({ get: (k) => (k in memory ? memory[k] : null) }),
    idbGet: (k, info) => {
      st.reads++;
      const mode = typeof opts.idbGet === 'function' ? opts.idbGet(st.reads) : opts.idbGet;
      if (mode === 'throw') return Promise.reject(new Error('idb down'));
      if (mode === 'ambiguous') { if (info) info.ambiguous = true; return Promise.resolve(undefined); }
      if (mode === 'absent') return Promise.resolve(undefined);
      return Promise.resolve(mode); // 命中：即 dataURL 值
    }
  };
  const fontResolved = new Function(
    'fontVal', 'window', '_fontBlobGone', '_fontHydrating', '_fontHydrateTries', 'fontBlobPut', 'applyFont', 'csFontChanged', 'setTimeout',
    '"use strict";' + extractFn('function fontResolved(') + '; return fontResolved;')(
    () => (opts.deskVal !== undefined ? opts.deskVal : ''),
    windowStub,
    _fontBlobGone,
    {},
    {},
    (h, v) => { st.blobPut.push(h); memory['font-blob-' + h] = v; },
    () => { st.apply++; },
    () => { st.changed++; },
    (fn, ms) => { st.timers.push([fn, ms]); return st.timers.length; });
  return { fontResolved, st, _fontBlobGone, fireTimers: () => { const t = st.timers.splice(0); t.forEach((x) => x[0]()); } };
}

// ---- S 哨兵锚点（与 build.mjs #787a~e 同文，须在本文件内唯一） ----
const NEEDLES = {
  S1: 'if (window.idbGet && !_fontHydrating[hash] && tries < 5) {',
  S2: "window.idbGet('xy-home-v2:font-blob-' + hash, info)",
  S3: "window.idbSet('xy-home-v2:font-blob-' + h, dataURL)",
  S4: "if (s.get(FONT_KEY) !== '@@font:' + h) return;",
  S5: '字体文件丢失，请重新上传'
};

async function main() {
  // B1 同步命中
  {
    const r = runResolve({ deskVal: REF, blob: DATAURL });
    const v = r.fontResolved();
    note('B1', v === DATAURL && r.st.reads === 0, '同步命中应返回 blob 且不发读，实得 reads=' + r.st.reads);
  }
  // B2 补读落地 → 回填+重应用+广播，再调同步命中
  {
    const r = runResolve({ deskVal: REF, idbGet: DATAURL });
    const v1 = r.fontResolved();
    await drain(); await drain();
    const v2 = r.fontResolved();
    note('B2', v1 === '' && r.st.reads === 1 && r.st.blobPut.length === 1 && r.st.apply >= 1 && r.st.changed >= 1 && v2 === DATAURL,
      '首调应空发读、落地后回填+applyFont+广播，二调同步命中；实得 v1空=' + (v1 === '') + ' reads=' + r.st.reads + ' blobPut=' + r.st.blobPut.length + ' apply=' + r.st.apply + ' v2命中=' + (v2 === DATAURL));
  }
  // B3 ambiguous 读失败 → 不置 gone、排退避、下一发照发（同一夹具连调两次）
  {
    const r = runResolve({ deskVal: REF, idbGet: 'ambiguous' });
    r.fontResolved();
    await drain(); await drain();
    const goneNotSet = Object.keys(r._fontBlobGone).length === 0;
    const scheduled = r.st.timers.length >= 1;
    r.fireTimers();
    const firedApply = r.st.apply >= 1;
    r.fontResolved(); // 第二发：失败后在飞标记应已清，照发读
    await drain();
    note('B3', goneNotSet && scheduled && firedApply && r.st.reads === 2,
      '读失败应不置gone、排退避、下一发照发；实得 gone未置=' + goneNotSet + ' timers=' + scheduled + ' apply=' + r.st.apply + ' reads=' + r.st.reads);
  }
  // B4 真没有 → gone 停止重试（后续调用不再发读）
  {
    const r = runResolve({ deskVal: REF, idbGet: 'absent' });
    r.fontResolved();
    await drain(); await drain();
    const goneSet = Object.keys(r._fontBlobGone).length === 1;
    r.fontResolved(); r.fontResolved();
    note('B4', goneSet && r.st.reads === 1,
      '真没有应置 gone 且停止发读；实得 gone=' + goneSet + ' reads=' + r.st.reads);
  }
  // B5 预算：反复触发 ≤5 发，且失败后会再来（≥2）
  {
    const r = runResolve({ deskVal: REF, idbGet: 'ambiguous' });
    for (let i = 0; i < 20; i++) { r.fontResolved(); await drain(); r.fireTimers(); }
    note('B5', r.st.reads >= 2 && r.st.reads <= 5,
      '重试应限量（≤5）且不只读一发（≥2）；实得 reads=' + r.st.reads);
  }
  // B6 上传落盘成功：引用保留、不 toast、不重应用
  {
    const r = runUpload({ idbOk: true });
    await drain(); await drain();
    note('B6', r.deskMap['cs-font'] === REF && r.calls.toast.length === 0 && r.calls.apply === 0 && r.calls.idbSet.length === 1 && r.calls.blobPut.length === 1,
      '落盘成功应保留引用且静默；实得 ref=' + (r.deskMap['cs-font'] === REF) + ' toast=' + r.calls.toast.length + ' apply=' + r.calls.apply);
  }
  // B7 写 IDB 失败：回退直存 dataURL + 如实 toast + 重应用
  {
    const r = runUpload({ idbOk: false });
    await drain(); await drain();
    note('B7', r.deskMap['cs-font'] === DATAURL && r.calls.toast.length === 1 && r.calls.toast[0].indexOf('写入失败') >= 0 && r.calls.apply >= 1 && r.calls.changed >= 1,
      '写失败应回退直存+如实提示；实得 back=' + (r.deskMap['cs-font'] === DATAURL) + ' toast=' + JSON.stringify(r.calls.toast));
  }
  // B8 过期守卫：回执前用户已换值 → 不覆盖、不 toast（注：HEAD 无回退路径本就不覆盖，判别力在绿侧防回归）
  {
    const r = runUpload({ idbOk: false, deskVal: REF });
    r.deskMap['cs-font'] = 'Microsoft YaHei'; // 用户在回执到达前改了字体名
    await drain(); await drain();
    note('B8', r.deskMap['cs-font'] === 'Microsoft YaHei' && r.calls.toast.length === 0,
      '过期回执不得覆盖现值；实得 val=' + JSON.stringify(r.deskMap['cs-font']));
  }
  // B9 静默路径（启动迁移）：失败照样回退保数据但不弹 toast
  {
    const r = runUpload({ idbOk: false, silent: true });
    await drain(); await drain();
    note('B9', r.deskMap['cs-font'] === DATAURL && r.calls.toast.length === 0,
      '静默路径应回退保数据且不弹 toast；实得 back=' + (r.deskMap['cs-font'] === DATAURL) + ' toast=' + r.calls.toast.length);
  }
  // S1~S5 锚点
  for (const id of Object.keys(NEEDLES)) note(id, src.indexOf(NEEDLES[id]) >= 0, '源码缺锚点：' + NEEDLES[id]);

  // ---- 汇总 ----
  const RED_IDS = ['B3', 'B4', 'B5', 'B6', 'B7', 'B9', 'S1', 'S2', 'S3', 'S4', 'S5'];
  if (EXPECT === 'red') {
    const missing = RED_IDS.filter((id) => !failures.some((f) => f.indexOf(id + '：') === 0));
    if (missing.length) { console.error('[red] 期望红的用例没红：' + missing.join(',')); process.exit(1); }
    console.log('[red] 判别力 OK：' + failures.length + ' 条红，恰为 ' + failures.map((f) => f.split('：')[0]).join(','));
    process.exit(0);
  }
  if (failures.length) { console.error('[green] 失败 ' + failures.length + ' 条：\n' + failures.join('\n')); process.exit(1); }
  console.log('[green] verify-font-upload-survive 全过：B1~B9 + S1~S5');
  process.exit(0);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
