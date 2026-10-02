// ===== 验证脚本：#452 卡顿自检提示「每次打开都弹」+ 启动全量扫描大库冻结 =====
// 背景：iPhone 15 Pro Max Chrome 报「每次打开都有自检和优化，点击之后再次打开仍然会有」
// （同机伴发 iOS 卡顿/自动刷新重进）——①#411 免打扰标记裸 localStorage.setItem 在 LS 配额
// 满（诊断 5.1MB 顶满 iOS 配额、写探针 QuotaExceededError）时被 catch 吞＝标记永远写不进＝
// 每次启动都弹；②启动扫描 mochiCcSlimScan 把 44.59MB 公用库整串读进堆+逐组 stringify（纯算
// 字节）＝启动期秒级长任务。修复=#452 标记 IDB 权威写+LS 兜底、读侧取较新；启动分级改
// __big-idx 尺寸门控（idbListKeys+idbBigSize 免读大值），逐组明细留给设置行主动扫。
// 本脚本从 src 提取真实实现做行为断言（桩 localStorage/IDB/计时器）。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const pers = readFileSync(join(root, 'src/js/personalize.js'), 'utf8');
const build = readFileSync(join(root, 'build.mjs'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } }

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

// --- R 标记读写：IDB 权威 + LS 兜底，读侧取较新 ---
{
  const lsStore = { 'xy-home-v2:perf-opt-remind': '1000' };
  const idbStore = { 'xy-home-v2:perf-opt-remind': '2000' };
  const windowMock = {
    idbGet: (k) => Promise.resolve(idbStore[k]),
    idbSet: (k, v) => { idbStore[k] = v; return Promise.resolve(true); },
  };
  const lsMock = { getItem: (k) => (k in lsStore ? lsStore[k] : null), setItem: (k, v) => { lsStore[k] = v; }, throwOnSet: false };
  // 让 LS setItem 可注入抛错（配额满场景）
  const lsFailing = {
    getItem: (k) => (k in lsStore ? lsStore[k] : null),
    setItem: () => { throw new Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' }); },
  };
  const perfRemindRead = new Function('window', 'localStorage', 'PERF_REMIND_KEY',
    extractFn(pers, 'perfRemindRead') + '\nreturn perfRemindRead;')(windowMock, lsMock, 'xy-home-v2:perf-opt-remind');
  const perfRemindWrite = new Function('window', 'localStorage', 'PERF_REMIND_KEY',
    extractFn(pers, 'perfRemindWrite') + '\nreturn perfRemindWrite;')(windowMock, lsMock, 'xy-home-v2:perf-opt-remind');
  const perfRemindWriteFailing = new Function('window', 'localStorage', 'PERF_REMIND_KEY',
    extractFn(pers, 'perfRemindWrite') + '\nreturn perfRemindWrite;')(windowMock, lsFailing, 'xy-home-v2:perf-opt-remind');

  const r1 = await new Promise(res => perfRemindRead(res));
  ok('R1 IDB 较新则取 IDB 值', r1 === 2000);
  idbStore['xy-home-v2:perf-opt-remind'] = undefined; // 模拟 IDB 无值
  const r2 = await new Promise(res => perfRemindRead(res));
  ok('R2 IDB 无值回退 LS 值', r2 === 1000);
  const w1 = perfRemindWrite(5555);
  ok('W1 双路写入（LS+IDB）', lsStore['xy-home-v2:perf-opt-remind'] === '5555' && idbStore['xy-home-v2:perf-opt-remind'] === '5555' && w1 === undefined);
  perfRemindWriteFailing(6666); // LS setItem 抛 QuotaExceeded 不许外溢
  ok('W2 LS 配额满时 IDB 写入不受阻（标记仍可持久化）', idbStore['xy-home-v2:perf-opt-remind'] === '6666');
}

// --- P 启动分级：尺寸门控免读大值，仅「重」级弹 ---
{
  const PUB = 'xy-home-v2:cc-groups-public', OWN = 'xy-home-v2:default:cc-groups', OTHER = 'xy-home-v2:default:chat-msgs';
  const keys = [PUB, OWN, OTHER, 'xy-home-v2:default:fav-msgs'];
  const sizes = { [PUB]: 44700000, [OWN]: 2100000 }; // 44.7MB + 2.1MB；其余小键无尺寸
  let scanned = null, prompted = null, marked = 0;
  const windowMock = {
    idbListKeys: () => { scanned = true; return Promise.resolve(keys); },
    idbBigSize: (k) => (typeof sizes[k] === 'number' ? sizes[k] : null),
    mochiPerfLevel: (totalBytes, bigGroups) => ((totalBytes > 16 * 1048576 || bigGroups >= 6) ? '重' : ((totalBytes > 5 * 1048576 || bigGroups >= 2) ? '中' : '轻')),
  };
  const lsStore = {};
  const lsMock = { getItem: () => null, setItem: (k, v) => { lsStore[k] = v; } };
  const perfRemindRead = (cb) => cb(0);
  const perfRemindWrite = (t) => { marked = t; lsMock.setItem('xy-home-v2:perf-opt-remind', String(t)); };
  const promptHeal = (agg) => { prompted = agg; };
  const maybePerfPrompt = new Function('perfRemindRead', 'perfRemindWrite', 'promptHeal', 'window', 'localStorage', 'setTimeout',
    extractFn(pers, 'maybePerfPrompt') + '\nreturn maybePerfPrompt;')(
    perfRemindRead, perfRemindWrite, promptHeal, windowMock, lsMock,
    (fn) => fn() // 立即执行内层判定（真实为 2500ms 让出启动帧）
  );
  maybePerfPrompt();
  await new Promise(r => setTimeout(r, 0));
  ok('P1 启动只读键清单与尺寸索引（零大值读取）', scanned === true);
  ok('P2 重级（44.7MB 公用库）触发提示且带聚合数据', !!prompted && prompted.ok === true && prompted.libs === 2 && prompted.biggestBytes === 44700000 && prompted.totalBytes === 46800000 && prompted.bigGroups === 2);
  ok('P3 弹前先写免打扰标记（IDB+LS 双路）', marked > 0 && !!lsStore['xy-home-v2:perf-opt-remind']);

  // 轻级：不弹、不写标记
  scanned = null; prompted = null; marked = 0;
  sizes[PUB] = 100000; sizes[OWN] = 50000;
  maybePerfPrompt();
  await new Promise(r => setTimeout(r, 0));
  ok('P4 轻级库不弹不打扰', prompted === null && marked === 0 && scanned === true);

  // 清单读失败（null=未知）：不判不为提示读大值
  scanned = null; prompted = null; marked = 0;
  sizes[PUB] = 44700000; sizes[OWN] = 2100000;
  windowMock.idbListKeys = () => Promise.resolve(null);
  maybePerfPrompt();
  await new Promise(r => setTimeout(r, 0));
  ok('P5 清单未知本轮不判（绝不为提示读大值）', prompted === null && marked === 0);
}

// --- S 源码/哨兵锚点 ---
ok('S1 启动路径不再调用全量 mochiCcSlimScan（移交设置行主动扫）', (() => {
  const fn = extractFn(pers, 'maybePerfPrompt');
  return !fn.includes('mochiCcSlimScan');
})());
ok('S2 哨兵登记 build.mjs（#452 标记 IDB 读）', build.includes("needle: 'window.idbGet(PERF_REMIND_KEY)'"));
ok('S3 #411 锚随口径演进更新（尺寸门控，不与 #452 共用哑锚）', build.includes("needle: \"window.mochiPerfLevel(totalBytes, bigGroups) !== '重'\"") && (build.match(/needle: "window\.mochiPerfLevel\(totalBytes, bigGroups\) !== '重'"/g) || []).length === 1);
ok('S4 旧裸标记读写已废除', !pers.includes("localStorage.getItem('xy-home-v2:' + PERF_REMIND_KEY)"));

console.log(pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
