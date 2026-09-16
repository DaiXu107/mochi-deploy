// ===== 【TA的心情】字卡库（AI-A 业务域） =====
// 定位：梦角在正常聊天过程中，有概率主动告诉你自己现在的心情/状态/今天的一点感受。
// 与普通聊天字卡一致：回复后小概率额外追加一条主动分享（addIn + initiative + 来源 tag），
// 不接情绪/心意/意图链（那是情绪字卡的三级链路，定位不同）。
// 触发规则（对齐用户设计文档「十九~二十一」）：
//   - 低概率主动库：每次正常回复后有 tm-prob% 概率触发（默认 15%）
//   - 总冷却：触发后至少间隔 N 条正常聊天才能再触发（tm-cd-left，默认 3 条）
//   - 同类冷却：最近触发过的分组（tm-history，最近 3 个）不重复抽取
//   - 分组权重：按用户文档「二十三」核心比例（平静/今日近况/不太想说 40%、
//     开心/轻松/满足 20%、疲惫/困倦/烦躁/低落 20%、想你/想陪你 15%、突然的感觉/小期待/情绪变化 5%）
// 所有 tm-* 键按桌面（联系人命名空间）独立保存，切换联系人冷却/历史互不影响。
(function () {
  const ls = window.activeStore();
  const DATA = window.TA_MOOD_DATA || { groups: [], cards: [] };

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

  // ---- 开关 ----
  function enabled() {
    const v = ls.get('tm-enabled');
    return v === null ? true : v === '1';
  }
  function isCardOff(g, c) { return ls.get('tm-off-' + g + ':' + c) === '1'; }
  function setCardOff(g, c, off) { ls.set('tm-off-' + g + ':' + c, off ? '1' : '0'); }

  // ---- 冷却/历史（按桌面 store，天然隔离）----
  function getProb() {
    const v = ls.get('tm-prob');
    return v === null || v === '' ? 15 : Math.max(0, Math.min(100, Number(v) || 0));
  }
  function getCd() {
    const v = ls.get('tm-cd-left');
    return v === null || v === '' ? 0 : Math.max(0, Number(v) || 0);
  }
  function getHistory() {
    try {
      const v = JSON.parse(ls.get('tm-history') || '[]');
      return Array.isArray(v) ? v.slice(-3) : [];
    } catch (e) { return []; }
  }

  // ---- 抽取（供 chat.js 调用；触发成功返回 {content, group}，否则 null）----
  window.tryTaMoodShare = function () {
    // #499 需求变更（推翻 #365 #319 对本链的锁闸）：TA 的心情分享不再受二级密码锁定
    //   影响——未解锁也照常抽取（与情绪字卡、聊天回应字卡同为豁免互动链）
    if (!enabled()) return null;
    // 总冷却：触发后至少间隔若干条正常聊天；冷却中每次调用递减
    let cd = getCd();
    if (cd > 0) {
      cd--;
      ls.set('tm-cd-left', String(cd));
      return null;
    }
    if (Math.random() * 100 >= (window.dcpEff ? window.dcpEff(getProb()) : getProb())) return null; // #518 套总档（显示读点保持存盘值不动）
    // 单卡开关过滤——关闭的字卡不参与抽取，整组关完则跳过该组
    const groups = (DATA.groups || []).filter(g => {
      return (DATA.cards || []).some(c => c.group === g.group && !isCardOff(g.group, c.content));
    });
    if (!groups.length) return null;
    // 同类冷却：最近触发过的分组短时间不重复（全部都在冷却中则忽略限制）
    const history = getHistory();
    let pool = groups;
    const cooled = groups.filter(g => history.indexOf(g.group) < 0);
    if (cooled.length) pool = cooled;
    // 按分组权重加权选组
    const total = pool.reduce((a, g) => a + Math.max(0, g.weight || 1), 0);
    if (total <= 0) return null;
    let roll = Math.random() * total;
    let sel = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) {
      roll -= Math.max(0, pool[i].weight || 1);
      if (roll < 0) { sel = pool[i]; break; }
    }
    const cards = (DATA.cards || []).filter(c => c.group === sel.group && !isCardOff(sel.group, c.content));
    if (!cards.length) return null;
    const card = cards[Math.floor(Math.random() * cards.length)];
    // 落状态：总冷却 3 条 + 同类历史（最近 3 个分组）
    ls.set('tm-cd-left', '3');
    const hist = history.concat(sel.group).slice(-3);
    ls.set('tm-history', JSON.stringify(hist));
    return { content: card.content, group: sel.group };
  };
  // 供页面统计/展示与测试
  window.taMoodApi = {
    enabled: enabled,
    prob: getProb,
    cdLeft: getCd,
    history: getHistory,
    isCardOff: isCardOff
  };

  // ================= 字卡库页面 =================
  const list = document.getElementById('tm-list');
  const enabledEl = document.getElementById('tm-enabled');
  if (!list || !enabledEl) return;
  enabledEl.checked = enabled();
  enabledEl.addEventListener('change', () => {
    ls.set('tm-enabled', enabledEl.checked ? '1' : '0');
    toast(enabledEl.checked ? '已开启：TA 会偶尔分享自己的心情' : '已关闭：TA 不再主动分享心情');
  });
  // 分享概率 stepper（与全站 stepper 交互一致）
  const probRow = document.getElementById('tm-prob-val');
  if (probRow) {
    const stepEl = probRow.closest('.stepper');
    probRow.value = String(getProb());
    if (stepEl) {
      const min = Number(stepEl.dataset.min) || 5;
      const max = Number(stepEl.dataset.max) || 30;
      const stp = Number(stepEl.dataset.step) || 5;
      stepEl.querySelector('.stp-min').addEventListener('click', () => {
        const v = Math.max(min, getProb() - stp);
        ls.set('tm-prob', String(v));
        probRow.value = String(v);
        toast('TA 的心情分享概率：' + v + '%');
      });
      stepEl.querySelector('.stp-max').addEventListener('click', () => {
        const v = Math.min(max, getProb() + stp);
        ls.set('tm-prob', String(v));
        probRow.value = String(v);
        toast('TA 的心情分享概率：' + v + '%');
      });
    }
  }

  let tmGroup = '';
  let tmQ = '';
  function renderTMBar() {
    const bar = document.getElementById('tm-groups-bar');
    if (!bar) return;
    bar.innerHTML = '';
    const chips = [['', '全部']].concat((DATA.groups || []).map(g => [g.group, g.group]));
    chips.forEach(([val, label]) => {
      const cEl = document.createElement('span');
      cEl.className = 'cc-g-chip' + (tmGroup === val ? ' sel' : '');
      cEl.textContent = label;
      cEl.addEventListener('click', () => { tmGroup = val; renderTMBar(); renderTM(); });
      bar.appendChild(cEl);
    });
  }
  function renderTM() {
    const groups = DATA.groups || [];
    let shown = groups;
    if (tmGroup) shown = shown.filter(g => g.group === tmGroup);
    const wMap = {};
    (DATA.cards || []).forEach(c => { wMap[c.group] = (wMap[c.group] || []).concat(c); });
    const flat = [];
    shown.forEach(g => {
      const arr = (wMap[g.group] || []).filter(c => !tmQ || c.content.indexOf(tmQ) >= 0);
      // 搜索时：卡片命中或分组名命中则保留该组（与情绪字卡页语义一致）
      if (!arr.length && !(tmQ && g.group.indexOf(tmQ) >= 0)) return;
      flat.push({ header: true, gname: g.group, weight: g.weight, count: arr.length });
      arr.forEach(c => flat.push({ card: c }));
    });
    list.innerHTML = '';
    if (!flat.length) { list.innerHTML = '<div class="cc-empty">暂无心情字卡</div>'; return; }
    const frag = document.createDocumentFragment();
    flat.forEach(it => {
      if (it.header) {
        const h = document.createElement('div');
        h.className = 'cc-group-header';
        h.innerHTML = '<span class="ccg-name">' + it.gname + '</span><span class="ccg-count">' + it.count + '</span>' +
          '<span class="ccg-count" style="background:rgba(0,0,0,.03)">权重 ' + it.weight + '</span>';
        frag.appendChild(h);
        return;
      }
      const c = it.card;
      const off = isCardOff(c.group, c.content);
      const d = document.createElement('div');
      d.className = 'cc-item glass' + (off ? ' off' : '');
      d.innerHTML = '<div class="cc-txt"><div class="t">' + c.content + ' <span class="tc-known">系统</span></div></div>' +
        '<label class="toggle ccard-toggle"><input type="checkbox"' + (off ? '' : ' checked') + '><span class="tk"></span></label>';
      frag.appendChild(d);
      d.querySelector('input').addEventListener('change', () => {
        const nowOff = !d.querySelector('input').checked;
        setCardOff(c.group, c.content, nowOff);
        d.classList.toggle('off', nowOff);
        toastCard(c.content, nowOff);
      });
    });
    list.appendChild(frag);
  }
  renderTMBar();
  renderTM();
  const searchInput = document.getElementById('tm-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      tmQ = searchInput.value.trim();
      renderTM();
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { searchInput.value = ''; tmQ = ''; renderTM(); searchInput.blur(); }
    });
  }
  const li = document.getElementById('li-ta-mood');
  if (li) {
    li.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const page = document.getElementById('page-ta-mood');
      if (page) page.hidden = false;
    });
  }
  const back = document.getElementById('tm-back');
  if (back) {
    back.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-chatcard');
      if (home) home.hidden = false;
    });
  }
  // v3.26.x(#122)：注册「TA的心情」跨分类搜索（字卡库列表页搜索同源可查，235 张系统预设不再搜不到；已关卡片带 ·已关 标记）
  window.__cardSearchFns = window.__cardSearchFns || [];
  window.__cardSearchFns.push({ name: 'TA的心情', fn: function (kw) {
    const out = [];
    try {
      (DATA.cards || []).forEach(function (c) {
        const txt = c && c.content ? c.content : '';
        if (txt && txt.toLowerCase().indexOf(kw) >= 0) out.push({ t: txt, cat: (c.group || '') + (isCardOff(c.group, txt) ? '·已关' : '') });
      });
    } catch (e) {}
    return out;
  } });
})();
