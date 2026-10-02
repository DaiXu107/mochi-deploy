// verify-perf-check.mjs — #726 卡顿自检（渲染层实测）回归断言（源级，不依赖产物构建）
// 断言 src 状态（build.mjs 从 src 合并，src 状态＝产物状态）：
//   A1 perf-check.js 已登记 jsFiles 且在 mobile-adapt.js 之前（漏登记＝整功能不打包）
//   A2 template.html 有 row-perf-check 且在 row-perf-optimize 之前（删行＝无入口）
//   A3 personalize.js 接线 mochiPerfCheck.start(10000（删＝点行无反应）
//   A4 零常驻开销：requestAnimationFrame 首次出现必须在 start 函数之后（rAF 常驻＝自造卡顿源）
//   A5 后台冻结帧剔除 BG_GAP=250 在位（#707 同款教训：后台 144s 冻结被算成一帧＝误报重度）
//   A6 键盘弹出期标记在位（innerHeight * KB_RATIO；删＝iOS 键盘期结论缺失）
//   A7 本地数据画像复用 mochiPerfLevel（删＝与 #411 一键优化断链、建议退化为空话）
//   A8 上次结果持久化 LAST_KEY：perf-check 写 + personalize 回显（删＝行副标题永远无上次结论）
//   A9 长任务观察器窗口内自建且 disconnect 收尾（漏 disconnect＝观察器泄漏常驻）
//   A10 报告走只读大弹窗（noInput+textarea+big，删＝报告进了可编辑输入框/窄窗难读）
//   A11 卡顿自检说明在 设置→关于→使用说明 11（原开屏公告第八章已按用户要求删除，template+notice.json 双份不留）
//   A12 build.mjs 登记 #726a~d 四条哨兵（删哨兵＝修复被覆盖时构建照绿）
//   A13 node --check perf-check.js 语法过
// —— #770 追加（2026-09-18 红米 K80 Chrome 实报：停在设置页自检，报告称「掉帧集中:占卜(100%)」，
//    且「结论:流畅(未捕获掉帧)」与下方「掉帧 1 帧」并存）——
//   A14 掉帧归因读最上层全屏页 .page（旧实现读 .app 桌面图标＝图标显隐不随页面切换，归因恒错）
//   A15 旧桌面图标归因读取已删（回流＝「掉帧集中」恒报图标名而非实际所在页）
//   A16 掉帧阈值自适应 jankThr + 24/34 上下限（固定 32ms 在高刷屏漏计、持续掉帧窗口漏判）
//   A17 「流畅」但对零星掉帧的结论说真话（x% 可忽略；删＝与「掉帧 N 帧」自相矛盾回流）
//   A18 「掉帧集中」≥3 帧门槛 concOk（单帧噪声不引导用户排查该页大图/长内容）
//   A19 按页采样帧数 pageFrames + 页面分布行（集中度对比的分母）
//   A20 build.mjs 登记 #770a~e 五条哨兵
// —— #818 追加（2026-09-19 iOS 卡顿定位诊断增强：点按响应延迟/最慢帧现场/低电量档识别，
//    全部仍只活在检测窗口内、窗口结束即拆＝零常驻开销）——
//   A21 点按响应采样：窗口内 passive down 戳记＋下一帧结算（删＝「点了没反应」类 iOS 报障无数据）
//   A22 响应监听随窗口拆除 removeEventListener（泄漏＝常驻监听自造卡顿源）
//   A23 最慢帧现场 top3 截断（卡在哪个页/什么动作后可定位）
//   A24 iOS 低电量 30fps 档识别 minD≥28（低电量减半帧率被误判成应用卡顿）
//   A25 build.mjs 登记 #818a~d 四条哨兵
// —— #934 追加（红米 K80 Chrome 自检 docx 三处口径缺陷 + 两处归因补齐，详见 perf-check.js 头部）——
//   A26 后台/锁屏时长实测 bgMs（fps 分母/占比提示/间隙判定都靠它；删＝回「整窗当分母」虚低 fps）
//   A27 fps 按前台有效时长算 effMs（旧＝frames/整窗，300 秒窗口 60fps 被写成 24.2fps）
//   A28 后台占比按实测时长点名（旧＝冻结段数与有效帧数比大小＝量纲不同恒不触发）
//   A29 前台冻结识别（>250ms 且无隐藏期照常计入，60s 硬兜底保 #707 防线）
//   A30 长任务归因 top3（第几秒·哪页·切页后/键盘期/后台期；删＝1.6s 级阻塞查无现场）
//   A31 集中页按「掉帧率」选 + ≥2 倍其余页判据 + 「分散」结论（旧按计数＝选中停留最久的页）
//   A32 build.mjs 登记 #934a~g 七条哨兵
//   A33 结论「流畅」但窗内有冻结/长任务时不再武断「无需处理」（旧文案与「最长 1630ms」并存）
//   A34 长任务 top3 每次入列都按 ms 降序（旧写法恰好 3 条时按时间序＝「最长的 3 次」最长的不在最前）
// —— #941 追加（报告可读性三处，用户「还有什么可以优化的」点名 1/3/4）——
//   A35 最慢帧现场图例按需出现（只解释现场真出现过的标记；旧版无条件附「切页后/前台冻结」，
//       且现场会出现「键盘期」标记却没有对应解释）
//   A36 「与上次对比」行：读上一轮摘要（必须在覆盖写 LAST_KEY 之前）＋旧格式记录不参与对比
//   A37 LAST_KEY 摘要扩字段（对比数据源；原 t/verdict/jankPct 保留供设置行回显）
//   A38 长任务按页面归总采样（仅前台任务计入 lt.agg）
//   A39 长任务按页面归总输出行（≥2 次前台任务才出现；后台期次数单独点名）
//   A40 build.mjs 登记 #941a~e 五条哨兵
// —— #958 追加（iPhone 12 Pro / iOS Safari 自检报告「正常帧间隔约 4ms」＝周期取单次最小帧间隔，
//   被一次 4ms 的 rAF 调度抖动污染 → jankThr 落 24ms 下限，60Hz 正常的 25~33ms 帧被误计成掉帧）——
//   A41 帧间隔直方图计票（≥4ms 且非冻结的间隔入账；单次抖动不入账）
//   A42 周期取「至少重复 3 次的最小取整间隔」，样本不足回退旧最小值口径
//   A43 build.mjs 登记 #958a~b 哨兵
// 用法：node tools/verify-perf-check.mjs [rootDir]
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' —— ' + detail : '')); }
}
const read = (p) => readFileSync(join(root, 'src', p), 'utf8').replace(/^\uFEFF/, '');

// A1 jsFiles 登记与顺序
const build = readFileSync(join(root, 'build.mjs'), 'utf8');
const jm = build.match(/const jsFiles = \[([^\]]*)\]/);
const files = jm ? jm[1].split(',').map(s => s.trim().replace(/^'|'$/g, '').replace(/^"/, '').replace(/"$/, '')) : [];
const pcIdx = files.indexOf('perf-check.js');
const maIdx = files.indexOf('mobile-adapt.js');
check('A1 jsFiles 含 perf-check.js 且在 mobile-adapt.js 之前', pcIdx > 0 && maIdx > pcIdx, 'perf-check@' + pcIdx + ' mobile-adapt@' + maIdx);

// A2 设置行存在且顺序在 row-perf-optimize 之前
const tpl = read('template.html');
const rcIdx = tpl.indexOf('id="row-perf-check"');
const roIdx = tpl.indexOf('id="row-perf-optimize"');
check('A2 row-perf-check 在位且在 row-perf-optimize 之前', rcIdx > 0 && roIdx > rcIdx, 'check@' + rcIdx + ' optimize@' + roIdx);

// A3 接线
const pz = read('js/personalize.js');
check('A3 personalize 接线 start(durMs)（#889 时长可选换锚）', pz.includes('window.mochiPerfCheck.start(durMs'));

// A4 零常驻：rAF 首现必须在 start 之后
const pc = read('js/perf-check.js');
const sIdx = pc.indexOf('function start(ms, onTick)');
const rIdx = pc.indexOf('requestAnimationFrame');
check('A4 零常驻开销：rAF 只在 start 内使用', sIdx > 0 && rIdx > sIdx, 'start@' + sIdx + ' raf@' + rIdx);

// A5 后台剔除
check('A5 后台冻结帧剔除 BG_GAP=250', /var BG_GAP = 250;/.test(pc));

// A6 键盘期标记
check('A6 键盘期标记 innerHeight * KB_RATIO', pc.includes('window.innerHeight * KB_RATIO'));

// A7 数据分级复用
check('A7 复用 mochiPerfLevel 数据画像', pc.includes('window.mochiPerfLevel'));

// A8 上次结果持久化 + 回显
check('A8a perf-check 写 LAST_KEY', pc.includes("localStorage.setItem(LAST_KEY"));
check('A8b personalize 回显 LAST_KEY', pz.includes('window.mochiPerfCheck.LAST_KEY'));

// A9 观察器收尾
check('A9 长任务观察器 disconnect 收尾', pc.includes('po.disconnect()'));

// A10 报告只读大弹窗
check('A10 报告走 noInput+textarea+big 弹窗', pz.includes('noInput: true, textarea: true, textareaRows: 16, big: true'));

// A11 公告八章已删、说明移入 设置→关于→使用说明 11（新落点在位＋旧章双份不留）
const notice = read('pwa/notice.json');
const oldSec = '八、卡顿自检（卡不卡，10 秒实测）';
check('A11 卡顿自检说明在关于·使用说明11，公告双份已删', tpl.includes("<b>先实测：卡不卡不用靠感觉——「卡顿自检」</b>") && !tpl.includes(oldSec) && !notice.includes(oldSec));

// A12 哨兵登记
const sent = (build.match(/#726[a-d] /g) || []).length;
check('A12 build.mjs 登记 #726a~d 哨兵', sent === 4, '实际 ' + sent);

// A13 语法
const ck = spawnSync(process.execPath, ['--check', join(root, 'src', 'js', 'perf-check.js')], { stdio: 'ignore' });
check('A13 node --check perf-check.js', !ck.status, 'exit ' + ck.status);

// —— #770 追加 ——
check('A14 掉帧归因读最上层全屏页 .page', pc.includes("querySelectorAll('.page:not([hidden])')"));
check('A15 旧桌面图标归因读取已删', !pc.includes(".app:not([hidden])"));
check('A16 掉帧阈值自适应 jankThr + 24/34 上下限', pc.includes('function jankThr()') && pc.includes('var MIN_JANK = 24;') && pc.includes('var MAX_JANK = 34;'));
check('A17 「流畅」+零星掉帧结论说真话（x% 可忽略）', pc.includes("'%，可忽略）'"));
check('A18 「掉帧集中」≥3 帧门槛 concOk', pc.includes('function concOk(r)'));
check('A19 按页采样帧数 pageFrames + 页面分布行', pc.includes('pageFrames') && pc.includes('采样期间主要在：'));
const sent770 = (build.match(/#770[a-e] /g) || []).length;
check('A20 build.mjs 登记 #770a~e 哨兵', sent770 === 5, '实际 ' + sent770);

// —— #818 追加 ——
check('A21 点按响应采样：窗口内 passive down 戳记＋下一帧结算', pc.includes("var downEv = window.PointerEvent ? 'pointerdown' : 'mousedown';") && pc.includes('var lat = now - lastDown; lastDown = -1;'));
check('A22 响应监听随窗口拆除（removeEventListener 收尾）', pc.includes('removeEventListener(downEv, onDown)'));
check('A23 最慢帧现场 top3 截断', pc.includes('scene.length = 3;') && pc.includes('scene.sort(function (a, b) { return b.ms - a.ms; });'));
check('A24 iOS 低电量 30fps 档识别（minD≥28ms）', pc.includes('rep.lp = minD >= 28;'));
const sent818 = (build.match(/#818[a-d] /g) || []).length;
check('A25 build.mjs 登记 #818a~d 哨兵', sent818 === 4, '实际 ' + sent818);

// —— #934 追加（报告口径纠偏 + 归因补齐）——
check('A26 后台/锁屏时长实测 bgMs（可见性跟踪 + 随窗拆除）', pc.includes('var bgMs = 0, hiddenAt = -1, hidPending = 0;') && pc.includes("document.addEventListener('visibilitychange', onVis") && pc.includes("document.removeEventListener('visibilitychange', onVis)"));
check('A27 fps 按前台有效时长算（frames/effMs，不再拿整窗当分母）', pc.includes('rep.effMs = Math.max(0, rep.spanMs - rep.bgMs);') && pc.includes('rep.frames * 10000 / rep.effMs'));
// #1412⑩ 反向钉：被减数必须是「实测窗口」，不许退回名义档位——提前结束（120 秒档跑 2 秒）与隐藏期
//   拖长（实测 8 秒档拖成 11.3 秒、bgMs 9664 > 所选 8000）两种情形下旧公式都算歪。
check('A27b #1412⑩ 名义档位当分母的旧公式不得回流', !pc.includes('rep.effMs = Math.max(0, rep.ms - rep.bgMs);'));
check('A27c #1412⑧ 到点结算不只挂在 rAF 上（隐藏页 rAF 停摆＝窗口永不结束）', pc.includes('endTimer = setTimeout(function () { finish(0); }, ms + 200);') && pc.includes('clearTimeout(endTimer)'));
check('A27d #1412⑨ 有提前结束的出口（旧导出面只有 start/running/LAST_KEY）', pc.includes("stop: function () { if (_finish) { _finish(); return true; } return false; },"));
check('A28 后台占比按实测时长点名（#1412⑧ 起分母＝实测窗口 _span，不再拿名义档位）', pc.includes('r.bgMs > _span * 0.5') && pc.includes('已剔除、不影响判定'));
check('A28b #1412⑧ 名义档位当占比分母的旧式不得回流（提前结束与隐藏拖长两种情形下「后台占比」会算歪）', !pc.includes('r.bgMs > r.ms * 0.5'));
check('A29 前台冻结识别（>250ms 且无隐藏期照常计入 + 60s 硬兜底）', pc.includes('var BG_HARD = 60000;') && pc.includes('d > BG_GAP && (wasBg || d > BG_HARD)') && pc.includes('var fz = d > BG_GAP ? 1 : 0;'));
check('A30 长任务归因 top3（第几秒·哪页·切页后/键盘期/后台期）', pc.includes('lt.top.push({ at:') && pc.includes('bgN') && pc.includes("'；最长的 ' + t3.length + ' 次：'"));
check('A31 集中页按掉帧率选 + ≥2 倍其余页 + 「分散」结论', pc.includes('pkF >= 30') && pc.includes('return (pj / pf) >= 2 * (oj / of);') && pc.includes('· 掉帧分散：最多的'));
const sent934 = (build.match(/#934[a-g] /g) || []).length;
check('A32 build.mjs 登记 #934a~g 哨兵', sent934 === 7, '实际 ' + sent934);
check('A33 流畅+冻结/长任务 → 不武断「无需处理」', pc.includes('if (_fzN > 0 || _ltN > 0) {') && pc.includes('偶发卡顿更可能来自它们'));
check('A34 长任务 top3 每次入列都按 ms 降序（恰好 3 条时「最长的」不在最前＝实测踩过）', pc.includes('lt.top.sort(function (a, b) { return b.ms - a.ms; });'));

// —— #941 追加（报告可读性三处：现场图例按需 / 与上次对比 / 长任务按页面归总）——
check('A35a 现场图例按需：先收集现场标记（fz/kb/sw）再逐段附解释', ['if (sc.fz) _mk.fz = 1;', 'if (sc.kb) _mk.kb = 1;', 'if (sc.sw) _mk.sw = 1;', "if (_mk.sw) _lg.push('「切页后」", "if (_mk.kb) _lg.push('「键盘期」", "if (_mk.fz) _lg.push('「前台冻结」"].every((s) => pc.includes(s)));
check('A35b 图例整段按需拼接（无标记时不留空括号）', pc.includes("(_lg.length ? '（' + _lg.join('；') + '）' : '')"));
check('A35c 旧无条件图例已删（回流＝现场无标记也附「切页后/前台冻结」；「键盘期」标记永远无解释）', !pc.includes("ss.join('；') + '（「切页后」") && !pc.includes('一次性渲染成本；「前台冻结」'));
check('A36a 「与上次对比」行：读上一轮摘要＋箭头对比三项格式', ['var prev = null;', "rep.prev = (prev && typeof prev === 'object') ? prev : null;", "L.push('· 与上次对比'", "'掉帧 ' + pv.janky + '→' + r.janky + ' 帧'", "'平均帧率 ' + pv.fps + '→' + r.fps + 'fps'", "'最慢 ' + (pv.worst || 0) + '→' + r.worst + 'ms'"].every((s) => pc.includes(s)));
check('A36b 读 prev 在覆盖写 LAST_KEY 之前（颠倒＝拿本轮结果跟自己对比、行恒显示零变化）', pc.indexOf('var prev = null;') > 0 && pc.indexOf('var prev = null;') < pc.indexOf('localStorage.setItem(LAST_KEY, JSON.stringify({ t: rep.t'));
check('A36c 旧格式记录不参与对比（r.prev.janky 必须是数字）', pc.includes("typeof r.prev.janky === 'number'"));
check('A37 LAST_KEY 摘要扩字段（对比数据源；老 t/verdict/jankPct 保留供设置行回显）', pc.includes('verdict: rep.verdict, jankPct: rep.jankPct') && pc.includes('ms: rep.ms, frames: rep.frames, janky: rep.janky, worst: rep.worst') && pc.includes('fz: rep.fz, fzWorst: rep.fzWorst') && pc.includes('fps: rep.fps, ltN: rep.lt ? rep.lt.n : undefined'));
check('A38 长任务按页面归总采样（仅前台任务计入 agg）', pc.includes('top: [], agg: {} }') && pc.includes('if (!ltBg) { var _ltP = curPage(), _ag = lt.agg[_ltP] || (lt.agg[_ltP] = { n: 0, ms: 0 }); _ag.n++; _ag.ms += dms; }'));
check('A39 长任务按页面归总输出行（≥2 次才出现；后台期次数单独点名）', pc.includes('var _ag = r.lt.agg || {}, _agList = [], _agN = 0;') && pc.includes('if (_agN >= 2) {') && pc.includes("'· 长任务按页面：' + _agTxt") && pc.includes("' 次发生在后台/锁屏期，未计入）'") && pc.includes('_agList.slice(0, 3)'));
const sent941 = (build.match(/#941[a-e] /g) || []).length;
check('A40 build.mjs 登记 #941a~e 哨兵', sent941 === 5, '实际 ' + sent941);

// —— #958 追加（刷新周期稳健估计：单次 4ms 抖动不再把 jankThr 压到 24ms 下限）——
check('A41 帧间隔直方图计票（≥4ms 且非冻结入账；随窗口重置）', pc.includes('var gapHist = {};') && pc.includes('if (d >= 4 && d <= BG_GAP) { var _g = Math.round(d); gapHist[_g] = (gapHist[_g] || 0) + 1; gapFrames++; periodEst(); }') && pc.includes('gapHist = {}; gapFrames = 0;'));
check('A42 周期取「重复 ≥3 的间隔」并保留样本不足回退最小值（periodEst；#1226 起取其中的众数，见 A44）', pc.includes('function periodEst() {') && pc.includes('minD = repMin || anyMin;'));
const sent958 = (build.match(/#958[a-b] /g) || []).length;
check('A43 build.mjs 登记 #958a~b 哨兵', sent958 === 2, '实际 ' + sent958);

// —— #1226 追加（尺子四处纠偏：长任务观测能力门控／周期取众数／每帧归因不再强制样式重算／冻结分型）——
check('A44 周期在「重复 ≥3」的候选里取出现次数最多的那个＝众数（旧写法取最小＝4ms 抖动重复三次就永远赢过 16ms，阈值掉到 24ms 下限、正常 60Hz 帧全被计成掉帧）', pc.includes('if (n >= 3 && (!repN || n > repN || (n === repN && v < repMin))) { repN = n; repMin = v; }'));
check('A45 长任务观测能力按 PerformanceObserver 能力表判定（旧写法拿「observe 会不会抛错」当探针＝WebKit 不抛错也不投递，lt.ok 被误置真）', pc.includes("Array.prototype.indexOf.call(PerformanceObserver.supportedEntryTypes || [], 'longtask') >= 0") && pc.includes('if (ltCap) try {') && pc.includes('rep.ltCap = ltCap;'));
check('A46 「窗口内无」只在真有通道时说（没通道照实说没通道；两种口径都走 ltNoneLine，且带冻结未被覆盖时点名前台冻结）', pc.includes('function ltNoneLine(r) {') && pc.includes('return r.ltCap ? ') && (pc.match(/L\.push\(ltNoneLine\(r\)\)/g) || []).length === 2 && pc.includes('次前台冻结未被长任务观测覆盖'));
check('A47 旧机型写死的长任务措辞已删（回流＝在安卓 Chrome 上断言「此内核不支持观测（iOS WebKit）」＝假话，且把能力问题说成机型问题）', !pc.includes('此内核不支持观测（iOS WebKit）'));
check('A48 每帧页面归因走缓存＋观察器挂在页节点本身（旧写法每帧 querySelectorAll＋getComputedStyle＝把强制样式重算塞进被测窗口；随窗拆除＝零常驻）', pc.includes('function pageCached() {') && pc.includes("pgMo.observe(pgEls[pgi], { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });") && pc.includes('var pg = pageCached();') && pc.includes('if (pgMo) pgMo.disconnect();'));
check('A48b 观察器没挂上任何页节点／不可用时退回每帧直查（不许出现「缓存永不失效」的第三种形态）', pc.includes('if (!pgMo) return curPage();') && pc.includes('if (!pgEls.length) { try { pgMo.disconnect(); } catch (e0) {} pgMo = null; }'));
check('A49 主线程探针链（setTimeout(0) 自续；排期到回执的排队时长＝「这段时间主线程忙不忙」的证据；随窗拆除）', pc.includes('function probe() {') && pc.includes('prTimer = setTimeout(probe, 0);') && pc.includes('clearTimeout(prTimer);'));
check('A50 冻结分型判据＝探针排队时长 vs 帧间隔的一半（两类处置方向相反；回前台先把 prLag 归零，别把挂起期算成占用）', pc.includes('if (prLag * 2 >= d) rep.fzJs++; else rep.fzPaint++;') && pc.includes('hiddenAt = -1; prLag = 0;'));
check('A51 报告输出「冻结类型」行并给方向（删＝iOS 报告只剩「冻结 N 次」孤数，建议把查大图与查落盘两条相反方向混成一条）', pc.includes("· 冻结类型（主线程探针实测）：主线程被任务占住 ") && pc.includes('以「出帧跟不上」为主') && pc.includes('以「主线程被占住」为主'));
check('A52 现场图例不再断言「主线程真被卡住」（分型未出前那句话是无据结论）', pc.includes('且无隐藏期（是主线程被占住还是出帧跟不上，看上面「冻结类型」那行）'));
check('A53 rep 初始化带分型与通道字段（缺字段＝旧报告/对比行读到 undefined）', pc.includes('fzJs: 0, fzPaint: 0, ltCap: false }'));
// A54＝A52 的同一条判据落到「带次数那一行」上：图例改了、正文那行照旧把原因写死在主线程一侧＝半条尺子说真话
check('A54 前台冻结正文行只报实测事实（帧间隔＋无隐藏期），谁慢了交给「冻结类型」当场实测（旧措辞在分型未出前就断言主线程被卡住＝本族只查脚本／落盘的入口）', pc.includes("· 前台冻结 ' + r.fz + ' 次（亮屏下帧间隔 >") && pc.includes('卡在哪一侧见下方「冻结类型」实测') && !pc.includes("次（亮屏下主线程被卡住 >"));

console.log('----');
console.log('verify-perf-check: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
