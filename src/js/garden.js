// ===== garden =====
(function () {
var s = window.activeStore();
var page = document.getElementById("page-garden");
if (!s || !page) return;
var G = "garden-data";
// 各桌面（联系人）花园相互独立；「全球园」合并视图已按需求移除，
// 启动时一次性清理旧合并缓存 xy-home-v2:garden-data-global（各桌面原始数据从未被改动，不受影响）
try { var _legacyG = window.xyStore("xy-home-v2"); if (_legacyG && _legacyG.get("garden-data-global")) _legacyG.remove("garden-data-global"); } catch (e) {}
var PLOTS = 12;
var PI = 1800;
// #446 养护减负：浇水有效期 24h→36h（偶尔忘浇一天不掉保水）、开花凋谢宽限 48h→72h（收不及时不再真金白银地亏）
// #503 养护再减负：地块上限瘦身后（最多 22 块）浇水 36h→48h、凋谢宽限 72h→96h，隔天浇照样满保水
var WILT_SEC = 345600;
var WATER_SEC = 172800;
function pn() { return s.get("lbl-partner") || "TA"; }
function load() { try { dataPf = window.activePrefix(); var d = JSON.parse(s.get(G) || "{}"); if (!d.p) d.p = []; while (d.p.length < PLOTS) d.p.push(null); if (!d.plotN) { var lv0 = Math.floor(Math.sqrt((d.exp || 0) / 10)) + 1; d.plotN = PLOTS + (lv0 >= 3 ? 2 : 0) + (lv0 >= 5 ? 2 : 0) + (lv0 >= 8 ? 2 : 0) + (lv0 >= 12 ? 4 : 0); } if (!d.l) d.l = []; if (!d.lpc) d.lpc = 0; if (!d.dex) d.dex = {}; if (!d.exp) d.exp = 0; if (!d.inv) d.inv = {}; if (!d.st) d.st = { p: 0, w: 0, h: 0, f: 0, mp: 0, mw: 0, mh: 0, mf: 0 }; if (!d.decor) d.decor = {}; if (!d.visitor) d.visitor = null; return d; } catch (e) { return { p: new Array(PLOTS).fill(null), plotN: PLOTS, l: [], lpc: 0, dex: {}, exp: 0, inv: {}, st: { p: 0, w: 0, h: 0, f: 0, mp: 0, mw: 0, mh: 0, mf: 0 }, decor: {}, visitor: null }; } }
// v3.14.x 丢数据修复：save 加两道闸——
// a) saveLock：启动/进园时 LS 缺 garden-data 且 IDB 尚未判定（有值回填 or 确认为空）前，
//    一律禁止落盘。否则真我/荣耀 Edge 等 IDB 读慢或事务挂起的机型上，checkPartnerPassive
//    （回到手机桌面即触发）/下雨浇水/访客等自动保存会把「未加载出来的空花园」写回存储，
//    永久覆盖 IndexedDB 里的老数据 = 用户种的花全部消失。
// b) 桌面护栏：data 归属桌面（dataPf）与当前激活桌面不一致时（切桌面后残留旧对象），
//    绝不把旧桌面花园写进新桌面的键——放弃本次保存并按新桌面重新加载。
var saveLock = true, dataPf = null;
function save(d) {
  try {
    if (saveLock) return;
    var pfNow = window.activePrefix();
    if (dataPf && pfNow !== dataPf) { try { data = load(); } catch (e0) {} return; }
    if (batchSave) { saveDirty = true; return; }
    s.set(G, JSON.stringify(d));
    try { if (window.idbSet) window.idbSet(pfNow + ":" + G, JSON.stringify(d)); } catch (e2) {}
  } catch (e) {}
}
var batchSave = false, saveDirty = false;
// 「垃圾空档」判定：无任何花、经验、日志、背包的档案视同不存在——
// Edge 等浏览器部分清理/慢IDB窗口期里，自动保存会把全新默认档写进存储；
// 之后启动若把它当「有数据」就会跳过找回流程，花永远回不来。
function isJunkGardenStr(raw) {
  try {
    if (!raw) return true;
    var d = JSON.parse(raw);
    if (!d || typeof d !== "object") return true;
    if (d.p) { for (var i = 0; i < d.p.length; i++) if (d.p[i]) return false; }
    if ((d.exp || 0) > 0) return false;
    if (d.l && d.l.length) return false;
    if (d.inv) { for (var k in d.inv) { if (d.inv[k]) return false; break; } }
    return true;
  } catch (e) { return false; } // 解析失败按有效数据处理，宁可保守不覆盖
}
function junkEmpty() { try { return isJunkGardenStr(s.get(G)); } catch (e) { return false; } }
function toast(msg) { try { var t = document.getElementById("cc-toast"); if (!t) { t = document.createElement("div"); t.id = "cc-toast"; document.body.appendChild(t); } t.textContent = msg; t.className = "cc-toast"; void t.offsetWidth; t.className = "cc-toast show"; clearTimeout(t._timer); t._timer = setTimeout(function () { t.className = "cc-toast"; }, 2000); } catch (e) {} }
// 从 IDB 判定当前桌面的 garden-data：命中→回填 LS（先回查防覆盖期间新写入）→解锁。
// cb(值或null) 在判定完成后回调。
// v3.29.x：原「未命中则从自动备份副本定向找回花园」已随副本机制一并下线（副本不再写入，
// 遗留副本体积可达数百 MB，整包 JSON.parse 是 OOM/长任务风险源）。
var _probeCbs = null;
function probeIdb(cb) {
  if (cb) { if (_probeCbs) { _probeCbs.push(cb); return; } _probeCbs = [cb]; }
  var pf = window.activePrefix();
  function done(v) {
    saveLock = false;
    var cbs = _probeCbs || []; _probeCbs = null;
    for (var i = 0; i < cbs.length; i++) { try { cbs[i](v); } catch (e) {} }
  }
  try {
    if (!window.idbGet) { done(null); return; }
    var attempt = 0;
    (function run() {
      attempt++;
      window.idbGet(pf + ":" + G).then(function (v) {
        if (window.activePrefix() !== pf) { done(null); return; }
        if (v) {
          var str = typeof v === "string" ? v : JSON.stringify(v);
          if (isJunkGardenStr(str)) { // IDB 里也只是垃圾空档 → 视同不存在
            if (attempt < 2) setTimeout(run, 300);
            else done(null);
            return;
          }
          try { if (!s.get(G) || junkEmpty()) s.set(G, str); } catch (e) {}
          done(str);
        } else if (attempt < 2) setTimeout(run, 300);
        else done(null);
      }).catch(function () { if (attempt < 2) setTimeout(run, 300); else done(null); });
    })();
  } catch (e) { done(null); }
}
(function r() { try { if (!junkEmpty()) { dataPf = window.activePrefix(); saveLock = false; return; } probeIdb(function (v) { if (v) { try { data = load(); } catch (e) {} } }); } catch (e) { saveLock = false; } })();

var T = {
  rose: { n: "\u73AB\u7470", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83C\uDF39"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [172800, 432000], xp: 30, lv: 1, ss: 3, m: "\u70ED\u70C8\u7684\u7231" },
  sunflower: { n: "\u5411\u65E5\u8475", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83C\uDF3B"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [172800, 518400], xp: 40, lv: 2, ss: 1, m: "\u6C89\u9ED8\u7684\u7231" },
  tulip: { n: "\u90C1\u91D1\u9999", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83C\uDF37"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [172800, 432000], xp: 30, lv: 1, ss: 0, m: "\u6C38\u6052\u7684\u795D\u798F" },
  cactus: { n: "\u4ED9\u4EBA\u638C", e: ["\uD83C\uDF31", "\uD83C\uDF35"], sn: ["\u5C0F\u82BD", "\u6210\u578B"], g: [432000], xp: 50, lv: 4, ss: 1, m: "\u575A\u97F7\uFF0C\u5916\u521A\u5185\u67D4" },
  lavender: { n: "\u85B0\u8863\u8349", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83D\uDC90"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [86400, 345600], xp: 25, lv: 3, ss: 2, m: "\u7B49\u5F85\u7231\u60C5" },
  daisy: { n: "\u96CF\u83CA", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83C\uDF3C"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [86400, 259200], xp: 20, lv: 1, ss: 0, m: "\u7EAF\u771F\uFF0C\u6DF1\u85CF\u5FC3\u5E95\u7684\u7231" },
  sakura: { n: "\u6A31\u82B1", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83C\uDF38"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [86400, 259200], xp: 25, lv: 1, ss: 0, m: "\u4E00\u751F\u5E78\u798F" },
  hibiscus: { n: "\u8299\u84C9", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83C\uDF3A"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [172800, 345600], xp: 35, lv: 1, ss: 1, m: "\u7EA4\u7EC6\u4E4B\u7F8E" },
  lotus: { n: "\u8377\u82B1", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83E\uDEB7"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [259200, 432000], xp: 45, lv: 1, ss: 1, m: "\u6E05\u96C5\u575A\u8D1E" },
  clover: { n: "\u5E78\u8FD0\u8349", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83C\uDF40"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u6210\u578B"], g: [43200, 129600], xp: 15, lv: 1, ss: 2, m: "\u5E78\u8FD0\u4E0E\u5E0C\u671B" },
  camellia: { n: "\u5C71\u8336\u82B1", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83D\uDCAE"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [172800, 259200], xp: 30, lv: 1, ss: 3, m: "\u7406\u60F3\u7684\u7231" },
  flameRose: { n: "\u7EDE\u6A31\u73AB\u7470", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83C\uDF39"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [432000, 864000], xp: 120, lv: 5, ss: 0, rare: true, m: "\u70BD\u70ED\u6C38\u6052\u7684\u7231" },
  blueRose: { n: "\u84DD\u73AB\u7470", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83C\uDF39"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [432000, 864000], xp: 150, lv: 6, ss: 1, rare: true, m: "\u5947\u8FF9\u4E0E\u4E0D\u53EF\u80FD\u7684\u7231" },
  goldSun: { n: "\u91D1\u5411\u65E5\u8475", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83C\uDF3B"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [432000, 777600], xp: 130, lv: 5, ss: 1, rare: true, m: "\u5FE0\u8BDA\u7684\u4FE1\u4EF0" },
  nightLotus: { n: "\u591C\u83B2", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83E\uDEB7"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [604800, 1036800], xp: 180, lv: 7, ss: 2, rare: true, m: "\u6697\u591C\u91CC\u7684\u575A\u5B88" },
  rainbowClover: { n: "\u5F69\u8679\u8349", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83C\uDF40"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u6210\u578B"], g: [259200, 518400], xp: 100, lv: 5, ss: 3, rare: true, m: "\u5E78\u8FD0\u964D\u4E34" },
  lily: { n: "\u767E\u5408", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83C\uDF38"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [172800, 432000], xp: 35, lv: 2, ss: 0, m: "\u7EAF\u6D01\u7684\u7231" },
  peony: { n: "\u7261\u4E39", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83C\uDF3A"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [259200, 518400], xp: 45, lv: 3, ss: 1, m: "\u5BCC\u8D35\u5409\u7965" },
  orchid: { n: "\u5170\u82B1", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83C\uDFAD"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [345600, 691200], xp: 55, lv: 4, ss: 2, m: "\u9AD8\u6D01\u5178\u96C5" },
  maple: { n: "\u67AB\u53F6", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83C\uDF41"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u6210\u578B"], g: [86400, 259200], xp: 25, lv: 2, ss: 2, m: "\u7F8E\u597D\u7684\u56DE\u5FC6" },
  wheat: { n: "\u9EA6\u7A57", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83C\uDF3E"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u6210\u719F"], g: [172800, 345600], xp: 35, lv: 3, ss: 2, m: "\u4E30\u6536\u4E0E\u5E0C\u671B" },
  jasmine: { n: "\u8309\u8389", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83C\uDF3C"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [86400, 172800], xp: 20, lv: 2, ss: 1, m: "\u6E05\u65B0\u6DE1\u96C5" },
  iris: { n: "\u9CF3\u5C3E", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83D\uDCAC"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [172800, 345600], xp: 30, lv: 3, ss: 0, m: "\u7231\u7684\u4F7F\u8005" },
  bamboo: { n: "\u7AF9", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83C\uDF8B"], sn: ["\u7B20", "\u53D1\u82BD", "\u6210\u7AF9"], g: [432000, 864000], xp: 60, lv: 4, ss: 3, m: "\u575A\u97F6\u4E0D\u62D4" },
  iceRose: { n: "\u51B0\u73AB\u7470", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\u2744\uFE0F"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [432000, 864000], xp: 140, lv: 6, ss: 3, rare: true, m: "\u5BD2\u51B7\u4E2D\u7684\u6E29\u67D4" },
  starLily: { n: "\u661F\u5149\u767E\u5408", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\u2728"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [604800, 1036800], xp: 170, lv: 7, ss: 0, rare: true, m: "\u95EA\u8000\u6C38\u6052" },
  moonFlower: { n: "\u6708\u5149\u82B1", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83C\uDF19"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [518400, 864000], xp: 150, lv: 6, ss: 1, rare: true, m: "\u591C\u665A\u7684\u5B88\u5019" },
  crystalOrchid: { n: "\u6C34\u6676\u5170", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83D\uDC8E"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [691200, 1209600], xp: 200, lv: 8, ss: 2, rare: true, m: "\u7A00\u4E16\u4E4B\u7F8E" },
  phoenix: { n: "\u51F0\u51F0\u82B1", e: ["\uD83C\uDF31", "\uD83C\uDF3F", "\uD83D\uDD25"], sn: ["\u79CD\u5B50", "\u53D1\u82BD", "\u5F00\u82B1"], g: [691200, 1209600], xp: 220, lv: 8, ss: 1, rare: true, m: "\u6D85\u69C8\u91CD\u751F" }
};
var WM = [
  "\u4ECA\u5929\u4E5F\u8F9B\u82E6\u5566\uFF0C\u82B1\u82B1\u4EEC\u4E5F\u5728\u52AA\u529B\u957F\u5927\u54E6",
  "\u7ED9\u4F60\u7684\u5C0F\u82B1\u6D47\u4E86\u70B9\u6C34\uFF0C\u8981\u5FEB\u5FEB\u957F\u5927\u54E6",
  "\u770B\u7740\u82B1\u56ED\u91CC\u7684\u82B1\u82B1\uFF0C\u5C31\u60F3\u5230\u4F60\u4E86",
  "\u4ECA\u5929\u5FC3\u60C5\u4E0D\u9519\uFF0C\u987A\u4FBF\u7167\u987E\u4E86\u4E0B\u82B1\u56ED",
  "\u8FD9\u6735\u82B1\u5FEB\u5F00\u4E86\uFF0C\u7B49\u4F60\u6765\u770B",
  "\u6D47\u5B8C\u6C34\u4E86\uFF0C\u8BB0\u5F97\u591A\u4F11\u606F\u54E6",
  "\u82B1\u56ED\u91CC\u90FD\u662F\u6211\u4EEC\u4E00\u8D77\u79CD\u4E0B\u7684\uFF0C\u8981\u4E00\u76F4\u7167\u987E\u4E0B\u53BB"
];
var W = [
  { i: "\u2600\uFE0F", t: "\u6674\u6717" },
  { i: "\u26C5", t: "\u591A\u4E91" },
  { i: "\uD83C\uDF27\uFE0F", t: "\u5C0F\u96E8" },
  { i: "\uD83C\uDF08", t: "\u653E\u6674" }
];
var S = ["\uD83C\uDF38 \u6625\u5B63", "\u2600\uFE0F \u590F\u5B63", "\uD83C\uDF42 \u79CB\u5B63", "\u2744\uFE0F \u51AC\u5B63"];

var DECOR = {
  fence: { n: "\u6728\u680F\u6746", e: "\uD83D\uDEE1\uFE0F", price: 50, max: 4, buff: { growth: 0.05, label: "\u751F\u957F+5%" } },
  light: { n: "\u5C0F\u8DEF\u706F", e: "\uD83D\uDCA1", price: 80, max: 2, buff: { growth: 0.08, label: "\u751F\u957F+8%" } },
  bench: { n: "\u957F\u6905", e: "\uD83E\uDD91", price: 120, max: 1, buff: { partner: 0.15, label: "\u68A6\u89D2\u5E38\u6765+15%" } },
  gnome: { n: "\u56ED\u4E11", e: "\uD83E\uDDD9", price: 100, max: 2, buff: { xp: 0.15, label: "\u7ECF\u9A8C+15%" } },
  windmill: { n: "\u98CE\u8F66", e: "\uD83C\uDF00", price: 150, max: 1, buff: { growth: 0.12, label: "\u751F\u957F+12%" } },
  fountain: { n: "\u55B7\u6CC9", e: "\u26F7\uFE0F", price: 200, max: 1, buff: { water: 0.5, label: "\u81EA\u52A8\u4FDD\u6C34" } },
  greenhouse: { n: "\u6E29\u5BA4", e: "\uD83C\uDFE1", price: 500, max: 1, buff: { water: 1, label: "\u81EA\u52A8\u6EE1\u4FDD\u6C34" } },
  flowerPot: { n: "\u82B1\u67B6", e: "\uD83E\uDEB4", price: 120, max: 2, buff: { growth: 0.1, label: "\u751F\u957F+10%" } },
  birdNest: { n: "\u9E1F\u5DE2", e: "\uD83D\uDC26", price: 150, max: 1, buff: { partner: 0.2, label: "\u68A6\u89D2\u5E38\u6765+20%" } },
  windBell: { n: "\u98CE\u94C3", e: "\uD83C\uDF90", price: 130, max: 2, buff: { xp: 0.2, label: "\u7ECF\u9A8C+20%" } },
  lantern: { n: "\u5F69\u706F", e: "\uD83C\uDF8F", price: 80, max: 3, buff: { growth: 0.06, label: "\u751F\u957F+6%" } }
};
var VISITORS = [
  { type: "butterfly", e: "\uD83E\uDE9B", n: "\u8774\u8776" },
  { type: "bee", e: "\uD83D\uDC1D", n: "\u871C\u8702" },
  { type: "bird", e: "\uD83D\uDC26", n: "\u5C0F\u9E1F" },
  { type: "ladybug", e: "\uD83D\uDC1E", n: "\u74E2\u866B" }
];

function wx() { var d = new Date(); return W[(d.getDate() + d.getMonth() + d.getHours()) % 4]; }
function sea() { return S[Math.floor(new Date().getMonth() / 3) % 4]; }

var data = load();
var selPlot = -1;

function stageInfo(plot) {
  if (!plot) return null;
  var tp = T[plot.type]; if (!tp) return null;
  var now = Math.floor(Date.now() / 1000);
  var elapsed = now - plot.planted;
  var seaIdx = Math.floor(new Date().getMonth() / 3) % 4;
  var seaBoost = (tp.ss === seaIdx) ? 1.3 : 0.85;
  var w = wx();
  var wBoost = (w.t === "\u6674\u6717") ? 1.1 : (w.t === "\u5C0F\u96E8") ? 0.9 : 1.0;
  var boost = seaBoost * wBoost * (1 + decorBuffs().growth) * (plot.pot === 3 ? 1.6 : plot.pot === 2 ? 1.3 : 1);
  var eff = Math.floor(elapsed * boost);
  var stage = 0;
  for (var i = 0; i < tp.g.length; i++) { if (eff >= tp.g[i]) stage = i + 1; else break; }
  var stageMax = tp.g.length;
  var bloomed = stage >= stageMax;
  var wilted = bloomed && plot.bloomedAt && (now - plot.bloomedAt > WILT_SEC);
  var progress = bloomed ? 1 : (eff - (stage > 0 ? tp.g.slice(0, stage).reduce(function (a, b) { return a + b; }, 0) : 0)) / (tp.g[stage] || 1);
  var nextSec = bloomed ? 0 : Math.ceil((tp.g.slice(0, stage + 1).reduce(function (a, b) { return a + b; }, 0) - eff) / boost);
  return { key: plot.type, name: tp.n, stage: stage, stageMax: stageMax, stageName: tp.sn[Math.min(stage, tp.sn.length - 1)], emoji: tp.e[Math.min(stage, tp.e.length - 1)], bloomed: bloomed, wilted: !!wilted, progress: progress, nextSec: nextSec, plantedBy: plot.by || "\u6211" };
}
function markBloomed() {
  var changed = false;
  var now = Math.floor(Date.now() / 1000);
  for (var i = 0; i < data.p.length; i++) {
    var plot = data.p[i];
    if (!plot) continue;
    var si = stageInfo(plot);
    if (si && si.bloomed && !plot.bloomedAt) { plot.bloomedAt = now; changed = true; }
  }
  if (changed) save(data);
}

function waterLvl(plot) {
  if (!plot || !plot.watered) return 0;
  return Math.max(0, 1 - (Math.floor(Date.now() / 1000) - plot.watered) / WATER_SEC);
}

function gLv() { return Math.floor(Math.sqrt((data.exp || 0) / 10)) + 1; }
function gLvProg() { var lv = gLv(); var cur = (lv - 1) * (lv - 1) * 10; var nxt = lv * lv * 10; return { cur: data.exp - cur, max: nxt - cur, lv: lv }; }
function unlocked(type) { var tp = T[type]; if (!tp) return false; if (tp.rare) return false; return true; }
function decorBuffs() {
  var b = { growth: 0, xp: 0, partner: 0, water: 0 };
  var keys = Object.keys(DECOR);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var cnt = data.decor[k] || 0;
    if (cnt <= 0) continue;
    var bf = DECOR[k].buff;
    if (!bf) continue;
    if (bf.growth) b.growth += bf.growth * cnt;
    if (bf.xp) b.xp += bf.xp * cnt;
    if (bf.partner) b.partner += bf.partner * cnt;
    if (bf.water) b.water += bf.water * cnt;
  }
  return b;
}
function updDex(type, act) { if (!data.dex[type]) data.dex[type] = { p: 0, h: 0 }; if (act === "p") data.dex[type].p++; if (act === "h") data.dex[type].h++; }
function updSt(act, me) { var k = act; if (me) data.st[k] = (data.st[k] || 0) + 1; else data.st["m" + k] = (data.st["m" + k] || 0) + 1; }
function todayStr() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
function updDaily(act) {
  var t = todayStr();
  if (!data.daily || data.daily.day !== t) data.daily = { day: t, w: 0, h: 0, f: 0, done: false, buffed: false };
  if (act === "w") data.daily.w++;
  else if (act === "h") data.daily.h++;
  else if (act === "f") data.daily.f++;
  if (!data.daily.done && data.daily.w >= 5 && data.daily.h >= 3 && data.daily.f >= 1) {
    data.daily.done = true;
    data.exp = (data.exp || 0) + 50;
    addLog("\u2605", "\u4ECA\u65E5\u4EFB\u52A1\u5B8C\u6210\uFF0C\u5956\u52B150\u7ECF\u9A8C");
  }
}

var curWeather = wx();
var curSeason = sea();

function renderWeather() {
  var wi = document.getElementById("garden-weather-ico");
  var wt = document.getElementById("garden-weather-txt");
  var ws = document.getElementById("garden-season");
  if (wi) wi.textContent = curWeather.i;
  if (wt) wt.textContent = curWeather.t;
  if (ws) ws.textContent = curSeason;

  var hr = new Date().getHours();
  page.dataset.night = (hr >= 19 || hr < 6) ? "1" : "0";
  page.dataset.season = String(Math.floor(new Date().getMonth() / 3) % 4);
}

function fmtRemain(sec) {
  if (sec <= 0) return "";
  var d = Math.floor(sec / 86400);
  var h = Math.floor((sec % 86400) / 3600);
  if (d > 0) return "\u8FD8\u9700 " + d + "\u5929" + (h > 0 ? " " + h + "\u65F6" : "");
  if (h > 0) return "\u8FD8\u9700 " + h + "\u65F6";
  var m = Math.floor(sec / 60);
  return "\u8FD8\u9700 " + (m > 0 ? m : 1) + "\u5206";
}

function fmtShort(sec) {
  if (sec <= 0) return "";
  var d = Math.floor(sec / 86400);
  var h = Math.floor((sec % 86400) / 3600);
  if (d > 0) return d + "\u5929";
  if (h > 0) return h + "\u65F6";
  var m = Math.floor(sec / 60);
  return (m > 0 ? m : 1) + "\u5206";
}

function buildPlotInner(plot, si, wl) {
  var h = "";
  if (plot && plot.pot && plot.pot > 1) h += "<span class=\"garden-pot-mark\">" + (plot.pot === 3 ? "\u8C6A\u534E" : "\u9AD8\u7EA7") + "</span>";
  if (si) {
    var emoji = si.wilted ? "\uD83E\uDD40" : si.emoji;
    h += "<span class=\"garden-plant-emoji\">" + emoji + "</span>";
    h += "<span class=\"garden-plant-name\">" + si.name + "</span>";
    if (si.wilted) {
      h += "<span class=\"garden-plant-stage wilted-stage\">\u5DF2\u51CB\u8C22</span>";
    } else if (si.bloomed) {
      h += "<span class=\"garden-plant-stage\">\u6210\u719F</span>";
    } else {
      h += "<span class=\"garden-plant-stage\">" + fmtShort(si.nextSec) + "</span>";
      h += "<div class=\"garden-grow-bar\"><div class=\"garden-grow-fill\" style=\"width:" + Math.round(si.progress * 100) + "%\"></div></div>";
    }
    if (wl > 0) h += "<div class=\"garden-water-bar\"><div class=\"garden-water-fill\" style=\"width:" + Math.round(wl * 100) + "%\"></div></div>";
  } else {
    h += "<span class=\"garden-plant-emoji\">\uD83C\uDF31</span>";
    h += "<span class=\"garden-plot-empty-txt\">\u7A7A\u5730</span>";
  }
  return h;
}
// #503 空地折叠：#528 改为默认展开（全部地块直接铺开），仍保留一块「空地×N」折叠砖可手动收起/展开
var emptyFolded = false;
function foldTileInner(empties) {
  return "<span class=\"garden-plant-emoji\">🌱</span><span>空地 ×" + empties + "</span><span class=\"garden-fold-hint\">" + (emptyFolded ? "点开" : "收起") + "</span>";
}
function renderGrid() {
  var grid = document.getElementById("garden-grid");
  if (!grid) return;
  var empties = 0;
  for (var e0 = 0; e0 < data.p.length; e0++) if (!data.p[e0]) empties++;
  var showFold = empties > 0;
  var visible = [];
  for (var v0 = 0; v0 < data.p.length; v0++) { if (data.p[v0] || !emptyFolded) visible.push(v0); }
  if (showFold) visible.push(-1); // -1 = 折叠砖
  if (grid.children.length !== visible.length) {
    var hf = "";
    for (var i = 0; i < visible.length; i++) {
      var idx = visible[i];
      if (idx < 0) { hf += "<div class=\"garden-fold-tile\" data-fold=\"1\" role=\"button\">" + foldTileInner(empties) + "</div>"; continue; }
      var plot = data.p[idx];
      var si = stageInfo(plot);
      var wl = waterLvl(plot);
      var cls = "garden-plot" + (si ? "" : " empty") + (wl > 0 ? " watered" : "") + (selPlot === idx ? " selected" : "") + (si && si.bloomed ? " bloomed" : "") + (si && si.wilted ? " wilted" : "") + (plot && T[plot.type] && T[plot.type].rare ? " rare" : "");
      hf += "<div class=\"" + cls + "\" data-idx=\"" + idx + "\">" + buildPlotInner(plot, si, wl) + "</div>";
    }
    grid.innerHTML = hf;
    return;
  }
  for (var j = 0; j < visible.length; j++) {
    var idx2 = visible[j];
    var el = grid.children[j];
    if (idx2 < 0) {
      var fsig = "fold|" + empties + "|" + (emptyFolded ? 1 : 0);
      if (el.getAttribute("data-sig") !== fsig) { el.setAttribute("data-sig", fsig); el.innerHTML = foldTileInner(empties); }
      continue;
    }
    var p = data.p[idx2];
    var s = stageInfo(p);
    var w = waterLvl(p);
    var c = "garden-plot" + (s ? "" : " empty") + (w > 0 ? " watered" : "") + (selPlot === idx2 ? " selected" : "") + (s && s.bloomed ? " bloomed" : "") + (s && s.wilted ? " wilted" : "") + (p && T[p.type] && T[p.type].rare ? " rare" : "");
    var em = s ? (s.wilted ? "\uD83E\uDD40" : s.emoji) : "\uD83C\uDF31";
    var st = s ? (s.wilted ? "\u5DF2\u51CB\u8C22" : s.bloomed ? "\u6210\u719F" : fmtShort(s.nextSec)) : "\u7A7A\u5730";
    var pg = s && !s.bloomed && !s.wilted ? Math.floor(s.progress * 10) : -1;
    var wp = w > 0 ? Math.floor(w * 10) : 0;
    var sig = c + "|" + em + "|" + st + "|" + pg + "|" + wp + "|" + (p && p.pot || 1);
    if (el.getAttribute("data-sig") === sig) continue;
    el.setAttribute("data-sig", sig);
    el.setAttribute("data-idx", idx2);
    el.className = c;
    el.innerHTML = buildPlotInner(p, s, w);
  }
}

// #503 日志全量：默认显示最近 20 条，点「查看全部」展开全部打理记录（含联系人 TA 的每一条）；容量 100→300 条
var showLogAll = false;
function renderLog() {
  var el = document.getElementById("garden-log-list");
  if (!el) return;
  var all = data.l || [];
  var entries = (showLogAll ? all : all.slice(-20)).slice().reverse();
  var title = document.querySelector("#garden-log .garden-log-title");
  if (title) {
    var tg = document.getElementById("garden-log-toggle");
    if (!tg) {
      tg = document.createElement("button");
      tg.id = "garden-log-toggle";
      tg.className = "garden-log-toggle";
      tg.addEventListener("click", function () { showLogAll = !showLogAll; renderLog(); });
      title.appendChild(tg);
    }
    tg.textContent = all.length ? (showLogAll ? "收起" : "查看全部 " + all.length + " 条") : "";
    tg.style.display = all.length ? "" : "none";
  }
  if (!entries.length) { el.innerHTML = "<div class=\"garden-log-item\">\u8FD8\u6CA1\u6709\u8BB0\u5F55\uFF0C\u5F00\u59CB\u6253\u7406\u82B1\u56ED\u5427</div>"; return; }
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var h = "";
  entries.forEach(function (e) {
    var tm = e.tm ? new Date(e.tm * 1000) : new Date();
    var ts = tm.getHours().toString().padStart(2, "0") + ":" + tm.getMinutes().toString().padStart(2, "0");
    if (showLogAll && tm < today) ts = (tm.getMonth() + 1) + "-" + tm.getDate() + " " + ts;
    // v3.x.x：称呼跟随——日志渲染层替换 TA/他（存储原文不动）
    var who = (e.who || ""), act = (e.act || "");
    if (window.taFit) { who = window.taFit(who); act = window.taFit(act); }
    h += "<div class=\"garden-log-item\"><span class=\"who\">" + who + "</span><span class=\"act\">" + act + "</span><span class=\"tm\">" + ts + "</span></div>";
  });
  el.innerHTML = h;
}

function addLog(who, act) {
  data.l.push({ who: who, act: act, tm: Math.floor(Date.now() / 1000) });
  if (data.l.length > 300) data.l = data.l.slice(-300);
}

function updWaterStreak() {
  var t = todayStr();
  if (data.lastWaterDay === t) return;
  var d = new Date(); d.setDate(d.getDate() - 1);
  var y = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  if (data.lastWaterDay === y) data.waterStreak = (data.waterStreak || 0) + 1;
  else data.waterStreak = 1;
  data.lastWaterDay = t;
}
function waterPlot(idx) {
  if (idx < 0 || idx >= data.p.length) return;
  var plot = data.p[idx];
  if (!plot) return;
  if (!plot.watered) plot.watered = Math.floor(Date.now() / 1000);
  else { var sec = Math.floor(Date.now() / 1000) - plot.watered; if (sec < 3600) return; plot.watered = Math.floor(Date.now() / 1000); }
  var si = stageInfo(plot);
  plot.planted = Math.max(0, plot.planted - 14400);
  addLog("\u6211", "\u7ED9 " + (si ? si.name : "\u7A7A\u5730") + " \u6D47\u4E86\u6C34");
  updSt("w", true);
  updDaily("w");
  updWaterStreak();
  fxAtPlot(idx, "fx-water", 900);
  if (Math.random() < 0.08) { var pn3 = pn(); addLog(pn3, "\u770B\u5230\u4F60\u5728\u6D47\u6C34\uFF0C\u4E5F\u6765\u5E2E\u5FD9\u4E86~"); partnerAct(true); }
  save(data); renderAll();
}

function plantSeed(idx, type) {
  if (idx < 0 || idx >= data.p.length) return;
  if (data.p[idx]) return;
  var tp = T[type]; if (!tp) return;
  data.lastSeed = type;
  data.p[idx] = { type: type, planted: Math.floor(Date.now() / 1000), by: "\u6211" };
  addLog("\u6211", "\u79CD\u4E0B\u4E86\u4E00\u68F5 " + tp.n + (tp.rare ? " \u2728" : ""));
  updDex(type, "p");
  updSt("p", true);
  save(data); renderAll();
}
function dropRareSeed() {
  if (Math.random() > 0.05) return null;
  var rareKeys = Object.keys(T).filter(function (k) { return T[k].rare; });
  if (!rareKeys.length) return null;
  var k = rareKeys[Math.floor(Math.random() * rareKeys.length)];
  if (!data.rareInv) data.rareInv = {};
  data.rareInv[k] = (data.rareInv[k] || 0) + 1;
  return k;
}
function fxAtPlot(idx, cls, dur) {
  var plot = page.querySelector('.garden-plot[data-idx="' + idx + '"]');
  if (!plot) return;
  var fx = document.createElement("div");
  fx.className = "garden-fx " + cls;
  plot.appendChild(fx);
  setTimeout(function () { if (fx.parentNode) fx.remove(); }, dur || 900);
}
// #446 扩建改自愿：等级只解锁「开垦资格」（plotEntitled），实际地块数 = plotN（点工具条「开垦」才增加）。
// 老玩家迁移时 load() 已按当前等级一次性补齐资格，已有的地一块不少。
// #503 上限瘦身：新资格梯度 Lv.3/5/8 各 +2、Lv.12 +4（满配 12+10=22）；资格只封顶「再开垦」，绝不裁已有地。
function plotEntitled() {
  var lv = gLv();
  return PLOTS + (lv >= 3 ? 2 : 0) + (lv >= 5 ? 2 : 0) + (lv >= 8 ? 2 : 0) + (lv >= 12 ? 4 : 0);
}
// #503 plotN 不再被资格向下钳制：资格缩小/上限瘦身后，老存档 plotN 高于新资格也一块不裁（缩地只能手动收空地）
function plotCount() {
  return data.plotN || PLOTS;
}
function syncPlots() {
  var n = plotCount();
  while (data.p.length < n) data.p.push(null);
  if (data.p.length > n) data.p = data.p.slice(0, n);
}
function checkLevelUp() {
  var lv = gLv();
  if (!data.lvSeen) data.lvSeen = 1;
  if (data.lvSeen < lv) {
    var old = data.lvSeen;
    data.lvSeen = lv;
    save(data);
    var msgs = [];
    if (old < 3 && lv >= 3) msgs.push("Lv.3 解锁 2 个新地块开垦资格");
    if (old < 5 && lv >= 5) msgs.push("Lv.5 解锁 2 个新地块开垦资格");
    if (old < 8 && lv >= 8) msgs.push("Lv.8 解锁 2 个新地块开垦资格");
    if (old < 12 && lv >= 12) msgs.push("Lv.12 解锁 4 个新地块开垦资格");
    // #446 不开垦不吃亏：跨地块里程碑额外送 1 颗随机稀有种子——升级奖励与「要不要多地块」脱钩
    var mile = [3, 5, 8, 12].filter(function (m) { return old < m && lv >= m; });
    if (mile.length) {
      var rareKsM = Object.keys(T).filter(function (k) { return T[k].rare; });
      if (rareKsM.length) {
        var rkM = rareKsM[Math.floor(Math.random() * rareKsM.length)];
        if (!data.rareInv) data.rareInv = {};
        data.rareInv[rkM] = (data.rareInv[rkM] || 0) + 1;
        msgs.push("🎁 里程碑奖励：稀有种子「" + T[rkM].n + "」×1（不开垦新地块也照样拿）");
      }
    }
    if (msgs.length) {
      msgs.push("（工具条点「开垦」才真正增加地块；不开垦、小花园精养也完全不影响升级和奖励）");
      msgs.forEach(function (m) { addLog("\u2605", m); });
      if (window.openModal) window.openModal("\uD83C\uDF89 \u5347\u7EA7\u89E3\u9501", "", function () {}, { pills: [{ label: "\u597D\u7684", value: "ok" }], noInput: true, staticText: msgs.join("\n") });
    }
  }
}
function checkLoginReward() {
  var t = todayStr();
  if (data.lastLoginDay === t) return;
  var d = new Date(); d.setDate(d.getDate() - 1);
  var y = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  if (data.lastLoginDay === y) data.loginStreak = (data.loginStreak || 0) + 1;
  else data.loginStreak = 1;
  data.lastLoginDay = t;
  var expGain = 10 + data.loginStreak;
  data.exp = (data.exp || 0) + expGain;
  var msg = "\u6BCF\u65E5\u6253\u7406 +" + expGain + "\u7ECF\u9A8C\uFF08\u8FDE\u7EED " + data.loginStreak + " \u5929\uFF09";
  var gotRare = null;
  if (data.loginStreak % 7 === 0) {
    var rareKeys = Object.keys(T).filter(function (k) { return T[k].rare; });
    if (rareKeys.length) {
      gotRare = rareKeys[Math.floor(Math.random() * rareKeys.length)];
      if (!data.rareInv) data.rareInv = {};
      data.rareInv[gotRare] = (data.rareInv[gotRare] || 0) + 1;
    }
  }
  addLog("\u2605", msg + (gotRare ? " \u2728\u4FDD\u5E95\u7A00\u6709\u79CD\u5B50" + T[gotRare].n : ""));
  save(data);
  if (gotRare && window.openModal) window.openModal("\u2728 \u8FDE\u7EED\u767B\u5F55\u5956\u52B1", "", function () {}, { pills: [{ label: "\u597D\u7684", value: "ok" }], noInput: true, staticText: "\u8FDE\u7EED\u6253\u7406 " + data.loginStreak + " \u5929\n\u83B7\u5F97\u7A00\u6709\u79CD\u5B50\uFF1A" + T[gotRare].n });
}
function rollQuality() {
  var r = Math.random();
  if (r < 0.05) return "p";
  if (r < 0.30) return "f";
  return "n";
}
function addInvQual(type, q) {
  data.inv[type] = (data.inv[type] || 0) + 1;
  if (!data.qual) data.qual = {};
  if (!data.qual[type]) data.qual[type] = { n: 0, f: 0, p: 0 };
  data.qual[type][q] = (data.qual[type][q] || 0) + 1;
}
function qualMul(q) { return q === "p" ? 2 : q === "f" ? 1.5 : 1; }
function qualLabel(q) { return q === "p" ? "【完美】" : q === "f" ? "【优质】" : ""; }
// ---- v3.15.x：收花联动心意币（与心意集市/红包同一本账）——按品质发给双方：
// 二调对齐红包金额体系——完美 ¥52 / 优质 ¥13.14 / 普通 ¥5.2，枯萎 ¥1.3；日封顶 ¥520 防刷。
// v3.16.x：花园收花改为我和 TA 同步同额入账（不再只进我的余额），流水记「花园收花」。
function harvestCoinFen(q, wilted) { return wilted ? 130 : q === "p" ? 5200 : q === "f" ? 1314 : 520; }
function grantHarvestCoin(q, wilted) {
  try {
    if (typeof window.giftWalletChange !== "function") return null;
    var ck = "ml2_coin_garden_" + new Date().toISOString().slice(0, 10);
    var cur = Number(s.get(ck)) || 0;
    var cap = 52000;
    if (cur >= cap) return null;
    var fen = Math.min(harvestCoinFen(q, wilted), cap - cur);
    s.set(ck, String(cur + fen));
    window.giftWalletChange(fen, fen, "花园收花");
    return fen;
  } catch (e) { return null; }
}
function coinTxt(fen) { return "🪙 双方心意币各 +¥" + (fen / 100).toFixed(2); }
var HYBRIDS = [
  { a: "rose", b: "sakura", r: "flameRose" },
  { a: "rose", b: "clover", r: "blueRose" },
  { a: "sunflower", b: "daisy", r: "goldSun" },
  { a: "lotus", b: "lavender", r: "nightLotus" },
  { a: "clover", b: "camellia", r: "rainbowClover" },
  { a: "lily", b: "orchid", r: "crystalOrchid" },
  { a: "peony", b: "jasmine", r: "starLily" },
  { a: "maple", b: "wheat", r: "phoenix" },
  { a: "iris", b: "lavender", r: "moonFlower" },
  { a: "lily", b: "clover", r: "iceRose" }
];
function ensureHybridBtn() {
  if (document.getElementById("garden-tool-hybrid")) return;
  var tb = document.getElementById("garden-toolbar");
  if (!tb) return;
  var btn = document.createElement("button");
  btn.id = "garden-tool-hybrid";
  btn.className = "garden-tool hybrid";
  btn.dataset.tool = "hybrid";
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21h10l-1.5-5h-7z"/><path d="M12 16v-4"/><circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/></svg><span class="garden-tool-label">\u6742\u4EA4</span>';
  tb.appendChild(btn);
}
function ensureUpgradeBtn() {
  if (document.getElementById("garden-tool-upgrade")) return;
  var tb = document.getElementById("garden-toolbar");
  if (!tb) return;
  var btn = document.createElement("button");
  btn.id = "garden-tool-upgrade";
  btn.className = "garden-tool upgrade";
  btn.dataset.tool = "upgrade";
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.5 7h7.5l-6 4.5 2.5 7.5-6.5-4.5-6.5 4.5 2.5-7.5-6-4.5h7.5z"/></svg><span class="garden-tool-label">\u5347\u7EA7</span>';
  tb.appendChild(btn);
}
function ensureReclaimBtn() {
  if (document.getElementById("garden-tool-reclaim")) return;
  var tb = document.getElementById("garden-toolbar");
  if (!tb) return;
  var btn = document.createElement("button");
  btn.id = "garden-tool-reclaim";
  btn.className = "garden-tool reclaim";
  btn.dataset.tool = "reclaim";
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l5.5-5.5"/><path d="M9.5 14.5L17 7l2.5 2.5-7.5 7.5z"/><path d="M15 4.5L19.5 9"/></svg><span class="garden-tool-label">\u5F00\u58A6</span>';
  tb.appendChild(btn);
  // #503 收地：开多了的地块可以手动缩回（只收尾部空地，有花的地绝不裁）
  var sb = document.createElement("button");
  sb.id = "garden-tool-shrink";
  sb.className = "garden-tool shrink";
  sb.dataset.tool = "shrink";
  sb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v6h6"/><path d="M20 10V4h-6"/><path d="M14 10l6-6"/><path d="M4 14l6 6"/></svg><span class="garden-tool-label">收地</span>';
  tb.appendChild(sb);
}
// #503 缩地：把尾部连续的空地块收回（plotN 减小），下限 4 块；只动空地、有花不裁、随时可再开垦
var MIN_PLOTS = 4;
function shrinkPlots() {
  var cur = data.plotN || PLOTS;
  while (cur > MIN_PLOTS && !data.p[cur - 1]) cur--;
  if (cur === (data.plotN || PLOTS)) {
    if (window.openModal) window.openModal("收回地块", "", function () {}, { pills: [{ label: "好的", value: "ok" }], noInput: true, staticText: "没有可收的空地（最少保留 4 块）\n有花的地块不会被收回，收掉的地随时可再开垦" });
    return;
  }
  var from = data.plotN || PLOTS;
  if (!window.openModal) { data.plotN = cur; syncPlots(); save(data); renderAll(); return; }
  window.openModal("收回地块", "", function (v) {
    if (v !== "1") return;
    data.plotN = cur;
    syncPlots();
    addLog("★", "收回了 " + (from - cur) + " 块空地，花园现有 " + cur + " 块地");
    save(data); renderAll();
  }, { pills: [{ label: "收回 " + (from - cur) + " 块", value: "1" }, { label: "再想想", value: "0" }], noInput: true, staticText: "把尾部 " + (from - cur) + " 块空地收回，保留 " + cur + " 块？\n只收空地，种了花的地不受影响；以后想用随时再开垦" });
}
function ensureReplantBtn() {
  if (document.getElementById("garden-tool-replant")) return;
  var tb = document.getElementById("garden-toolbar");
  if (!tb) return;
  var btn = document.createElement("button");
  btn.id = "garden-tool-replant";
  btn.className = "garden-tool replant batch";
  btn.dataset.tool = "replant";
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21v-8"/><path d="M12 13c-3 0-5-2-5-5 3 0 5 2 5 5z"/><path d="M12 13c3 0 5-2 5-5-3 0-5 2-5 5z"/><path d="M5 21h14"/></svg><span class="garden-tool-label">\u8865\u79CD</span>';
  tb.appendChild(btn);
}
// #446 扩建改自愿：确认后才把 plotN 提到当前等级资格，已有的地只增不减
function reclaimPlots() {
  var ent = plotEntitled();
  var cur = data.plotN || PLOTS;
  if (cur >= ent) {
    if (window.openModal) window.openModal("\u5F00\u58A6\u65B0\u5730\u5757", "", function () {}, { pills: [{ label: "\u597D\u7684", value: "ok" }], noInput: true, staticText: "\u5F53\u524D " + cur + " \u5757\u5730\u5DF2\u5168\u90E8\u5F00\u58A6\n\u4E0B\u6B21\u5347\u7EA7\u53EF\u518D\u89E3\u9501\u65B0\u5730\u5757\u7684\u5F00\u58A6\u8D44\u683C\uFF08Lv.3/5/8 \u5404 +2\uFF0CLv.12 +4\uFF09" });
    return;
  }
  if (!window.openModal) { data.plotN = ent; syncPlots(); save(data); renderAll(); return; }
  window.openModal("\u5F00\u58A6\u65B0\u5730\u5757", "", function (v) {
    if (v !== "1") return;
    data.plotN = ent;
    syncPlots();
    addLog("\u2605", "\u5F00\u58A6\u4E86 " + (ent - cur) + " \u4E2A\u65B0\u5730\u5757\uFF0C\u82B1\u56ED\u73B0\u6709 " + data.p.length + " \u5757\u5730");
    save(data); renderAll();
  }, { pills: [{ label: "\u5F00\u58A6 " + (ent - cur) + " \u5757", value: "1" }, { label: "\u518D\u60F3\u60F3", value: "0" }], noInput: true, staticText: "\u628A\u5730\u5757\u4ECE " + cur + " \u5757\u6269\u5230 " + ent + " \u5757\uFF1F\n\u5730\u5757\u8D8A\u591A\u6D47\u6C34\u6536\u83B7\u8D8A\u5FD9\uFF0C\u4E5F\u53EF\u4EE5\u4FDD\u6301\u5C0F\u82B1\u56ED\u7CBE\u517B\u54E6\n\uFF08\u4EE5\u540E\u968F\u65F6\u53EF\u4EE5\u518D\u5F00\u58A6\uFF0C\u5730\u5757\u4E0D\u4F1A\u81EA\u52A8\u589E\u52A0\uFF09" });
}
// #446 一键补种：空地块按上次种过的品种补齐（稀有花不消耗 rareInv 库存，回落普通花）
function replantAll() {
  var empties = [];
  for (var i = 0; i < data.p.length; i++) if (!data.p[i]) empties.push(i);
  if (!empties.length) { toast("\u6CA1\u6709\u7A7A\u5730\u5757\u5566"); return; }
  var seed = (data.lastSeed && T[data.lastSeed] && !T[data.lastSeed].rare) ? data.lastSeed : null;
  if (!seed) { var ks = Object.keys(T).filter(function (k) { return unlocked(k); }); seed = ks.length ? ks[0] : null; }
  if (!seed) return;
  var now = Math.floor(Date.now() / 1000);
  empties.forEach(function (i) {
    data.p[i] = { type: seed, planted: now, by: "\u6211" };
    updDex(seed, "p"); updSt("p", true);
  });
  addLog("\u6211", "\u4E00\u952E\u8865\u79CD " + empties.length + " \u682A " + T[seed].n);
  if (Math.random() < 0.08) { var pn4 = pn(); addLog(pn4, "\u770B\u5230\u4F60\u5728\u8865\u79CD\uFF0C\u4E5F\u6765\u5E2E\u5FD9\u4E86~"); partnerAct(true); }
  save(data); renderAll();
}
function hybridPlot(idx) {
  var plot = data.p[idx];
  if (!plot) return;
  var si = stageInfo(plot);
  if (!si) return;
  var neighbors = [idx - 1, idx + 1, idx - 4, idx + 4];
  var target = -1;
  for (var i = 0; i < neighbors.length; i++) {
    var ni = neighbors[i];
    if (ni < 0 || ni >= data.p.length) continue;
    if (!data.p[ni]) continue;
    var nsi = stageInfo(data.p[ni]);
    if (nsi && nsi.stage === si.stage && data.p[ni].type !== plot.type) { target = ni; break; }
  }
  if (target < 0) {
    if (window.openModal) window.openModal("\u6742\u4EA4", "", function () {}, { pills: [{ label: "\u597D\u7684", value: "ok" }], noInput: true, staticText: "\u9700\u8981\u76F8\u90BB\u4E14\u540C\u9636\u6BB5\u7684\u4E0D\u540C\u82B1\u6735" });
    return;
  }
  var recipe = null;
  for (var j = 0; j < HYBRIDS.length; j++) {
    var h = HYBRIDS[j];
    if ((h.a === plot.type && h.b === data.p[target].type) || (h.b === plot.type && h.a === data.p[target].type)) { recipe = h; break; }
  }
  if (!recipe) {
    if (window.openModal) window.openModal("\u6742\u4EA4", "", function () {}, { pills: [{ label: "\u597D\u7684", value: "ok" }], noInput: true, staticText: si.name + " \u548C " + stageInfo(data.p[target]).name + " \u6682\u65E0\u6742\u4EA4\u914D\u65B9\uFF0C\u8BD5\u8BD5\u5176\u4ED6\u7EC4\u5408\u5427" });
    return;
  }
  var n1 = si.name, n2 = stageInfo(data.p[target]).name;
  fxAtPlot(idx, "fx-harvest", 1000); fxAtPlot(target, "fx-harvest", 1000);
  data.p[idx] = null; data.p[target] = null;
  if (!data.rareInv) data.rareInv = {};
  data.rareInv[recipe.r] = (data.rareInv[recipe.r] || 0) + 1;
  if (!data.hybridFound) data.hybridFound = {};
  data.hybridFound[recipe.a + "+" + recipe.b] = true;
  addLog("\u2605", n1 + " \u00d7 " + n2 + " \u6742\u4EA4\u6210\u529F\uFF0C\u83B7\u5F97 " + T[recipe.r].n + " \u79CD\u5B50 \u2728");
  if (window.openModal) window.openModal("\u2728 \u6742\u4EA4\u6210\u529F", "", function () {}, { pills: [{ label: "\u597D\u7684", value: "ok" }], noInput: true, staticText: n1 + " \u00d7 " + n2 + "\n\u83B7\u5F97\u7A00\u6709\u79CD\u5B50\uFF1A" + T[recipe.r].n });
  save(data); renderAll();
}

function upgradePlot(idx) {
  if (idx < 0 || idx >= data.p.length) return;
  var plot = data.p[idx];
  if (!plot) { if (window.openModal) window.openModal("\u5347\u7EA7\u82B1\u76C6", "", function () {}, { pills: [{ label: "\u597D\u7684", value: "ok" }], noInput: true, staticText: "\u8BF7\u5148\u5728\u8BE5\u5730\u5757\u79CD\u690D\u82B1\u6735\uFF0C\u518D\u5347\u7EA7\u82B1\u76C6" }); return; }
  var cur = plot.pot || 1;
  if (cur >= 3) { if (window.openModal) window.openModal("\u5347\u7EA7\u82B1\u76C6", "", function () {}, { pills: [{ label: "\u597D\u7684", value: "ok" }], noInput: true, staticText: "\u82B1\u76C6\u5DF2\u6EE1\u7EA7\uFF08\u8C6A\u534E\uFF09\uFF0C\u65E0\u6CD5\u518D\u5347\u7EA7" }); return; }
  var cost = cur === 1 ? 100 : 300;
  var exp = data.exp || 0;
  if (exp < cost) { if (window.openModal) window.openModal("\u5347\u7EA7\u82B1\u76C6", "", function () {}, { pills: [{ label: "\u597D\u7684", value: "ok" }], noInput: true, staticText: "\u7ECF\u9A8C\u4E0D\u8DB3\uFF0C\u5347\u7EA7\u82B1\u76C6\u9700\u8981 " + cost + " \u7ECF\u9A8C\uFF08\u5F53\u524D " + exp + "\uFF09" }); return; }
  data.exp = exp - cost;
  plot.pot = cur + 1;
  var nm = stageInfo(plot) ? stageInfo(plot).name : "\u82B1\u76C6";
  addLog("\u2605", nm + " \u82B1\u76C6\u5347\u7EA7\u4E3A " + (cur + 1 === 3 ? "\u8C6A\u534E" : "\u9AD8\u7EA7") + "\uFF08-" + cost + "\u7ECF\u9A8C\uFF09");
  fxAtPlot(idx, "fx-fert", 800);
  save(data); renderAll();
}

function fertilizePlot(idx) {
  if (idx < 0 || idx >= data.p.length) return;
  var plot = data.p[idx];
  if (!plot) return;
  plot.planted = Math.max(0, plot.planted - 43200);
  var si = stageInfo(plot);
  addLog("\u6211", "\u7ED9 " + (si ? si.name : "\u7A7A\u5730") + " \u65BD\u4E86\u80A5");
  updSt("f", true);
  updDaily("f");
  fxAtPlot(idx, "fx-fert", 800);
  if (Math.random() < 0.08) { var pn3 = pn(); addLog(pn3, "\u770B\u5230\u4F60\u5728\u65BD\u80A5\uFF0C\u4E5F\u6765\u5E2E\u5FD9\u4E86~"); partnerAct(true); }
  save(data); renderAll();
}

function harvestPlot(idx) {
  if (idx < 0 || idx >= data.p.length) return;
  var plot = data.p[idx];
  if (!plot) return;
  var si = stageInfo(plot);
  if (!si || !si.bloomed) return;
  var name = si.name;
  var type = plot.type;
  var tp = T[type];
  var wilted = si.wilted;
  var q = rollQuality();
  data.p[idx] = null;
  var xpg = Math.round((tp ? tp.xp : 10) * (1 + decorBuffs().xp) * (wilted ? 0.5 : 1) * qualMul(q));
  data.exp = (data.exp || 0) + xpg;
  addInvQual(type, q);
  if (wilted) data.wiltedSeen = true;
  updDex(type, "h");
  updSt("h", true);
  updDaily("h");
  var dropped = dropRareSeed();
  fxAtPlot(idx, "fx-harvest", 1000);
  addLog("\u6211", "\u6536\u83B7\u4E86 " + name + qualLabel(q) + (wilted ? "\uFF08\u5DF2\u51CB\u8C22\uFF09" : "") + " (+" + xpg + "\u7ECF\u9A8C)" + (dropped ? " \u2728\u83B7\u5F97\u7A00\u6709\u79CD\u5B50" + T[dropped].n : ""));
  var coinGot = grantHarvestCoin(q, wilted);
  if (coinGot) addLog("\u6211", "\u6536\u82B1\u5956\u52B1\u5230\u8D26 " + coinTxt(coinGot));
  save(data); renderAll();
}


function partnerAct(silent, used) {
  var pName = pn();
  var r = Math.random();
  var emptyPlots = [];
  var plantedPlots = [];
  var bloomedPlots = [];
  var dryPlots = [];
  for (var i = 0; i < data.p.length; i++) {
    if (!data.p[i]) emptyPlots.push(i);
    else {
      plantedPlots.push(i);
      var si = stageInfo(data.p[i]);
      if (si && si.bloomed) bloomedPlots.push(i);
      if (waterLvl(data.p[i]) < 0.3) dryPlots.push(i);
    }
  }
  bloomedPlots.sort(function (a, b) {
    var ba = (data.p[a] && data.p[a].bloomedAt) || 0;
    var bb = (data.p[b] && data.p[b].bloomedAt) || 0;
    return ba - bb;
  });
  function pick(arr) {
    if (!arr || !arr.length) return -1;
    var avail = arr;
    if (used && used.length) {
      avail = arr.filter(function (x) { return used.indexOf(x) < 0; });
      if (!avail.length) avail = arr;
    }
    var idx = avail[Math.floor(Math.random() * avail.length)];
    if (used) used.push(idx);
    return idx;
  }
  var acted = false;
  var actType;
  if (r < 0.15) actType = "plant";
  else if (r < 0.35) actType = "water";
  else if (r < 0.50) actType = "waterall";
  else if (r < 0.65) actType = "harvest";
  else if (r < 0.78) actType = "harvestall";
  else if (r < 0.90) actType = "fertilize";
  else actType = "patrol";
  if (actType === "plant" && emptyPlots.length > 0) {
    var idx = pick(emptyPlots);
    var keys = Object.keys(T).filter(function (k) { return unlocked(k); });
    if (keys.length > 0) {
      var t = keys[Math.floor(Math.random() * keys.length)];
      var tp = T[t];
      data.p[idx] = { type: t, planted: Math.floor(Date.now() / 1000), by: pName };
      addLog(pName, "\u79CD\u4E0B\u4E86\u4E00\u68F5 " + tp.n);
      updDex(t, "p"); updSt("p", false);
      acted = true;
    }
  } else if (actType === "water" && dryPlots.length > 0) {
    var idx = pick(dryPlots);
    var si = stageInfo(data.p[idx]);
    data.p[idx].watered = Math.floor(Date.now() / 1000);
    data.p[idx].planted = Math.max(0, data.p[idx].planted - 7200);
    addLog(pName, "\u7ED9 " + (si ? si.name : "\u690D\u7269") + " \u6D47\u4E86\u6C34");
    updSt("w", false);
    acted = true;
  } else if (actType === "waterall" && dryPlots.length > 0) {
    var wcnt = 0;
    for (var pi = 0; pi < data.p.length; pi++) {
      if (data.p[pi] && waterLvl(data.p[pi]) < 0.3) {
        data.p[pi].watered = Math.floor(Date.now() / 1000);
        data.p[pi].planted = Math.max(0, data.p[pi].planted - 7200);
        wcnt++;
      }
    }
    if (wcnt > 0) { addLog(pName, "\u4E00\u952E\u6D47\u4E86 " + wcnt + " \u68F5\u690D\u7269"); updSt("w", false); acted = true; }
  } else if (actType === "harvest" && bloomedPlots.length > 0) {
    var idx = pick(bloomedPlots);
    var si = stageInfo(data.p[idx]);
    var name = si ? si.name : "\u690D\u7269";
    var type = data.p[idx].type;
    var tp = T[type];
    var wilted = si ? si.wilted : false;
    var emoji = wilted ? "\uD83E\uDD40" : (tp ? tp.e[tp.e.length - 1] : "\uD83C\uDF37");
    var pq = rollQuality();
    data.p[idx] = null;
    var xpg = Math.round((tp ? tp.xp : 10) * (1 + decorBuffs().xp) * (wilted ? 0.5 : 1) * qualMul(pq));
    data.exp = (data.exp || 0) + xpg;
    updDex(type, "h"); updSt("h", false);
    if (Math.random() < 0.3) {
      addLog(pName, "\u9001\u4F60\u4E00\u6735 " + name + qualLabel(pq) + (wilted ? "\uFF08\u5E72\u82B1\uFF09" : "") + " \uD83D\uDC95");
      var gmsg = wilted ? "\u8FD9\u6735" + name + "\u5FEB\u51CB\u4E86\uFF0C\u8D76\u7D27\u9001\u4F60~" : "\u521A\u6458\u7684" + name + "\u9001\u7ED9\u4F60\uFF0C\u6536\u597D\u54E6~";
      if (window.chatSendFlower) { try { window.chatSendFlower(emoji, name, gmsg, true); } catch (e) {} }
    } else {
      addInvQual(type, pq);
      addLog(pName, "\u6536\u83B7\u4E86 " + name + qualLabel(pq) + (wilted ? "\uFF08\u5DF2\u51CB\u8C22\uFF09" : "") + " (+" + xpg + "\u7ECF\u9A8C)");
    }
    if (Math.random() < 0.03) {
      var rareKs = Object.keys(T).filter(function(k){return T[k].rare;});
      if (rareKs.length) {
        var rk = rareKs[Math.floor(Math.random()*rareKs.length)];
        if (!data.rareInv) data.rareInv = {};
        data.rareInv[rk] = (data.rareInv[rk]||0) + 1;
        addLog(pName, "\u7559\u4E0B\u4E86\u4E00\u9897" + T[rk].n + "\u7684\u79CD\u5B50 \u2728");
      }
    }
    acted = true;
  } else if (actType === "harvestall" && bloomedPlots.length > 0) {
    var hcnt = 0;
    for (var pi = 0; pi < data.p.length; pi++) {
      if (!data.p[pi]) continue;
      var si2 = stageInfo(data.p[pi]);
      if (!si2 || !si2.bloomed) continue;
      var tp2 = T[data.p[pi].type];
      var tpk = data.p[pi].type;
      var wilted2 = si2.wilted;
      var pq2 = rollQuality();
      data.p[pi] = null;
      var xpg2 = Math.round((tp2 ? tp2.xp : 10) * (1 + decorBuffs().xp) * (wilted2 ? 0.5 : 1) * qualMul(pq2));
      data.exp = (data.exp || 0) + xpg2;
      addInvQual(tpk, pq2);
      updDex(tpk, "h"); updSt("h", false);
      hcnt++;
    }
    if (hcnt > 0) { addLog(pName, "\u4E00\u952E\u6536\u83B7 " + hcnt + " \u6735\u82B1"); acted = true; }
    if (hcnt > 0 && Math.random() < 0.03) {
      var rareKs2 = Object.keys(T).filter(function(k2){return T[k2].rare;});
      if (rareKs2.length) {
        var rk2 = rareKs2[Math.floor(Math.random()*rareKs2.length)];
        if (!data.rareInv) data.rareInv = {};
        data.rareInv[rk2] = (data.rareInv[rk2]||0) + 1;
        addLog(pName, "\u7559\u4E0B\u4E86\u4E00\u9897" + T[rk2].n + "\u7684\u79CD\u5B50 \u2728");
      }
    }
  } else if (actType === "fertilize" && plantedPlots.length > 0) {
    var idx = pick(plantedPlots);
    var si = stageInfo(data.p[idx]);
    data.p[idx].planted = Math.max(0, data.p[idx].planted - 21600);
    addLog(pName, "\u7ED9 " + (si ? si.name : "\u690D\u7269") + " \u65BD\u4E86\u80A5");
    updSt("f", false);
    acted = true;
  }
  if (acted) {
    // v3.32.x #132：花园字卡概率接 dcf-garden（默认 40%=原值，单值替换非叠加）
    var _gP = 40;
    try { if (window.dcfGet) _gP = window.dcfGet('garden'); } catch (e) {}
    if (Math.random() * 100 < _gP) {
    // v3.13.x：悄悄话走系统预设字卡池（字卡库「花园」tab 同源，dc-off-garden:* 过滤）
    var wmPool = (window.getLibPool ? window.getLibPool("garden", "梦角悄悄话", WM) : WM).slice();
    if (window.isDefaultCardOff) wmPool = wmPool.filter(function (c) { return !window.isDefaultCardOff("garden", c); });
    if (!wmPool.length) wmPool = WM.slice();
    var msg = wmPool[Math.floor(Math.random() * wmPool.length)];
    addLog(pName, "\uD83D\uDC95 " + msg);
    }
  }
  if (acted) {
    data.lpc = Math.floor(Date.now() / 1000);
    save(data);
  }
  if (!silent && acted) renderAll();
  return acted;
}

function renderLevel() {
  var el = document.getElementById("garden-level-bar");
  if (!el) return;
  var lp = gLvProg();
  var pct = Math.round(lp.cur / lp.max * 100);
  el.innerHTML = "<span class=\"garden-lv-num\">Lv." + lp.lv + "</span><div class=\"garden-lv-track\"><div class=\"garden-lv-fill\" style=\"width:" + pct + "%\"></div></div><span class=\"garden-lv-exp\">" + data.exp + " EXP</span>";
}

function renderStats() {
  var el = document.getElementById("garden-stats");
  if (!el) return;
  var st = data.st || {};
  var total = (st.p || 0) + (st.mp || 0);
  var water = (st.w || 0) + (st.mw || 0);
  var harvest = (st.h || 0) + (st.mh || 0);
  el.innerHTML = "<span class=\"gs-item\"><b>" + total + "</b>\u79CD</span><span class=\"gs-item\"><b>" + water + "</b>\u6D47</span><span class=\"gs-item\"><b>" + harvest + "</b>\u6536</span>";
}

function renderDex() {
  var el = document.getElementById("garden-dex");
  if (!el) return;
  if (!document.getElementById("garden-dex-search")) {
    var sh = '<div class="garden-dex-bar"><input id="garden-dex-search" class="garden-dex-search" placeholder="\u{1F50D} \u641C\u7D22\u82B1\u540D..." /><div class="garden-dex-seasons">';
    sh += '<button class="garden-dex-season' + (dexSeason === -1 ? " active" : "") + '" data-season="-1">\u5168\u90E8</button>';
    S.forEach(function (s, i) { sh += '<button class="garden-dex-season' + (dexSeason === i ? " active" : "") + '" data-season="' + i + '">' + s.split(" ")[1] + '</button>'; });
    sh += '</div></div><div id="garden-dex-list"></div>';
    el.innerHTML = sh;
    var search = document.getElementById("garden-dex-search");
    if (search) search.addEventListener("input", function () { dexSearch = this.value; renderDexList(); });
    el.querySelectorAll(".garden-dex-season").forEach(function (b) { b.addEventListener("click", function () { dexSeason = parseInt(this.dataset.season); el.querySelectorAll(".garden-dex-season").forEach(function (x) { x.classList.toggle("active", parseInt(x.dataset.season) === dexSeason); }); renderDexList(); }); });
  }
  var search = document.getElementById("garden-dex-search");
  if (search && search.value !== dexSearch) search.value = dexSearch;
  renderDexList();
}
function renderDexList() {
  var el = document.getElementById("garden-dex-list");
  if (!el) return;
  var keys = Object.keys(T);
  function filter(list) {
    return list.filter(function (k) {
      if (dexSearch && T[k].n.indexOf(dexSearch) < 0) return false;
      if (dexSeason >= 0 && T[k].ss !== dexSeason) return false;
      return true;
    });
  }
  var normal = filter(keys.filter(function (k) { return !T[k].rare; }));
  var rare = filter(keys.filter(function (k) { return !!T[k].rare; }));
  function renderItems(list) {
    var h = "";
    list.forEach(function (k) {
      var tp = T[k];
      var dx = data.dex[k] || { p: 0, h: 0 };
      var has = dx.p > 0 || dx.h > 0;
      var lock = tp.rare ? !has : (tp.lv > gLv());
      if (has) {
        h += "<div class=\"garden-dex-item" + (tp.rare ? " rare" : "") + "\" title=\"" + tp.n + " \u79CD" + dx.p + "\u6536" + dx.h + "\"><span class=\"dex-emoji\">" + tp.e[tp.e.length - 1] + "</span><span class=\"dex-name\">" + tp.n + "</span><span class=\"dex-cnt\">\u00d7" + dx.h + "</span></div>";
      } else if (lock) {
        h += "<div class=\"garden-dex-item locked\"><span class=\"dex-emoji\">\uD83D\uDD12</span><span class=\"dex-name\">" + (tp.rare ? "\u7A00\u6709" : "Lv." + tp.lv) + "</span></div>";
      } else {
        h += "<div class=\"garden-dex-item unknown\"><span class=\"dex-emoji\">\u2753</span><span class=\"dex-name\">???</span></div>";
      }
    });
    return h;
  }
  var allNormal = keys.filter(function (k) { return !T[k].rare; });
  var allRare = keys.filter(function (k) { return !!T[k].rare; });
  var nC = allNormal.filter(function (k) { var dx = data.dex[k] || { p: 0, h: 0 }; return dx.p > 0 || dx.h > 0; }).length;
  var rC = allRare.filter(function (k) { var dx = data.dex[k] || { p: 0, h: 0 }; return dx.p > 0 || dx.h > 0; }).length;
  if (!normal.length && !rare.length) { el.innerHTML = "<div class=\"garden-dex-empty\">\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u82B1</div>"; return; }
  el.innerHTML = "<div class=\"garden-dex-title\">\u690D\u7269\u56FE\u9274 " + nC + "/" + allNormal.length + " \u00B7 \u7A00\u6709 " + rC + "/" + allRare.length + "</div><div class=\"garden-dex-grid\">" + renderItems(normal) + "</div>" + (rare.length ? "<div class=\"garden-dex-sub\">\u2728 \u7A00\u6709\u54C1\u79CD</div><div class=\"garden-dex-grid rare-grid\">" + renderItems(rare) + "</div>" : "");
}

function renderInv() {
  var el = document.getElementById("garden-inv");
  if (!el) return;
  var keys = Object.keys(data.inv || {}).filter(function (k) { return data.inv[k] > 0; });
  if (!keys.length) { el.innerHTML = "<div class=\"garden-inv-empty\">\u5E93\u5B58\u7A7A\u7A7A\uFF0C\u6536\u83B7\u82B1\u6735\u540E\u53EF\u5236\u4F5C\u82B1\u675F\u9001\u7ED9" + pn() + "</div>"; return; }
  var h = "<div class=\"garden-inv-title\">\u82B1\u6735\u5E93\u5B58</div><div class=\"garden-inv-list\">";
  keys.forEach(function (k) {
    var tp = T[k];
    if (!tp) return;
    var q = (data.qual && data.qual[k]) || { n: 0, f: 0, p: 0 };
    var qTxt = "";
    if (q.f || q.p) {
      var parts = [];
      if (q.f) parts.push("\u4F18" + q.f);
      if (q.p) parts.push("\u5B8C" + q.p);
      qTxt = " <span class=\"garden-qual-tag\">" + parts.join(" ") + "</span>";
    }
    h += "<span class=\"garden-inv-item\" data-flower=\"" + k + "\">" + tp.e[tp.e.length - 1] + " " + tp.n + " \u00d7" + data.inv[k] + qTxt + "</span>";
  });
  h += "</div><button class=\"garden-bouquet-btn\" id=\"garden-bouquet-btn\">\uD83D\uDCC1 \u5236\u4F5C\u82B1\u675F\u9001\u7ED9" + pn() + "</button>";
  el.innerHTML = h;
  var btn = el.querySelector("#garden-bouquet-btn");
  if (btn) btn.addEventListener("click", makeBouquet);
}

function renderDecor() {
  var el = document.getElementById("garden-decor");
  if (!el) return;
  var keys = Object.keys(DECOR);
  var owned = keys.filter(function (k) { return (data.decor[k] || 0) > 0; });
  var h = "<div class=\"garden-decor-title\">\uD83C\uDFE0 \u82B1\u56ED\u88C5\u9970</div>";
  if (owned.length) {
    h += "<div class=\"garden-decor-list\">";
    owned.forEach(function (k) {
      var dp = DECOR[k];
      var bf = dp.buff ? " <span class=\"garden-decor-buff\">" + dp.buff.label + "</span>" : "";
      h += "<span class=\"garden-decor-item\">" + dp.e + " " + dp.n + " \u00d7" + data.decor[k] + bf + "</span>";
    });
    h += "</div>";
  } else {
    h += "<div class=\"garden-decor-empty\">\u8FD8\u6CA1\u6709\u88C5\u9970\uFF0C\u53BB\u5546\u5E97\u770B\u770B\u5427</div>";
  }
  h += "<button class=\"garden-decor-shop-btn\" id=\"garden-decor-shop-btn\">\uD83D\uDED2 \u88C5\u9970\u5546\u5E97\uFF08\u514D\u8D39\uFF09</button>";
  el.innerHTML = h;
  var btn = el.querySelector("#garden-decor-shop-btn");
  if (btn) btn.addEventListener("click", buyDecor);
}

function renderVisitor() {
  var el = document.getElementById("garden-visitor");
  if (!el) return;
  var v = data.visitor;
  if (!v) { el.innerHTML = ""; el.style.display = "none"; return; }
  var now = Math.floor(Date.now() / 1000);
  if (v.start + v.dur < now) { data.visitor = null; save(data); el.innerHTML = ""; el.style.display = "none"; return; }
  var vi = null;
  for (var i = 0; i < VISITORS.length; i++) { if (VISITORS[i].type === v.type) { vi = VISITORS[i]; break; } }
  if (!vi) { el.innerHTML = ""; el.style.display = "none"; return; }
  var remain = v.start + v.dur - now;
  var rmTxt = remain > 3600 ? Math.floor(remain / 3600) + "\u5C0F\u65F6" : Math.ceil(remain / 60) + "\u5206\u949F";
  el.style.display = "";
  el.innerHTML = "<span class=\"garden-visitor-emoji\">" + vi.e + "</span><span class=\"garden-visitor-txt\">" + vi.n + "\u6765\u8BBF\u4E86\u82B1\u56ED\uFF0C\u8FD8\u4F1A\u5F85 " + rmTxt + "</span>";
}

function renderLeaderboard() {
  var el = document.getElementById("garden-lb");
  if (!el) return;
  var st = data.st || {};
  var rows = [
    { label: "\u79CD\u690D", me: st.p || 0, ta: st.mp || 0 },
    { label: "\u6D47\u6C34", me: st.w || 0, ta: st.mw || 0 },
    { label: "\u65BD\u80A5", me: st.f || 0, ta: st.mf || 0 },
    { label: "\u6536\u83B7", me: st.h || 0, ta: st.mh || 0 }
  ];
  var h = "<div class=\"garden-lb-title\">\uD83C\uDFC6 \u7167\u6599\u6392\u884C\u699C</div>";
  h += "<div class=\"garden-lb-head\"><span>\u6211</span><span>" + pn() + "</span></div>";
  rows.forEach(function (r) {
    var total = r.me + r.ta;
    var mp = total > 0 ? Math.round(r.me / total * 100) : 50;
    var tp = 100 - mp;
    h += "<div class=\"garden-lb-row\"><span class=\"lb-label\">" + r.label + "</span>";
    h += "<div class=\"lb-bar\"><div class=\"lb-me\" style=\"width:" + mp + "%\">" + (r.me > 0 ? r.me : "") + "</div><div class=\"lb-ta\" style=\"width:" + tp + "%\">" + (r.ta > 0 ? r.ta : "") + "</div></div>";
    h += "</div>";
  });
  el.innerHTML = h;
}

var ACHV = [
  { id: "firstBloom", n: "首次开花", e: "\uD83C\uDF38", d: "收获第一朵花", check: function () { return (data.st.h || 0) + (data.st.mh || 0) >= 1; } },
  { id: "greenThumb", n: "满级园丁", e: "\uD83C\uDF3E", d: "花园达 Lv.10", check: function () { return gLv() >= 10; } },
  { id: "collector", n: "全图鉴", e: "\uD83D\uDCD6", d: "收集全部普通花并", check: function () { var n = Object.keys(T).filter(function (k) { return !T[k].rare; }); return n.every(function (k) { var dx = data.dex[k] || {}; return dx.p > 0 || dx.h > 0; }); } },
  { id: "rareColl", n: "稀有收藏家", e: "\u2728", d: "收获任一稀有花", check: function () { return Object.keys(T).some(function (k) { return T[k].rare && data.dex[k] && data.dex[k].h > 0; }); } },
  { id: "water7", n: "坚持浇水", e: "\uD83D\uDCA7", d: "连续浇水 7 天", check: function () { return (data.waterStreak || 0) >= 7; } },
  { id: "harvest10", n: "丰收一日", e: "\uD83E\uDD4B", d: "单日收获 10 朵", check: function () { return (data.daily && data.daily.h >= 10) || (data.st.h || 0) >= 10; } },
  { id: "planter10", n: "勤劳园丁", e: "\uD83C\uDF31", d: "种下 10 棵花", check: function () { return (data.st.p || 0) + (data.st.mp || 0) >= 10; } },
  { id: "waterer50", n: "浇水达人", e: "\uD83C\uDF26", d: "浇水 50 次", check: function () { return (data.st.w || 0) + (data.st.mw || 0) >= 50; } },
  { id: "harv50", n: "花海", e: "\uD83C\uDF3C", d: "收获 50 朵花", check: function () { return (data.st.h || 0) + (data.st.mh || 0) >= 50; } },
  { id: "decorAll", n: "尽善尽美", e: "\uD83C\uDFE0", d: "买齐全部装饰", check: function () { return Object.keys(DECOR).every(function (k) { return (data.decor[k] || 0) >= DECOR[k].max; }); } },
  { id: "visitor", n: "生机勃勃", e: "\uD83E\uDE9B", d: "招待过访客", check: function () { return !!data.visitor; } },
  { id: "bouquet3", n: "花束使者", e: "\uD83D\uDCC1", d: "制作 3 束花", check: function () { return (data.bouquetCnt || 0) >= 3; } },
  { id: "partnerCare", n: "同育之情", e: "\uD83D\uDC95", d: "梦角打理 30 次", check: function () { return (data.st.mp || 0) + (data.st.mw || 0) + (data.st.mh || 0) + (data.st.mf || 0) >= 30; } },
  { id: "partnerCareII", n: "日久情深", e: "\uD83D\uDC9D", d: "梦角打理 100 次", check: function () { return (data.st.mp || 0) + (data.st.mw || 0) + (data.st.mh || 0) + (data.st.mf || 0) >= 100; } },
  { id: "partnerCareIII", n: "生生不息", e: "\uD83D\uDC9E", d: "梦角打理 300 次", check: function () { return (data.st.mp || 0) + (data.st.mw || 0) + (data.st.mh || 0) + (data.st.mf || 0) >= 300; } },
  { id: "rich", n: "花山花海", e: "\uD83D\uDCB0", d: "库存 20 朵花", check: function () { var t = 0; Object.keys(data.inv || {}).forEach(function (k) { t += data.inv[k] || 0; }); return t >= 20; } },
  { id: "wiltedSee", n: "封存时光", e: "\uD83E\uDD40", d: "见证花朵凋谢", check: function () { return !!data.wiltedSeen; } },
  { id: "hybridMaster", n: "杂交大师", e: "\uD83E\uDD7C", d: "发现 5 个杂交配方", check: function () { return Object.keys(data.hybridFound || {}).length >= 5; } },
  { id: "craftMaster", n: "花艺师", e: "\uD83D\uDC83", d: "制作 10 束花", check: function () { return (data.bouquetCnt || 0) >= 10; } },
  { id: "collector15", n: "收藏家", e: "\uD83D\uDCBC", d: "收集 15 种花", check: function () { return Object.keys(data.dex || {}).filter(function (k) { var d = data.dex[k]; return d && (d.p > 0 || d.h > 0); }).length >= 15; } },
  { id: "rareHunter", n: "稀有猎人", e: "\uD83D\uDD25", d: "收获 3 种稀有花", check: function () { return Object.keys(T).filter(function (k) { return T[k].rare && data.dex[k] && data.dex[k].h > 0; }).length >= 3; } },
  { id: "allFlowers", n: "万紫千红", e: "\uD83C\uDF08", d: "收集 20 种花", check: function () { return Object.keys(data.dex || {}).filter(function (k) { var d = data.dex[k]; return d && (d.p > 0 || d.h > 0); }).length >= 20; } },
  { id: "perfect", n: "完美主义", e: "\uD83D\uDC8E", d: "收获完美品质花", check: function () { return Object.keys(data.qual || {}).some(function (k) { return data.qual[k] && data.qual[k].p > 0; }); } }
];
function ensureDailyUI() {
  if (document.getElementById("garden-daily")) return;
  var el = document.createElement("div");
  el.id = "garden-daily";
  el.className = "garden-daily";
  var pg = document.getElementById("garden-panel-garden");
  if (pg) pg.insertBefore(el, pg.firstChild);
  else { var bar = page.querySelector(".garden-level-bar"); if (bar) bar.parentNode.insertBefore(el, bar.nextSibling); }
}
function renderDaily() {
  ensureDailyUI();
  var el = document.getElementById("garden-daily");
  if (!el) return;
  var t = todayStr();
  if (!data.daily || data.daily.day !== t) data.daily = { day: t, w: 0, h: 0, f: 0, done: false, buffed: false };
  var d = data.daily;
  var tasks = [
    { n: "\u6D47\u6C34", cur: d.w, goal: 5, e: "\uD83D\uDCA7" },
    { n: "\u6536\u83B7", cur: d.h, goal: 3, e: "\uD83C\uDF3C" },
    { n: "\u65BD\u80A5", cur: d.f, goal: 1, e: "\uD83D\uDC9A" }
  ];
  var h = "<div class=\"garden-daily-title\">\u4ECA\u65E5\u4EFB\u52A1" + (d.done ? " \u2728\u5DF2\u5B8C\u6210" : "") + "</div><div class=\"garden-daily-tasks\">";
  tasks.forEach(function (tk) {
    var ok = tk.cur >= tk.goal;
    h += "<div class=\"garden-daily-task" + (ok ? " done" : "") + "\"><span class=\"dt-emoji\">" + tk.e + "</span><span class=\"dt-name\">" + tk.n + " " + Math.min(tk.cur, tk.goal) + "/" + tk.goal + "</span></div>";
  });
  h += "</div>";
  el.innerHTML = h;
}
function ensureAchvUI() {
  if (document.getElementById("garden-achv")) return;
  var el = document.createElement("div");
  el.id = "garden-achv";
  el.className = "garden-achv";
  var pa = document.getElementById("garden-panel-achv");
  if (pa) pa.appendChild(el);
  else { var scroll = page.querySelector(".garden-scroll"); if (scroll) scroll.appendChild(el); }
}
function renderAchv() {
  ensureAchvUI();
  var el = document.getElementById("garden-achv");
  if (!el) return;
  if (!data.achv) data.achv = {};
  var got = 0;
  var h = "";
  ACHV.forEach(function (a) {
    var ok = !!data.achv[a.id];
    if (ok) got++;
    h += "<div class=\"garden-achv-item" + (ok ? " done" : "") + "\" title=\"" + a.d + "\"><span class=\"achv-emoji\">" + (ok ? a.e : "\uD83D\uDD12") + "</span><span class=\"achv-name\">" + a.n + "</span></div>";
  });
  el.innerHTML = "<div class=\"garden-achv-title\">\uD83C\uDFC6 \u6210\u5C31\u5899 " + got + "/" + ACHV.length + "</div><div class=\"garden-achv-grid\">" + h + "</div>";
}
function checkAchv() {
  if (!data.achv) data.achv = {};
  var newly = [];
  ACHV.forEach(function (a) {
    if (data.achv[a.id]) return;
    try { if (a.check()) { data.achv[a.id] = Math.floor(Date.now() / 1000); newly.push(a); } } catch (e) {}
  });
  if (newly.length) {
    save(data);
    newly.forEach(function (a) { addLog("\u2605", "\u89E3\u9501\u6210\u5C31\u300C" + a.n + "\u300D " + a.e); });
    if (window.openModal) {
      var a0 = newly[0];
      window.openModal(a0.e + " \u89E3\u9501\u6210\u5C31", "", function () {}, { pills: [{ label: "\u597D\u7684", value: "ok" }], noInput: true, staticText: a0.n + "\n" + a0.d + (newly.length > 1 ? "\n\uFF08\u672C\u6B21\u5171\u89E3\u9501 " + newly.length + " \u4E2A\uFF09" : "") });
    }
  }
}
var curTab = "garden";
var dexSearch = "", dexSeason = -1;
var TABS = [
  { id: "garden", n: "\u82B1\u56ED", e: "\uD83C\uDF31" },
  { id: "log", n: "\u65E5\u5FD7", e: "\uD83D\uDCDC" },
  { id: "dex", n: "\u56FE\u9274", e: "\uD83D\uDCD6" },
  { id: "craft", n: "\u5DE5\u574A", e: "\uD83E\uDDE4" },
  { id: "shop", n: "\u88C5\u9970", e: "\uD83C\uDFE0" },
  { id: "achv", n: "\u6210\u5C31", e: "\uD83C\uDFC6" },
  { id: "report", n: "\u5E74\u62A5", e: "\uD83D\uDCCA" }
];
function ensureTabUI() {
  if (document.getElementById("garden-tabs")) return;
  var scroll = page.querySelector(".garden-scroll");
  if (!scroll) return;
  var tabs = document.createElement("div");
  tabs.id = "garden-tabs";
  tabs.className = "garden-tabs";
  TABS.forEach(function (t) {
    var b = document.createElement("button");
    b.className = "garden-tab" + (t.id === curTab ? " active" : "");
    b.dataset.tab = t.id;
    b.innerHTML = '<span class="gt-emoji">' + t.e + '</span><span class="gt-name">' + t.n + '</span>';
    tabs.appendChild(b);
  });
  var lvl = document.getElementById("garden-level-bar");
  if (lvl) lvl.parentNode.insertBefore(tabs, lvl.nextSibling);
  else scroll.appendChild(tabs);
  TABS.forEach(function (t) {
    var p = document.createElement("div");
    p.id = "garden-panel-" + t.id;
    p.className = "garden-panel" + (t.id === curTab ? " active" : "");
    scroll.appendChild(p);
  });
  var move = function (id, pid) {
    var el = document.getElementById(id);
    var p = document.getElementById("garden-panel-" + pid);
    if (el && p) p.appendChild(el);
  };
  move("garden-grid", "garden");
  move("garden-stats", "garden");
  move("garden-visitor", "garden");
  move("garden-toolbar", "garden");
  move("garden-log", "log");
  move("garden-dex", "dex");
  move("garden-inv", "craft");
  move("garden-decor", "shop");
  move("garden-lb", "shop");
  tabs.addEventListener("click", function (e) {
    var b = e.target.closest(".garden-tab");
    if (!b) return;
    curTab = b.dataset.tab;
    page.querySelectorAll(".garden-tab").forEach(function (x) { x.classList.toggle("active", x.dataset.tab === curTab); });
    page.querySelectorAll(".garden-panel").forEach(function (p) { p.classList.toggle("active", p.id === "garden-panel-" + curTab); });
    renderAll();
  });
}
var RECIPES = [
  { id: "firstLove", n: "\u521D\u604B", e: "\uD83D\uDC90", need: { rose: 3, daisy: 2 }, wish: "\u4E09\u6735\u73AB\u7470\u4E24\u6735\u96CF\u83CA\uFF0C\u50CF\u521D\u604B\u822C\u70ED\u70C8\u53C8\u7EAF\u771F" },
  { id: "passion", n: "\u70ED\u604B", e: "\uD83D\uDC9D", need: { rose: 2, sunflower: 1 }, wish: "\u73AB\u7470\u4E0E\u5411\u65E5\u8475\uFF0C\u70ED\u70C8\u5730\u671D\u5411\u4F60" },
  { id: "miss", n: "\u601D\u5FF5", e: "\uD83C\uDF19", need: { lavender: 3, sakura: 1 }, wish: "\u85B0\u8863\u8349\u7684\u7B49\u5F85\uFF0C\u6A31\u82B1\u7684\u77ED\u6682\uFF0C\u90FD\u662F\u601D\u5FF5" },
  { id: "eternal", n: "\u6C38\u6052", e: "\u221E", need: { tulip: 2, camellia: 1 }, wish: "\u90C1\u91D1\u9999\u7684\u795D\u798F\uFF0C\u5C71\u8336\u82B1\u7684\u7406\u60F3\uFF0C\u613F\u6C38\u6052" },
  { id: "lucky", n: "\u5E78\u8FD0", e: "\uD83C\uDF40", need: { clover: 3, daisy: 1 }, wish: "\u56DB\u53F6\u8349\u52A0\u96CF\u83CA\uFF0C\u5E78\u8FD0\u4F34\u7EAF\u771F" },
  { id: "miracle", n: "\u5947\u8FF9", e: "\u2728", need: { flameRose: 1, blueRose: 1 }, wish: "\u7EDE\u6A31\u4E0E\u84DD\u73AB\u7470\uFF0C\u4E0D\u53EF\u80FD\u7684\u5947\u8FF9" },
  { id: "pure", n: "\u6E05\u65B0", e: "\uD83C\uDF38", need: { lily: 2, jasmine: 2 }, wish: "\u767E\u5408\u7684\u7EAF\u6D01\uFF0C\u8309\u8389\u7684\u6DE1\u96C5\uFF0C\u6E05\u65B0\u5982\u521D" },
  { id: "noble", n: "\u5BCC\u8D35", e: "\uD83C\uDF3A", need: { peony: 2, camellia: 1 }, wish: "\u7261\u4E39\u7684\u56FD\u8272\uFF0C\u5C71\u8336\u7684\u7406\u60F3\uFF0C\u5BCC\u8D35\u5409\u7965" },
  { id: "elegant", n: "\u9AD8\u96C5", e: "\uD83C\uDFAD", need: { orchid: 1, lavender: 2 }, wish: "\u5170\u82B1\u7684\u9AD8\u6D01\uFF0C\u85B0\u8863\u8349\u7684\u7B49\u5F85\uFF0C\u4F18\u96C5\u4ECE\u5BB9" },
  { id: "memory", n: "\u56DE\u5FC6", e: "\uD83C\uDF41", need: { maple: 2, sakura: 1 }, wish: "\u67AB\u53F6\u7684\u56DE\u5FC6\uFF0C\u6A31\u82B1\u7684\u5E78\u798F\uFF0C\u65F6\u5149\u7F8E\u597D" },
  { id: "harvest", n: "\u4E30\u6536", e: "\uD83C\uDF3E", need: { wheat: 2, sunflower: 1 }, wish: "\u9EA6\u7A57\u7684\u5E0C\u671B\uFF0C\u5411\u65E5\u8475\u7684\u6C89\u9ED8\uFF0C\u4E30\u6536\u559C\u60A6" },
  { id: "messenger", n: "\u4F7F\u8005", e: "\uD83D\uDCAC", need: { iris: 2, lily: 1 }, wish: "\u51E4\u5C3E\u4F20\u9012\u7231\uFF0C\u767E\u5408\u5B88\u62A4\u7EAF\uFF0C\u7231\u7684\u4F7F\u8005" },
  { id: "zen", n: "\u7AF9\u610F", e: "\uD83C\uDF8B", need: { bamboo: 1, lotus: 1 }, wish: "\u7AF9\u7684\u575A\u97F6\uFF0C\u83B2\u7684\u6E05\u96C5\uFF0C\u5FC3\u5982\u6B62\u6C34" },
  { id: "phoenixWish", n: "\u6D85\u69C8", e: "\uD83D\uDD25", need: { phoenix: 1, flameRose: 1 }, wish: "\u51F0\u51F0\u82B1\u4E0E\u7EDE\u73AB\u7470\uFF0C\u6D85\u69C8\u91CD\u751F\u7684\u7231" }
];
function ensureCraftUI() {
  if (document.getElementById("garden-craft")) return;
  var p = document.getElementById("garden-panel-craft");
  if (!p) return;
  var el = document.createElement("div");
  el.id = "garden-craft";
  el.className = "garden-craft";
  p.appendChild(el);
}
function renderCraft() {
  ensureCraftUI();
  var el = document.getElementById("garden-craft");
  if (!el) return;
  if (!data.recipes) data.recipes = {};
  var h = '<div class="garden-craft-title">\uD83D\uDC83 \u82B1\u827A\u914D\u65B9</div><div class="garden-craft-list">';
  RECIPES.forEach(function (r) {
    var canMake = true;
    var needTxt = [], lackTxt = [];
    Object.keys(r.need).forEach(function (k) {
      var have = data.inv[k] || 0;
      var need = r.need[k];
      if (have < need) { canMake = false; lackTxt.push((T[k] ? T[k].e[T[k].e.length - 1] : "") + "\u00d7" + (need - have)); }
      var tp = T[k];
      needTxt.push('<span class="rq' + (have < need ? " short" : "") + '">' + (tp ? tp.e[tp.e.length - 1] : "") + " " + have + "/" + need + '</span>');
    });
    var made = !!data.recipes[r.id];
    h += '<div class="garden-recipe' + (canMake ? " can" : "") + (made ? " made" : "") + '">';
    h += '<div class="recipe-head"><span class="recipe-emoji">' + r.e + '</span><span class="recipe-name">' + r.n + '</span>' + (made ? '<span class="recipe-made">\u2713\u5DF2\u5408\u6210</span>' : "") + '</div>';
    h += '<div class="recipe-need">' + needTxt.join(" ") + '</div>';
    if (!canMake && lackTxt.length) h += '<div class="recipe-lack">\u6750\u6599\u4E0D\u8DB3\uFF0C\u8FD8\u7F3A ' + lackTxt.join("\u3001") + '\uFF08\u5728\u82B1\u56ED\u79CD\u4E0B\u5E76\u6536\u83B7\u540E\u53EF\u5408\u6210\uFF09</div>';
    h += '<div class="recipe-wish">' + r.wish + '</div>';
    if (canMake) h += '<button class="recipe-btn" data-recipe="' + r.id + '">\u5408\u6210\u82B1\u675F</button>';
    else h += '<button class="recipe-btn" disabled>\u6750\u6599\u4E0D\u8DB3</button>';
    h += '</div>';
  });
  h += '</div>';
  h += '<div class="garden-craft-sub">\uD83E\uDD7C \u6742\u4EA4\u914D\u65B9</div><div class="garden-craft-list hybrid-list">';
  HYBRIDS.forEach(function (hb) {
    var found = data.hybridFound && data.hybridFound[hb.a + "+" + hb.b];
    var ta = T[hb.a], tb = T[hb.b], tr = T[hb.r];
    if (!ta || !tb || !tr) return;
    h += '<div class="garden-recipe hybrid' + (found ? " made" : "") + '">';
    h += '<div class="recipe-head"><span class="recipe-emoji">' + tr.e[tr.e.length - 1] + '</span><span class="recipe-name">' + tr.n + '</span>' + (found ? '<span class="recipe-made">\u2713\u5DF2\u53D1\u73B0</span>' : '<span class="recipe-locked">\u672A\u53D1\u73B0</span>') + '</div>';
    h += '<div class="recipe-need">' + ta.e[ta.e.length - 1] + ta.n + ' + ' + tb.e[tb.e.length - 1] + tb.n + '</div>';
    h += '</div>';
  });
  h += '</div>';
  el.innerHTML = h;
  el.querySelectorAll(".recipe-btn").forEach(function (b) { b.addEventListener("click", function () { craftRecipe(b.dataset.recipe); }); });
}
function craftRecipe(id) {
  var r = null;
  for (var i = 0; i < RECIPES.length; i++) if (RECIPES[i].id === id) { r = RECIPES[i]; break; }
  if (!r) return;
  for (var k in r.need) { if ((data.inv[k] || 0) < r.need[k]) return; }
  for (var k2 in r.need) { data.inv[k2] = (data.inv[k2] || 0) - r.need[k2]; if (data.inv[k2] < 0) data.inv[k2] = 0; }
  if (!data.recipes) data.recipes = {};
  data.recipes[id] = Math.floor(Date.now() / 1000);
  data.bouquetCnt = (data.bouquetCnt || 0) + 1;
  addLog("\u6211", "\u5408\u6210\u300C" + r.n + "\u300D\u82B1\u675F " + r.e);
  save(data);
  if (window.chatSendFlower) { try { window.chatSendFlower(r.e, r.n + "\u82B1\u675F", r.wish); } catch (e) {} }
  renderAll();
}
function ensureReportUI() {
  if (document.getElementById("garden-report")) return;
  var p = document.getElementById("garden-panel-report");
  if (!p) return;
  var el = document.createElement("div");
  el.id = "garden-report";
  el.className = "garden-report";
  p.appendChild(el);
}
function renderReport() {
  ensureReportUI();
  var el = document.getElementById("garden-report");
  if (!el) return;
  var st = data.st || {};
  var year = new Date().getFullYear();
  var totalPlant = (st.p || 0) + (st.mp || 0);
  var totalWater = (st.w || 0) + (st.mw || 0);
  var totalHarv = (st.h || 0) + (st.mh || 0);
  var totalFert = (st.f || 0) + (st.mf || 0);
  var topFlower = null, topCnt = 0;
  Object.keys(data.dex || {}).forEach(function (k) { var dx = data.dex[k]; if (!dx) return; var c = (dx.p || 0) + (dx.h || 0); if (c > topCnt && T[k]) { topCnt = c; topFlower = T[k]; } });
  var invTotal = 0; Object.keys(data.inv || {}).forEach(function (k) { invTotal += data.inv[k] || 0; });
  var achvCnt = Object.keys(data.achv || {}).length;
  var bouquet = data.bouquetCnt || 0;
  var streak = data.waterStreak || 0;
  var dexGot = Object.keys(data.dex || {}).filter(function (k) { var d = data.dex[k]; return d && (d.p > 0 || d.h > 0); }).length;
  var partnerCare = (st.mp || 0) + (st.mw || 0) + (st.mh || 0) + (st.mf || 0);
  var h = '<div class="garden-report-card">';
  h += '<div class="report-year">' + year + ' \u82B1\u56ED\u5E74\u62A5</div>';
  h += '<div class="report-lv">Lv.' + gLv() + ' \u00B7 ' + (data.exp || 0) + ' EXP</div>';
  h += '<div class="report-stats"><div class="rs-item"><b>' + totalPlant + '</b>\u79CD\u690D</div><div class="rs-item"><b>' + totalWater + '</b>\u6D47\u6C34</div><div class="rs-item"><b>' + totalHarv + '</b>\u6536\u83B7</div><div class="rs-item"><b>' + totalFert + '</b>\u65BD\u80A5</div></div>';
  h += '<div class="report-row"><span>\u6700\u5E38\u79CD</span><b>' + (topFlower ? topFlower.e[topFlower.e.length - 1] + " " + topFlower.n : "\u2014") + '</b></div>';
  h += '<div class="report-row"><span>\u5E93\u5B58\u82B1\u6735</span><b>' + invTotal + ' \u6735</b></div>';
  h += '<div class="report-row"><span>\u5236\u4F5C\u82B1\u675F</span><b>' + bouquet + ' \u675F</b></div>';
  h += '<div class="report-row"><span>\u89E3\u9501\u6210\u5C31</span><b>' + achvCnt + '/' + ACHV.length + '</b></div>';
  h += '<div class="report-row"><span>\u8FDE\u7EED\u6D47\u6C34</span><b>' + streak + ' \u5929</b></div>';
  h += '<div class="report-row"><span>\u56FE\u9274\u6536\u96C6</span><b>' + dexGot + '/' + Object.keys(T).length + '</b></div>';
  h += '<div class="report-row"><span>\u68A6\u89D2\u6253\u7406</span><b>' + partnerCare + ' \u6B21</b></div>';
  var gTime = data.gardenTime || 0;
  var gTimeTxt = gTime >= 3600 ? Math.floor(gTime / 3600) + " \u5C0F\u65F6" : Math.floor(gTime / 60) + " \u5206\u949F";
  h += '<div class="report-row"><span>\u901B\u82B1\u56ED\u65F6\u957F</span><b>' + gTimeTxt + '</b></div>';
  h += '</div>';
  h += '<button class="report-share-btn" id="garden-report-share">\uD83D\uDCF8 \u5206\u4EAB\u5230\u670B\u53CB\u5708</button>';
  el.innerHTML = h;
  var sb = el.querySelector("#garden-report-share");
  if (sb) sb.addEventListener("click", function () {
    var lines = [
      year + " \u82B1\u56ED\u5E74\u62A5 \uD83C\uDF3F",
      "Lv." + gLv() + " \u00B7 " + (data.exp || 0) + " EXP",
      "\u79CD\u690D" + totalPlant + " \u6D47\u6C34" + totalWater + " \u6536\u83B7" + totalHarv + " \u65BD\u80A5" + totalFert,
      "\u6700\u5E38\u79CD\uFF1A" + (topFlower ? topFlower.n : "\u2014"),
      "\u5236\u4F5C\u82B1\u675F" + bouquet + " \u89E3\u9501\u6210\u5C31" + achvCnt + "/" + ACHV.length,
      "\u8FDE\u7EED\u6D47\u6C34" + streak + "\u5929 \u68A6\u89D2\u6253\u7406" + partnerCare + "\u6B21",
      "\uD83C\uDF38 \u613F\u6211\u4EEC\u7684\u82B1\u56ED\u4E00\u76F4\u7E41\u76DB"
    ];
    var text = lines.join("\n");
    var ok = false;
    try {
      var st = window.xyStore ? window.xyStore("xy-home-v2") : null;
      if (st) {
        var FK = "feed-posts";
        var arr = []; try { arr = JSON.parse(st.get(FK) || "[]"); } catch (e2) {}
        var owner = "default"; try { if (window.__activeCid) owner = window.__activeCid; } catch (e2) {}
        var an = "\u6211"; try { var as = window.activeStore ? window.activeStore() : null; if (as) { var nn = as.get("feed-user-name") || as.get("lbl-user"); if (nn) an = nn; } } catch (e2) {}
        arr.unshift({ id: "f_" + Date.now(), role: "me", owner: owner, authorName: an, authorAv: "", taName: "", taAv: "", content: text, imgs: [], ts: Date.now(), likes: [], comments: [] });
        var raw = JSON.stringify(arr);
        st.set(FK, raw);
        if (window.idbSet) window.idbSet("xy-home-v2:" + FK, raw);
        ok = true;
      }
    } catch (e3) {}
    try { document.dispatchEvent(new CustomEvent("garden-share-report", { detail: { ok: ok } })); } catch (e4) {}
    if (window.openModal) window.openModal(ok ? "\u2705 \u5DF2\u53D1\u5E03\u5230\u670B\u53CB\u5708" : "\u53D1\u5E03\u5931\u8D25", "", function () {}, { pills: [{ label: "\u597D\u7684", value: "ok" }], noInput: true, staticText: ok ? "\u82B1\u56ED\u5E74\u62A5\u5DF2\u53D1\u5230\u670B\u53CB\u5708\uFF0C\u53BB\u670B\u53CB\u5708\u770B\u770B\u5427~" : "\u8BF7\u7A0D\u540E\u518D\u8BD5" });
  });
}
function renderAll() {
  batchSave = true; saveDirty = false;
  syncPlots();
  markBloomed();
  checkLevelUp();
  ensureTabUI();
  ensureHybridBtn();
  ensureUpgradeBtn();
  ensureReclaimBtn();
  ensureReplantBtn();
  renderWeather();
  renderDaily();
  renderLevel();
  if (curTab === "garden") {
    renderGrid(); renderStats(); renderVisitor(); renderLog();
  } else if (curTab === "dex") {
    renderDex();
  } else if (curTab === "craft") {
    renderInv(); renderCraft();
  } else if (curTab === "shop") {
    renderDecor(); renderLeaderboard();
  } else if (curTab === "achv") {
    renderAchv();
  } else if (curTab === "report") {
    renderReport();
  }
  checkAchv();
  batchSave = false;
  if (saveDirty) save(data);
}

function checkPartnerPassive() {
  try {
    var now = Math.floor(Date.now() / 1000);
    if (data && data.lpc && now - data.lpc < PI) return;
    var d = load();
    now = Math.floor(Date.now() / 1000);
    var last = d.lpc || 0;
    if (!last) {
      data = d;
      var ok0 = partnerAct(true);
      if (!ok0) data.lpc = now - PI;
      save(data);
      return;
    }
    var elapsed = now - last;
    if (elapsed < PI) { data = d; return; }
    var slots = Math.floor(elapsed / PI);
    data = d;
    var triggered = 0;
    var used = [];
    for (var i = 0; i < slots; i++) {
      if (triggered >= 40) break;
      if (Math.random() < 0.4) {
        if (partnerAct(true, used)) triggered++;
      }
    }
    if (triggered > 0) {
      var pName = pn();
      addLog(pName, "\u6253\u7406\u4E86\u82B1\u56ED\uFF08\u540E\u53F0\uFF09");
      save(data);
    } else {
      data.lpc = last + slots * PI;
      save(data);
    }
  } catch (e) {}
}

function handlePlotClick(e) {
  // #503 折叠砖点击=展开/收起空地
  var fold = e.target.closest(".garden-fold-tile");
  if (fold) { emptyFolded = !emptyFolded; renderGrid(); return; }
  var el = e.target.closest(".garden-plot");
  if (!el) return;
  var idx = parseInt(el.getAttribute("data-idx"));
  if (isNaN(idx)) return;
  if (data.p[idx]) {
    selPlot = selPlot === idx ? -1 : idx;
  } else {
    selPlot = idx;
  }
  page.querySelectorAll(".garden-plot").forEach(function (p) {
    var i = parseInt(p.getAttribute("data-idx"));
    p.classList.toggle("selected", i === selPlot);
  });
}

function handleTool(e) {
  var btn = e.target.closest(".garden-tool");
  if (!btn) return;
  var tool = btn.getAttribute("data-tool");
  if (tool === "water") {
    if (selPlot < 0) return;
    waterPlot(selPlot);
  } else if (tool === "fertilize") {
    if (selPlot < 0) return;
    fertilizePlot(selPlot);
  } else if (tool === "harvest") {
    if (selPlot < 0) return;
    harvestPlot(selPlot);
  } else if (tool === "plant") {
    if (selPlot < 0) return;
    if (data.p[selPlot]) return;
    if (!window.openModal) return;
    var normalKeys = Object.keys(T).filter(function (k) { return unlocked(k); });
    var rareKeys = Object.keys(data.rareInv || {}).filter(function (k) { return data.rareInv[k] > 0 && T[k] && T[k].rare; });
    var pills = normalKeys.map(function (k) {
      var tp = T[k];
      return { label: tp.e[tp.e.length - 1] + " " + tp.n, value: k };
    });
    rareKeys.forEach(function (k) {
      var tp = T[k];
      pills.push({ label: "\u2728 " + tp.e[tp.e.length - 1] + " " + tp.n + " \u00d7" + data.rareInv[k], value: "rare:" + k });
    });
    if (!pills.length) return;
    window.openModal("\u9009\u62E9\u79CD\u690D", "", function (v) {
      if (!v) return;
      if (v.indexOf("rare:") === 0) {
        var rk = v.slice(5);
        if (data.rareInv && data.rareInv[rk] > 0) { data.rareInv[rk]--; plantSeed(selPlot, rk); }
      } else if (T[v]) { plantSeed(selPlot, v); }
    }, { pills: pills, noInput: true });
  } else if (tool === "waterall") {
    waterAll();
  } else if (tool === "harvestall") {
    harvestAll();
  } else if (tool === "hybrid") {
    if (selPlot < 0) return;
    hybridPlot(selPlot);
  } else if (tool === "upgrade") {
    if (selPlot < 0) return;
    upgradePlot(selPlot);
  } else if (tool === "replant") {
    replantAll();
  } else if (tool === "reclaim") {
    reclaimPlots();
  } else if (tool === "shrink") {
    shrinkPlots();
  }
}

function waterAll() {
  var cnt = 0;
  for (var i = 0; i < data.p.length; i++) {
    var plot = data.p[i];
    if (!plot) continue;
    if (waterLvl(plot) > 0.5) continue;
    plot.watered = Math.floor(Date.now() / 1000);
    plot.planted = Math.max(0, plot.planted - 14400);
    cnt++;
  }
  if (cnt > 0) {
    addLog("\u6211", "\u4E00\u952E\u6D47\u4E86 " + cnt + " \u68F5\u690D\u7269");
    updSt("w", true);
    if (Math.random() < 0.08) { var pn3 = pn(); addLog(pn3, "\u770B\u5230\u4F60\u5728\u6D47\u6C34\uFF0C\u4E5F\u6765\u5E2E\u5FD9\u4E86~"); partnerAct(true); }
    save(data); renderAll();
  }
}

function harvestAll() {
  var cnt = 0;
  var totalXp = 0;
  var totalCoin = 0;
  var xpb = 1 + decorBuffs().xp;
  var dropped = [];
  for (var i = 0; i < data.p.length; i++) {
    var plot = data.p[i];
    if (!plot) continue;
    var si = stageInfo(plot);
    if (!si || !si.bloomed) continue;
    var tp = T[plot.type];
    var wilted = si.wilted;
    var q = rollQuality();
    var xpg = Math.round((tp ? tp.xp : 10) * xpb * (wilted ? 0.5 : 1) * qualMul(q));
    data.p[i] = null;
    data.exp = (data.exp || 0) + xpg;
    addInvQual(plot.type, q);
    if (wilted) data.wiltedSeen = true;
    updDex(plot.type, "h"); updSt("h", true); updDaily("h");
    var dr = dropRareSeed(); if (dr) dropped.push(dr);
    fxAtPlot(i, "fx-harvest", 1000);
    totalXp += xpg;
    // v3.15.x：一键收获同样发收花奖励（grantHarvestCoin 内部走同一日封顶计数）
    var cg = grantHarvestCoin(q, wilted);
    if (cg) totalCoin += cg;
    cnt++;
  }
  if (cnt > 0) {
    addLog("\u6211", "\u4E00\u952E\u6536\u83B7 " + cnt + " \u6735\u82B1 (+" + totalXp + "\u7ECF\u9A8C)" + (dropped.length ? " \u2728\u83B7\u5F97" + dropped.length + "\u9897\u7A00\u6709\u79CD\u5B50" : ""));
    if (totalCoin > 0) addLog("\u6211", "\u6536\u82B1\u5956\u52B1\u5230\u8D26 " + coinTxt(totalCoin));
    save(data); renderAll();
  }
}

function makeBouquet() {
  var keys = Object.keys(data.inv || {}).filter(function (k) { return data.inv[k] > 0 && T[k]; });
  if (!keys.length) return;
  if (!window.openModal) return;
  var pills = keys.map(function (k) {
    var tp = T[k];
    return { label: tp.e[tp.e.length - 1] + " " + tp.n + " \u00d7" + data.inv[k] + (tp.m ? " \u00B7 " + tp.m : ""), value: k };
  });
  window.openModal("\u9009\u4E00\u6735\u82B1\u5236\u4F5C\u82B1\u675F", "", function (v) {
    if (!v || !T[v] || !data.inv[v]) return;
    var tp = T[v];
    var emoji = tp.e[tp.e.length - 1];
    var meaning = tp.m || "";
    var defWish = "\u9001\u7ED9\u4F60\u4E00\u675F" + tp.n + "\uFF0C\u662F\u6211\u4EEC\u4E00\u8D77\u79CD\u7684\u54E6~" + (meaning ? "\n\u82B1\u8BED\uFF1A" + meaning : "");
    var mask = document.getElementById("modal-mask");
    if (mask) mask.hidden = true;
    setTimeout(function () {
      if (!window.openModal) return;
      window.openModal("\u9001\u82B1\u7559\u8A00\uFF08\u53EF\u4FEE\u6539\uFF09", defWish, function (wish) {
        data.inv[v]--;
        data.bouquetCnt = (data.bouquetCnt || 0) + 1;
        var msg = (wish && wish.trim()) ? wish.trim() : defWish;
        addLog("\u6211", "\u5236\u4F5C\u4E86\u4E00\u675F " + tp.n + "\u82B1\u9001\u7ED9" + pn() + (meaning ? "\uFF08\u82B1\u8BED\uFF1A" + meaning + "\uFF09" : ""));
        save(data);
        if (window.chatSendFlower) { try { window.chatSendFlower(emoji, tp.n, msg); } catch (e) {} }
        renderAll();
      }, {});
    }, 150);
  }, { pills: pills, noInput: true });
}

function buyDecor() {
  if (!window.openModal) return;
  var keys = Object.keys(DECOR);
  var pills = keys.map(function (k) {
    var dp = DECOR[k];
    var cnt = data.decor[k] || 0;
    var lock = cnt >= dp.max;
    var lbl = dp.e + " " + dp.n + " " + (lock ? "\u5DF2\u6EE1" : "\u514D\u8D39") + (dp.buff ? " " + dp.buff.label : "");
    return { label: lbl, value: k };
  });
  window.openModal("\u88C5\u9970\u5546\u5E97\uFF08\u514D\u8D39\uFF09", "", function (v) {
    if (!v || !DECOR[v]) return;
    var dp = DECOR[v];
    var cnt = data.decor[v] || 0;
    if (cnt >= dp.max) return;
    data.decor[v] = cnt + 1;
    addLog("\u6211", "\u8D2D\u4E70\u4E86 " + dp.n);
    save(data); renderAll();
  }, { pills: pills, noInput: true });
}

function spawnVisitor() {
  if (data.visitor) {
    var now = Math.floor(Date.now() / 1000);
    if (data.visitor.start + data.visitor.dur < now) data.visitor = null;
  }
  if (data.visitor) return;
  if (Math.random() > 0.25) return;
  var vi = VISITORS[Math.floor(Math.random() * VISITORS.length)];
  var dur = 3600 + Math.floor(Math.random() * 10800);
  data.visitor = { type: vi.type, start: Math.floor(Date.now() / 1000), dur: dur };
  addLog(vi.n, "\uD83C\uDF49 \u6765\u8BBF\u4E86\u82B1\u56ED");
  save(data);
}

function openGarden() {
  var editing = Array.from(document.querySelectorAll(".app-grid")).some(function (g) { return g.classList.contains("editing"); });
  if (editing) return;
  document.querySelectorAll(".page").forEach(function (pg) { pg.hidden = true; });
  page.hidden = false;
  // v3.14.x：LS 缺 garden-data（或只是垃圾空档）时先等 IDB 判定再初始化本局——
  // 直接往下走会 load() 出全新空档并触发一连串自动保存（下雨浇水/访客/伙伴），
  // 把 IDB 里还没读完的老花园覆盖掉。先渲染当前内存态（可能为空），判定命中后重载。
  if (junkEmpty()) {
    try { renderAll(); } catch (e) {}
    // FIX 2026-09-16 #588：LS 还没回填时这里先渲染的是「内存态」＝用户看到一个**空花园**，
    //   读回前没有任何提示，最容易被当成「我的花园数据全丢了」（比卡顿更吓人）。
    //   probeIdb 要重试 2 次共约 600ms+，这期间必须给出「正在读」的信号；
    //   命中会随后 toast「已找回花园数据 🌸」覆盖本条，未命中则空花园本就是正确状态、提示自然淡出。
    toast("正在读取本地花园数据…");
    probeIdb(function (v) {
      if (!page.hidden) openGardenBody(!!v);
    });
    return;
  }
  openGardenBody(false);
}
function openGardenBody(recovered) {
  checkPartnerPassive();
  data = load();
  checkLoginReward();
  selPlot = -1;
  curWeather = wx();
  curSeason = sea();
  if (curWeather.t === "\u5C0F\u96E8") {
    for (var i = 0; i < data.p.length; i++) {
      if (data.p[i] && waterLvl(data.p[i]) < 0.3) {
        data.p[i].watered = Math.floor(Date.now() / 1000);
      }
    }
    save(data);
  }
  var dbf = decorBuffs();
  if (dbf.water > 0) {
    for (var wi = 0; wi < data.p.length; wi++) {
      if (data.p[wi] && waterLvl(data.p[wi]) < Math.min(1, dbf.water)) {
        data.p[wi].watered = Math.floor(Date.now() / 1000) - WATER_SEC + Math.floor(Math.min(1, dbf.water) * WATER_SEC);
      }
    }
    save(data);
  }
  spawnVisitor();
  if (Math.random() < 0.3 + dbf.partner) partnerAct();
  renderAll();
  if (recovered) toast("\u5DF2\u627E\u56DE\u82B1\u56ED\u6570\u636E \uD83C\uDF38");
  try { document.dispatchEvent(new CustomEvent("garden-enter")); } catch (e) {}
}

var appBtn = document.querySelector('.app[data-app="garden"]');
if (appBtn && page) appBtn.addEventListener("click", openGarden);

var backBtn = document.getElementById("garden-back");
if (backBtn) backBtn.addEventListener("click", function () {
  document.querySelectorAll(".page").forEach(function (pg) { pg.hidden = true; });
  var home = document.getElementById("page-phone");
  if (home) home.hidden = false;
  try { document.dispatchEvent(new CustomEvent("garden-leave")); } catch (e) {}
});

document.addEventListener("garden-enter", function () {
  try { data._enterTs = Math.floor(Date.now() / 1000); } catch (e) {}
});
document.addEventListener("garden-leave", function () {
  try {
    if (data._enterTs) {
      var dur = Math.floor(Date.now() / 1000) - data._enterTs;
      if (dur > 0 && dur < 86400) data.gardenTime = (data.gardenTime || 0) + dur;
      data._enterTs = 0;
      save(data);
    }
  } catch (e) {}
});

var gridEl = document.getElementById("garden-grid");
if (gridEl) gridEl.addEventListener("click", handlePlotClick);

var toolbarEl = document.getElementById("garden-toolbar");
if (toolbarEl) toolbarEl.addEventListener("click", handleTool);


document.addEventListener("contact-switched", function () {
  if (!page.hidden) { data = load(); selPlot = -1; renderAll(); }
});

(function watchHome() {
  var home = document.getElementById("page-phone");
  if (!home) return;
  var mo = new MutationObserver(function () {
    if (!home.hidden) {
      try { checkPartnerPassive(); } catch (e) {}
    }
  });
  mo.observe(home, { attributes: true, attributeFilter: ["hidden"] });
  if (!home.hidden) {
    try { checkPartnerPassive(); } catch (e) {}
  }
})();

window.gardenBloomDates = function () {
  var list = [];
  try {
    var contacts = window.getContacts ? (window.getContacts() || []) : [{ id: "default", name: "\u9ED8\u8BA4" }];
    contacts.forEach(function (c) {
      var st = window.storeFor ? window.storeFor(c.id) : null;
      if (!st) return;
      var raw = st.get("garden-data");
      if (!raw) return;
      var d; try { d = JSON.parse(raw); } catch (e) { return; }
      if (!d || !d.p) return;
      var name = c.name || c.id;
      try { var pnn = st.get("lbl-partner"); if (pnn) name = pnn; } catch (e) {}
      d.p.forEach(function (plot, i) {
        if (!plot || !T[plot.type]) return;
        var tp = T[plot.type];
        var totalSec = tp.g.reduce(function (a, b) { return a + b; }, 0);
        var bloomAt = (plot.planted || 0) + Math.ceil(totalSec / 1.1);
        list.push({ cid: c.id, name: name, type: plot.type, flower: tp.n, emoji: tp.e[tp.e.length - 1], bloomAt: bloomAt, idx: i });
      });
    });
  } catch (e) {}
  return list;
};

})();
