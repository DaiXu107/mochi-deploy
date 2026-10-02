// ===== 功能：桌面左右滑动翻页（scroll-snap 原生滚动） =====
// 支持触摸/鼠标横向拖动（原生滚动），指示器圆点点击切换
// v3.6.x：支持动态页数——新增/删除桌面页后由 personalize.js 调用 deskRebuild()
// 重建圆点与索引，无需刷新页面
// v3.27.x（#580）：圆点改为「滚动中每帧跟随」。用户反馈「切换 1/2/3 桌面页时，
// 底部导航圆点反应慢，没有与滑动完全同步」——原实现在 scroll 里
// clearTimeout + setTimeout(sync, 120)，每次滚动事件都把同步推迟到 120ms 后，
// 滚动全程圆点被冻结、松手吸附结束后才跳一次（实测滞后 127ms），再加上圆点
// 变形动画 250ms，合计约 0.4s 的滞后感。
// ⚠️ 性能红线（用户要求：安卓 / iOS 都不能卡）——本文件从此跑在滚动的每一帧上：
//   ① rAF 节流：一帧最多算一次，索引没变不碰 DOM；
//   ② 每帧零 DOM 查询、零样式读取——页步长(gap) 与圆点数组缓存，圆点在增删页时重算
//      （refreshCache）、gap 只在增删页/resize 这类真会改它的地方作废（#1301），每帧只剩
//      scrollLeft / clientWidth 两个布局读 + 一次取整；
//   ③ 不引入 smooth 滚动、不读写会触发布局的样式属性，只切 class。
(function () {
  const pages = document.getElementById('desktop-pages');
  if (!pages) return;

  // 动态查询（新增/删除页后结构变化，不能缓存 NodeList）
  function getSlides() { return Array.prototype.slice.call(pages.querySelectorAll('.page-slide')); }
  function getDots() { return Array.prototype.slice.call(document.querySelectorAll('#desktop-dots .dot')); }

  let idx = 0;

  // ===== #1466 桌面页码持久化（「滑到别的页过一会儿弹回首页」主根因收口）=====
  // 报障机（iPhone 15 Pro Max／iOS 18.7 Safari，诊断单 mochi-diag-2026-09-29-13-56）本页被
  // 系统回收 116 次：回收一次＝整页重载，而桌面翻到第几页从来没被记住 ⇒ 每次重开都落回
  // 第 1 页＝用户口径「手已经滑到别的页面，过了一会又弹回前面的首页了」（多机型同现＝各家的
  // 回收频率不同而已）。收口＝翻页落定即把页码写进当前桌面命名空间键（<prefix>:desk-page-idx），
  // 建桌面时恢复（钳到实际页数；「正在翻页」的 1.2s 内不拽人——只认 touchstart/圆点跳页这类
  // 真实用户动作记账，程序化定位写入不记账＝开机建桌面的多次重建互相不干扰）。零机型／零 UA。
  let lastUserSwipeTs = 0;   // 最近一次真实用户翻页动作（touchstart/圆点跳页）
  let swipeWarmTimer = null; // #1466：滑动期临时提层的收尾计时
  function deskIdxKey() {
    try {
      const p = (typeof window.activePrefix === 'function') ? window.activePrefix() : '';
      return p ? (p + ':desk-page-idx') : '';
    } catch (e) { return ''; }
  }
  function deskIdxSave() {
    try { const k = deskIdxKey(); if (k) localStorage.setItem(k, String(idx)); } catch (e) {}
  }
  function deskIdxSaved() {
    try {
      const k = deskIdxKey(); if (!k) return 0;
      const v = parseInt(localStorage.getItem(k), 10);
      return isNaN(v) ? 0 : v;
    } catch (e) { return 0; }
  }
  // #1466：滑动期临时提层——#754 只给开了「整页背景」的桌面提层（.has-page-bg），其余桌面
  // 三张 .page-slide 都不是独立合成层，翻页时新页瓦片要现场栅格化＝滑动半路只画出一半
  //（同机诊断「切回桌面 平均297ms/最慢5539ms」，与 #754 报障机同型号；用户口径「别的页面
  // 屏幕只显示一半」）。收口＝起手（touchstart）到落定后 150ms 给容器挂 .swipe-warm 提层
  //（home.css），同 #976 运动期摘模糊的瞬态口径：只有手势窗口里有这三张层的显存开销
  //（#1225 反对的「常驻」一字不沾），停下即还。
  function swipeWarm() {
    try {
      if (!pages.classList.contains('swipe-warm')) pages.classList.add('swipe-warm');
      clearTimeout(swipeWarmTimer);
      swipeWarmTimer = setTimeout(function () { pages.classList.remove('swipe-warm'); }, 150);
    } catch (e) {}
  }

  // v3.27.x（#580）：每帧跟随用的缓存——防卡顿的关键。
  // 跟随改为每帧执行后，若每帧都 querySelectorAll + getComputedStyle，等于把滚动帧
  // 的预算花在查询上（安卓低端机必掉帧）。两者只在「增/删页」「resize」时失效重算。
  let dotsCache = [];
  let gapCache = null;

  // #1301：refreshCache 只换圆点数组，不再顺手作废 gap 缓存。
  // 旧写法每次「点圆点 / resize / 切回桌面 / 重建桌面」都调 refreshCache，而它把
  // gapCache 一起清空 ⇒ 下一次 pageStep() 必做一次 getComputedStyle(#desktop-pages)。
  // 在切回桌面那条路径上（page-phone 的 hidden 翻回 false 那一帧）这次样式读取是
  // 在 display:none→block 之后立刻发生的＝样式树还是脏的，等于把一次强制样式重算
  // 塞进用户报「切页面最卡」的那一帧。gap 来自 .desktop-pages 的 CSS 常量
  // （var(--desk-page-gap, 8px)，全仓无任何运行时改写），它只可能随视口媒体查询或
  // 重建桌面而变——作废点因此挪到那两处（见 resize 处理器与 deskRebuild）。
  function refreshCache() {
    dotsCache = getDots();
  }

  // v3.6.x：页间有 gap 缝隙，每页滚动步长 = clientWidth + gap
  // gap 是 CSS 固定值（.desktop-pages 的 flex gap），不随布局变化，但元素
  // display:none 时 getComputedStyle 仍返回 CSS 值，可安全读取
  function pageStep() {
    if (gapCache === null) gapCache = parseFloat(getComputedStyle(pages).columnGap) || 0;
    return pages.clientWidth + gapCache;
  }

  // #1301：把「按当前 idx 落位」收成一个函数，且**只在确实不在位时**写 scrollLeft。
  // 旧写法在四个位置无条件写，其中最热的是「切回桌面」那一帧（page-phone 的 hidden 翻回
  // false）：刚 display:none→block 就赋值滚动位置，在 WebKit 上等于把一次同步布局＋一次
  // 滚动位置突变压进用户正看着的那一帧，而绝大多数情况下位置本来就已经是对的（用户只是
  // 去聊天看了一眼回来）。真正需要重设的是「旋转后页宽变了」「重建过桌面」——那些改动之后
  // 读数与目标值差得远，条件写入照常生效；已经在位时（>1px 容差吸收 snap 的亚像素终点）
  // 一次都不写。393×852 DPR3＋6× 节流实测：本观察器闭包在 20 次切页里自耗 934ms。
  function snapToIdx() {
    const want = idx * pageStep();
    if (Math.abs(pages.scrollLeft - want) > 1) pages.scrollLeft = want;
  }

  // 只切 class，不读任何样式（每帧只走到这里，见 syncFrame）
  function paint(cur) {
    if (cur === idx) return;
    idx = cur;
    deskIdxSave(); // #1466：页码落定即持久化（回收重载后回到这一页）
    for (let k = 0; k < dotsCache.length; k++) dotsCache[k].classList.toggle('active', k === idx);
  }

  // 按当前 scrollLeft 校正圆点（松手吸附后、旋转、外部重建时调用）
  function sync() {
    // v3.5.132：隐藏时跳过（防抖窗口内切页 → clientWidth=0 → idx 写坏、圆点全灭）
    if (!pages.clientWidth) return;
    const step = pageStep();
    if (!(step > 0)) return;
    const max = Math.max(dotsCache.length - 1, 0);
    paint(Math.max(0, Math.min(max, Math.round(pages.scrollLeft / step))));
  }

  function go(i) {
    refreshCache(); // 圆点可能刚被重建过（点击落在 deskRebuild 之后的首帧）
    const slides = getSlides();
    idx = Math.max(0, Math.min(slides.length - 1, i));
    lastUserSwipeTs = Date.now(); // #1466：圆点点击/外部跳页也是真实翻页动作（恢复闸记账；touchstart 管手势）
    deskIdxSave(); // #1466：圆点点击/外部跳页同口径持久化
    // v3.5.132：页面隐藏（display:none）时 clientWidth=0，直接赋值会产生 Infinity 下标
    if (!pages.clientWidth) return;
    // 直接赋值 scrollLeft 立即切换（scroll-snap 会自动吸附），避免 smooth 滚动被 snap 打断
    snapToIdx();
    for (let k = 0; k < dotsCache.length; k++) dotsCache[k].classList.toggle('active', k === idx);
  }

  // ===== v3.27.x（#690）：翻页帧耗时现场采样 =====
  // 背景：用户报「桌面三页滑动灰屏/卡顿/手机发烫（iOS 多机型同现）」，而无头内核
  // （无 GPU 的 WebKit/Blink）复现不出真机的图层栅格化与显存压力——诊断里那句
  // 「实测帧率≈61 fps」是**打开诊断那一刻**的静态值，跟翻页现场无关，于是每次
  // 报障都只能猜。这里补上唯一可信的读数来源：用户自己翻页的那一秒。
  // 约束（本文件性能红线不变，见文件头）：
  //   ① 只在翻页进行中采，采满 PERF_FRAMES 帧（≈1 秒）即停——空闲/静止页零开销；
  //   ② 每帧只做 performance.now() 相减 + 数组 push，不查 DOM、不读样式；
  //   ③ 收尾也只跑一次：写一个全局小键（同 mobile-adapt 的 __diag-stuck 做法），
  //      设置→诊断【性能】段读出。同一秒内不重复起采（perfOn 闸）。
  const PERF_KEY = 'xy-home-v2:__diag-deskperf';
  const PERF_FRAMES = 60;
  // FIX 2026-09-27 #1324：两把帧尺（#690 翻页／#884 切回桌面）共用的「挂起边界」标记。
  //   #707 那一条只挡住「回调还在跑而页面已隐藏」这一种后台帧；真机挂起时内核**一帧都不派发**，
  //   于是整段后台时长既不经过 `document.hidden` 分支、也没人重置基线，回来第一帧把它量成「一帧」。
  //   证据就在诊断单自己里：#884 那把尺 30 帧样本读出「平均 1196ms／p90 3435ms／最慢 20828ms」
  //   （2026-09-27 同一台 iPhone）、「最慢 25575ms」（#1300 那单），而 hid＝0＝它声称自己一帧后台
  //   都没剔——20 秒的一帧不是卡顿，是挂起。这条读数连续骗了 #1225／#1300／#1301 三批去「修切回桌面」，
  //   每一批都拿它当症状大小来定优先级（＝用户说的「覆盖式修补」的源头之一）。判据与 perf-check.js
  //   早已在用的那把尺同口径（可见性翻转＝一次边界，跨边界的差值不作数），零机型／零 UA 分支。
  let awayEdge = false;
  try { document.addEventListener('visibilitychange', function () { if (document.hidden) awayEdge = true; }); } catch (e) {}
  function awayGap() { if (!awayEdge) return false; awayEdge = false; return true; }
  // #1295 采样现场快照：帧耗时落键那一刻随附「这台桌面此刻什么配置＋最近跑了哪些活」——
  // #690/#884 两把尺子从前只能证「慢」，配上现场才能分辨是壁纸大纹理、CSS 模糊兜底、
  // 缩放外扩盒还是标签栏毛玻璃。只跑在采样收尾一次，读取零失败兜底、字符串截长。
  function sampleWitness() {
    const w = { sc: '', ph: '' };
    try { if (window.__mochiDeskScene) w.sc = window.__mochiDeskScene().txt.slice(0, 160); } catch (e) {}
    try {
      const l = window.__mochiPhaseLog || [], o = [];
      for (let i = Math.max(1, l.length - 6); i < l.length; i++) o.push(l[i].tag + '+' + (l[i].t - l[i - 1].t) + 'ms');
      w.ph = o.join('|').slice(0, 220);
    } catch (e) {}
    return w;
  }
  let perfOn = false;
  let perfScrollAt = 0; // #1467：最近一条翻页 scroll 的时刻＝「手势还活着」的心跳，截短判据用它
  function perfSample() {
    perfScrollAt = Date.now(); // #1467：每条 scroll 都刷新（本函数只在 scroll 里被调）
    if (perfOn) return;
    perfOn = true;
    const gaps = [];
    let last = 0;
    // FIX 2026-09-17 #707：切后台/锁屏期间 rAF 冻结（或部分内核降到 1fps），恢复后的
    // 第一帧会量出「整段后台时长」的巨帧——真机实测 60 帧样本里混进一条 144s 后台
    // 间隙，把「平均 2543ms」整行拉成严重卡顿（p90 才是真实水平），报障判读被带偏。
    // 现改为：隐藏帧只重置基线不记样本，恢复后重采；剔除条数随 hid 字段落键，
    // 诊断【性能】一节据此标注「已剔除后台帧 N」。
    let hid = 0;
    // #1467：收笔抽成函数——正常采满与「翻页已停截短」共用同一落键（cut 字段区分）
    const finish = () => {
      perfOn = false;
      gaps.sort((a, b) => a - b);
      const sum = gaps.reduce((a, b) => a + b, 0);
      try {
        const _w690 = sampleWitness();
        localStorage.setItem(PERF_KEY, JSON.stringify({
          t: Date.now(), n: gaps.length, hid: hid,
          mean: Math.round(sum / gaps.length),
          p90: Math.round(gaps[Math.floor(gaps.length * 0.9)]),
          worst: Math.round(gaps[gaps.length - 1]),
          cut: gaps.length < PERF_FRAMES ? 1 : 0, // #1467：1＝翻页已停提前收笔（未采满 60 帧）
          pages: dotsCache.length, // 圆点数＝桌面页数（随手可得，不额外查 DOM）
          sc: _w690.sc, ph: _w690.ph // #1295 现场快照（诊断行随帧耗时一并读出）
        }));
      } catch (e) {}
    };
    const tick = (now) => {
      if (awayGap()) { hid++; last = 0; requestAnimationFrame(tick); return; } // #1324：跨挂起边界的那一差不算一帧
      if (typeof document !== 'undefined' && document.hidden) {
        hid++;
        last = 0;
        requestAnimationFrame(tick);
        return;
      }
      // #1467：翻页已停（≥500ms 无新 scroll）就当场收笔——旧实现闭着眼采满 60 帧才落键，
      // 而 60 帧 × 每帧 851ms ≈ 51 秒，采样窗后半段早就不在翻页、混进来的环境冻结（多秒级
      // 前台冻结）全被记成「翻页耗时」，本机 v8.54 报告 851ms 均值就是这么来的；截短样本带
      // cut=1，诊断行据此标注，分诊不再把环境冻结当手势成本。
      if (gaps.length && Date.now() - perfScrollAt > 500) { finish(); return; }
      if (last) gaps.push(now - last);
      last = now;
      if (gaps.length < PERF_FRAMES) { requestAnimationFrame(tick); return; }
      finish();
    };
    requestAnimationFrame(tick);
  }

  // ===== #989 桌面页竖向滚动护栏（用户实报「桌面的第一页和第二页的图标按钮和文字没有完全
  // 对齐，第二页和第三页是完全对齐的」，随后追报「第三页也没有对齐了」＝错位会换页出现）=====
  // 现象/根因（无头实证，零机型分支）：桌面页内容高 636px（含页底 18px 留白 + 图标组尾部
  // 6+8px），而浏览器模式（非全屏，地址栏占高）下桌面区只有 ~610px ⇒ 每页都成了**可竖向
  // 滚动容器**，而超出的那 26px **全是不可见尾垫**（标签下沿之上再没有别的内容，滚下去
  // 什么也看不到）。于是：①翻页时手指的斜滑被内核轴锁判成竖向 ⇒ 滚动量落在「起手那一页」
  // 上（起手页常是第一页，故症状先在 1/2 页间出现；用户在第三页起手翻页后第三页也错开）；
  // ②滚动量没有任何东西复位，永久留在那一页 ⇒ 该页图标+文字整块上移几像素，与另两页错开
  //（无头实证：第一页 scrollTop=20 ⇒ 行 y 427.3/537.3 vs 另两页 447.3/557.3，Δ=20 精确等于
  // 残留滚动量）。旧验证全跑 390×844（桌面区 714 > 内容 636）⇒ 桌面页根本不可滚，本 bug 在
  // 验证里结构性不可见，所以「每次都验 Δ=0、用户每次依旧错位」。
  // 修法（纯判据，无机型/无 UA 分支）：只要**翻下去看不到任何东西**（溢出全部来自容器自身的
  // 内边距/外边距——实测该页 scrollHeight 636 vs clientHeight 610，而最深「实心盒」下沿只有
  // 604），该页就设 overflow-y:hidden 并把 scrollTop 归零：被裁掉的是不可见留白，零视觉变化，
  // 而该页从此不可能再被斜滑/内核几何风暴顶出滚动量；**真溢出**（用户往页里加了组件、或桌面
  // 区矮到标签都放不下）时保持 auto 照旧可滚，绝不吞掉用户真正要看的内容。任何滚动（含斜滑）
  // 落定后复核一次，残留滚动量最迟 300ms 内自愈。
  const pageScrollGuard = (function () {
    // 页内最深「实心盒」下沿（相对页顶）＝真正看得见的内容底：
    // 只取没有子元素的叶子盒（容器的 padding 不是内容），跳过隐藏项与绝对/固定定位装饰
    // （角标 .app-badge、连击 .we-combo 这类负偏移装饰不参与，免得把「没内容」误判成「有内容」）
    function inkBottom(sl, pageTop) {
      const stopAt = sl.clientHeight + 1; // 与调用方那句比较共用同一阈值，早退才等价
      let maxB = 0;
      const all = sl.querySelectorAll('*');
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (el.firstElementChild) continue;
        const r = el.getBoundingClientRect();
        const b = r.bottom - pageTop;
        if (r.height <= 0 || b <= maxB) continue;
        const c = getComputedStyle(el);
        if (c.display === 'none' || c.visibility === 'hidden') continue;
        if (c.position === 'absolute' || c.position === 'fixed') continue;
        maxB = b;
        if (maxB > stopAt) return maxB; // 已经证明「有看得见的内容越过可视底」＝不用再扫
      }
      return maxB;
    }
    // FIX 2026-09-24 #1201（iPhone 17 / iOS 26.4 实报「切页面、滑动时最卡」，perfcheck：桌面翻页
    //   平均 91ms·最慢 1513ms、切回桌面 p90 702ms）：这条护栏挂在桌面每一次「滚动落定 / 切回桌面 /
    //   回前台」上，旧写法每次都要把三页子树整个走一遍（默认小桌面实测一次 run＝380 次
    //   getComputedStyle ＋ 356 次 getBoundingClientRect；用户桌面越满越贵）。而它要的结论只随
    //   **该页自身几何**变化——scrollHeight 与 clientHeight 都不变，溢出量和「内容有没有越过可视底」
    //   就不变。于是按页记忆化裁决：几何没变＝照抄上次结论、不碰子树；组件增删/图标注入/图片解码
    //   完成/restore/resize 这些**内容真的到位**的触发点带 force 强制重扫（见下方接线）。
    //   #989（残留滚动量复位）与 #1013（真溢出一律可滚）的判据一字未动。
    const verdicts = new WeakMap();
    let timer = null, retries = 0, forceQueued = false;
    // #1311：force 要能跨「多次 later() 叠在一起」存活一次——旧写法 clearTimeout 后把上一次的
    // force 一起丢了（组件刚增删、图片刚解码完，紧接着一次文本滴答就把那趟必做的全量扫描降级）。
    // 排队时置位、run 取用即清，非强制的那次不得吃掉已排队的强制那次。
    function later(ms, force) {
      if (force) forceQueued = true;
      clearTimeout(timer);
      timer = setTimeout(function () { const f = forceQueued; forceQueued = false; run(f); }, ms);
    }
    function run(force) {
      const slides = getSlides();
      let skipped = false;
      for (let i = 0; i < slides.length; i++) {
        const sl = slides[i];
        // 桌面页整体隐藏（切到聊天/设置）时 clientHeight=0；开屏期 .phone 被 visibility:hidden
        // 盖住时页内每个盒子都算「不可见」＝量出来的 inkBottom 恒 0，会被误判成「翻下去什么也
        // 看不到」而错误裁掉真溢出——两种都跳过（读数何时可得见下方的有界重试）。
        if (!sl.clientHeight || getComputedStyle(sl).visibility === 'hidden') { skipped = true; continue; }
        const sh = sl.scrollHeight, ch = sl.clientHeight, over = sh - ch;
        const seen = verdicts.get(sl);
        let blind;
        if (!force && seen && seen.sh === sh && seen.ch === ch) {
          blind = seen.blind; // 几何没变＝裁决没变，省掉整棵子树
        } else {
          // #960 取证口径：只有真扫了子树才打点——下份 perfcheck 里「desk-guard ×N」的 N
          // 就是全量遍历次数，能直接分辨「护栏还在咬人」与「不是它」。
          try { if (window.__mochiPhase) window.__mochiPhase('desk-guard'); } catch (e0) {}
          // FIX 2026-09-22 #1013（回拉）：基准必须是**未滚动**的内容坐标——pageTop 减掉 scrollTop，
          // 否则页滚到越靠下、量到的「最深实心盒下沿」越浅（每个盒子都被整体上移了 scrollTop），
          // 真溢出页滚到底时必然落进 ch+1 以内＝误判成「翻下去什么也看不到」→ 归零滚动量。
          // 用户所见＝「在桌面滑动屏幕会回拉，无法滑到下面」（vivo S30/Edge 实报，同族多机型）。
          blind = over > 0 && inkBottom(sl, sl.getBoundingClientRect().top - sl.scrollTop) <= sl.clientHeight + 1;
          verdicts.set(sl, { sh: sh, ch: ch, blind: blind });
        }
        if (blind) {
          if (sl.style.overflowY !== 'hidden') sl.style.overflowY = 'hidden';
          if (sl.scrollTop) sl.scrollTop = 0;
        } else {
          if (sl.style.overflowY) sl.style.overflowY = '';   // 回落到 CSS 的 auto
          if (over <= 0 && sl.scrollTop) sl.scrollTop = 0;
        }
      }
      // 开屏收起那一刻不派发任何事件（开屏是 #desktop-pages 的兄弟节点，MutationObserver 收不到），
      // 而开屏在位期间整页不可见、量不出读数 ⇒ 量不到就自己重试，最多 8 次（≈6.4s，覆盖各设备
      // 开屏快慢），一旦拿到读数即停；真读得到时把计数清零，供下一次开屏/隐藏复用。
      if (skipped && retries < 8) { retries++; later(800); } else if (!skipped) retries = 0;
    }
    return { run: run, later: later };
  })();
  pageScrollGuard.run(true);
  // 页自身的竖向滚动事件不冒泡，捕获相才能收到（外层 #desktop-pages 的横向翻页不受影响）
  pages.addEventListener('scroll', () => pageScrollGuard.later(300), true);
  // FIX 2026-09-22 #1013（锁死）：护栏按「当下量到的几何」裁决，而桌面图片组件
  // （.desk-image-widget img 是 width:100% / height:auto）在解码完成前高 0px——那一拍整页
  // 「翻下去什么也看不到」成立 ⇒ 被设成 overflow-y:hidden；图片随后撑开真溢出，可 load 既不改
  // #desktop-pages 的子节点（上面那个 MutationObserver 只收 childList）也不派 scroll ⇒ 没人复核，
  // 该页就永久停在「有内容在下方却滚不动」＝用户说的「无法滑到下面」。资源 load 同样不冒泡，走捕获相。
  pages.addEventListener('load', () => pageScrollGuard.later(400), true);
  window.addEventListener('resize', () => pageScrollGuard.later(120, true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pageScrollGuard.later(80); });
  // 组件增删/图标注入/切桌面重建都会动 DOM，统一在这里复核（拖动组件期间每帧多次也只在停手后跑一次）
  // FIX 2026-09-26 #1311（iPhone 17 Pro Max / iOS 26.6.1 实报「听音乐时整体卡顿」，同批 perfcheck：
  //   掉帧 88/119 帧集中在「手机桌面」、前台冻结 91 次、冻结前序操作 desk-guard ×59（距冻结起点中位
  //   2ms＝紧邻高危））：桌面音乐组件每 500ms 写一次 `mw-cur`/`mw-dur` 的 textContent，而 `el.textContent
  //   = 字符串` 是「删掉旧文本节点＋插入新文本节点」＝一次 childList 变异，落进下面这个 observer 就被
  //   当成「结构变了」带 force 重扫——#1201 那把按页记忆化的闸（几何没变就照抄上次裁决、不碰子树）
  //   被这种纯文本滴答整层绕过，每半秒一次全量走树（每元素 getBoundingClientRect ＋ 候选节点
  //   getComputedStyle；#1201 实测默认小桌面一趟就 380 次 computedStyle／356 次 rect，桌面越满越贵）。
  //   同一形态的滴答源不止音乐：桌面时钟/计时器/任何每秒重写自己读数的组件都算，而这条 observer 是
  //   `subtree:true` 收整棵桌面子树，所以判据只能问「这一批变异到底动没动结构」，不能问「是哪个组件」。
  //   裁决依旧安全：文本换了行（两行↔一行）会让该页 scrollHeight 变，下面 run 里的记忆化 key 就是
  //   (sh, ch)，key 一变照样全量重扫；scroll/resize/visibilitychange 这些非强制触发点本来就是同一口径。
  const textOnlyChurn = function (muts) {
    if (!muts || !muts.length) return false;
    for (let i = 0; i < muts.length; i++) {
      const m = muts[i];
      // addedNodes/removedNodes 里有任何一个非文本节点（元素、注释＝#comment 也算结构）＝结构变了
      for (let j = 0; j < m.addedNodes.length; j++) if (m.addedNodes[j].nodeType !== 3) return false;
      for (let j = 0; j < m.removedNodes.length; j++) if (m.removedNodes[j].nodeType !== 3) return false;
    }
    return true;
  };
  try {
    new MutationObserver((muts) => pageScrollGuard.later(400, !textOnlyChurn(muts))).observe(pages, { childList: true, subtree: true });
  } catch (e) {}
  // 开屏消失/数据回填/图标注入都不动 #desktop-pages 的子节点（开屏是它的兄弟），补两个启动期
  // 复核点：数据就绪事件 + 两次定时（开屏收起后各设备快慢不一，早跑那次会因整页不可见被跳过）
  try { document.addEventListener('mochi-restore-done', () => pageScrollGuard.later(400, true)); } catch (e) {}
  pageScrollGuard.later(900, true);
  setTimeout(() => pageScrollGuard.run(true), 2600);

  // ===== #884：切回桌面帧耗时现场采样 =====
  // 用户主诉「聊天返回主页面卡、主页面切换卡」（iPhone 15 Pro / 16 Pro 实报，iOS 18.7 PWA），
  // 而诊断里「实测帧率」是静态页读数、「桌面翻页帧耗时」只采左右滑——切页现场没尺子。
  // 本采样器在 page-phone 从隐藏变可见那一刻起采 30 帧（≈0.5s，覆盖切页布局+栅格化窗口），
  // 写 xy-home-v2:__diag-swperf，device.js 诊断【性能】段读出。约束同 #690：只在切页瞬间
  // 采、采满即停；每帧只做 now 相减 + push；同一次隐藏→可见只起采一回（swOn 闸）；
  // 后台冻结帧只重置基线不记样本（#707 同款）。
  const SW_KEY = 'xy-home-v2:__diag-swperf';
  const SW_FRAMES = 30;
  function swSample() {
    if (swOn) return;
    // FIX 2026-09-20 #943e：自动采样限频——原实现每次从聊天/设置切回桌面都开一轮 30 帧
    // rAF 循环，恰在回桌面/翻页的卡顿敏感窗口自我加压（采的正是自己扰动的帧）。限到
    // 5 分钟一次；设置→性能检测的手动 perfcheck 走 perf-check.js 独立通道，不受影响。
    const now943 = Date.now();
    if (now943 - (swSample.last || 0) < 300000) return;
    swSample.last = now943;
    swOn = true;
    const gaps = [];
    let last = 0, hid = 0;
    const swT0 = Date.now(); // #1467：切回桌面的墙钟起点
    const finish = () => {
      swOn = false;
      gaps.sort((a, b) => a - b);
      const sum = gaps.reduce((a, b) => a + b, 0);
      const _w884 = sampleWitness();
      try {
        localStorage.setItem(SW_KEY, JSON.stringify({
          t: Date.now(), n: gaps.length, hid: hid,
          mean: Math.round(sum / gaps.length),
          p90: Math.round(gaps[Math.floor(gaps.length * 0.9)]),
          worst: Math.round(gaps[gaps.length - 1]),
          cut: gaps.length < SW_FRAMES ? 1 : 0, // #1467：1＝切页窗口已过提前收笔
          sc: _w884.sc, ph: _w884.ph // #1295 现场快照（切回桌面那一刀当时壁纸/模糊/近操作是什么）
        }));
      } catch (e) {}
    };
    const tick = (now) => {
      if (document.hidden || awayGap()) { hid++; last = 0; requestAnimationFrame(tick); return; } // #1324：同上，挂起期那一段不记进样本
      // #1467：切回桌面的布局/栅格化窗口通常 ≤1 秒——2.5s 还没采满就收笔，防把之后与切页
      // 无关的环境冻结记进「切回桌面」账（#1324 之前这条尺曾把整段挂起量成一帧骗过三批分诊；
      // 挂起修掉了、环境冻结还会来，同一课：截短＋标注，不再让尺子替别处的病背锅）
      if (gaps.length && Date.now() - swT0 > 2500) { finish(); return; }
      if (last) gaps.push(now - last);
      last = now;
      if (gaps.length < SW_FRAMES) { requestAnimationFrame(tick); return; }
      finish();
    };
    requestAnimationFrame(tick);
  }
  let swOn = false;

  // v3.27.x（#580）：滚动中每帧跟随——手指滑到哪，圆点跟到哪（原来只在松手后 120ms 才动）
  let rafId = 0;
  let settleTimer = null;
  let swipeBlurTimer = null; // #976：滑页暂停壁纸模糊的收尾计时
  // #1445d：桌面模糊载体（.phone）静态锚缓存——与 #338 的 _scPhone／tabs.js 的 _blurPh 同款假设
  //（.phone 是 template.html 静态锚点），只在第一次真正要用时查一次
  let _swBlurPh = null;
  function syncFrame() {
    rafId = 0;
    sync();
  }  pages.addEventListener('scroll', () => {
    if (!rafId) rafId = requestAnimationFrame(syncFrame);
    perfSample(); // #690：翻页现场记一段帧耗时（静止时不跑）
    // #976：滑页期间挂 desk-swiping（暂停壁纸全屏模糊，见 home.css 注释），停下 150ms 后摘
    // #1445d：与 tabs.js #1445a 同一处成本、同一把尺——该类全站唯一消费者是 home.css 的
    // `html.desk-swiping .phone.desk-blur-on #phone-bg-layer{filter:none}`，未开背景模糊
    //（出厂默认）时那条规则永不匹配＝零收益；而对 <html> 增删类名会让整棵文档样式失效重算，
    // 桌面滑页是高频手势、且摘类正好落在吸附/回弹那一帧，一次滑动白付两遍。
    // 判据只问「模糊载体在不在」这一个内核无关事实，零机型／零 UA 分支。
    try {
      const bph = _swBlurPh || (_swBlurPh = document.querySelector('.phone'));
      if (bph && bph.classList.contains('desk-blur-on')) {
        document.documentElement.classList.add('desk-swiping');
        clearTimeout(swipeBlurTimer);
        swipeBlurTimer = setTimeout(function () { document.documentElement.classList.remove('desk-swiping'); }, 150);
      }
    } catch (e0) {}
    // 吸附/回弹终点再校一次：末次 scroll 事件与 snap 终点可能差一帧亚像素；
    // 对不派 rAF 的内核（后台标签页/被节流）也是兜底。跟随本身由上面的 rAF 负责。
    clearTimeout(settleTimer);
    settleTimer = setTimeout(sync, 80);
  }, { passive: true });

  // #1466：起手即预热——scroll 事件要等内核判定横向滚动之后才来，第一帧新页瓦片往往还没
  // 栅格化完（「只显示一半」正是这一窗）。touchstart 起手挂 .swipe-warm，比首个 scroll
  // 事件早整段手势预滚动期，栅格化发生在手指按下还没移动的窗口里。
  pages.addEventListener('touchstart', function () { lastUserSwipeTs = Date.now(); swipeWarm(); }, { passive: true });

  // 圆点点击切换：事件委托（v3.6.x：圆点是动态重建的，不能直接绑每颗）
  document.getElementById('desktop-dots').addEventListener('click', (e) => {
    const dot = e.target.closest('.dot');
    if (!dot) return;
    go(getDots().indexOf(dot));
  });

  // v3.5.132：旋转后按新宽度重设 scrollLeft（否则停在 1.x 页位置，圆点与内容不符）
  window.addEventListener('resize', () => {
    refreshCache();
    gapCache = null; // #1301：作废点从 refreshCache 挪到这里——视口变了页宽与媒体查询都可能变
    if (pages.clientWidth) snapToIdx();
  });

  // ===== #1225：亮屏离开桌面 ≥60s 就释放桌面的全屏合成层 =====
  // 为什么：#754 把三张 .page-slide 提到独立合成层（`will-change: transform`）治的是**桌面翻页**
  // 每帧重栅格整屏大图；代价是三张常驻全屏纹理＝440×956@3x 每张约 15MB、共约 45MB 显存，
  // 而且**人不在桌面时也照样常驻**。本机两份诊断实证：perfcheck 30 秒里 76% 的帧在 设置、桌面只
  // 占 17%，同时「本页被系统回收过 28 次」——回收一次＝切回来整站冷启动（全部脚本重编＋十几 MB
  // 本地数据重回填），正是「切回桌面 平均114ms／最慢 1452ms」「最慢一帧 2449ms」那串读数的来源，
  // 也是把未提交的写库窗口掐掉的机会（聊天记录丢失同源）。
  // 怎么做：只加一个「亮屏且离开桌面满 60 秒」的计时闸，命中就给 <html> 挂 desk-layer-cold
  // （home.css 里把 will-change 收回 auto）。①正常「退聊天回桌面」的来回（几十秒内）完全不摘，
  // #147 那条「回桌面巨卡」的常驻语义一字未动；②真挂上时人本来就不在桌面＝零视觉变化；
  // ③回到桌面（hidden 翻回 false / 从后台回前台且当前就是桌面）当场收回，且**后台期不计时**——
  // iOS 挂起时 GPU 资源本就作废，没必要把重新提升的成本压进用户报的那个「切回来」窗口。
  // 判据只有「桌面这一页可见与否 ＋ 亮屏多久」，零机型、零 UA 分支。
  const DESK_COLD_MS = 60000;
  let deskColdT = 0;
  function setDeskCold(on) {
    let cur = false;
    try { cur = document.documentElement.classList.contains('desk-layer-cold'); } catch (e0) { return; }
    if (cur === !!on) return;
    try { document.documentElement.classList.toggle('desk-layer-cold', !!on); } catch (e1) {}
    // 给 perf-check 留证：下一份报告里「桌面层已释放」这个现场指纹有没有出现＝这条闸到底
    // 在真机上咬合过没有，不用靠猜。（相位点缺失时 perf-check 自带守卫，不报错）
    try { if (window.__mochiPhase) window.__mochiPhase(on ? 'desk-layer-cold' : 'desk-layer-warm'); } catch (e2) {}
  }
  function deskColdArm(arm) {
    if (deskColdT) { clearTimeout(deskColdT); deskColdT = 0; }
    if (!arm) { setDeskCold(false); return; }
    if (typeof document !== 'undefined' && document.hidden) return; // 后台期不计时（见上）
    deskColdT = setTimeout(function () { deskColdT = 0; setDeskCold(true); }, DESK_COLD_MS);
  }

  // v3.6.x：桌面页隐藏时（切到聊天/设置等）旋转，resize 里 clientWidth=0 会跳过——
  // 返回桌面时按新宽度重设一次，避免 scrollLeft 停在两页之间、圆点与内容错位
  const phonePage = document.getElementById('page-phone');
  if (phonePage) {
    const mo = new MutationObserver(() => {
      // #1225：先做显存闸的收支（离开桌面起算／回到桌面当场收回，回调在绘制之前），
      // 再跑原有的位置校正——两者互不依赖，校正逻辑一字未动。
      if (phonePage.hidden) { deskColdArm(true); return; }
      deskColdArm(false);
      if (pages.clientWidth) {
        refreshCache();
        sync(); // #1466：先按真实落点校正 idx 再落位——回桌面那一刻若 idx 因滚动事件被节流而陈旧，旧序会照陈旧值把 scrollLeft 写回别的页＝「自己弹回去」；sync 只切圆点不写滚动位，先它一步零成本
        snapToIdx(); // #1301：已经在位就不写（旧写法每次切回桌面必写一次＝把同步布局压进这一帧）
        sync();
        pageScrollGuard.later(60); // #989：回桌面复核一次（残留滚动量在进桌面当帧就修掉）
        swSample(); // #884：从聊天/其他页切回桌面那一刻现场采一段帧耗时
      }
    });
    mo.observe(phonePage, { attributes: true, attributeFilter: ['hidden'] });
    // #1225：从后台回到前台时重新裁决——当前就在桌面就把释放收回来（后台期本就不计时），
    // 停在别的页则重新起一轮 60s（旧计时可能整段花在挂起期，不作数）。
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if (phonePage.hidden) deskColdArm(true); else deskColdArm(false);
    });
    // 首屏就不在桌面（深链/上次停在别的页）时补起一轮；在桌面则不计时。
    deskColdArm(!!phonePage.hidden);
  }

  // v3.6.x：外部（新增/删除桌面页后）调用，重建圆点数量 + 校正当前索引
  // v3.27.x（#140）：页数钳到实际 slide 数——deskRebuild 可能在 buildDeskPages
  // 删页完成前被触发（回填重放/恢复默认竞态），此时 idx 可能 ≥ slides.length；
  // 旧实现把 scrollLeft 设到超界页位（Chrome 上 snap 到空白区，视觉=当前页空白、
  // 卡片全部「不显示」）。钳制后圆点/索引与实际页数一致。
  window.deskRebuild = function () {
    const slides = getSlides();
    // #1466：恢复上次停留页——跟着每一次建桌面走（开机要建不止一次：先默认布局、数据回填
    // 后再建全量，一次性恢复会被第一次建掉）。「正在翻页」的 1.2s 内不拽人（记账只认
    // touchstart/圆点跳页这类真实用户动作，程序化定位写入不记账＝重建自身的落位写入不干扰
    // 后续恢复）；会话中途的重建发生时持久值本来就等于用户刚落定的那一页（每次翻页落定都已
    // 同步写键）⇒ 同页无感。
    if (slides.length && !(lastUserSwipeTs && Date.now() - lastUserSwipeTs < 1200)) {
      const want1466 = Math.max(0, Math.min(slides.length - 1, deskIdxSaved()));
      if (want1466 !== idx) idx = want1466;
    }
    idx = Math.max(0, Math.min(Math.max(slides.length - 1, 0), idx));
    // 重建圆点
    const dotsBox = document.getElementById('desktop-dots');
    if (dotsBox) {
      dotsBox.innerHTML = '';
      for (let i = 0; i < slides.length; i++) {
        const d = document.createElement('span');
        d.className = 'dot' + (i === idx ? ' active' : '');
        dotsBox.appendChild(d);
      }
    }
    // 圆点已重建：缓存必须换成新节点（旧节点已脱离文档，继续改等于改了个空）
    refreshCache();
    gapCache = null; // #1301：增删页＝结构性变更点，gap 在此作废（refreshCache 已不再顺手清）
    if (pages.clientWidth) {
      pages.scrollLeft = idx * pageStep();
      sync();
    }
  };

  refreshCache();
  sync();

  // v3.x：暴露给桌面长按拖拽（跨页翻页 + 当前页索引）
  window.deskGo = go;
  window.deskIdx = function () { return idx; };
  // #1466：诊断读数（device.js「桌面翻页现场」行按它打印）
  window.__deskSlideDiag = function () {
    return { idx: idx, n: Math.max(dotsCache.length, getSlides().length), sl: pages.scrollLeft, warm: pages.classList.contains('swipe-warm') };
  };
})();
