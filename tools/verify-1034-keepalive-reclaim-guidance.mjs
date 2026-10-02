// verify-1034-keepalive-reclaim-guidance.mjs —— #1034「后台保活挂几分钟就被回收重载」口径四件套
// vivo X100s + Chrome 149 实报（诊断实证：JS堆 214.6MB／本页被系统回收 36 次／心跳断流 899s＝
// 后台页被内存策略冻结后丢弃，回来自动重载）。机制是浏览器的，app 侧能做的是：止住的动作讲到位、
// 恢复口径讲清楚（回收＝自动重载，开关自动恢复、保活碰一下页面自动接上、数据不丢）、兜底层（桌面图标+psync）。
// 断言（纯静态，#929 先例）：四张口子（诊断行 / 回收提示条 / 功能说明胶囊 / 行下红条+使用说明）全部带动作与恢复口径。
// #1199 口径跟改（勿改回去）：用户实报「这上面写的方法也没有用啊」——S1/S3 原锚的「Chrome 设置→性能→内存节省
//   程序／始终保持活动」是**标签页**开关，桌面快捷方式与独立 PWA 进程不受它约束，已换成系统省电/后台管控＋最近
//   任务锁定那几条真做得到的；S2/S5~S6、S8~S10 的恢复口径与其余口子一字未动。
    // #1370 口径跟改（同 #1199，勿改回去）：S4（功能说明胶囊）／S7（设置页行下红条）原锚的「Chrome 设置→性能→内存节省
    //   程序关掉＝最有效的一步」与 S1/S3 是同一句被用户实推翻的结论，只是 #1199 当时只改了诊断侧两面镜子。
    //   本批把剩下两面也换成「系统省电/后台管控＋最近任务锁定」，故 S4/S7 改认新句＋加一条「旧句不许回来」——
    //   判据方向不变（仍是「那一章在、且给的是做得到的动作」），旧文案复活时两侧同红。
// 用法：node tools/verify-1034-keepalive-reclaim-guidance.mjs [rootDir]（传干净基线＝全红对照）
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return null; } };
const dev = read('src/js/device.js'); const idx = read('index.html'); const bk = read('js/bg-keep.js');
const sh = read('js/settings-help.js'); const tpl = read('src/template.html'); const shSrc = read('src/js/settings-help.js');
const devSrc = read('src/js/device.js'); const bkSrc = read('src/js/bg-keep.js');
let pass = 0, fail = 0;
const A = (n, ok, x) => { if (ok) pass++; else fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !x ? '' : '  ← ' + x)); };
const has = (h, nd) => !!h && h.split(nd).length - 1 > 0;
const cnt = (h, nd) => (h ? h.split(nd).length - 1 : 0);
A('S1 诊断回收警告带「止住它最有效」动作（源+产物；#1199 换口径：安卓端真正收回后台的是系统省电/后台管控，Chrome 标签页开关对桌面快捷方式与独立 PWA 无效）', has(devSrc, '别从最近任务划掉本站，改为在系统设置→应用→本浏览器→省电里选「无限制/允许后台活动」') && has(idx, '别从最近任务划掉本站，改为在系统设置→应用→本浏览器→省电里选「无限制/允许后台活动」'));
A('S2 诊断回收警告带恢复口径（自动重载/碰一下接上/数据不丢）', has(devSrc, '数据不会丢：回到本页自动重载，保活碰一下页面即接上'));
A('S3 回收提示条带动作与恢复口径（产物 js/bg-keep.js；#1199 起方法在「怎么清」弹窗里，条本身只报事实＋不丢数据）', has(bk, '系统设置 → 应用 → 你用的浏览器 → 省电/电池') && has(bk, '被收回不会丢数据：回到本页会自动重载接上') && has(bk, '不是网站坏了，数据不会丢'));
A('S4 功能说明胶囊带「止住回收最有效的一步」章（产物 js/settings-help.js；#1370 换锚：动作在系统侧，旧那句标签页开关结论不许回来）', has(sh, '【止住回收最有效的一步】先去 系统设置 → 应用') && !has(sh, '【止住回收最有效的一步】Chrome：设置 → 性能'));
A('S5 功能说明胶囊带兜底层（桌面图标＋离线消息提醒）', has(sh, '页面被回收甚至全部关掉后，浏览器也会定时唤醒弹一条'));
A('S6 功能说明量化「几分钟也可能被丢」', has(shSrc, '手机内存紧张时更快——本页越重，几分钟也可能被丢'));
A('S7 行下红条带白名单动作与自动恢复口径（#1370 换锚同 S4：最有效那一步指向系统省电＋最近任务，旧句复活＝红）', has(tpl, '止住它最有效的一步＝去 系统设置 → 应用') && !has(tpl, '止住它最有效的一步＝Chrome 设置→性能') && has(tpl, '其实被回收后回到本页会自动重载：开关自动恢复、保活在你碰一下页面时就自动接上，数据不丢'));
A('S8 使用说明同口径同步（两处「几分钟也可能被丢」）', cnt(tpl, '手机内存紧张时更快——本页越重，几分钟也可能被丢') >= 2);
A('S9 既有口径不被破坏（截断成因/换新版说明仍在）', has(tpl, '别的 App 刷视频、听音乐会把保活截断') && has(tpl, '页面不会在后台自动换新版'));
A('S10 诊断既有取证行仍在（防误删）', has(devSrc, '历史取证：断流') && has(devSrc, '心跳='));
console.log('RESULT ' + (fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
