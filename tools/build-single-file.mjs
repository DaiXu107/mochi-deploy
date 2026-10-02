// ===== 单文件完整版导出 =====
// 把构建产物 index.html 里的 79 个 <script defer src="js/..."> 外置脚本，
// 原位内联回单个 HTML（用 js/ 下已包装的产物文件——自带 try/catch 与
// __mochiLoaded 登记，boot 看门狗 missing() 求差为 0，「网络不佳·部分功能
// 没加载完」条在离线单文件下不会误弹）。
// 此前临时脚本内联的是 src/ 未包装源码 → 79 个模块不登记 → 看门狗 3 秒后
// 误判「部分功能没加载完」，且 heal() 因 navigator.onLine=false 永不自愈＝挡住使用。
// 用法：node tools/build-single-file.mjs [输出路径]（缺省 ./mochi完整版.html）
// 前置：先跑 node build.mjs（本工具只重组产物，不编译 src）。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');

// 按文档序取出 defer 外置标签清单（顺序即 jsFiles 原序，不许重排）
const tagRe = /<script defer src="js\/([\w.-]+\.js)" onerror="[^"]*"><\/script>/g;
const order = [];
let m;
while ((m = tagRe.exec(html)) !== null) order.push(m[1]);
if (!order.length) {
  console.error('✗ index.html 里没有找到外置 defer 脚本标签——请先 node build.mjs 生成产物');
  process.exit(1);
}

const blocks = order.map(f => {
  let code;
  try {
    code = readFileSync(join(root, 'js', f), 'utf8');
  } catch (e) {
    console.error('✗ 缺少 js/' + f + '——先 node build.mjs 再导出（本工具只认构建产物，不读 src/）');
    process.exit(1);
  }
  if (code.indexOf('__mochiLoaded.push') < 0) {
    console.error('✗ js/' + f + ' 不是包装版产物（无 __mochiLoaded 登记）——请重新 node build.mjs，勿用临时脚本生成的 js/');
    process.exit(1);
  }
  return '<script>\n' + code + '\n</script>';
});

// 连续的 defer 标签段整段替换为逐文件 script 块（每文件独立块＝iOS15 单块解析上限内）
const tagsRe = /(?:<script defer src="js\/[\w.-]+\.js" onerror="[^"]*"><\/script>\n?)+/;
if (!tagsRe.test(html)) {
  console.error('✗ 未找到连续外置脚本段');
  process.exit(1);
}
let out = html.replace(tagsRe, () => blocks.join('\n') + '\n');

// #939e 自包含守卫：若所用 index.html 产物先于 build.mjs 的修复（看门狗无 selfContained
// 判据），导出时打等价补丁——file:// 或页内无外置脚本时不弹「网络不佳」条。
// （file:// 下 Chrome 的 indexedDB.open 永久挂起 → __mochiDataReady 恒 false → 必误弹。）
if (out.indexOf('selfContained()') < 0 && out.indexOf('function bar() {') >= 0) {
  out = out.replace('function bar() {', () => 'function bar() { if (location.protocol === "file:" || !document.querySelector("script[src]")) return;');
}

// 产物自检：不允许残留任何外置脚本引用；eof 完整性标记必须保留
if (/<script[^>]*\ssrc=/.test(out)) {
  console.error('✗ 产物仍含外置 script src——自包含失败');
  process.exit(1);
}
if (out.indexOf('__MOCHI_EOF__') < 0) {
  console.error('✗ __MOCHI_EOF__ 完整性标记丢失');
  process.exit(1);
}

const outPath = process.argv[2] || join(root, 'mochi完整版.html');
writeFileSync(outPath, out);
console.log('已生成单文件完整版 → ' + outPath + '（' + out.length + ' 字节，内联 ' + order.length + ' 个模块，含 eof 标记）');
