// ===== #549 功能：新手引导（首次使用 3 步上手 + 设置可重看）=====
// 需求（用户 2026-09-16「网站太复杂，怎么优化让用户看懂和使用」）：新手最大困惑是
// 「TA 为什么不说话」——其实是没有添加字卡。这里给全新用户一次性 3 步引导：
// ① 设置「我」「TA」 ② 添加字卡 ③ 开始聊天；每步可一键跳到对应位置。
// 触发：数据就绪(__mochiDataReady) + 开屏关闭 + 无其它弹层 后自动弹一次；标记键 xy-home-v2:__guide-done
//（已列入 contacts.js 全局系统键白名单，不随联系人迁移；pwa.js 的 hasData 判定不受影响）。
// 不打扰老用户：只在「全新环境」（除内部标记外无任何 xy-home-v2: 业务键）才自动弹；
// 老用户要重看走 设置 → 关于 → 帮助与支持 → 新手引导（行由本文件注入）。
// 自包含：样式与 DOM 全部本文件创建，不改 template.html / 全局 CSS；跳转一律点既有入口，
// 不重复实现任何打开逻辑。
(function () {
  const G = 'xy-home-v2:';
  const MARK = G + '__guide-done';
  // 内部标记键（不算「业务数据」，全新环境判定时跳过）
  const SYS = [MARK, G + '__onboard-done', G + '__edge-backup-hint-done', G + '__last-backup', G + '__last-backup-remind', G + '__auto-backup-snapshot'];

  function isFreshEnv() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(G) !== 0) continue;
        if (SYS.indexOf(k) >= 0) continue;
        return false; // 有任何业务数据键 → 老环境
      }
      return true;
    } catch (e) { return false; }
  }
  function splashGone() {
    const s = document.getElementById('splash');
    return !s || !s.isConnected || s.classList.contains('hide');
  }
  function modalOpen() {
    try {
      const m = document.getElementById('modal-mask');
      if (m && !m.hidden) return true;
      const qa = document.getElementById('qa-mask');
      if (qa && !qa.hidden) return true;
    } catch (e) {}
    return false;
  }
  function markDone() { try { localStorage.setItem(MARK, String(Date.now())); } catch (e) {} }

  // ---- 样式（自包含注入；配色走全局变量，深色自动跟随） ----
  const st = document.createElement('style');
  st.textContent =
    '.mg-guide-mask{position:fixed;inset:0;z-index:96;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:18px;-webkit-tap-highlight-color:transparent}' +
    '.mg-guide-mask[hidden]{display:none}' +
    '.mg-guide{width:min(340px,100%);max-height:82vh;overflow-y:auto;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:18px;padding:18px 16px 16px;box-shadow:0 14px 40px rgba(0,0,0,.3)}' +
    '.mg-guide-t{font-size:16px;font-weight:800;text-align:center;margin-bottom:3px}' +
    '.mg-guide-sub{font-size:12px;color:var(--muted,#888);text-align:center;margin-bottom:14px}' +
    '.mg-guide-step{display:flex;gap:10px;align-items:flex-start;padding:11px 12px;border-radius:12px;background:rgba(0,0,0,.04);margin-bottom:9px;cursor:pointer}' +
    '.mg-guide-step:active{transform:scale(.98)}' +
    '.mg-guide-n{flex:0 0 auto;width:22px;height:22px;border-radius:50%;background:var(--ink,#111);color:var(--card-bg,#fff);font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;margin-top:1px}' +
    '.mg-guide-b{flex:1;min-width:0;display:block}' +
    '.mg-guide-h{display:block;font-size:13.5px;font-weight:700;margin-bottom:2px}' +
    '.mg-guide-d{display:block;font-size:12px;line-height:1.6;color:var(--muted,#777)}' +
    '.mg-guide-go{flex:0 0 auto;font-size:12px;font-weight:700;color:#2f6fd0;align-self:center}' +
    '.mg-guide-foot{display:flex;gap:9px;margin-top:12px}' +
    '.mg-guide-btn{flex:1;text-align:center;padding:11px;border-radius:11px;font-size:13px;font-weight:700;cursor:pointer}' +
    '.mg-guide-btn.primary{background:var(--ink,#111);color:var(--card-bg,#fff)}' +
    '.mg-guide-btn.ghost{background:rgba(0,0,0,.06);color:var(--ink,#111)}' +
    '[data-theme="dark"] .mg-guide-step{background:rgba(255,255,255,.07)}' +
    '[data-theme="dark"] .mg-guide-btn.ghost{background:rgba(255,255,255,.1)}' +
    '[data-theme="dark"] .mg-guide-go{color:#8fb4ef}' +
    // #577：步骤内的补充提示块——warn 暖色（说明/警告，如两套昵称）、tip 蓝色（另一条更快的操作路径）
    '.mg-guide-warn{display:block;margin-top:6px;padding:6px 8px;border-radius:8px;background:rgba(214,132,60,.13);color:#9a5520;font-size:11.5px;line-height:1.6}' +
    '[data-theme="dark"] .mg-guide-warn{background:rgba(214,132,60,.18);color:#e4ae7f}' +
    // #577b（用户 2026-09-16 追加：「聊天里的更换头像，你没说可以直接在聊天设置里更换，或……头像互动上传头像库」）
    '.mg-guide-tip{display:block;margin-top:6px;padding:6px 8px;border-radius:8px;background:rgba(47,111,208,.1);color:#2f6fd0;font-size:11.5px;line-height:1.6}' +
    '[data-theme="dark"] .mg-guide-tip{background:rgba(47,111,208,.16);color:#8fb4ef}';
  document.head.appendChild(st);

  const STEPS = [
    // #577（用户 2026-09-16：引导里没说明「桌面的昵称和聊天里的昵称是独立的，需单独设置」）：
    // 桌面昵称= lbl-user/lbl-partner，聊天昵称= cs-lbl-user/cs-lbl-partner，v3.26.x 起聊天与桌面
    // 彻底解耦（chat.js chatLabel 传 null 不回退桌面键），未设聊天昵称时聊天里固定显示默认「我」「TA」
    // ——所以只教「点桌面顶部改名」会让用户以为聊天里的名字也会跟着变，必须写明是两套、在哪单独设。
    { n: '1', h: '设置「我」和「TA」', d: '回桌面，点顶部两个头像 / 昵称，即可改名、换头像（这里是桌面那一套）。',
      warn: '桌面的昵称 / 头像与聊天里的是<b>两套、互不同步</b>：桌面改完，聊天里仍显示默认「我」「TA」；聊天里的名字和头像要在「聊天页右上角 → 聊天设置 → 形象」里单独设置。',
      // #577b：#577 只写了「聊天设置 → 形象」一条换聊天头像的路，漏了聊天页内的「头像互动」
      // 半框（模板 #more-avatar / avatar-lib.js，可上传多张头像库、点图即换、定时随机换）——
      // 两条路写的是同一套聊天域键 cs-avatar-*，桌面头像都不受影响。
      // 2026-09-16：该半框并入昵称池后改名「头像和昵称互动」（同一个入口，上排切头像/昵称），
      // 聊天昵称也一并写进这条快路——「聊天设置 → 形象」仍是另一条单条改名路径。
      tip: '聊天头像和聊天昵称另有一条快路：聊天输入栏左边的「更多功能」（⋯）→ 互动类 → <b>头像和昵称互动</b>——头像可上传多张头像库、点库里的图即换；昵称可存多个文字昵称、点名字即换；两边都能开「TA 随机更换 / TA 主动给我换」（每 1-8 小时一次）。',
      go: 'name' },
    { n: '2', h: '先添加字卡', d: '底部「字卡库」→ 公用字卡 / 专属字卡 添加或导入；不加字卡，TA 就没有话可说。', go: 'cards' },
    { n: '3', h: '开始聊天', d: '回桌面点「聊天」图标，随便发一条消息试试（TA 会按概率回复）。', go: 'chat' }
  ];

  let mask = null, built = false;
  function build() {
    if (built) return;
    built = true;
    mask = document.createElement('div');
    mask.className = 'mg-guide-mask';
    mask.hidden = true;
    const box = document.createElement('div');
    box.className = 'mg-guide';
    let html = '<div class="mg-guide-t">新手上路 · 3 步就能用</div><div class="mg-guide-sub">点任意一步可直接跳到对应位置</div>';
    STEPS.forEach(function (s) {
      html += '<div class="mg-guide-step" data-gstep="' + s.go + '">'
        + '<span class="mg-guide-n">' + s.n + '</span>'
        + '<span class="mg-guide-b"><span class="mg-guide-h">' + s.h + '</span><span class="mg-guide-d">' + s.d + '</span>'
        + (s.warn ? '<span class="mg-guide-warn">' + s.warn + '</span>' : '')
        + (s.tip ? '<span class="mg-guide-tip">' + s.tip + '</span>' : '')
        + '</span>'
        + '<span class="mg-guide-go">去 →</span></div>';
    });
    html += '<div class="mg-guide-foot"><div class="mg-guide-btn primary" data-gact="done">知道了，开始用</div><div class="mg-guide-btn ghost" data-gact="close">以后再说</div></div>';
    box.innerHTML = html;
    mask.appendChild(box);
    document.body.appendChild(mask);
    box.addEventListener('click', function (e) {
      const t = e.target;
      const step = t && t.closest ? t.closest('[data-gstep]') : null;
      if (step) { const g = step.getAttribute('data-gstep'); close(); goStep(g); return; }
      const act = t && t.closest ? t.closest('[data-gact]') : null;
      if (act) close();
    });
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
  }
  function close() { if (mask) mask.hidden = true; markDone(); }

  // ---- 跳转：全部点既有入口，不重复实现任何打开逻辑 ----
  function goStep(go) {
    try {
      const phone = document.querySelector('.tab[data-page="page-phone"]');
      if (go === 'name') { if (phone) phone.click(); return; }
      if (go === 'chat') {
        if (phone) phone.click();
        const c = document.querySelector('.app[data-app="chat"]');
        if (c) c.click();
        return;
      }
      if (go === 'cards') {
        const tab = document.querySelector('.tab[data-page="page-chatcard"]');
        if (tab) tab.click();
        const li = document.getElementById('li-custom-cards-public') || document.getElementById('li-custom-cards');
        if (li) li.click();
        return;
      }
    } catch (e) {}
  }

  window.openMochiGuide = function () { build(); mask.hidden = false; };

  // ---- 自动弹一次（仅全新环境；等数据就绪 + 开屏关闭 + 无其它弹层） ----
  let shown = false;
  const poll = setInterval(function () {
    if (shown) { clearInterval(poll); return; }
    if (!window.__mochiDataReady || !splashGone()) return;
    if (modalOpen()) return; // 等 pwa.js 的「全新环境·导入备份」弹窗先关闭
    shown = true; clearInterval(poll);
    setTimeout(function () {
      try { if (localStorage.getItem(MARK)) return; } catch (e) {}
      if (!isFreshEnv()) return; // 老用户不打扰
      window.openMochiGuide();
    }, 400);
  }, 300);

  // ---- 设置 → 关于 → 帮助与支持 → 新手引导（重看入口；行 DOM 本文件注入，不改 template.html） ----
  // #606（2026-09-16）：新手引导与「使用说明」同属了解应用类，优先挂进含 #row-guide 的
  // 「帮助与支持」分组；该组缺失时退回关于段独立成组，再退回工具段（兼容旧结构）。
  (function injectSettingRow() {
    const about = document.querySelector('#page-setting .them-sec[data-sec="about"]');
    const guideRow = document.getElementById('row-guide');
    const helpGroup = (guideRow && guideRow.closest) ? guideRow.closest('.set-group') : null;
    const host = helpGroup || about || document.querySelector('#page-setting .them-sec[data-sec="tools"]');
    if (!host) return;
    const row = document.createElement('div');
    row.className = 'set-row';
    row.id = 'row-guidebook';
    row.innerHTML = '<div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.7-1.5 1.2-1.5 2.2"/><circle cx="12" cy="17" r=".6" fill="#111111"/></svg></div>'
      + '<div class="txt">新手引导<span class="sub">3 步上手：设置昵称头像（桌面 / 聊天分开设）/ 添加字卡 / 开始聊天</span></div>'
      + '<div class="arrow"><svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></div>';
    // 挂到「使用说明」之后、其说明副文案(#guide-sub)之前，避免两行被提示条隔开
    const guideSub = document.getElementById('guide-sub');
    if (helpGroup && guideSub && guideSub.parentNode === host) host.insertBefore(row, guideSub);
    else host.appendChild(row);
    row.addEventListener('click', function () { window.openMochiGuide(); });
  })();
})();
