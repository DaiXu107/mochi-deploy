// ===== 验证脚本：#455 专属库池视图令牌化 + 编辑树懒加载 行为级回归 =====
// 背景：iPhone 15 Pro Max via 等多机型「左右滑动卡 + 总是自动刷新重进」——诊断实锤
// default:cc-groups 单键 153MB（#377 公用库 OOM jetsam 家族的专属库面）：专属库裸 parse
// 无令牌化、编辑树 groups 开机常驻、去重任务双库同 parse、表情面板/搜索/角标反复全量
// parse＝iOS WebKit 渲染进程被反复杀＝整页自动重载。修复=ownPoolRaw 带缓存+令牌化、
// 回复池/面板/角标/搜索全走池视图、编辑树只在管理页开着期间存在、懒加载态拒绝空树
// 整包写回、去重任务大库免解析预检。
// 本脚本从 src 真实实现提取函数体（非复刻）在 stub 环境里跑行为断言。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const src = readFileSync(join(root, 'src/js/chatcard.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } }

// --- 按名字提取函数体（括号配平），支持 `function NAME(...) {` 与 `X.Y = function (...) {` 两种形态 ---
function extractFn(srcText, name) {
  const re = new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{|[\\w.$]*(?:' + name + ')[\\w.$]*\\s*=\\s*function\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(srcText);
  if (!m) throw new Error('源码中找不到 ' + name);
  let i = m.index + m[0].length, depth = 1, out = m[0];
  while (i < srcText.length && depth > 0) {
    const ch = srcText[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    out += ch;
    i++;
  }
  return out;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============ 测试库：大贴纸(>64KB dataURL)/小贴纸/文字卡 ============
const BIG_BODY = 'data:image/png;base64,' + 'A'.repeat(220 * 1024); // >200KB：兼顾 ccEnsureDurable 大值落盘确认阈值
const SMALL_CARD = 'data:image/png;base64,BBBsmall';
const RAW_LIB = JSON.stringify({
  text: [['日常', ['你好呀']]],
  kaomoji: [], emoji: [],
  sticker: [['表情', ['dog|||' + BIG_BODY, SMALL_CARD]]],
  image: [], poke: [], voice: []
});

// ============ 沙箱：提取真实函数体 + stub 环境（直接字符串拼接构造） ============
function buildEnv() {
  let getCalls = 0;
  const sets = [];
  const store = {
    get() { getCalls++; return RAW_LIB; },
    set(k, v) { sets.push([k, v]); }
  };
  const idbSets = [];
  const body = `
    const window = { mochiMediaTokenize: async function (body) {
      let h = ''; for (let i = 0; i < 32; i++) h += '0123456789abcdef'[(i + body.length) % 16];
      return '@@m:' + h;
    }, idbSet: function () {} };
    const document = { getElementById: function () { return { hidden: true }; } };
    const toast = function () {};
    const CC_TYPES = ['text', 'kaomoji', 'emoji', 'sticker', 'image', 'poke', 'voice'];
    const CC_ALL_TYPES = CC_TYPES.concat(['fish', 'eat', 'mjfree']);
    const CC_FUNC_KEYS = ['fish', 'eat', 'mjfree'];
    const CC_MEDIA_TOKEN_THRESHOLD = 64 * 1024;
    const CC_TOK_MEMO_MAX_CHARS = 8 * 1024 * 1024;
    let ccTokRun = 0;
    const ccTokGen = { pub: 0, own: 0 };
    const ccTokMemo = new Map();
    let ccTokMemoChars = 0;
    // #547 引入：token→内容短指纹（ccMediaCardIdent 令牌化前后同身份用）。沙箱此前漏桩，
    // 导致提取出的 ccTokenizeGiantMedia 一跑就 ReferenceError（恒红，非被测逻辑问题）。
    const ccTokMemoRev = new Map();
    ${extractFn(src, 'ccMediaFrag')}
    let pubCache = { marker: 'pub-old' };
    let ownPoolCache = null;
    let groups = null;
    let ccDirty = false;
    let editSaveTimer = null;
    let ccDurableTimer = null;
    let ccDurablePending = false;
    let ccDurableWarned = false;
    let cur = 'text';
    const libCounts = { pub: -1, own: -1, fun: -1, pubFun: -1 };
    const saveCalls = [];
    function saveGroups(g) { saveCalls.push(g); }
    function scheduleSave() { ccDirty = true; }
    function renderGroupsBar() {}
    function render() {}
    function curFullKey() { return 'xy-home-v2:default:cc-groups'; }
    function refreshLibCounts() { libCounts.refreshed = (libCounts.refreshed || 0) + 1; }
    ${extractFn(src, 'buildGroupsFrom')}
    ${extractFn(src, 'ccTokenizeGiantMedia')}
    ${extractFn(src, 'ownPoolRaw')}
    ${extractFn(src, 'pubInvalidate')}
    ${extractFn(src, 'ccAppendCards')}
    ${extractFn(src, 'flushCcSave')}
    ${extractFn(src, 'ccEnsureDurable')}
    return {
      ownPoolRaw, pubInvalidate, flushCcSave, ccEnsureDurable,
      get ccAppendCards() { return window.ccAppendCards; },
      state() { return { groups, ccDirty, ownPoolCache }; },
      stats() { return { saveCalls, sets: SETS_REF, libCounts, idbSets: IDB_REF }; },
      setGroups(v) { groups = v; },
      setDirty(v) { ccDirty = v; },
    };
  `;
  const factory = new Function('STORE_REF', 'SETS_REF', 'IDB_REF', 'IDBSET_REF', body.replace(/store\./g, 'STORE_REF.').replace(/window\.idbSet\(/g, 'IDBSET_REF('));
  const api = factory(
    { get: store.get, set: store.set },
    sets,
    idbSets,
    function (k, v) { idbSets.push([k, v]); return Promise.resolve(true); }
  );
  return { api, store, sets, idbSets, callCount: () => getCalls };
}

(async function run() {
  // ============ A. ownPoolRaw：缓存 + 令牌化 + 原始键零改动 ============
  {
    const { api, callCount } = buildEnv();
    const g1 = api.ownPoolRaw();
    // 令牌化是构建后的异步串行管线——先等它落地再断言（A5 同源）
    let toked = false;
    for (let t = 0; t < 40; t++) {
      await sleep(25);
      const grp = (api.state().ownPoolCache || g1).sticker.find(p => p[0] === '表情');
      if (String(grp[1][0]).indexOf('dog|||@@m:') === 0) { toked = true; break; }
    }
    ok('A1 大贴纸卡被令牌化且保留 名称||| 前缀', toked);
    ok('A2 小贴纸卡保持原文（<64KB 不令牌化）', g1.sticker.find(p => p[0] === '表情')[1][1] === SMALL_CARD);
    ok('A3 文字卡原样', g1.text[0][1][0] === '你好呀');
    const g2 = api.ownPoolRaw();
    ok('A4 二次取池走缓存（store.get 只调一次、同一对象）', callCount() === 1 && g1 === g2);
    ok('A5 令牌化落地后池视图缓存里不再有 dataURL 大卡体', String(api.state().ownPoolCache.sticker.find(p => p[0] === '表情')[1][0]).indexOf('data:image/') < 0);
    // 原始键零改动：store.get 返回的 RAW_LIB 从头到尾没被改写（A1 改的是解析副本）
    ok('A6 原始库串零改动（令牌化只在内存视图）', RAW_LIB.indexOf(BIG_BODY) > 0 && JSON.parse(RAW_LIB).sticker[0][1][0] === 'dog|||' + BIG_BODY);
  }

  // ============ B. pubInvalidate 连带失效专属池视图 ============
  {
    const { api, callCount } = buildEnv();
    api.ownPoolRaw();
    api.pubInvalidate();
    api.ownPoolRaw();
    ok('B1 pubInvalidate 后池视图重建（store.get 共两次）', callCount() === 2);
  }

  // ============ C. ccAppendCards 懒加载态直写不清库 ============
  {
    const { api, sets } = buildEnv();
    ok('C1 懒加载态（groups=null）追加字卡返回成功', api.ccAppendCards('text', '日常', '新卡一张') === true);
    ok('C2 直写快照同时含原有大贴纸与新卡（绝不整库清空）', (() => {
      if (!sets.length) return false;
      const written = JSON.parse(sets[0][1]);
      const hasSticker = (written.sticker || []).some(p => p[0] === '表情' && String(p[1][0]).indexOf('dog|||' + BIG_BODY) === 0);
      const hasNew = (written.text || []).some(p => p[0] === '日常' && p[1].indexOf('新卡一张') >= 0);
      const hasOld = (written.text || []).some(p => p[0] === '日常' && p[1].indexOf('你好呀') >= 0);
      return hasSticker && hasNew && hasOld;
    })());
    ok('C3 写后编辑树仍为懒加载态、池视图已失效', api.state().groups === null && api.state().ownPoolCache === null);
    ok('C4 大值直写带落盘确认（ccEnsureDurable→idbSet）', api.stats().idbSets.length === 1 && api.stats().idbSets[0][0] === 'xy-home-v2:default:cc-groups');
  }

  // ============ D. flushCcSave / ccEnsureDurable 懒加载态拒绝空树写回 ============
  {
    const { api, sets } = buildEnv();
    api.setDirty(true);
    api.flushCcSave();
    ok('D1 groups=null 时 ccDirty 被收口且不走 saveGroups（防空树覆盖权威键）', api.state().ccDirty === false && api.stats().saveCalls.length === 0 && sets.length === 0);
    api.setGroups({ text: [['日常', ['x']]] });
    api.setDirty(true);
    api.flushCcSave();
    ok('D2 编辑树在位时路由到 saveGroups（saveGroups 本体走 store 由 E10 源断言保障）', api.stats().saveCalls.length === 1 && sets.length === 0);
    // ccEnsureDurable：无树且无快照 → 拒发；有快照 → 带快照发
    api.setGroups(null);
    api.ccEnsureDurable(0);
    ok('D3 无树无快照不发全库写（绝不写 "null" 进权威键）', api.stats().idbSets.length === 0);
  }

  // ============ E. 源码结构断言（懒加载收口点在位） ============
  ok('E1 回复池专属侧走 ownPoolRaw', src.indexOf('return mergeFiltered(ownPoolRaw(), pubGroupsRaw());') >= 0);
  ok('E2 replyScopeGroups 兜底已移除（其职责由池视图+hydrate 收口）', src.indexOf('function replyScopeGroups') < 0);
  ok('E3 编辑树初始为懒加载态', /let groups = null;/.test(src));
  ok('E4 挂起大键取回只在管理页开着时重载编辑树', src.indexOf('if (scopeLive && ccPageOpen()) {') >= 0);
  ok('E5 离开字卡库页释放编辑树', src.indexOf("if (ccScope !== 'public') { groups = null; return; }") >= 0);
  ok('E6 切桌面不再无条件全量 parse（懒加载）', src.indexOf('else groups = null;') >= 0);
  ok('E7 表情包面板专属分区走令牌化池视图', src.indexOf("(scope === 'public') ? pubGroupsRaw() : ownPoolRaw()") >= 0);
  ok('E8 去重任务大库免解析预检（96MB 上限+mark 跳过）', /DD_PARSE_LIMIT = 96 \* 1024 \* 1024/.test(src) && src.indexOf('pubRaw.length + ownLen > DD_PARSE_LIMIT') >= 0);
  ok('E9 去重任务全键预检零读直返', src.indexOf('if (allSettled) return;') >= 0);
  ok('E10 saveGroups 懒加载态守卫在位', src.indexOf('if (!groups) { ccDirty = false; return; }') >= 0);

  console.log(`\n#455 专属库池瘦身/懒加载：通过 ${pass} / 失败 ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('脚本异常:', e); process.exit(1); });
