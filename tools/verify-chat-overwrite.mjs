// tools/verify-chat-overwrite.mjs — FIX-REGRESSION #90 专项校验（聊天记录「读取失败被当空库 → 整包覆盖」）
// 为什么需要它：#90 的每条修复都是「少一个判断就重新会丢数据」的守卫，构建哨兵只能证明
// 特征串还在，证明不了判断还接在对的位置上（并行会话重排/改写同一函数时最容易悄悄丢）。
// 本脚本读**源文件**做结构断言（不依赖构建产物），任一断言失败即 exit 1。
// 用法：node tools/verify-chat-overwrite.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(root, 'src', p), 'utf8');
const idb = src('js/idb.js');
const chat = src('js/chat.js');
const contacts = src('js/contacts.js');
const backup = src('js/data-backup.js');
const device = src('js/device.js');

let fail = 0;
const cases = [];
function check(name, ok, why) {
  cases.push({ name, ok: !!ok });
  if (!ok) { fail++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); }
}

// ---- 1) 存储层：三态探测接口存在，且旧接口保持「失败退化成空数组」的兼容契约 ----
check('idb.js 提供严格清单 idbListKeys', /window\.idbListKeys = function/.test(idb));
check('idb.js 提供严格存在性探测 idbHasKey', /window\.idbHasKey = function/.test(idb));
check('idbListKeys 用 IDB_LIST_FAILED 表示「没读到」（不是空数组）', /finish\(IDB_LIST_FAILED\)/.test(idb));
check('idbGetAllKeys 仍是 idbListKeys 的兼容包装（老调用方零行为变化）',
  /window\.idbGetAllKeys = function[\s\S]{0,160}idbListKeys\(\)[\s\S]{0,80}keys \|\| \[\]/.test(idb));
check('探测超时后会作废连接（dbPromise = null）', /dbPromise = null/.test(idb));
check('chat-meta 账本被排除出 #40 写日志', /:chat-meta\$/.test(idb) && /function wrjRecord[\s\S]{0,400}:chat-meta\$/.test(idb));

// ---- 2) chat.js：三处「读到 undefined」的复核必须走三态探测，只有 has===false 才认无历史 ----
const legacyMissConfirm = (chat.match(/const confirmMiss = window\.idbGetAllKeys/g) || []).length;
check('chat.js 不再有任何一处直接用 idbGetAllKeys 判定「键不存在」', legacyMissConfirm === 0,
  '残留 ' + legacyMissConfirm + ' 处：超时返回空数组会被当成空库 → 整包覆盖历史');
check('三处读库 undefined 复核都改走 idbHasKey（loadMsgs + 两条跨桌面追加）',
  (chat.match(/window\.idbHasKey\(/g) || []).length >= 3,
  '实际 ' + (chat.match(/window\.idbHasKey\(/g) || []).length + ' 处');
check('判定式仍是「只有 false 才算缺失」', (chat.match(/return has === false;/g) || []).length >= 3);
check('跨桌面追加：解析失败时不整包写回', (chat.match(/if \(!readOk\) return;/g) || []).length >= 2);

// ---- 3) chat.js：条数账本 + 缩水守卫接在每条整包落盘路径上 ----
check('账本/守卫函数在位', /function chatLedgerGuard/.test(chat) && /function chatLedgerLoad/.test(chat) && /function chatLedgerSave/.test(chat));
check('loadMsgs 读大键前先补读账本（大键读失败时唯一依据）', /chatLedgerLoad\(myPrefix\)/.test(chat));
check('读到权威后以库内条数为基线', /chatLedgerSave\(myPrefix, idbArr\.length[,)]/.test(chat));
check('saveMsgs 落盘前过守卫', /if \(!chatLedgerGuard\(myPrefix, msgs\)\) return;\s*\n\s*\/\/ v3\.26\.x OOM：大历史 IDB 直存数组（免整包 stringify），小历史仍字符串路径/.test(chat));
check('saveMsgsNow 落盘前过守卫', /if \(!chatLedgerGuard\(myPrefix, msgs\)\) return;\s*\n\s*\/\/ v3\.26\.x OOM：大历史 IDB 直存数组（免整包 stringify）\n/.test(chat));
check('后台归一化命中守卫时只跳过落盘、不中断渲染', /const canPersist = chatLedgerGuard\(myPre, msgs\)/.test(chat));
check('守卫命中后仍会暂存并强制重读合并（不吞新消息）', /pendingLocal = arr\.slice\(\)/.test(chat) && /loadMsgs\(true\)/.test(chat));
check('守卫阈值：基线 ≥300 且新条数不足一半才拦', /CHAT_LEDGER_MIN = 300/.test(chat) && /base >= CHAT_LEDGER_MIN && n \* 2 < base/.test(chat));
check('用户主动清空会归零账本', /clearChatHistory[\s\S]{0,600}chatLedger\[window\.activePrefix\(\)\] = 0/.test(chat));
check('主动整包导入后对齐账本', /chatImportMsgs[\s\S]{0,700}chatLedgerSave\(window\.activePrefix\(\), msgs\.length[,)]/.test(chat));

// ---- 4) contacts.js：不得再用「内存读空」当事实把 active-contact 写回 default ----
check('写 default 前先向 IDB 确认库里没有', /window\.idbHasKey\(G \+ ':active-contact'\)[\s\S]{0,160}has === false/.test(contacts));
check('桌面校正逻辑可直读 IDB 权威值（回填迟到也能切回）', /function applyCidCorrection/.test(contacts) && /idbGet\(G \+ ':active-contact'\)/.test(contacts));
check('校正仍受「用户手动切过/时机安全」双重守卫', /cidUserSwitched \|\| cidAutoFixTries >= 3/.test(contacts) && /if \(!autoFixMomentSafe\(\)\) return;/.test(contacts));

// ---- 5) data-backup.js：清单没读到时不得出具「完整」备份 ----
check('导出用严格三态清单', /window\.idbListKeys \? await window\.idbListKeys\(\)/.test(backup));
check('清单读取失败即中止导出并如实提示', /listed === null[\s\S]{0,300}导出未完成/.test(backup));
check('导入后聊天核对区分「没读到」与「确实没有」', /chatCheckOk/.test(backup) && /聊天记录未能核对/.test(backup));

// ---- 6) device.js：诊断要能定性「覆盖没了」vs「切错桌面」 ----
check('诊断含桌面归属体检', /桌面归属体检/.test(device));
check('体检三层并列 active-contact（读取值/裸 LS/IDB 权威值）', /active-contact：读取=[\s\S]{0,80}裸LS=[\s\S]{0,40}IDB=/.test(device));
check('体检含各桌面条数账本', /条数账本\(chat-meta\)/.test(device));
check('大键明细不再把「清单读取失败」显示成无大键', /清单读取失败（存储繁忙\/超时）/.test(device));

console.log('FIX-REGRESSION #90 聊天记录防覆盖 结构校验：' + (cases.length - fail) + '/' + cases.length + (fail ? ' 失败' : ' 全过'));
if (fail) { console.log('⚠ 有 ' + fail + ' 项缺失——#90 的守卫被改动或覆盖，聊天记录重新存在「读取失败=空库→整包覆盖」风险，修好再构建。'); process.exit(1); }
