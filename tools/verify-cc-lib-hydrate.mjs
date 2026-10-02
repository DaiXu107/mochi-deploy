// ===== 验证脚本：chatcard.js「字卡库列表页兜底取回」IIFE 必须真的被执行 =====
// 用法：node tools/verify-cc-lib-hydrate.mjs [相对路径...]
//   不带参数 = 检查 src/js/chatcard.js 的接线 + 扫全部 src/js/*.js 找同类死 IIFE
//   带参数   = 只检查指定文件（可喂 git show HEAD:src/js/chatcard.js 导出的旧副本做红对照）
//
// 背景（#266，用户报「导入字卡过一段时间就没了，刷新就消失字卡」）：
//   字卡库列表页（page-chatcard）显示时的「重算角标 + 大键挂起按需取回」兜底是一段 IIFE，
//   2026-08-30 收口提交 f143621 把结尾 `})();` 改成了 `});` —— 语法完全合法，
//   node --check 过、构建哨兵查的是「文本锚点还在」也过，但整段变成永不执行的死代码：
//   iOS 启动回填被打断（挂后台杀 IDB 连接）后，字卡库读空，唯一会按用户查看时点把库
//   从 IndexedDB 拉回来的防线消失 = 刷新后字卡「没了」。
//   这类缺陷（名字在、逻辑没了）只有行为断言拦得住，但行为断言依赖构建产物；
//   本脚本补的是「不构建也能当场见分晓」的那一层：直接扫源码证明它会执行。
import { readFileSync, readdirSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// 跳过字符串/模板串/正则/注释，找出 start 处 `{` 的匹配右括号位置（-1=没找到）
function matchBrace(src, start) {
  let depth = 0, i = start;
  let prev = '';                 // 上一个有效字符（判定 `/` 是除号还是正则起点）
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); if (i < 0) break; i += 2; continue; }
    // 正则字面量：`/` 出现在值位置（前面是运算符/括号/逗号/冒号/return 等）即视为起点，
    // 漏掉这条会被 /["']/ 里的引号带偏，整个 brace 计数错位 → 正常 `})();` 误判成死代码
    if (c === '/' && (!prev || '(,=:[!&|?{};+-*%~^<>'.indexOf(prev) >= 0 || /\breturn$|\btypeof$/.test(src.slice(Math.max(0, i - 8), i)))) {
      i++;
      let cls = false;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') cls = true;
        else if (src[i] === ']') cls = false;
        else if (src[i] === '/' && !cls) break;
        else if (src[i] === '\n') break;
        i++;
      }
      i++; prev = '/'; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c; i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
          let td = 1; i += 2;
          while (i < src.length && td > 0) { if (src[i] === '{') td++; else if (src[i] === '}') td--; i++; }
          continue;
        }
        if (src[i] === quote) break;
        i++;
      }
      i++; prev = quote; continue;
    }
    if (c === '{') { depth++; i++; prev = c; continue; }
    if (c === '}') { depth--; i++; prev = c; if (depth === 0) return i - 1; continue; }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return -1;
}

// 扫源码里所有「独占行首的匿名立即执行函数」，报告漏掉调用括号的（`}());` 之类不在此列）
function findDeadIifes(src, label) {
  const bad = [];
  const re = /^[ \t]*\(function\s*(?:\(\s*\)|\([^\)]*\))?\s*\{/gm;
  let m;
  while ((m = re.exec(src))) {
    const braceAt = src.lastIndexOf('{', m.index + m[0].length - 1);
    const close = matchBrace(src, braceAt);
    if (close < 0) continue;
    const after = src.slice(close + 1, close + 12).replace(/^[ \t\r]*/, '');
    // 合法：`)()` 紧跟（含 `})();` 换行收尾）、`.call(` / `.apply(` 同样立即执行；
    // `});` 这种 = 表达式求值后丢弃 = 死代码
    if (!/^(\)\(|\.call\(|\.apply\()/.test(after)) {
      const line = src.slice(0, m.index).split('\n').length;
      bad.push(label + ':' + line + ' → 收尾是 ' + JSON.stringify(src.slice(close + 1, close + 9).trim()));
    }
  }
  return bad;
}

const argv = process.argv.slice(2);
const targets = argv.length
  ? argv
  : ['src/js/chatcard.js', ...readdirSync(join(root, 'src/js')).filter(f => f.endsWith('.js')).map(f => 'src/js/' + f)];
const uniq = [...new Set(targets)];

// ---- A 组：#266 本体接线（列表页显示 → 重算角标 + 按需取回，且这段会被执行）----
const ccPath = uniq.find(p => /chatcard\.js$/.test(p)) || 'src/js/chatcard.js';
let cc = '';
try { cc = readFileSync(normalize(join(root, ccPath)), 'utf8'); } catch (e) { cc = ''; }
check('A1 chatcard.js 源码可读（' + ccPath + '）', !!cc, cc.length + 'B');
const wired = /new MutationObserver\(\(\)\s*=>\s*\{[\s\S]{0,600}?refreshLibCounts\(true\)[\s\S]{0,400}?hydrateLibScopes\(\['public', 'own'\]\);[\s\S]{0,200}?\.observe\(libPage,\s*\{\s*attributes:\s*true,\s*attributeFilter:\s*\['hidden'\]\s*\}\s*\);/.test(cc);
check('A2 列表页观察者接线在位（hidden → 重算角标 + hydrateLibScopes）', wired);
// A3 必须走结构判定，不能搜「附近有没有 `})();` 文本」：源码里 #266 修复标记注释
// 本身就带着这个串，200 字符窗口会先命中注释 → 真括号被改回 `});` 照样报绿（假绿）。
// 做法：从 observe(libPage 往回找包裹它的 (function，用 matchBrace 配对其函数体右括号，
// 再断言其后紧跟 `)(`（真立即调用）。
let invoked = false, closerSeen = '';
{
  const at = cc.search(/\.observe\(libPage,\s*\{\s*attributes:\s*true,\s*attributeFilter:\s*\['hidden'\]\s*\}\s*\);/);
  const iifeAt = at < 0 ? -1 : cc.lastIndexOf('(function', at);
  if (iifeAt >= 0) {
    const braceAt = cc.indexOf('{', iifeAt);
    const close = braceAt >= 0 ? matchBrace(cc, braceAt) : -1;
    if (close >= 0) {
      closerSeen = JSON.stringify(cc.slice(close + 1, close + 5).replace(/[\s\r\n]+/g, ''));
      invoked = cc.slice(close + 1).replace(/^[ \t\r\n]+/, '').startsWith(')(');
    }
  }
}
check('A3 包裹这段的 IIFE 已立即调用（observe 所在函数体右括号后紧跟 `)(`）', invoked, '收尾=' + closerSeen);
check('A4 全文件零「行首匿名 IIFE 漏调用括号」', findDeadIifes(cc, ccPath).length === 0, findDeadIifes(cc, ccPath).join(' | '));

// ---- B 组：同类缺陷横扫（一次改完，别等下一个报障）----
const allBad = [];
for (const p of uniq) {
  let s = '';
  try { s = readFileSync(normalize(join(root, p)), 'utf8'); } catch (e) { continue; }
  findDeadIifes(s, p).forEach(b => allBad.push(b));
}
check('B1 src 全量 JS 无死 IIFE（共扫 ' + uniq.length + ' 个文件）', allBad.length === 0, allBad.slice(0, 8).join(' | '));

const fails = results.filter(r => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
