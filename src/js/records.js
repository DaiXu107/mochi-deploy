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
  // #441：主页各记录的联系人显示名统一走一条取名链（桌面 lbl-partner → 聊天 cs-lbl-partner
  // → 联系人名片名 → TA）。此前各渲染点只读桌面键 lbl-partner——联系人管理新建、从未改过
  // 昵称的联系人该键为空，通话记录/换头像/抓包/心意币/关心全部显示「TA」，多联系人下分不清
  // 记录属于谁，观感＝「跨桌面通话记录串了、没显示实际联系人的电话」。
  // 2026-09-16（#616）：桌面昵称提到聊天昵称之前——主页属于「其他功能」，不该被昵称池频繁
  // 轮换的聊天昵称带着一起变；桌面没设过时仍退回聊天昵称，只设过聊天昵称的老用户显示不变。
  function dispName() {
    return store.get('lbl-partner')
      || store.get('cs-lbl-partner')
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
  // FIX 2026-09-29 #1416：删除身份不能拿数组下标。这张表是 window.addFishCatchRecord 用 unshift
  //   头插的，「删除这条抓包记录？」的确认框停在屏上那几秒里 TA 反向抓包落一条，全体下标就前移一位
  //   ⇒ splice 摘掉的是别人那一行（删错＝丢用户数据）。口径照同批 memo-arc.js 的 delHist：拿内容当身份
  //   （ts 毫秒＋type，本表内唯一），写回那一刻再认一次；认不到就什么都不删并如实说一句
  //   （宁可删不掉，不可删错）。
  function histKey(x) { return 'k|' + ((x && x.ts) || 0) + '|' + ((x && x.type) || ''); }
  window.addFishCatchRecord = function (type, text) {
    const list = catchesLoad();
    list.unshift({ type: type, text: text || '', ts: Date.now() });
    catchesSave(list);
    if (!document.getElementById('page-home').hidden) render();
  };
  // #804 数据就绪缓冲：回填未完成时空态不得把「还没读到」说成「没有」——慢机器上用户会当成
  // 「记录全丢了」报障（同 #785 日历/信箱/朋友圈口径；判据取时序状态，零机型分支）
  function recEmpty(finalHtml) {
    return (window.mochiDataPending && window.mochiDataPending()) ? '<div class="ta-empty">' + window.mochiLoadingText() + '</div>' : finalHtml;
  }
  // 摸鱼抓包记录渲染（最新在前，全部保留；文案按当前联系人昵称动态适配）
  function renderCatch() {
    const el = document.getElementById('home-catch');
    if (!el) return;
    const name = dispName();
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const list = catchesLoad();
    // #1403：这一栏 v3.15.x 起「保留全部历史、不设上限」（作者当时的要求），所以既不能现在偷偷加封顶，
    // 也不能让它一直平铺到底——交站内唯一那把尺子（当天直显＋更早按月折），并给每条一枚「删除」。
    // 写回仍走既有 catchesSave，不另开一条写法。
    el.innerHTML = window.mochiHistFold(list.map((x, n) => ({ ts: Number(x.ts) || 0, html:
          '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' +
          (x.type === 'ta'
            ? '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>' + name + ' 抓到我摸鱼'
            : '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>' + '抓到 ' + name + ' 摸鱼') +
          '</span><span class="tc-li-time">' + fmtDT(x.ts) + '</span>' + window.mochiHistDel(histKey(x), (x.type === 'ta' ? name + ' 抓到我摸鱼' : '抓到 ' + name + ' 摸鱼')) + '</div>' +
          (x.text ? '<div class="tc-li-line">' + (window.taFit ? window.taFit(esc(x.text)) : esc(x.text)) + '</div>' : '') +
          '</div>'
    })), {
      key: 'records-catch',
      empty: recEmpty('<div class="ta-empty">暂无摸鱼抓包记录（桌面浮字可点击抓包 TA；点太快会被 TA 反向抓包）</div>'),
      todayEmpty: '<div class="dc-h-day-empty">今天没有被抓包</div>'
    });
    window.mochiHistDelBind(el, {
      title: '删除这条抓包记录？',
      onDel: function (k) {
        const arr = catchesLoad();
        const p = String(k).split('|');
        const ts = Number(p[1]) || 0, ty = p[2] || '';
        const i = arr.findIndex(function (x) { return x && (Number(x.ts) || 0) === ts && String(x.type || '') === ty; });
        if (i < 0) { if (typeof window.toast === 'function') window.toast('这条已经变了，没有删掉任何内容'); return; }
        arr.splice(i, 1);
        catchesSave(arr);
        render();
        if (typeof window.toast === 'function') window.toast('已删除这条抓包记录');
      }
    });
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
      el.innerHTML = recEmpty('<div class="ta-empty">' + (kind === 'ask' ? '暂无申请记录（可点心意币余额行向 Mochi 申请）' : '暂无赚钱记录（玩游戏、种花、钓鱼都能赚心意币）') + '</div>');
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
  // ---- #1493 情话存档（quote-history 每天一条，此前只在日历按天可查；这里给整本一个折叠列表＋单条删除） ----
  // 只认 {date,text,ts}；删除按 ts+date 认条（认不到宁可说不删）；写路接 #1488 同款闸
  function renderQuotePanel() {
    const el = document.getElementById('home-quotes');
    if (!el) return;
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    let list = [];
    try { list = JSON.parse(store.get('quote-history') || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    const items = list.map((x) => ({ ts: Number(x.ts) || 0, html:
      '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">💬 ' + esc(x.text || '') + '</span><span class="tc-li-time">' + esc(x.date || '') + '</span>' + window.mochiHistDel('q|' + (Number(x.ts) || 0) + '|' + String(x.date || ''), '情话存档 · ' + esc(x.date || '')) + '</div></div>'
    }));
    el.innerHTML = window.mochiHistFold(items, {
      key: 'records-quotes',
      empty: recEmpty('<div class="ta-empty">暂无情话存档（主页「今日情话」每天会自动存一条）</div>'),
      todayEmpty: '<div class="dc-h-day-empty">今天的情话在主页卡上</div>'
    });
    window.mochiHistDelBind(el, {
      title: '删除这条情话存档？',
      onDel: function (k) {
        const p = String(k).split('|');
        const ts = Number(p[1]) || 0, date = p.slice(2).join('|');
        let arr = [];
        try { arr = JSON.parse(store.get('quote-history') || '[]'); } catch (e) { arr = []; }
        if (!Array.isArray(arr)) arr = [];
        const i = arr.findIndex(function (x) { return x && (Number(x.ts) || 0) === ts && String(x.date || '') === date; });
        if (i < 0) { if (typeof window.toast === 'function') window.toast('这条已经变了，没有删掉任何内容'); return; }
        if (window.xyBigWriteBlocked && window.xyBigWriteBlocked(store, 'quote-history', '情话存档')) return;
        arr.splice(i, 1);
        try { store.set('quote-history', JSON.stringify(arr)); } catch (e) {}
        renderQuotePanel();
        if (typeof window.toast === 'function') window.toast('已删除这条情话存档');
      }
    });
  }

  // ---- 联系人的关心/提醒记录（v3.16.x：查岗 / 经期关心 / 喝水提醒 / 吃饭提醒 / 番茄陪伴） ----
  // 事件低频、按联系人桌面隔离；番茄陪伴只记时间不记内容
  function caresLoad() {
    try { return JSON.parse(store.get('records-care') || '[]'); } catch (e) { return []; }
  }
  function caresSave(list) { if (window.xyBigWriteHold && window.xyBigWriteHold(store, 'records-care')) return; store.set('records-care', JSON.stringify(list)); } // #1493 作者「要保存所有记录」＝拆掉 100 条封顶；读不全先让路
  // kind: checkin=查岗 / period=经期关心 / water=喝水提醒 / eat=吃饭提醒 / pomo=番茄陪伴
  // v3.17.x：desk-checkin=桌面查岗（跨桌面「来消息」触发的查岗，记到【该联系人自己桌面】的
  // records-care）。#1435 起这一类不再在「TA的关心」里出现，改由主页「联系人跨桌面查岗」一栏
  // 按联系人聚合展示（作者口径：移出来，各归各 tab）；res 是新加的结局标签（replied/later/missed），
  // 老记录没有这个字段，那一行就不显示结局，绝不拿默认值冒充「错过」。
  window.addCareRecord = function (kind, text, ts) {
    const list = caresLoad();
    list.unshift({ kind: kind, text: text || '', ts: ts || Date.now() });
    caresSave(list);
    const hp = document.getElementById('page-home');
    if (hp && !hp.hidden && (htab === 'care' || (htab === 'xck' && kind === 'desk-checkin'))) render();
  };
  // v3.17.x：写【指定联系人桌面】的关心记录——跨桌面查岗落在该桌面自己的命名空间
  // #1435：第 5 参 res＝这次跨桌面查岗的结局（'replied' 点了现在回TA / 'later' 选了稍后 /
  // 'missed' 弹窗错过没点【确认】）。错过的那条**只落这里、不进聊天**——聊天里没有这张卡是
  // 作者点名的规则，主页这一栏是它唯一的留痕处。
  window.addCareRecordFor = function (cid, kind, text, ts, res) {
    try {
      const s = (cid && window.storeFor) ? window.storeFor(cid) : store;
      if (window.xyBigWriteHold && window.xyBigWriteHold(s, 'records-care')) return; // #1493 读不全先让路（错过的跨桌面查岗唯一留痕，更不许顶库）
      let list = [];
      try { list = JSON.parse(s.get('records-care') || '[]'); } catch (e) { list = []; }
      if (!Array.isArray(list)) list = [];
      list.unshift({ kind: kind, text: text || '', ts: ts || Date.now(), res: res || '' });
      s.set('records-care', JSON.stringify(list)); // #1493 拆封顶（错过未回应只落这里＝唯一留痕，不许裁）
      // 记录落在【那个联系人自己的桌面】；只有它正是当前桌面、且主页停在这两栏之一时才重画
      if (cid === (window.__activeCid || 'default')) {
        const hp = document.getElementById('page-home');
        if (hp && !hp.hidden && htab === 'xck') renderXckPanel();
      }
    } catch (e) {}
  };
  // ---- 邀请贴贴记录（#1435：TA 发起的贴贴邀请，此前主页查不到，只散在聊天气泡与弹窗里）----
  // 一条邀请一行，res 随用户回应/超时就地更新（同一 ts 那一行，不另起第二行＝一件事一条记录）。
  // 键 records-cuddle 走联系人桌面命名空间；feature-data 的 /^records-(?!coin)/ 与整包备份的
  // 'records-' 前缀都自动认领，无需另登记。
  function cuddleLoad() {
    try { const l = JSON.parse(store.get('records-cuddle') || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; }
  }
  function cuddleSaveFor(cid, list) {
    // 作者口径（#1403）：不封顶，「我都要保存历史记录」——长靠折叠、要清靠按条删
    try {
      const s = (cid && window.storeFor) ? window.storeFor(cid) : store;
      s.set('records-cuddle', JSON.stringify(list));
    } catch (e) {}
  }
  function cuddleLoadFor(cid) {
    try {
      const s = (cid && window.storeFor) ? window.storeFor(cid) : store;
      const l = JSON.parse(s.get('records-cuddle') || '[]');
      return Array.isArray(l) ? l : [];
    } catch (e) { return []; }
  }
  window.addCuddleRecordFor = function (cid, rec) {
    try {
      if (!rec || !rec.ts) return false;
      const list = cuddleLoadFor(cid);
      if (list.some(x => x && x.ts === rec.ts)) return false; // 同一次邀请只记一条
      list.unshift({ ts: rec.ts, text: rec.text || '', res: rec.res || 'pending' });
      cuddleSaveFor(cid, list);
      const hp = document.getElementById('page-home');
      if (cid === (window.__activeCid || 'default') && hp && !hp.hidden && htab === 'cuddle') renderCuddlePanel();
      return true;
    } catch (e) { return false; }
  };
  // 结局回收：把同一 ts 那行的 res 换成 replied/declined/missed（找不到＝那条已被删，静默不补行）
  window.setCuddleRecordResult = function (cid, ts, res) {
    try {
      const list = cuddleLoadFor(cid);
      let hit = false;
      list.forEach(x => { if (x && x.ts === ts) { x.res = res; hit = true; } });
      if (!hit) return false;
      cuddleSaveFor(cid, list);
      const hp = document.getElementById('page-home');
      if (cid === (window.__activeCid || 'default') && hp && !hp.hidden && htab === 'cuddle') renderCuddlePanel();
      return true;
    } catch (e) { return false; }
  };

  // 查岗/经期/喝水/吃饭从聊天记录回溯（带 tag 或 ask-card），番茄陪伴读 records-care
  function renderCarePanel() {
    const el = document.getElementById('home-care');
    if (!el) return;
    const name = dispName();
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const KIND_ICON = { period: '🌸', sym: '💊', water: '💧', eat: '🍚', pomo: '🍅' }; // #1474 加 sym
    const rows = [];
    // 1) 番茄陪伴：records-care 里的 pomo 记录（只记时间）
    caresLoad().forEach(r => { if (r.kind === 'pomo') rows.push({ icon: '🍅', main: '番茄钟陪伴', sub: fmtDT(r.ts), ts: r.ts, del: window.mochiHistDel('p|' + (Number(r.ts) || 0), '番茄钟陪伴 · ' + fmtDT(r.ts)) }); }); // #1493 自有数组行可单删（聊天回溯行仍不动＝删原文回聊天页）
    // 2) 经期 / 喝水 / 吃饭：从聊天记录的 mood tag 回溯
    // #1435（作者「移出来，各归各 tab」）：这一栏原有的两类查岗行不再在这儿现算——
    //  · 本桌面的查岗卡 → 主页「联系人对我查岗」（renderCkPanel）
    //  · 其他桌面来查岗（records-care 的 desk-checkin）→ 主页「联系人跨桌面查岗」（renderXckPanel）
    // 顺带修掉一处指认错误：TA 的询问（ta-ask.js:918 的 ask-card，带 askTs）此前也被这一栏
    // 列成「查岗 · <问题>」，它其实是「询问」不是查岗，那一类有各自的提问记录页。
    let msgs = [];
    try { msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]')); } catch (e) {}
    (msgs || []).forEach(m => {
      if (!m) return;
      const t = m.ts || 0;
      const tag = (m.mood && m.mood[0] && m.mood[0].tag) || '';
      if (tag === '经期关心') rows.push({ icon: KIND_ICON.period, main: '经期关心 · ' + esc(m.text || ''), sub: fmtDT(t), ts: t });
      else if (tag === '症状关心') rows.push({ icon: KIND_ICON.sym, main: '症状关心 · ' + esc(m.text || ''), sub: fmtDT(t), ts: t }); // #1474：经期页记了症状后梦角发的那条
      else if (tag === '喝水提醒') rows.push({ icon: KIND_ICON.water, main: '提醒喝水 · ' + esc(m.text || ''), sub: fmtDT(t), ts: t });
      else if (tag === '吃饭提醒') rows.push({ icon: KIND_ICON.eat, main: '提醒吃饭 · ' + esc(m.text || ''), sub: fmtDT(t), ts: t });
    });
    if (!rows.length) { el.innerHTML = recEmpty('<div class="ta-empty">暂无联系人的关心记录（TA 会提醒你喝水吃饭、关心经期与症状、陪你专注；查岗看「联系人对我查岗」与「联系人跨桌面查岗」两栏）</div>'); return; }
    rows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    // #1403：这两栏（关心／红包）只做「当天直显＋更早按月折叠」，**刻意不给按条删除**——
    // 它们是**现算出来的汇总视图**：关心＝聊天记录里带 mood 标记的那几条 ＋ records-care 里的番茄陪伴，
    // 红包＝聊天记录里 special==='redpacket' 的那几条。条目身份就是聊天原文本身，
    // 在这一页删一条＝替用户改动聊天历史；而站内删消息只在聊天里做、且有「只允许删对方发来的」那一族
    // 限制（chat.js 的 del 分支），从汇总页绕过它＝造出第二份真相与「删了又回来」的新竞态。
    // 所以这一栏的职责是「看全」，要清就回那条消息所在的地方清；能按条删的都是本站自己的数组
    // （寻踪记录、摸鱼/打工值、心意柜、提问记录五档、#1435 的邀请贴贴）。
    el.innerHTML = window.mochiHistFold(rows.map(r => ({ ts: Number(r.ts) || 0, html: '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' + r.icon + ' ' + r.main + '</span><span class="tc-li-time">' + r.sub + '</span>' + (r.del || '') + '</div></div>' })), {
      key: 'records-care',
      todayEmpty: '<div class="dc-h-day-empty">今天暂无关心记录</div>'
    });
    // #1493：只有自有数组行（番茄陪伴）挂着删除件；委托按前缀认（聊天回溯行没有删除件，天然不进这条）
    window.mochiHistDelBind(el, {
      title: '删除这条番茄陪伴记录？',
      onDel: function (k) {
        if (String(k).indexOf('p|') !== 0) return;
        const ts = Number(String(k).slice(2)) || 0;
        const arr = caresLoad();
        const i = arr.findIndex(function (x) { return x && x.kind === 'pomo' && (Number(x.ts) || 0) === ts; });
        if (i < 0) { if (typeof window.toast === 'function') window.toast('这条已经变了，没有删掉任何内容'); return; }
        if (window.xyBigWriteBlocked && window.xyBigWriteBlocked(store, 'records-care', '关心记录')) return;
        arr.splice(i, 1);
        caresSave(arr);
        render();
        if (typeof window.toast === 'function') window.toast('已删除这条番茄陪伴记录');
      }
    });
  }
  // ---- 联系人对我查岗（#1435：从「TA的关心」搬出来单列）----
  // 现算自【本桌面】聊天记录，不另开数组：查岗卡＝ck-question.js:337 发的 ask-card。
  // 两个排除条件都是身份判据，不是猜的：
  //  · m.askTs 有值＝ta-ask.js:918 的「TA 的询问」（有自己的提问记录页），不是查岗；
  //  · m.deskCk 有值＝跨桌面那一路发的卡，归「联系人跨桌面查岗」。
  // ask-msg 提示语只作补充（卡被删掉时留个痕）；这一栏与关心同族＝汇总视图 → 只折叠、不给按条删。
  function renderCkPanel() {
    const el = document.getElementById('home-ck');
    if (!el) return;
    const name = dispName();
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    let msgs = [];
    try { msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]')); } catch (e) {}
    // FIX 2026-09-16 #588 同款（这段随「查岗」一起从关心搬过来，口径一字未动）：本段原是 O(n²)——
    //   每条 ask-msg 都要把整个 msgs 再 some() 一遍找 30s 内的问卡；聊天记录上千条时点开页签会明显卡住。
    //   先把问卡时间戳排序一次，再按 [t-30000, t+30000) 二分查，与原判定 Math.abs(dt) < 30000 完全等价。
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
    const ckRows = [];
    (msgs || []).forEach(m => {
      if (!m) return;
      const t = m.ts || 0;
      if (m.special === 'ask-card' && m.askQuestion && !m.askTs && !m.deskCk) {
        ckRows.push({ ts: t, q: '📋 ' + name + ' 查岗 · ' + esc(m.askQuestion), sub: fmtDT(t),
          line: m.askAnswer ? '✓ 已回答：' + esc(m.askAnswer) : '还没回答（在聊天里点那张卡作答）' });
      } else if (m.special === 'ask-msg' && /查岗/.test(m.text || '')) {
        const nearCard = hasAskCardNear(t); // #588：二分查，不再对全表 some()
        if (!nearCard) ckRows.push({ ts: t, q: '📋 ' + name + ' 查岗', sub: fmtDT(t), line: '' });
      }
    });
    if (!ckRows.length) { el.innerHTML = recEmpty('<div class="ta-empty">暂无查岗记录（TA 按回复设置里的概率与冷却主动来查岗，问你在干嘛/在做什么）</div>'); return; }
    ckRows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    el.innerHTML = window.mochiHistFold(ckRows.map(r => ({ ts: Number(r.ts) || 0, html: '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' + r.q + '</span><span class="tc-li-time">' + r.sub + '</span></div>' + (r.line ? '<div class="tc-li-line">' + (window.taFit ? window.taFit(r.line) : r.line) + '</div>' : '') + '</div>' })), {
      key: 'records-ck', // #1416 那族口径：开合态交给 mochiHistFold 的模块级 map，每张列表一个前缀（不写 key 就全站的月块共用 'hist'，在查岗栏展开「8 月」会顺手掀开别栏）
      todayEmpty: '<div class="dc-h-day-empty">今天没有被查岗</div>'
    });
  }
  // ---- 联系人跨桌面查岗（#1435：其他桌面的 TA 来查岗，按联系人聚合）----
  // 数据源＝各联系人自己桌面 records-care 里 kind==='desk-checkin' 的那几条（写入方
  // incoming-requests.js，一条查岗一次落账）。这一栏是它们唯一的完整账本：
  // 弹窗错过、没点【确认】的那些**不会出现在聊天里**（作者点名的规则），只在这里留一行「错过未回应」。
  // 与关心同款＝汇总视图（源数组别的用途共用、且缺 res 的老记录不该被标成任何结局）→ 只折叠、不给按条删。
  function renderXckPanel() {
    const el = document.getElementById('home-xck');
    if (!el) return;
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const RES = {
      replied: '点了「现在回TA」，卡已在TA桌面的聊天里',
      later: '选了稍后，卡留在TA桌面的聊天里',
      missed: '错过未回应（没点【确认】，聊天里没有这条）'
    };
    const xckRows = [];
    const cur = window.__activeCid || 'default';
    (window.getContacts() || []).forEach(function (c) {
      if (!c) return;
      const cname = c.name || 'TA';
      let care = [];
      try {
        const s = (c.id && window.storeFor) ? window.storeFor(c.id) : store;
        care = JSON.parse(s.get('records-care') || '[]');
      } catch (e) { care = []; }
      if (!Array.isArray(care)) care = [];
      const ckTs = [];
      care.forEach(function (r) {
        if (!r || r.kind !== 'desk-checkin') return;
        const t = Number(r.ts) || 0;
        ckTs.push(t);
        xckRows.push({ ts: t, q: '🏠 ' + esc(cname) + ' · ' + esc(r.text || ''), sub: fmtDT(t), line: RES[r.res] || '' });
      });
      // 老数据兜底：v3.25.x 之前「记录随卡同刻写」这条还没接通，跨桌面卡可能只有聊天里没有账。
      // 只补扫【当前桌面】自己的聊天（别的桌面的大键不在这里啃，避免关心页那次 O(n²) 卡顿复发）。
      if (c.id !== cur) return;
      let msgs = [];
      try { msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]')); } catch (e) {}
      (msgs || []).forEach(function (m) {
        if (!m || !m.deskCk || m.special !== 'ask-card' || !m.askQuestion) return;
        const t = m.ts || 0;
        // 同一次事件：记录与卡同刻写入，90s 窗口内已有记录就不再列一遍（与关心原口径一致）
        if (ckTs.some(ct => Math.abs(ct - t) <= 90000)) return;
        xckRows.push({ ts: t, q: '🏠 ' + esc(cname) + ' · ' + esc(m.askQuestion), sub: fmtDT(t),
          line: m.askAnswer ? '✓ 已回答：' + esc(m.askAnswer) : '' });
      });
    });
    if (!xckRows.length) { el.innerHTML = recEmpty('<div class="ta-empty">暂无跨桌面查岗记录（其他桌面的 TA 会按「跨桌面查岗频率」来查岗；错过没点【确认】的也记在这里，但不进聊天）</div>'); return; }
    xckRows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    el.innerHTML = window.mochiHistFold(xckRows.map(r => ({ ts: Number(r.ts) || 0, html: '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' + r.q + '</span><span class="tc-li-time">' + r.sub + '</span></div>' + (r.line ? '<div class="tc-li-line">' + (window.taFit ? window.taFit(r.line) : r.line) + '</div>' : '') + '</div>' })), {
      key: 'records-xck', // 同上：每张列表一枚前缀，月块开合态互不串
      todayEmpty: '<div class="dc-h-day-empty">今天没有跨桌面查岗</div>'
    });
  }
  // ---- 邀请贴贴记录（#1435）----
  // 读本站自己的数组 records-cuddle（写入方 chat.js 的 sendTaInvite），一条邀请一行，
  // res 随回应就地更新——所以这一栏**给按条删**（和摸鱼抓包同款），且删除键用 ts 而不是下标
  // （#1403 那族事故：unshift 之后按渲染下标删会删错行；ts 在一行里唯一，重画也不怕错位）。
  function renderCuddlePanel() {
    const el = document.getElementById('home-cuddle');
    if (!el) return;
    const name = dispName();
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const RES = { pending: '待回应', replied: '你接受了', declined: '你拒绝了', missed: '错过未回应' };
    const list = cuddleLoad();
    if (!list.length) { el.innerHTML = recEmpty('<div class="ta-empty">暂无贴贴邀请记录（TA 会按回复设置里的概率发起贴贴邀请；弹窗不自动关，切后台回来还在）</div>'); return; }
    // 行先攒成 cuItems 再交折叠尺（刻意不写成 mochiHistFold(list.map(...)) 那一形——
    // 那个片段是摸鱼抓包那栏 #1403r 哨兵的 needle，撞上去会让那条针变成删掉也照绿的哑针）
    const cuItems = list.map((x) => ({ ts: Number(x.ts) || 0, html:
      '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">🫂 ' + esc(name) + ' 邀请贴贴 · ' + esc(x.text || '') + '</span><span class="tc-li-time">' + fmtDT(x.ts) + '</span>' + window.mochiHistDel('t' + x.ts, (name + ' 的贴贴邀请 · ' + (x.text || ''))) + '</div>' +
      '<div class="tc-li-line">' + (RES[x.res] || '待回应') + '</div></div>'
    }));
    el.innerHTML = window.mochiHistFold(cuItems, {
      key: 'records-cuddle', // 同上：这一栏也会因新邀请整栏重画，开合态得活过重画
      empty: recEmpty('<div class="ta-empty">暂无贴贴邀请记录</div>'),
      todayEmpty: '<div class="dc-h-day-empty">今天没有贴贴邀请</div>'
    });
    window.mochiHistDelBind(el, {
      title: '删除这条贴贴邀请记录？',
      onDel: function (k) {
        const ts = Number(String(k).replace(/^t/, ''));
        const arr = cuddleLoad();
        const left = arr.filter(x => x && Number(x.ts) !== ts);
        if (left.length === arr.length) return;
        cuddleSaveFor(window.__activeCid || 'default', left);
        render();
      }
    });
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
    if (!list.length) { el.innerHTML = recEmpty('<div class="ta-empty">暂无红包记录（红包也是心意币，快去发一个试试）</div>'); return; }
    const stMap = { pending: '待领取', received: '已领取', expired: '已过期·退回', returned: '已退回' };
    // #1403：与上面「关心记录」同判据——这一栏是从聊天记录里 filter 出来的汇总，条目＝消息本身，
    // 所以只做「当天直显＋更早按月折叠」，不给按条删除（删一条＝动聊天原文，那条路在聊天页）
    el.innerHTML = window.mochiHistFold(list.slice().reverse().map(m => {
      const out = m.side === 'out';
      const st = stMap[m.rpStatus || 'pending'] || '';
      const amt = Number(m.rpAmount || 0).toFixed(2);
      const sub = (out ? myName + ' 发给 ' + name : name + ' 发给 ' + myName) + ' · ' + (st || '待领取') +
        (m.rpWish ? ' · 「' + esc(m.rpWish) + '」' : '');
      return { ts: Number(m.rpTs || m.ts) || 0, html: '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' + (out ? '🧧 我发红包 ¥' + amt : '🧧 ' + esc(name) + ' 发红包 ¥' + amt) + '</span><span class="tc-li-time">' + fmtDT(m.rpTs || m.ts) + '</span></div>' +
        '<div class="tc-li-line">' + sub + '</div></div>' };
    }), { key: 'records-rp', todayEmpty: '<div class="dc-h-day-empty">今天没有红包往来</div>' });
  }
  // ---- 占卜记录（v3.26.x：占卜页抽牌时选了对象 → 存入该联系人桌面的 records-divine） ----
  // 记录结构 { ts, mode, count, question, cards, summary, target }，写入方在 divination.js
  function renderDivinePanel() {
    const el = document.getElementById('home-divine');
    if (!el) return;
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const list = histList('records-divine');
    if (!list.length) {
      el.innerHTML = recEmpty('<div class="ta-empty">暂无占卜记录（在「占卜」页选择对象抽牌后，牌面与解读自动存入这里）</div>');
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
  // #1403（作者「无限变长的记录还需要有单独的删除功能」＋「每天只显示当天的，其他按月份折叠」）：
  // 每日摸鱼值／打工值这两栏是**本站自己的数组**（fish-day-add / work-day-add，条目身份＝date），
  // 所以能按条删。口径两条：① 只删这一天的**明细行**，绝不动顶部累计（fish-total*/work-total* 是
  // 独立累加键，删一天明细把总额改掉＝用户的钱被凭空抹）；② 也不动当天在跑的 day-fish-* 计数键。
  // 写回走与 personalize 写入侧同一条 store.set（xyStore 内含 LS＋IDB 双写），读侧现读现算，无需缓存失效。
  function dayKeyTs(s) {
    const p = String(s || '').split('-').map(Number);
    return (p.length === 3 && p[0] && p[1] && p[2]) ? new Date(p[0], p[1] - 1, p[2]).getTime() : 0;
  }
  function delDayHist(key, date) {
    let list = [];
    try { list = JSON.parse(store.get(key) || '[]'); } catch (e) { return false; }
    if (!Array.isArray(list)) return false;
    const left = list.filter(function (x) { return x && x.date !== date; });
    if (left.length === list.length) return false;
    store.set(key, JSON.stringify(left));
    return true;
  }
  // 摸鱼/打工同款两栏共用：headHtml＝顶部累计/连击那几行（留在折叠块之上），行内容给 rowFn，
  // 删除按 date 摘那一条，重画交回各自 render
  function dayValList(el, list, key, name, rowFn, afterDel, headHtml) {
    el.innerHTML = (headHtml || '') + window.mochiHistFold(list.map(function (x) {
      return { ts: dayKeyTs(x.date), html: '<div class="tc-listitem">' + rowFn(x) + window.mochiHistDel(x.date, x.date + ' 的' + name) + '</div>' };
    }), {
      key: key,
      empty: recEmpty('<div class="ta-empty">暂无' + name + '记录</div>'),
      todayEmpty: '<div class="dc-h-day-empty">今天暂无' + name + '</div>'
    });
    window.mochiHistDelBind(el, {
      title: '删除这一天的' + name + '记录？',
      onDel: function (date) {
        if (delDayHist(key, date)) { afterDel(); if (typeof window.toast === 'function') window.toast('已删除 ' + date + ' 的' + name + '记录（累计不变）'); }
      }
    });
  }
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
    // #1403：顶部累计/连击留在上面，每日明细交 dayValList（当天直显＋更早按月折＋按条删）
    dayValList(el, h, 'fish-day-add', '摸鱼值', function (x) {
      return '<div class="tc-li-top"><span class="tc-li-q">' + x.date + '</span></div>' +
        '<div class="tc-li-line">' + myName + ' 当天摸鱼：+' + (x.mine || 0) + '</div>' +
        '<div class="tc-li-line">' + name + ' 当天摸鱼：+' + (x.ta || 0) + '</div>';
    }, window.renderFishHistory, totalHtml + comboHtml);
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
    // #1403：与摸鱼值同款（累计在上、明细当天直显＋更早按月折＋按条删，累计键不动）
    dayValList(el, h, 'work-day-add', '打工值', function (x) {
      return '<div class="tc-li-top"><span class="tc-li-q">' + x.date + '</span></div>' +
        '<div class="tc-li-line">' + myName + ' 当天打工：+' + (x.mine || 0) + '</div>' +
        '<div class="tc-li-line">' + name + ' 当天打工：+' + (x.ta || 0) + '</div>';
    }, window.renderWorkHistory, totalHtml);
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
    // #1435：查岗两类与贴贴邀请各成一栏（作者「移出来，各归各 tab」）
    if (showOnly === 'ck') {
      renderCkPanel();
    }
    if (showOnly === 'xck') {
      renderXckPanel();
    }
    if (showOnly === 'cuddle') {
      renderCuddlePanel();
    }
    // 占卜记录（v3.26.x：抽牌选了对象，存该联系人桌面 records-divine）
    if (showOnly === 'divine') {
      renderDivinePanel();
    }
    // #1493：情话存档（quote-history 每天一条的整本列表）
    if (showOnly === 'quotes') {
      renderQuotePanel();
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
          : recEmpty('<div class="ta-empty">暂无换头像记录</div>');
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
          : recEmpty('<div class="ta-empty">暂无通话记录</div>');
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
  // #804：改走 mochiOnDataReady——原 if(!page-home.hidden) 闸门在回填完成时用户不在主页＝永久不刷；
  // 空态分流见 recEmpty（「正在读取…」与「暂无…」不再混说）
  if (window.mochiOnDataReady) window.mochiOnDataReady(render);
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
