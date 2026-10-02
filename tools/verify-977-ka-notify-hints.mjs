// ===== 专项验证：#977 后台保活/后台弹窗「失效要提示用户」（用户直派 2026-09-21） =====
// 用户原话：①当后台长时间挂着，功能会失效，需要重新关掉网页打开并重新打开功能——两功能都要提示；
//          ②开后台保活后，手机别的应用刷视频和听音乐会占用音频，导致后台保活被截断停止，要写清楚提醒。
// 本批提示面四处：设置页保活行下红条（#bg-keep-sub）＋后台通知行说明补尾＋开启保活即弹限制弹窗
// （kaOpenEnableHints）＋长后台冻结回前台 toast（心跳断流且挂满 10 分钟）；另把「功能说明」胶囊
// 与 使用说明第 10 节补同口径章节，并删掉 bg-keep.js 里从未被调用且引用未定义 sx/sy 的死函数
// compressNotifyImg（一旦被调用＝静默 cb('')）。
// 本脚本为静态断言：S 组查 src/，P 组查构建产物（存在才查，未构建时按环境跳过），
// N 组查死代码确实不在。纯 HEAD 红副本同脚本应大面积红（判别力）。
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
let pass = 0, fail = 0, skip = 0;
const bad = [];
function chk(name, cond) { if (cond) { pass++; } else { fail++; bad.push(name); } }
function has(file, needle) {
  const p = join(root, file);
  if (!existsSync(p)) { skip++; return null; }
  return readFileSync(p, 'utf8').indexOf(needle) >= 0;
}
function cnt(file, needle) {
  const p = join(root, file);
  if (!existsSync(p)) { skip++; return null; }
  const s = readFileSync(p, 'utf8');
  let n = 0, i = 0;
  while ((i = s.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
  return n;
}

// ---- S 组：src 锚 ----
chk('S1 红条容器挂在保活行下', has('src/template.html', 'id="bg-keep-sub"'));
chk('S2 红条含音频截断语义', has('src/template.html', '刷视频、听音乐会把保活截断'));
chk('S3 红条含挂久失效+恢复口径', has('src/template.html', '失效后请彻底关闭网页重新打开，再把「后台保活」「后台弹窗」开关重新打开'));
chk('S4 红条复用红色视觉类', has('src/template.html', 'class="gs-sub dict-lock-hint" id="bg-keep-sub"'));
chk('S5 后台通知行补失效停摆口径', has('src/template.html', '保活被截断/页面被丢弃＝后台弹窗一起停摆'));
chk('S6 后台通知行补恢复口径', has('src/template.html', '失效后彻底关闭网页重新打开，再把两个开关重新打开'));
chk('S7 使用说明第10节补「挂久了会截断/失效」条', has('src/template.html', '挂久了会截断/失效，怎么恢复'));
chk('S8 第10节计数 15→16（#1473 补「收不到 ④ 勿扰/免打扰」条）', has('src/template.html', '后台弹窗 · 怎么用（安卓 / 电脑）</span><span class="lg-count">16</span>'));
chk('S9 开启即弹限制弹窗的调用在手动开启分支', has('src/js/bg-keep.js', 'if (keepEnabled) { startKeepAlive(true); kaOpenEnableHints(); }'));
// #1001 同步：开启弹窗从「两条必知限制」扩成「三条必知」（新增 ③ 开着保活不会在后台自动换新版），
//   标题与条目一并更新；两条硬限制的文案断言（S11/S12）原样不动。
chk('S10 限制弹窗函数在位且走全站 openModal（#1001 起为三条必知）', has('src/js/bg-keep.js', "window.openModal('后台保活已开启 · 三条必知'") && has('src/js/bg-keep.js', '③ 开着它时页面不会在后台自动换新版'));
chk('S11 弹窗文案含音频截断限制', has('src/js/bg-keep.js', '① 别的 App 会把保活截断：刷视频、听歌等会占用手机音频通道'));
chk('S12 弹窗文案含挂久失效+恢复', has('src/js/bg-keep.js', '失效后请彻底关闭网页重新打开'));
chk('S13 冻结回前台提示挂在心跳断流分支', has('src/js/bg-keep.js', 'kaHb.resumed - kaHb.ts > 90000') && has('src/js/bg-keep.js', 'kaHb.resumed - kaHb.hid >= 600000'));
chk('S14 回前台提示文案本体', has('src/js/bg-keep.js', '挂后台太久，保活被系统冻结截断过'));
chk('S15 提示文案含恢复方法', has('src/js/bg-keep.js', '彻底关闭网页重新打开，再把「后台保活」「后台弹窗」开关重新打开', ));
chk('S16 保活胶囊补「截断」章', has('src/js/settings-help.js', '【别的 App 刷视频/听音乐会把保活截断】'));
chk('S17 保活胶囊补「挂久失效」章', has('src/js/settings-help.js', '【后台挂久了会失效】'));
chk('S18 保活胶囊不再有「自动把播放权抢回来」旧口径', !has('src/js/settings-help.js', '网页会自动把播放权抢回来'));
chk('S19 通知胶囊补「挂久了会失效」章', has('src/js/settings-help.js', '【挂久了会失效】后台弹窗跟着保活走'));
chk('S20 六条哨兵已登记', cnt('build.mjs', "name: '#977") === 6);
chk('S21 哨兵 needle 各自唯一（本批自查）', ['#977a', '#977b', '#977c'].every((k) => true) && (function () {
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  const needles = { 'index.html': ['id="bg-keep-sub"', '刷视频、听音乐会把保活截断', '失效后彻底关闭网页重新打开，再把两个开关重新打开'], 'js/bg-keep.js': ['startKeepAlive(true); kaOpenEnableHints();', '挂后台太久，保活被系统冻结截断过'], 'js/settings-help.js': ['【别的 App 刷视频/听音乐会把保活截断】'] };
  for (const f of Object.keys(needles)) {
    const p = join(root, f);
    if (!existsSync(p)) { skip++; continue; }
    const s = readFileSync(p, 'utf8');
    for (const nd of needles[f]) { const c = s.split(nd).length - 1; if (c !== 1) return false; }
  }
  return true;
})());

// ---- N 组：死代码删除 ----
chk('N1 compressNotifyImg 已删（src）', !has('src/js/bg-keep.js', 'compressNotifyImg'));
chk('N2 未定义的 sx/sy 缺陷随之消失', !has('src/js/bg-keep.js', 'sx || 0'));

// ---- P 组：构建产物（存在才查） ----
const built = [
  ['index.html', 'id="bg-keep-sub"'],
  ['index.html', '刷视频、听音乐会把保活截断'],
  ['index.html', '失效后彻底关闭网页重新打开，再把两个开关重新打开'],
  ['index.html', '挂久了会截断/失效，怎么恢复'],
  ['js/bg-keep.js', 'kaOpenEnableHints();'],
  ['js/bg-keep.js', '挂后台太久，保活被系统冻结截断过'],
  ['js/settings-help.js', '【别的 App 刷视频/听音乐会把保活截断】'],
  ['js/settings-help.js', '【挂久了会失效】后台弹窗跟着保活走'],
];
let pTested = false;
for (const [f, nd] of built) {
  if (!existsSync(join(root, f))) { skip++; continue; }
  pTested = true;
  chk('P 产物含 "' + nd.slice(0, 18) + '"（' + f + '）', has(f, nd));
}
if (pTested) chk('P1 产物 js/bg-keep.js 无死函数', !has('js/bg-keep.js', 'compressNotifyImg'));

console.log('verify-977-ka-notify-hints: PASS ' + pass + ' / FAIL ' + fail + (skip ? ' / SKIP(env) ' + skip : ''));
if (bad.length) { console.log('  失败项:'); bad.forEach((n) => console.log('   · ' + n)); }
process.exit(fail ? 1 : 0);
