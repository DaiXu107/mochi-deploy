// #345 TA主动消息「通知已弹、进聊天被吞」修复验证（纯 Node，零浏览器依赖）
// 报障：红米 K80 Chrome「联系人刚刚主动发送的消息，我点进聊天看，被吞了」，用户明说其他
// 设备型号也有（与设备无关）。K80 诊断时间线：06:33 切后台→06:48 回前台，保活音频/WebRTC
// 全程存活，消息在后台期到达、系统通知已弹。
// 根因：tryAutoSend 里横幅/系统通知在 addIn 同步链内发出（showDeskMsg→showDeskPopup
// isHidden 分支→bgNotifyCheck），而 rc-prob（默认 25%）撤回签是 900ms 后才掷、rc-refix
//（35%）未命中不补发——通知承诺的内容进聊天只剩「对方撤回了一条消息」＝被吞。
// 修复：撤回签（willRetract）提前到 addIn 之前掷；命中撤回的本条 silent 落地（不弹横幅/
// 系统通知，未读角标照增），900ms 后照常撤回；rc-refix 补发的替换消息走正常投递（无 silent）。
// 本脚本抽取 tryAutoSend 真实源码跑结构断言：掷签时序/静默接线/守卫链被改坏立刻红。
// 配套哨兵：build.mjs FIX_SENTINELS '#345'（needle=silent 接线表达式）。
// 用法：node tools/verify-proactive-retract.mjs
import { readFileSync } from 'node:fs';

const text = readFileSync(new URL('../src/js/chat.js', import.meta.url), 'utf8');
const s = text.indexOf('function tryAutoSend()');
const e = text.indexOf('const chatApp = document.querySelector', s);
if (s < 0 || e < 0 || e <= s) { console.error('抽取失败：找不到 tryAutoSend 源码段'); process.exit(2); }
const src = text.slice(s, e);

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } };

// S1 掷签时序：willRetract 在 addIn 之前定生死（撤回决定先于通知/横幅发出）
const rollAt = src.indexOf("const willRetract = hit(c['rc-prob']);");
const addAt = src.indexOf('const m = addIn(am.text,');
ok(rollAt >= 0, '撤回签 willRetract 存在');
ok(rollAt >= 0 && addAt > rollAt, '掷签在 addIn 投递之前（通知发出前已知生死）');

// S2 静默接线：命中撤回的本条 silent 落地——不弹横幅/系统通知（bgNotifyCheck 只在
// showDeskPopup 的 isHidden 分支被调，silent 使 addRec 不走 showDeskMsg），未读角标照增
ok(addAt > 0 && /silent: i > 0 \|\| willRetract/.test(src), 'addIn 静默接线 silent: i > 0 || willRetract');

// S3 撤回定时器：由 willRetract && m 门控（投递前已知要撤；m 为空＝实时去重吞并，无可撤）
ok(/if \(willRetract && m\) \{/.test(src), '撤回定时器由 willRetract && m 门控');
ok(/willRetract && m[\s\S]{0,80}setTimeout\(\(\) => \{\s*if \(!sameAutoCid\(\)\) return;/.test(src), '撤回定时器入口保留 #187 sameAutoCid 拦截');
ok(/retractMsg\(m, 'in'\);/.test(src), '撤回动作仍在（撤回概率功能语义不变）');

// S4 旧实现清除：投递后才掷撤回签的旧形态不得残留（残留＝通知先弹、撤回后吞的老 bug 回来）
ok(!/addIn\(am\.text[\s\S]{0,220}if \(hit\(c\['rc-prob'\]\)\) \{/.test(src), '旧「投递后再掷撤回签」形态已移除');

// S5 补发消息正常投递：rc-refix 命中的替换消息不带 silent（此刻弹通知名正言顺，内容不会再消失）
ok(/rc-refix[\s\S]{0,260}addIn\(pick\(pool\.text\) \|\| '…', \{ initiative: true \}\)/.test(src), '补发替换消息走正常投递（无 silent）');

// S6 #187 守卫链未被本批削弱（跨桌面串字卡防线原样）
ok((src.match(/if \(!sameAutoCid\(\)\) return;/g) || []).length >= 5, '#187 守卫总数 ≥5 仍在');
ok(/const sameAutoCid = \(\) => \(window\.__activeCid \|\| 'default'\) === autoCid;/.test(src), '#187 入口 cid 捕获仍在');

// S7 未读角标兜底未被动：silent + 聊天不可见仍计未读（墓碑也是未读事件，角标与内容一致）
const addRecAt = text.indexOf('function addRec(rec)');
const addRecSrc = text.slice(addRecAt, addRecAt + 4000);
ok(/rec\.silent && !chatVisible\(\)\) \{\s*incChatUnread\(\);/.test(addRecSrc), 'silent 消息未读角标兜底仍在（badge 与内容一致）');

// S8 通知出口未被改动：bgNotifyCheck 仍只在 showDeskPopup isHidden 分支（不绕过既有闸门）
const popupAt = text.indexOf('function showDeskPopup(opts)');
const popupSrc = text.slice(popupAt, text.indexOf('if (!deskMsgEl || !deskMsgEnabled())', popupAt));
ok(/isHidden[\s\S]{0,200}bgNotifyCheck/.test(popupSrc), '系统通知出口仍在 showDeskPopup isHidden 分支（闸门链原样）');

console.log(fail ? 'verify-proactive-retract：' + fail + ' 断言失败' : 'verify-proactive-retract：' + pass + '/' + (pass + fail) + ' 全过');
process.exit(fail ? 1 : 0);
