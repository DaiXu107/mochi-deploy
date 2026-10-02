// ===== #1015 专项回归：夜间模式收件总闸（口径＝只拦「TA 主动发起」）=====
// 背景：#876 的夜间静默总闸（2026-09-20）在 345f78b（#860 全量外置收口）里被整批抹掉，
// 线上产物连 __nightReplyOpen 都没有——用户实报「开了夜间模式，联系人还是能主动在聊天里
// 发送消息，而且有音效」。本批按用户口径补回并改写：
//   口径（用户拍板）＝只拦 TA 主动；你自己发的消息与 TA 对你的回复照常即时送达（含提示音）。
//   因此 #876 的「被动回复顺延到次日 7:00」「群聊成员回复顺延」两条**刻意不再实现**。
// 本批实现：
//   #1015a chat.js addRec 收件总闸（判据 rec.initiative＝TA 主动为真；nightAllow 显式豁免）
//   #1015b chat.js addIn 音效前同款守卫（音效在 addRec 之前播，防止「响一声没消息」）
//   #1015d chat.js nightOpenReply 助手＝3 分钟对话窗口（你自己发消息/继续说/让TA邀请我 三处）
//   #876e  avatar-lib avNightQuiet 四轮询守卫（已在 HEAD，本批未动，断言保留防回退）
//   #1015f ta-ask interactGateOk 内夜间 return false（五类互动卡+查岗卡一处收口，手动不受限）
//   #1015h/i/j/k p2 换位 / gift 送礼 / feed 动态 / bg-keep 跨桌面回放 各源头闸
//   各用户当刻操作通道的 nightAllow 标记（红包领取退回、战绩、存钱罐、决定结果、经期、音乐）
// 用例：
//   S1~S14 源码锚（含「守卫必须排在音效之前」的顺序锚）
//   B1 夜间四态对照对（每条都带反侧，保证在纯 HEAD 上必红）
//   B2 avNightQuiet 三态｜B3 interactGateOk 行为
// 红对照：MOCHI_EXPECT=red MOCHI_ROOT=<纯 HEAD 副本> node tools/verify-night-mode-silence.mjs
//   ——S5/B2（avatar-lib #876e）在 HEAD 里**仍在位**，红侧会显示为「存活项」，这是已知在位、
//   非本批引入；其余锚在纯 HEAD 上应全红。
// 纯 node 单元验证（vm 提取函数体＋stub），不依赖无头浏览器、不触发 node build.mjs。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const rd = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return null; } };
const srcChat = rd('src/js/chat.js') || '';
const srcAv = rd('src/js/avatar-lib.js') || '';
const srcAsk = rd('src/js/ta-ask.js') || '';
const srcP2 = rd('src/js/p2-features.js') || '';
const srcGift = rd('src/js/gift-shop.js') || '';
const srcFeed = rd('src/js/feed.js') || '';
const srcBg = rd('src/js/bg-keep.js') || '';
const srcPeriod = rd('src/js/period.js') || '';
const srcMusic = rd('src/js/music-player.js') || '';
const srcDecision = rd('src/js/decision.js') || '';
const srcHelp = rd('src/js/settings-help.js') || '';

const failures = [];
const passed = [];
const note = (id, ok, why) => { if (ok) passed.push(id); else failures.push(id + '：' + why); };
const has = (src, needle) => src.indexOf(needle) >= 0;
const count = (src, needle) => src.split(needle).length - 1;

// ---- 提取 IIFE 内指定函数体（花括号配平） ----
function extractFn(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) throw new Error('找不到 ' + sig);
  const bodyStart = src.indexOf('{', at);
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error(sig + ' 花括号不配平');
}
function sameLine(src, a, b) { let n = 0; src.split('\n').forEach((l) => { if (l.includes(a) && l.includes(b)) n++; }); return n; }
function tryExtract(src, sig) { try { return extractFn(src, sig); } catch (e) { return null; } }

// ================= S 组：源码锚 =================
note('S1a', has(srcChat, "if (rec.side === 'in' && nightBlocksIn(rec.initiative, rec.nightAllow)) return null;"), 'addRec 收件总闸缺失（TA 主动的收件夜里照发）');
note('S1b', has(srcChat, 'if (!initiative) return false;'), '总闸判据必须只拦 initiative（TA 主动）——缺此句＝连你的回复一起拦，用户口径「回复照常」失效');
note('S1c', has(srcChat, 'if (nightAllow) return false;'), '总闸缺显式豁免通道（用户当刻操作的回执会被拦）');
note('S1d', has(srcChat, "rec.uid") || has(srcChat, 'chatRecStampUid(rec)'), '总闸不得顶掉收件主链（出生号仍在位）');
note('S2', has(srcChat, 'if (nightBlocksIn(opts.initiative, opts.nightAllow)) return null;'), 'addIn 音效前守卫缺失');
note('S2b', (() => { const g = srcChat.indexOf('if (nightBlocksIn(opts.initiative, opts.nightAllow)) return null;'); const s = srcChat.indexOf("window.playSfx('in')"); return g >= 0 && s >= 0 && g < s; })(), '音效守卫必须排在 playSfx 之前（否则夜里响一声没消息）');
note('S3', count(srcChat, 'nightOpenReply();') >= 3, '夜间对话窗口助手调用点应 ≥3（你自己发消息/继续说/让TA邀请我），实得 ' + count(srcChat, 'nightOpenReply();'));
note('S4', has(srcChat, 'if (window.nightModeActive && window.nightModeActive()) window.__nightReplyOpen = Date.now();'), '对话窗口置位缺失（点「继续说」/「让TA邀请我」＝点了没反应）');
note('S4b', !has(srcChat, 'const __nmHold = window.nightModeActive'), '被动回复顺延链应已退役（用户口径＝回复照常即时）');
note('S5a', has(srcAv, 'function avNightQuiet() {'), 'avatar-lib 夜间静默助手缺失');
note('S5b', count(srcAv, 'if (avNightQuiet()) return;') === 4, '四个换头像/换昵称轮询守卫应恰 4 处，实得 ' + count(srcAv, 'if (avNightQuiet()) return;'));
note('S5c', has(srcAv, "xyStore('xy-home-v2').get('night-mode-en')"), '助手全局根键兜底缺失（启动直调时 incoming-requests 未加载）');
note('S6', has(srcAsk, 'if (window.nightModeActive && window.nightModeActive()) return false;'), '互动卡频率闸夜间拦截缺失');
note('S8', count(srcP2, 'if (window.nightModeActive && window.nightModeActive()) return;') >= 1, 'TA 自动换位夜间闸缺失');
note('S9', count(srcGift, 'if (window.nightModeActive && window.nightModeActive()) return;') >= 1, 'TA 自动送礼源头闸缺失');
note('S10', count(srcFeed, 'if (window.nightModeActive && window.nightModeActive()) return;') >= 1, '朋友圈自动动态夜间闸缺失');
note('S11', has(srcBg, 'if (!force && window.nightModeActive && window.nightModeActive()) return 0;'), '跨桌面回放夜间暂停缺失');
note('S12a', has(srcPeriod, "'经期预警', nightAllow: true"), '经期提醒放行标记缺失（拦掉＝提醒永久丢）');
note('S12b', sameLine(srcMusic, 'silent: true', 'nightAllow: true'), '音乐互动台词放行标记缺失（用户听歌当刻操作）#1341 起两枚标记之间可能夹 rateAllow，故按「同一行成对」判');
note('S12c', sameLine(srcChat, "special: 'poke'", 'nightAllow: true') >= 3, '红包领取/退回回执放行标记缺失（账目先行不可无痕；成对的行数应 ≥3）');
note('S12d', sameLine(srcDecision, 'dedupExempt: true', 'nightAllow: true') >= 1, '帮我决定结果放行标记缺失（用户当刻操作）');
note('S12e', has(srcChat, 'nightAllow: opts.nightAllow'), 'chatAddSystem 未透传 nightAllow（调用方的豁免标记被白名单吞掉）');
note('S13', has(srcChat, 'function trySystemAutoSend() {\n// #1015 夜间静默：TA 自动红包夜间不生成'), 'TA 自动红包源头闸缺失（总闸拦消息＝扣了钱没红包）');
note('S13b', has(srcChat, 'function trySystemAskMochi() {\n// #1015 夜间静默：TA 主动申请心意币夜间不生成'), 'TA 主动申请心意币源头闸缺失');
note('S14', has(srcHelp, '你自己发的消息与 TA 对你的回复照常即时送达'), '设置页说明口径未同步（应写清「只拦 TA 主动、你的消息与回复照常」）');

// ================= B 组：行为断言（vm + stub） =================
function runFn(fnSrc, sandbox) {
  const ctx = vm.createContext(sandbox);
  return vm.runInContext('(' + fnSrc + ')', ctx);
}

// B1 addIn/addRec 总闸：每条都成「对照对」（正反两侧一起判），保证在纯 HEAD 上必红
const gateSrc = tryExtract(srcChat, 'function nightBlocksIn(initiative, nightAllow) {');
// #1180：addIn 里同族又挂了一道总量限流闸（rateBlocksIn→rateLimitFull→cfg/cfgn＋msgs），
// 沙箱不补齐符号就会 ReferenceError。这里按「限流关闭」态补桩（本脚本测的是夜间闸），
// 限流本体的行为断言在 verify-1180-ta-rate-limit.mjs。
const rlSrc = [tryExtract(srcChat, 'function rateLimitFull() {'),
  (tryExtract(srcChat, 'function rateBlocksIn(side, special, nightAllow) {') || tryExtract(srcChat, 'function rateBlocksIn(rec) {')), // #1341：签名改吃整份记录，两态都要能提取（旧侧才有读数）
  (tryExtract(srcChat, 'function rlExempt(p) {') || ''), (tryExtract(srcChat, 'function rlReserveAvailable() {') || ''),
  'let rlUserSpokeAt = 0, rlReserveFor = 0; const RL_REPLY_GRACE_MS = 60000;', // #1341 模块变量在沙箱里补桩（本脚本测的是夜间闸）
  tryExtract(srcChat, 'function cfg() {'), tryExtract(srcChat, 'function cfgn(c, k, d) {')].map((s) => s || '').join('\n');
const addInSrc = tryExtract(srcChat, 'function addIn(text, opts)');
if (gateSrc && addInSrc) {
  const mk = (nm, openAgoMs) => {
    const recs = []; let sfx = 0;
    const w = { playSfx: () => { sfx++; }, nightModeActive: nm, replyCfg: () => ({ 'rl-en': 0 }) };
    if (openAgoMs != null) w.__nightReplyOpen = Date.now() - openAgoMs;
    const sb = { window: w, console, Date, String, Array, msgs: [], addRec: (r) => { recs.push(r); return r; } };
    const fn = vm.runInContext('(function () { ' + gateSrc + '\n' + rlSrc + '\n' + addInSrc + '\n return addIn; })()', vm.createContext(sb));
    return { fn, recs, sfx: () => sfx };
  };
  // ① 夜间：TA 主动（initiative）必拦；被动回复（无 initiative）必放行
  const a = mk(() => true);
  const rIni = a.fn('TA 主动找你', { initiative: true });
  const sfxBlocked = a.sfx();
  const rPas = a.fn('TA 回你的话', {});
  note('B1a', rIni === null && sfxBlocked === 0 && rPas && rPas.text === 'TA 回你的话' && a.sfx() === 1,
    '夜间应「拦 TA 主动、放行你的回复」：主动条 r=' + String(rIni) + '（拦下时应 sfx=0，实得 ' + sfxBlocked + '），回复条 r=' + JSON.stringify(rPas && rPas.text) + '（应响音效，总 sfx 实得 ' + a.sfx() + '）');
  // ② nightAllow 显式豁免：同形带标记放行，不带标记拦
  const b = mk(() => true);
  const rAllow = b.fn('红包已领取', { initiative: true, nightAllow: true });
  const rNo = b.fn('红包已领取', { initiative: true });
  note('B1b', rAllow && rAllow.nightAllow === true && rNo === null,
    'nightAllow 应放行且透传、同形不带标记应拦：r=' + JSON.stringify(rAllow && rAllow.nightAllow) + ' / ' + String(rNo));
  // ③ 对话窗口：窗口内（160s 前置位）放行；窗口过期（200s 前）拦
  const c1 = mk(() => true, 160000);
  const c2 = mk(() => true, 200000);
  note('B1c', c1.fn('窗口内的追加动作', { initiative: true }) !== null && c2.fn('窗口外的追加动作', { initiative: true }) === null,
    '对话窗口（180s）内应放行、过期应拦');
  // ④ 白天（时段外）：TA 主动也放行
  const d = mk(() => false);
  const rDay = d.fn('白天的主动消息', { initiative: true });
  note('B1d', rDay && d.sfx() === 1, '白天（时段外）TA 主动消息应放行，实得 r=' + String(rDay));
  // ⑤ 夜间被拦时必须不响音效（守卫前置）
  const e = mk(() => true);
  e.fn('夜里该静音的一条', { initiative: true });
  note('B1e', e.sfx() === 0, '夜间被拦的收件不得响音效（守卫须在 playSfx 之前），实得 sfx=' + e.sfx());
} else {
  note('B1a', false, 'nightBlocksIn / addIn 函数体提取失败');
  note('B1b', false, 'nightBlocksIn / addIn 函数体提取失败');
  note('B1c', false, 'nightBlocksIn / addIn 函数体提取失败');
  note('B1d', false, 'nightBlocksIn / addIn 函数体提取失败');
  note('B1e', false, 'nightBlocksIn / addIn 函数体提取失败');
}

// B2 avNightQuiet 三态
const avNightSrc = tryExtract(srcAv, 'function avNightQuiet() {');
if (avNightSrc) {
  const mk = (nm, en, hour) => {
    const sb = { window: {}, Date: class extends Date { getHours() { return hour; } } };
    if (nm) sb.window.nightModeActive = nm;
    sb.window.xyStore = () => ({ get: (k) => (k === 'night-mode-en' ? en : '') });
    const f = runFn(avNightSrc, sb);
    return f();
  };
  note('B2a', mk(() => true, '0', 12) === true, '主路径：nightModeActive()=true 应判夜间');
  note('B2b', mk(null, '0', 23) === false, '兜底：开关未开（根键≠1）即使深夜 23 点也应不静默');
  note('B2c', mk(null, '1', 23) === true && mk(null, '1', 6) === true, '兜底：开关开＋23 点/6 点应判夜间');
  note('B2d', mk(null, '1', 12) === false, '兜底：开关开＋中午 12 点应不静默');
} else note('B2a', false, 'avNightQuiet 函数体提取失败');

// B3 interactGateOk
const askGateSrc = tryExtract(srcAsk, 'function interactGateOk() {');
if (askGateSrc) {
  let gateRead = 0;
  const mk = (nm, last) => {
    gateRead = 0;
    const sb = { window: {}, store: { get: () => { gateRead++; return String(last); } }, Number, Date, INTERACT_GATE_KEY: 'interact-card-last', INTERACT_GATE_MS: 60 * 60000 };
    if (nm) sb.window.nightModeActive = nm;
    const f = runFn(askGateSrc, sb);
    return f();
  };
  note('B3a', mk(() => true, 0) === false && gateRead === 0, '夜间应恒 false 且不读冷却键（被拦当次不推进冷却）');
  note('B3b', mk(() => false, Date.now()) === false, '白天＋冷却期内应 false（原频率闸语义保持）');
  note('B3c', mk(() => false, 0) === true, '白天＋无冷却应 true（原语义保持）');
} else note('B3a', false, 'interactGateOk 函数体提取失败');

// ================= 汇总 =================
const total = failures.length;
if (EXPECT === 'red') {
  console.log('[red-mode] 红 ' + total + ' 项｜存活(绿) ' + passed.length + ' 项');
  console.log(failures.map((f) => '  RED ' + f).join('\n'));
  console.log('存活项（在纯 HEAD 上就已成立＝非本批引入，avatar-lib #876e 属已知在位）：' + passed.join(', '));
  process.exit(0);
}
if (total) {
  console.log('❌ verify-night-mode-silence ' + total + ' 项失败：\n' + failures.map((f) => '  · ' + f).join('\n'));
  process.exit(1);
}
console.log('✅ verify-night-mode-silence 全绿（' + passed.length + ' 断言：S 源码锚 + B 行为对照对）');
