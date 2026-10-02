// ===== 功能：信箱（仿星言简约版【星言信箱】，矢量图简约风格） =====
// 收信（TA 主动来信）/ 寄信 / 回信；信纸样式展示；聊天里插入写信/回信/来信提示
(function () {
  const store = window.activeStore();
  const KEY = 'mail-letters';
  // v3.7.x：LS 剥图快照兜底——对齐 feed.js feed-posts-snap。信件含图片 dataURL 时主键
  //   >200KB 只进 IndexedDB（LS 5MB 配额保护），Edge 杀后台/强制关闭丢 IDB 后信件全没。
  //   与 feed.js 同策略：剥掉图片 dataURL 只保文本，写一份 ≤200KB 的 LS 快照兜底。
  const SNAP_KEY = 'mail-letters-snap';
  const LS_BIG_LIMIT = 200 * 1024;
  // FIX 2026-09-30 #1469：暂存那一封也得能活过页面回收。#1358f/#1417/#1442 把「读不全就不许整包写回」
  //   立住之后，剩下的一条尾巴是：被挡下的那一发只活在内存 mailPending（快照是剥图文本版，且只在主键
  //   读空那一读才被兜），报障机（LS 整域写不进）上一次页面被回收＝那一封信又没了。
  //   改法＝给暂存单独一本旁路账（每联系人一份，走 xyStore 句柄＝内存＋LS＋IndexedDB），只在读数残缺
  //   的窗口里追加，任何一次权威整包落盘即销账。口径（作者 2026-09-30 选定）＝**只保新写的信**：
  //   读数残缺时「删除单封／清空信箱」当场按住并提示（见 deleteLetter/mailClearAll 那句
  //   xyBigWriteBlocked），所以这本账里只会出现新增与字段变化这一类单调追加——不会出现
  //   「用户删掉的信又被并回来」，因为那一发根本没被执行。
  const HOLD_KEY = 'mail-letters-hold';
  const TITLES = ['好久不见', '最近还好吗', '想你了', '给你写了封信', '深夜随想', '一些想说的话'];
  let mtab = 'in';
  let viewLetter = null;

  function partnerName() { return store.get('lbl-partner') || 'TA'; }
  function fmtDT(ts) {
    const d = new Date(ts);
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
  }
  // v3.6.x：load() 合并暂存——权威读取（mailDbReady=false）期间收到的信只暂存在
  // mailPending，原 load() 只读持久层 → 来信弹窗已提示「给你寄来了一封信」、信箱列表
  // 却是空白（OPPO 雨见浏览器 IndexedDB 打开/读取慢或挂起时真实复现）；这里把暂存
  // 信件按 id 合并在持久层之上，弹窗提示过的一切信件都可见可回可清角标。
  // v3.7.x：快照键用【动态】activePrefix——原实现模块加载时 const uid 固定，
  // 切到其它联系人桌面后 loadSnap/writeSnap 仍读写 default 桌面的快照：
  // 非 default 桌面信箱主键为空时兜底读到 default 桌面的信 → 串桌面 +
  // 「同一封信在谁桌面就显示谁的名字」（信箱是每桌面隔离数据，快照必须按桌面分开）
  // v3.7.x 多联系人来信：cid 指定该联系人桌面（后台遍历来信用），undefined 表示当前激活桌面
  function csFor(cid) { return cid ? window.storeFor(cid) : store; }
  function prefixFor(cid) { return cid ? ('xy-home-v2:' + cid) : window.activePrefix(); }
  function snapKey(cid) { return prefixFor(cid) + ':' + SNAP_KEY; }
  // FIX 2026-09-29 #1442：剥图快照改走数据层门面（xyStore）＝同一个键名、内存＋LS＋IndexedDB 三个 home——
  //   LS 整域被写满的机器（#1454 取证：同账号兄弟站点吃满配额、本项目写入被拒）上裸 localStorage
  //   一声不响地失败＝「兜底」根本不存在；走句柄后写不进 LS 还能落 IDB，读空窗口里写下的那一封
  //   才真有一条能活过页面回收的腿。键名逐字不变（句柄内部自己加前缀）⇒ 老快照照常读得到，无迁移。
  function snapStore(cid) { return cid ? window.xyStore(prefixFor(cid)) : store; }
  // ================= 媒体载荷形态：统一口径（FIX 2026-09-25 #1235） =================
  // 荣耀 100 + Edge 实报「回信 / 主动发信 / 联系人来信有乱码＝字卡库图片变成乱码与乱码令牌」，
  // 且明说多机型同现、此问题早年修过又回来了。根因不是机型，是信箱自己另写了一份「串首小写
  // data:image/」判定（#429/#386/#533 那批各补一种形态），而载荷形态由内核给出、无法约束：
  //   · File.type 为空时 FileReader 产出 "data:;base64,…"（无 MIME）；
  //   · 相册/文件管理器给 "data:application/octet-stream;base64,…"；
  //   · 导入备份与老库里是大写 MIME / 前导空白 / 「名称|||」前缀残留。
  // 变体既不被 renderBody 认作图、也不被 mailCleanDisplay 剥掉 ⇒ 整段 base64 当正文铺出＝所见
  // 乱码；令牌前挂着没剥净的名称串＝所见「乱码令牌」。chat.js #948 已把这件事收口成一份判据，
  // 判据不留第二份（BUGS #948 勿踩），下面四处消费者全部借它。
  const MAIL_DATAURL_SRC = '[Dd][Aa][Tt][Aa]:[a-zA-Z0-9.+-]*(?:\\/[a-zA-Z0-9.+-]+)?(?:;[^,]*)?,[^\\s"\'<>]+';
  // 「内联载荷切片」＝dataURL ∪ 媒体池令牌（清洗与摘要用；g 标志只配 replace，别配 test）
  const MAIL_PAYLOAD_RE = new RegExp(MAIL_DATAURL_SRC + '|@@m:[0-9a-f]{32}', 'g');
  // 「图片 dataURL」＝剥图/摘要里要收成 [图片] 的那些（媒体池令牌不在内：#681 快照必须留住令牌）
  const MAIL_IMGREF_RE = new RegExp(MAIL_DATAURL_SRC, 'g');
  // 摘要口径：连附图标记前缀一起摘（列表摘要不留「sticker:」这类半截标记）
  const MAIL_DESC_SLICE_RE = new RegExp('(?:sticker:|image:)?' + MAIL_DATAURL_SRC + '|(?:sticker:|image:)?@@m:[0-9a-f]{32}', 'g');
  // 是不是「可直接喂给 <img src> 的图片引用」（令牌 / image\/* / 内核会嗅探成图的无类型载荷）
  function mailIsImgRef(s) {
    if (window.chatIsImgSrcLike) return window.chatIsImgSrcLike(s);
    return (window.mochiMediaIsToken && window.mochiMediaIsToken(s)) || /^data:image\//i.test(String(s || ''));
  }
  // 落库口规范化（只改「写进去的形态」，逗号后的载荷一个字都不动）：
  //   无 MIME 的图片补回 MIME（chatFixNoMimeImg 按魔数定夺，认不出的原样交给清洗层收标注）；
  //   大写 data:/MIME 折成小写（renderBody、快照剥图与下游消费者都以小写形态为锚）。
  function mailCanonPayload(s) {
    if (typeof s !== 'string' || !/[dD][aA][tT][aA]:/.test(s)) return s;
    return s.replace(new RegExp(MAIL_DATAURL_SRC, 'g'), function (m) {
      const comma = m.indexOf(',');
      if (comma < 0) return m;
      const head = m.slice(0, comma);
      if (/^data:;/i.test(head) && window.chatFixNoMimeImg) {
        const fixed = window.chatFixNoMimeImg(m);
        if (fixed) return fixed;
      }
      return head.toLowerCase() + m.slice(comma);
    });
  }
  // v3.27.x 性能：load()/loadSnap 解析缓存——信件含 dataURL 时主键可达数百 KB，一次交互里
  // openMailPage（render+updateBadge）、openLetter（重查最新+标已读）会反复 JSON.parse 全量
  // 列表，是手机端信箱卡顿主因。原始串未变 ⇒ 复用上次的解析结果；返回时逐封浅拷贝——调用方
  // 普遍「改了 load 结果再 save」（read=true / unshift / 赋 myReply），共享对象引用会把未
  // 落盘的中间态漏进缓存。数据一变原始串必变 ⇒ 未命中自然失效，无需手动清。
  // 顺带收紧原实现的坏数据路径：raw 解析出非数组（旧实现 list=null/'…' 等继续往下走，
  // .length/.filter 抛错）统一按空列表处理，交给快照兜底与暂存合并。
  const _loadCache = new Map();
  function cachedParse(k, raw) {
    let list;
    const hit = _loadCache.get(k);
    if (hit && hit.raw === raw) {
      list = hit.list;
    } else {
      try { list = JSON.parse(raw); } catch (e) { list = null; }
      if (!Array.isArray(list)) return [];
      if (_loadCache.size > 8) _loadCache.delete(_loadCache.keys().next().value);
      _loadCache.set(k, { raw, list });
    }
    return list.map(x => (x && typeof x === 'object') ? Object.assign({}, x) : x);
  }
  function loadSnap(cid) {
    try {
      const k = snapKey(cid);
      const v = snapStore(cid).get(SNAP_KEY);
      if (v) return cachedParse(k, v);
    } catch (e) {}
    return [];
  }
  // 剥图：信件正文/回信/对方回信里的图片 dataURL 换 [图片]，快照只保文本历史
  function stripLetterImg(l) {
    if (!l || typeof l !== 'object') return l;
    const c = Object.assign({}, l);
    // FIX 2026-09-17 #681 快照只剥 dataURL、保留媒体池令牌（原实现把 @@m:hash 也剥成 [图片]）——
    //   令牌 44 字符不占快照预算，却是「图在哪」的唯一线索：权威主键（IDB）读不到时 load() 只剩
    //   快照，令牌留住才能由 media-pool 观察器解回真图（#665 软占位/有界重读可自愈），否则图永久
    //   退化成「[图片]」文字（同 #667 朋友圈快照口径）。通知/摘要处的令牌清洗保持不变。
    const strip = (s) => { if (typeof s !== 'string') return s; let t = s.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[图片]'); t = mailCleanDisplay(t); t = t.replace(MAIL_IMGREF_RE, '[图片]'); if (t.length > 8192) t = t.slice(0, 8192) + '…'; return t; };
    c.content = strip(c.content);
    if (c.myReply) { c.myReply = Object.assign({}, c.myReply); c.myReply.content = strip(c.myReply.content); }
    if (c.partnerReply) { c.partnerReply = Object.assign({}, c.partnerReply); c.partnerReply.content = strip(c.partnerReply.content); }
    return c;
  }
  function writeSnap(list, cid) {
    const ss = snapStore(cid);
    // FIX 2026-09-29 #1442：removeItem/setItem 换成同一句柄的 remove/set（键名与体积上限逐字照旧）——
    //   裸写在 LS 失效的机器上原本一声不响地失败＝「兜底」根本不存在；顺带落 IDB 之后，读空窗口里
    //   写下的那一封才真有一条能活过页面回收的腿。清空信箱时同样一起销账，免得库里那份旧快照在
    //   下一次读空时把已删的信并回来。
    if (!list || !list.length) { try { ss.remove(SNAP_KEY); } catch (e) {} return; }
    try { const snap = JSON.stringify(list.map(stripLetterImg)); if (snap.length <= LS_BIG_LIMIT) ss.set(SNAP_KEY, snap); } catch (e) {}
  }
  function load(cid) {
    const cs = csFor(cid);
    let list = [];
    const raw = cs.get(KEY);
    if (raw !== null) list = cachedParse(prefixFor(cid) + ':' + KEY, raw);
    // FIX 2026-09-28 #1358f：信箱补齐 #1336 给朋友圈那条尺——「这一轮同步层交不出主键」与
    //   「库里没信」是两件事。判据一律借数据层现成的那把（#1342 awaitingBigKey＝这一格内存与 LS
    //   双双为空，而 #1349 名册／#975 挂起名单说库里本该有一份），零机型／零 UA 分支。
    //   旧写法在 raw===null 时直接往下走 LS 剥图快照兜底；快照本身是 LS 那一层（v3.7.x 写它就是为了
    //   兜 Edge 丢库），而 LS 整域失效的机器上它恒 0 字节（本机诊断：LS 写探针 QuotaExceededError、
    //   本会话 2251 次写入被拒）⇒ 兜不出任何东西，页面却据此当面宣告「还没有收到信」，而库里 20 封
    //   完好、几百毫秒后那一份就回到了内存——只是没人再画一次。用户所见＝「前一秒还有，后一秒点进去
    //   突然没了，没有刷新或者更新」。
    //   现在：①这一轮标成残缺读数（空态改说「正在读取」，见 mailEmptyIsLie）；②这份残缺读数没有
    //   整包写回资格（见 save）；③借 #1358d 那个口，库里真交出整包时重画一次这一屏。
    if (raw === null && !cid && cs.awaitingBigKey && cs.awaitingBigKey(KEY)) {
      mailSyncCold = true;
      try { if (cs.whenBigKeyBack) cs.whenBigKeyBack(KEY, function () { try { render(); updateBadge(); } catch (e0) {} }); } catch (e) {}
    } else if (raw !== null || !cid) mailSyncCold = false; // #1469s 现证不成立就复位：旧写法只在「读得到值」时复位＝主键真不在库里（raw 恒 null）时这一位永远留着，于是 save() 永远走残缺分支、#1469 的「按住」也永远抬不起来（新尺丁7 实测连按 8 轮全是那句提示，而四条证据当场都已不成立）
    // FIX 2026-09-29 #1417：读到值也可能是旧账（见 mailStaleLs）——同样标残缺读数（提示条改口、
    //   没有整包写回资格），并当场自动踢一趟「库里那份问回来就合并」，不必等用户去点按钮。
    if (mailStaleLs(cid)) { mailSyncCold = true; mailRescueArm(cid); }
    // v3.7.x：主键缺失兜底——大列表只进 IDB（Edge 丢 IDB / LS 被清）时读剥图快照，
    //   文本+标题+时间保留；IDB 存活时模块底部 idbGet 会随后用完整数据重渲染
    // FIX 2026-09-30 #1469p：本会话已权威落过整包 ⇒ 这一本兜底一并关掉。清空那一发落的就是空整包，
    //   主键读回来是 []，旧写法下一步就去读快照——快照的 IDB 副本此刻可能还在（remove 的 idbDelete
    //   与按需取回在同一场里会换位，实测：库里 0 封、屏上 21 封），于是「用户亲手清空」在屏上被撤销。
    //   与 #1469o 给库合并那一趟立的同一条规矩：本场写过＝本地这份就是答案，任何迟到的旧副本只许补字段。
    if (!list.length && !mailLocalAuthored) { try { const v = loadSnap(cid); if (v.length) list = v; } catch (e) {} }
    // v3.7.x：暂存合并仅对当前桌面（cid undefined）生效——mailPending 是当前桌面
    //   contact-switched 时的暂存，后台遍历其它 cid 时不并入（避免串桌面）
    // FIX 2026-09-28 #1358f：残缺期同样要并入——这一轮不写权威键，增量只靠 mailPending 留在屏上
    // FIX 2026-09-30 #1469：并入条件从「写闸关着或读数残缺」改成「只要手上有暂存」——旧条件在
    //   「有界重试耗尽／库确实没有这一格」这两条放行路上会让暂存的信当场从屏上消失（闸一开 load 就
    //   不再并它，而它还没落进主键）。暂存的唯一销账点是「权威整包落盘」，落盘前它必须一直看得见；
    //   mergeLists 按 id 认身份、字段各取有值一方 ⇒ 与库里那份重复也不会列两遍。
    // FIX 2026-09-30 #1469：手上还没有暂存、而旁路账里有一份（＝上一场读不全时写下的那一封，而这一场
    //   开机那一灌赶在回填把该键读进内存之前扑了空）⇒ 读的时候当场顺手灌上，不依赖任何事件时序。
    //   并且：只要手上还攥着暂存就顺手请一次库（#1349 那只单次飞行闸＋#1417 那趟合并，8s 节流），
    //   否则旁路账永远只是一份「看得见、落不了地」的显示副本——启动那发权威读得早（读到的还是残缺那份
    //   或压根没轮到），之后再没人来并回，下一场又从头暂存一遍。
    try {
      if (mailLocalAuthored) { /* #1469p 本场已权威落过整包＝这一本旁路账不再认（清空那一发落的是空整包，回灌＝把用户刚删掉的又端回屏上） */ }
      else if (!cid && !mailPending) { const h0 = mailHoldLoad(); if (h0) { mailPending = h0; mailRescueArm(cid); } }
      else if (!cid && mailPending.length && !mailRescueFlight) mailRescueArm(cid); // #1469n 攥着暂存＝问到库并回为止（无在飞才补踢，不叠发）
    } catch (eR) {}
    if (!cid && mailPending && mailPending.length) {
      const map = {};
      list.forEach(x => { if (x && x.id) map[x.id] = x; });
      mailPending.forEach(x => { if (x && x.id) map[x.id] = x; });
      list = Object.keys(map).map(k => map[k]).sort((a, b) => (b.tm || 0) - (a.tm || 0));
    }
    return list;
  }
  // 按 id 合并两个信件列表（后者覆盖同 id），按 tm 倒序
  // v3.26.x：剥图回填——大信件超 200KB 时 LS 只有剥图快照（正文图片 dataURL 被剥成 [图片]），
  //   IDB 里是完整版；原实现后者(b=本地快照)整体覆盖同 id 的完整版 → 联系人用表情包写信/
  //   回信，信箱只显示「图片」两个字的文字。改为同 id 时优先保留「含真实 data:image」的那版
  //   （包含图片 → 完整版），彻底去掉剥图占位；两侧都无损时才按内容长度取更完整一方。
  function letterLen(o) {
    let n = 0;
    const a = o && typeof o.content === 'string' ? o.content : '';
    const b = o && o.myReply && typeof o.myReply.content === 'string' ? o.myReply.content : '';
    const c = o && o.partnerReply && typeof o.partnerReply.content === 'string' ? o.partnerReply.content : '';
    return a.length + b.length + c.length;
  }
  function hasRealImg(o) {
    const s = [o && o.content, o && o.myReply && o.myReply.content, o && o.partnerReply && o.partnerReply.content].join(' ');
    return /data:image\//.test(s || '') || (!!window.mochiMediaIsToken && s.split(' ').some(window.mochiMediaIsToken));
  }
  function mergeLists(a, b) {
    const map = {};
    const longer = (x, y) => (String(x || '').length >= String(y || '').length) ? x : y;
    const put = (x) => {
      if (!x || !x.id) return;
      const prev = map[x.id];
      if (!prev) { map[x.id] = x; return; }
      // v3.26.x：字段级合并——同 id 信件，content/myReply/partnerReply/read 各取更完整
      // 的一方，不再整体覆盖。原实现按 letterLen 取更大一方：剥图快照版（content 空 +
      // myReply 有）与 IDB 完整版（content 有 + myReply 空）合并时，若 IDB content 长度
      // > myReply 长度则取 IDB 版丢 myReply，反之取快照版丢 content → 回信后 content 或
      // myReply 丢失，点开信件空白，直到 TA 回信（partnerReply 落地使整版 letterLen 最大
      // 胜出）才显示（红米 K80 Chrome 反馈根因）。字段级合并保证任一字段有值即保留。
      const merged = Object.assign({}, prev);
      const xImg = hasRealImg(x), pImg = hasRealImg(prev);
      if (xImg && !pImg) merged.content = x.content;
      else if (!xImg && pImg) merged.content = prev.content;
      else merged.content = longer(x.content, prev.content);
      if (x.myReply && !prev.myReply) merged.myReply = x.myReply;
      else if (prev.myReply && !x.myReply) merged.myReply = prev.myReply;
      else if (x.myReply && prev.myReply) {
        merged.myReply = Object.assign({}, longer(String(x.myReply.content||'').length >= String(prev.myReply.content||'').length ? x.myReply : prev.myReply));
      }
      if (x.partnerReply && !prev.partnerReply) merged.partnerReply = x.partnerReply;
      else if (prev.partnerReply && !x.partnerReply) merged.partnerReply = prev.partnerReply;
      else if (x.partnerReply && prev.partnerReply) {
        merged.partnerReply = Object.assign({}, longer(String(x.partnerReply.content||'').length >= String(prev.partnerReply.content||'').length ? x.partnerReply : prev.partnerReply));
      }
      if (x.read || prev.read) merged.read = true;
      map[x.id] = merged;
    };
    (a || []).forEach(put);
    (b || []).forEach(put);
    return Object.keys(map).map(k => map[k]).sort((x, y) => (y.tm || 0) - (x.tm || 0));
  }
  // v3.5.120：信箱权威加载防护——修复「刷新后信箱数据丢失」：
  // 信箱数据导入后只在 IndexedDB（备份把它归为大键），localStorage 空时
  // load() 返回 []，此时任何 save([]) 都会用空列表覆盖 IDB 里的全部信件。
  // 权威未从 IDB 读回前，save 只暂存内存、绝不落盘。
  let mailDbReady = false;
  let mailPending = null;
  // FIX 2026-09-26 #1309b：「这一键没读到」与「库里确无此键」必须分开（小米 14U/Edge 实报
  //   「信箱里的信都没有了」＋「一直会丢数据」，用户明说其他机型同现）。idbGet 对这两种情况
  //   都回 undefined，唯一证人＝info.ambiguous；旧写法读到 undefined 也照样 mailDbReady = true，
  //   于是 load() 交出空列表 → 用户下一次再正常不过的寄信把 IDB 里全部旧信整包抹掉
  //   （本批电池在纯 HEAD 产物上实测：5 封 → 1 封，且丢了就永久救不回来）。
  //   尺子同源、零机型／零 UA 分支：idbListKeys/idbHasKey 的「null＝这次没读到」契约（#90）、
  //   feed.js 的 #187 写闸、#229 有界重试、#785 数据就绪三态——判据只取「内核回没回话」。
  let mailAuthOk = false;   // 权威真回过话：读到值 / count 探针证实库里没有 / 重试预算耗尽按旧语义放行
  let mailAuthTries = 0;
  const MAIL_AUTH_BACKOFF = [600, 1500, 4000, 9000, 20000];
  // 写闸＝两把锁都在：mailDbReady（暂存期结束）＋ mailAuthOk（权威确实回过话）。
  // 只认前一把＝本批要收口的病灶（保险丝也能单独开门，见 mailFuseFlush）。
  function mailWriteOpen() { return mailDbReady && mailAuthOk; }
  // FIX 2026-09-28 #1358f：本轮同步层交不出主键（#1195e 放掉内存副本／启动预算挂起）＝读数残缺，
  //   不是「没信」。与 #1336 给朋友圈那条同名同判据，值回到内存的那一读会把旗摘掉。
  let mailSyncCold = false;
  function mailEmptyIsLie() { if (mailSyncCold) return true; return !mailAuthOk || !!(window.mochiDataPending && window.mochiDataPending()); }
  // 15s 保险丝同样不许把「读不到」当成「没有」：库里确实有这一键却读不回值时落盘＝用读空的
  // 列表整包抹掉那些读不到的旧信；此时保持关闸，让有界重试继续跑（重试预算耗尽才放行）。
  function mailFuseFlush(cb) {
    if (mailAuthOk || !window.idbHasKey) { cb(); return; }
    try {
      window.idbHasKey(window.activePrefix() + ':' + KEY).then(function (exists) {
        if (exists === true) { try { render(); updateBadge(); } catch (e) {} return; }
        cb();
      });
    } catch (e) { cb(); }
  }
  // ================= FIX 2026-09-29 #1417：信箱「读到旧账」与自救恢复 =================
  // 报障（红米 K80 Chrome／作者明说其他机型同现）：「后台通知弹窗说 20:21 联系人回了一封信，
  // 点进信箱就是找不到这封新信」。前面 #1454 那只只读取证口逐字读数：那封信**就在 IndexedDB 里**
  // （库直读 150 封／带 TA 回信 6 封／最近 09/29 20:21），而这台机的 localStorage 写不进去
  // （本会话 213 次写入被拒）⇒ 同一格停在 09/26 的旧账（145 封／带 TA 回信 5 封）。而 xyStore.get
  // 的读序是「内存 → LS」、从不读 IDB ⇒ 每次冷启动／页面被系统回收后重开，读到的都是那份旧账，
  // 那封信就「不见了」。更危险的是写回侧：save() 原来的残缺旗只在「读空」时落下，这台机是
  // 「读到了旧值」⇒ 闸不落 ⇒ 下一次再正常不过的寄信会把库里那整包换成这页旧账，那 5 封（含回信）
  // **永久丢失**。本批按「判据只有一份」的口径收口三件事：
  //   ① 读侧：读到旧值也认成残缺读数（数据层的 cs.lsStale＝本批新增的第五格证据）；
  //   ② 写侧：残缺读数没有整包写回资格（沿用 #1358f 那一道闸，判据合一，不再各写一份）；
  //   ③ 恢复：库里那份问回来即字段级合并并重绘（mailRescueRun）——list 渲染时自动踢一趟，
  //      并给用户一个当场可点的「从本地库找回」按钮（作者直派「有没有什么自己点击修复的功能」
  //      →「并且也需要新增自救的恢复按钮」）。
  // 零机型／零 UA 分支：只问「这一格的 LS 是不是写失败留下的旧值」「库里交没交出整包」。
  let mailLibMerged = false; // 本会话已从库里合过一次：合过之后内存那份即权威，旧 LS 不再作数
  // FIX 2026-09-30 #1469：本会话有没有权威落过整包。落过＝本地这份就是答案，稍后任何一趟库读
  //   只许给它补字段、不许再往里补条目——否则用户刚点完「清空所有信件」，一趟在飞的库读把那 21 封
  //   原样写回库里（#1442 尺子丁5「不许复活已删的信」当场逮到）。与 #1330 给收藏定的
  //   「本会话用户在看得见的列表上写过即永不再补」同一条口径。
  let mailLocalAuthored = false;
  // FIX 2026-09-30 #1469o 收窄：只有「本会话落过空整包」＝用户亲手清空过，这一场的库里回读才整个不许再并。
  //   原样用 mailLocalAuthored（落过任何整包就不并）会把 #1417 的战果反过来弄没：那台机 LS 停在 145 封的旧账、
  //   库里有 150 封（含当天那封回信），用户这一场只要写过一封就永不并库里那份＝「后台通知说有回信、点进信箱
  //   找不到」复发（邻族电池 verify-1417-mail-stale-ls 的 A4/A4b/B2 三条当场抓到）。
  let mailClearedThisSession = false;
  // FIX 2026-09-30 #1469r：「读不全」这个判断在一种真实形状下会永远为真——名册／挂起名单／__big-idx
  //   证人都只是「本该有一份」的旁证，而库里那份可能真被摘掉了（#1361a 就为这个留了 bigHydAbsent 那一格：
  //   只有健康连接确认过库里确实没有，才作废证人）。报障机上这一型不是假设：新尺丁7 实测连按 8 轮、
  //   每轮都是那句提示，删除与清空在这一台机上变成「永远删不掉」＝把 #1342 那条「不把这道闸变成新的存不
  //   进去」直接违了。出口就是数据层现成的那把三态尺（#1361n：读空不许直接落笔，先去库里问，只有
  //   'absent' 才算把「空」当成了答案）：问到 'absent' ⇒ 这一格的三把残缺证据一并作废，下一次点就落地。
  let mailBlindCleared = false;
  function mailStaleLs(cid) {
    if (cid || mailLibMerged) return false;
    try {
      const cs = csFor(cid);
      return !!(cs.lsStale && cs.lsStale(KEY));
    } catch (e) { return false; }
  }
  // 这一轮读数残缺（＝屏上这份不能当「答案」，也没有整包写回资格）：读空（#1358f）或读到旧账（#1417）
  function mailReadIncomplete(cid) { return (!cid && mailSyncCold) || mailStaleLs(cid); }
  // 自救恢复：直读本地库那一份 → 字段级合并（mailMergeFromIdb：基准＝库，并集保留本地独有）→
  //   写回并清残缺旗 → 重绘并当场报读数。单次飞行：同一时刻只许一发在问库，其余搭车同一发结果。
  let mailRescueFlight = null;
  let mailRescueNextAt = 0;
  function mailRescueRun(cid, cb) {
    const done = function (r) { try { if (cb) cb(r); } catch (e) {} };
    if (mailRescueFlight) { mailRescueFlight.push(done); return; }
    if (!window.idbGet) { done({ ok: false, why: 'noidb' }); return; }
    mailRescueFlight = [done]; // 先占飞行位再读屏上封数：load 会重进本函数，靠这一位挡住第二发
    let before = 0;
    try { before = (load(cid) || []).length; } catch (e) {}
    const finish = function (r) {
      const f = mailRescueFlight || [];
      mailRescueFlight = null;
      f.forEach(function (fn) { fn(r); });
    };
    const info = {};
    try {
      Promise.resolve(window.idbGet(prefixFor(cid) + ':' + KEY, info)).then(function (v) {
        if (typeof v !== 'string' || v.length <= 2) { finish({ ok: false, why: info.ambiguous ? 'ambiguous' : 'absent' }); return; }
        try { mailMergeFromIdb(v, cid); } catch (e) {}
        mailLibMerged = true;
        mailSyncCold = false;
        let after = 0, rp = 0;
        try {
          const arr = load(cid) || [];
          after = arr.length;
          arr.forEach(function (x) { if (x && x.type === 'received' && x.partnerReply) rp++; });
        } catch (e) {}
        try { render(); updateBadge(); } catch (e) {}
        finish({ ok: true, before: before, after: after, rp: rp });
      }, function () { finish({ ok: false, why: 'fail' }); });
    } catch (e) { finish({ ok: false, why: 'throw' }); }
  }
  // 自动那一趟：库忙时别把主线程塞满，同一键 8s 内只问一次（用户手动点按钮走 mailRescueRun，不受此限）
  function mailRescueArm(cid) {
    if (mailRescueFlight) return;
    const now = Date.now();
    if (now < mailRescueNextAt) return;
    mailRescueNextAt = now + 8000;
    mailRescueRun(cid);
  }
  // 用户能点的自救入口：说清这一发到底抢回了什么（读不出来也如实说，不假装成功）
  function mailRescueClick() {
    if (mailRescueFlight) { toast('正在从本地库读取…'); return; }
    toast('正在从本地库找回…');
    mailRescueRun(undefined, function (r) {
      if (r && r.ok) toast('已从本地库合并：屏上 ' + r.before + ' → ' + r.after + ' 封' + (r.rp ? '（带 TA 回信 ' + r.rp + ' 封）' : ''));
      else if (r && r.why === 'absent') toast('本地库里没有这一格（可能从未落地）');
      else if (r && r.why === 'noidb') toast('这台设备没有可用的本地库');
      else toast('本地库这次没读出来（存储正忙）：过几秒再点一次');
    });
  }
  window.mailRescueRun = mailRescueRun; // #1417：别的入口（诊断页等）要复用时走这一条，别再写第二套口径
  // 读到旧账／读空时列表上方如实说一句＋当场给一个可点的自救入口
  function mailRescueStrip() {
    if (!mailReadIncomplete(undefined)) return '';
    return '<div class="mail-rescue-tip"><span class="mail-rescue-txt">这次没读全（本地存储正忙），可能有信没显示出来</span>' +
      '<button class="cc-tool" id="mail-rescue">从本地库找回</button></div>';
  }
  // 三态权威加载（启动与切桌面共用）：confirmed 才交 mailMergeFromIdb 合并并开门；
  // ambiguous 先让 idbHasKey（count 单键，比取值轻得多，MB 级写入排队时也挤得进去）分辨
  // 「有却读不回」与「确无此键」——前者关闸重试，后者按「库里没有」开门（新装用户第一封信
  // 必须直接落盘，C3 对照）。guard 返回 false＝本次作废（已切走／保险丝已抢先）。
  function mailAuthAsk(cid, guard, after) {
    if (!window.idbGet) { mailAuthOk = true; mailDbReady = true; after(); return; }
    const myPrefix = window.activePrefix();
    const info = {};
    const stale = function () { return (guard && guard() === false) || window.activePrefix() !== myPrefix; };
    const answered = function (v) {
      if (stale()) return;
      if (!info.ambiguous) {
        mailAuthOk = true;
        mailMergeFromIdb(v, cid);
        mailDbReady = true;
        after();
        return;
      }
      if (!window.idbHasKey) { mailAuthDelay(cid, guard, after); return; }
      window.idbHasKey(myPrefix + ':' + KEY).then(function (exists) {
        if (stale()) return;
        if (exists === false) { mailAuthOk = true; mailDbReady = true; after(); return; }
        mailAuthDelay(cid, guard, after);
      });
    };
    try {
      Promise.resolve(window.idbGet(myPrefix + ':' + KEY, info)).then(answered, function () {
        if (!stale()) mailAuthDelay(cid, guard, after);
      });
    } catch (e) { mailAuthOk = true; mailDbReady = true; after(); }
  }
  function mailAuthDelay(cid, guard, after) {
    if (mailAuthTries >= MAIL_AUTH_BACKOFF.length) {
      // 有界重试耗尽＝这台机这一会话读不回来了。按旧语义放行（宁可退回旧行为，也不把用户的
      // 来信永久卡在内存里——那才是「弹窗说有信、信箱是空的」那一族 iQOO/X5 实报的根因）
      // FIX 2026-09-29 #1417：但「放行」不等于「就这样了」——原实现只开门、**不合并库里那份**，
      //   于是屏上永远停在同步口交回的旧账（报障机 LS 写不进去 ⇒ 读到的 09/26 那 145 封成了
      //   「最终答案」，当天那封回信躺在库里却再没人画一次）。开门之前先把库里那份问一次并合并，
      //   合并失败仍按旧语义放行（那两条约束不冲突：一个是别丢用户的信，一个是别拿旧账当答案）。
      mailRescueRun(cid, function () { mailAuthOk = true; mailDbReady = true; after(); });
      return;
    }
    const wait = MAIL_AUTH_BACKOFF[mailAuthTries++];
    try { if (window.__mochiPhase) window.__mochiPhase('mail-auth-retry:' + mailAuthTries); } catch (e) {}
    setTimeout(function () { mailAuthAsk(cid, guard, after); }, wait);
  }
  // FIX 2026-09-29 #1442：写回前先问数据层那一句尺——「这一桌面此刻交不交得出权威读数」。
  //   #1361b 的静默版：拦下的同时顺手请一次库（单次飞行闸），库值回来后写回资格自然恢复。
  //   三条后台通路（来信/到期回信/摸鱼小结）在生成前各自让路（见三处 mailBlindRead 调用点），
  //   save() 这一道只是兜底：当前桌面的信照旧并入 mailPending＋快照，不凭空蒸发。
  function mailBlindRead(cid) { if (!cid && mailBlindCleared) return false; return !!window.xyBigWriteHold(csFor(cid), KEY); } // #1469r
  // 旁路账的读写：走同一句柄（内存＋LS＋IndexedDB），只在有内容时留键，空了就三处一起销账。
  function mailHoldSave(arr, cid) {
    try {
      const cs = csFor(cid);
      if (arr && arr.length) cs.set(HOLD_KEY, JSON.stringify(arr));
      else cs.remove(HOLD_KEY);
    } catch (e) {}
  }
  function mailHoldLoad(cid) {
    try {
      const v = csFor(cid).get(HOLD_KEY);
      if (!v) return null;
      const a = JSON.parse(v);
      return Array.isArray(a) && a.length ? a : null;
    } catch (e) { return null; }
  }
  // 权威整包落盘之后对账（销账不许无条件做）：
  //   ① 这一格此刻还读不到（启动回填排在后面）⇒ 什么都不动——这时判「没有」会把库里那本旁路账删掉；
  //   ② 读得到且每一封都已被这一包收进去 ⇒ 销账；
  //   ③ 读得到但这一包漏了其中几封（＝库里那份读回来之前先落了一次整包，例如暂存刚写入而权威读回得早）
  //      ⇒ 把漏的那几封留在账上并挂回 mailPending（屏上继续看得见），等库里那份读回来再并。
  //   没有这一道，「先写后销」会把用户那一封两头落空＝本批要修的东西换了个位置重演一遍。
  function mailHoldReconcile(cid, written) {
    try {
      const cs = csFor(cid);
      if (cs.awaitingBigKey && cs.awaitingBigKey(HOLD_KEY)) return;
      // 这一包是「权威整包」⇒ 落它的时候账上的内容要么已被收进来、要么用户本就是要用这一包取代它
      //   （含清空）。曾经写过一版「漏了哪几封就留在账上」，结果用户亲手清空之后那几封被下一趟合并
      //   带了回来＝丁5 禁止的复活，故收回。配套：mailMergeFromIdb 合并时把账上内容一起收进来，
      //   所以「先写后销」不再有两头落空那一格。
      mailHoldSave(null, cid);
      if (!cid) mailPending = null;
      void written;
      if (!cid) mailLocalAuthored = true; // 这一场已经权威落过一次整包＝本地这份就是答案，库里那份只许补字段
    } catch (e) {}
  }
  // 用户动作（删除／清空）能不能当场执行：判据＝「库对这一格回过话，且手里这份不是残缺读数」。
  //   #1342i 那句只回答「这一格现在读不读得到」，而 LS 坏掉／主键读不出来的机器上那一问可以永远为真，
  //   拿它单独挡删除＝把 #1309 C2「主动清空必须真落空」永久挡死（#1442 尺子丁4/丁5 当场逮到：
  //   清空点了没落库，快照里那一本原封不动）。所以这里以「权威有没有回过话」为主：
  //   没回话＝不许按（正是要挡的那一型），回过话＝按手里这份执行，读不全的另外两格照样挡。
  function mailWriteBlockedNow(what) {
    let blocked = false;
    try { blocked = !mailWriteOpen() || mailReadIncomplete() || mailBlindRead(); } catch (e) { blocked = false; }
    if (!blocked) return false;
    try { window.xyBigWriteBlocked(csFor(), KEY, what, true); } catch (e2) {} // 同一句提示＋顺手请一次库
    // #1469r 按住不等于撒手：借数据层那把三态尺问一句「库里到底有没有这一本」。
    //   'absent' ＝ 健康连接证实没有 ⇒ 这一格的残缺证据作废，用户下一次点同样的东西就落地；
    //   'ok' ＝ 库里那份刚取回内存，#1358d 那条回调会重画这一屏（下一次点拿到的就是完整那一本）；
    //   'unknown' ＝ 这一问也没问出结果 ⇒ 继续按住，这正是该按住的样子。
    try {
      const ask1469 = window.idbEnsureBigKey ? window.idbEnsureBigKey(KEY) : null;
      if (ask1469 && ask1469.then) ask1469.then(function (st) {
        if (st !== 'absent') return; // #1469r 只有健康连接的「确认没有」才作废残缺证据
        mailBlindCleared = true;
        mailSyncCold = false;
        try { render(); updateBadge(); } catch (e5) {}
      }, function () {});
    } catch (e6) {}
    return true;
  }
  function save(list, cid) {
    // v3.7.x：cid undefined = 当前桌面，走 mailDbReady 门槛（防启动早期 save([]) 覆盖 IDB）；
    //   cid 指定 = 后台遍历该联系人来信，直接写（maybeIncomingLetterFor 已确认该桌面
    //   load 非空才 unshift，不会用 [新信] 覆盖 IDB 旧信）
    // v3.7.x：未就绪时除暂存内存外立即写剥图快照（对齐 chat.js 同场景的 LS 快照兜底）——
    //   原实现只进 mailPending 内存、保险丝(15s)触发前页面被杀/重载则来信整封丢失，
    //   而聊天通知已持久化 → 用户看到「联系人来信」信箱却是空的（iQOO Neo5 SE +
    //   QQ浏览器 X5 IDB 挂起实测）。快照仅文本兜底，IDB 权威读回后 mailMergeFromIdb
    //   按 id 合并恢复完整数据（含图片），不破坏权威防护（主键 store.set 仍等就绪）。
    if (!cid && !mailWriteOpen()) { try { mailPending = (list || []).slice(); } catch (e) {} mailHoldSave(mailPending, cid); // #1469a 未就绪那一支也落账
      // FIX #1469：冷分支不再顺手写剥图快照——暂存现在有自己的落盘腿（旁路账），快照留到读数落定、
      //   真正写回主键那一发再一起刷新。早先这一支会在事后被迟到的写回重复刷一遍（#1442 尺子丁6 实测）。
      return; }
    //   手上一页空纸盖进库里那 20 封，就是「点进去没了、之后真的没了」。增量并进 mailPending 留在
    //   屏上，等 #1358d 那一趟把整包问回来再照常落盘（#1469 起：暂存落旁路账，快照由落盘那一发统一刷新）。
    // FIX 2026-09-29 #1417：判据合一——残缺读数（读空 #1358f ／读到「写失败留下的旧值」 #1417）
    //   都没有整包写回资格：手上一页旧账盖进库里那整包，就是那封回信的永久丢失。增量并进
    //   mailPending 留在屏上，并顺手把库里那份问回来（问回来＝字段级合并＋恢复写回资格）。
    // FIX 2026-09-29 #1442：判据再并一枚——数据层那句尺（xyBigWriteHold）说「此刻交不出权威读数」
    //   时同样没有整包写回资格（#1195e 切后台按体积放掉内存副本的窗口里，load 交出的可能是空页
    //   或旧账）。当前桌面这一发照旧并入 mailPending＋快照，等权威读数回来再落盘。
    if (mailReadIncomplete(cid) || mailBlindRead(cid)) {
      try { mailPending = mergeLists(mailPending || [], list || []); } catch (e) {}
      mailHoldSave(mailPending, cid); // #1469b 残缺读数那一支：暂存当场落盘，页面被回收也带得走
      mailRescueArm(cid);
      return;
    }
    csFor(cid).set(KEY, JSON.stringify(list));
    mailLocalAuthored = true; // #1469：本会话已权威落盘＝屏上这一本就是答案（回灌那三条路关掉）
    if (!cid && !list.length) mailClearedThisSession = true; // #1469o 落的是空整包＝用户亲手清空，稍后任何一趟库读都不许把那本带回来
    mailHoldReconcile(cid, list); // #1469c 权威整包落盘后销账（读不到那一格才不动）
    if (!cid) mailPending = null; // #1469q 内存这一份照旧作废——销账被「那一格读不到」挡住时也一样，屏上不许还攥着刚写进库（或刚清空掉）的那些
    writeSnap(list, cid);
  }

  // #1402 信箱「未读」的唯一口径：徽标数与列表顶部常驻区必须同进同退（常驻区条数 === 徽标数），
  // 否则折叠之后红点亮着、列表里却找不到那封信。
  function mailIsUnread(l) { return l.type === 'received' && !l.read && !l.myReply; }
  // v3.5.99：桌面「信箱」图标未读角标——有新来信（未读）时显示数字，进入信箱或打开信件后清除
  function updateBadge() {
    const badge = document.getElementById('mail-badge');
    if (!badge && !window.setDeskBadge) return;
    try {
      const unread = load().filter(mailIsUnread).length;
      if (window.setDeskBadge) { window.setDeskBadge('mail', unread); return; }
      if (!badge) return;
      if (unread > 0) {
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    } catch (e) {}
  }

  // v3.5.107：信箱前台弹窗辅助——当前是否在信箱页（在信箱页内时来信/回信不弹横幅）
  function mailPageVisible() {
    return ['page-mail', 'page-mail-write', 'page-mail-reply'].some(id => {
      const el = document.getElementById(id);
      return el && !el.hidden;
    });
  }
  // 打开信箱页（渲染 + 清角标），供信箱图标点击与弹窗点击共用
  // v3.10.x：暴露给 chat.js——聊天里的信件通知（写了一封信/给你回了信等）可点击直达
  function openMailPage() {
    // v3.27.x 性能：先显示 page-mail 再补查/渲染——render() 现在只在信箱页可见时干活
    //（后台落地路径不再白建列表 DOM），进页这一刻按需渲染；红米 K80「先可见再写入」
    // 防御口径同 submitReply/sendLetter。
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const mp = document.getElementById('page-mail');
    if (mp) mp.hidden = false;
    // v3.9.x：打开信箱立即补查到期回信/来信——iOS 短会话里 60s 定时器往往没机会跑，
    // 用户「点开信箱」这一刻正是最该看到 TA 回信的时刻
    try { checkPendingReply(); } catch (e) {}
    render();
    updateBadge();
  }
  window.openMailPage = openMailPage;
  // 写信纸 HTML（简约卡片：标题 + 寄信人/时间 + 正文）
  // 正文支持字卡库图片（dataURL）直接显示；图片/表情包都是字卡，统一渲染为
  // 同尺寸缩略图（sticker:/image: 前缀仅作历史类型标记，不再区分显示大小）
  // v3.6.x：完整 HTML 转义（只转 < 可被 `&lt;…&gt;` 实体绕过注入）
  function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  // v3.x.x：称呼跟随——TA 写的信在显示层替换 TA/他（fit 参数，我写的信保持原文）
  // v3.26.x：独立附图识别——表情包/图片支持 base64 dataURL、svg 类非 base64 dataURL
  //   与带 sticker:/image: 前缀的外链图，统一渲染为缩略图（解决聊天正常、信箱墨水/信
  //   件表情包只显示文字）。无附图前缀的 http 链接仍当普通文本（不误判正文网址）。
  function renderBody(content, fit) {
    // FIX 2026-09-13 #429 渲染端清洗：剥存量落盘信件的「名称|||」前缀残留与 audio 等非图片
    //   base64（只洗显示不改历史数据，同 #426 calCleanMsg 口径）；图片 dataURL/令牌仍走下方 RE 内联渲染
    const s = mailCleanDisplay(String(content || ''));
    const seg = (t) => {
      t = String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      return (fit && window.taFit) ? window.taFit(t) : t;
    };
    // FIX 2026-09-25 #1235 dataURL 分支不再赌「小写 image/ ＋带 MIME」这一种形态：File.type 为空
    //   时 FileReader 产出 "data:;base64,…"，相册/文件管理器给 "application/octet-stream"，导入与
    //   老库还有大写 MIME——旧写法一概不认＝整段 base64 当正文铺出＝用户所见乱码。判据借 chat.js
    //   #948 那份（唯一口径，见文件顶部）：是图片引用才渲 <img>，其余内联载荷收成标注。
    const RE = /((?:sticker|image):)?(https?:\/\/[^\s"'<>]+|[Dd][Aa][Tt][Aa]:[a-zA-Z0-9.+-]*(?:\/[a-zA-Z0-9.+-]+)?(?:;[^,]*)?,[^\s"'<>]+|@@m:[0-9a-f]{32})/g;
    return s.replace(RE, function (all, pre, src) {
      if (src.indexOf('http') === 0 && pre !== 'sticker:' && pre !== 'image:') {
        return seg(all); // 普通网址（无附图前缀）按文本保留
      }
      // 清洗层已把非图片载荷收成 [附件]；走到这里仍不是图片引用的（旁路进来的存量/导入）
      // 一律不再铺载荷——渲染端兜底，与聊天侧 mochiInlineTextHtml 同口径。
      if (!mailIsImgRef(src)) return seg(window.chatIsDataAudioSrc && window.chatIsDataAudioSrc(src) ? '[语音]' : '[附件]');
      const real = (window.chatFixNoMimeImg && window.chatFixNoMimeImg(src)) || src; // 无 MIME 图片补正 MIME（引擎嗅探不可依赖）
      const attrs = String(real).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      // v3.27.x 性能：decoding="async"——dataURL 图默认同步解码占弹层首帧（点开带图
      // 信件时的迟滞来源），异步解码让位主线程；与桌面/聊天/朋友圈图片同款做法。
      // 不加 loading="lazy"（dataURL 无网络请求，lazy 无效）。
      return '<img class="mail-body-img" decoding="async" src="' + attrs + '" alt="表情"> ';
    });
  }
  // 信箱列表摘要：剔除图片/表情包 dataURL（含标记前缀），避免显示超长 base64 乱码
  // v3.9.x：补 HTML 转义——shortDesc 结果直接拼 innerHTML（render 列表项），未转义
  //   可被含 < > 的信件内容注入 HTML（导入恶意备份 XSS）
  function shortDesc(s, fit) {
    // FIX 2026-09-13 #429 补「名称|||」前缀残留与非图片 base64 剥除（同 renderBody 口径）
    // FIX 2026-09-25 #1235 载荷切片改走 MAIL_PAYLOAD_RE（大小写/无 MIME/前导空白变体一并收口）
    const str = mailCleanDisplay(String(s || ''));
    const cleaned = str
      .replace(MAIL_DESC_SLICE_RE, '')
      .replace(/\s+/g, ' ').trim();
    let out = escHtml((cleaned || '（图片）').slice(0, 30));
    if (fit && window.taFit) out = window.taFit(out);
    return out;
  }
  function letterPaper(title, content, date, author, fit) {
    return '<div class="mail-paper">' +
      '<div class="mail-paper-head"><span class="mail-paper-author">' + escHtml(author) + '</span><span class="mail-paper-date">' + date + '</span></div>' +
      (title ? '<div class="mail-paper-title">' + escHtml(title) + '</div>' : '') +
      '<div class="mail-paper-body">' + renderBody(content, fit) + '</div>' +
      '</div>';
  }
  // 信纸图片可点击查看大图（复用聊天大图查看器 viewChatImage）
  // v3.6.x：信箱来信/回信里的图片与表情包一律为缩略图，点击后打开原图查看
  function bindLetterImgClicks(root) {
    if (!root) return;
    root.querySelectorAll('.mail-body-img').forEach(im => {
      im.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.viewChatImage) window.viewChatImage(im.src);
      });
    });
  }
  // 打开信详情（复用 tc-mask 弹层；v3.5.68 打开即标记已读）
  function openLetter(l) {
    // v3.26.x：重新 load() 取最新完整数据——render() 列表项 click 传的 l 来自 render 时的
    // load() 快照，若当时 mailDbReady=false（切桌面后 idbGet 未返回/启动早期），load() 降级
    // 读剥图快照，l.content/l.myReply 可能为空（红米 K80 Chrome 反馈「回信后点开空白，TA
    // 回信后才显示」——TA 回信触发 render 时 mailDbReady 已 true 读主键完整才显示）。这里
    // 用 l.id 重新 load() 拿最新数据，覆盖可能过期的 l。
    try {
      if (l && l.id) {
        const fresh = load().find(x => x.id === l.id);
        if (fresh && fresh.id) l = fresh;
      }
    } catch (e) {}
    viewLetter = l;
    // 收到的来信：打开后标记已读（「新来信」消失）
    // 2026-09-14 加固：已读落库为可选步骤，load/save 任一抛出都不允许中断开信弹层
    //（多机型反馈「点开信无反应」：已读保存途中异常会让 openLetter 在弹层出现前中断）。
    if (l && l.type === 'received' && !l.read) {
      try {
        l.read = true;
        const list = load();
        const idx = list.findIndex(x => x.id === l.id);
        if (idx >= 0) { list[idx].read = true; save(list); }
      } catch (e) {}
    }
    updateBadge();
    const name = partnerName();
    const myName = store.get('lbl-user') || '我';
    let html = '';
    // 收到的信 / 寄出的信 都完整显示（含标题）
    if (l.type === 'received' || l.fromMe) {
      html += letterPaper(l.tt || '来信', l.content, fmtDT(l.tm), l.fromMe ? myName : name, !l.fromMe);
    } else if (l.type === 'sent') {
      html += letterPaper(l.tt || '寄出的信', l.content, fmtDT(l.tm), myName, false);
    }
    // 我的回信（寄出的信内容已在上方完整展示，不再重复）
    if (l.myReply && l.type !== 'sent') html += letterPaper('我的回信', l.myReply.content, fmtDT(l.myReply.tm), myName, false);
    if (l.partnerReply) html += letterPaper('对方的回信', l.partnerReply.content, fmtDT(l.partnerReply.tm), name, true);
    // 底部按钮：收到的信且未回信 → 提笔回信（打开独立回信页）；任意信可删除
    // v3.10.x：收到的来信可收藏到【我的收藏】→ 信件分类
    const canFav = l.type === 'received';
    let favAlready = false;
    if (canFav) {
      try {
        const favArr = JSON.parse(store.get('fav-msgs') || '[]');
        favAlready = favArr.some(x => (x.kind || 'msg') === 'mail' && x.mailType === 'received' && (x.text || '') === (l.content || '') && x.ts === l.tm);
      } catch (e) {}
    }
    let footer = '';
    if (canFav && !l.myReply) {
      footer = '<div class="mail-actions"><button class="cc-tool" id="mail-fav-btn">' + (favAlready ? '已收藏' : '收藏来信') + '</button><button class="cc-tool" id="mail-reply-btn">提笔回信</button><button class="cc-tool cc-tool-danger" id="mail-del-btn">删除</button><button class="cc-tool" id="mail-close2">关闭</button></div>';
    } else if (canFav) {
      footer = '<div class="mail-actions"><button class="cc-tool" id="mail-fav-btn">' + (favAlready ? '已收藏' : '收藏来信') + '</button><button class="cc-tool cc-tool-danger" id="mail-del-btn">删除</button><button class="cc-tool" id="mail-close2">关闭</button></div>';
    } else {
      footer = '<div class="mail-actions"><button class="cc-tool cc-tool-danger" id="mail-del-btn">删除</button><button class="cc-tool" id="mail-close2">关闭</button></div>';
    }
    // v3.10.x：详情弹层兜底——openTCPanel 定义在 ta-ask.js 模块尾部，该模块若在某设备
    // 顶层抛错（文件级 try/catch 只保证后续模块能跑，本模块剩余部分仍中断），
    // window.openTCPanel 会缺失 → 点信件静默无反应。这里检测打开失败时退回全站
    // openModal 纯文本展示（personalize.js 早于 ta-ask 加载，可用性高得多），
    // 保证信件永远有地方看。
    let panelOpened = false;
    try {
      if (window.openTCPanel) {
        window.openTCPanel('信件', html + footer);
        const mk = document.getElementById('tc-mask');
        panelOpened = !!(mk && !mk.hidden);
        // v3.26.x：防御 openTCPanel 后 tc-body 无信纸——个别内核/竞态下 body.innerHTML
        // 未生效（红米 K80 Chrome 反馈「点开信不显示内容」），重试注入保证信纸可见。
        const tcb = document.getElementById('tc-body');
        if (panelOpened && tcb && !tcb.querySelector('.mail-paper')) {
          tcb.innerHTML = html + footer;
        }
      }
    } catch (e) {}
    if (!panelOpened && window.openModal) {
      const stripImg = (s) => mailPlainDesc(s); // FIX #1235 统一走 mailPlainDesc（旧写法只认小写 image/ 前缀）
      let txt = (l.tt ? '【' + l.tt + '】\n' : '') + stripImg(l.content);
      if (l.myReply && l.type !== 'sent') txt += '\n\n—— 我的回信 ——\n' + stripImg(l.myReply.content);
      if (l.partnerReply) txt += '\n\n—— 对方的回信 ——\n' + stripImg(l.partnerReply.content);
      window.openModal(l.fromMe ? '寄出的信' : '信件', '', () => {}, { noInput: true, staticText: txt });
    }
    bindLetterImgClicks(document.getElementById('tc-body'));
    const close2 = document.getElementById('mail-close2');
    if (close2) close2.addEventListener('click', () => { document.getElementById('tc-mask').hidden = true; viewLetter = null; });
    const replyBtn = document.getElementById('mail-reply-btn');
    if (replyBtn) replyBtn.addEventListener('click', () => openReply(l));
    const delBtn = document.getElementById('mail-del-btn');
    if (delBtn) delBtn.addEventListener('click', () => deleteLetter(l));
    const favBtn = document.getElementById('mail-fav-btn');
    if (favBtn) favBtn.addEventListener('click', () => {
      if (window.addMyFavItem) {
        const ok = window.addMyFavItem({ kind: 'mail', mailType: 'received', title: l.tt || '', text: l.content || '', ts: l.tm || Date.now() });
        toast(ok ? '已收藏到我的收藏' : '这封来信已收藏过');
        if (ok) favBtn.textContent = '已收藏';
      }
    });
  }
  function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const el = document.getElementById(id);
    if (el) el.hidden = false;
  }
  // 回信（独立全屏页，保留原信上下文）
  function openReply(l) {
    // v3.26.x：同 openLetter，重新 load() 取最新完整数据（防 render list 的 l 来自剥图快照、content 空）
    try {
      if (l && l.id) {
        const fresh = load().find(x => x.id === l.id);
        if (fresh && fresh.id) l = fresh;
      }
    } catch (e) {}
    viewLetter = l;
    const name = partnerName();
    const origEl = document.getElementById('mail-reply-original');
    if (origEl) {
      origEl.innerHTML = letterPaper(l.tt || '来信', l.content, fmtDT(l.tm), name, true);
      bindLetterImgClicks(origEl);
    }
    const toEl = document.getElementById('mail-reply-to');
    if (toEl) toEl.textContent = name;
    const input = document.getElementById('mail-reply-input');
    if (input) input.value = '';
    document.getElementById('tc-mask').hidden = true;
    showPage('page-mail-reply');
  }
  function submitReply() {
    const l = viewLetter;
    if (!l) return;
    // v3.6.x：保留 sticker:/image: 标记前缀（区分图片/表情包类型），不再剥掉
    // v3.10.x：读值走 readMailVal（安卓 ce-box 代理读空兜底）
    const val = mailCanonPayload(readMailVal(document.getElementById('mail-reply-input')).trim());
    if (!val) { toast('回信内容不能为空'); return; }
    const name = partnerName();
    const list = load();
    const idx = list.findIndex(x => x.id === l.id);
    if (idx >= 0 && !list[idx].myReply) {
      list[idx].myReply = { content: val, tm: Date.now() };
      // TA 定时回信确认（概率与时间在回复设置-信箱调整）
      const cfg = mailCfg();
      if (Math.random() * 100 < cfg.replyProb) {
        const replyMsg = taLetterContent(cfg);
        const delayMs = (cfg.replyMin + Math.random() * Math.max(1, cfg.replyMax - cfg.replyMin)) * 60000;
        // v3.6.x：TA 回信计划持久化——不再用内存 setTimeout（页面刷新/重开即丢失，
        // 表现为「回了信却永远收不到回信」）；写入计划，由 checkPendingReply 到期落地
        const pending = replyPendingLoad();
        pending.push({ id: l.id, due: Date.now() + delayMs, content: replyMsg });
        replyPendingSave(pending);
      }
      save(list);
      viewLetter = null;
      // v3.26.x：回信后切到「收到的信」tab 并在 DOM 可见时渲染——原实现只 showPage 不
      // selectMailTab，回信后停在旧 tab（常是「寄出的信」），用户看不到刚回信的来信、
      // 以为回信没成功（红米 K80 Chrome 反馈「回了信不显示、重新点也看不到回信」）。
      // 同步先 showPage+selectMailTab 让 page-mail 与目标 tab 可见，再 render() 确保
      // innerHTML 在元素可见时写入（防御个别内核对 hidden 元素 innerHTML 渲染延迟）。
      showPage('page-mail');
      selectMailTab('in');
      render();
      updateBadge();
      // v3.10.x：mailNotice=true → 聊天里该系统消息可点击直达信箱
      if (window.chatAddSystem) window.chatAddSystem('你给 ' + name + ' 回了一封信', { mailNotice: true });
      toast('回信已寄出');
      // v3.6.x：TA 收藏我的回信（概率可调，与聊天消息收藏一致）
      // v3.7.x：概率由收藏设置页控制，默认 30%
      if (Math.random() * 100 < (window.favCfg ? window.favCfg().taMail : 30) && window.addTaFavItem) {
        window.addTaFavItem({ kind: 'mail', title: l.tt || '', text: val, ts: Date.now() });
        setTimeout(() => toast(window.taFit ? window.taFit('TA 收藏了你的回信') : 'TA 收藏了你的回信'), 1200);
      }
    }
  }
  // ===== TA 回信计划（持久化）：回信命中概率后，TA 的回信写入本地计划 =====
  // 到期由 checkPendingReply 落地为 partnerReply；刷新/重开页面不丢（旧逻辑用内存
  // setTimeout，刷新即丢失，回信永远收不到）。
  const REPLY_PENDING_KEY = 'mail-reply-pending';
  function replyPendingLoad(cid) {
    try { const v = JSON.parse(csFor(cid).get(REPLY_PENDING_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function replyPendingSave(arr, cid) { try { csFor(cid).set(REPLY_PENDING_KEY, JSON.stringify(arr)); } catch (e) {} }
  // v3.7.x：信件系统消息写入「信件所属桌面」的聊天——与 feed.js notifyFeedPostToChat
  //   同模式：当前桌面走内存链路（chatAddSystem 实时渲染）；非当前桌面直接写该桌面
  //   IDB 聊天记录 + LS 快照（该桌面 msgs 在 contact-switched 时重置，下次进入由 loadMsgs 读回）
  function notifyMailToChat(cid, text, opts) {
    const cur = window.__activeCid || 'default';
    if (cid === cur) {
      // v3.10.x：opts.mailNotice → 聊天通知可点击打开信箱
      if (window.chatAddSystem) window.chatAddSystem(text, { mailNotice: !!(opts && opts.mailNotice) });
      return;
    }
    // v3.14.x：改走 chat.js 统一安全追加——原「idbGet→push→整包写回」在读取
    // 超时（返回 undefined）时会把该桌面全部聊天记录覆盖成 [这一条]
    if (window.chatAppendToDeskMsg) { window.chatAppendToDeskMsg(cid, text, { mailNotice: !!(opts && opts.mailNotice) }); }
  }
  // 该联系人桌面的 TA 昵称（lbl-partner，回退 contacts.name，再回退 'TA'）
  function partnerNameFor(cid) {
    try {
      const cs = csFor(cid);
      const v = cs.get('lbl-partner');
      if (v) return v;
      if (window.getContacts) {
        const c = window.getContacts().find(x => x.id === cid);
        if (c && c.name) return c.name;
      }
    } catch (e) {}
    return 'TA';
  }
  // 检查到期回信计划并落地（启动时 + 每分钟 tick 调用）
  // v3.7.x：改为遍历各联系人——原实现单定时器用 store（当前激活桌面），回信计划
  //   读写当前桌面，用户在 A 桌面时 B 的回信计划永远不落地。改为每个联系人独立
  //   checkPendingReplyFor(cid)，用 csFor(cid) 读写各自命名空间。
  function checkPendingReplyFor(cid) {
    try {
      // v3.9.x：当前桌面权威加载（mailDbReady）完成前不落地——此时 load(cid) 可能
      // 读到剥图快照（大信件只存 IDB 时 LS 主键为空），落地写回会把带图信件覆盖成
      // [图片] 剥图版；等权威加载回调/保险丝置真后补查（那里会再调 checkPendingReply）。
      if (cid === (window.__activeCid || 'default') && !mailDbReady) return;
      const now = Date.now();
      // FIX 2026-09-29 #1442b 回信让路：读不出权威这一班不落地——回信计划留在原处不烧，
      //   整本也不许被「读空/旧账＋一封回信」拼出来的版本顶掉。
      if (mailBlindRead(cid)) return; // #1442b 回信让路
      const pending = replyPendingLoad(cid);
      if (!pending.length) return;
      const name = partnerNameFor(cid);
      const rest = [];
      let changed = false;
      // v3.27.x 性能：load 提到循环外——原实现每条到期计划都重新 load(cid)（全列表再
      // parse+排序一遍），多条计划即多次全量读；改为读一次、全部落地后统一 save 一次
      //（少写一遍持久层，行为不变：同 id 多计划命中已回信分支同样丢弃后续）。
      const list = load(cid);
      let landed = false;
      pending.forEach(p => {
        if (!p || !p.id) { changed = true; return; }
        const idx = list.findIndex(x => x.id === p.id);
        if (idx < 0) { changed = true; return; }          // 信件已不存在 → 丢弃计划
        if (list[idx].partnerReply) { changed = true; return; } // 已有 TA 回信 → 丢弃计划
        if (p.due > now) { rest.push(p); return; }        // 未到期 → 保留
        // 到期：落地 TA 回信
        list[idx].partnerReply = { content: p.content, tm: now };
        landed = true;
        notifyMailToChat(cid, name + ' 给你回了信', { mailNotice: true });
        // v3.5.107：TA 回信且不在信箱页 → 前台桌面弹窗（仅当前激活桌面才弹，用户能看到）
        if (cid === (window.__activeCid || 'default') && window.showDeskPopup && !mailPageVisible()) {
          // FIX 2026-09-13 #403 弹窗正文剥媒体池令牌/附件（原样传信件正文＝通知横幅直出乱码）
window.showDeskPopup({ name: '信箱', notifyKind: 'mail', text: mailPlainDesc('给你回了一封信：' + String(p.content || '')), onClick: openMailPage, isHidden: document.visibilityState === 'hidden' });
        }
        changed = true;
      });
      if (landed) save(list, cid);
      if (changed) replyPendingSave(rest, cid);
      if (cid === (window.__activeCid || 'default')) { render(); updateBadge(); }
    } catch (e) {}
  }
  function checkPendingReply() {
    const list = (window.getContacts && window.getContacts()) || [{ id: 'default' }];
    list.forEach(c => checkPendingReplyFor(c.id));
  }
  // 列表项 HTML（v3.27.x 渲染模板收口：原 render() 把同一份拼接写了 4 遍——
  // 收/寄 × 正常/红米重试——收敛为一处，红米重试防御的调用点与语义不变。
  // dir:'in' 收到的信 / 'out' 寄出的信）
  function mailItemHtml(l, dir, name) {
    const tag = dir === 'in'
      ? (l.myReply ? ' <span class="mail-tag">已回信</span>' : (l.read ? '' : ' <span class="mail-tag new">新来信</span>'))
      : (l.partnerReply ? ' <span class="mail-tag">对方已回信</span>' : '');
    // v3.27.x：data-id 过 escHtml——导入备份的信件 id 是外部输入，原实现裸拼进属性
    // 可逃逸引号注入 HTML；dataset 读回时属性实体自动还原，匹配逻辑不变
    return '<div class="mail-item" data-id="' + escHtml(l.id) + '">' +
      '<div class="mail-item-av"><svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg></div>' +
      '<div class="mail-item-body"><div class="mail-item-title">' + (dir === 'in' ? '来自 ' : '寄给 ') + name + tag + '</div>' +
      '<div class="mail-item-desc">' + shortDesc(l.content, dir === 'in') + '</div></div>' +
      '<div class="mail-item-time">' + fmtDT(l.tm) + '</div></div>';
  }
  // ===== #1402 信箱按时间分组（作者直派「信太多写得很杂」）=====
  //   打开信箱只平铺「本周」的信，更早的按月份折成一条可点的组标题。
  //   判据只有两个事实：墙钟日期（本周一 00:00 起＝自然周，不是滚动 7 天）和信件自身的 tm/read 字段，
  //   零机型／零 UA 分支。
  //   FIX 2026-09-29 #1417：原来未读来信会被抽进列表顶部一个常驻的「未读」分区（#1402 为守住
  //   「折叠组是 display:none，未读折进去＝红点亮着而列表里找不到那封信」而加）。作者直派
  //   「不要因为信未读就收进单独的【未读】里，这样会显得非常乱，需要只按时间折叠起来」——
  //   现在未读跟着自己的时间落进本周／月份组，改由「含未读的组默认展开＋组标题挂未读数」守同一条
  //   约束（见 mailFoldHtml），徽标仍是 mailIsUnread 同一把尺。
  //   寄出的信没有「未读」概念（read 只在对来信置位、徽标也只数 received），那一侧只做「本周＋按月折叠」，
  //   不为此新造持久字段。
  //   折叠态收在模块级 map：信箱页每次 render 都重设 innerHTML，挂在 DOM 上的开合态活不过一次渲染
  //   （同 #993 统计页 stats-fold 的处理，站内既有惯例）。
  const mailFoldOpen = {};
  function weekStartTs(now) {
    const d = new Date(now);
    const dow = (d.getDay() + 6) % 7; // 周一＝0（getDay 的「周日 0」归到上一周末尾）
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - dow);
    return d.getTime();
  }
  function monthKeyOf(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
  }
  function monthLabelOf(key) {
    if (key === 'none') return '更早'; // #1416：缺 tm 的老信不猜日期（原来算成 0 ⇒ 组标题印「1970 年 1 月」）
    const p = key.split('-');
    return p[0] + ' 年 ' + Number(p[1]) + ' 月';
  }
  function mailFoldHtml(dir, key, rows, name, unreadN) {
    const foldKey = dir + '|' + key; // 收到/寄出各自独立折叠，同一个月不能互相顶掉开合态
    // FIX 2026-09-29 #1417：组里还有未读时默认展开。作者直派「不要因为信未读就收进单独的【未读】
    //   里，显得非常乱，只按时间折叠」之后，#1402 那条硬约束（「红点亮着、列表里却找不到那封信」）
    //   改用这条守：未读落在它自己的时间组里，组默认是开着的，组标题上还挂着未读数。
    //   用户手动点过就听用户的（只在从没记录过开合态时才用默认值）；读过之后未读归零、默认回到收起。
    const open = (foldKey in mailFoldOpen) ? !!mailFoldOpen[foldKey] : (unreadN > 0);
    return '<div class="mail-fold' + (open ? ' open' : '') + '" data-mail-fold="' + foldKey + '">' +
      '<div class="mail-fold-head" role="button" tabindex="0" aria-expanded="' + (open ? 'true' : 'false') + '">' +
      '<span class="mail-fold-title">' + monthLabelOf(key) + '</span>' +
      '<span class="mail-fold-right">' + (unreadN > 0 ? '<span class="mail-fold-unread">' + unreadN + ' 封未读</span>' : '') +
      '<span class="mail-fold-count">' + rows.length + ' 封</span>' +
      '<span class="mail-fold-caret">▾</span></span></div>' +
      '<div class="mail-fold-body">' + rows.map(l => mailItemHtml(l, dir, name)).join('') + '</div></div>';
  }
  function mailGroupedHtml(list, dir, name) {
    const wkStart = weekStartTs(Date.now());
    const week = [], months = {}, keys = [], unreadOf = {};
    list.forEach(l => {
      // FIX 2026-09-29 #1416：判据只问「这封信带没带 tm」——带了才换算年月，没带的一律归「更早」，
      //   不许拿 0 当日期（同批 idb.js 的 mochiHistFold 就是这个口径）。
      const tm = Number(l.tm) || 0;
      // FIX 2026-09-29 #1417：未读不再抽成常驻区（作者直派「只按时间折叠」）——一封信只落一个桶，
      //   未读跟着它自己的时间走；含未读的月份组默认展开＋组标题挂未读数（见 mailFoldHtml）。
      const un = (dir === 'in' && mailIsUnread(l)) ? 1 : 0;
      if (tm && tm >= wkStart) { week.push(l); return; }
      const k = tm ? monthKeyOf(tm) : 'none';
      if (!months[k]) { months[k] = []; keys.push(k); unreadOf[k] = 0; }
      months[k].push(l);
      unreadOf[k] += un;
    });
    let html = '';
    if (week.length) {
      // 底下真有折叠组时才需要「本周」这条小标题来划界；整箱都是本周的信就不加，避免多一层噪声
      if (keys.length) html += '<div class="mail-sec-label">本周</div>';
      html += week.map(l => mailItemHtml(l, dir, name)).join('');
    }
    keys.sort((a, b) => (a === 'none' ? 1 : b === 'none' ? -1 : (a < b ? 1 : -1))); // 最近的月份在前，「更早」（缺 tm 的老信）永远排最后
    keys.forEach(k => { html += mailFoldHtml(dir, k, months[k], name, unreadOf[k]); });
    return html;
  }
  function render() {
    // v3.27.x 性能：信箱页不可见 ⇒ 跳过。后台落地路径（60s 来信/回信 tick、启动 idb
    // 回调、保险丝）都会各调一次 render，原实现在用户停在桌面时也重建两份完整列表
    // HTML（每封信再跑剥 base64 正则）——全是白做的 UI 活。列表 DOM 无脏状态依赖：
    // 进页唯一入口 openMailPage 显示后才渲染，寄信/回信路径也先 showPage 再 render。
    const mpEl = document.getElementById('page-mail');
    if (mpEl && mpEl.hidden) return;
    const list = load().slice().sort((a, b) => b.tm - a.tm);
    const name = partnerName();
    const inEl = document.getElementById('mail-in-list');
    const outEl = document.getElementById('mail-out-list');
    // 收到的信：TA 来信 + 已回信
    const inList = list.filter(l => l.type === 'received');
    if (inEl) {
      const inHtml = mailGroupedHtml(inList, 'in', name);
      // FIX 2026-09-29 #1417：这一轮读的是旧账/读空时，在列表最上方如实说一句＋给一个当场可点的
      //   自救入口（mailRescueStrip 自己按残缺判据决定出不出现，正常读写时这段是空串、一个字不加）
      inEl.innerHTML = mailRescueStrip() + (inHtml || (mailEmptyIsLie() && window.mochiLoadingHtml
        ? window.mochiLoadingHtml('收到的信')
        : '<div class="ta-empty">' + (window.taFit ? window.taFit('还没有收到信，等等 TA 吧') : '还没有收到信，等等 TA 吧') + '</div>'));
      // v3.26.x：防御 innerHTML 未生效——个别安卓内核（红米 K80 Chrome）对 hidden 元素
      // innerHTML 渲染延迟，列表项数与数据不符时重试一次（红米 K80 反馈「列表空」）。
      if (inList.length && inEl.querySelectorAll('.mail-item').length < inList.length) inEl.innerHTML = mailRescueStrip() + inHtml;
    }
    // 寄出的信
    const outList = list.filter(l => l.type === 'sent');
    if (outEl) {
      const outHtml = mailGroupedHtml(outList, 'out', name);
      outEl.innerHTML = outHtml || (mailEmptyIsLie() && window.mochiLoadingHtml
        ? window.mochiLoadingHtml('寄出的信')
        : '<div class="ta-empty">还没有寄出任何信，提笔写一封吧</div>');
      if (outList.length && outEl.querySelectorAll('.mail-item').length < outList.length) outEl.innerHTML = outHtml;
    }
  }
  // #785：回填真完成后补渲一次（render 开头按 page-mail 不可见早退，隐藏时零代价）
  if (window.mochiOnDataReady) window.mochiOnDataReady(function () { try { render(); } catch (e) {} });
  // v3.27.x 性能：列表项点击改容器级事件委托（一次绑定）——原实现每次 render 给每封信
  // 重挂 click，开销随信件数线性增长；点击按 dataset id 现查信件（load 有解析缓存），
  // openLetter 内部本就会重取最新完整数据，行为不变
  function mailListItemClick(e) {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    // #1417：列表上方那张提示条里的自救按钮（既不是信也不是折叠条，先认它）
    if (t.closest('#mail-rescue')) { mailRescueClick(); return; }
    // #1402：点月份组的标题条只开合这一组（标题条里没有 .mail-item，展开后点里面的信仍走 openLetter，
    // 不会被这次点击顺手收回去）
    const foldHead = t.closest('.mail-fold-head');
    if (foldHead) { mailFoldToggle(foldHead.parentNode); return; }
    const it = t.closest('.mail-item');
    if (!it) return;
    const l = load().find(x => x.id === it.dataset.id);
    if (l) openLetter(l);
  }
  // #1402：开合态写回模块级 map 并同步 aria-expanded（render 重设 innerHTML 时按这张表还原现场）
  function mailFoldToggle(sec) {
    if (!sec || !sec.getAttribute) return;
    const key = sec.getAttribute('data-mail-fold');
    if (!key) return;
    const head = sec.querySelector('.mail-fold-head');
    // FIX 2026-09-29 #1417：当前开合态问 DOM 要，不能拿 !mailFoldOpen[key] 推——map 里没有这一键时
    //   那是 undefined，!undefined=true 会把「默认开着」的含未读组第一次点击也判成「打开」（点不动）。
    //   渲染时把开合态写进了 class，这里读同一处，默认值与用户操作是同一张嘴。
    const open = !sec.classList.contains('open');
    mailFoldOpen[key] = open;
    sec.classList.toggle('open', open);
    if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  ['mail-in-list', 'mail-out-list'].forEach((lid) => {
    const el = document.getElementById(lid);
    if (el) el.addEventListener('click', mailListItemClick);
    if (!el) return;
    // 键盘可达（与统计页 stats-fold 同一套）：焦点在标题条上时 Enter/空格同样开合
    el.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      const head = e.target && e.target.closest ? e.target.closest('.mail-fold-head') : null;
      if (!head) return;
      e.preventDefault();
      mailFoldToggle(head.parentNode);
    });
  });
  // 存储时保留媒体标记前缀（sticker:/image:）——渲染时靠前缀区分表情包小图/图片大图
  // v3.6.x：旧实现提交时剥掉前缀，renderBody 匹配不到 sticker: 导致表情包按大图显示；
  // 现在保留前缀存储；历史无前缀数据仍按大图显示不变
  // 寄信
  function sendLetter() {
    const input = document.getElementById('mail-input');
    // v3.6.x：保留 sticker:/image: 标记前缀（区分图片/表情包类型），不再剥掉
    // v3.10.x：读值走 readMailVal（安卓 ce-box 代理读空兜底，防「信没寄出去」）
    const content = input ? mailCanonPayload(readMailVal(input)).trim() : '';
    if (!content) { toast('信件内容不能为空'); return; }
    const name = partnerName();
    const title = TITLES[Math.floor(Math.random() * TITLES.length)];
    const letter = { id: 'l_' + Date.now(), type: 'sent', tt: title, content: content, tm: Date.now(), myReply: { content: content, tm: Date.now() } };
    const list = load();
    list.unshift(letter);
    save(list);
    // v3.9.x：寄出的信也可收到 TA 回信——原实现回信机制只在「提笔回信」
    //   (submitReply) 里按 ml-reply-prob 安排回信计划，寄信(sendLetter) 从不安排
    //   → 用户设了「回信概率」寄信也永远收不到回信。寄信与回信共用同一概率/
    //   时间设置（回复设置-信箱-联系人回信），命中后写入回信计划，由
    //   checkPendingReplyFor 到期落地为 partnerReply（刷新/重开不丢）。
    const cfg = mailCfg();
    if (Math.random() * 100 < cfg.replyProb) {
      const replyMsg = taLetterContent(cfg);
      const delayMs = (cfg.replyMin + Math.random() * Math.max(1, cfg.replyMax - cfg.replyMin)) * 60000;
      const pending = replyPendingLoad();
      pending.push({ id: letter.id, due: Date.now() + delayMs, content: replyMsg });
      replyPendingSave(pending);
    }
    if (input) input.value = '';
    if (input && input.__ceBox) input.__ceBox.textContent = '';
    // v3.10.x：信件通知可点击（chat.js 渲染 mail-notice 类，点击打开信箱）
    if (window.chatAddSystem) window.chatAddSystem('你给 ' + name + ' 写了一封信', { mailNotice: true });
    toast('信件已寄出');
    // v3.26.x：先 showPage+selectMailTab 让 page-mail 与「寄出的信」tab 可见，再 render()——
    // 原实现 render() 在 showPage 之前，page-mail 仍 hidden 时写入 innerHTML，个别安卓
    // 内核（红米 K80 Chrome 实测）对 hidden 元素 innerHTML 渲染延迟，寄信后列表空白。
    // 改为 DOM 可见后再渲染，并保留前一次 render() 兜底（双渲染，零副作用）。
    render();
    showPage('page-mail');
    selectMailTab('out');
    render();
  }
  // ================= TA 主动来信（定时机制，概率可在回复设置-信箱调整） =================
  const TA_LETTERS = [
    '最近总是想起我们以前聊的那些话。时间过得真快，但有些东西一直没变。给我回信吧。',
    '今天路过一个地方，突然很想你。最近过得还好吗？想听听你的消息。',
    '忽然想给你写封信。有些话，用字卡说不完，写下来好像更踏实。',
    '晚安前突然想起你。最近有没有好好休息？有空给我回封信吧。',
    '今天看到一片很好看的云，第一反应是想拍给你看。想你了。'
  ];
  function mailCfg() {
    const c = (window.replyCfg && window.replyCfg()) || {};
    // v3.5.99：概率为 0/空 时回退默认值——防止 TA 永不写信/永不回信（旧数据可能把概率存成 0）
    const prob = (k, def) => {
      const v = c[k];
      return v !== undefined && v !== '' && Number(v) > 0 ? Number(v) : def;
    };
    return {
      // v3.6.x：最少/最多字卡条数（回复设置-信箱可调；默认 20~50）
      minCards: c['ml-min-cards'] !== undefined ? Number(c['ml-min-cards']) : 20,
      maxCards: c['ml-max-cards'] !== undefined ? c['ml-max-cards'] : 50,
      // #296：写信总开关裸读（不走 prob()——prob 把 0 兜底回默认值，开关关闭=0 必须原样保留）
      writeEn: c['ml-write-en'] !== undefined ? Number(c['ml-write-en']) : 1,
      // #645：每周摸鱼小结寄信开关裸读（同 writeEn 口径——关闭=0 必须原样保留）
      fishWeekEn: c['ml-fish-week-en'] !== undefined ? Number(c['ml-fish-week-en']) : 1,
      writeProb: prob('ml-write-prob', 30),
      writeMin: c['ml-write-min'] !== undefined ? c['ml-write-min'] : 1,
      writeMax: c['ml-write-max'] !== undefined ? c['ml-write-max'] : 120,
      // v3.6.x：每天最多来信（封），默认 3（回复设置-信箱可调）
      dailyMax: c['ml-write-daily-max'] !== undefined ? Number(c['ml-write-daily-max']) : 3,
      replyProb: prob('ml-reply-prob', 80),
      replyMin: c['ml-reply-min'] !== undefined ? c['ml-reply-min'] : 1,
      replyMax: c['ml-reply-max'] !== undefined ? c['ml-reply-max'] : 120,
      kaomojiEn: c['ml-kaomoji-en'] !== undefined ? c['ml-kaomoji-en'] : 1,
      emojiEn: c['ml-emoji-en'] !== undefined ? c['ml-emoji-en'] : 1,
      stickerEn: c['ml-sticker-en'] !== undefined ? c['ml-sticker-en'] : 1
    };
  }
  // v3.12.x：按「指定联系人桌面」读信箱回复设置（ml-*）——多桌面下每个联系人 TA
  //   写信（概率/间隔/每天最多来信等）应使用各自桌面的设置值。原实现 maybeIncomingLetterFor
  //   遍历所有联系人时统一调 mailCfg()=当前激活桌面的值：用户停在 A 桌面，B 桌面设的
  //   「每天最多写信」等从不生效（与朋友圈 feedCfgFor 同款问题）。以 mailCfg() 为基底
  //   （保留默认值/坏数据兜底），再用该联系人命名空间的 reply-ml-* 覆盖；
  //   当前桌面直接复用 mailCfg() 不重复读。概率 0/负不覆盖（同 prob() 兜底口径，
  //   防 TA 永不写信的旧坏数据）。
  function mailCfgFor(cid) {
    const cfg = mailCfg();
    if (!cid || cid === (window.__activeCid || 'default')) return cfg;
    try {
      const s = window.storeFor(cid);
      [['ml-min-cards', 'minCards'], ['ml-max-cards', 'maxCards'],
       ['ml-write-en', 'writeEn'], ['ml-fish-week-en', 'fishWeekEn'],
       ['ml-write-prob', 'writeProb'], ['ml-write-min', 'writeMin'], ['ml-write-max', 'writeMax'],
       ['ml-write-daily-max', 'dailyMax'], ['ml-reply-prob', 'replyProb'],
       ['ml-reply-min', 'replyMin'], ['ml-reply-max', 'replyMax'],
       ['ml-kaomoji-en', 'kaomojiEn'], ['ml-emoji-en', 'emojiEn'], ['ml-sticker-en', 'stickerEn']
      ].forEach(pair => {
        try {
          const v = s.get('reply-' + pair[0]);
          if (v === null || v === undefined || v === '') return;
          const n = Number(v);
          if (isNaN(n)) return;
          if ((pair[0] === 'ml-write-prob' || pair[0] === 'ml-reply-prob') && n <= 0) return;
          cfg[pair[1]] = n;
        } catch (e) {}
      });
    } catch (e) {}
    return cfg;
  }
  // 只读探针：该联系人桌面的信箱触发配置（供回归测试与来源诊断）
  window.mailCfgForProbe = function (cid) {
    try { const c = mailCfgFor(cid); return JSON.parse(JSON.stringify(c)); } catch (e) { return null; }
  };
  // 字卡库分类（与聊天/朋友圈同一套规则）：文字 / 颜文字 / emoji / 表情包(图片)
  // v3.6.x：用户未添加自定义字卡时（内置预设已移除）用系统默认字卡补池——
  //   否则信件只能从 5 条固定文案里抽，内容单一且条数上限超过池子时爆重复
  // v3.7.x：补池受「信箱使用」场景开关控制（默认字卡-设置页可关闭）
  // v3.8.x：默认字卡不再只当「空池兜底」——即使有自定义字卡，写信时每张卡也会按
  //   「整体概率 + 分类占比」（聊天默认字卡-设置页）混入默认字卡，与聊天回复一致
  // v3.42.x #429 信件纯文字口径（OPPO Reno16 Via/Edge 报「信件乱码＝联系人字卡库图片令牌」，多机型同族 #426）：
  // ①选卡过滤收敛——#388 只守了自定义字卡循环且用全串锚定的 mochiMediaIsToken（令牌嵌长文本测不出），
  //   默认主字卡三循环（defText/defKaomoji/defEmoji）零过滤，贴纸/语音型默认卡（「名称|||@@m:hash」
  //   「名称|||data:…」）与裸令牌混排照样进池拼进信件持久化成乱码；统一 indexOf 口径过滤两路循环。
  // ②渲染端清洗——存量已落盘信件含「名称|||」前缀残留与 audio 等非图片 base64，renderBody/shortDesc
  //   直出乱码；只洗显示不改历史数据（同 #426 calCleanMsg 口径）。
  // 判定用 indexOf('@@m:') 而非 mochiMediaIsToken：后者全串锚定，令牌嵌在长文本里测不出。
  function mailTextOnly(c) {
    if (typeof c !== 'string' || !c) return false;
    if (c.indexOf('data:') === 0) return false;
    if (c.indexOf('|||') >= 0) return false;
    if (c.indexOf('@@m:') >= 0) return false;
    // FIX 2026-09-15 #533 链接导入的媒体字卡（图床不允许跨域时存原始 http(s) 链接，
    // 位于字卡库【表情包/图片】分类）同样是图片载荷不是文字——旧判定放行 URL，联系人
    // 写信抽中即把「http://…png」当正文句子写进信纸（用户报「一个对话框里发两个表情，
    // 另一个会变成文字 URL，信箱里也是这样」）。renderBody 本就把带 sticker:/image:
    // 前缀的外链当缩略图，这里只是不再把裸链接当句子拼进正文。
    if (/^https?:\/\//i.test(c)) return false;
    // FIX 2026-09-25 #1235 上面五条全是「串首小写」口径，变体形态（无 MIME 的 data:;base64、大写
    // MIME、前导空白、夹在正文中间的载荷）一概测不出——这类卡被当文字卡抽进信件正文并落库，
    // 就是用户所见「联系人来信/回信里一长串乱码」的产生现场。判据不重写第三份，借 chat.js
    // #948 收口后的那一份（chatHasMediaPayload 覆盖内联夹带与「名称|||」形态）。
    if (window.chatHasMediaPayload && window.chatHasMediaPayload(c)) return false;
    // chatHasMediaPayload 的「正文中间夹带」口径要求载荷前有空格；带 sticker:/image: 紧邻前缀
    // 的卡（"sticker:data:;base64,…"）没有空格——这里按 MAIL_PAYLOAD_RE 再兜一层：串里出现任何
    // 内联载荷切片就不是文字卡（search 不吃 g 标志的 lastIndex，不像 test 会漏判）。
    if (c.search(MAIL_PAYLOAD_RE) >= 0) return false;
    return true;
  }
  // 渲染端剥「名称|||」前缀残留 + 非图片 dataURL（语音等）成 [附件]——只洗显示
  function mailCleanDisplay(s) {
    if (typeof s !== 'string') return s;
    // FIX 2026-09-25 #1235 ①「名称|||」旧规则不吃空格，带空格的文件名（"my cat.png|||@@m:…"）会
    //   剩一截残名挂在信纸上＝用户所见的另一半「乱码」；补一条按扩展名收口的规则排在它前面
    //   （只吃「文件名.扩展名|||」，不吃整句正文）。②剩下的所有内联载荷统一交 chat.js #948 那份
    //   判据分类：图片引用（含无 MIME 的大写/空白变体）留下给 renderBody 渲图，其余（语音、
    //   octet-stream 里的非图等）一律收 [附件]，绝不再以正文形态铺出。
    //   旧写法只认三条精确前缀＝本次多机型复发的直接土壤。
    let t = s.replace(/[^\s|][^|\n]{0,59}?\.[a-z0-9]{1,5}\|\|\|/gi, '')
      .replace(/[^\s|]{0,40}\|\|\|/g, '')
      .replace(/(data:)?audio\/?[a-zA-Z0-9.+-]*;base64,[A-Za-z0-9+/=]+/g, '[附件]');
    return t.replace(MAIL_PAYLOAD_RE, function (m) {
      if (!mailIsImgRef(m)) return '[附件]';
      const fixed = window.chatFixNoMimeImg ? window.chatFixNoMimeImg(m) : '';
      return fixed || m;
    });
  }
  // FIX 2026-09-25 #1235 桌面横幅/通知口径：信件正文里任何形式的图片引用（令牌、规范 dataURL、
  //   无 MIME 或大写 MIME 变体）都收成 [图片]，非图载荷由 mailCleanDisplay 收 [附件]——通知条
  //   原先各写一份精确前缀正则，变体载荷直接铺进横幅＝手机上看到一长串乱码（同 #403 那族的口径）。
  function mailPlainDesc(s) {
    return mailCleanDisplay(String(s == null ? '' : s)).replace(MAIL_DESC_SLICE_RE, '[图片]');
  }
  function mailCardPool(cid) {
    const custom = cid ? (window.getCustomCardsFor ? window.getCustomCardsFor(cid) : []) : ((window.getCustomCards && window.getCustomCards()) || []);
    const pokeSet = (function () {
      const pk = cid ? (window.getPokeCardsFor ? window.getPokeCardsFor(cid) : []) : ((window.getPokeCards && window.getPokeCards()) || []);
      return pk.length ? new Set(pk) : null;
    })();
    const text = [], kaomoji = [], emoji = [];
    // 默认字卡独立子池（与自定义分开放，供按概率混入；不做合并）
    const defText = [], defKaomoji = [], defEmoji = [];
    const pushDefault = () => {
      try {
        // v3.12.x：开关按【该联系人桌面】读（同群聊/朋友圈口径）——某联系人桌面
        // 关「信箱使用」→ 只有这个联系人的来信不用默认字卡
        const st = (cid && window.storeFor) ? window.storeFor(cid) : null;
        const a = (window.defaultCardApiFor && st) ? window.defaultCardApiFor(st) : null;
        if (a ? !a.use('mail') : (window.defaultCardUse && !window.defaultCardUse('mail'))) return;
        const isOff = a ? a.isOff : (window.isDefaultCardOff || null);
        const catOn = a ? a.cat : (window.defaultCardCat || (() => true));
        if (catOn('main') && !defText.length) {
          const dg = (window.getDefaultCardGroups && window.getDefaultCardGroups('main')) || [];
          dg.forEach(g => (g[1] || []).forEach(c => { if (isOff && isOff('main', c)) return; if (!mailTextOnly(c)) return; defText.push(c); }));
        }
        if (catOn('kaomoji') && !defKaomoji.length) {
          const kg = (window.getDefaultCardGroups && window.getDefaultCardGroups('kaomoji')) || [];
          kg.forEach(g => (g[1] || []).forEach(c => { if (isOff && isOff('kaomoji', c)) return; if (!mailTextOnly(c)) return; defKaomoji.push(c); }));
        }
        if (catOn('emoji') && !defEmoji.length) {
          const eg = (window.getDefaultCardGroups && window.getDefaultCardGroups('emoji')) || [];
          eg.forEach(g => (g[1] || []).forEach(c => { if (isOff && isOff('emoji', c)) return; if (!mailTextOnly(c)) return; defEmoji.push(c); }));
        }
      } catch (e) {}
    };
    custom.forEach(s => {
      if (!s || typeof s !== 'string') return;
      if (pokeSet && pokeSet.has(s)) return;
      if (/^data:/.test(s)) return;
      // v3.6.x：语音字卡（文件名|||audio;base64）不以 data: 开头，需单独丢弃——
      //   否则整段音频 base64 会被当文字写进信件
      if (s.indexOf('|||') >= 0) return;
      // FIX 2026-09-13 #388 媒体池令牌卡不进信件文字池（同 chat.js #383 第三道守卫）
      // FIX 2026-09-13 #429 过滤收敛到 mailTextOnly（补裸令牌混排；默认卡三循环同口径）
      if (!mailTextOnly(s)) return;
      let isEmoji = false;
      for (const ch of s) {
        const c = ch.codePointAt(0);
        if ((c >= 0x1F000 && c <= 0x1FAFF) || (c >= 0x2600 && c <= 0x27BF)) { isEmoji = true; break; }
      }
      if (isEmoji) { emoji.push(s); return; }
      if (/[\(（｡◕(◕)(づ｡(¬)]/.test(s) && /[\)）】)]/.test(s)) { kaomoji.push(s); return; }
      // FIX 2026-09-15 #531：无括号颜文字（▽・ω・▽、๑•́ ₃ •̀๑ 等）也归颜文字，别占文字池
      if (!/[A-Za-z0-9\u4e00-\u9fff\u3041-\u3096\u30a1-\u30fa]/.test(s) && /[｡◕‿・▽´｀￣﹏◠◡≧≦ω＾￢¬^•˙˘๑٩۶ฅヽノ]/.test(s)) { kaomoji.push(s); return; }
      text.push(s);
    });
    pushDefault();
    const sticker = cid ? (window.getMediaCardsFor ? window.getMediaCardsFor(cid, 'sticker') : []) : ((window.getMediaCards && window.getMediaCards('sticker')) || []);
    const image = cid ? (window.getMediaCardsFor ? window.getMediaCardsFor(cid, 'image') : []) : ((window.getMediaCards && window.getMediaCards('image')) || []);
    // FIX 2026-09-15 #534 信箱内容类型总开关在【池这一层】生效（设置→回复设置→信箱
    //   「写信内容类型」ml-kaomoji-en / ml-emoji-en / ml-sticker-en）：旧实现只在
    //   taLetterContent 的「附加」两步查 kaomojiEn/stickerEn，而正文动词
    //   pickDefaultMailCard 会按 dc-prob-* 分类权重直接注入 defKaomoji/defEmoji——
    //   用户把「来信内容使用颜文字」关掉后，系统预设补池里的颜文字仍按占比混进正文
    //   （用户报「设置了朋友圈和信箱已经把颜文字和表情包都禁了，还是会出现」；
    //   多机型同报，纯逻辑、零机型分支）。这里直接清空对应池，任何消费方都取不到，
    //   与朋友圈 feedTypeOn 清池同款口径。缺省键＝开，存量用户行为不变。
    const tcfg = mailCfgFor(cid);
    if (!tcfg.kaomojiEn) { kaomoji.length = 0; defKaomoji.length = 0; }
    if (!tcfg.emojiEn) { emoji.length = 0; defEmoji.length = 0; }
    if (!tcfg.stickerEn) { sticker.length = 0; image.length = 0; }
    return {
      text: text,
      kaomoji: kaomoji,
      emoji: emoji,
      defText: defText,
      defKaomoji: defKaomoji,
      defEmoji: defEmoji,
      sticker: sticker,
      image: image
    };
  }
  // 按「整体概率 + 分类占比」从默认字卡池抽一张（main/kaomoji/emoji；拍一拍不进信件）；
  // 未命中/池空返回 ''——与聊天 getDefaultCards 同语义，不含拍一拍分类
  function pickDefaultMailCard(pool, cid) {
    try {
      // v3.12.x：概率/占比/分类开关按【该联系人桌面】读（同 pushDefault 口径）
      const st = (cid && window.storeFor) ? window.storeFor(cid) : null;
      const a = (window.defaultCardApiFor && st) ? window.defaultCardApiFor(st) : null;
      const dcfg = a ? a.cfg() : ((window.defaultCardCfg && window.defaultCardCfg()) || {});
      if (dcfg.enabled === false) return '';
      // v3.28.x：写信场景概率读 dc-overall-mail（未设置回退整体 dc-overall）——用户可单独调高写信默认字卡占比
      const overall = (dcfg.overallFor ? dcfg.overallFor('mail') : ((dcfg.overall === undefined || dcfg.overall === null) ? 30 : dcfg.overall));
      if (Math.random() * 100 >= overall) return '';
      const keys = ['main', 'kaomoji', 'emoji'];
      const pools = { main: pool.defText, kaomoji: pool.defKaomoji, emoji: pool.defEmoji };
      const catOn = a ? a.cat : (window.defaultCardCat || (() => true));
      // FIX 2026-09-15 #534 写信内容类型开关也管住这条「默认字卡按分类占比混入」路径：
      //   kaomoji/emoji 被关掉时权重清零，抽签不会再落到空池导致整次注入空转（与
      //   mailCardPool 清池同批；缺省键＝开，存量行为不变）。
      const mcfg = mailCfgFor(cid);
      const weights = keys.map(k => {
        if (k === 'kaomoji' && !mcfg.kaomojiEn) return 0;
        if (k === 'emoji' && !mcfg.emojiEn) return 0;
        return catOn(k) ? Math.max(0, (dcfg.probs && dcfg.probs[k]) || 0) : 0;
      });
      const total = weights.reduce((a, b) => a + b, 0);
      if (total <= 0) return '';
      let roll = Math.random() * total;
      for (let i = 0; i < keys.length; i++) {
        roll -= weights[i];
        if (roll < 0) {
          const p = pools[keys[i]] || [];
          if (p.length) return p[Math.floor(Math.random() * p.length)];
          return '';
        }
      }
    } catch (e) {}
    return '';
  }
  // v3.12.x：只读探针——TA 写信素材池（自定义 + 按该联系人桌面开关的默认字卡子池），
  // 供回归测试与来源诊断
  window.mailPoolFor = function (cid) {
    try {
      const p = mailCardPool(cid);
      // #534：补 kaoN/emojiN/stickerN/imageN——「内容类型开关关掉后对应池确实清空」
      // 需要能直接观测，否则回归只能靠间接推断。
      return {
        textN: p.text.length, defTextN: p.defText.length, defKaoN: p.defKaomoji.length, defEmojiN: p.defEmoji.length,
        kaoN: p.kaomoji.length, emojiN: p.emoji.length,
        stickerN: (p.sticker || []).length, imageN: (p.image || []).length
      };
    } catch (e) { return null; }
  };
  // TA 写信内容：多个字卡（空格分隔）+ 概率加颜文字/emoji/表情包
  function taLetterContent(cfg, cid) {
    const pool = mailCardPool(cid);
    // FIX 2026-09-15 #531：自定义「文字」池若全是颜文字/符号（没有可读句子卡），视为没有自定义
    // 正文——退回系统预设默认字卡正文（defText）。否则信件正文只剩用户加的那几张符号，用户报
    //「信都是颜文字」。含中文/字母的自定义字卡行为不变。
    const hasCustom = pool.text.some(s => typeof s === 'string' && /[A-Za-z0-9\u4e00-\u9fff\u3041-\u3096\u30a1-\u30fa]/.test(s));
    // 有自定义字卡 → 正文主体用自定义；无自定义 → 整体回退默认字卡池（再空才用固定文案）
    const words = hasCustom ? pool.text : (pool.defText.length ? pool.defText : TA_LETTERS);
    // v3.6.x：条数在「最少/最多字卡条数」之间随机；上限不超过池子大小——
    // 移除自定义字卡内置预设后用户没添加字卡时 words 回退为固定文案，
    // 条数超过池子会从同几段里反复抽 → 内容复制粘贴很多次（已修）。
    const maxN = Math.max(1, words.length);
    const wantMin = Math.min(Math.max(1, cfg.minCards || 1), maxN);
    const wantMax = Math.min(Math.max(wantMin, cfg.maxCards || wantMin), maxN);
    const n = wantMin + Math.floor(Math.random() * (wantMax - wantMin + 1));
    const parts = [];
    for (let i = 0; i < n; i++) {
      // v3.8.x：有自定义字卡时，每张卡按 dc-overall 概率混入默认字卡（自定义+默认一起用）；
      //   无自定义时正文整体已是默认字卡池，不再重复混入
      if (hasCustom) {
        const d = pickDefaultMailCard(pool, cid);
        if (d) { parts.push(d); continue; }
      }
      parts.push(words[Math.floor(Math.random() * words.length)]);
    }
    // v3.36.x：词典写信混入——词典独立页「写信使用」开启时，按「写信使用概率」
    //   随机把一条词典语录追加进信件正文（dictQuoteOne 自带分类/单卡开关过滤；
    //   池空或场景关=不混，默认概率 30%）
    try {
      if (window.dictUse && window.dictUse('mail') && window.dictQuoteOne
          && Math.random() * 100 < (window.dictOverall ? window.dictOverall('mail') : 30)) {
        const dq = window.dictQuoteOne();
        if (dq) parts.push(dq);
      }
    } catch (eDQ) {}
    // #1198 每两条字卡中间走「拼接符号」池（回复设置 → 信箱「信件拼接随机标点」，默认关＝仍用空格
    // ＝老样子）。符号池与聊天共用同一套（含内置「换行」，抽到才另起一行；信纸 .mail-paper-body
    // 本来就是 pre-wrap）；按【发信联系人桌面】读设置，与 mailCfgFor 同口径。
    const rcf = window.replyCfgFor ? window.replyCfgFor(cid) : null;
    let t = (window.pyJoinCards && rcf) ? window.pyJoinCards(parts, rcf, rcf['ml-punct-en'] === 1) : parts.join(' ');
    // 颜文字/emoji 附加：自定义对应分类为空时回退默认池（保持原补池行为）
    const kp = pool.kaomoji.length ? pool.kaomoji : pool.defKaomoji;
    const ep = pool.emoji.length ? pool.emoji : pool.defEmoji;
    if (cfg.kaomojiEn && kp.length && Math.random() * 100 < 30) t += ' ' + kp[Math.floor(Math.random() * kp.length)];
    if (cfg.emojiEn && ep.length && Math.random() * 100 < 15) t += ' ' + ep[Math.floor(Math.random() * ep.length)];
    // v3.11.x：只收 dataURL 媒体——信件正文按 sticker:/data:image 正则识别内联图片，
    //   链接导入的 http(s) 字卡拼进信纸只会显示成一段 URL 文字，先过滤掉
    // FIX 2026-09-13 #386 媒体池令牌卡放行（renderBody 已认 @@m:hash 渲内联图）
    // FIX 2026-09-25 #1235 附图池按统一口径选（旧写法只认串首小写 data: 与裸令牌：FileReader 在
    //   File.type 为空时给的 "data:;base64,…"、大写 MIME 变体抽不到＝带图的表情包写信没图）；
    //   http 直链仍排除（#533：拼进信纸只会显示成一段 URL 文字）。
    const st = pool.sticker.concat(pool.image).filter(s => typeof s === 'string' && s.indexOf('http') !== 0 && mailIsImgRef(s));
    if (cfg.stickerEn && st.length && Math.random() * 100 < 20) {
      // v3.26.x：TA 自动写信/回信选中的表情包如果超大（>阈值），在这里同步换一张
      //   小图（避免几百 KB 原图拼进 content 触发信箱主键 200KB 剥图成「图片」）。
      //   仓库里的原图先经 shrinkMediaUrl 抽一张压缩版缓存到内存，退化场景才保留原图。
      const orig = st[Math.floor(Math.random() * st.length)];
      const small = (window._shrunkStickerCache && window._shrunkStickerCache[orig]) || orig;
      t += ' ' + small;
    }
    // FIX 2026-09-25 #1235 落库口规范化：无 MIME / 大写 MIME 的图片载荷补正形态后再写信件正文，
    //   下游（信纸、横幅、剥图快照、#403 那几处历史正则）都以小写 data:image 形态为锚，堵住变体
    //   被当正文铺出的来路（历史存量仍由 mailCleanDisplay + renderBody 兜底）。
    return mailCanonPayload(t);
  }
  function letterLast(cid) { const v = parseInt(csFor(cid).get('mail-letter-last'), 10); return isNaN(v) ? 0 : v; }
  function letterNext(cid) { const v = parseFloat(csFor(cid).get('mail-letter-next')); return isNaN(v) ? 0 : v; }
  // v3.6.x：每日来信计数（按自然日）——mail-letter-day 存 { d:'日期', n:当天来信数 }
  function letterDayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function letterDayCount(cid) {
    try {
      const r = JSON.parse(csFor(cid).get('mail-letter-day') || 'null');
      return r && r.d === letterDayKey() ? Number(r.n) || 0 : 0;
    } catch (e) { return 0; }
  }
  function letterDayAdd(cid) {
    const n = letterDayCount(cid) + 1;
    try { csFor(cid).set('mail-letter-day', JSON.stringify({ d: letterDayKey(), n: n })); } catch (e) {}
    return n;
  }
  // v3.7.x：单联系人的 TA 来信——用该联系人自己的字卡 + 写到该联系人命名空间。
  //   原实现 maybeIncomingLetter 单定时器用 store（当前激活桌面），用户在 default
  //   桌面时所有联系人的来信都写到 default 命名空间 → 串桌面（default 桌面堆所有
  //   联系人的信，切到其它桌面看不到自己的信）。改为遍历各联系人，每个独立写各自
  //   命名空间，互不串。前台弹窗仅当前激活桌面才弹（用户能看到），非当前桌面走
  //   notifyMailToChat 写该桌面聊天系统消息（下次切到该桌面可见）。
  function maybeIncomingLetterFor(cid) {
    try {
      // v3.9.x：当前桌面权威加载完成前不写来信（同 checkPendingReplyFor 的守卫——
      // load(cid) 此时可能来自剥图快照，unshift 后直接落盘会覆盖 IDB 带图信件）
      if (cid === (window.__activeCid || 'default') && !mailDbReady) return;
      const cs = csFor(cid);
      const now = Date.now();
      // v3.12.x：按该联系人桌面读设置（每天最多写信/概率/间隔各自独立生效）
      const cfg = mailCfgFor(cid);
      // FIX 2026-09-29 #1442a 来信让路：读不出权威这一班整发不生成（不烧 last/next/当日上限、
      //   不发「给你寄来了一封信」的通知）——拿读空拼出来的那一封会把库里整本顶掉。
      if (mailBlindRead(cid)) return; // #1442a 来信让路
      // #296：联系人主动写信总开关——关闭后本桌面 TA 不再主动来信（回信/摸鱼小结不受影响）
      if (!cfg.writeEn) return;
      let last = letterLast(cid), next = letterNext(cid);
      if (last > now || last < 0 || isNaN(last)) { last = 0; next = 0; }
      if ((now - last) / 60000 < next) return;
      const dailyMax = cfg.dailyMax > 0 ? cfg.dailyMax : 3;
      if (letterDayCount(cid) >= dailyMax) {
        cs.set('mail-letter-last', String(now));
        cs.set('mail-letter-next', String(30));
        return;
      }
      if (Math.random() * 100 >= cfg.writeProb) return;
      const name = partnerNameFor(cid);
      const content = taLetterContent(cfg, cid);
      const letter = { id: 'l_' + Date.now() + '_' + cid, type: 'received', tt: TITLES[Math.floor(Math.random() * TITLES.length)], content: content, tm: Date.now() };
      const list = load(cid);
      list.unshift(letter);
      save(list, cid);
      cs.set('mail-letter-last', String(now));
      cs.set('mail-letter-next', String(cfg.writeMin + Math.random() * Math.max(1, cfg.writeMax - cfg.writeMin)));
      letterDayAdd(cid);
      notifyMailToChat(cid, '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>' + name + ' 给你寄来了一封信', { mailNotice: true });
      // 前台弹窗 + 角标刷新仅当前激活桌面（用户能看到）；非当前桌面下次切回时 load 自然显示
      if (cid === (window.__activeCid || 'default')) {
        updateBadge();
        render();
        if (window.showDeskPopup && !mailPageVisible()) {
          window.showDeskPopup({ name: '信箱', notifyKind: 'mail', text: mailPlainDesc('给你寄来了一封信：' + String(content || '')), onClick: openMailPage, isHidden: document.visibilityState === 'hidden' });
        }
      }
    } catch (e) {}
  }
  function maybeIncomingLetter() {
    const list = (window.getContacts && window.getContacts()) || [{ id: 'default' }];
    list.forEach(c => maybeIncomingLetterFor(c.id));
  }

  // ================= v3.13.x：每周摸鱼小结（周日 18 点后生成；周一~周三补上周的） =================
  // 数据源：该联系人桌面命名空间的 fish-day-add / work-day-add（每日新增记录，与日历同源）。
  // 以 TA 口吻寄一封「本周摸鱼小结」进信箱；标记键 fish-week-report:<M-D>（周日日期）防重发。
  function fishWeekReportFor(cid) {
    // 当前桌面权威加载（mailDbReady）完成前不写——同 maybeIncomingLetterFor 守卫，
    // 防止把剥图快照当全量列表写回覆盖 IDB 带图信件
    if (cid === (window.__activeCid || 'default') && !mailDbReady) return;
    // #645：回复设置→信箱「摸鱼小结寄信」开关（ml-fish-week-en）——关闭后不再寄小结；
    // 判定放在防重发标记写入之前，关掉再开若仍在周一~周三补发窗口内会补上该周小结
    // FIX 2026-09-29 #1442c 小结让路：读不出权威这一班不许把周标记烧掉（烧了这一周就永不补发）。
    if (mailBlindRead(cid)) return; // #1442c 小结让路
    if (!mailCfgFor(cid).fishWeekEn) return;
    const cs = csFor(cid);
    const now = window.__fishWeekNowOverride ? window.__fishWeekNowOverride() : new Date(); // 测试钩子：生产为 null
    const day = now.getDay(); // 0=日
    const cur = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let sun; // 小结所属周的周日（周一~周日算一周）
    if (day === 0 && now.getHours() >= 18) {
      sun = cur;
    } else {
      const back = ((day + 6) % 7) + 1; // 距上一个周日 1~7 天（周一=2 … 周六=7）
      if (back < 2 || back > 4) return; // 只补最近一周：周一~周三内补发
      sun = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - back);
    }
    const markKey = 'fish-week-report:' + (sun.getMonth() + 1) + '-' + sun.getDate();
    if (cs.get(markKey)) return;
    cs.set(markKey, '1');
    const start = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() - 6);
    const startTs = start.getTime();
    const endTs = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + 1).getTime();
    // fishDayKey 日期格式 YYYY-M-D 不补零（iOS 解析需先补零——calendar/personalize 同款口径）
    const parseDay = (s) => {
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || ''));
      if (!m) return NaN;
      return Date.parse(m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) + 'T00:00:00');
    };
    let fm = 0, ft = 0, wm = 0, wt = 0;
    const wdSum = [0, 0, 0, 0, 0, 0, 0]; // 周一..周日 各日双方摸鱼合计
    try {
      JSON.parse(cs.get('fish-day-add') || '[]').forEach(x => {
        const ts = parseDay(x && x.date);
        if (isNaN(ts) || ts < startTs || ts >= endTs) return;
        const m2 = x.mine || 0, t2 = x.ta || 0;
        fm += m2; ft += t2;
        wdSum[(new Date(ts).getDay() + 6) % 7] += m2 + t2;
      });
    } catch (e) {}
    try {
      JSON.parse(cs.get('work-day-add') || '[]').forEach(x => {
        const ts = parseDay(x && x.date);
        if (isNaN(ts) || ts < startTs || ts >= endTs) return;
        wm += x.mine || 0; wt += x.ta || 0;
      });
    } catch (e) {}
    const name = partnerNameFor(cid);
    let bestIdx = 0;
    for (let i = 1; i < 7; i++) if (wdSum[i] > wdSum[bestIdx]) bestIdx = i;
    const wdNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const totalFish = fm + ft;
    const lines = [
      '本周（' + (start.getMonth() + 1) + '月' + start.getDate() + '日 - ' + (sun.getMonth() + 1) + '月' + sun.getDate() + '日）小结',
      '',
      '你和我一共摸鱼 ' + totalFish + ' 点（你 +' + fm + ' · 我 +' + ft + '）。',
      totalFish > 0 ? '最会摸的一天是' + wdNames[bestIdx] + '，加了 ' + wdSum[bestIdx] + ' 点。' : '这一周还没怎么摸鱼呀，都在认真打工吗？',
      '工作值也一起攒了 ' + (wm + wt) + ' 点（你 +' + wm + ' · 我 +' + wt + '）。',
      '',
      '下周也偷偷一起加油呀。'
    ];
    const letter = { id: 'l_' + Date.now() + '_' + cid + '_wk', type: 'received', tt: '本周摸鱼小结', content: lines.join('\n'), tm: Date.now() };
    const list = load(cid);
    list.unshift(letter);
    save(list, cid);
    notifyMailToChat(cid, '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>' + name + ' 寄来一份本周摸鱼小结', { mailNotice: true });
    if (cid === (window.__activeCid || 'default')) {
      updateBadge();
      render();
      if (window.showDeskPopup && !mailPageVisible()) {
        window.showDeskPopup({ name: '信箱', notifyKind: 'mail', text: '寄来了一份本周摸鱼小结', onClick: openMailPage, isHidden: document.visibilityState === 'hidden' });
      }
    }
  }
  function fishWeekTick() {
    const list = (window.getContacts && window.getContacts()) || [{ id: 'default' }];
    list.forEach(c => { try { fishWeekReportFor(c.id); } catch (e) {} });
  }
  window.fishWeekTick = fishWeekTick; // v3.13.x：暴露给专项验证脚本（生产内部定时器同样调它）
  // v3.9.x 修复（iOS 信箱 TA 回信永不触发）：原实现 checkPendingReply 只在
  //   「启动后 20~60s 随机延迟 + 每 60s 定时器」里跑。iOS 后台/锁屏会冻结全部
  //   页面定时器、主屏独立 PWA 很快被系统回收，用户会话经常短于 20~60s 首查延迟
  //   （开 App 看一眼信箱就切走）→ 到期回信计划永远等不到落地时机，表现为
  //   「回了信/寄了信，联系人回信一直不触发」。修复：补查不再依赖唯一定时器——
  //   ① 启动立即补查；② 前台可见性恢复（visibilitychange/pageshow/focus，节流 5s）
  //   立即补查（iOS 从后台切回/解锁即落地）；③ 权威加载完成回调里补查；
  //   ④ 打开信箱页时补查。来信（maybeIncomingLetter）有 last/next 时间窗 +
  //   每日上限守卫，跟随补查只会更及时不会刷屏。
  checkPendingReply(); // 启动立即补查（当前桌面未就绪由内部守卫跳过，就绪后回调再补）
  setTimeout(() => {
    setInterval(() => {
      // v3.27.x 性能：后台空转守卫——hidden 且无后台通知通道（bgNotifyCheck 缺失）时，
      // 本轮来信/回信落地用户全都看不见（弹窗走不了、渲染已被 render 门槛跳过），
      // 回前台由 eagerCheck 立即补查，及时性不损失。
      // 有 bgNotifyCheck 时照跑＝不能跳：「人在后台仍收到来信通知」是 #673 起的
      // 产品功能（showDeskPopup isHidden→bgNotifyCheck），跳过＝负优化。
      if (document.visibilityState === 'hidden' && !window.bgNotifyCheck) return;
      maybeIncomingLetter(); checkPendingReply(); fishWeekTick();
    }, 60000);
    maybeIncomingLetter();
    fishWeekTick();
  }, (20 + Math.random() * 40) * 1000);
  // 前台恢复补查（节流 5s）：visibilitychange 覆盖 iOS 切后台/锁屏回前台；
  // pageshow(persisted) 覆盖 bfcache 恢复（期间定时器被冻结）；focus 覆盖
  // 只触发 focus 不触发 visibilitychange 的浏览器
  let lastEagerCheck = 0;
  function eagerCheck() {
    const now = Date.now();
    if (now - lastEagerCheck < 5000) return;
    lastEagerCheck = now;
    maybeIncomingLetter();
    checkPendingReply();
    fishWeekTick();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') eagerCheck();
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted) eagerCheck(); });
  window.addEventListener('focus', eagerCheck);

  // ================= 入口与交互 =================
  // v3.10.x：写信/回信内容读取兜底——安卓 mobile-adapt 把输入框转成 ce-box 后值走
  // value 代理，个别内核（vivo/OPPO 系实测先例）代理读空 → sendLetter 拿到空串
  // 直接「信件内容不能为空」返回，信根本没寄出去（列表自然无信可点、也永远等不到
  // 回信）。这里对齐 period.js readInpVal / music-player readCeInput：读空再从
  // __ceBox 取 innerText 兜底。
  function readMailVal(el) {
    if (!el) return '';
    let v;
    try { v = el.value; } catch (e) {}
    if (v !== undefined && v !== null && String(v).trim()) return String(v);
    try {
      const box = el.__ceBox || (el.parentNode && el.parentNode.querySelector('.ce-box[data-for="' + (el.id || '') + '"]'));
      if (box) return (box.innerText !== undefined ? box.innerText : box.textContent) || '';
    } catch (e) {}
    return v === undefined || v === null ? '' : String(v);
  }
  const mailApp = document.querySelector('.app[data-app="mail"]');
  const mailPage = document.getElementById('page-mail');
  if (mailApp && mailPage) {
    mailApp.addEventListener('click', () => {
      const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
      if (editing) return;
      openMailPage();
    });
  }
  const mailBack = document.getElementById('mail-back');
  if (mailBack) mailBack.addEventListener('click', () => {
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const phone = document.getElementById('page-phone');
    if (phone) phone.hidden = false;
  });
  // 写信：写信 tab 按钮 / 独立写信页
  const openWriteBtn = document.getElementById('mail-open-write');
  if (openWriteBtn) {
    openWriteBtn.addEventListener('click', () => {
      const toEl = document.getElementById('mail-write-to');
      if (toEl) toEl.textContent = partnerName();
      showPage('page-mail-write');
    });
  }
  const mailWriteBack = document.getElementById('mail-write-back');
  if (mailWriteBack) mailWriteBack.addEventListener('click', () => { if (window.closeEmojiPanel) window.closeEmojiPanel(); showPage('page-mail'); render(); });
  const mailSend = document.getElementById('mail-send');
  if (mailSend) mailSend.addEventListener('click', sendLetter);
  // 回信页：返回 / 寄出
  const mailReplyBack = document.getElementById('mail-reply-back');
  if (mailReplyBack) mailReplyBack.addEventListener('click', () => { if (window.closeEmojiPanel) window.closeEmojiPanel(); viewLetter = null; showPage('page-mail'); render(); });
  const mailReplySend = document.getElementById('mail-reply-send');
  if (mailReplySend) mailReplySend.addEventListener('click', submitReply);
  // tab 切换（v3.10.x 抽成函数：寄信成功后自动跳「寄出的信」复用）
  function selectMailTab(name) {
    mtab = name;
    document.querySelectorAll('#page-mail .fav-tab').forEach(x => x.classList.toggle('sel', x.dataset.mtab === name));
    document.querySelectorAll('#page-mail .cal-card').forEach(c => { c.hidden = c.dataset.mpanel !== name; });
  }
  document.querySelectorAll('#page-mail .fav-tab').forEach(tab => {
    tab.addEventListener('click', () => selectMailTab(tab.dataset.mtab));
  });

  // ================= 写信/回信：表情包 / 图片 工具栏（v3.6.x 只留这两个按钮） =================
  // 表情包：直接复用聊天页同一个表情包面板（window.openEmojiPanelForInsert），
  // 界面/分组/数据与聊天完全一致；点击表情以 sticker:dataURL 插入信纸（渲染时显示小图）。
  // 图片：多选上传 → 压缩到 720px 后按大图（image:）插入信纸。
  // 向写信/回信输入框追加内容（插入到光标处）
  function mailInsertInto(textarea, s) {
    if (!textarea) return;
    // v3.5.135：contenteditable 转换模式（__ceBox）——插入**图片缩略图**而非纯文本，
    // 否则输入框里显示一大串 base64 字母；隐藏的 span 保留完整标记文本供 value 读取
    if (textarea.__ceBox) {
      try {
        const box = textarea.__ceBox;
        box.focus();
        const sel = window.getSelection();
        let node = box;
        let offset = 0;
        if (sel && sel.rangeCount && box.contains(sel.anchorNode)) {
          offset = sel.anchorOffset;
          node = sel.anchorNode;
        }
        const range = document.createRange();
        range.setStart(node, offset);
        range.collapse(true);
        // 图片缩略图（dataURL 直接作 src；sticker 小图/图片大图都用中等缩略）
        const img = document.createElement('img');
        img.src = String(s).replace(/^(?:sticker|image):/, '');
        img.style.cssText = 'max-width:120px;max-height:120px;border-radius:8px;vertical-align:middle;margin:2px;display:inline-block;';
        img.contentEditable = 'false';
        // 隐藏文本占位（完整标记文本，供 value getter 读回存储）
        const span = document.createElement('span');
        span.className = 'mail-media-mark';
        span.style.display = 'none';
        span.textContent = s;
        span.contentEditable = 'false';
        // v3.6.x：用 DocumentFragment 一次性插入保证 DOM 顺序为 img → span → 空格。
        // 直接连续 range.insertNode 每次都插到 range 起点且起点不移动，结果是逆序
        // （span 跑到 img 前面）；mobile-adapt 的 value getter 靠「img 后紧跟标记 span」
        // 跳过 img 去重，逆序时检测失败 → 同一张图被输出两遍（信件里表情包变两个）。
        const frag = document.createDocumentFragment();
        frag.appendChild(img);
        frag.appendChild(span);
        frag.appendChild(document.createTextNode(' '));
        range.insertNode(frag);
        // 光标移到插入内容之后
        range.setStartAfter(span);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        // 触发 input 事件（业务可能监听）
        try { textarea.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
        return;
      } catch (e) {
        // 回退到文本插入
      }
    }
    try {
      let start = textarea.selectionStart;
      if (typeof start !== 'number' || isNaN(start)) start = textarea.value.length;
      const end = start;
      textarea.value = textarea.value.slice(0, start) + s + textarea.value.slice(end);
      textarea.focus();
      const pos = start + s.length;
      textarea.setSelectionRange(pos, pos);
    } catch (e) {
      textarea.value += s;
    }
  }
  // 上传本地图片：多选 → 压缩到 720px 后按大图（image:）插入信纸
  // FIX 2026-09-18 #755：统一走 window.mochiFilePick（原实现 accept 迟到＋无 label 兜底＋
  // 每次调用 new 一个 input 再 remove）
  function mailUploadImage(textarea) {
    window.mochiFilePick({
      id: 'mochi-mail-img-pick', accept: 'image/*', multiple: true,
      onFiles: (files) => {
        if (!files.length) { toast('没有取到图片，请再选一次'); return; }
        if (!window.mochiImgIngest) { toast('图片处理组件没加载上（缓存过旧或离线），请重新打开页面再试'); return; }
        // FIX 2026-09-25 #1270：旧写法每张各自 readAsDataURL ＋ 整幅解码（48MP 照片＝192MB 位图＝
        // 选一张信纸配图就白屏大退），且解码失败/画布异常时把整张原图 base64 塞进信纸正文。
        // 现逐张串行过统一解码闸（多选时同一时刻只有一张在解），没成功的这张如实跳过并汇总提示。
        let mailImgMiss = 0;
        let mailImgChain = Promise.resolve();
        files.forEach(f => {
          mailImgChain = mailImgChain.then(() => window.mochiImgIngest(f, { maxSide: 720, mime: 'image/png', tag: 'mail-img' }).then((r) => {
            if (!r || r.st !== 'ok' || !r.data) { mailImgMiss++; return; }
            mailInsertInto(textarea, 'image:' + r.data);
          }));
        });
        mailImgChain.then(() => { if (mailImgMiss) toast('有 ' + mailImgMiss + ' 张图片没能插入，请换一张小图或用系统相机重拍'); });
      }
    });
  }
  // 绑定写信/回信工具栏（v3.6.x 只保留 表情包 / 图片 两个按钮）
  function bindMailToolbar(scope, textareaId) {
    const root = document.querySelector(scope);
    const textarea = document.getElementById(textareaId);
    if (!root || !textarea) return;
    const stickerBtn = root.querySelector('.mail-tb-sticker');
    if (stickerBtn) stickerBtn.addEventListener('click', (e) => {
      // stopPropagation：防止冒泡到 document 的「面板外点击关闭」把刚打开的面板又关掉
      e.stopPropagation();
      // 复用聊天同一个表情包面板（插入模式：点击表情插入信纸）
      // v3.26.x：贴进信纸正文前先压缩超大表情包 dataURL（见 chatcard.js shrinkMediaUrl）——
      //   否则写信/回信把几百 KB 原图拼进 content，信箱主键超 200KB 剥图成「图片」文字
      // #636：kind==='text' 是颜文字/emoji 文字卡，按纯文本插入信纸（不走 sticker: 标记）
      if (window.openEmojiPanelForInsert) window.openEmojiPanelForInsert((src, kind) => {
        if (kind === 'text') { mailInsertInto(textarea, src); return; }
        // 压缩成功/失败两条腿都要过落库口：shrinkMediaUrl 对认不出的形态原样直传，
        // allowUrl 的网图 src 则根本不是 dataURL（mailCanonPayload 对非串原样返回）
        try { if (window.shrinkMediaUrl) { window.shrinkMediaUrl(src, (small) => { mailInsertInto(textarea, 'sticker:' + (mailCanonPayload(small) || mailCanonPayload(src))); }); return; } } catch (e) {}
        mailInsertInto(textarea, 'sticker:' + mailCanonPayload(src));
      }, { allowUrl: true });
    });
    const upImg = root.querySelector('.mail-tb-image');
    if (upImg) upImg.addEventListener('click', () => mailUploadImage(textarea));
  }
  bindMailToolbar('#page-mail-write', 'mail-input');
  bindMailToolbar('#page-mail-reply', 'mail-reply-input');

  // ================= 信箱数据：导出 / 导入 / 清空（v3.6.x） =================
  // 数据就是 mail-letters 数组（含收信/寄信/回信/对方回信），导出为 JSON 下载；
  // 导入按信件 id 去重合并；清空需确认，同时清掉待回信计划。
  function mailExportData() {
    const list = load();
    const json = JSON.stringify({ version: '1.0', app: 'mochi-mail', exportTime: new Date().toISOString(), letters: list }, null, 2);
    // FIX 2026-09-30 #1488：走统一小文件三级导出链（系统分享面板→保存框→确认后下载）——
    // 原裸 a[download] 在 iPhone 主屏安装（standalone 无下载管理器）与 #758 壳浏览器家族
    // 静默无反应＝信箱导不出去（#172 同族最后一处漏改）。链路不可用时保留裸腿兜底。
    if (window.mochiExportFile) { window.mochiExportFile(json, '信箱数据_' + new Date().toISOString().slice(0, 10) + '.json', '信箱数据'); return; }
    try {
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '信箱数据_' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast('已导出 ' + list.length + ' 封信');
    } catch (e) { toast('导出失败'); }
  }
  // 兼容旧 iOS：读取文件文本（File.text() 不支持时退回 FileReader）
  function mailReadFileText(file) {
    return new Promise((resolve) => {
      if (typeof file.text === 'function') {
        file.text().then(resolve).catch(() => readViaReader());
      } else readViaReader();
      function readViaReader() {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => resolve('');
        r.readAsText(file, 'utf-8');
      }
    });
  }
  function mailImportFile(file) {
    mailReadFileText(file).then((text) => {
      let arr = null;
      try {
        const data = JSON.parse(text || 'null');
        if (Array.isArray(data)) arr = data;
        else if (data && Array.isArray(data.letters)) arr = data.letters;
      } catch (e) {}
      if (!arr || !arr.length) { toast('无效的信箱数据文件'); return; }
      const valid = arr.filter(x => x && typeof x === 'object' && x.id);
      if (!valid.length) { toast('文件中没有有效的信件数据'); return; }
      const cur = load();
      // 按 id 去重合并：导入的信件覆盖同 id，新增的追加
      const map = {};
      cur.forEach(l => { if (l && l.id) map[l.id] = l; });
      valid.forEach(l => { map[l.id] = l; });
      const merged = Object.keys(map).map(k => map[k]);
      if (window.openModal) {
        window.openModal('导入 ' + valid.length + ' 封信？', '', () => {
          save(merged);
          viewLetter = null;
          render();
          updateBadge();
          toast('已导入 ' + valid.length + ' 封信（共 ' + merged.length + ' 封）');
        }, { noInput: true, staticText: '将合并进现有信箱（当前 ' + cur.length + ' 封）：\n· 导入 ' + valid.length + ' 封，其中 ' + (valid.length - (merged.length - cur.length)) + ' 封覆盖同 id 旧信\n· 同 id 以导入内容为准，其余保留\n导入后共 ' + merged.length + ' 封。' });
      }
    });
  }
  function mailClearAll() {
    if (mailWriteBlockedNow('信箱')) return; // #1469h 清空按住并提示（残缺读数当「答案」清空＝既删不准也盖掉库里那本）
    const n = load().length;
    if (window.openModal) {
      window.openModal('清空所有信件？', '', () => {
        save([]);
        replyPendingSave([]); // 同时清掉未到期的 TA 回信计划
        viewLetter = null;
        render();
        updateBadge();
        toast('信箱已清空');
      }, { noInput: true, staticText: '将删除全部 ' + n + ' 封信（收信/寄信/回信），且无法恢复。' });
    }
  }
  // 删除单封信：确认后移除该信及其 TA 回信计划，关闭详情并刷新列表/角标
  function deleteLetter(l) {
    if (!l || !l.id) return;
    // #1469：读数残缺（读空／写到 LS 的落不回去留下的旧账／数据层交不出权威读数）时这一发当场按住——
    //   拿一页残缺列表整包写回去「删」一封，等于把库里那些没读到的信一起删没；而只把这一封从暂存里摘掉，
    //   又会在库里那本读回来后复活。作者定的口径＝只保新写的信，删除要等读数落定（等几秒再点一次即可）。
    if (mailWriteBlockedNow('这封信')) return; // #1469g 删除按住并提示
    if (window.openModal) {
      window.openModal('删除这封信？', '', () => {
        const list = load();
        save(list.filter(x => x.id !== l.id));
        const pending = replyPendingLoad().filter(p => !p || p.id !== l.id);
        replyPendingSave(pending);
        viewLetter = null;
        render();
        updateBadge();
        const mask = document.getElementById('tc-mask');
        if (mask) mask.hidden = true;
        toast('信件已删除');
      }, { noInput: true, staticText: '删除后将无法恢复。' });
    }
  }
  const mailExportBtn = document.getElementById('mail-export');
  if (mailExportBtn) mailExportBtn.addEventListener('click', mailExportData);
  const mailImportBtn = document.getElementById('mail-import');
  if (mailImportBtn) {
    mailImportBtn.addEventListener('click', () => {
      // FIX 2026-09-18 #755：统一走 window.mochiFilePick（原实现 detached＋无 label＋accept 迟到）
      window.mochiFilePick({
        id: 'mochi-mail-import-pick', accept: window.mochiDataPickAccept, // #1413：与整机导入同一份并集（窄串会让转存后改了类型的备份灰显）
        onFiles: (files) => {
          const f = files && files[0];
          if (!f) { toast('没有取到文件，请再选一次'); return; }
          mailImportFile(f);
        }
      });
    });
  }
  const mailClearBtn = document.getElementById('mail-clear');
  if (mailClearBtn) mailClearBtn.addEventListener('click', mailClearAll);
  // FIX 2026-09-29 #1417：信件数据页的常驻自救入口——列表上方那张提示条只在「读出旧账/读空」时
  //   出现；这一枚是作者直派「新增自救的恢复按钮」的固定落点（进数据管理就找得到，任何时候可点）
  const mailRescueBtn = document.getElementById('mail-rescue-data');
  if (mailRescueBtn) mailRescueBtn.addEventListener('click', mailRescueClick);

  render();
  updateBadge();

  // v3.5.94：信件含图片 dataURL，可能只存在 IndexedDB → 启动补读（信箱打开时才渲染，届时读到）
  // v3.5.120：改为权威加载——每次启动都从 IDB 读 mail-letters，并合并暂存期间
  // （mailDbReady=false）用户写入的信件/已读标记（按 id 覆盖 + 按 tm 保序），
  // 就绪后重渲染。修复「刷新后信箱数据丢失」：旧逻辑只在 localStorage 空时补读一次，
  // 补读窗口内任何 save([]) 都会先覆盖 IDB，导致补读被跳过、信件永久丢失。
  // v3.6.x：① 合并基准扩展——原实现只在「IDB 有信件」时合并 mailPending，IDB 空时
  // 暂存被静默丢弃；改为：基准 = IDB 信件（备份导入语义），否则当前 localStorage，
  // 暂存按 id 覆盖合并后落盘。② 保险丝后 IDB 迟到返回时取并集，不覆盖已落盘信件。
  // v3.8.x：mailMergeFromIdb 增加显式 cid——原实现固定用动态 store（当前激活桌面），
  // contact-switched 的 idbGet 迟到返回时若用户已切到别的桌面，会把【旧桌面的信】
  // 合并写进【当前桌面】→ 串桌面（iOS Safari IDB 慢时信箱显示全是当前角色来信，
  // 分不清谁是谁）。cid 传入后读写/快照全部绑定该桌面；cid 不传（启动路径）保持
  // 原动态行为（启动无切换，动态 = 当前桌面，等价）。
  function mailMergeFromIdb(v, cid) {
    // FIX 2026-09-30 #1469：本会话已经权威落过一次整包 ⇒ 当前桌面这一趟合并整个跳过——本地这份就是答案。
    //   不跳的话：用户点完「清空所有信件」（主键写成 []），一趟在飞的库读回来会走到「主键空 → 兜底读
    //   快照」那一条，把刚清空的那 21 封从快照里带回来重新落库（#1442 尺子丁5「不许复活已删的信」）。
    //   与 #1330 给收藏定的「本会话用户在看得见的列表上写过即永不再补」同一条口径；跨会话（这一场没写过）
    //   不受影响，v3.5.120 的备份导入语义原样。
    if (mailClearedThisSession && !cid) return; // #1469o 只挡「本场亲手清空」那一型；写过非空整包照旧并库（#1417 的战果不许反过来弄没）
    try {
      const pending = mailPending || [];
      mailPending = null;
      let base = [];
      if (v && typeof v === 'string' && v.length > 2) {
        const idbArr = JSON.parse(v);
        if (Array.isArray(idbArr)) base = idbArr;
      }
      // #1469 配套：见函数开头——本会话已权威落过整包时当前桌面这一发直接不并（cur 会经
      //   「主键为空 → 兜底读快照」把用户刚清空的那些信带回来，只把 base 归零挡不住）。
      // v3.13.x：无论 IDB 是否有数据，始终把当前持久层（localStorage 主键/快照）合进并集——
      // 原实现仅在「权威已就绪 或 IDB 为空」时读 cur，IDB 非空且未就绪时直接跳过本地：
      // 在 vivo/OPPO/真我 Edge 等 IDB 写入失败或挂起的设备上，新信（周报小结/寄出的信/
      // 收到的信）只写进 localStorage+内存缓存没进 IDB，下次启动权威合并以【旧 IDB】为
      // 基准，新信被整体丢弃 → 弹窗提示「寄来了一份本周摸鱼小结」信箱里却看不到。
      // 与 feed.js feedMergeFromIdb 同口径：基准 = IDB，并集保留本地独有数据（按 id 覆盖，
      // 本地优先），不重演旧的「save([]) 覆盖 IDB」问题。
      let cur = [];
      try { cur = JSON.parse(csFor(cid).get(KEY) || '[]'); } catch (e) { cur = []; }
      if (!cur.length) { try { cur = loadSnap(cid); } catch (e) {} }
      // FIX 2026-09-30 #1469：基准之外还要带上「旁路账上那一份」——权威那一发可能来得比暂存写入还早
      //   （或上一场的暂存这一场才被 load 顺手灌上），只认内存 pending 会把那一封漏掉，而漏掉之后
      //   下面就把它销账＝两头落空。mergeLists 按 id 认身份、字段各取有值一方，重复带进来无害。
      const merged = mergeLists(mergeLists(base, cur), mergeLists(pending, mailHoldLoad(cid) || []));
      if (merged.length) { csFor(cid).set(KEY, JSON.stringify(merged)); try { mailHoldReconcile(cid, merged); } catch (e0) {} /* #1469h 库里那份合回来之后对账 */ writeSnap(merged, cid); }
    } catch (e) { /* 解析失败：仍置就绪，避免下次启动重复合并 */ }
  }
  // #1469d 开机先把上一场没落地的暂存灌回内存：load() 只要手上有暂存就一直并进屏上，
  //   库里那一份由权威回调（mailMergeFromIdb）／自救那一趟（mailRescueArm）并进来后再当场销账。
  try { mailPending = mailHoldLoad(); } catch (e0) {} // #1469d 开机先把上一场没落地的暂存灌回内存
  // 报障机上启动回填是流式排队（诊断件：chat-msgs 81MB、启动挂起名单非空），模块初始化这一刻旁路账
  // 多半还没进内存 ⇒ 只灌一次会扑空。回填完成那一发再灌一次并趁手重画这一屏；库里那一份随后由权威
  // 回调／自救那一趟并进来，两处都走 mailHoldReconcile 对账后才销账。
  document.addEventListener('mochi-restore-done', function () {
    try {
      if (mailLocalAuthored) return; // #1469p 本场已经权威落盘＝回填完成这一发不再回灌旁路账（清空之后不许复活）
      if (mailPending && mailPending.length) return;
      const h = mailHoldLoad();
      if (!h) return;
      mailPending = h;
      render();
      updateBadge();
    } catch (e1) {}
  });
  // 只挂监听不够：#785b 讲过空库／快恢复时 mochi-restore-done 在这些 defer 外置脚本求值之前就派发完了
  // （verify-data-loading-buffer B3/C2/D2 当年恒红就是这个根因）⇒ 走站内现成的两层口 mochiOnDataReady，
  // 已就绪那一型当场补灌一次；再兜一层：load() 自己发现「手上没有暂存而账上有一份」就灌。
  if (window.mochiOnDataReady) window.mochiOnDataReady(function () {
    try {
      if (mailLocalAuthored) return; // #1469p 同上一条：本场已权威落盘就不再回灌
      if (mailPending && mailPending.length) return;
      const h = mailHoldLoad();
      if (!h) return;
      mailPending = h;
      render();
      updateBadge();
    } catch (e2) {}
  });
  try {
    mailAuthAsk(undefined, null, function () {
      checkPendingReply(); // v3.9.x：权威就绪立即补查到期回信（启动即到的回信不再等 20~60s）
      render();
      updateBadge();
    });
  } catch (e) { mailAuthOk = true; mailDbReady = true; }
  // v3.6.x：权威读取保险丝——IndexedDB 打开/读取在个别手机（OPPO 雨见浏览器后台
  // 挂起/存储异常）可能迟迟不返回，mailDbReady 一直为 false，来信只进内存暂存：
  // 弹窗提示了「给你寄来了一封信」信箱却空白、刷新后信件丢失。15 秒后强制就绪并
  // 把暂存信件落盘（与 idbRestore 的 12s 保险同理；正常情况 idbGet 早已返回，
  // 该保险只在病理场景触发，mailDbReady 已真时直接跳过）
  // v3.26.x #1309b：保险丝放行前要先问 idbHasKey——「读不到值」而库里确有这一键时把读空的
  //   列表落盘＝整包抹掉旧信（＝本批报障本体）。探不到东西/证实没有才按旧语义放行。
  setTimeout(function () {
    if (mailWriteOpen()) return;
    mailFuseFlush(function () {
      try {
        const all = load();
        if (all.length) { store.set(KEY, JSON.stringify(all)); try { mailHoldReconcile(undefined, all); } catch (e0) {} } // #1469f 保险丝放行＝这一包已落盘，暂存销账
      } catch (e) {}
      mailAuthOk = true;
      mailDbReady = true;
      checkPendingReply(); // v3.9.x：保险丝就绪同样补查（权威加载挂起场景）
      render();
      updateBadge();
    });
  }, 15000);

  // v3.6.x：多桌面——切换联系人后重置信箱状态并重新从新桌面的 IDB 权威加载。
  // 若不重置，mailDbReady/mailPending 仍属旧桌面：load() 读的是新桌面持久层，
  // 但暂存信件（mailPending）会按 id 合并进来（串桌面）；权威已就绪标志也会
  // 让 save() 直接把新桌面数据写进 store（正确），但旧桌面暂存仍残留。
  document.addEventListener('contact-switched', function () {
    try {
      // v3.8.x：绑定本次切换的桌面 id——idbGet/保险丝都是异步的，回调执行时用户
      // 可能已切到别的桌面：原实现用动态 store（当前桌面）合并写回，旧桌面的
      // idbGet 迟到时把旧桌面的信写进新桌面 → 串桌面（iOS Safari 慢 IDB 实测：
      // 信箱在哪个角色页面就显示全部是这个角色来信，分不清谁是谁）。
      // 与启动权威加载（mailMergeFromIdb 调用前的 activePrefix 校验）同模式：
      // 回调先校验归属，已切走则作废——新桌面的切换监听会重新发起权威加载。
      const switchedCid = window.__activeCid || 'default';
      mailDbReady = false;
      mailAuthOk = false;
      mailAuthTries = 0; // #1309b：新桌面另给一份重试预算（与 mailPending 一样按桌面重置）
      mailBlindCleared = false; // #1469r 这一问的结论属于刚才那个桌面，换桌面重问
      mailPending = mailHoldLoad(switchedCid); // #1469e 换桌面＝换那本暂存账（账按联系人分键，不会串桌面）
      mailLibMerged = false; // #1417：合过的账按桌面重置——新桌面这一格是不是旧账要重新问一次
      // v3.7.x：补 15s 保险丝（与启动 line 798 同理）——切换联系人后 idbGet 在
      // 个别手机（华为/edge/OPPO 后台挂起）可能不返回，mailDbReady 永远 false →
      // 之后 save() 只暂存内存不落盘，新来信刷新即丢。chat.js 切换时调了
      // armReadyFuse()，mail 缺这步。到期强制就绪并把暂存信件落盘。
      // v3.8.x：保险丝绑定 switchedCid——已切走时作废（新桌面有自己的保险丝），
      // 避免旧桌面的保险丝误把新桌面的 mailDbReady 置真（新桌面权威加载还在飞）。
      let fuseFired = false;
      const fuse = setTimeout(function () {
        if (fuseFired || mailWriteOpen()) return;
        if ((window.__activeCid || 'default') !== switchedCid) return; // 已切走：本保险丝作废
        // #1309b：与启动保险丝同一条闸门——读不到值≠没有，库里确有这一键时不许把读空的列表落盘
        mailFuseFlush(function () {
          fuseFired = true;
          try {
            const all = load(switchedCid);
            if (all.length) { csFor(switchedCid).set(KEY, JSON.stringify(all)); try { mailHoldReconcile(switchedCid, all); } catch (e0) {} } // #1469f 保险丝放行那一发同样销账
          } catch (e) {}
          mailAuthOk = true;
          mailDbReady = true;
          checkPendingReply(); // v3.9.x：切桌面权威就绪补查（新桌面到期的回信立即落地）
          render();
          updateBadge();
        });
      }, 15000);
      // v3.26.x #1309b：权威加载走与启动同一条三态路（读失败＝关闸＋有界重试，不再当场开门）。
      // guard 保留原「保险丝已抢先／已切走则作废」两条语义：切走时新桌面自己的切换监听会重新发起。
      mailAuthAsk(switchedCid, function () {
        return !fuseFired && (window.__activeCid || 'default') === switchedCid;
      }, function () {
        clearTimeout(fuse);
        checkPendingReply(); // v3.9.x：切桌面权威就绪补查
        render();
        updateBadge();
      });
    } catch (e) { mailAuthOk = true; mailDbReady = true; }
  });
})();
