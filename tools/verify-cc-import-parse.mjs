// #171 字卡导入「格式错误」分流/自救 行为验证（纯 Node，零浏览器依赖）
// 立项：iOS16 Safari 导 milk json 报「格式错误」无法导入——旧版一个 catch 把三类完全不同的
// 失败（JSON 解析失败／文件转存损坏／导入处理自身抛错）混成同一句提示，真因不可见。
// 修复：拆三类提示 + 自救链（UTF-16 转存重读／裁剪提取首{到末}）+ 失败现场写 __jsErrors。
// 本脚本从 src/js/chatcard.js 抽取**真实的 pickImportFile 函数源码**，注入桩环境跑行为断言
// ——函数被改坏（自救链被删／错误分流回一个 catch）这里立刻红，不依赖浏览器。
// 用法：node tools/verify-cc-import-parse.mjs
import { readFileSync } from 'node:fs';

const srcPath = new URL('../src/js/chatcard.js', import.meta.url);
const text = readFileSync(srcPath, 'utf8');
const startIdx = text.indexOf('function pickImportFile');
const endAnchor = '    // 按模式写入：merge 分组内去重合并';
const endIdx = text.indexOf(endAnchor);
if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
  console.error('抽取失败：找不到 pickImportFile 或收尾锚点（函数被改名/挪动？）');
  process.exit(2);
}
const fnSrc = text.slice(startIdx, endIdx);

// ——桩环境：FakeFileReader 同步解码（utf-8 按浏览器语义非致命解码，控制字节→\u0000 可复现）——
class FakeFileReader {
  readAsText(file, enc) {
    const label = String(enc || 'utf-8').toLowerCase();
    this.result = new TextDecoder(label).decode(file._bytes);
    if (this.onload) this.onload();
  }
}
function run(fileBytes, opts) {
  opts = opts || {};
  const calls = { apply: [], toasts: [], reads: [] };
  const win = { __jsErrors: [] };
  const FR = class extends FakeFileReader {
    readAsText(f, enc) { calls.reads.push(String(enc || 'utf-8').toLowerCase()); super.readAsText(f, enc); }
  };
  const pickFiles = (accept, multiple, cb) => cb([{ _bytes: fileBytes, name: 'test.json', size: fileBytes.length }]);
  const applyImportData = (data, mode) => {
    if (opts.throwInApply) throw opts.throwInApply === true ? new Error('QuotaExceededError') : opts.throwInApply;
    calls.apply.push({ mode: mode, keys: Object.keys(data || {}) });
  };
  const toast = (m) => calls.toasts.push(String(m));
  // v3.36.x #603：导入侧拆出 importFromFile（文件通道/粘贴通道共用同一解析链），切片区间现在
  // 含 pickImportFile + pasteImportFile + importFromFile 三个函数声明——不能再当单个函数表达式
  // 求值，改为按语句列表求值后取 pickImportFile（断言全未改动，仍在跑真实源码）
  const factory = new Function('pickFiles', 'applyImportData', 'toast', 'FileReader', 'window', fnSrc + '\nreturn pickImportFile;');
  factory(pickFiles, applyImportData, toast, FR, win)('merge');
  return { calls: calls, win: win };
}

// 迷你 milk 样本（结构对齐真实导出：customReplies+customReplyGroups+customPokes+customEmojis）
const milkJson = JSON.stringify({
  exportDate: '2026-09-05', modules: ['replies', 'pokes', 'emojis', 'groups'],
  customReplies: ['爱你哟', '想你啦', '晚安好梦'],
  customReplyGroups: [{ id: 1, name: '甜蜜话术', color: '#F783AC', disabled: false, items: ['今天也要开心', '抱抱你'] }],
  customPokes: ['戳一戳'], customEmojis: ['😊']
});
const utf8 = (s) => Buffer.from(s, 'utf8');

let pass = 0, failcnt = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { failcnt++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
}
const toastAll = (r) => r.calls.toasts.join(' | ');

console.log('#171 字卡导入分流/自救（pickImportFile 抽源码行为断言）');

// 1. 合法 milk json（UTF-8）→ 直接进入导入处理，无失败提示
let r = run(utf8(milkJson));
ok(r.calls.apply.length === 1 && r.calls.apply[0].keys.indexOf('customReplies') >= 0 && r.calls.apply[0].mode === 'merge', '合法 milk json 直接导入（merge）');
ok(r.calls.toasts.length === 0, '合法文件无失败 toast');

// 2. BOM 前缀 → 照常导入
r = run(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), utf8(milkJson)]));
ok(r.calls.apply.length === 1, 'UTF-8 BOM 前缀照常导入');

// 3. UTF-16LE 带 BOM（微信/邮件/文本编辑转存典型）→ 自救换 utf-16le 重读后导入
r = run(Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(milkJson, 'utf16le')]));
ok(r.calls.apply.length === 1, 'UTF-16LE 转存自救后导入');
ok(r.calls.reads.join(',') === 'utf-8,utf-16le', '自救重读用了 utf-16le', r.calls.reads.join(','));

// 4. UTF-16BE 无 BOM → 换 utf-16be 重读后导入
const leBytes = Buffer.from(milkJson, 'utf16le');
const beBytes = Buffer.alloc(leBytes.length);
for (let i = 0; i + 1 < leBytes.length; i += 2) { beBytes[i] = leBytes[i + 1]; beBytes[i + 1] = leBytes[i]; }
r = run(beBytes);
ok(r.calls.apply.length === 1, 'UTF-16BE 转存自救后导入');
ok(r.calls.reads.join(',') === 'utf-8,utf-16be', '自救重读用了 utf-16be', r.calls.reads.join(','));

// 5. 前后被包说明文字 → 裁剪提取首{到末}后导入
r = run(utf8('导出完成！文件内容如下：\n' + milkJson + '\n——milk 助手'));
ok(r.calls.apply.length === 1, '前后包说明文字裁剪自救后导入');

// 6. 空内容（size>0 全空白，iCloud/网盘未下载完整）→ 专项提示 + 诊断
r = run(utf8('   \n  '));
ok(r.calls.apply.length === 0 && /文件内容为空/.test(toastAll(r)), '空文件给网盘未下载提示');
ok((r.win.__jsErrors.join('') + toastAll(r)).indexOf('[字卡导入]') >= 0, '失败现场写 __jsErrors（[字卡导入] 前缀）');

// 7. 存成了网页 → 指引重新导出
r = run(utf8('<html><body>404 not found</body></html>'));
ok(r.calls.apply.length === 0 && /网页/.test(toastAll(r)), 'HTML 内容给重新导出指引');

// 8. 顶层是数组 → 明示「顶层不是 JSON 对象」
r = run(utf8('[1,2,3]'));
ok(/顶层不是 JSON 对象/.test(toastAll(r)), '顶层非对象明示');

// 9. 彻底损坏（无花括号）→ 带真实解析错误
r = run(utf8('not json at all'));
ok(/JSON 解析失败/.test(toastAll(r)), '解析失败带真实原因');
ok(r.calls.toasts.join('').indexOf('文件格式不正确') < 0, '不再出现笼统的「文件格式不正确」');

// 10. 导入处理自身抛错（存储失败等）→ 单独提示，不伪装成格式错误（#171 核心断言）
r = run(utf8(milkJson), { throwInApply: true });
ok(/导入处理失败/.test(toastAll(r)), '导入处理异常单独提示');
ok(toastAll(r).indexOf('格式') < 0, '处理异常不再报成「格式错误」', toastAll(r));
ok(r.win.__jsErrors.join('').indexOf('QuotaExceededError') >= 0, '处理异常写 __jsErrors 带错误名');

// 11. 合法文件不写诊断（诊断只在失败时出现，不污染「最近错误」）
r = run(utf8(milkJson));
ok(r.win.__jsErrors.length === 0, '成功路径不写 __jsErrors');

// 12. #182 写盘阶段 OOM（RangeError/Out of memory）→ 给瘦身/整包恢复指引，不报「格式错误」
r = run(utf8(milkJson), { throwInApply: new RangeError('Out of memory') });
ok(/内存不足以一次性导入/.test(toastAll(r)), '写盘 OOM 给瘦身/恢复指引');
ok(/MB/.test(toastAll(r)) && toastAll(r).indexOf('格式') < 0, 'OOM 提示带文件体积且不含「格式」', toastAll(r));
ok(r.win.__jsErrors.join('').indexOf('Out of memory') >= 0, 'OOM 异常写 __jsErrors');

// 13. #182 诊断带文件头（先截断后清白的 rawHead，大文件也不全文扫描）
r = run(utf8('not json at all'));
ok(/开头: not json/.test(r.win.__jsErrors.join('')), '诊断行带文件头现场', r.win.__jsErrors.join(''));

// 14. #182 成功路径不因松引用而丢功能（合法文件在松开源文本后仍正常进入导入处理）
r = run(utf8(milkJson));
ok(r.calls.apply.length === 1 && r.calls.toasts.length === 0, '松引用重构后正常导入不受影响');

console.log('摘要: ' + pass + ' 通过 / ' + failcnt + ' 失败 (#182 字卡导入分流/自救/内存加固)');
process.exit(failcnt ? 1 : 0);
