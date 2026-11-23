/* ===== 主页样式：小手机 / 微信式（2026-11-22）=====
   作者定稿：
   · 切换入口放「设置 → 外观（界面风格旁边）」；
   · 微信式只换**主页外壳**：聊天页不动；底部导航＝聊天 / 字卡 / 设置；
   · 每个联系人＝一个会话；长按会话可置顶；记录不进会话（在聊天「更多功能 → 互动 → 记录」）；
   · 两种模式共用同一份数据，切换零迁移；小手机模式的桌面排布原样保留。
*/
(function () {
  'use strict';
  var G = 'xy-home-v2';
  var KEY = 'home-style';      // 'phone' | 'wechat'（全局根键，设备级）
  var PIN_KEY = 'wx-pinned';   // 置顶顺序：['cid', ...]（全局根键）

  function root() { try { return window.xyStore ? window.xyStore(G) : null; } catch (e) { return null; } }
  function rget(k) { try { var r = root(); return r ? r.get(k) : localStorage.getItem(G + ':' + k); } catch (e) { return null; } }
  function rset(k, v) { try { var r = root(); if (r) r.set(k, String(v)); else localStorage.setItem(G + ':' + k, String(v)); } catch (e) {} }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toast(t) { try { if (window.toast) window.toast(t); } catch (e) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function style() {
    try { var v = rget(KEY); return v === 'wechat' ? 'wechat' : 'phone'; } catch (e) { return 'phone'; }
  }
  function isWx() { return style() === 'wechat'; }

  function pins() {
    try { var a = JSON.parse(rget(PIN_KEY) || '[]'); return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string'; }) : []; } catch (e) { return []; }
  }
  function setPins(a) { try { rset(PIN_KEY, JSON.stringify(a.slice(0, 50))); } catch (e) {} }

  // ---------- 会话数据 ----------
  function deskStore(cid) {
    try { return window.storeForCid ? window.storeForCid(cid) : (window.storeFor ? window.storeFor(cid) : null); } catch (e) { return null; }
  }
  function cleanPreview(t, rec) {
    var txt = String(t || '');
    // 通话/系统消息存的是 HTML（内联 <svg> 图标 + 文案），预览里必须先把标记剥掉，
    // 否则列表上会出现「一串代码」（用户实报：来电未接听预览是一堆 svg path）。
    txt = txt.replace(/<svg[\s\S]*?<\/svg>/gi, '')
             .replace(/<[^>]*>/g, '')
             .replace(/&nbsp;/gi, ' ')
             .replace(/&amp;/gi, '&')
             .replace(/&lt;/gi, '<')
             .replace(/&gt;/gi, '>')
             .replace(/&quot;/gi, '"')
             .replace(/@@m:[0-9a-f]{32}/g, '[图片]')
             .replace(/\|\|\|/g, ' ')
             .replace(/\{ta\}/gi, '')
             .replace(/\{me\}/gi, '')
             .replace(/\s+/g, ' ')
             .trim();
    if (!txt) {
      if (rec && (rec.type === 'image' || rec.img)) return '[图片]';
      if (rec && rec.type === 'sticker') return '[表情包]';
      if (rec && rec.type === 'voice') return '[语音]';
      if (rec && rec.special === 'read') return '[已读]';
      if (rec && rec.special === 'redpacket') return '[红包]';
      if (rec && rec.special === 'poke') return '[消息]';
      return '';
    }
    return txt.slice(0, 60);
  }
  function lastOf(cid) {
    var s = deskStore(cid);
    var out = { text: '', ts: 0, unread: 0 };
    if (!s) return out;
    try { out.unread = parseInt(s.get('chat-unread'), 10) || 0; } catch (e) {}
    // 1) 尾巴日志（轻量，最近 60 条）
    var tail = null;
    try { tail = JSON.parse(s.get('chat-tail') || '[]'); } catch (e) { tail = null; }
    if (Array.isArray(tail) && tail.length) {
      for (var i = tail.length - 1; i >= 0; i--) {
        var t = tail[i];
        if (!t) continue;
        var txt = cleanPreview(t.text, t);
        if (txt) { out.text = txt; out.ts = Number(t.ts) || 0; break; }
      }
    }
    // 2) 聊天整包快照（只读 LS/内存里的字符串；太大就跳过，避免为了首页整包解析几十 MB）
    try {
      var raw = s.get('chat-msgs');
      if (raw && raw.length && raw.length < 400000) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) {
          for (var j = arr.length - 1; j >= 0; j--) {
            var m = arr[j];
            if (!m) continue;
            var tx = cleanPreview(m.text, m);
            var ts = Number(m.ts) || 0;
            if (!tx) continue;
            if (ts >= out.ts) { out.text = tx; out.ts = ts; }
            break;
          }
          if (!out.ts && arr.length) out.ts = Number(arr[arr.length - 1].ts) || 0;
        }
      }
    } catch (e) {}
    // 3) 两者都没有 → 用联系人名兜底提示
    if (!out.text) out.text = '';
    return out;
  }
  function whenText(ts) {
    if (!ts) return '';
    var d = new Date(ts), now = new Date();
    var same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    if (same) return pad(d.getHours()) + ':' + pad(d.getMinutes());
    var y = new Date(now.getTime() - 864e5);
    if (d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate()) return '昨天';
    if (d.getFullYear() !== now.getFullYear()) return (d.getMonth() + 1) + '/' + d.getDate();
    return (d.getMonth() + 1) + '/' + d.getDate();
  }
  function contacts() { try { return (window.getContacts && window.getContacts()) || []; } catch (e) { return []; } }

  // ---------- 渲染 ----------
  function render(q) {
    var list = document.getElementById('wx-list');
    if (!list) return;
    if (typeof q !== 'string') { try { q = String((document.getElementById('wx-q') || {}).value || ''); } catch (e) { q = ''; } }
    q = q.trim().toLowerCase();
    var cs = contacts();
    var pin = pins();
    var rows = cs.map(function (c) {
      var info = lastOf(c.id);
      var nm = String(c.name || c.id || '联系人');
      var pi = pin.indexOf(c.id);
      return { cid: c.id, name: nm, info: info, pinIdx: pi };
    }).filter(function (r) { return r; });
    if (q) rows = rows.filter(function (r) { return (r.name + ' ' + r.info.text).toLowerCase().indexOf(q) >= 0; });
    rows.sort(function (a, b) {
      var pa = a.pinIdx < 0 ? 999 : a.pinIdx, pb = b.pinIdx < 0 ? 999 : b.pinIdx;
      if (pa !== pb) return pa - pb;
      return (b.info.ts || 0) - (a.info.ts || 0);
    });
    if (!rows.length) {
      list.innerHTML = q
        ? '<div class="wx-empty">没有匹配的联系人<br><span style="font-size:11px">换个关键词试试</span></div>'
        : '<div class="wx-empty">还没有联系人<br>点右上角 ＋ 新建一个桌面</div>';
      return;
    }
    var h = '';
    rows.forEach(function (r) {
      var initial = esc(r.name.slice(0, 1));
      var av = '';
      try {
        var s = deskStore(r.cid);
        var img = s && s.get('cs-avatar-partner');
        if (img) av = '<img src="' + esc(img) + '" alt="">';
      } catch (e) {}
      h += '<div class="wx-conv" data-cid="' + esc(r.cid) + '">' +
        '<div class="wx-av">' + (av || initial) + '</div>' +
        '<div class="wx-cv">' +
          '<div class="wx-nm">' + esc(r.name) + (r.pinIdx >= 0 ? '<span class="wx-pin">置顶</span>' : '') + '</div>' +
          '<div class="wx-pv">' + (r.info.text ? esc(r.info.text) : '还没有聊天') + '</div>' +
        '</div>' +
        '<div class="wx-cm">' +
          '<div class="wx-tm">' + esc(whenText(r.info.ts)) + '</div>' +
          (r.info.unread ? '<div class="wx-badge">' + (r.info.unread > 99 ? '99+' : r.info.unread) + '</div>' : '') +
        '</div>' +
        '</div>';
    });
    list.innerHTML = h;
    bindRow();
  }

  // ---------- 长按 / 点击 ----------
  var holdT = 0, held = null, moved = false, suppressClickUntil = 0;
  function clearHold() { if (holdT) { clearTimeout(holdT); holdT = 0; } held = null; moved = false; }
  function bindRow() {
    document.querySelectorAll('#wx-list .wx-conv').forEach(function (el) {
      var cid = el.getAttribute('data-cid');
      el.addEventListener('pointerdown', function (ev) {
        if (ev.pointerType === 'mouse' && ev.button !== 0) return;
        moved = false; held = el;
        var x0 = ev.clientX, y0 = ev.clientY;
        var mv = function (e2) { if (Math.abs(e2.clientX - x0) > 8 || Math.abs(e2.clientY - y0) > 8) moved = true; };
        var up = function () {
          window.removeEventListener('pointermove', mv);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
          if (holdT) { clearTimeout(holdT); holdT = 0; }
          if (!moved && held === el) openChat(cid);
          held = null;
        };
        window.addEventListener('pointermove', mv, { passive: true });
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        clearTimeout(holdT);
        holdT = setTimeout(function () {
          holdT = 0;
          if (moved) return;
          suppressClickUntil = Date.now() + 900; // 长按弹层后别把抬手当点击
          try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
          openSheet(cid, el);
        }, 480);
      });
      // 兜底：部分内核 pointerup 不落在同一元素上时，用原生 click 打开（长按后 900ms 内不触发）
      el.addEventListener('click', function () {
        if (Date.now() < suppressClickUntil) return;
        openChat(cid);
      });
    });
  }
  function openChat(cid) {
    try {
      if (cid !== (window.__activeCid || 'default') && window.setActiveContact) window.setActiveContact(cid);
      var chat = document.querySelector('.app[data-app="chat"]');
      if (chat) chat.click();
    } catch (e) {}
  }
  function closeSheet() {
    var m = document.getElementById('wx-mask'); if (m) m.remove();
    var s = document.getElementById('wx-sheet'); if (s) s.remove();
  }
  function openSheet(cid, el) {
    closeSheet();
    var c = contacts().filter(function (x) { return x.id === cid; })[0] || { id: cid, name: cid };
    var pin = pins();
    var pinned = pin.indexOf(cid) >= 0;
    var info = lastOf(cid);
    var host = document.querySelector('.phone') || document.body;
    var mask = document.createElement('div');
    mask.className = 'wx-mask'; mask.id = 'wx-mask';
    mask.addEventListener('click', closeSheet);
    var sh = document.createElement('div');
    sh.className = 'wx-sheet'; sh.id = 'wx-sheet';
    sh.innerHTML =
      '<div class="wx-sheet-ttl">' + esc(c.name || cid) + '</div>' +
      '<div class="wx-sheet-hd"><div class="wx-av">' + esc(String(c.name || '?').slice(0, 1)) + '</div>' +
        '<div><div class="nm">' + esc(c.name || cid) + '</div>' +
        '<div class="sub">' + (info.unread ? info.unread + ' 条未读 · ' : '') + (info.ts ? '最近 ' + whenText(info.ts) : '还没有聊天') + '</div></div></div>' +
      '<div class="wx-act" data-op="pin"><span class="ic">' + (pinned ? '↓' : '↑') + '</span>' + (pinned ? '取消置顶' : '置顶到最上面') + '</div>' +
      (info.unread ? '<div class="wx-act" data-op="read"><span class="ic">✓</span>标记已读</div>' : '') +
      '<div class="wx-cancel" data-op="cancel">取消</div>';
    sh.addEventListener('click', function (e) {
      var act = e.target.closest('.wx-act, .wx-cancel');
      if (!act) return;
      var op = act.getAttribute('data-op');
      if (op === 'pin') {
        var p = pins().filter(function (x) { return x !== cid; });
        if (!pinned) p.unshift(cid);
        setPins(p);
        toast(pinned ? '已取消置顶' : '已置顶「' + (c.name || cid) + '」');
        render();
      } else if (op === 'read') {
        try { var s = deskStore(cid); if (s) s.set('chat-unread', '0'); } catch (e) {}
        render();
      }
      closeSheet();
    });
    host.appendChild(mask); host.appendChild(sh);
  }

  // ---------- 模式切换 ----------
  function showWxHome() {
    var pg = document.getElementById('page-wxhome');
    if (!pg) return;
    render();
    document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
    pg.hidden = false;
    var ph = document.getElementById('page-phone');
    if (ph) ph.hidden = true;
    syncTabs('chat');
    syncWxBar();
  }
  function syncTabs(which) {
    document.querySelectorAll('#tabbar-wx .wx-tb').forEach(function (t) {
      t.classList.toggle('on', !!which && t.getAttribute('data-wx') === which);
    });
  }
  // 微信式底部导航：在三个「一级页」显示（会话列表 / 字卡 / 设置），
  // 其余全屏页（聊天、字卡子页、设置子页、游戏）一律收起；只切 class，不写内联样式。
  var WX_TAB_PAGES = { 'page-wxhome': 'chat', 'page-chatcard': 'cards', 'page-setting': 'settings' };
  function visiblePageId() {
    try {
      var pages = document.querySelectorAll('.page');
      for (var i = 0; i < pages.length; i++) if (!pages[i].hidden) return pages[i].id;
    } catch (e) {}
    return '';
  }
  function syncWxBar() {
    var bar = document.getElementById('tabbar-wx');
    if (!bar) return;
    var tab = WX_TAB_PAGES[visiblePageId()] || '';
    bar.classList.toggle('on', isWx() && !!tab);
    syncTabs(tab);
  }
  window.__wxSyncBar = syncWxBar;

  // 模式不变量：微信式时 page-phone 永不可见；小手机时 page-wxhome 永不可见。
  // 这一条把「各功能页自己的返回键写死回 page-phone」全部兜住，不用逐个模块改。
  function enforceHomeInvariant() {
    try {
      var wx = isWx();
      var phone = document.getElementById('page-phone');
      var wxp = document.getElementById('page-wxhome');
      if (!phone || !wxp) return;
      if (wx && !phone.hidden) {
        phone.hidden = true;
        wxp.hidden = false;
        syncWxBar();
      } else if (!wx && !wxp.hidden) {
        wxp.hidden = true;
        phone.hidden = false;
        syncWxBar();
      }
    } catch (e) {}
  }
  window.__wxEnforce = enforceHomeInvariant;

  function apply() {
    var wx = isWx();
    document.body.classList.toggle('home-wx', wx);
    syncWxBar();
    enforceHomeInvariant();
    var oldBar = document.querySelector('.phone > .tabbar') || document.querySelector('.tabbar');
    if (oldBar) oldBar.style.display = wx ? 'none' : '';
    if (wx) {
      var phone = document.getElementById('page-phone');
      if (phone && !phone.hidden) showWxHome();
      else if (!document.querySelector('.page:not([hidden])')) showWxHome();
    } else {
      var wxPage = document.getElementById('page-wxhome');
      if (wxPage && !wxPage.hidden) {
        wxPage.hidden = true;
        var phone2 = document.getElementById('page-phone');
        if (phone2) phone2.hidden = false;
      }
      syncTabs('');
    }
    // 值回显
    var v = document.getElementById('home-style-val');
    if (v) v.textContent = wx ? '微信式' : '小手机';
    var v2 = document.getElementById('sh-home-style-val');
    if (v2) v2.textContent = wx ? '微信式' : '小手机';
    try { document.dispatchEvent(new CustomEvent('mochi-home-style-changed', { detail: { style: wx ? 'wechat' : 'phone' } })); } catch (e) {}
  }
  function setStyle(s) {
    var nx = s === 'wechat' ? 'wechat' : 'phone';
    rset(KEY, nx);
    apply();
    if (nx === 'wechat') showWxHome();
    else enforceHomeInvariant();
    toast(nx === 'wechat' ? '主页已切换为「微信式」' : '主页已切换为「小手机」');
  }
  window.mochiSetHomeStyle = setStyle;
  window.mochiHomeStyle = function () { return isWx() ? 'wechat' : 'phone'; };
  window.mochiOpenHomeStylePicker = function () {
    if (!window.openModal) return false;
    window.openModal('主页样式', '', function (v) {
      if (v) setStyle(v);
    }, {
      noInput: true, pillSubmit: true, pill: window.mochiHomeStyle(),
      staticText: '微信式：会话列表，不用装修桌面；聊天页本身不变。小手机：原来的图标桌面，桌面排布会保留。',
      pills: [
        { label: '小手机（图标桌面）', value: 'phone' },
        { label: '微信式（会话列表）', value: 'wechat' }
      ]
    });
    return true;
  };

  // ---------- 接线 ----------
  function bind() {
    // 微信式 tabbar
    document.querySelectorAll('#tabbar-wx .wx-tb').forEach(function (t) {
      t.addEventListener('click', function () {
        var k = t.getAttribute('data-wx');
        if (k === 'chat') { showWxHome(); return; }
        var pageId = k === 'cards' ? 'page-chatcard' : 'page-setting';
        var pg = document.getElementById(pageId);
        if (!pg) return;
        document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
        pg.hidden = false;
        syncTabs(k);
        syncWxBar();
      });
    });
    // ＋：新建联系人
    var add = document.getElementById('wx-add');
    if (add) add.addEventListener('click', function () {
      if (window.openContactManager) { try { window.openContactManager(); return; } catch (e) {} }
      var mgr = document.getElementById('contact-manager');
      if (mgr) { mgr.hidden = false; return; }
      toast('联系人面板还没加载完，稍后再试');
    });
    // 搜索框实时过滤
    var qEl = document.getElementById('wx-q');
    if (qEl) qEl.addEventListener('input', function () { render(qEl.value); });
    // 设置行（经典设置）
    var row = document.getElementById('row-home-style');
    if (row) row.addEventListener('click', function () { window.mochiOpenHomeStylePicker(); });
    // 设置行（设置中心）
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest && e.target.closest('[data-act="home-style"]');
      if (!el) return;
      window.mochiOpenHomeStylePicker();
    });
    // 模式内在别处切页（如从设置点“返回”）→ 回微信式主页
    document.addEventListener('mochi-home-style-changed', function () {
      var v = document.getElementById('home-style-val'); if (v) v.textContent = isWx() ? '微信式' : '小手机';
    });
    // 任何页面切换都会改 .page[hidden]：据此自动收/放微信式导航
    try {
      var obs = new MutationObserver(function () { enforceHomeInvariant(); syncWxBar(); });
      document.querySelectorAll('.page').forEach(function (p) { obs.observe(p, { attributes: true, attributeFilter: ['hidden'] }); });
    } catch (e) {}
    document.addEventListener('contact-switched', function () {
      if (!isWx()) return;
      var pg = document.getElementById('page-wxhome');
      if (pg && !pg.hidden) render();
    });
    document.addEventListener('mochi-restore-done', function () {
      if (!isWx()) return;
      var pg = document.getElementById('page-wxhome');
      if (pg && !pg.hidden) render();
    });
  }

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { bind(); apply(); }, { once: true });
    else { bind(); apply(); }
    setTimeout(apply, 600);
    setTimeout(function () { if (isWx()) { var pg = document.getElementById('page-wxhome'); if (pg && !pg.hidden) render(); } }, 1800);
  } catch (e) {}

  // 供无头/诊断只读回读
  window.__wxHome = { style: window.mochiHomeStyle, set: setStyle, render: render, open: showWxHome, pins: pins };
})();
