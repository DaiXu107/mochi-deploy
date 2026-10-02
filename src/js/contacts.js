// ===== 功能：多联系人 / 多桌面（数据隔离 + 共享朋友圈） =====
// 设计：每个联系人 = 独立命名空间 xy-home-v2:<cid>:*，数据互不互通；
// 仅朋友圈（feed-posts）为全局共享层，按 owner(cid)+role 聚合所有联系人动态。
// 归属：系统/全局（AI-B 域），须最先于功能模块加载（build.mjs 中放在 idb.js 之后）。
(function () {
  const G = 'xy-home-v2';
  const EXCLUDE = ['contacts', 'active-contact', 'feed-posts', 'migrated-v1', 'js-errors', 'theme-mode', 'accent-color',
    // v3.16.x：摸鱼天数 fish-log 是全局根键（v3.9.x 起跨所有联系人按自然日去重累计，
    // personalize.js logFish 走 gStore / migrateFishLogGlobal 从各联系人合并进全局）。
    // 此前漏排除，migrateLegacy 每次刷新把全局 fish-log 迁进 default 并删全局键——
    // 幂等检查命中 default 已有旧值时不迁移直接删全局新值 → 天数永久回退到 default
    // 旧值（用户反馈：玩 4 天桌面「已摸鱼」显示第 2 天）。fish-log-global-migrated 为
    // 合并幂等标记键，同为全局根键。二者都不随联系人隔离，绝不能迁移。
    'fish-log', 'fish-log-global-migrated',
    // #1541：开屏/系统标记键出生即根域全局键，读取方都只认根键——此前漏排除，每次刷新
    // 被 migrateLegacy 当旧顶层业务键迁进 default 并删根键：① age-confirmed（#1475 版本化
    // 年龄确认）每次开屏都要重新勾；② storage-guide-shown（#1250 存储修复引导已送达标记，
    // LS 快路径每启必 miss，全靠 markShown 写的 IDB 那份兜底才没反复重弹）；③ splash-seen:*
    // （每日首开强读标记，见 isExcluded 前缀挡）天天失效。
    'age-confirmed', 'storage-guide-shown',
    // v3.17.x：跨桌面「来消息」全局根键——incoming-requests（申请队列）、
    // desk-checkin-en（桌面查岗全局开关）与 desk-call-en（跨桌面来电全局开关）都存
    // 根命名空间、全桌面通，绝不随联系人隔离，防 migrateLegacy 每次刷新搬进 default
    // 桌面（同 bg-*/feed-* 既有处理）。
    // v3.27.x：desk-freq-mode（跨桌面查岗/来电频率档位）同为全局根键——此前漏排除，
    // 被 migrateLegacy 当旧顶层业务键迁进 default 并删根键，用户选的「标准」静默回退
    // 「安静」（1%/3h），跨桌面查岗/来电几乎不触发。
    // #160：call-hold（后台来电响铃挂起，call.js 写根命名空间、值含归属 cid）——
    // 同 bg-* 道理是全局根键，绝不随联系人隔离，防 migrateLegacy 搬进 default 并删根键
    // （挂起键丢了=用户回来接不到重响的来电）。
    'incoming-requests', 'desk-checkin-en', 'desk-call-en', 'desk-freq-mode', 'call-hold',
    // v3.27.x：night-mode-en（夜间免打扰模式总开关）同为全局根键，全桌面通、不随联系人隔离。
    // 漏排除会被 migrateLegacy 每次刷新搬进 default 并删根键 → 开关自己关掉、夜间静默失效。
    'night-mode-en',
    // v3.12.x：group-chat-msgs（群聊消息，v3.8 起全局存储于根命名空间）——同 bg-* 道理，
    // 不是旧顶层业务键。此前漏排除导致每次刷新 migrateLegacy 把群聊记录搬进 default:
    // 并删根键，群聊页读根键为空 → 历史看似清空（数据滞留 default: 副本）+ 迁移循环空转。
    'group-chat-msgs',
    // v3.9.x：全局系统键——后台保活/通知（bg-*）、群聊回复设置（reply-gc-*）、
    // 备份/引导内部标记（__*）。这些键本就存 xy-home-v2 根命名空间（bg-keep.js
    // gSet 用 xyStore(GNS)、reply-settings.js gcWrite 用 xyStore('xy-home-v2')），
    // 不是旧顶层业务键，绝不能迁移进 default 桌面。此前漏排除导致每次刷新
    // migrateLegacy 把 bg-keepalive/bg-notify 迁进 default 并删全局键，非 default
    // 桌面刷新后开关读不到全局值自动变关（用户反馈「后台保活/后台弹窗自己关了」）。
    'bg-keepalive', 'bg-notify', 'bg-notify-nodedup',
    // v3.15.x：心意币全局一本账（根键 gift-wallet）与其一次性迁移标记——
    // 红包/市集/游戏/花园共用，跨桌面不隔离；漏排除会被 migrateLegacy 搬进 default 并删根键
    'gift-wallet', 'wallet-global-migrated',
    // v3.9.x：群聊全局设置——回复设置（reply-gc-*）与成员群聊形象（gc-profiles）、
    // 群聊美化（gc-beauty）、开启开关（group-chat-enabled）都是群聊（全局功能）的
    // 根命名空间键，绝不能迁移进 default 桌面（否则切换桌面后设置读不到全局值、仿佛"丢失"）
    'gc-profiles', 'gc-beauty', 'group-chat-enabled',
    '__last-backup', '__last-backup-remind', '__onboard-done', '__guide-done', '__edge-backup-hint-done', '__auto-backup-snapshot',
    // #260：__ka-hb（后台保活心跳取证键，bg-keep.js 隐藏期每 30s 写 IDB 根键）——
    // 全局取证键（跨桌面语义相同），绝不随联系人隔离迁移
    '__ka-hb',
    // v3.10.x：经期记录改全局共享（本人生理数据，所有联系人桌面共用一份），
    // 键 xy-home-v2:period-* 走根命名空间，绝不能被 migrateLegacy 迁进 default 桌面
    // （否则非 default 桌面读全局键读不到，经期记录"消失"）。period-migrated 为迁移幂等标记。
    'period-records', 'period-cfg', 'period-daily', 'period-notify', 'period-migrated',
    // v3.11.x：字卡库公用字卡改全局共享——xy-home-v2:cc-groups-public 存所有桌面联系人
    // 共用的自定义字卡（chatcard.js），cc-scope-migrated 为存量归属迁移幂等标记。
    // v3.30.x：cc-groups-public-off 为公用字卡「分组停用开关」全局根键，同列排除。
    // 都是根命名空间键，绝不能被 migrateLegacy 迁进 default 桌面（否则公用字卡"消失"）
    // #680：cc-media-names-public 为公用字卡「图片/表情包名称」全局根键（chatcard.js），
    // 同列排除——否则被迁进 default 后其他桌面的图片名称全部读不到。
    'cc-groups-public', 'cc-groups-public-off', 'cc-scope-migrated', 'cc-media-names-public',
    // v3.11.x：字卡库公用/专属变动一次性提醒的已读标记（chatcard.js 弹窗），同为全局根键
    'cc-scope-notice-done',
    // v3.12.x：我的表情包改全局共享（chat.js）——键 xy-home-v2:my-emoji-groups 走根命名
    // 空间，所有联系人桌面共用一份；mye-global-migrated 为存量桌面数据合并迁移的幂等标记。
    // 都是全局根键，绝不能被 migrateLegacy 当旧顶层业务键迁进 default 桌面
    // （否则全局键被搬走/删除：表情包"消失"+ 迁移标记丢失每次重跑）
    'my-emoji-groups', 'mye-global-migrated',
    // #558（2026-09-16，AI-A chat.js 会话跨域登记 WORKLOG）：表情面板「最近使用」（chat.js
    // emojiRecordRecent/emojiRecentResolved）——存最近点用表情的令牌稳定身份串（≤8 条、每条
    // <100 字符的小 JSON），全局根键跨桌面共享（同 my-emoji-groups 口径）。漏排除会被
    // migrateLegacy 当旧顶层业务键迁进 default 并删根键（最近区非 default 桌面清空）。
    'emoji-recent',
    // #842（2026-09-19）：颜文字/emoji 两个文字分类各自的「最近使用」（chat.js
    // emojiRecordRecentText/textRecentResolved）——同为全局根键（面板跨桌面共用一份），
    // 漏排除会被迁进 default 并删根键＝非 default 桌面这两类的最近区清空。
    'emoji-recent-kaomoji', 'emoji-recent-emoji',
    // #572（2026-09-16，AI-A page-coach.js 会话跨域登记 WORKLOG）：页面内「先做这个」提示的
    // 已看页标记（__coach-seen 存已提示过的页 id 数组）——全局根键，漏排除会被 migrateLegacy
    // 当旧顶层业务键迁进 default 并删根键，提示在非 default 桌面反复弹。
    '__coach-seen',
    // #424（2026-09-13）：媒体池自动体检节流状态（media-pool.js mochiMediaAutoCheck）——
    // {t,missing,snooze} 全局根键，丢/被迁走只会导致弹窗节奏错乱，但不排除会被 migrateLegacy
    // 当旧顶层业务键迁进 default 并删根键，照例登记。
    'media-auto-check',
    // v3.11.x：存钱罐改全局共享（两人共同金库，p2-features.js）——键 xy-home-v2:piggy-* 与
    // v3.26.x 心意币存钱独立账本 piggy-coin-* 都走根命名空间，绝不能被 migrateLegacy 迁进
    // default 桌面（否则非 default 桌面余额读空）
    'piggy-log', 'piggy-goal-name', 'piggy-goal-amt', 'piggy-cards', 'piggy-last-visit',
    'piggy-goals', 'piggy-goal-cur', 'piggy-coin-log', 'piggy-coin-goals', 'piggy-coin-goal-cur', 'piggy-coin-last-visit',
    // v3.26.x：存钱罐概率设置（存/取/申请）是全局根键（p2-features.js 读写、chat.js 申请读取），
    // 绝不能随联系人隔离，否则非 default 桌面读到空回退默认值
    'piggy-coin-prob',
    // v3.10.x：心意市集自定义商品改全局共享（所有桌面互通一份商品库，gift-shop.js）——
    // 键 xy-home-v2:market-custom 走根命名空间，绝不能被 migrateLegacy 迁进 default 桌面
    // （否则非 default 桌面读不到全局商品库，自定义商品"消失"）。market-migrated 为迁移幂等标记
    'market-custom', 'market-migrated',
    // v3.10.x：扩库救援标记（gift-shop.js rescueNewDefaults，v2 新默认商品误删恢复），同为全局根键
    // v3.13.x：扩库救援标记 v3（gift-shop.js rescueBatch，「两个世界」+「饮品」新分类与日常扩容 222 件），同上
    'market-migrated-v2', 'market-migrated-v3',
    // v3.13.x：此间（梦角世界时间与在场感知，cjian.js）——梦角名单/状态/初始化标记
    // 走根命名空间全局共享，不随联系人隔离，绝不能被 migrateLegacy 迁进 default 桌面
    // （否则切换桌面后梦角名单/状态"消失"）
    // v3.14.x：cjian-rehome-v1 为错放梦角一次性存量纠偏标记（cjian.js rehomeMisfiled），
    // 同为根键——被迁进 default 会导致纠偏每次启动重跑，把用户后来手动放在别桌面的
    // 同名梦角也搬走
    'cjian-roster', 'cjian-state', 'cjian-seeded', 'cjian-rehome-v1',
    // #409（跨域改动，AI-A cjian.js 会话登记 WORKLOG）：cjian-belong-v2 为按名认亲一次性
    // 救回标记（cjian.js fixBelonging）——全局根键，漏排除会被 migrateLegacy 搬进 default
    // 并删根键，标记丢失=救回逻辑每刷重跑、cid 权威失效（串桌修复回退复发）。
    'cjian-belong-v2',
    // v3.13.x：朋友圈根命名空间键（feed.js 全部走 xy-home-v2 根 store，是现行设计不是
    // 旧顶层业务键）——此前漏排除，每次启动 migrateLegacy 把它们当旧键迁进 default:
    // 并删根键（default 已有陈旧副本时连迁移都不做直接删）→ 朋友圈通知列表/未读角标/
    // 双方朋友圈昵称头像/封面/TA发帖调度每次刷新全丢（用户反馈：联系人回复我朋友圈
    // 评论没有提示——提示数据刷新即被清）。feed-posts 本就在排除清单。
    'feed-notices', 'feed-app-unread', 'feed-cover-bg', 'feed-ta-cover',
    'feed-ta-name', 'feed-ta-avatar', 'feed-user-name', 'feed-user-avatar',
    'feed-last', 'feed-next', 'feed-day-count',
    // v3.15.x：离线消息提醒（Periodic Background Sync，bg-keep.js psync 段）——
    // 快照/队列走 IDB+LS 根键、开关是全局根键，均不随联系人隔离，防 migrateLegacy 迁走
    'psync-snap', 'psync-queue', 'psync-en',
    // v3.14.x：帮我决定/多人决定改全局共享（decision.js / group-decision.js）——
    // 历史/成员/设置走根命名空间 xy-home-v2:decision-* 与 gdec-*，所有桌面互通一份，
    // 绝不能被 migrateLegacy 当旧顶层业务键迁进 default 桌面（否则其他桌面读不到=「消失」）。
    // dec-global-migrated / gdec-global-migrated 为存量各桌面数据合并进根键的一次性幂等标记。
    'decision-history', 'decision-settings', 'dec-global-migrated',
    'gdec-members', 'gdec-history', 'gdec-settings', 'gdec-global-migrated',
    // v3.26.x：番茄钟数据全局共享（p2-features.js pomoStore 走根命名空间）——
    // 键 xy-home-v2:pomo-*（时长/今日·累计/夸夸字卡/发到聊天/铃声/陪伴会话/陪伴聊天记录/
    // 陪伴用字卡开关）绝不随联系人隔离。此前漏排除，migrateLegacy 每次刷新把它们当旧
    // 顶层业务键迁进 default 桌面并删 LS 根键 → 自定义时长/今日·累计刷新后回默认值。
    'pomo-cfg', 'pomo-today', 'pomo-total', 'pomo-msgs', 'pomo-send-chat', 'pomo-bell',
    'pomo-companion', 'pomo-companion-log', 'pomo-cmp-usecards',
    // v3.26.x：备忘录数据全局共享（memo-app.js 存根命名空间，所有桌面互通一份）——
    // memo-app-items/memo-app-send/memo-app-global-migrated 绝不随联系人隔离；
    // memo-app.js 已内置误迁自愈，这里补排除让 migrateLegacy 彻底不再动它们。
    // #238 增 memo-app-remind（备忘提醒配置单键 JSON：开关/概率/当天已提醒标记）。
    'memo-app-items', 'memo-app-send', 'memo-app-global-migrated', 'memo-app-remind',
    // v3.26.x：桌面美化方案（personalize.js beauty-schemes）、聊天美化方案（chat-settings.js
    // chat-beauty-schemes）、隐藏TA表情包开关（chat-settings.js hide-ta-sticker，聊天/朋友圈
    // 共用）都是全局根键。此前漏排除，被 migrateLegacy 迁进 default 桌面并删 LS 根键 →
    // IDB 不可用场景下方案列表/开关刷新后消失。
    'beauty-schemes', 'chat-beauty-schemes', 'hide-ta-sticker',
    // v3.26.x #636：表情包面板「隐藏颜文字 / 隐藏emoji」开关（chat-settings.js 注入行，聊天/群聊/
    // 写信共用同一面板）同为全局根键——出生即进 EXCLUDE，不会产生需要回收的 default 副本。
    'hide-tab-kaomoji', 'hide-tab-emoji',
    // v3.26.x #691：表情包面板「颜文字/emoji 点击直接发送」模式开关（chat-settings.js 注入行，
    // 聊天/群聊共用同一面板）同为全局根键——出生即进 EXCLUDE，不被 migrateLegacy 迁进 default 桌面。
    'chat-textcard-direct',
    // v3.26.x #907：表情包面板/头像互动「打开面板前提前加载图片」开关（chat-settings.js 注入行，
    // chat.js 空闲预热调度读）同为全局根键——出生即进 EXCLUDE，不被 migrateLegacy 迁进 default 桌面。
    'chat-panel-prewarm',
    // #231：完整外观方案（personalize.js full-beauty-schemes，v3.27.x 桌面+聊天合并方案的
    // 方案列表）、美化撤销栈（personalize.js beauty-undo-stack）、更新条一版一弹记忆
    // （pwa.js ver-update-ack-ts / ver-update-notify，#225v2）都是全局根键——此前漏排除，
    // 每次刷新被 migrateLegacy 当旧顶层业务键迁进 default 并删根键 → 保存的完整方案/
    // 撤销栈刷新后清空（红米 Note12 Turbo Chrome 报「自用完整外观方案保存后刷新恢复
    // 初始」，多机型同发）、同版本更新条每刷新重弹。存量滞留副本见 migrateLegacy 回收。
    'full-beauty-schemes', 'beauty-undo-stack', 'ver-update-ack-ts', 'ver-update-notify',
    // FIX 2026-09-15 #527 说明（上面这一行保持原样，勿动）：beauty-undo-stack 虽继续留在
    // EXCLUDE，但它的【写入端】已改为 per-cid（personalize.js getUndoStack/setUndoStack），
    // 因为撤销的语义是「回退我在本桌面刚做的操作」——存全局会让在 A 桌面调完美化、切到 B
    // 桌面点撤销时把 A 的美化写到 B 上。留在 EXCLUDE 的理由：per-cid 键形如
    // xy-home-v2:<cid>:beauty-undo-stack 本就由「命名空间键不迁移」规则挡住；根键
    // xy-home-v2:beauty-undo-stack 作为历史副本保留可当读取兜底（per-cid 为空时回退读它），
    // 且留在 EXCLUDE 才能避免「idbRestore 每次回填根键 → migrateLegacy 反复迁移」的循环。
    // 真正必须同步改的是下方 #231 回收块——它把 default 副本写回根键并删副本，会把新的
    // 按桌面隔离存储每次启动搬空（=本修复被反向回滚），故该键已自回收列表移除。
    // v3.26.x #121：通话进行中标记（call.js）——全局根键，call.js 每次启动 recoverCall
    // 读它恢复中断通话。绝不能被 migrateLegacy 当旧顶层业务键迁进 default 桌面并删根键
    // （否则 localStorage 兜底副本每次启动被搬走，关浏览器重开后恢复读不到标记）
    'call-active',
    // 应用锁（applock.js 隐私防护）：开关/密码摘要/安全问题问答均为全局根键。
    // 绝不随联系人隔离，防 migrateLegacy 当旧顶层业务键迁进 default 并删根键（锁失效=门户大开）
    'applock-en', 'applock-pin', 'applock-qa',
    // v3.31.x 开屏问答门：开关/题目列表/本机跳过标记（暗号本机永久跳过问答层）——
    // 与应用锁同属入口验证，必须全局根键防 migrateLegacy 迁移删键
    'applock-qa-en', 'applock-qalist', 'applock-qaskip',
    // #319 防未成年人锁解锁状态（card-lock.js）：全局根键（不随联系人隔离），闸门
    // isOpen 只读根键——此前漏排除，解锁后刷新被 migrateLegacy 当旧顶层业务键迁进
    // default 并删根键 → 永远读不到 'open'，闸门全锁（用户：输对密码刷新后毫无变化）
    'cardlock-state',
    // v3.26.x #628：全局字体仍按桌面各存各的（cs-font，per-cid —— 每个联系人可各自排版），
    // 跨桌面由面板里的「同步到全部桌面」按钮显式推过去。这里排除的是【根键同名的中间版残留】：
    // 本号初版曾把字体改成根键 xy-home-v2:cs-font（所有桌面共用一个值），那版用户升级到现版后，
    // chat-settings.js 的 demoteFontGlobal() 会把根键值回填给各桌面再删根键；在它删掉之前，
    // 若漏排除，migrateLegacy 会把根键当旧顶层业务键迁进 default 并删根键 → 只剩 default 桌面可见。
    'cs-font',
    // v3.26.x #643：音效作用范围开关（sfx.js）——全局根键（共/分是全局偏好，不随联系人隔离）
    'sfx-unified',
    // #646：打开应用的入口行为（打开时先进入此间 / 默认进入的桌面）——全局根键，不随联系人隔离，
    // 漏排除会被 migrateLegacy 当旧顶层业务键迁进 default 并删根键（非 default 桌面读不到＝开关自己关）
    'entry-cjian-first', 'entry-default-contact', 'entry-show-list',
    // FIX 2026-09-16 #629 开屏「刷了还是旧版」指引：ver-check.js 的「本机已尝试过更新但没
    // 换上」标记（记 线上ts|次数|时刻）是全局根键——不随联系人隔离，且必须跨会话留存才认得出
    // 「这台设备更新失败过」（与 pwa.js 的 ver-update-ack-ts / ver-update-notify 同族，见上方
    // #231）。漏排除＝migrateLegacy 每次刷新把它当旧顶层业务键迁进 default 并删根键，标记写一次
    // 就没了 → 开屏永远只出「点此更新」、等 3~5 分钟/换流量的指引不再出现（实测：写入后 navigate
    // 2.2s 读回即 null）。
    // #935（2026-09-20）：电量/发烫自测的记录（energy-check.js）——battery-check-run 为
    // 进行中的分段计时（刷新/杀进程重开要续测），battery-check-last / heat-check-last 为
    // 「上次结果」回显与跑完时的挂起报告。都是全局根键、不随联系人隔离，漏排除会被
    // migrateLegacy 每次刷新迁进 default 并删根键（长窗口自测跑到一半记录就没了）。
    'battery-check-run', 'battery-check-last', 'heat-check-last',
    // #946：闪屏自测（flash-check.js）只存「最后一次报告」一份，同是全局根键、不随联系人隔离；
    // 漏排除＝每次刷新被 migrateLegacy 迁进 default 并删根键（报障时回看的那份报告没了）。
    'flash-check-last',
    'ver-retry',
    // #937：功能大全统计键——fhub-freq（常用直达点击计数）与 fhub-seen（条目到达标记）都是
    // 全局根键（feature-hub.js 用 xyStore(G) 语义直写根命名空间，目录与跳转目标全桌面共用）。
    // fhub-freq 系补登：此前一直不在 EXCLUDE，每次刷新被 migrateLegacy 当旧顶层业务键迁进
    // default 并删根键 → 非 default 桌面「常用」行常空（原注释「全局键不区分联系人」与实现不符）。
    'fhub-freq', 'fhub-seen',
    // #1475（2026-09-30）：免责声明同意记录（clock.js 开屏年龄闸门）——裸键 xy-home-v2:age-confirmed
    // 走根命名空间（相对键名无冒号，吃不到「含冒号保守视为命名空间键」那条守卫），出生即不在
    // EXCLUDE ⇒ migrateLegacy 每次数据就绪把它当旧顶层业务键迁进 default 并删根键＝#315c 的
    // 「确认一次永久记住」自上线起就被每次启动吃掉（用户每次开屏都要重新勾选）。#1475 起该键
    // 存「时间戳＋声明版本」JSON（改版自动重确认），是同意举证链的本体，必须留在根命名空间。
    'age-confirmed'];
  function isExcluded(k) {
    const r = k.slice(G.length + 1);
    // #233：__ 前缀＝系统键（idb.js 根命名空间专用：__wr-journal 写日志＝LS 回滚自愈
    // 第一道防线、__ls-dirty LS 脏键索引、__big-idx 大键索引），读取方都只认根键——
    // 此前漏挡，无冒号的系统键每次刷新被当旧顶层业务键迁进 default 并删根键：写日志
    // 每刷新清空、大键/脏键索引反复丢失，LS 回滚家族（#82/#88/#226/#229）自愈被持续削弱。
    if (r.indexOf('__') === 0) return true;
    if (EXCLUDE.indexOf(r) >= 0) return true;
    // #1541：每日首开已读标记 splash-seen:<日期>——键名带日期后缀，EXCLUDE 精确名单盖不住，
    // 按前缀挡迁移（clock.js 每日写当日新键，昨天的自然过期，无需回收）。
    if (r.indexOf('splash-seen:') === 0) return true;
    // v3.9.x：reply-gc-* 群聊全局设置键同样不能迁移（无冒号，原逻辑会误判为旧业务键）
    if (r.indexOf('reply-gc-') === 0) return true;
    if (r.indexOf('music-file:') === 0) return true;
    // #642：字体去重的全局唯一下载键 font-blob-<hash>（chat-settings.js / personalize.js
    // 写入端）走根命名空间——内容哈希后缀可变，EXCLUDE 精确名单盖不住，按前缀挡迁移。
    // 漏挡会被 migrateLegacy 当旧顶层业务键迁进 default 并删根键 → 所有桌面字体丢。
    if (r.indexOf('font-blob-') === 0) return true;
    // 梦角档案：narc-* 走根命名空间（全局共享，memo-arc.js），绝不能当旧顶层业务键迁移
    // （否则切换桌面后档案/当前梦角读全局键读不到，"消失"）。narc-cur 亦不例外。
    if (r.indexOf('narc-') === 0) return true;
    // 我的档案：myarc 根键（全局唯一 JSON，my-arc.js）同理不可迁移
    if (r.indexOf('myarc') === 0) return true;
    // FIX 2026-09-25 #1293：屏幕适配微调七轴（mobile-adapt.js #707/#764/#794）出生即根命名空间
    // ——屏幕是设备属性、跨桌面共用，读取方 loadAdj 只认 xy-home-v2:screen-adj-<axis>。此前整族
    // 既不在 EXCLUDE 也没有前缀守卫 → migrateLegacy 每次启动把根键当旧顶层业务键迁进 default 桌面
    // 并删根键：第一次刷新「刚调的值」照常生效（mobile-adapt 在迁移之前就读完落层），**下一次冷启
    // 归零**（实测探针：T2 desk=12 / padding-top 12px → T3 desk=0 / 0px，default 副本无人读）。
    // 用户所见＝「调了当时有效，回头又偏回去了」，且「屏幕适配诊断→一键修正」写进去的值同样蒸发。
    // 后缀是轴名（top/bottom/h/desk/shift/text/side，将来还会加轴），按前缀挡，同 #642 口径。
    if (r.indexOf('screen-adj-') === 0) return true;
    // v3.6.x：命名空间键（default:* / <cid>:*）不是"旧顶层键"，绝不能迁移——
    // 否则会把 xy-home-v2:default:avatar-user 再迁成 xy-home-v2:default:default:avatar-user
    // 并删除原键（刷新后头像/壁纸/聊天壁纸丢失 + default:default: 双重前缀垃圾键）。
    // 注意：旧业务键本身可能含冒号（dc-off-分类:内容 / quote-off:内容 / day-fish-日期 等），
    // 只能排除「冒号前是联系人 id（default 或 c 开头）且不是已知业务键前缀」的键。
    const m = r.match(/^([^:]+):/);
    if (m) {
      const head = m[1];
      // 联系人命名空间：default 或本应用生成的联系人 id（c + 时间戳36进制）
      if (head === 'default' || /^c[0-9a-z]{5,}$/.test(head)) return true;
      // 已知业务键前缀（含冒号但属旧顶层业务数据，需要迁移）
      const bizPrefix = ['dc-off', 'rc-off', 'mc-off', 'ck-off', 'quote-off', 'day-fish', 'greeted', 'cal'];
      if (bizPrefix.some(p => head.indexOf(p) === 0)) return false;
      // 其他含冒号的未知键保守视为命名空间键（防误迁 default:xxx 类数据）
      return true;
    }
    return false;
  }

  // ---- 当前激活联系人 ----
  let _cid = 'default';
  // v3.26.x #88：改走 xyStore（内存缓存优先）——idb.js 里 #40 的小键写日志在模块初始化
  // 前已同步回放进内存缓存，LS 失效设备靠这条路就能当场拿回上次的桌面；裸 localStorage
  // 读作兜底。仅这一步不够（日志只留最近 40 条），真正的兜底见下方 correctCidFromIdb。
  try {
    const a = window.xyStore ? window.xyStore(G).get('active-contact') : localStorage.getItem(G + ':active-contact');
    if (a) _cid = a;
  } catch (e) {}
  window.__activeCid = _cid;

  // 当前激活命名空间前缀（动态读取，切换后新调用即生效）
  window.activePrefix = function () { return G + ':' + (window.__activeCid || 'default'); };

  // 默认联系人专属存储：优先读 default 命名空间，回退读旧版顶层键（兼容未迁移老数据）
  function defaultStore() {
    const ns = G + ':default';
    return {
      get(k) {
        let v = null;
        try { v = window.xyStore(ns).get(k); } catch (e) {}
        if (v !== null) return v;
        try { v = window.xyStore(G).get(k); } catch (e) {}
        return v;
      },
      set(k, v) {
        window.xyStore(ns).set(k, v);
        // 写入后彻底清掉旧顶层键（含内存缓存）——否则 get 回退路径会读到残留旧值
        try { window.xyStore(G).remove(k); } catch (e) {}
      },
      // FIX 2026-09-28 #1358j：数据层那三句问话（#1342 的 awaitingBigKey／requestBigKey 与
      //   #1358d 的 whenBigKeyBack）必须从这份门面也够得着。各页顶上的 store 都是 defaultStore()/
      //   activeStore()，门面原样只转 get/set/remove ⇒ 「这一格现在读不到、而名册说库里本该有」
      //   这把尺对走门面的消费方结构性失明——信箱就是这一型：尺子写得对，调用方拿到的是 undefined，
      //   于是冷读那一发照旧把「没读到」画成「没有」。判据取「命名空间键与旧顶层键都空」这一个事实，
      //   与上面 get 的回退链同口径，零机型／零 UA 分支。
      awaitingBigKey(k) {
        // FIX 2026-09-30 #1469：这句问话的语义＝「这一格（新命名空间键与旧顶层键两个候选）都读不出值，
        //   而证据说库里本该有一份」。旧写法把两格的 awaitingBigKey 直接相或：在 LS 整域坏掉的机器上
        //   （报障件：整域 192 键≈10.0MB、本项目只剩 1 键、写入被拒 3531 次），根键那一发的
        //   localStorage.getItem 自己就抛，而数据层对「连读都读不出」刻意判成 unconfirmed（#1309 家族定的），
        //   于是命名空间那一格明明读得好好的，门面照样回答「不许整包写回」——信箱的删除/清空在这一型
        //   机器上被永久按住（新尺 C3 实测：八轮重试全是那句提示，库里一封没少也一封没删）。
        //   现在先问「两个候选里有没有任何一个读得出值」：读得出＝这一格有答案，不再谈「没读到」。
        //   零机型／零 UA 分支，判据仍是当场事实。
        try { if (window.xyStore(ns).get(k) !== null) return false; } catch (e3) {}
        try { if (window.xyStore(G).get(k) !== null) return false; } catch (e4) {}
        // 两格候选都读不出值时，只认「命名空间那一格」的库里证据（信箱／字卡库这些账就住在那儿）。
        //   旧顶层键那一格不参与举证：LS 整域坏掉的机器上它对任何键都自证「连读都读不出」（数据层对
        //   #1309 那一族刻意定的判法），拿它当证据＝每一格都被说成「不许整包写回」，用户亲手清空被
        //   永久挡死（违 #1309 C2「主动清空必须真落空」契约，新尺丁4/丁5 当场逮到）。
        try { return window.xyStore(ns).awaitingBigKey(k); } catch (e) { return false; }
      },
      requestBigKey(k) {
        try { window.xyStore(ns).requestBigKey(k); } catch (e) {}
        try { window.xyStore(G).requestBigKey(k); } catch (e2) {}
      },
      whenBigKeyBack(k, cb) {
        try {
          const s = window.xyStore(ns);
          if (s && s.whenBigKeyBack) { s.whenBigKeyBack(k, cb); return; }
        } catch (e) {}
        try { const r = window.xyStore(G); if (r && r.whenBigKeyBack) { r.whenBigKeyBack(k, cb); return; } } catch (e2) {}
        try { if (cb) cb(); } catch (e3) {}
      },
      remove(k) {
        window.xyStore(ns).remove(k);
        // 旧顶层键同样彻底清（memoryCache + LS + IDB 三处）——
        // 只删 LS/IDB 会漏 memoryCache，get 回退读到残留旧值（如「恢复默认」后颜色又回来）
        try { window.xyStore(G).remove(k); } catch (e) {}
      }
    };
  }

  // 激活联系人的存储（各功能模块使用）
  // v3.6.x 多桌面：default 联系人始终走 defaultStore()（带旧顶层键回退），
  // 绝不能因为 migrated-v1 标记就直接读空命名空间——idbRestore 是异步的，
  // 若数据主要在 IndexedDB，migrateLegacy 同步跑时 localStorage 还是空的，
  // 标记后 activeStore 会读到空的 default 命名空间而丢数据。回退读旧键可兜住该场景。
  // 关键：返回的 store 必须【动态绑定当前联系人】——各模块在顶部 const store = activeStore()
  // 一次性缓存，若在创建时把 cid 闭包固定，切换联系人后所有模块仍读写旧桌面，隔离失效。
  window.activeStore = function () {
    const dyn = function () {
      const cid = window.__activeCid || 'default';
      return cid === 'default' ? defaultStore() : window.xyStore(G + ':' + cid);
    };
    return {
      get: (k) => dyn().get(k),
      set: (k, v) => dyn().set(k, v),
      remove: (k) => dyn().remove(k),
      // FIX 2026-09-28 #1358j：那三句问话一并从门面转出（dyn() 动态绑定当前桌面，与 get/set 同规格）——
      //   缺了它们，各页顶上的 store 就够不到数据层那把「这一格读空而库里本该有」的尺。
      //   够不到的那一页不许被当成「库里没有」：回调照叫一次，让调用方按自己那条链正常画。
      awaitingBigKey: (k) => { const d = dyn(); return !!(d.awaitingBigKey && d.awaitingBigKey(k)); },
      requestBigKey: (k) => { const d = dyn(); try { if (d.requestBigKey) d.requestBigKey(k); } catch (e) {} },
      whenBigKeyBack: (k, cb) => {
        const d = dyn();
        if (d.whenBigKeyBack) { d.whenBigKeyBack(k, cb); return; }
        try { if (cb) cb(); } catch (e2) {}
      }
    };
  };

  // 任意联系人的存储（供朋友圈后台遍历各联系人生成 TA 动态/评论）
  window.storeFor = function (cid) { return window.xyStore(G + ':' + cid); };
  // FIX 2026-09-29 #1416：按 cid 取存储必须和 activeStore 用同一口径分叉——default 桌面要走
  //   defaultStore()（先读新命名空间、没有再回退旧顶层键），而上面那个 storeFor('default') 只读新命名空间。
  //   漏这一层已经咬到 #1394 那一族的另一半：通话归属 default、而用户当前正看着别的联系人桌面时，
  //   replyCfgFor('default') 用 storeFor 读不到未迁移的老「禁止对方挂断」/自定义挂断概率＝判成没设过、
  //   回落默认 2% ⇒ 对方照样把电话挂了，而设置页明明显示着用户当初设的值（静默失效，与 #1056 同形）。
  window.storeForCid = function (cid) { return cid === 'default' ? defaultStore() : window.xyStore(G + ':' + cid); };

  // ---- 联系人性别 / TA 称呼跟随 ----
  // 存储键：<cid>:partner-gender = 'he' | 'she' | ''（未设置 → 默认「TA」），随联系人命名空间隔离。
  // 各模块在【显示层】调 window.taFit(text[, cid]) 把指代联系人的「他/TA/ta」替换为「他/她/TA/ta」；
  // 只改显示不改存储原文，历史消息重新渲染即自动跟随。
  window.partnerGenderFor = function (cid) {
    try { return window.xyStore(G + ':' + (cid || 'default')).get('partner-gender') || ''; } catch (e) { return ''; }
  };
  window.taWordFor = function (cid) {
    const g = window.partnerGenderFor(cid);
    if (g === 'he') return '他';
    if (g === 'she') return '她';
    return 'TA';
  };
  window.taWord = function () { return window.taWordFor(window.__activeCid || 'default'); };
  // v3.26.x：联系人名片名查询（按 cid 读注册表，供通话等模块回退显示）——
  // 聊天顶栏昵称回退链是 cs-lbl-partner → 联系人名片名 → TA（chat.js updateChatPartnerName），
  // 通话大面板/小框此前只回退 TA/他/她，用户只改了联系人名片（联系人管理改名）时
  // 顶栏有名字、通话小框却显示 TA/他/她，观感像「改名没生效」。补齐同一回退链。
  window.contactNameFor = function (cid) {
    try {
      const c = getContacts().find(x => x.id === (cid || 'default'));
      return (c && c.name) || '';
    } catch (e) { return ''; }
  };
  // 人称替换：TA/他/ta → 性别称呼。保护「其他」（非人称）、base64 段（dataURL 不能动，
  // 大写 TA 可能出现在 base64 字符里）与 <svg>…</svg> 图标段（系统消息带图标前缀）；
  // 不用正则 lookbehind（旧版 iOS Safari 不支持）。
  window.taFit = function (text, cid) {
    if (text === null || text === undefined) return text;
    const s = String(text);
    if (s.indexOf('他') < 0 && s.indexOf('TA') < 0 && s.indexOf('ta') < 0) return s;
    const w = window.taWordFor(cid || window.__activeCid || 'default');
    // 字卡库系统预设字卡用「ta」作中性占位：未设置称呼时保留「ta」，
    // 已设置（他/她）才把独立 token 的「ta」替换成对应性别词（\b 词边界
    // 防误伤 table/data 等英文词内的 ta；\b 不受旧版 iOS 限制）。
    const taw = w === 'TA' ? 'ta' : w;
    const segs = s.split(/(<svg[\s\S]*?<\/svg>)/);
    for (let i = 0; i < segs.length; i += 2) {
      const parts = segs[i].split(/(data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)/);
      for (let j = 0; j < parts.length; j += 2) {
        let p = parts[j].split('其他').join('\u0001').split('TA').join(w).split('他').join(w);
        if (taw !== 'ta') p = p.replace(/\bta\b/g, taw);
        parts[j] = p.split('\u0001').join('其他');
      }
      segs[i] = parts.join('');
    }
    return segs.join('');
  };

  // ---- 联系人注册表（全局，不随某个联系人隔离） ----
  function regStore() { return window.xyStore(G); }
  function getContacts() {
    try {
      const v = regStore().get('contacts');
      if (v) { const a = JSON.parse(v); if (Array.isArray(a) && a.length) return a; }
    } catch (e) {}
    return [{ id: 'default', name: '默认' }];
  }
  window.getContacts = getContacts;
  window.getActiveContact = function () { return window.__activeCid || 'default'; };

  window.createContact = function (name) {
    const list = getContacts();
    const id = 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    const nm = name || ('联系人' + (list.length));
    list.push({ id: id, name: nm });
    regStore().set('contacts', JSON.stringify(list));
    // #1541c：新建即写该桌面 lbl-partner＝联系人名——桌面「TA/我」圆签（personalize
    // paintDeskNames 读它）切过去当场显示名字，与 renameContact 改名同步 lbl-partner
    // 的既有行为对齐；不写则新桌面回退 taWord() 恒显「TA」，与默认桌面视觉无差＝
    // 「切了等于没切」（用户口径「添加联系人桌面无反应」的观感之一）。
    try { window.xyStore(G + ':' + id).set('lbl-partner', nm); } catch (e) {}
    return id;
  };
  window.renameContact = function (id, name) {
    const list = getContacts(); const c = list.find(x => x.id === id);
    if (c) {
      const oldName = c.name;
      c.name = name || c.name;
      regStore().set('contacts', JSON.stringify(list));
      // v3.7.x：同步更新该联系人的 TA 昵称（lbl-partner）——聊天顶部栏/信件/朋友圈/
      //   通话/日历等都读 lbl-partner，联系人管理改名后应同步生效到这些地方。仅在
      //   该联系人 lbl-partner 为空或等于旧 contacts.name 时同步，避免覆盖用户在
      //   设置页单独设过的 TA 昵称。default 联系人走 xyStore(default 命名空间)。
      try {
        const s = window.xyStore(G + ':' + id);
        const cur = s.get('lbl-partner');
        // v3.25.x：有效昵称（cs-lbl-partner 优先）变化时接入系统消息昵称跟随——当前桌面
        //   立即清扫+重渲染（chat.js chatSysNickChanged）；非当前桌面只记 hist，等该桌面
        //   下次 loadMsgs 惰性补扫。
        const csLbl = s.get('cs-lbl-partner');
        // FIX 2026-09-18 #775f：有效名基线改按聊天里的实际显示链取——
        // cs-lbl-partner → 联系人名片名 → 称呼词（chat.js chatPartnerName），不再掺桌面键
        // lbl-partner：聊天里从来不看那个键（v3.26.x 解耦），掺进来会两头错位——用户只改
        // 名片名时聊天显示名跟着变，这里却按桌面旧名判定「没变」，既不记 hist 也不清扫，
        // 历史拍一拍里的旧名片名永远留在屏幕上。
        const taWordId = window.taWordFor ? window.taWordFor(id) : 'TA';
        const oldEff = csLbl || oldName || taWordId;
        if (!cur || cur === oldName) s.set('lbl-partner', c.name);
        const newEff = csLbl || c.name || taWordId;
        if (newEff !== oldEff) {
          if (id === (window.__activeCid || 'default') && window.chatSysNickChanged) {
            try { window.chatSysNickChanged(oldEff); } catch (e) {}
          } else {
            let h = [];
            try { const v = JSON.parse(s.get('sysmsg-nick-hist') || '[]'); if (Array.isArray(v)) h = v; } catch (e) {}
            if (h.indexOf(oldEff) < 0) { h.push(oldEff); s.set('sysmsg-nick-hist', JSON.stringify(h)); }
          }
        }
      } catch (e) {}
      // 广播联系人重命名事件，通知通话模块等实时同步昵称
      try { document.dispatchEvent(new CustomEvent('contact-renamed', { detail: { id, name: c.name, oldName } })); } catch (e) {}
    }
  };
  window.deleteContact = function (id) {
    if (id === 'default') return false;
    const list = getContacts().filter(x => x.id !== id);
    regStore().set('contacts', JSON.stringify(list));
    const prefix = G + ':' + id + ':';
    // v3.6.x：删除走 xyStore(prefix).remove——三处（memoryCache + LS + IDB）彻底清，
    // 裸 localStorage.removeItem/idbDelete 会漏内存缓存，删除后残留脏数据
    const del = function (k) { try { window.xyStore(prefix).remove(k.slice(prefix.length)); } catch (e) {} };
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(prefix) === 0) del(k);
    }
    if (window.idbGetAllKeys) {
      window.idbGetAllKeys().then(keys => {
        (keys || []).forEach(k => { if (typeof k === 'string' && k.indexOf(prefix) === 0) del(k); });
      }).catch(() => {});
    }
    if (window.__activeCid === id) window.setActiveContact('default');
    return true;
  };

  // v3.26.x #88：启动校正与用户手动切换的互斥状态（必须在 setActiveContact 之前声明）
  let autoFixingCid = false;   // true=正在执行自动校正，不算用户手动切换
  let cidUserSwitched = false; // 本会话用户手动切过桌面 → 校正不再干预
  // 切换联系人：更新状态 + 刷新 UI + 回桌面 + 广播事件
  window.setActiveContact = function (id) {
    if (id === (window.__activeCid || 'default')) return;
    if (!autoFixingCid) cidUserSwitched = true;
    // v3.6.x：切换前把当前桌面的未保存聊天立即写盘（防抖定时器可能尚未触发，
    // 若等它回写会用旧命名空间把 A 桌面的消息存到 B 桌面）
    try { if (window.chatFlushSave) window.chatFlushSave(); } catch (e) {}
    // v3.29.x：字卡库同款——切桌面先落盘当前桌面未保存的字卡变更。必须在本行
    // __activeCid 变更前调用（ccFlushSave 内 curStore 动态读 activePrefix），否则
    // pending 的 120ms 防抖定时器会在切走后把 A 桌面数据写进 B 桌面键，A 桌面
    // 刚上传的表情包/图片「消失」（华为 P50E Edge 反馈场景之一）
    try { if (window.ccFlushSave) window.ccFlushSave(); } catch (e) {}
    window.__activeCid = id;
    // v3.26.x #88：改走 regStore——裸 localStorage 写会漏内存缓存，LS 失效设备（本机
    // 0 键 + 写入 QuotaExceededError）上还会造成「IDB 有真值、内存/LS 没有」的错位，
    // 让下面的启动校正读到陈旧值。xyStore.set 一次写齐 内存 + LS + IDB + 写日志。
    try { regStore().set('active-contact', id); } catch (e) {
      try { localStorage.setItem(G + ':active-contact', id); } catch (e2) {}
      try { if (window.idbSet) window.idbSet(G + ':active-contact', id); } catch (e3) {}
    }
    if (window.refreshActiveContactUI) window.refreshActiveContactUI();
    try { document.dispatchEvent(new Event('contact-switched')); } catch (e) {}
    try {
      document.querySelectorAll('.page').forEach(p => { if (!p.hidden) p.hidden = true; }); // FIX #338 同值写也发 mutation（Blink 实测同值 3 连写=3 条记录），44 页全扫=唤醒全部页面观察器
      const home = document.getElementById('page-phone'); if (home) home.hidden = false;
    } catch (e) {}
  };
  window.switchContact = window.setActiveContact;

  // ===== v3.26.x 修复 #88：LS 失效设备的「当前桌面」启动校正 =====
  // 症状：小米 14U Edge 反馈「聊天记录几小时就自己消失不显示」。诊断实证该设备
  // localStorage 已彻底不可用（xy-home-v2 键数 0 + 写探针 QuotaExceededError，而 IndexedDB
  // 184MB 完好、storage.persisted=true、配额仅用 855MB/11GB——与 #82 同一台机器同一状态）。
  // 根因：旧实现启动时只在 contacts.js 顶部同步读一次 localStorage 的 active-contact，
  // 拿不到就定死在 default 桌面，而该键的权威值一直好好存在 IndexedDB 里没人回读。
  // 于是每次冷启动都掉回 default 桌面：用户真实记录在 <cid>:chat-msgs（该设备 563KB）里，
  // default:chat-msgs 只剩 6.7KB → 看起来就是「记录消失了」，同桌面的美化/开关（per-cid 键）
  // 也一并显示成 default 的值 →「设置自己变回去了」。
  // 方案：IndexedDB 回填完成后再读一次权威值，与当前生效桌面不一致且目标仍在名册里就切回
  //（复用 setActiveContact，链路含 chatFlushSave/contact-switched/回桌面，与手动切换同语义）。
  // 边界：本会话用户手动切过桌面 → 完全不干预；最多尝试 3 次（回填完成 / 写日志合并 /
  // 16 秒兜底各一次），真正切回后立即停止；回填迟迟不来由定时兜底救；时机不安全
  //（用户已进到聊天/设置等页面）则本次放弃、不记尝试数，留给下次冷启动。
  let cidAutoFixTries = 0;   // 已尝试次数（回填挂起时首次可能读不到值，不能一次定死）
  // setActiveContact 会强制回到手机主页（page-phone）——用户正在聊天/设置里时被打断
  // 比「这次没校正」更糟。所以只在开屏还没消失、或当前就停在主页时才自动切，
  // 其余时机直接放弃（权威值不动，下次冷启动自然会校正，不占用尝试次数）。
  function autoFixMomentSafe() {
    try {
      const sp = document.getElementById('splash');
      if (sp && !sp.classList.contains('hide')) return true;
      const home = document.getElementById('page-phone');
      if (!home || home.hidden) return false;
      const pages = document.querySelectorAll('.page');
      for (let i = 0; i < pages.length; i++) {
        if (pages[i] !== home && !pages[i].hidden) return false;
      }
      return true;
    } catch (e) { return false; }
  }
  function applyCidCorrection(saved) {
    if (!saved || saved === (window.__activeCid || 'default')) return;
    // 目标必须在联系人名册内（回填后名册同样来自 IDB，这时才读得到），否则不切——
    // 防切到已删除/不存在的桌面造成空命名空间
    if (saved !== 'default') {
      let known = false;
      try { known = getContacts().some(c => c && c.id === saved); } catch (e) {}
      if (!known) return;
    }
    cidAutoFixTries = 99; // 已生效 → 本会话不再校正
    autoFixingCid = true;
    try { window.setActiveContact(saved); } catch (e) {}
    autoFixingCid = false;
    try { console.info('[mochi] 启动校正：localStorage 无 active-contact，已按 IndexedDB 权威值切回桌面 ' + saved); } catch (e) {}
  }
  function correctCidFromIdb() {
    if (cidUserSwitched || cidAutoFixTries >= 3) return;
    if (!window.xyStore || !autoFixMomentSafe()) return;
    let saved = null;
    try { saved = window.xyStore(G).get('active-contact'); } catch (e) { return; }
    saved = (saved == null ? '' : String(saved)).trim();
    // v3.26.x #90：xyStore 只覆盖「内存 + LS」，其成立前提是 IDB 回填已把这个键送进
    // 内存缓存。回填迟到（本次报障机型启动耗时 24 秒，idbRestore 有 12 秒慢保险丝）或
    // 被跳过时，原逻辑读空就直接 return——用户看到的仍然是「聊天记录消失」。这里补一次
    // 直读 IndexedDB 权威值：异步回来先重新校验「用户没手动切过」与「时机安全」再应用。
    if (!saved && window.idbGet) {
      try {
        window.idbGet(G + ':active-contact').then(function (v) {
          cidAutoFixTries++;
          const s = (v == null ? '' : String(v)).trim();
          if (!s || cidUserSwitched || cidAutoFixTries > 3) return;
          if (!autoFixMomentSafe()) return;
          applyCidCorrection(s);
        }).catch(function () { cidAutoFixTries++; });
      } catch (e) {}
      return;
    }
    cidAutoFixTries++;
    applyCidCorrection(saved);
  }
  try {
    if (window.__mochiDataReady) setTimeout(correctCidFromIdb, 0);
    else {
      document.addEventListener('mochi-restore-done', function h() {
        document.removeEventListener('mochi-restore-done', h);
        correctCidFromIdb();
      });
    }
    // #40 的小键写日志合并晚于回填，可能比回填更权威（最近一次写入）→ 再校正一次机会
    document.addEventListener('mochi-wrj-heal', function () { correctCidFromIdb(); });
    // 回填整体挂起（IDB 事务挂起设备）时的兜底：那时部分键可能已进内存缓存
    setTimeout(correctCidFromIdb, 16000);
  } catch (e) {}

  // 切换后刷新首页头像/昵称（deco-avatar 在 template.html 中）
  // v3.6.x：头像实际渲染在 .ring 内的 <img> 标签（applyAvatar），仅设 backgroundImage 清不掉——
  // 必须走 window.applyAvatars()（按当前联系人 store 重读 avatar-user/avatar-partner 重渲染）。
  window.refreshActiveContactUI = function () {
    try { if (window.applyAvatars) window.applyAvatars(); } catch (e) {}
    try { if (window.renderChatHeader) window.renderChatHeader(); } catch (e) {}
  };

  // ---- 一次性迁移：把老顶层数据归入 default 联系人（不破坏老数据，先拷后删） ----
  // v3.6.x：迁移条件改为「只要发现旧顶层键就迁移」——原实现首次空加载（如刚清空
  // 存储/新设备）时 old 为空也会设 migrated-v1 标记，之后若旧键再出现（如 idbRestore
  // 异步回填、或测试/外部写入）就永远不迁移，default 桌面数据丢失（storeFor 读空）。
  // 补迁移时不得覆盖已有 contacts 注册表（用户可能已新建联系人）。
  // v3.6.x 修复（刷新丢失头像/壁纸）：① isExcluded 排除命名空间键（防 default:default:*）；
  //   ② 迁移延迟到 mochi-restore-done 后执行（防与 idbRestore 竞态删键）；
  //   ③ 迁移只删 localStorage 旧键、**保留 IndexedDB 旧键**——idbRestore 有 12s 保险丝，
  //   restore-done 只是放行开屏、后台可能仍在回填；若迁移删了 IDB 旧键而新键又不在
  //   restore 列表，大键（头像/壁纸，只存 IDB）刷新后彻底丢失。保留 IDB 旧键后，
  //   restore 每次都能回填它，defaultStore 优先读新键、回退旧键，数据永不丢；
  //   IDB 旧键冗余会在后续写入新键后自然闲置（无副作用）。
  //   **例外**：chat-msgs 旧键迁移后必须删 IDB——idbRestore 排除 chat-msgs 从不回填，
  //   保留旧键导致每次刷新重新迁移覆盖新聊天记录（v3.6.x 修复刷新丢聊天记录）。
  //   幂等检查同时查 IDB 新键（不只 LS/memoryCache），防 idbRestore 未回填时误判为空。
  function migrateLegacy() {
    // v3.26.x：def/root 提升到函数顶部——此前在第一个 try 块内声明（const 块级作用域），
    // 下方 v3.26.x 新增的 pomo-*/beauty-schemes 修复块在 try 外引用 → 每次启动
    // ReferenceError: def is not defined，migrateLegacy 中断、旧键迁移不执行
    const def = window.xyStore(G + ':default');
    const root = window.xyStore(G);
    // v3.9.x：修复被旧版 migrateLegacy 误迁移的全局系统键——早期版本把
    // bg-keepalive/bg-notify（后台保活/通知开关）与 reply-gc-*（群聊回复设置）
    // 当旧顶层业务键迁进 default 桌面并删根键（cleanupOld 只删 LS、IDB 旧根键保留，
    // 每刷新 idbRestore 回填根键 → migrateLegacy 再次迁移，循环破坏），导致非 default
    // 桌面刷新后开关读不到全局值自动变关。这里检测 default 桌面的这些键，写回根
    // 命名空间并删除 default 副本，一次性修复存量坏数据（幂等：根键已有则不覆盖）。
    try {
      ['bg-keepalive', 'bg-notify', 'bg-notify-nodedup', 'group-chat-enabled'].forEach(function (k) {
        const v = def.get(k);
        if (v !== null && v !== undefined && v !== '') {
          try { if (root.get(k) === null || root.get(k) === undefined) root.set(k, v); } catch (e) {}
          try { def.remove(k); } catch (e) {}
        }
      });
      // reply-gc-* 前缀键（群聊全局设置）
      const gcKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(G + ':default:reply-gc-') === 0) gcKeys.push(k.slice((G + ':default:').length));
      }
      gcKeys.forEach(function (k) {
        const v = def.get(k);
        if (v !== null && v !== undefined && v !== '') {
          try { if (root.get(k) === null || root.get(k) === undefined) root.set(k, v); } catch (e) {}
          try { def.remove(k); } catch (e) {}
        }
      });
    } catch (e) {}
    // v3.26.x：修复被旧版 migrateLegacy 误迁移的全局键——pomo-* / beauty-schemes /
    // chat-beauty-schemes / hide-ta-sticker 此前不在 EXCLUDE，每次刷新被当旧顶层业务键
    // 迁进 default 桌面并删 LS 根键。检测 default 副本：根键空则写回根，并一律删 default
    // 副本（幂等：根键已有值不覆盖，只删副本）。memo-app-* 不在此列——memo-app.js 自带
    // 误迁自愈与按 id 合并，避免两处同写冲突。
    // v3.27.x：desk-freq-mode 同列并入——把误迁进 default 的副本写回根键（存量一次性找回）。
    // #231：full-beauty-schemes / beauty-undo-stack 同列并入——修复前已被迁进 default 的
    // 存量完整方案/撤销栈副本写回根键（红米 Note12T 报障用户的「自用」方案数据就滞留在
    // default: 副本里，靠这步找回；根键已有值时只删副本不覆盖）。
    ['pomo-cfg', 'pomo-today', 'pomo-total', 'pomo-msgs', 'pomo-send-chat', 'pomo-bell',
      'pomo-companion', 'pomo-companion-log', 'pomo-cmp-usecards',
      'beauty-schemes', 'chat-beauty-schemes', 'hide-ta-sticker', 'desk-freq-mode',
      // #937：fhub-freq 此前一直漏排除，被每次刷新迁进 default——把滞留副本写回根键找回
      // （fhub-seen 出生即排除，无存量可回收，列入只为口径一致）。
      'full-beauty-schemes', 'fhub-freq', 'fhub-seen',
      // #1293：屏幕适配微调七轴的存量——被旧 migrateLegacy 迁进 default 的副本写回根键找回
      // （根键已有值时只删副本不覆盖，与 pomo-*/fhub-* 同一处理）；配合上面的前缀守卫，
      // 找回后不会再被迁走。用户下一次冷启即恢复自己调过的偏移。
      'screen-adj-top', 'screen-adj-bottom', 'screen-adj-h', 'screen-adj-desk',
      'screen-adj-shift', 'screen-adj-text', 'screen-adj-side'].forEach(function (k) {
      // FIX 2026-09-15 #527：beauty-undo-stack 已自本回收列表移除（改 per-cid 存储）——
      // 若继续把 default 副本写回根键并删副本，会让新的按桌面隔离存储每次启动被搬空，
      // 撤销栈重新变回「跨桌面共用」（=本修复被这条逻辑反向回滚）。
      // 存量根键里的旧撤销栈由上方正常迁移路径搬进 default 桌面，不丢数据。
      const v = def.get(k);
      if (v !== null && v !== undefined && v !== '') {
        try { if (root.get(k) === null || root.get(k) === undefined) root.set(k, v); } catch (e) {}
        try { def.remove(k); } catch (e) {}
      }
    });
    // #1541：上面三键（age-confirmed / storage-guide-shown）与 splash-seen:* 的存量副本回收
    // ——修复前已被误迁进 default 的那份写回根键找回（根键已有值只删副本，pomo-* 同款）：
    // 不找回＝已确认过年龄的存量用户每次开屏仍要重新勾、引导标记仍缺。splash-seen 副本
    // 是过期日期标记，只删不回（当日根键由 clock.js 自己重写）。
    ['age-confirmed', 'storage-guide-shown'].forEach(function (k) {
      const v = def.get(k);
      if (v !== null && v !== undefined && v !== '') {
        try { if (root.get(k) === null || root.get(k) === undefined) root.set(k, v); } catch (e) {}
        try { def.remove(k); } catch (e) {}
      }
    });
    try {
      const stale = [];
      for (let i = 0; i < localStorage.length; i++) {
        const kk = localStorage.key(i);
        if (kk && kk.indexOf(G + ':default:splash-seen:') === 0) stale.push(kk);
      }
      stale.forEach(function (kk) { try { localStorage.removeItem(kk); } catch (e2) {} });
    } catch (e) {}
    const old = [];
    // v3.6.x：顺带清理存量双重前缀垃圾键（default:default:*）——旧版迁移误把命名空间键
    // 再迁一层产生，读取不命中但占存储，安全删除
    const garbage = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.indexOf(G + ':default:default:') === 0) garbage.push(k);
    }
    garbage.forEach(k => {
      try { localStorage.removeItem(k); } catch (e) {}
      if (window.idbDelete) try { window.idbDelete(k); } catch (e) {}
    });
    // #233：清理历史上被误迁进 default 的 __ 系统键残留副本（__wr-journal/__ls-dirty/
    // __big-idx——读取方都只认根命名空间键，副本是死数据纯占 LS 配额；上面 __ 兜底规则
    // 收口后不会再产生新滞留，这里一次性处理存量。LS 与 IDB 都删，防 idbRestore 每次回填）
    const sysGarbage = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.indexOf(G + ':default:__') === 0) sysGarbage.push(k);
    }
    sysGarbage.forEach(k => {
      try { localStorage.removeItem(k); } catch (e) {}
      if (window.idbDelete) try { window.idbDelete(k); } catch (e) {}
    });
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(G + ':') === 0 && !isExcluded(k)) old.push(k);
    }
    const finish = function () {
      try {
        if (!regStore().get('contacts')) {
          let name = '默认';
          // v3.26.x #90：改走 default 命名空间存储（内存优先，回填/写日志都到得了这里），
          // 裸 localStorage 在 LS 整库失效的设备上恒空 → 联系人名字莫名退回「默认」
          try { const n = window.xyStore(G + ':default').get('lbl-partner'); if (n) name = n; } catch (e) {
            try { const n = localStorage.getItem(G + ':default:lbl-partner'); if (n) name = n; } catch (e2) {}
          }
          regStore().set('contacts', JSON.stringify([{ id: 'default', name: name }]));
        }
        // v3.6.x：active-contact 仅在未设置时写 default——迁移不应覆盖用户已选的联系人
        // v3.26.x #88 收口：判空必须走 regStore（内存缓存里就是刚回填好的权威值）。
        // 原来读裸 localStorage：LS 整库失效的设备（实测本项目 0 键 + 写探针
        // QuotaExceededError）上这个条件恒真 → 每次启动都把 IDB 里真正的 active-contact
        // 改回 'default' 并顺带写进内存缓存/写日志，把上方的启动校正（correctCidFromIdb）
        // 整个抵消掉——用户看到的仍然是「聊天记录消失」。migrateLegacy 只在
        // __mochiDataReady 之后运行（见本文件末尾），此刻回填已完成，读得到真值。
        if (!regStore().get('active-contact')) {
          // v3.26.x #90：判空走 regStore 仍不够——回填/写日志都没把值送到内存时，直接写
          // default 会把 IDB 里用户真正的桌面覆盖掉（连内存缓存 + LS + #40 写日志一起改），
          // 而 correctCidFromIdb 之后读到的就是我们刚写的 default，校正被自己抹掉。
          // 现在写 default 前先向 IndexedDB 严格确认（idbHasKey 三态）：
          //   false＝库里确实没有 → 写 default（原行为）
          //   true ＝库里有值只是没送到内存 → 保持「未设置」，交给启动校正按权威值切
          //   null ＝探测本身失败（存储繁忙）→ 同样保持「未设置」，绝不猜测
          const acWrite = function () {
            try { if (!regStore().get('active-contact')) regStore().set('active-contact', 'default'); } catch (e) {}
          };
          if (window.idbHasKey) {
            try {
              window.idbHasKey(G + ':active-contact').then(function (has) {
                if (has === false) acWrite();
              }).catch(acWrite);
            } catch (e) { acWrite(); }
          } else acWrite();
        }
        localStorage.setItem(G + ':migrated-v1', '1');
      } catch (e) {}
      window.__contactsMigrated = true;
      window.__activeCid = window.__activeCid || 'default';
    };
    // 无旧键：首次运行（或全部迁移完）——只确保注册表存在，不重复迁移
    if (!old.length) { finish(); return; }
    const step = function (i) {
      if (i >= old.length) { finish(); return; }
      const k = old[i];
      const rest = k.slice(G.length + 1);
      const newKey = G + ':default:' + rest;
      const next = function () { step(i + 1); };
      // v3.6.x：chat-msgs 旧键迁移后必须删 IDB——idbRestore 排除 chat-msgs 从不回填，
      // 保留旧键导致每次刷新重新迁移覆盖新聊天记录
      const isChat = (function () {
        const tail = k.slice(G.length + 1);
        return tail === 'chat-msgs' || /^[^:]+:chat-msgs$/.test(tail);
      })();
      const cleanupOld = function () {
        try { localStorage.removeItem(k); } catch (e) {}
        if (isChat && window.idbDelete) { try { window.idbDelete(k); } catch (e) {} }
      };
      // #1210：旧键只有在【新键确认落了盘】之后才删。xyStore.set 里 LS 写失败只打脏标记、
      // IDB 写是 fire-and-forget，而 xyStore.get 优先读内存缓存（刚 set 完必然读得到）＝证不了
      // 落盘。原实现 set 之后无条件 cleanupOld（聊天还要连 IDB 根键一起删）＝「新键没落成、
      // 两份旧键已删」的空窗，正是「没删没清却整段聊天记录消失」的出口。证不到就保留旧键、
      // 下次启动重试（本迁移幂等），宁可重复搬一次也不留下空窗。
      const settle = function (payload) {
        try { window.xyStore(G + ':default').set(rest, payload); } catch (e) {}
        const landed = function (durable) { if (durable) cleanupOld(); next(); };
        // 小键 LS 有副本即算落盘；大键（chat-msgs 等）按设计不进 LS，只认 IDB 三态探测：
        // true＝库里确有，false＝没有 / null＝这次读不到（存储繁忙）都不删旧键。
        try { if (localStorage.getItem(newKey) !== null) { landed(true); return; } } catch (e) {}
        if (window.idbHasKey) {
          Promise.resolve(window.idbHasKey(newKey)).then(function (has) {
            landed(has === true);
          }).catch(function () { landed(false); });
        } else landed(false);
      };
      let v = null; try { v = localStorage.getItem(k); } catch (e) {}
      if (v !== null) {
        // 幂等：default 命名空间已有此键（LS/memoryCache/IDB）则不重复写
        const hasNew = window.xyStore(G + ':default').get(rest);
        if (hasNew) { cleanupOld(); next(); return; }
        if (window.idbGet) {
          window.idbGet(newKey).then(function (existing) {
            if (existing) { cleanupOld(); next(); return; }
            settle(v);
          }).catch(function () { settle(v); });
        } else settle(v);
      } else if (window.idbGet) {
        window.idbGet(k).then(r => {
          if (r !== undefined && r !== null) {
            // 幂等：先查 LS/memoryCache，再查 IDB 新键
            const hasNew = window.xyStore(G + ':default').get(rest);
            if (hasNew) { cleanupOld(); next(); return; }
            window.idbGet(newKey).then(function (existing) {
              if (existing) { cleanupOld(); next(); return; }
              settle(r);
            }).catch(function () { settle(r); });
          } else {
            cleanupOld();
            next();
          }
        }).catch(next);
      } else next();
    };
    if (window.idbGetAllKeys) {
      window.idbGetAllKeys().then(keys => {
        (keys || []).forEach(k => {
          if (typeof k === 'string' && k.indexOf(G + ':') === 0 && !isExcluded(k) && old.indexOf(k) < 0) old.push(k);
        });
        step(0);
      }).catch(() => step(0));
    } else step(0);
  }
  // v3.6.x：迁移必须等 IndexedDB 回填完成（mochi-restore-done）后再执行——
  // idbRestore 是异步的，它先拿到旧键列表再分批读值回填；若 migrateLegacy 与它并发，
  // 迁移删掉旧键（localStorage + IndexedDB）后，idbRestore 读旧键得到空、新键
  //（xy-home-v2:default:*）又不在它的键列表里 → 内存缓存/localStorage 全部缺失，
  // 刷新后头像/壁纸/聊天壁纸（大键只存 IDB）全部丢失。
  function runMigrateWhenReady() {
    if (window.__mochiDataReady) { migrateLegacy(); return; }
    try {
      document.addEventListener('mochi-restore-done', function h() {
        document.removeEventListener('mochi-restore-done', h);
        migrateLegacy();
      });
    } catch (e) { migrateLegacy(); }
  }
  runMigrateWhenReady();

  // ---- 联系人管理 UI ----
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  // v3.6.x 修复（按钮无反应）：内联 display:flex 会覆盖 hidden 属性的 UA 样式
  // （[hidden]{display:none}），导致 m.hidden=true/false 完全失效——弹窗关不掉、
  // 点击遮罩/关闭/切换后仍盖在页面上；z-index 9999 又盖住全局 openModal 的
  // #modal-mask(z-index 90)，新建/改名弹输入框在联系人弹窗下面看不到也点不到。
  // 修复：display 显式控制显隐（showContactModal/hideContactModal），
  // z-index 降到 89（低于 modal-mask，openModal 输入框可浮在其上）。
  function showContactModal(m) { m.style.display = 'flex'; m.hidden = false; }
  function hideContactModal(m) { m.style.display = 'none'; m.hidden = true; }
  function ensureModal() {
    let m = document.getElementById('contact-manager');
    if (!m) {
      m = el('div'); m.id = 'contact-manager'; m.hidden = true;
      m.style.cssText = 'position:fixed;inset:0;z-index:89;align-items:center;justify-content:center;background:rgba(0,0,0,.4)';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m) hideContactModal(m); });
    }
    // v3.x：列表 overflow-y:auto 在部分设备（如红米 K80 Chrome）会露出灰色滚动条，
    // 与全站其余滚动容器「隐藏滚动条」的观感不一致——隐藏但保留滚动能力。
    if (!document.getElementById('cm-scrollbar-hide')) {
      const st = document.createElement('style'); st.id = 'cm-scrollbar-hide';
      // v3.26.x：「功能说明」统一为设置页 .tag 同款中性胶囊（此前内联 #7a6ad8 紫色，黑白/深色主题下突兀）
      st.textContent = '.cm-list{scrollbar-width:none;-ms-overflow-style:none}.cm-list::-webkit-scrollbar{display:none}' +
        '#cm-fn-explain{display:inline-block;margin-left:4px;font-size:11px;color:var(--muted,#888);font-weight:400;letter-spacing:.2px;border:1px solid rgba(0,0,0,.08);background:rgba(0,0,0,.03);border-radius:9px;padding:2px 9px;cursor:pointer;line-height:1.4}' +
        '#cm-fn-explain:hover,#cm-fn-explain:focus-visible{background:rgba(0,0,0,.06);border-color:rgba(0,0,0,.12);outline:none}' +
        '[data-theme="dark"] #cm-fn-explain{color:#aaa;border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.06)}' +
        '[data-theme="dark"] #cm-fn-explain:hover,[data-theme="dark"] #cm-fn-explain:focus-visible{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2)}';
      document.head.appendChild(st);
    }
    return m;
  }
  window.openContactManager = function () {
    const m = ensureModal();
    m.innerHTML = '';
    const box = el('div');
    // v3.11.x：颜色改主题变量（内联硬编码浅色在深色模式下白底白字不可见）
    box.style.cssText = 'width:min(92vw,420px);max-height:80vh;display:flex;flex-direction:column;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:18px;box-shadow:0 8px 30px rgba(0,0,0,.2)';
    box.appendChild(el('div', '', '<div style="font-size:16px;font-weight:600;margin-bottom:4px">联系人 / 桌面</div><div style="font-size:12px;color:var(--muted,#888);margin-bottom:12px">每个联系人数据独立；除朋友圈外，还有部分功能数据在所有桌面共用。<b id="cm-fn-explain">【功能说明】</b><br>「称呼」可设置消息里 TA 的性别叫法（他 / 她 / 不设置）</div>'));
    const list = el('div', 'cm-list'); list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-bottom:12px;overflow-y:auto;overflow-x:hidden;flex:1;min-height:0';
    getContacts().forEach(c => {
      const row = el('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px';
      const dot = el('div');
      dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:' + (c.id === window.__activeCid ? 'var(--ink,#111)' : '#ccc');
      const gw = window.taWordFor(c.id);
      const gLabel = gw === 'TA' ? '' : (' · 称呼：' + gw);
      const nm = el('div', '', '<div style="font-size:14px;font-weight:500">' + (c.name || c.id) + '</div><div style="font-size:11px;color:var(--muted,#999)">' + (c.id === window.__activeCid ? '当前桌面' : '点击切换') + gLabel + '</div>');
      nm.style.flex = '1';
      row.appendChild(dot); row.appendChild(nm);
      if (c.id !== window.__activeCid) {
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => { window.setActiveContact(c.id); hideContactModal(m); });
      }
      const acts = el('div'); acts.style.cssText = 'display:flex;gap:6px';
      const gen = el('button', '', '称呼');
      gen.style.cssText = 'font-size:12px;padding:4px 8px;border:1px solid var(--pill-border,#ddd);border-radius:8px;background:var(--static-bg,#fafafa);color:var(--ink,#111)';
      gen.addEventListener('click', (e) => {
        e.stopPropagation();
        openGenderModal(c, m);
      });
      acts.appendChild(gen);
      const ren = el('button', '', '改名');
      ren.style.cssText = 'font-size:12px;padding:4px 8px;border:1px solid var(--pill-border,#ddd);border-radius:8px;background:var(--static-bg,#fafafa);color:var(--ink,#111)';
      ren.addEventListener('click', (e) => {
        e.stopPropagation();
        // #1541 续：同「新建联系人」——空值可见化（不再静默 return＝「确认了没反应」无从排查）
        if (window.openModal) window.openModal('改名', c.name || '', (v) => {
          if (v && v.trim()) { window.renameContact(c.id, v.trim()); window.openContactManager(); }
          else { try { if (window.toast) window.toast('没有读到名字——请再试一次；反复出现请到设置→关于/诊断导出诊断单报障'); } catch (e0) {} }
        });
      });
      acts.appendChild(ren);
      if (c.id !== 'default') {
        const del = el('button', '', '删除');
        del.style.cssText = 'font-size:12px;padding:4px 8px;border:1px solid rgba(163,45,45,.35);border-radius:8px;background:var(--danger-soft,#fff5f5);color:var(--danger-ink,#a32d2d)';
        del.addEventListener('click', (e) => { e.stopPropagation(); confirmDelete(c, m); });
        acts.appendChild(del);
      }
      row.appendChild(acts);
      list.appendChild(row);
    });
    box.appendChild(list);
    const add = el('button', '', '+ 添加联系人 / 桌面');
    add.style.cssText = 'width:100%;padding:12px;border:none;border-radius:10px;background:var(--ink,#111);color:var(--bg-b,#fff);font-size:14px;font-weight:600';
    add.addEventListener('click', () => {
      if (window.openModal) window.openModal('新建联系人', '', (v) => {
        const name = (v || '').trim();
        // #1541 续：空值不再静默 return——红米 K80 Chrome 实报「确认了没反应」无法远程
        // 复现（无头全绿），静默失败让用户与排查方都拿不到任何线索；可见化后：
        // 弹这条＝读值链真收到空（输入法组合/代理断），一条 toast 直接定位方向。
        if (!name) { try { if (window.toast) window.toast('还没有输入名字——先点输入框打一个名字'); } catch (e0) {} return; }
        const id = window.createContact(name); window.setActiveContact(id); hideContactModal(m);
        // #1541c：即时反馈——新桌面未设壁纸/头像时与默认桌面视觉相同，无反馈＝
        // 「点了没反应」错觉；toast 点名已切换＋桌面圆签当场显示新名双保险。
        try { if (window.toast) window.toast('已创建「' + name + '」的桌面，已为你切换'); } catch (e) {}
      });
    });
    box.appendChild(add);
    // v3.18.x：「美化方案」已收拢到【手机桌面美化】页（保存/我的方案/导入导出同组），此处不再重复放入口
    const close = el('button', '', '关闭');
    close.style.cssText = 'width:100%;margin-top:8px;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)';
    close.addEventListener('click', () => { hideContactModal(m); });
    box.appendChild(close);
    m.appendChild(box);
    // v3.26.x：「功能说明」——点开弹窗列出所有跨桌面共用的数据
    document.getElementById('cm-fn-explain') && document.getElementById('cm-fn-explain').addEventListener('click', function (e) { e.stopPropagation(); if (window.openFuncExplain) window.openFuncExplain(); });
    showContactModal(m);
  };
  // 切换桌面「功能说明」：说明哪些数据在所有桌面共用 / 哪些按桌面独立
  window.openFuncExplain = function () {
    const m = ensureModal();
    m.innerHTML = '';
    const box = el('div');
    box.style.cssText = 'width:min(92vw,420px);max-height:80vh;display:flex;flex-direction:column;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:18px;box-shadow:0 8px 30px rgba(0,0,0,.2);overflow-y:auto';;
    const txt =
      '<div style="font-size:16px;font-weight:600;margin-bottom:8px">数据互通说明</div>' +
      '<div style="font-size:13px;font-weight:600;color:var(--danger-ink,#a32d2d);margin-bottom:6px">所有桌面共用的数据</div>' +
      '<ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.9;color:var(--muted,#666)">' +
      '<li>朋友圈（动态、通知、双方昵称/头像/封面）</li>' +
      '<li>群聊（消息、成员形象、美化、回复设置、开关）</li>' +
      '<li>存钱罐（金额与存钱目标，两人共同金库）</li>' +
      '<li>心意币 / 红包 / 市集余额</li>' +
      '<li>心意市集自定义商品</li>' +
      '<li>我的表情包</li>' +
      '<li>字卡库公用字卡</li>' +
      '<li>经期记录、摸鱼天数</li>' +
      '<li>帮我决定 / 多人决定（历史与设置）</li>' +
      '<li>梦角世界·此间（名单与状态）、梦角档案 / 我的档案</li>' +
      '<li>音乐文件、后台保活、通知、离线消息提醒</li>' +
      '<li>跨桌面「来消息」（查岗 / 来电申请与开关）</li>' +
      '</ul>' +
      '<div style="font-size:13px;font-weight:600;color:#1a8a5f;margin:12px 0 6px">按桌面独立的数据</div>' +
      '<ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.9;color:var(--muted,#666)">' +
      '<li>聊天记录与未读数</li>' +
      '<li>字卡库专属字卡 / 专属回复 / 收藏</li>' +
      '<li>桌面布局与美化（壁纸 / 气泡 / 字号等）</li>' +
      '<li>称呼性别（TA / 他 / 她）</li>' +
      '<li>日历、信箱、备忘录</li>' +
      '<li>占卜、记录、收藏、统计、记账</li>' +
      '</ul>' +
      '<div style="font-size:12px;color:var(--muted,#999);margin-top:12px;line-height:1.7">「共用」指切换桌面后数据仍延续；「独立」指各桌面各留一份、互不影响。</div>';
    box.appendChild(el('div', '', txt));
    const close = el('button', '', '关闭');
    close.style.cssText = 'width:100%;margin-top:14px;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)';
    close.addEventListener('click', () => { hideContactModal(m); });
    box.appendChild(close);
    m.appendChild(box);
    showContactModal(m);
  };
  // 称呼（性别）设置弹窗：他 / 她 / 不设置（默认 TA）
  function openGenderModal(c, m) {
    if (!window.openModal) return;
    const cur = window.partnerGenderFor(c.id);
    window.openModal('称呼设置 · ' + (c.name || c.id), '', function (v) {
      if (v !== 'he' && v !== 'she' && v !== '') return;
      try { window.xyStore(G + ':' + c.id).set('partner-gender', v); } catch (e) {}
      try { document.dispatchEvent(new CustomEvent('ta-word-changed', { detail: { id: c.id } })); } catch (e) {}
      if ((window.__activeCid || 'default') === c.id && window.refreshActiveContactUI) window.refreshActiveContactUI();
      hideContactModal(m);
    }, {
      noInput: true,
      pill: cur,
      staticText: '小字说明：设置后，桌面浮字、聊天、朋友圈、信箱等消息里的「TA／他」会跟随显示为「他」或「她」；选「不设置」则保持默认「TA」。该设置为每个联系人独立保存，只改显示方式，不会改动已保存的消息原文。',
      pills: [
        { label: '他（男生）', value: 'he' },
        { label: '她（女生）', value: 'she' },
        { label: '不设置（默认 TA）', value: '' }
      ]
    });
  }

  function confirmDelete(c, m) {
    const m2 = ensureModal();
    m2.innerHTML = '';
    const box = el('div');
    box.style.cssText = 'width:min(88vw,340px);background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:18px;text-align:center';
    box.appendChild(el('div', '', '<div style="font-size:15px;font-weight:600;margin-bottom:6px">删除「' + (c.name || c.id) + '」？</div><div style="font-size:12px;color:var(--danger-ink,#a32d2d);margin-bottom:14px">该联系人的全部数据将清空，且不可恢复</div>'));
    const row = el('div'); row.style.cssText = 'display:flex;gap:10px';
    const ok = el('button', '', '删除');
    ok.style.cssText = 'flex:1;padding:10px;border:none;border-radius:10px;background:#a32d2d;color:#fff;font-weight:600';
    ok.addEventListener('click', () => { window.deleteContact(c.id); hideContactModal(m2); hideContactModal(m); window.openContactManager(); });
    const no = el('button', '', '取消');
    no.style.cssText = 'flex:1;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)';
    no.addEventListener('click', () => { hideContactModal(m2); });
    row.appendChild(ok); row.appendChild(no); box.appendChild(row);
    m2.appendChild(box); showContactModal(m2);
  }

  // ===== #646：进入桌面入口流程（打开时先进入此间 / 默认进入的桌面）=====
  // 三个设置都存全局根键（EXCLUDE 已登记），默认关闭：
  //   entry-cjian-first      '1'=每次打开应用先进入此间，看完返回时弹出「选择本次进入的桌面」
  //   entry-show-list        '1'=每次打开应用直接弹出全部联系人列表，点一个进入其桌面
  //   entry-default-contact  联系人 id；设置后每次打开应用直接进入该桌面（空=关闭）
  // 优先级：默认桌面已设时取代「先进入此间」与「显示联系人列表」（两者强制关闭并置灰）；
  //         先进入此间 开启时走此间→选择桌面，未开则「显示联系人列表」直接弹列表。
  function entryCjianFirstOn() {
    try { return regStore().get('entry-cjian-first') === '1'; } catch (e) { return false; }
  }
  function entryShowListOn() {
    try { return regStore().get('entry-show-list') === '1'; } catch (e) { return false; }
  }
  function entryDefaultCid() {
    let id = '';
    try { id = regStore().get('entry-default-contact') || ''; } catch (e) {}
    if (!id) return '';
    try { return getContacts().some(c => c && c.id === id) ? id : ''; } catch (e) { return ''; }
  }
  function closeEntryPicker() {
    const ov = document.getElementById('entry-picker');
    if (ov) { ov.style.display = 'none'; ov.hidden = true; }
  }
  function ensureEntryPicker() {
    let ov = document.getElementById('entry-picker');
    if (!ov) {
      ov = el('div'); ov.id = 'entry-picker'; ov.hidden = true;
      ov.style.cssText = 'position:fixed;inset:0;z-index:10060;display:none;flex-direction:column;background:var(--bg-b,#fff);color:var(--ink,#111)';
      document.body.appendChild(ov);
    }
    return ov;
  }
  // 选择桌面「页」：mode='entry' 本次进入（选中即切换桌面）；mode='setDefault' 设置默认（选中写设置键、不切桌面）
  function openContactPicker(opts) {
    opts = opts || {};
    const mode = opts.mode === 'setDefault' ? 'setDefault' : 'entry';
    const ov = ensureEntryPicker();
    const curDef = entryDefaultCid();
    ov.innerHTML = '';
    const head = el('div'); head.style.cssText = 'padding:22px 20px 6px;font-size:20px;font-weight:700';
    head.textContent = mode === 'entry' ? '选择本次进入的桌面' : '默认进入的桌面';
    ov.appendChild(head);
    const sub = el('div'); sub.style.cssText = 'padding:0 20px 14px;font-size:12px;color:var(--muted,#888);line-height:1.6';
    sub.textContent = mode === 'entry'
      ? (opts.sub || '看完此间了，选一个联系人桌面进入吧。')
      : '开启后，每次打开应用直接进入所选桌面；选「关闭」即不设置。';
    ov.appendChild(sub);
    const wrap = el('div'); wrap.style.cssText = 'flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:2px 16px 18px;display:flex;flex-direction:column;gap:10px';
    const mkCard = function (title, tagText, isCurrent, tagOn) {
      const card = el('div');
      card.style.cssText = 'display:flex;align-items:center;gap:10px;padding:14px;border:1px solid var(--card-border,#eee);border-radius:14px;background:var(--card-bg,#fff);cursor:pointer';
      const nm = el('div', '', '<div style="font-size:15px;font-weight:600">' + title + '</div>' +
        (isCurrent ? '<div style="font-size:11px;color:var(--muted,#999)">当前桌面</div>' : ''));
      nm.style.flex = '1';
      card.appendChild(nm);
      if (tagText) {
        const tag = el('div', '', tagText);
        tag.style.cssText = 'font-size:11px;padding:2px 9px;border-radius:9px;border:1px solid ' +
          (tagOn ? 'rgba(26,138,95,.4);color:#1a8a5f;background:rgba(26,138,95,.08)' : 'rgba(0,0,0,.08);color:var(--muted,#888)');
        card.appendChild(tag);
      }
      return card;
    };
    if (mode === 'setDefault') {
      const off = mkCard('关闭（不设置）', '', false, false);
      off.addEventListener('click', function () {
        try { regStore().set('entry-default-contact', ''); } catch (e) {}
        closeEntryPicker();
        if (opts.onDone) opts.onDone();
      });
      wrap.appendChild(off);
    }
    getContacts().forEach(function (c) {
      const isCurrent = c.id === (window.__activeCid || 'default');
      const isDef = c.id === curDef;
      const card = mkCard(c.name || c.id, (mode === 'entry' && isDef) ? '默认' : '', isCurrent, false);
      card.addEventListener('click', function () {
        if (mode === 'setDefault') {
          try { regStore().set('entry-default-contact', c.id); } catch (e) {}
          closeEntryPicker();
          if (opts.onDone) opts.onDone();
        } else {
          closeEntryPicker();
          try { if (c.id !== (window.__activeCid || 'default')) window.setActiveContact(c.id); } catch (e) {}
        }
      });
      wrap.appendChild(card);
    });
    ov.appendChild(wrap);
    if (mode === 'setDefault') {
      const cancel = el('button', '', '取消');
      cancel.style.cssText = 'margin:0 16px 18px;padding:11px;border:1px solid var(--card-border,#eee);border-radius:12px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555);font-size:14px';
      cancel.addEventListener('click', function () { closeEntryPicker(); if (opts.onDone) opts.onDone(); });
      ov.appendChild(cancel);
    }
    ov.hidden = false; ov.style.display = 'flex';
  }
  window.__openContactPicker = openContactPicker;

  // 开屏进入此间时注入的引导条（不侵入 cjian.js：作为 #page-cjian 的直接子节点插在顶栏下）
  function removeCjianHint() {
    const h = document.getElementById('entry-cjian-hint');
    if (h && h.parentNode) h.parentNode.removeChild(h);
  }
  function showCjianHint() {
    removeCjianHint();
    const page = document.getElementById('page-cjian');
    if (!page) return;
    const hint = el('div', '', '点每位梦角的【去找TA】直接进入 TA 的桌面；点左上角返回，则选择本次进入哪个桌面。若某位梦角没有状态显示，点下方【感知此间】看看 TA 此刻在哪、在做什么。');
    hint.id = 'entry-cjian-hint';
    hint.style.cssText = 'margin:8px 12px 0;padding:9px 12px;border-radius:10px;font-size:12px;line-height:1.6;color:var(--muted,#666);background:rgba(127,106,216,.08);border:1px solid rgba(127,106,216,.2)';
    const head = page.querySelector('.chat-head');
    if (head && head.parentNode === page) page.insertBefore(hint, head.nextSibling);
    else page.insertBefore(hint, page.firstChild);
  }

  // 打开应用进入后调用（clock.js finishEnter 接线）：应用默认桌面 / 先进入此间
  window.mochiContactEntryFlow = function () {
    if (window.__mochiEntryFlowDone) return;
    window.__mochiEntryFlowDone = true;
    const def = entryDefaultCid();
    if (def && def !== (window.__activeCid || 'default')) {
      try { window.setActiveContact(def); } catch (e) {}
    }
    if (!entryCjianFirstOn()) {
      // 「打开时显示联系人列表」：不在此间停留，直接弹出全部联系人列表，点一个进入其桌面
      if (entryShowListOn()) openContactPicker({ mode: 'entry', sub: '选一个联系人桌面进入吧。' });
      return;
    }
    if (!window.openCjian) { openContactPicker({ mode: 'entry' }); return; }
    let page = null;
    try { page = document.getElementById('page-cjian'); } catch (e) {}
    if (!page) { openContactPicker({ mode: 'entry' }); return; }
    let fired = false;
    // 不侵入 cjian.js：观察 #page-cjian 的 hidden 变化，用户离开此间时决定去向
    const obs = new MutationObserver(function () {
      if (!page.hidden || fired) return;
      fired = true;
      try { obs.disconnect(); } catch (e) {}
      removeCjianHint();
      // 点【去找TA】＝用户已显式选定目标（此间会切到该联系人并打开聊天页）→ 直接进入，不再弹选择桌面页；
      // 只有点左上角返回（回桌面主页 #page-phone）才弹「选择本次进入的桌面」
      const chat = document.getElementById('page-chat');
      if (chat && !chat.hidden) return;
      setTimeout(function () { openContactPicker({ mode: 'entry' }); }, 0);
    });
    try { obs.observe(page, { attributes: true, attributeFilter: ['hidden'] }); } catch (e) {}
    try {
      window.__cjianFrom = '';
      window.openCjian();
      showCjianHint();
      // 开屏进入此间时默认停在「全部」总览（openCjian 内部默认回到当前桌面，这里点选「全部」chip 切过去；
      // 不侵入 cjian.js——setView(ALL) 只改视图、不持久化、不影响之后从桌面正常进入）
      const chips = document.querySelectorAll('#cj-groups .cj-gchip');
      for (let i = 0; i < chips.length; i++) {
        if (chips[i].textContent === '全部') { chips[i].click(); break; }
      }
    } catch (e) {
      try { obs.disconnect(); } catch (e2) {}
      removeCjianHint();
      openContactPicker({ mode: 'entry' });
    }
  };

  // #646：设置页「打开时先进入此间」开关 + 「打开时显示联系人列表」开关 + 「默认进入的桌面」入口
  // 「默认进入的桌面」开启时取代前面两个入口选择：二者强制关闭且置灰不可改（关掉默认桌面后恢复）
  function syncEntryModes() {
    const hasDef = !!entryDefaultCid();
    const cbC = document.getElementById('entry-cjian-first');
    const cbL = document.getElementById('entry-show-list');
    if (hasDef) {
      try {
        if (regStore().get('entry-cjian-first') === '1') regStore().set('entry-cjian-first', '0');
        if (regStore().get('entry-show-list') === '1') regStore().set('entry-show-list', '0');
      } catch (e) {}
      if (cbC) cbC.checked = false;
      if (cbL) cbL.checked = false;
    }
    if (cbC) cbC.disabled = hasDef;
    if (cbL) cbL.disabled = hasDef;
    const rowC = document.getElementById('row-entry-cjian-first');
    const rowL = document.getElementById('row-entry-show-list');
    if (rowC) rowC.style.opacity = hasDef ? '.5' : '';
    if (rowL) rowL.style.opacity = hasDef ? '.5' : '';
    let tip = document.getElementById('entry-cjian-first-tip');
    if (hasDef) {
      if (!tip && rowC && rowC.parentNode) {
        tip = el('div', 'gs-sub', '已由「默认进入的桌面」取代：每次打开直接进入所选桌面，不再先进入此间或显示联系人列表。要恢复，请把上面的默认桌面设为「关闭」。');
        tip.id = 'entry-cjian-first-tip';
        rowC.parentNode.insertBefore(tip, rowC.nextSibling);
      }
    } else if (tip && tip.parentNode) {
      tip.parentNode.removeChild(tip);
    }
  }
  const efCjian = document.getElementById('entry-cjian-first');
  if (efCjian) {
    try { efCjian.checked = entryCjianFirstOn(); } catch (e) {}
    efCjian.addEventListener('change', function () {
      const on = efCjian.checked;
      try { regStore().set('entry-cjian-first', on ? '1' : '0'); }
      catch (e) { efCjian.checked = !on; toastEntry('设置没能保存，请重试'); return; }
      toastEntry(on ? '打开时先进入此间 已开启：下次打开应用先进此间'
                    : '打开时先进入此间 已关闭：下次打开应用不再先进此间');
    });
  }
  const efList = document.getElementById('entry-show-list');
  if (efList) {
    try { efList.checked = entryShowListOn(); } catch (e) {}
    efList.addEventListener('change', function () {
      const on = efList.checked;
      try { regStore().set('entry-show-list', on ? '1' : '0'); }
      catch (e) { efList.checked = !on; toastEntry('设置没能保存，请重试'); return; }
      toastEntry(on ? '打开时显示联系人列表 已开启：下次打开应用先列出全部联系人'
                    : '打开时显示联系人列表 已关闭：下次打开应用不再列出联系人');
    });
  }
  const efDefRow = document.getElementById('row-entry-default-contact');
  // 「默认进入的桌面」行的回显文案（刷新后 / 选择后都要按存储值重算）
  function refreshEntryDefVal() {
    const val = document.getElementById('entry-default-contact-val');
    if (!val) return;
    const id = entryDefaultCid();
    const c = id ? getContacts().find(x => x.id === id) : null;
    val.textContent = c ? (c.name || c.id) : '关闭';
  }
  if (efDefRow) {
    refreshEntryDefVal();
    efDefRow.addEventListener('click', function () {
      openContactPicker({ mode: 'setDefault', onDone: function () { refreshEntryDefVal(); syncEntryModes(); } });
    });
  }
  // 入口三行的通用轻提示（window.toast 由 device.js 提供；缺失时静默，不阻断开关）
  function toastEntry(msg) { try { if (typeof window.toast === 'function') window.toast(msg); } catch (e) {} }
  // v3.27.x 修复（用户：设置里「打开时先进入此间」我并没有开启，但每次打开 App 都会先进此间）：
  //   三个开关 / 回显都只在脚本解析时读一次存储，而数据是【异步】从 IndexedDB 回填的
  //   （idb.js 的 idbRestore → mochi-restore-done）。localStorage 副本丢失而 IDB 仍持有新值时
  //   （LS 配额满导致 setItem 静默失败被标 ls-dirty、浏览器清存储、iOS 常见），解析时读到的是
  //   旧值/空值 → 开关显示「关」，被标脏的键在回填后才把真实值写回来 → 入口流程按真实值
  //   执行（每次打开都先进此间），开关却永远停在「关」，用户看到的就是「没开却每次都进」。
  //   实测时间线（产物 + 剥掉 LS 值的重载）：226ms 开关读到空值＝未勾选 → 803ms
  //   __mochiDataReady 且 LS 恢复为 '1' → 开关仍为未勾选，入口流程照常进此间。
  //   修法与 incoming-requests.js 的 addSettingToggle 同款：数据回填完成 / 切桌面时按存储值
  //   重同步三行 UI（存储值恒为权威，UI 不再说谎；勾选项也就真的能一键关掉）。
  function syncEntryToggles() {
    const cbC = document.getElementById('entry-cjian-first');
    // 被「默认进入的桌面」取代而置灰的两项：勾选态由 syncEntryModes 强制关闭，这里不抢改
    if (cbC && !cbC.disabled) cbC.checked = entryCjianFirstOn();
    const cbL = document.getElementById('entry-show-list');
    if (cbL && !cbL.disabled) cbL.checked = entryShowListOn();
  }
  function syncEntryUI() {
    try { syncEntryModes(); } catch (e) {}
    try { syncEntryToggles(); } catch (e) {}
    try { refreshEntryDefVal(); } catch (e) {}
  }
  document.addEventListener('mochi-restore-done', syncEntryUI);
  syncEntryModes();
  document.addEventListener('contact-switched', syncEntryUI);

  // 设置页入口
  const row = document.getElementById('row-contacts');
  if (row) {
    row.addEventListener('click', () => window.openContactManager());
    function refreshContactsVal() {
      const val = document.getElementById('contacts-val');
      if (!val) return;
      const c = getContacts().find(x => x.id === (window.__activeCid || 'default'));
      val.textContent = c ? (c.name || c.id) : '';
    }
    refreshContactsVal();
    document.addEventListener('contact-switched', refreshContactsVal);
  }
})();
