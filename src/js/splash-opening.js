/* ===== 开屏片头 · Triangle Bloom（二改预览）=====
   替换原「星云跃迁 / 地球」开屏，改用 BETWEEN US（47 & baink）开源的三角开花开屏。
   原版是独立页面，官方推荐的嵌入方式就是 iframe + postMessage；本文件只负责：
   · 盖一层与手机壳同尺寸的 iframe（src="opening/index.html"）
   · 收到 between:opening-reveal 时让底下的主页轻轻长出来
   · 收到 between:opening-complete / error 或超时后移除 iframe
   · 每会话一次；?opening=1 强制重播，?opening=0 关闭；reduced-motion 直接跳过
   素材授权：代码 MIT；flowers.png / flowers_fill.png 仅供非商业学习使用（© nival / Canva 拼贴），
   crack 图可商用。详见 src/opening/README.md 与 LICENSE-between-us.txt。
*/
(function () {
  'use strict';

  var SEEN_KEY = 'mochi-bloom-seen';
  var FORCE = false, OFF = false;
  try {
    var q = location.search;
    FORCE = /(^|[?&])opening=1(&|$)/.test(q);
    OFF = /(^|[?&])opening=0(&|$)/.test(q);
  } catch (e) {}
  if (OFF) return;
  if (!FORCE) {
    try { if (sessionStorage.getItem(SEEN_KEY) === '1') return; } catch (e) {}
  }
  try { if (matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) {}
  if (document.hidden) return;
  if (window.__bloomIntroStarted) return;
  window.__bloomIntroStarted = true;

  var host = document.querySelector('.phone') || document.body;
  if (!host) return;

  var style = document.createElement('style');
  style.id = 'bloom-intro-css';
  style.textContent =
    '#bloom-intro{position:absolute;inset:0;z-index:9998;background:#0b0b0d;overflow:hidden;' +
      'opacity:1;transition:opacity .5s ease;}' +
    '#bloom-intro.bi-out{opacity:0;pointer-events:none;}' +
    '#bloom-intro iframe{width:100%;height:100%;border:0;display:block;background:#0b0b0d;}' +
    '.phone.bloom-home-in .page:not([hidden]){animation:bloomHomeIn .85s cubic-bezier(.2,.7,.2,1) both;}' +
    '@keyframes bloomHomeIn{from{opacity:0;transform:translateY(14px) scale(.985);}to{opacity:1;transform:none;}}';
  document.head.appendChild(style);

  var wrap = document.createElement('div');
  wrap.id = 'bloom-intro';
  var frame = document.createElement('iframe');
  frame.title = '开屏';
  frame.setAttribute('scrolling', 'no');
  frame.setAttribute('allow', 'autoplay');
  frame.src = 'opening/index.html';
  wrap.appendChild(frame);
  host.appendChild(wrap);
  host.classList.add('bloom-home-in');

  var done = false;
  var watchdog = 0;
  var revealTimer = 0;

  function markSeen() {
    try { sessionStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
  }
  function cleanup() {
    if (done) return;
    done = true;
    try { clearTimeout(watchdog); } catch (e) {}
    try { clearTimeout(revealTimer); } catch (e) {}
    markSeen();
    try {
      wrap.classList.add('bi-out');
      setTimeout(function () {
        try { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); } catch (e) {}
        try { host.classList.remove('bloom-home-in'); } catch (e) {}
      }, 520);
    } catch (e) {}
  }
  function revealHome() {
    // 原版在碎块掉到一半时通知外层：主页此刻开始生长
    try { host.classList.remove('bloom-home-in'); void host.offsetWidth; host.classList.add('bloom-home-in'); } catch (e) {}
  }

  window.addEventListener('message', function (e) {
    try {
      if (e.source !== frame.contentWindow) return;
      var t = e.data && e.data.type;
      if (t === 'between:opening-reveal') {
        revealTimer = setTimeout(revealHome, 40);
      } else if (t === 'between:opening-complete' || t === 'between:opening-error') {
        cleanup();
      }
    } catch (err) {}
  });

  frame.addEventListener('error', cleanup);
  // 兜底：素材异常 / iframe 被拦时最多盖 16 秒，绝不让开屏把 App 永久挡住
  watchdog = setTimeout(cleanup, 16000);
})();
