// ===== 功能：梦角自由造句（#317 / #326 多手法 / #327 撤回式截断定稿）=====
// 需求（用户 2026-09-11 #327 定稿）：截断要像「联系人撤回消息」——撤回的尾巴不要了，
// **留下的前缀就是新的梦角造句**（如「今天也要好好爱自己，晚安哦」撤回「，晚安哦」→
// 「今天也要好好爱自己」）。v27 五手法里的截词补语气词/句尾后缀/删尾字被用户判「太离奇」，
// 全部移除；保留词间隙加逗号/加空格两种温和手法。
// 三手法随机（每次造句掷一次）：
//   recall 50%  撤回式截断：按词典切词后在词间隙切尾，前缀（≥4 汉字）成为新句；
//   comma  25%  词间隙加逗号（如「今天也要，好好爱自己」）；
//   space  25%  词间隙加空格（与词典拼字单气泡同味道）。
// 词边界来自内置词典（DEFAULT_CARD_DATA.dict「词库*」分组，正向最大匹配切词）。
// 入库规则（#324）：多联系人 80% 进公用库 / 20% 进专属库；单联系人 100% 专属库。
// 设置项（回复设置 → 聊天 tab「梦角自由造句」组）：mjf-en（#513 起默认开）、mjf-prob（默认 20%）。
// #413 语料来源扩展（默认=全部字卡，三源可选+权重可调）：
//   mjf-src-cc 自定义聊天字卡（默认开，原唯一语料）/ mjf-src-def 默认聊天字卡（默认开）/
//   mjf-src-dict 词典语录（默认开）；各源权重 mjf-w-cc / mjf-w-def / mjf-w-dict
//   （默认 50/25/25，按权重归一化抽源；权重全 0 或某源关=不参与，全关=不触发）。
// #513a 语料口径校对（用户点名「使用的是 自定义字卡的公用字卡＋专属字卡＋系统预设字卡的
//   默认聊天字卡＋默认聊天字卡·词典」）——四类语料与三个开关的对应关系：
//     ① 自定义·公用字卡 + ② 自定义·专属字卡：都由 mjf-src-cc 一个开关控制——它的池子来自
//        getCustomCards()，即 chatcard 的 replyPoolGroups()＝专属(own)+公用(public) 合并视图，
//        两个作用域各自的【分组停用】都在合并前过滤，字卡内容改动实时生效；功能字卡分类
//        （鱼/吃/经期/花园/此间/房间/存钱罐/漂流瓶/互动回应/音乐/梦角自由造句自身…）不进池。
//     ③ 系统预设·默认聊天字卡（mjf-src-def）：按 字卡库→系统预设→默认聊天字卡 页同名口径
//        取四大基础分类 main/kaomoji/emoji/touch 全部文本；颜文字/emoji 基本不含 4 个以上
//        汉字，被 filterCorpus 天然排除，真正参与的只有主字卡与拍一拍。尊重两类关闭：
//        分类开关 dc-cat-*（window.defaultCardCat，缺省开）与逐张关闭 isDefaultCardOff。
//     ④ 系统预设·词典（mjf-src-dict）：dict 全部分组（语录* 做源句、词库* 因 2~3 字被长度
//        过滤，只用于切词）；逐张关闭口径对齐词典拼字（isDefaultCardOff('dict', …)），
//        字卡库→词典里关掉的语录不再作源句。
//     二级密码锁（#319）锁定时 getDefaultCardGroups 一律返回 []＝③④ 为空池自动不参与，
//     ①② 自建字卡照常（锁只停系统预设池，同全站口径）。
// 接线：build.mjs jsFiles；chat.js replyOnce 消费 window.dreamFreePick（气泡带「梦角自由造句」tag）。
// 纯本地，无网络请求。
(function () {
  // 补位词池：截词处替换用的语气/可爱系词（#328 旧式多手法 cutfill 用）
  const FILL_WORDS = ['想你', '抱抱', '亲亲', '嘿嘿', '哦', '呀', '啦', '嘛', '呢', '哼',
    '想你了', '最喜欢你', '晚安', '早安', '嘿嘿嘿', '哼哼', '呜呜', '嘻嘻', '好耶', '喵'];
  // 句尾后缀池（#328 旧式多手法 suffix 用）
  const SUFFIXES = ['呀', '啦', '哦', '呢', '嘛', '哟', '哈', '嘿嘿'];
  let lastSrc = '';     // 连续防复读：上一条造句的源卡不立刻重抽
  let segDict = null;   // 切词词典缓存（词库* 分组构建一次）
  let segMax = 4;       // 正向最大匹配窗口（随词典最长词增长，上限 8）
  const HAN = /[\u4e00-\u9fff]/;
  function getSegDict() {
    if (segDict) return segDict;
    segDict = new Set();
    segMax = 4;
    try {
      ((window.getDefaultCardGroups && window.getDefaultCardGroups('dict')) || []).forEach(g => {
        if (!g || typeof g[0] !== 'string' || g[0].indexOf('词库') !== 0) return;
        (g[1] || []).forEach(wd => {
          if (typeof wd !== 'string' || wd.length < 2) return;
          segDict.add(wd);
          if (wd.length > segMax && wd.length <= 8) segMax = wd.length;
        });
      });
    } catch (e) {}
    return segDict;
  }
  // 正向最大匹配切词：词典命中最长词，未命中回落单字；非汉字段（标点/字母）整体成 token
  function segment(s) {
    const str = String(s == null ? '' : s);
    const dict = getSegDict();
    const out = [];
    let i = 0;
    while (i < str.length) {
      if (!HAN.test(str[i])) {
        let j = i;
        while (j < str.length && !HAN.test(str[j])) j++;
        out.push(str.slice(i, j));
        i = j;
        continue;
      }
      let len = 0;
      for (let L = Math.min(segMax, str.length - i); L >= 2; L--) {
        if (dict.has(str.slice(i, i + L))) { len = L; break; }
      }
      if (!len) len = 1;
      out.push(str.slice(i, i + len));
      i += len;
    }
    return out;
  }
  const isWordTok = t => HAN.test(t); // 含汉字＝词 token（非汉字 token 视为标点/符号段）
  // 语料通用过滤（≥4 个汉字才够截，剔 dataURL/媒体令牌/空白/孤立代理对）
  function filterCorpus(list) {
    return (list || []).filter(function (s) {
      if (typeof s !== 'string') return false;
      if (s.length < 4 || s.length > 30) return false;
      if (s.indexOf('data:') === 0 || s.indexOf('|||') >= 0) return false;
      if (/[\uD800-\uDBFF]/.test(s)) return false;
      return (s.match(/[\u4e00-\u9fff]/g) || []).length >= 4;
    });
  }
  // #413 三语料源：自定义聊天字卡（原唯一语料）
  function customPool() {
    let cards = [];
    try { cards = (window.getCustomCards && window.getCustomCards()) || []; } catch (e) { cards = []; }
    return filterCorpus(cards);
  }
  // FIX 2026-09-15 #513a 默认聊天字卡改为四分类同源（此前只取 main）
  // #513a 默认聊天字卡（mjf-src-def）：与 字卡库→系统预设→默认聊天字卡 同口径＝四大基础
  // 分类全部分组文本展平（main 主字卡 / kaomoji 颜文字 / emoji / touch 拍一拍；后两类基本
  // 不含 4 个以上汉字，由 filterCorpus 天然排除）。尊重①分类开关 dc-cat-*（defaultCardCat，
  // 缺省开）②逐张关闭 isDefaultCardOff（按各自分类记键，与聊天混入口径一致）；二级锁（#319）
  // 锁定时 getDefaultCardGroups 返回 []，天然为空池
  const DEF_CATS = ['main', 'kaomoji', 'emoji', 'touch'];
  function defaultPool() {
    try {
      const all = [];
      DEF_CATS.forEach(cat => {
        if (window.defaultCardCat && !window.defaultCardCat(cat)) return;
        const gs = (window.getDefaultCardGroups && window.getDefaultCardGroups(cat)) || [];
        gs.forEach(g => ((g && g[1]) || []).forEach(t => {
          if (window.isDefaultCardOff && window.isDefaultCardOff(cat, t)) return;
          all.push(t);
        }));
      });
      return filterCorpus(all);
    } catch (e) { return []; }
  }
  // FIX 2026-09-15 #513a 词典源补逐张关闭过滤（对齐词典拼字口径）
  // 词典（mjf-src-dict）：dict 全部分组文本（语录整句最适合做源句；词库 2~3 字词被长度过滤
  // 自动排除、只用于切词）。#513a 逐张关闭对齐词典拼字（quote-spell.js 同款
  // isDefaultCardOff('dict', …)）——此前漏滤＝字卡库→词典里关掉的语录仍被当源句
  function dictPool() {
    try {
      const gs = (window.getDefaultCardGroups && window.getDefaultCardGroups('dict')) || [];
      const all = gs.reduce((a, g) => a.concat((g && g[1]) || []), []);
      return filterCorpus(all.filter(t => !(window.isDefaultCardOff && window.isDefaultCardOff('dict', t))));
    } catch (e) { return []; }
  }
  // 全语料合并（#329 换字卡内容式的词素材池用——来源扩了，补词素材同步跟着扩）
  function allCorpus() { return customPool().concat(defaultPool(), dictPool()); }
  // #413 按开关+权重选语料源：有效源=开关开且池非空；权重取 cfg（缺省 50/25/25），
  // 权重和为 0 时等权；无有效源返回 null（三个来源全关=不触发，总开关之外的第二道闸）
  function pickSourcePool(c) {
    const on = k => !(c && c[k] === 0); // 缺省=开（存量升级即得三源全开）
    const wt = (k, d) => { const n = Number(c && c[k]); return (isFinite(n) && n > 0) ? n : d; };
    const srcs = [];
    if (on('mjf-src-cc')) { const p = customPool(); if (p.length) srcs.push({ w: wt('mjf-w-cc', 50), pool: p }); }
    if (on('mjf-src-def')) { const p = defaultPool(); if (p.length) srcs.push({ w: wt('mjf-w-def', 25), pool: p }); }
    if (on('mjf-src-dict')) { const p = dictPool(); if (p.length) srcs.push({ w: wt('mjf-w-dict', 25), pool: p }); }
    if (!srcs.length) return null;
    let total = 0;
    srcs.forEach(s => { total += s.w; });
    if (total <= 0) return srcs[Math.floor(Math.random() * srcs.length)].pool;
    let r = Math.random() * total;
    for (let i = 0; i < srcs.length; i++) { r -= srcs[i].w; if (r < 0) return srcs[i].pool; }
    return srcs[srcs.length - 1].pool;
  }
  // 撤回式截断（#327 主手法）：词间隙随机选切点，切点之后的尾巴「撤回不要」，
  // 前缀成为新句。前缀至少保留 4 个汉字、至少 2 个词 token，且必须真的截掉了内容。
  function recallCut(s) {
    const str = String(s == null ? '' : s);
    const toks = segment(str);
    if (toks.length < 3) return null;
    const gaps = [];
    for (let i = 2; i < toks.length; i++) {
      const keep = toks.slice(0, i).join('');
      if ((keep.match(/[\u4e00-\u9fff]/g) || []).length >= 4) gaps.push(i);
    }
    if (!gaps.length) return null;
    // 偏好靠后切：越靠后保留越多、越像「说到一半撤回」，权重线性递增
    let total = 0, acc = [];
    gaps.forEach(gi => { total += gi; acc.push(total); });
    const r = Math.random() * total;
    let gi = gaps[gaps.length - 1];
    for (let k = 0; k < gaps.length; k++) { if (r < acc[k]) { gi = gaps[k]; break; } }
    const out = toks.slice(0, gi).join('').replace(/[，、,\s]+$/, '');
    return (out !== str && out.length >= 4) ? out : null;
  }
  // #329 词素材池：把「别的字卡」全部切词，收 ≥2 字词（截词补位/句尾拼接从这里取材，
  // 不再用固定语气词——用户明确：补的应该是别的字卡内容）。excludeSrc=源句，防同句自补
  function wordPool(excludeSrc) {
    const pool = [];
    allCorpus().forEach(card => {
      if (card === excludeSrc) return;
      segment(card).forEach(t => {
        if (t.length >= 2 && isWordTok(t) && pool.indexOf(t) < 0) pool.push(t);
      });
    });
    return pool;
  }
  // 重造句：s = 源句，mode = 手法，material = 补位素材（#329：'fixed'=固定语气词 /
  // 'cards'=别的字卡里的词）。造不出（句太短/无可插边界）返回 null。
  // 三手法对应关系（mjf-style）：0 语气词式→material fixed；2 换字卡内容式→material cards。
  function rebuild(s, mode, material) {
    const str = String(s == null ? '' : s);
    if (mode === 'recall') return recallCut(str);
    if (mode === 'suffix') {
      // 语气词式（material='fixed'）：句尾加语气后缀
      const base = str.replace(/[，。！？、…～s]+$/, '');
      if (base.length < 3) return null;
      const out = base + SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
      return out !== str ? out : null;
    }
    if (mode === 'addtail') {
      let word = null;
      if (material === 'cards') {
        const wp = wordPool(str);
        if (wp.length) word = wp[Math.floor(Math.random() * wp.length)];
      } else {
        word = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
      }
      if (!word) return null;
      const base = str.replace(/[，。！？、…～\s]+$/, '');
      const out = base + word;
      return out !== str ? out : null;
    }
    if (mode === 'tailcut') {
      const base = str.replace(/[，。！？、…～\s]+$/, '');
      if (base.length < 4) return null;
      const cut = 1 + Math.floor(Math.random() * Math.min(2, base.length - 2));
      return base.slice(0, base.length - cut);
    }
    const toks = segment(str);
    if (toks.length < 3) return null;
    const gaps = [];
    for (let i = 1; i < toks.length; i++) {
      if (isWordTok(toks[i - 1]) && isWordTok(toks[i])) gaps.push(i); // 只落在词与词的间隙
    }
    if (!gaps.length) return null;
    const gi = gaps[Math.floor(Math.random() * gaps.length)];
    if (mode === 'cutfill') {
      // 抽掉切点后的一个词、原位补词：material='cards' 补「别的字卡」的词（词库空回落语气词）、
      // 'fixed' 补固定语气词（语气词式）
      const rest = toks.slice(gi);
      const wi = Math.floor(Math.random() * rest.length);
      let fill;
      if (material === 'cards') {
        const wp = wordPool(str);
        fill = wp.length ? wp[Math.floor(Math.random() * wp.length)] : FILL_WORDS[Math.floor(Math.random() * FILL_WORDS.length)];
      } else {
        fill = FILL_WORDS[Math.floor(Math.random() * FILL_WORDS.length)];
      }
      const out = toks.slice(0, gi).join('') + fill + rest.filter((_, k) => k !== wi).join('');
      return out !== str ? out : null;
    }
    const sep = mode === 'comma' ? '，' : ' ';
    const out = toks.slice(0, gi).join('') + sep + toks.slice(gi).join('');
    return out !== str ? out : null;
  }
  // 抽句门：c = replyCfg()。命中返回 { text: 新句, src: 源卡 }；关闭/未命中/造不出返回 null。
  window.dreamFreePick = function (c) {
    try {
      if (!c || c['mjf-en'] !== 1) return null;
      const prob = Number(c['mjf-prob']);
      if (!isFinite(prob) || prob <= 0 || Math.random() * 100 >= prob) return null;
      const pool = pickSourcePool(c); // #413 三语料源按开关+权重抽
      if (!pool || !pool.length) return null;
      // #329 三种造句手法（mjf-style 选择，默认 1=撤回式）：
      //   0=语气词式：截词补语气词 / 加逗号 / 加空格 / 句尾加语气后缀 / 删句尾字（五选一）
      //   1=撤回式：撤回式截断 50% + 词间加逗号/空格各 25%
      //   2=换字卡内容式：截词补「别的字卡」的词 / 加逗号 / 加空格 / 句尾拼「别的字卡」的词 / 删句尾字
      // #414 混合模式（mjf-mix，#513 起默认开）：开启后每次造句先在三种手法里随机掷一个，
      //   再按该手法的手法池出招——三种模式交替出现，不再固定单一风格
      let style = Math.max(0, Math.min(2, Number(c['mjf-style']) || 1));
      if (c['mjf-mix'] === 1) style = Math.floor(Math.random() * 3);
      const pickOf = arr => arr[Math.floor(Math.random() * arr.length)];
      for (let t = 0; t < 8; t++) {
        const s = pool[Math.floor(Math.random() * pool.length)];
        if (s === lastSrc) continue;
        let mode, material = 'fixed';
        if (style === 1) {
          const r = Math.random();
          mode = r < 0.5 ? 'recall' : (r < 0.75 ? 'comma' : 'space');
        } else if (style === 2) {
          material = 'cards';
          mode = pickOf(['cutfill', 'comma', 'space', 'addtail', 'tailcut']);
        } else {
          mode = pickOf(['cutfill', 'comma', 'space', 'suffix', 'tailcut']);
        }
        const txt = rebuild(s, mode, material);
        if (txt && txt !== s) { lastSrc = s; return { text: txt, src: s }; }
      }
      return null;
    } catch (e) { return null; }
  };
  // 造句结果入库（#324 分库规则 / #364 概率可调）：多联系人时按回复设置 mjf-pub
  // （存公用库概率，默认 80%）进公用库、其余进当前联系人专属库；
  // 只有一个桌面联系人时 100% 进专属库（公用库没有分享对象，全部留专属），不受该设置影响。
  // 写 cc-groups 的 mjfree 分类「梦角自由造句」分组（chatcard.js window.ccAppendCards，
  // 写守卫/去重/持久化复用；scope 'public'|'own' 双作用域）
  window.dreamFreeSave = function (txt) {
    try {
      const v = String(txt == null ? '' : txt);
      if (!v || v.indexOf('data:') === 0 || v.indexOf('|||') >= 0) return false;
      if (!window.ccAppendCards) return false;
      let cids = 1;
      try {
        const set = new Set([window.__activeCid || 'default']);
        (window.getContacts && window.getContacts() || []).forEach(c => { if (c && c.id) set.add(c.id); });
        cids = set.size;
      } catch (e) { cids = 1; }
      let pubProb = 80;
      try {
        const c = window.replyCfg && window.replyCfg();
        const n = c ? Number(c['mjf-pub']) : NaN;
        if (c && c['mjf-pub'] != null && c['mjf-pub'] !== '' && Number.isFinite(n)) pubProb = Math.max(0, Math.min(100, n));
      } catch (e) {}
      const usePublic = cids > 1 && Math.random() * 100 < pubProb;
      return !!window.ccAppendCards('mjfree', '梦角自由造句', [v], usePublic ? 'public' : 'own');
    } catch (e) { return false; }
  };
  // 暴露切词/造句（verify 脚本与排查用）
  window.dreamFreeSegment = segment;
  window.dreamFreeRebuild = rebuild;
})();
