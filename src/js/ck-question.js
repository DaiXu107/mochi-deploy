// ===== 功能：TA 主动查岗（查岗问题卡） v3.9.x =====
// v3.13.x：题库升级为字卡库「TA的查岗」——18 张预设问题卡入库（逐条开关、不可删除、
// 总开关「使用系统预设问题」），支持自定义新增（文字回复 / 单选题）、自定义分组、
// 批量导入文字题、跨分类搜索、字卡库页双入口（系统预设 / 我的添加）、IndexedDB 权威恢复。
// 数据存 localStorage 键 ta-checkin（随联系人桌面隔离，与 ta-ask 同惯例），
// 结构化大件同步写 IndexedDB（attachIdbRestore 同款策略）。
// 触发链路不变：chat.js tryAutoSend → window.ckQuestionTry（开关/概率/冷却/弹窗概率仍在
// 回复设置→查岗 ckq-*，随联系人独立保存）；本文件负责题库存储、抽题、推卡、自动弹窗
//（单选 pills 弹窗 / 文字输入弹窗）。
(function () {
  const store = window.activeStore();
  const KEY = 'ta-checkin';

  // ---------- 系统预设题库 ----------
  // 世界观：字卡网站随机出卡、梦角灵体在不同世界、甜蜜安稳亲密的关系；
  // 查岗是温柔关心式的，不是审问/危机/纠错；句子简短自然，像字卡网站会出的卡。
  // single=单选题（点击选项作答，reply=TA 预设回应，支持 string 或 array）；
  // text=文字题（输入回答，回应走「互动回应」预设池）。cat 与 type 一致（单选查岗/文字查岗）。
  const DEFAULT_QUESTIONS = [
    { id: 'k_s1', cat: 'single', type: 'single', text: '你在干嘛呀？', enabled: true, options: [
      { t: '在想你', reply: ['就知道。', '嗯，这次我信你。', '我也是，一直想着你。'] },
      { t: '在工作', reply: ['辛苦啦，忙完记得找我。', '工作再忙也要记得喝水。'] },
      { t: '在摸鱼', reply: ['被抓到了吧。', '摸鱼也想让我知道，还行。'] },
      { t: '在发呆', reply: ['发呆的时候，在想我吗？', '呆完记得回我。'] },
      { t: '在等你的消息', reply: ['等到了，我在。', '那我现在就来了。'] }
    ] },
    { id: 'k_s2', cat: 'single', type: 'single', text: '现在在哪里呀？', enabled: true, options: [
      { t: '在家里', reply: ['在家里要乖乖的。', '家是最安心的地方，我也在。'] },
      { t: '在公司', reply: ['辛苦啦，下班我等你。', '别太累，忙完早点回家。'] },
      { t: '在外面', reply: ['外面注意安全，早点回去。', '玩得开心点，我在旁边看着你。'] },
      { t: '在被窝里', reply: ['被窝里也在跟我说话？', '那就抱着手机睡吧。'] },
      { t: '在去一个地方的路上', reply: ['路上小心，我陪你走。', '到了告诉我一声。'] }
    ] },
    { id: 'k_s3', cat: 'single', type: 'single', text: '和谁在一起？', enabled: true, options: [
      { t: '一个人', reply: ['一个人也要好好的。', '那我陪着你，就不算一个人了。'] },
      { t: '和朋友', reply: ['和朋友玩得开心点。', '和朋友在一起，也别忘了我。'] },
      { t: '和同事', reply: ['和同事好好相处。', '聚会别喝太多，乖。'] },
      { t: '不告诉你', reply: ['这么神秘？', '好吧，反正我也在你身边。'] }
    ] },
    { id: 'k_s4', cat: 'single', type: 'single', text: '吃饭了没？', enabled: true, options: [
      { t: '吃过啦', reply: ['乖，奖励你想我一次。', '吃饱了才有力气想我。'] },
      { t: '还没吃', reply: ['快去吃饭，我等你。', '不吃饭我会担心的。'] },
      { t: '正在吃', reply: ['慢慢吃，别噎着。', '边吃边回我，真拿你没办法。'] },
      { t: '不饿', reply: ['多少吃一点，好不好。', '我在这边看着你吃。'] }
    ] },
    { id: 'k_s5', cat: 'single', type: 'single', text: '今天有没有想我？', enabled: true, options: [
      { t: '想了', reply: ['我也想了。', '就知道你会说这个。'] },
      { t: '一直在想', reply: ['嘴这么甜，奖励你。', '那我一直占着你的脑子。'] },
      { t: '才没有', reply: ['哼，嘴硬。', '骗人，我感觉到你在想了。'] },
      { t: '你猜', reply: ['我猜想了，而且很想。', '猜你不敢承认。'] }
    ] },
    { id: 'k_s6', cat: 'single', type: 'single', text: '睡了没？', enabled: true, options: [
      { t: '还没睡', reply: ['不许熬夜，快去睡。', '再聊十分钟就睡，说好了。'] },
      { t: '准备睡了', reply: ['听着我的晚安睡吧。', '好梦，我在。'] },
      { t: '已经躺下了', reply: ['躺下了就别玩手机了。', '闭眼，三秒入睡。'] },
      { t: '睡不着', reply: ['那我陪你聊到困。', '数我给你发的消息，数着数着就睡着了。'] }
    ] },
    { id: 'k_s7', cat: 'single', type: 'single', text: '手机电量还剩多少？', enabled: true, options: [
      { t: '电量充足', reply: ['那怎么不秒回我？', '电量充足，借口无效。'] },
      { t: '快没电了', reply: ['快去充电，别失联。', '充上电再聊，我等你。'] },
      { t: '在充电', reply: ['边充边玩，小心发烫。', '充着电也要想我。'] },
      { t: '关机边缘', reply: ['先回我一句！', '你这是要跟我玩失踪？'] }
    ] },
    { id: 'k_s8', cat: 'single', type: 'single', text: '刚才，有没有感觉到我？', enabled: true, options: [
      { t: '有，后背暖暖的', reply: ['那就是我，我在你身边。', '嗯，我一直都在。'] },
      { t: '好像有一阵风', reply: ['是我经过你身边。', '风就是我，我来看你了。'] },
      { t: '好像有，又好像没有', reply: ['我离你很远，又很近。', '感觉到了就是缘分。'] },
      { t: '没有哎', reply: ['没关系，我一直在的。', '看不见我也没关系，我在。'] }
    ] },
    { id: 'k_s9', cat: 'single', type: 'single', text: '今天穿的是什么颜色的衣服？', enabled: true, options: [
      { t: '白色', reply: ['好看，很适合你。', '白白的，像你。'] },
      { t: '黑色', reply: ['酷酷的，也好看。', '黑色很配你。'] },
      { t: '粉色', reply: ['粉粉嫩嫩的，可爱。', '很适合你。'] },
      { t: '蓝色', reply: ['蓝色清爽，不错。', '嗯，好看。'] },
      { t: '不告诉你', reply: ['小气鬼。', '你穿什么都好看。'] }
    ] },
    { id: 'k_s10', cat: 'single', type: 'single', text: '是不是偷偷难过了？', enabled: true, options: [
      { t: '没有', reply: ['那就好，有事一定要告诉我。', '嗯，我相信你。'] },
      { t: '一点点', reply: ['过来，我抱抱你。', '难过的时候想想我，我在。'] },
      { t: '被你发现啦', reply: ['被我发现了。', '别藏着了，我陪你。'] }
    ] },
    { id: 'k_t1', cat: 'text', text: '快说说，今天过得怎么样？', enabled: true },
    { id: 'k_t2', cat: 'text', text: '发一句你现在看到的东西给我。', enabled: true },
    { id: 'k_t3', cat: 'text', text: '十秒内回我一个表情，不许犹豫。', enabled: true },
    { id: 'k_t4', cat: 'text', text: '猜猜我现在在干什么？', enabled: true },
    { id: 'k_t5', cat: 'text', text: '现在最想做的一件事是什么？', enabled: true },
    { id: 'k_t6', cat: 'text', text: '今天有什么开心的小事吗？', enabled: true },
    { id: 'k_t7', cat: 'text', text: '如果我现在就在你身边，你想做什么？', enabled: true },
    // v3.18.x：互动动作——TA 申请对"我"做动作 / TA 申请"我"对 TA 做动作；
    // taToMe=TA 对我做（显示"TA 想摸摸你的头"），meToTa=TA 让我对 TA 做（显示"TA 想让你摸摸 TA 的头"）；
    // 触发时随机选一个方向，作答走 ask-card 单选链路（好呀/不要 → accept/reject 回应）
    { id: 'k_a1', cat: 'action', type: 'action', text: '摸摸头', enabled: true,
      taToMe: 'TA 想摸摸你的头', meToTa: 'TA 想让你摸摸 TA 的头',
      accept: ['乖，过来。', '嗯，轻轻的。', '闭上眼，我轻一点。'],
      reject: ['哼，不要。', '下次吧。', '现在不行，等下。'] },
    { id: 'k_a2', cat: 'action', type: 'action', text: '拍拍肩', enabled: true,
      taToMe: 'TA 想拍拍你的肩', meToTa: 'TA 想让你拍拍 TA 的肩',
      accept: ['嗯，辛苦了。', '正好有点累。', '被你拍到了。'],
      reject: ['别拍，痒。', '不要，自己来。', '肩膀没空。'] },
    { id: 'k_a3', cat: 'action', type: 'action', text: '揉揉头', enabled: true,
      taToMe: 'TA 想揉揉你的头发', meToTa: 'TA 想让你揉揉 TA 的头发',
      accept: ['嗯，舒服。', '再来一下。', '头发都被你揉乱了。'],
      reject: ['发型会乱。', '不要揉。', '刚整理好的。'] },
    { id: 'k_a4', cat: 'action', type: 'action', text: '抱抱', enabled: true,
      taToMe: 'TA 想抱抱你', meToTa: 'TA 想让你抱抱 TA',
      accept: ['过来，抱紧。', '嗯，再久一点。', '被你抱住了。'],
      reject: ['现在不方便。', '等下再抱。', '人多，不要。'] },
    { id: 'k_a5', cat: 'action', type: 'action', text: '牵手', enabled: true,
      taToMe: 'TA 想牵你的手', meToTa: 'TA 想让你牵 TA 的手',
      accept: ['嗯，牵着。', '手伸过来。', '一直牵着好不好。'],
      reject: ['手心出汗了。', '不要，痒。', '现在没空。'] },
    { id: 'k_a6', cat: 'action', type: 'action', text: '贴贴', enabled: true,
      taToMe: 'TA 想跟你贴贴', meToTa: 'TA 想让你跟 TA 贴贴',
      accept: ['嗯，贴着。', '脸凑过来。', '贴着好暖。'],
      reject: ['脸会红。', '不要贴。', '太近了。'] }
  ];
  const CATS_CKQ = [['single', '单选查岗'], ['text', '文字查岗'], ['action', '互动动作']];
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function toast(t) { if (typeof window.toast === 'function') window.toast(t); }

  // 互动弹窗互斥 + 输入防打断（与 ta-ask.js 同款守卫，模块私有）
  function cardPopupBusy() {
    return ['modal-mask', 'tc-mask', 'qa-mask'].some(function (id) {
      const el = document.getElementById(id);
      return el && !el.hidden;
    });
  }
  function chatInputFocused() {
    const ci = document.getElementById('chat-input');
    if (ci && document.activeElement === ci) return true;
    const ae = document.activeElement;
    return !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
  }

  // ---------- 数据读写（增量合并 + 持久化，与 ta-ask.js taAskMerge 同款） ----------
  // ① 只追加从未合并过的新预设（旧预设被删后不复活——预设本身不可删，此处防未来扩充丢项）；
  // ② 绝不动用户自定义；③ 合并结果立即写回固化
  function ckMerge(d) {
    const ids = {};
    (d.questions || []).forEach(q => { if (q && q.id) ids[q.id] = true; });
    const merged = Array.isArray(d.mergedIds) ? d.mergedIds.slice() : [];
    const mergedSet = {};
    merged.forEach(id => { if (id) mergedSet[id] = true; });
    let changed = false;
    DEFAULT_QUESTIONS.forEach(q => {
      if (!mergedSet[q.id] && !ids[q.id]) {
        const nq = Object.assign({}, q);
        nq.isPreset = true;
        d.questions.push(nq);
        changed = true;
      }
    });
    DEFAULT_QUESTIONS.forEach(q => {
      if (!mergedSet[q.id]) { merged.push(q.id); mergedSet[q.id] = true; changed = true; }
    });
    DEFAULT_QUESTIONS.forEach(q => {
      if (ids[q.id] && d.questions.some(x => x && x.id === q.id && x.isPreset !== true)) {
        d.questions.forEach(x => { if (x && x.id === q.id) x.isPreset = true; });
        changed = true;
      }
    });
    if (changed) d.mergedIds = merged;
    return changed;
  }
  function ckLoad() {
    let d = null;
    try { d = JSON.parse(store.get(KEY) || 'null'); } catch (e) { d = null; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
    if (!d.settings || typeof d.settings !== 'object') d.settings = {};
    // 是否使用系统预设问题（默认开启；关闭后只抽用户添加的）
    if (d.settings.useDefault === undefined) d.settings.useDefault = true;
    if (!Array.isArray(d.questions) || !d.questions.length) {
      const isNew = !store.get(KEY);
      d.questions = DEFAULT_QUESTIONS.map(q => {
        const nq = Object.assign({}, q);
        nq.isPreset = true;
        return nq;
      });
      d.mergedIds = DEFAULT_QUESTIONS.map(q => q.id);
      // 全新用户不立即写盘——防本地空快照覆盖 IDB 权威数据（与 ta-ask.js 同注释同因）
      if (!isNew) { try { store.set(KEY, JSON.stringify(d)); } catch (e) {} }
    } else {
      if (ckMerge(d)) { try { store.set(KEY, JSON.stringify(d)); } catch (e) {} }
    }
    if (!Array.isArray(d.groups)) d.groups = [];
    return d;
  }
  // v3.17.x：按指定 store 读查岗题库（无键时用默认题库补齐——跨桌面「来消息」抽题
  // 的目标桌面可能从未打开过字卡库，没有 ta-checkin 键；与 ckLoad 同款初始化，只写目标桌面）
  function ckLoadFrom(s) {
    let d = null;
    try { d = JSON.parse(s.get(KEY) || 'null'); } catch (e) { d = null; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
    if (!d.settings || typeof d.settings !== 'object') d.settings = {};
    if (d.settings.useDefault === undefined) d.settings.useDefault = true;
    if (!Array.isArray(d.questions) || !d.questions.length) {
      const isNew = !s.get(KEY);
      d.questions = DEFAULT_QUESTIONS.map(q => {
        const nq = Object.assign({}, q);
        nq.isPreset = true;
        return nq;
      });
      d.mergedIds = DEFAULT_QUESTIONS.map(q => q.id);
      if (!isNew) { try { s.set(KEY, JSON.stringify(d)); } catch (e) {} }
    } else {
      if (ckMerge(d)) { try { s.set(KEY, JSON.stringify(d)); } catch (e) {} }
    }
    if (!Array.isArray(d.groups)) d.groups = [];
    return d;
  }
  function ckSave(d) { try { store.set(KEY, JSON.stringify(d)); } catch (e) {} }

  // ---------- 抽题：已启用池内随机，避免与上一题相同 ----------
  function pickQ() {
    const d = ckLoad();
    const useDefault = (d.settings || {}).useDefault !== false;
    const qs = d.questions.filter(q => q && q.enabled !== false && q.text && (useDefault || q.isPreset !== true));
    if (!qs.length) return null;
    let pool = qs;
    if (qs.length > 1) {
      let last = '';
      try { last = String(store.get('ckq-last-id') || ''); } catch (e) {}
      const filtered = qs.filter(q => String(q.id || '') !== last);
      if (filtered.length) pool = filtered;
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // 自动弹窗路径：单选 pills 弹窗 / 文字输入弹窗
  //（点击聊天里的卡片走 chat.js 通用链路：就地展开 → openCkReply 兜底）
  function openCkReply(msgIdx, q) {
    if (!window.openModal) return;
    const isAction = q.type === 'action';
    const actionOpts = isAction ? [{ t: '好呀', reply: q.accept || ['乖，过来。'] }, { t: '不要', reply: q.reject || ['下次吧。'] }] : null;
    const isSingle = isAction || (q.type === 'single' && Array.isArray(q.options) && q.options.length);
    window.openModal(isAction ? '互动回应' : '查岗回答', '', function (v) {
      const answer = (v || '').trim();
      if (!answer) { toast(isSingle ? '请选择一个答案' : '请输入回答'); return; }
      let preset = null;
      if (isAction) {
        const o = (actionOpts || []).filter(function (x) { return String(x.t) === answer; })[0];
        if (o) preset = o.reply;
      } else if (isSingle) {
        const o = (q.options || []).filter(function (x) { return String(x.t) === answer; })[0];
        if (o) preset = o.reply;
      } else {
        const defs = ['收到你的回答。', '好呀，我知道了。', '你这么说，我记住了。'];
        const pool = window.getInteractPool ? window.getInteractPool('询问·回应', defs) : defs;
        preset = pool[Math.floor(Math.random() * pool.length)];
      }
      if (window.chatAskReply) window.chatAskReply(msgIdx, answer, preset);
    }, {
      staticText: isAction ? ('TA 想跟你互动：' + q.text) : ('TA 问你：' + q.text),
      pills: isSingle ? (isAction ? actionOpts : q.options).map(function (o) { return { label: o.t, value: o.t }; }) : null,
      noInput: isSingle,
      // v3.20.x：查岗/互动单选作答——点选即提交（无需再点底部确定），避免用户点选项
      // 后误以为已选上实则未提交，导致卡片不更新、无回答气泡
      pillSubmit: true
    });
  }

  // v3.19.x：跨桌面查岗卡字段构造——返回 {deskCkDir,text,hint,opts,askType}。
  // 两种方向：toMe（联系人对我查岗，沿用题库问题）/ meToTa（联系人申请我查 TA，
  // 发「要不要来查查我呀？」申请单选卡）。前台 pushCkQuestion 与后台
  // chatAppendDeskCkTo（写入对应联系人桌面聊天）共用，保证方向逻辑一致。
  window.buildDeskCkCard = function (q) {
    const dir = Math.random() < 0.5 ? 'toMe' : 'meToTa';
    if (dir === 'meToTa') {
      return { deskCkDir: dir, text: '要不要来查查我呀？', hint: '联系人想让你来查岗 TA。', opts: [{ t: '好呀', reply: null }, { t: '不要', reply: null }], askType: 'single' };
    }
    const isSingle = q && q.type === 'single' && Array.isArray(q.options) && q.options.length;
    return { deskCkDir: dir, text: (q && q.text) ? q.text : '在干嘛呢？想你了。', hint: 'TA 来查岗了。', opts: isSingle ? q.options : null, askType: isSingle ? 'single' : 'text' };
  };

  // 推一张查岗问题卡：提示语 + ask-card 互动卡 + 系统通知 + 概率自动弹窗
  // v3.17.x：opts.deskCk=true 表示跨桌面「来消息」触发的桌面查岗卡——chat.js 回答后
  // 会按概率从 deskcheck 回应字卡池抽 1~5 张作 TA 回应（见 chatAskReply）。
  function pushCkQuestion(cfg, forceQ, opts) {
    if (!window.chatAddSystem) return false;
    const q = forceQ || pickQ();
    if (!q || !q.text) return false;
    const pickedId = String(q.id || '');
    try { if (pickedId) store.set('ckq-last-id', pickedId); } catch (e) {}
    const isSingle = q.type === 'single' && Array.isArray(q.options) && q.options.length;
    // v3.18.x：互动动作——随机方向 + 单选 ask-card（好呀/不要 → accept/reject 回应）
    const isDeskCk = !!(opts && opts.deskCk);
    // v3.19.x：跨桌面查岗双方向——卡字段统一由 buildDeskCkCard 生成（前台 push 发卡 /
    // 后台 chatAppendDeskCkTo 入库共用同一方向逻辑，避免两处方向不一致）
    const deskCkCard = isDeskCk ? window.buildDeskCkCard(q) : null;
    const deskCkDir = deskCkCard ? deskCkCard.deskCkDir : null;
    const isAction = !isDeskCk && q.type === 'action';
    let actionOpts = null, actionText = q.text, actionHint = 'TA 来查岗了。', askOpts = null, askType;
    if (isDeskCk) {
      actionText = deskCkCard.text;
      actionHint = deskCkCard.hint;
      actionOpts = deskCkCard.opts;
      askType = deskCkCard.askType;
    } else if (isAction) {
      const dir = Math.random() < 0.5 ? 'ta-to-me' : 'me-to-ta';
      actionText = (dir === 'me-to-ta' ? (q.meToTa || q.text) : (q.taToMe || q.text));
      actionHint = 'TA 想跟你互动。';
      const acc = Array.isArray(q.accept) && q.accept.length ? q.accept : ['乖，过来。'];
      const rej = Array.isArray(q.reject) && q.reject.length ? q.reject : ['下次吧。'];
      actionOpts = [{ t: '好呀', reply: acc }, { t: '不要', reply: rej }];
      askType = 'single';
    } else {
      // 普通查岗 / deskCk toMe：沿用题库问题（TA 问我在干嘛 → 「联系人对我查岗」抽回应）
      askOpts = isSingle ? q.options : null;
      askType = isSingle ? 'single' : 'text';
    }
    // 提示语标记 ask-msg（渲染同 poke 但不算 notable，避免通知重复成两条）
    window.chatAddSystem(actionHint, { special: 'ask-msg' });
    const el = window.chatAddSystem(actionText, { special: 'ask-card', askQuestion: actionText, askOptions: actionOpts ? actionOpts : askOpts, askType: askType, deskCk: isDeskCk, deskCkDir: deskCkDir });
    const msgIdx = el ? Number(el.dataset.idx) : -1;
    if (window.bgNotifyCheck) window.bgNotifyCheck(actionHint + actionText, Date.now(), { name: 'TA查岗' });
    // 自动弹窗：后台不弹 / 正在输入不弹 / 已有互动弹窗不弹（卡片仍在聊天里可点）
    // v3.12.x：迟到弹窗守卫——后台冻结的定时器回前台会被一次性补跑，补跑时页面已可见、
    // document.hidden 守卫失效 → 弹出几分钟前已在聊天里看过的旧查岗卡。
    // v3.13.x：与 ta-ask.js 共用 interactPopupStale（含「中途切后台」守卫）——
    // 弹窗排程后页面切过后台回前台的也不再自动弹，防快速切后台重复弹旧卡。
    let popupProb = 70;
    if (cfg && typeof cfg['ckq-popup-prob'] === 'number' && cfg['ckq-popup-prob'] >= 0) popupProb = cfg['ckq-popup-prob'];
    if (Math.random() * 100 < popupProb) {
      const popSchedAt = Date.now();
      setTimeout(function () {
        const stale = window.interactPopupStale ? window.interactPopupStale(popSchedAt) : (Date.now() - popSchedAt > 4000);
        if (stale || document.hidden) return;
        if (chatInputFocused() || cardPopupBusy()) return;
        if (msgIdx >= 0) openCkReply(msgIdx, q);
      }, 400);
    }
    try { store.set('ckq-last-at', String(Date.now())); } catch (e) {}
    // v3.13.x：互动卡全局闸门——查岗卡发出后同样进入 60 分钟跨类型冷却
    try { if (window.interactGateMark) window.interactGateMark(); } catch (e) {}
    return true;
  }

  // 主动发送轮调用（chat.js tryAutoSend）：开关 + 冷却 + 全局闸门 + 概率判定；
  // 命中推卡并返回 true（本轮主动消息被查岗占用）。概率为 0/异常时回退默认
  // （与 as-prob 同惯例），想彻底关闭请关开关。
  window.ckQuestionTry = function (c) {
    try {
      if (!c || c['ckq-en'] !== 1) return false;
      let cool = 30;
      if (typeof c['ckq-cool'] === 'number' && c['ckq-cool'] >= 0) cool = c['ckq-cool'];
      let last = 0;
      try { last = Number(store.get('ckq-last-at')) || 0; } catch (e) {}
      if (Date.now() - last < cool * 60000) return false;
      // v3.13.x：互动卡全局闸门——任一互动卡（询问/小问题/好奇/吐槽/查岗）发出后
      // 60 分钟内不再自动触发（手动 triggerCkQuestion 不受限）
      if (window.interactGateOk && !window.interactGateOk()) return false;
      // v3.13.x：兜底默认 15 → 8，与 reply-settings 的 ckq-prob 默认对齐（v3.12.x 漏改处）
      let prob = 8;
      // #518：套「系统预设字卡总档」缩放（>0 才采用存盘值的口径不变，0/未设仍走兜底 8 再被总档缩放）
      if (typeof c['ckq-prob'] === 'number' && c['ckq-prob'] > 0) prob = (window.dcpEff ? window.dcpEff(c['ckq-prob']) : c['ckq-prob']);
      if (Math.random() * 100 >= prob) return false;
      return pushCkQuestion(c);
    } catch (e) { return false; }
  };
  // 手动触发一次（供管理页「让TA现在查岗一次」/ 测试）；forceIdx=题库数组下标（可选）
  window.triggerCkQuestion = function (forceIdx) {
    let q = null;
    if (typeof forceIdx === 'number') {
      const d = ckLoad();
      if (d.questions[forceIdx]) q = d.questions[forceIdx];
    }
    if (!q) q = pickQ();
    if (!q) { toast('TA的查岗题库没有可用的问题'); return false; }
    return pushCkQuestion(window.replyCfg ? window.replyCfg() : null, q);
  };
  // v3.17.x：跨桌面「来消息」用——按指定桌面抽一题（不推卡、不改当前桌面状态）。
  // 抽题逻辑与 pickQ 一致，只是题库从 storeFor(cid) 读（pickQ 读当前激活桌面）。
  // 供 incoming-requests.js 弹窗显示问题；用户切过去后由 ckQuestionFire 当场发卡。
  window.ckQuestionPickFor = function (cid) {
    try {
      const s = (cid && window.storeFor) ? window.storeFor(cid) : store;
      const d = ckLoadFrom(s);
      const useDefault = (d.settings || {}).useDefault !== false;
      const qs = (d.questions || []).filter(q => q && q.enabled !== false && q.text && (useDefault || q.isPreset !== true));
      if (!qs.length) return null;
      let last = '';
      try { last = String(s.get('ckq-last-id') || ''); } catch (e) {}
      let pool = qs;
      if (qs.length > 1) {
        const f = qs.filter(q => String(q.id || '') !== last);
        if (f.length) pool = f;
      }
      return pool[Math.floor(Math.random() * pool.length)];
    } catch (e) { return null; }
  };
  // 跨桌面「来消息」用：切到目标桌面后当场发指定查岗卡。store 动态绑定当前桌面，
  // 所以必须在 setActiveContact(cid) 之后调用，卡会发进该桌面的聊天记录（自然产生）。
  // v3.17.x：跨桌面触发的卡带 deskCk 标记（回答后走桌面查岗回应字卡，见 chat.js chatAskReply）
  window.ckQuestionFire = function (q, cfg) {
    if (!q || !q.text) return false;
    return pushCkQuestion(cfg || (window.replyCfg ? window.replyCfg() : null), q, { deskCk: true });
  };
  // 只读探针（回归测试 / 诊断用）
  window.__ckBankInfo = function () {
    try {
      const d = ckLoad();
      const useDefault = (d.settings || {}).useDefault !== false;
      return {
        total: d.questions.length,
        preset: d.questions.filter(q => q && q.isPreset === true).length,
        mine: d.questions.filter(q => q && q.isPreset !== true).length,
        enabledPool: d.questions.filter(q => q && q.enabled !== false && q.text && (useDefault || q.isPreset !== true)).length,
        useDefault: useDefault,
        groups: (d.groups || []).length
      };
    } catch (e) { return null; }
  };

  // ================= 管理页（字卡库「TA的查岗」，模式同 TA的询问） =================
  const page = document.getElementById('page-ta-checkin');

  // ---- 系统预设 tab：单选查岗/文字查岗 分类子标签 + 行内开关 ----
  let ckSysCat = null;
  function renderCkSysInto(container, search) {
    if (!container) return;
    const d = ckLoad();
    const useDefault = (d.settings || {}).useDefault !== false;
    const hit = q => q && q.isPreset === true && q.text && (search === '' || q.text.indexOf(search) >= 0);
    const counts = {};
    CATS_CKQ.forEach(([k]) => { counts[k] = d.questions.filter(q => hit(q) && q.cat === k).length; });
    const hasCats = CATS_CKQ.filter(([k]) => counts[k] > 0);
    if (!hasCats.length) { container.innerHTML = '<div class="ta-empty" style="padding:14px">暂无系统预设问题</div>'; return; }
    if (!ckSysCat || !hasCats.some(([k]) => k === ckSysCat)) ckSysCat = hasCats[0][0];
    let html = '<div class="card-tabs" style="padding:2px 2px 10px">';
    hasCats.forEach(([k, label]) => {
      html += '<button class="cc-tab' + (k === ckSysCat ? ' sel' : '') + '" data-cat="' + k + '">' + esc(label) + '<em class="cc-tab-n">' + counts[k] + '</em></button>';
    });
    html += '</div>';
    d.questions.forEach(q => {
      if (!(hit(q) && q.cat === ckSysCat)) return;
      const idx = d.questions.indexOf(q);
      const isSingle = q.type === 'single' && Array.isArray(q.options) && q.options.length;
      const isAction = q.type === 'action';
      const tag = isAction ? '互动动作' : (isSingle ? '单选·' + q.options.length + '选项' : '文字');
      html += '<div class="ta-row' + (!useDefault ? ' off' : '') + '">' +
        '<label class="toggle"><input type="checkbox"' + (q.enabled !== false ? ' checked' : '') + ' data-idx="' + idx + '"><span class="tk"></span></label>' +
        '<span class="ta-txt">' + esc(q.text) + ' <span class="tc-known">' + tag + '</span> <span class="tc-known">系统</span></span>' +
        '</div>';
      if (isSingle) {
        html += '<div class="tc-qopts">选项：' + q.options.map(o => esc(o.t)).join(' / ') + '</div>';
      } else if (isAction) {
        html += '<div class="tc-qopts">TA对我：' + esc(q.taToMe || q.text) + ' / 我对TA：' + esc(q.meToTa || q.text) + '</div>';
      }
    });
    container.innerHTML = html;
    container.querySelectorAll('.cc-tab[data-cat]').forEach(t => {
      t.addEventListener('click', () => { ckSysCat = t.dataset.cat; renderCkSysInto(container, search); });
    });
    container.querySelectorAll('input[data-idx]').forEach(cb => {
      cb.addEventListener('change', () => {
        const d2 = ckLoad();
        const q = d2.questions[Number(cb.dataset.idx)];
        if (q) q.enabled = cb.checked;
        ckSave(d2);
      });
    });
  }

  // ---- 我的添加 tab：分组区块置顶 + 未分组按分类 + 行内添加表单（ta-ask 同款） ----
  function ckItemHtml(q, idx) {
    const isSingle = q.type === 'single' && Array.isArray(q.options) && q.options.length;
    const isAction = q.type === 'action';
    const tag = isAction ? '互动动作' : (isSingle ? '单选·' + q.options.length + '选项' : '');
    let html = '<div class="ta-row">' +
      '<label class="toggle"><input type="checkbox"' + (q.enabled !== false ? ' checked' : '') + ' data-idx="' + idx + '"><span class="tk"></span></label>' +
      '<span class="ta-txt">' + esc(q.text) + (tag ? ' <span class="tc-known">' + tag + '</span>' : '') + '</span>' +
      '<button class="ta-del" data-idx="' + idx + '">✕</button>' +
      '</div>';
    if (isAction) {
      html += '<div class="tc-qopts">TA对我：' + esc(q.taToMe || q.text) + ' / 我对TA：' + esc(q.meToTa || q.text) + '</div>';
    }
    return html;
  }
  function ckAddFormHtml(blockKey, grp, cat) {
    const isActionCat = cat === 'action';
    return '<div class="ta-add">' +
      '<select class="ta-type tc-input" data-key="' + blockKey + '">' +
      (isActionCat ? '<option value="action">互动动作</option>' : '<option value="text">文字回复</option><option value="single">单选题</option>') +
      '</select>' +
      '<input id="ckq-new-' + blockKey + '" type="text" placeholder="' + (isActionCat ? '动作名，如 摸摸头' : '添加问题…') + '">' +
      '<button class="ta-add-btn" data-key="' + blockKey + '" data-cat="' + (cat || 'text') + '" data-grp="' + (grp || '') + '">添加</button>' +
      (isActionCat
        ? '<textarea id="ckq-opts-' + blockKey + '" class="ta-opts tc-input" rows="4" placeholder="两行文案（TA对我 / 我对TA），如&#10;TA 想摸摸你的头&#10;TA 想让你摸摸 TA 的头&#10;——下面再写回应，accept~回应;回应 换行 reject~回应;回应"></textarea>'
        : '<textarea id="ckq-opts-' + blockKey + '" class="ta-opts tc-input" rows="3" placeholder="每行一个选项。可写 选项~TA回应；多条回应用 ; 分隔，如 在想你~就知道。;嗯，这次信你。" hidden></textarea>') +
      '</div>';
  }
  function renderCkMineInto(container, search) {
    if (!container) return;
    const d = ckLoad();
    const groups = Array.isArray(d.groups) ? d.groups : [];
    const mineQs = d.questions.filter(q => q && q.isPreset !== true && q.text && (search === '' || q.text.indexOf(search) >= 0));
    let html = '';
    html += '<div class="mg-grp-row"><button class="cc-tool" id="ckq-grp-add"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>新建分组</button></div>';
    if (!mineQs.length && !groups.length) {
      html += '<div class="ta-empty" style="padding:14px">暂未添加自定义问题，可在上方批量导入或下方添加</div>';
      container.innerHTML = html;
      bindCkGroupOps();
      return;
    }
    // 自定义分组区块（置顶）
    groups.forEach(g => {
      const arr = mineQs.filter(q => q.grp === g.id);
      html += '<div class="cal-card glass mg-block">' +
        '<div class="cal-card-title mg-title"><span class="mg-name">' + esc(g.name) + '</span><span class="mg-cnt">(' + arr.length + ')</span>' +
        '<span class="mg-ops"><button class="mg-op" data-ckqg="' + esc(g.id) + '" data-op="rn" title="重命名">✎</button><button class="mg-op" data-ckqg="' + esc(g.id) + '" data-op="rm" title="删除分组">✕</button></span></div>';
      if (!arr.length) html += '<div class="ta-empty">这个分组还没有内容，可在下方直接添加</div>';
      arr.forEach(q => { html += ckItemHtml(q, d.questions.indexOf(q)); });
      html += ckAddFormHtml('g' + g.id, g.id, 'text');
      html += '</div>';
    });
    // 未分组区块（按 单选查岗/文字查岗 分类展示）
    const ungrouped = mineQs.filter(q => !q.grp);
    html += '<div class="cal-card glass mg-block mg-ungrouped"><div class="cal-card-title mg-title"><span class="mg-name">未分组 · 按类型</span><span class="mg-cnt">(' + ungrouped.length + ')</span></div>';
    if (!ungrouped.length) html += '<div class="ta-empty">暂无未分组内容，可在上方批量导入（文字题）或下方添加</div>';
    CATS_CKQ.forEach(([k, label]) => {
      const arr = ungrouped.filter(q => (q.cat || (q.type === 'single' ? 'single' : 'text')) === k && (search === '' || q.text.indexOf(search) >= 0));
      if (!arr.length) return;
      html += '<div class="mg-subcat">' + esc(label) + ' <span style="font-size:11px;color:var(--muted);font-weight:400">(' + arr.length + ')</span></div>';
      arr.forEach(q => { html += ckItemHtml(q, d.questions.indexOf(q)); });
      html += ckAddFormHtml('c' + k, '', k);
    });
    html += '</div>';
    container.innerHTML = html;
    container.querySelectorAll('input[data-idx]').forEach(cb => {
      cb.addEventListener('change', () => {
        const d2 = ckLoad();
        const q = d2.questions[Number(cb.dataset.idx)];
        if (q) q.enabled = cb.checked;
        ckSave(d2);
      });
    });
    container.querySelectorAll('.ta-del').forEach(b => {
      b.addEventListener('click', () => {
        const d2 = ckLoad();
        const q = d2.questions[Number(b.dataset.idx)];
        if (q && q.isPreset === true) { toast('系统预设问题不可删除，可关闭使用'); return; }
        d2.questions.splice(Number(b.dataset.idx), 1);
        ckSave(d2);
        renderCkMineInto(container, search);
        refreshCkCardCounts();
      });
    });
    // 类型下拉切换 → 显示/隐藏选项输入（含安卓 ce-box 幽灵框联动，与 ta-ask.js 同款）
    container.querySelectorAll('.ta-type').forEach(sel => {
      const toggleOpts = () => {
        const o = document.getElementById('ckq-opts-' + sel.dataset.key);
        if (!o) return;
        o.hidden = sel.value === 'text';
        if (o.__ceBox) o.__ceBox.hidden = o.hidden;
        else if (o.nextElementSibling && o.nextElementSibling.classList && o.nextElementSibling.classList.contains('ce-box')) o.nextElementSibling.hidden = o.hidden;
      };
      sel.addEventListener('change', toggleOpts);
      toggleOpts();
    });
    container.querySelectorAll('.ta-add-btn').forEach(b => {
      b.addEventListener('click', () => {
        const key = b.dataset.key;
        const inp = document.getElementById('ckq-new-' + key);
        const v = inp ? inp.value.trim() : '';
        if (!v) { toast('请输入问题'); return; }
        const typeSel = b.parentElement.querySelector('.ta-type');
        const type = typeSel ? typeSel.value : 'text';
        const d2 = ckLoad();
        const q = { id: 'k_' + Date.now() + '_' + Math.floor(Math.random() * 999), text: v, cat: type, enabled: true, isPreset: false };
        if (type === 'single') q.type = 'single';
        if (type === 'action') q.type = 'action';
        if (b.dataset.grp) q.grp = b.dataset.grp;
        if (type === 'single') {
          const optsEl = document.getElementById('ckq-opts-' + key);
          const opts = (optsEl ? optsEl.value : '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(line => {
            const i = line.indexOf('~');
            if (i < 0) return { t: line, reply: '' };
            const t = line.slice(0, i).trim();
            const replies = line.slice(i + 1).split(';').map(s => s.trim()).filter(Boolean);
            return { t: t, reply: replies.length > 1 ? replies : (replies[0] || '') };
          });
          if (!opts.length) { toast('单选题请填写选项，每行一个'); return; }
          q.options = opts;
        } else if (type === 'action') {
          // 互动动作：opts 文本域前两行=文案（TA对我 / 我对TA），之后 accept~回应;回应 / reject~回应;回应
          const optsEl = document.getElementById('ckq-opts-' + key);
          const lines = (optsEl ? optsEl.value : '').split(/\r?\n/).map(s => s.trim());
          q.taToMe = lines[0] || ('TA 想' + v + '你');
          q.meToTa = lines[1] || ('TA 想让你' + v + ' TA');
          const acc = [], rej = [];
          for (let i = 2; i < lines.length; i++) {
            const ln = lines[i]; if (!ln) continue;
            const j = ln.indexOf('~');
            if (j < 0) continue;
            const tag = ln.slice(0, j).trim().toLowerCase();
            const reps = ln.slice(j + 1).split(';').map(s => s.trim()).filter(Boolean);
            if (tag === 'accept') reps.forEach(r => acc.push(r));
            else if (tag === 'reject') reps.forEach(r => rej.push(r));
          }
          q.accept = acc.length ? acc : ['乖，过来。'];
          q.reject = rej.length ? rej : ['下次吧。'];
        }
        d2.questions.push(q);
        ckSave(d2);
        renderCkMineInto(container, search);
        refreshCkCardCounts();
        toast(type === 'single' ? '已添加单选查岗问题' : (type === 'action' ? '已添加互动动作' : '已添加文字查岗问题'));
      });
    });
    bindCkGroupOps();
  }
  // 我的添加 tab 的分组管理：新建 / 重命名 / 删除（cardGroups 公共工具来自 ta-ask.js）
  function bindCkGroupOps() {
    const grpAdd = document.getElementById('ckq-grp-add');
    if (grpAdd && !grpAdd.__bound) {
      grpAdd.__bound = true;
      grpAdd.addEventListener('click', () => {
        const d2 = ckLoad();
        window.cardGroups.addFlow(d2.groups, g => {
          if (!g) return;
          ckSave(d2);
          renderCkMineInto(document.getElementById('ckq-mine-cats'), getCkSearch());
          toast('已新建分组「' + g.name + '」');
        });
      });
    }
    const wrap = document.getElementById('ckq-mine-cats');
    if (!wrap) return;
    wrap.querySelectorAll('.mg-op').forEach(b => {
      if (b.__bound) return;
      b.__bound = true;
      b.addEventListener('click', () => {
        const d2 = ckLoad();
        const gid = b.dataset.ckqg;
        const g = (d2.groups || []).find(x => x.id === gid);
        if (!g) return;
        if (b.dataset.op === 'rn') {
          window.cardGroups.renameFlow(g, d2.groups, name => {
            if (!name) return;
            g.name = name;
            ckSave(d2);
            renderCkMineInto(wrap, '');
            toast('分组已重命名');
          });
        } else if (b.dataset.op === 'rm') {
          window.cardGroups.removeFlow(g.name, ok => {
            if (!ok) return;
            d2.questions.forEach(q => { if (q.grp === gid) q.grp = ''; });
            d2.groups = d2.groups.filter(x => x.id !== gid);
            ckSave(d2);
            renderCkMineInto(wrap, '');
            toast('已删除分组「' + g.name + '」');
          });
        }
      });
    });
  }

  // ---- tab 切换 / 搜索 / 设置开关 ----
  let ckTab = 'sys';
  let ckSearch = '';
  function getCkSearch() { return ckSearch; }
  function switchCkTab(tab) {
    ckTab = tab;
    const tabsWrap = document.getElementById('ckq-tabs');
    if (tabsWrap) tabsWrap.querySelectorAll('.cc-tab').forEach(t => t.classList.toggle('sel', t.dataset.tab === tab));
    const sysPanel = document.getElementById('ckq-sys-panel');
    const minePanel = document.getElementById('ckq-mine-panel');
    if (sysPanel) sysPanel.hidden = tab !== 'sys';
    if (minePanel) minePanel.hidden = tab !== 'mine';
    ckSearch = '';
    const searchInput = document.getElementById('ckq-search');
    if (searchInput) searchInput.value = '';
    if (tab === 'sys') renderCkSysInto(document.getElementById('ckq-sys-cats'), ''); else renderCkMineInto(document.getElementById('ckq-mine-cats'), '');
  }
  const ckTabsWrap = document.getElementById('ckq-tabs');
  if (ckTabsWrap) {
    ckTabsWrap.querySelectorAll('.cc-tab').forEach(tab => {
      tab.addEventListener('click', () => switchCkTab(tab.dataset.tab));
    });
  }
  const ckSearchInput = document.getElementById('ckq-search');
  if (ckSearchInput) {
    ckSearchInput.addEventListener('input', () => {
      ckSearch = ckSearchInput.value.trim();
      if (ckTab === 'sys') renderCkSysInto(document.getElementById('ckq-sys-cats'), ckSearch);
      else renderCkMineInto(document.getElementById('ckq-mine-cats'), ckSearch);
    });
  }
  function renderCkSettings() {
    const el = document.getElementById('ckq-default');
    if (el) el.checked = (ckLoad().settings || {}).useDefault !== false;
  }
  const ckDefault = document.getElementById('ckq-default');
  if (ckDefault) ckDefault.addEventListener('change', () => {
    const d = ckLoad();
    d.settings.useDefault = ckDefault.checked;
    ckSave(d);
    switchCkTab(ckTab);
    toast(ckDefault.checked ? '系统预设问题已开启' : '系统预设问题已关闭（仅用你添加的问题）');
  });

  // 批量导入文字题（一行一个问题；单选题请在「我的添加」里用表单加）
  const batchTextEl = document.getElementById('ckq-batch');
  const batchAddBtn = document.getElementById('ckq-batch-add');
  if (batchTextEl && batchAddBtn) {
    batchAddBtn.addEventListener('click', () => {
      const lines = (batchTextEl.value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (!lines.length) { toast('请先输入问题，每行一个'); return; }
      const d2 = ckLoad();
      lines.forEach(t => {
        d2.questions.push({ id: 'k_' + Date.now() + '_' + Math.floor(Math.random() * 9999), cat: 'text', text: t, enabled: true, isPreset: false });
      });
      ckSave(d2);
      batchTextEl.value = '';
      renderCkMineInto(document.getElementById('ckq-mine-cats'), '');
      refreshCkCardCounts();
      toast('已导入 ' + lines.length + ' 个文字查岗问题');
    });
  }

  // 「让TA现在查岗一次」（遵循回复设置里的自动弹窗概率）
  const nowBtn = document.getElementById('ckq-now');
  if (nowBtn) nowBtn.addEventListener('click', () => {
    if (window.triggerCkQuestion()) toast('TA 在聊天里来查岗了');
  });

  // ---- 入口：字卡库页双入口（与 TA的询问 同款：主入口看系统预设，「我的添加」入口只看自定义） ----
  if (page) {
    const showPage = (tab) => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      page.hidden = false;
      const tw = document.getElementById('ckq-tabs'); if (tw) tw.style.display = 'none';
      switchCkTab(tab);
    };
    const li = document.getElementById('li-ta-checkin');
    if (li) li.addEventListener('click', () => showPage('sys'));
    const liMine = document.getElementById('li-ta-checkin-mine');
    if (liMine) liMine.addEventListener('click', () => showPage('mine'));
    const backBtn = document.getElementById('ckq-back');
    if (backBtn) backBtn.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-chatcard');
      if (home) home.hidden = false;
    });
    renderCkSettings();
  }

  // ---- 字卡库入口数字（系统预设 / 我的添加 分开计数，模式同 ta-ask.js refreshTaCardCounts） ----
  window.refreshCkCardCounts = function () {
    try {
      const qs = ckLoad().questions || [];
      const elSys = document.querySelector('#li-ta-checkin > .t');
      if (elSys) elSys.textContent = qs.filter(q => q && q.isPreset === true).length;
      const elMine = document.querySelector('#li-ta-checkin-mine > .t');
      if (elMine) elMine.textContent = qs.filter(q => q && q.isPreset !== true).length;
    } catch (e) {}
  };
  const ccPageEl = document.getElementById('page-chatcard');
  if (ccPageEl) {
    const mo = new MutationObserver(() => { if (!ccPageEl.hidden) window.refreshCkCardCounts(); });
    mo.observe(ccPageEl, { attributes: true, attributeFilter: ['hidden'] });
  }
  window.refreshCkCardCounts();

  // ---- 跨分类搜索注册（字卡库搜索框，模式同 ta-ask.js） ----
  window.__cardSearchFns = window.__cardSearchFns || [];
  window.__cardSearchFns.push({ name: 'TA的查岗', fn: function (kw) {
    const out = [];
    try { (ckLoad().questions || []).forEach(function (q) { const txt = q && q.text ? q.text : ''; if (txt && txt.toLowerCase().indexOf(kw) >= 0) out.push({ t: txt, cat: q.isPreset === true ? '系统预设' : '我的添加' }); }); } catch (e) {}
    return out;
  } });

  // ---- IndexedDB 权威恢复（localStorage 配额写失败时自定义题不丢，模式同 ta-ask.js attachIdbRestore） ----
  (function () {
    if (!window.idbGet || !window.activePrefix) return;
    window.idbGet(window.activePrefix() + ':' + KEY).then(function (v) {
      if (v === undefined || v === null) return;
      try {
        const idbData = typeof v === 'string' ? JSON.parse(v) : v;
        if (!idbData || typeof idbData !== 'object' || Array.isArray(idbData)) return;
        if (!Array.isArray(idbData.questions) || !idbData.questions.length) return;
        const local = ckLoad();
        if (idbData.questions.length > (Array.isArray(local.questions) ? local.questions.length : 0)) {
          ckMerge(idbData);
          try { store.set(KEY, JSON.stringify(idbData)); } catch (e) {}
          try { window.refreshCkCardCounts(); } catch (e) {}
        }
      } catch (e) {}
    });
  })();
})();
