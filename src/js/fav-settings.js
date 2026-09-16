// ===== 功能：收藏设置（联系人自动收藏概率 + 收藏统计） =====
// 收藏夹右上角入口 → page-fav-settings
// 暴露 window.favCfg() 给 chat.js / mail.js / feed.js 读取 TA 自动收藏概率
// 存储键：fav-ta-msg / fav-ta-card / fav-ta-mail / fav-ta-feed（前缀由 activeStore 包装）
// 多桌面下各联系人独立（activeStore 动态绑定当前桌面）
(function () {
  const ls = window.activeStore();

  const DEFAULTS = {
    'ta-msg': 30,   // TA 收藏我发的聊天消息概率
    'ta-card': 30,  // TA 收藏互动卡片概率
    'ta-mail': 30,  // TA 收藏我的回信概率
    'ta-feed': 30   // TA 收藏我的朋友圈动态概率
  };

  function readNum(k) {
    const v = ls.get('fav-' + k);
    let n = (v === null || v === undefined || v === '') ? DEFAULTS[k] : Number(v);
    if (isNaN(n)) { n = DEFAULTS[k]; try { ls.set('fav-' + k, String(n)); } catch (e) {} }
    return n;
  }

  function getCfg() {
    return {
      taMsg: readNum('ta-msg'),
      taCard: readNum('ta-card'),
      taMail: readNum('ta-mail'),
      taFeed: readNum('ta-feed')
    };
  }
  window.favCfg = getCfg;
  window.saveFavCfg = function (k, v) { ls.set('fav-' + k, String(v)); };

  // ---- 设置页 UI ----
  function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const el = document.getElementById(id);
    if (el) el.hidden = false;
  }

  function syncUI() {
    const cfg = getCfg();
    document.querySelectorAll('#page-fav-settings .stepper').forEach(st => {
      const k = st.dataset.k;
      const val = st.querySelector('input.stp-val');
      if (val) {

        // 映射连字符键 → 驼峰：ta-msg → taMsg
        const camel = k.replace(/-(.)/g, (_, c) => c.toUpperCase());
        const num = cfg[camel] !== undefined ? cfg[camel] : DEFAULTS[k];
        const str = String(num);
        val.value = str;
        val.setAttribute('value', str);
      }
    });
  }

  // 统计渲染：读取 fav-msgs 计算各类收藏数 + TA 收藏占比
  function renderStats() {
    const box = document.getElementById('fav-stats-body');
    if (!box) return;
    let fav = [];
    try { fav = JSON.parse(ls.get('fav-msgs') || '[]'); } catch (e) { fav = []; }
    if (!Array.isArray(fav)) fav = [];
    const total = fav.length;
    const mine = fav.filter(f => f.by !== 'ta').length;
    const ta = fav.filter(f => f.by === 'ta').length;
    const kinds = ['msg', 'card', 'mail', 'feed'];
    const kindLabel = { msg: '聊天消息', card: '互动卡片', mail: '信件', feed: '朋友圈' };
    const kindCount = {};
    const taKindCount = {};
    kinds.forEach(k => { kindCount[k] = 0; taKindCount[k] = 0; });
    fav.forEach(f => {
      const k = f.kind || 'msg';
      if (kindCount[k] !== undefined) kindCount[k]++;
      if (f.by === 'ta' && taKindCount[k] !== undefined) taKindCount[k]++;
    });
    const pct = (a, b) => (b <= 0 ? 0 : Math.round(a / b * 100));
    const row = (label, val, sub) => '<div class="fs-stat-row"><span class="fs-stat-label">' + label + '</span><span class="fs-stat-val">' + val + (sub ? '<em>' + sub + '</em>' : '') + '</span></div>';
    let html = '';
    html += '<div class="fs-stat-head">收藏总览</div>';
    html += row('总收藏', total, '条');
    html += row('我的收藏', mine, pct(mine, total) + '%');
    html += row('联系人收藏', ta, pct(ta, total) + '%');
    html += '<div class="fs-stat-head">分类统计（联系人 / 总数）</div>';
    kinds.forEach(k => {
      html += row(kindLabel[k], taKindCount[k] + ' / ' + kindCount[k], pct(taKindCount[k], kindCount[k]) + '% 来自联系人');
    });
    box.innerHTML = html;
  }

  // stepper 交互（参考 reply-settings.js，范围 0-100，步长 5）
  document.querySelectorAll('#page-fav-settings .stepper').forEach(st => {
    const k = st.dataset.k;
    const min = 0, max = 100, step = 5;
    const val = st.querySelector('.stp-val');
    const fmt = (v) => String(Math.round(v));
    st.querySelector('.stp-min').addEventListener('click', () => {
      const cur = parseFloat(val.value);
      const nv = Math.max(min, cur - step);
      val.value = fmt(nv); window.saveFavCfg(k, val.value);
    });
    st.querySelector('.stp-max').addEventListener('click', () => {
      const cur = parseFloat(val.value);
      const nv = Math.min(max, cur + step);
      val.value = fmt(nv); window.saveFavCfg(k, val.value);
    });
    val.removeAttribute('readonly');
    val.setAttribute('inputmode', 'decimal');
    const selectAll = () => {
      try {
        const box = val.__ceBox;
        if (box) {
          const r = document.createRange();
          r.selectNodeContents(box);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        } else { val.select(); }
      } catch (e) {}
    };
    val.addEventListener('click', function () {
      try { val.focus(); } catch (e) {}
      selectAll();
    });
    const commit = () => {
      let v = parseFloat(val.value);
      if (!isFinite(v)) v = min;
      v = Math.min(max, Math.max(min, v));
      v = Math.round(v);
      val.value = fmt(v);
      window.saveFavCfg(k, val.value);
    };
    val.addEventListener('change', commit);
    val.addEventListener('blur', commit);
    val.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        try { val.blur(); } catch (err) {}
      }
    });
  });

  // 收藏夹右上角设置按钮 → 打开设置页
  const favSettingsBtn = document.getElementById('fav-settings-btn');
  if (favSettingsBtn) {
    favSettingsBtn.addEventListener('click', () => {
      syncUI();
      renderStats();
      showPage('page-fav-settings');
    });
  }
  // 返回收藏夹
  const favSettingsBack = document.getElementById('fav-settings-back');
  if (favSettingsBack) {
    favSettingsBack.addEventListener('click', () => {
      showPage('page-fav');
      // 返回时刷新收藏列表（概率调整不影响已有收藏，但保持一致体验）
      try { if (window.renderFav) window.renderFav(); } catch (e) {}
    });
  }

  // IDB 恢复完成后若设置页已开则重新同步
  try {
    document.addEventListener('mochi-restore-done', () => {
      const page = document.getElementById('page-fav-settings');
      if (page && !page.hidden) { syncUI(); renderStats(); }
    });
  } catch (e) {}

  syncUI();
})();