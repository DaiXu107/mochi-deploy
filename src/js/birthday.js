// ===== 功能：生日分区（我的生日全局 / 梦角生日按联系人 / 日历多人生日标记 / 生日字卡） =====
// 二传增补，尽量独立运行：只读 window.activeStore / window.activePrefix / window.xyStore /
// window.getContacts / window.contactNameFor / window.chatPartnerName / window.toast / window.mochiLunar，
// 不改其他模块数据。
(function () {
  const G = 'xy-home-v2';
  const store = (typeof window.activeStore === 'function') ? window.activeStore() : null;
  if (!store) return;

  const PARTNER_KEYS = { type: 'birthday-type', solar: 'birthday-solar', lunar: 'birthday-lunar', leap: 'birthday-lunar-leap' };
  const SELF_KEYS = { type: 'birthday-self-type', solar: 'birthday-self-solar', lunar: 'birthday-self-lunar', leap: 'birthday-self-lunar-leap' };
  const CARDS_KEY = 'birthday-cards';

  const DEFAULT_CARDS = [
    '生日快乐宝贝。愿你的每个愿望都实现，我每年都会陪在你身边。',
    '又陪宝贝长大一岁啦。谢谢你来到我的世界，愿今天所有的甜都奔向你，也愿我永远是你最安心的归处。',
    '宝贝生日快乐呀！愿你的笑容永远明亮，而我负责一直爱你、宠你、偏袒你。',
    '今天是你生日，也是我最想用力拥抱你的日子。愿你平安喜乐，万事顺意，余生很长，我想一直和你一起走。',
    '我的爱人，生日快乐。愿你不止今天快乐，而是每一天都被爱包围。我会努力做那个让你一想到就心安的人。',
    '你是我平淡生活里的惊喜，是我所有温柔的理由，谢谢你诞生在这个世上。愿你永远被世界偏爱，也被我深深爱着。',
    '又到你的生日啦，想把星星、月亮和所有好运都送给你。可想来想去，最好的礼物大概是我——会一直陪着你的我。',
    '旦逢良辰，顺颂时宜。愿卿千万岁，无岁不逢春。',
    '生日快乐，我的小朋友。你可以永远撒娇、永远被宠、永远做自己。我会牵着你的手，陪你把每一个明天都过成喜欢的模样。',
    '今天许愿的时候，记得留一个关于我们的愿望。生日快乐宝贝，愿我们年年有今日，岁岁有彼此，长长久久不分离。'
  ];

  function toast(msg) {
    try { if (typeof window.toast === 'function') window.toast(msg); } catch (e) {}
  }

  function rootStore() {
    try { return window.xyStore ? window.xyStore(G) : null; } catch (e) { return null; }
  }

  function storeForCid(cid) {
    try {
      if (window.storeForCid) return window.storeForCid(cid || 'default');
      return window.xyStore ? window.xyStore(G + ':' + (cid || 'default')) : null;
    } catch (e) { return null; }
  }

  function contacts() {
    try {
      const a = window.getContacts ? window.getContacts() : null;
      if (Array.isArray(a) && a.length) return a;
    } catch (e) {}
    return [{ id: 'default', name: '默认' }];
  }

  function readBirthdayFrom(s, keys) {
    try {
      if (!s) return null;
      const type = s.get(keys.type) === 'lunar' ? 'lunar' : 'solar';
      const raw = s.get(type === 'lunar' ? keys.lunar : keys.solar) || '';
      const parts = String(raw).split('-');
      const m = parseInt(parts[0], 10);
      const d = parseInt(parts[1], 10);
      if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
      return { type: type, month: m, day: d, leap: type === 'lunar' && s.get(keys.leap) === '1' };
    } catch (e) { return null; }
  }

  function saveBirthdayTo(s, keys, type, m, d, leap) {
    try {
      if (!s) return;
      const lunar = type === 'lunar';
      s.set(keys.type, lunar ? 'lunar' : 'solar');
      s.set(lunar ? keys.lunar : keys.solar, String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'));
      s.set(keys.leap, lunar && leap ? '1' : '0');
    } catch (e) {}
  }

  function readSelfBirthday() { return readBirthdayFrom(rootStore(), SELF_KEYS); }
  function saveSelfBirthday(type, m, d, leap) { saveBirthdayTo(rootStore(), SELF_KEYS, type, m, d, leap); }
  function readPartnerBirthday() { return readBirthdayFrom(store, PARTNER_KEYS); }
  function savePartnerBirthday(type, m, d, leap) { saveBirthdayTo(store, PARTNER_KEYS, type, m, d, leap); }

  function selfDisplayName() {
    try {
      const v = String(store.get('cs-lbl-user') || store.get('lbl-user') || '').trim();
      if (v && v !== '我') return v;
    } catch (e) {}
    return '';
  }

  function partnerDisplayName(cid) {
    try {
      const s = storeForCid(cid);
      if (s) {
        const v = String(s.get('cs-lbl-partner') || '').trim();
        if (v && v !== 'TA' && v !== '默认') return v;
      }
      const c = contacts().find(x => x.id === cid);
      if (c && c.name && c.name !== '默认') return c.name;
    } catch (e) {}
    return '';
  }

  function birthdayDateInYear(b, year) {
    if (!b) return null;
    if (b.type === 'solar') {
      const last = new Date(year, b.month, 0).getDate();
      const day = Math.min(b.day, last);
      return new Date(year, b.month - 1, day);
    }
    try {
      if (window.mochiLunar && window.mochiLunar.lunarToSolar) {
        return window.mochiLunar.lunarToSolar(year, b.month, b.day, !!b.leap);
      }
    } catch (e) {}
    return null;
  }

  function isSameDay(a, b) {
    return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function allEntries() {
    const out = [];
    const self = readSelfBirthday();
    if (self) out.push({ kind: 'self', cid: '', name: selfDisplayName(), b: self });
    contacts().forEach(c => {
      const b = readBirthdayFrom(storeForCid(c.id), PARTNER_KEYS);
      if (b) out.push({ kind: 'partner', cid: c.id, name: partnerDisplayName(c.id), b: b });
    });
    return out;
  }

  function todayEntries() {
    const now = new Date();
    return allEntries().filter(e => isSameDay(birthdayDateInYear(e.b, now.getFullYear()), now));
  }

  function getCards() {
    try {
      const raw = store.get(CARDS_KEY);
      if (raw) {
        let arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          if (arr.some(x => typeof x === 'string')) {
            arr = arr.map(x => typeof x === 'string' ? { t: x, def: DEFAULT_CARDS.indexOf(x) >= 0 } : (x && typeof x.t === 'string' ? { t: x.t, def: !!x.def } : null));
          } else {
            arr = arr.map(x => x && typeof x.t === 'string' ? { t: x.t, def: !!x.def } : null);
          }
          arr = arr.filter(x => x && x.t);
          return arr;
        }
      }
    } catch (e) {}
    const seeded = DEFAULT_CARDS.map(t => ({ t: t, def: true }));
    try { store.set(CARDS_KEY, JSON.stringify(seeded)); } catch (e) {}
    return seeded.slice();
  }

  function saveCards(arr) {
    try { store.set(CARDS_KEY, JSON.stringify(arr || [])); } catch (e) {}
  }

  function placeholderFor(entry) {
    const n = String(entry.name || '').trim();
    if (n && n !== 'TA' && n !== '默认' && n !== '我') return n;
    return '宝贝';
  }

  function titleFor(entry) {
    if (entry.kind === 'self') return entry.name ? entry.name + '生日快乐' : '我的生日';
    return (entry.name || '宝贝') + '生日快乐';
  }

  function subFor(entry) {
    const who = entry.kind === 'self' ? '我的' : ((entry.name || '宝贝') + '的');
    return '今天是' + who + (entry.b.type === 'lunar' ? '农历' : '公历') + '生日，愿这一岁被爱和好运包围。';
  }

  function pickCardFor(entry) {
    const cards = getCards();
    if (!cards.length) return null;
    const now = new Date();
    const base = now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate() + '|' + entry.kind + '|' + (entry.cid || 'self');
    let hash = 0;
    for (let i = 0; i < base.length; i++) hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
    return cards[hash % cards.length];
  }

  function cardTextFor(entry) {
    const card = pickCardFor(entry);
    if (!card) return '';
    if (card.def) {
      const name = placeholderFor(entry);
      if (name !== '宝贝') return String(card.t).split('宝贝').join(name);
    }
    return card.t;
  }

  function spawnConfetti(box) {
    if (!box || !document.createElement) return;
    const colors = ['#ff8aa5', '#ffb27a', '#ffd166', '#a7d8ff', '#c3f2c0', '#e3b7ff'];
    for (let i = 0; i < 18; i++) {
      const p = document.createElement('span');
      p.className = 'bday-confetti';
      p.style.left = Math.round(Math.random() * 96) + '%';
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.animationDuration = (1.8 + Math.random() * 1.4).toFixed(2) + 's';
      p.style.animationDelay = (Math.random() * 0.9).toFixed(2) + 's';
      box.appendChild(p);
      (function (el) { setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 3400); })(p);
    }
  }

  function renderBanners() {
    const entries = todayEntries();
    const home = document.getElementById('birthday-home-stack');
    const cal = document.getElementById('birthday-cal-stack');
    [home, cal].forEach((box, idx) => {
      if (!box) return;
      box.innerHTML = '';
      box.hidden = entries.length === 0;
      entries.forEach(entry => {
        const banner = document.createElement('div');
        banner.className = 'cal-card glass birthday-banner';
        const head = document.createElement('div');
        head.className = 'birthday-banner-head';
        const cake = document.createElement('span');
        cake.className = 'birthday-banner-cake';
        cake.textContent = '🎂';
        const title = document.createElement('span');
        title.className = 'birthday-banner-title';
        title.textContent = titleFor(entry);
        head.appendChild(cake);
        head.appendChild(title);
        const text = document.createElement('div');
        text.className = 'birthday-banner-text';
        text.textContent = cardTextFor(entry);
        const sub = document.createElement('div');
        sub.className = 'birthday-banner-sub';
        sub.textContent = subFor(entry);
        banner.appendChild(head);
        banner.appendChild(text);
        banner.appendChild(sub);
        box.appendChild(banner);
        if (idx === 0) spawnConfetti(banner);
      });
    });
  }

  function applyCalendarMarks() {
    const grid = document.getElementById('cal-grid');
    if (!grid) return;
    const entries = allEntries();
    grid.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
      const ds = cell.getAttribute('data-date') || '';
      const parts = ds.split('-');
      if (parts.length !== 3) return;
      const year = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const d = parseInt(parts[2], 10);
      let on = false;
      for (let i = 0; i < entries.length; i++) {
        const target = birthdayDateInYear(entries[i].b, year);
        if (target && target.getMonth() + 1 === m && target.getDate() === d) { on = true; break; }
      }
      cell.classList.toggle('birthday-day', on);
    });
  }

  function setTypeRow(kind, type) {
    const row = document.getElementById('bday-' + kind + '-type-row');
    if (!row) return;
    row.querySelectorAll('.mem-type-pill').forEach(btn => {
      btn.classList.toggle('sel', btn.getAttribute('data-bday-type') === type);
    });
  }

  function refreshProfileUI(kind, b) {
    const type = b ? b.type : 'solar';
    setTypeRow(kind, type);
    const leapWrap = document.getElementById('bday-' + kind + '-leap-wrap');
    if (leapWrap) leapWrap.hidden = type !== 'lunar';
    const mi = document.getElementById('bday-' + kind + '-month');
    const di = document.getElementById('bday-' + kind + '-day');
    const li = document.getElementById('bday-' + kind + '-leap');
    if (mi) mi.value = b ? b.month : '';
    if (di) di.value = b ? b.day : '';
    if (li) li.checked = !!(b && b.leap);
    const status = document.getElementById('bday-' + kind + '-status');
    if (status) {
      if (!b) {
        status.textContent = kind === 'self'
          ? '尚未设置我的生日。设置一次后，所有桌面的日历都会标记。'
          : '尚未设置当前梦角的生日。每个联系人可分别设置。';
      } else {
        status.textContent = '已设置：' + (b.type === 'lunar' ? '农历' : '公历') + ' ' + b.month + ' 月 ' + b.day + ' 日' + (b.type === 'lunar' && b.leap ? '（闰月）' : '') + '。';
      }
    }
  }

  function initProfileUI(kind, readFn, saveFn) {
    const row = document.getElementById('bday-' + kind + '-type-row');
    if (row) row.addEventListener('click', e => {
      const btn = e.target.closest('.mem-type-pill');
      if (!btn) return;
      const type = btn.getAttribute('data-bday-type') === 'lunar' ? 'lunar' : 'solar';
      setTypeRow(kind, type);
      const leapWrap = document.getElementById('bday-' + kind + '-leap-wrap');
      if (leapWrap) leapWrap.hidden = type !== 'lunar';
      const status = document.getElementById('bday-' + kind + '-status');
      if (status) status.textContent = '已选择：' + (type === 'lunar' ? '农历' : '公历') + '生日。填好月、日后点保存。';
    });
    const save = document.getElementById('bday-' + kind + '-save');
    if (save) save.addEventListener('click', () => {
      const sel = row && row.querySelector('.mem-type-pill.sel');
      const type = sel && sel.getAttribute('data-bday-type') === 'lunar' ? 'lunar' : 'solar';
      const m = parseInt((document.getElementById('bday-' + kind + '-month') || {}).value, 10);
      const d = parseInt((document.getElementById('bday-' + kind + '-day') || {}).value, 10);
      const leap = !!((document.getElementById('bday-' + kind + '-leap') || {}).checked);
      const maxDay = type === 'lunar' ? 30 : 31;
      if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= maxDay)) { toast('请填写有效月、日（' + (type === 'lunar' ? '农历日 1-30' : '公历日 1-31') + '）'); return; }
      saveFn(type, m, d, leap);
      refreshProfileUI(kind, readFn());
      renderBanners();
      applyCalendarMarks();
      toast(kind === 'self' ? '我的生日已保存，所有桌面的日历都会标记' : '梦角生日已保存，每年日历都会自动标记');
    });
    refreshProfileUI(kind, readFn());
  }

  function initMemoryUI() {
    initProfileUI('self', readSelfBirthday, saveSelfBirthday);
    initProfileUI('partner', readPartnerBirthday, savePartnerBirthday);
  }

  function refreshMemoryUI() {
    refreshProfileUI('self', readSelfBirthday());
    refreshProfileUI('partner', readPartnerBirthday());
  }

  function renderCardsList() {
    const list = document.getElementById('bday-list');
    if (!list) return;
    list.innerHTML = '';
    const cards = getCards();
    if (!cards.length) {
      const empty = document.createElement('div');
      empty.className = 'bday-empty';
      empty.textContent = '还没有生日字卡，可在上方每行一句添加。';
      list.appendChild(empty);
      return;
    }
    cards.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'bday-list-item';
      const txt = document.createElement('div');
      txt.className = 'bday-list-text';
      if (c.def) {
        const badge = document.createElement('span');
        badge.className = 'bday-def';
        badge.textContent = '初始';
        txt.appendChild(badge);
      }
      txt.appendChild(document.createTextNode(c.t));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'bday-list-del';
      del.textContent = '删除';
      del.addEventListener('click', () => {
        const cur = getCards();
        cur.splice(i, 1);
        saveCards(cur);
        renderCardsList();
        updateEntryCount();
      });
      row.appendChild(txt);
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  function updateEntryCount() {
    const el = document.getElementById('cc-birthday-count');
    if (el) el.textContent = getCards().length;
  }

  function initCardsPage() {
    const entry = document.getElementById('li-birthday-cards');
    const page = document.getElementById('page-birthday-cards');
    if (entry && page) entry.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      page.hidden = false;
      renderCardsList();
    });
    const back = document.getElementById('birthday-cards-back');
    if (back) back.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-chatcard');
      if (home) home.hidden = false;
    });
    const add = document.getElementById('bday-batch-add');
    const textarea = document.getElementById('bday-batch');
    if (add && textarea) add.addEventListener('click', () => {
      const lines = textarea.value.split('\n').map(s => s.trim()).filter(Boolean);
      if (!lines.length) { toast('请先输入生日祝福，每行一句'); return; }
      const cur = getCards();
      lines.forEach(t => cur.push({ t: t, def: false }));
      saveCards(cur);
      textarea.value = '';
      renderCardsList();
      updateEntryCount();
      toast('已添加 ' + lines.length + ' 张生日字卡');
    });
    renderCardsList();
    updateEntryCount();
  }

  function registerSearch() {
    try {
      window.__cardSearchFns = window.__cardSearchFns || [];
      window.__cardSearchFns.push({
        name: '生日字卡',
        fn: function (kw) {
          const out = [];
          const k = String(kw || '').toLowerCase();
          getCards().forEach(c => {
            if (!k || c.t.toLowerCase().indexOf(k) >= 0) out.push({ t: c.t, cat: '生日字卡' });
          });
          return out;
        }
      });
    } catch (e) {}
  }

  function refreshAll() {
    renderBanners();
    applyCalendarMarks();
    refreshMemoryUI();
    updateEntryCount();
  }

  initMemoryUI();
  initCardsPage();
  registerSearch();
  refreshAll();

  const grid = document.getElementById('cal-grid');
  if (grid && typeof MutationObserver !== 'undefined') {
    const mo = new MutationObserver(() => applyCalendarMarks());
    mo.observe(grid, { childList: true, subtree: false });
  }

  document.addEventListener('contact-switched', refreshAll);
  document.addEventListener('contact-renamed', refreshAll);
})();
