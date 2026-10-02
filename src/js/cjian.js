// ===== 此间：梦角世界时间与在场感知（v3.13.x 重设计；v3.14.x 按桌面分组） =====
// 核心哲学：
//   时间不是纯随机——梦角世界时间 = 现实时间 + 偏移，连续流动（按十二时辰+初/正展示）；
//   刷新机制本质是随机——状态不是模拟出来的，是每个梦角【自己随机选择】的：
//   冷却过了就重新选一次（受世界时辰加权 / 最近互动加权约束，但选择本身是随机抽取）。
// 双维状态：在场（很近/附近/遥远/感觉不到/离开）+ 空闲（有空/有事/忙着/休息/睡着/未知）。
// v3.14.x 分组：梦角名单/状态按桌面（联系人）命名空间分离——每个桌面有自己的梦角，
//   页内顶部 chips 可直接切换查看别的桌面的梦角，「全部」总览一次看完全部梦角状态。
//   存量全局键迁移进当前桌面（合并去重，绝不丢数据）；梦角档案（memo-arc）改为
//   合并读取各桌面名单，档案仍全局共享不受影响。键形 xy-home-v2:<cid>:cjian-*，
//   命中 contacts.js 命名空间排除规则，不会被 migrateLegacy 误迁。
// v3.14.x 修复（数据串桌）：① 迁移不再把整份旧名单塞给「升级时激活的桌面」——梦角名
//   精确匹配唯一桌面 TA 身份（lbl-partner/联系人名）的归该桌面，认不到的才归当前桌面；
//   ② 一次性存量纠偏 rehomeMisfiled（标记 xy-home-v2:cjian-rehome-v1）：把早期错放进
//   别桌面的梦角搬回同名 TA 的桌面（状态随迁；同名冲突仅当外来者带互动痕迹而家里那位
//   没有——家里那位多半是自动播种的幻影——才替换）；③ 播种时机从「启动给每个桌面都种
//   一个」改为「首次打开该桌面的此间才种」——老版会在用户从没碰过的桌面凭空造出以联系
//   人命名的梦角，是「不同联系人数据串了/全是一个联系人名字」观感的另一半来源。
(function () {
  const G = 'xy-home-v2';
  const ROSTER_KEY = 'cjian-roster';
  const STATE_KEY = 'cjian-state';
  const SEED_KEY = 'cjian-seeded';
  const REHOME_KEY = 'cjian-rehome-v1'; // 存量纠偏一次性标记（根键，已登记 contacts.js EXCLUDE）
  const ALL = '__all__'; // 总览模式：一次查看全部桌面的全部梦角

  function rootStore() {
    try { return window.xyStore(G); } catch (e) { return null; }
  }
  function curCid() { return window.__activeCid || 'default'; }
  function storeOf(cid) {
    try { return window.xyStore(G + ':' + (cid || 'default')); } catch (e) { return null; }
  }
  function contacts() {
    try {
      const a = window.getContacts ? window.getContacts() : null;
      if (Array.isArray(a) && a.length) return a;
    } catch (e) {}
    return [{ id: 'default', name: '默认' }];
  }
  function contactName(cid) {
    const c = contacts().find(x => x.id === cid);
    return (c && c.name) || '默认';
  }
  function toast(t) { if (typeof window.toast === 'function') window.toast(t); }
  function rand(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  // v3.16.x 时辰区间：openModal 的 pills 是单选（互斥高亮），时辰需要多选——
  // 时辰多选阶段由 cjianManage 自建全屏遮罩 #cj-slot-mask（独立于通用弹窗，不入侵 personalize）。
  function showSlotPicker(selIdx, onDone, onCancel, onSkip) {
    try {
      const old = document.getElementById('cj-slot-mask');
      if (old) old.remove();
    } catch (e) {}
    const m = document.createElement('div');
    m.id = 'cj-slot-mask';
    m.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(10,10,20,.52);display:flex;align-items:center;justify-content:center;padding:18px;';
    const box = document.createElement('div');
    box.style.cssText = 'width:100%;max-width:330px;background:var(--card-bg);border:1px solid var(--card-border);border-radius:16px;padding:18px 16px 14px;box-shadow:0 12px 40px var(--shadow-strong);';
    const h = document.createElement('div');
    h.style.cssText = 'font-weight:700;font-size:15px;margin-bottom:4px;text-align:center;color:var(--ink);';
    h.textContent = 'TA 常在哪些时辰出现？';
    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:12px;color:var(--muted);margin-bottom:10px;text-align:center;';
    sub.textContent = '可多选 · 至少选一个 · 世界时间只在这些时辰里随机';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px;';
    const st = {};
    selIdx.forEach(i => { st[i] = true; });
    const chipBase = 'padding:9px 0;border-radius:999px;border:1px solid var(--pill-border);background:var(--static-bg);color:var(--soft-ink);font-size:13px;';
    const chipOn = 'padding:9px 0;border-radius:999px;border:1px solid #ffb454;background:#ffe1a8;color:#5a3d00;font-size:13px;font-weight:700;';
    SHICHEN.forEach((name, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = name + '时';
      b.style.cssText = st[i] ? chipOn : chipBase;
      b.addEventListener('click', () => {
        if (st[i]) { delete st[i]; b.style.cssText = chipBase; }
        else { st[i] = true; b.style.cssText = chipOn; }
      });
      grid.appendChild(b);
    });
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:10px;';
    const cn = document.createElement('button');
    cn.type = 'button';
    cn.textContent = '取消';
    cn.style.cssText = 'flex:1;padding:10px 0;border-radius:10px;border:1px solid var(--pill-border);background:var(--btn-cancel-bg);color:var(--btn-cancel-ink);font-size:14px;';
    cn.addEventListener('click', () => { try { m.remove(); } catch (e) {} if (onCancel) onCancel(); });
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = '确定';
    ok.style.cssText = 'flex:1;padding:10px 0;border-radius:10px;border:none;background:#ff9f43;color:#fff;font-size:14px;font-weight:700;';
    ok.addEventListener('click', () => {
      const idxs = Object.keys(st).map(Number).sort((a, b) => a - b);
      if (!idxs.length) { const w = document.createElement('div'); w.style.cssText = 'font-size:12px;color:#d9534f;margin:-8px 0 10px;text-align:center;'; w.textContent = '至少选一个时辰'; box.insertBefore(w, btns); return; }
      try { m.remove(); } catch (e) {}
      if (onDone) onDone(idxs);
    });
    btns.appendChild(cn); btns.appendChild(ok);
    box.appendChild(h); box.appendChild(sub); box.appendChild(grid); box.appendChild(btns);
    if (onSkip) {
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.textContent = '不限定 · 用时间偏移';
      skip.style.cssText = 'margin-top:10px;width:100%;padding:8px 0;border:none;background:none;color:var(--soft-ink);font-size:12px;text-align:center;text-decoration:underline;';
      skip.addEventListener('click', () => { try { m.remove(); } catch (e) {} if (onSkip) onSkip(); });
      box.appendChild(skip);
    }
    m.appendChild(box);
    document.body.appendChild(m);
  }
  // v3.15.x：感知播报句走字卡库【系统预设字卡→此间】同源池（DEFAULT_CARD_DATA.cjian，
  // dc-off-cjian:* 过滤已关卡片，全关回退内置兜底）——与 room/garden 同模式
  function cjLine(group, fallbackArr) {
    // v3.32.x #132：此间字卡概率接 dcf-cjian（默认 100=原行为，0=感知播报不出字卡，
    // 此时回退 fallbackArr 首条都不发，返回空串由调用方拼进原句式为空）
    try { if (window.dcfGet && !(Math.random() * 100 < window.dcfGet('cjian'))) return ''; } catch (e) {}
    let pool = fallbackArr;
    try {
      const lib = window.getLibPool ? window.getLibPool('cjian', group, null) : null;
      const arr = (lib || []).filter(t => !(window.isDefaultCardOff && window.isDefaultCardOff('cjian', t)));
      if (arr.length) pool = arr;
    } catch (e) {}
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ---- 十二时辰 ----
  const SHICHEN = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  const SHICHEN_START = [23, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21];
  function shichenStartHour(i) { return SHICHEN_START[i % 12]; }
  function shichenAt(hour) { return Math.floor(((hour + 1) % 24) / 2); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  // v3.16.x：时辰区间（slots）——梦角可设定「常在哪些时辰出现」，世界时间只在
  // 所选时辰里随机生成；无 slots 的老梦角沿用旧行为（现实+偏移连续流动）。
  // slots 存 roster 条目的 startH 数组（各时辰起始整点，覆盖含初/正的整两小时）。
  function slotMinuteRange(startH) {
    return (startH * 60) + Math.floor(Math.random() * 120); // 时辰起始整点 + 0..119 分钟（覆盖初/正）
  }
  function slotLabel(arr) {
    arr = Array.isArray(arr) ? arr : [];
    if (!arr.length) return '';
    const sorted = arr.slice().sort((a, b) => a - b);
    return sorted.map(h => SHICHEN[shichenAt(h)] + '时').join('·');
  }
  // 有 slots：世界时间（分钟）在所选时辰里随机；无 slots：现实+偏移连续流动。
  // 这是"抽一次"的原始计算：外部经 worldMinuteOf 持久化后再取用——世界时间不再
  // 每次打开此间就重新随机，而是抽一个存住、1–8 小时才重新抽（见下方 ottFor）。
  function worldMinuteOfRaw(c) {
    const slots = c && c.slots;
    if (Array.isArray(slots) && slots.length) {
      const s = slots[Math.floor(Math.random() * slots.length)];
      return slotMinuteRange(s);
    }
    const off = (c && c.offsetMin) || 0;
    const d = new Date(Date.now() + off * 60000);
    return d.getHours() * 60 + d.getMinutes();
  }
  // ===== 梦角世界时间持久化（抽一次存住，1–8 小时才重抽） =====
  // 需求：带时辰区间（slots）的梦角世界时间每次重开网页都会跳（worldMinuteOfRaw 每次都
  // Math.random()）。改为与「对方当前时间」同一刷新哲学：抽一个世界时刻存住，last/next
  // 时间戳持久化，冷却过了才重新抽。键形 xy-home-v2:cjian-ott（根级，key=梦角id，
  // value={worldMin,last,next}）；梦角 id 全局唯一（makeId），跨桌面搬移/增删不受影响。
  // 注意：「今日」轴的预测随机保持原样——每打开一次此间仍重新重掷，不受本机制约束。
  let ottCache = null;
  function loadOtt() {
    try {
      const r = rootStore();
      if (!r) return null;
      const v = r.get('cjian-ott');
      if (v) { const o = JSON.parse(v); if (o && typeof o === 'object') return o; }
    } catch (e) {}
    return null;
  }
  function saveOtt(o) { try { const r = rootStore(); if (r) r.set('cjian-ott', JSON.stringify(o)); } catch (e) {} }
  function ottFor(c) {
    const now = Date.now();
    if (!ottCache) ottCache = loadOtt() || {};
    const t = ottCache[c.id];
    let last = (t && typeof t.last === 'number') ? t.last : 0;
    let next = (t && typeof t.next === 'number') ? t.next : 0;
    if (last > now || last < 0 || isNaN(last)) { last = 0; next = 0; }
    if (!t || (now - last) / 36e5 >= next) {
      ottCache[c.id] = { worldMin: worldMinuteOfRaw(c), last: now, next: 1 + Math.random() * 7 };
      saveOtt(ottCache);
    }
    return ottCache[c.id];
  }
  function worldMinuteOf(c) { return ottFor(c).worldMin; }
  // 删除梦角时清掉其持久化世界时间，避免留孤儿数据
  function clearOttTag(id) { if (ottCache && ottCache[id]) { delete ottCache[id]; saveOtt(ottCache); } }
  // #903：时段设定变动后失效「对方当前时间」的已抽结果（<cid>:cjian-ta-time）——已抽时刻
  // 按 1–8 小时冷却驻留，用户改完时辰区间/增删梦角后卡片仍显示老时辰的旧时刻＝
  // 「设置的时间与显示的时辰区间对不上」。删键＝下次渲染立即按新设定重抽。
  function invalidateTaTime(cid) { try { const s = storeOf(cid); if (s) s.remove('cjian-ta-time'); } catch (e) {} }
  function timeInfo(ts) {
    const d = new Date(ts);
    const hour = d.getHours();
    const idx = shichenAt(hour);
    const startH = shichenStartHour(idx);
    const mInto = hour * 60 + d.getMinutes() - startH * 60; // 进入时辰的分钟数 0..119
    let half, range;
    if (mInto < 30) {
      half = SHICHEN[idx] + '初';
      range = pad(startH) + ':00–' + pad(startH) + ':29';
    } else if (mInto < 90) {
      half = SHICHEN[idx] + '正';
      range = pad(startH) + ':30–' + pad((startH + 1) % 24) + ':29';
    } else {
      half = SHICHEN[idx] + '正';
      range = pad((startH + 1) % 24) + ':30–' + pad((startH + 1) % 24) + ':59';
    }
    return { idx: idx, half: half, range: range, hhmm: pad(hour) + ':' + pad(d.getMinutes()) };
  }
  // v3.x 改：展示用世界时间戳改为基于持久化世界分钟（worldMinuteOf），与状态概率所取的
  // 世界时间一致，且 1–8 小时才变，不再每次打开此间就跳。
  function worldNowFor(c) {
    const wm = worldMinuteOf(c);
    const d = new Date();
    d.setHours(Math.floor(wm / 60), wm % 60, 0, 0);
    return d.getTime();
  }
  function offsetLabel(off) {
    if (!off) return '与现实同步';
    if (off % 60 === 0) return off > 0 ? ('比现实快' + (off / 60) + '小时') : ('比现实慢' + (-off / 60) + '小时');
    return '独立时间流';
  }
  // v3.16.x：梦角世界时间展示标签——slots 显示时辰区间，否则显示偏移
  function worldTagLabel(c) {
    if (Array.isArray(c && c.slots) && c.slots.length) {
      const sd = slotLabel(c.slots);
      return c.offsetMin ? (sd + ' · ' + offsetLabel(c.offsetMin)) : sd;
    }
    return offsetLabel(c.offsetMin);
  }

  // v3.16.x：测试/运维钩子（同 cjianRefresh 先例，导出纯函数供专项验证与诊断）
  window.cjianWorldMinuteOf = worldMinuteOf;
  window.cjianWorldNowFor = worldNowFor;
  window.cjianShichenAt = shichenAt;

  // ---- 状态定义 ----
  const PRESENCE = {
    near:   { label: '很近',     desc: '感觉就在身边' },
    nearby: { label: '附近',     desc: 'TA可能就在附近' },
    far:    { label: '遥远',     desc: '能感觉到，但距离很远' },
    unfelt: { label: '感觉不到', desc: '暂时无法感知TA' },
    gone:   { label: '离开',     desc: 'TA暂时不在附近' }
  };
  const ACTIVITY = {
    free:    { label: '有空', desc: '现在比较适合交流' },
    busy:    { label: '有事', desc: 'TA正在做自己的事情' },
    rushed:  { label: '忙着', desc: '暂时不太方便' },
    rest:    { label: '休息', desc: 'TA正在休息' },
    sleep:   { label: '睡着', desc: 'TA那边已经入睡' },
    unknown: { label: '未知', desc: '暂时不知道TA在做什么' }
  };

  // ---- 存储（按桌面命名空间分离） ----
  function loadRoster(cid) {
    try {
      const s = storeOf(cid);
      if (!s) return [];
      const v = s.get(ROSTER_KEY);
      if (v) {
        const a = JSON.parse(v);
        if (Array.isArray(a)) return a.filter(x => x && x.name && x.id);
      }
    } catch (e) {}
    return [];
  }
  function saveRoster(list, cid) {
    try { storeOf(cid).set(ROSTER_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function loadState(cid) {
    try {
      const s = storeOf(cid);
      if (!s) return {};
      const v = s.get(STATE_KEY);
      if (v) { const o = JSON.parse(v); if (o && typeof o === 'object') return o; }
    } catch (e) {}
    return {};
  }
  function saveState(st, cid) {
    try { storeOf(cid).set(STATE_KEY, JSON.stringify(st)); } catch (e) {}
  }
  function makeId() { return 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

  // ---- TA 身份与归属判定 ----
  // 桌面的「TA 身份」：lbl-partner（聊天设置里的 TA 昵称）优先，注册表联系人名兜底——
  // 与 v3.13 给梦角取名同源。梦角名精确等于某桌面的 TA 身份 → 那个桌面就是它的家。
  function taIdentity(cid) {
    let idn = '';
    try { idn = String(storeOf(cid).get('lbl-partner') || '').trim(); } catch (e) {}
    if (!idn) {
      const c = contacts().find(x => x.id === cid);
      idn = String((c && c.name) || '').trim();
    }
    return idn;
  }
  // 名字 → 唯一归属桌面：恰好一个桌面的 TA 身份与其同名才认（0 个或多个同名都不算，宁不搬不错搬）
  function homeCidForName(name) {
    const n = String(name || '').trim();
    if (!n) return '';
    let hit = '', hits = 0;
    contacts().forEach(ct => {
      const idn = taIdentity(ct.id);
      const cn = contactName(ct.id);
      if (idn === n || cn === n) { hit = ct.id; hits++; }
    });
    return hits === 1 ? hit : '';
  }

  // ---- 存量迁移：旧版全局键 → 各桌面（按名认亲 + 合并去重，幂等，绝不丢数据） ----
  // v3.14.x 修复（数据串桌）：老版把整份旧名单塞给「当前桌面」——多联系人用户升级后，
  // 属于不同 TA 的梦角全部挤在一个联系人名下（用户反馈「不同联系人的数据串了，全部显示
  // 为一个联系人名字」）。现改为按名认亲：梦角名精确匹配唯一桌面 TA 身份的归该桌面
  // （状态随迁），认不到的才归当前桌面。若目标桌面已有名单（如 IDB 回填迟到导致迁移跑过
  // 又见到根键），按 id 并集合入，之后清掉根键——memo-arc 已兼容根键残留，不受影响。
  function migrateSplit() {
    const r = rootStore();
    if (!r) return;
    // v3.33.x #409：注册表未就绪闸（LS 失效设备 IDB 回填未完成时 contacts() 只有 default
    // 兜底）——此时按名认亲必认错，还会把错桌面固化进 cid 字段并清掉根键，restore-done
    // 重跑扑空后错放永久化。未就绪本轮直接不跑：根键保留，等 mochi-restore-done/下次启动重试。
    if (!r.get('contacts')) return;
    let gr = null, gs = null;
    try { const v = r.get(ROSTER_KEY); gr = v ? JSON.parse(v) : null; } catch (e) {}
    try { const v = r.get(STATE_KEY); gs = v ? JSON.parse(v) : null; } catch (e) {}
    const gseed = r.get(SEED_KEY);
    const grArr = Array.isArray(gr) ? gr.filter(x => x && x.name && x.id) : [];
    const gsObj = (gs && typeof gs === 'object') ? gs : {};
    if (!grArr.length && !Object.keys(gsObj).length) { if (gseed) r.remove(SEED_KEY); return; }
    const cur = curCid();
    const plan = {}; // cid -> { add: [], state: {} }
    grArr.forEach(x => {
      const target = homeCidForName(x.name) || cur;
      x.cid = target; // 显式归属，后续不再靠名字认亲（防改名/同名导致串桌）
      const p = plan[target] || (plan[target] = { add: [], state: {} });
      p.add.push(x);
      if (gsObj[x.id]) p.state[x.id] = gsObj[x.id];
    });
    if (gseed && !plan[cur]) plan[cur] = { add: [], state: {} }; // 旧播种标记也要落位，防当前桌面之后重复播种
    const targets = Object.keys(plan);
    for (let i = 0; i < targets.length; i++) {
      if (!storeOf(targets[i])) return; // 任一目标桌不可写：整批保留根键，下次启动重试
    }
    targets.forEach(cid => {
      const s = storeOf(cid);
      const p = plan[cid];
      const nsList = loadRoster(cid);
      const have = {};
      nsList.forEach(x => { have[x.id] = 1; });
      const add = p.add.filter(x => !have[x.id]);
      if (add.length) {
        const st = loadState(cid);
        add.forEach(x => { if (p.state[x.id]) st[x.id] = p.state[x.id]; });
        saveRoster(nsList.concat(add), cid);
        saveState(st, cid);
      }
      if (gseed || nsList.length || add.length) s.set(SEED_KEY, '1');
    });
    r.remove(ROSTER_KEY); r.remove(STATE_KEY); r.remove(SEED_KEY);
  }

  // ---- 存量纠偏（一次性）：把早期错放进别桌面的梦角搬回同名 TA 的桌面 ----
  // 修复对象：v3.14 早期迁移「一锅端给当时激活桌面」造成的错放。判定与迁移同源：梦角名
  // 精确匹配唯一桌面 TA 身份 → 那里是它的家。家里已有同名梦角时不搬，唯一例外：外来者
  // 带互动痕迹（感知/聊天/打开过此间）而家里那位没有——家里那位多半是老版启动时自动播种
  // 的幻影——才用外来者替换（连同状态与梦角档案）。标记幂等只跑一次，之后用户手动放在
  // 别桌面的同名梦角绝不乱动。注册表未就绪（IDB 回填未完成）时本轮不跑也不标记。
  function rehomeMisfiled() {
    const r = rootStore();
    if (!r || r.get(REHOME_KEY)) return;
    let regOk = false;
    try { regOk = !!window.xyStore(G).get('contacts'); } catch (e) {}
    if (!regOk) return;
    const idents = {};
    contacts().forEach(ct => { idents[ct.id] = taIdentity(ct.id); });
    const rosters = {}, states = {};
    const moves = [];
    contacts().forEach(ct => {
      const list = loadRoster(ct.id);
      if (!list.length) return;
      rosters[ct.id] = list;
      list.forEach(c => {
        const n = String(c.name || '').trim();
        if (!n || n === idents[ct.id]) return; // 已在同名身份桌面：不动
        let home = '', hits = 0;
        contacts().forEach(o => { if (idents[o.id] === n) { home = o.id; hits++; } });
        if (hits !== 1 || home === ct.id) return;
        moves.push({ from: ct.id, to: home, id: c.id, name: c.name });
      });
    });
    if (moves.length) {
      moves.forEach(m => {
        if (!rosters[m.to]) rosters[m.to] = loadRoster(m.to);
        if (!states[m.from]) states[m.from] = loadState(m.from);
        if (!states[m.to]) states[m.to] = loadState(m.to);
      });
      moves.forEach(m => {
        const src = rosters[m.from], dst = rosters[m.to];
        const i = src.findIndex(x => x.id === m.id);
        if (i < 0) return;
        if (dst.some(x => x.id === m.id)) return;
        const twin = dst.find(x => x.name === m.name);
        if (twin) {
          const stFrom = states[m.from], stTo = states[m.to];
          const mMark = stFrom[m.id] && (stFrom[m.id].lastPerceive || stFrom[m.id].__chat || stFrom[m.id].__open);
          const tMark = stTo[twin.id] && (stTo[twin.id].lastPerceive || stTo[twin.id].__chat || stTo[twin.id].__open);
          if (!mMark || tMark) return; // 分不清真身/幻影：宁留错位不删真身
          dst.splice(dst.indexOf(twin), 1);
          delete stTo[twin.id];
          // 被替换的幻影若挂有梦角档案，顺手清掉不留孤儿（narc-cur 档案页会自愈，这里清干净）
          try {
            r.remove('narc-' + twin.id);
            if ((r.get('narc-cur') || '') === twin.id) r.remove('narc-cur');
          } catch (e) {}
        }
        const c = src.splice(i, 1)[0];
        dst.push(c);
        if (states[m.from][m.id] !== undefined) {
          states[m.to][m.id] = states[m.from][m.id];
          delete states[m.from][m.id];
        }
      });
      Object.keys(rosters).forEach(cid => {
        saveRoster(rosters[cid], cid);
        if (states[cid]) saveState(states[cid], cid);
      });
      todayCacheMap = {}; // 名单归属变了，各视图的今日预测全部作废
      try { if (typeof window.renderCjian === 'function') window.renderCjian(false); } catch (e) {}
    }
    r.set(REHOME_KEY, '1');
  }

  // ---- 归属纠偏（幂等，启动 + IDB 就绪后跑）----
  // 给梦角补显式 cid 归属字段，并把物理存错桌面的梦角搬回 storeOf(cid)。
  // 取代靠名字认亲的脆弱性：多个联系人 TA 昵称同名 / lbl-partner 与联系人名不一致时，
  // migrateSplit 可能认不到家把梦角一锅端给当前桌面，rehomeMisfiled 因"已在同名桌面"不纠正。
  // 这里按 cid 字段权威归属：无 cid 的按名字认亲补 cid（认不到的固化在当前桌面），
  // 有 cid 但物理存错桌面的搬到 storeOf(cid)。幂等：搬过后 cid=所在桌面，下次不动。
  function fixBelonging() {
    const r = rootStore();
    if (!r) return;
    let regOk = false;
    try { regOk = !!r.get('contacts'); } catch (e) {}
    if (!regOk) return; // 注册表未就绪：contacts() 不全，等 mochi-restore-done
    const cidSet = {};
    contacts().forEach(ct => { cidSet[ct.id] = 1; });
    // v3.33.x #409（多联系人名字串桌根治）：按名认亲从「每次启动都跑」降级为「一次性存量
    // 救回」（标记 xy-home-v2:cjian-belong-v2，全局根键已登记 contacts.js EXCLUDE）。原实现
    // 每次启动都用梦角名覆盖显式 cid 归属——只要梦角名与任一联系人 TA 身份（lbl-partner/
    // 注册名）唯一撞名，就每次启动被强行搬去那个桌面：典型触发=联系人改名后旧名被新联系人
    // 认领、或用户把梦角改成了别的联系人的名字；用户删掉重加同一名，下次启动又被搬走，
    // 表现为「不同联系人此间名字串了、反复出现、多机型都有」（纯逻辑 bug，与设备无关）。
    // 标记落盘后 cid 字段权威：梦角留在被创建/最后一次确认的桌面，仅保留物理错位自愈；
    // 存量错放数据在标记前的那一次跑里仍按名救回（老设备升级一次性纠偏，语义同 rehome-v1）。
    const rescueOnce = !r.get('cjian-belong-v2');
    // 第一遍：补 cid 字段，收集需搬移的梦角
    const moves = []; // {from, to, id, name}
    contacts().forEach(ct => {
      const list = loadRoster(ct.id);
      if (!list.length) return;
      let dirty = false;
      list.forEach(c => {
        // 归属判定：仅首次跑新版时按名认亲救存量错放；此后 cid 权威——认不到家的梦角
        // 固化在物理所在桌面，绝不因撞名反复搬移（根治「串桌反复出现」）。
        let home = '';
        if (rescueOnce) home = homeCidForName(c.name);
        if (!home) home = (c.cid && cidSet[c.cid]) ? c.cid : '';
        const target = home || ct.id;
        if (c.cid !== target) { c.cid = target; dirty = true; }
        if (c.cid !== ct.id) moves.push({ from: ct.id, to: c.cid, id: c.id, name: c.name });
      });
      if (dirty) saveRoster(list, ct.id);
    });
    if (rescueOnce) { try { r.set('cjian-belong-v2', '1'); } catch (e) {} } // 救回只跑一次：标记落盘在注册表就绪的成功路径上
    if (!moves.length) return;
    // 第二遍：执行搬移（批量加载，避免遍历时修改）
    const rosters = {}, states = {};
    moves.forEach(m => {
      if (!rosters[m.from]) rosters[m.from] = loadRoster(m.from);
      if (!rosters[m.to]) rosters[m.to] = loadRoster(m.to);
      if (!states[m.from]) states[m.from] = loadState(m.from);
      if (!states[m.to]) states[m.to] = loadState(m.to);
    });
    moves.forEach(m => {
      const src = rosters[m.from], dst = rosters[m.to];
      const i = src.findIndex(x => x.id === m.id);
      if (i < 0) return;
      if (dst.some(x => x.id === m.id)) return; // 目标已有同 id：跳过
      const twin = dst.find(x => x.name === m.name && (!x.cid || x.cid === m.to));
      if (twin) {
        // 同名冲突：外来者带互动痕迹而家里那位没有才替换（家里那位多半是自动播种的幻影）
        const stFrom = states[m.from], stTo = states[m.to];
        const mMark = stFrom[m.id] && (stFrom[m.id].lastPerceive || stFrom[m.id].__chat || stFrom[m.id].__open);
        const tMark = stTo[twin.id] && (stTo[twin.id].lastPerceive || stTo[twin.id].__chat || stTo[twin.id].__open);
        if (!mMark || tMark) return; // 分不清真身/幻影：宁留错位不删真身
        dst.splice(dst.indexOf(twin), 1);
        delete stTo[twin.id];
        try {
          r.remove('narc-' + twin.id);
          if ((r.get('narc-cur') || '') === twin.id) r.remove('narc-cur');
        } catch (e) {}
      }
      const c = src.splice(i, 1)[0];
      c.cid = m.to;
      dst.push(c);
      if (states[m.from][m.id] !== undefined) {
        states[m.to][m.id] = states[m.from][m.id];
        delete states[m.from][m.id];
      }
    });
    Object.keys(rosters).forEach(cid => {
      saveRoster(rosters[cid], cid);
      if (states[cid]) saveState(states[cid], cid);
    });
    todayCacheMap = {};
    try { const pg = document.getElementById('page-cjian'); if (pg && !pg.hidden && typeof window.renderCjian === 'function') window.renderCjian(false); } catch (e) {}
  }

  // 首次使用：该桌面第一次打开此间时，用 TA 的名字种下自己的第一个梦角
  //（v3.14.x 修复：不再在启动时给【每个】桌面都种——老版会在用户从没碰过的桌面凭空
  // 造出以联系人命名的梦角，看起来像别人的数据串了进来）
  function seedIfEmpty(cid) {
    try {
      // #850：回填未完成不播种——「cjian-seeded 读空」可能只是键还没回来，此时播种会
      // saveRoster 整包覆盖＝真实梦角名单被新种的本尊顶掉（LS 失效/回填迟到设备必现）。
      // 让位给 boot 的 mochi-restore-done 补跑（见下方迁移监听器）
      if (window.mochiDataPending && window.mochiDataPending()) return; // #850e 回填未决＝不算没播种
      const s = storeOf(cid);
      if (!s || s.get(SEED_KEY)) return;
      const list = loadRoster(cid);
      if (list.length) { s.set(SEED_KEY, '1'); return; }
      // v3.33.x #409：播种名走 effective 昵称链。2026-09-16（#616 用户要求）把顺序倒过来：
      // 桌面 lbl-partner 优先、聊天 cs-lbl-partner 兜底——此间属于「其他功能」，昵称池频繁
      // 轮换的聊天昵称不该带着梦角名一起变；桌面没设过时仍退回聊天昵称（#409 要解决的
      // 「只设了聊天昵称时梦角名与聊天对不上」照旧兜住，见下方 effNick 同口径）。
      // FIX 2026-09-18 #786b：取值链收进 effNick 一处（含「昵称撞了别的桌面的身份名就退回
      // 本桌名片名」），新种下的本尊不会一出生就挂着另一个联系人的名字。
      const name = effNick(cid);
      list.push({ id: makeId(), name: name || 'TA', offsetMin: 0, cid: cid, own: 1 });
      saveRoster(list, cid);
      s.set(SEED_KEY, '1');
    } catch (e) {}
  }

  // FIX 2026-09-15 #514 此间梦角归属自愈（多桌面「名字串桌」根治·存量救济层）
  // 症状（用户报）：顶部 tag 切到桌面【景元】，卡片「查看TA的一天」左边的名字却是另一个
  //   桌面联系人【应星】的梦角名；多机型同现（纯逻辑，与设备/内核无关）。
  // 成因：早期版本按名认亲搬移 + 「认不到家就归当前桌面」把 A 桌面的梦角物理搬进 B 桌面
  //   命名空间，并把错误归属固化进梦角 cid 字段；#409 把按名认亲降级为「一次性救回」后
  //   cid 字段成为权威，已错放的数据再也回不来＝「一直存在、反复出现」。
  // 判定（严格，宁不搬不错搬）：① 带 manual 标记（用户在梦角管理里手动添加/改名）的梦角
  //   永不自动搬；② 梦角名必须落在「它物理所在桌面」的全部身份标识之外；③ 且精确命中
  //   「唯一另一个桌面」的身份标识（0 个=无名可归、多个=撞名，都不搬）；④ 目标桌面已有
  //   同名梦角则跳过（不制造重复）。身份链与 seedIfEmpty 播种链同源：
  //   lbl-partner（桌面昵称）→ cs-lbl-partner（聊天独立昵称）→ 联系人名片名。
  //   2026-09-16（#616）：顺序倒成桌面优先——这个值既是「本尊名字漂移对齐」的目标（见①，
  //   会把自动播种的梦角名纠成它），也是此间卡片显示的名字，属「其他功能」，不该跟着
  //   昵称池轮换的聊天昵称变。identSet 仍同时收两个键（那是身份**集合**，用于认亲，
  //   多收不多伤：名字是按旧聊天昵称播种出来的存量梦角照样认得出归属）。
  // FIX 2026-09-18 #786b：某个名字是否已被【另一个桌面】认作身份（名片名 / 桌面 TA 昵称 /
  // 聊天 TA 昵称任一）——三源与 identSet 同源。用于挡住「本尊名挂着别的联系人的名字」。
  function otherClaimsName(cid, name) {
    const n = String(name || '').trim();
    if (!n) return false;
    const list = contacts();
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o || o.id === cid) continue;
      if (hasKey(identSet(o.id), n)) return true;
    }
    return false;
  }
  // 取值链原样（#616n 锚点：桌面 lbl-partner 优先、聊天 cs-lbl-partner 兜底、名片名最后）
  function nickLabelChain(cid) {
    try {
      const s = storeOf(cid);
      if (s) {
        const lb = String(s.get('lbl-partner') || '').trim();
        if (lb) return lb;
        const cs = String(s.get('cs-lbl-partner') || '').trim();
        if (cs) return cs;
      }
    } catch (e) {}
    return contactName(cid);
  }
  function effNick(cid) {
    const card = contactName(cid);
    const pick = nickLabelChain(cid);
    // 昵称链取到的名字恰是另一个桌面的身份名（联系人改过名、renameContact 因 cur≠oldName
    // 没同步 lbl-partner；聊天昵称被写成另一个梦角名；跨桌面查岗 ensureTaName 兜过旧名）
    // → 此间的梦角卡片/今日轴就会显示「另一个联系人的名字」。本桌面自己的名片名不撞名时
    // 用它；无撞名的常规场景零变化（#616 的取值顺序原样保留）。
    if (pick && pick !== card && otherClaimsName(cid, pick) && !otherClaimsName(cid, card)) return card;
    return pick;
  }
  function identSet(cid) {
    const out = {};
    try {
      const s = storeOf(cid);
      if (s) {
        const cs = String(s.get('cs-lbl-partner') || '').trim(); if (cs) out[cs] = 1;
        const lb = String(s.get('lbl-partner') || '').trim(); if (lb) out[lb] = 1;
      }
    } catch (e) {}
    const nm = String(contactName(cid) || '').trim(); if (nm) out[nm] = 1;
    return out;
  }
  function hasKey(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function healBelonging() {
    try {
      const r = rootStore();
      if (!r || !r.get('contacts')) return 0; // 注册表未就绪（LS 失效设备 IDB 回填未完成）：contacts() 不全，认亲必错
      const list = contacts();
      const idents = {}, rosters = {}, moves = [], dirty = {};
      list.forEach(ct => { idents[ct.id] = identSet(ct.id); rosters[ct.id] = loadRoster(ct.id); });
      // ① 本尊名字漂移对齐（单桌面也跑）：带 own 标记（自动播种）的梦角名恒等于本桌有效昵称。
      //    用户改了聊天昵称/桌面昵称而梦角名没跟随 → 卡片名与桌面名对不上，这里纠回。
      list.forEach(ct => {
        const want = String(effNick(ct.id) || '').trim();
        if (!want) return;
        rosters[ct.id].forEach(c => {
          if (!c || !c.own || c.manual) return;
          if (String(c.name || '').trim() !== want) { c.name = want; dirty[ct.id] = 1; }
        });
      });
      // ② 错放归属自愈（≥2 桌面才可能串桌）
      if (list.length >= 2) {
        list.forEach(ct => {
          rosters[ct.id].forEach(c => {
            if (!c || c.manual) return;
            const n = String(c.name || '').trim();
            if (!n || hasKey(idents[ct.id], n)) return; // 名字与所在桌面身份相符：正常
            let home = '', hits = 0;
            list.forEach(o => { if (o.id !== ct.id && hasKey(idents[o.id], n)) { home = o.id; hits++; } });
            if (hits !== 1) return; // 无名可归 / 撞名多个：宁不搬不错搬
            if (rosters[home].some(x => x && String(x.name || '').trim() === n)) return; // 目标已有本尊
            if (moves.some(m => m.id === c.id)) return;
            moves.push({ from: ct.id, to: home, id: c.id, name: n });
          });
        });
      }
      moves.forEach(m => {
        const src = rosters[m.from], dst = rosters[m.to];
        if (!src || !dst) return;
        const i = src.findIndex(x => x.id === m.id);
        if (i < 0 || dst.some(x => x.id === m.id)) return;
        const c = src.splice(i, 1)[0];
        c.cid = m.to; // cid 字段跟着搬：权威归属与物理位置一致，下次不再重复判定
        dst.push(c);
        dirty[m.from] = 1; dirty[m.to] = 1;
        const stFrom = loadState(m.from), stTo = loadState(m.to);
        if (stFrom[m.id] !== undefined) {
          stTo[m.id] = stFrom[m.id]; delete stFrom[m.id];
          saveState(stFrom, m.from); saveState(stTo, m.to);
        }
        // 搬空后清播种标记：该桌面恢复「第一次打开用自己的名字种下第一个梦角」
        try { if (!src.length) { const s0 = storeOf(m.from); if (s0) s0.remove(SEED_KEY); } } catch (e) {}
      });
      const cids = Object.keys(dirty);
      cids.forEach(cid => { if (rosters[cid]) saveRoster(rosters[cid], cid); });
      if (cids.length) todayCacheMap = {}; // 归属/名字变了：各视图今日预测作废
      return moves.length;
    } catch (e) { return 0; }
  }
  window.cjianHealBelonging = healBelonging; // 暴露产品函数供回归脚本直接断言（不复刻实现）

  // ---- 随机选择核心（基础概率 + 世界时间 + 最近互动；性格不写死） ----
  function presenceWeights(worldHour) {
    if (worldHour >= 23 || worldHour < 5) return { near: 8, nearby: 18, far: 26, unfelt: 33, gone: 15 };
    if (worldHour >= 5 && worldHour < 9) return { near: 22, nearby: 30, far: 18, unfelt: 18, gone: 12 };
    if (worldHour >= 9 && worldHour < 17) return { near: 18, nearby: 30, far: 20, unfelt: 20, gone: 12 };
    if (worldHour >= 17 && worldHour < 22) return { near: 30, nearby: 32, far: 14, unfelt: 14, gone: 10 };
    return { near: 20, nearby: 26, far: 20, unfelt: 22, gone: 12 };
  }
  function activityWeights(worldHour) {
    if (worldHour >= 23 || worldHour < 6) return { free: 4, busy: 8, rushed: 4, rest: 12, sleep: 62, unknown: 10 };
    if (worldHour >= 6 && worldHour < 9) return { free: 28, busy: 24, rushed: 14, rest: 10, sleep: 14, unknown: 10 };
    if (worldHour >= 9 && worldHour < 12) return { free: 34, busy: 30, rushed: 18, rest: 2, sleep: 2, unknown: 14 };
    if (worldHour >= 12 && worldHour < 14) return { free: 32, busy: 26, rushed: 16, rest: 16, sleep: 2, unknown: 8 };
    if (worldHour >= 14 && worldHour < 18) return { free: 34, busy: 32, rushed: 18, rest: 4, sleep: 2, unknown: 10 };
    if (worldHour >= 18 && worldHour < 21) return { free: 36, busy: 26, rushed: 16, rest: 8, sleep: 4, unknown: 10 };
    return { free: 24, busy: 22, rushed: 14, rest: 18, sleep: 12, unknown: 10 };
  }
  function pickWeighted(weights, r) {
    const keys = Object.keys(weights);
    const total = keys.reduce((s, k) => s + weights[k], 0);
    let acc = 0;
    const rr = (r == null ? Math.random() : r) * total;
    for (const k of keys) {
      acc += weights[k];
      if (rr < acc) return k;
    }
    return keys[keys.length - 1];
  }
  // 最近互动（感知/打开此间/刚聊过天）30 分钟内提高靠近概率
  function recentBoost(s, now) {
    const ref = Math.max(s.lastPerceive || 0, s.__open || 0, s.__chat || 0);
    return now - ref < 30 * 60000;
  }
  function rollPresence(worldHour, boost) {
    const w = presenceWeights(worldHour);
    if (boost) {
      w.near += 16; w.nearby += 16;
      w.far = Math.max(2, w.far - 8);
      w.unfelt = Math.max(2, w.unfelt - 8);
      w.gone = Math.max(2, w.gone - 6);
    }
    return pickWeighted(w);
  }
  function rollActivity(worldHour) {
    return pickWeighted(activityWeights(worldHour));
  }

  // 每梦角独立状态（含随机冷却：状态持续一段时间后梦角才会重新选择）
  // v3.27.x：防御无效状态值——旧版/数据损坏时 s.p/s.a 可能不在 PRESENCE/ACTIVITY 中，
  //   后续 PRESENCE[s.p].label 会抛 TypeError 导致整页空白。这里检测到无效值时重新随机。
  function ensureState(c, st, now) {
    const s = st[c.id] || (st[c.id] = {});
    if (!s.p || !PRESENCE[s.p] || !s.a || !ACTIVITY[s.a]) {
      const h = Math.floor(worldMinuteOf(c) / 60);
      s.p = rollPresence(h, false);
      s.a = rollActivity(h);
    }
    if (!s.sinceP) s.sinceP = now;
    if (!s.sinceA) s.sinceA = now;
    if (!s.cdP) s.cdP = rand(20, 45) * 60000;
    if (!s.cdA) s.cdA = rand(8, 25) * 60000;
    return s;
  }

  // 刷新：梦角自己随机选择——冷却过了就重新选。遍历【所有桌面】的梦角（后台也在流动）。
  function refreshStates() {
    const now = Date.now();
    let dirtyAny = false;
    contacts().forEach(ct => {
      const roster = loadRoster(ct.id);
      if (!roster.length) return;
      const st = loadState(ct.id);
      let dirty = false;
      roster.forEach(c => {
        // v3.14.x 修复：新梦角首次生成的初始状态必须落盘——否则状态只存在于本次渲染的
        // 临时对象里，下次渲染（30s 心跳/重开页面）会重新随机一次，表现为新梦角
        // 状态每 30 秒无规律跳动，且列表/详情/今日轴各滚各的（老版遗留隐患）
        const isNew = !st[c.id];
        const s = ensureState(c, st, now);
        if (isNew) dirty = true;
        const worldHour = Math.floor(worldMinuteOf(c) / 60);
        const boost = recentBoost(s, now);
        if (now - s.sinceA >= s.cdA) {
          s.a = rollActivity(worldHour);
          s.sinceA = now;
          s.cdA = rand(8, 25) * 60000;
          dirty = true;
        }
        if (now - s.sinceP >= s.cdP) {
          s.p = rollPresence(worldHour, boost);
          s.sinceP = now;
          s.cdP = rand(20, 45) * 60000;
          dirty = true;
        }
      });
      if (dirty) { saveState(st, ct.id); dirtyAny = true; }
    });
    return dirtyAny;
  }
  window.cjianRefresh = refreshStates; // 测试/运维钩子

  // 低概率小惊喜：长时间没互动且状态久未变化，可能「突然靠近」——不是常规机制
  let lastApproachAt = 0;
  function tickApproach() {
    const now = Date.now();
    if (now - lastApproachAt < 20 * 60000) return;
    let hitName = '';
    contacts().forEach(ct => {
      if (hitName) return;
      const roster = loadRoster(ct.id);
      if (!roster.length) return;
      const st = loadState(ct.id);
      let dirty = false;
      roster.forEach(c => {
        if (hitName) return;
        const s = ensureState(c, st, now);
        if (now - s.sinceP < 120 * 60000) return;
        if (Math.random() >= 0.003) return; // 每个梦角每次刷新约 0.3%
        s.p = Math.random() < 0.1 ? 'near' : 'nearby';
        s.sinceP = now;
        s.cdP = rand(20, 45) * 60000;
        lastApproachAt = now;
        hitName = c.name;
        dirty = true;
      });
      if (dirty) saveState(st, ct.id);
    });
    if (hitName) {
      toast('……好像有什么靠近了。');
      if (typeof window.renderCjian === 'function') window.renderCjian(false);
    }
  }

  // 聊天互动钩子（chat.js addMsg 调用）——记在当前桌面的状态上
  window.cjianNoteChat = function () {
    try { const cid = curCid(); const st = loadState(cid); st.__chat = Date.now(); saveState(st, cid); } catch (e) {}
  };
  window.cjianNoteOpen = function () {
    try { const cid = curCid(); const st = loadState(cid); st.__open = Date.now(); saveState(st, cid); } catch (e) {}
  };

  // ---- 视图范围：单个桌面 / 全部总览 ----
  let viewCid = ''; // '' 未初始化；打开此间时置为当前桌面
  function scopeCids() {
    if (viewCid === ALL) return contacts().map(ct => ct.id);
    const v = viewCid || curCid();
    return [v];
  }
  // 全部梦角扁平列表（联系人顺序 × 名单顺序），供详情上一位/下一位切换
  function flatEntries() {
    const out = [];
    contacts().forEach(ct => {
      loadRoster(ct.id).forEach(c => out.push({ c: c, cid: ct.id }));
    });
    return out;
  }
  // FIX 2026-09-18 #786：当前视图范围内的梦角列表（「全部」＝各桌面，单桌面＝只该桌面）
  function scopeEntries() {
    const s = scopeCids();
    return flatEntries().filter(en => s.indexOf(en.cid) >= 0);
  }
  function cidOfDreamer(id) {
    let hit = '';
    contacts().some(ct => {
      if (loadRoster(ct.id).some(x => x.id === id)) { hit = ct.id; return true; }
      return false;
    });
    return hit;
  }

  // ---- 感知此间：轻量反馈，不是剧情系统（范围跟随当前视图） ----
  const MIN_CHANGE = 15 * 60000; // 状态变化冷却：一次感知最多改变一个梦角
  let perceiveCooldownUntil = 0;
  function perceiveChance(p) {
    if (p === 'near') return 95;
    if (p === 'nearby') return 75;
    if (p === 'far') return 40;
    if (p === 'gone') return 25;
    return 12; // unfelt
  }
  window.cjianPerceive = function () {
    const entries = [];
    scopeCids().forEach(cid => {
      loadRoster(cid).forEach(c => entries.push({ c: c, cid: cid }));
    });
    if (!entries.length) { toast('此间还没有梦角，先添加一个吧'); return; }
    if (Date.now() < perceiveCooldownUntil) return;
    perceiveCooldownUntil = Date.now() + 4000;
    const now = Date.now();
    const states = {}; // cid -> st（惰性加载，最后统一回写）
    function stOf(cid) { return states[cid] || (states[cid] = loadState(cid)); }
    const nearOnes = [], farOnes = [];
    entries.forEach(en => {
      const s = ensureState(en.c, stOf(en.cid), now);
      if (s.p === 'near' || s.p === 'nearby') { nearOnes.push(en.c); return; }
      if (Math.random() * 100 < perceiveChance(s.p)) nearOnes.push(en.c);
      else farOnes.push(en.c);
    });
    const lines = [];
    if (nearOnes.length) {
      if (nearOnes.length === 1) lines.push('你安静了一会儿。\n好像有人就在附近。');
      else lines.push('似乎有' + nearOnes.length + '个人。\n有的离得很近。');
      nearOnes.forEach(n => { const l = cjLine('感知·气息', ['可以感觉到一点熟悉的气息。']); if (l) lines.push('「' + n.name + '」\n' + l); });
      if (farOnes.length) lines.push('还有谁……在很远的地方。');
    } else {
      const miss = cjLine('感知·落空', ['没有感觉到谁。']);
      if (miss) lines.push(miss);
      lines.push('但这并不代表他们不在。');
    }
    // 一次感知最多产生一次状态变化，且需过 15 分钟状态冷却
    let changedName = null, changedTo = '';
    const eligible = entries.filter(en => now - ensureState(en.c, stOf(en.cid), now).sinceP > MIN_CHANGE);
    if (eligible.length) {
      const target = eligible[Math.floor(Math.random() * eligible.length)];
      const s = ensureState(target.c, stOf(target.cid), now);
      const r = Math.random();
      s.p = r < 0.45 ? 'nearby' : (r < 0.75 ? 'unfelt' : (r < 0.9 ? 'near' : 'far'));
      s.sinceP = now;
      s.cdP = rand(20, 45) * 60000;
      s.lastPerceive = now;
      changedName = target.c.name;
      changedTo = PRESENCE[s.p].label;
    }
    Object.keys(states).forEach(cid => saveState(states[cid], cid));
    renderPerceiveResult(lines, changedName, changedTo);
    return { lines: lines, changedName: changedName, changedTo: changedTo };
  };

  // ---- 预测文案（可能发生，不保证） ----
  function predictPhrase(pr, ac) {
    if (ac === 'sleep' || ac === 'rest') return '可能在休息';
    if (ac === 'unknown') return '此时尚不可知';
    if (pr === 'near') return '可能就在身边';
    if (pr === 'nearby') return ac === 'free' ? '可能在附近' : '可能较忙';
    if (pr === 'far') return '在远处';
    if (pr === 'gone') return '离开中';
    return '可能感知不到';
  }
  function trajectoryPhrase(pr, ac) {
    if (ac === 'sleep') return '睡眠';
    if (ac === 'rest') return '休息';
    if (ac === 'unknown') return '此时尚不可知';
    if (ac === 'free') return pr === 'near' ? '很近' : (pr === 'nearby' ? '可能在附近' : '有空');
    if (ac === 'busy') return '有事';
    if (ac === 'rushed') return '忙着';
    if (pr === 'far') return '在远处';
    if (pr === 'gone') return '离开';
    return '感知不到';
  }

  // ---- 今日时间轴：每次打开「此间」，梦角重新随机选择今天的可能轨迹 ----
  // 缓存（v3.14.x 起按视图分桶）：打开时随机一次，浏览期间保持稳定——切换桌面/总览
  // 再切回来仍是同一份预测（各视图各一份），只把当前时辰行换成实时状态；
  // 关闭重开（openCjian forceForecast）才全部重掷，名单增删改也会作废对应缓存。
  let todayCacheMap = {};
  function scopeKey() { return viewCid === ALL ? ALL : (viewCid || curCid()); }
  function rollTodayForecast() {
    const entries = flatEntries().filter(en => scopeCids().indexOf(en.cid) >= 0);
    const d = new Date();
    const curIdx = shichenAt(d.getHours());
    const cache = [];
    for (let k = 0; k < 12; k++) {
      const idx = (curIdx + k) % 12;
      const realStartH = shichenStartHour(idx);
      const parts = entries.map(en => {
        const worldHour = Math.floor(worldMinuteOf(en.c) / 60);
        const pr = rollPresence(worldHour, false);
        const ac = rollActivity(worldHour);
        return en.c.name + ' · ' + predictPhrase(pr, ac);
      });
      cache.push({ idx: idx, startH: realStartH, parts: parts });
    }
    todayCacheMap[scopeKey()] = cache;
  }
  function renderToday(liveNow) {
    const box = document.getElementById('cj-today');
    if (!box) return;
    box.innerHTML = '';
    const rows = todayCacheMap[scopeKey()];
    if (!rows) return;
    const entries = flatEntries().filter(en => scopeCids().indexOf(en.cid) >= 0);
    if (!entries.length) return;
    const now = Date.now();
    const states = {};
    rows.forEach((row, k) => {
      const rowEl = el('div', 'cj-today-row');
      const left = el('div', 'cj-today-left');
      left.appendChild(el('span', 'cj-today-name', SHICHEN[row.idx] + '时'));
      left.appendChild(el('span', 'cj-today-range', pad(row.startH) + ':00–' + pad((row.startH + 2) % 24) + ':59'));
      rowEl.appendChild(left);
      const right = el('div', 'cj-today-chars');
      let parts = row.parts;
      if (k === 0) {
        // 当前时辰行始终反映实时状态
        parts = entries.map(en => {
          const st = states[en.cid] || (states[en.cid] = loadState(en.cid));
          const s = ensureState(en.c, st, now);
          return en.c.name + ' · ' + predictPhrase(s.p, s.a);
        });
      }
      if (parts.length) right.appendChild(el('span', 'cj-today-c', parts.join('　')));
      else right.appendChild(el('span', 'cj-today-c cj-today-mute', '——'));
      rowEl.appendChild(right);
      box.appendChild(rowEl);
    });
  }

  // ---- 渲染 ----
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function renderPerceiveResult(lines, changedName, changedTo) {
    const box = document.getElementById('cj-perceive-result');
    if (!box) return;
    box.innerHTML = '';
    lines.forEach(l => {
      const segs = String(l).split('\n');
      segs.forEach((seg, i) => {
        const p = el('p', 'cj-p-line', seg);
        if (i > 0) p.style.marginTop = '2px';
        box.appendChild(p);
      });
    });
    if (changedName) box.appendChild(el('p', 'cj-p-note', '「' + changedName + '」似乎改变了状态——现在' + changedTo + '。'));
    box.hidden = false;
  }
  // ===== 对方当前时间：联系人自己随机抽的当地时刻 =====
  // 刷新机制同「头像互动·随机更换联系人头像」：启动立即检查 + 每 60 秒轮询，
  // last/next 时间戳持久化（首次 last=0 → 立即抽一个），抽完 next=1+random*7 小时；
  // 异常时间戳归一，刷新页面周期不重置。键形 xy-home-v2:<cid>:cjian-ta-time。
  function loadTaTime(cid) {
    try { const s = storeOf(cid); if (s) { const v = s.get('cjian-ta-time'); if (v) return JSON.parse(v); } } catch (e) {}
    return null;
  }
  function saveTaTime(cid, obj) {
    try { storeOf(cid).set('cjian-ta-time', JSON.stringify(obj)); } catch (e) {}
  }
  // 由世界分钟算半小时段区间与标签（与 timeInfo 的 half/range 同源，但接收世界分钟）。
  // 返回 {lo, hi, half, range}：lo/hi 为该半小时段的分钟闭区间，half 如「未正」，range 如「14:30–14:59」。
  function halfRangeOf(wm) {
    const wh = Math.floor(wm / 60) % 24;
    const wmin = wm % 60;
    const idx = shichenAt(wh);
    const stH = shichenStartHour(idx);
    const mInto = wh * 60 + wmin - stH * 60;
    let lo, hi, half, range;
    if (mInto < 30) {
      lo = stH * 60; hi = stH * 60 + 29;
      half = SHICHEN[idx] + '初';
      range = pad(stH) + ':00–' + pad(stH) + ':29';
    } else if (mInto < 90) {
      lo = stH * 60 + 30; hi = stH * 60 + 89;
      half = SHICHEN[idx] + '正';
      range = pad(stH) + ':30–' + pad((stH + 1) % 24) + ':29';
    } else {
      lo = stH * 60 + 90; hi = stH * 60 + 119;
      half = SHICHEN[idx] + '正';
      range = pad((stH + 1) % 24) + ':30–' + pad((stH + 1) % 24) + ':59';
    }
    return { lo: lo, hi: hi, half: half, range: range };
  }
  function taTimeOf(cid) {
    const now = Date.now();
    let t = loadTaTime(cid);
    let last = (t && typeof t.last === 'number') ? t.last : 0;
    let next = (t && typeof t.next === 'number') ? t.next : 0;
    if (last > now || last < 0 || isNaN(last)) { last = 0; next = 0; }
    if (!t || (now - last) / 36e5 >= next) {
      // 复用列表首位梦角的世界时间半小时段（与列表卡片时段完全一致），再在该半小时段里
      // 抽具体时刻；桌面无梦角时退回全天先抽时辰再抽时刻。标签存 half/range 供展示。
      const list0 = loadRoster(cid);
      const c0 = list0 && list0[0];
      let hh, mm, halfLabel = '', rangeLabel = '';
      if (c0) {
        const info = halfRangeOf(worldMinuteOf(c0));
        const total = info.lo + rand(0, info.hi - info.lo);
        hh = Math.floor(total / 60) % 24; mm = total % 60;
        halfLabel = info.half; rangeLabel = info.range;
      } else {
        const stH = shichenStartHour(rand(0, 11));
        const total = slotMinuteRange(stH);
        hh = Math.floor(total / 60) % 24; mm = total % 60;
        const info = halfRangeOf(total);
        halfLabel = info.half; rangeLabel = info.range;
      }
      t = { hh: hh, mm: mm, last: now, next: 1 + Math.random() * 7, half: halfLabel, range: rangeLabel };
      saveTaTime(cid, t);
    }
    return t;
  }
  function renderTaTime() {
    const listEl = document.getElementById('cj-list');
    if (!listEl) return;
    let card = document.getElementById('cj-ta-time');
    if (!card) {
      card = el('div', 'cj-ta-time-card');
      card.id = 'cj-ta-time';
      listEl.parentNode.insertBefore(card, listEl);
    }
    card.innerHTML = '';
    card.appendChild(el('div', 'cj-ta-time-title', '对方当前时间'));
    card.appendChild(el('div', 'cj-ta-time-hint', 'TA 自己随机抽的当地时刻 · 每隔 1-8 小时重新抽'));
    const cidList = viewCid === ALL ? contacts().map(function (ct) { return ct.id; }) : [(viewCid || curCid())];
    cidList.forEach(function (cid) {
      const t = taTimeOf(cid);
      const row = el('div', 'cj-ta-time-item');
      const left = el('div', 'cj-ta-time-left');
      left.appendChild(el('span', 'cj-ta-time-sh', 'TA'));
      const nameCol = el('span', 'cj-ta-time-namecol');
      nameCol.appendChild(el('span', 'cj-ta-time-name', contactName(cid)));
      nameCol.appendChild(el('span', 'cj-ta-time-slot', taSlotLabel(cid, t)));
      left.appendChild(nameCol);
      row.appendChild(left);
      const right = el('div', 'cj-ta-time-right');
      right.appendChild(el('span', 'cj-ta-time-hhmm', pad(t.hh) + ':' + pad(t.mm)));
      right.appendChild(el('span', 'cj-ta-time-shi', SHICHEN[shichenAt(t.hh)] + '时'));
      row.appendChild(right);
      card.appendChild(row);
    });
  }
  // 「对方当前时间」的时间段标签：与列表首位梦角的半小时段完全一致（如「未正 14:30–14:59」）。
  // 优先用重抽时存住的 half/range；旧数据无该字段则实时取首位梦角当前半小时段兜底。
  function taSlotLabel(cid, t) {
    if (t && t.half && t.range) return t.half + ' ' + t.range;
    const c0 = loadRoster(cid)[0];
    if (c0) {
      const info = halfRangeOf(worldMinuteOf(c0));
      return info.half + ' ' + info.range;
    }
    return '全天随机';
  }
  // 刷新检查：启动立即一次 + 每 60 秒；仅当「此间」页开着才重抽/刷新显示（后台不空转）
  function taTimePoll() {
    try {
      const page = document.getElementById('page-cjian');
      if (page && !page.hidden) renderTaTime();
    } catch (e) {}
  }
  try { setInterval(taTimePoll, 60000); } catch (e) {}
  function renderHero() {
    const t = timeInfo(Date.now());
    const h1 = document.getElementById('cj-hero-time');
    const h2 = document.getElementById('cj-hero-range');
    if (h1) h1.textContent = t.half;
    if (h2) h2.textContent = t.range + ' · 现实此刻 ' + t.hhmm;
  }

  // 桌面分组切换条：每个桌面一枚 chips + 「全部」总览（v3.14.x）
  function renderGroupBar() {
    const main = document.getElementById('cj-main');
    if (!main) return;
    let bar = document.getElementById('cj-groups');
    if (!bar) {
      bar = el('div', 'cj-groups');
      bar.id = 'cj-groups';
      main.insertBefore(bar, main.firstChild);
    }
    bar.innerHTML = '';
    function chip(label, val) {
      const b = el('button', 'cj-gchip' + (viewCid === val ? ' on' : ''), label);
      b.type = 'button';
      b.addEventListener('click', e => {
        e.stopPropagation();
        setView(val);
      });
      bar.appendChild(b);
    }
    // FIX 2026-09-16 #615 「全部」总览固定排在分组条首位（原在末尾，桌面多了要横滑到底才点得到）
    chip('全部', ALL);
    contacts().forEach(ct => chip(contactName(ct.id), ct.id));
  }
  function setView(v) {
    if (viewCid === v) return;
    viewCid = v;
    try { healBelonging(); } catch (e) {} // FIX #514：切分组前先纠正错放归属（防别的桌面的梦角挂在本分组下）
    // 切换到非「全部」的具体桌面时：若该桌面从未打开过此间（未播种）会被展示为空态
    // 「此间还没有梦角」，这里用该 TA 的名字自动种下第一个梦角（与直接打开此间行为一致）。
    if (viewCid !== ALL) seedIfEmpty(viewCid);
    // 不清缓存：同一浏览期内每个视图的今日预测各自保持稳定，切回来还是原来那份
    window.renderCjian(false);
    const main = document.getElementById('cj-main');
    if (main) main.scrollTop = 0;
  }

  function cardEl(c, cid, s) {
    const t = timeInfo(worldNowFor(c));
    const card = el('div', 'cj-card');
    card.setAttribute('data-id', c.id);
    const head = el('div', 'cj-card-head');
    head.appendChild(el('span', 'cj-card-name', c.name));
    head.appendChild(el('span', 'cj-card-hint', '查看TA的一天 ›'));
    card.appendChild(head);
    const timeRow = el('div', 'cj-card-time');
    timeRow.appendChild(el('span', 'cj-card-half', t.half));
    timeRow.appendChild(el('span', 'cj-card-range', t.range));
    card.appendChild(timeRow);
    const tags = el('div', 'cj-card-tags');
    const pTag = el('span', 'cj-tag cj-tag-p', PRESENCE[s.p].label);
    pTag.title = PRESENCE[s.p].desc;
    const aTag = el('span', 'cj-tag cj-tag-a', ACTIVITY[s.a].label);
    aTag.title = ACTIVITY[s.a].desc;
    tags.appendChild(pTag);
    tags.appendChild(aTag);
    card.appendChild(tags);
    if (s.a === 'sleep') card.appendChild(el('div', 'cj-card-note', 'TA那边似乎已经睡了。'));
    if (s.a === 'rest') card.appendChild(el('div', 'cj-card-note', 'TA正在休息。'));
    if (Array.isArray(c.slots) && c.slots.length) card.appendChild(el('div', 'cj-card-note', '常在 ' + slotLabel(c.slots) + ' 出现'));
    const goBtn = el('button', 'cj-go', '去找TA');
    goBtn.type = 'button';
    goBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // 不是当前桌面的梦角：先切到 TA 所在桌面再进聊天
      try { if (cid !== curCid() && window.setActiveContact) window.setActiveContact(cid); } catch (err) {}
      if (window.enterChat) window.enterChat();
      else toast('聊天页未就绪');
    });
    card.appendChild(goBtn);
    card.addEventListener('click', () => window.cjianOpenDetail(c.id, cid));
    return card;
  }
  function renderList() {
    const listEl = document.getElementById('cj-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    const empty = document.getElementById('cj-empty');
    // #850：回填期 roster 键可能还没回来——不出「这个桌面还没有梦角/各个桌面还没有梦角」
    // 的假空断言，占位等 done 后补渲收敛
    if (window.mochiDataPending && window.mochiDataPending()) {
      if (empty) empty.hidden = true;
      listEl.innerHTML = window.mochiLoadingHtml('梦角名单');
      return;
    }
    const now = Date.now();
    if (viewCid === ALL) {
      // 总览模式：按桌面分组，一次看完全部梦角状态
      if (empty) empty.hidden = true;
      let any = false;
      contacts().forEach(ct => {
        const roster = loadRoster(ct.id);
        const head = el('div', 'cj-group-head');
        head.appendChild(el('span', null, contactName(ct.id)));
        head.appendChild(el('span', 'cj-group-count', roster.length + '位'));
        listEl.appendChild(head);
        if (!roster.length) {
          listEl.appendChild(el('div', 'cj-group-empty', '这个桌面还没有梦角。'));
          return;
        }
        any = true;
        const st = loadState(ct.id);
        roster.forEach(c => listEl.appendChild(cardEl(c, ct.id, ensureState(c, st, now))));
      });
      if (!any) listEl.appendChild(el('div', 'cj-all-tip', '各个桌面还没有梦角。'));
      return;
    }
    const cid = viewCid || curCid();
    const roster = loadRoster(cid);
    if (empty) empty.hidden = roster.length > 0;
    if (!roster.length) return;
    const st = loadState(cid);
    roster.forEach(c => listEl.appendChild(cardEl(c, cid, ensureState(c, st, now))));
  }

  // ---- 梦角详情（TA 自己的一天；可上一位/下一位直接切换别的梦角） ----
  let detailId = '', detailCid = '';
  window.cjianOpenDetail = function (id, cid) {
    const main = document.getElementById('cj-main');
    const det = document.getElementById('cj-detail');
    if (!main || !det) return;
    detailId = id;
    detailCid = cid || cidOfDreamer(id) || curCid();
    renderDetail();
    main.hidden = true;
    det.hidden = false;
  };
  window.cjianCloseDetail = function () {
    const main = document.getElementById('cj-main');
    const det = document.getElementById('cj-detail');
    if (!main || !det) return;
    det.hidden = true;
    main.hidden = false;
    detailId = '';
    detailCid = '';
  };
  function renderDetail() {
    const body = document.getElementById('cj-detail-body');
    if (!body) return;
    body.innerHTML = '';
    const c = loadRoster(detailCid).find(x => x.id === detailId);
    if (!c) { window.cjianCloseDetail(); return; }
    const now = Date.now();
    const st = loadState(detailCid);
    const s = ensureState(c, st, now);
    const t = timeInfo(worldNowFor(c));
    body.appendChild(el('div', 'cj-d-name', c.name));
    body.appendChild(el('div', 'cj-d-offset', worldTagLabel(c)));
    body.appendChild(el('div', 'cj-d-src', '来自「' + contactName(detailCid) + '」的此间'));
    const timeBig = el('div', 'cj-d-time');
    timeBig.appendChild(el('span', 'cj-d-half', t.half));
    body.appendChild(timeBig);
    body.appendChild(el('div', 'cj-d-range', t.range + ' · 世界时间 ' + t.hhmm));
    if (c.offsetMin) body.appendChild(el('div', 'cj-d-real', '现实此刻 ' + timeInfo(Date.now()).hhmm));
    const tags = el('div', 'cj-card-tags');
    const pTag = el('span', 'cj-tag cj-tag-p', PRESENCE[s.p].label);
    pTag.title = PRESENCE[s.p].desc;
    const aTag = el('span', 'cj-tag cj-tag-a', ACTIVITY[s.a].label);
    aTag.title = ACTIVITY[s.a].desc;
    tags.appendChild(pTag);
    tags.appendChild(aTag);
    body.appendChild(tags);
    if (s.a === 'sleep') body.appendChild(el('div', 'cj-d-note', 'TA那边似乎已经睡了。'));
    if (s.a === 'rest') body.appendChild(el('div', 'cj-d-note', 'TA正在休息。'));
    if (Array.isArray(c.slots) && c.slots.length) body.appendChild(el('div', 'cj-d-note', '常在 ' + slotLabel(c.slots) + ' 出现 · 世界时间只在这些时辰里随机'));
    body.appendChild(el('div', 'cj-d-today-title', 'TA的今日'));
    const traj = el('div', 'cj-d-today');
    for (let k = 0; k < 12; k++) {
      const idx = (t.idx + k) % 12;
      const row = el('div', 'cj-d-row');
      row.appendChild(el('span', 'cj-d-row-name', SHICHEN[idx] + '时'));
      let pr, ac;
      if (k === 0) { pr = s.p; ac = s.a; }
      else {
        // 该行是哪个真实时辰 → 按它的起始整点 + 偏移（slots 梦角的可能世界时间按真实时辰推进）
        const rowStartH = shichenStartHour(idx);
        const wh = (Array.isArray(c.slots) && c.slots.length)
          ? rowStartH
          : (Math.floor((rowStartH * 60 + ((c.offsetMin || 0))) / 60) % 24 + 24) % 24;
        pr = rollPresence(wh, false);
        ac = rollActivity(wh);
      }
      row.appendChild(el('span', 'cj-d-row-p', trajectoryPhrase(pr, ac)));
      traj.appendChild(row);
    }
    body.appendChild(traj);
    body.appendChild(el('div', 'cj-d-foot', '这不是TA的日程表，只是TA可能的样子。'));
    // 上一位 / 下一位：不回列表直接切换查看别的梦角
    // FIX 2026-09-18 #786：翻页范围跟随当前视图——顶部选「单个联系人」tag 时只在该桌面自己的
    // 名单里循环（旧实现恒用 flatEntries()＝全部桌面的梦角排一张表：点【景元】tag 进详情按
    // 「下一位」直接翻到【符玄】【应星】桌面的梦角，观感＝「不同联系人数据串了、里面有别人
    // 的名字」；多桌面/多机型同现，纯逻辑与设备无关）。「全部」总览照旧跨桌面循环。
    // 兜底：详情条目已不在当前范围内（视图被外部改动 / 桌面被删）才退回全表，不留死路。
    let entries = scopeEntries();
    if (!entries.some(en => en.c.id === detailId)) entries = flatEntries();
    const pos = entries.findIndex(en => en.c.id === detailId);
    if (pos >= 0 && entries.length > 1) {
      function jump(en) { detailId = en.c.id; detailCid = en.cid; renderDetail(); }
      const nav = el('div', 'cj-d-nav');
      const prevB = el('button', 'cj-d-nav-btn', '‹ 上一位');
      prevB.type = 'button';
      prevB.addEventListener('click', e => {
        e.stopPropagation();
        jump(entries[(pos - 1 + entries.length) % entries.length]);
      });
      nav.appendChild(prevB);
      nav.appendChild(el('span', 'cj-d-nav-pos', (pos + 1) + '/' + entries.length));
      const nextB = el('button', 'cj-d-nav-btn', '下一位 ›');
      nextB.type = 'button';
      nextB.addEventListener('click', e => {
        e.stopPropagation();
        jump(entries[(pos + 1) % entries.length]);
      });
      nav.appendChild(nextB);
      body.appendChild(nav);
    }
    const goBtn = el('button', 'cj-go', '去找TA');
    goBtn.type = 'button';
    goBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      try { if (detailCid !== curCid() && window.setActiveContact) window.setActiveContact(detailCid); } catch (err) {}
      if (window.enterChat) window.enterChat();
      else toast('聊天页未就绪');
    });
    body.appendChild(goBtn);
  }

  // ---- 整页渲染 ----
  // v3.27.x：每个渲染步骤独立 try/catch——单步抛错不再连坐整页空白
  //   （旧数据含无效状态值 / DOM 被外部改结构 / 某桌面 store 异常时，
  //    某一步可能抛错，但其余步骤仍渲染，用户至少能看到部分内容而非白屏）
  window.renderCjian = function (forceForecast) {
    try { if (viewCid !== ALL && !contacts().some(ct => ct.id === viewCid)) viewCid = curCid(); } catch (e) {} // 视图兜底
    if (forceForecast) todayCacheMap = {}; // 每次打开此间：TA们重新选择今天的可能样子
    try { if (!todayCacheMap[scopeKey()]) rollTodayForecast(); } catch (e) {}
    try { refreshStates(); } catch (e) {}
    try { renderHero(); } catch (e) {}
    try { renderGroupBar(); } catch (e) {}
    try { renderTaTime(); } catch (e) {}
    try { renderList(); } catch (e) {}
    try { renderToday(true); } catch (e) {}
    try { if (detailId) renderDetail(); } catch (e) {}
  };

  window.openCjian = function () {
    const page = document.getElementById('page-cjian');
    if (!page) return;
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    page.hidden = false;
    try { if (window.cjianNoteOpen) window.cjianNoteOpen(); } catch (e) {}
    viewCid = curCid(); // 每次打开回到当前桌面
    // FIX #514：先纠正错放归属（搬空后自动重置播种标记），紧接着给该桌面种下自己的
    // 第一个梦角（用 TA 的名字）——两件事同一拍完成，避免中间态被渲染出去
    try { healBelonging(); seedIfEmpty(curCid()); } catch (e) {}
    window.renderCjian(true);
  };
  window.closeCjian = function () {
    const page = document.getElementById('page-cjian');
    if (page) page.hidden = true;
  };

  // ---- 梦角管理：添加/改名/删除（单弹窗多阶段，openModal 控制器） ----
  // 总览模式下先进「选桌面」阶段，管理动作作用于所选桌面自己的名单。
  const OFFSET_PILLS = [
    { label: '与现实同步', value: '0' },
    { label: '比现实快1小时', value: '60' },
    { label: '比现实慢1小时', value: '-60' },
    { label: '比现实快3小时', value: '180' },
    { label: '比现实慢3小时', value: '-180' },
    { label: '独立时间流', value: 'rand' }
  ];
  const ACTION_PILLS = [
    { label: '添加梦角', value: 'add' },
    { label: '时辰区间', value: 'slots' },
    { label: '改名', value: 'rename' },
    { label: '删除梦角', value: 'del' }
  ];
  // v3.26.x #611：梦角档案（memo-arc）页的「管理梦角」是复用本弹窗的，但「时辰区间」
  // 属此间专属的世界时间设定——档案页只该管名单。调 cjianManage({ arc: 1 }) 时：
  // ① 动作列表去掉「时辰区间」（档案页没有 slots 动作）；② 添加流程选完时间偏移直接
  // 建档，不再弹时辰多选浮层 #cj-slot-mask；③ 顶部补一条「自动跟随桌面联系人创建」提醒。
  // 此间入口（cjianManage() 无参）零变化，slots 能力完整保留。
  const ACTION_PILLS_ARC = [
    { label: '添加梦角', value: 'add' },
    { label: '改名', value: 'rename' },
    { label: '删除梦角', value: 'del' }
  ];
  // 独立时间流：一个只属于TA自己的随机偏移（非整点，跨天稳定）
  function randomOffset() {
    let off = rand(10, 540);
    if (off % 60 === 0) off += 17;
    return (Math.random() < 0.5 ? -1 : 1) * off;
  }
  window.cjianManage = function (opts) {
    if (!window.openModal) return;
    // #611：arc = 梦角档案页入口（只做名单管理，无「时辰区间」）
    const arcMode = !!(opts && opts.arc);
    const ACTIONS = arcMode ? ACTION_PILLS_ARC : ACTION_PILLS;
    let mCid = (viewCid === ALL) ? '' : (viewCid || curCid());
    let phase = mCid ? 'action' : 'pickGroup', pendingName = '', pendingOffset = 0, renameTarget = null;
    const ctl = window.openModal('梦角管理', '', function (v) {
      if (!v) return;
      if (phase === 'pickGroup') {
        mCid = v;
        phase = 'action';
        ctl.stay();
        ctl.title('梦角管理 · 「' + contactName(mCid) + '」');
        ctl.input(false);
        ctl.pills(ACTIONS);
        return;
      }
      if (phase === 'action') {
        if (v === 'add') {
          phase = 'name';
          ctl.stay();
          ctl.title('添加梦角 · 「' + contactName(mCid) + '」');
          ctl.hint(''); // #611：清掉档案页入口的提醒（该阶段要输名字，粘着提醒会挤版面）
          ctl.pills(null);
          ctl.input(true);
          ctl.maxLen(10);
          ctl.ph('梦角的名字，如：景元');
          ctl.okText('下一步');
        } else {
          const list = loadRoster(mCid);
          if (!list.length) { toast('这个桌面还没有梦角，先添加一个吧'); return; }
          if (v === 'slots') {
            // v3.16.x：给已有梦角改时辰区间
            phase = 'pickSlot';
            ctl.stay();
            ctl.title('给谁设时辰区间');
            ctl.hint('TA 的世界时间会只在这些时辰里随机');
            ctl.input(false);
            ctl.pills(list.map(c => ({ label: c.name + ((Array.isArray(c.slots) && c.slots.length) ? ' · ' + slotLabel(c.slots) : ''), value: c.id })));
            ctl.okText('设置');
          } else {
            phase = v === 'rename' ? 'pickRename' : 'pickDel';
            ctl.stay();
            ctl.title(v === 'rename' ? '改谁的称呼' : '删除梦角');
            ctl.input(false);
            ctl.pills(list.map(c => ({ label: c.name, value: c.id })));
            ctl.okText(v === 'rename' ? '改名' : '删除');
          }
        }
        return;
      }
      if (phase === 'name') {
        const name = String(v == null ? '' : v).trim();
        if (!name) return;
        pendingName = name;
        phase = 'offset';
        ctl.stay();
        ctl.title('设定「' + name + '」的世界时间');
        // #611：档案页入口不设时辰区间，提示改指「此间」（否则这句指向下一步会落空）
        ctl.hint(arcMode ? '选一个时间偏移（想限定 TA 常在的时辰，去「此间」设）' : '先选时间偏移，下一步还能限定 TA 常在的时辰区间');
        ctl.input(false);
        ctl.pills(OFFSET_PILLS);
        ctl.okText(arcMode ? '完成' : '下一步');
        return;
      }
      if (phase === 'offset') {
        const off = v === 'rand' ? randomOffset() : parseInt(v, 10);
        if (v !== 'rand' && isNaN(off)) return;
        pendingOffset = off;
        // 不 stay：本次确定后通用弹窗关闭，再开时辰多选浮层（外层 finally close 会清 cb，须延后一拍）
        phase = '';
        if (arcMode) {
          // #611：档案页不设时辰区间——选完偏移直接建档（无 slots 字段＝旧行为，世界时间
          // 按偏移连续流动；与时辰浮层「不限定」分支同一份数据形态，无迁移问题）
          const l = loadRoster(mCid);
          l.push({ id: makeId(), name: pendingName, offsetMin: pendingOffset, cid: mCid, manual: 1 });
          saveRoster(l, mCid);
          invalidateTaTime(mCid); // #903
          toast('已添加梦角：「' + pendingName + '」');
          pendingName = ''; pendingOffset = 0;
          todayCacheMap = {}; // 名单变了，各视图的今日预测全部作废
          window.renderCjian(true);
          return;
        }
        setTimeout(function () {
          // #892：名字与时间偏移在前两步已定档，时辰浮层只是可选附加项——「取消」不再等于
          // 整个放弃添加（旧版会丢弃名字与偏移＝梦角根本没建出来，用户以为时间流设置不了），
          // 改为与「不限定 · 用时间偏移」同路：按已选偏移照常建档
          function createPlain() {
            const list = loadRoster(mCid);
            list.push({ id: makeId(), name: pendingName, offsetMin: pendingOffset, cid: mCid, manual: 1 });
            saveRoster(list, mCid);
            invalidateTaTime(mCid); // #903
            toast('已加入此间：「' + pendingName + '」');
            pendingName = ''; pendingOffset = 0;
            todayCacheMap = {}; // 名单变了，各视图的今日预测全部作废
            window.renderCjian(true);
          }
          showSlotPicker(
            [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
            function (idxs) {
              const list = loadRoster(mCid);
              list.push({ id: makeId(), name: pendingName, offsetMin: pendingOffset, slots: idxs.map(i => SHICHEN_START[i]), cid: mCid, manual: 1 });
              saveRoster(list, mCid);
              invalidateTaTime(mCid); // #903
              toast('已加入此间：「' + pendingName + '」');
              pendingName = ''; pendingOffset = 0;
              todayCacheMap = {}; // 名单变了，各视图的今日预测全部作废
              window.renderCjian(true);
            },
            function () { createPlain(); }, // 取消：时辰不限定，照常建档
            createPlain
          );
        }, 0);
        return;
      }
      if (phase === 'pickSlot') {
        const list = loadRoster(mCid);
        const c = list.find(x => x.id === v);
        if (!c) return;
        setTimeout(function () {
          showSlotPicker(
            (Array.isArray(c.slots) && c.slots.length) ? c.slots.map(h => shichenAt(h)) : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
            function (idxs) {
              const l2 = loadRoster(mCid);
              const cc = l2.find(x => x.id === c.id);
              if (!cc) return;
              cc.slots = idxs.map(i => SHICHEN_START[i]);
              saveRoster(l2, mCid);
              clearOttTag(c.id); invalidateTaTime(mCid); // #903：改时段后立即按新时辰区间重抽，不驻留旧时刻
              toast('已设时辰区间：' + slotLabel(cc.slots));
              todayCacheMap = {};
              window.renderCjian(true);
            },
            function () {}, // 取消：不改
            function () {
              const l2 = loadRoster(mCid);
              const cc = l2.find(x => x.id === c.id);
              if (!cc) return;
              delete cc.slots;
              saveRoster(l2, mCid);
              clearOttTag(c.id); invalidateTaTime(mCid); // #903：改回时间偏移流动同样重抽
              toast('已改回：按时间偏移流动');
              todayCacheMap = {};
              window.renderCjian(true);
            }
          );
        }, 0);
        return;
      }
      if (phase === 'pickRename') {
        const list = loadRoster(mCid);
        const c = list.find(x => x.id === v);
        if (!c) return;
        renameTarget = c;
        phase = 'renameInput';
        ctl.stay();
        ctl.title('把「' + c.name + '」改成');
        ctl.pills(null);
        ctl.input(true);
        ctl.maxLen(10);
        ctl.ph('新名字');
        ctl.okText('改名');
        return;
      }
      if (phase === 'renameInput') {
        const n = String(v == null ? '' : v).trim();
        if (!n) return;
        const list = loadRoster(mCid);
        const c = list.find(x => x.id === (renameTarget ? renameTarget.id : ''));
        if (c) {
          c.name = n;
          c.manual = 1; // 用户手动改名：打标记，归属自愈不再自动搬它（#514）
          saveRoster(list, mCid);
          toast('已改名为「' + n + '」');
        }
        phase = ''; renameTarget = null;
        todayCacheMap = {}; // 名字出现在今日预测里，一并作废
        window.renderCjian(true);
        return;
      }
      if (phase === 'pickDel') {
        const list = loadRoster(mCid);
        const idx = list.findIndex(x => x.id === v);
        if (idx < 0) return;
        const name = list[idx].name;
        list.splice(idx, 1);
        saveRoster(list, mCid);
        const st = loadState(mCid);
        delete st[v];
        saveState(st, mCid);
        clearOttTag(v);
        invalidateTaTime(mCid); // #903：名单头变了，「对方当前时间」重抽
        // #892：删空名单＝恢复「第一次打开自动种下默认梦角」——播种标记不清的话，该桌面
        // 永远停在「此间还没有梦角」空态、再也不自动播种，用户删掉想重设时间流只能手动
        // 一步步添加（与 healBelonging「搬空后清播种标记」同语义）
        if (!list.length) { const rs = storeOf(mCid); if (rs) rs.remove(SEED_KEY); }
        // v3.14.x：同步清掉 TA 的梦角档案（narc-<id>，memo-arc.js 存根命名空间）
        // 与指向 TA 的 narc-cur（档案页打开时会自愈，这里顺手清干净不留孤儿数据）
        try {
          const r0 = rootStore();
          if (r0) {
            r0.remove('narc-' + v);
            if ((r0.get('narc-cur') || '') === v) r0.remove('narc-cur');
          }
        } catch (err) {}
        toast('「' + name + '」已从此间离开');
        phase = '';
        if (detailId === v) window.cjianCloseDetail();
        todayCacheMap = {}; // 名单变了，各视图的今日预测全部作废
        window.renderCjian(true);
        return;
      }
    }, mCid ? { noInput: true, pills: ACTIONS } : { noInput: true, pills: contacts().map(ct => ({ label: contactName(ct.id), value: ct.id })) });
    // v3.26.x #611：梦角档案入口常驻提醒——梦角名单是跟着桌面联系人自动建档的，
    // 用户看到「添加梦角」会以为得自己手动建（点管理先给这一句，此间入口不显示）
    if (arcMode && ctl) ctl.hint('梦角会跟着桌面联系人自动创建，一般不用手动添加');
  };

  // ---- 定时器：随机刷新 + 突然靠近 + 页面打开时刷新时钟 ----
  function pageVisible() {
    const page = document.getElementById('page-cjian');
    return !!(page && !page.hidden);
  }
  function boot() {
    migrateSplit();
    rehomeMisfiled();
    fixBelonging();
    // 迁移时机加固：IndexedDB 回填（mochi-restore-done）可能晚于本模块启动——旧全局键
    // 迟到时首次迁移会扑空（老梦角要等下次刷新才合并回来）。就绪后幂等重跑一次合并
    // （按名认亲 + 并集去重 + 清根键，重复执行无副作用），升级当天即可见老梦角；
    // 存量纠偏同样补跑一次（注册表刚就绪时才能可靠认亲，未就绪轮次不会误置标记）。
    let reMigrated = false;
    document.addEventListener('mochi-restore-done', function () {
      try { migrateSplit(); } catch (e) {}
      try { rehomeMisfiled(); } catch (e) {}
      try { fixBelonging(); } catch (e) {}
      // #850：首次就绪补播种（打开/切视图时的 seedIfEmpty 都被回填闸挡过）＋补渲染
      // 收起「梦角名单还在读取」占位；后续再派发（备份导入）时迁移幂等照跑，补渲走
      // 各现读入口，不在此重复整页重画
      if (!reMigrated) {
        reMigrated = true;
        try { seedIfEmpty(curCid()); if (viewCid !== ALL && viewCid !== curCid()) seedIfEmpty(viewCid); } catch (e) {}
        try { window.renderCjian(false); } catch (e) {}
      }
    });
    // v3.33.x #409：联系人改名跟随——联系人管理改名（contacts.js renameContact 派发的
    // contact-renamed，此时该桌面 lbl-partner 已同步为新名）后，把该桌面名单里与旧名同名
    // 的梦角（自动播种的那位）一并改成新名。修：改名后此间梦角还挂旧名，与聊天顶栏/桌面
    // 显示对不上；且旧名一旦被别的联系人认领，旧逻辑会按名认亲把它反复搬桌（串桌根源之一，
    // 已随 fixBelonging 一次性化根治，本跟随让名字与身份保持同步不再产生漂移）。
    // 只跟随联系人管理改名；用户在梦角管理里手动改的名、别的桌面同名梦角都不动。
    document.addEventListener('contact-renamed', function (e) {
      try {
        const d = e.detail || {};
        const newName = String(d.name || '').trim(), oldName = String(d.oldName || '').trim();
        if (!d.id || !newName || !oldName || newName === oldName) return;
        const list = loadRoster(d.id);
        let dirty = false;
        list.forEach(c => { if (String(c.name || '').trim() === oldName) { c.name = newName; dirty = true; } });
        if (!dirty) return;
        saveRoster(list, d.id);
        todayCacheMap = {}; // 名字出现在今日预测里，一并作废
        const pg = document.getElementById('page-cjian');
        if (pg && !pg.hidden && typeof window.renderCjian === 'function') window.renderCjian(false);
      } catch (err) {}
    });
    setInterval(function () {
      tickApproach();
      if (pageVisible()) window.renderCjian(false);
    }, 30000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && pageVisible()) window.renderCjian(false);
    });
    // 分组条吸顶态：滚离顶部后才有底色/阴影（平时透明贴合页面渐变）。
    // rAF 合帧 + passive 监听，滚动主线程零阻塞（低端安卓也不抖）
    const scroller = document.getElementById('cj-main');
    if (scroller) {
      let stickTick = false;
      scroller.addEventListener('scroll', function () {
        if (stickTick) return;
        stickTick = true;
        requestAnimationFrame(function () {
          stickTick = false;
          const barEl = document.getElementById('cj-groups');
          if (barEl) barEl.classList.toggle('stuck', scroller.scrollTop > 4);
        });
      }, { passive: true });
    }
    const backBtn = document.getElementById('cj-back');
    if (backBtn) {
      backBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        // 详情打开时先返回列表；否则按来源返回
        if (!document.getElementById('cj-detail').hidden) {
          window.cjianCloseDetail();
          return;
        }
        if (window.__cjianFrom === 'chat') {
          const chatPage = document.getElementById('page-chat');
          if (chatPage) {
            document.querySelectorAll('.page').forEach(p => p.hidden = true);
            chatPage.hidden = false;
          }
        } else {
          document.querySelectorAll('.page').forEach(p => p.hidden = true);
          const phonePage = document.getElementById('page-phone');
          if (phonePage) phonePage.hidden = false;
        }
        window.__cjianFrom = '';
      });
    }
    const detailBack = document.getElementById('cj-detail-back');
    if (detailBack) detailBack.addEventListener('click', function (e) {
      e.stopPropagation();
      window.cjianCloseDetail();
    });
    const manageBtn = document.getElementById('cj-manage-btn');
    if (manageBtn) manageBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      window.cjianManage();
    });
    // 桌面「此间」图标：从桌面进入，返回时回桌面（聊天「更多功能」入口由 chat.js 接线，
    // 打开前会置 __cjianFrom='chat'；这里显式置空避免残留来源）
    const cjianApp = document.querySelector('.app[data-app="cjian"]');
    if (cjianApp) {
      cjianApp.addEventListener('click', function (e) {
        try {
          const editing = Array.from(document.querySelectorAll('.app-grid'))
            .some(g => g.classList.contains('editing'));
          if (editing) return; // 装修模式：不拦截，让 .app-grid 监听器弹「更换图标」菜单
        } catch (err) {}
        e.stopPropagation();
        window.__cjianFrom = '';
        window.openCjian();
      });
    }
    const perceiveBtn = document.getElementById('cj-perceive');
    if (perceiveBtn) perceiveBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (perceiveBtn.disabled) return;
      perceiveBtn.disabled = true;
      perceiveBtn.classList.add('busy');
      const r = window.cjianPerceive();
      if (r && r.lines) window.renderCjian(false);
      setTimeout(function () { perceiveBtn.disabled = false; perceiveBtn.classList.remove('busy'); }, 4000);
    });
    const addBtn = document.getElementById('cj-empty-add');
    if (addBtn) addBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      window.cjianManage();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
