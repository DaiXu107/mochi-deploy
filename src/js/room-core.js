/* ============================================================================
 * 房间数据内核（纯函数，无 DOM / 无存储副作用）
 * ----------------------------------------------------------------------------
 * 目标：把「房间存档」从 2600 行渲染代码里剥出来，形成唯一可信边界。
 *   · 所有外部输入（IndexedDB/localStorage/导入 JSON/旧版本存档）先过 normalize()
 *   · 颜色、名字、ID、像素画、组装件全部白名单化，渲染层不再直接碰不可信字符串
 *   · 版本化迁移（v2 像素画 / v4 窗户 / v5 墙面 / v6 主题）集中在这里
 *   · 占格判定（itemAt/canPlace）也在这里，渲染层不再自己写一套
 *
 * 约定：normalize() 永不抛异常；任何脏数据都返回一份可渲染的 fresh 结构。
 * ========================================================================== */
(function (global) {
  'use strict';

  var VERSION = 6;

  var LIMITS = {
    cols: [4, 10], rows: [3, 8], wallH: [100, 220],
    fx: 80, inv: 400, customFurn: 120, hints: 80,
    art: [4, 48], palette: 250, parts: 80,
    pts: [0, 100000000], lv: [1, 5],
    wallT: [0, 10], wallBot: [0, 220],
    lookH: [0.75, 1.35], bright: [0.5, 1.5]
  };

  var PIXEL = ['#2B2B3A', '#5B4A68', '#8E7CC3', '#C7B9E8', '#FFE3CF', '#F7B8AC', '#E86A6A', '#F2A56B', '#F6D365', '#B5E0A0', '#7FB069', '#5F9E58', '#9BD3E8', '#5B8DB8', '#F5EFE0', '#B78A5F'];
  var HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  var SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/;
  var SAFE_TYPE = /^(?:[a-z][a-z0-9_]{0,30}|u:[A-Za-z0-9_-]{1,40})$/;
  var SAFE_STYLE = /^[A-Za-z0-9_-]{1,32}$/;
  var ART_SLOTS = { shape: 1, hair: 1, face: 1, top: 1, bottom: 1 };
  var HAIR = { short: 1, crop: 1, side: 1, slick: 1, buzz: 1, messy: 1, long: 1, twin: 1, bun: 1 };
  var ACTS = { idle: 1, walk: 1, sit: 1, lie: 1, plant: 1, winwatch: 1, near: 1, use: 1 };
  var WALL_SIDES = { L: 1, R: 1, F1: 1, F2: 1 };
  var PARTS = { box: 1, ball: 1, cyl: 1 };
  var TOPPERS = { none: 1, ball: 1, plant: 1, star: 1 };

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function clampNum(v, lo, hi, fb) {
    var n = typeof v === 'number' ? v : Number(v);
    if (!isFinite(n)) n = fb;
    return Math.min(hi, Math.max(lo, n));
  }
  function int(v, lo, hi, fb) { return Math.round(clampNum(v, lo, hi, fb)); }
  function num(v, lo, hi, fb) { return Math.round(clampNum(v, lo, hi, fb) * 1000) / 1000; }
  function bool(v, fb) { return typeof v === 'boolean' ? v : !!fb; }

  /* 只接受 #rgb / #rrggbb。房间里的颜色全部来自色板或 <input type=color>，
     不接受 rgb()/url()/var()/命名色，从根上断掉「导入 JSON 往 SVG 属性里塞标签」。 */
  function safeColor(v, fb) {
    if (typeof v === 'string') {
      var s = v.trim();
      if (HEX.test(s)) {
        if (s.length === 4) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
        return s.toLowerCase();
      }
    }
    return fb === undefined ? null : fb;
  }

  /* 用户可见的短文本：去掉控制字符与 HTML 元字符。名字最终仍会在渲染时 esc()。 */
  function safeText(v, fb, max) {
    var s = typeof v === 'string' ? v : '';
    s = s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[<>&"']/g, '').replace(/\s+/g, ' ').trim();
    if (!s) s = fb || '';
    max = max || 24;
    if (s.length > max) s = s.slice(0, max);
    return s;
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function safeId(v, fb) {
    if (typeof v === 'string' && !isProtoKey(v) && SAFE_ID.test(v)) return v;
    return fb || ('x' + Math.random().toString(36).slice(2, 10));
  }

  function isProtoKey(v) {
    return v === '__proto__' || v === 'constructor' || v === 'prototype';
  }
  function safeType(v) {
    if (typeof v !== 'string' || isProtoKey(v)) return null;
    return SAFE_TYPE.test(v) ? v : null;
  }
  function safeStyle(v, fb) {
    if (typeof v !== 'string' || isProtoKey(v) || !SAFE_STYLE.test(v)) return fb;
    return v;
  }

  function fresh() {
    return {
      schema: VERSION,
      fx: [
        { i: 'a1', t: 'bed', x: 4, y: 0, r: 0, w: 1, d: 1 },
        { i: 'a2', t: 'shelf', x: 0, y: 0, r: 0, w: 1, d: 1 },
        { i: 'a3', t: 'plant', x: 1, y: 1, r: 0, w: 1, d: 1 },
        { i: 'a4', t: 'chair', x: 3, y: 2, r: 0, w: 1, d: 1 },
        { i: 'w1', t: 'win_rect', x: 1, y: 0, r: 0, w: 1, d: 1 },
        { i: 'w2', t: 'win_rect', x: 2, y: 0, r: 0, w: 1, d: 1 },
        { i: 'w3', t: 'win_round', x: 4, y: 0, r: 0, w: 1, d: 1 }
      ],
      inv: {}, pts: 40, lv: 1, lit: {}, vaseFlower: false,
      wall: 'cream', floor: 'wood', style: 'cream', accent: '#8a7bd8',
      night: null, followSys: true, stack: false, hudMin: false, bright: 1,
      cols: 6, rows: 4, wallH: 150,
      walls: { L: { c: '#f7efe2', a: null }, R: { c: '#eadcc8', a: null }, F1: null, F2: null },
      fcells: {}, fcol: '#d9b78f',
      look: { skin: '#ffe3cf', hair: '#5b4a68', style: 'short', top: '#8e7cc3', bottom: '#6b5b95', h: 1 },
      lookArt: {}, customFurn: {}, hints: {},
      ta: { x: 2, y: 1, act: 'idle', tx: 2, ty: 1, nextAt: Date.now() + 8000 }
    };
  }

  /* ---------------- 像素画 ---------------- */
  function blankArt(s) {
    var a = { s: s, pal: [], rows: [] };
    for (var i = 0; i < s; i++) a.rows.push('.'.repeat(s * 2));
    return a;
  }

  function fromLegacyArt(arr, fallbackSize) {
    var s = fallbackSize || 12;
    var a = blankArt(s);
    a.pal = PIXEL.slice();
    var HEXCH = '0123456789ABCDEF';
    for (var r = 0; r < s; r++) {
      var src = typeof arr[r] === 'string' ? arr[r] : '';
      var row = '';
      for (var c = 0; c < s; c++) {
        var i = HEXCH.indexOf(src.charAt(c));
        row += i < 0 ? '..' : ('0' + i.toString(16)).slice(-2);
      }
      a.rows[r] = row;
    }
    return a;
  }

  function normalizeArt(input, fallbackSize) {
    if (Array.isArray(input)) return fromLegacyArt(input, fallbackSize);
    if (!isObj(input) || !Array.isArray(input.rows)) return null;
    var s = int(input.s, LIMITS.art[0], LIMITS.art[1], fallbackSize || 12);
    var palIn = Array.isArray(input.pal) ? input.pal : [];
    var pal = [];
    var index = Object.create(null);
    for (var i = 0; i < palIn.length && pal.length < LIMITS.palette; i++) {
      var col = safeColor(palIn[i], null);
      if (col && index[col] === undefined) { index[col] = pal.length; pal.push(col); }
    }
    var rows = [];
    for (var r = 0; r < s; r++) {
      var srcRow = typeof input.rows[r] === 'string' ? input.rows[r] : '';
      var row = '';
      for (var c = 0; c < s; c++) {
        var cell = srcRow.substr(c * 2, 2);
        if (!cell || cell === '..') { row += '..'; continue; }
        var idx = parseInt(cell, 16);
        var color = isFinite(idx) ? safeColor(palIn[idx], null) : null;
        var nidx = color ? index[color] : undefined;
        row += (nidx === undefined) ? '..' : ('0' + nidx.toString(16)).slice(-2);
      }
      rows.push(row);
    }
    return { s: s, pal: pal, rows: rows };
  }

  /* ---------------- 组装家具 ---------------- */
  function normalizeParts(parts) {
    if (!Array.isArray(parts)) return [];
    var out = [];
    for (var i = 0; i < parts.length && out.length < LIMITS.parts; i++) {
      var p = parts[i];
      if (!isObj(p) || !PARTS[p.shape]) continue;
      var q = {
        shape: p.shape,
        x: num(p.x, -3, 3, 0), y: num(p.y, -3, 3, 0), z: num(p.z, 0, 160, 0),
        w: num(p.w, 0.05, 3, 0.5), d: num(p.d, 0.05, 3, 0.5),
        h: num(p.h, 0, 160, p.shape === 'ball' ? 0 : 24),
        color: safeColor(p.color, '#d9b78f')
      };
      out.push(q);
    }
    return out;
  }

  function normalizeCustom(v) {
    if (!isObj(v)) return null;
    var name = safeText(v.name, '手绘家具', 24);
    if (v.kind === 'asm2') {
      var parts = normalizeParts(v.parts);
      if (!parts.length) return null;
      return { name: name, kind: 'asm2', parts: parts };
    }
    if (v.kind === 'asm') {
      var colors = [];
      (Array.isArray(v.colors) ? v.colors : []).slice(0, 3).forEach(function (c) {
        var s = safeColor(c, null); if (s) colors.push(s);
      });
      if (!colors.length) colors = ['#d9b78f'];
      return {
        name: name, kind: 'asm',
        w: num(v.w, 0.2, 2, 0.6), d: num(v.d, 0.2, 2, 0.6),
        h: num(v.h, 4, 110, 30), layers: int(v.layers, 1, 3, 1),
        colors: colors, topper: TOPPERS[v.topper] ? v.topper : 'none'
      };
    }
    var art = normalizeArt(v.art, 12);
    if (!art) return null;
    return { name: name, art: art };
  }

  /* ---------------- 家具实例 ---------------- */
  function normalizeFx(raw, ctx, seen) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    for (var i = 0; i < raw.length && out.length < LIMITS.fx; i++) {
      var it = raw[i];
      if (!isObj(it)) continue;
      var t = safeType(it.t);
      if (!t) continue;
      var id = safeId(it.i, null);
      if (!id || seen[id]) id = 'f' + Date.now().toString(36) + i.toString(36);
      seen[id] = 1;
      var x = int(it.x, 0, ctx.cols - 1, 0);
      var y = int(it.y, 0, ctx.rows - 1, 0);
      var w = int(it.w, 1, 3, 1);
      var dd = int(it.d, 1, 3, 1);
      w = Math.min(w, ctx.cols - x);
      dd = Math.min(dd, ctx.rows - y);
      var o = {
        i: id, t: t, x: x, y: y, w: w, d: dd, r: it.r ? 1 : 0,
        rot: int(it.rot, 0, 3, 0),
        vs: num(it.vs, 0.6, 1.8, 1), sc: num(it.sc, 0.7, 1.8, 1)
      };
      if (it.open) o.open = true;
      var fc = safeColor(it.fc, null); if (fc) o.fc = fc;
      if (it.s !== undefined) o.s = num(it.s, 0.5, 3, 1);
      if (it.hs !== undefined) o.hs = num(it.hs, 0.5, 2, 1);
      if (it.bot !== undefined) o.bot = int(it.bot, LIMITS.wallBot[0], LIMITS.wallBot[1], 0);
      if (isObj(it.wp) && WALL_SIDES[it.wp.side]) {
        var wn = (it.wp.side === 'L' || it.wp.side === 'F1') ? ctx.cols : ctx.rows;
        o.wp = { side: it.wp.side, t: num(it.wp.t, 0, wn, 1) };
      }
      if (isObj(it.geo) && WALL_SIDES[it.geo.side]) {
        var gn = (it.geo.side === 'L' || it.geo.side === 'F1') ? ctx.cols : ctx.rows;
        o.geo = {
          side: it.geo.side,
          t: num(it.geo.t, 0, gn, 1),
          bot: int(it.geo.bot, 0, ctx.wallH, 24),
          ws: num(it.geo.ws, 0.5, 3, 1),
          hs: num(it.geo.hs, 0.5, 2, 1)
        };
      }
      out.push(o);
    }
    return out;
  }

  /* ---------------- 墙面 / 地板 ---------------- */
  function normalizeWall(w, fallbackColor) {
    if (!isObj(w)) return null;
    return { c: safeColor(w.c, fallbackColor), a: normalizeArt(w.a, 12) };
  }

  function normalizeStrict(raw) {
    var f = fresh();
    var issues = [];
    var src = isObj(raw) ? raw : {};
    var cols = int(src.cols, LIMITS.cols[0], LIMITS.cols[1], f.cols);
    var rows = int(src.rows, LIMITS.rows[0], LIMITS.rows[1], f.rows);
    var wallH = int(src.wallH, LIMITS.wallH[0], LIMITS.wallH[1], f.wallH);
    var ctx = { cols: cols, rows: rows, wallH: wallH };

    if (src.cols !== undefined && src.cols !== cols) issues.push('户型宽度已修正');
    if (src.rows !== undefined && src.rows !== rows) issues.push('户型深度已修正');

    var fxSource = Array.isArray(src.fx) ? src.fx.slice() : [];
    /* v4：旧窗户数组 → 家具件 */
    if (Array.isArray(src.winL) || Array.isArray(src.winR)) {
      (src.winL || []).forEach(function (wd, i) {
        fxSource.push({ i: 'wm' + i + Date.now().toString(36), t: 'win_' + ((wd && wd.s) || 'rect'), x: 1, y: 0, r: 0 });
      });
      (src.winR || []).forEach(function (wd, i) {
        fxSource.push({ i: 'wn' + i + Date.now().toString(36), t: 'win_' + ((wd && wd.s) || 'rect'), x: cols - 1, y: 0, r: 0 });
      });
      issues.push('旧窗户已迁移');
    }

    var customFurn = {};
    if (isObj(src.customFurn)) {
      Object.keys(src.customFurn).slice(0, LIMITS.customFurn).forEach(function (k) {
        if (!SAFE_ID.test(k) || isProtoKey(k)) return;
        var cf = normalizeCustom(src.customFurn[k]);
        if (cf) customFurn[k] = cf;
      });
    }

    var seen = Object.create(null);
    var fx = normalizeFx(fxSource, ctx, seen);

    var lit = {};
    if (isObj(src.lit)) {
      Object.keys(src.lit).forEach(function (k) {
        if (seen[k] && src.lit[k]) lit[k] = true;
      });
    }

    var inv = {};
    if (isObj(src.inv)) {
      Object.keys(src.inv).slice(0, LIMITS.inv).forEach(function (k) {
        var t = safeType(k);
        if (!t) return;
        var n = int(src.inv[k], 0, 99, 0);
        if (n > 0) inv[t] = n;
      });
    }

    var look = f.look;
    if (isObj(src.look)) {
      look = {
        skin: safeColor(src.look.skin, f.look.skin),
        hair: safeColor(src.look.hair, f.look.hair),
        style: HAIR[src.look.style] ? src.look.style : 'short',
        top: safeColor(src.look.top, f.look.top),
        bottom: safeColor(src.look.bottom, f.look.bottom),
        h: num(src.look.h, LIMITS.lookH[0], LIMITS.lookH[1], 1)
      };
    }

    var lookArt = {};
    if (isObj(src.lookArt)) {
      Object.keys(ART_SLOTS).forEach(function (k) {
        var a = normalizeArt(src.lookArt[k], 12);
        if (a) lookArt[k] = a;
      });
    }

    var walls = { L: null, R: null, F1: null, F2: null };
    if (isObj(src.walls)) {
      walls.L = normalizeWall(src.walls.L, f.walls.L.c) || { c: f.walls.L.c, a: null };
      walls.R = normalizeWall(src.walls.R, f.walls.R.c) || { c: f.walls.R.c, a: null };
      walls.F1 = normalizeWall(src.walls.F1, '#eadcc8');
      walls.F2 = normalizeWall(src.walls.F2, '#eadcc8');
    } else {
      /* v5：旧墙纸预设 → 左右墙配色 */
      var legacy = { cream: ['#f7efe2', '#eadcc8'], dusk: ['#f2d3be', '#e3bca6'], star: ['#3c406b', '#31355a'] }[src.wall] || ['#f7efe2', '#eadcc8'];
      walls.L = { c: legacy[0], a: null };
      walls.R = { c: legacy[1], a: null };
    }

    var fcells = {};
    if (isObj(src.fcells)) {
      Object.keys(src.fcells).forEach(function (k) {
        var m = /^(\d{1,2}),(\d{1,2})$/.exec(k);
        if (!m) return;
        var x = Number(m[1]), y = Number(m[2]);
        if (x >= cols || y >= rows) return;
        var c = safeColor(src.fcells[k], null);
        if (c) fcells[x + ',' + y] = c;
      });
    }

    var ta = f.ta;
    if (isObj(src.ta)) {
      var now = Date.now();
      ta = {
        x: int(src.ta.x, 0, cols - 1, 1), y: int(src.ta.y, 0, rows - 1, 1),
        tx: int(src.ta.tx, 0, cols - 1, 1), ty: int(src.ta.ty, 0, rows - 1, 1),
        act: ACTS[src.ta.act] ? src.ta.act : 'idle',
        nextAt: clampNum(src.ta.nextAt, 0, now + 3600000, now + 8000)
      };
    }

    var hints = {};
    if (isObj(src.hints)) {
      Object.keys(src.hints).slice(0, LIMITS.hints).forEach(function (k) {
        if (SAFE_ID.test(k) && !isProtoKey(k) && src.hints[k]) hints[k] = true;
      });
    }

    var out = {
      schema: VERSION,
      fx: fx, inv: inv, pts: int(src.pts, LIMITS.pts[0], LIMITS.pts[1], f.pts),
      lv: int(src.lv, LIMITS.lv[0], LIMITS.lv[1], f.lv), lit: lit,
      vaseFlower: bool(src.vaseFlower, false),
      wall: safeStyle(src.wall, f.wall),
      floor: safeStyle(src.floor, f.floor),
      style: safeStyle(src.style, safeStyle(src.wall, f.style)),
      accent: safeColor(src.accent, f.accent),
      night: (src.night === 'n' || src.night === 'd') ? src.night : null,
      followSys: bool(src.followSys, true), stack: bool(src.stack, false),
      hudMin: bool(src.hudMin, false), bright: num(src.bright, LIMITS.bright[0], LIMITS.bright[1], 1),
      cols: cols, rows: rows, wallH: wallH, walls: walls, fcells: fcells,
      fcol: safeColor(src.fcol, f.fcol), look: look, lookArt: lookArt,
      customFurn: customFurn, hints: hints, ta: ta
    };

    /* 有仓库里却没有自定义件 → 视为悬空引用，清掉（否则渲染层会拿到 null 崩） */
    Object.keys(inv).forEach(function (t) {
      if (t.indexOf('u:') === 0 && !own(customFurn, t.slice(2))) delete inv[t];
    });

    if (raw && raw.schema !== undefined && raw.schema !== VERSION) issues.push('存档已升级到 v' + VERSION);
    if (issues.length) issues.unshift('已自动修复 ' + issues.length + ' 处存档问题');
    return { data: out, issues: issues };
  }

  function normalize(raw) {
    try { return normalizeStrict(raw); }
    catch (e) {
      return { data: fresh(), issues: ['存档结构异常，已回到初始小屋'] };
    }
  }

  function parse(raw) {
    if (raw == null || raw === '') return { ok: false, absent: true, corrupt: false, data: fresh(), issues: [] };
    var obj = raw;
    if (typeof raw === 'string') {
      try { obj = JSON.parse(raw); }
      catch (e) { return { ok: false, absent: false, corrupt: true, data: fresh(), issues: ['存档 JSON 无法解析'] }; }
    }
    if (!isObj(obj)) return { ok: false, absent: false, corrupt: true, data: fresh(), issues: ['存档不是对象'] };
    /* `{}` / 完全陌生的对象不是「空房间」，是坏档：不能让它以空屋身份被写回。 */
    var known = ['fx', 'inv', 'cols', 'rows', 'walls', 'look', 'ta', 'customFurn', 'fcells', 'lookArt'];
    var any = false;
    for (var i = 0; i < known.length; i++) { if (own(obj, known[i])) { any = true; break; } }
    if (!any) return { ok: false, absent: false, corrupt: true, data: fresh(), issues: ['存档没有可识别的房间字段'] };
    var n = normalize(obj);
    return { ok: true, absent: false, corrupt: false, data: n.data, issues: n.issues };
  }

  function serialize(data) { return JSON.stringify(data); }

  /* ---------------- 占格（渲染层唯一入口） ---------------- */
  function isWallItem(isWall, t) {
    try { return !!(isWall && isWall(t)); } catch (e) { return false; }
  }
  function itemAt(fx, x, y, isWall) {
    if (!Array.isArray(fx)) return null;
    for (var i = 0; i < fx.length; i++) {
      var it = fx[i];
      if (!it || isWallItem(isWall, it.t)) continue;
      if (x >= it.x && x < it.x + (it.w || 1) && y >= it.y && y < it.y + (it.d || 1)) return it;
    }
    return null;
  }
  function cellsOf(x, y, w, d) {
    var out = [];
    for (var cx = x; cx < x + w; cx++) for (var cy = y; cy < y + d; cy++) out.push([cx, cy]);
    return out;
  }
  function canPlace(data, x, y, w, d, ignoreId, isWall) {
    if (!data) return false;
    w = Math.max(1, w || 1); d = Math.max(1, d || 1);
    if (x < 0 || y < 0 || x + w > data.cols || y + d > data.rows) return false;
    if (data.stack) return true;
    var cells = cellsOf(x, y, w, d);
    for (var i = 0; i < cells.length; i++) {
      var it = itemAt(data.fx, cells[i][0], cells[i][1], isWall);
      if (it && it.i !== ignoreId) return false;
    }
    return true;
  }

  global.RoomCore = {
    VERSION: VERSION,
    LIMITS: LIMITS,
    PIXEL: PIXEL,
    fresh: fresh,
    normalize: normalize,
    parse: parse,
    serialize: serialize,
    normalizeArt: normalizeArt,
    blankArt: blankArt,
    safeColor: safeColor,
    safeText: safeText,
    safeId: safeId,
    safeType: safeType,
    safeStyle: safeStyle,
    esc: esc,
    itemAt: itemAt,
    cellsOf: cellsOf,
    canPlace: canPlace
  };
})(typeof window !== 'undefined' ? window : globalThis);
