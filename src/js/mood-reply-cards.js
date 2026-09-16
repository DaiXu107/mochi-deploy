// ===== 功能：聊天情绪系统（完整复刻星言简易版 20_my_heart_cards.js） =====
// 三级链路：情绪卡 → 心意卡 → 交流意图卡
// 情绪卡：70% 基础概率 + emotionStreak 连续衰减（1→60% 2→45% 3→30% 4+→20%）
//         按组权重选组 → 稀有度加权（normal80/rare15/special5）抽卡
// 心意卡：40% 显示率 → 特殊心意(聊天≥20次+24h冷却+5%) → 情绪映射选组(加权+冷却) → 等级加权抽卡
// 意图卡：40% 显示率 → 心意→意图映射加权 → 稀有度加权抽卡
// 聊天回应：连接词 8 类，按回复特征选类
(function () {
  const uid = window.activePrefix();
  const ls = window.activeStore();
  const DATA = (window.MOOD_FOLLOWUP_DATA) || {};
  const W = DATA.weights || {};

  // ---- 状态（星言对应 emotionStreak / heartHistory / specialCooldown）----
  let emotionStreak = 0;
  let emotionLastTs = 0;       // 上次情绪卡触发时间（v3.6.x：聊天间隔较长时重置 streak）
  let heartHistory = [];       // 最近触发的具体心意卡
  let specialLastTime = 0;     // 特殊心意上次触发时间（24h 冷却）

  // ---- 概率工具 ----
  function hit(p) { return Math.random() * 100 < p; }
  function pick(arr) { return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; }
  // v3.6.x：轻提示（复用 cc-toast 风格）
  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
  }
  function toastCard(txt, off) {
    const s = String(txt == null ? '' : txt);
    toast((off ? '已关闭：' : '已开启：') + (s.length > 18 ? s.slice(0, 18) + '…' : s));
  }
  function weightedPick(items) {
    const total = items.reduce((a, it) => a + Math.max(0, it[1]), 0);
    if (total <= 0) return items.length ? items[0] : null;
    let roll = Math.random() * total;
    for (const it of items) {
      roll -= Math.max(0, it[1]);
      if (roll < 0) return it[0];
    }
    return items[items.length - 1] ? items[items.length - 1][0] : null;
  }

  // v3.26.x #515：字卡库【聊天情绪字卡】【聊天回应字卡】页的概率显示 + 可调——此前这四项概率
  //   写死在代码里（情绪 70% / 心意 40% / 交流意图 40% / 回应字卡整条替换 30%），页面上只有总开关
  //   与「各自独立概率」的说明，没有任何显示/调整入口（用户报「没有显示触发的概率和可调整的
  //   按钮功能」）。未设置键时回退原写死值＝默认行为完全不变；0% = 该类字卡完全不参与。
  const MC_PROB_DEF = { mood: 70, heart: 40, intent: 40 };
  function mcProb(type) {
    const d = MC_PROB_DEF[type] !== undefined ? MC_PROB_DEF[type] : 100;
    try {
      const v = ls.get('mc-prob-' + type);
      if (v === null || v === undefined || v === '') return d;
      const n = Number(v);
      return isNaN(n) ? d : Math.max(0, Math.min(100, n));
    } catch (e) { return d; }
  }
  const RCARD_PROB_DEF = 30; // 原 getReplyCard 写死的 30%（与默认字卡 defaultCommonOverallProb 同档）
  function rcardProb() {
    try {
      const v = ls.get('rcard-prob');
      if (v === null || v === undefined || v === '') return RCARD_PROB_DEF;
      const n = Number(v);
      return isNaN(n) ? RCARD_PROB_DEF : Math.max(0, Math.min(100, n));
    } catch (e) { return RCARD_PROB_DEF; }
  }
  // v3.26.x #515：概率 stepper 绑定（情绪/心意/意图/回应字卡/连接词共用）——点 ± 按 5% 一档写键并
  //   刷新显示，与其他互动功能字卡页 dcf-* 同款交互。
  function bindProbStepper(boxId, valId, read, write, label) {
    const box = document.getElementById(boxId);
    const valEl = document.getElementById(valId);
    if (!box || !valEl) return null;
    const stepBy = function (delta) {
      const cur = parseInt(valEl.value, 10);
      const nv = Math.max(0, Math.min(100, (isNaN(cur) ? read() : cur) + delta));
      valEl.value = String(nv);
      try { write(nv); } catch (e) {}
      toast(label + '：' + nv + '%');
    };
    const mn = box.querySelector('.stp-min');
    const mx = box.querySelector('.stp-max');
    if (mn) mn.addEventListener('click', function () { stepBy(-5); });
    if (mx) mx.addEventListener('click', function () { stepBy(5); });
    return { box: box, valEl: valEl, refresh: function () { valEl.value = String(read()); } };
  }
  // v3.26.x #515：显示同步钩子——由 mc/rc 页绑定块追加；文件末尾在切桌面 / IDB 回填完成 /
  //   小键写日志修正（mochi-wrj-heal）后统一调用，避免这些时机下页面数值停留在旧值。
  let syncCardProbUI = function () {};
  function addProbUISync(fn) {
    const prev = syncCardProbUI;
    syncCardProbUI = function () { try { prev(); } catch (e) {} try { fn(); } catch (e) {} };
  }

  // ---- 开关（星言 _cardTypeSettings）----
  function enabled(k) {
    const v = ls.get('mh-' + k);
    return v === null ? true : v === '1';
  }
  function setEnabled(k, v) { ls.set('mh-' + k, v ? '1' : '0'); }
  window.moodSystemState = { enabled, setEnabled };

  // v3.6.x：单卡开关——系统预设字卡可逐张开启/关闭使用
  //   情绪字卡：mc-off-mood:<内容>；回应字卡：rc-off-<分类>:<内容>；关闭为 '1'
  function isCardOff(k, c) { return ls.get(k + ':' + c) === '1'; }
  function setCardOff(k, c, off) { ls.set(k + ':' + c, off ? '1' : '0'); }

  // #500 三级链各持独立开关键 + 心意/交流意图卡补单卡开关：
  //   ①此前三类字卡共用 mc-off-mood:<内容>，同名卡（「想念」「分享」「陪伴」等 20+ 张
  //     跨类重名）会互相误伤——关掉情绪卡「想念」连心意卡「想念」一起没了；
  //   ②心意卡（9 组 + 特殊 4 组）与交流意图卡（8 组）在字卡库里【没有列表】，用户
  //     看到的只有情绪 11 组，想手动关闭也找不到入口，而它们恰是触发最频繁的两类
  //     （40% 显示率各按 40%/40% 独立判定）→ 用户反馈「手动关闭没有用，会频繁使用」。
  //   兼容：旧键 mc-off-mood 仍是情绪卡自己的键；心意/意图卡在【本类没有新键】且
  //   【不存在同名情绪卡】时才读旧键（此时旧键只可能来自它们自己），存量关闭不复活。
  const OFF_KEY = { mood: 'mc-off-mood', heart: 'mc-off-heart', intent: 'mc-off-intent' };
  function hasMoodCard(c) {
    for (const g of (DATA.mood || [])) {
      for (const card of g.cards) if (card.content === c) return true;
    }
    return false;
  }
  function typeOff(type, content) {
    const own = ls.get(OFF_KEY[type] + ':' + content);
    if (own !== null && own !== '') return own === '1';
    if (type !== 'mood' && !hasMoodCard(content) && ls.get('mc-off-mood:' + content) === '1') return true;
    return false;
  }
  function setTypeOff(type, content, off) {
    ls.set(OFF_KEY[type] + ':' + content, off ? '1' : '0');
  }
  window.moodCardOffState = typeOff;

  // ---- 情绪卡（星言 getRandomMoodCard）----
  window.getMoodCard = function () {
    if (!enabled('mood')) return null;
    // v3.6.x：聊天间隔较长（≥10 分钟）重置连续衰减——否则 emotionStreak 会话内
    //   单调递增，情绪卡连发 4 次后概率永久降到 20%（resetEmotionStreak 定义了
    //   但无人调用，旧逻辑从不重置）
    if (emotionLastTs && Date.now() - emotionLastTs > 10 * 60000) emotionStreak = 0;
    // 星言逻辑：基础概率 + emotionStreak 连续衰减。v3.26.x #515：基础概率改为可调
    //   （mc-prob-mood，默认 70＝原写死值），衰减档位按同一比例缩放——基数 70% 时逐档
    //   （70/60/45/30/20）与旧行为完全一致；调低/调高只改基数、不改衰减曲线形状。
    const _mBase = (window.dcpEff ? window.dcpEff(mcProb('mood')) : mcProb('mood')); // #518 套总档
    const streakMap = W.moodStreak || { 0: 70, 1: 60, 2: 45, 3: 30, 4: 20 };
    const _lvl = emotionStreak >= 4 ? '4' : String(emotionStreak);
    const _ref = streakMap['0'] !== undefined ? streakMap['0'] : 70;
    const _ratio = (_ref > 0 && streakMap[_lvl] !== undefined) ? (streakMap[_lvl] / _ref) : 1;
    let prob = Math.max(0, Math.min(100, _mBase * _ratio));
    if (Math.random() * 100 > prob) return null;
    // v3.6.x：单卡开关过滤——只从仍开启的字卡里抽，整组关完则跳过该组
    const groups = (DATA.mood || [])
      .map(g => ({ ...g, cards: g.cards.filter(c => !isCardOff('mc-off-mood', c.content)) }))
      .filter(g => g.cards && g.cards.length);
    // 经期中：负面情绪组权重 ×3（悲伤/愤怒/不安/克制），正向组权重 ×0.6
    let moodGroups = groups;
    try {
      const ps = window.periodStatus && window.periodStatus();
      if (ps && ps.inPeriod) {
        const downGroups = { '悲伤与低落': 1, '愤怒与不满': 1, '不安与恐惧': 1, '克制与隐藏': 1 };
        const upGroups = { '喜悦与正向': 1, '亲近与爱意': 1 };
        moodGroups = groups.map(g => {
          let w = g.weight || 1;
          if (downGroups[g.group]) w *= 3;
          else if (upGroups[g.group]) w *= 0.6;
          return { ...g, weight: w };
        });
      }
    } catch (e) {}
    const g = weightedPick(moodGroups.map(x => [x, x.weight || 1]));
    if (!g) return null;
    const cards = g.cards;
    // 稀有度加权
    const rarity = weightedPick(Object.keys(W.rarity || { normal: 80, rare: 15, special: 5 }).map(k => [k, W.rarity[k]]));
    let pool = cards.filter(c => c.rarity === rarity);
    if (!pool.length) pool = cards;
    const card = pick(pool);
    if (!card) return null;
    emotionStreak++;
    emotionLastTs = Date.now();
    return { content: card.content, group: g.group, rarity: card.rarity };
  };

  // ---- 心意卡（星言 getRandomHeartCard）----
  window.getHeartCard = function (moodCard) {
    if (!enabled('heart')) return null;
    // v3.26.x #515：显示率改为可调（mc-prob-heart，默认 40＝原写死值）
    if (Math.random() * 100 > (window.dcpEff ? window.dcpEff(mcProb('heart')) : mcProb('heart'))) return null; // #518 套总档
    // 特殊稀有心意：聊天≥20次 + 24h冷却 + 5%
    const chatCount = Number(ls.get('chat-count') || 0);
    if (chatCount >= 20 && (Date.now() - specialLastTime) > 86400000 && Math.random() * 100 < 5) {
      specialLastTime = Date.now();
      const specials = [];
      // v3.6.x：单卡开关过滤——关闭的特殊心意不参与抽取
      (DATA.specialHeart || []).forEach(g => g.cards.forEach(c => {
        if (typeOff('heart', c.content)) return;
        specials.push({ content: c.content, group: g.group, emoji: g.emoji, level: c.level, isSpecial: true });
      }));
      if (specials.length) {
        const recent5 = heartHistory.slice(-5).map(h => h.content);
        let pool = specials.filter(c => recent5.indexOf(c.content) === -1);
        if (!pool.length) pool = specials;
        const picked = pick(pool);
        if (picked) { heartHistory.push(picked); return picked; }
      }
    }
    // 确定心意池：情绪映射 / 通用池
    let pool = null;
    if (moodCard && moodCard.group && DATA.emotionToHeart && DATA.emotionToHeart[moodCard.group]) {
      pool = DATA.emotionToHeart[moodCard.group];
    }
    if (!pool) pool = DATA.generalHeartPool || [];
    // 冷却机制：近3次分组权重减半
    const recent3 = heartHistory.slice(-3).map(h => h.group);
    const adj = pool.map(p => [p[0], recent3.indexOf(p[0]) >= 0 ? (p[1] || 1) * 0.5 : (p[1] || 1)]);
    const selGroup = weightedPick(adj);
    if (!selGroup) return null;
    // 分类内抽卡：等级加权 + 稀有度加权 + 最近5条不重复
    const grp = (DATA.heart || []).find(g => g.group === selGroup);
    if (!grp || !grp.cards.length) return null;
    // v3.6.x：单卡开关过滤——关闭的字卡不参与抽取，整组关完则跳过
    let cards = grp.cards.filter(c => !typeOff('heart', c.content));
    if (!cards.length) return null;
    const recent5 = heartHistory.slice(-5).map(h => h.content);
    let cooled = cards.filter(c => recent5.indexOf(c.content) === -1);
    if (!cooled.length) cooled = cards;
    const rarity = weightedPick(Object.keys(W.rarity || { normal: 80, rare: 15, special: 5 }).map(k => [k, W.rarity[k]]));
    let rpool = cooled.filter(c => c.rarity === rarity);
    if (!rpool.length) rpool = cooled;
    // 等级加权——v3.5.134：按稀有度选权重表（原恒用 normal，special 稀有卡
    // 的 level 3 只有 2/100，比设计意图 20/100 罕见得多）
    const lw = (W.heartLevel && W.heartLevel[rarity]) || (W.heartLevel && W.heartLevel.normal) || { '1': 80, '2': 18, '3': 2 };
    const lwItems = rpool.map(c => [c, lw[String(c.level || 1)] !== undefined ? lw[String(c.level || 1)] : lw['1']]);
    const picked = weightedPick(lwItems);
    if (!picked) return null;
    heartHistory.push({ content: picked.content, group: grp.group });
    if (heartHistory.length > 10) heartHistory = heartHistory.slice(-10);
    return { content: picked.content, group: grp.group, emoji: grp.emoji, level: picked.level, rarity: picked.rarity };
  };

  // ---- 交流意图卡（星言 getRandomIntentCard）----
  window.getIntentCard = function (heartCard) {
    if (!enabled('intent')) return null;
    // v3.26.x #515：显示率改为可调（mc-prob-intent，默认 40＝原写死值，与心意同档）
    if (Math.random() * 100 > (window.dcpEff ? window.dcpEff(mcProb('intent')) : mcProb('intent'))) return null; // #518 套总档
    let pool = null;
    if (heartCard && heartCard.group && DATA.heartToIntent && DATA.heartToIntent[heartCard.group]) {
      pool = DATA.heartToIntent[heartCard.group];
    }
    if (!pool) pool = (DATA.intent || []).map(g => [g.group, g.weight || 1]);
    const selGroup = weightedPick(pool.map(p => [p[0], p[1]]));
    if (!selGroup) return null;
    const grp = (DATA.intent || []).find(g => g.group === selGroup);
    if (!grp || !grp.cards.length) return null;
    // v3.6.x：单卡开关过滤——关闭的字卡不参与抽取
    const cards = grp.cards.filter(c => !typeOff('intent', c.content));
    if (!cards.length) return null;
    const rarity = weightedPick(Object.keys(W.rarity || { normal: 80, rare: 15, special: 5 }).map(k => [k, W.rarity[k]]));
    let pool2 = cards.filter(c => c.rarity === rarity);
    if (!pool2.length) pool2 = cards;
    const picked = pick(pool2);
    if (!picked) return null;
    return { content: picked.content, group: grp.group, emoji: grp.emoji, rarity: picked.rarity };
  };

  // ---- 触发链：情绪→心意→意图（星言 genReply 的 Step I 对应）----
  // 返回 { type:'mood'|'heart'|'intent', content, meta } 或 null
  window.triggerEmotionChain = function () {
    // 需求：情绪字卡 tag 不受二级密码解锁系统字卡影响——未解锁时情绪/心意/意图链
    // 照常触发，气泡下方 tag 与正文都显示（不再走 #365 的 replySrcLocked 锁闸）
    // v3.6.x：总开关关闭时整链停发——防御存量状态（mh-mood=0 而 mh-heart/intent
    //   仍是 1/空 的旧数据，光靠写键兜不住已存的关闭态）
    if (!enabled('mood')) return null;
    const out = [];
    // 每类独立判定：情绪（70%+衰减）、心意（40%）、意图（20%）各自有概率触发，可同时 1~3 类
    const mood = window.getMoodCard();
    if (mood) out.push({ type: 'mood', content: mood.content, meta: mood });
    // 心意基于情绪（若有），否则基于通用池
    const heart = window.getHeartCard(mood || null);
    if (heart) out.push({ type: 'heart', content: heart.content, meta: heart });
    // 意图基于心意（若有），否则独立判定
    const intent = window.getIntentCard(heart || null);
    if (intent) out.push({ type: 'intent', content: intent.content, meta: intent });
    return out.length ? out : null;
  };
  // 供页面统计聊天次数（特殊心意前置条件）
  window.addChatCount = function () {
    ls.set('chat-count', String((Number(ls.get('chat-count') || 0)) + 1));
  };
  // 重置 streak（聊天间隔较长时）
  window.resetEmotionStreak = function () { emotionStreak = 0; };

  // ================= 聊天回应字卡（连接词）=================
  const rcList = document.getElementById('rc-list');
  const rcEnabled = document.getElementById('rc-enabled');
  if (rcList && rcEnabled) {
    rcEnabled.checked = (ls.get('rc-enabled') === null) ? true : ls.get('rc-enabled') === '1';
    rcEnabled.addEventListener('change', () => ls.set('rc-enabled', rcEnabled.checked ? '1' : '0'));
    // v3.26.x #515：本页两个消费点的概率 stepper——①「回应字卡使用概率」存键 rcard-prob
    //   （per-cid，整条回复被换成一张连接词字卡的概率，原写死 30%）；②「连接词追加概率」
    //   读写回复设置的 cf-prob（window.replyCfg / saveReplyCfg 同一份 reply- 键，不新开键，
    //   避免同一语义两处各存一份）
    const rcProbUI = bindProbStepper('rcard-prob', 'rcard-prob-val', rcardProb,
      function (v) { ls.set('rcard-prob', String(v)); }, '回应字卡使用概率');
    const cfProbUI = bindProbStepper('cf-prob', 'cf-prob-val', function () {
      const c = (window.replyCfg && window.replyCfg()) || {};
      const n = Number(c['cf-prob']);
      return isFinite(n) ? n : 20;
    }, function (v) { if (window.saveReplyCfg) window.saveReplyCfg('cf-prob', v); }, '连接词追加概率');
    addProbUISync(function () {
      if (rcProbUI) rcProbUI.refresh();
      if (cfProbUI) cfProbUI.refresh();
    });
    const CATS = [
      ['echo', '接话'], ['confirm', '确认'], ['keep', '继续'], ['probe', '轻追问'],
      ['bridge', '连接'], ['shift', '转折'], ['tone', '停顿'], ['close', '收束']
    ];
    let rcGroup = '';
    let rcQ = '';
    function renderRCBar() {
      const bar = document.getElementById('rc-groups-bar');
      if (!bar) return;
      bar.innerHTML = '';
      const chips = [['', '全部']].concat(CATS.map(c => [c[0], c[1]]));
      chips.forEach(([val, label]) => {
        const cEl = document.createElement('span');
        cEl.className = 'cc-g-chip' + (rcGroup === val ? ' sel' : '');
        cEl.textContent = label;
        cEl.addEventListener('click', () => { rcGroup = val; renderRCBar(); renderReply(); });
        bar.appendChild(cEl);
      });
    }
    function renderReply() {
      const followup = DATA.followup || {};
      rcList.innerHTML = '';
      const cats = rcGroup ? CATS.filter(c => c[0] === rcGroup) : CATS;
      cats.forEach(([key, name]) => {
        let arr = followup[key] || [];
        if (rcQ) arr = arr.filter(t => t.indexOf(rcQ) >= 0);
        // v3.6.x：搜索时只显示命中的分类，空分类不渲染分组头（与自定义聊天字卡一致）
        if (rcQ && !arr.length) return;
        const h = document.createElement('div');
        h.className = 'cc-group-header';
        h.innerHTML = '<span class="ccg-name">' + name + '</span><span class="ccg-count">' + arr.length + '</span>';
        rcList.appendChild(h);
        arr.forEach(t => {
          const off = isCardOff('rc-off-' + key, t);
          const d = document.createElement('div');
          d.className = 'cc-item glass' + (off ? ' off' : '');
          // v3.6.x：整页为系统预设字卡，统一标【系统】与自定义字卡区分；
          // 右侧单卡开关——逐张开启/关闭该字卡（关闭后回复不再抽取）
          d.innerHTML = '<div class="cc-txt"><div class="t">' + t + ' <span class="tc-known">系统</span></div></div>' +
            '<label class="toggle ccard-toggle"><input type="checkbox"' + (off ? '' : ' checked') + '><span class="tk"></span></label>';
          rcList.appendChild(d);
          d.querySelector('input').addEventListener('change', () => {
            const nowOff = !d.querySelector('input').checked;
            setCardOff('rc-off-' + key, t, nowOff);
            d.classList.toggle('off', nowOff);
            toastCard(t, nowOff);
          });
        });
      });
    }
    renderRCBar();
    renderReply();
    // 搜索：页内输入框直接过滤（v3.6.x：与自定义聊天字卡一致，不再弹窗，输入即筛，清空即恢复）
    const rcSearchInput = document.getElementById('rc-search-input');
    if (rcSearchInput) {
      // v3.5.138：不再标记 ceDone 跳过 contenteditable 转换——手机 Chrome 对
      // 原生 input 聚焦弹「自动填充」白条；ce-box 兼容 input 转发 + value 代理
      rcSearchInput.addEventListener('input', () => {
        rcQ = rcSearchInput.value.trim();
        renderReply();
      });
      rcSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { rcSearchInput.value = ''; rcQ = ''; renderReply(); rcSearchInput.blur(); }
      });
    }
    const li = document.getElementById('li-reply-cards');
    if (li) {
      li.addEventListener('click', () => {
        document.querySelectorAll('.page').forEach(p => p.hidden = true);
        const page = document.getElementById('page-reply-cards');
        if (page) page.hidden = false;
      });
    }
    const back = document.getElementById('rc-back');
    if (back) {
      back.addEventListener('click', () => {
        document.querySelectorAll('.page').forEach(p => p.hidden = true);
        const home = document.getElementById('page-chatcard');
        if (home) home.hidden = false;
      });
    }
  }

  // ================= 情绪 / 心意 / 交流意图字卡页面 =================
  const mcList = document.getElementById('mc-list');
  const mcEnabled = document.getElementById('mc-enabled');
  if (mcList && mcEnabled) {
    mcEnabled.checked = (ls.get('mc-enabled') === null) ? true : ls.get('mc-enabled') === '1';
    mcEnabled.addEventListener('change', () => {
      ls.set('mc-enabled', mcEnabled.checked ? '1' : '0');
      // v3.6.x：总开关同时控制情绪/心意/交流意图三类字卡——此前只写 mh-mood，
      //   而心意卡/意图卡无独立 UI 开关、默认开启且不依赖情绪卡命中（各按 40% 独立
      //   判定），导致关掉「使用情绪字卡」后联系人仍会发心意/意图卡（用户反馈）
      setEnabled('mood', mcEnabled.checked);
      setEnabled('heart', mcEnabled.checked);
      setEnabled('intent', mcEnabled.checked);
    });
    // v3.26.x #515：三类各自的独立判定概率 stepper（情绪 mc-prob-mood / 心意 mc-prob-heart /
    //   交流意图 mc-prob-intent）——此前只显示总开关与「各自独立概率」的说明，无任何数值入口
    const mcProbUI = {};
    [['mood', '情绪字卡概率'], ['heart', '心意字卡概率'], ['intent', '交流意图字卡概率']].forEach(function (p) {
      mcProbUI[p[0]] = bindProbStepper('mc-prob-' + p[0], 'mc-prob-' + p[0] + '-val',
        function () { return mcProb(p[0]); },
        function (v) { ls.set('mc-prob-' + p[0], String(v)); }, p[1]);
    });
    addProbUISync(function () {
      Object.keys(mcProbUI).forEach(function (k) { if (mcProbUI[k]) mcProbUI[k].refresh(); });
    });

    // #500 三类分栏：情绪 / 心意 / 交流意图（三级链各自独立概率，都要能整类+逐张关）
    const MC_TYPES = [
      { key: 'mood', name: '情绪' },
      { key: 'heart', name: '心意' },
      { key: 'intent', name: '交流意图' },
    ];
    let mcType = 'mood';
    let mcGroup = '';
    let mcQ = '';

    function typeGroups(key) {
      if (key === 'heart') {
        return (DATA.heart || []).map(g => ({ ...g, type: 'heart' }))
          .concat((DATA.specialHeart || []).map(g => ({ ...g, type: 'heart', special: true })));
      }
      if (key === 'intent') return (DATA.intent || []).map(g => ({ ...g, type: 'intent' }));
      return (DATA.mood || []).map(g => ({ ...g, type: 'mood' }));
    }
    function renderTypeBar() {
      const bar = document.getElementById('mc-type-bar');
      if (!bar) return;
      bar.innerHTML = '';
      MC_TYPES.forEach(t => {
        const cEl = document.createElement('span');
        cEl.className = 'cc-g-chip' + (mcType === t.key ? ' sel' : '');
        cEl.textContent = t.name;
        cEl.addEventListener('click', () => { mcType = t.key; mcGroup = ''; renderTypeBar(); renderMCBar(); renderMood(); });
        bar.appendChild(cEl);
      });
      const title = document.getElementById('mc-group-title');
      if (title) title.textContent = (MC_TYPES.find(t => t.key === mcType) || MC_TYPES[0]).name + '分组';
      const si = document.getElementById('mc-search-input');
      if (si) si.placeholder = '搜索' + (MC_TYPES.find(t => t.key === mcType) || MC_TYPES[0]).name + '字卡';
    }
    function renderMCBar() {
      const bar = document.getElementById('mc-groups-bar');
      if (!bar) return;
      bar.innerHTML = '';
      const groups = typeGroups(mcType);
      const chips = [['', '全部']].concat(groups.map(g => [g.group, g.group]));
      chips.forEach(([val, label]) => {
        const cEl = document.createElement('span');
        cEl.className = 'cc-g-chip' + (mcGroup === val ? ' sel' : '');
        cEl.textContent = label;
        cEl.addEventListener('click', () => { mcGroup = val; renderMCBar(); renderMood(); });
        bar.appendChild(cEl);
      });
    }
    function renderMood() {
      const groups = typeGroups(mcType);
      let shown = mcGroup ? groups.filter(g => g.group === mcGroup) : groups;
      if (mcQ) {
        shown = shown.map(g => ({ ...g, cards: g.cards.filter(c => c.content.indexOf(mcQ) >= 0) })).filter(g => g.cards.length || g.group.indexOf(mcQ) >= 0);
      }
      mcList.innerHTML = '';
      if (!shown.length) { mcList.innerHTML = '<div class="cc-empty">暂无字卡</div>'; return; }
      shown.forEach(g => {
        const h = document.createElement('div');
        h.className = 'cc-group-header';
        h.innerHTML = '<span class="ccg-name">' + g.group + '</span><span class="ccg-count">' + g.cards.length + '</span>' +
          (g.weight ? '<span class="ccg-count" style="background:rgba(0,0,0,.03)">权重 ' + g.weight + '</span>' : '') +
          (g.special ? '<span class="ccg-count" style="background:rgba(0,0,0,.03)">特殊</span>' : '');
        mcList.appendChild(h);
        g.cards.forEach(c => {
          const off = typeOff(g.type || mcType, c.content);
          const d = document.createElement('div');
          d.className = 'cc-item glass' + (off ? ' off' : '');
          // v3.6.x：整页为系统预设字卡，统一标【系统】与自定义字卡区分；
          // 右侧单卡开关——逐张开启/关闭该字卡（关闭后该类字卡不再被抽取）
          d.innerHTML = '<div class="cc-txt"><div class="t">' + c.content + ' <span class="tc-known">系统</span></div></div>' +
            '<span class="cc-type">' + (c.rarity === 'rare' ? '稀有' : c.rarity === 'special' ? '特殊' : '普通') + '</span>' +
            '<label class="toggle ccard-toggle"><input type="checkbox"' + (off ? '' : ' checked') + '><span class="tk"></span></label>';
          mcList.appendChild(d);
          d.querySelector('input').addEventListener('change', () => {
            const nowOff = !d.querySelector('input').checked;
            setTypeOff(g.type || mcType, c.content, nowOff);
            d.classList.toggle('off', nowOff);
            toastCard(c.content, nowOff);
          });
        });
      });
    }
    renderTypeBar();
    renderMCBar();
    renderMood();
    // 搜索：页内输入框直接过滤（v3.6.x：与自定义聊天字卡一致，不再弹窗，输入即筛，清空即恢复）
    const mcSearchInput = document.getElementById('mc-search-input');
    if (mcSearchInput) {
      // v3.5.138：不再标记 ceDone 跳过 contenteditable 转换——手机 Chrome 对
      // 原生 input 聚焦弹「自动填充」白条；ce-box 兼容 input 转发 + value 代理
      mcSearchInput.addEventListener('input', () => {
        mcQ = mcSearchInput.value.trim();
        renderMood();
      });
      mcSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { mcSearchInput.value = ''; mcQ = ''; renderMood(); mcSearchInput.blur(); }
      });
    }
    const li = document.getElementById('li-mood-cards');
    if (li) {
      li.addEventListener('click', () => {
        document.querySelectorAll('.page').forEach(p => p.hidden = true);
        const page = document.getElementById('page-mood-cards');
        if (page) page.hidden = false;
      });
    }
    const back = document.getElementById('mc-back');
    if (back) {
      back.addEventListener('click', () => {
        document.querySelectorAll('.page').forEach(p => p.hidden = true);
        const home = document.getElementById('page-chatcard');
        if (home) home.hidden = false;
      });
    }
  }

  // ================= 聊天回应字卡（独立字卡池，类似默认字卡） =================
// #499 需求变更（推翻 #365 #319 对本池的锁闸）：聊天回应/接话字卡不再受二级密码锁定
//   影响——未解锁也照常抽取（用户明确要求：锁定只停默认聊天字卡/词典等系统预设，
//   情绪字卡、TA 的心情、聊天回应字卡三大互动链不受影响）。
// 开启时：整体概率 rc-prob 命中 → 随机抽一个分类 → 抽一条回应字卡作为回复内容
window.getReplyCard = function () {
  if (ls.get('rc-enabled') !== null && ls.get('rc-enabled') !== '1') return '';
  // 整体出现概率：v3.26.x #515 起可调（rcard-prob，默认 30＝原写死值，与默认字卡
  //   defaultCommonOverallProb 同档）；0% = 不再整条替换成一张回应字卡
  //  （回复末尾的「连接词追加」仍由回复设置的 cf-prob 管，两处独立）
  if (Math.random() * 100 >= (window.dcpEff ? window.dcpEff(rcardProb()) : rcardProb())) return ''; // #518 套总档
  const followup = DATA.followup || {};
  // v3.6.x：单卡开关过滤——只从仍开启的分类里选（整类关完则跳过该类）
  const cats = Object.keys(followup).filter(k => followup[k] && followup[k].some(t => !isCardOff('rc-off-' + k, t)));
  if (!cats.length) return '';
  const cat = cats[Math.floor(Math.random() * cats.length)];
  const pool = followup[cat].filter(t => !isCardOff('rc-off-' + cat, t));
  return pool[Math.floor(Math.random() * pool.length)];
};
// ================= 聊天回应（连接词）=================
  window.getFollowupWord = function (reply) {
    if (ls.get('rc-enabled') !== null && ls.get('rc-enabled') !== '1') return '';
    const followup = DATA.followup || {};
    let cat = 'echo';
    if (/[?？]/.test(reply) || /(什么|哪|怎么|为什么|吗|呢)$/.test(reply)) cat = 'probe';
    else if (reply.length <= 4) cat = 'echo';
    else if (/[。.]/.test(reply.slice(-1)) && reply.length > 8) cat = Math.random() < 0.5 ? 'bridge' : 'shift';
    else if (reply.length > 10) cat = Math.random() < 0.5 ? 'keep' : 'probe';
    else cat = Math.random() < 0.5 ? 'echo' : 'confirm';
    // v3.6.x：单卡开关过滤——本类可用字卡抽空时回退到「接话」类的可用字卡
    let pool = (followup[cat] || []).filter(t => !isCardOff('rc-off-' + cat, t));
    if (!pool.length && cat !== 'echo') pool = (followup['echo'] || []).filter(t => !isCardOff('rc-off-echo', t));
    if (!pool.length) return '';
    return pool[Math.floor(Math.random() * pool.length)];
  };
  // v3.7.x：多桌面——情绪/心意状态是模块级，残留会让新桌面继承旧桌面的连续衰减/冷却/历史
  document.addEventListener('contact-switched', function () {
    emotionStreak = 0;
    emotionLastTs = 0;
    heartHistory = [];
    specialLastTime = 0;
  });
  // v3.26.x #515：字卡库【聊天情绪字卡】【聊天回应字卡】页的概率显示同理——切桌面 / IDB 回填完成 /
  //   小键写日志修正（mochi-wrj-heal）后重新读键刷新，否则切到新联系人仍显示上一个桌面的数值
  ['contact-switched', 'mochi-restore-done', 'mochi-wrj-heal'].forEach(function (ev) {
    document.addEventListener(ev, function () { try { syncCardProbUI(); } catch (e) {} });
  });
})();
