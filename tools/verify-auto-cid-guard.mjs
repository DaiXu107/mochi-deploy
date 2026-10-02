// #187 专属字卡串桌面 行为/结构验证（纯 Node，零浏览器依赖）
// 报障：vivo IQ12+Edge「A 桌面聊天收到 B 桌面的专属字卡」，多机型复现，与设备无关。
// 根因：chat.js tryAutoSend（TA 主动消息）异步链——await ensureReplyCardsReady() 可等数秒
// + 每条消息 setTimeout 再 900~2600ms，全程无 sameCid 守卫（scheduleReply/replyOnce 均有，
// 唯独主动消息漏了）→ B 桌面触发的主动消息在切到 A 桌面后发出，B 池专属卡落进 A 聊天。
// 修复：入口捕获 autoCid + sameAutoCid；await 后放行前拦截；每条 setTimeout 入口拦截。
// 本脚本抽取 tryAutoSend 真实源码跑结构断言：守卫链被改坏立刻红。
// 用法：node tools/verify-auto-cid-guard.mjs
import { readFileSync } from 'node:fs';

const text = readFileSync(new URL('../src/js/chat.js', import.meta.url), 'utf8');
const s = text.indexOf('function tryAutoSend()');
const e = text.indexOf('const chatApp = document.querySelector', s);
if (s < 0 || e < 0 || e <= s) { console.error('抽取失败：找不到 tryAutoSend 源码段'); process.exit(2); }
const src = text.slice(s, e);

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } };

ok(src.includes("const autoCid = window.__activeCid || 'default';"), '入口捕获 autoCid');
ok(src.includes("const sameAutoCid = () => (window.__activeCid || 'default') === autoCid;"), 'sameAutoCid 绑定入口 cid');
ok(/await ensureReplyCardsReady\(\);[\s\S]{0,120}if \(!sameAutoCid\(\)\) return;/.test(src), 'await 取回完成后放行前拦截（池子仍是旧桌面时整条放弃）');
ok(/const pool = getPool\(\);/.test(src) && src.indexOf('if (!sameAutoCid()) return; // FIX #187 取回期间已切桌面') < src.indexOf('const pool = getPool();'), 'pool 构建在守卫之后');

// 消息定时器逐层拦截：主动消息主 setTimeout、rc-prob 撤回重发链、尾部副作用定时器
const timers = src.split('setTimeout(').length - 1;
ok(timers >= 4, '消息/副作用定时器存在（' + timers + ' 个）');
const guardedTimers = (src.match(/setTimeout\(\(\) => \{\s*if \(!sameAutoCid\(\)\) return;/g) || []).length
  + (src.match(/setTimeout\(\(\) => \{ if \(!sameAutoCid\(\)\) return;/g) || []).length;
ok(guardedTimers >= 4, '每个 setTimeout 入口有 sameAutoCid 拦截（守卫 ' + guardedTimers + '/' + timers + '）');
ok((src.match(/if \(!sameAutoCid\(\)\) return;/g) || []).length >= 5, '守卫总数 ≥5（await 后 1 + 定时器 ≥4）');

// 对齐同类修复：scheduleReply/replyOnce 的守卫仍在（防有人「顺手统一」删掉老守卫）
ok(text.includes('const sameCid = () => (window.__activeCid || \'default\') === myCid;'), 'scheduleReply/replyOnce 既有 sameCid 守卫未被动');

console.log(fail ? 'verify-auto-cid-guard：' + fail + ' 断言失败' : 'verify-auto-cid-guard：' + pass + '/' + (pass + fail) + ' 全过');
process.exit(fail ? 1 : 0);
