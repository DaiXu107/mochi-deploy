// ===== 功能：占卜（复刻星言完整版） =====
// 两种模式：塔罗（78 张完整牌库：22 大阿卡纳 + 56 小阿卡纳，均带正逆位）/ 雷诺曼（40 张）
// 张数：1 / 3（过去·现在·未来）/ 7（完整牌阵）；牌面为矢量线条图标
(function () {
  const page = document.getElementById('page-divine');
  if (!page) return;

  let mode = 'tarot';
  let count = 3;
  const store = window.activeStore();

  // ---- 塔罗 22 张大阿卡纳（矢量图标 + 牌名 + 正逆位寓意 + 详细解读）----
  const TAROT = [
    { name: '愚人', icon: 'sun', pos: '新的开始，勇敢出发。', neg: '鲁莽行事，需三思。', detail: '天真无畏的开端。此刻最适合跟随直觉迈出第一步，别怕未知，路上自有风景与贵人。' },
    { name: '魔术师', icon: 'wand', pos: '掌握资源，心想事成。', neg: '空想多于行动。', detail: '你手中早已握有需要的资源与能力。把想法落到行动上，主动出击，一切皆可成。' },
    { name: '女祭司', icon: 'moon', pos: '直觉敏锐，静观其变。', neg: '忽视内心的声音。', detail: '答案不在表面，而在直觉与静默之中。慢下来倾听内心，你会知道该怎么做。' },
    { name: '皇后', icon: 'flower', pos: '丰盛滋养，温柔以待。', neg: '过度付出忽略自己。', detail: '温柔与丰盛正在靠近。好好照顾自己，也大方接纳身边的美好与爱意。' },
    { name: '皇帝', icon: 'crown', pos: '稳固掌控，责任担当。', neg: '固执己见，控制过强。', detail: '秩序与责任带来稳固。用理性掌控局面，你比想象中更有力量。' },
    { name: '教皇', icon: 'book', pos: '遵循传统，获得指引。', neg: '墨守成规，缺乏变通。', detail: '此时遵循经验与传统会更有帮助。向信任的人请教，会得到可靠的指引。' },
    { name: '恋人', icon: 'heart', pos: '选择与联结，心意相通。', neg: '摇摆不定，沟通受阻。', detail: '重要的选择与联结正在发生。诚实面对心意，彼此靠近才能走得更远。' },
    { name: '战车', icon: 'chariot', pos: '坚定前进，掌控方向。', neg: '失去方向，内耗拉扯。', detail: '方向已经明确，只管坚定向前。专注目标，别被路上的杂音分心。' },
    { name: '力量', icon: 'lion', pos: '温柔的力量，勇气在心。', neg: '缺乏自信，逞强硬撑。', detail: '真正的力量是温柔与耐心。以柔克刚，你能化解眼前的难题。' },
    { name: '隐士', icon: 'lamp', pos: '独处思考，寻找答案。', neg: '孤僻封闭，拒绝帮助。', detail: '独处的时光正是成长的养分。给自己一点安静，答案会自己浮现。' },
    { name: '命运之轮', icon: 'wheel', pos: '时来运转，顺势而行。', neg: '运势波动，随遇而安。', detail: '时机正在转动，顺势而为。抓住变化的窗口，好运悄然靠近。' },
    { name: '正义', icon: 'scales', pos: '公平公正，理性裁决。', neg: '偏见失衡，犹豫不决。', detail: '因果分明，公道自在人心。坦然面对决定，真实会被看见。' },
    { name: '倒吊人', icon: 'hanged', pos: '换个角度，暂停思考。', neg: '无谓牺牲，停滞不前。', detail: '换个角度看问题，也许困局另有出口。暂停不是放弃，是为了更好的出发。' },
    { name: '死神', icon: 'skull', pos: '结束与新生，翻篇向前。', neg: '抗拒改变，迟迟不放。', detail: '旧章已经翻过，新页正在展开。放下执念，改变会带来意想不到的礼物。' },
    { name: '节制', icon: 'cup', pos: '平衡调和，恰到好处。', neg: '失衡过度，缺乏节制。', detail: '一切讲究平衡。恰到好处的付出与等待，会让事情走向圆满。' },
    { name: '恶魔', icon: 'devil', pos: '看清执念，挣脱束缚。', neg: '深陷欲望，难以自拔。', detail: '看清什么在捆绑你。放下执念与贪求，你会发现自由其实唾手可得。' },
    { name: '高塔', icon: 'tower', pos: '突变的觉醒，打破僵局。', neg: '恐慌不安，逃避现实。', detail: '突如其来的变化带来清醒。打破旧结构，反而会开启真正的成长。' },
    { name: '星星', icon: 'star', pos: '希望之光，心愿可期。', neg: '信心受挫，暂时暗淡。', detail: '希望与心愿在远方发光。保持相信，你的愿望正在一步步靠近。' },
    { name: '月亮', icon: 'crescent', pos: '直觉与幻象，看清真相。', neg: '不安迷惘，被情绪困住。', detail: '真相藏在情绪与幻象之下。别急着下结论，看清之后再做决定。' },
    { name: '太阳', icon: 'sunny', pos: '光明坦途，喜悦丰收。', neg: '短暂的阴霾，乐观仍在。', detail: '光明坦荡，喜悦将至。大胆展示真实的自己，好运自会相迎。' },
    { name: '审判', icon: 'trumpet', pos: '觉醒重生，重要抉择。', neg: '悔恨自省，难以原谅。', detail: '觉醒的时刻到了。回望过去，原谅自己，然后带着清明重新出发。' },
    { name: '世界', icon: 'globe', pos: '圆满达成，新的循环。', neg: '功亏一篑，尚需收尾。', detail: '一段旅程圆满落幕。好好庆祝，也准备好迎接新的开始。' },
    // ---- 小阿卡纳 56 张（权杖·行动 / 圣杯·情感 / 宝剑·思维 / 星币·物质；宫廷牌用人物图标）----
    { name: '权杖王牌', icon: 'staff', pos: '行动力迸发，新契机。', neg: '冲动行事，虎头蛇尾。', detail: '一团火种落进手里。想做的事现在就可以动起来，热情是最强的燃料。' },
    { name: '权杖二', icon: 'staff', pos: '掌控全局，迈出计划。', neg: '犹豫不决，安于现状。', detail: '世界在手中展开。计划已经成形，勇敢迈出第一步，格局由你定。' },
    { name: '权杖三', icon: 'staff', pos: '进展顺利，远见有成。', neg: '视野受限，等待受阻。', detail: '船已出港，风正在吹。保持远望，你的付出开始有了回音。' },
    { name: '权杖四', icon: 'staff', pos: '庆祝与安稳，喜事临门。', neg: '过渡期动荡，根基不稳。', detail: '值得庆祝的时刻。安定下来的喜悦，好好享受眼下的团圆与收获。' },
    { name: '权杖五', icon: 'staff', pos: '良性竞争，激发斗志。', neg: '纷争内耗，冲突升级。', detail: '场面上有些吵闹。把竞争当成磨刀石，别让争执伤了真正的感情。' },
    { name: '权杖六', icon: 'staff', pos: '胜利凯旋，获得认可。', neg: '骄傲自满，风光不再。', detail: '掌声响起。你的努力被看见了，接受赞美，也记住来时的路。' },
    { name: '权杖七', icon: 'staff', pos: '坚守立场，以少胜多。', neg: '力不从心，节节败退。', detail: '一人守住高地。眼下是考验耐心的时刻，站稳了，你就赢了。' },
    { name: '权杖八', icon: 'staff', pos: '消息速至，进展飞快。', neg: '节奏混乱，延误迟滞。', detail: '八支权杖齐飞。事情正在加速推进，好消息很快会抵达。' },
    { name: '权杖九', icon: 'staff', pos: '韧性十足，胜利在望。', neg: '疲惫设防，草木皆兵。', detail: '带伤仍站立。你已经走了很远，最后一步咬咬牙就到。' },
    { name: '权杖十', icon: 'staff', pos: '负重前行，接近终点。', neg: '不堪重负，学会放手。', detail: '肩上的担子不少。有些可以放下，别把所有事都扛在自己身上。' },
    { name: '权杖侍从', icon: 'page', pos: '好奇心旺，跃跃欲试。', neg: '三分钟热度，浅尝辄止。', detail: '新点子冒头。保持好奇去尝试，热情会让路越走越宽。' },
    { name: '权杖骑士', icon: 'knight', pos: '热情行动，敢闯敢冲。', neg: '横冲直撞，缺乏耐心。', detail: '骑手疾驰而来。行动派的时刻，冲劲可贵，方向要对。' },
    { name: '权杖王后', icon: 'queen', pos: '自信温暖，感染力强。', neg: '强势张扬，忽视他人。', detail: '她自带光芒。用你的热情点亮周围，温柔与力量可以并存。' },
    { name: '权杖国王', icon: 'king', pos: '远见领导，魄力十足。', neg: '独断专行，刚愎自用。', detail: '他稳坐中军。以远见和魄力掌舵，是带领大家前进的时候。' },
    { name: '圣杯王牌', icon: 'cup', pos: '情感新生，心流涌动。', neg: '压抑情感，错失心动。', detail: '杯子满溢。心底涌起的情感是真的，接住它，别装作没看见。' },
    { name: '圣杯二', icon: 'cup', pos: '心意相通，彼此回应。', neg: '失衡的关系，貌合神离。', detail: '两只杯子轻碰。彼此的回应正在发生，这是最动人的默契。' },
    { name: '圣杯三', icon: 'cup', pos: '欢聚分享，友情升温。', neg: '圈层纷扰，流言是非。', detail: '三人举杯。和朋友多聚聚，喜悦会因为分享而成倍增长。' },
    { name: '圣杯四', icon: 'cup', pos: '静心审视，重新出发。', neg: '倦怠冷漠，错过机会。', detail: '树下的沉思。对眼前有些提不起劲？不妨先看看手里已有的。' },
    { name: '圣杯五', icon: 'cup', pos: '接纳遗憾，珍惜尚存。', neg: '沉溺失落，无视所有。', detail: '打翻了几杯，还有立着的。别只盯着洒掉的，转身还有余地。' },
    { name: '圣杯六', icon: 'cup', pos: '纯真回忆，旧情重温。', neg: '困于过去，拒绝长大。', detail: '旧日的花开着。一段回忆或旧识带来温暖，怀念但不沉溺。' },
    { name: '圣杯七', icon: 'cup', pos: '梦想丰富，择善而行。', neg: '空想迷乱，脱离现实。', detail: '云中满是幻影。选择很多，把最真的那个落到现实里。' },
    { name: '圣杯八', icon: 'cup', pos: '告别过去，寻找意义。', neg: '逃避出走，徘徊不定。', detail: '转身离开的时刻。有些路要走远一点才明白，出发吧。' },
    { name: '圣杯九', icon: 'cup', pos: '心愿得偿，心满意足。', neg: '表面满足，内心空虚。', detail: '愿望成真的甜。享受此刻的丰盛，你值得。' },
    { name: '圣杯十', icon: 'cup', pos: '情感圆满，幸福满溢。', neg: '理想幻灭，家庭失和。', detail: '彩虹下举杯的一家。这是情感牌里最好的画面，用心经营就能抵达。' },
    { name: '圣杯侍从', icon: 'page', pos: '灵感萌动，纯真表达。', neg: '情绪化，幼稚任性。', detail: '捧着杯子的小小信号。一句真诚的表达，就能拉近彼此。' },
    { name: '圣杯骑士', icon: 'knight', pos: '浪漫告白，心意送达。', neg: '多愁善感，承诺空洞。', detail: '浪漫的骑士来了。甜蜜的消息或告白正在路上，用心回应。' },
    { name: '圣杯王后', icon: 'queen', pos: '温柔共情，善解人意。', neg: '情绪泛滥，过度付出。', detail: '她懂你未说出口的话。用温柔接住彼此，也别忘了照顾自己。' },
    { name: '圣杯国王', icon: 'king', pos: '沉稳包容，情感成熟。', neg: '情感封闭，压抑克制。', detail: '他平静如深海。成熟的关怀不喧哗，稳定本身就是力量。' },
    { name: '宝剑王牌', icon: 'sword', pos: '思路清明，一语中的。', neg: '言语伤人，思维混乱。', detail: '剑已出鞘。看清真相的时刻，理性的光会劈开迷雾。' },
    { name: '宝剑二', icon: 'sword', pos: '权衡利弊，静待时机。', neg: '回避抉择，僵持不下。', detail: '蒙眼持剑的平衡。决定先放一放没关系，但别永远闭着眼。' },
    { name: '宝剑三', icon: 'sword', pos: '直面伤痛，痛后清明。', neg: '心碎难愈，反复内耗。', detail: '心上有剑的痕迹。疼是真的，但这疼会让你看得更清楚。' },
    { name: '宝剑四', icon: 'sword', pos: '休整蓄力，静养生息。', neg: '消极避世，恢复缓慢。', detail: '静卧的骑士。允许自己休息，恢复是下一步行动的一部分。' },
    { name: '宝剑五', icon: 'sword', pos: '思辨胜出，以理服人。', neg: '赢了道理，输了人心。', detail: '胜负已分。想想你要的到底是赢，还是关系。' },
    { name: '宝剑六', icon: 'sword', pos: '驶离困境，渐入佳境。', neg: '旧事纠缠，难以脱身。', detail: '船正驶向平静水域。离开消耗你的环境，前方会好起来。' },
    { name: '宝剑七', icon: 'sword', pos: '巧思破局，机智应对。', neg: '投机取巧，暗中行事。', detail: '有人悄悄拿走了什么。策略可以用，但别用在亲近的人身上。' },
    { name: '宝剑八', icon: 'sword', pos: '突破自设，挣脱束缚。', neg: '自我设限，画地为牢。', detail: '束缚多是自己系的。绳子没那么紧，你随时可以走。' },
    { name: '宝剑九', icon: 'sword', pos: '正视焦虑，黎明将至。', neg: '失眠忧虑，噩梦缠身。', detail: '夜半惊坐起。焦虑在放大问题，天亮再看看，没那么糟。' },
    { name: '宝剑十', icon: 'sword', pos: '谷底翻转，触底新生。', neg: '彻底崩溃，结束难熬。', detail: '最坏的时刻。既然已到谷底，往哪走都是向上。' },
    { name: '宝剑侍从', icon: 'page', pos: '敏锐观察，勤学好问。', neg: '机灵过头，言语轻率。', detail: '举着剑的小侦探。多看多问少下结论，信息就是你的武器。' },
    { name: '宝剑骑士', icon: 'knight', pos: '果敢直言，雷厉风行。', neg: '言语尖锐，咄咄逼人。', detail: '风向变了，他冲在最前。有话直说是好事，注意别带刺。' },
    { name: '宝剑王后', icon: 'queen', pos: '清醒独立，明辨是非。', neg: '冷漠苛刻，理性过头。', detail: '她的眼睛容不下沙子。保持清醒很好，但心不是法庭。' },
    { name: '宝剑国王', icon: 'king', pos: '权威公正，理性裁决。', neg: '专断严苛，铁面无情。', detail: '他以理智执政。规则和公正是你的底气，人情也是。' },
    { name: '星币王牌', icon: 'coin', pos: '机会落地，财运开启。', neg: '错失良机，财来财去。', detail: '手里落下一枚金币。一个实实在在的机会出现了，握住它。' },
    { name: '星币二', icon: 'coin', pos: '灵活统筹，游刃有余。', neg: '两头兼顾，顾此失彼。', detail: '他在抛接两枚金币。多线并行考验平衡，节奏对了就稳。' },
    { name: '星币三', icon: 'coin', pos: '技艺精进，协作有成。', neg: '配合不畅，标准不一。', detail: '图纸前的商量。把专业的事交给专业的人，合作出精品。' },
    { name: '星币四', icon: 'coin', pos: '守住成果，稳中求进。', neg: '过度保守，抓得太紧。', detail: '他紧紧抱着金币。安全感重要，但钱也要会流动才有生命力。' },
    { name: '星币五', icon: 'coin', pos: '同舟共济，共渡难关。', neg: '捉襟见肘，孤立无援。', detail: '风雪中的赶路人。眼下紧一点没关系，身边有人一起走。' },
    { name: '星币六', icon: 'coin', pos: '给予与收获，有来有往。', neg: '施舍失衡，暗藏条件。', detail: '天平在手持。有来有往才是健康的关系，包括金钱。' },
    { name: '星币七', icon: 'coin', pos: '耐心培育，静待花开。', neg: '急于求成，半途而废。', detail: '倚锄守望的人。种下的已经在生长，别拔苗，等一等。' },
    { name: '星币八', icon: 'coin', pos: '专注打磨，精进不止。', neg: '机械重复，无暇抬头。', detail: '雕刻匠人的专注。把一件事做透，时间会给你复利。' },
    { name: '星币九', icon: 'coin', pos: '自立丰足，从容有底。', neg: '依赖成性，虚假富足。', detail: '花园里的从容。你已经有底气了，享受自己挣来的安稳。' },
    { name: '星币十', icon: 'coin', pos: '丰裕传承，家业稳固。', neg: '徒有形式，内里空虚。', detail: '拱门内的家业。长线经营有了模样，稳定是最奢侈的礼物。' },
    { name: '星币侍从', icon: 'page', pos: '踏实好学，脚踏实地。', neg: '目光短浅，动机不纯。', detail: '捧着金币研究的小孩。从眼前的实事学起，根基打牢。' },
    { name: '星币骑士', icon: 'knight', pos: '稳扎稳打，靠谱可靠。', neg: '墨守成规，进展缓慢。', detail: '他不快，但从不失约。慢慢来，比较快。' },
    { name: '星币王后', icon: 'queen', pos: '务实滋养，持家有道。', neg: '操劳过度，忽视情感。', detail: '她把日子过成了花园。照顾好现实，也照顾好心情。' },
    { name: '星币国王', icon: 'king', pos: '富足稳健，事业有成。', neg: '守财固执，物欲至上。', detail: '他坐拥丰饶。责任与收获并存，是享受成果的时候。' }
  ];
  // ===== 2026-11-18：塔罗三大体系（韦特 / 马赛 / 托特）=====
  // 韦特沿用上面的 TAROT；这里补马赛与托特的牌名、释义、图片索引。
  // 马赛：0-21 为公有领域 Conver 1760 大牌；22-77 为按马赛 pip 风格生成的数字牌/宫廷牌。
  // 托特：牌面版权未开放，内置一套简洁的托特风格文字牌面；用户可在牌面图鉴按体系导入自己的套卡。
  const SYS_RANKS = ['王牌', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const SYS_RANK_THEME = {
    '王牌': '新的开始、种子与机会', '二': '平衡、选择与相遇', '三': '初步成果、合作与扩展',
    '四': '稳定、停顿与巩固', '五': '冲突、挑战与调整', '六': '和谐、流动与修复',
    '七': '评估、等待与策略', '八': '精进、压力与推进', '九': '接近完成、独立与守护',
    '十': '完成、收获与负担'
  };
  const SYS_SUITS = [
    { cn: '权杖', icon: 'staff', theme: '行动、热情与创造' },
    { cn: '圣杯', icon: 'cup', theme: '情感、关系与直觉' },
    { cn: '宝剑', icon: 'sword', theme: '思维、沟通与冲突' },
    { cn: '星币', icon: 'coin', theme: '现实、工作与资源' }
  ];
  const SYS_COURT_THEME = {
    '侍从': '学习、消息与试探', '骑士': '行动、推进与冒险',
    '王后': '内在掌握、滋养与包容', '国王': '外在掌控、责任与领导',
    '王子': '理性的行动与开拓', '公主': '感受的落地与学习'
  };
  function sysMinor(suit, ri, courtName, courtIcon) {
    const isCourt = ri >= 10;
    const rank = isCourt ? courtName : SYS_RANKS[ri];
    const name = suit.cn + rank;
    const theme = isCourt ? SYS_COURT_THEME[courtName] : SYS_RANK_THEME[rank];
    return {
      name: name,
      icon: isCourt ? courtIcon : suit.icon,
      meaning: suit.theme + ' · ' + theme + '。',
      detail: suit.theme + '的' + rank + '：' + theme + '。把它放回你的问题里，看看这股能量正在哪里发生。'
    };
  }
  function sysBuildDeck(majors, courts, thoth) {
    const arr = majors.map(function (m) {
      return { name: m[0], icon: m[3], meaning: m[1], detail: m[2] };
    });
    SYS_SUITS.forEach(function (suit) {
      for (let i = 0; i < 10; i++) arr.push(sysMinor(suit, i));
      const ci = thoth ? ['knight', 'queen', 'knight', 'page'] : ['page', 'knight', 'queen', 'king'];
      courts.forEach(function (cn, j) { arr.push(sysMinor(suit, 10 + j, cn, ci[j])); });
    });
    return arr;
  }
  const MARSEILLE_MAJORS = [
    ['愚者', '自由的开始', '带着好奇心出发，不被既定框架束缚。', 'sun'],
    ['魔术师', '创造与行动', '你手里已经有需要的工具，现在是把想法变成现实的时候。', 'wand'],
    ['女祭司', '直觉与静默', '答案在表面之下，先安静下来听内心的声音。', 'moon'],
    ['皇后', '丰饶与滋养', '温柔地照顾自己，也允许美好进入生活。', 'flower'],
    ['皇帝', '秩序与掌控', '建立边界与规则，用稳定托住局面。', 'crown'],
    ['教皇', '传统与指引', '向经验与传统请教，或成为别人的引路人。', 'book'],
    ['恋人', '结合与选择', '重要的关系或选择出现，诚实面对自己的心意。', 'heart'],
    ['战车', '意志与前进', '方向已定，集中力量向前推进。', 'chariot'],
    ['正义', '平衡与因果', '看清事实、承担责任，做出公正的决定。', 'scales'],
    ['隐士', '内省与独处', '给自己一段安静的时间，答案会在独处中浮现。', 'lamp'],
    ['命运之轮', '循环与转机', '局势正在转动，顺势而为比硬撑更有用。', 'wheel'],
    ['力量', '温柔的勇气', '真正的力量不是压制，而是耐心与柔韧。', 'lion'],
    ['倒吊人', '暂停与换位', '换个角度看问题，暂停也是一种前进。', 'hanged'],
    ['死神', '结束与蜕变', '旧阶段正在结束，放下才能迎来新生。', 'skull'],
    ['节制', '调和与适度', '把节奏放慢，找到恰到好处的平衡。', 'cup'],
    ['恶魔', '欲望与束缚', '看清什么在捆住你，然后决定要不要松手。', 'devil'],
    ['高塔', '崩解与觉醒', '旧结构被打破，真相显现，重建从此刻开始。', 'tower'],
    ['星星', '希望与疗愈', '保持相信，微光正在带你走出低谷。', 'star'],
    ['月亮', '潜意识与迷雾', '情绪与幻象交织，先别急着下结论。', 'crescent'],
    ['太阳', '光明与生命力', '坦荡、喜悦与成功正在靠近。', 'sunny'],
    ['审判', '觉醒与召唤', '听见内心的召唤，做出真正属于自己的决定。', 'trumpet'],
    ['世界', '完成与圆满', '一个阶段圆满收束，准备好迎接新的循环。', 'globe']
  ];
  const THOTH_MAJORS = [
    ['愚者', '无限的可能', '一切尚未定型，带着纯粹的勇气跃入未知。', 'sun'],
    ['魔术师', '意志与创造', '意志集中之处，现实开始成形。', 'wand'],
    ['女祭司', '直觉与月之智慧', '答案在静默与直觉里，不在喧哗中。', 'moon'],
    ['皇后', '丰饶与创造', '生命力正在流动，允许自己被滋养。', 'flower'],
    ['皇帝', '秩序与权威', '建立稳固的结构，承担起主导的责任。', 'crown'],
    ['教皇', '教导与信念', '在传统与个人信念之间找到自己的位置。', 'book'],
    ['恋人', '结合与选择', '关系是一面镜子，选择也意味着承担。', 'heart'],
    ['战车', '意志的推进', '把分散的力量收拢，朝一个方向前进。', 'chariot'],
    ['调节', '平衡与因果', '每一个行动都有回声，校准你的方向。', 'scales'],
    ['隐士', '内省与追寻', '向内走，寻找属于自己的光。', 'lamp'],
    ['命运', '循环与转折', '轮盘转动，抓住变化带来的机会。', 'wheel'],
    ['欲望', '生命力与热情', '拥抱内在的火焰，让它成为行动的燃料。', 'lion'],
    ['倒吊人', '逆转与献祭', '换一个角度，放下执着才能看清。', 'hanged'],
    ['死神', '蜕变与重生', '结束不是终点，而是能量转换的门。', 'skull'],
    ['艺术', '调和与炼金', '把对立面融合成新的可能。', 'cup'],
    ['恶魔', '欲望与物质', '看清欲望的力量，别让它反过来控制你。', 'devil'],
    ['高塔', '崩解与解放', '旧结构崩塌，为真实的自己腾出空间。', 'tower'],
    ['星星', '希望与灵感', '在静夜里保持信念，灵感会来。', 'star'],
    ['月亮', '潜意识与幻象', '穿过情绪的迷雾，辨认真正的直觉。', 'crescent'],
    ['太阳', '生命力与光芒', '大胆站出来，让生命力被看见。', 'sunny'],
    ['新纪元', '新时代与召唤', '旧时代落幕，新的召唤已经出现。', 'trumpet'],
    ['宇宙', '完成与整合', '一切经历汇成整体，你已准备好进入下一程。', 'globe']
  ];
  const TAROT_MARSEILLE = sysBuildDeck(MARSEILLE_MAJORS, ['侍从', '骑士', '王后', '国王'], false);
  const TAROT_THOTH = sysBuildDeck(THOTH_MAJORS, ['骑士', '王后', '王子', '公主'], true);
  TAROT_MARSEILLE.forEach(function (c, i) {
    c.system = 'marseille';
    c.img = 'assets/divination/marseille/' + (i < 10 ? '0' + i : '' + i) + '.webp';
  });
  TAROT_THOTH.forEach(function (c, i) {
    c.system = 'thoth';
    c.img = 'assets/divination/thoth/' + (i < 10 ? '0' + i : '' + i) + '.webp';
  });
  TAROT.forEach(function (c) { c.system = 'wait'; });
  const TAROT_SYSTEMS = {
    wait: { id: 'wait', name: '韦特系', deck: TAROT, dir: 'assets/divination/tarot/' },
    marseille: { id: 'marseille', name: '马赛系', deck: TAROT_MARSEILLE, dir: 'assets/divination/marseille/' },
    thoth: { id: 'thoth', name: '托特系', deck: TAROT_THOTH, dir: 'assets/divination/thoth/' }
  };
  let tarotSystem = 'wait';
  function activeTarotDeck() { return (TAROT_SYSTEMS[tarotSystem] || TAROT_SYSTEMS.wait).deck; }
  window.__TAROT_SYSTEMS__ = TAROT_SYSTEMS;
  window.__divineActiveTarotDeck = activeTarotDeck;
  window.__divineSetTarotSystem = function (sys) {
    if (TAROT_SYSTEMS[sys]) tarotSystem = sys;
    try { if (typeof rebuildFaces === 'function') rebuildFaces(); } catch (e) {}
    return tarotSystem;
  };

  const TAROT_ICONS = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    wand: '<path d="M12 2l2 7 7 2-7 2-2 7-2-7-7-2 7-2z"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    flower: '<circle cx="12" cy="10" r="3"/><path d="M12 7V4M12 16v4M12 7a3 3 0 00-3-3M12 7a3 3 0 013-3M12 13a3 3 0 01-3 3M12 13a3 3 0 013 3"/>',
    crown: '<path d="M4 18h16M4 18l2-9 5 4 3-6 4 6 4-4 2 9"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>',
    heart: '<path d="M12 21s-7.5-4.7-9.3-9A5.3 5.3 0 0112 6.4a5.3 5.3 0 019.3 5.6c-1.8 4.3-9.3 9-9.3 9z"/>',
    chariot: '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><path d="M5 7v6h14V7M7 13l-2 7M17 13l2 7M3 13h18"/>',
    lion: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    lamp: '<path d="M12 2l3 7-3 3-3-3z"/><path d="M12 12v8M8 20h8"/>',
    wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>',
    scales: '<path d="M12 3v18M5 21h14M8 7h8M4 11l4-2 2 6M20 11l-4-2-2 6"/>',
    hanged: '<circle cx="12" cy="5" r="2"/><path d="M12 7v10M12 17c-2 0-3-3-3-6M12 17c2 0 3-3 3-6"/>',
    skull: '<circle cx="12" cy="12" r="8"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><path d="M10 17h4"/>',
    cup: '<path d="M4 10h16v2a8 8 0 01-16 0z"/><path d="M4 10a8 8 0 0116 0"/>',
    devil: '<path d="M12 3l7 10.5a4.5 4.5 0 11-7.5 5L12 3z"/><path d="M8.5 15.5a2.5 2.5 0 002 4.5M12 9v6"/>',
    tower: '<path d="M12 2l3 10h-6zM9 12l-2 8h10l-2-8"/><path d="M12 15v3"/>',
    star: '<path d="M12 2l2.4 5 5.6.8-4 4 .9 5.6-4.9-2.6-4.9 2.6.9-5.6-4-4 5.6-.8z"/>',
    crescent: '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/><path d="M12 8l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/>',
    sunny: '<circle cx="12" cy="12" r="5"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3M3.5 3.5l2.1 2.1M18.4 18.4l2.1 2.1M3.5 20.5l2.1-2.1M18.4 5.6l2.1-2.1"/>',
    trumpet: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/><path d="M8 4c-1.5 2.5-1.5 13.5 0 16"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18"/>',
    // ---- 小阿卡纳图标（花色 + 宫廷人物）----
    staff: '<path d="M12 3v18M12 8c3 0 5-2 5-5-3 0-5 2-5 5zM12 13c-3 0-5-2-5-5 3 0 5 2 5 5z"/>',
    sword: '<path d="M12 2l2.5 11h-5zM12 13v7M9 16h6M9 20h6"/>',
    coin: '<circle cx="12" cy="12" r="8"/><path d="M12 7l1.4 2.8 3.1.5-2.2 2.2.5 3.1L12 14.2 9.2 15.6l.5-3.1-2.2-2.2 3.1-.5z"/>',
    page: '<circle cx="12" cy="9" r="3"/><path d="M6 20c0-3 3-5 6-5s6 2 6 5M9 5l3-2 3 2"/>',
    knight: '<path d="M4 16l3-4 5 0 4-6 3 2-1 4 3 4M7 12l-3 2M4 18h3"/>',
    queen: '<circle cx="12" cy="9" r="3"/><path d="M6 20c0-3 3-5 6-5s6 2 6 5M7 6l2.5 1L12 4l2.5 3L17 6"/>',
    king: '<circle cx="12" cy="9" r="3"/><path d="M6 20c0-3 3-5 6-5s6 2 6 5M8 5l1.3 2L12 5l2.7 2L16 5"/>'
  };

  // ---- 雷诺曼 40 张（矢量图标 + 寓意 + 详细解读）----
  const LENO = [
    { name: '骑士', icon: 'horse', meaning: '迅速的行动与消息。', detail: '有消息正快速赶来，行动要快，机会不等人。' },
    { name: '四叶草', icon: 'clover', meaning: '小小的幸运与惊喜。', detail: '小小的幸运正在靠近，别错过手边的机会。' },
    { name: '船', icon: 'ship', meaning: '远行与旅程。', detail: '一段新的旅程或变动即将展开，走出去会有收获。' },
    { name: '房子', icon: 'house', meaning: '安稳的归属。', detail: '安稳与归属感，家和熟悉的环境给你力量。' },
    { name: '树', icon: 'tree', meaning: '成长与健康。', detail: '健康与成长，慢而稳地扎根，终会枝繁叶茂。' },
    { name: '云', icon: 'cloud', meaning: '暂时的迷雾与不确定。', detail: '眼前有些迷雾，等它散去再做决定也不迟。' },
    { name: '蛇', icon: 'snake', meaning: '潜在的考验与转折。', detail: '留意潜在的小转折，谨慎行事，别有疏漏。' },
    { name: '棺材', icon: 'coffin', meaning: '结束与新的开始。', detail: '结束即开始，清理旧物旧事，才能迎来新气象。' },
    { name: '花束', icon: 'bouquet', meaning: '美好与馈赠。', detail: '收到馈赠或美好，心情愉快，值得好好珍惜。' },
    { name: '镰刀', icon: 'scythe', meaning: '果断的切割。', detail: '果断切断消耗你的事物，干净利落反而轻松。' },
    { name: '鞭子', icon: 'whip', meaning: '反复与提醒。', detail: '反复出现的提醒，重视它，别一再绕开。' },
    { name: '鸟', icon: 'bird', meaning: '交谈与消息。', detail: '交谈与消息频繁，多沟通，信息里有答案。' },
    { name: '孩子', icon: 'child', meaning: '新生的开始。', detail: '一个全新的开始，保持天真，一切皆有可能。' },
    { name: '狐狸', icon: 'fox', meaning: '机智与谨慎。', detail: '多留个心眼，聪明应对，别轻信表面。' },
    { name: '熊', icon: 'bear', meaning: '力量与保护。', detail: '力量与守护，依靠坚定的后盾，大胆前行。' },
    { name: '星星', icon: 'star', meaning: '愿望与指引。', detail: '愿望有指引，许愿正当时，保持相信。' },
    { name: '鹤', icon: 'stork', meaning: '变化与喜讯。', detail: '好消息临近，变动带来喜讯，静候佳音。' },
    { name: '狗', icon: 'dog', meaning: '忠诚的陪伴。', detail: '忠诚与陪伴，可靠的朋友就在身边。' },
    { name: '塔', icon: 'tower', meaning: '独立与高度。', detail: '独立与高度，站得高看得远，格局打开。' },
    { name: '花园', icon: 'garden', meaning: '聚会与社交。', detail: '聚会与社交，人际往来会带来新机会。' },
    { name: '山', icon: 'mountain', meaning: '挑战与坚持。', detail: '前路有挑战，坚持就是胜利，翻过山就好。' },
    { name: '路口', icon: 'crossroad', meaning: '面临选择。', detail: '面临选择，倾听内心的声音，路在脚下。' },
    { name: '老鼠', icon: 'mouse', meaning: '细小的损耗。', detail: '细小损耗在发生，及时止损，别让小问题变大。' },
    { name: '心', icon: 'heart', meaning: '真挚的情感。', detail: '真挚的情感，感情上会有回应，大胆表达。' },
    { name: '戒指', icon: 'ring', meaning: '承诺与契约。', detail: '承诺与契约，重要关系更进一步，值得期待。' },
    { name: '信', icon: 'letter', meaning: '书面的消息。', detail: '书面消息将带来答案，留意来信与文字。' },
    { name: '书', icon: 'book', meaning: '知识或秘密。', detail: '知识或秘密，深入学习会有所得，也守好秘密。' },
    { name: '男人', icon: 'man', meaning: '一位重要的男性。', detail: '一位重要的男性将带来影响，留意他的态度。' },
    { name: '女人', icon: 'woman', meaning: '一位重要的女性。', detail: '一位重要的女性将带来影响，多听听她的看法。' },
    { name: '百合', icon: 'lily', meaning: '平静与纯净。', detail: '平静与纯净，心绪归宁，沉淀之后更清明。' },
    { name: '太阳', icon: 'sunny', meaning: '成功与光明。', detail: '成功与光明，事情终将明朗，全力以赴即可。' },
    { name: '月亮', icon: 'crescent', meaning: '直觉与情感。', detail: '直觉与情感，夜晚适合倾听内心，跟随感受。' },
    { name: '钥匙', icon: 'key', meaning: '答案与机会。', detail: '答案与机会就在手边，去开启它，别犹豫。' },
    { name: '鱼', icon: 'fish', meaning: '富足与资源。', detail: '富足与资源，财运转好，善用流动的机会。' },
    { name: '锚', icon: 'anchor', meaning: '稳定与安全。', detail: '稳定与安全，心有所系，根基牢固。' },
    { name: '十字架', icon: 'cross', meaning: '信念与考验。', detail: '信念受考验，坚持初心，熬过即是成长。' },
    { name: '灵体', icon: 'spirit', meaning: '直觉与灵感。', detail: '直觉与灵感增强，相信第六感，它会带路。' },
    { name: '香炉', icon: 'incense', meaning: '沉淀与净化。', detail: '沉淀与净化，清空杂念，轻装上阵。' },
    { name: '床', icon: 'bed', meaning: '休息与私密。', detail: '休息与私密，好好休整，睡眠也是疗愈。' },
    { name: '市场', icon: 'market', meaning: '交易与机会。', detail: '交易与机会，新的可能正在酝酿，值得一试。' }
  ];
  function divineModeLabel(m) {
    return m === 'tarot' ? '塔罗' : (m === 'lenormand' ? '雷诺曼' : (m === 'meihua' ? '梅花易数' : '占卜'));
  }
  window.__divineModeLabel__ = divineModeLabel;

  // 2026-11-18：内置牌面（塔罗 78 张 RWS 公有领域 / 雷诺曼 36 张历史牌）。
  // 雷诺曼第 37-40 张（灵体/香炉/床/市场）没有历史牌面，继续走图标牌面。
  TAROT.forEach(function (c, i) {
    if (i < 78) c.img = 'assets/divination/tarot/' + (i < 10 ? '0' + i : '' + i) + '.webp';
  });
  LENO.forEach(function (c, i) {
    if (i < 36) c.img = 'assets/divination/lenormand/' + (i < 9 ? '0' + (i + 1) : '' + (i + 1)) + '.webp';
  });
  function builtinFace(c, m) {
    if (!c) return '';
    if (c.img) return c.img;
    const deck = m === 'lenormand' ? LENO : activeTarotDeck();
    for (let i = 0; i < deck.length; i++) if (deck[i].name === c.name) return deck[i].img || '';
    return '';
  }
  window.__divineFaceFor__ = function (m, name) {
    const deck = m === 'lenormand' ? LENO : activeTarotDeck();
    for (let i = 0; i < deck.length; i++) if (deck[i].name === name) return deck[i].img || '';
    return '';
  };

  const LENO_ICONS = {
    horse: '<path d="M4 16l3-4 5 0 4-6 3 2-1 4 3 4M7 12l-3 2M4 18h3"/>',
    clover: '<line x1="12" y1="4" x2="12" y2="20"/><circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><circle cx="12" cy="14" r="3"/>',
    ship: '<path d="M3 16h18l-3 5H6zM12 16V6M8 6h8"/>',
    house: '<path d="M4 20V9l8-6 8 6v11M9 20v-6h6v6"/>',
    tree: '<path d="M12 3l4 7h-2.5l3 6H12M12 3L8 10h2.5l-3 6H12"/><path d="M12 16v4"/>',
    cloud: '<path d="M17 19a4 4 0 000-8 5.5 5.5 0 00-11 1A3.5 3.5 0 006.5 19z"/>',
    snake: '<path d="M4 15s3-2 6 0 6 2 8 0M4 15l-1-3M20 15l1-3"/><circle cx="4" cy="19" r="1"/>',
    coffin: '<path d="M8 3h8l-1 18H9zM9 9h6"/>',
    bouquet: '<circle cx="12" cy="9" r="3"/><path d="M12 6V3M10 8l-3 1M14 8l3 1M12 12v8M8 17l2-1M16 17l-2-1"/>',
    scythe: '<path d="M4 20L14 10M14 10c4-1 6-3 6-6-3 0-5 2-6 6z"/>',
    whip: '<path d="M4 5h10M8 5l-1 14M4 9l4-4M18 5h2"/>',
    bird: '<path d="M3 14c3-5 15-5 18 0-3-1-15-1-18 0zM7 14l-2 4M17 14l2 4"/>',
    child: '<circle cx="12" cy="8" r="3"/><path d="M6 18c0-3 3-5 6-5s6 2 6 5"/>',
    fox: '<path d="M8 6l-2-2 2 3a4 4 0 016 0l2-3-2 2 1 2-1 6h-6z"/><path d="M10 15v2M14 15v2"/>',
    bear: '<circle cx="12" cy="10" r="6"/><circle cx="9" cy="8" r="1.5"/><circle cx="15" cy="8" r="1.5"/><path d="M12 14l-1 4M12 14l1 4"/>',
    star: '<path d="M12 2l2.4 5 5.6.8-4 4 .9 5.6-4.9-2.6-4.9 2.6.9-5.6-4-4 5.6-.8z"/>',
    stork: '<path d="M12 3v18M12 6c-3 0-5 3-5 6 0 3 2 6 5 6M12 6c3 0 5 3 5 6 0 3-2 6-5 6"/><path d="M12 8v8"/>',
    dog: '<circle cx="9" cy="9" r="4"/><circle cx="15" cy="9" r="4"/><path d="M7 13l-2 8 4-3M17 13l2 8-4-3M9 13v5M15 13v5"/>',
    tower: '<path d="M9 3h6l-1 17h-4zM7 8h10"/>',
    garden: '<circle cx="8" cy="15" r="4"/><circle cx="16" cy="13" r="5"/><path d="M12 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/>',
    mountain: '<path d="M3 20L10 6l4 8 3-5 4 11z"/>',
    crossroad: '<path d="M12 3v18M3 12h18"/><path d="M12 3l-3 3 3 3 3-3z"/>',
    mouse: '<path d="M6 12a6 6 0 0112 0v4H6zM9 12v-3M15 12v-3M6 16v3M18 16v3"/><circle cx="8" cy="10" r=".8"/><circle cx="16" cy="10" r=".8"/>',
    heart: '<path d="M12 21s-7.5-4.7-9.3-9A5.3 5.3 0 0112 6.4a5.3 5.3 0 019.3 5.6c-1.8 4.3-9.3 9-9.3 9z"/>',
    ring: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    letter: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 8l9 6 9-6"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>',
    man: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/>',
    woman: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/><path d="M12 2v2"/>',
    lily: '<path d="M12 3l-2 5 4 0zM12 8v10M10 18h4M12 12c-3 0-4 3-4 6h0c2 0 3-2 4-3 1 1 2 3 4 3h0c0-3-1-6-4-6z"/>',
    sunny: '<circle cx="12" cy="12" r="5"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3M3.5 3.5l2.1 2.1M18.4 18.4l2.1 2.1M3.5 20.5l2.1-2.1M18.4 5.6l2.1-2.1"/>',
    crescent: '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>',
    key: '<circle cx="7" cy="17" r="4"/><path d="M10 14L20 4M16 8l3 3"/>',
    fish: '<path d="M3 12c4-5 14-5 18 0-4 5-14 5-18 0z"/><path d="M14 12h6"/><circle cx="6" cy="12" r=".8"/>',
    anchor: '<circle cx="12" cy="4" r="2"/><path d="M12 6v14M5 12h14M8 20h8M12 6a8 8 0 01-4 6"/>',
    cross: '<path d="M12 3v18M5 12h14"/><circle cx="12" cy="12" r="8"/>',
    spirit: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    incense: '<path d="M12 3l1 3h-2zM12 6v6M9 18h6M10 21h4"/><path d="M12 12c-3 0-4 2-4 4h8c0-2-1-4-4-4z"/>',
    bed: '<path d="M3 18v-8h18v8M3 14h18M7 18v-4M17 18v-4"/><circle cx="7" cy="9" r="2"/>',
    market: '<path d="M4 5h16l-2 12H6zM9 5v3M15 5v3M6 17h12l1 3H5z"/>'
  };

  // 牌阵标签（星言 modeLabels）
  const MODE_LABELS = {
    tarot: { 1: ['运势'], 3: ['过去', '现在', '未来'], 7: ['过去', '现在', '未来', '阻碍', '助力', '态度', '结果'] },
    lenormand: { 1: ['回复'], 3: ['回复 1', '回复 2', '回复 3'], 7: ['回复 1', '回复 2', '回复 3', '回复 4', '回复 5', '回复 6', '回复 7'] }
  };
  // ===== 2026-11-18：塔罗常用牌阵 =====
  // 只内置「通用牌阵方法」：位置含义与大致几何布局。坐标是牌中心在桌布上的百分比。
  const TAROT_SPREADS = [
    { id: 'single', name: '单张指引', count: 1, cw: 34, labels: ['今日指引'], desc: '一张牌回答当下最需要看见的讯息。', layout: [[50, 50]] },
    { id: 'ppf', name: '时间之流', count: 3, cw: 26, labels: ['过去', '现在', '未来'], desc: '看事情的来龙去脉与接下来的走向。', layout: [[22, 50], [50, 50], [78, 50]] },
    { id: 'sar', name: '情况·行动·结果', count: 3, cw: 26, labels: ['现状', '行动', '结果'], desc: '适合具体问题：现在怎样、该怎么做、会走向哪里。', layout: [[22, 50], [50, 50], [78, 50]] },
    { id: 'mind', name: '身·心·灵', count: 3, cw: 22, labels: ['身', '心', '灵'], desc: '看身体状态、内在情绪与更深层的需要。', layout: [[50, 25], [25, 75], [75, 75]] },
    { id: 'choice', name: '二选一', count: 5, cw: 23, labels: ['现状', 'A 发展', 'A 结果', 'B 发展', 'B 结果'], desc: '把两条路分开看，比较各自的发展与结果。', layout: [[50, 86], [22, 55], [22, 18], [78, 55], [78, 18]] },
    { id: 'horse', name: '马蹄牌阵', count: 7, cw: 13, labels: ['过去', '现在', '隐藏', '障碍', '环境', '建议', '结果'], desc: '从过去一路推到结果，适合看一件事的完整脉络。', layout: [[7, 76], [19, 49], [32, 28], [50, 20], [68, 28], [81, 49], [93, 76]] },
    { id: 'hex', name: '六芒星', count: 7, cw: 15.5, labels: ['问题核心', '过去', '现在', '未来', '对策', '环境', '结果'], desc: '核心、时间线、环境与对策一起看，适合复杂问题。', layout: [[50, 50], [50, 15], [77, 32], [77, 68], [50, 85], [23, 68], [23, 32]] },
    { id: 'celtic', name: '凯尔特十字', count: 10, cw: 15, labels: ['现状', '挑战', '根基', '过去', '目标', '近未来', '自我', '环境', '希望/恐惧', '结果'], desc: '最完整的经典牌阵：现状、阻碍、根基、目标与最终走向。', layout: [[32, 50], [32, 50, 90], [32, 79], [12, 50], [32, 21], [52, 50], [78, 87], [78, 66], [78, 45], [78, 24]] },
    { id: 'custom', name: '自定义牌阵', count: 0, cw: 24, labels: [], desc: '自己定张数；抽完在塔罗桌布上自由拖动每张牌。', layout: [] }
  ];
  const TAROT_SCOPES = [
    { id: 'full', name: '全部 78 张' },
    { id: 'major', name: '仅大阿卡纳 22 张' },
    { id: 'minor', name: '仅小阿卡纳 56 张' }
  ];
  let tarotSpreadId = 'ppf';
  let tarotScope = 'full';
  let customDef = null;
  let customEditMode = false;
  function loadCustomDef() {
    if (customDef) return customDef;
    let d = null;
    try { d = JSON.parse(gStore.get('divine-custom-spread') || 'null'); } catch (e) { d = null; }
    customDef = {
      count: (d && d.count) || 5,
      positions: (d && Array.isArray(d.positions)) ? d.positions.slice() : [],
      labels: (d && Array.isArray(d.labels)) ? d.labels.slice() : []
    };
    return customDef;
  }
  function ensureCustomDef(n) {
    n = Math.max(1, Math.min(12, n));
    const d = loadCustomDef();
    d.count = n;
    const defs = spreadPositions({ layout: [] }, n);
    while (d.positions.length < n) d.positions.push(defs[d.positions.length] || [50, 50]);
    d.positions.length = n;
    while (d.labels.length < n) d.labels.push('位置 ' + (d.labels.length + 1));
    d.labels.length = n;
    return d;
  }
  function saveCustomDef() {
    try { gStore.set('divine-custom-spread', JSON.stringify(loadCustomDef())); } catch (e) {}
  }
  function allowCustomFace() { return true; }
  function tarotDeckFor(scope) {
    const deck = activeTarotDeck();
    if (scope === 'major') return deck.slice(0, 22);
    if (scope === 'minor') return deck.slice(22);
    return deck.slice();
  }
  function spreadById(id) {
    for (let i = 0; i < TAROT_SPREADS.length; i++) {
      if (TAROT_SPREADS[i].id !== id) continue;
      if (id === 'custom' && typeof ensureCustomDef === 'function') {
        const d = ensureCustomDef(loadCustomDef().count || 5);
        return Object.assign({}, TAROT_SPREADS[i], { count: d.count, labels: d.labels.slice(), layout: d.positions.slice() });
      }
      return TAROT_SPREADS[i];
    }
    return TAROT_SPREADS[1];
  }
  function customSpreadCount() {
    const el = document.getElementById('div-custom-n');
    const n = parseInt((el && el.value) || '5', 10) || 5;
    return Math.max(1, Math.min(12, n));
  }
  function activeTarotSpread() {
    const s = spreadById(tarotSpreadId);
    if (s.id !== 'custom') return s;
    const n = customSpreadCount();
    const d = ensureCustomDef(n);
    return { id: 'custom', name: '自定义牌阵', count: n, cw: n >= 9 ? 14 : (n >= 5 ? 18 : (n <= 3 ? 26 : 20)), desc: s.desc, labels: d.labels.slice(), layout: d.positions.slice() };
  }
  window.__DIV_SPREADS__ = TAROT_SPREADS;
  window.__divineEnsureCustomDef = ensureCustomDef;
  window.__divineSaveCustomDef = saveCustomDef;
  window.__DIV_TAROT_SCOPES__ = TAROT_SCOPES;
  window.__divineSpreadById = spreadById;
  window.__divineTarotDeckFor = tarotDeckFor;

  // ===== 2026-11-18：梅花易数（数字/时间起卦） =====
  // 八卦先天数：乾1 兑2 离3 震4 巽5 坎6 艮7 坤8；lines 自下而上，1=阳 0=阴。
  const MH_TRIGRAMS = {
    1: { n: '乾', s: '☰', nat: '天', el: '金', lines: [1, 1, 1] },
    2: { n: '兑', s: '☱', nat: '泽', el: '金', lines: [1, 1, 0] },
    3: { n: '离', s: '☲', nat: '火', el: '火', lines: [1, 0, 1] },
    4: { n: '震', s: '☳', nat: '雷', el: '木', lines: [1, 0, 0] },
    5: { n: '巽', s: '☴', nat: '风', el: '木', lines: [0, 1, 1] },
    6: { n: '坎', s: '☵', nat: '水', el: '水', lines: [0, 1, 0] },
    7: { n: '艮', s: '☶', nat: '山', el: '土', lines: [0, 0, 1] },
    8: { n: '坤', s: '☷', nat: '地', el: '土', lines: [0, 0, 0] }
  };
  // 上卦-下卦 → 六十四卦名（通行本卦序）
  const MH_HEX = {
    '1-1': '乾为天', '8-8': '坤为地', '6-4': '水雷屯', '7-6': '山水蒙', '6-1': '水天需', '1-6': '天水讼',
    '8-6': '地水师', '6-8': '水地比', '5-1': '风天小畜', '1-2': '天泽履', '8-1': '地天泰', '1-8': '天地否',
    '1-3': '天火同人', '3-1': '火天大有', '8-7': '地山谦', '4-8': '雷地豫', '2-4': '泽雷随', '7-5': '山风蛊',
    '8-2': '地泽临', '5-8': '风地观', '3-4': '火雷噬嗑', '7-3': '山火贲', '7-8': '山地剥', '8-4': '地雷复',
    '1-4': '天雷无妄', '7-1': '山天大畜', '7-4': '山雷颐', '2-5': '泽风大过', '6-6': '坎为水', '3-3': '离为火',
    '2-7': '泽山咸', '4-5': '雷风恒', '1-7': '天山遁', '4-1': '雷天大壮', '3-8': '火地晋', '8-3': '地火明夷',
    '5-3': '风火家人', '3-2': '火泽睽', '6-7': '水山蹇', '4-6': '雷水解', '7-2': '山泽损', '5-4': '风雷益',
    '2-1': '泽天夬', '1-5': '天风姤', '2-8': '泽地萃', '8-5': '地风升', '2-6': '泽水困', '6-5': '水风井',
    '2-3': '泽火革', '3-5': '火风鼎', '4-4': '震为雷', '7-7': '艮为山', '5-7': '风山渐', '4-2': '雷泽归妹',
    '4-3': '雷火丰', '3-7': '火山旅', '5-5': '巽为风', '2-2': '兑为泽', '5-6': '风水涣', '6-2': '水泽节',
    '5-2': '风泽中孚', '4-7': '雷山小过', '6-3': '水火既济', '3-6': '火水未济'
  };
  const MH_KEYS = {
    '乾为天': '刚健进取', '坤为地': '柔顺承载', '水雷屯': '起步多难', '山水蒙': '启蒙求知',
    '水天需': '等待时机', '天水讼': '争执慎行', '地水师': '纪律行事', '水地比': '亲近合作',
    '风天小畜': '小有积蓄', '天泽履': '谨慎前行', '地天泰': '通泰顺遂', '天地否': '闭塞守静',
    '天火同人': '同心协力', '火天大有': '丰收有成', '地山谦': '谦逊得助', '雷地豫': '愉悦筹备',
    '泽雷随': '顺势跟随', '山风蛊': '整顿积弊', '地泽临': '亲临渐进', '风地观': '观察等待',
    '火雷噬嗑': '决断除障', '山火贲': '文饰修整', '山地剥': '剥落守本', '地雷复': '一阳来复',
    '天雷无妄': '真诚不妄', '山天大畜': '厚积待发', '山雷颐': '养正养身', '泽风大过': '非常之时',
    '坎为水': '险中求稳', '离为火': '光明依附', '泽山咸': '感应相通', '雷风恒': '恒久坚持',
    '天山遁': '退避保全', '雷天大壮': '壮盛守正', '火地晋': '晋升光明', '地火明夷': '韬光养晦',
    '风火家人': '家和有序', '火泽睽': '分歧求同', '水山蹇': '艰难绕行', '雷水解': '解困松绑',
    '山泽损': '减损增益', '风雷益': '增益进取', '泽天夬': '决断果行', '天风姤': '邂逅防微',
    '泽地萃': '汇聚人气', '地风升': '稳步上升', '泽水困': '困守待变', '水风井': '滋养守常',
    '泽火革': '变革更新', '火风鼎': '鼎新养贤', '震为雷': '震动警醒', '艮为山': '止静守界',
    '风山渐': '循序渐进', '雷泽归妹': '顺应有度', '雷火丰': '丰盛防满', '火山旅': '旅途谨慎',
    '巽为风': '柔顺渗透', '兑为泽': '喜悦沟通', '风水涣': '涣散重聚', '水泽节': '节制有度',
    '风泽中孚': '诚信感通', '雷山小过': '小过慎行', '水火既济': '已成防变', '火水未济': '未成继续'
  };
  const MH_SHENG = { 金: '水', 水: '木', 木: '火', 火: '土', 土: '金' };
  const MH_KE = { 金: '木', 木: '土', 土: '水', 水: '火', 火: '金' };
  function mhTrigramByLines(a) {
    const key = a.join('');
    for (const k in MH_TRIGRAMS) if (MH_TRIGRAMS[k].lines.join('') === key) return Number(k);
    return 8;
  }
  function mhRelation(ti, yong) {
    if (ti.el === yong.el) return { label: '体用比和', short: '吉', desc: '同气相求，事情稳步向前。' };
    if (MH_SHENG[yong.el] === ti.el) return { label: '用生体', short: '大吉', desc: '外来的助力正在靠近，顺势推进就好。' };
    if (MH_SHENG[ti.el] === yong.el) return { label: '体生用', short: '偏耗', desc: '付出偏多，容易耗神，量力而行。' };
    if (MH_KE[ti.el] === yong.el) return { label: '体克用', short: '小吉', desc: '你能掌控局面，但需要主动推进。' };
    return { label: '用克体', short: '偏阻', desc: '外部压力偏大，宜守不宜攻。' };
  }
  // n1/n2 留空＝以此刻时间起卦；传入数字则按数字起卦。
  function buildMeihua(n1, n2) {
    const now = new Date();
    const auto = !isFinite(n1) && !isFinite(n2);
    if (!isFinite(n1)) n1 = (now.getMonth() + 1) * 100 + now.getDate();
    if (!isFinite(n2)) n2 = now.getHours() * 100 + now.getMinutes();
    n1 = Math.abs(Math.round(n1)); n2 = Math.abs(Math.round(n2));
    const upper = ((n1 - 1) % 8 + 8) % 8 + 1;
    const lower = ((n2 - 1) % 8 + 8) % 8 + 1;
    const moving = ((n1 + n2 - 1) % 6 + 6) % 6 + 1;
    const up = MH_TRIGRAMS[upper], low = MH_TRIGRAMS[lower];
    const lines = low.lines.concat(up.lines);
    const name = MH_HEX[upper + '-' + lower] || '未知卦';
    const changed = lines.slice(); changed[moving - 1] = changed[moving - 1] ? 0 : 1;
    const cu = mhTrigramByLines(changed.slice(3)), cl = mhTrigramByLines(changed.slice(0, 3));
    const changedName = MH_HEX[cu + '-' + cl] || '';
    const ti = moving <= 3 ? up : low;
    const yong = moving <= 3 ? low : up;
    const rel = mhRelation(ti, yong);
    const key = MH_KEYS[name] || '';
    const summary = '本卦「' + name + '」（上' + up.n + '下' + low.n + '），动爻第' + moving + '爻。' +
      '体卦' + ti.n + '（' + ti.el + '），用卦' + yong.n + '（' + yong.el + '），' + rel.label + ' · ' + rel.short + '。' +
      (key ? '卦意：' + key + '。' : '') + rel.desc;
    return {
      n1: n1, n2: n2, auto: auto, upper: upper, lower: lower, moving: moving,
      lines: lines, name: name, key: key, changedName: changedName, changedUpper: cu, changedLower: cl,
      ti: { n: ti.n, el: ti.el }, yong: { n: yong.n, el: yong.el }, rel: rel, summary: summary
    };
  }
  function mhLinesHtml(mh) {
    let h = '';
    for (let i = 5; i >= 0; i--) {
      const yang = mh.lines[i] === 1;
      const mov = (i + 1) === mh.moving;
      h += '<div class="mh-line' + (yang ? ' yang' : ' yin') + (mov ? ' moving' : '') + '">' +
        (yang ? '<i></i>' : '<i></i><i></i>') +
        (mov ? '<b class="mh-dot">●</b>' : '') + '</div>';
    }
    return h;
  }
  function meihuaHtml(mh, question, summary) {
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const up = MH_TRIGRAMS[mh.upper], low = MH_TRIGRAMS[mh.lower];
    let html = '<div class="mh-wrap">' +
      '<div class="mh-head"><div class="mh-name">' + esc(mh.name) + '</div>' +
      '<div class="mh-sub">上' + up.n + '（' + up.nat + '）· 下' + low.n + '（' + low.nat + '）· 动爻第 ' + mh.moving + ' 爻' +
      (mh.auto ? ' · 此刻时间起卦' : ' · 数字起卦') + '</div></div>' +
      '<div class="mh-lines">' + mhLinesHtml(mh) + '</div>' +
      '<div class="mh-meta"><span class="mh-chip">体卦 ' + mh.ti.n + ' · ' + mh.ti.el + '</span>' +
      '<span class="mh-chip">用卦 ' + mh.yong.n + ' · ' + mh.yong.el + '</span>' +
      '<span class="mh-chip strong">' + mh.rel.label + ' · ' + mh.rel.short + '</span></div>' +
      '<div class="mh-read">' + esc(summary || mh.summary) + '</div>';
    if (mh.changedName) html += '<div class="mh-changed">变卦：' + esc(mh.changedName) + '（第 ' + mh.moving + ' 爻变）</div>';
    html += '</div>';
    if (question) html += '<div class="div-question-q">问：' + esc(question) + '</div>';
    html += '<div class="div-result-actions">' +
      '<button class="div-send-btn" id="div-send-btn">发给 ' + esc(partnerName2() || (window.taWord ? window.taWord() : 'TA')) + '</button>' +
      '<button class="div-copy-btn" id="div-copy-btn">点击复制文字</button></div>';
    return html;
  }
  function renderMeihuaInto(el, mh, question, summary) {
    if (!el) return;
    el.innerHTML = meihuaHtml(mh, question, summary);
    const sb = el.querySelector('#div-send-btn');
    if (sb) sb.addEventListener('click', function () { sendToChat('meihua', [{ name: mh.name, meaning: summary || mh.summary }], summary || mh.summary, question); });
    const cb = el.querySelector('#div-copy-btn');
    if (cb) cb.addEventListener('click', function () { copyResultText(buildResultText('meihua', [{ name: mh.name, meaning: summary || mh.summary }], summary || mh.summary, question)); });
  }

  // v3.5.53：牌库暴露给聊天页占卜半框复用
  try {
    Object.defineProperty(window, '__TAROT__', { get: function () { return activeTarotDeck(); }, configurable: true });
  } catch (e) { window.__TAROT__ = TAROT; }
  window.__LENO__ = LENO;
  window.__TAROT_ICONS__ = TAROT_ICONS;
  window.__LENO_ICONS__ = LENO_ICONS;
  window.__MODE_LABELS__ = MODE_LABELS;

  // ===== v3.27.x：自定义牌面（上传图片 / 图鉴 / 导入导出）＋ 雷诺曼 36-40 体系 =====
  // 设计要点：
  //  · 数据全局共用（全局命名空间 xy-home-v2），与牌库一致：换联系人牌面不变。
  //  · 每张牌一张自定义图，按「体系+牌名」绑定；原图压到 720px，另存 256px 缩略图
  //    （页面里的牌面与图鉴都用缩略图，原图仅在导出时按需从 IDB 取，内存常驻只有缩略图）。
  //  · 牌库对象自身的 icon 被换成合成键 '@df:<mode>:<牌名>'，合成键在 TAROT_ICONS/LENO_ICONS
  //    里注册为 svg <image>。因此聊天页占卜半框（chat.js）零改动即自动共用自定义牌面。
  const GNS = 'xy-home-v2';
  const gStore = window.xyStore(GNS);
  const FACE_IDX_KEY = 'divine-faces-idx';
  const LENO36_KEY = 'divine-leno-36';
  const FACE_PREFIX = '@df:';
  // ===== 2026-11-18：塔罗套卡（每个体系可有多套卡面，一次只应用一套） =====
  const DECK_SETS_KEY = 'divine-deck-sets';
  const ACTIVE_DECK_KEY = 'divine-active-deck';
  let deckMeta = null;
  function loadDeckMeta() {
    if (deckMeta) return deckMeta;
    let sets = {}, act = {};
    try { sets = JSON.parse(gStore.get(DECK_SETS_KEY) || '{}') || {}; } catch (e) { sets = {}; }
    try { act = JSON.parse(gStore.get(ACTIVE_DECK_KEY) || '{}') || {}; } catch (e) { act = {}; }
    deckMeta = { sets: {}, active: {} };
    ['wait', 'marseille', 'thoth'].forEach(function (sys) {
      const arr = Array.isArray(sets[sys]) ? sets[sys].filter(function (s) { return s && s.id && s.id !== 'builtin'; }) : [];
      deckMeta.sets[sys] = arr;
      deckMeta.active[sys] = act[sys] || 'builtin';
    });
    // 旧版「塔罗自定义牌面」并入韦特系「我的套卡」
    let legacy = [];
    try { legacy = JSON.parse(gStore.get(FACE_IDX_KEY) || '[]'); } catch (e) { legacy = []; }
    if (Array.isArray(legacy) && legacy.some(function (x) { return x && x.m === 'tarot'; })) {
      if (!deckMeta.sets.wait.some(function (s) { return s.id === 'my'; })) {
        deckMeta.sets.wait.push({ id: 'my', name: '我的套卡' });
      }
      if (!act.wait) deckMeta.active.wait = 'my';
    }
    return deckMeta;
  }
  function saveDeckMeta() {
    try { gStore.set(DECK_SETS_KEY, JSON.stringify(loadDeckMeta().sets)); } catch (e) {}
    try { gStore.set(ACTIVE_DECK_KEY, JSON.stringify(loadDeckMeta().active)); } catch (e) {}
  }
  function deckSetsOf(sys) { return loadDeckMeta().sets[sys] || []; }
  function activeSetOf(sys) { return loadDeckMeta().active[sys] || 'builtin'; }
  function setActiveSetOf(sys, setId) { loadDeckMeta().active[sys] = setId || 'builtin'; saveDeckMeta(); }
  function scopeOf(sys, setId) { return sys + '@' + (setId || 'builtin'); }
  function activeScopeOf(sys) { return scopeOf(sys, activeSetOf(sys)); }
  function scopeSystem(scope) { return String(scope || '').split('@')[0]; }
  function newDeckSet(sys, name) {
    const meta = loadDeckMeta();
    const id = 's' + Date.now().toString(36) + Math.floor(Math.random() * 100).toString(36);
    meta.sets[sys].push({ id: id, name: name || ('套卡 ' + (meta.sets[sys].length + 1)) });
    meta.active[sys] = id;
    saveDeckMeta();
    return id;
  }
  function removeDeckSet(sys, setId) {
    const meta = loadDeckMeta();
    meta.sets[sys] = meta.sets[sys].filter(function (s) { return s.id !== setId; });
    if (meta.active[sys] === setId) meta.active[sys] = 'builtin';
    saveDeckMeta();
  }

  const ORIG_ICON = { wait: {}, marseille: {}, thoth: {}, lenormand: {} };
  Object.keys(TAROT_SYSTEMS).forEach(function (sys) { TAROT_SYSTEMS[sys].deck.forEach(function (c) { ORIG_ICON[sys][c.name] = c.icon; }); });
  LENO.forEach(c => { ORIG_ICON.lenormand[c.name] = c.icon; });
  const faceThb = new Map();   // 'scope|牌名' -> 缩略图 dataURL（scope = 体系@套卡）
  let facePanelCid = 'tarot';  // 管理面板页签（tarot / lenormand）
  let facePanelSystem = 'wait'; // tarot 页签下当前体系
  // 面板只管「当前体系正在使用的那一套」：切换套卡＝切换应用，牌面管理直接编辑当前套卡。
  function panelScope() { return facePanelCid === 'lenormand' ? 'lenormand' : activeScopeOf(facePanelSystem); }
  function normScope(scope) {
    scope = String(scope || '');
    if (scope === 'lenormand') return 'lenormand';
    if (scope === 'wait' || scope === 'marseille' || scope === 'thoth') return activeScopeOf(scope);
    if (/^(wait|marseille|thoth)@/.test(scope)) return scope;
    return activeScopeOf('wait');
  }
  function legacySys(scope) { return scopeSystem(scope) === 'wait' ? 'tarot' : scopeSystem(scope); }
  let faceTab = 'manage';      // manage | gallery
  let pendingUpload = null;    // { m, n } 待上传的牌
  let facePanelScroll = 0;     // 浮层打开前的占卜页滚动位置（关闭时还原）
  let leno36 = false;          // 雷诺曼 36（经典）/ 40（含扩展）
  const ONEBASED_KEY = 'divine-face-onebased';
  let faceOneBased = false;
  try { faceOneBased = gStore.get(ONEBASED_KEY) === '1'; } catch (e) {}
  function obBtn_sync() {
    const b = document.getElementById('divf-onebased');
    if (b) {
      b.textContent = '编号从 1 起（塔罗 1–78）：' + (faceOneBased ? '开' : '关');
      b.setAttribute('aria-pressed', faceOneBased ? 'true' : 'false');
    }
  }

  function isFaceKey(k) { return typeof k === 'string' && k.indexOf(FACE_PREFIX) === 0; }
  function faceKey(m, n) { return FACE_PREFIX + m + ':' + n; }
  function faceParse(k) {
    const s = k.slice(FACE_PREFIX.length);
    const i = s.indexOf(':');
    return { m: s.slice(0, i), n: s.slice(i + 1) };
  }
  function encN(n) { return encodeURIComponent(n); }
  // 旧版自定义塔罗牌面存在 tarot 前缀下；「韦特@我的套卡」继续沿用旧键，老数据不搬家。
  function faceStorePrefix(scope) {
    scope = normScope(scope);
    if (scope === 'lenormand' || scope === 'wait@my') return legacySys(scope);
    return scope.replace('@', '~');
  }
  function fullKey(scope, n) { return 'divine-face-' + faceStorePrefix(scope) + '-' + encN(n); }
  function thbKey(scope, n) { return 'divine-face-thb-' + faceStorePrefix(scope) + '-' + encN(n); }
  function iconMapOf(m) { return scopeSystem(m) === 'lenormand' ? LENO_ICONS : TAROT_ICONS; }
  function cardOf(m, n) {
    const sys = scopeSystem(m);
    const a = sys === 'lenormand' ? LENO : ((TAROT_SYSTEMS[sys] || TAROT_SYSTEMS.wait).deck);
    for (let i = 0; i < a.length; i++) if (a[i].name === n) return a[i];
    return null;
  }
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function dtStamp() {
    const d = new Date();
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function rawFaceIdx() {
    try { const a = JSON.parse(gStore.get(FACE_IDX_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function loadFaceIdx(scope) {
    scope = normScope(scope || panelScope());
    let arr = [];
    const sys = scopeSystem(scope);
    if (scope === 'lenormand') {
      arr = rawFaceIdx().filter(function (x) { return x && x.m === 'lenormand'; })
        .map(function (x) { return { m: 'lenormand', n: x.n, t: x.t }; });
    } else if (scope === 'wait@my') {
      // 旧版「塔罗自定义牌面」＝韦特系的「我的套卡」
      arr = rawFaceIdx().filter(function (x) { return x && (x.m === 'tarot' || x.m === 'wait'); })
        .map(function (x) { return { m: 'wait', n: x.n, t: x.t }; });
    } else {
      try { arr = JSON.parse(gStore.get('divine-faces-idx-' + scope) || '[]'); } catch (e) { arr = []; }
      arr = (Array.isArray(arr) ? arr : []).map(function (x) { return { m: sys, n: x.n, t: x.t }; });
    }
    return arr.filter(function (x) { return x && x.n && cardOf(sys, x.n); });
  }
  function saveFaceIdx(arr, scope) {
    scope = normScope(scope || panelScope());
    const sys = scopeSystem(scope);
    const mine = (arr || []).map(function (x) { return { m: sys, n: x.n, t: x.t }; });
    if (scope === 'lenormand' || scope === 'wait@my') {
      const isMine = function (x) {
        if (!x) return false;
        return scope === 'lenormand' ? x.m === 'lenormand' : (x.m === 'tarot' || x.m === 'wait');
      };
      const other = rawFaceIdx().filter(function (x) { return x && !isMine(x); });
      const legacyMine = mine.map(function (x) { return { m: scope === 'lenormand' ? 'lenormand' : 'tarot', n: x.n, t: x.t }; });
      try { gStore.set(FACE_IDX_KEY, JSON.stringify(other.concat(legacyMine))); } catch (e) {}
    } else {
      try { gStore.set('divine-faces-idx-' + scope, JSON.stringify(mine)); } catch (e) {}
    }
  }

  // 把一张自定义牌面应用到牌库（合成键注册进 icon 映射 + 改写牌对象 icon）
  function applyFace(scope, n) {
    scope = normScope(scope);
    const thb = faceThb.get(scope + '|' + n);
    const c = cardOf(scope, n);
    if (!thb || !c) return;
    const k = faceKey(scope, n);
    iconMapOf(scope)[k] = '<image href="' + thb + '" x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid slice"/>';
    c.icon = k;
  }
  // 落一张牌面（原图 + 缩略图）并登记索引（单张上传 / 批量上传共用）
  function storeFaceFromDataUrls(scope, n, full, thb) {
    scope = normScope(scope);
    try { gStore.set(fullKey(scope, n), full); } catch (e) {}
    try { gStore.set(thbKey(scope, n), thb); } catch (e) {}
    const idx = loadFaceIdx(scope);
    if (!idx.some(x => x.n === n)) idx.push({ m: scopeSystem(scope), n: n, t: Date.now() });
    saveFaceIdx(idx, scope);
    faceThb.set(scope + '|' + n, thb);
    applyFace(scope, n);
  }
  // 按文件名匹配牌（批量上传）：支持「牌名」「牌名+阿拉伯数字（宝剑1）」「塔罗-牌名」「雷诺曼-牌名」「编号」
  //  · 编号：塔罗按 00-77（0 起，与牌库顺序一致），雷诺曼按 1-36/40（1 起）
  //  · 同名跨体系（太阳/月亮/星星/塔/书/心…）无前缀时用当前管理页签的体系
  // 牌库里的数字牌名是中文（宝剑王牌·宝剑二…宝剑十），素材文件名常写成阿拉伯数字（宝剑1…宝剑10、
  // 圣杯A/宝剑0）＝只有全等/子串一条路数时这些写法必然落不进候选。这里把牌名再展开一份数字别名
  // 去匹配（王牌→A/1/0，结尾中文数字→1..10），命中后返回的仍是库里真名，匹配口径不动。
  const CN_DIGIT = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  function varifyName(nm) {
    let out = [nm];
    if (/王牌$/.test(nm)) {
      // 王牌（Ace）的三种常见数字写法：A / 1 / 0
      const stem = nm.slice(0, -2);
      out = out.concat([stem + 'A', stem + '1', stem + '0']);
    }
    const cm = nm.match(/([一二三四五六七八九十]+)$/);
    if (cm) {
      const d = CN_DIGIT[cm[1]];
      if (d) out.push(nm.slice(0, nm.length - cm[1].length) + d);
    }
    return out;
  }
  // 数字结尾的牌名做子串匹配时，命中处后面不能再紧跟数字：否则不存在的「宝剑11」会被读成「宝剑1」+1，
  // 把用户的一张废图认成宝剑王牌（牌名本身写全时＝全等分支，不走这里）。
  function aliasHit(s, v) {
    if (s === v) return true;
    if (!v) return false;
    // 数字字符类必须写成两段独立范围：[0-９] 会被解析成 U+0030–U+FF19 的跨文种大区间，汉字也算数字
    const DIGIT = /[0-9０-９]/;
    if (!/[0-9０-９]$/.test(v)) return s.indexOf(v) >= 0;
    // 逐个落点看：只要有一处后面不紧跟数字，就算这张牌的数字写法被完整写出
    for (let i = s.indexOf(v); i >= 0; i = s.indexOf(v, i + 1)) {
      if (!DIGIT.test(s.charAt(i + v.length))) return true;
    }
    return false;
  }
  function matchFaceFile(rawName, defaultMode, oneBased = faceOneBased) {
    let s = String(rawName || '').replace(/\.[A-Za-z0-9]+$/, '').trim();
    if (!s) return null;
    // 全角数字折算半角（输入法打出的「宝剑１」「１２」＝同一张牌）；\d 不认全角，不折算则纯编号也漏
    s = s.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 48));
    let mode = '';
    const mp = s.match(/^(塔罗牌?|雷诺曼|雷诺|lenormand|lennormand|leno|len|tarot|taro)[\s._\-:：]*/i);
    if (mp) {
      const t = mp[1].toLowerCase();
      mode = (t.charAt(0) === '塔' || t.indexOf('tar') === 0) ? 'tarot' : 'lenormand';
      s = s.slice(mp[0].length).trim();
    }
    if (!s) return null;
    const defSys = TAROT_SYSTEMS[defaultMode] ? defaultMode : tarotSystem;
    const tarotArr = TAROT_SYSTEMS[defSys].deck;
    const numOf = (num) => {
      const m = mode || (defaultMode === 'lenormand' ? 'lenormand' : 'tarot');
      if (m === 'tarot') { const i = oneBased ? num - 1 : num; if (i >= 0 && i < tarotArr.length) return { m: defSys, n: tarotArr[i].name }; }
      else { const i = num - 1; if (i >= 0 && i < LENO.length) return { m: 'lenormand', n: LENO[i].name }; }
      return null;
    };
    if (/^\d+$/.test(s)) return numOf(parseInt(s, 10));
    let lead = null;
    const lm = s.match(/^(\d+)[\s._\-、:：#]*/);
    if (lm) { lead = parseInt(lm[1], 10); s = s.slice(lm[0].length).trim(); }
    // 补零写法折算（宝剑01 → 宝剑1）：纯编号路径靠 parseInt 已吃前导零，这里让数字牌名同口径。
    // 只砍「紧跟非零数字的那串零」，所以宝剑100／权杖00 这类不存在的牌号不会被折成有效牌。
    s = s.replace(/(\D)0+([1-9])/, '$1$2');
    if (s) {
      const cands = [];
      [[defSys, tarotArr], ['lenormand', LENO]].forEach(([m, arr]) => {
        arr.forEach(c => {
          varifyName(c.name).forEach(v => {
            if (!aliasHit(s, v)) return;
            cands.push({ m: m, n: c.name, exact: s === v, len: v.length });
          });
        });
      });
      if (cands.length) {
        const wantMode = mode === 'lenormand' ? 'lenormand' : defSys;
        if (mode) { const f = cands.find(x => x.m === wantMode); if (f) return { m: f.m, n: f.n }; }
        const exacts = cands.filter(x => x.exact);
        const pool = exacts.length ? exacts : cands.sort((a, b) => b.len - a.len);
        const pref = pool.find(x => x.m === defSys);
        const pick = pref || pool[0];
        return { m: pick.m, n: pick.n };
      }
    }
    if (lead !== null) return numOf(lead);
    return null;
  }
  // 按当前激活套卡重建全部牌面：先把每张牌还原成内置图，再只应用当前套卡（每体系一次只用一套）
  function rebuildFaces() {
    ['wait', 'marseille', 'thoth', 'lenormand'].forEach(function (sys) {
      const deck = sys === 'lenormand' ? LENO : TAROT_SYSTEMS[sys].deck;
      deck.forEach(function (c) { c.icon = ORIG_ICON[sys][c.name]; });
      const scope = sys === 'lenormand' ? 'lenormand' : activeScopeOf(sys);
      loadFaceIdx(scope).forEach(function (x) {
        if (faceThb.get(scope + '|' + x.n)) applyFace(scope, x.n);
      });
    });
  }
  // 所有可能存过牌面的作用域（各体系的每套卡 + 雷诺曼），用于一次性载入缩略图
  function allFaceScopes() {
    const out = ['lenormand'];
    ['wait', 'marseille', 'thoth'].forEach(function (sys) {
      deckSetsOf(sys).forEach(function (s) { out.push(scopeOf(sys, s.id)); });
      if (sys === 'wait') out.push('wait@my');
    });
    return out.filter(function (s, i) { return out.indexOf(s) === i; });
  }
  function loadFaces() {
    faceThb.clear();
    allFaceScopes().forEach(function (scope) {
      loadFaceIdx(scope).forEach(function (x) {
        let thb = null;
        try { thb = gStore.get(thbKey(scope, x.n)); } catch (e) {}
        if (typeof thb === 'string' && thb) faceThb.set(scope + '|' + x.n, thb);
      });
    });
    rebuildFaces();
    try { renderFaceList(); renderFaceGallery(); } catch (e) {}
  }
  function rmFaceData(scope, n) {
    scope = normScope(scope);
    try { gStore.remove(fullKey(scope, n)); } catch (e) {}
    try { gStore.remove(thbKey(scope, n)); } catch (e) {}
    faceThb.delete(scope + '|' + n);
  }
  // 压缩（失败返回 null）
  // FIX 2026-09-25 #1270：原来「base64 超 8MB 先拒 ＋ 解码后超 2600 万像素再拒」（与 personalize
  // 同口径）＝现代手机拍一张就 8MB 以上，自定义牌面怎么传都报「图片过大」；而放行时那次整幅
  // 解码（48MP＝192MB 位图）又是白屏大退的内存来源。现统一交给 img-ingest.js。
  function compressImg(src, maxSide, quality) {
    if (!window.mochiImgCompressTo) return Promise.resolve(null);
    return window.mochiImgCompressTo(src, { maxSide: maxSide, quality: quality, tag: 'div-face' });
  }

  // ---- 雷诺曼 36 / 40 体系 ----
  try { leno36 = gStore.get(LENO36_KEY) === '1'; } catch (e) { leno36 = false; }
  function lenoDeck() { return leno36 ? LENO.slice(0, 36) : LENO; }
  function syncLenoSys() {
    const wrap = document.getElementById('div-leno-sys');
    if (wrap) {
      wrap.hidden = mode !== 'lenormand';
      wrap.querySelectorAll('.div-mode').forEach(b => {
        b.classList.toggle('sel', (b.dataset.lenosys === '36') === leno36);
      });
    }
    // 聊天页半框里的同款切换（由 injectChatFacesUI 注入）
    const cw = document.getElementById('div-chat-leno-sys');
    if (cw) {
      const sel = document.querySelector('#chat-divine-body [data-chatmode].sel');
      const cmode = sel ? sel.getAttribute('data-chatmode') : 'tarot';
      cw.hidden = cmode !== 'lenormand';
      cw.querySelectorAll('.div-mode').forEach(b => {
        b.classList.toggle('sel', (b.dataset.lenosys === '36') === leno36);
      });
    }
  }
  // 聊天页半框沿用 window.__LENO__ 抽牌：改成 getter 即自动跟随 36/40
  try {
    Object.defineProperty(window, '__LENO__', { get: lenoDeck, configurable: true });
  } catch (e) { window.__LENO__ = LENO; }

  // ---- v3.27.x：占卜对象（选一个桌面联系人 → 该次牌面/解读写入 TA 的主页「占卜记录」）----
  // 缺实现补齐：chat.js / records.js 一直按 `window.divine*` 调用这组接口但源码里没有
  // （`#div-targets`/`#div-chat-targets` 永远空白、主页「占卜记录」永远空、「查看牌面」
  // 点了没反应）。这里补全：不选＝存当前桌面；选了某联系人＝存该联系人桌面。
  let divineTarget = '';   // '' = 不选（存到当前桌面）
  let homePending = [];    // IDB 回填完成前暂存的待写主页记录
  function curStore() { return (window.activeStore && window.activeStore()) || store; }
  function targetName(cid) {
    cid = cid || (window.__activeCid || 'default');
    try {
      let v = '';
      if (cid === (window.__activeCid || 'default')) {
        const s = curStore();
        v = s.get('lbl-partner') || s.get('cs-lbl-partner') || '';
      } else {
        const s = window.storeFor(cid);
        v = s.get('lbl-partner') || s.get('cs-lbl-partner') || '';
      }
      return v || (window.contactNameFor ? window.contactNameFor(cid) : '') || (window.taWordFor ? window.taWordFor(cid) : 'TA');
    } catch (e) { return 'TA'; }
  }
  function loadDivineTarget() {
    // 2026-11-18：不再提供占卜对象选择——从谁聊天进入就属于谁，避免旧记录串到别的桌面
    divineTarget = '';
  }
  function syncTargets() {
    document.querySelectorAll('[data-dtarget]').forEach(b =>
      b.classList.toggle('sel', (b.getAttribute('data-dtarget') || '') === divineTarget));
  }
  function renderTargetsInto(id) {
    const el = document.getElementById(id);
    if (!el) return;
    loadDivineTarget();
    const contacts = (window.getContacts && window.getContacts()) || [];
    const chips = [{ cid: '', label: '不选' }];
    contacts.forEach(c => { if (c && c.id) chips.push({ cid: c.id, label: targetName(c.id) }); });
    el.innerHTML = chips.map(x =>
      '<button type="button" class="div-mode' + ((x.cid || '') === divineTarget ? ' sel' : '') +
      '" data-dtarget="' + escHtml(x.cid || '') + '">' + escHtml(x.label) + '</button>').join('');
    if (!el.dataset.dtBound) {
      el.dataset.dtBound = '1';
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-dtarget]');
        if (!b) return;
        divineTarget = b.getAttribute('data-dtarget') || '';
        try { curStore().set('divine-target', divineTarget); } catch (e2) {}
        syncTargets();
      });
    }
  }
  window.divineRenderTargets = function (id) { try { renderTargetsInto(id); } catch (e) {} };
  window.divineGetTarget = function () { return divineTarget; };
  window.divineTargetName = function (cid) { return targetName(cid); };
  // 写主页「占卜记录」（records-divine，per-cid 桌面）；恢复窗口内暂存，回填后再合并
  function writeHomeRec(cid, record) {
    let list = [];
    try { list = JSON.parse(window.storeFor(cid).get('records-divine') || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    if (!list.some(x => x && x.ts === record.ts)) list.unshift(record);
    if (list.length > 100) list = list.slice(0, 100);
    try { window.storeFor(cid).set('records-divine', JSON.stringify(list)); } catch (e) {}
  }
  function saveToHome(record, target) {
    // 与主页文案一致（「选择对象抽牌后…自动存入这里」）：只有选了对象才写该对象主页；
    // 未选对象的占卜仍进占卜页本地历史（divine-history），不污染任何桌面的主页记录。
    if (!target) return;
    if (!histReady) { homePending.push({ cid: target, record: record }); return; }
    writeHomeRec(target, record);
  }
  function flushHomePending() {
    if (!homePending.length) return;
    const arr = homePending; homePending = [];
    arr.forEach(p => { try { writeHomeRec(p.cid, p.record); } catch (e) {} });
  }
  window.divineSaveToHomeHistory = function (record, target) { try { saveToHome(record, target); } catch (e) {} };

  // ---- 牌面渲染（divination.js 自己的两处牌面展示；聊天页走合成图标路径） ----
  function faceActive(c) {
    if (!isFaceKey(c.icon)) return false;
    const p = faceParse(c.icon);
    return !!faceThb.get(p.m + '|' + p.n);
  }
  function faceClass(c, m) {
    if (allowCustomFace(m) && faceActive(c)) return ' has-face';
    if (builtinFace(c, m)) return ' div-face-img';
    return '';
  }
  function faceTouch(c, m) {
    if (allowCustomFace(m) && faceActive(c)) {
      const p = faceParse(c.icon);
      const thb = faceThb.get(p.m + '|' + p.n);
      return '<div class="div-card-img"><img src="' + thb + '" alt=""></div>';
    }
    const bi = builtinFace(c, m);
    if (bi) return '<div class="div-card-img"><img src="' + bi + '" alt="" loading="lazy" decoding="async"></div>';
    if (isFaceKey(c.icon)) {
      // 图已删/缺图（旧记录）→ 回退该牌默认图标
      const p = faceParse(c.icon);
      const im = iconMapOf(p.m);
      return '<div class="div-card-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (im[ORIG_ICON[scopeSystem(p.m)][p.n]] || '') + '</svg></div>';
    }
    const icons = m === 'tarot' ? TAROT_ICONS : LENO_ICONS;
    return '<div class="div-card-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (icons[c.icon] || '') + '</svg></div>';
  }

  // 模式/张数切换
  const modesWrap = document.getElementById('div-modes');
  const countsWrap = document.getElementById('div-counts');
  if (modesWrap) {
    modesWrap.addEventListener('click', (e) => {
      const b = e.target.closest('.div-mode');
      if (!b) return;
      modesWrap.querySelectorAll('.div-mode').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
      mode = b.dataset.mode;
      syncLenoSys();
      syncModeUI();
      clearResult();
    });
  }
  function renderSpreadUI() {
    const picker = document.getElementById('div-picker-row');
    const spreadSel = document.getElementById('div-spread-select');
    const deckSel = document.getElementById('div-deck-select');
    const major = document.getElementById('div-major-only');
    const cn = document.getElementById('div-custom-n');
    const table = document.getElementById('div-spread-table');
    const isTarot = mode === 'tarot';
    if (picker) picker.hidden = !isTarot;
    if (!isTarot) { if (table) { table.hidden = true; table.innerHTML = ''; } return; }
    if (spreadSel && !spreadSel.dataset.bound) {
      spreadSel.innerHTML = TAROT_SPREADS.map(function (s) {
        return '<option value="' + s.id + '">' + s.name + (s.id === 'custom' ? '' : '（' + s.count + ' 张）') + '</option>';
      }).join('');
      spreadSel.addEventListener('change', function () {
        tarotSpreadId = spreadSel.value;
        renderSpreadUI();
        clearResult();
      });
      spreadSel.dataset.bound = '1';
    }
    if (spreadSel) spreadSel.value = tarotSpreadId;
    if (deckSel && !deckSel.dataset.bound) {
      deckSel.addEventListener('change', function () {
        tarotSystem = deckSel.value;
        if (window.__divineSetTarotSystem) window.__divineSetTarotSystem(tarotSystem);
        clearResult();
      });
      deckSel.dataset.bound = '1';
    }
    if (deckSel) deckSel.value = tarotSystem;
    if (major && !major.dataset.bound) {
      major.addEventListener('change', function () {
        tarotScope = major.checked ? 'major' : 'full';
        clearResult();
      });
      major.dataset.bound = '1';
    }
    if (major) major.checked = tarotScope === 'major';
    if (cn) {
      cn.hidden = tarotSpreadId !== 'custom';
      if (!cn.dataset.bound) {
        cn.dataset.bound = '1';
        cn.addEventListener('change', function () { renderSpreadUI(); clearResult(); });
      }
    }
    const dbtn = document.getElementById('div-draw');
    if (dbtn && dbtn.dataset.idleHtml && dbtn.textContent.indexOf('抽牌中') === -1 && dbtn.textContent.indexOf('起卦中') === -1) {
      dbtn.innerHTML = dbtn.dataset.idleHtml;
    }
    renderSpreadPreview();
  }
  function syncModeUI() {
    const isMh = mode === 'meihua';
    if (countsWrap) countsWrap.hidden = isMh || mode === 'tarot';
    const nums = document.getElementById('div-meihua-nums');
    if (nums) nums.hidden = !isMh;
    renderSpreadUI();
    const btn = document.getElementById('div-draw');
    if (btn && btn.dataset.idleHtml && btn.textContent.indexOf('抽牌中') === -1) {
      btn.innerHTML = btn.dataset.idleHtml;
    }
  }
  if (countsWrap) {
    countsWrap.addEventListener('click', (e) => {
      const b = e.target.closest('.div-mode');
      if (!b) return;
      countsWrap.querySelectorAll('.div-mode').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
      count = Number(b.dataset.count);
      clearResult();
    });
  }
  syncModeUI();
  function clearResult() {
    // v3.7.x：切换模式/张数时取消进行中的抽牌流程，避免旧流程把结果写进已清空的舞台
    if (window.__divActiveDraw) { try { window.__divActiveDraw(); } catch (e) {} window.__divActiveDraw = null; }
    const r = document.getElementById('div-result');
    if (r) r.innerHTML = '<div class="div-result-empty">点击上方按钮开始抽牌</div>';
    lastSpreadState = null;
    if (mode === 'tarot') { try { renderSpreadPreview(); } catch (e) {} }
    else { const t = document.getElementById('div-spread-table'); if (t) { t.hidden = true; t.innerHTML = ''; } }
  }

  // ---- v3.7.x：自动发送开关（每个联系人独立记忆，走动态 store） ----
  function autoSendGet() { try { return store.get('divine-send-auto') === '1'; } catch (e) { return false; } }
  function autoSendSet(on) { try { store.set('divine-send-auto', on ? '1' : '0'); } catch (e) {} }
  function syncAutoToggle() {
    const el = document.getElementById('div-auto-send');
    if (el) el.checked = autoSendGet();
  }

  // ---- v3.7.x：星言式抽牌流程（洗牌动画 → 两行牌面自由滑动 → 点击抽取） ----
  // 桌面占卜页与聊天页占卜半框共用；返回 cancel 函数（连点/切换设置时取消进行中的流程）
  function startDivineDraw(stageEl, opts) {
    const deck = shuf(opts.deck || []);
    const count = Math.max(1, parseInt(opts.count, 10) || 1);
    const labels = opts.labels || [];
    const isTarot = !!opts.tarot;
    const onDone = opts.onDone || function () {};
    if (!stageEl || !deck.length) return function () {};
    let cancelled = false;
    const cancel = function () { cancelled = true; };
    const results = [];
    let remaining = deck.slice();
    stageEl.innerHTML = '';
    // ① 洗牌动画：卡片四散飞舞后收拢
    // v3.7.x 修复：卡片以 left/top 50% 为锚（左上角），transform 必须带
    // translate(-50%,-50%) 自身居中补偿，否则整叠牌从舞台中心向右下悬挂（偏下、
    // 飞出舞台）；偏移量收敛在舞台范围内，半屏/全屏都不出界。
    const box = document.createElement('div');
    box.className = 'div-shuf-box';
    stageEl.appendChild(box);
    const shufCount = Math.min(remaining.length + 6, 20);
    const shufCards = [];
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < shufCount; i++) {
      const el = document.createElement('div');
      el.className = 'div-shuf-card';
      const size = Math.round(rnd(46, 60));
      const x = Math.round(rnd(-64, 64));
      const y = Math.round(rnd(-30, 30));
      const rot = Math.round(rnd(-32, 32));
      el.style.width = size + 'px';
      el.style.height = Math.round(size * 1.58) + 'px';
      el.style.transform = 'translate(-50%,-50%) translate(' + x + 'px,' + y + 'px) rotate(' + rot + 'deg)';
      el.style.opacity = (0.5 + Math.random() * 0.4).toFixed(2);
      el.style.zIndex = shufCount - i;
      box.appendChild(el);
      shufCards.push(el);
    }
    requestAnimationFrame(function () {
      shufCards.forEach(function (el, i) {
        setTimeout(function () {
          const px = Math.round(rnd(-76, 76));
          const py = Math.round(rnd(-34, 34));
          const pr = Math.round(rnd(-52, 52));
          el.style.transform = 'translate(-50%,-50%) translate(' + px + 'px,' + py + 'px) rotate(' + pr + 'deg) scale(.92)';
          el.style.opacity = (0.65 + Math.random() * 0.35).toFixed(2);
        }, 50 + i * 50);
      });
      setTimeout(function () {
        shufCards.forEach(function (el, i) {
          const offX = Math.round((i - shufCount / 2) * 1.2);
          const offY = Math.round((i - shufCount / 2) * 0.9);
          el.style.transform = 'translate(-50%,-50%) translate(' + offX + 'px,' + offY + 'px) rotate(0deg) scale(1)';
          el.style.opacity = '0.95';
          el.style.zIndex = shufCount - i;
        });
      }, 950);
    });
    // ② 洗牌完成 → 展示两行牌面（每行横向自由滑动），点击牌背抽取
    setTimeout(function () {
      if (cancelled) return;
      box.remove();
      const hint = document.createElement('div');
      hint.className = 'div-pile-hint';
      stageEl.appendChild(hint);
      const drawnRow = document.createElement('div');
      drawnRow.className = 'div-drawn-row';
      stageEl.appendChild(drawnRow);
      const pileScroll = document.createElement('div');
      pileScroll.className = 'div-pile-scroll';
      stageEl.appendChild(pileScroll);
      const updateHint = function () {
        if (cancelled) return;
        if (!remaining.length) hint.textContent = '牌库已空';
        else hint.textContent = '上下滑动牌面 · 点击牌背抽取 · 剩 ' + remaining.length + ' 张 · 已抽 ' + results.length + ' / ' + count + ' 张';
      };
      let pileEls = [];   // #1044：与 remaining 平行的牌背元素表（增量移除用）
      const renderGrid = function () {
        pileScroll.innerHTML = '';
        pileEls = [];
        const total = remaining.length;
        if (!total) { updateHint(); return; }
        for (let i = 0; i < total; i++) {
          const el = document.createElement('div');
          el.className = 'div-pile-card';
          // v3.7.x：牌背图形由 CSS ::after 绘制（✦ 星徽），不再用文本子元素
          // #1044：闭包改传元素本身——增量移除后 remaining 会重排，按创建序号找牌必错位
          el.addEventListener('click', function () { pick(el); });
          pileScroll.appendChild(el);
          pileEls.push(el);
        }
        updateHint();
      };
      const pick = function (el) {
        if (cancelled) return;
        const idx = pileEls.indexOf(el);
        if (idx < 0 || idx >= remaining.length) return;
        if (results.length >= count) return;
        const c = remaining[idx];
        remaining.splice(idx, 1);
        let rev = false, meaning = c.meaning;
        if (isTarot) { rev = Math.random() > 0.5; meaning = (rev ? c.neg : c.pos) || c.meaning || ''; }
        results.push({ name: c.name, icon: c.icon, rev: rev, meaning: meaning, detail: c.detail || '' });
        // #1044 牌堆增量移除：只摘走被抽中的那张，不再整堆重建。老实现每抽一张就把剩余
        // 全部牌背销毁重建（78 张牌阵一记点按≈上百个节点销毁+重建+监听器重挂），低端机
        // 与内存受压设备（诊断实测「本页被系统回收 15 次」一类）在这里吃出可感知的卡顿
        // 峰值；剩余牌照原顺序留在原位，视觉结果与全量重建完全一致。
        pileEls.splice(idx, 1);
        if (el.parentNode) el.parentNode.removeChild(el);
        updateHint();
        // 已抽牌：翻牌动画展示（图标 + 牌名 + 正/逆位 + 位置标签）
        const dc = document.createElement('div');
        dc.className = 'div-drawn-card';
        dc.innerHTML =
          '<div class="ddc-face' + faceClass(c, isTarot ? 'tarot' : 'lenormand') + '">' +
          faceTouch(c, isTarot ? 'tarot' : 'lenormand') +
          '<div class="ddc-name">' + c.name + '</div>' +
          (isTarot ? '<div class="ddc-pos' + (rev ? ' ddc-down' : ' ddc-up') + '">' + (rev ? '逆位' : '正位') + '</div>' : '') +
          '</div>' +
          (labels[results.length - 1] ? '<div class="ddc-label">' + labels[results.length - 1] + '</div>' : '');
        drawnRow.appendChild(dc);
        if (results.length >= count || !remaining.length) {
          setTimeout(function () { if (!cancelled) onDone(results); }, 550);
        }
      };
      renderGrid();
    }, 1750);
    return cancel;
  }

  function shuf(a) {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = b[i]; b[i] = b[j]; b[j] = t;
    }
    return b;
  }

  // ---- 综合解读（一句话总运势 + 问题呼应）----
  function partnerName2() {
    const n = storeName();
    return n ? n : '';
  }
  // v3.9.x：占卜从聊天页进入（聊天域）——优先读聊天专用昵称，未设置回退桌面昵称
  function storeName() {
    try { return store.get('lbl-partner') || store.get('cs-lbl-partner') || ''; } catch (e) { return ''; }
  }
  function buildSummary(cards, mode, question) {
    let line = '';
    if (mode === 'tarot') {
      const revCount = cards.filter(c => c.rev).length;
      const posCount = cards.length - revCount;
      if (revCount === 0) line = '牌面全数正位，气运正盛。近期的选择与努力大多会得到回报，可以大胆前行。';
      else if (posCount === 0) line = '牌面全数逆位，眼下更需要稳住心神。放缓节奏、少做重大决定，等迷雾散去再做打算。';
      else if (posCount > revCount) line = '牌面整体偏正，虽有波折但大势向好。把握核心目标，好运正在靠近。';
      else line = '牌面正逆交织，前路有起伏。越是这种时候，越要回到自己的节奏里，稳稳走好每一步。';
    } else {
      line = cards.map(c => '「' + c.name + '」' + c.meaning).join(' ');
    }
    if (question) {
      line += '就你问的「' + question + '」：' + (mode === 'tarot'
        ? '顺着牌面的大势走，答案会在合适的时候到来。'
        : '保持开放的心态，答案往往在行动中显现。');
    }
    return line;
  }
  // ---- 占卜记录（保存全部历史；IndexedDB 权威，localStorage 快照） ----
  // v3.6.x：恢复窗口保护——IDB 权威恢复完成前不落盘，防止用空数组覆盖
  // IndexedDB 里的全部历史（历史超 200KB 只存 IDB，恢复完成前 store.get 读到
  // 空数组，直接写会丢历史）。暂存待写，恢复完成后与 IDB 合并去重再写入。
  let histReady = false;
  let histOpen = false;   // 2026-11-18：记录默认收起，由数据管理卡右上角「占卜记录」打开
  let histPending = null;
  // v3.7.x：暂存记录所属联系人——恢复窗口内 A 抽牌后切到 B，flushPendingHist 须写回 A
  // 而非切换后的 B（原实现用当前 store，A 的牌落到 B + A 丢失）
  let histPendingCid = null;
  function histLoad() {
    let list = [];
    try { list = JSON.parse(store.get('divine-history') || '[]'); } catch (e) { list = []; }
    return Array.isArray(list) ? list : [];
  }
  function histSave(list) {
    const data = JSON.stringify(list);
    if (!histReady) {
      try { histPending = Array.isArray(list) ? list.slice() : []; histPendingCid = window.__activeCid || 'default'; } catch (e) {}
      return;
    }
    try { store.set('divine-history', data); } catch (e) {}
  }
  // v3.5.92 前占卜历史存无前缀裸键 divine-history；恢复完成后一次性迁入 default 命名空间并清裸键。
  // v3.7.x：原在 histLoad 里迁移——非 default 联系人也会迁（串桌面）+ 迁移调 histSave 污染
  //   histPending（恢复窗口内抽牌记录被覆盖丢失）。改为恢复完成后仅 default 迁移，不走 histSave。
  function migrateLegacyHist() {
    if ((window.__activeCid || 'default') !== 'default') return;
    try {
      if (window.storeFor('default').get('divine-history')) return;
      const raw = localStorage.getItem('divine-history');
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) {
        window.storeFor('default').set('divine-history', JSON.stringify(arr));
        try { localStorage.removeItem('divine-history'); } catch (e) {}
        try { renderHistory(); } catch (e) {}
      }
    } catch (e) {}
  }
  // 恢复完成后：合并恢复窗口内暂存的抽牌记录（按 ts 去重），落盘到暂存所属联系人 + 重绘
  function flushPendingHist() {
    if (!histPending) return;
    const pending = histPending;
    const pendingCid = histPendingCid || (window.__activeCid || 'default');
    histPending = null;
    histPendingCid = null;
    if (!pending.length) return;
    const targetStore = window.storeFor(pendingCid);
    const targetPrefix = 'xy-home-v2:' + pendingCid;
    const finish = (base) => {
      try { targetStore.set('divine-history', JSON.stringify(base)); } catch (e) {}
      try { if ((window.__activeCid || 'default') === pendingCid) renderHistory(); } catch (e) {}
    };
    const merge = (base) => {
      const have = {};
      base.forEach(x => { if (x && x.ts !== undefined) have[x.ts] = true; });
      pending.forEach(x => { if (x && x.ts !== undefined && !have[x.ts]) { base.push(x); have[x.ts] = true; } });
      finish(base);
    };
    if (window.idbGet) {
      window.idbGet(targetPrefix + ':divine-history').then(v => {
        let base = [];
        try { const p = typeof v === 'string' ? JSON.parse(v) : v; if (Array.isArray(p)) base = p; } catch (e) {}
        merge(base);
      }).catch(() => merge([]));
    } else {
      merge([]);
    }
  }
  // #857（同 decision.js）：本模块 defer 外置后，空库/快恢复时 mochi-restore-done 早在这一行
  // 执行前就派发完了，只挂监听＝永远等不到 → histReady 恒 false → 抽牌记录全塞进 histPending
  // /homePending 且永不落盘。已就绪时立即补跑同一处理器。
  function onDivRestore() {
    histReady = true;
    migrateLegacyHist();
    flushPendingHist();
    try { flushHomePending(); } catch (e) {}
    // v3.9.x：IDB 回填完成后补渲染历史区——文件加载时 renderHistOnOpen 可能在
    // idbRestore 完成前调用，此时 store.get('divine-history') 读到空（LS/memoryCache
    // 均无），历史区渲染空白；恢复完成后必须补渲染一次，否则已有历史记录显示不出来
    try { renderHistory(); } catch (e) {}
  }
  try {
    if (window.__mochiDataReady) onDivRestore();
    else document.addEventListener('mochi-restore-done', onDivRestore);
  } catch (e) {}
  function fmtDT(ts) {
    const d = new Date(ts);
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  // #1049 历史分页渲染（用户拍板：历史要全量保留，不封顶；性能改由「不打开不全量渲染」解决）
  // 每次只画 HIST_PAGE 条，更早的靠「显示更早的记录」按钮增量挂载（每页 ≤30 行，与记录总数无关）；
  // 查看/删除/加载更多走容器上绑一次的委托监听（data-hi 是全量列表的绝对索引，翻页不错位）。
  const HIST_PAGE = 30;
  let histShown = HIST_PAGE;
  function histRowHtml(h, i) {
    return '<div class="div-h-item" data-hi="' + i + '">' +
      '<div class="div-h-main"><div class="div-h-title">' + divineModeLabel(h.mode) + (h.spread ? ' · ' + h.spread.name : '') + ' · ' + h.count + ' 张' +
      (h.question ? ' · 问：' + String(h.question).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') : '') + '</div>' +
      '<div class="div-h-sub">' + fmtDT(h.ts) + ' · ' + (Array.isArray(h.cards) ? h.cards.map(c => ((c && c.name) || '') + (c && c.rev ? '(逆)' : '')).join('、') : '') + '</div></div>' +
      '<button class="div-h-view" data-hi="' + i + '">查看</button>' +
      '<button class="div-h-del" data-hi="' + i + '">✕</button>' +
      '</div>';
  }
  function histMoreRest(list) { return list.length - histShown; }
  function renderHistory() {
    const el = document.getElementById('div-history');
    if (!el) return;
    const list = histLoad();
    // v3.27.x：无记录时连同外层白卡一起隐藏——原来 innerHTML 清空后外层 .div-card.glass
    // 仍在（padding 撑出一块空白白框，用户反馈「抽牌按钮下面一个莫名其妙的白色框」）
    const hcard = el.closest ? el.closest('.div-card') : null;
    if (hcard) hcard.hidden = !histOpen;
    histShown = Math.min(histShown, HIST_PAGE);   // 重渲（开页/新抽牌/删除）回到第一页，新记录在最上
    if (!list.length) {
      el.innerHTML = histOpen ? '<div class="div-label">占卜记录</div><div class="div-result-empty">还没有占卜记录</div>' : '';
      return;
    }
    // FIX 2026-09-27 #1342l：分页上界必须认列表实长。#1049 把历史改成「每页 30 条」时，histShown 的
    // 初值就是 30，而循环只信 histShown 不信 list.length —— 记录少于 30 条的每一台机器都在 i=list.length
    // 那一格取到 undefined，histRowHtml 当场抛 TypeError（iPhone／iOS 16.6 诊断单【最近错误】那条
    // "undefined is not an object (evaluating 'h.mode')" 就是这一发），异常把 renderHistory 打断在
    // innerHTML 赋值之前＝整块占卜记录一片空白，看着像「记录全没了」。
    if (histShown > list.length) histShown = list.length;
    let html = '<div class="div-label">占卜记录</div>';
    for (let i = 0; i < histShown; i++) html += histRowHtml(list[i], i);
    if (histMoreRest(list) > 0) html += '<button type="button" class="div-h-more" id="div-h-more">显示更早的记录（还有 ' + histMoreRest(list) + ' 条）</button>';
    el.innerHTML = html;
    if (!el.dataset.histBound) {
      el.dataset.histBound = '1';
      el.addEventListener('click', function (e) {
        const more = e.target.closest && e.target.closest('.div-h-more');
        if (more) { histLoadMore(); return; }
        const del = e.target.closest && e.target.closest('.div-h-del');
        if (del) {
          const list2 = histLoad();
          list2.splice(parseInt(del.dataset.hi, 10), 1);
          histSave(list2);
          renderHistory();
          return;
        }
        const view = e.target.closest && e.target.closest('.div-h-view');
        if (view) {
          const h = histLoad()[parseInt(view.dataset.hi, 10)];
          if (h && h.mode === 'meihua' && h.mh) renderMeihuaInto(document.getElementById('div-result'), h.mh, h.question || '', h.summary || '');
          else if (h && h.mode === 'tarot' && h.spread) renderSpreadBoard(h.cards, spreadById(h.spread.id) || TAROT_SPREADS[1], h.question, h.summary);
          else if (h && Array.isArray(h.cards)) renderDrawResult(h.cards, h.mode, h.question, h.summary);
        }
      });
    }
  }
  // 数据管理卡右上角「占卜记录」：展开/收起记录并在展开时滚到记录区
  window.divineToggleHistory = function (force) {
    histOpen = typeof force === 'boolean' ? force : !histOpen;
    renderHistory();
    if (histOpen) {
      const card = document.getElementById('div-history-card');
      if (card) setTimeout(function () { try { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {} }, 60);
    }
    return histOpen;
  };
  function histLoadMore() {
    const el = document.getElementById('div-history');
    if (!el) return;
    const list = histLoad();
    const start = histShown, end = Math.min(histShown + HIST_PAGE, list.length);
    if (end <= start) return;
    let frag = '';
    for (let i = start; i < end; i++) frag += histRowHtml(list[i], i);
    const moreBtn = document.getElementById('div-h-more');
    if (moreBtn) moreBtn.insertAdjacentHTML('beforebegin', frag);
    else el.insertAdjacentHTML('beforeend', frag);
    histShown = end;
    const btn2 = document.getElementById('div-h-more');
    if (btn2) {
      if (histMoreRest(list) > 0) btn2.textContent = '显示更早的记录（还有 ' + histMoreRest(list) + ' 条）';
      else btn2.remove();
    }
  }
  // 渲染抽牌结果（灰底正方形牌面 + 动画、综合解读、发送按钮）
  function renderDrawResult(cards, m, question, summary, mh) {
    const r = document.getElementById('div-result');
    if (!r) return;
    if (m === 'meihua' && mh) { renderMeihuaInto(r, mh, question, summary); return; }
    const labels = labelsIn || (MODE_LABELS[m] && MODE_LABELS[m][cards.length]) || [];
    let html = '<div class="div-spread">';
    cards.forEach((c, i) => {
      html += '<div class="div-mini' + (cards.length === 1 ? ' div-mini-single' : '') + '" style="animation-delay:' + (i * 120) + 'ms">' +
        (labels[i] ? '<div class="div-mini-tag">' + labels[i] + '</div>' : '') +
        '<div class="div-card-face' + faceClass(c, m) + '">' +
          faceTouch(c, m) +
          '<div class="div-card-name">' + (c.rev ? c.name + '（逆）' : c.name) + '</div>' +
        '</div>' +
        '<div class="div-card-meaning">' + (window.taFit ? window.taFit(c.meaning) : c.meaning) + '</div>' +
        '</div>';
    });
    html += '</div>';
    html += '<div class="div-summary">' + (window.taFit ? window.taFit(summary) : summary) + '</div>';
    if (question) html += '<div class="div-question-q">问：' + String(question).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '</div>';
    html += '<div class="div-result-actions">';
    html += '<button class="div-send-btn" id="div-send-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;vertical-align:-3px;margin-right:6px"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>发给 ' + (partnerName2() || (window.taWord ? window.taWord() : 'TA')) + '</button>';
    html += '<button class="div-copy-btn" id="div-copy-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;vertical-align:-3px;margin-right:6px"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>点击复制文字</button>';
    html += '</div>';
    r.innerHTML = html;
    const sendBtn = document.getElementById('div-send-btn');
    if (sendBtn) sendBtn.addEventListener('click', () => sendToChat(m, cards, summary, question));
    const copyBtn = document.getElementById('div-copy-btn');
    if (copyBtn) copyBtn.addEventListener('click', () => copyResultText(buildResultText(m, cards, summary, question)));
  }
  // ---- 塔罗牌阵桌布：按牌阵坐标摆牌，序号＝抽牌顺序，可拖动 ----
  function spreadPositions(spread, n) {
    if (spread.layout && spread.layout.length === n) return spread.layout;
    const cols = n <= 4 ? n : 4;
    const rows = Math.ceil(n / cols);
    const arr = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const inRow = Math.min(cols, n - r * cols);
      const cellW = 100 / cols, offset = (100 - inRow * cellW) / 2;
      arr.push([offset + (c + 0.5) * cellW, (r + 0.5) * (100 / rows)]);
    }
    return arr;
  }
  function bindBoardDrag(board, onMoved) {
    if (!board) return;
    board.querySelectorAll('.div-board-card').forEach(function (el, idx) {
      let dragging = false, moved = false, sx = 0, sy = 0;
      el.addEventListener('pointerdown', function (e) {
        if (e.button && e.button !== 0) return;
        dragging = true; moved = false; sx = e.clientX; sy = e.clientY;
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
        el.classList.add('dragging');
        el.style.zIndex = String(60 + idx);
        e.preventDefault();
      });
      el.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 4) moved = true;
        const r = board.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const x = Math.max(5, Math.min(95, ((e.clientX - r.left) / r.width) * 100));
        const y = Math.max(5, Math.min(95, ((e.clientY - r.top) / r.height) * 100));
        el.style.left = x.toFixed(2) + '%';
        el.style.top = y.toFixed(2) + '%';
      });
      function endDrag() {
        if (!dragging) return;
        dragging = false;
        el.classList.remove('dragging');
        el.style.zIndex = String(idx + 1);
        if (moved) {
          el.__dragged = true;
          setTimeout(function () { el.__dragged = false; }, 0);
          if (onMoved) { try { onMoved(idx, parseFloat(el.style.left) || 50, parseFloat(el.style.top) || 50); } catch (err) {} }
        }
      }
      el.addEventListener('pointerup', endDrag);
      el.addEventListener('pointercancel', endDrag);
      el.addEventListener('lostpointercapture', endDrag);
    });
  }
  // 2026-11-18：单击牌阵里的牌 → 放大看牌面；单击空白处收回。
  let cardZoomEl = null;
  function closeCardZoom() {
    if (cardZoomEl && cardZoomEl.parentNode) cardZoomEl.parentNode.removeChild(cardZoomEl);
    cardZoomEl = null;
  }
  function openCardZoom(c, idx, label) {
    if (!c) return;
    closeCardZoom();
    const ov = document.createElement('div');
    ov.id = 'div-zoom';
    ov.className = 'div-zoom';
    ov.innerHTML = '<div class="div-zoom-card">' +
      '<div class="div-card-face' + faceClass(c, 'tarot') + '">' + faceTouch(c, 'tarot') +
      '<div class="div-card-name">' + (c.rev ? c.name + '（逆）' : c.name) + '</div></div>' +
      '<div class="div-zoom-label"><b>' + (idx + 1) + ' · ' + escHtml(label) + '</b>' +
      '<span>' + escHtml(c.meaning || '') + '</span></div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', closeCardZoom);
    const box = ov.querySelector('.div-zoom-card');
    if (box) box.addEventListener('click', function (e) { e.stopPropagation(); });
    cardZoomEl = ov;
  }
  if (!window.__divCardZoomEsc) {
    window.__divCardZoomEsc = true;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && cardZoomEl) closeCardZoom();
    });
  }
  let lastSpreadState = null;
  function rerenderCustomBoard() {
    if (lastSpreadState && !lastSpreadState.intoEl) {
      renderSpreadBoard(lastSpreadState.cards, activeTarotSpread(), lastSpreadState.question, lastSpreadState.summary);
    } else {
      renderSpreadPreview();
    }
  }
  function renderSpreadTable(cards, spread, intoEl) {
    const table = intoEl || document.getElementById('div-spread-table');
    if (!table) return;
    table.hidden = false;
    const n = cards ? cards.length : spread.count;
    if (!n) { table.innerHTML = ''; table.hidden = true; return; }
    const pos = spreadPositions(spread, n);
    const cw = Math.max(10, Math.min(40, spread.cw || 22));
    const ratio = n <= 1 ? '1/1' : (n <= 4 ? '4/3' : '4/5');
    let html = '';
    if (spread.id === 'custom') {
      html += '<div class="div-board-tip">按住牌位可拖动 · <button type="button" class="div-board-edit' + (customEditMode ? ' on' : '') + '" id="div-custom-edit">' + (customEditMode ? '完成编辑' : '编辑牌位') + '</button></div>';
    }
    html += '<div class="div-board div-board-inline" id="div-board" style="aspect-ratio:' + ratio + '">';
    for (let i = 0; i < n; i++) {
      const p = pos[i] || [50, 50];
      const rot = p[2] ? Number(p[2]) : 0;
      const c = cards ? cards[i] : null;
      const label = (spread.labels && spread.labels[i]) || (c && c.pos) || ('位置 ' + (i + 1));
      const cpos = spread.id === 'celtic' ? (i === 0 ? ' data-cpos="lt"' : (i === 1 ? ' data-cpos="rb"' : '')) : '';
      html += '<div class="div-board-card' + (c ? '' : ' div-board-empty') + '" data-i="' + i + '" data-rot="' + rot + '"' + cpos + ' style="left:' + p[0] + '%;top:' + p[1] + '%;width:' + cw + '%;transform:translate(-50%,-50%) rotate(' + rot + 'deg);z-index:' + (i + 1) + '">' +
        (c
          ? '<div class="div-card-face' + faceClass(c, 'tarot') + '">' + faceTouch(c, 'tarot') +
            '<div class="div-card-name">' + (c.rev ? c.name + '（逆）' : c.name) + '</div></div>'
          : '<div class="div-slot-face"></div>') +
        '<span class="div-board-center"><b>' + (i + 1) + '</b><em>' + label + '</em></span>' +
        '</div>';
    }
    html += '</div>';
    table.innerHTML = html;
    const board = table.querySelector('#div-board');
    const isCustom = spread.id === 'custom';
    if (cards || isCustom) {
      bindBoardDrag(board, isCustom ? function (idx, x, y) {
        const d = ensureCustomDef(n);
        d.positions[idx] = [Number(x.toFixed(2)), Number(y.toFixed(2))];
        saveCustomDef();
      } : null);
    }
    if (isCustom) {
      const eb = table.querySelector('#div-custom-edit');
      if (eb) eb.addEventListener('click', function (e) {
        e.stopPropagation();
        customEditMode = !customEditMode;
        rerenderCustomBoard();
      });
      if (customEditMode) {
        table.querySelectorAll('.div-board-card').forEach(function (el) {
          el.addEventListener('click', function () {
            if (el.__dragged) return;
            const idx = parseInt(el.getAttribute('data-i'), 10) || 0;
            const d = ensureCustomDef(n);
            const cur = d.labels[idx] || ('位置 ' + (idx + 1));
            if (!window.openModal) return;
            window.openModal('第 ' + (idx + 1) + ' 个牌位的名称', cur, function (v) {
              const name = String(v || '').trim() || ('位置 ' + (idx + 1));
              d.labels[idx] = name;
              saveCustomDef();
              rerenderCustomBoard();
            });
          });
        });
      }
    }
    // 已抽到牌 → 单击放大；编辑自定义牌位时让位给改名
    if (cards) {
      table.querySelectorAll('.div-board-card').forEach(function (el) {
        if (el.classList.contains('div-board-empty')) return;
        el.addEventListener('click', function () {
          if (el.__dragged) return;
          if (isCustom && customEditMode) return;
          const idx = parseInt(el.getAttribute('data-i'), 10) || 0;
          const c = cards[idx];
          if (!c) return;
          const lb = (spread.labels && spread.labels[idx]) || c.pos || ('位置 ' + (idx + 1));
          openCardZoom(c, idx, lb);
        });
      });
    }
  }
  function renderSpreadPreview() {
    const table = document.getElementById('div-spread-table');
    if (!table) return;
    if (mode !== 'tarot') { table.hidden = true; table.innerHTML = ''; return; }
    renderSpreadTable(null, activeTarotSpread());
  }
  function renderSpreadBoard(cards, spread, question, summary, intoEl) {
    const n = cards.length;
    const labelOf = function (c, i) { return (spread.labels && spread.labels[i]) || c.pos || ('位置 ' + (i + 1)); };
    let readHtml = '<div class="div-spread-read">';
    cards.forEach(function (c, i) {
      readHtml += '<div class="div-read-row"><b>' + (i + 1) + ' · ' + labelOf(c, i) + '</b>' +
        '<span>' + (c.rev ? c.name + '（逆）' : c.name) + '</span>' +
        '<em>' + (window.taFit ? window.taFit(c.meaning) : c.meaning) + '</em></div>';
    });
    readHtml += '</div>';
    readHtml += '<div class="div-summary">' + (window.taFit ? window.taFit(summary) : summary) + '</div>';
    if (question) readHtml += '<div class="div-question-q">问：' + String(question).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '</div>';
    readHtml += '<div class="div-result-actions">' +
      '<button class="div-send-btn" id="div-send-btn">发给 ' + (partnerName2() || (window.taWord ? window.taWord() : 'TA')) + '</button>' +
      '<button class="div-copy-btn" id="div-copy-btn">点击复制文字</button></div>';
    if (!intoEl) {
      // 桌面占卜页：牌阵桌布固定在上方（选牌行下方、抽牌键上方），结果区只放逐条解读
      lastSpreadState = { cards: cards, spread: spread, question: question, summary: summary, intoEl: null };
      renderSpreadTable(cards, spread);
      const r = document.getElementById('div-result');
      if (!r) return;
      r.innerHTML = readHtml;
      const sb = r.querySelector('#div-send-btn');
      if (sb) sb.addEventListener('click', function () { sendToChat('tarot', cards, summary, question, spread.name, spread.labels); });
      const cb = r.querySelector('#div-copy-btn');
      if (cb) cb.addEventListener('click', function () { copyResultText(buildResultText('tarot', cards, summary, question, spread.name, spread.labels)); });
      return;
    }
    // 聊天半框等嵌在结果区里的场景：桌布 + 解读一起放进目标容器
    const pos = spreadPositions(spread, n);
    const cw = Math.max(10, Math.min(40, spread.cw || 22));
    let board = '<div class="div-board-tip">' + (spread.id === 'custom' ? '按住牌面可拖动 · 序号是抽牌顺序' : spread.name + ' · 按住牌面可微调位置') + '</div><div class="div-board" id="div-board">';
    cards.forEach(function (c, i) {
      const p = pos[i] || [50, 50];
      const rot = p[2] ? Number(p[2]) : 0;
      const cpos2 = spread.id === 'celtic' ? (i === 0 ? ' data-cpos="lt"' : (i === 1 ? ' data-cpos="rb"' : '')) : '';
      board += '<div class="div-board-card" data-i="' + i + '" data-rot="' + rot + '"' + cpos2 + ' style="left:' + p[0] + '%;top:' + p[1] + '%;width:' + cw + '%;transform:translate(-50%,-50%) rotate(' + rot + 'deg);z-index:' + (i + 1) + '">' +
        '<div class="div-card-face' + faceClass(c, 'tarot') + '">' + faceTouch(c, 'tarot') +
        '<div class="div-card-name">' + (c.rev ? c.name + '（逆）' : c.name) + '</div></div>' +
        '<span class="div-board-center"><b>' + (i + 1) + '</b><em>' + labelOf(c, i) + '</em></span></div>';
    });
    board += '</div>';
    intoEl.innerHTML = board + readHtml;
    bindBoardDrag(intoEl.querySelector('#div-board'));
    const boardEl = intoEl.querySelector('#div-board');
    if (boardEl) boardEl.querySelectorAll('.div-board-card').forEach(function (el) {
      el.addEventListener('click', function () {
        if (el.__dragged) return;
        const idx = parseInt(el.getAttribute('data-i'), 10) || 0;
        const c = cards[idx];
        if (!c) return;
        openCardZoom(c, idx, labelOf(c, idx));
      });
    });
    const sb2 = intoEl.querySelector('#div-send-btn');
    if (sb2) sb2.addEventListener('click', function () { sendToChat('tarot', cards, summary, question, spread.name, spread.labels); });
    const cb2 = intoEl.querySelector('#div-copy-btn');
    if (cb2) cb2.addEventListener('click', function () { copyResultText(buildResultText('tarot', cards, summary, question, spread.name, spread.labels)); });
  }

  function buildResultText(m, cards, summary, question, spreadName, labelsIn) {
    const modeTxt = divineModeLabel(m);
    if (m === 'meihua') {
      let t = '占卜 · 梅花易数';
      if (question) t += '（问：' + question + '）';
      t += '\n' + (summary || (cards[0] && cards[0].meaning) || '');
      return t;
    }
    let text = '占卜 · ' + modeTxt + (spreadName ? ' · ' + spreadName : '') + ' ' + cards.length + ' 张';
    if (question) text += '（问：' + question + '）';
    text += '\n';
    const labels = (MODE_LABELS[m] && MODE_LABELS[m][cards.length]) || [];
    cards.forEach((c, i) => {
      text += (i + 1) + '. ' + (labels[i] || c.pos || ('位置' + (i + 1))) + ' · ' + c.name + (c.rev ? '（逆）' : '') + '：' + c.meaning + '\n';
    });
    text += '综合：' + String(summary || '').replace(/^综合[:：]/, '');
    return text;
  }
  function copyResultText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('已复制到剪贴板')).catch(() => copyFallback(text));
    } else {
      copyFallback(text);
    }
  }
  function copyFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已复制到剪贴板'); } catch (e) { toast('复制失败，请长按手动复制'); }
    document.body.removeChild(ta);
  }
  function confirmSendToCurrent(cb) {
    const name = partnerName2() || (window.taWord ? window.taWord() : 'TA');
    if (window.openModal) {
      window.openModal('发送给「' + name + '」？', '确认后会直接出现在当前聊天里。', function () { if (cb) cb(); });
    } else if (cb) cb();
  }
  function sendToChat(m, cards, summary, question, spreadName, labelsIn) {
    const text = buildResultText(m, cards, summary, question, spreadName, labelsIn);
    if (!window.chatSendMsg) { toast('请先进入聊天页'); return; }
    confirmSendToCurrent(function () {
      window.chatSendMsg(text);
      toast('已发送给 ' + (partnerName2() || 'TA'));
    });
  }
  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
  }

  function runMeihuaDraw() {
    const r = document.getElementById('div-result');
    const btn = document.getElementById('div-draw');
    if (!r) return;
    const question = ((document.getElementById('div-question') || {}).value || '').trim();
    const v1 = parseFloat((document.getElementById('div-mh-num1') || {}).value);
    const v2 = parseFloat((document.getElementById('div-mh-num2') || {}).value);
    const mh = buildMeihua(isFinite(v1) ? v1 : NaN, isFinite(v2) ? v2 : NaN);
    if (btn) btn.textContent = '起卦中…';
    r.innerHTML = '<div class=div-result-empty>正在起卦…</div>';
    setTimeout(function () {
      renderMeihuaInto(r, mh, question, mh.summary);
      if (btn) btn.textContent = '重新抽牌';
      const snapTarget = divineTarget;
      const record = {
        ts: Date.now(), mode: 'meihua', count: 1, question: question,
        cards: [{ name: mh.name, icon: 'meihua', meaning: mh.summary, detail: mh.summary }],
        summary: mh.summary, mh: mh
      };
      if (snapTarget) record.target = targetName(snapTarget);
      const list = histLoad();
      list.unshift(record);
      histSave(list);
      renderHistory();
      try { saveToHome(record, snapTarget); } catch (e) {}
      if (autoSendGet()) {
        const myCid = window.__activeCid || 'default';
        setTimeout(function () {
          if ((window.__activeCid || 'default') !== myCid) return;
          sendToChat('meihua', record.cards, mh.summary, question);
        }, 500);
      }
    }, 420);
  }

  // 抽牌（v3.7.x：洗牌动画 → 两行牌面滑动抽取 → 结果）
  const drawBtn = document.getElementById('div-draw');
  const drawBtnIdleHTML = drawBtn ? drawBtn.innerHTML : '';
  if (drawBtn) drawBtn.dataset.idleHtml = drawBtnIdleHTML;
  if (drawBtn) {
    drawBtn.addEventListener('click', () => {
      const r = document.getElementById('div-result');
      if (!r) return;
      // v3.8.x：重新抽牌状态（上轮结果已展示）→ 只清空结果区、恢复「抽牌」按钮，
      // 回到待抽牌状态；保留用户已输入的问题（不擅自清空输入框），用户可自行修改
      // 后再点一次开始抽牌；不再直接带旧问题开抽
      if (drawBtn.textContent.indexOf('重新抽牌') !== -1) {
        if (window.__divActiveDraw) { try { window.__divActiveDraw(); } catch (e) {} window.__divActiveDraw = null; }
        clearResult();
        drawBtn.innerHTML = drawBtnIdleHTML;
        return;
      }
      // 连点/进行中：取消进行中的流程再重开
      if (window.__divActiveDraw) { try { window.__divActiveDraw(); } catch (e) {} window.__divActiveDraw = null; }
      const question = ((document.getElementById('div-question') || {}).value || '').trim();
      // v3.5.130：快照点击时的模式/张数——流程期间切换设置不再影响本次结果
      const snapMode = mode;
      if (snapMode === 'meihua') { runMeihuaDraw(); return; }
      const spread = snapMode === 'tarot' ? activeTarotSpread() : null;
      const snapCount = spread ? spread.count : count;
      const deck = snapMode === 'tarot' ? tarotDeckFor(tarotScope) : lenoDeck();
      if (!deck.length) { r.innerHTML = '<div class="div-result-empty">占卜牌库加载中…</div>'; return; }
      const labels = spread ? spread.labels : ((MODE_LABELS[snapMode] && MODE_LABELS[snapMode][snapCount]) || []);
      drawBtn.textContent = '抽牌中…';
      // #1044 取证：「抽一张牌就退出页面」类报障在真机上抓不到 JS 错误（诊断错误环全是
      // 资源噪声）。这里给 page-divine 挂一次性观察：抽牌流程进行中（__divActiveDraw 非空）
      // 页面被隐藏就把「当时可见的是哪一页」写进 console.error——随 device.js 错误环进诊断
      // docx（LS 写满设备也有 IDB 双写兜底）。只记不拦，不改变任何切页行为。
      try {
        const pdp = document.getElementById('page-divine');
        if (pdp && !pdp.__divDrawWatch) {
          pdp.__divDrawWatch = true;
          new MutationObserver(function () {
            if (pdp.hidden && window.__divActiveDraw) {
              let vis = '';
              document.querySelectorAll('.page').forEach(function (p) { if (!p.hidden) vis = p.id || ''; });
              console.error('[div-draw] 抽牌进行中页面被切走：当前可见页=' + (vis || '无') + '（若非你主动按返回，此行即「抽牌退出页面」现场）');
            }
          }).observe(pdp, { attributes: true, attributeFilter: ['hidden'] });
        }
      } catch (e) {}
      window.__divActiveDraw = startDivineDraw(r, {
        deck: deck,
        count: snapCount,
        labels: labels,
        tarot: snapMode === 'tarot',
        onDone: (cards) => {
          window.__divActiveDraw = null;
          drawBtn.textContent = '重新抽牌';
          const summary = buildSummary(cards, snapMode, question);
          if (spread) renderSpreadBoard(cards, spread, question, summary);
          else renderDrawResult(cards, snapMode, question, summary);
          // 保存记录（v3.7.x：每个联系人桌面独立，store 动态绑定当前桌面）
          const snapTarget = divineTarget; // v3.27.x：快照点击时的占卜对象
          const record = { ts: Date.now(), mode: snapMode, count: snapCount, question: question, cards: cards, summary: summary };
          if (spread) record.spread = { id: spread.id, name: spread.name };
          if (snapMode === 'tarot') record.deckScope = tarotScope;
          if (snapTarget) record.target = targetName(snapTarget);
          const list = histLoad();
          list.unshift(record);
          // #1049 用户拍板：历史全量保留，不做条数上限（性能问题已由分页渲染解决——
          // 不打开历史区就不渲染，打开也只画第一页；抽完牌 renderHistory 只画 30 行）。
          histSave(list);
          renderHistory();
          // v3.27.x：写入占卜对象的主页「占卜记录」（不选＝当前桌面）
          try { saveToHome(record, snapTarget); } catch (e) {}
          // v3.7.x：自动发送开关——开启后抽牌完成自动把结果发到聊天
          if (autoSendGet()) {
            const myCid = window.__activeCid || 'default';
            setTimeout(() => { if ((window.__activeCid || 'default') !== myCid) return; sendToChat(snapMode, cards, summary, question, spread ? spread.name : '', spread ? spread.labels : null); }, 500);
          }
        }
      });
    });
  }

  // 桌面【占卜】图标进入
  const divApp = document.querySelector('.app[data-app="divination"]');
  if (divApp && page) {
    divApp.addEventListener('click', (e) => {
      const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
      if (editing) {
        const grid = divApp.closest('.app-grid');
        if (grid && grid.classList.contains('editing')) return;
        if (window.openIconMenu) { e.stopPropagation(); window.openIconMenu(divApp); }
        return;
      }
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      page.hidden = false;
      page.classList.remove('div-fs');
      const fsb0 = document.getElementById('div-fs'); if (fsb0) fsb0.textContent = '⛶';
      histOpen = false;
      renderHistOnOpen();
    });
  }
  const divBack = document.getElementById('div-back');
  if (divBack) {
    divBack.addEventListener('click', () => {
      if (page) page.classList.remove('div-fs');
      const fsb = document.getElementById('div-fs'); if (fsb) fsb.textContent = '⛶';
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const phonePage = document.getElementById('page-phone');
      if (phonePage) phonePage.hidden = false;
    });
  }
  const divFsBtn = document.getElementById('div-fs');
  if (divFsBtn && page) {
    divFsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const on = !page.classList.contains('div-fs');
      page.classList.toggle('div-fs', on);
      divFsBtn.textContent = on ? '⤢' : '⛶';
    });
  }

  // ---- v3.7.x：打开占卜页即渲染历史（原实现只在抽牌后渲染，历史区空白看不到记录）；
  // 多桌面：切换联系人后重新渲染，记录随当前桌面独立展示 ----
  function renderHistOnOpen() {
    try { renderHistory(); } catch (e) {}
    try { syncAutoToggle(); } catch (e) {}
    // 占卜对象 chips（首次 + 切联系人后重渲染；当前桌面选择记忆在 per-cid 的 divine-target）
    try { renderTargetsInto('div-targets'); } catch (e) {}
  }
  renderHistOnOpen();
  document.addEventListener('contact-switched', renderHistOnOpen);
  // 自动发送开关（桌面占卜页）
  const autoEl = document.getElementById('div-auto-send');
  if (autoEl) autoEl.addEventListener('change', () => { autoSendSet(autoEl.checked); });

  // ---- v3.9.x：问题输入框右侧「✕ 一键清空」按钮 ------
  // contenteditable 转换器（mobile-adapt）下原 input 退场为 ghost，value 代理到 box，
  // 读 value 再置空即可；box 用 textContent 清空（与「帮我决定」清空逻辑一致）
  document.querySelectorAll('#page-divine .dec-inp-clear').forEach(btn => {
    btn.addEventListener('click', () => {
      const ta = document.getElementById(btn.dataset.clear);
      if (!ta) return;
      const box = ta.__ceBox;
      if (box) box.textContent = '';
      else ta.value = '';
      ta.focus();
      toast('已清空');
    });
  });

  // ===== 牌面图鉴 UI（全部由 JS 构建：不改 template.html，避免与并行会话撞车）=====
  function facePanelHTML() {
    return '' +
      '<div class="chat-head">' +
        '<span class="ch-back" id="divf-back"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></span>' +
        '<span class="ch-name">牌面图鉴</span>' +
      '</div>' +
      '<div class="divf-tabs">' +
        '<button class="divf-tab sel" data-fpanel="manage">牌面管理</button>' +
        '<button class="divf-tab" data-fpanel="gallery">我的图鉴</button>' +
      '</div>' +
      '<div class="divf-tools">' +
        '<button class="divf-batch-btn" id="divf-batch">📂 批量上传（按文件名自动对应牌）</button>' +
        '<button class="divf-batch-btn" id="divf-onebased" style="margin-top:6px">编号从 1 起（塔罗 1–78）：关</button>' +
      '</div>' +
      '<div class="divf-scroll">' +
        '<div data-fpanel-body="manage">' +
          '<div class="divf-modes" id="divf-modes">' +
            '<button class="divf-mode sel" data-fmode="tarot">塔罗 78</button>' +
            '<button class="divf-mode" data-fmode="lenormand">雷诺曼</button>' +
          '</div>' +
          '<div class="divf-scope" id="divf-scope">' +
            '<div class="divf-modes" id="divf-systems">' +
              '<button class="divf-mode sel" data-fsys="wait">韦特系</button>' +
              '<button class="divf-mode" data-fsys="marseille">马赛系</button>' +
              '<button class="divf-mode" data-fsys="thoth">托特系</button>' +
            '</div>' +
            '<div class="divf-sets">' +
              '<select class="divf-set-select" id="divf-set-select"></select>' +
              '<button class="divf-mini" id="divf-set-new">新建套卡</button>' +
              '<button class="divf-mini" id="divf-set-del">删除</button>' +
            '</div>' +
            '<div class="divf-hint">每个体系一次只应用一套卡面。「内置牌面」使用自带的图；新建套卡后可上传自己的牌面。</div>' +
          '</div>' +
          '<div id="divf-list"></div>' +
        '</div>' +
        '<div data-fpanel-body="gallery" hidden>' +
          '<div class="divf-gal-bar"><span id="divf-gal-count"></span><button class="divf-mini" id="divf-clear">清空全部</button></div>' +
          '<div class="divf-grid" id="divf-grid"></div>' +
        '</div>' +
        '<div class="divf-io">' +
          '<button class="divf-io-btn" id="divf-export">导出数据</button>' +
          '<button class="divf-io-btn" id="divf-import">导入数据</button>' +
        '</div>' +
      '</div>';
    // mochi-755-all：占卜三处 file input 原先写在 HTML 模板串里（hidden 属性＝display:none，
    // 部分国产内核拒绝激活不可见 input，点「换牌面/批量上传/导入」无任何反应）→ 改走统一入口
    // window.mochiFilePick（device.js），常驻 sr-only clip 挂 body，本文件不再创建 input 节点。
  }

  function initFaceUI() {
    const head = document.querySelector('#page-divine .chat-head');
    if (head && !document.getElementById('div-faces-btn')) {
      const btn = document.createElement('button');
      btn.className = 'ch-more';
      btn.id = 'div-faces-btn';
      btn.title = '牌面图鉴';
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
      head.appendChild(btn);
      btn.addEventListener('click', openFacePanel);
    }
    const setup = document.querySelector('#page-divine .div-setup');
    if (setup && !document.getElementById('div-leno-sys')) {
      const wrap = document.createElement('div');
      wrap.className = 'div-modes div-leno-sys';
      wrap.id = 'div-leno-sys';
      wrap.hidden = true;
      wrap.innerHTML = '<button class="div-mode" data-lenosys="36">36 张 · 经典</button><button class="div-mode" data-lenosys="40">40 张 · 含扩展</button>';
      setup.appendChild(wrap);
      wrap.addEventListener('click', (e) => {
        const b = e.target.closest('.div-mode');
        if (!b) return;
        leno36 = b.dataset.lenosys === '36';
        try { gStore.set(LENO36_KEY, leno36 ? '1' : '0'); } catch (e2) {}
        syncLenoSys();
        clearResult();
      });
    }
    if (!document.getElementById('divf-page')) {
      const pg = document.createElement('div');
      pg.className = 'divf-page';
      pg.id = 'divf-page';
      pg.hidden = true;
      pg.innerHTML = facePanelHTML();
      // 作为「占卜页内的浮层」而非独立 .page——tabs.js 的 pages/FULL_PAGES 是静态快照，
      // 运行期新建的 .page 不在其中：隐藏占卜页会让 syncChrome 找不到可见页而把桌面
      // 导航栏重新显示出来（用户反馈「牌面图鉴页顶部有桌面导航栏」）。浮层不动页面，
      // 占卜页始终是可见的全屏页，chrome 状态天然正确。
      const host = document.getElementById('page-divine') || document.body;
      host.appendChild(pg);
      wireFacePanel(pg);
    }
    injectChatFacesUI();
    syncLenoSys();
  }

  // 把「牌面图鉴」入口 + 雷诺曼 36/40 切换注入聊天页占卜半框（不改 chat.js）
  function injectChatFacesUI() {
    const body = document.getElementById('chat-divine-body');
    if (!body || document.getElementById('div-chat-faces-btn')) return;
    const lenoWrap = document.createElement('div');
    lenoWrap.className = 'div-modes-wrap div-leno-sys';
    lenoWrap.id = 'div-chat-leno-sys';
    lenoWrap.hidden = true;
    lenoWrap.innerHTML = '<span class="div-mode" data-lenosys="36">36 张 · 经典</span><span class="div-mode" data-lenosys="40">40 张 · 含扩展</span>';
    const modeWrap = body.querySelector('.div-modes-wrap');
    if (modeWrap && modeWrap.parentNode === body) modeWrap.insertAdjacentElement('afterend', lenoWrap);
    else body.insertBefore(lenoWrap, body.firstChild);
    lenoWrap.addEventListener('click', (e) => {
      const b = e.target.closest('.div-mode');
      if (!b || !b.dataset.lenosys) return;
      leno36 = b.dataset.lenosys === '36';
      try { gStore.set(LENO36_KEY, leno36 ? '1' : '0'); } catch (e2) {}
      syncLenoSys();
    });
    const bar = document.createElement('div');
    bar.className = 'div-chat-facesbar';
    bar.innerHTML = '<button type="button" class="div-chat-faces-btn" id="div-chat-faces-btn">🖼 牌面图鉴</button>';
    const targets = body.querySelector('#div-chat-targets');
    if (targets && targets.parentNode === body) targets.insertAdjacentElement('afterend', bar);
    else body.insertBefore(bar, body.firstChild);
    const fb = bar.querySelector('#div-chat-faces-btn');
    if (fb) fb.addEventListener('click', (e) => { e.stopPropagation(); openFacePanelFromAnywhere(); });
    // chat.js 自己的模式切换处理器会改 sel，这里追加监听以便同步 36/40 行显隐
    body.querySelectorAll('[data-chatmode]').forEach(b => b.addEventListener('click', () => setTimeout(syncLenoSys, 0)));
  }
  // 从聊天半框进入：先切到占卜页再打开图鉴浮层
  function openFacePanelFromAnywhere() {
    const d = document.getElementById('page-divine');
    if (d) {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      d.hidden = false;
    }
    openFacePanel();
  }

  function openFacePanel() {
    const pg = document.getElementById('divf-page');
    if (!pg) return;
    const d = document.getElementById('page-divine');
    if (d) { facePanelScroll = d.scrollTop || 0; d.classList.add('divf-lock'); try { d.scrollTop = 0; } catch (e) {} }
    pg.hidden = false;
    syncFaceTabs();
    renderFaceList();
    renderFaceGallery();
  }
  function closeFacePanel() {
    const pg = document.getElementById('divf-page');
    if (pg) pg.hidden = true;
    const d = document.getElementById('page-divine');
    if (d) { d.classList.remove('divf-lock'); try { d.scrollTop = facePanelScroll; } catch (e) {} }
    try { renderHistOnOpen(); } catch (e) {}
  }
  function syncFaceTabs() {
    const pg = document.getElementById('divf-page');
    if (!pg) return;
    pg.querySelectorAll('.divf-tab').forEach(b => b.classList.toggle('sel', b.dataset.fpanel === faceTab));
    pg.querySelectorAll('[data-fpanel-body]').forEach(b => { b.hidden = b.getAttribute('data-fpanel-body') !== faceTab; });
    pg.querySelectorAll('.divf-mode[data-fmode]').forEach(b => b.classList.toggle('sel', b.dataset.fmode === facePanelCid));
    pg.querySelectorAll('.divf-mode[data-fsys]').forEach(b => b.classList.toggle('sel', b.dataset.fsys === facePanelSystem));
    const scopeBox = pg.querySelector('#divf-scope');
    if (scopeBox) scopeBox.hidden = facePanelCid === 'lenormand';
    renderSetUI();
  }
  function renderSetUI() {
    const sel = document.getElementById('divf-set-select');
    if (!sel) return;
    const sys = facePanelSystem;
    const active = activeSetOf(sys);
    let html = '<option value="builtin">内置牌面</option>';
    deckSetsOf(sys).forEach(function (s) {
      html += '<option value="' + escHtml(s.id) + '">' + escHtml(s.name) + '</option>';
    });
    sel.innerHTML = html;
    sel.value = active;
    const del = document.getElementById('divf-set-del');
    if (del) del.disabled = active === 'builtin';
  }
  function renderFaceList() {
    const el = document.getElementById('divf-list');
    if (!el) return;
    const scope = panelScope();
    const sys = scopeSystem(scope);
    const arr = sys === 'lenormand' ? LENO : (TAROT_SYSTEMS[sys] || TAROT_SYSTEMS.wait).deck;
    const imap = iconMapOf(scope);
    el.innerHTML = arr.map(c => {
      const thb = faceThb.get(scope + '|' + c.name) || '';
      const prev = thb
        ? '<div class="divf-thb"><img src="' + thb + '" alt=""></div>'
        : '<div class="divf-thb divf-thb-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (imap[ORIG_ICON[sys][c.name]] || '') + '</svg></div>';
      return '<div class="divf-row" data-name="' + escHtml(c.name) + '">' + prev +
        '<div class="divf-name">' + escHtml(c.name) + '</div>' +
        '<button class="divf-act divf-up">' + (thb ? '更换' : '上传') + '</button>' +
        (thb ? '<button class="divf-act divf-del">清除</button>' : '') +
        '</div>';
    }).join('');
  }
  function renderFaceGallery() {
    const grid = document.getElementById('divf-grid');
    if (!grid) return;
    const scope = panelScope();
    const sys = scopeSystem(scope);
    const idx = loadFaceIdx(scope);
    const cnt = document.getElementById('divf-gal-count');
    if (cnt) cnt.textContent = idx.length ? ('本套卡已上传 ' + idx.length + ' 张牌面') : '';
    grid.innerHTML = idx.length ? idx.map(x => {
      const thb = faceThb.get(scope + '|' + x.n) || '';
      return '<div class="divf-cell" data-scope="' + escHtml(scope) + '" data-name="' + escHtml(x.n) + '">' +
        '<div class="divf-cell-img">' + (thb ? '<img src="' + thb + '" alt="">' : '<span class="divf-missing">图缺失</span>') + '</div>' +
        '<div class="divf-cell-name">' + escHtml(x.n) + '<span class="divf-cell-mode">' + (sys === 'lenormand' ? '雷诺曼' : (TAROT_SYSTEMS[sys] ? TAROT_SYSTEMS[sys].name : '塔罗')) + '</span></div>' +
        '<div class="divf-cell-acts"><button class="divf-mini divf-cell-up">更换</button><button class="divf-mini divf-cell-del">删除</button></div>' +
        '</div>';
    }).join('') : ((window.mochiDataPending && window.mochiDataPending()) ? window.mochiLoadingHtml('牌面图') : '<div class="divf-empty">这套卡还没有上传牌面。到「牌面管理」给喜欢的牌换张图吧。</div>');
  }
  // #797：回填完成补渲一次（牌面索引/缩略图在大键里，renderFaceGallery 现读现画幂等）
  if (window.mochiOnDataReady) window.mochiOnDataReady(function () { try { renderFaceGallery(); } catch (e) {} });

  function pickFaceFile(m, n) {
    pendingUpload = { m: m, n: n };
    // mochi-755-all：统一入口（accept 必须在 click 之前落定，否则首次激活带空 accept＝弹通用文件管理器）
    window.mochiFilePick({
      id: 'dev-divf-img-pick',
      accept: 'image/*',
      onFiles: (files) => {
        const f = files && files[0];
        if (!f || !pendingUpload) { pendingUpload = null; return; }
        const target = pendingUpload;
        pendingUpload = null;
        if (!window.mochiImgCompressTo) { toast('图片处理组件没加载上（缓存过旧或离线），请重新打开页面再试'); return; }
        // FIX 2026-09-25 #1270：File 直接进闸（不再 readAsDataURL 造多 MB base64）；缩略图从已压好
        // 的整图再缩一遍——旧写法把同一张原图整幅解码两遍。
        compressImg(f, 720, 0.85).then((full) => {
          if (!full) { toast('这张图本机浏览器处理不了，请换一张小图或用系统相机重拍'); return; }
          compressImg(full, 200, 0.82).then((thb) => {
            if (!thb) { toast('图片处理失败，请换一张'); return; }
            storeFaceFromDataUrls(target.m, target.n, full, thb);
            renderFaceList(); renderFaceGallery();
            toast('已设为「' + target.n + '」的牌面');
          });
        });
      }
    });
  }
  function deleteFace(scope, n) {
    scope = normScope(scope);
    window.openModal('删除「' + n + '」的自定义牌面？', '', (v) => {
      if (v !== 'ok') return;
      rmFaceData(scope, n);
      saveFaceIdx(loadFaceIdx(scope).filter(x => x.n !== n), scope);
      rebuildFaces();
      renderFaceList(); renderFaceGallery();
      toast('已删除「' + n + '」的牌面');
    }, { noInput: true, pillSubmit: true, staticText: '删除后恢复为默认牌面。', pills: [{ label: '删除', value: 'ok' }] });
  }
  function clearAllFaces() {
    const scope = panelScope();
    const idx = loadFaceIdx(scope);
    if (!idx.length) { toast('这套卡还没有上传牌面'); return; }
    window.openModal('清空本套卡的 ' + idx.length + ' 张自定义牌面？（不可恢复）', '', (v) => {
      if (v !== 'ok') return;
      idx.forEach(x => rmFaceData(scope, x.n));
      saveFaceIdx([], scope);
      rebuildFaces();
      renderFaceList(); renderFaceGallery();
      toast('已清空本套卡的牌面');
    }, { noInput: true, pillSubmit: true, staticText: '只清空当前正在使用的这套卡面，其他套卡不受影响。', pills: [{ label: '清空', value: 'ok' }] });
  }

  function buildFaceExport() {
    const scope = panelScope();
    const idx = loadFaceIdx(scope);
    if (!idx.length) return Promise.resolve('');
    const readFull = (k) => {
      const fallback = () => { try { return gStore.get(k) || ''; } catch (e) { return ''; } };
      if (!window.idbGet) return Promise.resolve(fallback());
      return Promise.resolve(window.idbGet(GNS + ':' + k)).then(v => (typeof v === 'string' && v) ? v : fallback()).catch(fallback);
    };
    // 顺序读取（不用 Promise.all）——几十张原图并发 idbGet 会挤在一条连接上，
    // 慢设备上容易触发忙等；导出本就是一次性操作，顺序读更稳。
    return idx.reduce((p, x) => p.then(faces => readFull(fullKey(scope, x.n)).then(img => {
      faces.push({
        m: scopeSystem(scope), scope: scope, n: x.n,
        img: img || faceThb.get(scope + '|' + x.n) || '',
        thb: faceThb.get(scope + '|' + x.n) || ''
      });
      return faces;
    })), Promise.resolve([])).then(faces => JSON.stringify({
      v: 1, type: 'mochi-divine-faces', ts: Date.now(),
      scope: scope,
      leno36: leno36 ? 1 : 0,
      oneBased: faceOneBased ? 1 : 0,
      faces: faces.filter(f => f.img || f.thb)
    }));
  }
  function exportFacesData() {
    if (!loadFaceIdx(panelScope()).length) { toast('这套卡还没有上传牌面'); return; }
    toast('正在打包牌面数据…');
    buildFaceExport().then(json => {
      if (!json) { toast('还没有上传牌面'); return; }
      const fname = 'mochi-divine-faces-' + dtStamp() + '.json';
      if (window.mochiExportFile) { window.mochiExportFile(json, fname, '导出占卜牌面数据'); return; }
      try {
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fname;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 4000);
      } catch (e) { toast('导出失败，请换系统浏览器重试'); }
    }).catch(() => toast('导出失败，请重试'));
  }

  function importFacesData(data) {
    if (!data || data.type !== 'mochi-divine-faces' || !Array.isArray(data.faces)) { toast('文件格式不正确，请选择导出的牌面 JSON'); return; }
    const scope = panelScope();
    const sys = scopeSystem(scope);
    const valid = data.faces.filter(x => x && x.n && cardOf(sys, x.n) &&
      typeof (x.img || x.thb) === 'string' && (x.img || x.thb));
    if (!valid.length) { toast('文件里没有这套体系认得的牌面'); return; }
    window.openModal('导入 ' + valid.length + ' 张牌面', '', (v) => {
      if (!v) return;
      toast('正在导入 ' + valid.length + ' 张牌面…');
      requestAnimationFrame(() => setTimeout(() => {
        applyImport(valid, v === 'replace', data.leno36, data.oneBased, scope);
      }, 0));
    }, { noInput: true, pillSubmit: true, pill: 'merge', staticText: '导入到当前正在使用的这套卡。\n「合并」保留现有牌面并覆盖同名；「覆盖」先清空本套卡再导入。', pills: [{ label: '合并导入', value: 'merge' }, { label: '覆盖导入', value: 'replace' }] });
  }
  function applyImport(list, replace, l36, oneB, scope) {
    scope = normScope(scope || panelScope());
    if (replace) { loadFaceIdx(scope).forEach(x => rmFaceData(scope, x.n)); }
    const idx = replace ? [] : loadFaceIdx(scope);
    const byKey = {};
    idx.forEach(x => { byKey[scope + '|' + x.n] = true; });
    let ok = 0;
    list.forEach(x => {
      const full = String(x.img || x.thb || '');
      const thb = String(x.thb || x.img || '');
      if (!full || full.length > 8 * 1024 * 1024) return;
      try { gStore.set(fullKey(scope, x.n), full); } catch (e) {}
      try { gStore.set(thbKey(scope, x.n), thb); } catch (e) {}
      faceThb.set(scope + '|' + x.n, thb);
      if (!byKey[scope + '|' + x.n]) { idx.push({ m: scopeSystem(scope), n: x.n, t: Date.now() }); byKey[scope + '|' + x.n] = true; }
      ok++;
    });
    saveFaceIdx(idx, scope);
    if (l36 === 0 || l36 === 1) {
      leno36 = l36 === 1;
      try { gStore.set(LENO36_KEY, leno36 ? '1' : '0'); } catch (e) {}
      syncLenoSys();
    }
    if (oneB === 0 || oneB === 1) {
      faceOneBased = oneB === 1;
      try { gStore.set(ONEBASED_KEY, faceOneBased ? '1' : '0'); } catch (e) {}
      obBtn_sync();
    }
    rebuildFaces();
    renderFaceList(); renderFaceGallery();
    toast('已导入 ' + ok + ' 张牌面');
  }

  // 批量上传：逐张按文件名匹配目标牌，压缩后落库；未识别的汇总提示
  function handleBatchFiles(files) {
    const list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    if (!window.mochiImgCompressTo) { toast('图片处理组件没加载上（缓存过旧或离线），请重新打开页面再试'); return; }
    const scope = panelScope();
    const defaultMode = scopeSystem(scope);
    const oneBased = faceOneBased;
    const skipped = [];
    const doneSet = new Set();
    const existing = new Set(loadFaceIdx(scope).map(x => scope + '|' + x.n));
    const overwritten = new Set();
    const step = (i) => {
      if (i >= list.length) {
        renderFaceList(); renderFaceGallery();
        if (doneSet.size) {
          const ow = overwritten.size ? '，覆盖同名 ' + overwritten.size + ' 张' : '';
          toast('批量导入 ' + doneSet.size + ' 张牌面' + ow + (skipped.length ? '，跳过 ' + skipped.length + ' 个' : ''));
        }
        else toast('没识别到对应牌（文件名需含牌名或编号）');
        if (skipped.length && window.openModal) {
          const names = skipped.slice(0, 15).join('、') + (skipped.length > 15 ? ' 等' : '');
          window.openModal('以下 ' + skipped.length + ' 个文件没识别到对应牌', '', function () {}, { noInput: true, pillSubmit: true, big: true, staticText: names, pills: [{ label: '知道了', value: 'ok' }] });
        }
        return;
      }
      const f = list[i];
      const hit = matchFaceFile(f.name, defaultMode, oneBased);
      if (!hit) { skipped.push(f.name); step(i + 1); return; }
      // FIX 2026-09-25 #1270：File 直接进闸，缩略图从已压好的整图再缩＝同一张原图整幅解码由两遍降到一遍
      compressImg(f, 720, 0.85).then((full) => {
        if (!full) { skipped.push(f.name); step(i + 1); return; }
        compressImg(full, 200, 0.82).then((thb) => {
          if (!thb) { skipped.push(f.name); step(i + 1); return; }
          const targetScope = hit.m === 'lenormand' ? 'lenormand' : scope;
          storeFaceFromDataUrls(targetScope, hit.n, full, thb);
          const key = targetScope + '|' + hit.n;
          if (existing.has(key) || doneSet.has(key)) overwritten.add(key);
          doneSet.add(key);
          step(i + 1);
        });
      });
    };
    step(0);
  }

  function wireFacePanel(pg) {
    const back = pg.querySelector('#divf-back');
    if (back) back.addEventListener('click', closeFacePanel);
    pg.querySelectorAll('.divf-tab').forEach(b => b.addEventListener('click', () => {
      faceTab = b.dataset.fpanel;
      syncFaceTabs();
      if (faceTab === 'gallery') renderFaceGallery(); else renderFaceList();
    }));
    const modes = pg.querySelector('#divf-modes');
    if (modes) modes.addEventListener('click', (e) => {
      const b = e.target.closest('.divf-mode');
      if (!b) return;
      facePanelCid = b.dataset.fmode;
      syncFaceTabs();
      renderFaceList();
      renderFaceGallery();
    });
    const systems = pg.querySelector('#divf-systems');
    if (systems) systems.addEventListener('click', (e) => {
      const b = e.target.closest('.divf-mode');
      if (!b || !b.dataset.fsys) return;
      facePanelSystem = b.dataset.fsys;
      syncFaceTabs();
      renderFaceList();
      renderFaceGallery();
    });
    const setSel = pg.querySelector('#divf-set-select');
    if (setSel) setSel.addEventListener('change', () => {
      setActiveSetOf(facePanelSystem, setSel.value);
      rebuildFaces();
      syncFaceTabs();
      renderFaceList();
      renderFaceGallery();
      toast(setSel.value === 'builtin' ? '已应用内置牌面' : '已切换套卡');
    });
    const setNew = pg.querySelector('#divf-set-new');
    if (setNew) setNew.addEventListener('click', () => {
      const sys = facePanelSystem;
      if (!window.openModal) return;
      window.openModal('新建套卡', '套卡 ' + (deckSetsOf(sys).length + 1), (v) => {
        const name = String(v || '').trim();
        if (!name) return;
        newDeckSet(sys, name);
        rebuildFaces();
        syncFaceTabs();
        renderFaceList();
        renderFaceGallery();
        toast('已新建并切换到「' + name + '」，现在可以上传这套卡的牌面');
      });
    });
    const setDel = pg.querySelector('#divf-set-del');
    if (setDel) setDel.addEventListener('click', () => {
      const sys = facePanelSystem;
      const setId = activeSetOf(sys);
      if (setId === 'builtin') { toast('内置牌面不能删除'); return; }
      const setObj = deckSetsOf(sys).filter(s => s.id === setId)[0];
      const name = setObj ? setObj.name : '这套卡';
      const scope = activeScopeOf(sys);
      window.openModal('删除套卡「' + name + '」？', '', (v) => {
        if (v !== 'ok') return;
        loadFaceIdx(scope).forEach(x => rmFaceData(scope, x.n));
        removeDeckSet(sys, setId);
        rebuildFaces();
        syncFaceTabs();
        renderFaceList();
        renderFaceGallery();
        toast('已删除「' + name + '」');
      }, { noInput: true, pillSubmit: true, staticText: '这套卡里上传的牌面图片会一起删除，不可恢复。', pills: [{ label: '删除', value: 'ok' }] });
    });
    const list = pg.querySelector('#divf-list');
    if (list) list.addEventListener('click', (e) => {
      const row = e.target.closest('.divf-row');
      if (!row) return;
      const n = row.dataset.name;
      const scope = panelScope();
      if (e.target.closest('.divf-del')) deleteFace(scope, n);
      else if (e.target.closest('.divf-up')) pickFaceFile(scope, n);
    });
    const grid = pg.querySelector('#divf-grid');
    if (grid) grid.addEventListener('click', (e) => {
      const cell = e.target.closest('.divf-cell');
      if (!cell) return;
      const m = cell.dataset.scope, n = cell.dataset.name;
      if (e.target.closest('.divf-cell-del')) deleteFace(m, n);
      else if (e.target.closest('.divf-cell-up')) pickFaceFile(m, n);
    });
    const clr = pg.querySelector('#divf-clear');
    if (clr) clr.addEventListener('click', clearAllFaces);
    const ex = pg.querySelector('#divf-export');
    if (ex) ex.addEventListener('click', exportFacesData);
    const imp = pg.querySelector('#divf-import');
    if (imp) imp.addEventListener('click', () => {
      // mochi-755-all：统一入口（本文件不再持有 input 节点）
      window.mochiFilePick({
        id: 'dev-divf-json-pick', accept: window.mochiDataPickAccept, // #1413：与整机导入同一份并集（窄串会让转存后改了类型的备份灰显）
        onFiles: (files) => {
          const f = files && files[0];
          if (!f) return;
          const rd = new FileReader();
          toast('正在读取牌面文件…');
          rd.onload = () => {
            toast('正在解析牌面数据…');
            requestAnimationFrame(() => setTimeout(() => {
              let d = null;
              try { d = JSON.parse(String(rd.result || '')); } catch (e) { toast('文件解析失败，请选择导出的牌面 JSON'); return; }
              importFacesData(d);
            }, 0));
          };
          rd.onerror = () => toast('文件读取失败');
          rd.onabort = () => toast('已取消读取牌面文件');
          rd.readAsText(f);
        }
      });
    });
    const batchBtn = pg.querySelector('#divf-batch');
    if (batchBtn) batchBtn.addEventListener('click', () => {
      window.mochiFilePick({
        id: 'dev-divf-batch-pick',
        accept: 'image/*',
        multiple: true,
        onFiles: (arr) => { if (arr && arr.length) handleBatchFiles(arr); }
      });
    });
    const obBtn = pg.querySelector('#divf-onebased');
    obBtn_sync();
    if (obBtn) obBtn.addEventListener('click', () => {
      faceOneBased = !faceOneBased;
      try { gStore.set(ONEBASED_KEY, faceOneBased ? '1' : '0'); } catch (e) {}
      obBtn_sync();
      toast(faceOneBased ? '已开启：塔罗纯编号按 1–78 对应' : '已关闭：塔罗纯编号按 0–77 对应');
    });
    // mochi-755-all：批量上传/换牌面/导入的 change 处理已内联进各自 mocchiFilePick 的 onFiles，
    // 原 batchInput/imgInput/jsonInput 三个监听随节点一起移除（节点不再由本文件创建）。
  }

  // ---- 初始化：构建 UI + 载入已存牌面（IDB 回填完成后再补一次） ----
  try { initFaceUI(); } catch (e) {}
  try { loadFaces(); } catch (e) {}
  try {
    document.addEventListener('mochi-restore-done', function () {
      try { faceOneBased = gStore.get(ONEBASED_KEY) === '1'; obBtn_sync(); } catch (e) {}
      try { loadFaces(); } catch (e) {}
    });
  } catch (e) {}

  // ---- v3.7.x：暴露给聊天页占卜半框共用（chat.js 在 divination.js 之前加载，
  // 半框只在点击时调用这些 API，运行时均已就绪） ----
  window.startDivineDraw = startDivineDraw;
  window.divineHistLoad = histLoad;
  window.divineHistSave = histSave;
  window.divineAutoGet = autoSendGet;
  window.divineAutoSet = autoSendSet;
  window.divineBuildSummary = buildSummary;
  window.divineBuildResultText = buildResultText;
  window.divineCopyResultText = copyResultText;
  window.divineSendResult = function (m, cards, summary, question, spreadName, labelsIn) { sendToChat(m, cards, summary, question, spreadName, labelsIn); };
  // v3.27.x：主页「占卜记录 → 查看牌面」复用占卜页完整结果渲染（records.js 已负责切页）
  window.divineRenderResult = function (cards, m, question, summary, mh, spread) {
    try {
      if (m === 'tarot' && spread && spread.id) { renderSpreadBoard(cards, spreadById(spread.id) || TAROT_SPREADS[1], question, summary); return; }
      renderDrawResult(cards, m, question, summary, mh);
    } catch (e) {}
  };
  window.divineMeihuaBuild = buildMeihua;
  window.divineRenderMeihua = renderMeihuaInto;
  window.divineRenderSpreadBoard = function (el, cards, spread, question, summary) {
    try { renderSpreadBoard(cards, spread, question, summary, el); } catch (e) {}
  };
  window.__MH_TRIGRAMS__ = MH_TRIGRAMS;
  // v3.27.x：牌面数据 API（图鉴页按钮内部用；也便于测试）
  window.divineFaces = {
    exportJSON: buildFaceExport,
    importData: importFacesData,
    count: function () { return loadFaceIdx().length; },
    leno36: function () { return leno36; },
    matchName: matchFaceFile
  };
})();
