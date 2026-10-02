// ===== 回归脚本：此间梦角「删除后不再自动播种」＋「时辰浮层取消丢掉整个添加」（#892） =====
// 用法：node tools/verify-cjian-reseed.mjs   （MOCHI_ROOT 可指向隔离副本）
// 症状（用户直派 2026-09-20）：
//   ① 在此间删除梦角想重设时间流 → 名单删空后永远停在「此间还没有梦角」，再也不自动播种
//      （根因：pickDel 不清 cjian-seeded 标记；对照 healBelonging「搬空后清标记」语义）；
//   ② 手动添加梦角选完时间偏移（如「独立时间流」）后，时辰浮层点「取消」＝整个放弃添加，
//      名字与偏移全丢、梦角没建出来（用户以为「设置不了随机时间流」）。
// 修复：
//   ① pickDel 删空名单时清 SEED_KEY（下次打开此间自动重种默认梦角）；
//   ② 时辰浮层「取消」与「不限定 · 用时间偏移」同路：按已选偏移照常建档。
// 用例（vm 行为断言，真实 cjian.js 源码跑在桩环境里）：
//   B1 删空名单 → cjian-seeded 标记被清；openCjian 后自动重种默认梦角（own:1，名字=TA 昵称链）
//   B2 删到只剩 0 个才清标记：多梦角删一个 → 标记仍在、不触发重种
//   B3 添加流程（add→名字→独立时间流）→ 时辰浮层点「取消」→ 梦角仍建档（无 slots、偏移≠0）
//   B4 同流程点「确定」全选时辰 → 建档带 slots（原路径零回归）
//   B5 同流程点「不限定 · 用时间偏移」→ 建档无 slots（原路径零回归）
//   Z  零 JS 异常
// RED 基线（HEAD 的 src/js/cjian.js）：B1/B3 红，B2/B4/B5 绿（旧行为本就如此）
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = process.env.MOCHI_ROOT ? normalize(process.env.MOCHI_ROOT) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const EXPECT = process.env.MOCHI_EXPECT || 'green';
let pass = 0, fail = 0;
function A(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  ← ' + JSON.stringify(extra) : '')); }
}

// ---- 桩环境 ----
function makeEnv(contactName) {
  const data = new Map(); // prefix|key -> value
  const storeOf = (prefix) => ({
    get: (k) => data.has(prefix + '|' + k) ? data.get(prefix + '|' + k) : null,
    set: (k, v) => { data.set(prefix + '|' + k, String(v)); },
    remove: (k) => { data.delete(prefix + '|' + k); }
  });
  const listeners = {};
  function fakeEl(tag) {
    const el = {
      tag, style: { cssText: '' }, children: [], _ls: {},
      textContent: '', innerHTML: '', id: '', className: '', hidden: false, type: '',
      appendChild(c) { el.children.push(c); return c; },
      insertBefore(c) { el.children.push(c); return c; },
      addEventListener(t, fn) { (el._ls[t] = el._ls[t] || []).push(fn); },
      removeAttribute() {}, setAttribute() {},
      remove() {},
      classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
      click() { (el._ls.click || []).forEach(fn => fn({ stopPropagation() {} })); }
    };
    return el;
  }
  const body = fakeEl('body');
  const pages = { 'page-cjian': Object.assign(fakeEl('div'), { hidden: true }) };
  const documentStub = {
    readyState: 'complete',
    body,
    getElementById: (id) => pages[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (t) => fakeEl(t),
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); }
  };
  const win = {
    __activeCid: 'default',
    xyStore: storeOf,
    getContacts: () => [{ id: 'default', name: contactName }],
    toast: () => {},
    mochiDataPending: () => false,
    mochiLoadingHtml: () => '<div></div>'
  };
  win.window = win;
  const sandbox = {
    window: win, document: documentStub, console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Object, Array, String, Number, isNaN, parseInt
  };
  vm.createContext(sandbox);
  return { win, data, storeOf, body, listeners, sandbox };
}

function runCjian(env) {
  const src = readFileSync(join(root, 'src/js/cjian.js'), 'utf8');
  vm.runInContext(src, env.sandbox, { filename: 'cjian.js' });
}

const CONTACT = '景元';
const CID_STORE = 'xy-home-v2:default';

// ---- B1：删空名单 → 清标记 → openCjian 自动重种 ----
{
  console.log('B1 删空名单恢复自动播种:');
  const env = makeEnv(CONTACT);
  env.data.set(CID_STORE + '|cjian-roster', JSON.stringify([{ id: 'd1', name: CONTACT, offsetMin: 0, cid: 'default', own: 1 }]));
  env.data.set(CID_STORE + '|cjian-seeded', '1');
  runCjian(env);
  const ctlHolder = {};
  env.win.openModal = (title, val, cb) => {
    ctlHolder.cb = cb;
    return { stay() {}, title() {}, hint() {}, input() {}, maxLen() {}, ph() {}, okText() {}, pills() {} };
  };
  env.win.cjianManage();
  ctlHolder.cb('del');   // action → pickDel
  ctlHolder.cb('d1');    // 确认删除
  const seedAfterDel = env.data.get(CID_STORE + '|cjian-seeded');
  A('B1a 删空名单后 cjian-seeded 标记被清', seedAfterDel == null, seedAfterDel);
  const rosterEmpty = JSON.parse(env.data.get(CID_STORE + '|cjian-roster') || '[]');
  A('B1b 名单确实为空', rosterEmpty.length === 0, rosterEmpty);
  env.win.openCjian(); // 下次打开此间 → seedIfEmpty 重种
  const roster2 = JSON.parse(env.data.get(CID_STORE + '|cjian-roster') || '[]');
  A('B1c 重新打开此间自动重种 1 位默认梦角', roster2.length === 1, roster2);
  A('B1d 重种的是 own 标记本尊、名字=TA 昵称链', roster2.length === 1 && roster2[0].own === 1 && roster2[0].name === CONTACT, roster2[0]);
  A('B1e 重种后标记回位（不会每次打开重复种）', env.data.get(CID_STORE + '|cjian-seeded') === '1');
}

// ---- B2：多梦角删一个 → 标记保留 ----
{
  console.log('B2 删一个不触发重种:');
  const env = makeEnv(CONTACT);
  env.data.set(CID_STORE + '|cjian-roster', JSON.stringify([
    { id: 'd1', name: CONTACT, offsetMin: 0, cid: 'default', own: 1 },
    { id: 'd2', name: '白露', offsetMin: 60, cid: 'default', manual: 1 }
  ]));
  env.data.set(CID_STORE + '|cjian-seeded', '1');
  runCjian(env);
  const ctlHolder = {};
  env.win.openModal = (t, v, cb) => { ctlHolder.cb = cb; return { stay() {}, title() {}, hint() {}, input() {}, maxLen() {}, ph() {}, okText() {}, pills() {} }; };
  env.win.cjianManage();
  ctlHolder.cb('del');
  ctlHolder.cb('d2');
  A('B2a 还有剩时 cjian-seeded 仍在（不误触发重种）', env.data.get(CID_STORE + '|cjian-seeded') === '1');
  const roster = JSON.parse(env.data.get(CID_STORE + '|cjian-roster') || '[]');
  A('B2b 只删了目标那一位', roster.length === 1 && roster[0].id === 'd1', roster);
}

// ---- B3/B4/B5：添加流程三种时辰浮层出口 ----
async function addFlow(pick) {
  const env = makeEnv(CONTACT);
  runCjian(env);
  const ctlHolder = {};
  env.win.openModal = (t, v, cb) => { ctlHolder.cb = cb; return { stay() {}, title() {}, hint() {}, input() {}, maxLen() {}, ph() {}, okText() {}, pills() {} }; };
  env.win.cjianManage();
  ctlHolder.cb('add');     // action → name
  ctlHolder.cb('小柒');     // name → offset
  ctlHolder.cb('rand');    // 独立时间流 → phase='', setTimeout(showSlotPicker)
  await new Promise(r => setTimeout(r, 20));
  const mask = env.body.children.find(c => c.id === 'cj-slot-mask');
  if (!mask) return { env, error: 'no slot mask' };
  // mask > box > [h, sub, grid, btns(取消,确定), skip?]
  const box = mask.children[0];
  const btns = box.children[3];
  const cancelBtn = btns.children[0]; // 取消
  const okBtn = btns.children[1];     // 确定
  const skipBtn = box.children[4];    // 不限定 · 用时间偏移
  if (pick === 'cancel') cancelBtn._ls.click.forEach(fn => fn({}));
  else if (pick === 'ok') okBtn._ls.click.forEach(fn => fn({}));
  else if (pick === 'skip') skipBtn._ls.click.forEach(fn => fn({}));
  await new Promise(r => setTimeout(r, 10));
  const roster = JSON.parse(env.data.get(CID_STORE + '|cjian-roster') || '[]');
  return { env, roster };
}
{
  console.log('B3 时辰浮层「取消」仍建档:');
  const { roster, error } = await addFlow('cancel');
  A('B3a 取消后梦角已建档（不再整个放弃）', roster && roster.length === 1, error || roster);
  A('B3b 名字与「独立时间流」偏移保留（无 slots、偏移≠0）',
    roster && roster.length === 1 && roster[0].name === '小柒' && !('slots' in roster[0]) && roster[0].offsetMin !== 0, roster && roster[0]);
}
{
  console.log('B4 时辰浮层「确定」带 slots（原路径零回归）:');
  const { roster, error } = await addFlow('ok');
  A('B4a 确定后建档且带 slots',
    roster && roster.length === 1 && Array.isArray(roster[0].slots) && roster[0].slots.length === 12, error || roster);
}
{
  console.log('B5 「不限定 · 用时间偏移」建档（原路径零回归）:');
  const { roster, error } = await addFlow('skip');
  A('B5a 不限定后建档且无 slots',
    roster && roster.length === 1 && !('slots' in roster[0]) && roster[0].name === '小柒', error || roster);
}

console.log('Z 零异常: 上述各步若抛错脚本已中断');
console.log('结果: ' + pass + ' 过 / ' + fail + ' 红');
process.exit(fail ? 1 : 0);
