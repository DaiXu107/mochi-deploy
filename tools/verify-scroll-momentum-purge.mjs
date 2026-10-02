// verify-scroll-momentum-purge.mjs — #714 滚动容器 legacy 动量旗标全站清理（#707 同族收尾）
// 断言 src 源级状态（不依赖产物构建；产物由 build.mjs 从 src 合并，src 状态＝产物状态）：
//   A1 全 src/css + src/js 零 -webkit-overflow-scrolling:touch（现代 WebKit 动量是默认，
//      旗标只会把滚动容器钉回 legacy 合成路径＝#707 iPhone 滑动卡顿/灰屏同族候发点）
//   A2 home.css 全文件零 overflow-scrolling 声明（#707g 翻页层不回流）
//   A3 chat-pages.css 恰 4 处 -webkit-overflow-scrolling:auto（#350 整页滚动方案有意禁动量，
//      防"顺手全删"过删——auto 是语义另一半，删了词典等页滚动链防穿透会变）
//   A4 .chat-body 块内 overscroll-behavior:contain 仍在（滚动边界防穿透与动量无关，不得陪葬）
//   A5 home.css 仍含 scroll-snap-type:x mandatory（#707g 哨兵语义锚未被误删）
//   A6 base.css 两处 #612 语义锚 overscroll-behavior:auto 仍在（其哨兵 needle 已同步收窄去旗标段）
// 用法：node tools/verify-scroll-momentum-purge.mjs [rootDir]（缺省＝仓库根；传 HEAD 导出树＝RED 基线）
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' —— ' + detail : '')); }
}
function walkCssJs(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkCssJs(p));
    else if (/\.(css|js)$/i.test(n)) out.push(p);
  }
  return out;
}
const files = walkCssJs(join(root, 'src'));
const read = (p) => readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const rel = (p) => p.slice(root.length + 1).replace(/\\/g, '/');

// A1 全站零 touch 旗标（CSS 先去 /* */ 注释——home.css:355 的 #707 历史说明保留该字样，非声明）
const touchRe = /-webkit-overflow-scrolling\s*:\s*touch/gi;
const hits = [];
for (const f of files) {
  let t = read(f);
  if (/\.css$/i.test(f)) t = t.replace(/\/\*[\s\S]*?\*\//g, '');
  const m = t.match(touchRe);
  if (m) hits.push(rel(f) + ' ×' + m.length);
}
check('A1 全站零 -webkit-overflow-scrolling:touch', hits.length === 0, hits.join(', '));

// A2 home.css 零 overflow-scrolling 声明（含注释外的任何形式）
const home = read(join(root, 'src', 'css', 'home.css')).replace(/\/\*[\s\S]*?\*\//g, '');
check('A2 home.css 零 overflow-scrolling 声明（#707g 防回流）', !/overflow-scrolling/i.test(home));

// A3 chat-pages.css 恰 4 处有意 auto（#350）
const cp = read(join(root, 'src', 'css', 'chat-pages.css'));
const autoN = (cp.match(/-webkit-overflow-scrolling\s*:\s*auto/gi) || []).length;
check('A3 chat-pages.css 恰 4 处 -webkit-overflow-scrolling:auto（#350 有意禁动量，防过删）', autoN === 4, '实际 ' + autoN);

// A4 .chat-body 的 overscroll-behavior:contain 仍在
const cm = read(join(root, 'src', 'css', 'chat-main.css'));
const cbIdx = cm.indexOf('.chat-body {');
const cbBlock = cbIdx >= 0 ? cm.slice(cbIdx, cm.indexOf('}', cbIdx)) : '';
check('A4 .chat-body 仍含 overscroll-behavior:contain（滚动边界防穿透不陪葬）', /overscroll-behavior\s*:\s*contain/.test(cbBlock));

// A5 #707g 语义锚仍在
check('A5 home.css 仍含 scroll-snap-type:x mandatory（#707g）', /scroll-snap-type\s*:\s*x\s*mandatory/.test(home));

// A6 base.css 两处 #612 语义锚（哨兵 needle 收窄后的形态）
const base = read(join(root, 'src', 'css', 'base.css'));
check('A6a base.css 弹窗多行框 overscroll-behavior:auto（#612）',
  /max-height:38vh;\s*overflow-y:auto;\s*overscroll-behavior:auto;/.test(base));
check('A6b base.css 分组胶囊行 overscroll-behavior:auto（#612）',
  /max-height:36vh;\s*overflow-y:auto;\s*overscroll-behavior:auto;/.test(base));

console.log('----');
console.log('verify-scroll-momentum-purge: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
