// verify-touchmove-passive.mjs — #721 低端机触摸滚动被动化（全库 touchmove 审计）
// 断言：src/js 下每一处 addEventListener('touchmove', …) 必须满足其一——
//   · 显式 { passive: true }（处理体不需阻止默认滚动）
//   · 处理体真调用 preventDefault()（如游戏画布、长按拖拽=必须保持 non-passive）
// 违反＝手指每次滑动都要等主线程跑完该回调才滚动/合成（低端安卓列表滚动被阻塞、掉帧）。
// 用静态窗口启发式：从监听起点向后取处理体窗口，判断 passive 或 preventDefault 是否出现。
// 用法：node tools/verify-touchmove-passive.mjs [rootDir]（缺省＝仓库根；传 HEAD 导出树＝RED 基线）
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = join(root, 'src', 'js');
const LISTEN = /addEventListener\s*\(\s*['"]touchmove['"]/g;
const WINDOW = 700; // 处理体窗口（监听起点后 700 字符足够覆盖箭头/函数体与 options 对象）

const files = readdirSync(jsDir).filter((n) => n.endsWith('.js'));
const bad = [];
let total = 0, passiveOk = 0, pdOk = 0;

for (const name of files) {
  const text = readFileSync(join(jsDir, name), 'utf8');
  let m;
  LISTEN.lastIndex = 0;
  while ((m = LISTEN.exec(text))) {
    total++;
    const seg = text.slice(m.index, m.index + WINDOW);
    // 截到本次监听之后的下一处监听（从自身长度之后起找，否则 indexOf 会命中自己=窗口永不截断，
    // 后面无关回调里的 preventDefault 会误判本处为 OK）
    const next = seg.indexOf('addEventListener', m[0].length);
    const body = next > 0 ? seg.slice(0, next) : seg;
    const line = text.slice(0, m.index).split('\n').length;
    if (/passive\s*:\s*true/.test(body)) { passiveOk++; continue; }
    // passive:false 是作者显式声明「本处需要阻止默认」（配具名函数处理体时常见），合法
    if (/passive\s*:\s*false/.test(body)) { pdOk++; continue; }
    if (/preventDefault\s*\(/.test(body)) { pdOk++; continue; }
    bad.push(name + ':' + line);
  }
}

console.log('touchmove 监听共 ' + total + ' 处：passive:true ' + passiveOk + ' / 含 preventDefault ' + pdOk + ' / 裸监听 ' + bad.length);
if (bad.length) {
  console.log('FAIL 以下 touchmove 监听既未标 passive、处理体也不 preventDefault（低端机滑动阻塞候发点）：');
  bad.forEach((b) => console.log('  - ' + b));
} else {
  console.log('PASS 全部 touchmove 监听均已 passive 或真 preventDefault');
}
process.exit(bad.length ? 1 : 0);
