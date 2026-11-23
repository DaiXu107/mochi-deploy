/* ===== 主页应用合并（src/js/app-merge.js）=====
   把成对的功能收进一个桌面图标，页内用顶部胶囊切换：
   · 记账 ↔ 存钱罐
   · 梦角档案 ↔ 我的档案
   · 心意市集 ↔ 心意柜
   次级图标不删除，只隐藏——各模块的事件监听仍挂在原元素上，胶囊按钮直接 .click()
   沿用各模块自己的打开逻辑（动态页面/异步渲染/返回逻辑都不用改）。
   加载顺序放在所有模块之后（build.mjs jsFiles 末尾）。
*/
(function () {
  'use strict';

  var PAIRS = [
    { key: 'money', primary: 'accounting', secondary: 'piggy', primaryName: '账房', primaryLabel: '记账', secondaryLabel: '存钱罐', primaryPage: 'page-accounting', secondaryPage: 'page-piggy' },
    { key: 'arc', primary: 'memo-arc', secondary: 'my-arc', primaryName: '档案', primaryLabel: '梦角档案', secondaryLabel: '我的档案', primaryPage: 'page-memo-arc', secondaryPage: 'page-my-arc' },
    { key: 'gift', primary: 'market', secondary: 'giftbox', primaryName: '心意', primaryLabel: '心意市集', secondaryLabel: '心意柜', primaryPage: 'page-market', secondaryPage: 'page-giftbox' },
    // 2026-11-22：同频 + 伸手合并成一个功能（作者直派「同频伸手合并为一个功能」）。
    // 同频为主入口（TA 此刻 + 敲三下），伸手作页内胶囊；两页结构都是 .chat-head + .tp/ss-body，
    // 胶囊插在头部下方，与原三组合并体例一致。
    { key: 'sense', primary: 'tongpin', secondary: 'shenshou', primaryName: '在你身边', primaryLabel: '同频', secondaryLabel: '伸手', primaryPage: 'page-tongpin', secondaryPage: 'page-shenshou' }
  ];

  var refs = {};
  var barSeq = 0;

  function findApp(id) { return document.querySelector('.app[data-app="' + id + '"]'); }
  function makeBar(p, activeIndex) {
    var bar = document.createElement('div');
    bar.className = 'app-merge-tabs';
    bar.dataset.merge = p.key;
    bar.setAttribute('role', 'tablist');
    [p.primaryLabel, p.secondaryLabel].forEach(function (label, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.className = i === activeIndex ? 'on' : '';
      b.textContent = label;
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        if (i === activeIndex) return;
        var pairRef = refs[p.key];
        var target = i === 0 ? (pairRef && pairRef.primary) : (pairRef && pairRef.secondary);
        if (!target) target = findApp(i === 0 ? p.primary : p.secondary);
        if (target) target.click();
      });
      bar.appendChild(b);
    });
    bar.id = 'app-merge-tabs-' + p.key + '-' + (++barSeq);
    return bar;
  }

  function ensureBar(p, pageEl, activeIndex) {
    if (!pageEl || !pageEl.querySelector) return;
    if (pageEl.querySelector('.app-merge-tabs[data-merge="' + p.key + '"]')) return;
    var bar = makeBar(p, activeIndex);
    var head = pageEl.querySelector('.chat-head');
    if (head && head.parentNode === pageEl) head.insertAdjacentElement('afterend', bar);
    else pageEl.insertBefore(bar, pageEl.firstChild);
  }

  function run() {
    var pending = false;
    PAIRS.forEach(function (p) {
      var pri = findApp(p.primary);
      var sec = findApp(p.secondary);
      var pp = document.getElementById(p.primaryPage);
      var sp = document.getElementById(p.secondaryPage);
      if (!pri || !sec || !pp || !sp) { pending = true; return; }
      if (!refs[p.key]) refs[p.key] = { primary: pri, secondary: sec };
      // 次级图标隐藏但保留在 DOM：各模块的事件监听/动态页面都还挂在它上面
      if (sec.style.display !== 'none') sec.style.display = 'none';
      sec.dataset.appMerged = '1';
      var nameEl = pri.querySelector('.app-name');
      if (nameEl && nameEl.textContent !== p.primaryName) nameEl.textContent = p.primaryName;
      ensureBar(p, pp, 0);
      ensureBar(p, sp, 1);
    });
    if (pending) setTimeout(run, 350);
  }

  // 各模块的动态页面/图标可能晚于本文件创建：先等一拍，再补几次迟到的重试。
  setTimeout(run, 300);
  setTimeout(run, 1500);
  setTimeout(run, 4000);
  // 手机端回填、切联系人、退出装修后，personalize 会重建/复位桌面图标——
  // 这些时机都重新跑一次，避免次级图标又被露出来。
  ['mochi-restore-done', 'contact-switched', 'decor-exited', 'group-chat-mode-changed'].forEach(function (ev) {
    document.addEventListener(ev, function () { setTimeout(run, 80); });
  });
})();
