// ===== 设置页统一「功能说明」（v3.44.x）=====
// 设置页里不少开关 / 入口缺解释，用户不知道默认状态、生效机制与影响范围。这里集中
// 登记每个设置项的「作用 / 默认值 / 触发或生效机制 / 影响范围」，运行时往对应行的标签
// 容器注入 .tag[data-setdesc]「功能说明」按钮，点击弹 openModal 说明弹窗。
// 说明：template 里已静态挂好「功能说明」的项（全屏模式 / 手机布局强制 / 离线消息提醒）
// 以及各自有绑定逻辑的动态项不在此登记，避免重复注入。本文件纯 UI 说明，不读写业务键。
(function () {
  var DESC = [
    // ---- 通用 ----
    { sel: '#sf-group-chat-row', name: '开启群聊', d: '开启后桌面出现「群聊」入口，可新建群聊、邀请联系人一起聊天（占卜按钮会收进隐藏池；若在桌面装修里手动固定过则不受影响）。\n默认：关闭。\n影响范围：全局，所有桌面/联系人共用；关闭只是隐藏入口，已有群聊数据保留。' },
    { sel: '#row-theme-mode', name: '深色模式', d: '切换全站主题。\n点击选择：「关闭」=浅色、「已开启」=深色、「跟随系统」=随手机系统明暗自动切换。\n默认：浅色。\n影响范围：全局所有页面，不随桌面区分。' },
    { sel: '#row-appearance', name: '手机桌面美化', d: '进入桌面美化子页：主题配色、壁纸、图标、字号、圆角、桌面组件等的总入口。\n影响范围：子页内多数美化项按联系人桌面独立保存（每个桌面可不同）。\n本行只是入口，不改变任何设置。' },
    // ---- 聊天 ----
    { sel: '#row-general', name: '回复设置', d: '进入回复设置页：调整 TA 的回复速度、连发条数、撤回 / 已读不回 / 拍一拍等行为概率，以及「聊天触发概率总档」和各分类概率。\n影响范围：页内参数按联系人桌面独立保存。\n本行只是入口。' },
    { sel: '#row-call-settings', name: '通话设置', d: '进入通话设置页：来电频率、接听 / 挂断触发概率、通话界面背景等。\n影响范围：页内概率按联系人桌面独立保存。\n本行只是入口。' },
    { sel: '#row-sfx-settings', name: '音效设置', d: '进入音效设置页：来电铃声、收件音、发送音，可选用内置音效或上传自定义音频。\n默认：全部静音（不播放），需进页主动选择。\n影响范围：音效按联系人桌面独立保存。\n本行只是入口。' },
    { sel: '#row-featurehub', name: '功能大全', d: '进入功能大全：全应用功能索引，支持搜索、点条目直达对应页面或设置。\n本行只是入口，不改变任何设置。' },
    // ---- 系统 ----
    { sel: '#applock-en', name: '应用锁', d: '开启后每次打开本站需输入 4–6 位数字密码，防止别人拿手机直接偷看聊天记录。\n默认：关闭。开启时若未设密码会引导设置，关闭需验证密码。\n影响范围：全局生效、不随桌面区分。\n注意：数据存在本机，此锁防日常偷看，防不了懂技术的人读取本机数据。' },
    { sel: '#applock-qa-en', name: '开屏问答门', d: '每次打开本站（含换浏览器 / 新设备）先答对问答题才放行，可不设数字密码单独使用。\n默认：真机开启（自动化测试环境除外）。\n机制：关闭需密码或暗号验证，防旁人顺手关掉；锁屏时输入暗号可让本机永久跳过问答层。\n影响范围：全局生效。' },
    { sel: '#bg-keepalive', name: '后台保活', d: '开启后页面切到后台时用静音音频 + 屏幕唤醒锁维持运行，TA 的消息与定时事件不中断。\n默认：关闭。\n机制：播放音乐时会短暂让位，音乐结束后自动恢复；开启「后台通知」时会自动一并开启本项。\n影响范围：全局生效。' },
    { sel: '#bg-notify', name: '后台通知', d: '开启后 TA 在后台发来消息时弹出系统通知。\n默认：关闭。\n机制：开启会请求系统通知权限，授权成功后自动联动开启「后台保活」；若权限被系统回收会自动关闭本项，需 HTTPS 环境。\n影响范围：全局生效。可用右侧「测试」检查本机通知是否正常。' },
    { sel: '#sf-edge-guard', name: '全屏边缘防误触', d: '全屏时在屏幕左右边缘加一层拦截，尽量挡住国产浏览器自带的边缘上/下滑（调音量/亮度）手势。\n默认：关闭。\n机制：仅在进入全屏时生效；对系统级手势可能无效，最可靠仍是浏览器设置里关闭边缘滑动调节。\n影响范围：按联系人桌面独立保存。' },
    { sel: '#desk-msg-en', name: '桌面消息弹窗', d: '开启后，不在聊天页时 TA 发来新消息会在桌面顶部弹出消息横幅。\n默认：开启。\n影响范围：按联系人桌面独立保存；关闭后仅在聊天页内看到消息，不再弹横幅。' },
    // ---- 工具 ----
    { sel: '#row-export', name: '导出数据', d: '导出备份文件，用于换机或防丢失。点开先选范围：完整备份 / 不含音乐文件 / 只备份文字 / 仅聊天记录（全部桌面联系人 + 群聊，消息引用到的图片语音一并带走）。\n机制：纯本地导出，无后端。\n影响范围：按所选范围；「仅聊天记录」不算全量备份，不更新定期备份提醒的导出时间。\niOS Safari 可能被系统清空存储，建议定期导出完整备份。' },
    { sel: '#row-import', name: '导入数据', d: '从备份文件恢复数据。点开先选范围：「完整备份」按文件覆盖本机全部数据（设置/字卡/朋友圈/音乐等），「仅聊天记录」只恢复各桌面联系人与群聊的聊天、其他数据一律不动（可从整份备份里单独找回聊天）。\n机制：导入后触发数据回填，请等待恢复完成再操作。\n建议：导入前先「导出数据」留底。' },
    { sel: '#safe-top-force', name: '顶部避让修正', d: 'iOS 专用修正：顶部「Mochi」行与手机系统时间重叠时开启；底部出现白带时关闭。\n默认：关闭（系统保留形态）。\n机制：改后会自动刷新页面生效。\n影响范围：全局，仅影响 iOS 顶部安全区避让。' },
    { sel: '#row-diagnostics', name: '设备兼容诊断', d: '采集本机设备与浏览器环境信息，一键复制发给开发者排障。\n机制：只读，不改动任何业务数据；有未读兼容错误时行上显示角标，点开即清零。' },
    { sel: '#row-screen-diag', name: '屏幕适配诊断', d: '定位跨设备屏幕适配问题（顶部空白 / 底部裁切 / 缩放异常），生成可读报告与机读签名，可导出或复制。\n机制：只读；产生的诊断记录可在「查看存储」里清理。' },
    { sel: '#row-func-diag', name: '功能诊断', d: '逐个测试全部功能入口 / 页面 / 图标能否正常打开与关闭（约 15 秒），自动判定「正常 / 需注意 / 异常」。\n机制：只读，测试期间会临时开合页面，不改业务数据。' },
    { sel: '#row-storage-view', name: '查看存储', d: '查看本地存储占用：按功能列出 localStorage 与 IndexedDB 的空间，并可定向清理诊断记录、本地音乐、同域其他站点等（不动业务数据）。\n也可从这里进入图片压缩。' },
    { sel: '#row-img-compress', name: '压缩图片', d: '把历史遗留的偏大图片按「新上传」同标准重新压缩一遍，覆盖原图、不可撤销。\n默认：上传时已自动压缩，本项只处理旧图。\n机制：会跳过动图、媒体池共享图与较小 / 压缩后不更小的图。\n影响范围：字卡库与桌面美化等图片数据。' },
    { sel: '#row-perf-optimize', name: '卡顿自检 · 一键优化', d: '字卡库数据过大导致卡顿时，扫描分级并做非破坏性预热（取回挂起的大键、令牌化回复池），不删除任何数据。\n机制：只优化、不写业务键；字卡库确为大库时会在启动后主动提醒一次。' },
    { sel: '#row-card-audit', name: '字卡使用状态自检', d: '进入字卡自检页：一眼看清「自定义字卡」与「系统预设字卡」当前能不能被联系人用到、用不到卡在哪一步。\n覆盖：二级密码锁状态与影响范围（哪些池被锁停、哪些豁免）、默认聊天字卡/词典/其他互动功能字卡的开关与概率、单卡关闭与分组停用、情绪/回应/心情/情话/位置等字卡池、公用库与各桌面专属库的可用量、图片/语音卡健康。\n还覆盖「回复设置 → 聊天」那半边闸门（字卡池是满的却看不到字卡时，通常卡在这里）：词典拼字、梦角自由造句、多字卡回复、聊天回应字卡、自定义字卡占比、拍一拍/表情包/emoji/图片/语音/颜文字/引用等附加件、已读不回与主动发送。\n概率口径：生效值＝存盘值 ×「系统预设字卡·聊天概率总档」÷100（总档只缩放系统预设侧，梦角造句不过总档）；「预设默认字卡覆盖」＝生效聊天概率 ×(1−自定义字卡占比)，不是「系统预设 X% / 自定义 (100−X)%」的二选一。\n怎么用：每行点「调整」跳到对应页面手动改（回复设置侧直达「回复设置 → 聊天」）；点「修复」按默认值一键恢复（不改字卡内容）；顶部可切「只看有问题」。\n机制：只读诊断，不改动任何开关或数据；随解锁、切桌面、数据回填实时刷新，可一键复制报告。' },
    { sel: '#row-reset', name: '清除本地数据', d: '清空本机全部应用数据（头像 / 昵称 / 背景 / 图标 / 纪念日 / 聊天 / 字卡 / 音乐 / 设置等），不可恢复。\n机制：会二次确认；清空全部 xy-home-v2 数据——所有联系人桌面（含当前之外的其他桌面）+ 公用字卡 / 我的表情包 / 存钱罐等全局共享数据 + IndexedDB 整库删除，清完自动重启为全新状态。\n建议：先「导出数据」备份再清除。' },
    // ---- 关于 ----
    { sel: '#row-about', name: '功能介绍与可二传二改许可', d: '查看功能介绍、原创署名与二传二改许可说明。\n本行只是入口；设置页底部另有常驻的版本、署名与防骗声明。' }
  ];
  var MAP = {};
  DESC.forEach(function (it) { MAP[it.sel] = it; });
  // FIX 2026-09-16 #573：把说明文案暴露给设置页搜索（personalize.js rowHay 并入 name+d），
  // 「壁纸/备份/总入口」等只出现在说明里的词从此可搜，别名表无需手工追这些词。
  window.__settingsHelpDesc = MAP;

  function rowOf(anchor) {
    if (!anchor) return null;
    if (anchor.classList && (anchor.classList.contains('set-row') || anchor.classList.contains('gs-row'))) return anchor;
    return anchor.closest ? anchor.closest('.set-row, .gs-row') : null;
  }
  function inject() {
    DESC.forEach(function (it) {
      var anchor = document.querySelector(it.sel);
      if (!anchor) return;
      var row = rowOf(anchor);
      if (!row) return;
      var label = row.querySelector('.txt') || row.querySelector(':scope > span');
      if (!label || label.querySelector('.tag')) return;
      var tag = document.createElement('span');
      tag.className = 'tag';
      tag.setAttribute('data-setdesc', it.sel);
      tag.setAttribute('role', 'button');
      tag.setAttribute('tabindex', '0');
      tag.textContent = '功能说明';
      label.appendChild(tag);
    });
  }
  function show(e, el) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    var it = MAP[el.getAttribute('data-setdesc')];
    if (!it || !window.openModal) return;
    window.openModal('【' + it.name + '】功能说明', '', function () {}, { noInput: true, staticText: it.d });
  }
  // 捕获阶段拦截：点「功能说明」时不让行的原有点击（切换开关 / 跳转页面）也触发
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-setdesc]') : null;
    if (t) show(e, t);
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var t = e.target && e.target.closest ? e.target.closest('[data-setdesc]') : null;
    if (t) show(e, t);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();
