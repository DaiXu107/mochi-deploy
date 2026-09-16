// ===== #518：系统预设字卡·聊天触发概率「总档」（dcp-all） =====
// 用户需求：回复设置里「自定义字卡占比」的对面——系统预设字卡的所有聊天字卡概率，
// 要有一个整体的分类 tag 可方便调整。本文件只提供总档的读取与缩放两个 API：
//   window.dcpAll(st)  —— 读总档值（键 reply-dcp-all，per-cid，0~100，未设/坏值回 100）
//   window.dcpEff(v,st)—— 生效概率 = 分类自身设定值 × 总档 ÷ 100（四舍五入、钳 0~100）；
//                          总档 100（含未设）时原值直通，默认行为完全不变（未设键=回退原值硬规）。
// 消费点接线（全部包 dcpEff）：default-cards.js drawCards(chat 场景)+dcfGet、
// mood-reply-cards.js 情绪/回应消费点、quote-spell.js qs-prob、ta-mood.js 心情掷签、
// ta-ask.js 四类互动卡掷签、ck-question.js 查岗、ta-invite.js hit()、chat.js cf-prob。
// 注意：各设置页的 stepper 显示的仍是分类自己的「存盘值」（#515 口径：不显示闸门后生效值），
// 总档只在掷签那一刻生效。分类档不新开键，全部复用各功能既有键。
(function () {
  function dcpAll(st) {
    try {
      const s = st || window.activeStore();
      const v = s.get('reply-dcp-all');
      if (v === null || v === undefined || v === '') return 100;
      const n = Number(v);
      if (isNaN(n)) return 100;
      return Math.max(0, Math.min(100, n));
    } catch (e) { return 100; }
  }
  function dcpEff(v, st) {
    const n = Number(v);
    if (!isFinite(n)) return 0;
    let a = 100;
    try { a = dcpAll(st); } catch (e) { a = 100; }
    if (a >= 100) return Math.max(0, Math.min(100, n));
    return Math.max(0, Math.min(100, Math.round(n * a / 100)));
  }
  window.dcpAll = dcpAll;
  window.dcpEff = dcpEff;
})();
