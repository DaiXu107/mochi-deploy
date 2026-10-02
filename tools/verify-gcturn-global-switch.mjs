// ===== 回归脚本：群聊「连发的算一轮」是全局那一枚（#1376h/#1376i）=====
// 用法：node tools/verify-gcturn-global-switch.mjs [--root <目录>]
//
// 立项原因（2026-09-29）：作者实测「换成 nova 式并轮后，群聊会不会并轮跟着你最后用的那位联系人变」
//   ⇒ 落地把这一枚从「按联系人存的 turn-en」改成「群聊自己的全局 gc-turn-en」（群聊设置本来就全局，
//   gcRead/gcWrite 走 xyStore('xy-home-v2')）。当天这族代码还差点被一次「旧底构建」整块冲掉
//   （产物里 gc-turn-en 归零），而站内**没有任何尺子钉它**——所以补这一把。
//
// 判据纪律：不靠「符号出现过几次」，而是①按函数体定位读取的是哪一枚键；②把 gcRead/gcWrite 抽进 vm
//   真跑，注入全局存储与 per-cid 存储两只桩，断言写的是全局那只、per-cid 那只一次都没被碰；
//   ③删除型：全站任何把 gc-turn-en 写进带 cid 命名空间的行都不许存在。
//   反向对照：把 gcTurnOn 改成读 'turn-en' 的副本必须红在 G1，改回来 sha256 复原。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const argv = process.argv.slice(2);
const ri = argv.indexOf('--root');
const root = ri >= 0 && argv[ri + 1] ? argv[ri + 1] : 'C:/Users/Administrator/Desktop/mochi';
const rd = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return null; } };
let pass = 0, fail = 0;
const ok = (n, c, r) => { if (c) { pass++; console.log('PASS  ' + n + (r ? '   ' + JSON.stringify(r) : '')); } else { fail++; console.log('FAIL  ' + n + (r ? '   ' + JSON.stringify(r) : '')); } };

const GC = 'src/js/group-chat.js', RS = 'src/js/reply-settings.js', TP = 'src/template.html', BM = 'build.mjs';
const gc = rd(GC), rs = rd(TP === '' ? '' : RS), tpl = rd(TP), bm = rd(BM);
if (gc === null || rs === null) { console.log('FAIL  取不到 group-chat.js / reply-settings.js（--root 给对了吗）'); console.log('\n结果：0/1 项通过'); process.exit(1); }

/* 抽出某个 function 的源码体（按大括号配平，字符串/注释感知从简：站内这几处函数体里没有嵌套同名干扰） */
function fnBody(text, name) {
  const at = text.indexOf('function ' + name);
  if (at < 0) return null;
  const open = text.indexOf('{', at);
  let depth = 0, q = null, esc = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.slice(at, i + 1); }
  }
  return null;
}

/* G1：群聊的闸门只认 gc-turn-en，不许再读按联系人存的 turn-en */
const onBody = fnBody(gc, 'gcTurnOn') || '';
const readsGlobal = onBody.indexOf("['gc-turn-en']") >= 0;
const readsPerCid = /["']turn-en["']/.test(onBody.replace(/["']gc-turn-en["']/g, '@'));
ok('G1 gcTurnOn 读的是全局那一枚、不再读单聊那枚', readsGlobal && !readsPerCid, { 函数体: onBody.replace(/\s+/g, ' ').slice(0, 120) });

/* G2：把 gcRead/gcWrite 抽进 vm 真跑。站内 ls = window.activeStore() 是**按联系人**那一只，
   所以这一族真正的不变量是三条：写只落全局、读优先全局（per-cid 那份旧值不许赢）、
   全局没值才回退旧数据。三条全部用桩量，不靠读注释。 */
const readFn = fnBody(rs, 'gcRead'), writeFn = fnBody(rs, 'gcWrite');
let vmRes = {}, vmErr = '';
try {
  const code = [
    'var touchedGlobal = [], touchedPerCid = [];',
    'window = { xyStore: function (ns) { return { get: function (k) { touchedGlobal.push("get:" + ns + "/" + k); return GSTORE[ns + ":" + k]; }, set: function (k, v) { touchedGlobal.push("set:" + ns + "/" + k); GSTORE[ns + ":" + k] = String(v); } }; }, activeStore: function () { return { get: function (k) { touchedPerCid.push("get:" + k); return PCID[k]; }, set: function (k, v) { touchedPerCid.push("set:" + k); PCID[k] = String(v); } }; } };',
    'var ls = { get: function (k) { return PCID[k]; }, set: function (k, v) { touchedPerCid.push("set:" + k); PCID[k] = String(v); } };',
    readFn, writeFn,
    // 场景一：全局＝1、per-cid 旧数据＝0 ⇒ 必须取全局（这一枚不再随联系人漂）
    'GSTORE["xy-home-v2:reply-gc-turn-en"] = "1"; PCID["reply-gc-turn-en"] = "0";',
    'var winGlobal = gcRead("turn-en");',
    // 场景二：全局没写、只有旧数据 ⇒ 回退兼容仍在
    'delete GSTORE["xy-home-v2:reply-gc-turn-en"];',
    'var fallback = gcRead("turn-en");',
    // 场景三：写一次，看落到哪只、有没有污染 per-cid
    'touchedGlobal.length = 0; touchedPerCid.length = 0;',
    'gcWrite("turn-en", 1);',
    'OUT = { winGlobal: winGlobal, fallback: fallback, tg: touchedGlobal.slice(), tp: touchedPerCid.slice(), globalNow: GSTORE["xy-home-v2:reply-gc-turn-en"], perCidNow: PCID["reply-gc-turn-en"] };',
  ].join('\n');
  const ctx = { GSTORE: {}, PCID: {}, OUT: null };
  runInNewContext(code, ctx);
  vmRes = ctx.OUT || {};
} catch (e) { vmErr = String(e.message).slice(0, 120); }
ok('G2a 全局有值时读的就是全局（per-cid 那份旧值不赢＝不随联系人漂）', vmRes.winGlobal === '1', { 读数: vmRes.winGlobal, 报错: vmErr });
ok('G2b 全局没写过时回退旧数据（兼容老存档，行为与 #1376 前一致）', vmRes.fallback === '0', { 读数: vmRes.fallback });
ok('G2c 写只落全局命名空间，一次都没写按联系人那只', vmRes.tg && vmRes.tg.length === 1 && vmRes.tg[0] === 'set:xy-home-v2/reply-gc-turn-en' && (vmRes.tp || []).length === 0 && vmRes.globalNow === '1', { 全局: vmRes.tg, per_cid: vmRes.tp });

/* G3：删除型——站内任何把 gc-turn-en 写进带 cid 命名空间的行都不许存在 */
const all = { 'group-chat.js': gc, 'reply-settings.js': rs, 'chat.js': rd('src/js/chat.js') || '', 'personalize.js': rd('src/js/personalize.js') || '' };
const cidLeak = [];
Object.keys(all).forEach(f => all[f].split('\n').forEach((l, i) => { if (l.indexOf('gc-turn-en') >= 0 && /activeStore|activePrefix/.test(l)) cidLeak.push(f + ':' + (i + 1)); }));
ok('G3 删除型：gc-turn-en 没有任何一处挂到按联系人命名空间上', cidLeak.length === 0, { 疑似: cidLeak.slice(0, 4) });

/* G4：界面上那一枚存在且接得上（模板里一行开关 ＋ 设置页至少一条读写接线） */
const tplHit = tpl ? (tpl.indexOf('id="gc-turn-en"') >= 0) : false;
const wired = rs.split('\n').filter(l => l.indexOf('gc-turn-en') >= 0).length;
ok('G4 设置页那一行开关在模板里、且在 reply-settings.js 有 ' + wired + ' 处接线', tplHit && wired >= 2, { 模板: tplHit, 接线行数: wired });

/* G5：登记表里两根针在位（今天这族差点被旧底构建冲掉，针是最后一道名册） */
const pins = bm ? ['1376h', '1376i'].filter(x => bm.indexOf("#" + x) >= 0) : [];
ok('G5 登记表含 #1376h/#1376i 两根针', pins.length === 2, { 在位: pins });

console.log('\n结果：' + pass + '/' + (pass + fail) + ' 项通过   （被测：' + root + '）');
process.exit(fail ? 1 : 0);
