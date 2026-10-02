// 验证：音乐「TA 暂停再播放」互动在产物中完整在位（FIX-REGRESSION #71）
// 用法：node tools/verify-ta-pause.mjs（构建后运行）
// 检查：设置键/设置面板 UI/两组字卡数据（各 6 条）/字卡库 FUNC_KEYS 注册/音乐 tab
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

check('设置键 taPauseProb 在位（music-player.js）', html.includes('taPauseProb'));
check('权限开关键 taPauseEn 在位（可关闭 TA 暂停权限）', html.includes('taPauseEn'));
check('设置面板权限开关 sm-set-pause-en 在位', html.includes('sm-set-pause-en'));
check('设置面板步进器 sm-set-pauseprob 在位', html.includes('sm-set-pauseprob'));
check('防连发：同一首歌只互动一次（taPauseDoneId）', html.includes('taPauseDoneId'));
check('防连发：互动后冷却（taPauseCooldownAt）', html.includes('taPauseCooldownAt'));
check('TA 暂停期补播短路（taPauseActive 在 onpause 守卫）', html.includes('taPauseActive'));
check('「TA 暂停播放」分组名在位（default-cards-data.js）', html.includes('TA 暂停播放'));
check('「TA 恢复播放」分组名在位', html.includes('TA 恢复播放'));

const pauseCards = [
  '先暂停一下，听我说句话', '嘘——让音乐停一会儿', '这首歌，先搁一搁',
  '暂停一下，我有话想跟你说', '先别听歌了，陪我一下下', '（TA 按下了暂停键）'
];
pauseCards.forEach(c => check('暂停字卡：' + c, html.includes(c)));

const resumeCards = [
  '好啦，继续听吧', '又帮你按了播放，接着听', '歌等你等急了，放吧',
  '好啦，音乐继续', '（TA 又按下了播放键）', '想说的话说完啦，继续听歌吧'
];
resumeCards.forEach(c => check('恢复字卡：' + c, html.includes(c)));

check('字卡库 FUNC_KEYS 注册 music 分类（default-cards.js）', /(?:FUNC_KEYS\s*=\s*\[[^\]]*'music'|'music'[^\]]*\])/.test(html));
check('字卡库「音乐」tab 在位（template.html fc-tabs）', html.includes('data-type="music"'));

console.log(fail ? '\n❌ ' + fail + ' 项失败' : '\n✅ ' + pass + '/' + (pass + fail) + ' 通过');
process.exit(fail ? 1 : 0);
