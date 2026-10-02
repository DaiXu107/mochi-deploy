// ===== #807 专项回归：红包领后捎一句话（我领 TA 的红包 / TA 领我的红包 → TA 有概率捎一条消息） =====
// 需求要点：①两个领取方向都触发；②该消息固定只发一条、不受「回复条数」（多条回复上限）限制；
//          ③回复设置「红包互动」组有总开关（默认开）＋捎话概率（默认 60%）＋写清说明；
//          ④红包半框「设置」面板也要写清（只读说明行，显示当前开/关与概率）。
// #848 追加（用户实报「红包设置里找不到这个功能、也切不了模式」）：⑤捎话内容可切三档
//          （0=系统预设话术 / 1=和正常聊天一样回复 / 2=混合，默认 2 保持 #807 行为）；
//          ⑥红包半框「设置」里放开关＋概率＋内容三行**真控件**（原只读说明行删除），
//          与回复设置那份读写同一套 rp-thx-* 每联系人键，任一处改动即时同步。
// 实现：src/js/reply-settings.js（DEFAULTS rp-thx-en/rp-thx-prob/rp-thx-mode＋「红包互动」组 JS 注入，同 #791 口径）
//      ＋src/js/chat.js（rpCollectFeedback(dir) 闸门改造＋三档分流＋我领方向挂点）＋src/js/chat-settings.js
//      （红包半框三行真控件注入＋显示值同步）。
// 用例（对 src 源码做结构/行为断言，不依赖构建产物）：
//   A1 DEFAULTS 默认值（默认开、60%、模式默认混合）；A2 「红包互动」注入组（开关行/概率 stepper/
//      模式胶囊/写清说明/三档助手）；A3 通用绑定接管（三处开关数组＋TOGGLE_NAMES 标签）；
//   B1 rpCollectFeedback 闸门（开关硬闸＋概率钳制＋三档分流）；B2 方向话术池与「我领」挂点次序（先 poke 留痕后掷）；
//   B3 单条语义（函数体不读 reply-min/reply-max、不挂多字卡 tag）；
//   C1 红包半框「设置」三行真控件（注入容器＋三行＋同源落盘＋说明写清＋只读残留已删＋同步接线）；
//   SYN 三文件整文件编译。
// 红对照（旧代码应红）：
//   ⚠️ 口径说明：HEAD 里 #807 整批（rp-thx-* 三键、话术池、半框说明行）也**尚未提交**，
//   所以这条红对照证的是「红包捎话整块功能缺失」＝#807＋#848 一起红，**不是**「只缺 #848 增量」。
//   #848 增量的判别力另由两处保证：①白名单每条 needle 都在各自 src 文件内唯一、且只在
//   对应机制生效时存在（模式档位／半框三行落盘／分流表达式）；②礼物侧 tools/verify-gift-reply.mjs
//   用纯 HEAD 副本跑出了 21 红，那条是干净的同源证据。
//   mkdir -p /tmp/rpthx-red && git show HEAD:src/js/reply-settings.js > /tmp/rpthx-red/rs.js
//   git show HEAD:src/js/chat.js > /tmp/rpthx-red/chat.js
//   git show HEAD:src/js/chat-settings.js > /tmp/rpthx-red/cs.js
//   MOCHI_RS_FILE=/tmp/rpthx-red/rs.js MOCHI_CHAT_FILE=/tmp/rpthx-red/chat.js \
//   MOCHI_CS_FILE=/tmp/rpthx-red/cs.js MOCHI_EXPECT=red node tools/verify-rp-thx.mjs
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const rsSrc = readFileSync(process.env.MOCHI_RS_FILE || join(root, 'src/js/reply-settings.js'), 'utf8');
const chatSrc = readFileSync(process.env.MOCHI_CHAT_FILE || join(root, 'src/js/chat.js'), 'utf8');
const csSrc = readFileSync(process.env.MOCHI_CS_FILE || join(root, 'src/js/chat-settings.js'), 'utf8');

// 红判定只针对 #848 新增/重写的断言：红基线＝HEAD 已含 #807 那批，旧断言在红基线上本就该绿。
const SENS = new Set(['A1c', 'A2f', 'A2g', 'A2h', 'B1d', 'B1e', 'B1f', 'C1a', 'C1b', 'C1c', 'C1d', 'C1e', 'C1f', 'C1g']);
const failures = [];
const redFail = [];
let redTotal = 0;
const note = (id, ok, why) => {
  if (EXPECT === 'red') { if (SENS.has(id)) { redTotal++; if (!ok) redFail.push(id); } }
  else if (!ok) failures.push(id + '：' + why);
};
const count = (s, needle) => s.split(needle).length - 1;

// ---- 花括号配平截取函数体（失败抛错，由各组 try 记为失败） ----
function extractFn(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) throw new Error('源码缺锚点：' + sig);
  const bodyStart = src.indexOf('{', at);
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + (src[i + 1] === ';' ? 2 : 1)); }
  }
  throw new Error(sig + ' 花括号不配平');
}

// ---- A1 DEFAULTS 默认值 ----
try {
  note('A1a', /'rp-thx-en':\s*1/.test(rsSrc), 'reply-settings DEFAULTS 缺 rp-thx-en 默认开');
  note('A1b', /'rp-thx-prob':\s*60/.test(rsSrc), 'reply-settings DEFAULTS 缺 rp-thx-prob 默认 60');
  note('A1c', /'rp-thx-mode':\s*2/.test(rsSrc), 'DEFAULTS 缺 rp-thx-mode（#848 三档：0 预设 / 1 聊天式 / 2 混合，默认 2 保持 #807 行为）');
} catch (e) { note('A1', false, String(e.message || e)); }

// ---- A2 「红包互动」注入组 ----
try {
  note('A2a', rsSrc.includes("id: 'rp-thx-settings'") || rsSrc.includes("rpThxSec.id = 'rp-thx-settings'"), '缺「红包互动」注入容器');
  note('A2b', rsSrc.includes('>红包互动<'), '缺「红包互动」组标题');
  note('A2c', rsSrc.includes('id="rp-thx-en"'), '缺总开关行（checkbox id=rp-thx-en）');
  note('A2d', rsSrc.includes('data-k="rp-thx-prob"') && rsSrc.includes('id="rp-thx-prob-val"'), '缺捎话概率 stepper');
  note('A2e', rsSrc.includes('不受「回复条数最多」限制') && rsSrc.includes('我领取 TA 发的红包、或 TA 领取我发的红包后'), '回复设置说明未写清两方向＋不受回复条数限制');
  note('A2f', rsSrc.includes('id="rp-thx-mode-btn"') && rsSrc.includes('window.saveReplyCfg(\'rp-thx-mode\''), '缺「捎话内容」模式胶囊及其落盘绑定');
  note('A2g', rsSrc.includes('window.rpThxModeList') && rsSrc.includes('window.rpThxModeLabel') && rsSrc.includes('window.rpThxModeSync'), '缺三档定义/标签/同步助手（红包半框那份控件靠它们同源）');
  note('A2h', /function syncUI\(\)[\s\S]{0,2600}window\.rpThxModeSync\(\)/.test(rsSrc), 'syncUI 未纳模式胶囊刷新（切联系人后显示值会停在旧档）');
} catch (e) { note('A2', false, String(e.message || e)); }

// ---- A3 通用绑定接管 ----
try {
  note('A3a', count(rsSrc, "'fish-en', 'work-en', 'fish-grab-en', 'rp-thx-en'].forEach") === 3, '开关数组三处（同步/绑定/保存全部）应都含 rp-thx-en，实有 ' + count(rsSrc, "'fish-en', 'work-en', 'fish-grab-en', 'rp-thx-en'].forEach"));
  note('A3b', rsSrc.includes("'rp-thx-en': '红包领后捎一句话'"), 'TOGGLE_NAMES 缺开关中文名（保存 toast 用）');
} catch (e) { note('A3', false, String(e.message || e)); }

// ---- B1 rpCollectFeedback 闸门 ----
let fbBody = '';
try { fbBody = extractFn(chatSrc, 'function rpCollectFeedback'); } catch (e) { note('B1', false, String(e.message || e)); }
if (fbBody) {
  note('B1a', fbBody.includes("if (Number(c['rp-thx-en']) !== 1) return;"), '缺总开关硬闸（关＝两方向都静默）');
  note('B1b', fbBody.includes("c['rp-thx-prob']") && fbBody.includes('Math.max(0, Math.min(100, prob))'), '缺概率读取＋0-100 钳制');
  note('B1c', fbBody.includes("addIn(dir === 'in' ? rpThxInMsg() : rpThanksMsg()"), '缺方向话术分流');
  // #848：捎话内容可切三档（0 预设 / 1 聊天式 / 2 混合），读档必须在概率闸门之后、
  // 且非法值（未写盘的老联系人）回落混合＝保持 #807 线上行为
  note('B1d', fbBody.includes("mode = Number(c['rp-thx-mode'])") && fbBody.includes('if (mode !== 0 && mode !== 1) mode = 2;'), '缺 rp-thx-mode 三档读取＋非法值回落混合');
  note('B1e', /if \(mode === 0 \|\| \(mode === 2 && Math\.random\(\) < 0\.6\)\) \{/.test(fbBody), '缺「预设档全走预设池、混合档六成走预设池」分流');
  note('B1f', /mode === 2 && Math\.random\(\) < 0\.6[\s\S]{0,600}\} else \{[\s\S]{0,400}genOneReply\(c\)[\s\S]{0,200}addInTyped\(rep\.text/.test(fbBody), '缺「聊天式档（＋混合四成）走单卡生成」分支');
}

// ---- B2 方向话术池与挂点次序 ----
try {
  note('B2a', chatSrc.includes('function rpThxInMsg'), '缺「我领 TA 红包」方向话术池 rpThxInMsg');
  const atOut = count(chatSrc, "rpCollectFeedback('out')");
  note('B2b', atOut === 2, 'TA 领我红包的两条路径（handleSendResponse/tryCollectPending）应各挂 rpCollectFeedback(\'out\')，实有 ' + atOut);
  note('B2c', count(chatSrc, 'rpCollectFeedback()') === 0, '存在无方向旧调用 rpCollectFeedback()，方向分流被绕过');
  const atPoke = chatSrc.indexOf("addIn('你领取了红包'");
  const atIn = chatSrc.indexOf("rpCollectFeedback('in')");
  note('B2d', atPoke >= 0 && atIn > atPoke, '「我领」方向应挂在 poke 留痕（你领取了红包）之后');
  note('B2e', count(chatSrc, "rpCollectFeedback('in')") === 1, '「我领」方向挂点应恰 1 处');
} catch (e) { note('B2', false, String(e.message || e)); }

// ---- B3 单条语义（不受多条回复上限限制＝不经回复管线） ----
// 注：三条都是保持性断言（#807 起就该成立，HEAD 红基线上同样满足），不在 #848 红名单里
if (fbBody) {
  note('B3a', !fbBody.includes('reply-min') && !fbBody.includes('reply-max'), '红包捎话不该读「回复条数」');
  // B3b＝本批真正的契约「固定只发一条」：#807 原文案写的「不挂多字卡 tag」已被 #851 正式
  // 推翻（那条 tag 只是气泡标签，仍是一条消息），故断言收到投递次数与连发结构上，
  // 且不依赖 #851 尚未提交的 tag 行。
  const emits = count(fbBody, 'addInTyped(') + count(fbBody, 'addIn(');
  note('B3b', emits === 2 && !/\bwhile\s*\(|for\s*\(/.test(fbBody) && fbBody.includes('tagNoDup'),
    '固定一条语义被破坏：两分支各一次投递应为 2（实有 ' + emits + '）、不应出现循环连发、需带 tagNoDup 防重');
  note('B3c', fbBody.includes('genOneReply') && fbBody.includes('addInTyped(rep.text'), '单卡生成路径丢失');
}

// ---- C1 红包半框「设置」三行真控件（#848：原只读说明行升级为可直接调） ----
try {
  note('C1a', csSrc.includes("rpThxBox.id = 'cs-rp-thx-box'") && csSrc.includes("getElementById('rp-settings')"), '红包半框缺捎话设置注入容器（三行真控件的宿主，插在「完成」按钮前）');
  note('C1b', csSrc.includes('id="cs-rp-thx-en"') && csSrc.includes('id="cs-rp-thx-prob"') && csSrc.includes('id="cs-rp-thx-mode"'), '红包半框三行控件不全（开关/概率/内容）');
  note('C1c', csSrc.includes("window.saveReplyCfg('rp-thx-en'") && csSrc.includes("window.saveReplyCfg('rp-thx-prob'") && csSrc.includes("window.saveReplyCfg('rp-thx-mode'"), '半框三行未落到 reply-settings 同源键（会与回复设置那份各写各的、切页面值就回跳）');
  note('C1d', csSrc.includes('不受「回复条数」限制') && csSrc.includes('每个联系人单独设置'), '半框说明未写清「固定一条不受回复条数限制」与每联系人独立');
  note('C1e', !csSrc.includes('cs-rp-thx-note'), '只读说明行残留（已被三行真控件取代，两处并存会出现互相矛盾的显示）');
  note('C1f', csSrc.includes('window.csRpSyncThx') && /csRpSettingsSync[\s\S]{0,500}csRpSyncThx/.test(csSrc), 'csRpSettingsSync 未纳入半框显示值刷新（打开半框看到旧值）');
  note('C1g', /rpThxAsk\('cs-rp-thx-mode'[\s\S]{0,600}pills/.test(csSrc), '「捎话内容」行未走 pills 三档选择');
} catch (e) { note('C1', false, String(e.message || e)); }

// ---- SYN 整文件编译（非缺陷敏感：红绿两侧都必须能编译） ----
for (const [id, src] of [['SYN-reply-settings', rsSrc], ['SYN-chat', chatSrc], ['SYN-chat-settings', csSrc]]) {
  try { new Function(src); note(id, true, ''); } catch (e) { note(id, false, '编译失败：' + String(e.message || e)); }
}

// ---- 裁决 ----
if (EXPECT === 'red') {
  const ok = redTotal > 0 && redFail.length >= redTotal - 3; // 容许个别 #848 断言在 HEAD 上意外已满足（同形写法）
  console.log((ok ? 'PASS' : 'FAIL') + ' [red] #848 白名单断言红 ' + redFail.length + '/' + redTotal + '：' + redFail.join('、'));
  if (!ok) { console.log('红基线未复现缺陷面：请核对三个 --file 是否真为 HEAD 版本'); process.exit(1); }
} else if (failures.length) {
  console.log('FAIL ' + failures.length + ' 项：\n' + failures.join('\n'));
  process.exit(1);
} else {
  console.log('PASS [green] #807 红包领后捎一句话＋#848 三档内容与半框真控件：A1~A3/C1 结构锚点、B1~B3 闸门与单条语义、SYN 编译全过');
}
