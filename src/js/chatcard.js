// ===== 功能：自定义聊天字卡（分类 + 分组筛选 + 批量导入 + 图片导入） =====
// 内置分组按 7 分类预置；可新建分组、按【分组名】批量导入文字字卡；
// 【表情包】【图片】分类支持直接上传图片表情（存 dataURL）；
// 分组内的字卡会作为联系人自动回复的素材池
(function () {
  const list = document.getElementById('cc-list');
  const tabsWrap = document.getElementById('cc-tabs');
  const groupsBar = document.getElementById('cc-groups-bar');
  if (!list || !tabsWrap) return;

  const uid = window.activePrefix();
  const store = window.activeStore();

  // ================= v3.11.x：字卡双作用域（公用 / 专属） =================
  // 公用字卡：全局根命名空间键 xy-home-v2:cc-groups-public——以后每个桌面的联系人都能使用；
  // 专属字卡：各联系人命名空间键 xy-home-v2:<cid>:cc-groups（原 cc-groups，语义不变）——
  //           只有当前桌面绑定的联系人才能使用。
  // 管理页打开时由入口决定写哪个作用域；聊天/朋友圈/信箱等回复池一律取「公用+专属」合并。
  const PUB_PREFIX = 'xy-home-v2';
  const PUB_KEY = 'cc-groups-public';
  let ccScope = 'own'; // 当前管理页打开的作用域：'own'=专属 | 'public'=公用
  function pubStore() { return window.xyStore(PUB_PREFIX); }
  function curStore() { return ccScope === 'public' ? pubStore() : store; }
  function curKey() { return ccScope === 'public' ? PUB_KEY : 'cc-groups'; }
  // ================= v3.30.x：分组停用开关（公用 / 专属各自独立） =================
  // 需求：可在字卡库管理页关闭某个分组的「使用」——关闭后该分组不再进入任何自动
  // 回复池（聊天自动回复/拍一拍/表情包/语音/朋友圈/信箱/群聊/TA主动分享等），
  // 字卡本身保留在库中（管理页仍完整显示、可编辑/删除），随时可重新开启。
  // 存储与字卡键同构分作用域：公用 xy-home-v2:cc-groups-public-off（全局根键，
  // 已登记 contacts.js EXCLUDE 防 migrateLegacy 迁走）/ 专属 <cid>:cc-groups-off；
  // 格式 { 分类: [分组名, ...] }——同名分组按分类区分，停用专属某分组不影响公用同名分组。
  const PUB_OFF_KEY = 'cc-groups-public-off';
  const OFF_KEY = 'cc-groups-off';
  let offCache = null; // 当前桌面专属停用集合缓存（切联系人失效）
  let pubOffCache = null; // 公用停用集合缓存
  function offStore(scope) { return scope === 'public' ? pubStore() : store; }
  function offKey(scope) { return scope === 'public' ? PUB_OFF_KEY : OFF_KEY; }
  function offLoad(scope) {
    const c = scope === 'public' ? pubOffCache : offCache;
    if (c) return c;
    let o = {};
    try {
      const v = offStore(scope).get(offKey(scope));
      if (v) { const p = JSON.parse(v); if (p && typeof p === 'object') o = p; }
    } catch (e) {}
    if (scope === 'public') pubOffCache = o; else offCache = o;
    return o;
  }
  function offSave(scope, o) {
    try { offStore(scope).set(offKey(scope), JSON.stringify(o)); } catch (e) {}
    if (scope === 'public') pubOffCache = o; else offCache = o;
  }
  function offInvalidate() { offCache = null; pubOffCache = null; }
  function isGroupOff(scope, type, gname) {
    try { const o = offLoad(scope); return !!(o[type] && o[type].indexOf(gname) >= 0); } catch (e) { return false; }
  }
  // 管理页切换某分组的停用状态（按当前打开作用域），返回切换后是否停用
  function toggleGroupOff(type, gname) {
    const scope = ccScope === 'public' ? 'public' : 'own';
    const o = offLoad(scope);
    if (!o[type] || !Array.isArray(o[type])) o[type] = [];
    const i = o[type].indexOf(gname);
    const nowOff = i < 0;
    if (nowOff) o[type].push(gname); else o[type].splice(i, 1);
    if (!o[type].length) delete o[type];
    offSave(scope, o);
    return nowOff;
  }
  // 剔除某作用域字卡分组中被停用的分组（返回新对象，不修改入参；无停用记录时原样返回）
  function filterGroupsByOff(g, scope) {
    try {
      const o = offLoad(scope);
      let has = false;
      for (const t in o) { if ((o[t] || []).length) { has = true; break; } }
      if (!has) return g;
      const out = {};
      Object.keys(g).forEach(t => {
        const offs = o[t] || [];
        out[t] = (g[t] || []).filter(grp => offs.indexOf(grp[0]) < 0);
      });
      return out;
    } catch (e) { return g; }
  }
  // 解析公用键（带缓存：回复池每次发消息都会取合并池，不能反复 JSON.parse 大库）
  let pubCache = null;
  // v3.42.x #455：pubInvalidate 同时失效专属库池视图（ownPoolCache）——两把键的派生
  // 缓存生命周期完全同拍（写库/取回/切桌面/进管理页都要一起重算），收口在这一个入口，
  // 各既有调用点零改动即获得专属侧失效。
  function pubInvalidate() { pubCache = null; ownPoolCache = null; }
  // v3.26.x #377 巨型公用库内存瘦身（修 iOS 独立 PWA「用一会自动退回开屏」OOM 家族）：
  // 重度用户公用库单键可达 45~189MB（贴纸/图片卡整份 dataURL），pubGroupsRaw 解析出的
  // pubCache 连同原始串双份常驻（tmp-pool-mem 实测：179MB 种子→进桌面 371MB→开聊天
  // 730MB 且永不回落），iOS WebKit 渲染进程被 jetsam 杀掉＝整页重载回开屏。
  // 这里在缓存构建后对超大媒体卡做【内存内】令牌化：卡体换成 @@m:hash 令牌（内容寻址，
  // 池键落 IDB 由 media-pool 托管、渲染/发送端令牌链路 #142/#283 已全通），原始库键
  // 一个字节不动（字卡库页面/备份/编辑仍读写原始 dataURL，零数据风险）。
  // · 只动 sticker/image 两类、单卡体 >64KB 的卡——小卡保持原文（朋友圈 onlyData 等
  //   只认 data: 的消费端对小卡行为零变化，见 FIX-REGRESSION #373 说明）；
  // · noCache:true=池命中/新写都不进 media-pool map 热缓存（否则令牌化省下的内存被
  //   map 原样吃回），渲染时走 resolveImg 懒解析按需驻留；
  // · 身份守卫：异步落令牌回写前核对卡原文未变（编辑/失效竞态不覆盖新内容）；
  // · 每次会话重做（哈希内容寻址幂等）：池键若被 GC 清理，下次构建时重新落池即可。
  const CC_MEDIA_TOKEN_THRESHOLD = 64 * 1024;
  // FIX 2026-09-13 #398 令牌化管线串行化 + 会话哈希备忘（iPhone 14 Pro/16 Safari「持续卡顿动不了」
  // 等多机型；与「最近两三天」起病时间吻合＝#377 上线）——旧实现对每张大卡并发发起
  // mochiMediaTokenize（每张都 TextEncoder 全量编码 + SHA-256），大库一建缓存就是几百个编码
  // 任务同挤主线程＝持续卡死；且每次缓存重建（切联系人/写库 pubInvalidate）都全量重算。
  // 改为：①收集任务后串行执行、每张之间 setTimeout(0) 让出主线程（总时长不变但 UI 可交互）；
  // ②会话内 body→token 备忘（FIFO 字符预算淘汰，上限 8M 字符≈16MB，不破坏 #377 瘦身目标），
  // 重复构建零重算；③世代计数——pubInvalidate 重建后旧 pass 自动作废，memo 让重跑便宜。
  let ccTokRun = 0;
  // v3.42.x #455：世代计数分槽（pub/own 各自独立）——原单计数器下任一库的缓存重建都会
  // 作废另一库在飞的令牌化 pass；#455 把 ownPoolCache 纳入 pubInvalidate 同拍失效后，
  // 「own 空库重建也 bump 世代」会把公用库令牌化 pass 永远卡死（verify-giant-pool-tokenize
  // 实测 bigTok=0）。分槽后各库重建只作废各自在飞的 pass；零任务调用不再 bump（空库重建无害）。
  const ccTokGen = { pub: 0, own: 0 };
  const ccTokMemo = new Map();
  let ccTokMemoChars = 0;
  const CC_TOK_MEMO_MAX_CHARS = 8 * 1024 * 1024;
  // FIX 2026-09-16 #547 表情面板每次打开图片重载复发（多机型同发，#457 短路被令牌化翻转账废掉）：
  // 面板签名（chat.js emojiRenderSigTarget）按卡原文算——池视图被本函数异步令牌化后（dataURL→@@m:token），
  // 同一张卡签名变了 → 下次开面板被误判「内容变化」→ 整面板 innerHTML 重建 + 全部图走媒体池重新解析
  // ＝用户视角「每次打开表情包都重新加载一遍」。大库令牌化 pass 要跑数秒，期间每次开面板都撞上翻转。
  // 修法＝身份与令牌化解耦：ccTokMemoRev 登记(token→内容短指纹)，ccMediaCardIdent 对
  // 「原始大图卡」与「已令牌化卡」算出同一个身份串；memo 有预算会淘汰，rev 不淘汰
  //（token 内容寻址永不变，每条几十字符，量级=贴纸张数×50B）。
  const ccTokMemoRev = new Map();
  function ccMediaFrag(body) { return 'M' + body.length + ':' + body.slice(8, 48); }
  function ccTokenizeGiantMedia(g, slot) {
    if (!window.mochiMediaTokenize) return;
    const jobs = [];
    ['sticker', 'image'].forEach(function (t) {
      (g[t] || []).forEach(function (grp) {
        if (!Array.isArray(grp) || !Array.isArray(grp[1])) return;
        grp[1].forEach(function (card, i) {
          if (typeof card !== 'string' || card.indexOf('@@m:') >= 0) return;
          const bar = card.indexOf('|||');
          const body = bar >= 0 ? card.slice(bar + 3) : card;
          if (body.length < CC_MEDIA_TOKEN_THRESHOLD || body.indexOf('data:image/') !== 0) return;
          jobs.push({ grp: grp, i: i, card: card, bar: bar, body: body });
        });
      });
    });
    if (!jobs.length) return;
    const sl = slot === 'own' ? 'own' : 'pub';
    const gen = ++ccTokGen[sl];
    (async function () {
      for (let k = 0; k < jobs.length; k++) {
        if (gen !== ccTokGen[sl]) return; // 本库缓存已重建/失效，本次 pass 作废（memo 让重跑便宜）
        const j = jobs[k];
        let tok = ccTokMemo.get(j.body);
        if (!tok) {
          try { tok = await window.mochiMediaTokenize(j.body, { noCache: true }); } catch (e) { tok = null; }
          if (gen !== ccTokGen[sl]) return;
          if (tok) {
            ccTokMemo.set(j.body, tok); ccTokMemoChars += j.body.length;
            ccTokMemoRev.set(tok, ccMediaFrag(j.body)); // #547：token→短指纹，供 ccMediaCardIdent 令牌化前后同身份
            while (ccTokMemoChars > CC_TOK_MEMO_MAX_CHARS && ccTokMemo.size) {
              const fk = ccTokMemo.keys().next().value;
              ccTokMemoChars -= fk.length; ccTokMemo.delete(fk);
            }
          }
        }
        await new Promise(function (r) { setTimeout(r, 0); }); // 每张之间让出主线程，UI 可交互
        if (gen !== ccTokGen[sl]) return;
        if (!tok || j.grp[1][j.i] !== j.card) continue; // 身份守卫：卡原文已变则不覆盖
        j.grp[1][j.i] = j.bar >= 0 ? (j.card.slice(0, j.bar + 3) + tok) : tok;
      }
    })();
  }
  function pubGroupsRaw() {
    if (!pubCache) {
      pubCache = buildGroupsFrom(pubStore().get(PUB_KEY));
      // v3.14.x：公用库同样过语音坏数据体检（回复池/搜索都走这份缓存，入口唯一）
      const _vhp = sanitizeVoiceGroups(pubCache);
      if (_vhp.fixed || _vhp.removed) {
        try { pubStore().set(PUB_KEY, JSON.stringify(pubCache)); } catch (e) {}
        notifyVoiceHeal(_vhp.fixed, _vhp.removed);
      }
      ccTokenizeGiantMedia(pubCache, 'pub');
    }
    return pubCache;
  }
  // v3.42.x #455 专属库同款内存瘦身（#377 公用库 OOM 家族的专属库面——iPhone 15 Pro Max
  // via 等多机型「左右滑动卡 + 总是自动刷新重进」；诊断实锤 default:cc-groups 单键 153MB）：
  // 专属库此前只有 ownGroupsRaw() 裸 parse——每次调用全量 JSON.parse 且解析副本（772 张
  // 贴纸 dataURL 原文）不令牌化、随 groups/计数路径反复重建，raw 串 + 解析树双份常驻
  // 数百 MB＝iOS WebKit 渲染进程被 jetsam 杀掉＝整页自动重载。这里对齐 pubGroupsRaw 口径：
  // 池视图带缓存 + 构建后内存内令牌化（只动 sticker/image >64KB 的卡体，原始库键一字节
  // 不动，写回/备份/编辑仍读写原文，零数据风险）；回复池/面板/角标/搜索全部走本视图。
  // 原子失效收口在 pubInvalidate（两把键的派生缓存同拍重建）。
  let ownPoolCache = null;
  function ownPoolRaw() {
    if (!ownPoolCache) {
      ownPoolCache = buildGroupsFrom(store.get('cc-groups'));
      ccTokenizeGiantMedia(ownPoolCache, 'own');
    }
    return ownPoolCache;
  }
  // 合并视图：当前作用域字卡 + 公用字卡（同分类分组拼接；只读，供回复池/搜索用）
  const CC_TYPES = ['text', 'kaomoji', 'emoji', 'sticker', 'image', 'poke', 'voice'];
  // v3.32.x：其他互动功能字卡（自定义）——与系统预设【其他互动功能字卡】同 13 个功能分类。
  // 存本作用域 cc-groups 的同名字段（公用库/专属库双作用域与分组停用开关全部沿用），
  // 管理页（page-custom-cards）功能分类 tab 可查看/编辑/删除，各功能经 default-cards.js
  // getLibPool 并入对应功能池抽取；CC_FUNC_KEYS 不进聊天通用回复池（getCustomCards*
  // 遍历全部分类时排除，防止功能字卡被聊天自动回复误抽）。
  const CC_FUNC_KEYS = ['fish', 'eat', 'period', 'water', 'garden', 'sync', 'reach', 'cjian', 'room', 'piggy', 'drift', 'interact', 'music',
    'mjfree']; // #317 梦角自由造句：程序生成的重造句卡（dream-free.js），管理页可查看/删除，不进聊天通用池
  const CC_ALL_TYPES = CC_TYPES.concat(CC_FUNC_KEYS);
  // v3.26.x #139：GIF 动图上传大小上限（base64 长度）——GIF canvas 压缩会丢
  // 动画只能直存原图，此前无上限，几 MB~几十 MB 的动图整份进库是字卡库膨胀大头之一。
  // #160：4MB base64（≈3MB 文件）仍太大——用户库堆到 40MB/22MB（双作用域合计 62.8MB），
  // 每次保存/读取对整库 JSON.stringify/parse 在 iOS WebKit 上是秒级长任务=卡死根因，
  // 砍到 512KB base64（≈380KB 文件）守住单卡体积；已有大 GIF 靠用户手动清理（先备份）。
  const CC_GIF_MAX_B64 = 512 * 1024;
  // FIX 2026-09-16 #554（TASKS #128）字卡图令牌化最小体积（base64 字符数，≈3KB 图）：
  // 再小的是图标/占位，令牌化收益不抵池条目与异步解析开销；≥此值的上传与存量迁移都走
  // 媒体池令牌（mochiMediaTokenize 自身另有 ≥1024 硬门，此处收紧到 4096）。
  const CC_CC_TOK_MIN = 4096;
  function mergeWithPublic(g) {
    const p = pubGroupsRaw();
    let has = false;
    for (let i = 0; i < CC_ALL_TYPES.length; i++) { if ((p[CC_ALL_TYPES[i]] || []).length) { has = true; break; } }
    if (!has) return g;
    const out = {};
    CC_ALL_TYPES.forEach(t => { out[t] = (g[t] || []).concat(p[t] || []); });
    Object.keys(g).forEach(t => { if (!(t in out)) out[t] = g[t]; });
    return out;
  }
  // v3.30.x：回复池专用合并视图——专属/公用各自先剔除被停用分组再拼接。
  // 不能直接在 mergeWithPublic 里过滤：它还被搜索/导出等管理视角使用（应看全部）；
  // 分作用域过滤保证同名分组互不影响（停用专属「日常」不影响公用「日常」）。
  function mergeFiltered(own, pub) {
    const ownF = filterGroupsByOff(own, 'own');
    const pubF = filterGroupsByOff(pub, 'public');
    let hasPub = false;
    for (let i = 0; i < CC_ALL_TYPES.length; i++) { if ((pubF[CC_ALL_TYPES[i]] || []).length) { hasPub = true; break; } }
    if (!hasPub) return ownF;
    const out = {};
    CC_ALL_TYPES.forEach(t => { out[t] = (ownF[t] || []).concat(pubF[t] || []); });
    Object.keys(ownF).forEach(t => { if (!(t in out)) out[t] = ownF[t]; });
    return out;
  }
  // 当前桌面回复池合并视图（供 getCustomCards/getPokeCards/getMediaCards 等使用）
  // v3.42.x #455：专属侧从「编辑树 groups（未令牌化、含全部 dataURL）」改为令牌化池视图
  // ownPoolRaw()——回复池只读不编辑，不需要 dataURL 原文；令牌卡由 #142/#283/#383 渲染/
  // 发送/文字池守卫全链路承接（公用侧 #377 起即如此，池内容早已混有令牌卡）。
  function replyPoolGroups() { return mergeFiltered(ownPoolRaw(), pubGroupsRaw()); }
  // 指定联系人(cid)的回复池合并视图（朋友圈/群聊按联系人取池）
  function replyPoolGroupsFor(cid) {
    const raw = (window.storeFor && window.storeFor(cid) || window.xyStore('xy-home-v2:' + cid)).get('cc-groups');
    return mergeFiltered(buildGroupsFrom(raw), pubGroupsRaw());
  }

  // 内置分组数据（key: 类型 -> [分组名, 字卡数组]）
  // v3.6.x：不再向用户提供系统内置预设字卡——这里仅作为「清理旧数据」的依据：
  //   老版本用户已存的这些内置字卡会被剔除（loadGroups → stripBuiltins），
  //   只保留用户自己添加的字卡；全新用户打开是空字卡库
  const BUILTIN = {
    text: [
      ['日常回应', ['哈哈哈哈哈', '好的好的，收到', '嗯嗯，我在听', '笑死我了', '我支持你', '今天也要开心呀', '没事的，别担心', '想你了']],
      ['晚安问候', ['晚安，做个好梦', '早点休息呀', '明天见啦', '睡个好觉']]
    ],
    kaomoji: [
      ['开心', ['(｡♥‿♥｡)', '(◕‿◕)', '(￣▽￣)~*', 'ᕙ(⇀‸↼‶)ᕗ']],
      ['日常', ['(¬‿¬)', '( ´･･)ﾉ(._.`)', '(ಥ_ಥ)', '(⊙_☉)', '(づ｡◕‿‿◕｡)づ']]
    ],
    emoji: [
      ['常用', ['😂', '🥰', '😭', '😡', '😳', '🤔', '😴', '🤗', '😘', '🙄']]
    ],
    sticker: [],
    image: [],
    poke: [
      ['互动', ['戳一戳', '拍了拍你', '戳了戳你的脸蛋']]
    ],
    voice: []
  };
  const MEDIA_TYPES = { sticker: '表情包', image: '图片', voice: '语音' };
  // v3.8.x：补正音频 dataURL 的 MIME。安卓部分浏览器/文件管理器（如雨见）返回的音频
  // File.type 为空，readAsDataURL 会产出 data:;base64,（空 MIME）——空 MIME 既无法被
  // new Audio() 播放，也不满足全站 data:audio 判定，会被整段 base64 当文字存下发进聊天
  // 变成乱码。这里统一按文件名扩展名推导音频 MIME 归一化。
  function audioMimeFromName(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    const map = {
      mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4',
      ogg: 'audio/ogg', ogx: 'application/ogg', aac: 'audio/aac', amr: 'audio/amr',
      flac: 'audio/flac', webm: 'audio/webm', opus: 'audio/ogg', caf: 'audio/x-caf'
    };
    return map[ext] || '';
  }
  function normalizeAudioDataURL(dataURL, file) {
    if (!dataURL) return dataURL;
    const m = /^data:([^;,]*);/.exec(dataURL);
    const mime = m ? m[1] : '';
    if (mime && mime.indexOf('audio/') === 0) return dataURL; // 已是有效音频 MIME
    // MIME 缺失或非音频（如 data:;base64,）：剥掉前缀取 base64 载荷，用扩展名 MIME 重拼
    const comma = dataURL.indexOf(',');
    const payload = comma >= 0 ? dataURL.slice(comma + 1) : dataURL;
    const extMime = audioMimeFromName(file && file.name) || (file && file.type) || 'audio/mpeg';
    return 'data:' + extMime + ';base64,' + payload;
  }
  const IMG_TYPES = MEDIA_TYPES;

  // v3.8.x：iOS Safari 下未挂到 DOM 的 <input type=file>.click() 不会弹出选择器，
  // 必须先 appendChild 到 body。这里统一封装：建隐藏 input → 挂 body → 点击 → 回调后清理。
  function pickFiles(accept, multiple, onFiles) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = !!multiple;
    input.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(input);
    input.onchange = () => {
      const files = Array.prototype.slice.call(input.files || []);
      input.value = ''; // 允许重选同一文件
      try { input.remove(); } catch (e) {}
      if (onFiles) onFiles(files);
    };
    // 取消选择（change 不触发）时也清理，避免残留
    input.onblur = () => {
      setTimeout(() => { try { if (input.parentNode) input.remove(); } catch (e) {} }, 1500);
    };
    try { input.click(); } catch (e) { try { input.remove(); } catch (e2) {} }
  }

  // v3.6.x：剔除系统内置预设字卡（BUILTIN 同分组同内容）与空分组，只保留用户添加的字卡；
  // 返回是否发生了删除（供调用方决定是否写回）
  function stripBuiltins(groups) {
    let changed = false;
    Object.keys(BUILTIN).forEach(cat => {
      const gs = groups[cat];
      if (!Array.isArray(gs)) return;
      BUILTIN[cat].forEach(([gname, arr]) => {
        const g = gs.find(x => x[0] === gname);
        if (!g || !Array.isArray(g[1])) return;
        const before = g[1].length;
        g[1] = g[1].filter(c => arr.indexOf(c) < 0);
        if (g[1].length !== before) changed = true;
      });
      // 删掉因此变空的分组
      const before = gs.length;
      groups[cat] = gs.filter(g => Array.isArray(g[1]) && g[1].length);
      if (groups[cat].length !== before) changed = true;
    });
    return changed;
  }

  // v3.14.x：语音坏数据自愈——历史版本曾把视频/空 MIME 数据当语音存进库
  //（安卓文件管理器忽略 accept 过滤 + 按扩展名硬推 MIME），这类条目播放必然
  // 空白/报错，还会把整个字卡库撑成几十 MB（低端机点开语音页整页冻结的主诱因）。
  // 加载时统一体检：只看条目前缀不整串扫描（大库也不卡）；空 MIME 但扩展名可
  // 识别的补上正确 MIME（救回数据），视频/图片/无法识别的直接剔除并提示一次。
  const AUDIO_EXT_MIME = {
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
    ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac',
    amr: 'audio/amr', wma: 'audio/x-ms-wma', mid: 'audio/midi', midi: 'audio/midi',
    weba: 'audio/webm', caf: 'audio/x-caf'
  };
  let voiceHealToasted = false;
  function notifyVoiceHeal(fixed, removed) {
    if (voiceHealToasted || (!fixed && !removed)) return;
    voiceHealToasted = true;
    const msg = [];
    if (fixed) msg.push('修复 ' + fixed + ' 条语音格式');
    if (removed) msg.push('清理 ' + removed + ' 条无法播放的视频/坏语音');
    try { toast('已自动' + msg.join('，')); } catch (e) {}
  }
  function sanitizeVoiceGroups(groups) {
    let fixed = 0, removed = 0;
    const gs = groups && Array.isArray(groups.voice) ? groups.voice : [];
    gs.forEach(g => {
      if (!Array.isArray(g) || !Array.isArray(g[1])) return;
      // 用 forEach 构建新数组——Array.filter 按规范在调用回调【前】取值，回调内
      // 改写当前下标不会进入结果数组（抢救重写会静默失效）
      const kept = [];
      g[1].forEach(c => {
        if (typeof c !== 'string') { kept.push(c); return; }
        const sep = c.indexOf('|||');
        if (sep <= 0) { kept.push(c); return; } // 非语音格式（普通文字含 ||| 的不算）
        const name = c.slice(0, sep);
        let d = c.slice(sep + 3);
        // 渲染层口径：||| 之后不是 dataURL 的条目按「普通文字卡」展示——不是坏语音，
        // 保留不动（用户含 ||| 的文字字卡在这里，删了就是丢数据）
        if (d.indexOf('data:') !== 0) { kept.push(c); return; }
        const m = /^data:([^,;]*)/.exec(d);
        const mime = m ? m[1] : '';
        if (mime.indexOf('audio/') === 0) { kept.push(c); return; } // 健康
        if (mime === '') {
          // 空 MIME：能按文件名扩展抢救就重写前缀，救不回才剔除
          const ext = (name.split('.').pop() || '').toLowerCase();
          const good = AUDIO_EXT_MIME[ext];
          if (good) {
            kept.push(name + '|||' + 'data:' + good + d.slice(5));
            fixed++;
            return;
          }
        }
        removed++; // video/*、image/*、未知类型——播放空白/报错的元凶
      });
      g[1] = kept;
    });
    return { fixed, removed };
  }

  // 读取全部分组：{ 类型: [ [分组名, [字卡...]], ... ] }
  // v3.11.x：按当前作用域读——公用页读全局键 cc-groups-public，专属页读本联系人 cc-groups
  function loadGroups() {
    try {
      const saved = JSON.parse(curStore().get(curKey()) || 'null');
      if (saved && saved.text) {
        // 迁移：删除旧版语音占位（语音1/语音2）
        if (saved.voice) {
          let changed = false;
          saved.voice.forEach(g => {
            if (!Array.isArray(g) || !Array.isArray(g[1])) return;
            const before = g[1].length;
            g[1] = g[1].filter(c => c !== '语音1' && c !== '语音2');
            if (g[1].length !== before) changed = true;
          });
          saved.voice = saved.voice.filter(g => Array.isArray(g) && Array.isArray(g[1]) && g[1].length);
          if (changed) { try { curStore().set(curKey(), JSON.stringify(saved)); } catch (e) {} }
        }
        // v3.6.x：剔除旧版内置预设字卡（只保留用户添加的）
        if (stripBuiltins(saved)) { try { curStore().set(curKey(), JSON.stringify(saved)); } catch (e) {} }
        // v3.14.x：语音坏数据体检（视频/空 MIME 自愈或剔除，见 sanitizeVoiceGroups）
        const _vh = sanitizeVoiceGroups(saved);
        if (_vh.fixed || _vh.removed) {
          try { curStore().set(curKey(), JSON.stringify(saved)); } catch (e) {}
          notifyVoiceHeal(_vh.fixed, _vh.removed);
        }
        return saved;
      }
    } catch (e) {}
    // v3.6.x：不再自动生成系统内置预设字卡，全新用户打开是空字卡库
    return { text: [], kaomoji: [], emoji: [], sticker: [], image: [], poke: [], voice: [] };
  }
  // 初始化：从 IndexedDB 恢复字卡数据（权威持久库）
  // localStorage 可能因配额写失败而停留在旧数据；只要 IDB 数据【内容更多】就用 IDB 覆盖，
  // 避免新增的表情包分组/内容因 localStorage 配额问题"消失"。
  // （不采用"不一致即覆盖"：若 idbSet 偶尔失败而 localStorage 已写入最新，覆盖会反向丢数据）
  // v3.11.x：双作用域各恢复各的——专属键 xy-home-v2:<cid>:cc-groups + 公用键
  // xy-home-v2:cc-groups-public。只有与当前打开作用域一致的键才刷新内存 groups 与界面；
  // 另一个键只更新字卡库列表页角标。ownRestoreP 在专属键恢复尝试落定（成功/键不存在/
  // 重试耗尽）后 resolve，供存量归属迁移协调时序（防止迁移读到尚未恢复的空库）。
  let ownRestoreResolve = null;
  const ownRestoreP = new Promise(res => { ownRestoreResolve = res; });
  (function () {
    if (!window.idbGet) { ownRestoreResolve(); return; }
    const myPrefix = window.activePrefix();
    // v3.9.x：OPPO Chrome 等慢 IDB 浏览器首次打开可能失败/超时，原实现读到
    // undefined 直接放弃且永不重试——大键字卡库（表情包/图片 dataURL 只进 IDB）
    // 启动时读不到就显示空库（用户反馈「表情包丢失」）。改为失败后延迟重试，
    // 直到读到数据或 3 次用尽；读到后按「IDB 内容更多才覆盖」恢复。
    const MAX_RETRY = 3;
    const cardCount = (g) => {
      let n = 0;
      try { Object.keys(g).forEach(t => (g[t] || []).forEach(x => n += (Array.isArray(x[1]) ? x[1].length : 0))); } catch (e) {}
      return n;
    };
    function applyRestored(lsKey, st, data) {
      stripBuiltins(data);
      st.set(lsKey, JSON.stringify(data));
      pubInvalidate();
      ccAuthMark(lsKey === PUB_KEY ? 'public' : 'own'); // v3.26.x #193：权威库已进内存，写路径放行
      // 只刷新与当前作用域一致的管理页视图；另一作用域只更新列表页角标
      if (lsKey === 'cc-groups' && ccScope === 'own' && window.activePrefix() === myPrefix) {
        groups = data;
        try { renderGroupsBar(); render(); } catch (e) {}
      } else if (lsKey === PUB_KEY && ccScope === 'public') {
        groups = data;
        try { renderGroupsBar(); render(); } catch (e) {}
      } else if (lsKey === 'cc-groups' && window.activePrefix() !== myPrefix) {
        // 恢复期间已切走联系人：数据写进新命名空间快照即可，不动界面（contact-switched 会重载）
      }
      refreshLibCounts(true);
    }
    function attempt(idbFullKey, lsKey, st, isOwn, state) {
      window.idbGet(idbFullKey).then(v => {
        if (isOwn && window.activePrefix() !== myPrefix) { ownRestoreResolve(); return; }
        if (v === undefined || v === null) {
          if (state.retry < MAX_RETRY) { state.retry++; setTimeout(() => attempt(idbFullKey, lsKey, st, isOwn, state), 800 * state.retry); return; }
          if (isOwn) ownRestoreResolve();
          return;
        }
        // v3.14.x：挂起复核（放在 JSON.parse 之前）——该键已进入回填预算挂起名单
        // （__xyIdbDeferredKeys，几十 MB 字卡库在低内存设备会被 idbRestore 挂起）时，
        // 不在启动链路读入内存解析/写回，留给用户打开字卡库时的 openCcPage→
        // idbHydrateKey 按需取回。否则这条无差别全量读会抢在预算系统前面把大库
        // 拉进堆（低端机点开就冻结/崩溃的残留源）。
        let deferredNow = false;
        try { deferredNow = Array.isArray(window.__xyIdbDeferredKeys) && window.__xyIdbDeferredKeys.indexOf(idbFullKey) >= 0; } catch (e0) {}
        if (deferredNow) { if (isOwn) ownRestoreResolve(); return; }
        try {
          const data = typeof v === 'string' ? JSON.parse(v) : v;
          if (data && data.text) {
            // v3.26.x #193：IDB 读到了权威库（无论是否覆盖内存），本会话已见过权威数据
            if (idbFullKey === curFullKey()) ccAuthMark();
            let localData = null;
            try { localData = JSON.parse(st.get(lsKey) || 'null'); } catch (e) {}
            const localCount = localData && localData.text ? cardCount(localData) : -1;
            if (localCount < 0 || cardCount(data) > localCount) applyRestored(lsKey, st, data);
          }
        } catch (e) {}
        if (isOwn) ownRestoreResolve();
      }).catch(() => { if (isOwn) ownRestoreResolve(); });
    }
    // v3.14.x：恢复尝试延迟到启动回填落定之后——__xyIdbDeferredKeys 名单由 idbRestore
    // 在处理各键的过程中逐步登记，脚本加载期立即 attempt 时名单还是空的，挂起复核
    // 形同虚设。等 mochi-restore-done（或已就绪）再发起，名单即最终态。
    function kick() {
      attempt(myPrefix + ':cc-groups', 'cc-groups', store, true, { retry: 0 });
      attempt(PUB_PREFIX + ':' + PUB_KEY, PUB_KEY, pubStore(), false, { retry: 0 });
    }
    if (window.__mochiDataReady) kick();
    else {
      try {
        document.addEventListener('mochi-restore-done', function h() {
          document.removeEventListener('mochi-restore-done', h);
          setTimeout(kick, 0);
        });
      } catch (e) { kick(); }
    }
  })();
  // v3.26.x #193：防覆盖守卫——本会话尚未确认「权威库已取回进内存」的作用域集合。
  // 大库（几十 MB 公用库）被启动回填挂起在 IDB / openCcPage 的 hydrateCurScope 未落定 /
  // 回填链被 iOS 挂后台打断读空时，内存 groups 只是空库或残缺快照，此时任何写路径
  // （批量导入/上传图片/编辑/删除，全走 scheduleSave→saveGroups）整包写回都会把权威键
  // 里的旧字卡覆盖没（iPhone 17 Pro Safari 实测：公用库 17.67MB，一次性批量导入文字卡
  // 后旧字卡全部消失）。#139 防复制守卫只护 JSON 文件导入，此处是全写路径收口。
  const ccAuthSeen = { public: false, own: false };
  function ccAuthMark(scope) { try { ccAuthSeen[scope || ccScope] = true; } catch (e) {} }
  function curFullKey() {
    return ccScope === 'public' ? (PUB_PREFIX + ':' + PUB_KEY) : (window.activePrefix() + ':cc-groups');
  }
  function saveGroups(groups) {
    // v3.42.x #455：懒加载态（管理页未开）没有编辑树可落盘——直接拒绝，绝不把
    // null/空树整包写回权威键（等价 #193 防覆盖守卫在懒加载态的收口）
    if (!groups) { ccDirty = false; return; }
    if (!ccAuthSeen[ccScope] && window.idbHasKey) {
      // 未确认权威库已取回：先探测 IDB 是否真有权威数据——有 = 绝不整包写回，
      // 走 rescueCcOverwrite 合并营救；健康连接确认无键（新装/空库）才放行直写
      ccDirty = true;
      rescueCcOverwrite();
      return;
    }
    saveGroupsNow(groups);
  }
  // FIX 2026-09-14 #434 字卡库媒体字卡「添加后退出浏览器重进丢失」落盘确认（荣耀10/Edge
  // 多机型同发，与 chat.js 我的表情包 #434 同根）：大库（>200KB，含表情包/图片 dataURL）
  // xyStore.set 只写 IDB 且是 fire-and-forget；Edge 杀进程回滚最近未落盘提交 + 挂起内核
  // IDB 事务偶发不提交 → 加完马上退出浏览器＝数据无任何持久副本。这里对大值把「已发起写」
  // 升级为「已确认落盘」：idbSet 结果为失败信号时按 1.5s×n 退避重发（每次取当前库快照，
  // 绝不用旧快照覆盖新数据），穷尽后提示；flushCcSave（离页/回前台）有未确认落盘变更再补发。
  // 只对 >200KB 大值生效——小值有 LS 同步快照 + WRJ 写日志双防线，不值得多一次全库事务。
  let ccDurableTimer = null;
  let ccDurablePending = false;
  let ccDurableWarned = false;
  function ccEnsureDurable(tries, jsonPre) {
    if (!window.idbSet) return;
    clearTimeout(ccDurableTimer);
    let json = '';
    // v3.42.x #455：jsonPre 供懒加载态的零散写入方（ccAppendCards 页外直写）带上
    // 本次完整快照确认落盘；常规路径仍序列化当前编辑树。groups 为空（管理页未开/
    // 已释放）且无快照时拒绝发写——绝不把空库整包写回权威键；挂起的补发由下一次
    // 开页后的 flushCcSave 用真实树接手。
    try { json = typeof jsonPre === 'string' ? jsonPre : (groups ? JSON.stringify(groups) : ''); } catch (e0) { return; }
    if (!json || json === 'null') return;
    window.idbSet(curFullKey(), json).then(ok => {
      if (ok) { ccDurablePending = false; ccDurableWarned = false; return; }
      ccDurablePending = true;
      if (tries < 5) { ccDurableTimer = setTimeout(function () { ccEnsureDurable(tries + 1); }, 1500 * (tries + 1)); return; }
      if (!ccDurableWarned) {
        ccDurableWarned = true;
        try { toast('字卡库暂时没能写入本机存储，稍后回到本页会自动补写；重要字卡请尽快导出备份'); } catch (e1) {}
      }
    });
  }
  function saveGroupsNow(groups) {
    // 统一走适配层：localStorage 快照 + IndexedDB 权威（配额满也不丢，启动自动恢复）
    // v3.11.x：按当前作用域写入对应键
    const ccJson = JSON.stringify(groups);
    curStore().set(curKey(), ccJson);
    if (ccJson.length > 200 * 1024) ccEnsureDurable(0); // #434：大值 IDB-only，确认落盘
    pubInvalidate();
    refreshLibCounts(true);
    ccDirty = false; // 本次待写已落盘（LS 同步 + IDB 异步发起）
  }
  // v3.26.x #193：把内存库（空/残缺快照 + 用户新增）按分组合并进权威库——同名分组
  // 按「权威没有的卡才补」去重追加，权威没有的分组整组补入；旧字卡与本次导入都不丢
  function mergeCcGroupsInto(auth, mem) {
    Object.keys(mem || {}).forEach(t => {
      if (!Array.isArray(auth[t])) auth[t] = [];
      (mem[t] || []).forEach(pair => {
        const name = pair[0], cards = pair[1] || [];
        let g = auth[t].find(p => p[0] === name);
        if (!g) { g = [name, []]; auth[t].push(g); }
        const have = new Set(g[1]);
        cards.forEach(c => { if (!have.has(c)) { g[1].push(c); have.add(c); } });
      });
    });
    return auth;
  }
  let ccRescueInflight = null;
  function rescueCcOverwrite() {
    if (ccRescueInflight) return;
    const mem = groups; // hydrateCurScope 落定后会用权威库重载 groups，先保住内存增量
    ccRescueInflight = Promise.resolve(window.idbHasKey(curFullKey())).then(exists => {
      if (!exists) { ccAuthMark(); saveGroupsNow(groups); return null; }
      return hydrateCurScope().then(() => {
        groups = mergeCcGroupsInto(loadGroups(), mem);
        ccAuthMark();
        saveGroupsNow(groups);
        try { renderGroupsBar(); render(); } catch (e0) {}
        return null;
      });
    }).catch(() => {
      // 探测/取回失败按「权威可能存在」处理：宁可缓写也绝不拿残缺库覆盖权威键
      return null;
    }).then(() => { ccRescueInflight = null; });
  }


  // v3.42.x #455：编辑树懒加载——groups 只在「用户正在字卡库管理页」时才载入真实库
  //（openCcPage/hydrateScope 页可见分支/applyRestored），离开页面/切桌面即置 null 释放；
  // 聊天回复池/表情面板/角标/搜索全部走令牌化池视图（ownPoolRaw/pubGroupsRaw），
  // 不再经由 groups。153MB 级库的 parse 副本从「开机常驻」收敛为「开页期间存在」。
  // 所有读 groups 的路径必须先判空（ccPageOpen() 才 loadGroups）；写路径
  //（saveGroups/flushCcSave/ccEnsureDurable/scheduleSave 定时器）判空拒发，绝不把
  // 空/残缺树整包写回权威键（#193 覆盖防线在懒加载态的延伸）。
  let groups = null;
  function ccPageOpen() {
    const p = document.getElementById('page-custom-cards');
    return !!p && !p.hidden;
  }
  let cur = 'text';
  let q = '';
  let curGroup = ''; // '' = 全部

  // 轻提示
  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'cc-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
  }

  // 查看大图（字卡库 / 聊天消息 共用）
  function viewImage(src) {
    let mask = document.getElementById('img-view-mask');
    if (!mask) {
      mask = document.createElement('div');
      mask.id = 'img-view-mask';
      mask.className = 'img-view-mask';
      mask.innerHTML = '<img class="img-view-img" alt="大图">';
      mask.addEventListener('click', () => { mask.hidden = true; });
      document.body.appendChild(mask);
    }
    mask.querySelector('.img-view-img').src = src;
    mask.hidden = false;
  }
  window.viewChatImage = viewImage;

  function totalCount(g) {
    let n = 0;
    Object.keys(g).forEach(t => g[t].forEach(grp => n += grp[1].length));
    return n;
  }
  // 强制弹窗（clock.js）用：统计当前桌面「专属+公用」用户自建字卡总数（不含系统预设/词典）。
  // 专用+公用各自 pooledRaw 为令牌化池视图，读相对轻量；数回 0 表示没加自定义字卡。
  window.cardLockCustomCount = function () {
    try { return totalCount(ownPoolRaw()) + totalCount(pubGroupsRaw()); }
    catch (e) { return 0; }
  };

  // 图片压缩（上传图片表情用）
  // v3.6.x：失败/超大图不再回退存原图——iOS Safari 解码超大 dataURL 会拖崩渲染进程
  //（画面正常但点击无响应），失败返回 null 由调用方提示换图
  function compressImage(dataUrl, maxSide, format, quality) {
    return new Promise((resolve) => {
      // 解码前拦截：>8MB base64 不解码不存储（48MP/ProRAW 级别）
      if (typeof dataUrl === 'string' && dataUrl.length > 8 * 1024 * 1024) {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          // 解码后像素拦截：高压缩格式小文件也可能是超大图（48MP HEIC）
          if (img.width * img.height > 26000000) { resolve(null); return; }
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          // v3.7.x：JPEG 无透明通道，先填白底避免透明区域变黑
          if (format === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL(format || 'image/png', quality));
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  // 渲染分组筛选栏（每个分组显示字卡数量）
  function renderGroupsBar() {
    // v3.42.x #455：懒加载态（groups=null）无库可渲染，静默跳过（开页时 openCcPage 先载再渲）
    if (!groups) return;
    if (!groupsBar) return;
    groupsBar.innerHTML = '';
    const grps = groups[cur] || [];
    const allCount = grps.reduce((s, g) => s + (Array.isArray(g[1]) ? g[1].length : 0), 0);
    const chips = [['', '全部', allCount]].concat(grps.map(g => [g[0], g[0], Array.isArray(g[1]) ? g[1].length : 0]));
    chips.forEach(([val, label, n]) => {
      const c = document.createElement('span');
      c.className = 'cc-g-chip' + (curGroup === val ? ' sel' : '');
      c.textContent = label + ' (' + n + ')';
      c.addEventListener('click', () => {
        curGroup = val;
        // v3.7.x：管理模式放宽视图变化时清空已选——避免选中屏幕外（被过滤隐藏）的卡
        if (manageMode) { selected.clear(); updateCount(); }
        renderGroupsBar();
        render();
      });
      groupsBar.appendChild(c);
    });
  }

  // v3.6.x：HTML 转义——文件名/字卡内容/分组名是用户输入，直接拼 innerHTML 会破坏结构或注入
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  // ================= v3.30.x：分组停用开关 UI =================
  // 分组 header 右侧眼睛按钮：点击停用/启用该分组。停用只影响「使用」
  //（回复池/面板不再出现该分组），字卡保留在库中，可随时重新启用。
  const ICON_EYE_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><path d="M14.12 14.12a3 3 0 11-4.24-4.24"/><path d="M1 1l22 22"/></svg>';
  function ccOffScope() { return ccScope === 'public' ? 'public' : 'own'; }
  // 分组 header HTML（停用标记 + 眼睛按钮），render 与局部重建共用
  function groupHeaderHtml(gname, count) {
    const off = isGroupOff(ccOffScope(), cur, gname);
    return '<span class="ccg-name">' + esc(gname) + (off ? '<em class="ccg-off-tag">已停用</em>' : '') + '</span>' +
      '<span class="ccg-count">' + count + '</span>' +
      '<button type="button" class="ccg-toggle' + (off ? ' off' : '') + '" title="' + (off ? '启用该分组' : '停用该分组') + '">' + (off ? ICON_EYE_OFF : ICON_EYE_ON) + '</button>';
  }
  // 绑定 header 开关事件（render 与局部重建共用）
  function bindGroupToggle(h, gname) {
    const tog = h.querySelector('.ccg-toggle');
    if (!tog) return;
    tog.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const off = toggleGroupOff(cur, gname);
      refreshGroupHeaderUI(gname);
      toast(off ? '已停用分组「' + gname + '」：该分组字卡不再被联系人使用' : '已启用分组「' + gname + '」：该分组字卡恢复使用');
    });
  }
  // 就地更新某个分组的 header 停用视觉（不重建列表 DOM）
  function refreshGroupHeaderUI(gname) {
    const sel = (window.CSS && CSS.escape) ? CSS.escape(String(gname)) : String(gname).replace(/["\\]/g, '\\$&');
    const h = list.querySelector('.cc-group-header[data-g="' + sel + '"]');
    if (!h) return;
    const off = isGroupOff(ccOffScope(), cur, gname);
    h.classList.toggle('off', off);
    const nm = h.querySelector('.ccg-name');
    if (nm) {
      const tag = nm.querySelector('.ccg-off-tag');
      if (off && !tag) {
        const e = document.createElement('em');
        e.className = 'ccg-off-tag';
        e.textContent = '已停用';
        nm.appendChild(e);
      } else if (!off && tag) { tag.remove(); }
    }
    const tog = h.querySelector('.ccg-toggle');
    if (tog) {
      tog.classList.toggle('off', off);
      tog.title = off ? '启用该分组' : '停用该分组';
      tog.innerHTML = off ? ICON_EYE_OFF : ICON_EYE_ON;
    }
  }

  // 字卡项 HTML：图片 dataURL 显示缩略图，否则文字（删除统一走【管理字卡】）
  function cardItemHtml(c) {
    // 语音字卡：文件名|||data:audio 音频数据（播放按钮：播放中显示动态波形 + 高亮）
    // v3.6.x：显示时也去掉 mp3/mp4 后缀（旧上传的语音仍带后缀）
    // v3.6.x：仅当 ||| 之后是音频 dataURL 才算语音——普通文字（如颜文字）里含 ||| 字符不应误判
    if (typeof c === 'string' && c.indexOf('|||') > 0) {
      const pIdx = c.indexOf('|||');
      const src = c.slice(pIdx + 3) || '';
      if (src.indexOf('data:audio') === 0) {
        const parts = c.split('|||');
        const name = (parts[0] || '音频').replace(/\.[^.]+$/, '');
        // v3.6.x：audio dataURL 不再嵌进按钮（几十条语音时 HTML 字符串会膨胀到
        // 几十 MB，手机端 render/滚动必卡）——播放时从 groups 数据按 item 定位取
        return '<div class="cc-ico" style="background:rgba(0,0,0,.05)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg></div>' +
          '<div class="cc-txt"><div class="t" style="color:var(--muted)">' + esc(name) + '</div></div>' +
          '<button class="cc-play" title="播放">' +
          '<span class="cc-play-ico"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>' +
          '<span class="cc-play-bars"><i></i><i></i><i></i></span></button>';
      }
    }
    // FIX 2026-09-15 #493 媒体池令牌卡按图渲染——#377 大库内存瘦身把超大贴纸/图片卡体换成
    // @@m:hash 令牌后，本函数只有 data:/http(s) 分支认识图片，令牌卡掉进末行文字分支
    // ＝字卡库网格直出「@@m:hex32」乱码/空白块（聊天气泡与表情面板各自有令牌路径故正常，
    // 多机型同报）。令牌即图片载荷：data-src 照写令牌，懒加载补 src 后由 media-pool
    // 文档观察器（media-pool.js resolveImg）解回真图；池里确认缺失的令牌按 #387 同口径
    // 显示文字占位，不发白块。
    if (typeof c === 'string' && c.indexOf('@@m:') === 0 && window.mochiMediaIsToken && window.mochiMediaIsToken(c)) {
      if (window.mochiMediaTokenMissing && window.mochiMediaTokenMissing(c)) {
        return '<div class="cc-txt"><div class="t" style="color:var(--muted)">[图片丢失]</div></div>';
      }
      return '<div class="cc-ico cc-imgbox"><img class="cc-img" data-src="' + esc(c) + '" alt="图片" decoding="async"></div>';
    }
    // v3.11.x：链接导入的字卡存原始 http(s) 链接（图床不允许跨域转存时的回退形态），
    // 缩略图同样按图片渲染；懒加载 observer 只做 data-src→src 拷贝，对链接天然兼容
    if (typeof c === 'string' && (c.indexOf('data:') === 0 || /^https?:\/\//i.test(c))) {
      // 图片字卡：缩略图 + 点击查看大图（无文字标签）
      // v3.6.x：data-src 懒加载——表情包/图片多时不一次性解码全部 dataURL，
      // 只解码进入视口的图（render 里用 IntersectionObserver 补 src），
      // 删除/重渲染也不再有全量解码开销
      return '<div class="cc-ico cc-imgbox"><img class="cc-img" data-src="' + esc(c) + '" alt="图片" decoding="async"></div>';
    }
    return '<div class="cc-txt"><div class="t">' + esc(c) + '</div></div>';
  }

  // v3.6.x：分类 tab 显示每个大分类的字卡数量（主字卡/颜文字/emoji/表情包/图片/拍一拍/语音）
  function renderTabCounts() {
    tabsWrap.querySelectorAll('.cc-tab').forEach(tab => {
      // v3.42.x #455：懒加载态（groups=null）无库可计数——必须与 renderGroupsBar 同守卫。
      // 缺这条时顶层首渲 render() 在此抛 null['text']，chatcard.js 整个 IIFE 初始化中断，
      // 其后的字卡库顶部两大分类 tab 绑定/锁状态提示/搜索全部不挂（#453 各机型「系统预设字卡点不开」）
      const grps = (groups && groups[tab.dataset.type]) || [];
      let n = 0;
      grps.forEach(g => { if (Array.isArray(g) && Array.isArray(g[1])) n += g[1].length; });
      let em = tab.querySelector('.cc-tab-n');
      if (!em) {
        em = document.createElement('em');
        em.className = 'cc-tab-n';
        tab.appendChild(em);
      }
      em.textContent = n;
      em.classList.toggle('zero', n === 0);
    });
  }

  // v3.6.x：图片字卡懒加载——只给进入视口的图补 src（dataURL 解码），
  // 表情包/图片分类几百张图时首屏只解码可见部分；重渲染/删除不再全量解码。
  // 无 IntersectionObserver 的旧浏览器由 render() 直接全部补 src 兜底
  const imgObserver = ('IntersectionObserver' in window) ? new IntersectionObserver((entries) => {
    for (let i = 0; i < entries.length; i++) {
      const en = entries[i];
      if (!en.isIntersecting) continue;
      const img = en.target;
      if (img && img.dataset && img.dataset.src && !img.getAttribute('src')) {
        img.setAttribute('src', img.dataset.src);
        img.removeAttribute('data-src');
      }
      try { imgObserver.unobserve(img); } catch (e) {}
    }
  }, { root: list, rootMargin: '300px 0px' }) : null;

  // 给图片节点注册懒加载（render / 局部重建共用）
  function attachLazy(img) {
    if (!img) return;
    if (imgObserver) { try { imgObserver.observe(img); } catch (e) {} }
    else {
      img.setAttribute('src', img.dataset.src || '');
      img.removeAttribute('data-src');
    }
  }

  // v3.6.x：语音卡 audio dataURL 不嵌 DOM——用 WeakMap 存 播放按钮节点 -> 音频数据，
  // 节点移除自动释放；搜索过滤后数组索引会错位，不能靠 dataset 索引回查，
  // 直接按节点取最稳
  const audioSrcMap = new WeakMap();

  // 渲染后为卡片节点补数据（图片懒加载注册 / 语音按钮音频注册）——render 与局部重建共用
  function attachCardData(d, c) {
    attachLazy(d.querySelector('img[data-src]'));
    const pb = d.querySelector('.cc-play');
    if (pb && typeof c === 'string' && c.indexOf('|||') > 0) {
      const p = c.indexOf('|||');
      const s = c.slice(p + 3);
      if (s.indexOf('data:audio') === 0) audioSrcMap.set(pb, s);
    }
  }

  // v3.7.x：单卡点击编辑——文字类字卡（主字卡/颜文字/emoji/拍一拍）在卡片上直接点击
  // 打开编辑弹窗修改内容；媒体字卡（图片/表情包/语音）保持原交互（查看大图/播放），不走这里
  function openEditCard(gname, i) {
    if (manageMode) return;
    const grps = groups[cur] || [];
    const g = grps.find(x => x[0] === gname);
    if (!g) return;
    const c = g[1][i];
    if (typeof c !== 'string' || !c) return;
    // 媒体字卡：图片 dataURL / 文件名|||音频 dataURL，不提供文字编辑
    if (c.indexOf('data:') === 0) return;
    if (c.indexOf('|||') > 0 && c.slice(c.indexOf('|||') + 3).indexOf('data:audio') === 0) return;
    if (!window.openModal) return;
    window.openModal('编辑字卡', c, (v) => {
      const val = String(v == null ? '' : v).trim();
      if (!val) { toast('字卡内容不能为空'); return; }
      if (val === c) return; // 内容未变化，直接关闭
      // 与批量导入一致：同一分组内不保留重复内容
      const dup = g[1].find((x, xi) => xi !== i && x === val);
      if (dup !== undefined) { toast('该分组已有相同内容'); return; }
      g[1][i] = val;
      updateCardDom(gname, i, val);
      // v3.7.x：内存与 DOM 即时生效，持久化延后（saveGroups 序列化大库会卡住确认）
      scheduleSave();
      toast('字卡已更新');
    });
  }

  // 编辑后局部更新单张卡的 DOM（图片懒加载/语音按钮数据同步重挂），大列表不全量重渲染；
  // 搜索过滤开启时内容可能不再匹配关键词——匹配则原地更新，不匹配则移除该卡并同步分组
  // header 计数（与 render() 的过滤条件一致：卡按内容过滤，组因组名含关键词时可保留空 header）
  function updateCardDom(gname, i, val) {
    // 分块渲染进行中：局部更新会被旧批次覆盖，改走全量 render（render 的 token 会废弃旧批次）
    if (rendering) { renderGroupsBar(); render(); return; }
    const sel = (window.CSS && CSS.escape) ? CSS.escape(String(gname)) : String(gname).replace(/["\\]/g, '\\$&');
    const node = list.querySelector('.cc-item[data-g="' + sel + '"][data-idx="' + i + '"]');
    if (node) {
      if (imgObserver) node.querySelectorAll('img[data-src]').forEach(im => { try { imgObserver.unobserve(im); } catch (e) {} });
      if (q) {
        const matches = (typeof val === 'string' && val.indexOf('data:') !== 0) && val.indexOf(q) >= 0;
        if (matches) {
          node.innerHTML = cardItemHtml(val);
          attachCardData(node, val);
        } else {
          node.remove();
          const h = list.querySelector('.cc-group-header[data-g="' + sel + '"]');
          if (h) {
            const cnt = h.querySelector('.ccg-count');
            if (cnt) cnt.textContent = Math.max(0, (parseInt(cnt.textContent, 10) || 1) - 1);
            if (cnt && parseInt(cnt.textContent, 10) === 0 && gname.indexOf(q) < 0) h.remove();
          }
        }
      } else {
        node.innerHTML = cardItemHtml(val);
        attachCardData(node, val);
      }
    }
    updateCountsOnly();
  }

  // v3.7.x：编辑持久化延后执行——saveGroups 会序列化整个字卡库（表情包/图片/语音
  // dataURL 可让库达几 MB~几十 MB），在确认回调里同步执行会阻塞弹窗关闭（用户反馈
  // 「点击确认卡顿」）。内存与 DOM 已即时更新，延后到下一帧后再写 LS+IDB；
  // 120ms 内连续编辑合并成一次写入，避免高频操作反复序列化大库
  let editSaveTimer = null;
  let ccDirty = false; // v3.29.x：自上次落盘后是否还有未保存变更（离页/切作用域冲刷依据）
  function scheduleSave() {
    clearTimeout(editSaveTimer);
    ccDirty = true;
    editSaveTimer = setTimeout(function () {
      editSaveTimer = null;
      try { saveGroups(groups); } catch (e) {}
    }, 120);
  }

  // v3.29.x：离页/切作用域/切联系人前立即落盘——修「字卡库【表情包】添加图片后
  // 刷新重进图片消失」（华为 P50E Edge 真机反馈，公用/专享字卡均复现）。
  // 根因：字卡库带上图片后整包 JSON 常跨过 idb.js 的 200KB 大键阈值，localStorage
  // 同步快照被跳过、只剩 IndexedDB 异步 fire-and-forget 写入；而 scheduleSave 的
  // 120ms 防抖期间或 IDB 事务尚未提交时刷新/切走/切桌面，新增图片无任何备份直接丢。
  // 这里与 chat.js flushSave（beforeunload/visibilitychange）同款口径：挂起中的
  // 变更在离页事件里立即发起写入，把「防抖 120ms + 异步 IDB」的可丢窗口压到最短。
  // 幂等：无待写变更（ccDirty=false）时零开销直接返回，不重复序列化大库。
  function flushCcSave() {
    if (editSaveTimer) { clearTimeout(editSaveTimer); editSaveTimer = null; }
    // #434：有未确认落盘的库变更（含上一轮 idbSet 失败挂起的补发）先再发一次
    if (ccDurablePending) ccEnsureDurable(0);
    if (!ccDirty) return;
    // v3.42.x #455：懒加载态无编辑树＝不存在未落盘的编辑（ccDirty 只在开页期置位），
    // 显式收口防 null 树整包写回
    if (!groups) { ccDirty = false; return; }
    try { saveGroups(groups); } catch (e) {}
  }
  window.ccFlushSave = flushCcSave;
  // v3.33.x：外部直接写回字卡库后强制重载缓存（img-compress 压缩写回走 xyStore 三路同拍，
  // 但本模块 pubCache/内存 groups 仍是旧 base64——不重载则聊天回复池/字卡管理页继续发旧图）。
  // pubInvalidate 清公用库缓存；groups 按当前作用域重读存储；角标强制重算。聊天页下次取池即新图。
  window.ccReloadGroupsAfterExternalWrite = function () {
    pubInvalidate();
    libCounts.pub = -1; libCounts.own = -1; libCounts.fun = -1; libCounts.pubFun = -1;
    // v3.42.x #455：管理页开着才重载编辑树（页关着保持懒加载态，池视图已随
    // pubInvalidate 失效、下次取池现算），不再无条件把大库 parse 副本拉进堆
    if (ccPageOpen()) {
      try { groups = loadGroups(); } catch (e) {}
      try { renderGroupsBar(); render(); } catch (e2) {}
    }
    refreshLibCounts(true);
  };
  try {
    window.addEventListener('beforeunload', flushCcSave);
    window.addEventListener('pagehide', flushCcSave);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushCcSave();
    });
  } catch (e) {}

  // v3.11.x：字卡库列表页「公用字卡 / 专属字卡」两行入口的角标计数。
  // 角标与当前打开作用域无关（公用行恒显全局键总量、专属行恒显当前联系人键总量）；
  // 带缓存：render→updateCountsOnly 高频触发，不重复 JSON.parse 大库，变更方强制刷新
  // v3.32.x：fun=专属库功能字卡数；pubFun=公用库功能字卡数（与 pub 同缓存节奏）
  const libCounts = { pub: -1, own: -1, fun: -1, pubFun: -1 };
  function countOf(g) {
    let n = 0;
    try { Object.keys(g || {}).forEach(t => (g[t] || []).forEach(grp => { if (Array.isArray(grp) && Array.isArray(grp[1])) n += grp[1].length; })); } catch (e) {}
    return n;
  }
  // v3.32.x：只统计指定分类（功能字卡入口角标用）
  function countOfKeys(g, keys) {
    let n = 0;
    try { (keys || []).forEach(t => (g[t] || []).forEach(grp => { if (Array.isArray(grp) && Array.isArray(grp[1])) n += grp[1].length; })); } catch (e) {}
    return n;
  }
  function refreshLibCounts(force) {
    if (force) { libCounts.pub = -1; libCounts.own = -1; libCounts.fun = -1; libCounts.pubFun = -1; pubInvalidate(); }
    // v3.25.x：计数 0 不再缓存——iOS 慢回填场景角标先算成 0 并缓存，之后数据落进
    // 内存缓存也没人失效它，列表页两行角标永远 0（点进作用域页却能看到字卡，真机反馈）。
    // 空库重复 countOf 只是解析 null 零负担；大库计数 >0 仍走缓存，不会反复 JSON.parse。
    if (libCounts.pub < 0) {
      // v3.26.x：走带缓存的 pubGroupsRaw()——force 分支已 pubInvalidate()，这里第一次读
      // 即填回缓存，后续回复池/搜索/渲染共用同一份解析结果。此前直接 parse 一次、
      // 别处再 parse 一次，等于每次返回字卡库把多 MB 公用库 JSON.parse 两遍。
      const n = countOf(pubGroupsRaw());
      libCounts.pub = n > 0 ? n : -1;
      libCounts.pubFun = countOfKeys(pubGroupsRaw(), CC_FUNC_KEYS);
    }
    if (libCounts.own < 0 || libCounts.fun < 0) {
      // v3.32.x：own 与 fun 共用同一次 parse（失效总是一起，防重复 JSON.parse 大库）
      // v3.42.x #455：改走令牌化池视图（令牌化只换卡体不删卡，计数口径不变）
      const og = ownPoolRaw();
      if (libCounts.own < 0) {
        const n = countOf(og);
        libCounts.own = n > 0 ? n : -1;
      }
      if (libCounts.fun < 0) libCounts.fun = countOfKeys(og, CC_FUNC_KEYS);
    }
    if (libCounts.pubFun < 0) {
      // v3.32.x：公用功能字卡计数与 cc-pub-count 同缓存节奏——只在 force 后重算一次。
      // 红线：绝不在进页路径上为角标 parse 公用大库（openCcPage 每次都会 pubInvalidate()，
      // 若这里无条件 pubGroupsRaw() = 每次点开字卡库都整库 JSON.parse 一遍 → 点开必卡，
      // 用户实测反馈过的卡顿根因，勿回退）
      libCounts.pubFun = countOfKeys(pubGroupsRaw(), CC_FUNC_KEYS);
    }
    // v3.32.x：功能字卡双入口角标——专属行=专属库功能字卡、公用行=公用库功能字卡
    //（各自走缓存，本函数零解析；与 公用字卡/专属字卡 两行口径一致）
    const pfe = document.getElementById('cc-fun-count');
    if (pfe) { pfe.textContent = String(libCounts.fun < 0 ? 0 : libCounts.fun); pfe.classList.remove('cc-cnt-loading'); } // #575 写回真值即摘掉取回中脉冲态
    const pfpe = document.getElementById('cc-fun-pub-count');
    if (pfpe) { pfpe.textContent = String(libCounts.pubFun < 0 ? 0 : libCounts.pubFun); pfpe.classList.remove('cc-cnt-loading'); }
    const pe = document.getElementById('cc-pub-count');
    if (pe) { pe.textContent = libCounts.pub < 0 ? 0 : libCounts.pub; pe.classList.remove('cc-cnt-loading'); }
    const oe = document.getElementById('cc-list-count');
    if (oe) { oe.textContent = libCounts.own < 0 ? 0 : libCounts.own; oe.classList.remove('cc-cnt-loading'); }
  }
  // FIX 2026-09-16 #575：字卡库列表页角标的「取回中」态——四个计数位显示「…」并加脉冲类，
  //   避免等待期显示 0 被当成「字卡丢了」（数据面不缩短等待，但界面不能说谎）。
  //   取回落定后由 refreshLibCounts(true) 写回真值并摘掉脉冲类。
  function markLibCountsLoading() {
    try {
      ['cc-pub-count', 'cc-list-count', 'cc-fun-count', 'cc-fun-pub-count'].forEach(function (id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = '…';
        el.classList.add('cc-cnt-loading');
      });
    } catch (e) {}
  }
  // v3.25.x：数据迟到重算——restore-done 时内存缓存才刚有数据（iOS 上常晚于首屏渲染），
  // 此前没有任何时点会重算两行角标，0 就一直挂着。启动回填完成即强制重算一次。
  document.addEventListener('mochi-restore-done', function () { refreshLibCounts(true); });

  // v3.6.x：只更新各类计数（tab 徽标/分组栏/总数），不重建列表 DOM——
  // 删除字卡/删除分组等高频操作改局部移除 DOM + 本函数，替代整页 render()
  function updateCountsOnly() {
    // v3.42.x #455：懒加载态无树可计数（正常调用方都在开页期），走池视图角标兜底
    if (!groups) { refreshLibCounts(false); return; }
    renderTabCounts();
    renderGroupsBar();
    const total = totalCount(groups);
    const totalEl = document.getElementById('cc-total');
    if (totalEl) totalEl.textContent = total + ' 张';
    refreshLibCounts(false);
  }

  // v3.6.x：定位某分组在列表中的 DOM 节点（header 带 data-g 标记，item 也带）
  function groupBlockNodes(gname) {
    const sel = (window.CSS && CSS.escape) ? CSS.escape(String(gname)) : String(gname).replace(/["\\]/g, '\\$&');
    const nodes = [];
    const header = list.querySelector('.cc-group-header[data-g="' + sel + '"]');
    if (header) nodes.push(header);
    list.querySelectorAll('.cc-item[data-g="' + sel + '"]').forEach(el => nodes.push(el));
    return nodes;
  }

  // ===== FIX 2026-09-15 #509 图片字卡节点回收池（跨 render 存活，已解码 img 零重解码）=====
  // 用户报障（红米 K80 Chrome，明说其他设备型号也有）：聊天里「表情包页面」每次打开图片都闪
  // 一下重新加载。无头 390×844 实证根因（零机型分支）：#508 的移植只在「当次 render 的 DOM 内」
  // 收集旧 img，但真实进页路径连着跑两次 render——openCcPage 先按 cur='text' 渲一遍（list.innerHTML=''
  // 清空），再点「表情包」tab 渲第二遍；第二次要用的 img 已在第一次清空时离开 DOM＝收集不到＝
  // 整格新建（实证 12/12 重建）。rebuildGroupAfterRemove（删一张卡重建整个分组）同样无移植。
  // 收口：节点按「内容指纹」回收进本模块池（上限 IMG_POOL_MAX 个 + 3 分钟空闲整池释放），
  // render/局部重建建卡时优先从池里取回同一张图的已解码节点；池空才新建（新旧行为天然等价，
  // 池只是复用已解码节点，不改任何排版/数据/事件绑定——事件始终绑在新卡外层 div 上）。
  const IMG_POOL_MAX = 150;
  const ccImgPool = new Map();   // sigKey -> [img,...]
  let ccImgPoolN = 0;
  let ccPoolT = null;
  // 内容指纹：djb2 短键（长度+哈希）——长 dataURL 直接当 Map 键会让每次查找都重算长串哈希
  function ccImgKey(c) {
    const s = String(c || '');
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return s.length + ':' + h;
  }
  function ccPoolRelease() { if (ccPoolT) { clearTimeout(ccPoolT); ccPoolT = null; } ccImgPool.clear(); ccImgPoolN = 0; }
  function ccPoolSchedule() {
    if (ccPoolT) clearTimeout(ccPoolT);
    ccPoolT = setTimeout(ccPoolRelease, 180000); // 闲置 3 分钟整池释放（不长期占着已解码位图）
  }
  function ccPoolPush(k, im) {
    if (!k || !im || !im.nodeType) return;
    let a = ccImgPool.get(k);
    if (!a) { a = []; ccImgPool.set(k, a); }
    a.push(im);
    ccImgPoolN++;
    ccPoolSchedule();
    while (ccImgPoolN > IMG_POOL_MAX) {
      const first = ccImgPool.keys().next();
      if (first.done) break;
      const kk = first.value;
      const aa = ccImgPool.get(kk);
      ccImgPool.delete(kk);
      ccImgPoolN -= (aa ? aa.length : 1);
      if (ccImgPoolN < 0) ccImgPoolN = 0;
    }
  }
  function ccPoolTake(k) {
    const a = ccImgPool.get(k);
    if (!a || !a.length) return null;
    const im = a.shift();
    ccImgPoolN = Math.max(0, ccImgPoolN - 1);
    if (!a.length) ccImgPool.delete(k);
    ccPoolSchedule();
    return im;
  }
  // 清空/移除一段 DOM 前，把其中带指纹的图片节点回收进池（懒加载未补 src 的也收，
  // 保住它已排的 src 状态，避免重建后又从零开始解密）
  function ccPoolHarvest(rootEl) {
    if (!rootEl || !rootEl.querySelectorAll) return;
    try {
      rootEl.querySelectorAll('.cc-item[data-cc-sig]').forEach(d => {
        const im = d.querySelector('img.cc-img');
        if (!im || !(im.getAttribute('src') || im.dataset.src)) return;
        ccPoolPush(d.dataset.ccSig, im);
      });
    } catch (e) {}
  }
  // 建卡时取节点：命中则原位替换掉刚生成的空 img（img 嵌在 .cc-imgbox 内层，取其真实父节点）
  // 只对「图片类内容」生效（dataURL / 媒体池令牌 / http(s) 链接字卡），文字卡不碰
  function ccPoolAdopt(el, c) {
    if (typeof c !== 'string') return;
    const isImg = c.indexOf('data:') === 0 || c.indexOf('@@m:') === 0 || /^https?:\/\//i.test(c);
    if (!isImg) return;
    const _ni = el.querySelector('img.cc-img');
    if (!_ni || !_ni.parentNode) return; // 当前不是 img 形态（如令牌缺失走文字占位）→ 不取也不动
    const _oi = ccPoolTake(ccImgKey(c));
    if (!_oi) return;
    _ni.parentNode.replaceChild(_oi, _ni);
  }

  // v3.6.x：删除后重建某个分组在列表中的卡片区（含未观察 img 的解绑），
  // 其余分组 DOM 保持不动——删除一张卡不再整页重建；
  // 分组仍在但被删空时保留 header（显示 0 张），与原来整页渲染的行为一致
  function rebuildGroupAfterRemove(gname) {
    // 分组不在当前视图（被分组筛选隐藏）：数据已删即可，不要动 DOM
    if (curGroup && curGroup !== gname) return;
    groupBlockNodes(gname).forEach(el => {
      if (imgObserver) el.querySelectorAll('img[data-src]').forEach(im => { try { imgObserver.unobserve(im); } catch (e) {} });
      ccPoolHarvest(el); // FIX #509：移除前回收该分组已解码的图片节点
      el.remove();
    });
    const grps = groups[cur] || [];
    const g = grps.find(x => x[0] === gname);
    if (!g) return; // 分组整体已删（走删除分组流程，不经过这里）
    // 重建 header（数量更新；空分组显示 0 张）
    const h = document.createElement('div');
    h.className = 'cc-group-header' + (isGroupOff(ccOffScope(), cur, gname) ? ' off' : '');
    h.dataset.g = gname;
    h.innerHTML = groupHeaderHtml(gname, g[1].length);
    bindGroupToggle(h, gname);
    // 找插入锚点：下一个分组的 header（按 DOM 顺序），否则 list 末尾
    const grpNames = grps.map(x => x[0]);
    const nextIdx = grpNames.indexOf(gname) + 1;
    const nextSel = (window.CSS && CSS.escape) ? CSS.escape(String(grpNames[nextIdx] || '')) : '';
    const anchor = nextIdx < grpNames.length
      ? list.querySelector('.cc-group-header[data-g="' + nextSel + '"]')
      : null;
    const frag = document.createDocumentFragment();
    frag.appendChild(h);
    g[1].forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'cc-item glass';
      d.dataset.g = gname;
      d.dataset.idx = i;
      d.innerHTML = cardItemHtml(c);
      if (typeof c === 'string') d.dataset.ccSig = ccImgKey(c); // FIX #508：局部重建的卡同样带指纹（#509 改短键）
      ccPoolAdopt(d, c); // FIX #509：同内容图从池里取回已解码 img（删一张卡不再让整组图片重载）
      attachCardData(d, c);
      if (manageMode && selected.has(gname + '\u0001' + i)) d.classList.add('sel');
      d.addEventListener('click', () => {
        if (manageMode) { toggleSelect(d, gname, i); return; }
        // v3.11.x：图片/表情字卡（含链接导入的 http(s) 字卡）点击查看大图
        // FIX 2026-09-15 #493 令牌卡同样查看大图（sync 命中热缓存直解，miss 则 viewImage
        // 落 src=令牌由 media-pool 观察器异步解图）；不补则令牌卡点开的是文字编辑弹窗
        if (typeof c === 'string' && c.indexOf('@@m:') === 0 && window.mochiMediaIsToken && window.mochiMediaIsToken(c)) {
          const v = window.mochiMediaExpand ? window.mochiMediaExpand(c) : null;
          viewImage(v || c);
          return;
        }
        if (typeof c === 'string' && (c.indexOf('data:') === 0 || /^https?:\/\//i.test(c))) { viewImage(c); return; }
        openEditCard(gname, i);
      });
      attachCardDrag(d, gname, i);
      frag.appendChild(d);
    });
    if (anchor && anchor.parentNode === list) list.insertBefore(frag, anchor);
    else list.appendChild(frag);
  }

  // v3.6.x：大列表分块渲染——几千张卡一次性创建会卡死主线程（手机端明显），
  // 首帧同步渲染一批立即可见，其余按帧分批挂载，期间不阻塞滚动；
  // 渲染途中触发新 render（切分类/筛选/搜索）通过 token 废弃旧批次
  const RENDER_BATCH = 80;
  let renderToken = 0;
  let rendering = false; // 分块渲染进行中（局部删除前判断：渲染中改走全量 render，防旧批次复活已删卡片）

  // v3.7.x：字卡拖动排序——长按 350ms 触发，可在同分组内排序 / 跨分组移动
  // 仅在主字卡/颜文字/emoji/表情包分类启用；管理模式/搜索/分块渲染中禁用
  const DRAG_CATS = ['text', 'kaomoji', 'emoji', 'sticker'];
  function attachCardDrag(el, gname, i) {
    if (DRAG_CATS.indexOf(cur) < 0) return;
    let pressTimer = null;
    let startX = 0, startY = 0;
    el.addEventListener('pointerdown', (e) => {
      if (manageMode || q || rendering) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      startX = e.clientX; startY = e.clientY;
      pressTimer = setTimeout(() => {
        pressTimer = null;
        if (manageMode || q || rendering) return;
        startCardDrag(e, el, gname, i);
      }, 350);
    });
    el.addEventListener('pointermove', (e) => {
      if (pressTimer && (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10)) {
        clearTimeout(pressTimer); pressTimer = null;
      }
    });
    const cancel = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
  }
  function startCardDrag(e, el, gname, i) {
    const rect = el.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const clone = el.cloneNode(true);
    clone.classList.add('cc-drag-clone');
    clone.style.position = 'fixed';
    clone.style.left = rect.left + 'px';
    clone.style.top = rect.top + 'px';
    clone.style.width = rect.width + 'px';
    clone.style.zIndex = '1000';
    clone.style.pointerEvents = 'none';
    document.body.appendChild(clone);
    el.classList.add('cc-dragging');
    if (navigator.vibrate) try { navigator.vibrate(15); } catch (err) {}
    let dropTarget = null;
    const onMove = (ev) => {
      ev.preventDefault();
      clone.style.top = (ev.clientY - offsetY) + 'px';
      dropTarget = computeCardDrop(ev.clientY);
      updateCardDropIndicator(dropTarget);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      clone.remove();
      el.classList.remove('cc-dragging');
      clearCardDropIndicator();
      if (dropTarget) moveCardTo(gname, i, dropTarget);
    };
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }
  function computeCardDrop(clientY) {
    const items = Array.from(list.querySelectorAll('.cc-item:not(.cc-dragging)'));
    for (const item of items) {
      const r = item.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) {
        return { gname: item.dataset.g, idx: parseInt(item.dataset.idx, 10), before: true };
      }
    }
    // 落在所有 item 之后：按 header 判断属于哪个分组，追加到该分组末尾（含空分组）
    const headers = Array.from(list.querySelectorAll('.cc-group-header'));
    let lastHeader = null;
    for (const h of headers) {
      if (clientY >= h.getBoundingClientRect().top) lastHeader = h;
    }
    if (lastHeader) {
      const gname = lastHeader.dataset.g;
      const grps = groups[cur] || [];
      if (grps.find(x => x[0] === gname)) {
        const groupItems = items.filter(it => it.dataset.g === gname);
        if (groupItems.length) {
          const last = groupItems[groupItems.length - 1];
          return { gname, idx: parseInt(last.dataset.idx, 10), before: false };
        }
        return { gname, idx: 0, before: true, empty: true };
      }
    }
    if (items.length) {
      const last = items[items.length - 1];
      return { gname: last.dataset.g, idx: parseInt(last.dataset.idx, 10), before: false };
    }
    return null;
  }
  function updateCardDropIndicator(target) {
    clearCardDropIndicator();
    if (!target) return;
    const sel = (window.CSS && CSS.escape) ? CSS.escape(String(target.gname)) : String(target.gname).replace(/["\\]/g, '\\$&');
    const line = document.createElement('div');
    line.className = 'cc-drop-line';
    if (target.empty) {
      const header = list.querySelector('.cc-group-header[data-g="' + sel + '"]');
      if (header && header.nextSibling) list.insertBefore(line, header.nextSibling);
      else if (header) list.appendChild(line);
      return;
    }
    const ref = list.querySelector('.cc-item[data-g="' + sel + '"][data-idx="' + target.idx + '"]');
    if (!ref) return;
    if (target.before) list.insertBefore(line, ref);
    else if (ref.nextSibling) list.insertBefore(line, ref.nextSibling);
    else list.appendChild(line);
  }
  function clearCardDropIndicator() {
    list.querySelectorAll('.cc-drop-line').forEach(el => el.remove());
  }
  function moveCardTo(fromGname, fromIdx, target) {
    const grps = groups[cur] || [];
    const fromG = grps.find(g => g[0] === fromGname);
    if (!fromG) return;
    const card = fromG[1][fromIdx];
    if (card === undefined) return;
    const toG = grps.find(g => g[0] === target.gname);
    if (!toG) return;
    let toIdx = target.before ? target.idx : target.idx + 1;
    if (fromGname === target.gname) {
      if (fromIdx === toIdx || fromIdx === toIdx - 1) return; // 原地未动
      fromG[1].splice(fromIdx, 1);
      if (fromIdx < toIdx) toIdx -= 1;
      fromG[1].splice(toIdx, 0, card);
    } else {
      fromG[1].splice(fromIdx, 1);
      toG[1].splice(toIdx, 0, card);
    }
    saveGroups(groups);
    renderGroupsBar();
    render();
    toast('字卡已移动');
  }

  function render() {
    const token = ++renderToken;
    rendering = true;
    renderTabCounts();
    // 表情包分类：网格一行四个；图片分类：网格一行两个；emoji 分类：网格一行六个；其他分类保持行式列表
    list.classList.toggle('cc-grid', cur === 'sticker');
    list.classList.toggle('cc-grid2', cur === 'image');
    list.classList.toggle('cc-grid6', cur === 'emoji');
    // v3.42.x #455：懒加载态兜底为空列表（调用方都已在 groups 就绪后触发，此处只防
    // 事件竞态把 null 树带进渲染）
    const grps = (groups && groups[cur]) || [];
    let shown = grps;
    // 分组筛选
    if (curGroup) shown = shown.filter(g => g[0] === curGroup);
    if (q) {
      // v3.7.x：保留原始索引——搜索过滤后 data-idx 必须仍是原始数组索引，
      // 否则单卡点击编辑/删除会按错位索引改到别的字卡
      // FIX 2026-09-16 #573 搜索精准化（与 #557 字卡库页同款）：①多词空格 AND + 查询侧标点归一；
      // ②组内按匹配质量稳定排序（rk 并列以原始 oi 决胜），data-idx 仍写原始 oi＝点击编辑删除不受影响；
      // #508 指纹复用池按内容指纹存取（ccPoolPush/Adopt 以 sig 为键），与行序无关＝乱序安全。
      const terms = window.mochiSearch ? window.mochiSearch.terms(window.mochiSearch.qnorm(q)) : [q.toLowerCase()];
      const kwN = terms.join(' ');
      shown = shown
        .map(([g, arr]) => [g, arr
          .map((c, oi) => { const o = { c: c, oi: oi }; o.rk = window.mochiSearch ? window.mochiSearch.rank(c, kwN) : 2; return o; })
          .filter(x => (typeof x.c === 'string' && x.c.indexOf('data:') !== 0) && terms.every(w => x.c.toLowerCase().indexOf(w) >= 0))
          .sort((a, b) => a.rk - b.rk || a.oi - b.oi)])
        .filter(([g, arr]) => arr.length || terms.every(w => g.toLowerCase().indexOf(w) >= 0));
    }
    updateCountsOnly();
    // FIX #508（红米 K80 Chrome 等多机型报「表情包页操作后图片闪一下重新加载」，与头像互动
    // 点选换头像同族）：整格重渲把已解码的 img 全部丢弃重建＋懒加载重新赋 src＝可视区内图片
    // 全部重新解码闪烁。收口：按内容指纹（建卡时写进 data-cc-sig）复用旧 img 节点——已解码的
    // 直接续用（零重解码），未进视口的（data-src 未消费）也保住不再重新排队；点击/拖拽/懒加载
    // 观察都绑在新卡节点上，行为与原全量重建完全一致。真正内容变化的卡天然无指纹命中＝照旧新建。
    // FIX #509（承接 #508）：原实现在本次 list DOM 内现场收集旧节点——但真实进页路径是
    // 「openCcPage 先按 cur='text' 渲一遍（清空 list）→ 用户点『表情包』tab 再渲第二遍」，
    // 第二次要用的节点在第一次清空时就已离开 DOM＝抓不到＝整格新建（无头实证 12/12 重建）。
    // 改为回收进模块级池（ccPoolHarvest 收 / ccPoolAdopt 取），跨 render 存活，正好补上这一段。
    // v3.6.x：清空前先解除旧图片懒加载观察，避免 observer 引用累积
    if (imgObserver) list.querySelectorAll('img[data-src]').forEach(im => { try { imgObserver.unobserve(im); } catch (e) {} });
    ccPoolHarvest(list);
    list.innerHTML = '';
    if (!shown.length) {
      const isVoice = cur === 'voice';
      const emptyTxt = cur === 'sticker' ? '暂无表情包 · 点击右上角批量导入上传图片'
        : cur === 'image' ? '暂无图片 · 点击右上角批量导入上传图片'
        : cur === 'voice' ? '暂无语音 · 点击右上角批量导入上传音频'
        : '暂无字卡';
      // #549 空状态可点：原来只写「点右上角」要用户自己找；这里直接给按钮，点了即触发右上角
      // 同一入口（批量导入/链接导入），空列表不再是死胡同。按钮用内联样式，不动共享 CSS。
      const impLabel = isVoice ? '批量导入音频' : (cur === 'sticker' || cur === 'image') ? '批量导入图片' : '批量导入字卡';
      list.innerHTML = '<div class="cc-empty-wrap" style="grid-column:1/-1">'
        + '<div class="cc-empty">' + emptyTxt + '</div>'
        + '<div class="cc-empty-act" style="display:flex;gap:8px;justify-content:center;padding:0 0 20px">'
        + '<button type="button" class="cc-empty-btn" data-cc-empty="import" style="padding:9px 15px;border:0;border-radius:10px;background:var(--ink,#111);color:var(--card-bg,#fff);font-size:13px;font-weight:700;cursor:pointer">' + impLabel + '</button>'
        + (isVoice ? '' : '<button type="button" class="cc-empty-btn" data-cc-empty="link" style="padding:9px 15px;border:0;border-radius:10px;background:rgba(0,0,0,.06);color:var(--ink,#111);font-size:13px;font-weight:700;cursor:pointer">链接导入</button>')
        + '</div></div>';
      // 一次性委托：点空状态按钮 → 透传到右上角既有入口（不重复实现导入逻辑）
      if (list && !list.__ccEmptyActBound) {
        list.__ccEmptyActBound = true;
        list.addEventListener('click', (e) => {
          const b = e.target && e.target.closest ? e.target.closest('[data-cc-empty]') : null;
          if (!b) return;
          e.preventDefault(); e.stopPropagation();
          const el = document.getElementById(b.getAttribute('data-cc-empty') === 'link' ? 'cc-import-link' : 'cc-import');
          if (el) el.click();
        });
      }
      return;
    }
    // 展开扁平结构：分组 header 与字卡项交错（header 带 data-g 供局部更新定位）
    const flat = [];
    shown.forEach(([gname, arr]) => {
      flat.push({ header: true, gname, count: arr.length });
      arr.forEach((o, i) => {
        // 搜索过滤时元素是 {c, oi} 对象（保留原始索引）；否则是原始字卡字符串
        flat.push({ header: false, gname, c: q ? o.c : o, i: q ? o.oi : i });
      });
    });
    const frag = document.createDocumentFragment();
    let pos = 0;
    const build = (el, it) => {
      if (it.header) {
        el.className = 'cc-group-header' + (isGroupOff(ccOffScope(), cur, it.gname) ? ' off' : '');
        el.dataset.g = it.gname;
        el.innerHTML = groupHeaderHtml(it.gname, it.count);
        bindGroupToggle(el, it.gname);
      } else {
        el.className = 'cc-item glass';
        el.dataset.g = it.gname;
        el.dataset.idx = it.i;
        el.innerHTML = cardItemHtml(it.c);
        if (typeof it.c === 'string') {
          el.dataset.ccSig = ccImgKey(it.c); // FIX #508/#509：内容短指纹，供复用判定
          ccPoolAdopt(el, it.c);             // FIX #509：从池取回同内容的已解码 img（取不到则保持新建）
        }
        attachCardData(el, it.c);
        if (manageMode && selected.has(it.gname + '\u0001' + it.i)) el.classList.add('sel');
        el.addEventListener('click', () => {
          if (manageMode) { toggleSelect(el, it.gname, it.i); return; }
          // 图片/表情字卡（含链接导入的 http(s) 字卡）：点击查看大图
          // FIX 2026-09-15 #493 令牌卡同上——查看大图而非文字编辑（分块渲染路径）
          if (typeof it.c === 'string' && it.c.indexOf('@@m:') === 0 && window.mochiMediaIsToken && window.mochiMediaIsToken(it.c)) {
            const v = window.mochiMediaExpand ? window.mochiMediaExpand(it.c) : null;
            viewImage(v || it.c);
            return;
          }
          if (typeof it.c === 'string' && (it.c.indexOf('data:') === 0 || /^https?:\/\//i.test(it.c))) {
            viewImage(it.c);
            return;
          }
          openEditCard(it.gname, it.i);
        });
        attachCardDrag(el, it.gname, it.i);
      }
    };
    const step = () => {
      if (token !== renderToken) { rendering = false; return; } // 新渲染已开始，废弃本批次
      const end = Math.min(pos + RENDER_BATCH, flat.length);
      for (; pos < end; pos++) {
        const el = document.createElement('div');
        build(el, flat[pos]);
        frag.appendChild(el);
      }
      // 每帧挂载一批：列表渐进出现，首屏立即可滚动
      list.appendChild(frag);
      if (pos < flat.length) requestAnimationFrame(step);
      else rendering = false;
    };
    step(); // 首帧同步跑第一批（小列表一次完成，行为与原一致）
  }

  // 分类切换
  tabsWrap.querySelectorAll('.cc-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      // v3.6.x：切换分类时退出管理模式并清空选中——旧逻辑不清，
      // 旧分类的「分组名\1索引」选中 key 在新分类下匹配不到，删除/移动静默失败
      if (manageMode) exitManage();
      selected.clear();
      tabsWrap.querySelectorAll('.cc-tab').forEach(t => t.classList.remove('sel'));
      tab.classList.add('sel');
      cur = tab.dataset.type;
      syncLinkImportVis();
      q = '';
      curGroup = '';
      // 清空两个搜索框
      const s1 = document.getElementById('cc-search-input');
      const s2 = document.getElementById('chatcard-search');
      if (s1) s1.value = '';
      if (s2) s2.value = '';
      renderGroupsBar();
      render();
    });
  });

  // 搜索：页内输入框直接过滤（v3.6.x：不再弹窗，输入即筛，清空即恢复）
  const searchInput = document.getElementById('cc-search-input');
  const searchInput2 = document.getElementById('chatcard-search');
  function setupSearchInput(input) {
    if (!input) return;
    // v3.5.138：不再标记 ceDone 跳过 contenteditable 转换——之前为兼容
    // 雨见浏览器特意保留原生 input，但这手机 Chrome 对原生 input 聚焦仍弹
    // 「自动填充」白条。ce-box 已兼容 input 事件转发 + value 代理 + Escape
    // keydown 转发（见 mobile-adapt.js），转接后输入即筛/清空恢复照常工作。
    // v3.6.x：120ms 防抖——字卡多时每敲一个字全量渲染会卡，输入停顿后再筛
    let searchTimer = null;
    input.addEventListener('input', () => {
      // v3.7.x：管理模式放开搜索——搜索过滤已保留原始索引（{c,oi}），
      // 勾选删除/移动按原始索引匹配不会错位（v3.5.130 禁用的误删风险已消除）；
      // 过滤视图变化时清空已选并刷新计数，避免残留选中屏幕外的卡
      q = input.value.trim();
      if (manageMode) { selected.clear(); updateCount(); }
      clearTimeout(searchTimer);
      searchTimer = setTimeout(render, 120);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = ''; q = '';
        if (manageMode) { selected.clear(); updateCount(); }
        clearTimeout(searchTimer);
        render();
        input.blur();
      }
    });
  }
  setupSearchInput(searchInput);
  // v3.9.x：字卡库列表页搜索——跨所有分类搜字卡内容
  const searchResultEl = document.createElement('div');
  searchResultEl.className = 'cc-search-result';
  searchResultEl.style.cssText = 'padding:0 12px';
  searchResultEl.hidden = true;
  (function () { const w = document.querySelector('#page-chatcard .tc-search-wrap'); if (w && w.parentNode) w.parentNode.insertBefore(searchResultEl, w.nextSibling); })();
  function renderSearchResult(kw) {
    if (!kw) { searchResultEl.hidden = true; searchResultEl.innerHTML = ''; return; }
    searchResultEl.hidden = false;
    kw = window.mochiSearch ? window.mochiSearch.qnorm(kw) : kw; // #573 查询侧标点归一：「晚安。」＝「晚安」
    if (!kw) { searchResultEl.hidden = true; searchResultEl.innerHTML = ''; return; }
    const fns = window.__cardSearchFns || [];
    // FIX 2026-09-16 #557 字卡库搜索精准化（用户报「搜一个字，多几个字的全部出现」）：
    // ① 多词空格 AND——各注册方只认整串子串，故以最长词为锚调注册方取候选，其余词在中心
    //    复筛每词都须命中（此前整串当单词条，「晚安 爱」恒 0 命中）；
    // ② 匹配质量排序分节：整卡等于关键词（精确）→ 开头命中 → 包含命中，最像的排最前，
    //    不再按模块注册顺序把精确卡淹没在一堆仅「沾边」的长卡里。
    // #573 分词/锚词/分级改走全站公共 window.mochiSearch（与设置页/功能大全同一套语义）。
    const ms = window.mochiSearch || null;
    const terms = ms ? ms.terms(kw) : [String(kw).toLowerCase()];
    const anchor = ms ? ms.anchor(terms) : terms[0];
    let all = [];
    fns.forEach(function (reg) { try { (reg.fn(anchor) || []).forEach(function (r) { all.push({ t: r.t, cat: r.cat, mod: reg.name }); }); } catch (e) {} });
    all = all.filter(function (r) { const t = String(r.t || '').toLowerCase(); return terms.every(function (w) { return t.indexOf(w) >= 0; }); });
    all.forEach(function (r) { r.__rank = ms ? ms.rank(r.t, kw) : 2; });
    all.sort(function (a, b) { return a.__rank - b.__rank; });
    if (!all.length) { searchResultEl.innerHTML = '<div class="ta-empty" style="padding:20px 12px">没有找到含「' + esc(kw) + '」的字卡</div>'; return; }
    const RANK_NAME = ['精确命中', '开头命中', '包含命中'];
    let html = '<div class="cal-card-title" style="padding:10px 2px">找到 ' + all.length + ' 张含「' + esc(kw) + '」的字卡</div>';
    for (let rk = 0; rk < 3; rk++) {
      const sec = all.filter(function (r) { return r.__rank === rk; });
      if (!sec.length) continue;
      html += '<div class="cal-card-title" style="padding:8px 2px 4px;font-size:12px;color:var(--muted,#888)">' + RANK_NAME[rk] + ' ' + sec.length + ' 张</div>';
      sec.forEach(function (r) {
        html += '<div class="tc-qrow"><div class="tc-qmain"><div class="tc-qtext">' + esc(r.t) + '</div><div class="tc-qmeta" style="font-size:11px;color:var(--muted)">' + esc(r.mod) + (r.cat ? ' · ' + esc(r.cat) : '') + '</div></div></div>';
      });
    }
    searchResultEl.innerHTML = html;
  }
  if (searchInput2) {
    const filterEntries = function () {
      const kw = String(searchInput2.value || '').trim().toLowerCase();
      const customEl = document.getElementById('cc-sect-custom');
      const presetEl = document.getElementById('cc-sect-preset');
      if (kw) {
        if (customEl) customEl.hidden = true;
        if (presetEl) presetEl.hidden = true;
        renderSearchResult(kw);
      } else {
        renderSearchResult('');
        const cur = document.querySelector('.cc-top-tabs .cc-tab.sel');
        const k = cur ? cur.getAttribute('data-ccsect') : 'custom';
        if (customEl) customEl.hidden = (k !== 'custom');
        if (presetEl) presetEl.hidden = (k !== 'preset');
      }
    };
    // FIX 2026-09-16 #581 字卡库列表页搜索防抖（口径同上面自定义字卡管理页的 v3.6.x 120ms）：
    //   此前 input 直连 filterEntries，每敲一个字就重跑全部 __cardSearchFns——预设字卡 7k+ 张
    //   全量扫，外加 4 个 ta-ask 题库各自一次 JSON.parse，低端机上表现为掉字/输入粘滞。
    //   ① 停顿 150ms 才真搜，打字期间一次都不搜；
    //   ② 上一轮搜索 ≥120ms 才亮「搜索中…」（轻库不闪），且提示先上屏 32ms 再跑同步搜索——
    //      不让出这一拍，提示写进 DOM 也来不及画出来，等于没加。
    let ccSearchTimer = 0, ccSearchPost = 0, ccSearchLast = 0;
    const ccSearchRun = function () {
      if (ccSearchPost) { clearTimeout(ccSearchPost); ccSearchPost = 0; }
      const t0 = Date.now();
      filterEntries();
      ccSearchLast = Date.now() - t0; // 记本次耗时：够快则下轮不再亮提示，免得每键闪一下
    };
    const ccSearchInput = function () {
      clearTimeout(ccSearchTimer);
      if (ccSearchPost) { clearTimeout(ccSearchPost); ccSearchPost = 0; }
      if (!String(searchInput2.value || '').trim()) { ccSearchRun(); return; } // 清空＝立即复原分类列表
      ccSearchTimer = setTimeout(function () {
        if (ccSearchLast < 120) { ccSearchRun(); return; }
        searchResultEl.hidden = false;
        searchResultEl.innerHTML = '<div class="ta-empty" style="padding:20px 12px">搜索中…</div>';
        ccSearchPost = setTimeout(ccSearchRun, 32);
      }, 150);
    };
    searchInput2.addEventListener('input', ccSearchInput);
    searchInput2.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        searchInput2.value = '';
        clearTimeout(ccSearchTimer);
        if (ccSearchPost) { clearTimeout(ccSearchPost); ccSearchPost = 0; }
        filterEntries();
        searchInput2.blur();
      }
    });
    const ccPage = document.getElementById('page-chatcard');
    if (ccPage) { new MutationObserver(function () { if (!ccPage.hidden && searchInput2.value) { searchInput2.value = ''; filterEntries(); } }).observe(ccPage, { attributes: true, attributeFilter: ['hidden'] }); }
  }
  // 跨分类搜索注册：自定义聊天字卡 / 默认聊天字卡 / 情绪·回应
  window.__cardSearchFns = window.__cardSearchFns || [];
  window.__cardSearchFns.push({ name: '自定义聊天字卡', fn: function (kw) {
    const out = [];
    try {
      // v3.11.x：公用 + 专属合并后参与搜索
      // v3.42.x #455：专属侧走令牌化池视图（搜索按文字/名称匹配，媒体卡体不参与，
      // 与原 loadGroups 口径一致且免去每次搜索全量 parse 大库）
      const groups = mergeWithPublic(ownPoolRaw());
      Object.keys(groups).forEach(function (type) {
        (groups[type] || []).forEach(function (grp) {
          const gname = grp[0]; const cards = grp[1] || [];
          cards.forEach(function (c) { const txt = typeof c === 'string' ? c : (c && c.t) || ''; if (txt && txt.toLowerCase().indexOf(kw) >= 0) out.push({ t: txt, cat: gname }); });
        });
      });
    } catch (e) {}
    return out;
  } });
  window.__cardSearchFns.push({ name: '默认聊天字卡', fn: function (kw) {
    const out = [];
    try {
      if (window.cardLockOpen && !window.cardLockOpen()) return out; // #319 锁定＝搜不到系统预设字卡
      const d = window.DEFAULT_CARD_DATA || {};
      Object.keys(d).forEach(function (k) { (d[k] || []).forEach(function (grp) { const gname = grp[0]; const cards = grp[1] || []; cards.forEach(function (c) { if (c && String(c).toLowerCase().indexOf(kw) >= 0) out.push({ t: String(c), cat: gname }); }); }); });
    } catch (e) {}
    return out;
  } });
  window.__cardSearchFns.push({ name: '聊天情绪/回应', fn: function (kw) {
    const out = [];
    try {
      const d = window.MOOD_FOLLOWUP_DATA || {};
      (d.mood || []).forEach(function (g) { (g.cards || []).forEach(function (c) { const txt = c && c.content ? c.content : ''; if (txt && txt.toLowerCase().indexOf(kw) >= 0) out.push({ t: txt, cat: '情绪·' + (g.group || '') }); }); });
      (d.followup || []).forEach(function (g) { const grp = g.group || g.cat || ''; (g.cards || []).forEach(function (c) { const txt = typeof c === 'string' ? c : (c && c.content) || ''; if (txt && txt.toLowerCase().indexOf(kw) >= 0) out.push({ t: txt, cat: '回应·' + grp }); }); });
    } catch (e) {}
    return out;
  } });

  // 管理分组：列出当前分类的分组，可新建 / 删除（内置分组不可删除）
  const ngBtn = document.getElementById('cc-new-group');
  if (ngBtn) {
    ngBtn.addEventListener('click', openManageGroups);
  }
  function openManageGroups() {
    // 创建/复用管理面板
    let mask = document.getElementById('cc-mg-mask');
    if (!mask) {
      mask = document.createElement('div');
      mask.id = 'cc-mg-mask';
      mask.className = 'mg-mask';
      mask.innerHTML =
        '<div class="mg-panel">' +
          '<div class="mg-head"><span>管理分组</span><button class="mg-close">✕</button></div>' +
          '<div class="mg-list"></div>' +
          '<button class="mg-add"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M12 5v14M5 12h14"/></svg>新建分组</button>' +
        '</div>';
      document.body.appendChild(mask);
      mask.querySelector('.mg-close').addEventListener('click', () => { mask.hidden = true; });
      mask.addEventListener('click', (e) => { if (e.target === mask) mask.hidden = true; });
      mask.querySelector('.mg-add').addEventListener('click', () => {
        if (window.openModal) {
          window.openModal('新建分组', '', (v) => {
            const name = (v || '').trim();
            if (!name) return;
            if (!groups[cur]) groups[cur] = [];
            if (groups[cur].some(g => g[0] === name)) { toast('分组「' + name + '」已存在'); return; }
            groups[cur].push([name, []]);
            saveGroups(groups);
            renderGroupsBar();
            render();
            renderMgList();
            // v3.6.x：新建成功后自动关掉【管理分组】弹窗，不再手动点 ✕
            mask.hidden = true;
          });
        }
      });
    }
    // v3.7.x：管理分组面板——分组拖动排序（左侧 ≡ 手柄触发，document 监听 pointermove/up）
    function attachGroupRowDrag(row, gi) {
      const handle = row.querySelector('.mg-handle');
      if (!handle) return;
      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        const listEl = mask.querySelector('.mg-list');
        if (!listEl) return;
        const rect = row.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        const clone = row.cloneNode(true);
        clone.classList.add('mg-drag-clone');
        clone.style.position = 'fixed';
        clone.style.left = rect.left + 'px';
        clone.style.top = rect.top + 'px';
        clone.style.width = rect.width + 'px';
        clone.style.margin = '0';
        document.body.appendChild(clone);
        row.classList.add('mg-dragging');
        let dropIdx = gi;
        const onMove = (ev) => {
          ev.preventDefault();
          clone.style.top = (ev.clientY - offsetY) + 'px';
          const rows = Array.from(listEl.querySelectorAll('.mg-row'));
          dropIdx = rows.length;
          for (let i = 0; i < rows.length; i++) {
            if (rows[i] === row) continue;
            const r = rows[i].getBoundingClientRect();
            if (ev.clientY < r.top + r.height / 2) { dropIdx = i; break; }
          }
          listEl.querySelectorAll('.mg-drop-line').forEach(el => el.remove());
          const line = document.createElement('div');
          line.className = 'mg-drop-line';
          if (dropIdx >= rows.length) listEl.appendChild(line);
          else listEl.insertBefore(line, rows[dropIdx]);
        };
        const onUp = () => {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.removeEventListener('pointercancel', onUp);
          clone.remove();
          row.classList.remove('mg-dragging');
          listEl.querySelectorAll('.mg-drop-line').forEach(el => el.remove());
          if (dropIdx === gi || dropIdx === gi + 1) return; // 原地未动
          const grps = groups[cur] || [];
          let target = dropIdx < gi ? dropIdx : dropIdx - 1;
          if (target < 0) target = 0;
          if (target > grps.length - 1) target = grps.length - 1;
          if (target === gi) return;
          const [moved] = grps.splice(gi, 1);
          grps.splice(target, 0, moved);
          saveGroups(groups);
          renderGroupsBar();
          render();
          renderMgList();
          toast('分组已移动');
        };
        document.addEventListener('pointermove', onMove, { passive: false });
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
        e.preventDefault();
      });
    }
    function renderMgList() {
      const listEl = mask.querySelector('.mg-list');
      const grps = groups[cur] || [];
      if (!grps.length) { listEl.innerHTML = '<div class="mg-empty">暂无分组，点击下方新建</div>'; return; }
      listEl.innerHTML = '';
      const handleSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
      const editSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>';
      grps.forEach(([gname, arr], gi) => {
        const row = document.createElement('div');
        row.className = 'mg-row';
        row.dataset.gidx = String(gi);
        const builtin = (BUILTIN[cur] || []).some(b => b[0] === gname);
        row.innerHTML = '<button class="mg-handle" aria-label="拖动排序">' + handleSvg + '</button>' +
          '<span class="mg-name">' + esc(gname) + '</span><span class="mg-count">' + arr.length + ' 张</span>' +
          (builtin ? '<span class="mg-tag">内置</span>' : '<button class="mg-rn" aria-label="重命名">' + editSvg + '</button><button class="mg-del">✕</button>');
        attachGroupRowDrag(row, gi);
        if (!builtin) {
          const rnBtn = row.querySelector('.mg-rn');
          if (rnBtn) rnBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.openModal) {
              window.openModal('重命名分组', gname, (v) => {
                const name = String(v == null ? '' : v).trim();
                if (!name) return;
                if (name === gname) return;
                if ((groups[cur] || []).some(g => g[0] === name)) { toast('分组「' + name + '」已存在'); return; }
                const g = groups[cur][gi];
                if (!g) return;
                const oldName = g[0];
                g[0] = name;
                if (curGroup === oldName) curGroup = name;
                if (selected.size) {
                  const newSel = new Set();
                  selected.forEach(k => {
                    const sep = k.indexOf('\u0001');
                    if (sep > 0 && k.slice(0, sep) === oldName) newSel.add(name + '\u0001' + k.slice(sep + 1));
                    else newSel.add(k);
                  });
                  selected.clear(); newSel.forEach(k => selected.add(k));
                }
                saveGroups(groups);
                renderGroupsBar();
                render();
                renderMgList();
                toast('已重命名为「' + name + '」');
              });
            }
          });
          row.querySelector('.mg-del').addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.openModal) {
              window.openModal('删除分组「' + gname + '」及其全部字卡？', '', () => {
                const wasCur = curGroup === gname;
                groups[cur] = groups[cur].filter(([g]) => g !== gname);
                if (wasCur) curGroup = '';
                saveGroups(groups);
                // v3.6.x：不再整页 render——分组在 DOM 中则局部移除该块 + 只更新计数；
                // 当前筛选/搜索视图受影响时（需恢复全部视图或 DOM 无法精确定位）才全量重建；
                // 分块渲染进行中同样走全量（防旧批次复活已删分组）
                if (wasCur || rendering) {
                  render();
                } else if (!q) {
                  groupBlockNodes(gname).forEach(el => {
                    if (imgObserver) el.querySelectorAll('img[data-src]').forEach(im => { try { imgObserver.unobserve(im); } catch (e) {} });
                    el.remove();
                  });
                  updateCountsOnly();
                } else {
                  render();
                }
                renderMgList();
              }, { noInput: true });
            }
          });
        }
        listEl.appendChild(row);
      });
    }
    mask.hidden = false;
    renderMgList();
  }

  // ================= 管理字卡（批量勾选删除 / 移动分组） =================
  let manageMode = false;
  const selected = new Set(); // key: 分组名 + \u0001 + 数组索引
  let manageBar = null;
  let mgCountEl = null;

  function toggleSelect(el, gname, i) {
    const k = gname + '\u0001' + i;
    if (selected.has(k)) { selected.delete(k); el.classList.remove('sel'); }
    else { selected.add(k); el.classList.add('sel'); }
    updateCount();
  }
  function updateCount() {
    if (mgCountEl) mgCountEl.textContent = '已选 ' + selected.size + ' 张';
  }
  function selectedKeys() {
    const keys = [];
    (groups[cur] || []).forEach(([gname, arr]) => {
      if (curGroup && curGroup !== gname) return;
      arr.forEach((c, i) => {
        // v3.7.x：搜索态下「全选」只选当前过滤视图可见的卡（与 render 过滤条件一致），
        // 避免连带选中屏幕外的卡片
        if (q && !((typeof c === 'string' && c.indexOf('data:') !== 0) && c.indexOf(q) >= 0)) return;
        keys.push(gname + '\u0001' + i);
      });
    });
    return keys;
  }
  function delSelected() {
    let removed = 0;
    // v3.6.x：先记录受影响的分组（局部 DOM 更新需要），再倒序 splice 防错位
    const touched = new Set(); // 受影响分组名
    (groups[cur] || []).forEach(([gname, arr]) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (selected.has(gname + '\u0001' + i)) {
          touched.add(gname);
          arr.splice(i, 1);
          removed++;
        }
      }
    });
    if (!removed) return;
    selected.clear();
    // v3.7.x：持久化延后——saveGroups 同步序列化整个字卡库（图片/语音 dataURL 可让库
    // 达几 MB~几十 MB），在确认回调里同步执行会阻塞弹窗关闭（用户反馈「点击确认卡顿」）；
    // 内存与 DOM 已即时删除，延后到下一帧再写 LS+IDB，与编辑字卡一致
    scheduleSave();
    // v3.6.x：局部移除被删卡片 + 重建受影响分组，不再整页 render（删除卡顿主因）；
    // 但分块渲染进行中时不能局部更新——旧批次会把已删的卡重新挂载，改走全量 render；
    // v3.7.x：搜索过滤开启时同样全量 render——rebuildGroupAfterRemove 重建整组不带
    // 搜索过滤，会把不匹配关键词的卡片重新显示出来
    if (rendering || q) { render(); updateCount(); toast('已删除 ' + removed + ' 张字卡'); return; }
    touched.forEach((gname) => {
      rebuildGroupAfterRemove(gname);
    });
    updateCountsOnly();
    updateCount();
    toast('已删除 ' + removed + ' 张字卡');
  }
  function moveSelected(target) {
    const mvGroups = [];
    (groups[cur] || []).forEach(([gname, arr]) => {
      const mv = [];
      for (let i = arr.length - 1; i >= 0; i--) {
        if (selected.has(gname + '\u0001' + i)) { mv.push(arr[i]); arr.splice(i, 1); }
      }
      if (mv.length) mvGroups.push(mv);
    });
    const total = mvGroups.reduce((s, a) => s + a.length, 0);
    if (!total) return;
    const tg = (groups[cur] || []).find(g => g[0] === target);
    if (tg) mvGroups.forEach(a => { tg[1] = tg[1].concat(a); });
    selected.clear();
    saveGroups(groups);
    renderGroupsBar();
    render();
    updateCount();
    toast('已移动 ' + total + ' 张字卡到「' + target + '」');
  }
  function enterManage() {
    manageMode = true;
    selected.clear();
    // v3.7.x：管理模式放开搜索——保留当前搜索/分组筛选视图继续筛选；
    // 搜索过滤已保留原始索引（{c,oi}），勾选删除/移动按原始索引匹配不会错位
    // （v3.5.130 禁用搜索的原因——过滤后索引与原始数组错位——已被 v3.7.x 修复）
    render();
    list.classList.add('cc-managing');
    document.querySelectorAll('.cc-toolbar').forEach(t => { t.style.display = 'none'; });
    if (!manageBar) {
      manageBar = document.createElement('div');
      manageBar.id = 'cc-manage-bar';
      manageBar.className = 'cc-manage-bar';
      manageBar.innerHTML =
        '<span class="cc-m-count">已选 0 张</span>' +
        '<button class="cc-m-btn" id="cc-m-all">全选</button>' +
        '<button class="cc-m-btn cc-m-del" id="cc-m-del">删除</button>' +
        '<button class="cc-m-btn" id="cc-m-move">移动</button>' +
        '<button class="cc-m-btn" id="cc-m-exit">退出</button>';
      document.body.appendChild(manageBar);
      mgCountEl = manageBar.querySelector('.cc-m-count');
      manageBar.querySelector('#cc-m-all').addEventListener('click', () => {
        const all = selectedKeys();
        if (selected.size === all.length && all.length) selected.clear();
        else all.forEach(k => selected.add(k));
        render();
        updateCount();
      });
      manageBar.querySelector('#cc-m-del').addEventListener('click', () => {
        if (!selected.size) { toast('请先勾选字卡'); return; }
        if (window.openModal) {
          // 弹窗里明确列出勾选删除的字卡（只含勾选的），未勾选的字卡不出现在确认弹窗里；
          // 文字字卡显示内容，语音显示文件名，图片/表情包显示占位
          const list = [];
          (groups[cur] || []).forEach(([gname, arr]) => {
            arr.forEach((c, i) => {
              if (!selected.has(gname + '\u0001' + i)) return;
              let t = c;
              // 语音字卡：文件名|||data:audio 音频；含 ||| 的普通文字（如颜文字）不算语音
              if (typeof t === 'string' && t.indexOf('|||') > 0 && t.slice(t.indexOf('|||') + 3).indexOf('data:audio') === 0) t = '🎵 ' + t.split('|||')[0];
              else if (typeof t === 'string' && t.indexOf('data:') === 0) t = '🖼 图片';
              list.push(t);
            });
          });
          const MAX_SHOW = 30;
          const shown = list.slice(0, MAX_SHOW).join('\n');
          const more = list.length > MAX_SHOW ? '\n…等 ' + list.length + ' 张' : '';
          window.openModal('删除选中的 ' + selected.size + ' 张字卡？', '', () => delSelected(), { noInput: true, staticText: shown + more });
        }
      });
      manageBar.querySelector('#cc-m-move').addEventListener('click', () => {
        if (!selected.size) { toast('请先勾选字卡'); return; }
        const mList = (groups[cur] || []).map(g => g[0]);
        if (!mList.length) { toast('当前没有分组'); return; }
        if (window.openModal) {
          window.openModal('移动到分组', '', (v) => moveSelected(v), {
            pills: mList.map(n => ({ label: n, value: n })),
            pill: mList[0],
            noInput: true
          });
        }
      });
      manageBar.querySelector('#cc-m-exit').addEventListener('click', exitManage);
    }
    manageBar.hidden = false;
    updateCount();
  }
  function exitManage() {
    manageMode = false;
    selected.clear();
    list.classList.remove('cc-managing');
    document.querySelectorAll('.cc-toolbar').forEach(t => { t.style.display = ''; });
    if (manageBar) manageBar.hidden = true;
  }
  const mcBtn = document.getElementById('cc-manage-cards');
  if (mcBtn) mcBtn.addEventListener('click', () => { if (manageMode) exitManage(); else enterManage(); });

  // ================= 去重复字卡 =================
  // #360：跨分组去重——seen 集合按「分类」建、不按「分组」建，同分类下换了分组也能清出重复；
  // 对象型字卡（表情包/图片/语音）按稳定序列化内容判重（原 new Set(arr) 按引用比较，对象永远判不出）。
  function ccCardDupKey(cat, c) {
    if (typeof c === 'string') return cat + '|s|' + c;
    try {
      return cat + '|o|' + JSON.stringify(c, (k, v) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const o = {};
          Object.keys(v).sort().forEach(k2 => { o[k2] = v[k2]; });
          return o;
        }
        return v;
      });
    } catch (e) { return cat + '|r|' + Math.random(); } // 序列化失败宁可不删
  }
  const ccDedupe = document.getElementById('cc-dedupe');
  if (ccDedupe) {
    ccDedupe.addEventListener('click', () => {
      // 先统计重复数量（不修改数据），确认后才真正删除
      let dup = 0;
      Object.keys(groups).forEach(cat => {
        const seen = new Set();
        (groups[cat] || []).forEach(([, arr]) => {
          (arr || []).forEach(c => {
            const k = ccCardDupKey(cat, c);
            if (seen.has(k)) dup++; else seen.add(k);
          });
        });
      });
      if (!dup) { toast('没有发现重复字卡'); return; }
      if (window.openModal) {
        window.openModal('去重 ' + dup + ' 张重复字卡？', '', () => {
          let removed = 0;
          Object.keys(groups).forEach(cat => {
            const seen = new Set();
            (groups[cat] || []).forEach(([, arr]) => {
              const kept = [];
              (arr || []).forEach(c => {
                const k = ccCardDupKey(cat, c);
                if (seen.has(k)) { removed++; return; }
                seen.add(k); kept.push(c);
              });
              arr.length = 0;
              arr.push.apply(arr, kept);
            });
          });
          saveGroups(groups);
          renderGroupsBar();
          render();
          toast('已去除 ' + removed + ' 张重复字卡');
        }, {
          noInput: true,
          staticText: '将删除当前字卡库内同分类各分组中内容完全相同的重复字卡（跨分组也计重复，每种内容只保留 1 张，保留最先出现的那张），并同步清理各分组的数量显示。'
        });
      }
    });
  }

  // ================= 导出数据（v3.7.x：弹窗选择分类 + 分组后导出 json） =================
  // FIX 2026-09-15 #506：导出自包含——媒体池令牌 @@m:hash 还原成真实 dataURL 再落文件。
  // 背景：#387 修复前的版本曾把令牌化后的内存缓存整包写回库键（写回泄漏），旧备份导入
  // 也会把令牌带进库——sticker/image 混有令牌卡时，导出直读原始键＝文件里是 @@m:hex
  // 而不是图片数据（用户反馈「导出数据不包括表情包和图片的全部数据」），换设备/池被清
  // 后永久坏图。导出前按池键批量取回还原；池里已缺失的保持原样并计数提示。
  function ccExportExpandTokens(obj) {
    const hashes = {};
    let hasTok = false;
    (function collect(o) {
      if (typeof o === 'string') {
        if (o.indexOf('@@m:') >= 0) {
          hasTok = true;
          const re = /@@m:([0-9a-f]{32})/g; let m;
          while ((m = re.exec(o))) hashes[m[1]] = null;
        }
        return;
      }
      if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) collect(o[i]); return; }
      if (o && typeof o === 'object') { Object.keys(o).forEach(k => collect(o[k])); }
    })(obj);
    if (!hasTok || !window.mochiMediaResolve) return Promise.resolve({ ok: 0, miss: 0 });
    const list = Object.keys(hashes);
    function pull(i) {
      if (i >= list.length) return Promise.resolve();
      const batch = list.slice(i, i + 16);
      return Promise.all(batch.map(h => window.mochiMediaResolve('@@m:' + h))).then(rs => {
        batch.forEach((h, j) => { if (typeof rs[j] === 'string' && rs[j]) hashes[h] = rs[j]; });
        return pull(i + 16);
      });
    }
    return pull(0).then(() => {
      let ok = 0, miss = 0;
      (function replace(o) {
        if (Array.isArray(o)) {
          for (let i = 0; i < o.length; i++) {
            const c = o[i];
            if (typeof c !== 'string') { replace(c); continue; }
            if (c.indexOf('@@m:') < 0) continue;
            if (window.mochiMediaIsToken && window.mochiMediaIsToken(c)) {
              const v = hashes[c.slice(4)];
              if (v) { o[i] = v; ok++; } else miss++;
            } else {
              o[i] = c.replace(/@@m:([0-9a-f]{32})/g, (m0, h) => hashes[h] || m0);
            }
          }
        } else if (o && typeof o === 'object') {
          Object.keys(o).forEach(k => {
            const c = o[k];
            if (typeof c !== 'string') { replace(c); return; }
            if (c.indexOf('@@m:') < 0) return;
            o[k] = c.replace(/@@m:([0-9a-f]{32})/g, (m0, h) => hashes[h] || m0);
          });
        }
      })(obj);
      return { ok: ok, miss: miss };
    });
  }
  // ================= #554（TASKS #128）字卡媒体令牌化持久化：库键瘦身 =================
  // 把双作用域字卡库存储键里的内联图（data:image/*，≥CC_CC_TOK_MIN）替换成媒体池令牌
  // @@m:hash——同一张图跨卡/跨组/跨作用域（公用+专属共用一个全局池）只存一份。背景：
  // 聊天图自 #142 走池去重，字卡图一直整份内联（#160 实测双作用域 62.8MB、用户机公用库
  // 44.59MB）；#377/#455 内存令牌化只省内存（原始键一字节不动），>64KB 大图每会话经
  // mochiMediaTokenize 写池＝池里早已有一份、存储键里却又内联一份＝双份存储。
  // 安全设计（缺一即回归「图片丢失」家族）：
  //   · 池先令牌后：mochiMediaTokenize 批量查/写池并排程落盘之后，才把令牌写回库键——
  //     崩溃窗口最多「池多一条孤儿」（GC 可清），绝不会「令牌入库而池数据丢失」；
  //   · 字符串级替换：正则定位 + 一次拼接写回，绝不 JSON.parse 整库（#455 纪律，
  //     44MB 级 parse 在 iOS 上是秒级长任务/OOM 源）；
  //   · 保险丝：替换后没变小就不写；本库任一张令牌化失败（crypto 不可用等）整库放弃，
  //     绝不写半个库；
  //   · 消费方已全部就绪：渲染/池视图令牌解析（#377/#142 观察器）、GC 引用面含
  //     cc-groups(-public)（#506）、字卡导出自包含还原（#506 ccExportExpandTokens）、
  //     字卡自检令牌感知（#532）；完整备份自带池键（#275 MEDIA_POOL_KEY_RE）。
  //   · 语音（名称|||data:audio）v1 不动：令牌链路语音虽已支持（#283/#395），但管理页
  //     预览/编辑树语音路径未随本批验证，留待后续批次。
  window.mochiCcPersistTokenize = function (prog) {
    return (async function () {
      const out = { ok: false, reason: '', images: 0, uniq: 0, saved: 0, written: 0, libs: [] };
      if (!window.idbGet || !window.xyStore || !window.mochiMediaTokenize) { out.reason = '接口不可用（需安全上下文 + IndexedDB）'; return out; }
      // xyStore 约定：prefix 不带尾冒号（set/get 内部拼 ':'+k）——带尾冒号会写出
      // xy-home-v2::xx 双冒号垃圾键（#560 实测，storage-slim 同款隐患）。
      const libs = [{ prefix: PUB_PREFIX, key: PUB_KEY, label: '公用字卡库' }];
      try { (window.getContacts ? window.getContacts() : []).forEach(function (c) { if (c && c.id) libs.push({ prefix: PUB_PREFIX + ':' + c.id, key: 'cc-groups', label: (c.name || c.id) + ' · 专属' }); }); } catch (e) {}
      libs.push({ prefix: PUB_PREFIX, key: 'cc-groups', label: '旧版顶层字卡库（残留）' });
      const yieldUI = function () { return new Promise(function (r) { setTimeout(r, 0); }); };
      const re = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;
      for (let li = 0; li < libs.length; li++) {
        const L = libs[li];
        let raw = null;
        try { raw = await window.idbGet(L.prefix + ':' + L.key); } catch (e) {}
        if (typeof raw !== 'string' || !raw) {
          // IDB 没有（未落/被启动预算挂起另算）时回落 xyStore 读（memoryCache/LS）——
          // 该键 IDB 确认没有＝LS 是唯一副本，读它写回是安全的
          try { const v2 = window.xyStore(L.prefix).get(L.key); if (typeof v2 === 'string' && v2) raw = v2; } catch (e2) {}
        }
        if (typeof raw !== 'string' || raw.indexOf('data:image/') < 0) continue;
        // ① 收集内联图偏移（≥MIN；只记 [index,len]，不整串复制）
        const offs = [];
        let m, found = 0;
        re.lastIndex = 0;
        while ((m = re.exec(raw))) { found++; if (m[0].length >= CC_CC_TOK_MIN) offs.push([m.index, m[0].length]); if ((found & 1023) === 0) await yieldUI(); }
        if (!offs.length) continue;
        // ② 唯一化 → 逐张写池拿令牌（跨卡/跨库同图同哈希，池里只写一次）
        const byUrl = new Map();
        for (let oi = 0; oi < offs.length; oi++) {
          const url = raw.slice(offs[oi][0], offs[oi][0] + offs[oi][1]);
          if (!byUrl.has(url)) byUrl.set(url, null);
          if ((oi & 127) === 127) await yieldUI();
        }
        out.images += offs.length;
        let failed = false, i = 0;
        for (const url of byUrl.keys()) {
          let tok = null;
          try { tok = await window.mochiMediaTokenize(url, { noCache: true }); } catch (e) {}
          if (!tok) { failed = true; break; }
          byUrl.set(url, tok);
          i++;
          if (prog) { try { prog(L.label + '：写池', i, byUrl.size); } catch (eP) {} }
          if ((i & 15) === 0) await yieldUI();
        }
        if (failed) { byUrl.clear(); out.libs.push({ label: L.label, skipped: '令牌化不可用，本库未改动' }); continue; }
        // 池先令牌后（对齐聊天 normalize「先 mochiMediaFlush 再 saveMsgs」契约）：池写缓冲
        // 是 300ms 延迟批量落盘，不强制冲刷的话库键令牌可能先于池数据入 IDB——崩溃窗口
        // 变成「令牌入库而池缺数据」＝图片丢失。这里显式 flush 后才允许写库键。
        try { await window.mochiMediaFlush(); } catch (e) {}
        // ③ 一次拼接写回（此刻池数据已强制落 IDB；不变小不写＝保险丝）
        let outStr = '', last = 0, replaced = 0;
        for (let oi = 0; oi < offs.length; oi++) {
          const url = raw.slice(offs[oi][0], offs[oi][0] + offs[oi][1]);
          const tok = byUrl.get(url);
          if (!tok) continue;
          outStr += raw.slice(last, offs[oi][0]) + tok;
          last = offs[oi][0] + offs[oi][1];
          replaced++;
        }
        outStr += raw.slice(last);
        if (!replaced || outStr.length >= raw.length) continue;
        try { window.xyStore(L.prefix).set(L.key, outStr); } catch (eW) { out.libs.push({ label: L.label, skipped: '写回失败' }); continue; }
        // durable 收尾：xyStore.set 的值事务是异步发出，这里再 await 一次同字节直写并等
        // commit——①「池→库」提交顺序从此可依赖；②调用方/用户界面随后读回即见令牌
        //（幂等：同一字节重复写，零语义漂移；wrj 日志里 set() 已记的同值标记不受影响）。
        try { await window.idbSet(L.prefix + ':' + L.key, outStr); } catch (eS) {}
        const savedChars = raw.length - outStr.length;
        out.saved += savedChars * 2;
        out.uniq += byUrl.size;
        out.written++;
        out.libs.push({ label: L.label, found: offs.length, uniq: byUrl.size, saved: savedChars * 2 });
        if (prog) { try { prog(L.label + '：写回完成', 1, 1); } catch (eP2) {} }
        await yieldUI();
      }
      if (out.written) { try { pubInvalidate(); } catch (eI) {} } // 池视图按令牌化后的原始键重建
      out.ok = true;
      return out;
    })().catch(function (e) { return { ok: false, reason: '迁移异常：' + ((e && e.message) || e), images: 0, uniq: 0, saved: 0, written: 0, libs: [] }; });
  };
  const ccExport = document.getElementById('cc-export');
  if (ccExport) {
    // 7 大分类 key + 显示名（与分类 tab 一致）
    // v3.32.x：补其他互动功能字卡 13 分类（与分类 tab 一致，导出含功能字卡）
    const EXPORT_CATS = [
      ['text', '主字卡'], ['kaomoji', '颜文字'], ['emoji', 'emoji'],
      ['sticker', '表情包'], ['image', '图片'], ['poke', '拍一拍'], ['voice', '语音'],
      ['fish', '摸鱼'], ['eat', '吃饭'], ['period', '经期'], ['water', '喝水'], ['garden', '花园'],
      ['sync', '同频'], ['reach', '伸手'], ['cjian', '此间'], ['room', '房间'], ['piggy', '存钱罐'],
      ['drift', '漂流瓶'], ['interact', '互动回应'], ['music', '音乐']
    ];
    const ceMask = document.getElementById('cc-export-mask');
    const ceCats = document.getElementById('ce-cats');
    const ceGrps = document.getElementById('ce-grps');
    const ceSummary = document.getElementById('ce-summary');
    const ceDo = document.getElementById('ce-do');
    const ceClose = document.getElementById('ce-close');
    // 选择状态：{ 分类key: { on: 是否选中分类, grps: { 分组名: 是否选中 } } }
    let ceState = {};
    if (ceMask && ceCats && ceGrps) {
      function ceInit() {
        ceState = {};
        EXPORT_CATS.forEach(([key]) => {
          const gs = groups[key] || [];
          const st = { on: gs.length > 0, grps: {} };
          gs.forEach(([name]) => { st.grps[name] = true; });
          ceState[key] = st;
        });
      }
      function ceRender() {
        // 分类 chips（显示数量，默认全选非空分类）
        ceCats.innerHTML = '';
        EXPORT_CATS.forEach(([key, name]) => {
          const gs = groups[key] || [];
          const n = gs.reduce((s, g) => s + (Array.isArray(g[1]) ? g[1].length : 0), 0);
          const b = document.createElement('span');
          b.className = 'cc-g-chip' + (ceState[key] && ceState[key].on ? ' sel' : '');
          b.textContent = name + ' ' + n;
          b.addEventListener('click', () => {
            const st = ceState[key];
            st.on = !st.on;
            // 重新打开的分类：其分组恢复全选（之前取消的选择不残留）
            if (st.on) Object.keys(st.grps).forEach(g => { st.grps[g] = true; });
            ceRender();
          });
          ceCats.appendChild(b);
        });
        // 分组 chips（按分类分段，只渲染选中的分类）
        ceGrps.innerHTML = '';
        const grpCats = EXPORT_CATS.filter(([key]) => ceState[key] && ceState[key].on && (groups[key] || []).length);
        if (!grpCats.length) {
          const e = document.createElement('div');
          e.className = 'cc-empty';
          e.textContent = '所选分类暂无分组，请先选择有字卡的分类';
          ceGrps.appendChild(e);
        } else {
          grpCats.forEach(([key, cname]) => {
            const gs = groups[key] || [];
            const sec = document.createElement('div');
            sec.className = 'ce-grp-sec';
            const secName = document.createElement('div');
            secName.className = 'ce-grp-cat';
            secName.textContent = cname;
            sec.appendChild(secName);
            const chips = document.createElement('div');
            chips.className = 'cc-groups-bar';
            gs.forEach(([gname, cards]) => {
              const n = Array.isArray(cards) ? cards.length : 0;
              const b = document.createElement('span');
              b.className = 'cc-g-chip' + (ceState[key].grps[gname] ? ' sel' : '');
              b.textContent = gname + ' ' + n;
              b.addEventListener('click', () => {
                ceState[key].grps[gname] = !ceState[key].grps[gname];
                ceRender();
              });
              chips.appendChild(b);
            });
            sec.appendChild(chips);
            ceGrps.appendChild(sec);
          });
        }
        // 汇总 + 按钮可用态
        let cards = 0, grps = 0, cats = 0;
        EXPORT_CATS.forEach(([key]) => {
          const st = ceState[key];
          if (!st || !st.on) return;
          cats++;
          (groups[key] || []).forEach(([gname, cs]) => {
            if (st.grps[gname]) { grps++; cards += Array.isArray(cs) ? cs.length : 0; }
          });
        });
        ceSummary.textContent = '已选 ' + cats + ' 个分类 · ' + grps + ' 个分组 · ' + cards + ' 张字卡';
        if (ceDo) ceDo.disabled = cards === 0;
      }
      function ceOpen() { ceInit(); ceRender(); ceMask.hidden = false; }
      function ceCloseFn() { ceMask.hidden = true; }
      ccExport.addEventListener('click', ceOpen);
      if (ceClose) ceClose.addEventListener('click', ceCloseFn);
      ceMask.addEventListener('click', (e) => { if (e.target === ceMask) ceCloseFn(); });
      if (ceDo) {
        ceDo.addEventListener('click', () => {
          try {
            const out = {};
            CC_ALL_TYPES.forEach(t => { out[t] = []; });
            EXPORT_CATS.forEach(([key]) => {
              const st = ceState[key];
              if (!st || !st.on) return;
              (groups[key] || []).forEach(([gname, cs]) => {
                if (st.grps[gname]) out[key].push([gname, Array.isArray(cs) ? cs.slice() : []]);
              });
            });
            // #506：先还原媒体池令牌再落文件（导出文件必须自包含）
            ccExportExpandTokens(out).then(exp => {
              const data = JSON.stringify(out, null, 2);
              const blob = new Blob([data], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'mochi字卡库数据.json';
              document.body.appendChild(a);
              a.click();
              setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 300);
              ceCloseFn();
              toast('已导出所选字卡' +
                (exp.ok ? '（' + exp.ok + ' 张图片已从媒体池还原进文件）' : '') +
                (exp.miss ? '；' + exp.miss + ' 张图片数据缺失无法还原' : ''));
            });
          } catch (e) { toast('导出失败'); }
        });
      }
    }
  }

  // ================= 导入数据（字卡库 json） =================
  // v3.6.x：导入前先选模式——「追加字卡（自动去重）」保留现有字卡按分组合并、
  // 重复内容自动去除；「替换字卡」清空当前字卡库、完全使用文件内容。
  // 文件先完整解析、确认含有效字卡后才写入：格式错误/空文件不会改动现有字卡库
  const ccImportData = document.getElementById('cc-import-data');
  if (ccImportData) {
    const CAT_NAMES = { text: '主字卡', kaomoji: '颜文字', emoji: 'emoji', sticker: '表情包', image: '图片', poke: '拍一拍', voice: '语音', fish: '摸鱼', eat: '吃饭', period: '经期', water: '喝水', garden: '花园', sync: '同频', reach: '伸手', cjian: '此间', room: '房间', piggy: '存钱罐', drift: '漂流瓶', interact: '互动回应', music: '音乐' };
    ccImportData.addEventListener('click', () => {
      if (window.openModal) {
        const curName = CAT_NAMES[cur] || '当前分类';
        window.openModal('导入字卡数据', '', (mode) => {
          pickImportFile(mode);
        }, {
          noInput: true,
          staticText: '选择导入方式：\n· 追加字卡：保留现有字卡，按分组并入，重复内容自动去除\n· 导入到「' + curName + '」：文件里全部字卡都并入当前分类\n· 替换字卡：清空当前字卡库，完全使用文件内容',
          pills: [
            { label: '追加字卡（自动去重）', value: 'merge' },
            { label: '导入到「' + curName + '」', value: 'current' },
            { label: '替换字卡', value: 'replace' }
          ],
          pill: 'merge'
        });
      }
    });
    function pickImportFile(mode) {
      // v3.23.x：accept 放开为全文件——vivo 自带/雨见等安卓浏览器对 accept=".json" 过滤
      // 可能灰显/隐藏备份文件（同 v3.16.x 语音分类 accept 过滤的教训），格式由读取后的
      // 内容校验兜底，选错文件会有明确提示
      pickFiles('', false, (files) => {
        const f = files && files[0];
        if (!f) return;
        const fname = f.name || '未命名文件';
        const fsize = f.size ? Math.max(1, Math.round(f.size / 1024)) + 'KB' : '空文件';
        // v3.26.x #171：iOS Safari 导 milk json 报「格式错误」——旧版一个 catch 把三类
        // 完全不同的失败（JSON 解析失败／文件转存损坏／导入处理自身抛错）混成同一句
        // 「文件格式不正确」，真因永远看不到。拆开：
        //   ① 解析失败给真实原因 + 针对性自救（UTF-16 转存重读／裁剪提取首{到末}／
        //      空文件=网盘未下载完整／网页=存成了 HTML），不再一律「格式错误」；
        //   ② applyImportData 抛错单独提示，存储类失败不再伪装成格式问题；
        //   ③ 失败现场写 __jsErrors → 设置页「复制诊断信息」直接带出真因（iOS 报障自证）。
        const reader = new FileReader();
        let rawHead = ''; // 诊断用文件头（先 slice 再 replace，绝不全文扫描——200MB 级文件全文 replace 本身就是一次 OOM 风险）
        const diag = (why) => {
          try {
            if (window.__jsErrors) window.__jsErrors.push('[字卡导入] ' + why + ' | ' + fname + '·' + fsize + ' | 开头: ' + rawHead);
          } catch (e0) {}
        };
        // v3.26.x #182：200MB 级字卡库在 iOS WebKit（含 iOS Chrome）上解析/写盘峰值可达 GB 级，
        // OOM（RangeError / Out of memory）会被旧提示误标成「格式错误」——统一识别给对应指引
        const oomErr = (e) => /rangeerror|out of memory|memory|内存/i.test(String((e && (e.message || e.name)) || e || ''));
        const applyOk = (data) => {
          try { applyImportData(data, mode); } catch (e) {
            toast(oomErr(e)
              ? '文件约 ' + Math.max(1, Math.round(f.size / 1048576)) + 'MB，本机内存不足以一次性导入——请先在「查看存储→字卡库瘦身」删掉超大表情/图片分组后重新导出分批导入，或改用「设置→数据备份」整包恢复'
              : '导入处理失败：' + ((e && e.message) || '内部错误') + '（' + fname + '）');
            diag('applyImportData 异常 ' + ((e && e.message) || e));
          }
        };
        const fail = (why) => { toast('导入失败：' + why + '（' + fname + '·' + fsize + '）'); diag(why); };
        const onReadErr = () => toast('导入失败：文件读取失败，请重选文件再试');
        // recover=已用过的自救方式（utf16/trim），非空则不再二次自救
        const handleText = (raw, recover) => {
          let txt = String(raw || '');
          // 部分安卓文件管理器/浏览器写入的 json 带 BOM/零宽字符，JSON.parse 会直接抛错
          txt = txt.replace(/^[\uFEFF\u200B\u200E\u200F]+/, '');
          if (!txt.trim()) { fail('文件内容为空——iCloud/网盘文件可能没下载完整，请在「文件」App 点开该文件确认有内容后再导入'); return; }
          let data = null, perr = null;
          try { data = JSON.parse(txt); } catch (e) { perr = e; }
          if (perr) {
            // v3.26.x #182：解析阶段 OOM（超大库）单独给瘦身/整包恢复指引
            if (oomErr(perr)) {
              fail('文件约 ' + Math.max(1, Math.round(f.size / 1048576)) + 'MB，本机内存不足以一次性解析导入——请先删掉超大表情/图片分组后重新导出分批导入，或改用「设置→数据备份」整包恢复');
              return;
            }
            // 自救①：微信/邮件/文本编辑转存常把文件变 UTF-16——按 UTF-8 读出来成串 NUL，
            // 数 NUL 落在奇/偶位定字节序，换对应编码重读一遍再走原流程
            if (!recover && /\u0000/.test(txt.slice(0, 400))) {
              let odd = 0, even = 0;
              for (let i = 0; i < Math.min(txt.length, 400); i++) { if (txt.charCodeAt(i) === 0) { if (i % 2) odd++; else even++; } }
              reader.onload = () => handleText(reader.result, 'utf16');
              reader.onerror = onReadErr;
              reader.readAsText(f, odd >= even ? 'utf-16le' : 'utf-16be');
              return;
            }
            // 自救②：转存时前后被包了说明文字/网页源码——裁出首个 { 到末个 } 再试
            // （#182：大文件不做——200MB 级 slice 复制一份本身就是 GB 级峰值推手，得不偿失）
            const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
            if (!recover && a >= 0 && b > a && (b - a) < 80 * 1024 * 1024) { handleText(txt.slice(a, b + 1), 'trim'); return; }
            const isHtml = txt.charAt(0) === '<' || /<html[\s>]/i.test(txt.slice(0, 200));
            fail(isHtml
              ? '文件是网页不是 JSON——请在 milk 里用导出按钮重新导出，分享时选「存储到文件」'
              : 'JSON 解析失败：' + ((perr && perr.message) || '内容不是合法 JSON') + (recover ? '（自救 ' + recover + ' 后仍失败）' : ''));
            return;
          }
          if (!data || typeof data !== 'object' || Array.isArray(data)) { fail('文件顶层不是 JSON 对象'); return; }
          // v3.26.x #182：进写盘阶段前松开源文本引用——JSON.stringify(groups) 是 200MB 级新分配，
          // 此刻源文本（同样 200MB 级）必须已是可回收状态，两个大头不能同时钉在堆上
          txt = ''; raw = null;
          applyOk(data);
        };
        reader.onload = () => {
          const raw = String(reader.result || '');
          rawHead = raw.slice(0, 300).replace(/\s+/g, ' ').slice(0, 120);
          // 松开 FileReader 对整份内容的持有（onload/onerror 引用一断，超大 result 随 reader 可回收；
          // 诊断只留 rawHead，绝不把 200MB 源文本带进写盘阶段）
          reader.onload = null; reader.onerror = null;
          handleText(raw, '');
        };
        // 读取失败（onload 不触发）旧版无任何提示，像「点了没反应」
        reader.onerror = onReadErr;
        reader.readAsText(f);
      });
    }
    // 按模式写入：merge 分组内去重合并；replace 先清空再按文件填充；current 全部并入目标分类；返回 {added, dup}
    function writeImport(byCat, mode, targetCat) {
      let added = 0, dup = 0;
      if (mode === 'replace') {
        groups = {};
        CC_ALL_TYPES.forEach(t => { groups[t] = []; });
        Object.keys(byCat).forEach(cat => {
          const pairs = byCat[cat];
          groups[cat] = pairs.map(([n, cs]) => [n, cs.slice()]);
          pairs.forEach(([, cs]) => { added += cs.length; });
        });
      } else if (mode === 'current' && targetCat) {
        // v3.8.x：把文件里全部字卡都并入用户当前所在的分类（如颜文字），
        // 解决「颜文字当初加到主字卡、导出后在 text 键、导入回来仍在主字卡」的归属问题
        if (!groups[targetCat]) groups[targetCat] = [];
        Object.keys(byCat).forEach(cat => {
          byCat[cat].forEach(([name, cards]) => {
            const exist = groups[targetCat].find(x => x[0] === name);
            if (!exist) { groups[targetCat].push([name, cards.slice()]); added += cards.length; return; }
            const seen = new Set(exist[1]);
            cards.forEach(c => {
              if (seen.has(c)) { dup++; return; }
              seen.add(c); exist[1].push(c); added++;
            });
          });
        });
      } else {
        Object.keys(byCat).forEach(cat => {
          if (!groups[cat]) groups[cat] = [];
          byCat[cat].forEach(([name, cards]) => {
            const exist = groups[cat].find(x => x[0] === name);
            if (!exist) { groups[cat].push([name, cards.slice()]); added += cards.length; return; }
            const seen = new Set(exist[1]);
            cards.forEach(c => {
              if (seen.has(c)) { dup++; return; }
              seen.add(c); exist[1].push(c); added++;
            });
          });
        });
      }
      return { added: added, dup: dup };
    }
    // 解析文件 → byCat（{ 分类: [[分组名, 字卡数组], ...] }），再按模式写入
    function applyImportData(data, mode) {
      const byCat = {};
      let imported = 0;
      let fmt = '';
      let fromBackup = false; // 全量备份提取标记：字卡计数由下方本应用格式分支统一做，计数后再补标签
      // v3.5.72：识别星言简约版聊天字卡库导出 json（globalCards + cardGroups 结构）
      //   v3.5.73 修正：专属字卡的字卡内容+分组也正常导入，仅不导入其绑定的联系人
      //   （Mochi 无专属联系人概念，天然忽略联系人；不跳过任何字卡）
      if (Array.isArray(data.globalCards)) {
        fmt = '（星言格式）';
        const starToMochiCat = { custom: 'text', kaomoji: 'kaomoji', emojis: 'emoji', stickers: 'sticker', image: 'image', touch: 'poke', voices: 'voice' };
        const groupById = {};
        (Array.isArray(data.cardGroups) ? data.cardGroups : []).forEach(g => { if (g && g.id) groupById[g.id] = g; });
        const imgs = (data.images && typeof data.images === 'object') ? data.images : {};
        const voices = (data.voices && typeof data.voices === 'object') ? data.voices : {};
        data.globalCards.forEach(c => {
          if (!c || typeof c !== 'object') return;
          let content = c.content;
          if (typeof content === 'string' && content.indexOf('__img__') === 0) {
            content = imgs[c.id] || '';
          } else if (typeof content === 'string' && content.indexOf('__voice__') === 0) {
            content = voices[c.id] || '';
          }
          if (typeof content !== 'string' || !content) return;
          // 分类映射（未知分类归入主字卡）
          const cat = starToMochiCat[c.category] || 'text';
          // 分组名：cardGroups 匹配 groupId；无则用「默认」
          let gname = '默认';
          if (c.groupId && groupById[c.groupId]) gname = groupById[c.groupId].name || '默认';
          else if (c.groupName) gname = c.groupName;
          if (!byCat[cat]) byCat[cat] = [];
          let g = byCat[cat].find(x => x[0] === gname);
          if (!g) { g = [gname, []]; byCat[cat].push(g); }
          g[1].push(content);
          imported++;
        });
      }
      // v3.6.x：识别 milk 字卡库导出 json（customReplies/customReplyGroups/customEmojis/stickerLibrary 结构）
      const milkCards = [
        { cat: 'text',    field: 'customReplies', groups: ['customReplyGroups'] },
        { cat: 'poke',    field: 'customPokes',   groups: ['customPokeGroups'] },
        { cat: 'kaomoji', field: ['customKaomojis', 'customKaomoji', 'kaomojiLibrary'], groups: ['customKaomojiGroups', 'kaomojiGroups'] },
        { cat: 'sticker', field: ['stickerLibrary', 'customStickers'], groups: ['customStickerGroups', 'stickerGroups'] },
        { cat: 'emoji',   field: 'customEmojis', groups: [] }
      ];
      if (!fmt && milkCards.some(mc => {
        const f = Array.isArray(mc.field) ? mc.field : [mc.field];
        return f.some(k => Array.isArray(data[k])) || mc.groups.some(k => Array.isArray(data[k]));
      })) {
        fmt = '（milk 格式）';
        const pickField = (keys) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) if (Array.isArray(data[k])) return data[k];
          return null;
        };
        // milk 分组（{id,name,color,disabled,items}）→ mochi 的 [分组名, 字卡数组]；未入组散卡归「未分组」
        const milkGroupPairs = (flat, grpKey) => {
          const pairs = [];
          const inGroup = new Set();
          const grpArr = grpKey ? data[grpKey] : null;
          if (Array.isArray(grpArr)) {
            grpArr.forEach(g => {
              if (!g || typeof g !== 'object') return;
              const name = String(g.name || '未分组');
              const cards = Array.isArray(g.items) ? g.items.filter(c => typeof c === 'string' && c) : [];
              if (!cards.length) return;
              cards.forEach(c => inGroup.add(c));
              const exist = pairs.find(x => x[0] === name);
              if (exist) exist[1] = exist[1].concat(cards);
              else pairs.push([name, cards.slice()]);
            });
          }
          if (Array.isArray(flat)) {
            const loose = flat.filter(c => typeof c === 'string' && c && !inGroup.has(c));
            if (loose.length) pairs.push(['未分组', loose]);
          }
          return pairs;
        };
        milkCards.forEach(mc => {
          const flat = pickField(mc.field);
          const grpKey = mc.groups.find(k => Array.isArray(data[k])) || null;
          const pairs = milkGroupPairs(flat, grpKey);
          if (!pairs.length) return;
          if (!byCat[mc.cat]) byCat[mc.cat] = [];
          pairs.forEach(([name, cards]) => { byCat[mc.cat].push([name, cards.slice()]); imported += cards.length; });
        });
      }
      // v3.23.x：识别「全量数据备份」json（设置→数据备份导出：{app:'mochi-zika', ls:{}, idb:{}}，
      // 文件名 mochi数据备份_*.json）。用户常把它当字卡库文件直接导入 → 旧逻辑只认字卡库
      // 导出格式，提示「文件里没有可导入的字卡」（公用/专属页表现一致）。这里按当前作用域
      // 从备份里取出字卡库键（公用 xy-home-v2:cc-groups-public / 专属 <前缀>:cc-groups），
      // 解析成标准格式后交给下方本应用格式分支正常导入
      // v3.26.x #253：bag/fromPubFallback 原声明在下方「全量备份提取」分支块内，而函数尾部
      // #139 防复制守卫要读它们——块级作用域不可见 ⇒ 任何格式（milk/星言/本应用/备份）只要
      // 成功解析出字卡、走到尾部守卫必抛 ReferenceError「fromPubFallback is not defined」
      //（#171 的 catch 提示成「导入处理失败」；华为Pro70+Edge 诊断启动文件异常三条实锤，
      // 机型无关）。提升到函数作用域，语义零变化：非备份格式 bag 恒空对象、标记恒 false。
      let bag = {}; // v3.26.x #253：从备份提取分支块内提升到函数作用域（仅备份分支填充，尾部 #139 守卫要读）
      let fromPubFallback = false; // v3.26.x #253：同上提升（#139 专属页兜底取到「公用库内容」时置位，落盘前防整份复制）
      if (!fmt && data && typeof data === 'object' &&
          ((data.ls && typeof data.ls === 'object') || (data.idb && typeof data.idb === 'object'))) {
        bag = {};
        ['ls', 'idb'].forEach(k => {
          if (data[k] && typeof data[k] === 'object' && !Array.isArray(data[k])) Object.assign(bag, data[k]);
        });
        let raw = '';
        if (ccScope === 'public') {
          raw = bag[PUB_PREFIX + ':' + PUB_KEY] || '';
        } else {
          const ap = (typeof window.activePrefix === 'function' && window.activePrefix()) || PUB_PREFIX;
          raw = bag[ap + ':cc-groups'] || '';
          if (!raw) {
            // 换机/重装后联系人前缀可能变化：兜底取内容最多的一个专属键
            let best = '';
            Object.keys(bag).forEach(k => {
              if (/^xy-home-v2:.+:cc-groups$/.test(k) && typeof bag[k] === 'string' && bag[k].length > best.length) best = bag[k];
            });
            raw = best;
          }
          // v3.26.x #139：公用库兜底放最后——诊断实证（三桌面专属库与公用库逐字节同大小，
          // ≈415MB 冗余）本分支是整份复制的来源之一：备份里没有当前桌面专属键时，把公用库
          // 内容导进专属键等于整份复制。保留兜底（换机后公用/专属归属判断失据时仍能拿回字卡），
          // 但落盘前用 fromPubFallback 守卫拦截「合并结果与公用库完全相同」的写入。
          if (!raw) { raw = bag[PUB_PREFIX + ':' + PUB_KEY] || ''; fromPubFallback = !!raw; }
        }
        try {
          const parsed = JSON.parse(String(raw || ''));
          const hasCards = parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
            CC_TYPES.some(t => Array.isArray(parsed[t]) && parsed[t].length);
          // 不能在这里设 fmt——下方本应用格式分支以 !fmt 为条件做字卡计数，
          // 提前置 fmt 会让 imported 恒为 0（「文件里没有可导入的字卡」误报）
          if (hasCards) { data = parsed; fromBackup = true; }
        } catch (e) {}
      }
      // 本应用格式（mochi 字卡库导出 json）
      if (!fmt) {
        ['text', 'kaomoji', 'emoji', 'sticker', 'image', 'poke', 'voice'].forEach(k => {
          const arr = data[k];
          if (!Array.isArray(arr)) return;
          arr.forEach(g => {
            if (!Array.isArray(g) || g.length < 2) return;
            const name = String(g[0]);
            const cards = Array.isArray(g[1]) ? g[1].filter(c => typeof c === 'string' && c) : [];
            if (!cards.length) return;
            if (!byCat[k]) byCat[k] = [];
            const exist = byCat[k].find(x => x[0] === name);
            if (exist) exist[1] = exist[1].concat(cards);
            else byCat[k].push([name, cards.slice()]);
            imported += cards.length;
          });
        });
      }
      if (fromBackup) fmt = fmt || '（全量备份提取）';
      // v3.6.x：媒体类字卡 dataURL 白名单校验——导入 json 里混入的
      // `data:image/png" onerror=…` 之类（能通过 indexOf 前缀判断）会逃逸出
      // 聊天渲染的 src 属性注入 HTML；这里只放行 base64 图片/音频，其余丢弃。
      // 安全依据：base64 字符集（A-Za-z0-9+/=）不含引号/尖括号，无法逃逸属性；
      // MIME 放宽到全部 image/*（png/jpeg/gif/webp/svg/x-icon 等旧库不误丢）
      // v3.11.x：放行链接导入产生的 http(s) 图片字卡——URL 白名单同样禁引号/
      // 尖括号/空白字符，维持「无法逃逸 src 属性」的安全保证
      const RE_IMG = /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]*$/;
      const RE_MEDIA_URL = /^https?:\/\/[^\s"'<>]+$/i;
      const RE_AUDIO = /^data:audio\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]*$/;
      let dropped = 0;
      ['image', 'sticker'].forEach(cat => {
        (byCat[cat] || []).forEach(pair => {
          const before = pair[1].length;
          pair[1] = pair[1].filter(c => { const s = String(c); return RE_IMG.test(s) || RE_MEDIA_URL.test(s); });
          dropped += before - pair[1].length;
        });
        byCat[cat] = (byCat[cat] || []).filter(pair => pair[1].length);
      });
      // 语音字卡：文件名|||音频dataURL
      if (byCat.voice) {
        byCat.voice.forEach(pair => {
          const before = pair[1].length;
          pair[1] = pair[1].filter(c => {
            const s = String(c);
            const p = s.indexOf('|||');
            return p > 0 && RE_AUDIO.test(s.slice(p + 3));
          });
          dropped += before - pair[1].length;
        });
        byCat.voice = byCat.voice.filter(pair => pair[1].length);
      }
      if (!imported) { toast('文件里没有可导入的字卡'); return; }
      const res = writeImport(byCat, mode, cur);
      // v3.26.x #139：防复制守卫——专属页兜底导入「公用库内容」且合并结果与备份里的公用库
      // 完全相同时不写专属键（写了就是整份复制）；回复池本就合并公用+专属，跳过零功能损失。
      // 专属库有自己的内容时合并结果必然不同，照常保存。
      if (fromPubFallback && ccScope === 'own') {
        let newRaw = '';
        try { newRaw = JSON.stringify(groups); } catch (e) {}
        const pubBagRaw = String(bag[PUB_PREFIX + ':' + PUB_KEY] || '');
        if (pubBagRaw && newRaw && newRaw === pubBagRaw) {
          pubInvalidate();
          renderGroupsBar();
          render();
          toast('备份的专属字卡库与公用库相同，已跳过写入专属库（公用字卡照常可用）');
          return;
        }
      }
      saveGroups(groups);
      renderGroupsBar();
      render();
      if (mode === 'replace') toast('已替换字卡库 · 共 ' + res.added + ' 张字卡' + fmt + (dropped ? '，丢弃 ' + dropped + ' 条非法媒体' : ''));
      else if (mode === 'current') toast('已导入 ' + res.added + ' 张字卡到「' + (CAT_NAMES[cur] || '当前分类') + '」' + fmt + (res.dup ? '，自动去重 ' + res.dup + ' 条' : '') + (dropped ? '，丢弃 ' + dropped + ' 条非法媒体' : ''));
      else toast('已导入 ' + res.added + ' 张字卡' + fmt + (res.dup ? '，自动去重 ' + res.dup + ' 条' : '') + (dropped ? '，丢弃 ' + dropped + ' 条非法媒体' : ''));
    }
  }

  // ================= v3.34.x：自定义字卡全量导入导出（字卡库列表页） =================
  // 需求：此前只有【公用字卡】【专属字卡】两入口有导入导出，自定义区其余各库都没有出入口
  //（功能卡存在 cc-groups 内随双作用域走；寻踪日常/今日情话/TA 六类题库的「我的添加」各自散落）。
  // 这里在字卡库列表页提供一份覆盖全部自定义字卡的 json：
  //   聊天字卡双作用域（公用 cc-groups-public / 专属 cc-groups，含 13 功能分类与分组停用开关）
  //   + 寻踪日常三分类（checkin-cards-* 我的添加+自定义分组）
  //   + 今日情话（quote-cards 我的添加+自定义分组）
  //   + TA 六类题库（ta-ask/ta-choose/ta-curious/ta-roast/ta-checkin/ta-invite 的 questions+groups，
  //     不含 settings/问答历史——只搬字卡，概率/开关等属功能设置不随库迁移）。
  // 导入支持 追加合并（按内容去重）/ 整包替换（以文件为准）；读写前先走 hydrateLibScopes
  // 权威取回（v3.15.x 懒加载收口同款），避免大键挂起在 IDB 时按空快照读写（#193 同防线）。
  const CC_FULL_MARK = 'mochi-ccfull';
  const CC_FULL_CK_KEYS = ['place', 'action', 'msg'];
  const CC_FULL_TA_LIBS = [['taAsk', 'ta-ask'], ['taChoose', 'ta-choose'], ['taCurious', 'ta-curious'], ['taRoast', 'ta-roast'], ['taCheckin', 'ta-checkin'], ['taInvite', 'ta-invite']];
  function ccFullRd(st, k, dft) {
    try { const v = JSON.parse(st.get(k) || 'null'); return v == null ? dft : v; } catch (e) { return dft; }
  }
  function ccFullCardCount(g) {
    let n = 0;
    try { Object.keys(g || {}).forEach(t => (g[t] || []).forEach(x => { if (Array.isArray(x) && Array.isArray(x[1])) n += x[1].length; })); } catch (e) {}
    return n;
  }
  function ccFullNormCc(o) {
    const out = (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    CC_ALL_TYPES.forEach(t => { if (!Array.isArray(out[t])) out[t] = []; });
    return out;
  }
  // cc 双作用域合并：同分类同名分组内按字卡内容去重追加，没有的分组整组补入
  function ccFullMergeCc(cur, inc) {
    const out = ccFullNormCc(cur);
    let added = 0;
    Object.keys(inc || {}).forEach(t => {
      if (!Array.isArray(inc[t])) return;
      if (!Array.isArray(out[t])) out[t] = [];
      inc[t].forEach(pair => {
        if (!Array.isArray(pair) || !pair[0] || typeof pair[0] !== 'string') return;
        const name = pair[0];
        const cards = Array.isArray(pair[1]) ? pair[1].filter(c => typeof c === 'string' && c) : [];
        let g = null;
        for (let i = 0; i < out[t].length; i++) { if (Array.isArray(out[t][i]) && out[t][i][0] === name) { g = out[t][i]; break; } }
        if (!g) { g = [name, []]; out[t].push(g); }
        const have = new Set(g[1]);
        cards.forEach(c => { if (!have.has(c)) { g[1].push(c); have.add(c); added++; } });
      });
    });
    return { obj: out, added: added };
  }
  // 寻踪/情话条目合并：旧字符串与新 {t,grp} 对象统一归一后按文本去重
  function ccFullNormItem(x) {
    if (typeof x === 'string') return x.trim() ? { t: x.trim() } : null;
    if (x && typeof x === 'object' && x.t != null && String(x.t).trim()) {
      const o = { t: String(x.t).trim() };
      if (x.grp) o.grp = String(x.grp);
      return o;
    }
    return null;
  }
  function ccFullMergeItems(cur, inc) {
    const arr = (Array.isArray(cur) ? cur : []).map(ccFullNormItem).filter(Boolean);
    const have = {};
    arr.forEach(x => { have[x.t] = true; });
    let added = 0;
    (Array.isArray(inc) ? inc : []).forEach(x => {
      const n = ccFullNormItem(x);
      if (n && !have[n.t]) { arr.push(n); have[n.t] = true; added++; }
    });
    return { list: arr, added: added };
  }
  // 自定义分组定义（[{id,name}]）合并：按 id 或名称去重
  function ccFullMergeGrpDefs(cur, inc) {
    const arr = (Array.isArray(cur) ? cur : []).filter(g => g && g.id && g.name);
    const byId = {}, byName = {};
    arr.forEach(g => { byId[g.id] = true; byName[g.name] = true; });
    let added = 0;
    (Array.isArray(inc) ? inc : []).forEach(g => {
      if (!g || !g.id || !g.name) return;
      if (byId[g.id] || byName[g.name]) return;
      arr.push({ id: g.id, name: g.name });
      byId[g.id] = true; byName[g.name] = true; added++;
    });
    return { list: arr, added: added };
  }
  // TA 六类题库合并：按题目文本/ID 去重并入 questions（文件含系统预设，同文本不重复）+ 分组；
  // 不动 settings/mergedIds/问答历史——各模块下次 load 按既有 merge 规则自行补齐预设
  function ccFullMergeTa(key, inc) {
    const cur = ccFullRd(store, key, null);
    const base = (cur && typeof cur === 'object' && !Array.isArray(cur)) ? cur : {};
    if (!Array.isArray(base.questions)) base.questions = [];
    if (!Array.isArray(base.groups)) base.groups = [];
    const haveId = {}, haveText = {};
    base.questions.forEach(q => { if (q && typeof q === 'object') { if (q.id) haveId[q.id] = true; if (q.text != null && String(q.text)) haveText[String(q.text)] = true; } });
    let added = 0;
    (Array.isArray(inc.questions) ? inc.questions : []).forEach(q => {
      if (!q || typeof q !== 'object') return;
      const t = q.text != null ? String(q.text) : '';
      if (!t.trim()) return;
      if (q.id && haveId[q.id]) return;
      if (haveText[t]) return;
      const nq = Object.assign({}, q);
      if (!nq.id) nq.id = 'q' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36) + added;
      base.questions.push(nq);
      haveId[nq.id] = true; haveText[t] = true; added++;
    });
    base.groups = ccFullMergeGrpDefs(base.groups, inc.groups).list;
    store.set(key, JSON.stringify(base));
    return added;
  }
  // 分组停用开关合并：并集（同分类同名分组）
  function ccFullMergeOff(st, key, inc) {
    const cur = ccFullRd(st, key, {});
    const o = (cur && typeof cur === 'object' && !Array.isArray(cur)) ? cur : {};
    Object.keys(inc || {}).forEach(t => {
      if (!Array.isArray(inc[t])) return;
      if (!Array.isArray(o[t])) o[t] = [];
      inc[t].forEach(n => { if (typeof n === 'string' && o[t].indexOf(n) < 0) o[t].push(n); });
    });
    st.set(key, JSON.stringify(o));
  }
  const liCcFullExport = document.getElementById('li-cc-full-export');
  if (liCcFullExport) {
    liCcFullExport.addEventListener('click', () => {
      const build = () => {
        try {
          const data = {};
          data.ccPub = ccFullNormCc(ccFullRd(pubStore(), PUB_KEY, null));
          data.ccOwn = ccFullNormCc(ccFullRd(store, 'cc-groups', null));
          data.ccPubOff = ccFullRd(pubStore(), PUB_OFF_KEY, null);
          data.ccOwnOff = ccFullRd(store, OFF_KEY, null);
          data.checkin = {};
          CC_FULL_CK_KEYS.forEach(k => {
            data.checkin[k] = {
              list: ccFullRd(store, 'checkin-cards-' + k, []),
              groups: ccFullRd(store, 'checkin-cards-groups-' + k, [])
            };
          });
          data.quote = {
            list: ccFullRd(store, 'quote-cards', []),
            groups: ccFullRd(store, 'quote-cards-groups', [])
          };
          CC_FULL_TA_LIBS.forEach(([name, key]) => {
            const d = ccFullRd(store, key, null);
            data[name] = (d && typeof d === 'object' && !Array.isArray(d))
              ? { questions: Array.isArray(d.questions) ? d.questions : [], groups: Array.isArray(d.groups) ? d.groups : [] }
              : { questions: [], groups: [] };
          });
          let nItems = 0, nTa = 0;
          CC_FULL_CK_KEYS.forEach(k => { nItems += Array.isArray(data.checkin[k].list) ? data.checkin[k].list.length : 0; });
          nItems += Array.isArray(data.quote.list) ? data.quote.list.length : 0;
          CC_FULL_TA_LIBS.forEach(([name]) => { nTa += Array.isArray(data[name].questions) ? data[name].questions.length : 0; });
          const out = { app: CC_FULL_MARK, v: 1, time: Date.now(), data: data };
          // #506：cc 双作用域同样先还原媒体池令牌再落文件
          Promise.all([ccExportExpandTokens(data.ccPub), ccExportExpandTokens(data.ccOwn)]).then(rs => {
            const okN = rs[0].ok + rs[1].ok, missN = rs[0].miss + rs[1].miss;
            const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'mochi自定义字卡全量.json';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 300);
            toast('已导出全量字卡：聊天字卡 ' + (ccFullCardCount(data.ccPub) + ccFullCardCount(data.ccOwn)) + ' 张 · 寻踪/情话 ' + nItems + ' 条 · TA 题库 ' + nTa + ' 题' +
              (okN ? ' · ' + okN + ' 张图片已从媒体池还原进文件' : '') +
              (missN ? '；' + missN + ' 张图片数据缺失无法还原' : ''));
          });
        } catch (e) { toast('导出失败：' + ((e && e.message) || '内部错误')); }
      };
      // 导出前也走权威取回链：挂起在 IDB 的大键先拉回 store 再读（与列表页角标同一防线）
      Promise.resolve(hydrateLibScopes(['public', 'own'])).then(build);
    });
  }
  const liCcFullImport = document.getElementById('li-cc-full-import');
  if (liCcFullImport) {
    liCcFullImport.addEventListener('click', () => {
      if (!window.openModal) return;
      window.openModal('导入自定义字卡（全量）', '', (mode) => { ccFullPickFile(mode); }, {
        noInput: true,
        staticText: '选择导入方式：\n· 追加合并：保留现有字卡，按内容去重并入（推荐）\n· 整包替换：文件里包含的各库清空后完全使用文件内容，未包含在文件里的现有字卡会丢失',
        pills: [
          { label: '追加合并（自动去重）', value: 'merge' },
          { label: '整包替换（覆盖现有）', value: 'replace' }
        ],
        pill: 'merge'
      });
    });
    function ccFullPickFile(mode) {
      // accept 放开为全文件（同字卡库导入 v3.23.x 口径：部分安卓壳对 .json 过滤灰显），
      // 格式由读取后的内容校验兜底
      pickFiles('', false, (files) => {
        const f = files && files[0];
        if (!f) return;
        const fname = f.name || '未命名文件';
        const reader = new FileReader();
        const fail = (why) => toast('导入失败：' + why + '（' + fname + '）');
        const handleText = (raw, recover) => {
          let txt = String(raw || '');
          txt = txt.replace(/^[\uFEFF\u200B\u200E\u200F]+/, '');
          if (!txt.trim()) { fail('文件内容为空——iCloud/网盘文件可能没下载完整'); return; }
          let data = null, perr = null;
          try { data = JSON.parse(txt); } catch (e) { perr = e; }
          if (perr) {
            if (/rangeerror|out of memory|内存/i.test(String((perr && (perr.message || perr.name)) || perr || ''))) { fail('文件过大，本机内存不足以一次性解析导入'); return; }
            // 自救①：转存变 UTF-16（读出成串 NUL）——按字节序换编码重读一遍
            if (!recover && /\u0000/.test(txt.slice(0, 400))) {
              let odd = 0, even = 0;
              for (let i = 0; i < Math.min(txt.length, 400); i++) { if (txt.charCodeAt(i) === 0) { if (i % 2) odd++; else even++; } }
              reader.onload = () => handleText(reader.result, 'utf16');
              reader.onerror = () => fail('文件读取失败');
              reader.readAsText(f, odd >= even ? 'utf-16le' : 'utf-16be');
              return;
            }
            // 自救②：前后被包了说明文字/网页源码——裁出首个 { 到末个 } 再试
            const ja = txt.indexOf('{'), jb = txt.lastIndexOf('}');
            if (!recover && ja >= 0 && jb > ja && (jb - ja) < 80 * 1024 * 1024) { handleText(txt.slice(ja, jb + 1), 'trim'); return; }
            fail('JSON 解析失败：' + ((perr && perr.message) || '内容不是合法 JSON'));
            return;
          }
          txt = ''; raw = null;
          const d = (data && typeof data === 'object' && !Array.isArray(data)) ? data.data : null;
          if (!d || typeof d !== 'object' || data.app !== CC_FULL_MARK) {
            fail('不是「自定义字卡·全量导出」文件——公用/专属聊天字卡请进对应管理页用「导入数据」，整包恢复请用「设置→数据备份」');
            return;
          }
          // 大键先走权威取回链（同导出口径），落定后再合并/替换写入
          Promise.resolve(hydrateLibScopes(['public', 'own'])).then(() => { ccFullApply(d, mode); });
        };
        reader.onload = () => {
          const raw = String(reader.result || '');
          reader.onload = null; reader.onerror = null;
          handleText(raw, '');
        };
        reader.onerror = () => toast('导入失败：文件读取失败，请重选文件再试');
        reader.readAsText(f);
      });
    }
    function ccFullApply(d, mode) {
      try {
        const stat = { cc: 0, items: 0, ta: 0 };
        if (mode === 'replace') {
          // 整包替换：文件里包含的各库清空后按文件写入；文件里没有的库不动
          if (d.ccPub && typeof d.ccPub === 'object') { const o = ccFullNormCc(d.ccPub); pubStore().set(PUB_KEY, JSON.stringify(o)); stat.cc += ccFullCardCount(o); }
          if (d.ccOwn && typeof d.ccOwn === 'object') { const o = ccFullNormCc(d.ccOwn); store.set('cc-groups', JSON.stringify(o)); stat.cc += ccFullCardCount(o); }
          if (d.ccPubOff && typeof d.ccPubOff === 'object') pubStore().set(PUB_OFF_KEY, JSON.stringify(d.ccPubOff));
          if (d.ccOwnOff && typeof d.ccOwnOff === 'object') store.set(OFF_KEY, JSON.stringify(d.ccOwnOff));
          CC_FULL_CK_KEYS.forEach(k => {
            const c = d.checkin && d.checkin[k];
            if (!c || typeof c !== 'object') return;
            store.set('checkin-cards-' + k, JSON.stringify(Array.isArray(c.list) ? c.list : []));
            store.set('checkin-cards-groups-' + k, JSON.stringify(Array.isArray(c.groups) ? c.groups : []));
            stat.items += Array.isArray(c.list) ? c.list.length : 0;
          });
          if (d.quote && typeof d.quote === 'object') {
            store.set('quote-cards', JSON.stringify(Array.isArray(d.quote.list) ? d.quote.list : []));
            store.set('quote-cards-groups', JSON.stringify(Array.isArray(d.quote.groups) ? d.quote.groups : []));
            stat.items += Array.isArray(d.quote.list) ? d.quote.list.length : 0;
          }
          CC_FULL_TA_LIBS.forEach(([name, key]) => {
            const inc = d[name];
            if (!inc || typeof inc !== 'object') return;
            store.set(key, JSON.stringify({
              questions: Array.isArray(inc.questions) ? inc.questions : [],
              groups: Array.isArray(inc.groups) ? inc.groups : []
            }));
            stat.ta += Array.isArray(inc.questions) ? inc.questions.length : 0;
          });
        } else {
          if (d.ccPub && typeof d.ccPub === 'object') { const r = ccFullMergeCc(ccFullRd(pubStore(), PUB_KEY, {}), d.ccPub); pubStore().set(PUB_KEY, JSON.stringify(r.obj)); stat.cc += r.added; }
          if (d.ccOwn && typeof d.ccOwn === 'object') { const r = ccFullMergeCc(ccFullRd(store, 'cc-groups', {}), d.ccOwn); store.set('cc-groups', JSON.stringify(r.obj)); stat.cc += r.added; }
          if (d.ccPubOff && typeof d.ccPubOff === 'object') ccFullMergeOff(pubStore(), PUB_OFF_KEY, d.ccPubOff);
          if (d.ccOwnOff && typeof d.ccOwnOff === 'object') ccFullMergeOff(store, OFF_KEY, d.ccOwnOff);
          CC_FULL_CK_KEYS.forEach(k => {
            const c = d.checkin && d.checkin[k];
            if (!c || typeof c !== 'object') return;
            const r1 = ccFullMergeItems(ccFullRd(store, 'checkin-cards-' + k, []), c.list);
            store.set('checkin-cards-' + k, JSON.stringify(r1.list));
            store.set('checkin-cards-groups-' + k, JSON.stringify(ccFullMergeGrpDefs(ccFullRd(store, 'checkin-cards-groups-' + k, []), c.groups).list));
            stat.items += r1.added;
          });
          if (d.quote && typeof d.quote === 'object') {
            const r1 = ccFullMergeItems(ccFullRd(store, 'quote-cards', []), d.quote.list);
            store.set('quote-cards', JSON.stringify(r1.list));
            store.set('quote-cards-groups', JSON.stringify(ccFullMergeGrpDefs(ccFullRd(store, 'quote-cards-groups', []), d.quote.groups).list));
            stat.items += r1.added;
          }
          CC_FULL_TA_LIBS.forEach(([name, key]) => {
            const inc = d[name];
            if (!inc || typeof inc !== 'object') return;
            stat.ta += ccFullMergeTa(key, inc);
          });
        }
        pubInvalidate();
        refreshLibCounts(true);
        // 其他库的列表页角标由各自模块维护——暴露的刷新函数存在就同步刷一把
        if (window.quoteCardsRefreshCounts) { try { window.quoteCardsRefreshCounts(); } catch (e) {} }
        if (window.ckCardsRefreshCounts) { try { window.ckCardsRefreshCounts(); } catch (e) {} }
        toast(mode === 'replace'
          ? '已整包替换：聊天字卡 ' + stat.cc + ' 张 · 寻踪/情话 ' + stat.items + ' 条 · TA 题库 ' + stat.ta + ' 题'
          : '已合并导入：聊天字卡新增 ' + stat.cc + ' 张 · 寻踪/情话新增 ' + stat.items + ' 条 · TA 题库新增 ' + stat.ta + ' 题');
      } catch (e) {
        toast('导入处理失败：' + ((e && e.message) || '内部错误'));
        try { if (window.__jsErrors) window.__jsErrors.push('[字卡全量导入] ' + ((e && e.message) || e)); } catch (e0) {}
      }
    }
  }

  // ================= 清除全部字卡（v3.6.x） =================
  // 一键清空所有分类的全部字卡与全部分组；危险操作，需二次确认
  const ccClearAll = document.getElementById('cc-clear-all');
  if (ccClearAll) {
    ccClearAll.addEventListener('click', () => {
      if (window.openModal) {
        const total = totalCount(groups);
        window.openModal('清除全部字卡？', '', () => {
          // 各分类全清：字卡与分组一起删除，字卡库回到空状态
          Object.keys(groups).forEach(t => {
            groups[t] = [];
          });
          // 退出管理模式、清空搜索与分组筛选，回到全部视图
          if (manageMode) exitManage();
          q = '';
          curGroup = '';
          const si = document.getElementById('cc-search-input');
          if (si) si.value = '';
          selected.clear();
          saveGroups(groups);
          renderGroupsBar();
          render();
          toast('已清除全部字卡与分组');
        }, { noInput: true, staticText: '将删除全部 ' + total + ' 张字卡及所有分组（主字卡、颜文字、emoji、表情包、图片、拍一拍、语音及其他互动功能字卡），且无法恢复。确定继续吗？' });
      }
    });
  }

  // 批量导入：文字分类按【分组名】导入；【表情包】【图片】分类直接上传图片
  // v3.6.x：批量导入弹窗顶部「确定」按钮——安卓下多行输入被转成可自动增高的
  // ce-box，导入内容多时弹窗变高、底部「确定」滚出视野；在弹窗顶部标题栏右侧
  // 常驻一个「确定」按钮（复用底部按钮的点击，仅批量导入多行弹窗显示，
  // 弹窗关闭即还原，不影响其他弹窗）
  function showImportTopOk() {
    const mask = document.getElementById('modal-mask');
    const modal = mask ? mask.querySelector('.modal') : null;
    const title = document.getElementById('modal-title');
    if (!mask || !modal || !title) return;
    // 顶部条：标题 + 确定按钮（标题元素本身不动，仅换父节点，不影响其他逻辑读写它）
    let bar = document.getElementById('cc-modal-topbar');
    if (!bar || bar.parentNode !== modal) {
      bar = document.createElement('div');
      bar.id = 'cc-modal-topbar';
      bar.className = 'cc-modal-topbar';
      const btn = document.createElement('button');
      btn.id = 'cc-modal-top-ok';
      btn.className = 'cc-modal-top-ok';
      btn.textContent = '确定';
      btn.addEventListener('click', () => {
        const ok = document.getElementById('modal-ok');
        if (ok) ok.click();
      });
      bar.appendChild(btn);
      modal.insertBefore(bar, title);
      bar.insertBefore(title, btn);
    }
    // 监听弹窗关闭（确定/取消/遮罩/Enter）：还原标题位置并移除顶部条，
    // 下次打开其他弹窗不受影响
    if (mask && !mask.__ccTopOkWatch) {
      mask.__ccTopOkWatch = true;
      new MutationObserver(() => {
        if (!mask.hidden) return;
        const b = document.getElementById('cc-modal-topbar');
        if (b && b.parentNode === modal) {
          modal.insertBefore(title, b);
          b.remove();
        }
      }).observe(mask, { attributes: true, attributeFilter: ['hidden'] });
    }
  }
  const impBtn = document.getElementById('cc-import');
  if (impBtn) {
    impBtn.addEventListener('click', () => {
      // 媒体分类：表情包/图片上传图片，语音上传音频
      // v3.16.x：iOS Safari「文件」选择器会按 accept 过滤文件——accept="audio/*" 时只
      // 放行系统识别为音频的文件，amr/silk/无扩展名等语音导出文件会被灰显不可选（用户
      // 反馈公用/专属字卡语音无法上传「梦角语音文件」）。语音分类改为不限制类型
      //（全文件可选），选完后在回调里按 MIME/扩展名校验，非音频直接跳过，绝不当作音频存库。
      if (IMG_TYPES[cur]) {
        pickFiles(cur === 'voice' ? '' : 'image/*', true, (files) => {
          if (!files.length) return;
          if (!groups[cur]) groups[cur] = [];
          // 目标分组：当前选中分组，否则默认分组（表情包/图片），再否则新建
          let g = null;
          if (curGroup) {
            g = groups[cur].find(g => g[0] === curGroup);
            if (!g) { g = [curGroup, []]; groups[cur].push(g); }
          } else {
            const defName = IMG_TYPES[cur];
            g = groups[cur].find(g => g[0] === defName);
            if (!g) { g = [defName, []]; groups[cur].push(g); }
          }
          let done = 0;
          let skipped = 0;
          let notAudio = 0;
          let gifSaved = 0;  // 动图直存（跳过压缩）计数
          let cmpSaved = 0;  // 静态图压缩成功计数
          // v3.6.x：上传大小限制——语音不压缩直接存 dataURL（字符串膨胀约 33%），
          // 超大音频会撑爆手机内存/IDB；图片虽有 260px 压缩兜底，原图读取也占峰值内存。
          // 语音限 10MB、图片限 20MB，超出跳过并提示
          const sizeLimit = cur === 'voice' ? 10 * 1024 * 1024 : 20 * 1024 * 1024;
          files.forEach((f) => {
            if (f.size > sizeLimit) {
              skipped++;
              done++;
              if (done === files.length) finishUpload(done - skipped, skipped);
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              // v3.13.x：语音分类里用户可能误传视频（安卓文件管理器常忽略 accept 过滤）——
              // 视频 MIME 直接跳过，绝不当作音频存。存了播放只会空白/报错，还拖慢整库序列化
              // v3.16.x：accept 放宽后（iOS Files 按 audio/* 过滤会让 amr/silk/无扩展名等
              // 语音文件灰显不可选）文件可能是任意类型——非视频也非音频（MIME 不是 audio/
              // 且扩展名推导不出音频 MIME）的一律跳过，避免把图片/文档/视频硬塞进语音库
              if (cur === 'voice') {
                const rvm = /^data:([^;,]*);/.exec(reader.result || '');
                const rvMime = rvm ? rvm[1] : '';
                const isVideo = (f.type && f.type.indexOf('video/') === 0) || rvMime.indexOf('video/') === 0;
                const isAudio = audioMimeFromName(f.name) || (f.type && f.type.indexOf('audio/') === 0) || rvMime.indexOf('audio/') === 0;
                if (isVideo || !isAudio) {
                  notAudio++;
                  done++;
                  if (done === files.length) finishUpload(done - skipped - notAudio, skipped, notAudio);
                  return;
                }
              }
              const process = (data) => {
                // 语音：存 "文件名|||音频数据"，图片/表情：存图片 dataURL
                // v3.6.x：文件名去掉 mp3/mp4 等后缀（聊天里语音名称不显示 .mp3/.mp4）
                const val = cur === 'voice' ? ((f.name || '音频').replace(/\.[^.]+$/, '') + '|||' + data) : data;
                // FIX 2026-09-16 #554（TASKS #128）字卡媒体令牌化持久化·上传口：
                // 表情包/图片 ≥CC_CC_TOK_MIN 先写媒体池、库键只存 @@m: 令牌——同一张图全库
                // （公用+各专属，哈希寻址）只存一份。池写失败/非安全上下文回退内联原值，
                // 上传永不因池失败而丢图；令牌渲染/导出还原/GC 保护消费方均已就绪（见迁移函数注释）。
                const commit = (v) => { g[1].push(v); done++; if (done === files.length) finishUpload(done - skipped, skipped); };
                if (cur !== 'voice' && window.mochiMediaTokenize && typeof data === 'string' && data.length >= CC_CC_TOK_MIN) {
                  try { window.mochiMediaTokenize(data).then((tok) => commit(tok || val)).catch(() => commit(val)); return; } catch (e) { commit(val); return; }
                }
                commit(val);
              };
              // v3.8.x：语音先归一化 MIME（安卓/雨见下 File.type 为空时 dataURL 无 audio/ 前缀，
              // 会触发乱码+无法播放），再存文件
              if (cur === 'voice') process(normalizeAudioDataURL(reader.result, f));
              else {
                // v3.7.x：GIF 动图跳过 canvas 压缩——canvas 只能画出第一帧，
                // 重绘成 PNG/JPEG 会把动图压成静态图，这里直存原图保留动画
                const isGif = /image\/gif/i.test(f.type || '') || /\.gif$/i.test(f.name || '');
                if (isGif) {
                  // v3.26.x #139：直存原图前拦截超大 GIF（超限跳过并提示，与压缩失败同路径）
                  if (String(reader.result || '').length > CC_GIF_MAX_B64) {
                    skipped++; done++;
                    if (done === files.length) finishUpload(done - skipped, skipped);
                    toast('GIF「' + ((f && f.name) || '动图') + '」超过 380KB，已跳过');
                    return;
                  }
                  gifSaved++;
                  process(reader.result); return;
                }
                // v3.7.x：原 260px 在 3x 高清屏被放大 2~3 倍导致模糊。
                //   图片分类当大图显示，压到 720px JPEG 0.85；表情包多小图且需透明背景，用 PNG 480px
                const isImg = cur === 'image';
                compressImage(reader.result, isImg ? 720 : 480, isImg ? 'image/jpeg' : 'image/png', isImg ? 0.85 : undefined).then((data) => {
                  // v3.6.x：压缩失败/图片过大返回 null——不存原图（防 iOS 解码崩溃），跳过并提示
                  if (!data) { skipped++; done++; if (done === files.length) finishUpload(done - skipped, skipped); return; }
                  cmpSaved++;
                  process(data);
                });
              }
            };
            reader.readAsDataURL(f);
          });
          function finishUpload(ok, skip, skipNotAudio) {
            // v3.27.x：持久化延后——同批量导入，避免同步序列化大库阻塞
            scheduleSave();
            renderGroupsBar();
            render();
            const msgs = [];
            if (ok > 0) msgs.push('已上传 ' + ok + ' 个' + (cur === 'voice' ? '音频' : '图片'));
            if (gifSaved > 0) msgs.push('动图无法压缩，「' + gifSaved + '」个按原图存入');
            if (cmpSaved > 0) msgs.push('已自动压缩 ' + cmpSaved + ' 个静态图');
            if (skip > 0) msgs.push('跳过 ' + skip + ' 个超大文件（' + (cur === 'voice' ? '音频>10MB' : '图片>20MB') + '）');
            if (skipNotAudio > 0) msgs.push('跳过 ' + skipNotAudio + ' 个视频/非音频（语音分类只支持音频）');
            if (!msgs.length) msgs.push('没有可上传的文件');
            toast(msgs.join('，'));
          }
        });
        return;
      }
      // 文字分类：批量导入（一行一个；按【组名】识别分组 / txt 文件）
      if (window.openModal) {
        // v3.6.x：先注入顶部「确定」按钮，再打开弹窗（内容多时底部按钮滚出视野）
        showImportTopOk();
        window.openModal('批量导入字卡（一行一个）', '', (raw, targetGroup) => {
          // 一行一个字卡：统一按 \r\n / \r / \n 拆分——部分手机浏览器/剪贴板来源的换行是 \r，
          // 只按 \n 拆会把多行并成一行，全部混进同一个字卡
          const lines = String(raw || '').split(/\r\n|\r|\n/).map(l => l.trim()).filter(Boolean);
          if (!lines.length) { toast('没有可导入的内容'); return; }
          if (!groups[cur]) groups[cur] = [];
          let curGrp = null;
          let imported = 0;
          let dup = 0;
          let newGroups = 0;
          // 同一分组内自动去重：分组已有字卡 + 本次已导入的都算，重复内容跳过
          const seenMap = new Map();
          const pushCard = (g, card) => {
            let seen = seenMap.get(g);
            if (!seen) { seen = new Set(g[1]); seenMap.set(g, seen); }
            if (seen.has(card)) { dup++; return false; }
            seen.add(card);
            g[1].push(card);
            return true;
          };
          if (targetGroup) {
            let g = groups[cur].find(g => g[0] === targetGroup);
            if (!g) { g = [targetGroup, []]; groups[cur].push(g); }
            curGrp = g;
          }
          lines.forEach(line => {
            const m = line.match(/^[【\[](.*?)[】\]](.*)$/);
            if (m && m[1].trim()) {
              const gname = m[1].trim();
              let g = groups[cur].find(g => g[0] === gname);
              if (!g) { g = [gname, []]; groups[cur].push(g); newGroups++; }
              curGrp = g;
              const rest = (m[2] || '').trim();
              if (rest && pushCard(g, rest)) imported++;
              return;
            }
            if (curGrp) {
              if (pushCard(curGrp, line)) imported++;
            } else {
              let g = groups[cur].find(g => g[0] === '未分组');
              if (!g) { g = ['未分组', []]; groups[cur].push(g); newGroups++; }
              if (pushCard(g, line)) imported++;
            }
          });
          // v3.27.x：持久化延后——saveGroups 同步序列化整个字卡库（含表情包/图片 dataURL
          //   可达几 MB~几十 MB）会阻塞主线程，与编辑单卡（openEditCard）同用 scheduleSave。
          //   内存 groups 已更新，render() 立即用内存数据渲染，写 LS+IDB 延后到下一帧
          scheduleSave();
          renderGroupsBar();
          render();
          toast('已导入 ' + imported + ' 条字卡' + (dup ? '，自动去重 ' + dup + ' 条' : '') + (newGroups ? '，新建 ' + newGroups + ' 个分组' : ''));
        }, {
          // FIX 2026-09-07 #255：批量导入弹窗放大——默认 .modal 宽 272px 多行框太小
          //（用户报障「打开的页面太小了」），走 opts.big 宽版（420px/94vw + 52vh 上限）。
          // textareaRows 同时决定两端初始高度：iOS 原生 textarea 直接按 rows 显示行数；
          // 安卓被 mobile-adapt 转 .ce-box 后读 rows 算 min-height（rows*1.5*16）。初始就
          // 给足 14 行方便一次粘贴/录入多条字卡，超过 52vh 上限后框内滚动（.modal-textarea
          // 既有 overflow-y:auto）——用户反馈「批量导入输入框太小只有 3 行，要加长可滑动」
          big: true,
          textarea: true,
          textareaRows: 14,
          textareaPlaceholder: '【日常】\n你今天真好看\n我想你了',
          txtImport: true,
          // v3.6.x：传入当前分类的现有分组——openModal 的「目标分组」下拉只在
          // opts.groups 非空时显示；此前漏传，弹窗里永远没有分组选择框，
          // 只能靠【组名】前缀识别（回调的 targetGroup 逻辑一直在但从未触发）
          groups: (groups[cur] || []).map(g => g[0])
        });
      }
    });
  }

  // FIX 2026-09-15 #508：链接导入按钮只属于【表情包】【图片】两个媒体分类——按钮常驻
  // 工具栏导致其余大分类 tab（主字卡/颜文字/emoji/拍一拍/语音/功能分类）也显示，
  // 点了只吃 toast 拦截（用户反馈）。切分类/进页时按当前分类显隐；弹窗前的分类守卫
  // 保留作兜底。
  function syncLinkImportVis() {
    const b = document.getElementById('cc-import-link');
    if (!b) return;
    b.style.display = (cur === 'sticker' || cur === 'image') ? '' : 'none';
  }

  // ================= 链接导入图片（v3.11.x，单链接/批量链接通用） =================
  // 【表情包】【图片】分类：粘贴图片 URL（一行一个）导入。
  // 优先 fetch 抓取 → 与上传同一压缩管线转存 dataURL（离线可用、聊天/收藏全兼容）；
  // 图床不允许跨域读取（CORS）/网络失败时回退存原始 http(s) 链接（需联网显示，
  // 聊天气泡按 type 渲染 <img src> 对远程链接天然兼容）；响应不是图片则判失败不存。
  // 拆行 + 清洗粘贴带上的尖括号/引号包裹，只放行 http(s) 地址；
  // 支持行首【组名】前缀指定落点分组（与文字批量导入同一写法）
  function splitUrlItems(raw) {
    return String(raw || '').split(/\r\n|\r|\n/)
      .map(l => l.trim()).filter(Boolean)
      .map(line => {
        const m = line.match(/^[【\[](.*?)[】\]]\s*(.*)$/);
        const rest = m ? (m[2] || '') : line;
        const url = rest.trim().replace(/^[<("'\u300a\u201c]+|[>)"'\u300b\u201d]+$/g, '');
        return { g: m && m[1].trim() ? m[1].trim() : '', url: url };
      })
      .filter(x => /^https?:\/\//i.test(x.url));
  }
  // 抓取单个链接：st='data' 转存成功 / st='url' 回退按链接保存 / st='fail' 彻底失败
  // processData(dataUrl)→Promise<string|null>：压缩管线（null=过大或解码失败）
  function fetchLinkImage(url, processData) {
    const once = (u) => new Promise((resolve) => {
      let settled = false;
      const finish = (r) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
      // 12s 超时兜底：挂死的图床按「无法读取」回退链接保存，不拖死整批导入
      const timer = setTimeout(() => finish({ st: 'url', v: u }), 12000);
      fetch(u, { mode: 'cors' }).then(res => {
        if (!res.ok) throw new Error('http' + (res.status || ''));
        return res.blob();
      }).then(blob => {
        if (!/^image\//i.test(blob.type || '')) throw new Error('notimage');
        const fr = new FileReader();
        fr.onload = () => {
          const raw = String(fr.result || '');
          // GIF 直存原图保留动画（与上传口径一致）；超大 GIF 不解码存储，回退链接
          if (/image\/gif/i.test(blob.type)) {
            finish(raw.length > 8 * 1024 * 1024 ? { st: 'url', v: u } : { st: 'data', v: raw });
            return;
          }
          processData(raw).then(d => finish(d ? { st: 'data', v: d } : { st: 'url', v: u }));
        };
        fr.onerror = () => finish({ st: 'fail', v: u });
        fr.readAsDataURL(blob);
      }).catch(err => {
        // 非 CORS 类错误（能连上但内容不是图片）：存链接也只会得到破图，判失败
        const msg = (err && err.message) || '';
        finish(/^notimage|^http/.test(msg) ? { st: 'fail', v: u } : { st: 'url', v: u });
      });
    });
    // v3.11.x：https 站点下 http 图链会被浏览器按混合内容拦截——先自动升级 https
    // 试抓（多数图床 http/https 同源同图），失败再按用户粘贴的原始链接兜底保存
    if (location.protocol === 'https:' && /^http:\/\//i.test(url)) {
      return once(url.replace(/^http:\/\//i, 'https://')).then(r => r.st === 'data' ? r : once(url));
    }
    return once(url);
  }
  // 简易并发池（并发 4，保带宽不保序——上传路径的落库顺序本就取决于读取完成先后）
  // 结果按原始下标回填，Promise.all 结束后返回完整结果数组
  function runLinkPool(urls, worker) {
    const out = new Array(urls.length);
    let i = 0;
    function next() {
      if (i >= urls.length) return Promise.resolve();
      const idx = i++;
      return worker(urls[idx]).then((res) => { out[idx] = res; return next(); });
    }
    return Promise.all([0, 1, 2, 3].map(() => next())).then(() => out);
  }
  let linkImportBusy = false; // 防重复提交：上一批还在抓取时不允许叠开第二批
  const impLinkBtn = document.getElementById('cc-import-link');
  if (impLinkBtn) {
    impLinkBtn.addEventListener('click', () => {
      if (cur !== 'sticker' && cur !== 'image') { toast('链接导入仅支持「表情包」和「图片」分类'); return; }
      if (linkImportBusy) { toast('上一批链接还在导入中，请稍等'); return; }
      if (!window.openModal) return;
      window.openModal('链接导入' + MEDIA_TYPES[cur] + '（一行一个链接）', '', (raw, targetGroup) => {
        const items = splitUrlItems(raw);
        if (!items.length) { toast('没有可导入的图片链接（需以 http(s):// 开头）'); return; }
        linkImportBusy = true;
        if (!groups[cur]) groups[cur] = [];
        // 落点分组优先级：行首【组名】> 弹窗「目标分组」下拉 > 当前选中分组 > 分类默认分组
        // （与文字批量导入一致：前缀行永远进自己的组，下拉只接无前缀的行）
        let newGroups = 0;
        const buckets = {};
        const resolveBucket = (name) => {
          if (!buckets[name]) {
            let g = groups[cur].find(x => x[0] === name);
            if (!g) { g = [name, []]; groups[cur].push(g); newGroups++; }
            buckets[name] = { g: g, seen: new Set(g[1]) }; // 分组内去重：已有字卡 + 本次已导入都算重复
          }
          return buckets[name];
        };
        const jobs = items.map(it => ({ url: it.url, bucket: resolveBucket(it.g || targetGroup || curGroup || MEDIA_TYPES[cur]) }));
        let okData = 0, okUrl = 0, dup = 0, fail = 0, httpSaved = 0;
        toast('开始导入 ' + jobs.length + ' 个链接…');
        const isImgCat = cur === 'image';
        runLinkPool(jobs, (job) => fetchLinkImage(job.url, (dataUrl) =>
          compressImage(dataUrl, isImgCat ? 720 : 480, isImgCat ? 'image/jpeg' : 'image/png', isImgCat ? 0.85 : undefined)
        )).then(results => {
          results.forEach((res, i) => {
            const b = jobs[i].bucket;
            if (res.st === 'fail') { fail++; return; }
            if (b.seen.has(res.v)) { dup++; return; }
            b.seen.add(res.v);
            b.g[1].push(res.v);
            if (res.st === 'data') okData++;
            else {
              okUrl++;
              if (/^http:\/\//i.test(jobs[i].url)) httpSaved++; // 升级 https 抓取也失败才落到这里
            }
          });
          saveGroups(groups);
          renderGroupsBar();
          render();
          linkImportBusy = false;
          const got = okData + okUrl;
          toast('已导入 ' + got + ' 个' + MEDIA_TYPES[cur] +
            (okUrl ? '（其中 ' + okUrl + ' 个按链接保存，需联网显示' + (httpSaved ? '；含 ' + httpSaved + ' 个 http 链接，本站可能拦截不显示' : '') + '）' : '') +
            (dup ? '，跳过重复 ' + dup + ' 个' : '') +
            (fail ? '，失败 ' + fail + ' 个（非图片地址）' : '') +
            (newGroups ? '，新建 ' + newGroups + ' 个分组' : ''));
        }, () => {
          linkImportBusy = false;
          toast('导入出错，请重试');
        });
      }, {
        textarea: true,
        textareaPlaceholder: 'https://example.com/sticker.png\n一行一个链接，可粘贴多个批量导入\n可用【分组名】前缀指定分组，如：【日常】https://…\n\n提示：优先尝试转存为本地图片；图床不允许跨域时按链接保存',
        groups: (groups[cur] || []).map(g => g[0])
      });
    });
  }

  // 音频播放（事件委托；字卡删除统一走【管理字卡】）
  // 播放中：按钮高亮 + 图标变波形动画；再次点击暂停；同一时间只播放一条
  // v3.13.x：播放前先校验——只构造 data:audio/ 前缀、长度有界（约等于允许存储的
  // 10MB 音频 base64）的 Audio。误存成语音的视频/超大/空 MIME 数据若直接喂给
  // new Audio(dataURL)，vivo 等低配 Edge 会在主线程同步解码而整页卡死，且播放空白
  // 无音。这里统一拦截改为 toast 提示，不再解码、不再卡死。
  const MAX_AUDIO_VAULT = 16 * 1024 * 1024; // 字符数≈12MB 二进制，高于 10MB 存储上限，合法录音仍可播
  let playingAudio = null;
  let playingBtn = null;
  function stopPlay() {
    // v3.12.x：停播同时卸 src——data: 音频解码缓冲随元素存活，显式释放不等 GC
    if (playingAudio) {
      try { playingAudio.pause(); } catch (e) {}
      try { playingAudio.removeAttribute('src'); playingAudio.load(); } catch (e) {}
      // FIX 2026-09-12 #359：与挂载对称，停播即卸——end/end-error/连点切播三路都经 stopPlay 收口
      try { if (playingAudio.parentNode) playingAudio.parentNode.removeChild(playingAudio); } catch (e) {}
      playingAudio = null;
    }
    if (playingBtn) { playingBtn.classList.remove('playing'); playingBtn = null; }
  }
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.cc-play');
    if (!btn) return;
    if (playingBtn === btn) { stopPlay(); return; }
    // v3.6.x：audio dataURL 不存 DOM——从 WeakMap 按节点取（搜索过滤后索引会错位，不能回查）
    const src = audioSrcMap.get(btn) || '';
    // v3.13.x：播放前守门——非音频前缀/超大数据一律不构造 Audio（防主线程解码卡死）
    if (!src) { stopPlay(); toast('音频数据不可用'); return; }
    if (!/^data:audio\//.test(src)) { stopPlay(); toast('该语音数据异常，无法播放'); return; }
    if (src.length > MAX_AUDIO_VAULT) { stopPlay(); toast('该语音文件过大，无法播放'); return; }
    let nextAudio;
    try {
      nextAudio = new Audio(src);
    } catch (err) {
      stopPlay(); toast('该语音无法播放'); return;
    }
    // FIX 2026-09-12 #359 字卡库语音点播无声：把 Audio 挂到 DOM 再播——部分安卓内核
    // （荣耀X50 Edge/雨见等 Chromium 系）对未挂载的 Audio 静默空放，play() 走完不出声，
    // 多机型同现。与聊天语音气泡（chat.js playVoiceInChat #358）、录音试听
    //（toggleVoicePlay）同款加固：挂载后再 play，走标准解码管线；停播即卸（见 stopPlay）。
    nextAudio.style.display = 'none';
    document.body.appendChild(nextAudio);
    stopPlay();
    playingAudio = nextAudio;
    playingBtn = btn;
    btn.classList.add('playing');
    playingAudio.addEventListener('ended', stopPlay);
    playingAudio.addEventListener('error', stopPlay);
    playingAudio.play().catch(() => { stopPlay(); toast('播放失败'); });
  });

  renderGroupsBar();
  render();

  // ---- 回复池：给聊天页提供「自定义聊天字卡（公用+专属合并）」里所有字卡 ----
  // v3.11.x：公用字卡对所有桌面联系人生效——各回复池一律取当前作用域+公用合并视图
  // v3.22.x：修复「自定义字卡不被聊天回复使用」——启动回填预算把大字卡库键挂起在
  // IDB（__xyIdbDeferredKeys）时，回复池读成空库。此前只有打开字卡库列表页/表情包
  // 拍一拍面板才按需取回，聊天自动回复路径从不触发，联系人因此不再用我加的字卡。
  // 这里在各回复池 getter 里检测到数据缺失即按需取回（用户正在聊天=正在查看该字卡，
  // 与表情包面板同一口径；hydrateLibScopes 内部带 in-flight 去重+链式排队），
  // 取回后 store/memoryCache 立即可读，后续回复即用上字卡。
  // v3.25.x：不再以挂起名单为前置条件（名单外的读丢键取不回，iOS 高发）——
  // hydrateScope 已自带「有数据/已确认无键就跳过」，每次调用只多两次同步判断。
  function maybeHydrateReplyPool() {
    try {
      if (window.hydrateLibScopes) window.hydrateLibScopes(['public', 'own']);
    } catch (e) {}
  }
  // v3.42.x #455：replyScopeGroups 整体移除（历史职责=「groups 空时从 store 现载兜底
  // 回复池」，v3.28.x 修自定义字卡整会话不进池）——回复池专属侧已改走带缓存的令牌化
  // 池视图 ownPoolRaw()，数据缺失由 maybeHydrateReplyPool→hydrateScope 统一按需取回，
  // 不再需要「为池子回填编辑树」；这条兜底在 153MB 级库上＝每次池空都全量 parse 一遍
  // 并把解析副本常驻进 groups，正是本次 OOM 家族的专属库面主源之一。编辑树的载入
  // 收口为「管理页开着才载」（openCcPage / hydrateScope 页可见分支）。
  window.getCustomCards = function () {
    maybeHydrateReplyPool();
    const g = replyPoolGroups();
    const out = [];
    // v3.32.x：功能字卡分类（fish/eat/…）不进聊天通用回复池——它们只归对应功能抽取
    Object.keys(g).forEach(t => {
      if (CC_FUNC_KEYS.indexOf(t) >= 0) return;
      g[t].forEach(([name, arr]) => arr.forEach(c => out.push(c)));
    });
    return out;
  };
  // 拍一拍字卡（自定义字卡里【拍一拍】分类）
  window.getPokeCards = function () {
    maybeHydrateReplyPool();
    const g = replyPoolGroups();
    const out = [];
    (g['poke'] || []).forEach(([name, arr]) => arr.forEach(c => out.push(c)));
    return out;
  };
  // 拍一拍分组（分组名 + 字卡数组），供拍一拍页面展示
  window.getPokeGroups = function () {
    return (replyPoolGroups()['poke'] || []).slice();
  };
  // 媒体字卡：表情包/图片 的图片 dataURL 列表、语音（文件名|||音频）列表（供回复/表情面板）
  // v3.11.x：链接导入的 http(s) 图片字卡同样放行（聊天气泡按 type 渲染 <img src>，
  // 对远程链接天然兼容；仅信件正文嵌入/朋友圈配图等「拼进文本」的场景仍只收 dataURL）
  function isMediaImg(c) {
    // #377：补认媒体池令牌 @@m:hash——大库内存瘦身令牌化后（pubGroupsRaw），超大贴纸卡
    // 在回复池里以令牌形态存在，渲染端 media-pool 观察器会解回真图；不补认则令牌卡被
    // 本过滤器整个剔出表情包/图片池＝令牌化的卡再也不会被抽到（行为回退）
    if (typeof c !== 'string') return false;
    if (c.indexOf('data:image') === 0 || /^https?:\/\/[^\s"'<>]+$/i.test(c)) return true;
    if (c.indexOf('@@m:') === 0 && window.mochiMediaIsToken && window.mochiMediaIsToken(c)) {
      // FIX 2026-09-13 #387 池里确认没有的令牌卡不再当媒体载荷（无池数据设备不再发/显白图卡；
      // 导入完整备份补回池后 missing 解除自动恢复）
      return !(window.mochiMediaTokenMissing && window.mochiMediaTokenMissing(c));
    }
    return false;
  }
  window.getMediaCards = function (type) {
    maybeHydrateReplyPool();
    const g = replyPoolGroups();
    const out = [];
    (g[type] || []).forEach(([name, arr]) => arr.forEach(c => {
      if (type === 'voice') {
        // 语音字卡：文件名|||音频数据
        if (typeof c === 'string' && c.indexOf('|||') > 0) out.push(c);
      } else if (isMediaImg(c)) {
        out.push(c);
      }
    }));
    return out;
  };
  // 媒体分组：表情包/图片 的分组结构（供表情面板展示）
  window.getMediaGroups = function (type) {
    const g = replyPoolGroups();
    return (g[type] || []).map(([name, arr]) => [name, arr.filter(isMediaImg)]);
  };
  // ================= v3.32.x：自定义功能字卡池（其他互动功能字卡） =================
  // 返回某功能分类（fish/eat/…/music）下用户自建的全部文字字卡（专属+公用合并，
  // 各自剔除被停用分组），供 default-cards.js getLibPool 并入对应功能池抽取。
  // 只收纯文字（媒体 dataURL/语音不该出现在功能池，防御性过滤）；非功能分类返回 []。
  // 专属侧带原始串身份缓存：store.get 命中 memoryCache 时两次取到同一字符串对象，
  // 引用相等 O(1) 判新；任何写库（set 换新串）自动失效重算——功能触发频率高，
  // 每次都 buildGroupsFrom 整库 JSON.parse 会卡（大库百 MB 级，用户实测卡顿根因之一）。
  let ccFuncOwnSrc = null, ccFuncOwnMap = null;
  function ownFuncMap() {
    let raw = null;
    try { raw = store.get('cc-groups'); } catch (e) {}
    if (ccFuncOwnMap && ccFuncOwnSrc === raw) return ccFuncOwnMap;
    const map = {};
    CC_FUNC_KEYS.forEach(k => { map[k] = []; });
    try {
      const g = filterGroupsByOff(buildGroupsFrom(raw), 'own');
      CC_FUNC_KEYS.forEach(k => (g[k] || []).forEach(grp => {
        if (!Array.isArray(grp) || !Array.isArray(grp[1])) return;
        grp[1].forEach(c => { if (typeof c === 'string' && c && c.indexOf('data:') !== 0) map[k].push(c); });
      }));
    } catch (e) {}
    ccFuncOwnMap = map;
    ccFuncOwnSrc = raw;
    return map;
  }
  window.getCustomFuncCards = function (cat) {
    if (CC_FUNC_KEYS.indexOf(cat) < 0) return [];
    const out = ownFuncMap()[cat].slice();
    try {
      const pg = filterGroupsByOff(pubGroupsRaw(), 'public');
      (pg[cat] || []).forEach(grp => {
        if (!Array.isArray(grp) || !Array.isArray(grp[1])) return;
        grp[1].forEach(c => { if (typeof c === 'string' && c && c.indexOf('data:') !== 0) out.push(c); });
      });
    } catch (e) {}
    return out;
  };
  // v3.26.x：把「要嵌进正文文本」的 dataURL 压缩成小图（信箱正文/朋友圈动态/评论区
  //   TA 自动选表情包写信/发动态时都用它）。根因：自定义表情包常是几百 KB 的原图
  //   PNG/GIF，直接 dataURL 拼进信件/动态 content 会把信箱/朋友圈主键撑过 200KB，
  //   idb.js 把该键当大键只进 IndexedDB（localStorage 空）→ 页面走剥图快照渲染成
  //   文字「图片」、联系人写信/回信/发评论表情包显示不出缩略图；同时超大量原图在
  //   内存/启动回填里堆积还引发崩溃与一卡一卡。
  //   这里统一在「贴进正文前」把超大 dataURL 压到小尺寸透明 PNG（sticker 保透明），
  //   让单张降到几 KB，主键永远不超 200KB。聊天发表情走独立附件模式，不受影响，
  //   故此处仅对打算内联进文本的 media 生效。
  var SHRINK_EMBED_MAX = 120; // 内联表情包最长边（px）
  var SHRINK_EMBED_QUOTA = 16 * 1024; // 超过此字节长度的 dataURL 才值得压（小图直接原样）
  window.shrinkMediaUrl = function (src, cb) {
    if (typeof src !== 'string' || src.indexOf('data:image') !== 0) { if (cb) cb(src); return; }
    if (src.indexOf('base64') < 0 || src.length <= SHRINK_EMBED_QUOTA) { if (cb) cb(src); return; }
    try {
      var img = new Image();
      img.onload = function () {
        try {
          var maxSide = SHRINK_EMBED_MAX;
          var scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
          var w = Math.max(1, Math.round((img.width || 1) * scale));
          var h = Math.max(1, Math.round((img.height || 1) * scale));
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          var ctx = c.getContext('2d');
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          // 用 PNG 保透明（表情包常见透明底）；结果更小才采用，否则保留原图
          var out = c.toDataURL('image/png');
          if (out.length < src.length) { if (cb) cb(out); return; }
        } catch (e) {}
        if (cb) cb(src);
      };
      img.onerror = function () { if (cb) cb(src); };
      img.src = src;
    } catch (e) { if (cb) cb(src); }
  };
  // v3.26.x：超大表情包压缩缓存（供信箱 TA 写信/回信、朋友圈 TA 发动态/评论等「同步拼正文」
  //   的场景拿小图）。启动数据就绪后异步对自定义 sticker/image 池逐张压缩建缓存，
  //   之后 taLetterContent 等同步路径能直接取到压缩版，避免几百 KB 原图入库触发 200KB 剥图。
  if (!window._shrunkStickerCache) window._shrunkStickerCache = {};
  // FIX 2026-09-16 #581 预压缩改「串行 + 每张让出主线程」：原实现对池内全部 sticker/image
  //   一次性并发发起 new Image() 解码 + canvas.toDataURL('image/png') 编码，几百张时全部挤在
  //   主线程（与本文件 #398 ccTokenizeGiantMedia 同一形状），启动就绪后与每次切联系人都卡死
  //   数秒到数十秒。改为逐张 await、其间 setTimeout(0) 让出，UI 全程可交互（总时长不变）；
  //   世代计数 ccShrinkGen——切联系人触发的新一轮让上一轮立即作废（池已重建，旧 pass 无意义）。
  var ccShrinkGen = 0;
  function warmShrunkCache() {
    try {
      const g = replyPoolGroups();
      if (!g) return;
      const jobs = [];
      ['sticker', 'image'].forEach(function (t) {
        (g[t] || []).forEach(function (entry) {
          (entry[1] || []).forEach(function (media) {
            if (typeof media !== 'string' || media.indexOf('data:') !== 0) return;
            if (window._shrunkStickerCache[media]) return;
            jobs.push(media);
          });
        });
      });
      if (!jobs.length || typeof window.shrinkMediaUrl !== 'function') return;
      const gen = ++ccShrinkGen;
      (async function () {
        for (let k = 0; k < jobs.length; k++) {
          if (gen !== ccShrinkGen) return; // 已有更新的一轮（切了联系人/池已重建），本次作废
          const media = jobs[k];
          try {
            await new Promise(function (res) {
              let done = false;
              const fin = function () { if (done) return; done = true; res(); };
              window.shrinkMediaUrl(media, function (small) {
                if (small !== media) { window._shrunkStickerCache[media] = small; }
                fin();
              });
              // 兜底：图既不 load 也不 error（坏 dataURL）时不至于把整轮卡住
              setTimeout(fin, 3000);
            });
          } catch (e) { /* 单张失败不中断整轮 */ }
          await new Promise(function (res) { setTimeout(res, 0); }); // 让出主线程，UI 可交互
        }
      })();
    } catch (e) {}
  }
  document.addEventListener('mochi-restore-done', function warmOnce() {
    document.removeEventListener('mochi-restore-done', warmOnce);
    setTimeout(warmShrunkCache, 600); // 让出主线程再扫，避免启动卡顿
  });
  document.addEventListener('contact-switched', function warmCid() {
    setTimeout(warmShrunkCache, 300);
  });
  // v3.11.x：按作用域取分组（不合并）——聊天页拍一拍/表情包面板三分区展示：
  //   scope='public' 只读公用键；scope='own' 只读当前桌面专属键。
  //   v3.30.x：已停用分组同样从面板隐藏（关闭=该分组完全不再被使用，含主动面板）。
  window.getScopedGroups = function (type, scope) {
    // v3.42.x #455：专属分区改走令牌化池视图——原实现每次开聊天表情包/拍一拍面板
    // 都 buildGroupsFrom 全量 JSON.parse 一遍大库（153MB 级库＝开面板秒级冻结，
    // 「左右滑动卡」主力来源之一）；令牌卡由 isMediaImg 补认分支收齐不丢。
    const src = filterGroupsByOff(
      (scope === 'public') ? pubGroupsRaw() : ownPoolRaw(),
      scope === 'public' ? 'public' : 'own'
    );
    const arr = (src[type] || []).slice();
    if (type === 'sticker' || type === 'image') {
      return arr.map(g => [g[0], (g[1] || []).filter(isMediaImg)]);
    }
    return arr;
  };
  // FIX 2026-09-16 #547：令牌化稳定的卡身份——同一张图「原始 dataURL 形态」与「@@m: 令牌形态」
  // 算出同一个短身份串，供表情面板等消费方做内容签名（不改任何库数据，纯读侧映射）。
  // · 令牌卡：反查 ccTokMemoRev 取内容短指纹；反查不到（别处来的令牌）退令牌头定长截断＝本会话内仍稳定；
  // · ≥64KB 大图卡（会被令牌化的）：与 ccTokMemoRev 登记侧同式短指纹（ccMediaFrag）——
  //   令牌化前后两次计算逐字符相同，签名不再翻转；
  // · 其余卡（短 dataURL/文字/语音）：定长截断，行为与旧「按原文签名」等价稳定。
  window.ccMediaCardIdent = function (card) {
    try {
      if (typeof card !== 'string') return String(card);
      const bar = card.indexOf('|||');
      const body = bar >= 0 ? card.slice(bar + 3) : card;
      const pre = bar >= 0 ? card.slice(0, bar + 3) : '';
      if (body.indexOf('@@m:') === 0) {
        const f = ccTokMemoRev.get(body);
        return f ? (pre + f) : (pre + body.slice(0, 72));
      }
      if (body.length >= CC_MEDIA_TOKEN_THRESHOLD && body.indexOf('data:image/') === 0) return pre + ccMediaFrag(body);
      return card.length > 120 ? (card.slice(0, 60) + '~' + card.length) : card;
    } catch (e) { return String(card); }
  };

  // #317 梦角自由造句：程序化追加字卡进指定作用域库的指定分类/分组
  //（dream-free.js 造句入库用）。写守卫（ccAuthSeen/rescueCcOverwrite）、分组去重、
  // 延迟持久化（scheduleSave）与手动添加完全同路；当前页若开着同分类列表则局部刷新。
  // #324 scope：'own'=专属库（默认，当前联系人）/ 'public'=公用库（全桌面共享）——
  // 公用库走 pubGroupsRaw 缓存 + pubStore 整包回写 + pubInvalidate，与公用页保存同路。
  window.ccAppendCards = function (type, group, cards, scope) {
    try {
      if (CC_ALL_TYPES.indexOf(type) < 0 || type === 'sticker' || type === 'image' || type === 'voice') return false;
      const arr = (Array.isArray(cards) ? cards : [cards]).filter(c => typeof c === 'string' && c && c.indexOf('data:') !== 0 && c.indexOf('|||') < 0);
      if (!arr.length || !group) return false;
      const isPub = scope === 'public';
      if (isPub) {
        // FIX 2026-09-13 #387 写回泄漏堵口——pubGroupsRaw() 是 #377 令牌化后的内存缓存，
        // 整包 set(PUB_KEY) 会把全库令牌持久化进原始键，随公用库/备份传到无池数据设备
        // ＝纯白图/空分组/乱码。改用原始键现解析（本路径低频，一次性 40MB parse 可接受），
        // 写回的永远是原始数据；pubInvalidate 后下次回复池照常走令牌化瘦身。
        const g = buildGroupsFrom(pubStore().get(PUB_KEY));
        if (!g[type]) g[type] = [];
        let grp = g[type].find(p => p[0] === group);
        if (!grp) { grp = [group, []]; g[type].push(grp); }
        let added = 0;
        arr.forEach(c => { if (grp[1].indexOf(c) < 0) { grp[1].push(c); added++; } });
        if (added) {
          try { pubStore().set(PUB_KEY, JSON.stringify(g)); } catch (e) {}
          pubInvalidate();
          libCounts.pub = -1; libCounts.pubFun = -1;
          if (cur === type && !document.getElementById('page-custom-cards').hidden) { try { render(); } catch (e) {} }
        }
        return added > 0;
      }
      // v3.42.x #455：懒加载态（管理页未开/已释放，groups=null）绝不拿空编辑树整包
      // 回写＝清库——对齐公用分支 #387 口径：原始键现解析→追加→直写（本路径低频，
      // 一次性 parse 可接受），带完整快照确认落盘，池视图失效后下次取池即含新卡。
      if (!groups) {
        const g0 = buildGroupsFrom(store.get('cc-groups'));
        if (!g0[type]) g0[type] = [];
        let grp0 = g0[type].find(p => p[0] === group);
        if (!grp0) { grp0 = [group, []]; g0[type].push(grp0); }
        let added0 = 0;
        arr.forEach(c => { if (grp0[1].indexOf(c) < 0) { grp0[1].push(c); added0++; } });
        if (added0) {
          const j0 = JSON.stringify(g0);
          try { store.set('cc-groups', j0); } catch (e2) {}
          if (j0.length > 200 * 1024) ccEnsureDurable(0, j0); // #434 同款大值确认落盘
          pubInvalidate();
          libCounts.own = -1; libCounts.fun = -1;
          refreshLibCounts(false);
        }
        return added0 > 0;
      }
      if (!groups[type]) groups[type] = [];
      let g = groups[type].find(p => p[0] === group);
      if (!g) { g = [group, []]; groups[type].push(g); }
      let added = 0;
      arr.forEach(c => { if (g[1].indexOf(c) < 0) { g[1].push(c); added++; } });
      if (added) {
        scheduleSave();
        renderGroupsBar();
        if (cur === type && !document.getElementById('page-custom-cards').hidden) { try { render(); } catch (e) {} }
      }
      return added > 0;
    } catch (e) { return false; }
  };

  // ---- 多桌面：按指定联系人(cid)读取字卡（供朋友圈 TA 取各自桌面字卡）----
  function buildGroupsFrom(raw) {
    try {
      const g = JSON.parse(raw || 'null');
      if (g && g.text) return g;
    } catch (e) {}
    return { text: [], kaomoji: [], emoji: [], sticker: [], image: [], poke: [], voice: [] };
  }
  // 切换联系人后重载字卡库（好友圈 TA 取各自桌面字卡、当前桌面字卡库也要刷新）
  document.addEventListener('contact-switched', function () {
    if (editSaveTimer) { clearTimeout(editSaveTimer); editSaveTimer = null; }
    pubInvalidate();
    offInvalidate(); // v3.30.x：专属停用集合按联系人隔离，切桌面必须失效缓存
    ccAuthSeen.own = false; // v3.26.x #193：新桌面的权威键尚未取回，写守卫重新生效
    libCounts.pub = -1; libCounts.own = -1; libCounts.fun = -1; libCounts.pubFun = -1;
    // v3.42.x #455：切桌面不再无条件全量 parse 新桌面库进编辑树（原实现每次切换
    // 都 loadGroups＝「切桌面/开聊天间歇卡顿」主力来源之一）——管理页开着才重载，
    // 否则保持懒加载，开页时现载
    if (ccPageOpen()) { try { groups = loadGroups(); } catch (e) {} }
    else groups = null;
    refreshLibCounts(false);
    if (ccPageOpen()) { try { renderGroupsBar(); render(); } catch (e) {} }
    // v3.15.x：新桌面两把字卡键若被启动回填挂起，这里按需取回（用户正在切换查看
    // 的场景才拉数据；见下方 hydrateScope 注释——绝不在启动链路/后台自动取回）
    hydrateLibScopes(['public', 'own']);
  });
  // v3.11.x：For 系列同样合并公用字卡——朋友圈/信箱/群聊等按联系人取池时，
  // 公用字卡对该联系人生效（专属部分仍读各自桌面）
  // v3.30.x：按 cid 过滤该桌面的专属停用分组 + 全局公用停用分组
  window.getCustomCardsFor = function (cid) {
    try { if (window.hydrateLibForCid) window.hydrateLibForCid(cid); } catch (e) {}
    const g = replyPoolGroupsFor(cid);
    const out = [];
    // v3.32.x：功能字卡分类不进聊天/群聊通用回复池（同 getCustomCards）
    Object.keys(g).forEach(t => {
      if (CC_FUNC_KEYS.indexOf(t) >= 0) return;
      (g[t] || []).forEach(([name, arr]) => (arr || []).forEach(c => out.push(c)));
    });
    return out;
  };
  window.getPokeCardsFor = function (cid) {
    try { if (window.hydrateLibForCid) window.hydrateLibForCid(cid); } catch (e) {}
    const g = replyPoolGroupsFor(cid);
    const out = [];
    (g['poke'] || []).forEach(([name, arr]) => (arr || []).forEach(c => out.push(c)));
    return out;
  };
  window.getMediaCardsFor = function (cid, type) {
    try { if (window.hydrateLibForCid) window.hydrateLibForCid(cid); } catch (e) {}
    const g = replyPoolGroupsFor(cid);
    const out = [];
    (g[type] || []).forEach(([name, arr]) => (arr || []).forEach(c => {
      if (type === 'voice') {
        if (typeof c === 'string' && c.indexOf('|||') > 0) out.push(c);
      } else if (isMediaImg(c)) {
        out.push(c);
      }
    }));
    return out;
  };

  // ================= v3.11.x：存量自定义字卡归属迁移（一次性，幂等） =================
  // 需求规则：升级前已添加的自定义聊天字卡——
  //   · 有多个桌面联系人 → 归「专属」（原地保留在各联系人命名空间，不搬动）
  //   · 没有多个桌面联系人 → 归「公用」（迁到全局键 cc-groups-public 并清掉原专属键，
  //     之后新建的每个桌面联系人都共用这批字卡）
  // 时序：等 IDB 整体回填就绪（mochi-restore-done / __mochiDataReady）+ 本模块专属键
  // IDB 恢复尝试落定（ownRestoreP），防止把尚未恢复的空库当存量误迁；源数据在
  // LS/memoryCache 快照与 IDB 权威值之间取内容多者。标记 xy-home-v2:cc-scope-migrated。
  (function () {
    const gRoot = pubStore();
    let started = false;
    function run() {
      if (started) return;
      started = true;
      try {
        if (gRoot.get('cc-scope-migrated') === '1') return;
        const cs = (window.getContacts && window.getContacts()) || [{ id: 'default', name: '默认' }];
        if (cs.length > 1) { try { gRoot.set('cc-scope-migrated', '1'); } catch (e) {} return; }
        const cid = (cs[0] && cs[0].id) || 'default';
        const st = window.storeFor(cid);
        const isDefault = cid === 'default';
        // 旧版（多桌面功能之前）数据可能存顶层键 xy-home-v2:cc-groups——与 defaultStore()
        // 的回退读取口径一致：default 命名空间读空时回退顶层键；迁走后两处一起清
        let local = null;
        try { local = buildGroupsFrom(st.get('cc-groups')); } catch (e) {}
        if (isDefault && !countOf(local)) {
          try { local = buildGroupsFrom(gRoot.get('cc-groups')); } catch (e) {}
        }
        const pick = function (data) {
          try {
            if (!countOf(data)) { try { gRoot.set('cc-scope-migrated', '1'); } catch (e2) {} return; }
            gRoot.set(PUB_KEY, JSON.stringify(data));
            pubInvalidate();
            try { st.remove('cc-groups'); } catch (e2) {} // 迁走即清，防回复池公用+专属重复
            if (isDefault) { try { gRoot.remove('cc-groups'); } catch (e2) {} }
            libCounts.pub = -1; libCounts.own = -1; libCounts.fun = -1; libCounts.pubFun = -1;
            if (cid === (window.__activeCid || 'default')) {
              // v3.42.x #455：同 refreshAfter——管理页开着才重载编辑树
              if (ccScope === 'own' && ccPageOpen()) { groups = loadGroups(); try { renderGroupsBar(); render(); } catch (e2) {} }
              else refreshLibCounts(false);
            } else refreshLibCounts(false);
            try { gRoot.set('cc-scope-migrated', '1'); } catch (e2) {}
          } catch (e) { try { gRoot.set('cc-scope-migrated', '1'); } catch (e3) {} }
        };
        if (window.idbGet) {
          // IDB 权威值参与比较（回填刚完成时两者一致；12s 保险丝提前放行时以 IDB 为准）
          const reads = [PUB_PREFIX + ':' + cid + ':cc-groups'];
          if (isDefault) reads.push(PUB_PREFIX + ':cc-groups');
          Promise.all(reads.map(k => window.idbGet(k).catch(() => null))).then(vals => {
            vals.forEach(v => {
              try {
                const d = typeof v === 'string' ? JSON.parse(v) : v;
                if (d && d.text && countOf(d) > countOf(local)) local = d;
              } catch (e) {}
            });
            pick(local);
          });
        } else pick(local);
      } catch (e) { try { gRoot.set('cc-scope-migrated', '1'); } catch (e2) {} }
    }
    let restoreReady = !!window.__mochiDataReady;
    if (restoreReady) ownRestoreP.then(run);
    else {
      document.addEventListener('mochi-restore-done', function h() {
        document.removeEventListener('mochi-restore-done', h);
        restoreReady = true;
        ownRestoreP.then(run);
      });
    }
  })();

  // ================= v3.26.x #139：专属字卡库重复副本一次性幂等清理 =================
  // 诊断实证（#139 用户机）：cc-groups-public 与 cmt37eved7if / cmt4hxra06tx 两桌面的
  // 专属 cc-groups 逐字节同大小（138.22MB×3），cmt34ty8537s=148.89MB 疑似公用+增量——
  // 专属页导入全量备份的兜底（raw = bag[PUB_PREFIX+':cc-groups']）会把公用库整份写进
  // 专属键，每次恢复/导入复制一份 ≈415MB 纯冗余。回复池本就「专属+公用」合并读取
  // （replyPoolGroups / replyPoolGroupsFor），与公用重复的专属内容删除零功能损失。
  // 清理规则（宁可不删，不可删错）：
  //   ① 整库相等（长度+逐字符一致）→ 删专属键（公用库始终保留一份）；
  //   ② 分组级相等：专属库中与公用库同名同分类、内容完全一致的分组剔除——剔完为空删键，
  //      剩余 <15MB 才回写瘦身库（防大字符串重写；剩余过大留给手动批量管理）；
  //   ③ 预检用 __big-idx 尺寸（免读大值）：已体检且两侧长度未变的键直接跳过，
  //      稳态零开销；任一步异常放弃该键；公用库只读绝不改写。
  (function () {
    const DD_KEY = 'cc-dedupe-v1';
    const DD_REWRITE_LIMIT = 15 * 1024 * 1024;
    // v3.42.x #455：解析上限 300MB→96MB（双侧合计）——原值放行了 90+153MB 级双库
    // 同时 parse（#377 家族诊断机型实测解析副本把堆顶到 jetsam），去重收益不抵
    // 秒级长任务 + OOM 风险；超限走「只记 mark 免解析跳过」（剩余过大留给手动批量
    // 管理，与 DD_REWRITE_LIMIT 同一取舍逻辑）
    const DD_PARSE_LIMIT = 96 * 1024 * 1024;
    function ddLoad() {
      try {
        const o = JSON.parse(pubStore().get(DD_KEY) || '{}');
        return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
      } catch (e) { return {}; }
    }
    function ddSave(o) { try { pubStore().set(DD_KEY, JSON.stringify(o)); } catch (e) {} }
    function ddCount(g) {
      let n = 0;
      try { CC_TYPES.forEach(t => (g[t] || []).forEach(x => n += (Array.isArray(x[1]) ? x[1].length : 0))); } catch (e) {}
      return n;
    }
    function refreshAfter(cid) {
      libCounts.own = -1; libCounts.fun = -1;
      if (cid === (window.__activeCid || 'default')) {
        pubInvalidate();
        // v3.42.x #455：管理页开着才重载编辑树，页关着保持懒加载态（池视图已随
        // pubInvalidate 失效，角标走 refreshLibCounts 池视图口径刷新）
        if (ccScope === 'own' && ccPageOpen()) { groups = loadGroups(); try { renderGroupsBar(); render(); } catch (e2) {} }
        else refreshLibCounts(false);
      } else refreshLibCounts(false);
    }
    function run() {
      // 低内存设备不跑（瞬时驻留两份大库字符串；宁留冗余不冒崩溃险）
      let devGB = 8;
      try { devGB = navigator.deviceMemory || 8; } catch (e) {}
      if (devGB < 4) return;
      if (!window.idbGetAllKeys || !window.idbGet || !window.storeFor) return;
      window.idbGetAllKeys().then(function (allKeys) {
        const ownKeys = (allKeys || []).map(String).filter(k => /^xy-home-v2:[^:]+:cc-groups$/.test(k));
        if (!ownKeys.length) return;
        const marks = ddLoad();
        let markDirty = false;
        // v3.42.x #455 全键预检：__big-idx 尺寸齐全且每键 mark 与双侧长度一致 →
        // 本轮零读直接返回（原实现无论如何都先把公用键整串读进堆＝90MB 级读入
        // 每次启动必付一次，纯白费的内存峰值）
        const pubFullKey = PUB_PREFIX + ':' + PUB_KEY;
        const pubLenIdx = (window.idbBigSize && window.idbBigSize(pubFullKey)) || null;
        let allSettled = typeof pubLenIdx === 'number';
        if (allSettled) {
          for (let z = 0; z < ownKeys.length; z++) {
            const fk = ownKeys[z];
            const cid0 = fk.slice(PUB_PREFIX.length + 1, fk.length - ':cc-groups'.length);
            const ownLen0 = (window.idbBigSize && window.idbBigSize(fk)) || null;
            if (typeof ownLen0 !== 'number' ||
                !marks[cid0] || marks[cid0][0] !== pubLenIdx || marks[cid0][1] !== ownLen0) { allSettled = false; break; }
          }
        }
        if (allSettled) return;
        window.idbGet(pubFullKey).then(function (pubRaw) {
          if (typeof pubRaw !== 'string' || pubRaw.length < 1024) return;
          let i = 0;
          (function step() {
            if (i >= ownKeys.length) { if (markDirty) ddSave(marks); return; }
            const full = ownKeys[i++];
            const cid = full.slice(PUB_PREFIX.length + 1, full.length - ':cc-groups'.length);
            const next = function () { setTimeout(step, 0); };
            // 预检：__big-idx 尺寸没记录（本会话未回填该键）或与上次体检一致 → 免读大值
            const ownLen = (window.idbBigSize && window.idbBigSize(full)) || null;
            if (typeof ownLen !== 'number' || ownLen < 65536) {
              // v3.42.x #455：小/未知键也记 mark（配合 pubLenIdx 全键预检）——大公用库
              // +小专属库的用户此前因专属键永不记 mark，每次启动都白读一次公用大键；
              // 尺寸索引缺失（pubLenIdx 未知）时不记，维持旧口径
              if (typeof ownLen === 'number' && typeof pubLenIdx === 'number') { marks[cid] = [pubLenIdx, ownLen]; markDirty = true; }
              next(); return;
            }
            if (marks[cid] && marks[cid][0] === pubRaw.length && marks[cid][1] === ownLen) { next(); return; }
            // v3.42.x #455：双侧合计超解析上限 → 免读该键大值、只记 mark 跳过——
            // 原实现此时已把 90+153MB 双库整串拉进堆还要双库 JSON.parse（解析副本
            // 再翻倍）＝启动+30s 的秒级长任务/OOM 爆点；mark 落盘后下轮走零读预检
            if (pubRaw.length + ownLen > DD_PARSE_LIMIT) {
              marks[cid] = [pubRaw.length, ownLen]; markDirty = true; next(); return;
            }
            window.idbGet(full).then(function (ownRaw) {
              try {
                if (typeof ownRaw !== 'string' || ownRaw.length < 1024) {
                  marks[cid] = [pubRaw.length, (typeof ownRaw === 'string' ? ownRaw.length : 0)]; markDirty = true; next(); return;
                }
                // ① 整库相等 → 删专属键（storeFor.remove 同步清 memoryCache/LS/IDB/wrj/bigIdx）
                if (ownRaw === pubRaw) {
                  try { window.storeFor(cid).remove('cc-groups'); } catch (e2) {}
                  delete marks[cid]; markDirty = true;
                  try { toast('已清理与公用字卡库完全重复的专属库「' + cid + '」（省 ' + Math.round(ownRaw.length / 1048576) + 'MB）'); } catch (e2) {}
                  refreshAfter(cid);
                  next(); return;
                }
                // ② 分组级去重：同名同分类且内容完全一致的分组剔除
                if (ownRaw.length + pubRaw.length > DD_PARSE_LIMIT) {
                  marks[cid] = [pubRaw.length, ownRaw.length]; markDirty = true; next(); return;
                }
                const pubG = buildGroupsFrom(pubRaw);
                const ownG = buildGroupsFrom(ownRaw);
                const pubIdx = {};
                CC_TYPES.forEach(t => {
                  pubIdx[t] = {};
                  (pubG[t] || []).forEach(g => { if (Array.isArray(g) && g[0] != null && !(g[0] in pubIdx[t])) pubIdx[t][String(g[0])] = JSON.stringify(g[1] || []); });
                });
                const reduced = {};
                let removedCards = 0;
                CC_TYPES.forEach(t => {
                  reduced[t] = (ownG[t] || []).filter(g => {
                    if (!Array.isArray(g)) return false;
                    const key = String(g[0]);
                    const pubCards = pubIdx[t] && pubIdx[t][key];
                    if (pubCards != null && pubCards === JSON.stringify(g[1] || [])) { removedCards += (g[1] || []).length; return false; }
                    return true;
                  });
                });
                if (!ddCount(reduced)) {
                  try { window.storeFor(cid).remove('cc-groups'); } catch (e2) {}
                  delete marks[cid]; markDirty = true;
                  try { toast('专属库「' + cid + '」的 ' + removedCards + ' 张字卡与公用库重复，已清理'); } catch (e2) {}
                  refreshAfter(cid);
                  next(); return;
                }
                const newRaw = JSON.stringify(reduced);
                if (removedCards > 0 && newRaw.length < DD_REWRITE_LIMIT && newRaw.length < ownRaw.length) {
                  try { window.storeFor(cid).set('cc-groups', newRaw); } catch (e2) {}
                  try { toast('专属库「' + cid + '」去重 ' + removedCards + ' 张与公用重复的字卡（省 ' + Math.round((ownRaw.length - newRaw.length) / 1048576) + 'MB）'); } catch (e2) {}
                  refreshAfter(cid);
                  marks[cid] = [pubRaw.length, newRaw.length];
                } else {
                  marks[cid] = [pubRaw.length, ownRaw.length];
                }
                markDirty = true;
                next();
              } catch (e) { try { marks[cid] = [pubRaw.length, (typeof ownRaw === 'string' ? ownRaw.length : 0)]; markDirty = true; } catch (e2) {} next(); }
            }).catch(next);
          })();
        }).catch(function () {});
      }).catch(function () {});
    }
    let ddKicked = false;
    function ddKick() { if (ddKicked) return; ddKicked = true; setTimeout(run, 30000); }
    if (window.__mochiDataReady) ownRestoreP.then(ddKick);
    else {
      document.addEventListener('mochi-restore-done', function h() {
        document.removeEventListener('mochi-restore-done', h);
        ownRestoreP.then(ddKick);
      });
    }
    setTimeout(ddKick, 60000); // restore 挂起/事件丢失兜底（ddKicked 防重入）
  })();

  // ================= v3.11.x：字卡库 公用/专属 变动一次性提醒 =================
  // 升级后首次启动（数据就绪）弹出：说明双分类变动 + 引导先导出字卡 json 备份再使用新版。
  // 任一关闭路径（导出/知晓/✕/点遮罩）都记全局标记 cc-scope-notice-done，不再打扰；
  // 全新空库用户不打扰（直接置标记）。导出内容 =「当前桌面专属 + 公用」合并后的标准格式
  // json（与 字卡库→导入数据 完全兼容，选「追加字卡」即可恢复）。
  (function () {
    const gRoot = pubStore();
    function done() { try { gRoot.set('cc-scope-notice-done', '1'); } catch (e) {} }
    function totalMerged() {
      try { return countOf(mergeWithPublic(loadGroups())); } catch (e) { return 0; }
    }
    function show() {
      const mask = document.getElementById('cc-scope-mask');
      if (!mask) { done(); return; }
      const sum = document.getElementById('csn-summary');
      if (sum) sum.textContent = '已检测到你现有的字卡共 ' + totalMerged() + ' 张（公用 + 当前桌面专属）';
      const finish = function () { mask.hidden = true; done(); };
      const ex = document.getElementById('csn-export');
      const ok = document.getElementById('csn-ok');
      const cl = document.getElementById('csn-close');
      if (ex) ex.addEventListener('click', function () {
        // #506：引导备份同样先还原媒体池令牌再落文件
        const payload = mergeWithPublic(loadGroups());
        ccExportExpandTokens(payload).then(function (exp) {
          try {
            const data = JSON.stringify(payload, null, 2);
          const blob = new Blob([data], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'mochi字卡库备份.json';
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 300);
          toast('字卡备份已导出' + (exp.miss ? '；' + exp.miss + ' 张图片数据缺失无法还原' : ''));
          } catch (e) { toast('导出失败'); }
          finish();
        });
      });
      if (ok) ok.addEventListener('click', finish);
      if (cl) cl.addEventListener('click', finish);
      mask.addEventListener('click', function (e) { if (e.target === mask) finish(); });
      mask.hidden = false;
    }
    function boot() {
      setTimeout(function () {
        try {
          if (gRoot.get('cc-scope-notice-done') === '1') return;
          if (!totalMerged()) { done(); return; } // 全新空库不打扰
          show();
        } catch (e) { try { done(); } catch (e2) {} }
      }, 1200);
    }
    if (window.__mochiDataReady) boot();
    else document.addEventListener('mochi-restore-done', function h() {
      document.removeEventListener('mochi-restore-done', h);
      boot();
    });
  })();

  // 入口：字卡库列表页点「公用字卡 / 专属字卡」进入本页（v3.11.x 双作用域）
  // v3.14.x：大键懒加载兜底（idb.js OOM 防线配套）——低内存设备启动回填可能把
  // 字卡库大键挂起在 IDB（__xyIdbDeferredKeys），此时 store.get 读空、字卡库显示为空
  // 像「数据丢了」。打开管理页=用户正在看这份数据，先按需取回再渲染列表；
  // 只对「被挂起且确实读不到」的键生效，正常设备零等待。
  function hydrateCurScope() {
    if (!window.idbHydrateKey) return Promise.resolve(false);
    try { if (curStore().get(curKey())) return Promise.resolve(false); } catch (e) {}
    // v3.25.x：不再要求键在挂起名单——回填链被打断（iOS 挂后台杀 IDB 连接等）时
    // 键读丢了也不在名单里，此前在这里被直接放行返回，字卡库永远空载。
    // 统一交给 hydrateScope 判断（健康确认无键的 absent 缓存也在那边）。
    let fk = '';
    try { fk = ccScope === 'public' ? (PUB_PREFIX + ':' + PUB_KEY) : (window.activePrefix() + ':cc-groups'); } catch (e) {}
    if (!hydAbsent[fk]) { try { toast('字卡较多，正在加载…'); } catch (e) {} }
    // v3.15.x：统一走 hydrateScope（成功后自动清缓存/刷新角标与界面）
    return hydrateScope(ccScope === 'public' ? 'public' : 'own');
  }
  // v3.32.x：公用/专享字卡「只加了一点点」时的使用提醒——【默认聊天字卡】触发概率默认
  // 只有 30%。用户自建字卡很少时，联系人(TA)回复约 70% 会反复抽那几十张自建卡 + 30% 用
  // 默认卡补位，体感「一直重复相同内容」。进入公用/专属字卡页（基础聊天入口）且满足条件
  // 时提醒，频控 = 每天最多一次（cc-lowcard-remind 存上次提醒日期，同日不再弹，次日首触
  // 再弹——条件不满足的日子不打扰；用户要求「每天首次使用也会提醒」）。触发条件：
  //   ① 自建聊天字卡（公用+专属，剔除功能分类）>0 且 <5000；
  //   ② 默认聊天字卡总开关开启、聊天场景使用开启；
  //   ③ 聊天触发概率仍维持默认 30%（dc-overall-chat 未设或 ==30）。
  // 说明：仅当用户完全没添加任何自建聊天字卡时才会 100% 走默认字卡（getPool 兜底已保证，
  // 此需求确认现有行为即可，不改回复池逻辑）。
  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function maybeLowCardsRemind() {
    try {
      if (!(window.activeStore && window.activeStore().get && window.activeStore().set && window.openModal)) return;
      if (CC_FUNC_KEYS.indexOf(cur) >= 0) return; // 其他互动功能字卡入口不提醒
      let n = 0;
      [ownPoolRaw(), pubGroupsRaw()].forEach(src => {
        if (!src) return;
        CC_TYPES.forEach(t => { ((src[t] || []) || []).forEach(g => { if (Array.isArray(g) && Array.isArray(g[1])) n += g[1].length; }); });
      });
      if (!(n > 0 && n < 5000)) return;
      const dcfg = (window.defaultCardCfg && window.defaultCardCfg()) || {};
      if (dcfg.enabled === false) return;
      if (window.defaultCardUse && !window.defaultCardUse('chat')) return;
      const p = window.activeStore().get('dc-overall-chat');
      if (p !== null && Number(p) !== 30) return; // 已调过概率→不提醒
      const tk = todayKey();
      if (window.activeStore().get('cc-lowcard-remind') === tk) return; // 今天已提醒过
      try { window.activeStore().set('cc-lowcard-remind', tk); } catch (e) {}
      window.openModal('字卡使用提醒', '', null, {
        noInput: true,
        staticText: '你现在自建了 ' + n + ' 张聊天字卡，但【默认聊天字卡】的触发概率仍是默认的 30%。\n\n' +
          '如果你不再多添加自建字卡、也不把【默认聊天字卡】的触发概率调高，联系人(TA)回复时可能因为自建字卡太少，一直重复使用相同内容的字卡。\n\n' +
          '建议：在字卡库里多添加一些自建字卡，或在「预设字卡 → 聊天默认字卡」里把触发概率调高。\n\n' +
          '（说明：只有当你完全没添加任何自建字卡时，联系人才会 100% 使用默认聊天字卡。）'
      });
    } catch (e) {}
  }
  function openCcPage(scope, startTab) {
    // v3.29.x：先落盘上一作用域的未保存变更——原 clearTimeout 会静默丢弃 120ms
    // 防抖窗口内刚上传/编辑的内容（切到另一作用域后刷新即丢）
    flushCcSave();
    ccScope = scope === 'public' ? 'public' : 'own';
    pubInvalidate();
    // v3.32.x：startTab 可指定起始分类（其他互动功能字卡入口直接落到第一个功能 tab）
    cur = (startTab && CC_ALL_TYPES.indexOf(startTab) >= 0) ? startTab : 'text';
    q = ''; curGroup = '';
    const ttl = document.getElementById('cc-page-title');
    if (ttl) ttl.textContent = (CC_FUNC_KEYS.indexOf(cur) >= 0)
      ? '其他互动功能字卡·' + (ccScope === 'public' ? '公用' : '专属')
      : (ccScope === 'public' ? '公用字卡' : '专属字卡');
    const s1 = document.getElementById('cc-search-input');
    if (s1) s1.value = '';
    // v3.32.x：三大入口 tab 分区隔离——「其他互动功能字卡」入口只显示 13 个功能分类，
    // 公用/专属入口只显示 7 个基础分类（用户反馈：功能页不应看到基础分类，且三入口
    // 要分开）。hidden 每次进页重建，入口互不残留
    // #317→#353：mjfree（梦角自由造句）只在【可自定义字卡】（公用/专属大分类）显示；
    // 【其他互动功能字卡】入口不再展示（用户反馈与大分类重复），数据仍存 cc-groups
    // 的 mjfree 字段，dream-free.js 写入/抽取不受影响
    const ccFuncOnly = CC_FUNC_KEYS.indexOf(cur) >= 0;
    tabsWrap.querySelectorAll('.cc-tab').forEach(t => {
      const isFunc = CC_FUNC_KEYS.indexOf(t.dataset.type) >= 0;
      const isMjfree = t.dataset.type === 'mjfree';
      t.classList.toggle('sel', t.dataset.type === cur);
      t.hidden = ccFuncOnly ? (!isFunc || isMjfree) : (isFunc && !isMjfree);
    });
    syncLinkImportVis();
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const ccPage = document.getElementById('page-custom-cards');
    if (ccPage) ccPage.hidden = false;
    maybeLowCardsRemind(); // v3.32.x：自建聊天字卡很少时提醒默认字卡 30% 概率
    // FIX 2026-09-16 #574 字卡库开页「空白干等 IDB」（用户报「字卡库卡 5、6 秒，也没有
    //   动画加载的缓冲」iPhone 14 Pro Safari 等多 iOS 机型）：本机（LS/内存/缓存）读不到
    //   该作用域时，下面这行 hydrateCurScope 要等 idbHydrateKey 取回——iOS 挂后台杀 IDB
    //   连接后单次读最长 6s、重试链最长 14s（无头桩实测 14024ms），期间渲染被 then 门控＝
    //   列表停在上一版内容（首开即旧空态「暂无字卡」）且页面内零加载态＝点下去像死机。
    //   这里在等待发生【之前】先出加载行：健康设备（本机有数据）不进本分支＝零变化、
    //   零闪动；真需要取回时用户立刻看到「正在加载字卡…」，取回完成后 render() 照常覆写。
    //   只动首屏观感，不碰取回时机与写路径权威门控（ccAuthMark/#193 语义零改动）。
    try { if (!curStore().get(curKey())) showLibLoadingSoon(); } catch (eL) {}
    hydrateCurScope().then(() => {
      groups = loadGroups();
      try { renderGroupsBar(); render(); } catch (e) {}
      clearLibLoadingRow(); // #574：取回落定后无论 render 成败都摘掉加载态，不留残留占位
      refreshLibCounts(false); // v3.15.x：懒加载取回后同步刷新列表页两行角标（此前停留 0 像「丢失」）
    });
  }
  // #574：字卡库首屏加载态（等待发生前占位，取回完成由 render() 覆写；不新建 DOM 锚点，
  //   直接复用列表容器，避免与 render() 的清空/分块渲染互相打架）。
  //   延迟 150ms 才出：空库/健康设备的一次 IDB 读通常几十毫秒内返回＝全程不出现，观感零变化；
  //   真卡住（iOS 挂后台杀连接：单次 6s、重试链 14s）才亮出「正在加载字卡…」。
  var libLoadTimer = null; // #574：用 var 避开「函数先于 let 执行」的 TDZ 风险（历史 TDZ 事故族）
  function showLibLoadingSoon() {
    try { clearTimeout(libLoadTimer); libLoadTimer = setTimeout(showLibLoadingRow, 150); } catch (e) {}
  }
  function showLibLoadingRow() {
    try {
      if (!list) return;
      list.dataset.ccLoading = '1';
      list.innerHTML = '<div class="cc-lib-loading"><span class="cc-spin"></span>正在加载字卡…</div>';
    } catch (e) {}
  }
  function clearLibLoadingRow() {
    try { clearTimeout(libLoadTimer); } catch (e0) {}
    try {
      if (!list || !list.dataset.ccLoading) return;
      delete list.dataset.ccLoading;
      const row = list.querySelector('.cc-lib-loading');
      if (row) row.remove();
    } catch (e) {}
  }
  // v3.11.x：离开自定义字卡管理页一律恢复专属作用域——回复池（getCustomCards/
  // getPokeCards/getMediaCards 等）以内存 groups 为基准，若停留在 public 作用域，
  // groups 只剩公用库：公用库为空时专属拍一拍/表情包会从联系人侧整体消失
  // （「联系人无法发送拍一拍和表情包」回归，tools/diag-pool-scope.mjs 复现）。
  // 覆盖所有离开路径：返回键 / 底部 tab / 安卓返回 / 切桌面（page 隐藏由 MutationObserver 兜底）
  function leaveCcPageReset() {
    // v3.29.x：先落盘待写变更（原实现在 public 分支直接清定时器，120ms 内刚上传的
    // 表情包/图片会因离页被静默丢弃）
    flushCcSave();
    // v3.42.x #455：离开管理页一律释放编辑树——153MB 级库的 parse 副本从「开过一次
    // 页就驻留到刷新」收敛为「只在页开着期间存在」（ jetsam 内存主源之一）；
    // 再次进入由 openCcPage 现载
    if (ccScope !== 'public') { groups = null; return; }
    ccScope = 'own';
    groups = null;
  }
  const liPub = document.getElementById('li-custom-cards-public');
  if (liPub) liPub.addEventListener('click', () => openCcPage('public'));
  const li = document.getElementById('li-custom-cards');
  if (li) li.addEventListener('click', () => openCcPage('own'));
  // v3.32.x：其他互动功能字卡双入口（公用/专属）——直接落到第一个功能分类 tab，
  // 页面标题按作用域带 ·公用 / ·专属 后缀；功能字卡取池本就合并双作用域
  const liFunMine = document.getElementById('li-fun-cards-mine');
  if (liFunMine) liFunMine.addEventListener('click', () => openCcPage('own', 'fish'));
  const liFunPub = document.getElementById('li-fun-cards-public');
  if (liFunPub) liFunPub.addEventListener('click', () => openCcPage('public', 'fish'));
  const ccBack = document.getElementById('cc-back');
  if (ccBack) {
    ccBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-chatcard');
      if (home) home.hidden = false;
      leaveCcPageReset();
    });
  }

  // v3.7.x：离开自定义字卡页时自动退出批量管理模式——manageBar 挂在 body 上，
  // 不随页面 hidden 隐藏，会残留并"跑到"其他页面（用户反馈）。监听 page-custom-cards
  // 的 hidden 变化，覆盖所有离开路径：返回按钮 / 底部 tab / 安卓返回键 / 其他入口
  // v3.11.x：同处恢复专属作用域（leaveCcPageReset，防 ccScope 停在 public 挤掉专属池）
  const ccPageEl = document.getElementById('page-custom-cards');
  if (ccPageEl && typeof MutationObserver !== 'undefined') {
    new MutationObserver(() => {
      if (ccPageEl.hidden) {
        leaveCcPageReset();
        if (manageMode) exitManage();
      }
    }).observe(ccPageEl, { attributes: true, attributeFilter: ['hidden'] });
  }

  // v3.7.x：字卡库页顶部两大分类切换（可自定义字卡 / 系统预设字卡）
  const ccSectBtns = document.querySelectorAll('.cc-top-tabs .cc-tab[data-ccsect]');
  const ccSectBodies = {
    custom: document.getElementById('cc-sect-custom'),
    preset: document.getElementById('cc-sect-preset')
  };
  ccSectBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.getAttribute('data-ccsect');
      ccSectBtns.forEach(b => b.classList.toggle('sel', b === btn));
      if (searchInput2) searchInput2.value = '';
      if (searchResultEl) searchResultEl.hidden = true;
      Object.keys(ccSectBodies).forEach(key => {
        const el = ccSectBodies[key];
        if (el) el.hidden = (key !== k);
      });
    });
  });

  // #319 系统预设分区锁状态说明：锁定＝联系人与各功能取不到系统预设字卡，需开屏输二级密码解锁；
  // 解锁/上锁都只发生在开屏卡（clock.js），这里只读状态展示，随 mochi-cardlock-* 事件实时刷新
  (function ccPresetLockHint() {
    const el = document.getElementById('cc-preset-lock-hint');
    if (!el || !window.cardLockOpen) return;
    function render() {
      const open = window.cardLockOpen();
      el.textContent = open
        ? '当前状态：系统预设字卡已解锁（二级验证已通过），联系人回复与各功能可正常取用。'
        : '当前状态：系统预设字卡已全部锁定（防未成年人保护，不是 bug），联系人回复与各功能均取不到系统预设字卡。不输密码也能正常使用，密码只管两件事：解锁系统预设字卡、跳过开屏的 2 个问答。注意（#499 豁免说明）：聊天情绪字卡、TA 的心情、聊天回应字卡这三大互动链不受锁定影响，未解锁也照常使用；受影响的只有默认聊天字卡、词典（含词典拼字）等系统预设池。锁定时若自定义字卡（含 mj 字卡）一张都没添加，回复会更单薄（情绪/回应字卡仍在，但少了系统预设内容），建议先在自定义字卡里添加几张；如已成年，请回开屏公告区点「输入密码解锁」输入二级验证密码，解锁后刷新生效。';
    }
    render();
    document.addEventListener('mochi-cardlock-open', render);
    document.addEventListener('mochi-cardlock-locked', render);
  })();

  // v3.15.x：顶部两大分类 tab 显示字卡总数徽标——
  // 汇总各自分区里全部条目的 .t 计数。各模块（quote-cards/p2-features/ta-ask/
  // ck-question/ta-invite/loc-lib 及本文件公用·专属角标）会在加载与数据变化时
  // 直写 .t 文本且时序不一（部分在 idbRestore 回填后），这里不逐个模块接线：
  // MutationObserver 监听两个分区容器（subtree+childList+characterData），
  // 防抖重算总和；徽标复用既有 .cc-tab-n 样式（含 dark.css 暗色适配与 .zero 灰化）。
  (function ccTopTabTotals() {
    if (!ccSectBtns.length) return;
    function sectSum(el) {
      if (!el) return 0;
      let n = 0;
      el.querySelectorAll('.chat-item .t').forEach(t => {
        const v = parseInt(String(t.textContent == null ? '' : t.textContent).replace(/[^\d]/g, ''), 10);
        if (!isNaN(v) && v > 0) n += v;
      });
      return n;
    }
    function renderTotals() {
      ccSectBtns.forEach(btn => {
        const k = btn.getAttribute('data-ccsect');
        let em = btn.querySelector('.cc-tab-n');
        if (!em) { em = document.createElement('em'); em.className = 'cc-tab-n'; btn.appendChild(em); }
        const n = sectSum(ccSectBodies[k]);
        em.textContent = n;
        em.classList.toggle('zero', n <= 0);
      });
    }
    let totalsTm = null;
    if (typeof MutationObserver !== 'undefined') {
      const mo = new MutationObserver(() => {
        if (totalsTm) clearTimeout(totalsTm);
        totalsTm = setTimeout(renderTotals, 120);
      });
      Object.keys(ccSectBodies).forEach(key => {
        const el = ccSectBodies[key];
        if (el) mo.observe(el, { subtree: true, childList: true, characterData: true });
      });
    }
    renderTotals();
    // 数据就绪后再刷一次（部分模块在 IDB 回填完成后才写计数）
    document.addEventListener('mochi-restore-done', renderTotals);
  })();

  // ================= v3.15.x：挂起大键懒加载统一收口（修「公用字卡丢失」） =================
  // 启动回填预算（idb.js v3.14.x OOM 防线）把大字卡库键挂起在 IndexedDB
  // （__xyIdbDeferredKeys）时，store.get 三路（LS/内存/已驻留缓存）全空：
  // 回复池、列表页角标、管理页在取回前一律读成空库——公用字卡看起来「丢了」，
  // 尤其冷启动后切换桌面联系人再进字卡库（diag-public-cards-switch.mjs S2 复现：
  // 角标停在 0，等 20s 也不会自己回来）。此前唯一取回路径是 openCcPage 的
  // hydrateCurScope；列表页角标与回复池永远等不到数据。这里收口成一处：
  //   ① 用户打开字卡库列表页（page-chatcard 显示）→ 顺序取回 公用键 + 当前桌面专属键；
  //   ② 切换桌面联系人 → 同上（用户正在查看新桌面的场景）；
  //   ③ 取回成功 → pubInvalidate + 按当前作用域重载界面 + 刷新列表页角标。
  // 红线：绝不在启动链路/后台定时器自动取回——v3.14.x 预算系统就是为了防几十 MB
  // 大键在无人查看时被拉进堆压崩低端机（27MB 公用库真机案例）；只在用户正在看的
  // 场景按需拉一把，且多键顺序执行避免叠加峰值。会话内取回一次后常驻内存零开销。
  const hydInflight = {};
  // v3.25.x：本会话已用健康连接确认「IDB 确实无此键」的键（新装/新联系人的正常空库）
  // ——命中则不再空读，避免每次构建回复池都发一次 IDB get
  const hydAbsent = {};
  function hydFullKey(scope) {
    return scope === 'public' ? (PUB_PREFIX + ':' + PUB_KEY) : (window.activePrefix() + ':cc-groups');
  }
  // v3.27.x：按指定联系人取回其字卡键——群聊/跨桌面取池时各成员桌面的 cc-groups
  // 大键可能被启动回填挂起，For 系列 getter 此前只触发当前桌面取回，群聊成员回复
  // 池因此读成空库落 FALLBACK_REPLIES。cid 传空时按当前桌面语义（hydrateScope）。
  function hydrateScope(scope, cid) {
    if (!window.idbHydrateKey) return Promise.resolve(false);
    let fullKey = '', deferred = false;
    try {
      fullKey = cid ? ('xy-home-v2:' + cid + ':cc-groups') : hydFullKey(scope);
      deferred = Array.isArray(window.__xyIdbDeferredKeys) && window.__xyIdbDeferredKeys.indexOf(fullKey) >= 0;
    } catch (e) {}
    // v3.25.x（修「字卡数据没有加载」iOS 高发）：此前只认挂起名单——回填链在 iOS
    // 挂后台/事务失败被打断时，键读丢了也不进名单，三路读全空且永不取回，字卡库
    // 空载、TA 回复没有自定义字卡。改为：数据读不到就取回（用户正在看的场景，
    // 显式读不受回填预算限制）；健康连接确认 IDB 无此键才记 absent，此后跳过。
    if (!deferred && hydAbsent[fullKey]) return Promise.resolve(false);
    if (!deferred) {
      let hasData = false;
      try {
        hasData = cid
          ? !!(window.storeFor && window.storeFor(cid).get('cc-groups'))
          : (scope === 'public' ? !!pubStore().get(PUB_KEY) : !!store.get('cc-groups'));
      } catch (e) {}
      if (hasData) {
        // v3.26.x #193：三路读已有数据（LS/内存/缓存）= 内存即权威口径，写路径放行
        if (fullKey === curFullKey()) ccAuthMark();
        return Promise.resolve(false);
      }
    }
    if (hydInflight[fullKey]) return hydInflight[fullKey];
    hydInflight[fullKey] = window.idbHydrateKey(fullKey).then(ok => {
      delete hydInflight[fullKey];
      if (ok === null) {
        hydAbsent[fullKey] = true;
        // v3.26.x #193：健康连接确认 IDB 无此键（新装/空库）= 内存空库就是全部，放行直写
        if (fullKey === curFullKey()) ccAuthMark();
        return false;
      }
      // v3.26.x #193：权威库已取回进 store，写路径放行
      if (fullKey === curFullKey()) ccAuthMark();
      pubInvalidate();
      libCounts.pub = -1; libCounts.own = -1; libCounts.fun = -1; libCounts.pubFun = -1;
      const scopeLive = (scope === 'public') ? (ccScope === 'public') : (ccScope === 'own');
      // v3.42.x #455：管理页开着才重载编辑树+界面；页关着保持懒加载态（角标由
      // 下方 refreshLibCounts 走池视图刷新）——聊天/回复路径的取回不再顺手把
      // 153MB 级 parse 副本拉进堆常驻（「一开聊天就冻结/自动重载」主源之一）
      if (scopeLive && ccPageOpen()) {
        try { groups = loadGroups(); renderGroupsBar(); render(); } catch (e) {}
      }
      refreshLibCounts(false);
      return true;
    }).catch(() => { delete hydInflight[fullKey]; return false; });
    return hydInflight[fullKey];
  }
  let libHydChain = Promise.resolve();
  function hydrateLibScopes(scopes) {
    // 顺序链式取回（避免多把 MB 级大键同时进内存叠加峰值）
    // v3.25.x：hydrateScope 自带「有数据/已确认无键就跳过」判断，直接排队即可
    scopes.forEach(s => { libHydChain = libHydChain.then(() => hydrateScope(s)).catch(() => {}); });
    return libHydChain;
  }
  function libScopesDeferred(scopes) {
    try {
      const list = window.__xyIdbDeferredKeys;
      if (!Array.isArray(list)) return false;
      return scopes.some(s => list.indexOf(hydFullKey(s)) >= 0);
    } catch (e) { return false; }
  }
  // 对外暴露给聊天页表情包/拍一拍面板等场景：与字卡库列表页共用同一套链式取回
  // （复用 libHydChain 排队+去重），取回完成后回调，供面板重绘。
  // 仍是「用户正在看的场景按需拉一把」，不在启动链路/后台定时器自动取回。
  window.hydrateLibScopes = function (scopes, done) {
    if (!Array.isArray(scopes) || !scopes.length) scopes = ['public', 'own'];
    return hydrateLibScopes(scopes).then(function () {
      if (done) { try { done(); } catch (e) {} }
      return true;
    });
  };
  window.libScopesDeferred = function (scopes) {
    return libScopesDeferred(Array.isArray(scopes) && scopes.length ? scopes : ['public', 'own']);
  };
  // v3.28.x：回复路径专用取回——单发聊天回复池只依赖 当前联系人专属字卡 + 公用字卡。
  // hydrateLibScopes 按「公用→专属」串行链式排队，公用大键在慢 IDB（iOS 挂后台杀连接、
  // 大图字卡库）上会拖住后续专属键，回复路径等不到专属键就绪，池子一直读空落兜底
  // 预设卡（用户反馈「还是有手机没解决」）。这里直取指定作用域（own 优先），不等公用，
  // 公用由调用方随后后台补取。仍走 hydrateScope 的 in-flight 去重 + absent 缓存。
  window.hydrateReplyScope = function (scope, done) {
    return hydrateScope(scope === 'public' ? 'public' : 'own').then(function (ok) {
      if (done) { try { done(ok); } catch (e) {} }
      return true;
    });
  };
  // v3.27.x：按指定联系人取回其字卡键（群聊/跨桌面取池用）——某成员桌面 cc-groups
  // 大键被启动回填挂起时，群聊成员回复池会读成空库落 FALLBACK_REPLIES。目标 cid
  // 不是当前桌面时，只取回 公用键 + 该 cid 专属键（不扰动当前桌面）；是当前桌面
  // 则与 hydrateLibScopes 同一语义。仍按需拉一把，不在启动链路/后台自动取回。
  window.hydrateLibForCid = function (cid, done) {
    const cur = window.__activeCid || 'default';
    let p;
    if (!cid || cid === cur) {
      p = hydrateLibScopes(['public', 'own']);
    } else {
      libHydChain = libHydChain
        .then(() => hydrateScope('public'))
        .then(() => hydrateScope('own', cid))
        .catch(() => {});
      p = libHydChain;
    }
    return p.then(function () {
      if (done) { try { done(); } catch (e) {} }
      return true;
    });
  };
  // 字卡库列表页每次显示时兜底取回（覆盖「冷启动直接进字卡库」「切完桌面进字卡库」）
  // v3.25.x：显示时无条件 hydrateLibScopes（内部自判断：有数据/已确认无键都是零开销跳过，
  // 只对真缺数据的键取回）+ 强制重算两行角标——iOS 慢回填/读丢恢复后，进列表页是用户
  // 最直观的查看时点，角标必须反映最新数据而不是首屏时的缓存 0。
  (function () {
    const libPage = document.getElementById('page-chatcard');
    if (libPage && typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => {
        if (libPage.hidden) return;
        refreshLibCounts(true);
        if (libScopesDeferred(['public', 'own'])) {
          try { toast('字卡较多，正在加载…'); } catch (e) {}
          // FIX 2026-09-16 #575：取回期间两行角标显示「…」而非 0——0 会被当成「字卡丢了」
          //（#574 同族：等待本身没办法缩短，但不能让等待期的界面说谎）。取回落定后强制
          //  重算一次把真值填回；失败/无数据也一样重算（还 0 就是真 0）。
          markLibCountsLoading();
          hydrateLibScopes(['public', 'own']).then(function () {
            try { refreshLibCounts(true); } catch (e) {}
          });
          return;
        }
        hydrateLibScopes(['public', 'own']);
      }).observe(libPage, { attributes: true, attributeFilter: ['hidden'] });
    }
    // #266 修复标记：本块必须立即调用（结尾 `})();`）。漏掉调用括号＝语法仍合法、
    // node --check 与哨兵都查不出，但整段兜底取回变死代码 → iOS 回填被打断后字卡库永久空载。
  })();

  // v3.4x：字卡数据健康探针（供设置→工具「字卡使用状态自检」card-audit.js 调用）——只读，
  //   扫当前桌面专属池 + 公用池的池视图（令牌化后），统计：
  //   tokens=媒体池令牌卡数、missing=池里已缺失的令牌（渲染成占位/发不出）、
  //   bigMedia=单卡 dataURL >512KB 的超大图（库体积/卡顿来源）、badVoice=格式异常的语音卡。
  window.__ccAuditHealth = function () {
    const out = { tokens: 0, missing: 0, bigMedia: 0, badVoice: 0 };
    function scan(g) {
      if (!g) return;
      ['sticker', 'image'].forEach(function (t) {
        (g[t] || []).forEach(function (grp) {
          if (!Array.isArray(grp) || !Array.isArray(grp[1])) return;
          grp[1].forEach(function (c) {
            if (typeof c !== 'string') return;
            if (c.indexOf('@@m:') === 0) {
              out.tokens++;
              if (window.mochiMediaTokenMissing && window.mochiMediaTokenMissing(c)) out.missing++;
            } else if (c.indexOf('data:image') === 0 && c.length > 512 * 1024) {
              out.bigMedia++;
            }
          });
        });
      });
      (g['voice'] || []).forEach(function (grp) {
        if (!Array.isArray(grp) || !Array.isArray(grp[1])) return;
        grp[1].forEach(function (c) {
          if (typeof c !== 'string' || !c) return;
          const i = c.indexOf('|||');
          if (i < 0 || c.slice(i + 3).indexOf('data:audio') !== 0) out.badVoice++;
        });
      });
    }
    try { scan(ownPoolRaw()); } catch (e) {}
    try { scan(pubGroupsRaw()); } catch (e) {}
    return out;
  };

  // v3.26.x：字卡/回复/收藏 存储明细诊断——报障「该分类 583MB 是否正常」一眼定位
  // 哪个键大、是否有 LS 残留大键（双倍计算）、旧 my-emoji-groups 各桌面遗留（应清未清）。
  // 只读不写；device.js 诊断【数据】节异步调用，返回 Promise<string>。
  window.__ccStorageDiag = function () {
    const PRE = 'xy-home-v2:';
    const BIG = 200 * 1024;
    const catRe = /^(cc-groups|cc-groups-public|default-cards|quote-cards|reply-|fav-|ta-mood|poke-|emoji-|my-emoji-groups|rps-score|mh-|rc-enabled|mc-enabled|chat-count)/;
    const catOf = function (k) {
      const tail = k.indexOf(PRE) === 0 ? k.slice(PRE.length) : k;
      const m = /^(?:[^:]+:)?(.*)$/.exec(tail);
      const base = m ? m[1] : tail;
      return catRe.test(base) ? 'cc' : 'other';
    };
    const szOf = function (v) {
      if (v == null) return 0;
      if (v instanceof Blob) return v.size;
      if (v instanceof ArrayBuffer) return v.byteLength;
      if (typeof v === 'string') return v.length * 2;
      try { return JSON.stringify(v).length * 2; } catch (e) { return 0; }
    };
    const fmt = function (b) {
      if (b < 1024) return b + 'B';
      if (b < 1048576) return (b / 1024).toFixed(1) + 'KB';
      return (b / 1048576).toFixed(2) + 'MB';
    };
    const ls = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(PRE) !== 0) continue;
        ls.push({ k: k, sz: (k.length + (localStorage.getItem(k) || '').length) * 2 });
      }
    } catch (e) {}
    const lsCc = ls.filter(function (x) { return catOf(x.k) === 'cc'; });
    const lsCcSum = lsCc.reduce(function (s, x) { return s + x.sz; }, 0);
    const tail = function (k) { return k.indexOf(PRE) === 0 ? k.slice(PRE.length) : k; };
    return new Promise(function (res) {
      if (!window.idbListKeys || !window.idbGetMany) {
        res('字卡/回复/收藏明细：LS ' + lsCc.length + '键 ' + fmt(lsCcSum) + '；IDB 接口不可用');
        return;
      }
      window.idbListKeys().then(function (keys) {
        if (!keys) { res('字卡/回复/收藏明细：LS ' + lsCc.length + '键 ' + fmt(lsCcSum) + '；IDB 清单读取失败'); return; }
        const idbCc = (keys || []).map(String).filter(function (k) { return k.indexOf(PRE) === 0 && catOf(k) === 'cc'; });
        if (!idbCc.length) {
          res('字卡/回复/收藏明细：LS ' + lsCc.length + '键 ' + fmt(lsCcSum) + ' + IDB 0键');
          return;
        }
        window.idbGetMany(idbCc).then(function (map) {
          const idb = idbCc.map(function (k) { return { k: k, sz: szOf(map[k]) }; });
          const idbCcSum = idb.reduce(function (s, x) { return s + x.sz; }, 0);
          const all = lsCc.concat(idb).sort(function (a, b) { return b.sz - a.sz; });
          const lines = [];
          lines.push('字卡/回复/收藏明细：LS ' + lsCc.length + '键 ' + fmt(lsCcSum) + ' + IDB ' + idb.length + '键 ' + fmt(idbCcSum) + ' = ' + (lsCc.length + idb.length) + '键 ' + fmt(lsCcSum + idbCcSum));
          lines.push('Top15 大键：');
          all.slice(0, 15).forEach(function (x) { lines.push('  ' + fmt(x.sz) + '  ' + tail(x.k)); });
          const lsBig = lsCc.filter(function (x) { return x.sz > BIG; });
          if (lsBig.length) {
            lines.push('⚠ LS 残留大键（>200KB，应已迁 IDB，残留=双倍计算）：');
            lsBig.forEach(function (x) { lines.push('  ' + fmt(x.sz) + '  ' + tail(x.k)); });
          }
          const emojiLegacy = lsCc.concat(idb).filter(function (x) { return /:[^:]+:my-emoji-groups$/.test(x.k); });
          if (emojiLegacy.length) {
            lines.push('⚠ 旧各桌面 my-emoji-groups 遗留（应只剩全局一份）：');
            emojiLegacy.forEach(function (x) { lines.push('  ' + fmt(x.sz) + '  ' + tail(x.k)); });
          }
          const ownCc = lsCc.concat(idb).filter(function (x) { return /:cc-groups$/.test(x.k); }).sort(function (a, b) { return b.sz - a.sz; });
          if (ownCc.length) {
            lines.push('各桌面专属 cc-groups：');
            ownCc.forEach(function (x) { lines.push('  ' + fmt(x.sz) + '  ' + tail(x.k)); });
          }
          const pubCc = lsCc.concat(idb).filter(function (x) { return x.k.indexOf(':cc-groups-public') >= 0; });
          if (pubCc.length) {
            lines.push('公用 cc-groups-public：');
            pubCc.forEach(function (x) { lines.push('  ' + fmt(x.sz) + '  ' + tail(x.k)); });
          }
          res(lines.join('\n'));
        }).catch(function () {
          res('字卡/回复/收藏明细：LS ' + lsCc.length + '键 ' + fmt(lsCcSum) + ' + IDB 读取失败');
        });
      }).catch(function () {
        res('字卡/回复/收藏明细：LS ' + lsCc.length + '键 ' + fmt(lsCcSum) + ' + IDB 清单读取失败');
      });
    });
  };
})();

