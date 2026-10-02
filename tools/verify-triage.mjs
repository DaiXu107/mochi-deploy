// 红项机械分类：重跑红项脚本 → 抓全部 FAIL 行 → 回到源码找到那条断言 → 看断言锚点在 src / 产物里的存在情况。
// 目的是把「65 项红」拆成：期望过期（改脚本）/ 疑似漏接入（真回归）/ 运行时行为断言（需人看，可按域交接）。
// 用法：node tools/verify-triage.mjs [--log tools/tmp-suite.log] [--scripts a.mjs,b.mjs] [--jobs 3] [--timeout 240] [--full] [--reuse]
//   --reuse：复用 tools/tmp-triage-cache/ 里上次输出，只重做分类不改产物时用它（跳过 D 转绿判定）。
//           缓存按「产物指纹-脚本名」分名，产物被重建后自然落空 → 自动回落实跑，不会拿旧输出判新产物。
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, dft) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dft; };
const FULL = argv.includes('--full');
const REUSE = argv.includes('--reuse');
const IS_MAIN = !!(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
const JOBS = Number(opt('jobs', 3));
const TMO = Number(opt('timeout', 240)) * 1000;
const logPath = opt('log', 'tools/tmp-suite.log');
// 实测踩过的两个假结论：--jobs 0 直接 TypeError 崩，--timeout 0 把每个脚本秒判超时塞进 C 桶。
if (IS_MAIN && (!(JOBS >= 1) || !(TMO >= 5000))) {
  console.error('参数不合理：--jobs 需 ≥1（收到 ' + opt('jobs', '缺省 3') + '），--timeout 需 ≥5 秒（收到 ' + opt('timeout', '缺省 240') + '）');
  process.exit(2);
}

const abs = (p) => join(root, p);
// 产物指纹（与 git hash-object 同算法，便于和 git ls-files 对号）：分类结果只对这一个字节串有效
const productBuf = readFileSync(abs('index.html'));
const prodFp = createHash('sha1').update('blob ' + productBuf.length + '\0').update(productBuf).digest('hex').slice(0, 8);
const product = productBuf.toString('utf8');
const stripComments = (t) => t.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
const srcBlobs = [];
for (const dir of ['js', 'css']) for (const f of readdirSync(abs('src/' + dir))) if (/\.(js|css)$/.test(f)) srcBlobs.push(['src/' + dir + '/' + f, stripComments(readFileSync(abs('src/' + dir + '/' + f), 'utf8'))]);
srcBlobs.push(['src/template.html', stripComments(readFileSync(abs('src/template.html'), 'utf8'))]);
const srcAll = srcBlobs.map(([, t]) => t).join('\n');
// markup 证据 = 源码里真的会造出这个元素。把类名写进 querySelector 字符串（mobile-adapt 那种）不算。
const markupSrc = srcBlobs.filter(([f]) => !/\.css$/.test(f)).map(([, t]) => t).join('\n');
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
const Q = '\\x22\\x27\\x60';
function inMarkup(name) {
  const n = escRe(name);
  const pats = [
    new RegExp('class=[' + Q + '][^' + Q + '\\n]*\\b' + n + '\\b'),
    new RegExp('classList\\.(?:add|remove|toggle)\\([^)]*[' + Q + ']' + n + '[' + Q + ']'),
    new RegExp('className\\s*=\\s*[' + Q + '][^' + Q + '\\n]*\\b' + n + '\\b'),
    new RegExp('id\\s*=\\s*[' + Q + ']?' + n + '[' + Q + ' \\n>]'),
    new RegExp("setAttribute\\(['\"]class['\"][^)]*\\b" + n + '\\b'),
    new RegExp("['\"][\\w-]+['\"]\\s*,\\s*['\"]" + n + "['\"]")
  ];
  return pats.some((re) => re.test(markupSrc));
}

// ---- 红项清单（收进函数：被 import 只做分类自检时不该顺带读日志甚至 exit）----
function collectFiles() {
  let files = [];
  if (opt('scripts', '')) files = opt('scripts', '').split(',').map((s) => s.trim()).filter(Boolean);
  else if (existsSync(abs(logPath))) {
    const s = new Set();
    for (const raw of readFileSync(abs(logPath), 'utf8').split(/\r?\n/)) {
      const m = raw.match(/^--- (verify-\S+?\.mjs)/) || raw.match(/^⏱ (verify-\S+?\.mjs)/);
      if (m) s.add(m[1]);
    }
    files = [...s];
  } else { console.error('既没有 --scripts 也找不到日志 ' + logPath); process.exit(2); }
  return files.filter((f) => existsSync(abs('tools/' + f)));
}

const run = (file) => new Promise((resolve) => {
  // 缓存名带产物指纹：换产物（并行会话重建）后 --reuse 自然落空，不会拿旧输出去分类新产物
  const cache = join(root, 'tools', 'tmp-triage-cache', prodFp + '-' + file + '.log');
  if (REUSE && existsSync(cache)) {
    const out = readFileSync(cache, 'utf8');
    resolve({ file, code: 1, killed: false, out, ms: 0, cached: true });
    return;
  }
  const t0 = Date.now();
  const child = spawn(process.execPath, [join(root, 'tools', file)], { cwd: root, windowsHide: true });
  let buf = ''; let killed = false;
  const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, TMO);
  child.stdout.on('data', (d) => { if (buf.length < 400000) buf += d; });
  child.stderr.on('data', (d) => { if (buf.length < 400000) buf += d; });
  // spawn 失败时 Node 只发 'error' 不发 'exit'；不接住就是未处理异常，一个脚本拖垮整批分类
  child.on('error', (e) => {
    clearTimeout(timer);
    resolve({ file, code: -1, killed: false, spawnError: e.code || e.message, out: buf + '\n[spawn-error] ' + (e.code || e.message), ms: Date.now() - t0 });
  });
  child.on('exit', (code) => {
    clearTimeout(timer);
    try { mkdirSync(dirname(cache), { recursive: true }); writeFileSync(cache, buf, 'utf8'); } catch (e) {}
    resolve({ file, code, killed, out: buf, ms: Date.now() - t0 });
  });
});
const pool = async (items, n, fn) => {
  const res = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { for (; ;) { const k = i++; if (k >= items.length) return; res[k] = await fn(items[k]); } }));
  return res;
};

const unesc = (s) => { try { return JSON.parse('"' + s + '"'); } catch { return s; } };
const QUOTE_RE = /(['"])((?:\\.|(?!\1)[^\\])*?)\1/g;
const SEED_LINE_RE = /setItem|localStorage|sessionStorage|id\s*:|\bseed\b|INSERT|\.push\(|JSON\.stringify|Object\.assign|\[\[|\{\w+:/i;
const SEL_RE = /(?:querySelector(?:All)?|getElementById)\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
// 锚点 = 应当同时存在于 src 与产物的字面量。种子数据（mtest1 / 999999.99 / {"a":1}）天然不在 src，误当锚点会把真回归分错桶。
const isAnchor = (lit) => {
  if (/[{}\[\]\n]/.test(lit)) return false;
  if (/^[\d\s.,:%¥$+-]+$/.test(lit)) return false;
  if (/^(?:#[0-9a-f]{3,8}|[0-9a-f]{6})$/i.test(lit)) return false;
  if (/[一-鿿]/.test(lit)) return lit.replace(/[^\u4e00-\u9fa5]/g, '').length >= 4;
  return /^[.#]?[A-Za-z_$][A-Za-z0-9_$.\-:#]{4,}$/.test(lit);
};
function seedLitsOf(code) {
  const s = new Set();
  for (const line of code.split('\n')) {
    if (!SEED_LINE_RE.test(line)) continue;
    for (const m of line.matchAll(QUOTE_RE)) { const lit = unesc(m[2]); if (lit.length >= 3) s.add(lit); }
  }
  return s;
}
// 断言标签（check 的第一个参数）按构造只存在于 tools/ 脚本里，绝不会出现在 src 或产物中。
// 语句窗口会连带抓到相邻 check 的标签，若当锚点用则必然判成「src/产物都没有」→ 假期望过期。
const LABEL_RE = /(?:^|[\s,;(<{])(?:check|checkLayout|assert|ok|expect|verify)\w*\s*\(\s*(['"])((?:\\.|(?!\1)[^\\])*?)\1/gm;
// 自拼输出的脚本（console.log((r ? 'PASS' : 'FAIL') + '  文案')）里，那串文案同样只是标签。
const PRINT_LINE_RE = /['"](?:PASS|FAIL|OK)['"]/;
function labelLitsOf(code) {
  const s = new Set();
  for (const m of code.matchAll(LABEL_RE)) { const lit = unesc(m[2]); if (lit.length >= 4) s.add(lit); }
  for (const line of code.split('\n')) {
    if (!PRINT_LINE_RE.test(line) || !/console\.(log|error)/.test(line)) continue;
    for (const m of line.matchAll(QUOTE_RE)) { const lit = unesc(m[2]); if (lit.length >= 4 && !/^(?:PASS|FAIL|OK)$/.test(lit)) s.add(lit); }
  }
  return s;
}
// 脚本自己写进页面的文本（_inp.value='双击测试' / fill('群聊批量测试')）属测试输入：
// 页面把它原样回显，和 src 里有没有这段字无关，当锚点必然假判「期望过期」。
const INPUT_RE = /(?:value|textContent|innerText|innerHTML)\s*[:=]{1,3}\s*(['"])((?:\\.|(?!\1)[^\\])*?)\1|\b(?:\w*fill\w*|setValue|type|press)\(\s*(['"])((?:\\.|(?!\3)[^\\])*?)\3/g;
function inputLitsOf(code) {
  const s = new Set();
  for (const m of code.matchAll(INPUT_RE)) { const lit = unesc(m[2] || m[4] || ''); if (lit.length >= 4) s.add(lit); }
  return s;
}
function verdictFor(code, label, seed, labels, inputs) {
  const key = (label || '').replace(/\s+/g, ' ').trim();
  if (key.length < 4) return null;
  const lines = code.split('\n');
  let hit = -1;
  const frags = [key, key.replace(/^\d+x\d+\s*/, ''), key.slice(-12)].filter((s) => s.length >= 6);
  for (const frag of frags) {
    const probe = frag.slice(0, 12);
    for (let i = 0; i < lines.length; i++) {
      const plain = lines[i].replace(QUOTE_RE, ' ').replace(/\s+/g, ' ');
      if (plain.includes(probe) || lines[i].includes(probe)) { hit = i; break; }
    }
    if (hit >= 0) break;
  }
  if (hit < 0) return { kind: 'unlocated', lits: [] };
  const from = Math.max(0, hit - 3);
  let stmt = lines.slice(from, hit + 1).join('\n');
  for (let j = hit; j < Math.min(lines.length, hit + 4); j++) { stmt += '\n' + lines[j]; if (lines[j].includes(');')) break; }
  const lits = [];
  const isLabel = (lit) => labels.has(lit) || (lit.length >= 5 && /[一-鿿]/.test(lit) && [...labels].some((L) => L.includes(lit)));
  // 只有「这句确实在拿产物文本或页面文案比字面量」时，字面量缺失才是期望过期的证据；
  // 纯探针语句（把值 JSON.stringify 出来给人看）里的字面量不算。
  const STATIC_STMT = /\b(?:built|product|bundle|dist|htmlOut)\b|\w*Src\b|readFileSync|index\.html|template\.html/;
  // 另一类合法期望：拿页面取回的值和字面量比（r1.label === '功能介绍与二传二改说明'）——UI 文案改名只能这样发现。
  const CMP_STMT = /(?:===|!==|==|!=)\s*['"]|\.(?:includes|indexOf|startsWith|endsWith|match)\(\s*['"]/;
  const hasExpectation = STATIC_STMT.test(stmt) || CMP_STMT.test(stmt);
  const negated = (lit) => {
    const n = escRe(lit);
    return new RegExp('!\\s*[\\w.]*\\.(?:includes|indexOf|match|test|startsWith|endsWith)\\(\\s*[\'"]' + n).test(stmt) ||
      new RegExp('\\.(?:indexOf|search|find)\\(\\s*[\'"]' + n + '[\'"]\\s*\\)\\s*(?:<\\s*0|[=!]==?\\s*-1|<\\s*0)').test(stmt);
  };
  const isPath = (lit) => /^\.{0,2}[^\s]*\.(m?js|css|html?|json|txt|md|png)$/i.test(lit) || /^(?:src|tools|\/)/.test(lit);
  const joinedCmp = /\.join\(\s*['"]/.test(stmt);
  for (const m of stmt.matchAll(QUOTE_RE)) {
    const lit = unesc(m[2]);
    if (lit.length < 4 || /^\s+$/.test(lit)) continue;
    if (lit === key || key.includes(lit) || isLabel(lit)) continue;
    if (/^[A-Z]{1,3}\d*\s/.test(lit) && /[一-鿿]/.test(lit)) continue;
    if (seed.has(lit) || inputs.has(lit) || !isAnchor(lit)) continue;
    if (!hasExpectation || negated(lit) || isPath(lit) || joinedCmp) continue;
    lits.push(lit);
  }
  // DOM 选择器锚点：只看非 CSS 源码（页面 markup 是否还生成这个元素）
  const selKinds = [];
  for (const m of stmt.matchAll(SEL_RE)) {
    const raw = unesc(m[2]);
    for (const tok of raw.matchAll(/([.#])([A-Za-z][\w-]{3,})/g)) {
      const name = tok[2];
      if (seed.has(name) || seed.has(tok[1] + name)) continue;
      if (!inMarkup(name)) {
        selKinds.push({ lit: tok[1] + name, kind: 'stale', note: '页面 markup 里已不生成该元素（只在 CSS 或彻底没有）' });
      } else selKinds.push({ lit: tok[1] + name, kind: 'live' });
    }
  }
  if (!lits.length && !selKinds.length) return { kind: 'runtime', lits: [] };
  const kinds = lits.map((lit) => {
    const inProd = product.includes(lit);
    const inSrc = srcAll.includes(lit);
    if (!inProd && !inSrc) return { lit, kind: 'stale' };
    if (inSrc && !inProd) return { lit, kind: 'notwired', where: srcBlobs.filter(([, t]) => t.includes(lit)).map(([f]) => f.replace(/^src\//, '')).join(',') };
    if (!inSrc && inProd) return { lit, kind: 'prodonly' };
    return { lit, kind: 'live' };
  });
  const notwired = kinds.filter((k) => k.kind === 'notwired').concat(selKinds.filter((k) => k.kind === 'notwired'));
  const stale = kinds.filter((k) => k.kind === 'stale').concat(selKinds.filter((k) => k.kind === 'stale'));
  const live = kinds.filter((k) => k.kind === 'live').concat(selKinds.filter((k) => k.kind === 'live'));
  if (notwired.length) return { kind: 'notwired', lits: notwired };
  if (stale.length && !live.length) return { kind: 'stale', lits: stale };
  if (stale.length) return { kind: 'mixed', lits: stale };
  return { kind: 'runtime', lits: [] };
}

// 被 import 时只暴露分类函数，不启动几十个浏览器跑批（供 tools/verify-triage-classify.mjs 复判自检）
if (IS_MAIN) await main();
export { isAnchor, seedLitsOf, labelLitsOf, inputLitsOf, inMarkup, verdictFor, stripComments };

async function main() {
const files = collectFiles();
// 空清单必须报错退出：实测它会打印一份和「查过了、没发现问题」完全同形的全零报告，极易被当清白结论引用
if (!files.length) {
  console.error('清单为空：' + (opt('scripts', '') ? '--scripts 里的文件在 tools/ 下都不存在' : '日志 ' + logPath + ' 里没有一条「--- verify-xxx.mjs」失败段（可能这一趟全绿，也可能 verify-suite 的输出格式已改，去看第 129 行）') + '。0 项待分类 ≠ 无缺陷。');
  process.exit(2);
}
console.log('待分类红项：' + files.length + ' 个脚本，并发 ' + JOBS + '，单脚本 ' + TMO / 1000 + 's，产物 ' + prodFp + '（' + productBuf.length + ' 字节）');
const rows = await pool(files, JOBS, (f) => run(f));
const per = [];
for (const r of rows) {
  const code = readFileSync(abs('tools/' + r.file), 'utf8');
  const seed = seedLitsOf(code);
  const labels = labelLitsOf(code);
  const inputs = inputLitsOf(code);
  const fails = [];
  for (const raw of r.out.split(/\r?\n/)) {
    const m = raw.match(/(?:FAIL|❌|✗|×)\s+(.{4,}?)\s*(?:\[|$)/);
    if (m && !/合计|结果|通过/.test(m[1])) fails.push(m[1].replace(/\s+/g, ' ').trim());
  }
  const items = fails.map((label) => Object.assign({ label }, verdictFor(code, label, seed, labels, inputs) || { kind: 'unlocated', lits: [] }));
  per.push({ file: r.file, code: r.code, killed: r.killed, ms: r.ms, spawnError: r.spawnError, cached: r.cached, fails, items });
}

const short = (s, n) => { s = s == null ? '' : String(s); return s.length > n ? s.slice(0, n) + '…' : s; };
const out = [];
const say = (s) => { out.push(s); console.log(s); };
say('产物指纹 ' + prodFp + '（' + productBuf.length + ' 字节）· 生成于 ' + new Date().toISOString() + ' · 下列判定只对这个字节串有效，产物一变请整批重跑');

for (const p of per) {
  const kinds = p.items.map((i) => i.kind);
  if (p.code === 0 && !p.killed) p.tag = 'green';
  else if (kinds.includes('notwired')) p.tag = 'notwired';
  else if (kinds.includes('stale') || kinds.includes('mixed')) p.tag = 'stale';
  else if (p.fails.length && kinds.length && kinds.every((k) => k === 'unlocated')) p.tag = 'unlocated';
  else p.tag = 'runtime';
}
const grp = (t) => per.filter((p) => p.tag === t);

say('\n\n===== A 疑似漏接入产物（src 里有、index.html 里没有）——优先当回归查 ' + grp('notwired').length + ' 项 =====');
for (const p of grp('notwired')) for (const i of p.items.filter((x) => x.kind === 'notwired')) say('  · ' + p.file + ' → 「' + short(i.label, 46) + '」锚点「' + short((i.lits[0] || {}).lit, 34) + '」在 ' + (i.lits[0] || {}).where);

say('\n===== B 疑似期望过期（断言锚点在 src 注释外与产物里都找不到）' + grp('stale').length + ' 项 =====');
for (const p of grp('stale')) { const it = p.items.find((i) => i.kind === 'stale' || i.kind === 'mixed') || {}; const a = (it.lits || [])[0] || {}; say('  · ' + p.file + ' → 「' + short(it.label, 44) + '」锚点「' + short(a.lit, 34) + '」' + (a.note || 'src/产物都没有')); }

say('\n===== C 运行时行为断言（锚点查不出问题，需人看或按域交接）' + grp('runtime').length + ' 项 =====');
for (const p of grp('runtime')) say('  · ' + p.file + (p.spawnError ? ' [脚本没跑起来：' + p.spawnError + '，与功能无关]' : (p.killed ? ' [超时]' : '')) + ' FAIL ' + p.fails.length + ' 条：' + (FULL ? p.fails.slice(0, 3).map((x) => short(x, 40)).join(' | ') : short(p.fails[0] || '（无 FAIL 行，仅退出码非 0）', 60)));
if (REUSE) {
  const used = per.filter((p) => p.cached).length;
  say('  （--reuse：' + used + '/' + per.length + ' 项命中指纹 ' + prodFp + ' 的缓存，其余 ' + (per.length - used) + ' 项已实跑）');
}

say('\n===== E FAIL 行在脚本源码里定位不到断言（分类器没读懂它，不算结论）' + grp('unlocated').length + ' 项 =====');
for (const p of grp('unlocated')) say('  · ' + p.file + ' FAIL ' + p.fails.length + ' 条：' + short(p.fails[0] || '', 60));

say('\n===== D 本次已复跑转绿（说明之前红在旧产物上）' + grp('green').length + ' 项 =====');
for (const p of grp('green')) say('  · ' + p.file);

const cnt = (t) => grp(t).length;
say('\n合计：红项脚本 ' + per.length + ' 个 = A 漏接入 ' + cnt('notwired') + ' / B 期望过期 ' + cnt('stale') + ' / C 运行时 ' + cnt('runtime') + ' / D 转绿 ' + cnt('green') + ' / E 分类器读不懂 ' + cnt('unlocated'));
say('口径提醒：A/B 是「锚点字面量」级别的判定，锚点被运行时拼接或只出现在注释里会被误分，处置前用 --full 或直接读那一行断言确认。');
writeFileSync(abs('tools/tmp-triage-report.txt'), out.join('\n'), 'utf8');
say('\n报告已写入 tools/tmp-triage-report.txt');

}
