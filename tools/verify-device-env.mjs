// verify-device-env：设备判定收口第二批行为断言（env 能力层 + 唯一判定源）
// 背景：chat.js 语音 WebView 大正则 / data-backup.js brokenFileShare /
// music-player.js apiBlockedHint ×2 / bg-keep.js notifyQuirk 此前各拼一套 UA 正则
// （同一批浏览器名单 4 个文件各写一遍）；bg-keep kaIsIOS / idb armFgIdbReset 又各
// 复刻一份 iOS 判定（含 iPadOS Macintosh 伪装分支）。收口到 device.js
// mochiDevice.env + mochiDevice.isIOS 后，本脚本断言：
//   A. env 表达式行为（抽真实源码求值，不是复刻）：安卓壳/微信→WebView=true、
//      标准 Chrome→false、华为/夸克→brokenFileShare、QQ/夸克→apiBlockedHint、
//      安卓任意→notifyQuirk、iOS→notifyQuirk=false；空 UA 保守 true；
//      mochiDevice 对象带 env 键（漏接线=业务文件读 undefined 恒 false）。
//   B. 消费端收口：4 个文件的业务代码不再含 UA 正则（残留=第二份实现回来了），
//      且都在读 env 对应字段；bg-keep kaIsIOS 读 mochiDevice.isIOS；
//      idb gate 消费 isIOS（伪装 iPad 仍回前台重建 IDB 的载体）。
//   C. kaIsIOS 薄壳行为：注入 mochiDevice 桩求值，iOS UA→true / 安卓 UA→false。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, 'src', 'js', p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' —— ' + detail : '')); }
};

const device = read('device.js');
const bg = read('bg-keep.js');
const idb = read('idb.js');
const chat = read('chat.js');
const backup = read('data-backup.js');
const music = read('music-player.js');

// ---- A. env 表达式行为：抽 device.js 真实 env 求值 ----
console.log('[A] device.js env 真实求值');
const mEnv = device.match(/const _envUa = [\s\S]*?const env = \{[\s\S]*?\n  \};/);
ok('env 对象可定位（含 _envUa 声明）', !!mEnv);
if (mEnv) {
  const evalEnv = (ua) => {
    const fn = new Function('navigator', mEnv[0] + '\nreturn env;');
    return fn({ userAgent: ua });
  };
  const CHAT_UA = 'Mozilla/5.0 (Linux; U; Android 14; zh-cn) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120 Mobile Safari/537.36 MicroMessenger/8.0.49';
  const SAMSUNG_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S9210) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121 Mobile Safari/537.36';
  const CHROME_UA = 'Mozilla/5.0 (Linux; Android 14; 2210132C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36';
  const HUAWEI_UA = 'Mozilla/5.0 (Linux; Android 10; Mate 20) AppleWebKit/537.36 (KHTML, like Gecko) HuaweiBrowser/14.0.5 Mobile Safari/537.36';
  const QUARK_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36 Quark/7.0.0';
  const QQ_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 QQBrowser/6.2';
  const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1';

  let e = evalEnv(CHAT_UA);
  ok('微信 UA → isAndroidWebView=true（wv 类壳走 mp4/aac）', e.isAndroidWebView === true);
  e = evalEnv(SAMSUNG_UA);
  ok('三星浏览器 UA → isAndroidWebView=true（大正则原名单内）', e.isAndroidWebView === true);
  e = evalEnv(CHROME_UA);
  ok('标准安卓 Chrome → isAndroidWebView=false（webm/opus 优先不回归）', e.isAndroidWebView === false);
  ok('标准安卓 Chrome → notifyQuirk=true（安卓通知提示保留）', e.notifyQuirk === true);
  ok('标准安卓 Chrome → brokenFileShare=false（分享面板照常）', e.brokenFileShare === false);
  e = evalEnv(HUAWEI_UA);
  ok('华为浏览器 → brokenFileShare=true（跳过分享面板）', e.brokenFileShare === true);
  e = evalEnv(QUARK_UA);
  ok('夸克 → brokenFileShare=true', e.brokenFileShare === true);
  ok('夸克 → apiBlockedHint=true', e.apiBlockedHint === true);
  e = evalEnv(QQ_UA);
  ok('QQ 浏览器 → apiBlockedHint=true', e.apiBlockedHint === true);
  ok('QQ 浏览器 → brokenFileShare=false（原名单就只杀华为/夸克，不得扩大）', e.brokenFileShare === false);
  e = evalEnv(IOS_UA);
  ok('iOS Safari → notifyQuirk=false（小米提示不污染 iOS）', e.notifyQuirk === false);
  e = evalEnv('');
  ok('空 UA → isAndroidWebView=true（拿不到 UA 保守按 WebView，原语义）', e.isAndroidWebView === true);

  // mochiDevice 接线：env 键必须挂进唯一判定源对象
  ok('mochiDevice 对象含 env 键（漏接线=消费端恒 false）', /window\.mochiDevice = \{[\s\S]*?env: env[\s\S]*?\};/.test(device));
}

// ---- B. 消费端收口：UA 正则清零 + env 消费接线 ----
console.log('[B] 消费端收口');
const mdRe = (s) => '(window.mochiDevice || {}).env || {}';
ok('chat.js isAndroidWebView 改读 env.isAndroidWebView',
  /return !!\(\(window\.mochiDevice \|\| \{\}\)\.env \|\| \{\}\)\.isAndroidWebView;/.test(chat),
  '消费表达式缺失');
ok('chat.js 旧 WebView 大正则已删（残留=第二份实现回归）', !/MicroMessenger[\s\S]{0,200}OBABROWSER/.test(chat));
ok('data-backup.js 改读 env.brokenFileShare', /const brokenFileShare = !!\(\(window\.mochiDevice \|\| \{\}\)\.env \|\| \{\}\)\.brokenFileShare;/.test(backup));
ok('data-backup.js 旧 /huaweibrowser|quark/ 正则已删', !/huaweibrowser\|quark/.test(backup));
ok('music-player.js 两处 apiBlockedHint 均接线',
  (music.match(/apiBlockedHint/g) || []).length >= 2 && !/QQBrowser\/i\.test\(ua\)/.test(music));
ok('bg-keep.js 通知提示改读 env.notifyQuirk',
  /_mdN\.notifyQuirk/.test(bg) && !/miui\|xiaomi\|redmi\|hyperos/i.test(bg));
ok('bg-keep.js kaIsIOS 读 mochiDevice.isIOS（薄壳保留）',
  /function kaIsIOS\(\) \{\s*try \{ return !!\(window\.mochiDevice \|\| \{\}\)\.isIOS;/.test(bg));
ok('idb.js gate 消费 mochiDevice.isIOS（#144 载体，伪装 iPad 仍重建）',
  /if \(!\(\(window\.mochiDevice \|\| \{\}\)\.isIOS\)\) return;/.test(idb));
ok('idb.js 旧 touchMac 复刻实现已删', !/const touchMac =/.test(idb));

// ---- C. kaIsIOS 薄壳行为（抽真实源码 + window 桩求值）----
console.log('[C] kaIsIOS 行为');
const mKa = bg.match(/function kaIsIOS\(\) \{[\s\S]*?\n  \}/);
ok('kaIsIOS 函数体可抽取', !!mKa);
if (mKa) {
  const runKa = (isIOS) => new Function('window',
    mKa[0] + '\nreturn kaIsIOS();')({ mochiDevice: { isIOS } });
  ok('mochiDevice.isIOS=true → kaIsIOS=true（iOS 幅度 0.002 链路）', runKa(true) === true);
  ok('mochiDevice.isIOS=false → kaIsIOS=false（安卓 18kHz 链路）', runKa(false) === false);
  try {
    const rNoWin = new Function('window', mKa[0] + '\nreturn kaIsIOS();')(undefined);
    ok('window 缺失不抛（catch 兜底返回 false 走安卓分支）', rNoWin === false, '返回 ' + rNoWin);
  } catch (err) {
    ok('window 缺失不抛（catch 兜底返回 false 走安卓分支）', false, '抛错: ' + err.message);
  }
}

console.log('RESULT ' + (fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
