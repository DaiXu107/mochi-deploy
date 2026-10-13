// ===== 吧台：固定搭配 Fusion 表 =====
// 匹配规则：无序匹配（requires 全部命中即触发）；按 requires.length 降序，长组合优先。
// 命中 exclusive:true → 立即合并为 result（占 1 槽），合成物作 temporary 临时原料继续参与下一级（链式）。
// result.id 即 Fusion.id —— 供更上层的链式 requires 引用。
(function () {
  function F(id, requires, name, role, family, suffix, emoji, color) {
    return {
      id: id,
      requires: requires,
      result: { id: id, name: name, role: role, family: family, suffix: suffix, emoji: emoji, color: color },
      exclusive: true
    };
  }

  // ---- 双原料（一级）----
  var LEVEL1 = [
    F('lemon_tea', ['lemon', 'black_tea'], '柠檬茶', 'main', 'tea', '茶', '🍋', '#f2c94c'),
    F('lemon_green_tea', ['lemon', 'green_tea'], '柠檬绿茶', 'main', 'tea', '茶', '🍵', '#c9d66a'),
    F('milk_tea', ['milk', 'black_tea'], '奶茶', 'main', 'tea', '茶', '🧋', '#c9a06a'),
    F('milk_green_tea', ['milk', 'green_tea'], '奶绿', 'main', 'tea', '茶', '🧋', '#cfe0a8'),
    F('sago_milk', ['sago', 'milk'], '西米露', 'main', 'milk', '奶', '🥣', '#f2ece0'),
    F('latte', ['espresso', 'milk'], '拿铁', 'main', 'coffee', '咖啡', '☕', '#b98a5a'),
    F('matcha_latte', ['matcha', 'milk'], '抹茶拿铁', 'main', 'tea', '茶', '🍵', '#a8c47a'),
    F('strawberry_milk', ['strawberry', 'milk'], '草莓牛奶', 'main', 'milk', '奶', '🥛', '#f2b6c6'),
    F('mango_coconut', ['mango', 'coconut_milk'], '芒果椰奶', 'main', 'milk', '奶', '🥥', '#f7d98a'),
    F('lemon_soda', ['lemon', 'soda_water'], '柠檬气泡水', 'main', 'soda', '气泡水', '🍋', '#f5e07a'),
    F('lime_soda', ['lime', 'soda_water'], '青柠苏打', 'main', 'soda', '气泡水', '🍈', '#d4e88a'),
    F('blueberry_soda', ['blueberry', 'soda_water'], '蓝莓气泡水', 'main', 'soda', '气泡水', '🫐', '#8a7fd0'),
    F('watermelon_soda', ['watermelon', 'soda_water'], '西瓜气泡水', 'main', 'soda', '气泡水', '🍉', '#f28a9a'),
    F('peach_oolong', ['peach', 'oolong_tea'], '桃桃乌龙', 'main', 'tea', '茶', '🍑', '#f0b58a'),
    F('passion_green_tea', ['passion_fruit', 'green_tea'], '百香果绿茶', 'main', 'tea', '茶', '🍹', '#e0b84a'),
    F('rose_tea', ['rose', 'black_tea'], '玫瑰茶', 'main', 'tea', '茶', '🌹', '#d98a9a'),
    F('osmanthus_tea', ['osmanthus', 'black_tea'], '桂花茶', 'main', 'tea', '茶', '🌼', '#f0cf7a'),
    F('mint_tea', ['mint', 'green_tea'], '薄荷茶', 'main', 'tea', '茶', '🌿', '#a8d98a'),
    F('ginger_cola', ['ginger', 'cola'], '姜汁可乐', 'main', 'soda', '气泡水', '🥤', '#9a5a2a'),
    F('honey_lemon', ['honey', 'lemon'], '蜂蜜柠檬', 'main', null, null, '🍯', '#f0cf5a'),
    F('cheese_tea', ['cheese', 'black_tea'], '芝士茶', 'main', 'tea', '茶', '🧀', '#e8cf8a'),
    F('cuba_libre', ['rum', 'cola'], '自由古巴', 'main', 'alcohol', '酒', '🍹', '#8a4a2a'),
    F('screwdriver', ['vodka', 'orange_juice'], '螺丝起子', 'main', 'alcohol', '酒', '🍹', '#f5a02a'),
    F('gin_tonic', ['gin', 'tonic_water'], '金汤力', 'main', 'alcohol', '酒', '🍸', '#e0f0e0'),
    F('highball', ['whisky', 'soda_water'], '高球', 'main', 'alcohol', '酒', '🥃', '#e8c47a'),
    F('plum_soda', ['plum_wine', 'soda_water'], '梅酒苏打', 'main', 'alcohol', '酒', '🍑', '#e8b07a'),
    F('sake_soda', ['sake', 'soda_water'], '清酒苏打', 'main', 'alcohol', '酒', '🍶', '#eef2e8')
  ];

  // ---- 三级 / 四级链式 ----
  var LEVEL2 = [
    F('sea_salt_cheese_tea', ['cheese_tea', 'sea_salt'], '海盐芝士茶', 'main', 'tea', '茶', '🧂', '#e8d89a'),
    F('pearl_milk_tea', ['milk_tea', 'pearl'], '珍珠奶茶', 'main', 'tea', '茶', '🧋', '#b98a5a'),
    F('caramel_milk_tea', ['milk_tea', 'caramel'], '焦糖奶茶', 'main', 'tea', '茶', '🧋', '#c8894a'),
    F('brown_sugar_milk_tea', ['milk_tea', 'brown_sugar'], '黑糖奶茶', 'main', 'tea', '茶', '🧋', '#8a5a3a'),
    F('taro_milk_tea', ['milk_tea', 'taro_ball'], '芋圆奶茶', 'main', 'tea', '茶', '🧋', '#d0a8c8'),
    F('coconut_milk_tea', ['milk_tea', 'coconut_jelly'], '椰果奶茶', 'main', 'tea', '茶', '🧋', '#e8d8b8'),
    F('pudding_milk_tea', ['milk_tea', 'pudding'], '布丁奶茶', 'main', 'tea', '茶', '🧋', '#e8c46a'),
    F('red_bean_milk_tea', ['milk_tea', 'red_bean'], '红豆奶茶', 'main', 'tea', '茶', '🧋', '#b5764a'),
    F('caramel_latte', ['latte', 'caramel'], '焦糖拿铁', 'main', 'coffee', '咖啡', '☕', '#c8894a'),
    F('vanilla_latte', ['latte', 'vanilla'], '香草拿铁', 'main', 'coffee', '咖啡', '☕', '#d8b88a'),
    F('cinnamon_latte', ['latte', 'cinnamon'], '肉桂拿铁', 'main', 'coffee', '咖啡', '☕', '#b5764a'),
    F('matcha_red_bean_latte', ['matcha_latte', 'red_bean'], '抹茶红豆拿铁', 'main', 'tea', '茶', '🍵', '#9fb87a'),
    F('honey_lemon_tea', ['lemon_tea', 'honey'], '蜂蜜柠檬茶', 'main', 'tea', '茶', '🍯', '#f0d05a'),
    F('mint_lemon_tea', ['lemon_tea', 'mint'], '薄荷柠檬茶', 'main', 'tea', '茶', '🌿', '#b8e09a'),
    F('cheese_peach_oolong', ['peach_oolong', 'cheese'], '芝士桃桃乌龙', 'main', 'tea', '茶', '🍑', '#e8b88a'),
    F('brown_sugar_pearl_milk_tea', ['pearl_milk_tea', 'brown_sugar'], '黑糖珍珠奶茶', 'main', 'tea', '茶', '🧋', '#7a4a2a'),
    F('lychee_rose_tea', ['rose_tea', 'lychee'], '荔枝玫瑰茶', 'main', 'tea', '茶', '🌹', '#f0a8b8')
  ];

  // ---- 三原料（酒精为主）----
  var LEVEL3 = [
    F('mojito', ['rum', 'lime', 'mint'], '莫吉托', 'main', 'alcohol', '酒', '🍸', '#d0e8a8'),
    F('whisky_sour', ['whisky', 'lemon', 'honey'], '威士忌酸', 'main', 'alcohol', '酒', '🥃', '#e8b85a'),
    F('white_russian', ['vodka', 'espresso', 'milk'], '白俄罗斯', 'main', 'alcohol', '酒', '🥛', '#e8d8c0'),
    F('tequila_sunrise', ['tequila', 'lemon', 'sea_salt'], '龙舌兰日出', 'main', 'alcohol', '酒', '🍹', '#f28a3a'),
    F('gin_fizz', ['gin', 'lemon', 'soda_water'], '金菲士', 'main', 'alcohol', '酒', '🍸', '#dfe8b8')
  ];

  window.BarFusions = LEVEL1.concat(LEVEL2).concat(LEVEL3);
})();
