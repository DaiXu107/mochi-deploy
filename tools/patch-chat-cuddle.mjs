// Patch src/js/chat.js (recovered base): re-add cuddle invite feature
import { readFileSync, writeFileSync } from 'node:fs';
const p = 'src/js/chat.js';
let t = readFileSync(p, 'utf8');
function must(cond, desc) { if (!cond) { console.error('FAIL ' + desc); process.exit(1); } console.log('OK ' + desc); }

must(!t.includes('CUDDLE_REPLIES'), 'cuddle not yet present');

// 1) openInviteConfirm declinePool
must(t.split('function openInviteConfirm(title, staticText, onAccept) {').length === 2, 'inviteConfirm sig found once');
t = t.replace('function openInviteConfirm(title, staticText, onAccept) {',
  "function openInviteConfirm(title, staticText, onAccept, declinePool) {");
t = t.replace('else addOut(pick(INVITE_DECLINE));',
  'else addOut(pick(declinePool || INVITE_DECLINE));');
must(t.includes('declinePool || INVITE_DECLINE'), 'declinePool wired');

// 2) cuddle consts after INVITE_DECLINE
const m = t.match(/const INVITE_DECLINE = \[[^\]]*\];/);
must(m, 'INVITE_DECLINE found');
const cuddleConsts = "\n" +
  "// v3.14.x：贴贴邀请（cuddle）——正常情侣贴贴互动（贴/抱/牵手/靠着），没有游戏半框：\n" +
  "// 同意后轻震动一下（体感反馈），TA 稍后回应一句贴贴的话；婉拒用专属文案\n" +
  "const CUDDLE_DECLINE = ['下次再贴吧，先记着这笔~', '等会儿补给你，说话算数', '先欠着，攒到晚上一起还~', '今天想先自己待会儿，明天加倍还你'];\n" +
  "const CUDDLE_REPLIES = ['嗯……蹭到了。暖暖的，很喜欢。', '那我要贴很久哦，不许偷偷跑掉。', '手被握住了，就这样待一会儿。', '感觉到了，你在旁边。很安心。', '贴贴充电中……好，满格了。'];";
t = t.replace(m[0], m[0] + cuddleConsts);
must(t.includes('CUDDLE_REPLIES'), 'cuddle consts added');

// 3) KIND_META cuddle entry
must(t.includes("snake: { title: '游戏邀请' }\n};"), 'KIND_META tail found');
t = t.replace("snake: { title: '游戏邀请' }\n};",
  "snake: { title: '游戏邀请' },\ncuddle: { title: '贴贴邀请' }\n};");

// 4) openInvitePanelFor(kind, name) + cuddle branch
t = t.replace('function openInvitePanelFor(kind) {',
  "function openInvitePanelFor(kind, name) {\nif (kind === 'cuddle') {\ntry { if (navigator.vibrate) navigator.vibrate([30, 60, 90]); } catch (e) {}\nsetTimeout(() => { try { addIn(name + ' ' + pick(CUDDLE_REPLIES), { initiative: true }); } catch (e) {} }, randInt(600, 1200));\nreturn;\n}");
must(t.includes("openInvitePanelFor(kind, name)"), 'panelFor cuddle branch');

// 5) sendTaInvite passes name + declinePool
must(t.includes("() => openInvitePanelFor(inv.kind));"), 'sendTaInvite call found');
t = t.replace("() => openInvitePanelFor(inv.kind));",
  "() => openInvitePanelFor(inv.kind, name), inv.kind === 'cuddle' ? CUDDLE_DECLINE : null);");
must(t.includes("CUDDLE_DECLINE : null"), 'sendTaInvite patched');

writeFileSync(p, t, 'utf8');
console.log('bytes=' + Buffer.byteLength(t));
