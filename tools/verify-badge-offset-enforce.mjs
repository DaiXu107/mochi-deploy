// verify-badge-offset-enforce.mjs —— #728 / #732 回归防线
// 覆盖两件事：
//   #732 气泡透明度/圆角滑块「滑了没反应」——强制生效层是否真的在最该出手的时候出手
//   #728 标识 / 时间轴位置微调——变量叠加是否零回归（未设置时视觉不动）+ 钳制是否正确
// 口径：源文件级 vm 执行 + 文本断言，不依赖浏览器。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const SRC = fs.readFileSync(new URL('../src/js/chat-settings.js', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('../src/css/chat-main.css', import.meta.url), 'utf8');
const TPL = fs.readFileSync(new URL('../src/template.html', import.meta.url), 'utf8');
const BUILD = fs.readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n       ' + e.message); }
}

// ---------- 夹具：把 chat-settings.js 的功能片段跑在最小 vm 里 ----------
function makeCtx(initial) {
  const values = new Map(Object.entries(initial || {}));
  const props = new Map();
  const nodes = new Map();
  const headKids = [];
  const mkStyle = () => {
    const m = new Map();
    return {
      setProperty: (k, v) => { m.set(k, String(v)); props.set(k, String(v)); },
      removeProperty: k => { m.delete(k); props.delete(k); },
      getPropertyValue: k => (m.has(k) ? m.get(k) : '')
    };
  };
  const ctx = {
    store: {
      get: k => values.get(k),
      set: (k, v) => values.set(k, v),
      remove: k => values.delete(k)
    },
    root: { style: mkStyle() },
    chatPage: { style: mkStyle() },
    document: {
      documentElement: { getAttribute: () => null, style: { fontFamily: '' } },
      body: {
        style: { fontFamily: '' },
        classList: { add() {}, remove() {}, contains: () => false },
        appendChild: el => { headKids.push(el); nodes.set(el.id, el); }
      },
      getElementById: id => nodes.get(id) || null,
      createElement: () => {
        const el = {
          id: '', textContent: '', setAttribute() {}, appendChild() {}, remove() {},
          style: { fontFamily: '', cssText: '' }
        };
        return el;
      },
      head: {
        appendChild: el => { headKids.push(el); nodes.set(el.id, el); }
      }
    },
    _csHexRgb: h => /^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) : null,
    window: {}, console
  };
  ctx.window = ctx;
  return { ctx, values, props, headKids, nodes };
}

// 预建一个"已存在的强制层节点"，模拟第二次调用要能清掉旧的
function seedOldEnforce(ctx) {
  return { id: 'cs-bubble-enforce', textContent: '', remove() { ctx.document.head.__removed = true; } };
}

// 抽取范围要含 BUBBLE_RADIUS_DEFAULT / TIME_STYLES / themeDefaults 及之后的
// clampOffset / surfaceValue / applyCssEnforce。起点选在 BUBBLE_RADIUS_DEFAULT 定义处，
// 这一行之后到 applyCss() 止，全部只依赖 store/root/chatPage/document 四个夹具。
const startSurf = SRC.indexOf('  const BUBBLE_SIZES = [');
const startEnf = SRC.indexOf('  function applyCssEnforce() {');
const endEnf = SRC.indexOf('  function applyCss() {', startEnf);
assert(startSurf >= 0, 'BUBBLE_SIZES 未找到');
assert(startEnf >= 0, 'applyCssEnforce 未找到（#732 强制层被整块抹掉了）');
assert(endEnf > startEnf, 'applyCssEnforce 块边界异常');

const CHUNK = SRC.slice(startSurf, endEnf);

function runEnforce(initial, opts) {
  const h = makeCtx(initial);
  const old = opts && opts.seedOld;
  if (old) h.nodes.set('cs-bubble-enforce', old);
  vm.runInContext(CHUNK, vm.createContext(h.ctx));
  vm.runInContext('applyCssEnforce()', vm.createContext(h.ctx));
  return h;
}

// ---------- #732 强制层 ----------

test('#732 未动滑块（默认值）时不写强制层——零回归底线', () => {
  const h = runEnforce({});
  const rules = h.headKids.filter(k => k.id === 'cs-bubble-enforce');
  assert.equal(rules.length, 0,
    '默认状态下就插了强制层——所有没碰过滑块的用户气泡样式会被改写');
});

test('#732 透明度动过 → 写 background!important 两条', () => {
  const h = runEnforce({ 'cs-bubble-opacity': '30' });
  const el = h.headKids.filter(k => k.id === 'cs-bubble-enforce').pop();
  assert(el, '透明度改了却没有任何强制层');
  assert(el.textContent.includes('background:var(--cs-in-surface)!important'), '缺 in 侧 background 强制');
  assert(el.textContent.includes('background:var(--cs-out-surface)!important'), '缺 out 侧 background 强制');
});

test('#732 圆角动过 → 写 border-radius!important（用变量，不是硬编码）', () => {
  const h = runEnforce({ 'cs-bubble-radius': '8px' });
  const el = h.headKids.filter(k => k.id === 'cs-bubble-enforce').pop();
  assert(el, '圆角改了却没有任何强制层');
  assert(el.textContent.includes('border-radius:var(--chat-bubble-radius,18px)!important'),
    '圆角强制没走变量，会与 applySettings 写进 root 的值脱节');
});

test('#732 圆角回到默认 18px → 不再写圆角强制（随时可撤）', () => {
  const h = runEnforce({ 'cs-bubble-radius': '18px' });
  const el = h.headKids.filter(k => k.id === 'cs-bubble-enforce').pop();
  assert(!el || !el.textContent.includes('border-radius'),
    '圆角已回默认值却仍写强制层——用户没法通过"调回去"恢复原样');
});

test('#732 强制层选择器必须钉在 #page-chat 且用双类提特异性（不泄漏群聊）', () => {
  const h = runEnforce({ 'cs-bubble-opacity': '30', 'cs-bubble-radius': '8px' });
  const el = h.headKids.filter(k => k.id === 'cs-bubble-enforce').pop();
  assert(el.textContent.includes('#page-chat .msg-in .msg-bubble.msg-bubble'),
    '缺 #page-chat 作用域＝会泄漏到群聊（#536 同族回归）');
  assert(el.textContent.includes('#page-chat .msg-bubble.msg-bubble{'),
    '圆角强制没用双类提特异性，压不过用户 CSS 的 head 末尾同特异性规则');
});

test('#732 重复调用会先清旧节点（不叠加、不泄漏）', () => {
  const ctx = makeCtx({ 'cs-bubble-opacity': '30' });
  let removed = false;
  ctx.nodes.set('cs-bubble-enforce', { id: 'cs-bubble-enforce', remove() { removed = true; } });
  vm.runInContext(CHUNK, vm.createContext(ctx.ctx));
  vm.runInContext('applyCssEnforce()', vm.createContext(ctx.ctx));
  assert(removed, '重入时没清掉旧强制层＝规则无限叠加');
});

test('#732 脏值（NaN / 空串）不写强制层、不抛错', () => {
  const h = runEnforce({ 'cs-bubble-opacity': 'NaN', 'cs-bubble-radius': '' });
  const el = h.headKids.filter(k => k.id === 'cs-bubble-enforce').pop();
  assert(!el, '脏值触发了强制层——会把气泡样式写坏');
});

test('#732 applySettings 尾部挂了强制层刷新（否则改滑块不立即生效）', () => {
  assert(SRC.includes('try { applyCssEnforce(); } catch (e) {}'), 'applySettings 里没有调用强制层');
  assert(SRC.includes('window.applyCsCssEnforce = applyCssEnforce;'), '没对外导出强制层刷新入口');
});

// ---------- #728 位置偏移 ----------

test('#728 clampOffset 边界：±40 钳制、非法值回 0', () => {
  const h = makeCtx({});
  vm.runInContext(CHUNK, vm.createContext(h.ctx));
  const f = vm.runInContext('clampOffset', vm.createContext(h.ctx));
  assert.equal(f(0), 0);
  assert.equal(f(40), 40);
  assert.equal(f(-40), -40);
  assert.equal(f(999), 40, '上界没钳住');
  assert.equal(f(-999), -40, '下界没钳住');
  assert.equal(f('abc'), 0, '非法字符串没回退 0');
  assert.equal(f(''), 0, '空串没回退 0');
  assert.equal(f(null), 0, 'null 没回退 0');
  assert.equal(f(undefined), 0, 'undefined 没回退 0');
  assert.equal(f(7.6), 8, '没有四舍五入到整像素');
});

test('#728 applySettings 写 4 个偏移变量（标识 x/y + 时间轴 x/y）', () => {
  ['--msg-mark-x', '--msg-mark-y', '--msg-time-dx', '--msg-time-dy'].forEach(v => {
    assert(SRC.includes("setVar(root, '" + v + "'"),
      '没写 ' + v + '——对应滑块会失效');
  });
});

test('#728 偏移变量走 clampOffset，不是裸写 store 值', () => {
  const m = SRC.match(/const markDX = clampOffset\(store\.get\('cs-mark-x'\)\)/);
  assert(m, '标识 X 没走 clampOffset，越界值会直接落到 CSS');
  assert(/const timeDY = clampOffset\(store\.get\('cs-time-y'\)\)/.test(SRC), '时间轴 Y 没走 clampOffset');
});

test('#728 未设置时变量为 0px ⇒ calc 回退基线，视觉零变化', () => {
  assert(CSS.includes('top:calc(2px + var(--msg-mark-y, 0px)); left:calc(4px + var(--msg-mark-x, 0px));'),
    '.msg-hi-mark/heart 没有 calc 叠加——位置不可调');
  // 基线必须是原来的 2px/4px，改了就等于动了老用户的默认样式
  assert(/\.msg-hi-heart \{[\s\S]*?top:calc\(2px \+ var\(--msg-mark-y, 0px\)\)/.test(CSS),
    '标识基线不再是 2px——老用户默认位置被改变');
});

test('#728 时间轴四种样式都接了偏移变量（少一种＝那种样式仍偏）', () => {
  const need = ['cs-time-under-bubble', 'cs-time-float', 'cs-time-center', 'cs-time-bubble'];
  need.forEach(s => {
    const re = new RegExp('body\\.' + s + '[^{]*\\{[^}]*var\\(--msg-time-d');
    assert(re.test(CSS), s + ' 样式没接偏移变量');
  });
});

test('#728 时间轴中心样式的横向偏移叠加在 translateX(-50%) 之后（不破坏居中）', () => {
  assert(CSS.includes('translateX(-50%) translateX(var(--msg-time-dx, 0px))'),
    '居中样式没保住 -50% 基线——时间轴会整体跑偏');
});

test('#728 设置页两行入口存在（美化页）', () => {
  assert(TPL.includes('id="cs-mark-pos"'), '缺「主动发送标识位置」行');
  assert(TPL.includes('id="cs-time-pos"'), '缺「时间轴位置」行');
  assert(TPL.includes('id="cs-mark-pos-val"') && TPL.includes('id="cs-time-pos-val"'), '缺回显节点');
});

test('#728 抽屉「微调」分区存在，且 4 个滑块齐全', () => {
  assert(SRC.includes("{ key: 'tune', label: '微调'"), '抽屉里没有「微调」分区');
  ['标识 左右', '标识 上下', '时间轴 左右', '时间轴 上下'].forEach(lbl => {
    assert(SRC.includes("'" + lbl + "'"), '抽屉缺滑块：' + lbl);
  });
  assert(SRC.includes("'位置全部恢复默认'"), '缺「恢复默认」动作');
});

test('#728 抽屉与设置页共用同一批键（不出现两套键各写各的）', () => {
  ['cs-mark-x', 'cs-mark-y', 'cs-time-x', 'cs-time-y'].forEach(k => {
    const hits = (SRC.match(new RegExp("'" + k + "'", 'g')) || []).length;
    assert(hits >= 2, k + ' 只被一处引用——抽屉与设置页很可能各写各的键');
  });
});

// ---------- 哨兵 ----------

test('哨兵 #732a~i / #728 关键项均已登记', () => {
  ['function applyCssEnforce() {',
   'background:var(--cs-in-surface)!important',
   'border-radius:var(--chat-bubble-radius,18px)!important',
   'window.applyCsCssEnforce = applyCssEnforce;',
   'const OFFSET_MIN = -40, OFFSET_MAX = 40;'].forEach(n => {
    assert(BUILD.includes(n), '哨兵 needle 未登记：' + n);
  });
  assert(BUILD.includes("needle: 'id=\"cs-mark-pos\"'"), '设置页两行锚点哨兵未登记');
  assert(BUILD.includes("translateX(-50%) translateX(var(--msg-time-dx, 0px))"), '时间轴偏移哨兵未登记');
});

test('哨兵 needle 在源文件里唯一（否则是哑哨兵，拦不住回归）', () => {
  const needles = ['function applyCssEnforce() {',
                   'background:var(--cs-in-surface)!important',
                   'border-radius:var(--chat-bubble-radius,18px)!important'];
  needles.forEach(n => {
    let c = 0, i = 0;
    while ((i = SRC.indexOf(n, i)) >= 0) { c++; i += n.length; }
    assert.equal(c, 1, n + ' 在 chat-settings.js 里出现 ' + c + ' 次（必须唯一）');
  });
});

console.log('\n#728/#732 结果：' + passed + ' PASS / ' + failed + ' FAIL');
process.exit(failed ? 1 : 0);
