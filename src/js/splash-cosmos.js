/* ===== 开屏片头 · 星云跃迁（二改）=====
   · 旋臂星云 + 星轨 + 飞船系统自检 HUD + 跃迁进度
   · 进度满 → 地球从星核中旋转浮现并放大（裸 WebGL 真球体）
   · 约 2.6 秒自动淡出，轻点任意处跳过；每会话一次；reduced-motion 直接跳过
   · 贴图：src/assets/earth-day.jpg / earth-night.jpg / earth-clouds.png（构建复制到 assets/）
   · 纯装饰：不阻塞数据加载，不参与进入闸门；公告仍在设置里单独查看
   · 调试：地址后加 ?cosmos=long 强制播放 12 秒（前 2.6 秒完成全部动画后定格）
*/
(function () {
  'use strict';

  var SEEN_KEY = 'mochi-cosmos-seen';
  var FORCE = false, LONG = false;
  try {
    FORCE = /(^|[?&])cosmos=(1|long)(&|$)/.test(location.search);
    LONG = /(^|[?&])cosmos=long(&|$)/.test(location.search);
  } catch (e) {}
  var DURATION = LONG ? 60000 : 2600;
  var INTRO_MS = 2600;

  if (!FORCE) {
    try { if (sessionStorage.getItem(SEEN_KEY) === '1') return; } catch (e) {}
  }
  try { if (matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) {}
  if (document.hidden) return;

  var host = document.querySelector('.phone') || document.body;
  if (!host) return;
  var lowMem = false;
  try { lowMem = !!(navigator.deviceMemory && navigator.deviceMemory <= 4); } catch (e) {}

  // ---------- 样式 ----------
  var style = document.createElement('style');
  style.id = 'cosmos-intro-css';
  style.textContent = [
    '#cosmos-intro{position:absolute;inset:0;z-index:9998;background:#02030a;overflow:hidden;',
    '  opacity:1;transition:opacity .55s ease;',
    '  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"PingFang SC",monospace;}',
    '#cosmos-intro.ci-out{opacity:0;pointer-events:none;}',
    '#cosmos-intro canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}',
    '#cosmos-intro .ci-nebula{z-index:0;}',
    '#cosmos-intro .ci-hud{position:absolute;inset:0;z-index:2;pointer-events:none;color:#f4f8ff;}',
    '#cosmos-intro .ci-scan{position:absolute;left:0;right:0;height:90px;top:-90px;',
    '  background:linear-gradient(transparent,rgba(230,240,252,.045),transparent);',
    '  animation:ciScan 7s linear infinite;}',
    '@keyframes ciScan{to{top:100%;}}',
    '#cosmos-intro .ci-corner{position:absolute;width:24px;height:24px;border:0 solid rgba(228,238,252,.4);}',
    '#cosmos-intro .ci-c1{top:14px;left:14px;border-top-width:1px;border-left-width:1px;}',
    '#cosmos-intro .ci-c2{top:14px;right:14px;border-top-width:1px;border-right-width:1px;}',
    '#cosmos-intro .ci-c3{bottom:14px;left:14px;border-bottom-width:1px;border-left-width:1px;}',
    '#cosmos-intro .ci-c4{bottom:14px;right:14px;border-bottom-width:1px;border-right-width:1px;}',
    '#cosmos-intro .ci-top{position:absolute;top:calc(18px + env(safe-area-inset-top,0px));left:34px;right:34px;',
    '  display:flex;justify-content:space-between;align-items:flex-start;}',
    '#cosmos-intro .ci-name{font-size:14px;line-height:1.4;letter-spacing:4px;color:#f4f8ff;',
    '  text-shadow:0 0 14px rgba(196,218,250,.5);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;}',
    '#cosmos-intro .ci-sub{margin-top:3px;font-size:10px;letter-spacing:1px;color:rgba(228,238,252,.6);}',
    '#cosmos-intro .ci-sub em{color:#fff;font-style:normal;text-shadow:0 0 8px rgba(196,218,250,.6);',
    '  animation:ciBlink 1.6s infinite;}',
    '#cosmos-intro .ci-ver{font-size:10px;color:rgba(228,238,252,.45);}',
    '@keyframes ciBlink{50%{opacity:.25;}}',
    '#cosmos-intro .ci-sys{position:absolute;left:34px;bottom:calc(118px + env(safe-area-inset-bottom,0px));',
    '  display:flex;flex-direction:column;gap:6px;font-size:11px;line-height:1.5;',
    '  transition:opacity .5s;}',
    '#cosmos-intro .ci-line{color:rgba(228,238,252,.22);letter-spacing:1px;transition:color .35s;}',
    '#cosmos-intro .ci-line.on{color:#f4f8ff;text-shadow:0 0 8px rgba(196,218,250,.5);}',
    '#cosmos-intro .ci-line.gold{color:#ffd98a;text-shadow:0 0 8px rgba(255,217,138,.5);}',
    '#cosmos-intro .ci-line.typing{color:rgba(228,238,252,.6);}',
    '#cosmos-intro .ci-line .cur{animation:ciCur .8s steps(1) infinite;}',
    '@keyframes ciCur{50%{opacity:0;}}',
    '#cosmos-intro .ci-line.on .cur{display:none;}',
    '#cosmos-intro .ci-warp{display:flex;align-items:center;gap:8px;margin-top:6px;',
    '  color:rgba(228,238,252,.75);font-size:11px;}',
    '#cosmos-intro .ci-wtrack{display:flex;gap:2px;width:150px;height:8px;}',
    '#cosmos-intro .ci-wtrack i{flex:1;background:rgba(228,238,252,.12);transition:background .12s,box-shadow .12s;}',
    '#cosmos-intro .ci-wtrack i.on{background:#fff;box-shadow:0 0 6px rgba(196,218,250,.8);}',
    '#cosmos-intro .ci-wtrack i.now{background:rgba(255,255,255,.5);animation:ciSeg .5s steps(2) infinite;}',
    '@keyframes ciSeg{50%{opacity:.35;}}',
    '#cosmos-intro .ci-wpct{width:38px;font-variant-numeric:tabular-nums;}',
    '#cosmos-intro .ci-planet{position:absolute;left:34px;bottom:calc(64px + env(safe-area-inset-bottom,0px));',
    '  display:flex;flex-direction:column;gap:5px;font-size:11px;line-height:1.5;',
    '  opacity:0;transition:opacity .7s;}',
    '#cosmos-intro .ci-planet.show{opacity:1;}',
    '#cosmos-intro .ci-tip{position:absolute;right:24px;bottom:calc(26px + env(safe-area-inset-bottom,0px));',
    '  font-size:10px;letter-spacing:1px;color:rgba(190,210,240,.42);}',
    '#cosmos-intro .ci-flash{position:absolute;inset:0;z-index:3;opacity:0;pointer-events:none;',
    '  background:radial-gradient(circle at 50% 42%,#f2f9ff,#a8ccf5 45%,#030408 100%);}',
    '#cosmos-intro .ci-flash.go{animation:ciFlash .8s ease-in forwards;}',
    '@keyframes ciFlash{0%{opacity:0}22%{opacity:.30}100%{opacity:0}}'
  ].join('');
  document.head.appendChild(style);

  // ---------- DOM ----------
  var wrap = document.createElement('div');
  wrap.id = 'cosmos-intro';
  wrap.innerHTML =
    '<canvas class="ci-nebula"></canvas>' +
    '<div class="ci-hud">' +
      '<div class="ci-scan"></div>' +
      '<i class="ci-corner ci-c1"></i><i class="ci-corner ci-c2"></i>' +
      '<i class="ci-corner ci-c3"></i><i class="ci-corner ci-c4"></i>' +
      '<div class="ci-top"><div>' +
        '<div class="ci-name">Mochi 字卡传讯</div>' +
        '<div class="ci-sub">DEEP-SPACE RELAY <em>●</em> ONLINE</div>' +
      '</div><div class="ci-ver" id="ciVer"></div></div>' +
      '<div class="ci-sys" id="ciSys">' +
        '<div class="ci-line" data-i="0"><span class="t"></span><span class="cur">▌</span></div>' +
        '<div class="ci-line" data-i="1"><span class="t"></span><span class="cur">▌</span></div>' +
        '<div class="ci-line" data-i="2"><span class="t"></span><span class="cur">▌</span></div>' +
        '<div class="ci-line" data-i="3"><span class="t"></span><span class="cur">▌</span></div>' +
        '<div class="ci-warp"><span>跃迁进度 WARP</span>' +
          '<span class="ci-wtrack" id="ciWtrack"></span>' +
          '<span class="ci-wpct" id="ciWpct">0%</span></div>' +
      '</div>' +
      '<div class="ci-planet" id="ciPlanet">' +
        '<div class="ci-line on gold"><span class="t">发现宜居行星 EARTH · SOL-3</span></div>' +
        '<div class="ci-line on gold"><span class="t">轨道注入 ORBIT INSERT</span></div>' +
      '</div>' +
      '<div class="ci-tip">轻点跳过</div>' +
      '<div class="ci-flash"></div>' +
    '</div>';
  host.appendChild(wrap);

  var nebulaCv = wrap.querySelector('.ci-nebula');
  // 地球画在离屏 WebGL canvas 上，再 drawImage 合成到星云层——
  // 直接叠放两个 canvas 时，部分内核把 WebGL 画布整层按不透明合成，会盖住星云
  var earthCv = document.createElement('canvas');
  var sysEl = document.getElementById('ciSys');
  var planetEl = document.getElementById('ciPlanet');
  var flashEl = wrap.querySelector('.ci-flash');
  var wtrack = document.getElementById('ciWtrack');
  var wpct = document.getElementById('ciWpct');
  var verEl = document.getElementById('ciVer');
  var sysLines = wrap.querySelectorAll('.ci-line[data-i]');
  var verSrc = document.getElementById('splash-ver');
  if (verEl && verSrc) verEl.textContent = verSrc.getAttribute('data-version') || '';

  var SEGN = 24, segs = [], litSegs = -2;
  for (var sg = 0; sg < SEGN; sg++) {
    var e = document.createElement('i');
    wtrack.appendChild(e); segs.push(e);
  }

  var ended = false, raf = 0, t0 = performance.now();
  function seen() { try { sessionStorage.setItem(SEEN_KEY, '1'); } catch (e) {} }
  function finish() {
    if (ended) return;
    ended = true;
    if (!FORCE) seen();
    try { cancelAnimationFrame(raf); } catch (e) {}
    wrap.classList.add('ci-out');
    setTimeout(function () {
      try { freeGL(); } catch (e) {}
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      if (style.parentNode) style.parentNode.removeChild(style);
    }, 600);
  }
  wrap.addEventListener('pointerdown', function (ev) { ev.preventDefault(); finish(); }, { passive: false });
  setTimeout(function () { if (!ended) finish(); }, DURATION);

  // ---------- 2D 星云 ----------
  var nctx = nebulaCv.getContext('2d');
  var W = 0, H = 0, cx = 0, cy = 0;
  function resize2D() {
    var dpr = Math.min(window.devicePixelRatio || 1, lowMem ? 1.25 : 1.75);
    W = Math.max(1, wrap.clientWidth); H = Math.max(1, wrap.clientHeight);
    nebulaCv.width = Math.round(W * dpr); nebulaCv.height = Math.round(H * dpr);
    nctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = H * 0.515;
  }
  resize2D();

  var stars = [], neb = [], FLOW = [
    { r: 0.34, a: 0.12, va: 0.00005, dash: [2, 7], c: '150,220,255' },
    { r: 0.56, a: 0.09, va: -0.00004, dash: [1, 11], c: '255,170,220' }
  ];
  for (var i = 0; i < (lowMem ? 40 : 70); i++) {
    stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 0.9 + 0.3,
      ph: Math.random() * 6.283, sp: 0.0004 + Math.random() * 0.0008 });
  }
  var ARMS = 5, GN = lowMem ? 130 : 200;
  var NCOL = ['255,225,170', '255,170,220', '170,120,255', '110,180,255', '150,220,255'];
  for (var a = 0; a < ARMS; a++) for (var j = 0; j < GN; j++) {
    var t = j / GN;
    neb.push({ t: t, th: a * (6.2832 / ARMS) + t * 3.2 + (Math.random() - 0.5) * 0.3,
      sz: (1 - t) * 2.8 + 1.0, c: NCOL[a % 5], al: 0.30 + Math.random() * 0.36,
      sp: 0.000028 + Math.random() * 0.00002 });
  }
  // 星云团块：沿旋臂分布的柔光云气，让“星云”一眼可见
  var blobs = [];
  for (var bb = 0; bb < (lowMem ? 10 : 16); bb++) {
    var ba = bb % ARMS, bt = 0.10 + Math.random() * 0.85;
    blobs.push({ th: ba * (6.2832 / ARMS) + bt * 3.2 + (Math.random() - 0.5) * 0.30,
      r: 0.30 + bt * 0.60, sz: 0.16 + Math.random() * 0.22,
      c: NCOL[(ba + 2) % 5], al: 0.26 + Math.random() * 0.18 });
  }

  function drawNebula(now) {
    var t = now - t0, reveal = earthReveal(t);
    var md = Math.min(W, H);
    nctx.clearRect(0, 0, W, H);
    nctx.fillStyle = '#02030a';
    nctx.fillRect(0, 0, W, H);
    // 星云底雾：先把整片旋转星云的氛围铺出来
    var hazeR = md * 0.98;
    var hg = nctx.createRadialGradient(cx, cy, md * 0.06, cx, cy, hazeR);
    hg.addColorStop(0, 'rgba(165,115,255,' + (0.30 * (1 - reveal * 0.35)) + ')');
    hg.addColorStop(0.4, 'rgba(70,150,255,' + (0.16 * (1 - reveal * 0.35)) + ')');
    hg.addColorStop(0.75, 'rgba(255,110,200,' + (0.08 * (1 - reveal * 0.35)) + ')');
    hg.addColorStop(1, 'rgba(30,50,120,0)');
    nctx.fillStyle = hg;
    nctx.beginPath(); nctx.ellipse(cx, cy, hazeR, hazeR * 0.62, 0, 0, 6.2832); nctx.fill();
    // 星轨
    for (var fi = 0; fi < FLOW.length; fi++) {
      var fr = FLOW[fi];
      nctx.save(); nctx.translate(cx, cy); nctx.rotate(t * fr.va);
      nctx.strokeStyle = 'rgba(' + fr.c + ',' + (fr.a * (1 - reveal * 0.45)) + ')';
      nctx.lineWidth = 1; nctx.setLineDash(fr.dash); nctx.lineDashOffset = -t * 0.012;
      nctx.beginPath(); nctx.arc(0, 0, md * fr.r, 0, 6.2832); nctx.stroke(); nctx.restore();
    }
    nctx.setLineDash([]);
    // 星云团块（柔光）
    for (var bi = 0; bi < blobs.length; bi++) {
      var bl = blobs[bi];
      var bang = bl.th + t * 0.00008;
      var bx = cx + Math.cos(bang) * bl.r * md;
      var by = cy + Math.sin(bang) * bl.r * md * 0.62;
      var brad = bl.sz * md;
      var bg = nctx.createRadialGradient(bx, by, 0, bx, by, brad);
      var bal = bl.al * (1 - reveal * 0.2);
      bg.addColorStop(0, 'rgba(' + bl.c + ',' + bal + ')');
      bg.addColorStop(0.55, 'rgba(' + bl.c + ',' + (bal * 0.35) + ')');
      bg.addColorStop(1, 'rgba(' + bl.c + ',0)');
      nctx.fillStyle = bg;
      nctx.beginPath(); nctx.arc(bx, by, brad, 0, 6.2832); nctx.fill();
      bl._x = bx; bl._y = by; bl._rad = brad; bl._a = bal;
    }
    // 旋臂粒子
    nctx.globalCompositeOperation = 'lighter';
    for (var k = 0; k < neb.length; k++) {
      var p = neb[k];
      var tt = ((p.t - t * p.sp * 0.06) % 1 + 1) % 1;
      var rr = 14 + tt * tt * md * 0.95;
      var rot = p.th + t * 0.00010 * (1.5 - tt * 0.9);
      var x = cx + Math.cos(rot) * rr, y = cy + Math.sin(rot) * rr * 0.62;
      nctx.globalAlpha = p.al * (0.7 + 0.3 * Math.sin(t * 0.003 + p.t * 9)) * (1 - reveal * 0.2);
      p._x = x; p._y = y; p._a = nctx.globalAlpha;
      nctx.fillStyle = 'rgb(' + p.c + ')';
      nctx.beginPath(); nctx.arc(x, y, p.sz, 0, 6.2832); nctx.fill();
      if (k % 5 === 0) {
        nctx.globalAlpha *= 0.24;
        nctx.beginPath(); nctx.arc(x, y, p.sz * 4.0, 0, 6.2832); nctx.fill();
      }
    }
    // 星核
    nctx.globalAlpha = 1;
    var coreR = md * 0.05 * (1 + 0.06 * Math.sin(t * 0.0018));
    var g = nctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 4.5);
    g.addColorStop(0, 'rgba(255,244,225,' + (0.55 * (1 - reveal * 0.6)) + ')');
    g.addColorStop(0.45, 'rgba(190,170,255,' + (0.18 * (1 - reveal * 0.6)) + ')');
    g.addColorStop(1, 'rgba(120,140,255,0)');
    nctx.fillStyle = g; nctx.beginPath(); nctx.arc(cx, cy, coreR * 4.5, 0, 6.2832); nctx.fill();
    nctx.globalCompositeOperation = 'source-over';
    // 微星
    for (var s = 0; s < stars.length; s++) {
      var st = stars[s];
      nctx.globalAlpha = 0.15 + 0.3 * (0.5 + 0.5 * Math.sin(t * st.sp + st.ph));
      nctx.fillStyle = '#dfeaff';
      nctx.beginPath(); nctx.arc(st.x * W, st.y * H, st.r, 0, 6.2832); nctx.fill();
    }
    nctx.globalAlpha = 1;
  }

  // ---------- WebGL 地球 ----------
  var gl = null, prog = null, texs = [], uni = {};

  function earthReveal(t) {
    // 1.05s 开始浮现，2.15s 到位
    var x = (t - 1050) / 1100;
    x = x < 0 ? 0 : x > 1 ? 1 : x;
    return x * x * (3 - 2 * x);
  }

  function initGL() {
    var opts = { alpha: true, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' };
    gl = earthCv.getContext('webgl', opts) || earthCv.getContext('experimental-webgl', opts);
    if (!gl) return false;
    var vs = 'attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.0,1.0);}';
    var fs = [
      'precision mediump float;',
      'uniform vec2 uRes; uniform float uTime; uniform float uReveal;',
      'uniform sampler2D uDay,uNight,uClouds;',
      'const float PI=3.14159265;',
      'void main(){',
      '  vec2 pix=gl_FragCoord.xy;',
      '  vec2 p=(pix-0.5*uRes)/uRes.y*2.0;',
      '  vec2 c=vec2(0.0,0.03);',
      '  float rev=clamp(uReveal,0.0,1.0);',
      '  float R=mix(0.04,0.40,rev);',
      '  vec2 q=p-c; float d=length(q);',
      '  vec3 col=vec3(0.0); float alpha=0.0;',
      '  if(d<R){',
      '    float z=sqrt(max(0.0,R*R-d*d));',
      '    vec3 n=normalize(vec3(q/R,z/R));',
      '    float a=uTime*0.055; float ca=cos(a),sa=sin(a);',
      '    n.xz=mat2(ca,-sa,sa,ca)*n.xz;',
      '    float lon=atan(n.z,n.x); float lat=asin(clamp(n.y,-1.0,1.0));',
      '    vec2 tuv=vec2(fract(lon/(2.0*PI)+0.5),clamp(0.5-lat/PI,0.0,1.0));',
      '    vec3 day=texture2D(uDay,tuv).rgb;',
      '    vec3 night=texture2D(uNight,tuv).rgb;',
      '    vec3 L=normalize(vec3(-0.58,0.40,0.70));',
      '    float ndl=dot(n,L);',
      '    float lit=smoothstep(-0.10,0.34,ndl);',
      '    vec3 base=mix(night*1.25+day*0.02, day*(0.90+0.30*max(ndl,0.0)), lit);',
      '    vec4 cl=texture2D(uClouds,vec2(fract(tuv.x+uTime*0.0045),tuv.y));',
      '    vec3 ccol=mix(vec3(0.06,0.09,0.16),vec3(1.0),lit);',
      '    base=mix(base,ccol,cl.a*(0.20+0.55*lit));',
      '    float fres=pow(1.0-n.z,2.6);',
      '    base+=vec3(0.22,0.46,1.0)*fres*0.42;',
      '    col=base;',
      '    alpha=rev;',
      '    float rim=smoothstep(R*0.90,R,d);',
      '    col+=vec3(0.5,0.7,1.0)*rim*rev*0.35;',
      '  } else {',
      '    float g=smoothstep(R*1.12,R,d);',
      '    col+=vec3(0.16,0.36,0.85)*g*0.55*rev;',
      '    alpha=g*0.20*rev;',
      '  }',
      '  gl_FragColor=vec4(col*alpha,alpha);',
      '}'
    ].join('\n');
    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { try { console.warn('[cosmos]', gl.getShaderInfoLog(s)); } catch (e) {} gl.deleteShader(s); return null; }
      return s;
    }
    var v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return false;
    prog = gl.createProgram();
    gl.attachShader(prog, v); gl.attachShader(prog, f);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'uDay'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'uNight'), 1);
    gl.uniform1i(gl.getUniformLocation(prog, 'uClouds'), 2);
    uni.uRes = gl.getUniformLocation(prog, 'uRes');
    uni.uTime = gl.getUniformLocation(prog, 'uTime');
    uni.uReveal = gl.getUniformLocation(prog, 'uReveal');
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    return true;
  }
  function uploadTex(img, unit) {
    var tx = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    texs[unit] = tx;
  }
  function freeGL() {
    if (!gl) return;
    for (var i = 0; i < texs.length; i++) { try { gl.deleteTexture(texs[i]); } catch (e) {} }
    try { gl.getExtension('WEBGL_lose_context') && gl.getExtension('WEBGL_lose_context').loseContext(); } catch (e) {}
    gl = null;
  }
  function resizeGL() {
    var dpr = Math.min(window.devicePixelRatio || 1, lowMem ? 1.25 : 1.75);
    var w = Math.max(1, Math.round(W * dpr)), h = Math.max(1, Math.round(H * dpr));
    if (earthCv.width !== w || earthCv.height !== h) {
      earthCv.width = w; earthCv.height = h;
      gl.viewport(0, 0, w, h);
    }
  }
  function texOK() { return texs[0] && texs[1] && texs[2]; }
  function frame(now) {
    if (ended) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    drawNebula(now);
    if (gl && prog && texOK()) {
      resizeGL();
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uni.uRes, earthCv.width, earthCv.height);
      gl.uniform1f(uni.uTime, (now - t0) / 1000);
      gl.uniform1f(uni.uReveal, earthReveal(now - t0));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // 合成到可见的 2D 画布（星云之上、HUD 之下）
      try { nctx.drawImage(earthCv, 0, 0, W, H); } catch (e) {}
      // 前景星尘：让地球像是从星云里浮出来，而不是贴在一块黑布上
      try {
        nctx.save();
        nctx.globalCompositeOperation = 'lighter';
        // 前景云气：地球边缘融进星云，而不是硬贴上去
        for (var gb = 0; gb < blobs.length; gb += 4) {
          var fbl = blobs[gb];
          if (fbl._rad == null) continue;
          var fg = nctx.createRadialGradient(fbl._x, fbl._y, 0, fbl._x, fbl._y, fbl._rad);
          fg.addColorStop(0, 'rgba(' + fbl.c + ',' + (fbl._a * 0.30) + ')');
          fg.addColorStop(1, 'rgba(' + fbl.c + ',0)');
          nctx.globalAlpha = 1;
          nctx.fillStyle = fg;
          nctx.beginPath(); nctx.arc(fbl._x, fbl._y, fbl._rad, 0, 6.2832); nctx.fill();
        }
        for (var fk = 0; fk < neb.length; fk += 6) {
          var fp = neb[fk];
          if (fp._x == null) continue;
          nctx.globalAlpha = Math.min(0.16, fp._a * 0.32);
          nctx.fillStyle = 'rgb(' + fp.c + ')';
          nctx.beginPath(); nctx.arc(fp._x, fp._y, fp.sz * 1.5, 0, 6.2832); nctx.fill();
        }
        nctx.restore();
        nctx.globalAlpha = 1;
      } catch (e) {}
    }
    updateProgress(now - t0);
  }

  if (!initGL()) {
    // 没有 WebGL：保留星云与 HUD，不出现“假球”
    gl = null;
  } else {
    (function load(src, unit) {
      var img = new Image();
      img.onload = function () { try { uploadTex(img, unit); } catch (e) {} };
      img.onerror = function () {};
      img.src = src;
    })('assets/earth-day.jpg', 0);
    (function load(src, unit) {
      var img = new Image();
      img.onload = function () { try { uploadTex(img, unit); } catch (e) {} };
      img.onerror = function () {};
      img.src = src;
    })('assets/earth-night.jpg', 1);
    (function load(src, unit) {
      var img = new Image();
      img.onload = function () { try { uploadTex(img, unit); } catch (e) {} };
      img.onerror = function () {};
      img.src = src;
    })('assets/earth-clouds.png', 2);
  }

  // ---------- HUD 打字机与进度 ----------
  var LINE_TXT = ['系统自检 SYSTEM BOOT', '星图校准 NAVIGATION FIX', '通讯矩阵 RELAY SYNC', '跃迁引擎 WARP DRIVE'];
  var lineState = [0, 0, 0, 0], typer = { li: 0, ci: 0, timer: null };
  function typeTick() {
    typer.timer = null;
    if (typer.li >= 4) return;
    if (!lineState[typer.li]) lineState[typer.li] = 1;
    var el = sysLines[typer.li], span = el.querySelector('.t');
    if (typer.ci === 0) el.classList.add('typing');
    if (typer.ci < LINE_TXT[typer.li].length) {
      span.textContent += LINE_TXT[typer.li].charAt(typer.ci++);
      typer.timer = setTimeout(typeTick, 12 + Math.random() * 18);
    } else {
      el.classList.remove('typing'); el.classList.add('on');
      lineState[typer.li] = 2;
      typer.li++; typer.ci = 0;
      if (typer.li < 4) typer.timer = setTimeout(typeTick, 160 + Math.random() * 140);
    }
  }
  typer.timer = setTimeout(typeTick, 180);

  function renderSegs(v) {
    var n = Math.floor(v / 100 * SEGN);
    if (n === litSegs) return;
    litSegs = n;
    for (var i = 0; i < SEGN; i++) {
      segs[i].className = i < n ? 'on' : (i === n && n < SEGN ? 'now' : '');
    }
  }
  var lastPct = -1, planetShown = false;
  function updateProgress(t) {
    // 0 ~ 2.05s 缓动到 100%，之后保持
    var x = t / 2050; x = x < 0 ? 0 : x > 1 ? 1 : x;
    var v = Math.round((x * x * (3 - 2 * x)) * 100);
    if (v !== lastPct) {
      lastPct = v;
      renderSegs(v);
      wpct.textContent = v + '%';
    }
    if (!planetShown && v >= 92) {
      planetShown = true;
      planetEl.classList.add('show');
      sysEl.style.opacity = '0.35';
    }
    if (v >= 100 && !flashEl.classList.contains('go') && t > 2150) {
      flashEl.classList.add('go');
    }
  }
  if (verEl) verEl.textContent = verEl.textContent || '';

  window.addEventListener('resize', resize2D);
  window.addEventListener('orientationchange', resize2D);
  // 调试用：读取离屏地球画布的像素/alpha
  window.__cosmosDebug = { earth: earthCv, neb: nebulaCv, gl: function () { return gl; } };
  raf = requestAnimationFrame(frame);
})();
