// ===== 功能：通用设置（聊天触发概率） =====
// 存储 + 设置页 stepper/开关交互；暴露 window.replyCfg 给聊天回复逻辑使用
(function () {
  const uid = window.activePrefix();
  const ls = window.activeStore();

  // 全部概率/参数项（与星言 speedSettings 对应）
  const DEFAULTS = {
    'rs-min': 1, 'rs-max': 40,
    'reply-min': 1, 'reply-max': 2,
    // #1180 TA 消息总量限流（用户直派「回复条数只管基础回复，撤回补发/逐卡连发/心情分享/红包捎话/
    // 主动发送全都绕过上限，导致聊天里联系人发送的消息非常多」）——rl-en 总开关（**默认关闭**＝行为
    // 与改造前一字不变）、rl-win 窗口分钟数、rl-max 窗口内最多条数。生效见 chat.js rateLimitFull
    // （计数源＝msgs 里 in 侧收件；已读回执与 nightAllow「用户当刻操作引发」记录不占额度也不拦）
    'rl-en': 0, 'rl-win': 5, 'rl-max': 15,
    // #1376（用户直派「默认保持 mochi 原机制，但可以切换 nova 的回复机制；开了 nova 不受总量限流限制」）：
    // turn-en 总开关，**默认 0＝行为一字不变**；生效见 chat.js scheduleReply/scheduleReplyTurn
    'turn-en': 0,
    'rn-prob': 20, 'touch-prob': 5,
    'sticker-prob': 10, 'emoji-prob': 5, 'image-prob': 5, 'voice-prob': 10,
    'kaomoji-prob': 5, 'quote-prob': 30,
    'rc-prob': 25, 'rc-refix': 35, 'rc-en': 1, 'cf-prob': 20,
    'py-en': 1, 'py-prob': 50, 'py-min': 2, 'py-max': 5,
    // #650：多字卡「拼接随机标点」——py-punct-en 总开关（默认开）；六个拼接符号池开关
    //（py-punct-space 空格 / py-punct-dou ，/ py-punct-per 。/ py-punct-ex ！/ py-punct-q ？
    // / py-punct-el ......）。**默认＝六种全开（空格＋，。！？......）随机混拼、句号也在池里**
    //（FIX 2026-09-17 #694：用户定稿「空格、。！？...... 全部开启，然后用户可以自己选择开启或
    // 关闭某个」——py-punct-per 由 #650 的默认 0 翻成 1；六枚默认全 1。键此前只随构建上线过一次
    //（#650 已随全树收口进产物），但从未有「保存设置」写盘以外的写入方，未写盘设备=键不存在→
    // 走本默认值；已写盘设备的 0/1 是用户自己的选择，按「用户可自己开关」不回改，故无迁移）。
    // 每两条字卡中间独立随机掷一个；总开关关＝固定只用空格（原行为）；池全关会被设置页
    // 拦下（至少保留一个）。join 消费在 chat.js pyJoinCards（多字卡回复 + 词典拼字单气泡
    // 同用），设置 UI 见本文件 #650 段（ppy-chips）
    'py-punct-en': 1,
    'py-punct-space': 1, 'py-punct-dou': 1, 'py-punct-per': 1, 'py-punct-ex': 1, 'py-punct-q': 1, 'py-punct-el': 1,
    // #712：内置「——」（默认开，用户直派「拼接符号新增一个：—— 默认开启」）——未写盘设备
    // 走本默认 1；已写盘设备的 0/1 是用户自己的选择，无迁移（同 #694 口径）
    'py-punct-dash': 1,
    // #1198：内置「换行」（用户直派「多字卡回复和标点符号 需要新增联系人自己随机选择是否换行」）——
    // 默认关＝存量设备观感零变化，点亮后每两条字卡中间随机抽，抽到它才另起一行。与其余符号同池，
    // 消费在 chat.js pyJoinCards
    'py-punct-nl': 0,
    // v3.40.x #370c：csp-cust 回复文本「自定义字卡占比」（%，默认 50）——联系人回话里的
    // 纯文字卡，多大比例保留「你自定义的字卡」、其余让系统默认聊天字卡覆盖（默认字卡本身还
    // 受默认字卡「聊天使用」概率与分类权重控制）。0=尽量用默认字卡，100=全用自定义。chat.js
    // replyOnce 的 genReplyText 文本路径消费（默认字卡覆盖点前掷一次，命中则保留自定义）
    'csp-cust': 50,
    // #518：系统预设字卡·聊天触发概率「总档」（%，默认 100）——回复设置→聊天「系统预设字卡·聊天
    // 触发概率」组首行；生效缩放见 src/js/dcp-master.js 的 dcpEff（生效 = 各分类设定值 × 总档 ÷ 100）。
    // 未设键 = 100 = 各类按自身值生效、行为完全不变（「未设键回退原写死值」硬规）
    'dcp-all': 100,
    // #1153：互动卡频率档（0 原频率 / 1 稍安静 / 2 安静 / 3 很安静，默认 0）——用户直派
    // 「联系人在聊天里发送互动卡片的频率需要可以调整 / 原来的频率也保留」，随后补充
    // 「其实原频率就已经很频繁了。不要高频率，帮我做原频率调低几档」——档位全部 ≤ 原频率。
    // 作用面＝聊天里 TA 主动发的卡与邀请（五类提问卡 / 邀请三类 / 音乐邀请）：概率、提问卡冷却、
    // 跨类型总闸门按档整体往下缩放；默认 0（原频率）＝全部倍数 ×1 ＝行为与加本功能之前逐位相同。
    // 档位倍数定义与消费点见 src/js/ta-ask.js 的 IC_MODES / icProb / icCool / interactGateMs
    //（键同为 reply-ic-freq）。
    'ic-freq': 0,
    // v3.28.x #298：词典拼字——qs-en 总开关、qs-prob 拼字概率（%）、qs-cc 混用自定义字卡
    //（1=字卡池+词典语录合并抽句；0=只用词典语录）。逻辑与词库数据见 quote-spell.js +
    // v3.40.x #388：qs-cc 默认改回 1（用户点名「混用自定义字卡需要默认开启」）——
    // v3.28.x #310 曾默认改 0 并把存量迁移成 0；本轮 migrateQsCcOld 反向迁移把经历过
    // 上轮迁移（标记=1）且当前值为 0 的桌面改回 1（上轮迁移后自行关闭的无法区分，会被
    // 一并打开一次，同 #310 时的取舍）；
    // qs-one 单气泡拼字（默认开）：命中拼字后 50% 掷成单气泡形态（词间空格一张卡+「词典拼字」tag）
    // v3.42.x #443：qs-noLimit「逐卡连发不受条数限制」默认 1→0（翻案 #350）——逐卡连发本身就是
    // 回复的一部分，应计入「回复条数最多」（用户报「只设最多回复 2 条但联系人一直超」）；
    // 旧默认已随「保存设置」全量写盘的存量由 migrateQsNoLimitOld 按标记键一次性收口，
    // 此后用户手动再打开的 '1' 不再被迁移（标记式而非值式，原因见迁移函数注释）
    // FIX 2026-09-17 #644：qs-noLimit 默认 0→1（用户翻案 #443，多机型报「默认该是开的、按钮却是关的」）
    // ——恢复 #350 定稿默认开；#443 已落盘的存量 '0' 由 migrateQsNoLimitBack 按标记键反向收口，
    // 此后用户手动再关闭的 '0' 不再被纠正（标记升级为 2，同 migrateQsCcOld 模式）
    'qs-en': 1, 'qs-prob': 25, 'qs-cc': 1, 'qs-one': 1, 'qs-multi': 1, 'qs-noLimit': 1,
    // v3.28.x #317：梦角自由造句——mjf-prob 触发概率（%）：梦角说话按概率「截断某几个字
    // 重新造句」，新句自动存进自定义聊天字卡新分类「梦角自由造句」（dream-free.js，
    // chat.js replyOnce 消费）
    // v3.26.x #513：mjf-en 总开关默认 0→1（用户点名「梦角自由造句…需要默认打开」）——
    // 原 #317 的默认关是「可自由选择开关」的初版取舍，本轮翻案：装上即生效。旧默认 '0'
    // 会随「保存设置」按钮全量写盘，仅翻 DEFAULTS 对已写盘设备不生效，故由 migrateMjfOn
    // 按标记键 reply-mjf-on-migrated 一次性把存量的 '0' 收成 '1'（标记式而非值式，
    // 原因见该函数注释）
    // FIX 2026-09-15 #513 梦角自由造句总开关默认 0→1（用户点名「需要默认打开」）+ 存量 '0' 收口
    'mjf-en': 1, 'mjf-prob': 20, 'mjf-style': 1,
    // v3.41.x #413：梦角自由造句语料来源三选（默认全开=可用全部字卡）+ 各源权重（%）——
    // mjf-src-cc 自定义聊天字卡（原唯一语料）/ mjf-src-def 默认聊天字卡 / mjf-src-dict 词典；
    // 权重按归一化抽源（默认 50/25/25），权重 0 或开关关=该源不参与；三源全关=不触发
    'mjf-src-cc': 1, 'mjf-src-def': 1, 'mjf-src-dict': 1,
    'mjf-w-cc': 50, 'mjf-w-def': 25, 'mjf-w-dict': 25,
    // v3.41.x #414：mjf-mix 混合模式——开启后每次造句在 0 语气词式/1 撤回式/
    // 2 换字卡内容式三种手法里随机掷一个再出招，不再固定 mjf-style 单一风格
    // v3.26.x #513：默认 0→1（与 mjf-en 同批：用户点名「梦角自由造句的混合模式…需要默认
    // 打开」），存量 '0' 同由 migrateMjfOn 一次性收成 '1'
    // FIX 2026-09-15 #513 混合模式默认 0→1（同批：用户点名「混合模式需要默认打开」）
    'mjf-mix': 1,
    // FIX 2026-09-21 #953：mjf-punct 造句句尾标点开关（默认 1＝开，与 #953 上线行为一致）——
    // 用户直派「梦角自由造句使用标点符号也可以修改或关闭」：1＝出句统一补句尾标点；
    // 0＝完全不补（回到 #317 原味：截断式造句句尾无标点）。标点内容本身可改，见
    // reply-mjf-punct-pool（非数值键，随 getCfg/replyCfgFor 附带原串，dream-free.js 消费）
    'mjf-punct': 1,
    // v3.33.x #364：mjf-pub 造句存公用库概率（%，默认 80）——新句按此概率进公用库、
    // 其余进当前联系人专属库；0=全专属、100=全公用。
    // FIX 2026-09-16 #622：原实现只在多联系人时生效（单联系人固定进专属，用户点名要能自己调），
    // 现单联系人也认本设置，dream-free.js 消费
    'mjf-pub': 80,
    // v3.28.x #329：mjf-style 造句手法三选一（默认 1=撤回式）——0=语气词式（截词补语气词/
    // 句尾加语气后缀等五手法）；1=撤回式截断（词边界切尾、前缀成新句）；2=换字卡内容式
    // （截词/句尾补「别的字卡」的词）
    // v3.6.x：主动发送默认概率 10% 太低（每 5~10 分钟才掷一次），
    // 默认设置下第一条主动消息平均要约 75 分钟才来，用户会以为 TA 从不主动发消息；
    // 提到 30%（与信箱写信概率默认一致），平均约 25 分钟一条
    'as-en': 1, 'as-prob': 30, 'as-min': 5, 'as-max': 10,
    'as-count-min': 1, 'as-count-max': 2, 'dnd-en': 0,
    // v3.6.x：主动发送爱心标识——联系人主动找你的消息气泡左上角小爱心，默认开
    // v3.55.x #727：用户直派「联系人主动发送的消息，现在是小爱心的标识，帮我新增，可以用别的
    // 标识和自定义标识」——as-badge 仍是「标识总开关」（0＝不显示任何标识，原行为不变）；
    // 标识本体由 as-badge-heart / as-badge-* 池 + 自定义（reply-as-badge-custom）决定：
    //   · 内置五枚（爱心 ♥ / 星星 ★ / 月亮 ☾ / 闪光 ✦ / 小爪 🐾）挂在 JS 里渲染，
    //     只能开关、不能删（同 #712 口径）；
    //   · 内置枚默认只开「爱心」＝未写盘设备显示效果与改造前完全一致；
    //   · 池全关时兜底回爱心（渲染侧兜底，不靠设置页拦截——标识与符号不同，
    //     「不显示任何标识」由上方 as-badge 总开关表达，池全关没有独立语义）。
    'as-badge-heart': 1,
    // #856 根因修（#727 遗留）：总开关 as-badge 必须进 DEFAULTS。getCfg 只遍历 DEFAULTS 的键，
    // 缺席时 replyCfg()['as-badge'] 恒 undefined → 设置页开关初值恒显「关」、#asb-rand-row 永不出现、
    // chips 恒带 .dis，而渲染侧 chat.js 的 cfgn(c,'as-badge',1) 恒为 1（＝关不掉）。默认 1＝与改造前观感一致。
    'as-badge': 1,
    // v3.55.x #727：内置星星/月亮/闪光/小爪（默认关，点亮才参与随机抽取）
    'as-badge-star': 0, 'as-badge-moon': 0, 'as-badge-spark': 0, 'as-badge-paw': 0,
    // v3.55.x #727：多枚点亮时的抽取方式——1＝每次从池里随机抽一枚（默认），
    // 0＝按固定顺序轮换（同一条消息的标识稳定、整个池轮着用）
    'as-badge-rand': 1,
    // 二传修饰：TA 状态行轮换概率（%，默认 50）——聊天顶栏名字下方状态字卡的自动切换概率。
    // 状态切换有 60 分钟最小冷却，到冷却后按此概率决定是否换一条（未命中＝保持当前、再等下一轮）；
    // 0＝永不自动换，100＝每次到冷却必换。按联系人桌面独立保存（消费在 chat.js pickPartnerStatus）。
    'st-rot-prob': 50,
    // v3.9.x：联系人主动邀请（聊天页触发）——TA 主动找你的消息按概率变成
    // 猜拳/游戏邀请（游戏在 Pong/贪吃蛇中随机），命中后打开对应半框取代普通消息；
    // 概率默认低于普通主动消息，避免邀请过于频繁
    // v3.9.x：再降默认概率（15%/10% → 8%/5%）——用户反馈邀请太频繁，降一半
    // v3.14.x：贴贴邀请（cuddle）独立门——正常情侣贴贴互动，同意后 TA 回应一句；
    // 默认开 5%（与游戏门同档），话术在字卡库「TA的邀请」贴贴分类逐句开关
    'ai-rps-en': 1, 'ai-rps-prob': 8, 'ai-game-en': 1, 'ai-game-prob': 5,
    'ai-cuddle-en': 1, 'ai-cuddle-prob': 5,
    // v3.15.x：TA 主动分享用户自建字卡——从字卡库（含公用）抽一张纯文本卡当 TA 的
    // 悄悄话发出来；默认开 4%（低于其他邀请门，避免频繁占用「主动消息」观感），
    // 池过滤与冷却见 ta-ask.js maybeTriggerTACC
    'ai-cc-en': 1, 'ai-cc-prob': 4,
    // v3.29.x #807：红包领后捎一句话——红包被领取后（我领 TA 的红包 / TA 领我的红包）
    // TA 按概率主动捎一条消息：rp-thx-en 总开关（默认开）、rp-thx-prob 概率 %（默认 60）。
    // 固定只发一条、不经回复管线＝不受「回复条数最多」限制；消费在 chat.js rpCollectFeedback，
    // 设置行由本文件动态注入回复设置「其他」面板「红包互动」组（模板在途，同 #791 注入口径）。
    // rp-thx-mode＝捎话内容来源：0=只用系统预设话术池、1=和正常聊天一样回复（单卡生成）、
    // 2=混合（默认 2＝保持 #807 上线以来的行为：六成预设 + 四成聊天式）
    'rp-thx-en': 1, 'rp-thx-prob': 60, 'rp-thx-mode': 2,
    // v3.9.x：TA 主动查岗——主动发送轮里 TA 按概率来查你的岗（查岗问题卡进聊天，
    // 概率自动弹回答弹窗，作答后 TA 回应）；冷却默认 30 分钟防高概率连查
    // v3.12.x：默认概率 15% → 8%——用户反馈互动卡片整体太频繁（询问/小问题/好奇/吐槽同步降半）
    // v3.13.x：互动卡整体降频第二轮——五类卡加全局闸门（任一卡发出后 60 分钟内其余类型不再自动触发，
    // 见 ta-ask.js interactGateOk）+ 存量旧默认概率一次性迁移到 5%；本文件 ckq-prob 默认 8 保持不变，
    // ck-question.js 的兜底默认已从 15 对齐为 8
    // v3.20.x：跨桌面查岗默认概率 8% → 2%（用户要求降低，含把已写盘的旧值 8 一并迁移为 2，
    // 见文件尾的旧值迁移逻辑）
    'ckq-en': 1, 'ckq-prob': 2, 'ckq-popup-prob': 70, 'ckq-cool': 30,
    // v3.20.x：跨桌面来电独立概率（reply-desk-call-prob，随联系人隔离；跨桌面来电与
    // 跨桌面查岗对齐：默认 2% + 独立 30 分钟冷却，触发逻辑在 incoming-requests.js）
    'desk-call-prob': 2,
    // 信箱（星言信箱设置）
    // v3.5.99：最长写信/回信时间默认 480 → 120 分钟（曾担心 8 小时太久，用户误以为 TA 不写信）；
    // v3.27.x：用户反馈默认写信/回信节奏太快，恢复为 480 分钟（8 小时，与原设计一致）
    'ml-min-cards': 20, 'ml-max-cards': 50,
    'ml-write-prob': 30, 'ml-write-min': 1, 'ml-write-max': 480,
    // v3.6.x：每天最多来信（封）——限制联系人主动写信频率，默认 3 封/天
    'ml-write-daily-max': 3,
    // #296：联系人主动写信总开关（默认开）——关闭后 TA 不再主动来信；
    // 写信概率走 mailCfg 的 prob() 兜底（0 会回退默认 30），所以「关闭」必须用独立开关
    'ml-write-en': 1,
    'ml-reply-prob': 80, 'ml-reply-min': 1, 'ml-reply-max': 480,
    'ml-kaomoji-en': 1, 'ml-emoji-en': 1, 'ml-sticker-en': 1,
    // #645：每周摸鱼小结寄信开关（默认开）——关闭后 TA 不再寄「本周摸鱼小结」（含周一~周三补发窗口）
    'ml-fish-week-en': 1,
    // #1198：信件「拼接随机标点」（默认关＝一封信里各张字卡仍用空格相连）——开则信件正文的每两条
    // 字卡中间从聊天那套「拼接符号」池随机抽一个（含「换行」）。消费在 mail.js taLetterContent
    'ml-punct-en': 0,
    // 动态（星言朋友圈设置）
    'fd-like-prob': 60, 'fd-like-speed-min': 1, 'fd-like-speed-max': 60,
    'fd-comment-prob': 70, 'fd-comment-speed-min': 1, 'fd-comment-speed-max': 60,
    'fd-reply-prob': 60, 'fd-reply-speed-min': 1, 'fd-reply-speed-max': 60,
    'fd-likeback-prob': 50,
    'fd-card-prob': 80, 'fd-max-cards': 5, 'fd-image-prob': 50,
    'fd-post-prob': 40, 'fd-post-daily-max': 5, 'fd-post-cool': 30,
    // #296：联系人主动发朋友圈总开关（默认开）——关闭后 TA 不再自动发动态
    'fd-post-en': 1,
    'fd-min-interval': 1, 'fd-max-interval': 720,
    'fd-min-cards-post': 4, 'fd-max-cards-post': 15,
    'fd-post-kaomoji': 10, 'fd-post-emoji': 10, 'fd-post-sticker': 30, 'fd-post-image': 30,
    // #534：朋友圈内容类型总开关（与信箱「写信内容类型」ml-*-en 同款语义，默认全开）——
    //   关闭后该类型在朋友圈整体不出现：TA 发动态与 TA 评论/回复都受它管，不论上方概率
    //   设多少。修前「TA 发布内容类型」概率只管得住动态，评论/回复的颜文字/emoji 是写死
    //   15%，用户设了「把颜文字和表情包都禁了」评论里照样出现。
    'fd-kaomoji-en': 1, 'fd-emoji-en': 1, 'fd-sticker-en': 1, 'fd-image-en': 1,
    // #1198：朋友圈「拼接随机标点」（默认关＝评论/回复与 TA 动态里的各张字卡仍用空格相连）——开则
    // 每两条字卡中间从聊天那套「拼接符号」池随机抽一个（含「换行」，媒体卡两侧仍固定空格防图裂）。
    // 消费在 feed.js genMixedCards（评论/回复）・genPostContent（TA 发动态）
    'fd-punct-en': 0,
    // 通话（星言通话设置）
    // v3.6.x：对方挂断默认 5% → 2%——挂断检查已放宽为「接通满 3 分钟后每 60 秒掷一次」：
    // 原 5% + 每 30 秒掷一次的实际效果远超设置字面值（3 分钟累计 ~23%、10 分钟累计 ~62%），
    // 用户反馈「3 分钟左右自动挂断、没一通超过 10 分钟」；2% + 3 分钟保护 + 60 秒周期后
    // 10 分钟累计约 13%，通话时长大幅改善
    // v3.6.x：来电默认 8% → 15%——原来只靠独立定时器每 60 秒掷一次、首次检查还延迟 2-5 分钟，
    // 默认设置下用户会以为 TA 从不来电；已改为「TA 回复/主动发消息后按概率来电」+ 定时器兜底
    'call-incoming': 15, 'call-pickup': 70, 'call-busy': 15, 'call-reject': 15, 'call-hangup': 2,
    // v3.26.x：刷新后恢复通话——开启后接通中刷新页面，通话面板+计时从接通时刻继续；关闭则记为中断
    'call-resume': 1,
    // v3.26.x #200：禁止联系人挂断电话总开关（默认关）——开启后通话中对方永不主动挂断，
    // 兜住「挂断几率为 0 仍被挂断」（该设置按联系人桌面隔离，未保存过键的联系人回落 2% 默认）
    'call-no-hangup': 0,
    // v3.7.x：让对方继续说——cs-normal(0=理解回复快速回1条, 1=按正常回复时间设置)；
    // cs-trigger-name(顶部昵称触发) / cs-trigger-bar(底部聊天栏按钮触发)，两个独立开关可同时开
    'cs-normal': 0, 'cs-trigger-name': 1, 'cs-trigger-bar': 0,
    // v3.26.x：桌面摸鱼小组件数值累计总开关（默认开）——fish-en 摸鱼值 / work-en 工作值。
    // 闸门加在 personalize.js 的 addFish/addWork 入口：关闭后所有加分来源（60 秒自动累计、
    // 点击摸鱼按钮、番茄钟补偿摸鱼、抓包奖励翻倍）都不再写入，已有数值保留只停止增长
    'fish-en': 1, 'work-en': 1,
    // #791 摸鱼抓包浮字总开关（默认开）——TA 摸鱼值上涨时桌面飘「摸鱼浮字／点我抓包」；
    // 关＝不飘字不抓包（也不吃抓包的冷却与每日额度），摸鱼值累计本身由 fish-en 管，互不影响
    'fish-grab-en': 1,
    // v3.9.x：群聊回复设置（群聊页全局生效，不随桌面隔离）——键前缀 gc-，
    // 存储在全局命名空间 xy-home-v2:reply-gc-*（见 getCfg 的全局读取分支），
    // 默认值：每个联系人回复概率 60%、回复速度 1~40 秒、回复条数 1~2、
    // 拍一拍 5%、表情包 10%、emoji 5%、图片 5%、语音 10%、颜文字附加 5%、引用 30%、
    // 撤回 25%、撤回补发 35%；多字卡回复触发概率 50%、最少 2 条、最多 5 条
    'gc-prob': 60, 'gc-rs-min': 1, 'gc-rs-max': 40,
    // #1376：群聊的并轮开关——群聊设置本来就是全局（gcRead/gcWrite 走 xy-home-v2），
    // 所以这一枚也全局存；若让它去读按联系人存的 turn-en，群聊会不会并轮就跟着「你最后用的那位联系人」变
    'gc-turn-en': 0,
    'gc-reply-min': 1, 'gc-reply-max': 2,
    'gc-cs-normal': 0, 'gc-cs-trigger-name': 1, 'gc-cs-trigger-bar': 0,
    'gc-touch-prob': 5, 'gc-sticker-prob': 10, 'gc-emoji-prob': 5, 'gc-image-prob': 5, 'gc-voice-prob': 10,
    'gc-kaomoji-prob': 5, 'gc-quote-prob': 30, 'gc-rc-prob': 25, 'gc-rc-refix': 35,
    'gc-py-en': 1, 'gc-py-prob': 50, 'gc-py-min': 2, 'gc-py-max': 5
  };

  // v3.9.x：群聊回复设置存全局命名空间（群聊页/群聊回复是全局功能，不随联系人桌面隔离）——
  // 读写走 xyStore('xy-home-v2')，其余 gc-* 键回退到当前桌面存储读取（兼容旧数据）
  function gcRead(k) {
    try {
      const g = window.xyStore('xy-home-v2').get('reply-gc-' + k);
      if (g !== null && g !== undefined && g !== '') return g;
    } catch (e) {}
    try { return ls.get('reply-gc-' + k); } catch (e) { return null; }
  }
  function gcWrite(k, v) {
    try { window.xyStore('xy-home-v2').set('reply-gc-' + k, String(v)); } catch (e) {}
  }

  // #1451 拼字张数一族的原始读数：缺键／空串／坏值一律算「没单独设过」（null），不与 0 混——
  //   0 是合法输入吗？不是（张数下限 1），但这里仍只认「有没有这枚键」，把区间解释留给 spellPairFrom
  function rawNumFrom(store, k) {
    try {
      const v = store ? store.get(k) : null;
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return isFinite(n) ? n : null;
    } catch (e) { return null; }
  }
  // #1451 拼字每次几张的【唯一生效算式】：设过自己的用自己的，没设过跟随「最少/最多条数」（＝改造前
  //   行为）；返回的 min/max 永远有序（抽卡侧 quote-spell.js 拿到的是这同一份数，不再各自 clamp 一遍，
  //   免得「最少 8／最多 2」在拼字里被抬成恒 8、在多字卡回复里却发 6，两路口径打架）
  function spellPairFrom(store, out) {
    const ownMin = rawNumFrom(store, 'reply-qs-min');
    const ownMax = rawNumFrom(store, 'reply-qs-max');
    const baseMin = Math.max(1, Math.min(10, Number(out['py-min']) || 2));
    const baseMax = Math.max(baseMin, Math.min(10, Number(out['py-max']) || 5));
    let mn = ownMin === null ? baseMin : Math.max(1, Math.min(10, ownMin));
    let mx = ownMax === null ? baseMax : Math.max(1, Math.min(10, ownMax));
    if (mx < mn) mx = mn;   // 只设过一枚、而另一枚的跟随值比它更小时：把跟随那枚抬上来，区间不许倒挂
    return { min: mn, max: mx, own: (ownMin !== null && ownMax !== null) ? 1 : 0, rawMin: ownMin, rawMax: ownMax };
  }

  function getCfg() {
    const out = {};
    Object.keys(DEFAULTS).forEach(k => {
      // v3.9.x：群聊设置（gc- 前缀）读全局命名空间，其余按当前桌面读
      const v = k.indexOf('gc-') === 0 ? gcRead(k) : ls.get('reply-' + k);
      // v3.6.x：对异常/损坏的存储值兜底——某些操作可能把 NaN 或非数字写进本地
      //（如摩托罗拉 Edge 上信箱「最短写信时间」显示 NaN 且 ± 按钮失效），
      // Number() 后 isNaN 一律回退默认值，并顺手修复坏数据，避免 NaN 传染
      let n = (v === null || v === undefined || v === '') ? DEFAULTS[k] : Number(v);
      if (isNaN(n)) {
        n = DEFAULTS[k];
        try { if (k.indexOf('gc-') === 0) gcWrite(k, String(n)); else ls.set('reply-' + k, String(n)); } catch (e) {}
      }
      out[k] = n;
    });
    // #1451 拼字张数一对（reply-qs-min／reply-qs-max）——**故意不进 DEFAULTS**：老存档没有这两枚，
    //   进了 DEFAULTS 就等于给每台设备凭空写上 2/5，把用户已经调好的「最少/最多条数」静默打回 2~5
    //   （同 #712「DEFAULTS 的数字兜底会写坏非数值键」那族的反面：这里会被兜底凭空造出来）。
    //   口径＝缺键跟随 py-min/py-max（＝改造前行为一字不变），动过才是独立的一对；生效值在这里一次
    //   算清，设置页、体检（card-audit.js）、抽卡（quote-spell.js）三处都读 cfg 里这同一份数——
    //   从前体检自己拿裸键去读，读到的永远是默认值（用户所报「我设的 2~5，可它一直发 5 张」查不下去）。
    const spPair = spellPairFrom(ls, out);
    out['qs-min'] = spPair.min;
    out['qs-max'] = spPair.max;
    out['qs-pair-own'] = spPair.own;
    // #712 自定义拼接符号——非数值键，故意不进 DEFAULTS：上面循环的数字兜底会把数组/
    // JSON 串改写成默认值，saveAllContactsDo 按 DEFAULTS 全键 String() 同步也会写坏；
    // 这里只把存储原串随 cfg 附带出去（pyJoinCards 按 JSON [{s,on}] 解析，只取 on=1）
    try { out['py-punct-custom'] = String(ls.get('reply-py-punct-custom') || '[]'); } catch (e) { out['py-punct-custom'] = '[]'; }
    // #727 同口径：自定义「主动发送标识」原串附带（chat.js 渲染侧按 JSON [{s,on}] 解析）
    try { out['as-badge-custom'] = String(ls.get('reply-as-badge-custom') || '[]'); } catch (e) { out['as-badge-custom'] = '[]'; }
    // FIX 2026-09-21 #953 同口径：造句句尾标点池原串附带（dream-free.js endPunctPool 解析；
    // 空＝用内置默认池。故意不进 DEFAULTS：数字兜底会把标点串 Number() 成 NaN）
    try { out['mjf-punct-pool'] = String(ls.get('reply-mjf-punct-pool') || ''); } catch (e) { out['mjf-punct-pool'] = ''; }
    // FIX 2026-09-29 #1396 同口径：造句「可用标点」chips 池整串附带（reply-mjf-punct-set＝JSON
    // [{s,on}]；非数值键故不进 DEFAULTS，理由同上面 #712 那段）。空＝dream-free.js 端仍走上面
    // 那条 #953 旧链（＝存量设备出句分布一字不变）
    try { out['mjf-punct-set'] = String(ls.get('reply-mjf-punct-set') || ''); } catch (e) { out['mjf-punct-set'] = ''; }
    return out;
  }
  window.replyCfg = getCfg;
  // v3.17.x：跨桌面「来消息」用——读取【指定联系人桌面】的回复设置（非当前桌面）。
  // getCfg 用 activeStore() 读当前激活桌面，这里改用 storeFor(cid)；gc-* 群聊设置
  // 仍是全局（与 getCfg 同）。供 incoming-requests.js 按各桌面自己的开关/概率/冷却调度。
  window.replyCfgFor = function (cid) {
    const out = {};
    let s = null;
    try { s = (cid && window.storeForCid) ? window.storeForCid(cid) : (cid && window.storeFor) ? window.storeFor(cid) : ls; } catch (e) { s = ls; }
    Object.keys(DEFAULTS).forEach(k => {
      const v = k.indexOf('gc-') === 0 ? gcRead(k) : (s ? s.get('reply-' + k) : null);
      let n = (v === null || v === undefined || v === '') ? DEFAULTS[k] : Number(v);
      if (isNaN(n)) n = DEFAULTS[k];
      out[k] = n;
    });
    // #712 同 getCfg：自定义拼接符号原串附带（按目标联系人桌面读，join 侧消费）
    try { out['py-punct-custom'] = String((s || ls).get('reply-py-punct-custom') || '[]'); } catch (e) { out['py-punct-custom'] = '[]'; }
    // #727 同 getCfg：自定义主动发送标识原串（按目标联系人桌面读）
    try { out['as-badge-custom'] = String((s || ls).get('reply-as-badge-custom') || '[]'); } catch (e) { out['as-badge-custom'] = '[]'; }
    // FIX 2026-09-21 #953 同 getCfg：造句句尾标点池原串（按目标联系人桌面读，跨桌面回复同样认自己桌面的池）
    try { out['mjf-punct-pool'] = String((s || ls).get('reply-mjf-punct-pool') || ''); } catch (e) { out['mjf-punct-pool'] = ''; }
    // FIX 2026-09-29 #1396 同 getCfg：造句可用标点 chips 池整串（按目标联系人桌面读，跨桌面回复同样认自己桌面的池）
    try { out['mjf-punct-set'] = String((s || ls).get('reply-mjf-punct-set') || ''); } catch (e) { out['mjf-punct-set'] = ''; }
    // #1451 同 getCfg：拼字张数一对按【目标桌面】的存储算生效值——跨桌面来消息/回话同样认自己那台的数，
    //   不许「设置页显示的是这一台的、发出来是那一台的区间」
    const spPair2 = spellPairFrom(s || ls, out);
    out['qs-min'] = spPair2.min;
    out['qs-max'] = spPair2.max;
    out['qs-pair-own'] = spPair2.own;
    return out;
  };
  // v3.9.x：群聊页/群聊回复逻辑读取群聊回复设置（含默认值）
  window.groupChatCfg = function () {
    try {
      const c = getCfg();
      const out = {};
      Object.keys(DEFAULTS).forEach(k => { if (k.indexOf('gc-') === 0) out[k] = c[k]; });
      return out;
    } catch (e) { return {}; }
  };
  // ===== #1451 「最少／最多」成对收口 =====
  // 从前这三对 stepper 各写各的：谁都能把区间设成「最少=最多」（于是不再随机，恒定发 N 张），
  // 甚至倒挂成「最少 8／最多 2」——而抽卡侧为了不自爆，只能把「最多」静默抬平到「最少」，
  // 于是用户所见就是「我明明设的 2~5，可 TA 一直发 5 张」，界面上又没有任何一处报出当前真正的
  // 区间（体检那行还读错键、永远显示 2~5，见 card-audit.js）。用户 2026-09-29 选定口径：
  // **动「最少」→ 把「最多」抬到不小于它；动「最多」→ 把「最少」压到不大于它**，两行数字当场跟着走。
  const PAIR_SIB = { 'py-min': 'py-max', 'py-max': 'py-min',
    'qs-min': 'qs-max', 'qs-max': 'qs-min',
    'gc-py-min': 'gc-py-max', 'gc-py-max': 'gc-py-min' };
  const isMinSide = (k) => /-min$/.test(k);
  // 把某一枚的新值算成一对有序值并整对落盘（另一枚按当前【生效】值一起坐实——拼字那一对
  // 从此不再跟随「最少/最多条数」，这是动它的必然结果，也是设置页该行右侧要标出来的原因）
  function writePairedRange(k, v) {
    const sib = PAIR_SIB[k];
    if (!sib) return false;
    const gc = k.indexOf('gc-') === 0;
    const n = Math.round(Number(v));
    if (!isFinite(n)) return false;
    const base = getCfg();
    const other = Math.round(Number(base[sib]));
    let lo = isMinSide(k) ? n : (isFinite(other) ? other : n);
    let hi = isMinSide(k) ? (isFinite(other) ? other : n) : n;
    if (hi < lo) { if (isMinSide(k)) hi = lo; else lo = hi; }   // 谁动收谁的对家
    lo = Math.max(1, Math.min(10, lo));
    hi = Math.max(lo, Math.min(10, hi));
    const minK = isMinSide(k) ? k : sib, maxK = isMinSide(k) ? sib : k;
    if (gc) { gcWrite(minK, lo); gcWrite(maxK, hi); }
    else { ls.set('reply-' + minK, String(lo)); ls.set('reply-' + maxK, String(hi)); }
    // 对家那一格必须立刻跟着动，否则「设了却看不见」原地复发
    [minK, maxK].forEach(refreshStepperVal);
    syncSpellPairReadout();
    return true;
  }
  // #1451 读数行：把「抽卡侧真正取用的区间」原样摆出来（设置页显示＝实际出牌，读的是同一份
  // getCfg 生效值）。跟随/单设、恒 N 张（最少＝最多）都在这行说清——报「我设的 2~5 可它一直
  // 发 5 张」先看这里：若写着「跟随」而条数那对已是 5~5，病根就在条数那对，不用再猜。
  function syncSpellPairReadout() {
    const el = document.getElementById('qs-range-readout');
    if (!el) return;
    try {
      const c = getCfg();
      const mn = Number(c['qs-min']), mx = Number(c['qs-max']);
      if (!isFinite(mn) || !isFinite(mx)) { el.textContent = ''; return; }
      let s = '每次拼字：现在 ' + mn + '~' + mx + ' 张';
      if (mn === mx) s += '（最少＝最多，命中拼字时固定 ' + mx + ' 张、不再随机）';
      s += Number(c['qs-pair-own']) === 1 ? '（本组单设）' : '（跟随上方「多字卡回复」的最少/最多条数；动本组任一格即单独设定）';
      el.textContent = s;
    } catch (e) {}
  }
  // 单行回显（与 syncUI 同规格：手机端只写 input.stp-val，转换器把值转给可见的 ce-box；
  // 直接写 .stp-val 会命中 ce-box DIV 的 expando，屏幕上根本不变——见上面 syncUI 那段注释）
  function refreshStepperVal(k) {
    document.querySelectorAll('#page-reply-settings .stepper, #page-chat-settings .stepper, #group-chat-settings .stepper').forEach(st => {
      if (st.dataset.k !== k) return;
      const val = st.querySelector('input.stp-val');
      if (!val) return;
      const v = getCfg()[k];
      val.value = String(v);
      val.setAttribute('value', String(v));
    });
  }
  // #1511：本会话真实动过的设置键（直接点开关/步进/胶囊＝屏面即用户意图）。
  // 「保存设置」整包写回时「动过的照常写、没动过的要过读数闸」全靠这本账（见 replyKeyUnvouched）。
  const sessionSavedKeys = new Set();
  window.saveReplyCfg = function (k, v) {
    try { sessionSavedKeys.add(k); } catch (e0) {}
    if (k.indexOf('gc-') === 0) {
      if (PAIR_SIB[k]) writePairedRange(k, v); else gcWrite(k, v);
      if (k.indexOf('gc-cs-') === 0) document.dispatchEvent(new Event('gc-continue-say-changed'));
      return;
    }
    if (PAIR_SIB[k]) {
      writePairedRange(k, v);
    } else {
      ls.set('reply-' + k, String(v));
    }
    // v3.7.x：主动发送相关设置保存后立即重排定时器——原实现挂起的旧定时器
    // 不重排，改了间隔/概率要等下一轮（最长几小时）才生效
    if (k === 'as-en' || k === 'as-prob' || k === 'as-min' || k === 'as-max' ||
        k === 'as-count-min' || k === 'as-count-max' || k === 'dnd-en') {
      try { if (window.rescheduleAutoSend) window.rescheduleAutoSend(); } catch (e) {}
    }
  };

  // ---- 设置页 UI ----
  function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const el = document.getElementById(id);
    if (el) el.hidden = false;
  }

  const gcContinuePanel = document.querySelector('#page-reply-settings [data-rpanel="group"]');
  if (gcContinuePanel && !document.getElementById('gc-cs-normal')) {
    const section = document.createElement('div');
    section.id = 'gc-continue-settings';
    section.innerHTML = '<div class="gs-title">让对方继续说</div><div class="set-group glass">' +
      '<div class="gs-row"><span>按正常回复时间</span><label class="toggle"><input type="checkbox" id="gc-cs-normal"><span class="tk"></span></label></div>' +
      '<div class="gs-sub">未开启时，点击后联系人立即回复</div>' +
      '<div class="gs-row"><span>点顶部昵称触发</span><label class="toggle"><input type="checkbox" id="gc-cs-trigger-name"><span class="tk"></span></label></div>' +
      '<div class="gs-row"><span>底部聊天栏按钮触发</span><label class="toggle"><input type="checkbox" id="gc-cs-trigger-bar"><span class="tk"></span></label></div>' +
      '<div class="gs-sub">点顶部昵称（群名）/底部按钮会触发新一轮回复，条数仍按上面设置抽取，会叠在正常回复之外；顶部已无独立的继续说按钮（与单聊同口径，只看这两枚开关），开启昵称触发后，切换群聊请用右上角菜单的「切换群聊」。</div></div>';
    gcContinuePanel.insertBefore(section, gcContinuePanel.lastElementChild);
  }

  // #791 摸鱼抓包浮字开关行——模板在途（并行会话占用 template.html），照 #577/群聊「让对方继续说」
  // 的 JS 注入同构：挂进「摸鱼值 / 工作值」组（work-en 行后），id=fish-grab-en 走下方通用开关绑定
  if (!document.getElementById('fish-grab-en')) {
    const workRow = document.getElementById('work-en');
    const fishGroup = workRow ? workRow.closest('.set-group') : null;
    if (fishGroup) {
      fishGroup.insertAdjacentHTML('beforeend',
        '<div class="gs-row"><span>摸鱼抓包浮字</span><label class="toggle"><input type="checkbox" id="fish-grab-en"><span class="tk"></span></label></div>' +
        '<div class="gs-sub">开启后 TA 摸鱼值上涨时桌面会飘「摸鱼浮字」，6 秒内点「点我抓包」会结算 TA 自上次被抓以来涨的全部摸鱼值（TA 补一份总账、你得同额）＋TA 害羞回应；关闭后不再飘字、也没有抓包（摸鱼值本身照常累计），冷却与每日次数照旧不消耗</div>');
    }
  }

  // v3.29.x #807：「红包互动」设置组（红包领后捎一句话）——模板在途，同上 JS 注入：
  // 挂进「其他」面板尾部；注入必须在本文件下方开关同步/绑定与 stepper 通用绑定之前，
  // id=rp-thx-en 走通用开关绑定、data-k=rp-thx-prob 走通用 stepper 绑定，无需单独特写；
  // rp-thx-mode 三档非布尔开关，本块自带 pills 弹窗绑定（与红包半框设置同一套键、同源同步）
  const RP_THX_MODES = [{ label: '系统预设话术', value: 0 }, { label: '像正常聊天一样回复', value: 1 }, { label: '混合', value: 2 }];
  window.rpThxModeList = RP_THX_MODES;
  window.rpThxModeLabel = function (v) {
    const n = Number(v);
    for (let i = 0; i < RP_THX_MODES.length; i++) { if (RP_THX_MODES[i].value === n) return RP_THX_MODES[i].label; }
    return '混合';
  };
  window.rpThxModeSync = function () {
    const el = document.getElementById('rp-thx-mode-btn');
    if (!el) return;
    let v = 2;
    try { v = Number((window.replyCfg && window.replyCfg())['rp-thx-mode']); } catch (e) {}
    if (v !== 0 && v !== 1) v = 2;
    el.textContent = window.rpThxModeLabel(v);
    el.dataset.v = String(v);
  };
  if (!document.getElementById('rp-thx-en')) {
    const rpThxPanel = document.querySelector('#page-reply-settings [data-rpanel="other"]');
    if (rpThxPanel) {
      const rpThxSec = document.createElement('div');
      rpThxSec.id = 'rp-thx-settings';
      rpThxSec.innerHTML = '<div class="gs-title" style="margin-top:10px">红包互动</div>' +
        '<div class="set-group glass">' +
        '<div class="gs-row"><span>红包领后捎一句话</span><label class="toggle"><input type="checkbox" id="rp-thx-en"><span class="tk"></span></label></div>' +
        '<div class="gs-row"><span>捎话概率</span><div class="stepper" data-k="rp-thx-prob" data-min="0" data-max="100" data-step="5"><button class="stp-min">−</button><input class="stp-val" id="rp-thx-prob-val" readonly><button class="stp-max">+</button></div></div>' +
        '<div class="gs-row"><span>捎话内容</span><div class="gs-pick" id="rp-thx-mode-btn" data-v="2">混合</div></div>' +
        '</div>' +
        '<div class="gs-sub" style="padding:0 14px 14px">我领取 TA 发的红包、或 TA 领取我发的红包后，TA 有概率主动捎来一句话（默认开，概率 60%）。这句话固定只发一条、不受「回复条数最多」限制，也不占正常回复的名额；「捎话内容」三档＝只用系统预设话术 / 和正常聊天一样回复（走字卡与词典管线）/ 混合（约六成预设、四成聊天式）；各联系人独立保存，总开关关闭后两个方向都不再触发</div>';
      rpThxPanel.appendChild(rpThxSec);
      const rpThxModeBtn = document.getElementById('rp-thx-mode-btn');
      if (rpThxModeBtn && window.openModal) {
        rpThxModeBtn.addEventListener('click', () => {
          window.openModal('红包领后捎话的内容', '', (v) => {
            const n = Number(v);
            if (n !== 0 && n !== 1 && n !== 2) return;
            window.saveReplyCfg('rp-thx-mode', n);
            window.rpThxModeSync();
            try { toastReply('已设置：捎话内容＝' + window.rpThxModeLabel(n)); } catch (e) {}
          }, { noInput: true, pill: rpThxModeBtn.dataset.v || '2', pills: RP_THX_MODES.map(m => ({ label: m.label, value: String(m.value) })) });
        });
      }
      document.addEventListener('contact-switched', window.rpThxModeSync);
      window.rpThxModeSync();
    }
  }

  function syncUI() {
    const cfg = getCfg();
    // stepper 数值
    document.querySelectorAll('#page-reply-settings .stepper, #page-call-settings .stepper').forEach(st => {
      const k = st.dataset.k;
      if (!k) return; // #518：分类档自定义行无 data-k，由本文件 #518 段自行绑定，这里跳过防写 undefined
      // v3.6.x：固定选 input——转换后页面里 .stp-val 会先匹配到 ce-box(DIV，继承了
      // stp-val 类)，给 DIV 写 value 只产生 expando/attribute 不影响显示，还会污染
      // 后续运行时查询（保存按钮读到过期值）。input.stp-val 走 value 代理始终读写
      // ce-box 的当前文本。
      const val = st.querySelector('input.stp-val');
      if (val) {
        const step = parseFloat(st.dataset.step) || 1;
        const v = cfg[k] !== undefined ? cfg[k] : DEFAULTS[k];
        const str = step < 1 ? Number(v).toFixed(2) : v;
        val.value = str;
        // v3.6.x：手机端 ce-box 转换器（mobile-adapt.js）在定义 value 代理之后才
        // 读初始值做同步——只写 property 会被代理遮蔽读到空，转换后数字消失、
        // 只剩横线（Edge 反馈「回复设置数字不显示」）。同时写 attribute 让
        // 转换器 getAttribute('value') 能拿到初始值（桌面原生 input 双写无副作用）。
        val.setAttribute('value', str);
      }
    });
    // 开关
    ['py-en', 'py-punct-en', 'as-en', 'dnd-en', 'as-badge', 'as-badge-heart', 'as-badge-star', 'as-badge-moon', 'as-badge-spark', 'as-badge-paw', 'as-badge-rand', 'ml-kaomoji-en', 'ml-emoji-en', 'ml-sticker-en', 'cs-normal', 'cs-trigger-name', 'cs-trigger-bar', 'gc-cs-normal', 'gc-cs-trigger-name', 'gc-cs-trigger-bar', 'gc-py-en', 'ai-rps-en', 'ai-game-en', 'ai-cuddle-en', 'ai-cc-en', 'ckq-en', 'call-resume', 'call-no-hangup', 'ml-write-en', 'ml-fish-week-en', 'ml-punct-en', 'fd-post-en', 'fd-punct-en', 'fd-kaomoji-en', 'fd-emoji-en', 'fd-sticker-en', 'fd-image-en', 'qs-en', 'qs-cc', 'qs-one', 'qs-multi', 'qs-noLimit', 'mjf-en', 'mjf-src-cc', 'mjf-src-def', 'mjf-src-dict', 'mjf-mix', 'mjf-punct', 'rc-en', 'rl-en', 'fish-en', 'work-en', 'fish-grab-en', 'rp-thx-en', 'turn-en', 'gc-turn-en'].forEach(k => {
      const el = document.getElementById(k);
      if (el) el.checked = cfg[k] === 1;
    });
    // #807 捎话模式行（rp-thx-mode）非开关/stepper，走本文件注入块自带的同步助手
    try { if (window.rpThxModeSync) window.rpThxModeSync(); } catch (e) {}
    // #1451 拼字张数读数行（进页/重画时与两格数字同源刷新）
    syncSpellPairReadout();
  }

  // v3.33.x：来电概率（call-incoming）支持 0.01 粒度（可输入 0.05 等 0.0X 小数），
  // 保存时给出轻提示；用短防抖避免 ± 连点弹出一串 toast
  let callIncomingToastTimer = null;
  function toastCallIncoming(v) {
    clearTimeout(callIncomingToastTimer);
    callIncomingToastTimer = setTimeout(() => {
      try { toastReply('来电概率已保存：' + v + '%'); } catch (e) {}
    }, 250);
  }

  // stepper 交互
  document.querySelectorAll('#page-reply-settings .stepper, #page-call-settings .stepper').forEach(st => {
    const k = st.dataset.k;
    if (!k) return; // #518：分类档自定义行无 data-k，由本文件 #518 段绑定 ±，避免双绑与 reply-undefined 落盘
    // v3.6.x：data-min/max 缺失时兜底默认值，避免 NaN 写进存储（± 按钮失效、显示 NaN）
    const intAttr = (name, def) => { const v = parseInt(st.getAttribute(name), 10); return Number.isNaN(v) ? def : v; };
    const min = intAttr('data-min', 0);
    // v3.6.x：data-max 缺失 = 不设上限（回复速度最长可任意调大；其余 stepper 均显式写 data-max）
    const max = intAttr('data-max', Infinity);
    const step = parseFloat(st.dataset.step) || 1;
    const val = st.querySelector('.stp-val');
    const fmt = (v) => step < 1 ? v.toFixed(2) : v;
    st.querySelector('.stp-min').addEventListener('click', () => {
      const cur = parseFloat(val.value);
      const nv = Math.max(min, cur - step);
      val.value = fmt(nv); window.saveReplyCfg(k, val.value);
      if (k === 'call-incoming') toastCallIncoming(fmt(nv));
      else { try { const lb = st.closest('.gs-row') ? st.closest('.gs-row').querySelector('span') : null; if (lb) toastSaved(lb.textContent, true); } catch (e) {} }
    });
    st.querySelector('.stp-max').addEventListener('click', () => {
      const cur = parseFloat(val.value);
      const nv = Math.min(max, cur + step);
      val.value = fmt(nv); window.saveReplyCfg(k, val.value);
      if (k === 'call-incoming') toastCallIncoming(fmt(nv));
      else { try { const lb = st.closest('.gs-row') ? st.closest('.gs-row').querySelector('span') : null; if (lb) toastSaved(lb.textContent, true); } catch (e) {} }
    });
  });
  // v3.6.x：数值可直接点击输入——点击 stepper 数值框直接编辑数字，
  // 失焦后校验范围 + 按步长取整 + 保存（± 按钮仍可用）。
  // v3.5.138：改为被 mobile-adapt 转换器接管（contenteditable ce-box）——
  // 之前用「readonly + 点击解除」方案，解除后变成可聚焦的原生 input，
  // 手机 Chrome 对该 input 聚焦仍弹「自动填充」白条；ce-box 不是表单字段，
  // 可输入数字且不弹白条。移除 readonly 让转换器正常转换（非 iOS 手机端）。
  document.querySelectorAll('#page-reply-settings .stepper .stp-val, #page-call-settings .stepper .stp-val').forEach(val => {
    const st = val.closest('.stepper');
    if (!st) return;
    const k = st.dataset.k;
    if (!k) return;
    val.removeAttribute('readonly'); // 转换器跳过 readonly，须先移除
    val.setAttribute('inputmode', 'decimal'); // 手机上弹数字键盘（转换器复制到 ce-box）
    const intAttr = (name, def) => { const v = parseInt(st.getAttribute(name), 10); return Number.isNaN(v) ? def : v; };
    const min = intAttr('data-min', 0);
    // v3.6.x：data-max 缺失 = 不设上限（回复速度最长可任意调大；其余 stepper 均显式写 data-max）
    const max = intAttr('data-max', Infinity);
    const step = parseFloat(st.dataset.step) || 1;
    const fmt = (v) => step < 1 ? Number(v).toFixed(2) : String(Math.round(Number(v)));
    const selectAll = () => {
      // ce-box（contenteditable）全选；原生 input 用 select()
      try {
        const box = val.__ceBox;
        if (box) {
          const r = document.createRange();
          r.selectNodeContents(box);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        } else {
          val.select();
        }
      } catch (e) {}
    };
    val.addEventListener('click', function () {
      try { val.focus(); } catch (e) {} // ce-box 聚焦由转换器代理
      selectAll();
    });
    const commit = () => {
      let v = parseFloat(val.value);
      // v3.6.x：NaN/Infinity（防输入非数字或 Infinity 字符串污染存储）一律回退下限
      if (!isFinite(v)) v = min;
      v = Math.min(max, Math.max(min, v));
      if (step < 1) v = Math.round(v / step) * step;
      else v = Math.round(v);
      val.value = fmt(v);
      window.saveReplyCfg(k, val.value);
      if (k === 'call-incoming') toastCallIncoming(fmt(v));
      else { try { const lb = st.closest('.gs-row') ? st.closest('.gs-row').querySelector('span') : null; if (lb) toastSaved(lb.textContent, true); } catch (e) {} }
    };
    val.addEventListener('change', commit);
    val.addEventListener('blur', commit);
    // Enter 提交（contenteditable 单行 Enter 不换行，直接失焦保存）
    val.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        try { val.blur(); } catch (err) {}
      }
    });
  });
  // 开关交互
  // #351：所有开关变更后即时保存并 toast 反馈「已保存：开关名（开/关）」——用户反馈改了没提示
  const TOGGLE_NAMES = {
    'py-en': '多字卡回复', 'py-punct-en': '拼接随机标点', 'as-en': '主动发送', 'dnd-en': '免打扰', 'as-badge': '主动发送标识',
    'ml-kaomoji-en': '信箱颜文字', 'ml-emoji-en': '信箱emoji', 'ml-sticker-en': '信箱表情包',
    'cs-normal': '让对方继续说', 'cs-trigger-name': '昵称触发继续说', 'cs-trigger-bar': '聊天栏继续说按钮',
    'gc-cs-normal': '群聊继续说按正常回复时间', 'gc-cs-trigger-name': '群聊昵称触发继续说', 'gc-cs-trigger-bar': '群聊底部继续说按钮',
    'gc-py-en': '群聊多字卡回复', 'ai-rps-en': '猜拳邀请', 'ai-game-en': '游戏邀请', 'ai-cuddle-en': '贴贴邀请',
    'ai-cc-en': 'TA分享字卡', 'ckq-en': 'TA主动查岗', 'call-resume': '刷新恢复通话', 'call-no-hangup': '禁止联系人挂断',
    'ml-write-en': '联系人主动写信', 'fd-post-en': '联系人主动发朋友圈',
    'ml-punct-en': '信件拼接随机标点', 'fd-punct-en': '朋友圈拼接随机标点',
    'ml-fish-week-en': '摸鱼小结寄信',
    'fd-kaomoji-en': '朋友圈颜文字', 'fd-emoji-en': '朋友圈emoji', 'fd-sticker-en': '朋友圈表情包', 'fd-image-en': '朋友圈图片',
    'qs-en': '词典拼字', 'qs-cc': '混用自定义字卡', 'qs-one': '单气泡拼字', 'qs-multi': '多回复逐卡连发',
    'qs-noLimit': '逐卡连发不受条数限制', 'mjf-en': '梦角自由造句',
    'mjf-src-cc': '造句语料·自定义字卡', 'mjf-src-def': '造句语料·默认聊天字卡', 'mjf-src-dict': '造句语料·词典',
    'mjf-mix': '造句混合模式',
    'mjf-punct': '造句句尾标点',
    'rc-en': '撤回后补发消息',
    'rl-en': 'TA 消息限流',
    'turn-en': '连发的算一轮',
    'gc-turn-en': '连发的算一轮（群聊）',
    'fish-en': '摸鱼值累计', 'work-en': '工作值累计', 'fish-grab-en': '摸鱼抓包浮字',
    'rp-thx-en': '红包领后捎一句话'
  };
  // #388：cc-toast 元素全站懒创建（template.html 无静态元素，chat.js/device.js 等 20+ 文件
  //   都是「查不到就 createElement 补挂 body」）——本文件此前只查不建，用户直达回复设置页时
  //   元素不存在 → toastSaved 静默 return → 所有开关「已保存」提示永远不弹（用户实报）。
  //   补同款懒创建兜底，本文件全部 toast 出口统一走它。
  function ccToastEnsure() {
    let d = null;
    try {
      d = document.getElementById('cc-toast');
      if (!d) { d = document.createElement('div'); d.id = 'cc-toast'; document.body.appendChild(d); }
    } catch (e) { return null; }
    return d;
  }
  function toastSaved(label, on) {
    try {
      const d = ccToastEnsure();
      if (!d) return;
      d.textContent = '已保存：' + label + '（' + (on ? '开' : '关') + '）';
      d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show';
      clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, 1800);
    } catch (e) {}
  }
  ['py-en', 'py-punct-en', 'as-en', 'dnd-en', 'as-badge', 'ml-kaomoji-en', 'ml-emoji-en', 'ml-sticker-en', 'cs-normal', 'cs-trigger-name', 'cs-trigger-bar', 'gc-cs-normal', 'gc-cs-trigger-name', 'gc-cs-trigger-bar', 'gc-py-en', 'ai-rps-en', 'ai-game-en', 'ai-cuddle-en', 'ai-cc-en', 'ckq-en', 'call-resume', 'call-no-hangup', 'ml-write-en', 'ml-fish-week-en', 'ml-punct-en', 'fd-post-en', 'fd-punct-en', 'fd-kaomoji-en', 'fd-emoji-en', 'fd-sticker-en', 'fd-image-en', 'qs-en', 'qs-cc', 'qs-one', 'qs-multi', 'qs-noLimit', 'mjf-en', 'mjf-src-cc', 'mjf-src-def', 'mjf-src-dict', 'mjf-mix', 'mjf-punct', 'rc-en', 'rl-en', 'fish-en', 'work-en', 'fish-grab-en', 'rp-thx-en', 'turn-en', 'gc-turn-en'].forEach(k => {
    const el = document.getElementById(k);
    if (el) {
      el.addEventListener('change', () => {
        window.saveReplyCfg(k, el.checked ? 1 : 0);
        if (TOGGLE_NAMES[k]) toastSaved(TOGGLE_NAMES[k], el.checked);
        if (k === 'cs-trigger-name' || k === 'cs-trigger-bar') {
          try { if (window.applyContinueSayUI) window.applyContinueSayUI(); } catch (e) {}
        }
      });
    }
  });
  // ===== #650：多字卡「拼接符号」池（七枚内置多选 chips + #712 自定义符号） =====
  // 与上方通用开关不同：符号不是 checkbox，而是「拼接符号」行里的药丸 chips
  //（template.html #ppy-chips，选中态样式 .ppy-chip.sel 在 setting.css）——点击即存即显
  //（toast 同款）；至少保留一个：把最后一个点掉的尝试拦下、不落盘（#712 起按「内置＋自定义」
  // 合计口径判）。总开关 py-punct-en 关闭时 chips 置灰（仍可点，方便提前配好符号池）；
  // #956 起上游「多字卡回复」（py-en）也是本组闸门：它关闭时本行与本组 chips 一并置灰
  //（chat.js pyJoinCards 只回退空格＝置灰即真实生效状态，用户实报「多字卡回复开了/关了
  // 与拼接随机标点对不上」）。
  // #712 用户直派「系统自带的不变，只能开关，但是用户可以自己添加」：内置七枚（含新增的
  // 「——」，默认开）只能点亮/取消、不能删；点「＋」弹 openModal 添加自定义符号（最长
  // 6 字符、最多 8 个、与内置/已有去重），自定义 chip 点本体开关、点「×」删除（删除也受
  // 「至少保留一个」拦）。自定义存 reply-py-punct-custom＝JSON [{s,on}]（不进 DEFAULTS，
  // 随 getCfg/replyCfgFor 附带原串，join 消费在 chat.js pyJoinCards）。
  (function () {
    const POOL = [['py-punct-space', '空格'], ['py-punct-dou', '，'], ['py-punct-per', '。'], ['py-punct-ex', '！'], ['py-punct-q', '？'], ['py-punct-el', '......'], ['py-punct-dash', '——'], ['py-punct-nl', '换行']];
    // #712 内置符号实际值（去重判定用；空格的 chip 文案是「空格」、真值是 ' '；#1198「换行」真值是 '\n'）
    const BUILTIN_VALS = [' ', '，', '。', '！', '？', '......', '——', '\n'];
    const CUST_KEY = 'reply-py-punct-custom';
    const box = document.getElementById('ppy-chips');
    function ppyToast(msg, ms) {
      const d = ccToastEnsure();
      if (d) { d.textContent = msg; d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show'; clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, ms || 1800); }
    }
    // #712 自定义符号读写（走 activeStore 动态代理＝随当前桌面隔离，与其他回复设置同款）
    function pyCustGet() {
      let arr = null;
      try { arr = JSON.parse(ls.get(CUST_KEY) || '[]'); } catch (e) {}
      if (!Array.isArray(arr)) arr = [];
      return arr.filter(it => it && typeof it.s === 'string' && it.s);
    }
    function pyCustSet(list) { try { ls.set(CUST_KEY, JSON.stringify(list)); } catch (e) {} }
    // #712 「至少保留一个」统一口径：内置（除 skipKey）＋自定义（除 skipIdx）的选中合计
    function ppyOtherSel(cfg, skipKey, skipIdx) {
      let n = POOL.filter(p => p[0] !== skipKey && cfg[p[0]] === 1).length;
      pyCustGet().forEach((it, i) => { if (i !== skipIdx && it && it.on === 1) n++; });
      return n;
    }
    // #712 自定义 chips 重渲（插在「＋」前；data-c 下标与存储数组一一对应，不带 data-k
    // ——ppySync 的内置循环按 [data-k] 扫，不会把自定义误当内置改写选中态）
    function renderCust() {
      if (!box) return;
      box.querySelectorAll('.ppy-chip[data-c]').forEach(el => el.remove());
      const add = document.getElementById('ppy-add');
      // #956 置灰上游＝「多字卡回复」总开关（py-en）也关时才算停用（见 ppySync 处说明）
      const dcfg = getCfg();
      const dis = !(dcfg['py-en'] === 1 && dcfg['py-punct-en'] === 1); // #956c
      pyCustGet().forEach((it, i) => {
        const el = document.createElement('span');
        el.className = 'tag ppy-chip ppy-chip-c' + (it.on === 1 ? ' sel' : '') + (dis ? ' dis' : '');
        el.dataset.c = String(i);
        el.textContent = it.s;
        const x = document.createElement('i');
        x.className = 'ppy-x';
        x.textContent = '×';
        el.appendChild(x);
        if (add && add.parentNode === box) box.insertBefore(el, add); else box.appendChild(el);
      });
    }
    function ppySync() {
      if (!box) return;
      const cfg = getCfg();
      // #956：多字卡回复（py-en）是本组上游闸门——总开关关闭时「拼接随机标点」不再生效
      //（chat.js pyJoinCards 只回退空格），故本行与本组 chips 一并置灰（仍可点，方便提前配好，
      // 口径同 #650/#712 的「总开关关闭时 chips 置灰」）。用户实报「多字卡回复关闭了，但是
      // 拼接随机标点没有关闭，还是能触发多字卡回复」＝就是要这层从属关系可见。
      const pyMasterOn = cfg['py-en'] === 1; // #956b
      const en = pyMasterOn && cfg['py-punct-en'] === 1;
      box.querySelectorAll('.ppy-chip[data-k]').forEach(ch => {
        const k = ch.dataset.k;
        if (!k) return;
        ch.classList.toggle('sel', cfg[k] === 1);
        ch.classList.toggle('dis', !en);
      });
      const add = document.getElementById('ppy-add');
      if (add) add.classList.toggle('dis', !en);
      // 总开关/本行开关任一关闭＝整行置灰（口径同 #953 的 mjf-punct-pool 行：仍可操作）
      const swEl = document.getElementById('py-punct-en');
      const rowPunct = swEl ? swEl.closest('.gs-row') : null;
      if (rowPunct) rowPunct.style.opacity = (pyMasterOn && cfg['py-punct-en'] === 1) ? '' : '.45'; // #956d
      const rowChips = box.closest ? box.closest('.gs-row') : null;
      if (rowChips) rowChips.style.opacity = pyMasterOn ? '' : '.45'; // #956g
      renderCust();
    }
    // #712 添加自定义符号（openModal 确定后必关弹窗；校验不过 toast 提示、用户重开再输）
    function ppyAddFlow() {
      if (pyCustGet().length >= 8) { ppyToast('自定义拼接符号最多添加 8 个（可删掉不要的再加）', 2400); return; }
      if (!window.openModal) return;
      window.openModal('添加拼接符号', '', function (v) {
        const s = String(v == null ? '' : v).trim();
        if (!s) { ppyToast('没有输入符号', 2000); return; }
        if (s.length > 6) { ppyToast('符号最长 6 个字符', 2000); return; }
        const list = pyCustGet();
        if (list.length >= 8) { ppyToast('自定义拼接符号最多添加 8 个（可删掉不要的再加）', 2400); return; }
        if (BUILTIN_VALS.indexOf(s) > -1) { ppyToast('这是系统自带符号，点亮对应 chip 即可', 2400); return; }
        if (list.some(it => it.s === s)) { ppyToast('该自定义符号已存在', 2000); return; }
        list.push({ s: s, on: 1 });
        pyCustSet(list);
        ppySync();
        toastSaved('添加拼接符号 ' + s, true);
      }, { maxlength: 6, placeholder: '输入符号，如 ～ / ### / 💕' });
    }
    if (box) {
      box.addEventListener('click', (ev) => {
        if (ev.target.closest('#ppy-add')) { ppyAddFlow(); return; }
        const ch = ev.target.closest('.ppy-chip');
        if (!ch) return;
        // #712 自定义 chip（data-c）：点「×」删除 / 点本体开关——删除与关掉最后一个选中
        // 符号一样被「至少保留一个」拦下
        if (ch.dataset.c != null) {
          const i = Number(ch.dataset.c);
          const list = pyCustGet();
          const it = list[i];
          if (!it) return;
          const del = !!ev.target.closest('.ppy-x');
          if (it.on === 1 && ppyOtherSel(getCfg(), null, i) === 0) {
            ppyToast('拼接符号至少保留一个（想回到纯空格请关上方「拼接随机标点」）', 2400);
            return;
          }
          if (del) {
            list.splice(i, 1);
            pyCustSet(list);
            ppySync();
            ppyToast('已删除拼接符号 ' + it.s);
          } else {
            it.on = it.on === 1 ? 0 : 1;
            pyCustSet(list);
            ppySync();
            toastSaved('拼接符号 ' + it.s, it.on === 1);
          }
          return;
        }
        const k = ch.dataset.k;
        if (!k) return;
        const cfg = getCfg();
        const on = cfg[k] === 1;
        if (on && ppyOtherSel(cfg, k, -1) === 0) {
          ppyToast('拼接符号至少保留一个（想回到纯空格请关上方「拼接随机标点」）', 2400);
          return;
        }
        window.saveReplyCfg(k, on ? 0 : 1);
        ppySync();
        const nm = (POOL.find(p => p[0] === k) || ['', k])[1];
        toastSaved('拼接符号 ' + nm, !on);
      });
    }
    ppySync();
    const ppyEnEl = document.getElementById('py-punct-en');
    if (ppyEnEl) ppyEnEl.addEventListener('change', () => setTimeout(ppySync, 30));
    // #956 上游总开关（多字卡回复）也参与置灰/选中态同步——关掉它本组整行置灰
    const pyEnEl = document.getElementById('py-en'); // #956e
    if (pyEnEl) pyEnEl.addEventListener('change', () => setTimeout(ppySync, 30));
    // 切桌面 / 备份回填 / 写日志修正后重读显示（与 #515 三页概率行同口径）
    ['contact-switched', 'mochi-restore-done', 'mochi-wrj-heal'].forEach(evN => {
      document.addEventListener(evN, () => { try { ppySync(); } catch (e) {} });
    });
  })();
  // ===== #727：主动发送「标识」池（五枚内置多选 chips + 自定义标识） =====
  // 用户直派「联系人主动发送的消息，现在是小爱心的标识，帮我新增，可以用别的标识和自定义标识」。
  // 与上方通用 checkbox 行不同：标识不是单个开关，而是「标识」行里的药丸 chips
  //（template.html #asb-chips，选中态复用 .ppy-chip.sel 一族，见 setting.css）——点击即存即显。
  // 口径完全对齐 #712 拼接符号：内置五枚（爱心/星星/月亮/闪光/小爪）只能点亮/取消、不能删；
  // 点「＋」弹 openModal 添加自定义标识（最长 4 个字符、最多 8 个、与内置/已有去重），
  // 自定义 chip 点本体开关、点「×」删除。自定义存 reply-as-badge-custom＝JSON [{s,on}]
  //（不进 DEFAULTS，随 getCfg/replyCfgFor 附带原串，渲染消费在 chat.js 主动发送标识分支）。
  // 与 #712 的唯一差别：**没有「至少保留一个」拦截**——「不显示任何标识」由上方 as-badge
  // 总开关表达（关掉总开关＝一枚都不显示），池内全关由渲染侧兜底回爱心，设置页不拦。
  (function () {
    const POOL = [['as-badge-heart', '♥', '爱心'], ['as-badge-star', '★', '星星'], ['as-badge-moon', '☾', '月亮'], ['as-badge-spark', '✦', '闪光'], ['as-badge-paw', '🐾', '小爪']];
    // #727 内置标识实际值（去重判定用）
    const BUILTIN_VALS = ['♥', '★', '☾', '✦', '🐾'];
    const CUST_KEY = 'reply-as-badge-custom';
    const box = document.getElementById('asb-chips');
    function asbToast(msg, ms) {
      const d = ccToastEnsure();
      if (d) { d.textContent = msg; d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show'; clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, ms || 1800); }
    }
    // #727 自定义标识读写（走 activeStore 动态代理＝随当前桌面隔离，与其他回复设置同款）
    function asbCustGet() {
      let arr = null;
      try { arr = JSON.parse(ls.get(CUST_KEY) || '[]'); } catch (e) {}
      if (!Array.isArray(arr)) arr = [];
      return arr.filter(it => it && typeof it.s === 'string' && it.s);
    }
    function asbCustSet(list) { try { ls.set(CUST_KEY, JSON.stringify(list)); } catch (e) {} }
    // #727 自定义 chips 重渲（插在「＋」前；data-c 下标与存储数组一一对应，不带 data-k
    //——asbSync 的内置循环按 [data-k] 扫，不会把自定义误当内置改写选中态）
    function renderCust() {
      if (!box) return;
      box.querySelectorAll('.ppy-chip[data-c]').forEach(el => el.remove());
      const add = document.getElementById('asb-add');
      const dis = getCfg()['as-badge'] !== 1;
      asbCustGet().forEach((it, i) => {
        const el = document.createElement('span');
        el.className = 'tag ppy-chip ppy-chip-c' + (it.on === 1 ? ' sel' : '') + (dis ? ' dis' : '');
        el.dataset.c = String(i);
        el.textContent = it.s;
        const x = document.createElement('i');
        x.className = 'ppy-x';
        x.textContent = '×';
        el.appendChild(x);
        if (add && add.parentNode === box) box.insertBefore(el, add); else box.appendChild(el);
      });
    }
    function asbSync() {
      if (!box) return;
      const cfg = getCfg();
      const en = cfg['as-badge'] === 1;
      // #727 多枚点亮时的抽取方式行只在「总开关开 + 选中≥2」时有意义
      let selN = 0;
      box.querySelectorAll('.ppy-chip[data-k]').forEach(ch => {
        const k = ch.dataset.k;
        if (!k) return;
        if (cfg[k] === 1) selN++;
        ch.classList.toggle('sel', cfg[k] === 1);
        ch.classList.toggle('dis', !en);
      });
      const add = document.getElementById('asb-add');
      if (add) add.classList.toggle('dis', !en);
      const randRow = document.getElementById('asb-rand-row');
      if (randRow) randRow.hidden = !(en && selN + asbCustGet().filter(it => it.on === 1).length >= 2);
      const randEl = document.getElementById('as-badge-rand');
      if (randEl) { randEl.checked = cfg['as-badge-rand'] === 1; randEl.disabled = !en; }
      renderCust();
    }
    // #856 自定义标识的校验/写入抽成一份（设置页 openModal 与「边看边调→微调」抽屉共用同一口径：
    // 最长 4 字、上限 8 个、与内置/已有去重）。返回 {ok,msg}：ok=false 时 msg 是提示文案，ok=true 时 msg 是新增标识串。
    function asbAddRaw(raw) {
      const s = String(raw == null ? '' : raw).trim();
      if (!s) return { ok: false, msg: '没有输入标识' };
      if (s.length > 4) return { ok: false, msg: '标识最长 4 个字符' };
      const list = asbCustGet();
      if (list.length >= 8) return { ok: false, msg: '自定义标识最多添加 8 个（可删掉不要的再加）' };
      if (BUILTIN_VALS.indexOf(s) > -1) return { ok: false, msg: '这是系统自带标识，点亮对应 chip 即可' };
      if (list.some(it => it.s === s)) return { ok: false, msg: '该自定义标识已存在' };
      list.push({ s: s, on: 1 });
      asbCustSet(list);
      asbSync();
      return { ok: true, msg: s };
    }
    // #727 添加自定义标识（openModal 确定后必关弹窗；校验不过 toast 提示、用户重开再输）
    function asbAddFlow() {
      if (asbCustGet().length >= 8) { asbToast('自定义标识最多添加 8 个（可删掉不要的再加）', 2400); return; }
      if (!window.openModal) return;
      window.openModal('添加主动发送标识', '', function (v) {
        const r = asbAddRaw(v);
        if (!r.ok) { asbToast(r.msg, 2400); return; }
        toastSaved('标识 ' + r.msg, true);
      }, { maxlength: 4, placeholder: '输入标识，如 🌙 / ❀ / 喵' });
    }
    if (box) {
      box.addEventListener('click', (ev) => {
        if (ev.target.closest('#asb-add')) { asbAddFlow(); return; }
        const ch = ev.target.closest('.ppy-chip');
        if (!ch) return;
        // #727 自定义 chip（data-c）：点「×」删除 / 点本体开关
        if (ch.dataset.c != null) {
          const i = Number(ch.dataset.c);
          const list = asbCustGet();
          const it = list[i];
          if (!it) return;
          const del = !!ev.target.closest('.ppy-x');
          if (del) {
            list.splice(i, 1);
            asbCustSet(list);
            asbSync();
            asbToast('已删除标识 ' + it.s);
          } else {
            it.on = it.on === 1 ? 0 : 1;
            asbCustSet(list);
            asbSync();
            toastSaved('标识 ' + it.s, it.on === 1);
          }
          return;
        }
        const k = ch.dataset.k;
        if (!k) return;
        const cfg = getCfg();
        const on = cfg[k] === 1;
        window.saveReplyCfg(k, on ? 0 : 1);
        asbSync();
        const nm = (POOL.find(p => p[0] === k) || ['', '', k])[2];
        toastSaved('标识 ' + nm, !on);
      });
    }
    asbSync();
    const asbEnEl = document.getElementById('as-badge');
    if (asbEnEl) asbEnEl.addEventListener('change', () => setTimeout(asbSync, 30));
    // 切桌面 / 备份回填 / 写日志修正后重读显示（与 #515 三页概率行同口径）
    ['contact-switched', 'mochi-restore-done', 'mochi-wrj-heal'].forEach(evN => {
      document.addEventListener(evN, () => { try { asbSync(); } catch (e) {} });
    });
    // #727 供 chat.js 渲染侧复用：读当前 cfg 的标识池（内置五枚 + 自定义，只取 on=1）
    // 注意 cfgn 是 chat.js 的模块内函数、本文件不可见，这里用等价的本地取值
    //（undefined 兜底：爱心默认 1、其余内置默认 0）
    window.asBadgePool = function (c) {
      try {
        c = c || {};
        const val = (k, d) => { const v = c[k]; return v === undefined ? d : v; };
        const out = [];
        POOL.forEach(p => { if (val(p[0], p[0] === 'as-badge-heart' ? 1 : 0) === 1) out.push({ s: p[1], builtin: 1 }); });
        let arr = null;
        try { arr = JSON.parse(c['as-badge-custom'] ? c['as-badge-custom'] : '[]'); } catch (e) {}
        if (Array.isArray(arr)) arr.forEach(it => { if (it && it.on === 1 && typeof it.s === 'string' && it.s) out.push({ s: it.s, builtin: 0 }); });
        return out;
      } catch (e) { return []; }
    };
    // ===== #856（2026-09-19）：标识池的「视图读写口」=====
    // 用户直派「聊天设置→美化→边看边调→微调 里缺少更换联系人主动发消息的标识图案」。
    // 池的数据、默认值、自定义校验仍然只在本段（#727）有一份；这里把「列表 / 点亮切换 / 新增 /
    // 写开关 / 造节点」导出，让抽屉只画视图——否则两处各写一套池逻辑，内置码值、上限、去重
    // 这类口径迟早漂移（#712 拼接符号与 #727 标识就已经是两套几乎一样的校验了）。
    window.asBadgeItems = function () {
      const cfg = getCfg();
      const out = POOL.map(p => ({ k: p[0], s: p[1], label: p[2], on: cfg[p[0]] === 1, builtin: 1 }));
      try { asbCustGet().forEach((it, i) => out.push({ i: i, s: it.s, on: it.on === 1, builtin: 0 })); } catch (e) {}
      return out;
    };
    // 点一枚 chip＝翻转它的点亮态（内置写 reply-as-badge-*、自定义写 as-badge-custom 的 on）；
    // 返回给调用方做提示用的名字（自定义没有中文名，用标识串本身）
    window.asBadgeToggle = function (it) {
      if (!it) return '';
      if (it.builtin) {
        window.saveReplyCfg(it.k, it.on ? 0 : 1);
        asbSync();
        return '标识 ' + (it.label || it.s);
      }
      const list = asbCustGet();
      const cur = list[it.i];
      if (!cur) return '';
      cur.on = cur.on === 1 ? 0 : 1;
      asbCustSet(list);
      asbSync();
      return '标识 ' + cur.s;
    };
    window.asBadgeAdd = asbAddRaw;
    // 总开关 as-badge / 抽取方式 as-badge-rand 也走这里：写完顺手 asbSync，设置页那侧的勾选态同步刷新
    window.asBadgeWrite = function (k, v) { window.saveReplyCfg(k, v); try { asbSync(); } catch (e) {} };
    // 标识节点：爱心＝SVG、其余（内置四枚 + 自定义）＝文本 span，与 chat.js 渲染侧同样两种形态、
    // 同一批类名（样式见 chat-main.css .msg-hi-heart / .msg-hi-mark）。给「微调」抽屉就地换标识用。
    window.asBadgeNode = function (pick) {
      const s = String((pick && pick.s) || '');
      if (pick && pick.builtin === 1 && s === '♥') {
        const w = document.createElement('span');
        w.innerHTML = '<svg class="msg-hi-heart" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
        return w.firstChild;
      }
      if (!s) return null;
      const mk = document.createElement('span');
      mk.className = 'msg-hi-mark';
      mk.setAttribute('aria-hidden', 'true');
      mk.textContent = s;
      return mk;
    };
    // #856 供「微调」分区就地刷新屏上标识：只动气泡上那枚标识节点（带标识＝那条是主动发送的消息，
    // 语义由 chat.js 渲染时决定），不整窗重建＝不闪屏（#846 同族口径）。
    // 遍历的是气泡而不是标识节点：总开关关掉时标识节点被移除，若只扫节点，再打开就没有任何凭据能把
    // 它们恢复回来（屏上从此没有标识）。所以移除时把这枚原本的标识串记在 data-as-mark 上，
    // 打开时按它放回原位。旧标识仍在新池里的保持不动（prefer），故点亮/取消一枚只改动用到它的那些气泡。
    window.asBadgeRefreshMarks = function (host) {
      try {
        const root = host || document.getElementById('chat-body');
        if (!root) return 0;
        const cfg = getCfg();
        const on = cfg['as-badge'] === 1;
        let pool = [];
        try { pool = window.asBadgePool(cfg) || []; } catch (e) { pool = []; }
        if (!pool.length) pool = [{ s: '♥', builtin: 1 }];
        const bubbles = root.querySelectorAll('.msg-bubble');
        let n = 0;
        for (let i = 0; i < bubbles.length; i++) {
          const b = bubbles[i];
          const old = b.querySelector('.msg-hi-heart, .msg-hi-mark');
          const cur = old ? (old.classList.contains('msg-hi-heart') ? '♥' : String(old.textContent || '')) : String(b.dataset.asMark || '');
          if (!cur) continue;
          if (old) old.remove();
          n++;
          if (!on) { b.dataset.asMark = cur; continue; }
          delete b.dataset.asMark;
          let pick = pool[0];
          const keep = pool.filter(p => p.s === cur)[0];
          if (keep) pick = keep;
          else if (pool.length > 1 && cfg['as-badge-rand'] !== 1) pick = pool[i % pool.length];
          const node = window.asBadgeNode(pick);
          if (node) b.insertBefore(node, b.firstChild);
        }
        return n;
      } catch (e) { return 0; }
    };
    // #727 多枚点亮时的抽取方式行——点「随机/轮换」两个 chip 写 as-badge-rand
    const randRow = document.getElementById('asb-rand-row');
    if (randRow) {
      randRow.addEventListener('click', (ev) => {
        const ch = ev.target.closest('[data-asbrand]');
        if (!ch) return;
        const v = Number(ch.dataset.asbrand);
        window.saveReplyCfg('as-badge-rand', v === 1 ? 1 : 0);
        asbSync();
        toastSaved('标识抽取方式 ' + (v === 1 ? '每次随机' : '按顺序轮换'), true);
      });
    }
  })();
  // #370：词典拼字链路自检——四道闸门（二级锁/词典聊天使用/拼字总开关与概率/抽卡池；#427 移除无 UI 的遗留 dc-cat-dict 闸）
  //   任一被关都是「联系人永不发词典字卡、永不出现词典 tag」且零提示（用户多设备实报，
  //   干净环境全链路验证通过=存量状态差异）。这里把每道闸的实时状态摆进设置页，
  //   卡在哪道闸、去哪打开，任何机型打开设置一眼可见；零机型分支。
  (function () {
    const diagEl = document.getElementById('qs-diag');
    if (!diagEl) return;
    function qsDiagRender() {
      try {
        const c = window.replyCfg ? window.replyCfg() : {};
        const gates = [];
        let blocked = null;
        function gate(ok, label, detail) { gates.push({ ok: !!ok, label: label, detail: detail || '' }); return !ok; }
        // ① 二级锁（锁定=系统预设字卡整体不存在，词典抽卡池为空）
        //    #390 文案人话化：用户看不懂「二级锁」是什么、为什么管词典——点明因果与去处
        const lockOk = !(window.cardLockOpen && !window.cardLockOpen());
        if (gate(lockOk, '防未成年人锁', lockOk ? '已解锁' : '锁定中·词典被锁停') && !blocked) blocked = '「防未成年人锁定」开启中：词典属于系统内置字卡，锁定时词典拼字整体停用（下方开关全开也没效果）——到开屏公告区「防未成年人·内置字卡锁定」卡输入密码解锁，解锁后自动恢复';
        // #427：原「词典分类」闸（读 dc-cat-dict）移除——词典独立成页后该键无任何写入
        //   UI，老用户存量 '0' 会让自检永远报「词典分类被关」且无处打开（多机型同报，
        //   数据态问题）；词典启用由下方「词典聊天使用」+概率闸覆盖
        // ③ 词典页「聊天使用」+ 概率（词典独立页；dictOverall 是真概率掷签）
        const useOk = !(window.dictUse && window.dictUse('chat') === false);
        const ov = window.dictOverall ? window.dictOverall('chat') : 100;
        if (gate(useOk, '词典聊天使用', useOk ? '开（' + ov + '% 概率）' : '关') && !blocked) blocked = '词典「聊天使用」被关（词典独立页里打开）';
        if (useOk && !(typeof ov === 'number' && isFinite(ov) && ov > 0) && !blocked) blocked = '词典「聊天使用概率」为 0（词典独立页调高）';
        // ④ 拼字总开关/概率（本页）
        // FIX 2026-09-25 #1236：「多字卡回复」（py-en）自本批起是词典拼字的总闸——它关闭时
        //   quoteSpellPick 整体不返回（单气泡拼字与逐卡连发都不触发）。自检必须把它摆出来，
        //   否则会出现「各道全绿、屏上却永远不出拼字」的谎报（同 #998/#1000「指路不许说谎」口径）。
        const pyOk = c['py-en'] === 1;
        if (gate(pyOk, '多字卡回复总闸', pyOk ? '开' : '关·拼字整体停用') && !blocked) blocked = '「每条消息使用多字卡回复」总开关关着——#1236 起它是词典拼字的总闸，关了就两种形态都不再触发（要拼字就把它打开）';
        const enOk = c['qs-en'] === 1;
        const prob = Number(c['qs-prob']);
        if (gate(enOk, '拼字总开关', enOk ? '开（' + (isFinite(prob) ? prob : 0) + '% 概率）' : '关') && !blocked) blocked = '「词典拼字」总开关被关（本组第一行打开）';
        if (enOk && !(isFinite(prob) && prob > 0) && !blocked) blocked = '「拼字概率」为 0（本组第二行调高）';
        // ⑤ 抽卡池条数（词典全部分组，剔除逐张关闭/空卡）
        let poolN = 0;
        try {
          const grps = (window.getDefaultCardGroups && window.getDefaultCardGroups('dict')) || [];
          grps.forEach(g => { (g[1] || []).forEach(q => {
            if (typeof q !== 'string' || !q.trim()) return;
            if (window.isDefaultCardOff && window.isDefaultCardOff('dict', q)) return;
            poolN++;
          }); });
        } catch (e) {}
        if (gate(poolN > 0, '抽卡池', poolN + ' 张') && !blocked) blocked = '词典抽卡池为空（词典独立页把字卡逐张打开）';
        // #370b：醒目彩块输出——通过绿 / 失败红，一眼看到卡在哪道闸
        const okAll = !blocked;
        const html = '<div class="qsdiag-row">' + gates.map(g =>
          '<span class="qsdiag-gate ' + (g.ok ? 'qsdiag-ok' : 'qsdiag-bad') + '">' + (g.ok ? '✓' : '✗') + ' ' + g.label + '<em>' + g.detail + '</em></span>'
        ).join('') + '</div>' +
          (okAll
            ? '<div class="qsdiag-okline">链路正常 · 联系人每条回复约 ' + (isFinite(prob) ? prob : 0) + '% 概率变成词典拼字</div>'
            : '<div class="qsdiag-blocked">被挡住：' + blocked + '</div>');
        diagEl.innerHTML = html;
      } catch (e) {
        try { diagEl.innerHTML = '<div class="qsdiag-blocked">链路自检暂不可用</div>'; } catch (e2) {}
      }
    }
    qsDiagRender();
    // 状态变化即刷新：本组任一开关/词典页场景开关/二级锁解锁与重锁事件
    ['qs-en', 'qs-one', 'qs-multi', 'qs-cc', 'py-en'].forEach(k => { // #1236：py-en 现在是拼字总闸，翻它必须同步刷新自检
      const el = document.getElementById(k);
      if (el) el.addEventListener('change', () => setTimeout(qsDiagRender, 50));
    });
    document.addEventListener('mochi-cardlock-open', qsDiagRender);
    document.addEventListener('mochi-cardlock-locked', qsDiagRender);
    document.addEventListener('contact-switched', qsDiagRender);
    window.__qsDiagRender = qsDiagRender;
    // #370a：自检初次渲染跑在 reply-settings.js 装载时，此时可能早于 default-cards.js
    //   （定义 window.getDefaultCardGroups）执行——抽卡池读取函数未就绪会把「抽卡池」误算成 0
    //   （假阴性「词典抽卡池为空」），且只有切开关/切联系人/重锁才会刷新去纠正，什么都不动就
    //   一直停在假的「池 0」误导用户。这里兜底轮询：等抽卡池读取函数就绪后自动补算一次真值。
    (function _qsWaitCardLib() {
      if (window.getDefaultCardGroups) { qsDiagRender(); return; }
      setTimeout(_qsWaitCardLib, 150);
    })();
  })();
  // v3.5.101：关闭「主动发送」时明确提示（否则 TA 永不主动发消息且无任何提醒）
  const asEnEl = document.getElementById('as-en');
  if (asEnEl) {
    asEnEl.addEventListener('change', () => {
      if (!asEnEl.checked) {
        const d = ccToastEnsure();
        if (d) { d.textContent = '主动发送已关闭，TA 将不再主动发消息'; d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show'; clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, 2600); }
      }
    });
  }
  // v3.5.101：开启「免打扰」时提示（弱化主动发送，间隔最长可达 3 小时）
  const dndEl = document.getElementById('dnd-en');
  if (dndEl) {
    dndEl.addEventListener('change', () => {
      if (dndEl.checked) {
        const d = ccToastEnsure();
        if (d) { d.textContent = '免打扰已开启，TA 主动发送会大幅减弱（最长 3 小时一次）'; d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show'; clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, 3200); }
      }
    });
  }
  // #324：「梦角自由造句」开关切换时弹提示告知开启成功/失败——
  // 成功判定 = 存储链路可用（ccAppendCards/activeStore 在位且试写探针成功），失败给原因
  const mjfEl = document.getElementById('mjf-en');
  if (mjfEl) {
    mjfEl.addEventListener('change', () => {
      let okStore = false;
      try {
        const st = window.activeStore && window.activeStore();
        if (st && st.get && st.set) {
          const probe = 'mjf-probe-' + Date.now();
          st.set('reply-mjf-probe', probe);
          okStore = st.get('reply-mjf-probe') === probe;
          try { st.set('reply-mjf-probe', ''); } catch (e) {}
        }
      } catch (e) { okStore = false; }
      const d = ccToastEnsure();
      if (!d) return;
      const show = (msg) => { d.textContent = msg; d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show'; clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, 3200); };
      if (mjfEl.checked && okStore) show('梦角自由造句已开启：TA 说话将按概率截字重造句（造出的句子进字卡库「梦角自由造句」分类）');
      else if (mjfEl.checked) show('梦角自由造句开启失败：本地存储不可用，请检查浏览器隐私设置后重试');
      else show('梦角自由造句已关闭');
    });
  }
  // ===== FIX 2026-09-21 #953 → 2026-09-29 #1396：造句「可用标点」改成 #650/#712 同款 chips 池 =====
  // 用户直派「梦角自由造句的可用标点（空格分隔）与多字卡回复那套拼接符号不一样＝设计不完整」。
  // 原形态＝一个 132px 文本框（空格/| 分隔、整串截到 60 字符），病灶四条：看不见有哪些候选（默认池
  // 只躺在 dream-free.js 里）、永远选不到「空格/换行」（按空白切分＋保存时把换行替成空格）、没有去重
  // 与校验（留空还会静默回落默认池）、句号靠「在默认池里写三遍」加权＝用户既看不到也改不动。
  // 现在与「拼接符号」同一交互、同一套候选：内置十枚（空格/，/。/！/？/...... /——/换行，另加两枚
  // 句尾专用的 ~ 与 ……）只能开关不能删；点「＋」加自定义（≤6 字符、≤8 个、与内置及已有去重），
  // 自定义点本体开关、点「×」删除；至少保留一枚（一枚都不补由上方「句尾标点」开关表达）；
  // 本项 mjf-punct 关闭＝整行与 chips 一并置灰（仍可点，方便提前配好，沿用 #953 原口径；总开关
  // mjf-en 关闭时**不**灰——同组的概率/语料/权重/手法都不灰，别在这一行制造组内唯一例外）。
  // 存储：reply-mjf-punct-set = JSON [{s,on}]（整池，内置也在内）。非数值键故不进 DEFAULTS——理由同
  // #712 那段：上面循环的数字兜底会把 JSON 串 Number() 成 NaN，saveAllContactsDo 按 DEFAULTS 全键
  // String() 同步也会写坏。消费在 dream-free.js endPunctPool（该键为空时它仍走 #953 旧链）。
  // 存量零变化：本键没写过＝用户从没点过 chip ⇒ 出句分布与今天一字不差（旧 reply-mjf-punct-pool 原串
  // 非空用旧串，否则用内置默认池）；界面此时显示的是按下述 parseLegacy/DEF_LIT 推导出的点亮态，用户
  // 点一下才落盘，且落盘的是他此刻看到的整套（旧串配好的池不会被清空，只是句号不再偏多）。
  (function () {
    const SET_KEY = 'reply-mjf-punct-set';
    const LEGACY_KEY = 'reply-mjf-punct-pool';
    // [data-p, 真值, chip 文案]——文案与 #650 那套对齐（空格/换行的真值同样是 ' ' 与 '\n'）
    const POOL = [['sp', ' ', '空格'], ['dou', '，', '，'], ['per', '。', '。'], ['ex', '！', '！'], ['q', '？', '？'], ['el', '......', '......'], ['dash', '——', '——'], ['nl', '\n', '换行'], ['tilde', '~', '~'], ['ell', '……', '……']];
    const VAL2P = {}; POOL.forEach(p => { VAL2P[p[1]] = p[0]; });
    const labelOf = s => { const p = POOL.find(x => x[1] === s); return p ? p[2] : s; };
    // 从没点过 chip 时的点亮态＝dream-free.js END_PUNCT_DEFAULT 的去重集（只作显示，不复制它的权重）
    const DEF_LIT = ['。', '~', '！', '……'];
    const box = document.getElementById('mjf-punct-pool');
    if (!box) return;
    function mjfpToast(msg, ms) {
      const d = ccToastEnsure();
      if (d) { d.textContent = msg; d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show'; clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, ms || 1800); }
    }
    const valid = it => !!(it && typeof it.s === 'string' && it.s && it.s.length <= 6);
    // 旧串解析口径与 dream-free.js endPunctPool 逐字对齐（空格/| 分隔；无分隔则按字符拆）
    function parseLegacy(raw) {
      const s = String(raw == null ? '' : raw).trim();
      if (!s) return null;
      let arr = s.split(/[\s|]+/).filter(Boolean);
      if (arr.length < 2) arr = Array.from(s.replace(/[\s|]+/g, ''));
      arr = arr.filter(x => x.length <= 6).slice(0, 20);
      return arr.length ? arr : null;
    }
    // 未落盘时的显示态：旧串（或内置默认池）→ 内置十枚的开关态 ＋ 旧串里那几枚非内置的作自定义项
    function derive() {
      let lit = null;
      try { lit = parseLegacy(ls.get(LEGACY_KEY) || ''); } catch (e) {}
      if (!lit) lit = DEF_LIT;
      const set = {}; lit.forEach(x => { set[x] = 1; });
      const list = POOL.map(p => ({ s: p[1], on: set[p[1]] ? 1 : 0 }));
      Object.keys(set).forEach(v => { if (VAL2P[v] == null) list.push({ s: v, on: 1 }); });
      return list;
    }
    function mjfpGet() {
      let arr = null;
      try { arr = JSON.parse(ls.get(SET_KEY) || ''); } catch (e) {}
      if (Array.isArray(arr)) {
        arr = arr.filter(valid);
        if (arr.length) return arr;
      }
      return derive();
    }
    function mjfpSet(list) { try { ls.set(SET_KEY, JSON.stringify(list)); } catch (e) {} }
    const isCust = it => VAL2P[it.s] == null;
    const custCount = list => list.filter(isCust).length;
    // 「至少保留一枚」：内置＋自定义合计（口径同 #712）
    function otherSel(list, skipIdx) {
      let n = 0;
      list.forEach((it, i) => { if (i !== skipIdx && it.on === 1) n++; });
      return n;
    }
    function mjfpDis() {
      // 只认本项开关：同组「触发概率／语料／权重／手法／混合模式」都不随总开关 mjf-en 变灰，
      // 这一行也不灰（跨组上游才置灰是 #956 给「拼接随机标点」定的口径，别拿它当同组先例）
      return getCfg()['mjf-punct'] !== 1;
    }
    // 自定义 chips 重渲（插在「＋」前；data-i＝在该池数组里的下标，静态内置走 data-p 不冲突）
    function renderCust(list, dis) {
      box.querySelectorAll('.ppy-chip[data-i]').forEach(el => el.remove());
      const add = document.getElementById('mjfp-add');
      list.forEach((it, i) => {
        if (!isCust(it)) return;
        const el = document.createElement('span');
        el.className = 'tag ppy-chip ppy-chip-c' + (it.on === 1 ? ' sel' : '') + (dis ? ' dis' : '');
        el.dataset.i = String(i);
        el.textContent = it.s;
        const x = document.createElement('i');
        x.className = 'ppy-x';
        x.textContent = '×';
        el.appendChild(x);
        if (add && add.parentNode === box) box.insertBefore(el, add); else box.appendChild(el);
      });
    }
    function sync() {
      const list = mjfpGet();
      const dis = mjfpDis();
      box.querySelectorAll('.ppy-chip[data-p]').forEach(ch => {
        const v = (POOL.find(p => p[0] === ch.dataset.p) || [])[1];
        if (v == null) return;
        const it = list.find(x => x.s === v);
        ch.classList.toggle('sel', !!(it && it.on === 1));
        ch.classList.toggle('dis', dis);
      });
      const add = document.getElementById('mjfp-add');
      if (add) add.classList.toggle('dis', dis);
      const row = document.getElementById('mjf-punct-pool-row');
      if (row) row.style.opacity = dis ? '.45' : '';
      renderCust(list, dis);
    }
    function addFlow() {
      const cur = mjfpGet();
      if (custCount(cur) >= 8) { mjfpToast('自定义句尾标点最多添加 8 个（可删掉不要的再加）', 2400); return; }
      if (!window.openModal) return;
      window.openModal('添加句尾标点', '', function (v) {
        const s = String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim();
        if (!s) { mjfpToast('没有输入标点', 2000); return; }
        if (s.length > 6) { mjfpToast('标点最长 6 个字符', 2000); return; }
        const list = mjfpGet();
        if (custCount(list) >= 8) { mjfpToast('自定义句尾标点最多添加 8 个（可删掉不要的再加）', 2400); return; }
        if (list.some(it => it.s === s)) {
          mjfpToast(isCust(list.find(it => it.s === s)) ? '该自定义标点已存在' : '这是系统自带标点，点亮对应 chip 即可', 2200);
          return;
        }
        list.push({ s: s, on: 1 });
        mjfpSet(list);
        sync();
        toastSaved('添加句尾标点 ' + s, true);
      }, { maxlength: 6, placeholder: '输入标点，如 ～ / ❗ / !!!' });
    }
    box.addEventListener('click', (ev) => {
      if (ev.target.closest('#mjfp-add')) { addFlow(); return; }
      const ch = ev.target.closest('.ppy-chip');
      if (!ch) return;
      const list = mjfpGet();
      let idx = -1;
      if (ch.dataset.i != null) idx = Number(ch.dataset.i);
      else {
        const v = (POOL.find(p => p[0] === ch.dataset.p) || [])[1];
        if (v != null) idx = list.findIndex(x => x.s === v);
      }
      const it = list[idx];
      if (!it) return;
      const del = !!ev.target.closest('.ppy-x');
      if (it.on === 1 && otherSel(list, idx) === 0) {
        mjfpToast('句尾标点至少保留一枚（想一枚都不补请关上方「句尾标点」开关）', 2400);
        return;
      }
      if (del) {
        list.splice(idx, 1);
        mjfpSet(list);
        sync();
        mjfpToast('已删除句尾标点 ' + it.s);
        return;
      }
      it.on = it.on === 1 ? 0 : 1;
      mjfpSet(list);
      sync();
      toastSaved('句尾标点 ' + labelOf(it.s), it.on === 1);
    });
    sync();
    const swPunct = document.getElementById('mjf-punct');
    if (swPunct) swPunct.addEventListener('change', () => setTimeout(sync, 30));
    // 切桌面 / 备份回填 / 写日志修正后重读（标点池 per-cid，与 #712 同口径）
    ['contact-switched', 'mochi-restore-done', 'mochi-wrj-heal'].forEach(evN => {
      document.addEventListener(evN, () => { try { sync(); } catch (e) {} });
    });
  })();
  // ===== #518：系统预设字卡·聊天触发概率总览（总档 + 分类档） =====
  // 分类档全部复用既有键（不新开键）：pre=存储前缀；blob=整包 JSON（prob 在 settings.prob）的四类互动卡。
  // dcf 19 类行由 default-cards.js 的 data-dcfkey 批量绑定接管（bindDcfProb/dcfRefreshUI），本段不重复绑。
  // 行显示的是存盘值（#515 口径：不显示总档闸门后的生效值）；总档缩放只在掷签点生效（dcp-master.js dcpEff）。
  (function () {
    const DCP_ROWS = [
      { k: 'dc-overall-chat', def: 30, name: '默认聊天字卡·聊天使用' },
      { k: 'qs-prob', def: 25, pre: 'reply-', name: '词典拼字' },
      { k: 'mc-prob-mood', def: 70, name: '情绪卡' },
      { k: 'mc-prob-heart', def: 40, name: '心意卡' },
      { k: 'mc-prob-intent', def: 40, name: '意图卡' },
      { k: 'rcard-prob', def: 30, name: '回应字卡·整条替换' },
      { k: 'cf-prob', def: 20, pre: 'reply-', name: '回应字卡·连接词追加' },
      { k: 'tm-prob', def: 15, name: 'TA的心情' },
      { k: 'ta-ask-prob', def: 5, blob: 'ta-ask', name: 'TA的询问' },
      { k: 'tc-prob', def: 5, blob: 'ta-choose', name: 'TA的小问题' },
      { k: 'tcu-prob', def: 5, blob: 'ta-curious', name: 'TA的好奇' },
      { k: 'tr-prob', def: 5, blob: 'ta-roast', name: 'TA的吐槽' },
      { k: 'ckq-prob', def: 2, pre: 'reply-', name: 'TA的查岗' },
      { k: 'ai-rps-prob', def: 8, pre: 'reply-', name: '猜拳邀请' },
      { k: 'ai-game-prob', def: 5, pre: 'reply-', name: '游戏邀请' },
      { k: 'ai-cuddle-prob', def: 5, pre: 'reply-', name: '贴贴邀请' }
    ];
    const dcpSyncFns = [];
    function dcpToast(msg) {
      try {
        const d = ccToastEnsure();
        if (!d) return;
        d.textContent = msg; d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show';
        clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, 1800);
      } catch (e) {}
    }
    function dcpRowGet(r) {
      try {
        if (r.blob) {
          let d = null;
          try { d = JSON.parse(ls.get(r.blob) || 'null'); } catch (e) { d = null; }
          const s = d && d.settings ? d.settings : null;
          return (s && typeof s.prob === 'number' && isFinite(s.prob)) ? s.prob : r.def;
        }
        const v = ls.get((r.pre || '') + r.k);
        if (v === null || v === undefined || v === '') return r.def;
        const n = Number(v);
        return isNaN(n) ? r.def : Math.max(0, Math.min(100, n));
      } catch (e) { return r.def; }
    }
    function dcpRowSet(r, nv) {
      nv = Math.max(0, Math.min(100, Math.round(Number(nv) || 0)));
      try {
        if (r.blob) {
          let d = null;
          try { d = JSON.parse(ls.get(r.blob) || 'null'); } catch (e) { d = null; }
          if (!d || typeof d !== 'object') d = { settings: {} };
          if (!d.settings || typeof d.settings !== 'object') d.settings = {};
          d.settings.prob = nv;
          ls.set(r.blob, JSON.stringify(d));
        } else {
          ls.set((r.pre || '') + r.k, String(nv));
        }
      } catch (e) {}
    }
    function dcpSyncUI() {
      DCP_ROWS.forEach(r => {
        const val = document.getElementById('dcp-' + r.k + '-val');
        if (val) val.value = String(dcpRowGet(r));
        // 同键的其他设置页行（如 查岗 tab 的「查岗概率」）一并刷新，避免同页双行显示漂移
        document.querySelectorAll('#page-reply-settings .stepper[data-k="' + r.k + '"] input.stp-val').forEach(el => { el.value = String(dcpRowGet(r)); });
      });
      const tg1 = document.getElementById('dcp-tg-quote');
      if (tg1) { try { tg1.checked = ls.get('quote-cards-default') !== '0'; } catch (e) {} }
      const tg2 = document.getElementById('dcp-tg-loc');
      if (tg2) { try { tg2.checked = ls.get('loc-lib-default') !== '0'; } catch (e) {} }
      dcpSyncFns.forEach(fn => { try { fn(); } catch (e) {} });
    }
    DCP_ROWS.forEach(r => {
      const st = document.getElementById('dcp-' + r.k);
      if (!st) return;
      const mn = st.querySelector('.stp-min');
      const mx = st.querySelector('.stp-max');
      const cur = function () {
        const val = st.querySelector('input.stp-val');
        const n = val ? parseInt(val.value, 10) : NaN;
        return isNaN(n) ? dcpRowGet(r) : n;
      };
      if (mn) mn.addEventListener('click', () => { dcpRowSet(r, cur() - 5); dcpSyncUI(); dcpToast('已保存：' + r.name + ' ' + dcpRowGet(r) + '%'); });
      if (mx) mx.addEventListener('click', () => { dcpRowSet(r, cur() + 5); dcpSyncUI(); dcpToast('已保存：' + r.name + ' ' + dcpRowGet(r) + '%'); });
    });
    [['dcp-tg-quote', 'quote-cards-default', '桌面今日情话·系统预设'], ['dcp-tg-loc', 'loc-lib-default', 'TA在身边位置卡·系统预设']].forEach(t => {
      const el = document.getElementById(t[0]);
      if (!el) return;
      el.addEventListener('change', () => {
        try { ls.set(t[1], el.checked ? '1' : '0'); } catch (e) {}
        dcpToast('已保存：' + t[2] + '（' + (el.checked ? '开' : '关') + '）');
      });
    });
    // 19 类功能字卡折叠块（展开状态按桌面持久化，与 功能字卡页 dcf-prob-open 同口径）
    const expRow = document.getElementById('dcp-fun-expander-row');
    const expBox = document.getElementById('dcp-fun-box');
    if (expRow && expBox) {
      const arrow = document.getElementById('dcp-fun-expander-arrow');
      let open = false;
      try { open = ls.get('reply-dcp-fun-open') === '1'; } catch (e) {}
      const applyOpen = function () {
        expBox.hidden = !open;
        if (arrow) arrow.textContent = open ? '▴' : '▾';
      };
      expRow.addEventListener('click', function () {
        open = !open;
        try { ls.set('reply-dcp-fun-open', open ? '1' : '0'); } catch (e) {}
        applyOpen();
      });
      applyOpen();
    }
    window.__dcpSyncUI = dcpSyncUI;
    dcpSyncUI();
    // 切桌面 / 备份回填 / 写日志修正三时机重读显示（与 #515 三页概率行同口径）
    ['contact-switched', 'mochi-restore-done', 'mochi-wrj-heal'].forEach(ev => {
      document.addEventListener(ev, () => { try { dcpSyncUI(); } catch (e) {} });
    });
    // 进页即刷新（row-general 已有 syncUI 监听，这里补分类档自己的）
    const genRow = document.getElementById('row-general');
    if (genRow) genRow.addEventListener('click', () => { try { dcpSyncUI(); } catch (e) {} });
  })();

  // ===== #1153：互动卡频率档（原频率 + 往下三档）=====（#1154/#1155 改了行的落位，见下方注释）
  // 用户直派「联系人在聊天里发送互动卡片的频率需要可以调整 / 原来的频率也保留」，随后补充
  // 「其实原频率就已经很频繁了。不要高频率，帮我做原频率调低几档」——档位全部 ≤ 原频率。
  // 档位倍数与掷签侧消费全在 src/js/ta-ask.js（IC_MODES / icProb / icCool / interactGateMs），
  // 本页只负责读写同一个键 reply-ic-freq（随联系人桌面隔离，与 ta-ask 的 activeStore 是同一份）。
  // 交互用 #848 的 .gs-pick 档位胶囊 + openModal pills，不新增全局 CSS。
  (function () {
    const IC_LABEL = { '0': '原频率', '1': '稍安静', '2': '安静', '3': '很安静' };
    const IC_PILLS = [
      { label: '原频率', value: '0' }, { label: '稍安静', value: '1' },
      { label: '安静', value: '2' }, { label: '很安静', value: '3' }
    ];
    const IC_DETAIL = '聊天里 TA 主动发的卡与邀请多久来一次，按这一档整体往下调（没有比「原频率」更高的档）。'
      + '覆盖：五类提问卡（询问 / 小问题 / 好奇 / 吐槽 / 分享你的字卡）、邀请三类（猜拳 / 游戏 / 贴贴）、音乐「一起去听」邀请。'
      + '不影响查岗自己的开关 / 概率 / 冷却，也不影响你自己发的卡。'
      + '\n\n· 原频率：全部 ×1，完全保持现在的节奏（默认）；'
      + '\n· 稍安静：概率 ×0.6、提问卡冷却 ×1.5、跨类型间隔 ×1.5；'
      + '\n· 安静：概率 ×0.4、提问卡冷却 ×2、跨类型间隔 ×2；'
      + '\n· 很安静：概率 ×0.2、提问卡冷却 ×3、跨类型间隔 ×3。'
      + '\n\n「概率」是在各类型自己的触发概率（默认 5%，可在【字卡与概率】子面板或 字卡库 对应页单独调）与「整体概率（总档）」之上再乘一个倍数；'
      + '「跨类型间隔」＝任意一张提问卡发出后、其余类型多久内不再自动触发（基准 60 分钟）。'
      + '原值 ≥1% 时不会被档位抹成 0（选「很安静」也不会变成永不触发）。'
      + '\n\n按联系人桌面独立保存，选档后即时生效。想完全不触发：把【字卡与概率】里的四类概率或总档调到 0，或关掉 字卡库 里对应页的开关。';
    function icVal() {
      let v = 0;
      try { v = Number((window.replyCfg && window.replyCfg())['ic-freq']); } catch (e) {}
      return (v >= 0 && v <= 3) ? String(v) : '0';
    }
    function icSync() {
      const btn = document.getElementById('ic-freq-btn');
      if (!btn) return;
      const v = icVal();
      btn.textContent = IC_LABEL[v];
      btn.dataset.v = v;
    }
    function icToast(msg) {
      try {
        const d = ccToastEnsure();
        if (!d) return;
        d.textContent = msg; d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show';
        clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, 1800);
      } catch (e) {}
    }
    // #1154（用户实报「我在回复设置里没有看到这个啊」→#1155 追派「这个应该放在一个独立 tag」）：
    // #1153 首版把这行挂在「系统预设字卡 · 聊天触发概率」组里、TA的询问 四行分类档之上——那一整块
    // 在回复设置页的【字卡与概率】子面板内，而默认显示的是【回复与主动】子面板，且该组还要往下滚
    // 一千多像素才到这行；#1154 改挂到默认面板的「主动发送（联系人找工作）」分组之后，用户仍嫌要
    // 翻半页。现按用户要求**单开一个二级 tag**：回复设置页的二级分类是
    // `.rps-tabs` 里的 `.rps-tab[data-rps]` + 同级 `.rps-panel[data-rps]`（v3.44.x 机制），
    // 切 tab 的处理器是通用的（只按 dataset 配对），且本段执行在处理器绑定之前——所以这里
    // 直接注入一枚新 tab + 一枚新 panel，处理器会自动接管，**不改 template.html、不动 CSS**
    // （.rps-tabs 是 overflow-x:auto 的横排，第四枚 tab 挤不下时横向滚动，不影响前三枚）。
    const rpsTabs = document.querySelector('#page-reply-settings .rps-tabs');
    const rpsHost = rpsTabs ? rpsTabs.parentNode : null;
    if (rpsTabs && rpsHost) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'rps-tab';
      tab.setAttribute('data-rps', 'interact');
      tab.textContent = '互动频率';
      rpsTabs.appendChild(tab);
      const panel = document.createElement('div');
      panel.className = 'rps-panel';
      panel.setAttribute('data-rps', 'interact');
      panel.hidden = true;
      const group = document.createElement('div');
      group.className = 'set-group glass';
      group.id = 'ic-freq-group';
      const title = document.createElement('div');
      title.className = 'gs-title';
      title.textContent = '互动卡频率';
      group.appendChild(title);
      const row = document.createElement('div');
      row.className = 'gs-row';
      row.id = 'ic-freq-row';
      row.innerHTML = '<span>联系人主动发卡/邀请的频率<span class="tag" id="ic-freq-tag" role="button" tabindex="0" aria-haspopup="dialog">功能说明</span></span>'
        + '<div class="gs-pick" id="ic-freq-btn" data-v="0">原频率</div>';
      group.appendChild(row);
      const sub = document.createElement('div');
      sub.className = 'gs-sub';
      sub.id = 'ic-freq-sub';
      sub.textContent = 'TA 在聊天里主动发的卡与邀请（提问卡五类：询问/小问题/好奇/吐槽/分享你的字卡；邀请三类：猜拳/游戏/贴贴；音乐「一起去听」）整体频率；「原频率」＝完全保持现在的节奏，往右都是调低。各类互动卡的单项概率在【字卡与概率】里逐项调。点右侧档位切换。';
      group.appendChild(sub);
      panel.appendChild(group);
      rpsHost.insertBefore(panel, rpsTabs.nextSibling);
      const btn = document.getElementById('ic-freq-btn');
      if (btn && window.openModal) {
        btn.addEventListener('click', function () {
          window.openModal('互动卡频率', '', function (v) {
            const n = Number(v);
            if (!(n >= 0 && n <= 3)) return;
            window.saveReplyCfg('ic-freq', n);
            icSync();
            icToast('已设置：互动卡频率＝' + IC_LABEL[String(n)]);
          }, { noInput: true, pill: icVal(), pills: IC_PILLS });
        });
      }
      const tag = document.getElementById('ic-freq-tag');
      if (tag && window.openModal) {
        const showDetail = function (e) {
          if (e) { e.stopPropagation(); e.preventDefault(); }
          window.openModal('互动卡频率', '', function () {}, { noInput: true, staticText: IC_DETAIL });
        };
        tag.addEventListener('click', showDetail);
        tag.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(); }
        });
      }
      icSync();
      // 切桌面 / 备份回填 / 写日志修正三时机重读显示（与 #515 三页概率行同口径）
      ['contact-switched', 'mochi-restore-done', 'mochi-wrj-heal'].forEach(ev => {
        document.addEventListener(ev, () => { try { icSync(); } catch (e) {} });
      });
      const genRow2 = document.getElementById('row-general');
      if (genRow2) genRow2.addEventListener('click', () => { try { icSync(); } catch (e) {} });
    }
  })();

  // v3.6.x：「保存设置」按钮——把当前页面上所有概率/开关一次性写入本地并提示。
  // 数值本身已随点击即时保存，这里提供明确的「保存」反馈（用户反馈刷新后设置会丢）
  // ===== #1511 「保存设置」不许拿没读全的屏面值整包顶库 =====
  // （#1342 美化方案「无法保存，重新刷新过后数据会被清除」iPhone 实报／#1488 市集冷读顶库同族第三处：
  //   本页＝从存储渲染 →「保存设置」把页面全部 stepper/开关值整包写回。启动回填（idbRestore）
  //   落定前、或这台机 LS 写失败（配额满/杀进程回滚）只靠 IDB 时，屏面值可能是默认/旧账——
  //   此刻整包落笔＝把几十枚键一次性顶回默认/旧值，用户看到「保存了，刷新之后又变回去」。
  //   判据两格，全部当场事实，零机型／零 UA 分支：
  //   ① store.awaitingBigKey＝数据层唯一那把「这一格读空而库里本该有」的尺（四格证人含
  //     启动回填未落定 mochiDataPending）；
  //   ② 启动回填未落定（mochiDataPending）且本会话没动过这一格——LS 里那份可能是写失败
  //     设备的存量旧账（回填对已有 LS 键不覆盖），没动过＝屏面值没有本会话的新意，顶库纯亏。
  //   本会话动过的键（sessionSavedKeys，直接交互已即时落库）屏面即意图，照常写＝同 #1342
  //   「写过即放行」，不把这道闸变成新的存不进去；回填自带 2 分钟上限，健康设备 1~3 秒
  //   落定＝这道闸对绝大多数会话零感知。
  function replyStoreFor(k) {
    if (k.indexOf('gc-') === 0) { try { return window.xyStore ? window.xyStore('xy-home-v2') : null; } catch (e) { return null; } }
    return ls;
  }
  function replyFullKey(k) { return (k.indexOf('gc-') === 0 ? 'reply-gc-' : 'reply-') + k; }
  function replyKeyUnvouched(k) {
    const st = replyStoreFor(k);
    try { if (st && typeof st.awaitingBigKey === 'function' && st.awaitingBigKey(replyFullKey(k))) return true; } catch (e) {}
    try {
      if (!sessionSavedKeys.has(k) && window.mochiDataPending && window.mochiDataPending()) return true;
    } catch (e) {}
    return false;
  }
  function replyAskRehydrate(k) {
    const st = replyStoreFor(k);
    try { if (st && st.requestBigKey) st.requestBigKey(replyFullKey(k)); } catch (e) {}
  }
  function replyBlockedToast() {
    toastReply('部分设置这次没读全（存储正忙），先不覆盖：等几秒再点一次保存即可，不需要重新设置', 3200);
  }
  // v3.26.x：抽出 saveCurrentReplyPage() 公共函数——「保存设置」与「保存全部桌面联系人
  // 设置」共用同一套页面值校验+写入（stepper 范围校验 + 开关落盘），避免两份逻辑漂移
  function saveCurrentReplyPage() {
    const skipped = []; // #1511：读数未确认的键（这格此刻可能是默认/旧账），不拿屏面值顶库
    try {
      document.querySelectorAll('#page-reply-settings .stepper, #page-call-settings .stepper').forEach(st => {
        const k = st.dataset.k;
        if (!k) return; // #518：分类档自定义行无 data-k，跳过防 reply-undefined 落盘
        // 同 syncUI：固定选 input.stp-val，避免转换后误读到 ce-box DIV 的过期 expando
        const val = st.querySelector('input.stp-val');
        if (k && val) {
          if (replyKeyUnvouched(k)) { skipped.push(k); return; } // #1511：这格读数未确认，不拿屏面值顶库
          // 与直接输入同一套范围校验（data-max 缺失 = 不设上限，防 NaN/Infinity 入库）
          const intAttr = (name, def) => { const v = parseInt(st.getAttribute(name), 10); return Number.isNaN(v) ? def : v; };
          const min = intAttr('data-min', 0);
          const max = intAttr('data-max', Infinity);
          let v = parseFloat(val.value);
          if (!isFinite(v)) v = min;
          v = Math.min(max, Math.max(min, v));
          window.saveReplyCfg(k, v);
        }
      });
      ['py-en', 'py-punct-en', 'as-en', 'dnd-en', 'as-badge', 'as-badge-heart', 'as-badge-star', 'as-badge-moon', 'as-badge-spark', 'as-badge-paw', 'as-badge-rand', 'ml-kaomoji-en', 'ml-emoji-en', 'ml-sticker-en', 'cs-normal', 'cs-trigger-name', 'cs-trigger-bar', 'gc-cs-normal', 'gc-cs-trigger-name', 'gc-cs-trigger-bar', 'gc-py-en', 'ai-rps-en', 'ai-game-en', 'ai-cuddle-en', 'ai-cc-en', 'ckq-en', 'call-resume', 'call-no-hangup', 'ml-write-en', 'ml-fish-week-en', 'ml-punct-en', 'fd-post-en', 'fd-punct-en', 'fd-kaomoji-en', 'fd-emoji-en', 'fd-sticker-en', 'fd-image-en', 'qs-en', 'qs-cc', 'qs-one', 'qs-multi', 'qs-noLimit', 'mjf-en', 'mjf-src-cc', 'mjf-src-def', 'mjf-src-dict', 'mjf-mix', 'mjf-punct', 'rc-en', 'rl-en', 'fish-en', 'work-en', 'fish-grab-en', 'rp-thx-en', 'turn-en', 'gc-turn-en'].forEach(k => {
        const el = document.getElementById(k);
        if (el) {
          if (replyKeyUnvouched(k)) { if (skipped.indexOf(k) < 0) skipped.push(k); return; } // #1511：同上，读数未确认不落笔
          window.saveReplyCfg(k, el.checked ? 1 : 0);
        }
      });
    } catch (e) {}
    return skipped;
  }
  function toastReply(msg, ms) {
    const d = ccToastEnsure();
    if (d) { d.textContent = msg; d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show'; clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, ms || 2000); }
  }
  const saveBtn = document.getElementById('reply-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const skipped = saveCurrentReplyPage();
      if (skipped && skipped.length) {
        // #1511：这页还有没读全的格子，整包保存＝拿默认/旧账顶库——不落笔＋请一趟库＋照实说；
        // 回填落定后 mochi-restore-done 会重画本页（下方既有接线），再点一次保存即生效
        replyAskRehydrate(skipped[0]);
        replyBlockedToast();
        return;
      }
      toastReply('已保存全部回复设置');
    });
  }
  // v3.26.x：「保存全部桌面联系人设置」——①先按「保存设置」保存当前桌面联系人；
  // ②把当前生效的全部回复设置（DEFAULTS 全键；gc-* 群聊设置存全局命名空间、不随
  // 桌面隔离，故跳过）同步写入每一个桌面联系人的存储（含 default 桌面，遍历方式与
  // migrateCkqProbOld 同款 storeFor；default 命名空间值写全后 defaultStore 的旧顶层键
  // 回退路径不会命中，无残留旧值风险）。未设置过的键也写入当前生效值（缺省即
  // DEFAULTS），保证同步后各桌面回复设置完全一致。覆盖各桌面现有设置 → openModal
  // 二次确认（同美化方案「应用」弹窗模式，pill 预选「确定保存」保证只点底部确定也生效）
  function saveAllContactsDo() {
    // #1511：同步全部桌面＝拿当前生效值铺满所有联系人——当前页还有没读全的格子时
    //（getCfg 此时读到的会是默认/旧账），这一步会把旧账写进每一个桌面，破坏面比单桌面更大，先拦
    const skipped = saveCurrentReplyPage();
    if (skipped && skipped.length) {
      replyAskRehydrate(skipped[0]);
      replyBlockedToast();
      return;
    }
    let count = 0;
    try {
      if (window.getContacts && window.storeFor) {
        // 刚保存过当前桌面，getCfg 读到的即页面生效值（存储缺省/坏值回 DEFAULTS）
        const cfg = getCfg();
        const cids = [window.__activeCid || 'default'];
        (window.getContacts() || []).forEach(c => { if (c.id && cids.indexOf(c.id) === -1) cids.push(c.id); });
        Object.keys(DEFAULTS).forEach(k => {
          if (k.indexOf('gc-') === 0) return;
          cids.forEach(cid => {
            try { window.storeFor(cid).set('reply-' + k, String(cfg[k])); } catch (e) {}
          });
        });
        count = cids.length;
      }
    } catch (e) {}
    toastReply(count > 1 ? '已保存并同步到全部 ' + count + ' 个桌面联系人' : '已保存全部回复设置', 2400);
  }
  const saveAllBtn = document.getElementById('reply-save-all-btn');
  if (saveAllBtn) {
    saveAllBtn.addEventListener('click', () => {
      if (!window.openModal) { saveAllContactsDo(); return; }
      const ctl = window.openModal('保存全部桌面联系人设置？', '', (v) => {
        if (v !== 'ok') return;
        saveAllContactsDo();
      }, {
        noInput: true, pillSubmit: true,
        staticText: '将把当前桌面联系人的回复设置（回复概率/速度/各类互动开关等）同步写入全部桌面联系人，各桌面现有的回复设置会被覆盖。',
        pills: [{ label: '确定保存', value: 'ok' }]
      });
      // v3.26.x：FIX-REGRESSION #60 教训——pill 不预选时只点底部「确定」传 null 静默无效
      if (ctl && ctl.pills) ctl.pills([{ label: '确定保存', value: 'ok' }], 'ok');
    });
  }
  // v3.6.x：IndexedDB 恢复完成后再同步一次设置页数值——
  // 刷新后立即打开设置页时，IDB 里的旧设置可能还没回填完，页面会显示默认值；
  // 恢复完成后重新 syncUI，保证保存过的设置不「消失」
  try {
    document.addEventListener('mochi-restore-done', () => {
      const page = document.getElementById('page-reply-settings');
      if (page && !page.hidden) syncUI();
    });
  } catch (e) {}

  syncUI();

  // 导航：设置页「回复设置」→ 回复设置页（聊天 tab 默认）
  const genRow = document.getElementById('row-general');
  if (genRow) {
    genRow.addEventListener('click', () => {
      syncUI();
      showPage('page-reply-settings');
    });
  }
  // 单页内三分类 tab 切换
  const rpTab = (k) => {
    document.querySelectorAll('#page-reply-settings .fav-tab[data-rp]').forEach(x => x.classList.toggle('sel', x.dataset.rp === k));
    document.querySelectorAll('#page-reply-settings .gs-panel').forEach(p => { p.hidden = p.dataset.rpanel !== k; });
  };
  document.querySelectorAll('#page-reply-settings .fav-tab[data-rp]').forEach(tab => {
    tab.addEventListener('click', () => rpTab(tab.dataset.rp));
  });
  // v3.44.x：聊天面板二级分类（回复与主动 / 字卡与概率 / 拼字造句）——只切 .rps-panel，不影响上方主 tab
  const rpsTab = (k) => {
    document.querySelectorAll('#page-reply-settings .rps-tab').forEach(x => x.classList.toggle('sel', x.dataset.rps === k));
    document.querySelectorAll('#page-reply-settings .rps-panel').forEach(p => { p.hidden = p.dataset.rps !== k; });
    const sc = document.querySelector('#page-reply-settings .gs-scroll');
    if (sc) sc.scrollTop = 0;
  };
  document.querySelectorAll('#page-reply-settings .rps-tab').forEach(tab => {
    tab.addEventListener('click', () => rpsTab(tab.dataset.rps));
  });
  // 返回：设置页
  const replyBack = document.getElementById('reply-back');
  if (replyBack) {
    replyBack.addEventListener('click', () => {
      showPage('page-setting');
    });
  }
  // 通话设置返回
  const calsBack = document.getElementById('cals-back');
  if (calsBack) {
    calsBack.addEventListener('click', () => {
      showPage('page-setting');
    });
  }
  // v3.20.x：跨桌面查岗默认概率 8% → 2% 的旧值迁移——把已写盘的旧默认 8 强改成 2。
  // 扫描全部桌面联系人（含默认桌面）的 reply-ckq-prob，只要精确等于旧默认 8 就改写为 2；
  // 用户自己调过（非 8）的值不动，避免误伤自定义。挂载点放文件尾，依赖 getContacts/storeFor 已就绪。
  function migrateCkqProbOld() {
    try {
      if (!window.getContacts || !window.storeFor) return;
      const cids = [window.__activeCid || 'default'];
      (window.getContacts() || []).forEach(c => { if (c.id && cids.indexOf(c.id) === -1) cids.push(c.id); });
      let changed = false;
      cids.forEach(cid => {
        try {
          const s = window.storeFor(cid);
          if (!s) return;
          const v = s.get('reply-ckq-prob');
          if (String(v) === '8') { s.set('reply-ckq-prob', '2'); changed = true; }
        } catch (e) {}
      });
      if (changed) {
        try { if (window.console && console.log) console.log('[reply-settings] 已迁移跨桌面查岗旧概率 8→2'); } catch (e) {}
      }
    } catch (e) {}
  }
  migrateCkqProbOld();
  // v3.27.x：信箱最长写信/回信时间默认 120 → 480 的旧值迁移——扫描全部桌面联系人
  // （含默认桌面）的 reply-ml-write-max / reply-ml-reply-max，只要仍等于旧默认 120
  // （即用户从未改动过默认数值）就改写为 480；用户自己调过（非 120）的值不动，避免误伤自定义。
  function migrateMailMaxOld() {
    try {
      if (!window.getContacts || !window.storeFor) return;
      const cids = [window.__activeCid || 'default'];
      (window.getContacts() || []).forEach(c => { if (c.id && cids.indexOf(c.id) === -1) cids.push(c.id); });
      const pairs = [['reply-ml-write-max', '480'], ['reply-ml-reply-max', '480']];
      let changed = false;
      cids.forEach(cid => {
        try {
          const s = window.storeFor(cid);
          if (!s) return;
          pairs.forEach(([k, nv]) => {
            if (String(s.get(k)) === '120') { s.set(k, nv); changed = true; }
          });
        } catch (e) {}
      });
      if (changed) {
        try { if (window.console && console.log) console.log('[reply-settings] 已迁移信箱最长写信/回信时间旧值 120→480'); } catch (e) {}
      }
    } catch (e) {}
  }
  migrateMailMaxOld();
  // v3.40.x #388：词典拼字「混用自定义字卡」默认改回 1 的反向迁移——v3.28.x #310 曾把
  // 默认 1→0 并把经历过上轮迁移（reply-qs-cc-migrated=1）且值为 1 的桌面改写为 0；现在
  // 用户点名「混用自定义字卡需要默认开启」，这里反向补迁：标记=1 且当前值为 0 的桌面改回
  // 1，标记升级为 2（防重复跑；新装设备从未经历上轮迁移、标记缺失，默认 1 直接生效不进本
  // 函数分支）。上轮迁移后自行关闭的与被迁移成 0 的无法区分，会被一并打开一次（同 #310
  // 当时的取舍）；此后用户再自行关闭（标记=2）不再被纠正。
  function migrateQsCcOld() {
    try {
      if (!window.getContacts || !window.storeFor) return;
      const cids = [window.__activeCid || 'default'];
      (window.getContacts() || []).forEach(c => { if (c.id && cids.indexOf(c.id) === -1) cids.push(c.id); });
      let changed = false;
      cids.forEach(cid => {
        try {
          const s = window.storeFor(cid);
          if (!s) return;
          if (String(s.get('reply-qs-cc-migrated')) !== '1') return;
          if (String(s.get('reply-qs-cc')) === '0') { s.set('reply-qs-cc', '1'); changed = true; }
          s.set('reply-qs-cc-migrated', '2');
        } catch (e) {}
      });
      if (changed) {
        try { if (window.console && console.log) console.log('[reply-settings] 已反向迁移词典拼字混用自定义字卡 0→1（#310 存量补迁，#388）'); } catch (e) {}
      }
    } catch (e) {}
  }
  migrateQsCcOld();
  // v3.42.x #443：逐卡连发「不受条数限制」旧默认 1→0 的一次性收口迁移——旧默认 '1' 会随
  // 「保存设置」按钮全量写盘，仅翻 DEFAULTS 对已写盘设备不生效，这里把存量为 '1' 的桌面
  // 改写为 '0'。必须用标记键（reply-qs-nl-migrated）只跑一轮、不能用 ckq/mail 那种
  // 「值等旧默认即改写」式：'1' 既是旧默认值也是合法的手动选择，值式会在用户之后每一次
  // 手动打开「不受限」时被加载反复改回。用户自己关过（'0'，本就受限）的值不动。
  function migrateQsNoLimitOld() {
    try {
      if (!window.getContacts || !window.storeFor) return;
      const cids = [window.__activeCid || 'default'];
      (window.getContacts() || []).forEach(c => { if (c.id && cids.indexOf(c.id) === -1) cids.push(c.id); });
      let changed = false;
      cids.forEach(cid => {
        try {
          const s = window.storeFor(cid);
          if (!s) return;
          if (String(s.get('reply-qs-nl-migrated')) === '1') return;
          if (String(s.get('reply-qs-noLimit')) === '1') { s.set('reply-qs-noLimit', '0'); changed = true; }
          s.set('reply-qs-nl-migrated', '1');
        } catch (e) {}
      });
      if (changed) {
        try { if (window.console && console.log) console.log('[reply-settings] 已迁移逐卡连发不受条数限制旧默认 1→0（#443）'); } catch (e) {}
      }
    } catch (e) {}
  }
  migrateQsNoLimitOld();
  // FIX 2026-09-17 #644：逐卡连发「不受条数限制」默认翻回 1 的反向补迁——#443 的
  // migrateQsNoLimitOld 已把各桌面存盘的 '1' 收成 '0' 并落标记 reply-qs-nl-migrated=1；
  // 现在用户翻案（多机型报「默认开启、按钮却是关的」），对经历过上轮迁移（标记=1）且
  // 当前值为 '0' 的桌面改回 '1'，标记升级为 2（防重复跑；新装设备从未经历迁移、标记缺失，
  // DEFAULTS=1 直接生效不进本函数分支）。上轮迁移后用户手动关过的与被迁移成 '0' 的无法
  // 区分，会被一并打开一次（同 #310/#388 的取舍）；此后用户再自行关闭（标记=2）不再被纠正。
  function migrateQsNoLimitBack() {
    try {
      if (!window.getContacts || !window.storeFor) return;
      const cids = [window.__activeCid || 'default'];
      (window.getContacts() || []).forEach(c => { if (c.id && cids.indexOf(c.id) === -1) cids.push(c.id); });
      let changed = false;
      cids.forEach(cid => {
        try {
          const s = window.storeFor(cid);
          if (!s) return;
          if (String(s.get('reply-qs-nl-migrated')) !== '1') return;
          if (String(s.get('reply-qs-noLimit')) === '0') { s.set('reply-qs-noLimit', '1'); changed = true; }
          s.set('reply-qs-nl-migrated', '2');
        } catch (e) {}
      });
      if (changed) {
        try { if (window.console && console.log) console.log('[reply-settings] 已反向迁移逐卡连发不受条数限制 0→1（#443 存量补迁，#644）'); } catch (e) {}
      }
    } catch (e) {}
  }
  migrateQsNoLimitBack();
  // v3.26.x #513：「梦角自由造句」总开关（mjf-en）与「混合模式」（mjf-mix）默认 0→1 的
  // 一次性收口迁移——用户点名「梦角自由造句和梦角自由造句的混合模式需要默认打开」。
  // 与 #443 同因：旧默认 '0' 会随「保存设置」按钮全量写盘（saveCurrentReplyPage 把开关清单
  // 整表落盘），仅翻 DEFAULTS 对已写盘设备不生效（用户会报「设了默认开但还是关的」）。
  // 必须用标记键（reply-mjf-on-migrated）只跑一轮、不能用「值等旧默认即改写」式：'0' 既是
  // 旧默认值也是合法的手动关闭选择，值式会在用户之后每一次手动关闭时被加载反复改回。
  // 取舍（同 #310/#443）：全量写盘的 '0' 与用户手动关掉的 '0' 无法区分，会被一并打开一次；
  // 此后用户再自行关闭（标记已落）不再被纠正。缺键设备（从未保存过）本就走 DEFAULTS=1，
  // 不需迁移也不写标记（写入只会多一条无用键）。
  // FIX 2026-09-15 #513 存量 mjf-en/mjf-mix 旧默认 '0' → '1' 一次性收口（标记键 reply-mjf-on-migrated）
  function migrateMjfOn() {
    try {
      if (!window.getContacts || !window.storeFor) return;
      const cids = [window.__activeCid || 'default'];
      (window.getContacts() || []).forEach(c => { if (c.id && cids.indexOf(c.id) === -1) cids.push(c.id); });
      const changed = [];
      cids.forEach(cid => {
        try {
          const s = window.storeFor(cid);
          if (!s) return;
          if (String(s.get('reply-mjf-on-migrated')) === '1') return;
          ['mjf-en', 'mjf-mix'].forEach(k => {
            if (String(s.get('reply-' + k)) === '0') { s.set('reply-' + k, '1'); changed.push(cid + ':' + k); }
          });
          s.set('reply-mjf-on-migrated', '1');
        } catch (e) {}
      });
      if (changed.length) {
        try { if (window.console && console.log) console.log('[reply-settings] 已迁移梦角自由造句/混合模式旧默认 0→1（#513）：' + changed.join(', ')); } catch (e) {}
      }
    } catch (e) {}
  }
  migrateMjfOn();

  // ===== v3.27.x #218：互动频率引导提示（纯提醒，不改任何默认值） =====
  // 背景：系统设置默认全开（设计如此，见开屏公告第八章），但总有用户觉得「概率太高」；
  // 开关/概率集中在「设置 → 回复设置」，抱怨的用户不知道入口在哪。
  // 方案：TA 主动消息 / 一次连发多条 / 互动邀请随机触发、且用户正看着聊天页时，弹一条
  // 可点的提示条引导去回复设置自行调低或关闭。频控=每天最多一次（reply-guide-day 存当日
  // 日期，同日重复触发静默；用户决策：不设总次数上限，一天一条不烦人），点过提示条或
  // 手动进过回复设置页（row-general 点击）即永久关闭（reply-guide-done）。
  // 触发点在 chat.js 三处一行调用 window.replyGuideHint(kind)；聊天页不可见时静默跳过、不占当日名额。
  function rgToday() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function rgDone() {
    try { return ls.get('reply-guide-done') === '1'; } catch (e) { return false; }
  }
  window.replyGuideHint = function (kind) {
    try {
      const pg = document.getElementById('page-chat');
      if (!pg || pg.hidden) return;
      if (rgDone()) return;
      let shownDay = '';
      try { shownDay = ls.get('reply-guide-day'); } catch (e) {}
      if (shownDay === rgToday()) return; // 今天已弹过，同日不再打扰
      try { ls.set('reply-guide-day', rgToday()); } catch (e) {}
      let bar = document.getElementById('reply-guide-hint');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'reply-guide-hint';
        bar.innerHTML = '<span class="rgh-txt"></span><span class="rgh-go">去调整</span>';
        bar.addEventListener('click', () => {
          try { ls.set('reply-guide-done', '1'); } catch (e) {}
          clearTimeout(bar._rgT);
          bar.classList.remove('show');
          // 跳转：先点底部「设置」tab（tabs.js 接管页面显隐与高亮），再点「回复设置」入口行
          const tab = document.querySelector('.tab[data-page="page-setting"]');
          if (tab) tab.click();
          const genRow = document.getElementById('row-general');
          if (genRow) genRow.click();
        });
        document.body.appendChild(bar);
      }
      const txt = bar.querySelector('.rgh-txt');
      if (txt) {
        txt.textContent = kind === 'py' ? 'TA 一次连发多条是随机概率触发的，嫌频繁可在「设置 → 回复设置」调低或关闭'
          : kind === 'inv' ? 'TA 的互动邀请是随机概率触发的，可在「设置 → 回复设置」调低或关闭'
          : 'TA 的主动消息是随机概率触发的，嫌频繁可在「设置 → 回复设置」调低或关闭';
      }
      bar.classList.add('show');
      clearTimeout(bar._rgT);
      bar._rgT = setTimeout(() => { try { bar.classList.remove('show'); } catch (e) {} }, 12000);
    } catch (e) {}
  };
  // 手动点开过回复设置页 = 用户已知道入口，不再弹提示
  const rgGenRow = document.getElementById('row-general');
  if (rgGenRow) rgGenRow.addEventListener('click', () => { try { ls.set('reply-guide-done', '1'); } catch (e) {} });
})();
