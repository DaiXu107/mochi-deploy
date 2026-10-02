// #225v2 顶部更新条「一版一弹」行为验证（纯 Node + vm 跑真实源码，零浏览器依赖）
// 用户口径修订：本站一天可能部署十几次，v1 的「24h 时间窗免打扰」已废——任何按时间压制
// 新版本提醒的设计都不成立。v2 语义（showVerBar 弹条门 verSeen）：
//   · 同一版本只弹一次：弹条即记（ver-update-notify，不依赖点按钮），记录永久有效不按时间过期；
//   · 更新的版本（ts 更大）立即照弹，无任何时间限制；
//   · ts 未知（SW 通道拉 version.json 失败）只在从没弹过条时照弹——弱网绕过免打扰的口子堵死，
//     真正的新版本由版本轮询通道在网络恢复后立即提醒，不会漏。
// 本脚本从 src/js/pwa.js 抽取 ver-update 段真实源码，在 vm 沙箱里逐场景跑行为断言。
// 用法：node tools/verify-ver-update-snooze.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const text = readFileSync(new URL('../src/js/pwa.js', import.meta.url), 'utf8');
const S0 = "const VER_ACK_KEY = 'xy-home-v2:ver-update-ack-ts';";
const S1 = '// ================= v3.6.x：新版本检测';
const s = text.indexOf(S0);
const e = text.indexOf(S1, s);
if (s < 0 || e < 0 || e <= s) { console.error('抽取失败：找不到 ver-update 源码段锚点'); process.exit(2); }
const src = text.slice(s, e);

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } };
const ACK = 'xy-home-v2:ver-update-ack-ts';
const NOTIFY = 'xy-home-v2:ver-update-notify';

// 沙箱环境：stub localStorage/document/toast/refreshNow；返回存储、假元素、上下文
function makeEnv(lsInit) {
  const store = Object.assign({}, lsInit);
  const els = {
    'ver-update-bar': { hidden: true },
    'ver-update-refresh': { onclick: null },
    'ver-update-close': { onclick: null },
  };
  const sb = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    document: { getElementById: (id) => els[id] || null },
    toast: () => { sb.__toasted = (sb.__toasted || 0) + 1; },
    refreshNow: () => { sb.__refreshed = (sb.__refreshed || 0) + 1; },
    Date, Number, String, isNaN,
  };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  return { store, els, sb };
}

// ---- 结构断言 ----
ok(src.includes("if (_verBarShown || !verShouldNotify(onlineTs) || verSeen(onlineTs)) return;"), '弹条门含 verSeen 一版一弹');
ok(src.indexOf('verMarkNotify(onlineTs)') > -1 && src.indexOf('verMarkNotify(onlineTs)') < src.indexOf("getElementById('ver-update-bar')"), '弹条即记 notify（先于 barEl 判定，不依赖点按钮）');
ok(!/Snooze|VER_SNOOZE/.test(src), 'v1 的 24h 时间窗（Snooze）已彻底移除');
ok(src.includes('verMarkAck(onlineTs)') && src.includes('ver-update-ack-ts'), '按版本 ack 机制保留（v3.26.x 语义不变）');

// ---- A 首弹（底线）：空存储弹出新版本 ----
{
  const env = makeEnv({});
  vm.runInContext('showVerBar(1000);', env.sb);
  ok(env.els['ver-update-bar'].hidden === false, 'A1 空存储新版本 → 弹条');
  ok(String(env.store[NOTIFY] || '').indexOf('1000|') === 0, 'A2 弹条即记 notify=1000|时刻');
  ok(env.store[ACK] == null, 'A3 未点按钮不写 ack');
}

// ---- B 同版本只弹一次（洞①核心）：不点按钮、隔多久重开都不再弹（无时间过期） ----
{
  const env = makeEnv({ [NOTIFY]: '1000|' + (Date.now() - 25 * 3600 * 1000) }); // 25h 前弹过
  vm.runInContext('showVerBar(1000);', env.sb);
  ok(env.els['ver-update-bar'].hidden === true, 'B1 同版本（哪怕 25h 前弹过）→ 不再弹');
}
// ---- C 新版本立即弹（站点主核心诉求）：一天部署十几次，每一次都第一时间提醒 ----
{
  const env = makeEnv({ [NOTIFY]: '1000|' + Date.now() }); // 刚弹过 1000
  vm.runInContext('showVerBar(1001);', env.sb);
  ok(env.els['ver-update-bar'].hidden === false, 'C1 弹过 1000 后部署 1001 → 立即弹（无时间窗）');
  const env2 = makeEnv({ [NOTIFY]: '1000|' + Date.now() });
  vm.runInContext('showVerBar(1015);', env2.sb);
  ok(env2.els['ver-update-bar'].hidden === false, 'C2 落后十几版（1015>1000）→ 立即弹');
}
// ---- D 弱网无 ts（洞②核心）：弹过任何版本就不再照弹；全新用户保留宁多勿漏 ----
{
  const env = makeEnv({ [NOTIFY]: '1000|' + Date.now() });
  vm.runInContext('showVerBar(undefined);', env.sb);
  ok(env.els['ver-update-bar'].hidden === true, 'D1 ts 未知（拉版本失败）+ 弹过条 → 不照弹');
  const env2 = makeEnv({});
  vm.runInContext('showVerBar(undefined);', env2.sb);
  ok(env2.els['ver-update-bar'].hidden === false, 'D2 全新用户 ts 未知 → 照弹（宁多勿漏保留）');
}
// ---- E 未知 ts 的记录不挡已知新版本 ----
{
  const env = makeEnv({ [NOTIFY]: '0|' + Date.now() });
  vm.runInContext('showVerBar(2000);', env.sb);
  ok(env.els['ver-update-bar'].hidden === false, 'E1 记录是未知 ts（0|T）→ 已知版本照弹');
}
// ---- F 点「稍后」：收起 + 写 ack；不再有任何时间窗静默 ----
{
  const env = makeEnv({});
  vm.runInContext('showVerBar(1000);', env.sb);
  vm.runInContext("document.getElementById('ver-update-close').onclick();", env.sb);
  ok(env.els['ver-update-bar'].hidden === true, 'F1 稍后 → 条收起');
  ok(env.store[ACK] === '1000', 'F2 稍后 → 写 ack=1000');
}
// ---- G 点「刷新使用新版」：ack + refreshNow ----
{
  const env = makeEnv({});
  vm.runInContext('showVerBar(1000);', env.sb);
  vm.runInContext("document.getElementById('ver-update-refresh').onclick();", env.sb);
  ok(env.sb.__refreshed === 1, 'G1 刷新按钮 → refreshNow 调用');
  ok(env.store[ACK] === '1000', 'G2 刷新按钮 → 写 ack');
}
// ---- H ack 兼容（v3.26.x 语义不变） ----
{
  const env = makeEnv({ [ACK]: '1000' });
  vm.runInContext('showVerBar(1000);', env.sb);
  ok(env.els['ver-update-bar'].hidden === true, 'H1 已 ack 同版本 → 不弹');
  const env2 = makeEnv({ [ACK]: '1000' });
  vm.runInContext('showVerBar(2000);', env2.sb);
  ok(env2.els['ver-update-bar'].hidden === false, 'H2 已 ack 旧版本 + 新部署 → 弹');
}

console.log(fail ? 'verify-ver-update-snooze：' + fail + ' 断言失败' : 'verify-ver-update-snooze：' + pass + '/' + (pass + fail) + ' 全过');
process.exit(fail ? 1 : 0);
