// ===== 功能：导出数据 / 导入数据 =====
// 导出：收集全部本地数据（localStorage + IndexedDB 音乐文件/字卡/查岗记录）打包为 JSON 下载
// 导入：读取备份 JSON，确认后覆盖恢复并刷新页面
// v3.5.24 修复手机端导入丢数据：
//  - 写 localStorage 前先按字节估算总大小，超出配额的大键（聊天图片/头像库等）自动删掉并计数，
//    保证昵称/设置/聊天文字记录等小键全部恢复成功（不再因超配额静默丢数据）
//  - 写入失败逐条回滚（还原被清掉的旧值），不会出现"清空后写一半"的情况
//  - IndexedDB 改为逐条顺序写入（不再用 Promise.all 一拥而上，手机内存压力大时容易失败）
//  - 兼容旧 iOS 的 <input type=file> 读取（File.text() 老版本不支持时改用 FileReader）
(function () {
  // 容量余量：给正在运行的其他功能留一点（手机 localStorage 约 5MB，桌面 10MB）
  const LS_HEADROOM = 512 * 1024;
  // v3.7.0 引入、v3.29.x 下线：自动备份副本键。原设计是每次手动导出时把整包 JSON 再复制
  // 一份进 IndexedDB，供「数据几乎全空」时启动弹窗恢复。现已彻底不再写入，本常量只剩两个用途：
  //  ① 导出时排除该键（防自包含无限增长）；② 启动时清理旧版本遗留的那份副本（purgeLegacySnapshot）。
  const SNAPSHOT_KEY = 'xy-home-v2:__auto-backup-snapshot';

  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2600);
  }

  // v3.5.113：导入进度缓冲——读取/解析大备份（上百 MB）与逐条写入都需要时间，
  // 用全屏遮罩 + 进度条明确显示进度，避免用户以为卡死/没反应。
  function impEl() {
    let el = document.getElementById('cc-import-progress');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cc-import-progress';
      el.className = 'cc-import-progress';
      el.innerHTML = '<div class="cc-ip-box">' +
        '<div class="cc-ip-title" id="cc-ip-title">正在导入…</div>' +
        '<div class="cc-ip-bar"><div class="cc-ip-fill" id="cc-ip-fill"></div></div>' +
        '<div class="cc-ip-sub" id="cc-ip-sub"></div></div>';
      document.body.appendChild(el);
    }
    return el;
  }
  function impShow(title, sub, pct) {
    const el = impEl();
    el.hidden = false;
    const t = document.getElementById('cc-ip-title');
    const s = document.getElementById('cc-ip-sub');
    const f = document.getElementById('cc-ip-fill');
    if (t) t.textContent = title;
    if (s) s.textContent = sub || '';
    if (f) f.style.width = (pct == null ? '' : Math.max(0, Math.min(100, pct)) + '%');
  }
  function impHide() {
    const el = document.getElementById('cc-import-progress');
    if (el) el.hidden = true;
  }

  // 估算字符串体积（UTF-8 字节，用于配额判断）
  function byteLen(s) {
    if (s == null) return 0;
    if (typeof s !== 'string') s = JSON.stringify(s);
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0xD800 || c > 0xDFFF ? 3 : 4;
    }
    return n;
  }

  // v3.9.x：本地时间格式化——toISOString() 是 UTC，直接 slice 显示会比本地时区早/晚数小时
  //（中国 UTC+8 显示时间早 8 小时），用户反馈"导入时显示的时间不对"。
  // 统一用此函数把 ISO 字符串转成本地时间 "YYYY-MM-DD HH:MM" 显示。
  function fmtLocalTime(iso) {
    if (!iso) return '未知';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '未知';
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  // 本地日期字符串（用于导出文件名，凌晨导出不会变成前一天日期）
  function localDateStr(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // 兼容旧 iOS：读取文件文本（File.text() 不支持时退回 FileReader）
  function readFileText(file) {
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

  // v3.31.x：Blob → base64 分块转换——旧实现把整块二进制先拼成一个巨大的二进制字符串再
  // 一次性 btoa（大音乐/图片文件上临时内存 ≈ 文件体积 × 2），且 String.fromCharCode.apply
  // 一次传 0x8000 个参数在部分安卓 Chrome 上有栈溢出/崩溃风险（OPPO Find X9 导出闪退嫌疑点之一）。
  // 改为按「3 的倍数」字节数分块 btoa：每块字节数是 3 的倍数 → 分块 base64 拼接即完整 base64，
  // 全程只有小临时串，无大拷贝。
  function blobToBase64(blob) {
    return blob.arrayBuffer().then((buf) => {
      const bytes = new Uint8Array(buf);
      const CHUNK = 3 * 5120; // 15360 字节，3 的倍数
      let out = '';
      for (let i = 0; i < bytes.length; i += CHUNK) {
        const end = Math.min(i + CHUNK, bytes.length);
        let bin = '';
        for (let j = i; j < end; j++) bin += String.fromCharCode(bytes[j]);
        out += btoa(bin);
      }
      return out;
    });
  }

  // ===== 导出打包器（内存有界流式）=====
  // v3.31.x #103 的做法是「先把全部数据收进 data，再逐键 stringify」。在数据量更大的设备
  //（vivo X200s Edge 实测：IDB 候选键合计≈807MB、chat-msgs 单键 514MB、存储配额已用 971MB）
  // 上仍然撞墙，三道墙叠在一起才有「一直显示正在打包数据文件」：
  //  ① 整包 stringify（线上旧版）：JS 单个字符串长度有上限（V8 64 位 kMaxLength≈5.37 亿字符，
  //     且要一次性连续分配），整包 JSON 正好跨过去 → RangeError: Invalid string length。
  //  ② 先收集后打包：800MB 全部进内存才开始序列化，峰值＝全量对象图。
  //  ③ 逐键 stringify（#103）：单个大键仍要一次分配几亿字符的字符串；而且路由用的
  //     byteLen(非字符串) 内部又整包 stringify 一遍只为量长度＝再复制一份。
  // 现在：readNext() 拉一个键 → 就地序列化 → 立即释放（任何时刻内存里最多一个大键）；
  // 值内部再逐元素下钻 + 长字符串分片转义，全程「整包字符串」与「单键整串」都不存在。
  // 产出的 JSON 与 JSON.stringify(data) 逐字节同构（成员顺序＝处理顺序，JSON 不依赖顺序）。
  const PACK_MERGE = 4 * 1024 * 1024;   // 每 ~4MB 合并一次进 Blob（Blob 拼接是引用合并、不复制内存）
  const PACK_SLICE = 1 * 1024 * 1024;   // 超长字符串一次转义的分片长度（分片转义拼接＝整体转义）
  const PACK_DEPTH = 3;                 // 容器下钻层数：值→元素→子元素；再深才整包 stringify
  const PACK_YIELD = 64;                // 每写这么多个片段让出一次主线程（防空屏假死/ANR）

  function createJsonPack() {
    const parts = [];
    let len = 0, since = 0, blob = null;
    const flush = () => {
      if (!parts.length) return;
      blob = new Blob(blob ? [blob].concat(parts) : parts, { type: 'application/json;charset=utf-8' });
      parts.length = 0;
      len = 0;
    };
    return {
      push(s) { if (!s) return; parts.push(s); len += s.length; if (len >= PACK_MERGE) flush(); },
      // 只在「两个完整值之间」让出主线程，绝不打断一个值的写出，所以不存在半截 JSON。
      tick() {
        if (++since < PACK_YIELD) return Promise.resolve();
        since = 0;
        return new Promise((r) => setTimeout(r, 0));
      },
      finish() { flush(); return blob || new Blob([], { type: 'application/json;charset=utf-8' }); }
    };
  }

  // 字符串 → JSON 字符串字面量。超过 PACK_SLICE 的（大 base64 图片/整段 JSON 文本）分片转义：
  // 每片单独 JSON.stringify 后掐掉首尾引号再拼接，转义是逐字符的所以结果与整体转义等价。
  function packString(pack, s) {
    if (s.length <= PACK_SLICE) { pack.push(JSON.stringify(s)); return; }
    pack.push('"');
    let i = 0;
    while (i < s.length) {
      let end = Math.min(i + PACK_SLICE, s.length);
      // 切片边界不能把代理对（emoji 等 4 字节字符）劈开
      if (end < s.length && s.charCodeAt(end - 1) >= 0xD800 && s.charCodeAt(end - 1) <= 0xDBFF) end--;
      if (end <= i) end = i + 1;
      pack.push(JSON.stringify(s.slice(i, end)).slice(1, -1));
      i = end;
    }
    pack.push('"');
  }

  // 只下钻「普通对象」：Date/Map 等宿主对象交给 JSON.stringify（toJSON 语义一致），
  // 否则会把它当成零属性的对象写成 {} 把时间戳等值直接抹掉。
  function isPlainObject(v) {
    const p = Object.getPrototypeOf(v);
    return p === Object.prototype || p === null;
  }

  async function packValue(pack, v, depth, cfg, stat) {
    if (v === null || v === undefined) { pack.push('null'); return; }
    const t = typeof v;
    if (t === 'string') {
      // 精简模式：图片/语音/音乐等 base64 附件不进备份文件（只留文字），置空串保持字段类型不变，
      // 读取方 `if (m.img)` 判空即自然跳过，不需要导入侧配合改任何代码。
      if (cfg.strip && v.length > 1024 && /^data:[^,]*;base64,/i.test(v.slice(0, 64))) {
        stat.stripCnt++; stat.stripChars += v.length;
        pack.push('""');
        return;
      }
      packString(pack, v);
      return;
    }
    if (t === 'number') { pack.push(isFinite(v) ? String(v) : 'null'); return; }
    if (t === 'boolean') { pack.push(v ? 'true' : 'false'); return; }
    // 下钻到 PACK_DEPTH 层（够覆盖 消息数组→消息对象→parts 数组 与 字卡组→卡数组→卡对象），
    // 单值 stringify 的体积因此被限制在「一张卡」量级，而不是「整个库」。
    if (depth < PACK_DEPTH) {
      if (Array.isArray(v)) {
        pack.push('[');
        for (let i = 0; i < v.length; i++) {
          if (i) pack.push(',');
          await packValue(pack, v[i], depth + 1, cfg, stat);
          if (stat.own) v[i] = null; // 值来自 IDB 读取（本次导出的私有副本）→ 序列化完即释放
          if (depth === 0) await pack.tick();
        }
        pack.push(']');
        return;
      }
      if (t === 'object' && isPlainObject(v)) {
        const keys = Object.keys(v);
        pack.push('{');
        let wrote = false;
        for (let i = 0; i < keys.length; i++) {
          const child = v[keys[i]];
          // 与 JSON.stringify 一致：undefined / 函数属性直接省略（写成 null 会让导入侧多出键）
          if (child === undefined || typeof child === 'function') continue;
          if (wrote) pack.push(',');
          wrote = true;
          pack.push(JSON.stringify(keys[i]) + ':');
          await packValue(pack, child, depth + 1, cfg, stat);
          if (stat.own) { try { delete v[keys[i]]; } catch (e) {} }
          if (depth === 0) await pack.tick();
        }
        pack.push('}');
        return;
      }
    }
    const whole = JSON.stringify(v);
    pack.push(whole === undefined ? 'null' : whole);
  }

  // 键是否「只算体积也算不出小」的廉价判定：非字符串值一旦累计超过 limit 立即返回，
  // 不再像旧 byteLen 那样整包 stringify 只为量一个长度（那等于又复制一份大键）。
  function overSmallLimit(v, limit) {
    try {
      if (typeof v === 'string') return v.length > limit;
      if (v instanceof Blob) return v.size > limit;
      if (Array.isArray(v)) {
        let n = 0;
        for (let i = 0; i < v.length; i++) {
          const m = v[i];
          if (typeof m === 'string') n += m.length;
          else if (m && typeof m === 'object') {
            if (typeof m.text === 'string') n += m.text.length;
            if (typeof m.img === 'string') n += m.img.length;
            if (typeof m.voice === 'string') n += m.voice.length;
            const ps = m.parts;
            if (Array.isArray(ps)) for (let j = 0; j < ps.length; j++) { const p = ps[j]; if (p && typeof p.v === 'string') n += p.v.length; }
            n += 64;
          } else n += 32;
          if (n > limit) return true;
        }
        return false;
      }
      if (v && typeof v === 'object') {
        // 普通对象同理：逐键浅估累计，一过阈值立刻返回——绝不能为「判断大不大」去 stringify 大对象
        const ks = Object.keys(v);
        let n = 0;
        for (let i = 0; i < ks.length; i++) {
          const m = v[ks[i]];
          if (typeof m === 'string') n += m.length;
          else if (m && typeof m === 'object') n += 2048;
          else n += 32;
          n += ks[i].length;
          if (n > limit) return true;
        }
        return false;
      }
      return false;
    } catch (e) { return true; }
  }

  // 流式打包总入口：meta（导出时间等）→ readNext() 逐个吐大键 [key, value] → 最后吐 small
  // （localStorage 小键 + IDB 里体积 ≤20KB 的键，与旧实现同一路由：小键进 ls 段、大键进 idb 段）。
  // readNext 返回 null 表示大键结束。
  async function jsonToBlobStreaming(meta, readNext, small) {
    const pack = createJsonPack();
    const cfg = meta.cfg;
    const stat = { own: false, stripCnt: 0, stripChars: 0 };
    let first = true;
    let chunk = '{"version":"1.0","app":"mochi-zika","exportTime":' + JSON.stringify(meta.exportTime) + ',"idb":{';
    while (true) {
      const ent = await readNext();
      if (!ent) break;
      chunk += (first ? '' : ',') + JSON.stringify(ent.k) + ':';
      first = false;
      pack.push(chunk);
      chunk = '';
      stat.own = ent.own === true;
      await packValue(pack, ent.v, 0, cfg, stat);
      await pack.tick();
    }
    pack.push(chunk + '},"ls":{');
    const sKeys = Object.keys(small);
    for (let i = 0; i < sKeys.length; i++) {
      if (i) pack.push(',');
      stat.own = false; // 小键值是 localStorage 原串/别处共用的值，一律不动源
      pack.push(JSON.stringify(sKeys[i]) + ':');
      await packValue(pack, small[sKeys[i]], 1, cfg, stat);
    }
    pack.push('}}');
    pack.stat = stat;
    return pack;
  }

  // ===== 导出 =====
  // v3.5.97：不受任何大小限制——按 IndexedDB / localStorage 实际数据全量导出。
  //   音乐文件、图片、聊天记录全部包含；导入时大键进 IndexedDB、小键进 localStorage，完整还原。
  const LS_SMALL_LIMIT = 20 * 1024;        // ≤ 此体积的键进备份的 ls 段（localStorage），其余进 idb 段
  const MODE_IMPORT_WARN = 120 * 1024 * 1024; // 成品文件超过这个体积就如实提示「新设备可能导不回」
  const MUSIC_KEY_RE = /:music-file:/;      // 本地上传音乐的文件体：最占体积、且新设备上可重新添加
  // FIX 2026-09-10 #275 媒体池条目键（xy-home-v2:media:<hash32>，值为 dataURL 字符串）。
  // 「只备份文字」strip 导出只剥 data: 前缀的载荷，消息里的 @@m: 令牌不匹配被原样保留，
  // 池键值却被剥成空串——导入后＝令牌全体失配的永久坏图，且空串条目随今后每次完整备份
  // 继续传播给对方设备（多机型反复「图片丢失」的真相）。文字模式必须整键跳过，绝不剥值留键。
  const MEDIA_POOL_KEY_RE = /^xy-home-v2:media:[0-9a-f]{32}$/;
  // v3.3x.x：聊天记录消息键——全局 xy-home-v2:chat-msgs + 各桌面 xy-home-v2:<cid>:chat-msgs。
  // 「仅聊天记录」导出只收这两种键（LS 小键 + IDB 权威值，含最新消息与图片/语音），
  // 其余设置/字卡/音乐全部跳过，体积最小、用来快速保住最不可再生的聊天记录。
  // v3.36.x #582：锚点收严为「行首或冒号紧跟 chat-msgs」——旧的 /:?chat-msgs$/ 靠子串命中，
  // 顺带把 group-chat-msgs 也吞进来（群聊靠下面的 GROUP_CHAT_KEY_RE 显式收，语义不变、不再靠巧合）。
  const CHAT_KEY_RE = /(?:^|:)chat-msgs$/;
  // v3.36.x #582：群聊消息键（全局键，不随联系人桌面切换）——默认群 xy-home-v2:group-chat-msgs、
  // 自定义群 xy-home-v2:gc-msgs-<gid>（键名见 group-chat.js groupMsgKey）。群聊记录同属「聊天记录」，
  // 导出与导入必须成对带上：只导不导回＝恢复后群聊全空，只导不入文件＝清库/换机后群聊记录直接蒸发。
  const GROUP_CHAT_KEY_RE = /^xy-home-v2:(?:group-chat-msgs|gc-msgs-.+)$/;
  function isChatMsgKey(k) { return CHAT_KEY_RE.test(k) || GROUP_CHAT_KEY_RE.test(k); }
  // v3.36.x #582：权威键＝IndexedDB 是完整权威值、localStorage 只是「有损小快照」（chat.js 的
  // ≤2MB 副本会剥图/截断，也可能干脆没写）。导出与体积预估都必须取 IDB 值——绝不能因为「LS 里
  // 已经收了这个小键」就把 IDB 值跳过（旧预估正是这么做的，实测把整个聊天记录的体积算成 0）。
  function isAuthorityKey(k) { return /:chat-msgs$/.test(k) || GROUP_CHAT_KEY_RE.test(k) || /:feed-posts$/.test(k); }
  // v3.36.x #582：#142 媒体池令牌化后，聊天里的图片/语音本体存在池键 xy-home-v2:media:<hash32>，
  // 消息体只留 @@m:<hash> 引用。「仅聊天记录」必须把消息实际引用到的池条目一并打包——否则备份在
  // 原设备上看不出问题（池还在），换机/清库恢复后图片语音全空（令牌失配），而用户以为「聊天都备了」。
  const MEDIA_TOKEN_RE = /@@m:([0-9a-f]{32})/g;
  // v3.36.x #582：字符串的 UTF-8 字节数粗估——导出文件是 UTF-8 的 Blob（JSON.stringify 不转义非
  // ASCII），中文一字 3 字节；而「本机数据 / 查看存储」是存储口径（字符×2＝UTF-16）。原来拿字符数
  // 当字节数，中文为主的库预估文件体积被压小（实测混排库 1.19 字节/字符、纯中文库可到 3），
  // 「文件约为本机数据的一半」在纯文字库上直接说反。逐字符全扫在几百 MB 库上代价太高，取前 512
  // 字符量「非 ASCII 占比」后线性外推（纯 ASCII 恒等于字符数，零偏差；emoji 略高估，可接受）。
  const UTF8_SAMPLE = 512;
  // esc=true：该值还会被 JSON.stringify 再转义一次（原始字符串值——本应用大量键存的是「JSON 字符串」
  // （字卡库 / 收藏 / 聊天记录），里面的引号与反斜杠进文件时各变 2 字节，实测能占文件两三成；
  // 已经是 JSON.stringify 结果的输入传 false，否则会把已转义的引号重复计一遍）。
  function estUtf8Bytes(s, esc) {
    const str = String(s == null ? '' : s);
    const n = str.length;
    if (!n) return 0;
    const m = n < UTF8_SAMPLE ? n : UTF8_SAMPLE;
    let extra = 0, quoted = 0; // extra＝相对「1 字节/字符」多出的字节；quoted＝转义后会多 1 字节的字符数
    for (let i = 0; i < m; i++) {
      const c = str.charCodeAt(i);
      if (c > 127) extra += c > 2047 ? 2 : 1;
      else if (esc && (c === 34 || c === 92 || c < 32)) quoted++;
    }
    return Math.round(n * (1 + extra / m + (esc ? quoted / m : 0)));
  }
  // 从聊天值（消息数组或 JSON 字符串）里收集它引用到的媒体池 hash（导出打包与体积预估共用）。
  // 只认 @@m: 令牌字面量，不解 dataURL、不整包 stringify——大 chat-msgs 可能是几 MB 的数组，
  // 为扫令牌再 stringify 一份，等于把流式打包好不容易避开的峰值内存又加回来。
  function collectMediaHashes(v, out) {
    const scan = (s) => {
      if (typeof s !== 'string' || s.indexOf('@@m:') < 0) return;
      MEDIA_TOKEN_RE.lastIndex = 0;
      let m;
      while ((m = MEDIA_TOKEN_RE.exec(s))) out.add(m[1]);
    };
    try {
      if (typeof v === 'string') { scan(v); return; }
      if (!Array.isArray(v)) return;
      for (let i = 0; i < v.length; i++) {
        const m = v[i];
        if (!m || typeof m !== 'object') continue;
        scan(m.text); scan(m.img); scan(m.voice);
        if (m.quote && typeof m.quote === 'object') {
          scan(m.quote.t);
          if (Array.isArray(m.quote.imgs)) for (let j = 0; j < m.quote.imgs.length; j++) scan(m.quote.imgs[j]);
        }
        if (Array.isArray(m.parts)) for (let j = 0; j < m.parts.length; j++) { const p = m.parts[j]; if (p && typeof p === 'object') scan(p.v); }
      }
    } catch (e) {}
  }

  function exportCfg(mode) {
    if (mode === 'no-music') return { mode: mode, label: '不含音乐文件', note: '不含本地音乐文件', skip: (k) => MUSIC_KEY_RE.test(k), strip: false };
    // #275：文字模式媒体池整键跳过（skip 在读值前生效）——strip 只会剥值，键若留下就是空池
    if (mode === 'text') return { mode: mode, label: '只备份文字', note: '不含图片/语音/音乐附件', skip: (k) => MUSIC_KEY_RE.test(k) || MEDIA_POOL_KEY_RE.test(k), strip: true };
    // #582：聊天模式＝各桌面（含旧顶层键）+ 群聊消息键；消息引用到的媒体池条目在打包阶段追加（mediaRefs）
    if (mode === 'chat') return { mode: mode, label: '仅聊天记录', note: '只含各桌面聊天与群聊记录', skip: (k) => !isChatMsgKey(k), strip: false, mediaRefs: true };
    return { mode: 'full', label: '完整备份', note: '全部数据完整', skip: () => false, strip: false };
  }

  // 导出进度追踪：出错时要能说出「卡在哪一步、哪个键、那个键多大」，
  // 只报「导出失败」用户无从下手（vivo X200s 这次就是遮罩冻在「正在打包数据文件」）。
  let expStage = '';
  let expKey = '';
  let expKeyBytes = 0;

  async function doExport(mode) {
    const cfg = exportCfg(mode);
    try {
      await runExport(cfg);
    } catch (e) {
      // v3.32.x #104：异常必须收住并收起遮罩。旧实现入口是裸调用 doExport()，
      // 打包阶段抛出的 RangeError 变成未处理 promise rejection → impHide 永不执行
      // → 界面永远停在「正在打包数据文件」（用户报的「一直在打包中」）。
      impHide();
      reportExportError(e, cfg);
    }
  }

  function reportExportError(e, cfg) {
    const msg = (e && (e.message || String(e))) || '未知错误';
    const isLen = /string length/i.test(msg);
    const at = (expStage ? '\n出错环节：' + expStage : '') +
      (expKey ? '\n涉及数据：' + expKey + (expKeyBytes ? '（约 ' + fmtSize(expKeyBytes) + '）' : '') : '');
    const advice = isLen
      ? '\n根因：这台设备的数据量已超出浏览器一次能生成的字符串上限，单个文件的完整备份做不到。\n' +
        '请重新点「导出数据」改选「不含音乐文件」或「只备份文字」；确实要一份全量备份，' +
        '先用「查看存储」清掉不再需要的音乐/图片附件后再导。'
      : '\n请重新点「导出数据」再试一次；反复失败时先重启浏览器（释放被占满的内存）再导，' +
        '或改选范围更小的备份。';
    if (window.openModal) {
      window.openModal('导出未完成', '', function () {}, {
        noInput: true, okText: '知道了', big: true,
        staticText: '「' + cfg.label + '」中途失败。本机数据没有任何改动（导出不写不删业务键），已生成的临时文件会自动释放。\n' +
          '原因：' + msg + at + advice
      });
    } else {
      toast('导出未完成：' + msg);
    }
  }

  // 大库设备先让用户在知情前提下选备份范围（小库直接完整导出，不多点一下）。
  // 为什么需要这一步：备份文件再大也导得出去，但导入侧要把整个文件一次读成字符串再解析，
  // 几百 MB 的文件在新设备上大概率导不回来——不如在导出前就把选择权交出来。
  // #497 导出前实测本机体积：旧弹窗的「本机数据约 X」用的是 navigator.storage.estimate()
  // ——那是整个 origin 的占用（同账号 Pages 各项目共用配额，含其他站点与缓存），既不是
  // 本项目真实体积也没有配额占比，更没有各模式导出文件的预估（用户报「导出前看不到全部
  // 数据多大、导出的文件多大」）。measureProject 按导出同一路径实测（只读不写）：
  //   projStorage＝存储占用（字符×2，与「查看存储」同口径）；projFile＝导出文件近似体积
  //   （v3.36.x #582 起按 UTF-8 字节估：base64 附件 1 字符≈1 字节、中文 3 字节，不再拿字符数当字节数，
  //   详见 estUtf8Bytes）；musicFile＝其中本地音乐部分（「不含音乐文件」的预估减项）。
  // 大键双写（LS 旧快照 + IDB 权威值）按导出实际取值路径去重：>LS_SMALL_LIMIT 的键只算 IDB。
  // IDB 清单读不到时返回 ok=false（调用方回退整域口径，行为与旧版一致）。
  function measureProject() {
    return new Promise((resolve) => {
      impShow('正在准备导出…', '正在统计本机数据体积…', 8);
      const lsChars = {};   // 键 → 存储口径字符数（×2＝UTF-16 字节）
      const lsFile = {};    // 键 → 文件口径字节数（UTF-8），去重减项要用同一口径
      let projFile = 0, projStorage = 0, musicFile = 0;
      // v3.36.x #582：「仅聊天记录」预估——消息键本体 + 消息引用到的媒体池条目（@@m: 令牌
      // 指向的池键）。池条目体积单独记在 poolSize 里，等把全部键扫完、引用集合齐了再累加
      //（否则引用先出现、池键后出现时会漏算）。
      let chatFile = 0;
      const poolSize = {};
      const mediaRefs = new Set();
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || k.indexOf('xy-home-v2:') !== 0 || k === SNAPSHOT_KEY) continue;
          const v = localStorage.getItem(k) || '';
          const c = k.length + v.length;
          // lsFile 只记「值」的文件字节，键名单独算（它与存储口径都要各算一次，见下方 IDB 循环）
          const fbVal = estUtf8Bytes(v, true);
          lsChars[k] = v.length;
          lsFile[k] = fbVal;
          projFile += k.length + fbVal; projStorage += c * 2;
          if (isChatMsgKey(k)) { chatFile += k.length + fbVal; collectMediaHashes(v, mediaRefs); }
        }
      } catch (e) {}
      const finish = (ok) => {
        if (ok) {
          mediaRefs.forEach(function (h) {
            const s = poolSize['xy-home-v2:media:' + h];
            if (s) chatFile += s;
          });
        }
        resolve({ ok: ok, projFile: projFile, projStorage: projStorage, musicFile: musicFile, chatFile: chatFile });
      };
      const listFn = window.idbListKeys;
      if (!listFn || !window.idbGetMany) { finish(false); return; }
      Promise.resolve(listFn()).then(function (keys) {
        if (!keys) { finish(false); return; }
        const list = keys.filter(function (k) {
          const s = String(k || '');
          return s.indexOf('xy-home-v2:') === 0 && s !== SNAPSHOT_KEY;
        });
        const BATCH = 80;
        let pos = 0;
        const step = function () {
          if (pos >= list.length) { finish(true); return; }
          const batch = list.slice(pos, pos + BATCH);
          pos += batch.length;
          window.idbGetMany(batch).then(function (map) {
            batch.forEach(function (k) {
              const v = map[k];
              // c＝存储口径字符数（×2＝UTF-16 字节）；fb＝文件口径字节数（UTF-8）；blob＝二进制原始字节
              let c = 0, fb = 0, blob = 0;
              try {
                if (typeof v === 'string') { c = v.length; fb = estUtf8Bytes(v, true); }
                else if (typeof Blob !== 'undefined' && v instanceof Blob) { blob = v.size; fb = Math.round(blob * 4 / 3); }
                else if (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer) { blob = v.byteLength; fb = Math.round(blob * 4 / 3); }
                else if (v !== undefined && v !== null) { const js = JSON.stringify(v); c = js.length; fb = estUtf8Bytes(js); }
              } catch (e) { c = 0; fb = 0; }
              const isMusic = MUSIC_KEY_RE.test(String(k));
              const lsC = lsChars[k];
              const isChat = isChatMsgKey(String(k));
              const keyBytes = String(k).length; // 键名也要进文件（JSON 里每个键都带名字），且只算一次
              const auth = isAuthorityKey(String(k));
              // 小键已按 LS 计过（键名＋值都在），IDB 同值不重复计——但权威键（chat-msgs/群聊/
              // feed-posts）不适用：LS 那份是有损小快照，导出实际取的是更大的 IDB 权威值
              if (lsC !== undefined && lsC <= LS_SMALL_LIMIT && !auth) { c = 0; fb = 0; blob = 0; }
              // 大键（含权威键）以 IDB 权威值为准（同导出路径）：把 LS 侧多计的「键名＋值」按各自口径扣掉
              else if (lsC !== undefined) {
                projFile -= keyBytes + (lsFile[k] || 0);
                projStorage -= (keyBytes + lsC) * 2;
                if (isChat) chatFile -= keyBytes + (lsFile[k] || 0);
              } else {
                projFile += keyBytes;             // LS 里没有这个键 → 键名只由这里计一次
                if (isChat) chatFile += keyBytes;
              }
              projFile += fb;
              projStorage += c * 2 + blob;
              if (isMusic) musicFile += fb;
              if (isChat) { chatFile += fb; collectMediaHashes(v, mediaRefs); }
              if (MEDIA_POOL_KEY_RE.test(String(k))) poolSize[String(k)] = fb + (lsC === undefined ? keyBytes : 0);
            });
            impShow('正在准备导出…', '正在统计本机数据体积 ' + pos + '/' + list.length, Math.round(pos / Math.max(1, list.length) * 40));
            setTimeout(step, 0);
          }).catch(function () { setTimeout(step, 0); });
        };
        step();
      }).catch(function () { finish(false); });
    });
  }
  function askExportMode() {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (m) => { if (settled) return; settled = true; resolve(m); };
      const ask = (info, usage) => {
        impHide();
        // 阈值口径：有实测按「导出文件近似体积」判；实测失败回退整域 usage（=旧行为）。
        // v3.36.x #582：这里不再拿它决定「弹不弹」——原来只有 >150MB 才弹范围选择，小库用户
        // 直接走完整备份，「仅聊天记录」等于不存在（用户反馈「导出数据缺少可选」）。现在每次
        // 导出都让用户选一次范围，bigRef 只用来在标题里报个体积。
        const bigRef = info ? info.projFile : usage;
        if (!window.openModal) { finish('full'); return; }
        // 口径说明（#582 用户反馈「没说明为什么本机内存是导出数据的 2 倍」）：两个数不是同一把尺子——
        // 本机数据＝浏览器存储占用（每字符 2 字节，UTF-16，与「查看存储」同口径）；预估文件＝文件里的
        // 实际字节（UTF-8：图片/语音的 base64 约 1 字符 1 字节、汉字 3 字节）。所以附件为主的库文件
        // 约为本机数据的一半，纯文字（中文）为主的库两者接近、文件甚至更大。
        const head = info
          ? ('本机数据约 ' + fmtSize(info.projStorage) +
            (info.quota ? '（占配额 ' + Math.max(0.1, Math.round(info.projStorage / info.quota * 1000) / 10) + '%）' : '') +
            '；预估文件：完整 ' + fmtSize(info.projFile) +
            '、不含音乐 ' + fmtSize(Math.max(0, info.projFile - info.musicFile)) +
            '、仅聊天记录 ' + fmtSize(info.chatFile || 0) + '、只备份文字更小。\n' +
            '两个数口径不同：本机数据按存储占用算（1 字符 2 字节），文件按实际字节算（图片/语音的 base64 约 1 字符 1 字节、汉字 3 字节）——所以附件多时文件约为本机数据的一半，中文文字多时两者接近、文件甚至更大。\n')
          : ('本机数据约 ' + fmtSize(usage) + '（整域名占用口径，含同域其他站点，仅供参考）。\n');
        window.openModal('选择导出范围', '', function (v) {
          finish(v || 'full');
        }, {
          noInput: true, okText: '开始导出', pill: 'full', lock: true, big: true,
          pills: [{ label: '完整备份', value: 'full' }, { label: '不含音乐文件', value: 'no-music' },
            { label: '只备份文字', value: 'text' }, { label: '仅聊天记录', value: 'chat' },
            { label: '取消', value: 'cancel' }],
          // #582：文案刻意压到一档一行 + 宽版弹窗（big）——390×844 手机上 272px 窄弹窗装不下这些
          // 说明，会把胶囊与「开始导出」顶到折线以下（旧版实测 scrollHeight 1113 vs 可视 657）。
          staticText: head +
            '完整备份：全部数据（含音乐/图片/语音），文件最大，超过约 ' + fmtSize(MODE_IMPORT_WARN) + ' 时新设备可能导不回来。\n' +
            '不含音乐：跳过本地上传的歌曲；只备份文字：再跳过图片语音——两者其余数据都完整。\n' +
            '仅聊天记录：只要聊天——各桌面联系人（含默认桌面）与群聊的记录，消息引用的图片语音一并带走；设置/字卡/朋友圈/音乐不进文件。' +
            (info ? '（体积为实测估算，以完成提示为准）' : '')
        });
      };
      // 整域口径（兜底 + 配额占比来源）与实测并行取，estReady 完成后再出弹窗
      let estUsage = 0, estQuota = 0;
      const estReady = new Promise((done) => {
        try {
          if (navigator.storage && navigator.storage.estimate) {
            navigator.storage.estimate().then((est) => {
              estUsage = (est && est.usage) || 0;
              estQuota = (est && est.quota) || 0;
              done();
            }, () => done());
            return;
          }
        } catch (e) {}
        done();
      });
      measureProject().then((m) => {
        return estReady.then(() => {
          // #582：chatFile 必须一起传过去——漏传时「仅聊天记录 ≈ X」恒显示 0 KB（本批自己踩过）
          ask((m && m.ok) ? { projFile: m.projFile, projStorage: m.projStorage, musicFile: m.musicFile, chatFile: m.chatFile, quota: estQuota } : null, estUsage);
        });
      }).catch(() => { ask(null, estUsage); });
    });
  }

  async function runExport(cfg) {
    // v3.xx：导出进度遮罩——大备份（音乐/语音/图片全量）读取+打包要花时间，
    // 不能只弹一个 toast 让用户干等。复用 import 的进度遮罩，结束再隐藏。
    expStage = '读取本地数据';
    expKey = '';
    expKeyBytes = 0;
    impShow('正在导出…', '正在读取全部数据', 3);
    const exportTime = new Date().toISOString();
    // 备份文件 ls 段：localStorage 小键 + IndexedDB 里体积 ≤20KB 的键（与旧实现 add() 同路由）
    const small = {};
    const cover = exportCoverage();
    // v3.27.x：修复「导出的聊天记录不是最新」——原实现先从 localStorage 把所有大键收进 data.idb，
    // 下面 IndexedDB 循环再用 `k in data.idb` 跳过，导致聊天记录永远取 localStorage 的「有损快照」
    //（chat.js 的 LS 快照超过 2MB 上限后不再更新、会冻结在旧时刻，且剥图/截断长文本），
    // IndexedDB 里的权威全量版（含图片/语音、最新消息）从未被导出。改为：
    //  ① LS 只收录小键（≤20KB，LS 是最新同步快照）；大键记入 lsBig 作兜底，不提前占位 data.idb；
    //  ② 大键一律从 IndexedDB 读权威值（双写键以 IDB 为准）；IDB 读失败/无此键再回落 LS 兜底。
    const lsBig = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf('xy-home-v2:') !== 0) continue;
        if (k === SNAPSHOT_KEY) continue; // v3.7.0：副本键不进导出文件（防自包含无限增长）
        if (cfg.skip(k)) continue; // #275 范围外键（文字模式的媒体池等）同样不进小键段，防 strip 剥成空串入库
        const v = localStorage.getItem(k);
        if (byteLen(v) > LS_SMALL_LIMIT) lsBig[k] = v; // 大键：留待 IndexedDB 权威读取
        else { small[k] = v; cover.see(k, v); }
      }
    } catch (e) {}
    // IndexedDB：音乐文件、字卡、聊天记录等全部权威数据
    // v3.9.x：修复"无法导出当前的所有数据"——原实现整个 for 循环包在一个 try-catch 里，
    // 某个键的 idbGet/arrayBuffer/btoa 抛错会终止整个循环，后续键全部丢失（导出文件缺数据）。
    // 改为每个键单独 try-catch：一个键失败只跳过该键，不影响其余键导出。
    // v3.26.x：权威键（chat-msgs/feed-posts）LS 是有损快照（剥图/截断或大键不进 LS），
    // IDB 才是完整权威值。这类键即使 LS 小键已收录也必须读 IDB 权威，否则导出有损快照
    //（丢图片/语音/长文本），跨浏览器导入后聊天记录/朋友圈丢失（用户反馈 Safari 导出→
    // Chrome 导入丢数据）。IDB 失败时从 memoryCache 兜底（idbRestore 回填值/本会话写入值），
    // 仍失败则记录到 exportMissing，导出结束明确提示用户备份可能不完整。
    const exportMissing = []; // 权威键降级记录（只剩有损快照或丢失）
    // v3.26.x #90：键清单改走严格三态接口 idbListKeys（数组=权威清单 / null=没读到）。
    // 原 `idbGetAllKeys() || []` 把「挂起/超时」也当空库 → 导出一份只含 LS 小键的文件，
    // 末尾还提示「全部数据完整」：LS 整库失效的设备（本次报障的小米 14U Edge）上那是
    // 一份近乎空的备份，用户信了就清原设备 = 真丢。清单没读到一律中止、如实提示重试。
    let idbKeys = [];
    if (window.idbListKeys || window.idbGetAllKeys) {
      let listed = null;
      try {
        listed = window.idbListKeys ? await window.idbListKeys() : ((await window.idbGetAllKeys()) || []);
      } catch (e) { listed = null; }
      if (listed === null) {
        impHide();
        if (window.openModal) {
          window.openModal('导出未完成', '', function () {}, {
            noInput: true, okText: '知道了',
            staticText: '没能读到本地数据库清单（浏览器存储繁忙或超时）。\n' +
              '为避免生成一份「看着完整其实缺数据」的备份，本次导出已中止。\n' +
              '请回到桌面稍等十几秒后再点「导出数据」；若多次失败，重启浏览器再试。'
          });
        } else {
          toast('导出未完成：未能读取本地数据库，请稍候重试');
        }
        return;
      }
      idbKeys = listed;
    }
    // 值到手：登记覆盖清单 → ≤20KB 并进备份的 ls 段（返回 null，打包器继续拉下一个），
    // 大键交给流式打包器就地序列化（own=true 表示值是 IDB 读出的私有副本，可边写边释放）。
    function routeValue(k, v, own) {
      cover.see(k, v);
      if (isAuthorityKey(k)) { try { delete small[k]; } catch (e) {} } // 有损 LS 快照不得混进备份
      if (!overSmallLimit(v, LS_SMALL_LIMIT)) { small[k] = v; return null; }
      return { k: k, v: v, own: own };
    }
    // v3.36.x #582：聊天模式收集消息里引用到的媒体池 hash（扫描器见文件上方 collectMediaHashes）
    const mediaRefs = new Set();
    let mediaRefQueue = null, mediaRefCursor = 0;
    const mediaRefSeen = {};
    const estTotal = Math.max(1, idbKeys.length + Object.keys(lsBig).length);
    let cursor = 0;      // idbKeys 游标
    let tailKeys = null; // idbKeys 走完后，lsBig 里没被 IDB 收录的键（最终兜底）
    let tailCursor = 0;
    let skipped = 0;     // 按所选范围排除掉的键数（音乐文件等）
    let skippedMedia = 0; // #275 文字模式跳过的媒体池条目数（单列，不混进音乐计数）
    const pct = () => 8 + Math.round((idbKeys.length ? Math.min(cursor, idbKeys.length) / idbKeys.length : 1) * 78);
    // 逐键「读 → 序列化 → 释放」的拉取器：打包器每写完一个键才来拉下一个，
    // 所以全过程中内存里最多只有当前这一个大键（旧实现是 800MB 全量对象图一起常驻）。
    async function readNext() {
      while (cursor < idbKeys.length) {
        const k = idbKeys[cursor++];
        expKey = k;
        expKeyBytes = 0;
        try {
          if (k.indexOf('xy-home-v2:') !== 0) continue;
          if (k === SNAPSHOT_KEY) continue; // v3.7.0：副本键不进导出文件
          // 权威键不跳过（LS 有损快照不能代替 IDB 权威值）；双写一致键 LS 小键已收录则跳过
          if (k in small && !isAuthorityKey(k)) continue;
          if (cfg.skip(k)) { skipped++; if (MEDIA_POOL_KEY_RE.test(k)) skippedMedia++; continue; } // 所选范围之外的键（本地音乐文件/文字模式媒体池）
          impShow('正在导出…', '正在读取并打包 ' + Math.min(cursor, estTotal) + ' / ' + estTotal, pct());
          let v = await window.idbGet(k);
          if ((v === undefined || v === null) && lsBig[k] === undefined) {
            // IDB 读取失败且 lsBig 无兜底（典型场景：>200KB 的 IDB-only 键，xyStore 已从 LS 删除，
            // doExport LS 阶段遍历不到 → 无 lsBig 兜底；IDB 事务挂起/超时失败后该键会被静默跳过丢失）。
            // v3.26.x #118：iOS Safari IDB 事务挂起/超时高发（iPhone 13 Safari 导出后再导入数据不全），
            // 单次重试不够。增至 3 次重试，每次间隔 200ms 给 IDB 连接恢复机会
            //（armFgIdbReset 回前台重建连接后通常当场恢复）。
            for (let retry = 0; retry < 3 && (v === undefined || v === null); retry++) {
              await new Promise(r => setTimeout(r, 200));
              v = await window.idbGet(k);
            }
          }
          if (v !== undefined && v !== null) {
            expKeyBytes = typeof v === 'string' ? v.length * 2 : (v instanceof Blob ? v.size : 0);
            // #582：聊天模式先记下这条消息引用到的媒体池条目（打包阶段末统一追加，见下方 mediaRefQueue）
            if (cfg.mediaRefs) collectMediaHashes(v, mediaRefs);
            // v3.6.x：本地音乐改存 Blob 后，备份导出需转成 dataURL 字符串（JSON 无法存 Blob），
            // 导入时恢复为字符串 → 播放路径自动识别转回 Blob
            if (v instanceof Blob) {
              const ent = routeValue(k, 'data:' + (v.type || 'audio/mpeg') + ';base64,' + await blobToBase64(v), true);
              delete lsBig[k]; // 已收录 IDB 权威值，不再回落 LS 兜底
              if (ent) return ent; // 小值已并进 ls 段 → 继续拉下一个键
              continue;
            }
            const ent = routeValue(k, v, true); // 权威值以 IDB 为准（含最新聊天记录）
            delete lsBig[k];
            if (ent) return ent;
            continue;
          } else if (window.idbGetCached && window.idbGetCached(k) !== undefined) {
            // v3.26.x：IDB 读取失败/超时，从 memoryCache 兜底（idbRestore 回填的大键 /
            // 本会话 xyStore.set 写入值）。Safari 等 IDB 事务易挂起的浏览器上，启动时
            // idbRestore 已慢慢回填进 memoryCache，导出时并发 idbGet 失败也能拿到最新值。
            // 注意：这是业务侧正在用的对象，own=false —— 打包器绝不改写它。
            const cv = window.idbGetCached(k);
            expKeyBytes = typeof cv === 'string' ? cv.length * 2 : 0;
            const ent = routeValue(k, cv, false);
            delete lsBig[k];
            if (ent) return ent;
            continue;
          } else if (lsBig[k] !== undefined) {
            // IDB 无此键 / 读取失败 / 超时 → 回落 localStorage 兜底（至少不丢）
            const sv = lsBig[k];
            delete lsBig[k];
            expKeyBytes = typeof sv === 'string' ? sv.length * 2 : 0;
            // v3.26.x：权威键回落 LS 兜底，可能是有损快照（chat-msgs 剥图/截断）→ 记录降级
            if (isAuthorityKey(k)) exportMissing.push(k);
            const ent = routeValue(k, sv, false);
            if (ent) return ent;
            continue;
          } else {
            // IDB 读取多次均失败 + lsBig 无兜底（>200KB IDB-only 键），最后尝试直接从 LS 读
            // （极端情况下 LS 可能有残留快照，聊胜于无）
            try {
              const lsV = localStorage.getItem(k);
              if (lsV !== null) { const ent = routeValue(k, lsV, false); if (ent) return ent; }
            } catch (e) {}
            // v3.26.x #118：IDB 读取失败且无兜底（memoryCache/lsBig/LS 都没有）→ 记录降级。
            // 原只对 chat-msgs/feed-posts（isAuthorityKey）记录，cc-groups/quote-cards/fav-msgs
            // 等键被静默跳过 → 导出文件缺这些键，导入后 idbReplaceAll clear IDB → 彻底丢失
            //（iPhone 13 Safari 导出后再导入数据不全，字卡/回复/收藏明细 LS 0键 + IDB 0键）。
            // 现在对所有丢失键记录，导出结束如实提示用户备份不完整、勿清原设备。
            exportMissing.push(k);
          }
        } catch (e) {} // 单键失败跳过，继续导出其余键
      }
      // v3.36.x #582：聊天模式追加「消息引用到的媒体池条目」——上面扫出的 @@m: hash 在这里逐个
      // 走与聊天键同一条「读 → 打包 → 释放」路径（小条目并进 ls 段、大条目流式写），
      // 让这份「仅聊天记录」备份换机/清库后图片语音还能显示（详见 MEDIA_TOKEN_RE 处说明）。
      // 池里没有的 hash（图片本来就已丢失）直接跳过，不记 exportMissing——那不是本次备份丢的。
      if (cfg.mediaRefs) {
        if (mediaRefQueue === null) mediaRefQueue = Array.from(mediaRefs);
        while (mediaRefCursor < mediaRefQueue.length) {
          const mk = 'xy-home-v2:media:' + mediaRefQueue[mediaRefCursor++];
          if (mediaRefSeen[mk]) continue;
          mediaRefSeen[mk] = 1;
          expKey = mk;
          expKeyBytes = 0;
          impShow('正在导出…', '正在打包聊天图片/语音 ' + mediaRefCursor + ' / ' + mediaRefQueue.length, pct());
          try {
            const mv = await window.idbGet(mk);
            if (mv === undefined || mv === null) continue;
            const ment = routeValue(mk, mv, true);
            if (ment) return ment; // 大条目交打包器流式写（小条目已并进 ls 段）
          } catch (e) {}
        }
      }
      // 大键仅在 localStorage、IndexedDB 里没有（或读取失败）时的最终兜底（如旧版遗留键）
      if (tailKeys === null) tailKeys = Object.keys(lsBig);
      while (tailCursor < tailKeys.length) {
        const k = tailKeys[tailCursor++];
        if (!(k in lsBig)) continue;
        expKey = k;
        if (cfg.skip(k)) { skipped++; continue; }
        const v = lsBig[k];
        delete lsBig[k];
        expKeyBytes = typeof v === 'string' ? v.length * 2 : 0;
        const ent = routeValue(k, v, false);
        if (ent) return ent;
      }
      expKey = '';
      expKeyBytes = 0;
      return null;
    }
    impShow('正在导出…', '正在读取并打包数据', 8);
    // v3.31.x：流式打包——不再 JSON.stringify(data) 一把生成整个 JSON 字符串。大备份设备上
    // 整包字符串 + stringify 内部缓冲会让峰值内存接近 2 倍文件体积，Chrome 安卓标签页 OOM
    // 崩溃（OPPO Find X9 导出闪退）；改为逐键序列化边拼边合并进 Blob（见 jsonToBlobStreaming）。
    // v3.32.x #104：进一步改成「边读边打包」+ 值内逐元素下钻，大键也不再整串分配。
    expStage = '打包数据文件';
    const pack = await jsonToBlobStreaming({ exportTime: exportTime, cfg: cfg }, readNext, small);
    const blob = pack.finish();
    // v3.27.x：导出内容覆盖清单——本次导出的功能模块一目了然（导出=全局全部数据，
    // localStorage 小键 + IndexedDB 大键全量收集，用户反馈「看不到导出了哪些功能」）。
    // v3.32.x：覆盖清单改在读取每个键时顺手登记（见 exportCoverage().see），
    // 打包后 data 已逐键释放，不再二次遍历统计（那等于为几十 MB 的值再翻一遍内存）。
    // 注意：full 模式必须写成完整字面量（不能拼接），build.mjs 哨兵按「导出内容（全局全部数据）」整串检索产物。
    let coverText = (cfg.mode === 'full' ? '导出内容（全局全部数据）：\n' : '导出内容（' + cfg.label + '）：\n') + cover.lines().join('\n') + '\n——';
    if (skipped) coverText += '\n· 按所选范围跳过本地音乐文件 ' + skipped + ' 个（到新设备重新添加即可）';
    if (skippedMedia) coverText += '\n· 按所选范围跳过图片附件（媒体池条目）' + skippedMedia + ' 个（只备份文字＝图片不进文件）';
    if (pack.stat.stripCnt) {
      coverText += '\n· 按所选范围跳过图片/语音等媒体附件 ' + pack.stat.stripCnt + ' 处（约 ' +
        fmtSize(pack.stat.stripChars * 2) + '，文字与设置全部保留）';
    }
    // v3.26.x：权威键降级提示——IDB 事务挂起/超时导致聊天记录/朋友圈只拿到 LS 有损
    // 快照（剥图/截断）或彻底丢失。明确告知用户备份可能不完整，切勿据此清空原设备数据。
    if (exportMissing.length) {
      // v3.26.x #118：对所有丢失键生成友好名字（原只对 chat-msgs/feed-posts）。
      const nameOf = function (k) {
        const tail = k.slice('xy-home-v2:'.length);
        if (/:chat-msgs$/.test(k)) return '聊天记录(' + tail + ')';
        if (/:feed-posts$/.test(k)) return '朋友圈(' + tail + ')';
        if (/:cc-groups$/.test(k)) return '字卡库(' + tail + ')';
        if (/:cc-groups-public$/.test(k)) return '公用字卡库(' + tail + ')';
        if (/:quote-cards$/.test(k)) return '自定义字卡(' + tail + ')';
        if (/:fav-msgs$/.test(k)) return '收藏(' + tail + ')';
        if (/:avatar-/.test(k)) return '头像(' + tail + ')';
        if (/:music-file:/.test(k)) return '音乐文件(' + tail + ')';
        if (/:reply-/.test(k)) return '回复设置(' + tail + ')';
        if (/:ta-/.test(k)) return 'TA回复字卡(' + tail + ')';
        return tail;
      };
      const names = exportMissing.map(nameOf);
      coverText += '\n⚠ 以下数据可能未完整导出（IDB 读取失败，仅拿到有损快照或丢失）：\n' + names.map(n => '· ' + n).join('\n') + '\n请勿清空原设备数据，建议重启浏览器后重新导出。';
    }
    // v3.32.x #104：成品太大 = 新设备上「导得出去、导不回来」（导入要整包读成字符串再 JSON.parse），
    // 与其让用户拿着一份restore不了的文件换机时才发现，不如打包完当场说清并指路更小范围。
    if (blob.size > MODE_IMPORT_WARN) {
      coverText += '\n⚠ 这个文件约 ' + fmtSize(blob.size) + '，新设备导入时要一次性读入整个文件，' +
        '这么大有较大概率导入失败。建议重新点「导出数据」改选「不含音乐文件」或「只备份文字」再做一份。';
    }
    // v3.9.x：文件名用本地日期（原 toISOString 是 UTC，凌晨导出文件名会是前一天）
    // v3.36.x #582：文件名带范围——「仅聊天记录」原来也叫「mochi数据备份_日期.json」，与完整备份
    // 同名，过一阵谁也分不清手里这份能恢复什么（导入侧只看内容、不看文件名，不受此影响）。
    const fname = (cfg.mode === 'chat' ? 'mochi聊天记录_' : 'mochi数据备份_') + localDateStr(new Date()) + '.json';
    // v3.27.x：体积友好显示——大备份自动换算 MB（原只显示 KB，上千 KB 不便读）
    const sizeStr = fmtSize(blob.size);
    const doneText = '数据已导出（' + sizeStr + '，' + cfg.note + '）';
    // v3.6.x：记录最近一次成功导出时间——备份提醒条（pwa.js）据此判断是否该提醒。
    // v3.3x.x：#355b 「仅聊天记录」导出只算部分备份，不更新 __last-backup——否则会压制
    // 全量备份提醒，让用户误以为数据已整体备份完（音乐/图片/设置等都还没备份）。
    if (cfg.mode !== 'chat') { try { localStorage.setItem('xy-home-v2:__last-backup', String(Date.now())); } catch (e) {} }
    // v3.29.x：自动备份副本已下线——导出不再把整包 JSON 复制进 IndexedDB。
    //   旧实现有 ≤3MB 才写的阈值（为修 iOS Safari 导出闪退 / 小米 14U Edge 导出后本地存储被写坏而加），
    //   结果是真正需要备份的大数据量用户永远拿不到副本，副本只留存在旧版本里变成纯冗余占用
    //   （实测有 700MB+ 遗留快照），且任何读取方都要整包 JSON.parse 一次。备份能力统一交给下载文件。
    // v3.9.x：修复真我手机 Edge（Android Chromium）导出完全没反应……
    // 三级降级保存：① 系统分享面板 navigator.share ② 系统保存框 showSaveFilePicker
    // ③ 传统 a[download] 下载。前两者会弹系统原生界面由用户确认保存位置；
    // 第三种不再静默自动下载——统一改为先弹「备份已打包完成」确认框，用户点「确定」
    // 后才真正触发下载，避免"文件还没经用户同意就悄悄存好了"。
    impShow('正在导出…', '正在准备保存文件', 92);
    const saveRes = await saveBackupFile(blob, fname);
    impHide();
    if (saveRes === 'ok') { toast(doneText); return; }
    // v3.9.x：'cancel' 不再直接放弃——华为/夸克等浏览器分享面板会立刻 AbortError
    //（分享面板不弹、直接返回「已取消保存」），数据其实已打包好，统一走「确定后下载」
    // 兜底，保证任何浏览器都能导出成功；用户仍可点「取消」放弃本次保存。
    // 原生分享/保存框不可用、被取消或未成功：数据已打包好，需要用户点「确定」才真正下载
    // v3.29.x：副本已下线——不再承诺「本机另有副本可恢复」，统一如实说明下载文件是唯一备份。
    if (window.openModal) {
      window.openModal('备份已打包完成（' + sizeStr + '）', '', () => {
        if (anchorDownload(blob, fname)) toast(doneText);
        else toast('仍未触发下载。请重新点击「导出数据」并确认保存下载文件——这份文件是你的唯一备份');
      }, { noInput: true, big: true, staticText: coverText + '\n数据已经打包好，还没开始保存。\n点「确定」开始下载保存到本机，点「取消」放弃本次保存。\n（请务必确认下载保存成功：本机不再另存副本，这个文件就是唯一备份）' });
    } else {
      toast('备份已打包（' + sizeStr + '），请重新点击「导出数据」触发下载并保存文件（唯一备份）');
    }
  }

  // v3.9.x：保存备份文件——返回 'ok'（已分享/已保存）/ 'cancel'（用户取消）/ 其他（被拦截或无法确认）。
  // 必须在用户手势（点击）触发链上调用：navigator.share / showSaveFilePicker 都要求用户激活，
  // async 数据收集超过激活窗口后第一次可能被拒，所以调用方失败后会给用户弹窗再点一次重试。
  // FIX 2026-09-11 #333：参数化分享标题/文件 MIME/保存框类型——诊断 docx 导出复用本链路
  // （设备.js buildDocxBlob 产物），不再只能分享「JSON 备份」。默认值保持原行为零变化。
  async function saveBackupFile(blob, fname, shareTitle, saveTypes) {
    const file = new File([blob], fname, { type: blob.type || 'application/json;charset=utf-8' });
    // ① 系统分享面板
    // v3.9.x：华为（Mate20 默认浏览器）与夸克对 navigator.share({files}) 支持不稳定——
    // canShare 返回 true 但实际调用立刻抛 AbortError（分享面板不弹、直接「已取消保存」），
    // 用户完全无法导出。检测到这些浏览器直接跳过分享面板，走「确定后下载」流程。
    // v3.26.x 收口第二批：UA 嗅探改读 device.js env.brokenFileShare（唯一嗅探处）。
    const brokenFileShare = !!((window.mochiDevice || {}).env || {}).brokenFileShare;
    // v3.31.x：超大备份不走系统分享面板——安卓 Chrome 分享 50MB+ 文件会把文件复制进分享
    // intent，内存吃紧机型上分享面板可能直接把标签页搞崩（OPPO Find X9 导出闪退路径之一）。
    // 大文件统一走「确定后下载」（a[download] 由浏览器流式落盘，不额外复制整包）。
    const shareMax = 50 * 1024 * 1024;
    if (!brokenFileShare && blob.size <= shareMax && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: shareTitle || 'mochi 数据备份' });
        return 'ok';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancel';
        // NotAllowedError（无激活）/ SecurityError / 分享失败 → 继续降级
      }
    }
    // ② 系统保存框
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fname,
          types: saveTypes || [{ description: 'JSON 备份', accept: { 'application/json': ['.json'] } }]
        });
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        return 'ok';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancel';
      }
    }
    // ③ 传统 a[download] 下载：不再在本函数里静默触发——合成 a.click() 在部分浏览器
    // 会未经用户同意就悄悄下载。统一交给调用方在「备份已打包完成」确认弹窗点「确定」后
    // 调用 anchorDownload(blob, fname)（此时是有效用户手势，Android Chromium 也不再被拦截），
    // 返回 'blocked' 表示需要用户确认后才下载。
    return 'blocked';
  }

  // v3.xx：真正执行 <a download> 下载。只在用户点「确定」（有效用户手势）后调用，
  // 保证下载前一定有用户同意，同时解决此前"自动 a.click() 静默下载/被拦截"的问题。
  // v3.28.x：修复大备份「点了下载没反应/没下载完」——原实现在 1 秒后
  //   URL.revokeObjectURL + a.remove()：几十 MB 备份（音乐/头像/聊天全量，base64 后
  //   轻松上百 MB）下载刚由浏览器接管、blob 还没读完就被作废 → 无下载通知、无文件落盘
  //   （小米 14U Edge 实测：进度条走完、点确定，下载框一个都不弹）。改为长命 URL：
  //   ① blob URL 保留到页面关闭/离开（pagehide）才释放；② 5 分钟兜底释放防泄漏；
  //   ③ anchor 不再 1 秒就 remove（a.remove 后浏览器下载不受影响，但保留更稳妥）。
  //   a.download 在用户手势内触发，Android Chromium 不再拦截。
  function anchorDownload(blob, fname) {
    try {
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { if (a.parentNode) a.remove(); } catch (e) {} }, 5000);
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 300000);
      window.addEventListener('pagehide', function h() {
        window.removeEventListener('pagehide', h);
        try { URL.revokeObjectURL(url); } catch (e) {}
      });
      return true;
    } catch (e) { return false; }
  }

  // v3.26.x #172：通用「小文件导出」三级降级链（美化方案/聊天方案等）——
  // 与 saveBackupFile 同源：①系统分享面板（iPhone 主屏安装 standalone 没有下载管理器、
  // a[download] 静默无反应的唯一可用保存通道）②系统保存框 ③确认后 a[download] 下载。
  // 修「桌面/聊天美化方案无法导出」（f4158f6 收敛为仅文件下载后，standalone/壳浏览器全断）。
  // 返回 'ok'（已分享/已保存）/ 'cancel'（用户取消）/ 'blocked'（交给确认弹窗下载）/ 'fail'（链路不可用）。
  window.mochiExportFile = function (json, fname, title) {
    let blob;
    try { blob = new Blob([json], { type: 'application/json;charset=utf-8' }); } catch (e) { return Promise.resolve('fail'); }
    return Promise.resolve(saveBackupFile(blob, fname, title)).then((res) => {
      if (res === 'ok') { toast('已保存「' + fname + '」'); return 'ok'; }
      if (res === 'cancel') return 'cancel';
      if (window.openModal) {
        window.openModal('文件已打包（' + fmtSize(blob.size) + '）', '', () => {
          if (anchorDownload(blob, fname)) toast('已导出「' + fname + '」');
          else toast('仍未触发下载，请改用复制文字或换系统浏览器重试');
        }, { noInput: true, staticText: '点「确定」开始下载保存到本机，点「取消」放弃本次保存。' });
        return 'blocked';
      }
      return 'fail';
    });
  };

  // FIX 2026-09-11 #333：Blob 版三级降级导出（诊断 docx 等任意二进制文件用）——
  // 与 runBackupExport 同语义：'cancel'（华为/夸克分享面板秒 AbortError，面板根本没弹）
  // 不当用户反悔处理，统一交给「确定后 a[download]」兜底，保证任何内核至少有一条活路；
  // mochiExportFile 保持旧 'cancel' 短路语义不变（美化方案三个调用方依赖它，勿合并）。
  // saveTypes：showSaveFilePicker 的 types（docx 传 Word 类型，防保存框强改 .json 后缀）。
  window.mochiExportBlob = function (blob, fname, shareTitle, saveTypes) {
    if (!(blob instanceof Blob)) return Promise.resolve('fail');
    return Promise.resolve(saveBackupFile(blob, fname, shareTitle, saveTypes)).then((res) => {
      if (res === 'ok') { toast('已保存「' + fname + '」'); return 'ok'; }
      if (res === 'fail') return 'fail';
      if (window.openModal) {
        window.openModal('文件已打包（' + fmtSize(blob.size) + '）', '', () => {
          if (anchorDownload(blob, fname)) toast('已开始下载「' + fname + '」');
          else toast('仍未触发下载，请改用复制文字或换系统浏览器重试');
        }, { noInput: true, staticText: '点「确定」开始下载保存到本机，点「取消」放弃本次保存。' });
        return 'blocked';
      }
      return 'fail';
    });
  };

  // v3.27.x：体积友好显示——<1MB 显示 KB，≥1MB 显示 MB（原导出只显示 KB，大备份上千 KB 不便读）
  function fmtSize(n) {
    if (!n) return '0 KB';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return Math.round(n) + ' B';
  }

  // v3.27.x：导出内容覆盖清单——按键尾统计各功能模块本次导出了哪些数据，
  // 让用户确认「导出数据=全局全部数据」（用户反馈：导出弹窗不显示导出了哪些功能）。
  // v3.32.x #104：改成「读到一个键登记一个键」的累加器（旧签名 exportCoverage(data) 要求
  // 全量数据在场，而流式打包写完一个键就把它释放了，打包后再统计等于把几十 MB 的值
  // 再翻一遍内存——正是 #103 要消掉的窗口）。语义与旧版一致：同一功能取第一个非空键
  // 的值做描述，>1MB 字符串不整包 parse，输出顺序仍按 RULES 顺序。
  function exportCoverage() {
    // [键尾正则, 功能名, 可选解析函数(v)=>条数文本]
    const RULES = [
      [/:chat-msgs$/, '聊天记录', arr => arr.length + ' 条'],
      // v3.26.x：多群聊分组——自定义群聊消息键为 xy-home-v2:gc-msgs-<gid>，一并计入「群聊记录」
      [/:group-chat-msgs$|:gc-msgs-/, '群聊记录', arr => arr.length + ' 条'],
      [/mail-letters/, '信箱', arr => arr.length + ' 封'],
      [/feed-posts/, '朋友圈', arr => arr.length + ' 条'],
      [/cc-groups/, '字卡库', obj => Object.keys(obj).length + ' 组'],
      [/quote-cards/, '自定义字卡', arr => arr.length + ' 张'],
      [/fav-msgs/, '收藏', arr => arr.length + ' 条'],
      [/:avatar-user$|:avatar-partner$/, '头像', null],
      [/music-file:|music-favs/, '音乐', null],
      [/divine-history/, '占卜记录', arr => arr.length + ' 条'],
      [/cal-my-|records-/, '日历/纪念', null],
      [/memo-|myarc/, '备忘录/档案', null],
      [/gc-profiles/, '群聊资料', null],
      [/period-|cycle-/, '经期记录', null],
      [/accounting|expense/, '记账', null],
      [/garden-|room-data/, '花园/房间', null],
      [/drift-data/, '漂流瓶', null],
      [/desk-layout|hidden-icons/, '桌面布局', null]
    ];
    const BIG_STR = 1024 * 1024;
    const desc = new Array(RULES.length).fill(null); // null＝该功能还没见到非空数据
    const from = new Array(RULES.length).fill('');   // 该描述来自哪个键：同键后来的值（IDB 权威）覆盖前值（LS 快照）
    // 备份里的值可能是 JSON 文本（LS 快照/旧写入格式），也可能已是 IDB 直存的对象/数组
    const unwrap = (v) => {
      if (typeof v !== 'string') return v;
      try { return JSON.parse(v); } catch (e) { return v; }
    };
    return {
      see(k, v) {
        if (v === null || v === undefined) return;
        const bigStr = typeof v === 'string' && v.length > BIG_STR;
        for (let i = 0; i < RULES.length; i++) {
          // 旧版 valOf 以 data.idb 优先：同一键后到的权威值必须重算覆盖，
          // 否则 LS 空快照会把「聊天记录：0 条」留在一份含几千条消息的备份上。
          if (desc[i] !== null && from[i] !== k) continue;
          if (!RULES[i][0].test(k)) continue;
          // v3.31.x：超大键（聊天记录/字卡库可达几十 MB）不为「非空判断/条数统计」整包 parse
          if (bigStr) { desc[i] = RULES[i][2] ? '✓有（数据较大）' : '✓有'; from[i] = k; continue; }
          const parsed = unwrap(v);
          if (parsed === null || parsed === undefined || parsed === '') { desc[i] = null; continue; }
          try {
            const parse = RULES[i][2];
            desc[i] = (parse && (Array.isArray(parsed) || typeof parsed === 'object'))
              ? parse(parsed) : '✓有';
            from[i] = k;
          } catch (e) { desc[i] = '✓有'; from[i] = k; }
        }
      },
      lines() {
        const out = [];
        for (let i = 0; i < RULES.length; i++) if (desc[i] !== null) out.push('· ' + RULES[i][1] + '：' + desc[i]);
        return out.length ? out : ['· 检查到无数据（备份为空）'];
      }
    };
  }

  // v3.5.101：导入前预览备份摘要——显示导出时间/键数/聊天条数/头像/摸鱼累计，
  // 避免误导入旧备份或错文件（曾出现导入的文件不是最新备份、数据缺失的情况）
  function backupSummary(data) {
    const fmtMB = (n) => (n / 1048576).toFixed(1) + ' MB';
    const cnt = (o) => (o && typeof o === 'object' ? Object.keys(o).length : 0);
    const bytesOf = (v) => (v == null ? 0 : byteLen(typeof v === 'string' ? v : JSON.stringify(v)));
    let lsB = 0, idbB = 0;
    Object.keys(data.ls || {}).forEach(k => { lsB += bytesOf(data.ls[k]); });
    Object.keys(data.idb || {}).forEach(k => { idbB += bytesOf(data.idb[k]); });
    let chatN = '无';
    try {
      // v3.6.x：多桌面——备份里可能有多个联系人的 chat-msgs，全部统计
      const all = Object.keys(data.idb || {}).concat(Object.keys(data.ls || {}));
      const chats = all.filter(k => /:chat-msgs$/.test(k));
      let n = 0;
      chats.forEach(k => {
        const raw = (data.idb && data.idb[k]) || (data.ls && data.ls[k]);
        const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(arr)) n += arr.length;
      });
      if (n) chatN = n + ' 条';
    } catch (e) {}
    // v3.6.x：多桌面——头像/摸鱼值任一桌面存在即显示"有"
    const allKeys = Object.keys(data.ls || {}).concat(Object.keys(data.idb || {}));
    const avMe = !!allKeys.find(k => /:avatar-user$/.test(k));
    const avTa = !!allKeys.find(k => /:avatar-partner$/.test(k));
    let fish = null;
    const fishK = allKeys.find(k => /:fish-total$/.test(k));
    if (fishK) fish = (data.ls && data.ls[fishK]) !== undefined ? data.ls[fishK] : (data.idb && data.idb[fishK]);
    const lines = [];
    lines.push('备份内容（请确认是对的文件）：');
    lines.push('· 导出时间：' + fmtLocalTime(data.exportTime));
    lines.push('· 小存储 ' + cnt(data.ls) + ' 项（' + fmtMB(lsB) + '）+ 大文件 ' + cnt(data.idb) + ' 项（' + fmtMB(idbB) + '）');
    lines.push('· 聊天记录：' + chatN);
    lines.push('· 头像：我 ' + (avMe ? '✓有' : '✗无') + '，TA ' + (avTa ? '✓有' : '✗无'));
    lines.push('· 摸鱼累计：' + (fish !== null ? fish : '✗无'));
    lines.push('若这里显示「聊天记录：无/头像✗」等，说明不是最新完整备份，请勿导入。');
    return lines.join('\n');
  }

  // 导入
  async function doImport(file) {
    // 大备份读取/解析耗时较长，先亮进度遮罩
    impShow('正在读取数据文件…', '大备份（上百 MB）解析需要几秒，请稍候', null);
    let data;
    try {
      const text = await readFileText(file);
      data = JSON.parse(text || 'null');
    } catch (e) {
      impHide();
      // v3.32.x #104：备份文件再大也「导得出去」，但读取侧要把整个文件读成一个字符串再
      // JSON.parse —— 超过浏览器单串上限时抛的是 Invalid string length，说「无效的数据文件」
      // 是把用户往错误方向带（文件没坏，是这台设备读不动这么大的一份）。
      const msg = (e && (e.message || String(e))) || '';
      if (/string length|out of memory|ArrayBuffer length|memory/i.test(msg)) {
        if (window.openModal) {
          window.openModal('这份备份太大，本机读不进去', '', function () {}, {
            noInput: true, okText: '知道了', big: true,
            staticText: '文件本身没有坏，是它超过了浏览器一次能读入的体积上限（导入要把整个文件一次读成字符串再解析）。\n' +
              '本机数据没有被改动。\n请在原设备上重新点「导出数据」，选择「不含音乐文件」或「只备份文字」再做一份体积更小的备份。'
          });
        } else {
          toast('这份备份太大，本机读不进去——请在原设备上改选更小的备份范围重导一份');
        }
        return;
      }
      toast('无效的数据文件');
      return;
    }
    impHide();
    if (!data || typeof data !== 'object' || !data.ls || typeof data.ls !== 'object') {
      toast('不是 mochi 导出的数据文件');
      return;
    }
    // v3.6.x：备份结构强校验——① app 标识不匹配直接拒绝（防误导其他应用的 json）；
    // ② 键前缀完全不匹配 mochi（xy-home-v2:）视为无效文件——原实现 {ls:{},idb:{}}
    // 空结构也能通过校验，配合先清空再写入，会把用户数据全清掉
    const MOCHI_PREFIX = 'xy-home-v2:';
    const lsLooksMochi =
      Object.keys(data.ls).some(k => k.indexOf(MOCHI_PREFIX) === 0) ||
      !!(data.idb && typeof data.idb === 'object' && Object.keys(data.idb).some(k => k.indexOf(MOCHI_PREFIX) === 0));
    // v3.9.x：app 标识不匹配但键前缀是 xy-home-v2:（mochi 独有前缀）时仍允许导入——
    // 覆盖 fork 版/手改 app 字段的 mochi 备份（数据本身是 mochi 结构）；只有 app 与键
    // 都不像 mochi 才拒绝（防别的应用 json 误导入）
    if (data.app && data.app !== 'mochi-zika' && !lsLooksMochi) {
      toast('不是 mochi 导出的数据文件');
      return;
    }
    const hasMochiKeys = lsLooksMochi;
    // v3.5.101：导入前先预览该备份的内容摘要，确认无误再覆盖（正常分支与兼容分支共用）
    function confirmAndImport(d) {
      if (!window.openModal) return;
      const summary = backupSummary(d);
      window.openModal('确定导入数据？将覆盖当前所有数据，且无法恢复。', '', () => {
        doImportGo(d);
      }, { noInput: true, staticText: summary });
    }
    if (!hasMochiKeys) {
      // 前缀兼容：文件通过 app 校验但键前缀不是 xy-home-v2:。探测文件里键的
      // 实际前缀，若键尾像 mochi 则提示重写前缀后导入；空备份/别的应用文件仍拒绝。
      // 原实现直接 toast 拒绝，导致前缀被改过的备份（手动编辑/旧版 fork）无法导入。
      const allKeys = Object.keys(data.ls || {}).concat(Object.keys(data.idb || {}));
      if (!allKeys.length) {
        toast('备份文件是空的（无任何数据键），没有可导入的数据');
        return;
      }
      const firstColon = allKeys[0].indexOf(':');
      if (firstColon < 0) {
        toast('备份文件键格式异常（无冒号分隔），无法导入');
        return;
      }
      const detectedPrefix = allKeys[0].slice(0, firstColon + 1);
      const allSamePrefix = allKeys.every(k => k.indexOf(detectedPrefix) === 0);
      if (!allSamePrefix) {
        toast('备份文件键前缀混乱（多种前缀），无法自动迁移。样例：' + allKeys.slice(0, 5).join('、'));
        return;
      }
      // v3.9.x：键尾识别列表扩充到 v3.6~v3.9 全部功能——旧列表只有 v3.6 初期的
      // 13 个键，群聊(gc-*)/占卜(divine-*)/每日小记(quote-history/memo-*)/摸鱼工作值
      // (day-fish-*/work-day-add)等新键缺位，真实 mochi 备份被改过前缀后仍会误拒。
      const mochiKeyTails = [
        // 强特征（mochi 独有，命中即视为 mochi）
        'chat-msgs', 'cc-groups', 'active-contact', 'contacts', 'fish-total',
        'avatar-user', 'avatar-partner', 'desk-image-src', 'music-file:',
        // v3.6 桌面/外观/设置
        'theme-mode', 'accent-color', 'reply-settings', 'chat-settings',
        'cs-', 'lbl-', 'avatar-', 'desk-', 'app-icon-', 'widget-',
        'phone-bg', 'page-bg-', 'card-bg-', 'hidden-icons', 'ico-radius',
        // v3.7 占卜/通话/记录
        'divine-history', 'divine-send-auto', 'call-mini-', 'records-',
        'fav-msgs', 'invite-ask-history',
        // v3.8 群聊/字卡/信箱/朋友圈/音乐
        'gc-profiles', 'gc-beauty', 'checkin-', 'my-emoji-groups', 'poke-',
        'reply-', 'feed-', 'music-', 'emoji-last', 'group-chat-enabled',
        // v3.9 每日小记/摸鱼工作值
        'quote-history', 'memo-', 'mood-history', 'today-mood-',
        'day-fish-', 'day-work-', 'fish-day-add', 'work-day-add',
        'work-total', 'love-start', 'rel-cat', 'rel-role', 'avatar-lib', 'avatar-me-lib',
        'ck-', 'ckq-', 'rps-score', 'desk-countdowns', 'desk-texts',
        'desk-images', 'desk-layout', 'more-tab', 'cal-my-', 'mem-extras',
        'fish-log', 'fish-migrated', 'music-global', 'music-favs', 'music-float-pos',
        'phone-bg-preset', 'bg-blur', 'bg-mask-op', 'sf-', 'gc-'
      ];
      const tails = allKeys.map(k => k.slice(detectedPrefix.length));
      // v3.9.x：判定增强——① 键尾命中任一已知键尾；② 多桌面结构命中：键去掉前缀后
      // 第一个冒号段是 default 或 c<数字>（联系人桌面命名空间，mochi 独有结构），
      // 覆盖"备份里只有新功能键"（如 quote-history/memo-*）且前缀被改的情况。
      const tailHit = tails.filter(t => mochiKeyTails.some(p => t.indexOf(p) >= 0)).length;
      const deskHit = tails.filter(t => /^(default|c\d+):.+/.test(t)).length;
      const looksMochi = tailHit >= 1 || deskHit >= 1;
      if (!looksMochi) {
        toast('备份文件不像 mochi 数据（键尾不匹配）。前缀：' + detectedPrefix + '，样例：' + allKeys.slice(0, 5).join('、'));
        return;
      }
      if (!window.openModal) return;
      const sample = allKeys.slice(0, 3)
        .map(k => k + '  →  ' + MOCHI_PREFIX + k.slice(detectedPrefix.length)).join('\n');
      window.openModal(
        '检测到备份键前缀为「' + detectedPrefix + '」\n疑似 mochi 备份（键尾匹配），是否重写为「' + MOCHI_PREFIX + '」后导入？',
        '',
        () => {
          const rewrite = (obj) => {
            if (!obj || typeof obj !== 'object') return obj;
            const out = {};
            Object.keys(obj).forEach(k => {
              if (k.indexOf(detectedPrefix) === 0) out[MOCHI_PREFIX + k.slice(detectedPrefix.length)] = obj[k];
              else out[k] = obj[k];
            });
            return out;
          };
          data.ls = rewrite(data.ls);
          data.idb = rewrite(data.idb);
          confirmAndImport(data);
        },
        { noInput: true, staticText: '键映射样例：\n' + sample + '\n\n点确定重写前缀并导入，点取消放弃。' }
      );
      return;
    }
    confirmAndImport(data);
  }

  function doImportGo(data) {
    // v3.5.113：导入进度遮罩（读取已完成，这里开始逐条写入）
    impShow('正在导入…', '准备中', 2);

    // FIX 2026-09-10 #275 旧「只备份文字」备份的池腐蚀自愈：strip 导出曾把媒体池 dataURL 剥成
    // 空串而消息里的 @@m: 令牌原样保留——导入后＝全体令牌失配的永久坏图（渲染侧 map 缓存 ''
    // + img.src=''），且空串条目 ≤20KB 会随今后每次完整备份继续传给别的设备（多机型反复
    // 「图片丢失」的传播链）。导入前把这类脏池条目（空串/非 data: 值）直接丢弃：键保持缺席
    // → 渲染走「图片丢失：媒体数据缺失」准确占位，日后导入完整备份即自愈；合法池值一律不动。
    function scrubMediaPool(obj) {
      if (!obj || typeof obj !== 'object') return;
      Object.keys(obj).forEach(function (k) {
        if (!MEDIA_POOL_KEY_RE.test(k)) return;
        const v = obj[k];
        if (typeof v !== 'string' || v.indexOf('data:') !== 0) { try { delete obj[k]; } catch (e) {} }
      });
    }
    scrubMediaPool(data.idb);
    scrubMediaPool(data.ls);

    // ---- 1. 备份当前 localStorage 的 xy-home-v2 键（导入失败可回滚） ----
    let backup = null;
    try {
      backup = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('xy-home-v2:') === 0) backup[k] = localStorage.getItem(k);
      }
    } catch (e) { backup = null; }

    // ---- 2. 原子恢复 IndexedDB（字卡 / 查岗 / 音乐文件等大件挪进 IDB，不占 localStorage 配额） ----
    // v3.6.x：改用 idbReplaceAll（单事务 clear + 批量 put）——旧实现先 idbClearAll 清空、
    // 再逐条 idbSet，清空与写入之间有几秒~几分钟无原子窗口，中途崩溃/杀进程会留下
    // 半空库，旧数据无法恢复。单事务失败自动回滚到事务前（旧数据完整保留），
    // 导入真正变成「要么全部替换、要么原样不动」。
    const idbRestored = new Promise((resolve) => {
      if (!data.idb || typeof data.idb !== 'object') { resolve(true); return; }
      const idbKeys = Object.keys(data.idb).filter(k => k.indexOf('xy-home-v2:') === 0 && k !== SNAPSHOT_KEY);
      if (!idbKeys.length) { resolve(true); return; }
      if (window.idbReplaceAll) {
        impShow('正在导入…', '正在原子写入大文件（字卡/聊天/音乐等）…', 8);
        const pairs = idbKeys.map(k => ({ k: k, v: data.idb[k] }));
        // v3.26.x #118：导入前保留当前 IDB 有而备份没有的键（防 clear 致丢数据）。
        // 根因：导出时 iOS Safari IDB 事务挂起/超时，部分 IDB-only 键（cc-groups 等）
        // 被静默跳过 → 备份文件缺这些键 → 导入 idbReplaceAll clear IDB → 彻底丢失
        //（iPhone 13 Safari 导出后再导入数据不全，字卡/回复/收藏明细 LS 0键 + IDB 0键）。
        // 修复：列出当前 IDB 键，找出备份没有的键（且不在 data.ls），读出值加入 pairs，
        // idbReplaceAll clear 后这些键也会被 put 回去 → 不丢数据。备份完整时保留键为空，
        // 导入语义不变（替换）；只有备份不完整时才保留旧键（合并），比丢数据安全。
        const lsKeySet = {};
        try { Object.keys(data.ls || {}).forEach(k => { if (k.indexOf('xy-home-v2:') === 0) lsKeySet[k] = true; }); } catch (e) {}
        const backupKeySet = {};
        try { idbKeys.forEach(k => { backupKeySet[k] = true; }); } catch (e) {}
        const retainStep = (window.idbListKeys && window.idbGetMany)
          ? window.idbListKeys().then(function (curKeys) {
              // FIX 2026-09-14 #440 清单读不到（idbListKeys 严格版 null＝「未知」）绝不能按
              // 「无需保留」继续：保留清单是 #118 防 clear 丢数据的唯一防线，「只备份文字」
              // 备份不含媒体池键，此处放行＝idbReplaceAll clear 把整个媒体池抹掉＝全部图片
              // 变「图片丢失」且随导入跨设备扩散（红米K80 等多机型反复图片丢失的传播口子）。
              // 改为中止导入（resolve(false) 走下方既有失败分支：进度遮罩+「原有数据已保留」
              // 提示，原数据一字不动），稍后存储空闲重试——与 idb.js 严格版契约一致：
              // 「null 只能当未知，绝不据此落盘覆盖」。retain 值批量读失败同理（清单在、
              // 值拿不到＝保留不了，照样会 clear 掉这些键）。
              if (!Array.isArray(curKeys)) return { abort: true };
              const retain = curKeys.filter(function (k) {
                return k && k.indexOf('xy-home-v2:') === 0 &&
                  k !== SNAPSHOT_KEY &&
                  !backupKeySet[k] && !lsKeySet[k];
              });
              if (!retain.length) return [];
              return window.idbGetMany(retain).then(function (map) {
                const kept = [];
                retain.forEach(function (k) {
                  const v = map[k];
                  if (v !== undefined && v !== null) kept.push({ k: k, v: v });
                });
                return kept;
              }).catch(function () { return { abort: true }; });
            }).catch(function () { return { abort: true }; })
          : Promise.resolve([]);
        retainStep.then(function (kept) {
          if (kept && kept.abort) { resolve(false); return; } // #440 清单未知＝无法安全替换式导入 → 中止（原数据保留）
          const keptPairs = kept || [];
          const allPairs = keptPairs.length ? pairs.concat(keptPairs) : pairs;
          window.idbReplaceAll(allPairs).then(ok => {
            if (ok) impShow('正在导入…', '大文件写入完成' + (keptPairs.length ? '（已保留备份未含的 ' + keptPairs.length + ' 个旧键）' : ''), 60);
            else { try { data.idb = {}; } catch (e) {} }
            resolve(ok);
          });
        });
        return;
      }
      // 兜底：极端环境无 idbReplaceAll → 退回旧流程（先清空后逐条写，非原子）
      if (!window.idbSet) { resolve(true); return; }
      const clearFirst = (window.idbClearAll && window.idbClearAll()) || Promise.resolve(true);
      clearFirst.then((cleared) => {
        if (cleared !== true) { resolve(false); return; }
        let p = Promise.resolve();
        let failed = 0;
        let done = 0;
        const total = idbKeys.length;
        idbKeys.forEach(k => {
          p = p.then(() => window.idbSet(k, data.idb[k])).then(ok => {
            try { delete data.idb[k]; } catch (e) {}
            done++;
            if (!ok) failed++;
            impShow('正在恢复大文件（字卡/聊天/音乐等）…', done + ' / ' + total, 5 + Math.round(done / total * 55));
          });
        });
        p.then(() => resolve(failed === 0)).catch(() => resolve(false));
      });
    });

    // ---- 3. 清空旧数据（xy-home-v2 前缀） ----
    function clearLs() {
      try {
        Object.keys(localStorage)
          .filter(k => k.indexOf('xy-home-v2:') === 0)
          .forEach(k => localStorage.removeItem(k));
      } catch (e) {}
    }
    // 回滚：还原导入前的旧数据
    function rollback() {
      clearLs();
      if (backup) {
        try {
          Object.keys(backup).forEach(k => localStorage.setItem(k, backup[k]));
        } catch (e) {}
      }
    }

    idbRestored.then((idbOk) => {
      // v3.6.x：IDB 原子替换失败 → 数据已由事务回滚保持原样，这里中止后续——
      // 不再继续写 localStorage，否则会出现「localStorage 新数据 + IndexedDB 旧数据」混合态
      if (!idbOk) {
        impHide();
        toast('导入失败：大文件写入未成功，原有数据已保留，请重试');
        return;
      }
      impShow('正在导入…', '正在写入设置与聊天记录', 62);
      // ---- 4. 写 localStorage 前先估算总字节；超配额时按体积从大到小丢弃大键 ----
      // 聊天记录双写（localStorage + IndexedDB）：导入时 IndexedDB 已恢复完整权威版
      // （含图片 dataURL），localStorage 无需再写超大聊天记录——启动时 loadMsgs 会
      // 自动从 IndexedDB 恢复。这样导入不再因聊天记录占几十 MB 而整体取消。
      const lsKeys = Object.keys(data.ls).filter(k => k.indexOf('xy-home-v2:') === 0 && k !== SNAPSHOT_KEY);
      let entries = lsKeys.map(k => ({ k: k, len: byteLen(data.ls[k]) + byteLen(k) }));
      let chatMoved = false;
      // v3.26.x：chat-msgs 不写 LS（chat.js 不回填 LS，从 IDB 读）。但仅当 data.idb 有该键
      // 权威值时才跳过；若 data.idb 无权威值（导出时 IDB 失败，只剩 LS 有损快照），把快照
      // 写进 IDB 兜底（有损但聊胜于无），否则 chat-msgs 彻底丢失（原实现无条件跳过 LS 写入
      // → data.idb 无权威时 chat-msgs 既不写 LS 也不进 IDB，跨浏览器导入后聊天记录消失）。
      const chatFallback = [];
      entries = entries.filter(e => {
        if (!/:chat-msgs$/.test(e.k)) return true;
        chatMoved = true;
        if (data.idb && data.idb[e.k] !== undefined) return false; // IDB 有权威，跳过 LS
        chatFallback.push({ k: e.k, v: data.ls[e.k] }); // IDB 无权威，快照写 IDB 兜底
        return false;
      });
      const total = entries.reduce((s, e) => s + e.len, 0);
      // 估算当前设备配额：探测能否写入 1MB 临时键（能 → 桌面 10MB 档；不能 → 手机 5MB 档）
      let quota = 5 * 1024 * 1024;
      try {
        const probe = 'x'.repeat(1024 * 1024);
        localStorage.setItem(window.activePrefix() + ':__quota_probe__', probe);
        localStorage.removeItem(window.activePrefix() + ':__quota_probe__');
        quota = 10 * 1024 * 1024;
      } catch (e) {}
      let budget = total;
      let dropped = [];
      const sorted = entries.slice().sort((a, b) => b.len - a.len);
      for (const e of sorted) {
        if (budget + LS_HEADROOM <= quota) break;
        // 聊天记录绝不丢（v3.5.90：IDB 无 chat-msgs 时 localStorage 兜底）
        if (/:chat-msgs$/.test(e.k)) continue;
        budget -= e.len;
        dropped.push(e);
      }
      // v3.5.91：不再整体取消——按配额丢弃超大图片类大键，其余数据全部写入。
      // 手机 5MB 配额装不下几十 MB 图片是物理限制；跳过的大键有明确提示，
      // 设置/昵称/聊天文字/字卡文字等小键保证完整恢复。
      const skipSet = {};
      dropped.forEach(e => { skipSet[e.k] = true; });

      clearLs();
      let writeFailed = [];
      // v3.5.93：被配额跳过的超大键与写入失败的键不再丢弃——
      // 改写入 IndexedDB（配额远大于 localStorage），启动时自动从 IDB 恢复，数据不丢
      // v3.5.94：写入成功的键若 >200KB，也与运行时策略一致移进 IDB（避免占满 5MB 配额）
      const idbFalls = [];
      // v3.26.x：chat-msgs 的 LS 有损快照兜底（data.idb 无权威值时）写进 IDB
      chatFallback.forEach(f => idbFalls.push(f));
      for (const e of entries) {
        if (skipSet[e.k]) { idbFalls.push({ k: e.k, v: data.ls[e.k] }); continue; }
        try {
          localStorage.setItem(e.k, data.ls[e.k]);
          if (e.len > 200 * 1024) {
            try { localStorage.removeItem(e.k); } catch (err2) {}
            idbFalls.push({ k: e.k, v: data.ls[e.k] });
          }
        } catch (err) {
          writeFailed.push(e.k);
          idbFalls.push({ k: e.k, v: data.ls[e.k] });
        }
      }
      // 等待 IDB 兜底写入全部完成后，再提示 + 刷新
      let fallsOk = 0;
      let p = Promise.resolve();
      idbFalls.forEach(f => {
        p = p.then(() => (window.idbSet ? window.idbSet(f.k, f.v) : Promise.resolve(false)))
          .then(ok => { if (ok) fallsOk++; });
      });
      p.then(async () => {
        impShow('正在导入…', '写入完成，正在核对数据', 95);
        const parts = [];
        if (idbOk) parts.push('音乐/字卡/查岗等大文件已恢复');
        else if (data.idb && Object.keys(data.idb).length) parts.push('⚠ IndexedDB 恢复失败，字卡/音乐/查岗等大文件可能缺失，建议重新导入');
        if (chatMoved) parts.push('聊天记录已存入 IndexedDB（不占浏览器小存储）');
        if (writeFailed.length) parts.push(writeFailed.length + ' 项写入失败（存储空间满）');
        if (idbFalls.length) {
          const mb = (idbFalls.reduce((s, f) => s + byteLen(f.v), 0) / 1048576).toFixed(1);
          parts.push('大文件 ' + idbFalls.length + ' 项（约 ' + mb + ' MB）已存入 IndexedDB，不占小存储');
        }
        if (!parts.length) parts.push('导入成功');
        // v3.5.101：导入后核对关键数据是否真的恢复（避免"提示成功但数据缺失"）
        let ok = [];
        try {
          // v3.6.x：多桌面——核对任一桌面的聊天/头像/摸鱼 + 联系人注册表
          let chatN = 0;
          // v3.26.x #90：chatSeen=看到几个聊天键，chatCheckOk=清单是否真的读到
          let chatSeen = 0, chatCheckOk = true;
          if (window.idbListKeys || window.idbGetAllKeys) {
            try {
              const keys = window.idbListKeys ? await window.idbListKeys() : await window.idbGetAllKeys();
              if (!Array.isArray(keys)) { chatCheckOk = false; }
              else {
                for (const k of keys) {
                  if (/:chat-msgs$/.test(k)) {
                    chatSeen++;
                    const cv = await window.idbGet(k);
                    const a = typeof cv === 'string' ? JSON.parse(cv) : cv;
                    if (Array.isArray(a)) chatN += a.length;
                    else if (cv === undefined || cv === null) chatCheckOk = false;
                  }
                }
              }
            } catch (e) { chatCheckOk = false; }
          }
          if (chatN) ok.push('聊天' + chatN + '条');
          // 清单没读到 / 有聊天键却一条都没取到：核对未成功，必须说出来（不当成"没有记录"）
          if (!chatN && !chatCheckOk) parts.push('⚠ 聊天记录未能核对（数据库繁忙），请打开聊天页确认记录在列后再清理原设备');
          else if (!chatN && chatSeen) parts.push('⚠ 聊天键存在但条数读取失败，请打开聊天页确认');
          const lsKeys = [];
          for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) lsKeys.push(k); }
          if (lsKeys.some(k => /:avatar-user$/.test(k))) ok.push('我的头像✓');
          const fishK = lsKeys.find(k => /:fish-total$/.test(k));
          if (fishK !== undefined) ok.push('摸鱼累计 ' + localStorage.getItem(fishK));
          if (localStorage.getItem('xy-home-v2:contacts')) ok.push('联系人✓');
        } catch (e) {}
        const msg = parts.join('；') + (ok.length ? '；已核对：' + ok.join('、') : '') + '，正在刷新…';
        // v3.5.114：核对失败时明确红字警告（数据确实没恢复时不要静默跳过）
        if (!ok.length) {
          impShow('⚠ 导入完成但未检测到关键数据', '聊天记录/头像/摸鱼未在存储中找到，刷新后仍缺失请重新导入完整备份', 100);
        } else {
          impShow('导入完成', msg, 100);
        }
        // v3.5.118：不再额外弹黑色 toast——结果已完整显示在白色进度面板里
        // （toast z-index 低于进度遮罩，同时弹出会被白板盖住，形成"黑色弹窗被遮挡"）
        // v3.5.117：完成页停留 3.5 秒（用户反馈缓冲时间不够、看不清结果）
        setTimeout(() => { impHide(); location.reload(); }, 3500);
      });
    });
  }

  // v3.29.x：清理历史遗留的自动备份副本。副本写入已下线（见 doExport 上方说明），旧版本留在
  // IndexedDB / localStorage 的那一份变成永远刷不了新的纯冗余占用（实测有 700MB+，约占用户存储一半），
  // 任何读取它的路径都要整包 JSON.parse，风险大于收益。启动时静默删掉即可回收空间。
  // 只删这一个键，业务数据一律不动；延迟执行避开 idbRestore 回填与首屏渲染的启动关键路径。
  function purgeLegacySnapshot() {
    try { localStorage.removeItem(SNAPSHOT_KEY); } catch (e) {}
    if (!window.idbDelete) return;
    // v3.26.x #90：删后要复核再收工——idbDelete 没有挂起超时，原实现连返回值都不看，
    // 实测该设备 173.8MB 遗留副本历经多次启动仍在（白占近一半可用空间）。用严格三态
    // 探测 idbHasKey 复核：false＝确认已删；true＝还在 → 再删一次（最多 5 次）；
    // null＝这次读不到，也重试（事务挂起可能下次恢复）。删不存在的键无副作用，重复调用安全。
    // v3.26.x：idbDelete 已加 4s 超时（idb.js），不再 fire-and-forget——等返回再复核，
    // 避免复核时事务还在排队读到旧状态。间隔 1.5s（原 2.5s），重试 5 次（原 3 次）。
    let tries = 0;
    const attempt = function () {
      tries++;
      Promise.resolve(window.idbDelete(SNAPSHOT_KEY)).then(function () {
        if (!window.idbHasKey) return;
        setTimeout(function () {
          try {
            Promise.resolve(window.idbHasKey(SNAPSHOT_KEY)).then(function (has) {
              if (has !== false && tries < 5) attempt();
            }).catch(function () { if (tries < 5) attempt(); });
          } catch (e) {}
        }, 1500);
      }).catch(function () {});
    };
    attempt();
  }
  // 幂等包装：事件路径与墙钟路径共用，保证 #90 的「删→复核→重试」链只起一套。
  let _purgeStarted = false;
  function purgeOnce() {
    if (_purgeStarted) return;
    _purgeStarted = true;
    purgeLegacySnapshot();
  }
  if (window.__mochiDataReady) { setTimeout(purgeOnce, 1500); }
  else {
    document.addEventListener('mochi-restore-done', function h() {
      document.removeEventListener('mochi-restore-done', h);
      setTimeout(purgeOnce, 1500);
    });
    // v3.29.x 兜底：#83 之后 12 秒保险丝不再设 __mochiDataReady（只派发 mochi-restore-slow），
    // 所以 IDB 整轮挂起的设备上 mochi-restore-done 永不到达 → 清理一次都不跑，几百 MB 副本原地
    // 留着；而 IDB 最慢、遗留副本最大的恰好是同一批机型。与 idb.js 里 wrjMergeFromIdb 的
    // 「restore 整体挂起时的兜底」同理补一条墙钟兜底：清理只碰副本键，restore 完成与否不影响安全性。
    setTimeout(purgeOnce, 20000);
  }

  // 入口绑定
  // v3.6.x：备份提醒条（pwa.js「去备份」）与设置页导出共用同一流程
  window.runBackupExport = function () {
    // v3.5.134：导出前强制落盘——聊天记录有 400ms 防抖，不刷的话备份缺最后几条消息
    // v3.9.x：chatFlushSave 抛错会中断 doExport（表现为点了导出没反应），必须兜住
    try { if (window.chatFlushSave) window.chatFlushSave(); } catch (e) {}
    // v3.32.x #104：① 大库设备先选备份范围（完整备份文件可能大到新设备导不回来）；
    // ② doExport 内部已兜住全部异常并如实弹窗，这里再兜一层收遮罩——旧实现是裸调用
    //    doExport()，打包阶段抛的 RangeError 变成未处理 promise rejection，
    //    进度遮罩永不隐藏，就是用户报的「一直在打包中」。
    Promise.resolve().then(askExportMode).then((mode) => {
      if (mode === 'cancel') { toast('已取消导出'); return; }
      toast('正在导出，请稍候…');
      return doExport(mode);
    }).catch((e) => {
      impHide();
      reportExportError(e, exportCfg('full'));
    });
  };
  // v3.3x.x：#355b 备份提醒条「单独备份聊天」专用入口——只导出聊天记录（CHAT_KEY_RE 键），
  // 体积小、无需弹「选备份范围」；不写 __last-backup（部分备份，仍提示整体备份）。
  // 复用 doExport('chat')，内部已兜住异常并收遮罩。
  window.runChatExport = function () {
    try { if (window.chatFlushSave) window.chatFlushSave(); } catch (e) {}
    toast('正在导出聊天记录，请稍候…');
    return doExport('chat');
  };
  // v3.36.x：#471 设置页「导出全部桌面聊天记录」——与备份提醒条「备份聊天」同入口
  //（CHAT_KEY_RE 匹配全部桌面，含 default 与 c<数字> 各桌面命名空间）。复用 runChatExport
  // 即可，无需单独实现：导出逻辑（LS 小键 + IDB 权威值、流式打包、三级保存链）全在 doExport('chat')。
  // 导出无需确认弹窗——doExport('chat') 直接进入打包流程，且 always flush 聊天内存。
  window.runChatAllExport = function () {
    return window.runChatExport();
  };
  // 分桌写回聊天（非当前桌面用；当前桌面走 chatImportMsgs 内存链路，不调这里）
  // 写入顺序保证 #90 缩水守卫与权威读取一致：chat-msgs（权威）→ chat-meta（账本）→ LS 快照
  // （有损小快照，IDB 为权威源）。idbSet 直接存数组（结构化克隆）以支持超大聊天包。
  // FIX v3.36.x #582：原来返回的是自造 thenable `{ then: (f) => { if (!seq) f(); return seq; } }`
  // ——promise 同化时只会走 `then(resolve, reject)` 而 f 永不调用（seq 恒为真）＝这个 thenable
  // 永不 settle，调用方的写入链在第一个非当前桌面之后整条卡死：第二个桌面、群聊、媒体池
  // 全都不再执行（多桌面导入只恢复第一个桌面）。直接返回真 promise。
  // v3.36.x #582：导入某桌面聊天后，必须清掉该桌面自己的「尾巴日志」(<prefix>:chat-tail，#180 的
  // 60 条轻量副本)：chat.js 切到该桌面、IDB 权威读回后会 chatTailMerge 回放它「msgs 里没有」的条目
  // ——那是这台设备**导入前的旧消息**（被当成「上次会话没落盘的新消息」），会叠到刚导入的历史上，
  // 表现为「导入完切到那个桌面，旧对话又冒出来」。当前桌面走 chatImportMsgs，其内部已 chatTailClear。
  function clearDeskTail(cid) {
    try {
      const ns = 'xy-home-v2:' + cid;
      if (window.xyStore) {
        window.xyStore(ns).remove('chat-tail');
        // default 桌面还兼容旧顶层键（contacts.js defaultStore 的读回退），一并清
        if (cid === 'default') window.xyStore('xy-home-v2').remove('chat-tail');
        return;
      }
      try { localStorage.removeItem(ns + ':chat-tail'); } catch (e) {}
      if (cid === 'default') { try { localStorage.removeItem('xy-home-v2:chat-tail'); } catch (e) {} }
    } catch (e) {}
  }
  function writeDeskChat(cid, arr) {
    const key = 'xy-home-v2:' + cid;
    clearDeskTail(cid);
    let seq = Promise.resolve();
    if (window.idbSet) {
      seq = seq.then(() => window.idbSet(key + ':chat-msgs', arr.length ? arr : JSON.stringify(arr || null)));
      seq = seq.then(() => window.idbSet(key + ':chat-meta', JSON.stringify({ n: arr.length, t: Date.now(), b: arrByteLen(arr) })));
    }
    try { localStorage.setItem(key + ':chat-msgs', JSON.stringify(arr)); } catch (e) {}
    try { localStorage.setItem(key + ':chat-meta', JSON.stringify({ n: arr.length, t: Date.now(), b: arrByteLen(arr) })); } catch (e) {}
    return seq;
  }
  function arrByteLen(arr) {
    try { let n = 0; for (let i = 0; i < arr.length; i++) { const m = arr[i]; if (m && typeof m === 'object') { const t = m.text; if (typeof t === 'string') n += t.length; const im = m.img; if (typeof im === 'string') n += im.length; const vc = m.voice; if (typeof vc === 'string') n += vc.length; n += 64; } else n += 32; } return n; } catch (e) { return 0; }
  }
  // v3.36.x：#471 设置页「导入全部桌面聊天记录」—— 读一份「聊天记录」（标准 mochi 备份文件，
  // 或本功能导出的 {app,msgs} 单桌文件），按下述规则恢复全部桌面记录：
  //   ① 标准备份文件（含 ls/idb 段）：只取聊天消息键——各桌面 chat-msgs（含旧顶层键
  //      xy-home-v2:chat-msgs，属默认桌面）与群聊键（group-chat-msgs / gc-msgs-<gid>），
  //      媒体池键（/^xy-home-v2:media:/）一并恢复静默（@@m: 令牌解码依赖池键）。
  //   ② 单桌 {app,msgs} / 裸数组文件：视为「当前桌面」，cs-import-all 语义下等同普通导入。
  // 与整体导入的区别：只动聊天键（含 meta 账本与媒体池），其余设置/字卡/音乐一律不碰，
  // 不会造成「导入全部桌面」清空或覆盖其他数据；各桌面聊天互相独立命名空间键，互不干扰。
  // 防 #90 账本守卫：恢复后按目标 cid 对齐 chat-meta 账本（先写 chat-msgs→再写 chat-meta），
  // 避免后续整包保存被账本拒绝。先预览各项计数再确认（支持取消）。
  // 写入顺序（避免把「导入后未刷新的当前桌面内存」与「落盘权威值」弄混）：
  //   - 非当前桌面：chat-msgs → chat-meta → LS 快照（chat.js 切桌时会重新权威读取）。
  //   - 当前桌面：走 window.chatImportMsgs()（同步更新内存/渲染/账本），再补写 LS 快照。
  //   - 群聊：走 group-chat.js 的 gcWriteGroupMsgs（lite 快照 + IDB 权威，当前群同步界面）。
  //   - 媒体池：静默写 IDB（@@m: 令牌解码），不写 LS（media-pool.js 只认 IDB）。
  // v3.36.x #582：入参化——传 File 直接处理（设置页「导入数据 → 仅聊天记录」与验证脚本共用），
  // 不传则弹本机文件选择器（原行为）。
  window.runChatAllImport = function (file) {
    if (file) { chatAllImportRead(file); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      chatAllImportRead(f);
    };
    input.click();
  };
  function chatAllImportRead(f) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(String(reader.result || '')); } catch (e) { toast('无效的聊天记录文件'); return; }
      if (!data || typeof data !== 'object') { toast('无效的聊天记录文件'); return; }
      // 各桌面 chat-msgs（含默认桌面旧顶层键 xy-home-v2:chat-msgs）
      const chatKeyRe = /^xy-home-v2:(?:chat-msgs|(?:default|c[0-9a-z]{5,}):chat-msgs)$/;
      const mediaKeyRe = /^xy-home-v2:media:/;
      // 提取规则：LS 段优先（导出的 ls 段里 chat-msgs 存的也是 IDB 权威值——见 runExport 的
      // 权威键路由），IDB 段兜底同键
      const lsObj = (data && typeof data.ls === 'object') ? data.ls : {};
      const idbObj = (data && typeof data.idb === 'object') ? data.idb : {};
      const pickRaw = (k) => {
        if (lsObj[k] !== undefined) return { v: lsObj[k], from: 'ls' };
        if (idbObj[k] !== undefined) return { v: idbObj[k], from: 'idb' };
        return null;
      };
      // ① 单桌 {app,msgs} / 裸数组：归到「当前桌面」（default）
      const allKeys = Object.keys(lsObj).concat(Object.keys(idbObj));
      let chatKeys = allKeys.filter(k => chatKeyRe.test(k));
      let groupKeys = allKeys.filter(k => GROUP_CHAT_KEY_RE.test(k));
      // ② 标准备份无「全部桌面」聊天键？——单桌文件无法按 key 路由，走当前桌面导入
      let singleMsgs = null;
      if (!chatKeys.length && !groupKeys.length) {
        if (Array.isArray(data)) singleMsgs = data;
        else if (data.msgs && Array.isArray(data.msgs)) singleMsgs = data.msgs;
        else if (data.ls && data.ls['xy-home-v2:chat-msgs'] !== undefined) {
          try { const raw = data.ls['xy-home-v2:chat-msgs']; singleMsgs = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { singleMsgs = null; }
        }
      }
      if (!chatKeys.length && !groupKeys.length && !Array.isArray(singleMsgs)) { toast('文件里没有可导入的聊天记录数据'); return; }
      // 预览：列出每个桌面/每个群的消息数与最早时间；媒体池键数
      const fmt = (t) => t ? new Date(t).toLocaleString() : '未知';
      const arrOf = (k) => {
        const raw = pickRaw(k);
        if (!raw) return [];
        try { const a = typeof raw.v === 'string' ? JSON.parse(raw.v) : raw.v; return Array.isArray(a) ? a : []; } catch (e) { return []; }
      };
      // 'xy-home-v2:chat-msgs'（旧顶层键）与 'xy-home-v2:default:chat-msgs' 都是默认桌面
      const cidOf = (k) => { const s = k.split(':'); return s.length <= 2 ? 'default' : (s[1] || 'default'); };
      const preview = [];
      if (chatKeys.length) {
        chatKeys.forEach(k => {
          const a = arrOf(k);
          const cid = cidOf(k);
          preview.push('· ' + (cid === 'default' ? '默认桌面' : cid) + '：' + a.length + ' 条' +
            (a.length ? '（最早 ' + fmt(a[0] && a[0].ts) + '）' : ''));
        });
      }
      groupKeys.forEach(k => {
        const a = arrOf(k);
        const gid = k === 'xy-home-v2:group-chat-msgs' ? 'default' : k.slice('xy-home-v2:gc-msgs-'.length);
        preview.push('· 群聊' + (gid === 'default' ? '（默认群）' : ' ' + gid) + '：' + a.length + ' 条' +
          (a.length ? '（最早 ' + fmt(a[0] && a[0].ts) + '）' : ''));
      });
      if (!chatKeys.length && !groupKeys.length) {
        preview.push('· 当前桌面（默认）：' + singleMsgs.length + ' 条' +
          (singleMsgs.length ? '（最早 ' + fmt(singleMsgs[0] && singleMsgs[0].ts) + '）' : ''));
      }
      const mediaKeys = allKeys.filter(k => mediaKeyRe.test(k));
      if (mediaKeys.length) preview.push('· 附带图片/语音 ' + mediaKeys.length + ' 项');
      preview.push('导入将覆盖对应桌面/群聊的全部聊天记录（不可恢复），其他数据不受影响。');
      if (!window.openModal) return;
      window.openModal('确认导入聊天记录？', '', () => {
        importChatAllGo(chatKeys, groupKeys, singleMsgs, mediaKeys, pickRaw);
      }, { noInput: true, staticText: preview.join('\n') });
    };
    reader.onerror = () => { toast('文件读取失败，请重试'); };
    reader.readAsText(f, 'utf-8');
  }
  // 按桌/按群分屏写回。chatKeys 为文件内各桌面 chat-msgs 键，groupKeys 为群聊消息键，
  // singleMsgs 为单桌文件的消息数组（此时两者皆空），mediaKeys 为附带媒体池键，
  // pickRaw(k) 按「LS 段优先、IDB 段兜底」取值。
  function importChatAllGo(chatKeys, groupKeys, singleMsgs, mediaKeys, pickRaw) {
    const cur = window.__activeCid || 'default';
    const writes = [];
    let totalN = 0;
    // 当前桌面：走 chatImportMsgs 同步更新内存/渲染/账本（语义与「导入聊天记录」一致）
    if (singleMsgs) {
      if (window.chatImportMsgs) window.chatImportMsgs(singleMsgs);
      totalN += singleMsgs.length;
    }
    chatKeys.forEach(k => {
      const raw = pickRaw(k);
      if (!raw || raw.v === undefined) return;
      let arr;
      try { arr = typeof raw.v === 'string' ? JSON.parse(raw.v) : raw.v; } catch (e) { return; }
      if (!Array.isArray(arr)) return;
      const s = k.split(':');
      const cid = s.length <= 2 ? 'default' : (s[1] || 'default');
      totalN += arr.length;
      if (cid === cur) {
        // 当前桌面：优先 chatImportMsgs 保持与「导入聊天记录」同语义
        if (window.chatImportMsgs) window.chatImportMsgs(arr);
      } else {
        writes.push({ kind: 'chat', cid: cid, arr: arr });
      }
    });
    groupKeys.forEach(k => {
      const raw = pickRaw(k);
      if (!raw || raw.v === undefined) return;
      let arr;
      try { arr = typeof raw.v === 'string' ? JSON.parse(raw.v) : raw.v; } catch (e) { return; }
      if (!Array.isArray(arr)) return;
      const gid = k === 'xy-home-v2:group-chat-msgs' ? 'default' : k.slice('xy-home-v2:gc-msgs-'.length);
      totalN += arr.length;
      writes.push({ kind: 'group', gid: gid, arr: arr });
    });
    let p = Promise.resolve();
    writes.forEach((w) => {
      if (w.kind === 'group') {
        // 群聊：group-chat.js 的写入通道（lite 快照 + IDB 权威；当前群同步内存/界面）
        p = p.then(() => { if (window.gcWriteGroupMsgs) return window.gcWriteGroupMsgs(w.gid, w.arr); });
      } else {
        p = p.then(() => writeDeskChat(w.cid, w.arr));
      }
    });
    // 媒体池：静默写 IDB
    mediaKeys.forEach(k => {
      const raw = pickRaw(k);
      if (!raw || raw.v === undefined) return;
      if (window.idbSet) {
        p = p.then(() => window.idbSet(k, raw.v));
      }
    });
    p.then(() => {
      toast('聊天记录已导入（' + totalN + ' 条，覆盖对应桌面/群聊）');
    }).catch((e) => {
      toast('导入失败：' + (e && e.message || '未知错误'));
    });
  }
  const exportRow = document.getElementById('row-export');
  if (exportRow) {
    exportRow.addEventListener('click', () => { window.runBackupExport(); });
  }
  const importRow = document.getElementById('row-import');
  if (importRow) {
    importRow.addEventListener('click', () => {
      // v3.36.x #582：导入前先选范围——原来这一行只能整包导入（会覆盖设置/字卡/音乐等全部数据），
      // 「只拿回聊天记录」没有入口（用户反馈「导入数据缺少可选」）。而「仅聊天记录」这条路
      // 只写聊天消息键 + 群聊键 + 消息引用的图片，其余数据一律不碰。
      if (!window.openModal) { pickImportFile(); return; }
      window.openModal('选择导入范围', '', (v) => {
        if (v === 'chat') { window.runChatAllImport(); return; }
        if (v === 'cancel') { toast('已取消导入'); return; }
        pickImportFile();
      }, {
        noInput: true, okText: '开始导入', pill: 'full', lock: true,
        pills: [{ label: '完整备份（全部数据）', value: 'full' },
          { label: '仅聊天记录（全部桌面联系人）', value: 'chat' },
          { label: '取消', value: 'cancel' }],
        staticText: '完整备份：按备份文件恢复全部数据（会覆盖本机现有数据，含设置 / 字卡 / 朋友圈 / 音乐等）。\n' +
          '仅聊天记录：只恢复备份里的聊天记录——全部桌面联系人（含默认桌面）与群聊，' +
          '消息里引用到的图片/语音一并恢复；设置、字卡、朋友圈、音乐一律不动。\n' +
          '两种都能读「导出数据」产生的备份文件；仅聊天记录还会识别单桌导出的聊天文件。'
      });
    });
  }
  // 整包导入：文件选择器（v3.9.x 起沿用原实现）
  function pickImportFile() {
    // v3.9.x：修复真我手机 Edge 文件选择器不弹出——动态创建的 file input 必须
    // 先挂载到 DOM 再 click()（未挂载 / display:none 时部分 Android 浏览器会静默忽略
    // 合成点击，改 position:fixed 移出屏幕而非 display:none 最稳）；
    // 不设 accept 过滤——部分国产 ROM 文件选择器对 accept 过滤有兼容 bug，
    // 选错文件会在导入时被校验提示「不是 mochi 导出的数据文件」
    const input = document.createElement('input');
    input.type = 'file';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '0';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.onchange = () => {
      const f = input.files && input.files[0];
      try { input.remove(); } catch (e) {}
      if (f) doImport(f);
    };
    input.click();
    // 兜底：用户一直不选文件时清理隐藏 input（onchange 触发后已 remove，仅防泄漏）
    setTimeout(() => { try { if (input.parentNode) input.remove(); } catch (e) {} }, 120000);
  }
})();
