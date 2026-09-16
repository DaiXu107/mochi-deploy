// ===== 功能：聊天设置 =====
// 聊天壁纸、双方气泡颜色/文字颜色、字体大小、气泡框大小（localStorage 持久化）
(function () {
  const uid = window.activePrefix();
  const store = window.activeStore();
  const root = document.documentElement;
  const body = document.getElementById('chat-body');
  if (!body) return;
  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
  }
  // 壁纸铺满整个聊天页（含顶部栏/输入栏）
  const chatPage = document.getElementById('page-chat');

  // v3.27.x 聊天壁纸图库的存储小助手（必须放 applySettings 首次调用之前——
  // applySettings 回显图库张数会读 csBgList，放后面会 TDZ 报错）
  const CS_BG_GLIST = 'cs-bg-glist';
  const CS_BG_MAX = 12; // 图库容量上限（每张压缩后可达 MB 级，防无上限堆爆 IDB）
  const csBgList = () => {
    try { const v = JSON.parse(store.get(CS_BG_GLIST) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  };
  const csBgSaveList = (arr) => store.set(CS_BG_GLIST, JSON.stringify(arr));
  // v3.27.x 优化①：active-id——记录图库里哪张是当前生效壁纸，面板高亮/删除判断只看 id，
  // 不再为对比把每张 MB 级全图读进内存（打开 12 张的面板从几十 MB 堆占用降到只解码缩略图）
  const CS_BG_ACTIVE = 'cs-bg-active-id';
  const csBgActiveId = () => store.get(CS_BG_ACTIVE) || '';
  // 对账：cs-bg 有值但 active-id 缺失/失配（升级首次、美化方案直写 cs-bg、清除壁纸）时
  // 读一轮全图找回匹配项；稳态只做 1 次内存读 + 1 次字符串比对（memoryCache 返引用，零拷贝）
  function csBgReconcileActive() {
    const list = csBgList();
    const cur = store.get('cs-bg');
    if (!cur) { if (csBgActiveId()) store.remove(CS_BG_ACTIVE); return ''; }
    const aid = csBgActiveId();
    if (aid && list.indexOf(aid) >= 0 && store.get('cs-bg-item-' + aid) === cur) return aid;
    for (let i = 0; i < list.length; i++) {
      if (store.get('cs-bg-item-' + list[i]) === cur) { store.set(CS_BG_ACTIVE, list[i]); return list[i]; }
    }
    return '';
  }

  const FONT_SIZES = [
    { label: '小', value: '13px' },
    { label: '标准', value: '14px' },
    { label: '大', value: '16px' },
    { label: '特大', value: '18px' }
  ];
  const BUBBLE_SIZES = [
    { label: '紧凑', value: '8px 10px' },
    { label: '标准', value: '11px 14px' },
    { label: '宽松', value: '14px 18px' }
  ];
  // v3.25.x：聊天气泡边缘（四角圆角大小）
  const BUBBLE_RADII = [
    { label: '小圆角', value: '6px' },
    { label: '标准', value: '12px' },
    { label: '大圆角', value: '18px' },
    { label: '特圆', value: '28px' }
  ];
  const BUBBLE_RADIUS_DEFAULT = '18px';
  // v3.9.x：时间轴样式（默认头像下方，与原实现一致）
  // under-av=头像下方  under-bubble=气泡下方  bubble=时间气泡  float=气泡外侧悬浮
  // center=消息上方居中  divider=时间分隔线（微信式，消息间隔大时插居中胶囊）  hidden=隐藏
  const TIME_STYLES = [
    { label: '头像下方', value: 'under-av' },
    { label: '气泡下方', value: 'under-bubble' },
    { label: '时间气泡', value: 'bubble' },
    { label: '气泡外侧悬浮', value: 'float' },
    { label: '消息上方居中', value: 'center' },
    { label: '时间分隔线', value: 'divider' },
    { label: '隐藏', value: 'hidden' }
  ];

  // v3.11.x：未自定义的配色默认值跟随深浅主题。此前默认色写死浅色（白气泡/黑时间字），
  // 且以 root 内联样式写入——内联优先级高于 dark.css 的 [data-theme] 覆盖，导致
  // 深色模式下联系人气泡纯白、时间戳纯黑看不见。用户自定义过（store 有值）仍优先。
  function themeDefaults() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return dark
      ? { inBg: '#2a2a2a', inInk: '#f0f0f0', outBg: '#3a3a3a', outInk: '#ffffff', timeInk: '#8a8a8a', sendBg: '#f0f0f0', sendInk: '#111111' }
      : { inBg: '#ffffff', inInk: '#111111', outBg: '#111111', outInk: '#ffffff', timeInk: '#111111', sendBg: '#111111', sendInk: '#ffffff' };
  }
  // v3.26.x：单聊气泡对比度自愈——出站/入站文字色与背景色同色或极低对比（用户误设/导入美化方案）
  // 时注入高优先级覆盖样式强制文字可见。
  // FIX 2026-09-15 #536：自愈只覆盖单聊页（#page-chat）与收藏页（#page-fav）。此前选择器是全局的
  // `.msg-out .msg-bubble.msg-bubble`——群聊页（#page-group-chat）复用同一套 .msg-out/.msg-in/
  // .msg-bubble 类名却有自己的气泡变量，于是单聊配色触发自愈时，群聊「我的气泡」被强制写成
  // 单聊底色的高对比字色：单聊把气泡改成浅色（如 #ffffff）而文字色仍是默认白 → 自愈注入
  // color:#111111，落到群聊默认黑气泡上就是黑字黑底＝「群聊里我发消息整个框变黑看不到字」
  //（用户明说「没有修改过气泡和文字颜色」——他改的是气泡底色，文字色从未动过，故自愈被触发）。
  // 注：群聊曾有的 GC_MIN_CONTRAST 保护已按 #223 用户裁决撤销（群聊所见即所得、不做配色干预），
  // 所以这条全局选择器在群聊侧没有任何兜底，必须靠作用域隔离。
  function _csHexRgb(h) {
    if (!h || typeof h !== 'string') return null;
    var s = h.trim(); if (s.charAt(0) === '#') s = s.slice(1);
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (s.length !== 6) return null;
    var n = parseInt(s, 16); if (isNaN(n)) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function _csRelLum(rgb) {
    if (!rgb) return 0;
    function ch(c) { c = c / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2]);
  }
  function _csContrast(c1, c2) {
    var l1 = _csRelLum(_csHexRgb(c1)), l2 = _csRelLum(_csHexRgb(c2));
    if (l1 === 0 && l2 === 0) return 0;
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function _csHiInk(bg) {
    var rgb = _csHexRgb(bg); return (rgb && _csRelLum(rgb) < 0.5) ? '#ffffff' : '#111111';
  }
  function _ensureBubbleContrast() {
    var fix = document.getElementById('cs-contrast-fix'), rules = [];
    var ob = root.style.getPropertyValue('--msg-out-bg') || '#111111';
    var oi = root.style.getPropertyValue('--msg-out-ink') || '#ffffff';
    if (_csContrast(oi, ob) < 1.5) rules.push('#page-chat .msg-out .msg-bubble.msg-bubble,#page-fav .msg-out .msg-bubble.msg-bubble{color:' + _csHiInk(ob) + '!important}');
    var ib = root.style.getPropertyValue('--msg-in-bg') || '#ffffff';
    var ii = root.style.getPropertyValue('--msg-in-ink') || '#111111';
    if (_csContrast(ii, ib) < 1.5) rules.push('#page-chat .msg-in .msg-bubble.msg-bubble,#page-fav .msg-in .msg-bubble.msg-bubble{color:' + _csHiInk(ib) + '!important}');
    if (rules.length) {
      if (!fix) { fix = document.createElement('style'); fix.id = 'cs-contrast-fix'; document.head.appendChild(fix); }
      fix.textContent = rules.join('\n');
    } else if (fix) fix.remove();
  }
  function applySettings() {
    // 设置页值写入（定义在最前，避免暂时性死区）
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const DEF = themeDefaults();
    const inBg = store.get('cs-in-bg') || DEF.inBg;
    const inInk = store.get('cs-in-ink') || DEF.inInk;
    const outBg = store.get('cs-out-bg') || DEF.outBg;
    const outInk = store.get('cs-out-ink') || DEF.outInk;
    const fs = store.get('cs-font-size') || '14px';
    const pad = store.get('cs-bubble-size') || '11px 14px';
    root.style.setProperty('--msg-in-bg', inBg);
    root.style.setProperty('--msg-in-ink', inInk);
    root.style.setProperty('--msg-out-bg', outBg);
    root.style.setProperty('--msg-out-ink', outInk);
    root.style.setProperty('--chat-font-size', fs);
    root.style.setProperty('--chat-bubble-pad', pad);
    // 聊天气泡边缘（四角圆角大小）
    const rad = store.get('cs-bubble-radius') || BUBBLE_RADIUS_DEFAULT;
    root.style.setProperty('--chat-bubble-radius', rad);
    // 时间轴颜色（默认黑/深色模式灰）
    const timeInk = store.get('cs-time-ink') || DEF.timeInk;
    root.style.setProperty('--msg-time-ink', timeInk);
    // 正在输入中颜色（默认灰）
    const typingInk = store.get('cs-typing-ink') || '#8a8a8a';
    root.style.setProperty('--typing-ink', typingInk);
    // 发送按钮颜色（默认黑/深色模式白）
    const sendBg = store.get('cs-send-bg') || DEF.sendBg;
    root.style.setProperty('--send-bg', sendBg);
    // 发送按钮文字颜色（默认白/深色模式黑）
    const sendInk = store.get('cs-send-ink') || DEF.sendInk;
    root.style.setProperty('--send-ink', sendInk);
    // 发送按钮显示/隐藏（默认显示；隐藏后仍可按 Enter 发送）
    const sendShow = store.get('cs-send-show') || 'show';
    const sendBtn = document.getElementById('chat-send');
    if (sendBtn) sendBtn.style.display = sendShow === 'hide' ? 'none' : '';
    set('cs-send-bg-val', sendBg === DEF.sendBg ? '默认 ' + DEF.sendBg : sendBg);
    set('cs-send-ink-val', sendInk === DEF.sendInk ? '默认 ' + DEF.sendInk : sendInk);
    // 双方气泡颜色/文字颜色当前值回显（默认值显示「默认 #色值」，让用户知道默认颜色）
    set('cs-out-bg-val', outBg === DEF.outBg ? '默认 ' + DEF.outBg : outBg);
    set('cs-out-ink-val', outInk === DEF.outInk ? '默认 ' + DEF.outInk : outInk);
    set('cs-in-bg-val', inBg === DEF.inBg ? '默认 ' + DEF.inBg : inBg);
    set('cs-in-ink-val', inInk === DEF.inInk ? '默认 ' + DEF.inInk : inInk);
    // 聊天头像形状（circle 圆形 / square 方形）
    const avShape = store.get('cs-av-shape') || 'circle';
    root.style.setProperty('--msg-av-radius', avShape === 'square' ? '10px' : '50%');
    set('cs-av-shape-val', avShape === 'square' ? '方形' : '圆形');
    // 时间轴样式：body 上挂 cs-time-* 类（CSS 控制布局，消息结构不变），
    // 移除旧类后挂新类——覆盖收藏页（#page-fav 是 body 后代），收藏项无需改动
    const ts = store.get('cs-time-style') || 'under-av';
    const tsLabel = (TIME_STYLES.find(s => s.value === ts) || {}).label || '头像下方';
    TIME_STYLES.forEach(s => document.body.classList.remove('cs-time-' + s.value));
    if (ts !== 'under-av') document.body.classList.add('cs-time-' + ts);
    set('cs-time-style-val', tsLabel);
    // 聊天壁纸：铺满整个聊天页
    // v3.6.x：值没变时不重写 style——applySettings 在每次进入聊天页时调用，
    // 反复重设 background-image（大图 dataURL）会让浏览器重新解码、触发重绘
    // v3.5.126：去掉 background-attachment:fixed——手机上 fixed 背景相对视口定位，
    // 全屏/输入法/安全区变化时与元素尺寸不一致 → 比例错位、露白；且移动端
    // 对 fixed 背景降采样 → 发糊。聊天页本身 overflow:hidden 不滚动（只有
    // .chat-body 内部滚动），默认 scroll 模式下背景相对 page 本来就是固定的，
    // fixed 纯属多余并引入视口耦合。
    // v3.6.x：存量大图渲染防护——旧版本聊天壁纸压缩失败时回退存过原图（48MP/ProRAW
    // 级别十几 MB），渲染 backgroundImage 会让 iOS Safari 解码卡死（打开页面卡顿点不动）。
    // 正常压缩产物（2160-4096px JPEG 0.85）≤6MB，>6MB 判定为异常存量，清除回默认
    let bg = store.get('cs-bg');
    if (bg && typeof bg === 'string' && bg.length > 6 * 1024 * 1024) {
      try { store.remove('cs-bg'); } catch (e) {}
      bg = null;
    }
    if (bg && chatPage) {
      if (chatPage.style.backgroundImage !== 'url("' + bg + '")') {
        chatPage.style.backgroundImage = 'url("' + bg + '")';
        chatPage.style.backgroundSize = 'cover';
        chatPage.style.backgroundPosition = 'center';
      }
    } else if (chatPage && chatPage.style.backgroundImage) {
      chatPage.style.backgroundImage = '';
    }
    set('cs-font-size-val', fs);
    const pn = BUBBLE_SIZES.find(p => p.value === pad);
    set('cs-bubble-size-val', pn ? pn.label : '自定义');
    const rn = BUBBLE_RADII.find(p => p.value === rad);
    set('cs-bubble-radius-val', rn ? rn.label : (rad === '0px' ? '方形' : rad));
    set('cs-bg-val', bg ? '已设置' : '');
    // v3.27.x：回显带上图库张数（提示图库里有存货，点行可切换）
    try { const gl = csBgList(); if (gl.length) set('cs-bg-val', '已设置 · 库 ' + gl.length + ' 张'); } catch (e) {}
    const rm = document.getElementById('cs-bg-remove');
    if (rm) rm.hidden = !bg;
    _ensureBubbleContrast();
  }
  window.applyChatSettings = applySettings;
  applySettings();
  // v3.11.x：深色/浅色切换时重算默认配色（personalize.js 切换 html data-theme，
  // 这里监听属性变化即时重写内联变量，不用跨模块调用）
  try {
    new MutationObserver(() => { try { applySettings(); } catch (e) {} })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  } catch (e) {}

  // 各设置行
  const row = (id) => document.getElementById(id);
  // ================= 聊天壁纸图库（多张保存 + 点击切换） =================
  // v3.27.x：此前 cs-bg 只有一张，换图必须重新上传旧图即丢。现在图库存多张：
  //   cs-bg-glist = JSON 数组（图库条目 id 列表，小键）；cs-bg-item-<id> = 全图（大键走
  //   idb.js >200KB 只进 IDB 的既有通道）；cs-bg-item-thb-<id> = 240px 缩略图（面板渲染
  //   只解码小图，避免一次打开面板解码 N 张 4MB 原图把低端机拖卡）。当前生效壁纸仍是
  //   cs-bg（聊天页 applySettings / 美化方案导出 / 渲染防护等既有链路零改动）。
  //   旧数据自动迁移：cs-bg 有值而图库为空时，首次打开面板把 cs-bg 收为第 1 张。
  // 240px JPEG 缩略图：面板网格渲染专用（与全图分开存，抽屉/面板只碰小图）
  function csBgMakeThumb(dataUrl, maxSide) {
    return new Promise((resolve) => {
      if (typeof dataUrl !== 'string' || dataUrl.length > 50 * 1024 * 1024) { resolve(null); return; }
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', 0.8));
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }
  // 压缩：v3.5.126 按设备物理像素定上限——之前固定 900px，
  // 在 2-3x 高分屏（物理宽 1080-1440）铺满时被放大发糊
  function csBgCompress(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const dpr = Math.max(1, window.devicePixelRatio || 1);
          const screenH = (window.screen && window.screen.height) || 1920;
          const maxSide = Math.min(4096, Math.max(2160, Math.round(screenH * dpr)));
          const c = document.createElement('canvas');
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.85));
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }
  // 入库一张并设为当前壁纸（上传/迁移共用）；返回 null 表示压缩失败
  async function csBgAdd(dataRaw) {
    const data = await csBgCompress(dataRaw);
    if (!data) return null;
    const id = 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const list = csBgList();
    if (list.length >= CS_BG_MAX) { toast('图库已满（' + CS_BG_MAX + ' 张），请先在列表里删除几张'); return null; }
    list.push(id);
    csBgSaveList(list);
    store.set('cs-bg-item-' + id, data);
    // 缩略图失败不阻塞入库（面板渲染时兜底现生成）
    csBgMakeThumb(data, 240).then(th => { if (th) store.set('cs-bg-item-thb-' + id, th); });
    store.set('cs-bg', data);
    store.set(CS_BG_ACTIVE, id);
    applySettings();
    return id;
  }
  // 持久化多选 input：一次可加多张，逐张按序入库（压缩本身异步，串行防内存叠加）
  const csBgFileInput = document.createElement('input');
  csBgFileInput.type = 'file'; csBgFileInput.accept = 'image/*'; csBgFileInput.multiple = true;
  csBgFileInput.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
  document.body.appendChild(csBgFileInput);
  csBgFileInput.onchange = () => {
    const fs = Array.prototype.slice.call(csBgFileInput.files || []);
    csBgFileInput.value = ''; // 允许重选同一文件
    if (!fs.length) return;
    let ok = 0;
    toast('正在处理 ' + fs.length + ' 张图片…');
    let chain = Promise.resolve();
    fs.forEach((f) => {
      chain = chain.then(() => new Promise((res) => {
        const reader = new FileReader();
        reader.onload = () => {
          csBgAdd(reader.result).then((id) => { if (id) ok++; res(); });
        };
        reader.onerror = () => res();
        reader.readAsDataURL(f);
      }));
    });
    chain.then(() => {
      if (ok) { toast('已加入 ' + ok + ' 张壁纸'); }
      if (document.getElementById('cs-bg-panel') && document.getElementById('cs-bg-panel').style.display === 'flex') openCsBgPanel();
    });
  };
  // 壁纸图库面板：缩略图网格（点图切换 / × 删除 + 5 秒内可撤销）+ 多选上传 + 同步到全部联系人
  // 优化①：高亮只看 active-id，渲染不读全图（缩略图缺失时才读对应一张现生成）
  // 优化⑤：删除改为单击即删 + 底部「撤销」条（5 秒后作废），比两击确认更不怕手滑
  function openCsBgPanel() {
    let m = document.getElementById('cs-bg-panel');
    if (!m) {
      m = document.createElement('div'); m.id = 'cs-bg-panel';
      m.style.cssText = 'position:fixed;inset:0;z-index:89;align-items:center;justify-content:center;background:rgba(0,0,0,.4);display:none';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m) m.style.display = 'none'; });
    }
    m.innerHTML = '';
    const box = document.createElement('div');
    box.style.cssText = 'width:min(90vw,400px);max-height:82vh;overflow-y:auto;-webkit-overflow-scrolling:touch;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:16px;box-shadow:0 8px 30px rgba(0,0,0,.2)';
    const hd = document.createElement('div');
    hd.innerHTML = '<div style="font-size:16px;font-weight:600">聊天壁纸</div><div style="font-size:12px;color:var(--muted,#888);margin-top:4px">可存多张，点缩略图即切换；误删 5 秒内可撤销</div>';
    box.appendChild(hd);
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0';
    const cur = store.get('cs-bg') || '';
    const aid = csBgReconcileActive();
    const list = csBgList();
    if (!list.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'grid-column:1/-1;font-size:13px;color:var(--muted,#999);text-align:center;padding:24px 0';
      empty.textContent = '图库还是空的，点下方「上传新图」加入';
      grid.appendChild(empty);
    }
    list.forEach((id) => {
      const cell = document.createElement('div');
      cell.style.cssText = 'position:relative;border-radius:10px;overflow:hidden;border:2px solid transparent;cursor:pointer;aspect-ratio:9/16;background:var(--bg-b,#f2f2f2)';
      const thb = store.get('cs-bg-item-thb-' + id);
      const isActive = id === aid;
      if (isActive) cell.style.borderColor = 'var(--btn-bg,#111)';
      const im = document.createElement('img');
      im.alt = '';
      im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
      if (thb) { im.src = thb; }
      else {
        // 缩略图缺失（旧迁移/上次生成被打断）：读这一张全图现生成再回填，本次先用小占位
        const full = store.get('cs-bg-item-' + id);
        im.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=';
        cell.style.background = 'var(--muted,#888)';
        if (full) csBgMakeThumb(full, 240).then((th) => { if (th) { store.set('cs-bg-item-thb-' + id, th); im.src = th; cell.style.background = ''; } });
      }
      cell.appendChild(im);
      cell.addEventListener('click', () => {
        // 只在此刻读被点中的那一张全图（active-id 判断已由对账保证一致）
        const full = store.get('cs-bg-item-' + id);
        if (full) { store.set('cs-bg', full); store.set(CS_BG_ACTIVE, id); applySettings(); toast('已切换壁纸'); m.style.display = 'none'; }
      });
      const del = document.createElement('div');
      del.textContent = '×';
      del.style.cssText = 'position:absolute;top:2px;right:2px;width:20px;height:20px;line-height:18px;text-align:center;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;font-size:14px';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        const full = store.get('cs-bg-item-' + id);
        const thb2 = store.get('cs-bg-item-thb-' + id);
        const wasActive = id === aid;
        csBgSaveList(csBgList().filter(x => x !== id));
        store.remove('cs-bg-item-' + id);
        store.remove('cs-bg-item-thb-' + id);
        if (wasActive) { store.remove('cs-bg'); applySettings(); }
        // 优化⑤：留底 5 秒，面板底部出「撤销」条；每次删除覆盖上一条留底（只保最近一张）
        if (full) {
          m.__undoItem = { id, full, thb: thb2, wasActive };
          if (m.__undoTimer) clearTimeout(m.__undoTimer);
          m.__undoTimer = setTimeout(() => { m.__undoItem = null; if (m.style.display === 'flex') openCsBgPanel(); }, 5000);
        }
        toast('已删除，5 秒内可撤销');
        openCsBgPanel();
      });
      cell.appendChild(del);
      grid.appendChild(cell);
    });
    box.appendChild(grid);
    // 优化⑤：撤销条——恢复刚删除的那张（含它是否当时正被使用）
    if (m.__undoItem) {
      const strip = document.createElement('div');
      strip.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;background:var(--bg-b,#f6f6f6);margin-bottom:8px';
      const st = document.createElement('span'); st.style.cssText = 'flex:1;font-size:12px;color:var(--muted,#888)'; st.textContent = '刚删除了 1 张壁纸，可撤销'; strip.appendChild(st);
      const ub = document.createElement('button'); ub.textContent = '撤销'; ub.style.cssText = 'padding:5px 14px;border:none;border-radius:8px;background:var(--ink,#111);color:#fff;font-size:12px;font-weight:600';
      ub.addEventListener('click', () => {
        const u = m.__undoItem;
        m.__undoItem = null;
        if (m.__undoTimer) { clearTimeout(m.__undoTimer); m.__undoTimer = null; }
        if (u && u.full) {
          csBgSaveList(csBgList().concat([u.id]));
          store.set('cs-bg-item-' + u.id, u.full);
          if (u.thb) store.set('cs-bg-item-thb-' + u.id, u.thb);
          if (u.wasActive) { store.set('cs-bg', u.full); store.set(CS_BG_ACTIVE, u.id); applySettings(); }
          toast('已撤销删除');
        }
        openCsBgPanel();
      });
      strip.appendChild(ub);
      box.appendChild(strip);
    }
    const upBtn = document.createElement('button');
    upBtn.textContent = '＋ 上传新图（可多选）';
    upBtn.style.cssText = 'width:100%;padding:11px;border:none;border-radius:10px;background:var(--ink,#111);color:var(--bg-b,#fff);font-size:14px;font-weight:600;margin-bottom:8px';
    upBtn.addEventListener('click', () => { try { csBgFileInput.click(); } catch (e) { toast('无法打开相册，请重试'); } });
    box.appendChild(upBtn);
    if (cur) {
      const rmBtn = document.createElement('button');
      rmBtn.textContent = '清除当前壁纸（图库保留）';
      rmBtn.style.cssText = 'width:100%;padding:10px;border:1px solid rgba(163,45,45,.35);border-radius:10px;background:var(--danger-soft,#fff5f5);color:var(--danger-ink,#a32d2d);font-size:13px;margin-bottom:8px';
      rmBtn.addEventListener('click', () => { store.remove('cs-bg'); store.remove(CS_BG_ACTIVE); applySettings(); toast('已清除，图库里的图还在'); openCsBgPanel(); });
      box.appendChild(rmBtn);
    }
    // 优化②：聊天壁纸/图库是 per-联系人独立的——一键同步到其他联系人桌面，
    // 换聊天对象不用逐个重新设壁纸。会覆盖对方现有聊天壁纸，openModal 二次确认。
    if (list.length && window.getContacts && window.xyStore && window.openModal) {
      const syncBtn = document.createElement('button');
      syncBtn.textContent = '把壁纸和图库同步到全部联系人';
      syncBtn.style.cssText = 'width:100%;padding:10px;border:1px solid var(--card-border,#ddd);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:13px;margin-bottom:8px';
      syncBtn.addEventListener('click', () => {
        const me = window.getActiveContact ? window.getActiveContact() : 'default';
        const others = window.getContacts().filter(c => c.id && c.id !== me);
        if (!others.length) { toast('现在只有这一个联系人，无需同步'); return; }
        window.openModal('同步到全部联系人', '', (v) => {
          if (v !== '__yes__') return;
          const fullNow = store.get('cs-bg');
          const glist = csBgList();
          const aidNow = csBgActiveId();
          let n = 0;
          others.forEach((c) => {
            try {
              const st = window.xyStore('xy-home-v2:' + c.id);
              glist.forEach((gid) => {
                const f = store.get('cs-bg-item-' + gid); if (f) st.set('cs-bg-item-' + gid, f);
                const t = store.get('cs-bg-item-thb-' + gid); if (t) st.set('cs-bg-item-thb-' + gid, t);
              });
              st.set('cs-bg-glist', JSON.stringify(glist));
              if (aidNow) st.set('cs-bg-active-id', aidNow); else st.remove('cs-bg-active-id');
              if (fullNow) st.set('cs-bg', fullNow); else st.remove('cs-bg');
              n++;
            } catch (e) {}
          });
          toast('已同步到 ' + n + ' 个联系人（切到对应桌面即可看到）');
        }, { noInput: true, pills: [{ label: '确认同步（覆盖对方的聊天壁纸）', value: '__yes__' }, { label: '取消', value: '__no__' }] });
      });
      box.appendChild(syncBtn);
    }
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = 'width:100%;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555);font-size:13px';
    closeBtn.addEventListener('click', () => { m.style.display = 'none'; });
    box.appendChild(closeBtn);
    m.appendChild(box);
    m.style.display = 'flex';
  }
  const csBg = row('cs-bg-upload');
  if (csBg) {
    // v3.9.x：红米/真我等 Android Edge 对「点击时动态创建 + 立即 click()」的 file input
    // 会静默忽略（不弹系统选择器）。改为持久化 input（初始化时创建一次、永久挂 body、
    // 移出屏幕、每次复用），与 avatar-lib.js bindPoolUpload 已验证可用套路一致。
    // v3.27.x：入口改为壁纸图库面板（多张保存+点击切换）；上传逻辑挪进面板
    // （csBgFileInput 持久化 input 保留——真机已验证的「初始化即创建」套路不变）。
    csBg.addEventListener('click', () => {
      // 旧数据自动迁移：已有单张壁纸但图库为空 → 收进图库成为第 1 张（异步，不挡面板打开）
      if (store.get('cs-bg') && !csBgList().length) {
        const seed = store.get('cs-bg');
        const id = 'g' + Date.now().toString(36);
        csBgSaveList([id]);
        store.set('cs-bg-item-' + id, seed);
        store.set(CS_BG_ACTIVE, id);
        csBgMakeThumb(seed, 240).then(th => { if (th) store.set('cs-bg-item-thb-' + id, th); });
      }
      openCsBgPanel();
    });
  }
  const csBgRm = row('cs-bg-remove');
  if (csBgRm) {
    csBgRm.addEventListener('click', () => {
      store.remove('cs-bg');
      try { store.remove(CS_BG_ACTIVE); } catch (e) {}
      applySettings();
    });
  }

  const csAvShape = row('cs-av-shape');
  if (csAvShape) {
    csAvShape.addEventListener('click', () => {
      if (!window.openModal) return;
      window.openModal('聊天头像形状', '', (v) => { store.set('cs-av-shape', v); applySettings(); }, {
        pills: [
          { label: '圆形', value: 'circle' },
          { label: '方形', value: 'square' }
        ],
        pill: store.get('cs-av-shape') || 'circle',
        noInput: true
      });
    });
  }
  // v3.9.x：时间轴样式（胶囊选择，即时生效——body 上的类驱动布局，无消息重渲染）
  const csTimeStyle = row('cs-time-style');
  if (csTimeStyle) {
    csTimeStyle.addEventListener('click', () => {
      if (!window.openModal) return;
      const cur = store.get('cs-time-style') || 'under-av';
      window.openModal('时间轴样式', '', (v) => {
        store.set('cs-time-style', v);
        applySettings();
        // v3.9.x：divider（时间分隔线）需要重渲染补插分隔条，其余样式纯 CSS 即时生效
        //（divider 有 DOM 插入逻辑，不能像其它样式那样只切 body 类；聊天页已渲染时立即重渲染）
        if (v === 'divider' && window.chatReRenderTime) { try { window.chatReRenderTime(); } catch (e) {} }
      }, {
        pills: TIME_STYLES,
        pill: cur,
        noInput: true
      });
    });
  }
  // ================= 聊天专用昵称/头像（与桌面独立） =================
  // v3.8.x：聊天设置里编辑的昵称/头像只存 cs-lbl-*/cs-avatar-* 键，聊天页只读这套键；
  // 桌面 deco-widget 的 lbl-*/avatar-* 完全独立。未设时聊天页显示默认占位（TA/我 + 人形图标）。
  // v3.9.x：聊天昵称/头像未单独设置时**跟随桌面**（聊天页回退读桌面键）——设置后聊天域
  // 全部显示聊天专用值；设置页未设时右侧提示「跟随桌面（xx）」，明确当前生效来源。
  // 头像压缩与桌面 bindAvatar 一致（256px JPEG 0.85），内联实现避免依赖 personalize.js 导出。
  function compressHead(dataUrl, maxSide) {
    return new Promise((resolve) => {
      // v3.26.x：放宽 dataURL 上限 8MB→50MB、移除原图总像素上限（原 2600万像素把
      // 4800/5000 万像素手机主摄原图误拒 → 头像选完不生效，而同文件聊天背景上传无此
      // 限制能传）。drawImage 缩放到 maxSide 小 canvas 不会 OOM，try-catch + onerror 兜底。
      if (typeof dataUrl === 'string' && dataUrl.length > 50 * 1024 * 1024) { resolve(null); return; }
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', 0.85));
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }
  // v3.9.x：红米/真我等 Android Edge 对「点击时动态创建 + 立即 click()」的 file input
  // 会静默忽略（不弹系统选择器）。改为持久化 input：初始化时创建一次、永久挂 body、
  // 移出屏幕、每次复用（先清 value 再 click）——与 avatar-lib.js bindPoolUpload
  // 已验证可用套路一致。两个头像按钮（联系人/我的）共用这一个 input，靠回调区分。
  let headCb = null;
  const headInput = document.createElement('input');
  headInput.type = 'file'; headInput.accept = 'image/*';
  headInput.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
  document.body.appendChild(headInput);
  headInput.onchange = () => {
    const f = headInput.files && headInput.files[0];
    headInput.value = ''; // 允许重选同一文件
    if (!f) return;
    const cb = headCb; headCb = null;
    const reader = new FileReader();
    reader.onload = () => {
      compressHead(reader.result, 256).then(data => {
        if (!data) { toast('图片过大或格式不支持，请换一张小图'); return; }
        if (cb) cb(data);
      });
    };
    reader.readAsDataURL(f);
  };
  function pickHead(cb) {
    headCb = cb;
    try { headInput.click(); } catch (e) { toast('无法打开相册，请重试'); }
  }
  function applyProfile() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    // v3.26.x：聊天昵称与桌面解耦（用户要求不再跟随桌面）——未设置时显示默认占位提示，
    // 不再显示「跟随桌面（xx）」，也不回退读桌面 lbl-partner/lbl-user
    const lp = store.get('cs-lbl-partner');
    set('cs-lbl-partner-val', lp || '未设置（默认 TA）');
    const lu = store.get('cs-lbl-user');
    set('cs-lbl-user-val', lu || '未设置（默认 我）');
    const ap = store.get('cs-avatar-partner');
    set('cs-avatar-partner-val', ap ? '已设置' : '');
    const ar = document.getElementById('cs-avatar-partner-remove');
    if (ar) ar.hidden = !ap;
    const au = store.get('cs-avatar-user');
    set('cs-avatar-user-val', au ? '已设置' : '');
    const aur = document.getElementById('cs-avatar-user-remove');
    if (aur) aur.hidden = !au;
  }
  applyProfile();
  const csLp = row('cs-lbl-partner');
  if (csLp) {
    csLp.addEventListener('click', () => {
      if (!window.openModal) return;
      const cur = store.get('cs-lbl-partner') || '';
      window.openModal('联系人昵称', cur, (v) => {
        const val = (v || '').trim();
        // v3.25.x：有效昵称变化时触发系统消息昵称清扫（chat.js），历史系统消息称呼跟随
        // v3.26.x：与桌面解耦后有效昵称基线只看 cs-lbl-partner（默认 TA），不再掺入桌面键
        const oldEff = store.get('cs-lbl-partner') || 'TA';
        if (val) store.set('cs-lbl-partner', val); else store.remove('cs-lbl-partner');
        if (oldEff !== (val || 'TA')) {
          try { if (window.chatSysNickChanged) window.chatSysNickChanged(oldEff); } catch (e) {}
        }
        applyProfile();
        try { if (window.renderChatHeader) window.renderChatHeader(); } catch (e) {}
      }, { maxlength: 30 });
    });
  }
  const csLu = row('cs-lbl-user');
  if (csLu) {
    csLu.addEventListener('click', () => {
      if (!window.openModal) return;
      const cur = store.get('cs-lbl-user') || '';
      window.openModal('我的昵称', cur, (v) => {
        const val = (v || '').trim();
        if (val) store.set('cs-lbl-user', val); else store.remove('cs-lbl-user');
        applyProfile();
      }, { maxlength: 30 });
    });
  }
  const csAp = row('cs-avatar-partner');
  if (csAp) {
    csAp.addEventListener('click', () => {
      pickHead(data => {
        store.set('cs-avatar-partner', data);
        applyProfile();
        try { if (window.refreshChatAvatars) window.refreshChatAvatars(); } catch (e) {}
      });
    });
  }
  const csApRm = row('cs-avatar-partner-remove');
  if (csApRm) {
    csApRm.addEventListener('click', () => {
      store.remove('cs-avatar-partner');
      applyProfile();
      try { if (window.refreshChatAvatars) window.refreshChatAvatars(); } catch (e) {}
    });
  }
  const csAu = row('cs-avatar-user');
  if (csAu) {
    csAu.addEventListener('click', () => {
      pickHead(data => {
        store.set('cs-avatar-user', data);
        applyProfile();
        try { if (window.refreshChatAvatars) window.refreshChatAvatars(); } catch (e) {}
      });
    });
  }
  const csAuRm = row('cs-avatar-user-remove');
  if (csAuRm) {
    csAuRm.addEventListener('click', () => {
      store.remove('cs-avatar-user');
      applyProfile();
      try { if (window.refreshChatAvatars) window.refreshChatAvatars(); } catch (e) {}
    });
  }
  // ================= 双方气泡颜色 / 文字颜色 =================
  // 色板：气泡底色与文字色（v3.6.x：新增颜色设置入口，走 openModal 色板）
  const BUBBLE_BG_COLORS = [
    { color: '#111111', label: '默认黑' },
    { color: '#ffffff', label: '白色' },
    { color: '#3a3a3a', label: '炭灰' },
    { color: '#ffd6e0', label: '樱花粉' },
    { color: '#d6e4ff', label: '雾霭蓝' },
    { color: '#d8f5e0', label: '薄荷绿' },
    { color: '#fff3d6', label: '奶油黄' },
    { color: '#e8dcff', label: '淡紫' },
    { color: '#ffdcc0', label: '暖橘' }
  ];
  const BUBBLE_INK_COLORS = [
    { color: '#111111', label: '默认黑' },
    { color: '#ffffff', label: '白色' },
    { color: '#444444', label: '深灰' },
    { color: '#d6336c', label: '玫红' },
    { color: '#1a56db', label: '蓝' },
    { color: '#1e8e5a', label: '绿' },
    { color: '#9a6b00', label: '黄褐' },
    { color: '#7048e8', label: '紫' },
    { color: '#b3540a', label: '橘' }
  ];
  // 发送按钮背景色板（含微信绿/红包红等鲜艳色，适配按钮场景）
  const SEND_BG_COLORS = [
    { color: '#111111', label: '默认黑' },
    { color: '#07c160', label: '微信绿' },
    { color: '#fa5151', label: '红包红' },
    { color: '#3a8ee6', label: '天空蓝' },
    { color: '#ff9500', label: '活力橙' },
    { color: '#9254de', label: '优雅紫' },
    { color: '#ffffff', label: '白色' },
    { color: '#3a3a3a', label: '炭灰' }
  ];
  // 气泡颜色行统一处理：openModal 色板 → 存 cs-* 键 → applySettings 生效
  function bindBubbleColorRow(rowId, key, def, title, swatches) {
    const el = row(rowId);
    if (!el) return;
    el.addEventListener('click', () => {
      if (!window.openModal) return;
      const cur = store.get(key) || def;
      window.openModal(title, '', (v) => {
        // v 可能是色板下标（number）或自定义色值（#hex 字符串）
        const color = (typeof v === 'number' && swatches[v]) ? swatches[v].color : v;
        if (!color) return;
        store.set(key, color);
        applySettings();
        const val = document.getElementById(rowId + '-val');
        if (val) val.textContent = color === def ? '默认 ' + color : color;
      }, {
        colorPicker: true,
        color: cur,
        swatches: swatches
      });
    });
  }
  // 我的气泡（out 深色系）/ 联系人气泡（in 浅色系）与各自文字色
  bindBubbleColorRow('cs-out-bg', 'cs-out-bg', '#111111', '我的气泡颜色', BUBBLE_BG_COLORS);
  bindBubbleColorRow('cs-out-ink', 'cs-out-ink', '#ffffff', '我的消息文字颜色', BUBBLE_INK_COLORS);
  bindBubbleColorRow('cs-in-bg', 'cs-in-bg', '#ffffff', '联系人气泡颜色', BUBBLE_BG_COLORS);
  bindBubbleColorRow('cs-in-ink', 'cs-in-ink', '#111111', '联系人消息文字颜色', BUBBLE_INK_COLORS);
  // 发送按钮颜色 / 发送文字颜色
  bindBubbleColorRow('cs-send-bg', 'cs-send-bg', '#111111', '发送按钮颜色', SEND_BG_COLORS);
  bindBubbleColorRow('cs-send-ink', 'cs-send-ink', '#ffffff', '发送文字颜色', BUBBLE_INK_COLORS);
  // 发送按钮显示/隐藏（勾选=隐藏，默认显示；隐藏后仍可按回车键发送）。每联系人独立。
  const csSendShow = document.getElementById('cs-send-show');
  if (csSendShow) {
    const showGet = () => { try { return store.get('cs-send-show') === 'hide'; } catch (e) { return false; } };
    const showSet = (hide) => { try { store.set('cs-send-show', hide ? 'hide' : 'show'); } catch (e) {} };
    const syncCsSendShow = () => { const v = showGet(); if (v !== csSendShow.checked) csSendShow.checked = v; };
    syncCsSendShow();
    csSendShow.addEventListener('change', () => {
      if (csSendShow.checked === showGet()) return;
      showSet(csSendShow.checked);
      applySettings();
      toast(csSendShow.checked ? '发送按钮已隐藏：仍可按回车键发送消息' : '发送按钮已显示');
    });
    document.addEventListener('contact-switched', syncCsSendShow);
  }
  // 回车键发送开关（默认开；关闭后按回车不发送，改为换行/不动作）。每联系人独立。
  const csEnterSend = document.getElementById('cs-enter-send');
  if (csEnterSend) {
    const enterGet = () => { try { return store.get('cs-enter-send') !== 'off'; } catch (e) { return true; } };
    const enterSet = (on) => { try { store.set('cs-enter-send', on ? 'on' : 'off'); } catch (e) {} };
    const syncCsEnterSend = () => { const v = enterGet(); if (v !== csEnterSend.checked) csEnterSend.checked = v; };
    syncCsEnterSend();
    csEnterSend.addEventListener('change', () => {
      if (csEnterSend.checked === enterGet()) return;
      enterSet(csEnterSend.checked);
      toast(csEnterSend.checked ? '回车键发送已开启' : '回车键发送已关闭：按回车键改为换行');
    });
    document.addEventListener('contact-switched', syncCsEnterSend);
  }

  const csFont = row('cs-font-size');
  if (csFont) {
    csFont.addEventListener('click', () => {
      if (!window.openModal) return;
      window.openModal('聊天气泡字体大小', '', (v) => { store.set('cs-font-size', v); applySettings(); }, {
        pills: FONT_SIZES,
        pill: store.get('cs-font-size') || '14px'
      });
    });
  }
  const csPad = row('cs-bubble-size');
  if (csPad) {
    csPad.addEventListener('click', () => {
      if (!window.openTCPanel) return;
      const cur = store.get('cs-bubble-size') || '11px 14px';
      const curLabel = (BUBBLE_SIZES.find(p => p.value === cur) || {}).label || '自定义';
      window.openTCPanel('聊天气泡框大小', '' +
        '<div class="sm-fld"><label>预设大小</label><select class="tc-input" id="cs-pad-preset">' +
        '<option value="">自定义</option>' +
        BUBBLE_SIZES.map(p => '<option value="' + p.value + '"' + (p.value === cur ? ' selected' : '') + '>' + p.label + '</option>').join('') +
        '</select></div>' +
        '<div class="sm-fld"><label>自定义（格式：上下 左右，如 <code>8px 10px</code>）</label>' +
        // v3.6.x：回填值做 HTML 转义——用户可写的值含 " 会破坏 value 属性（与 cs-font-name 一致）
        '<input class="tc-input" id="cs-pad-input" value="' + String(cur).replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"></div>' +
        '<div class="sm-set-hint">示例：紧凑 8px 10px · 标准 11px 14px · 宽松 14px 18px</div>' +
        '<div class="mail-actions"><button class="cc-tool" id="cs-pad-cancel">取消</button><button class="cc-tool" id="cs-pad-ok">应用</button></div>');
      document.getElementById('cs-pad-cancel').addEventListener('click', () => { document.getElementById('tc-mask').hidden = true; });
      document.getElementById('cs-pad-preset').addEventListener('change', () => {
        const v = document.getElementById('cs-pad-preset').value;
        if (v) document.getElementById('cs-pad-input').value = v;
      });
      document.getElementById('cs-pad-ok').addEventListener('click', () => {
        let v = (document.getElementById('cs-pad-input').value || '').trim();
        if (!v) { toast('请输入气泡框大小'); return; }
        // 规范化：数字+px 或 纯数字（默认px）
        // v3.6.x：原正则会把 "1.5px" 改坏成 "1px.5px"（回溯拆开小数）——改为分词处理，
        // 已带 px 的 token 不动，纯数字补 px，避免无效 CSS 静默回退默认
        v = String(v).split(/[,\s]+/).filter(Boolean).map(function (tok) {
          return /^-?\d+(?:\.\d+)?px$/.test(tok) ? tok : tok.replace(/^(-?\d+(?:\.\d+)?)$/, '$1px');
        }).join(' ');
        store.set('cs-bubble-size', v);
        document.getElementById('tc-mask').hidden = true;
        applySettings();
        toast('气泡框大小已应用');
      });
    });
  }
  // v3.25.x：聊天气泡边缘（四角圆角大小）——滑块自由调节 + 预设胶囊，实时预览
  const csRadius = row('cs-bubble-radius');
  if (csRadius) {
    csRadius.addEventListener('click', () => {
      if (!window.openModal) return;
      const curStr = store.get('cs-bubble-radius') || BUBBLE_RADIUS_DEFAULT;
      const curNum = (parseInt(curStr, 10) || 0);
      window.openModal('聊天气泡边缘圆角', '', (v) => {
        const px = typeof v === 'number' ? v : (parseInt(v, 10) || 0);
        store.set('cs-bubble-radius', px + 'px');
        applySettings();
      }, {
        noInput: true,
        slider: {
          min: 0, max: 40, step: 1, value: Math.max(0, Math.min(40, curNum)),
          label: '拖动调整气泡圆角', unit: 'px', preview: true,
          onChange: (val) => { root.style.setProperty('--chat-bubble-radius', val + 'px'); }
        },
        pills: BUBBLE_RADII,
        pill: curStr
      });
    });
  }

  // ================= 全局字体（上传本地字体 / 输入字体名或链接，v3.5.34 起全局应用） =================
  const csFontRow = row('cs-font');
  const FONT_KEY = 'cs-font';
  function fontVal() { return store.get(FONT_KEY) || ''; }
  function applyFont() {
    // 移除旧的字体样式
    const old = document.getElementById('cs-font-style');
    if (old) old.remove();
    const v = fontVal();
    const setVal = document.getElementById('cs-font-val');
    if (setVal) setVal.textContent = v ? (v.indexOf('data:') === 0 ? '已上传' : v) : '默认';
    if (!v) {
      document.body.style.fontFamily = '';
      document.documentElement.style.fontFamily = '';
      return;
    }
    // dataURL → @font-face 注入 + 全局应用（body/html 继承到全部页面，不只聊天）
    if (v.indexOf('data:') === 0) {
      const st = document.createElement('style');
      st.id = 'cs-font-style';
      st.textContent = '@font-face{font-family:"cs-custom-font";src:url("' + v + '");font-display:swap;}' +
        'body,html{font-family:"cs-custom-font",sans-serif !important;}';
      document.head.appendChild(st);
      document.body.style.fontFamily = '';
      document.documentElement.style.fontFamily = '';
      return;
    }
    // 字体名直接应用（全局）
    document.body.style.fontFamily = '"' + v + '",sans-serif';
    document.documentElement.style.fontFamily = '"' + v + '",sans-serif';
  }
  if (csFontRow) {
    csFontRow.addEventListener('click', () => {
      if (!window.openTCPanel) return;
      window.openTCPanel('全局字体', '' +
        '<div class="sm-fld"><label>上传本地字体（ttf / otf / woff / woff2），应用后全局生效</label>' +
        // v3.6.x：字体名做 HTML 转义——原逻辑直接拼接 value 属性，字体名含 " 或 < 会破坏弹层结构
        '<input class="tc-input" id="cs-font-name" placeholder="也可直接输入字体名或链接，如 Microsoft YaHei"' + (fontVal() && fontVal().indexOf('data:') !== 0 && fontVal().indexOf('http') !== 0 ? ' value="' + String(fontVal()).replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"' : '') + '></div>' +
        '<div class="mail-actions"><button class="cc-tool" id="cs-font-upload">上传字体</button><button class="cc-tool" id="cs-font-clear">恢复默认</button><button class="cc-tool" id="cs-font-ok">应用</button></div>');
      document.getElementById('cs-font-upload').addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.ttf,.otf,.woff,.woff2';
        inp.onchange = () => {
          const f = inp.files && inp.files[0];
          if (!f) return;
          toast('正在读取字体文件…');
          const reader = new FileReader();
          reader.onload = () => {
            store.set(FONT_KEY, reader.result);
            document.getElementById('tc-mask').hidden = true;
            applyFont();
            toast('字体已应用成功');
          };
          reader.onerror = () => { toast('字体文件读取失败，请重试'); };
          reader.readAsDataURL(f);
        };
        inp.click();
      });
      document.getElementById('cs-font-clear').addEventListener('click', () => {
        store.remove(FONT_KEY);
        document.getElementById('tc-mask').hidden = true;
        applyFont();
        toast('已恢复默认字体');
      });
      document.getElementById('cs-font-ok').addEventListener('click', () => {
        const name = (document.getElementById('cs-font-name').value || '').trim();
        if (!name) { toast('请输入字体名或链接'); return; }
        // 链接：尝试下载并转 dataURL（失败则按字体名应用）；下载期间先提示，避免"没反应"
        if (/^https?:\/\/.+\.(ttf|otf|woff|woff2)$/i.test(name)) {
          toast('正在下载字体，请稍候…');
          fetch(name, { mode: 'cors' }).then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.blob();
          }).then(blob => {
            const rd = new FileReader();
            rd.onload = () => {
              store.set(FONT_KEY, rd.result);
              document.getElementById('tc-mask').hidden = true;
              applyFont();
              toast('字体下载并应用成功');
            };
            rd.onerror = () => {
              store.set(FONT_KEY, name);
              document.getElementById('tc-mask').hidden = true;
              applyFont();
              toast('字体读取失败，已按字体名应用');
            };
            rd.readAsDataURL(blob);
          }).catch(() => {
            store.set(FONT_KEY, name);
            document.getElementById('tc-mask').hidden = true;
            applyFont();
            toast('链接下载失败，已按字体名应用');
          });
          return;
        }
        store.set(FONT_KEY, name);
        document.getElementById('tc-mask').hidden = true;
        applyFont();
        toast('字体已应用成功');
      });
    });
  }
  applyFont();

  // ================= 气泡 CSS（自定义样式，极简黑白灰） =================
  const csCss = row('cs-css');
  const CSS_KEY = 'cs-bubble-css';
  // v3.14.x：安卓 ce-box 转换后 .value 代理在个别内核读空（mail.js/music-player.js/
  // period.js 同款先例）——代理读空但 ce-box 里仍有可见内容时直接从盒子取值兜底，
  // 防「点应用存了空串」→ 重进后退回默认气泡；用户真清空时盒子也是空的，语义不变
  function cssReadVal(el) {
    if (!el) return '';
    let v = '';
    try { v = el.value || ''; } catch (e) {}
    if (String(v).trim()) return String(v);
    try {
      const box = el.__ceBox || (el.parentNode && el.parentNode.querySelector('.ce-box[data-for="' + (el.id || '') + '"]'));
      if (box) {
        const t = box.innerText || box.textContent || '';
        if (String(t).trim()) return String(t);
      }
    } catch (e) {}
    return v;
  }
  function applyCss() {
    const old = document.getElementById('cs-bubble-style');
    if (old) old.remove();
    const css = store.get(CSS_KEY) || '';
    const setVal = document.getElementById('cs-css-val');
    if (setVal) setVal.textContent = css ? '已设置' : '默认';
    if (!css) return null;
    let out, hint = null;
    // v3.26.x #181：统一走 chat.js 的 mochiMapBubbleCss（别名扩充 + 未认出气泡类名时整包声明兜底，
    // 修「上传网页模板气泡 CSS 后界面零变化」多机型反复问题；兜底触发时给出 toast 说明）
    // FIX 2026-09-15 #536：单聊气泡样式必须钉在 #page-chat 作用域内。此前 scope 传空串，
    // 产出的 `.msg-out .msg-bubble{…}` 是全局选择器——群聊页（#page-group-chat）复用同一套
    // .msg-out/.msg-in/.msg-bubble 类名，用户只在单聊设置的气泡背景/文字色会连带套进群聊，
    // 正是「群聊里我发消息整个框变黑看不到字」的另一条泄漏路径（与 _ensureBubbleContrast 同族）。
    if (window.mochiMapBubbleCss) {
      const res = window.mochiMapBubbleCss(css, '#page-chat ');
      out = res.out;
      hint = res.hint;
    } else if (css.indexOf('{') < 0) {
      out = '#page-chat .msg-out .msg-bubble{' + css + '!important;}' +
            '#page-chat .msg-in .msg-bubble{' + css + '!important;}';
    } else {
      out = css;
    }
    const st = document.createElement('style');
    st.id = 'cs-bubble-style';
    st.textContent = out;
    document.head.appendChild(st);
    return hint;
  }
  if (csCss) {
    csCss.addEventListener('click', () => {
      if (!window.openTCPanel) return;
      window.openTCPanel('气泡 CSS', '' +
        '<div class="sm-fld-hint" style="margin-bottom:8px">输入自定义样式，支持两种写法：<br>· 直接写声明，如 <code>border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,.1)</code>（自动应用到双方气泡）<br>· 或写选择器，如 <code>.msg-out .msg-bubble{...}</code>；网页气泡模板常见的 <code>.me/.friend/.message-me/.bubble{...}</code> 等类名也会自动识别</div>' +
        '<textarea id="cs-css-input" class="tc-input" rows="6" placeholder="border-radius: 20px;' + '&#10;box-shadow: 0 2px 8px rgba(0,0,0,.12);"></textarea>' +
        '<div class="mail-actions"><button class="cc-tool" id="cs-css-clear">清空</button><button class="cc-tool" id="cs-css-ok">应用</button></div>');
      const ta = document.getElementById('cs-css-input');
      if (ta) ta.value = store.get(CSS_KEY) || '';
      document.getElementById('cs-css-clear').addEventListener('click', () => {
        store.remove(CSS_KEY);
        document.getElementById('tc-mask').hidden = true;
        applyCss();
        toast('已清空气泡样式');
      });
      document.getElementById('cs-css-ok').addEventListener('click', () => {
        const v = cssReadVal(document.getElementById('cs-css-input')).trim();
        store.set(CSS_KEY, v);
        document.getElementById('tc-mask').hidden = true;
        const hint = applyCss();
        toast(hint || '气泡样式已应用');
      });
    });
  }
  applyCss();

  // ================= v3.18.x：聊天美化方案（全局保存，所有联系人桌面通用） =================
  // 用户需求：聊天设置里也能像手机桌面美化一样，把气泡颜色/CSS、壁纸、字体、时间轴等
  // 全部美化保存成方案；保存后切换联系人/桌面依然可见，可一键应用（读当前桌面的 activeStore）。
  const gStoreChat = window.xyStore('xy-home-v2');
  const CHAT_SCHEMES_KEY = 'chat-beauty-schemes';
  const CHAT_BEAUTY_KEYS = [
    'cs-bg', 'cs-bubble-css', 'cs-font', 'cs-font-size', 'cs-bubble-size',
    'cs-bubble-radius', 'cs-av-shape', 'cs-time-style', 'cs-time-ink', 'cs-typing-ink',
    'cs-out-bg', 'cs-out-ink', 'cs-in-bg', 'cs-in-ink',
    'cs-send-bg', 'cs-send-ink', 'cs-send-show'
  ];
  const getChatSchemes = () => {
    try { const a = JSON.parse(gStoreChat.get(CHAT_SCHEMES_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  };
  const saveChatSchemesList = (arr) => { try { gStoreChat.set(CHAT_SCHEMES_KEY, JSON.stringify(arr)); } catch (e) {} };
  // FIX 2026-09-15 #527：聊天美化的用途标记 + 命中计数（与桌面美化同族，见 personalize.js #527）。
  // 旧行为：导入无用途校验、无「识别到几项」反馈，把桌面美化 JSON 粘进聊天导入框照样提示成功。
  const CHAT_BEAUTY_KIND = 'mochi-chat-beauty';
  const chatBeautyKindMismatch = (data) => {
    const k = data && data['__kind__'];
    return !!k && k !== CHAT_BEAUTY_KIND;
  };
  const recognizeChatBeauty = (data) => {
    if (!data || typeof data !== 'object') return 0;
    let n = 0;
    CHAT_BEAUTY_KEYS.forEach(k => { if (data[k] !== undefined) n++; });
    return n;
  };
  const collectChatBeauty = () => {
    const data = {};
    CHAT_BEAUTY_KEYS.forEach(k => { const v = store.get(k); if (v !== null && v !== undefined && v !== '') data[k] = v; });
    data['__kind__'] = CHAT_BEAUTY_KIND;
    return data;
  };
  const applyChatBeautyData = (data) => {
    let n = 0;
    CHAT_BEAUTY_KEYS.forEach(k => { if (data[k] !== undefined) { store.set(k, data[k]); n++; } });
    try { applySettings(); applyCss(); applyFont(); } catch (e) {}
    return n;
  };
  // FIX #527：聊天美化导入的兑底备份——此前 chatSchemeImport 直接覆盖、无「导入前备份」、
  // 无撤销压栈（注释写「与桌面美化导入一致」但备份那一半没跟上）。现与桌面版同口径：
  // 导入前把当前聊天美化存成「导入前备份」方案，只留最近 5 份，用户自己命名的方案不动。
  const chatBackupBeforeImport = () => {
    try {
      const cur = collectChatBeauty();
      const realKeys = Object.keys(cur).filter(k => k !== '__kind__');
      if (!realKeys.length) return '';
      const d = new Date();
      const p = (n) => (n < 10 ? '0' : '') + n;
      const name = '导入前备份 ' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
      let list = getChatSchemes();
      const autos = list.filter(s => s && typeof s.name === 'string' && s.name.indexOf('导入前备份') === 0);
      if (autos.length >= 5) {
        const drop = new Set(autos.slice(0, autos.length - 4).map(s => s.time));
        list = list.filter(s => !(s && drop.has(s.time) && typeof s.name === 'string' && s.name.indexOf('导入前备份') === 0));
      }
      list.push({ name, time: Date.now(), data: cur });
      saveChatSchemesList(list);
      const back = getChatSchemes();
      return back.some(s => s && s.name === name) ? name : '';
    } catch (e) { return ''; }
  };
  // v3.27.x：暴露给 personalize.js 的完整外观方案合并使用（跨域，仅暴露不改动逻辑）
  window.collectChatBeauty = collectChatBeauty;
  window.applyChatBeautyData = applyChatBeautyData;
  function chatSchemeModalEl() {
    let m = document.getElementById('chat-beauty-scheme-manager');
    if (!m) {
      m = document.createElement('div'); m.id = 'chat-beauty-scheme-manager'; m.hidden = true;
      m.style.cssText = 'position:fixed;inset:0;z-index:89;align-items:center;justify-content:center;background:rgba(0,0,0,.4)';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m) { m.style.display = 'none'; m.hidden = true; } });
    }
    return m;
  }
  function hideChatSchemeModal(m) { if (m) { m.style.display = 'none'; m.hidden = true; } }
  function applyChatScheme(idx, m) {
    const s = getChatSchemes()[idx];
    if (!s || !window.openModal) return;
    // v3.26.x：预选中唯一「应用」pill——noInput 弹窗只点底部「确定」时 fire() 传
    // pillVal=null → v!=='ok' 静默不应用（与桌面「应用方案/恢复默认桌面」同因同修）
    const ctl = window.openModal('应用方案「' + s.name + '」？', '', (v) => {
      if (v !== 'ok') return;
      applyChatBeautyData(s.data || {});
      hideChatSchemeModal(m);
      toast('已应用「' + s.name + '」，当前聊天立即生效');
    }, { noInput: true, staticText: '将覆盖当前联系人桌面的聊天美化设置，立即生效', pills: [{ label: '应用', value: 'ok' }] });
    if (ctl && ctl.pills) ctl.pills([{ label: '应用', value: 'ok' }], 'ok');
  }
  function deleteChatScheme(idx, m) {
    const s = getChatSchemes()[idx];
    if (!s || !window.openModal) return;
    // v3.26.x：预选中唯一「删除」pill——否则用户只点底部「确定」时传 null → 静默不删除（反馈"没反应"）
    const ctl = window.openModal('删除方案「' + s.name + '」？', '', (v) => {
      if (v !== 'ok') return;
      const list = getChatSchemes();
      list.splice(idx, 1);
      saveChatSchemesList(list);
      toast('已删除方案');
      window.openChatBeautySchemes();
    }, { noInput: true, staticText: '删除后不可恢复', pills: [{ label: '删除', value: 'ok' }] });
    if (ctl && ctl.pills) ctl.pills([{ label: '删除', value: 'ok' }], 'ok');
  }
  // 小按钮构造器
  function mkBtn(label, css, fn) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = css;
    b.addEventListener('click', fn);
    return b;
  }
  // v3.26.x：聊天美化方案导出——先选「当前设置 / 某个已保存方案」，再走文件/文字（与桌面美化导出一致）
  function chatSchemeExport() {
    const schemes = getChatSchemes();
    const doExport = (data) => {
      const json = JSON.stringify(data);
      if (!window.openModal) { toast('导出失败'); return; }
      // v3.26.x #172：文件名用本地日期（原 toISOString 是 UTC，凌晨导出文件名会是前一天）
      const d = new Date(); const p2 = (n) => (n < 10 ? '0' : '') + n;
      const fname = 'mochi聊天美化方案-' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '.json';
      window.openModal('导出聊天美化方案', '', (v) => {
        if (v === 'file') {
          // v3.26.x #172：走统一三级降级导出链（系统分享面板→系统保存框→确认后下载，
          // window.mochiExportFile 由 data-backup.js 暴露）——原裸 a[download] 在 iPhone
          // 主屏安装（standalone 无下载管理器）与部分壳浏览器静默无反应=方案无法导出
          if (window.mochiExportFile) { window.mochiExportFile(json, fname, 'mochi聊天美化方案'); return; }
          try {
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fname;
            document.body.appendChild(a); a.click();
            setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) {} }, 1000);
            toast('已导出聊天美化方案文件');
          } catch (e) { toast('导出文件失败'); }
        } else if (v === 'text') {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(json).then(() => toast('已复制到剪贴板，发给对方粘贴导入')).catch(() => toast('复制失败，请改用导出文件'));
          } else { toast('剪贴板不可用，请改用导出文件'); }
        }
      }, {
        noInput: true,
        staticText: '选择导出方式：\n· 导出文件：自动弹分享/保存框（iPhone 主屏安装时用这个），不支持时确认后下载，可保存或发送\n· 复制文字：复制配置文本，发给对方粘贴导入',
        pills: [
          { label: '导出文件', value: 'file' },
          { label: '复制文字', value: 'text' },
        ],
      });
    };
    // 无已保存方案时直接导出当前设置
    if (!schemes.length || !window.openModal) { doExport(collectChatBeauty()); return; }
    const pills = [{ label: '当前设置', value: 'current' }]
      .concat(schemes.map((s, i) => ({ label: s.name || ('方案' + (i + 1)), value: 'sch_' + i })));
    window.openModal('导出聊天美化方案', '', (v) => {
      let data;
      if (v && v.indexOf('sch_') === 0) {
        const i = parseInt(String(v).slice(4), 10);
        const s = schemes[i];
        if (!s) { toast('未找到该方案'); return; }
        data = s.data || {};
      } else {
        data = collectChatBeauty();
      }
      doExport(data);
    }, {
      noInput: true,
      staticText: '选择要导出的聊天美化方案：\n· 当前设置：导出当前正在使用的聊天美化\n· 已保存方案：导出对应方案（含气泡/壁纸/字体）',
      pills: pills,
    });
  }
  // v3.26.x：聊天美化方案导入——粘贴文本/选文件 → 校验 → 应用到当前聊天（与桌面美化导入一致）
  function chatSchemeImport() {
    if (!window.openModal) return;
    window.openModal('导入聊天美化方案', '', (v) => {
      // #408：原「空文本静默 return」＝安卓 ce-box 读到空时导入「无反应」——补提示
      if (!v || !v.trim()) { toast('请先粘贴方案文本，或点「从文件导入」选择 .json 文件'); return; }
      try {
        // #408：粘贴/文件导入统一走自救解析（安卓各机型浏览器粘贴链路会弄脏 JSON，实现见 personalize.js）
        const data = window.mochiParsePastedJSON(v);
        // FIX 2026-09-15 #527：用途校验 + 命中项数如实反馈（原实现无条件报「已导入」）
        if (chatBeautyKindMismatch(data)) {
          toast('这份方案不是聊天美化方案（' + data.__kind__ + '），请到对应页面导入');
          return;
        }
        const hit = recognizeChatBeauty(data);
        if (!hit) {
          toast('这份数据里没有识别到聊天美化项，请确认是聊天美化方案');
          return;
        }
        const bk = chatBackupBeforeImport();
        const n = applyChatBeautyData(data);
        toast('已导入 ' + n + ' 项，当前聊天立即生效' + (bk ? '（原美化已存为「' + bk + '」）' : ''));
        window.openChatBeautySchemes();
      } catch (e) {
        // #408：带出真实原因 + 失败现场写诊断（跨域改动，同族修复见 personalize.js）
        const _sv = String(v || '');
        try { if (window.__jsErrors) window.__jsErrors.push('[聊天美化导入] ' + ((e && e.message) || e) + ' | 收到长度=' + _sv.length + ' | 开头: ' + _sv.replace(/[\uFEFF\u200B-\u200F]/g, '').slice(0, 100)); } catch (e1) {}
        toast('解析失败：' + ((e && e.message) || '请检查文本'));
      }
    }, { textarea: true, textareaPlaceholder: '粘贴对方导出的聊天美化方案文本，或点下方「从文件导入」选择 .json 文件', txtImport: true });
  }
  // v3.25.x：方案缩略图——按方案数据渲染迷你聊天气泡预览
  function chatSchemeThumb(data) {
    data = data || {};
    const inBg = data['cs-in-bg'] || '#ffffff';
    const inInk = data['cs-in-ink'] || '#111111';
    const outBg = data['cs-out-bg'] || '#111111';
    const outInk = data['cs-out-ink'] || '#ffffff';
    const r = (parseInt(data['cs-bubble-radius'] || '18px', 10) || 18) / 2;
    const tl = Math.max(0, Math.min(9, Math.round(r)));
    const bg = data['cs-bg'] || '';
    const hasCss = !!data['cs-bubble-css'];
    const wall = bg
      ? '<div style="position:absolute;inset:0;background-image:url(&quot;' + bg + '&quot;);background-size:cover;background-position:center;opacity:.4"></div>'
      : '';
    const cssChip = hasCss
      ? '<div style="position:absolute;left:5px;bottom:4px;font-size:9px;color:#fff;background:rgba(0,0,0,.5);padding:1px 5px;border-radius:5px">CSS</div>'
      : '';
    return '' +
      '<div style="position:relative;width:100%;height:64px;border-radius:9px;overflow:hidden;background:#e6e9ee;display:flex;align-items:center;padding:8px 10px;box-sizing:border-box;gap:5px">' +
      wall +
      '<div style="position:relative;align-self:flex-end;padding:4px 8px;border-radius:' + tl + 'px;font-size:10px;line-height:1.2;color:' + inInk + ';background:' + inBg + ';box-shadow:0 1px 2px rgba(0,0,0,.08);max-width:56%">对方</div>' +
      '<div style="margin-left:auto;position:relative;align-self:flex-start;padding:4px 8px;border-radius:' + tl + 'px;font-size:10px;line-height:1.2;color:' + outInk + ';background:' + outBg + ';box-shadow:0 1px 2px rgba(0,0,0,.08);max-width:56%">我的</div>' +
      cssChip +
      '</div>';
  }
  // v3.25.x：当前聊天美化的文字摘要 chips（气泡色/圆角/字号/CSS/壁纸/头像形状/时间轴）
  function chatBeautySummary(data) {
    data = data || {};
    const out = [];
    const inBg = data['cs-in-bg'], outBg = data['cs-out-bg'];
    if (inBg || outBg) out.push('气泡色 ' + (inBg || '默认') + ' / ' + (outBg || '默认'));
    const rad = data['cs-bubble-radius'] || '18px';
    const rn = BUBBLE_RADII.find(p => p.value === rad);
    out.push('圆角 ' + (rn ? rn.label : rad));
    const fs = data['cs-font-size'] || '14px';
    const fnl = FONT_SIZES.find(p => p.value === fs);
    out.push('字号 ' + (fnl ? fnl.label : fs));
    if (data['cs-bubble-css']) out.push('自定义CSS');
    if (data['cs-bg']) out.push('壁纸');
    const av = data['cs-av-shape'];
    if (av) out.push('头像 ' + ({ circle: '圆形', round: '圆角', square: '方形' }[av] || av));
    return out;
  }
  // 保存方案的确认弹窗：实时预览 + 当前设置摘要 + 命名（可视可确认再存）
  function chatSaveModalEl() {
    let m = document.getElementById('chat-beauty-save-modal');
    if (!m) {
      m = document.createElement('div'); m.id = 'chat-beauty-save-modal'; m.hidden = true;
      m.style.cssText = 'position:fixed;inset:0;z-index:90;align-items:center;justify-content:center;background:rgba(0,0,0,.4);display:none';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m) { m.style.display = 'none'; m.hidden = true; } });
    }
    return m;
  }
  window.saveChatBeautyScheme = function () {
    const x = chatSaveModalEl();
    x.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'box-sizing:border-box;width:min(84vw,340px);max-height:84vh;overflow-y:auto;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:16px;box-shadow:0 14px 40px rgba(0,0,0,.25)';
    const hd = document.createElement('div');
    hd.style.cssText = 'font-size:15px;font-weight:700;text-align:center;margin-bottom:12px';
    hd.textContent = '保存当前为聊天美化方案';
    const data = collectChatBeauty();
    const pv = document.createElement('div');
    pv.innerHTML = chatSchemeThumb(data);
    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:10.5px;color:var(--muted,#999);margin:8px 0 6px';
    sub.textContent = '正在保存的当前设置：';
    const sum = document.createElement('div');
    sum.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px';
    const chips = chatBeautySummary(data);
    if (!chips.length) { const e = document.createElement('span'); e.textContent = '以上传壁纸/气泡等设置为主'; e.style.cssText = 'font-size:10.5px;color:var(--muted,#999)'; sum.appendChild(e); }
    else chips.forEach(c => { const el = document.createElement('span'); el.textContent = c; el.style.cssText = 'font-size:10.5px;color:var(--muted,#666);background:var(--card-soft,#f2f3f5);border:1px solid var(--card-border,#eee);padding:2px 8px;border-radius:999px'; sum.appendChild(el); });
    const inp = document.createElement('input');
    inp.placeholder = '例如：简约白、情侣粉气泡…'; inp.maxLength = 20;
    inp.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 11px;font-size:13px;border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--bg-b,#fff);color:var(--ink,#111)';
    const act = document.createElement('div');
    act.style.cssText = 'display:flex;gap:8px;margin-top:13px;justify-content:flex-end';
    const cancel = mkBtn('取消', 'font-size:12.5px;padding:7px 14px;border:1px solid var(--card-border,#eee);border-radius:9px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)', () => { x.style.display = 'none'; x.hidden = true; });
    const ok = mkBtn('保存方案', 'font-size:12.5px;padding:7px 14px;border:none;border-radius:9px;background:var(--ink,#111);color:#fff', () => {
      const name = (inp.value || '').trim();
      if (!name) { inp.style.borderColor = '#e05a5a'; return; }
      const list = getChatSchemes();
      list.push({ name, time: Date.now(), data });
      saveChatSchemesList(list);
      x.style.display = 'none'; x.hidden = true;
      toast('已保存方案「' + name + '」，所有桌面通用');
      const m = document.getElementById('chat-beauty-scheme-manager');
      if (m && !m.hidden) window.openChatBeautySchemes();
    });
    act.appendChild(cancel); act.appendChild(ok);
    wrap.appendChild(hd); wrap.appendChild(pv); wrap.appendChild(sub); wrap.appendChild(sum); wrap.appendChild(inp); wrap.appendChild(act);
    x.appendChild(wrap);
    x.style.display = 'flex'; x.hidden = false;
    setTimeout(() => { try { inp.focus(); } catch (e) {} }, 60);
  };
  // v3.25.x：聊天方案预览——暂存当前聊天美化 → 应用所选方案（即时生效，可还原）
  let chatPreviewBackup = null;
  function chatPreviewBarEl() {
    let bar = document.getElementById('chat-beauty-preview-bar');
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'chat-beauty-preview-bar';
      bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:96;margin:12px;padding:12px 14px;background:var(--card-bg,#fff);color:var(--ink,#111);border:1px solid var(--card-border,#eee);border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.25);display:none;align-items:center;gap:10px';
      document.body.appendChild(bar);
    }
    return bar;
  }
  function chatStartPreview(s, m) {
    if (!s) return;
    chatPreviewBackup = collectChatBeauty();
    hideChatSchemeModal(m);
    applyChatBeautyData(s.data || {});
    const bar = chatPreviewBarEl();
    bar.innerHTML = '';
    const tx = document.createElement('div'); tx.style.flex = '1'; tx.style.fontSize = '13px';
    tx.innerHTML = '正在预览「<b>' + s.name + '</b>」<div style="font-size:11px;color:var(--muted,#999)">去聊天页查看效果，点「使用」保存 / 「还原」恢复</div>';
    const re = mkBtn('还原', 'font-size:12px;padding:6px 12px;border:1px solid var(--card-border,#eee);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)', () => {
      if (chatPreviewBackup) applyChatBeautyData(chatPreviewBackup);
      chatPreviewBackup = null; bar.style.display = 'none'; toast('已还原');
    });
    const keep = mkBtn('使用这个方案', 'font-size:12px;padding:6px 12px;border:none;border-radius:8px;background:var(--ink,#111);color:var(--bg-b,#fff)', () => {
      chatPreviewBackup = null; bar.style.display = 'none'; toast('已应用「' + s.name + '」');
    });
    bar.appendChild(tx); bar.appendChild(re); bar.appendChild(keep);
    bar.style.display = 'flex';
  }
  // v3.25.x：重命名聊天方案
  function renameChatScheme(idx, m) {
    const list = getChatSchemes();
    const s = list[idx];
    if (!s || !window.openModal) return;
    const ctl = window.openModal('编辑方案名称', s.name, (name) => {
      name = (name || '').trim();
      if (!name) { ctl.hint('名称不能为空'); ctl.stay(); return; }
      s.name = name; saveChatSchemesList(list); toast('已重命名');
      window.openChatBeautySchemes();
    }, { maxlength: 20, placeholder: '输入方案名称' });
  }
  window.openChatBeautySchemes = function () {
    const m = chatSchemeModalEl();
    m.innerHTML = '';
    const box = document.createElement('div');
    box.style.cssText = 'width:min(92vw,420px);max-height:80vh;display:flex;flex-direction:column;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:18px;box-shadow:0 8px 30px rgba(0,0,0,.2)';
    const head = document.createElement('div');
    head.innerHTML = '<div style="font-size:16px;font-weight:600;margin-bottom:4px">聊天美化方案</div><div style="font-size:12px;color:var(--muted,#888);margin-bottom:12px">方案在所有联系人桌面通用（含气泡颜色/CSS、背景图、字体、时间轴等），点「应用」一键切换当前聊天外观</div>';
    box.appendChild(head);
    const list = document.createElement('div'); list.className = 'cm-list';
    list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-bottom:12px;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;flex:1;min-height:0';
    const schemes = getChatSchemes();
    if (!schemes.length) {
      const empty = document.createElement('div');
      empty.innerHTML = '<div style="font-size:13px;color:var(--muted,#999);text-align:center;padding:20px 0">还没有保存的聊天美化方案<br>先点下方「保存当前为方案」</div>';
      list.appendChild(empty);
    }
    schemes.forEach((s, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px';
      const th = document.createElement('div');
      th.innerHTML = chatSchemeThumb(s.data || {});
      row.appendChild(th);
      const nm = document.createElement('div');
      const t = new Date(s.time || Date.now());
      const ds = (t.getMonth() + 1) + '-' + t.getDate();
      nm.innerHTML = '<div style="font-size:14px;font-weight:600;word-break:break-all">' + s.name + '</div><div style="font-size:11px;color:var(--muted,#999)">保存于 ' + ds + '</div>';
      row.appendChild(nm);
      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;align-items:center;gap:7px;flex-wrap:wrap';
      btns.appendChild(mkBtn('预览', 'font-size:12px;padding:4px 10px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111)', () => chatStartPreview(s, m)));
      btns.appendChild(mkBtn('应用', 'font-size:12px;padding:4px 10px;border:none;border-radius:8px;background:var(--ink,#111);color:var(--bg-b,#fff)', () => applyChatScheme(i, m)));
      btns.appendChild(mkBtn('改名', 'font-size:12px;padding:4px 10px;border:1px solid var(--card-border,#ddd);border-radius:8px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111)', () => renameChatScheme(i, m)));
      btns.appendChild(mkBtn('删除', 'font-size:12px;padding:4px 10px;border:1px solid rgba(163,45,45,.35);border-radius:8px;background:var(--danger-soft,#fff5f5);color:var(--danger-ink,#a32d2d)', () => deleteChatScheme(i, m)));
      row.appendChild(btns);
      list.appendChild(row);
    });
    box.appendChild(list);
    // v3.26.x：导出/导入聊天美化方案
    const opera = document.createElement('div');
    opera.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
    const exBtn = mkBtn('导出方案', 'flex:1;padding:10px;border:1px solid var(--card-border,#ddd);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:13px;font-weight:600', () => chatSchemeExport());
    const imBtn = mkBtn('导入方案', 'flex:1;padding:10px;border:1px solid var(--card-border,#ddd);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--ink,#111);font-size:13px;font-weight:600', () => chatSchemeImport());
    opera.appendChild(exBtn); opera.appendChild(imBtn);
    box.appendChild(opera);
    const save = document.createElement('button');
    save.textContent = '+ 保存当前为方案';
    save.style.cssText = 'width:100%;padding:12px;border:none;border-radius:10px;background:var(--ink,#111);color:var(--bg-b,#fff);font-size:14px;font-weight:600';
    save.addEventListener('click', () => { window.saveChatBeautyScheme(); });
    box.appendChild(save);
    const close = document.createElement('button');
    close.textContent = '关闭';
    close.style.cssText = 'width:100%;margin-top:8px;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)';
    close.addEventListener('click', () => hideChatSchemeModal(m));
    box.appendChild(close);
    m.appendChild(box);
    m.style.display = 'flex'; m.hidden = false;
  };
  const chatBeautySaveRow = document.getElementById('row-chat-beauty-save');
  if (chatBeautySaveRow) chatBeautySaveRow.addEventListener('click', () => window.saveChatBeautyScheme());
  const chatBeautySchemesRow = document.getElementById('row-chat-beauty-schemes');
  if (chatBeautySchemesRow) chatBeautySchemesRow.addEventListener('click', () => window.openChatBeautySchemes());

  // 聊天设置页：顶部标签切换（美化 / 功能 / 数据），复用 .them-tabs/.them-sec 结构互斥显示
  (function initChatSettingsTabs() {
    const tabsEl = document.getElementById('cs-tabs');
    const page = document.getElementById('page-chat-settings');
    if (!tabsEl || !page) return;
    const tabs = tabsEl.querySelectorAll('.them-tab');
    const secs = page.querySelectorAll('.them-sec');
    function show(name) {
      secs.forEach(s => { s.hidden = (s.dataset.sec !== name); });
      tabs.forEach(t => { t.classList.toggle('active', t.dataset.tab === name); });
    }
    tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));
    show(tabs[0] ? tabs[0].dataset.tab : 'beautify');
  })();

  // v3.29.x：功能页二级 tag 分类——点击 tag 只显示对应分组（gs-title/set-group 成对 data-tag）。
  // v3.34.x：去掉「全部」tab 后，进页即按默认选中项过滤（不再默认全显）；过滤抽成 applyFilter，
  // 初始化与点击共用。既有 verify 运行时锚（按 id/文本定位）不受影响——被隐藏的分组仍可 querySelector 到。
  (function initCsFuncTags() {
    const tagsEl = document.getElementById('cs-func-tags');
    const page = document.getElementById('page-chat-settings');
    if (!tagsEl || !page) return;
    const sec = page.querySelector('.them-sec[data-sec="function"]');
    if (!sec) return;
    const pairs = Array.from(sec.querySelectorAll('.gs-title[data-tag], .set-group[data-tag]'));
    function applyFilter(ft) {
      pairs.forEach(el => { el.hidden = (ft !== 'all' && el.dataset.tag !== ft); });
    }
    tagsEl.addEventListener('click', (e) => {
      const t = e.target.closest('.them-tab');
      if (!t) return;
      tagsEl.querySelectorAll('.them-tab').forEach(x => x.classList.toggle('active', x === t));
      applyFilter(t.dataset.ft || 'all');
    });
    const def = tagsEl.querySelector('.them-tab.active');
    applyFilter(def ? (def.dataset.ft || 'all') : 'all');
  })();

  // ================= 导出 / 导入聊天记录（数据，与清空同组） =================
  // 导出：打包为独立 JSON 下载（聊天记录可能含图片 dataURL，体积大也直接下载，不走 localStorage）
  const csExport = row('cs-export-msgs');
  if (csExport) {
    csExport.addEventListener('click', () => {
      if (!window.chatExportMsgs && !window.getChatMsgs) { toast('聊天记录暂不可用'); return; }
      toast('正在导出，请稍候…');
      try {
        if (window.chatFlushSave) window.chatFlushSave();
        // v3.26.x：getChatMsgs 取引用免 slice 复制 950MB（slice 会使堆翻倍 OOM）
        const arr = window.getChatMsgs ? window.getChatMsgs() : window.chatExportMsgs();
        const n = Array.isArray(arr) ? arr.length : 0;
        if (!n) { toast('没有聊天记录可导出'); return; }
        // v3.26.x：流式构建 JSON——每条消息单独 stringify 放进 Blob 数组拼接，
        // 避免单次 JSON.stringify 整包超 V8 字符串长度上限（~512MB）报 Invalid string length
        const parts = ['{"app":"mochi-zika-chat","version":"1.0","exportTime":"' + new Date().toISOString() + '","msgs":['];
        for (let i = 0; i < n; i++) {
          if (i) parts.push(',');
          parts.push(JSON.stringify(arr[i]));
        }
        parts.push(']}');
        const blob = new Blob(parts, { type: 'application/json;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '聊天记录_' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        toast('已导出 ' + n + ' 条聊天记录');
      } catch (e) {
        toast('导出失败：' + (e && e.message || '未知错误'));
      }
    });
  }
  // 导入：读取 JSON → 校验 → 预览摘要二次确认 → 覆盖当前记录
  const csImport = row('cs-import-msgs');
  if (csImport) {
    csImport.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = () => {
        const f = input.files && input.files[0];
        if (!f) return;
        // FileReader 全兼容（旧 iOS File.text() 不支持）
        const reader = new FileReader();
        reader.onload = () => {
          let data;
          try { data = JSON.parse(String(reader.result || '')); } catch (e) { toast('无效的聊天记录文件'); return; }
          if (!data || typeof data !== 'object') { toast('无效的聊天记录文件'); return; }
          // 兼容三种结构：本功能导出的 {app,msgs} / 裸数组 / 整份 mochi 备份（取其中聊天记录）
          let arr = Array.isArray(data) ? data : null;
          if (!arr && data.msgs && Array.isArray(data.msgs)) arr = data.msgs;
          if (!arr && data.ls && typeof data.ls === 'object') {
            const raw = (data.idb && data.idb['xy-home-v2:chat-msgs']) || data.ls['xy-home-v2:chat-msgs'];
            try { arr = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { arr = null; }
          }
          if (!Array.isArray(arr) || !arr.length) { toast('文件里没有聊天记录数据'); return; }
          const n = arr.length;
          const fmt = (t) => t ? new Date(t).toLocaleString() : '未知';
          const lines = ['文件包含 ' + n + ' 条消息：',
            '· 最早：' + fmt(arr[0] && arr[0].ts),
            '· 最新：' + fmt(arr[n - 1] && arr[n - 1].ts),
            '导入将覆盖当前全部聊天记录（不可恢复）。'];
          if (!window.openModal) return;
          window.openModal('确认导入聊天记录？', '', () => {
            if (window.chatImportMsgs && window.chatImportMsgs(arr)) toast('已导入 ' + n + ' 条聊天记录');
            else toast('导入失败');
          }, { noInput: true, staticText: lines.join('\n') });
        };
        reader.onerror = () => { toast('文件读取失败，请重试'); };
        reader.readAsText(f, 'utf-8');
      };
      input.click();
    });
  }

  // v3.36.x：#471 设置页「导出/导入全部桌面聊天记录」——导出与顶部备份提醒条「备份聊天」
  // 同入口（runChatAllExport 复用 doExport('chat')，CHAT_KEY_RE 匹配全部桌面命名空间）；
  // 导入支持标准 mochi 备份文件（按桌面 key 分路写回各桌面）与单桌 {app,msgs} 文件
  //（归入当前桌面），由 data-backup.js 的 runChatAllImport 负责读文件+预览+确认+写回。
  const csExportAll = row('cs-export-all');
  if (csExportAll) {
    csExportAll.addEventListener('click', () => {
      if (!window.runChatAllExport) { toast('导出功能暂不可用'); return; }
      window.runChatAllExport();
    });
  }
  const csImportAll = row('cs-import-all');
  if (csImportAll) {
    csImportAll.addEventListener('click', () => {
      if (!window.runChatAllImport) { toast('导入功能暂不可用'); return; }
      window.runChatAllImport();
    });
  }

  // ================= 删除全部聊天记录（危险操作，二次确认） =================
  const csClear = row('cs-clear-msgs');
  if (csClear) {
    csClear.addEventListener('click', () => {
      if (!window.openModal) return;
      window.openModal('确认删除全部聊天记录？（双方所有消息将被清空，且不可恢复）', '', () => {
        if (window.clearChatHistory) window.clearChatHistory();
        toast('聊天记录已清空');
      }, { noInput: true });
    });
  }

  // v3.5.93：聊天壁纸/上传字体等大键可能只存在 IndexedDB（导入兜底写入/大键只进 IDB）——
  // 启动时从 IDB 补读后重新应用
  try {
    if (window.idbGet) {
      const myPrefix = window.activePrefix();
      window.idbGet(myPrefix + ':cs-bg').then(v => {
        if (window.activePrefix() !== myPrefix) return;
        if (v && typeof v === 'string' && v.length > 2 && !store.get('cs-bg')) {
          store.set('cs-bg', v);
          applySettings();
        }
      });
      window.idbGet(myPrefix + ':' + FONT_KEY).then(v => {
        if (window.activePrefix() !== myPrefix) return;
        if (v && typeof v === 'string' && v.length > 2 && !store.get(FONT_KEY)) {
          store.set(FONT_KEY, v);
          applyFont();
        }
      });
      // v3.14.x：气泡 CSS 同款兜底——LS 写失败（配额满）或被浏览器清理后值只剩 IDB 副本，
      // boot 时 applyCss 跑在回填前读空 → 重进后退回默认气泡（荣耀200Pro Edge 实测）。
      // 启动补读 + 重应用（applyCss 幂等）
      window.idbGet(myPrefix + ':' + CSS_KEY).then(v => {
        if (window.activePrefix() !== myPrefix) return;
        if (v && typeof v === 'string' && v.length > 0 && !store.get(CSS_KEY)) {
          store.set(CSS_KEY, v);
          applyCss();
        }
      });
    }
  } catch (e) {}
  // v3.7.x 修复：上传字体 dataURL 属大键（>200KB）只进 IDB+memoryCache、localStorage 被删，
  //   刷新后 memoryCache 清空。本文件初始化时同步调用的 applyFont() 已跑过（当时无数据），
  //   上方 idbGet 补读又被 !store.get() 条件跳过（idbRestore 先回填 memoryCache 时）→
  //   字体刷新后不应用。数据就绪后兜底再应用一次（applyFont 幂等，重复调用安全）
  document.addEventListener('mochi-restore-done', function () {
    try { applyFont(); } catch (e) {}
    try { applyProfile(); } catch (e) {}
    // v3.14.x：气泡 CSS 补应用——boot 时 applyCss 跑在 IDB 回填完成前（值只在 IDB 时
    // 读空不注入），字体/头像此前有本兜底而气泡 CSS 漏了 → 重进后回退默认气泡。
    // applyCss 幂等：会话内已写入时 memoryCache 值更新，重应用无副作用
    try { applyCss(); } catch (e) {}
  });
  // v3.6.x：多桌面——切换联系人后重新应用聊天美化（壁纸/气泡颜色/字号/形状按新桌面）
  // v3.9.x 修复：气泡 CSS / 全局字体也是按联系人存储（cs-bubble-css / cs-font），
  // 但注入的 <style>（cs-bubble-style / cs-font-style）是全局标签，切换联系人后必须
  // 一并重应用/清除，否则 A 桌面的自定义气泡样式/字体会一直盖在 B 桌面上（改一个
  // 联系人所有联系人的气泡都跟着变）。
  document.addEventListener('contact-switched', function () {
    try { applySettings(); } catch (e) {}
    try { applyProfile(); } catch (e) {}
    try { applyCss(); } catch (e) {}
    try { applyFont(); } catch (e) {}
  });

  // ===== v3.26.x：镜像开关轮询合并为单一 ticker（iOS 卡顿收口）=====
  // 下方六处「聊天设置页 ⇄ 设置页/存储」镜像开关各写了一个 setInterval(sync,500)，
  // 且句柄全部丢弃（永不可清）——boot 起常驻 6 个定时器，每秒 12 次读 checkbox /
  // localStorage，不管用户在不在这一页。合并成一个共享 ticker：
  //   · 仅在 #page-chat-settings 未 hidden 且文档 visible 时运行，离页/切后台即停；
  //   · 进页当帧先跑一次（不等 500ms，避免开关显示滞后）；
  //   · contact-switched（按桌面存的值会变）立即补跑一次。
  const _csTicker = { fns: [], timer: 0 };
  function csAddSync(fn) { _csTicker.fns.push(fn); }
  function _csRun() {
    for (let i = 0; i < _csTicker.fns.length; i++) { try { _csTicker.fns[i](); } catch (e) {} }
  }
  function _csTickOn() {
    if (_csTicker.timer) return;
    _csRun();
    _csTicker.timer = setInterval(_csRun, 500);
  }
  function _csTickOff() {
    if (_csTicker.timer) { clearInterval(_csTicker.timer); _csTicker.timer = 0; }
  }
  (function () {
    const page = document.getElementById('page-chat-settings');
    if (!page) return;
    const want = () => {
      if (!page.hidden && document.visibilityState === 'visible') _csTickOn();
      else _csTickOff();
    };
    try { new MutationObserver(want).observe(page, { attributes: true, attributeFilter: ['hidden'] }); } catch (e) {}
    document.addEventListener('visibilitychange', want);
    document.addEventListener('contact-switched', function () { if (_csTicker.timer) _csRun(); });
    want();
  })();

  // v3.7.x：聊天设置顶部的「全屏模式」开关——镜像设置页 #sf-fullscreen（同一状态）。
  // 本页切换 → 代理到设置页开关并派发 change（走 fullscreen.js 全流程：原生全屏/CSS
  // 兜底/iOS 分支/失败回滚）；设置页或系统（fullscreenchange/切后台恢复/失败回滚）
  // 更新 sf-fullscreen 后，轮询把状态同步回本页开关。fullscreen.js 程序化赋值只改
  // property 不产生 attribute mutation，故用 500ms 轮询而非 MutationObserver。
  const csFs = document.getElementById('cs-fullscreen');
  const sfFs = document.getElementById('sf-fullscreen');
  if (csFs && sfFs) {
    const syncCsFs = () => { if (sfFs.checked !== csFs.checked) csFs.checked = sfFs.checked; };
    syncCsFs();
    csFs.addEventListener('change', () => {
      if (csFs.checked === sfFs.checked) return;
      sfFs.checked = csFs.checked;
      sfFs.dispatchEvent(new Event('change', { bubbles: true }));
    });
    csAddSync(syncCsFs);
  }

  // v3.9.x：聊天设置「全屏边缘防误触」开关——镜像设置页 #sf-edge-guard（同一状态双向同步）。
  // 仿 cs-fullscreen 模式：本页切换代理到设置页开关并派发 change（走 fullscreen.js
  // 边缘拦截层启停流程）；设置页变化 500ms 轮询同步回本页。
  const csEg = document.getElementById('cs-edge-guard');
  const sfEg = document.getElementById('sf-edge-guard');
  if (csEg && sfEg) {
    const syncCsEg = () => { if (sfEg.checked !== csEg.checked) csEg.checked = sfEg.checked; };
    syncCsEg();
    csEg.addEventListener('change', () => {
      if (csEg.checked === sfEg.checked) return;
      sfEg.checked = csEg.checked;
      sfEg.dispatchEvent(new Event('change', { bubbles: true }));
    });
    csAddSync(syncCsEg);
  }

  // v3.7.x：聊天设置「隐藏音乐悬浮小窗」开关——与音乐页 #music-float-en / 音乐设置
  // #sm-set-float 同源（music-global.floatEn，每桌面独立）。本开关语义反转：勾选=隐藏，
  // 与「隐藏通话小框」一致（音乐页/音乐设置里仍是勾选=开启）。本文件先于 music-player.js
  // 加载，故优先走 window.musicFloatGet/Set 钩子（完整走保存+悬浮框渲染流程）；
  // 钩子未就绪时退化为直读写 store（切换桌面/初始态兜底，浮框由音乐模块下次渲染兜住）。
  const csMf = document.getElementById('cs-music-float');
  if (csMf) {
    const mfGet = () => { // 返回「隐藏中」= !floatEn；floatEn 默认开 → 默认不隐藏
      if (window.musicFloatGet) return !window.musicFloatGet();
      try {
        const s = JSON.parse(store.get('music-global') || '{}');
        return s.floatEn !== undefined ? !s.floatEn : false;
      } catch (e) { return false; }
    };
    const mfSet = (hide) => {
      if (window.musicFloatSet) { window.musicFloatSet(!hide); return; }
      try {
        const s = JSON.parse(store.get('music-global') || '{}');
        s.floatEn = !hide;
        store.set('music-global', JSON.stringify(s));
      } catch (e) {}
    };
    const syncCsMf = () => { const v = mfGet(); if (v !== csMf.checked) csMf.checked = v; };
    syncCsMf();
    csMf.addEventListener('change', () => {
      if (csMf.checked === mfGet()) return;
      mfSet(csMf.checked);
      toast(csMf.checked ? '音乐悬浮小窗已隐藏：播放时不再显示右上角悬浮小框' : '音乐悬浮小窗已恢复显示：播放时右上角出现悬浮小框');
    });
    // 音乐页/音乐设置/桌面部件改动或切桌面后 500ms 内同步回本页开关
    csAddSync(syncCsMf);
    document.addEventListener('contact-switched', syncCsMf);
  }

  // v3.7.x：聊天设置「隐藏通话小框」开关——与通话半框/通话模块同源
  // （call-mini-enabled，每桌面独立，默认显示小框）。本开关语义反转：勾选=隐藏。
  // 优先走 window.getCallMiniEnabled/setCallMiniEnabled 钩子（call.js 暴露）；
  // 钩子未就绪时退化为直读写 store（call-mini-enabled !== '0' 即显示）。
  const csCmh = document.getElementById('cs-call-mini-hide');
  if (csCmh) {
    const cmhGet = () => {
      if (window.getCallMiniEnabled) return !window.getCallMiniEnabled();
      try { return store.get('call-mini-enabled') === '0'; } catch (e) { return false; }
    };
    const cmhSet = (hide) => {
      if (window.setCallMiniEnabled) { window.setCallMiniEnabled(!hide); return; }
      try { store.set('call-mini-enabled', hide ? '0' : '1'); } catch (e) {}
    };
    const syncCsCmh = () => { const v = cmhGet(); if (v !== csCmh.checked) csCmh.checked = v; };
    syncCsCmh();
    csCmh.addEventListener('change', () => {
      if (csCmh.checked === cmhGet()) return;
      cmhSet(csCmh.checked);
      toast(csCmh.checked ? '通话小框已隐藏：接通后保持通话面板，不弹出悬浮小框' : '通话小框已开启：接通后自动最小化为悬浮小框');
    });
    csAddSync(syncCsCmh);
    document.addEventListener('contact-switched', syncCsCmh);
  }

  // v3.8.x：主设置页「开启群聊」开关——每桌面独立（group-chat-enabled，默认关闭）。
  // 开启后桌面聊天按钮右侧显示「群聊」按钮、占卜按钮隐藏（移到隐藏池，可在装修模式添加到其他页）；
  // 关闭恢复原样。写回后广播 group-chat-mode-changed 事件，personalize.js 响应调整桌面图标。
  const sfGc = document.getElementById('sf-group-chat');
  if (sfGc) {
    // v3.10.x：群聊是全局功能（消息/形象/回复设置均全局存根命名空间），开关也改为
    // 全局存储——原按每桌面隔离（activeStore），切换到新桌面读不到该键→群聊按钮自己
    // 消失（用户反馈"开启群聊后切换桌面没保存"）。读时回退旧版每桌面值完成迁移。
    const GNS = 'xy-home-v2';
    const gcGet = () => {
      try { const v = window.xyStore ? window.xyStore(GNS).get('group-chat-enabled') : null; if (v !== null && v !== undefined) return v === '1'; } catch (e) {}
      try { return store.get('group-chat-enabled') === '1'; } catch (e) { return false; }
    };
    const gcSet = (en) => { try { if (window.xyStore) window.xyStore(GNS).set('group-chat-enabled', en ? '1' : '0'); } catch (e) {} };
    const syncGc = () => { const v = gcGet(); if (v !== sfGc.checked) sfGc.checked = v; };
    syncGc();
    sfGc.addEventListener('change', () => {
      if (sfGc.checked === gcGet()) return;
      gcSet(sfGc.checked);
      try { document.dispatchEvent(new Event('group-chat-mode-changed')); } catch (e) {}
      toast(sfGc.checked ? '群聊已开启：桌面新增群聊按钮，占卜按钮已隐藏（可在美化装修模式添加到其他页面）' : '群聊已关闭，占卜按钮已恢复');
    });
    csAddSync(syncGc);
    document.addEventListener('contact-switched', syncGc);
  }

  // v3.10.x：「允许删除联系人消息」开关——默认关闭，每联系人独立。开启后点击 TA 消息
  // 弹出的操作菜单里多出「删除」按钮，可永久移除该条 TA 消息（真删除，不可恢复）。
  const csDtm = document.getElementById('cs-del-ta-msg');
  if (csDtm) {
    const dtmGet = () => { try { return store.get('cs-del-ta-msg') === '1'; } catch (e) { return false; } };
    const dtmSet = (en) => { try { store.set('cs-del-ta-msg', en ? '1' : '0'); } catch (e) {} };
    const syncDtm = () => { const v = dtmGet(); if (v !== csDtm.checked) csDtm.checked = v; };
    syncDtm();
    csDtm.addEventListener('change', () => {
      if (csDtm.checked === dtmGet()) return;
      dtmSet(csDtm.checked);
      toast(csDtm.checked ? '已开启：点击联系人消息可在操作菜单里删除该条消息' : '已关闭删除联系人消息功能');
    });
    document.addEventListener('contact-switched', syncDtm);
  }

  // v3.11.x：「批量发送消息」开关——默认关闭，每联系人独立。开启后聊天输入栏右侧显示
  // 「批量发送」按钮：可插入表情包/图片/文字，每个项目一条消息，多条按顺序批量发送。
  // 存 cs-batch-send，chat.js 读同一键控制按钮显隐。
  const csBs = document.getElementById('cs-batch-send');
  if (csBs) {
    const bsGet = () => { try { return store.get('cs-batch-send') === '1'; } catch (e) { return false; } };
    const bsSet = (en) => { try { store.set('cs-batch-send', en ? '1' : '0'); } catch (e) {} };
    const syncBs = () => { const v = bsGet(); if (v !== csBs.checked) csBs.checked = v; };
    syncBs();
    csBs.addEventListener('change', () => {
      if (csBs.checked === bsGet()) return;
      bsSet(csBs.checked);
      // 通知聊天页即时刷新「批量发送」按钮显隐（不依赖切联系人）
      try { document.dispatchEvent(new Event('batch-send-changed')); } catch (e) {}
      toast(csBs.checked ? '已开启：聊天输入栏右侧显示「批量发送」按钮，可插入表情包/图片/文字批量发送' : '已关闭：聊天输入栏「批量发送」按钮已隐藏');
    });
    document.addEventListener('contact-switched', syncBs);
  }

  // v3.16.x：「我可发送语音」开关——默认关闭，每联系人独立。开启后聊天输入栏左侧显示
  // 「麦克风」按钮：点击打开录音半框，录完可试听并作为语音消息发送进聊天。
  // 存 cs-voice-send，chat.js 读同一键控制按钮显隐与录音逻辑。
  const csVs = document.getElementById('cs-voice-send');
  if (csVs) {
    const vsGet = () => { try { return store.get('cs-voice-send') === '1'; } catch (e) { return false; } };
    const vsSet = (en) => { try { store.set('cs-voice-send', en ? '1' : '0'); } catch (e) {} };
    const syncVs = () => { const v = vsGet(); if (v !== csVs.checked) csVs.checked = v; };
    syncVs();
    csVs.addEventListener('change', () => {
      // v3.26.x：去掉「与存储值相同则静默早退」守卫——idbRestore 异步回填 memoryCache
      // 晚于本模块初始化时，存储值可能是回填进来的旧值而开关 UI 未重同步（荣耀/Edge 杀
      // 进程回滚 LS 场景，见 idb.js 小键写日志），第一次点按会被守卫静默吃掉，表现为
      // 「点一次没反应，点第二次才生效」。change 只由用户点按触发，直接按 UI 状态写入。
      vsSet(csVs.checked);
      // 通知聊天页即时刷新「麦克风」按钮显隐（不依赖切联系人）
      try { document.dispatchEvent(new Event('voice-send-changed')); } catch (e) {}
      toast(csVs.checked ? '已开启：聊天输入栏左侧显示「麦克风」按钮，点击可录音并发送语音' : '已关闭：聊天输入栏「麦克风」按钮已隐藏');
    });
    document.addEventListener('contact-switched', syncVs);
    // v3.26.x：启动回填/写日志合并把存储值修正后，重同步开关 UI（含已打开的设置页）
    document.addEventListener('mochi-wrj-heal', syncVs);
  }

  // 红包：TA 自动主动发红包概率（每联系人独立，默认 4%，0-100%）。点击弹输入框设百分比；
  // 存 cs-rp-auto-prob，chat.js trySystemAutoSend 读同一键控制 TA 主动发红包的概率门。
  const csRpProb = row('cs-rp-auto-prob');
  if (csRpProb) {
    const rpProbGet = () => {
      let v = null; try { v = parseFloat(store.get('cs-rp-auto-prob')); } catch (e) {}
      return (v !== null && isFinite(v)) ? Math.max(0, Math.min(100, Math.round(v))) : 4;
    };
    const rpProbSync = () => { const el = document.getElementById('cs-rp-auto-prob-val'); if (el) el.textContent = rpProbGet() + '%'; };
    rpProbSync();
    csRpProb.addEventListener('click', () => {
      if (!window.openModal) return;
      window.openModal('TA 自动发红包概率（0-100%·每联系人独立）', String(rpProbGet()), (v) => {
        const t = String(v || '').trim();
        let n = parseFloat(t);
        if (!isFinite(n)) n = 4;
        n = Math.max(0, Math.min(100, Math.round(n)));
        store.set('cs-rp-auto-prob', String(n));
        rpProbSync();
        toast('已设置：TA 自动发红包概率为 ' + n + '%');
      }, { maxlength: 3 });
    });
    document.addEventListener('contact-switched', rpProbSync);
    // v3.29.x：红包设置已移入聊天页红包半框（#chat-rp-panel「设置」按钮），聊天设置页
    // ticker 不再同步；改由 chat.js openRpPanel() 调用 window.csRpSettingsSync 主动同步。
    if (typeof window !== 'undefined') window.csRpSyncProb = rpProbSync;
  }

  // v3.28.x：TA 每日发红包上限次数（每联系人独立，默认 5，0=不限）。存 cs-rp-daily-max，
  // chat.js trySystemAutoSend 读同一键做当日自动发红包次数闸门。
  const csRpDailyMax = row('cs-rp-daily-max');
  if (csRpDailyMax) {
    const rpMaxGet = () => {
      let v = null; try { v = parseInt(store.get('cs-rp-daily-max'), 10); } catch (e) {}
      return (v !== null && isFinite(v) && v >= 0) ? v : 5;
    };
    const rpMaxSync = () => { const el = document.getElementById('cs-rp-daily-max-val'); if (el) el.textContent = rpMaxGet() === 0 ? '不限' : rpMaxGet() + ' 次'; };
    rpMaxSync();
    csRpDailyMax.addEventListener('click', () => {
      if (!window.openModal) return;
      window.openModal('TA 每日发红包上限（0-99 次·0=不限）', String(rpMaxGet()), (v) => {
        let n = parseInt(String(v || '').trim(), 10);
        if (!isFinite(n)) n = 5;
        n = Math.max(0, Math.min(99, n));
        store.set('cs-rp-daily-max', String(n));
        rpMaxSync();
        toast(n === 0 ? '已设置：TA 每日发红包不限次数' : '已设置：TA 每天最多发 ' + n + ' 个红包');
      }, { maxlength: 2 });
    });
    document.addEventListener('contact-switched', rpMaxSync);
    // v3.29.x：组合同步入口，供红包半框打开时一次刷新两个显示值（见上方 csRpSyncProb）。
    if (typeof window !== 'undefined') {
      window.csRpSyncMax = rpMaxSync;
      window.csRpSettingsSync = function () {
        try { if (window.csRpSyncProb) window.csRpSyncProb(); } catch (e) {}
        try { if (window.csRpSyncMax) window.csRpSyncMax(); } catch (e) {}
      };
    }
  }

  // v3.12.x：「隐藏联系人的表情包」开关——默认关闭，全局生效（存根命名空间，与
  // my-emoji-groups 全局化同口径：聊天/朋友圈表情包面板是跨桌面共用 UI，不随桌面切换）。
  // 开启后聊天与朋友圈的表情包面板只显示「我的表情包」，不再显示 TA 的/公用表情包。
  // 写回后广播 hide-ta-sticker-changed 事件，chat.js 即时重渲染面板；feed.js 每次打开时读键。
  const csHts = document.getElementById('cs-hide-ta-sticker');
  if (csHts) {
    const GNS = 'xy-home-v2';
    const KEY = 'hide-ta-sticker';
    const htsGet = () => {
      try { if (window.xyStore) return window.xyStore(GNS).get(KEY) === '1'; } catch (e) {}
      try { return store.get(KEY) === '1'; } catch (e) { return false; }
    };
    const htsSet = (en) => { try { if (window.xyStore) window.xyStore(GNS).set(KEY, en ? '1' : '0'); } catch (e) {} };
    const syncHts = () => { const v = htsGet(); if (v !== csHts.checked) csHts.checked = v; };
    syncHts();
    csHts.addEventListener('change', () => {
      if (csHts.checked === htsGet()) return;
      htsSet(csHts.checked);
      try { document.dispatchEvent(new Event('hide-ta-sticker-changed')); } catch (e) {}
      toast(csHts.checked ? '已隐藏：聊天和朋友圈的表情包面板只显示「我的表情包」' : '已恢复显示 TA 的和公用表情包');
    });
    csAddSync(syncHts);
    document.addEventListener('contact-switched', syncHts);
  }
})();
