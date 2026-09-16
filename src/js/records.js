// ===== 功能：主页（最近动态：换头像记录 + 通话记录） =====
// 桌面「主页」按钮进入；换头像/通话事件自动写入，完整展示
(function () {
  const uid = window.activePrefix();
  const store = window.activeStore();
  function fmtDT(ts) {
    const d = new Date(ts);
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  // #441：主页各记录的联系人显示名统一走与聊天/通话一致的取名链（cs-lbl-partner → 桌面
  // lbl-partner → 联系人名片名 → TA）。此前各渲染点只读桌面键 lbl-partner——联系人管理
  // 新建、从未改过昵称的联系人该键为空，通话记录/换头像/抓包/心意币/关心全部显示「TA」，
  // 多联系人下分不清记录属于谁，观感＝「跨桌面通话记录串了、没显示实际联系人的电话」。
  function dispName() {
    return store.get('cs-lbl-partner')
      || store.get('lbl-partner')
      || (window.contactNameFor ? window.contactNameFor(window.__activeCid || 'default') : '')
      || (window.taWord ? window.taWord() : 'TA');
  }
  // ---- 换头像记录（含事件文案 + 头像缩略图；最多 30 条） ----
  // 记录所有换头像事件：联系人主动换我的头像（直接换 / 邀请同意 / 邀请拒绝）、
  // 我手动换自己的头像等——统一由 chatSystem 写入，text 为聊天系统消息原文
  function avatarsLoad() {
    try { return JSON.parse(store.get('records-avatar') || '[]'); } catch (e) { return []; }
  }
  function avatarsSave(list) { store.set('records-avatar', JSON.stringify(list.slice(0, 30))); }
  window.addAvatarRecord = function (img, text) {
    const list = avatarsLoad();
    list.unshift({ img: img, text: text || '', ts: Date.now() });
    avatarsSave(list);
    if (!document.getElementById('page-home').hidden) render();
  };
  // ---- 通话记录 ----
  function callsLoad() {
    try { return JSON.parse(store.get('records-call') || '[]'); } catch (e) { return []; }
  }
  function callsSave(list) { store.set('records-call', JSON.stringify(list.slice(0, 50))); }
  window.addCallRecord = function (type, text) {
    const list = callsLoad();
    list.unshift({ type: type, text: text, ts: Date.now() });
    callsSave(list);
    if (!document.getElementById('page-home').hidden) render();
  };
  // ---- 摸鱼抓包记录（v3.15.x：双向） ----
  // type='me'：我抓到联系人摸鱼（p2-features.js 桌面浮字点击抓包成功时写入）
  // type='ta'：被联系人抓到我摸鱼（personalize.js 摸鱼+1 点太频被反向抓包时写入）
  function catchesLoad() {
    try { return JSON.parse(store.get('records-fishcatch') || '[]'); } catch (e) { return []; }
  }
  function catchesSave(list) { store.set('records-fishcatch', JSON.stringify(list)); } // v3.15.x：用户要求保留全部历史，不设上限（事件本身低频，量级可控）
  window.addFishCatchRecord = function (type, text) {
    const list = catchesLoad();
    list.unshift({ type: type, text: text || '', ts: Date.now() });
    catchesSave(list);
    if (!document.getElementById('page-home').hidden) render();
  };
  // 摸鱼抓包记录渲染（最新在前，全部保留；文案按当前联系人昵称动态适配）
  function renderCatch() {
    const el = document.getElementById('home-catch');
    if (!el) return;
    const name = dispName();
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const list = catchesLoad();
    el.innerHTML = list.length
      ? list.map(x =>
          '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' +
          (x.type === 'ta'
            ? '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>' + name + ' 抓到我摸鱼'
            : '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>' + '抓到 ' + name + ' 摸鱼') +
          '</span><span class="tc-li-time">' + fmtDT(x.ts) + '</span></div>' +
          (x.text ? '<div class="tc-li-line">' + (window.taFit ? window.taFit(esc(x.text)) : esc(x.text)) + '</div>' : '') +
          '</div>'
        ).join('')
      : '<div class="ta-empty">暂无摸鱼抓包记录（桌面浮字可点击抓包 TA；点太快会被 TA 反向抓包）</div>';
  }
  // ---- 心意币流水（v3.16.x：赚钱 / 申请记录，分列我和当前联系人） ----
  // 数据由 gift-shop.js 的 giftCoinLedgerLoad 提供（按联系人桌面前缀隔离）；记录结构 { ts, myFen, taFen, src }
  function renderCoinPanel(kind) {
    const el = document.getElementById(kind === 'ask' ? 'home-coinask' : 'home-coinearn');
    if (!el) return;
    const list = (window.giftCoinLedgerLoad ? window.giftCoinLedgerLoad(kind) : []) || [];
    const name = dispName();
    const myName = store.get('lbl-user') || '我';
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    if (!list.length) {
      el.innerHTML = '<div class="ta-empty">' + (kind === 'ask' ? '暂无申请记录（可点心意币余额行向 Mochi 申请）' : '暂无赚钱记录（玩游戏、种花、钓鱼都能赚心意币）') + '</div>';
      return;
    }
    const yuan = (fen) => (fen / 100).toFixed(2);
    el.innerHTML = list.map(x => {
      let line;
      if (x.myFen && x.taFen && x.myFen === x.taFen) line = '双方各 +¥' + yuan(x.myFen);
      else {
        const parts = [];
        if (x.myFen) parts.push(myName + ' +¥' + yuan(x.myFen));
        if (x.taFen) parts.push(name + ' +¥' + yuan(x.taFen));
        line = parts.join(' · ') || '—';
      }
      const src = x.src ? esc(x.src) : (kind === 'ask' ? '向 Mochi 申请' : '赚钱');
      return '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">🪙 ' + src + '</span><span class="tc-li-time">' + fmtDT(x.ts) + '</span></div>' +
        '<div class="tc-li-line">' + line + '</div></div>';
    }).join('');
  }
  // 供 gift-shop.js 记账后即时重绘当前可见的流水面板
  window.__renderHomeCoin = function () {
    if (htab === 'coinearn') renderCoinPanel('earn');
    else if (htab === 'coinask') renderCoinPanel('ask');
  };
  // ---- 联系人的关心/提醒记录（v3.16.x：查岗 / 经期关心 / 喝水提醒 / 吃饭提醒 / 番茄陪伴） ----
  // 事件低频、按联系人桌面隔离；番茄陪伴只记时间不记内容
  function caresLoad() {
    try { return JSON.parse(store.get('records-care') || '[]'); } catch (e) { return []; }
  }
  function caresSave(list) { store.set('records-care', JSON.stringify(list.slice(0, 100))); }
  // kind: checkin=查岗 / period=经期关心 / water=喝水提醒 / eat=吃饭提醒 / pomo=番茄陪伴
  // v3.17.x：desk-checkin=桌面查岗（跨桌面「来消息」触发的查岗，记到【该联系人自己桌面】的
  // records-care，主页关心记录按联系人聚合展示；与聊天里触发的 checkin 区分，见 renderCarePanel）
  window.addCareRecord = function (kind, text, ts) {
    const list = caresLoad();
    list.unshift({ kind: kind, text: text || '', ts: ts || Date.now() });
    caresSave(list);
    const hp = document.getElementById('page-home');
    if (hp && !hp.hidden && htab === 'care') renderCarePanel();
  };
  // v3.17.x：写【指定联系人桌面】的关心记录——跨桌面查岗落在该桌面自己的命名空间
  window.addCareRecordFor = function (cid, kind, text, ts) {
    try {
      const s = (cid && window.storeFor) ? window.storeFor(cid) : store;
      let list = [];
      try { list = JSON.parse(s.get('records-care') || '[]'); } catch (e) { list = []; }
      if (!Array.isArray(list)) list = [];
      list.unshift({ kind: kind, text: text || '', ts: ts || Date.now() });
      s.set('records-care', JSON.stringify(list.slice(0, 100)));
    } catch (e) {}
  };
  // 查岗/经期/喝水/吃饭从聊天记录回溯（带 tag 或 ask-card），番茄陪伴读 records-care
  function renderCarePanel() {
    const el = document.getElementById('home-care');
    if (!el) return;
    const name = dispName();
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const KIND_ICON = { checkin: '📋', period: '🌸', water: '💧', eat: '🍚', pomo: '🍅', deskcheck: '🏠' };
    const rows = [];
    // 1) 番茄陪伴：records-care 里的 pomo 记录（只记时间）
    caresLoad().forEach(r => { if (r.kind === 'pomo') rows.push({ icon: '🍅', main: '番茄钟陪伴', sub: fmtDT(r.ts), ts: r.ts }); });
    // 2) 查岗 / 经期 / 喝水 / 吃饭：从聊天记录回溯
    // v3.25.x：跨桌面查岗卡（deskCk）与该联系人 records-care 里的 desk-checkin 记录是
    // 同一次事件（记录随卡同刻写入；同联系人冷却 30 分钟，90s 窗口内不会误合并）——
    // 已有对应记录的卡不再按「查岗」重复列，防同一次查岗在来源桌面出两行；
    // 无记录的旧卡（历史数据/仅聊天触发）仍照列。
    let careTs = [];
    try { caresLoad().forEach(r => { if (r && r.kind === 'desk-checkin') careTs.push(r.ts || 0); }); } catch (e) {}
    let msgs = [];
    try { msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]')); } catch (e) {}
    // FIX 2026-09-16 #588：本段原是 O(n²)——每条 ask-msg 都要把整个 msgs 再 some() 一遍找
    //   30s 内的问卡；聊天记录上千条时，点开「关心」页签会明显卡住（用户感知＝点了没反应）。
    //   改为先把问卡时间戳排序一次，再按 [t-30000, t+30000) 二分查，
    //   与原判定 Math.abs((o.ts||0) - t) < 30000 完全等价。
    const askCardTs = [];
    (msgs || []).forEach(o => { if (o && o.special === 'ask-card' && o.askQuestion) askCardTs.push(o.ts || 0); });
    askCardTs.sort((a, b) => a - b);
    const hasAskCardNear = (t) => {
      let lo = 0, hi = askCardTs.length;
      const from = t - 30000, to = t + 30000;
      // 下界必须是「严格大于 from」：原判据 Math.abs(dt) < 30000 是开区间，
      // 恰好相差 30000ms 时判 false（等价性对拍 C1 抓到过这里写成 >= 会多判 1 例）
      while (lo < hi) { const mid = (lo + hi) >> 1; if (askCardTs[mid] <= from) lo = mid + 1; else hi = mid; }
      return lo < askCardTs.length && askCardTs[lo] < to;
    };
    (msgs || []).forEach(m => {
      if (!m) return;
      const t = m.ts || 0;
      const tag = (m.mood && m.mood[0] && m.mood[0].tag) || '';
      if (tag === '经期关心') rows.push({ icon: KIND_ICON.period, main: '经期关心 · ' + esc(m.text || ''), sub: fmtDT(t), ts: t });
      else if (tag === '喝水提醒') rows.push({ icon: KIND_ICON.water, main: '提醒喝水 · ' + esc(m.text || ''), sub: fmtDT(t), ts: t });
      else if (tag === '吃饭提醒') rows.push({ icon: KIND_ICON.eat, main: '提醒吃饭 · ' + esc(m.text || ''), sub: fmtDT(t), ts: t });
      // 查岗：ask-card 是问题卡本体；ask-msg 提示语只作补充（若 30s 内已有问卡则不重复列）
      else if (m.special === 'ask-card' && m.askQuestion && !(m.deskCk && careTs.some(ct => Math.abs(ct - t) <= 90000))) rows.push({ icon: KIND_ICON.checkin, main: '查岗 · ' + esc(m.askQuestion), sub: fmtDT(t), ts: t });
      else if (m.special === 'ask-msg' && /查岗/.test(m.text || '')) {
        const nearCard = hasAskCardNear(t); // #588：二分查，不再对全表 some()
        if (!nearCard) rows.push({ icon: KIND_ICON.checkin, main: '查岗', sub: fmtDT(t), ts: t });
      }
    });
    // 3) 桌面查岗（v3.17.x）：跨桌面「来消息」触发的查岗——记在各联系人自己桌面的
    //    records-care（addCareRecordFor 写入），这里按联系人聚合展示。
    //    与聊天触发的查岗（上一节 checkin）分开列：主文案「桌面查岗 · <联系人昵称>」。
    if (window.getContacts) {
      (window.getContacts() || []).forEach(function (c) {
        let care = [];
        try {
          const s = (c.id && window.storeFor) ? window.storeFor(c.id) : store;
          care = JSON.parse(s.get('records-care') || '[]');
        } catch (e) { care = []; }
        (Array.isArray(care) ? care : []).forEach(function (r) {
          if (!r || r.kind !== 'desk-checkin') return;
          const cname = (c && c.name) || 'TA';
          rows.push({ icon: KIND_ICON.deskcheck, main: '桌面查岗 · ' + esc(cname) + ' · ' + esc(r.text || ''), sub: fmtDT(r.ts || 0), ts: r.ts || 0 });
        });
      });
    }
    if (!rows.length) { el.innerHTML = '<div class="ta-empty">暂无联系人的关心记录（TA 会主动查岗、提醒你喝水吃饭、关心经期、陪你专注）</div>'; return; }
    rows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    el.innerHTML = rows.map(r => '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' + r.icon + ' ' + r.main + '</span><span class="tc-li-time">' + r.sub + '</span></div></div>').join('');
  }
  // ---- 心意币红包记录（v3.16.x：双向——我发 + 联系人发；红包即心意币，读当前桌面聊天记录） ----
  function renderRpPanel() {
    const el = document.getElementById('home-coinrp');
    if (!el) return;
    const name = dispName();
    const myName = store.get('lbl-user') || '我';
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    let msgs = [];
    try { msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]')); } catch (e) {}
    const list = (msgs || []).filter(m => m && m.special === 'redpacket');
    if (!list.length) { el.innerHTML = '<div class="ta-empty">暂无红包记录（红包也是心意币，快去发一个试试）</div>'; return; }
    const stMap = { pending: '待领取', received: '已领取', expired: '已过期·退回', returned: '已退回' };
    el.innerHTML = list.slice().reverse().map(m => {
      const out = m.side === 'out';
      const st = stMap[m.rpStatus || 'pending'] || '';
      const amt = Number(m.rpAmount || 0).toFixed(2);
      const sub = (out ? myName + ' 发给 ' + name : name + ' 发给 ' + myName) + ' · ' + (st || '待领取') +
        (m.rpWish ? ' · 「' + esc(m.rpWish) + '」' : '');
      return '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' + (out ? '🧧 我发红包 ¥' + amt : '🧧 ' + esc(name) + ' 发红包 ¥' + amt) + '</span><span class="tc-li-time">' + fmtDT(m.rpTs || m.ts) + '</span></div>' +
        '<div class="tc-li-line">' + sub + '</div></div>';
    }).join('');
  }
  // ---- 占卜记录（v3.26.x：占卜页抽牌时选了对象 → 存入该联系人桌面的 records-divine） ----
  // 记录结构 { ts, mode, count, question, cards, summary, target }，写入方在 divination.js
  function renderDivinePanel() {
    const el = document.getElementById('home-divine');
    if (!el) return;
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const list = histList('records-divine');
    if (!list.length) {
      el.innerHTML = '<div class="ta-empty">暂无占卜记录（在「占卜」页选择对象抽牌后，牌面与解读自动存入这里）</div>';
      return;
    }
    el.innerHTML = list.map((h, i) => {
      const n = Array.isArray(h.cards) ? h.cards.length : (h.count || 0);
      const cardsTxt = Array.isArray(h.cards) ? h.cards.map(c => ((c && c.name) || '') + (c && c.rev ? '(逆)' : '')).join('、') : '';
      const title = (h.mode === 'tarot' ? '塔罗' : '雷诺曼') + ' · ' + n + ' 张' + (h.target ? ' · 为 ' + esc(h.target) + ' 占卜' : '');
      return '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">🔮 ' + title +
        (h.question ? ' · 问：' + esc(h.question) : '') + '</span><span class="tc-li-time">' + fmtDT(h.ts) + '</span></div>' +
        (cardsTxt ? '<div class="tc-li-line">' + esc(cardsTxt) + '</div>' : '') +
        (h.summary ? '<div class="tc-li-line">' + (window.taFit ? window.taFit(esc(h.summary)) : esc(h.summary)) + '</div>' : '') +
        '<button class="div-h-view hd-view" data-di="' + i + '">查看牌面</button></div>';
    }).join('');
    // 查看牌面：跳转到占卜页并渲染完整结果（复用 divineRenderResult）
    el.querySelectorAll('.hd-view').forEach(b => b.addEventListener('click', () => {
      const h = histList('records-divine')[parseInt(b.dataset.di, 10)];
      if (!h || !Array.isArray(h.cards) || !window.divineRenderResult) return;
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const dp = document.getElementById('page-divine');
      if (dp) dp.hidden = false;
      try { window.divineRenderResult(h.cards, h.mode, h.question || '', h.summary || ''); } catch (e) {}
    }));
  }
  // ---- 渲染主页记录 ----
  function histList(key) { try { return JSON.parse(store.get(key) || '[]'); } catch (e) { return []; } }
  // v3.9.x：联系人今日情话 / 我的备忘 / 我的心情记录已迁移到日历页按天查看，主页不再保留
  let htab = 'av';
  // 每日摸鱼值记录
  window.renderFishHistory = function () {
    const el = document.getElementById('home-fish');
    if (!el) return;
    const h = (window.getFishHistory && window.getFishHistory()) || [];
    const name = dispName();
    const myName = store.get('lbl-user') || '我';
    // 顶部历史累计（我的 + 联系人）
    const tot = (window.getFishTotals && window.getFishTotals()) || { mine: 0, ta: 0 };
    const totalHtml =
      '<div class="fish-total">' +
        '<span class="ft-item"><b>' + myName + '</b> 累计 ' + (tot.mine || 0) + '</span>' +
        '<span class="ft-item"><b>' + name + '</b> 累计 ' + (tot.ta || 0) + '</span>' +
      '</div>';
    // v3.13.x：摸鱼连击纪录（桌面周末组件「摸鱼+1」短时连击的最高存档）
    const cb = (window.getFishComboBest && window.getFishComboBest()) || { today: 0, best: 0 };
    const comboHtml = (cb && (cb.today > 0 || cb.best > 0))
      ? '<div class="fish-combo-line">今日最高连击 ×' + (cb.today || 0) + ' · 历史最高 ×' + (cb.best || 0) + '</div>'
      : '';
    el.innerHTML = totalHtml + comboHtml + (h.length
      ? h.map(x => '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' + x.date + '</span></div>' +
          '<div class="tc-li-line">' + myName + ' 当天摸鱼：+' + (x.mine || 0) + '</div>' +
          '<div class="tc-li-line">' + name + ' 当天摸鱼：+' + (x.ta || 0) + '</div></div>').join('')
      : '<div class="ta-empty">暂无摸鱼值记录</div>');
  };
  // 每日打工值记录（v3.5.65：与每日摸鱼值同款——顶部累计 + 每日新增）
  window.renderWorkHistory = function () {
    const el = document.getElementById('home-work');
    if (!el) return;
    const h = (window.getWorkHistory && window.getWorkHistory()) || [];
    const name = dispName();
    const myName = store.get('lbl-user') || '我';
    const tot = (window.getWorkTotals && window.getWorkTotals()) || { mine: 0, ta: 0 };
    const totalHtml =
      '<div class="fish-total">' +
        '<span class="ft-item"><b>' + myName + '</b> 累计 ' + (tot.mine || 0) + '</span>' +
        '<span class="ft-item"><b>' + name + '</b> 累计 ' + (tot.ta || 0) + '</span>' +
      '</div>';
    el.innerHTML = totalHtml + (h.length
      ? h.map(x => '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' + x.date + '</span></div>' +
          '<div class="tc-li-line">' + myName + ' 当天打工：+' + (x.mine || 0) + '</div>' +
          '<div class="tc-li-line">' + name + ' 当天打工：+' + (x.ta || 0) + '</div></div>').join('')
      : '<div class="ta-empty">暂无打工值记录</div>');
  };
  function render() {
    // 只渲染当前 tab 面板（避免隐藏面板无谓渲染）
    const showOnly = htab;
    // 每日打工值记录
    if (showOnly === 'work') {
      window.renderWorkHistory();
    }
    // 每日摸鱼值记录
    if (showOnly === 'fish') {
      window.renderFishHistory();
    }
    // 摸鱼抓包记录（双向：我抓到 TA / 被 TA 抓到）
    if (showOnly === 'catch') {
      renderCatch();
    }
    // 心意币赚钱记录 / 申请记录（v3.16.x）
    if (showOnly === 'coinearn') {
      renderCoinPanel('earn');
    }
    if (showOnly === 'coinask') {
      renderCoinPanel('ask');
    }
    // 心意币红包记录（v3.16.x：双向）
    if (showOnly === 'coinrp') {
      renderRpPanel();
    }
    // 联系人的关心/提醒记录（v3.16.x）
    if (showOnly === 'care') {
      renderCarePanel();
    }
    // 占卜记录（v3.26.x：抽牌选了对象，存该联系人桌面 records-divine）
    if (showOnly === 'divine') {
      renderDivinePanel();
    }
    // 换头像记录（全部事件：直接换 / 邀请同意 / 邀请拒绝 / 我手动更换）
    if (showOnly === 'av') {
      const avEl = document.getElementById('home-av');
      if (avEl) {
        const list = avatarsLoad();
        const name = dispName();
        const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        avEl.innerHTML = list.length
          ? list.map(x =>
              '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' + (window.taFit ? window.taFit(esc(x.text || (name + ' 更换了头像'))) : esc(x.text || (name + ' 更换了头像'))) + '</span><span class="tc-li-time">' + fmtDT(x.ts) + '</span></div>' +
              (x.img ? '<img class="rec-av-img" src="' + x.img + '" alt="头像">' : '') +
              '</div>'
            ).join('')
          : '<div class="ta-empty">暂无换头像记录</div>';
      }
    }
    // 通话记录
    if (showOnly === 'call') {
      const callEl = document.getElementById('home-call');
      if (callEl) {
        const list = callsLoad();
        const name = dispName();
        const icIn = '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>';
        const icOut = '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/><path d="M16 3v6M19 6h-6"/></svg>';
        callEl.innerHTML = list.length
          ? list.map(x => {
              const itp = x.ended === 'interrupt';
              return '<div class="tc-listitem' + (itp ? ' tc-call-interrupt' : '') + '"><div class="tc-li-top"><span class="tc-li-q">' +
                (x.type === 'in' ? icIn + name + ' 来电' : icOut + name + ' 拨打') +
                '</span>' + (itp ? '<span class="tc-li-interrupt-tag">中断</span>' : '') + '<span class="tc-li-time">' + fmtDT(x.ts) + '</span></div>' +
                (x.text ? '<div class="tc-li-line">' + (window.taFit ? window.taFit(x.text) : x.text) + '</div>' : '') +
                '</div>';
            }).join('')
          : '<div class="ta-empty">暂无通话记录</div>';
      }
    }
  }
  // 主页顶部 tab 切换
  document.querySelectorAll('#page-home .fav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      htab = tab.dataset.htab;
      document.querySelectorAll('#page-home .fav-tab').forEach(x => x.classList.toggle('sel', x === tab));
      document.querySelectorAll('#page-home .cal-card').forEach(c => { c.hidden = c.dataset.hpanel !== htab && c.dataset.hpanel !== '*'; });
      render();
    });
  });
  // v3.5.113：IndexedDB 回填完成后重绘主页当前面板（导入/配额异常恢复后的数据）
  try {
    document.addEventListener('mochi-restore-done', function () {
      try {
        if (!document.getElementById('page-home').hidden) render();
      } catch (e) {}
    });
  } catch (e) {}
  // 入口：桌面「主页」按钮
  const homeApp = document.querySelector('.app[data-app="home"]');
  const homePage = document.getElementById('page-home');
  if (homeApp && homePage) {
    homeApp.addEventListener('click', () => {
      const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
      if (editing) return;
      render();
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      homePage.hidden = false;
    });
  }
  const homeBack = document.getElementById('home-back');
  if (homeBack) {
    homeBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const phone = document.getElementById('page-phone');
      if (phone) phone.hidden = false;
    });
  }
  render();

  // v3.5.94：换头像记录含图片，可能只存在 IndexedDB → 启动补读（主页打开时才渲染，届时读到）
  try {
    if (window.idbGet) {
      const myPrefix = window.activePrefix();
      window.idbGet(myPrefix + ':records-avatar').then(v => {
        if (window.activePrefix() !== myPrefix) return;
        if (v && typeof v === 'string' && v.length > 2) store.set('records-avatar', v);
      });
    }
  } catch (e) {}

  // 联系人主动来电已由 call.js 统一管理（弹窗/接听/小框/概率），此处仅保留记录存储

  // v3.6.x：多桌面——切换联系人后若记录页可见则重渲染（读新桌面数据）
  document.addEventListener('contact-switched', function () {
    try {
      const hp = document.getElementById('page-home');
      if (hp && !hp.hidden) render();
    } catch (e) {}
  });
  // v3.26.x：供 call.js 中断恢复后刷新主页通话记录面板
  window.__renderHomeCall = function () {
    try { if (!document.getElementById('page-home').hidden && htab === 'call') render(); } catch (e) {}
  };
})();
