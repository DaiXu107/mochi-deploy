// verify-1278-desk-layout-widgets.mjs — #1278 桌面自绘组件（文字/图片/倒计时）纳入 desk-layout 统一排序 行为回归
// 用法（绿侧＝缺省读本仓 src）：node tools/verify-1278-desk-layout-widgets.mjs
// 红侧（纯基线，钉死本批入库前的提交，别用会前移的 HEAD）：
//   git show <本批入库前 tip>:src/js/personalize.js > ../r_personalize.js
//   git show <本批入库前 tip>:src/css/home.css      > ../r_home.css
//   node tools/verify-1278-desk-layout-widgets.mjs --src ../r_personalize.js --css ../r_home.css
// 口径：无头产物此刻还不存在（本批不构建），故走 vm 抽真身——把 personalize.js 里本批涉及的函数
// 原样抽出真跑（deskLayout/saveDeskLayout/三个渲染器/move*/add*/remove*/syncDeskLayout 等），
// 配最小假 DOM（selector 子集：id/class/tag/[attr]/[attr="v"] 与逗号并集），判据＝布局数组与
// DOM 顺序这两个数据事实，不测字符串影子。红侧缺的函数＝抽不到，导出 undefined 由断言自己判红。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const argv = process.argv.slice(2);
function opt(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const pjPath = opt('--src', fileURLToPath(new URL('../src/js/personalize.js', import.meta.url)));
const cssPath = opt('--css', fileURLToPath(new URL('../src/css/home.css', import.meta.url)));
const src = readFileSync(pjPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');

// ---------- 从 src 抽真身 ----------
// 支持 function name( ... ) 与 const name = ( ... ) => { ... } / const name = function ( ... )
function extractBlock(code, name) {
  let i = code.indexOf('function ' + name + '(');
  if (i < 0) i = code.indexOf('const ' + name + ' = ');
  if (i < 0) return null;
  let d = 0;
  let j = code.indexOf('{', i);
  for (; j < code.length; j++) {
    if (code[j] === '{') d++;
    else if (code[j] === '}') { d--; if (d === 0) break; }
  }
  return code.slice(i, j + 1);
}
function extractNum(code, re, dflt) {
  const m = code.match(re);
  return m ? Number(m[1]) : dflt;
}
function extractStr(code, re, dflt) {
  const m = code.match(re);
  return m ? m[1] : dflt;
}
function extractObj(code, re, dflt) {
  const m = code.match(re);
  if (!m) return dflt;
  const o = {};
  const re2 = /([A-Za-z_]\w*):\s*(\d+)/g;
  let mm;
  while ((mm = re2.exec(m[1]))) o[mm[1]] = Number(mm[2]);
  return Object.keys(o).length ? o : dflt;
}
const DESK_PAGE_MIN = extractNum(src, /const DESK_PAGE_MIN = (\d+)/, 2);
const DESK_PAGE_MAX = extractNum(src, /const DESK_PAGE_MAX = (\d+)/, 5);
const DESK_IMG_SIZES = extractObj(src, /const DESK_IMG_SIZES = \{([^}]*)\};/, { s: 40, m: 70, l: 100 });
const DESK_SEL_ALL = extractStr(src, /const DESK_SEL_ALL = '([^']*)'/, '');

// ---------- 最小假 DOM（只实现本批函数用到的 selector 子集） ----------
function matchEl(el, sel) {
  if (!el) return false;
  return String(sel).split(',').map((s) => s.trim()).filter(Boolean).some((one) => matchOne(el, one));
}
function matchOne(el, one) {
  let rest = one;
  while (rest) {
    const token = rest.match(/^([#.]?[A-Za-z_][A-Za-z0-9_-]*)/);
    if (token) {
      const t = token[1];
      if (t[0] === '#') { if (el.getAttribute('id') !== t.slice(1)) return false; }
      else if (t[0] === '.') { if (!el.classList.contains(t.slice(1))) return false; }
      else if ((el.tagName || '').toLowerCase() !== t.toLowerCase()) return false;
      rest = rest.slice(token[0].length);
      continue;
    }
    const attr = rest.match(/^\[([A-Za-z0-9_-]+)(?:="([^"]*)")?\]/);
    if (attr) {
      const name = attr[1];
      if (attr[2] === undefined) { if (el.getAttribute(name) == null) return false; }
      else if (el.getAttribute(name) !== attr[2]) return false;
      rest = rest.slice(attr[0].length);
      continue;
    }
    return false;
  }
  return true;
}
function walkEl(root, sel, firstOnly) {
  const out = [];
  const visit = (el) => {
    if (el !== root && matchEl(el, sel)) { out.push(el); if (firstOnly) return true; }
    for (let i = 0; i < (el.children || []).length; i++) { if (visit(el.children[i])) return true; }
    return false;
  };
  visit(root);
  return firstOnly ? (out[0] || null) : out;
}
class FakeEl {
  constructor(tag, doc) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.style = {};
    this.className = '';
    this.hidden = false;
    this.textContent = '';
    this._html = '';
    this._doc = doc;
    const self = this;
    this.dataset = new Proxy({}, {
      get: (t, k) => (k === 'then' ? undefined : self.attributes['data-' + k.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase())] ?? undefined),
      set: (t, k, v) => { self.attributes['data-' + k.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase())] = String(v); return true; },
    });
  }
  get id() { return this.attributes.id || ''; }
  set id(v) { this.attributes.id = String(v); }
  getAttribute(n) { return n in this.attributes ? this.attributes[n] : null; }
  setAttribute(n, v) { this.attributes[n] = String(v); }
  removeAttribute(n) { delete this.attributes[n]; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); }
  appendChild(c) { if (!c) return c; if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, ref) {
    if (!c) return c;
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    if (ref && ref.parentNode === this) {
      const i = this.children.indexOf(ref);
      if (i >= 0) this.children.splice(i, 0, c); else this.children.push(c);
    } else this.children.push(c);
    return c;
  }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; } return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  closest(sel) { let n = this; while (n) { if (matchEl(n, sel)) return n; n = n.parentNode; } return null; }
  querySelector(sel) { return walkEl(this, sel, true); }
  querySelectorAll(sel) { return walkEl(this, sel, false); }
  get classList() {
    const self = this;
    return {
      contains: (c) => String(self.className || '').split(/\s+/).filter(Boolean).includes(c),
      add: (c) => { if (!self.classList.contains(c)) self.className = (self.className + ' ' + c).trim(); },
      remove: (c) => { self.className = String(self.className || '').split(/\s+/).filter((x) => x && x !== c).join(' '); },
    };
  }
  addEventListener() {}
}

// ---------- 沙箱：抽出的函数真跑 ----------
const PARTS = [
  'deskLayout', 'syncPageHint', 'deskWidOf', 'deskNodeById', 'insertDeskNodeByLayout', 'syncDeskLayout',
  'loadDeskTextsMeta', 'saveDeskTextsMeta', 'loadDeskImagesMeta', 'saveDeskImagesMeta',
  'loadDeskCountdownsMeta', 'saveDeskCountdownsMeta',
  'saveDeskLayout', 'renderDeskTexts', 'renderDeskImages', 'renderDeskCountdowns',
  'moveDeskText', 'moveDeskImage', 'moveDeskCountdown', 'addDeskText',
  'removeDeskText', 'removeDeskTextsOnPage', 'removeDeskImagesOnPage', 'removeDeskCountdownsOnPage',
];
const TOUCHED = PARTS.map((n) => extractBlock(src, n)).filter(Boolean).join('\n');

function deskSandbox(seed) {
  const ls = new Map(Object.entries(seed || {}));
  const store = {
    get: (k) => (ls.has(k) ? ls.get(k) : null),
    set: (k, v) => { ls.set(k, String(v)); },
    remove: (k) => { ls.delete(k); },
  };
  const toasts = [];
  const calls = { applyDeskLayout: 0 };
  let modalCb = null;
  const win = {
    applyDeskLayout: () => { calls.applyDeskLayout++; },
    openModal: (t, v, cb) => { modalCb = cb; },
    activePrefix: () => 'xy-home-v2:test',
    idbGet: null, idbSet: null, idbDelete: null,
  };
  const document = {
    createElement: (tag) => new FakeEl(tag, document),
    querySelector: (sel) => walkEl(document.body, sel, true),
    querySelectorAll: (sel) => walkEl(document.body, sel, false),
    getElementById: (id) => walkEl(document.body, '#' + id, true) || null,
    addEventListener: () => {},
  };
  document.body = new FakeEl('body', document);
  const pagesBox = new FakeEl('div', document);
  pagesBox.className = 'pages-box';
  document.body.appendChild(pagesBox);
  const sb = {
    store, document, window: win,
    pagesBox,
    toast: (t) => { toasts.push(String(t)); },
    DESK_PAGE_MIN, DESK_PAGE_MAX, DESK_IMG_SIZES, DESK_SEL_ALL,
    Date, Math, JSON,
    console: { info: () => {}, log: () => {}, error: () => {}, warn: () => {} },
  };
  const code = TOUCHED
    + '\n' + PARTS.map((n) => '__out.' + n + ' = (typeof ' + n + ' !== "undefined") ? ' + n + ' : undefined;').join('\n')
    + '\n__out.DESK_SEL_ALL = (typeof DESK_SEL_ALL !== "undefined") ? DESK_SEL_ALL : undefined;';
  sb.__out = {};
  vm.createContext(sb);
  vm.runInContext(code, sb, { timeout: 3000 });
  const el = (tag, cls) => { const n = new FakeEl(tag, document); if (cls) n.className = cls; return n; };
  const mk = (attr, val) => { const n = new FakeEl('div', document); n.setAttribute(attr, val); return n; };
  const slide0 = () => { const s0 = el('div', 'page-slide'); pagesBox.appendChild(s0); return s0; };
  const slide1 = () => { const s1 = el('div', 'page-slide'); pagesBox.appendChild(s1); return s1; };
  return {
    api: sb.__out,
    raw: (k) => (ls.has(k) ? ls.get(k) : null),
    lay: () => { const v = ls.get('desk-layout'); try { return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    toasts, calls,
    fireModal: (v) => { if (modalCb) modalCb(v); },
    body: document.body, pagesBox, el, mk, slide0, slide1,
  };
}
function domIds(slide) {
  return (slide.children || []).map((c) => c.getAttribute('data-desk-widget') || c.getAttribute('data-desk-text') || c.getAttribute('data-desk-image') || c.getAttribute('data-desk-countdown')).filter(Boolean);
}
const results = [];
function T(name, fn) { try { results.push([name, fn()]); } catch (e) { results.push([name, 'ERR ' + (e && e.message)]); } }

// ---------- S 源锚（构建者登记的 needle 同名同形，红侧＝没有） ----------
T('S1a DESK_SEL_ALL 定义行在位（四类选择器合集）', () => {
  return /const DESK_SEL_ALL = '\[data-desk-widget\],\[data-desk-text\],\[data-desk-image\],\[data-desk-countdown\]';/.test(src) ? true : 'FAIL';
});
T('S1b insertDeskNodeByLayout 定义行在位（渲染按布局定位插入）', () => {
  return /const insertDeskNodeByLayout = \(slide, node, id, pageArr\) => \{/.test(src) ? true : 'FAIL';
});
T('S1c syncDeskLayout 定义行在位（增删同步布局数组）', () => {
  return /const syncDeskLayout = \(addArr, removeArr\) => \{/.test(src) ? true : 'FAIL';
});
T('S1d home.css 跨域三行在位（安卓拖拽 touch-action 依赖；选择器三行共用同一声明块）', () => {
  return css.includes('.desk-move-mode [data-desk-text],')
    && css.includes('.desk-move-mode [data-desk-image],')
    && css.includes('.desk-move-mode [data-desk-countdown] { touch-action: none; cursor: grab; }') ? true : 'FAIL';
});
T('S1e 三个渲染器全部接 insertDeskNodeByLayout（恰 3 处调用，少一处＝该渲染器回插页底）', () => {
  const n = (src.match(/insertDeskNodeByLayout\(slide, node, m\.id, pageArr\);/g) || []).length;
  return n === 3 ? true : 'FAIL 命中 ' + n + ' 处';
});

// ---------- B 契约（红侧＝旧行为，恰红这批） ----------
T('B1 saveDeskLayout 收集四种组件 id（DOM 序，跨类型持久化）', () => {
  const s = deskSandbox({});
  const s0 = s.slide0(), s1 = s.slide1();
  s0.appendChild(s.mk('data-desk-widget', 'widgetA'));
  s0.appendChild(s.mk('data-desk-text', 'txt_1'));
  s0.appendChild(s.mk('data-desk-widget', 'widgetB'));
  s0.appendChild(s.mk('data-desk-image', 'img_1'));
  s0.appendChild(s.mk('data-desk-countdown', 'cd_1'));
  s1.appendChild(s.mk('data-desk-widget', 'widgetC'));
  if (!s.api.saveDeskLayout) return 'FAIL(旧侧无新 saveDeskLayout)';
  s.api.saveDeskLayout();
  const lay = s.lay();
  return lay && lay.length === 2
    && JSON.stringify(lay[0]) === JSON.stringify(['widgetA', 'txt_1', 'widgetB', 'img_1', 'cd_1'])
    && JSON.stringify(lay[1]) === JSON.stringify(['widgetC']) ? true : 'FAIL ' + JSON.stringify(lay);
});
T('B2 renderDeskTexts 页归属以布局数组为准（txt meta.page=1 但布局在页0 → 插到 widgetA 与 widgetB 之间）', () => {
  const s = deskSandbox({
    'desk-layout': JSON.stringify([['widgetA', 'txt_1', 'widgetB'], ['widgetC']]),
    'desk-texts': JSON.stringify([{ id: 'txt_1', page: 1, text: 'hi' }]),
  });
  const s0 = s.slide0(), s1 = s.slide1();
  const wa = s.mk('data-desk-widget', 'widgetA'); s0.appendChild(wa);
  const wb = s.mk('data-desk-widget', 'widgetB'); s0.appendChild(wb);
  s1.appendChild(s.mk('data-desk-widget', 'widgetC'));
  if (!s.api.renderDeskTexts) return 'FAIL';
  s.api.renderDeskTexts();
  const node = s0.children.find((c) => c.getAttribute('data-desk-text') === 'txt_1');
  if (!node) return 'FAIL txt 不在页0';
  const i = s0.children.indexOf(node);
  const ia = s0.children.indexOf(wa), ib = s0.children.indexOf(wb);
  return i > ia && i < ib ? true : 'FAIL 页0顺序=' + JSON.stringify(domIds(s0));
});
T('B3 renderDeskImages 跨页按布局归位（img meta.page=0 但布局在页1 → 落页1）', () => {
  const s = deskSandbox({
    'desk-layout': JSON.stringify([['widgetA'], ['img_1']]),
    'desk-images': JSON.stringify([{ id: 'img_1', page: 0, w: 100 }]),
  });
  const s0 = s.slide0(), s1 = s.slide1();
  s0.appendChild(s.mk('data-desk-widget', 'widgetA'));
  if (!s.api.renderDeskImages) return 'FAIL';
  s.api.renderDeskImages();
  return !!s1.children.find((c) => c.getAttribute('data-desk-image') === 'img_1') ? true : 'FAIL 落页=' + domIds(s0).join(',') + ' | ' + domIds(s1).join(',');
});
T('B4 渲染顺序与布局顺序相反时双向查找收敛到布局序（meta=[txt_2,txt_1]，布局=[txt_1,txt_2] → DOM 仍 txt_1,txt_2）', () => {
  const s = deskSandbox({
    'desk-layout': JSON.stringify([['txt_1', 'txt_2'], ['widgetC']]),
    'desk-texts': JSON.stringify([{ id: 'txt_2', page: 0, text: 'b' }, { id: 'txt_1', page: 0, text: 'a' }]),
  });
  const s0 = s.slide0(), s1 = s.slide1();
  s1.appendChild(s.mk('data-desk-widget', 'widgetC'));
  if (!s.api.renderDeskTexts) return 'FAIL';
  s.api.renderDeskTexts();
  return JSON.stringify(domIds(s0)) === '["txt_1","txt_2"]' ? true : 'FAIL ' + JSON.stringify(domIds(s0));
});
T('B5 moveDeskText 跨类型下移（txt_1 与相邻标准组件换位并持久化）', () => {
  const s = deskSandbox({
    'desk-layout': JSON.stringify([['txt_1', 'widgetA', 'widgetB'], ['widgetC']]),
    'desk-texts': JSON.stringify([{ id: 'txt_1', page: 0, text: 'hi' }]),
  });
  const s0 = s.slide0(), s1 = s.slide1();
  s0.appendChild(s.mk('data-desk-widget', 'widgetA'));
  s0.appendChild(s.mk('data-desk-widget', 'widgetB'));
  s1.appendChild(s.mk('data-desk-widget', 'widgetC'));
  if (!s.api.moveDeskText) return 'FAIL';
  s.api.moveDeskText('txt_1', 'down');
  const lay = s.lay();
  return lay && JSON.stringify(lay[0]) === '["widgetA","txt_1","widgetB"]'
    && s.toasts.includes('已下移') && s.calls.applyDeskLayout >= 1 ? true : 'FAIL lay=' + JSON.stringify(lay) + ' toasts=' + JSON.stringify(s.toasts);
});
T('B6 页首再上移 → toast「已在最前」且布局不动（旧版静默无操作）', () => {
  const s = deskSandbox({ 'desk-layout': JSON.stringify([['widgetA', 'widgetB'], ['widgetC']]) });
  const s0 = s.slide0(), s1 = s.slide1();
  s0.appendChild(s.mk('data-desk-widget', 'widgetA'));
  s0.appendChild(s.mk('data-desk-widget', 'widgetB'));
  s1.appendChild(s.mk('data-desk-widget', 'widgetC'));
  if (!s.api.moveDeskText) return 'FAIL';
  s.api.moveDeskText('widgetA', 'up');
  const lay = s.lay();
  return JSON.stringify(lay[0]) === '["widgetA","widgetB"]' && s.toasts.includes('已在最前') ? true : 'FAIL toasts=' + JSON.stringify(s.toasts);
});
T('B7 moveDeskImage 跨类型上移（img_1 与相邻标准组件换位）', () => {
  const s = deskSandbox({
    'desk-layout': JSON.stringify([['widgetA', 'img_1'], ['widgetC']]),
    'desk-images': JSON.stringify([{ id: 'img_1', page: 0, w: 100 }]),
  });
  const s0 = s.slide0(), s1 = s.slide1();
  s0.appendChild(s.mk('data-desk-widget', 'widgetA'));
  s1.appendChild(s.mk('data-desk-widget', 'widgetC'));
  if (!s.api.moveDeskImage) return 'FAIL';
  s.api.moveDeskImage('img_1', 'up');
  const lay = s.lay();
  return lay && JSON.stringify(lay[0]) === '["img_1","widgetA"]' && s.toasts.includes('已上移') ? true : 'FAIL lay=' + JSON.stringify(lay);
});
T('B8 moveDeskCountdown 跨类型下移（cd_1 与 widgetB 换位）', () => {
  const s = deskSandbox({
    'desk-layout': JSON.stringify([['widgetA', 'cd_1', 'widgetB'], ['widgetC']]),
    'desk-countdowns': JSON.stringify([{ id: 'cd_1', page: 0, title: 'x', date: '2099-01-01' }]),
  });
  const s0 = s.slide0(), s1 = s.slide1();
  s0.appendChild(s.mk('data-desk-widget', 'widgetA'));
  s0.appendChild(s.mk('data-desk-widget', 'widgetB'));
  s1.appendChild(s.mk('data-desk-widget', 'widgetC'));
  if (!s.api.moveDeskCountdown) return 'FAIL';
  s.api.moveDeskCountdown('cd_1', 'down');
  const lay = s.lay();
  return lay && JSON.stringify(lay[0]) === '["widgetA","widgetB","cd_1"]' && s.toasts.includes('已下移') ? true : 'FAIL lay=' + JSON.stringify(lay);
});
T('B9 addDeskText 同步布局数组（新 id 追加到所在页尾）', () => {
  const s = deskSandbox({ 'desk-layout': JSON.stringify([['widgetA'], ['widgetC']]) });
  const s0 = s.slide0(), s1 = s.slide1();
  s0.appendChild(s.mk('data-desk-widget', 'widgetA'));
  s1.appendChild(s.mk('data-desk-widget', 'widgetC'));
  if (!s.api.addDeskText) return 'FAIL';
  s.api.addDeskText(0);
  s.fireModal('你好世界');
  const texts = (() => { try { return JSON.parse(s.raw('desk-texts') || '[]'); } catch (e) { return []; } })();
  const lay = s.lay();
  const newId = texts[0] && texts[0].id;
  return texts.length === 1 && !!newId && texts[0].page === 0
    && lay && lay[0].length === 2 && lay[0][1] === newId ? true : 'FAIL texts=' + JSON.stringify(texts) + ' lay=' + JSON.stringify(lay);
});
T('B10 removeDeskText 同步布局数组（id 从布局剔除）', () => {
  const s = deskSandbox({
    'desk-layout': JSON.stringify([['widgetA', 'txt_1'], ['widgetC']]),
    'desk-texts': JSON.stringify([{ id: 'txt_1', page: 0, text: 'hi' }]),
  });
  const s0 = s.slide0(), s1 = s.slide1();
  s0.appendChild(s.mk('data-desk-widget', 'widgetA'));
  s1.appendChild(s.mk('data-desk-widget', 'widgetC'));
  if (!s.api.removeDeskText) return 'FAIL';
  s.api.removeDeskText('txt_1');
  const lay = s.lay();
  return lay && JSON.stringify(lay[0]) === '["widgetA"]' && JSON.stringify(lay[1]) === '["widgetC"]' ? true : 'FAIL lay=' + JSON.stringify(lay);
});
T('B11 removeDeskTextsOnPage 删页同步布局（页0 两个文字 id 全剔除，红侧＝残留）', () => {
  const s = deskSandbox({
    'desk-layout': JSON.stringify([['widgetA', 'txt_a', 'txt_b'], ['txt_c']]),
    'desk-texts': JSON.stringify([{ id: 'txt_a', page: 0, text: 'a' }, { id: 'txt_b', page: 0, text: 'b' }, { id: 'txt_c', page: 1, text: 'c' }]),
  });
  const s0 = s.slide0(), s1 = s.slide1();
  s0.appendChild(s.mk('data-desk-widget', 'widgetA'));
  s1.appendChild(s.mk('data-desk-widget', 'widgetC'));
  if (!s.api.removeDeskTextsOnPage) return 'FAIL';
  s.api.removeDeskTextsOnPage(0);
  const texts = JSON.parse(s.raw('desk-texts') || '[]');
  const lay = s.lay();
  return texts.length === 1 && texts[0].id === 'txt_c'
    && lay && JSON.stringify(lay[0]) === '["widgetA"]' && JSON.stringify(lay[1]) === '["txt_c"]' ? true : 'FAIL texts=' + JSON.stringify(texts) + ' lay=' + JSON.stringify(lay);
});
T('B12 removeDeskImagesOnPage 删页同步布局', () => {
  const s = deskSandbox({
    'desk-layout': JSON.stringify([['widgetA', 'img_a', 'img_b'], ['img_c']]),
    'desk-images': JSON.stringify([{ id: 'img_a', page: 0, w: 100 }, { id: 'img_b', page: 0, w: 100 }, { id: 'img_c', page: 1, w: 100 }]),
  });
  const s0 = s.slide0(), s1 = s.slide1();
  s0.appendChild(s.mk('data-desk-widget', 'widgetA'));
  s1.appendChild(s.mk('data-desk-widget', 'widgetC'));
  if (!s.api.removeDeskImagesOnPage) return 'FAIL';
  s.api.removeDeskImagesOnPage(0);
  const lay = s.lay();
  return lay && JSON.stringify(lay[0]) === '["widgetA"]' && JSON.stringify(lay[1]) === '["img_c"]' ? true : 'FAIL lay=' + JSON.stringify(lay);
});
T('B13 removeDeskCountdownsOnPage 删页同步布局', () => {
  const s = deskSandbox({
    'desk-layout': JSON.stringify([['widgetA', 'cd_a', 'cd_b'], ['cd_c']]),
    'desk-countdowns': JSON.stringify([{ id: 'cd_a', page: 0, title: 'a', date: '2099-01-01' }, { id: 'cd_b', page: 0, title: 'b', date: '2099-01-02' }, { id: 'cd_c', page: 1, title: 'c', date: '2099-01-03' }]),
  });
  const s0 = s.slide0(), s1 = s.slide1();
  s0.appendChild(s.mk('data-desk-widget', 'widgetA'));
  s1.appendChild(s.mk('data-desk-widget', 'widgetC'));
  if (!s.api.removeDeskCountdownsOnPage) return 'FAIL';
  s.api.removeDeskCountdownsOnPage(0);
  const lay = s.lay();
  return lay && JSON.stringify(lay[0]) === '["widgetA"]' && JSON.stringify(lay[1]) === '["cd_c"]' ? true : 'FAIL lay=' + JSON.stringify(lay);
});
T('B14 syncPageHint：只有自绘组件的页算有内容（不显示空白提示，红侧＝误显）', () => {
  const s = deskSandbox({ 'desk-texts': JSON.stringify([{ id: 'txt_1', page: 0, text: 'hi' }]) });
  const s0 = s.slide0();
  const hint = s.el('div', 'desk-page-hint');
  s0.appendChild(hint);
  s0.appendChild(s.mk('data-desk-text', 'txt_1'));
  if (!s.api.syncPageHint) return 'FAIL';
  s.api.syncPageHint(s0);
  return hint.style.display === 'none' ? true : 'FAIL display=' + JSON.stringify(hint.style.display);
});

// ---------- C 对照组（两侧皆绿＝没修过头） ----------
T('C1 deskLayout 校验硬约束不动：重复 id 的布局 → null 且清键（对照组）', () => {
  const s = deskSandbox({ 'desk-layout': JSON.stringify([['widgetA', 'widgetA'], ['widgetC']]) });
  if (!s.api.deskLayout) return 'FAIL';
  const r = s.api.deskLayout();
  return r === null && s.raw('desk-layout') === null ? true : 'FAIL r=' + JSON.stringify(r);
});
T('C2 saveDeskLayout 写前防损坏不动：DOM 重复 id → 放弃保存并清键（对照组）', () => {
  const s = deskSandbox({});
  const s0 = s.slide0(), s1 = s.slide1();
  s0.appendChild(s.mk('data-desk-widget', 'widgetA'));
  s0.appendChild(s.mk('data-desk-widget', 'widgetA'));
  s1.appendChild(s.mk('data-desk-widget', 'widgetC'));
  if (!s.api.saveDeskLayout) return 'FAIL';
  s.api.saveDeskLayout();
  return s.raw('desk-layout') === null ? true : 'FAIL ' + s.raw('desk-layout');
});
T('C3 无布局时渲染回退 meta.page（老数据渐进兼容，对照组）', () => {
  const s = deskSandbox({ 'desk-texts': JSON.stringify([{ id: 'txt_x', page: 0, text: 'hi' }]) });
  const s0 = s.slide0(), s1 = s.slide1();
  s0.appendChild(s.mk('data-desk-widget', 'widgetA'));
  s1.appendChild(s.mk('data-desk-widget', 'widgetC'));
  if (!s.api.renderDeskTexts) return 'FAIL';
  s.api.renderDeskTexts();
  return !!s0.children.find((c) => c.getAttribute('data-desk-text') === 'txt_x') ? true : 'FAIL';
});

// ---------- Z 零机型／零 UA ----------
T('Z1 本批触及 JS 零机型／零 UA 分支（CSS 只查 #1278 那三行，不扫全文件注释）', () => {
  const cssLine = '.desk-move-mode [data-desk-text],\n.desk-move-mode [data-desk-image],\n.desk-move-mode [data-desk-countdown] { touch-action: none; cursor: grab; }';
  return !/navigator\.userAgent|iPhone|iPad|Android|Chrome|MicroMessenger|Edge|Huawei|Xiaomi|isIOS/i.test(TOUCHED + cssLine) ? true : 'FAIL';
});
T('Z2 DESK_SEL_ALL 恰为四类属性选择器合集（防静默缩回只认标准组件）', () => {
  const s = deskSandbox({});
  return s.api.DESK_SEL_ALL === '[data-desk-widget],[data-desk-text],[data-desk-image],[data-desk-countdown]' ? true : 'FAIL ' + JSON.stringify(s.api.DESK_SEL_ALL);
});

let pass = 0, fail = 0;
for (const [name, r] of results) {
  if (r === true) { pass++; console.log('  ✅ ' + name); }
  else if (String(r).startsWith('SKIP')) { console.log('  ⏭️ ' + name + ' → ' + r); }
  else { fail++; console.log('  ❌ ' + name + ' → ' + r); }
}
console.log((fail ? '❌' : '✅') + ' verify-1278 ' + pass + '/' + fail + ' （personalize=' + pjPath + ' / home.css=' + cssPath + '）');
process.exit(fail ? 1 : 0);
