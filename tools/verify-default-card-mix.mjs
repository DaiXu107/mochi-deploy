// ===== 专项验证：#157 默认字卡三连修（小米15Pro+Chrome 等安卓多机型反馈） =====
// 用法：node tools/verify-default-card-mix.mjs
// 纯文本断言（对 src 与构建产物各验一遍）：
//   1) 聊天 getPool / 群聊 gcPool：默认主字卡只在自定义 text 池为空时兜底并入
//      （原实现无条件全量并入 4600+ 张 → dc-overall 概率对池子无效，5% 形同虚设）；
//   2) 经期温柔前缀/动作（periodWarmText）：随默认字卡总开关 + 聊天使用场景开关停用
//      （原实现只认逐张开关，总开关关了聊天里仍偶发前缀/动作字卡）；
//   3) sw.js：导航请求缓存优先（navCached）+ index 专属长超时（30s）接入
//      install 预缓存 / activate 补拉 / PRECACHE_NOW / 后台静默刷新四处。
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n); } };

const chat = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
const gc = readFileSync(join(root, 'src/js/group-chat.js'), 'utf8');
const period = readFileSync(join(root, 'src/js/period.js'), 'utf8');
const swPath = join(root, 'src/pwa/sw.js');
const sw = existsSync(swPath) ? readFileSync(swPath, 'utf8') : '';

// 1) 主字卡兜底语义（有自定义不并入，概率混入交给 drawCards/getDefaultCardsFor）
t('chat.js getPool 主字卡只在自定义 text 池无可读句子卡时并入（#157 门，经 #531 放宽）', chat.includes("if (catOn('main') && !chatHasReadableTextCard(text)) {"));
t('group-chat.js gcPool 主字卡只在自定义 text 池为空时并入', gc.includes("if (catOn('main') && text.length === 0) {"));
t('chat.js 概率混入路径 drawCards 仍在', chat.includes('window.getDefaultCards && window.getDefaultCards()'));
t('group-chat.js 概率混入路径 getDefaultCardsFor 仍在', gc.includes('window.getDefaultCardsFor'));
// 1.5) #163：主动消息 / 群聊文本回复也要吃默认字卡概率（原两路径从不混默认，
//      dc-overall 调到 80-90% 联系人仍总发用户自定义字卡、反复出现）
t('#163 主动消息先掷默认字卡概率（命中非拍一拍即用默认卡）', chat.includes("if (defs && defs.type !== 'poke' && defs.text) return { text: defs.text, type: 'text' };"));
t('#163 群聊文本回复按成员桌面混默认字卡', gc.includes("if (defs && defs.type === 'text' && defs.text) t = defs.text;"));

// 2) 经期温柔前缀/动作随总开关/聊天使用停用
const gateIdx = period.indexOf('if (_dcfg.enabled === false) return text;');
const useIdx = period.indexOf("if (window.defaultCardUse && !window.defaultCardUse('chat')) return text;");
const rollIdx = period.indexOf('if (Math.random() * 100 >= 25) return text;');
t('period.js warmText 总开关门控', gateIdx > -1);
t('period.js warmText 聊天使用门控', useIdx > gateIdx && useIdx > -1);
t('period.js warmText 门控先于 25% 概率掷点', gateIdx > -1 && rollIdx > useIdx);

// 3) sw.js 导航缓存优先 + index 长超时四处接入
if (sw) {
  t('sw.js 导航缓存优先 navCached 在位', sw.includes('const navCached = req.mode === \'navigate\''));
  t('sw.js 后台静默刷新走长超时', /navCached[\s\S]{0,900}fetchWithTimeout\(req, INDEX_NETWORK_TIMEOUT\)/.test(sw));
  t('sw.js install 预缓存 index 走长超时', sw.includes('isIndexUrl(url) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT'));
  t('sw.js activate 补拉 index 走长超时', sw.includes("fetchWithTimeout('./index.html', INDEX_NETWORK_TIMEOUT)"));
  t('sw.js PRECACHE_NOW index 走长超时', sw.includes('isIndexUrl(u) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT'));
  t('sw.js 缓存命中带 content-type 守卫', /navCached[\s\S]{0,600}content-type/.test(sw));
} else {
  console.log('SKIP src/pwa/sw.js 不存在');
}

// 4) 产物核对（已构建时）
const idxPath = join(root, 'index.html');
if (existsSync(idxPath)) {
  const idx = readFileSync(idxPath, 'utf8');
  t('[产物] gcPool 主字卡兜底语义在位', idx.includes("if (catOn('main') && text.length === 0) {"));
  t('[产物] period warmText 总开关门控在位', idx.includes('if (_dcfg.enabled === false) return text;'));
} else {
  console.log('SKIP index.html 不存在（未构建）');
}

console.log(pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;
