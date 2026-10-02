import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../src/js/chat-settings.js', import.meta.url), 'utf8');
const template = fs.readFileSync(new URL('../src/template.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/css/chat-main.css', import.meta.url), 'utf8');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
const values = new Map(), props = new Map();
// #938 起 applyChatSurfaces 经 setVar「值变才写」——桩件按真实 CSSStyleDeclaration 语义补读/删，
// 并直接执行 src 里那条 setVar 定义（不在测试里另写一份，否则守卫被改坏也测不出来）。
const fakeStyle = {
  setProperty: (k, v) => props.set(k, String(v)),
  getPropertyValue: k => (props.has(k) ? props.get(k) : ''),
  removeProperty: k => { const had = props.has(k) ? props.get(k) : ''; props.delete(k); return had; }
};
const context = vm.createContext({
  store: { get: k => values.get(k), set: (k, v) => values.set(k, v) },
  chatPage: { style: fakeStyle },
  document: { getElementById: () => null },
  _csHexRgb: h => /^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) : null
});
const setVarStart = source.indexOf('const setVar =');
const setVarLine = source.slice(setVarStart, source.indexOf('\n', setVarStart));
assert(setVarStart >= 0 && setVarLine.includes('getPropertyValue'), '取不到 src 里的 setVar 定义（该测试的桩件前提已变）');
const start = source.indexOf('  const CHAT_SURFACE_SETTINGS = [');
const end = source.indexOf('  function applySettings()', start);
assert(start >= 0 && end > start);
vm.runInContext(setVarLine + '\n' + source.slice(start, end), context);
const apply = () => vm.runInContext("applyChatSurfaces('#ffffff', '#111111')", context);
test('defaults preserve original appearance', () => {
  apply(); assert.equal(props.get('--cs-head-opacity'), '0.92');
  assert.equal(props.get('--cs-input-opacity'), '0.92');
  assert.equal(props.get('--cs-in-surface'), 'rgba(255,255,255,1)');
});
test('zero alpha is retained and bars are independent', () => {
  values.set('cs-head-opacity', '0'); values.set('cs-input-opacity', '40'); apply();
  assert.equal(props.get('--cs-head-opacity'), '0'); assert.equal(props.get('--cs-input-opacity'), '0.4');
});
test('bubble alpha changes paint only', () => {
  values.set('cs-bubble-opacity', '30'); apply();
  assert.equal(props.get('--cs-in-surface'), 'rgba(255,255,255,0.3)');
  assert.equal(props.get('--cs-out-surface'), 'rgba(17,17,17,0.3)');
});
test('invalid numbers fall back and bounds clamp', () => {
  values.set('cs-head-opacity', 'NaN'); values.set('cs-input-inset', '999'); values.set('cs-head-inset', '-999'); apply();
  assert.equal(props.get('--cs-head-opacity'), '0.92'); assert.equal(props.get('--cs-input-inset'), '80px');
  assert.equal(props.get('--cs-head-inset'), '-80px');
});
test('negative inset passes through for bidirectional bars (#708)', () => {
  values.set('cs-head-inset', '-20'); values.set('cs-input-inset', '-30'); apply();
  assert.equal(props.get('--cs-head-inset'), '-20px');
  assert.equal(props.get('--cs-input-inset'), '-30px');
  values.set('cs-head-inset', '0'); values.set('cs-input-inset', '0'); apply();
  assert.equal(props.get('--cs-head-inset'), '0px'); assert.equal(props.get('--cs-input-inset'), '0px');
});
test('inset settings declare bidirectional range with sign hints', () => {
  assert(source.includes("{ key: 'cs-head-inset', label: '顶部栏上下移动', def: 0, max: 80, min: -80, unit: 'px', posHint: '正值下移、负值上移' }"));
  assert(source.includes("{ key: 'cs-input-inset', label: '底部栏上下移动', def: 0, max: 80, min: -80, unit: 'px', posHint: '正值上移、负值下移' }"));
  assert(source.includes("surfaceArrow(values[3], '↓', '↑')"));
  assert(source.includes("surfaceArrow(values[4], '↑', '↓')"));
});
test('each new entry exists once', () => {
  for (const id of ['cs-bar-op', 'cs-bubble-op', 'cs-bar-pos', 'cs-typing-ink'])
    assert.equal(template.split('id="' + id + '"').length - 1, 1, id);
});
test('typing picker and value refresh are connected', () => {
  assert(source.includes("bindBubbleColorRow('cs-typing-ink', 'cs-typing-ink'"));
  assert(source.includes("'cs-typing-ink-val': store.get('cs-typing-ink')"));
});
test('beauty schemes preserve all new values', () => {
  const keys = source.match(/const CHAT_BEAUTY_KEYS = \[([\s\S]*?)\];/)[1];
  for (const key of ['cs-head-opacity','cs-input-opacity','cs-bubble-opacity','cs-head-inset','cs-input-inset']) assert(keys.includes("'" + key + "'"));
});
test('position controls reserve real flex space and support reverse direction', () => {
  assert(css.includes("content:''; display:block; flex-shrink:0;"));
  assert(css.includes('height:max(var(--cs-head-inset, 0px), 0px);'));
  assert(css.includes('height:max(var(--cs-input-inset, 0px), 0px);'));
  assert(css.includes('margin-bottom:min(var(--cs-head-inset, 0px), 0px);'));
  assert(css.includes('margin-bottom:calc(var(--cs-input-mb-base, 0px) + min(var(--cs-input-inset, 0px), 0px));'));
  assert(css.includes('@media (max-width: 900px) {\n  #page-chat > .chat-input-row { --cs-input-mb-base:0px; }'));
  assert(css.includes('html.force-mobile #page-chat > .chat-input-row { --cs-input-mb-base:0px; }'));
  assert(css.includes('html.tablet #page-chat > .chat-input-row { --cs-input-mb-base:0px; }'));
});
test('bar alpha supports dark theme and stays single-chat scoped', () => {
  assert(css.includes('[data-theme="dark"] #page-chat { --cs-bar-rgb:30,30,30; }'));
  // #731：栏位底色改读「生效值」变量（--cs-*-opacity-ink 存在时优先，否则回落用户存的
  // --cs-*-opacity，再回落 .92 默认）——三层链路缺任一层都会让「壁纸延伸到栏位」或
  // 「栏位不透明度滑杆」其中之一失效，故整条 var 链一起锚。
  assert(css.includes('#page-chat > .chat-head { background:rgba(var(--cs-bar-rgb), var(--cs-head-opacity-ink, var(--cs-head-opacity, .92))); }'));
  assert(css.includes('#page-chat > .chat-input-row { background:rgba(var(--cs-bar-rgb), var(--cs-input-opacity-ink, var(--cs-input-opacity, .92))); }'));
});
test('sliders commit only on confirmation and protect contact changes', () => {
  const edit = source.slice(source.indexOf('  function editChatSurface('), source.indexOf('  function bindChatSurfaceGroup('));
  assert(edit.includes('if (window.activePrefix() !== cid) return;'));
  assert(!edit.includes('onChange:'));
  assert(edit.includes("{ label: '恢复默认', value: item.def }"));
});
// #731 壁纸铺满方式：默认档必须与历史写死值逐字一致（cover + center）
test('wallpaper fit default matches legacy hardcoded value', () => {
  assert(source.includes("const CS_BG_FIT_DEFAULT = 'fill';"));
  assert(source.includes("{ label: '铺满裁剪', value: 'fill' }"));
  for (const def of ["{ label: '完整显示', value: 'contain' }", "{ label: '平铺', value: 'tile' }", "{ label: '拉伸填满', value: 'stretch' }"]) assert(source.includes(def));
  const bg = source.slice(source.indexOf('const bgLayer = csBgLayer();'));
  // #782：尺寸/位置改走「铺满方式 + 位置缩放三键」的单一写入点，缺省三键下仍是 csBgFitCss(档) + 居中
  assert(bg.includes("const szWanted = adj.s === 100 ? csBgFitCss(fit) : adj.s + '%';"));
  assert(bg.includes("if (bgLayer.style.backgroundSize !== szWanted) bgLayer.style.backgroundSize = szWanted;"));
  assert(bg.includes("const psWanted = adj.x + '% ' + adj.y + '%';"));
  assert(bg.includes("if (bgLayer.style.backgroundPosition !== psWanted) bgLayer.style.backgroundPosition = psWanted;"));
  assert(source.includes('const CS_BG_ADJ = { x: 50, y: 50, s: 100 };'));
  assert(bg.includes("const rpWanted = fit === 'tile' ? 'repeat' : 'no-repeat';"));
  assert(bg.includes("if (bgLayer.style.backgroundRepeat !== rpWanted) bgLayer.style.backgroundRepeat = rpWanted;"));
  // #762：默认档（fill）经 csBgFitCss 映射回 cover＝与历史写死值逐字一致；壁纸不得再写回页面自身
  const fitFn = source.slice(source.indexOf('function csBgFitCss(fit) {'));
  assert(fitFn.slice(0, fitFn.indexOf('\n  }')).includes("return 'cover';"));
  assert(!/chatPage\.style\.backgroundSize = '[^']/.test(source));
});
// #731 壁纸延伸到栏位：生效值语义必须双向（开=0，关=回落到用户自己的不透明度）
test('bar ink variables let wallpaper through and preserve stored values', () => {
  assert(source.includes('function barOpacityInk(index) {'));
  assert(source.includes("if (store.get('cs-bg-fullbars') === '1') return 0;"));
  assert(source.includes('return surfaceValue(CHAT_SURFACE_SETTINGS[index]);'));
  assert(source.includes("if (on) setVar(chatPage, pair[1], '0');"));
  assert(source.includes('else delVar(chatPage, pair[1]);'));
  assert(css.includes('var(--cs-head-opacity-ink, var(--cs-head-opacity, .92))'));
  assert(css.includes('var(--cs-input-opacity-ink, var(--cs-input-opacity, .92))'));
});
test('wallpaper fit and fullbar controls are reachable from both entries', () => {
  assert.equal(template.split('id="cs-bg-fit"').length - 1, 1);
  assert.equal(template.split('id="cs-bg-fullbars"').length - 1, 1);
  assert(template.includes('id="cs-bg-fit-val"') && template.includes('id="cs-bg-fullbars-val"'));
  assert(source.includes("const csBgFitRow = row('cs-bg-fit');"));
  assert(source.includes("const csBgFullbarsRow = row('cs-bg-fullbars');"));
  // 边看边调抽屉：两个控件都必须在「栏位」分区内
  const barSec = source.slice(source.indexOf("{ key: 'bar', label: '栏位'"), source.indexOf("{ key: 'type', label: '字体 · 其他'"));
  assert(barSec.includes("mkPills('壁纸铺满方式'"));
  assert(barSec.includes("mkPills('壁纸延伸到栏位'"));
});
test('new wallpaper keys are carried by beauty schemes', () => {
  const keys = source.match(/const CHAT_BEAUTY_KEYS = \[([\s\S]*?)\];/)[1];
  for (const key of ['cs-bg-fit', 'cs-bg-fullbars']) assert(keys.includes("'" + key + "'"));
});
console.log(`${passed}/${passed} source and isolated-function checks passed (not a full UI test)`);
