// ===== 专项验证：#134 文档完整性自愈防线（iPhone X 桌面图标/功能缺失反复发作） =====
// 用法：node tools/verify-html-eof.mjs
// 纯文本断言（不起浏览器、不依赖产物是否最新——产物断言在缺失时明确标注）：
//   1) 构建产物（存在时）末尾 300 字节内含带版本号的 EOF 兜底标记；
//   2) 截断模拟：切掉尾部 ≥100 字节后 isCompleteHtml（sw.js 同逻辑镜像）必须判残缺；
//   3) src/pwa/sw.js 四处写缓存点都挂了校验 + PURGE_INDEX 自愈消息；
//   4) src/template.html 有 mochi-html-eof DOM 锚点；
//   5) src/js/device.js 有自检+自愈重载（sessionStorage 限 1 次）；
//   6) src/js/personalize.js 有拖拽自嵌套两道防线。
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n); } };

// sw.js 同逻辑镜像（改 sw.js 校验形态时同步这里）
const HTML_EOF_STAMPED = /<!-- __MOCHI_EOF__ [a-z0-9]+ -->/;
const isCompleteHtml = (text) => typeof text === 'string' && HTML_EOF_STAMPED.test(text.slice(-300));

// 1+2) 产物 EOF + 截断模拟
const builtPath = join(root, 'index.html');
if (existsSync(builtPath)) {
  const html = readFileSync(builtPath, 'utf8');
  t('产物末尾含带版本号 EOF 标记', isCompleteHtml(html));
  t('截去尾部 100B 判残缺', !isCompleteHtml(html.slice(0, -100)));
  t('只保留前 90% 判残缺', !isCompleteHtml(html.slice(0, Math.floor(html.length * 0.9))));
  t('产物含 mochi-html-eof 锚点', html.includes('id="mochi-html-eof"'));
} else {
  console.log('SKIP 产物 index.html 不存在（未构建）——只验 src');
}

// 3) sw.js 校验挂载点
const sw = readFileSync(join(root, 'src/pwa/sw.js'), 'utf8');
t('sw.js 定义 isCompleteHtml（带 stamp 正则）', sw.includes('HTML_EOF_STAMPED') && sw.includes('function isCompleteHtml'));
t('sw.js install precache 校验', /isIndexUrl\(url\)[\s\S]{0,200}isCompleteHtml/.test(sw));
t('sw.js fetch 导航写回校验', /req\.mode === 'navigate'[\s\S]{0,400}isCompleteHtml/.test(sw));
t('sw.js activate 补写校验', /if \(hit\) \{[\s\S]{0,300}isCompleteHtml/.test(sw));
t('sw.js PRECACHE_NOW 校验', /if \(isIndexUrl\(u\)\)[\s\S]{0,200}isCompleteHtml/.test(sw));
t('sw.js activate 自愈删存量残缺缓存', sw.includes('历史截断缓存自愈'));
t('sw.js PURGE_INDEX 消息处理', sw.includes("data.type === 'PURGE_INDEX'"));
t('sw.js PURGE_DONE 回执', sw.includes("type: 'PURGE_DONE'"));

// 4) template.html 锚点
const tpl = readFileSync(join(root, 'src/template.html'), 'utf8');
t('template.html 有 mochi-html-eof 锚点', tpl.includes('id="mochi-html-eof"'));

// 5) device.js 自检
const dev = readFileSync(join(root, 'src/js/device.js'), 'utf8');
t('device.js 自检会话标记（限 1 次）', dev.includes("const FLAG = 'mochi-trunc-reloaded';"));
t('device.js 查 EOF 锚点（唯一截断信号）', dev.includes("getElementById('mochi-html-eof')"));
t('device.js 不用 openDecision 当信号（verify 子集页会误报）', !dev.includes('typeof window.openDecision !=='));
t('device.js 发 PURGE_INDEX 自愈', dev.includes("type: 'PURGE_INDEX'"));
t('device.js 等待 PURGE_DONE 回执', dev.includes("ev.data.type === 'PURGE_DONE'"));

// 6) personalize.js 拖拽防线
const pz = readFileSync(join(root, 'src/js/personalize.js'), 'utf8');
t('computeDrop 排除整组 app-grid 拖拽', pz.includes("dragged.classList.contains('app-grid')) return null;"));
t('doDrop 自嵌套防线 contains(info.ref)', pz.includes('dragged.contains(info.ref)) return;'));

console.log('RESULT', pass + ' passed', fail + ' failed');
process.exit(fail ? 1 : 0);
