// #553 回复链/拍一拍「弹窗已承诺内容、900ms 后被撤回吞掉」修复验证（纯 Node，零浏览器依赖）
// （编号注：修复批最初按 #550 落盘，#550~#552 已被并行批次（设置页搜索/清数据/设备诊断）占用，
// 登记时顺延 #553——代码注释/哨兵/本脚本/台账统一 #553）
// 报障：OPPO Reno6 5G 雨见浏览器（Firefox 内核）「写信/发消息弹窗显示的字卡进聊天压根没有，
// 是其它字卡（如弹窗说早安、进聊天只剩对方撤回了一条消息+别的卡）」，用户明说其他设备型号
// 也有（与设备无关）。
// 根因：#345 同族——#345 只收口了 tryAutoSend（主动消息），回复链 replyOnce（scheduleReply/
// continueChat/拍一拍追问共经）与 sendPoke 仍在 addIn 弹桌面横幅/系统通知之后才掷 rc-prob
//（默认 25%）撤回签：通知承诺的内容 900ms 后 partialRetractMsg/retractMsg 撤回＝进聊天只剩
// 撤回墓碑/缺段正文＋同批其它字卡＝「弹窗说的那句话压根没有」。
// 修复：对齐 #345「投递前定生死」——命中撤回的本条 silent 静默落地（不弹横幅/系统通知、不播
// 音效，未读角标照增），900ms 后照常撤回；rc-refix 补发的替换消息保持正常投递。
// 本脚本抽取 replyOnce / sendPoke 真实源码跑结构断言：掷签时序/静默接线/守卫链被改坏立刻红。
// 配套哨兵：build.mjs FIX_SENTINELS '#550' 两条（needle=掷签/接线逻辑锚）。
// 用法：node tools/verify-reply-retract-order.mjs
import { readFileSync } from 'node:fs';

const text = readFileSync(new URL('../src/js/chat.js', import.meta.url), 'utf8');
const r0 = text.indexOf('async function replyOnce(');
const r1 = text.indexOf('window.continueChat = function () {', r0);
const p0 = text.indexOf('function sendPoke(action) {');
const p1 = text.indexOf('function savePokePref() {', p0);
if (r0 < 0 || r1 <= r0 || p0 < 0 || p1 <= p0) { console.error('抽取失败：找不到 replyOnce/sendPoke 源码段'); process.exit(2); }
const src = text.slice(r0, r1);
const poke = text.slice(p0, p1);

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } };

// R1 掷签时序：willRetractR 在首个 addIn 投递之前定生死（通知/横幅发出前已知生死）
const rollAt = src.indexOf("const willRetractR = hit(c['rc-prob']);");
const firstAddAt = src.indexOf('if (rep.spell && rep.spellOne) {');
ok(rollAt >= 0, '回复链撤回签 willRetractR 存在');
ok(rollAt >= 0 && firstAddAt > rollAt, '回复链掷签在首个 addIn 投递之前');

// R2 静默接线：四条 addIn 分支全部接 willRetractR（单气泡/逐卡连发/梦角/普通）
ok((src.match(/silent: silent \|\| willRetractR/g) || []).length === 3, '单气泡/梦角/普通分支 silent 接线（3 处）');
ok(src.includes('silent: si > 0 ? true : (silent || willRetractR),'), '逐卡连发分支 silent 接线');

// R3 旧形态清除：投递后才掷撤回签的旧形态不得残留（残留＝通知先弹、撤回后吞的老 bug 回来）
ok(!src.includes("if (hit(c['rc-prob'])) {"), '回复链旧「投递后再掷撤回签」形态已移除');
ok((src.match(/hit\(c\['rc-prob'\]\)/g) || []).length === 1, '回复链 rc-prob 全函数只掷一次（投递前）');

// R4 撤回动作与守卫仍在（撤回概率功能语义不变；#412 sameCid/null 守卫原样）
ok(/willRetractR\) \{[\s\S]{0,160}if \(!sameCid\(\) \|\| !m\) return;/.test(src), '撤回定时器保留 #412 sameCid/null 守卫');
ok(src.includes("partialRetractMsg(m, 'in');"), '局部撤回动作仍在');
ok(/rc-refix[\s\S]{0,200}replyOnce\(c, null\)/.test(src), 'rc-refix 补发替换消息正常投递（无 silent）');

// P 组：sendPoke 拍一拍追问同病同修
const rollAtP = poke.indexOf("const willRetractP = hit(c2['rc-prob']);");
const addAtP = poke.indexOf('const m2 = addIn(r.text, { type: r.type, silent: willRetractP });');
ok(rollAtP >= 0, '拍一拍撤回签 willRetractP 存在');
ok(rollAtP >= 0 && addAtP > rollAtP, '拍一拍掷签在 addIn 投递之前');
ok(addAtP >= 0, '拍一拍 addIn 静默接线 silent: willRetractP');
ok(/if \(willRetractP && m2\) \{/.test(poke), '拍一拍撤回定时器由 willRetractP && m2 门控（m2 空不撤）');
ok(poke.includes("retractMsg(m2, 'in');"), '拍一拍撤回动作仍在');
ok(!poke.includes("if (hit(c2['rc-prob'])) {"), '拍一拍旧「投递后掷签」形态已移除');

// F 组：#345 与共享出口未被本批削弱（同族先修不被覆盖）
ok(text.includes('silent: i > 0 || willRetract'), '#345 tryAutoSend 静默接线原样');
ok((text.match(/hit\(c\['rc-prob'\]\)|hit\(c2\['rc-prob'\]\)/g) || []).length === 3, '全文件 rc-prob 掷签共 3 处且全部前置（tryAutoSend/replyOnce/sendPoke）');
const addRecAt = text.indexOf('function addRec(rec)');
const addRecSrc = text.slice(addRecAt, addRecAt + 4000);
ok(/rec\.silent && !chatVisible\(\)\) \{\s*incChatUnread\(\);/.test(addRecSrc), 'silent 消息未读角标兜底仍在（badge 与内容一致）');

console.log(fail ? 'verify-reply-retract-order：' + fail + ' 断言失败' : 'verify-reply-retract-order：' + pass + '/' + (pass + fail) + ' 全过');
process.exit(fail ? 1 : 0);
