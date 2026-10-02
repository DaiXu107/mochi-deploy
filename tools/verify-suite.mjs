// verify 批量 runner：一次跑完 tools/verify-*.mjs，逐个报退出码/耗时/末行摘要
// 立项原因（#100 审计）：tools/ 下 180+ 个回归脚本，此前只能一个个手敲，实际没人跑，
// 清单里写的「验证方式」是否仍成立无人知晓。本脚本把它变成一条命令的可见性。
// 用法：
//   node tools/verify-suite.mjs                 跑全部（默认并发 3，超时 180s）
//   node tools/verify-suite.mjs mail chat       只跑文件名含 mail 或 chat 的
//   node tools/verify-suite.mjs --jobs 1 --timeout 300000
//   node tools/verify-suite.mjs --strict        有失败则整体退出码 1（清干净清单后再当门禁用）
//   node tools/verify-suite.mjs --no-core       不带 tools/verify.mjs（布局主检查）
//   node tools/verify-suite.mjs --tail 12       失败项多打几行输出
// 端口契约：并发时 runner 用 MOCHI_CDP_PORT 下发一个刚探到的空闲端口；脚本侧写成
//   const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
// 即可享受隔离（单跑时 env 不存在，行为与原来一致）。不读该 env 的脚本仍各自随机取端口，
// 而现存脚本的取值区间大面积重叠（9900+random(100) 一类），并发结论存疑时用 --jobs 1 复跑。
// 退出码：默认 0（失败只做可见性报告——现存脚本里混有断言已过期、以及需要真机/网络的项，
// 一上来就当门禁会被整体跳过）；--strict 时有失败/超时/启动异常 → 1。
import { spawn } from 'node:child_process';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envOf, suspectOf } from './lib/verify-classify.mjs';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const SELF = 'verify-suite.mjs';

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const VALUE_OPTS = ['--jobs', '--timeout', '--tail'];
const filters = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('-')) { if (VALUE_OPTS.includes(a)) i++; continue; }
  filters.push(a);
}
const JOBS = Math.max(1, Number(opt('--jobs', 3)) || 3);
const TIMEOUT = Math.max(1000, Number(opt('--timeout', 180000)) || 180000);
const TAIL = Math.max(1, Number(opt('--tail', 6)) || 6);
const STRICT = has('--strict');

const toolsDir = join(root, 'tools');
let files = readdirSync(toolsDir).filter(f => /^verify-.*\.mjs$/.test(f) && f !== SELF).sort();
// verify-triage（套件事后分析器，需 --scripts/套件日志参数）与其分类判据自检 classify
// 都是元工具不是产品回归检查，混进被跑清单必然误报（#129）
// verify-worktree-revert（#1213 构建前打回体检／#1214 缩尺体检）判的是**工作树状态**不是产品行为：
// 它由 `node build.mjs` 每次构建前置调用（＋`npm run check:revert`），进电池只会在旧底工作树里常驻
// 一条红、在 archive 副本里以 "exit 2" 的失败面目出现，两边都污染「两侧同分」的读数（#1214 实测）。
files = files.filter(f => f !== 'verify-triage.mjs' && f !== 'verify-triage-classify.mjs' && f !== 'verify-worktree-revert.mjs');
if (!has('--no-core') && existsSync(join(toolsDir, 'verify.mjs'))) files = ['verify.mjs'].concat(files);
if (filters.length) files = files.filter(f => filters.some(p => f.includes(p)));
if (!files.length) { console.log('没有匹配的 verify 脚本（过滤器：' + filters.join(', ') + '）'); process.exit(0); }

const freePort = () => new Promise((res) => {
  const s = createServer();
  s.on('error', () => res(0));
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

// ===== 临时档目录清扫（2026-09-18 磁盘满事故根治，与文末 #162 进程清理配套）=====
// 上面的进程清理只杀 chrome.exe，脚本 mkdtemp 出来的 mochi-* profile 目录会永久残留
//（实测一晚堆积数十 GB 打满 C 盘：WORKLOG「21:5x 共享基础设施事故」条）。这里按
// mtime 清扫 45 分钟前的 mochi-* 目录——并行会话正在跑的活跃档（mtime 新）不受影响；
// Windows 句柄占用导致的单目录删除失败逐个忽略，下轮再清，绝不影响套件结论。
async function sweepStaleProfiles() {
  try {
    const fs = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const base = tmpdir();
    const cutoff = Date.now() - 45 * 60 * 1000;
    let swept = 0;
    for (const name of fs.readdirSync(base)) {
      if (name.slice(0, 6) !== 'mochi-') continue;
      try {
        const full = join(base, name);
        if (fs.statSync(full).mtimeMs > cutoff) continue;
        fs.rmSync(full, { recursive: true, force: true });
        swept++;
      } catch (e) { /* 句柄占用/权限：忽略 */ }
    }
    if (swept) console.log('（已清扫 ' + swept + ' 个 45 分钟前残留的 mochi-* 临时档目录，防磁盘涨满复发）');
  } catch (e) { /* 清理失败不影响套件结论 */ }
}
await sweepStaleProfiles();

const RUN_ONE_PORT = 'MOCHI_CDP_PORT';
const usesPortEnv = new Map();
const scriptTimeout = new Map();

const runOne = async (file) => new Promise(async (res) => {
  const t0 = Date.now();
  const port = JOBS > 1 ? await freePort() : 0;
  if (!usesPortEnv.has(file)) {
    let honors = false;
    try { honors = readFileSync(join(toolsDir, file), 'utf8').includes(RUN_ONE_PORT); } catch (e) {}
    usesPortEnv.set(file, honors);
  }
  const child = spawn(process.execPath, [join(toolsDir, file)], {
    cwd: root, windowsHide: true,
    env: port ? Object.assign({}, process.env, { [RUN_ONE_PORT]: String(port) }) : process.env
  });
  // 脚本级超时提示：脚本头部 `verify-suite:timeout=毫秒` 可上调单个慢脚本预算（#129，pong-balance 首用）
  let tmo = TIMEOUT;
  if (!scriptTimeout.has(file)) {
    try {
      const m = readFileSync(join(toolsDir, file), 'utf8').match(/verify-suite:timeout=(\d+)/);
      scriptTimeout.set(file, m ? Math.max(TIMEOUT, Number(m[1])) : TIMEOUT);
    } catch (e) { scriptTimeout.set(file, TIMEOUT); }
  }
  tmo = scriptTimeout.get(file);
  let buf = '';
  let killed = '';
  const timer = setTimeout(() => { killed = 'timeout'; try { child.kill('SIGKILL'); } catch (e) {} }, tmo);
  child.stdout.on('data', d => { buf += d; if (buf.length > 400000) buf = buf.slice(-200000); });
  child.stderr.on('data', d => { buf += d; if (buf.length > 400000) buf = buf.slice(-200000); });
  child.on('error', e => { clearTimeout(timer); res({ file, code: -1, ms: Date.now() - t0, killed: 'spawn-error: ' + e.message, out: buf }); });
  child.on('close', (code, signal) => {
    clearTimeout(timer);
    res({ file, code: code === null ? -1 : code, signal, ms: Date.now() - t0, killed, out: buf });
  });
});

const linesOf = out => out.replace(/\r/g, '').split('\n').map(s => s.trimEnd()).filter(Boolean);
const lastLine = out => { const l = linesOf(out); return l.length ? l[l.length - 1].slice(0, 90) : ''; };

// 「跑不动」不等于「跑红了」：浏览器起不来 / 需要外网 这类环境缺口单独归类，
// 混进失败里会让整份报告失去可信度（实测本机未装 playwright 浏览器时 14 个脚本一律红）。
// 但连 127.0.0.1 被拒不是外网问题：那是本机 CDP 没起来（并发时多为端口撞车），单跑复核才算数。
// 口径抽到 lib/verify-classify.mjs，由 tools/verify-suite-classify.mjs 反向对照守着。

console.log('verify 套件：' + files.length + ' 个脚本，并发 ' + JOBS + '，单脚本超时 ' + (TIMEOUT / 1000) + 's');
console.log('（跑的是仓库根目录产物 index.html，请先 npm run build 再看结果）\n');

const results = [];
let cursor = 0;
const worker = async () => {
  while (cursor < files.length) {
    const file = files[cursor++];
    const r = await runOne(file);
    if (r.code !== 0 && !r.killed) { r.suspect = suspectOf(r.out); if (!r.suspect) r.env = envOf(r.out); }
    results.push(r);
    const tag = r.killed ? '⏱ ' : (r.code === 0 ? '✅ ' : (r.suspect ? '🔀 ' : (r.env ? '⚠️ ' : '❌ ')));
    console.log(tag + file.padEnd(46) + ' ' + String(r.ms) + 'ms  ' + (r.killed || r.suspect || r.env || ('exit ' + r.code)) + '  ' + lastLine(r.out));
  }
};
await Promise.all(Array.from({ length: Math.min(JOBS, files.length) }, worker));

results.sort((a, b) => a.file.localeCompare(b.file));
const timeouts = results.filter(r => r.killed);
const suspects = results.filter(r => !r.killed && r.suspect);
const envBad = results.filter(r => !r.killed && !r.suspect && r.env);
const failed = results.filter(r => !r.killed && !r.suspect && !r.env && r.code !== 0);
const ok = results.filter(r => r.code === 0 && !r.killed).length;
const hard = failed.concat(timeouts);

if (suspects.length) {
  console.log('\n===== 🔀 疑似本机 CDP 端口撞车 ' + suspects.length + ' 项（不算回归，单跑复核后再定性）=====');
  for (const r of suspects) console.log('  ' + r.file.padEnd(46) + r.suspect + ' → node tools/' + r.file);
}
const honoring = results.filter(r => usesPortEnv.get(r.file)).length;
if (JOBS > 1 && honoring < results.length) {
  console.log('\n端口隔离：本批 ' + results.length + ' 个脚本中 ' + honoring + ' 个读取了 MOCHI_CDP_PORT（其余仍从各自重叠的随机窄区间取端口，并发 ' + JOBS + ' 时仍可能撞车 → 结论存疑时用 --jobs 1 复跑）');
}

if (hard.length) {
  console.log('\n===== 断言失败 / 超时 ' + hard.length + ' 项 =====');
  for (const r of hard) {
    console.log('\n--- ' + r.file + '（' + (r.killed || 'exit ' + r.code + (r.signal ? ' / ' + r.signal : '')) + '，' + r.ms + 'ms）');
    linesOf(r.out).slice(-TAIL).forEach(l => console.log('    ' + l.slice(0, 200)));
  }
}
if (envBad.length) {
  console.log('\n===== 环境不满足 ' + envBad.length + ' 项（不算回归，装好浏览器/接上外网后复跑）=====');
  envBad.forEach(r => console.log('  ⚠️  ' + r.file.padEnd(46) + r.env));
}
const slow = results.filter(r => r.ms > 60000).sort((a, b) => b.ms - a.ms);
if (slow.length) {
  console.log('\n===== 最慢 ' + Math.min(10, slow.length) + ' 项（>60s，值得复核是否卡在等待上）=====');
  slow.slice(0, 10).forEach(r => console.log('  ' + (r.ms / 1000).toFixed(1) + 's  ' + r.file));
}
console.log('\n===== 合计：' + ok + ' 通过 / ' + failed.length + ' 断言失败 / ' + envBad.length + ' 环境不满足 / ' + suspects.length + ' 疑似撞车 / ' + timeouts.length + ' 超时（共 ' + results.length + '）=====');
if (hard.length) {
  console.log('注意：断言失败 ≠ 一定是回归。现存脚本含「断言已被后续版本改掉」一类，' +
    '请逐项对照 FIX-REGRESSION.md 判定：该修的修，已过期的删或改期望，别整体忽略。' +
    '需要把它当门禁时用 --strict（断言失败或超时即退出码 1；环境不满足不算）。');
}
// #162/#129 防泄漏：跑批末清理残留无头 Chrome（只杀命令行同时带 remote-debugging-port
// 且 user-data-dir 含 mochi- 的验证实例——脚本临时档都是 mkdtemp('mochi-*')，不碰用户浏览器）
if (process.platform === 'win32') {
  try {
    const { execSync } = await import('node:child_process');
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -match 'remote-debugging-port' -and $_.CommandLine -match 'mochi-' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`, { stdio: 'ignore', timeout: 30000 });
    console.log('（已清理残留验证用无头 Chrome，防 #162 型临时档涨盘）');
  } catch (e) { /* 清理失败不影响套件结论 */ }
}
await sweepStaleProfiles();
process.exit(hard.length && STRICT ? 1 : 0);
