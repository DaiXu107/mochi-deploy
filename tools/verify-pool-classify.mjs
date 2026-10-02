// ===== 专项验证：#531 自定义字卡池分类修正（颜文字/符号卡占满文字池 → 联系人只发颜文字）=====
// 用法：node tools/verify-pool-classify.mjs
// 背景（用户报，iPhone 16 Pro/iOS26 Safari 等，明说其他设备型号也有）：「联系人发送的消息和信
//   都是连续发颜表情、无法使用其他字卡；我有添加自定义字卡，系统预设字卡的 2 级密码也已解锁」。
//   诊断池 text=8/kaomoji=3/emoji=7、总档=100：用户的自定义「文字」卡其实是颜文字/符号（无括号、
//   或 BMP 符号 emoji），旧内联正则把它们归进 text 池 → ①聊天/信件正文＝这些符号卡（联系人只发
//   颜文字）②#157 的默认主字卡兜底门 `!text.length` 被非空符号池挡住 → 系统预设中文句子卡进不了
//   池，只剩 dc-overall 那点混入。
// 断言：
//   A 段 分类器（从 src/js/chat.js 提取真实函数体执行）：汉字/字母/数字＝text；带括号与无括号
//        颜文字＝kaomoji；astral 与 BMP 符号 emoji（含 ⭐）＝emoji；中文+emoji 卡仍是 text。
//   B 段 接线：getPool 分类走新判定、兜底门放宽为「无可读句子卡」、主动消息按可用分类归一化权重。
//   C 段 信件：mail.js 自定义文字池可读性判定 + 无括号颜文字归 kaomoji。
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const read = (f) => readFileSync(join(root, f), 'utf8');

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n); } };

const chat = read('src/js/chat.js');
const mail = read('src/js/mail.js');

/* ---------- A 段：分类器真实函数体 ---------- */
let chatIsEmojiCard = null, chatIsKaomojiCard = null, chatHasReadableTextCard = null;
try {
  const start = chat.indexOf('const CHAT_READABLE_RE');
  const end = chat.indexOf('function getPool()');
  const factory = new Function(chat.slice(start, end) +
    '\nreturn { chatIsEmojiCard: chatIsEmojiCard, chatIsKaomojiCard: chatIsKaomojiCard, chatHasReadableTextCard: chatHasReadableTextCard };');
  const api = factory();
  chatIsEmojiCard = api.chatIsEmojiCard;
  chatIsKaomojiCard = api.chatIsKaomojiCard;
  chatHasReadableTextCard = api.chatHasReadableTextCard;
} catch (e) {
  console.log('FAIL  提取 chat.js 分类器失败：' + e.message);
}
const kind = (c) => !chatIsEmojiCard ? 'ERR' : (chatIsEmojiCard(c) ? 'emoji' : (chatIsKaomojiCard(c) ? 'kaomoji' : 'text'));
const cases = [
  ['今天也要开心呀', 'text'], ['晚安～', 'text'], ['2333', 'text'], ['Good morning', 'text'],
  ['(￣▽￣)', 'kaomoji'], ['(*´▽`*)', 'kaomoji'], ['▽・ω・▽', 'kaomoji'], ['｡◕‿◕｡', 'kaomoji'],
  ['๑•́ ₃ •̀๑', 'kaomoji'], ['(◕ω◕✿)', 'kaomoji'], ['好(＾▽＾)', 'kaomoji'],
  ['😀😀', 'emoji'], ['☺️', 'emoji'], ['⭐', 'emoji'], ['☀️', 'emoji'], ['✨', 'emoji'], ['☕', 'emoji'],
  ['晚饭吃了♥', 'text'], ['晚安🌙', 'emoji']
];
for (const [c, want] of cases) t('A 分类 ' + JSON.stringify(c) + ' → ' + want, kind(c) === want);
t('A 文字池含中文＝可读', chatHasReadableTextCard ? chatHasReadableTextCard(['今天也要开心呀', '(￣▽￣)']) === true : false);
t('A 文字池全是颜文字/符号＝不可读（#531 兜底门据此触发）', chatHasReadableTextCard ? chatHasReadableTextCard(['☺️', '⭐', '▽・ω・▽']) === false : false);
t('A 空文字池＝不可读', chatHasReadableTextCard ? chatHasReadableTextCard([]) === false : false);

/* ---------- B 段：chat.js 接线 ---------- */
t('B getPool 分类走新判定（chatIsEmojiCard/chatIsKaomojiCard）', chat.includes('if (chatIsEmojiCard(c)) emoji.push(c);') && chat.includes('else if (chatIsKaomojiCard(c)) kaomoji.push(c);'));
t('B 默认主字卡兜底门放宽为「无可读句子卡」（#531）', chat.includes("if (catOn('main') && !chatHasReadableTextCard(text)) {"));
t('B 主动消息按可用分类归一化权重（空池不再顶替阈值）', chat.includes('[pool.kaomoji.length ? 15 : 0, () => ({ text: pick(pool.kaomoji), type: \'text\' })]'));
t('B 旧固定累计阈值已移除（原 r < 40 / r < 55 不再出现）', !/const r = Math\.random\(\) \* 100;\s*\n\s*if \(pool\.sticker\.length && r < 15\)/.test(chat));
t('B 旧内联分类正则已从自定义卡循环移除', !/if \(\/\[\\uD800-\\uDBFF\]\/\.test\(c\) \|\| \/\^\[😀-🙏🌀-🫿\]\/u\.test\(c\)\) emoji\.push\(c\);\s*\n\s*else if/.test(chat));

/* ---------- C 段：mail.js 接线 ---------- */
t('C 信件正文可读性判定（全是符号则退回系统预设正文）', mail.includes("const hasCustom = pool.text.some(s => typeof s === 'string' && /[A-Za-z0-9\\u4e00-\\u9fff\\u3041-\\u3096\\u30a1-\\u30fa]/.test(s));"));
t('C 无括号颜文字归 kaomoji（不再占文字池）', mail.includes('๑٩۶ฅヽノ'));

/* ---------- RED 基线说明（手动） ---------- */
try {
  const head = execSync('git show HEAD:src/js/chat.js', { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  t('RED 基线：HEAD chat.js 无 #531 分类器（旧版应红，证明断言有判别力）', head.indexOf('chatHasReadableTextCard') < 0);
} catch (e) { console.log('SKIP  RED 基线（git 读取失败）'); }

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;
