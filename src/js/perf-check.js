// ===== 卡顿自检·渲染层实测（#726，设置→工具「卡顿自检」行；与 #411 数据层「一键优化」互补）=====
// 用户点开始后 10 秒 rAF 帧间隔实测（可去任意页面现场复现），产出掉帧率/最慢帧/
// 掉帧集中页/键盘期占比，判级（流畅/轻度/中度/重度）并给对症建议；
// 查明本地数据过大（字卡库等，复用 storage-slim 的 mochiCcSlimScan/mochiPerfLevel 分级）
// 时在建议里指向「卡顿自检 · 一键优化」。
// #770 四处收口（红米 K80 Chrome 实报：停在设置页自检，报告却称「掉帧集中：占卜(100%)」，
// 且「结论:流畅(未捕获掉帧)」与下方「掉帧 1 帧」并存）：
// ①掉帧归因改读最上层打开的全屏页（可见 .page 里 z-index 最高、同层取 DOM 靠后；只剩
//   手机桌面时归为 main）——旧实现读 .app 桌面图标挂件，图标自身的显隐不随页面切换变化，
//   停在任何全屏页采样都会被记到「DOM 里最后一个可见图标」头上（该机恰好是占卜）＝归因恒错；
// ②「掉帧集中」改为该页掉帧率 vs 全窗口对比、且掉帧 ≥3 帧才输出（单帧噪声不做页面归因、
//   不引导用户去排查该页大图/长内容）；另报采样期间页面分布供对照；
// ③掉帧阈值自适应：取窗口内实测最小帧间隔为刷新周期（首帧是启动延迟不采、<4ms 视为同
//   vsync 补帧伪象不采），阈值＝min(max(周期×2, 24), 34)ms——60Hz≈33ms 与旧 32ms 基本一致，
//   90/120Hz 高刷屏按实测收紧不再漏计；自适应刷新率屏降到 60 帧档由 24ms 下限兜住、持续
//   幻灯片式掉帧由 34ms 上限兜住（周期被抬高一劲也不会漏判）；
// ④判「流畅」但确有零星掉帧时结论说真话（掉帧率 x% 可忽略），不再与下方「掉帧 N 帧」
//   自相矛盾；建议也只在真一帧没掉时才说「未捕获掉帧」。
// iOS Safari 无 longtask / performance.memory 观测——结论由帧间隔等效判定；长任务仅在
// 内核支持时用窗口内自建 PerformanceObserver 附带计数，不支持自动降级（不碰 device.js
// 常驻观察器）。零常驻开销：rAF 循环与观察器只在检测窗口内存在，结束即全部停止。
// #818 iOS 卡顿定位诊断增强（三样，全部仍只活在检测窗口内，窗口结束即拆干净）：
// ①点按响应延迟——窗口内 passive 按下戳记、下一帧结算「点到画面有反应」的真实等待
//   （含主线程拥堵；iOS 无 longtask 时这比掉帧率更贴近「点了隔一下才动」的体感），
//   报告中位/最慢/超 100ms 次数/最慢发生页；
// ②最慢帧现场——掉帧按「采样第几秒·所在页·键盘期·是否切页后 0.5s 内」记 top3，
//   把「卡在什么时候、哪个页、什么动作之后」说清楚，不再只有「最慢 N ms」一个孤数；
// ③低电量档识别——实测刷新周期 ≥28ms（≈30fps 档）＝整机在半帧率运行：iOS 低电量
//   模式会把帧率减半（系统行为、不是应用卡），报告点名提示关闭后复测对照，防误判。
// #934 红米 K80 Chrome 自检报告口径纠偏（用户直派 docx：300 秒窗口里「平均 24.2fps」与「正常
//   帧间隔约 16.4ms」自相矛盾——fps 分母把后台时间也算了；「掉帧集中：朋友圈（该页 0.5% vs 全窗
//   1%）」——集中页按掉帧「计数」选，选中了停留最久、掉帧率其实低于全窗的页，建议用户去查错页；
//   「后台占比过半」提示恒不触发（拿冻结段数与有效帧数比大小，量纲都不对）；而真正扎眼的「最长
//   1630ms」既无现场（第几秒/哪页），又因 >250ms 的间隙被一律当「后台冻结」剔除，亮屏下真卡住
//   1.6 秒在帧统计里完全隐身）：
//   ①fps 改按「前台有效时长」算——bgMs 由窗口内 visibilitychange 实测累计，前台＝窗口－后台，
//     报告里写明「前台约 X 秒、后台/锁屏 Y 秒已剔除」，不再拿后台时间抬高分母压低 fps；
//   ②后台/锁屏占比改按实测时长判定与展示（≥50% 点名建议亮屏重测）；
//   ③「掉帧集中」改为按「掉帧率」选页（分母 ≥30 帧才参评）且要求该页掉帧率 ≥2 倍「其余页」；
//     达标不了就给「分散在各页」的如实结论、不再引导用户去查被冤枉的那一页；全程只在一页时
//     无可对照，退化为「掉帧就在这页」（行为同旧版，B14 口径不变）；
//   ④>250ms 的帧间隔不再一律当后台：只有确有隐藏期（或超 60s 的极端兜底）才剔除；可见状态下
//     的超长阻塞＝「前台冻结」，照常计入掉帧/严重并进「最慢帧现场」（标注「前台冻结」）；
//   ⑤长任务补归因：窗口内最长的三次记「第几秒·哪页·切页后/键盘期/后台期」——1.6s 级阻塞
//     下次一跑就能看出发生在哪个页、是不是在后台期内（窗口内自带观察器，零常驻不变）；
//   ⑥结论「流畅」但窗内有前台冻结/长任务时，建议不再武断「无需处理」，改为点名冻结/长任务
//     次数与最长时长并引导按现场复测（红米报告里「属正常波动，无需处理」与「最长 1630ms」并存）。
// #958 iPhone 12 Pro / iOS Safari 自检报告「正常帧间隔约 4ms」纠偏（用户直派报告；零机型分支，
//   判据取帧间隔分布）：「正常帧间隔约 4ms」在 60Hz 屏上不可能，而它正是 jankThr 的输入——
//   jankThr = min(max(周期×2, 24), 34)ms，周期被记成 4ms 时阈值落到 24ms 下限，25~33ms 的
//   正常 60Hz 帧被算成掉帧，2.5% 的「轻度」由此偏高（同一报告又写「平均 59.2fps」，自相矛盾）。
//   根因＝周期取窗口内「单次最小帧间隔」：iOS Safari 偶发一次 4ms 的 rAF 调度抖动（同一 vsync
//   内补帧）就把周期钉死在 4ms。修法＝周期改从帧间隔直方图取「至少重复 3 次的最小取整间隔」，
//   单次/双次抖动不入账；样本太少（无间隔重复到 3 次）退回旧最小值口径。真高刷与低电量整档
//   30fps 是整窗反复出现的间隔，估计不变，不改变这两类判定。报告「正常帧间隔」随之显示真周期。
// #1226 四处「尺子自己说谎／自己添乱」的纠偏（用户直派 iPhone 16 Pro Max / iOS 18.7 卡顿自检报告：
//   「长任务（>50ms）：窗口内无」与同一份报告「前台冻结 106 次、最长 2393ms」并排；「正常帧间隔约
//   4ms」在 60Hz 屏上仍是 4ms＝#958 那条口径没修到位。零机型／零 UA 分支，判据只取内核能力表与时序）：
//   ①长任务观测能力改按 PerformanceObserver.supportedEntryTypes 判——旧写法拿「observe('longtask')
//     会不会抛错」当能力探针，实测 WebKit（iOS Safari 与本仓无头 webkit）里它既不抛错也永不投递
//     （能力表中就没有 longtask），于是 lt.ok 被置真、报告输出「窗口内无」＝一句没有任何观测支撑的
//     否定，等于替 iOS 上所有 JS 阻塞签了无罪证明。现在没通道就照实说没通道；有通道但整窗零条时也
//     点名「未被长任务覆盖的前台冻结 N 次」，两种情形都不再拿一个「无」字当结论。
//   ②#958 的周期估计由「重复 ≥3 次的最小间隔」改成「重复 ≥3 的间隔里出现次数最多的那个」＝众数：
//     真 vsync 周期是整窗反复出现的那个值（本次 1055 帧落在 16ms），而同 vsync 补帧的 4ms 抖动哪怕
//     出现二十次也只是噪声——旧规则只问「重复没重复」，4ms 一旦重复到 3 次就永远赢过 16ms，阈值落到
//     24ms 下限，25~33ms 的正常帧全被计成掉帧（本次「掉帧率 12.8%」由此虚高）。
//   ③每帧的页面归因不再现场查 DOM：旧实现每帧 querySelectorAll('.page:not([hidden])') 再对每个可见页
//     getComputedStyle(zIndex)＝把一次强制样式重算塞进被测量的窗口里（24867 节点量级的库上更贵；
//     #943e 已给 swSample 立过同款规矩）。改为把观察器挂在 .page 页节点本身（只看 hidden/class/style
//     三类属性）标脏、帧里读缓存——页真换人才重算一次，列表里的 hidden 抖动不惊动缓存；观察器随窗
//     拆除，零常驻不变；一个页节点都挂不上时退回每帧直查（不许出现「缓存永不失效」的第三种形态）。
//     长任务归因那条路（低频）照旧直查。
//   ④前台冻结补「类型」判据：rAF 迟到时回看主线程探针（setTimeout(0) 自续链，只活在窗口内）——探针
//     同样迟到＝这段时间主线程被任务占住（落盘／解码／脚本）；探针按时回执而帧仍迟到＝主线程是空的，
//     晚的是出帧（合成／栅格：大图层、blur 这类）。iOS 没有 longtask 通道，旧报告只能给「冻结 106 次」
//     一个孤数，建议把「查该页大图」和「查落盘时机」两条相反方向混成一条；现在当场分流。
// #1412 三处「长窗口档用起来会咬人」（2026-09-29 用户直派「卡屏自测也有问题」；零机型／零 UA 分支，
//   判据只取内核事实与实测时长。无头实测复现＝8 秒检测窗起窗 1.5 秒后把页面切到后台，document.hidden
//   当场读回为 true：9 秒后 running 仍是 true、报告一个数字都没出，回到前台才结算，整窗被拖成 11.3 秒，
//   且账面上 bgMs 9664 > 所选 ms 8000＝分母算错）：
//   ⑧到点结算不再只挂在 rAF 上：隐藏页 rAF 停摆＝窗口永不结束，用户按引导「去忙别的／切回来」时报告
//     时间完全不可预期（5 分钟档更糟：期间被系统回收＝整轮白测，LAST_KEY 只在 finish() 写）。加一只
//     setTimeout(ms+200) 兜底按点结掉窗口，并把时长口径从「所选档位」改成「实测 spanMs」——提前结束
//     与隐藏拖长两种情形下，effMs／fps／#975 有效性闸都跟着实测走（旧写法拿名义 ms 当分母）。
//   ⑨补 stop()／「结束并出报告」出口：旧版导出面实测只有 start/running/LAST_KEY，2 分钟与 5 分钟档
//     一旦开跑就只能干等，而隔壁电量自测、发烫自测都有这个出口＝同一站三件自测两套口径；并且测试中
//     再点那一行是 `if (running()) return`＝屏上什么也不发生，用户只能猜。
//   ⑩引导语与 #975 有效性闸不再互相打脸：弹窗写着「正常用手机…从后台切回来」，而前台不足整窗 20%
//     就判「结论不可用」＝照文案做就白测。改成「留在本站前台操作；要看『从后台切回来那一下』请在切
//     回来之后再开一轮，一进场就做那个动作」，「结论不可用」那一行也同口径给这句替代路径。
(function () {
  'use strict';
  if (window.mochiPerfCheck) return;

  var LAST_KEY = 'xy-home-v2:perf-check-last';
  var BG_GAP = 250;    // >250ms 间隙＋确有隐藏期＝切后台/锁屏冻结帧，剔除不计（#707 同款教训：后台 144s 间隙会被误判成超级卡顿）；#934 起「无隐藏期的 >250ms」＝亮屏下主线程被卡住＝前台冻结，照常计入
  var BG_HARD = 60000; // 无隐藏期的超长间隙兜底：>60s 不可能是前台阻塞（老内核不派发 visibilitychange 时仍按后台剔除，保 #707 防线）
  var MIN_JANK = 24;   // 自适应掉帧阈值下限 ms（60Hz 算出 ≈33ms≈旧 32ms；高刷屏收紧；自适应刷新率降档时靠下限不误报）
  var MAX_JANK = 34;   // 自适应掉帧阈值上限 ms（持续掉帧会把实测周期抬高，上限兜住不漏判幻灯片式卡顿）
  var SEVERE_MS = 100; // >100ms ＝ 严重卡顿
  var KB_RATIO = 0.85; // 可视高度 < 视口高度 85% ＝ 键盘弹出期（iOS 键盘期视口变形掉帧常见）
  var PAGE_CN = { main: '手机桌面', chat: '聊天', 'group-chat': '群聊', home: '桌面二页', mail: '信箱', feed: '朋友圈', calendar: '日历', memory: '纪念', divination: '占卜', note: '备忘录', p2: '功能页', music: '音乐', records: '记录', garden: '花园', room: '房间', 'drift-bottle': '漂流瓶' };
  // 全屏页 id（page-* 去前缀）→ 中文名；查不到的 id 原样显示（#770 起归因读全屏页，
  // PAGE_CN 里旧的桌面图标名映射保留兜底旧报告/旧调用方）
  var PAGE_ID_CN = { phone: '手机桌面', chat: '聊天', 'group-chat': '群聊', home: '桌面二页', mail: '信箱', 'mail-write': '写信箱', 'mail-reply': '回信箱', feed: '朋友圈', calendar: '日历', memory: '纪念', divine: '占卜', music: '音乐', stats: '统计', interact: '互动', checkin: '打卡', 'checkin-cards': '打卡字卡', garden: '花园', room: '房间', drift: '漂流瓶', period: '经期', accounting: '记账', theme: '主题', setting: '设置', storage: '查看存储', 'card-audit': '字卡自检', chatcard: '字卡库', featurehub: '功能中心', 'feature-data': '功能数据', deskcheck: '屏幕适配诊断', guide: '功能介绍', about: '关于', 'chat-settings': '聊天设置', 'reply-settings': '回复设置', 'call-settings': '通话设置', 'sfx-settings': '音效设置', 'custom-cards': '自定义字卡', 'default-cards': '默认字卡', 'dict-cards': '词典字卡', 'fun-cards': '趣味字卡', 'quote-cards': '语录字卡', 'loc-cards': '定位字卡', 'mood-cards': '心情字卡', 'reply-cards': '回复字卡', fav: '收藏', 'fav-settings': '收藏设置' };
  var _running = false;
  // #1412⑨ 「提前结束并出报告」的把手：start() 里挂上当前窗口的结算入口、finish() 里摘掉。
  // 旧版导出面只有 start/running/LAST_KEY（实测 Object.keys＝这三项），2 分钟与 5 分钟档一旦开跑
  // 就只能干等——而隔壁电量自测、发烫自测都有「结束并出报告」，卡顿自检没有＝同一站三件自测两套口径。
  var _finish = null;
  // #958：minD 语义改「反复出现的最小帧间隔」而非单次最小值——旧实现取窗口内单次最小间隔，
  // iOS Safari 偶发一次 4ms 的 rAF 调度抖动（同一 vsync 内补帧）就把周期记成 4ms、jankThr 落到
  // 24ms 下限，60Hz 屏上正常的 25~33ms 帧被误计成掉帧（报告还写「正常帧间隔约 4ms」，与同一份
  // 报告「平均 59.2fps / 60Hz 屏」自相矛盾）。gapHist 记取整间隔出现次数，只有反复出现的间隔才当周期。
  var minD = 0; // 窗口内实测刷新周期 ≈ 反复出现的最小帧间隔（模块级：jankThr 要读；_running 保证同一时间只有一个窗口在写）
  var gapHist = {}; // 帧间隔直方图（取整 ms → 出现次数）
  var gapFrames = 0; // 进直方图的样本数（周期估计的分母）

  function pageName(key) { return PAGE_ID_CN[key] || PAGE_CN[key] || key; }
  function curPage() {
    // #770：最上层打开的全屏页——可见 .page 里取 z-index 最高（同为 auto/0 时 DOM 靠后者
    // 胜出，覆盖「设置叠在桌面上」「聊天设置叠在聊天上」等叠层）；只剩手机桌面时归为 main。
    try {
      var pages = document.querySelectorAll('.page:not([hidden])');
      var best = null, bestZ = -1;
      for (var i = 0; i < pages.length; i++) {
        var z = 0;
        try { z = parseInt(getComputedStyle(pages[i]).zIndex, 10) || 0; } catch (e1) {}
        if (z >= bestZ) { bestZ = z; best = pages[i]; }
      }
      if (!best) return '?';
      var id = best.id || '';
      if (id === 'page-phone') return 'main';
      return pageName(id.replace(/^page-/, ''));
    } catch (e) { return '?'; }
  }
  function kbOn() {
    try {
      var vv = window.visualViewport;
      return !!(vv && window.innerHeight && vv.height < window.innerHeight * KB_RATIO);
    } catch (e) { return false; }
  }
  function pct(n, d) { return d > 0 ? Math.round(n / d * 1000) / 10 : 0; }
  function verdictOf(jankPct, severe) {
    if (jankPct >= 20 || severe >= 10) return '重度';
    if (jankPct >= 8) return '中度';
    if (jankPct >= 2) return '轻度';
    return '流畅';
  }
  // #934 掉帧集中判定（#770 的「≥3 帧」门槛原样保留）：除 ≥3 帧外还要求「该页掉帧率 ≥2 倍
  // 「其余页」掉帧率」——旧实现只比掉帧计数，红米报告里停留最久的页（0.5%，其实低于全窗 1%）
  // 被当成集中页、建议用户去查它的「大图/长内容」＝冤枉；其余页样本不足（<30 帧）时无从对照，
  // 按「掉帧就在这页」输出（行为同旧版）。
  function concOk(r) {
    if (r.janky < 3 || !r.topPage) return false;
    var pf = r.pageFrames[r.topPage] || 0, pj = r.pages[r.topPage] || 0;
    if (pf < 30 || pj < 3) return false;
    var of = r.frames - pf, oj = r.janky - pj;
    if (of < 30) return true;
    return (pj / pf) >= 2 * (oj / of);
  }
  function jankThr() { return Math.min(Math.max(minD * 2, MIN_JANK), MAX_JANK); } // #770：阈值随实测刷新周期自适应
  // #1226① 「长任务」这行在没有观测数据时的两种口径：旧写法不论哪种都写「窗口内无」——可 r.lt 为 null
  // 既可能是「真没有」，也可能是「这台内核压根没给 longtask 观测通道」（iOS 正是后者），后者被写成
  // 前者＝给整窗的 JS 阻塞发无罪证明；而 janky=0 那一支旧写法又把「没有观测通道」无条件扣在
  // iOS WebKit 头上（在安卓 Chrome 上同样是假话）。现在一律按能力表（rep.ltCap）分流，措辞不绑机型、不绑 UA。
  function ltNoneLine(r) {
    var cav = r.fz > 0 ? '（但窗内有 ' + r.fz + ' 次前台冻结未被长任务观测覆盖，以「前台冻结／冻结类型」两行为准）' : '';
    return r.ltCap ? '· 长任务（>50ms）：窗口内无' + cav
      : '· 长任务：这台内核没有 longtask 观测通道（按 PerformanceObserver 能力表判定，与机型无关），已改用帧间隔＋主线程探针等效判定' + cav;
  }
  // #958 刷新周期稳健估计：优先取「至少重复 3 次的最小取整间隔」＝显示屏 vsync 周期；单次/双次的
  // 调度抖动（iOS 的 4ms 补帧）不入账。真高刷（整窗 8ms）与 iOS 低电量整档 30fps（整窗 33ms）都是
  // 反复出现的间隔，估计值与旧版一致，不改变这两类判定；样本太少的窗口（没有间隔重复到 3 次）
  // 退回旧「单次最小值」口径，窗口起始几帧行为不变。
  // #1226 修正「重复 ≥3 次里取最小」这一步：真 vsync 周期不只是「重复过」，它是整窗出现次数最多的
  // 那个间隔（iPhone 16PM 那份报告里 16ms 出现上千次），而 4ms 补帧抖动重复二十次也只是噪声——旧写法
  // 只要 4ms 重复到 3 次就永远赢过 16ms，周期被记成 4ms、jankThr 落到 24ms 下限，正常的 60Hz 帧又
  // 开始被计成掉帧（#958 想治的病只治掉了「单次」那一半）。现在按众数取（次数并列时取更小者，窗口
  // 起始几帧两种读法同值）；「没有间隔重复到 3 次就回退单次最小值」保持原样。
  function periodEst() {
    var anyMin = 0, repMin = 0, repN = 0;
    for (var k in gapHist) {
      var v = +k, n = gapHist[k];
      if (!anyMin || v < anyMin) anyMin = v;
      if (n >= 3 && (!repN || n > repN || (n === repN && v < repMin))) { repN = n; repMin = v; }
    }
    minD = repMin || anyMin;
  }
  function storageAgg() {
    // 复用 #411 的扫描/分级；调用方保证在检测窗结束后才跑（大库扫描本身是已知耗时点）
    try {
      if (!window.mochiCcSlimScan || !window.mochiPerfAgg || !window.mochiPerfLevel) return null;
      var agg = window.mochiPerfAgg(window.mochiCcSlimScan());
      return (agg && agg.ok) ? agg : null;
    } catch (e) { return null; }
  }

  // start(ms, onTick) → Promise<report|null>（已在跑则 resolve(null)）
  // onTick({ left, frames, janky, hid }) 每 ~500ms 回调一次，供进度条显示
  function start(ms, onTick) {
    return new Promise(function (resolve) {
      if (_running) return resolve(null);
      _running = true;
      // #905：上限 30s→300s——时长档位放开到 5 分钟（偶发巨帧/切页类卡顿靠长窗口抓捕，
      // 10 秒档实测约 600 帧太容易整窗漏采）；下限 3s 防误触秒断，内存不随时长增长（只累加计数器）。
      ms = Math.max(3000, Math.min(300000, Number(ms) || 30000));
      onTick = typeof onTick === 'function' ? onTick : function () {};
      var rep = { t: Date.now(), ms: ms, spanMs: 0, stopped: 0, frames: 0, janky: 0, severe: 0, worst: 0, hid: 0,
                  kbFrames: 0, kbJanky: 0, pages: {}, pageFrames: {}, jankMs: 0, period: 0, fps: 0, lt: null,
                  int: null, scene: [], lp: false, bgMs: 0, effMs: 0, fz: 0, fzWorst: 0, topCnt: '',
                  fzJs: 0, fzPaint: 0, ltCap: false };
      var last = performance.now(), t0 = last, raf = 0, done = false, endTimer = 0;
      // #1412⑨ 把「立即结算」的把手交给模块级（UI 那一行的「结束并出报告」走这条路）
      _finish = function () { finish(1); };
      // #1412⑧ 到点结算不再只挂在 rAF 上：隐藏页 rAF 直接停摆，实测「8 秒窗起窗 1.5 秒后切后台，
      // 9 秒后仍在跑（running=true、报告没出）」，回到前台才结算、整窗被拖成 11.3 秒。加一只定时器
      // 兜底（隐藏页定时器被节流到秒级也照样落账），到点就结、不陪用户干等。
      try { endTimer = setTimeout(function () { finish(0); }, ms + 200); } catch (e0) {}
      // #934 后台/锁屏时长实测：fps 分母、「后台占比过半」提示、以及「>250ms 间隙算不算后台」都靠它；
      // 与 rAF/观察器同款纪律，只活在检测窗口内，窗口结束随窗拆除（零常驻）
      var bgMs = 0, hiddenAt = -1, hidPending = 0;
      function onVis() {
        var now = performance.now();
        if (document.hidden) { hiddenAt = now; hidPending = 1; }
        else if (hiddenAt >= 0) { bgMs += now - hiddenAt; hiddenAt = -1; prLag = 0; } // #1226④：挂起期定时器被系统掐到秒级，回前台第一帧别把整段挂起算成主线程占用
      }
      try { document.addEventListener('visibilitychange', onVis, { passive: true }); } catch (e) {}
      // 长任务：窗口内自建观察器（#934：除计数外记「第几秒·哪页·切页后/键盘期/后台期」top3——1.6s 级
      // 阻塞可定位来自哪一页、是不是发生在后台期内；长任务低频，push+排序开销可忽略）
      // #1226：能不能观测由内核能力表说了算，不再拿「observe 会不会抛错」当探针——WebKit（iOS Safari
      // 与本仓无头 webkit）里 observe({type:'longtask'}) 既不抛错也永不投递（能力表中没有 longtask），
      // 旧写法据此把 lt.ok 置真、报告写出「长任务：窗口内无」，而同一份报告有 106 次前台冻结、最长
      // 2393ms＝给 JS 阻塞签了张无罪证明。零机型分支：读的是能力表，不是 UA。
      var lt = { ok: false, n: 0, worst: 0, bgN: 0, top: [], agg: {} }, po = null, ltCap = false;
      try {
        ltCap = !!window.PerformanceObserver &&
          Array.prototype.indexOf.call(PerformanceObserver.supportedEntryTypes || [], 'longtask') >= 0;
      } catch (e) {}
      if (ltCap) try {
        po = new PerformanceObserver(function (list) {
          try {
            var es = list.getEntries() || [];
            for (var i = 0; i < es.length; i++) {
              if (es[i] && es[i].duration >= 50) {
                lt.n++;
                var dms = Math.round(es[i].duration);
                if (dms > lt.worst) lt.worst = dms;
                var ltBg = document.hidden ? 1 : 0;
                if (ltBg) lt.bgN++;
                // #941：前台长任务按页面归总（29 次那种窗口一眼看出哪页贡献最大；后台期任务不计入，报告里注明）
                if (!ltBg) { var _ltP = curPage(), _ag = lt.agg[_ltP] || (lt.agg[_ltP] = { n: 0, ms: 0 }); _ag.n++; _ag.ms += dms; }
                lt.top.push({ at: Math.round((es[i].startTime - t0) / 100) / 10, ms: dms, pg: curPage(), bg: ltBg, kb: kbOn() ? 1 : 0, sw: (performance.now() - swAt) <= 500 ? 1 : 0 });
                // 每次入列都按 ms 降序（旧写法只在「超过 3 条」时才排序：恰好 3 条时列表按时间序，
                // 标着「最长的 3 次」最长的却不在最前——红米窗口 29 次时看不出来，3 次就露馅）
                lt.top.sort(function (a, b) { return b.ms - a.ms; });
                if (lt.top.length > 3) lt.top.length = 3;
              }
            }
          } catch (e2) {}
        });
        po.observe({ type: 'longtask' }); lt.ok = true;
      } catch (e) {}
      // #818 窗口内采样状态：点按戳记 / 切页时刻 / 最慢帧现场 top3（窗口结束全部随窗销毁）
      var lastDown = -1, intArr = [], intWorst = -1, intWorstPg = '';
      var swAt = -1e9, lastPgSeen = '', scene = [];
      var downEv = window.PointerEvent ? 'pointerdown' : 'mousedown';
      function onDown() { lastDown = performance.now(); }
      try { document.addEventListener(downEv, onDown, { passive: true }); } catch (e) {}
      minD = 0; gapHist = {}; gapFrames = 0;
      // #1226③ 页面归因缓存：帧里不再现场查 DOM——旧写法每帧 querySelectorAll('.page:not([hidden])')
      // 再对每个可见页 getComputedStyle(zIndex)，等于把一次强制样式重算塞进被测量的窗口（库大到
      // 2.4 万节点时更明显；#943e 已为 swSample 立过同款规矩）。窗口内挂一个只看 hidden 的观察器标脏，
      // 页集合真变了才重算；随窗拆除＝零常驻不变。老内核没有 MutationObserver 时退回每帧直查。
      var pgCache = '?', pgDirty = true, pgMo = null;
      function pageCached() {
        if (!pgMo) return curPage();
        if (pgDirty) { pgCache = curPage(); pgDirty = false; }
        return pgCache;
      }
      try {
        pgMo = new MutationObserver(function () { pgDirty = true; });
        // 观察器挂在页节点本身（不跟子树）：只有「哪个 .page 可见／它的 class・style（含 z-index）
        // 变了」才打脏——列表卡片里的 hidden 抖动一律不惊动缓存。#770 的归因只取决于这两件事，
        // 而 .page 是 template.html 里的静态锚点（新页走锚点、不动态造页），所以不必跟 childList。
        var pgEls = document.querySelectorAll('.page');
        for (var pgi = 0; pgi < pgEls.length; pgi++) {
          pgMo.observe(pgEls[pgi], { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
        }
        if (!pgEls.length) { try { pgMo.disconnect(); } catch (e0) {} pgMo = null; } // 一个页节点都没有＝没东西可跟，退回每帧直查
        if (!pgEls.length) pgMo = null; // 一个页节点都没挂着＝缓存无从失效，退回每帧直查
      } catch (e) { pgMo = null; }
      // #1226④ 主线程探针：setTimeout(0) 自续链，每轮回执记下「从排期到真跑起来被排了多少 ms」。
      // rAF 迟到而探针没迟到＝那段时间主线程是空的、晚的是出帧（合成/栅格）；探针一起迟到＝主线程
      // 被任务占住（落盘/解码/脚本）。只活在窗口内（done 后不再续排），一帧一次排程、开销可忽略。
      var prArm = 0, prLag = 0, prTimer = 0;
      function probe() {
        if (done) return;
        var t = performance.now();
        prLag = t - prArm > 0 ? Math.round(t - prArm) : 0;
        prArm = t;
        prTimer = setTimeout(probe, 0);
      }
      prArm = performance.now();
      try { prTimer = setTimeout(probe, 0); } catch (e) {}
      var first = true;
      function finish(byStop) {
        if (done) return;
        done = true;
        _finish = null; // #1412⑨ 把手交回（_running 保证同一时间只有一个窗口，不会误清下一轮）
        try { if (po) po.disconnect(); } catch (e) {}
        try { if (pgMo) pgMo.disconnect(); } catch (e) {} // #1226③ 页归因观察器随窗拆除（零常驻）
        try { clearTimeout(prTimer); } catch (e) {} // #1226④ 主线程探针链随窗拆除
        try { clearTimeout(endTimer); } catch (e) {} // #1412⑧ 兜底定时器随窗拆除（零常驻）
        try { document.removeEventListener(downEv, onDown); } catch (e) {} // #818 响应监听随窗拆除
        try { document.removeEventListener('visibilitychange', onVis); } catch (e) {} // #934 可见性监听随窗拆除
        if (hiddenAt >= 0) { bgMs += performance.now() - hiddenAt; hiddenAt = -1; } // 窗口在后台里结束的尾段
        // #1412⑧⑨ 一律按「这一窗实际跑了多久」（spanMs）算账，不再拿所选档位当分母：提前结束
        // （⑨）与隐藏期把窗口拖长（⑧，实测 8 秒档拖成 11.3 秒、bgMs 9664 甚至大于所选 8000）两种
        // 情形下，旧写法的 effMs 都会算错——早先靠 #934 改成「整窗－后台」才勉强对，那是拿名义值兜的。
        rep.spanMs = Math.max(0, Math.round(performance.now() - t0));
        rep.stopped = byStop ? 1 : 0;
        rep.bgMs = Math.round(bgMs);
        rep.effMs = Math.max(0, rep.spanMs - rep.bgMs); // 前台有效时长（fps 的分母与报告展示都按它）
        rep.lt = lt.ok ? lt : null;
        rep.ltCap = ltCap; // #1226①：报告要分清「真没有长任务」与「这台内核没给观测通道」
        rep.jankMs = Math.round(jankThr());
        rep.period = Math.round(minD * 10) / 10;
        // #934 fps 分母改「前台有效时长」——原实现拿整窗（含后台/锁屏）当分母，300 秒窗口里
        // 实跑 60fps 会被写成「24.2fps」，与同一行「正常帧间隔约 16.4ms」自相矛盾
        rep.fps = rep.effMs >= 1000 ? Math.round(rep.frames * 10000 / rep.effMs) / 10 : 0;
        // #818 点按响应聚合（中位/最慢/超 100ms 次数/最慢页）＋低电量档标记（周期 ≥28ms ≈ 30fps）
        if (intArr.length) {
          var sorted = intArr.slice().sort(function (a, b) { return a - b; });
          var slowN = 0;
          for (var si = 0; si < intArr.length; si++) { if (intArr[si] >= 100) slowN++; }
          rep.int = { n: intArr.length, med: Math.round(sorted[Math.floor(sorted.length / 2)]), worst: Math.round(intWorst), slow: slowN, worstPg: intWorstPg };
        }
        rep.scene = scene;
        rep.lp = minD >= 28;
        rep.jankPct = pct(rep.janky, rep.frames);
        rep.kbPct = pct(rep.kbJanky, rep.janky);     // 掉帧里键盘期占比
        rep.kbShare = pct(rep.kbFrames, rep.frames); // 全部帧里键盘期占比
        // #934 集中页改按「掉帧率」选（旧＝按掉帧计数，选到停留最久的页）：分母 ≥30 帧（约 0.5 秒）
        // 才参评，避免小样本爆率；topCnt 留计数最多者供「分散」结论用
        var top = '', topRate = -1, cnt = '', cntN = 0, tot = 0;
        for (var k in rep.pages) {
          tot += rep.pages[k];
          if (rep.pages[k] > cntN) { cnt = k; cntN = rep.pages[k]; }
          var pkF = rep.pageFrames[k] || 0;
          if (pkF >= 30) {
            var pkR = rep.pages[k] / pkF;
            if (pkR > topRate) { topRate = pkR; top = k; }
          }
        }
        rep.topPage = tot > 0 ? (top || cnt) : '';
        rep.topCnt = cnt;
        rep.verdict = verdictOf(rep.jankPct, rep.severe);
        // 大库扫描让出几十 ms 再跑：扫描耗时不能混进检测窗最后一个样本
        setTimeout(function () {
          var agg = storageAgg();
          rep.storage = agg ? { level: window.mochiPerfLevel(agg.totalBytes, agg.bigGroups), libs: agg.libs, mb: Math.round((agg.totalBytes || 0) / 104857) / 10 } : null;
          // #941：先读上一轮摘要供报告「与上次对比」——必须在覆盖写 LAST_KEY 之前读；旧格式记录（无 janky 数）不参与对比
          var prev = null;
          try { prev = JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch (e3) {}
          rep.prev = (prev && typeof prev === 'object') ? prev : null;
          rep.text = buildText(rep);
          try { localStorage.setItem(LAST_KEY, JSON.stringify({ t: rep.t, verdict: rep.verdict, jankPct: rep.jankPct, ms: rep.ms, frames: rep.frames, janky: rep.janky, worst: rep.worst, fz: rep.fz, fzWorst: rep.fzWorst, fps: rep.fps, ltN: rep.lt ? rep.lt.n : undefined, ltWorst: rep.lt ? rep.lt.worst : undefined })); } catch (e2) {}
          _running = false;
          resolve(rep);
        }, 50);
      }
      function frame(now) {
        if (done) return;
        var d = now - last, prevLast = last; last = now;
        var wasBg = hidPending; hidPending = 0; // #934：自上一帧以来是否真发生过隐藏（visibilitychange 实报）
        if (document.hidden) {
          rep.hid++; // 帧回调落到隐藏期（兜底），不计入样本
        } else if (d > BG_GAP && (wasBg || d > BG_HARD)) {
          rep.hid++; // 后台/锁屏冻结段剔除：隐藏时长已由 visibilitychange 计入 bgMs，不重复累计
        } else {
          rep.frames++;
          var pg = pageCached(); // #1226③：读缓存的页归因（旧写法每帧直查 DOM＋强制样式重算）
          rep.curPg = pg; // #906：当前所在页（进度浮条实时显示，让用户知道采样在跟着走）
          rep.pageFrames[pg] = (rep.pageFrames[pg] || 0) + 1;
          if (pg !== lastPgSeen) { lastPgSeen = pg; swAt = now; } // #818 切页时刻（最慢帧现场归因用）
          if (lastDown >= 0) { // #818 点按→下一帧结算响应延迟（含主线程拥堵；≥2s 视为切后台噪声丢弃）
            var lat = now - lastDown; lastDown = -1;
            if (lat >= 0 && lat < 2000) {
              intArr.push(lat);
              if (lat > intWorst) { intWorst = lat; intWorstPg = pg; }
            }
          }
          if (first) { first = false; } // 首帧间隔是启动延迟，只计样本、不进周期/掉帧判定
          else {
            // #958：只把「≥4ms 且非冻结」的间隔计入周期直方图（<4ms＝同 vsync 补帧伪象仍不入账），
            // 周期估计由 periodEst 取「反复出现的间隔」＝单次 4ms 抖动不再把阈值压到 24ms 下限
            if (d >= 4 && d <= BG_GAP) { var _g = Math.round(d); gapHist[_g] = (gapHist[_g] || 0) + 1; gapFrames++; periodEst(); }
            var kb = kbOn();
            if (kb) rep.kbFrames++;
            if (d > jankThr()) {
              // #934：>250ms 且无隐藏期＝亮屏下主线程被卡住＝前台冻结，照常计入掉帧/严重并单独点名
              // （旧实现把这类整段当「后台冻结」剔除＝1.6s 级阻塞在报告里完全隐身）
              var fz = d > BG_GAP ? 1 : 0;
              if (fz) {
                rep.fz++; if (d > rep.fzWorst) rep.fzWorst = Math.round(d);
                // #1226④ 冻结类型分流：探针回执覆盖的正是「上一帧结束→这一帧开始」这段——它跟着迟到
                // ＝主线程被任务占住；它按时回执而帧仍迟到＝主线程当时是空的，晚的是出帧（合成/栅格）。
                // 两类给的是相反方向的处置（查落盘/解码 vs 查大图/模糊层），旧报告只有一条「冻结 N 次」
                // 孤数，建议只能把两条路混在一起写。
                if (prLag * 2 >= d) rep.fzJs++; else rep.fzPaint++;
                // #907 冻结归因：回查冻结起点（wall 时钟≈现在−d）之前最近一条相位标记——
                // 「冻结前最后在做什么」直接点名（大键写 IDB／小键写日志／聊天落盘／表情包落盘…）
                try {
                  var _pl = window.__mochiPhaseLog || [], _hit = '(无标记)', _dl = -1;
                  var _startWall = Date.now() - Math.round(d);
                  for (var _pi = _pl.length - 1; _pi >= 0; _pi--) {
                    if (_pl[_pi].t <= _startWall) { _hit = _pl[_pi].tag; _dl = _startWall - _pl[_pi].t; break; }
                  }
                  if (!rep.fzBy) rep.fzBy = {};
                  rep.fzBy[_hit] = (rep.fzBy[_hit] || 0) + 1;
                  // #960 续：记「标记距冻结起点的时间差」——高频标记（如保活 5s 拍）天然最常出现在
                  // 冻结前；只有差值接近 0（冻结紧跟该标记后）才是因果证据，差几秒只是恰好排在前面。
                  if (_dl >= 0) { if (!rep.fzD) rep.fzD = {}; (rep.fzD[_hit] = rep.fzD[_hit] || []).push(_dl); if (rep.fzD[_hit].length > 60) rep.fzD[_hit].shift(); }
                } catch (e7) {}
              }
              rep.janky++;
              if (kb) rep.kbJanky++;
              if (d > SEVERE_MS) rep.severe++;
              if (d > rep.worst) rep.worst = Math.round(d);
              rep.pages[pg] = (rep.pages[pg] || 0) + 1;
              // #818 最慢帧现场 top3（掉帧本就低频，push+排序开销可忽略）；#934 同「长任务」口径
              // 每次入列都按 ms 降序（旧写法恰好 3 帧时按时间序，「最慢帧」最慢的不在最前）
              scene.push({ at: Math.round((now - t0) / 100) / 10, ms: Math.round(d), pg: pg, kb: kb ? 1 : 0, sw: (now - swAt) <= 500 ? 1 : 0, fz: fz });
              scene.sort(function (a, b) { return b.ms - a.ms; });
              if (scene.length > 3) scene.length = 3;
            }
          }
        }
        if (now - t0 >= ms) return finish();
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
      var tick = setInterval(function () {
        if (done) { clearInterval(tick); return; }
        // #906：pg＝当前所在页（浮条实时显示）；hidRatio 由调用方算（后台占比过高时提示「不算数」）
        onTick({ left: Math.max(0, Math.ceil((ms - (performance.now() - t0)) / 1000)), frames: rep.frames, janky: rep.janky, hid: rep.hid, pg: pageName(rep.curPg || '?') });
      }, 500);
    });
  }

  function buildText(r) {
    var L = [];
    // #770：结论说真话——「未捕获掉帧」只在真一帧没掉时说
    var concl;
    if (r.verdict === '流畅') concl = r.janky > 0 ? '（掉帧率 ' + r.jankPct + '%，可忽略）' : '（本窗口未捕获掉帧）';
    else concl = '（掉帧率 ' + r.jankPct + '%）';
    L.push('结论：' + r.verdict + concl);
    var per = r.period > 0 ? '，正常帧间隔约 ' + r.period + 'ms' : '';
    // #934 采样行写明前台时长与后台时长：fps 是前台均速（旧版拿整窗当分母，与「正常帧间隔」自相矛盾）
    var eff = r.effMs == null ? r.ms : r.effMs;
    var core = eff >= 1000 ? '平均 ' + r.fps + 'fps' + per : '前台时间不足 1 秒，未计 fps';
    // #1412⑧⑨ 「采样 N 秒」这一行以前报的是所选档位，不是实际跑到的时长：提前结束（⑨）时报
    // 「采样 120 秒」而实际只测了 30 秒＝假账面；隐藏期把窗口拖长（⑧）时又只报 8 秒、少报 3.3 秒。
    var _span = r.spanMs || r.ms;
    var _spanTxt = '采样 ' + Math.round(_span / 1000) + ' 秒';
    if (r.stopped) _spanTxt += '（提前结束，所选 ' + Math.round(r.ms / 1000) + ' 秒档，下面所有数字只按已测到的这段算）';
    else if (Math.abs(_span - r.ms) > 3000) _spanTxt += '（所选 ' + Math.round(r.ms / 1000) + ' 秒档，实跑这么多；差值＝页面不可见／出帧迟到）';
    L.push(_spanTxt + ' / 有效帧 ' + r.frames + '（' + core + '；前台约 ' + Math.round(eff / 1000) + ' 秒，后台/锁屏 ' + Math.round((r.bgMs || 0) / 1000) + ' 秒已剔除）');
    if (r.lp) L.push('· 实测刷新周期约 ' + r.period + 'ms（≈30fps 档）：iOS 低电量模式会把帧率减半，属系统行为——开了低电量请关闭后复测对照');
    // #941：与上次对比——配合报告弹窗「再测一次」看前后变化（关保活/清缓存前后各一轮）；旧格式记录不显示
    if (r.prev && typeof r.prev.janky === 'number') {
      var pv = r.prev, _meta = [], _cp = ['掉帧 ' + pv.janky + '→' + r.janky + ' 帧'];
      if (typeof pv.t === 'number' && pv.t > 0) {
        var _dg = Date.now() - pv.t;
        _meta.push(_dg < 60000 ? '刚刚' : _dg < 3600000 ? '约 ' + Math.round(_dg / 60000) + ' 分钟前' : _dg < 172800000 ? '约 ' + Math.round(_dg / 3600000) + ' 小时前' : Math.round(_dg / 86400000) + ' 天前');
      }
      if (typeof pv.ms === 'number' && pv.ms !== r.ms) _meta.push('上次为 ' + Math.round(pv.ms / 1000) + ' 秒档，时长不同仅供粗略对照');
      if (typeof pv.fps === 'number' && pv.fps > 0 && r.fps > 0) _cp.push('平均帧率 ' + pv.fps + '→' + r.fps + 'fps');
      if (pv.worst > 0 || r.worst > 0) _cp.push('最慢 ' + (pv.worst || 0) + '→' + r.worst + 'ms');
      if ((pv.fz || 0) > 0 || r.fz > 0) _cp.push('前台冻结 ' + (pv.fz || 0) + '→' + r.fz + ' 次');
      if (typeof pv.ltN === 'number' && r.lt) _cp.push('长任务 ' + pv.ltN + '→' + r.lt.n + ' 次');
      L.push('· 与上次对比' + (_meta.length ? '（' + _meta.join('；') + '）' : '') + '：' + _cp.join('、'));
    }
    // #770：采样期间页面分布——帮读「掉帧集中」（该页采了多少帧才有可比性）
    var majors = [];
    for (var pk in r.pageFrames) { if (pk !== '?' && r.pageFrames[pk] > 0) majors.push([pk, r.pageFrames[pk]]); }
    majors.sort(function (a, b) { return b[1] - a[1]; });
    var mtxt = majors.slice(0, 2).map(function (m) { return pageName(m[0]) + ' ' + pct(m[1], r.frames) + '%'; }).join('、');
    if (mtxt) L.push('· 采样期间主要在：' + mtxt);
    if (r.frames < 120) L.push('· 有效样本偏少（可能大部分时间在后台），建议亮屏状态下重测');
    // #906：后台/锁屏占比过高时点名——剔除机制保证判定不受污染，但占比太高＝测的不是刚才的卡
    // #934：占比改按「实测时长」算（原＝冻结段数与有效帧数比大小，量纲不同＝恒不触发）
    // #975：窗口有效性判定——前台有效时间太少（整段被系统挂起/杀掉）时结论不可用，
    // 不能给「中度 x%」这类会误导的判定（真机实测：60s 窗口前台不足 1 秒、最慢一帧 20118ms＝被回收）
    var _fgMs = Math.max(0, (_span || r.ms || 0) - (r.bgMs || 0));
    if ((_span || r.ms) > 0 && _fgMs < (_span || r.ms) * 0.2) L.push('· ⚠ 本次窗口前台有效时间仅 ' + Math.round(_fgMs / 1000) + ' 秒（其余在后台/被系统挂起），**结论不可用**——请保持亮屏、留在本站里操作时重测；想测「从后台切回来那一下」，请在切回来之后再开一轮，一进场就做那个动作');
    if (r.frames > 0 && r.bgMs > _span * 0.5) L.push('· 采样期间约 ' + Math.min(100, pct(r.bgMs, _span)) + '% 时间在后台/锁屏（已剔除、不影响判定）；想测刚才的卡，建议亮屏状态下重测');
    // #961：系统回收（内存压力＝白屏/重载实锤）——与是否掉帧无关，独立成行
    try {
      var _kp3 = (typeof window.__kaProbe === 'function') ? window.__kaProbe() : null;
      var _diedN = (_kp3 && _kp3.ev) ? (_kp3.ev.died || 0) : 0;
      if (_diedN >= 3) L.push('· 本页已被系统回收过 ' + _diedN + ' 次（手机内存不够时 iOS 会直接关掉页面，切回来白屏/重载就是它、不是网站坏了、不丢数据）：先做两件事——①设置→系统 关掉「后台保活」②设置→工具→「查看存储」清掉最占地方的一项（表情包大图/旧聊天记录，删前先导出备份）');
    } catch (e6) {}
    if (r.janky > 0) {
      L.push('· 掉帧 ' + r.janky + ' 帧（间隔>' + r.jankMs + 'ms），其中严重 ' + r.severe + ' 帧（>100ms），最慢一帧 ' + r.worst + 'ms');
      // #934：亮屏下的超长阻塞单独点名（旧版把这它当后台冻结剔除，报告里连数字都看不到）
      // #1226h：这一行只报「帧断了」这一个可观测事实，谁慢了交给下方「冻结类型」当场实测——旧措辞在
      // 分型出来之前就把原因写死在主线程那一侧（＝无据结论），而它正是本族一路只查脚本与落盘的入口
      if (r.fz > 0) L.push('· 前台冻结 ' + r.fz + ' 次（亮屏下帧间隔 >' + BG_GAP + 'ms 且无隐藏期，最长 ' + r.fzWorst + 'ms）——卡在哪一侧见下方「冻结类型」实测，现场见下方「最慢帧现场」的前台冻结标记');
      // #1226④ 冻结类型分流（探针实测）：两类卡处置方向相反，混着说等于没说
      if (r.fz > 0 && (r.fzJs || r.fzPaint)) {
        L.push('· 冻结类型（主线程探针实测）：主线程被任务占住 ' + (r.fzJs || 0) + ' 次、主线程空闲而出帧跟不上 ' + (r.fzPaint || 0) + ' 次'
          + (r.fzPaint > r.fzJs ? '——以「出帧跟不上」为主：卡的是画不出来（该页的大图层/模糊壁纸/超长列表图片解码），不是脚本跑不完；对着「掉帧集中」那页查图与 blur，落盘那条先放一放'
                                : '——以「主线程被占住」为主：卡的是任务本身（大键落盘/图片解码/整页重渲），对着上面「冻结前序操作」那行找真凶'));
      }
      // #907 冻结归因汇总：冻结前序操作分布（#1226① 实测确认：iOS 这类内核压根没有 longtask 通道，
      // 这行就是唯一能指出「谁在堵主线程」的取证；#1226④ 的冻结类型先分流「是不是主线程」，再看这里）
      if (r.fzBy) {
        var _fk = Object.keys(r.fzBy).sort(function (a, b) { return r.fzBy[b] - r.fzBy[a]; }).slice(0, 4);
        if (_fk.length && r.fzBy[_fk[0]] > 0) {
          L.push('· 冻结前序操作（取证）：' + _fk.map(function (k) {
            var ds = (r.fzD && r.fzD[k]) || [];
            var med = '';
            if (ds.length) {
              var sd = ds.slice().sort(function (a, b) { return a - b; });
              med = '（距冻结起点中位 ' + sd[Math.floor(sd.length / 2)] + 'ms' + (sd[Math.floor(sd.length / 2)] <= 150 ? '·紧邻＝高危' : '·较远＝仅是最后一条标记') + '）';
            }
            return k + ' ×' + r.fzBy[k] + med;
          }).join('、'));
          L.push('  （判读：中位差值 ≤150ms 才说明冻结紧跟该操作＝真凶；差几秒的只是高频标记恰好排在最后）');
        }
      }
      if (concOk(r)) {
        var _of = r.frames - (r.pageFrames[r.topPage] || 0), _oj = r.janky - (r.pages[r.topPage] || 0);
        L.push('· 掉帧集中：' + pageName(r.topPage) + '（掉帧 ' + r.pages[r.topPage] + '/' + (r.pageFrames[r.topPage] || 0) + ' 帧，该页 ' + pct(r.pages[r.topPage], r.pageFrames[r.topPage]) + '% ' + (_of >= 30 ? 'vs 其余页 ' + pct(_oj, _of) + '%' : '，本窗口其余页样本不足）'));
      } else if (r.topCnt) {
        // #934：没有哪一页的掉帧率明显高于其余页——如实说「分散」，不再把停留最久的页当集中页
        // （红米报告原文：「掉帧集中：朋友圈（该页 0.5% vs 全窗 1%）」＋建议去查朋友圈的大图）
        L.push('· 掉帧分散：最多的 ' + pageName(r.topCnt) + ' 也才 ' + r.pages[r.topCnt] + '/' + (r.pageFrames[r.topCnt] || 0) + ' 帧（' + pct(r.pages[r.topCnt], r.pageFrames[r.topCnt]) + '%），没有哪一页明显高于其余页——不是某一页特有的问题，重点看长任务与下方建议');
      }
      // #906：保活开着时点名——页面常驻后台跑＝更耗电发热、掉帧更明显，是「越用越卡」惯犯之一
      try {
        var ka = (typeof window.__kaProbe === 'function') ? window.__kaProbe() : null;
        if (ka && ka.keep) L.push('· 「后台保活」开着：页面会在后台一直跑，更耗电、发热、掉帧更明显——不用时到 设置→系统 关掉再对照测一轮');

      } catch (e4) {}
      if (r.kbJanky > 0) L.push('· 其中键盘弹出期 ' + r.kbJanky + ' 帧（键盘期视口变形 iOS 上常见；收起键盘对照可分辨）');
      if (r.scene && r.scene.length) {
        var ss = [], _mk = {};
        for (var i2 = 0; i2 < r.scene.length; i2++) {
          var sc = r.scene[i2];
          if (sc.fz) _mk.fz = 1;
          if (sc.kb) _mk.kb = 1;
          if (sc.sw) _mk.sw = 1;
          ss.push('第' + sc.at + '秒 ' + pageName(sc.pg) + ' ' + sc.ms + 'ms' + (sc.fz ? '·前台冻结' : '') + (sc.kb ? '·键盘期' : '') + (sc.sw ? '·切页后' : ''));
        }
        // #941：图例只解释本报告现场里真出现过的标记——旧版无条件附「切页后/前台冻结」两段解释，
        // 现场没这些标记时纯占地方；且现场会出现「键盘期」标记却没有对应解释（本批一并补上）
        var _lg = [];
        if (_mk.sw) _lg.push('「切页后」＝紧跟页面切换 0.5s 内，多为打开该页的一次性渲染成本');
        if (_mk.kb) _lg.push('「键盘期」＝键盘弹出期（视口被压缩的变形帧，iOS 上常见）');
        if (_mk.fz) _lg.push('「前台冻结」＝亮屏下帧间隔 >' + BG_GAP + 'ms 且无隐藏期（是主线程被占住还是出帧跟不上，看上面「冻结类型」那行）');
        L.push('· 最慢帧现场：' + ss.join('；') + (_lg.length ? '（' + _lg.join('；') + '）' : ''));
      }
    }
    if (r.lt) {
      if (r.lt.n > 0) {
        // #934：长任务补归因——最长的三次给「第几秒·哪页·切页后/键盘期/后台期」，1.6s 级阻塞
        // 一跑就能看出发生在哪个页、是不是在后台期内（旧版只有「N 次、最长 Xms」两个孤数）
        var ltTxt = '· 长任务（>50ms 主线程阻塞）窗口内 ' + r.lt.n + ' 次' + (r.lt.bgN ? '（其中 ' + r.lt.bgN + ' 次在后台/锁屏期）' : '') + '，最长 ' + r.lt.worst + 'ms';
        if (r.lt.top && r.lt.top.length) {
          var t3 = [];
          for (var i3 = 0; i3 < r.lt.top.length; i3++) {
            var e3 = r.lt.top[i3];
            t3.push('第' + e3.at + '秒 ' + pageName(e3.pg) + ' ' + e3.ms + 'ms' + (e3.bg ? '·后台期' : '') + (e3.sw ? '·切页后' : '') + (e3.kb ? '·键盘期' : ''));
          }
          ltTxt += '；最长的 ' + t3.length + ' 次：' + t3.join('；');
        }
        L.push(ltTxt);
        // #941：前台长任务按页面归总——原来 top3 只有 3 条现场，「29 次」这种窗口看不出集中在哪页
        var _ag = r.lt.agg || {}, _agList = [], _agN = 0;
        for (var _ap in _ag) { if (_ag[_ap].n > 0) { _agList.push([pageName(_ap), _ag[_ap].n, _ag[_ap].ms]); _agN += _ag[_ap].n; } }
        if (_agN >= 2) {
          _agList.sort(function (a, b) { return b[2] - a[2]; });
          var _agTxt = _agList.slice(0, 3).map(function (x) { return x[0] + ' ' + x[1] + ' 次共 ' + x[2] + 'ms'; }).join('、');
          if (_agList.length > 3) _agTxt += ' 等 ' + _agList.length + ' 页';
          L.push('· 长任务按页面：' + _agTxt + (r.lt.bgN ? '（前台任务归总；另有 ' + r.lt.bgN + ' 次发生在后台/锁屏期，未计入）' : ''));
        }
      } else {
        L.push(ltNoneLine(r)); // #1226①
      }
    } else {
      L.push(ltNoneLine(r)); // #1226①：没掉帧也不等于「内核不支持观测」，两种口径分开说
    }
    if (r.int) {
      L.push('· 点按响应：采样 ' + r.int.n + ' 次，中位 ' + r.int.med + 'ms、最慢 ' + r.int.worst + 'ms（最慢在' + pageName(r.int.worstPg) + '）' + (r.int.slow > 0 ? '；' + r.int.slow + ' 次超过 100ms＝「点了隔一下才动」体感的直接来源' : ''));
    }
    if (r.storage) {
      L.push('· 本地数据画像：字卡库 ' + r.storage.libs + ' 个作用域 约 ' + r.storage.mb + ' MB（' + (r.storage.level === '重' ? '较重' : r.storage.level === '中' ? '中度' : '轻量') + '）');
    }
    L.push('');
    // #1295：iPhone 11 实报「桌面卡」（翻页平均 114ms／切回桌面 236ms），旧报告只能说
    // 「掉帧集中在手机桌面」，说不出桌面现场里哪一档在吃合成开销——大壁纸纹理重解码、
    // 模糊烘焙失败退回整层 CSS 滤镜、标签栏毛玻璃都是本机实测存在的开销档。出报告这一
    // 刻把现场读出来并逐项给可对照的 A/B 建议（零机型分支：判据全是计算样式/类名事实）。
    var _ds = null;
    try { if (window.__mochiDeskScene) _ds = window.__mochiDeskScene(); } catch (e) {}
    if (_ds && _ds.txt !== '读数失败') L.push('· 桌面现场（出报告这一刻）：' + _ds.txt);
    L.push('建议：');
    var adv = [];
    if (r.storage && r.storage.level === '重') adv.push('本地数据过大（字卡库等）是本应用最常见的间歇卡顿主因——先做旁边「卡顿自检 · 一键优化」（不删数据）');
    if (r.janky === 0) adv.push('本窗口未捕获掉帧；若体感仍卡，在卡顿出现的当下立即复测，更容易抓到现场');
    else if (r.verdict === '流畅') {
      // #934：窗内有前台冻结/长任务时不再武断「无需处理」——红米报告正是「属正常波动，无需处理」
      // 与「长任务 29 次、最长 1630ms」「严重 4 帧」并存，用户拿着报告不知道要不要管
      var _fzN = r.fz || 0, _ltN = (r.lt && r.lt.n) || 0;
      if (_fzN > 0 || _ltN > 0) {
        var _w = [];
        if (_fzN > 0) _w.push('前台冻结 ' + _fzN + ' 次（最长 ' + r.fzWorst + 'ms）');
        if (_ltN > 0) _w.push('长任务 ' + _ltN + ' 次（最长 ' + r.lt.worst + 'ms）');
        adv.push('掉帧本身零星（' + r.janky + ' 帧、最慢 ' + r.worst + 'ms），但窗口内有' + _w.join('、') + '——偶发卡顿更可能来自它们，按上面的现场与归因复测一轮');
      } else adv.push('仅零星掉帧（' + r.janky + ' 帧、最慢 ' + r.worst + 'ms），属正常波动，无需处理');
    }
    if (concOk(r)) adv.push('掉帧集中在「' + pageName(r.topPage) + '」——该页操作时最明显，可对照排查最近往该页存过的大图/长内容');
    if (r.int && r.int.slow > 0) adv.push('点按响应最慢 ' + r.int.worst + 'ms（在「' + pageName(r.int.worstPg) + '」）：掉帧集中在操作瞬间，优先排查该页的大图/长列表/数据落盘时机');
    if (r.lp && r.verdict === '流畅') adv.push('本机在约 30fps 档运行＝iOS 低电量模式减半帧率（系统行为），关闭低电量模式即可恢复，无需其他处理');
    if (r.kbJanky > 0 && r.kbPct >= 30) adv.push('掉帧多发生在键盘弹出期（iOS 视口变形属系统行为）：收起键盘复测对照，若明显好转则无需处理');
    if (r.janky > 0 && _ds) {
      if (_ds.blurCss) adv.push('背景模糊正走「整层 CSS 滤镜」兜底档（小纹理烘焙失败，毛玻璃每帧都在重新合成）——去美化里关掉「背景模糊」或重选一次壁纸让它重烘，复测对照');
      if (_ds.texKB >= 3072) adv.push('桌面壁纸纹理约 ' + (_ds.texKB / 1024).toFixed(1) + 'MB（每次换壁纸/重烘都要主线程重解码一遍）——换小图或把「放大」退回 100% 复测对照');
      if (_ds.zoom > 1.02) adv.push('壁纸「放大」在 ×' + _ds.zoom + ' 档（外扩图层盒让纹理栅格化面积按比例变大）——退回 100% 复测对照');
      if (_ds.tabBlur) adv.push('标签栏毛玻璃开着：关掉复测可分辨「屏幕底部常驻合成开销」是否来自它');
    }
    if (r.verdict !== '流畅' && (!r.storage || r.storage.level !== '重')) adv.push('可按 设置→「手机卡顿说明」的顺序清一遍存量（先「查看存储」看哪项最大）；别用「清除本地数据」治卡顿');
    if (!adv.length) adv.push('保持现状即可');
    adv.forEach(function (a, i) { L.push((i + 1) + '. ' + a); });
    L.push('');
    L.push('（采样只在本机进行、不上传任何数据；掉帧＝帧间隔>' + r.jankMs + 'ms ≈ 2 倍实测刷新周期，后台/锁屏冻结帧已剔除）');
    return L.join('\n');
  }

  window.mochiPerfCheck = {
    start: start,
    // #1412⑨ 提前结束并出报告：立刻结算已测到的部分（时长口径按实测 spanMs 走，报告里标明提前结束）。
    // 没在跑时返回 false，调用方据此什么都不做。
    stop: function () { if (_finish) { _finish(); return true; } return false; },
    running: function () { return _running; },
    LAST_KEY: LAST_KEY
  };
})();
