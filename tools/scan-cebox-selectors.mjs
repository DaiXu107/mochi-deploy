// ===== 静态扫描：querySelector 按 class 选输入框且同链读 .value 的 ce-box 错位风险 =====
// 背景：mobile-adapt.js 把 input/textarea 转成 contenteditable div(.ce-box)，插在
// 原输入框前且继承其 class。`querySelector('.cls').value` 若 .cls 属于被转换的
// 输入框（text/search/number/textarea），安卓上首个匹配是 ce-box div。
// 现有双保险：① box.value 已代理转发 inp.value（运行时兜底，历史写法不再抛错/存空）；
//   ② 本扫描找出残留写法供人工评估——建议逐步改为 标签限定（input.cls）首选写法，
//   因为标签写法语义明确、不依赖代理链，且写回显路径更直观。
// 规则：querySelector(All)(<选择器>) 之后同一语句内 ≤120 字符出现 `.value`
//   且选择器最后一个复合段是裸类名（无 input/textarea 标签限定）→ RISK。
// 用法：node tools/scan-cebox-selectors.mjs [--strict]（--strict 时有 RISK 退出码 1）
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const strict = process.argv.includes('--strict');
const root = join(process.cwd(), 'src', 'js');
const RE = /querySelector(?:All)?\(\s*(['"])((?:(?!\1).)*)\1\s*\)([^;\n]{0,120})/g;
let risks = 0, total = 0;

for (const f of readdirSync(root).filter((n) => n.endsWith('.js'))) {
  const p = join(root, f);
  if (!statSync(p).isFile()) continue;
  const lines = readFileSync(p, 'utf8').split('\n');
  const src = lines.join('\n');
  let m;
  while ((m = RE.exec(src))) {
    total++;
    const sel = m[2].trim();
    const tail = m[3] || '';
    if (!tail.includes('.value')) continue;
    const last = sel.split(/[\s>+~]+/).filter(Boolean).pop() || '';
    // 裸类名末段才会先匹配到 ce-box div；input.xxx / textarea.xxx 只命中 ghost 原件
    const bareCls = /^\.[A-Za-z_][\w-]*$/.test(last);
    if (bareCls) {
      risks++;
      const lineNo = src.slice(0, m.index).split('\n').length;
      console.log(`RISK  ${f}:${lineNo}  qs("${sel}")…${tail.trim().slice(0, 60)}`);
    }
  }
}
console.log(`\n扫描完成：querySelector 调用 ${total} 处，其中「裸类名选框 + 同链读 .value」${risks} 处`);
if (risks) console.log('说明：目标若不是可转换输入框(text/search/number/textarea)则无碍；运行时已有 box.value 代理兜底，此处仅提示改为 标签.类名 首选写法。');
process.exit(strict && risks ? 1 : 0);
