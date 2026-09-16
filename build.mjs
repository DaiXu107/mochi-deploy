// ===== 组装脚本 =====
// 把 src/ 下的模板 + 按页面拆分的 CSS + 按功能拆分的 JS
// 拼装成单个可直接双击打开的 index.html（完整功能）。
// 用法：在 mochi 目录下运行  node build.mjs
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';


const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, 'src', p), 'utf8');

// ===== --check-sentinels：只检查不构建（v3.27.x，防覆盖专用）=====
// 用法：node build.mjs --check-sentinels
// 非构建者改完 src/ 后跑它：不写任何产物，只对照 src/ 检查每条修复哨兵的
// 逻辑锚点是否仍在位（覆盖 = src 里 needle 丢失，直接报红退出 1）。
// 产物缺失在这模式下只警告不算失败（还没构建，产物旧是正常的）——
// 真正的覆盖是「src 里也没有」，那是修复真被整块删掉。
const CHECK_SENTINELS = process.argv.includes('--check-sentinels');

// ===== 构建前健康检查（v3.6.x） =====
// 防止把「未完成的改动 / 调试脚本」混进产物——历史教训：构建者跑 build 时工作区里
// 有对方进行中的改动，产物悄悄带上半成品；tools/tmp-*.mjs / smoke-*.mjs 调试脚本
// 也险些被 add -A 提交。检出时醒目警告（不阻止构建，构建者自行判断；
// AGENTS.md 约定构建前 git status 核对）。
try {
  const out = execSync('git status --porcelain', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) || '';
  const lines = out.split('\n').filter(Boolean);
  // 所有未跟踪的 .mjs 调试脚本（tmp-*/smoke-*/verify-* 等临时工具）
  const tmpUntracked = lines.filter(l => l.startsWith('??') && /[\w.-]*\.mjs/.test(l));
  const modified = lines.filter(l => !l.startsWith('??'));
  if (tmpUntracked.length) {
    console.warn('⚠️  检测到未跟踪调试脚本（.mjs，可能是临时工具）：\n  ' + tmpUntracked.join('\n  ') + '\n  请确认这些不要随产物提交（建议加进 .gitignore 或删除）。');
  }
  if (modified.length) {
    console.warn('⚠️  工作区有未提交改动 ' + modified.length + ' 个文件：\n  ' + modified.map(l => '  ' + l.slice(0, 90)).join('\n') + '\n  构建产物会包含这些改动——请确认对方已保存完整（AGENTS.md：不夹带未完成的一半改动）。');
  }
} catch (e) { /* 非 git 环境 / git 不可用：跳过检查 */ }

// ===== 构建信息（开屏显示 + sw 缓存版本号，v3.5.54） =====
const buildTime = new Date();
const pad = (n) => (n < 10 ? '0' + n : '' + n);
const buildInfo = '部署于 ' + buildTime.getFullYear() + '-' + pad(buildTime.getMonth() + 1) + '-' + pad(buildTime.getDate()) +
  ' ' + pad(buildTime.getHours()) + ':' + pad(buildTime.getMinutes());
const buildStamp = buildTime.getTime().toString(36); // sw 缓存名版本号（每次构建必变）
// 应用版本号（设置页底部与开屏共用）
// v3.26.x：自动从 git 提交数生成（v3.26.<提交数>）——此前手动维护 APP_VERSION，
// 与提交 message 里的版本号经常不同步（混用 v3.5.x/v3.6.x）。现在每次提交后构建，
// 版本号自动 +1、永不需要人工对齐；提交 message 前缀保持 v3.26.x 系列即可。
// ⚠️ 版本系列升级时（如 v3.26 → v3.27）把下面的前缀一起改掉，与提交 message 对齐。
// 2026-09-11：仓库历史重置为单提交（AI 协作台账移出公开库），提交数从 560 骤降，
// 加 VERSION_BASE 基数保持版本号连续不倒退（SW 缓存刷新依赖版本单调递增）。
// 非 git 环境（脚本被拷贝/CI 无 git）回退 v3.26.0 兜底。
const VERSION_BASE = 559;
let APP_VERSION = 'v3.26.0';
try {
  const cnt = execSync('git rev-list --count HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (cnt && /^\d+$/.test(cnt)) APP_VERSION = 'v3.26.' + (VERSION_BASE + parseInt(cnt, 10));
} catch (e) { /* 无 git：保持兜底 */ }

// ===== 零依赖保守压缩 =====
// 只删注释/空行/缩进，不改任何代码语义（无依赖、无解析器）。
// 已核查全项目：无模板字符串插值（${}）、无 eval、无跨行反引号/字符串续行——
// 逐行处理 JS 安全；CSS 块注释可跨行、字符串内不含 /* ，整文件非贪婪匹配安全。
// 超长单行（如 default-cards-data.js 6.5 万字符的数据 JSON 行）整行保留不动。
const MINIFY_KEEP_LINE = 8000;
function minifyJs(code) {
  const lines = code.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.length > MINIFY_KEEP_LINE) { out.push(raw); continue; } // 数据行原样保留
    const t = raw.trim();
    if (!t) continue;                   // 空行
    if (t.startsWith('//')) continue;   // 整行 // 注释（行内尾注释不动，字符串/URL 里可能有 //）
    out.push(t);                        // 去行首缩进 + 行尾空白
  }
  return out.join('\n');
}
function minifyCss(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\/\s*/g, '') // 块注释（含跨行）
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

// ===== 按顺序拼接样式 / 脚本（顺序即生效顺序） =====
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css', 'drift-bottle.css', 'applock.css'];
const jsFiles = ['device.js', 'idb.js', 'contacts.js', 'applock.js', 'card-lock.js', 'dcp-master.js', 'media-pool.js','storage-slim.js', 'img-compress.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'dict-ext-data.js', 'default-cards.js', 'quote-spell.js', 'dream-free.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'ta-mood-data.js', 'ta-mood.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'incoming-requests.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'my-arc.js', 'period.js', 'accounting.js', 'garden.js', 'room.js', 'drift-bottle.js', 'decision.js', 'group-decision.js', 'pong.js', 'snake-game.js', 'breakout.js', 'connect-four.js', 'coop-mine.js', 'fishing.js', 'memory-game.js', 'gomoku.js', 'linkup.js', 'match3.js', 'auction.js', 'arcade.js', 'mood-diary.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'ver-check.js', 'cjian.js', 'feature-hub.js', 'settings-help.js', 'onboarding.js', 'page-coach.js', 'card-audit.js', 'mobile-adapt.js'];

let html = read('template.html');
// v3.26.x #301：模板 HTML 注释配平守卫——开屏批 07a6cab 曾在红包注释行漏写 `-->`
// （结尾误成 `*/}`），注释一路吞到下一个 `-->`，净少吃一个 `<div class="set-group">`
// 开标签：后续 `</div>` 连锁把 them-sec → #page-chat-settings → .phone 手机壳全部
// 提前闭合，底部导航 .tabbar/音乐悬浮窗/消息弹窗等落成 body 直接子节点；body 是
// flex 横排居中，手机壳与 tabbar 并排坐＝整壳被推左出屏 ~59px、tabbar 挤出屏右、
// 右侧露灰底（2026-09-11 用户报「手机端 UI 完全乱了」实锤，div 总数恰好配平所以
// 肉眼/普通 diff 查不出）。此处构建时硬校验注释标记必须成对，失衡直接退出。
{
  const opens = (html.match(/<!--/g) || []).length;
  const closes = (html.match(/-->/g) || []).length;
  if (opens !== closes) {
    console.error('✗ 模板 HTML 注释配平失败：<!-- ' + opens + ' 个 vs --> ' + closes + ' 个——存在未闭合注释，会把后续标签吞进注释、连锁打碎 .phone 手机壳结构（#301）。用 grep -n "<!--" src/template.html 逐个核对最近的注释改动。');
    process.exit(1);
  }
}
const styles = cssFiles.map(f => minifyCss(read(join('css', f)))).join('\n');
// 每个 JS 文件独立 try/catch 包裹：单文件运行时报错不再连坐后续所有功能
// （如某个文件在特定设备抛错，之前会导致之后文件的绑定全部失效）

// v3.27.x：拆 script 块（修复 iOS 15 开屏无限刷新白屏）——
// 产物单块内联脚本曾达 2.85MB，iOS 15 的 WebKit(615)/JavaScriptCore 对超大单块
// script 解析会触发内存限制 → WebContent 进程崩溃 → Safari 显示「此页面出现问题」
// 并自动重新加载 → 每加载必崩 → 无限刷新循环 → 白屏打不开（iOS 上所有浏览器都是
// WebKit 内核，故「所有浏览器」现象一致）。拆成多块后每块远小于引擎单块解析上限，
// 块间保持 jsFiles 顺序（依赖前置不变），全局 window 共享不受影响。
// v3.26.x #91：按 UTF-8 字节数而非字符数计量——原用 s.length（UTF-16 码单元数），
// 中文注释 1 字符 .length=1 但 UTF-8 占 3 字节；产物写盘/WebKit 解析均按字节，导致
// 「字符数 600K」的块实际字节数达 1.4MB+，仍触发 WebKit 单块解析崩溃 → iOS 15/18
// Safari 无限自动刷新白屏（用户诊断：DOM 就绪 36s、SW 不支持、刷新打不开）。改用
// Buffer.byteLength 后每块真实字节数 ≤ 上限，iOS WebKit 不再崩溃。
const SCRIPT_CHUNK_LIMIT = 500 * 1024; // 每块 UTF-8 字节数上限（500KB，留余量低于 iOS 15 单块安全阈值）
function chunkScripts(items) {
  const chunks = [];
  let cur = [];
  let size = 0;
  const byteLen = (s) => Buffer.byteLength(s, 'utf8');
  items.forEach(function (s) {
    const sl = byteLen(s);
    if (size + sl > SCRIPT_CHUNK_LIMIT && cur.length) { chunks.push(cur); cur = []; size = 0; }
    cur.push(s); size += sl;
  });
  if (cur.length) chunks.push(cur);
  return chunks;
}

// 每个 JS 文件独立 try/catch 包裹：单文件运行时报错不再连坐后续所有功能
// （如某个文件在特定设备抛错，之前会导致之后文件的绑定全部失效）
// v3.34.x #527：模块加载体检——每个包内 try 末行（=文件整段执行完成才到达）登记
// __mochiLoaded；catch 里的 __jsErrors 追加文件名（原只 push message，诊断「启动文件
// 异常」无法归因到文件）。运行期用 __mochiLoaded vs 构建期注入的 __mochiJsFiles 求差，
// 定位「整段没加载」的文件——补 __jsErrors 的盲区：语法错误在 parse 期抛出，包内
// try/catch 兜不住，且每个 500KB script 块内任一文件语法错会整块不执行（十几个功能一起死）。
const jsWrapped = jsFiles.map(f => {
  const code = minifyJs(read(join('js', f)));
  return '(function () { try {\n' + code + '\nif (window.__mochiLoaded) window.__mochiLoaded.push("' + f + '");\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[' + f + '] " + String(__e && __e.message || __e)); } })();';
});
// 首块前置初始化：错误环 + 已加载清单 + 期望清单（jsFiles 即期望，运行期差集定位死块）
jsWrapped.unshift('window.__jsErrors = window.__jsErrors || []; window.__mochiLoaded = window.__mochiLoaded || []; window.__mochiJsFiles = ' + JSON.stringify(jsFiles) + ';');
// 按 UTF-8 字节上限拆 script 块（iOS 15 单块解析崩溃防护，见上方注释）
const scriptChunks = chunkScripts(jsWrapped);

// v3.15.x：改用函数返回值注入——字符串替换会把包内 $&/$'/$` 当特殊模式处理，
// 源码里出现这些序列（正则/模板片段）时产物被静默撑爆+残留占位符（2026-08-26 实测踩坑）
html = html.replace('/*__STYLES__*/', () => styles);
// v3.27.x：多块注入——第一块沿用模板内既有 <script>，后续块用 </script><script> 分隔，
// 每个功能文件仍是独立 IIFE+try/catch，块间顺序执行语义不变
html = html.replace('/*__SCRIPTS__*/', () =>
  scriptChunks.map((c, i) => (i === 0 ? c.join('\n') : '</script>\n<script>' + c.join('\n'))).join('\n')
);
// 注入部署时间（开屏显示）
html = html.replace('__BUILD_INFO__', buildInfo);
// 注入当前构建时间戳（页面自身版本基线，v3.7.x）——
// pwa.js 版本检测用它当基线，不再依赖「首次 fetch 的 version.json 时间戳」：
// 旧缓存页面 + 网络拿到最新 version.json 时，旧逻辑把最新时间戳当基线 → 永不提示
// 更新；注入页面自身的部署时间戳后，任何比它新的 version.json 都会触发更新提示
html = html.split('__BUILD_TS__').join(String(buildTime.getTime()));
// 版本号两处（开屏 + 设置页底部）都要替换：replace 用字符串只替换第一处，改用 split/join 全局替换
html = html.split('__APP_VERSION__').join(APP_VERSION);

// v3.26.x #134：EOF 兜底标记——写在 </html> 之后（HTML 语法上仍合法，解析器忽略
// </html> 后的尾随注释）。template.html 里 body 末已有 id=mochi-html-eof 锚点 +
// 一份 __MOCHI_EOF__ 注释；这里再加一份于文档最末字节处，确保「哪怕 body 尾部
// 几百字节被截断，SW 完整性校验仍能判定残缺」。sw.js isCompleteHtml 靠它判定。
html += '\n<!-- __MOCHI_EOF__ ' + buildStamp + ' -->\n';

if (!CHECK_SENTINELS) {
const out = join(root, 'index.html');
writeFileSync(out, html);
console.log('已生成 index.html（' + html.length + ' 字节，' + (html.split('\n').length) + ' 行）');

// v3.6.x：生成版本文件 version.json（部署到站点根目录）——
// 手机端靠它检测新版本（fetch 对比时间戳），不依赖 Service Worker 更新机制
//（sw 只在页面加载/导航时检查、iOS Safari 检测不可靠，开着旧页面永远收不到提醒）。
const versionJson = JSON.stringify({ ts: buildTime.getTime(), info: buildInfo });
writeFileSync(join(root, 'version.json'), versionJson);
console.log('已生成 version.json（' + versionJson + '）');

// ===== 复制 PWA 文件到根目录（随 GitHub Pages 部署） =====
// sw.js 缓存名改为每次构建的 buildStamp → 新版本部署后老缓存自动失效，强制更新
const pwaFiles = ['manifest.json', 'sw.js', 'icon-192.png', 'icon-512.png', 'icon-180.png', 'icon-maskable-512.png', 'notice.json'];
pwaFiles.forEach(f => copyFileSync(join(root, 'src', 'pwa', f), join(root, f)));
const swPath = join(root, 'sw.js');
let sw = readFileSync(swPath, 'utf8');
sw = sw.replace(/const CACHE = 'mochi-[^']*';/, "const CACHE = 'mochi-" + buildStamp + "';");
sw = sw.replace(/const BUILD_INFO = '[^']*';/, "const BUILD_INFO = '" + buildInfo + "';");
if (!sw.includes('const BUILD_INFO')) {
  sw = sw.replace("const CACHE = 'mochi-" + buildStamp + "';", "const CACHE = 'mochi-" + buildStamp + "';\nconst BUILD_INFO = '" + buildInfo + "';");
}
writeFileSync(swPath, sw);
console.log('已复制 PWA 文件 → ' + pwaFiles.join(', ') + '（sw 缓存版本: mochi-' + buildStamp + '）');
} else {
  console.log('--check-sentinels：跳过构建（不写产物），仅对照 src/ 检查修复锚点是否在位。');
}

// ===== 关键修复哨兵（v3.16.x） =====
// 历史教训：修复被并行会话覆盖 / 编辑器旧缓冲回写 / 新文件漏接入 build.mjs，
// 都会让「已修复的问题在新版本复发」，且构建/布局检查照常通过、无人发现。
// 构建完成后对产物做特征检查——每个曾用户反馈过的关键修复对应一个代码特征
// （函数名/常量/选择器）。特征缺失 = 修复可能被覆盖 → 醒目警告（不阻断构建，
// 构建者自行判断；有对应 verify-xxx.mjs 的可补跑确认）。
// 删除型修复（移除某功能/入口）：加 { absent: true }，表示 needle 出现在产物中才报警
// （防止并行会话/旧缓冲把已移除的代码改回来）。
// 维护：新增关键修复时在此登记一行 { name, file, needle }（needle 为产物中的特征串）。
const FIX_SENTINELS = [
  { name: '#545 全站自定义下拉（.mochi-custom-select）打开时显式 display:block（删掉/改回 \'\' ＝清内联后回落样式表 display:none，浮层永远打不开，全站下拉「点了没反应」复发，vivo X200s+Edge 等多机型）', file: 'js/ta-ask.js', needle: "list.style.display = 'block';" },
  { name: '#498 后台通知精确相等查重无条件拦（60秒间隔豁免复活＝切后台马上弹几分钟前看过的字卡，红米K80 等多设备复发）', file: 'js/bg-keep.js', needle: 'if (mf === key) return true;' },
  { name: '#498 后台通知历史查重窗口 5 分钟（改成 60 秒内才拦＝窗口外撞车内容重弹看过的消息）', file: 'js/bg-keep.js', needle: 'const NOTIFY_CHAT_DUP_MS = 5 * 60000;' },
  { name: '#498 后台通知无 batchBurst 连发放行（batchBurst 复活＝上一条通知 30 秒内撞车内容绕过全部去重重弹）', file: 'js/bg-keep.js', needle: 'const batchBurst', absent: true },
  { name: '#601d 手动关后台保活写「用户意图」标记（删掉＝无标记可读，通知联动/回填又会把用户关掉的保活打开＝「关掉后过一会/重开又自己变回开启」复发）', file: 'js/bg-keep.js', needle: "gSet('__ka-user-off', keepEnabled ? '0' : '1');" },
  { name: '#601d 启动读标记一律保持关闭（删掉＝存储里被写成 \'1\' 时又把用户关掉的保活打开）', file: 'js/bg-keep.js', needle: "if (gGet('__ka-user-off') === '1') {" },
  { name: '#601d 开启「后台通知」时用户已关过保活则不再强开（删条件＝刚开通知就把用户手动关掉的保活重新打开，#88 回填同族）', file: 'js/bg-keep.js', needle: "gGet('bg-keepalive') === '0' || gGet('__ka-user-off') === '1'" },
  { name: '#393 群聊模式下装修组件库显式加回占卜写意图标记（删掉＝退出装修即被收池，「装修拉出来也加不上」复发）', file: 'js/personalize.js', needle: "set('divination-desk-pin', '1')" },
  { name: '#393 applyGroupChatMode 读占卜意图标记豁免强制收池（删掉条件＝群聊开启期间用户加回的占卜被重新收回）', file: 'js/personalize.js', needle: "get('divination-desk-pin') === '1'" },
  { name: '#393 装修组件库摸鱼小组件命名含「摸鱼」（原「周末倒计时」无摸鱼字样搜不到＝「缺少摸鱼小组件」）', file: 'js/personalize.js', needle: "weekend: '摸鱼倒计时（周末）'" },
  { name: '#400 装修移出经期倒计时卡写移除标记（ensureDeskPeriod 布局缺卡自动补位无一次性语义＝移出后刷新被拉回还新建一页，#380 memo-row 强迁同族）', file: 'js/personalize.js', needle: "set('desk-period-removed', '1')" },
  { name: '#400 ensureDeskPeriod 读移除标记跳过补位（删掉＝用户删掉的经期卡每次启动/切桌面被拉回+多建一页）', file: 'js/personalize.js', needle: "get('desk-period-removed') === '1'" },
  { name: '#400 组件库显式加回群聊图标写位置意图标记（applyGroupChatMode 默认强制拽回聊天右侧＝用户挪到其他页留不住）', file: 'js/personalize.js', needle: "set('group-chat-desk-pin', '1')" },
  { name: '#400 applyGroupChatMode 读群聊位置标记豁免强制归位（删掉＝装修加到其他页的群聊图标退装修即被拽回）', file: 'js/personalize.js', needle: "get('group-chat-desk-pin') === '1'" },
  { name: '#405 ensureDeskPeriodP3Order 有布局一律尊重不换序（删掉＝用户装修调换第三页经期/备忘卡顺序后每次启动被打回，#380 同族）', file: 'js/personalize.js', needle: 'if (deskLayout()) return;' },
  { name: '#405 p2apps 强制换到摸鱼卡下方改一次性迁移（删掉标记门＝用户把 p2apps 挪到摸鱼卡上方后每次启动/切桌面被改回）', file: 'js/personalize.js', needle: "get('p2apps-order-mig') === '1'" },
  { name: '#405 p3→p2 图标救回迁移改一次性（删掉标记门＝用户故意把花园/同频/伸手拖回第三页网格后每次启动被拽回）', file: 'js/personalize.js', needle: "get('p2icons-p3-mig') === '1'" },
  { name: '#390 TA的心情分享 10% 概率 tag 显示「你的心情」（TA 有时发这张卡实为想问对方心情，tag 恒「TA的心情」表达不清；概率分支删掉即回归）', file: 'js/chat.js', needle: "? '你的心情' : 'TA的心情';" },
  { name: '#145 聊天表情按钮再点关闭（window.closeEmojiPanelForInsert 导出，群聊切换关闭复用）', file: 'js/chat.js', needle: 'window.closeEmojiPanelForInsert' },
  { name: '#145 群聊表情按钮再点关闭（面板已开先关不重开）', file: 'js/group-chat.js', needle: 'window.closeEmojiPanelForInsert &&' },
  { name: '#149 引用块缩略图认媒体池令牌（对象引用 imgs 过滤：data: 或 @@m: 令牌，令牌交 media-pool 观察器解图；删掉缩略图又消失）', file: 'js/chat.js', needle: "const isQM = (s) => typeof s === 'string' && (s.indexOf('data:') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(s)));" },
  { name: '#149 纯图片引用（字符串载荷）令牌也渲染成缩略图', file: 'js/chat.js', needle: "q.indexOf('data:') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(q))" },
  { name: '#149 引用快照识别令牌化图片消息（quoteTextOf 图片载荷判定含 @@m: 令牌，否则引用不出图+令牌串进 quote 文本）', file: 'js/chat.js', needle: "/^https?:\\/\\//i.test(s) || (window.mochiMediaIsToken && window.mochiMediaIsToken(s))" },
  { name: '#149 引用文本清洗不直出令牌串（quoteTextSafe 令牌→空，防 @@m:hash 铺进引用块/引用预览条）', file: 'js/chat.js', needle: 'window.mochiMediaIsToken(str)' },
  { name: '#127 单聊点发送不收输入法（mousedown preventDefault 防焦点被按钮抢走）', file: 'js/chat.js', needle: "send.addEventListener('mousedown', (e) => { e.preventDefault(); });" },
  { name: '#127 群聊点发送不收输入法（同单聊）', file: 'js/group-chat.js', needle: "sendBtn.addEventListener('mousedown', (e) => { e.preventDefault(); });" },
  { name: '#512 问问TA/邀请TA 半框关闭前显式收输入法（先 blur 再隐藏面板；删掉＝键盘被"元素移除"带走、内核不派 vv.resize，输入法位置一直露灰底，#141/#209 同族复发）', file: 'js/chat.js', needle: 'try { askBoxes().forEach(({ box }) => { try { if (box && box.blur) box.blur(); } catch (e) {} }); } catch (e) {}' },
  { name: '#512 收输入法必须发生在面板隐藏之前（两行顺序颠倒＝聚焦元素先被摘掉，blur 落空、灰底复发）', file: 'js/chat.js', needle: 'askDismissIme();\nif (chatAskPanel) chatAskPanel.hidden = true;' },
  { name: '#512 程序化收键盘必须向移动适配层报备（删掉＝丢失「我确实主动收过键盘」凭据，有界兜底网永不武装＝连 focusout 都不派的内核灰底复发）', file: 'js/chat.js', needle: 'if (window.mochiKbDismiss) { try { window.mochiKbDismiss(); } catch (e) {} }' },
  { name: '#512 外部收键盘后的有界兜底网存在（删掉＝不派 focusout / vv.resize 的内核上 .phone 内联收缩高永久卡在键盘期数值，输入法位置一直露 body 灰底，#209/#236 同族复发）', file: 'js/mobile-adapt.js', needle: 'window.mochiKbDismiss = function () {' },
  { name: '#512 兜底网计时器必须按每次请求起（改回模块初始化上的一次性 setTimeout＝模块加载时 _aDismissAt 恒为 0，800ms 那拍直接 return 后再不进场＝整段死代码，灰底一点不会被兜住。首稿实测踩过）', file: 'js/mobile-adapt.js', needle: '_aDismissTimer = setTimeout(_aDismissCheck, 800);' },
  { name: '#512 兜底网有界窗口 3s（删掉＝请求过期后仍在无限复查）', file: 'js/mobile-adapt.js', needle: 'if (_dAge > 3000) { _aDismissAt = 0; _aDismissTries = 0; return; }' },
  { name: '#512 兜底网必须挂在「无活文本焦点」否证上（删掉＝键盘真在场也强行复原，健康内核键盘被抽走＝#209 同族回归）', file: 'js/mobile-adapt.js', needle: 'if (_aIsText(document.activeElement)) return _dRetry();' },
  { name: '#542 桌面 openModal 关弹窗前先 blur 弹窗内聚焦输入框（删掉＝聚焦可编辑元素被 hidden 带走、内核不派 focusout/vv.resize，.phone 卡收缩高露大片灰底，回弹很慢）', file: 'js/personalize.js', needle: '&& mask.contains(_ae)) {' },
  { name: '#542 桌面 openModal 关弹窗时向移动层报备有界兜底（连 focusout 都不派的内核上仍能收回 .phone）', file: 'js/personalize.js', needle: 'if (window.mochiKbDismiss) { try { window.mochiKbDismiss(); } catch (eD) {} }' },
  { name: '#542 安卓失焦快速复原：必须确证失焦来自文本框（删掉＝任意焦点转移都触发，误收键盘期 .phone）', file: 'js/mobile-adapt.js', needle: '_lostText = _aIsText(e.target);' },
  { name: '#542 安卓失焦快速复原：失焦时必须无任何文本持活焦点（删掉＝键盘真在场也强行复原，#209 同族回归）', file: 'js/mobile-adapt.js', needle: 'if (!_lostText) return;' },
  { name: '#542 安卓失焦快速复原：必须验收 vv 读数已稳（删掉＝收起动画中途误清、.phone 抖动回弹）', file: 'js/mobile-adapt.js', needle: 'Date.now() - _aVvChgAt < 350' },
  { name: '#542 手机端 body 底色随 .phone（--bg-b，非桌面灰 --page-bg）：键盘收缩露出的一条不再是「大片灰底」', file: 'css/base.css', needle: 'html, body { padding:0; min-height:100vh; min-height:100svh; min-height:100dvh; background:var(--bg-b, #fff); }' },
  { name: '#542 UA 桌面伪装兜底形态同款 body 底色（force-mobile）', file: 'css/base.css', needle: 'html.force-mobile, html.force-mobile body { padding:0; min-height:100vh; min-height:100svh; min-height:100dvh; background:var(--bg-b, #fff); }' },
  { name: '定期备份提醒条存在（backup-remind-bar，受保护产品功能，见 AGENTS.md 数据与存储约定）', file: 'js/pwa.js', needle: "getElementById('backup-remind-bar')" },
  { name: '定期备份提醒条锚点存在（template.html）', file: 'template.html', needle: 'backup-remind-bar' },
  { name: '备份提醒冷却收短到 1 天（每天弹一次；改动 INTERVAL 即消失，防被长冷却静默压制）', file: 'js/pwa.js', needle: 'const INTERVAL = DAY;' },
  { name: '开屏备份弹窗避让已有弹窗（openModal 全站唯一，删掉则顶掉首启引导/字卡锁提醒等开屏弹窗且当天不再补弹）', file: 'js/pwa.js', needle: "if (mask && !mask.hidden) return 'busy';" },
  { name: '#355b 备份提醒条「单独备份聊天」按钮存在（template.html）', file: 'template.html', needle: 'id="backup-remind-chat"' },
  { name: '#355b 仅聊天记录导出不更新全量备份时间（data-backup.js cfg.mode!==chat 守卫，逻辑锚）', file: 'js/data-backup.js', needle: "if (cfg.mode !== 'chat')" },
  { name: '#356 收藏页媒体池令牌渲染（收藏令牌化后 @@m:hash 按图片出，不再把令牌串当文字直出＝不明代码；判定表达式改掉即消失）', file: 'js/chat.js', needle: "f.text.indexOf('data:image/') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(f.text))" },
  { name: '#357 语音播放挂载 DOM（playVoiceInChat 挂到 body 再 play、停播即卸；删则安卓 WebView 未挂载 Audio 静默空放/播放失败，收藏与聊天语音同链路复发）', file: 'js/chat.js', needle: "if (!a.parentNode) { a.style.display = 'none'; document.body.appendChild(a); }" },
  { name: '#358 跨桌面投递空库账本矛盾守卫（探测说谎时 writeArr([一条]) 会把该联系人全部历史覆盖成一条＝旧记录只剩互动卡片；守卫函数删掉即消失）', file: 'js/chat.js', needle: 'function deskAppendMissGuard(cid, tries, onRetry, writeOne)' },
  { name: '#358 loadMsgs 空库二次复核（账本缺失时单次探测说谎会把 LS 有损快照晋升为权威顶掉老历史；2.5s 双复核删掉即消失）', file: 'js/chat.js', needle: 'function enterConfirmedEmpty() {' },
  { name: '#478 loadMsgs 权威读库成功必须补写 LS 快照（OOM 批 !hasLocal 快路径令 changed 恒 false 不再进 if(changed)，快照被 removeItem 后永不重写＝切走再切回遇 IDB 事务挂起时记录失去唯一兜底副本整窗不可见，TASKS #131① 真缺陷；删掉未变更路径的延迟补写即复发。#477 编号已让位给并行会话 tabbar 掉出 .phone 回归）', file: 'js/chat.js', needle: 'if (window.activePrefix() === myPrefix) writeLsSnapshot(msgs, myPrefix, true);' },
  { name: '聊天页半框「批量设置问卷」入口锚点（template.html），供更多功能查必（用户多次反馈缺少批量问卷按钮）', file: 'template.html', needle: 'id="chat-ask-bulk"' },
  { name: '聊天页半框「批量设置问卷」跳转函数 openAskSurvey（ta-ask.js；从聊天半框进入批量问卷页，返回回聊天而非 TA 的询问），删掉即按钮失效复发', file: 'js/ta-ask.js', needle: 'window.openAskSurvey = function' },
  { name: '聊天页半框主输入框「一键清空 ✕」绑定（chat.js；问句输入框与帮我决定/多人决定同款 dec-inp-clear，删掉即无清除按钮复发）', file: 'js/chat.js', needle: "document.querySelector('#chat-ask-panel .dec-inp-clear[data-clear=\"chat-ask-input\"]')" },
  { name: '聊天气泡入场柔和动画（ease-out-quint 曲线，去 v3.27.x 过冲回弹；删掉或换回 old 曲线即突兀复发）', file: 'css/chat-main.css', needle: 'cubic-bezier(.22,1,.36,1)' },
  { name: 'TA 自发消息跟底平滑滚动（rAF+ease-out 三次加速，代瞬时 scrollTop 的一跳；删除/改回 scrollChatBottom 即突兀复发）', file: 'js/chat.js', needle: 'const dur = Math.min(360, 180 + (target - start) * 0.35);' },
  { name: '#516 TA 自发消息跟底「插入帧内同步贴底」（用户 2026-09-15 报「除了第一条有优化，其他消息还是飞出来的」：旧实现新气泡先在视口下方 +38.7px 渲染、再用 ~200ms 平滑滑上来＝肉眼一条条飞出；改为插入同帧同步贴底＝气泡贴底长出、零滑动。删此行或改回先插后滚即复发。平滑滚动保留作 #162 兜底复写）', file: 'js/chat.js', needle: 'scrollChatBottom(); // FIX 2026-09-15 #516 插入帧内同步贴底' },
  { name: '#516 聊天贴底目标统一取值 chatScrollMax（打字行可见时必须扣回行高：#514 治了 showTyping/hideTyping 两个写点，但 out 侧 120ms / in 侧 rAF+150ms 兜底仍可能在打字行显示期执行——落到「行显示态最大值」上，行一隐藏必被内核钳掉一行高＝残根下弹 22px。删除则打字行显隐期兜底复写再次过界）', file: 'js/chat.js', needle: 'function chatScrollMax() {' },
  { name: '#516 scrollChatBottom 写入走 chatScrollMax（旧 scrollTop=scrollHeight 在打字行可见时落在虚高一份行高的钳位目标上；删除则回弹复发）', file: 'js/chat.js', needle: 'cb.scrollTop = chatScrollMax();' },
  { name: '#471 聊天页问TA半框底部【发送/取消/存入】按钮（template.html；108b918 误删后聊天中单问题无法发送，删除/改 id 即复发）', file: 'template.html', needle: 'id="chat-ask-ok">发送' },
  { name: '#472 批量问卷返回走 enterChat 恢复聊天页本体（#523 起收进 surveyGoChat 统一出口；此前只回显桌面聊天图标导致全部 .page 隐藏、.phone 折叠 tabbar 飞到顶，改回图标显隐即复发）', file: 'js/ta-ask.js', needle: 'if (window.enterChat) { window.enterChat(); return; }' },
{ name: '#474 聊天设置/房间/群聊等 8 个子页整页白屏——chat-ask-panel 缺少闭合 </div>，后续全部 .page 被吞进 #page-chat 内（父级一隐藏子级联动消失，与 #467 tabbar 嵌套同族；108b918 删按钮时连闭合一起删，#471 恢复按钮但漏恢复该闭合。结构性回归，所有机型必现）。结构锚＝修复后 chat-ask-actions 之后必须存在「3 个连续 </div> 接寻踪半框注释」（缩进 10/8/6 ＝ chat-ask-actions / poke-card-scroll / chat-ask-panel 三层，见 template.html #474 FIX 注释；改缩进必须同步本 needle，否则哨兵失配）；缺任何一个闭合（回到 2 个）即消失报警', file: 'template.html', needle: '</button>\n          </div>\n        </div>\n      </div>\n      <!-- 寻踪半框' },
  { name: '#471 设置页「导出全部桌面聊天记录」UI（template.html；改 id/删除即 cs-export-all 失效复发）', file: 'template.html', needle: 'id="cs-export-all"' },
  { name: '#471 设置页「导入全部桌面聊天记录」UI（template.html；改 id/删除即 cs-import-all 失效复发）', file: 'template.html', needle: 'id="cs-import-all"' },
  { name: '#471 设置页全部桌面导入分路写回（data-backup.js importChatAllGo：非当前桌面走 writeDeskChat 写 IDB+账本+LS 快照，删掉即导入全部桌面只写当前桌面、旧桌面全部丢失复发）', file: 'js/data-backup.js', needle: 'function writeDeskChat(cid, arr) {' },
  // #582（2026-09-16 用户：「设置里导出数据和导入数据，缺少可选 导出/导入全部桌面联系人的聊天记录」）——
  // 原来「仅聊天记录」只在数据 >150MB 的导出弹窗里存在，导入侧干脆没有这条路。
  { name: '#582 导出选范围不再按体积设门槛（absent：出现 MODE_ASK_BYTES 即回退「小库不弹、仅聊天记录选不到」——用户报的「缺少可选」根因）', file: 'js/data-backup.js', needle: 'MODE_ASK_BYTES', absent: true },
  { name: '#582 导出弹窗「仅聊天记录」胶囊（删/改 value 即设置页选不到只导聊天）', file: 'js/data-backup.js', needle: "{ label: '仅聊天记录', value: 'chat' }" },
  { name: '#582 「仅聊天记录」范围＝各桌面 chat-msgs（含旧顶层键）+ 群聊键（删 GROUP_CHAT_KEY_RE 分支即群聊记录不再进备份）', file: 'js/data-backup.js', needle: 'function isChatMsgKey(k) { return CHAT_KEY_RE.test(k) || GROUP_CHAT_KEY_RE.test(k); }' },
  { name: '#582 聊天备份带上消息引用到的媒体池条目（@@m: 令牌指向的池键；删即换机恢复后图片语音全空，原设备上还看不出来）', file: 'js/data-backup.js', needle: 'mediaRefQueue = Array.from(mediaRefs);' },
  { name: '#582 导入入口先选范围（完整备份 / 仅聊天记录；删即导入数据又只剩整包一条路，会覆盖设置字卡音乐）', file: 'js/data-backup.js', needle: "if (v === 'chat') { window.runChatAllImport(); return; }" },
  { name: '#582 聊天导入认旧顶层键 xy-home-v2:chat-msgs 与各联系人 c<base36> 命名空间（旧正则只认 c\\d+，默认桌面的旧顶层键会被整段漏掉）', file: 'js/data-backup.js', needle: 'const chatKeyRe = /^xy-home-v2:(?:chat-msgs|(?:default|c[0-9a-z]{5,}):chat-msgs)$/;' },
  { name: '#582 聊天导入写回群聊（走 gcWriteGroupMsgs；删即备份里的群聊记录导不回来＝只导不入）', file: 'js/data-backup.js', needle: 'if (window.gcWriteGroupMsgs) return window.gcWriteGroupMsgs(w.gid, w.arr);' },
  { name: '#582 群聊消息写回通道（group-chat.js gcWriteGroupMsgs：lite 快照 + IDB 权威，条数与全量一致防旧快照压住新导入；删即群聊导入静默无效）', file: 'js/group-chat.js', needle: 'window.gcWriteGroupMsgs = function (gid, arr) {' },
  { name: '#582 分桌写回返回真 promise（absent：自造 thenable「if (!seq) f(); return seq;」永不 settle，写入链在第一个非当前桌面后整条卡死——多桌面只恢复第一个、群聊与媒体池永不执行）', file: 'js/data-backup.js', needle: 'if (!seq) f(); return seq;', absent: true },
  // #582 第二批（2026-09-16 用户追问「还有什么缺陷 + 没说明为什么本机内存是导出数据的 2 倍」后逐项实测）
  { name: '#582 导出体积预估按 UTF-8 字节＋JSON 转义（esc 参数管「JSON 字符串值再转义一次」的引号开销，删/改回字符数＝中文为主的库预估偏小，实测纯中文库文件 370KB vs 存储 313KB，「文件是存储一半」说反）', file: 'js/data-backup.js', needle: 'function estUtf8Bytes(s, esc) {' },
  { name: '#582 体积实测不吃「LS 已计过」去重（absent：权威键 chat-msgs/群聊的 LS 只是有损小快照，一刀切跳过 IDB 权威值会把整段聊天体积算成 0——用户报「2 倍」的现场之一）', file: 'js/data-backup.js', needle: 'if (lsC !== undefined && lsC <= LS_SMALL_LIMIT && !auth) { c = 0; fb = 0; blob = 0; }' },
  { name: '#582 「仅聊天记录」体积预估接线（absent 或改成漏传＝弹窗恒显示「仅聊天记录 0 KB」，本批自己踩过一次）', file: 'js/data-backup.js', needle: 'chatFile: m.chatFile' },
  { name: '#582 弹窗说明存储/文件两把尺子（用户问「为什么本机内存是导出数据的 2 倍」；删则又变成两个数没有任何解释）', file: 'js/data-backup.js', needle: '两个数口径不同：本机数据按存储占用算' },
  { name: '#582 范围弹窗走宽版（big；删则 272px 窄弹窗把胶囊与「开始导出」顶到折线外＝用户以为弹窗只有说明）', file: 'js/data-backup.js', needle: "noInput: true, okText: '开始导出', pill: 'full', lock: true, big: true," },
  { name: '#582 仅聊天记录单独文件名（删则导出文件又和完整备份同名「mochi数据备份_日期.json」，用户分不清手里这份能恢复什么）', file: 'js/data-backup.js', needle: "(cfg.mode === 'chat' ? 'mochi聊天记录_' : 'mochi数据备份_')" },
  { name: '#582 导入桌面聊天后清该桌面尾巴日志（chat-tail，#180）：不清则切到该桌面时 chatTailMerge 把导入前的旧消息当「没落盘的新消息」回放上来', file: 'js/data-backup.js', needle: 'function clearDeskTail(cid) {' },
  // #359→#437（2026-09-14 用户确认同内容须可重发，多机型同报误吞）：发件侧媒体窗口 8000→800ms。
  // 原锚（return 8000）随口径演进更新；800ms 仍吞机械双派发（150ms 双 click/606ms 长任务延迟），
  // 有意重发（重开面板 ≥1s）放行；收件侧 60000ms 不变。
  { name: '#359→#437 发送侧媒体去重窗 800ms（改回 8000＝同表情 8s 内有意重发被静默吞；改回 2500＝#359 双派发出 2 个复发）', file: 'js/chat.js', needle: "if (m.type === 'sticker' || m.type === 'image' || m.type === 'voice') return 800;" },
  { name: '#437 parts 型纯图片发件侧同窗 800ms（删/回 8000＝同相册图 8s 内重发被静默吞）', file: 'js/chat.js', needle: "&& (m.side || '') === 'out') return 800;" },
  { name: '#437 addRec 发件侧吞并 toast 反馈（删则恢复静默吞＝「发不出去」报障源回流）', file: 'js/chat.js', needle: "!rec.silent && typeof toast === 'function') toast('同样的内容刚发送过，未重复发送');" },
  { name: '#437 发送按钮双击守卫吞并 toast 反馈（守卫语义不变，吞并须可见；删则双击发送静默无反馈回流）', file: 'js/chat.js', needle: "try { toast('同样的内容刚发送过，未重复发送'); } catch (e) {}" },
  { name: '#466 键盘/视口 resize 钉住回钉守卫（聊天视口高度变化且仍贴底钉住时不刷新 scrollTop→消息被键盘顶到上半区、发送时才拽回=「闪一下」；删掉守卫线即复发）', file: 'js/chat.js', needle: 'if (!chatVisible() || !chatPinnedBottom) return;' },
  { name: '#466 键盘/视口 resize 回钉监听（visualViewport resize→refreshKbRepin；删监听＝键盘开合不再回钉、上半区闪动复发）', file: 'js/chat.js', needle: 'vv466.addEventListener(\'resize\', refreshKbRepin)' },
  { name: '#G1 点联系人头像开拍一拍 pointerup 轻点判定（位移<=12px 且 <=450ms 才算点；退回纯 click 监听＝部分内核合成 click 被吞、拍一拍打不开复发，多机型同报）', file: 'js/chat.js', needle: 'if (dt > 450 || dx * dx + dy * dy > 144) return;' },
  { name: '#G1 拍一拍 click 兜底防双开（pointerup 已开后吞补发 click 且 stopPropagation，防 document 层「点外关闭」把刚打开的面板立刻关掉；删掉即面板开不开/开了秒关）', file: 'js/chat.js', needle: 'if (Date.now() < pokeTapGuard) { e.preventDefault(); e.stopPropagation(); return; }' },
  { name: '#G1 拍一拍 touchstart 布点（五保险 touch 路：无 PointerEvent 旧内核/内嵌 WebView 只派发 touch，pointer 永不触发+click 必吞=唯一入口；删掉布点即旧内核拍一拍打不开复发）', file: 'js/chat.js', needle: 'pokeTapT = { x: t.clientX, y: t.clientY, t: Date.now(), id: t.identifier };' },
  { name: '#G1 拍一拍 touchend 轻点判定（touch 路同口径判滑动/按住；删掉则旧内核轻点不再开面板，与 pointer 路文本异形保证哨兵唯一）', file: 'js/chat.js', needle: 'if (dx * dx + dy * dy > 144 || dt > 450) return;' },
  { name: '#G2 长按气泡 contextmenu 同步开动作菜单（内核长按被 touchcancel/文本操作条打断时定时器路径失效＝引用菜单打不开复发；删掉 openMsgActionsAt(ctxR.. 分支即断，桌面右键同步受益）', file: 'js/chat.js', needle: 'if (!msgActions || msgActions.hidden || activeMsgEl !== ctxR.item) {' },
  { name: '#G2 长按容忍手指微移（按住 500ms 窗口内 <12px 的 touchmove 不再清长按定时器，真实滑动仍取消；删掉＝部分内核按住必然的小漂移把长按打断、菜单永不出现复发。#480 同批同步：同分支追加轻点布点失效，改这里连 #480 语境一起看）', file: 'js/chat.js', needle: 'if (mdx * mdx + mdy * mdy > 144) { endMsgHold(); msgTapStart = null; msgAnyTap = null; }' },
  { name: '#480 轻点气泡 touch 直驱开菜单（「合成 click 被吞」族内核——Via/夸克等 WebView 壳——点气泡后内核 click 永不触发＝菜单打不开＝「无法引用消息」；删掉 openMsgActionsAt(ts.. 直驱分支即断）', file: 'js/chat.js', needle: 'openMsgActionsAt(ts.item, ts.b);' },
  { name: '#480 菜单按钮 touch 直驱防双触发（【引用】按钮原只有 click 一条路，click 被吞内核上菜单开了点引用没反应＝无法引用；动作体提为 maRunAction + touchend 直驱 + guard 吞补发 click，删掉 guard 检查＝双跑复发）', file: 'js/chat.js', needle: 'if (Date.now() < maClickGuard) return;' },
  { name: '#480 群聊菜单按钮 touch 直驱（对齐单聊；群聊【引用】原只有 click 路，click 被吞内核＝群聊无法引用；删掉 gcRunAction 的 touchend 直驱即断）', file: 'js/group-chat.js', needle: 'if (Date.now() < gcMaClickGuard) return;' },
  { name: '#480 群聊长按微移容错（对齐单聊 #G2：>12px 才算滑动取消；原 touchmove 一动即清定时器＋contextmenu 不开菜单＝群聊引用菜单永不出现复发）', file: 'js/group-chat.js', needle: 'if (gmdx * gmdx + gmdy * gmdy > 144) { endGcHold(); gcTapStart = null; }' },
  { name: '#481 面板点外关闭（#480 轻点直驱回归收窄：吞 click 窗口只在「本次轻点真的关了消息菜单」的 touch 点外关闭分支布点，与消息菜单无关的普通轻点 click 放行到 document 层——原实现任意轻点无条件布 800ms guard＋body 层 stopPropagation，把 document 上的更多功能/表情包/拍一拍等面板外关闭监听全拦死＝点外面板关不掉，全机型回归；改回无条件布点即断）', file: 'js/chat.js', needle: 'msgSuppressClickUntil = Date.now() + 800;' + String.fromCharCode(10) + 'closeMsgActions();' },
  { name: '#467/#477 tabbar 存在+缩进锚：底部导航块必须在位且 tab 缩进 4 空格（嵌进任何 .page 内随 hidden 联动 display:none → 桌面底部 3 按钮消失＝#467；整块删除＝导航消失。位置闭合锚见下条；改 tabbar 区缩进必须同批同步本 needle 与 tools/verify-page-nesting.mjs S3/S5）', file: 'template.html', needle: '<div class="tabbar">\n    <div class="tab active" data-page="page-phone">' },
  { name: '#477 tabbar 位置闭合锚（tabbar 闭合 2 空格 → .phone 闭合 2 空格 → #477 移除说明注释，三行序列；tabbar 被移到 .phone 闭合之外＝body 直子被 flex 横排排到手机壳右侧＝红米 K80 等多机型「底部导航跑到右侧」、重嵌进任何 .page、.phone 闭合多补/少补，任一形态都破坏该序列＝报警。序列以 \\n 锚行首防 6 空格闭合的尾部假匹配）', file: 'template.html', needle: '\n  </div>\n  </div>\n\n<!-- （#477）tabbar 原先位于本注释处' },
  { name: '#360 字卡去重跨分组判重（seen 按分类建不按分组建+对象卡稳定序列化判重；退回「每组各建 seen 按引用比较」即换分组清不出重复，公用/专属两作用域同源复发）', file: 'js/chatcard.js', needle: 'function ccCardDupKey(cat, c) {' },
  { name: '诊断采集与设置页 DOM 解耦（row 在使用处按需判空，错误/环境/长任务/轨迹不因入口 DOM 缺失而失效）', file: 'js/device.js', needle: 'if (!row) return null;' },
  { name: '诊断复制不再 focus 隐藏 textarea（防手机弹输入法+灰屏，ta.focus 删除型守护；needle 收窄到 device.js copyText 的 appendChild(ta);ta.focus(); 上下文——裸 ta.focus(); 在 chat.js/decision.js/divination.js/group-decision.js 合法存在会误报）', file: 'js/device.js', needle: 'appendChild(ta);ta.focus();', absent: true },
  { name: '诊断电量 getBattery 废弃显式降级（不支持时输出一行而非静默消失）', file: 'js/device.js', needle: '无 getBattery 接口' },
  { name: '诊断超长文本引导导出 docx（>8KB 提示剪贴板可能截断，优先导出；#227 txt→docx 同步改锚）', file: 'js/device.js', needle: '建议优先【导出docx】' },
  { name: '诊断 toast 统一 ccToast（diagToast 与 LS 失效 notice 共用元素防互相顶掉）', file: 'js/device.js', needle: 'function ccToast(msg) {' },
  { name: '诊断错误去重按 msg+页面 30s 窗口（防同类错误刷满环形缓冲）', file: 'js/device.js', needle: 'const dupIdx = arr.findIndex(function (it) {' },
  { name: 'iOS 15 拆 script 块（产物多块，防单块超 600KB 触发 WebKit 解析崩溃/白屏）', file: 'index.html', needle: '</script>\n<script>' },
  { name: '颜文字缺字形字符已替换（ᴥ absent，fix-kaomoji-chars 第二批）', file: 'index.html', needle: 'ᴥ', absent: true },
  { name: 'iOS 键盘输入栏停靠（_ensureInputDocked）', file: 'js/mobile-adapt.js', needle: '_ensureInputDocked' },
  { name: 'iOS 保活音频静音（kaIsIOS/0.002）', file: 'js/bg-keep.js', needle: 'kaIsIOS' },
  { name: '批量导入按行拆分（\\r\\n|\\r|\\n）', file: 'js/chatcard.js', needle: 'split(/\\r\\n|\\r|\\n/)' },
  { name: 'GIF 动图直存（跳过压缩）', file: 'js/chatcard.js', needle: 'isGif' },
  { name: '新文件接入产物（钓鱼/记忆翻牌/我的档案）', file: 'index.html', needle: 'fishing' },
  { name: '新文件接入产物（漂流瓶）', file: 'index.html', needle: 'drift-bottle' },
  { name: '新文件接入产物（TA的心情）', file: 'index.html', needle: 'ta-mood' },
  { name: '多联系人切换渲染修复（applyAvatars）', file: 'js/contacts.js', needle: 'applyAvatars' },
  { name: '信箱数据丢失防护（mailDbReady）', file: 'js/mail.js', needle: 'mailDbReady' },
  { name: '大图崩溃防护（>8MB 拦截）', file: 'js/personalize.js', needle: '8 * 1024 * 1024' },
  { name: '情绪字卡总开关（triggerEmotionChain 总闸）', file: 'js/mood-reply-cards.js', needle: 'if (!enabled(\'mood\')) return null' },
  { name: '通知图标降级（noMedia）', file: 'js/bg-keep.js', needle: 'noMedia' },
  { name: '引用快照防 base64 霸屏（quoteTextOf/quoteSnapOf）', file: 'js/chat.js', needle: 'function quoteTextOf' },
  { name: '设备判定手动布局兜底（__layout-pref）', file: 'js/device.js', needle: 'pref:mobile' },
  { name: '全屏横屏判定改判物理方向（viewportLandscape）', file: 'js/fullscreen.js', needle: 'function viewportLandscape' },
  { name: '收藏判重按归属（TA收藏不挡我的收藏）', file: 'js/chat.js', needle: "(f.by || 'me') !== 'ta'" },
  { name: '收藏启动回填只补不覆盖（防旧IDB快照回滚）', file: 'js/chat.js', needle: "cur.length <= 2) store.set('fav-msgs'" },
  { name: '语音播放钮互动态·双图标（playing 三角换暂停竖条）', file: 'js/chat.js', needle: 'voice-ico-pause' },
  { name: '语音播放钮互动态·按压反馈（:active 微缩）', file: 'css/chat-main.css', needle: '.msg-voice-play:active' },
  { name: '邀请TA输入栏 ce-box 常驻合成层 + 抬高内边距高（防文字飞出输入栏，同 #118 tc-input.ce-box）', file: 'css/chat-main.css', needle: '.chat-ask-input.ce-box { will-change: transform; min-height:48px !important; }' },
  { name: '邀请TA批量管理入口（toggleInviteBatch）', file: 'js/chat.js', needle: 'function toggleInviteBatch()' },
  { name: '邀请TA批量勾选字卡（inv-batch-cb-in）', file: 'js/chat.js', needle: 'inv-batch-cb-in' },
  { name: '邀请TA批量下自建分组 ✎重命名/✕删除（inv-g-op rm）', file: 'js/chat.js', needle: 'data-op="rm">✕' },
  { name: '邀请TA批量分组标签用 escTxt 转义（防 esc 未定义使批量态整栏断裂用不了）', file: 'js/chat.js', needle: 'escTxt(g.label) + g.cards.length +' },
  { name: '邀请TA预设分组持久化（预设字卡才能单独修改/删除）', file: 'js/chat.js', needle: 'if (!myInviteGroups.some(g => g[0] === \'__preset\')) {' },
  { name: '#134 文档尾部 EOF 双锚点（SW 校验用注释 + device.js 自检用 DOM 锚点）', file: 'template.html', needle: '<span id="mochi-html-eof" hidden aria-hidden="true"></span>' },
  { name: '#134 device.js 文档完整性自检+自愈重载（限 1 次防循环）', file: 'js/device.js', needle: "const FLAG = 'mochi-trunc-reloaded';" },
  { name: '#134 doDrop 自嵌套防线（整组网格不可拖拽，防 HierarchyRequestError 拖拽报废）', file: 'js/personalize.js', needle: "dragged.contains(info.ref)) return;" },
  { name: '#134 拖拽落点排除整组图标网格（app-grid 本身不再作为 dragged）', file: 'js/personalize.js', needle: "dragged.classList.contains('app-grid')) return null;" },
  { name: '#135 idb open() 兜底落地超时（open 挂起→idbRestore 永不完成→开屏卡死，iPad 7 Edge）', file: 'js/idb.js', needle: "reject(new Error('idb open hang'))" },
  { name: '#135 idb open() onblocked 处理（版本升级被旧连接阻塞时永不落地同上）', file: 'js/idb.js', needle: 'req.onblocked' },
  { name: '#135 开屏 20s 硬保险丝 readyForced（数据未就绪也放行进入，开屏永不死锁）', file: 'js/clock.js', needle: 'readyForced' },
  { name: '#137 miniSafeTop 三级探测链（env 探针→差值→59px 兜底，通话小框永不落进系统状态栏区）', file: 'js/call.js', needle: 'if (!top) top = 59;' },
  { name: '#137 小框显示时抬升 liftMiniIntoSafeArea（5 处显示点统一校正旧坐标）', file: 'js/call.js', needle: 'function liftMiniIntoSafeArea()' },
  { name: '#147 壁纸常驻图层（进出桌面只切 opacity 不清空/重设 backgroundImage，修 iOS 反复主线程解码大图巨卡）', file: 'js/personalize.js', needle: 'const setBgLayerImage = (data) => {' },
  { name: '#147 图层值变才写+隐藏保留图（setBgLayerVisible opacity 短路）', file: 'js/personalize.js', needle: "const v = on ? '1' : '0';" },
  { name: '#140 desk-layout 完整性校验+坏键自愈（损坏/空壳布局清键回默认，修华为Pura70Pro+/Chrome 等安卓「小组件卡片大部分不显示」——坏值会把全部卡片扫进隐藏池且 IDB 回填每次复发）', file: 'js/personalize.js', needle: "console.info('[mochi] desk-layout 校验失败（损坏/空壳），忽略并清除')" },
  { name: '#140 隐藏池不收「列在缺失页」的组件（inAnyPage 有名即不进池，防删页/校验重建后误判布局外整批隐藏）', file: 'js/personalize.js', needle: 'if (inAnyPage[wid]) return;' },
  { name: '#140 saveDeskLayout 写前防损坏（重复 id/页数超界放弃保存清键，不把坏值固化进 IDB）', file: 'js/personalize.js', needle: "if (!ok) { try { store.remove('desk-layout'); } catch (e) {} return lay; }" },
  { name: '小组件独立透明度（widget-opacity-<type> 内联覆盖全局，装修模式点卡片单调+可应用到全部）', file: 'js/personalize.js', needle: "const widgetOpKey = (type) => 'widget-opacity-' + type;" },
  { name: '#140 deskRebuild 页数钳制（idx≥slides.length 时不再把 scrollLeft 设到超界空白页位，修滑页停在空白=卡片全不显示的视觉形态）', file: 'js/desktop-slider.js', needle: 'Math.min(Math.max(slides.length - 1, 0), idx)' },
  { name: '#141 安卓返回键/手势收键盘灰块几秒才收（vv 高度上升探测置 _aClosing：收起动画期零强制布局读取，焦点保留 focusout 不来也生效）', file: 'js/mobile-adapt.js', needle: 'if (_aKb && h > _aPrevH && _aPrevH > 0) {' },
  { name: '#141 收起复原时 _aH 基线钳回布局视口全高（防基线停留低位把 .phone 锁死中间高度=灰块不收）', file: 'js/mobile-adapt.js', needle: 'if (_aH < window.innerHeight - 12) _aH = window.innerHeight;' },
  { name: '#141 悬浮键盘推定收口（用户键入 1200ms 内即放行推顶，不等 2200ms 无活动自愈）', file: 'js/mobile-adapt.js', needle: 'if (!tgt || Date.now() - _aUserTypos > 1200) return;' },
  { name: '#144 isIOS 补 iPadOS 伪装 UA 分支（Macintosh+触摸屏，修 iPad Air 全屏开关无反应/ios-pwa-standalone 类不加）', file: 'js/device.js', needle: "((navigator.platform === 'MacIntel' || /Macintosh/i.test(ua)) && navigator.maxTouchPoints > 1 && 'ontouchstart' in window);" },
  { name: '#144 armFgIdbReset 补 touchMac 分支（伪装 UA 的 iPad 回前台重建 IDB 连接；收口第二批改读 mochiDevice.isIOS——device.js isIOS 含 Macintosh 伪装分支，删门=伪装 iPad 断连不重建）', file: 'js/idb.js', needle: 'if (!((window.mochiDevice || {}).isIOS)) return;' },
  { name: '#148 syncVvFit 顶部避让改 env() 探针实测（iOS26 已避让形态 env=0 不再加页面 padding，修 Mochi 行上方大空白）', file: 'js/mobile-adapt.js', needle: 'padding-top:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none;' },
  { name: '#148 fs 态写 --mochi-ios-h（判定器 expBase：envTop+inner min 屏高，覆盖=整屏/已避让=inner；#210 起公式收敛到共享判定器）', file: 'js/mobile-adapt.js', needle: 'Math.round(_f.expBase) : 0' },
  { name: '#148 fs 态 .phone 高度用 --mochi-ios-h（回 100vh 兜底）', file: 'css/base.css', needle: 'height:var(--mochi-ios-h, 100vh);' },
  { name: '#175 屏幕适配诊断入口（设置页 row-screen-diag，与信息诊断分开）', file: 'template.html', needle: 'id="row-screen-diag"' },
  { name: '#175 屏幕适配诊断采集+纯函数判定器（六形态自动判定）', file: 'js/device.js', needle: 'function screenDiagJudge(inp)' },
  { name: '#177 功能诊断入口（设置页 row-func-diag，逐项测试全部功能）', file: 'template.html', needle: 'id="row-func-diag"' },
  { name: '#177 功能诊断采集器（T1 入口/T2 容器/T3 真实打开三极测试）', file: 'js/device.js', needle: 'async function collectFuncDiag()' },
  { name: '#185 屏幕适配采集器：状态栏隐藏跳过+相对 .phone 测量（聊天页误报顶部重叠修复）', file: 'js/device.js', needle: 'sbTop: (sr && pr) ? Math.round(sr.top - pr.top)' },
  { name: '#185 fs standalone 文档滚动锁（修 iPad 橡皮筋弹跳/滑动飞）', file: 'css/base.css', needle: 'html.ios-pwa-standalone.ios-fs-active body { height:var(--mochi-ios-h, 100vh); min-height:0; overflow:hidden;' },
  { name: '#185 平板 iOS 全屏全宽铺满（修 640 限宽左右露白）', file: 'css/base.css', needle: 'html.tablet.ios-fs-active .phone { width:100vw; max-width:none; }' },
  { name: '#212 force 声明形态自愈看门狗（发消息键盘周期后白带/上移 1s 内自动复位）', file: 'js/mobile-adapt.js', needle: 'if (_short > 8) {' },
  { name: '#213 视口时间线环形缓冲（每秒 1 拍保留 60 条，瞬态回放数据源）', file: 'js/mobile-adapt.js', needle: 'function vvLogPush()' },
  { name: '#213 屏幕适配报告尾部视口时间线回放段', file: 'js/device.js', needle: '近 60 秒视口时间线（键盘开合/缩放/白带瞬态回放）' },
  { name: '#213 报告系统版本行（形态判定依赖 iOS/Safari 版本映射）', file: 'js/device.js', needle: "系统=' + (inp.osLine" },
  { name: '#214 屏幕适配报告页面专项：聊天页（可见/消息节点/输入栏贴底）', file: 'js/device.js', needle: '输入栏：底边=' },
  { name: '#214 屏幕适配报告页面专项：主页（页数/图标/池内组件清单）', file: 'js/device.js', needle: '池内组件=' },
  { name: '#216 聊天页键盘期专项：键盘高度/输入栏底边采集（上移/被盖直接定位）', file: 'js/device.js', needle: 'inp.chat.kbActive' },
  { name: '#174 viewport meta 锁 minimum-scale=1（iOS26 主屏幕形态 scale≈0.85 缩小致顶部露白，meta 防线）', file: 'template.html', needle: 'minimum-scale=1.0' },
  { name: '#174 独立应用缩放异常自愈（scale<0.95 重写 viewport meta 吸附回 1，限 3 次）', file: 'js/mobile-adapt.js', needle: '_zoomFixCnt < 3 && _now - _zoomFixAt > 4000' },
  { name: '#146 组件透明度小数脏值解析 opacityRawToPct（≤1 按 ×100 换算，修随机美化写 0.9/1 被 parseInt 成 0 → 小组件全透明）', file: 'js/personalize.js', needle: 'opacityRawToPct' },
  { name: '#146 一键随机美化功能已删除（row-beauty-random 处理块 absent）', file: 'js/personalize.js', needle: "getElementById('row-beauty-random')", absent: true },
  { name: '#146 随机美化入口已删除（template absent）', file: 'template.html', needle: 'row-beauty-random', absent: true },
  { name: '#151 壁纸图层 size/pos 每次刷新（移出「图变才写」守卫，修壁纸定位/缩放改键不生效+同图异 pos 跨桌面串用=背景不按比例铺满；图本身仍值变才写保 #147 防 iOS 重解码）', file: 'js/personalize.js', needle: 'if (l.style.backgroundSize !== szWanted) l.style.backgroundSize = szWanted;' },
  { name: '#151 无布局桌面还原模板排布（applyDeskLayout 无布局不再直接 return，归还被上个桌面扫进隐藏池的组件、修「切联系人回来小组件隐藏/桌面串显示」）', file: 'js/personalize.js', needle: 'if (!lay) { restoreTemplateDesk(); return; }' },
  { name: '#151 切桌面期间 buildDeskPages 删页收缩不落盘（防把上一桌面排布写成新桌面 desk-layout=跨桌面污染持久化）', file: 'js/personalize.js', needle: 'if (deskLayout() && !deskSwitchBuild) saveDeskLayout();' },
  { name: '#151 切桌面美化键缺键复位（widget-opacity 无键回 100，修上一桌面透明度残留=小组件隐身但可点/不同桌面显示不一样）', file: 'js/personalize.js', needle: 'if (!isNaN(opPct)) applyWidgetOpacity(opPct); } else applyWidgetOpacity(100); }' },
  { name: '#151 美化抽屉透明度滑杆统一解析+存百分比整数（不再写 #146 同族小数脏值/不再把存量 90 算成 9000；#527b 重写紧凑抽屉后按新写法换锚，判定逻辑不变）', file: 'js/personalize.js', needle: "store.set('widget-opacity', String(Math.round(n * 100)))" },
  { name: '单聊联系人消息音效（addIn 播 sfx-in，read/silent 除外）', file: 'js/chat.js', needle: "opts.special !== 'read'" },
  { name: '音效等待 AudioContext resume 后再 start（Via/WebView）', file: 'js/sfx.js', needle: 'p.then(start)' },
  { name: '群聊引用防 base64 霸屏（gcQuoteTextSafe）', file: 'js/group-chat.js', needle: 'gcQuoteTextSafe' },
  { name: '聊天大数据分批/延迟归一化（防 OOM 崩溃）', file: 'js/chat.js', needle: 'scheduleDeferredNormalization' },
  { name: '消息长按打开操作菜单（openMsgActionsAt 长按+轻点）', file: 'js/chat.js', needle: 'openMsgActionsAt' },
  { name: '群聊消息长按打开引用菜单（gcOpenMsgActions 长按+轻点）', file: 'js/group-chat.js', needle: 'gcOpenMsgActions' },
  { name: '错误记录双写 IndexedDB（readErrs 回退读取，防"最近错误：无"丢线索）', file: 'js/device.js', needle: 'idbSet(ERR_KEY' },
  { name: '更新条防重复（ver-update-ack-ts 按版本免打扰 + showVerBar 跨通道收口）', file: 'js/pwa.js', needle: 'ver-update-ack-ts' },
  { name: '#225 更新条一直重复提醒收口v2（showVerBar 弹条门加 verSeen 一版一弹：同版本只弹一次不按时间过期+弱网无 ts 不绕过；新版本立即弹无任何时间窗——站点主口径一天可部署十几次，v1 的 24h 时间窗已废）', file: 'js/pwa.js', needle: '!verShouldNotify(onlineTs) || verSeen(onlineTs)' },
  { name: '#273 普通刷新自愈进新版（pageshow 冷加载对比云端版本，更新且本会话未尝试时 tryAutoUpgrade 走 PRECACHE_NOW+reload 自动进新版；session 守卫防死循环，失败退回更新条；字符串键压缩后仍在产物，比函数名锚稳）', file: 'js/pwa.js', needle: "'xy-home-v2:auto-upgrade-session'" },
  { name: '#273 弱网刷新兜底（拉 version.json 连败弹「网络异常」更新条+重试刷新入口，防弱网下顶部刷新按钮消失）；字符串锚压缩后仍在产物', file: 'js/pwa.js', needle: "'网络异常，未能确认最新版本'" },
  { name: '#279 自动升级防打断（重载落地前复核用户活动：auto 且用户已交互且前台时放弃重载退回更新条，防弱网预取几十秒后砸进会话中途「页面自己重开」；删/改该条件即断）', file: 'js/pwa.js', needle: 'auto && !autoReloadAllowed()' },
  { name: '公用拍一拍选中态去虚线统一（poke-tab-pub.sel 实心）', file: 'css/dark.css', needle: 'poke-tab-pub.sel { background:var(--ink)' },
  { name: '吃什么切菜单可直接选指定菜单（eatSwitchRenderChips 直选，不复用转盘）', file: 'js/p2-features.js', needle: 'function eatSwitchRenderChips' },
  { name: '导出聊天记录以 IDB 权威为准（lsBig 兜底，防取旧快照）', file: 'js/data-backup.js', needle: '留待 IndexedDB 权威读取' },
  { name: '恢复默认桌面预选中确认（ctl.pills 预选「确定恢复默认」，只点确定也生效）', file: 'js/personalize.js', needle: "ctl.pills([{ label: '确定恢复默认', value: '1' }], '1')" },
  { name: '内置壁纸预设可见性（bgPresetCss + applyBgVisibility 认预设）', file: 'js/personalize.js', needle: 'bgPresetCss' },
  { name: '应用美化方案预选中确认（桌面+聊天 ctl.pills 预选「应用」，只点确定也生效）', file: 'js/personalize.js', needle: "ctl.pills([{ label: '应用', value: 'ok' }], 'ok')" },
  { name: '冷启动回复池取回自定义字卡（v3.28.x 口径演进=#442：缺失即 hydrateLibScopes 按需取回+就绪判定不被默认字卡遮蔽；旧锚 function replyScopeGroups 随 #442 池视图收口移除）', file: 'js/chatcard.js', needle: 'if (window.hydrateLibScopes) window.hydrateLibScopes([\'public\', \'own\']);' },
  { name: 'TA档案删除确认预选「删除」pill（删除这条/了解/疑问/暂不适用/已了解 只点确定也生效）', file: 'js/memo-arc.js', needle: "saveArc(cur, arc); toast('已删除'); render();\n}, { noInput: true, pill: 'del', pills:" },
  { name: '我的档案删除确认预选「删除」pill（删除这条/描述卡 只点确定也生效；#106 收口时随 fan-out 重构改锚到 delLi 现文本）', file: 'js/my-arc.js', needle: "fanOutRemove(kind, id); toast('已删除'); render();\n}, { noInput: true, pill: 'del', pills:" },
  { name: '番茄钟提前结束预选「结束」pill（只点确定也生效）', file: 'js/p2-features.js', needle: "noInput: true, lock: true, pill: '1', pills" },
  { name: '导出进度遮罩 + 确认后再下载（impShow 复用 + anchorDownload 只在用户点确定后触发）', file: 'js/data-backup.js', needle: 'anchorDownload' },
  { name: '诊断复制改原生 execCommand + 按钮补 type=button（修点【复制】无反馈/整页刷新）', file: 'js/device.js', needle: 'document.execCommand(\'copy\')' },
  { name: '#113 诊断取消自动复制（点开不再弹输入法又收起致灰屏；手机剪贴板有字数上限、长文本静默截断，改由用户手动【复制】/【导出】；#227 txt→docx 同步改锚 exportDocx→#227 改名后锚 diagExportDocx）', file: 'js/device.js', needle: 'diagExportDocx(c ? c.text() : cur)' },
  { name: '#227 诊断导出 docx（手写存储式 ZIP 本地头签名——docx 生成本体；删掉改回纯文本即消失=「导出docx」点了下不动）', file: 'js/device.js', needle: 'setUint32(0, 0x04034b50' },
  { name: '弹窗底部按钮补 type=button（取消默认 submit 整页刷新）', file: 'index.html', needle: 'type="button" class="modal-btn copy" id="modal-export"' },
  { name: '编辑消息同步重建 parts（防发送新消息后重渲染回退成原文）', file: 'js/chat.js', needle: '.filter(p => p && p.k !== \'text\')' },
  { name: 'idbSet 写入挂起 4s 超时+重建重试（荣耀/Edge 事务挂起静默丢写）', file: 'js/idb.js', needle: '连接疑似挂起' },
  { name: 'idbHydrateKey 慢读取回 6s+8s（慢但可用 IDB 低端机自定义字卡取不回落兜底）', file: 'js/idb.js', needle: 'window.idbHydrateKey = function' },
  { name: '小键写日志 __wr-journal（杀进程回滚 LS 后设置开关回退的恢复链）', file: 'js/idb.js', needle: '__wr-journal' },
  { name: '语音开关去掉静默早退守卫 + mochi-wrj-heal 重同步（首点无反应）', file: 'js/chat-settings.js', needle: "document.addEventListener('mochi-wrj-heal', syncVs);" },
  { name: 'dc-* 开关监听 mochi-wrj-heal 重同步（退出重进设置回退自愈）', file: 'js/default-cards.js', needle: "document.addEventListener('mochi-wrj-heal', function () {\ntry {" },
  { name: '诊断「开关持久化体检」（LS/读取/IDB 三层值 + LS 写探针）', file: 'js/device.js', needle: '开关持久化体检' },
  { name: '自动备份副本已下线：启动时自动清理遗留副本释放空间（purgeLegacySnapshot）', file: 'js/data-backup.js', needle: 'purgeLegacySnapshot' },
  { name: '后台听歌不误报「会员/移出」弹窗（offerRemoveDamagedSong 后台直返不计数 + 回前台 bgResumeFails 清零）', file: 'js/music-player.js', needle: '后台冻结/断流误触发 onerror，不弹「移出」窗不计数' },
  { name: '#117 本地音乐刷新后播放失败（music-file 脏值守卫：plausibleLocalValue 形状校验 + LS 脏值跳过读 IDB + purgeLocalFile 清脏）', file: 'js/music-player.js', needle: 'function plausibleLocalValue(v) {' },
  { name: '聊天昵称与桌面解耦（chatLabel dk=null 只读 cs-lbl-*，不回退桌面键）', file: 'js/chat.js', needle: "chatLabel('cs-lbl-partner', null, 'TA')" },
  { name: '聊天设置昵称行不再显示跟随桌面（未设置显示默认占位）', file: 'js/chat-settings.js', needle: "未设置（默认 TA）" },
  { name: '通话昵称与聊天域解耦（cs-lbl-partner 优先，回退名片名，不读桌面键）', file: 'js/call.js', needle: "window.contactNameFor ? window.contactNameFor(currentCall.cid) : '')" },
  { name: 'migrateLegacy def/root 提升函数顶部（修启动 ReferenceError 中断迁移）', file: 'js/contacts.js', needle: 'const root = window.xyStore(G);' },
  { name: 'iOS Edge 视口事件盲区兜底（window resize/工具条显隐 + 1s 轮询并进自愈，修输入栏下空一大块/页面上移残留）', file: 'js/mobile-adapt.js', needle: "addEventListener('orientationchange', onIosVvEvent)" },
  { name: '位置面板返回按钮半屏也显示（.loc-back 默认 flex，修聊天寻踪半框入口无返回按钮无法关闭）', file: 'css/chat-pages.css', needle: '.loc-back {\ndisplay:flex;' },
  { name: '夜宵提醒专属字卡（nightcap 窗口抽「夜宵提醒/夜宵关心」池，不再复用"按时吃饭"文案）', file: 'js/p2-features.js', needle: 'DEF_EAT_REMIND_NIGHT' },
  { name: '房间放置/移动横幅取消钮能真正隐藏（.r-banner[hidden] 补 display:none，修「取消」弹窗一直不消失）', file: 'index.html', needle: '.r-banner[hidden] { display: none; }' },
  { name: '桌面「已摸鱼」卡与「今日情话」卡文字水平对齐（.mini-card fish .mc-b 与情话等高，修两卡标题/正文错位）', file: 'css/home.css', needle: '.mini-card[data-card-bg="fish"] .mc-b' },
  { name: '单聊持久化改空闲调度（schedulePersist，修发消息/来消息/切页 2~3s 长任务卡顿）', file: 'js/chat.js', needle: 'function schedulePersist' },
  { name: '群聊持久化改空闲调度（gSchedulePersist，同上修大群聊全量同步写卡顿）', file: 'js/group-chat.js', needle: 'function gSchedulePersist' },
  { name: '桌面长按误触入口已移除（仅「编辑布局」主动进移动模式，修图标被误拖乱/要求固定一行4个）', file: 'js/personalize.js', needle: 'pressTimer = setTimeout(() => {\npressTimer = null;\nenterMoveMode();\nstartDeskDrag(e, t);', absent: true },
  { name: '移动模式横滑翻页判定已移除（图标横向拖动直接拖拽，修华为只能竖着换排）', file: 'js/personalize.js', needle: 'Math.abs(dx) > Math.abs(dy) * 1.5', absent: true },
  { name: '恢复默认桌面等 IDB 删除落盘再 reload（防华为/慢 IDB 回填旧布局，修「恢复默认没生效」）', file: 'js/personalize.js', needle: "idbDelete(P + ':desk-layout')" },
  { name: '弹窗文件导入自动应用（_modalOpts 修 opts 作用域 ReferenceError，修「导入美化方案选完文件没反应」）', file: 'js/personalize.js', needle: '_modalOpts' },
  { name: '弹窗嵌套守卫（_openSeq：fire 内开新弹窗则外层 close 跳过，修「导出美化方案」选完来源看不到导出方式）', file: 'js/personalize.js', needle: '_openSeq' },
  { name: '美化导出/导入只保留文件方式（「复制文字」整体移除，防剪贴板截断/粘贴导入不可行）', file: 'js/personalize.js', needle: 'function showBeautyFallback', absent: true },
  { name: '经期温柔动作后缀六条全部进字卡库（WARM_SUFFIX 同源，dc-off-period 逐张开关；防只写 1 条回归）', file: 'js/default-cards-data.js', needle: '（把你往怀里带了带）' },
  { name: '导出 IDB-only 大键重试兜底（IDB 读取失败重试一次 + LS 终极兜底，修>200KB 信箱数据导出丢失）', file: 'js/data-backup.js', needle: 'const lsV = localStorage.getItem(k)' },
  { name: '导出确认弹窗显示功能覆盖清单 + 体积自动换算 MB（fmtSize/exportCoverage，修导出看不到导了哪些功能/只有 KB）', file: 'js/data-backup.js', needle: '导出内容（全局全部数据）' },
  { name: 'idbSet 写入失败计数成功即清零 + 大包写入超时按体积放大（修旧数据多「存储异常」弹窗每会话必现：偶发失败污染全会话计数+合法大包写入被 4s 误判）', file: 'js/idb.js', needle: '成功即清零——只对连续失败告警' },
  { name: '拍一拍人称修复（sendPoke/performPoke 存 {me}/{ta} 占位符 + 渲染层 taFit 期间遮罩占位符，昵称不再被称呼改写成 他/ta/她）', file: 'js/chat.js', needle: "const hasPh = t.indexOf('{ta}') >= 0 || t.indexOf('{me}') >= 0" },
  { name: '打砖块球数切换即时生效（进行中切球数立即补发/剪除，不打断对局，修「玩的时候切换2个球无效」）', file: 'js/breakout.js', needle: 'while (state.balls.length > target) {' },
  { name: '打砖块进行中可放弃旧局重新开局（resume 分支副按钮=「新开局」，修「开启无法选多个球」）+ 结束面板副按钮文字重置', file: 'js/breakout.js', needle: "overlayCloseBtn.textContent = '新开局'" },
  { name: '音乐·TA 暂停再播放互动（播放中 taPauseProb 小概率 TA 暂停→发字卡→3.5s 后点播放恢复→再发字卡；设置可调、字卡库「音乐」tab 逐张开关）', file: 'js/music-player.js', needle: 'taPauseProb' },
  { name: '音乐·TA 暂停权限开关 + 防连发（taPauseEn 总开关关闭=彻底不触发；同一首歌只互动一次 + 冷却防"一直暂停又继续"）', file: 'js/music-player.js', needle: 'taPauseEn' },
  { name: '音乐·TA 暂停再播放字卡数据（「TA 暂停播放/TA 恢复播放」两组进系统预设字卡【其他互动功能字卡→音乐】）', file: 'js/default-cards-data.js', needle: 'TA 暂停播放' },
  { name: '音乐·TA 暂停播放补聊天系统消息（暂停时除字卡外再发"XX 暂停了音乐"系统消息，与其他音乐互动一致）', file: 'js/music-player.js', needle: '暂停了音乐' },
  { name: '音乐·TA 恢复播放补聊天系统消息（恢复时除字卡外再发"XX 又播放了音乐"系统消息）', file: 'js/music-player.js', needle: '又播放了音乐' },
  { name: '弱网/断网 play 拒绝回调判空（audio 异步回调期间可能已被 teardown 置空 → 先判空再解锁播放，修「Cannot read properties of null (reading \'play\')」红米K80 断网崩溃）', file: 'js/music-player.js', needle: '判空防 null.play()' },
  { name: '桌面图标 IDB 回填并行（Promise.all 一次读完 app-icon-*，修更新后首启「上传的图标图片消失数秒刷新才回来」）', file: 'js/personalize.js', needle: 'Promise.all(iconKeys.map' },
  { name: '互动卡片收藏全覆盖（cardSnapshot 补齐 ask/红包/送花/礼物/佳肴 + 心形按 data-idx 定位，修「有的卡片可以收藏有的点击无效」）', file: 'js/chat.js', needle: "favBtn.closest('[data-idx]')" },
  { name: '导出彻底不再写本机副本（absent 守卫：出现 idbSet(SNAPSHOT_KEY 即回归——iOS 导出闪退 #73 / 安卓导出后本地存储被写坏 #82 的根因）', file: 'js/data-backup.js', needle: 'idbSet(SNAPSHOT_KEY', absent: true },
  { name: '批量导入/上传持久化延后（scheduleSave 替代同步 saveGroups，修添加字卡后卡顿——同步序列化大库阻塞主线程）', file: 'js/chatcard.js', needle: "scheduleSave();\nrenderGroupsBar();\nrender();\ntoast('已导入 ' + imported" },
  { name: 'iOS PWA standalone ios-fs-active 下 .phone 用实测 --mochi-ios-h（修桌面图标被裁/100vh 超出视口）', file: 'css/base.css', needle: '.ios-pwa-standalone.ios-fs-active .phone' },
  { name: '开屏置顶澄清行可换行（splash-clarify 放开 nowrap，修澄清长句 nowrap 超出手机屏幕）', file: 'css/base.css', needle: '.splash-source-line.splash-clarify { white-space:normal' },
  { name: 'iOS 非 standalone 全屏/浏览器态 .phone 高度 min 钳制到 100dvh（修全屏模式整页上移顶栏点不到：--mochi-ios-h 超过视口时 flex 居中把 .phone 顶部推出负值，覆盖聊天页在内所有功能页）', file: 'css/base.css', needle: 'html.tablet.ios-vv-fit:not(.ios-pwa-standalone) .phone { height:min(var(--mochi-ios-h, 100dvh), 100dvh)' },
  { name: 'iOS standalone+ios-fs-active .phone 铺满物理屏 100vh + 顶部安全区（v3.28.x #114 取代旧 100dvh 钳制：100dvh 只算状态栏下方 → iPhone15 底部空 59px；改 100vh 铺满 + padding-top 安全区，顶部内容下移不重叠、底部贴底）', file: 'css/base.css', needle: 'html.tablet.ios-pwa-standalone.ios-fs-active .phone {' },
  { name: 'iOS standalone 普通态（未开全屏 ios-fs-active）`.phone` 高度 min 钳制（100vh 在 iOS standalone=整屏高含状态栏，超出可视区 → flex 居中把 .phone 顶部推出负值整页上移，iPhone14 Safari standalone 实测 .phone=932 vs 视口 873、top=-29；补上 #109 漏掉的第三条路径）', file: 'css/base.css', needle: 'html.tablet.ios-pwa-standalone .phone { height:min(100vh, var(--mochi-ios-h, 100dvh)' },
  // ==== #537 iOS 独立应用【普通态·覆盖形态】整页上移 / 底部白条 / 底部栏不贴底（2026-09-15）====
  // 用户报障（iPhone 17 自带 Safari 主屏幕打开，明说其他设备型号也有）：「集体屏幕上移、底下有白条、
  // 底部栏不贴手机底部」；诊断 SIG screen=956 inner/vv=894 env=62、.phone 高=956 底=925 tabbar=873。
  // 根因：html/body 停在 100dvh(894) 而 .phone 撑到整块物理屏 956（#179 expBase=envTop+inner）→
  // 父容器 flex 居中把 .phone 整块上移 31px（顶钻系统栏 + 底露白带 + tabbar 悬空三个现象同源）；
  // 且该形态 CSS 侧无人避让状态栏、.phone 底部内边距还与 --mochi-safe-bottom 叠成 52px 空档。
  // 六条锚分别覆盖「形态判定 / 执行器挂类 / 容器钉高 / 状态栏抬升 / 底部归零 / 诊断口径」，
  // 任一被整块删掉或逻辑改坏即报警（needle 均为各自文件内唯一表达式）。
  { name: '#537 判定器给出 iOS 独立应用覆盖形态位（删/改判式 → 执行器不再挂 ios-cover-top，状态栏避让与容器钉高整链失效、整页上移复发）', file: 'js/device.js', needle: 'const iosCover = standalone && !forceCover && !resStand && !ipadForm && envTop >= 20 && envTop <= 160;' },
  { name: '#537 执行器按判定器挂/摘 ios-cover-top（逻辑侧唯一落地开关；删则 CSS 规则永不生效）', file: 'js/mobile-adapt.js', needle: "d.classList.toggle('ios-cover-top', _wantIosCover);" },
  { name: '#537 iOS standalone html/body 钉到与 .phone 同高 + 顶对齐（修「整页上移 + 底部 31px 白条」；改回 100dvh 居中即复发。#114 全屏态同款父类 bug。作用域收在 .ios-cover-top：只有覆盖形态 --mochi-ios-h≠100dvh 才有位移可修）', file: 'css/base.css', needle: 'html.ios-pwa-standalone.ios-cover-top body { height:var(--mochi-ios-h, 100dvh); min-height:0; align-items:flex-start; }' },
  { name: '#537 iOS 独立应用覆盖形态 .phone 底部内边距归零（修「底部栏不贴手机底部」：原 18px 内边距与 tabbar 的 --mochi-safe-bottom 叠成 52px 空档）', file: 'css/base.css', needle: 'html.ios-cover-top .phone { padding-bottom:0; }' },
  { name: '#537 iOS 独立应用覆盖形态状态栏自身抬升（该形态 .phone 无顶部 padding 兜底链、窄屏 @media 的 env 留白又被后加载同特异性 .statusbar{padding:4px} 压死 → Mochi 行钻进系统状态栏＝诊断 ✗顶部重叠，删即复发）', file: 'css/base.css', needle: 'html.ios-cover-top .phone .statusbar {' },
  { name: '#129 iOS standalone 底部安全区不归零（screen-innerHeight>60 在 standalone 是系统状态栏/Home 指示条而非浏览器工具条，viewport-fit=cover 下 Home 指示条在可视区内，归零会让 tabbar/底部组件不避让被遮；standalone 下摘除属性回落 env() 正确避让）', file: 'js/mobile-adapt.js', needle: "sh - ih > 60 && !d.classList.contains('ios-pwa-standalone')" },
  { name: 'iOS 全屏态 syncVvFit 不再写 --mochi-ios-h（摘除属性回落 100dvh，修全屏下 visualViewport.height 偏小把 .phone 压矮→底部聊天输入栏整体偏上不贴底；同时不超视口不复发 #109 整页上移）', file: 'js/mobile-adapt.js', needle: "d.classList.contains('ios-fs-active') || d.classList.contains('ios-native-fs')" },
  { name: 'iOS 全屏保留桌面顶部状态栏（不再 display:none，修「苹果16 添加到桌面+全屏后桌面顶部 Mochi/时间/电量一行不见被遮挡」；absent 守卫：若出现 .ios-fs-active .phone .statusbar { display:none } 即回归）', file: 'css/base.css', needle: '.ios-fs-active .phone .statusbar { display: none', absent: true },
  { name: '#114(复现) iOS 全屏态顶部安全区统一修复（iPhone15+Safari 主屏幕全屏 env(safe-area-inset-top)=0 → 桌面状态栏与系统栏重叠/聊天返回键被吞点；.phone 改 100vh 铺满物理屏 + padding-top:max(var(--mochi-safe-top,env),12px) 整体下移，修顶部重叠 + 底部 59px 空隙 + iPhone17 Edge 图标截断）', file: 'css/base.css', needle: 'padding-top:max(var(--mochi-safe-top, env(safe-area-inset-top, 0px)), 12px);' },
  { name: '#114(复现) iOS standalone 顶部安全区实测（env(safe-area-inset-top)=0 → 用 screen.height-可视高 实测状态栏高度写 --mochi-safe-top 供 CSS 避让，20-160 过滤干扰）', file: 'js/mobile-adapt.js', needle: "d.style.setProperty('--mochi-safe-top'" },
  { name: '#114(复现) 通话缩略窗顶部安全区避让（落位/拖拽上边界抬到系统状态栏下方，修「缩略窗在顶部动不了」被系统栏吞触点）', file: 'js/call.js', needle: 'ty = Math.max(Math.max(miniSafeTop(), voT), Math.min(voT + vh - mh - 4, ty))' },
  { name: '后台音乐媒体条不丢（__musicWantPlay 暴露播放意图 + bg-keep 不让位覆盖歌曲媒体条 + onplay 重绑歌曲元数据，修红米K80 Chrome 通知栏媒体条时有时无/挂后台停播）', file: 'js/music-player.js', needle: '__musicWantPlay' },
  { name: '后台补播连续失败改冷却重试（bgResumeFailAt 60s 清零，修「挂后台总是自己停止播放」后无人拉起）', file: 'js/music-player.js', needle: 'bgResumeFailAt' },
  { name: '录音爆音修复（voiceMimePreferOpus：标准安卓 Chrome/Edge 走 webm/opus，修荣耀90 Edge 语音「滋啦滋啦」爆音；iOS/安卓 WebView 仍走 mp4/aac）', file: 'js/chat.js', needle: 'voiceMimePreferOpus' },
  { name: '此间梦角显式归属纠偏（fixBelonging 按 cid 搬回错放梦角，修不同联系人梦角串桌）', file: 'js/cjian.js', needle: 'function fixBelonging' },
  { name: '此间认亲匹配双名字（homeCidForName 同时匹配 TA 昵称与联系人名，修 lbl-partner 与联系人名不一致认不到家）', file: 'js/cjian.js', needle: 'idn === n || cn === n' },
  { name: '#409 此间串桌修复·按名认亲降级一次性（cjian-belong-v2 标记后 cid 权威，修梦角名撞联系人名/改名认领后每次启动反复搬桌）', file: 'js/cjian.js', needle: "'cjian-belong-v2'" },
  { name: '#409 此间串桌修复·迁移注册表就绪闸（未就绪不认亲不清根键，防错归属被固化）', file: 'js/cjian.js', needle: "if (!r.get('contacts')) return;" },
  { name: '#409 此间串桌修复·联系人改名梦角跟随（contact-renamed 监听同步旧名梦角，防名字与身份漂移）', file: 'js/cjian.js', needle: "addEventListener('contact-renamed'" },
  { name: '#409 此间串桌修复·播种昵称链对齐（cs-lbl-partner 优先，梦角名与聊天里看到的名字一致）', file: 'js/cjian.js', needle: "get('cs-lbl-partner')" },
  { name: '#409 此间串桌修复·标记键全局豁免（EXCLUDE 登记，防 migrateLegacy 搬进 default 删根键致救回逻辑每刷重跑）', file: 'js/contacts.js', needle: "'cjian-belong-v2',\n" },
  { name: '#514 此间梦角归属自愈·自愈函数就位（多桌面「名字串桌」存量救济：错放梦角按名字搬回同名桌面）', file: 'js/cjian.js', needle: 'function healBelonging()' },
  { name: '#514 此间梦角归属自愈·产品函数暴露（回归脚本直接断言产品函数而非复刻实现）', file: 'js/cjian.js', needle: 'window.cjianHealBelonging = healBelonging;' },
  { name: '#514 此间梦角归属自愈·打开此间时自愈+搬空后重新播种（同一拍，避免中间态被渲染）', file: 'js/cjian.js', needle: 'try { healBelonging(); seedIfEmpty(curCid()); } catch (e) {}' },
  { name: '#514 此间梦角归属自愈·切分组时自愈（防别的桌面的梦角挂在本分组下，即用户报的症状）', file: 'js/cjian.js', needle: 'try { healBelonging(); } catch (e) {}' },
  { name: '#514 此间梦角归属自愈·本尊标记（播种梦角带 own，名字漂移时按本桌有效昵称对齐）', file: 'js/cjian.js', needle: "offsetMin: 0, cid: cid, own: 1 })" },
  { name: '#514 此间梦角归属自愈·手动标记（用户手动添加/改名的梦角带 manual，永不自动搬——#409 顾虑的正面解法）', file: 'js/cjian.js', needle: 'c.manual = 1;' },
  { name: '桌面美化·全局字体快捷入口（复用聊天设置 cs-font 键，applyDeskCsFont 注入同款 @font-face，两边互通）', file: 'js/personalize.js', needle: 'applyDeskCsFont' },
  { name: '桌面美化·图标文字颜色（applyAppNameColor 注入 style 覆盖 .app .app-name color）', file: 'js/personalize.js', needle: 'applyAppNameColor' },
  { name: '桌面美化·颜色分区预览面板（desk-color-preview 各部位用 CSS 变量着色实时反映各项颜色）', file: 'template.html', needle: 'desk-color-preview' },
  { name: '贴贴同意后回应不带主动爱心（cuddle 回应去 initiative，修「同意贴贴后 TA 回应也显示主动联系爱心」）', file: 'js/chat.js', needle: "pick(CUDDLE_REPLIES), { initiative: true })", absent: true },
  { name: '大备份下载长命 blob URL（anchorDownload 保留到 pagehide/5 分钟才释放，修小米14U Edge 导出「点了下载没反应/没下载完」）', file: 'js/data-backup.js', needle: "addEventListener('pagehide', function h()" },
  { name: 'IDB 连接级错误判定加宽 + iOS 回前台主动重建连接（connLost 补 UnknownError/InternalError/TransactionInactiveError，修 iPhone 16 Pro Safari「存储异常」弹窗每会话必现）', file: 'js/idb.js', needle: 'armFgIdbReset' },
  { name: '开屏数据未就绪不放行（idbRestore 12s 保险丝改派发 mochi-restore-slow 不设 __mochiDataReady，修"没加载完就进入数据不全"）', file: 'js/idb.js', needle: 'mochi-restore-slow' },
  { name: '开屏「仍要进入」逃生口（splash-force-enter，数据超时未就绪时显示，进入提示数据可能不全）', file: 'js/clock.js', needle: 'splash-force-enter' },
  { name: '导出兜底读 memoryCache（idbGetCached，Safari IDB 挂起时导出朋友圈/聊天记录权威值不丢）', file: 'js/idb.js', needle: 'idbGetCached' },
  { name: '#118 邀请TA .ti-type 固定 92px 同行 ta-ask（添加表单 1 行排版，修 select 独占一行 + input 换行的 2 行「变形」布局）', file: 'css/chat-pages.css', needle: '.ti-type { flex:0 0 auto; width:92px' },
  { name: '#118 邀请TA .tc-input.ce-box 合成层保护（will-change:transform，搜索/批量导入/邀请话术输入 全 tc-input 输入框防「字出界」，小米15Pro Chrome 既往实测复现族）', file: 'css/chat-pages.css', needle: '.tc-input.ce-box { will-change: transform' },
  { name: '#118 邀请TA 编辑按钮 ✎（class="ta-edit" data-idx，修「打错了无法修改」只能删+重加）', file: 'js/ta-invite.js', needle: 'class="ta-edit" data-idx' },
  { name: '#118 邀请TA 批量管理 tiBatchMode（toggle + 行内 batch checkbox + 底部 ti-batch-bar 全选/删除/取消，修「打多了无法批量处理」只能逐条 ✕）', file: 'js/ta-invite.js', needle: 'tiBatchMode' },
  { name: '#131 邀请TA 输入栏合成层字出界缓解 _reflowInviteCeBoxes（监听 vv/window resize 刷新 .ta-add .ce-box 合成层，修小米15Pro Chrome 文字显示在框外，同 ta-ask.js _reflowAskCeBoxes）', file: 'js/ta-invite.js', needle: "pg.querySelectorAll('.ta-add .ce-box')" },
  { name: '#132 邀请TA 批量移动到分组 ti-batch-move（选中多条一键改 grp 字段到目标分组/未分组，修「打多了只能逐条移动」）', file: 'js/ta-invite.js', needle: 'id="ti-batch-move"' },
  { name: '#118 ce-ghost 类别名泄露 fix（先 origClass 再 add，避免可见 ce-box div 继承 ce-ghost 类别名）', file: 'js/mobile-adapt.js', needle: "'ce-box ' + origClass" },
  { name: '#119 桌面美化·内置方案库 BUILTIN_SCHEMES（5 套只读方案置顶，不污染用户方案）', file: 'js/personalize.js', needle: 'const BUILTIN_SCHEMES = [' },
  { name: '#119 桌面美化·深色三档 sysPrefersDark（light/dark/auto 跟随 prefers-color-scheme）', file: 'js/personalize.js', needle: 'const sysPrefersDark = () => !!(window.matchMedia' },
  { name: '#119 桌面美化·壁纸缩略图面板 openBgPanel（2×4 渐变色卡 + 纯色色卡 + 取色器，替换原文字 pill）', file: 'js/personalize.js', needle: 'const openBgPanel = () =>' },
  { name: '#119 桌面美化·壁纸定位/缩放 bgPosOf（phone-bg-pos-x/y/size 三键，默认 cover+center 旧数据兼容）', file: 'js/personalize.js', needle: 'const bgPosOf = () =>' },
  { name: '#119 桌面美化·撤销栈 pushBeautyUndo（beauty-undo-stack 最近 10 次，批量操作前压栈）', file: 'js/personalize.js', needle: 'const pushBeautyUndo = () =>' },
  { name: '#119 桌面美化·边看边调抽屉 openBeautyDrawer（切桌面页 + 右侧浮层实时改 CSS 变量）', file: 'js/personalize.js', needle: 'const openBeautyDrawer = () =>' },
  { name: '#119 桌面美化·方案分享 URL shareBeautyLink（base64 hash URL，启动读 #beauty= 自动弹导入）', file: 'js/personalize.js', needle: 'const shareBeautyLink = () =>' },
  { name: '#602 方案分享链接接收端去掉前缀偏移（#beauty= 共 8 字符；原 slice(7) 把 base64 切成 =xxx 致 atob 抛错被吞、对方打开不弹导入）', file: 'js/personalize.js', needle: 'location.hash.slice(8)' },
  { name: '#602b 分享链接处理包进独立函数（原 return 穿透 outer IIFE，用途不符/命中 0 项时跳过其后所有初始化）', file: 'js/personalize.js', needle: '(function handleSharedBeauty() {' },
  { name: '#602c 分享链接不带主题（生成端剔除 __theme__，不改对方深/浅色）', file: 'js/personalize.js', needle: "if (k === '__theme__') return;" },
  { name: '#602d 分享链接剔除图片组件清单 desk-images（防对方导入后得到空壳组件）', file: 'js/personalize.js', needle: "k === 'desk-images' || bigImg" },
  { name: '#602e 导入分享链接时丢弃主题（旧/手改链接带 __theme__ 也不应用）', file: 'js/personalize.js', needle: "delete data['__theme__'];" },
  { name: '#602f 功能介绍页写明分享链接范围（不含图片、不改深色模式）', file: 'template.html', needle: '分享当前美化链接：生成链接发给对方，打开自动弹导入，一键同步配色' },
  { name: '#602g 功能大全「分享当前美化链接」说明写明范围', file: 'js/feature-hub.js', needle: '不含图片、不改对方深色模式' },
  { name: '#119 桌面美化·完整外观方案 openFullBeautySchemes（桌面+聊天美化合并保存/应用）', file: 'js/personalize.js', needle: 'const openFullBeautySchemes = () =>' },
  { name: '#119 桌面美化·跨域暴露 collectChatBeauty（chat-settings.js 暴露给 personalize.js 合并方案使用）', file: 'js/chat-settings.js', needle: 'window.collectChatBeauty = collectChatBeauty' },
  { name: '#120 导出侧 IDB 读取失败重试 3 次（iOS Safari 事务挂起/超时高发，间隔 200ms 给连接恢复机会）', file: 'js/data-backup.js', needle: 'for (let retry = 0; retry < 3 && (v === undefined || v === null); retry++)' },
  { name: '#121 通话进行中标记双写 localStorage（sessionStorage 在关标签/Safari/PWA 重开后清空，「刷新后恢复通话」失效，iPad Air 7 Safari 实测）', file: 'js/call.js', needle: "localStorage.setItem(CALL_ACTIVE_KEY, payload)" },
  { name: '#121 通话恢复 localStorage 兜底（sessionStorage 空时读 LS，10 分钟新鲜度窗防翻旧账）', file: 'js/call.js', needle: 'localStorage.getItem(CALL_ACTIVE_KEY)' },
  { name: '#121 通话进行中标记心跳（每 20 秒刷 ts，恢复兜底判定新鲜度的依据）', file: 'js/call.js', needle: 'if (++hbCount >= 20) { hbCount = 0; saveCallActive(); }' },
  { name: '#121 call-active 进 migrateLegacy 排除清单（全局根键不被当旧顶层键迁进 default 并删根键，否则 LS 兜底副本每次启动被搬走）', file: 'js/contacts.js', needle: "'call-active'," },
  { name: '应用锁功能本体（applock.js 数字密码锁+安全问题重置，删除即隐私锁失效）', file: 'js/applock.js', needle: 'window.__applockReady' },
  { name: '应用锁/开屏问答门根键进 migrateLegacy 排除清单（applock-* 全局根键不被迁进 default 并删根键，否则锁设置每次刷新被搬走=锁失效）', file: 'js/contacts.js', needle: "'applock-qa-en', 'applock-qalist', 'applock-qaskip'," },
  { name: '应用锁设置页开关行（template.html #applock-en，防并行会话把设置入口改丢）', file: 'template.html', needle: 'id="applock-en"' },
  { name: '开屏问答门（applock.js 问答题门禁，防并行会话删除——隐私门即失效）', file: 'js/applock.js', needle: 'applock-qaskip' },
  { name: '开屏问答门设置行（template.html #applock-qa-en，防并行会话把入口改丢）', file: 'template.html', needle: 'id="applock-qa-en"' },
  { name: '#319 cardlock-state 进 migrateLegacy 排除清单（解锁状态全局根键不被迁进 default 并删根键，否则输对密码刷新后闸门仍全锁）', file: 'js/contacts.js', needle: "'cardlock-state'];" },
  { name: '#319 card-lock 存量自愈（被误迁进 default 的解锁状态启动时搬回根键，老用户不用重输密码）', file: 'js/card-lock.js', needle: "localStorage.getItem('xy-home-v2:default:cardlock-state')" },
  { name: '#389 cardlock 解锁状态走 xyStore（写日志+IDB+每键标记+自愈链，修 Edge/荣耀杀进程回滚 localStorage 解锁态退回 locked→密码框重弹，多机型同因零机型分支）', file: 'js/card-lock.js', needle: "addEventListener('mochi-wrj-heal'" },
  { name: '#389 开屏锁卡监听解锁状态事件重渲染（自愈晚到不再显示「输入密码解锁」假象）', file: 'js/clock.js', needle: "addEventListener('mochi-cardlock-open'" },
  { name: '#118 默认字卡三场景使用概率 overallFor（dc-overall-<chat/mail/feed> 未设置回退 dc-overall）', file: 'js/default-cards.js', needle: 'overallFor: gOS' },
  { name: '#118 默认字卡抽卡按场景读概率/开关 drawCards(a, scene, st)（#518 起第三参透传成员桌面给 dcpAll；删掉场景/桌面参数化即回归）', file: 'js/default-cards.js', needle: 'function drawCards(a, scene, st)' },
  { name: '#118 写信混入默认字卡读写信场景概率（overallFor mail）', file: 'js/mail.js', needle: 'dcfg.overallFor' },
  { name: '#118 朋友圈默认字卡补池按 dc-overall-feed 概率（未设置=100 维持始终混入）', file: 'js/feed.js', needle: 'dc-overall-feed' },
  { name: '#120 导出侧全部丢失键记录降级（原只 chat-msgs/feed-posts，cc-groups 等静默跳过致导入后彻底丢失）', file: 'js/data-backup.js', needle: 'const nameOf = function (k)' },
  { name: '#120 导出侧丢失键友好名字 nameOf（cc-groups/quote-cards/fav-msgs/avatar-*/music-file/reply-*/ta-* 等）', file: 'js/data-backup.js', needle: 'TA回复字卡(' },
  { name: '#120 导入侧保留备份未含的旧键防 clear 致丢（idbReplaceAll 前列出当前 IDB 键，备份没有的读出值加入 pairs）', file: 'js/data-backup.js', needle: '已保留备份未含的' },
  { name: '导出权威键强制读 IDB（isAuthorityKey，chat-msgs/feed-posts 不因 LS 有损小快照跳过 IDB 权威，修跨浏览器导入丢数据）', file: 'js/data-backup.js', needle: 'isAuthorityKey' },
  { name: '导入 chat-msgs 无 IDB 权威时 LS 快照写 IDB 兜底（chatFallback，不再无条件跳过导致彻底丢失）', file: 'js/data-backup.js', needle: 'chatFallback' },
  { name: '副本消费方已全部移除（absent 守卫：花园不再整包 JSON.parse 自动备份副本，防数百 MB 遗留快照 OOM）', file: 'js/garden.js', needle: 'offerSnapshotRecover', absent: true },
  { name: '聊天更多功能固定每行4个（.more-grid 改 4 列 grid + justify-items 居中，修不同屏宽 flex 换行每行 3~4 个不一）', file: 'css/chat-main.css', needle: 'grid-template-columns:repeat(4, 1fr); gap:14px; justify-items:center' },
  { name: '#88 启动按 IndexedDB 权威值校正当前桌面（correctCidFromIdb，修小米14U Edge LS 失效时「聊天记录几小时自己消失」＝桌面静默切回 default）', file: 'js/contacts.js', needle: 'correctCidFromIdb' },
  { name: '#88 migrateLegacy 判空改走 regStore（裸 localStorage 在 LS 失效机上恒空 → 每启动把真值改回 default，抵消上面的校正）', file: 'js/contacts.js', needle: "if (!regStore().get('active-contact'))" },
  { name: '#88 后台保活/通知开关回填后重应用（reheatBgSwitches，修 LS 启动读到空值导致「后台通知有时候自己关闭」）', file: 'js/bg-keep.js', needle: 'reheatBgSwitches' },
  { name: '#88 未读到权威值时不整包覆盖 chat-msgs（authOk 闸门 + pendingLocal 暂存，防读超时后一条新消息抹掉全部历史）', file: 'js/chat.js', needle: 'const authOk = chatDbReady && authLoadedPrefix === window.activePrefix();' },
  { name: '#88 诊断补整域 localStorage 占用与写探针结论（区分同 origin 其他站点占满配额 vs 本库损坏）', file: 'js/device.js', needle: 'localStorage 整域=' },
  { name: '#88 LS 失效自检并当场告知（__lsStatus + 自带 #cc-toast 提示「已改用数据库存储，数据不会丢」，不依赖 window.toast——产物里从未赋值）', file: 'js/device.js', needle: '本机浏览器本地存储受限' },
  { name: '#89 安卓收键盘卡顿修复（_aClosing 收起态：跳过逐帧 _aPinPan 强制 reflow + _aRefreshCe ce-box reflow，修红米/小米 Chrome 手动收起键盘那一刻卡顿）', file: 'js/mobile-adapt.js', needle: '_aClosing' },
  { name: '#90 IDB 严格三态清单/存在性探测（idbListKeys/idbHasKey：超时与「空库」彻底分开，[] 不再冒充「库里没有」）', file: 'js/idb.js', needle: 'window.idbHasKey = function' },
  { name: '#90 条数账本不进 #40 写日志（chat-meta 排除，防 LS 回滚把过期条数账本补回来误导守卫）', file: 'js/idb.js', needle: '/:chat-meta$/.test(key)' },
  { name: '#90 聊天记录条数账本 + 缩水守卫（chatLedgerGuard：可疑缩水时 IDB 与 LS 快照都不写 + 暂存 pendingLocal + 强制重读合并）', file: 'js/chat.js', needle: 'chatLedgerGuard' },
  { name: '#90 只有确认「库里没有」(has===false) 才新建单条数组（loadMsgs 与两条跨桌面追加路径，修后台通知回来一条消息覆盖整桌面历史）', file: 'js/chat.js', needle: 'return has === false;' },
  { name: '#90 读到有值却解析失败时绝不整包写回（readOk 闸门，防把读不懂的历史当成空数组覆盖）', file: 'js/chat.js', needle: 'if (!readOk) return;' },
  { name: '#90 写 active-contact=default 前先向 IDB 确认库里没有 + 校正逻辑抽函数支持直读 IDB（applyCidCorrection）', file: 'js/contacts.js', needle: 'applyCidCorrection' },
  { name: '#90 导出前清单没读到一律中止（idbListKeys 三态，绝不出具「全部数据完整」的近空备份）', file: 'js/data-backup.js', needle: '导出未完成' },
  { name: '#103 导出流式打包防 OOM 崩溃（jsonToBlobStreaming 逐键序列化边拼边合并 Blob + blobToBase64 分块转换，修 OPPO Find X9 Chrome 大备份导出闪退/导不出来）', file: 'js/data-backup.js', needle: 'jsonToBlobStreaming' },
  { name: '#90 诊断新增「桌面归属体检」（三层 active-contact 并列 + 各桌面条数账本，区分记录被覆盖 vs 切错桌面）', file: 'js/device.js', needle: '桌面归属体检' },
  { name: '#91 预设/功能/查岗字卡列表改真虚拟窗口（flat+高度前缀和+视口±0.8 屏窗口+.cc-vspace 占位撑高，修 iPhone 15 Plus 进字卡库能滑但点返回卡死、卡回去后整页持续卡＝单分类整包铺进 3.3 万节点）', file: 'js/default-cards.js', needle: 'const V_PAD = 0.8' },
  { name: '#91 滚动容器动态判定（clipsContent 启发 + capture 阶段 scroll 事件锁定 e.target，兼容 dc 页由 page 滚 / fc 列表自滚 / 窗口滚三种形态，防窗口永不推进）', file: 'js/default-cards.js', needle: 'function clipsContent(' },
  { name: '#91 占位块样式在位（顶/底 .cc-vspace 撑回全高，滚动条长度与旧版一致＝全量行仍可达）', file: 'css/chat-pages.css', needle: 'cc-vspace' },
  { name: '#91 返回字卡库不再重复 JSON.parse 大库（refreshLibCounts force 分支走带缓存 pubGroupsRaw，多 MB 公用库每次返回解析两遍）', file: 'js/chatcard.js', needle: 'countOf(pubGroupsRaw())' },
  { name: '#92 字卡库离页/切作用域/切桌面冲刷（flushCcSave：200KB 大键只走异步 IDB + 120ms 防抖，刷新重进即丢公用/专享表情包上传，华为 P50E Edge 反馈）', file: 'js/chatcard.js', needle: 'function flushCcSave' },
  { name: '#92 切桌面先冲刷字卡库（setActiveContact 在 __activeCid 变更前 ccFlushSave，防 A 桌面待写 120ms 防抖写进 B 桌面键）', file: 'js/contacts.js', needle: "if (window.ccFlushSave) window.ccFlushSave()" },
  { name: '#93 回信后切到「收到的信」tab（submitReply 原 showPage 不 selectMailTab，停在旧 tab 看不到刚回信的来信，红米 K80 Chrome 反馈）', file: 'js/mail.js', needle: "selectMailTab('in');" },
  { name: '开屏进入门控补页面加载完成（window load 前「点击进入/仍要进入」都不放行，修 GitHub Pages 冷启动"网页还没加载完就能进、进去数据不全"）', file: 'js/clock.js', needle: '正在加载页面…' },
  { name: '#98 TA提问即进提问记录（pushAsk 发卡同步写 pending history + askTs 关联键透传，修"聊天有提问但主页提问记录空"）', file: 'js/ta-ask.js', needle: "status: 'pending'" },
  { name: '#98 chatAskReply 包装层统一写 ta-ask.history（覆盖文字题+单选题点选项两条回答路径，排除 deskCk 查岗卡）', file: 'js/ta-ask.js', needle: '__taAskReplyWrapped' },
  { name: '#98 提问记录待回答标签样式（.tc-li-pending 橙黄标签，TA已提问未回答时显示）', file: 'css/chat-pages.css', needle: 'tc-li-pending' },
  { name: '#101 askTs 关联键透传进 chat-msgs（chatAddSystem 白名单补 askTs，修 pending 永不关联→幽灵待回答+重复记录）', file: 'js/chat.js', needle: 'askTs: opts.askTs' },
  { name: '#101 提问记录跨桌面汇总（allDeskHistories，修联系人桌面答过题切回主页提问记录看不到）', file: 'js/ta-ask.js', needle: 'allDeskHistories' },

  { name: '#86 遗留副本清理墙钟兜底 + 幂等（restore 整轮挂起、mochi-restore-done 永不到达时 20s 后仍清理；purgeOnce 保证 #90 的重试链只起一套）', file: 'js/data-backup.js', needle: 'function purgeOnce()' },
  { name: '#86 LS 大键迁移排除已下线副本键（不把几百 MB 遗留副本整包读进内存/写回 IDB/常驻 memoryCache，防清理后被复活）', file: 'js/idb.js', needle: "if (k === 'xy-home-v2:__auto-backup-snapshot') continue;" },
  { name: '#101 查看存储明细只列最大 5 项 + 占比条 + 百分比（其余折进「其他 N 项合计」，回归成流水账即报警）', file: 'js/personalize.js', needle: 'function pctOf(size, total)' },
  { name: '#101 展开区存储键名按桌面名显示（cid 命名空间换成联系人/桌面名，用户读得懂「谁的聊天记录」）', file: 'js/personalize.js', needle: 'function labelKey(k, names)' },
  { name: '#101 查看存储 IDB 键清单走 #90 严格三态（读不到不再退化成 [] 显示成「0 键」，也不再把「库里没有」冒充「读不到」）', file: 'js/personalize.js', needle: 'window.idbListKeys || window.idbGetAllKeys' },
  { name: '#101 总占用双口径分行「本项目占用合计」vs「浏览器整域已用」（防用户把同域名整域占用当成本应用数据/以为统计漏了）', file: 'index.html', needle: '本项目占用合计' },
  { name: '#101 占比条样式已接入产物（setting.css 的 .storage-cat-bar，漏接入 cssFiles 或样式被删即报警）', file: 'css/setting.css', needle: '.storage-cat-bar i { display:block' },
  { name: 'iOS 真全屏聊天顶部栏收紧贴顶（苹果17 自带浏览器+全屏模式顶部一大块空白：.fs-active 的 max(env,12px) 在 iOS 系统状态栏常驻下算多余白带，用 ios-native-fs 压平；删掉规则/漏接入 cssFiles 即报警）', file: 'css/base.css', needle: 'html.ios-native-fs .phone .page.full .chat-head' },
  { name: 'iOS 原生全屏标记类同步（fullscreen.js syncFsClass 给根元素加 ios-native-fs，与之配套的 base.css 收紧规则靠它命中，标记删了修复就哑）', file: 'js/fullscreen.js', needle: "classList.toggle('ios-native-fs', _fs)" },
  { name: '#95 朋友圈图片格宽统一：单图/双图容器特判已删除（原 .feed-imgs:has(...) 使 1/2/3+ 图格宽 22%/40%/33% 不一致，加回即回归）', file: 'css/chat-pages.css', needle: 'feed-imgs:has(', absent: true },
  { name: '#95 朋友圈图片格宽统一：单图放弃 1:1 裁切的 aspect-ratio:auto 特例已删除（加回则单图随原图比例自由变高）', file: 'css/chat-pages.css', needle: 'feed-imgs img:only-of-type', absent: true },
  { name: '#96 网易云外链播放区分 play() reject 错误类型（非 NotAllowedError 走外链兜底，不再一律弹"被浏览器拦截"）', file: 'js/music-player.js', needle: "err.name !== 'NotAllowedError'" },
  { name: '#96 meting 直链解析校验 302/音频响应（VIP/失效歌 200 空正文不再当直链原样回投重播坏 URL）', file: 'js/music-player.js', needle: "r.redirected || /^audio\\//i.test(ct)" },
  { name: '#96 已死 corsproxy.io(401 强制 API key) 代理已从网易云 API 源列表移除（留着只刷「网络失败 401」日志，vivo Y35+Edge 诊断实证）', file: 'js/music-player.js', needle: 'https://corsproxy.io/?url=', absent: true },
  { name: '#96 播放拒绝按错误类型区分提示文案（源加载失败不再谎报"被浏览器拦截"）', file: 'js/music-player.js', needle: '在线歌曲加载失败' },
  { name: '#99 TA收藏改存歌曲快照（纯 ID 方案删歌后记录隐形；用户要求删歌后联系人收藏记录依旧保留）', file: 'js/music-player.js', needle: 'function taFavList()' },
  { name: '#108 清理会员歌曲——#254 升级取代：代理 5xx 重试链路已整体移除（proxy.cors.sh DNS 已注销+allorigins 522，重试救不回死域名），改 meting 播放同源逐首探测（记账判据锚，删掉探测语义则该哨兵消失；#108 原修复「不误删/如实报失败」语义由 #254 完整继承）', file: 'js/music-player.js', needle: 'done(playable ? 0 : 1); // 0=免费可播；1=不可播（会员/付费/失效）' },
  { name: '#99 TA收藏列表已删歌曲标识样式（置灰 + 已删除小标签）', file: 'css/chat-pages.css', needle: 'ta-fav-gone' },
  { name: '联系人主动消息爱心标识已去灰色阴影（.msg-hi-heart 双层 drop-shadow 已删，加回即回归）', file: 'css/chat-main.css', needle: 'drop-shadow(0 1px 1px rgba(0,0,0,.22))', absent: true },
  { name: '#100 诊断启动异常采集前置（window.__jsErrors 此前全项目无人初始化，build 兜底 if(window.__jsErrors) 恒 false＝功能文件启动异常静默丢弃）', file: 'js/device.js', needle: 'window.__jsErrors = window.__jsErrors || []; } catch (e0) {}' },
  { name: '#100 诊断软/硬双预算首屏标注（原 3s 单保险丝把 IDB 慢机的「最近错误/开关持久化体检/桌面归属体检/IDB 大键明细」整批截成裸「读取中…」，2026-08-30 iPhone 16 Pro 真机诊断实证）', file: 'js/device.js', needle: '未读到（本机存储响应慢，稍后自动补全）' },
  { name: '#100 诊断终态回填直写可见 #modal-textarea + 弹窗判活（ctl.text 的 setter 只写 hidden 的 #modal-input，回填曾静默失效；全站弹窗共用 DOM，关窗后迟到回填会灌进别的弹窗）', file: 'js/device.js', needle: 'if (!modalAlive()) { closed = true; return; }' },
  { name: '#100 诊断角标按最后一条错误时间戳判未读（原存条数，环形写满后新错误永远算不出未读＝角标常暗、错误线索看不见）', file: 'js/device.js', needle: 'const seen = Number(localStorage.getItem(SEEN_KEY)) || 0;' },
  { name: '#100 最近错误环形上限 5→20 且调用栈只给最近 3 条（5 条窗口用户报障时早已刷掉；全带栈会把报障文本撑到剪贴板截断）', file: 'js/device.js', needle: 'const ERR_CAP = 20;' },
  { name: '红米K80 切后台无法自动播下一首回归修复（后台非 NotAllowedError 拒绝不再烧一次性 https 重试链，恢复 scheduleBgResume 退避补播，源短暂恢复即接上）', file: 'js/music-player.js', needle: 'if (document.hidden) {\nbgBrokeAudio = true;\nplayRejected = true;\nscheduleBgResume();' },
  { name: '群聊里用【帮我决定/多人决定】结果发到群聊（gcSendDecisionText 系统消息入群聊消息流 + 群聊更多面板点这两项不切聊天页，修结果错发到聊天）', file: 'js/group-chat.js', needle: 'gcSendDecisionText' },
  { name: '#421b 帮我决定入口顶置早绑定（decision.js 顶部先挂分派器 window.openDecision，真实实现 359 行回填 decisionPanelRef——防模块中途任一 init 抛错导致 openDecision 永不绑=按钮「帮我决定加载失败」，用户跨机型反复上报；改回整体覆盖或删分派器即报警）', file: 'js/decision.js', needle: 'decisionPanelRef = openPanel;' },
  { name: '#421b 多人决定入口顶置早绑定（group-decision.js 顶部先挂分派器 window.openGroupDecision，真实实现回填 groupDecisionPanelRef——同上，防「多人决定加载失败」跨机型复发）', file: 'js/group-decision.js', needle: 'groupDecisionPanelRef = openPanel;' },
  { name: '#104 导出打包器按片段写 Blob + 值内逐元素下钻（单片段恒 ≤1M 字符，不再为单个大键整串分配；回归成整包 stringify 则 vivo X200s 806MB 设备 Invalid string length 复发）', file: 'js/data-backup.js', needle: 'createJsonPack' },
  { name: '#104 导出体积预估改廉价浅判（旧 byteLen 为量一个键的长度把整包 stringify 一遍＝再复制一份大键，是 OOM 的隐藏来源）', file: 'js/data-backup.js', needle: 'function overSmallLimit(v, limit)' },
  { name: '#104 导出异常边界收遮罩并如实报环节/键名/体积（旧实现裸调用 → RangeError 变未处理 promise rejection → impHide 永不执行 = 用户报的「一直在打包中」）', file: 'js/data-backup.js', needle: 'reportExportError' },
  { name: '#104 大库导出前选备份范围（完整/不含音乐/只备份文字，navigator.storage.estimate 超 150MB 才弹；小库不打扰）', file: 'js/data-backup.js', needle: 'askExportMode' },
  { name: '#104 导入读大文件按错误类型给文案（不再把「本机读不动这么大的一份」谎报成「无效的数据文件」）', file: 'js/data-backup.js', needle: '这份备份太大，本机读不进去' },
  { name: '安卓 Chrome 强制深色遮蔽网页配色修复：:root 显式声明 color-scheme:light（深色由 data-theme 手动管；缺失时系统深色下 Chrome Auto Dark 无视网页配色把群聊气泡/字体全网压成纯黑，iQOO Neo10 反馈）——#252 升级 only light（裸 light 是偏好声明不是退出开关，部分安卓 Chromium/WebView 系统深色下仍压黑）', file: 'css/base.css', needle: 'color-scheme:only light' },
  { name: '#252 深色三档启动落位含 auto 档+浅色强制清残留（头部脚本旧版只认 dark：auto 用户系统深色下白闪 FOUC；残留 data-theme 令浅色档界面停留深色）', file: 'template.html', needle: "if(_tm==='dark'||(_tm!=='light'&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.setAttribute('data-theme','dark');else document.documentElement.removeAttribute('data-theme')" },
  { name: '#252 applyThemeMode 浅色档显式 removeAttribute（属性在=dark.css 全量生效，双保险防残留；needle 按产物压缩后的无缩进换行形态登记）', file: 'js/personalize.js', needle: "if (eff === 'dark') document.documentElement.setAttribute('data-theme', 'dark');\nelse document.documentElement.removeAttribute('data-theme');" },
  { name: '#258 深色覆盖展平为完整前缀选择器（dark.css 禁用 CSS 原生嵌套：嵌套需 Chromium 112+/iOS 16.5+，老内核丢嵌套规则=浅色白底扁平规则独存+文字变量翻白=白卡白字看不见，用户报「深色下拍一拍字卡全是白的」；展平语义等价，回退成嵌套即断）', file: 'css/dark.css', needle: '[data-theme="dark"] #poke-list .cc-item' },
  { name: '#104 导出入口不再裸调用 doExport（absent 守卫：出现无 await/无 catch 的 doExport(); 即回归——遮罩永不隐藏的直接根因）', file: 'js/data-backup.js', needle: 'doExport();', absent: true },
  { name: '#105 钓鱼「留」标记按归属存（keepKey(side,id)，回归成品种级开关时同品种两侧互相牵连——用户报「只想留 TA 的」做不到）', file: 'js/fishing.js', needle: 'function keepKey(side, id)' },
  { name: '#105 出售按归属跳过未留项（旧写法 keep[id] 会把另一侧同品种的鱼一起跳过不卖）', file: 'js/fishing.js', needle: 'if (keep[keepKey(side, id)]) return;' },
  { name: '#105 旧纯品种 keep 键自愈展开到两侧（键不含 : 即旧数据，等价原「同品种两侧都不卖」语义，用户零感知）', file: 'js/fishing.js', needle: "keep[keepKey('mine', k)] = 1" },
  { name: '#105 复选框按行归属写标记（data-side 决定改哪一侧的留标记，回归成共用键时两栏互相勾上）', file: 'js/fishing.js', needle: "keepKey(cb.getAttribute('data-side')" },
  { name: '#105 出售后清掉该侧已无存货的残留留标记（否则同品种当天再钓到会被上次遗留标记自动置留）', file: 'js/fishing.js', needle: 'if (!t[side] || !t[side][id]) delete t.keep[k];' },
  { name: '#106 贪吃蛇布局高度预算补算 flex gap（原漏算 .snake-fs 的 gap:min(2vh,2vw)，360/384/390/412 宽空闲态即溢出 17～29px＝用户报「再来一局按钮显示不完全」）', file: 'js/snake-game.js', needle: 'availH -= (parseFloat(st.rowGap) || 0) * n;' },
  { name: '#106 贪吃蛇画布按滚动区实际溢出自查收小（量算总有几像素误差而全屏是裁切的，溢出 1px 就切掉按钮一截；删掉这段循环则误差重新变成点不到）', file: 'js/snake-game.js', needle: 'const over = sc.scrollHeight - sc.clientHeight;' },
  { name: '#106 贪吃蛇结算后重铺全屏画布（showResult 末尾调 refitAll；原实现只调 refitNonFs，全屏 isFs 直接早退＝地图不缩小，用户报「要缩小才能点到再来一局」）', file: 'js/snake-game.js', needle: "refitAll();     // 结算块+再来一局出现后收小画布：半框让方向键一屏可见，全屏防「再来一局」被裁到屏外" },
  { name: '#106 贪吃蛇全屏滚动区兜底可纵向滚（原 overflow:hidden，极矮/横屏格子触到 9px 下限仍放不下时按钮永久不可达）', file: 'css/chat-pages.css', needle: '#chat-snake-panel.snake-fs .poke-card-scroll { overflow:hidden auto;' },
  // ===== v3.26.x #221：贪吃蛇手机端操作性（多机型「不好操作」反馈）=====
  { name: '#221 贪吃蛇双槽输入队列（nextDir2 顶替入队：一个 tick 内连给两个转向不再互相覆盖=急转弯不吞输入；改回单槽赋值则挤掉先给的转向）', file: 'js/snake-game.js', needle: 'else { p.nextDir = p.nextDir2; p.nextDir2 = { x: x, y: y }; }' },
  { name: '#221 贪吃蛇 applyDir 每步只消费队列头一格（nextDir 生效后 nextDir2 顶上来；删掉顶替行则第二转向永远丢失）', file: 'js/snake-game.js', needle: 'if (q) { snake.nextDir = snake.nextDir2 || null; snake.nextDir2 = null; }' },
  { name: '#221 贪吃蛇滑动轴锁可解锁（另一轴偏移反超 1.5× 改锁并转向：L 形拖动不抬手即可转向；改回 if (!lockAxis) 粘性锁则 L 形拖动失效）', file: 'js/snake-game.js', needle: 'if (ady >= TH && ady > adx * 1.5) { lockAxis = \'v\'; dir = dy > 0 ? \'d\' : \'u\'; }' },
  { name: '#221 贪吃蛇方向键 pointerdown 即时转向（click 依赖 touchend 合成慢一拍且快速连点丢次；删掉 pointerdown 监听则回退 click 延迟）', file: 'js/snake-game.js', needle: "dpadEl.addEventListener('pointerdown', function (e) {" },
  { name: '#221 贪吃蛇方向键/按钮触控消除点击延迟（touch-action:manipulation 屏蔽双击缩放等待；删掉则方向键响应回退 ~300ms）', file: 'css/chat-pages.css', needle: 'touch-action:manipulation; transition:transform .08s, background .08s; }' },
  // ===== v3.26.x #115：聊天输入栏「打字不显示/空白」（红米 K60 至尊版 + Edge）=====
  { name: '#115 聊天输入栏常驻独立合成层（will-change，层在键盘平移开始前就存在；#chat-input/#gc-input 是模板原生 contenteditable、不经 ceConvert，拿不到 .ce-box 那套保护）', file: 'css/base.css', needle: '.phone .chat-input { will-change:transform; }' },
  { name: '#115 聊天输入栏聚焦再叠 translateZ（与治好「文字与框分离」的 .ta-add .ce-box 同款；键盘期 .phone 被 _aPanComp 平移+逐帧改高时文本画在旧合成层＝框内空白）', file: 'css/base.css', needle: '.phone .chat-input:focus { transform: translateZ(0); }' },
  { name: '#115 聚焦可编辑框内部滚动残留自愈（内容不超高而 scrollTop>0 即归零；修「字在 DOM 里却被自身滚动推出裁剪区＝看着空白」）', file: 'js/mobile-adapt.js', needle: 'function healEditableScroll(el) {' },
  { name: '#115 安卓键盘内部状态只读探针（诊断「键盘/锁残留」此前只读 iOS 探针，安卓永远 n/a）', file: 'js/mobile-adapt.js', needle: 'window.__mochiAndroidKb = function () {' },
  { name: '#115 诊断新增「聊天输入栏现场」实测行（聚焦/DOM 文本长/内部滚动/颜色 caret 合成层/待清守卫/是否被键盘盖——分案三种空白成因）', file: 'js/device.js', needle: '聊天输入栏现场：元素=' },
  { name: '#115 诊断输入轨迹环形缓冲（focus/composition 起止/input 最近 8 条，只记长度与滚动三值不记内容）', file: 'js/device.js', needle: 'xy-home-v2:__diag-inp' },
  { name: '#115 防复活守卫真实编辑闸门（三处守卫改判「本次清空后有无真实输入活动」，修重打同一条短句被静默吞字＝打字不显示）', file: 'js/chat.js', needle: 'function userEditedAfterClear()' },
  { name: '#115 input 监听命中相同文本时先放行真实编辑（只摘守卫标记不清框）', file: 'js/chat.js', needle: "if (userEditedAfterClear()) { input._mClearTxt = ''; return; }" },
  { name: '#115 真实输入活动跟踪（keydown/compositionstart/insert 类 beforeinput 捕获阶段刷新 lastUserEditAt，闸门判据来源）', file: 'js/chat.js', needle: "input.addEventListener('compositionstart', () => { lastUserEditAt = Date.now(); }, true);" },
  { name: 'v3.14 聚焦态清空走 execCommand 编辑管线终结组合会话（防输入法迟到写回；#115 补登哨兵，该块此前整块零保护）', file: 'js/chat.js', needle: "document.execCommand('selectAll', false, null)" },
  { name: '#116 工坊配方卡缺料反馈（需求行改「已有/需求」+ 缺料提示行 + 按钮常驻缺料置灰，修「工坊做不了花艺配方」无从知晓缺什么）', file: 'js/garden.js', needle: 'recipe-lack' },
  { name: '#122 TA的心情235张系统预设注册字卡库跨分类搜索（修「系统编码字卡搜不到」）', file: 'js/ta-mood.js', needle: "name: 'TA的心情'" },
  { name: '#122 聊天内置系统回应池（兜底/邀请婉拒/贴贴）注册字卡库跨分类搜索', file: 'js/chat.js', needle: "name: '聊天系统回应'" },
  { name: '#122 朋友圈内置互动回应池（TA评论/TA回应）注册字卡库跨分类搜索', file: 'js/feed.js', needle: "name: '朋友圈互动'" },
  { name: '#122 番茄钟陪伴模式内置话术池注册字卡库跨分类搜索', file: 'js/p2-features.js', needle: "name: '番茄钟陪伴'" },
  { name: '#122 群聊内置兜底回复池注册字卡库跨分类搜索', file: 'js/group-chat.js', needle: "name: '群聊系统回应'" },
  { name: '#123 大历史聊天懒加载（账本b字段门控 chatPrefetchIfLight，防低端机开屏/切桌预读 155MB 聊天包 OOM 崩溃，OPPO Find X9 Chrome 实测）', file: 'js/chat.js', needle: 'function chatPrefetchIfLight(load) {' },
  { name: '#123 大历史聊天懒加载·字节估算写账本（chatLedgerSave 的 b 字段，重启后不必读大键即可判断是否大包）', file: 'js/chat.js', needle: 'const chatLedgerBytes = {};' },
  { name: 'v3.30.x 公用/专属字卡分组停用开关（数据层 cc-groups-public-off/cc-groups-off，回复池 getScopedGroups/*For 全部过滤停用分组）', file: 'js/chatcard.js', needle: "const PUB_OFF_KEY = 'cc-groups-public-off';" },
  { name: 'v3.30.x 公用字卡分组停用键排除 migrateLegacy（cc-groups-public-off 全局根键不被迁进 default 桌面）', file: 'js/contacts.js', needle: "'cc-groups-public', 'cc-groups-public-off', 'cc-scope-migrated'," },
  { name: '跨桌面查岗/来电频率档位 desk-freq-mode 排除 migrateLegacy（漏排除→被当旧顶层键迁进 default 删根键，「标准」静默回退「安静」致两三天 0 触发）', file: 'js/contacts.js', needle: "'desk-call-en', 'desk-freq-mode'" },
  { name: 'desk-freq-mode 误迁自愈（default 副本写回根键，存量一次性找回；#231 并入 full-beauty-schemes；#527 起 beauty-undo-stack 已自本清单移出）', file: 'js/contacts.js', needle: "'full-beauty-schemes'].forEach(function (k) {" },
  { name: '#231 完整外观方案/美化撤销栈/更新条记忆键排除 migrateLegacy（漏排除→每刷新被当旧顶层键迁 default 删根键：完整方案列表刷新清空=红米Note12T「保存后恢复初始」多机型同发、同版本更新条每刷新重弹；#527 起 beauty-undo-stack 写入端改 per-cid 但该键仍须留在 EXCLUDE——「自回收清单移除」由 verify-exclude-feed-schemes 的否定断言守住）', file: 'js/contacts.js', needle: "'full-beauty-schemes', 'beauty-undo-stack', 'ver-update-ack-ts', 'ver-update-notify'," },
  { name: '#233 __ 系统键兜底防迁移（__wr-journal 写日志自愈第一道防线/__ls-dirty/__big-idx 无冒号根键每刷新被迁 default 删根键=LS 回滚家族第四层削弱；删此规则即回归）', file: 'js/contacts.js', needle: "if (r.indexOf('__') === 0) return true;" },
  { name: '#233 default:__ 误迁系统键存量副本清扫（LS+IDB 同删，防 idbRestore 回填复活；删掉则死副本永占 LS 配额）', file: 'js/contacts.js', needle: "k.indexOf(G + ':default:__') === 0" },
  { name: '#232 朋友圈身份/封面六键改按桌面独立回收（DESK_KEYS 拆分；根键有值即删 default 副本的旧逻辑=朋友圈头像昵称每刷新回退，删此拆分即回归）', file: 'js/feed.js', needle: "const DESK_KEYS = ['feed-cover-bg', 'feed-ta-cover', 'feed-ta-name', 'feed-ta-avatar', 'feed-user-name', 'feed-user-avatar'];" },
  { name: '#232 收养旧全局值前三态确认（idbHasKey false 才收养——大值只在 IDB def.get 看不到≠不存在，删守卫会用旧全局值盖掉大头像/封面）', file: 'js/feed.js', needle: "window.idbHasKey('xy-home-v2:default:' + k)" },
  { name: '#234 诊断开关体检读取列键位修复（xyStore 前缀不带尾冒号；2026-09-11 复发修正：G 本身已带尾冒号，SP 必须=G+cid，首修的 G+\':\'+cid 仍是双冒号——改回任何额外冒号拼法即回归「读取」列恒缺失误导判读）', file: 'js/device.js', needle: 'window.xyStore(SP).get(short)' },
  { name: '#139 LS 大键残留清扫（读-比对-CAS 删 LS 副本：IDB 同值纯去重/落后先追平再删，恢复设置保存配额）', file: 'js/idb.js', needle: 'if (localStorage.getItem(k) === lsVal) localStorage.removeItem(k);' },
  { name: '#139 专属字卡库去重预检（__big-idx 尺寸+体检标记免读大值，稳态零开销）', file: 'js/chatcard.js', needle: 'marks[cid][0] === pubRaw.length && marks[cid][1] === ownLen' },
  { name: '#139 专属页导入全量备份防复制守卫（公用库兜底内容与合并结果相同不写专属键）', file: 'js/chatcard.js', needle: "if (fromPubFallback && ccScope === 'own') {" },
  { name: '#139 GIF 直存原图大小上限（超 3MB 跳过，防动图整份原图进库）', file: 'js/chatcard.js', needle: "String(reader.result || '').length > CC_GIF_MAX_B64" },
  { name: '#139 收藏图片压缩 CAS（压缩期间收藏被写则快照失效重排，绝不覆盖新数据）', file: 'js/chat.js', needle: 'if (rawNow !== rawSnap) {' },
  { name: '#142 媒体池查池命中不重写（写前批量探测，跨会话/桌面零重复落池）', file: 'js/media-pool.js', needle: 'writeBuf.push({ k: FULL + e[0], v: e[1].data }); dirty = true; }' },
  { name: '#142 媒体池键排除启动回填（media: 只存 IDB，防几百键吃回内存/LS）', file: 'js/idb.js', needle: "k.indexOf(uidPrefix + 'media:') !== 0 &&" },
  { name: '#142 聊天令牌化池先落盘再落引用（崩溃窗口最多池多孤儿，绝不令牌失据）', file: 'js/chat.js', needle: 'await window.mochiMediaFlush(); // 池数据先落盘，再让引用落盘（顺序不可反）' },
  { name: '#142 编辑消息入口令牌展开（图片消息 text 已令牌化，防令牌字符串进输入框被当文字保存）', file: 'js/chat.js', needle: 'const _origMedia = (window.mochiMediaExpand && window.mochiMediaExpand(orig)) || null;' },
  { name: '防骗+署名禁倒卖声明运行时回填·缺失重建置顶条（防倒卖：f7a8b5c首建/0965278移除后按用户需求恢复并扩展双条）', file: 'js/clock.js', needle: 'insertBefore(box, refNode || notice.firstChild)' },
  { name: '防骗+署名禁倒卖声明运行时回填·官方notice.json远程强刷（二传副本仍向官方域名拉权威文案）', file: 'js/clock.js', needle: "OFFICIAL_NOTICE, { cache: 'no-store' }" },
  { name: '防骗+署名禁倒卖声明运行时回填·置顶条在位判定（标题+全部特征词在位才跳过重建）', file: 'js/clock.js', needle: 'bar.marks.every' },
  { name: '#150 后台来电系统通知（bgNotifyCheck force 通道：一次性来电事件绕过 15s 过渡期/去重闸门）', file: 'js/bg-keep.js', needle: 'const force = !!extra.force;' },
  { name: '#150 后台命中来电不再放弃（maybeIncoming hidden 分支：写未接记录+系统消息+系统通知）', file: 'js/call.js', needle: 'if (document.hidden) {' },
  { name: '#150+#161 后台来电通知辅助（bgCallNotify：SW 链路弹「XX来电」，force+avFixed；#161 加 hint 尾缀；#204 加 avOverride 参数）', file: 'js/call.js', needle: 'function bgCallNotify(name, hint, avOverride) {' },
  { name: '#161 响铃挂起写入（holdIncomingCall：后台来电存 call-hold 全局根键+发可接听通知，不再即判未接）', file: 'js/call.js', needle: "bgCallNotify(name, '快回来接听，对方会等你几分钟', avOverride);" },
  { name: '#204 挂起接口暴露（callHoldIncoming：跨桌面来电后台命中同走响铃挂起）', file: 'js/call.js', needle: 'window.callHoldIncoming = holdIncomingCall;' },
  { name: '#204 跨桌面后台来电改走挂起（incoming-requests hidden 分支不再只发通知即丢弃）', file: 'js/incoming-requests.js', needle: 'if (window.callHoldIncoming) window.callHoldIncoming(name, req.cid, av);' },
  { name: '#161 挂起恢复（resumeHeldCall：回前台/冷启动有效挂起重响来电，超时补写未接）', file: 'js/call.js', needle: 'function resumeHeldCall() {' },
  { name: '#161 endCall 静默收尾通道（holdSilent 第二参：响铃挂起切后台只清 UI 不写未接）', file: 'js/call.js', needle: 'function endCall(text, holdSilent) {' },
  { name: '#152 聊天「继续说」按钮防键盘收起吞 click（触摸 pointerdown 按下即触发+鼠标排除）', file: 'js/chat.js', needle: "csBtn.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; csFireContinue(); });" },
  { name: '#152 群聊「继续说」按钮防键盘收起吞 click（同单聊 pointerdown+防重入）', file: 'js/group-chat.js', needle: "gcContinueBtn.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; gcCsFireContinue(); });" },
  { name: '#153 后台冻结1分钟(Chromium139 stop-in-background)保活自愈·切后台音频暂停立即补播+最快档重试（防静默窗口跨冻结线整页冻结=后台消息/通知全停）', file: 'js/bg-keep.js', needle: "if (document.visibilityState !== 'hidden') return;" },
  { name: '#153 后台冻结1分钟(Chromium139)保活自愈·隐藏期补播退避封顶20s（前台60s不变，冻结线内保证2~3次重试机会）', file: 'js/bg-keep.js', needle: "if (document.visibilityState === 'hidden' && delayMs > 20000) delayMs = 20000;" },
  { name: '#190/#260 保活音频安卓幅度（0.006→0.02 恢复：#190/#207 底噪根因在 220Hz 频率已换 18kHz，0.0003 电平距 audible 线仅 20% 余量、Edge/Chromium 152 收紧判定即丢冻结豁免=vivo X200s「后台保活失败」；iOS 0.002 bit 级不动）', file: 'js/bg-keep.js', needle: 'kaIsIOS() ? 0.002 : 0.02' },
  { name: '防倒卖回填·远程时效公告bulletin在位判定（notice.json下发text+until过期自动摘除,所有联网副本含二传显示）', file: 'js/clock.js', needle: "(!bulletin.until || Date.now() < bulletin.until)" },
  { name: '防倒卖回填·公告内容变化重写（标题固定「公告」+text 精确比对）', file: 'js/clock.js', needle: "if (box.textContent !== '公告' + want)" },
  { name: '防倒卖第二锚点·pwa.js在位看门狗（clock.js回填被删时的独立兜底,5s补回缺失声明；#315b 起回填插免责卡之后）', file: 'js/pwa.js', needle: "n.insertBefore(mkWatchBar('1', '防骗提醒', W1), dis ? dis.nextSibling : n.firstChild)" },
  { name: '#154 朋友圈评论「我的表情包」与聊天面板同源·暴露chat最新内存副本（IDB权威自愈，修store层旧LS快照/大键挂起导致的两侧不同步）', file: 'js/chat.js', needle: 'window.getMyEmojiGroups = function () { return myGroups || []; };' },
  { name: '#154 朋友圈评论「我的表情包」优先读chat内存副本（chat.js异常时旧store读兜底）', file: 'js/feed.js', needle: 'if (window.getMyEmojiGroups) {' },
  { name: '#156 群聊模式占卜图标强制收隐藏池（任意位置都隐藏，修「群聊开启后桌面占卜图标不消失」——原只在首页图标组原位时才收；#393 起带 !divPin 豁免， needle 同步收窄）', file: 'js/personalize.js', needle: 'if (divBtn && divBtn.parentNode !== pool && !divPin) {' },
  { name: '#156 applyDeskLayout 末尾重应用群聊模式（防 bare 布局应用把占卜从隐藏池按 desk-layout 复活回桌面）', file: 'js/personalize.js', needle: 'try { applyGroupChatMode(); } catch (e) {}' },
  { name: '#157+#531 聊天getPool默认主字卡兜底门＝「自定义 text 池没有可读句子卡」（#157 修 dc-overall 概率形同虚设；#531 放宽自 !text.length，用户只加颜文字/符号卡时旧门不触发＝池里没有句子卡，联系人只反复发那几张符号）', file: 'js/chat.js', needle: "if (catOn('main') && !chatHasReadableTextCard(text)) {" },
  { name: '#157 群聊gcPool主字卡兜底语义对齐聊天页（同#157概率失效修复）', file: 'js/group-chat.js', needle: "if (catOn('main') && text.length === 0) {" },
  { name: '#157 经期温柔前缀/动作随默认字卡总开关停用（修总开关关闭后聊天仍偶发前缀/动作字卡）', file: 'js/period.js', needle: 'if (_dcfg.enabled === false) return text;' },
  { name: '#159 跨桌面来电去掉前台门控（后台命中走 deliver hidden 分支发「XX来电」系统通知，修后台永不弹窗）', file: 'js/incoming-requests.js', needle: 'if (deskCallEn()) {' },
  { name: '#159 跨桌面来电通知 force 通道（与 #150 同口径，绕过 15s 过渡期/去重闸门）', file: 'js/incoming-requests.js', needle: 'avFixed: true, force: true }' },
  { name: '#160 GIF 上传上限砍到 512KB base64（修 iOS 字卡库堆到 62.8MB 每次整库 stringify/parse 秒级长任务卡死；逻辑锚点是数值表达式，改回大上限即消失）', file: 'js/chatcard.js', needle: 'const CC_GIF_MAX_B64 = 512 * 1024;' },
  { name: '#162 贴底钉住态 chatPinnedBottom（程序化滚底置真/用户触摸滚轮解除，修 iPadOS 26 Safari 回消息视图上漂）', file: 'js/chat.js', needle: 'let chatPinnedBottom = true;' },
  { name: '#162 来消息侧滚底 rAF+150ms 复写（原只写一次 scrollTop 被 iPadOS 26 内核顶开；改平滑滚动后复写走 scrollChatBottomSmooth，逻辑锚句随行更新）', file: 'js/chat.js', needle: 'requestAnimationFrame(() => { if (chatPinnedBottom) scrollChatBottomSmooth(); });' },
  { name: '#162 消息图片 lazy onload 钉住期间回到底部（图片加载晚于滚底内容长高顶开视图）', file: 'js/chat.js', needle: 'if (!chatPinnedBottom || batchRendering || !chatVisible()) return;' },
  { name: '#163 主动消息先掷默认字卡概率（dc-overall-chat 命中即用默认卡，修主动消息从不混默认=概率调到八九十仍总发用户自定义字卡反复出现）', file: 'js/chat.js', needle: "if (defs && defs.type !== 'poke' && defs.text) return { text: defs.text, type: 'text' };" },
  { name: '#163 群聊文本回复按成员桌面混入默认字卡（同聊天页 genOneReply 覆盖语义，原只有拍一拍走 getDefaultCardsFor）', file: 'js/group-chat.js', needle: "if (defs && defs.type === 'text' && defs.text) t = defs.text;" },
  { name: '#166 存储优化·媒体池GC引用面（#142 池只增不删债务收口；引用源扫描被删即消失）', file: 'js/media-pool.js', needle: 'keys.filter(function (k) { return REFS.test(String(k)); })' },
  { name: '#166 存储优化·写日志标记合并（每小键 set 值+标记两个 IDB 事务并成一个批量事务；改回逐键即时写即消失）', file: 'js/idb.js', needle: 'setTimeout(wrjMarkFlush, WRJ_MARK_FLUSH_MS)' },
  { name: '#166 存储优化·查看存储页孤儿清理入口（媒体池面板接线）', file: 'js/personalize.js', needle: "getElementById('st-media-gc')" },
  { name: '#167 多字卡回复总开关·单聊 scheduleReply（关=回复条数强制1条，修「关了多字卡仍拆多条」；改回无条件 randInt 即消失）', file: 'js/chat.js', needle: "const count = (c['py-en'] === 1) ? randInt(rpMin, rpMax) : 1;" },
  { name: '#167 多字卡回复总开关·继续说 continueChat（同上语义）', file: 'js/chat.js', needle: "count = (c['py-en'] !== 1) ? 1 : randInt(rpMin, rpMax);" },
  { name: '#167 多字卡回复总开关·群聊（gc-py-en 关=每成员每条只回一条）', file: 'js/group-chat.js', needle: "const count = (c['gc-py-en'] === 1) ? randInt(rpMin, rpMax) : 1;" },
  { name: '#167 多字卡回复总开关·单聊设置页说明在位（总开关语义文案）', file: 'template.html', needle: '关闭后每条消息只回一条、每条只用一张字卡' },
  { name: '#167 多字卡回复总开关·群聊设置页说明在位', file: 'template.html', needle: '每个成员每条消息只回一条' },
  { name: '#170 字卡库瘦身·删除前重读当前值防覆盖扫描后的编辑（组名匹配不到→不动，绝不据扫描快照盲写）', file: 'js/storage-slim.js', needle: 'if (g[cat].length === before) return false;' },
  { name: '#170 字卡库瘦身·查看存储页扫描入口（面板接线）', file: 'js/personalize.js', needle: "getElementById('st-cc-scan')" },
  { name: '#169 语音60秒误报根治（重复进入录音覆盖 voiceTimer 漏孤儿计时器每250ms误报已达60秒；孤儿自毁+非录音态不判60s，逻辑被改即消失）', file: 'js/chat.js', needle: 'if (voiceTimer !== voiceTid) { clearInterval(voiceTid); return; }' },
  { name: '#228 语音停止结账看门狗（雨见等慢壳 onstop 迟到/丢失时 3s 自行结账，onstop/看门狗/异常三路幂等只结一次账；删看门狗即回归「停止后永远停在正在录音」）', file: 'js/chat.js', needle: 'voiceStopWatchdog = setTimeout(() => { voiceStopWatchdog = null; voiceFinalizeStop(); }, 3000);' },
  { name: '#228 语音空数据可见失败+默认容器兜底（空 blob 不再静默 return 卡「正在录音…」，改失败态+下次换浏览器默认容器；删此行即回归静默卡死）', file: 'js/chat.js', needle: 'voiceMimeFallback = true;' },
  { name: '#228 麦克风启动挂起看门狗（getUserMedia 永不落定时不锁死 voiceStarting 闸门+迟到流停轨防泄漏；删即回归面板点不动）', file: 'js/chat.js', needle: "Object.assign(new Error('microphone timeout'), { name: 'TimeoutError' })" },
  { name: '#228 停止结账幂等闩（voiceStopSettled：onstop 与看门狗竞态只结一次账，防二次结账覆盖成功试听态）', file: 'js/chat.js', needle: 'if (voiceStopSettled) return;' },
  { name: '#171 iOS导milk json报「格式错误」·UTF-16转存重读自救（数NUL奇偶定位字节序换编码重读；删掉自救链此表达式即消失）', file: 'js/chatcard.js', needle: "reader.readAsText(f, odd >= even ? 'utf-16le' : 'utf-16be');" },
  { name: '#171 导入失败现场写诊断（__jsErrors 带[字卡导入]前缀，设置页复制诊断直接带出真因）', file: 'js/chatcard.js', needle: "'[字卡导入] '" },
  { name: '#171 导入处理异常单独提示（applyImportData 抛错不再被吞成「文件格式不正确」；#182 重构后走三元 else 支）', file: 'js/chatcard.js', needle: ": '导入处理失败：' + ((e && e.message) || '内部错误')" },
  { name: '#172 我的表情包刷新必丢·恢复链读空改走按需取回（大键挂起时裸idbGet永远拿不到值；删掉hydrate兜底此分支即消失）', file: 'js/chat.js', needle: 'if (!v) { myeHydrateFallback(); return; }' },
  { name: '#172 我的表情包刷新必丢·保存防覆盖闸门（该键仍挂起=本会话未恢复全量，先取回合并再写；拆掉闸门此判定即消失）', file: 'js/chat.js', needle: 'window.__xyIdbDeferredKeys.indexOf(MYE_KEY()) >= 0' },
  { name: '#173 美化/聊天方案导出统一三级降级保存链（window.mochiExportFile：分享面板→保存框→确认后下载，修 iPhone 主屏 standalone/壳浏览器 a[download] 静默无反应=无法导出）', file: 'js/data-backup.js', needle: 'window.mochiExportFile = function' },
  { name: '#173 桌面美化导出接统一导出链（downloadBeautyFile 降为兜底）', file: 'js/personalize.js', needle: "window.mochiExportFile(json, fname, 'mochi美化方案')" },
  { name: '#173 桌面美化导入补回粘贴文本通道（textarea+文件并存，修 standalone 文件选择器不弹=无法导入）', file: 'js/personalize.js', needle: '粘贴美化方案文本' },
  { name: '#173 聊天美化导出接统一导出链（裸 a[download] 降为兜底）', file: 'js/chat-settings.js', needle: "window.mochiExportFile(json, fname, 'mochi聊天美化方案')" },
  { name: '#180 刷新重开丢最近聊天·同步尾巴日志（每条新消息先同步落 LS <cid>:chat-tail 再交低频整包落盘；删掉 append 调用此行即消失）', file: 'js/chat.js', needle: 'chatTailAppend(rec); // #180：同步尾巴日志先落 LS，再交低频整包落盘' },
  { name: '#180 尾巴日志权威就绪后回放（读库成功合并未落盘的最近消息；拆掉 merge 调用此行即消失）', file: 'js/chat.js', needle: 'chatTailMerge() > 0) changed = true; } catch (e) {} // #180' },
  { name: '#180 LS 快照超限保尾不弃写（折半丢最旧保最近；改回静默 return 此循环即消失）', file: 'js/chat.js', needle: 'while (snap.length > LS_SNAP_LIMIT && snapArr.length > 1 && round < 5)' },
  { name: '#181 气泡 CSS 通用映射导出（单聊/群聊共用；删掉导出则两处注入全瘫）', file: 'js/chat.js', needle: 'window.mochiMapBubbleCss = function' },
  // #181 单聊气泡 CSS 走通用映射（未认出模板类名时整包声明兜底，修上传零变化）。
  // 2026-09-15 由本会话（构建者）换锚：#181 原锚 `window.mochiMapBubbleCss(css, '')` 的 scope 实参
  // 被并行会话的 #536 在途稿改成 `'#page-chat '`（单聊气泡必须钉在 #page-chat 作用域，否则会泄漏
  // 进群聊同族类名），逻辑未变、只是实参换了。此处锚到不含实参的前缀形式——既继续证明「走的是
  // 共享映射器而不是旧内联兜底」，又不再因 scope 形参演进再次失配。chat-settings.js 属 AI-A 域，
  // 本会话未改动该文件。
  { name: '#181 单聊气泡 CSS 走通用映射（未认出模板类名时整包声明兜底，修上传零变化；换回旧映射此行即消失）', file: 'js/chat-settings.js', needle: "window.mochiMapBubbleCss(css, " },
  { name: '#181 群聊气泡 CSS 走通用映射（带 #page-group-chat 作用域，同单聊兜底；换回旧 replace 链此行即消失）', file: 'js/group-chat.js', needle: "window.mochiMapBubbleCss(css, '#page-group-chat ')" },
  { name: '#182 超大库导入·写盘前松开源文本（200MB 级 stringify(groups) 与源文本不得同时钉在堆上）', file: 'js/chatcard.js', needle: "txt = ''; raw = null;" },
  { name: '#182 超大库导入·OOM 识别分流（RangeError/Out of memory 给瘦身指引不报「格式错误」）', file: 'js/chatcard.js', needle: 'rangeerror|out of memory' },
  { name: '#182 超大库导入·FileReader 结果松绑（诊断只留文件头 rawHead；先 slice 再 replace 绝不全文扫描）', file: 'js/chatcard.js', needle: 'reader.onload = null; reader.onerror = null;' },
  { name: '#185 联系人空气泡·回复最终非空兜底（固定回复字卡/默认主字卡为空白时落 FALLBACK，删掉此行空气泡回归）', file: 'js/chat.js', needle: "if (typeof t !== 'string' || !t.trim()) t = pick(FALLBACK_REPLY_POOL);" },
  { name: '#185 联系人空气泡·渲染端空白占位（历史空白记录显示占位而非空壳）', file: 'js/chat.js', needle: 'const __blankMsg = !__rawText.trim();' },
  { name: '#185 删除消息防复活·del 分支同步摘尾巴日志（漏 chatTailDrop 则刷新后 chatTailMerge 把删掉的消息拼回）', file: 'js/chat.js', needle: 'chatTailDrop(msgs[idx]); // FIX 2026-09-05 #185' },
  { name: '#186 表情/图片空白·GC 引用扫描补全（旧正则漏群聊键/LS 快照→清理孤儿媒体误删池数据）', file: 'js/media-pool.js', needle: 'const REFS = /(?:^|:)(?:chat-msgs|fav-msgs|group-chat-msgs|gc-msgs-[0-9A-Za-z_-]+|chat-tail|cc-groups(?:-public)?)$/;' },
  { name: '#186 表情/图片空白·写池失败回滚令牌化（flush 返回 false 不得带令牌 saveMsgs，防令牌入库池数据丢失）', file: 'js/chat.js', needle: 'if (_ok === false) {' },
  { name: '#187 专属字卡串桌面·主动消息跨桌面守卫（tryAutoSend 入口捕获 cid，await 取回后放行前拦截；删掉则 B 桌面触发的主动消息把 B 池专属卡发进 A 桌面聊天）', file: 'js/chat.js', needle: 'const sameAutoCid = () => (window.__activeCid || \'default\') === autoCid;' },
  { name: '#187 专属字卡串桌面·取回后与消息定时器逐层拦截（await 后 + 每条 setTimeout 入口）', file: 'js/chat.js', needle: 'if (!sameAutoCid()) return; // FIX #187 取回期间已切桌面：池子是旧桌面的，整条主动消息放弃' },
  { name: '#188 朋友圈无图·守卫核心探测（idbGet 超时返回 undefined 与键不存在不可分；仅确认权威键确实不存在才放行写回，探测失败按存在处理）', file: 'js/feed.js', needle: "window.idbHasKey(uid + ':' + KEY).then(ok => ok === false)" },
  { name: '#188 朋友圈无图·权威回读写回走守卫（拒写＝权威仍在，增量留内存+10s 有界重读权威恢复完整视图）', file: 'js/feed.js', needle: 'feedGuardWrite(JSON.stringify(merged)).then(written =>' },
  { name: '#188 朋友圈无图·15s 保险丝写回走守卫（病理窗口 load() 可能只是剥图快照，直写=无图版本永久盖进权威键）', file: 'js/feed.js', needle: 'feedGuardWrite(JSON.stringify(all))' },
  { name: '#188 朋友圈无图·发布兜底直写走守卫（同上，剥图快照版 list 不得裸写权威键）', file: 'js/feed.js', needle: 'feedGuardWrite(JSON.stringify(list))' },
  { name: '#188 朋友圈无图·save 未就绪非空直写走守卫（与 persistSnap 相邻=预就绪分支；#496 口径演进：stringify 内联）', file: 'js/feed.js', needle: 'feedGuardWrite(JSON.stringify(arr));\npersistSnap(arr);' },
  { name: '#188/#496 朋友圈无图·save 就绪后写回走守卫（#496 口径演进：post-ready 改延后落盘，锚在低频节流表达式与 flush 兜底）', file: 'js/feed.js', needle: 'FEED_WRITE_MIN_GAP - (performance.now() - lastFeedWriteAt)' },
  { name: '#496 朋友圈评论/点赞卡顿止血·pagehide/切后台强制刷盘兜底（主键落盘改合并+低频+空闲窗口后，离页必落）', file: 'js/feed.js', needle: 'function flushFeedWrite() {' },
  { name: '#496 朋友圈评论/点赞卡顿止血·load() 内存真相层（免整包 JSON.parse 的点击帧长任务；原多行带缩进锚因构建拼接剥行首缩进恒失配，收口批改单行唯一式）', file: 'js/feed.js', needle: 'list = feedMem;' },
  // ==== 2026-09-15 #501 信箱回信页「下滑被拉回、无法正常滑动」（vivo S20 Edge 等多机型，#399 同页二次复发族）——nudgeInputVisible 被键盘看门狗聚焦期每 250ms 调用，输入框在滚动容器内时（回信/写信页 .cal-scroll、日历留言等）用户下滑即被拽回「输入框可见」位；修=几何记忆（容器几何与输入框高度不变=现状出自用户滚动，不补位）====
  // #501 几何记忆闸的哨兵由 #535h 承接（#538 换键后仍是同一行早退判定，避免共用锚点被判哑哨兵）
  // v3.26.x #189：全屏滑动闪烁 + iPad 全屏开关无效果（三根因五处修复，见 FIX-REGRESSION #189）
  { name: '#189 自愈层复活·healViewport 补 documentElement 声明（v3.26 重写漏写，裸 d=window.d undefined → TypeError 被 try 吞，稳态残留清理/大平移归零/#174 缩放自愈整层静默失效）', file: 'js/mobile-adapt.js', needle: 'var d = document.documentElement; // FIX 2026-09-05 #189' },
  { name: '#189 滑动闪烁·稳态自愈 pin 改条件式（清残留/大偏移才归零；无条件 pin 把全屏覆盖形态下用户滚动每秒拽回顶部=闪烁）', file: 'js/mobile-adapt.js', needle: 'if (_cleanedResidue || winScrollY() > KB_SCROLL_HEAL) pinScrollTop();' },
  { name: '#189 滑动闪烁·全屏底边容差计入 --mochi-safe-top（#179 后 .phone 底边天然超 vv 一个安全区，旧 +24 误判位移每秒归零）', file: 'js/mobile-adapt.js', needle: 'window.innerHeight) + _stT + 24;' },
  { name: '#189 滑动闪烁·全屏态跳过 vv offset 残留判定（iOS 弹性回弹被当平移残留归零=掐断用户手势；阈值被 #视口平移残留 改严，锚点收敛到「_fsLike 非全屏门」本身）', file: 'js/mobile-adapt.js', needle: '!_fsLike() && _vv && (Math.abs(_vv.offsetTop)' },
  { name: '#视口平移残留 非全屏稳态残差严阈值 =4（#189/#179 为放行 iPad 全屏弹性回弹把 offsetTop 残差门槛提到 KB_SCROLL_HEAL(80)，非全屏 iPhone 键盘收起遗留 ≈42px 过不了 80 永不归零=输入栏错位/打字看不到内容；阈值被放宽回 80 或删此行即复发；全屏态 _fsLike 门见 #189 哨兵）', file: 'js/mobile-adapt.js', needle: 'Math.abs(_vv.offsetTop) > 4 || Math.abs(_vv.offsetLeft) > 4' },
  { name: '#189 滑动闪烁·全屏分支 --mochi-ios-h 写入 ≥6px 迟滞（全屏过渡/工具条显隐期逐帧抖动重排连发）', file: 'js/mobile-adapt.js', needle: 'if (isNaN(_curFs) || Math.abs(_nPxFs - _curFs) >= 6)' },
  { name: '#189 滑动闪烁·非全屏分支 --mochi-ios-h 写入 ≥6px 迟滞（iPad 滚动期 vv ±1~3px 逐帧抖动=reflow 连发）', file: 'js/mobile-adapt.js', needle: 'if (isNaN(_curN) || Math.abs(vh - _curN) >= 6)' },
  { name: '#189 iPad 全屏误杀·方向监视 iOS 出口（Safari 无 orientation.lock，iPad 横屏持握 ~2s 后被 handleLandscapeForced 退出全屏+误导弹窗）', file: 'js/fullscreen.js', needle: 'function startFsMonitorSafe() { if (isIOS) return; startFsMonitor(); }' },
  { name: '#189 iPad 全屏误杀·开关 1500ms 复核跳过 iOS 横屏杀全屏（否则 FB_KEY=1 被永久写坏+退出全屏）', file: 'js/fullscreen.js', needle: 'if (!isIOS && isFullscreen() && viewportLandscape()) {' },
  { name: '#189 iPad 全屏误杀·orientationchange iOS 出口（全屏态转横不纠偏、非全屏不弹「请恢复竖屏」误导弹窗）', file: 'js/fullscreen.js', needle: 'if (isIOS) return; // FIX 2026-09-05 #189' },
  { name: '#189 iPad 全屏可见效果·tablet standalone 全屏隐藏模拟状态栏（#111 手机保留不动；iPad 系统栏网页盖不住，保留=开关零视觉变化「没有生效」）', file: 'css/base.css', needle: 'html.tablet.ios-pwa-standalone.ios-fs-active .phone .statusbar { display:none; }' },
  { name: '#193 字卡库写路径防覆盖守卫（权威大库未取回进内存前绝不整包写回——iPhone 17 Pro Safari 批量导入后 17.67MB 公用库旧字卡全部消失；#188/#120 同族第三例）', file: 'js/chatcard.js', needle: 'if (!ccAuthSeen[ccScope] && window.idbHasKey) {' },
  { name: '#193 残缺库写回改为合并营救（取回权威库后按分组把内存增量并进去再写，旧字卡与本次导入都不丢）', file: 'js/chatcard.js', needle: 'groups = mergeCcGroupsInto(loadGroups(), mem);' },
  { name: '#193 权威已取回标记·探测确认 IDB 无键才放行直写（新装/空库合法直写通道，防守卫误伤）', file: 'js/chatcard.js', needle: 'if (!exists) { ccAuthMark(); saveGroupsNow(groups); return null; }' },
  { name: '#196 经期温柔语态·前缀/动作近期不重复（池仅 6 条纯均匀随机连抽同几句被当 bug；改回裸均匀随机此行即消失）', file: 'js/period.js', needle: 'var fresh = avail.filter(function (x) { return warmRecent[hist].indexOf(x) < 0; });' },
  { name: '#197 ce-box change 补派·blur 内容有变才派（contenteditable 不自发派 change，安卓全站挂 change 的保存永不触发；删掉 dispatchEvent 此行全站回退）', file: 'js/mobile-adapt.js', needle: "box.dispatchEvent(new Event('change', { bubbles: true }));" },
  { name: '#197 ce-box change 补派·聚焦基线记录（无基线则 blur 永不比对；删掉此行补派即哑火）', file: 'js/mobile-adapt.js', needle: "box.addEventListener('focus', function () { ceChangeVal = box.textContent || ''; });" },
  { name: '#198 经期卡壁纸·裸类型选择器兜底（CARD_BG_TYPES 无 desk-period，回空串=上传后永不应用；改回 return \'\'; 即回归）', file: 'js/personalize.js', needle: "return def ? def.sel : '[data-card-bg=\"' + type + '\"]';" },
  { name: '#198 经期卡壁纸·applyAll/rescue 遍历 DOM 收集全类型（只遍历白名单则裸类型壁纸重启/切桌面不回填）', file: 'js/personalize.js', needle: 'const applyAllCardBgs = () => cardBgAllTypes().forEach(t => applyCardBg(t));' },
  { name: '#199 浏览器覆盖形态·env 探针扩展（雨见/Via 沉浸式安卓壳 screen==inner 非 standalone：原只认 ios-pwa-standalone，35px 系统栏无人避让=模拟状态栏钻顶 #114 形态；门槛收敛到判定器 needEnvProbe，改回只认 standalone 此分支即消失）', file: 'js/mobile-adapt.js', needle: "_f0.needEnvProbe && _envTopCache < 0 && _sh2 > 0 && _vh2 > 0" },
  { name: '#199 浏览器覆盖形态·mochi-cover-top 类同步（CSS 无法用「var 已设」表达条件，类不挂则状态栏避让规则永不生效）', file: 'js/mobile-adapt.js', needle: "d.classList.toggle('mochi-cover-top', _wantCover);" },
  { name: '#199 浏览器覆盖形态·状态栏顶部避让（特异性夺回被 .statusbar{padding:4px} 压死的 env 避让，#114 同根因；删此规则该形态顶位回 4px 钻系统栏）', file: 'css/base.css', needle: 'html.mochi-cover-top .phone .statusbar' },
  { name: '#199 Gecko 滚动锚定关闭（锚定自行调 scrollTop 与 #162 贴底钉住对打=删消息/回消息屏幕上移；删此行雨见/Firefox 复发）', file: 'css/base.css', needle: '.chat-body { overflow-anchor: none; }' },
  { name: '#199/#236 判定器·浏览器覆盖形态期望底边=可视区底（.phone 刻意不超 inner，仍按 envTop+inner 判则修好后误报 #179 少填；#210 起判式收敛到共享判定器；#236 扩安卓壳 sig.andr——删扩展 HeyTapBrowser 类壳回退 covered/期望 envTop+inner 误报少填）', file: 'js/device.js', needle: 'const coverBrowser = !standalone && envTop >= 20 && (diff <= 2 || !!sig.andr);' },
  { name: '#236 诊断③覆盖形态有效顶位（元素顶+实测 padding：该形态 .statusbar 靠自身 padding 抬升、.phone 无 padding 兜底链，单量元素顶恒 0=顶部重叠误报/漏报双向失真。锚点随 #537 扩 iosCover 换锚——逻辑扩为「浏览器覆盖壳 OR iOS 独立应用覆盖形态」，两者都靠自身 padding 抬升；判式被改掉/退回单条件即失配）', file: 'js/device.js', needle: 'const sbEffTop = (Fm.coverBrowser || Fm.iosCover) ? inp.sbTop + (parseFloat(inp.sbPadTop) || 0) : inp.sbTop;' },
  { name: '#236 安卓浏览器覆盖形态执行器（env 探针→共享判定器→写 --mochi-safe-top+挂 mochi-cover-top：执行侧此前整体在 isIOS 分支，安卓壳 #114 形态永无修复；摘除即回归）', file: 'js/mobile-adapt.js', needle: 'var _fc = window.mochiViewportForm({ standalone: false, envTop: _aCoverEnvCache, innerH: _ih, screenH: _sh, iosMajor: 0, safMajor: 0, andr: true, safeTopForce: false });' },
  { name: '#236 安卓键盘会话卡死自愈判据（HeyTapBrowser 收键盘 vv 恒卡 inner−底栏：缩幅落残留带 13~22%+inner 回基准+会话超 1.5s+vv 稳 1.2s 才清 _aKb 置 _aVvStale——真键盘缩幅>22% 永不误清）', file: 'js/mobile-adapt.js', needle: '&& Date.now() - _aKbAt > 1500 && Date.now() - _aVvChgAt > 1200' },
  { name: '#236 open 判定残留闩门（_aVvStale 抑制纯 vv 收缩再触发键盘会话，防 652↔720 抖动把 .phone 来回抽；触摸/聚焦/回基准解除。#479 同批同步：判定式追加 _focNow 焦点闸——改这里必须连 #479 语境一起看）', file: 'js/mobile-adapt.js', needle: 'open = (!_aVvStale && h < _aH - 60 && _focNow)' },
  { name: '#479 窗口改尺寸（Edge小窗/分屏）焦点闸——真键盘必然在文本聚焦期弹出（focusin 先于 vv 收缩），无聚焦深缩=窗口被改小；删掉 _focNow 闸则小窗重新触发幽灵键盘会话（面板停靠/alignSelf 残留）', file: 'js/mobile-adapt.js', needle: 'var open = (!_aVvStale && h < _aH - 60 && _focNow);' },
  { name: '#479 窗口级改尺寸基线重锚（事件侧 syncAndroidKb：inner≈vv 一起深缩+无文本聚焦=小窗/分屏/桌面缩放窗口，_aH/_aIH/_aFullIH 三基线全体跟随当前窗口；_aFullIH 下移后 #369 触发条件恒假=双保险）', file: 'js/mobile-adapt.js', needle: 'if (_ihN < _aFullIH) _aFullIH = _ihN;' },
  { name: '#479 #369 残留自愈加键盘语境门（_aShrinkHadFoc=打字期深缩才允许钉高回全屏；无焦点深缩走窗口重锚）——防止 Edge 小窗被 #369 钉回旧全屏高把顶栏/输入栏推出窗外（Ace3 实报「顶部名称栏和输入框消失」）', file: 'js/mobile-adapt.js', needle: '(_aVvShrunkSeen || _aPanSeen >= 80) && _aShrinkHadFoc' },
  { name: '#479 钉高前提失败阀（钉高 10s 后内核仍不回全屏高且用户在深缩态有新交互=在用这个窗口尺寸 → 放弃钉高基线重锚；覆盖焦点滞留期深缩的窄路径误钉）', file: 'js/mobile-adapt.js', needle: 'if (_aVpPin && _aVpPinAt > 0 && Date.now() - _aVpPinAt > 10000' },
  { name: '#479 window.resize 同步桥（部分壳改窗口只发 window.resize 不发 vv.resize，基线重锚/键盘判定依赖 syncAndroidKb 跑到；resizes-visual 真键盘不缩布局视口=桥不触发，双跑幂等早退）', file: 'js/mobile-adapt.js', needle: "window.addEventListener('resize', function () { try { syncAndroidKb(); } catch (eWR) {} });" },
  { name: '#203 iOS18 保留形态甄别式（standalone+env∈[20,160]+diff≈envTop+iOS≥18，命中即 safeTop 归 0：否则 #179 公式把 .phone 顶出布局视口=居中裁切+文档溢出与 pin 对打=滑动/切换卡顿；#210 起判式收敛到共享判定器，删门槛或改比较符即回归）', file: 'js/device.js', needle: 'diff >= envTop - 8 && iosMajor >= 18' },
  { name: '#203 iOS18 保留形态显式写 0px（摘除属性会回落 env() 变双重避让，Mochi 行上方 59px 空白）', file: 'js/mobile-adapt.js', needle: "var _topPx = _safeTop ? _safeTop + 'px' : (_resStand ? '0px' : '');" },
  { name: '#203 执行器接入共享判定器（syncVvFit 形态判定单一事实源 #210；执行器回退手抄判式此行即消失）', file: 'js/mobile-adapt.js', needle: 'var _f = window.mochiViewportForm(_sig0);' },
  { name: '#203 判定器·保留形态期望底边=inner（.phone 超 inner=文档滚动量；#184 iPad 形态/#186 force 声明同走 inner 分支；#210 起收敛到共享判定器 expBase 单点）', file: 'js/device.js', needle: 'const expBase = (coverBrowser || resStand || ipadForm) ? innerH' },
  { name: '#200 通话防误挂·挂断掷骰硬闸（总开关或概率<=0 不掷骰——挂断几率为 0 仍被挂断的兜底闸门，删此条件设 0 即回到「读默认 2% 照挂」）', file: 'js/call.js', needle: 'if (!(hp.nohangup || hp.hangup <= 0) && Math.random() * 100 < hp.hangup) {' },
  { name: '#200 通话防误挂·总开关配置读取（callCfg 不读 call-no-hangup 则开关形同虚设）', file: 'js/call.js', needle: "nohangup: c['call-no-hangup'] === 1 || c['call-no-hangup'] === '1'," },
  { name: '#200 通话防误挂·设置项默认值（reply-settings 不登记该键则开关永不落盘/读取恒缺）', file: 'js/reply-settings.js', needle: "'call-no-hangup': 0," },
  { name: '#200 通话防误挂·通话设置页开关行（template 无锚点则页面无入口）', file: 'template.html', needle: 'id="call-no-hangup"' },
  { name: '#201 浏览器顶部黑边·theme-color 静态默认=浅色页底（写死 #111111 时安卓 Edge/Chromium 把页面外 41px 系统区涂黑=顶部黑边）', file: 'template.html', needle: 'content="#e9e9e9"' },
  { name: '#201 浏览器顶部黑边·theme-color 跟随主题同步（applyThemeMode 不刷新 meta 则深色模式切回浅色后仍涂深色）', file: 'js/personalize.js', needle: "meta.setAttribute('content', bg)" },
  { name: '#202 表情/图片空白·加载失败占位统一入口（令牌缺失+远程图断网/失效+parts 图全覆盖；曾因并行 stash 收口丢失，此次重登记）', file: 'js/chat.js', needle: 'function bindMediaFailPlaceholder(b) {' },
  { name: '#202 表情/图片空白·占位判据（延时复核 naturalWidth=0 且池确认无数据才替换，防 404 抢跑误清正常表情）', file: 'js/chat.js', needle: 'if (im.naturalWidth !== 0) return;' },
  { name: '#205 表情空白·全透明空图检测（加载成功但内容无画面=最后一类真空白；采样 alpha 全 0 才占位，多设备共用坏字卡库现场）', file: 'js/chat.js', needle: 'if (im.dataset.alphaChecked) return;' },
  { name: '#206 表情重复+乱码+空白·尾巴日志拒收媒体型消息（sticker/image 的 text=媒体本体，回放丢 type + 令牌化后签名漂移被当新消息回放=同一表情旁多出乱码/坏图复制）', file: 'js/chat.js', needle: "if (rec.type === 'sticker' || rec.type === 'image' || rec.type === 'voice') return;" },
  { name: '#206 表情重复+乱码+空白·超长文本/parts 不进尾巴日志（截断存储与丢图回放同样失真）', file: 'js/chat.js', needle: "if (typeof rec.text !== 'string' || rec.text.length > CHAT_TAIL_TEXT_MAX) return;" },
  { name: '#206 表情重复+乱码+空白·回放端拦截旧版存量媒体存根（data:/@@m: 开头无 type 的条目跳过，防 normCell 误迁移成坏图 image）', file: 'js/chat.js', needle: "if (jt.indexOf('data:') === 0 || jt.indexOf('@@m:') === 0) continue;" },
  { name: '#207+#340 保活音频电流声/嗡鸣·频率统一换 18kHz（220Hz 在人耳最敏感频段：#190 降幅度后安卓多机型仍实听嗡声→#207 换 18kHz；#340 iPhone 16 Pro Safari 同根因复发——iOS 忽略 audio.volume，220Hz@0.002 实听比安卓被投诉电平还大 4 倍=「打开一直震动响声重启无用」；iOS 无 Chromium audible 判定，amp 分支不动=电平语义零回归）', file: 'js/bg-keep.js', needle: 'const freq = 18000;' },
  { name: '#208 聊天输入栏上移白边·键盘收起视口未还原自愈（iOS standalone 键盘收起 WebKit 偶发不还原视口，restoreKb 的 60px 还原门槛永不满足=kbActive 卡真 .phone 卡收缩高；失焦>4s 且视口仍<基线−60 强制复原）', file: 'js/mobile-adapt.js', needle: 'Date.now() - _focLostAt > 4000 && _vv && _vv.height < _fullVv - 60' },
  { name: '#208 聊天输入栏上移白边·tabbar 隐藏跳过采集（全屏页 tabs.js 给 tabbar 挂 hidden，矩形全 0 被判悬空 860px 每 5s 刷假错误环）', file: 'js/device.js', needle: 'if (!tb || tb.hidden) return null;' },
  { name: '#208 聊天输入栏上移白边·判定器布局视口未贴底（保留形态 diff 应≈envTop；键盘收起未还原时按 inner 判贴合全绿漏报，单列 ✗ 让白带状态可诊断）', file: 'js/device.js', needle: 'diff > envTop + 24 && !(inp.kb && inp.kb.kbActive)' },
  { name: '#209 输入栏下方灰底断截面·焦点保留硬证据自愈（安卓返回键收键盘不派 blur/#197 族 focusout 丢失时 !foc 复原分支永不执行=停靠残留卡死；可视区双信号回满 ≤12px 即复原，焦点在不在都算键盘已收；推定停靠 _aProv/_iProv 与全屏态不碰）', file: 'js/mobile-adapt.js', needle: 'if (_hNow <= 0 || _hNow < _aH - 12) return;' },
  { name: '#210 视口形态判定器同源（window.mochiViewportForm 单一事实源：执行器 syncVvFit 与诊断 screenDiagJudge 共用，新形态只改一处；删定义即回归两处手抄判式漂移——#186 期间 force 分支已实际漂移两处）', file: 'js/device.js', needle: 'window.mochiViewportForm = function (sig) {' },
  { name: '#210 判定器·force 声明期望底边=屏高（#186 缺陷修正：原误写 innerH 与「期望=屏高」注释矛盾，forced 设备自检必误报底部超出；env=0 的 18.3 白边期望按 safeTop+inner 补满。#276 起该分支同步加坏 screenH 门，needle 随代码演进）', file: 'js/device.js', needle: 'forceCover ? ((screenH >= innerH ? screenH : 0) || (safeTop + innerH))' },
  { name: '#210 采集器 force 传入判定器（#186 缺陷修正：漏传致「用户已声明覆盖形态」分支在真实采集路径永不命中=死分支）', file: 'js/device.js', needle: "inp.force = (function () { try { return localStorage.getItem('xy-home-v2:__safe-top-force') === '1'; } catch (e) { return false; } })();" },
  { name: '#210 屏幕适配事件沿捕获（5s 轮询漏瞬态：切后台回来 innerHeight 短报整屏/旋转中态；resize/vv/旋转/回前台 1.2s 去抖补采，同一键盘守卫+签名去重）', file: 'js/device.js', needle: "window.visualViewport.addEventListener('resize', sdEdge)" },
  { name: '#210 屏幕适配错误环带事发现场数值（最近错误直读 env/var/diff/inner/sb/scale，报障免复现）', file: 'js/device.js', needle: "(snap ? snap.envTop : '?') + ' var=' + (snap ? snap.varTop : '?')" },
  { name: '#210 屏幕适配报告附历史快照时间线（自动监视 ✗ 存档随报告带出，报障免复现）', file: 'js/device.js', needle: 'sdHistTimeline()' },
  { name: '#211 聊天收发整窗重建闪一下（窗口超限判定 RENDER_MAX→WINDOW_MAX：旧条件在钳位渲染后每来一条消息恒为真，历史>200条桌面每收发一条=200气泡整窗重建重新解码=肉眼闪一下；收紧后常规收发走增量追加，与 loadOlderIncremental→pruneWindowBottom 同口径）', file: 'js/chat.js', needle: 'msgs.length - renderStart > WINDOW_MAX' },
  { name: '#211 打开聊天闪动·归一化收尾渲染闸（后台迁移发现改动曾无条件整窗重建=打开聊天偶尔闪一下的第二来源；改动全落在渲染窗口之外时跳过，sysNick 清扫/相邻删除保守整窗）', file: 'js/chat.js', needle: 'sysNickChanged || removedAll > 0 || changedHi >= renderStart' },
  { name: '#212 挖孔屏全屏顶端留白·安卓 enterFs 补 navigationUI hide（Chromium 40723205：挖孔屏默认 auto 不把全屏面铺到挖孔区=页面外系统层 letterbox 顶端露空白、页面内测量全绿无法诊断，iQOO12 等多机型；iOS 路径原有参数不动，老内核忽略选项参数零回归）', file: 'js/fullscreen.js', needle: "const fsOpts = { navigationUI: 'hide' };" },
  { name: '#216 音乐封面全丢·代理封面正则（存量迁移与播放/页面打开迁移全靠它识别 meting 图片代理 URL；被删/改窄=代理封面永不迁移，第三方代理一挂新旧封面全丢——一加Ace3+Edge 实测）', file: 'js/music-player.js', needle: 'var COVER_PROXY_RE = /^https?:\\/\\/api\\.injahow\\.cn\\/meting\\/\\?[^]*type=pic/i;' },
  { name: '#216 音乐封面全丢·新封面落库前解析直链（meting type=song 的 pic 是图片代理 URL，直接入库=显示命依赖第三方单点；解析失败原样回退代理）', file: 'js/music-player.js', needle: 'if (pic) { resolveCoverDirect(String(pic), cb); return; }' },
  { name: '#216 音乐封面全丢·meting 挂掉的第二封面源（超时/挂/被拦走 fetchNeteaseInfo 多代理链的 song/detail album.picUrl=网易 CDN 直链；删此函数则主源一挂新加歌永久无封面）', file: 'js/music-player.js', needle: 'function fetchNeteaseCoverFallback(id, cb) {' },
  { name: '#216 音乐封面全丢·迁移同步历史/TA收藏快照（快照里冗余的代理封面不同步则历史图标仍依赖第三方代理；只换 URL 不动快照结构）', file: 'js/music-player.js', needle: 'function syncSnapshotCovers(sid, cov) {' },
  { name: '#214 standalone 顶部黑边·manifest theme_color 浅色（安卓 Edge/Chromium standalone 形态状态栏取 manifest theme_color 而非页面 meta，#201 只改了 meta 一加Ace3+Edge 仍黑边；改回深色即回归，深色模式用户由 meta 动态同步兜着）', file: 'pwa/manifest.json', needle: '"theme_color": "#e9e9e9"' },
  { name: '#210 屏幕适配全屏页外 letterbox 盲区提示行（挖孔屏 letterbox 在页面坐标系外、页内全绿无法检测——iQOO12 实证；仅全屏态且无其他 ✗ 时输出，引导关开一次全屏重新申请；删条件或改输出即回归；v3.27.x #217 加 isAndroid 门控后锚点收窄至守卫表达式，全量门控另立 #217 哨兵）', file: 'js/device.js', needle: '!F.some(function (f) { return !f.ok; })' },
  { name: '#215 发送取值兜底·输入快照捕获（Edge 点发送瞬间撕组合文本零事件，innerText/textContent 双读空＝消息 0 条字静默丢；删此行快照永不更新即回到缺口）', file: 'js/chat.js', needle: "input._mLastTyped = input.innerText || '';" },
  { name: '#215 发送取值兜底·新鲜快照恢复（双口径读空+真实编辑晚于上次清空+15s 新鲜度三重收紧才启用；删除/放宽此恢复分支＝撕文本场景回 0 条消息）', file: 'js/chat.js', needle: 'if (snap && userEditedAfterClear() && Date.now() - lastUserEditAt < 15000) return snap;' },
  { name: '#217 屏幕诊断·⑤e 停靠残留判定条目（#209 同族对号条目：键盘停靠已结束而 .phone 内联 height/alignSelf 未清=输入栏上移/灰边；双端键盘探针+vv 收缩三重守卫防键盘期误报；删此判定则 #209 看门狗失效真机无诊断可对号）', file: 'js/device.js', needle: '(inp.phoneInlineH || inp.phoneAlignSelf)' },
  { name: '#217 屏幕诊断·⑤f 横向贴合判定条目（宽度轴此前零判定，#185 平板左右露白同族；#187 起平板也全宽故无限宽豁免；桌面手机壳 isMobileDev 跳过）', file: 'js/device.js', needle: 'inp.phoneW != null && inp.isMobileDev && inp.innerW' },
  { name: '#217 屏幕诊断·letterbox 提示 isAndroid 门控（现象为安卓 Chromium 系统层行为，iOS 无原生全屏 API 提示行纯噪声降噪）', file: 'js/device.js', needle: 'inp.fsActive && inp.andr' },
  { name: '#217 屏幕诊断·离开抢拍钩子（#209 K70 实锤残留只存在于切页前最后一帧、切页 blur 即自愈，5s 轮询/事件沿均采不到；tabs.js hidden 前与本钩子同步抢拍坏形态存档）', file: 'js/device.js', needle: 'window.__mochiLeaveSnap = function (trig)' },
  { name: '#217 屏幕诊断·hidden 微任务级抢拍（观察器随 device.js 注册先于 tabs.js syncChrome 的 blur=自愈前现场；覆盖不经 tabs.js 的 JS 直切页）', file: 'js/device.js', needle: "sdPgMo.observe(p, { attributes: true, attributeFilter: ['hidden'] })" },
  { name: '#217 屏幕诊断·监视二次确认降噪（首见坏签名只存档，连续两 tick ≥5s 持续才入错误环——治 #208 iPad 切后台单采样瞬态刷环；瞬态证据仍留在历史快照）', file: 'js/device.js', needle: 'if (_sdPend && _sdPend.sig === bad)' },
  { name: '#217 屏幕诊断·错误环 SD 先逐出（[屏幕适配] 条目与 JS onerror 同队列，纯 FIFO 爆发时把真 JS 错误顶出环外；满时先逐最旧 SD 条目保 JS 错误）', file: 'js/device.js', needle: 'if (iSD < 0) arr.shift(); else arr.splice(iSD, 1);' },
  { name: '#217 屏幕诊断·坏快照分级保留（坏现场稀少且珍贵，纯 FIFO 8 条会被后续好快照顶没；坏/好各保底最近 4 条）', file: 'js/device.js', needle: 'bads.concat(goods).sort(function (a, b) { return a.t - b.t; })' },
  { name: '#217 屏幕诊断·SIG 机读签名行（报告尾固定键序 JSON，用户整段复制后开发者可脚本解析对号/录 verify 台账）', file: 'js/device.js', needle: "L.push('SIG ' + JSON.stringify(sig))" },
  { name: '#217 屏幕诊断·先更新再测比对（手动诊断拉远端 version.json 比本机 ts，远端新出 60s 容差即提示先更新——#215 实锤存量旧版未送达修复是症状大半来源）', file: 'js/device.js', needle: 'remoteTs > lts + 60000' },
  { name: '#217 屏幕诊断·切页前抢拍钩（syncChrome 的 blur 在切页瞬间触发残留自愈，必须在 pages hidden 之前同步采集）', file: 'js/tabs.js', needle: 'const sdLeaveSnap = () =>' },
  { name: '#132 功能字卡概率·stepper 绑定与 dcfGet（#518 起出口改经 dcfEffGet 套总档；改掉 DCF_DEF 默认表或删 window.dcfGet 暴露即回归——字卡库【其他互动功能字卡】各分类使用概率可显示可调）', file: 'js/default-cards.js', needle: 'window.dcfGet = dcfEffGet;' },
  { name: '#132 温柔前缀/动作概率接 dcf-period（改回硬编码 Math.random()*100>=25 即回归——经期字卡概率可调）', file: 'js/period.js', needle: 'if (Math.random() * 100 >= _warmP) return text;' },
  { name: '#132 摸鱼浮字/抓包回应概率接 dcf-fish（改回 Math.random()<0.35 硬编码即回归；#224 改经本 IIFE 助手 dcfPFish→window.dcfGet，原锚 dcfP 跨 IIFE 不可见是作用域 bug 本体）', file: 'js/p2-features.js', needle: 'dcfPFish(35)' },
  { name: '#132 吃饭追问关心概率接 dcf-eat（改回硬编码 0.35 即回归）', file: 'js/p2-features.js', needle: "dcfP('eat', 35)" },
  { name: '#132 同频敲三下回应概率接 dcf-sync（改回硬编码 0.6 即回归）', file: 'js/p2-features.js', needle: "dcfP('sync', 60)" },
  { name: '#132 伸手摸到概率接 dcf-reach（改回硬编码 0.55 即回归）', file: 'js/p2-features.js', needle: "dcfP('reach', 55)" },
  { name: '#132 喝水字卡乘法门控接 dcf-water（删 dcfHit 门控行即回归——多档内部节奏不改，0=全关）', file: 'js/p2-features.js', needle: "if (!dcfHit('water')) return;" },
  { name: '#132 花园悄悄话概率接 dcf-garden（改回 Math.random()<0.4 硬编码即回归）', file: 'js/garden.js', needle: "if (Math.random() * 100 < _gP) {" },
  { name: '#132 查岗回应概率接 dcf-deskcheck（改回 Math.random()*100<50 硬编码即回归）', file: 'js/chat.js', needle: 'Math.random() * 100 < _dkP' },
  { name: '#132 房间字卡门控接 dcf-room（删 sayLine 门控行即回归）', file: 'js/room.js', needle: "window.dcfGet('room')" },
  { name: '#132 此间字卡门控接 dcf-cjian（删 cjLine 门控行即回归）', file: 'js/cjian.js', needle: "window.dcfGet('cjian')" },
  { name: '#611 梦角档案管理·入口提醒（档案页管理弹窗顶部「梦角会跟着桌面联系人自动创建」，删这句即回归）', file: 'js/cjian.js', needle: "'梦角会跟着桌面联系人自动创建，一般不用手动添加'" },
  { name: '#611 梦角档案管理·arc 不带时辰（档案页添加梦角不弹时辰浮层、提示改指此间；改回「下一步还能限定 TA 常在的时辰区间」即回归）', file: 'js/cjian.js', needle: "'选一个时间偏移（想限定 TA 常在的时辰，去「此间」设）'" },
  { name: '#611 梦角档案管理·入口传 arc 标记（删 { arc: 1 } 即回归——档案页又会冒出此间的「时辰区间」）', file: 'js/memo-arc.js', needle: 'e.stopPropagation(); if (window.cjianManage) window.cjianManage({ arc: 1 });' },
  { name: '#132 漂流瓶字卡门控接 dcf-drift（删 poolLine 门控行即回归）', file: 'js/drift-bottle.js', needle: "window.dcfGet('drift')" },
  { name: '#132 音乐字卡门控接 dcf-music（删 taPauseSendCard 门控行即回归）', file: 'js/music-player.js', needle: "window.dcfGet('music')" },
  { name: '#132 功能字卡概率 stepper UI（fc 页 13 分类 + dk 页查岗，删 UI 即回归）', file: 'index.html', needle: 'dcf-prob-period-val' },
  { name: '#219 背景模糊/遮罩层盖住壁纸（z-index 0→2——#147 壁纸常驻图层 z1 压住本层后白遮罩被盖+backdrop-filter 采样不含壁纸=调整无效，改回 0 即回归）', file: 'css/home.css', needle: 'position:absolute; inset:0; z-index:2; pointer-events:none;' },
  { name: '#239 互动功能字卡页/查岗字卡页整页滚动（#132 概率框 ~794px 插头部后 .card-list flex 最小尺寸因 overflow:auto 归 0：列表压成 6px 且首屏在视口外=「字卡看不到了点击没内容」；删此规则即回归 #page-default-cards 同族病）', file: 'css/chat-pages.css', needle: '#page-fun-cards #fc-list { flex:0 0 auto; overflow:visible; min-height:0;' },
  { name: '#240 背景模糊载体改壁纸层自滤（backdrop-filter 在小米15Pro/Chrome 151 真机采样不生效 #219 后仍无感；blur>0 挂 .desk-blur-on 对 #phone-bg-layer filter+四边外扩 24px 防边缘发虚——删此规则真机模糊恒无感）', file: 'css/home.css', needle: '.phone.desk-blur-on #phone-bg-layer' },
  { name: '#241 权威比屏上多时尾部增量追加（原地补丁放宽：快照缺尾部/对端新消息只在 IDB 时不再整窗清空重画=打开聊天「先跳动一下」；loadNewerIncremental 传 len 一次补齐，删此分支即回归）', file: 'js/chat.js', needle: 'for (let r = 0; r < Math.ceil(grown / LOAD_STEP) + 1 && renderEnd < len; r++) loadNewerIncremental(len);' },
  { name: '#220 权威读库收尾·同窗原地补丁（条件不满足才整窗重渲——删补丁分支=每次打开聊天整窗重建 200 气泡重新解码肉眼跳动）', file: 'js/chat.js', needle: 'if (!inplacePatchIfSameWindow()) {' },
  { name: '#220 重开聊天不闪·同窗判定（enterChat 重开跳过整窗重建——删此判定=重复进入聊天页必闪一下）', file: 'js/chat.js', needle: 'if (!inplacePatchIfSameWindow()) renderWindow(false, true);' },
  { name: '#220 屏上渲染凭据登记（windowRenderedN/Prefix/Stale——整窗渲染时记录「屏上由哪份 msgs 渲染」，同窗补丁的判定基础，删登记则补丁永不命中=哑修复）', file: 'js/chat.js', needle: 'windowRenderedPrefix = window.activePrefix();' },
  { name: '#220 增量追加对齐渲染凭据（addRec 后屏上窗口多出尾部消息，重开时才能命中同窗补丁——删此对齐=聊过天再重开必闪）', file: 'js/chat.js', needle: 'windowRenderedN = Number(el.dataset.idx) + 1;' },
  { name: '#220 idle 回执占位标记（权威前读不到正文渲染占位+pendingRead 标记，权威到位原地替换——删标记则占位文本永久停留）', file: 'js/chat.js', needle: "m.dataset.pendingRead = '1';" },
  { name: '#224 摸鱼抓包 chk 作用域修复（本 IIFE 自备 dcfPFish 走 window.dcfGet——删助手改回跨 IIFE 引用 dcfP 即回归：每分钟 ReferenceError dcfP is not defined）', file: 'js/p2-features.js', needle: 'function dcfPFish(def)' },
  { name: '#226 idbSetAll 挂起超时骨架（#166 微批化后挂起内核上 wrj 标记/媒体池 flush 永不落地、false 兜底不可达=杀进程回滚 LS 后自愈失效「刷新后丢美化/丢数据」——删超时骨架即回归）', file: 'js/idb.js', needle: 'const lim = 4000 + (est > 262144' },
  { name: '#229 wrj 合并失败重试（原入口即置 merged+idbGetAllKeys 把读失败折叠成空数组：挂起内核上自愈第二道防线空转一次全会话放弃=LS 回滚的美化/设置/小数据本会话无法恢复「部分数据丢失」——改回一次性放弃即回归）', file: 'js/idb.js', needle: 'if (!keys) { wrjMergeRetry(); return; }' },
  { name: '#230 红包状态流转原地补丁（领取/退回/TA领取/TA退回/自动领取此前一律 renderWindow 整窗重建=全部气泡 img 重新解码=领取红包必闪屏，#211/#220 同族最后一条未收口路径、与机型历史条数无关；改回无条件整窗即回归）', file: 'js/chat.js', needle: "card.classList.remove('opened', 'expired');" },
  { name: '#230 用户领取红包路径守卫（报障主路径：点击红包卡先试原地补丁，卡片不在渲染窗口才回退整窗）', file: 'js/chat.js', needle: 'if (!rpPatchStatusInPlace(rpIdx)) renderWindow(true, true);' },
  { name: '#235 iOS Safari 26 独立模式覆盖形态判定（26.x 起独立应用状态栏行为变「覆盖」env 报真实值且内容垫到状态栏下，resStand 加 safMajor<26 门——删门则 26.x standalone 同信号被误判保留=漏加顶部避让顶栏融进灵动岛+高度少算 env 段底部白带；18.x 老内核保留形态不受影响）', file: 'js/device.js', needle: 'safMajor > 0 && safMajor < 26' },
  { name: 'v3.34.x 自定义字卡全量导入（列表页新入口：公用/专属/功能卡/寻踪/情话/TA六类一份 json；写盘前走 hydrateLibScopes 权威取回再 ccFullApply，删守卫=空快照覆盖权威库重演 #193）', file: 'js/chatcard.js', needle: 'ccFullApply(d, mode)' },
  { name: 'v3.34.x 自定义字卡全量导入导出列表页入口锚点（template.html）', file: 'template.html', needle: 'li-cc-full-export' },
  { name: '#237 添加备忘触发聊天提问（新增后 TA 经 chatAddIn 回应+追问一条带「备忘」chip——此前新增零聊天联动，只剩完成/分享两通道；删调用即回归）', file: 'js/memo-app.js', needle: "window.chatAddIn(memoPick(DEF_MEMO_ASK).replace('{m}', memoClip(v, 16))" },
  { name: '#238 备忘提醒聊天发送锚（概率催办经 chatAddIn 发「备忘提醒」chip：引擎改道不发即回归）', file: 'js/memo-app.js', needle: "window.chatAddIn(text, { tag: '备忘提醒' })" },
  { name: '#238 备忘提醒间隔闸（last=上次提醒时刻，命中后至少隔 2 天——用户反馈不用太频繁；删闸则每 4 分钟命中即发=轰炸）', file: 'js/memo-app.js', needle: 'if (Date.now() - c.last < 2 * 86400000) return;' },
  { name: '#242 群聊串群收口·撤回落回来源群（定时器捕获调度时的 gid，切群后撤回不再写错群/撤错消息；去掉 gid 传参即回流串群）', file: 'js/group-chat.js', needle: 'retractGcMsg(myIdx, gid)' },
  { name: '#242 群聊串群收口·scheduleReply 绑定来源群（回复定时器落库不再读执行时刻的 curGid——发消息后切群回复写进新群+原群丢失）', file: 'js/group-chat.js', needle: 'memberReply(cid, userText, gid)' },
  { name: '#243 群聊 IDB 回填防串群（loadMsgs 异步回调 key 不等于当前群整包丢弃——否则旧群回调在切群后 resolve 会整包覆盖 msgs 并被下次保存回写污染新群存储键）', file: 'js/group-chat.js', needle: 'if (key !== groupMsgKey(curGid)) return;' },
  { name: '#244 群聊撤回查看安全化（撤回先存渲染快照 rec.orig 对齐单聊 chat.js；无快照走 gcRetractFallbackHtml 转义回退——直出原始文本=多行丢换行/媒体点开整屏 base64/字卡含 HTML 被执行。#245/#247 批 needle 同步：媒体类记录/超 20KB 快照改走占位回退防臃肿）', file: 'js/group-chat.js', needle: 'rec.orig = (el && el.innerHTML.length <= 20000) ? el.innerHTML : gcRetractFallbackHtml(rec);' },
  { name: '#245 打开聊天精简快照残留原位升级（大历史 LS 剥负载快照不再整窗清空重画=真机闪屏+弹一下；改 liteUpgrade 收集+残留下标 replaceChild 换节点，见 verify-chat-lite-upgrade.mjs）', file: 'js/chat.js', needle: 'old.parentNode.replaceChild(nu, old);' },
  { name: '#247 群聊媒体令牌化（落盘前 data:image 统一换 @@m: 池令牌+池先落盘——删 normalize 则表情/图片继续整段 base64 内联进消息数组，全量重写一次比一次大直到 LS 配额静默丢写）', file: 'js/group-chat.js', needle: 'Promise.resolve(window.mochiMediaTokenize(v)).then(t => { seen.set(v, t || v); })' },
  { name: '#247 群聊撤回快照防臃肿（媒体类记录/超大快照走占位回退不存 DOM 快照——否则令牌化省下的空间被快照里的整段 base64 吃回去）', file: 'js/group-chat.js', needle: "const mediaish = rec.type === 'sticker' || rec.type === 'image' || rec.type === 'voice' ||" },
  { name: '#248 群聊历史分页·渲染窗口起点（进群只渲最近 RENDER_MAX 条，gcRenderStart 供「查看更早」续载——删则回归只上不下，老消息存了但界面永远看不到）', file: 'js/group-chat.js', needle: 'gcRenderStart = Math.max(0, n - RENDER_MAX);' },
  { name: '#276 群聊撤回图片可看缩略图（点击查看时 gcRetractMediaHtml 即时从 rec.text/rec.parts 重拼 img，data:/@@m: 均可显；优先于存量占位快照——改回 rec.orig 优先则撤回图片只剩【图片】文字）', file: 'js/group-chat.js', needle: 'gcRetractMediaHtml(rec) || rec.orig || gcRetractFallbackHtml(rec)' },
  { name: '#248 群聊历史分页·滚动位置保持（顶部补历史按 scrollHeight 差值回补 scrollTop——删则点查看更早视口跳底/闪跳）', file: 'js/group-chat.js', needle: 'try { body.scrollTop += body.scrollHeight - prevH; } catch (e) {}' },
  { name: '#268 搜索/引用跳转·裁剪区下界外扩窗（jumpToMsg 只处理 idx<renderStart，落在被 pruneWindowBottom 裁剪的 idx>=renderEnd 时 target 查不到=搜索点了不跳不高亮；补向下增量展开直到 renderEnd>idx——删此分支即回归「搜索/引用点了没反应」）', file: 'js/chat.js', needle: 'else if (idx >= renderEnd && idx < msgs.length) {' },
  { name: '收口第二批 env 能力层（device.js 唯一 UA 嗅探处：chat 语音 WebView/data-backup 分享黑名单/music-player API 拦截提示/bg-keep 小米通知提示四消费端只读标记——删 env 挂载=四端读 undefined 恒 false，语音走错容器/华为夸克分享假成功回归）', file: 'js/device.js', needle: 'env: env,' },
  { name: '收口第二批 语音 WebView 消费锚（chat.js 改读 mochiDevice.env.isAndroidWebView——标准安卓 Chrome 才走 webm/opus 防爆音，删读取则全安卓 WebView 误走 webm 能录不能播）', file: 'js/chat.js', needle: 'return !!((window.mochiDevice || {}).env || {}).isAndroidWebView;' },
  { name: '收口第二批 备份分享黑名单消费锚（data-backup.js 改读 env.brokenFileShare——删读取则华为/夸克分享假成功 AbortError 回归=无法导出备份）', file: 'js/data-backup.js', needle: 'const brokenFileShare = !!((window.mochiDevice || {}).env || {}).brokenFileShare;' },
  { name: '收口第二批 kaIsIOS 薄壳（bg-keep.js 改读 mochiDevice.isIOS 唯一判定源——复刻正则回来=device.js 判定升级时保活幅度/频率走错平台分支）', file: 'js/bg-keep.js', needle: 'try { return !!(window.mochiDevice || {}).isIOS; } catch (e) {}' },
  { name: '#250 切桌面卡死·表情包全局键重复重读（chat.js 切换监听不再 myEmojiLoad+reloadMyEmojiFromIdb——my-emoji-groups 全局键切桌面不变，删此守卫则大表情库设备每次切换整包 JSON.parse×2+35MB idbGet 主线程卡死数秒）', file: 'js/chat.js', needle: "loadEmojiPref(); // v3.26.x：切换联系人后按该桌面的上次 tab/分组偏好落位，不复用上一桌面状态\nif (!emojiPanel.hidden) renderEmojiPanel();\n});" },
  { name: '#250 切桌面卡死·群聊切换按可见性重渲（group-chat.js 隐藏态挂起 gcSwitchDirty 不整窗重渲 200 条——删则重度群聊设备每次切换白耗主线程；成员名随联系人改名变化由 enterGroupChat 全量重建保证）', file: 'js/group-chat.js', needle: 'const pageVisible = page && !page.hidden;' },
  { name: '#250 切桌面卡死·卡片背景恒等跳过（personalize.js applyCardBg 值变才写——赋同值=浏览器作废已解码位图重新解码，MB 级 dataURL 真机切换瞬间整屏重解码）', file: 'js/personalize.js', needle: 'if (el.style.backgroundImage === next) return;' },
  { name: '#251 群聊对齐聊天设置·回车发送开关（keydown 读 cs-enter-send===\'off\' 放行换行——删则群聊回车强制发送，关不掉）', file: 'js/group-chat.js', needle: "if (window.activeStore().get('cs-enter-send') === 'off') return;" },
  { name: '#251 群聊对齐聊天设置·数据导出导入（导出流式拼接 Blob 防超长+导入兼容三结构确认覆盖——删则群聊记录无备份/恢复通道；#375 导出改令牌展开后 needle 随 const head 行更新）', file: 'js/group-chat.js', needle: "const head = '{\"app\":\"mochi-zika-group-chat\"" },
  { name: '#253 字卡导入全局崩溃修复·提取袋提升函数作用域（const bag 原声明在备份提取分支块内、函数尾部 #139 守卫读它必抛 ReferenceError=所有格式导入成功解析后必崩机型无关[华为Pro70+Edge 实证]；声明挪回分支块内此锚消失）', file: 'js/chatcard.js', needle: 'let bag = {}; // v3.26.x #253：从备份提取分支块内提升到函数作用域（仅备份分支填充，尾部 #139 守卫要读）' },
  { name: '#253 字卡导入全局崩溃修复·兜底标记提升函数作用域（fromPubFallback 同上提升，#139 专属页兜底置位语义不变）', file: 'js/chatcard.js', needle: 'let fromPubFallback = false; // v3.26.x #253：同上提升' },
  { name: '#254 音乐「去除VIP歌曲」改 meting 播放同源逐首探测（原 proxy.cors.sh 域名 DNS 已注销+allorigins 522=所有机型点击必失败；探测失败不计账绝不误删，与播放同依赖面不再有独立死点——判据锚随「可播/不可播」记账语义走）', file: 'js/music-player.js', needle: 'playable ? 0 : 1' },
  { name: '#255 room.js 装扮地板第二步 floorPick 补齐（函数整体缺失=装扮选墙纸确定必抛 ReferenceError「Can\'t find variable: floorPick」诊断实证；删地板弹窗此锚消失）', file: 'js/room.js', needle: 'function floorPick() {' },
  { name: '#255 iOS 键盘期弹窗顶对齐·开关（mobile-adapt 键盘会话 _kbActive/_iProv 给 #modal-mask 挂 modal-kb-dock——居中弹窗随 .phone 高度变化反复取中=打字输入框上滑；删则顶对齐失效）', file: 'js/mobile-adapt.js', needle: "mk.classList.toggle('modal-kb-dock'" },
  { name: '#255 iOS 键盘期弹窗顶对齐·CSS（mask 顶对齐 + 安全区上边距；删则 JS 挂类无效果）', file: 'css/base.css', needle: '.modal-mask.modal-kb-dock { align-items: flex-start; }' },
  { name: '#255 批量导入弹窗放大（opts.big 宽版 420px/94vw + textareaRows=14 给足 14 行起始高度、安卓 ce-box min-height rows*1.5*16，超 52vh 框内滚动——272px 窄弹窗用户报障「太小了/加长可滑动」；删则回退窄小框）', file: 'js/chatcard.js', needle: 'textareaRows: 14' },
  { name: '#257 整页「点不动」死点击逃生门·判定锚（同点 3 快击零 click=死点击，先做 click 活性复核防误报——删则健康页误触发复位/真死页缺判定依据）', file: 'js/mobile-adapt.js', needle: 'if (_escLastClickAt >= tapEndAt)' },
  { name: '#257 整页「点不动」诊断·触摸轨迹采集（与交互轨迹并排输出：触摸有 click 无=死点击实锤；key __diag-touch 跨重启随诊断回收）', file: 'js/device.js', needle: "'xy-home-v2:__diag-touch'" },
  { name: '#261 复制用的隐藏 textarea 复制完当场塌回零长选区（select() 的全选留给延迟 removeChild 变孤儿选区=安卓原生黑色【全选】浮条失去宿主、永久卡在桌面「今日情话」右边；删则浮条卡屏回流）', file: 'js/device.js', needle: 'ta.setSelectionRange(0, 0)' },
  { name: '#261 死选区回收·判定范围（只收脱离文档的选区 + 禁选桌面内的非编辑区选区——编辑区活选区必须放过，否则弹窗「手动全选复制」/输入框改字被误清；放宽即成新 bug）', file: 'js/mobile-adapt.js', needle: 'if (editable || !desk || !desk.contains(host)) return false;' },
  { name: '#261 死选区回收·事件接线（回收器定义了没人调=死代码；selectionchange 是内核自造选区当场收口的唯一入口，删则已卡住的浮条要等下次触摸才消）', file: 'js/mobile-adapt.js', needle: "document.addEventListener('selectionchange', reapSoon)" },
  { name: '#262 表情「内容为空」误报·判空前必过静态图门禁（canvas 只画得出动画图第一帧，而表情包 GIF 首帧常是全透明清屏帧＝正常动图被判坏图并误导去字卡库清理；去掉门禁此锚消失）', file: 'js/chat.js', needle: "if (!alphaCheckable(im.getAttribute('src') || '')) return;" },
  { name: '#262 表情「内容为空」误报·GIF 多帧门禁（≥2 个图形控制扩展 21 F9 04＝动图一律不判；放宽成不数帧则动图再度中招）', file: 'js/chat.js', needle: 'if (n >= 2) return false;' },
  { name: '#262 表情「内容为空」误报·APNG 门禁（acTL 块＝动画 PNG，canvas 同样只画首帧，一律不判）', file: 'js/chat.js', needle: "if (type === 'acTL') return false;" },
  { name: '#262 表情「内容为空」误报·只嗅探小文件（真空白图压完必然极小；超 96KB base64 直接放行＝大动图零 atob 成本，去掉上限则每条大表情都整包解码扫字节）', file: 'js/chat.js', needle: 'if (!b64.length || b64.length > EMPTY_SNIFF_MAX_B64) return false;' },
  { name: '#262 表情「内容为空」误报·二次采样确认（首采全 0 后隔 350ms 复采仍有画面＝引擎解码未就绪，撤销判定；去掉复采=iOS/未知内核时序差直接误报）', file: 'js/chat.js', needle: 'if (!alphaSampleEmpty(im)) return; // 复采有画面＝首采遇解码未就绪，撤销判定' },
  { name: '#260 保活双锚·WebRTC 回环数据通道（页内 RTCPeerConnection 对=页面生命周期与音频并列的冻结豁免信号；Edge/Chromium 152 收紧 audible 判定后单押音频失效=后台 1 分钟冻结，删此锚只剩音频单锚）', file: 'js/bg-keep.js', needle: "p1.createDataChannel('mochi-ka');" },
  { name: '#260 保活双锚·后台心跳节拍（隐藏期每 30s 写 IDB 计数/轨迹=冻结取证；device.js「保活现场」靠它出「心跳断流=页面被冻结」实锤，删则后台死活只剩用户口述）', file: 'js/bg-keep.js', needle: 'setInterval(kaHbTick, 30000);' },
  { name: '#260 保活诊断出口 __kaProbe（device.js「保活现场」的数据源，删则诊断行静默消失、保活现场无从取证）', file: 'js/bg-keep.js', needle: 'window.__kaProbe = function () {' },
  { name: '#260 诊断「保活现场」行消费 __kaProbe（开关/音频/媒体条/WebRTC/心跳断流判决一行直出，删则「后台保活失败」类报障继续靠口述猜）', file: 'js/device.js', needle: "window.__kaProbe === 'function'" },
  { name: '#263 取最长而非首个非空（多源并发比列表长度、同数取靠前者；退回「第一个非空源即收口」正是「只能导入 10 首」的根因）', file: 'js/music-player.js', needle: 'r.list.length > best.list.length' },
  { name: '#263 曲目数=10 是网易 detail tracks 首屏截断签名，见到就不收口、给慢源 1.5s 宽限（删则截断源抢收，62 首歌单回到 10 首）', file: 'js/music-player.js', needle: 'if (n !== NETEASE_TRACKS_TRUNC && !graceTimer) graceTimer = setTimeout(finish, 1500);' },
  { name: '#263 全量 meting 实例接入（按 trackIds 批量补歌曲详情的源——用户自建歌单只有它给全量；删掉这一路=又只剩首屏 10 首的实例）', file: 'js/music-player.js', needle: 'https://api.qijieya.cn/meting/?server=netease&type=playlist&id=' },
  { name: '#263 缺口如实记账（trackCount 全量数 − 实取数 = miss → toast「另有 N 首未取到，稍后重导可补齐」；删则只拿到首屏也报全量成功，用户无从知道漏了多少）', file: 'js/music-player.js', needle: 'const miss = Math.max(0, (totalKnown || 0) - tracks.length);' },
  { name: '#263 移动端「复制链接」歌单识别（分隔符类含 # 与 !——m/playlist#!?id=xxx 不再整张被当一首歌导入）', file: 'js/music-player.js', needle: 'line.match(/playlist[\\/?#&!\\s]*(?:id=)?(\\d+)/i)' },
  { name: '#263 各 meting 实例封面 URL 归一到 injahow 图片代理（#216 迁移链只认这个域名；不归一则列表实例代理 URL 成为新的第三方单点、实例挂了一起丢封面）', file: 'js/music-player.js', needle: 'cover: canonicalMetingPicUrl(t.pic),' },
  // ==== v3.26.x #264 跨桌面查岗/来电「开了好几天一次都没触发」====
  // 根因：未应答的 pending 永久留在 localStorage 队列 → hasPending 从此挡死该联系人一切跨桌面触发。
  // 每条 needle 都是「修复生效必然存在、逻辑被改必然消失」的表达式，名字留着实现改坏也能拦下。
  { name: '#264 孤儿 pending 自愈判据（跨会话 + 超存活上限才释放；去掉 sid 条件=本会话正显示的弹窗被抢答、去掉时限=用户还没看到就被清掉，两种都会把修复改成新 bug）', file: 'js/incoming-requests.js', needle: "x.sid !== SESSION_ID && now - (x.ts || 0) > PENDING_TTL_MS" },
  { name: '#264 投递记录会话归属（弹窗只活在投出它的页面会话里，没有 sid 就识别不出跨会话孤儿，自愈整块变死代码）', file: 'js/incoming-requests.js', needle: "req.sid = SESSION_ID;" },
  { name: '#264 活弹窗对账（遮罩在且标题仍是当初投出的那个才算还活着；去掉标题比对=别的弹窗顶掉它之后仍被认成活弹窗，pending 永不释放＝本 bug 回流）', file: 'js/incoming-requests.js', needle: "titleEl.textContent === liveModals[cid]" },
  { name: '#264 浮层互斥覆盖面（全站唯一弹窗 DOM + 查岗卡 + 问答门 + 通话面板四类；漏一个就是同轮互相顶掉留下孤儿 pending）', file: 'js/incoming-requests.js', needle: "'modal-mask', 'tc-mask', 'qa-mask', 'call-mask'" },
  { name: '#264 锁屏/打字期硬挡投递（应用锁问答门冷启动默认开，投进去只会压在锁底下；打字期抢焦点会丢掉 IME 组合中的字）', file: 'js/incoming-requests.js', needle: "if (!document.hidden && (hardLocked() || typingBusy())) return false;" },
  { name: '#264 浮层占用默认不投、force 才顶（去掉 force 参数=手动触发和逃逸额度一起失效，软互斥变成新的永不触发）', file: 'js/incoming-requests.js', needle: "if (!force && !document.hidden && layerBusy()) return false;" },
  { name: '#264 让路有上限后照投（长期占屏最多让 BUSY_ESCAPE 轮，之后重新计票继续投；删此锚=别的弹窗常驻时跨桌面触发永远归零）', file: 'js/incoming-requests.js', needle: "busyTicks = 0; escape = true;" },
  { name: '#264 逃逸额度一次性消费（投成功即收回；退回「整轮共用一个布尔」=逃逸那一轮同轮投出 2 个弹窗，后一个顶掉前一个又造孤儿）', file: 'js/incoming-requests.js', needle: "if (deliver({ cid: cid, kind: 'checkin', text: showText, q: q, ts: Date.now(), status: 'pending' }, escape)) escape = false;" },
  { name: '#264 首查提前到 12s（手机上「开一下看一眼就走」的短会话此前 30~90s 内一次都掷不到；改回大延迟=短会话用户继续零触发）', file: 'js/incoming-requests.js', needle: "setTimeout(startIncomingTick, 12000)" },
  { name: '#264 诊断「跨桌面来消息体检」行（轮询次数/闸门/档位/下次可掷/近期释放一行直出，删则「开了好久没触发」类报障继续靠口述猜）', file: 'js/device.js', needle: "ip.ticks + ' 次 闸门=' + ip.gate" },
  // ==== v3.32.x #265 桌面图标顺序「退出浏览器后还原初始布局」（小米13+Edge，内核无关）====
  // 根因：启动 IDB 补读块无条件写回，把「LS 比 IDB 新鲜」这条自家优先级反向覆盖了。
  { name: '#265 IDB 补读只填「现在读不到」的键（LS 有值即跳过；删掉这行守卫=启动补读又无条件覆盖更新鲜的 localStorage，Edge/真我/荣耀/小米等丢弃 fire-and-forget idbSet 的内核上「改完布局退出浏览器就还原」原样回流）', file: 'js/personalize.js', needle: 'if (store.get(rel) !== null) return;' },
  { name: '#265 补读前缀只取一次 activePrefix（filter 与 slice 共用同一个 iconPfx；改回两次调用=异步期间 correctCidFromIdb 纠正 cid 后，前缀与 slice 长度对不上，会把别的桌面的键名/键值搬进当前桌面，与 #151 同族串桌面）', file: 'js/personalize.js', needle: "const iconPfx = window.activePrefix() + ':';" },
  { name: '#265 mochi-restore-done 后重排图标顺序（导入/恢复回填完成时按权威值再排一次；删掉=备份导入后桌面仍是默认布局，直到下次重启才生效）', file: 'js/personalize.js', needle: 'try { restoreAppIconOrder(); } catch (e) {}' },
  { name: '#265 切换联系人时重排图标顺序（app-icon-order-<grid> 是 per-cid 键；漏监听=切桌面后仍显示上一个联系人的排序，与 hidden-icons 的 #151 处理成对）', file: 'js/personalize.js', needle: "document.addEventListener('contact-switched', restoreAppIconOrder);" },
  { name: '#265 补读完成后图标图片与顺序一起重绘（Promise.all 落地同调两个 restore；只留 restoreAppIcons=补读到的顺序永远等不到重排，本次修复的核心断言 T1/T2 回流）', file: 'js/personalize.js', needle: 'restoreAppIcons(); restoreAppIconOrder(); }' },
  // ==== v3.32.x #266 字卡库列表页兜底取回 IIFE「漏调用括号」死代码（iOS13+Chrome/Edge 等「导入字卡过一段时间就没了，刷新就消失」，多机型同族）====
  // 根因：f143621 把本段结尾 `})();` 改成 `});` —— 语法合法、node --check 过、文本锚点也在，
  // 但整段 IIFE 变永不执行的死代码。iOS 启动回填被后台杀连接打断后，内存/LS 两路读空、只剩
  // IndexedDB 有权威数据，唯一会按用户查看时点把库拉回来的防线（hidden 观察者）就此断掉 =
  // 字卡库读出空 = 「没了」。修复 = 恢复 `})();` 立即调用。needle 取「observe 调用 + 结尾调用括号」，
  // 只保留注释/名字不改括号，反照样能抓到。
  { name: '#266 字卡库列表页兜底取回 IIFE 必须立即调用（结尾 `})();`；漏调用括号=语法合法但整段死代码=iOS 回填被打断后字卡库永久空载「刷新字卡消失」，多机型同族）', file: 'js/chatcard.js', needle: "observe(libPage, { attributes: true, attributeFilter: ['hidden'] });\n}\n})();" },
  // ==== v3.32.x #267 安卓「平移型键盘内核」停靠与卡死（荣耀 X50 自带浏览器，多机型同族）====
  // 根因两处：浏览器为露焦点的平移量在归零前被丢弃 → 保底停靠只能盲猜 58%（IME 更高时
  // 输入栏整行仍在键盘下）；主链路接管不清 _aProv → _aKb+_aProv 并存把四条复原路全堵死。
  { name: '#267 实测平移记档（_aPinPan 归零前把平移量存进 _aPanSeen；删掉=保底停靠回盲猜 58%，荣耀 X50 等平移型内核输入栏整行仍在键盘下看不见打不出）', file: 'js/mobile-adapt.js', needle: 'if (_panPx > 8) {' },
  { name: '#267 停靠有实测按实测（_aProvDock 采信 ≥80px 且 1.5s 内新鲜的平移量；改回恒 58%=IME 高于 42% 的机型整行被盖、矮于 42% 的机型多缩出空白，X5/旧夸克无实测仍走 58% 不受影响）', file: 'js/mobile-adapt.js', needle: '_aPanSeen >= 80 && Date.now() - _aPanSeenAt < 1500' },
  { name: '#267 主链路接管即清推顶（open 分支补 _aProvClear；缺它则 _aKb 与 _aProv 并存，看门狗与 #209 清扫全被挡住 → 键盘期内联收缩高永久残留＝输入栏下方一整块空白）', file: 'js/mobile-adapt.js', needle: 'kbDockPanels(); _aProvClear(); }' },
  { name: '#267 卡死停靠自愈·视口侧（_aKb 真而 vv+inner 双回基准且活焦点不在文本框即复原；删掉=收键盘不再派 resize 的内核（荣耀自带浏览器族）无人复检，停靠锁死在键盘数值）', file: 'js/mobile-adapt.js', needle: 'if (_vN > 0 && _vN >= _aH - 12 && _iN >= _aIH - 12 && !_aIsText(document.activeElement)) {' },
  { name: '#267 卡死停靠自愈·焦点侧（软键盘必依附焦点：kb/prov 任一在顶 + 活焦点不在文本框 + 静默 2.2s + vv 读数已稳 → 复原并按需置 #236 残留闩；缺它则 vv 读数滞留收缩值时四条复原路全断）', file: 'js/mobile-adapt.js', needle: 'if ((_aKb || _aProv) && !_aIsText(document.activeElement) && Date.now() - _aLastAct > 2200 && Date.now() - _aVvChgAt > 1200) {' },
  { name: '#267 安卓键盘探针导出实测平移（panSeen/panSeenAgo 进 __mochiAndroidKb；缺则「点开键盘没有输入框」类报障拿不到键盘高度证据，只能靠口述猜机型）', file: 'js/mobile-adapt.js', needle: 'panSeen: Math.round(_aPanSeen)' },
  { name: '#267 诊断算焦点框是否被键盘挡住（mochiVvDiag().focusCovered + 诊断行「焦点框被挡」；缺则遮挡类与空白类两种病在一份诊断里分不开）', file: 'js/device.js', needle: 'out.focusCovered = ar.bottom > (vv.offsetTop || 0) + vv.height + 2 ? 1 : 0;' },
  // ==== v3.32.x 多人决定「自定义选项」选项输入框高度上限（安卓转 ce-box 后 gd-opts 随内容无限增高）====
  // 根因：#chat-gdecision-body 的 gd-opts 漏了 #chat-decision-body dec-opts 同款「max-height + 框内滚动」，
  // 安卓 contenteditable .ce-box 随输入行数无限增高，把下方控件顶出屏且整列无法上划=「一直跳且拉不上去」。
  { name: '多人决定「自定义选项」gd-opts ce-box 限高+框内滚动（同帮我决定 dec-opts 修法；删掉=安卓选项框无限增高顶出控件；#295 收口时该行并成单行，needle 随代码形态同步）', file: 'css/chat-main.css', needle: '#chat-gdecision-body .dec-inp-wrap .ce-box[data-for="gd-opts"] { max-height:176px;' },
  // ==== v3.26.x #270 开屏问答门改为「固定 2 道题、不可被别人编辑」（原 v3.31.x 提供增删改题目入口）====
  // 根因：题目可被编辑=设密码/暗号的管理验证由「防顺手」退化为「可被持暗号者改动」，违背
  // 「开屏问答门是固定 2 个问题」的定案。移除增删改 UI/逻辑（qalist 面板、onQal、qaEditItem、
  // data-qal 按钮、正文的「编辑问答题」入口），qaList 恒返回 DEFAULT_QA、不再读任何已存储的自定义列表。
  { name: '#270 开屏问答门恒返回固定 2 题（qaList 去掉「先读已存自定义列表、有则用之」分支、直接 mapped DEFAULT_QA；回改=又读旧版本存的编辑列表=「固定 2 题」被已改过的历史数据顶替）', file: 'js/applock.js', needle: 'return DEFAULT_QA.map(function (it) { return { q: it.q, h: h53(String(it.a).trim()) }; });' },
  { name: '#270 开屏问答门无编辑入口（data-qal 增删改按钮整套移除；若 data-qal 出现在产物=编辑面板被重新引入、与「不可编辑」定案冲突）', file: 'js/applock.js', needle: 'data-qal', absent: true },
  // ==== v3.33.x #271 应用锁·设安全问答完成后面板滞留「点完成无反应」====
  // 根因：askQaSetup 答案屏的 onSubmit 只调 done(q,a)（save+toast）、不清遮罩，
  // 面板一直滞留在此屏，用户看不到已保存、以为点了完成没反应。
  { name: '#271 设安全问答完成即关闭面板（askQaSetup 答案屏 onSubmit 补「置空+隐藏遮罩」；删则完成后面板又滞留=「点完成无反应」回流）', file: 'js/applock.js', needle: 'if (done) done(q, a);' },
  // ==== 应用锁·刷新后锁被误关「门户大开」====
  // 根因：evalLock 里 `if (enabled() && !pinHash()) setEn(false)` 同步自愈——安卓「数据主要
  // 在 IndexedDB、localStorage 仅快照」下刷新首帧 applock-pin 常还没回填（LS 只有 en='1'），
  // 首帧就把锁置 0=锁被误关、门户大开（用户反馈「刷新后应用锁被关了，开关也变关」）。
  // 修复：改为 selfHealChecked 先异步查 IDB——IDB 有密码就回填本机并继续锁屏，只有双端都确认
  // 无密码才自愈关锁（防锁死初衷保留）。needle 用「IDB 有密码→回填→重评估锁屏」逻辑锚。
  { name: '应用锁自愈加固（IDB 有密码先回填不放关锁，防「刷新后锁被误关」回流；删则改回同步置 0=又门户大开）', file: 'js/applock.js', needle: 'gSet(K_PIN, v); evalLock();' },
  // ==== #280 机主逃生通道：忘密码且未设安全问题时可输暗号直接关闭应用锁 ====
  // 用户反馈「我只是要可以自己设置关闭锁屏」：原「无法重置/无法用问答重置」面板是死胡同
  // （提示只能清数据），机主忘密码又没设问答时自己关不掉锁。补 ownerDisableByCode 暗号逃生。
  { name: '#280 应用锁机主暗号逃生（未设安全问题忘密码时输暗号直接关锁；删则死胡同回流=机主自己关不掉锁）', file: 'js/applock.js', needle: '=== QA_SKIP_CODE) { setEn(false); sessMark();' },
  // ==== #277 iPhone17/Safari(WebKit26.6) standalone「底部白带+导航栏悬空」＝env 探针缓存中毒永不自愈 ====
  // 根因：syncVvFit 的 env(safe-area-inset-top) 探针缓存只在旋转时失效——独立应用切后台/
  // 回前台 WebKit 会改写顶部安全区形态，冷启动早帧探到 0 被永久缓存，稳定后实为覆盖形态
  // env=62：expBase 少算 env 段 → --mochi-ios-h 卡 894、.phone 底部 62px 白带/tabbar 悬空，
  // 且 1s 常驻自愈每次按同值「确认」坏态永不自愈（错误环 9/8~9/10 反复采集同一签名）。
  // 修复：矛盾信号（screen−inner≥20 而缓存=0 或与缺口差>8）节流 5s 重探；真已避让形态
  // 探回同值零行为变化。needle 是矛盾判定表达式本体，删/改条件即断。
  { name: '#277 env 缓存矛盾自愈（standalone 顶部缺段与缓存不符即 5s 节流重探，防「底部白带/tabbar 悬空」随切后台回流；删则 stale envTop=0 永久中毒）', file: 'js/mobile-adapt.js', needle: '(_envTopCache === 0 || Math.abs(_envTopCache - _diff0) > 8)' },
  // ==== #278 华为畅享70Pro/Chrome150 等多安卓机型「底部超出/导航栏被裁 diff≈-535」误报错误环 ====
  // screen.height 报数坏值（796 < 实际 inner 1331，物理不可能＝坏值）：旧式
  // min(screenH, envTop+innerH) 取到 796 → .phone 贴 inner 正常铺满被误判底部超出
  // 535px（自动采集刷错误环，多机型复发）。修复：min 钳制加 screenH≥innerH 门，
  // 坏值弃用回退 envTop+innerH；正常机型 min 语义不变零回归。needle 是门表达式
  // 本体（两个分支各一处），删/改条件即断。
  { name: '#278 坏 screenH 门（screenH<innerH 不作期望底边钳制，防「底部超出 diff=-535」误报环；删则坏值又钳到 796）', file: 'js/device.js', needle: 'Math.min((screenH >= innerH ? screenH : 0) || (envTop + innerH), envTop + innerH)' },
  // ==== 2026-09-10 #281 刷新黑屏卡顿收口②（华为畅享20Pro+Edge 等多机型）：my-emoji-groups 启动「就绪后再延迟取回」+ 防盲写闸门加固 ====
  // 根因：chat.js 脚本求值即 idbGet(17~35MB 级 my-emoji-groups)+主线程 JSON.parse 整包，
  // 秒级长任务压在开屏/首屏渲染关键窗口（#250 切桌面已同口径治理，启动路径漏了）。
  // 延迟到 mochi-restore-done 后 4s；面板打开本就现读权威（#172 主链）；保存闸门同步扩为
  // 「未应用过权威值(__myeIdbApplied) 或 仍在挂起名单」防延迟窗口盲写覆盖 IDB 全量。
  { name: '#281 my-emoji 启动取回延迟（mochi-restore-done 后 4s 才整包读+解析；改回脚本求值即取回=大库机刷新首屏再吃秒级长任务）', file: 'js/chat.js', needle: "document.addEventListener('mochi-restore-done', function () { setTimeout(tryRestore, 4000); });" },
  // ==== #282 荣耀90GT+Edge150 等多机型「[屏幕适配] 底部少填 277px」键盘停靠误报错误环 ====
  // resizes-visual 下键盘只缩可视视口（vv 633→356）、inner 不动，.phone 按设计停靠
  // 到 356；诊断 ④/⑤b 只对照 inner 期望底 → 输入框一失焦自动采集即误报「少填/悬空」。
  // 修复：④/⑤b 加深收缩豁免——vv 缩幅 ≥ inner×22%（#236 已验证键盘下限，真键盘缩幅
  // 均 >200px）判键盘停靠期不判底；#236 壳残留带（<22%）仍照常上报，真残留不掩盖。
  { name: '#282 键盘停靠豁免（vv 缩幅≥inner×22% 时 ④/⑤b 不判底，防「底部少填」误报环；删则 resizes-visual 停靠期每失焦即刷错误环）', file: 'js/device.js', needle: '_kbShrink >= Math.round(inp.innerH * 0.22)' },
  { name: '#281 防盲写闸门扩口径（未应用过 IDB 权威值也禁盲写，防延迟窗口保存把空/小包顶掉 IDB 全量=我的表情包全丢复发）', file: 'js/chat.js', needle: 'window.__myeIdbApplied !== true' },
  // ==== 2026-09-10 #275 媒体池×备份链路腐蚀（多机型反复「图片丢失/@@m:404」传播链收口）====
  // 根因：「只备份文字」strip 导出只剥 data: 前缀载荷——消息里的 @@m: 令牌不匹配被原样保留，
  // 媒体池键值却被剥成空串。导入后池里全是空串影子条目：渲染端 typeof 放行 → map 缓存 '' +
  // img.src=''（解析成页面 URL）＝永久坏图+占位误报「网络不通」；且空串条目 ≤20KB 走小键段，
  // 随今后每次完整备份继续传给对方设备＝跨机型反复。池真缺失时令牌 src 被当相对路径打网络
  // 必 404，还把「资源加载失败」错误环刷满（OPPO Reno16 诊断 20 条错误全是它）。
  // 修复四道：①文字模式导出整键跳过池条目（读值前 skip）②导出小键段同样认范围外键
  // ③导入端把空串/非 data: 脏池条目丢弃（键保持缺席→准确占位；合法池值不动）
  // ④渲染端池值体检（空串/脏值绝不入 map、绝不改写 src；不入负缓存＝日后导入完整备份自愈）
  // ⑤device.js 错误记录器对未解析令牌 404 静默（getAttribute 原始值判令牌）。
  { name: '#275 文字模式媒体池整键跳过（skip 在读值前生效，strip 绝不剥值留键=空池坏图传播）', file: 'js/data-backup.js', needle: 'MUSIC_KEY_RE.test(k) || MEDIA_POOL_KEY_RE.test(k)' },
  { name: '#275 导出小键段同样认范围外键（≤20KB 池条目不进 ls 段防被 strip 成空串入库）', file: 'js/data-backup.js', needle: 'if (cfg.skip(k)) continue;' },
  { name: '#275 导入端旧备份池腐蚀自愈（空串/非 data: 池条目直接丢弃=键保持缺席走准确占位，完整备份再导入即自愈）', file: 'js/data-backup.js', needle: 'function scrubMediaPool(obj) {' },
  { name: '#275 渲染端池值体检（空串/脏值绝不入 map 缓存也不改写 img.src——原 typeof 放行空串=map 缓存\'\'+src=\'\'永久坏图；不入负缓存，缺数据可重试）', file: 'js/media-pool.js', needle: "v2.indexOf('data:image/') !== 0" },
  { name: '#275 未解析媒体池令牌 404 不进错误日志（getAttribute 原始值判令牌；池缺失+渲染占位已是预期失败路径，逐次渲染刷屏掩盖真错误）', file: 'js/device.js', needle: 'window.mochiMediaIsToken(imTok)' },
  // ==== 2026-09-10 #283 聊天语音令牌化（vivo S60/Chrome 25fps「经常卡、按不动」等多机型收口）====
  // 根因：#142 池 v1 只收 data:image/——历史语音/语音字卡以「名称|||data:audio;base64…」整份
  // 内联在消息 text（语音内容唯一，去重对总库无效，但令牌化后每次落盘只 clone 44 字符引用）。
  // 本机诊断：IDB chat-msgs=79.2MB/2277 条、JS 堆 307MB、长任务 50~405ms（隐藏冲刷+空闲落盘
  // 每次都 structured clone 整包）＝发消息/收键盘/离页回前台全在卡。音频纪律：不进 map 热缓存、
  // 播放走 ExpandAsync 按需 idbGet、迁移期每 32 条分批冲池（writeBuf/单事务封顶+回滚账除名）。
  { name: '#283 池收音频（tokenize 放行 data:audio/；回退只收图片=语音继续整份内联、低端机落盘长任务复发）', file: 'js/media-pool.js', needle: "dataUrl.indexOf('data:image/') !== 0 && dataUrl.indexOf('data:audio/') !== 0" },
  { name: '#283 语音令牌化（normalize pass 处理「名称|||data:audio/」内联语音；删则 chat-msgs 几十 MB 每次落盘 clone 整包回归）', file: 'js/chat.js', needle: "m.text.indexOf('data:audio/', _bar + 3) === _bar + 3" },
  { name: '#283 语音播放异步取回（令牌先 ExpandAsync 取池数据再播；删则令牌语音点按「播放失败」）', file: 'js/chat.js', needle: 'window.mochiMediaExpandAsync(v.src, function (data) {' },
  { name: '#283 迁移期分批冲池（每 32 条 flush 封顶 writeBuf/单事务并清回滚账；删则几十 MB 单事务+回滚账常驻=迁移会话堆尖峰）', file: 'js/chat.js', needle: 'const _okMid = await window.mochiMediaFlush();' },
  { name: '#283 冷启动收敛触发（读库成功后 12s 跑 pass；删则只依赖 restore 事件/切桌面——不切桌面的设备历史语音永不被收口）', file: 'js/chat.js', needle: 'scheduleMediaPass(12000)' },
  { name: '#283 收藏语音识别加令牌形态（名称|||@@m:hash 不识别则收藏语音直出令牌串且不可播）', file: 'js/chat.js', needle: '@@m:[0-9a-f]{32}$/.test(f.text)' },
  // ==== #284 vivo X200s+Edge150「BodyStreamBuffer was aborted」×10/×11 刷错误环：cancel() 拒绝安全 ====
  { name: '#284 cancel() 拒绝安全（mochiSafeCancelBody 挂空 catch；删则弱网 abort 时 BodyStreamBuffer 拒绝继续裸奔刷错误环）', file: 'js/music-player.js', needle: "if (p && typeof p.catch === 'function') p.catch(function () {});" },
  // ==== 2026-09-11 #287 群聊点头像拍一拍（用户报「群聊里无法点击联系人头像拍一拍」＝单聊有、群聊从未实现）====
  { name: '#287 成员消息头像点击开拍一拍面板（renderMsg 头像绑定；删/改绑定则点头像无反应回退功能缺口）', file: 'js/group-chat.js', needle: 'gcOpenPokeCard(rec.cid)' },
  // ==== 2026-09-11 #288 群聊美化视图卡片化重设计（用户报「美化设置不完整、和聊天里的不一样」＝纯文字行 vs 聊天设置图标卡片页）====
  { name: '#288 美化视图 set-row 图标行构建（set-row+gc-set-row 双类；回退纯文字 beautyRow 行则该锚点消失）', file: 'js/group-chat.js', needle: "'set-row gc-set-row'" },
  // ==== 2026-09-11 #289 摸鱼打卡刷新后要求重打（按钮状态只在回填完成前读一次，LS 写失败/IDB 为主机型每次刷新都显示未打卡）====
  { name: '#289 打卡按钮状态随回填完成/写日志自愈事件重同步（删监听则 LS 缺失机型刷新后永远显示未打卡、需重打）', file: 'js/personalize.js', needle: "document.addEventListener('mochi-restore-done', function () { try { syncCheckinBtn(); updateFishDays(); } catch (e) {} });" },
  { name: '#290 摸鱼天数回填后再合并+规范化自愈（删监听则各桌面旧副本迟到永远漏算、重复/脏值虚高不修）', file: 'js/personalize.js', needle: "document.addEventListener('mochi-restore-done', fishLogHeal);" },
  // ==== 2026-09-11 #291 经期桌面卡文字重叠（OPPO Reno6+雨见/Firefox152：160px 卡内 dpd-inner 绝对居中无底部预留，Gecko 默认行高更高，dpd-sub 与绝对定位 dpd-bar-cap 几何重叠；Chrome 擦边幸免故仅部分浏览器现形）====
  { name: '#291 经期卡防重叠·dpd-inner 底部预留 26px（删则 Gecko 行高下副标题与进度条说明叠字复发）', file: 'css/home.css', needle: 'padding-bottom:26px' },
  // ==== 2026-09-11 #292 问问ta批量导入单选题（【】为问题、其后每行一个选项）+ 问卷答题结束时间（过点不发新问、不能再作答）====
  { name: '#292 批量导入单选题解析·【问题】+选项行（删则退回一行一题、单选格式整行丢失）', file: 'js/ta-ask.js', needle: "if (cur.opts.length >= 2) { q.type = 'single'; q.options = cur.opts.slice(); singles++; }" },
  { name: '#292 问卷答题结束时间·作答统一闸门（chatAskReply 包装层删拦截则过点后仍可作答）', file: 'js/ta-ask.js', needle: "if (askDeadlinePassed(taAskLoad())) { toast('已过问卷答题结束时间，不能再作答'); return undefined; }" },
  // ==== 2026-09-11 #293 后台来电挂起回前台不响铃（resumeHeldCall 原要求 h.cid===当前桌面——跨桌面来电/冷启动 cid 未校正时判不成立，静默补未接＝点开通知永远接不到）====
  { name: '#293 跨桌面挂起重响·先切归属联系人桌面再响铃（删切换分支则回到非归属桌面永远直接判未接）', file: 'js/call.js', needle: "known = window.getContacts().some(c => c && c.id === h.cid);" },
  // ==== 2026-09-11 #294 后台通知右侧头像全黑（makeAvatarThumb canvas 直接导出 JPEG——JPEG 无透明通道，带透明区域头像的透明像素落成黑块）====
  { name: '#294 头像缩略 canvas 先铺白底再绘制（删 fillRect 则透明头像缩略图透明区变黑＝通知全黑方块复发）', file: 'js/bg-keep.js', needle: "ctx.fillStyle = '#ffffff';" },
  // ==== 2026-09-11 #295 帮我决定/群聊决定自定义选项·键盘弹出期整卡无法上滑（ce-box 的 overscroll-behavior:contain 连「框内无内容可滚」的滚动链也拦断，手指在聚焦的选项框上起滑时外层 .poke-card-scroll 收不到手势；contain→auto：框内溢出仍框内滚，边界放行给面板）====
  { name: '#295 决定面板 dec-opts 选项框滚动链放行·contain→auto（改回 contain 则键盘期手指在选项框上滑动整卡无法上滑复发）', file: 'css/chat-main.css', needle: 'data-for="dec-opts"] { max-height:176px; overflow-y:auto; overscroll-behavior:auto; }' },
  { name: '#295 决定面板 gd-opts 选项框滚动链放行·contain→auto（改回 contain 则键盘期手指在选项框上滑动整卡无法上滑复发）', file: 'css/chat-main.css', needle: 'data-for="gd-opts"] { max-height:176px; overflow-y:auto; overscroll-behavior:auto; }' },
  // ==== 2026-09-11 #296 回复设置补「联系人主动写信/主动发朋友圈」总开关（写信概率 prob() 把 0 兜底回默认 30＝无法用概率关闭；开关裸读 + 触发链首行闸门）====
  { name: '#296 联系人主动写信总开关闸门·mailCfg 裸读 writeEn + maybeIncomingLetterFor 拦截（删则关开关后 TA 仍按概率来信）', file: 'js/mail.js', needle: 'if (!cfg.writeEn) return;' },
  { name: '#296 联系人主动发朋友圈总开关闸门·feedCfgFor postEn + maybeAutoPostFor 拦截（删则关开关后 TA 仍按概率发动态）', file: 'js/feed.js', needle: 'if (!cfg.postEn) return;' },
  // ==== 2026-09-11 #298 词典拼字（语录抽句+词典切词逐词连发；数据=DEFAULT_CARD_DATA.dict「词典」分类，设置=回复设置「词典拼字」组）====
  { name: '#298 词典拼字抽句门·qs-en/qs-prob/qs-cc 三键生效（删则开关概率失效，拼字永不触发）', file: 'js/quote-spell.js', needle: "if (!c || c['qs-en'] !== 1) return null;" },
  { name: '#298 词典拼字接线·replyOnce 抽句门+逐词连发（删则开关存在但永不生效）', file: 'js/chat.js', needle: '(window.quoteSpellPick && window.quoteSpellPick(c))' },
  // ==== 2026-09-11 #310 词典拼字单气泡形态 + 普通字卡截断修复（qs-one 50% 混合单气泡/逐词；qs-cc 默认关防普通字卡被抽去拼字）====
  { name: '#310 单气泡拼字形态·chat.js 空格连卡+「词典拼字」tag（删则 qs-one 开了也只有逐词连发、无单气泡形态）', file: 'js/chat.js', needle: "if (rep.spell && rep.spellOne) {\nm = addIn(rep.spell.join(' '), {" },
  // #323 双形态选择哨兵已被 #370 收编（50/50 掷币改为 80/20 单气泡为主，见下方 #370 两条）
  { name: '#330 逐卡连发受回复条数最多上限·完整字卡连发≤reply-max（删则完整字卡一次刷 5 条＝超出联系人回复条数设置）', file: 'js/quote-spell.js', needle: 'if (want > rmax) want = rmax;' },
  { name: '#351a 逐卡连发不受条数限制·qs-noLimit 默认开（删则逐卡被 reply-max 收口＝默认玩法被限流；仅显式 0 才收口）', file: 'js/quote-spell.js', needle: "if (!one && c['qs-noLimit'] === 0) {" },
  { name: '#351b 撤回补发总开关·rc-en 闸门（删则关开关后撤回仍补发＝开关失效）', file: 'js/chat.js', needle: "if (c['rc-en'] !== 0 && hit(c['rc-refix'])) {" },
  // #310 旧默认 1→0 迁移已被 #388 反向取代（qs-cc 默认改回 1、存量迁移 0→1 标记升 2，见下方 #388 两条）——哨兵锚点同步更新
  { name: '#388 qs-cc 存量反向迁移写值 0→1（删则被 #310 迁移成 0 的桌面回不到默认开＝用户点名需求回退）', file: 'js/reply-settings.js', needle: "s.set('reply-qs-cc', '1'); changed = true; }" },
  { name: '#350 逐卡连发每条气泡挂「词典逐卡连发」tag（删则逐卡与单气泡 tag 不可区分＝用户点名的新 tag 丢失；2026-09-16 换锚：原 needle 捎带的 silent 行被撤回概率 willRetractR 合法演进，锚收到现存 tag 行）', file: 'js/chat.js', needle: "tag: '词典逐卡连发'," },
  // ==== 2026-09-11 #317 梦角自由造句（梦角语料抽卡→截断几字重造句→入库自定义字卡「梦角自由造句」分类）====
  { name: '#317 梦角自由造句抽句门·mjf-en/mjf-prob 生效（删则开关概率失效，梦角永不造句）', file: 'js/dream-free.js', needle: "if (!c || c['mjf-en'] !== 1) return null;" },
  { name: '#327 撤回式截断·词间隙切尾前缀成新句（删则造句变回随机截补＝句子离奇，用户明确否决）', file: 'js/dream-free.js', needle: "const out = toks.slice(0, gi).join('').replace(/[，、,\\s]+$/, '');" },
  { name: '#329/#414 造句手法三选一·mjf-style 语气词式/撤回式/换字卡内容式（删则手法选择失效＝三模式不可切，回退固定撤回式；#414 改 let 供混合模式重掷）', file: 'js/dream-free.js', needle: "let style = Math.max(0, Math.min(2, Number(c['mjf-style']) || 1));" },
  { name: '#326 词边界来源·内置词典正向最大匹配切词（删则插入点随机＝可能截在词中间出病句）', file: 'js/dream-free.js', needle: 'if (dict.has(str.slice(i, i + L))) { len = L; break; }' },
  { name: '#317/324 造句入库·ccAppendCards 双作用域写 mjfree 分类（删则新句不进「梦角自由造句」字卡分类；#324 加 scope 分库参数）', file: 'js/chatcard.js', needle: "window.ccAppendCards = function (type, group, cards, scope) {" },
  { name: '#324/#364 造句分库·dreamFreeSave 按 mjf-pub 概率分库、单联系人 100% 专属（删则全部写专属＝多桌面公用库不再积累梦角语料）', file: 'js/dream-free.js', needle: "const usePublic = cids > 1 && Math.random() * 100 < pubProb;" },
  { name: '#317 replyOnce 接线·dreamFreePick 命中替换回复+入库（删则开关存在但永不生效）', file: 'js/chat.js', needle: 'window.dreamFreePick && window.dreamFreePick(c)' },
  { name: '#301 词典自建词条并入词典分类（删则自建语录/词不再进词典 tab 与拼字引擎）', file: 'js/default-cards.js', needle: "const gw = base.find(g => g[0].indexOf('词库') === 0)" },
  // ==== 2026-09-11 #306 小游戏 UI 收口（连连看/消消乐棋盘 gap 溢出截断、头部标题被挤竖排、拍卖会「不拍了」白字白底隐形）+ 全部小游戏通用全屏 .game-fs ====
  { name: '#306 连连看 fitBoard 扣除 grid gap 再取整（删则牌面总宽多出 (cols-1)*3px 溢出右缘、最右列被截断）', file: 'js/linkup.js', needle: 'Math.floor((w - (st.cols - 1) * GAP) / st.cols)' },
  // ==== 2026-09-15 #487/#488 连连看（用户报「TA 回合连上了却弹『没连上』」「10×6 全屏不放大反而图案显小」；原编 #482/#483 撞号改）====
  { name: '#487 连连看 TA wild 点错：台词只指本次尝试、隔 700ms 经 thinkT 才落子（删则台词与成功连线同帧＝「连上了却弹连不上」回流）', file: 'js/linkup.js', needle: 'if (s !== st || st.over || st.lock || st.turn !== 2) return;' },
  { name: '#488 连连看全屏放大：.game-fs 时高度参与取格、上限 46→72（删则全屏只按宽度压小牌面、纵向空间浪费；needle 因 #489 下限改 floor24 同批同步）', file: 'js/linkup.js', needle: 'Math.max(floor24, Math.min(72, byW' },
  { name: '#488 连连看真全屏 stage 吃满高度（删则全屏棋盘贴顶、下方大片留白退回）', file: 'css/chat-pages.css', needle: '#chat-linkup-panel.game-fs .lk-stage { flex:1; min-height:0; }' },
  // ==== 2026-09-15 #489 连连看 新增王者 12×7 / 传奇 12×8（主题扩 24 款；12 列窄屏按实宽收格防溢出）====
  { name: '#489 连连看 王者/传奇 大棋盘档位（删则难度下拉回退三档、84/96 张局消失）', file: 'js/linkup.js', needle: "legend: { rows: 8, cols: 12, kinds: 24, pairPerKind: 2, label: '🏆 传奇 12×8', coin: 33440 }" },
  { name: '#489 连连看 12 列以上窄屏按实宽收格（删则半框 24px 下限把总宽顶溢出右缘）', file: 'js/linkup.js', needle: 'const floor24 = Math.min(24, byW);' },
  { name: '#306 消消乐 fitBoard 扣除 grid gap 再取整（同连连看，删则第 8 列被裁）', file: 'js/match3.js', needle: 'Math.floor((w - (N - 1) * GAP) / N)' },
  // ==== 2026-09-12 #340 消消乐动画（用户报「没有真消消乐动画很突兀」）：棋子层+transform 合成器过渡，交换滑动/消除爆开/按距离下落 ====
  { name: '#340 消消乐消除爆开动画 keyframes（删则消除无爆开、退回瞬间消失）', file: 'css/chat-pages.css', needle: '@keyframes m3-popout' },
  { name: '#340 消消乐结算动画循环按距离等待（删则下落不等待、整盘退回瞬跳重绘）', file: 'js/match3.js', needle: 'animMs(FALL_MS)' },
  { name: '#306 半框头部标题禁止压缩换行（删则控件多的面板标题被挤成一字一行竖排）', file: 'css/chat-main.css', needle: '.poke-card-head > span { white-space:nowrap; }' },
  { name: '#306 拍卖会「不拍了」举牌行内可见样式（删则半透明白底+白字在白卡上完全隐形＝按钮像消失）', file: 'css/chat-pages.css', needle: '.au-bids .pong-overlay-btn2 { background:rgba(0,0,0,.07); color:var(--ink,#222); }' },
  { name: '#306 小游戏共享全屏容器 .game-fs（fixed 满视口 + iOS 高度修复同款表达式，删则全屏按钮失效）', file: 'css/chat-pages.css', needle: 'height:100vh; height:min(var(--mochi-ios-h, 100dvh), 100dvh);' },
  { name: '#306 全屏切换接线·面板 toggle game-fs + 图标 ⛶/⤢（gomoku 代表登记，删则按钮点了没反应）', file: 'js/gomoku.js', needle: "panel.classList.toggle('game-fs', isFs)" },
  // ==== 2026-09-11 #309 连连看/消消乐未开局舞台最小高度（空棋盘 stage 高 0 → 「开始对局」覆盖层压成一条横线＝用户报「面板只有一条横线、打不开」）====
  { name: '#309 连连看未开局舞台 min-height（删则空棋盘高度 0，开始覆盖层压成横线、面板无法正常开局；消消乐同行同款）', file: 'css/chat-pages.css', needle: '.lk-stage { position:relative; width:100%; min-height:190px;' },
  // ==== 2026-09-11 #314 收藏批量管理多选失效（getFav() 每次 JSON.parse 生成全新对象，favBatchSel 存对象引用 → 任何 renderFav 重渲染（点全选/切分类/切页签）后引用全部失配，勾选静默清零＝多选/全选形同虚设；全机型通用）====
  { name: '#314 收藏批量勾选身份=favItemKey 指纹（删则退回对象引用勾选，重渲染后勾选清零、多选失效；行为断言 tools/verify-fav-batch.mjs）', file: 'js/chat.js', needle: 'const visKeys = new Set(list2.map(favItemKey));' },
  // ==== 2026-09-11 #308 游乐室半框 × 关不掉（arcade.js 取了 #arc-close 却从未绑 click，任何机型都关不掉）====
  { name: '#308 游乐室 × 点击关闭接线（删则 #arc-close 成摆设、半框关不掉，行为断言 tools/verify-arcade-close.mjs）', file: 'js/arcade.js', needle: "closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });" },
  // ==== 2026-09-15 #535 主页「游乐室」入口占满 tab 记录区首屏（用户报「位置不应该放在影响查看其他 tag 的地方」）——由 data-hpanel="*" 卡移入标题栏常驻按钮 ====
  { name: '#535 主页游乐室入口在标题栏（删/移回 cal-scroll 则又常驻遮挡各 tab 记录首屏）', file: 'template.html', needle: '<button class="arc-home-entry" id="home-arcade-entry" type="button">' },
  // ==== 2026-09-11 #301 手机端整页 UI 错乱收口（红包注释漏 `-->` 吞标签 → .phone 提前闭合 → tabbar 落 body 层被 flex 居中挤出屏）====
  { name: '#301 红包注释正确闭合（删则注释吞掉「红包」标题+set-group 开标签，后续 </div> 连锁提前闭合设置页与 .phone 手机壳＝整页 UI 错乱、底部导航出屏）', file: 'template.html', needle: 'chat.js trySystemAutoSend 读 cs-rp-auto-prob / cs-rp-daily-max -->' },
  // ==== 2026-09-11 #313 心意集市「TA 送我礼物」总开关（默认关=禁止联系人送礼物；关闭时心愿单兑现 ① 与随机送礼 ④ 都不触发，TA 自己买 ②/加心愿 ③ 不受限）====
  // #539 起默认值反转为「开」——本锚守的是「总开关参与 ① 的与门」，不是默认值（默认值锚见下）
  { name: '#313 gift-shop TA送我礼物总开关（删则禁送失效、TA 恢复买我心愿单礼物；giftInOn 仍参与 ① 判定。v3.27.x #585：额度变量由共用 capped 拆成 giftCapped，锚随代码形态同步）', file: 'js/gift-shop.js', needle: 'st.wlOn && st.giftInOn && !giftCapped' },
  // ==== 2026-09-15 #539 心意集市「TA 送我礼物」默认开启 + 随机送礼概率可调（旧实现默认关且概率写死 5%，设置页缺这一项）====
  { name: '#539 giftInOn 默认开启（未设置过的用户落到 1；显式关过=0 的用户保持关闭；删则退回「默认禁止 TA 送礼物」）', file: 'js/gift-shop.js', needle: 's.giftInOn === 0 ? 0 : 1' },
  { name: '#539 随机送礼概率读设置 giftInPct（删/改回硬编码 0.05 则设置页「TA 送我礼物概率」失效，回到无处可调）', file: 'js/gift-shop.js', needle: 'Math.random() * 100 >= st.giftInPct' },
  { name: '#539 设置页「TA 送我礼物概率」输入行在位（删则概率项从设置消失，用户无法自定义）', file: 'js/gift-shop.js', needle: 'data-gsn="giftInPct"' },
  // ==== 2026-09-15 #540 心意市集/心意柜跨桌面串名（页面静态文案写死构建时 partnerName，切联系人后残留上一个桌面的名字）====
  { name: '#540 syncGiftNames 定义（按当前桌面重写心意柜/送礼面板里写死过名字的静态文案）', file: 'js/gift-shop.js', needle: 'function syncGiftNames()' },
  { name: '#540 切联系人重渲心意柜页（删则页面开着时切换联系人，列表与名字都停在上一个桌面）', file: 'js/gift-shop.js', needle: 'if (giftboxPage && !giftboxPage.hidden) renderBox();' },
  // ==== 2026-09-11 #315 开屏免责声明置顶卡（未成年人禁止使用 + 字卡均为随机代码、使用后果自负；静态 DOM data-anti-scam="d"，在线 notice.json 覆盖不改此处）====
  { name: '#315 开屏免责声明卡在位（删则开屏不再展示「未成年人禁止使用/字卡随机代码后果自负」声明）', file: 'template.html', needle: 'data-anti-scam="d"' },
  // ==== 2026-09-14 #315c 免责声明细化+年龄确认闸门（四条细化文案+18周岁红线+心理援助热线；勾选 xy-home-v2:age-confirmed 后才可进入，clock.js 门控）====
  { name: '#315c 免责细化文案在位（删则退回旧一句话免责：虚构娱乐边界/热线/数据自担全丢）', file: 'template.html', needle: '预先编写的随机代码随机触发' },
  { name: '#315c 年龄确认勾选框·静态锚点（删则开屏无勾选行=免责举证降级为默认已读）', file: 'template.html', needle: 'id="splash-age-check"' },
  { name: '#315c 年龄确认·clock.js 门控（删 ageOk 判定则未勾选也能进入=闸门失效）', file: 'js/clock.js', needle: "const ok = r && scrolledBottom && ageOk;" },
  // ==== 2026-09-11 #316 聊天记录滚动跳动/闪烁（#199 overflow-anchor:none 连带关掉 Chromium 原生锚定：浏览图片较多历史时上方图片解码撑高无人补偿=内容被推走；解钉动态开回锚定、钉住态维持 none 防 #199 对打）====
  { name: '#316 解钉开滚动锚定·接线（删则用户手动滚动后锚定仍关、图片撑高继续推走视口=聊天记录一直跳；行为断言 tools/verify-chat-anchor.mjs）', file: 'js/chat.js', needle: 'function unpinChatAndAnchor() {' },
  { name: '#316 解钉开滚动锚定·CSS 开关（删则类挂了也不生效，Chromium 锚定回不来；钉住态 #199 none 语义不变）', file: 'css/base.css', needle: '.chat-body.scroll-anchor-auto { overflow-anchor: auto; }' },
  // ==== 2026-09-11 #319 防未成年人·系统内置字卡二级验证锁（默认全锁：回复池/字卡库/词典拼字/功能同源池取不到任何系统预设字卡，自建字卡不受影响；开屏输密码解锁，源码只存散列不存明文）====
  { name: '#319 内置字卡锁·闸门本体（card-lock.js，删则锁定失效全部预设字卡裸奔＝防未成年保护丢失）', file: 'js/card-lock.js', needle: 'window.cardLockOpen = isOpen' },
  { name: '#319 内置字卡锁·分组总闸（getDefaultCardGroups 锁定返回空，删则字卡库/词典拼字仍能取到系统预设字卡）', file: 'js/default-cards.js', needle: "if (LOCKED()) return []; // #319 锁定＝系统预设字卡不存在" },
  { name: '#319 内置字卡锁·聊天回复池闸（getPool 系统预设分支锁定不入池，删则聊天仍抽预设字卡）', file: 'js/chat.js', needle: 'const sysLocked = !(window.cardLockOpen && window.cardLockOpen());' },
  { name: '#317 开屏解锁卡接线（clock.js setupCardLockCard，删则开屏无解锁入口＝锁死无法使用）', file: 'js/clock.js', needle: 'function setupCardLockCard() {' },
  // ==== 2026-09-11 #320 全屏游戏面板抬层（.game-fs 在 .page(z-index:2) 上下文内，z-9999 被压到 2 永远低于全局顶部提醒条 998 → 连连看/消消乐全屏时头部难度下拉被提醒条盖住点不到、选不了难度的根因）====
  { name: '#320 全屏期间给 .phone 挂 game-fs-active（全屏面板所在 page 抬到 1000，删则提醒条继续盖住全屏头部难度下拉=全屏选不了难度），配套 CSS：css/chat-pages.css .phone.game-fs-active .page{z-index:1000}', file: 'js/fullscreen.js', needle: "_gfsPhone.classList.toggle('game-fs-active', gameFsHasActive())" },
  // ==== 2026-09-11 #331 拍卖会「按钮没用+页面卡死」（#321 全屏教学浮层 #au-intro/#au-help 用 ID 选择器写 display:flex，特异性压过 UA 的 [hidden] 和 .pong-overlay[hidden] 救援 → hidden 属性失效，不透明黑罩永远盖屏拦掉全站点击；全机型必现，与浏览器无关）====
  { name: '#331 拍卖全屏浮层 hidden 救援（删则开场/玩法浮层永远盖屏＝拍卖会及全站按钮点不到像卡死；行为断言 tools/verify-auction-overlay.mjs）', file: 'css/chat-pages.css', needle: '#au-intro[hidden], #au-help[hidden] { display:none; }' },
  // ==== 2026-09-11 #335 问问TA文字题回应接聊天字卡/词典：开关（ta-ask settings.useChatReply，默认关）开启后，文字题回答按普通聊天同源顺序生成回应——① getDefaultCards('chat') 整体概率抽默认聊天字卡 ② quoteSpellPick 拼字概率抽词典语录（问答卡只回一条，固定单气泡空格连卡） ③ 都未命中走原「询问·回应」预设池 90/10 混合；回应经 chatAskReply 新增 opts.raw 直传，跳过 pickAskCardReply 再混合 ====
  { name: '#335 文字题聊天链路回应·开关门（settings.useChatReply，删则开关失效＝永远走预设池）', file: 'js/ta-ask.js', needle: 'if (!(d.settings && d.settings.useChatReply)) return null;' },
  { name: '#335 文字题聊天链路回应·raw 直传（删则 pickAskCardReply 90/10 混合把词典/默认字卡回应换掉＝开关开了也不生效）', file: 'js/chat.js', needle: 'if (opts && opts.raw && preset) {' },
  // ==== 2026-09-11 #334 搜索/引用跳转被回底机制抵消（OPPO Reno14 Edge 报「旧的聊天记录依旧无法跳转」复发，#268 下界扩窗治不了这类）：jumpToMsg 是程序化滚动从不解钉，chatPinnedBottom 恒真＝跳到旧区后 lazy 图 onload 触发 #162 图片补滚 rAF(scrollChatBottom) 把视图拽回底部（无头红绿实证：hasHl:true+atBottom:true+visible:false，与真机「点了没反应」一致）＋show/hideTyping 无条件回底同类抢滚动权。修复：①跳转成功即 unpinChatAndAnchor()（与手动上翻同权开回滚动锚定）②typing 复写守钉 ③搜索点击先收键盘双 rAF 后起跳。行为断言 tools/verify-chat-pgjump.mjs 症状4 ====
  { name: '#334 跳转解钉（删则钉住态下跳到旧区被 #162 图片 onload 补滚拽回底部＝搜索/引用跳转「点了没反应」）', file: 'js/chat.js', needle: 'unpinChatAndAnchor(); // FIX 2026-09-11 #334' },
  { name: '#334 showTyping 零滚动守钉（#514 加强：只切可见性、一个 scrollTop 都不写＝用户读历史时「对方正在输入」既不拽回底部也不改变钉住标记；旧形态 60ms 复写已随 #514 移除）', file: 'js/chat.js', needle: 'typingEl.hidden = false; // FIX 2026-09-15 #514 只切可见性' },
  { name: '#334 hideTyping 复写守钉（删则回复落地收打字态时把已跳到旧区的视图拽回底部）', file: 'js/chat.js', needle: 'if (chatPinnedBottom) scrollChatBottom(); // FIX 2026-09-11 #334 解钉态不抢滚动权' },
  // ==== 2026-09-15 #514 联系人连发多条消息时聊天记录「一直闪、一直回弹」（红米 K80 Chrome 等多机型，用户明说其他机型也有）：#chat-typing 是 #chat-body 的兄弟节点（#page-chat 的 flex 行），显示它只吃 chat-body 的 clientHeight——可滚最大（scrollHeight−clientHeight）反被抬高 22px、scrollHeight 不动。旧 showTyping 在钉住态写 scrollTop=scrollHeight，钳位目标＝「行显示中」那份最大值；行一隐藏（hideTyping 紧随其后就是消息落地）最大值回落 22px、内核把 scrollTop 钳掉 22px＝内容当场下弹 22px，新消息又平滑滚回底部 → 每来回「上跳 22px + 下弹 22px」，TA 连发＝一直闪一直回弹。修复：显示/隐藏一律不写 scrollTop（打字行 22px ≤ .chat-body padding-bottom:24px 的空白呼吸区，占位期间最后一条消息照旧完整可见）＝零钳位、零位移、零机型分支。行为断言 tools/verify-chat-multi-scroll.mjs ====
  { name: '#514 进页打字行零滚动（删则进页时打字行把 scrollTop 顶到行显示态最大值，TA 回复落地即被钳回＝进页回弹一拍）', file: 'js/chat.js', needle: 'typingEl.hidden = false; // FIX 2026-09-15 #514 进页同款' },
  { name: '#514 「连发多条」真实链路测试钩子（删则 verify-chat-multi-scroll.mjs 无法驱动产品函数，只能复刻实现＝测不到真身）', file: 'js/chat.js', needle: 'window.chatAddInTyped = function' },
  // ==== 2026-09-11 #337 安卓键盘盖输入栏（荣耀畅玩80Pro 自带浏览器，多机型同族）：键盘弹出时 vv 读数漂移/不缩 → 读数判据 _aProvCheck 永不命中 + 58% 盲猜对高占比输入法停靠不足。三件套：①可见性触发停靠（聚焦>900ms+手势武装+实测元素底边低于可视区底边=被盖才动作，与内核读数无关）②VirtualKeyboard 实测尺（overlaysContent=true+geometrychange 按 base−kbH 精停，特性探测，_aProvClear 归还）③欠深自纠（停靠后仍被盖每 250ms 再收 8% 基准至露出/34% 地板）。行为断言 tools/verify-kb-cover-dock.mjs ====
  { name: '#337 键盘可见性触发停靠（删则读数漂移内核输入栏整行留在键盘下=畅玩80Pro 族无法聊天）', file: 'js/mobile-adapt.js', needle: '_kbCovered = !!(_rC && _rC.height > 0 && _aCoverBottom(tgt) > _visBottomC + 12);' },
  // ==== 2026-09-13 #387 点聊天输入栏 UI 乱+闪屏（桌面浏览器 DevTools 移动模拟实测复现，多机型同族）：安卓/iOS 键盘保底停靠的读数判据（|vv−基线|≤2 且 |inner−基线|≤2）只证「视口没动」不证「键盘在场」——无软键盘环境（电脑浏览器/移动模拟/外接键盘）视口永远不动，点输入栏即盲推 58% 停靠＝输入栏顶到屏中下方大空白（UI 乱），自愈清除后反复点击又缩回（闪屏）。修复：安卓 _aProvCheck 与 iOS _iProvCheck 两处盲推分支统一加「实测被盖」闸（#337 同一把尺：聚焦元素∪输入行底边低于可视区底边+12px 才停靠）——悬浮键盘真场景键盘必然盖住输入栏照常停靠零回归；元素可见无需停靠，只可能少停不可能多停。行为断言 tools/verify-kb-prov-covered.mjs ====
  { name: '#387 安卓盲推停靠被盖闸·实测（删则无键盘环境点输入栏盲推 58%=输入栏顶屏中 UI 乱闪屏）', file: 'js/mobile-adapt.js', needle: 'if (_kbCovered) _aProvDock();' },
  { name: '#387 安卓读数判据分支同样被被盖闸包住（删 =||= 恢复视口不动即盲推）', file: 'js/mobile-adapt.js', needle: 'Math.abs(ih - _aIH) <= 2 && _kbCovered) {' },
  { name: '#387 iOS 盲推停靠被盖闸（删则无键盘 iOS 环境点输入栏盲推收缩=UI 乱闪屏）', file: 'js/mobile-adapt.js', needle: '_iCovered = !!(_rI && _rI.height > 0 && _rI.bottom > ((_vv.offsetTop || 0) + _vv.height) + 12);' },
  { name: '#337 VirtualKeyboard 实测尺拉起（删则悬浮键盘只能 58% 盲猜，高占比输入法停靠不足仍被盖）', file: 'js/mobile-adapt.js', needle: 'vk.overlaysContent = true;' },
  { name: '#337 欠深自纠逐拍收紧（删则保底停靠不足时输入栏仍被盖不自愈）', file: 'js/mobile-adapt.js', needle: 'var ph = Math.max(Math.round(base * 0.34), cur - Math.round(base * 0.08));' },
  // ==== 2026-09-11 #336 信息诊断导出 docx 无反应（荣耀畅玩80Pro 自带浏览器对合成 a[download]+blob URL 静默忽略）：接入数据备份同款三级降级链 window.mochiExportBlob（①系统分享面板 ②系统保存框 ③确认后 a[download]），裸下载只作兜底；两处诊断弹窗统一走 diagExportDocx。行为断言 tools/verify-docx-export.mjs E5~E11 ====
  { name: '#336 诊断 docx 走三级降级链（删则壳浏览器点导出docx无反应=用户报障回流）', file: 'js/device.js', needle: "window.mochiExportBlob(blob, fname, 'mochi 诊断报告'" },
  { name: '#336 mochiExportBlob Blob 版导出（删则分享面板/保存框通道断链，仅剩裸下载）', file: 'js/data-backup.js', needle: 'window.mochiExportBlob = function (blob, fname, shareTitle, saveTypes)' },
  { name: '#338 心情日记 TA心情独立（删则 taMoodFor 恢复读我的当日记录、35% 概率跟随＝我记录心情后 TA 心情被改成同款）', file: 'js/mood-diary.js', needle: "hashStr('ta-mood-indep|'" },
  // ==== 2026-09-12 #339 设置改完退后台/等一两小时回退成默认值（默认字卡概率/回复速度/emoji 概率等全站小键，多机型；LS 回滚家族第五层 #82/#88/#226/#229/#233/#265）：wrj 启动回放 wrjReplay 把回滚日志里的旧值 idbSet 回写 IDB 踩掉新值，wrjMergeFromIdb 按「标记更新→取 IDB 值自愈」读到的恰是被踩掉的旧值＝自愈被自己废掉。修复：回放只救 内存+LS，绝不回写 IDB。行为断言 tools/verify-wrj-replay-no-stomp.mjs 红绿对照 ====
  { name: '#339 wrj 回放禁写 IDB·守卫常量（翻成 false/删除＝恢复无条件回写＝「改完设置就退浏览器」最近一次改动 100% 丢失回归）', file: 'js/idb.js', needle: 'var WRJ_REPLAY_NO_IDB = true;' },
  { name: '#339 wrj 回放禁写 IDB·守卫包住 idbSet（删守卫留裸 idbSet＝回放旧值踩掉 IDB 新值、wrjMerge 自愈读回被踩旧值）', file: 'js/idb.js', needle: 'if (!WRJ_REPLAY_NO_IDB) { try { if (window.idbSet) window.idbSet(e.k, e.v); } catch (e2) {} }' },
  { name: '#337 尾巴日志收录互动卡问题/选项字段（删字段清单＝IDB 落盘失败回放出的互动卡「卡片在、问题空白」回归）', file: 'js/chat.js', needle: "const CHAT_TAIL_INTERACT_FIELDS = ['askQuestion', 'askOptions', 'askType', 'deskCk', 'deskCkDir'," },
  { name: '#337 互动卡渲染回退 rec.text 自愈（三个 || 去掉＝存量空白卡永远空白、无自愈路径）', file: 'js/chat.js', needle: "escTxt(rec.choiceQuestion || rec.text || '')" },
  // ==== 2026-09-12 #342 拍卖会两缺陷：①⛶ 全屏被 #321 半框 ID 规则钳在 68% 高（ID 特异性压过 .poke-card.game-fs 的 max-height:none，实测 574/844px 底部露出聊天页）→ 半框规则加 :not(.game-fs) 限定；②#321 全屏教学浮层盖住头部 ✕ 且无自己的出口＝想走只能先开局 → 加「先不玩」按钮（template+js）。行为断言 tools/verify-auction-overlay.mjs E/F 组 ====
  { name: '#342 拍卖半框 68% 规则限定非全屏（删 :not(.game-fs)＝ID 规则重新压过 game-fs，⛶ 全屏只有 68% 高半截屏）', file: 'css/chat-pages.css', needle: '#chat-auction-panel:not(.game-fs) { height:auto; min-height:min(68%, 560px); max-height:68%; }' },
  // ==== 2026-09-12 #345 TA主动消息「通知已弹、进聊天被吞」（红米 K80 Chrome 报障，全机型同现与设备无关；K80 诊断：后台保活存活期消息到达+系统通知已弹）：横幅/系统通知在 addIn 同步链发出，rc-prob 25% 撤回签 900ms 后才掷、rc-refix 未命中不补发＝通知承诺的内容进聊天只剩「对方撤回了一条消息」。修复：撤回签提前到投递前掷，命中撤回的本条 silent 落地（不弹通知、未读角标照增），补发的替换消息走正常投递。行为断言 tools/verify-proactive-retract.mjs ====
  { name: '#345 撤回先掷签后投递·silent 接线（改回 silent: i > 0＝撤回消息重新弹通知、进聊天内容消失＝「刚主动发的消息被吞」回归）', file: 'js/chat.js', needle: 'silent: i > 0 || willRetract' },
  // ==== 2026-09-16 #556 回复链/拍一拍撤回先掷签（#345 同族收口②③，OPPO Reno6 5G 雨见 Firefox 报障「弹窗显示的字卡进聊天压根没有、是别的字卡（弹窗说早安、进聊只剩撤回墓碑+别的卡）」，用户明说多机型同现与设备无关；#550~#552 编号已被并行批次占用故顺延）：#345 只收口了 tryAutoSend，replyOnce（scheduleReply/continueChat/拍一拍追问共经）与 sendPoke 仍在 addIn 弹桌面横幅/系统通知后才掷 rc-prob——900ms 后 partialRetractMsg/retractMsg 撤回＝通知承诺的内容进聊天只剩墓碑/缺段＋同批其它字卡。修复：同 #345 投递前定生死，命中撤回的本条 silent 落地（不弹通知、不播音效、角标照增），900ms 后照常撤回，rc-refix 补发正常投递。行为断言 tools/verify-reply-retract-order.mjs 18 断言 ====
  { name: '#556 回复链撤回先掷签（replyOnce 掷签挪回 addIn 之前；删＝通知先弹再撤回吞内容＝「弹窗说的那句进聊天没有」回归）', file: 'js/chat.js', needle: "const willRetractR = hit(c['rc-prob'])" },
  { name: '#556 拍一拍撤回先掷签·silent 接线（sendPoke 命中撤回必须静默落地；删 silent＝撤回消息重新弹通知＝同族回归）', file: 'js/chat.js', needle: 'addIn(r.text, { type: r.type, silent: willRetractP })' },
  // ==== 2026-09-12 #346 拍卖会余缺陷批（用户「全部修复」）：结算后开🎒回不去汇总／转赠无确认易误触／寄到时背包列表 data-i 错位可能送错件／余额不足出价键静默置灰／TA掂量中返回文案误报／音效开关不记忆／矮屏(横屏)半框 68% 太挤。行为断言 tools/verify-auction-overlay.mjs G 组 ====
  { name: '#346 结算汇总 showSummary 独立成函数（内联回 endSession＝结算被🎒覆盖后回不去本场汇总）', file: 'js/auction.js', needle: 'function showSummary() {' },
  { name: '#346 转赠走全站 openModal 确认（删＝点「送TA」立即移出不可撤回＝误触丢拍品）', file: 'js/auction.js', needle: '送出后不可撤回。' },
  { name: '#346 寄到且背包开着就重渲染（删＝unshift 后已渲染 data-i 整体 +1，「送TA」可能送错件）', file: 'js/auction.js', needle: 'delivered && bagOpen' },
  { name: '#346 余额不足提示行接线（删＝出价键静默置灰无解释，新用户不知道要先有心意币）', file: 'template.html', needle: 'id="au-wallet-hint"' },
  { name: '#346 背包返回文案按回合态（删＝TA 掂量中返回误报「到你出价了」）', file: 'js/auction.js', needle: '正在掂量你的出价' },
  { name: '#346 音效偏好持久化（删＝每次重开面板重置为开、🔇 记不住）', file: 'js/auction.js', needle: "localStorage.getItem('xy-home-v2:au-sound')" },
  { name: '#346 矮屏(横屏 max-height:500px)半框提到 82%（删＝横屏 68% 竞价区挤）', file: 'css/chat-pages.css', needle: '@media (max-height:500px)' },
  // ==== 2026-09-12 #347 拍卖会寄回投递不依赖打开面板（全局 10 分钟补投）：原 checkGifts 只挂面板打开/开面板期 30s，「2~4 天寄回」实际是「下次打开拍卖会才寄到」====
  { name: '#347 寄回全局补投·10 分钟一次（删＝TA 寄回的拍品要打开拍卖会才到账）', file: 'js/auction.js', needle: '600000' },
  // ==== 2026-09-12 #348 拍卖会优化批（用户「都需要优化」）：成色评级 SSR/稀有/普通（按底价分档，揭晓与记录展示）／落槌与被抢走震动反馈／落盘 localStorage+IndexedDB 双写+开屏回填／拍卖记录页（📜 最近 60 条）／自制拍品（➕ 三段式添加，输入同名删除，上限 20，随机 20% 蒙面并入奖池）／自定义出价（长按出价键 600ms 直接压价）／TA 四状态跟价台词库。行为断言 tools/verify-auction-overlay.mjs H 组 ====
  { name: '#348 成色评级分档（删则拍品无普通/稀有/SSR 之分，揭晓与记录退化）', file: 'js/auction.js', needle: 'function rarityOf(' },
  { name: '#348 落槌/被抢走震动反馈（删则安卓无触感反馈）', file: 'js/auction.js', needle: 'navigator.vibrate' },
  { name: '#348 落盘双写 localStorage+IndexedDB（删则收藏/记录只存 localStorage，清站点即丢）', file: 'js/auction.js', needle: 'function persist(' },
  { name: '#348 开屏 idb 回填收藏/记录（删则换机/清站点后双写数据无法找回）', file: 'js/auction.js', needle: 'restoreFromIdb' },
  { name: '#348 拍卖记录存储（删则 📜 记录页永远空）', file: 'js/auction.js', needle: ':auction-history' },
  { name: '#348 自制拍品存储（删则 ➕ 添加的拍品无处安放、奖池不合并）', file: 'js/auction.js', needle: ':auction-custom' },
  { name: '#348 自定义出价（删＝长按无反应只能三档出价）', file: 'js/auction.js', needle: 'customBidModal(' },
  { name: '#348 TA 按行为状态差异化跟价台词（改回固定池＝四状态语气趋同）', file: 'js/auction.js', needle: 'pick(m.calls)' },
  // ==== 2026-09-12 #349 游戏面板跨桌面串名串档：snake 五个存储键（昵称/战绩/最高分/存档）与 pong 存档键都是【模块加载时冻结】的桌面 cid——加载时在 A 桌面、切到 B 桌面后开面板读写仍是 A 的键（任何机型必现）。改动态 activePrefix()/activeStore（同其余游戏面板既有模式）====
  { name: '#349 贪吃蛇标题名走 activeStore 动态命名空间（改回裸读冻结 PARTNER_KEY＝切桌面标题串名）', file: 'js/snake-game.js', needle: "nst.get('cs-lbl-partner') || nst.get('lbl-partner')" },
  { name: '#349 贪吃蛇战绩/最高分/存档键动态取桌面（改回加载时冻结 const PREFIX＝切桌面串档）', file: 'js/snake-game.js', needle: "function keyScore() { return prefix() + ':snake-score'; }" },
  { name: '#349 乒乓存档键动态取桌面（改回顶层 const SAVE_KEY 冻结 cid＝切桌面串档）', file: 'js/pong.js', needle: "function saveKey() { return (window.activePrefix && window.activePrefix() || 'xy-home-v2') + ':pong-saved'; }" },
  // ==== 2026-09-12 #350 词典页整页滚动：v3.36.x 场景开关/概率块插到列表上方后漏加 #239 同款规则，列表被 flex 挤成 6~29px＝「词典点进去上下滑不了」（多机型）====
  { name: '#350 词典页整页滚动（删则词典列表被设置块挤成几像素/屏外＝页面滑不动，#239 同族回归）', file: 'css/chat-pages.css', needle: '#page-dict-cards #d2-dict-list { flex:0 0 auto; overflow:visible; min-height:0;' },
  { name: '#340 消消乐死锁洗牌滑动动画（删则洗牌退回整盘瞬跳重绘）', file: 'js/match3.js', needle: "p.el.style.transitionDuration = '0.32s';" },
  // ==== 2026-09-12 #351 桌面装修图标摆放（vivo X200s/V2458A VivoBrowser 报障，多机型同现）：跨页拖动只写目标页顺序数组、启动模板把图标放回默认页且旧恢复逻辑只排「已在本格」节点＝退出重进图标回原位；新增页无 .app-grid＝放进去的图标只能独立竖排无排版不可调位。修复：启动跨网格认领归位（非模板默认页认领胜出+脏条目自愈清盘）、拖动/装修库同步清源页数组、新页自带 pg* 网格、独立图标可拖入网格 ====
  { name: '#351 跨页图标启动归位（删则退出重进图标回原位——顺序数组跨网格认领+非默认页裁决）', file: 'js/personalize.js', needle: 'owner[k] === ICON_HOME_GRID[k] && gid !== ICON_HOME_GRID[k]' },
  { name: '#351 跨页拖动清源页顺序数组（删则源页脏条目残留→启动认领回原位）', file: 'js/personalize.js', needle: "store.set('app-icon-order-' + srcGrid.dataset.app" },
  { name: '#351 新页自带图标网格（删则新页图标只能独立竖排、无排版不可调位）', file: 'js/personalize.js', needle: "pgGrid.setAttribute('data-desk-widget', 'pg' + i)" },
  // ==== 2026-09-12 canvas 手感批（用户「都要优化」）：打砖块丢命震屏 + 贪吃蛇死亡先演后弹 ====
  { name: '#352 打砖块丢命震屏（删则丢命无任何画布反馈＝手感批回归）', file: 'js/breakout.js', needle: 's.shakeUntil = now + 300; s.shakeMag = 5;' },
  { name: '#352 贪吃蛇死亡先演后弹（删则结算浮层回到立刻弹出＝死亡瞬间被跳过，#341 同族回归）', file: 'js/snake-game.js', needle: "if (state !== _endState || _endState.status !== 'over') return;" },
  // ==== 2026-09-12 #353 应用内「清除本地数据」没清干净（红米 K70/多机型）：数据双写 LS+IDB，旧逻辑只 idbClearAll（clear store）且用 ||Promise.resolve(true) 掩盖失败＝清库事务失败时只清 LS、IDB 残留，启动 idbRestore 全量回填＝专属字卡（LS-only）真丢、其余内容全复活。修复：idb.js 新增 idbDestroy（deleteDatabase 真删库，回填无源）+ personalize.js 优先真删库、失败退回 idbClearAll ====
  { name: '#353 真删库函数 idbDestroy 在位（删则清除数据只 clear store、失败即从 IDB 回填复活）', file: 'js/idb.js', needle: 'indexedDB.deleteDatabase(DB_NAME)' },
  { name: '#353 清除数据优先真删库（删则退回只 idbClearAll、依赖||true 掩盖失败＝清不干净）', file: 'js/personalize.js', needle: "const destroy = (window.idbDestroy && window.idbDestroy()) || Promise.resolve(false);" },
  // ==== 2026-09-12 音乐后台停播韧性（多机型/全浏览器：切后台十几秒~1分钟才停、回前台才恢复）：原后台补播 scheduleBgResume 只排 [300,1500,5000,12000] 四档、约 12 秒耗尽后再无人拉起——保活 WebRTC 回环+wakeLock 双豁免下页面通常未完全冻结，音乐只被临时暂停时补播窗口太短＝十几秒~1 分钟停播主因。修复=加 keepBgResumeAlive 尾档每 12s 续下一轮（对齐 bg-keep 无限退避）；死循环仍由 tryResumePlayback 现有 bgResumeFails>=6 + bgResumeFailAt 60s 冷却封顶，音乐真出声/用户停/来电 hold 都 clearBgResume 自然断轨 ====
  { name: '音乐后台补播持续续轨（keepBgResumeAlive 尾档 12s 续轮；删则后台补播回到 12s 四档即弃＝切后台十几秒~1 分钟停播复发）', file: 'js/music-player.js', needle: 'bgResumeTimers.push(setTimeout(keepBgResumeAlive,12000));' },
  // ==== 2026-09-12 #361 语音点播无声（多机型：荣耀X50 Edge 等安卓 Chromium 系内核对未挂载 DOM 的 Audio 静默空放，play() 走完不出声）：字卡库点播与群聊语音仍是 new Audio() 裸播，与已修的聊天气泡(#358)/录音试听同根因；修复=挂进 document.body 再 play，停播/播完/出错即卸 ====
  { name: '#361 字卡库语音点播挂载后播（删挂载即回归安卓 Chromium 系点播静默空放）', file: 'js/chatcard.js', needle: 'playingAudio = nextAudio' },
  { name: '#361 字卡库语音停播即卸（与挂载对称，删卸载行＝挂载的 Audio 元素滞留 DOM 泄漏）', file: 'js/chatcard.js', needle: 'try { if (playingAudio.parentNode) playingAudio.parentNode.removeChild(playingAudio); } catch (e) {}' },
  { name: '#361 群聊语音挂载后播（删挂载即回归群聊语音安卓无声）', file: 'js/group-chat.js', needle: 'gcVoiceAudio = a; gcVoiceBtn = btn;' },
  // ==== 2026-09-15 #499 需求变更（推翻 #365 #319 对三链的锁闸）：二级密码锁定不再影响聊天情绪字卡、TA 的心情、聊天回应字卡——三链未解锁也照常触发；受影响的只剩默认聊天字卡/词典等系统预设池。原 #365 两条锁闸哨兵随锁闸一并移除，改登豁免锚点防需求回流 ====
  { name: '#499 回应字卡豁免锁定（#365 replySrcLocked 锁闸按新需求移除；锚点=两函数首个守卫是开关而非锁，锁闸被加回开头即失配；构建拼接剥行首缩进，锚不带缩进＝#496 同款教训）', file: 'js/mood-reply-cards.js', needle: "window.getFollowupWord = function (reply) {\nif (ls.get('rc-enabled') !== null && ls.get('rc-enabled') !== '1') return '';" },
  { name: '#499 TA的心情豁免锁定（#365 锁闸按新需求移除；锚点=函数首个守卫是 enabled 而非锁，锁闸被加回开头即失配；构建拼接剥行首缩进，锚不带缩进＝#496 同款教训）', file: 'js/ta-mood.js', needle: "window.tryTaMoodShare = function () {\nif (!enabled()) return null;" },
  // ==== 2026-09-15 #500 三级链单卡开关补全：心意卡（9 组 + 特殊 4 组）与交流意图卡（8 组）在字卡库里没有列表＝没有关闭入口，且三类共用 mc-off-mood 键（「想念」「分享」等 20+ 张同名卡跨类互相误伤）——用户反馈「手动关闭没有用，会频繁使用」。修=三类分栏 UI + 各自独立开关键（旧键仍作兼容读，存量关闭不复活）====
  { name: '#500 三级链独立开关键（回到共用 mc-off-mood ＝同名卡跨类互相误伤，关情绪卡会连心意卡一起消失）', file: 'js/mood-reply-cards.js', needle: "const OFF_KEY = { mood: 'mc-off-mood', heart: 'mc-off-heart', intent: 'mc-off-intent' };" },
  { name: '#500 心意/意图卡旧键兼容读（删兼容行＝老用户此前关掉的心意/意图卡全部复活）', file: 'js/mood-reply-cards.js', needle: "if (type !== 'mood' && !hasMoodCard(content) && ls.get('mc-off-mood:' + content) === '1') return true;" },
  { name: '#500 心意卡单卡开关入口（该行消失＝心意卡在字卡库里又没有列表，用户无从关闭）', file: 'js/mood-reply-cards.js', needle: ".concat((DATA.specialHeart || []).map(g => ({ ...g, type: 'heart', special: true })));" },
  { name: '#500 三类分栏容器（删＝心意/交流意图分栏 UI 丢失）', file: 'template.html', needle: 'id="mc-type-bar"' },
  { name: '#500 逐张关闭写入本类键（回写成 mc-off-mood ＝跨类误伤回归）', file: 'js/mood-reply-cards.js', needle: 'setTypeOff(g.type || mcType, c.content, nowOff);' },
  // ==== 2026-09-12 #367 诊断红点：AbortError 类未处理 rejection（音乐/通话流超时兜底、切页取消的主动 abort）入错误环刷屏——Safari「Fetch is aborted」iOS 实录 ×41 条；修复=unhandledrejection 采集层按 AbortError 名/已知 abort 文案放行，与 fetch 包装层网络失败口径对齐 ====
  { name: '#367 AbortError rejection 放行（删放行＝主动 abort 取消照旧刷诊断红点，Safari 报「Fetch is aborted」）', file: 'js/device.js', needle: "r.name === 'AbortError')\n|| /^(Fetch is aborted|signal is aborted without reason" },
  // ==== 2026-09-12 #368 跨桌面串数据两件（iOS Safari 用户反馈，多机型同现）====
  { name: '#368 通话背景切桌面重读（applyCallBg 只在加载/上传/移除执行＝切联系人后 .call-panel/#call-mini 残留上一桌面的背景图，跨桌面串图且设置页显示不随桌面走）', file: 'js/call.js', needle: "document.addEventListener('contact-switched', applyCallBg)" },
  { name: '#368 送礼面板心愿单入口名字随桌面刷新（init 注入写死 partnerName＝切联系人后「看看 XX 的心愿单」残留上一个桌面的名字）', file: 'js/gift-shop.js', needle: "gwBtn0.textContent = '看看 ' + partnerName() + ' 的心愿单'" },
  // ==== 2026-09-12 #369 布局视口残留深缩自愈（iQOO Z9 VivoBrowser 实报「聊天聊到一半屏幕突然变成一半」「听歌闪几下加载中变成一半」，#236 同族第三形态：inner 与 vv 一起停在键盘态）====
  { name: '#369 布局视口残留钉高（inner/vv 同停键盘态、基准被重锚吞掉＝#236/#209 全失明；看门狗把 .phone 钉回 _aFullIH，inner 回基线解除）', file: 'js/mobile-adapt.js', needle: 'if (_aVpPin && _ihNow >= _aFullIH - 12)' },
  { name: '#369 基准重锚浅漂移闸（无聚焦分支原样 _aIH=ih 会把无键盘基准吞成残留值 373）', file: 'js/mobile-adapt.js', needle: 'ih >= _aIH - 12 || _aIH - ih < Math.round(Math.min(_aIH || ih, _aH || ih) * 0.22)' },
  // ==== 2026-09-12 #370 词典拼字两件（用户定稿：①词典全部分组字卡都进抽卡池，不再只取「语录*」前缀组；②形态概率——单气泡拼字为主，qs-multi 逐条连发降为 20% 小概率，multi 关=不能连发，双形态全关兜底单气泡不再兜底连发）====
  { name: '#370 词典拼字抽卡池放开到词典全部分组（原「语录*」前缀过滤删除=词库/常用词/自建词都能抽）', file: 'js/quote-spell.js', needle: "if (typeof q === 'string') quotes.push(q);" },
  { name: '#370 逐条连发降小概率（双开 80/20 单气泡为主；multi 关=one 恒 true 不能连发）', file: 'js/quote-spell.js', needle: 'if (multiOn) one = oneOn ? Math.random() >= 0.2 : false;' },
  { name: '#370 词典拼字链路自检行（五道静默闸门任一被关=永不发词典字卡且零提示；删则用户设备上被哪道闸挡住无从知晓）', file: 'js/reply-settings.js', needle: "const ov = window.dictOverall ? window.dictOverall('chat') : 100;" },
  // ==== 2026-09-12 #371 群聊跟底三连写（红米 K80 Chrome 等多机型报「群聊联系人发消息不自动滚到最新，要手动滑」；单聊 #162 同根因同修法：移动内核丢弃一次性 scrollTop 写入/迟到布局顶开，group-chat.js 只写一次从未跟进）====
  { name: '#371 群聊跟底复写闸（触摸/滚轮接管判断；内核丢弃首写时视口离底>150px 会被 nearGcBottom 误判，复写不能只看 nearGcBottom）', file: 'js/group-chat.js', needle: 'if (!gcUserGcScrollTouched) scrollToBottom();' },
  { name: '#371 进群 renderAll 滚底走三连写（进页不贴底同一内核问题）', file: 'js/group-chat.js', needle: 'followGcBottom(true); // #371：进页滚底同走三连写' },
  // ==== 2026-09-12 #379 连续送心愿单礼物第二件起闪一下就消失（小米15 Pro Chrome 等多机型）====
  { name: '#379 礼物消息去重签名用礼物自身字段（原误用鲜花字段=任意两件礼物签名恒等，60s 窗口内第二件被当相邻重复删）', file: 'js/chat.js', needle: "String(m.giftId || '') + '|' + String(m.giftName || '')" },
  // ==== 2026-09-12 #380 装修换页「今日备忘/心情」刷新回第三页（v3.13.x 一次性迁移写成了每次启动无条件迁移，用户手动换页被打回；小米15 Pro 等多机型）====
  { name: '#380 memo-row 有布局一律尊重不迁移（删则 v3.13.x 强迁逻辑复活=每次启动把用户手动换页打回第三页）', file: 'js/personalize.js', needle: 'if (lay) return;' },
  // ==== 2026-09-12 #381 拍卖会背包/记录浮层显示不全（浮层 absolute 随 .au-stage，未开局 stage 仅 ~30px 列表被裁成一条缝；全机型）====
  { name: '#381 背包/记录浮层转全屏开关（删则浮层又缩回 30px 高的 stage 里显示不全）', file: 'js/auction.js', needle: "overlayEl.classList.toggle('au-ov-fs', !!fs)" },
  { name: '#381 全屏浮层 hidden 救援（.pong-overlay 的 display:flex 压掉 UA [hidden]，#331 同因；删则关不掉全屏背包/记录）', file: 'css/chat-pages.css', needle: '#au-overlay.au-ov-fs[hidden] { display:none; }' },
  // ==== 2026-09-12 #378 聊天+群聊跟底闸改钉住标记 + 轻点不杀跟底（红米 K80 Chrome 单聊/群聊同报「联系人发消息不自动滚到最新，要手动滑」；①旧 nearGcBottom/chatNearBottom 距离闸在内核丢弃首写/图片迟到解码顶开后把后续每条来消息都误判成在看历史永不跟底；②轻点消息区（点气泡）即解钉且无法回钉，自动跟底被一次轻点永久杀死）====
  { name: '#378 单聊来消息跟底闸改按钉住标记（距离闸在首写被丢弃后永不跟底；#492 起 userFollow 显式通道不吃此闸，闸语义不变）', file: 'js/chat.js', needle: 'if (!out && !userFollow && !chatPinnedBottom) return;' },
  // ==== 2026-09-15 #492 帮我决定/多人决定结果发到聊天后不滑到最新消息（多机型同报）：决策结果是用户主动触发，与 out 侧（自己发消息必跟底）和群聊 followGcBottom(true) 同权；chatAddIn({follow:true}) 一次性标记 + maybeScrollChatBottom 消费，TA 自发消息 #162/#378/#416 不打扰契约零改动 ====
  { name: '#492 follow 一次性消费+跟底闸放行（删则决策结果在解钉态永不跟底＝症状复发）', file: 'js/chat.js', needle: 'const userFollow = !out && chatUserFollowScroll;' },
  { name: '#492 chatAddIn 用户主动通道入口（删则 decision/group-decision 的 follow 传参失效）', file: 'js/chat.js', needle: 'if (opts && opts.follow) chatUserFollowScroll = true;' },
  { name: '#492 帮我决定结果发送接 follow 通道（删则发到聊天后不滑到最新复发；#544 该行追加 dedupExempt，锚点随契约同步）', file: 'js/decision.js', needle: 'window.chatAddIn(replyText, { enter: true, silent: true, follow: true, dedupExempt: true }); // FIX 2026-09-15 #492 帮我决定结果' },
  { name: '#492 多人决定结果发送接 follow 通道（删则发到聊天后不滑到最新复发；#544 该行追加 dedupExempt，锚点随契约同步）', file: 'js/group-decision.js', needle: 'window.chatAddIn(replyText, { enter: true, silent: true, follow: true, dedupExempt: true }); // FIX 2026-09-15 #492 多人决定结果' },
  { name: '#378/#416 单聊手动滚回贴底回钉（解钉后自动跟底可恢复；#416 起只认真的贴到底 ≤8px，防上翻读最新时误回钉拽底）', file: 'js/chat.js', needle: 'else if (!chatPinnedBottom && chatAtBottom())' },
  { name: '#378 单聊轻点不杀跟底（位移<10px 且贴底=回钉，点气泡不再永久解钉）', file: 'js/chat.js', needle: 'const dy = Math.abs(e.changedTouches[0].clientY - chatUnpinTsY);' },
  { name: '#378 群聊跟底闸改按接管标记（同单聊距离闸问题）', file: 'js/group-chat.js', needle: 'if (!force && gcUserGcScrollTouched) return;' },
  { name: '#378/#416 群聊轻点不杀跟底 + 滚回贴底解除接管（#396 随行补锚定摘除；#416 起轻点回跟只认真的贴到底 ≤8px，防上翻读最新时一点气泡就恢复跟底被拽回）', file: 'js/group-chat.js', needle: 'if (dy < 10 && gcAtBottom()) { gcUserGcScrollTouched = false;' },
  // ==== 2026-09-13 #396 聊天/群聊滑动屏幕「弹一下」（红米 K80 Chrome 报障，多机型同族）——两根因：①单聊 loadOlderIncremental 补偿式 beforeTop+anchor.offsetTop 读的是插入后首元素 offsetTop=插入高度+.chat-body padding-top，每批上翻固定多推 14px=视觉跳一下（#316 锚定只兜图片迟到解码兜不住这 14px，无头实测 Δsh=8903 误差恒-14px）；②#316 只给单聊解钉开回滚动锚定，gc-body 共享 .chat-body 的 overflow-anchor:none 却从未挂回 scroll-anchor-auto=图多群聊历史上翻被解码撑高推走 ====
  { name: '#396 单聊上翻补偿改锚点差值（删则每批上翻固定视觉上跳 padding-top 14px=滑动弹一下）', file: 'js/chat.js', needle: 'body.scrollTop = beforeTop + (anchor.offsetTop - anchorTopBefore);' },
  { name: '#396 群聊解钉开滚动锚定（删则图多群聊历史上翻被解码撑高推走，#316 同根因群聊侧）', file: 'js/group-chat.js', needle: "body.classList.add('scroll-anchor-auto')" },
  { name: '#396 群聊回钉摘锚定（钉住态 #199 none 语义不变，防锚定与 JS 显式滚动对打）', file: 'js/group-chat.js', needle: "body.classList.remove('scroll-anchor-auto')" },
  // ==== 2026-09-13 #401 点【发送】消息被吞（红米 K80 Chrome 报障同族复发，多机型通用纯逻辑）——两根因：①发守卫（#115 userEditedAfterClear）放行的「用户真实重打同文本」撞进 addRec 文本去重窗 2500ms 被静默吞（v3.17.x 只修守卫层误吞，addRec 第二层漏网；无头实证：重打 1.2s 后再发，输入框清空+音效照放+TA 照回，气泡 0 条）；②群聊 addMsg(input.innerText) 无 #215 撕文本快照兜底（Edge/Chromium 部分内核点发送瞬间零事件撕空组合文本→双读空→静默 return，单聊 #215 修过群聊侧同族漏修） ====
  { name: '#401 发件侧纯文本去重窗收窄 800ms（删/回 2500ms＝重打同文本 0.8~2.5s 内再发被静默吞，机械双击兜底+守卫双层仍在）', file: 'js/chat.js', needle: "&& !m.img && !m.voice && !m.special) return 800;" },
  { name: '#401 群聊发送取值快照兜底（删则撕文本内核群聊点发送消息静默消失，#215 群聊侧同族）', file: 'js/group-chat.js', needle: "input._gcLastTyped = input.innerText || '';" },
  { name: '#401 群聊清空同步作废快照（删则程序化清空后误点发送幻影重发上一条）', file: 'js/group-chat.js', needle: "input._gcLastTyped = '';" },
  // ==== 2026-09-13 #407 引用预览串条（华为 P50E Edge 报障「引用联系人的消息，输入栏预览显示的不是被引那条」，多机型同族）——菜单打开后 msgs 被权威读库合并/尾巴日志回放重排（中段插入/删除 ⇒ 后续下标整体位移）而 DOM 未重渲（#220 不贴底跳过重渲的防闪路径），点「引用」按陈旧 data-idx 解析＝msgs[idx] 指向另一条消息。修复=菜单打开时快照消息身份（对象引用+ts/side/text80 签名），动作执行时 resolveActiveMsg 四级重定位（①快路径 ②对象同一性 ③签名唯一命中 ④回退旧下标），引用/收藏/复制/编辑/撤回/删除全动作覆盖；群聊同族 gcResolveActiveMsg；chatTailMerge 回放条数并入 changed 走重渲；不贴底 changed 置 windowStale 作废同窗凭据 ====
  { name: '#407 聊天菜单动作身份重定位（删则 msgs 重排+DOM 未重渲窗口期引用/收藏/编辑/撤回串条）', file: 'js/chat.js', needle: 'function resolveActiveMsg() {' },
  { name: '#407 群聊菜单动作身份重定位（同族）', file: 'js/group-chat.js', needle: 'function gcResolveActiveMsg() {' },
  { name: '#407 尾巴回放位移并入 changed（删则回放插入后不重渲＝屏上 data-idx 整体陈旧）', file: 'js/chat.js', needle: 'if (chatTailMerge() > 0) changed = true;' },
  // ==== 2026-09-13 #404 米15夸克 LS 配额满（同域 ml2_* 他方键占 20MB，写探针 QuotaExceededError）二级密码解锁刷新即回锁——解锁后盲等 900ms reload，夸克等内核杀进程会中止在途 IDB 事务＝权威值未提交；LS 配额满设备项目 LS 键恒空、IDB 是唯一凭证，一次提交失败必现。修复=解锁/重锁改「确认 IDB 落库再刷新」（cardLockConfirmPersisted 轮询 200ms×15 兜底），诊断体检补 cardlock-state 全局根键三层值 ====
  { name: '#404 解锁/重锁落库确认接口（删则刷新回锁家族失去提交确认，回退盲等 900ms 竞态）', file: 'js/card-lock.js', needle: 'window.cardLockConfirmPersisted = function (expect, cb) {' },
  { name: '#404 开屏解锁等 IDB 确认 open 再刷新（删则夸克内核 reload 中止在途事务＝解锁刷新即回锁）', file: 'js/clock.js', needle: "cardLockConfirmPersisted('open', goReloadAfterPersist)" },
  { name: '#404 重锁等 IDB 确认 locked 再刷新（删则重锁丢失＝未成年人保护失效）', file: 'js/clock.js', needle: "cardLockConfirmPersisted('locked', goReloadAfterPersist)" },
  { name: '#404 诊断体检 cardlock-state 全局根键三层值（删则解锁丢失类报障无法判读，per-cid 探针恒缺失误导）', file: 'js/device.js', needle: "const ROOT_KEYS = ['cardlock-state'];" },
  { name: '#404 restore 完成复核解锁态翻转（删则 retainValue 先回填 memoryCache 时 wrj 合并不广播 heal，开屏锁卡停留「输入密码解锁」假象——LS 配额满设备 IDB 唯一值源路径实测复现）', file: 'js/card-lock.js', needle: "addEventListener('mochi-restore-done'" },
  // ==== 2026-09-12 #382 屏幕适配诊断报告「导出docx」点了毫无反应（iQOO neo10pro Chrome 报障，多机型全现）——#333 时 diagExportDocx 在主诊断闭包、屏幕适配诊断闭包跨 IIFE 引用恒 ReferenceError 被 openModal 按钮 try/catch 吞掉；同调用 4 参对 3 形参 legacy 分支必抛 failToast is not a function ====
  { name: '#382 诊断导出跨闭包挂载 window.mochiDiagExportDocx（删则屏幕适配诊断导出恒 ReferenceError 静默失败）', file: 'js/device.js', needle: 'window.mochiDiagExportDocx = diagExportDocx;' },
  { name: '#382 屏幕适配诊断导出改走 window 挂载 + 形参收窄（failMsg,toastFn）', file: 'js/device.js', needle: "(window.mochiDiagExportDocx || function () {})(c ? c.text() : r.text, 'mochi-screen-diag-'" },
  // ==== 2026-09-12 #383 联系人消息乱码直出 @@m:hash（华为畅享70Pro Chrome 报障，多机型全现）——#377 巨型库令牌化后裸 @@m:hash 卡体无 |||、非 data:，getPool 旧两道守卫全漏过＝令牌卡入文字池被当文字直出；normCell 补认裸令牌让存量乱码刷新自愈回图片 ====
  { name: '#383 getPool 媒体令牌卡不进文字池（删则令牌卡再入池被当文字发出）', file: 'js/chat.js', needle: 'window.mochiMediaIsToken && window.mochiMediaIsToken(c)) return;' },
  { name: '#383 归一化裸令牌 text 补 type=image（删则存量乱码消息永停留文字气泡）', file: 'js/chat.js', needle: 'window.mochiMediaIsToken && window.mochiMediaIsToken(r.text)))) { r.type = '+"'image'"+'; c = true; }' },
  // ==== 2026-09-13 #384 开屏点击进入后强制观看公告（作者道别公告：二传二改/月底停更/二级密码）——每次进入先弹 #splash-mandatory，必须滑到底、点【我已阅读并确认进入】才真正进入；门控=未到底时确认按钮 is-disabled 不可点（clock.js mandBottom/finishEnter） ====
  { name: '#384 强制公告滑到底才可确认进入（删则强制公告可跳过，进入不再必读）', file: 'js/clock.js', needle: 'if (mandBottom) finishEnter();' },
  // ==== 2026-09-13 #385 联系人消息乱码·令牌夹在文字中间直出（续 #383）——#383 只治「整条 text 是裸令牌」（normCell 升 type=image）；多字卡回复 pickN.join(' ') 拼出的混合文本消息里 @@m:hash 嵌在正文中间，type 仍 text，渲染端 escTxtBr 原样铺出令牌串＝乱码（聊天/群聊公用库共享多机型全现）。消费者边界（气泡渲染）统一把内嵌 @@m:<hash32> 行内转 <img>，交 media-pool 观察器解图，存量/新收/任一浏览器不再直出令牌串 ====
  { name: '#385 内嵌令牌转行内图·chat 助手核心逻辑（split 令牌正则——删则令牌串不再转 <img>/<img class=msg-inline-tok> 直出乱码）', file: 'js/chat.js', needle: 's.split(/(@@m:[0-9a-f]{32})/g)' },
  { name: '#385 chat 文本气泡渲染调用内嵌令牌助手（删调用则助手在但不用，混合乱码消息仍直出令牌串）', file: 'js/chat.js', needle: 'window.mochiInlineTextHtml(T(__rawText))' },
  { name: '#385 单聊撤回段文本也走内嵌令牌助手（撤回复核样直出令牌串复现）', file: 'js/chat.js', needle: 'segHtml += window.mochiInlineTextHtml(' },
  { name: '#385 group-chat 文本气泡/预览走内嵌令牌助手（群聊纯文本气泡改回 escTxtBr 则群聊乱码复现）', file: 'js/group-chat.js', needle: 'window.mochiInlineTextHtml(rec.text' },
  // ==== 2026-09-13 #383b 源头补口三件（本会话，未构建随下次收口）——#385 治渲染端消费者边界，这里治源头：群聊回复池同款两道守卫漏裸令牌（新乱码仍会从群聊发出）、群聊渲染裸令牌 text 走图片分支、bg-keep 保活通知选卡漏判＝通知栏文字出乱码 ====
  { name: '#383b 群聊回复池令牌卡不进文字池（删则群聊继续从源头发出令牌卡）', file: 'js/group-chat.js', needle: 'c && window.mochiMediaIsToken && window.mochiMediaIsToken(c)) return;' },
  { name: '#383b 群聊渲染裸令牌 text 走图片分支（删则群聊存量整条令牌消息停留文字气泡）', file: 'js/group-chat.js', needle: "rec.type !== 'voice' && window.mochiMediaIsToken && window.mochiMediaIsToken(rec.text)" },
  { name: '#383b 保活通知选卡剔除媒体令牌卡（删则通知栏文字出乱码）', file: 'js/bg-keep.js', needle: 'window.mochiMediaIsToken && window.mochiMediaIsToken(t)) return false;' },
  // ==== 2026-09-13 #386 信箱/朋友圈令牌乱码（用户复报：聊天已好、信里/朋友圈仍乱码，多机型）——同 #385 消费者边界思路：mail renderBody/feed inlineBody+图片网格 RE 补认 @@m:hash 渲内联图；来源侧 feed cardPool 补第三道令牌守卫+媒体池放行令牌卡；摘要/快照/通知剥离处补令牌→[图片]/[表情包] ====
  { name: '#386 信件正文渲染认媒体令牌（删则信箱信纸直出 @@m:hash 串）', file: 'js/mail.js', needle: '|@@m:[0-9a-f]{32})/g' },
  { name: '#386 朋友圈正文/图片网格渲染认媒体令牌（删则动态/评论直出 @@m:hash 串）', file: 'js/feed.js', needle: '|@@m:[0-9a-f]{32}|data:image' },
  // ==== 2026-09-13 #387 公用库令牌写回泄漏（iPhone 17 Safari/自带浏览器：字卡库表情包纯白图+表情包面板空分组+联系人图片全乱码，多机型）——#377 令牌化内存缓存经 ccAppendCards 公用分支整包写回原始键 cc-groups-public，随公用库/备份传到无媒体池数据设备＝令牌永解不出图；堵口+负缓存剔除+缺失占位 ====
  { name: '#387 ccAppendCards 公用分支改原始键现解析（删则令牌化缓存继续整包写回污染公用库）', file: 'js/chatcard.js', needle: 'const g = buildGroupsFrom(pubStore().get(PUB_KEY));' },
  { name: '#387 isMediaImg 剔除池缺失令牌卡（删则无池设备继续发/显白图卡）', file: 'js/chatcard.js', needle: 'return !(window.mochiMediaTokenMissing && window.mochiMediaTokenMissing(c));' },
  { name: '#387 观察器池缺失负缓存+占位打标（删则令牌白图不可辨且媒体筛选无法剔除）', file: 'js/media-pool.js', needle: 'missing.add(h); markMissing(h); return;' },
  { name: '#387 令牌缺失占位样式（删则白图不可辨）', file: 'css/base.css', needle: 'img.media-tok-missing' },
  // ==== 2026-09-13 #388 回复设置 toast 静默丢失 + 混用自定义字卡默认改回开（用户实报：词典拼字组开关改了没「已保存」提示）——cc-toast 全站懒创建唯独 reply-settings.js 只查不建＝元素不存在静默 return；qs-cc 默认 0→1（#310 存量反向迁移标记 1→2） ====
  { name: '#388 reply-settings toast 懒创建兜底（删则直达回复设置页所有开关「已保存」提示永不弹）', file: 'js/reply-settings.js', needle: 'function ccToastEnsure() {' },
  { name: '#388 qs-cc 默认改回 1（改回 0 则用户点名需求复发）', file: 'js/reply-settings.js', needle: "'qs-en': 1, 'qs-prob': 25, 'qs-cc': 1," },
  { name: '#388 qs-cc 存量反向迁移标记升级 2（删则被 #310 迁移成 0 的桌面回不到默认开）', file: 'js/reply-settings.js', needle: "s.set('reply-qs-cc-migrated', '2');" },
  // ==== 2026-09-13 #391 互动卡/查岗/留言/信件文字池令牌漏判收尾扫（vivo X200s Edge 报「TA 的好奇卡片联系人回复直出 @@m:hash 令牌」）——#383 系只修了聊天/群聊/朋友圈/信箱正文四条主链，getCustomCards 其余 6 个文字池消费方（ta-ask 好奇·吐槽回应/互动卡触发池/文字题连发、chat 查岗回应、calendar 每日留言、mail 信件补池）仍是旧两道守卫＝令牌卡被当文字抽中直出；本批全量补第三道守卫，此后 getCustomCards 全消费方零漏判 ====
  { name: '#391 好奇/互动卡回应文字池剔令牌（删则卡片回复继续直出令牌串）', file: 'js/ta-ask.js', needle: 'window.mochiMediaIsToken && window.mochiMediaIsToken(s)) && s.trim()' },
  { name: '#391 互动卡触发池剔令牌（删则互动卡话术直出令牌串）', file: 'js/ta-ask.js', needle: 'window.mochiMediaIsToken && window.mochiMediaIsToken(t)) return false' },
  { name: '#391 文字题答案池剔令牌（删则问问TA答案直出令牌串）', file: 'js/ta-ask.js', needle: 'window.mochiMediaIsToken(s)));' },
  { name: '#391 查岗回应文字池剔令牌（删则查岗回复直出令牌串；#533 起同行并排除 URL 媒体卡，锚点随新写法——逻辑未变）', file: 'js/chat.js', needle: "c.indexOf('data:') !== 0 && !/^https?:\\/\\//i.test(c) && !(window.mochiMediaIsToken && window.mochiMediaIsToken(c));" },
  { name: '#391 每日留言池剔令牌（#426 收敛为 calTextOnly 统一口径，自定义字卡循环锚点；删则日历留言直出令牌串）', file: 'js/calendar.js', needle: 'if (calTextOnly(c)) cards.push(c);' },
  { name: '#391 信件补池剔令牌（#429 收敛为 mailTextOnly 统一口径，自定义字卡循环锚点；删则来信正文拼令牌卡）', file: 'js/mail.js', needle: 'if (!mailTextOnly(s)) return;' },
  // ==== 2026-09-13 #392 二级锁↔词典关系看不懂（用户实报：词典开关都开了没效果，不懂和开屏二级密码的关系）——三处把因果讲成人话：词典独立页红条（锁定时当场提示+去哪解锁）、回复设置自检首闸文案「二级锁→防未成年人锁·锁定中·词典被锁停」、开屏锁卡 tip 补锁定影响面清单 ====
  { name: '#392 词典页二级锁关系提示条（删则锁定时词典开关全开却无效仍零解释）', file: 'js/default-cards.js', needle: 'function renderDictLockHint() {' },
  { name: '#392 词典页提示条锚点（删则提示无处渲染）', file: 'template.html', needle: 'id="dict-lock-hint"' },
  { name: '#392 回复设置自检首闸人话文案（改回「二级锁未解锁」则因果又看不懂）', file: 'js/reply-settings.js', needle: '锁定中·词典被锁停' },
  { name: '#392 开屏锁卡 tip 锁定影响面清单（删则不知道锁定停用了哪些字卡）', file: 'js/clock.js', needle: '锁定影响：默认聊天字卡、词典（含词典拼字）' },
  // ==== 2026-09-14 进入应用后强制弹窗提醒：系统字卡未解锁（未输二级密码）时每次打开应用弹一次长文案，可「知道了」关闭、可就地「输入密码解锁」（进入后开屏锁卡不可见，此为首要应用内解锁入口）====
  { name: '强制弹窗提醒·锁定文案（删则进入应用后不知道字卡为何不可用、也不知应用内可解锁）', file: 'js/clock.js', needle: '系统字卡未解锁，请自行添加字卡使用' },
  { name: '强制弹窗提醒·应用内解锁接线（promptCardUnlock 删则「输入密码解锁」pill 失效=锁定用户进入后无法就地解锁）', file: 'js/clock.js', needle: "v === 'unlock') promptCardUnlock();" },
  // ==== 2026-09-13 #394 全面体检第二批——#391 之后全库复扫「含 ||| 守卫 / 裸 escTxtBr 渲染」所有站点，又抓 9 处：词典语录抽卡池两条、漂流瓶候选池、统计页卡集+消息账+悬浮伴侣话术、词典词条录入校验、聊天 parts 文本/引用块/收藏文本、群聊文本气泡/引用/撤回段（渲染端统一走 #385 mochiInlineTextHtml 助手）====
  { name: '#394 词典语录抽卡池剔令牌（删则词典拼字直出令牌串）', file: 'js/quote-spell.js', needle: 'mochiMediaIsToken(q)) return false' },
  { name: '#394 词典抽卡混入 getPool.text 二次校验剔令牌', file: 'js/quote-spell.js', needle: 'mochiMediaIsToken(s)) return false' },
  { name: '#394 漂流瓶候选池剔令牌（删则瓶内容出令牌串）', file: 'js/drift-bottle.js', needle: "mochiMediaIsToken(s)) return '';" },
  { name: '#394 统计卡集剔令牌（删则常用文字字卡榜出令牌串）', file: 'js/p2-features.js', needle: 'mochiMediaIsToken(c))) set[c] = 1;' },
  { name: '#394 统计消息账剔令牌消息（删则存量乱码上榜）', file: 'js/p2-features.js', needle: 'mochiMediaIsToken(m.text)) return;' },
  { name: '#394 悬浮伴侣话术池剔令牌', file: 'js/p2-features.js', needle: 'mochiMediaIsToken(s)));' },
  { name: '#394 词典词条录入拒绝令牌串（删则令牌可再污染词典池）', file: 'js/default-cards.js', needle: 'mochiMediaIsToken(v))) return { ok: false' },
  { name: '#394 聊天 parts 文本走内嵌令牌助手（删则组合消息文本段直出令牌）', file: 'js/chat.js', needle: 'mochiInlineTextHtml(T(textPart))' },
  { name: '#394 群聊引用文本走内嵌令牌助手（删则群聊引用块直出令牌）', file: 'js/group-chat.js', needle: 'mochiInlineTextHtml(tRaw)' },
  // ==== 2026-09-13 #395 语音条令牌乱码（用户实报「聊天里的语音条也会显示乱码」）——带名字的令牌语音「名称|||@@m:hash」在旧包/存量数据里 type 仍是 text（语音型归一化只认「以 ||| 开头」的无主形态，带名形态漏判）＝整串当纯文本直出；且 voicePartsOf 对裸令牌/令牌当名字会把令牌串显成名称 ====
  { name: '#395 语音型归一化补认「名称|||令牌」形态（删则带名令牌语音消息继续当文本直出令牌串）', file: 'js/chat.js', needle: "r.text.indexOf('|||') >= 0 && /@@m:[0-9a-f]{32}$/.test(r.text)" },
  { name: '#395 voicePartsOf 裸令牌防御（删则令牌串被显成语音名称）', file: 'js/chat.js', needle: 'mochiMediaIsToken(raw)) return { name:' },
  { name: '#395 群聊语音分支令牌防御（删则群聊语音条显令牌串）', file: 'js/group-chat.js', needle: 'mochiMediaIsToken(_vraw));' },
  // ==== 2026-09-13 #397 收藏页图片被渲染成语音条 + iOS 卡顿点不动（iPhone 16 Safari 报障，多机型）——①#356 的语音判定正则含 ^ 分支＝裸令牌（图片载荷）被当语音；②缺失令牌每次渲染都重打 idbGet＋每个缺失 hash 各做一次全文档查询＝坏图成片设备主线程打满 ====
  { name: '#397 收藏语音判定必须带 |||（改回含 ^ 分支则图片收藏又变语音条）', file: 'js/chat.js', needle: "f.text.indexOf('|||') >= 0 && /@@m:[0-9a-f]{32}$/.test(f.text)" },
  { name: '#397 同元素同令牌只打一次 IDB（删则观察器重扫重复读＝坏图设备主线程打满卡住；新元素不受限故补池自愈保留）', file: 'js/media-pool.js', needle: "if (img.dataset && img.dataset.tokTried === h) return;" },
  { name: '#397 缺失读并发上限（删则坏图成片时一次打出几十个 IDB 读）', file: 'js/media-pool.js', needle: 'let missReads = 0;' },
  { name: '#397 缺失占位批量打标（改回逐 hash 全文档查询则坏图成片时尖峰）', file: 'js/media-pool.js', needle: 'const markQueue = new Set();' },
  { name: '#397 恢复事件清缺失负缓存（删则导入完整备份后坏图要等冷却/重启才恢复）', file: 'js/media-pool.js', needle: "mochi-restore-done', function () { missing.clear(); }" },
  // ==== 2026-09-13 #399 回信页滑不动/弹来弹去（用户实报，多机型同族）——安卓 ceConvert 退场的幽灵 textarea 未真正脱离布局流：.mail-compose-input{min-height:220px} 反压 height:1px!important，且 absolute 无定位＝沿用流内静态位置，回信页原信越长锚点落得越深、把 .phone 的幻影可滚动溢出撑到 1317px（写信页/聊天页 0）；内核「滚进视野」连带滚走 .phone＝整壳上移不弹回 ====
  { name: '#399 幽灵锚点零布局足迹·高度钳死（删则页面级 min-height 再反压 height:1px!important，退场锚点变实高盒子）', file: 'css/base.css', needle: 'min-height:0 !important; max-height:none !important;' },
  { name: '#399 幽灵锚点钉在包含块角上（删 top/left 则 absolute 沿用流内静态位置，深内容页再撑出 .phone 幻影溢出）', file: 'css/base.css', needle: 'position:absolute; top:0; left:0; width:1px !important; height:1px !important;' },
  { name: '#399 .phone 非滚动容器（overflow:clip；删则内核「把聚焦元素滚进视野」可再次整体滚走手机壳）', file: 'css/base.css', needle: 'overflow:hidden; overflow:clip;' },
  // ==== 2026-09-13 #398 令牌化管线并发风暴（iPhone 14 Pro/16 Safari「持续卡顿动不了」多机型；起病时间= #377 上线）——ccTokenizeGiantMedia 对每张大卡并发 mochiMediaTokenize（全量 TextEncoder+SHA-256 同挤主线程）且每次缓存重建全量重算；修复=串行+每张让出主线程+会话哈希备忘（FIFO 字符预算 8M）+世代计数防跨重建覆盖 ====
  { name: '#398 令牌化管线串行化+世代计数（#455 演进=pub/own 分槽：改回并发 Promise 链或删分槽世代则大库设备持续卡死/跨库互杀令牌化）', file: 'js/chatcard.js', needle: 'const gen = ++ccTokGen[sl];' },
  // ==== 2026-09-13 #402 进聊天界面跳动一下（多机型偶发，#352 无头诊断实锤）——归一化收尾对「窗口内改动」走 renderWindow 整窗重建＝rem+add ~200 节点同批＝进入聊天 ~0.5s 后整屏跳一下；修复=无结构删除时对 normChangedIdxs 命中下标原位换节点（patchChangedInPlace），其余节点零重建 ====
  { name: '#402 归一化收尾原位补丁函数（删则窗口内改动回退整窗重建＝进聊天整屏跳一下复发）', file: 'js/chat.js', needle: 'function patchChangedInPlace(changedIdxs, start) {' },
  { name: '#402 归一化改动下标登记（删则原位补丁拿不到命中清单＝静默回退整窗）', file: 'js/chat.js', needle: 'if (normChangedIdxs.indexOf(i) < 0) normChangedIdxs.push(i); } }' },
  { name: '#402 收尾优先原位补丁分支（删/改回无条件 renderWindow 则闪跳复发）', file: 'js/chat.js', needle: 'patchChangedInPlace(normChangedIdxs, renderStart)' },
  // ==== 2026-09-13 #403 漂流瓶都是空白没有留言（多机型）——dcf-drift 概率/总开关关断时 poolLine 返回空串，normal/special/TA 兜底全落空＝瓶子装空白信纸；修复=三道来源全空回退内置兜底话术（FB），瓶内文案永不落空 ====
  { name: '#403 TA 瓶三道来源全空回退内置兜底（删则 dcf 关断+无历史时出空白信纸）', file: 'js/drift-bottle.js', needle: "note = sampleHistLine() || poolLine('TA的话', 'ta') || rnd(FB.ta);" },
  { name: '#403 普通/特殊瓶文案永不落空（删则 dcf 关断时 normal/special 瓶空白）', file: 'js/drift-bottle.js', needle: "note = poolLine('海风', 'sea') || rnd(FB.sea);" },
  { name: '#400 收藏分类内容优先（改回信任存储 type 则误存语音的图片收藏又变语音条）', file: 'js/chat.js', needle: 'const isVoice = looksVoice;' },
  // ==== 2026-09-13 #406 后台来电点开通知无弹窗也无未接消息（OPPO Reno14 Edge 实报，多机型同族；诊断「LS 写入失败 QuotaExceededError」实锤）——holdIncomingCall 的 LS setItem 与 idbSet 同处一个 try，LS 配额满一抛整块中止、IDB 也不写＝后台只有通知没有挂起；且 resumeHeldCall 只读 LS、后台触发的来电（跨桌面/后台定时命中）重响从不补首发「打来了语音通话」系统消息。修复=①挂起双写拆开各吃各的 try，LS 失败 IDB 仍落；②resumeHeldCall 先读 LS 读不到再回读 IDB（holdBusy 防双处理）；③挂起携带 msg 已写标记，后台来电重响补首发系统消息 ====
  { name: '#406 挂起双写拆开（删则 LS 配额满一抛整块中止、IDB 也不写＝通知照发回前台什么也没有）', file: 'js/call.js', needle: 'window.idbSet(CALL_HOLD_KEY, h);' },
  { name: '#406 回前台/冷启动挂起回读 IDB 兜底（删则 LS 配额满时挂起只落 IDB、回前台读不到＝无弹窗也无未接）', file: 'js/call.js', needle: 'window.idbGet(CALL_HOLD_KEY)' },
  { name: '#406 后台来电重响补首发系统消息（删/改回 !isReplay 则后台触发来电聊天里永远没有来电系统消息）', file: 'js/call.js', needle: '(!isReplay || !msgWritten) && window.chatAddSystem' },
  // ==== 2026-09-13 #408 美化导入「解析失败」（IQOO Neo10 vivo 浏览器实报，多机型同族）——美化/聊天美化导入裸 JSON.parse(v.trim()) 一刀切，安卓各浏览器 ce-box 粘贴链路（nbsp/零宽字符/换行块）与聊天 App 转发链路（包裹说明文字/中文引号/全角标点/尾逗号）弄脏 JSON 即失败；#171 字卡导入已修同族，美化两处没跟。修复=personalize.js 全局自救解析器 mochiParsePastedJSON（隐形字符清洗→裁剪首{到末}→字符串外全角标点/尾逗号归一，只在真解析成功且为顶层对象时采用），两处导入接入 + 失败带真实报错并写 __jsErrors 诊断现场；聊天美化空文本静默 return 的「无反应」补提示 ====
  { name: '#408 粘贴导入 JSON 自救解析器（删则安卓各机型粘贴/转发弄脏的方案 JSON 直接解析失败）', file: 'js/personalize.js', needle: "new Error('不是有效的方案 JSON')" },
  { name: '#408 桌面美化导入接入自救解析+诊断现场（删则报障只见「解析失败」无真因）', file: 'js/personalize.js', needle: "'[美化导入] '" },
  { name: '#408 聊天美化导入接入自救解析+诊断现场+空文本提示（删则「无反应」与「解析失败」无真因）', file: 'js/chat-settings.js', needle: "'[聊天美化导入] '" },
  { name: '#401 后台通知正文令牌串→[图片]（删则含令牌消息的预览在通知栏直出乱码）', file: 'js/bg-keep.js', needle: "@@m:[0-9a-f]{32}/g, '[图片]')" },
  // ==== 2026-09-13 #411 卡顿自检 · 一键优化（只优化不删除；iPhone 15 Pro Max + Chrome 等多机型实测健康帧率仍报卡顿——诊断实锤主因是公用/专属字卡库单键可达 44MB，大库解析/按需取回是间歇冻结点。storage-slim 数据层分级 + 非破坏预热；personalize 设置行 + 启动大库主动弹；不碰不删任何用户数据，跨设备零语义变化）====
  { name: '#411 卡顿自检·分级判定器（mochiPerfLevel 纯函数，删则自检分级失效；44MB 字卡库是 iOS/安卓间歇卡顿主因）', file: 'js/storage-slim.js', needle: 'window.mochiPerfLevel = function (totalBytes, bigGroups) {' },
  { name: '#411 卡顿自愈·非破坏预热（mochiPerfHeal 取回挂起大键库+预热令牌化回复池；只优化不删除，删则「一键优化」空转）', file: 'js/storage-slim.js', needle: 'window.mochiPerfHeal = function (prog) {' },
  { name: '#411 卡顿自检设置行入口（row-perf-optimize 锚点；删则设置页无「一键优化」入口）', file: 'template.html', needle: 'id="row-perf-optimize"' },
  { name: '#411 自检·仅大库才主动弹提示（v3.26.x 口径演进=#452：启动分级改 __big-idx 尺寸门控 mochiPerfLevel(totalBytes,bigGroups)！==重，全量 mochiCcSlimScan 移交设置行主动扫；旧锚 if (agg.level!==重) 随全量扫描收口移除；删则轻/中库也弹=骚扰复发）', file: 'js/personalize.js', needle: "window.mochiPerfLevel(totalBytes, bigGroups) !== '重'" },
  { name: '#402 缺失令牌占位换内联 SVG（删则令牌 src 被当相对 URL 请求 404＝iOS 裂图问号黑块）', file: 'js/media-pool.js', needle: 'const MISS_PLACEHOLDER' },
  // ==== 2026-09-13 #412 情绪链/局部撤回 null 守卫（荣耀畅玩40 Plus 夸克等多机型「跳转个人聊天卡屏」报障，诊断 page-chat 反复
  //      「Cannot read properties of null (reading 'querySelector')」——m 由 addRec 返回，实时去重命中时返回 null，
  //      定时器触发对 null 调 querySelector/dataset 即崩；补 !m 守卫，防 m 为 null 的崩溃面）====
  { name: '#412 情绪链渲染 null 守卫（m 为 null 时不再 querySelector；删则 page-chat 崩溃回归）', file: 'js/chat.js', needle: "if (!sameCid() || !m) return;\nconst bm = m.querySelector('.msg-bubble');" },
  { name: '#412 局部撤回 null 守卫（m 为 null 时不再读 dataset；删则同源崩溃回归）', file: 'js/chat.js', needle: "if (!sameCid() || !m) return;\npartialRetractMsg(m, 'in');" },
  // ==== 2026-09-13 #413 可清理空间 · 同域其他站点数据（ml2_* 等非本项目键占满 localStorage 配额，用户报障多机型
  //      同现；设置→查看存储→可清理空间加「同域其他站点数据」行，列出非 xy-home-v2: 前缀键并一键清理，
  //      只删其他站点键、不碰本应用任何数据）====
  { name: '#413 同域其他站点数据清理入口（row 锚点；删则设置→查看存储无「同域其他站点数据」行，无法一键清 ml2_*）', file: 'template.html', needle: 'id="st-slim-other"' },
  { name: '#413 同域其他站点数据扫描+一键清理（scanOtherLS/renderOtherSlim；删则无法按前缀安全清理外来键）', file: 'js/personalize.js', needle: "function scanOtherLS() {" },
  // ==== 2026-09-13 #414 网易云分享短链 163cn.tv 导入即全部"播放失败"（vivo iQOO Z11 Edge 实报，多机型同现）——分享短链 URL 里没有歌曲数字 ID，数字藏在 302 重定向后的 music.163.com 页面里，extractNeteaseSongId 认不出、被当普通直链入库→audio.src 指向 HTML 跳转页而非音频→全失败。修复=只认官方短链宿主 163cn.tv，用 CORS 代理跟随跳转取回最终页面正则抠出 song ID，best-effort 静默回退（任何一步失败原样保留、绝不误改已有可播链接）；接入「链接添加 / 批量导入」两个入口 + 播放时刻对存量短链曲目再解析一次 ====
  { name: '#414 163cn.tv 短链宿主识别（删正则则短链又被当普通直链、播放时绕开解析→播放失败复发）', file: 'js/music-player.js', needle: "return /(?:^|[\\s/])163cn\\.tv\\/[\\w-]+/i" },
  { name: '#414 短链解析核心（resolveNetShortLink 跟随 302/API 代理取回 song ID；删函数则主源拿不到 ID、存量短链曲目播放再也不解析）', file: 'js/music-player.js', needle: 'function resolveNetShortLink(ln, cb) {' },
  { name: '#403 桌面弹窗清洗链补令牌（删则弹窗横幅直出 @@m:hash 乱码）', file: 'js/chat.js', needle: "if (t.indexOf('@@m:') >= 0) t = t.replace(/@@m:[0-9a-f]{32}/g, '[图片]');" },
  { name: '#403 信箱弹窗正文剥令牌/附件（删则信件通知横幅直出乱码）', file: 'js/mail.js', needle: "给你寄来了一封信：' + String(content" },
  { name: '#415 查看存储·扫描字卡分组后长文本不超屏（.storage-row span 允许在自身宽度内折行；删则分组名/多库合计长文本又顶出屏幕）', file: 'css/setting.css', needle: '.storage-row span { flex:1 1 auto; min-width:0; overflow-wrap:anywhere; }' },
  { name: '#415 查看存储·扫描结果体积列右对齐可折行（.storage-row b 同族；删则多库合计长文本整行不折又超屏）', file: 'css/setting.css', needle: '.storage-row b { font-weight:600; font-size:12.5px; text-align:right; flex:1 1 auto; min-width:0; overflow-wrap:anywhere; }' },
  { name: '#415b 压缩图片·压缩后字卡库缓存强制重载（删则压缩写回后本会话聊天回复池/字卡管理页继续发旧图）', file: 'js/chatcard.js', needle: 'window.ccReloadGroupsAfterExternalWrite = function () {' },
  { name: '#415b 压缩图片·压缩前弹窗提醒先导出备份（删则压缩覆盖原图无提示，用户无备份意识）', file: 'js/img-compress.js', needle: '压缩会覆盖原图（替换成更小的版本），原图不留底、不可撤销' },
  // ==== 2026-09-14 图片丢失核对（OPPO Find X9/Edge 实报「图片显示异常」，其他设备型号也有；诊断实证媒体池空、
  //      聊天全是 @@m: 令牌→渲染占位「媒体数据缺失，可用数据备份重新导入恢复」。代码面防线已齐
  //      （#275 备份不带池不剥值 / #387 公用库写回堵口 / #397/#402 占位与自愈 / #186 写池回滚 / #118 导入保留旧键），
  //      缺的是「帮用户分辨是备份没带池还是链路没写回」的核对入口——新增 mochiMediaCoverage 只读核对 +
  //      查看存储页「核对图片是否齐全」按钮，引用数>池内数=备份没带图需源头重导完整备份，两边相等=数据链完好自愈）====
  { name: '#419 图片核对核心（mochiMediaCoverage 比对引用令牌数 vs 池内条数；删则用户无从分辨「图片丢失」是备份没带图还是链路没写回）', file: 'js/media-pool.js', needle: 'window.mochiMediaCoverage = function () {' },
  { name: '#419 查看存储·图片核对按钮（锚点；删则用户没有入口验证图片缺失原因）', file: 'template.html', needle: 'id="st-media-cov-btn"' },
  // ==== 2026-09-13 #423 媒体池一键重建（图片自愈）（红米 K80 Chrome 报「字卡库纯白/表情包/聊天/头像图全不显示」，
  //      其他手机同现；#275 实锤空池条目随完整备份跨设备传播、重导完整备份也救不回。池是内容寻址
  //      （令牌=SHA-256(dataURL)），本机任何键里幸存的同一张原图都能按哈希补池自愈——新增
  //      mochiMediaRebuild 只补缺失/空串条目、绝不覆盖有效池值、绝不删除任何数据）====
  { name: '#423 媒体池重建核心（mochiMediaRebuild 扫描本机存留原图按哈希补池；删则「图片丢失」设备永远只能靠源头完整备份、本机幸存副本全浪费）', file: 'js/media-pool.js', needle: 'window.mochiMediaRebuild = function () {' },
  { name: '#423 查看存储·重建媒体池按钮（锚点；删则用户没有重建入口）', file: 'template.html', needle: 'id="st-media-rebuild-btn"' },
  { name: '#423 重建按钮接线（personalize 确认弹窗+结果报告；删则按钮无功能）', file: 'js/personalize.js', needle: '开始重建' },
  { name: '#423 聊天图片丢失占位指向重建入口（删则用户只被告知「导入备份」而不知道本机可先重建自愈）', file: 'js/chat.js', needle: '可到设置→查看存储→媒体池' },
  { name: '#423 诊断·媒体池条目数（旧大键明细候选清单不含 media: 键，报障诊断无法判断池是否存在；删则图片丢失类报障继续失明）', file: 'js/device.js', needle: '媒体池条目' },
  // ==== 2026-09-13 #424 媒体池自动体检+主动弹窗一键修复（用户要求「不能自己识别异常弹窗叫我修复吗」；
  //      就绪+splash 移除+可见空闲后自动跑只读 coverage，missing>0 弹「一键修复」，24h 节流+72h 免打扰）====
  { name: '#424 自动体检核心（mochiMediaAutoCheck 覆盖→弹窗→重建链路；删则用户仍须自己找设置入口，「图片丢失」状态无人主动干预）', file: 'js/media-pool.js', needle: 'window.mochiMediaAutoCheck = function () {' },
  { name: '#424 体检节流状态键（media-auto-check 进 contacts EXCLUDE；删则全局根键被 migrateLegacy 迁进 default 删根键，节流失效反复弹窗）', file: 'js/contacts.js', needle: "'media-auto-check'," },
  { name: '#424 主动弹窗一键修复入口（missing>0 弹「一键修复」；删则自动体检退化成纯扫描、修不了）', file: 'js/media-pool.js', needle: '一键修复' },
  // ==== 2026-09-14 #439 图片丢失占位池权威判定+占位自愈（红米K80 Chrome 报「图片依旧说丢失…不要覆盖修改导致不同机型反复」，多机型同族：
  //      ①令牌 src 404 只是浏览器把令牌当 URL 请求的噪音，旧逻辑 1.5s 超时即把 img 换文字占位＝观察器取回慢/#397 限流时误杀；
  //      ②占位替换后 #423 重建自愈只重写 img[src^=@@m:] 摸不到占位＝「点了重建还是丢失」。
  //      配套 #440：导入时 idbListKeys 读不到曾按「无需保留」照常 clear＝「只备份文字」导入把媒体池整池抹掉的传播口子）====
  { name: '#439 占位池权威判定（轮询确认缺失 mochiMediaTokenMissing 才换占位；删则池取回慢/限流时被误杀成「图片丢失」复发）', file: 'js/chat.js', needle: 'window.mochiMediaTokenMissing && window.mochiMediaTokenMissing(s)' },
  { name: '#439 占位登记自愈（池补回后 mochiMediaPhRestore 原位换回真图；删则「点了重建媒体池还是丢失」复发）', file: 'js/media-pool.js', needle: 'window.mochiMediaPhRestore = function' },
  { name: '#440 导入清单未知即中止（idbListKeys 失败/retain 值读失败 abort 走既有回滚，不再按「无需保留」clear；删则「只备份文字」导入把媒体池整池抹掉＝图片丢失跨设备扩散口子复发）', file: 'js/data-backup.js', needle: 'if (kept && kept.abort) { resolve(false); return; }' },
  // ==== 2026-09-14 #442 媒体池核对/重建「大库冻结=点了没反应」（红米K80 实报：设置→查看存储→媒体池两按钮点击无反应、
  //      也无成功/失败提示弹窗——chat-msgs 在 IDB 是数组直存（大桌面单键 40MB+），旧逻辑整包 JSON.stringify=几十秒
  //      长任务冻结主线程=页面假死零进度；锁屏/切后台页面被杀=扫描永不完成=永远等不到弹窗；且三按钮 .catch 静默无提示）====
  { name: '#442 核对逐条分扫（数组直存键不再整包 stringify 冻结主线程；删则大库核对/孤儿扫描继续假死「点了没反应」）', file: 'js/media-pool.js', needle: 'if (s) scanTokens(s);' },
  { name: '#442 孤儿扫描同款分扫+保守中止（单条序列化失败整次放弃不删；删则大库 GC 继续假死）', file: 'js/media-pool.js', needle: 'if (s) scanKeep(s);' },
  { name: '#442 重建三阶段进度回传+批间让出（池体检/扫副本/哈希；删则重建继续无反馈假死）', file: 'js/media-pool.js', needle: "prog(i, srcKeys.length, '扫描本机副本')" },
  { name: '#442 核对按钮实时进度接线（personalize；删则用户看不到进度以为没反应）', file: 'js/personalize.js', needle: 'window.mochiMediaCoverage(function (done, total, label)' },
  { name: '#442 按钮异常静默改弹窗（核对/重建失败必提示；删则「失败也没提示」复发）', file: 'js/personalize.js', needle: '媒体池重建中途出错，没有改动任何数据' },
  // ==== 2026-09-13 #425 头像启动间歇性不显示（华为畅享70Pro/红米K80 等多机型「刚点进网站头像时不时加载不出来」：
  //      cs-avatar-* 大图键常驻 IDB-only 区，avatar-lib 收敛基线在 idbRestore 回填前初始化读空被污染，
  //      回填完成的 restore-done 只刷桌面圈/聊天顶栏，convergeAvatars 因基线相等永不触发 → 气泡头像一直空）====
  { name: '#425 头像收敛挂钩回填完成（restore-done 清基线强制 convergeAvatars 重刷；删则晚到回填后气泡头像停留占位，基线污染永久跳过）——构建者收口修正：原 needle 带 4 空格缩进多行形态，minifyJs 剥行首缩进后永不匹配产物（2026-09-13 首次构建即红实锤），改单行逻辑锚点，同一语句', file: 'js/avatar-lib.js', needle: 'appliedPh = null; appliedUh = null;' },
  // ==== 2026-09-13 #426 日历留言乱码（OPPO Reno6/雨见浏览器报「日记留言应该只能用文字字卡，乱码是图片」，多机型同族；
  //      #388 只守了自定义字卡循环、默认主字卡循环漏过滤，贴纸/语音默认卡的「名称|||@@m:hash」拼进留言持久化成乱码；
  //      且 #388 前已落盘的存量留言渲染直出令牌）====
  { name: '#426 日历留言纯文字选卡过滤（calTextOnly 收敛两循环口径含裸令牌混排；删则媒体令牌卡继续进每日留言池持久化成乱码）', file: 'js/calendar.js', needle: 'function calTextOnly(c) {' },
  { name: '#426 日历留言渲染端令牌清洗（calCleanMsg 剥存量落盘留言的 @@m:/dataURL 成 [图片]；删则 #388 前生成的历史留言永远直出乱码）', file: 'js/calendar.js', needle: ".replace(/@@m:[0-9a-f]{32}/g, '[图片]')" },
  // ==== 2026-09-13 #429 信件乱码（OPPO Reno16 Via/Edge 报「信件乱码＝联系人字卡库图片令牌」，多机型同族 #426；
  //      mailCardPool 默认主字卡三循环零过滤、自定义循环 mochiMediaIsToken 全串锚定测不出裸令牌混排，
  //      贴纸/语音默认卡「名称|||@@m:hash/名称|||data:」拼进信件持久化；渲染端不剥「名称|||」残留与 audio base64）====
  { name: '#429 信件纯文字选卡过滤（mailTextOnly 收敛自定义+默认三循环口径含裸令牌混排；删则媒体令牌卡继续进信件池持久化成乱码）', file: 'js/mail.js', needle: 'function mailTextOnly(c) {' },
  { name: '#429 信件渲染端清洗（mailCleanDisplay 剥存量落盘信件的「名称|||」残留与非图片 base64；删则历史信件直出乱码/巨型 base64 文本）', file: 'js/mail.js', needle: ".replace(/[^\\s|]{0,40}\\|\\|\\|/g, '')" },
  // ==== 2026-09-14 #433 保活 WebRTC 锚点启动阻塞主线程（vivo Y78 自带浏览器报「一进网站就非常卡」，
  //      实测帧率 2fps、每 ~2.2s 一个 2.1~2.4s 长任务，多机型同现；无头 CPU 采样探针实锤
  //      new RTCPeerConnection() 单次构造 6x 节流桌面核阻塞 ~1.5s，低端安卓核放大到 2s+：
  //      #260 同步建一对＝开屏路径叠加秒级长任务，瞬态 disconnected 立即拆+30s 固定重建＝抖动机型反复卡；
  //      修复=启动 10s 延迟建锚+断连 8s 自愈观察窗+重建指数退避 30s→15min 封顶，锚点能力不删）====
  { name: '#433 保活 WebRTC 延迟建锚（deferred 闸 keepEnabled+hidden 跳过；删则退回开屏同步构造＝低端机一进网站秒级卡死复发）', file: 'js/bg-keep.js', needle: 'if (!keepEnabled || kaPc1 || kaPc2) return;' },
  { name: '#433 保活 WebRTC 重建指数退避（30s 起步 900000 封顶；删则抖动机型每 30s 付一次秒级构造成本反复卡）', file: 'js/bg-keep.js', needle: 'kaWebrtcRebuildDelay = kaWebrtcRebuildDelay ? Math.min(kaWebrtcRebuildDelay * 2, 900000) : 30000;' },
  { name: '#433 保活 WebRTC 断连 8s 自愈观察窗（disconnected 先观察再拆；删则 ICE 例行重连被当死亡立即重建＝无谓长任务）', file: 'js/bg-keep.js', needle: 'kaWebrtcDiscTimer = setTimeout(function () {' },
  // ==== 2026-09-14 #436 后台发热减负（用户报「浏览器挂网页在后台手机非常烫」）：保活音频豁免让全站
  //      定时器后台不节流＝保活的设计成本；两个纯浪费源一并掐掉——①pwa.js 版本轮询后台照跑＝每 15s
  //      一次 version.json 网络请求整夜唤醒射频；②bg-keep.js WebRTC 重建定时器漏后台守卫＝隐藏态
  //      秒级构造长任务（#433 实锤）+ 回环锚点 consent 包常驻射频。回前台均有兜底（visibilitychange
  //      即时检查 / healKeepAlive 补建），冻结防线零回退。注：#435 已被并行会话表情面板预热批次占用）====
  { name: '#436 版本轮询后台跳过（hidden 直接 return；删则后台每 15s fetch version.json 唤醒射频＝整夜发热耗电）', file: 'js/pwa.js', needle: "if (document.visibilityState !== 'visible') return;" },
  { name: '#436 WebRTC 重建后台跳过（heal 回前台兜底补建；删则隐藏态反复秒级构造长任务+锚点 consent 包常驻射频发热）', file: 'js/bg-keep.js', needle: 'if (!keepEnabled || document.hidden) return;' },
  // ==== 2026-09-13 #427 小游戏全屏抗键盘停靠内联残留 + 兄弟互斥零盒误关（vivo S60 自带浏览器报
  //      「五子棋点全屏自动回退聊天、刷新网页才能再次打开」，用户明说其他机型也有：kbDockPanels 给面板写
  //      内联 position:absolute/bottom/left/right/top/max-height，国产内核 vv 收起事件不可靠时 kbUndockPanels
  //      不执行 → 内联残留压过 .game-fs/pong-fs/snake-fs/brick-fs 规则、⛶ 全屏坏；改 !important 四长手只压
  //      停靠内联属性（停靠语义不变）+ inset 改长手兼容 Chromium<87 老内核 + gomoku 兄弟互斥只认真可见面板）====
  { name: '#427 共享全屏规则抗内联残留（.poke-card.game-fs !important 定位；删则键盘停靠内联残留把全屏面板钉回底半框，「点全屏没反应/自动回退/刷新才恢复」跨机型复发，波及 8 游戏+猜拳）', file: 'css/chat-pages.css', needle: '.poke-card.game-fs { position:fixed !important;' },
  { name: '#427 Pong 全屏同族抗内联残留（删则同 #427 在 Pong 复发）', file: 'css/chat-pages.css', needle: '#chat-pong-panel.pong-fs { position:fixed !important;' },
  { name: '#427 打砖块全屏同族抗内联残留（删则同 #427 在打砖块复发）', file: 'css/chat-pages.css', needle: '#chat-brick-panel.brick-fs { position:fixed !important;' },
  { name: '#427 贪吃蛇全屏同族抗内联残留（删则同 #427 在贪吃蛇复发）', file: 'css/chat-pages.css', needle: '#chat-snake-panel.snake-fs { position:fixed !important;' },
  { name: '#427 五子棋兄弟互斥只认真可见面板（hidden=false 但零渲染盒＝残留态不触发误关；删则残留兄弟把刚打开的棋盘反复自动关掉＝「打开就消失回聊天、刷新才恢复」）', file: 'js/gomoku.js', needle: 'getClientRects().length > 0) { closePanel(); break; }' },
  // ==== 2026-09-13 #428 寻踪「看看TA在哪」全屏位置面板抬到提醒条之上（vivo S60 等多机型报「点看看ta在哪
  //      页面卡死，只能退出刷新」：面板 z-78 低于顶部提醒条 z-998，备份提醒显形期间（距上次导出超 1 天即弹、
  //      #355 收短后极常见）正好压住头部返回按钮＝面板关不掉+body 滚动锁＝整页像卡死；z 抬 9999，
  //      仍低于 modal-mask 99999 / 应用锁 999999）====
  { name: '#428 全屏位置面板盖过提醒条（.loc-panel.loc-full z-9999；删则备份提醒条压住返回按钮，「看看TA在哪」全屏面板关不掉像卡死，多机型复发）', file: 'css/chat-pages.css', needle: 'background:#fff; z-index:9999;' },
  { name: '#416 单聊回钉只认真的贴到底（chatAtBottom 距最大 scrollTop ≤8px；删则旧 120px 容差又把「上翻读最新一条停下/轻点」当回钉、每次点滑动被拽回最底复发）', file: 'js/chat.js', needle: 'return cb.scrollHeight - cb.scrollTop - cb.clientHeight <= 8;' },
  { name: '#416 群聊解除接管只认真的贴到底（gcAtBottom 同 ≤8px 口径；删则旧 150px 容差让滚动手势第一个 scroll 事件就清掉接管、下一条成员回复把历史阅读拽回最底复发）', file: 'js/group-chat.js', needle: 'return body.scrollHeight - body.scrollTop - body.clientHeight <= 8;' },
  { name: '#416 群聊滚回贴底检测必须停稳（gcScrollTimer 120ms 防手势中第一个 scroll 事件误清接管；删则「每次点滑动被拽回最底」随下一条回复复发）', file: 'js/group-chat.js', needle: 'gcScrollTimer = setTimeout(() => {' },
  { name: '#418 屏幕适配自动监视·开屏未进入/数据未就绪跳过采集（sdTick 守卫；删则开屏加载期 inner 短报瞬态刷「底部少填/顶部重叠」假阳性污染错误环+反复强制重排，iPhone13 Safari「总卡卡/开屏划不动」复发）', file: 'js/device.js', needle: "_splash && !_splash.classList.contains('hide')" },
  // ==== 2026-09-14 #430 群聊大键口径对齐聊天页（存储优化：大群聊整包 stringify 堆尖峰族 + lite 快照被迁移覆盖丢数据族）====
  { name: '#430 群聊大键阈值分支（>3MB structured clone 数组直存、失败回退字符串；删则大群聊回退整包 stringify＝堆尖峰/秒级阻塞族复发）', file: 'js/group-chat.js', needle: 'gcMsgsBytes(msgs) <= GC_STR_THRESHOLD' },
  { name: '#430 群聊键排除 LS→IDB 大键迁移（删则 lite 快照被无条件 idbSet 覆盖数组权威＝老消息永久剥坏且 LS 兜底同没了）', file: 'js/idb.js', needle: 'if (isGroupMsgsKey(k)) continue;' },
  { name: '#430 群聊键排除启动回填（删则数组直存值回填时整包 JSON.stringify＝启动堆尖峰+memoryCache 死驻留）', file: 'js/idb.js', needle: '!isGroupMsgsKey(k) &&' },
  // ==== 2026-09-14 #431 压缩照片类 WebP 档（存储优化：同质量比 JPEG 再省约 25~50%）====
  // ==== 2026-09-14 #432 词典拼字「词典分类被关」永久误报（iQOO12Pro/Via 报「词典分类被关但什么都打开了、二级密码已解锁」，用户明说其他机型也有：dc-cat-dict 是词典独立成页前的遗留分类开关键，现行版本无任何写入 UI，老用户存量 '0' 让自检闸②与拼字抽卡池永久误杀且无处打开，纯数据态与机型无关；修复=删除两处 dc-cat-dict 读取（词典启用由 dict-use/dict-overall/dc-off-dict 负责）+ default-cards.js 启动清除全部命名空间残留键 LS+IDB 幂等）====
  { name: '#432 遗留 dc-cat-dict 残留键启动清除（LS+IDB 全命名空间幂等；删则老用户存量 0 被 idbRestore 每次开屏回填，词典拼字永久误报「词典分类被关」）', file: 'js/default-cards.js', needle: '/^xy-home-v2:(?:[^:]+:)?dc-cat-dict$/' },
  // ==== 2026-09-14 #434 表情包添加后退出浏览器重进丢失（荣耀10/Edge 报「添加表情包退出再进数据没了」多机型同发，已关自动清数据；根因=idb.js #82/#88/#226/#229 Edge 杀进程回滚最近未落盘提交 + 挂起内核 IDB 事务偶发不提交，WRJ 写日志只护 ≤64KB 小键、表情包媒体键不在保护范围，xyStore.set 的 IDB 写 fire-and-forget 无落盘确认；修复=保存后 idbSet 结果作持久性信号失败退避重发+离页/回前台补写+穷尽明确提示，myeSave 闸门取回失败不再静默丢、字卡库大值(>200KB IDB-only)同款确认）====
  { name: '#434 我的表情包落盘确认重发（idbSet 结果作持久性信号+退避重试；删则 Edge 杀进程回滚+IDB 挂起时添加的表情无任何持久副本，「加完退出重进全丢」复发）', file: 'js/chat.js', needle: 'window.idbSet(MYE_KEY(), json).then(ok =>' },
  { name: '#434 我的表情包闸门取回失败不再静默丢（退避重走保存链；删则 IDB 挂起窗口内添加的表情静默蒸发且无提示）', file: 'js/chat.js', needle: 'setTimeout(myEmojiSave, 1500 * myeGateRetry)' },
  { name: '#434 我的表情包离页/回前台补写闸（myeDurableFlush 单口；删则穷尽失败后回前台无人补发＝补写链断）', file: 'js/chat.js', needle: 'function myeDurableFlush() { if (myeDurablePending) myeEnsureDurable(0); }' },
  { name: '#434 字卡库大值落盘确认（>200KB IDB-only 才确认，小值仍走 LS+WRJ 双防线不多付全库事务；删则字卡库表情包/图片同族「加完退出重进丢」复发）', file: 'js/chatcard.js', needle: 'ccJson.length > 200 * 1024) ccEnsureDurable(0);' },
  { name: '#434 字卡库离页补写接 flushCcSave（ccDurablePending；删则 flushCcSave 只认 ccDirty、上一轮失败挂起的补发无人再发）', file: 'js/chatcard.js', needle: 'if (ccDurablePending) ccEnsureDurable(0);' },
  // ==== 2026-09-14 #435 表情包面板图片「加载很慢/迟迟不显示」（多机型同发，上一轮 v3.42.x 懒加载后仍现；
  // 根因①rootMargin 300px 按字卡库近全屏列表定、面板滚动区仅 max-height:40vh——上下各 300px 外扩后触发
  // 窗口≈3 屏，打开分组瞬间 40+ 张图同时补 src 进解码管线＝主线程长任务接连图反而迟迟画不出，且面板 img
  // 漏了 decoding=async（字卡库一直有）；②TA/公用大库令牌卡 @@m:hash 走观察器逐图 miss 读 IDB（8 并发排队）
  // →重写→再解码五段异步串行＝冷启动慢上加慢。修复=懒加载窗口收窄 120px+IO 触发改 50ms 泵式每批 4 张补
  // src 让出主线程+img 统一创建补 decoding=async+组内令牌渲染后交 media-pool 批量预热（idbGetMany 每批 8
  // 批间让出，map 命中后观察器同步重写；warmSeen 会话内去重+inflight 互斥防双读））====
  { name: '#435 面板懒加载窗口收窄（120px 按面板 40vh 容器定；删则回退 300px＝打开分组 40+ 张图同帧全触发，解码风暴「图迟迟不显示」复发）', file: 'js/chat.js', needle: "rootMargin: '120px 0px'" },
  { name: '#435 懒加载泵式分批补 src（队列非空 50ms 续泵每批 4 张；删则 IO 回调一次性全量补 src＝低端机解码长任务接连、先到图也被压住不显示）', file: 'js/chat.js', needle: 'if (emojiLazyQueue.length && emojiImgObserver) emojiLazyT = setTimeout(emojiLazyPump, 50);' },
  { name: '#435 面板 img 统一创建补 decoding=async（emojiNewImg；删则大 dataURL 解码阻塞渲染帧＝图慢半拍复发，字卡库同款属性面板漏配）', file: 'js/chat.js', needle: "img.decoding = 'async';" },
  { name: '#435 组内令牌收集预热（只收 @@m: 令牌交 mochiMediaWarmTokens；删则令牌卡回退逐图 miss 读排队＝冷启动面板图慢半拍）', file: 'js/chat.js', needle: "s.indexOf('@@m:') === 0) toks.push(s.slice(4));" },
  { name: '#435 媒体池令牌批量预热接口（mochiMediaWarmTokens idbGetMany 每批 8 批间让出+inflight 互斥；删则预热无人接=面板令牌图五段异步串行慢加载复发）', file: 'js/media-pool.js', needle: 'window.mochiMediaWarmTokens = function (hashes) {' },
  // ==== 2026-09-14 #457 表情面板每次打开图片重载（多机型同发，用户明说其他设备型号也有）：
  // 根因=renderEmojiPanel 无条件 innerHTML='' 重建全部 img，浏览器对新建 img 必重新解码
  // dataURL/重请求令牌图，即使内容与上次完全相同。打开→关闭→再打开同一分组每次都重载。
  // 修复=内容指纹短路（mode/分组/张数/内容签名/batch/hs/联系人名），与上次成功渲染一致且
  // DOM 仍在→跳过重建复用现有 img（零机型分支，懒加载/预热/批量管理能力不删）====
  { name: '#457 面板内容指纹短路判定（_sigTarget===emojiRenderSig 且 DOM 仍在则跳过重建；删/改则回退每次开面板全量重建 img＝图片每次重载复发，多机型同发）', file: 'js/chat.js', needle: 'if (_sigTarget && _sigTarget === emojiRenderSig && emojiList.firstElementChild) return;' },
  { name: '#457 面板内容指纹目标计算函数（emojiRenderSigTarget 算 mode/分组/张数/首尾src/sumLen 签名；删则短路无指纹可比＝回退全量重建）', file: 'js/chat.js', needle: 'function emojiRenderSigTarget(hts, pn)' },
  // ==== #441 跨桌面通话记录串/消失（用户报「跨桌面打电话联系人的通话记录会串，没有显示实际联系人的电话」「跨桌面通话记录不会记录，会消失」+「接电话后跳转到当前联系人桌面」要写清是刻意设计。根因：①records.js 各渲染点只读桌面键 lbl-partner 取显示名——联系人管理新建、从未改昵称的联系人该键为空，主页通话/换头像/抓包/心意币/关心全部显示「TA」，多联系人分不清记录是谁的；记录数据本身按桌面命名空间隔离无串写（实测 A 去电通话中切 B 再挂断→记录落 A、B 为空；跨桌面来电接听挂断→记录落 B）；②跨桌面来电弹窗「稍后」与「弹窗被顶未应答」只标 seen 零记录＝无声消失；③接听先挂断进行中通话的文案承诺从未实现，currentCall 占用时点接听无反应；④功能说明「不会跳到对方的桌面」与实际（先切归属桌面再响铃）相反）====
  { name: '#441 主页记录显示名走完整取名链（dispName：cs-lbl-partner→lbl-partner→联系人名片名→TA；删则回退只读 lbl-partner，新联系人全显示 TA＝通话记录看不出是谁的）', file: 'js/records.js', needle: "store.get('cs-lbl-partner')" },
  { name: '#441 跨桌面来电稍后补记未接（callRecordMissed 复用 notifyCallEnd 落归属桌面；删则点稍后只标 seen，通话记录无声消失）', file: 'js/incoming-requests.js', needle: "if (req.kind === 'call' && window.callRecordMissed) window.callRecordMissed(req.cid, cName(req.cid));" },
  { name: '#441 弹窗被顶/未应答释放来电补记未接（wasCall+setStatus 命中才记，幂等；删则弹窗被顶/跨会话孤儿来电零留痕）', file: 'js/incoming-requests.js', needle: 'if (wasCall && window.callRecordMissed) window.callRecordMissed(cid, cName(cid));' },
  { name: '#441 跨会话孤儿来电自愈补记未接（queue() TTL 释放点；删则刷新/杀进程时未应答的来电弹窗随会话蒸发零留痕）', file: 'js/incoming-requests.js', needle: "if (x.kind === 'call' && window.callRecordMissed) { try { window.callRecordMissed(x.cid, cName(x.cid)); } catch (e) {} }" },
  { name: '#441 未接补记写手（call.js callRecordMissed→notifyCallEnd：系统消息+记录都落归属桌面；删则 incoming-requests 调用落空）', file: 'js/call.js', needle: 'window.callRecordMissed = function (cid, name)' },
  { name: '#441 接听跨桌面来电先挂断进行中通话（文案承诺；删则 currentCall 占用时点接听无反应、来电静默丢失）', file: 'js/incoming-requests.js', needle: 'if (window.getCallState && window.getCallState() && window.hangupCall) window.hangupCall();' },
  { name: '#448 跨桌面来电默认关闭（deskCallEn 未存键返回 false 需手动开启；删则回退默认开＝用户点名「默认关闭」静默失效，存量显式开/关不受影响）', file: 'js/incoming-requests.js', needle: "if (v === null || v === undefined || v === '') return false; // 默认关" },
  // ==== #442 iOS「左右滑动卡 + 总是自动刷新重进」多机型（iPhone 15 Pro Max via 诊断实锤
  //      default:cc-groups 单键 153MB + cc-groups-public 90MB；#377 公用库 OOM 家族专属库面：
  //      专属库裸 parse 无令牌化、编辑树 groups 开机常驻、去重任务双库同 parse、面板/搜索/角标
  //      反复全量 parse＝jetsam 反复杀页面）====
  { name: '#455 专属库池视图令牌化（ownPoolRaw 构建后即交 ccTokenizeGiantMedia；删则 153MB 级专属库解析副本带 dataURL 常驻回复池＝iOS jetsam「自动刷新重进」OOM 家族专属库面复发）', file: 'js/chatcard.js', needle: "ccTokenizeGiantMedia(ownPoolCache, 'own');" },
  { name: '#455 回复池专属侧改走令牌化池视图（删则回退编辑树 groups 直入池＝大库 parse 树常驻+未令牌化卡回退）', file: 'js/chatcard.js', needle: 'return mergeFiltered(ownPoolRaw(), pubGroupsRaw());' },
  { name: '#455 挂起大键取回不再无条件载编辑树（管理页开着才载；删则聊天路径取回即全量 parse 153MB 级库并常驻＝开聊天即冻结/自动重载复发）', file: 'js/chatcard.js', needle: 'if (scopeLive && ccPageOpen()) {' },
  { name: '#455 离开字卡库页释放编辑树（删则一次开页后数百 MB parse 副本驻留到刷新＝内存永不回落复发）', file: 'js/chatcard.js', needle: "if (ccScope !== 'public') { groups = null; return; }" },
  { name: '#455 去重任务大库免解析预检（双侧合计>96MB 只记 mark 免读跳过；删则 90+153MB 双库整串读入+双 parse 在启动+30s 必现＝秒级长任务/OOM 复发）', file: 'js/chatcard.js', needle: 'pubRaw.length + ownLen > DD_PARSE_LIMIT' },
  { name: '#455 表情包面板专属分区走令牌化池视图（删则回退每次开面板全量 parse 大库＝开面板秒级冻结/左右滑动卡复发）', file: 'js/chatcard.js', needle: "(scope === 'public') ? pubGroupsRaw() : ownPoolRaw()" },
  { name: '#455 懒加载态拒绝空树整包写回（saveGroups/flushCcSave/ccEnsureDurable 判空收口；删则页外写入方拿空编辑树覆盖权威键＝字卡库整库清空复发，#193 同族）', file: 'js/chatcard.js', needle: "if (!groups) { ccDirty = false; return; }" },
  // ==== 2026-09-14 #456 启动恢复红包封面 out/in 双向 IDB 回灌（#454 遗留项源码实锤：恢复段占位符 RP_COVER_KEY 全 src 无定义，ReferenceError 被 try/catch 静默吞＝iOS 清存储后封面丢失无自愈；收口构建者按 #456 会话台账代办登记）====
  { name: '#456 红包封面启动恢复双向回灌（删则退回死段/静默失效＝iOS 系统级清存储后 rp-cover-out/in 丢失且无自愈路径复发）', file: 'js/chat.js', needle: "myPrefix + ':rp-cover-' + side" },
  // ==== 2026-09-14 #446 花园扩建改自愿+一键补种+养护减负（用户反馈「花园里不用一直扩建，建这么多养不过来」：
  //      ①等级自动送地改「开垦资格」手动开垦——plotN=已开垦数，load() 迁移按当前等级一次性补齐资格，存量玩家已有的地一块不少；
  //      ②升级里程碑跨 Lv3/5/8/12 各送 1 颗随机稀有种子，升级奖励与「要不要多地块」脱钩；
  //      ③浇水有效期 24h→36h（WATER_SEC）、凋谢宽限 48h→72h（WILT_SEC=259200）、新增温室装饰满保水；
  //      ④工具条「补种」空地按上次品种一键补齐（不消耗 rareInv 稀有库存））====
  { name: '#446 扩建改自愿·开垦资格到顶分支（plotN≥资格给提示弹窗；删则回退等级自动送地，「建这么多养不过来」复发）', file: 'js/garden.js', needle: 'if (cur >= ent) {' },
  { name: '#446 plotN 存量迁移（load 按当时等级一次性补齐资格＝老玩家已有的地不缩一块；删则存量玩家升级后地块被裁回 12 块）', file: 'js/garden.js', needle: 'd.plotN = PLOTS + (lv0 >= 3 ? 2 : 0)' },
  { name: '#446 里程碑奖励与地块脱钩（跨 Lv3/5/8/12 送稀有种子；删则「不开垦=亏升级奖励」的强制感回归）', file: 'js/garden.js', needle: 'msgs.push("🎁 里程碑奖励：稀有种子「"' },
  { name: '#446 一键补种（空地按上次品种补齐且不消耗稀有库存；删则 30 块地日常=逐块点种植，养护负担复发）', file: 'js/garden.js', needle: 'data.lastSeed && T[data.lastSeed] && !T[data.lastSeed].rare' },
  { name: '#446 浇水有效期 36h（waterLvl 分母 WATER_SEC；删则回退 24h 天天浇＝多地块高负担复发）', file: 'js/garden.js', needle: 'plot.watered) / WATER_SEC);' },
  { name: '#446 凋谢宽限 72h→#503 再放宽 96h（WILT_SEC=345600；删则回退收不及时就枯萎＝收花心意币钱损复发）', file: 'js/garden.js', needle: 'var WILT_SEC = 345600;' },
  // ==== #503 花园减负与 UI 重排（用户反馈「开垦的地太多太挤」：上限瘦身+手动缩地+空地折叠+日志全量+日志独立 tab）====
  { name: '#503 资格缩小不裁已有地（plotCount 去掉向下钳制＝老存档 plotN 高于新资格也一块不裁；改回钳制则上限瘦身后老玩家多种的花被静默删除）', file: 'js/garden.js', needle: 'return data.plotN || PLOTS;' },
  { name: '#503 手动缩地 shrinkPlots（只收尾部空地、下限 4 块、有花不裁；删则「开多了收不回」复发）', file: 'js/garden.js', needle: 'while (cur > MIN_PLOTS && !data.p[cur - 1]) cur--;' },
  { name: '#503 收地按钮登记（工具条 shrink；删则缩地无入口）', file: 'js/garden.js', needle: 'sb.dataset.tool = "shrink";' },
  { name: '#528 花园土地默认展开（#503 折叠改默认展开；改回 true 则土地又被默认收起＝用户反馈复发）', file: 'js/garden.js', needle: 'var emptyFolded = false;' },
  { name: '#528 空地折叠砖保留（默认展开时仍给「收起」入口；删则无法手动收起空地）', file: 'js/garden.js', needle: '(emptyFolded ? "点开" : "收起")' },
  { name: '#503 日志全量查看（默认 20 条+「查看全部」展开；删则联系人的打理记录看不全复发）', file: 'js/garden.js', needle: 'garden-log-toggle' },
  { name: '#503 日志容量 100→300（slice(-300)；改回 100 则老记录被挤掉复发）', file: 'js/garden.js', needle: 'if (data.l.length > 300) data.l = data.l.slice(-300);' },
  { name: '#503 日志独立 tab（garden-log 移入「日志」分区；删则日志又挤回花园页）', file: 'js/garden.js', needle: 'move("garden-log", "log");' },
  // ==== 2026-09-14 #450 收藏页「大量内容加载失败，只出现问号黑块」+图片显示异常（iPhone 15 Pro Max Chrome 等多机型；
  //      iOS 裂图=黑底问号块。根因：miss 读并发上限 MISS_READ_MAX=8，一屏令牌图超上限的部分当年拿不到读也不再被扫
  //      ——src 保持 @@m: 令牌＝浏览器当相对 URL 404＝裂图；原实现只在 DOM 再变更时才重扫，收藏列表翻到底不再动的
  //      静态页饿死图永久裂；另 idbGet 在 IDB 拥塞/内核挂起（#229 家族）时迟回不回＝槽位永久占满后续全饿死）====
  { name: '#450 miss 读重试泵（每次 miss 读结算防抖全文档补扫，上限饿死图逐波清零；删则收藏页等静态页超 MISS_READ_MAX 的令牌图永久保持 @@m: src=404 裂图＝iOS 问号黑块复发）', file: 'js/media-pool.js', needle: 'function missRetryPump() {' },
  { name: '#450 miss 读单飞结算+看门狗（槽位释放与结果处理解耦，双路只放行一次；删则 idbGet 挂起时槽位永久占满＝该哈希与后续读全部饿死成裂图，迟到结果双扣 missReads）', file: 'js/media-pool.js', needle: 'const __tokSettle = function () {' },
  // ==== 2026-09-14 #451 词典拼字/梦角自由造句「消息显示 A、引用预览显示 B」（iOS Chrome 等多机型同报：
  //      正文换血（rep.text=拼字/造句结果）后 parts 残留原回复——气泡渲染 parts 优先于 text（#202 混合消息链路），
  //      引用快照/收藏/回复引用读 text＝两轨不一致；创建侧同步重建+存量按来源 chip 归一化治愈）====
  { name: '#451 词典拼字正文换血同步重建 parts（文本段=最终正文+保留图片段；删则气泡渲染 parts 优先与引用/收藏读 text 两轨不一致＝「消息显示 A 引用预览显示 B」复发）', file: 'js/chat.js', needle: 'function spellPartsSync(text, prevParts) {' },
  { name: '#451 存量治愈（normCell 按来源 chip 识别换血旧消息，文本段≠正文时以正文重建 parts；删则历史词典拼字/梦角造句消息引用预览继续与气泡不一致）', file: 'js/chat.js', needle: "md.tag === '词典逐卡连发'" },
  // ==== 2026-09-14 #452 「每次打开都有自检和优化，点击之后再次打开仍然会有」+iOS 卡顿（iPhone 15 Pro Max Chrome；
  //      ①#411 免打扰标记裸 localStorage.setItem 在 LS 配额满（诊断 5.1MB 顶满 iOS 配额）时被 catch 吞=标记永远写不进
  //      =每次启动都弹；②启动主动扫描 mochiCcSlimScan 把 44.59MB 公用库整串读入堆+逐组 stringify（纯算字节）＝启动期
  //      秒级长任务/堆尖峰＝「一打开就卡/自动刷新重进」主力，且因①每次必付）====
  { name: '#452 优化免打扰标记 IDB 权威写+LS 兜底（裸 LS setItem 配额满被吞＝每次启动都弹「卡顿自检」；删则 LS 满设备提示循环复发）', file: 'js/personalize.js', needle: 'window.idbGet(PERF_REMIND_KEY)' },
  // ==== 2026-09-14 #453 消消乐模式拆分（用户点名「可选有道具的模式和默认简单模式没有道具」：头部 m3-mode 下拉按联系人
  //      记住 lastMode；简单=纯经典三消零道具（默认）；道具=经典消消乐道具集——四连直线→↔️/↕️清整行/整列、
  //      L/T 同色交叉（合计≥5格）→💥炸弹3×3、五连+→🌈彩虹（#301 炸弹/彩虹逻辑沿用）；随批 isRainbow 值域修正：
  //      直线道具 30+/40+ 也 ≥RAINBOW，裸 `>= RAINBOW` 判彩虹会把直线道具误当彩虹）====
  { name: '#453 消消乐道具模式门控（仅道具模式且交换首段消除才生成道具；删则简单模式也出道具＝「默认无道具」失效、或道具模式永远不出道具；2026-09-16 doSwap 快照守卫重构 st→s 随契约换锚，逻辑未变）', file: 'js/match3.js', needle: "chain === 1 && s.mode === 'item'" },
  { name: '#453 消消乐直线道具清列爆炸（↕️ 被消除清整列；删则纵向直线道具成摆设，姊妹锚 push([p[0], cc]) 守清行）', file: 'js/match3.js', needle: 'queue.push([rr, p[1]]);' },
  { name: '#453 消消乐直线道具清行爆炸（↔️ 被消除清整行；删则横向直线道具成摆设）', file: 'js/match3.js', needle: 'queue.push([p[0], cc]);' },
  { name: '#453 消消乐 L/T 同色交叉→炸弹（两道同色直线共享一格合计≥5格；删则 L/T 交叉退化普通三消＝经典消消乐包裹糖玩法丢失）', file: 'js/match3.js', needle: 'runs[i].len + runs[j].len - 1 >= 5' },
  // ==== 2026-09-15 #481 消消乐道具模式「消除后不变出道具」（多机型用户报：#301 taTurn 把 TA 出手风格写进 st.mode，
  //      与 #453 道具开关 st.mode('item'/'simple') 撞名——TA 第一次行动 st.mode 被覆写成 serious/normal/sandbag/blunder，
  //      此后道具门控 st.mode==='item' 永假；修复=出手风格改存独立字段 st.taMode）====
  { name: '#481 消消乐 TA 出手风格独立字段（删则 taTurn 把 st.mode 覆写成 serious/normal/sandbag/blunder、道具模式自 TA 首步起永远不再生成道具）', file: 'js/match3.js', needle: 'st.taMode = rollMode();' },
  // ==== 2026-09-15 #489 问问TA/邀请TA 回应落地时已切桌面＝回应被 sameCid() 取消，切回后卡片永远
  //      「等待 TA 回答/回应…」（用户报障：文字题联系人已回答，切桌面再切回变未回复）；修复=跨桌面
  //      补投递 chatDeskCardReply（按 ts 定位原桌面 pending 卡落 answered+补气泡）+ 发送时当场抽定
  //      回应内容（防异桌面抽错池）+ saveMsgsNow 即落盘 ====
  { name: '#489 问问TA切桌面跨桌面补投递调用（删则回应落地时已切桌面即被 sameCid 取消，切回永远未回复）', file: 'js/chat.js', needle: "window.chatDeskCardReply(myCid, 'ask', askRecTs, 'askStatus'" },
  { name: '#489 邀请TA切桌面跨桌面补投递调用（同 #489 邀请路径；删则邀请决定落地时已切桌面即永久丢失）', file: 'js/chat.js', needle: "window.chatDeskCardReply(myCid, 'invite', inviteRecTs, 'inviteStatus'" },
  { name: '#489 补投递按 ts 定位 pending 卡幂等闸（删则可能重复落回答/给已答卡补气泡）', file: 'js/chat.js', needle: 'r.ts === cardTs && !r.retracted) { hit = r; break; }' },
  { name: '#489 内存链路按 ts 重定位提问卡（删则 loadMsgs 重建 msgs 后旧索引错位，回答落到别张卡或丢失）', file: 'js/chat.js', needle: "r.ts === askRecTs && r.askStatus !== 'answered') return i;" },
  { name: '#454 字卡库顶部tab点不开（renderTabCounts 懒加载 groups=null 空守卫——#442 只给 renderGroupsBar 加了守卫，顶层首渲在此抛 null[\'text\'] 使 chatcard.js 整个初始化中断，顶部两大分类 tab/锁提示/搜索全不挂；删则多机型复发「系统预设字卡点不开」）', file: 'js/chatcard.js', needle: "const grps = (groups && groups[tab.dataset.type]) || [];" },
// ==== 2026-09-14 #458 「卡顿自检弹窗一键优化点击没用」多机型（原回调两端只有 3.2s toast——大库优化
//      耗时数十秒起、iOS 伴随卡顿/页面被杀，提示一闪而过＝观感「点了没用」；且无 .catch、idbGet 存储
//      繁忙挂起（#229 家族 iOS 高发）时 promise 永不落定＝永远无声。修复：结果常驻弹窗+catch+90s 看门狗，
//      零机型分支零存储语义改动）====
{ name: '#458 一键优化结果单飞收口（done 看门狗/完成/异常三路只放行一次并清定时器；删则多路重复弹窗或看门狗误报）', file: 'js/personalize.js', needle: 'clearTimeout(wd);' },
{ name: '#458 一键优化 90s 看门狗（idbGet 存储繁忙挂起 promise 永不落定也必出常驻提示；删则挂起设备点了优化永远无声＝「点击没用」复发）', file: 'js/personalize.js', needle: 'const wd = setTimeout(function () {' },
// ==== 2026-09-14 #459 「一键优化没进度感」（#458 反馈闭环后续）：取回 44MB 大键+预热令牌化期间
//      主线程间歇被占、干等观感差；给 mochiPerfHeal 加可选 prog(pct,label) 回调（不传行为不变，
//      verify 资产零影响），promptHeal 调用侧挂固定进度浮层显示阶段+百分比，结束仍由 #458
//      常驻弹窗收尾。零机型分支，零存储语义改动）====
{ name: '#459 一键优化实时进度浮层（perf-heal-bar 阶段+百分比由 prog 驱动；删则优化期间回到干等无声＝大库设备观感「点了没用」）', file: 'js/personalize.js', needle: "bar.id = 'perf-heal-bar';" },
{ name: '#459 prog 进度管道接通（showProg 传入 mochiPerfHeal；删则进度浮层停摆不更新＝进度功能失效）', file: 'js/personalize.js', needle: 'window.mochiPerfHeal(showProg)' },
{ name: '#459 mochiPerfHeal 进度回调骨架（step 归一封装 prog，取回/预热各阶段推进度；删则调用侧拿到不到任何进度）', file: 'js/storage-slim.js', needle: 'const step = function (pct, label)' },
// ==== 2026-09-14 #470 「maybeCardLockReminder is not defined 每次进入 uncaught + 字卡锁提醒永不弹出」多机型
//      （clock.js 两处 IIFE：提醒函数定义在防骗声明段 IIFE，finishEnter 在另一 IIFE 直呼函数名——
//      函数声明不会跨 IIFE 泄漏，线上每次点「我已阅读并确认进入」必抛 ReferenceError；
//      修复：挂 window.maybeCardLockReminder + finishEnter 守卫调用，零机型分支零逻辑改动）====
{ name: '#470 进入流程调用字卡锁提醒改守卫（window.maybeCardLockReminder 挂载 + finishEnter 守卫调用；删守卫/改回直呼函数名＝ReferenceError 与提醒失效双复发）', file: 'js/clock.js', needle: 'if (window.maybeCardLockReminder) window.maybeCardLockReminder();' },
// ==== 2026-09-15 #486 深色模式白底漏网全量收口（用户报「深色下还有很多颜色是白色导致看不见」，多机型同报；
//      tools/verify-dark-audit.mjs 135 步全量审计实测 60 处真问题，修复后 0；本批 src 随 140950a 上车，此处补登记哨兵）====
{ name: '#486 深色开关选中态滑块改深色（选中轨道是浅色 var(--ink)，滑块仍 #f0f0f0＝白滑块白轨道看不出开没开）', file: 'css/dark.css', needle: '[data-theme="dark"] .toggle input:checked + .tk::before { background:#111111; }' },
{ name: '#486 字卡库左菜单 .chat-item .av 白色图标块改深（chat-pages 硬编码 rgba(255,255,255,.92) 白块+浅描边图标＝白块看不见图标）', file: 'css/dark.css', needle: '[data-theme="dark"] .chat-item .av { background:#2a2a2a; border-color:var(--dark-border); }' },
{ name: '#486 此间分组芯片选中态补浅底（原覆盖只改字色没改底色＝深底深字）', file: 'css/dark.css', needle: '[data-theme="dark"] .cj-gchip.on { background:var(--ink,#f0f0f0); border-color:var(--ink,#f0f0f0); color:#111; }' },
{ name: '#486 备忘提醒快捷片深底亮字（memo.css 白蒙底+--ink-soft 灰字＝灰底灰字）', file: 'css/dark.css', needle: '[data-theme="dark"] .memo-rc { background:rgba(255,255,255,.08); border-color:rgba(255,255,255,.15); color:#bbbbbb; }' },
{ name: '#486 拍一拍存入按钮深底（chat-main.css 白底+var(--ink) 浅字＝白底浅字）', file: 'css/dark.css', needle: '[data-theme="dark"] .poke-input-save { background:var(--dark-card); border-color:var(--dark-border-12); color:var(--ink); }' },
{ name: '#486 桌面签到心形徽章深字（--widget-heart 浅圆底+硬编码白心形）', file: 'css/dark.css', needle: '[data-theme="dark"] .ck-heart { color:#111111; }' },
{ name: '#486 市集分类选中圆浅底深字（market.css #f2f2f5/#1f1f1f !important 浅色规则必须 !important 反压）', file: 'css/dark.css', needle: '[data-theme="dark"] .market-cat.sel .market-cat-ico { background:#f0f0f0 !important; color:#111111; }' },
{ name: '#486 市集商品卡顶部白带清除（#page-market .gift-item-top 白底 !important）', file: 'css/dark.css', needle: '[data-theme="dark"] #page-market .gift-item-top { background:transparent !important; }' },
{ name: '#486 心意柜 hero 深色下提亮字色（深底已覆盖但 color:#111 只在浅色规则＝图标深底深字）', file: 'css/dark.css', needle: '[data-theme="dark"] .giftbox-hero { color:#f2f2f2; }' },
{ name: '#486 聊内送礼面板商品渐变收尾跟主题色（内联 linear-gradient 硬编码 #fff 收尾＝深色白底；CSS 压不过内联只能改源头）', file: 'js/gift-shop.js', needle: "linear-gradient(160deg,' + col + ',var(--card-bg,#fff))" },
{ name: '#486 心意柜详情预览渐变收尾跟主题色（同上，catColor 变体）', file: 'js/gift-shop.js', needle: "linear-gradient(160deg,' + catColor + ',var(--card-bg,#fff))" },

  // ==== 2026-09-15 #490 引用预览条与气泡同轨显示（「联系人发的消息，引用后看到的和引用的不一致」
  //      EC-PAD01 SE Chrome 等多机型同报；气泡正文走 T()＝in 侧 taFit 称呼替换 + {ta}/{me} 昵称占位符，
  //      预览条此前直出存储原文＝两轨不一致，发送后引用块又走 taFit 对不上预览）====
  { name: '#490 引用预览同轨显示助手定义（删则预览条失去 taFit 称呼替换 + {ta}/{me} 昵称回填能力）', file: 'js/chat.js', needle: 'function quoteDisplayFit(text, side) {' },
  { name: '#490 预览条接入同轨显示（删则气泡显示替换词、引用预览仍是 ta/TA 原文＝引用不一致复发）', file: 'js/chat.js', needle: "quoteDisplayFit(quoteTextSafe(lastQuote.text || ''), lastQuote.side)" },

  // ==== 2026-09-15 #491 引用串条残留洞：开菜单【前】msgs 已中段位移而 DOM 未重渲（#220 不贴底
  //      防闪路径）＝#407 快照按陈旧下标取、开场即锁错条（四级重定位的输入本身已错）＝「引用的
  //      消息和显示的消息完全不对」（EC-PAD01 SE Chrome 等多机型同报）；修复=渲染期把消息内容
  //      身份写进 data-mk，开菜单按 mk 反查真实那条（stamp+resolve 两端都在位才生效，各一条哨兵）====
  { name: '#491 单聊渲染期身份锚写入（删则 data-mk 恒空＝开菜单只能按陈旧下标取，串条残留洞复发）', file: 'js/chat.js', needle: 'm.dataset.mk = msgKeyOf(rec);' },
  { name: '#491 单聊开菜单按身份锚反查（删则快照被位移后的陈旧 data-idx 毒化＝引用完全不对复发）', file: 'js/chat.js', needle: 'msgs.findIndex(mkMsg => msgKeyOf(mkMsg) === _mk)' },
  { name: '#491 群聊渲染期身份锚写入（删则群聊引用串条残留洞复发）', file: 'js/group-chat.js', needle: 'm.dataset.mk = gcMsgKeyOf(rec);' },
  { name: '#491 群聊开菜单按身份锚反查（删则群聊快照被陈旧 gcIdx 毒化＝串条复发）', file: 'js/group-chat.js', needle: 'msgs.findIndex(gmkMsg => gcMsgKeyOf(gmkMsg) === _gmk)' },

  // ==== 2026-09-15 #493 字卡库令牌卡直出乱码/白块（红米 K80 Chrome 等多机型同报「其他地方表情包正常，字卡库里纯白+乱码」）：#377 大库内存瘦身把超大贴纸/图片卡体换成 @@m:hash 令牌后，cardItemHtml 只有 data:/http(s) 图片分支，令牌卡掉进文字分支＝网格直出令牌串或空白；修复=渲染分支补认令牌按图渲染（懒加载+media-pool 观察器解图）+点击进大图而非文字编辑 ====
  { name: '#493 令牌卡按图渲染分支（删则字卡库网格直出 @@m:hash 乱码/白块复发）', file: 'js/chatcard.js', needle: "style=\"color:var(--muted)\">[图片丢失]</div></div>';" },
  { name: '#493 令牌卡点击查看大图·同步渲染路径（删则令牌卡点开文字编辑弹窗复发）', file: 'js/chatcard.js', needle: 'viewImage(v || c);' },
  { name: '#493 令牌卡点击查看大图·分块渲染路径（删则令牌卡点开文字编辑弹窗复发）', file: 'js/chatcard.js', needle: 'viewImage(v || it.c);' },

  // ==== 2026-09-15 #494/#495 启动期「未定义标识符/TDZ 被行内 catch 静默吞」双修（无头
  //      pauseOnExceptions 实锤，__jsErrors/console 永远看不到）：#494 chat.js 顶层回前台监听
  //      引用 scheduleReply/replyOnce 函数内局部 const sameCid＝每次回前台 ReferenceError 被吞、
  //      trySystemAskMochi 回前台补触发通道自上线即失效；#495 personalize.js deskLayout const
  //      定义在 buildDeskPages 顶层调用之后＝冷启动 TDZ、删页收缩落盘判断被吞。行为级回归：
  //      tools/verify-no-startup-referror.mjs（哨兵防整块删除，位置回退由该脚本兜）====
  { name: '#494 回前台补触发通道（删/退回带 sameCid 守卫的死段则 TA 自动申请零钱回前台不再补触发）', file: 'js/chat.js', needle: "try { setTimeout(function () { trySystemAskMochi(); }, randInt(2000, 6000)); } catch (e) {}" },
  { name: '#495 deskLayout 定义存在（随 #495 上移至 buildDeskPages 之前；删则冷启动 deskLayout 引用全灭）', file: 'js/personalize.js', needle: 'const deskLayout = () => {' },
  // v3.26.x：摸鱼值/工作值累计总开关（回复设置→其他「摸鱼值/工作值」组，新功能）——闸门收在
  // personalize.js addFish/addWork 入口，删掉守卫行＝开关失效、关闭后数值照涨（60 秒自动累计/
  // 点击摸鱼/番茄钟补偿/抓包奖励所有加分来源一并被闸）
  { name: '摸鱼值累计总开关闸门 addFish 入口（删则回复设置→其他「摸鱼值累计」开关失效，关闭后摸鱼值照涨）', file: 'js/personalize.js', needle: "if (!fishWorkOn('fish-en')) return;" },
  { name: '工作值累计总开关闸门 addWork 入口（删则回复设置→其他「工作值累计」开关失效，关闭后工作值照涨）', file: 'js/personalize.js', needle: "if (!fishWorkOn('work-en')) return;" },

  // ==== 2026-09-15 #497 存储可见性三件（用户报「全部数据内存占比显示不全 / 没有上传图片已压缩的说明 /
  //      导出前看不到全部数据多大和导出文件多大」）：①查看存储两条占用行补配额百分比；
  //      ②img-compress.js 上线时漏加 template 三锚点＝压缩图片功能全站无入口，补设置行+查看存储卡
  //      （含「上传当时已自动压缩」说明）；③askExportMode 弹窗的「本机数据约 X」原是整域 estimate
  //      （含同域其他站点），改 measureProject 按导出同路径实测（LS+IDB 双写去重、Blob×4/3 base64）
  //      + 配额占比 + 各模式导出文件预估。行为级回归：tools/verify-storage-export-info.mjs ====
  { name: '#497a 压缩图片设置行入口（template.html；删/改 id 则 img-compress.js 接线全落空＝设置页无入口复发）', file: 'template.html', needle: 'id="row-img-compress"' },
  { name: '#497a 查看存储页压缩入口按钮（template.html；缺则存储页无重压入口）', file: 'template.html', needle: 'id="st-img-compress-btn"' },
  { name: '#497b 上传图片已压缩说明（template.html 查看存储图片压缩卡；删则用户无法知道图片占用已是压缩后体积）', file: 'template.html', needle: '你上传/发送的图片在选定当时就已自动压缩过' },
  { name: '#497c 查看存储本项目合计带配额占比（删则总占用回到只有绝对字节＝「占比显示不全」复发）', file: 'js/personalize.js', needle: "'，占浏览器配额 ' + pctOf(ls.total + t, quotaInfo.quota)" },
  { name: '#497c 压缩完成后总占用联动刷新（img-compress 派发事件的本端监听；删则压完总占用纹丝不动）', file: 'js/personalize.js', needle: "addEventListener('mochi-img-compressed'" },
  // 🔧 2026-09-16 #581 会话换锚（#582 在途重构把「逐项累加」抽成 fb 中间量，原 needle `projFile += c + Math.round(blob * 4 / 3);`
  // 已不存在 → 全量构建报「修复真丢了」）。膨胀逻辑本身仍在原处，锚点改钉那条表达式本身。
  // ⚠️ 请 #582 会话确认此换锚符合原意。
  { name: '#497d 导出前实测计量·Blob 过 base64 膨胀进文件口径（删则导出文件预估对音乐/二进制严重偏小；#582 重构后改钉膨胀表达式本身）', file: 'js/data-backup.js', needle: "else if (typeof Blob !== 'undefined' && v instanceof Blob) { blob = v.size; fb = Math.round(blob * 4 / 3); }" },
  { name: '#497d 导出前阈值按实测导出体积判（删则回退整域 estimate 口径＝同域其他站点又冒充本机数据）', file: 'js/data-backup.js', needle: 'const bigRef = info ? info.projFile : usage;' },
  { name: '#497d 选范围弹窗带配额占比+各模式导出文件预估（删则「导出前看不到导出的文件多大」复发；#582 起预估压成一行「预估文件：完整/不含音乐/仅聊天记录…」，needle 随文案更新）', file: 'js/data-backup.js', needle: "'；预估文件：完整 '" },
  { name: '#505 链接导入按钮只留表情包/图片分类（切分类/进页按当前分类显隐；删则按钮重新在所有大分类 tab 常驻）', file: 'js/chatcard.js', needle: "b.style.display = (cur === 'sticker' || cur === 'image') ? '' : 'none';" },
  // ==== 2026-09-16 #605 字卡库空态按钮越界（用户报「【公用字卡】【专属字卡】里只有【表情包】【图片】该有批量导入图片/链接导入，其他分类也有，全部都有」）：#549 给空列表加的「链接导入」快捷按钮条件写成 `isVoice ? ''`＝除语音外所有分类（主字卡/颜文字/emoji/拍一拍/其他功能）空态都渲染，点了只吃「链接导入仅支持表情包和图片分类」toast＝死按钮（与 #505 工具栏同族）。修复=与 syncLinkImportVis 同口径，只在 sticker/image 渲染。批量导入（文字/分类型）按钮保留——文字分类本就靠它导入 ====
  { name: '#605 字卡库空态「链接导入」只留表情包/图片（删则回退 `isVoice ? \'\'`＝其余分类空态又出现死按钮）', file: 'js/chatcard.js', needle: "(cur === 'sticker' || cur === 'image') ? '<button type=\"button\" class=\"cc-empty-btn\" data-cc-empty=\"link\"" },
  { name: '#506 导出自包含·令牌还原助手（删则导出文件里 sticker/image 的 @@m: 令牌不再还原成图片数据＝导出缺表情包/图片全部数据复发）', file: 'js/chatcard.js', needle: 'function ccExportExpandTokens(obj) {' },
  { name: '#506 导出接线·导出数据先还原再落文件', file: 'js/chatcard.js', needle: 'ccExportExpandTokens(out).then(exp => {' },
  { name: '#506 媒体池令牌完整解析 API（导出还原的取数来源）', file: 'js/media-pool.js', needle: 'window.mochiMediaResolve = function (s) {' },
  { name: '#506 媒体池 GC/Coverage 引用面补字卡库两键（删则库内令牌引用的池条目被误判孤儿删除＝图片永久丢失）', file: 'js/media-pool.js', needle: 'chat-tail|cc-groups(?:-public)?)$' },
  { name: '#504a 进聊天页回弹·rAF 稳定窗（删则回退固定 400ms 复写＝视口内图片迟到长高当帧以旧 scrollTop 绘制，聊天记录回弹一下再恢复复发）', file: 'js/chat.js', needle: 'let chatEntrySettleToken = 0;' },
  { name: '#504b 稳定窗守卫：token/离页/解钉即停（删则用户上翻期稳定窗仍抢滚动权＝#162 不打扰契约被破坏）', file: 'js/chat.js', needle: 'chatEntrySettleToken || !chatVisible() || !chatPinnedBottom' },
  { name: '#504c 稳定窗变高当帧同步回钉（删则内容长高后到下一帧才修正＝回弹帧可见）', file: 'js/chat.js', needle: 'if (h !== lastH) { lastH = h; scrollChatBottom(); }' },
  { name: '#504d 图片 onload 同步回钉（删则长高后 rAF 下一帧才修正＝回弹帧可见）', file: 'js/chat.js', needle: 'scrollChatBottom(); requestAnimationFrame(scrollChatBottom);' },
  // ==== 2026-09-15 #507 语音播放按钮 touch 直驱（多机型「点我发出去的语音听不了/点了只弹菜单」）：#480 气泡轻点直驱把播放按钮轻点当「点气泡」＝开菜单+布吞 click 窗口，吞 click 族内核 click 永远不来＝语音播不出；修复=点气泡判定排除 .msg-voice-play + 按钮 touchend 直驱播放并守卫吞补发 click ====
  { name: '#507a 单聊点气泡判定排除播放按钮（删则轻点播放按钮重开菜单+布吞 click 窗口＝吞 click 族语音播不出复发）', file: 'js/chat.js', needle: "if (t.closest('.msg-voice-play')) return null;\nif (t.closest('.msg-quote')) return null;" },
  { name: '#507b 单聊播放按钮 touch 直驱守卫（删则吞 click 族内核只剩必丢的 click 一条路＝语音播不出复发）', file: 'js/chat.js', needle: 'vTapGuard = Date.now() + 800;' },
  { name: '#507c 群聊点气泡判定排除播放按钮（删则群聊轻点播放按钮重开成员菜单＝播不出复发）', file: 'js/group-chat.js', needle: "if (t.closest('.msg-voice-play')) return null;\nif (t.closest('.msg-quote')) return null;                 // 引用块点击留给后续跳原消息" },
  { name: '#507d 群聊播放按钮 touch 直驱守卫（删则群聊吞 click 族内核语音播不出复发）', file: 'js/group-chat.js', needle: 'gvTapGuard = Date.now() + 800;' },
  // ==== 2026-09-15 #508 图片「闪一下重新加载」（红米 K80 Chrome 等多机型，与 #504 聊天回弹同族）：头像互动点选换头像后 renderGrid()/renderMeGrid() 整格 innerHTML 重建＝img 全部新建+懒加载重新赋 src＝已解码图全部重新解码闪烁（无头节点身份实证 8/8 全被替换）；字卡库 render() 同族整格重渲丢全部已解码 img。修复=头像侧换头像只同步 .avlib-now 高亮不重建（内容没变唯一变化是高亮）；字卡库 render() 清空前按内容指纹收集旧卡 img、建卡时同指纹原位移植＝零重解码 ====
  { name: '#508a 头像池高亮更新函数（删则换头像回退整格重建＝图片全部重新解码闪烁复发）', file: 'js/avatar-lib.js', needle: 'function updateGridNow() {' },
  { name: '#508b 我的头像池高亮更新函数（删则换我的头像回退整格重建闪烁复发）', file: 'js/avatar-lib.js', needle: 'function updateMeGridNow() {' },
  { name: '#508c 高亮更新保底回退重建：格数或内容不符才走 renderGrid（删则库真变化时高亮不同步）', file: 'js/avatar-lib.js', needle: 'avGrid.querySelectorAll(\'.avlib-cell\')' },
  { name: '#508d 字卡库建卡写内容指纹（#509 改 djb2 短键 ccImgKey；删则整格重渲无从识别未变化卡＝复用失效闪烁复发）', file: 'js/chatcard.js', needle: 'el.dataset.ccSig = ccImgKey(it.c);' },
  { name: '#508e 字卡库重渲前回收已解码 img（#509 改为回收进模块池 ccPoolHarvest(list)；删则已解码图全部丢弃重建＝闪烁复发）', file: 'js/chatcard.js', needle: 'ccPoolHarvest(list);' },
  { name: '#508f 同指纹原位移植已解码 img（删则重渲即重新解码＝闪烁复发）', file: 'js/chatcard.js', needle: '_ni.parentNode.replaceChild(_oi, _ni)' },
  // ==== 2026-09-15 #509「每次打开都闪」（红米 K80 Chrome 等多机型，用户明说其他设备型号也有）：#508 只覆盖「点选换头像」与「字卡库当次 render 内移植」，**打开路径**没覆盖——①openAvlib() 每次打开都整格重建（实证打开→关闭→再打开 8/8 img 全被替换）；②字卡库真实进页路径是「openCcPage 先按 cur='text' 渲一遍清空 list → 点『表情包』tab 再渲第二遍」，第二次要用的节点已离开 DOM＝当次收集抓不到＝整格新建（实证 12/12）；rebuildGroupAfterRemove（删一张卡重建整组）同族。修复=①复用判定改返回值，打开走 renderGridSmart/renderMeGridSmart（库没变零重建）＋restoreLib 回填后同口径刷新；②新增模块级图片节点回收池（上限 150 + 闲置 3 分钟释放）跨 render 存活，回收/取用覆盖整格重渲与局部重建 ====
  { name: '#509a 头像互动打开路径复用优先（删则每次打开半框整格重建＝图片闪一下重新加载复发，多机型同发）', file: 'js/avatar-lib.js', needle: 'if (!updateGridNow()) renderGrid();' },
  { name: '#509b 我的头像池打开路径复用优先（删则切到「我的头像库」页签同样每次重载）', file: 'js/avatar-lib.js', needle: 'if (!updateMeGridNow()) renderMeGrid();' },
  { name: '#509c 模块级图片节点回收池取用（删则跨 render 无池可取＝每次进表情包页整格新建重解码）', file: 'js/chatcard.js', needle: 'ccPoolTake(ccImgKey(c))' },
  { name: '#509d 局部重建（删卡重建整组）前回收图片节点（删则删一张卡该分组图片全部重载）', file: 'js/chatcard.js', needle: 'ccPoolHarvest(el);' },
  { name: '#509e 回收池闲置整池释放（删则已解码位图长期驻留内存，大库机型内存压力回升）', file: 'js/chatcard.js', needle: 'setTimeout(ccPoolRelease, 180000)' },
  // ==== 2026-09-15 #510 联系人发来的「亲亲/贴贴申请」弹窗同意后系统消息无留痕（用户报「我同意后，系统消息里没有相关消息」）：贴贴邀请（cuddle）原链路同意只震动+TA 回应一句、拒绝只发婉拒话术，聊天记录里没有任何系统消息；口径对齐换头像邀请（avatar-lib replyMeInvite）与听歌邀请（music-player sm-req-*）。猜拳/游戏类邀请不补（对局结果另有系统消息，避免同一件事留痕两次）====
  { name: '#510a 贴贴邀请同意写系统消息（删则同意后聊天无「你接受了 × 的贴贴邀请」留痕＝原报障复发）', file: 'js/chat.js', needle: "你接受了 ' + name + ' 的贴贴邀请" },
  { name: '#510b 贴贴邀请拒绝写系统消息（删则拒绝后只剩婉拒话术、系统消息留痕丢失）', file: 'js/chat.js', needle: "你拒绝了 ' + name + ' 的贴贴邀请" },
  { name: '#510c openInviteConfirm 支持 onDecline 回调（删则该分支回退「只发婉拒话术」＝#510b 失锚）', file: 'js/chat.js', needle: "else if (typeof onDecline === 'function') onDecline();" },
  // ==== 2026-09-15 #513「梦角自由造句」与「混合模式」默认打开（用户点名「梦角自由造句和梦角自由造句的混合模式需要默认打开」）：#317 初版把 mjf-en 定为默认关（「可自由选择开关」），#414 混合模式同样默认关；本轮翻案＝装上即生效。仅翻 DEFAULTS 对已写盘设备无效（旧默认 '0' 随「保存设置」全量写盘落盘），故补标记键 reply-mjf-on-migrated 一次性把存量 '0' 收成 '1'（与 #388/#443 同款标记式迁移：值式会在用户之后每次手动关闭时被加载反复改回）====
  { name: '#513a 梦角自由造句总开关默认开（DEFAULTS mjf-en=1；改回 0＝装上仍是关的、用户点名「需要默认打开」落空）', file: 'js/reply-settings.js', needle: "'mjf-en': 1, 'mjf-prob': 20," },
  { name: '#513b 造句混合模式默认开（DEFAULTS mjf-mix=1；改回 0＝默认只走 mjf-style 单一手法、三手法不再交替）', file: 'js/reply-settings.js', needle: "'mjf-mix': 1," },
  { name: '#513c 存量开关 0→1 一次性迁移+标记键（删＝已保存过设置的设备仍停在关，用户看到「默认还是没打开」＝原报障复发）', file: 'js/reply-settings.js', needle: "s.set('reply-mjf-on-migrated', '1');" },
  // ==== 2026-09-15 #511 拍一拍手势泄漏族 + 进聊天气泡「先变 2 条再恢复」（用户三条同批报障）：①桌面点开【聊天】进页面，联系人最新一条消息变 2 个又恢复＝LS 快照与内存 msgs 的合并签名只比 ts|side|原文前64字符，同一逻辑消息 LS 侧是 base64、内存侧已令牌化（#256）判成两条 → 首帧渲 2 个气泡、后台归一化又合并回 1；写侧（mergeLsSnapshotWith）与读侧（loadMsgs）各有一份同款内联签名，只修一处＝半修。②点联系人头像有时没打开拍一拍页、直接发出拍一拍 ③「我的拍一拍」tab 打开该页默认弹输入法＝同源：touch/pointer 路在 touchend 里同步开面板并渲染字卡/输入行，紧随的合成 click 落点已在面板内（落字卡＝误发+面板一闪而过；落输入框＝聚焦弹键盘，输入行仅 mine tab 显示故只有该 tab 复现）。上一轮修复只声明了 pokeOpenClickGate 却从未赋值（闸恒 0）＝拦截器形同虚设，本条即报障复发的直接原因 ====
  { name: '#511a 两处合并点统一走 lsMergeSig（删/退回内联签名＝跨形式同一条判成两条、进聊天气泡先变 2 个再恢复复发）', file: 'js/chat.js', needle: 'msgsNow.map(lsMergeSig)' },
  { name: '#511b 进页读侧合并同样走 lsMergeSig（只修写侧＝LS 里继续存两份，下次进页照样先 2 后 1）', file: 'js/chat.js', needle: 'lsArr.map(lsMergeSig)' },
  { name: '#511c 拍一拍点击闸真的被布上（openPokeCard 按 fromGesture 调 pokeArmClickGate；退回「只声明不赋值」＝闸恒 0、拦截器形同虚设，②③两条报障复发）', file: 'js/chat.js', needle: 'if (fromGesture) pokeArmClickGate();' },
  { name: '#511d 闸拦截范围＝整个 poke-card（只挂 pokeList 时输入行不在覆盖内＝③弹输入法复发）', file: 'js/chat.js', needle: "pokeCard.addEventListener('click'" },
  { name: '#511e 闸内被聚焦的输入框主动收回焦点（内核对 input 的聚焦在 touchstart 期已定，click 层 preventDefault 拦不住）', file: 'js/chat.js', needle: "pokeCard.addEventListener('focusin'" },
  { name: '#511f 开面板主动失焦（「我的拍一拍」tab 输入行常驻可见，泄漏 click 落到它就唤起输入法）', file: 'js/chat.js', needle: 'try { pokeInput.blur(); } catch (e) {}' },
  { name: '#511g 旧内联合并签名不得复活（absent：const sig2 只有 ts|side|前64字符＝跨形式判不出同一条，半修征兆）', file: 'js/chat.js', needle: 'const sig2 =', absent: true },
  // ==== 2026-09-15 #513a 语料口径校对（用户点名「使用的是 自定义字卡的公用字卡＋专属字卡＋系统预设的默认聊天字卡＋默认聊天字卡·词典」）：①默认聊天字卡源此前只取 main 主字卡，与 字卡库→系统预设→默认聊天字卡 页的四分类（主字卡/颜文字/emoji/拍一拍）不同口径；②词典源漏滤逐张关闭（字库→词典里关掉的语录仍被当源句），与词典拼字 quote-spell.js 口径不一致。修复：defaultPool 遍历四分类并尊重分类开关 defaultCardCat + 逐张关闭；dictPool 补 isDefaultCardOff('dict', …) ====
  { name: '#513d 造句·默认聊天字卡源＝四分类同源（改回只取 main＝拍一拍字卡不再作源句，与字卡库页口径脱节）', file: 'js/dream-free.js', needle: "const DEF_CATS = ['main', 'kaomoji', 'emoji', 'touch'];" },
  { name: '#513e 造句·词典源逐张关闭过滤（删＝字卡库→词典里关掉的语录仍被抽作源句，与词典拼字口径不一致）', file: 'js/dream-free.js', needle: "return filterCorpus(all.filter(t => !(window.isDefaultCardOff && window.isDefaultCardOff('dict', t))));" },
  // ==== 2026-09-15 #515 系统预设字卡三页「触发概率显示 + 可调」（用户报「字卡库的系统预设字卡里，聊天回应字卡 / 使用情绪字卡 / 寻踪日常字卡 3 个功能页面里都没有显示触发的概率和可调整的按钮功能」）：这四项概率此前全写死在代码里——情绪 70%（+连续衰减 70/60/45/30/20）、心意 40%、交流意图 40%、回应字卡整条替换 30%，寻踪日常推送的 dcf-checkin 只挂在【其他互动功能字卡】页（寻踪页自己看不到也改不了）。修复＝三页各补概率行 + 消费点接线（未设键回退原写死值＝默认行为不变），寻踪那处与功能字卡页共用同一个 dcf-checkin、改一处两处同步；行为断言见 tools/verify-card-prob-pages.mjs（HEAD 基线 5/27 → 修复 27/27） ====
  { name: '#515a 聊天情绪字卡页三类概率 stepper（删＝该页又变回「只有总开关、没有显示触发的概率和可调整的按钮」＝原报障复发）', file: 'template.html', needle: 'id="mc-prob-mood-val"' },
  { name: '#515b 聊天回应字卡页两个消费点概率 stepper（整条替换 rcard-prob + 连接词追加 cf-prob，删＝该页概率不可见不可调）', file: 'template.html', needle: 'id="cf-prob-val"' },
  { name: '#515c 寻踪日常字卡页「寻踪日常发送到聊天」概率行（data-dcfkey=checkin＝与功能字卡页同键同步；删＝该页看不到概率）', file: 'template.html', needle: 'data-dcfkey="checkin"' },
  { name: '#515d 情绪/心意/意图概率未设键回退 70/40/40（改默认＝所有没设过键的老设备概率被悄悄改掉）', file: 'js/mood-reply-cards.js', needle: 'const MC_PROB_DEF = { mood: 70, heart: 40, intent: 40 };' },
  { name: '#515e 回应卡整条替换概率改读 rcardProb()（#518 起再套总档；退回写死 if (Math.random() * 100 >= 30) ＝该页「回应字卡使用概率」stepper 点了不生效）', file: 'js/mood-reply-cards.js', needle: "if (Math.random() * 100 >= (window.dcpEff ? window.dcpEff(rcardProb()) : rcardProb())) return '';" },
  // ===== #518 系统预设字卡·聊天触发概率「总档 + 分类档」 =====
  { name: '#518a 总档 dcp-all 走回复设置 DEFAULTS/stepper 体系（删 data-k="dcp-all"＝总档行不显示不落盘）', file: 'template.html', needle: 'data-k="dcp-all"' },
  { name: '#518b 分类档首行「默认聊天字卡·聊天使用」锚（id=dcp-dc-overall-chat，reply-settings #518 段按 id=dcp-<键> 绑定）', file: 'template.html', needle: 'id="dcp-dc-overall-chat"' },
  { name: '#518c dcf 19 类折叠块末行「TA主动提问」锚（data-dcfkey 由 default-cards bindDcfProb 自动接管）', file: 'template.html', needle: 'id="dcf-prob-ask-rs"' },
  { name: '#518d 总档 API 暴露 dcpEff（生效=设定值×总档÷100；未设键=100 原值直通）', file: 'js/dcp-master.js', needle: 'window.dcpEff = dcpEff;' },
  { name: '#518e 总档 API 暴露 dcpAll（键 reply-dcp-all per-cid，未设/坏值回 100）', file: 'js/dcp-master.js', needle: 'window.dcpAll = dcpAll;' },
  { name: '#518f 邀请三道门 hit 出口套总档（删包裹＝猜拳/游戏/贴贴不受总档缩放）', file: 'js/ta-invite.js', needle: 'Math.random() * 100 < (window.dcpEff ? window.dcpEff(p) : p)' },
  { name: '#518g 词典拼字 qs-prob 套总档（退回裸 Number(c[\'qs-prob\'])＝词典不受总档缩放）', file: 'js/quote-spell.js', needle: "window.dcpEff ? window.dcpEff(Number(c['qs-prob'])) : Number(c['qs-prob'])" },
  { name: '#518h TA的心情掷签套总档（退回裸 getProb()＝心情不受总档缩放；显示读点保持存盘值）', file: 'js/ta-mood.js', needle: 'window.dcpEff ? window.dcpEff(getProb()) : getProb()' },
  { name: '#518i 查岗概率套总档（退回裸 c[\'ckq-prob\']＝查岗不受总档缩放）', file: 'js/ck-question.js', needle: "window.dcpEff ? window.dcpEff(c['ckq-prob']) : c['ckq-prob']" },
  { name: '#518j 连接词追加 cf-prob 套总档（退回裸 hit(c[\'cf-prob\'])＝连接词不受总档缩放）', file: 'js/chat.js', needle: "window.dcpEff ? window.dcpEff(c['cf-prob']) : c['cf-prob']" },
  { name: '#518k 四类互动卡（询问/小问题/好奇/吐槽）掷签套总档（四处包裹任一被删即特征减少，verify 脚本另有条数=4 断言）', file: 'js/ta-ask.js', needle: "window.dcpEff ? window.dcpEff(typeof s.prob === 'number' ? s.prob : 5)" },
  { name: '#518l 情绪卡衰减基数套总档（退回裸 mcProb(\'mood\')＝情绪卡不受总档缩放；显示读点保持存盘值）', file: 'js/mood-reply-cards.js', needle: "window.dcpEff ? window.dcpEff(mcProb('mood')) : mcProb('mood')" },
  { name: '#518m 心意卡掷签套总档（退回裸 mcProb(\'heart\')＝心意卡不受总档缩放）', file: 'js/mood-reply-cards.js', needle: "window.dcpEff ? window.dcpEff(mcProb('heart')) : mcProb('heart')" },
  { name: '#519 设置页 them-sec system 分区闭合锚（#518 分区改版漏 1 个 </div>＝#page-setting 未闭合吞掉 tabbar＝桌面底部导航 3 按钮随页 hidden 消失；与 #473/#477 同族第三次，删此闭合即复发报警）', file: 'template.html', needle: '</div><!-- /them-sec system -->' },
  { name: '#520 设置页 them-sec chat 分区闭合锚（chat 段装「回复/通话/音效设置+功能大全」，同族分区少闭合即 #page-setting 吞 tabbar，删此闭合即复发报警）', file: 'template.html', needle: '</div><!-- /them-sec chat -->' },
  { name: '#515f 情绪卡衰减按可调基数同比例缩放（退回固定 70 基＝调低基数后衰减档位与页面显示的基数脱钩）', file: 'js/mood-reply-cards.js', needle: 'let prob = Math.max(0, Math.min(100, _mBase * _ratio));' },
  { name: '#515g 同一 dcf 概率键的多处 stepper 批量绑定 + 同键刷新（删＝寻踪页与功能字卡页各显示各的、改一处另一处不变）', file: 'js/default-cards.js', needle: 'window.dcfRefreshUI = dcfRefreshUI;' },
  { name: '#515h 概率行显示存盘值而非闸门后的生效值（退回 dcfVal＝总开关关闭时各概率行显示 0、点 ± 被复位成 0＝点了没反应）', file: 'js/default-cards.js', needle: 'if (valEl) valEl.value = String(dcfRaw(k));' },
  { name: '#521a 批量问卷在聊天里渲染成长卡片（special:ask-survey 专用分支；删＝问卷退回只有一行 ask-msg 小字，用户报的「不像单题长卡片」复发）', file: 'js/chat.js', needle: "if (rec.special === 'ask-survey') {" },
  { name: '#521b 问卷进度回写助手（ta-ask.js 逐题作答/交卷时按 surveyTs 定位卡片快照；删＝卡片停在 0/N 不随作答更新）', file: 'js/chat.js', needle: 'window.chatSyncSurveyCard = function (surveyTs, status, answers) {' },
  { name: '#521c 问卷发出时插入 ask-survey 卡片快照（删＝只有「你向TA发出了一份问卷」提示语，无卡片本体）', file: 'js/ta-ask.js', needle: "special: 'ask-survey'," },
  { name: '#521d 问卷长卡片样式壳（观感对齐单题 ask-card：删＝卡片无白底/圆角/题距，退回裸文本堆叠）', file: 'css/chat-main.css', needle: '.msg-survey-head { font-size:14px; font-weight:700;' },
  { name: '#521e 问卷长卡片暗色适配（删＝暗色主题下卡片仍白底刺眼）', file: 'css/dark.css', needle: '[data-theme="dark"] .msg-survey-card { background:var(--dark-card-92);' },
  { name: '#522a 聊天消息菜单 touch 直驱取消 touchend 默认行为（抑制弹窗刚开即被补发 click 关掉＝长按→编辑无反应，vivo X200s Edge 等多机型）', file: 'js/chat.js', needle: 'e.preventDefault();\nmaClickGuard = Date.now() + 600;' },
  { name: '#522b 弹窗遮罩忽略「打开弹窗那次触摸补发的合成 click」（350ms 窗口；删＝任何 touch 直驱开弹窗的动作复发刚开即关）', file: 'js/personalize.js', needle: 'if (Date.now() - _openedAt < 350) return;' },
  { name: '#523a 问卷时间改 App 内自绘选择器（原生 datetime-local 弹层锚点不受控、会飞出屏幕；删＝两处时间入口无处可点）', file: 'js/ta-ask.js', needle: 'function openDeadlinePicker(title, current, cb) {' },
  { name: '#523b 自绘选择器静态锚点 + 一次性绑定 dlPickerInit（选择器 DOM 写在 template 的 #dl-picker-mask；删＝动态 append 输入框在部分环境点不动）', file: 'js/ta-ask.js', needle: 'function dlPickerInit() {' },
  { name: '#523j 自绘选择器静态 DOM 锚（template 预置 #dl-picker-mask，随载入全量 ceConvert；删＝回退动态 append，部分环境输入框点不动）', file: 'template.html', needle: 'class="modal-mask" id="dl-picker-mask"' },
  { name: '#523k 点问卷卡片打开只读「问卷详情」弹窗（删/改回 openAskSurvey＝点已交卷卡片又跳批量设置问卷页，用户报障复发）', file: 'js/ta-ask.js', needle: 'window.openSurveyDetail = function (rec) {' },
  { name: '#523c 选择器样式壳（分钟输入框 + 弹层按钮；删＝控件无样式不可用）', file: 'css/setting.css', needle: '.dl-picker-in:focus { border-color:var(--ink); }' },
  { name: '#523d 两处时间入口改为自绘按钮（用户报「浏览器自带的选择器飞出屏幕」；native input 锚点会被 base.css 的 :not([type=datetime-local]) 命中，故登记按钮本体）', file: 'template.html', needle: 'id="ta-ask-deadline" class="tc-input deadline-btn"' },
  { name: '#523e 批量问卷「TA 的作答发送到聊天消息」开关入口（删＝无法在发出前关掉逐条刷聊天）', file: 'template.html', needle: 'id="ta-survey-chat"' },
  { name: '#523f 批量问卷逐条发答受 sendToChat 门控（改恒发＝题多时答案全刷进聊天，用户报的「太多了」复发）', file: 'js/ta-ask.js', needle: 'cur.settings.sendToChat !== false' },
  { name: '#523g 发出问卷后自动关闭设置页回聊天（删＝点了发出仍停在批量设置页，用户报的「没返回聊天」复发）', file: 'js/ta-ask.js', needle: 'function surveyGoChat() {' },
  { name: '#523h 同一轮交卷只提醒一次（doneMsgAt=已提醒轮的 sentAt；改回恒发＝并发/重入时第二条「TA 交卷了」复发）', file: 'js/ta-ask.js', needle: 'const notify = d2.doneMsgAt !== d2.sentAt;' },
  { name: '#523i 已交卷（done）允许直接再发一轮（发出发出时重置 answers/doneMsgAt；删＝用户报的「已交卷的问卷无法重复提交给联系人作答」复发）', file: 'js/ta-ask.js', needle: 'd.status = \'sent\'; d.sentAt = Date.now(); d.answers = []; d.doneMsgAt = 0;' },
  // ==== 2026-09-15 #524 聊天设置「功能」页分类整理（用户要求：①二级 tag 删掉「全部」；②「允许删除联系人消息」移入消息输入分类；③分类名不合适要改） ====
  { name: '#524a 功能页二级 tag 不再有「全部」（改回/加回＝进页默认全显、与高亮 tag 对不上，用户点名删除的项复活）', file: 'template.html', needle: 'data-ft="all"', absent: true },
  { name: '#524b「允许删除联系人消息」落在功能页「消息」分类（搬回数据页＝用户报的「这个开关不在消息输入分类里」复发）', file: 'template.html', needle: '<div class="gs-title" data-tag="msg">消息管理</div>' },
  { name: '#524c 功能页 tag 进页即按默认选中项过滤（删＝去掉「全部」后进页仍全显、高亮的「形象」形同虚设）', file: 'js/chat-settings.js', needle: "applyFilter(def ? (def.dataset.ft || 'all') : 'all');" },
  { name: '#524d 功能页分类名「消息输入」→「消息」、「界面」→「显示」（改回旧名＝用户报的「分类名字不太合适」复发：旧名盖不住删除消息/全是显隐开关）', file: 'template.html', needle: '<div class="them-tab" data-ft="msg">消息</div>\n        <div class="them-tab" data-ft="ui">显示</div>' },
  // ==== 2026-09-15 #525 设置页 tag 分类：「清除本地数据」自「关于」段移入「工具」段（用户报「设置的 tag 分类有问题，不正常」） ====
  { name: '#525a 清除本地数据落在「工具」段且为该段末项（搬回「关于」段＝用户报的分类错位复发；锚在段闭合注释上，行被搬走时锚同步消失）', file: 'template.html', needle: '</div><!-- /them-sec tools · row-reset -->' },
  { name: '#525b 「关于」段不再承载清除本地数据（旧分组注释复活＝清除本地数据被搬回关于段）', file: 'template.html', needle: '<!-- 关于：清除本地数据 + 版本 + 防骗声明（常驻底部，不随标签切换） -->', absent: true },
  // ==== 2026-09-15 #526 新建联系人首次进聊天不再显示「正在加载聊天记录…」（空桌面白等 2.5s 空库二次复核） ====
  { name: '#526 已知空库（新联系人/空桌面）不显示聊天记录加载进度条（删 chatKnownEmpty 判定＝新建联系人首次进聊天又白等 2.5s 空库复核才收起进度条）', file: 'js/chat.js', needle: 'chatLoadingEl.hidden = !(chatVisible() && !chatDbReady && !chatKnownEmpty && !msgs.length);' },
  // ==== 2026-09-15 #527 模块加载体检：诊断「启动文件异常」带文件名 + 语法错致整段未加载可自查 ====
  { name: '#527 模块加载体检（__mochiLoaded 对比 __mochiJsFiles 定位整段未加载的文件；删掉＝语法错/启动抛错导致的功能整块失效无法自查）', file: 'js/device.js', needle: "'模块加载体检 ' + mc.loaded.length + '/' + mc.expected.length" },
  // ==== 2026-09-15 #528 诊断置顶结论聚合 + 桌面模拟器外壳底部几何误报豁免 ====
  { name: '#528 桌面外壳底部几何豁免（删掉＝PC 宽屏 .phone 居中手机壳被恒判「底部少填 ~24px 白带」，每次自动采集刷错误环）', file: 'js/device.js', needle: "else if (inp.isMobileDev === false) add(true, '桌面模拟器外壳" },
  { name: '#528 诊断置顶结论聚合（删掉＝错误/启动异常/模块未加载/入口缺失/存储/屏幕适配 ✗ 又散在十几节，用户看不出到底坏没坏）', file: 'js/device.js', needle: "'⚠ 发现 ' + issues.length + ' 项：'" },
  // ==== 2026-09-15 #529 聊天顶部头像打开的寻踪半框 #ck-panel 点外/再点头像无法关闭 ====
  { name: '#529a 寻踪半框补 document 点外关闭器（删＝点屏幕其他地方关不掉，用户报障复发；needle 为「命中头像入口不关/其余面板外一律关」的判定+关闭调用，按产物行首去缩进书写）', file: 'js/p2-features.js', needle: 'if (av && (e.target === av || av.contains(e.target))) return;\ncloseCkPanel();' },
  { name: '#529b 寻踪半框开关逻辑（开着则关；改回恒 openCkPanel＝再次点顶部头像纹丝不动，用户报障复发）', file: 'js/p2-features.js', needle: 'if (!p.hidden) { closeCkPanel(); return; }' },
  { name: '#529c 聊天顶部头像入口改走 toggleCkPanel（删/改回 openCkPanel＝同一个用户报障复发）', file: 'js/chat.js', needle: 'if (window.toggleCkPanel) window.toggleCkPanel();' },
  // ==== 2026-09-15 #530 安卓键盘期底部安全区归零（输入栏与输入法之间露大块底色，vivo S20 Edge 等；全屏正常）====
  { name: '#530a 安卓键盘在场判据（删/改回不判断＝键盘期仍回落 env(safe-area-inset-bottom) 那个 Chromium 缺陷值，输入栏被垫高、空白复发）', file: 'js/mobile-adapt.js', needle: "var _kbOn = !!(_aProv || (_aVV && _aH > 0 && _aVV.height > 0 && _aVV.height < _aH - 60));" },
  { name: '#530b 键盘期把 --mochi-safe-bottom 钉 0px（删掉＝输入栏底部留出不受页面控制的空白；收起摘除回落 env 的语义同函数内 removeProperty 行）', file: 'js/mobile-adapt.js', needle: "d.style.setProperty('--mochi-safe-bottom', _next);" },
  // ==== 2026-09-16 #556 iOS 键盘期底部安全区归零（输入栏与输入法之间露白带；iPhone 16 Pro iOS 18.7 standalone/全屏同现、多机型；#530 安卓镜像，iOS 键盘覆盖式 env() 仍报 Home 指示条 34px）====
  { name: '#556a iOS 键盘在场判据（删/改＝键盘期仍回落 env(safe-area-inset-bottom) 的 Home 指示条值，白带复发；判据与 syncVvFit 摘 --mochi-ios-h 同源）', file: 'js/mobile-adapt.js', needle: "if (_kbActive || _iProv || _kbNowLike()) { // #556 键盘在场判据（与 syncVvFit 摘 --mochi-ios-h 同源）" },
  { name: '#556b 键盘期把 --mochi-safe-bottom 钉 0px（删掉＝iOS 输入栏底部留出 34px 级不受页面控制的白带；收起摘除回落 env，语义同函数内下方 removeProperty 分支）', file: 'js/mobile-adapt.js', needle: "if (cur !== '0px') d.style.setProperty('--mochi-safe-bottom', '0px'); // #556 键盘期钉 0" },
  { name: '#556c 键盘开启路径显式归零（iOS vv resize 偶发漏触发，事件驱动的 healViewport 不保证及时跑；删掉＝漏触发时白带复现）', file: 'js/mobile-adapt.js', needle: "syncSafeBottom(); // #556：键盘开启即归零（收起 restoreKb 摘除回落 env）" },
  // ==== 2026-09-15 #527 桌面/聊天美化数据完整性（漏键 / 导入静默 / 刷新丢大图 / 撤销串桌面）====
  { name: '#527a BEAUTY_KEYS 补齐 5 个历史漏键（phone-bg-pos-x/-y/-size、phone-bg-solid、app-name-color 不在采集清单=存方案再应用时壁纸定位缩放/纯色/图标文字色静默蒸发，删掉此行即整族回归）', file: 'js/personalize.js', needle: "'phone-bg', 'phone-bg-preset', 'phone-bg-solid', 'phone-bg-pos-x', 'phone-bg-pos-y', 'phone-bg-size'," },
  { name: '#527b 应用方案如实返回写入项数（返回 n 供导入方报「已导入 N 项」；改回无返回值＝又回到无条件报「已导入」的静默假成功）', file: 'js/personalize.js', needle: "localStorage.setItem('xy-home-v2:theme-mode', data['__theme__']); } catch (e) {} n++;" },
  { name: '#527c 方案用途标记（方案 JSON 无 __kind__ 时可把聊天美化粘进桌面导入框、命中 0 项仍报成功；删掉＝假成功复发）', file: 'js/personalize.js', needle: "const BEAUTY_KIND = 'mochi-desk-beauty';" },
  { name: '#527d 导入前先预检命中项数（命中 0 项即提前返回：不备份/不压撤销栈/不刷新，免generate垃圾备份；删掉＝零命中数据也生成「导入前备份」并刷新）', file: 'js/personalize.js', needle: 'if (!hit) {' },
  { name: '#527e 刷新前等大键 IDB 落盘（大键只进 IDB 且写日志不覆盖 >64KB 值、无 LS 兜底；直接 reload＝慢机上 4.5MB 壁纸刷新后丢，用户报「提示导入成功但壁纸没了」）', file: 'js/personalize.js', needle: 'const reloadAfterBeautyWrite = () => {' },
  { name: '#527f 撤销栈写入端改 per-cid（存全局根键＝在 A 桌面调完美化、切到 B 点撤销会把 A 的美化写到 B 桌面上，跨桌面串美化）', file: 'js/personalize.js', needle: "const setUndoStack = (st) => { try { store.set(UNDO_KEY, JSON.stringify(st)); } catch (e) {} };" },
  { name: '#527g 导入前自动备份读回校验（saveSchemesList 吞异常＋toast 报成功＝用户以为有安全网其实没有；删掉＝假报成功复发）', file: 'js/personalize.js', needle: 'if (saved) { backupName = name;' },
  { name: '#527h 导入前备份数量上限（每导入一次多存一份含 base64 壁纸的整份美化且无清理＝配额无限膨胀；删掉＝膨胀复发）', file: 'js/personalize.js', needle: 'if (autos.length >= 5) {' },
  { name: '#527i 分享链接剔除 base64 图片键并设长度上限（原实现把带 4.5MB 壁纸的整份美化塞进 URL hash 必被截断、解析失败还被 catch 吞掉＝静默发坏链接）', file: 'js/personalize.js', needle: 'const isBeautyImageKey = (k) => /^(phone-bg|page-bg-|card-bg-|desk-image-src-|phone-bg-item-)/.test(k);' },
  { name: '#527j 聊天美化导入补「导入前备份」安全网（此前直接覆盖、无备份无撤销；删掉＝聊天美化导入变回无安全网）', file: 'js/chat-settings.js', needle: 'const chatBackupBeforeImport = () => {' },
  { name: '#527k 聊天美化用途标记 + 命中计数（同桌面侧：无标记时跨用途 JSON 导入假报成功）', file: 'js/chat-settings.js', needle: "const CHAT_BEAUTY_KIND = 'mochi-chat-beauty';" },
  // 颜色行显示当前值（用户报「看不懂美化设置」的最大来源：非默认值时行右侧被写空字符串）
  { name: '#527l 美化页颜色行统一显示当前值+色块（原实现非默认值写空字符串＝选完颜色行里一片空白，看不出是否生效也看不出当前色；删掉 paintBeautyVal 即回归）', file: 'js/personalize.js', needle: 'function paintBeautyVal(el, color, defaultColor, defaultLabel) {' },
  { name: '#527m 边看边调改紧凑底部条（原为右侧 70vw 浮层＝手机 390px 宽挡住 70% 而桌面居中，用户几乎看不到效果；后 56vh 抽屉＋每行原生取色器仍有遮挡，真机反馈「还是没用，把全部基本遮挡完了」→ 44vh＋分区胶囊＋就地调色盘；2026-09-16 换锚：needle 不再钉高度数值——44vh 已被同批有意调至 40vh，第二次被调参弄断，锚收到固定底部条定位段）', file: 'js/personalize.js', needle: "d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:95;max-height:" },
  // 2026-09-16：needle 由 #587 会话收窄（跨域一行，理由见 WORKLOG）——原 needle `'#beauty-drawer'];"`
  // 要求抽屉是 FLOAT_SELECTORS 的**最后一个元素**，并行会话在组尾追加 `'#icon-fit-panel'` 后即失配，
  // 而修复本体（'#beauty-drawer' 在清单里、观察器按清单锁滚动）一直在＝误报。收窄为成员锚：删掉该成员
  // 即断，组尾再追加元素不再误伤。属主若需更严口径可再改这一行。
  { name: '#527n 边看边调底部抽屉登记进 FLOAT_SELECTORS（未登记＝抽屉打开后底层桌面仍可被滑动，未锁背景滚动）', file: 'js/mobile-adapt.js', needle: "'#beauty-drawer'" },
  // ==== 2026-09-15 #531 自定义字卡池分类修正（颜文字/符号卡占满文字池 → 联系人只发颜文字）====
  { name: '#531a 文字池可读性判定（含中文/假名/字母/数字才算可读句子；改坏/删掉＝符号池重新被当成有正文）', file: 'js/chat.js', needle: 'function chatHasReadableTextCard(arr) {' },
  { name: '#531b 自定义卡分类接线走新判定（emoji 补 BMP 符号区、颜文字补无括号形态；改回旧内联正则＝符号卡重新落进文字池）', file: 'js/chat.js', needle: 'if (chatIsEmojiCard(c)) emoji.push(c);' },
  { name: '#531c 主动消息按可用分类归一化权重（原固定累计阈值 15/25/40/55 在贴纸/图片池为空时把颜文字顶到 40%、emoji 15%＝用户「联系人连发颜文字」；改回固定阈值即回归）', file: 'js/chat.js', needle: '[pool.kaomoji.length ? 15 : 0, () => ({ text: pick(pool.kaomoji), type: \'text\' })]' },
  { name: '#531d 信件正文可读性判定（自定义文字池全是颜文字/符号时退回系统预设正文；改回 pool.text.length > 0＝信件又被符号占满）', file: 'js/mail.js', needle: "const hasCustom = pool.text.some(s => typeof s === 'string' && /[A-Za-z0-9\\u4e00-\\u9fff\\u3041-\\u3096\\u30a1-\\u30fa]/.test(s));" },
  // ==== 2026-09-15 #532 字卡使用状态自检（设置→工具 #row-card-audit）====
  { name: '#532a 一键修复批量执行器（删掉＝「一键修复系统预设可用」点了不生效，问题分类仍不可用）', file: 'js/card-audit.js', needle: 'bulkFixes.forEach(function (id) { try { if (fixMap[id]) fixMap[id](); } catch (e) {} });' },
  { name: '#532b 字卡数据健康探针（删掉＝自检第九节「丢失图卡/超大图/坏语音」读数恒 0，坏卡查不出）', file: 'js/chatcard.js', needle: 'window.__ccAuditHealth = function () {' },
  { name: '#532c 大库未取回提示·「加载完整字卡」接线（删掉＝字卡未从 IDB 取回时用户无法手动取回，自检可用数一直偏少、不可信）', file: 'js/card-audit.js', needle: "window.hydrateLibScopes(['public', 'own'], function () { render(); toast('已取回完整字卡，重新自检完成'); });" },
  // ==== 2026-09-15 #533 链接导入的媒体字卡（裸 http(s) 图链）漏进文字池 → 联系人把图片 URL 当文字发出（聊天 + 信箱）====
  // 根因：图床不允许跨域时卡片按原始链接保存（存于字卡库【表情包/图片】分类），旧三道
  // 守卫只挡 data:/|||/@@m: 令牌，URL 形态被当文字卡抽中 → 气泡/信纸直出「http://…png」。
  // 各池（聊天 getPool / 信件 mailCardPool / 群聊 gcPool / 朋友圈 cardPool / 每日留言 /
  // 互动回应）统一补「URL 不进文字池」守卫；媒体池仍照常按 URL 渲 <img>（需联网）。
  { name: '#533a 聊天文字池排除 URL 媒体卡（删/改＝联系人重新把图链当文字发进聊天气泡）', file: 'js/chat.js', needle: 'if (typeof c === \'string\' && /^https?:\\/\\//i.test(c)) return;\nif (chatIsEmojiCard(c)) emoji.push(c);' },
  { name: '#533b 信件文字池排除 URL 媒体卡（删/改＝写信抽中图链、信纸正文直出 http 链接）', file: 'js/mail.js', needle: 'function mailTextOnly(c) {\nif (typeof c !== \'string\' || !c) return false;\nif (c.indexOf(\'data:\') === 0) return false;\nif (c.indexOf(\'|||\') >= 0) return false;\nif (c.indexOf(\'@@m:\') >= 0) return false;\nif (/^https?:\\/\\//i.test(c)) return false;' },
  { name: '#533c 群聊文字池排除 URL 媒体卡（删/改＝群成员把图链当文字发进群）', file: 'js/group-chat.js', needle: 'if (/^https?:\\/\\//i.test(c)) return; // 图链卡不进群聊文字池' },
  { name: '#533d 朋友圈文字池排除 URL 媒体卡（删/改＝TA 把图链拼进动态/评论正文）', file: 'js/feed.js', needle: 'if (/^https?:\\/\\//i.test(c)) return; // 图链卡不进朋友圈文字池' },
  { name: '#533e 每日留言文字池排除 URL 媒体卡（删/改＝留言正文直出图链）', file: 'js/calendar.js', needle: 'if (c.indexOf(\'@@m:\') >= 0) return false;\nif (/^https?:\\/\\//i.test(c)) return false;' },
  { name: '#533f 互动回应/文字题答案池排除 URL 媒体卡（删/改＝TA 的回应把图链当话术发出来）', file: 'js/ta-ask.js', needle: '!/^https?:\\/\\//i.test(s) && !(window.mochiMediaIsToken && window.mochiMediaIsToken(s)) && s.trim());' },
  { name: '#533g 悬浮伴侣话术池排除 URL 媒体卡（删/改＝桌面悬浮伴侣把图链当台词说出来）', file: 'js/p2-features.js', needle: 's.indexOf(\'data:\') !== 0 && !/^https?:\\/\\//i.test(s) && !(window.mochiMediaIsToken && window.mochiMediaIsToken(s))); // FIX 2026-09-13 #394 令牌卡不进悬浮伴侣话术；FIX 2026-09-15 #533 URL 媒体卡同款排除' },
  // ===== #534 朋友圈/信箱「内容类型开关」+ 存量图片直链消息自愈 =====
  // 现象（用户，iPhone 15 Safari 添加到桌面，明说其他机型也有）：①朋友圈与信箱把颜文字/
  // 表情包全禁了仍出现；②联系人发来的消息本该是图片，气泡里却是一整段图片直链。
  // 根因一（开关只管一半）：信箱 ml-*-en 只挡了 taLetterContent 的两处「附加」，
  //   pickDefaultMailCard 仍按分类占比把颜文字/emoji 注入正文；朋友圈压根没有
  //   类型开关，TA 评论/回复的颜文字/emoji 是写死 15% 概率。修法＝把开关下沉到
  //   池这一层（清池），任何消费方都取不到。
  // 根因二（图链当文字）：链接导入的字卡（裸 http(s) 图链）曾被当文字卡抽出并
  //   以 type:'text' 落库，气泡直出 URL。#533 堵住入库口，这里补渲染/归一化自愈。
  { name: '#534a 聊天图片直链识别只认「带图片扩展名的单条直链」（改成宽松判定＝普通网址被误当图片裂图）', file: 'js/chat.js', needle: 'return /^https?:\\/\\/[^\\s"\'<>]+\\.(?:png|jpe?g|gif|webp|bmp|avif|svg)(?:[?#][^\\s"\'<>]*)?$/i.test(s.trim());' },
  { name: '#534b 存量图片直链消息渲染自愈（删/改＝历史乱码消息又整段 URL 糊在气泡里）', file: 'js/chat.js', needle: 'const __urlImg = !__blankMsg && chatIsImageUrlCard(__rawText);' },
  { name: '#534c 存量图片直链消息入库自愈补 type=image（删/改＝刷新后仍当文字消息，只靠渲染兜底）', file: 'js/chat.js', needle: 'if (r && (r.type === \'text\' || !r.type) && typeof r.text === \'string\' && (r.text.indexOf(\'data:image/\') === 0 || chatIsImageUrlCard(r.text))) {' },
  { name: '#534d 朋友圈内容类型开关下沉到池层（删/改＝关了颜文字，TA 评论/回复照样按写死 15% 发颜文字）', file: 'js/feed.js', needle: 'if (!feedTypeOn(cid, \'kaomoji\')) kaomoji.length = 0;' },
  { name: '#534e 信箱内容类型开关下沉到池层（删/改＝关了颜文字，系统预设补池仍按分类占比注入正文）', file: 'js/mail.js', needle: 'if (!tcfg.kaomojiEn) { kaomoji.length = 0; defKaomoji.length = 0; }' },
  { name: '#534f 信箱默认字卡注入权重同步受内容类型开关约束（删/改＝关掉的分类仍占抽签权重）', file: 'js/mail.js', needle: 'if (k === \'kaomoji\' && !mcfg.kaomojiEn) return 0;' },
  { name: '#534g 朋友圈内容类型开关默认键登记（删/改＝老用户键缺失回落默认=开关形同虚设）', file: 'js/reply-settings.js', needle: "'fd-kaomoji-en': 1, 'fd-emoji-en': 1, 'fd-sticker-en': 1, 'fd-image-en': 1," },
  { name: '#534h 朋友圈「内容类型开关」设置行锚点（删/改＝用户无入口关闭颜文字/表情包）', file: 'template.html', needle: 'id="fd-kaomoji-en"' },
  // ==== 2026-09-15 #538 iOS 上「信件 / 向他提问」输入框打字一直上弹 + 每字闪字（iPhone 17 Safari，
  //      用户明说其他设备型号也有、要求不要覆盖修改引发跨机型回归）——三条根因全部零机型分支，
  //      判据是「能力/结果」而非设备型号，故一台修好即全平台收敛；三条各自登记逻辑锚点 ====
  // ① 诊断输入轨迹遥测逐字同步写 localStorage（iOS WebKit 同步存储写阻塞主线程/合成提交，
  //    卡在输入法提交那一刻＝每字一闪）。锚点＝「事件里只入内存缓冲 + 节流落盘」这个表达式：
  //    退回 ringPush(直写) 或删掉节流即失配。
  { name: '#538a 输入轨迹遥测改节流落盘（退回逐字 localStorage.setItem＝iOS 每敲一字卡顿闪一下；安卓/桌面同源）', file: 'js/device.js', needle: 'arr = arr.concat(_inpBuf);' },
  { name: '#538b 输入轨迹节流定时器（删/改直写＝遥测回到输入热路径，「每字闪字」复发）', file: 'js/device.js', needle: 'if (!_inpFlushT) _inpFlushT = setTimeout(inpFlush, 400);' },
  { name: '#538c 诊断报告生成前先 flush 输入轨迹（删＝用户刚打完字就点诊断会看不到最后几条，诊断口径缩水）', file: 'js/device.js', needle: 'try { if (window.__diagInpFlush) window.__diagInpFlush(); } catch (eF) {}' },
  // ② 问问TA 半框「合成层刷新」本是安卓 ce-box 专用（安卓才把文本框转 contenteditable，
  //    半框平移时文字合成层停旧位）；实现无平台/能力判定，iOS 也照跑 → 对聚焦中的原生
  //    input 反复 toggle transform + void offsetHeight 整页 reflow＝「一直上弹 + 逐字闪」。
  //    锚点＝「无 __ceBox（非安卓 ce-box）就不做」这条判定，三处调用点各一。
  { name: '#538d 合成层补救只对 ce-box 生效·判定函数（删/改恒真＝iOS 原生输入框又被逐字 toggle transform+整页 reflow＝问问TA 输入框一直上弹/闪字）', file: 'js/chat.js', needle: 'function askBoxNeedsLayerFix(box) { try { return !!(box && box.__ceInp); } catch (e) { return false; } }' },
  { name: '#538e 合成层补救·无 ce-box 不装监听定时器（删＝iOS 空转 vv.resize 监听 + 160ms 防抖 reflow）', file: 'js/chat.js', needle: 'if (!askBoxes().some(({ box }) => askBoxNeedsLayerFix(box))) return;' },
  { name: '#538f 合成层补救·防抖回调内不再对原生输入框强制 reflow（删＝每字/每次 vv 抖动一次整页重排）', file: 'js/chat.js', needle: 'if (!askBoxNeedsLayerFix(box)) return; // #538：原生输入框不进整页 reflow' },
  // ③ nudgeInputVisible 几何记忆键含容器底边（可视视口相关量）——iOS 输入法候选条逐字显隐
  //    改可视高→键恒变→记忆恒失效→看门狗每 250ms 重写 scrollTop 把用户拉回「输入框可见」位
  //    ＝「无法拉到顶部停留」。锚点＝新的容器内部几何键 + 用户已滚过不补位。
  { name: '#538g 补位记忆键只留与可视视口无关的容器内容几何（含容器底边 sr.bottom 等视口量＝iOS 候选条逐字显隐键就变、记忆闸失效，看门狗每 tick 把用户滚动位拽回＝打一个字弹一下）', file: 'js/mobile-adapt.js', needle: "var geomKey = Math.round(sr.width) + 'x' + Math.round(scroller.scrollHeight);" },
  { name: '#538h 补位需「真键盘量级」视口变化 + 稳态早退（≥90px：真键盘 ≈200~300px 仍补位；iOS 候选条 ≈44px、工具条伸缩等小抖动忽略。删/改回无阈值判定＝#501 拽回与 #535 逐字上弹双双复发）', file: 'js/mobile-adapt.js', needle: 'if (scroller.__nudgeGeom === geomKey && Math.abs(vhNow - (scroller.__nudgeVH || vhNow)) < 90) return;' },
  // #536 单聊气泡样式/对比度自愈「作用域泄漏」到群聊（用户报「群聊里我发消息整个框变黑看不到字」，
  //   与 #107/#223/#252 同族第 N 次复发——单聊两处注入用全局 .msg-out/.msg-in 选择器，群聊页复用
  //   同一套类名却有自己的 --msg-* 变量，于是单聊配色会把群聊我的气泡写成黑字黑底）。
  //   锚点＝注入串里的页面作用域前缀，改回全局（去掉前缀）即失配。
  { name: '#536a 单聊自愈出站规则带 #page-chat 页面作用域（去掉前缀＝全局 .msg-out 又命中群聊＝群聊我的气泡黑底黑字看不见）', file: 'js/chat-settings.js', needle: "rules.push('#page-chat .msg-out .msg-bubble.msg-bubble,#page-fav .msg-out .msg-bubble.msg-bubble{color:'" },
  { name: '#536b 单聊自愈入站规则带 #page-chat 页面作用域（同上，去掉前缀＝群聊联系人气泡被单聊配色覆盖）', file: 'js/chat-settings.js', needle: "rules.push('#page-chat .msg-in .msg-bubble.msg-bubble,#page-fav .msg-in .msg-bubble.msg-bubble{color:'" },
  { name: '#536c 单聊自定义气泡 CSS 映射 scope 传 #page-chat（改回空串＝全局选择器，单聊上传的气泡模板套进群聊）', file: 'js/chat-settings.js', needle: "mochiMapBubbleCss(css, '#page-chat ')" },
  { name: '#536d 单聊自定义气泡 CSS 无 mochiMapBubbleCss 时的兜底分支同样带 #page-chat（漏前缀＝兜底路径又回全局）', file: 'js/chat-settings.js', needle: "out = '#page-chat .msg-out .msg-bubble{' + css + '!important;}' +" },
  // ==== 2026-09-15 #541 开屏期仍逐帧合成被完全盖住的桌面（「iPhone 各机型开屏滑动/停留总是卡」）====
  // 现象（用户，iPhone 15 Pro Max + Safari PWA；明说其他设备型号也有，要求不要覆盖修改引发跨机型回归）：
  //   开屏期间（每日首次强制展开全文，公告高 11000+px，必须滑到底才能进入）滑动/停留明显卡顿。
  // 根因（零机型分支，无头 WebKit 引擎实测，非主观）：开屏是 position:fixed / z-index:999 /
  //   background:var(--card-bg) 的整屏【不透明】层，视觉上完全盖住 .phone；但 WebKit 不按 z 序
  //   裁剪被盖住的层，仍逐帧合成其下的 .phone（14k 节点 + 壁纸层 + 三页合成层）。实测置 .phone
  //   为 visibility:hidden 后：开屏滚动帧耗时 mean 137→96ms、空闲 p90 122→78ms；同一环境等价
  //   平凡长列表稳定 60fps——即这笔开销是「被盖住仍在付费」，不是开屏自身内容成本。
  // 方案：纯 CSS 兄弟选择器（template 里 .splash 本就是 .phone 的前序同级兄弟）。clock.js hide()
  //   一加 .hide 本规则当帧失效、桌面立即恢复可见（淡出过程正常露出桌面）；开屏 400ms 后整体移除，
  //   不存在残留隐藏态。visibility 不参与布局，启动期对 .phone 的尺寸测量照常；全站无
  //   visibility:visible 覆写。零机型分支：任何内核都只是少画一层被完全盖住的内容。
  // 锚点＝这条选择器本身（删掉或改成无条件隐藏即失配）。needle 须与 minifyCss 产物逐字一致
  //   （build.mjs 的 minifyCss 只去注释/空行、不压空白，故保留原空格与分号）。
  { name: '#541 开屏期遮挡被盖住的桌面（删/改＝WebKit 又逐帧合成被不透明开屏完全盖住的 .phone＝开屏滑动卡顿复发）', file: 'css/base.css', needle: '.splash:not(.hide) ~ .phone { visibility:hidden; }' },
  // #546 房间夜间黑屏（vivo X200S+Edge 报障，用户明说其他机型也有；时段相关非机型相关）：
  // lum() 夜间基础亮度曾被写成 0，新档无点灯时 --room-bright=0 → .r-scene brightness(0) 纯黑。
  // 锚点＝基础亮度表达式本体（改回带 isNight 的 0 基或改小数即失配）
  { name: '#546 场景基础亮度恒 1（夜间从 0 起算＝没开灯进房 brightness(0) 纯黑）', file: 'js/room.js', needle: 'let v = 1;' },
  // 锚点＝CSS 兜底下限表达式（删掉 max() 兜底＝任何来源的 0 值又能把场景打成纯黑）
  { name: '#546 场景亮度 CSS 兜底下限 .45（--room-bright 为 0 也不许渲染成纯黑）', file: 'css/room.css', needle: 'brightness(max(var(--room-bright, 1), .45))' },
  // ==== 2026-09-15 #544 帮我决定/多人决定答案发到聊天被收件侧去重静默吞掉（红米 K80 Chrome 报「联系人发送的消息被吞了几条」，明说其他机型也有；纯时间窗判定零机型分支）：
  // 决策答案以 side:'in' 纯文本落聊天，快速重跑同一问题抽中同结果时同文撞进 addRec 收件侧 2500ms 文本窗被静默吞（in 侧无 toast＝用户零感知），
  // 且扫描只看最近 5 条时间差、第 1 条被吞后窗口不闭合＝连锁吞掉后续同文答案（「吞了几条」）。
  // 修复：chatAddIn 新 opts.dedupExempt 决定答案专用豁免——addRec 实时扫描跳过 + normCollapseRange 刷新归一化同口径豁免（#256 屏上所见即刷新后所见）；
  // TA 批次防同款去重与 out 侧 #437 反馈零改动。行为断言 tools/verify-decision-dedup-exempt.mjs（修前产物 RED 1/5＝症状复现） ====
  { name: '#544 addRec 实时去重豁免闸（删则决定答案快速重跑同文撞 2500ms 窗被静默吞＝「联系人消息被吞了几条」复发）', file: 'js/chat.js', needle: 'i >= Math.max(0, len - 5) && !rec.dedupExempt' },
  { name: '#544 刷新归一化豁免（normCollapseRange，删则刷新后带标记答案仍会被相邻合并回吞＝屏上所见≠刷新后所见）', file: 'js/chat.js', needle: 'if (a.dedupExempt || b.dedupExempt) continue; // FIX 2026-09-15 #544' },
  { name: '#544 帮我决定答案带豁免标记发送（删则决策结果重新裸奔进去重窗＝吞答案复发）', file: 'js/decision.js', needle: '{ enter: true, silent: true, follow: true, dedupExempt: true }); // FIX 2026-09-15 #492 帮我决定结果' },
  { name: '#544 多人决定答案带豁免标记发送（删则决策结果重新裸奔进去重窗＝吞答案复发）', file: 'js/group-decision.js', needle: '{ enter: true, silent: true, follow: true, dedupExempt: true }); // FIX 2026-09-15 #492 多人决定结果' },
  // ==== 2026-09-16 #547 表情包面板「每次打开都重新加载」复发 + 拍卖会页面显示不全（小米15Pro Chrome 等多机型同发，用户明说其他设备型号也有）：
  // ①表情面板：#457 内容指纹短路被「令牌化翻转」废掉——池视图卡被 ccTokenizeGiantMedia 异步令牌化
  //  （dataURL→@@m:token）后原文变了、显示没变，按原文签名误判内容变化→整面板 innerHTML 重建+全部图
  //  走媒体池重新解析＝每次开面板都重载一遍；大库令牌化 pass 跑数秒，期间每次开面板都撞上。
  //  修法=签名改走令牌稳定身份（chatcard.js ccTokMemoRev/ccMediaCardIdent：原始大图卡与令牌卡同一短指纹）。
  // ②我的表情包：openEmojiPanel 每次无条件 reloadMyEmojiFromIdb——大库（18MB 级、IDB-only）每开一次
  //  面板白付一次 idbGet+JSON.parse＝「每次打开都像在加载」。修法=__myeIdbApplied 且内存非空即跳过。
  // ③拍卖会：成交/TA拍得/流拍/扣款失败/本场结算浮层弹在 .au-stage（高=拍品卡 ~160px）内，
  //  .pong-overlay overflow:hidden+居中＝内容超高被上下双端裁剪且无法滚动（#381 只转了背包/记录）。
  //  修法=装得下照旧居中，装不下 safe center（顶对齐）+浮层自身可滚；#au-intro/#au-help 全屏层同族兜底。
  // 行为断言 tools/verify-emoji-panel-reopen.mjs + tools/verify-auction-overlay-fit.mjs ====
  { name: '#547a 表情面板签名走令牌稳定身份（删/改回原文签名＝池视图令牌化翻转后签名失配、每次开面板全量重建 img＝图片每次重载复发）', file: 'js/chat.js', needle: "var _ident = (typeof window.ccMediaCardIdent === 'function') ? window.ccMediaCardIdent : null;" },
  { name: '#547b 令牌→短指纹反查登记（删则 memo 预算淘汰后令牌卡身份回退原文截断＝签名翻转重建复发）', file: 'js/chatcard.js', needle: 'ccTokMemoRev.set(tok, ccMediaFrag(j.body));' },
  { name: '#547c 我的表情包开门闸（删＝18MB 级库每次开面板 idbGet+JSON.parse 白付一遍＝「每次打开都像在加载」复发）', file: 'js/chat.js', needle: 'if (window.__myeIdbApplied === true && Array.isArray(myGroups) && myGroups.length) return;' },
  { name: '#547d 拍卖结果浮层防双端裁剪（删则内容超高被 overflow:hidden 居中裁剪＝拍卖会页面显示不全复发）', file: 'css/chat-pages.css', needle: '#au-overlay:not(.au-ov-fs) { overflow-y:auto; justify-content:center; justify-content:safe center; }' },
  { name: '#547e 拍卖全屏教学/玩法层同族防裁剪（删则横屏矮视口/大字体下开场教学按钮被裁）', file: 'css/chat-pages.css', needle: '#au-intro, #au-help { overflow-y:auto; justify-content:center; justify-content:safe center; }' },
  { name: '#547f 落池竞态不标缺失（删则面板渲染先于 flush 读池未中→令牌被标 missing→贴纸被剔出面板变少/消失+签名数量骤变重建＝每次打开重载复发；行为断言 verify-emoji-panel-reopen B 组）', file: 'js/media-pool.js', needle: 'if (writeBuf[wi] && writeBuf[wi].k === FULL + h) { pending = true; break; }' },
  // ===== 2026-09-16 小游戏细节优化批次（#548，行为断言 tools/verify-arcade-games-detail.mjs 72 项） =====
  { name: '#548a 游乐室幸运池补钓鱼/合作扫雷/打砖块（删则三款游戏幸运日×2/打卡/聚合继续缺席）', file: 'js/arcade.js', needle: "{ k: 'fishing', name: '双人钓鱼' }, { k: 'ms', name: '合作扫雷' }, { k: 'brick', name: '双人打砖块' }" },
  { name: '#548b 贪吃蛇战绩键改读 snake-score（改回 snake-stats＝「游戏体验官」徽章永远统计不到贪吃蛇复发）', file: 'js/arcade.js', needle: "snake: 'snake-score'" },
  { name: '#548c 贪吃蛇 rAF dt 钳 250ms（删则切后台回来蛇数十倍速狂奔到撞死复发）', file: 'js/snake-game.js', needle: 'Math.min(now - lastFrameTime, 250)' },
  { name: '#548d 贪吃蛇切后台自动暂停+存档（删则 iOS 后台杀页面丢进行中对局复发）', file: 'js/snake-game.js', needle: "document.hidden && state && state.status === 'playing') { saveGame(); togglePause(); }" },
  { name: '#548e Pong rAF dt 钳 250ms（删则切后台回来球快进自动打完整局复发）', file: 'js/pong.js', needle: 'const dt = Math.min(ts - lastTs, 250);' },
  { name: '#548f Pong 输局发平局档（改回与胜局同额＝输赢奖励无差别+与注释口径不符复发）', file: 'js/pong.js', needle: '(playerWin ? pongWinFen : 520)' },
  { name: '#548g 打砖块跨刷新存档键（删则中途退出/刷新丢整局、三球类口径不齐复发）', file: 'js/breakout.js', needle: "':brick-saved'" },
  { name: '#548h 打砖块 serve/clearing 回场缓冲（删则后台回场 serveAt 已到点秒发球无准备复发）', file: 'js/breakout.js', needle: "if (state && !paused && running && (state.status === 'serve' || state.status === 'clearing')) {" },
  { name: '#548i 记忆翻牌先记账后发钱、写失败不发（删则配额异常封顶计数丢失反复领满复发）', file: 'js/memory-game.js', needle: "try { localStorage.setItem(storeKey('memory-coin-day'), JSON.stringify(daily)); } catch (e) { return 0; }" },
  { name: '#548j 记忆翻牌幸运日×2（删则幸运横幅推荐但×2 永不生效复发）', file: 'js/memory-game.js', needle: 'grantCoins(totalYuan * memMult)' },
  { name: '#548k 四子棋落子动画回调不在面板隐藏时补调度（删则关面板 TA 隐形下完一子复发）', file: 'js/connect-four.js', needle: 'if (!panel.hidden) scheduleTaMove(' },
  { name: '#548l 合作扫雷幸运日×2（删则 ms 不在游乐室体系复发）', file: 'js/coop-mine.js', needle: 'grantCoin((base + flawless) * msMult)' },
  { name: '#548m 钓鱼 ¥104 日封顶（删则深渊王 ¥200/条无限刷、与其他游戏口径不齐复发）', file: 'js/fishing.js', needle: "writeJSON('fishing-coin-day', { date: todayKey(), used: used + real });" },
  { name: '#548n 钓鱼结算文案 keep 保留 2.5s（删则收竿/跑鱼提示被 render 同帧清空＝用户看不到复发）', file: 'js/fishing.js', needle: 'statusEl._keepT = setTimeout(' },
  { name: '#548o 小游戏发奖日封顶键本地日期（改回 toISOString＝北京时间 0-8 点奖励记到前一天复发；rps/snake 走此函数）', file: 'js/chat.js', needle: "const k = 'ml2_coin_' + gameKey + '_' + rpLocalDay();" },
  { name: '#548p 贪吃蛇奖励接幸运日×2（删则 lucky 日 snake 奖励不翻倍复发）', file: 'js/chat.js', needle: "const snkMult = (window.arcadeMult && window.arcadeMult('snake')) || 1;" },
  { name: '#548q 拍卖落槌扣款-入库原子性（删则 persist 写失败时钱扣了收藏没进复发）', file: 'js/auction.js', needle: 'if (!persist(bagKey(), bag) || !persist(statsKey(), s)) {' },
  { name: '#548r 拍卖 hammer 防二次扣款守卫（删则确认弹窗期间 TA 折价自动落槌后用户再确认＝双扣复发）', file: 'js/auction.js', needle: "if (!st || st.phase !== 'bidding') return;" },
  { name: '#548s 连连看结算展示实际入账（删则王者/传奇档标称 ¥131.4/¥334.4 超封顶被静默削＝虚标复发）', file: 'js/linkup.js', needle: 'var nominal = Math.round(DIFFS[st.diff].coin * mult);' },
  { name: '#548t 五子棋换联系人清 st（删则 A 桌面棋局在 B 桌面命名空间打完、战绩串档复发）', file: 'js/gomoku.js', needle: 'st = null; /* #548t */' },
  { name: '#548u 消消乐换联系人清 st（同 #548t 族）', file: 'js/match3.js', needle: 'st = null; /* #548u */' },
  { name: '#548v 连连看换联系人清 st（同 #548t 族）', file: 'js/linkup.js', needle: 'st = null; /* #548v */' },
  // ==== 2026-09-16 #549 新手引导 / 设置搜索直达功能大全 / 字卡库空状态可点 ====
  { name: '#549a 新手引导弹层入口（删则窗口函数消失、设置行点了没反应）', file: 'js/onboarding.js', needle: 'window.openMochiGuide = function () { build(); mask.hidden = false; };' },
  { name: '#549b 设置搜索直达功能大全跳转行（删则搜索只能筛设置行）', file: 'js/personalize.js', needle: "jumpBtn.textContent = '在「功能大全」中搜索“' + inp.value.trim() + '” →';" },
  { name: '#549c 功能大全带入关键词入口（删则设置搜索点了跳不过去）', file: 'js/feature-hub.js', needle: "window.mochiFeatureHubOpen = function (kw) { openHub('setting', kw); };" },
  { name: '#549d 字卡库空状态可点（删则空列表退回死胡同、只剩一句提示）', file: 'js/chatcard.js', needle: 'if (list && !list.__ccEmptyActBound) {' },
  // ==== 2026-09-16 #577 昵称分「桌面 / 聊天」两套（用户反馈：引导没说清两者独立、需各自设置） ====
  // 纯文案修复，needle 就是需求本身：这段说明被删/被改回「点桌面顶部改名」即回归。
  { name: '#577a 引导写明桌面 / 聊天昵称是两套且不同步（删则又只剩「点桌面改名」，聊天里显示默认「我」「TA」无人解释）', file: 'js/onboarding.js', needle: '两套、互不同步' },
  { name: '#577b 引导步骤内补充提示块（删则 warn 文案不再渲染＝回到只有一句 d）', file: 'js/onboarding.js', needle: 's.warn ? ' },
  { name: '#577c 功能介绍·快速开始写明聊天昵称要单独设（删则又只说「设置双方昵称、头像」）', file: 'template.html', needle: '聊天里显示的名字 / 头像与它<b>互相独立、不会同步</b>' },
  { name: '#577d 聊天设置「昵称与头像」标题标注聊天专用（删则设置页不提与桌面独立，用户仍以为改桌面即生效）', file: 'template.html', needle: '昵称与头像（聊天专用 · 与桌面各自独立，互不同步）' },
  { name: '#577e 功能大全昵称条目关键词补「桌面昵称 / 不同步」（删则搜「桌面昵称」找不到这两条）', file: 'js/feature-hub.js', needle: '昵称 名字 联系人 改名 聊天昵称 桌面昵称 不同步 不一样 没变 显示 TA' },
  // ---- #577b 用户追加（2026-09-16）：「聊天里的更换头像，你没说可以直接在聊天设置里更换，
  //      或在聊天输入栏左边打开更多功能里的【头像互动】上传头像库可互动」——漏了头像互动这条换聊天头像的路 ----
  { name: '#577f 引导写明「更多功能 → 头像互动」换聊天头像快路（删则只剩聊天设置一条路，头像互动没人知道）', file: 'js/onboarding.js', needle: '聊天头像另有一条快路' },
  { name: '#577g 引导 tip 提示块渲染分支（删则 tip 文案不再渲染）', file: 'js/onboarding.js', needle: 's.tip ? ' },
  { name: '#577h 功能介绍·快速开始补头像互动路径（删则又只剩「聊天设置 → 形象」一条）', file: 'template.html', needle: '头像互动</b>——上传多张头像库、点图即换' },
  { name: '#577i 功能大全「头像互动」条目说明与关键词（删则搜「头像库 / 随机换头像」找不到）', file: 'js/feature-hub.js', needle: '换聊天头像：上传多张头像库、点图即换' },
  // ==== 2026-09-16 #550 设置页搜索精准化（跨域登记：personalize.js 归 AI-B 本会话占用，见 WORKLOG） ====
  { name: '#550a 设置搜索取词剔除「功能说明」.tag 胶囊（删则搜功能/说明几乎全行命中回流）', file: 'js/personalize.js', needle: "c.querySelectorAll('.tag').forEach(x => x.remove());" },
  { name: '#550b 设置搜索口语词别名表（删则搜壁纸/通知/概率/夜间等 0 命中回流）', file: 'js/personalize.js', needle: "'深色模式': '夜间模式 暗色模式 黑暗模式 夜间 暗色 黑暗 黑色 主题 dark mode'" },
  { name: '#550c 设置搜索零命中空态提示（删则搜不到时页面静默无反馈）', file: 'js/personalize.js', needle: 'emptyTip.hidden = hits > 0;' },
  // ==== 2026-09-16 #551 清除本地数据清不空（红米 K70 Chrome 及多机型复发，#353 同族第二次） ====
  { name: '#551a 清除范围=全部 xy-home-v2 键（退回只清 activePrefix 则其他桌面/公用数据残留＝清不空复发）', file: 'js/personalize.js', needle: 'const wipeAppKeys = function () {' },
  { name: '#551b reload 前补刀全量 wipe（删则清窗口期内未挂屏障模块重写的键活过重置）', file: 'js/personalize.js', needle: 'idbDone.then(() => { wipeAppKeys(); try { location.reload(); } catch (e) {} });' },
  // ==== 2026-09-16 #552 设备兼容诊断报版本偏离量（用户直接指派；device.js 归 AI-B 域，见 WORKLOG） ====
  { name: '#552a 诊断「不一致」带落后量化（删则只说旧版不说差多少，开发者拿两个 ts 手算回流）', file: 'js/device.js', needle: "落后最新版' + devStr(r.ts - localTs)" },
  // ==== 2026-09-16 #559 经期预警按「语境 × 经期规律」分级：经前/推迟不再发经期中口吻；不规律者不说「推迟」改间隔口吻 ====
  { name: '#559a 经前预警 {d} 替换为距预测经期天数（删则经前预警不带日期参数）', file: 'js/period.js', needle: "String(line).replace(/\\{d\\}/g, String(diffDays(today, st.nextStart)));" },
  { name: '#559b 推迟预警 {d} 替换为已推迟天数（删则推迟预警不带日期参数）', file: 'js/period.js', needle: "String(line).replace(/\\{d\\}/g, String(delayDays));" },
  { name: '#559c 标签按语境区分（删则经前预警日又以「经期关心」标签发经期中口吻语料＝症状回流）', file: 'js/period.js', needle: "{ tag: kind === 'in' ? '经期关心' : '经期预警' }" },
  { name: '#559d 经前预警语料分组（删则经前预警日无专属预警语、字卡库缺该组）', file: 'js/default-cards-data.js', needle: '["经前预警", [' },
  { name: '#559e 规律分级判据（删则不规律用户也被当「预测可信」按推迟口径轰炸＝「太扯淡」回流）', file: 'js/period.js', needle: "if (s.n >= 3 && s.cv < 0.2) return 'rule';" },
  { name: '#559f 规律型推迟门 ≥5 天（删则规律用户推迟无预警）', file: 'js/period.js', needle: "if (tier === 'rule' && delayDays >= 5)" },
  { name: '#559g 不规律型改间隔口吻且 ≥10 天才提（删则对不规律用户说「推迟 N 天」＝预测误差比推迟还大）', file: 'js/period.js', needle: "else if (tier === 'free' && delayDays >= 10)" },
  { name: '#559h 经期推迟·不规律语料组（删则不规律推迟回落确定性口吻语料）', file: 'js/default-cards-data.js', needle: '["经期推迟·不规律", [' },
  { name: '#559i 深夜静默 23:00–06:00（删则半夜聊天 TA 会发经期预警把人叫醒；静默期不写 fired 故不吞当天名额）', file: 'js/period.js', needle: 'if (_h >= 23 || _h < 6) return; // #559 深夜静默（23:00–06:00 不发、不写 fired）' },
  // ==== 2026-09-16 #554（TASKS #128）字卡媒体令牌化持久化：库键内联图 → 池令牌（同图全库只存一份）====
  // 消费链路此前已就绪（#142 池/#377 内存令牌化/#506 GC 引用面+导出自包含/#532 自检令牌感知），
  // 本批补「存储键瘦身」两个写入口 + 用户入口；删除任一条即回归「同一张贴图存多份/体积回涨」。
  { name: '#554a 上传口令牌化（删/改＝新上传字卡图又整份内联进库键，44MB 级体积回涨复发）', file: 'js/chatcard.js', needle: "if (cur !== 'voice' && window.mochiMediaTokenize && typeof data === 'string' && data.length >= CC_CC_TOK_MIN) {" },
  { name: '#554b 迁移保险丝「不变小不写」（删/改＝异常场景可能把库写大/写坏）', file: 'js/chatcard.js', needle: 'if (!replaced || outStr.length >= raw.length) continue;' },
  { name: '#554c 迁移入口 mochiCcPersistTokenize（删＝查看存储「字卡图去重入库」永远提示不支持，存量内联图永不能瘦身）', file: 'js/chatcard.js', needle: 'window.mochiCcPersistTokenize = function (prog) {' },
  { name: '#554d 查看存储「字卡图去重入库」入口行（删＝用户无入口触发库键瘦身）', file: 'template.html', needle: 'id="st-cc-tokbtn"' },
  // ==== 2026-09-16 #560 字卡库瘦身整组删除写进双冒号垃圾键（#554 插桩时发现的存量 bug）====
  // storage-slim 的 libs 用 G='xy-home-v2:'（带尾冒号），mochiCcSlimDeleteGroup 里
  // xyStore(prefix).set 内部再拼 '':'+key ＝ 写出 xy-home-v2::cc-groups-public——真实键从未被改，
  // 删除报成功、刷新后分组复活（#170 上线以来的存量缺陷）。修＝剥尾冒号再进 xyStore。
  { name: '#560 瘦身删除剥 prefix 尾冒号（删/改回直拼＝删除又写 xy-home-v2:: 垃圾键、分组删除刷新即复活）', file: 'js/storage-slim.js', needle: "const pStore = String(prefix).replace(/:$/, '');" },
  // ==== 2026-09-16 #555 安卓平板判定（device.js 只认 iPad/Macintosh 触摸屏，安卓平板
  // 竖屏被当手机全屏拉宽、横屏掉进桌面 390px 外壳；用户指派「没做平板适配」）====
  { name: '#555 安卓平板判定（删/改＝安卓平板回到手机拉宽/390px 外壳双症状）', file: 'js/device.js', needle: '!/Mobile/i.test(ua) && Math.min(_tw, _th) >= 600' },
  // ==== 2026-09-16 #570 开屏新版检测（用户指派「独立的新版检测放开屏，显示现在是不是新版」；
  // 新文件 ver-check.js + pwa.js 暴露预取刷新链 + template/base.css 锚点样式；#550~#560 区段已被并行批次占用故跳取 #570） ====
  { name: '#570a 开屏检测行有新版分支（删则开屏永远不出「是不是新版」结论行，功能静默消失）', file: 'js/ver-check.js', needle: "set('stale', '⇩ 有新版本（落后' + gapStr(ts - localTs) + '）· 点此更新', true);" },
  { name: '#570b pwa 预取刷新链暴露给开屏（删则「点此更新」退回裸 reload＝弱网/iOS 刷完仍旧版）', file: 'js/pwa.js', needle: 'window.mochiRefreshNow = function () { refreshNow(); };' },
  { name: '#570c 开屏检测行静态锚点（删则 ver-check.js 找不到挂载点直接 return＝功能消失）', file: 'template.html', needle: 'id="splash-ver-check"' },
  // ==== 2026-09-16 #557 字卡库搜索精准化（跨域登记：chatcard.js 属 AI-A 业务，用户直派修「搜一个字多几个字全出现」，见 WORKLOG） ====
  { name: '#557a 字卡库搜索精确/开头/包含排序分节（删/换回私有实现＝与全站搜索语义漂移）', file: 'js/chatcard.js', needle: 'r.__rank = ms ? ms.rank(r.t, kw) : 2;' },
  { name: '#557b 字卡库多词搜索最长词为锚调注册方（删则多词整串当单词条恒 0 命中回流）', file: 'js/chatcard.js', needle: 'const anchor = ms ? ms.anchor(terms) : terms[0];' },
  { name: '#557c 字卡库多词中心 AND 复筛（删则锚词候选不筛其余词＝多词退化单词）', file: 'js/chatcard.js', needle: 'terms.every(function (w) { return t.indexOf(w) >= 0; })' },
  // ==== 2026-09-16 #558 表情面板「最近使用」（AI-A chat.js 单文件 + contacts.js 一行免迁；
  // 用户从清单点选小功能；#556 开屏检测/#557 字卡库搜索已被并行批次占用故顺延） ====
  { name: '#558a 最近使用点击记录（删/改＝点过的表情不再进「⏱最近使用」，功能静默失效）', file: 'js/chat.js', needle: "try { emojiRecordRecent(src); } catch (e0) {} // #558 最近使用：点击即记录（发送/插入都算）" },
  { name: '#558b 最近使用身份回查三池（删＝最近区永远空/显示死项，身份跨令牌化翻转失效）', file: 'js/chat.js', needle: 'function emojiRecentResolved() {' },
  { name: '#558c 最近分组渲染入口行（删＝面板分组条永远不出现「⏱最近使用」chip）', file: 'js/chat.js', needle: "[['__recent__', '⏱最近使用']]" },
  { name: '#558d emoji-recent 全局根键免迁（删＝每次刷新被 migrateLegacy 迁进 default 删根键，最近区非 default 桌面清空）', file: 'js/contacts.js', needle: "'emoji-recent'," },
  // ==== 2026-09-16 #560 全新浏览器冷启动桌面第三页顺序竞态（AI-B personalize.js 单函数；
  // 用户报「新浏览器打开第三页图标在上小组件在下，反了」，多机型随机复现；#556~#559 已被占用故顺延） ====
  { name: '#560a 无布局恢复按快照分页归位（删/改回逐个 appendChild＝池内小组件排到已在位 p3apps 后，第三页图标在上组件在下）', file: 'js/personalize.js', needle: '(byPage[it.page] = byPage[it.page] || []).push(it.wid);' },
  { name: '#560b 已在位且相对顺序与快照一致则整体跳过（删＝每次切桌面/回填重排抖动；改成恒重排＝破坏 #405 尊重用户摆放语义）', file: 'js/personalize.js', needle: 'return i === 0 || idx > Array.prototype.indexOf.call(slide.children, nodes[i - 1]);' },
  { name: '#560c 归位按快照原序依次插入（删则归位顺序退化为任意）', file: 'js/personalize.js', needle: 'if (addBtn) slide.insertBefore(n, addBtn); else slide.appendChild(n);' },
  // ==== 2026-09-16 #571 字卡回复延迟遥测（AI-A chat.js 单文件；用户报「字卡延迟反应卡顿5、6秒/3、4秒」
  // （iPhone 14 Pro Safari 等多 iOS 机型）——现场诊断 63fps/无长任务/字卡库 11KB，等待来自「回复速度」
  // 设定随机（默认 1~40 秒）；把设定值+实测落地耗时打进诊断，报障时区分「设定即此」与「真卡顿」） ====
  { name: '#571a 回复链起点遥测（删则诊断缺「回复实测」判据，报障无法区分设定延迟与处理卡顿）', file: 'js/chat.js', needle: 'window.__replyWaitT0 = Date.now();' },
  { name: '#571b 实测落地耗时记录（删/改＝回复实测永远无记录）', file: 'js/chat.js', needle: 'window.__replyLatLog.push(__ms);' },
  { name: '#571c 诊断输出设定值+实测（删则回复时间/回复实测两行消失，现场回盲）', file: 'js/chat.js', needle: "'回复实测=' +" },
  // ==== 2026-09-16 #562 桌面美化三修（AI-B personalize.js + 跨域 home.css/dark.css；用户报
  // 「边看边调又不是半透明的页面、还是会遮挡其他东西看不见；点主题色没有任何变化；桌面美化的
  // 所有颜色没有恢复默认颜色的按钮」。#559~#561 已被占用故顺延） ====
  { name: '#562a 主题色驱动桌面按钮默认色（home.css --widget-btn 回落 var(--btn-bg)；改回写死 #111111＝在边看边调里点主题色桌面纹丝不动复发）', file: 'css/home.css', needle: '--widget-btn:var(--btn-bg,#111111);' },
  { name: '#562b 深色不再截断主题色链（删 dark.css 里写死的 --widget-btn 默认；加回＝深色下点主题色桌面按钮不跟随）', file: 'css/dark.css', needle: '--widget-btn:#f0f0f0', absent: true },
  { name: '#562c 边看边调面板半透明（删/改回纯色＝又整块挡住桌面「遮挡其他东西看不见」复发；color-mix 不支持的老内核自动回落上一句纯色）', file: 'js/personalize.js', needle: 'background:color-mix(in srgb, var(--card-bg,#fff) 72%, transparent);' },
  { name: '#562d 美化页每个颜色行注入可见「默认」恢复按钮（删＝只剩弹窗里隐藏的恢复默认 pill，用户报「没有恢复默认颜色的按钮」复发）', file: 'js/personalize.js', needle: "row.querySelector('.bfy-reset-btn')" },
  { name: '#562e 按钮颜色/文字颜色恢复默认改摘内联变量（回落到主题色链；改回写死 #111111/#ffffff＝内联截断主题色链）', file: 'js/personalize.js', needle: "removeProperty('--widget-btn'); paintBeautyVal(widgetBtnVal" },
  { name: '#562f 主题色走设置页同一 applier（同时写 --btn-bg/--btn-ink；删 onSet 分支＝边看边调点主题色只改底色不改文字色）', file: 'js/personalize.js', needle: 'if (onSet) { try { onSet(v); } catch (e) {} paint(); return; }' },
  // ==== 2026-09-16 #572 页面内「先做这个」提示（AI-A 新模块 page-coach.js + feature-hub 只读查询
  // + 三页空状态动作；用户问「复杂页面里不知道先点哪儿」；#553~#562/#570/#571 已被并行批次占用故取 #572） ====
  { name: '#572a 页面提示条插入（删/改＝复杂页首访不再自述「先做这个」，用户回到站在页里发懵）', file: 'js/page-coach.js', needle: 'page.insertBefore(buildBar(cfg), page.firstChild);' },
  { name: '#572b 提示文案与跳转取自功能大全目录表（删＝页面提示与功能大全分叉成两套说明，功能入口变了提示不跟）', file: 'js/feature-hub.js', needle: 'window.mochiHubItemsFor = function (sels) {' },
  { name: '#572c 已看页标记（删＝每进一次都弹同一提示＝骚扰）', file: 'js/page-coach.js', needle: 'const MARK = G + \'__coach-seen\';' },
  { name: '#572d __coach-seen 全局根键免迁（删＝每次刷新被 migrateLegacy 迁进 default 删根键，提示反复弹）', file: 'js/contacts.js', needle: "'__coach-seen'," },
  { name: '#572e 备忘空状态补动作（删＝「还没有备忘」又只剩陈述、没有下一步可点）', file: 'js/memo-app.js', needle: 'id="memo-empty-add"' },
  // #575 删除型（用户 2026-09-16 反馈「删掉，这是错的」）：开屏静态「新手上路 · 3 步就能用」卡
  // 整块撤除，复活即回归——开屏只留公告/必读摘要，新手引导走 onboarding.js 弹层（可跳转、可重看）。
  { name: '#575 开屏静态「新手上路 3 步」卡不得复活（DOM 在 template.html；加回＝用户点名删掉的开屏引导卡又出现）', file: 'template.html', needle: 'splash-onboard-t', absent: true },
  { name: '#575 开屏静态「新手上路 3 步」卡样式不得复活（css/base.css 的 .splash-onboard 规则块；加回＝撤除的卡在产物里复活）', file: 'css/base.css', needle: '.splash-onboard {', absent: true },
  // ==== 2026-09-16 #573 全站搜索统一精准化批（设置搜索词库数据驱动+拼音首字母 / 字卡库+自定义字卡页+功能大全
  // 同款 AND+排序 / 标点归一 / 公共 mochiSearch 工具收敛；用户指派「有能优化的吗→不会卡就帮我做」） ====
  { name: '#573a 公共搜索工具 mochiSearch（删则三处搜索退回各自私有实现，语义漂移复发）', file: 'js/device.js', needle: 'window.mochiSearch = {' },
  { name: '#573b 设置说明文案暴露给搜索（删则壁纸/备份/总入口等说明词搜不到，别名表退化回手工养）', file: 'js/settings-help.js', needle: 'window.__settingsHelpDesc = MAP;' },
  { name: '#573c 设置搜索并入说明文案素材（删则数据驱动召回失效）', file: 'js/personalize.js', needle: "window.__settingsHelpDesc[tagEl.getAttribute('data-setdesc')]" },
  { name: '#573d 设置搜索拼音首字母轻量表（删则 ssms/hfsz 等首字母搜不到）', file: 'js/personalize.js', needle: "'深色模式': 'ssms'" },
  { name: '#573e 自定义字卡页搜索组内精准排序（删则搜单字精确卡淹没回流；oi 决胜保 data-idx 原始索引）', file: 'js/chatcard.js', needle: '.sort((a, b) => a.rk - b.rk || a.oi - b.oi)' },
  { name: '#573f 功能大全搜索原始行序快照（删则排序后 children 与 items 错位＝显隐打到错行）', file: 'js/feature-hub.js', needle: 'if (card && !card.__fhubOrder) card.__fhubOrder = Array.prototype.slice.call(card.children);' },
  // ==== 2026-09-16 #574 字卡库开页「空白干等 IDB」（用户报「字卡库卡 5、6 秒，也没有动画
  // 加载的缓冲」iPhone 14 Pro Safari 等多 iOS 机型）：本机读不到该作用域时要等 idbHydrateKey
  // 取回（iOS 挂后台杀连接后单次 6s、重试链 14s），而渲染被 hydrate 门控＝页面空白干等、
  // 页内零加载态。修＝需要取回时先出加载行（延迟 150ms 才出＝健康路径零闪动）。
  // 行为断言 tools/verify-cc-lib-loading.mjs（B1 桩挂起 IDB：≤1s 出加载行，修前无＝红）====
  { name: '#574a 字卡库需取回时先挂加载态（删＝页面回到空白干等数秒、无任何加载反馈）', file: 'js/chatcard.js', needle: "if (!curStore().get(curKey())) showLibLoadingSoon();" },
  { name: '#574b 加载态延迟 150ms 才出（删/改成立即出＝空库与健康设备开页闪一下，观感回归）', file: 'js/chatcard.js', needle: 'libLoadTimer = setTimeout(showLibLoadingRow, 150);' },
  { name: '#574c 取回落定后摘除加载态（删＝加载行残留占位盖住真实列表）', file: 'js/chatcard.js', needle: 'clearLibLoadingRow(); // #574' },
  { name: '#574d 加载行样式与旋转指示（删＝加载态无样式，退回一行裸文字）', file: 'css/chat-pages.css', needle: '.cc-lib-loading .cc-spin {' },
  // ==== 2026-09-16 #575 同类面补齐：表情包/拍一拍面板、我的表情包、字卡库列表页角标、字卡自检
  // 在等 IndexedDB 取回时一律出加载态（用户：「都补一下，不然用户误会是 bug」）——数据面不缩短
  // 等待，但等待期界面不能说谎（空态/角标 0 会被当成「字卡丢了」）。 ====
  { name: '#575a 聊天面板取回中标记（删＝表情包/拍一拍面板在等待期又退回「暂无…」空态）', file: 'js/chat.js', needle: 'ccPanelsFetching = true;' },
  { name: '#575b 表情包面板取回占位（删＝取回期显示「暂无表情包」被当成丢数据）', file: 'js/chat.js', needle: "ccLoadRowHtml('正在加载表情包…')" },
  { name: '#575c 拍一拍面板取回占位（删＝取回期显示「暂无拍一拍字卡」）', file: 'js/chat.js', needle: "ccLoadRowHtml('正在加载该分组拍一拍…')" },
  { name: '#575d 我的表情包取回占位（删＝18MB 级库取回期显示「暂无我的表情包」）', file: 'js/chat.js', needle: "ccLoadRowHtml('正在加载我的表情包…')" },
  { name: '#575e 字卡库列表页角标取回中态（删＝取回期角标显示 0，被当成「字卡丢了」；#574 同族）', file: 'js/chatcard.js', needle: 'markLibCountsLoading();' },
  { name: '#575f 取回完成写回真值并摘脉冲态（删＝角标永远「…」或一直闪）', file: 'js/chatcard.js', needle: "oe.textContent = libCounts.own < 0 ? 0 : libCounts.own; oe.classList.remove('cc-cnt-loading');" },
  { name: '#575g 字卡自检页取回占位（删＝取回大库时页内只有转瞬 toast，页面像卡住）', file: 'js/card-audit.js', needle: "bodyEl.innerHTML = '<div class=\"mochi-load-row\">" },
  { name: '#575h 共用加载行样式（删＝各处占位行无样式，退回裸文字）', file: 'css/chat-pages.css', needle: '.mochi-load-row {' },
  // ==== 2026-09-16 #576 存储异常弹窗带分步处理建议+直达按钮（用户：手机端弹这个窗时，
  // 里面也要提醒该干什么——原弹窗只报错让用户「去设置页导出」，手机端用户不知道去哪/干什么） ====
  { name: '#576a 弹窗直达按钮挂导出行（删/改＝又只报错不带动作，第一步「先导出备份」没人知道怎么做）', file: 'js/idb.js', needle: "idbFailAct('#row-export'" },
  { name: '#576b 直达走设置页分组tab+滚动链路（删＝按钮点了停在原地/跳错分组，兜底提示也不出）', file: 'js/idb.js', needle: "el.closest('.them-sec')" },
  { name: '#576c openModal 控制器补 ctl.close（删＝跳转成功弹窗关不掉，盖在设置页上）', file: 'js/personalize.js', needle: 'close: function () { try { close(); } catch (e) {} }' },
  // ==== 2026-09-16 #578 设置页/美化页顶部搜索框「外框没有颜色区分」（用户报手机端看不出是输入框）。
  // 根因：外观写死在 template 内联 style，border/background 是带 var() 的简写——安卓
  // mobile-adapt.js 把 input 转成 .ce-box 时按属性名逐个复制内联样式，带 var() 的简写复制
  // 不过去，可见的 .ce-box 实测 border:0px none + 全透明底＝外框连底色一起消失（浅色下原本
  // 也只是白底压白底＋10% 黑细线）。改走 .theme-search 类样式（input 与其 ce-box 同吃一份规则）。
  // 行为断言 tools/verify-set-search-frame.mjs（安卓转换态/未转换态 × 明暗，RED 基线 5 红：
  // 转换后 border 0px＋底色全透明、未转换态白底压白底）====
  { name: '#578a 搜索框外观走类样式（删规则/改选择器＝回到内联样式，安卓转换后外框消失）', file: 'css/setting.css', needle: '.theme-search { width:100%; box-sizing:border-box;' },
  { name: '#578b 外框/内边距用输入框专用 token 且底色可辨（边框改回 var(--card-border) 的 10% 淡线＝浅色下白底压白底复发；底色是加底块的那条）', file: 'css/setting.css', needle: 'background:var(--static-bg,rgba(0,0,0,.05)); border:1px solid var(--input-border,#e0e0e0); border-radius:9px;' },
  { name: '#578c 深色专用底色（删＝深色退回 6% 白底压在 #1c1c1c 上，几乎看不出输入框）', file: 'css/setting.css', needle: '[data-theme="dark"] .theme-search { background:var(--input-bg,#2a2a2a); }' },
  { name: '#578d 搜索框占位文字单行不折行（删＝370px 屏上补边框后差 2px 折成两行、框被撑高一倍）', file: 'css/setting.css', needle: '.ce-box.theme-search:empty::before { display:block; white-space:nowrap;' },
  // 🔧 2026-09-16 #579 会话收窄此锚（原 needle 只写 `border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--bg-b,#fff)`，
  // 该片段在 chat-settings.js / personalize.js / group-chat.js 三处**动态创建**的搜索框内联样式里各有一份
  // → 全量构建恒报「删除型哨兵又回来了」（假红、退出码 1），而真正要守的 template 内联样式有没有写回根本判不出来。
  // 补上 template 侧独有的 `padding:8px 10px;` 前缀后（JS 三处是 `padding:9px 11px;`），src 与产物均 0 命中，锚点收唯一。
  // ⚠️ 请 #578 会话确认此换锚符合原意（该批 verify-set-search-frame.mjs 不受影响）。
  { name: '#578e 搜索框外观必须留在类样式、不得写回内联（内联里带 var() 的 border/background 会被 ce-box 转换丢弃＝用户报的「外框没有颜色区分」原样复发）', file: 'template.html', needle: 'padding:8px 10px;font-size:13px;border:1px solid var(--card-border,#ddd)', absent: true },
  // ==== 2026-09-16 #579 美化页「边看边调」入口提到最前 + 最显眼（用户原话「桌面美化里的【边看边调】
  // 功能应该放最前面而且最显眼」）。此前它是 desk-quick 行里 5 个按钮的最后一个、跟四个「跳到某设置行」
  // 的小描边胶囊同款（实测 67×37px / 字重 600 / 无说明行）＝进美化页第一眼看不到这个主功能。
  // 现为标题正下方整宽主色条（366×61px / 字重 700 / 带一行说明，--btn-bg+--btn-ink 随主题色联动）。
  // 位置与体量的行为断言 tools/verify-beauty-cta-first.mjs（RED 基线＝还原旧形态 6/7 红）====
  { name: '#579a 边看边调入口改整宽主色条（改回 dq-btn 小胶囊＝用户「找不到边看边调」复发；类名即形态锚点）', file: 'template.html', needle: 'class="dq-primary" id="dq-drawer"' },
  { name: '#579b 边看边调不得退回 desk-quick 行的小按钮形态（旧形态是行内最后一个 dq-btn；加回＝入口重新淹没在四个跳转按钮里）', file: 'template.html', needle: '边看边调</button>', absent: true },
  // ==== 2026-09-16 #580 桌面翻页圆点与滑动不同步（用户：「切换 1/2/3 桌面页时，底部导航
  // 圆点反应慢，没有与我滑动完全同步」）。根因：desktop-slider.js 的 scroll 监听里
  // clearTimeout + setTimeout(sync,120)，每次滚动事件都把同步推到 120ms 后 ＝ 滚动全程圆点
  // 被冻结、松手吸附结束才跳一次（实测滞后 127ms），叠加圆点变形动画 250ms ≈ 0.4s 迟到感。
  // 修复：rAF 每帧跟随 + 每帧零查询零样式读取（gap/圆点数组缓存），圆点变形 250→160ms、
  // .dots 加 contain:layout 隔离 width 动画的布局抖动（安卓/iOS 逐帧同步不得引入卡顿）。
  // 行为断言 tools/verify-desk-dots-sync.mjs（跟手延迟 / 逐帧开销 / 无长帧）====
  { name: '#580a 圆点滚动中每帧跟随（改回 setTimeout/smooth 收尾＝滚动期间圆点又冻结、松手后才动，用户报的「不同步」原样复发）', file: 'js/desktop-slider.js', needle: 'if (!rafId) rafId = requestAnimationFrame(syncFrame);' },
  { name: '#580b 每帧步长走缓存、不逐帧 getComputedStyle（删缓存＝滚动的每一帧都强制样式重算，安卓低端机掉帧）', file: 'js/desktop-slider.js', needle: 'if (gapCache === null) gapCache = parseFloat(getComputedStyle(pages).columnGap) || 0;' },
  { name: '#580c 圆点容器 contain:layout（删＝圆点 width 变形每帧重排外泄到 #page-phone 整个桌面壳，滚动中掉帧）', file: 'css/home.css', needle: 'contain:layout;' },
  // ==== 2026-09-16 #587 桌面音乐功能「按钮很多失效」——悬浮播放小框压在自己要控制的控件上
  // （用户：「桌面音乐功能里的按钮很多失效了……其他设备型号也有出现」）。根因：全局悬浮小框
  // #sm-float 默认 left:12px;top:80px、宽 230px、高随系统字体浮动，恰好盖住桌面音乐小组件与
  // 音乐页上半部——无头 390×844 实测：音乐页「我的音乐库 / 歌单 / 我的收藏」三颗 tab 与桌面
  // 小组件进度条 #mw-bar 的 elementFromPoint 全命中 sm-float，点上去毫无反应（系统字号越大
  // 被吃掉的可点区域越多＝多机型同现象）。修复：悬浮小框在「音乐页可见」或「桌面小组件在位」
  // 时让位（这两处各自有完整播放控件，与既有 floatHideByWidget「小组件本身就是控制器，
  // 避免重复弹出」同源），并观察 #page-phone/#page-music 的 hidden 切页即时重算。
  // 行为断言 tools/verify-music-float-overlap.mjs（RED=1 回退判据复现遮挡）====
  { name: '#587a 悬浮小框在音乐页/桌面小组件在位时让位（删掉这个判据＝小框又压住音乐页三颗 tab 与小组件进度条，「点了没反应」原样复发）', file: 'js/music-player.js', needle: '|| floatHideByWidget || floatOwnSurfaceShown();' },
  { name: '#587b 让位判据本体：音乐页可见 → 让位（needle 为函数名锚，判据被改成恒 false 时 verify 脚本 B 层会红）', file: 'js/music-player.js', needle: 'if (musicPage && !musicPage.hidden) return true;' },
  { name: '#587c 桌面小组件在页内（offsetParent 非 null）→ 让位（判据改成恒真／删掉＝要么桌面永远没有悬浮小框，要么小组件进度条继续被压住）', file: 'js/music-player.js', needle: 'return !!(w && w.offsetParent !== null);' },
  { name: '#587d 切页重算接线（#page-phone/#page-music 的 hidden 变化 → renderFloat；删掉＝从聊天切回桌面时小框仍挂在桌面上继续压住小组件）', file: 'js/music-player.js', needle: 'new MutationObserver(function () { renderFloat(); })' },
  // ==== 2026-09-16 #583 字卡自检页补「回复设置 → 聊天」侧的链路闸门（用户：「还需要可以把
  // 回复设置里的聊天设置那些全部检查加进去，怎么优化」）。此前自检只盖「卡池有没有货」，
  // 回复设置那半边（词典拼字/梦角造句/多字卡/自定义占比/附加件/已读不回）没进去——字卡用不到
  // 有一半原因在这半边。同时修掉原来那张「系统预设 X% / 自定义 (100−X)%」占比卡的口径错误：
  // 它漏了 dc-use-chat 场景闸、漏了总档缩放，也漏了 csp-cust——消费端 chat.js genReplyText
  // 是在默认字卡覆盖点前按 csp-cust 掷签保留自定义文本，两者不是二选一，真实覆盖率
  // ＝ 总档缩放后的聊天概率 ×(1−csp-cust%)（默认值下 30% → 实际 15%，原先高报一倍）。
  // 行为断言 tools/verify-card-audit.mjs（B3h/B3i 已随本节改写）====
  { name: '#583a 预设覆盖率按「总档缩放 × (1−csp-cust)」算（改回 dc-overall-chat 原值或去掉 csp-cust 项＝又高报一倍，用户按它调参会调反）', file: 'js/card-audit.js', needle: 'var presetFinal = (lock || !dcEn || !dcUseChat) ? 0 : Math.round(dcOvEff * (100 - cspCust) / 100);' },
  { name: '#583b 自检页「调整」直达 回复设置→聊天 tab（删＝回复设置侧每行都跳不出去，用户看完「卡在哪」却到不了改的地方）', file: 'js/card-audit.js', needle: "if (key.indexOf('@reply:') === 0) return openReplyPage(key.slice(7));" },
  { name: '#583c 附加件全 0 的「全部恢复默认」真的逐键回默认（删＝按钮点了不动，表情包/图片/颜文字三类字卡继续永不出镜）', file: 'js/card-audit.js', needle: 'ATTACH.forEach(function (a) { if (storeSet(a[0], a[2])) okAny = true; });' },
  { name: '#583d 默认聊天字卡漏斗补 dc-use-chat 场景闸与总档（删任一项＝场景关闭或总档=0 时该行仍显示 ✓，用户以为「占比 25% 就该出卡」）', file: 'js/card-audit.js', needle: 'var usable = !lock && dcEn && dcUseChat && all > 0 && cat && prob > 0 && (total - off > 0);' },
  { name: '#587e 今日留言横幅「仅桌面可见」从显示前门控延续到显示期（删掉＝横幅在音乐页继续悬着，压住三颗 tab 与返回/设置五处点不动）', file: 'js/calendar.js', needle: 'new MutationObserver(function () { if (phonePageEl.hidden) hideGreetBanner(); })' },
  { name: '#587f 横幅切页收起判据引用的桌面节点（删掉＝观察器报错/横幅永远不因切页收起）', file: 'js/calendar.js', needle: "const phonePageEl = document.getElementById('page-phone');" },
  // ==== 2026-09-16 #592（用户实报）设置 → 工具 →「使用提示」点击没有任何反应：原实现只调
  //   window.toast，而全项目从未给 window.toast 赋过值（device.js 记录过同一个死通道）——
  //   重置其实已经成功，但屏幕上零变化（设置页没有 .pc-bar 可移除）。改自绘 #cc-toast。
  //   行为断言 tools/verify-page-coach.mjs B6.0/B6.2（点击后 #cc-toast 出现·show·不透明·有文案）
  //   ⚠️ #592b 若因「换一种自绘实现」被删，请同步更新本锚（它证明自绘分支在位，不是死通道）
  { name: '#592a 「使用提示」点击的可见反馈 helper（删掉＝点击又只剩静默重置，用户看不到任何反应）', file: 'js/page-coach.js', needle: 'function tipToast(msg) {' },
  { name: '#592b helper 里自绘 #cc-toast 分支的自动收起计时（删掉＝只留从未被赋值的 window.toast 死通道）', file: 'js/page-coach.js', needle: "clearTimeout(t._timer); t._timer = setTimeout(function () { t.className = 'cc-toast'; }, 2400);" },
  { name: '#592c 重置行点击接线到可见反馈（回退成 window.toast(...)＝「点击没有任何反应」原样复发）', file: 'js/page-coach.js', needle: "tipToast('已重置：再进入那些页面会重新看到上手提示');" },
  // ==== #584 卡顿被误判为 bug 的性能两修（都在 chatcard.js：列表页搜索防抖 / 预压缩串行化）====
  // 行为断言 tools/verify-cc-jank-fix.mjs（RED=1 回退并发预热复现「主线程被连续解码编码霸占」）
  { name: '#584a 字卡库列表页搜索走防抖包装（回退成 input 直连 filterEntries＝每敲一键全量重扫 7k+ 预设字卡）', file: 'js/chatcard.js', needle: "searchInput2.addEventListener('input', ccSearchInput);" },
  { name: '#584b 慢搜索「搜索中…」的触发判据（删掉＝重库搜索全程零反馈，又变成「点了没反应」）', file: 'js/chatcard.js', needle: 'if (ccSearchLast < 120) { ccSearchRun(); return; }' },
  { name: '#584c 慢搜索提示先上屏一拍再跑同步搜索（删掉＝提示写进 DOM 也来不及画出来，等于没加）', file: 'js/chatcard.js', needle: 'ccSearchPost = setTimeout(ccSearchRun, 32);' },
  { name: '#584d 搜索中提示文案本体（用户可见的加载反馈，删掉＝搜索期间界面看不出在处理）', file: 'js/chatcard.js', needle: "searchResultEl.innerHTML = '<div class=\"ta-empty\" style=\"padding:20px 12px\">搜索中…</div>';" },
  { name: '#584e 预压缩串行化的世代计数（回退并发预热＝启动/切联系人卡死数秒到数十秒复发）', file: 'js/chatcard.js', needle: 'const gen = ++ccShrinkGen;' },
  { name: '#584f 预压缩每张之间让出主线程（删掉＝连续解码+PNG 编码重新霸占主线程）', file: 'js/chatcard.js', needle: 'await new Promise(function (res) { setTimeout(res, 0); });' },
  { name: '#584g 单张压缩兜底超时（删掉＝坏 dataURL 既不 load 也不 error 时卡住整轮预热）', file: 'js/chatcard.js', needle: 'setTimeout(fin, 3000);' },
  // ==== 2026-09-16 #585「联系人给我买礼物发送到聊天」按最正常使用优化（用户：「为什么总是无法
  // 触发联系人给我买礼物发送到聊天里，是不是有 bug 或设计缺陷」）。无头实测定位四个叠加原因：
  //   ① 总开关历史遗留——旧版（无 wlVer 标记）记录里的 giftInOn===0 分不出「用户主动关掉」与
  //      「#312 时代默认 0 被设置面板连带写回」（当时改任意一项都会整对象保存），命中即把心愿兑现/
  //      随机送礼一起掐死，只剩不发聊天消息的「TA 自己买」——实测连跑 8 次：聊天 0 件礼物、
  //      心意柜自买 8 件，正是用户描述的「TA 一直在买、从不发到聊天」。现按 wlVer 打标一次性升级。
  //   ② 每日额度共用——②「TA 自己买」（默认 10%、不发聊天消息、判定在前）与「送礼给我」（默认 5%）
  //      共用一个 3 次/天池子；模拟 2000 天（每天 30 条消息）自买平均吃 2.0 次、81% 的日子把额度
  //      吃满，④ 当天再不可能触发（0.30 件/天 → 拆开后 1.11 件/天）。现拆成两本账。
  //   ③ 投递竞态——掷中后 1.5~4s 投递窗内切桌面，钱已扣/心愿已删/额度已占，礼物被静默丢弃
  //      （实测：余额 5000.00→4967.00、心愿消失、聊天与心意柜零新增）。现跨桌面补投递回原桌面。
  //   ④ 日期口径——todayKey 用 UTC，中国时区下「每天 3 次」在北京时间早 8 点重置。
  // 另：设置面板「清空概率输入框→失焦」被静默写成 0（＝永久关闭该路径）改为恢复原值 + 就地提示。
  // 行为断言 tools/verify-gift-ta-send.mjs（S 20 条 + B 18 条全绿；RED 基线 14 条红）====
  { name: '#585a 旧记录里被遗留关闭的「TA 送我礼物」总开关救回开启（删掉＝只剩不发聊天消息的「TA 自己买」，聊天里永远等不到礼物）', file: 'js/gift-shop.js', needle: 'const revived = raw.giftInOn === 0;' },
  { name: '#585b 设置口径迁移只跑一次：已带 wlVer 的记录一律不动（删掉＝用户新关掉的开关每次启动又被强行打开）', file: 'js/gift-shop.js', needle: 'if (!raw || raw.wlVer === WL_VER) return false;' },
  { name: '#585c 「送我」额度只看送礼这本账（改回读自买那本／与自买共用＝隐身自买把额度吃光，送礼当天再不触发）', file: 'js/gift-shop.js', needle: 'const giftCapped = dayCount(AUTO_DAILY_PREFIX) >= 3;' },
  { name: '#585d TA 自买走自己的独立额度（删掉 selfCapped 换回共用 capped＝「额度被自买吃光」那套复发）', file: 'js/gift-shop.js', needle: 'st.selfOn && !selfCapped && Math.random() * 100 < st.selfPct' },
  { name: '#585e 投递窗内已切桌面 → 跨桌面补投递（改回直接 return＝钱花了、心愿没了、礼物不落聊天也不进心意柜）', file: 'js/gift-shop.js', needle: 'if (window.chatAppendDeskRec) window.chatAppendDeskRec(cid, rec);' },
  { name: '#585f 指定联系人的心意柜写入通道存在（删掉＝跨桌面补投递的礼物只在聊天里、收到的礼盒少一件）', file: 'js/gift-shop.js', needle: 'function boxStoreFor(cid) {' },
  { name: '#585g 每日额度按本地日期切（改回 toISOString()＝中国时区下额度在北京时间早 8 点重置）', file: 'js/gift-shop.js', needle: 'function todayKey() { const d = new Date();' },
  { name: '#585h 概率非法输入恢复原值、不静默写 0（删掉＝清空输入框失焦就把该行为永久关闭，用户还以为「调过了」）', file: 'js/gift-shop.js', needle: 'inp.value = String(cur[key]);' },
  { name: '#585i 删除型：旧的「切桌面即丢弃投递」later() 壳不得复活', file: 'js/gift-shop.js', needle: 'const later = function (fn) {', absent: true },
  { name: '#585j 删除型：UTC 日期键不得复活', file: 'js/gift-shop.js', needle: 'function todayKey() { return new Date().toISOString().slice(0, 10); }', absent: true },
  // v3.26.x #586：经期温柔语态「多张字卡粘成一串、没有空格」（用户报「没开拼字功能，联系人发消息还是用拼字卡；温柔动作自动拼进来且没有空格隔开每一个字卡」，多机型同报）
  { name: '#586a 温柔前缀/正文/动作三张字卡拼接处空一格（回改成 p + text + s 裸拼接＝字卡粘成一串，用户当成「没开拼字却出现拼字卡」）', file: 'js/period.js', needle: 'var out = warmJoin(warmJoin(p, text), s);' },
  { name: '#586b 空段不留孤立空格 / 正文自带空白不重复（删掉＝字卡被逐张关掉后消息出现多余空格）', file: 'js/period.js', needle: 'if (/\\s$/.test(a) || /^\\s/.test(b)) return a + b;' },
  { name: '#586c 温柔动作池改读数据分组（改回代码里抄死的 6 条＝字卡库「温柔动作」后 6 张是哑开关，点了不生效）', file: 'js/period.js', needle: "if (g[i] && g[i][0] === '温柔动作' && Array.isArray(g[i][1]) && g[i][1].length) {" },
  // ==== 2026-09-16 #581 图标图片「缩放 + 位置」+ 边看边调补批量上传入口（用户：「【边看边调】功能里
  // 缺少批量上传桌面图标按钮」「上传了图标按钮图片后，需要可以只移动按钮里图片的位置，不用重新上传」）。
  // 三个键 app-icon-zoom-/pos-x-/pos-y-<key>（per-cid）只调「图片在图标里的构图」，不碰图片本体；
  // 两支渲染各自都不露底色：未放大走 object-position（原图被裁才有位移空间），放大后走
  // translate+scale（位移上限＝缩放余量的一半）并给 .app-ico 裁边。三个入口：边看边调抽屉「图标」分区、
  // 设置页「调整图标图片位置」行、装修模式点图标菜单。行为断言 tools/verify-icon-img-fit.mjs ====
  { name: '#581a 图标图片缩放/位置渲染函数（删＝位置设置存了也不生效）', file: 'js/personalize.js', needle: 'const applyAppIconFit = (app) => {' },
  { name: '#581b 放大后位移+缩放表达式（改回只 object-position＝正方形原图放大后无法移动，用户「移动按钮里图片的位置」诉求落空）', file: 'js/personalize.js', needle: "translate(' + tx + '%, ' + ty + '%) scale(" },
  { name: '#581h 位移方向与「壁纸定位/object-position」同口径（负号：值大＝看更靠右/靠下的一段；改回正号＝同一根滑杆在放大前后把画面推向相反一侧，用户会觉得「位置滑杆时灵时不灵」）', file: 'js/personalize.js', needle: 'const tx = -Math.round(((x - 50) / 50) * ((z - 100) / 2) * 100) / 100;' },
  { name: '#581c 边看边调抽屉补批量上传图标图片入口（删＝用户报的「边看边调里缺少批量上传按钮」复发）', file: 'js/personalize.js', needle: '批量上传桌面图标图片（可多选）' },
  { name: '#581d 「调整图片位置」待选标记（删＝从抽屉/设置页进去后点图标不开位置面板，只弹普通图标菜单）', file: 'js/personalize.js', needle: 'if (window.__iconAdjustPick) { openIconFitPanel(app); return; }' },
  { name: '#581e 设置页「调整图标图片位置」行（删＝该功能在设置页无入口，只能靠装修模式摸到）', file: 'template.html', needle: 'id="row-icon-fit"' },
  { name: '#581f 位置面板登记进 FLOAT_SELECTORS（删＝面板打开时底层桌面仍可滑动，与抽屉 #527n 同族）', file: 'js/mobile-adapt.js', needle: "'#beauty-drawer', '#icon-fit-panel'];" },
  { name: '#581g 功能大全补「调整图标图片位置」条目（删＝搜「图标 位置」找不到该功能）', file: 'js/feature-hub.js', needle: "{ n: '调整图标图片位置'," },
  // ==== #588 卡顿/误判为 bug 的性能批（gift-shop 每件一次 JSON.parse / records 关心页 O(n²) / garden 空花园无提示）====
  // 行为断言 tools/verify-jank-batch2.mjs（RED=1 内联还原三处旧形态，断言逐条转红）
  { name: '#588a TA 心愿 id 集合记忆化入口（删＝giftItemHtml 每件礼物重解析一次心愿单，302 件＝302 次 JSON.parse）', file: 'js/gift-shop.js', needle: 'function taWishIds() {' },
  { name: '#588b 集合失效点挂在 wishSave 上（删＝TA 心愿变更后角标不刷新；WL_TA_KEY 全部写路径都过 wishSave）', file: 'js/gift-shop.js', needle: 'if (key === WL_TA_KEY) _taWishIds = null;' },
  { name: '#588c 礼物格渲染改走记忆化集合（回退 wishLoad(...).some＝每件一次解析复发）', file: 'js/gift-shop.js', needle: 'const taWanted = taWishIds().has(g.id);' },
  { name: '#588d 关心页问卡时间戳预排序 + 二分（回退全表 some＝聊天上千条时 O(n²) 卡住「关心」页签复发）', file: 'js/records.js', needle: 'const hasAskCardNear = (t) => {' },
  { name: '#588e ask-msg 改调二分判据（删＝退回对全表 some 的 O(n²) 实现）', file: 'js/records.js', needle: 'const nearCard = hasAskCardNear(t);' },
  { name: '#588f 花园读回期「正在读取」提示（删＝LS 未回填时先画空花园，用户以为数据全丢）', file: 'js/garden.js', needle: 'toast("正在读取本地花园数据…");' },
  // ==== 2026-09-16 #593 朋友圈贴纸「点击照片选贴纸位置」提示条挡住使用（用户明说多机型同报）====
  // 用户原话：「朋友圈的贴纸功能【点击照片选贴纸位置】的提示，会挡住使用」。
  // 根因：提示条绝对定位钉在照片顶部（照片高约 104px 时占 33px≈顶部 1/3），点那一带被提示条接走
  //   ＝被当成「取消」——一张都贴不上、模式还退出；系统字号越大压得越多＝多机型同现象。
  // 行为断言 tools/verify-feed-sticker-pos.mjs 的 S0/A2/E1/E2/E4（旧实现 A2/E1/E2 必红）。
  { name: '#593a 提示条插在配图区之前（删/改回 box.appendChild＝又压回照片上、点顶部贴不上复发）', file: 'js/feed.js', needle: 'box.parentNode.insertBefore(hint, box);' },
  { name: '#593b 提示条移除按 ctx 引用（提示条已不在配图区内，退回 ctx.box.querySelector 会删不掉、提示条常驻）', file: 'js/feed.js', needle: 'if (ctx.hint && ctx.hint.parentNode) ctx.hint.parentNode.removeChild(ctx.hint);' },
  { name: '#593c 选位期间看门狗主动收尾（卡片被局部/全量重渲染换掉节点时不留提示条与选位态）', file: 'js/feed.js', needle: 'const timer = setInterval(() => { if (!box.isConnected) feedCancelPickSticker(); }, 250);' },
  { name: '#593d 提示条覆盖式定位已删除（absent：absolute+top:0+z-index:3 压照片的旧形态复活即报警）', file: 'css/chat-pages.css', needle: '.feed-pick-hint { position: absolute', absent: true },
  { name: '#593e 提示条双保险 pointer-events:none（即便被改回覆盖式也保证点得穿到照片）', file: 'css/chat-pages.css', needle: 'gap: 8px; margin: 8px 0 0; padding: 7px 10px; background: rgba(0, 0, 0, .55); color: #fff; font-size: 12px; border-radius: 8px; pointer-events: none; }' },
  // ==== 2026-09-16 #594 切换桌面联系人 → 打开聊天「所有消息变 2 条再回弹恢复」（多机型同报）====
  // 根因：媒体令牌化后同一条消息 LS 快照存原文（base64 /「名称|||data:audio」）、IDB 权威副本
  // 存 @@m: 令牌，权威合并的去重签名只比原文 ⇒ 判成两条 ⇒ 快照副本被 append 回来（同 ts ⇒
  // 排序后成对相邻）＝首屏全翻倍，后台归一化又合并回 1＝用户看到的「先 2 后 1」。#511 只收了
  // LS 侧合并签名，权威合并这侧漏网。行为断言 tools/verify-chat-switch-dupe.mjs（RED 9/22 精确
  // 复现 msgs 12→20、DOM 翻倍帧；GREEN 22/22）。
  { name: '#594a 媒体跨形态归一唯一入口（删＝各处又各写一份展开逻辑，语音尾形态漏判复发）', file: 'js/chat.js', needle: 'function mediaFormText(s) {' },
  { name: '#594b 权威合并签名走 mediaSigPart（回退原文直比＝切桌面开聊天消息成对翻倍复发）', file: 'js/chat.js', needle: 't: mediaSigPart(m && m.text)' },
  { name: '#594c 媒体「原文 ↔ 令牌」互补判定入口（冷池下 expand 恒 null，这条是唯一拦得住的一层）', file: 'js/chat.js', needle: 'function recKindCovers(kindIndex, m) {' },
  { name: '#594d 权威合并接了互补判定（删＝LS 侧原文副本被当新消息并回，用户报障原样复发）', file: 'js/chat.js', needle: 'if (recKindCovers(idbKinds, m)) return false;' },
  { name: '#594e 读侧 LS 合并接了互补判定（删＝内存已令牌化时把快照原文副本 concat 回来）', file: 'js/chat.js', needle: '!recKindCovers(lsKinds, m)' },
  { name: '#594f 写侧 LS 快照合并接了互补判定（删＝LS 里长期存两份同一条，下次进页照样先 2 后 1）', file: 'js/chat.js', needle: '!recKindCovers(kinds, m)' },
  { name: '#594g 旧「原文直比」权威签名不得复活（absent：直接比 m.text＝跨形态判不出同一条，半修征兆）', file: 'js/chat.js', needle: 't: m && m.text, s: m && m.side', absent: true },
  // ===== #603 字卡库「导出数据 / 导入数据」在壳浏览器上点了没反应（红米 K70 至尊版 MIUI 自带浏览器，用户明说其他机型也有）=====
  { name: '#603a 文件选择 input 常驻复用的单一实例（退回每次新建＝壳浏览器不认这次激活，选择器打不开）', file: 'js/chatcard.js', needle: 'let ccFileInput = null, ccPickSeq = 0;' },
  { name: '#603b pickFiles 的 change 处理器按调用序号丢弃迟到批次（常驻复用的配套；删＝上一次选择的迟到回调喂给本次调用方，选完文件却导入了上一次那个）', file: 'js/chatcard.js', needle: 'if (seq !== ccPickSeq) return;' },
  { name: '#603c 字卡库导出落到 data-backup 三级降级链（删＝退回裸 a[download]，小米/华为等壳静默不落文件）', file: 'js/chatcard.js', needle: 'window.mochiExportFile(json, fname, title)' },
  { name: '#603d 导出给「导出文件 / 复制文字」两种通道（删＝文件通道整条不可用时没有任何退路）', file: 'js/chatcard.js', needle: '导出文件（推荐）' },
  { name: '#603e 导入模式弹窗第四条路「粘贴文本导入」（删＝文件选择器打不开的机型整条导入功能不可用）', file: 'js/chatcard.js', needle: "label: '粘贴文本导入', value: 'paste'" },
  { name: '#603f 粘贴通道与文件通道汇入同一条解析链（删＝粘贴只是弹个框，卡进不了库）', file: 'js/chatcard.js', needle: "typeof f._pasteText === 'string'" },
  { name: '#603g 没有可导出字卡时写明原因（退回只有 disabled 按钮＝用户看到的仍是「点了没反应」）', file: 'js/chatcard.js', needle: '当前没有可导出的字卡' },
  // #604（2026-09-16 用户：「贪吃蛇有bug，我输了显示我赢，还有个可能就是对局结束时，两只蛇的
  //   颜色不对」＋「好多手机使用这个功能是迷你框，无法正常玩」；用户明说其他机型也有、
  //   要求不要覆盖式修改引发跨机型反复）。三条根因都在 src/js/snake-game.js，零机型分支。
  { name: '#604a 贪吃蛇按存活判胜负（撞死的一方输；改回比分数＝我方撞死却分高时又弹「你赢了」）', file: 'js/snake-game.js', needle: "if (!myAlive && oppAlive) result = 'lose';" },
  { name: '#604b 贪吃蛇 coop 队友死＝队伍输（myAlive 必须含 P2 存活；删则队友撞死仍判「组队获胜」）', file: 'js/snake-game.js', needle: 'const myAlive = !!state.player.alive && !(state.p2 && !state.p2.alive);' },
  { name: '#604c 贪吃蛇死亡不再整条刷中性灰（absent：灰化复活＝收局冻结帧的蛇色与结算页 🟢P1/🟠P2 对不上）', file: 'js/snake-game.js', needle: '#cfcfd4', absent: true },
  { name: '#604d 贪吃蛇默认形态走全站设备判定（删则退回只看 innerWidth<900＝桌面版网站模式/手机横屏停在半框，画布塌到 90px 没法玩）', file: 'js/snake-game.js', needle: 'if (d && (d.isMobile || d.isTablet)) return true;' },
  { name: '#604e 摸鱼浮字巡检带「游戏开着就跳过」闸门（删＝玩游戏时「点我抓包」浮字又盖在棋盘/方向键上抢点按，用户报「挡住我玩游戏」）', file: 'js/p2-features.js', needle: 'if (gamePanelOpen()) return;' },
  { name: '#604f 摸鱼闸门必须在 taChimeUse 之前（挪到其后＝45 分钟冷却与每日额度被吃掉，出游戏后这次涨值再也飘不出来）', file: 'js/p2-features.js', needle: 'const GAME_PANEL_IDS = ' },
  // #608（2026-09-16 用户：「总是有用户以为 QQ音乐别的 app 音乐可以导入」；编号让位：同日 #607 已被「使用说明补三块长文」批占用）——导入面板与
  //   功能介绍/常见问题都写明「只支持 本机音频 / 网易云 / 音频直链」。删掉这两处声明＝
  //   用户又只能自己猜（导入链本就只认网易云，其他 App 分享链接必然放不出声）。
  { name: '#608a 导入面板挂「不支持其他 App 分享链接」声明（删＝用户重新以为 QQ音乐等能直接导入）', file: 'js/music-player.js', needle: '不支持其他 App 的分享链接' },
  { name: '#608b 常见问题写明「QQ音乐 / 酷狗 / B站等其他 App 的歌能导入吗」（删＝功能介绍里又只剩网易云一句话可猜）', file: 'template.html', needle: 'QQ音乐 / 酷狗 / B站等其他 App 的歌能导入吗' },
  // ===== #606「关于」tag 分类整理（用户 2026-09-16 问「关于 tag 还能写什么、什么分类放进来」→
  //   拆成 应用信息/帮助与支持/隐私与法律/联系与反馈 四类；使用说明与新手引导移入帮助类；
  //   新增版本与更新/开源与致谢/隐私与数据安全/联系作者 四个只读入口。回退成单入口或删行即回归）=====
  { name: '#606a 关于段「应用信息」分类标题（删＝关于段退回单入口/分类被拆散）', file: 'template.html', needle: 'gs-title">应用信息' },
  { name: '#606b 关于段「帮助与支持」分类标题（使用说明/新手引导的归属组）', file: 'template.html', needle: 'gs-title">帮助与支持' },
  { name: '#606c 关于段新增「版本与更新」行（含版本号 .val）', file: 'template.html', needle: 'id="row-changelog"' },
  { name: '#606d 关于段新增「开源与致谢」行', file: 'template.html', needle: 'id="row-opensource"' },
  { name: '#606e 关于段新增「隐私与数据安全」行', file: 'template.html', needle: 'id="row-privacy"' },
  { name: '#606f 关于段新增「联系作者 / 反馈」行', file: 'template.html', needle: 'id="row-contact"' },
  { name: '#606g 四个只读入口的弹窗接线（删＝行点了没反应）', file: 'js/personalize.js', needle: "bind('row-changelog'" },
  { name: '#606h 新手引导挂进「帮助与支持」组（改回工具段独立成组＝与使用说明分家复发）', file: 'js/onboarding.js', needle: "guideRow.closest('.set-group')" },
  { name: '#606i 新手引导说明登记（删＝该行少「功能说明」胶囊、也搜不到）', file: 'js/settings-help.js', needle: "sel: '#row-guidebook'" },
  { name: '#606j 功能大全收录关于段新入口（删＝功能大全搜不到版本/隐私/联系等）', file: 'js/feature-hub.js', needle: "go: ['#row-changelog']" },
  // ==== 2026-09-16 #612 字卡库【表情包】链接导入弹窗「没办法下滑导入」（多机型，用户明说其他机型也有）：
  //    .modal 内两个子滚动容器 .modal-textarea.ce-box / .modal-group-chips 都用 overscroll-behavior:contain——
  //    框内（胶囊行内）滚到边界后，contain 把滚动链一并拦断，手指自然落在填满的多行框上起滑时手势被框独吞，
  //    外层 .modal（承载「目标分组」与「确定」）永远滚不动＝看不到底部、无法完成导入。
  //    改 auto：溢出仍先框内滚（v3.23.x 限高+框内滚动不回退），到边界放行给 .modal。
  //    同族第 4 次（v3.23 modal-textarea → v3.25 选项框 → #295 dec-opts/gd-opts 已 auto → 本次），
  //    dec-opts/gd-opts 早已是 auto，这两条盯的就是漏网的两处；改回 contain 即回归（verify-modal-scroll-chain B2/B3 变红）。
  //    同族未收口两处（在他人有在途改动的 chat-main.css / chat-pages.css，留待对应会话）：.ce-box.chat-ask-opts、
  //    .ce-box[data-for^="ta-opts-"] ====
  { name: '#612 弹窗多行框滚动链放行·contain→auto（改回 contain 则框内滚到底后手指落在框上整个弹窗滚不动＝链接导入无法下滑导入复发）', file: 'css/base.css', needle: 'max-height:38vh;\noverflow-y:auto;\n-webkit-overflow-scrolling:touch;\noverscroll-behavior:auto;' },
  { name: '#612 弹窗目标分组胶囊行滚动链放行·contain→auto（同族第二处；改回 contain 则胶囊行到边界后弹窗同样滚不动）', file: 'css/base.css', needle: 'max-height:36vh; overflow-y:auto; -webkit-overflow-scrolling:touch;\noverscroll-behavior:auto;' },
];
try {
  const built = CHECK_SENTINELS ? '' : readFileSync(join(root, 'index.html'), 'utf8');
  // v3.27.x：--check-sentinels 下产物是旧的（还没构建），缺失判定全部跳过，
  // 只做 src 锚点核对——覆盖修复的根源在 src 被删，产物判定留给真正构建时。
  // v3.26.x #214：pwa/ 产物（manifest.json 等）不进 index.html，产物检查改读根目录对应文件
  const artifactText = function (s) {
    if (s.file && s.file.indexOf('pwa/') === 0) {
      try { return readFileSync(join(root, s.file.slice(4)), 'utf8'); } catch (e) { return ''; }
    }
    return built;
  };
  const missing = CHECK_SENTINELS ? [] : FIX_SENTINELS.filter(s => !s.absent && !artifactText(s).includes(s.needle));
  const leaked = CHECK_SENTINELS ? [] : FIX_SENTINELS.filter(s => s.absent && artifactText(s).includes(s.needle));
  // v3.26.x #100：产物缺失时再对照源文件——「src 里也没有」和「src 有但产物没有」
  // 是两种完全不同的故障（前者修复真被覆盖、后者是漏接入构建或被旧缓冲回写），
  // 处置路径不一样，以前只有一句「请确认修复是否仍有效」，全靠人猜。
  // needle 含 \n 的是压缩后的多行特征（源文件带缩进/空行），按行分段判。
  const srcState = function (s) {
    if (!s.file || s.file === 'index.html') return null;
    let src;
    try { src = readFileSync(join(root, 'src', s.file), 'utf8'); } catch (e) { return 'nofile'; }
    return s.needle.split('\n').every(function (seg) { return src.includes(seg); });
  };
  // v3.26.x #100：「哑哨兵」体检——两种真正拦不住回归的登记方式。
  // A 锚点指错地方：登记的 file 是某个 src 源文件，但该 needle 在那个文件里根本不存在，
  //   它能报绿纯粹靠产物里别处的同名文本 → 把这个文件的修复整块删掉也不会报警。
  //   （实测踩过：needle `window.__jsErrors = window.__jsErrors || []` 在 chat.js 也有
  //   一份，把 device.js 的初始化整行删掉，146/146 仍然全绿。）
  // B 一条 needle 被多条登记共用：两条互相掩盖，出问题时也分不清是哪次修复丢了。
  // 注：不再按「产物内出现次数 ≥2」报警——那是噪音（实测 70 条），同名文本多处出现
  // 通常仍会随守卫一起消失，拦得住。只警告不置失败码，登记人把锚点收到唯一即可。
  const dead = [];
  const misanchored = FIX_SENTINELS.filter(function (s) {
    if (s.absent || !s.file || s.file === 'index.html') return false;
    const st = srcState(s);
    if (st === 'nofile') { dead.push(s); return false; }
    return st === false;
  });
  const byNeedle = {};
  FIX_SENTINELS.forEach(function (s) { (byNeedle[s.needle] = byNeedle[s.needle] || []).push(s.name); });
  const shared = Object.keys(byNeedle).filter(function (k) { return byNeedle[k].length > 1; });
  // C 针在注释里：needle 在 src 里存在，但只写在整行注释里（minifyJs 丢整行 `//`、
  //   minifyCss 丢块注释）→ 压缩后产物永远不可能命中，构建恒定失败却看不出谁的问题。
  //   做法是把登记的那个 src 文件按对应压缩函数走一遍再比对（多行 needle 跳过：
  //   多行按「压缩后的相邻行」写，逐段判由上面的锚点检查负责）。
  const lostInMinify = FIX_SENTINELS.filter(function (s) {
    if (s.absent || !s.file || s.file === 'index.html' || s.needle.indexOf('\n') >= 0) return false;
    let src;
    try { src = readFileSync(join(root, 'src', s.file), 'utf8'); } catch (e) { return false; }
    if (!src.includes(s.needle)) return false; // 文件里根本没有＝上面的「锚点指错」已经报了
    // v3.26.x #214：非 js/css（pwa/manifest.json 等）不走压缩，原样比对
    const min = /\.css(\||$)/.test(s.file) ? minifyCss(src) : (/\.js(\||$)/.test(s.file) ? minifyJs(src) : src);
    return !min.includes(s.needle);
  });
  if (misanchored.length || shared.length || dead.length || lostInMinify.length) {
    console.warn('⚠️  哑哨兵 ' + (misanchored.length + shared.length + dead.length + lostInMinify.length) + ' 条（拦不住回归，请把 needle 收到「该源文件里唯一」）：');
    misanchored.forEach(function (s) {
      console.warn('   · 锚点指错：[' + s.name + '] 登记的 ' + s.file + ' 里找不到 needle "' + s.needle + '"（产物里是靠别处同名文本过的检）');
    });
    lostInMinify.forEach(function (s) {
      console.warn('   · 针在注释里：[' + s.name + '] needle "' + s.needle + '" 在 src/' + s.file + ' 里只出现在注释中，压缩后必丢（产物永不命中，换成同行代码特征）');
    });
    dead.forEach(function (s) {
      console.warn('   · 死锚点：[' + s.name + '] 登记的 src/' + s.file + ' 已不存在（文件改名/下线，needle 与修复脱钩）');
    });
    shared.forEach(function (k) {
      console.warn('   · 共用 needle "' + k + '"：' + byNeedle[k].map(n => '[' + n + ']').join(' '));
    });
    // v3.27.x：--check-sentinels 的核心职责——src 锚点缺失 = 修复可能被覆盖，
    // 这正是「修好 A 修 B 时 A 被整块删掉」的直接证据，必须让非构建者当场看到失败。
    if (CHECK_SENTINELS && misanchored.length) {
      console.error('❌ [--check-sentinels] src 锚点缺失 ' + misanchored.length + ' 条——对应修复可能已被覆盖/删除：');
      misanchored.forEach(function (s) {
        console.error('   · [' + s.name + '] 应存在于 src/' + s.file + ' 的 "' + s.needle + '"（若你改过该文件，回查是不是整块重写把它抹了）');
      });
      process.exitCode = 1;
    }
  } else {
    console.log('✅ 哑哨兵体检 0 条（每条 needle 都在自己登记的那个 src 文件里、且无共用锚点）');
  }
  const hintOf = function (s) {
    const st = srcState(s);
    if (st === null) return '';
    if (st === 'nofile') return ' ← 源文件 src/' + s.file + ' 不存在（被改名/删除？哨兵登记要跟着改）';
    if (!s.absent) return st ? ' ← src 里仍在＝产物没接入（查 build.mjs 的 jsFiles/cssFiles，或产物被旧缓冲覆盖）' : ' ← src 里也没有＝修复真丢了，去 src/' + s.file + ' 补回';
    return st ? ' ← src 里也回来了＝删除被改回' : ' ← 只有产物里有＝产物比 src 旧，重新构建';
  };
  if (missing.length || leaked.length) {
    if (missing.length) {
      console.error('❌ 关键修复哨兵检查：以下 ' + missing.length + ' 项特征在产物中缺失（修复被覆盖/未接入）：');
      missing.forEach(s => console.error('   · [' + s.name + '] 应含 "' + s.needle + '"（' + s.file + '）' + hintOf(s)));
    }
    if (leaked.length) {
      console.error('❌ 删除型修复哨兵：以下 ' + leaked.length + ' 项「应不存在」的特征又回来了（移除被并行改动/旧缓冲覆盖）：');
      leaked.forEach(s => console.error('   · [' + s.name + '] 不应含 "' + s.needle + '"（' + s.file + '）' + hintOf(s)));
    }
    console.error('   哨兵是回归防线的最后一道——请逐条确认后再提交（对应 verify-xxx.mjs 可补跑复核）。');
  } else if (CHECK_SENTINELS) {
    // 覆盖判定在上面哑哨兵体检已报红；这里只给 src 锚点核对的全绿汇总
    console.log('✅ [--check-sentinels] src 修复锚点全部在位（' + FIX_SENTINELS.length + ' 条，产物未构建按旧版核对）');
  } else {
    console.log('✅ 关键修复哨兵 ' + FIX_SENTINELS.length + '/' + FIX_SENTINELS.length + ' 全部在位（修复无丢失）');
  }
  // v3.26.x #100：哨兵必须能让构建失败。此前全文件没有一次 exit，
  // 警告只在人眼里、CI 里永远是绿的——「修复被静默覆盖」正是这套防线要拦的事。
  // 放在最后：产物此时已写盘，失败不会留下半成品产物。
  // v3.27.x：--check-sentinels 下同样置 1（src 锚点缺失在上面已置），让非构建者当场看到失败。
  if (missing.length || leaked.length) process.exitCode = 1;
} catch (e) {
  console.error('❌ 哨兵检查未能执行（产物读不到？）：' + (e && e.message));
  process.exitCode = 1;
}
// v3.27.x：--check-sentinels 不核对 sw.js 产物（那是构建复制出来的，旧版本来就可能不匹配），
// 只核对 src/pwa/sw.js 里作为源的修复锚点——防覆盖的核心是源码不被删。
if (CHECK_SENTINELS) {
  try {
    const swSrc = readFileSync(join(root, 'src', 'pwa', 'sw.js'), 'utf8');
    const swNeedlesSrc = [
      // v3.26.x #136：canonical 键 miss 后 second chance match(req)（接住存量 req.url 键缓存）
      'caches.open(CACHE).then((c) => c.match(\'./index.html\')).then((m) => m || caches.match(req))',
      'claim 后异步补一次 fetch 写入当前 CACHE',
      'sort((a, b) => cacheVersion(b) - cacheVersion(a))',
      // v3.26.x #136：导航成功写 canonical 键 + activate 抢救旧缓存完整 index
      "c.put('./index.html', res.clone())",
      'rescued ? c.put(\'./index.html\', rescued)',
      // v3.26.x #143：最终重试写点仅限导航 + 兜底命中 content-type 守卫（防 PNG 污染 canonical 键）
      "res.ok && req.mode === 'navigate'",
      "m.headers.get('content-type')",
      // v3.26.x #157：导航缓存优先+后台静默刷新 + index 专属长超时（修 standalone 快捷方式
      // 网络优先 3.5s 对 4MB 产物必然超时 → 反复刷新打不开）
      "const navCached = req.mode === 'navigate'",
      'INDEX_NETWORK_TIMEOUT = 30000',
      'isIndexUrl(url) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT',
      "fetchWithTimeout('./index.html', INDEX_NETWORK_TIMEOUT)",
      'isIndexUrl(u) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT',
      // FIX 2026-09-10 #280：媒体池令牌裸路径（@@m:）本地快速 404，禁止发真实网络请求
      'u.pathname.indexOf(\'@@m:\') >= 0'
    ];
    const swMiss = swNeedlesSrc.filter(n => !swSrc.includes(n));
    if (swMiss.length) {
      console.error('❌ [--check-sentinels] sw.js 源锚点缺失 ' + swMiss.length + ' 条（src/pwa/sw.js 修复被覆盖）：');
      swMiss.forEach(n => console.error('   · 应含 "' + n + '"'));
      process.exitCode = 1;
    } else {
      console.log('✅ [--check-sentinels] sw.js 源锚点 ' + swNeedlesSrc.length + '/' + swNeedlesSrc.length + ' 在位');
    }
  } catch (e) { console.error('❌ [--check-sentinels] sw.js 源检查失败：' + (e && e.message)); process.exitCode = 1; }
} else {
// v3.27.x：sw.js 专项哨兵（导航回退优先当前 CACHE + activate 补 fetch 自愈，防被并行会话覆盖）
try {
  const swSrc = readFileSync(join(root, 'sw.js'), 'utf8');
  const swNeedles = [
    // v3.26.x #136：canonical 键 miss 后 second chance match(req)（接住存量 req.url 键缓存）
    'caches.open(CACHE).then((c) => c.match(\'./index.html\')).then((m) => m || caches.match(req))',
    'claim 后异步补一次 fetch 写入当前 CACHE',
    'sort((a, b) => cacheVersion(b) - cacheVersion(a))',
    // v3.26.x #134：index.html 完整性校验（截断体不进缓存）+ PURGE_INDEX 自愈消息
    'function isCompleteHtml(text)',
    "data.type === 'PURGE_INDEX'",
    // v3.26.x #136：导航成功写 canonical 键 + activate 抢救旧缓存完整 index
    "c.put('./index.html', res.clone())",
    'rescued ? c.put(\'./index.html\', rescued)',
    // v3.26.x #143：最终重试写点仅限导航 + 兜底命中 content-type 守卫（防 PNG 污染 canonical 键）
    "res.ok && req.mode === 'navigate'",
    "m.headers.get('content-type')",
    // v3.26.x #157：导航缓存优先+后台静默刷新 + index 专属长超时
    "const navCached = req.mode === 'navigate'",
    'INDEX_NETWORK_TIMEOUT = 30000',
    'isIndexUrl(url) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT',
    "fetchWithTimeout('./index.html', INDEX_NETWORK_TIMEOUT)",
    'isIndexUrl(u) ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT',
    // FIX 2026-09-10 #280：媒体池令牌裸路径（@@m:）本地快速 404，禁止发真实网络请求
    "u.pathname.indexOf('@@m:') >= 0"
  ];
  const swMissing = swNeedles.filter(n => !swSrc.includes(n));
  if (swMissing.length) {
    console.error('❌ sw.js 关键修复哨兵：以下特征缺失（修复可能被覆盖）：');
    swMissing.forEach(n => console.error('   · 应含 "' + n + '"'));
    process.exitCode = 1; // v3.26.x #100：同主哨兵，缺失必须让构建失败
  } else {
    console.log('✅ sw.js 哨兵 ' + swNeedles.length + '/' + swNeedles.length + ' 在位');
  }
  } catch (e) { console.error('❌ sw.js 哨兵未能执行：' + (e && e.message)); process.exitCode = 1; }
}
