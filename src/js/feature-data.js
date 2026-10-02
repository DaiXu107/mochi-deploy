// ===== 功能：各功能数据 单独导出 / 导入 / 清空（v3.27.x） =====
// 需求（用户 2026-09-17）：桌面上每个功能都要能「单独导出数据 / 导入数据 / 清空数据」，
// 原来只有聊天、朋友圈、信箱三处零散实现（chat-settings.js 的 cs-export-msgs 三行、
// feed.js 的 feed-clear-all、mail.js 的 mailExportData/mailImportFile/mailClearAll），
// 其余功能（花园/房间/记账/经期/占卜/音乐/小游戏…）用户只能整库备份，不能只搬一个功能。
//
// 做法：本文件集中登记「功能 → 存储键范围」，一套通用引擎对任意功能做导出/导入/清空，
// 不逐个改各功能源码（避免 38 个功能文件各写一套 + 各功能的 store 边界漂移）。
//   · 键空间解析：全站键只有三种形态——xy-home-v2:<后缀>（全局/默认桌面旧顶层键）、
//     xy-home-v2:<cid>:<后缀>（联系人独立命名空间）、以及归属某个功能的动态后缀
//     （cal-2026-09-17 / memo-2026-09-17 / music-file:<id> 等）。
//   · 作用域 scope：desk＝只碰当前桌面（清空花园不影响另一个桌面）、global＝全局键
//     （所有桌面共用，如音乐/抉择）、both＝两类键都算该功能的数据。
//   · 清空只删「本功能匹配到的键」，绝不碰媒体池 xy-home-v2:media:<hash>（跨功能共享，
//     消息/动态里的 @@m: 令牌都指向它）与字体包 font-blob-<hash>（各桌面引用同一份）。
//   · 导出按内容寻址带上值里引用到的媒体池条目（@@m: 令牌），导入时回写——否则换机后
//     图片/语音全空。清空永不删池子，避免「清空备忘录把聊天图片一起删了」。
//   · 导入/清空后强制 reload：各功能的 store 有一层内存缓存（xyStore 的 memoryCache）
//     与 IDB 回填时序，就地改内存无法覆盖全部模块（chat.js/feed.js 各有内存真相），
//     重载是唯一能保证「界面与落盘一致」的收口方式。
(function () {
  var G = 'xy-home-v2';
  var CID_RE = /^(default|c[0-9a-z]{5,}):(.*)$/; // 联系人 id 生成见 contacts.js：'c' + base36 时间戳 + 随机
  var MEDIA_RE = /@@m:([0-9a-f]{32})/g;
  var MEDIA_PREFIX = 'media:';
  var BLOB_PREFIX = 'font-blob-'; // 上传字体包：全局唯一存储 + 各桌面引用，不属于任何单功能

  // ---- 键空间解析：full → {cid, suffix}；cid === null 表示「顶层键」（全局键或默认桌面旧键位） ----
  function parseKey(full) {
    if (typeof full !== 'string' || full.indexOf(G + ':') !== 0) return null;
    var rest = full.slice(G.length + 1);
    if (!rest) return null;
    var m = CID_RE.exec(rest);
    if (m) return { cid: m[1], suffix: m[2], full: full };
    return { cid: null, suffix: rest, full: full };
  }
  // 命名空间前缀（写/删都经它，见 idb.js xyStore：同时管内存缓存 + LS + IDB 三层）
  function nsOf(cid) { return cid === null ? G : G + ':' + cid; }
  // 本功能「所有桌面共用那一份」实际锚在哪个命名空间（读登记表 anchor，缺省＝顶层根键）
  function sharedNsOf(f) { return f.anchor ? G + ':' + f.anchor : G; }
  // 一把尺子问「这一格是不是该功能的共享命名空间」：顶层根键永远是；登记表点名那一格
  // （音乐 anchor='default' → xy-home-v2:default:）也是——它装的不是某个联系人的私有数据，
  // 而是模块自己硬当公共库用的那一份（判据只取「键落在哪个命名空间＋功能登记的锚点」两个事实，
  // 零机型／零 UA 分支：同一份数据在任何内核上都一直看不见，与设备型号无关）。
  function isSharedNs(f, info) { return info.cid === null || (!!f.anchor && info.cid === f.anchor); }
  // 「没有数据」这句话也得跟着命名空间事实走：共享功能报「本桌面暂无数据」把用户吓成
  // 「我的桌面没了」，而它真正该说的是「这台机器上没有这份数据」。
  function whereWord(f) { return f.scope === 'desk' ? '本桌面' : '本机'; }

  function curCid() {
    try { var c = window.__activeCid; if (c) return c; } catch (e) {}
    return 'default';
  }

  // ================= 功能登记表 =================
  // scope：'desk' 当前桌面 / 'global' 全局共用 / 'both' 两类都含
  // res：后缀正则（匹配 parseKey 后的 suffix，不含命名空间）
  // anchor（只对 global/both 有意义）：这份「所有桌面共用」的数据**实际**锚在哪个命名空间。
  //   缺省＝顶层根键 xy-home-v2:<后缀>（抉择／群抉择／查岗开关走这条）。
  //   'default'＝锚在默认桌面命名空间 xy-home-v2:default:<后缀>——音乐整个模块把这一格当公共库
  //   硬用：music-player.js:10 `MUSIC_PREFIX = 'xy-home-v2:default'` ＋ :11 `store = storeFor('default')`，
  //   文件头注释写明「音乐数据全局共享——所有桌面共用同一份」，mergeDesksMusic() 还把各桌面原先
  //   独立的音乐并进这一格。本站「全局共用」从来不止一个落点，旧引擎却只有「global＝顶层」这一条
  //   等式 ⇒ 锚在 default 命名空间的共享数据对计数／导出／清空三扇门全隐形（vivo X200s/Edge 实报
  //   「音乐里点【导出数据】，说本桌面暂无数据」——而诊断包里 default:music-playlists 341KB、
  //   default:music-file:* 每个 11~33MB 都实实在在在库），且导入按 global 一律落到顶层＝模块读不到
  //   的地方＝第二次静默丢数据。判据按事实拆成两格，不再由 scope 反推命名空间。
  // page：该功能自己的页面 id（#679 各功能页内直达入口；跨域声明见 WORKLOG——
  //       只读各功能 template/JS 已有的静态 id，不改任何归属文件）
  var FEATURES = [
    // #1346 审计（desk→both）：聊天这一族的键横跨两个锚点，且**表情包那一大块整体在顶层根命名空间**——chat.js:12341-12345
    // `myEmojiStore()=xyStore(MYE_G_PREFIX)`（MYE_G_PREFIX 就是 'xy-home-v2'，:12342 那句拼键自证）写
    // `my-emoji-groups`／`hide-ta-sticker`／`emoji-recent`／`emoji-recent-<类别>`；美化方案 `chat-beauty-schemes` 走
    // chat-settings.js:1943+1958 的 `gStoreChat=xyStore('xy-home-v2')`；字体面 `cs-font` 也有一份根键（:1642/1647）；
    // 开关 `chat-panel-prewarm` 注释直接写「全局根键」（chat.js:13582）。旧 desk 只在当前桌面恰好是 default 时才认根键
    // ⇒ 第二个联系人桌面上「导出聊天」里没有公用表情包分组、没有最近使用、没有隐藏 TA 贴纸开关（13MB 级数据在库里看不见）。
    // 同批把 /^rp-wallet$/ 从本行摘掉（只留红包封面 /^rp-cover-/）：那是心意币旧账本（memory-game.js:141 读根键、
    // chat.js:9247 只当迁移源），旧表把它挂在聊天名下而 gift 行也登记了同一把——first match wins 让 gift 永远拿不到；
    // chat 一翻 both 就会把这份钱从「礼物与集市」彻底抢走，故归位给 gift。
    { id: 'chat', name: '聊天', group: '聊天与社交', scope: 'both', page: 'page-chat', btns: 'cs-export-msgs,cs-import-msgs,cs-clear-msgs',
      desc: '聊天记录、聊天设置（气泡/字号/时间轴/输入栏）、表情包与文字库、拍一拍、红包、引用',
      // #1325b 审计：ask-think-secs＝聊天设置里的「TA 思考秒数」（chat.js:10129/10147 走 activeStore），
      // 旧表里没有这一项 ⇒ 换机后 TA 又变回默认 3 秒思考。
      res: [/^chat-/, /^cs-(?!avatar-|lbl-)/, /^rp-cover-/, /* #1346: legacy rp-wallet moves to gift; see the chat-row comment block */ /^emoji-last$/, /^emoji-recent/, /^my-emoji-groups$/, /^my-text-groups$/, /^my-invite-groups$/, /^mye-global-migrated$/, /^hide-tab-/, /^hide-ta-sticker$/, /^invite-ask-history$/, /^poke-/, /^rps-score$/, /^scroll-anchor-auto$/, /^sysmsg-/, /^more-tab$/, /^more-cat$/, /^mail-emoji-mode$/, /^qixi-today$/, /^ask-think-secs$/] },
    // #1325 审计（与 requests 同族＝scope 与模块真实命名空间脱节）：群聊的键按 group-chat.js:4
    // 「消息全局存储（xy-home-v2:group-chat-msgs），不随联系人切换变」全在顶层根命名空间
    // （:79 gc-groups、:113 gc-profiles、:2052 gc-msgs-<gid>、:212 gc-beauty），旧登记 desk 只在
    // 「当前桌面恰好是 default」时才认顶层键（featureOfKey 的 isTop && cid==='default' 那半条兜底）
    // ⇒ 第二个联系人桌面上群聊＝「本桌面暂无数据」，导出/清空都看不见，而群聊页照旧有全部记录。
    { id: 'gc', name: '群聊', group: '聊天与社交', scope: 'both', page: 'page-group-chat',
      desc: '群聊记录、群分组、群成员资料、群聊美化与设置',
      // #1325b 审计：group-chat-enabled（群聊总开关）由 chat-settings.js:2691-2694 走 xyStore(GNS) 写在顶层，
      // 旧表只认 /^group-chat-msgs$/ ⇒ 开关本身导不出也清不掉（新设备上「群聊没开」这个状态跟不过去）。
      res: [/^gc-/, /^group-chat-msgs$/, /^group-chat-enabled$/] },
    // #1346 审计（desk→both）：公用字卡／表情包库按设计就是全局一份——chatcard.js:23 注释「公用字卡：全局根命名空间
    // 键 xy-home-v2:cc-groups-public——以后每个桌面的联系人都能使用」，:28 `PUB_KEY`、:37 同族的 `cc-groups-public-off`；
    // default-cards.js:186-197 的自定义词典 `dict-custom-quotes`／`dict-custom-words` 也走 `raw=xyStore('xy-home-v2')`；
    // reply-settings.js:239-245 的 `reply-gc-*` 同形。⇒ 旧 desk 在联系人桌面上把这一整块判成「没数据」。
    // ⚠️ 翻 both 后从任何桌面导出都会见到 `cc-groups-public`（用户机上实测 424.59 MB）——它由 planKeys 的
    // ONE_KEY_MAX 挡在文件外并当场说明「请用整包备份」，清空仍会真删它（弹窗按 both 口径写明影响所有桌面）。
    { id: 'cards', name: '字卡库与回复设置', group: '聊天与社交', scope: 'both', page: 'page-custom-cards', btns: 'cc-export,cc-import-data,cc-clear-all',
      desc: '自定义/公用/默认字卡、词典、TA 回复字卡、各类概率与开关（回复设置）',
      // #1325b 审计：mood-reply-cards.js:55/99/102/403/419 这套「心情回应卡」开关与概率＝mc-enabled / mc-prob-<type> /
      // mc-off-<类别> / mh-<类别> / rc-enabled（回应字卡总开关，与撤回补发的 rc-en 是两个键，card-audit.js:440 注明），
      // 旧表一条都不认 ⇒ 关掉的类别换机后全部悄悄 reopen。
      res: [/^cc-/, /^quote-cards/, /^reply-/, /^dc-/, /^dcf-/, /^dict-/, /^rcard-/, /^tm-/, /^rps-/, /^mc-/, /^mh-/, /^rc-/] },
    { id: 'fav', name: '收藏', group: '聊天与社交', scope: 'desk', page: 'page-fav',
      desc: '我收藏的消息/字卡/图片与 TA 的收藏',
      // #1325 审计：fav-settings.js:17/32 写的四把概率键是 fav-ta-msg / fav-ta-card / fav-ta-mail /
      // fav-ta-feed，旧正则一条都不认（/^fav-settings/ 是另一种拼法）⇒「收藏」页里 TA 收藏概率
      // 整段导不出也清不掉（导出去的文件里没有它，清空后这四个设置照旧生效）。
      res: [/^fav-msgs$/, /^fav-img-/, /^fav-media-/, /^fav-settings/, /^fav-ta-/] },
    { id: 'identity', name: '昵称与头像', group: '聊天与社交', scope: 'desk',
      desc: '双方当前昵称、头像、聊天页昵称与头像（各功能显示处共用这份资料）',
      // #1325b 审计：partner-gender（contacts.js:319-321 按 cid 存『他/她/TA』）不在任何 res 里 ⇒ 换机后所有指代
      // 回到默认「TA」，而它正是 #1325 那族「键在桌面命名空间但没人管」的又一格。
      res: [/^lbl-user$/, /^lbl-partner$/, /^cs-lbl-/, /^avatar-user$/, /^avatar-partner$/, /^cs-avatar-/, /^records-avatar$/, /^partner-gender$/] },
    { id: 'interact', name: '头像和昵称互动', group: '聊天与社交', scope: 'desk', page: 'page-interact',
      desc: '头像库/昵称库与其自动更换进度、开关',
      // #1325 审计：头像库那一套四把键（avatar-lib / avatar-me-lib 家族）在册，昵称库只登了
      // /^nick-lib/，而 avatar-lib.js:1339-1410 的「我的昵称库」写的是 nick-me-lib / -enabled /
      // -next / -last / -cur-hash ⇒ 换装一半导得出去一半出不去（清完头像库，昵称库还悄悄换我的名字）。
      res: [/^avatar-lib/, /^avatar-me-lib/, /^nick-lib/, /^nick-me-lib/] },
    { id: 'mail', name: '信箱', group: '聊天与社交', scope: 'desk', page: 'page-mail', btns: 'mail-export,mail-import,mail-clear',
      desc: '收信/寄信/回信、待回信计划、信箱设置（含每周摸鱼小结）',
      res: [/^mail-/, /^ml-/] },
    { id: 'feed', name: '朋友圈', group: '聊天与社交', scope: 'both', page: 'page-feed', btns: 'feed-clear-all',
      desc: '全部动态、评论点赞、通知提醒、封面与昵称头像',
      res: [/^feed-/] },
    { id: 'ask', name: 'TA 的提问与问卷', group: '聊天与社交', scope: 'desk', page: 'page-ta-ask',
      desc: 'TA 的提问/选择题/好奇/吐槽、问卷作答记录、询问提醒时间',
      // #1325b 审计：ta-invite.js:115/116 的 ti-last-id（上一条邀请到哪一首）无人认领 ⇒ 换机后从第一条重头邀请。
      res: [/^ta-ask$/, /^ta-survey$/, /^ta-choose$/, /^ta-curious$/, /^ta-roast$/, /^ta-cc-state$/, /^ta-checkin$/, /^interact-card-last$/, /^ta-chime:/, /^ti-last-id$/] },
    // #1325 审计：desk-msg-en 由 chat.js:6221 走 activeStore 写在**各桌面**命名空间，其余四把开关
    // 由 incoming-requests.js:43-104 走 xyStore(ROOT) 写在顶层——旧登记 global 只认顶层 ⇒ 这把
    // 「跨桌面来消息」开关两头都拿不到（requests 按 global 拒认 per-cid，desktop 的 /^desk-/ 又排在它后面）。
    { id: 'requests', name: '跨桌面查岗 / 来电开关', group: '聊天与社交', scope: 'both',
      desc: '跨桌面查岗开关与频率、跨桌面来电、夜间静默模式、待处理请求',
      res: [/^incoming-requests$/, /^desk-checkin-en$/, /^desk-call-en$/, /^desk-freq-mode$/, /^desk-msg-en$/, /^night-mode-en$/] },

    { id: 'calendar', name: '日历与每日留言', group: '桌面功能', scope: 'desk', page: 'page-calendar',
      desc: '每日留言、心情与语录历史、恋爱开始日、首次使用日、日历标注',
      // #1325b 审计：p2-features.js:1380/1381 的 legacyToday('memo'／'today-mood', …) 读的就是这两个**裸旧键**
      // （:1409/:1429 仍在写），旧正则 /^memo-(?!app)/ 与 /^today-mood-/ 都带短横 ⇒ 当日那条备忘/心情既读不回也导不走。
      res: [/^cal-/, /^memo-(?!app)/, /^mood-history$/, /^quote-history$/, /^today-mood-/, /^first-use-date$/, /^love-start$/, /^memo$/, /^today-mood$/] },
    { id: 'records', name: '纪念与统计', group: '桌面功能', scope: 'desk', page: 'page-home',
      desc: '纪念日、通话记录、关心/摸鱼收获等纪念页数据',
      res: [/^records-(?!coin)/] },
    // #1346 审计（desk→both）：牌面与图鉴走 divination.js:248/285/289/302 的 `gStore`＝根命名空间
    // （`divine-faces-idx`、`divine-leno-36`、`divine-face-onebased`、`divine-face-<m>-<n>`），只有抽牌历史
    // `divine-history` 随桌面（:797）⇒ 旧 desk 在联系人桌面上「有历史、没牌面」，导出回去的自定义牌面全丢。
    { id: 'divination', name: '占卜', group: '桌面功能', scope: 'both', page: 'page-divine',
      desc: '占卜历史、自定义牌面与图鉴、牌面编号开关',
      res: [/^divine-/, /^divf-/] },
    { id: 'music', name: '音乐', group: '桌面功能', scope: 'global', anchor: 'default', page: 'page-music',
      desc: '本地上传的音乐文件、歌单、收藏、播放顺序与播放记录（所有桌面共用一份）',
      res: [/^music-/] },
    { id: 'fish', name: '摸鱼与上班天数', group: '桌面功能', scope: 'both',
      desc: '摸鱼累计天数、上班打卡天数、双方各自的摸鱼记录',
      res: [/^fish-/, /^work-/, /^day-fish/, /^day-work/, /^weekend-fish/] },
    { id: 'tongpin', name: '同频', group: '桌面功能', scope: 'desk', page: 'page-tongpin',
      desc: '同频状态与发送记录',
      res: [/^tongpin-/] },
    { id: 'shenshou', name: '伸手', group: '桌面功能', scope: 'desk', page: 'page-shenshou',
      desc: '伸手次数、上次伸手时间与字卡',
      res: [/^shenshou-/] },
    { id: 'water', name: '喝水', group: '桌面功能', scope: 'desk', page: 'page-water',
      desc: '喝水目标与历史、连续天数、提醒语',
      res: [/^water-/] },
    { id: 'eat', name: '吃什么', group: '桌面功能', scope: 'desk', page: 'page-eat',
      desc: '菜单、抽取历史与提醒开关',
      res: [/^eat-/] },
    // #1346 审计（desk→both）：罐子本体走 p2-features.js:3540 `piggyStore()=xyStore('xy-home-v2')`
    // （`piggy-log`、`piggy-goals`），心意币两把参数 `piggy-coin-prob`／`piggy-coin-ask-limit` 也是根键（chat.js:9411/9418 读）,
    // 只有 `piggy-coin2-*` 那套新罐随桌面（p2-features.js:3950）⇒ 旧 desk 在联系人桌面上把流水与目标判成没数据。
    { id: 'piggy', name: '存钱罐', group: '桌面功能', scope: 'both', page: 'page-piggy',
      desc: '存钱目标与流水、心意币两套罐子、来访记录',
      res: [/^piggy-/] },
    // #1325 审计（三处同族）：pomoStore=xyStore('xy-home-v2')（p2-features.js:3281，注释即「番茄钟
    // 数据全局共享……所有桌面读写同一份」）、memo-app.js:4-9（「数据全局共享……键在 xy-home-v2 根
    // 命名空间」）、applock.js:32-36 与 card-lock.js:26-47（applock-* / cardlock-state 都在根命名
    // 空间）。旧登记 desk 只在当前桌面恰好是 default 时才认顶层键 ⇒ 第二个联系人桌面上番茄钟／备忘
    // 录／二级密码锁三行全报「本桌面暂无数据」，导出与清空都碰不到它们（而页面自己照常读写同一份）。
    { id: 'pomo', name: '番茄钟', group: '桌面功能', scope: 'both', page: 'page-pomodoro',
      desc: '番茄钟设置、累计次数与今日进度、陪伴记录',
      res: [/^pomo-/] },
    { id: 'checkin', name: '打卡与查岗记录', group: '桌面功能', scope: 'desk', page: 'page-checkin',
      desc: '打卡记录与历史、查岗卡片状态、连续天数',
      // #1325b 审计：ck-question.js:222/304/354 的 ckq-last-id / ckq-last-at（今天已经问过哪一条）与
      // p2-features.js:8253/9407/9441 的裸键 checkin（摸鱼打卡日）都不落在 /^ck-/ 上（差一个字母 q）
      // ⇒ 换机当天会被当成「没问过／没打过卡」重复问一遍。
      res: [/^checkin-/, /^ck-/, /^ck-off-/, /^ckq-/, /^checkin$/] },
    { id: 'loc', name: '定位', group: '桌面功能', scope: 'desk', page: 'page-loc-cards',
      desc: '定位历史、气泡与特效开关、自动定位、定位组合',
      res: [/^loc-/, /^loc-auto/, /^loc-sense/] },
    { id: 'garden', name: '花园', group: '桌面功能', scope: 'desk', page: 'page-garden',
      desc: '种下的花与生长进度、收获记录',
      res: [/^garden-/] },
    { id: 'cjian', name: '此间与梦角档案', group: '桌面功能', scope: 'both', page: 'page-cjian',
      desc: '此间状态与换家标记、成员名册、梦角档案（含时辰区间）',
      res: [/^cjian-/, /^narc-/] },
    // #1346 审计（desk→both）：`myarc-shared`（共享给 TA 的那份，my-arc.js:24 `gStore()=xyStore(GNS)`＋:182-218）
    // 与当前档案指针 `myarc-cur`（:234/:848 同一个 gStore）都在根命名空间，档案本体 `myarc` 才随桌面 ⇒ 旧 desk
    // 在联系人桌面上只导得出一份空壳档案，共享内容与「现在看的是哪一份」都丢。
    { id: 'myarc', name: '我的档案', group: '桌面功能', scope: 'both', page: 'page-my-arc',
      desc: '我的档案资料与共享给 TA 的部分',
      res: [/^myarc/] },
    { id: 'room', name: '房间', group: '桌面功能', scope: 'desk', page: 'page-room',
      desc: '房间摆放与装修、家具位置',
      res: [/^room-/] },
    { id: 'drift', name: '漂流瓶', group: '桌面功能', scope: 'desk', page: 'page-drift',
      desc: '我扔出/收到的漂流瓶与回复',
      res: [/^drift-/] },
    { id: 'memo', name: '备忘录', group: '桌面功能', scope: 'both', page: 'page-memo',  // desk→both：见 pomo 上方 #1325 批注
      desc: '备忘录条目、发送记录、全局迁移标记',
      res: [/^memo-app-/] },
    { id: 'period', name: '经期记录', group: '桌面功能', scope: 'both', page: 'page-period',
      desc: '经期记录与预测、每日状态、关心语与提醒设置',
      res: [/^period-/] },
    { id: 'accounting', name: '记账', group: '桌面功能', scope: 'desk', page: 'page-accounting',
      desc: '账目记录、分类、预算与心意币记录',
      // #1325 审计：TA 记账提醒三把键 acc-remind-on/-prob/-day（accounting.js:786-788，随桌面隔离）
      // 旧正则 /^accounting-/ 认不到 ⇒ 账本搬走了、提醒却还在新设备上每天发。
      res: [/^accounting-/, /^acc-remind/, /^records-coin/] },
    { id: 'gift', name: '礼物与集市', group: '桌面功能', scope: 'both', page: 'page-market',
      desc: '礼物盒、集市商品与自定义、钱包与心愿单、每日购买额度',
      res: [/^gift-/, /^market-/, /^giftbox-items$/, /^ml2_/, /^rp-wallet$/, /^wl-/, /^gift-wishlist/] },
    { id: 'decision', name: '抉择', group: '桌面功能', scope: 'global',
      desc: '抉择历史与设置（全局，所有桌面共用）',
      res: [/^decision-/, /^dec-/] },
    { id: 'gdec', name: '群抉择', group: '桌面功能', scope: 'global',
      desc: '群抉择历史、成员与设置（全局，所有桌面共用）',
      res: [/^gdec-/] },
    { id: 'mood', name: '心情日记', group: '桌面功能', scope: 'desk', page: 'page-mood',
      desc: '心情日记条目与记录',
      res: [/^mood-diary$/] },
    // #1346 审计（desk→both）：游戏音效偏好按设计是全局一份——auction.js:165/1040 直接读写
    // `localStorage['xy-home-v2:au-sound']`，注释写明「音效偏好全局记忆（非联系人维度）」⇒ 旧 desk
    // 在联系人桌面上清不掉也导不出它（换机后每个新桌面都回到默认开）。
    { id: 'games', name: '小游戏', group: '桌面功能', scope: 'both',
      desc: '各小游戏的音效/动画开关与进行中的局面标记',
      res: [/^snake-/, /^snk-/, /^brick-/, /^c4-/, /^ms-(?!g-)/, /^m3-/, /^lk-/, /^gk-/, /^au-/, /^pong-/, /^game-/] },
    { id: 'desktop', name: '桌面布局与美化', group: '桌面与系统', scope: 'desk',
      desc: '桌面图标位置/顺序/大小、隐藏图标、壁纸与组件美化、主题色、美化方案',
      // #1325b 审计：标签栏/页签图标那一组美化（personalize.js:1851/1885/1941/2969 的 tabbar-bg-color、tabbar-bg-op、
      // tabbar-whole-op、tabbar-radius、tabbar-blur、tabbar-icon-size、tab-icon-<页>、tab-icon-opacity）与两处桌面图钉
      // （:6818/6822 的 divination-desk-pin、group-chat-desk-pin）从没登记 ⇒ 导出的「桌面美化」里没有标签栏样式。
      // ⚠️ 同批把 /^bg-keep/ 从本行搬去 sys：那是 bg-keep.js 的**后台保活**开关（pwa.js:94 与 bg-keep.js:1557 读写），
      // 挂在「桌面布局与美化」名下会让清空美化顺手关掉保活——搬走才是它该待的那一行。
      res: [/^desk-/, /^hidden-icons/, /^page-bg-/, /^card-bg-/, /^ico-/, /^phone-bg/, /^widget-/, /^app-icon/, /^app-name-color$/, /^beauty-/, /^full-beauty-/, /^decor-/, /^home-/, /^p2apps-order/, /^p2icons-/, /^rel-/, /^mem-extras$/, /^no-statusbar$/, /^bg-blur$/, /^bg-mask-op$/, /^loading-/, /^tabbar-/, /^tab-icon-/, /-desk-pin$/] },
    { id: 'lock', name: '二级密码锁', group: '桌面与系统', scope: 'both',  // desk→both：见 pomo 上方 #1325 批注
      desc: '应用锁密码、密保问答、锁定开关与字卡锁状态',
      res: [/^applock/, /^cardlock/] },
    { id: 'call', name: '通话', group: '桌面与系统', scope: 'both',
      desc: '通话背景与来电弹窗背景、通话小框位置与开关、通话中/挂起现场（记录本身在「纪念与统计」里）',
      // #1325b 审计：call.js 这一族旧表**整行缺失**——小框位置/开关走 activeStore（:385/390 call-mini-pos、
      // :275 CALL_MINI_KEY、:447 起的 call-bg / :148 call-half-bg 通话背景），而通话中与挂起现场
      // call-active / call-hold 是 xyStore(G) 顶层键（:447 那个常量就是全名）⇒ 两个锚点都有，按 both 登记。
      // 注意别把 /^records-call/ 写进来：records-call-last 由「纪念与统计」的 /^records-(?!coin)/ 先一步认领（first match wins）。
      res: [/^call-mini-/, /^call-bg$/, /^call-half-bg$/, /^call-active$/, /^call-hold$/] },
    { id: 'sys', name: '音效与系统设置', group: '桌面与系统', scope: 'both', page: 'page-sfx-settings',
      desc: '音效总开关与统一模式、开屏公告已读、引导完成标记、数据备份提醒时间',
      // #1325b 审计：这一行原本四条正则**形同空转**——真键名是 __onboard-done / __guide-done / __last-backup /
      // __last-export-ts（onboarding.js:13、pwa.js:416/672、data-backup.js:16），带 __ 前缀，旧写法一条都不认。
      // 那几条是「备份提醒／引导」的产品记账（AGENTS.md 明令保护备份提醒），本批刻意不登记进任何功能的清空范围，
      // 只把 audit() 的口径改成「__ 开头＝机器记账」，让它不再冒充「没人管的用户数据」。
      // 真正该有人管而一直没人管的三格补上：深浅色 theme-mode / 强调色 accent-color（personalize.js:4910 注释
      // 「全局设置，不按联系人隔离」的顶层键）、后台保活与通知 bg-keepalive / bg-notify（bg-keep.js:1150/1557 走
      // gSet 顶层；从「桌面布局与美化」那行搬来）、版本更新提示开关 ver-update-notify（pwa.js:193）。
      res: [/^sfx-/, /^notice-/, /^onboarding/, /^guide-/, /^splash-/, /^backup-/, /^last-export$/, /^install-/, /^theme-mode$/, /^accent-color$/, /^bg-keep/, /^bg-notify/, /^ver-update-notify$/] }
  ];

  // ================= #679 各功能页内数据卡的挂点 =================
  // 值＝该功能页里的**滚动内容容器**（卡 append 进容器末尾：随内容滚动、位于页面最下方，
  // 不占固定高度容器的位置、不挤压原有布局）。只用各功能 template/JS 已有的静态 class/id，
  // 不改任何归属文件。找不到挂点的功能页放弃注入（绝不动原页面结构），见 FD_SKIP。
  // ⚠️ 有的容器会被所属模块整块 innerHTML 重写（实测：#myarc-root ← my-arc.js、#gc-body ←、
  // #fav-list ← 等），所以注入后必须挂 childList 观察者把卡补回，见 watchBarHost。
  var FD_MOUNTS = {
    calendar: '.cal-scroll',
    records: '.cal-scroll',
    interact: '.cal-scroll',
    divination: '.div-scroll',
    music: '.sm-scroll, .cal-scroll',
    tongpin: '.tp-body',
    shenshou: '.ss-body',
    water: '.water-body',
    eat: '.eat-body',
    piggy: '.piggy-body',
    pomo: '.pomo-body',
    checkin: '.cal-scroll',
    loc: '.gs-scroll',
    garden: '.garden-scroll',
    cjian: '#cj-main',
    myarc: '.narc-scroll',
    drift: '.drift-scroll',
    memo: '.memo-body',
    period: '.period-scroll',
    accounting: '.acc-scroll',
    gift: '.market-body',
    mood: '.cal-scroll',
    fav: '#fav-list',
    ask: '.gs-scroll',
    sys: '.gs-scroll'
  };
  // 刻意不注入的功能页：
  //   · 房间页 #page-room 是 overflow:hidden 的固定全屏场景（场景/clamp 高度/底部按钮条各占
  //     一份），塞任何卡片都会挤压小屋内景；要加得先重排房间布局。
  //   · 群聊页 #page-group-chat 的主体 #gc-body 就是**消息列表**，卡会混进消息流里、且每次渲染
  //     都被重建，既难看也可能干扰贴底逻辑；群聊数据改走集中页（设置 → 工具 → 各功能数据管理）。
  var FD_SKIP = { room: 1, gc: 1 };

  // 一个键最多归属一个功能（first match wins）——避免同一键被两个功能各删一次/各导一份
  function featureOfKey(full, cid) {
    var info = parseKey(full);
    if (!info) return null;
    if (info.suffix.indexOf(MEDIA_PREFIX) === 0 || info.suffix.indexOf(BLOB_PREFIX) === 0) return null; // 共享资源池不归属任何功能
    for (var i = 0; i < FEATURES.length; i++) {
      var f = FEATURES[i];
      var hit = false;
      for (var j = 0; j < f.res.length; j++) { if (f.res[j].test(info.suffix)) { hit = true; break; } }
      if (!hit) continue;
      var isTop = info.cid === null;
      if (f.scope === 'global') { if (isSharedNs(f, info)) return f; continue; }
      if (f.scope === 'both') { if (isSharedNs(f, info) || info.cid === cid) return f; continue; }
      if (info.cid === cid || (isTop && cid === 'default')) return f;
    }
    return null;
  }
  // 导入用：只看后缀像不像（不限定命名空间形态），文件来自别的桌面也能认出来
  function featureOfSuffix(f, suffix) {
    if (suffix.indexOf(MEDIA_PREFIX) === 0 || suffix.indexOf(BLOB_PREFIX) === 0) return false;
    for (var j = 0; j < f.res.length; j++) { if (f.res[j].test(suffix)) return true; }
    return false;
  }

  // ================= 键枚举与取值 =================
  // #1162（用户实报 vivo X200s/Edge「心情日记想导出，说这个桌面没有数据」）：IDB 清单是
  // 严格语义——idbListKeys() 返回数组＝权威清单，返回 null＝这次没读到（大键写入占用连接、
  // 探测超时，重度数据机型高发）。原实现把 null 折叠成空清单静默降级：键只存在于 IDB
  // （LS 配额满/被逐出/大键不进 LS）时，导出/计数会把它误报成「没有数据」。
  // 现在：null → 有界重试一次；仍没读到 → 清单挂 incomplete 标记，消费方不得据此断言「无数据」。
  function allKeys() {
    var set = Object.create(null);
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(G + ':') === 0) set[k] = 1;
      }
    } catch (e) {}
    function gather(idbKeys) {
      (idbKeys || []).forEach(function (k) { if (k && String(k).indexOf(G + ':') === 0) set[String(k)] = 1; });
      var out = Object.keys(set);
      out.incomplete = idbKeys === null;
      return out;
    }
    if (!window.idbListKeys) return Promise.resolve(gather([]));
    return window.idbListKeys().then(function (keys) {
      if (keys !== null) return gather(keys);
      return new Promise(function (res) { setTimeout(function () { res(window.idbListKeys()); }, 800); })
        .then(function (k2) { return gather(k2 === undefined ? null : k2); });
    }).catch(function () { return gather(null); });
  }
  function keysOf(f, cid) {
    return allKeys().then(function (all) {
      var out = all.filter(function (k) { var o = featureOfKey(k, cid); return o && o.id === f.id; });
      out.incomplete = all.incomplete;
      return out;
    });
  }
  // 取值优先级：IDB 权威值 → xyStore（内存缓存 + LS 快照）
  function readFallback(full) {
    var info = parseKey(full);
    if (!info) return null;
    try {
      var v = window.xyStore ? window.xyStore(nsOf(info.cid)).get(info.suffix) : null;
      if (v !== null && v !== undefined) return v;
    } catch (e) {}
    try { return localStorage.getItem(full); } catch (e) { return null; }
  }
  function readValues(keys) {
    var out = {};
    var missing = [];
    var bin = [], binBytes = 0;
    var i = 0;
    // 分批读：旧写法把这一功能的**全部**键塞进一次 idbGetMany——而它在 4s+4s 后只回**部分**映射
    // （idb.js:326），缺的那些被当成「这个键没有值」静默丢掉，导出照报成功、文件里却没有最大的
    // 那几项。重度数据机上「字卡库」一行还会把 424MB 的 cc-groups-public 往堆里拉（诊断实测该机
    // JS 堆已 1545MB／上限 3586MB）。批量与 data-backup.js 的 measureProject 同一把尺（80）。
    function take() {
      if (i >= keys.length) {
        try {
          // 非枚举：消费方（导出载荷、summarize）都按 Object.keys(values) 走，挂成普通字段
          // 就会把 'missing' 当成一项数据写进备份文件
          Object.defineProperty(out, 'missing', { value: missing, enumerable: false });
          Object.defineProperty(out, 'bodies', { value: bin, enumerable: false });
          Object.defineProperty(out, 'bodyBytes', { value: binBytes, enumerable: false });
        } catch (e) { out._m = missing; }
        return out;
      }
      var unit = keys.slice(i, i + READ_BATCH); i += READ_BATCH;
      var p = (window.idbGetMany ? window.idbGetMany(unit) : Promise.resolve({}));
      return Promise.resolve(p).catch(function () { return {}; }).then(function (map) {
        unit.forEach(function (k) {
          var v = map ? map[k] : null;
          if (v === undefined) v = null;
          if (v === null) v = readFallback(k);
          if (v === null || v === undefined) { missing.push(k); return; }
          // 二进制文件体（音乐音频在 IDB 里就是 Blob）：字符串化只剩一个空壳对象＝一句假数据
          // 混进文件里，换机照样放不出歌。归进「带不走」那一堆，按 Blob 自己的 .size 报体积。
          if (typeof Blob !== 'undefined' && v instanceof Blob) { bin.push(k); binBytes += v.size || 0; return; }
          out[k] = v;
        });
        return take();
      });
    }
    return Promise.resolve(take());
  }
  // ================= 体积：不读值就知道有多大 =================
  // idb.js 的 __big-idx 在写入时记下 >200KB 值的长度（window.idbBigSize），LS 里的直接取长度；
  // 整机备份测体积走的就是这一族尺子（data-backup.js 的 overSmallLimit / measureProject）。
  var READ_BATCH = 80;                      // 一次 idbGetMany 的键数上限（与 data-backup.js measureProject 同尺）
  var INTERNAL_RE = /^__/; // 双下划线开头＝机器自己记的账（写日志 __wr-journal / 每键标记 __wr-j: / 大键索引 __big-idx /
  // 诊断指纹 __diag-* / 保活取证 __ka-* / 会话心跳 __sess-* / 备份留底 __auto-backup-snapshot…），不是任何人的数据；
  // 只影响 audit() 的体检口径，不参与认领判据（这些键本来也没有任何 res 该认它们）
  var FILE_BODY_RE = /^music-file:/;        // 本地音频文件体：与 data-backup.js 的 MUSIC_KEY_RE 同一族
  var ONE_KEY_MAX = 32 * 1024 * 1024;       // 单键超此值不内联进一个 JSON 字符串（下载/分享上限同量级）
  function sizeOfKey(full) {
    try { var b = window.idbBigSize ? window.idbBigSize(full) : null; if (typeof b === 'number' && b > 0) return b; } catch (e) {}
    try { var s = localStorage.getItem(full); if (s != null) return s.length; } catch (e) {}
    return null; // 未知（既不在 LS 也没进索引）＝不得据此断言它小
  }
  // 把一功能的键清单分成三堆：可内联的 / 音频文件体 / 大到读不动的普通键。
  // 只有第一堆进 readValues——后两堆按免读值的尺子计费，并在弹窗里如实报出去（旧写法根本不
  // 分堆，因为音乐键压根看不见：anchor 一修，几百个 11~33MB 的文件体就会直冲内存）。
  function planKeys(keys) {
    var small = [], bodies = [], tooBig = [], bodyBytes = 0, bodyUnknown = 0, bigBytes = 0;
    keys.forEach(function (k) {
      var info = parseKey(k);
      var n = sizeOfKey(k); // 文件体在 IDB 里是 Blob，尺寸索引与 LS 都不认它＝量不出来（n===null）
      if (info && FILE_BODY_RE.test(info.suffix)) { bodies.push(k); if (n === null) bodyUnknown++; else bodyBytes += n; return; }
      if (n !== null && n > ONE_KEY_MAX) { tooBig.push(k); bigBytes += n; return; }
      small.push(k);
    });
    return { small: small, bodies: bodies, tooBig: tooBig, bodyBytes: bodyBytes, bodyUnknown: bodyUnknown, bigBytes: bigBytes };
  }
  // 项数＋体积一把算完：体积免读值（含带不走的那两堆），条数只对读得到的小键统计
  // （与 countOf 的 >1MB 不整包 parse、data-backup 的 exportCoverage 同口径）。
  function statKeys(keys) {
    var plan = planKeys(keys);
    return readValues(plan.small).then(function (values) {
      var st = summarize(values);
      // 读的时候才发现是二进制的项（没有家族特征的 Blob）并进「带不走」那一堆，体积按 .size 计
      if (values.bodies && values.bodies.length) {
        plan.bodies = plan.bodies.concat(values.bodies);
        plan.bodyBytes += values.bodyBytes || 0;
        plan.small = plan.small.filter(function (k) { return values.bodies.indexOf(k) < 0; });
      }
      return { values: values, plan: plan, total: keys.length,
        missing: (values.missing && values.missing.length) || 0, unmeasured: plan.bodyUnknown,
        bytes: st.bytes + plan.bodyBytes + plan.bigBytes, items: st.items };
    });
  }
  // 带不走的东西要当场说清，别留到换机那天才发现（返回要拼进弹窗文案的行）
  function carriedLines(plan) {
    var lines = [];
    if (plan.bodies.length) lines.push('另有 ' + plan.bodies.length + ' 个本地音频文件体' + (plan.bodyUnknown ? '' : '（约 ' + fmtSize(plan.bodyBytes) + '）')
      + ' 不在单功能导出里：二进制文件体只有整机备份带得走（设置 → 通用 → 导出数据，可选「不含音乐文件」）；'
      + '到新设备重新添加音乐文件即可，歌单/收藏/播放记录都会跟着这份文件走。');
    if (plan.tooBig.length) lines.push('另有 ' + plan.tooBig.length + ' 项体积过大（约 ' + fmtSize(plan.bigBytes)
      + '）没有打包进来：这一档请用 设置 → 通用 → 导出数据 做整包备份。');
    return lines;
  }
  function mediaRefsOf(values) {
    var set = Object.create(null);
    Object.keys(values).forEach(function (k) {
      var v = values[k];
      if (typeof v !== 'string' || v.indexOf('@@m:') < 0) return;
      var m; MEDIA_RE.lastIndex = 0;
      while ((m = MEDIA_RE.exec(v))) set[m[1]] = 1;
    });
    return Object.keys(set).map(function (h) { return G + ':' + MEDIA_PREFIX + h; });
  }

  // ================= 统计与体积 =================
  function byteLen(s) { try { return new Blob([s]).size; } catch (e) { return (s || '').length; } }
  function fmtSize(n) {
    if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n > 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }
  function countOf(v) {
    // 值可能是 JSON 文本（LS/IDB 里统一以字符串存），也可能已是对象
    var d = v;
    if (typeof d === 'string') {
      if (d.length > 1048576) return ''; // 超大键不整包 parse（聊天记录/字卡库可达几十 MB）
      try { d = JSON.parse(d); } catch (e) { return ''; }
    }
    if (Array.isArray(d)) return d.length + ' 条';
    if (d && typeof d === 'object') return Object.keys(d).length + ' 项';
    return '';
  }
  function summarize(values) {
    var keys = Object.keys(values);
    var bytes = 0, items = 0, sample = '';
    keys.forEach(function (k) {
      var v = values[k];
      bytes += byteLen(typeof v === 'string' ? v : String(v));
      var c = countOf(v);
      if (c) { var n = parseInt(c, 10); if (!isNaN(n)) { items += n; if (!sample) sample = c; } }
    });
    return { keyCount: keys.length, bytes: bytes, items: items, sample: sample };
  }

  // ================= 导出 =================
  function exportFeature(f, cb) {
    var cid = curCid();
    keysOf(f, cid).then(function (keys) {
      if (!keys.length) { toast(keys.incomplete ? '这次没能读到本机数据库的键清单（数据库可能正被大项占用），不代表没有数据——稍等片刻再导出' : '「' + f.name + '」在' + whereWord(f) + '还没有数据'); if (cb) cb(false); return; }
      return statKeys(keys).then(function (st) {
        var values = st.values;
        var media = mediaRefsOf(values);
        return readValues(media).then(function (mv) {
          Object.keys(mv).forEach(function (k) { values[k] = mv[k]; });
          if (!Object.keys(values).length) {
            // 键在清单上、一项值都没读到＝此刻数据库读不动（#1162 同一课：读不到 ≠ 没有）。
            // 这时候最不该做的就是出具一份「看起来成功」的空文件——那只会在换机那天才发现是空的。
            toast('这次一项值都没读到（本机数据库正被大项占用时会出现），没有出具文件；稍等片刻再导一次，或直接走 设置 → 通用 → 导出数据。');
            if (cb) cb(false);
            return;
          }
          var bytes = 0;
          Object.keys(values).forEach(function (k) { bytes += byteLen(typeof values[k] === 'string' ? values[k] : String(values[k])); });
          var lines = ['将导出「' + f.name + '」的 ' + Object.keys(values).length + ' 项数据' + (st.items ? '（约 ' + st.items + ' 条记录）' : '') +
            '，打包体积约 ' + fmtSize(bytes) + '。'];
          lines.push('作用范围：' + scopeText(f) + '。');
          lines = lines.concat(carriedLines(st.plan));
          if (st.missing) lines.push('注意：有 ' + st.missing + ' 项这次没读到值（大项正在被数据库占用时会出现这种读数），它们不在这份文件里——稍等片刻再导一次，或改走 设置 → 通用 → 导出数据。');
          if (media.length) lines.push('已附带这些数据里引用到的 ' + media.length + ' 张图片/语音（媒体池条目）。');
          lines.push('导出不会改动本机任何数据。');
          if (!window.openModal) return;
          window.openModal('导出「' + f.name + '」数据？', '', function () {
            var json;
            try {
              var parts = ['{"app":"mochi-feature-data","version":"1.0","feature":' + JSON.stringify(f.id) + ',"featureName":' + JSON.stringify(f.name) + ',"cid":' + JSON.stringify(cid) + ',"exportTime":"' + new Date().toISOString() + '","keys":{'];
              var ks = Object.keys(values);
              for (var i = 0; i < ks.length; i++) {
                if (i) parts.push(',');
                parts.push(JSON.stringify(ks[i]) + ':' + JSON.stringify(values[ks[i]]));
              }
              parts.push('}}');
              json = parts.join('');
            } catch (e) { toast('导出失败：' + (e && e.message || '未知错误')); return; }
            var fname = 'mochi' + f.name.replace(/[\/\\:*?"<>|]/g, '') + '_' + localDate() + '.json';
            if (window.mochiExportFile) window.mochiExportFile(json, fname, '导出' + f.name + '数据');
            else { toast('导出功能暂不可用'); return; }
            if (cb) cb(true);
          }, { noInput: true, staticText: lines.join('\n') });
        });
      });
    }).catch(function (e) { toast('导出失败：' + (e && e.message || '未知错误')); if (cb) cb(false); });
  }
  function localDate() {
    var d = new Date();
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function scopeText(f) {
    if (f.scope === 'global') return f.anchor ? '所有桌面共用一份（这一份在 ' + f.anchor + ' 桌面命名空间里）' : '全局键，所有桌面共用';
    if (f.scope === 'both') return f.anchor ? '当前桌面 + 所有桌面共用的一份（共用那一份在 ' + f.anchor + ' 桌面命名空间里）' : '当前桌面 + 全局键';
    return '当前桌面（不影响其他桌面）';
  }
  // 行内标签用短名：同一个标签每行都出现，长句会把 39 行列表读成噪音；
  // 完整含义在页首说明与导出/清空弹窗里给全（弹窗仍走 scopeText）。
  function shortScope(f) {
    if (f.scope === 'global') return '全局';
    if (f.scope === 'both') return '本桌面+全局';
    return '本桌面';
  }

  // ================= 导入 =================
  // 支持三种文件：本页导出的 {app:'mochi-feature-data',keys} / 整份 mochi 备份 {ls,idb} / 裸的 {键:值}
  function extractKeyMap(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.keys && typeof data.keys === 'object' && !Array.isArray(data.keys)) return data.keys;
    var out = Object.create(null), n = 0;
    var take = function (obj) {
      if (!obj || typeof obj !== 'object') return;
      Object.keys(obj).forEach(function (k) { if (k.indexOf(G + ':') === 0) { out[k] = obj[k]; n++; } });
    };
    if (data.ls || data.idb) { take(data.ls); take(data.idb); return n ? out : null; }
    Object.keys(data).forEach(function (k) { if (k.indexOf(G + ':') === 0) { out[k] = data[k]; n++; } });
    return n ? out : null;
  }
  function targetOf(f, srcKey, cid) {
    var info = parseKey(srcKey);
    if (!info) return null;
    if (info.suffix.indexOf(MEDIA_PREFIX) === 0) return { ns: G, suffix: info.suffix };
    // 共享功能：落到**该功能登记的锚点**，不是恒落顶层——旧写法把「全局＝顶层」当等式，
    // 于是音乐文件里的 default:music-* 被改写成顶层 xy-home-v2:music-*，而 music-player.js
    // 只读 storeFor('default') 那一格 ⇒ 导入报「已导入，正在刷新…」而屏上什么都没有（第二次
    // 静默丢数据，且这一次连「暂无数据」的提示都没有）。
    if (f.scope === 'global' || (f.scope === 'both' && info.cid === null)) return { ns: sharedNsOf(f), suffix: info.suffix };
    // desk / both 的桌面键：一律落到当前桌面命名空间（别的桌面导出的数据搬进本桌面）
    return { ns: G + ':' + cid, suffix: info.suffix };
  }
  function importFromFile(f, file, cb) {
    readFileText(file).then(function (text) {
      var data = null;
      try { data = JSON.parse(text || 'null'); } catch (e) {}
      if (!data) { toast('文件不是有效的 JSON，无法导入'); if (cb) cb(false); return; }
      var map = extractKeyMap(data);
      if (!map) { toast('文件里没有数据'); if (cb) cb(false); return; }
      var cid = curCid();
      var incoming = Object.create(null); // 目标键 → 值
      var mediaCount = 0, otherFeature = 0;
      Object.keys(map).forEach(function (k) {
        var info = parseKey(k);
        if (!info) return;
        if (info.suffix.indexOf(MEDIA_PREFIX) === 0) { incoming[G + ':' + info.suffix] = map[k]; mediaCount++; return; }
        if (info.suffix.indexOf(BLOB_PREFIX) === 0) return; // 字体包不随功能数据搬运
        var owner = featureOfSuffix(f, info.suffix);
        if (!owner) { otherFeature++; return; }
        var t = targetOf(f, k, cid);
        if (t) incoming[t.ns + ':' + t.suffix] = map[k];
      });
      var nKeys = Object.keys(incoming).length - mediaCount;
      if (!nKeys) { toast('文件里没有「' + f.name + '」的数据' + (otherFeature ? '（含 ' + otherFeature + ' 项其他功能的数据，已忽略）' : '')); if (cb) cb(false); return; }
      var bytes = 0;
      Object.keys(incoming).forEach(function (k) { bytes += byteLen(typeof incoming[k] === 'string' ? incoming[k] : String(incoming[k])); });
      var lines = ['文件里有「' + f.name + '」的 ' + nKeys + ' 项数据，约 ' + fmtSize(bytes) + '。'];
      if (mediaCount) lines.push('含 ' + mediaCount + ' 张图片/语音（媒体池条目，按内容去重写入）。');
      if (otherFeature) lines.push('另有 ' + otherFeature + ' 项其他功能的数据，本次不会改动。');
      lines.push('导入后页面会自动刷新。');
      var re = /^xy-home-v2:(?:default|c[0-9a-z]{5,}):(.+)$/;
      var deskKeys = Object.keys(incoming).filter(function (k) { return re.test(k); }).length;
      void deskKeys;
      if (!window.openModal) return;
      window.openModal('导入「' + f.name + '」数据？', '', function (v) {
        var replace = (v === 'replace');
        var todo = function () {
          var pairs = Object.keys(incoming);
          if (replace) {
            return keysOf(f, cid).then(function (old) {
              old.forEach(function (k) { var i = parseKey(k); if (i) rmKey(i); });
              return pairs;
            });
          }
          return Promise.resolve(pairs);
        };
        todo().then(function (pairs) {
          pairs.forEach(function (k) {
            var i = parseKey(k);
            if (!i) return;
            try { window.xyStore(nsOf(i.cid)).set(i.suffix, incoming[k]); } catch (e) {}
          });
          toast(replace ? '已替换为文件数据，正在刷新…' : '已导入，正在刷新…');
          scheduleReload();
          if (cb) cb(true);
        });
      }, { noInput: true, staticText: lines.join('\n'), pill: 'merge', pills: [
        { label: '合并（同项以文件为准）', value: 'merge' },
        { label: '清空本功能后导入', value: 'replace' }
      ] });
    });
  }
  function readFileText(file) {
    return new Promise(function (resolve) {
      if (file && typeof file.text === 'function') { file.text().then(resolve).catch(function () { viaReader(); }); return; }
      viaReader();
      function viaReader() {
        try {
          var r = new FileReader();
          r.onload = function () { resolve(String(r.result || '')); };
          r.onerror = function () { resolve(''); };
          r.readAsText(file, 'utf-8');
        } catch (e) { resolve(''); }
      }
    });
  }
  function pickFile(f, cb) {
    // FIX 2026-09-18 #755：统一走 window.mochiFilePick（原实现 detached＋无 label＋accept 迟到）
    window.mochiFilePick({
      id: 'mochi-featuredata-import-pick', accept: window.mochiDataPickAccept, // #1413：与整机导入同一份并集（窄串会让转存后改了类型的备份灰显）
      onFiles: function (files) {
        var file = files && files[0];
        if (!file) { try { toast('没有取到文件，请再选一次'); } catch (e) {} return; }
        importFromFile(f, file, cb);
      }
    });
  }

  // ================= #679 各功能页内操作（数据卡按钮） =================
  // 按钮在功能页内点击＝与集中页完全同一条引擎路径（导出弹窗/导入范围/清空确认都一致）；
  // 清空/导入完成后 scheduleReload 自动刷新，用户自然回到该功能页看新数据。

  // ================= 清空 =================
  function rmKey(info) {
    try { window.xyStore(nsOf(info.cid)).remove(info.suffix); } catch (e) {}
    // xyStore.remove 已含内存缓存 + LS + IDB 三层；IDB 不可用时再兜一次裸删
    try { if (!window.xyStore) localStorage.removeItem(info.full); } catch (e) {}
  }
  // 导入/清空后自动刷新（内存缓存 + 各模块内存真相无法就地同步）。
  // __mochiFdNoReload 是 verify 脚本的钩子：只验「数据确实写/删了」，不刷新页面。
  function scheduleReload() {
    if (window.__mochiFdNoReload) return;
    setTimeout(function () { try { location.reload(); } catch (e) {} }, 600);
  }
  function clearFeature(f, cb) {
    var cid = curCid();
    keysOf(f, cid).then(function (keys) {
      if (!keys.length) { toast(keys.incomplete ? '这次没能读到本机数据库的键清单，先不清空——稍等片刻重试' : '「' + f.name + '」在' + whereWord(f) + '没有可清空的数据'); if (cb) cb(false); return; }
      return statKeys(keys).then(function (st) {
        var lines = ['将删除「' + f.name + '」的 ' + st.total + ' 项数据' + (st.items ? '（约 ' + st.items + ' 条记录）' : '') +
          '，约 ' + fmtSize(st.bytes) + (st.unmeasured ? '（另有 ' + st.unmeasured + ' 个音频文件体量不出体积、未计入）' : '') + '，删除后无法恢复。'];
        lines.push('作用范围：' + scopeText(f) + '。');
        if (st.plan.bodies.length) lines.push('含 ' + st.plan.bodies.length + ' 个本地音频文件体' + (st.plan.bodyUnknown ? '' : '（约 ' + fmtSize(st.plan.bodyBytes) + '）') + '——这些**不在**单功能导出的文件里，删掉只能靠重新上传找回。');
        if (st.plan.tooBig.length) lines.push('含 ' + st.plan.tooBig.length + ' 项超大项（约 ' + fmtSize(st.plan.bigBytes) + '）——同样不在单功能导出的文件里，删前先做整包备份。');
        lines.push('图片/语音媒体池与其他功能的数据不会被删（属于各功能自己的那条记录会被删掉）。');
        lines.push('清空后页面会自动刷新。');
        if (!window.openModal) return;
        window.openModal('清空「' + f.name + '」数据？', '', function () {
          keys.forEach(function (k) { var i = parseKey(k); if (i) rmKey(i); });
          // 清完再复查一次：IDB 删除是异步的，漏删会在刷新后来回来
          var gone = keysOf(f, cid);
          Promise.resolve(gone).then(function (left) {
            left.forEach(function (k) { var i = parseKey(k); if (i) rmKey(i); });
            toast('「' + f.name + '」数据已清空，正在刷新…');
            scheduleReload();
            if (cb) cb(true);
          });
        }, { noInput: true, staticText: lines.join('\n') });
      });
    }).catch(function (e) { toast('清空失败：' + (e && e.message || '未知错误')); if (cb) cb(false); });
  }

  // ================= 页面 UI =================
  function toast(msg) {
    try {
      if (typeof window.toast === 'function') { window.toast(msg); return; }
    } catch (e) {}
    var t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; t.className = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  var page, bodyEl, pageReady = false;
  function deskName() {
    var cid = curCid();
    var nick = '';
    try { nick = window.activeStore().get('lbl-partner') || ''; } catch (e) {}
    return (nick ? nick : 'TA') + '（' + cid + '）';
  }
  function render() {
    if (!bodyEl) return;
    var groups = [], gi = {};
    FEATURES.forEach(function (f) {
      if (!gi[f.group]) { gi[f.group] = { name: f.group, items: [] }; groups.push(gi[f.group]); }
      gi[f.group].items.push(f);
    });
    var html = ['<div class="cal-card glass"><div class="fd-intro">',
      '这里是<b>每个功能自己的数据</b>：导出＝把这个功能的数据单独存成一个文件；导入＝把文件里的数据放回这个功能；清空＝只删这个功能的数据。',
      '当前桌面：<b>' + esc(deskName()) + '</b>；带「全局」标记的功能所有桌面共用一份数据，清空会影响所有桌面。',
      '整机级别的「导出数据 / 导入数据」（含全部功能）仍在 设置 → 通用 顶部；聊天记录也有专门的整桌面入口。',
      '纯展示的功能（统计、计算器等）没有独立数据，不在此列。',
      '</div><div class="fd-legend">按钮含义：<b>导出</b> 下载 JSON；<b>导入</b> 选文件恢复（可选合并或先清空再导入）；<b>清空</b> 只删本功能数据，不可恢复。</div></div>'];
    groups.forEach(function (g) {
      html.push('<div class="fd-group-title">' + esc(g.name) + '</div>');
      html.push('<div class="cal-card glass fd-card">');
      g.items.forEach(function (f) {
        html.push('<div class="fd-row" data-fid="' + esc(f.id) + '">',
          '<div class="fd-main"><div class="fd-head"><span class="fd-name">' + esc(f.name) + '</span>' +
          '<span class="fd-scope ' + (f.scope === 'desk' ? 'desk' : 'global') + '">' + esc(shortScope(f)) + '</span></div>',
          '<div class="fd-count" data-count="' + esc(f.id) + '">统计中…</div>',
          '<div class="fd-desc">' + esc(f.desc) + '</div>',
          '<div class="fd-btns">',
          '<button class="fd-btn" type="button" data-op="export" data-fid="' + esc(f.id) + '">导出</button>',
          '<button class="fd-btn" type="button" data-op="import" data-fid="' + esc(f.id) + '">导入</button>',
          '<button class="fd-btn danger" type="button" data-op="clear" data-fid="' + esc(f.id) + '">清空</button>',
          '</div></div></div>');
      });
      html.push('</div>');
    });
    bodyEl.innerHTML = html.join('');
    refreshCounts();
  }
  function refreshCounts() {
    var cid = curCid();
    FEATURES.forEach(function (f) {
      var el = bodyEl.querySelector('[data-count="' + f.id + '"]');
      if (!el) return;
      keysOf(f, cid).then(function (keys) {
        if (el.dataset.done) return;
        el.dataset.done = '1';
        if (!keys.length) { el.textContent = keys.incomplete ? '本机数据库未读到 · 稍候重开本页' : '无数据'; if (!keys.incomplete) el.classList.add('empty'); return; }
        return statKeys(keys).then(function (st) {
          el.textContent = st.total + ' 项 · ' + fmtSize(st.bytes) + (st.items ? ' · 约 ' + st.items + ' 条' : '');
        });
      });
    });
  }
  function openPage() {
    try {
      document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
      page.hidden = false;
      render();
      var sc = page.querySelector('.cal-scroll');
      if (sc) sc.scrollTop = 0;
    } catch (e) {}
  }
  function closePage() {
    try {
      document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
      var s = document.getElementById('page-setting');
      if (s) s.hidden = false;
    } catch (e) {}
  }
  function byId(id) { for (var i = 0; i < FEATURES.length; i++) if (FEATURES[i].id === id) return FEATURES[i]; return null; }

  // ================= #679 功能页内的数据管理入口 =================
  // 需求（用户 2026-09-17）：导出/导入/清空「现在没有在每个功能里面显示，只显示在了集中里」。
  // 做法：把一张「数据管理」卡注进每个功能自己的页面（fd-bar），三个按钮复用集中页同一条
  // 导出/导入/清空引擎（含桌面隔离、媒体池保全、确认弹窗、导入范围选择）——不在 38 个功能
  // 文件里各写一套，也不会与各功能的按钮/表格争布局（卡片是块级、独占一行）。
  // 跳过三类：没有登记 page 的功能（锁/音效等设置型，本就没有独立页面入口）、已有自己三行
  // 数据按钮的页面（chat-settings / 信箱 / 朋友圈，btns 字段登记原入口 id 供验证脚本对照）、
  // 以及找不到锚点节点的页面（老版本产物/渲染失败时不注入，绝不影响原页面）。
  function fdBarHost(f, pageEl) {
    if (f.btns || FD_SKIP[f.id]) return null;
    var sel = FD_MOUNTS[f.id];
    if (!sel) return null;
    var host = pageEl.querySelector(sel);
    return host || null;
  }
  function buildFdBar(f) {
    var card = document.createElement('div');
    card.className = 'cal-card glass fd-fbar';
    card.setAttribute('data-fbar', f.id);
    card.innerHTML =
      '<div class="fd-fbar-head"><span class="fd-fbar-name">' + esc(f.name) + ' · 数据管理</span>' +
      '<button class="fd-fbar-go" type="button" data-op="open" data-fid="' + esc(f.id) + '">全部功能 ›</button></div>' +
      '<div class="fd-count" data-fcount="' + esc(f.id) + '">统计中…</div>' +
      '<div class="fd-btns">' +
      '<button class="fd-btn" type="button" data-op="export" data-fid="' + esc(f.id) + '">导出数据</button>' +
      '<button class="fd-btn" type="button" data-op="import" data-fid="' + esc(f.id) + '">导入数据</button>' +
      '<button class="fd-btn danger" type="button" data-op="clear" data-fid="' + esc(f.id) + '">清空数据</button>' +
      '</div>';
    return card;
  }
  function mountFdBars() {
    FEATURES.forEach(function (f) {
      if (!f.page) return;
      var pageEl = document.getElementById(f.page);
      if (!pageEl || pageEl.querySelector('[data-fbar]')) return;
      var host = fdBarHost(f, pageEl);
      if (!host) return;
      host.appendChild(buildFdBar(f));   // 容器末尾：随内容滚动，位于该功能页最下方
      watchBarHost(f, host);
    });
  }
  // #679 生存性：容器被所属模块整块重写时把卡补回去（实测 #myarc-root 每次打开都被
  // my-arc.js 的 innerHTML 冲掉＝用户打开「我的档案」根本看不到卡）。用 childList 观察者按需
  // 补挂，不轮询；补挂后重算一次计数（新节点是「统计中…」）。
  function watchBarHost(f, host) {
    if (!window.MutationObserver || host.__fdBarWatch) return;
    try {
      host.__fdBarWatch = 1;
      new MutationObserver(function () {
        if (!host.isConnected || host.querySelector('[data-fbar="' + f.id + '"]')) return;
        host.appendChild(buildFdBar(f));
        fdCount(f);
      }).observe(host, { childList: true });
    } catch (e) {}
  }
  function fdBarClick(e) {
    var b = e.target.closest ? e.target.closest('.fd-btn, .fd-fbar-go') : null;
    if (!b) return;
    var f = byId(b.getAttribute('data-fid'));
    if (!f) return;
    var op = b.getAttribute('data-op');
    if (op === 'export') exportFeature(f);
    else if (op === 'import') pickFile(f);
    else if (op === 'clear') clearFeature(f);
    else if (op === 'open') openPage();
  }
  function fdCount(f) {
    var el = document.querySelector('[data-fcount="' + f.id + '"]');
    if (!el || el.dataset.done) return;
    keysOf(f, curCid()).then(function (keys) {
      if (el.dataset.done) return;
      el.dataset.done = '1';
      if (!keys.length) { el.textContent = keys.incomplete ? '本机数据库未读到 · 稍候重试' : whereWord(f) + '暂无数据'; if (!keys.incomplete) el.classList.add('empty'); return; }
      return statKeys(keys).then(function (st) {
        el.textContent = st.total + ' 项 · ' + fmtSize(st.bytes) + (st.items ? ' · 约 ' + st.items + ' 条' : '');
      });
    });
  }
  function refreshFdCounts() {
    FEATURES.forEach(function (f) {
      if (!f.page || f.btns) return;
      if (!document.querySelector('[data-fcount="' + f.id + '"]')) return;
      fdCount(f);
    });
  }
  // #679 计数不谎报：卡上的「几项 · 多少 B」只在注入后算一次会越用越旧（用户加了数据仍显示
  // 旧值）。改成每次该功能页被显示时重算——用 MutationObserver 盯 .page 的 hidden 属性变化
  // （不轮询、不碰各功能自己的显示逻辑；只有 .page 本身且变为可见时才动作）。
  function refreshPageCount(pageEl) {
    FEATURES.forEach(function (f) {
      if (!f.page || f.page !== pageEl.id) return;
      var el = pageEl.querySelector('[data-fcount="' + f.id + '"]');
      if (!el) return;
      delete el.dataset.done;
      el.classList.remove('empty');
      fdCount(f);
    });
  }
  function watchPageVisibility() {
    var root = document.querySelector('.phone') || document.body;
    if (!root || !window.MutationObserver) return;
    try {
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var t = muts[i].target;
          if (!t || !t.classList || !t.classList.contains('page') || t.hidden) continue;
          refreshPageCount(t);
        }
      }).observe(root, { attributes: true, attributeFilter: ['hidden'], subtree: true });
    } catch (e) {}
  }

  function init() {
    page = document.getElementById('page-feature-data');
    bodyEl = document.getElementById('feature-data-body');
    var row = document.getElementById('row-feature-data');
    var back = document.getElementById('feature-data-back');
    if (!page || !bodyEl) return;
    pageReady = true;
    if (row) row.addEventListener('click', openPage);
    if (back) back.addEventListener('click', closePage);
    if (bodyEl) {
      bodyEl.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('.fd-btn') : null;
        if (!b) return;
        var f = byId(b.getAttribute('data-fid'));
        if (!f) return;
        var op = b.getAttribute('data-op');
        if (op === 'export') exportFeature(f);
        else if (op === 'import') pickFile(f);
        else if (op === 'clear') clearFeature(f);
      });
    }
    var refresh = document.getElementById('feature-data-refresh');
    if (refresh) refresh.addEventListener('click', function () {
      bodyEl.querySelectorAll('[data-count]').forEach(function (el) { delete el.dataset.done; el.classList.remove('empty'); el.textContent = '统计中…'; });
      refreshCounts();
      toast('已重新统计');
    });
    // #679：功能页内数据管理卡——注入 + 事件委托（卡在各自 .page 里，页面 hidden 时
    // .page[hidden] 自动连带隐藏，无需额外显隐逻辑）。各功能页有静态的（template）与
    // 运行时生成的（p2-features / memo-app 等），且数据回填可能晚于本脚本，故多次补注入。
    mountFdBars();
    document.addEventListener('click', fdBarClick, true);
    watchPageVisibility();
    setTimeout(mountFdBars, 800);
    setTimeout(function () { mountFdBars(); refreshFdCounts(); }, 2500);
    document.addEventListener('mochi-restore-done', function () { mountFdBars(); refreshFdCounts(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  // 数据恢复完成后重渲染（导入备份后页面会刷新，这里是同会话回到本页时的兜底）
  try { document.addEventListener('mochi-restore-done', function () { if (pageReady && page && !page.hidden) render(); }); } catch (e) {}

  // 供验证脚本/其他模块调用（不进入任何既有功能路径）
  window.mochiFeatureData = {
    features: FEATURES,
    scopeText: scopeText,
    parseKey: parseKey,
    featureOfKey: featureOfKey,
    keysOf: function (fid) { var f = byId(fid); return f ? keysOf(f, curCid()) : Promise.resolve([]); },
    valuesOf: function (fid) { var f = byId(fid); return f ? keysOf(f, curCid()).then(readValues) : Promise.resolve({}); },
    exportFeature: function (fid, cb) { var f = byId(fid); return f ? exportFeature(f, cb) : null; },
    importFile: function (fid, file, cb) { var f = byId(fid); return f ? importFromFile(f, file, cb) : null; },
    clearFeature: function (fid, cb) { var f = byId(fid); return f ? clearFeature(f, cb) : null; },
    describe: function (fid) { var f = byId(fid); return f ? { id: f.id, name: f.name, scope: f.scope } : null; },
    // #679：功能页内数据卡（供验证脚本与后续功能接续）
    fdBarOf: function (fid) { var f = byId(fid); return f && f.page && !f.btns && document.querySelector('[data-fbar="' + f.id + '"]') ? true : false; },
    // 重叠自检：同一键被多个功能匹配＝清空/导出会互相牵连（供 verify 脚本断言为空）
    overlaps: function () { return allKeys().then(function (keys) { var m = {}; keys.forEach(function (k) { var f = featureOfKey(k, curCid()); if (f) m[k] = f.id; }); return m; }); },
    // #1325 「这一格到底被谁管着」的体检口（供 verify 脚本断言，不接任何界面路径）。音乐那一发
    // 既不是「正则写错」也不是「数据库没读到」，而是键落在的命名空间被 scope 判成不归它管：
    // 屏上照常显示、导出/清空这扇门里彻底隐形。两类都要抓：
    //   nobody   ＝把任何桌面视角都摆上也没人能认领（音乐同款＝永久隐形，多半是没登记的键家族或 anchor 漏标）
    //   stranded ＝换一个桌面视角就能被认领（scope 与模块真实命名空间脱节的指纹：desk 却写着根键）
    audit: function () {
      return allKeys().then(function (keys) {
        var cids = ['default', 'czzzzz'];
        var nobody = [], fromDefault = [], cur = curCid();
        keys.forEach(function (k) {
          var info = parseKey(k); if (!info) return;
          if (info.suffix.indexOf(MEDIA_PREFIX) === 0 || info.suffix.indexOf(BLOB_PREFIX) === 0) return; // 共享池按设计不登记
          if (INTERNAL_RE.test(info.suffix)) return; // 写日志/索引标记不参与体检（机器记的账，不是数据）
          var mine = featureOfKey(k, cur);
          if (mine) return;
          var any = null;
          for (var i = 0; i < cids.length; i++) { var o = featureOfKey(k, cids[i]); if (o) { any = o.id; break; } }
          if (any) fromDefault.push(k + '←' + any); else nobody.push(k);
        });
        return { total: keys.length, nobody: nobody, stranded: fromDefault, cid: cur, incomplete: keys.incomplete };
      });
    },
    planKeys: planKeys, sizeOfKey: sizeOfKey, sharedNsOf: sharedNsOf
  };
})();
