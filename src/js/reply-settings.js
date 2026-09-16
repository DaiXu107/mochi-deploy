// ===== 功能：通用设置（聊天触发概率） =====
// 存储 + 设置页 stepper/开关交互；暴露 window.replyCfg 给聊天回复逻辑使用
(function () {
  const uid = window.activePrefix();
  const ls = window.activeStore();

  // 全部概率/参数项（与星言 speedSettings 对应）
  const DEFAULTS = {
    'rs-min': 1, 'rs-max': 40,
    'reply-min': 1, 'reply-max': 2,
    'rn-prob': 20, 'touch-prob': 5,
    'sticker-prob': 10, 'emoji-prob': 5, 'image-prob': 5, 'voice-prob': 10,
    'kaomoji-prob': 5, 'quote-prob': 30,
    'rc-prob': 25, 'rc-refix': 35, 'rc-en': 1, 'cf-prob': 20,
    'py-en': 1, 'py-prob': 50, 'py-min': 2, 'py-max': 5,
    // v3.40.x #370c：csp-cust 回复文本「自定义字卡占比」（%，默认 50）——联系人回话里的
    // 纯文字卡，多大比例保留「你自定义的字卡」、其余让系统默认聊天字卡覆盖（默认字卡本身还
    // 受默认字卡「聊天使用」概率与分类权重控制）。0=尽量用默认字卡，100=全用自定义。chat.js
    // replyOnce 的 genReplyText 文本路径消费（默认字卡覆盖点前掷一次，命中则保留自定义）
    'csp-cust': 50,
    // #518：系统预设字卡·聊天触发概率「总档」（%，默认 100）——回复设置→聊天「系统预设字卡·聊天
    // 触发概率」组首行；生效缩放见 src/js/dcp-master.js 的 dcpEff（生效 = 各分类设定值 × 总档 ÷ 100）。
    // 未设键 = 100 = 各类按自身值生效、行为完全不变（「未设键回退原写死值」硬规）
    'dcp-all': 100,
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
    'qs-en': 1, 'qs-prob': 25, 'qs-cc': 1, 'qs-one': 1, 'qs-multi': 1, 'qs-noLimit': 0,
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
    // v3.33.x #364：mjf-pub 造句存公用库概率（%，默认 80）——多桌面联系人时新句按此概率
    // 进公用库、其余进专属库；仅 1 个联系人时固定进专属库（不受此项影响），dream-free.js 消费
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
    'as-badge': 1,
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
    // v3.9.x：群聊回复设置（群聊页全局生效，不随桌面隔离）——键前缀 gc-，
    // 存储在全局命名空间 xy-home-v2:reply-gc-*（见 getCfg 的全局读取分支），
    // 默认值：每个联系人回复概率 60%、回复速度 1~40 秒、回复条数 1~2、
    // 拍一拍 5%、表情包 10%、emoji 5%、图片 5%、语音 10%、颜文字附加 5%、引用 30%、
    // 撤回 25%、撤回补发 35%；多字卡回复触发概率 50%、最少 2 条、最多 5 条
    'gc-prob': 60, 'gc-rs-min': 1, 'gc-rs-max': 40,
    'gc-reply-min': 1, 'gc-reply-max': 2,
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
    return out;
  }
  window.replyCfg = getCfg;
  // v3.17.x：跨桌面「来消息」用——读取【指定联系人桌面】的回复设置（非当前桌面）。
  // getCfg 用 activeStore() 读当前激活桌面，这里改用 storeFor(cid)；gc-* 群聊设置
  // 仍是全局（与 getCfg 同）。供 incoming-requests.js 按各桌面自己的开关/概率/冷却调度。
  window.replyCfgFor = function (cid) {
    const out = {};
    let s = null;
    try { s = (cid && window.storeFor) ? window.storeFor(cid) : ls; } catch (e) { s = ls; }
    Object.keys(DEFAULTS).forEach(k => {
      const v = k.indexOf('gc-') === 0 ? gcRead(k) : (s ? s.get('reply-' + k) : null);
      let n = (v === null || v === undefined || v === '') ? DEFAULTS[k] : Number(v);
      if (isNaN(n)) n = DEFAULTS[k];
      out[k] = n;
    });
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
  window.saveReplyCfg = function (k, v) {
    if (k.indexOf('gc-') === 0) { gcWrite(k, v); return; }
    ls.set('reply-' + k, String(v));
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
    ['py-en', 'as-en', 'dnd-en', 'as-badge', 'ml-kaomoji-en', 'ml-emoji-en', 'ml-sticker-en', 'cs-normal', 'cs-trigger-name', 'cs-trigger-bar', 'gc-py-en', 'ai-rps-en', 'ai-game-en', 'ai-cuddle-en', 'ai-cc-en', 'ckq-en', 'call-resume', 'call-no-hangup', 'ml-write-en', 'fd-post-en', 'fd-kaomoji-en', 'fd-emoji-en', 'fd-sticker-en', 'fd-image-en', 'qs-en', 'qs-cc', 'qs-one', 'qs-multi', 'qs-noLimit', 'mjf-en', 'mjf-src-cc', 'mjf-src-def', 'mjf-src-dict', 'mjf-mix', 'rc-en', 'fish-en', 'work-en'].forEach(k => {
      const el = document.getElementById(k);
      if (el) el.checked = cfg[k] === 1;
    });
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
    'py-en': '多字卡回复', 'as-en': '主动发送', 'dnd-en': '免打扰', 'as-badge': '主动发送爱心标识',
    'ml-kaomoji-en': '信箱颜文字', 'ml-emoji-en': '信箱emoji', 'ml-sticker-en': '信箱表情包',
    'cs-normal': '让对方继续说', 'cs-trigger-name': '昵称触发继续说', 'cs-trigger-bar': '聊天栏继续说按钮',
    'gc-py-en': '群聊多字卡回复', 'ai-rps-en': '猜拳邀请', 'ai-game-en': '游戏邀请', 'ai-cuddle-en': '贴贴邀请',
    'ai-cc-en': 'TA分享字卡', 'ckq-en': 'TA主动查岗', 'call-resume': '刷新恢复通话', 'call-no-hangup': '禁止联系人挂断',
    'ml-write-en': '联系人主动写信', 'fd-post-en': '联系人主动发朋友圈',
    'fd-kaomoji-en': '朋友圈颜文字', 'fd-emoji-en': '朋友圈emoji', 'fd-sticker-en': '朋友圈表情包', 'fd-image-en': '朋友圈图片',
    'qs-en': '词典拼字', 'qs-cc': '混用自定义字卡', 'qs-one': '单气泡拼字', 'qs-multi': '多回复逐卡连发',
    'qs-noLimit': '逐卡连发不受条数限制', 'mjf-en': '梦角自由造句',
    'mjf-src-cc': '造句语料·自定义字卡', 'mjf-src-def': '造句语料·默认聊天字卡', 'mjf-src-dict': '造句语料·词典',
    'mjf-mix': '造句混合模式',
    'rc-en': '撤回后补发消息',
    'fish-en': '摸鱼值累计', 'work-en': '工作值累计'
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
  ['py-en', 'as-en', 'dnd-en', 'as-badge', 'ml-kaomoji-en', 'ml-emoji-en', 'ml-sticker-en', 'cs-normal', 'cs-trigger-name', 'cs-trigger-bar', 'gc-py-en', 'ai-rps-en', 'ai-game-en', 'ai-cuddle-en', 'ai-cc-en', 'ckq-en', 'call-resume', 'call-no-hangup', 'ml-write-en', 'fd-post-en', 'fd-kaomoji-en', 'fd-emoji-en', 'fd-sticker-en', 'fd-image-en', 'qs-en', 'qs-cc', 'qs-one', 'qs-multi', 'qs-noLimit', 'mjf-en', 'mjf-src-cc', 'mjf-src-def', 'mjf-src-dict', 'mjf-mix', 'rc-en', 'fish-en', 'work-en'].forEach(k => {
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
    ['qs-en', 'qs-one', 'qs-multi', 'qs-cc'].forEach(k => {
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

  // v3.6.x：「保存设置」按钮——把当前页面上所有概率/开关一次性写入本地并提示。
  // 数值本身已随点击即时保存，这里提供明确的「保存」反馈（用户反馈刷新后设置会丢）
  // v3.26.x：抽出 saveCurrentReplyPage() 公共函数——「保存设置」与「保存全部桌面联系人
  // 设置」共用同一套页面值校验+写入（stepper 范围校验 + 开关落盘），避免两份逻辑漂移
  function saveCurrentReplyPage() {
    try {
      document.querySelectorAll('#page-reply-settings .stepper, #page-call-settings .stepper').forEach(st => {
        const k = st.dataset.k;
        if (!k) return; // #518：分类档自定义行无 data-k，跳过防 reply-undefined 落盘
        // 同 syncUI：固定选 input.stp-val，避免转换后误读到 ce-box DIV 的过期 expando
        const val = st.querySelector('input.stp-val');
        if (k && val) {
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
      ['py-en', 'as-en', 'dnd-en', 'as-badge', 'ml-kaomoji-en', 'ml-emoji-en', 'ml-sticker-en', 'cs-normal', 'cs-trigger-name', 'cs-trigger-bar', 'gc-py-en', 'ai-rps-en', 'ai-game-en', 'ai-cuddle-en', 'ai-cc-en', 'ckq-en', 'call-resume', 'call-no-hangup', 'ml-write-en', 'fd-post-en', 'fd-kaomoji-en', 'fd-emoji-en', 'fd-sticker-en', 'fd-image-en', 'qs-en', 'qs-cc', 'qs-one', 'qs-multi', 'qs-noLimit', 'mjf-en', 'mjf-src-cc', 'mjf-src-def', 'mjf-src-dict', 'mjf-mix', 'rc-en', 'fish-en', 'work-en'].forEach(k => {
        const el = document.getElementById(k);
        if (el) window.saveReplyCfg(k, el.checked ? 1 : 0);
      });
    } catch (e) {}
  }
  function toastReply(msg, ms) {
    const d = ccToastEnsure();
    if (d) { d.textContent = msg; d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show'; clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, ms || 2000); }
  }
  const saveBtn = document.getElementById('reply-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      saveCurrentReplyPage();
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
    saveCurrentReplyPage();
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
    document.querySelectorAll('#page-reply-settings .fav-tab').forEach(x => x.classList.toggle('sel', x.dataset.rp === k));
    document.querySelectorAll('#page-reply-settings .gs-panel').forEach(p => { p.hidden = p.dataset.rpanel !== k; });
  };
  document.querySelectorAll('#page-reply-settings .fav-tab').forEach(tab => {
    tab.addEventListener('click', () => rpTab(tab.dataset.rp));
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
