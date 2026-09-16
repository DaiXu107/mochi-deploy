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
//   ② 每帧零 DOM 查询、零样式读取——页步长(gap) 与圆点数组缓存在增删页/resize 时
//      重算（refreshCache），每帧只剩 scrollLeft / clientWidth 两个布局读 + 一次取整；
//   ③ 不引入 smooth 滚动、不读写会触发布局的样式属性，只切 class。
(function () {
  const pages = document.getElementById('desktop-pages');
  if (!pages) return;

  // 动态查询（新增/删除页后结构变化，不能缓存 NodeList）
  function getSlides() { return Array.prototype.slice.call(pages.querySelectorAll('.page-slide')); }
  function getDots() { return Array.prototype.slice.call(document.querySelectorAll('#desktop-dots .dot')); }

  let idx = 0;

  // v3.27.x（#580）：每帧跟随用的缓存——防卡顿的关键。
  // 跟随改为每帧执行后，若每帧都 querySelectorAll + getComputedStyle，等于把滚动帧
  // 的预算花在查询上（安卓低端机必掉帧）。两者只在「增/删页」「resize」时失效重算。
  let dotsCache = [];
  let gapCache = null;

  function refreshCache() {
    dotsCache = getDots();
    gapCache = null;
  }

  // v3.6.x：页间有 gap 缝隙，每页滚动步长 = clientWidth + gap
  // gap 是 CSS 固定值（.desktop-pages 的 flex gap），不随布局变化，但元素
  // display:none 时 getComputedStyle 仍返回 CSS 值，可安全读取
  function pageStep() {
    if (gapCache === null) gapCache = parseFloat(getComputedStyle(pages).columnGap) || 0;
    return pages.clientWidth + gapCache;
  }

  // 只切 class，不读任何样式（每帧只走到这里，见 syncFrame）
  function paint(cur) {
    if (cur === idx) return;
    idx = cur;
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
    // v3.5.132：页面隐藏（display:none）时 clientWidth=0，直接赋值会产生 Infinity 下标
    if (!pages.clientWidth) return;
    // 直接赋值 scrollLeft 立即切换（scroll-snap 会自动吸附），避免 smooth 滚动被 snap 打断
    pages.scrollLeft = idx * pageStep();
    for (let k = 0; k < dotsCache.length; k++) dotsCache[k].classList.toggle('active', k === idx);
  }

  // v3.27.x（#580）：滚动中每帧跟随——手指滑到哪，圆点跟到哪（原来只在松手后 120ms 才动）
  let rafId = 0;
  let settleTimer = null;
  function syncFrame() {
    rafId = 0;
    sync();
  }
  pages.addEventListener('scroll', () => {
    if (!rafId) rafId = requestAnimationFrame(syncFrame);
    // 吸附/回弹终点再校一次：末次 scroll 事件与 snap 终点可能差一帧亚像素；
    // 对不派 rAF 的内核（后台标签页/被节流）也是兜底。跟随本身由上面的 rAF 负责。
    clearTimeout(settleTimer);
    settleTimer = setTimeout(sync, 80);
  }, { passive: true });

  // 圆点点击切换：事件委托（v3.6.x：圆点是动态重建的，不能直接绑每颗）
  document.getElementById('desktop-dots').addEventListener('click', (e) => {
    const dot = e.target.closest('.dot');
    if (!dot) return;
    go(getDots().indexOf(dot));
  });

  // v3.5.132：旋转后按新宽度重设 scrollLeft（否则停在 1.x 页位置，圆点与内容不符）
  window.addEventListener('resize', () => {
    refreshCache(); // 视口变了重算 gap 缓存（clientWidth 每帧现读，无需缓存）
    if (pages.clientWidth) pages.scrollLeft = idx * pageStep();
  });

  // v3.6.x：桌面页隐藏时（切到聊天/设置等）旋转，resize 里 clientWidth=0 会跳过——
  // 返回桌面时按新宽度重设一次，避免 scrollLeft 停在两页之间、圆点与内容错位
  const phonePage = document.getElementById('page-phone');
  if (phonePage) {
    const mo = new MutationObserver(() => {
      if (!phonePage.hidden && pages.clientWidth) {
        refreshCache();
        pages.scrollLeft = idx * pageStep();
        sync();
      }
    });
    mo.observe(phonePage, { attributes: true, attributeFilter: ['hidden'] });
  }

  // v3.6.x：外部（新增/删除桌面页后）调用，重建圆点数量 + 校正当前索引
  // v3.27.x（#140）：页数钳到实际 slide 数——deskRebuild 可能在 buildDeskPages
  // 删页完成前被触发（回填重放/恢复默认竞态），此时 idx 可能 ≥ slides.length；
  // 旧实现把 scrollLeft 设到超界页位（Chrome 上 snap 到空白区，视觉=当前页空白、
  // 卡片全部「不显示」）。钳制后圆点/索引与实际页数一致。
  window.deskRebuild = function () {
    const slides = getSlides();
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
})();
