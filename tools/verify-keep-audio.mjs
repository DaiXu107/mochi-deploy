// verify-keep-audio：后台保活音频「听感无害 + 保活有效」行为断言（#207）
// 背景：保活音频四代演进——v3.15.x iPhone 报「嘟嘟嘟」→ iOS 幅度 0.002；#190 OPPO Find X9
// 报「底噪/电流声」→ 安卓幅度 0.006；#207 OPPO R15 自带浏览器等多机型仍报电流声 →
// 安卓频率 220Hz → 18000Hz；#260 vivo X200s Edge 152 报「后台保活失败」→ 安卓幅度
// 0.006 恢复 0.02（底噪根因在 220Hz 频率不在幅度；0.0003 电平距 audible 线仅 20% 余量，
// 内核收紧判定即丢冻结豁免）。同族已四连报，按 BUGS 规则配行为断言防「名字保留逻辑改坏」。
// 方法：从 src/js/bg-keep.js 抽取真实的 kaIsIOS/ensureKeepAudioDataUrl 函数体在 Node 内
// 执行（不是复刻实现），解码 WAV dataURL 后断言：
//   保活有效侧（动不得）：样本非零、数字电平 amp×volume 高于 Chromium audible 量级、
//                         loop=true、volume=0.05 未被顺手改掉；
//   听感无害侧（改就要改对）：安卓 18kHz / iOS 220Hz、幅度 0.006/0.002、循环接缝整周期
//                         无相位跳变（无咔哒声）、频率低于奈奎斯特留抗混叠余量。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src', 'js', 'bg-keep.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' —— ' + detail : '')); }
};

// ---- 抽取真实源码（函数级两空格闭合，函数体内无同缩进闭合行，失配即 fail）----
function grab(re, label) {
  const m = re.exec(src);
  ok('抽取 ' + label + ' 函数体', !!m && typeof m[0] === 'string' && m[0].length > 50);
  return m ? m[0] : '';
}
const kaIsIOS = grab(/function kaIsIOS\(\) \{[\s\S]*?\n  \}/, 'kaIsIOS');
const ensure = grab(/function ensureKeepAudioDataUrl\(\) \{[\s\S]*?\n  \}/, 'ensureKeepAudioDataUrl');

// 执行环境：stub navigator.userAgent；KEEP_AUDIO_DATAURL/btoa 由壳注入
// 收口第二批：kaIsIOS 改读 window.mochiDevice.isIOS（device.js 唯一判定源），
// 抽取的函数体需要 window 桩——按传入 UA 换算出期望 isIOS 注入，同时验证
// 「UA→isIOS→幅度/频率」链路未被抽断。
function iosOf(ua) {
  return (/iphone|ipad|ipod/i.test(ua) && !/android/i.test(ua)) ||
    (/Macintosh/i.test(ua) && 5 > 1); // 抽取壳无 maxTouchPoints，Macintosh 分支按触摸屏真值（iOS 设备）模拟
}
function genFor(ua) {
  const isIOS = iosOf(ua);
  const body =
    'let KEEP_AUDIO_DATAURL = "";\n' +
    'const btoa = (s) => Buffer.from(s, "binary").toString("base64");\n' +
    'const window = { mochiDevice: { isIOS: ' + isIOS + ' } };\n' +
    kaIsIOS + '\n' + ensure + '\n' +
    'return ensureKeepAudioDataUrl();';
  const fn = new Function('navigator', body);
  const dataUrl = fn({ userAgent: ua });
  ok('生成 WAV dataURL（UA=' + ua.slice(0, 40) + '…，isIOS=' + isIOS + '）', typeof dataUrl === 'string' && dataUrl.startsWith('data:audio/wav;base64,'));
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Buffer.from(b64, 'base64');
}

// ---- WAV 解码（生成代码写死 44 字节头 + PCM16 单声道）----
function parseWav(buf) {
  const headerOk = buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE' &&
    buf.toString('ascii', 12, 16) === 'fmt ' && buf.toString('ascii', 36, 40) === 'data';
  const sr = buf.readUInt32LE(24), bits = buf.readUInt16LE(34), ch = buf.readUInt16LE(22);
  const n = buf.readUInt32LE(40) / 2;
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) s[i] = buf.readInt16LE(44 + i * 2);
  return { headerOk, sr, bits, ch, n, s };
}
// 过零估频 + 峰值幅度
function analyze(s, sr) {
  let cross = 0, peak = 0;
  for (let i = 1; i < s.length; i++) {
    if ((s[i - 1] < 0 && s[i] >= 0) || (s[i - 1] >= 0 && s[i] < 0)) cross++;
    const a = Math.abs(s[i]); if (a > peak) peak = a;
  }
  return { freq: cross / 2 / (s.length / sr), peakAmp: peak / 32767, cross };
}

const ANDROID_UA = 'Mozilla/5.0 (Linux; U; Android 10; zh-cn; PACT00 Build/QP1A.190711.020) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/115.0.5790.168 Mobile Safari/537.36 HeyTapBrowser/40.10.21.1';
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1';

console.log('【安卓路径】（OPPO R15 HeyTapBrowser 真实 UA）');
{
  const w = parseWav(genFor(ANDROID_UA));
  ok('WAV 头合法（RIFF/WAVE/fmt/data）', w.headerOk);
  ok('采样率 44100 / PCM16 / 单声道', w.sr === 44100 && w.bits === 16 && w.ch === 1, 'sr=' + w.sr + ' bits=' + w.bits + ' ch=' + w.ch);
  const a = analyze(w.s, w.sr);
  ok('频率 = 18000Hz（±5，#207 安卓换频锚点）', Math.abs(a.freq - 18000) <= 5, '估频 ' + a.freq.toFixed(1) + 'Hz');
  // 循环无缝的直接验证：18000×1s=整周期 ⇒ 第 n 个样本（下一循环第 0 个）与 s[0] 相同。
  // 用生成代码同款公式算延续相位参考值，与实测样本比对（差 ≤2 LSB）
  ok('循环接缝相位连续（s[n+i] ≡ s[i]，整周期无接缝咔哒）', (() => {
    for (let i = 0; i < 8; i++) {
      const ref = Math.round(Math.sin(2 * Math.PI * 18000 * ((w.s.length + i) / w.sr)) * 0.02 * 32767);
      if (Math.abs(ref - w.s[i]) > 2) return false;
    }
    return true;
  })());
  ok('首样本 = 0（sin(0)，循环起点干净）', w.s[0] === 0, 's[0]=' + w.s[0]);
  ok('峰值幅度 ≈ 0.02（#260 恢复值，#190 降幅语义已由 18kHz 频率承接）', Math.abs(a.peakAmp - 0.02) < 0.0005, 'peak=' + a.peakAmp.toFixed(5));
  // #724：基础档音量 0.05→KA_VOL_BASE=0.2（新内核 audible 判定再收紧＝K80「挂后台回来被刷新」
  // 实报的电平余量加固）；amp×volume=0.004（-48dBFS），18kHz 频率继续扛物理不可闻
  ok('数字电平 amp×volume=0.004 > 0.00025（16 倍余量：#724 KA_VOL_BASE 分级，跌破即后台冻结=保活失效）', a.peakAmp * 0.2 > 0.00025, (a.peakAmp * 0.2).toFixed(6));
  // 零样本只出现在波形过零附近（占比由幅度决定：安卓 ≈2%、iOS ≈0.5%，220Hz 旧版时代即如此）。
  // 本断言防的是「全零/大面积零=数字静音」形态，不是零样本归零
  ok('非零样本比例 > 95%（防「全零=数字静音」形态）', (() => { let nz = 0; for (let i = 0; i < w.s.length; i++) if (w.s[i] !== 0) nz++; return nz / w.s.length; })() > 0.95);
  ok('频率低于奈奎斯特留余量（18000 < 20000 ≤ 44100/2，48k 重采样不落抗混叠滤波带）', a.freq < 20000 && a.freq < w.sr / 2 * 0.95);
}
console.log('【iOS 路径】（#340：iOS 同改 18000Hz@0.002——iOS Safari 忽略 audio.volume，220Hz 实听电平比安卓被投诉值还大=「打开一直嗡鸣」；amp 0.002 防顺手改）');
{
  const w = parseWav(genFor(IOS_UA));
  const a = analyze(w.s, w.sr);
  ok('频率 = 18000Hz（±5，#340 iOS 分支同换频，220Hz 嗡鸣根因不再分支保留）', Math.abs(a.freq - 18000) <= 5, '估频 ' + a.freq.toFixed(1) + 'Hz');
  ok('峰值幅度 ≈ 0.002（iOS 幅度未被顺手改，保活电平语义零变化）', Math.abs(a.peakAmp - 0.002) < 0.0003, 'peak=' + a.peakAmp.toFixed(5));
}
console.log('【#260 双锚与取证】（WebRTC 第二冻结豁免锚 + 后台心跳 + 诊断出口，防「锚点整块被删」）');
{
  ok('WebRTC 回环数据通道仍在（createDataChannel mochi-ka）', src.includes("createDataChannel('mochi-ka')"));
  ok('WebRTC 断线 30s 静默重建仍在', /kaWebrtcTimer = setTimeout/.test(src));
  ok('后台心跳 30s 节拍仍在（setInterval kaHbTick）', /setInterval\(kaHbTick, 30000\)/.test(src));
  ok('心跳写 IDB 根键 __ka-hb 仍在', src.includes("KA_HB_KEY = 'xy-home-v2:__ka-hb'"));
  ok('__kaProbe 诊断出口仍在（「保活现场」数据源）', /window\.__kaProbe = function/.test(src));
  const dev = readFileSync(join(root, 'src', 'js', 'device.js'), 'utf8');
  ok('device.js「保活现场」消费 __kaProbe 仍在', dev.includes("window.__kaProbe === 'function'"));
  ok('device.js 心跳断流判决仍在（>90s=冻结证据）', dev.includes('冻结证据：心跳断流'));
}
console.log('【播放元素】（保活机制载体，防文本级回归）');
{
  ok('<audio> 循环 loop=true 仍在', /keepEl\.loop\s*=\s*true/.test(src));
  // v3.44.x 保活音频可选：自定义音频按 volume=1；#724 起默认静音音频基础档 KA_VOL_BASE=0.2
  //（原 0.05——新内核 audible 判定收紧后豁免丢失＝后台整页冻结/丢弃，K80 实报）。断言锚
  // 「分级常量在位 + 启动/恢复默认两处都吃 KA_VOL_BASE」——近零音量会被 Chrome 无声节流。
  // #1374 重锚（同一把尺，两种坏法照旧都红）：这两支旧写法把「keepEl.volume = 常数」那一行
  //   本身当证据，而 #1374 起音量只有一个写入方（kaSetToneLevel/kaApplyToneVolume），且默认档
  //   在 visible 时被压到 0。尺子改成问同一件事的两种坏法：
  //   ① 0.05/0.2 那一档还在不在（常量＋两处落点都吃 KA_VOL_BASE）；
  //   ② hidden 时它会不会被顺手改成近零/被硬写别的常数（gate 的 hidden 分支必须落 kaToneLevel）。
  ok('#724 分级常量在位（KA_VOL_BASE=0.2 / KA_VOL_MAX=0.35）', /const KA_VOL_BASE = 0\.2, KA_VOL_MAX = 0\.35;/.test(src));
  // #1489 重锚（同一把尺，问的还是「基础档在不在、两个入口都落不落得到」）：#1374a 那两处直写
  //   在 #1489 收进转子构造 kaBuildTransducer（启动传 KA_VOL_BASE、清自定义走 resetBase），
  //   老拓扑与新拓扑任一在位都算合格——两边都不在＝基础档真丢了。两条直写常数一律不许回流。
  ok('#724 基础档在位（老拓扑＝两处 kaSetToneLevel(KA_VOL_BASE)；新拓扑＝启动＋清自定义两个入口传基础档）',
    ((src.match(/kaSetToneLevel\(KA_VOL_BASE\);/g) || []).length === 2 ||
      (/kaSetToneLevel\(level \|\| KA_VOL_BASE\);/.test(src) && /if \(!kaBuildTransducer\(KA_VOL_BASE\)\)/.test(src) && /resetBase \? KA_VOL_BASE : kaToneLevel/.test(src))) &&
    !/keepAudio\.el\.volume = 0\.05;/.test(src) && !/keepEl\.volume = 0\.\d+;/.test(src));
  ok('#724 hidden 档不被顺手调低（唯一落点里 hidden 分支＝kaToneLevel，且不近零）',
    /kaCustomAudio \? 1 : \(kaVisibleNow\(\) \? 0 : kaToneLevel\)/.test(src) &&
    !/kaVisibleNow\(\) \? 0 : 0\.0[0-5]/.test(src));
  ok('媒体会话声明 playing 仍在（audible 豁免另一半）', /playbackState\s*=\s*'playing'/.test(src));
}

console.log('RESULT ' + (fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
