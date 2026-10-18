/* ===== 开屏片头 · 深空地球（二改）=====
   · 2.6 秒自动淡出，点击任意处跳过；每个会话只播一次；reduced-motion 直接跳过
   · 裸 WebGL 片元着色器画真球体：经纬贴图 → 昼夜晨昏线 → 云层 → 菲涅尔大气
   · 贴图：src/assets/earth-day.jpg / earth-night.jpg / earth-clouds.png（构建复制到 assets/）
   · 纯装饰：不阻塞数据加载，也不参与进入闸门（公告在设置里单独查看）
*/
(function () {
  'use strict';

  var SEEN_KEY = 'mochi-cosmos-seen';
  // 调试：?cosmos=long 强制播放 12 秒并跳过“本次会话已看过”判断
  var FORCE = false, LONG = false;
  try {
    FORCE = /(^|[?&])cosmos=(1|long)(&|$)/.test(location.search);
    LONG = /(^|[?&])cosmos=long(&|$)/.test(location.search);
  } catch (e) {}
  var DURATION = LONG ? 12000 : 2600;

  if (!FORCE) {
    try {
      if (sessionStorage.getItem(SEEN_KEY) === '1') return;
    } catch (e) {}
  }
  try {
    if (matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  } catch (e) {}
  if (document.hidden) return;

  var host = document.querySelector('.phone') || document.body;
  if (!host) return;

  var gl = null, canvas = null, prog = null, textures = [], raf = 0, t0 = 0, ended = false;
  var uniforms = {};
  var lowMem = false;
  try { lowMem = !!(navigator.deviceMemory && navigator.deviceMemory <= 4); } catch (e) {}

  // ---------- 样式与 HUD ----------
  var style = document.createElement('style');
  style.id = 'cosmos-intro-css';
  style.textContent = [
    '#cosmos-intro{position:absolute;inset:0;z-index:9998;background:#03050a;overflow:hidden;',
    '  opacity:1;transition:opacity .5s ease;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;}',
    '#cosmos-intro.ci-out{opacity:0;pointer-events:none;}',
    '#cosmos-intro canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}',
    '#cosmos-intro .ci-hud{position:absolute;inset:0;pointer-events:none;color:#eaf2ff;}',
    '#cosmos-intro .ci-brand{position:absolute;left:24px;top:calc(22px + env(safe-area-inset-top,0px));',
    '  font-size:15px;letter-spacing:7px;font-weight:600;text-shadow:0 0 18px rgba(160,200,255,.55);}',
    '#cosmos-intro .ci-sub{position:absolute;left:24px;bottom:calc(74px + env(safe-area-inset-bottom,0px));',
    '  font-size:11px;letter-spacing:2px;color:rgba(200,220,250,.72);}',
    '#cosmos-intro .ci-sub i{font-style:normal;animation:ciBlink 1.4s infinite;}',
    '@keyframes ciBlink{50%{opacity:.25;}}',
    '#cosmos-intro .ci-bar{position:absolute;left:24px;right:24px;bottom:calc(52px + env(safe-area-inset-bottom,0px));',
    '  height:2px;background:rgba(190,215,255,.14);border-radius:2px;overflow:hidden;}',
    '#cosmos-intro .ci-bar b{display:block;height:100%;width:100%;transform-origin:left center;',
    '  background:linear-gradient(90deg,#7fb6ff,#d7e7ff);box-shadow:0 0 10px rgba(140,190,255,.7);',
    '  animation:ciBar ' + DURATION + 'ms linear forwards;}',
    '@keyframes ciBar{from{transform:scaleX(0);}to{transform:scaleX(1);}}',
    '#cosmos-intro .ci-tip{position:absolute;right:24px;bottom:calc(74px + env(safe-area-inset-bottom,0px));',
    '  font-size:10px;letter-spacing:1px;color:rgba(190,210,240,.45);}'
  ].join('');
  document.head.appendChild(style);

  var wrap = document.createElement('div');
  wrap.id = 'cosmos-intro';
  wrap.innerHTML =
    '<canvas></canvas>' +
    '<div class="ci-hud">' +
      '<div class="ci-brand">MOCHI</div>' +
      '<div class="ci-sub">正在接入轨道<i>…</i></div>' +
      '<div class="ci-bar"><b></b></div>' +
      '<div class="ci-tip">轻点跳过</div>' +
    '</div>';
  host.appendChild(wrap);
  canvas = wrap.querySelector('canvas');

  function seen() {
    try { sessionStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
  }
  function finish() {
    if (ended) return;
    ended = true;
    if (!FORCE) seen();
    try { cancelAnimationFrame(raf); } catch (e) {}
    wrap.classList.add('ci-out');
    setTimeout(function () {
      try {
        if (gl) {
          for (var i = 0; i < textures.length; i++) gl.deleteTexture(textures[i]);
          gl.getExtension('WEBGL_lose_context') && gl.getExtension('WEBGL_lose_context').loseContext();
        }
      } catch (e) {}
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      if (style.parentNode) style.parentNode.removeChild(style);
    }, 550);
  }
  wrap.addEventListener('pointerdown', function (e) { e.preventDefault(); finish(); }, { passive: false });
  setTimeout(function () { if (!ended) finish(); }, DURATION);

  // ---------- WebGL ----------
  function initGL() {
    var opts = { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
    gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) return false;

    var vs = 'attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.0,1.0);}';
    var fs = [
      'precision mediump float;',
      'uniform vec2 uRes; uniform float uTime;',
      'uniform sampler2D uDay,uNight,uClouds;',
      'const float PI=3.14159265;',
      'float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}',
      'void main(){',
      '  vec2 pix=gl_FragCoord.xy;',
      '  vec2 p=(pix-0.5*uRes)/uRes.y*2.0;',
      '  vec2 c=vec2(0.0,0.045);',
      '  float R=0.74;',
      '  vec2 q=p-c; float d=length(q);',
      '  vec3 col=vec3(0.008,0.012,0.028);',
      // 星点（低频避免闪烁过密）
      '  float s=hash(floor(pix*0.5));',
      '  float tw=0.6+0.4*sin(uTime*1.7+hash(floor(pix*0.25))*30.0);',
      '  col+=step(0.9987,s)*vec3(0.72,0.82,1.0)*tw;',
      '  col+=vec3(0.02,0.04,0.09)*smoothstep(1.35,0.0,d);',
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
      '    float ca2=cl.a;',
      '    vec3 ccol=mix(vec3(0.06,0.09,0.16),vec3(1.0),lit);',
      '    base=mix(base,ccol,ca2*(0.20+0.55*lit));',
      '    float fres=pow(1.0-n.z,2.6);',
      '    base+=vec3(0.22,0.46,1.0)*fres*0.42;',
      '    col=base;',
      '  } else {',
      '    col+=vec3(0.16,0.36,0.85)*smoothstep(R*1.24,R,d)*0.38;',
      '  }',
      '  col*=1.0-0.28*smoothstep(0.55,1.85,d);',
      '  col=pow(max(col,vec3(0.0)),vec3(0.86));',
      '  gl_FragColor=vec4(col,1.0);',
      '}'
    ].join('\n');

    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
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
    uniforms.uRes = gl.getUniformLocation(prog, 'uRes');
    uniforms.uTime = gl.getUniformLocation(prog, 'uTime');
    return true;
  }

  function uploadTex(img, unit) {
    var t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    textures[unit] = t;
  }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, lowMem ? 1.25 : 1.75);
    var w = Math.max(1, Math.round(wrap.clientWidth * dpr));
    var h = Math.max(1, Math.round(wrap.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }

  function loop(now) {
    if (ended) return;
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    resize();
    gl.clearColor(0.008, 0.012, 0.028, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (gl && prog) {
      gl.uniform2f(uniforms.uRes, canvas.width, canvas.height);
      gl.uniform1f(uniforms.uTime, (now - t0) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  var pending = 0, ready = false;
  function loadTex(src, unit) {
    pending++;
    var img = new Image();
    img.onload = function () {
      pending--;
      try { if (gl) uploadTex(img, unit); } catch (e) {}
      if (pending === 0) ready = true;
    };
    img.onerror = function () {
      pending--;
      // 任一贴图缺失：整段片头直接跳过，避免出现“假球”
      if (unit === 0) finish();
    };
    img.src = src;
  }

  if (!initGL()) { finish(); return; }
  t0 = performance.now();
  resize();
  loadTex('assets/earth-day.jpg', 0);
  loadTex('assets/earth-night.jpg', 1);
  loadTex('assets/earth-clouds.png', 2);
  // 贴图未齐时也先把星空与大气跑起来
  raf = requestAnimationFrame(loop);
})();
