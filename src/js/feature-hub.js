// ===== 功能：功能大全（设置 → 功能大全，#305）=====
// 需求（用户 2026-09-11）：设置里新增一个和【回音机】【功能大全】一样的功能——
// 全应用功能的可搜索索引页，点条目直达对应功能。灵感来源：回音机。
// #305b 重构（用户 2026-09-13 反馈「打开后一页 84 行太杂」）：默认「全部分组平铺」改为
// 「热门直达 + 分类宫格首页 → 点分类进该组列表」，顶部 tag 在列表态可互相切换/回首页；
// 搜索保持全局跨组（命中行按组显示），清空搜索回到进入前的视图。
// v3.27.x 全量收口（用户 2026-09-15 要求「全部大小功能都做进去」）：7 组 100 条 → 9 组 186 条——
// 新增「聊天美化与设置」（聊天设置子页逐行直达：气泡字号/框大小/圆角/双方气泡与文字颜色/
// 气泡CSS/全局字体/双方昵称头像/头像形状/时间轴/发送按钮系列/红包概率/记录导出导入清空等）与
// 「桌面美化与外观」（page-theme 逐行直达：主题色/组件颜色系列/桌面字号/卡片大小/壁纸系列/
// 图标系列/美化方案系列），聊天传讯补 5 条「现在问/出题/好奇/邀请/吐槽」，字卡库补 11 条
// 公用·专属·我的添加变体，系统组补字卡锁；同名功能只留一条（全局字体走桌面组，聊天设置同功能互通）。
// 跳转机制：go 数组里的选择器按顺序逐个 .click()——各功能的打开逻辑都绑定在既有入口元素上
//（桌面图标 .app[data-app=…] / 设置行 #row-* / 聊天更多面板按钮 #more-* / 字卡库列表项 #li-*），
// 且均为同步 handler、首个元素的处理函数都会切页，链式点击即完整复现用户的操作路径，
// 本文件不重复实现任何打开逻辑（功能入口变了跟着改 go 数组即可）。
// where：没有可靠直达入口的功能，点击弹位置提示，不乱跳。
// 纯本地、无网络请求；唯一写入键 xy-home-v2:fhub-freq（常用功能点击计数，LS+IDB 双写，
// 全局键不区分联系人——目录索引与跳转目标都是全局的）。
(function () {
  // ---- 目录数据：g 组名 / n 名称 / d 一句话 / k 搜索关键词（含别名） / go 入口选择器链 / where 位置提示 ----
  const HUB = [
    { g: '聊天传讯', items: [
      { n: '聊天', d: '和 TA 的主聊天：字卡回复、图文、引用、撤回补发', k: '聊天 消息 字卡', go: ['.app[data-app="chat"]'] },
      { n: '群聊', d: '所有桌面成员聚在一个窗口聊天（需先在设置开启群聊模式）', k: '群聊 多人', go: ['.app[data-app="group-chat"]'] },
      { n: '群聊设置', d: '群聊形象/气泡样式/表情图片语音等触发概率/群聊美化', k: '群聊 设置 概率 美化 气泡 形象', go: ['.app[data-app="group-chat"]', '#gc-more-btn', '#gc-more-settings'] },
      { n: '群成员管理', d: '成员列表/改成员名；点成员头像可拍一拍 TA', k: '群聊 成员 管理 改名 拍一拍', go: ['.app[data-app="group-chat"]', '#gc-more-btn', '#gc-more-members'] },
      { n: '群分组管理', d: '多个群聊的新建/切换/删除与分组', k: '群聊 分组 新建 切换 删除 多群', go: ['.app[data-app="group-chat"]', '#gc-more-btn', '#gc-more-groups'] },
      { n: '群聊批量发送', d: '群里一次编排多条消息（表情/图片/文字）按顺序发送', k: '群聊 批量 连发', go: ['.app[data-app="group-chat"]', '#gc-batch-btn'] },
      { n: '群聊 @ 成员', d: '在群里 @ 某位成员发消息', k: '群聊 at 艾特 提及 @', go: ['.app[data-app="group-chat"]', '#gc-more-btn', '#gc-more-at'] },
      { n: '聊天设置', d: '聊天壁纸、气泡样式颜色、字体大小行距', k: '壁纸 气泡 字体 美化', go: ['.app[data-app="chat"]', '#chat-settings-btn'] },
      { n: '回复设置', d: 'TA 的回复速度/条数/各类行为概率，全部可调', k: '概率 参数 速度 条数 主动', go: ['#row-general'] },
      { n: '联系人 / 多桌面', d: '新建/改名/删除/切换联系人，数据互相独立', k: '联系人 桌面 切换', go: ['#row-contacts'] },
      { n: '搜索聊天记录', d: '按关键词/日期搜聊天记录并跳转', k: '搜索 查找 记录', go: ['.app[data-app="chat"]', '#more-search'] },
      { n: '批量发送', d: '一次编排多条消息（表情/图片/文字）按顺序发送', k: '批量 连发', go: ['.app[data-app="chat"]', '#chat-batch-btn'] },
      { n: '语音消息', d: '录音最长 60 秒，试听后发语音', k: '语音 录音 麦克风', go: ['.app[data-app="chat"]', '#chat-mic-btn'] },
      { n: '继续说', d: '让 TA 接着当前话题再说一段（输入栏「继续说」按钮）', k: '继续说 接着 续聊 续写', where: '聊天输入栏上的「继续说」按钮' },
      { n: '表情包管理', d: '我的表情包分组/上传/批量删除（聊天表情面板；面板顶部有「⏱ 最近使用」分组，自动记最近发过的表情）', k: '表情包 表情 管理 上传 分组 斗图 最近使用 常用', go: ['.app[data-app="chat"]', '#chat-emoji-btn'] },
      { n: '批量提问问卷', d: '你批量出题，TA 限时作答交卷', k: '问卷 提问 批量 出题 考试 答题', go: ['.tab[data-page="page-chatcard"]', '#li-ta-ask', '#ta-ask-survey-open'] },
      { n: '拍一拍', d: '拍 TA 一下，TA 也会拍回来', k: '拍一拍 互动', go: ['.app[data-app="chat"]', '#more-poke'] },
      { n: '引用回复', d: '引用某条消息回复，可带表情包+文字', k: '引用 回复', where: '聊天里长按任意消息' },
      { n: '通话', d: '拨打/接听电话，可设自定义铃声与背景；跨桌面来电（默认关闭，设置里手动开启）接听会自动跳到对方桌面（通话与记录归属对方桌面，刻意设计）', k: '电话 通话 打电话 跨桌面来电 来电记录', go: ['.app[data-app="chat"]', '#more-call'] },
      { n: '邀请 TA', d: '发邀请字卡（预设+自定义，可重复发送）', k: '邀请 约会', go: ['.app[data-app="chat"]', '#more-invite'] },
      { n: '问问 TA / TA 的提问', d: '让 TA 现在问你一次（提问/选择题/好奇/吐槽），或向 TA 发问', k: '提问 问问 问题 选择题 好奇 吐槽 现在', go: ['.app[data-app="chat"]', '#more-ask'] },
      { n: '现在让 TA 问一次', d: '不开面板，直接让 TA 立刻发来一个开放式提问', k: '现在 问 提问 询问 立刻', go: ['.app[data-app="chat"]', '#more-ask-now'] },
      { n: '现在让 TA 出选择题', d: '直接让 TA 立刻发来一道小问题（选择题）', k: '现在 选择题 小问题 出题 立刻', go: ['.app[data-app="chat"]', '#more-choose-now'] },
      { n: '现在让 TA 好奇一次', d: '直接让 TA 立刻发来一条好奇提问', k: '现在 好奇 提问 立刻', go: ['.app[data-app="chat"]', '#more-curious-now'] },
      { n: '现在让 TA 邀请一次', d: '直接让 TA 立刻发来猜拳/Pong/贪吃蛇/贴贴邀请', k: '现在 邀请 猜拳 对战 贴贴 立刻', go: ['.app[data-app="chat"]', '#more-invite-now'] },
      { n: '现在让 TA 吐槽一次', d: '直接让 TA 立刻发来一条吐槽/调侃', k: '现在 吐槽 调侃 立刻', go: ['.app[data-app="chat"]', '#more-roast-now'] },
      { n: '收藏', d: '我的收藏 / TA 的收藏 分页浏览与批量管理', k: '收藏 星标', go: ['.app[data-app="note"]'] },
      { n: '收藏设置', d: 'TA 自动收藏消息/字卡/信件/动态的概率与统计', k: '收藏 设置 概率 自动收藏', go: ['.app[data-app="note"]', '#fav-settings-btn'] },
      { n: '词典拼字', d: '语录字卡按概率拼成单气泡/逐条连发，两形态可开关', k: '拼字 词典 语录 连发', go: ['#row-general'] },
      { n: '梦角自由造句', d: 'TA 按概率截词重造句，语料来源与权重可调', k: '造句 自由造句 梦角 截词', go: ['#row-general'] }
    ] },
    { g: '聊天美化与设置', items: [
      { n: '聊天设置（总入口）', d: '聊天壁纸、气泡样式颜色、字体大小行距的设置子页', k: '聊天设置 美化 壁纸 气泡', go: ['.app[data-app="chat"]', '#chat-settings-btn'] },
      { n: '上传聊天壁纸', d: '给聊天页设置自定义背景图（自动压缩防卡顿）', k: '聊天 壁纸 背景 上传 图片', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-bg-upload'] },
      { n: '移除聊天壁纸', d: '清掉聊天页背景图恢复默认', k: '聊天 壁纸 移除 删除 背景', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-bg-remove'] },
      { n: '聊天气泡字体大小', d: '气泡内文字字号，默认 14px 可自定义', k: '字体 字号 大小 文字 气泡', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-font-size'] },
      { n: '聊天气泡框大小', d: '气泡内边距（胖瘦），预设或自定义', k: '气泡 大小 框 内边距 胖瘦', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-bubble-size'] },
      { n: '聊天气泡边缘圆角', d: '气泡四角圆角直径，方形到全圆可调', k: '气泡 圆角 边缘 方形', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-bubble-radius'] },
      { n: '聊天头像形状', d: '聊天头像圆形/方形切换', k: '头像 形状 圆形 方形', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-av-shape'] },
      { n: '时间轴样式', d: '消息时间轴显示位置样式（头像下方等多种）', k: '时间轴 时间 样式 位置', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-time-style'] },
      { n: '我的气泡颜色', d: '自己发的消息气泡背景色', k: '气泡 颜色 我的 背景', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-out-bg'] },
      { n: '我的消息文字颜色', d: '自己发的消息文字颜色', k: '文字 颜色 我的 消息', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-out-ink'] },
      { n: '联系人气泡颜色', d: 'TA 发的消息气泡背景色', k: '气泡 颜色 联系人 TA 背景', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-in-bg'] },
      { n: '联系人消息文字颜色', d: 'TA 发的消息文字颜色', k: '文字 颜色 联系人 TA 消息', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-in-ink'] },
      { n: '气泡 CSS', d: '自定义 CSS 进一步美化气泡（进阶）', k: 'css 样式 美化 气泡 进阶', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-css'] },
      // #577：昵称分「桌面 / 聊天」两套且互不同步——关键词补上「桌面昵称 / 不同步 / 不一样」，
      // 用户搜「聊天里名字跟桌面不一样」「改了桌面聊天没变」能搜到这两条并直达设置行。
      { n: '联系人昵称', d: '改 TA 在聊天里的显示昵称（桌面昵称与聊天昵称互不同步，要各自设置）', k: '昵称 名字 联系人 改名 聊天昵称 桌面昵称 不同步 不一样 没变 显示 TA', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-lbl-partner'] },
      { n: '我的昵称', d: '改我在聊天里的显示昵称（桌面昵称与聊天昵称互不同步，要各自设置）', k: '昵称 名字 我的 改名 聊天昵称 桌面昵称 不同步 不一样 没变 显示', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-lbl-user'] },
      { n: '联系人头像', d: '换 TA 的头像（可上传/清空）', k: '头像 联系人 换 上传', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-avatar-partner'] },
      { n: '我的头像', d: '换我的头像（可上传/清空）', k: '头像 我的 换 上传', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-avatar-user'] },
      { n: '隐藏发送按钮', d: '隐藏聊天输入栏发送按钮（仍可回车发送）', k: '发送 按钮 隐藏 输入', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-send-show'] },
      { n: '回车键发送消息', d: '回车直接发送开关（关闭则换行）', k: '回车 发送 enter 换行', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-enter-send'] },
      { n: '发送按钮颜色', d: '发送按钮背景色自定义', k: '发送 按钮 颜色 背景', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-send-bg'] },
      { n: '发送文字颜色', d: '发送按钮文字颜色自定义', k: '发送 文字 颜色 按钮', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-send-ink'] },
      { n: '我可发送语音', d: '输入栏语音按钮显隐开关', k: '语音 录音 麦克风 开关', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-voice-send'] },
      { n: 'TA 自动发红包概率', d: 'TA 聊天中主动发红包的触发概率（红包页面→设置）', k: '红包 概率 自动 触发', go: ['.app[data-app="chat"]', '#more-rp', '#rp-settings-btn'] },
      { n: 'TA 每日发红包上限', d: 'TA 每天最多主动发几个红包（红包页面→设置）', k: '红包 上限 每日 次数', go: ['.app[data-app="chat"]', '#more-rp', '#rp-settings-btn'] },
      { n: '隐藏联系人的表情包', d: '聊天里不显示 TA 发的表情包图片', k: '表情包 隐藏 贴图', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-hide-ta-sticker'] },
      { n: '聊天全屏模式', d: '隐藏模拟状态栏让聊天页全屏', k: '全屏 状态栏 隐藏', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-fullscreen'] },
      { n: '全屏边缘防误触', d: '全屏时边缘手势防误触保护', k: '全屏 边缘 防误触 手势', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-edge-guard'] },
      { n: '隐藏音乐悬浮小窗', d: '听歌时的悬浮小窗显隐开关', k: '音乐 悬浮 小窗 隐藏', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-music-float'] },
      { n: '隐藏通话小框', d: '通话时的迷你悬浮条显隐开关', k: '通话 小框 悬浮 迷你 隐藏', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-call-mini-hide'] },
      { n: '导出聊天记录', d: '导出当前桌面聊天记录为文件', k: '导出 聊天记录 备份', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-export-msgs'] },
      { n: '导入聊天记录', d: '从导出文件恢复当前桌面聊天记录', k: '导入 聊天记录 恢复', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-import-msgs'] },
      { n: '导出全部桌面聊天记录', d: '一次性导出所有联系人的聊天记录', k: '导出 全部 聊天记录 批量 备份', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-export-all'] },
      { n: '导入全部桌面聊天记录', d: '一次性恢复所有联系人的聊天记录', k: '导入 全部 聊天记录 批量 恢复', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-import-all'] },
      { n: '删除全部聊天记录', d: '清空当前桌面全部聊天记录（不可恢复）', k: '删除 清空 聊天记录 重置', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-clear-msgs'] },
      { n: '允许删除联系人消息', d: '开关：是否允许删掉 TA 发的消息', k: '删除 撤回 联系人 消息 开关', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#cs-del-ta-msg'] },
      { n: '保存当前为聊天美化方案', d: '把当前聊天外观（气泡/壁纸/字体等）存成方案', k: '聊天 美化 方案 保存', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#row-chat-beauty-save'] },
      { n: '我的聊天美化方案', d: '已存聊天美化方案的管理与一键切换', k: '聊天 美化 方案 切换 管理', go: ['.app[data-app="chat"]', '#chat-settings-btn', '#row-chat-beauty-schemes'] }
    ] },
    { g: '字卡库', items: [
      { n: '字卡库', d: '全部字卡的统一入口：公用/专属/预设/情绪/回应…', k: '字卡库 词库', go: ['.tab[data-page="page-chatcard"]'] },
      { n: '词典字卡', d: '独立词典大分类：TA 说话的词库来源管理', k: '词典 词库 大分类', go: ['.tab[data-page="page-chatcard"]', '#li-dict-cards'] },
      { n: '公用自定义字卡', d: '自建的公用字卡：全桌面共享，每个联系人都能收到', k: '公用 自定义 字卡 共享', go: ['.tab[data-page="page-chatcard"]', '#li-custom-cards-public'] },
      { n: '公用 / 专属自定义字卡', d: '自建字卡：公用全桌面共享，专属仅当前 TA', k: '自定义 公用 专属', go: ['.tab[data-page="page-chatcard"]', '#li-custom-cards'] },
      { n: '系统预设字卡', d: '内置词库逐句开关，含词典语录分类', k: '预设 内置 词典 语录', go: ['.tab[data-page="page-chatcard"]', '#li-default-cards'] },
      { n: '聊天情绪字卡', d: '情绪/心意/交流意图词库，按心情匹配', k: '情绪 心意 交流意图', go: ['.tab[data-page="page-chatcard"]', '#li-mood-cards'] },
      { n: '聊天回应字卡', d: '游戏胜负平局等场景的回应词库', k: '回应 游戏 胜利 失败', go: ['.tab[data-page="page-chatcard"]', '#li-reply-cards'] },
      { n: '语录字卡', d: '今日情话等语录内容管理', k: '语录 情话', go: ['.tab[data-page="page-chatcard"]', '#li-quote-cards'] },
      { n: '今日情话·我的添加', d: '你添加的桌面每日情话内容', k: '情话 语录 我的添加', go: ['.tab[data-page="page-chatcard"]', '#li-quote-cards-mine'] },
      { n: '其他互动功能字卡', d: '摸鱼/吃饭/经期/喝水/花园等功能触发字卡', k: '互动 功能字卡 摸鱼 经期 喝水', go: ['.tab[data-page="page-chatcard"]', '#li-fun-cards'] },
      { n: '功能字卡·公用', d: '添加的功能字卡（公用池）：每个桌面的联系人都能使用', k: '功能字卡 公用 互动', go: ['.tab[data-page="page-chatcard"]', '#li-fun-cards-public'] },
      { n: '功能字卡·专属', d: '添加的功能字卡（专属池）：只有当前桌面的联系人能使用', k: '功能字卡 专属 互动', go: ['.tab[data-page="page-chatcard"]', '#li-fun-cards-mine'] },
      { n: 'TA 的提问字卡', d: '询问/小问题/好奇/吐槽/邀请 题库自定义', k: '提问 题库 询问 好奇 吐槽', go: ['.tab[data-page="page-chatcard"]', '#li-ta-ask'] },
      { n: 'TA的询问·我的添加', d: '你添加的开放式提问内容', k: '询问 提问 我的添加', go: ['.tab[data-page="page-chatcard"]', '#li-ta-ask-mine'] },
      { n: 'TA 的心情字卡', d: 'TA 聊天中主动分享心情/状态的概率与词库', k: '心情 状态 主动分享', go: ['.tab[data-page="page-chatcard"]', '#li-ta-mood'] },
      { n: 'TA 的选择题字卡', d: 'TA 出选择题考你/让你选的题库自定义', k: '选择题 提问 选择', go: ['.tab[data-page="page-chatcard"]', '#li-ta-choose'] },
      { n: 'TA的小问题·我的添加', d: '你添加的选择题内容', k: '选择题 小问题 我的添加', go: ['.tab[data-page="page-chatcard"]', '#li-ta-choose-mine'] },
      { n: 'TA 的好奇字卡', d: 'TA 好奇问你问题的题库自定义', k: '好奇 提问 问题', go: ['.tab[data-page="page-chatcard"]', '#li-ta-curious'] },
      { n: 'TA的好奇·我的添加', d: '你添加的好奇提问内容', k: '好奇 提问 我的添加', go: ['.tab[data-page="page-chatcard"]', '#li-ta-curious-mine'] },
      { n: 'TA 的吐槽字卡', d: 'TA 吐槽/调侃内容的题库自定义', k: '吐槽 调侃', go: ['.tab[data-page="page-chatcard"]', '#li-ta-roast'] },
      { n: 'TA的吐槽·我的添加', d: '你添加的吐槽字卡内容', k: '吐槽 调侃 我的添加', go: ['.tab[data-page="page-chatcard"]', '#li-ta-roast-mine'] },
      { n: 'TA 的邀请字卡', d: 'TA 主动发来的猜拳/游戏/贴贴邀请题库', k: '邀请 猜拳 游戏 贴贴', go: ['.tab[data-page="page-chatcard"]', '#li-ta-invite'] },
      { n: 'TA的邀请·我的添加', d: '你添加的邀请话术内容', k: '邀请 话术 我的添加', go: ['.tab[data-page="page-chatcard"]', '#li-ta-invite-mine'] },
      { n: '字卡库完整导出', d: '仅导出全部字卡库内容（区别于整包备份）', k: '字卡库 导出 完整 备份', go: ['.tab[data-page="page-chatcard"]', '#li-cc-full-export'] },
      { n: '字卡库完整导入', d: '从字卡库导出文件恢复全部字卡', k: '字卡库 导入 完整 恢复', go: ['.tab[data-page="page-chatcard"]', '#li-cc-full-import'] },
      { n: '查岗互动字卡', d: '温柔关心式查岗问题卡内容自定义', k: '查岗 定位', go: ['.tab[data-page="page-chatcard"]', '#li-ta-checkin'] },
      { n: 'TA的查岗·我的添加', d: '你添加的查岗问题内容', k: '查岗 问题 我的添加', go: ['.tab[data-page="page-chatcard"]', '#li-ta-checkin-mine'] },
      { n: '寻踪日常字卡', d: 'TA 的日常/在哪里/在做什么/想对你说 内容', k: '寻踪 日常 位置', go: ['.tab[data-page="page-chatcard"]', '#li-loc-cards'] },
      { n: '寻踪日常·我的添加', d: '你添加的地点/做的事/说的话内容', k: '寻踪 日常 我的添加 地点', go: ['.tab[data-page="page-chatcard"]', '#li-checkin-cards-mine'] },
      { n: '桌面查岗字卡', d: '联系人跨桌面查岗的系统预设字卡管理', k: '桌面查岗 跨桌面', go: ['.tab[data-page="page-chatcard"]', '#li-deskcheck'] },
      { n: '贴贴邀请字卡', d: '贴贴/抱抱/牵手等邀请的内容词库', k: '贴贴 抱抱 牵手', go: ['.tab[data-page="page-chatcard"]', '#li-checkin-cards'] }
    ] },
    { g: '互动与心意', items: [
      { n: '红包', d: '双向红包：预设档/随机/自定义金额、留言与封面', k: '红包 转账 钱', go: ['.app[data-app="chat"]', '#more-rp'] },
      { n: '心意币 · 心意市集', d: '220+ 件商品分 12 类，送礼给 TA；也能许愿让 TA 挑一件送你（桌面有独立图标）', k: '市集 商店 礼物 购买 心意币 心愿单 许愿 TA送我 联系人送我礼物 概率', go: ['.app[data-app="market"]'] },
      { n: '心意柜', d: '收到/送出的礼物册与统计（桌面有独立图标）', k: '礼物柜 收藏 礼物', go: ['.app[data-app="giftbox"]'] },
      // #577b：换聊天头像的两条路都要能被搜到——①聊天设置 → 形象（单张上传 / 清空）
      // ②聊天页「更多功能」→ 头像互动（多张头像库 + 点图即换 + 定时随机换）；两条都只改聊天域
      { n: '头像互动', d: '换聊天头像：上传多张头像库、点图即换，可开随机自动换头像（与桌面头像独立）', k: '头像 换头像 头像库 上传头像 随机换头像 自动换头像 主动给我换头像 桌面头像', go: ['.app[data-app="chat"]', '#more-avatar'] },
      { n: '漂流瓶', d: '两个世界之间的海：捡瓶子/放瓶子', k: '漂流瓶 海 瓶子', go: ['.app[data-app="chat"]', '#more-drift'] },
      { n: '帮我决定', d: '是/否或自定义选项随机决定，结果可发聊天', k: '决定 选择 纠结', go: ['.app[data-app="chat"]', '#more-decide'] },
      { n: '多人决定', d: '成员名单各自随机出结果，逐行发送', k: '多人 决定 抽签', go: ['.app[data-app="chat"]', '#more-gdecide'] },
      { n: '占卜', d: '塔罗 78 张 / 雷诺曼 40 张，三种牌阵', k: '占卜 塔罗 雷诺曼 运势', go: ['.app[data-app="divination"]'] },
      { n: '寻踪 · TA 的日常', d: 'TA 在哪里/在做什么/想对你说 + 位置感知', k: '寻踪 日常 定位 在哪', go: ['.app[data-app="chat"]', '#chat-partner-av'] },
      { n: '同频', d: 'TA 此刻状态字卡 + 敲三下暗号', k: '同频 暗号 此刻 状态', go: ['.app[data-app="tongpin"]'] },
      { n: '伸手', d: '摸摸身边，三种触感 + 悄悄话', k: '伸手 摸摸 触感', go: ['.app[data-app="shenshou"]'] },
      { n: '此间', d: '每位梦角的世界时间与在场状态', k: '此间 梦角 时辰 在场', go: ['.app[data-app="cjian"]'] },
      { n: '房间（双人小屋）', d: '21 种家具互动、舒适度升级、按 TA 分屋', k: '房间 小屋 家具', go: ['.app[data-app="room"]'] },
      { n: '音乐', d: '本地/链接上传、歌单、一起听歌、播放队列', k: '音乐 歌曲 播放 歌单', go: ['.app[data-app="music"]'] },
      { n: '信箱', d: '和 TA 写信/回信，支持图文信件', k: '信箱 写信 信件 邮件', go: ['.app[data-app="mail"]'] },
      { n: '朋友圈', d: '发动态/点赞评论/TA 也会发', k: '朋友圈 动态 点评 转发', go: ['.app[data-app="feed"]'] }
    ] },
    { g: '小游戏', items: [
      { n: '猜拳', d: '和 TA 猜拳，累计战绩', k: '猜拳 石头剪刀布 游戏', go: ['.app[data-app="chat"]', '#more-rps'] },
      { n: 'Pong', d: '双人弹球对战，四档难度', k: 'pong 弹球 游戏', go: ['.app[data-app="chat"]', '#more-pong'] },
      { n: '贪吃蛇', d: '双人同场抢食，速度/穿墙可设', k: '贪吃蛇 蛇 游戏', go: ['.app[data-app="chat"]', '#more-snake'] },
      { n: '打砖块', d: '双人合作清砖，COMBO 连击', k: '打砖块 砖块 游戏', go: ['.app[data-app="chat"]', '#more-brick'] },
      { n: '钓鱼', d: '抛竿收竿 + 14 种收集物图鉴', k: '钓鱼 鱼 图鉴', go: ['.app[data-app="chat"]', '#more-fish'] },
      { n: '四子棋', d: '和 TA 对弈四子棋，战绩记录', k: '四子棋 棋 游戏', go: ['.app[data-app="chat"]', '#more-c4'] },
      { n: '合作扫雷', d: '轮流挖格共用 3 颗❤，藏彩蛋', k: '扫雷 游戏', go: ['.app[data-app="chat"]', '#more-ms'] },
      { n: '记忆翻牌', d: '合作找配对记默契分', k: '记忆 翻牌 配对 游戏', go: ['.app[data-app="chat"]', '#more-memory'] },
      { n: '五子棋', d: '11×11 迷你盘三档难度，TA 会堵你的成五点', k: '五子棋 棋 游戏', go: ['.app[data-app="chat"]', '#more-gomoku'] },
      { n: '连连看', d: '合作消除同款图案，连线不超两个弯', k: '连连看 游戏', go: ['.app[data-app="chat"]', '#more-linkup'] },
      { n: '消消乐', d: '轮流交换凑三连，连锁连消冲目标分', k: '消消乐 三消 游戏', go: ['.app[data-app="chat"]', '#more-match3'] },
      { n: '心意币拍卖会', d: '与 TA 轮番举牌，落槌价真实扣款', k: '拍卖 拍卖会 心意币', go: ['.app[data-app="chat"]', '#more-auction'] },
      { n: '游乐室', d: '小游戏战绩、徽章、摆件图鉴一览', k: '游乐室 战绩 徽章 摆件 图鉴', go: ['.app[data-app="home"]', '#home-arcade-entry'] }
    ] },
    { g: '手机桌面与工具', items: [
      { n: '桌面装修模式', d: '编辑布局/添加卡片/换图标/拖拽跨页', k: '装修 编辑 布局 图标 桌面', go: ['#row-custom-icon'] },
      { n: '外观与主题', d: '主题色/壁纸预设/字号圆角/组件样式/深色模式', k: '美化 外观 主题 壁纸 颜色 深色 暗色', go: ['#row-appearance'] },
      { n: '备忘录', d: '待办置顶/截止日期，TA 会追问和催办', k: '备忘录 待办 todo', go: ['.app[data-app="memo"]'] },
      { n: '喝水', d: '今日杯数进度环，TA 定时催喝水', k: '喝水 杯数', go: ['.app[data-app="water"]'] },
      { n: '吃什么', d: '随机抽菜/转盘，问 TA 征求意见', k: '吃什么 吃饭 菜 转盘', go: ['.app[data-app="eat"]'] },
      { n: '存钱罐', d: '存取+小心愿目标，TA 当监督人', k: '存钱罐 攒钱 心愿', go: ['.app[data-app="piggy"]'] },
      { n: '番茄钟', d: '专注/小憩/长休计时，陪伴模式', k: '番茄钟 专注 计时', go: ['.app[data-app="pomo"]'] },
      { n: '花园', d: '种花杂交/花束工坊/成就年报，TA 代管', k: '花园 种花 花', go: ['.app[data-app="garden"]'] }
    ] },
    { g: '桌面美化与外观', items: [
      { n: '外观与主题（总入口）', d: '桌面美化设置子页：主题/壁纸/字号/圆角/组件', k: '美化 外观 主题 壁纸 颜色', go: ['#row-appearance'] },
      { n: '深色模式', d: '浅色/深色/跟随系统三种主题模式', k: '深色 暗色 夜间 黑色 模式 主题', go: ['#row-theme-mode'] },
      { n: '主题色', d: '全局强调色八色预设（状态栏/按钮跟随）', k: '主题色 强调色 颜色 accent', go: ['#row-appearance', '#row-accent-color'] },
      { n: '全局字体', d: '上传本地字体或输入字体名/链接，全站生效（与聊天设置互通）', k: '字体 字型 全局 上传 ttf', go: ['#row-appearance', '#row-desk-cs-font'] },
      { n: '桌面字号', d: '手机桌面整体字号缩放（85%~120% 滑块）', k: '字号 字体大小 桌面 缩放 大小', go: ['#row-appearance', '#row-desk-font-size'] },
      { n: '卡片大小', d: '桌面卡片整体缩放（80%~120% 滑块）', k: '卡片 大小 缩放 组件', go: ['#row-appearance', '#row-desk-card-scale'] },
      { n: '组件圆角', d: '桌面卡片圆角大小', k: '圆角 卡片 组件', go: ['#row-appearance', '#row-desk-card-radius'] },
      { n: '图标圆角', d: '桌面图标形状圆角/圆形/方形', k: '图标 圆角 圆形 方形 形状', go: ['#row-appearance', '#row-ico-shape'] },
      { n: '上传手机背景图片', d: '自定义手机桌面壁纸', k: '壁纸 背景 上传 图片 桌面', go: ['#row-appearance', '#row-bg-upload'] },
      { n: '内置壁纸预设', d: '渐变/纯色壁纸直接选用', k: '壁纸 预设 渐变 纯色', go: ['#row-appearance', '#row-bg-preset'] },
      { n: '壁纸定位与缩放', d: '调整壁纸位置与缩放比例', k: '壁纸 定位 缩放 位置 调整', go: ['#row-appearance', '#row-bg-adjust'] },
      { n: '背景模糊', d: '桌面壁纸模糊程度调节', k: '壁纸 背景 模糊 毛玻璃', go: ['#row-appearance', '#row-bg-blur'] },
      { n: '背景遮罩', d: '壁纸上的遮罩浓度（压暗/提亮便于看图标）', k: '壁纸 遮罩 遮罩浓度 压暗', go: ['#row-appearance', '#row-bg-mask-op'] },
      { n: '移除背景图片', d: '清除桌面壁纸恢复默认底色', k: '壁纸 背景 移除 删除 清除', go: ['#row-appearance', '#row-bg-remove'] },
      { n: '批量上传图标图片', d: '一次上传多张图批量替换桌面图标', k: '图标 批量 上传 替换', go: ['#row-appearance', '#row-icon-batch'] },
      { n: '调整图标图片位置', d: '上传图标图片后单独调缩放/左右/上下，即时生效、不用重新上传', k: '图标 图片 位置 移动 缩放 调整 拖动 裁剪', go: ['#row-appearance', '#row-icon-fit'] },
      { n: '小组件颜色', d: '桌面小组件背景颜色自定义', k: '组件 小组件 颜色 背景', go: ['#row-appearance', '#row-widget-color'] },
      { n: '小组件边框颜色', d: '桌面小组件边框颜色自定义', k: '组件 边框 颜色', go: ['#row-appearance', '#row-widget-border'] },
      { n: '按钮颜色', d: '组件内按钮颜色自定义', k: '按钮 颜色 组件', go: ['#row-appearance', '#row-widget-btn'] },
      { n: '按钮文字颜色', d: '组件内按钮文字颜色自定义', k: '按钮 文字 颜色 组件', go: ['#row-appearance', '#row-widget-btn-text'] },
      { n: '图标文字颜色', d: '桌面图标下面应用名字的颜色', k: '图标 文字 颜色 应用名', go: ['#row-appearance', '#row-app-name-color'] },
      { n: '爱心外框颜色', d: '组件爱心外框颜色自定义', k: '爱心 颜色 外框 组件', go: ['#row-appearance', '#row-widget-heart'] },
      { n: '小组件透明度', d: '小组件全局默认透明度', k: '组件 透明度 透明', go: ['#row-appearance', '#row-widget-opacity'] },
      { n: '新增桌面页', d: '手机桌面加一页放更多图标', k: '桌面 页 新增 添加 翻页', go: ['#row-appearance', '#row-desk-add-page'] },
      { n: '删除最后一页', d: '删掉桌面的最后一页', k: '桌面 页 删除', go: ['#row-appearance', '#row-desk-del-page'] },
      { n: '恢复默认桌面', d: '桌面布局恢复出厂默认（图标重排）', k: '桌面 恢复 默认 重置 布局', go: ['#row-appearance', '#row-desk-reset'] },
      { n: '保存当前为美化方案', d: '把当前桌面美化存成方案，随时一键切回', k: '美化 方案 保存 桌面', go: ['#row-appearance', '#row-beauty-save'] },
      { n: '我的美化方案', d: '已存桌面美化方案的管理与一键应用', k: '美化 方案 管理 应用 切换', go: ['#row-appearance', '#row-beauty-schemes'] },
      { n: '导出美化方案', d: '把桌面美化方案导出成文件分享', k: '美化 方案 导出 分享 文件', go: ['#row-appearance', '#row-beauty-export'] },
      { n: '导入美化方案', d: '从文件导入桌面美化方案', k: '美化 方案 导入 文件', go: ['#row-appearance', '#row-beauty-import'] },
      { n: '分享当前美化链接', d: '生成链接直接把当前美化分享给 TA', k: '美化 分享 链接 链接分享', go: ['#row-appearance', '#row-beauty-share'] },
      { n: '撤销最近改动', d: '撤销上一次桌面美化操作', k: '美化 撤销 撤回 上一步', go: ['#row-appearance', '#row-beauty-undo'] },
      { n: '恢复全部默认美化', d: '清空所有美化设置恢复系统默认（方案不受影响）', k: '美化 恢复 默认 重置 出厂', go: ['#row-appearance', '#row-beauty-reset-all'] },
      { n: '完整外观方案', d: '整套外观（桌面+聊天等）方案一键应用', k: '外观 方案 完整 套装 应用', go: ['#row-appearance', '#row-full-beauty-schemes'] }
    ] },
    { g: '记录与统计', items: [
      { n: '主页', d: '多 tab 统计：换头像/通话/摸鱼/TA 的关心/心意币', k: '主页 情侣空间 统计', go: ['.app[data-app="home"]'] },
      { n: '聊天统计', d: '相处记录/聊天记录/情绪表达多维统计', k: '统计 聊天统计 数据', go: ['.app[data-app="stats"]'] },
      { n: '提问记录', d: 'TA 的询问/小问题/好奇/吐槽/我的邀请历史', k: '提问记录 历史 记录', go: ['.app[data-app="interact"]'] },
      { n: '查岗打卡', d: 'TA 的查岗打卡与位置记录', k: '查岗 打卡 定位', go: ['.app[data-app="checkin"]'] },
      { n: '日历', d: 'TA 的每日留言、情话、我的备忘与心情', k: '日历 留言 签到', go: ['.app[data-app="calendar"]'] },
      { n: '纪念', d: '纪念日/倒数日与相伴天数', k: '纪念 倒计时 周年', go: ['.app[data-app="memory"]'] },
      { n: '经期记录', d: '经期/排卵期预测、症状体温情绪记录、TA 的关心', k: '经期 生理期 排卵 月经', go: ['.app[data-app="period"]'] },
      { n: '记账', d: '收支分类/预算/图表/流水搜索', k: '记账 收支 预算 账本', go: ['.app[data-app="accounting"]'] },
      { n: '梦角档案', d: '认识 TA：九个分区 + 发现卡片 + 共同记录', k: '梦角档案 档案 认识', go: ['.app[data-app="memo-arc"]'] },
      { n: '我的档案', d: '写给 TA 的自我说明与 IF 世界设定', k: '我的档案 自我 if 世界', go: ['.app[data-app="my-arc"]'] },
      { n: '心情日记', d: '每天记心情，月度曲线对照、TA 的关心', k: '心情日记 心情 情绪 日记', go: ['.app[data-app="calendar"]'] }
    ] },
    { g: '系统与设置', items: [
      { n: '音效设置', d: '来电铃声/消息音效本地上传（收件音/发送音/铃声三项）', k: '音效 铃声 声音 提示音 消息音', go: ['#row-sfx-settings'] },
      { n: '通话设置', d: '来电/接听/挂断等触发概率与通话背景', k: '通话设置 电话 概率', go: ['#row-call-settings'] },
      { n: '通话背景图片', d: '通话页面背景图自定义上传', k: '通话 背景 图片 上传 壁纸', go: ['#row-call-settings', '#call-bg-row'] },
      { n: '移除通话背景', d: '清除通话背景图恢复默认', k: '通话 背景 移除 删除 清除', go: ['#row-call-settings', '#call-bg-remove'] },
      { n: '数据导出', d: '导出全部数据为备份文件；点开可选「仅聊天记录」（各桌面联系人 + 群聊，换机只搬聊天）', k: '导出 备份 数据 可选 只导出 仅 聊天记录 全部桌面', go: ['#row-export'] },
      { n: '数据导入', d: '从备份文件恢复（含预览与进度）；点开可选「仅聊天记录」（只恢复各桌面联系人与群聊）', k: '导入 恢复 数据 可选 只导入 仅 聊天记录 全部桌面', go: ['#row-import'] },
      { n: '查看存储占用', d: '按功能看本地存储占用，可清诊断记录；页内「字卡图去重入库」做字卡库瘦身', k: '存储 占用 空间 清理', go: ['#row-storage-view'] },
      { n: '字卡库瘦身 · 字卡图去重', d: '把字卡库里的内联图片转成媒体池令牌，同一张图全库只存一份（库键大幅缩小、减轻卡顿；图片显示与发送不变）', k: '字卡 去重 瘦身 存储 图片 卡顿 体积', go: ['#row-storage-view'] },
      { n: '卡顿自检 · 一键优化', d: '字卡库数据过大卡顿时，扫描分级并一键预热修复', k: '卡顿 优化 性能 流畅 预热', go: ['#row-perf-optimize'] },
      { n: '字卡使用状态自检', d: '自定义/系统预设字卡能不能被用到，一次看清（含二级锁、各开关/概率、分组停用）', k: '字卡 自检 状态 锁 概率 停用 分组 用不了', go: ['#row-card-audit'] },
      { n: '清除本地数据', d: '清空本机应用数据（重置前请先导出备份）', k: '清除 重置 清空 恢复出厂', go: ['#row-reset'] },
      { n: '后台保活', d: '切后台保持运行（静音音频保活），消息不中断', k: '后台 保活 运行 静音 切后台', go: ['#bg-keepalive'] },
      { n: '后台通知', d: '开后台消息提醒弹窗（自动请求权限并联动开启保活）', k: '通知 推送 提醒 弹窗 权限', go: ['#bg-notify'] },
      { n: '测试通知', d: '发一条测试通知并诊断本机通知环境', k: '通知 测试 诊断 收不到 提醒', go: ['#bg-notify-test'] },
      { n: '应用锁', d: '数字密码锁，每次打开本站需输密码，防别人偷看', k: '应用锁 密码 隐私 锁', go: ['#applock-en'] },
      { n: '应用锁安全问题', d: '设安全问题，忘记密码时用它重置密码', k: '安全问题 重置 密码 找回 应用锁', go: ['#applock-qa-en'] },
      { n: '字卡锁（未成年人保护）', d: '防未成年人模式：内置字卡全锁定，二级验证密码解锁', k: '字卡锁 未成年人 保护 锁 密码 解锁', where: '开屏公告区的「内置字卡锁定」卡，点「输入密码解锁」' },
      { n: '设备兼容诊断', d: '一键复制本机环境信息发给开发者排查', k: '诊断 兼容 环境 报障', go: ['#row-diagnostics'] },
      { n: '屏幕适配诊断', d: '顶部空白/底部裁切/缩放异常一键定位', k: '屏幕 适配 诊断 顶部空白 裁切', go: ['#row-screen-diag'] },
      { n: '功能诊断', d: '逐个测试全部功能是否正常（约15秒）', k: '功能诊断 自检 测试', go: ['#row-func-diag'] },
      { n: '新手引导', d: '3 步上手：设置「我」和「TA」→ 添加字卡 → 开始聊天（含桌面 / 聊天两套昵称的区别；全新环境首次打开会自动弹一次）', k: '新手 引导 上手 教程 怎么开始 不会用 从哪开始 昵称 桌面 聊天', go: ['#row-guidebook'] },
      { n: '使用说明', d: '完整说明：快速开始 / 安装方式 / iPhone·iOS 限制 / 数据备份 / 常见问题', k: '使用说明 教程 帮助 安装 ios 限制 备份 常见问题', go: ['#row-guide'] },
      { n: '功能介绍与许可', d: '原创声明、二传二改许可、灵感来源', k: '介绍 许可 关于 版权', go: ['#row-about'] }
    ] }
  ];

  // ---- 分类图标（描边风格与设置页一致；stroke=currentColor + .fhub-cat-ico 色走 var(--ink)，深色自动跟随） ----
  const CAT_ICO = [
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 100 20c1.2 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1.1.9-2 2-2h2.3A4.7 4.7 0 0022 11.5C22 6.3 17.5 2 12 2z"/><circle cx="7.5" cy="11" r=".9"/><circle cx="12" cy="7.5" r=".9"/><circle cx="16.5" cy="10.5" r=".9"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 12l10 5 10-5"/><path d="M2 17l10 5 10-5"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 10-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="8" width="19" height="10" rx="5"/><path d="M7.5 10.5v4M5.5 12.5h4"/><circle cx="15.5" cy="12" r=".9"/><circle cx="18" cy="14" r=".9"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 8.5V21h14V8.5"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>'
  ];
  // ---- 首页「常用」直达：取使用频次前 4（数据来自 fhub-freq，无数据整行隐藏） ----

  // ---- 样式（自包含注入，不动 base.css；配色走全局变量 --ink/--muted，深色模式自动跟随） ----
  const hubStyle = document.createElement('style');
  hubStyle.textContent =
    '.fhub-tabs{display:flex;gap:8px;overflow-x:auto;padding:2px 14px 8px;-webkit-overflow-scrolling:touch;scrollbar-width:none}.fhub-tabs::-webkit-scrollbar{display:none}' +
    '.fhub-tag{flex:0 0 auto;padding:6px 13px;border-radius:20px;font-size:12px;color:var(--muted,#666);background:rgba(0,0,0,.055);white-space:nowrap;cursor:pointer;transition:background .15s,color .15s;-webkit-tap-highlight-color:transparent}.fhub-tag:active{transform:scale(.97)}.fhub-tag.on{color:#fff;background:#111}' +
    '.fhub-hot{display:flex;gap:8px;align-items:center;padding:10px 2px 0}.fhub-hot-label{flex:0 0 auto;font-size:12px;color:var(--muted,#999)}' +
    '.fhub-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px 0 4px}' +
    '.fhub-cat{position:relative;padding:12px;border-radius:16px;cursor:pointer;-webkit-tap-highlight-color:transparent}.fhub-cat:active{transform:scale(.97)}' +
    '.fhub-cat-ico{width:36px;height:36px;border-radius:10px;background:rgba(0,0,0,.055);display:flex;align-items:center;justify-content:center;margin-bottom:9px}' +
    '.fhub-cat-ico svg{width:20px;height:20px;stroke:var(--ink,#111)}' +
    '.fhub-cat-name{font-size:14px;font-weight:600;line-height:1.3;padding-right:30px}' +
    '.fhub-cat-n{position:absolute;top:10px;right:10px;font-size:11px;color:var(--muted,#999);background:rgba(0,0,0,.05);border-radius:10px;padding:2px 8px;font-weight:600}' +
    '[data-theme="dark"] .fhub-tag{background:rgba(255,255,255,.09)}' +
    '[data-theme="dark"] .fhub-tag.on{background:var(--ink,#eee);color:var(--card-bg,#1e1e1e)}' +
    '[data-theme="dark"] .fhub-cat-ico{background:rgba(255,255,255,.09)}' +
    '[data-theme="dark"] .fhub-cat-n{background:rgba(255,255,255,.09)}';
  document.head.appendChild(hubStyle);

  // ---- 渲染 ----
  const body = document.getElementById('fhub-body');
  const page = document.getElementById('page-featurehub');
  if (!body || !page) return;
  const tags = document.getElementById('fhub-tags');
  const input = document.getElementById('fhub-search');
  const empty = document.getElementById('fhub-empty');
  const ARROW = '<div class="arrow"><svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></div>';

  function entryRow(it) {
    const row = document.createElement('div');
    row.className = 'set-row';
    row.innerHTML = '<div class="txt">' + it.n + '<span class="sub">' + it.d + '</span></div>' + ARROW;
    row.addEventListener('click', () => jump(it));
    return row;
  }
  function groupBlock(grp) {
    const wrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'gs-title';
    title.textContent = grp.g;
    const card = document.createElement('div');
    card.className = 'set-group glass';
    grp.items.forEach(it => card.appendChild(entryRow(it)));
    wrap.appendChild(title);
    wrap.appendChild(card);
    wrap.style.display = 'none';
    return wrap;
  }

  // ---- 首页「常用」行：按点击频次自动置顶；无使用数据时整行不显示 ----
  const FREQ_KEY = 'xy-home-v2:fhub-freq';
  const HOT_N = 4;
  const home = document.createElement('div');
  const hot = document.createElement('div');
  hot.className = 'fhub-hot';
  home.appendChild(hot);
  const byName = {};
  HUB.forEach(grp => grp.items.forEach(it => { if (!byName[it.n]) byName[it.n] = it; }));
  let freq = {};
  function renderHot() {
    const names = Object.keys(freq).filter(n => byName[n] && freq[n] > 0)
      .sort((a, b) => freq[b] - freq[a]).slice(0, HOT_N);
    hot.style.display = names.length ? '' : 'none';
    hot.innerHTML = names.length ? '<span class="fhub-hot-label">常用</span>' : '';
    names.forEach(nm => {
      const it = byName[nm];
      const c = document.createElement('div');
      c.className = 'fhub-tag';
      c.textContent = it.n;
      c.addEventListener('click', () => jump(it));
      hot.appendChild(c);
    });
  }
  function loadFreq() {
    try { freq = JSON.parse(localStorage.getItem(FREQ_KEY)) || {}; } catch (e) { freq = {}; }
    renderHot();
    // IDB 为准（idb.js 启动回填会用 IDB 刷 LS；idbGet 挂起时静默，用 LS 初值即可）
    if (typeof window.idbGet === 'function') {
      try { window.idbGet(FREQ_KEY).then(v => { if (v && typeof v === 'object' && Object.keys(v).length) { freq = v; renderHot(); } }).catch(() => {}); } catch (e) {}
    }
  }
  function bumpFreq(it) {
    freq[it.n] = (freq[it.n] || 0) + 1;
    try { localStorage.setItem(FREQ_KEY, JSON.stringify(freq)); } catch (e) { /* 存储满不影响跳转 */ }
    if (typeof window.idbSet === 'function') { try { window.idbSet(FREQ_KEY, freq).catch(() => {}); } catch (e) {} }
    renderHot();
  }
  renderHot();
  loadFreq();
  const grid = document.createElement('div');
  grid.className = 'fhub-grid';
  HUB.forEach((grp, gi) => {
    const tile = document.createElement('div');
    tile.className = 'fhub-cat glass';
    tile.innerHTML = '<div class="fhub-cat-n">' + grp.items.length + '</div>' +
      '<div class="fhub-cat-ico">' + (CAT_ICO[gi] || '') + '</div>' +
      '<div class="fhub-cat-name">' + grp.g + '</div>';
    tile.addEventListener('click', () => { if (input) input.value = ''; view = gi; update(); });
    grid.appendChild(tile);
  });
  home.appendChild(grid);
  body.appendChild(home);

  // 分组列表：默认全部隐藏，由 update() 按当前视图显隐
  const groups = [];
  HUB.forEach(grp => groups.push(groupBlock(grp)));
  groups.forEach(el => body.appendChild(el));

  // ---- 视图状态：'home'=分类宫格首页；数字=某分类列表；搜索时全局跨组忽略视图 ----
  let view = 'home';

  // ---- 顶部 tag：首页 + 各分类（列表态显示，用于快速切换/回首页） ----
  if (tags) {
    [['首页', 'home']].concat(HUB.map((g, i) => [g.g, i])).forEach((pair) => {
      const d = document.createElement('div');
      d.className = 'fhub-tag';
      d.textContent = pair[0];
      d.addEventListener('click', () => { if (input) input.value = ''; view = pair[1]; update(); });
      tags.appendChild(d);
    });
  }

  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); }
  function cardRows(gi) {
    const card = groups[gi] ? groups[gi].querySelector('.set-group') : null;
    return card ? Array.prototype.slice.call(card.children) : [];
  }

  // ---- 唯一显隐出口：搜索态全局跨组只显命中行；非搜索态按视图显首页或单组 ----
  function update() {
    if (empty) empty.hidden = true;
    const q = input ? norm(input.value) : '';
    if (q) {
      if (home) home.style.display = 'none';
      if (tags) tags.style.display = 'none';
      let hits = 0;
      // FIX 2026-09-16 #573 搜索精准化：①多词空格 AND（每词都须命中；此前整串当单词条）；
      // ②组内按 匹配质量（精确→开头→包含，window.mochiSearch.rank，原位次决胜）重排命中行。
      // 首次搜索前快照原始行序 __fhubOrder：行序既供 item 对位（排序后 children 不再等于
      // items 下标），也供清空搜索时还原非搜索视图。entryRow 点击闭包按 it 绑定＝重排安全。
      // 注意：q 已被 norm() 去空格，多词必须从原始输入取词（否则「红包 经期」并成单串）
      const raw = input ? input.value : '';
      const terms = window.mochiSearch ? window.mochiSearch.terms(raw) : raw.trim().toLowerCase().split(/\s+/);
      const kwRaw = raw.trim();
      HUB.forEach((grp, gi) => {
        let gHit = 0;
        const card = groups[gi] ? groups[gi].querySelector('.set-group') : null;
        if (card && !card.__fhubOrder) card.__fhubOrder = Array.prototype.slice.call(card.children);
        const base = (card && card.__fhubOrder) || cardRows(gi);
        const rankByRow = new Map();
        grp.items.forEach((it, ii) => {
          const hay = norm(it.n + it.d + (it.k || '') + (it.g || ''));
          const show = terms.every(w => hay.indexOf(w) >= 0);
          const el = base[ii];
          if (el) el.style.display = show ? '' : 'none';
          if (show) { gHit++; hits++; rankByRow.set(ii, window.mochiSearch ? window.mochiSearch.rank(it.n, kwRaw) : 2); }
        });
        if (card && card.__fhubOrder) {
          card.__fhubOrder
            .map((el, ii) => ({ el, ii, rk: rankByRow.has(ii) ? rankByRow.get(ii) : 9 }))
            .sort((a, b) => a.rk - b.rk || a.ii - b.ii)
            .forEach(o => card.appendChild(o.el));
        }
        if (groups[gi]) groups[gi].style.display = gHit ? '' : 'none';
      });
      if (empty) empty.hidden = hits > 0;
      return;
    }
    // 清空搜索 → 复位所有行显隐与原始行序，再按当前视图显首页或单组
    Array.prototype.forEach.call(body.querySelectorAll('.set-row'), r => { r.style.display = ''; });
    groups.forEach((el) => {
      const card = el ? el.querySelector('.set-group') : null;
      if (card && card.__fhubOrder) card.__fhubOrder.forEach(node => card.appendChild(node));
    });
    if (home) home.style.display = view === 'home' ? '' : 'none';
    if (tags) {
      tags.style.display = view === 'home' ? 'none' : '';
      Array.prototype.forEach.call(tags.children, (t, i) => t.classList.toggle('on', i - 1 === view));
    }
    groups.forEach((el, i) => { el.style.display = i === view ? '' : 'none'; });
  }

  // ---- 搜索 ----
  if (input) input.addEventListener('input', update);

  // ---- 跳转：链式点击既有入口；一个都没点中 = 入口丢失，弹位置提示不再静默 ----
  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer); t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2400);
  }
  function jump(it) {
    if (it.go && it.go.length) {
      try {
        let clicked = 0;
        it.go.forEach(sel => {
          const el = document.querySelector(sel);
          if (el && typeof el.click === 'function') { el.click(); clicked++; }
        });
        if (clicked) { bumpFreq(it); return; }
      } catch (e) { /* 落到位置提示 */ }
      toast('「' + it.n + '」的位置：' + (it.where || it.g) + '（入口暂不可达，如有需要请在对应页面寻找）');
      return;
    }
    toast('「' + it.n + '」的位置：' + (it.where || it.g));
  }

  // ---- 打开：两处入口共用（设置行 / 桌面图标），每次进入复位到宫格首页并清空搜索 ----
  // hubFrom 记住来源，返回键据此回桌面或回设置页（原实现恒回设置页，桌面进入会迷路）
  let hubFrom = 'setting';
  function openHub(from, kw) {
    document.querySelectorAll('.page').forEach(p => { p.hidden = true; });
    page.hidden = false;
    hubFrom = from;
    if (input) input.value = kw ? String(kw) : '';
    view = 'home';
    update();
    // 带关键词进入＝直接搜索态：聚焦搜索框方便改词（无键盘环境静默）
    if (kw && input) { try { input.focus(); } catch (e) {} }
  }

  // ---- 返回：从设置进入回设置页，从桌面图标进入回桌面 ----
  const back = document.getElementById('fhub-back');
  if (back) {
    back.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => { p.hidden = true; });
      const target = document.getElementById(hubFrom === 'desktop' ? 'page-phone' : 'page-setting');
      if (target) target.hidden = false;
    });
  }

  // ---- 设置页入口行 ----
  const row = document.getElementById('row-featurehub');
  if (row) row.addEventListener('click', () => openHub('setting'));

  // #542 曾有「桌面图标点开即聚焦搜索框」入口，#543 按用户要求撤出桌面（挤占原布局网格）；
  // hubFrom 恒为 'setting'，返回键固定回设置页，机制保留备用。

  // ---- #549 全局入口：设置搜索「在功能大全中搜索『X』」跳这里并带入关键词（返回回设置页） ----
  window.mochiFeatureHubOpen = function (kw) { openHub('setting', kw); };

  // ---- #572 只读查询：按「入口选择器」取本目录的条目，供 page-coach.js 在页面内渲染
  // 「这页还有什么」——说明文案与跳转链（go）单一事实源，页面提示与功能大全不会分叉成两套；
  // 只读不改目录数据、不重复实现任何打开逻辑（调用方仍是链式 .click() 既有入口）。
  window.mochiHubItemsFor = function (sels) {
    try {
      const want = Array.isArray(sels) ? sels : [sels];
      const out = [];
      HUB.forEach(function (g) {
        (g.items || []).forEach(function (it) {
          const go = it.go || [];
          for (let i = 0; i < want.length; i++) {
            if (want[i] && go.indexOf(want[i]) >= 0) {
              out.push({ g: g.g, n: it.n, d: it.d, go: go.slice(), where: it.where || '' });
              return;
            }
          }
        });
      });
      return out;
    } catch (e) { return []; }
  };

  update();
})();
