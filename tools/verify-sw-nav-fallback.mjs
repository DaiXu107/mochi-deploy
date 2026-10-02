// ===== 专项验证：#143 SW 最终重试污染 canonical index 键（一加Ace2+Edge 整页 mochi 字母图，#136 家族复发） =====
// 用法：node tools/verify-sw-nav-fallback.mjs
// 纯文本断言（同 verify-html-eof 风格，对 src 与构建产物各验一遍）：
//   1) fetch 最终重试的写缓存仅限导航请求——原实现把任何成功体（含 icon-512.png）一律
//      写 canonical './index.html' 键，PNG 占位后离线导航第一级就命中图片 = 浏览器把
//      PNG 当文档渲染（整页只有 mochi 字母图），且图片文档不跑 JS、#134 自检无法自愈；
//   2) 该写点挂 isCompleteHtml 校验且先校验后落盘（#134 铁律第 5 处写点补齐）；
//   3) 导航兜底命中做 content-type 守卫——非 HTML 缓存当未命中，防污染条目遮蔽好缓存；
//   4) 全文所有 c.put('./index.html' 写点上游 400 字符内必须有 isCompleteHtml/rescued
//      保护（防未来新增裸写点，dup #136 键不一致教训）；
//   5) 既有 #134/#136 锚点仍在（本修复不覆盖历史修复）。
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n); } };

for (const label of ['src/pwa/sw.js', 'sw.js']) {
  const p = join(root, label);
  if (!existsSync(p)) { console.log('SKIP', label, '不存在（未构建）——只验 src'); continue; }
  const sw = readFileSync(p, 'utf8');
  const tag = '[' + label + '] ';

  // 1+2) 最终重试写点收口（#157 起文件内有多处写点/守卫，一律从 gate 起向后找最终重试自己的）
  const gate = sw.indexOf("if (res && res.ok && req.mode === 'navigate')");
  const eof = sw.indexOf('if (!isCompleteHtml(t)) return res;', gate);
  const put = sw.lastIndexOf("c.put('./index.html', copy)");
  t(tag + '最终重试写缓存仅限导航请求', gate > -1);
  t(tag + '重试写点挂 isCompleteHtml 且先校验后落盘', gate > -1 && eof > gate && put > eof);

  // 3) 导航兜底命中 content-type 守卫
  const guard = sw.indexOf("if (req.mode === 'navigate' && m &&");
  const hdr = guard > -1 ? sw.indexOf("m.headers.get('content-type')", guard) : -1;
  t(tag + '兜底命中 content-type 守卫（仅导航）', guard > -1 && hdr > guard && hdr - guard < 200);

  // 4) 所有 canonical 写点均受保护（写点上游 600 字符内出现校验/抢救体）
  // #157：新增导航「缓存优先+后台静默刷新」写点（后台刷新体同样过 EOF 校验）共 6 处
  const parts = sw.split("c.put('./index.html'").slice(1);
  t(tag + 'canonical 写点共 ' + parts.length + ' 处', parts.length === 6);
  let unguarded = 0, cursor = 0;
  for (let i = 0; i < parts.length; i++) {
    const at = sw.indexOf("c.put('./index.html'", cursor);
    const upstream = sw.slice(Math.max(0, at - 600), at);
    if (!/isCompleteHtml|rescued/.test(upstream)) unguarded++;
    cursor = at + 1;
  }
  t(tag + '全部 canonical 写点受 isCompleteHtml/rescued 保护', parts.length > 0 && unguarded === 0);

  // 5) 既有 #134/#136 锚点仍在（不覆盖历史修复）
  t(tag + '#134 EOF 校验 + PURGE 自愈仍在', sw.includes('function isCompleteHtml(text)') && sw.includes("data.type === 'PURGE_INDEX'"));
  t(tag + '#136 second chance 仍在', sw.includes(".then((m) => m || caches.match(req))"));
  t(tag + '#136 导航成功写 canonical 仍在', sw.includes("c.put('./index.html', res.clone())"));
}

console.log(pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;
