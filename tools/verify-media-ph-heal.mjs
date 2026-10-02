// ===== 验证脚本：#439 图片丢失占位池权威判定+占位自愈 / #440 导入清单未知即中止保池 =====
// 背景：红米K80 Chrome 报「图片依旧说丢失…不要覆盖修改导致不同机型反复」（多机型同族）——
// ①chat.js 令牌 src 404 只是浏览器噪音，旧逻辑 1.5s 超时即把 img 换文字占位＝观察器取回慢/
//   #397 取回限流时把「取回慢」误杀成「数据丢失」；②占位替换后 #423 重建自愈只重写
//   img[src^=@@m:] 摸不到占位＝「点了重建媒体池还是丢失」；③data-backup.js 导入时
//   idbListKeys 读不到曾按「无需保留」照常 idbReplaceAll clear＝「只备份文字」导入把媒体池
//   整池抹掉（图片丢失跨设备扩散口子，#118 防线失效）。
// 修复=#439 chat 占位改轮询池官方判定（mochiMediaTokenMissing 确认缺失才换占位并登记，
// mochiMediaPhRestore 池补回后原位换回真图）+ #440 清单未知即 abort 走既有回滚。
// 本脚本从 src 提取真实实现做断言：phReg 块为行为级（mock DOM），其余为逻辑锚点级。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const chat = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
const pool = readFileSync(join(root, 'src/js/media-pool.js'), 'utf8');
const backup = readFileSync(join(root, 'src/js/data-backup.js'), 'utf8');
const build = readFileSync(join(root, 'build.mjs'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } }

// --- #439 chat.js：占位池权威判定（提取 bindMediaFailPlaceholder 函数体） ---
function extractFn(src, name) {
  const re = new RegExp('function ' + name + '\\([^)]*\\) \\{');
  const m = re.exec(src);
  if (!m) throw new Error('源码中找不到 ' + name);
  let i = m.index + m[0].length, depth = 1, out = m[0];
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    out += ch;
    i++;
  }
  return out;
}
const bmp = extractFn(chat, 'bindMediaFailPlaceholder');
ok('T1 令牌分支轮询池官方判定（mochiMediaTokenMissing 确认缺失才占位）', bmp.includes('window.mochiMediaTokenMissing && window.mochiMediaTokenMissing(s)'));
ok('T2 占位登记自愈钩子（mochiMediaPhRegister 携原 img）', bmp.includes('window.mochiMediaPhRegister(h, ph, im)'));
ok('T3 判定改轮询非一次性（setInterval+clearInterval 有界）', bmp.includes('setInterval') && bmp.includes('clearInterval(iv)'));
ok('T4 轮询有界（4s≈8×500ms 放弃判定，保留 img 交观察器）', /if \(\+\+n >= 8\) clearInterval\(iv\);/.test(bmp));
ok('T5 旧「1.5s 超时即替换」误判已废除', !/isTok \? '（图片丢失/.test(bmp));
ok('T6 #423 重建引导文案保留（哨兵 needle 不回退）', bmp.includes('图片丢失：媒体数据缺失，可到设置→查看存储→媒体池「重建媒体池」恢复'));
ok('T7 非令牌分支原样（网络失败占位不回归）', bmp.includes('（表情/图片加载失败：网络不通或原图已失效）'));
ok('T8 解出即不动（池命中先检查，观察器改写不被抢跑）', (bmp.indexOf('window.mochiMediaExpand && window.mochiMediaExpand(s)') < bmp.indexOf('window.mochiMediaTokenMissing && window.mochiMediaTokenMissing(s)')) && bmp.includes('window.mochiMediaExpand && window.mochiMediaExpand(s)'));

// --- #439 media-pool.js：登记/自愈真实实现（提取 phReg 块做行为断言） ---
const bs = pool.indexOf('const phReg');
const be = pool.indexOf('const inflight');
if (bs < 0 || be < 0 || be <= bs) { ok('P0 phReg 块可提取（const phReg … const inflight 之间）', false); }
else {
  const block = pool.slice(bs, be);
  const windowMock = {};
  const TOKEN_RE = /^@@m:([0-9a-f]{32})$/;
  const TOK = '@@m:';
  new Function('window', 'TOKEN_RE', 'TOK', block + '\nreturn { reg: window.mochiMediaPhRegister, res: window.mochiMediaPhRestore };')(windowMock, TOKEN_RE, TOK);
  const reg = windowMock.mochiMediaPhRegister, res = windowMock.mochiMediaPhRestore;
  ok('P1 mochiMediaPhRegister/mochiMediaPhRestore 已导出', typeof reg === 'function' && typeof res === 'function');
  function mkPh() { const ph = { nodeType: 1, replaceCalls: 0, replaced: null, replaceWith(...a) { ph.replaced = a; ph.replaceCalls++; } }; return ph; }
  function mkIm() { const im = { src: '', clsRemoved: [], attrRemoved: [], classList: { remove(c) { im.clsRemoved.push(c); } }, removeAttribute(a) { im.attrRemoved.push(a); } }; return im; }
  const H = '90f4e54b58de684a3587aaf5731748e3';
  const ph = mkPh(), im = mkIm();
  reg(H, ph, im);
  res(H, 'data:image/png;base64,iVBORw0KGgo=');
  ok('P2 池补回后占位原位换回原 img', ph.replaceCalls === 1 && ph.replaced && ph.replaced[0] === im);
  ok('P3 换回时清理缺失占位标记并重写 src', im.src === 'data:image/png;base64,iVBORw0KGgo=' && im.clsRemoved.indexOf('media-tok-missing') >= 0 && im.attrRemoved.indexOf('alt') >= 0);
  res(H, 'data:image/png;base64,AAAA=');
  ok('P4 恢复后登记已清（不重复替换）', ph.replaceCalls === 1);
  const ph2 = mkPh(), im2 = mkIm();
  reg('zzzz', ph2, im2);
  res('zzzz', 'data:image/png;base64,AAAA=');
  ok('P5 非法 hash 拒绝登记（TOKEN_RE 守卫）', ph2.replaceCalls === 0 && im2.src === '');
  const ph3 = mkPh(), im3 = mkIm();
  reg(H, ph3, im3);
  res(H, 'xxx-not-data');
  ok('P6 非 data:image 值不触发换回（脏值守卫）', ph3.replaceCalls === 0);
  const ph4 = mkPh(), im4 = mkIm();
  reg(H, ph4, im4); reg(H, ph4, im4);
  res(H, 'data:image/png;base64,BBBB=');
  ok('P7 重复登记去重（同一占位只换回一次）', ph4.replaceCalls === 1);
}

// --- #439 自愈触发点：resolveImg 成功路径 + rebuild heal ---
ok('P8 resolveImg 成功路径触发占位换回', /map\.set\(h, v2\);\s*\n\s*try \{ window\.mochiMediaPhRestore\(h, v2\);/.test(pool));
ok('P9 mochiMediaRebuild heal 触发占位换回（只对图片值）', pool.includes('window.mochiMediaPhRestore(h, p.v)'));

// --- #440 data-backup.js：清单未知即中止（不再按「无需保留」clear） ---
ok('B1 idbListKeys 读不到（null=未知）改为 abort', backup.includes('if (!Array.isArray(curKeys)) return { abort: true };'));
ok('B2 retain 值批量读失败同样 abort（清单在、值拿不到＝保留不了）', (backup.match(/\.catch\(function \(\) \{ return \{ abort: true \}; \}\)/g) || []).length >= 2);
ok('B3 消费端 abort 走既有 resolve(false) 回滚（原数据保留提示）', backup.includes('if (kept && kept.abort) { resolve(false); return; }'));
ok('B4 abort 判定先于 idbReplaceAll（放行即 clear 的口子已关）', backup.indexOf('kept.abort') < backup.indexOf('idbReplaceAll(allPairs)'));
ok('B5 旧「清单读取失败→不保留」注释语义已移除', !backup.includes('清单读取失败/超时 → 不保留'));

// --- 哨兵在位（构建收口防线） ---
ok('S1 #439/#440 哨兵三条已登记 build.mjs', build.includes("needle: 'window.mochiMediaTokenMissing && window.mochiMediaTokenMissing(s)'") && build.includes("needle: 'window.mochiMediaPhRestore = function'") && build.includes("needle: 'if (kept && kept.abort) { resolve(false); return; }'"));

console.log(pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
