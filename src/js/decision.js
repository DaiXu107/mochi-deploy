// ===== 功能：帮我决定（仿星言简约版【帮我决定】完整版） =====
// 类型A：是/否/半对 随机决定；类型B：自定义选项随机决定
// 思考时间倒计时、最多选几个（可多选）、决定结果、历史记录
// 结果可发送到聊天（联系人回复样式）
// 功能参考：小红书@FelixFelicis（9416318007）
(function () {
  let uid; try { uid = window.activePrefix(); } catch (e) { uid = null; } // 历史遗留声明（未使用）；v3.27.x#421b：顶层对 window 的急切调用加容错——原写法若加载瞬间全局未就绪，第一句即抛错、整文件报废、openDecision 永不绑定（用户报「帮我决定加载失败」跨机型反复出现）
  // v3.27.x #421b：入口顶置早绑定——本模块若中途任一 init 抛错（构建期 try/catch 会吞掉），
  // 原设计在文件末 openPanel 定义后才绑 window.openDecision，结局＝按钮整块消失（加载失败）。
  // 现改为顶部先挂一个可用的分派器，真实实现定义后由 359 行回填引用；任何情况下入口都在。
  let decisionPanelRef = null;
  window.openDecision = function () {
    return decisionPanelRef ? decisionPanelRef.apply(window, arguments)
      : (toast('帮我决定加载失败'), false);
  };
  // v3.14.x：数据/历史改全局共享——store 走根命名空间 xy-home-v2，所有桌面互通一份，
  // 不再随联系人隔离（同 period/表情包/存钱罐的全局键先例）；昵称展示仍按当前桌面动态读
  const store = window.xyStore('xy-home-v2');
  const HISTORY_KEY = 'decision-history';
  const SETTINGS_KEY = 'decision-settings';
  const MIGRATE_KEY = 'dec-global-migrated';

  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
  }
  // v3.9.x：帮我决定从聊天页进入（聊天域）——优先读聊天专用昵称，未设置回退桌面昵称
  function partnerName() { try { const s = window.activeStore(); return s.get('cs-lbl-partner') || s.get('lbl-partner') || 'TA'; } catch (e) { return 'TA'; } }
  function fmtDT(ts) {
    const d = new Date(ts);
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  // v3.6.x：恢复窗口保护——IDB 权威恢复完成前不落盘，防止用空数组覆盖
  // IndexedDB 里的全部历史（历史超 200KB 只存 IDB，恢复完成前 store.get 读到
  // 空数组，直接写会丢历史）。暂存待写，恢复完成后与 IDB 合并去重再写入。
  let histReady = false;
  let histPending = null;
  // v3.6.x：历史数据损坏（非数组）时返回空数组，避免 unshift/map 抛错中断
  function loadHistory() { try { const v = JSON.parse(store.get(HISTORY_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function saveHistory(h) {
    if (!histReady) {
      try { histPending = Array.isArray(h) ? h.slice() : []; } catch (e) {}
      return;
    }
    store.set(HISTORY_KEY, JSON.stringify(h));
  }
  function flushPendingHist() {
    if (!histPending) return;
    const pending = histPending;
    histPending = null;
    if (!pending.length) return;
    const finish = (base) => {
      try { store.set(HISTORY_KEY, JSON.stringify(base)); } catch (e) {}
      try { renderHistory(); } catch (e) {}
    };
    const merge = (base) => {
      const have = {};
      base.forEach(x => { if (x && x.ts !== undefined) have[x.ts] = true; });
      pending.forEach(x => { if (x && x.ts !== undefined && !have[x.ts]) { base.push(x); have[x.ts] = true; } });
      finish(base);
    };
    if (window.idbGet) {
      window.idbGet('xy-home-v2:' + HISTORY_KEY).then(v => {
        let base = [];
        try { const p = typeof v === 'string' ? JSON.parse(v) : v; if (Array.isArray(p)) base = p; } catch (e) {}
        // 迁移刚写完根键时 idbSet 可能尚未落库，idbGet 或读到旧值——
        // 并入当前 LS 值兜底（按 ts 去重，只增不丢），防止合并结果被冲掉
        loadHistory().forEach(x => {
          if (x && x.ts !== undefined && !base.some(b => b && b.ts === x.ts)) base.push(x);
        });
        merge(base);
      }).catch(() => merge(loadHistory()));
    } else {
      merge(loadHistory());
    }
  }
  // v3.14.x：存量迁移——升级前历史/设置散在各桌面命名空间（xy-home-v2:<cid>:decision-*），
  // 改全局共享后一次性收编进根键（打 MIGRATE_KEY 标记，幂等）：
  // 历史按 ts 去重合并（LS + IDB 双源扫描——超 200KB 大键只存 IDB，也要捞回），
  // 设置优先级 根 > default 桌面 > 任一桌面第一份；完成后删除旧命名空间副本防残留。
  function readJsonLs(lsKey) {
    try { const v = localStorage.getItem(lsKey); const p = v == null ? null : JSON.parse(v); return p && typeof p === 'object' ? p : null; } catch (e) { return null; }
  }
  function migrateGlobalData() {
    try {
      if (store.get(MIGRATE_KEY)) return Promise.resolve();
      const HIST_RE = /^xy-home-v2:[^:]+:decision-history$/;
      const SET_RE = /^xy-home-v2:[^:]+:decision-settings$/;
      const histArrs = [], setCands = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || k === 'xy-home-v2:' + HISTORY_KEY || k === 'xy-home-v2:' + SETTINGS_KEY) continue;
          if (HIST_RE.test(k)) { const v = readJsonLs(k); if (Array.isArray(v)) histArrs.push({ key: k, arr: v }); }
          else if (SET_RE.test(k)) { const v = readJsonLs(k); if (v && !Array.isArray(v)) setCands.push({ key: k, val: v }); }
        }
      } catch (e) {}
      let scan = Promise.resolve();
      if (window.idbGetAllKeys && window.idbGet) {
        scan = window.idbGetAllKeys().then(function (keys) {
          const want = (keys || []).filter(function (k) { return typeof k === 'string' && k !== 'xy-home-v2:' + HISTORY_KEY && k !== 'xy-home-v2:' + SETTINGS_KEY && (HIST_RE.test(k) || SET_RE.test(k)); });
          return want.reduce(function (p, k) {
            return p.then(function () {
              return Promise.resolve(window.idbGet(k)).then(function (v) {
                let parsed = null;
                try { parsed = typeof v === 'string' ? JSON.parse(v) : v; } catch (e) {}
                if (!parsed) return;
                if (HIST_RE.test(k) && Array.isArray(parsed)) histArrs.push({ key: k, arr: parsed });
                else if (SET_RE.test(k) && typeof parsed === 'object') setCands.push({ key: k, val: parsed });
              }).catch(function () {});
            });
          }, Promise.resolve());
        }).catch(function () {});
      }
      return scan.then(function () {
        const merged = {};
        loadHistory().forEach(x => { if (x && x.ts !== undefined) merged[x.ts] = x; });
        histArrs.forEach(h => h.arr.forEach(x => { if (x && x.ts !== undefined && !merged[x.ts]) merged[x.ts] = x; }));
        const out = Object.keys(merged).map(k => merged[k]);
        out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
        if (out.length) store.set(HISTORY_KEY, JSON.stringify(out.slice(0, 1000)));
        if (readJsonLs('xy-home-v2:' + SETTINGS_KEY) === null) {
          setCands.sort(function (a, b) {
            return (a.key.indexOf(':default:') >= 0 ? 0 : 1) - (b.key.indexOf(':default:') >= 0 ? 0 : 1);
          });
          if (setCands[0]) store.set(SETTINGS_KEY, JSON.stringify(setCands[0].val));
        }
        histArrs.concat(setCands.map(s => ({ key: s.key }))).forEach(h => {
          try { localStorage.removeItem(h.key); } catch (e) {}
          try { if (window.idbDelete) window.idbDelete(h.key); } catch (e) {}
        });
        store.set(MIGRATE_KEY, '1');
      });
    } catch (e) { return Promise.resolve(); }
  }
  try {
    document.addEventListener('mochi-restore-done', function () {
      // 先把存量各桌面旧数据合并进全局根键，完成前不放开写保护（防止半路写覆盖）
      Promise.resolve(migrateGlobalData()).catch(function () {}).then(function () {
        histReady = true;
        flushPendingHist();
      });
    });
  } catch (e) {}
  // v3.6.x：多桌面——切换联系人后重置历史权威状态（防止旧桌面的 histPending 串入新桌面）
  document.addEventListener('contact-switched', function () {
    try { histReady = true; histPending = null; } catch (e) {}
    // v3.7.x：清掉挂起的决定定时器——否则切到 B 后回调执行，A 的决定历史/聊天结果写到 B
    try { if (decideTimer) { clearTimeout(decideTimer); decideTimer = null; } } catch (e) {}
    try { if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } } catch (e) {}
  });
  // v3.6.x：思考时间 / 最多选几个 也持久化——之前每次打开面板都重置回默认值
  // （关掉面板再打开，「帮我决定时间」又得重新设置）
  function loadSettings() {
    const d = { replyToChat: true, thinkA: 3, thinkB: 3, maxB: 1 };
    try { return Object.assign(d, JSON.parse(store.get(SETTINGS_KEY) || '{}')); } catch (e) { return d; }
  }
  function saveSettings(s) { store.set(SETTINGS_KEY, JSON.stringify(s)); }
  // v3.6.x：完整 HTML 转义（只转 < 可被 `&lt;…&gt;` 实体绕过注入）
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  let activeTab = 'typea';
  let countdownTimer = null;
  let decideTimer = null; // v3.6.x：结果 setTimeout 句柄——防连点导致历史/聊天消息重复
  let panelFromGroup = false; // v3.26.x：本面板是否从群聊页打开（是→结果发到群聊，否→发到聊天）

  // ---- 聊天页底部半框（v3.5.53 露出聊天消息，星言式）----
  const panel = document.getElementById('chat-decision-panel');
  const body = document.getElementById('chat-decision-body');
  // v3.6.x：面板 DOM 只构建一次（不再每次打开都 innerHTML 重建），
  // 打开时仅恢复设置 + 切回默认 tab——避免反复重建导致的闪烁/焦点丢失
  function ensureBuilt() {
    if (!body || body.dataset.built) return;
    body.innerHTML = panelHtml();
    bindEvents();
    body.dataset.built = '1';
  }
  function openPanel() {
    if (!body || !panel) return;
    // v3.26.x：记录打开上下文——群聊页可见=从群聊打开，结果发到群聊（gcSendDecisionText）
    try { panelFromGroup = !!(window.gcIsVisible && window.gcIsVisible()); } catch (e) { panelFromGroup = false; }
    ensureBuilt();
    activeTab = 'typea';
    document.querySelectorAll('#chat-decision-body .dc-tab').forEach(tb => tb.classList.toggle('sel', tb.dataset.dtab === 'typea'));
    document.querySelectorAll('#chat-decision-body .dc-panel').forEach(p => { p.hidden = p.dataset.dpanel !== 'typea'; });
    applySettings();
    panel.hidden = false;
  }
  function closePanel() {
    if (panel) panel.hidden = true;
  }
  function panelHtml() {
    return '' +
      '<div class="dc-tabs"><button class="dc-tab sel" data-dtab="typea">是/否/半对</button>' +
      '<button class="dc-tab" data-dtab="typeb">自定义选项</button>' +
      '<button class="dc-tab" data-dtab="history">历史记录</button></div>' +
      '<div class="dc-panel" data-dpanel="typea">' +
      '<div class="sm-fld"><label>输入你的纠结</label><div class="dec-inp-wrap"><textarea class="tc-input" id="dec-q-a" rows="3" placeholder="例如：我今晚该吃火锅吗？"></textarea><button class="dec-inp-clear" data-clear="dec-q-a" aria-label="清空" title="清空">✕</button></div></div>' +
      '<div class="gs-row"><span>思考时间（秒）</span><div class="stepper" id="dec-think-a" data-min="1" data-max="10" data-step="1"><button class="stp-min">−</button><input class="stp-val" id="dec-think-a-val" readonly><button class="stp-max">+</button></div></div>' +
      '<button class="ta-add-btn" style="width:100%;margin-top:10px" id="dec-go-a">让对方决定</button>' +
      '<div class="dc-result" id="dec-result-a" hidden></div></div>' +
      '<div class="dc-panel" data-dpanel="typeb" hidden>' +
      '<div class="sm-fld"><label>输入你的纠结</label><div class="dec-inp-wrap"><textarea class="tc-input" id="dec-q-b" rows="2" placeholder="例如：我今晚该吃什么？"></textarea><button class="dec-inp-clear" data-clear="dec-q-b" aria-label="清空" title="清空">✕</button></div></div>' +
      '<div class="sm-fld"><label>输入选项（每行一个）</label><div class="dec-inp-wrap"><textarea class="tc-input" id="dec-opts" rows="4" placeholder="吃火锅&#10;吃烧烤&#10;吃日料"></textarea><button class="dec-inp-clear" data-clear="dec-opts" aria-label="清空" title="清空">✕</button></div></div>' +
      '<div class="gs-row"><span>思考时间（秒）</span><div class="stepper" id="dec-think-b" data-min="1" data-max="10" data-step="1"><button class="stp-min">−</button><input class="stp-val" id="dec-think-b-val" readonly><button class="stp-max">+</button></div></div>' +
      '<div class="gs-row"><span>最多选几个</span><div class="stepper" id="dec-max-b" data-min="1" data-max="5" data-step="1"><button class="stp-min">−</button><input class="stp-val" id="dec-max-b-val" readonly><button class="stp-max">+</button></div></div>' +
      '<button class="ta-add-btn" style="width:100%;margin-top:10px" id="dec-go-b">让对方决定</button>' +
      '<div class="dc-result" id="dec-result-b" hidden></div></div>' +
      '<div class="dc-panel" data-dpanel="history" hidden>' +
      '<div class="sm-set-row"><span>结果发送到聊天</span><label class="toggle"><input type="checkbox" id="dec-reply-chat"><span class="tk"></span></label></div>' +
      '<div id="dec-history"></div></div>' +
      '<div class="dc-credit">帮我决定功能参考：小红书@FelixFelicis（9416318007）</div>';
  }
  // 恢复设置：思考时间 / 最多选几个 / 结果发送到聊天
  function applySettings() {
    const s = loadSettings();
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = String(v); };
    setVal('dec-think-a-val', s.thinkA);
    setVal('dec-think-b-val', s.thinkB);
    setVal('dec-max-b-val', s.maxB);
    const rc = document.getElementById('dec-reply-chat');
    if (rc) rc.checked = !!s.replyToChat;
  }
  function bindEvents() {
    const scope = '#chat-decision-body';
    // tab 切换
    document.querySelectorAll(scope + ' .dc-tab').forEach(tb => {
      tb.addEventListener('click', () => {
        activeTab = tb.dataset.dtab;
        document.querySelectorAll(scope + ' .dc-tab').forEach(x => x.classList.toggle('sel', x === tb));
        document.querySelectorAll(scope + ' .dc-panel').forEach(p => { p.hidden = p.dataset.dpanel !== activeTab; });
        if (activeTab === 'history') renderHistory();
      });
    });
    // 思考时间 / 最多选几个 stepper（点击即持久化，关掉面板再打开不重置）
    const sMap = { 'dec-think-a': 'thinkA', 'dec-think-b': 'thinkB', 'dec-max-b': 'maxB' };
    Object.keys(sMap).forEach(id => {
      const st = document.getElementById(id);
      if (!st) return;
      const val = st.querySelector('.stp-val');
      const min = parseInt(st.dataset.min, 10), max = parseInt(st.dataset.max, 10);
      const save = (v) => { const s = loadSettings(); s[sMap[id]] = v; saveSettings(s); };
      st.querySelector('.stp-min').addEventListener('click', () => {
        const nv = Math.max(min, parseInt(val.value, 10) - 1);
        val.value = nv; save(nv);
      });
      st.querySelector('.stp-max').addEventListener('click', () => {
        const nv = Math.min(max, parseInt(val.value, 10) + 1);
        val.value = nv; save(nv);
      });
    });
    // 决定按钮
    const goA = document.getElementById('dec-go-a');
    if (goA) goA.addEventListener('click', () => makeDecision('typea'));
    const goB = document.getElementById('dec-go-b');
    if (goB) goB.addEventListener('click', () => makeDecision('typeb'));
    // v3.6.x：输入框一键清空按钮——直接清空对应输入框（contenteditable 转换的 ghost
    // input 的 value 已代理到 box，读 value 再置空即可；box 用 textContent 清空）
    document.querySelectorAll(scope + ' .dec-inp-clear').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.clear;
        const ta = document.getElementById(id);
        if (!ta) return;
        // 手机端 contenteditable 转换器下，原 textarea 已退场为 ghost，value 代理到 box
        const box = ta.__ceBox;
        if (box) box.textContent = '';
        else ta.value = '';
        ta.focus();
        toast('已清空');
      });
    });
    // 回复到聊天开关
    const rc = document.getElementById('dec-reply-chat');
    if (rc) { rc.addEventListener('change', () => { const s = loadSettings(); s.replyToChat = rc.checked; saveSettings(s); }); }
  }

  function makeDecision(type) {
    // v3.6.x：防连点/中途再点——先取消上一轮的倒计时与结果定时器，避免
    // 「帮我决定」历史与聊天消息重复（旧 setTimeout 仍会执行导致重复写入）
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (decideTimer) { clearTimeout(decideTimer); decideTimer = null; }
    let question, thinkTime, maxSelect;
    if (type === 'typea') {
      question = (document.getElementById('dec-q-a').value || '').trim();
      thinkTime = parseInt(document.getElementById('dec-think-a-val').value, 10) || 3;
      maxSelect = 1; // 是/否/半对：固定单选，最多选几个只用于自定义选项
    } else {
      question = (document.getElementById('dec-q-b').value || '').trim();
      thinkTime = parseInt(document.getElementById('dec-think-b-val').value, 10) || 3;
      maxSelect = parseInt(document.getElementById('dec-max-b-val').value, 10) || 1;
    }
    if (!question) { toast('请输入你的问题'); return; }
    let options = null;
    if (type === 'typeb') {
      const optsText = (document.getElementById('dec-opts').value || '').trim();
      if (!optsText) { toast('请输入选项'); return; }
      options = optsText.split('\n').map(o => o.trim()).filter(Boolean);
      if (options.length < 2) { toast('至少需要 2 个选项'); return; }
    }
    const resultEl = document.getElementById(type === 'typea' ? 'dec-result-a' : 'dec-result-b');
    resultEl.hidden = false;
    resultEl.classList.remove('done');
    resultEl.textContent = '对方正在思考中… ' + thinkTime + ' 秒';
    let count = thinkTime;
    countdownTimer = setInterval(() => {
      count--;
      if (count > 0) resultEl.textContent = '对方正在思考中… ' + count + ' 秒';
    }, 1000);
    // v3.6.x：结果定时器存入 decideTimer（倒计时结束自动清；重复点击先取消旧轮）
    const myCid = window.__activeCid || 'default';
    decideTimer = setTimeout(() => {
      decideTimer = null;
      if ((window.__activeCid || 'default') !== myCid) return;
      if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
      let result;
      if (type === 'typea') {
        const pool = ['是', '否', '半对', '这个我不选', '正在忙，暂未回复'];
        const shuffled = pool.slice().sort(() => Math.random() - 0.5);
        const n = Math.floor(Math.random() * maxSelect) + 1;
        result = shuffled.slice(0, Math.min(n, shuffled.length)).join('、');
      } else {
        const pool = options.slice().concat(['这个我不选', '正在忙，暂未回复']);
        const shuffled = pool.slice().sort(() => Math.random() - 0.5);
        const n = Math.floor(Math.random() * maxSelect) + 1;
        result = shuffled.slice(0, Math.min(n, shuffled.length)).join('、');
      }
      resultEl.textContent = result;
      resultEl.classList.add('done');
      // 历史记录（全部保存）
      const h = loadHistory();
      h.unshift({ id: 'd_' + Date.now(), type: type, question: question, result: result, options: options, ts: Date.now() });
      if (h.length > 1000) h.splice(1000);
      saveHistory(h);
      // 发送结果：从群聊打开→发到群聊（系统消息）；聊天页打开→发到聊天（联系人回复样式）
      if (loadSettings().replyToChat) {
        const replyText = type === 'typeb' && options
          ? '【帮我决定】' + question + '\n选项：\n' + options.map((o, i) => (i + 1) + '. ' + o).join('\n') + '\n→ ' + result
          : '【帮我决定】' + question + ' → ' + result;
        if (panelFromGroup && window.gcSendDecisionText) window.gcSendDecisionText(replyText);
        else if (window.chatAddIn) window.chatAddIn(replyText, { enter: true, silent: true, follow: true, dedupExempt: true }); // FIX 2026-09-15 #492 帮我决定结果是用户主动触发，跟底不吃 in 侧钉住闸（chat.js follow 通道）；FIX 2026-09-15 #544 dedupExempt 决定答案豁免收件侧去重（快速重跑同问题同文答案被 2500ms 窗静默吞且连锁吞多条，用户视角「联系人消息被吞了几条」。#544 编号顺延：#542 已被并行会话（房间亮度）占用）
      }
      toast('帮我决定已完成');
    }, thinkTime * 1000);
  }

  function renderHistory() {
    const el = document.getElementById('dec-history');
    if (!el) return;
    const h = loadHistory();
    el.innerHTML = h.length
      ? h.map(r =>
          '<div class="tc-listitem">' +
          '<div class="tc-li-q">' + esc(r.question) + '</div>' +
          (r.options && r.options.length ? '<div class="dc-h-options">选项：' + r.options.map((o, i) => (i + 1) + '. ' + esc(o)).join('，') + '</div>' : '') +
          '<div class="dc-h-result">→ ' + esc(r.result) + '</div>' +
          '<div class="dc-h-time">' + fmtDT(r.ts) + '</div></div>'
        ).join('')
      : '<div class="ta-empty">暂无帮我决定记录</div>';
  }

  // 入口：聊天更多功能 → 帮我决定（chat.js 里 more-decide 调用）
  // v3.27.x #421b：不再整体覆盖 window.openDecision（顶部已挂分派器），回填真实实现引用即可
  decisionPanelRef = openPanel;
})();
