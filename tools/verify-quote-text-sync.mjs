// ===== 验证脚本：#451 词典拼字/梦角自由造句「消息显示 A、引用预览显示 B」 =====
// 背景：iOS Chrome 等多机型同报——#298 词典拼字/#317 梦角自由造句把 rep.text 换成拼字/造句
// 结果，但 parts 残留原回复：气泡渲染 parts 优先于 text（#202 混合消息链路），引用快照/
// 收藏/回复引用读 text＝两轨不一致。修复=#451 创建侧 spellPartsSync 同步重建 parts（保留
// 图片段）+ normCell 存量治愈（按来源 chip 识别，文本段≠正文时以正文重建）。
// 本脚本从 src 提取真实实现做行为断言（桩 DOM/全局）。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const chat = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
const build = readFileSync(join(root, 'build.mjs'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } }

function extractFn(src, name) {
  const re = new RegExp('function ' + name + '\\([^)]*\\) \\{');
  const m = re.exec(src);
  if (!m) throw new Error('源码中找不到 ' + name);
  let i = m.index + m[0].length, depth = 1, out = m[0];
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    out += ch;
    i++;
  }
  return out;
}

// --- C 创建侧：spellPartsSync 真实实现 ---
const spellPartsSync = new Function(
  extractFn(chat, 'spellPartsSync') + '\nreturn spellPartsSync;'
)();
const IMGV = '@@m:' + 'ab'.repeat(16);

{
  const out = spellPartsSync('拼字结果', [{ k: 'text', v: '原回复' }, { k: 'img', v: IMGV, sub: 'sticker' }]);
  ok('C1 文本段换血+图片段保留', out.length === 2 && out[0].k === 'text' && out[0].v === '拼字结果' && out[1].k === 'img' && out[1].v === IMGV);
}
{
  const out = spellPartsSync('造句新句', [{ k: 'text', v: '原回复' }]);
  ok('C2 无图片段返回 null（维持纯文本不带 parts 存储口径）', out === null);
}
{
  ok('C3 prevParts 为 null 安全', spellPartsSync('x', null) === null);
}
{
  const out = spellPartsSync('x', [{ k: 'img', v: IMGV, sub: 'image' }]);
  ok('C4 仅图片段：补文本段+保留图片', out.length === 2 && out[0].v === 'x' && out[1].k === 'img');
}

// --- R 创建侧接线：三个 addIn 调用点的 parts 不再直传原回复 ---
{
  const spellBlock = chat.slice(chat.indexOf('if (spellSegs && spellSegs.length > 1) {'), chat.indexOf('let mjf = null;'));
  ok('R1 拼字换血块重建 parts（文本段=__spText+图片段拼接）', spellBlock.includes("[{ k: 'text', v: __spText }].concat(__spImgs)") && spellBlock.includes('spellImgParts = __spImgs'));
  ok('R2 旧「parts: rep.parts || null」直传已废除（换血块内）', !spellBlock.includes('parts: rep.parts || null'));
  ok('R3 梦角造句换血走 spellPartsSync', chat.includes('parts: spellPartsSync(mjf.text, rep.parts)'));
  ok('R4 逐卡连发末气泡按本卡重建（不再整包旧 parts）', chat.includes('parts: si === rep.spell.length - 1 ? spellPartsSync(rep.spell[si], spellImgParts) : null'));
}

// --- N 存量治愈：normCell 真实实现（桩全局符号） ---
{
  const ICON_DUMMY = '___NEVER_MATCH___'; // 空串会让 indexOf('')>=0 恒真＝桩假阳性
  const windowMock = { mochiMediaIsToken: () => false };
  // #843 修 harness 自身缺陷：normCell 体内还调 hasMultiImgParts / chatIsImageUrlCard /
  //   pyChipDropIfSingle 三个模块级函数，此前一律没桩＝ ReferenceError 被 normCell 自己的
  //   try/catch 静默吞掉，整组 N 断言在纯 HEAD 上也全红（假红掩盖真回归）。
  const hasMultiImgParts = (r) => Array.isArray(r && r.parts) && r.parts.filter(p => p && p.k === 'img').length > 1;
  const chatIsImageUrlCard = () => false;
  let pyChipDropIfSingle;
  try {
    pyChipDropIfSingle = new Function('window', extractFn(chat, 'pyChipDropIfSingle') + '\nreturn pyChipDropIfSingle;')(windowMock);
  } catch (e0) {
    console.error('  ! pyChipDropIfSingle 提取失败，退回保守桩（N 组仍可信，#773c 组不覆盖）：' + e0.message);
    pyChipDropIfSingle = () => false;
  }
  const normCell = new Function(
    'ICON_BELL', 'ICON_TEL', 'ICON_ENV', 'ICON_CQ_FIX', 'window', 'hasMultiImgParts', 'chatIsImageUrlCard', 'pyChipDropIfSingle',
    extractFn(chat, 'normCell') + '\nreturn normCell;'
  )(ICON_DUMMY, ICON_DUMMY, ICON_DUMMY, {}, windowMock, hasMultiImgParts, chatIsImageUrlCard, pyChipDropIfSingle);

  const mk = () => ({
    side: 'in', type: 'text', text: '拼字结果', ts: 123,
    mood: [{ tag: '词典拼字', label: '' }],
    parts: [{ k: 'text', v: '原回复正文' }, { k: 'img', v: IMGV, sub: 'sticker' }]
  });

  const r1 = mk();
  ok('N1 带 tag 且文本段≠正文 → 以正文重建 parts（图片段保留）', normCell(r1) === true && r1.parts[0].v === '拼字结果' && r1.parts[1].k === 'img' && r1.parts[1].v === IMGV);
  ok('N2 幂等（重建后再跑不再改动）', normCell(r1) === false);

  const r3 = mk();
  r3.mood = null;
  ok('N3 无来源 chip 的 parts 不一致消息不误伤（普通消息 parts 渲染语义不变）', normCell(r3) === false && r3.parts[0].v === '原回复正文');

  const r4 = mk();
  r4.parts = [{ k: 'text', v: '拼字结果' }];
  ok('N4 文本段已等于正文 → 不动', normCell(r4) === false);

  const r5 = mk();
  r5.parts = [{ k: 'text', v: '旧正文' }, { k: 'img', v: IMGV }];
  r5.mood = [{ tag: '梦角自由造句', label: '' }];
  r5.text = '造句新句';
  ok('N5 梦角自由造句同族识别', normCell(r5) === true && r5.parts[0].v === '造句新句');

  const r6 = mk();
  r6.mood = [{ tag: '词典逐卡连发', label: '' }];
  r6.text = '本卡';
  ok('N6 逐卡连发末气泡同族识别', normCell(r6) === true && r6.parts[0].v === '本卡');

  const r7 = mk();
  r7.parts = [{ k: 'text', v: '旧正文' }]; // 无图片段 → 重建为 null
  ok('N7 无图片段旧消息重建为 null（回落 text 分支与引用同源）', normCell(r7) === true && r7.parts === null);

  // #843：词典 tag 改名后新增的两枚也要被白名单认到（漏则该消息引用预览继续与气泡不一致）
  ['词典拼句', '词典拼词'].forEach(tg => {
    const r8 = mk();
    r8.parts = [{ k: 'text', v: '旧正文' }, { k: 'img', v: IMGV }];
    r8.mood = [{ tag: tg, label: '' }];
    r8.text = '拼出的新正文';
    ok('N8 ' + tg + ' 同族识别（#843 新 tag 进白名单）', normCell(r8) === true && r8.parts[0].v === '拼出的新正文');
  });
}

// --- S 哨兵在位 ---
ok('S1 哨兵两条登记 build.mjs（#451）', build.includes("needle: 'function spellPartsSync(text, prevParts) {'") && build.includes("needle: \"md.tag === '词典逐卡连发'\""));

console.log(pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
