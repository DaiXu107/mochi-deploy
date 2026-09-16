// 深色模式审计：注入页面的纯函数（无模块依赖）
// __darkShow(js)：执行开屏动作；__darkAudit()：扫描当前可见 UI 颜色问题；__darkReset()：关闭全部页面/浮层
(function () {
  window.__darkReset = function () {
    try {
      document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
      var sels = ['#tc-mask', '#cc-export-mask', '#cc-scope-mask', '#call-mask', '#feed-notice-panel',
        '#feed-comment-panel', '#poke-card', '#emoji-panel', '#chat-ask-panel', '#qa-mask',
        '#chat-more-panel', '#gc-more-panel', '#chat-search', '#chat-decision-panel',
        '#chat-divine-panel', '#chat-rps-panel', '#chat-call-panel', '#chat-pong-panel',
        '#chat-snake-panel', '#chat-gift-panel', '#avlib-card', '#ck-panel', '#loc-panel',
        '#modal-mask', '#msg-actions', '#desk-image-viewer'];
      sels.forEach(function (s) { var e = document.querySelector(s); if (e) e.hidden = true; });
      var cm = document.getElementById('contact-manager');
      if (cm) { cm.hidden = true; cm.style.display = 'none'; }
      ['#chat-rp-panel', '#batch-panel', '#img-view-mask'].forEach(function (s) {
        var e = document.querySelector(s); if (e) { e.hidden = true; e.style.display = ''; }
      });
      Array.prototype.forEach.call(document.querySelectorAll('.mg-mask'), function (m) { m.hidden = true; });
      Array.prototype.forEach.call(document.querySelectorAll('.period-day-pop'), function (m) { m.remove(); });
      document.body.classList.remove('scroll-lock');
    } catch (e) {}
    return 1;
  };

  window.__darkAudit = function () {
    function parseC(c) {
      if (!c || c.indexOf('rgb') !== 0) return null;
      var a = c.slice(c.indexOf('(') + 1, c.indexOf(')')).split(',').map(parseFloat);
      return { r: a[0], g: a[1], b: a[2], al: a.length > 3 ? a[3] : 1 };
    }
    function lum(c) {
      function f(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    }
    function ratio(a, b) {
      var l1 = lum(a), l2 = lum(b), hi = Math.max(l1, l2), lo = Math.min(l1, l2);
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    }
    function effBg(el) {
      var n = el, layers = [];
      while (n && n.nodeType === 1) {
        var c = parseC(getComputedStyle(n).backgroundColor);
        if (c && c.al > 0.04) { layers.push(c); if (c.al >= 0.95) break; }
        n = n.parentElement;
      }
      var col = { r: 17, g: 17, b: 17, al: 1 };
      for (var i = layers.length - 1; i >= 0; i--) {
        var L = layers[i];
        col = { r: L.r * L.al + col.r * (1 - L.al), g: L.g * L.al + col.g * (1 - L.al), b: L.b * L.al + col.b * (1 - L.al), al: 1 };
      }
      return col;
    }
    function sel(el) {
      var parts = [], n = el, depth = 0;
      while (n && n.nodeType === 1 && depth < 4) {
        if (n.id) { parts.unshift('#' + n.id); break; }
        var s = n.tagName.toLowerCase();
        if (n.classList && n.classList.length) s += '.' + Array.prototype.join.call(n.classList, '.');
        parts.unshift(s);
        depth++; n = n.parentElement;
        if (parts.join('>').length > 90) break;
      }
      return parts.join('>');
    }
    var SKIP = { SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, NOSCRIPT: 1, BR: 1, HEAD: 1, TITLE: 1 };
    var seen = {}, out = [];
    function add(type, el, detail, level) {
      var key = type + '|' + sel(el);
      if (seen[key]) return;
      seen[key] = 1;
      out.push({ type: type, sel: sel(el), level: level, detail: detail });
    }
    var rootEl = document.body;
    var all = rootEl.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var tag = el.tagName;
      if (SKIP[tag]) continue;
      if (tag === 'svg' || el.namespaceURI === 'http://www.w3.org/2000/svg') continue;
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      var rects = el.getClientRects();
      if (!rects.length) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6) continue;
      // ① 白底块（深色模式下可疑的近纯白背景）
      var bg = parseC(cs.backgroundColor);
      if (bg && bg.al > 0.6 && (bg.r + bg.g + bg.b) > 700 && r.width >= 12 && r.height >= 12) {
        add('light-bg', el, cs.backgroundColor, 'high');
      } else if (bg && bg.al > 0.6 && (bg.r + bg.g + bg.b) > 600 && (bg.r + bg.g + bg.b) <= 700 && r.width >= 40 && r.height >= 24) {
        add('grayish-bg', el, cs.backgroundColor, 'mid');
      }
      // ② 低对比文字
      var hasText = false;
      for (var t = 0; t < el.childNodes.length; t++) {
        var nd = el.childNodes[t];
        if (nd.nodeType === 3 && nd.nodeValue && nd.nodeValue.replace(/\s+/g, '').length) { hasText = true; break; }
      }
      if (hasText) {
        var fg = parseC(cs.color);
        if (fg && fg.al > 0.25) {
          var eb = effBg(el);
          var cr = ratio(fg, eb);
          if (cr < 2.6) add('low-contrast', el, 'fg=' + cs.color + ' bg=rgb(' + Math.round(eb.r) + ',' + Math.round(eb.g) + ',' + Math.round(eb.b) + ') ratio=' + cr, cr < 1.8 ? 'high' : 'mid');
        }
      }
    }
    return out.slice(0, 120);
  };

  window.__darkVisibleInfo = function () {
    var v = [];
    document.querySelectorAll('.page').forEach(function (p) { if (!p.hidden) v.push(p.id); });
    var floats = [];
    ['#tc-mask', '#call-mask', '#feed-notice-panel', '#feed-comment-panel', '#poke-card', '#emoji-panel',
     '#chat-ask-panel', '#qa-mask', '#chat-more-panel', '#gc-more-panel', '#chat-search',
     '#chat-decision-panel', '#chat-divine-panel', '#chat-rps-panel', '#chat-call-panel',
     '#chat-pong-panel', '#chat-snake-panel', '#chat-gift-panel', '#avlib-card', '#ck-panel',
     '#loc-panel', '#modal-mask', '#msg-actions'].forEach(function (s) {
      var e = document.querySelector(s);
      if (e && !e.hidden) floats.push(s);
    });
    var mg = document.querySelector('.mg-mask:not([hidden])');
    if (mg) floats.push('.mg-mask');
    return v.join(',') + (floats.length ? ' +' + floats.join(',') : '');
  };
  return 1;
})()
