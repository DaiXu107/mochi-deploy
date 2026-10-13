// ===== 吧台（Bar）：原料调制 → 摇晃 → TA 挑冰度（延迟）→ 送出/自饮 → 聊天 =====
// 与花园同级、独立全屏页 #page-bar（页面容器由本文件创建，入口为桌面静态图标 .app[data-app="bar"]）。
// 存储：
//   · 全局 xyStore('xy-home-v2')：bar-ingredients / bar-presets-version / bar-skip-shake /
//     bar-named-recent / bar-my-likes（我喜欢的原料与饮品）
//   · 按联系人 activeStore()：bar-log（调制记录）/ bar-ta-likes（TA 的偏好）
// 联动：经期窗口（window.periodColdWindow）→ 少喝冰建议 + 冷饮概率压到 15%；
//       季节（与花园同口径）+ 今日心情（仅在用户传过心情时生效）→ 常规冷饮概率。
// 一律走 xyStore / activeStore，不裸调 localStorage。
(function () {
  'use strict';
  var G = window.xyStore('xy-home-v2');
  if (!G) return;

  var K_ING = 'bar-ingredients', K_VER = 'bar-presets-version', K_SKIP = 'bar-skip-shake';
  var K_RECENT = 'bar-named-recent', K_LOG = 'bar-log';
  var K_MY_LIKES = 'bar-my-likes', K_TA_LIKES = 'bar-ta-likes';
  var K_ADVICE = 'period-cold-advice-last', K_TAGIFT = 'bar-ta-gift-last';
  var MAX_SLOT = 4;
  var ICE_OPTIONS = ['去冰', '少冰', '多冰', '冰沙', '温热', '常温'];
  var COLD_ICE = { '去冰': 1, '少冰': 1, '多冰': 1, '冰沙': 1 };
  var recipeLog = []; // 本杯原始原料名（融合后仍保留，用于灰字说明与卡片「原料构成」）

  function toast(t) { try { if (window.toast) window.toast(t); } catch (e) {} }

  // ---- 按联系人 store ----
  function activeS() { try { return window.activeStore(); } catch (e) { return null; } }
  function partnerName() {
    try { var s = activeS(); var v = s && s.get('lbl-partner'); return (v && String(v).trim()) || 'TA'; }
    catch (e) { return 'TA'; }
  }
  function readLog() {
    try { var s = activeS(); if (!s) return []; var v = JSON.parse(s.get(K_LOG) || '[]'); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function writeLog(list) { try { var s = activeS(); if (s) s.set(K_LOG, JSON.stringify(list)); } catch (e) {} }

  // ================= 冷饮概率：经期 > 季节 + 心情 =================
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  // 季节（与花园同口径）：Math.floor(month/3)%4 → 0春 1夏 2秋 3冬
  function seasonIdx() { try { return Math.floor(new Date().getMonth() / 3) % 4; } catch (e) { return 1; } }
  var SEASON_COLD = [0.55, 0.75, 0.50, 0.30]; // 春/夏/秋/冬 冷饮基准概率
  var SEASON_NAME = ['春季', '夏季', '秋季', '冬季'];
  // 今日心情（仅当用户今天上传过心情才生效；s=1~5）
  var MOOD_SCORE = { '😊': 5, '🥰': 5, '😄': 5, '😌': 4, '🤒': 2, '😔': 2, '😢': 1, '😡': 1, '😴': 2 };
  function moodScore() {
    try {
      var t = window.moodDiaryToday ? window.moodDiaryToday() : null;
      if (!t || !t.mine) return null;
      return MOOD_SCORE[t.mine.e] != null ? MOOD_SCORE[t.mine.e] : 3;
    } catch (e) { return null; }
  }
  function moodColdAdj() {
    var s = moodScore();
    if (s == null) return 0;
    if (s >= 5) return 0.12;   // 开心/甜蜜/快乐 → 更想喝冰的
    if (s === 4) return 0.04;  // 平静
    if (s === 2) return -0.10; // 不舒服/低落/疲惫
    return -0.18;              // 难过/烦躁
  }
  function coldWindow() { try { return window.periodColdWindow ? window.periodColdWindow() : null; } catch (e) { return null; } }
  function normalColdProb() { return Math.max(0.05, Math.min(0.90, SEASON_COLD[seasonIdx()] + moodColdAdj())); }
  function coldProb() { var w = coldWindow(); return (w && w.active) ? 0.15 : normalColdProb(); }
  // 按概率抽一个冰度（经期窗口冷饮仅 15%）
  function pickIce() {
    if (Math.random() >= coldProb()) return Math.random() < 0.5 ? '温热' : '常温';
    var r = Math.random();
    if (r < 0.42) return '去冰';
    if (r < 0.78) return '少冰';
    if (r < 0.95) return '多冰';
    return '冰沙';
  }
  function coldReasonText() {
    var w = coldWindow();
    if (w && w.active) return '🧣 ' + (w.kind === 'period' ? '经期中' : (w.kind === 'pre' ? '经期前' : '经期刚结束')) + ' · 这几天少喝冰';
    var mc = moodScore();
    if (mc != null && mc <= 2) return '🌧 今天心情不太好 · 给你调温一点';
    return '☀ ' + SEASON_NAME[seasonIdx()] + ' · 按天气给你配的冰度';
  }

  // ================= 喜欢机制（我 / TA）=================
  function likesS(which) { return which === 'ta' ? activeS() : G; }
  function likesK(which) { return which === 'ta' ? K_TA_LIKES : K_MY_LIKES; }
  function readLikes(which) {
    try { var s = likesS(which); if (!s) return { ing: [], drinks: [] }; var v = JSON.parse(s.get(likesK(which)) || '{}'); return { ing: v.ing || [], drinks: v.drinks || [] }; }
    catch (e) { return { ing: [], drinks: [] }; }
  }
  function writeLikes(which, obj) { try { var s = likesS(which); if (s) s.set(likesK(which), JSON.stringify({ ing: obj.ing || [], drinks: obj.drinks || [] })); } catch (e) {} }
  function toggleLike(which, id) {
    var cur = readLikes(which);
    var i = cur.ing.indexOf(id);
    if (i >= 0) cur.ing.splice(i, 1); else cur.ing.push(id);
    writeLikes(which, cur);
    return i < 0;
  }
  // TA 偏好：首次按联系人稳定生成（不随刷新改变）
  function ensureTaLikes() {
    var cur = readLikes('ta');
    if (cur.ing.length) return cur;
    var pool = ING.filter(function (i) { return i.role === 'base' || i.role === 'main'; });
    var ids = [], g = 0;
    while (ids.length < 5 && g++ < 80 && pool.length) {
      var c = pool[Math.floor(Math.random() * pool.length)];
      if (ids.indexOf(c.id) < 0) ids.push(c.id);
    }
    var names = (window.BarFusions || []).map(function (f) { return f.result.name; });
    var dr = [], g2 = 0;
    while (dr.length < 3 && g2++ < 60 && names.length) {
      var n = names[Math.floor(Math.random() * names.length)];
      if (dr.indexOf(n) < 0) dr.push(n);
    }
    cur = { ing: ids, drinks: dr };
    writeLikes('ta', cur);
    return cur;
  }
  function likedIngSet() {
    var my = readLikes('my'), ta = ensureTaLikes();
    var set = {};
    my.ing.concat(ta.ing).forEach(function (id) { set[id] = 1; });
    return set;
  }
  // 加权抽样（喜欢的权重 ×3）
  function weightedPick(pool, liked) {
    if (!pool.length) return null;
    var w = pool.map(function (i) { return liked[i.id] ? 3 : 1; });
    var tot = w.reduce(function (a, b) { return a + b; }, 0);
    var r = Math.random() * tot;
    for (var i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }

  // ================= 原料柜：加载 / 幂等初始化 =================
  function readIngredients() { try { var v = JSON.parse(G.get(K_ING) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function writeIngredients(list) { try { G.set(K_ING, JSON.stringify(list)); } catch (e) {} }
  var ING = readIngredients();

  (function initPresets() {
    var preset = window.BarPresets;
    if (!preset || !preset.ingredients) return;
    var savedVer = parseInt(G.get(K_VER) || '0', 10);
    var have = {};
    ING.forEach(function (i) { if (i && i.id) have[i.id] = true; });
    var added = 0;
    preset.ingredients.forEach(function (p) { if (!have[p.id]) { ING.push(clone(p)); added++; } });
    if (added || savedVer !== preset.version) {
      writeIngredients(ING);
      try { G.set(K_VER, String(preset.version)); } catch (e) {}
    }
  })();

  function escAttr(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  // 原料图标：自定义原料可传图片，未传回退 emoji
  function ingIconHtml(it, cls) {
    if (it && it.img) return '<img class="' + cls + '-img" src="' + escAttr(it.img) + '" alt="">';
    return (it && it.emoji) || '🍹';
  }
  function clone(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return o; } }
  function findIng(id) { for (var i = 0; i < ING.length; i++) if (ING[i].id === id) return ING[i]; return null; }
  var CUSTOM_SEQ = 0;

  // ================= 槽位 / 合成 =================
  var slots = [];
  var familiesSeen = {};
  var fusedLock = false;
  var manualName = '';
  var currentName = '';
  var specialKind = '';
  var iceChoice = '常温';
  var drinkMode = 'gift';   // gift | together | self | ta_gift

  function distinctIds() {
    var arr = [];
    slots.forEach(function (s) { if (s.ing && arr.indexOf(s.ing.id) < 0) arr.push(s.ing.id); });
    return arr;
  }
  function anyFused() { return slots.some(function (s) { return s.ing && s.ing.fusion; }); }

  function matchFusion() {
    var fusions = (window.BarFusions || []).slice().sort(function (a, b) { return b.requires.length - a.requires.length; });
    var guard = 0;
    while (guard++ < 12) {
      var ids = distinctIds();
      var hit = null;
      for (var i = 0; i < fusions.length; i++) {
        var f = fusions[i];
        if (f.requires.every(function (r) { return ids.indexOf(r) >= 0; })) { hit = f; break; }
      }
      if (!hit) break;
      var need = hit.requires.slice();
      slots = slots.filter(function (s) {
        var idx = need.indexOf(s.ing.id);
        if (idx >= 0) { need.splice(idx, 1); return false; }
        return true;
      });
      var res = clone(hit.result);
      res.fusion = true; res.temporary = true; res.removable = false;
      slots.push({ ing: res, count: 1 });
      return true;
    }
    return false;
  }

  // ================= 命名 =================
  function pickAbstract(style) {
    var names = window.BarNames;
    if (!names) return '特调';
    var pool;
    if (style && style !== 'auto' && names.pools[style]) pool = names.pools[style];
    else { pool = []; names.order.forEach(function (k) { pool = pool.concat(names.pools[k] || []); }); }
    // 字卡库【饮品名】分组优先（用户可在「字卡 → 饮品名」增删）。
    // 不依赖 getLibPool（其内部 LOCKED 判据对本场景恒返回空）：自建 + 内置（逐条可关）+ 卡锁语义自己拼。
    try {
      var lib = [];
      // 自建名：直接读字卡库同一个存储键（cc-groups 专属 / cc-groups-public 公用），
      // 与「字卡 → 饮品名」编辑的是同一份数据 —— 用户增删即时生效，不依赖内部缓存。
      (function () {
        var keys = ['cc-groups', 'cc-groups-public'];
        keys.forEach(function (k) {
          try {
            var st = k === 'cc-groups' ? window.activeStore() : window.xyStore('xy-home-v2');
            var g = JSON.parse((st && st.get(k)) || '{}');
            (g['drinkname'] || []).forEach(function (grp) {
              (grp && grp[1] || []).forEach(function (c) { if (typeof c === 'string' && c.trim()) lib.push(c.trim()); });
            });
          } catch (e1) {}
        });
      })();
      var locked = false; try { locked = !!(window.cardLockOpen && window.cardLockOpen()); } catch (e0) {}
      if (!locked) {
        var dg = (window.DEFAULT_CARD_DATA || {}).drinkname || [];
        var off = window.isDefaultCardOff;
        dg.forEach(function (g) { (g[1] || []).forEach(function (c) { if (!(off && off('drinkname', c))) lib.push(c); }); });
      }
      if (lib.length) pool = lib;
    } catch (e) {}
    var recent = [];
    try { recent = JSON.parse(G.get(K_RECENT) || '[]'); } catch (e) {}
    var pick = '', tries = 0;
    do { pick = pool[Math.floor(Math.random() * pool.length)] || '特调'; tries++; }
    while (recent.indexOf(pick) >= 0 && tries < 20 && pool.length > 3);
    recent.unshift(pick); recent = recent.slice(0, 3);
    try { G.set(K_RECENT, JSON.stringify(recent)); } catch (e) {}
    return pick;
  }
  var style = 'auto';
  function nameFromSim(sim) {
    var mods = [], main = null, base = null;
    sim.forEach(function (s) {
      var it = s.ing; if (!it) return;
      if (it.role === 'modifier') mods.push(it.name);
      else if (it.role === 'main' && !main) main = it;
      else if (it.role === 'base' && !base) base = it;
    });
    var pre = mods.join('');
    if (main && base) return pre + main.name + (base.suffix || '');
    if (main) return pre + main.name;
    if (base) return pre + (base.suffix || '');
    return pre;
  }
  function composedName() {
    if (manualName) return manualName;
    var nm = nameFromSim(slots);
    return nm || pickAbstract(style);
  }
  function refreshName(forceAbstract) {
    fusedLock = anyFused();
    currentName = forceAbstract ? pickAbstract(style) : composedName();
    if (!currentName) currentName = pickAbstract(style);
    if (manualName) currentName = manualName;
  }

  // ================= 渲染 =================
  var stage = null, canvasEl = null;
  function ensureStage() {
    if (stage || !canvasEl) return;
    try { stage = window.BarRender.createStage(canvasEl); } catch (e) { stage = null; }
  }
  function renderSlots() {
    var box = document.getElementById('bar-slots');
    if (!box) return;
    box.innerHTML = '';
    for (var i = 0; i < MAX_SLOT; i++) {
      var s = slots[i];
      var d = document.createElement('div');
      d.className = 'bar-slot' + (s ? ' filled' : '');
      if (s && s.ing) {
        d.innerHTML = '<span class="bs-emoji">' + ingIconHtml(s.ing, 'bs') + '</span>' +
          (s.count > 1 ? '<span class="bs-count">×' + s.count + '</span>' : '') +
          '<button class="bs-del" title="移除">✕</button>';
        (function (idx) {
          var del = d.querySelector('.bs-del');
          if (del) del.addEventListener('click', function (ev) { ev.stopPropagation(); removeSlot(idx); });
        })(i);
      } else { d.innerHTML = '<span class="bs-plus">+</span>'; }
      box.appendChild(d);
    }
  }
  function renderHint() {
    var el = document.getElementById('bar-ing-hint');
    if (!el) return;
    if (!recipeLog.length) { el.textContent = ''; el.hidden = true; return; }
    el.hidden = false;
    el.textContent = '原料：' + recipeLog.join(' · ');
  }
  function pushStage() {
    ensureStage();
    if (!stage) return;
    var list = [];
    slots.forEach(function (s) { if (s.ing) for (var k = 0; k < (s.count || 1); k++) list.push(s.ing); });
    stage.setIngredients(list, Object.keys(familiesSeen));
  }
  function renderName() {
    var el = document.getElementById('bar-name');
    if (el) el.textContent = currentName || '—';
    // 固定搭配成品名锁死：按钮常驻（此前是直接 hidden，用户看到按钮「凭空消失」＝以为点不动），
    // 改为置灰 + 点击给明确提示。
    // 编辑（手动改名）永久可用——固定搭配也允许自己起名；
    // 换一个（随机抽抽象名）仍随 fusedLock 置灰，避免把配方名冲成随机名。
    var editBtn = document.getElementById('bar-edit');
    if (editBtn) { editBtn.hidden = false; editBtn.classList.remove('locked'); }
    var reroll = document.getElementById('bar-reroll');
    if (reroll) { reroll.hidden = false; reroll.classList.remove('locked'); }
  }
  function syncLabels() {
    var nick = partnerName();
    var rand = document.getElementById('bar-random');
    if (rand) rand.textContent = '❤️ ' + nick + '帮你调制';
    var reroll = document.getElementById('bar-reroll');
    if (reroll) reroll.textContent = '✨ ' + nick + '取名';
  }
  // 经期/季节/心情提示条
  function renderColdHint() {
    var box = document.getElementById('bar-cold-hint');
    if (!box) return;
    var w = coldWindow();
    if (w && w.active) {
      box.hidden = false;
      box.innerHTML = '<span class="bch-ico">🧣</span><span class="bch-t">' + w.label + ' · 这几天少喝冰，' + partnerName() + '会替你留意</span>' +
        '<button class="bch-btn" id="bch-warm">切到温热</button>';
      var b = box.querySelector('#bch-warm');
      if (b) b.addEventListener('click', function () { iceChoice = '温热'; toast('已把冰度设为温热'); });
    } else { box.hidden = true; box.innerHTML = ''; }
  }
  function renderThinking(on, text) {
    var el = document.getElementById('bar-thinking');
    if (!el) return;
    el.hidden = !on;
    if (on) el.textContent = text || '';
  }
  function renderAll() {
    renderSlots(); renderHint(); pushStage(); renderName(); renderPicker(); syncLabels(); renderColdHint();
  }

  // ================= 加料 =================
  var busy = false;
  function addIngredient(ing) {
    if (busy) return;
    if (!ing) return;
    if (ing.family) familiesSeen[ing.family] = 1;
    var existing = null;
    for (var i = 0; i < slots.length; i++) if (slots[i].ing && slots[i].ing.id === ing.id) existing = slots[i];
    if (existing) { existing.count = (existing.count || 1) + 1; }
    else {
      if (slots.length >= MAX_SLOT) { toast('槽位满了（最多 ' + MAX_SLOT + ' 份），先移除一份再加'); return; }
      slots.push({ ing: clone(ing), count: 1 });
    }
    recipeLog.push(ing.name);
    slots.forEach(function (s) { if (s.ing) s.ing.count = s.count; });
    afterAdd();
  }
  function removeSlot(idx) {
    if (busy) return;
    var s = slots[idx];
    if (!s) return;
    if ((s.count || 1) > 1) { s.count--; } else slots.splice(idx, 1);
    slots.forEach(function (x) { if (x.ing) x.ing.count = x.count; });
    refreshName(); renderAll();
  }
  function afterAdd() {
    refreshName(); renderSlots(); renderHint(); pushStage(); renderName(); syncLabels();
    if (hasFusionHit()) brew();
  }
  function hasFusionHit() {
    var ids = distinctIds();
    return (window.BarFusions || []).some(function (f) { return f.requires.every(function (r) { return ids.indexOf(r) >= 0; }); });
  }
  function brew() {
    ensureStage();
    var rounds = 0;
    function step() {
      if (rounds++ > 12 || !matchFusion()) return Promise.resolve();
      // matchFusion 已同步合并 → 立即刷新文字态（名称/槽位/灰字），吸附动画只作视觉叠加，
      // 避免「点发送很快时弹窗/卡片读到合并前的旧名」的竞态。
      refreshName(); renderSlots(); renderHint(); pushStage(); renderName();
      return (stage ? stage.playAbsorb() : Promise.resolve()).then(step);
    }
    return step();
  }
  function shakeIfNeeded() {
    ensureStage();
    if (!stage) return Promise.resolve();
    if (skipShake()) { stage.setLid(1); return Promise.resolve(); }
    var vessel = stage.getVessel();
    if (vessel === 'glass') return stage.playPour();
    busy = true;
    stage.setLid(0);
    return stage.playShake(vessel).then(function () {
      if (vessel === 'shaker') stage.setLid(1);
      return stage.playPour();
    }).then(function () { busy = false; }, function () { busy = false; });
  }
  function skipShake() { try { return G.get(K_SKIP) === '1'; } catch (e) { return false; } }

  // ================= 冰度 / 温度 选择 =================
  function openIceModal(opts) {
    opts = opts || {};
    var mode = opts.mode || 'gift';
    var allowSelf = !!opts.allowSelf && mode === 'gift';
    var taPick = opts.taPick || '';
    if (taPick) iceChoice = taPick;
    var mask = document.createElement('div');
    mask.className = 'mg-mask'; mask.id = 'bar-ice-mask';
    var hint = taPick
      ? partnerName() + '想了想，替你选了「' + taPick + '」'
      : '给「' + (currentName || '特调') + '」选个冰度';
    mask.innerHTML =
      '<div class="mg-panel bar-ice-panel">' +
        '<div class="mg-head"><span>冰度 / 温度</span><button class="mg-close">✕</button></div>' +
        '<div class="bar-ice-hint">' + hint + '</div>' +
        (taPick ? '<div class="bar-ice-note">' + coldReasonText() + '</div>' : '') +
        '<div class="bar-ice-row">' + ICE_OPTIONS.map(function (o) {
          return '<button class="bar-ice-pill' + (o === iceChoice ? ' sel' : '') + '" data-ice="' + o + '">' + o + '</button>';
        }).join('') + '</div>' +
        (allowSelf
          ? '<div class="bar-ice-mode"><button class="bar-ice-mode-btn sel" data-mode="gift">送给' + partnerName() + '</button><button class="bar-ice-mode-btn" data-mode="self">自己喝</button></div>'
          : '') +
        '<textarea class="bar-wish" id="bar-ice-wish" maxlength="60" placeholder="写一句心意（可留空）"></textarea>' +
        '<div class="bar-add-foot"><button class="bar-add-cancel">取消</button>' +
        '<button class="bar-add-ok" id="bar-ice-ok">' + (allowSelf ? '确认' : '就这杯') + '</button></div>' +
      '</div>';
    document.body.appendChild(mask);
    var close = function () { try { mask.remove(); } catch (e) {} };
    mask.querySelector('.mg-close').addEventListener('click', close);
    mask.querySelector('.bar-add-cancel').addEventListener('click', close);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    mask.querySelectorAll('.bar-ice-pill').forEach(function (b) {
      b.addEventListener('click', function () {
        iceChoice = b.getAttribute('data-ice');
        mask.querySelectorAll('.bar-ice-pill').forEach(function (x) { x.classList.toggle('sel', x === b); });
      });
    });
    mask.querySelectorAll('.bar-ice-mode-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        mode = b.getAttribute('data-mode');
        mask.querySelectorAll('.bar-ice-mode-btn').forEach(function (x) { x.classList.toggle('sel', x === b); });
      });
    });
    mask.querySelector('#bar-ice-ok').addEventListener('click', function () {
      var wEl = mask.querySelector('#bar-ice-wish');
      var wish = (wEl && wEl.value || '').trim();
      close();
      sendToChat(iceChoice, mode, wish);
    });
  }

  // 手动：调制 → 摇晃 → 冰度选择（可自饮）
  function brewThenAsk() {
    if (!canSend()) { toast('先加至少一份原料'); return; }
    if (busy) return;
    brew().then(function () { return shakeIfNeeded(); }).then(function () {
      renderAll();
      openIceModal({ mode: 'gift', allowSelf: true });
    });
  }

  // ================= 发送到聊天 =================
  function canSend() { return slots.length > 0 && !busy; }
  function drinkPayload(ice) {
    var list = recipeLog.length ? recipeLog.slice() : slots.map(function (s) { return s.ing ? s.ing.name : ''; });
    var color = stage && stage.getLiquid ? stage.getLiquid() : { r: 232, g: 232, b: 232 };
    return {
      name: currentName,
      emoji: (slots[0] && slots[0].ing && slots[0].ing.emoji) || '🍸',
      color: window.BarRender ? window.BarRender.rgbCss(color) : 'rgb(232,232,232)',
      ingredients: list.join(' + '),
      ice: ice || iceChoice,
      fused: fusedLock, manual: !!manualName
    };
  }
  function buildRec(d, mode, side, wish) {
    return {
      side: side || 'out', special: 'drink',
      text: '吧台特调：' + d.name,
      drinkName: d.name, drinkEmoji: d.emoji, drinkColor: d.color,
      drinkIngredients: d.ingredients, drinkIce: d.ice,
      drinkMode: mode, drinkWish: wish || '', drinkFused: d.fused, drinkManual: d.manual,
      ts: Date.now()
    };
  }
  function pushLog(d, mode, wish) {
    var log = readLog();
    log.push({ name: d.name, emoji: d.emoji, color: d.color, ingredients: d.ingredients, ice: d.ice, mode: mode, wish: wish || '', fused: d.fused, manual: d.manual, ts: Date.now() });
    writeLog(log);
  }
  function sendToChat(ice, mode, wish) {
    if (!canSend()) { toast('先加至少一份原料'); return; }
    mode = mode || 'gift';
    wish = wish || '';
    var d = drinkPayload(ice);
    try {
      var rec = buildRec(d, mode, 'out', wish);
      if (window.chatAddGift) window.chatAddGift(rec);
      else if (window.chatAddIn) window.chatAddIn(rec.text, {});
      pushLog(d, mode, wish);
      var who = mode === 'self' ? '自己喝了' : (mode === 'together' ? '你俩一起调的' : '');
      toast('已把「' + d.name + '（' + d.ice + '）」' + (mode === 'self' ? '留给自己' : '送到聊天框'));
      window.__barFrom = 'bar';
      if (specialKind) { try { if (window.mochiAnnivFire) window.mochiAnnivFire(); } catch (e) {} }
    } catch (e) { toast('发送失败，请重试'); }
  }

  // ================= TA 帮调（延迟择冰 + 喜欢的原料加权）=================
  function randomCup() {
    if (busy) return;
    var pool = ING.filter(function (i) { return i && i.unlocked !== false; });
    if (!pool.length) return;
    resetCup();
    var liked = likedIngSet();
    var n = 1 + Math.floor(Math.random() * 4);
    var picked = [], guard = 0;
    while (picked.length < n && guard++ < 60) {
      var c = weightedPick(pool, liked);
      if (c && picked.indexOf(c) < 0) picked.push(c);
    }
    picked.forEach(function (p) {
      if (p.family) familiesSeen[p.family] = 1;
      slots.push({ ing: clone(p), count: 1 });
      recipeLog.push(p.name);
    });
    slots.forEach(function (s) { if (s.ing) s.ing.count = s.count; });
    refreshName(true);
    renderAll();
    var nick = partnerName();
    brew().then(function () { return shakeIfNeeded(); }).then(function () {
      renderAll();
      // 不让 TA 一瞬间选好：先「正在挑…」2~4 秒，再给选择（更有真人感）
      renderThinking(true, nick + ' 正在挑冰度…');
      var wait = 2000 + Math.floor(Math.random() * 2000);
      setTimeout(function () {
        renderThinking(false);
        var pick = pickIce();
        renderThinking(true, nick + '：「' + pick + '，就这个」');
        setTimeout(function () {
          renderThinking(false);
          openIceModal({ mode: 'together', taPick: pick });
        }, 700);
      }, wait);
    });
  }

  // 取名：四档抽象名池合并抽取（原「风格档」已并入此键）
  function randomName() {
    if (manualName) {
      if (window.openModal) {
        window.openModal('用随机的名字替换「' + manualName + '」？', '', function () {
          manualName = ''; currentName = pickAbstract('auto'); renderName();
        }, { noInput: true, okText: '换一个' });
      }
      return;
    }
    currentName = pickAbstract('auto');
    renderName();
  }
  function resetCup() {
    slots = []; familiesSeen = {}; fusedLock = false; manualName = ''; currentName = ''; specialKind = ''; recipeLog = [];
    try { if (stage) stage.setLid(1); } catch (e) {}
  }

  // ================= TA 概率自行送出（聊天页）=================
  // 纯计算一杯（不动当前槽位）：用于 TA 主动送饮
  function simulateCup(ingList) {
    var sim = ingList.map(function (it) { return { ing: clone(it), count: 1 }; });
    var fusions = (window.BarFusions || []).slice().sort(function (a, b) { return b.requires.length - a.requires.length; });
    var guard = 0;
    while (guard++ < 12) {
      var ids = sim.map(function (s) { return s.ing.id; });
      var hit = null;
      for (var i = 0; i < fusions.length; i++) { var f = fusions[i]; if (f.requires.every(function (r) { return ids.indexOf(r) >= 0; })) { hit = f; break; } }
      if (!hit) break;
      var need = hit.requires.slice();
      sim = sim.filter(function (s) { var k = need.indexOf(s.ing.id); if (k >= 0) { need.splice(k, 1); return false; } return true; });
      var res = clone(hit.result); res.fusion = true;
      sim.push({ ing: res, count: 1 });
    }
    var nm = nameFromSim(sim) || pickAbstract('auto');
    var liquid = window.BarRender ? window.BarRender.mixLiquidColor(sim.map(function (s) { return s.ing; })) : { r: 232, g: 232, b: 232 };
    return {
      name: nm,
      emoji: (sim[0] && sim[0].ing.emoji) || '🍸',
      color: window.BarRender ? window.BarRender.rgbCss(liquid) : 'rgb(232,232,232)',
      ingredients: ingList.map(function (i) { return i.name; }).join(' + '),
      fused: sim.some(function (s) { return s.ing.fusion; }),
      manual: false
    };
  }
  function taSpontaneousGift() {
    try {
      var h = new Date().getHours();
      if (h >= 23 || h < 6) return;                       // 深夜不打扰
      if (G.get(K_TAGIFT) === todayStr()) return;         // 全局每天最多一次
      if (Math.random() >= 0.10) return;                  // 低概率
      var ta = ensureTaLikes();
      var pool = ta.ing.map(findIng).filter(Boolean);
      if (!pool.length) return;
      var n = 1 + Math.floor(Math.random() * Math.min(3, pool.length));
      var picked = [], guard = 0;
      while (picked.length < n && guard++ < 40) {
        var c = pool[Math.floor(Math.random() * pool.length)];
        if (picked.indexOf(c) < 0) picked.push(c);
      }
      var d = simulateCup(picked);
      d.ice = pickIce();
      var rec = buildRec(d, 'ta_gift', 'in', '');
      if (window.chatAddGift) window.chatAddGift(rec);
      try { G.set(K_TAGIFT, todayStr()); } catch (e) {}
    } catch (e) {}
  }
  window.barCheckTaGift = taSpontaneousGift;

  // ================= 「少喝冰」建议（进吧台时，每天一次）=================
  var ADVICE_LINES = {
    period: ['肚子不舒服就别喝冰的了，我给你温一杯。', '这几天凉的先放一放，常温的我也能调得好喝。', '冰的今天免谈，乖，喝点温的。'],
    pre: ['快到时候了，这两天少喝点冰的。', '提前跟你打个招呼：冰饮这几天先缓缓。', '过几天要难受了，现在开始少碰凉的。'],
    post: ['刚结束也别急着喝冰的，再缓两天。', '这几天先接着喝温的，别急着贪凉。']
  };
  function maybeColdAdvice() {
    try {
      var w = coldWindow();
      if (!w || !w.active) return;
      if (window.mochiDataPending && window.mochiDataPending()) return;
      if (window.dcfGet && window.dcfGet('care') <= 0) return;   // 尊重「梦角关心」总开关
      if (G.get(K_ADVICE) === todayStr()) return;                // 每天一次
      var pool = ADVICE_LINES[w.kind] || ADVICE_LINES.period;
      var line = pool[Math.floor(Math.random() * pool.length)];
      if (window.chatAddIn) window.chatAddIn(line, { tag: '经期关心', nightAllow: true });
      G.set(K_ADVICE, todayStr());
    } catch (e) {}
  }

  // ================= 调制记录 =================
  var MODE_LABEL = { gift: '送出', together: '一起', self: '自饮', ta_gift: 'TA送出' };
  function openLogModal() {
    var log = readLog().slice().reverse();
    var mask = document.createElement('div');
    mask.className = 'mg-mask'; mask.id = 'bar-log-mask';
    var body = log.length
      ? log.map(function (e) {
        var t = new Date(e.ts);
        var tm = (t.getMonth() + 1) + '/' + t.getDate() + ' ' + t.getHours() + ':' + (t.getMinutes() < 10 ? '0' : '') + t.getMinutes();
        return '<div class="bar-log-item"><span class="bl-emoji">' + (e.emoji || '🍸') + '</span>' +
          '<div class="bl-main"><div class="bl-name">' + e.name +
          '<span class="bl-ice">' + (e.ice || '常温') + '</span>' +
          (e.mode && e.mode !== 'gift' ? '<span class="bl-mode">' + (MODE_LABEL[e.mode] || '') + '</span>' : '') +
          '</div><div class="bl-ing">' + (e.ingredients || '') + '</div></div>' +
          '<span class="bl-time">' + tm + '</span></div>';
      }).join('')
      : '<div class="bar-log-empty">' + partnerName() + '还没有调制记录，先去调一杯吧</div>';
    mask.innerHTML = '<div class="mg-panel bar-log-panel">' +
      '<div class="mg-head"><span>' + partnerName() + '的调制记录（' + log.length + '）</span><button class="mg-close">✕</button></div>' +
      '<div class="bar-log-list">' + body + '</div></div>';
    document.body.appendChild(mask);
    var close = function () { try { mask.remove(); } catch (e) {} };
    mask.querySelector('.mg-close').addEventListener('click', close);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
  }

  // ================= 原料柜面板 =================
  function openCabinet() {
    var mask = document.getElementById('bar-cab-mask');
    if (!mask) mask = buildCabinet();
    mask.hidden = false;
    renderCabinetList();
  }
  function buildCabinet() {
    var mask = document.createElement('div');
    mask.id = 'bar-cab-mask'; mask.className = 'mg-mask'; mask.hidden = true;
    mask.innerHTML = '<div class="mg-panel bar-cab-panel">' +
      '<div class="mg-head"><span>原料柜</span><button class="mg-close">✕</button></div>' +
      '<div class="bar-cab-list" id="bar-cab-list"></div>' +
      '<div class="bar-cab-foot"><button class="bar-cab-add" id="bar-cab-add">＋ 添加自定义原料</button></div></div>';
    document.body.appendChild(mask);
    mask.querySelector('.mg-close').addEventListener('click', function () { mask.hidden = true; });
    mask.addEventListener('click', function (e) { if (e.target === mask) mask.hidden = true; });
    mask.querySelector('#bar-cab-add').addEventListener('click', openAddIngredientForm);
    return mask;
  }
  function renderCabinetList() {
    var box = document.getElementById('bar-cab-list');
    if (!box) return;
    box.innerHTML = '';
    var my = readLikes('my'), ta = ensureTaLikes();
    var mySet = {}, taSet = {};
    my.ing.forEach(function (id) { mySet[id] = 1; });
    ta.ing.forEach(function (id) { taSet[id] = 1; });
    var groups = [['base', '基底'], ['main', '主料'], ['modifier', '修饰'], ['addon', '小料']];
    groups.forEach(function (g) {
      var items = ING.filter(function (i) { return i && i.role === g[0]; });
      if (!items.length) return;
      var sec = document.createElement('div');
      sec.className = 'bar-cab-sec';
      sec.innerHTML = '<div class="bar-cab-sec-t">' + g[1] + '（' + items.length + '）</div>';
      var grid = document.createElement('div');
      grid.className = 'bar-cab-grid';
      items.forEach(function (it) {
        var b = document.createElement('button');
        var marks = (mySet[it.id] ? '<span class="bci-like me">♥</span>' : '') + (taSet[it.id] ? '<span class="bci-like ta">♥</span>' : '');
        b.className = 'bar-cab-item' + (it.removable ? ' custom' : '') + (mySet[it.id] || taSet[it.id] ? ' liked' : '');
        b.innerHTML = '<span class="bci-emoji">' + ingIconHtml(it, 'bci') + '</span><span class="bci-name">' + it.name + '</span>' + marks +
          '<span class="bci-fav" title="我喜欢">♡</span>' +
          (it.removable ? '<span class="bci-del" title="删除">✕</span>' : '');
        b.addEventListener('click', function (e) {
          var t = e.target;
          if (t && t.classList && t.classList.contains('bci-del')) { delCustomIngredient(it.id); return; }
          if (t && t.classList && t.classList.contains('bci-fav')) { toggleLike('my', it.id); renderCabinetList(); renderPicker(); return; }
          addIngredient(it);
          var m = document.getElementById('bar-cab-mask'); if (m) m.hidden = true;
        });
        grid.appendChild(b);
      });
      sec.appendChild(grid);
      box.appendChild(sec);
    });
  }
  function delCustomIngredient(id) {
    var it = findIng(id);
    if (!it || !it.removable) { toast('预设原料不可删除'); return; }
    ING = ING.filter(function (x) { return x.id !== id; });
    writeIngredients(ING);
    renderCabinetList(); renderPicker();
    toast('已删除');
  }
  // ---- 自定义原料图片（沿用送礼系统的 mochiImgIngest 范式；未传回退 emoji）----
  var ingImg = '';
  var ingImgInput = null;
  function ensureIngImgInput() {
    if (ingImgInput) return ingImgInput;
    ingImgInput = document.createElement('input');
    ingImgInput.type = 'file'; ingImgInput.accept = 'image/*';
    ingImgInput.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:1;margin:0;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';
    try { document.body.appendChild(ingImgInput); } catch (e) {}
    ingImgInput.onchange = function () {
      var f = ingImgInput.files && ingImgInput.files[0];
      ingImgInput.value = '';
      if (!f) return;
      if (String(f.type || '').indexOf('image/') !== 0) { toast('请选择图片文件'); return; }
      if (!window.mochiImgIngest) { toast('图片处理组件没加载上，请刷新页面再试'); return; }
      window.mochiImgIngest(f, { maxSide: 480, quality: 0.85, mime: 'image/jpeg', opaque: true, tag: 'bar-ing-img' }).then(function (r) {
        if (!r || r.st !== 'ok' || !r.data) { toast(window.mochiImgIngestMiss ? window.mochiImgIngestMiss(r, '原料图片') : '图片处理失败'); return; }
        ingImg = r.data;
        renderIngImgRow();
      });
    };
    return ingImgInput;
  }
  function renderIngImgRow() {
    var row = document.getElementById('ba-img-row');
    if (!row) return;
    row.innerHTML = '<div class="bar-img-prev" id="ba-img-prev">' + (ingImg ? '<img src="' + escAttr(ingImg) + '" alt="">' : '🖼️') + '</div>' +
      '<button class="bar-img-btn" id="ba-img-pick" type="button">' + (ingImg ? '换一张' : '上传图片') + '</button>' +
      (ingImg ? '<button class="bar-img-btn" id="ba-img-clear" type="button">清除</button>' : '');
    var pick = document.getElementById('ba-img-pick');
    if (pick) pick.addEventListener('click', function () {
      var inp = ensureIngImgInput();
      if (window.mochiFilePickFire) window.mochiFilePickFire(inp, { onFail: function () { toast('无法打开相册，请重试'); } });
      else inp.click();
    });
    var clr = document.getElementById('ba-img-clear');
    if (clr) clr.addEventListener('click', function () { ingImg = ''; renderIngImgRow(); });
  }
  function openAddIngredientForm() {
    var mask = document.createElement('div');
    mask.className = 'mg-mask'; mask.id = 'bar-add-mask';
    mask.innerHTML = '<div class="mg-panel bar-add-panel">' +
      '<div class="mg-head"><span>添加自定义原料</span><button class="mg-close">✕</button></div>' +
      '<div class="bar-add-form">' +
        '<label>名称<input id="ba-name" maxlength="12" placeholder="如：柠檬"></label>' +
        '<label>图标 emoji<input id="ba-emoji" maxlength="4" placeholder="如：🍋"></label>' +
        '<div class="bar-img-row" id="ba-img-row"></div>' +
        '<label>颜色<input id="ba-color" type="color" value="#f7d54a"></label>' +
        '<label>角色<select id="ba-role"><option value="main">主料</option><option value="base">基底</option><option value="modifier">修饰</option><option value="addon">小料</option></select></label>' +
        '<label>基底类型<select id="ba-family"><option value="">（仅基底需要）</option><option value="tea">茶</option><option value="milk">奶</option><option value="coffee">咖啡</option><option value="juice">果汁</option><option value="soda">气泡</option><option value="alcohol">酒</option></select></label>' +
        '<label>命名后缀<input id="ba-suffix" maxlength="4" placeholder="仅基底需要，如：茶"></label>' +
      '</div>' +
      '<div class="bar-add-foot"><button class="bar-add-cancel">取消</button><button class="bar-add-ok">保存</button></div></div>';
    document.body.appendChild(mask);
    var close = function () { try { mask.remove(); } catch (e) {} };
    mask.querySelector('.mg-close').addEventListener('click', close);
    mask.querySelector('.bar-add-cancel').addEventListener('click', close);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    ingImg = ''; renderIngImgRow();
    mask.querySelector('.bar-add-ok').addEventListener('click', function () {
      var name = (mask.querySelector('#ba-name').value || '').trim();
      var emoji = (mask.querySelector('#ba-emoji').value || '').trim() || '🍹';
      var color = (mask.querySelector('#ba-color').value || '#cccccc').trim();
      var role = mask.querySelector('#ba-role').value;
      var family = mask.querySelector('#ba-family').value || null;
      var suffix = (mask.querySelector('#ba-suffix').value || '').trim() || null;
      if (!name) { toast('请填写名称'); return; }
      if (role === 'base' && !family) { toast('基底需要选择类型'); return; }
      CUSTOM_SEQ++;
      ING.push({
        id: 'cus_' + Date.now().toString(36) + '_' + CUSTOM_SEQ, name: name, role: role,
        family: role === 'base' ? family : null, suffix: role === 'base' ? suffix : null,
        emoji: emoji, color: color, img: ingImg || '', unlocked: true, removable: true, temporary: false
      });
      writeIngredients(ING);
      close();
      renderCabinetList(); renderPicker();
      toast('已添加原料「' + name + '」');
    });
  }

  // ================= 原料下拉（单下拉 + 分组；喜欢的排前并加 ♥）=================
  function renderPicker() {
    var sel = document.getElementById('bar-picker');
    if (!sel) return;
    var keep = sel.value;
    var liked = likedIngSet();
    sel.innerHTML = '';
    var ph = document.createElement('option');
    ph.value = ''; ph.textContent = '＋ 添加原料…';
    sel.appendChild(ph);
    var groups = [['base', '基底'], ['main', '主料'], ['modifier', '修饰'], ['addon', '小料']];
    groups.forEach(function (g) {
      var items = ING.filter(function (i) { return i && i.role === g[0] && i.unlocked !== false; });
      if (!items.length) return;
      // 喜欢的排前
      items.sort(function (a, b) { return (liked[b.id] ? 1 : 0) - (liked[a.id] ? 1 : 0); });
      var og = document.createElement('optgroup');
      og.label = g[1];
      items.forEach(function (it) {
        var o = document.createElement('option');
        o.value = it.id;
        o.textContent = (liked[it.id] ? '♥ ' : '') + (it.emoji || '🍹') + ' ' + it.name;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    sel.value = keep || '';
  }
  function bindPicker() {
    var sel = document.getElementById('bar-picker');
    if (!sel || sel._barBound) return;
    sel._barBound = true;
    sel.addEventListener('change', function () {
      var id = sel.value;
      if (!id) return;
      var it = findIng(id);
      sel.value = '';
      if (it) addIngredient(it);
    });
  }

  // ================= 纪念日特调 =================
  function annivToday() { try { return window.mochiAnnivToday ? window.mochiAnnivToday() : null; } catch (e) { return null; } }
  function renderSpecial() {
    var box = document.getElementById('bar-special');
    if (!box) return;
    var kind = annivToday();
    if (!kind) { box.hidden = true; return; }
    var label = kind === 'heart' ? '今日特调 · 纪念日' : '今日特调 · 节日';
    box.hidden = false;
    box.innerHTML = '<span class="bar-sp-ico">' + (kind === 'heart' ? '❤️' : '🎉') + '</span>' +
      '<span class="bar-sp-t">' + label + '</span><button class="bar-sp-btn" id="bar-sp-btn">调制今日特调</button>';
    var btn = box.querySelector('#bar-sp-btn');
    if (btn) btn.addEventListener('click', function () { specialCup(kind); });
  }
  function specialCup(kind) {
    resetCup();
    var recipe = kind === 'heart' ? ['rose', 'black_tea', 'lychee'] : ['osmanthus', 'black_tea', 'honey'];
    recipe.forEach(function (id) {
      var it = findIng(id);
      if (it) { if (it.family) familiesSeen[it.family] = 1; slots.push({ ing: clone(it), count: 1 }); recipeLog.push(it.name); }
    });
    slots.forEach(function (s) { if (s.ing) s.ing.count = s.count; });
    specialKind = kind;
    refreshName(); renderAll();
    brew().then(function () { renderAll(); });
  }

  // ================= 页面创建与挂载 =================
  var page = null;
  function buildPage() {
    if (page) return page;
    page = document.createElement('div');
    page.className = 'page'; page.id = 'page-bar'; page.hidden = true;
    page.innerHTML =
      '<div class="chat-head">' +
        '<span class="ch-back" id="bar-back"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></span>' +
        '<span class="ch-name">吧台</span>' +
        '<span class="bar-cab-btn" id="bar-log-btn">📋 调制记录</span>' +
        '<span class="bar-cab-btn" id="bar-cab-btn">🧺 原料柜</span>' +
      '</div>' +
      '<div class="bar-scroll">' +
        '<div class="bar-special" id="bar-special" hidden></div>' +
        '<div class="bar-cold-hint" id="bar-cold-hint" hidden></div>' +
        '<div class="bar-stage"><canvas id="bar-canvas"></canvas></div>' +
        '<div class="bar-thinking" id="bar-thinking" hidden></div>' +
        '<div class="bar-name-row">' +
          '<div class="bar-name" id="bar-name">—</div>' +
          '<div class="bar-name-btns">' +
            '<button class="bar-mini" id="bar-reroll">✨ 取名</button>' +
            '<button class="bar-mini" id="bar-edit">编辑</button>' +
          '</div>' +
        '</div>' +
        '<div class="bar-slots" id="bar-slots"></div>' +
        '<div class="bar-ing-hint" id="bar-ing-hint" hidden></div>' +
        '<div class="bar-actions">' +
          '<button class="bar-btn ghost" id="bar-random">❤️ 帮你调制</button>' +
          '<button class="bar-btn solid" id="bar-send">🍸 调制并发送</button>' +
        '</div>' +
        '<div class="bar-shelf-wrap"><div class="bar-shelf-title">选择原料</div>' +
          '<select class="bar-picker" id="bar-picker"></select></div>' +
      '</div>';
    // 插到花园页之后（与其它 .page 同组、位于 .tabbar 之前）。
    // 注意：appendChild 到 .phone 末尾会落在 .tabbar 之后，底部导航会被顶到页面顶部（实测 top 44px）。
    var home = document.getElementById('page-garden');
    if (home && home.parentNode) home.parentNode.insertBefore(page, home.nextSibling);
    else document.body.appendChild(page);
    canvasEl = page.querySelector('#bar-canvas');
    bindPage();
    bindPicker();
    return page;
  }
  function bindPage() {
    var back = page.querySelector('#bar-back'); if (back) back.addEventListener('click', closeBar);
    var cab = page.querySelector('#bar-cab-btn'); if (cab) cab.addEventListener('click', openCabinet);
    var logBtn = page.querySelector('#bar-log-btn'); if (logBtn) logBtn.addEventListener('click', openLogModal);
    var reroll = page.querySelector('#bar-reroll');
    if (reroll) reroll.addEventListener('click', function () { randomName(); });
    var edit = page.querySelector('#bar-edit'); if (edit) edit.addEventListener('click', renameDrink);
    var rand = page.querySelector('#bar-random'); if (rand) rand.addEventListener('click', randomCup);
    var send = page.querySelector('#bar-send'); if (send) send.addEventListener('click', brewThenAsk);
  }
  function buildStyleRow() {
    var row = document.getElementById('bar-style-row');
    if (!row || !window.BarNames) return;
    var items = [['auto', '抽象池']].concat(window.BarNames.order.map(function (k) { return [k, window.BarNames.labels[k]]; }));
    row.innerHTML = '';
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.className = 'bar-style-pill' + (it[0] === style ? ' sel' : '');
      b.textContent = it[1];
      b.addEventListener('click', function () {
        if (fusedLock) { toast('固定搭配的名字已锁死'); return; }
        style = it[0];
        row.querySelectorAll('.bar-style-pill').forEach(function (x) { x.classList.remove('sel'); });
        b.classList.add('sel');
        if (manualName) return;
        currentName = pickAbstract(style); renderName();
      });
      row.appendChild(b);
    });
  }
  function renameDrink() {
    if (!window.openModal) return;
    var ctl = window.openModal('给这杯起个名字', currentName, function (v) {
      var s = (v || '').trim();
      if (!s) { if (ctl && ctl.hint) ctl.hint('名字不能为空'); return; }
      manualName = s.slice(0, 16); currentName = manualName; renderName();
    }, { maxlength: 16 });
    if (ctl && ctl.hint) ctl.hint('手动命名后，「换一个」不再自动覆盖');
  }

  function openBar() {
    buildPage();
    bindPicker();
    document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
    page.hidden = false;
    renderSpecial();
    ensureStage();
    if (stage && stage.resize) { try { stage.resize(); } catch (e) {} }
    renderAll();
    window.__barOpen = true;
    maybeColdAdvice();   // 经期窗口 → TA 提醒少喝冰（每天一次）
  }
  function closeBar() {
    document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
    var home = document.getElementById('page-phone');
    if (home) home.hidden = false;
    window.__barOpen = false;
  }

  function mount() {
    var icon = document.querySelector('.app[data-app="bar"]');
    if (icon) icon.addEventListener('click', function () {
      var editing = Array.from(document.querySelectorAll('.app-grid')).some(function (g) { return g.classList.contains('editing'); });
      if (editing) return;
      openBar();
    });
    try { window.addEventListener('resize', function () { if (window.__barOpen && stage && stage.resize) stage.resize(); }); } catch (e) {}
    try { document.addEventListener('mochi-fg-resume', function () { if (window.__barOpen && stage && stage.resize) { try { stage.resize(); } catch (e) {} } }); } catch (e) {}
    try {
      document.addEventListener('contact-switched', function () { try { renderAll(); } catch (e) {} });
      document.addEventListener('contact-renamed', function () { try { renderAll(); } catch (e) {} });
    } catch (e) {}
    // TA 概率自行送饮
    try { document.addEventListener('mochi-fg-resume', function () { try { taSpontaneousGift(); } catch (e) {} }); } catch (e) {}
    try { setInterval(function () { try { taSpontaneousGift(); } catch (e) {} }, 300000); } catch (e) {}
    try { setTimeout(function () { try { taSpontaneousGift(); } catch (e) {} }, 6000); } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  // 调试出口
  window.__bar = {
    open: openBar, close: closeBar, add: addIngredient, reset: resetCup,
    random: randomCup, send: sendToChat, brew: brew, slots: function () { return slots; },
    refreshName: refreshName, cabinet: openCabinet, log: openLogModal, logData: readLog,
    ask: brewThenAsk, ice: function (v) { if (v) iceChoice = v; return iceChoice; },
    hint: function () { var e = document.getElementById('bar-ing-hint'); return e ? e.textContent : ''; },
    picker: function () { return document.getElementById('bar-picker'); },
    coldProb: coldProb, coldWindow: coldWindow, pickIce: pickIce, season: function () { return SEASON_NAME[seasonIdx()]; },
    moodScore: moodScore, likes: readLikes, toggleLike: toggleLike, taLikes: ensureTaLikes,
    taGift: taSpontaneousGift, advice: maybeColdAdvice, simulate: simulateCup
  };
})();
