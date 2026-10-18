(function () { try {
/* ===== 开屏片头 · 星云跃迁（二改）=====
· 星点旋涡星云 + 星轨 + 飞船系统自检 HUD + 跃迁进度
· 加载驱动：98 个脚本占 80%，IndexedDB 数据回填占 20%；地球由远及近放大
· 进度满后停留约 0.9 秒淡出；点击任意处＝登陆；每会话一次；reduced-motion 直接跳过
· 贴图：src/assets/earth-day.jpg / earth-night.jpg / earth-clouds.png（构建复制到 assets/）
· 纯装饰：不阻塞数据加载，不参与进入闸门；公告仍在设置里单独查看
· 调试：?cosmos=long 播完后定格 60 秒；?cosmos=slow 时间与进度放慢 4 倍，方便逐帧看构图
*/
(function () {
'use strict';
var SEEN_KEY = 'mochi-cosmos-seen';
var FORCE = false, LONG = false, SLOW = false, FREEZE = -1;
try {
FORCE = /(^|[?&])cosmos=(1|long|slow|freeze)(&|$)/.test(location.search);
LONG = /(^|[?&])cosmos=long(&|$)/.test(location.search);
SLOW = /(^|[?&])cosmos=slow(&|$)/.test(location.search);
if (/[?&]cosmos=freeze(&|$)/.test(location.search)) {
var fm = /[?&]p=(\d+)/.exec(location.search);
FREEZE = fm ? Math.max(0, Math.min(100, +fm[1])) : 55;
}
} catch (e) {}
var DURATION = (LONG || SLOW || FREEZE >= 0) ? 60000 : 90000;
var TIME_SCALE = SLOW ? 4 : 1;
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
'<div class="ci-line on gold"><span class="t">发现目标星球 EARTH · SOL-3</span></div>' +
'<div class="ci-line on gold"><span class="t">轨道注入 ORBIT INSERT</span></div>' +
'</div>' +
'<div class="ci-tip">点击登陆</div>' +
'<div class="ci-flash"></div>' +
'</div>';
host.appendChild(wrap);
var nebulaCv = wrap.querySelector('.ci-nebula');
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
var nctx = nebulaCv.getContext('2d');
var fgCv = document.createElement('canvas'); // 前景星云：一开始完全盖住地球
var fctx = fgCv.getContext('2d');
var W = 0, H = 0, cx = 0, cy = 0;
function resize2D() {
var dpr = Math.min(window.devicePixelRatio || 1, lowMem ? 1.25 : 1.75);
W = Math.max(1, wrap.clientWidth); H = Math.max(1, wrap.clientHeight);
nebulaCv.width = Math.round(W * dpr); nebulaCv.height = Math.round(H * dpr);
nctx.setTransform(dpr, 0, 0, dpr, 0, 0);
fgCv.width = nebulaCv.width; fgCv.height = nebulaCv.height;
fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
cx = W / 2; cy = H * 0.515;
}
resize2D();
var stars = [], neb = [], FLOW = [
{ r: 0.36, a: 0.05, va: 0.000035, dash: [2, 9], c: '150,220,255' },
{ r: 0.58, a: 0.04, va: -0.000028, dash: [1, 13], c: '255,170,220' }
];
for (var i = 0; i < (lowMem ? 70 : 120); i++) {
stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 0.9 + 0.25,
ph: Math.random() * 6.283, sp: 0.0004 + Math.random() * 0.0008 });
}
var ARMS = 5, GN = lowMem ? 480 : 820;
function nebColor(tt) {
var r, g, b;
if (tt < 0.24) { r = 255; g = 236; b = 198; }
else if (tt < 0.52) { r = 178; g = 212; b = 255; }
else if (tt < 0.78) { r = 255; g = 172; b = 222; }
else { r = 168; g = 140; b = 255; }
var j = Math.round((Math.random() - 0.5) * 16);
r = Math.max(0, Math.min(255, r + j));
g = Math.max(0, Math.min(255, g + j));
b = Math.max(0, Math.min(255, b + j));
return r + ',' + g + ',' + b;
}
for (var a = 0; a < ARMS; a++) for (var j = 0; j < GN; j++) {
var tt = Math.pow(Math.random(), 1.40);
var field = Math.random() < 0.35;
var jit = (Math.random() - 0.5) * (0.20 + tt * 0.52);
if (field) jit += (Math.random() - 0.5) * 2.3;
neb.push({ t: tt, th: a * (6.2832 / ARMS) + tt * 5.0 + jit,
sz: 0.55 + Math.random() * (field ? 1.0 : 1.5),
c: nebColor(tt), al: (0.38 + Math.random() * 0.55) * (1.12 - 0.24 * tt),
sp: 0.000010 * (0.30 + 1.25 / (0.18 + tt)),
ph: Math.random() * 6.283, big: Math.random() < 0.10 });
}
function drawNebula(t, prog) {
var md = Math.min(W, H), zoom = 1 + prog * 0.35;
nctx.clearRect(0, 0, W, H);
nctx.fillStyle = '#02030a';
nctx.fillRect(0, 0, W, H);
var hr = md * 0.92 * zoom;
var hg = nctx.createRadialGradient(cx, cy, md * 0.02, cx, cy, hr);
hg.addColorStop(0, 'rgba(150,170,255,0.10)');
hg.addColorStop(0.42, 'rgba(120,100,215,0.055)');
hg.addColorStop(0.78, 'rgba(220,120,200,0.025)');
hg.addColorStop(1, 'rgba(30,40,90,0)');
nctx.fillStyle = hg;
nctx.beginPath(); nctx.ellipse(cx, cy, hr, hr * 0.58, 0, 0, 6.2832); nctx.fill();
for (var fi = 0; fi < FLOW.length; fi++) {
var fr = FLOW[fi];
nctx.save(); nctx.translate(cx, cy); nctx.rotate(t * fr.va);
nctx.strokeStyle = 'rgba(' + fr.c + ',' + fr.a + ')';
nctx.lineWidth = 1; nctx.setLineDash(fr.dash); nctx.lineDashOffset = -t * 0.012;
nctx.beginPath(); nctx.arc(0, 0, md * fr.r * zoom, 0, 6.2832); nctx.stroke(); nctx.restore();
}
nctx.setLineDash([]);
nctx.globalCompositeOperation = 'lighter';
for (var k = 0; k < neb.length; k++) {
var p = neb[k];
var rot = p.th + t * p.sp;
var rr = (0.05 + p.t * 1.42) * md * zoom;
var x = cx + Math.cos(rot) * rr;
var y = cy + Math.sin(rot) * rr * 0.78;
var tw = 0.70 + 0.30 * Math.sin(t * 0.0016 + p.ph);
nctx.globalAlpha = Math.min(0.92, p.al * tw);
nctx.fillStyle = 'rgb(' + p.c + ')';
var sz = p.sz;
if (sz > 1.35) { nctx.beginPath(); nctx.arc(x, y, sz, 0, 6.2832); nctx.fill(); }
else { nctx.fillRect(x - sz * 0.5, y - sz * 0.5, sz, sz); }
if (p.big) {
nctx.globalAlpha *= 0.18;
nctx.beginPath(); nctx.arc(x, y, sz * 3.6, 0, 6.2832); nctx.fill();
}
}
nctx.globalAlpha = 1;
var coreR = md * 0.035;
var g = nctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 5.0);
g.addColorStop(0, 'rgba(255,248,232,0.50)');
g.addColorStop(0.35, 'rgba(210,190,255,0.16)');
g.addColorStop(1, 'rgba(120,140,255,0)');
nctx.fillStyle = g; nctx.beginPath(); nctx.arc(cx, cy, coreR * 5.0, 0, 6.2832); nctx.fill();
nctx.globalCompositeOperation = 'source-over';
for (var s = 0; s < stars.length; s++) {
var st = stars[s];
var sx = cx + (st.x * W - cx) * (1 + prog * 0.06);
var sy = cy + (st.y * H - cy) * (1 + prog * 0.06);
nctx.globalAlpha = 0.14 + 0.30 * (0.5 + 0.5 * Math.sin(t * st.sp + st.ph));
nctx.fillStyle = '#dfeaff';
nctx.beginPath(); nctx.arc(sx, sy, st.r, 0, 6.2832); nctx.fill();
}
nctx.globalAlpha = 1;
}
function smooth01(x) { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); }
function drawVeil(t, prog) {
var veilA = 1 - smooth01((prog - 0.42) / 0.48); // 0.42 前全遮，0.90 散尽
if (veilA <= 0.02) return;
var md = Math.min(W, H), diag = Math.sqrt(W * W + H * H);
var zoom = 1.55 + prog * 1.35;
fctx.setTransform(1, 0, 0, 1, 0, 0);
var dpr = nebulaCv.width / Math.max(1, W);
fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
fctx.clearRect(0, 0, W, H);
fctx.fillStyle = 'rgba(7,8,20,0.97)';
fctx.fillRect(0, 0, W, H);
var clouds = [
{ x: cx - W * 0.22, y: cy - H * 0.10, r: md * 0.95, c: '116,70,168', a: 0.38 },
{ x: cx + W * 0.26, y: cy + H * 0.08, r: md * 0.85, c: '42,92,170', a: 0.34 },
{ x: cx + W * 0.05, y: cy - H * 0.16, r: md * 0.75, c: '190,80,160', a: 0.20 }
];
for (var ci = 0; ci < clouds.length; ci++) {
var cl = clouds[ci];
var cg = fctx.createRadialGradient(cl.x, cl.y, 0, cl.x, cl.y, cl.r);
cg.addColorStop(0, 'rgba(' + cl.c + ',' + cl.a + ')');
cg.addColorStop(1, 'rgba(' + cl.c + ',0)');
fctx.fillStyle = cg;
fctx.beginPath(); fctx.arc(cl.x, cl.y, cl.r, 0, 6.2832); fctx.fill();
}
fctx.globalCompositeOperation = 'lighter';
for (var k = 0; k < neb.length; k += 2) {
var p = neb[k];
var rot = p.th + t * p.sp;
var rr = (0.05 + p.t * 1.05) * md * zoom;
var x = cx + Math.cos(rot) * rr;
var y = cy + Math.sin(rot) * rr * 0.78;
if (x < -60 || x > W + 60 || y < -60 || y > H + 60) continue;
var tw = 0.75 + 0.25 * Math.sin(t * 0.0018 + p.ph);
fctx.globalAlpha = Math.min(0.95, p.al * tw * 1.10);
fctx.fillStyle = 'rgb(' + p.c + ')';
var sz = p.sz * 1.5;
if (sz > 1.4) { fctx.beginPath(); fctx.arc(x, y, sz, 0, 6.2832); fctx.fill(); }
else { fctx.fillRect(x - sz * 0.5, y - sz * 0.5, sz, sz); }
}
fctx.globalCompositeOperation = 'source-over';
fctx.globalAlpha = 1;
var hx = Math.max(0, Math.min(1, (prog - 0.30) / 0.45));
var holeR = smooth01(hx) * diag * 0.72;
if (holeR > 2) {
fctx.globalCompositeOperation = 'destination-out';
var hg = fctx.createRadialGradient(cx, cy, 0, cx, cy, holeR);
hg.addColorStop(0, 'rgba(0,0,0,1)');
hg.addColorStop(0.62, 'rgba(0,0,0,1)');
hg.addColorStop(1, 'rgba(0,0,0,0)');
fctx.fillStyle = hg;
fctx.beginPath(); fctx.arc(cx, cy, holeR, 0, 6.2832); fctx.fill();
fctx.globalCompositeOperation = 'source-over';
}
nctx.save();
nctx.globalAlpha = veilA;
try { nctx.drawImage(fgCv, 0, 0, W, H); } catch (e) {}
nctx.restore();
}
var gl = null, prog = null, texs = [], uni = {};
function earthReveal(prog) {
var x = Math.max(0, Math.min(1, (prog - 0.01) / 0.99));
return 0.05 + 0.95 * (x * x * (3 - 2 * x));
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
'  float R=mix(0.05,0.40,rev);',
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
'    vec3 ccol=mix(vec3(0.09,0.10,0.12),vec3(1.0),lit);',
'    base=mix(base,ccol,cl.a*(0.20+0.55*lit));',
'    float fres=pow(1.0-n.z,2.6);',
'    base+=vec3(0.28,0.42,0.62)*fres*0.10;',
'    col=base;',
'    alpha=1.0;',
'    float rim=smoothstep(R*0.90,R,d);',
'    col+=vec3(0.5,0.7,0.9)*rim*rev*0.05;',
'  } else {',
'    float g=smoothstep(R*1.12,R,d);',
'    col+=vec3(0.22,0.40,0.62)*g*0.18*rev;',
'    alpha=g*0.06*rev;',
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
function loadTarget() {
var expected = 0, loaded = 0, errs = 0, fails = 0;
try {
expected = (window.__mochiJsFiles || []).length;
loaded = (window.__mochiLoaded || []).length;
errs = (window.__mochiErrLoaded || []).length;
fails = (window.__mochiExtFail || []).length;
} catch (e) {}
var scripts = expected ? Math.min(1, (loaded + errs + fails) / expected) : 1;
var data = window.__mochiDataReady ? 1 : 0;
return Math.min(1, scripts * 0.80 + data * 0.20);
}
var shownPct = 0, lastFrameAt = 0, lastPct = -1, planetShown = false, planetAt = 0, slowHinted = false;
var LOAD_RATE = SLOW ? 10 : 60; // 每秒最多推进的百分比：加载再快也留出飞行时间
function frame(now) {
if (ended) return;
raf = requestAnimationFrame(frame);
if (document.hidden) return;
var st = (now - t0) / TIME_SCALE;
var dt = lastFrameAt ? Math.min(150, now - lastFrameAt) : 16;
lastFrameAt = now;
var target = FREEZE >= 0 ? FREEZE : loadTarget() * 100;
if (target > shownPct) shownPct = Math.min(target, shownPct + LOAD_RATE * dt / 1000);
var prog = shownPct / 100;
drawNebula(st, prog);
if (gl && texOK()) {
resizeGL();
gl.clear(gl.COLOR_BUFFER_BIT);
gl.uniform2f(uni.uRes, earthCv.width, earthCv.height);
gl.uniform1f(uni.uTime, st / 1000);
gl.uniform1f(uni.uReveal, earthReveal(prog));
gl.drawArrays(gl.TRIANGLES, 0, 3);
try { nctx.drawImage(earthCv, 0, 0, W, H); } catch (e) {}
}
drawVeil(st, prog);
updateProgress(st, prog);
}
if (!initGL()) {
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
var LINE_TXT = ['系统自检 SYSTEM BOOT', '星图校准 NAVIGATION FIX', '通讯矩阵 RELAY SYNC', '跃迁引擎 WARP DRIVE'];
var LINE_AT = [0, 26, 52, 78]; // 四行自检跟着真实加载进度逐行打出
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
if (typer.li < 4) typer.timer = setTimeout(function () { typer.timer = null; maybeType(); }, 160);
}
}
function maybeType() {
if (typer.timer || typer.li >= 4) return;
if (lastPct < LINE_AT[typer.li]) return;
typeTick();
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
function updateProgress(st, prog) {
var v = Math.round(prog * 100);
if (v !== lastPct) {
lastPct = v;
renderSegs(v);
wpct.textContent = v + '%';
maybeType();
}
if (!planetShown && v >= 100) {
planetShown = true;
planetAt = st;
planetEl.classList.add('show');
sysEl.style.opacity = '0.35';
flashEl.classList.add('go');
}
if (!slowHinted && window.__mochiDataSlow) {
slowHinted = true;
var tp = wrap.querySelector('.ci-tip');
if (tp) tp.textContent = '数据回填较慢 · 点击登陆';
}
if (planetShown && FREEZE < 0 && !LONG && !SLOW && st - planetAt > 900) finish();
}
if (verEl) verEl.textContent = verEl.textContent || '';
window.addEventListener('resize', resize2D);
window.addEventListener('orientationchange', resize2D);
window.__cosmosDebug = { earth: earthCv, neb: nebulaCv, gl: function () { return gl; } };
raf = requestAnimationFrame(frame);
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("splash-cosmos.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("splash-cosmos.js"); try { console.error("[JS] splash-cosmos.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[splash-cosmos.js] " + String(__e && __e.message || __e)); } })();