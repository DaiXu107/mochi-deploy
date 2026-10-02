// ===== 功能：词典拼字（#298 / v27 拼字卡=整张语录字卡连发 / #323 双形态混合）=====
// 需求（用户 2026-09-11 v27 定稿）：**「今晚的月色真美」本身是一张完整的字卡，不许拆**。
// 「拼字」= 从语录字卡库抽 2~5 张完整语录字卡（张数可单设：#1451「每次拼字最少/最多张数」，
// 缺键时跟随「多字卡回复」的最少/最多条数）——字卡和字卡拼在一起才叫拼字。
// #323（用户 2026-09-11）：两种发送形态共用同一拼字概率、混合触发，各自可开关——
//   ① 单气泡形态（qs-one，默认开）：几张字卡用连接符拼成一条消息发进同一个聊天气泡（连接符走
//      #650「拼接随机标点」符号池，关＝空格；#1451 起才真正接上——此前该形态正文绕过了符号池）；
//   ② 多回复形态（qs-multi，默认开）：每张字卡单独一条气泡逐条连发；
//      短字卡（一两个字）本来就适合一条一条发。
//   两种形态都命中时（都开）单气泡为主、逐条连发小概率（80/20，#370 定稿）；multi 关 = 不能连发，
//   都关 = 兜底单气泡形态（qs-en 开着不能完全没形态）。
//   每条气泡/单气泡下都显示「词典拼字」tag。
// FIX 2026-09-25 #1236「全封死」（用户 iPhone17Pro/iOS27 实报「多字卡回复关不掉」后直派口径）：
//   「多字卡回复」（py-en）是**拼字的总闸**——它关闭时本模块整体不触发，两种形态（单气泡拼接、
//   逐卡连发）一并不生效。旧口径「②不依赖 py-en、也不受 reply-min/max 限制」是用户 2026-09-11
//   指定的，实报证明它只带来「关了开关 TA 还在连发/还在拼接」的观感，现按 2026-09-25 的新口径
//   撤除；qs-one/qs-multi 降级为「py-en 开着时拼字怎么发」的形态选择，不再是独立入口。
// 纯本地，无网络请求。
// 数据源：DEFAULT_CARD_DATA.dict 全部分组（语录 + 词库 + 自建词条；#370 定稿词典里
// 所有字卡都能抽用）；受单卡开关 dc-off-dict:* 控制（#427：词典已独立成页，旧分类
// 开关键 dc-cat-dict 无写入 UI 且存量 '0' 会永久误杀抽卡池，不再读取）。
// 设置项（回复设置 → 聊天 tab「词典拼字」组，见 reply-settings.js DEFAULTS）：
//   qs-en    总开关（1=开）
//   qs-prob  拼字概率（%，每条回复掷一次；0=不触发）
//   qs-cc    混用自定义字卡（1=字卡池+语录库合并抽卡；0=只用词典语录）
//   qs-one   单气泡形态开关（1=开）
//   qs-multi 多回复逐卡连发形态开关（1=开）
//   qs-min / qs-max 每次拼几张（#1451）——两枚缺键＝跟随「多字卡回复」的 py-min/py-max（＝历史行为，
//     老存档零变化）；动过其中任意一枚，另一枚当场落盘成为独立的一对（见 reply-settings.js 的成对收口）
// 接线：chat.js replyOnce 在 genOneReply 之后调 window.quoteSpellPick(c)，命中返回
// { segs: 完整语录字卡数组, one: true|false }；下游收藏/心情分享/情绪链/撤回等链路原样复用。
(function () {
  // 拼字抽卡池：词典分类下全部分组（内置语录 + 自建语录 + 词库 + 扩展常用词，#370：
  // 用户定稿「词典里所有的字卡都能使用」，不再只取「语录*」前缀组；受分类/单卡开关控制）；
  // qs-cc=1 时由 pick 再并入自定义字卡池
  function quotePool() {
    let quotes = [];
    try {
      // #427：不再读 dc-cat-dict（遗留键无写入 UI，存量 '0' 会永久误判「词典分类被关」）；
      //   词典启用由 dict-use-chat / dict-overall / dc-off-dict:* 负责
      const grps = (window.getDefaultCardGroups && window.getDefaultCardGroups('dict')) || [];
      grps.forEach(g => {
        (g[1] || []).forEach(q => { if (typeof q === 'string') quotes.push(q); });
      });
    } catch (e) { quotes = []; }
    try {
      if (window.isDefaultCardOff) quotes = quotes.filter(q => !window.isDefaultCardOff('dict', q));
    } catch (e) {}
    return quotes.filter(function (q) {
      if (typeof q !== 'string' || !q.trim()) return false;
      if (q.indexOf('data:') === 0 || q.indexOf('|||') >= 0) return false;
      if (window.mochiMediaIsToken && window.mochiMediaIsToken(q)) return false; // FIX 2026-09-13 #394 媒体池令牌卡不进词典抽卡池
      if (/[\uD800-\uDBFF]/.test(q)) return false; // emoji 整卡不拼
      return true;
    });
  }
  // v3.36.x：词典语录单条只读取口（供写信/朋友圈按各自场景开关+概率混入）——
  //   复用 quotePool（自带单卡开关过滤），空池返回 null
  window.dictQuoteOne = function () {
    try {
      const p = quotePool();
      return p.length ? p[Math.floor(Math.random() * p.length)] : null;
    } catch (e) { return null; }
  };
  // 拼字卡抽取门：c = replyCfg()。命中返回 { segs: 完整语录字卡数组(qs-min~qs-max 张), one: true|false }；
  // 关闭/未命中返回 null（走原回复）。one:false = 每张卡一条气泡逐条连发。
  window.quoteSpellPick = function (c) {
    try {
      if (!c || c['qs-en'] !== 1) return null;
      // FIX 2026-09-25 #1236「多字卡回复」总闸：py-en 关闭＝拼字整体不触发（单气泡拼接与逐卡连发都停）。
      if (c['py-en'] !== 1) return null;
      // v3.36.x：词典场景总闸（词典独立页「聊天使用」开关 + 「聊天使用概率」）——
      //   开关关=聊天里词典内容整体停（拼字不再触发）；概率未命中=本次回复不使用词典内容。
      //   概率默认 100（不额外限流），既有 qs-prob/qs-one/qs-multi 行为不受影响。
      if (window.dictUse && window.dictUse('chat') === false) return null;
      if (window.dictOverall && Math.random() * 100 >= window.dictOverall('chat')) return null;
      const prob = (window.dcpEff ? window.dcpEff(Number(c['qs-prob'])) : Number(c['qs-prob'])); // #518 套总档
      if (!isFinite(prob) || prob <= 0 || Math.random() * 100 >= prob) return null;
      let pool = quotePool();
      if (c['qs-cc'] === 1) {
        try {
          const p = (window.getPool && window.getPool()) || null;
          if (p && p.text && p.text.length) {
            pool = pool.concat(p.text.filter(function (s) {
              if (typeof s !== 'string' || s.length < 2 || s.length > 26) return false;
              if (s.indexOf('data:') === 0 || s.indexOf('|||') >= 0) return false;
              if (window.mochiMediaIsToken && window.mochiMediaIsToken(s)) return false; // FIX 2026-09-13 #394 同款守卫（混入池二次校验）
              if (/[\uD800-\uDBFF]/.test(s)) return false;
              return (s.match(/[\u4e00-\u9fff]/g) || []).length >= 2;
            }));
          }
        } catch (e) {}
      }
      if (!pool.length) return null;
      // #323 形态选择（#370 定稿）：单气泡拼字是主形态——每次 qs-min~qs-max 张字卡连成一条消息；
      // qs-multi 逐条连发降为小概率形态：只在 multi 开时按 20% 掷出（双开 80/20）；
      // multi 关 = 不能连发（只发单气泡）；两个形态开关都关 = 兜底单气泡（不再兜底连发）
      const oneOn = c['qs-one'] === 1;
      const multiOn = c['qs-multi'] === 1;
      let one = true;
      if (multiOn) one = oneOn ? Math.random() >= 0.2 : false;
      // 抽卡条数（#1451）：拼字有自己的「每次拼字最少/最多张数」两枚（reply-qs-min／reply-qs-max，
      // 与「多字卡回复」那两枚同款语义但各管各的）。两枚都是【缺键＝跟随「最少/最多条数」】，
      // 生效值由 reply-settings.js getCfg 统一算好放进 cfg（那里还负责把成对的两枚互相收口），
      // 本模块只认 cfg 里的最终数，不再自己读存储——两处各算一份＝设置页显示的与实际出牌的不一致。
      const pmin = Math.max(1, Math.min(10, Number(c['qs-min']) || 2));
      const pmax = Math.max(pmin, Math.min(10, Number(c['qs-max']) || 5));
      let want = pmin + Math.floor(Math.random() * (pmax - pmin + 1));
      if (!one && c['qs-noLimit'] === 0) {
        // 仅当用户手动关闭「逐卡不受条数限制」时才收口到 reply-max
        const rmax = Math.max(pmin, Math.min(20, Number(c['reply-max']) || 2));
        if (want > rmax) want = rmax;
      }
      const cards = [pool[Math.floor(Math.random() * pool.length)]];
      for (let k = 0; k < 30 && cards.length < want; k++) {
        const s2 = pool[Math.floor(Math.random() * pool.length)];
        if (cards.indexOf(s2) < 0) cards.push(s2);
      }
      return { segs: cards, one: one };
    } catch (e) { return null; }
  };
})();
