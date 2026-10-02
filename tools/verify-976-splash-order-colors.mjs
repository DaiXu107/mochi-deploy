// verify-976-splash-order-colors.mjs — #976 开屏「颜色太乱 / 内容也很乱」优化（常驻）
// 用户 2026-09-21 直派「开屏里的颜色太乱，内容也很乱。怎么优化一下？」＋两条约束：
//   ①「不要删除我的内容」②「必读卡挪到品牌卡前」；配色由用户选定「顶卡 + 免责声明保留红」。
// 本批只做两件事：把 7 张必读卡整组前移到品牌卡之前（逐字节原样搬运）＋把强调色从 6 种收到 4 种
//   （红＝使用红线〔顶卡 + 免责声明〕/ 橙＝须知提醒〔停更、公告已精简、安卓浏览器〕/
//     琥珀＝需要你操作〔系统内置字卡锁〕/ 灰＝陈述〔防倒卖、使用前提〕；使用前提的蓝色专属色撤除）。
// 断言：位置（组在品牌卡之前、组内 7 张齐全有序）＋**一字未删**（与改前文本快照逐块比对）＋
//   颜色语义（红恰好 2 处、亮暗两套）＋防倒卖回填仍在（删卡后补回组内首位）＋进入门控零回归。
// 用法：node tools/verify-976-splash-order-colors.mjs
//   MOCHI_SERVE_ROOT=<仓外副本目录> 可指向隔离副本（默认 = 本仓根）
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.MOCHI_SERVE_ROOT || here);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = createServer((req, res) => {
  try {
    const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;
console.log('serve root = ' + root);

// 文本快照（2026-09-21 起，逐块抓取的规范化文本）——本批为「用户已确认的文案基线」：
//   · 76855ca 版（#973 定稿）为初始基线；#981 用户重写顶卡四段并在摘要补「词典字卡在哪关」后，
//     基线同步更新为 ae7a744 构建产物（其余 9 块与 76855ca 完全相同）。
//   · #1019（2026-09-22）用户直派在顶卡追加第 5 段（字卡回复/通话频率可自行调整 ＋ 不要把功能设计当 bug ＋ 指路功能说明），
//     bigwarn 一块基线随之更新为本次构建产物。
//   · #1024（2026-09-22，本批）两块基线同步更新：
//     cardlock＝作者 #998 直派改写了解锁提示（「答案就在开屏第一页的章节目录里…」），旧句是作者自己替换掉的；
//     summary＝后续批次合法增补（#973「内容非常多」/ #991 iPhone 主屏幕 / #1024「转载 · 二次创作」）。
// ——「不要删除我的内容」这条约束的判据（本批起）：改后每一块**不得少句**（详见下方 S8 的判据说明），
//   而不是「逐字相同」——后者把作者自己加内容也判红，红久了就没人看。
// 重新基线：SNAP_DUMP=1 node tools/verify-976-splash-order-colors.mjs → 整段替换对应那行。
//   · #1216（2026-09-25，本批）作者直派「必读摘要删掉，这些内容在开屏最顶已经有了」：SNAPSHOT 的 summary 一块**整块撤销**
//     （不是重基线成空串——那块 DOM 已经不在了），改由 S15b 判「摘要块不存在」＋ S15c 判「四张横幅卡的文案进了目录」。
//   · #1459（2026-09-29，作者直派「按 B+C 方案修改并同步两源」）：免责卡由七条改写为九条（B①②③ 三处措辞修正
//     ＋C①②③④⑤ 五处条款补充），属**作者直派改写**，故「disclaimer」一块按本脚本既有做法**重基线**为新文本
//     （改了 18 周岁那句的「本页全部说明」→「《免责声明》全文」、第 1 条「不具备…效力」→「不构成…法律效力」、
//     第 3 条加「在法律法规允许的最大范围内」、第 4 条补「无账号体系/不上传」、第 2 条补 110/120 紧急指引、
//     第 6 条补官方入口、新增第 7 条违法用途禁止、第 8 条停更对表、第 9 条最后更新日期）；
const SNAPSHOT = {
 "bigwarn": "使用前必看 · 本站内容非常多，不适用建议不使用本站 网站本质只是工具，使用效果取决于个人使用和个人理解，各种原因都需要适应和调整。 网站内置内容非常非常多，需给一定时间适应和根据个人使用习惯调整，或不适用建议不使用这个网站。 回复设置概率，非常多功能的时间和概率，全部都是公开的可以自己调，功能也可以自己设置关闭。 聊天字卡也可以单独关闭某个分组或关闭某个单独的字卡。默认聊天字卡的词典字卡太多，不适用建议关闭。 字卡回复高频和通话高频都可以自行调整。不要因为我之前一直在帮人修设备bug和强调可以帮人修不同手机型号的设备兼容bug，就把我的功能和设计也当成bug啊。已无力解释，可自行在功能说明里查看。",
 "antiscam": "免费 · 署名 · 防倒卖 本站完全免费，没有收过任何人一分钱，个人出资和花费时间搭建的。开放二传二改但禁止以盈利为目的。 Mochi字卡网站完全免费。作者只有两个账号：小红书@言序（1842523578）和抖音@言序（58334080131）。作者不玩抖音、不回消息，是看到有人想花钱求网站才开的号，仅用于发布本站链接。本站不收取任何费用，如有出现任何收费情况，均为诈骗，注意防止被骗。 二传、分享本站链接必须标注作者署名：小红书 @言序（1842523578），禁止删除或修改。严禁冒为自己制作、删除篡改署名，或以任何形式收费倒卖本站链接、安装包——本站完全免费，收费即诈骗。如果你是花钱买来的链接：你被骗了，请拒付退款并举报卖家。",
 "stopupdate": "停更公告 · 2026年9月底后永久停更 mochi字卡 2026年9月底后永久停更。停更后不会再帮人调不同人的设备型号的兼容 bug。 作者自己的手机使用无异常情况；其他人的设备上的问题，不报出来作者手机碰不到、也无法发现——不同手机型号的情况就是不同。 永久停更以后，建议自己拿代码给 AI 调（代码已在 GitHub 完全开源，可自行下载修改）。",
 "abouttip": "公告已精简：原公告里的大量使用说明已移到【设置 → 关于】（数据与存储 / 常见问题 / 使用说明）。有问题先去那里找答案即可。",
 "backup": "定期导出备份 · 本地数据说没就没 本站没有云存储，所有数据都只保存在这台设备的浏览器本地、不会上传到任何网络——也正因如此，被清掉就无法找回，作者也帮不了你恢复。iOS Safari 连续 7 天没打开本站会自动清空全部本地数据（Apple 隐私策略）；安卓没有这条规则，但手机存储紧张、清理软件一键优化时同样会清掉网页数据。 唯一可靠的防线＝定期「导出数据」备份：设置 → 通用 →「导出数据」，导出的文件多处留存（文件 App / 云盘 / 微信收藏各留一份）；换设备或数据丢失后，同页「导入数据」恢复。iPhone / iPad 用户请先把本站「添加到主屏幕」再用（做法见下方目录第 5 章）。",
 "storesplit": "数据不互通 · 浏览器和桌面快捷方式是两套存储 用浏览器直接打开本站，和「添加到主屏幕 / 安装应用」后从桌面图标进入，是两种使用方式、两套独立存储（都在你设备本地——本站没有云存储，数据不会上传到任何网络），两边数据互不相通：换用法前先在 设置 → 通用 →「导出数据」备份，到新用法里再「导入数据」恢复。 两处不能同时打开使用，会导致两边数据不统一。",
 "what": "使用前提 · 先认清本站是什么 本站是字卡传讯，纯代码运行，没有任何 AI，不是小手机。请至少了解什么是字卡传讯、使用过其他传讯网站，再进行使用。 本站不是小手机，请勿带 #小手机 等相关 tag 发帖引流。作者做这个站只是为了方便字卡传讯交流，不是为了扩圈；现在使用的人越来越多，请大家保持基本的礼貌与规则，不要扩圈、刷屏引流，谢谢。",
 "disclaimer": "免责声明 本站禁止未满 18 周岁的未成年人使用。点击进入即视为你确认已年满 18 周岁，并已阅读、理解并同意《免责声明》全文。勾选确认时，本站会在你自己的设备浏览器本地记录确认时间与本声明版本（仅用于确认你已阅读并同意本声明，不会上传，不属于数据收集）。 1. 本站所有字卡回复、TA 的消息与互动均为预先编写的随机代码随机触发，纯属虚构娱乐，不代表任何真实人物的观点、承诺或情感，不构成任何形式的承诺、建议或专业意见，不产生任何法律效力。 2. 本站的虚拟互动不能替代、也不应替代真实的人际交往、恋爱关系、心理疏导或专业帮助。如果你正处于情绪低落、焦虑或其他心理困境，请及时向家人朋友求助，或前往正规医疗机构、心理援助热线（全国心理援助热线：12356）寻求专业支持；如遇紧急或危险情形，请立即拨打 110（报警）或 120（急救），或前往就近医院急诊。 3. 本站仅供自愿使用：请在充分理解本声明内容、自愿承担全部使用风险的前提下使用本站。使用本站产生的一切后果（包括但不限于情绪影响、时间消耗、数据丢失、设备问题、纠纷与损失）均由使用者本人自行承担、自行负责；未成年人违规使用的，相关责任由其本人及监护人承担。本站完全免费，作者未因你的使用收取任何费用或获取任何对价；在法律法规允许的最大范围内，无论基于何种原因或理由（包括但不限于违约、侵权或其他事由），作者均不承担任何直接、间接、附带或后果性的责任。 4. 本站按「现状」与「当前可用性」提供，不作任何形式的明示或默示保证，包括但不限于持续可用、不中断、无错误、无遗漏、适用于特定目的等。因第三方托管服务（如 GitHub Pages）、网络、设备、系统或浏览器等非作者可控原因导致的无法访问、显示异常或损失，作者亦不承担责任。 5. 本站无后端服务器、无账号体系，所有数据仅保存在你自己的设备浏览器中，不会上传至任何网络，作者不收集、不读取、不对外分享你的任何内容。清除浏览器数据、卸载、换机、iOS 系统回收存储均会导致数据丢失，请务必定期导出备份；作者无法找回任何丢失数据。 6. 你自行导入或保存的音乐、图片、表情、字卡等素材，其版权与合法性由你本人负责，请勿导入或分享侵权、违法的内容；由此产生的纠纷与责任由你承担。 7. 本站指作者本人发布与部署的原版（见下方署名卡），官方入口以署名卡公布的作者账号所发链接为准。开放二传二改后产生的其他版本并非原版，其内容、改动（可能自行添加云存储等联网功能）与运营均与作者无关；从非原版入口使用所产生的一切后果，作者不承担责任。 8. 禁止利用本站从事任何违法违规活动，包括但不限于骚扰、辱骂、诈骗、传播违法信息等，违者自行承担全部法律责任。 9. 本站已于 2026-09-30 起停止功能更新（永久停更），此后仅可能发布必要的声明修正。停更不等于下线：已部署的页面与相关链接可能继续可访问，但作者不再维护更新，不承诺本站与相关链接的持续可用、可访问或不中断，也不承诺任何内容永不失效。 10. 本声明任何条款被认定全部或部分无效的，不影响其余条款的效力，其余条款继续有效。 11. 本免责声明最后更新：2026-09-30。",
 "cardlock": "防未成年人 · 系统内置字卡已锁定 系统内置字卡已全部锁定，这是面向未成年人的保护措施，不是 bug。锁定影响：默认聊天字卡、词典（含词典拼字）、其他系统预设互动字卡全部停用；你自建的字卡与情绪 / 心意 / 意图字卡不受影响。豁免说明（#499）：聊天情绪字卡、TA 的心情、聊天回应字卡这三大互动链不受锁定影响，未解锁也照常触发与抽取。所以若发现「某功能开关都开了却没效果」，先看是不是锁定中。不输密码也能正常使用全部功能，密码只管两件事：解锁系统内置字卡、跳过开屏的 2 个问答。注意：锁定时若自定义字卡（含 mj 字卡）一张都没添加，回复会更单薄（情绪/回应字卡仍在，但少了系统预设内容），自己在自定义字卡里添加几张即可。密码一共 6 位数字：前两位是 99，后 4 位是 mochi 字卡生日的字面数字（把生日日期原样写成 4 位数），生日写在开屏第一页的章节目录里（点开第一页顶部的「目录」逐章翻一下就能找到）——第一页的章节目录里和第二页最顶那张时间线卡都写着——日期一直是很简单的字面意思，不是隐藏答案；开屏最底下的部署时间不算（那只是用来判断有没有更新到新版本）。这个密码与开屏问答页的「暗号」是同一个。解开密码请勿二传（不要告诉别人），一旦有人二传，密码就会被重新设置。 输入密码解锁",
 "brandcard": "mochi 摸鱼字卡 小红书@言序（1842523578） · 抖音@言序（58334080131） 设计与开发均由作者@言序 一个人独立完成。 许可 · 署名 · 灵感来源 本站不是 milk 字卡代码的二改版本，是从零开始独立编写的字卡传讯二创作品。 开放二传二改，禁止商用、禁止以盈利为目的；必须保留作者署名：小红书 @言序（1842523578），禁止删除或修改；二次修改请注明原作者。 二传二改四点要求：① 保留署名；② 不要转发二级验证密码（暗号）；③ 二改后要公开时，不要公开内置字卡；④ 二改可自加云存储，但请不要公开云存储。 Mochi字卡为原创独立作品（即原版），代码已在 GitHub 完全公开、支持私人部署；借鉴来源：milk 字卡 · 小红书 @milk（基础框架与随机回复逻辑）、@FelixFelicis（帮我决定·多人决定）、@默玉（公用＋专享字卡模式）、@心汋是颗彩虹多宝糖（情绪字卡提议）；其余功能与 UI 均为独立设计。 使用或借鉴本站功能与代码，必须标注灵感来源；开屏公告为本站内容，不可删除或修改。详见 GitHub 库与 设置 → 关于。 本人原作，本人部署。 使用网站为：https://ling233330-star.github.io/mochi/ github库为：https://github.com/ling233330-star/mochi 除上述使用网站（本人原作、本人部署）外，其他非作者本人发布的版本，均是因本作开放二传二改权限而产生的二传/二改版，并非本站原版，特此说明。",
 "noticeTitle": "Mochi字卡 · 开屏说明"
};

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const PROBE = `(function(){
  var norm = function(s){ return (s||'').replace(/\\s+/g,' ').trim(); };
  var box = document.getElementById('splash-box');
  var must = document.getElementById('splash-mustread');
  var brand = document.querySelector('.splash-brandcard');
  var notice = document.getElementById('splash-notice');
  var big = document.querySelector('.splash-bigwarn');
  var disc = document.querySelector('.splash-alert[data-anti-scam="d"]');
  var cs = function(el){ return el ? getComputedStyle(el) : null; };
  var cards = must ? Array.prototype.slice.call(must.children) : [];
  var cardInfo = cards.map(function(c){
    var t = c.querySelector('.splash-alert-t, .splash-stopupdate-t, .splash-bigwarn-t') || c.querySelector('p');
    var g = cs(c);
    return { cls: c.className, id: c.id || '', tag: c.getAttribute('data-anti-scam') || c.getAttribute('data-stop-update') || c.getAttribute('data-about-tip') || c.getAttribute('data-browser-warn') || '',
      title: t ? norm(t.textContent) : '', bg: g.backgroundColor, bl: g.borderLeftColor };
  });
  var brandCards = brand ? brand.querySelectorAll('[data-anti-scam],[data-stop-update],[data-about-tip],[data-browser-warn]').length : -1;
  var noticeCards = notice ? notice.querySelectorAll('.splash-alert, .splash-stopupdate, .splash-abouttip').length : -1;
  var reds = [];
  Array.prototype.forEach.call(document.querySelectorAll('.splash-box .splash-alert, .splash-box .splash-stopupdate, .splash-box .splash-abouttip, .splash-box .splash-bigwarn'), function(el){
    var g = cs(el);
    var t = el.querySelector('.splash-alert-t, .splash-stopupdate-t, .splash-bigwarn-t');
    var REDS = { 'rgb(210, 52, 48)': 1, 'rgb(255, 107, 107)': 1, 'rgb(224, 85, 85)': 1 };
    if (REDS[g.borderLeftColor]) reds.push(t ? norm(t.textContent) : '');
  });
  return {
    hasMust: !!must,
    boxChildren: box ? Array.prototype.slice.call(box.children).map(function(c){ return c.className; }) : [],
    mustBeforeBrand: !!(must && brand && (must.compareDocumentPosition(brand) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0),
    mustBeforeNotice: !!(must && notice && (must.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0),
    bigFirst: !!(box && big && box.firstElementChild === big),
    brandCards: brandCards, noticeCards: noticeCards,
    cardInfo: cardInfo,
    reds: reds,
    noHOverflow: !!(box && box.scrollWidth <= box.clientWidth + 1),
    texts: {
      bigwarn: norm(big ? big.textContent : null),
      antiscam: norm((document.querySelector('.splash-alert[data-anti-scam="1"]') || {}).textContent),
      stopupdate: norm((document.querySelector('[data-stop-update]') || {}).textContent),
      abouttip: norm((document.querySelector('[data-about-tip]') || {}).textContent),
      browser: norm((document.querySelector('[data-browser-warn]') || {}).textContent),
      ioshome: norm((document.querySelector('[data-ios-home]') || {}).textContent),
      backup: norm((document.querySelector('[data-backup-warn]') || {}).textContent),
      storesplit: norm((document.querySelector('[data-store-split]') || {}).textContent),
      what: norm((document.querySelector('.splash-alert[data-anti-scam="w"]') || {}).textContent),
      disclaimer: norm(disc ? disc.textContent : null),
      cardlock: norm((document.getElementById('splash-cardlock') || {}).textContent),
      brandcard: norm(brand ? brand.textContent : null),
      summary: norm((document.querySelector('.splash-summary') || {}).textContent),
      secs: Array.prototype.slice.call(document.querySelectorAll('.splash-sec-wrap > .splash-sec')).map(function (e) { return norm(e.textContent); }),
      noticeTitle: norm((document.querySelector('.splash-notice-title') || {}).textContent)
    },
    whatStyle: (function(){ var w = document.querySelector('.splash-alert[data-anti-scam="w"]'); var a = document.querySelector('.splash-alert[data-anti-scam="1"]'); if(!w||!a) return {}; return { what: cs(w).borderLeftColor, antiscam: cs(a).borderLeftColor }; })(),
    lockColor: (function(){ var l = document.getElementById('splash-cardlock'); return l ? cs(l).borderLeftColor : ''; })(),
    iosColor: (function(){ var l = document.querySelector('[data-ios-home]'); return l ? cs(l).borderLeftColor : ''; })(),
    discColor: disc ? cs(disc).borderLeftColor : ''
  };
})()`;

await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded', timeout: 40000 });
await page.waitForFunction(() => !!document.getElementById('splash-mustread'), null, { timeout: 20000 }).catch(() => {});
await sleep(1600);
let s = await page.evaluate(PROBE);

// SNAP_DUMP=1：把当前各块的规范化文本整份打印出来（不改基线、不判断言）。
// 用途＝作者直派改写某一块文案后的重新基线：把对应那行整段替换进上方 SNAPSHOT 即可（#1019 顶卡、#998 锁卡、#1024 摘要都走过这条路）。
if (process.env.SNAP_DUMP) {
  console.log(JSON.stringify(s.texts, null, 1));
  await browser.close(); srv.close(); process.exit(0);
}

// ===== 位置：必读卡组整组在品牌卡之前 =====
ok(s.hasMust, 'S1 存在必读卡组容器 #splash-mustread');
ok(s.bigFirst, 'S2 开屏第一位仍是 #973 顶卡（#splash-bigwarn）', JSON.stringify(s.boxChildren.slice(0, 3)));
ok(s.mustBeforeBrand && s.mustBeforeNotice, 'S3 必读卡组排在品牌卡与公告卡之前（用户点名「必读卡挪到品牌卡前」）');
ok(s.brandCards === 0, 'S4 品牌卡内不再夹带必读卡（原先 2 张）', 'brandCards=' + s.brandCards);
ok(s.noticeCards === 0, 'S5 公告卡内不再夹带必读卡（原先 5 张）', 'noticeCards=' + s.noticeCards);

// ===== 组内 8 张齐全、有序、各 1 份 =====
// 2026-10-01（作者直派三连，#1536）：① milk 说明句缩短并入许可块（brandcard 基线随批重录）；② 必读卡组补
//   「备份提醒」（琥珀=需要你操作）与「数据不互通」（橙=须知/提醒）两卡，本表 6→8（原 8 张时代 =
//   浏览器两卡在组内；该两卡 2026-10-01 上批已收进公告目录）；其余 6 张顺序与文本一字未动（S8.* 仍守）。
const WANT = [
  ['data-anti-scam="1"', '免费 · 署名 · 防倒卖'],
  ['data-about-tip="1"', '公告已精简：原公告里的大量使用说明已移到【设置 → 关于】'],
  ['data-backup-warn="1"', '定期导出备份 · 本地数据说没就没'],
  ['data-store-split="1"', '数据不互通 · 浏览器和桌面快捷方式是两套存储'],
  ['data-stop-update="1"', '停更公告 · 2026年9月底后永久停更'],
  ['data-anti-scam="w"', '使用前提 · 先认清本站是什么'],
  ['data-anti-scam="d"', '免责声明'],
  ['id="splash-cardlock"', '防未成年人 · 系统内置字卡已锁定']
];
ok(s.cardInfo.length === 8, 'S6 组内恰好 8 张必读卡（无重复、无遗漏；#1536 补备份/数据不互通两卡后 6→8）', 'n=' + s.cardInfo.length);
WANT.forEach((w, i) => {
  const c = s.cardInfo[i];
  // 有标题元素的卡 lead＝标题；无标题元素（.splash-abouttip）lead＝首个 <p> 全文，故按前缀判
  ok(!!c && c.title.indexOf(w[1]) === 0, 'S7.' + (i + 1) + ' 第 ' + (i + 1) + ' 张＝' + w[1], c ? c.title.slice(0, 40) : 'missing');
});

// ===== 一字未删：只判「原文有没有被删掉/改写」，不再要求逐字相同 =====
// 判据演进（2026-09-22，本批）：原先 a === b 的「逐字相同」会把**任何**后续内容批次都判红——
//   作者自己改写某块文案（#998 锁卡提示）、别的批次往摘要里合法加一条（#973/#991/#1024），
//   都会让 S8 变红；而常红的断言等于没有断言（看红的人分不清「内容丢了」和「又加了新内容」）。
// 现在改判「无删减」：把基线切成句段（≥8 字的段），每一段都必须仍在当前文本里原样出现。
//   · 只增不改 → 过（作者加内容不该报红）；
//   · 删掉或改写任何一句 → 红，并把丢掉的那几段打出来（比原来的 now= 前 60 字好定位得多）。
// 注：改写属作者直派时，按本脚本既有做法同步更新对应那一块基线（#981/#1019 都这样做过）；
//   重基线用 SNAP_DUMP=1 打印当前文本，整段替换 SNAPSHOT 里对应那行即可。
//   · #1475（2026-09-30，作者直派「补存证＋标准条款＋第 3 条强化」）：免责卡 9 条改 11 条（首段补本地同意存证披露、
//     第 3 条改写「自愿使用＋后果自担自行负责＋完全免费无对价＋最大范围内无论何种原因免责」、新增第 4 条按现状
//     无担保＋第三方托管、新增第 10 条可分割性、原 4~8 顺延 5~9、最后更新 2026-09-30），disclaimer 块再次重基线；
//     同批 clock.js 同意记录改存 JSON＋改版重确认（verify-1475 行为面）。
//   · #1482（2026-09-30，作者选定写法 A）：第 9 条「停止发布新版本」改「停止功能更新，此后仅可能发布必要的声明修正」（消除停更声明 vs 修正批并行的自相矛盾），disclaimer 块随批再重基线。
const segs = (t) => String(t).split(/[。！？；]|\s{2,}/).map((x) => x.trim()).filter((x) => x.length >= 8);
const noDeletion = (base, now) => segs(base).filter((g) => now.indexOf(g) < 0);
Object.keys(SNAPSHOT).forEach((k) => {
  const a = SNAPSHOT[k] || '';
  const b = (s.texts[k] === undefined ? null : s.texts[k]) || '';
  if (k === 'brandcard') return; // 单独判：品牌卡少了已搬走的两张卡的正文，属位置变化
  const lost = noDeletion(a, b);
  ok(lost.length === 0, 'S8.' + k + ' 原文无删减（基线 ' + segs(a).length + ' 段全部仍在）',
    lost.length ? '丢了 ' + lost.length + ' 段：' + lost.slice(0, 2).map((x) => x.slice(0, 40)).join(' ／ ') : '');
});
// 品牌卡：期望＝基线把「停更公告 + 公告已精简」两段原文整体剔除（只搬位置、不改字），再按无删减判
const brandWant = (SNAPSHOT.brandcard.split(SNAPSHOT.stopupdate).join(' ').split(SNAPSHOT.abouttip).join(' ')).replace(/\s+/g, ' ').trim();
const brandLost = noDeletion(brandWant, s.texts.brandcard || '');
ok(brandLost.length === 0, 'S8.brandcard 品牌卡原文无删减（基线剔除两张已搬走的卡后 ' + segs(brandWant).length + ' 段仍在）',
  brandLost.length ? '丢了 ' + brandLost.length + ' 段：' + brandLost.slice(0, 2).map((x) => x.slice(0, 40)).join(' ／ ') : '');

// ===== 颜色语义：红恰好 2 处 =====
ok(s.reds.length === 2, 'S9 全开屏红色警示块恰好 2 处（顶卡 + 免责声明）', JSON.stringify(s.reds));
ok(s.reds[0] && /使用前必看/.test(s.reds[0]), 'S10 第一处红＝#973 顶卡「使用前必看」', s.reds[0]);
ok(s.reds[1] === '免责声明', 'S11 第二处红＝免责声明', s.reds[1]);
const orange = s.cardInfo.filter((c) => c.bl === 'rgb(232, 89, 12)').map((c) => c.title.slice(0, 12));
ok(orange.length === 3, 'S12 橙（须知/提醒）恰好 3 张：停更公告 / 公告已精简 / 数据不互通（#1536 补数据不互通卡 2→3）', JSON.stringify(orange));
ok(s.whatStyle.what === s.whatStyle.antiscam, 'S13 使用前提已回落灰族（与防倒卖卡同色，蓝色专属色撤除）', JSON.stringify(s.whatStyle));
ok(s.lockColor === 'rgb(192, 127, 31)', 'S14 系统内置字卡锁保留琥珀（需要你操作）', s.lockColor);
const ambers = s.cardInfo.filter((c) => c.bl === 'rgb(192, 127, 31)').map((c) => c.title.slice(0, 12));
ok(ambers.length === 2, 'S14c 琥珀（需要你操作）恰好 2 张：系统内置字卡锁 / 备份提醒（#1536 补备份卡）', JSON.stringify(ambers));
ok(s.noHOverflow, 'S15 新布局未把开屏撑出横向溢出');

// ===== v8.44 #1216（2026-09-25 用户直派）：「必读摘要」整块撤除，四张横幅卡的文案落进开屏第一页的「目录」各章 =====
//   判据取结构：摘要块不存在 ＋ 目录里能翻到那四章（在线 notice.json 与静态兜底两份同标题，renderNotice 覆盖后仍成立）。
ok(s.texts.summary === '', 'S15b 必读摘要块已整块撤除（用户原话「这些内容在开屏最顶已经有了」；复活＝与顶卡两份口径各说各话）', '摘要文本长 ' + (s.texts.summary || '').length);
['停更公告 · 2026年9月底后永久停更', '公告已精简 · 大量使用说明已移到「设置 → 关于」', '浏览器兼容提醒（安卓用户必读）', 'iPhone 用户必读：把本站「添加到主屏幕」再用'].forEach(function (t) {
  ok(s.texts.secs.some(function (x) { return x.replace(/^\d+、/, '').indexOf(t) === 0; }), 'S15c 目录里有章「' + t.slice(0, 18) + '」（#1216 四张横幅卡进目录）', JSON.stringify(s.texts.secs.slice(0, 6))); // #1500 目录统一编号：比对前剥掉「N、」前缀，对编号变化不敏感
});

// 暗色主题：红/橙/琥珀三色各自换到暗色值（不得有块退回无色/透明）
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await sleep(200);
const dk = await page.evaluate(PROBE);
ok(dk.reds.length === 2 && dk.cardInfo.filter((c) => c.bl === 'rgb(255, 138, 61)').length === 3 && dk.cardInfo.filter((c) => c.bl === 'rgb(217, 154, 58)').length === 2, 'S16 暗色主题下红仍 2 处、橙仍 3 张（#ff8a3d）、琥珀仍 2 张（#d99a3a）', JSON.stringify(dk.cardInfo.map((c) => c.bl)));
ok(dk.lockColor === 'rgb(217, 154, 58)', 'S17 暗色主题下字卡锁仍为琥珀', dk.lockColor);
await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
await sleep(150);

// ===== 防倒卖回填：删卡后必须补回组内首位（搬容器后最容易断的就是这条） =====
await page.evaluate(() => { const a = document.querySelector('.splash-alert[data-anti-scam="1"]'); if (a) a.remove(); });
const back = await page.waitForFunction(() => {
  const m = document.getElementById('splash-mustread');
  const a = m && m.querySelector('.splash-alert[data-anti-scam="1"]');
  return !!a && m.firstElementChild === a && a.textContent.indexOf('倒卖') > -1;
}, null, { timeout: 9000 }).then(() => true).catch(() => false);
ok(back, 'B1 防倒卖卡被删后回填到必读卡组首位（回填宿主随容器同步）');

// ===== 进入门控零回归 =====
const pre = await page.evaluate(() => {
  const b = document.getElementById('splash-enter');
  const c = document.getElementById('splash-age-check');
  if (c && !c.checked) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }
  return { hidden: b ? b.hidden : null, disabled: b ? b.classList.contains('is-disabled') : null };
});
ok(pre.hidden === true || pre.disabled === true, 'B2 未滑到底时进入按钮不可点（门控在）', JSON.stringify(pre));
await page.evaluate(() => { const b = document.getElementById('splash-box'); if (b) b.scrollTop = b.scrollHeight; });
await sleep(900);
const post = await page.evaluate(() => { const b = document.getElementById('splash-enter'); return { hidden: b.hidden, disabled: b.classList.contains('is-disabled') }; });
ok(post.hidden === false && post.disabled === false, 'B3 滑到底后进入按钮可点', JSON.stringify(post));
// B4/B5 退役（2026-10-01 本批顺手收口）：d88075d「开屏改1页」把第二页内容并入第一页底部、
//   #splash-mandatory 容器已删（clock.js showMandatory 因 mandEl=null 自动 finishEnter）＝「点进入弹强制公告层」
//   流程不复存在，两断言自此常红（纯 origin/main 副本实测同红＝存量债非本批引入）；进入即隐藏的守门由 B6 继续承担。
await page.evaluate(() => document.getElementById('splash-enter').click());
await sleep(1200);
ok(await page.evaluate(() => { const s = document.getElementById('splash'); return !s || s.classList.contains('hide') || s.hidden; }), 'B6 确认后正常进入（开屏隐藏）');

await browser.close();
srv.close();
console.log('\n' + (fail === 0 ? '✅' : '❌') + ' verify-976-splash-order-colors: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
