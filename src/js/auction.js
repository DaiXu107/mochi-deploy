// ===== 功能：心意币拍卖会（聊天页更多功能 → 小游戏） =====
// 和 TA 面对面竞拍的三件神秘拍品：看图猜价值，加价轮替出价，落槌价从「心意币」
// 真实账本里扣（走 giftWalletGet/Set 直接扣减，同心意集市购买路径，不误入赚钱流水）；
// 拍下的收进本游戏的 🎒 小收藏（按联系人桌面存 localStorage）。
// TA 无真 AI：每件拍品暗抽一个「心理价位」（底价 × 状态系数）+ 行为状态——
//   eager 志在必得（敢超价位跟价）/ normal 常规 / stingy 提前收手 / bluff 虚张声势
//   （快步加价营造抢手假象，价位一到可能突然放弃）。出价全靠心情，没有算牌。
// 流程：每场 3 件拍品 → 每件你先表态（＋¥1 / ＋¥5 / ＋¥13.14 / 不拍了）→ TA 掂量后
// 跟价或放弃 → 你赢=扣款收藏、TA 赢=TA 收走（不改账本）、没人要=流拍。
// 结算：写聊天系统消息（special:'auction'）+ TA 随机回应（复用字卡库回应分组）。
// 保护：出价不会超过心意币余额（不够只出不拍）；TA 拍走/流拍不动账本。
// 入口绑定在本文件内完成（不改 chat.js），半框容器复用 .poke-card 与 .pong-overlay 组件。
(function () {
  const panel = document.getElementById('chat-auction-panel');
  if (!panel) return;
  const stageEl = document.getElementById('au-stage');
  const itemEl = document.getElementById('au-item');
  const lotEl = document.getElementById('au-lot');
  const balanceEl = document.getElementById('au-balance');
  const statusEl = document.getElementById('au-status');
  const overlayEl = document.getElementById('au-overlay');
  const ovTitleEl = document.getElementById('au-ov-title');
  const ovBodyEl = document.getElementById('au-ov-body');
  const startBtn = document.getElementById('au-btn-start');
  const endBtn = document.getElementById('au-btn-end');
  const bid1Btn = document.getElementById('au-bid1');
  const bid5Btn = document.getElementById('au-bid5');
  const bid13Btn = document.getElementById('au-bid13');
  const passBtn = document.getElementById('au-pass');
  const bagBtn = document.getElementById('au-bag');
  const soundBtn = document.getElementById('au-sound');
  const closeBtn = document.getElementById('au-close');
  const fsBtn = document.getElementById('au-fs');
  // #321 玩法说明：❓ 头部按钮 + 详细规则弹窗（全屏浮层）
  const helpBtn = document.getElementById('au-help-btn');
  const helpOverlay = document.getElementById('au-help');
  const helpClose = document.getElementById('au-help-close');
  const introEl = document.getElementById('au-intro');
  const introStepsEl = document.getElementById('au-intro-steps');
  const introStatEl = document.getElementById('au-intro-stat');
  const introStart = document.getElementById('au-intro-start');
  const introHelp = document.getElementById('au-intro-help');
  const introExit = document.getElementById('au-intro-exit');
  // #346 余额不足/账本未就绪的提示行（出价键静默置灰用户不知道为什么）
  const walletHintEl = document.getElementById('au-wallet-hint');
  // #348 拍卖记录 / 自制拍品入口（头部按钮）
  const historyBtn = document.getElementById('au-history');
  const addBtn = document.getElementById('au-add');
  function showHelp() { if (helpOverlay) helpOverlay.hidden = false; }
  function hideHelp() { if (helpOverlay) helpOverlay.hidden = true; }
  function showIntro() { if (introEl) introEl.hidden = false; }
  function hideIntro() { if (introEl) introEl.hidden = true; }
  if (helpBtn) helpBtn.addEventListener('click', (e) => { e.stopPropagation(); showHelp(); });
  if (helpClose) helpClose.addEventListener('click', (e) => { e.stopPropagation(); hideHelp(); });
  // #321 开场全屏教学：开始 / 详细玩法（两处都重新挂靠到新会话）
  if (introStart) introStart.addEventListener('click', (e) => { e.stopPropagation(); newSession(); });
  if (introHelp) introHelp.addEventListener('click', (e) => { e.stopPropagation(); showHelp(); });
  // #341 教学浮层盖住了头部 ✕，没有出口就走不了——「先不玩」直接收摊关面板
  if (introExit) introExit.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });

  // ---- #306 全屏：面板 fixed 满屏（共享 .game-fs 类，同 pong-fs 机制）。 ----
  // 重开面板无论上次怎么关的（含兄弟互斥直接 hidden）都先退出，防全屏残留 ----
  let isFs = false;
  function toggleFs() {
    isFs = !isFs;
    panel.classList.toggle('game-fs', isFs);
    if (fsBtn) fsBtn.textContent = isFs ? '⤢' : '⛶';
    setTimeout(() => { try { if (typeof fitBoard === 'function') fitBoard(); } catch (e) {} }, 60);
  }
  if (fsBtn) fsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFs(); });
  const partnerNameEl = document.getElementById('au-partner-name');

  const STEP1 = 100, STEP5 = 500, STEP13 = 1314;      // 加价档（分）
  // 拍品池：base=底价(分)，wish=拍下后彩蛋文案；TA 心理价位 = base × 状态系数
  // #301 mystery:1 = 蒙面拍品（开拍只给描述猜是什么，落槌/拍走才揭晓）
  const POOL = [
    { ico: '🌹', name: '永生玫瑰', desc: '不会枯的那种', base: 520, wish: '花会谢，心意不会。' },
    { ico: '🧸', name: 'Mochi 玩偶', desc: '捏起来很解压', base: 900, wish: '想我的时候就捏捏它。' },
    { ico: '🧋', name: '奶茶年卡', desc: '每天一杯半糖去冰', base: 1314, wish: '第一杯请你喝。' },
    { ico: '🎧', name: '降噪耳机', desc: '世界的开关', base: 1990, wish: '戴上就是我的世界。' },
    { ico: '🎮', name: '复古掌机', desc: '内置 520 个小游戏，猜猜是什么', base: 2600, wish: '双人游戏留给你。', mystery: 1 },
    { ico: '📷', name: '拍立得', desc: '把此刻留住', base: 3130, wish: '第一张拍你。' },
    { ico: '⌚', name: '情侣对表', desc: '一对，走时一致，猜猜是什么', base: 5200, wish: '以后时间一起过。', mystery: 1 },
    { ico: '🧣', name: '手织围巾', desc: '织错的针脚都是心意', base: 1314, wish: '歪的地方是我想你。' },
    { ico: '🍰', name: '下午茶券', desc: '双人份，周末有效', base: 520, wish: '周末不见不散。' },
    { ico: '🎫', name: '演唱会门票', desc: '两张，你偶像的，猜猜是什么', base: 3999, wish: '合唱那首你跑调的。', mystery: 1 },
    { ico: '💐', name: '全明星花束', desc: '什么花都有一点', base: 1314, wish: '像你，什么都好。' },
    { ico: '💎', name: '小钻戒', desc: '别紧张，不是那种……大概', base: 9999, wish: '先占个位置。', mystery: 1 }
  ];
  // TA 行为状态：系数=心理价位底价倍数；stepPref=TA 加价档偏好；talk=开场台词；calls=跟价台词库（#348 按状态差异化）
  const TA_MODES = {
    eager:  { factor: 1.5,  stepPref: [STEP5, STEP13, STEP13], talk: '眼睛亮了，志在必得', calls: ['跟！这件我要定了', '就这点诚意？接着', '休想从我手里抢走'] },
    normal: { factor: 1.15, stepPref: [STEP1, STEP5, STEP13],  talk: '掂了掂这件的分量', calls: ['这件我挺喜欢的', '我掂量着值这个价', '那我也加一点'] },
    stingy: { factor: 0.7,  stepPref: [STEP1, STEP1, STEP5],   talk: '皱着眉算了算', calls: ['唔……勉强跟一手', '快超预算了呀', '再贵我就撤了'] },
    bluff:  { factor: 1.2,  stepPref: [STEP13, STEP5, STEP5],  talk: '一路跟得飞快，像真想要', calls: ['加价不加价？跟', '气势不能输', '谁怕谁呀'] }
  };
  const TALK_MIN = 850, TALK_VAR = 900;
  const LOTS_PER_SESSION = 3;

  const T = window.taFit || function (x) { return x; };
  function prefix() { return (window.activePrefix && window.activePrefix()) || 'xy-home-v2'; }
  function fastMul() { return (window.__auDebug && window.__auDebug.fast) ? 0.05 : 1; }
  function pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function yuan(fen) { return '¥' + (fen / 100).toFixed(2); }
  function yuanC(fen) { const v = fen / 100; return Number.isInteger(v) ? '¥' + v : '¥' + v.toFixed(2); } // #321 整数省略 .00，按钮直白些
  // FIX 2026-09-16：自制拍品名称/彩蛋用户可控且多处走 innerHTML——统一转义后再拼
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // ---- #348 成色评级（按底价分档：≥5000 分 SSR / ≥2600 稀有 / 其余 普通）、震动反馈 ----
  const RARITY = [['普通', 'au-r0'], ['稀有', 'au-r1'], ['SSR', 'au-r2']];
  function rarityOf(item) { const r = (item && item.base >= 5000) ? 2 : (item && item.base >= 2600) ? 1 : 0; return { label: RARITY[r][0], cls: RARITY[r][1] }; }
  function buzz(p) {
    try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {}
    try { window.__auDebug.lastBuzz = p; } catch (e) {}
  }
  // ---- #348 落盘双写：localStorage（同步读）+ IndexedDB（防容量/换机），idbSet 可用即写 ----
  // FIX 2026-09-16：返回 localStorage 侧是否写成功（原静默吞 QuotaExceeded——hammer 用它做原子性判断）
  function persist(key, val) {
    let ok = false;
    try { localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val)); ok = true; } catch (e) {}
    try { if (typeof window.idbSet === 'function') window.idbSet(key, val); } catch (e) {}
    return ok;
  }
  // #348 拍卖记录：每件拍品的成交/流拍明细（最近 60 条）
  function historyKey() { return prefix() + ':auction-history'; }
  function loadHistory() { try { const a = JSON.parse(localStorage.getItem(historyKey()) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function recordHistory(item, price, who) {
    const h = loadHistory();
    h.unshift({ t: Date.now(), ico: item.ico, name: item.name, price: price, who: who, rarity: rarityOf(item).label });
    if (h.length > 60) h.length = 60;
    persist(historyKey(), h);
  }
  // #348 自制拍品（每联系人独立，上限 20；添加弹窗里输入已有名称＝删除）
  function customKey() { return prefix() + ':auction-custom'; }
  function loadCustom() { try { const a = JSON.parse(localStorage.getItem(customKey()) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function saveCustom(a) { try { if (a.length > 20) a.length = 20; persist(customKey(), a); } catch (e) {} }
  // #348 自制拍品并入奖池（随机 20% 蒙面登场）
  function activePool() {
    return POOL.concat(loadCustom().map((c) => ({ ico: c.ico, name: c.name, desc: c.desc, base: c.base, wish: c.wish, mystery: c.mystery || 0, custom: 1 })));
  }

  // ---- 音效 ----
  let audioCtx = null;
  let soundOn = true;
  try { soundOn = localStorage.getItem('xy-home-v2:au-sound') !== '0'; } catch (e) {} // #343 音效偏好全局记忆（非联系人维度）
  function beep(freq, dur, vol) {
    if (!soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = freq; o.type = 'sine';
      g.gain.value = vol || 0.16;
      o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur);
    } catch (e) {}
  }
  const sfxBid = () => beep(520, 0.07, 0.15);
  const sfxHammer = () => { beep(880, 0.08, 0.18); setTimeout(() => beep(520, 0.12, 0.16), 90); };
  const sfxLose = () => beep(300, 0.12, 0.14);
  const sfxWin = () => { beep(660, 0.14, 0.2); setTimeout(() => beep(880, 0.2, 0.2), 130); };

  // ---- 心意币账本（直接读改，同心意集市购买路径；读不到时禁拍只围观） ----
  function walletOk() { return typeof window.giftWalletGet === 'function' && typeof window.giftWalletSet === 'function'; }
  function myBalance() {
    try { const w = window.giftWalletGet(); return (w && Number(w.myBalance)) || 0; } catch (e) { return 0; }
  }
  function walletDeduct(fen) {
    try {
      const w = window.giftWalletGet();
      if (!w || (Number(w.myBalance) || 0) < fen) return false;
      w.myBalance = (Number(w.myBalance) || 0) - fen;
      window.giftWalletSet(w);
      return true;
    } catch (e) { return false; }
  }

  // ---- 战绩 / 收藏（每联系人独立） ----
  function statsKey() { return prefix() + ':auction-stats'; }
  function loadStats() {
    const d = { sessions: 0, myWins: 0, taWins: 0, spentFen: 0 };
    try {
      const raw = localStorage.getItem(statsKey());
      if (raw) { const v = JSON.parse(raw); if (v && typeof v === 'object') return Object.assign(d, v); }
    } catch (e) {}
    return d;
  }
  function saveStats(s) { persist(statsKey(), s); }
  function bagKey() { return prefix() + ':auction-items'; }
  function loadBag() {
    try { const a = JSON.parse(localStorage.getItem(bagKey()) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function saveBag(a) { persist(bagKey(), a); }
  // #301 TA 回寄：TA 拍走的拍品 2~4 天后寄回给你（进你的 🎒，附一句留言）
  function giftsKey() { return prefix() + ':au-gifts-pending'; }
  // FIX 2026-09-16：回寄排队原只写 localStorage（不走 persist 双写、不在 idb 回填清单）——
  // 清缓存/换机后「2~4 天寄回」的排队直接丢
  function loadPending() { try { const a = JSON.parse(localStorage.getItem(giftsKey()) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function savePending(a) { persist(giftsKey(), a); }
  let giftTimer = null;
  function checkGifts() {
    const pend = loadPending();
    if (!pend.length) return;
    const now = Date.now();
    let delivered = 0;
    const rest = [];
    pend.forEach((p) => {
      if (p.due <= now) {
        const bag = loadBag();
        bag.unshift({ ico: p.ico, name: p.name, fen: 0, ts: Date.now(), from: 'ta' });
        saveBag(bag);
        delivered++;
        try { if (window.chatAddIn) window.chatAddIn(T('TA') + ' 把之前拍走的「' + p.name + '」寄给你了，纸条上写：拍品该物归原主呀', {}); } catch (e) {}
      } else rest.push(p);
    });
    if (rest.length !== pend.length) savePending(rest);
    if (delivered && statusEl && !panel.hidden) setStatus('📬 ' + T('TA') + ' 寄来了 ' + delivered + ' 件拍品，已收进 🎒');
    // #343 寄到时背包列表开着就重渲染：unshift 会让已渲染行的 data-i 整体 +1，不重渲＝「送TA」可能送错件
    if (delivered && bagOpen) { try { showBag(); } catch (e) {} }
  }

  // ---- 场次状态 ----
  let st = null;
  let thinkT = null;
  let bagOpen = false; // #343/#346 背包覆盖层是否开着（寄到重渲染判定用）

  function newState() {
    const lots = shuffle(activePool()).slice(0, LOTS_PER_SESSION);
    return {
      started: false,
      over: false,           // 一场是否结束
      lots: lots,            // 本场拍品
      idx: 0,                // 当前第几件
      phase: 'idle',         // idle / bidding / done
      cur: 0,                // 当前出价（分）
      leader: 'none',        // none / you / ta
      mode: 'normal',        // TA 本件状态
      limit: 0,              // TA 心理价位（分）
      spent: 0, myWins: 0, taWins: 0, passed: 0
    };
  }

  // ---- 渲染 ----
  function renderLot() {
    const item = st.lots[st.idx];
    if (lotEl) lotEl.textContent = '第 ' + (st.idx + 1) + ' / ' + st.lots.length + ' 件';
    if (balanceEl) balanceEl.textContent = walletOk() ? '心意币 ' + yuan(myBalance()) : '心意币 —';
    if (itemEl) {
      let bidTxt;
      if (st.leader === 'none') bidTxt = '起拍价 ' + yuan(st.cur);
      else if (st.leader === 'you') bidTxt = '你的出价 ' + yuan(st.cur);
      else bidTxt = esc(T('TA')) + ' 出价 ' + yuan(st.cur);
      // #301 蒙面拍品：开拍只给描述，落槌才揭晓
      const showIco = item.mystery ? '🎁' : item.ico;
      const showName = item.mystery ? '神秘拍品' : esc(item.name);
      // #343 领价方着色 + 价格跳动（innerHTML 重建节点即自动重放 aubump）
      const leadCls = st.leader === 'you' ? ' au-lead-you' : st.leader === 'ta' ? ' au-lead-ta' : '';
      itemEl.innerHTML =
        '<div class="au-ico">' + showIco + '</div>' +
        '<div class="au-name">' + showName + '</div>' +
        '<div class="au-desc">' + esc(item.desc) + '</div>' +
        '<div class="au-bid' + leadCls + '">' + bidTxt + '</div>';
    }
    updateBidBtns();
    // #343 拍品登场：四行错峰浮起（renderLot 后重触发）
    if (itemEl) { itemEl.classList.remove('au-in'); void itemEl.offsetWidth; itemEl.classList.add('au-in'); }
  }
  function lotActive() { return st && st.started && !st.over && st.phase === 'bidding'; }
  function updateBidBtns() {
    // #321 档位按钮直白化：直接显示「出 ¥X」（当前价 + 该档），一眼看懂这一次会出多少钱
    const STEPSa = [STEP1, STEP5, STEP13];
    const bidBtns = [bid1Btn, bid5Btn, bid13Btn];
    const cur = (st && typeof st.cur === 'number') ? st.cur : 0;
    bidBtns.forEach((b, i) => { if (b && st) { b.textContent = '出 ' + yuanC(cur + STEPSa[i]); } });
    // TA 正在掂量我的出价时（leader=you 且思考定时器还挂着）锁全键盘，防连出价/抢跑
    const waiting = lotActive() && st.leader === 'you' && !!thinkT;
    const on = lotActive() && !waiting && walletOk() && myBalance() >= st.cur + STEP1;
    bidBtns.forEach((b) => { if (b) b.disabled = !on; });
    if (passBtn) {
      passBtn.disabled = !lotActive() || waiting;
      // #321 「不拍了」按语境换词：你是最高价=落槌成交；否则=放弃这件
      passBtn.textContent = (lotActive() && st.leader === 'you') ? ('落槌 · ' + yuanC(st.cur)) : '放弃这件';
    }
    bidBtns.forEach((b, i) => {
      if (b && on) {
        const step = STEPSa[i];
        b.disabled = myBalance() < st.cur + step;
      }
    });
    // #346 余额不足/账本未就绪时给一行提示，出价键不再静默置灰
    if (walletHintEl) {
      const noWallet = lotActive() && !walletOk();
      const noBalance = lotActive() && walletOk() && myBalance() < st.cur + STEP1;
      walletHintEl.hidden = !(noWallet || noBalance);
      walletHintEl.textContent = noWallet
        ? '心意币账本还没就绪，先去心意集市逛逛吧'
        : (noBalance ? '心意币不够出这一价了——去集市补点心意币，或点「放弃这件」' : '');
    }
  }
  function setStatus(html) { if (statusEl) statusEl.innerHTML = html; }
  // #301 中局 TA 泡泡（同其余小游戏）
  let bubbleT = null;
  function taSay(text) {
    if (!stageEl) return;
    try {
      let b = stageEl.querySelector('.tg-bubble');
      if (!b) { b = document.createElement('div'); b.className = 'tg-bubble'; stageEl.appendChild(b); }
      b.textContent = text;
      b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
      clearTimeout(bubbleT);
      bubbleT = setTimeout(() => { try { b.classList.remove('show'); } catch (e) {} }, 1600);
    } catch (e) {}
  }

  // ---- 拍卖流程 ----
  function newSession() {
    clearTimeout(thinkT); thinkT = null;
    st = newState();
    st.started = true;
    hideOverlay();
    hideIntro();   // #321 收掉开场全屏教学，别挡着拍品
    hideHelp();   // #321 收掉详细玩法
    openLot();
  }
  function openLot() {
    st.phase = 'bidding';
    hideOverlay();   // #343 上一件的结果浮层必须收掉——原先漏收，「下一件」后新拍品被结果层盖住点不了
    if (endBtn) endBtn.hidden = true;
    const r = Math.random();
    st.mode = r < 0.25 ? 'eager' : r < 0.6 ? 'normal' : r < 0.85 ? 'stingy' : 'bluff';
    const item = st.lots[st.idx];
    st.cur = item.base;
    st.leader = 'none';
    let factor = TA_MODES[st.mode].factor;
    st.lucky = (typeof window.arcadeMult === 'function') && window.arcadeMult('auction') === 2;
    if (st.lucky) factor *= 0.8;   // #301 幸运拍卖：TA 今天手松，价位打八折
    st.limit = Math.max(100, Math.round(item.base * factor / 10) * 10);
    renderLot();
    if (st.lucky) {
      if (typeof window.arcadeMarkLuckyPlayed === 'function') window.arcadeMarkLuckyPlayed('auction');
      setStatus('🍀 今日幸运拍卖：' + T('TA') + '今天手松——' + TA_MODES[st.mode].talk + '，你来出价');
    } else {
      setStatus('槌起！' + T('TA') + TA_MODES[st.mode].talk + '——你来出价');
    }
  }
  // 你的加价：出价 = 当前价 + step；随后轮到 TA 掂量
  function myBid(step) {
    if (!lotActive()) return;
    placeBid(st.cur + step);
  }
  // #348 自定义出价共用落价：直接压上这个价（≤余额；不够时给状态提示）
  function placeBid(newCur) {
    if (!lotActive()) return;
    const bal = myBalance();
    if (!walletOk() || bal < newCur) { setStatus('心意币不够这个价——去心意集市补点吧'); updateBidBtns(); return; }
    st.cur = newCur;
    st.leader = 'you';
    sfxBid();
    renderLot();
    scheduleTaThink('TA低头想了想……');
  }
  // #348 长按任一档位弹自定义出价（≥当前价+¥1，确认即压价）
  function customBidModal() {
    if (!lotActive() || !walletOk() || typeof window.openModal !== 'function') return;
    const minFen = st.cur + STEP1;
    const ctl = window.openModal('自定义出价', String(minFen / 100), function (v) {
      const fen = Math.round(parseFloat(String(v).replace(/[^\d.]/g, '')) * 100);
      if (!fen || fen < minFen) { ctl.stay(); ctl.val(''); ctl.ph('至少要比当前价多 ¥1（≥' + yuanC(minFen) + '）'); return; }
      placeBid(fen);
    }, { inputmode: 'decimal', placeholder: '直接压上这个价（≥' + yuanC(minFen) + '）' });
    try { if (ctl) ctl.okText('压价'); } catch (e) {}
  }
  function myPass() {
    if (!lotActive()) return;
    // 我放弃：我持最高价=直接落槌；否则 TA 价位够就 TA 拍走，否则流拍
    if (st.leader === 'you') {
      // FIX 2026-09-16：落槌一点即真实扣款且不可撤回，同为不可撤回的「转赠」早有 openModal
      // 确认（#346）——补同款确认防误触（弹窗不可用时退回直拍）
      const price = st.cur;
      const item = st.lots[st.idx];
      try {
        if (typeof window.openModal === 'function') {
          const ctl = window.openModal('确认落槌', '', function () { hammer(); }, {
            noInput: true,
            staticText: '以 ' + yuanC(price) + ' 拍下「' + item.ico + ' ' + esc(item.name) + '」？心意币将真实扣减，落槌不可撤回。'
          });
          try { if (ctl && ctl.okText) ctl.okText('落槌成交'); } catch (e2) {}
          return;
        }
      } catch (e2) {}
      hammer();
      return;
    }
    if (st.limit >= st.cur) { taTake(); return; }
    passLot();
  }
  function scheduleTaThink(line) {
    clearTimeout(thinkT);
    setStatus(T(line));
    updateBidBtns();
    thinkT = setTimeout(taThink, Math.round((TALK_MIN + Math.random() * TALK_VAR) * fastMul()));
  }
  function taThink() {
    clearTimeout(thinkT); thinkT = null;
    if (!st || !st.started || st.over || st.phase !== 'bidding') return;
    const m = TA_MODES[st.mode];
    // bluff：价位一到有概率突然收手（虚张声势戳破）
    if (st.mode === 'bluff' && st.cur >= st.limit && Math.random() < 0.35) { taFold(); return; }
    if (st.cur < st.limit) {
      // TA 跟价：+随机一档（eager 敢顶到价位，其余留一点余量）
      let step = pick(m.stepPref) || STEP1;
      let bid = st.cur + step;
      if (st.mode !== 'eager' && bid > st.limit) bid = st.limit;
      st.cur = Math.max(bid, st.cur + STEP1);
      st.leader = 'ta';
      sfxBid();
      renderLot();
      taSay(pick(m.calls));
      setStatus(T('TA') + '举牌：' + yuan(st.cur) + '——到你出价了');
      updateBidBtns();
    } else {
      if (st.mode === 'bluff') taSay(pick(['好吧，被你看穿了', '其实……也就那样']));
      taFold();
    }
  }
  function taFold() {
    if (st.leader === 'you') { hammer('you'); return; }
    // TA 都不要且我没出过价 → 流拍
    passLot();
  }
  function taTake() {
    st.phase = 'done';
    clearTimeout(thinkT); thinkT = null;
    st.taWins++;
    sfxLose();
    const s = loadStats();
    s.taWins = (s.taWins || 0) + 1;
    saveStats(s);
    const item = st.lots[st.idx];
    sfxHammer();
    buzz(80);                 // #348 被抢走震动
    recordHistory(item, st.cur, 'ta');
    // #301 TA 回寄排队：2~4 天后寄回给你
    try {
      const pend = loadPending();
      pend.push({ ico: item.ico, name: item.name, due: Date.now() + (2 + Math.floor(Math.random() * 3)) * 86400000 });
      savePending(pend);
    } catch (e) {}
    const rt = rarityOf(item);
    showOverlay(T('TA') + '拍得了',
      '<div class="au-ov-ico">' + item.ico + '</div>' +
      '<div class="pong-end-stat"><span class="au-rare ' + rt.cls + '">' + rt.label + '</span> ' + esc(item.name) + ' · ' + yuan(st.cur) + ' 归 ' + esc(T('TA')) + '</div>' +
      '<div class="pong-end-stat">📬 不过 TA 拍走的拍品，过几天会寄回给你</div>',
      st.idx + 1 < st.lots.length ? '下一件' : '结算', 'ta');
    setStatus(esc(T('TA')) + '把「' + esc(item.name) + '」抱走了');
    try {
      const fb = ['这件归我啦。', '嘿嘿，到手。', '眼光不错吧。'];
      const pool = window.getInteractPool ? window.getInteractPool('游戏胜利·回应', fb) : fb;
      const say = pool[Math.floor(Math.random() * pool.length)] || fb[0];
      const cid1 = prefix();
      setTimeout(() => {
        if (prefix() !== cid1) return;
        try { if (window.chatAddIn) window.chatAddIn(say, { silent: true }); } catch (e) {}
      }, 800);
    } catch (e) {}
    nextLotBtn();
  }
  function passLot() {
    st.phase = 'done';
    clearTimeout(thinkT); thinkT = null;
    st.passed++;
    const item = st.lots[st.idx];
    recordHistory(item, st.cur, 'pass');
    showOverlay('流拍了',
      '<div class="au-ov-ico">' + item.ico + '</div>' +
      '<div class="pong-end-stat">' + esc(item.name) + ' 没人要，收回仓库</div>',
      st.idx + 1 < st.lots.length ? '下一件' : '结算', 'pass');
    setStatus('「' + esc(item.name) + '」流拍了');
    try {
      const fb = ['这玩意没人要啊。', '亏本了亏本了。'];
      const pool = window.getInteractPool ? window.getInteractPool('游戏平局·回应', fb) : fb;
      const say = pool[Math.floor(Math.random() * pool.length)] || fb[0];
      const cid2 = prefix();
      setTimeout(() => {
        if (prefix() !== cid2) return;
        try { if (window.chatAddIn) window.chatAddIn(say, { silent: true }); } catch (e) {}
      }, 800);
    } catch (e) {}
    nextLotBtn();
  }
  // 我赢：真实扣款 + 收进 🎒
  function hammer() {
    if (!st || st.phase !== 'bidding') return;   // FIX 2026-09-16：确认弹窗期间 TA 可能已折价落槌，防二次扣款
    st.phase = 'done';
    clearTimeout(thinkT); thinkT = null;
    const item = st.lots[st.idx];
    if (!walletDeduct(st.cur)) {
      showOverlay('扣款失败', '<div class="pong-end-stat">心意币余额不够了，这件不算了</div>', st.idx + 1 < st.lots.length ? '下一件' : '结算');
      nextLotBtn();
      return;
    }
    st.myWins++;
    st.spent += st.cur;
    const s = loadStats();
    s.myWins = (s.myWins || 0) + 1;
    s.spentFen = (s.spentFen || 0) + st.cur;
    const bag = loadBag();
    bag.push({ ico: item.ico, name: item.name, fen: st.cur, ts: Date.now() });
    // FIX 2026-09-16：扣款与入库非原子（persist 原先静默吞写失败）——收藏/战绩落盘失败时
    // 退回扣款，杜绝「心意币扣了、收藏没进」
    if (!persist(bagKey(), bag) || !persist(statsKey(), s)) {
      walletDeduct(-st.cur);
      st.myWins--; st.spent -= st.cur;
      showOverlay('存储失败', '<div class="pong-end-stat">本地存储暂时不可用，这件没拍成，心意币已退回</div>', st.idx + 1 < st.lots.length ? '下一件' : '结算');
      nextLotBtn();
      return;
    }
    sfxWin(); sfxHammer();
    buzz([30, 40, 80]);       // #348 落槌成交震动
    recordHistory(item, st.cur, 'you');
    taSay(pick(['被你拍走了…', '亏了亏了', '那件我本来想要来着']));
    if (balanceEl) balanceEl.textContent = walletOk() ? '心意币 ' + yuan(myBalance()) : '心意币 —';
    const rt = rarityOf(item);
    showOverlay('落槌！',
      '<div class="au-ov-ico">' + item.ico + '</div>' +
      '<div class="pong-end-stat"><span class="au-rare ' + rt.cls + '">' + rt.label + '</span> ' + esc(item.name) + ' · ' + yuan(st.cur) + ' 拍下</div>' +
      '<div class="pong-end-stat">💌 ' + esc(item.wish) + '</div>' +
      '<div class="pong-end-stat">已收进 🎒 小收藏（剩 ' + yuan(myBalance()) + '）· 可在 🎒 里转赠给 ' + esc(T('TA')) + '</div>',
      st.idx + 1 < st.lots.length ? '下一件' : '结算', 'win');
    setStatus('「' + esc(item.name) + '」是你的了，花了 ' + yuan(st.cur));
    try {
      const fb = ['被你拍走了…', '亏了亏了。', '那件本来我想要来着。'];
      const pool = window.getInteractPool ? window.getInteractPool('游戏失败·回应', fb) : fb;
      const say = pool[Math.floor(Math.random() * pool.length)] || fb[0];
      // FIX 2026-09-16：800ms 内切联系人桌面，回应会发进新桌面——回调前校验命名空间未变
      const cid0 = prefix();
      setTimeout(() => {
        if (prefix() !== cid0) return;
        try { if (window.chatAddIn) window.chatAddIn(say, { silent: true }); } catch (e) {}
      }, 800);
    } catch (e) {}
    // FIX 2026-09-16：接游乐室 TryDrop（此前拍得拿不到 8% 限定摆件掉落，gomoku/linkup/match3 均已接）
    try {
      const auDrop = (typeof window.arcadeTryDrop === 'function') ? window.arcadeTryDrop('auction') : null;
      if (auDrop) taSay('还掉了「' + auDrop.name + '」！游乐室图鉴 +1');
    } catch (e) {}
    nextLotBtn();
  }
  function nextLotBtn() {
    if (startBtn) startBtn.textContent = st.idx + 1 < st.lots.length ? '下一件' : '结算';
    if (endBtn) endBtn.hidden = false;
  }
  function advance() {
    if (!st) return;
    if (st.idx + 1 < st.lots.length) {
      st.idx++;
      openLot();
    } else {
      endSession();
    }
  }
  // 一场结束：汇总 + 聊天联动
  function endSession() {
    st.over = true;
    st.phase = 'idle';
    const s = loadStats();
    s.sessions = (s.sessions || 0) + 1;
    saveStats(s);
    showSummary();
    try {
      let txt = T('心意币拍卖会') + ' · ';
      if (st.myWins) txt += '拍下 ' + st.myWins + ' 件 ' + yuan(st.spent);
      else txt += '空手而归';
      if (st.taWins) txt += ' · ' + T('TA') + ' 拍走 ' + st.taWins + ' 件';
      if (window.chatAddSystem) window.chatAddSystem(txt, { special: 'auction' });
    } catch (e) {}
  }
  // #346 结算汇总单独成函数：背包「返回」也要能回到这一屏（原先被背包覆盖后回不去）
  function showSummary() {
    const s = loadStats();
    showOverlay('本场结束',
      '<div class="pong-end-stat">你拍得 ' + st.myWins + ' 件 · 花了 ' + yuan(st.spent) + '</div>' +
      '<div class="pong-end-stat">' + T('TA') + ' 拍走 ' + st.taWins + ' 件 · 流拍 ' + st.passed + ' 件</div>' +
      '<div class="pong-end-stat">累计 ' + s.sessions + ' 场 · 🎒 收藏 ' + loadBag().length + ' 件</div>',
      '再来一场');
    if (startBtn) startBtn.textContent = '再来一场';
    if (endBtn) endBtn.hidden = false;
    setStatus('本场结束，点击「再来一场」');
  }

  // ---- 🎒 小收藏（#301 支持转赠心意柜） ----
  function showBag() {
    bagOpen = true;
    const bag = loadBag();
    const body = bag.length
      ? bag.map((it, i) =>
          '<div class="pong-end-stat au-bag-row">' + it.ico + ' ' + esc(it.name) + ' · ' + (it.from === 'ta' ? esc(T('TA')) + ' 寄来的' : yuan(it.fen)) +
          (it.from === 'ta' ? '' : ' <button class="pong-overlay-btn au-send-btn" data-i="' + i + '" type="button">送' + esc(T('TA')) + '</button>') + '</div>').join('')
      : '<div class="pong-end-stat">还什么都没拍到</div>';
    showOverlay('🎒 拍品收藏（' + bag.length + '）', body, '返回', '', true);
    if (startBtn) startBtn.textContent = '返回'; // #346 统一返回语义：场次中回竞价、结算后回本场汇总
    if (endBtn) endBtn.hidden = !(st && st.started && !st.over);
  }
  // #348 拍卖记录页：最近 60 条成交/流拍明细
  function showHistory() {
    const h = loadHistory();
    const fmt = (t) => { const d = new Date(t); return (d.getMonth() + 1) + '月' + d.getDate() + '日'; };
    const whoTxt = { you: '你拍得', ta: T('TA') + '拍走', pass: '流拍' };
    const cls = (r) => r === 'SSR' ? 'au-r2' : r === '稀有' ? 'au-r1' : 'au-r0';
    const body = h.length
      ? h.map((it) => '<div class="pong-end-stat au-hist-row"><span class="au-rare ' + cls(it.rarity) + '">' + (it.rarity || '普通') + '</span> ' + it.ico + ' ' + esc(it.name) + ' · ' + (it.who === 'pass' ? '流拍' : yuan(it.price)) + ' · ' + (whoTxt[it.who] || '') + ' · ' + fmt(it.t) + '</div>').join('')
      : '<div class="pong-end-stat">还没拍过任何东西</div>';
    showOverlay('📜 拍卖记录（' + h.length + '）', body, '返回', '', true);
    if (startBtn) startBtn.textContent = '返回';
    if (endBtn) endBtn.hidden = !(st && st.started && !st.over);
  }
  // #348 自制拍品三段式添加（名称→底价→彩蛋）；名称输入已有自制拍品＝删除
  function addCustomModal() {
    if (typeof window.openModal !== 'function') return;
    let stage = 1, pendingName = null;
    const list = () => { const a = loadCustom(); return a.length ? '已有 ' + a.length + '/20：' + a.map((c) => c.name).join('、') : '还没有自制拍品（上限 20 个）'; };
    const ctl = window.openModal('自制拍品', '', function (v) {
      const s = String(v || '').trim();
      if (stage === 1) {
        if (!s) return;
        const cur = loadCustom();
        const idx = cur.findIndex((c) => c.name === s);
        if (idx >= 0) { cur.splice(idx, 1); saveCustom(cur); taSay(pick(['这件……不拍了？', '行吧，收回仓库'])); return; }
        if (cur.length >= 20) { ctl.stay(); ctl.val(''); ctl.ph('自制拍品已满 20 个，先删再加'); return; }
        pendingName = s; stage = 2;
        ctl.stay(); ctl.val(''); ctl.ph('底价（元，如 20）'); ctl.okText('下一步');
        return;
      }
      if (stage === 2) {
        const yuanV = parseFloat(s.replace(/[^\d.]/g, ''));
        if (!yuanV || yuanV <= 0) { ctl.stay(); ctl.val(''); ctl.ph('请输入大于 0 的金额'); return; }
        pendingName = { name: pendingName, base: Math.max(100, Math.round(yuanV * 100)) };
        stage = 3;
        ctl.stay(); ctl.val(''); ctl.ph('拍下后的一句话彩蛋（可空）'); ctl.okText('完成');
        return;
      }
      const a = loadCustom();
      a.push({
        ico: pick(['🎁', '💎', '🧸', '🌈', '⭐', '🍰', '🎧', '🧿', '🌙', '🎀']) || '🎁',
        name: pendingName.name, desc: '我们自己才懂的小玩意', base: pendingName.base,
        wish: s || '是心意呀。', mystery: Math.random() < 0.2 ? 1 : 0
      });
      saveCustom(a);
      taSay(pick(['又上新拍品啦？', '你出的题我接了']));
    }, { maxlength: 24, placeholder: '名称（输入已有名称＝删除）', staticText: list() });
  }
  // 转赠：写心意柜「我送TA」记录（gift-shop 的 recordGiftBox，走既有心意柜渲染），拍品移出收藏
  function giftAway(i) {
    const bag = loadBag();
    const it = bag[i];
    if (!it) return;
    const wish = '拍卖会上抢到的，转送给你';
    try {
      if (typeof window.recordGiftBox === 'function') {
        window.recordGiftBox({ id: 'au_' + Date.now(), giftId: '', name: it.name, emoji: it.ico, img: '', price: it.fen / 100, cat: '拍卖会', wish: wish }, 'out', wish);
      }
    } catch (e) {}
    bag.splice(i, 1);
    saveBag(bag);
    sfxHammer();
    taSay(pick(['送给我的？！', '谢谢，我很喜欢！', '怎么突然对我这么好']));
    try {
      if (window.chatAddSystem) window.chatAddSystem(T('心意币拍卖会') + ' · 转赠 ' + T('TA') + '「' + it.name + '」', { special: 'auction' });
    } catch (e) {}
    const cid3 = prefix();
    setTimeout(() => {
      if (prefix() !== cid3) return;
      try { if (window.chatAddIn) window.chatAddIn(pick(['收下啦！超喜欢', '你也喜欢就好', '下次拍卖会我让给你一件']), { silent: true }); } catch (e) {}
    }, 900);
    showBag();
  }

  // ---- 覆盖层 ----
  // #343 mood：win=落槌成交（砸下回弹）/ ta=TA抱走（左右挣扎）/ pass=流拍（褪色下沉）
  function showOverlay(title, body, btnText, mood, fs) {
    if (!overlayEl) return;
    if (ovTitleEl) ovTitleEl.innerHTML = title || '';
    if (ovBodyEl) ovBodyEl.innerHTML = body || '';
    if (startBtn && btnText) startBtn.textContent = btnText;
    overlayEl.classList.remove('au-ov-win', 'au-ov-ta', 'au-ov-pass');
    if (mood) overlayEl.classList.add('au-ov-' + mood);
    // FIX 2026-09-12 #381 背包/记录是列表浮层，弹在 .au-stage 里（absolute inset:0 随
    // stage 高度）——未开局时 stage 只有 ~30px，浮层被裁成一条缝＝「打开显示不全」。
    // 列表型浮层转全屏（自带标题/返回按钮，与 #au-intro 同族）；竞价掂量/结算等
    // stage 有内容时的浮层保持原位不动。
    overlayEl.classList.toggle('au-ov-fs', !!fs);
    overlayEl.hidden = false;
    updateBidBtns();
  }
  function showStartOverlay() {
    const s = loadStats();
    // #321 开场教学改全屏浮层：半框放不下这么多行说明，全屏才有地方，杜绝被裁切
    if (introStepsEl) {
      introStepsEl.innerHTML =
        '<b>怎么玩</b>：和 ' + T('TA') + ' 轮番举牌，抢 3 件宝贝，价高者得。<br>' +
        '<b>① 看拍品</b>　每件有起拍价，先掂量值不值。<br>' +
        '<b>② 出价</b>　点档位「出 ¥X」就是在当前价上加价、压上你的价。<br>' +
        '<b>③ 轮替</b>　你出价后 ' + T('TA') + ' 掂量掂量，轮到你时按钮才亮。<br>' +
        '<b>④ 成交</b>　你最高价点「落槌」→按现价买下（真扣心意币、进 🎒）；' + T('TA') + ' 最高价→放弃这件；都不要→流拍。<br>' +
        '<b>⑤ 彩蛋</b>　' + T('TA') + ' 拍走的过几天寄回给你。';
    }
    const statsHtml =
      (s.sessions > 0 ? '累计 ' + s.sessions + ' 场 · 你拍得 ' + s.myWins + ' 件 · 花了 ' + yuan(s.spentFen || 0) + '　' : '') +
      '当前心意币 ' + (walletOk() ? yuan(myBalance()) : '—');
    if (introStatEl) introStatEl.textContent = statsHtml;
    showIntro();
    hideOverlay(); // 半框覆盖层平时不显示（开场/成交才由流程显示）
    setStatus('全屏读玩法：点下方「开始拍卖」，或「详细玩法」');
  }
  function hideOverlay() { if (overlayEl) { overlayEl.hidden = true; overlayEl.classList.remove('au-ov-fs'); } bagOpen = false; }

  // ---- 输入 ----
  if (startBtn) startBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // 覆盖层按钮复用：场次中=下一件/返回收藏，场次外=开场
    if (overlayEl && !overlayEl.hidden) {
      const t = startBtn.textContent || '';
      if (t === '下一件' || t === '结算') { advance(); return; }
      if (t === '返回') {
        hideOverlay();
        if (st && st.started && !st.over) {
          renderLot();
          // #346 返回文案按真实回合态：TA 掂量中不再误报「到你出价了」
          setStatus(lotActive() && st.leader === 'you' && thinkT ? T('TA') + ' 正在掂量你的出价……' : '继续——到你出价了');
        } else if (st && st.over) {
          showSummary(); // #346 结算后开背包，「返回」= 回到本场结算汇总
        } else {
          showStartOverlay(); // 防御：无场次回开场教学
        }
        return;
      }
    }
    newSession();
  });
  if (endBtn) endBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
  if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
  // #348 出价键：点按=加一档；长按 600ms=弹自定义出价（点按与长按互斥，长按吞掉随后的 click）
  let lpT = null, lpFired = false;
  function bindBidBtn(btn, step) {
    if (!btn) return;
    const start = () => { lpFired = false; clearTimeout(lpT); lpT = setTimeout(() => { lpFired = true; customBidModal(); }, 600); };
    const cancel = () => { clearTimeout(lpT); };
    btn.addEventListener('touchstart', start, { passive: true });
    btn.addEventListener('mousedown', start);
    ['touchend', 'touchcancel', 'mouseup', 'mouseleave'].forEach((ev) => btn.addEventListener(ev, cancel));
    btn.addEventListener('click', (e) => { e.stopPropagation(); if (lpFired) { lpFired = false; return; } myBid(step); });
  }
  bindBidBtn(bid1Btn, STEP1);
  bindBidBtn(bid5Btn, STEP5);
  bindBidBtn(bid13Btn, STEP13);
  if (passBtn) passBtn.addEventListener('click', (e) => { e.stopPropagation(); myPass(); });
  if (bagBtn) bagBtn.addEventListener('click', (e) => { e.stopPropagation(); showBag(); });
  if (historyBtn) historyBtn.addEventListener('click', (e) => { e.stopPropagation(); showHistory(); });
  if (addBtn) addBtn.addEventListener('click', (e) => { e.stopPropagation(); addCustomModal(); });
  // #301 转赠按钮（收藏列表内，事件委托）
  if (ovBodyEl) ovBodyEl.addEventListener('click', (e) => {
    const sendBtn = e.target.closest('.au-send-btn');
    if (!sendBtn) return;
    e.stopPropagation();
    const i = parseInt(sendBtn.getAttribute('data-i'), 10) || 0;
    const it = loadBag()[i];
    if (!it) return;
    // #346 转赠不可撤回，走全站 openModal 确认防误触（弹窗不可用时退回直送）
    try {
      if (typeof window.openModal === 'function') {
        const ctl = window.openModal('送出拍品', '', function () { giftAway(i); }, {
          noInput: true,
          staticText: '把「' + it.ico + ' ' + it.name + '」送给 ' + T('TA') + '？送出后不可撤回。'
        });
        try { if (ctl && ctl.okText) ctl.okText('送出'); } catch (e2) {}
        return;
      }
    } catch (e2) {}
    giftAway(i);
  });
  if (soundBtn) soundBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? '🔊' : '🔇';
    soundBtn.classList.toggle('pong-sound-off', !soundOn);
    try { localStorage.setItem('xy-home-v2:au-sound', soundOn ? '1' : '0'); } catch (e2) {} // #346 偏好记忆
  });

  // ---- 打开 / 关闭 ----
  function setNames() {
    let name = T('TA');
    try {
      const s = window.activeStore && window.activeStore();
      name = (s && (s.get('cs-lbl-partner') || s.get('lbl-partner'))) || name;
    } catch (e) {}
    if (partnerNameEl) partnerNameEl.textContent = name;
  }
  window.openAuctionPanel = function () {
    try { if (isFs) toggleFs(); } catch (e) {}
    panel.hidden = false;
    hideHelp();                                              // #321 重开默认收起玩法说明
    if (soundBtn) { soundBtn.textContent = soundOn ? '🔊' : '🔇'; soundBtn.classList.toggle('pong-sound-off', !soundOn); } // #346 图标跟随持久化偏好
    try { setNames(); } catch (e) {}
    try { checkGifts(); } catch (e) {}   // #301 到期回寄投递
    // 有进行中的场次 → 接着拍（关面板期间 TA 思考的补调度）
    if (st && st.started && !st.over) {
      if (st.phase === 'bidding') { renderLot(); if (!thinkT && st.leader === 'you') scheduleTaThink('TA低头想了想……'); else updateBidBtns(); }
      return;
    }
    showStartOverlay();
    setStatus('全屏读玩法：点「开始拍卖」或「详细玩法」');
  };
  function closePanel() {
    clearTimeout(thinkT); thinkT = null;
    clearInterval(giftTimer); giftTimer = null;
    bagOpen = false;
    hideIntro(); hideHelp();
    if (panel) panel.hidden = true;
  }
  window.closeAuctionPanel = closePanel;
  // 打开期间每 30s 查一次到期回寄
  (function watchGifts() {
    const mo = new MutationObserver(() => {
      if (panel.hidden) { clearInterval(giftTimer); giftTimer = null; return; }
      if (!giftTimer) { try { checkGifts(); } catch (e) {} giftTimer = setInterval(() => { try { checkGifts(); } catch (e) {} }, 30000); }
    });
    mo.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  })();
  // #347 寄回投递不再依赖打开拍卖会：全局每 10 分钟补投一次（开面板仍有 30s 细粒度检查），
  // 否则「2~4 天寄回」实际是「2~4 天后你下次打开拍卖会才寄到」。checkGifts 自带 no-pending 快速返回。
  setInterval(() => { try { checkGifts(); } catch (e) {} }, 600000);
  // #348 开屏异步回填：localStorage 缺失而 IndexedDB 有（被清/换机）时把收藏与记录搬回同步读路径
  (function restoreFromIdb() {
    ['auction-items', 'auction-history', 'au-gifts-pending'].forEach((k) => {
      try {
        const key = prefix() + ':' + k;
        if (localStorage.getItem(key)) return;
        if (typeof window.idbGet !== 'function') return;
        Promise.resolve(window.idbGet(key)).then((v) => {
          try {
            if (v === undefined || v === null) return;
            const s = typeof v === 'string' ? v : JSON.stringify(v);
            if (!s) return;
            const p = JSON.parse(s);
            if (Array.isArray(p) && p.length) localStorage.setItem(key, s);
          } catch (e) {}
        }).catch(() => {});
      } catch (e) {}
    });
  })();
  // 切联系人清空进行中场次：🎒 收藏按联系人桌面隔离，跨桌续拍会把拍品收进别桌收藏
  document.addEventListener('contact-switched', () => { try { closePanel(); st = null; } catch (e) {} });

  // ---- 入口：聊天更多功能 → 小游戏 → 心意币拍卖会（自绑定，chat.js 不改） ----
  (function bindEntry() {
    const btn = document.getElementById('more-auction');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mp = document.getElementById('chat-more-panel');
      if (mp) mp.hidden = true;
      hideSiblingPanels('chat-auction-panel');
      try { if (window.closeAvlib) window.closeAvlib(); } catch (err) {}
      try { if (window.closePongPanel) window.closePongPanel(); } catch (err) {}
      try { openAuctionPanel(); } catch (err) {
        try { panel.hidden = false; showStartOverlay(); setStatus('点击「开场拍卖」'); } catch (e2) {}
        try { console.error('[auction] open failed', err); } catch (e2) {}
      }
    });
    try {
      if (window.MutationObserver) {
        const SIBLING_IDS = siblingIds('chat-auction-panel');
        const mo = new MutationObserver(() => {
          if (panel.hidden) return;
          for (let i = 0; i < SIBLING_IDS.length; i++) {
            const el = document.getElementById(SIBLING_IDS[i]);
            if (el && !el.hidden) { closePanel(); break; }
          }
        });
        SIBLING_IDS.forEach((id) => { const el = document.getElementById(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] }); });
      }
    } catch (e) {}
  })();

  // 半框互斥清单（全部聊天页浮层面板；各游戏文件各自维护一份含其余全部面板的列表）
  function siblingIds(self) {
    return ['poke-card', 'emoji-panel', 'chat-search', 'chat-ask-panel', 'chat-divine-panel', 'chat-decision-panel', 'chat-gdecision-panel', 'chat-rps-panel', 'chat-rp-panel', 'chat-call-panel', 'chat-pong-panel', 'chat-snake-panel', 'chat-brick-panel', 'chat-c4-panel', 'chat-ms-panel', 'chat-fish-panel', 'chat-memory-panel', 'chat-gift-panel', 'chat-gomoku-panel', 'chat-linkup-panel', 'chat-match3-panel', 'chat-auction-panel', 'chat-arcade-panel', 'chat-more-panel'].filter((id) => id !== self);
  }
  function hideSiblingPanels(self) {
    siblingIds(self).forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = true; });
  }

  // 只读调试口（供后续 verify 脚本复用）
  window.__auDebug = {
    st: () => st,
    newSession: newSession,
    myBid: myBid,
    loadBag: loadBag,
    poolSize: () => activePool().length,
    lastBuzz: null,
    fast: false
  };
})();
