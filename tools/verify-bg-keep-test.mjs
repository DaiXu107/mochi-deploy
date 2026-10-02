// verify-bg-keep-test.mjs — #724 后台通知「测试」只写测试 + toast 收纳/驻留 + 保活电平分级与取证
// 用户直派（红米 K80 Chrome 实报、多机型同族）：
//   ①测试结果整段复读功能下方说明＝十几个 env 行撑爆黑框（「字飞出黑色框」）→ 断言复读行已从测试
//     移除、且说明仍在本行 gs-sub/功能说明（指引有真目标）；
//   ②#708 的 9s 驻留被 #cc-toast.show CSS 动画固定 2.6s forwards 吞掉＝「结果一闪就没、测试失效」
//     → 断言内联 animationDuration 随 dur + 结果 toast 驻留 6s；
//   ③受理≠挂出 → 断言回读 SW 通知队列的端到端归因（#8s 超时哨兵保留）；
//   ④保活失效（挂后台回来页面被刷新＝标签被丢弃）→ 断言电平余量分级（KA_VOL_BASE=0.2/MAX=0.35、
//     升级自愈）＋断流/暴毙取证计数（持久化 + probe 出口 + device.js 展示）。
// 用法：node tools/verify-bg-keep-test.mjs [rootDir]（缺省＝仓库根；传 HEAD 导出树＝RED 基线）
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return null; } };
const bg = read('src/js/bg-keep.js');
const dev = read('src/js/device.js');
const css = read('src/css/chat-pages.css');
const tpl = read('src/template.html');
const help = read('src/js/settings-help.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  ← ' + detail : ''));
};

if (bg == null) { console.log('FAIL 找不到 src/js/bg-keep.js（root=' + root + '）'); process.exit(1); }

console.log('【A 测试只写测试】（复读行全部移出 runTest；说明仍在功能行下方/功能说明，指引有真目标）');
const DUP_LINES = [
  '下拉通知栏找「后台通知测试」',
  '拦截统计（本次会话后台）',
  '主动发送：开启（每',
  '✗ 访问协议',
  // FIX #1014：本条原判据「✓ 通知权限：已允许」已撤——#724 要的是「别把功能下方说明整段复读」，
  //   而权限状态是这一轮点按下**现场读出来的体检结论**（用户直派「自测功能还是不完整」正是缺它），
  //   与另几条静态说明（协议要求/去重统计/版本说明）性质不同；实测当轮读数由本脚本 B 组另行断言。
  '✗ 联系人头像：无数据',
  '✗ 后台服务：当前浏览器不支持 Service Worker',
  '悬浮开关：系统设置→通知管理',
  '当前版本：'
];
for (const s of DUP_LINES) ok('复读行已移出测试：' + s.slice(0, 18) + '…', !bg.includes(s));
ok('测试仍发送真实测试通知（#708 真话文案保留，#708b 哨兵锚）', bg.includes('✓ 测试通知已发送并真正提交系统显示（Service Worker 通道：后台关屏也能弹）'));
ok('保活锚一行仍在（播放中/暂停/未开启三分支）', bg.includes("'✓ 后台保活：音频播放中'") && bg.includes("'! 后台保活：音频已暂停（回本页自动恢复；后台消息可能到不了）'") && bg.includes('✗ 后台保活：未开启（后台不产生消息，通知无从弹起）'));
ok('结果只指向「功能说明」不展开步骤（单行指引）', bg.includes('见本行「功能说明」排查'));
ok('说明真目标存在：template gs-sub 仍含悬浮通知步骤', !!tpl && tpl.includes('悬浮通知'));
ok('说明真目标存在：settings-help #bg-notify 胶囊仍在', !!help && /bg-notify/.test(help));

console.log('【B 驻留真生效 + toast 收纳】（#724b/#724f）');
ok('内联 animationDuration 随 dur（删=CSS 2.6s 固定动画继续吞掉自定义驻留）', bg.includes("t.style.animationDuration = (dur || 2600) + 'ms';"));
ok('测试结果 toast 驻留 6s（可读完两三行结论）', bg.includes("toast('测试结果：\\n' + env.join('\\n'), 6000)"));
ok('#cc-toast 按行渲染（white-space:pre-line，\\n 不再折成空格挤成一坨）', !!css && css.includes('white-space:pre-line;') && css.indexOf('#cc-toast') >= 0);
ok('#cc-toast 限高收纳（「字飞出黑色框」裁剪兜底）', !!css && css.includes('max-height:min(60vh, 420px);'));
ok('#cc-toast 长串强制断行（overflow-wrap，长 URL 不再横向飞出）', !!css && css.includes('overflow-wrap:break-word;'));

console.log('【C 端到端自检】（受理≠挂出：回读 SW 通知队列归因；#708c 超时哨兵保留）');
ok('队列回读判别式在位（#724a）', bg.includes("list.some(function (n) { return n && n.title === '后台通知测试'; })"));
ok('归因两分支：已入队列＝系统层拦截指引 / 未入队列＝多半被系统拦截', bg.includes('✓ 已确认进入系统通知队列') && bg.includes('! 已提交但未进系统通知队列'));
ok('8 秒超时哨兵保留（#708c 锚）', bg.includes('✗ 测试超时：通知发送链 8 秒未落定（应用内故障，非权限/系统问题）'));
ok('结果单飞闸（队列回读/超时/发送三路只出一次结果）', bg.includes('resultShown = true'));

console.log('【D 保活电平余量分级】（#724c：新内核 audible 收紧→豁免丢失→后台冻结/丢弃＝「点回来被刷新」）');
ok('分级常量在位（KA_VOL_BASE=0.2 / KA_VOL_MAX=0.35）', /const KA_VOL_BASE = 0\.2, KA_VOL_MAX = 0\.35;/.test(bg));
ok('启动音量走基础档（自定义音频仍 volume=1 不动）', /keepEl\.volume\s*=\s*kaCustomAudio\s*\?\s*1\s*:\s*KA_VOL_BASE\s*;/.test(bg));
ok('恢复默认音频同吃基础档（原硬编码 0.05 已收口）', !bg.includes('keepAudio.el.volume = 0.05;') && bg.includes('keepAudio.el.volume = KA_VOL_BASE;'));
ok('断流命中升级自愈（回前台断流取证→音量升 MAX 一档、不回改）', bg.includes('keepAudio.el.volume = KA_VOL_MAX;'));
ok('iOS 不受影响注释在位（WebKit 忽略 volume，amp 0.002 不动）', bg.includes('WebKit 忽略 <audio>.volume'));

console.log('【E 保活失效取证】（#724d：断流/后台暴毙计数持久化 + probe 出口 + 诊断展示）');
ok('取证键 __ka-ev 持久化', bg.includes("gSet('__ka-ev'"));
ok('暴毙判别式（无 resumed 且无 bye＝上个后台会话没活着回来）', bg.includes('if (old && old.n > 0 && !old.resumed && !old.bye)'));
ok('pagehide 告别标记（关标签/导航有、进程被杀没有＝判别依据）', bg.includes("window.addEventListener('pagehide'"));
ok('断流判据（隐藏期最后一拍距回前台 >90s）', bg.includes('kaHb.resumed - kaHb.ts > 90000'));
ok('__kaProbe 出口带取证计数', bg.includes('ev: { stall: kaEv.stall, died: kaEv.died }'));
if (dev != null) ok('device.js【保活现场】展示取证历史（#724e）', dev.includes("'历史取证：断流' + kp.ev.stall + '次/后台终止' + kp.ev.died + '次"));
else console.log('SKIP device.js 断言（该 root 无 device.js）');

console.log('RESULT ' + (fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
