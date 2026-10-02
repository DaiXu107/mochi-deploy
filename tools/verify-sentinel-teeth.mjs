// 反向对照：逐条删掉 #100 修复所在的源文件行，重建后哨兵必须报警且构建退出码 = 1
// （P0「装上牙齿」的验收：不能只测「全绿」，必须测「破一次会不会响」）
// 用法：node tools/verify-sentinel-teeth.mjs   （在 %TEMP% 下的 src 临时副本里构建，不碰仓库产物）
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const repo = join(process.cwd());
const T = join(process.env.TEMP || '/tmp', 'mochi-negative-sentinel');
rmSync(T, { recursive: true, force: true });
mkdirSync(T, { recursive: true });
copyFileSync(join(repo, 'build.mjs'), join(T, 'build.mjs'));
cpSync(join(repo, 'src'), join(T, 'src'), { recursive: true });

const CASES = [
  ['js/device.js', 'try { window.__jsErrors = window.__jsErrors || []; } catch (e0) {}', '#100 __jsErrors 预初始化'],
  ['js/device.js', "const note = terminal ? '未完成（本机存储无响应，稍后重开诊断再试）' : '未读到（本机存储响应慢，稍后自动补全）';", '#100 软/硬预算标注'],
  ['js/device.js', 'if (!modalAlive()) { closed = true; return; }', '#100 弹窗判活'],
  ['js/device.js', 'const seen = Number(localStorage.getItem(SEEN_KEY)) || 0;', '#100 角标时间戳'],
  ['js/device.js', 'const ERR_CAP = 20;', '#100 环形 20 条'],
  ['js/memo-arc.js', "}, { noInput: true, pill: 'del', pills: [{ label: '取消', value: 'no' }, { label: '删除', value: 'del' }] });", '换锚点后：TA档案 pill（memo-arc 侧）'],
];

let ok = 0, bad = 0;
const say = (name, pass, info) => { console.log((pass ? '  ✅ ' : '  ❌ ') + name + (info ? '   [' + info + ']' : '')); pass ? ok++ : bad++; };

// 基线：未破坏时必须全绿且退出码 0
const base = run();
say('基线未破坏 → 退出码 0 且无 ❌', base.code === 0 && !/❌/.test(base.out), 'code=' + base.code);

for (const [file, line, label] of CASES) {
  resetSrc();
  const p = join(T, 'src', file);
  const src = readFileSync(p, 'utf8');
  if (!src.includes(line)) { say(label + '（源行没找到，用例失效）', false, file); continue; }
  writeFileSync(p, src.split(line).join(''));
  const r = run();
  const hit = r.out.split('\n').filter((l) => /❌/.test(l)).join(' | ').slice(0, 220);
  say(label + ' → 报警 + 退出码 1', r.code === 1 && /❌/.test(r.out), hit || ('code=' + r.code + ' 无任何 ❌ 输出（哑了）'));
  const hinted = /← src 里也没有＝修复真丢了/.test(r.out);
  say('   ↳ 并指明「src 里也没有＝修复真丢了」', hinted, hinted ? '' : '缺源文件对照提示');
}
rmSync(T, { recursive: true, force: true });
console.log('\n===== 反向对照 ' + ok + ' 通过 / ' + bad + ' 失败 =====');
process.exit(bad ? 1 : 0);

function resetSrc() {
  cpSync(join(repo, 'src'), join(T, 'src'), { recursive: true, force: true });
}
function run() {
  try {
    const out = execFileSync(process.execPath, [join(T, 'build.mjs')], { encoding: 'utf8', cwd: T, stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}
