// ===== 吧台：Canvas 2D 轻写实绘制引擎（杯具 / 液体 / 气泡 / 冰块 / 摇晃动效）=====
// 设计约束（对齐吧台规格 3.1）：禁止任何 3D 库与外部贴图；纯 Canvas 2D 程序化绘制；
// 必须提供 prefers-reduced-motion / 低端设备降级路径。
// 对外接口：window.BarRender = { mixLiquidColor, detectVessel, createStage }
(function () {
  'use strict';

  // ============ 颜色工具 ============
  function hexToRgb(hex) {
    var h = String(hex == null ? '' : hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return { r: 200, g: 200, b: 200 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2, d = max - min;
    if (d) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: h, s: s * 100, l: l * 100 };
  }
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360; s /= 100; l /= 100;
    if (!s) { var v = Math.round(l * 255); return { r: v, g: v, b: v }; }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return {
      r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      g: Math.round(hue2rgb(p, q, h) * 255),
      b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
    };
  }
  function shade(c, dl) {
    var hsl = rgbToHsl(c.r, c.g, c.b);
    hsl.l = Math.max(0, Math.min(100, hsl.l + dl * 100));
    return hslToRgb(hsl.h, hsl.s, hsl.l);
  }
  function rgbCss(c, a) {
    return a == null ? 'rgb(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ')'
      : 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // ============ 液体混色（规格 3.10，必须经 HSL 提饱和 + 钳亮度）============
  var ROLE_WEIGHT = { base: 1.0, main: 1.2, modifier: 0.5, addon: 0.3 };
  function mixLiquidColor(ings) {
    ings = ings || [];
    if (!ings.length) return { r: 238, g: 238, b: 238 };
    var wr = 0, wg = 0, wb = 0, wt = 0;
    for (var i = 0; i < ings.length; i++) {
      var it = ings[i];
      if (!it) continue;
      var c = hexToRgb(it.color);
      var w = ROLE_WEIGHT[it.role] || 1;
      wr += c.r * w; wg += c.g * w; wb += c.b * w; wt += w;
    }
    if (!wt) return { r: 238, g: 238, b: 238 };
    var hsl = rgbToHsl(wr / wt, wg / wt, wb / wt);   // 1. RGB 加权平均 → 2. 转 HSL
    hsl.s = Math.min(100, hsl.s + 10);                // 3. 饱和 +10
    hsl.l = clamp(hsl.l, 35, 75);                     // 4. 亮度钳制
    return hslToRgb(hsl.h, hsl.s, hsl.l);             // 5. 转回 RGB
  }

  // ============ 器具判定（规格 3.3，优先级从上到下）============
  // families 可选＝本轮出现过的全部基底 family（合成物会丢掉 family 信息，靠它兜底）
  function detectVessel(ings, families) {
    var set = {};
    (families || []).forEach(function (f) { if (f) set[f] = 1; });
    (ings || []).forEach(function (it) {
      if (!it) return;
      if (it.family) set[it.family] = 1;
      if (it.families) it.families.forEach(function (f) { if (f) set[f] = 1; });
    });
    if (set.alcohol) return 'shaker';
    if (set.tea && set.milk) return 'milktea';
    return 'glass';
  }

  // ============ 关键参数（规格 3.9）============
  var RIM_RATIO = 0.22, CUP_H_RATIO = 0.62, BOT_RATIO = 0.72;
  var BASE_FILL = 0.15, PER_ING = 0.18;
  var BUBBLE_MAX = 28, TAU = Math.PI * 2;
  var DEG = Math.PI / 180;

  function prefersReduce() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }

  function createStage(canvas) {
    if (!canvas || !canvas.getContext) return null;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;

    var st = {
      w: 300, h: 260, dpr: 1,
      vessel: 'glass',
      ings: [],
      families: [],
      liquid: { r: 232, g: 232, b: 232 },
      target: { r: 232, g: 232, b: 232 },
      fill: BASE_FILL, rfill: 0,
      phase: 'idle', anim: null,
      foam: 0, frost: 0, lid: 1,
      bubbles: [], bobas: 0, ice: 0,
      reduced: prefersReduce(), degrade: false, slowFrames: 0,
      rafId: 0, running: false, lastT: 0, lastDraw: 0, destroyed: false
    };

    // ---------- 尺寸/DPR ----------
    function resize() {
      var cw = canvas.clientWidth || 300;
      var ch = canvas.clientHeight || 260;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      st.w = cw; st.h = ch; st.dpr = dpr;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildBubbles();
    }

    function geom() {
      var rimR = st.w * RIM_RATIO;
      var cupH = st.h * CUP_H_RATIO;
      var botR = rimR * BOT_RATIO;
      var cx = st.w / 2;
      var rimY = (st.h - cupH) / 2;
      return { rimR: rimR, cupH: cupH, botR: botR, cx: cx, rimY: rimY, botY: rimY + cupH };
    }
    function halfW(y, g) {
      var t = clamp((y - g.rimY) / g.cupH, 0, 1);
      return g.rimR + (g.botR - g.rimR) * t;
    }

    // ---------- 气泡 ----------
    function buildBubbles() {
      var n = Math.min(BUBBLE_MAX, 8 + st.ings.length * 4);
      if (st.reduced || st.degrade) n = 0;
      st.bubbles = [];
      for (var i = 0; i < n; i++) {
        st.bubbles.push({
          x: Math.random(), y: Math.random(),
          r: 1.5 + Math.random() * 2.5,
          sp: 0.4 + Math.random() * 0.8,
          ph: Math.random() * TAU
        });
      }
    }

    // ---------- 状态写入 ----------
    function setIngredients(ings, families) {
      st.ings = (ings || []).slice();
      st.families = (families || []).slice();
      st.target = mixLiquidColor(st.ings);
      st.vessel = detectVessel(st.ings, st.families);
      st.fill = clamp(BASE_FILL + st.ings.length * PER_ING, BASE_FILL, 0.9);
      st.bobas = Math.min(8, st.ings.filter(function (i) { return i.role === 'addon'; }).length * 2);
      st.ice = (st.vessel !== 'milktea' && st.ings.length >= 2) ? 2 : 0;
      buildBubbles();
      if (!st.rfill) st.rfill = st.fill;
    }
    function setReduced(v) { st.reduced = !!v; buildBubbles(); }

    // ---------- 动画驱动 ----------
    function playShake(vessel) {
      return drive('shake', vessel === 'shaker' ? 1600 : (vessel === 'milktea' ? 1500 : 0), function () {
        if (st.reduced) return 0;
        if (vessel === 'glass') return 0;
        st.vessel = vessel;
        return vessel === 'shaker' ? 1600 : 1500;
      });
    }
    function playPour() { return drive('pour', st.reduced ? 0 : 350); }
    function playAbsorb() { return drive('absorb', st.reduced ? 200 : 600); }

    function drive(type, dur, setup) {
      if (typeof setup === 'function') dur = setup();
      return new Promise(function (resolve) {
        if (st.destroyed) { resolve(); return; }
        if (!dur || st.reduced) {
          if (type === 'shake' && st.vessel === 'milktea' && !st.reduced) st.foam = 1;
          resolve(); return;
        }
        st.anim = { type: type, t: 0, dur: dur, resolve: resolve };
        st.phase = type;
        start();
      });
    }

    // ---------- 每帧更新 ----------
    function update(dt) {
      // 液体颜色缓动（平滑过渡，避免突兀跳色）
      st.liquid.r = lerp(st.liquid.r, st.target.r, Math.min(1, dt / 160));
      st.liquid.g = lerp(st.liquid.g, st.target.g, Math.min(1, dt / 160));
      st.liquid.b = lerp(st.liquid.b, st.target.b, Math.min(1, dt / 160));
      // 液面缓动
      st.rfill = lerp(st.rfill, st.fill, Math.min(1, dt / 220));
      // 泡沫消退
      if (st.foam > 0 && st.phase !== 'shake') st.foam = Math.max(0, st.foam - dt / 2000);
      // 气泡上浮
      if (!st.reduced && !st.degrade && st.phase !== 'shake') {
        for (var i = 0; i < st.bubbles.length; i++) {
          var b = st.bubbles[i];
          b.y -= (b.sp * dt) / 900;
          if (b.y < 0.02) { b.y = 0.98; b.x = Math.random(); }
        }
      }
      // 动画推进
      if (st.anim) {
        st.anim.t += dt;
        var a = st.anim;
        if (a.type === 'shake') {
          if (st.vessel === 'shaker') st.frost = Math.min(1 / 3, (a.t / a.dur) * (1 / 3));
        }
        if (a.t >= a.dur) {
          var done = a.resolve;
          if (a.type === 'shake') {
            if (st.vessel === 'shaker') { st.frost = 1 / 3; }
            if (st.vessel === 'milktea') { st.foam = 1; }
          }
          st.anim = null; st.phase = 'idle'; done && done();
        }
      }
    }

    // ---------- 摇晃变换 ----------
    function shakeTransform(g) {
      var a = st.anim;
      if (!a || a.type !== 'shake') return;
      var p = a.t / a.dur;
      if (st.vessel === 'shaker') {
        var ang = Math.sin((a.t / 400) * TAU) * 12 * DEG;   // 400ms 来回 ×4
        ctx.translate(g.cx, g.botY); ctx.rotate(ang); ctx.translate(-g.cx, -g.botY);
        var sq = 1 - 0.01 * Math.abs(Math.sin((a.t / 400) * TAU)); // 端点轻微压扁
        ctx.translate(g.cx, g.botY); ctx.scale(1, sq); ctx.translate(-g.cx, -g.botY);
      } else if (st.vessel === 'milktea') {
        var dy = Math.sin((a.t / 250) * TAU) * (g.cupH * 0.08); // 250ms 来回 ×6
        ctx.translate(0, dy);
      }
      void p;
    }

    // ---------- 绘制层（规格 3.4 顺序）----------
    function drawBackGlow(g) {
      var c = st.liquid;
      var grad = ctx.createRadialGradient(g.cx, g.botY - g.cupH * 0.4, 4, g.cx, g.botY - g.cupH * 0.4, g.cupH * 1.1);
      grad.addColorStop(0, rgbCss(c, 0.15));
      grad.addColorStop(1, rgbCss(c, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, st.w, st.h);
    }

    function liquidTopY(g) {
      var top = g.botY - g.cupH * st.rfill;
      return clamp(top, g.rimY + 6, g.botY - 4);
    }
    function pathLiquid(g, topY) {
      ctx.beginPath();
      ctx.moveTo(g.cx - halfW(topY, g), topY);
      ctx.lineTo(g.cx - g.botR, g.botY);
      ctx.ellipse(g.cx, g.botY, g.botR, g.botR * 0.28, 0, Math.PI, 0, true);
      ctx.lineTo(g.cx + halfW(topY, g), topY);
      ctx.ellipse(g.cx, topY, halfW(topY, g), halfW(topY, g) * 0.28, 0, 0, Math.PI, false);
      ctx.closePath();
    }

    function drawContainerBack(g) {
      // 后壁：浅色内衬
      pathLiquid(g, g.rimY + 4);
      ctx.fillStyle = 'rgba(255,255,255,.06)';
      ctx.fill();
      void g;
    }

    function drawLiquid(g) {
      var topY = liquidTopY(g);
      var c = st.liquid;
      pathLiquid(g, topY);
      // 主体竖直渐变：顶部微亮 → 中部本色 → 底部加深（液体深度感）
      var grad = ctx.createLinearGradient(0, topY, 0, g.botY);
      grad.addColorStop(0, rgbCss(shade(c, 0.06)));
      grad.addColorStop(0.5, rgbCss(c));
      grad.addColorStop(1, rgbCss(shade(c, -0.10)));
      ctx.fillStyle = grad;
      ctx.fill();

      // 液面：比主体亮 + 白色椭圆反光
      ctx.beginPath();
      ctx.ellipse(g.cx, topY, halfW(topY, g), halfW(topY, g) * 0.28, 0, 0, TAU);
      ctx.fillStyle = rgbCss(shade(c, 0.12), 0.95);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(g.cx - halfW(topY, g) * 0.25, topY, halfW(topY, g) * 0.42, halfW(topY, g) * 0.12, 0, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.fill();

      // 泡沫层（摇奶茶后）
      if (st.foam > 0) {
        ctx.beginPath();
        ctx.ellipse(g.cx, topY, halfW(topY, g), halfW(topY, g) * 0.28, 0, 0, TAU);
        ctx.fillStyle = 'rgba(255,255,255,' + (0.55 * st.foam).toFixed(3) + ')';
        ctx.fill();
      }
    }

    function drawLiquidSurface(g) {
      // 液面正弦波动：常态 2~3px，摇动时 6px
      var amp = st.phase === 'shake' ? 6 : 2.5;
      if (st.reduced || st.degrade) amp = 0;
      if (!amp) return;
      var topY = liquidTopY(g);
      var hw = halfW(topY, g);
      var t = (st.lastT || 0) / 420;
      ctx.beginPath();
      for (var i = 0; i <= 24; i++) {
        var x = g.cx - hw + (2 * hw) * (i / 24);
        var y = topY + Math.sin(t + i / 24 * TAU) * amp * 0.28;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgbCss(shade(st.liquid, 0.18), 0.5);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    function drawBubbles(g) {
      if (st.reduced || st.degrade || st.phase === 'shake') return;
      var topY = liquidTopY(g);
      for (var i = 0; i < st.bubbles.length; i++) {
        var b = st.bubbles[i];
        var y = g.botY - (g.botY - topY) * b.y;
        if (y < topY) continue;
        var x = g.cx + (b.x - 0.5) * 2 * halfW(y, g) * 0.82;
        var r = b.r;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
        ctx.fillStyle = 'rgba(255,255,255,.38)';
        ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
        ctx.strokeStyle = 'rgba(255,255,255,.6)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }

    function drawSolids(g) {
      // 珍珠/小料：底部深色圆
      for (var i = 0; i < st.bobas; i++) {
        var x = g.cx + (Math.sin(i * 2.3) * 0.5) * g.botR * 0.9;
        var y = g.botY - 6 - (i % 3) * 4;
        ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU);
        ctx.fillStyle = 'rgba(40,28,18,.85)';
        ctx.fill();
      }
      // 冰块：圆角矩形 + 内部白斜线（冰裂）
      for (var k = 0; k < st.ice; k++) {
        var ix = g.cx + (k ? 1 : -1) * g.botR * 0.32;
        var iy = liquidTopY(g) + (g.botY - liquidTopY(g)) * 0.42;
        var s = 13;
        ctx.save();
        ctx.translate(ix, iy); ctx.rotate((k ? -0.25 : 0.25));
        roundRect(-s / 2, -s / 2, s, s, 3);
        ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 0.9; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-s / 4, -s / 4); ctx.lineTo(s / 4, s / 4);
        ctx.moveTo(-s / 4, 0); ctx.lineTo(0, s / 4);
        ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 0.8; ctx.stroke();
        ctx.restore();
      }
    }

    function drawContainerFront(g) {
      if (st.vessel === 'shaker') { drawShaker(g); return; }
      if (st.vessel === 'milktea') { drawMilkTea(g); return; }
      drawGlass(g);
    }

    // 普通玻璃杯
    function drawGlass(g) {
      var topY = g.rimY;
      ctx.beginPath();
      ctx.moveTo(g.cx - g.rimR, topY);
      ctx.lineTo(g.cx - g.botR, g.botY);
      ctx.ellipse(g.cx, g.botY, g.botR, g.botR * 0.28, 0, Math.PI, 0, true);
      ctx.lineTo(g.cx + g.rimR, topY);
      // 玻璃主体极淡竖直渐变
      var grad = ctx.createLinearGradient(0, topY, 0, g.botY);
      grad.addColorStop(0, 'rgba(255,255,255,.06)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0)');
      grad.addColorStop(1, 'rgba(255,255,255,.04)');
      ctx.fillStyle = grad; ctx.fill();
      ctx.closePath();
      // 杯壁：左缘亮、右缘暗，细线 1.2px
      ctx.beginPath();
      ctx.moveTo(g.cx - g.rimR, topY); ctx.lineTo(g.cx - g.botR, g.botY);
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(g.cx + g.rimR, topY); ctx.lineTo(g.cx + g.botR, g.botY);
      ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1.2; ctx.stroke();
      // 杯底厚度感：2px 暗弧 + 1px 亮弧
      ctx.beginPath();
      ctx.ellipse(g.cx, g.botY, g.botR, g.botR * 0.28, 0, 0, Math.PI);
      ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(g.cx, g.botY - 1.4, g.botR, g.botR * 0.28, 0, 0, Math.PI);
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1; ctx.stroke();
    }

    // 雪克壶（金属质感）
    function drawShaker(g) {
      var bodyH = g.cupH * 0.9;
      var bodyTopY = g.botY - bodyH;
      var bw = g.rimR;
      var botW = g.botR;
      // 金属横向渐变
      var mg = ctx.createLinearGradient(g.cx - bw, 0, g.cx + bw, 0);
      mg.addColorStop(0, '#d8dde3'); mg.addColorStop(0.35, '#f2f5f8');
      mg.addColorStop(0.6, '#b8bfc7'); mg.addColorStop(1, '#e8ecf0');
      ctx.beginPath();
      ctx.moveTo(g.cx - bw, bodyTopY);
      ctx.lineTo(g.cx - botW, g.botY);
      ctx.ellipse(g.cx, g.botY, botW, botW * 0.28, 0, Math.PI, 0, true);
      ctx.lineTo(g.cx + bw, bodyTopY);
      ctx.closePath();
      ctx.fillStyle = mg; ctx.fill();
      // 左侧 2px 竖白高光
      ctx.beginPath();
      ctx.moveTo(g.cx - bw * 0.62, bodyTopY + 6);
      ctx.lineTo(g.cx - botW * 0.62, g.botY - 6);
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 2; ctx.stroke();
      // 锥形盖 + 顶端小圆钮
      var capH = bodyH * 0.35;
      if (st.lid > 0.02) {
        ctx.globalAlpha = st.lid;
        ctx.beginPath();
        ctx.moveTo(g.cx - bw, bodyTopY);
        ctx.lineTo(g.cx - bw * 0.32, bodyTopY - capH);
        ctx.lineTo(g.cx + bw * 0.32, bodyTopY - capH);
        ctx.lineTo(g.cx + bw, bodyTopY);
        ctx.closePath();
        var cg = ctx.createLinearGradient(g.cx - bw, 0, g.cx + bw, 0);
        cg.addColorStop(0, '#cfd4da'); cg.addColorStop(0.4, '#eef1f4'); cg.addColorStop(1, '#c2c8d0');
        ctx.fillStyle = cg; ctx.fill();
        ctx.beginPath(); ctx.arc(g.cx, bodyTopY - capH - 3, 4, 0, TAU);
        ctx.fillStyle = '#dfe3e8'; ctx.fill();
        ctx.globalAlpha = 1;
      }
      // 结霜（摇动时从底部向上蔓延，覆盖 1/3）
      if (st.frost > 0) {
        var fh = bodyH * st.frost;
        var fg = ctx.createLinearGradient(0, g.botY - fh, 0, g.botY);
        fg.addColorStop(0, 'rgba(255,255,255,0)');
        fg.addColorStop(1, 'rgba(255,255,255,.45)');
        ctx.beginPath();
        ctx.moveTo(g.cx - botW, g.botY);
        ctx.lineTo(g.cx - (bw + (botW - bw) * (1 - fh / bodyH)), g.botY - fh);
        ctx.lineTo(g.cx + (bw + (botW - bw) * (1 - fh / bodyH)), g.botY - fh);
        ctx.lineTo(g.cx + botW, g.botY);
        ctx.closePath();
        ctx.fillStyle = fg; ctx.fill();
      }
    }

    // 摇奶茶杯（透明锥形杯 + 白盖 + 吸管十字口）
    function drawMilkTea(g) {
      var topY = g.rimY;
      ctx.beginPath();
      ctx.moveTo(g.cx - g.rimR, topY);
      ctx.lineTo(g.cx - g.botR, g.botY);
      ctx.ellipse(g.cx, g.botY, g.botR, g.botR * 0.28, 0, Math.PI, 0, true);
      ctx.lineTo(g.cx + g.rimR, topY);
      ctx.closePath();
      var grad = ctx.createLinearGradient(0, topY, 0, g.botY);
      grad.addColorStop(0, 'rgba(255,255,255,.1)');
      grad.addColorStop(1, 'rgba(255,255,255,.03)');
      ctx.fillStyle = grad; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.2; ctx.stroke();
      // 白色平盖
      if (st.lid > 0.02) {
        ctx.globalAlpha = st.lid;
        roundRect(g.cx - g.rimR - 2, topY - 9, (g.rimR + 2) * 2, 11, 4);
        ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.06)'; ctx.lineWidth = 1; ctx.stroke();
        // 吸管十字口
        ctx.beginPath();
        ctx.moveTo(g.cx - 5, topY - 3.5); ctx.lineTo(g.cx + 5, topY - 3.5);
        ctx.moveTo(g.cx, topY - 8); ctx.lineTo(g.cx, topY + 1);
        ctx.strokeStyle = 'rgba(0,0,0,.14)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    function drawContainerRim(g) {
      // 杯口椭圆：上缘亮、下缘暗
      var topY = st.vessel === 'shaker' ? g.botY - g.cupH * 0.9 : g.rimY;
      var rw = g.rimR;
      ctx.beginPath();
      ctx.ellipse(g.cx, topY, rw, rw * 0.28, 0, Math.PI, 0);
      ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(g.cx, topY, rw, rw * 0.28, 0, 0, Math.PI);
      ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 1.2; ctx.stroke();
    }

    function drawFrost(g) { void g; /* 结霜在 drawShaker 内绘制，保持层序简单 */ }

    function drawPour(g) {
      var a = st.anim;
      if (!a || a.type !== 'pour') return;
      var p = a.t / a.dur;
      var x = g.cx;
      var w = 5 + 3 * Math.sin(p * Math.PI);
      var grad = ctx.createLinearGradient(0, g.rimY - g.cupH * 0.6, 0, liquidTopY(g));
      grad.addColorStop(0, rgbCss(shade(st.liquid, 0.1), 0.0));
      grad.addColorStop(1, rgbCss(st.liquid, 0.85));
      ctx.fillStyle = grad;
      ctx.fillRect(x - w / 2, g.rimY - g.cupH * 0.6, w, (liquidTopY(g)) - (g.rimY - g.cupH * 0.6));
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    // ---------- 合成闪电（吸收）----------
    function drawFlash(g) {
      var a = st.anim;
      if (!a || a.type !== 'absorb') return;
      var p = a.t / a.dur;
      var alpha = (1 - p) * 0.6;
      if (alpha <= 0) return;
      ctx.beginPath();
      ctx.ellipse(g.cx, g.botY - g.cupH * st.rfill * 0.5, g.rimR * 1.2, g.cupH * 0.5, 0, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
      ctx.fill();
    }

    // ---------- 主绘制 ----------
    function draw() {
      var g = geom();
      ctx.clearRect(0, 0, st.w, st.h);
      drawBackGlow(g);
      ctx.save();
      shakeTransform(g);
      drawContainerBack(g);
      drawLiquid(g);
      drawLiquidSurface(g);
      drawBubbles(g);
      drawSolids(g);
      drawContainerFront(g);
      drawContainerRim(g);
      drawFrost(g);
      drawPour(g);
      drawFlash(g);
      ctx.restore();
    }

    // ---------- 循环（空闲降至 30fps；切后台暂停；连续超时自动降级）----------
    function loop(t) {
      if (!st.running || st.destroyed) return;
      var dt = st.lastT ? Math.min(50, t - st.lastT) : 16;
      st.lastT = t;
      var busy = !!st.anim;
      var interval = busy ? 0 : 33; // 空闲 30fps
      if (!st.lastDraw || t - st.lastDraw >= interval) {
        var t0 = performance.now ? performance.now() : 0;
        update(dt);
        draw();
        var cost = (performance.now ? performance.now() : 0) - t0;
        if (cost > 16) { st.slowFrames++; if (st.slowFrames >= 5 && !st.degrade) { st.degrade = true; buildBubbles(); } }
        else if (st.slowFrames > 0) st.slowFrames--;
        st.lastDraw = t;
      }
      st.rafId = requestAnimationFrame(loop);
    }
    function start() {
      if (st.running || st.destroyed) return;
      st.running = true; st.lastT = 0;
      st.rafId = requestAnimationFrame(loop);
    }
    function stop() { st.running = false; if (st.rafId) cancelAnimationFrame(st.rafId); st.rafId = 0; }

    function onVis() {
      try {
        if (document.hidden) stop();
        else if (!st.destroyed) start();
      } catch (e) {}
    }
    try { document.addEventListener('visibilitychange', onVis); } catch (e) {}

    function destroy() {
      st.destroyed = true; stop();
      try { document.removeEventListener('visibilitychange', onVis); } catch (e) {}
    }

    resize();
    st.rfill = st.fill;
    start();

    return {
      setIngredients: setIngredients,
      setReduced: setReduced,
      playShake: playShake,
      playPour: playPour,
      playAbsorb: playAbsorb,
      setLid: function (v) { st.lid = clamp(v, 0, 1); },
      getVessel: function () { return st.vessel; },
      getLiquid: function () { return st.liquid; },
      resize: resize,
      destroy: destroy
    };
  }

  window.BarRender = {
    mixLiquidColor: mixLiquidColor,
    detectVessel: detectVessel,
    createStage: createStage,
    hexToRgb: hexToRgb,
    rgbCss: rgbCss
  };
})();
