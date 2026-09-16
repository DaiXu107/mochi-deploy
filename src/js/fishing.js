// ===== 功能：双人钓鱼（聊天页更多功能 → 钓鱼） =====
// 轻量资源获取小游戏：你与 TA 各一根鱼竿，你负责点击操作，TA 由代码状态机控制。
// 核心循环：抛竿 → 鱼漂晃动 → 时机收竿 → 获得鱼/物品 → 今日收获 → 出售 → 心意币（进 gift-wallet 统一账本）。
// 附属系统：鱼图鉴（首次钓到记录）、TA 送礼（特殊物品概率触发互动字卡 + 收藏）、一起钓鱼陪伴奖励（每日一次）。
// 不依赖聊天 AI；音效 Web Audio 短促音，可静音。存储键均走 window.activeStore()（随联系人桌面隔离，前缀 xy-home-v2）。
(function () {
  const panel = document.getElementById('chat-fish-panel');
  if (!panel) return;
  if (window.__fishInit) return;
  window.__fishInit = true;

  // ---- #306 全屏：面板 fixed 满屏（共享 .game-fs 类，同 pong-fs 机制）。 ----
  // 重开面板无论上次怎么关的（含兄弟互斥直接 hidden）都先退出，防全屏残留 ----
  const fsBtn = document.getElementById('fish-fs');
  let isFs = false;
  function toggleFs() {
    isFs = !isFs;
    panel.classList.toggle('game-fs', isFs);
    if (fsBtn) fsBtn.textContent = isFs ? '⤢' : '⛶';
  }
  if (fsBtn) fsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFs(); });

  // ---- 基础工具 ----
  function store() { try { return window.activeStore(); } catch (e) { return null; } }
  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    t.style.opacity = '';
    clearTimeout(t._timer); t._timer = setTimeout(function () { t.className = 'cc-toast'; }, 2000);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fit(s) { return window.taFit ? window.taFit(s) : s; }
  function partnerName() { try { return window.chatPartnerName ? window.chatPartnerName() : 'TA'; } catch (e) { return 'TA'; } }
  function taWord() { try { return window.taWord ? window.taWord() : 'TA'; } catch (e) { return 'TA'; } }
  function rand(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : ''; }
  function todayKey() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fenToStr(fen) { const y = fen / 100; return y.toFixed(y >= 100 ? 0 : 2); }
  function pickPool(name, fb) { try { if (window.getInteractPool) { const p = window.getInteractPool(name, fb); if (p && p.length) return p; } } catch (e) {} return fb; }

  // ---- 音效（Web Audio 短促音） ----
  let audioCtx = null, soundOn = true;
  function beep(freq, dur, vol, type) {
    if (!soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      // FIX 2026-09-16：resume 无 catch 且不等待——后台返回 iOS 挂起后可能整段哑音 + 未处理 rejection
      if (audioCtx.state === 'suspended' && audioCtx.resume) { const r = audioCtx.resume(); if (r && r.catch) r.catch(function () {}); }
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = freq; o.type = type || 'sine';
      g.gain.value = vol || 0.08;
      o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      o.start(t); g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.08));
      o.stop(t + (dur || 0.08));
    } catch (e) {}
  }
  function sfxCast() { beep(360, 0.06, 0.1); }
  function sfxBite() { beep(720, 0.05, 0.12); beep(880, 0.05, 0.1); }
  function sfxCatch() { beep(520, 0.08, 0.14); setTimeout(function () { beep(780, 0.1, 0.14); }, 90); }
  function sfxMiss() { beep(240, 0.14, 0.1, 'triangle'); }
  function sfxSell() { beep(660, 0.06, 0.12); setTimeout(function () { beep(880, 0.08, 0.12); }, 80); setTimeout(function () { beep(1100, 0.1, 0.12); }, 160); }
  function sfxGift() { beep(880, 0.1, 0.12); setTimeout(function () { beep(1174, 0.12, 0.12); }, 110); }

  // ---- 物品表（price 单位：分，与 gift-wallet 一致；cat: fish/special/gift） ----
  const ITEMS = [
    { id: 'fish_small',    name: '小鱼',   icon: '🐟', price: 200,  cat: 'fish',    r: 1 },
    { id: 'fish_blue',     name: '蓝鱼',   icon: '🐠', price: 500,  cat: 'fish',    r: 2 },
    { id: 'fish_puffer',   name: '河豚',   icon: '🐡', price: 600,  cat: 'fish',    r: 2 },
    { id: 'fish_crab',     name: '螃蟹',   icon: '🦀', price: 700,  cat: 'fish',    r: 2 },
    { id: 'fish_big',      name: '大鱼',   icon: '🐟', price: 1200, cat: 'fish',    r: 3 },
    { id: 'fish_octopus',  name: '八爪鱼', icon: '🐙', price: 1200, cat: 'fish',    r: 3 },
    { id: 'fish_rare',     name: '稀有鱼', icon: '🐠', price: 3000, cat: 'fish',    r: 4 },
    { id: 'fish_gold',     name: '金色鱼', icon: '🌟', price: 5000, cat: 'fish',    r: 5 },
    { id: 'fish_koi',      name: '锦鲤',   icon: '🎏', price: 8000,  cat: 'fish',    r: 6 },
    { id: 'fish_moon',     name: '月光鱼', icon: '🌙', price: 12000, cat: 'fish',    r: 6 },
    { id: 'fish_abyss',    name: '深渊王', icon: '🐲', price: 20000, cat: 'fish',    r: 6 },
    { id: 'sp_flower',     name: '漂流花', icon: '🌸', price: 800,  cat: 'special', giftNote: 'flower' },
    { id: 'sp_chest',      name: '小宝箱', icon: '🎁', price: 2000, cat: 'special' },
    { id: 'gift_shell',    name: '小贝壳', icon: '🐚', cat: 'gift',    price: 0, giftNote: 'shell' },
    { id: 'gift_stone',    name: '小石头', icon: '🪨', cat: 'gift',    price: 0, giftNote: 'stone' },
    { id: 'gift_bottle',   name: '漂流瓶', icon: '🧴', cat: 'gift',    price: 0, giftNote: 'bottle' },
    { id: 'gift_trinket',  name: '小饰品', icon: '🎀', cat: 'gift',    price: 0, giftNote: 'trinket' }
  ];
  const ITEM_MAP = {}; ITEMS.forEach(function (it) { ITEM_MAP[it.id] = it; });
  // ---- 烹饪：每种鱼对应一道菜（cookSec=烹饪秒，mult=售价倍率） ----
  const DISHES = {
    fish_small:   { name: '烤小鱼',   emoji: '🐟', cookSec: 180,  mult: 1.8 },
    fish_blue:    { name: '清蒸蓝鱼', emoji: '🍽️', cookSec: 300,  mult: 1.8 },
    fish_puffer:  { name: '河豚刺身', emoji: '🍣', cookSec: 300,  mult: 1.9 },
    fish_crab:    { name: '清蒸蟹',   emoji: '🦀', cookSec: 360,  mult: 1.8 },
    fish_big:     { name: '红烧大鱼', emoji: '🍲', cookSec: 480,  mult: 1.9 },
    fish_octopus: { name: '章鱼烧',   emoji: '🐙', cookSec: 480,  mult: 1.9 },
    fish_rare:    { name: '稀有鱼宴', emoji: '🍱', cookSec: 720,  mult: 2.0 },
    fish_gold:    { name: '金鱼浓汤', emoji: '🍜', cookSec: 1080, mult: 2.2 },
    fish_koi:     { name: '锦鲤御膳', emoji: '👑', cookSec: 1800, mult: 2.5 },
    fish_moon:    { name: '月光鱼露', emoji: '🌙', cookSec: 1800, mult: 2.5 },
    fish_abyss:   { name: '深渊王宴', emoji: '🐲', cookSec: 1800, mult: 3.0 }
  };
  function dishOf(fishId) { return DISHES[fishId] || null; }
  function dishPrice(fishId, quality) { const it = ITEM_MAP[fishId]; const d = dishOf(fishId); if (!it || !d) return 0; const qm = quality === 'perfect' ? 1.15 : quality === 'good' ? 1.0 : 0.85; return Math.round(it.price * d.mult * qm); }
  // 可钓到的鱼池（按稀有度 r 加权，供玩家与 TA 共用）
  const FISH_POOL = ITEMS.filter(function (it) { return it.cat === 'fish' || it.cat === 'special'; });
  // TA 专属纪念池（小贝壳/小石头/漂流瓶/小饰品）——只有 TA 会钓到并主动送给你收藏
  const GIFT_POOL = ITEMS.filter(function (it) { return it.cat === 'gift'; });
  // 玩家出货：按品质给稀有度权重
  function qualityWeights(quality) {
    // perfect: 高稀有度倾斜；good: 中等；poor: 低稀有度倾斜
    if (quality === 'perfect') return { 1: 30, 2: 30, 3: 22, 4: 13, 5: 5, 6: 3 };
    if (quality === 'good')    return { 1: 45, 2: 30, 3: 16, 4: 7, 5: 2, 6: 1 };
    return { 1: 68, 2: 22, 3: 8, 4: 2, 5: 0, 6: 0 };
  }
  function rollFish(quality) {
    const w = qualityWeights(quality);
    const pool = FISH_POOL.filter(function (it) { return (w[it.r] || 0) > 0; });
    let total = 0; pool.forEach(function (it) { total += (w[it.r] || 0); });
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) { r -= (w[pool[i].r] || 0); if (r <= 0) return pool[i]; }
    return pool[0];
  }
  function successRate(quality) { return quality === 'perfect' ? 0.92 : quality === 'good' ? 0.6 : 0.22; }
  // TA 出货：约 15% 概率钓到「纪念品」送给你，其余走普通鱼池（稀有度按 good 倾斜）
  function rollTaItem() {
    if (Math.random() < 0.15 && GIFT_POOL.length) return GIFT_POOL[Math.floor(Math.random() * GIFT_POOL.length)];
    return rollFish('good');
  }

  // ---- 送礼 / 互动字卡池（内置兜底，优先读用户字卡库） ----
  const GIFT_NOTES = {
    shell: ['捡到一个小贝壳，给你。', '这个贝壳挺好看的，留给你。', '海边的小东西，收下吧。'],
    stone: ['捡到一块小石头，很光滑，给你。', '这块石头摸起来很舒服，送你。'],
    bottle: ['捞到一个漂流瓶，没舍得打开，给你。', '捡到一个漂流瓶，送你了。'],
    trinket: ['钓上来一个小饰品，是你的了。', '这个小东西，很想给你。'],
    flower: ['这朵花给你。', 'TA 把花递给你。', '捞起一朵花，觉得适合你。']
  };
  function giftNoteFor(item) {
    const builtin = GIFT_NOTES[item.giftNote || item.id] || ['这个给你。', '想把这份小惊喜留给你。'];
    const pool = pickPool('游戏胜利·回应', builtin);
    return pool && pool.length ? pick(pool) : pick(builtin);
  }

  // ---- 存储读写 ----
  function readJSON(key, fb) { const s = store(); if (!s) return fb; try { const v = JSON.parse(s.get(key) || 'null'); return v == null ? fb : v; } catch (e) { return fb; } }
  function writeJSON(key, v) { const s = store(); if (s) s.set(key, JSON.stringify(v)); }

  function dexKey() { return 'fishing-dex'; }
  function loadDex() { const d = readJSON(dexKey(), {}); return (d && typeof d === 'object') ? d : {}; }
  function saveDex(d) { writeJSON(dexKey(), d); }

  function todayDataKey() { return 'fishing-today'; }
  // 「留」标记按归属记：keep['mine:<id>'] / keep['ta:<id>']，同品种两侧互不牵连
  function keepKey(side, id) { return side + ':' + id; }
  function normalizeToday(t) {
    const old = t.keep && typeof t.keep === 'object' ? t.keep : {};
    const keep = {};
    Object.keys(old).forEach(function (k) {
      if (!old[k]) return;
      // 旧数据只按品种记（键不含 ':'）：展开到两侧，等价于原来的「同品种两侧都不卖」
      if (k.indexOf(':') < 0) { keep[keepKey('mine', k)] = 1; keep[keepKey('ta', k)] = 1; }
      else keep[k] = 1;
    });
    t.keep = keep;
    return t;
  }
  function loadToday() {
    const t = readJSON(todayDataKey(), null);
    if (t && t.date === todayKey()) return normalizeToday(t);
    return { date: todayKey(), mine: {}, ta: {}, keep: {} };
  }
  function saveToday(t) { writeJSON(todayDataKey(), t); }

  function giftsKey() { return 'fishing-gifts'; }
  function loadGifts() { const g = readJSON(giftsKey(), []); return Array.isArray(g) ? g : []; }
  function saveGifts(g) { writeJSON(giftsKey(), g); }

  function togetherKey() { return 'fishing-together'; }
  function loadTogether() { const t = readJSON(togetherKey(), null); if (t && t.date === todayKey()) return t; return { date: todayKey(), sec: 0, rewarded: false }; }
  function saveTogether(t) { writeJSON(togetherKey(), t); }

  // ---- 成就统计（永久累计：抛竿次数 / 完美收竿 / 累计心意币） ----
  function statsKey() { return 'fishing-stats'; }
  function loadStats() { const s = readJSON(statsKey(), null); return s && typeof s === 'object' ? s : { totalCast: 0, perfectCatch: 0, totalEarned: 0 }; }
  function saveStats(s) { writeJSON(statsKey(), s); }
  function addStats(delta) { const s = loadStats(); s.totalCast += delta.totalCast || 0; s.perfectCatch += delta.perfectCatch || 0; s.totalEarned += delta.totalEarned || 0; saveStats(s); }

  // ---- 心意币钱包：读写统一走 window.giftWalletChange（gift-shop.js 维护，根键 xy-home-v2:gift-wallet，单位分）----
  // FIX 2026-09-16：钓鱼收入原先完全无日封顶（深渊王 ¥200/条、烹饪 ¥600/条，其他游戏均有 ¥10~¥104 上限）
  // ——补 ¥104/日封顶（对齐 c4/pong），单键滚动计数；先落盘封顶计数再入账。纪念品兑换/陪伴奖励自带
  // 每日一次/事件限量，不并入此封顶。
  function fishCoinCap() {
    const o = readJSON('fishing-coin-day', null);
    if (o && o.date === todayKey() && typeof o.used === 'number') return o.used;
    return 0;
  }
  function grantFishCoin(fen, label) {
    const used = fishCoinCap();
    const real = Math.max(0, Math.min(fen, 10400 - used));
    if (real <= 0) return 0;
    try { writeJSON('fishing-coin-day', { date: todayKey(), used: used + real }); } catch (e) { return 0; }
    if (window.giftWalletChange) window.giftWalletChange(real, real, label);
    return real;
  }

  // ---- DOM ----
  const partnerNameEl = document.getElementById('fish-partner-name');
  const sceneEl = document.getElementById('fish-scene');
  const statusEl = document.getElementById('fish-status');
  const castBtn = document.getElementById('fish-cast');
  const reelBtn = document.getElementById('fish-reel');
  const soundBtn = document.getElementById('fish-sound');
  const timingWrapEl = document.getElementById('fish-timing-wrap');
  const timingBarEl = document.getElementById('fish-timing-bar');
  const timingCursorEl = document.getElementById('fish-timing-cursor');
  const pageEl = document.getElementById('fish-page');
  const tabEls = panel.querySelectorAll('.fish-tab');
  // 鱼漂（纯视觉元素，由 scene 的 data-mine/data-ta 状态驱动显隐/变色，见 chat-pages.css .fish-bobber）
  if (sceneEl && !sceneEl.querySelector('.fish-bobber')) {
    const bm = document.createElement('span'); bm.className = 'fish-bobber fish-bobber-mine';
    const bt = document.createElement('span'); bt.className = 'fish-bobber fish-bobber-ta';
    sceneEl.appendChild(bm); sceneEl.appendChild(bt);
  }

  // ---- 运行时状态 ----
  let mine = null;       // 玩家：{phase, since, biteAt, rafId}
  let ta = null;         // TA：{phase, until, ...}
  let taTimer = null, togetherTimer = null;
  let timingRafId = null;
  let curTab = 'today';
  let open = false;
  let missStreak = 0;     // 连续跑鱼次数（保底：第 5 次起必命中）
  let togetherSec = -1, togetherRewarded = null;  // 陪伴计时内存缓存（减少写盘）
  let _lastPageKey = '';  // renderPage 脏标记（无变化时跳过 innerHTML 重建）

  function resetMine() { mine = { phase: 'idle', since: 0, biteAt: 0 }; }
  function resetTa() { ta = { phase: 'idle', until: 0, next: 0 }; }
  resetMine(); resetTa();

  // ---- 玩家：抛竿 → 等待 → 咬钩时机条 → 收竿 ----
  function castMine() {
    if (mine.phase === 'waiting' || mine.phase === 'biting') return;
    sfxCast();
    addStats({ totalCast: 1 });
    if (statusEl) delete statusEl.dataset.keep;
    mine.phase = 'waiting'; mine.since = Date.now();
    mine.biteAt = Date.now() + rand(2000, 4500);
    const wait = mine.biteAt - Date.now();
    clearTimeout(mine._tm); mine._tm = setTimeout(function () {
      if (mine.phase !== 'waiting') return;
      startBiting();
    }, wait);
    render();
  }
  function startBiting() {
    mine.phase = 'biting'; mine.biteStart = Date.now(); mine.biteDur = 1600;
    sfxBite();
    if (timingRafId) cancelAnimationFrame(timingRafId);
    const loop = function (ts) {
      if (mine.phase !== 'biting') { timingRafId = null; return; }
      const p = Math.min(1, (Date.now() - mine.biteStart) / mine.biteDur);
      mine.progress = p;
      updateTimingVisual(p);
      if (p >= 1) { timingRafId = null; reelMine(); }
      else timingRafId = requestAnimationFrame(loop);
    };
    timingRafId = requestAnimationFrame(loop);
    render();
  }
  function reelMine() {
    if (mine.phase !== 'biting') return;
    const p = (mine.progress == null) ? 0 : mine.progress;
    let quality;
    if (p >= 0.38 && p <= 0.68) quality = 'perfect';
    else if ((p >= 0.2 && p < 0.38) || (p > 0.68 && p <= 0.85)) quality = 'good';
    else quality = 'poor';
    const pity = missStreak >= 5;
    const hit = pity || Math.random() < successRate(quality);
    if (timingRafId) { cancelAnimationFrame(timingRafId); timingRafId = null; }
    if (hit) {
      const item = rollFish(quality);
      sfxCatch();
      gainMine(item);
      flashScene(true, item);
      // FIX 2026-09-16：接游乐室三件套——幸运日打卡 + 完美收竿 8% 掉限定摆件（此前 fishing 完全不在体系内）
      try {
        if (window.arcadeMarkLuckyPlayed) window.arcadeMarkLuckyPlayed('fishing');
        if (quality === 'perfect' && window.arcadeTryDrop) {
          const fdp = window.arcadeTryDrop('fishing');
          if (fdp) setTimeout(function () { toast('🎁 掉落限定摆件「' + fdp.name + '」'); }, 600);
        }
      } catch (e) {}
      if (pity) { statusText('保底命中！钓到了 ' + item.icon + ' ' + item.name); missStreak = 0; }
      else if (quality === 'perfect') { statusText('完美收竿！钓到了 ' + item.icon + ' ' + item.name); addStats({ perfectCatch: 1 }); }
      else statusText('收竿！钓到了 ' + item.icon + ' ' + item.name);
    } else {
      sfxMiss();
      flashScene(false);
      missStreak++;
      let msg = '鱼跑了…（' + (quality === 'perfect' ? '差一点点' : '时机不对') + '）';
      if (missStreak === 3 || missStreak === 4) msg += ' 别急，慢慢来';
      statusText(msg);
      if (Math.random() < 0.15) { setTimeout(function () { sendTaLine(fit('TA：') + pick(TA_COMFORT), false); }, 500); }
    }
    mine.phase = 'idle'; mine.progress = null;
    render();
  }
  function gainMine(item) {
    const t = loadToday();
    t.mine[item.id] = (t.mine[item.id] || 0) + 1;
    saveToday(t);
    markDex(item);
  }

  // ---- 图鉴记录（首次钓到弹提示） ----
  function markDex(item) {
    const d = loadDex();
    if (!d[item.id]) {
      d[item.id] = true; saveDex(d);
      toast('发现新物品！' + item.icon + ' ' + item.name);
    }
  }

  // ---- 玩家收竿成功后的场景反馈（水花 + 徽章） ----
  function flashScene(got, item) {
    const wp = sceneEl.querySelector('.fish-water');
    if (!wp) return;
    const existing = wp.querySelectorAll('.fish-splash');
    if (existing.length >= 3 && existing[0].parentNode) existing[0].parentNode.removeChild(existing[0]);
    const splash = document.createElement('div');
    splash.className = 'fish-splash' + (got ? ' ok' : '');
    splash.textContent = got ? (item ? item.icon : '🐟') : '💨';
    wp.appendChild(splash);
    setTimeout(function () { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 1200);
  }

  // ---- TA 状态机（概率行为，独立定时器） ----
  function taStep() {
    const now = Date.now();
    if (ta.phase === 'idle' || (ta.phase !== 'rest' && ta.phase !== 'waiting' && ta.phase !== 'biting' && now >= ta.next)) {
      ta.decide(now);
    } else if (now < ta.until) {
      // 状态持续中
    } else {
      ta.resolve(now);
    }
    render();
  }
  resetTa = function () {
    ta = {
      phase: 'idle', until: 0, next: 0,
      decide: function (now) {
        const r = Math.random();
        if (r < 0.05) { this.phase = 'rest'; this.until = now + rand(4000, 9000); this.next = now + rand(9000, 15000); }
        else if (r < 0.15) { this.phase = 'daze'; this.until = now + rand(2000, 5000); this.next = now + rand(5000, 9000); }
        else if (r < 0.25) { this.phase = 'shift'; this.until = now + rand(1500, 3500); this.next = now + rand(2500, 4500); }
        else {
          // 钓鱼：抛竿 → 等待（随机时长）→ 咬钩 → 收竿
          this.phase = 'casting'; this.until = now + rand(800, 1500);
          this.castAt = now; this.biteAt = now + rand(3000, 8000);
        }
      },
      resolve: function (now) {
        switch (this.phase) {
          case 'casting': this.phase = 'waiting'; this.until = this.biteAt; this.next = this.biteAt; break;
          case 'waiting':
            this.phase = 'biting'; this.until = now + rand(900, 1800); this.next = this.until; break;
          case 'biting':
            if (Math.random() < 0.8) {
              const item = rollTaItem();
              sfxCatch();
              taCaught(item);
            } else {
              sfxMiss();
              statusText(taWord() + ' 的鱼跑了…');
            }
            this.phase = 'idle'; this.next = now + rand(1500, 4000); break;
          default: this.phase = 'idle'; this.next = now + rand(1500, 3500);
        }
      }
    };
  };
  resetTa();
  function taCaught(item) {
    if (item.cat === 'gift') {
      // 纪念品：进「TA 送我的东西」收藏 + 触发送礼互动（不进入今日收获出售区）
      const g = loadGifts();
      g.unshift({ id: item.id, ts: Date.now() });
      saveGifts(g);
      sfxGift();
      const note = giftNoteFor(item);
      statusText(taWord() + ' 钓到了 ' + item.icon + ' ' + item.name + '，并把它送给了你。');
      sendTaLine(fit('TA：') + note, true);
    } else {
      const t = loadToday();
      t.ta[item.id] = (t.ta[item.id] || 0) + 1; saveToday(t);
      markDex(item);
      statusText(taWord() + ' 钓到了 ' + item.icon + ' ' + item.name);
      maybeTaCook(item.id);
      // 漂流花：概率触发赠送互动（花仍可出售）
      if (item.giftNote === 'flower' && Math.random() < 0.5) {
        const note = giftNoteFor(item);
        setTimeout(function () { sendTaLine(fit('TA：') + note, false); }, 700);
      } else if (item.r >= 4 && Math.random() < 0.5) {
        setTimeout(function () { sendTaLine(fit('TA：') + pick(TA_PROUD), false); }, 600);
      } else if (Math.random() < 0.3) {
        setTimeout(function () { sendTaLine(fit('TA：') + pick(TA_HAPPY), false); }, 600);
      }
    }
  }
  // ---- TA 钓鱼互动话术（开心/得意/安慰，内置兜底） ----
  const TA_HAPPY = ['钓到了！', '今天运气不错。', '这条给你看看。', '嘿嘿，上钩了。'];
  const TA_PROUD = ['难得的收获呢。', '这条很漂亮吧。', '好久没钓到这么好的了。'];
  const TA_COMFORT = ['没事，再试一次。', '鱼很狡猾的。', '别灰心，慢慢来。', '跑掉的总是比较大的。'];
  function sendTaLine(text, glow) {
    try { if (window.chatAddIn) window.chatAddIn(glow ? '💝 ' + text : text, { silent: true }); } catch (e) {}
  }

  // ---- 一起钓鱼陪伴奖励（双方同时在场累计 5 分钟，每日一次） ----
  const TOGETHER_GOAL = 300; // 秒
  function startTogetherTimer() {
    stopTogetherTimer();
    const t0 = loadTogether();
    togetherSec = t0.sec; togetherRewarded = t0.rewarded;
    togetherTimer = setInterval(function () {
      if (!open) return;
      const bothFishing = (mine.phase === 'waiting' || mine.phase === 'biting') && (ta.phase === 'casting' || ta.phase === 'waiting' || ta.phase === 'biting');
      if (!bothFishing) return;
      if (togetherRewarded) return;
      togetherSec++;
      if (togetherSec % 10 === 0) { const t = loadTogether(); t.sec = togetherSec; t.rewarded = !!togetherRewarded; saveTogether(t); }
      if (togetherSec >= TOGETHER_GOAL) {
        togetherRewarded = true;
        const t = loadTogether(); t.sec = togetherSec; t.rewarded = true; saveTogether(t);
        if (window.giftWalletChange) window.giftWalletChange(1314, 1314, '钓鱼陪伴奖励');
        sfxGift();
        toast('💕 陪伴奖励：一起钓鱼 5 分钟，心意币各 +¥13.14');
        if (window.chatAddIn) { try { window.chatAddIn(fit('陪了我这么久，鱼都知道你不走了。') + '（陪伴奖励各 +¥13.14）', { silent: true }); } catch (e) {} }
      }
    }, 1000);
  }
  function stopTogetherTimer() {
    if (togetherTimer) { clearInterval(togetherTimer); togetherTimer = null; }
    if (togetherSec >= 0) { const t = loadTogether(); t.sec = togetherSec; t.rewarded = !!togetherRewarded; saveTogether(t); togetherSec = -1; togetherRewarded = null; }
  }

  // ---- 出售（今日收获 → 心意币） ----
  function sellAll() {
    const t = loadToday();
    const keep = t.keep || {};
    let total = 0, count = 0;
    const sold = {};
    ['mine', 'ta'].forEach(function (side) {
      Object.keys(t[side]).forEach(function (id) {
        const it = ITEM_MAP[id];
        if (!it || it.cat === 'gift') return;
        if (keep[keepKey(side, id)]) return;
        const n = t[side][id] || 0;
        total += it.price * n; count += n;
        sold[side] = sold[side] || {}; sold[side][id] = 1;
      });
    });
    if (count === 0) { toast('没有可出售的收获（勾选「留」的不卖）'); return; }
    if (fishCoinCap() >= 10400) { toast('今日钓鱼收入已达上限（¥104），明天再来卖吧'); return; }
    // FIX 2026-09-16：①先落盘（扣鱼）再入账——原「先发钱后落盘」在配额异常时钱到账、鱼没扣，可反复出售；
    // ②幸运日奖励 ×2 + ¥104 日封顶（grantFishCoin 内先记账后发钱）
    Object.keys(sold).forEach(function (side) { Object.keys(sold[side]).forEach(function (id) { delete t[side][id]; }); });
    // 清掉该侧已无存货的「留」标记，否则同品种当天再钓到会被残留标记自动置留
    Object.keys(t.keep).forEach(function (k) {
      const i = k.indexOf(':');
      const side = k.slice(0, i), id = k.slice(i + 1);
      if (!t[side] || !t[side][id]) delete t.keep[k];
    });
    try { saveToday(t); } catch (e) { toast('出售失败：存储暂不可用'); return; }
    const fishMult = (window.arcadeMult && window.arcadeMult('fishing')) || 1;
    const realGot = grantFishCoin(total * fishMult, '钓鱼出售');
    addStats({ totalEarned: realGot });
    sfxSell();
    toast('已出售 ' + count + ' 件，心意币各 +' + fenToStr(realGot) + (realGot < total ? '（已达今日上限）' : ''));
    render();
  }

  // ---- 兑换 TA 送的纪念品为心意币（v3.15.x 二调：¥5.2，对齐红包小额档） ----
  function exchangeGift(idx) {
    const g = loadGifts();
    const item = g[idx]; if (!item) return;
    g.splice(idx, 1); saveGifts(g);
    // v3.16.x：兑换 TA 纪念品双方同步同额（原只加我的余额）
    if (window.giftWalletChange) window.giftWalletChange(520, 520, '纪念品兑换');
    sfxSell();
    toast('已兑换心意币各 +¥5.2');
    render();
  }

  // ---- 烹饪系统（玩家 + TA；时间戳现算，仿 garden 离线友好） ----
  function cookKey() { return 'fishing-cook'; }
  function loadCook() { const c = readJSON(cookKey(), null); return c && typeof c === 'object' ? c : { mine: [], ta: [], taWeek: { weekKey: '', count: 0 } }; }
  function saveCook(c) { writeJSON(cookKey(), c); }
  function weekKey() { const d = new Date(); const thu = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (4 - (d.getDay() || 7))); const wk = Math.ceil((((thu - new Date(thu.getFullYear(), 0, 1)) / 86400000) + 1) / 7); return d.getFullYear() + '-W' + wk; }
  function taCookCountThisWeek() { const c = loadCook(); return (c.taWeek && c.taWeek.weekKey === weekKey()) ? c.taWeek.count : 0; }
  function cookStatus(entry) {
    const d = dishOf(entry.fishId); if (!d) return null;
    const now = Math.floor(Date.now() / 1000), elapsed = now - entry.startedAt;
    return { dish: d, done: elapsed >= d.cookSec, progress: Math.min(1, elapsed / d.cookSec), remainSec: Math.max(0, d.cookSec - elapsed), elapsed: elapsed };
  }
  function loadBox() { const s = store(); if (!s) return []; try { const a = JSON.parse(s.get('giftbox-items') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function saveBox(a) { const s = store(); if (s) s.set('giftbox-items', JSON.stringify(a)); }
  const TA_COOK_WISH = ['给你尝尝。', '刚做好的，趁热吃。', '这道菜想让你试试。', '用心做的，希望你喜欢。'];
  function cookMine(fishId) {
    const d = dishOf(fishId); if (!d) { toast('这种鱼不能烹饪'); return; }
    const t = loadToday();
    if (!t.mine[fishId] || t.mine[fishId] < 1) { toast('今日没有这种鱼'); return; }
    t.mine[fishId]--; if (t.mine[fishId] <= 0) delete t.mine[fishId]; saveToday(t);
    const c = loadCook();
    c.mine.push({ fishId: fishId, startedAt: Math.floor(Date.now() / 1000), quality: 'good' });
    saveCook(c); sfxCast();
    toast('开始烹饪 ' + d.emoji + ' ' + d.name + '，约 ' + Math.round(d.cookSec / 60) + ' 分钟');
    render();
  }
  function sellDish(idx) {
    const c = loadCook(); const entry = c.mine[idx]; if (!entry) return;
    const st = cookStatus(entry); if (!st || !st.done) { toast('还没烹饪好'); return; }
    const price = dishPrice(entry.fishId, entry.quality);
    if (fishCoinCap() >= 10400) { toast('今日钓鱼收入已达上限（¥104），明天再卖吧'); return; }
    c.mine.splice(idx, 1);
    // FIX 2026-09-16：先落盘（扣菜）再入账 + 幸运日 ×2 + 日封顶（同 sellAll 口径）
    try { saveCook(c); } catch (e) { toast('出售失败：存储暂不可用'); return; }
    const dishMult = (window.arcadeMult && window.arcadeMult('fishing')) || 1;
    const realGot = grantFishCoin(price * dishMult, '烹饪出售');
    addStats({ totalEarned: realGot }); sfxSell();
    toast('出售 ' + st.dish.name + '，心意币各 +' + fenToStr(realGot) + (realGot < price ? '（已达今日上限）' : '')); render();
  }
  function sendDishToTa(idx) {
    const c = loadCook(); const entry = c.mine[idx]; if (!entry) return;
    const st = cookStatus(entry); if (!st || !st.done) { toast('还没烹饪好'); return; }
    const price = dishPrice(entry.fishId, entry.quality);
    c.mine.splice(idx, 1); saveCook(c);
    if (window.recordGiftBox) window.recordGiftBox({ id: 'dish_' + entry.fishId, name: st.dish.name, emoji: st.dish.emoji, price: price / 100, cat: '菜肴' }, 'out', '给你尝尝我的手艺');
    if (window.chatAddGift) window.chatAddGift({ side: 'out', special: 'dish', dishName: st.dish.name, dishEmoji: st.dish.emoji, dishWish: '给你尝尝', dishQuality: entry.quality, dishPrice: price / 100, ts: Date.now() });
    sfxGift(); toast('已把 ' + st.dish.name + ' 送给 ' + taWord()); render();
  }
  function maybeTaCook(fishId) {
    const d = dishOf(fishId); if (!d) return;
    if (taCookCountThisWeek() >= 3) return;
    if (Math.random() >= 0.08) return;
    const c = loadCook();
    if (c.taWeek.weekKey !== weekKey()) c.taWeek = { weekKey: weekKey(), count: 0 };
    c.taWeek.count++;
    c.ta.push({ fishId: fishId, startedAt: Math.floor(Date.now() / 1000), quality: 'good' });
    saveCook(c); statusText(taWord() + ' 开始烹饪 ' + d.emoji + ' ' + d.name + '…');
  }
  function checkTaCookDone() {
    const c = loadCook(); if (!c.ta.length) return;
    let changed = false;
    for (let i = c.ta.length - 1; i >= 0; i--) {
      const entry = c.ta[i]; const st = cookStatus(entry); if (!st || !st.done) continue;
      const d = st.dish; const price = dishPrice(entry.fishId, entry.quality);
      c.ta.splice(i, 1); changed = true;
      if (Math.random() < 0.8) {
        if (window.recordGiftBox) window.recordGiftBox({ id: 'dish_' + entry.fishId, name: d.name, emoji: d.emoji, price: price / 100, cat: '菜肴' }, 'in', pick(TA_COOK_WISH));
        if (window.chatAddGift) window.chatAddGift({ side: 'in', special: 'dish', dishName: d.name, dishEmoji: d.emoji, dishWish: pick(TA_COOK_WISH), dishQuality: entry.quality, dishPrice: price / 100, ts: Date.now() });
        sfxGift(); toast('💕 ' + taWord() + ' 烹饪了 ' + d.emoji + ' ' + d.name + ' 送给你！');
      } else { statusText(taWord() + ' 烹饪了 ' + d.name + '，自己吃了'); }
    }
    if (changed) saveCook(c);
  }
  function eatDish(boxIdx) {
    const box = loadBox(); const item = box[boxIdx]; if (!item) return;
    const eatPrice = Math.round((item.price || 0) * 100 * 0.5);
    box.splice(boxIdx, 1); saveBox(box);
    if (window.giftWalletChange) window.giftWalletChange(eatPrice, 0, '吃掉收到的菜');
    sfxSell(); toast('吃掉 ' + item.name + '，心意币 +¥' + fenToStr(eatPrice)); render();
  }

  // ---- 渲染 ----
  function statusText(t) {
    if (!statusEl) return;
    statusEl.textContent = t;
    // FIX 2026-09-16：收竿/跑鱼/TA 钓到的结算文案原先被随后的 render() 同帧清空
    // （idle+today 分支），用户根本看不到——设 keep 保留 2.5s 后自动恢复常规提示
    statusEl.dataset.keep = '1';
    clearTimeout(statusEl._keepT);
    statusEl._keepT = setTimeout(function () {
      if (!statusEl) return;
      delete statusEl.dataset.keep;
      if (open) render();
    }, 2500);
  }
  function updateTimingVisual(p) {
    if (!timingWrapEl) return;
    timingWrapEl.hidden = false;
    if (timingCursorEl) timingCursorEl.style.left = (p * 100).toFixed(1) + '%';
  }
  function render() {
    checkTaCookDone();
    // 标题
    if (partnerNameEl) partnerNameEl.textContent = taWord();
    // 场景 class（反映双方状态）
    const sc = sceneEl;
    if (sc) {
      sc.setAttribute('data-mine', mine.phase);
      sc.setAttribute('data-ta', ta.phase);
      const taStateEl = sc.querySelector('.fish-ta-state'); if (taStateEl) taStateEl.textContent = taStateLabel();
    }
    // 按钮：等待期保留禁用态「等待鱼漂…」（避免按钮区塌陷跳动）；咬钩期只显示收竿
    const bitting = mine.phase === 'biting';
    if (castBtn) {
      const waiting = mine.phase === 'waiting';
      castBtn.hidden = bitting;
      castBtn.disabled = waiting;
      castBtn.textContent = waiting ? '等待鱼漂…' : '抛竿';
    }
    if (reelBtn) reelBtn.hidden = !bitting;
    if (timingWrapEl) timingWrapEl.hidden = !bitting;
    // 默认状态提示
    if (statusEl && !statusEl.dataset.keep) {
      if (mine.phase === 'waiting') statusEl.textContent = '鱼漂已下水，等 TA 咬钩…';
      else if (mine.phase === 'idle' && curTab === 'today') statusEl.textContent = '';
    }
    renderPage();
  }
  function taStateLabel() {
    switch (ta.phase) {
      case 'casting': return '抛竿';
      case 'waiting': return '静静等';
      case 'biting': return '有鱼！';
      case 'rest': return '休息';
      case 'daze': return '发呆';
      case 'shift': return '换位置';
      default: return '待着';
    }
  }
  function renderPage() {
    if (!pageEl) return;
    let key;
    if (curTab === 'today') key = 'today:' + JSON.stringify(loadToday());
    else if (curTab === 'dex') key = 'dex:' + JSON.stringify(loadDex()) + ':' + JSON.stringify(loadStats());
    else if (curTab === 'cook') {
      // FIX 2026-09-16：脏键不再含秒级时间戳（原每 1.2s 整页 innerHTML 重建——iOS 周期性强制重排，
      // 且重建瞬间会吞掉正在点「出售/送TA/吃掉」的那次 tap）；只剩倒计时变化走 updateCookProgress 就地更新，
      // 结构（出锅/放入/取出）变化才整页重建。
      const ck2 = loadCook();
      key = 'cook:' + JSON.stringify(loadToday()) + JSON.stringify(loadBox()) + ':'
        + ck2.mine.map(function (e) { const s = cookStatus(e); return s ? (e.fishId + (s.done ? 'd' : 'c')) : ''; }).join(',')
        + ':' + ck2.ta.map(function (e) { const s = cookStatus(e); return s ? (e.fishId + (s.done ? 'd' : 'c')) : ''; }).join(',');
    }
    else key = 'gifts:' + JSON.stringify(loadGifts());
    if (key === _lastPageKey) { if (curTab === 'cook') updateCookProgress(); return; }
    _lastPageKey = key;
    if (curTab === 'today') pageEl.innerHTML = renderToday();
    else if (curTab === 'dex') pageEl.innerHTML = renderDex();
    else if (curTab === 'cook') pageEl.innerHTML = renderCook();
    else if (curTab === 'gifts') pageEl.innerHTML = renderGifts();
  }
  // 厨房页签烹饪中的行：进度条/剩余时间就地更新（与 renderPage 的行序一致：我的灶台→TA 的灶台）
  function updateCookProgress() {
    if (!pageEl) return;
    const c = loadCook();
    const fills = pageEl.querySelectorAll('.fish-cook-row:not(.done) .fish-cook-fill');
    const cnts = pageEl.querySelectorAll('.fish-cook-row:not(.done) .fish-cnt');
    const entries = [];
    c.mine.forEach(function (e) { const s = cookStatus(e); if (s && !s.done) entries.push(s); });
    c.ta.forEach(function (e) { const s = cookStatus(e); if (s && !s.done) entries.push(s); });
    for (let i = 0; i < entries.length && i < fills.length; i++) {
      if (fills[i]) fills[i].style.width = Math.round(entries[i].progress * 100) + '%';
      const remain = entries[i].remainSec;
      if (cnts[i]) cnts[i].textContent = remain >= 60 ? Math.ceil(remain / 60) + '分' : remain + '秒';
    }
  }
  function renderToday() {
    const t = loadToday();
    const keep = t.keep || {};
    let total = 0, count = 0;
    function rows(side) {
      const m = t[side] || {};
      const ids = Object.keys(m);
      if (!ids.length) return '<div class="fish-empty">还没有收获</div>';
      let html = '';
      ids.forEach(function (id) {
        const it = ITEM_MAP[id]; if (!it) return;
        const n = m[id];
        const p = it.price * n;
        const sellable = it.cat !== 'gift';
        const kept = !!keep[keepKey(side, id)];
        if (sellable && !kept) { total += p; count += n; }
        html += '<div class="fish-row"><span class="fish-ico">' + it.icon + '</span><span class="fish-name">' + esc(it.name) + (it.cat === 'gift' ? '<i class="fish-gift-tag">已收藏</i>' : '') + '</span><span class="fish-cnt">×' + n + '</span>' + (sellable ? '<label class="fish-keep"><input type="checkbox" class="fish-keep-cb" data-side="' + side + '" data-id="' + id + '"' + (kept ? ' checked' : '') + '><span>留</span></label><span class="fish-price">+' + fenToStr(p) + '</span>' : '<span class="fish-price">纪念</span>') + '</div>';
      });
      return html;
    }
    const html =
      '<div class="fish-sub">今日收获</div>' +
      '<div class="fish-subhead">你</div>' + rows('mine') +
      '<div class="fish-subhead">' + esc(taWord()) + '</div>' + rows('ta') +
      '<div class="fish-sellbar">' + (count ? '<span>可出售 ' + count + ' 件 · <b>+' + fenToStr(total) + '</b> 心意币（勾「留」不卖）</span>' : '<span>没有可出售的收获</span>') + '<button class="fish-sell" id="fish-sell-btn"' + (count ? '' : ' disabled') + '>出售</button></div>';
    return html;
  }
  function renderDex() {
    const d = loadDex();
    let html = '<div class="fish-sub">我的鱼图鉴</div><div class="fish-dex-grid">';
    ITEMS.forEach(function (it) {
      const got = !!d[it.id];
      html += '<div class="fish-dex-item' + (got ? ' got' : '') + '"><span class="fish-dex-ico">' + (got ? it.icon : '?') + '</span><span class="fish-dex-name">' + esc(it.name) + '</span>' + (got ? '<span class="fish-dex-check">✓</span>' : '') + '</div>';
    });
    html += '</div>';
    const gotCount = Object.keys(d).length;
    html += '<div class="fish-dex-foot">已发现 ' + gotCount + ' / ' + ITEMS.length + '</div>';
    const st = loadStats();
    html += '<div class="fish-stats">累计抛竿 <b>' + st.totalCast + '</b> · 完美收竿 <b>' + st.perfectCatch + '</b> · 累计赚 <b>¥' + fenToStr(st.totalEarned) + '</b></div>';
    return html;
  }
  function renderGifts() {
    const g = loadGifts();
    const html =
      '<div class="fish-sub">TA 送我的东西</div>' +
      (g.length ? g.map(function (item, idx) {
        const it = ITEM_MAP[item.id]; if (!it) return '';
        return '<div class="fish-row"><span class="fish-ico">' + it.icon + '</span><span class="fish-name">' + esc(it.name) + '</span><span class="fish-gift-ts">' + esc(fmtTs(item.ts)) + '</span><button class="fish-exch" data-idx="' + idx + '">兑换 ¥5.20</button></div>';
      }).join('') : '<div class="fish-empty">TA 还没送你东西，继续一起钓鱼吧～</div>');
    return html;
  }
  function renderCook() {
    const c = loadCook();
    let html = '<div class="fish-sub">厨房</div>';
    html += '<div class="fish-subhead">我的灶台</div>';
    if (!c.mine.length) html += '<div class="fish-empty">灶台空着，从下面选鱼烹饪</div>';
    c.mine.forEach(function (entry, idx) {
      const st = cookStatus(entry); if (!st) return;
      const it = ITEM_MAP[entry.fishId];
      if (st.done) {
        const price = dishPrice(entry.fishId, entry.quality);
        html += '<div class="fish-cook-row done"><span class="fish-ico">' + st.dish.emoji + '</span><span class="fish-name">' + esc(st.dish.name) + '<i class="fish-cook-tag">已出锅</i></span><span class="fish-price">¥' + fenToStr(price) + '</span><button class="fish-cook-sell" data-idx="' + idx + '">出售</button><button class="fish-cook-send" data-idx="' + idx + '">送TA</button></div>';
      } else {
        const pct = Math.round(st.progress * 100);
        html += '<div class="fish-cook-row"><span class="fish-ico">' + (it ? it.icon : '🐟') + '</span><span class="fish-name">烹饪 ' + esc(st.dish.name) + '</span><div class="fish-cook-bar"><div class="fish-cook-fill" style="width:' + pct + '%"></div></div><span class="fish-cnt">' + (st.remainSec >= 60 ? Math.ceil(st.remainSec / 60) + '分' : st.remainSec + '秒') + '</span></div>';
      }
    });
    html += '<div class="fish-subhead">' + esc(taWord()) + ' 的灶台</div>';
    if (!c.ta.length) html += '<div class="fish-empty">' + esc(taWord()) + ' 没在烹饪</div>';
    c.ta.forEach(function (entry) {
      const st = cookStatus(entry); if (!st) return;
      const it = ITEM_MAP[entry.fishId];
      if (st.done) {
        html += '<div class="fish-cook-row done"><span class="fish-ico">' + st.dish.emoji + '</span><span class="fish-name">' + esc(st.dish.name) + '<i class="fish-cook-tag">已出锅</i></span></div>';
      } else {
        const pct = Math.round(st.progress * 100);
        html += '<div class="fish-cook-row"><span class="fish-ico">' + (it ? it.icon : '🐟') + '</span><span class="fish-name">' + esc(taWord()) + ' 在烹饪 ' + esc(st.dish.name) + '</span><div class="fish-cook-bar"><div class="fish-cook-fill" style="width:' + pct + '%"></div></div><span class="fish-cnt">' + (st.remainSec >= 60 ? Math.ceil(st.remainSec / 60) + '分' : st.remainSec + '秒') + '</span></div>';
      }
    });
    const t = loadToday();
    const cookable = Object.keys(t.mine).filter(function (id) { return dishOf(id) && t.mine[id] > 0; });
    if (cookable.length) {
      html += '<div class="fish-subhead">可烹饪的鱼</div>';
      cookable.forEach(function (id) {
        const it = ITEM_MAP[id]; const d = dishOf(id);
        html += '<div class="fish-cook-row"><span class="fish-ico">' + it.icon + '</span><span class="fish-name">' + esc(it.name) + ' → ' + esc(d.name) + '</span><span class="fish-cnt">×' + t.mine[id] + '</span><button class="fish-cook-btn" data-fish="' + id + '">烹饪' + Math.round(d.cookSec / 60) + '分</button></div>';
      });
    }
    const box = loadBox(); const dishes = box.map(function (b, i) { return Object.assign({}, b, { _idx: i }); }).filter(function (b) { return b.side === 'in' && b.cat === '菜肴'; });
    if (dishes.length) {
      html += '<div class="fish-subhead">收到的菜（可吃掉换币）</div>';
      dishes.forEach(function (b) {
        html += '<div class="fish-cook-row"><span class="fish-ico">' + (b.emoji || '🍽️') + '</span><span class="fish-name">' + esc(b.name) + '</span><span class="fish-price">吃+¥' + fenToStr(Math.round((b.price || 0) * 100 * 0.5)) + '</span><button class="fish-eat-btn" data-idx="' + b._idx + '">吃掉</button></div>';
      });
    }
    return html;
  }
  function fmtTs(ts) { const d = new Date(ts); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

  // ---- 事件 ----
  if (castBtn) castBtn.addEventListener('click', function (e) { e.stopPropagation(); castMine(); });
  if (reelBtn) reelBtn.addEventListener('click', function (e) { e.stopPropagation(); reelMine(); });
  if (soundBtn) soundBtn.addEventListener('click', function (e) { e.stopPropagation(); soundOn = !soundOn; soundBtn.textContent = soundOn ? '🔊' : '🔇'; soundBtn.classList.toggle('off', !soundOn); });
  if (pageEl) pageEl.addEventListener('click', function (e) {
    const sell = e.target.closest && e.target.closest('#fish-sell-btn');
    if (sell) { e.stopPropagation(); sellAll(); return; }
    const exch = e.target.closest && e.target.closest('.fish-exch');
    if (exch) { e.stopPropagation(); exchangeGift(parseInt(exch.getAttribute('data-idx'), 10)); return; }
    const cookBtn = e.target.closest && e.target.closest('.fish-cook-btn');
    if (cookBtn) { e.stopPropagation(); cookMine(cookBtn.getAttribute('data-fish')); return; }
    const cookSell = e.target.closest && e.target.closest('.fish-cook-sell');
    if (cookSell) { e.stopPropagation(); sellDish(parseInt(cookSell.getAttribute('data-idx'), 10)); return; }
    const cookSend = e.target.closest && e.target.closest('.fish-cook-send');
    if (cookSend) { e.stopPropagation(); sendDishToTa(parseInt(cookSend.getAttribute('data-idx'), 10)); return; }
    const eatBtn = e.target.closest && e.target.closest('.fish-eat-btn');
    if (eatBtn) { e.stopPropagation(); eatDish(parseInt(eatBtn.getAttribute('data-idx'), 10)); return; }
  });
  if (pageEl) pageEl.addEventListener('change', function (e) {
    const cb = e.target.closest && e.target.closest('.fish-keep-cb');
    if (!cb) return;
    e.stopPropagation();
    const t = loadToday();
    const key = keepKey(cb.getAttribute('data-side'), cb.getAttribute('data-id'));
    if (cb.checked) t.keep[key] = 1; else delete t.keep[key];
    saveToday(t);
    render();
  });
  tabEls.forEach(function (tab) {
    tab.addEventListener('click', function (e) {
      e.stopPropagation();
      curTab = tab.getAttribute('data-ftab');
      tabEls.forEach(function (x) { x.classList.toggle('sel', x === tab); });
      render();
    });
  });
  panel.querySelector('.fish-close').addEventListener('click', function (e) { e.stopPropagation(); closeFishPanel(); });

  // ---- 入口（供 chat.js 调用） ----
  // 兄弟半框互斥（connect-four 同款）：打开钓鱼时收起其他浮层；任何兄弟面板被打开时自动收起本面板
  const FISH_SIBLING_IDS = ['poke-card', 'emoji-panel', 'chat-search', 'chat-ask-panel', 'chat-divine-panel', 'chat-decision-panel', 'chat-gdecision-panel', 'chat-rps-panel', 'chat-rp-panel', 'chat-call-panel', 'chat-pong-panel', 'chat-snake-panel', 'chat-brick-panel', 'chat-c4-panel', 'chat-memory-panel', 'chat-ms-panel', 'chat-more-panel'];
  function hideSiblings() {
    FISH_SIBLING_IDS.forEach(function (id) { const el = document.getElementById(id); if (el && el !== panel) el.hidden = true; });
    try { if (window.closeAvlib) window.closeAvlib(); } catch (e) {}
  }
  (function bindFishMutual() {
    try {
      if (!window.MutationObserver) return;
      const mo = new MutationObserver(function () {
        if (!panel || panel.hidden || !window.closeFishPanel) return;
        for (let i = 0; i < FISH_SIBLING_IDS.length; i++) {
          const el = document.getElementById(FISH_SIBLING_IDS[i]);
          if (el && !el.hidden) { try { window.closeFishPanel(); } catch (e) {} break; }
        }
      });
      FISH_SIBLING_IDS.forEach(function (id) { const el = document.getElementById(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] }); });
    } catch (e) {}
  })();
  window.openFishPanel = function () {
    try { if (isFs) toggleFs(); } catch (e) {}
    if (!panel) return;
    hideSiblings();
    resetTa();
    resetMine();
    panel.hidden = false;
    open = true;
    if (partnerNameEl) partnerNameEl.textContent = taWord();
    stopTaTimer();
    taTimer = setInterval(taStep, 1200);
    startTogetherTimer();
    // 停在心跳
    statusEl.dataset.keep = '1';
    statusEl.textContent = '你和 ' + taWord() + ' 在水边坐下，点「抛竿」开始。';
    render();
  };
  window.closeFishPanel = function () {
    open = false;
    stopTaTimer();
    stopTogetherTimer();
    if (timingRafId) { cancelAnimationFrame(timingRafId); timingRafId = null; }
    stopMineTimer();
    resetMine(); resetTa();
    if (statusEl) delete statusEl.dataset.keep;
    if (panel) panel.hidden = true;
  };
  function stopTaTimer() { if (taTimer) { clearInterval(taTimer); taTimer = null; } }
  function stopMineTimer() { if (mine && mine._tm) { clearTimeout(mine._tm); mine._tm = null; } }
  document.addEventListener('contact-switched', function () { try { closeFishPanel(); } catch (e) {} });

  // ---- 只读/驯化测试钩子（tools/verify-fishing-ui.mjs 专用；不影响正常玩法） ----
  window.__fishDebug = {
    state: function () { return { open: open, mine: mine && mine.phase, ta: ta && ta.phase, today: loadToday(), dex: loadDex(), gifts: loadGifts(), together: loadTogether(), wallet: (window.giftWalletGet ? window.giftWalletGet() : null) }; },
    forceBite: function () { if (mine.phase === 'waiting') { clearTimeout(mine._tm); startBiting(); } return mine.phase; },
    // 以指定进度收竿（p∈0..1，0.5=完美区间中心）；force=true 跳过成功概率必命中（仅测试）
    reelAt: function (p, force) {
      if (mine.phase !== 'biting') return false;
      mine.progress = p;
      if (force) {
        const q = (p >= 0.38 && p <= 0.68) ? 'perfect' : ((p >= 0.2 && p < 0.38) || (p > 0.68 && p <= 0.85)) ? 'good' : 'poor';
        const item = rollFish(q);
        if (timingRafId) { cancelAnimationFrame(timingRafId); timingRafId = null; }
        gainMine(item); flashScene(true, item);
        statusText((q === 'perfect' ? '完美收竿！钓到了 ' : '收竿！钓到了 ') + item.icon + ' ' + item.name);
        mine.phase = 'idle'; mine.progress = null; render();
        return true;
      }
      reelMine(); return true;
    },
    addTaGift: function (id) { const g = loadGifts(); g.unshift({ id: id || 'gift_shell', ts: Date.now() }); saveGifts(g); renderPage(); return true; }
  };
})();