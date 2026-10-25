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

  // ---- 咖啡专项（2 原料） ----
  var COFFEE1 = [
    F('orange_coffee', ['espresso', 'orange_juice'], '橙香咖啡', 'main', 'coffee', '咖啡', '☕', '#c77a3a'),
    F('oat_latte', ['espresso', 'oat_milk'], '燕麦拿铁', 'main', 'coffee', '咖啡', '☕', '#c9a06a'),
    F('cold_brew_milk', ['cold_brew', 'milk'], '冷萃奶咖', 'main', 'coffee', '咖啡', '🧊', '#8a6a4a'),
    F('coffee_tonic', ['cold_brew', 'tonic_water'], '咖啡汤力', 'main', 'coffee', '咖啡', '☕', '#b58a5a'),
    F('coffee_liqueur_milk', ['coffee_liqueur', 'milk'], '咖啡奶酒', 'main', 'alcohol', '酒', '🥃', '#b98a6a'),
    F('coffee_liqueur_latte', ['latte', 'coffee_liqueur'], '咖啡利口拿铁', 'main', 'alcohol', '酒', '🥃', '#b08a6a')
  ];

  // ---- 花草茶 / 花类气泡（2 原料） ----
  var FLORAL1 = [
    F('hibiscus_tea', ['hibiscus', 'black_tea'], '洛神花茶', 'main', 'tea', '茶', '🌺', '#c41f3a'),
    F('chrysanthemum_tea', ['chrysanthemum', 'black_tea'], '菊花茶', 'main', 'tea', '茶', '🌼', '#f2d98a'),
    F('lavender_tea', ['lavender', 'black_tea'], '薰衣草茶', 'main', 'tea', '茶', '💜', '#9b8bd0'),
    F('butterfly_pea_tea', ['butterfly_pea', 'green_tea'], '蝶豆花茶', 'main', 'tea', '茶', '🦋', '#4f6bd8'),
    F('jasmine_green_tea', ['jasmine', 'green_tea'], '茉莉绿茶', 'main', 'tea', '茶', '🌼', '#c9d66a'),
    F('yuzu_flower_tea', ['yuzu_flower', 'white_tea'], '柚花白茶', 'main', 'tea', '茶', '🍋', '#f2e6a6'),
    F('borage_tea', ['borage', 'green_tea'], '琉璃苣茶', 'main', 'tea', '茶', '💠', '#6b8fd8'),
    F('herbal_tea', ['black_tea', 'jasmine'], '花草茶', 'main', 'tea', '茶', '🌼', '#e8e0a8'),
    F('peach_soda', ['peach_puree', 'soda_water'], '蜜桃气泡', 'main', 'soda', '气泡水', '🍑', '#f5b58f'),
    F('lychee_soda', ['lychee', 'soda_water'], '荔枝气泡', 'main', 'soda', '气泡水', '🍈', '#f5e6d0'),
    F('rose_soda', ['rose_syrup', 'soda_water'], '玫瑰气泡', 'main', 'soda', '气泡水', '🌹', '#e87a9a'),
    F('butterfly_pea_soda', ['butterfly_pea', 'soda_water'], '蝶豆花气泡', 'main', 'soda', '气泡水', '🦋', '#4f6bd8')
  ];

  // ---- 花草 / 咖啡链式（2 原料，引用上一级 result.id） ----
  var CHAIN2 = [
    F('brown_sugar_latte', ['latte', 'brown_sugar_syrup'], '黑糖拿铁', 'main', 'coffee', '咖啡', '☕', '#8a5a3a'),
    F('jasmine_latte', ['latte', 'jasmine_honey'], '茉莉拿铁', 'main', 'coffee', '咖啡', '🌼', '#d9c89a'),
    F('rose_latte', ['latte', 'rose_syrup'], '玫瑰拿铁', 'main', 'coffee', '咖啡', '🌹', '#d98a9a'),
    F('lavender_latte', ['latte', 'lavender_syrup'], '薰衣草拿铁', 'main', 'coffee', '咖啡', '💜', '#b09ad8'),
    F('osmanthus_latte', ['latte', 'osmanthus_syrup'], '桂花拿铁', 'main', 'coffee', '咖啡', '☕', '#e0b86a'),
    F('oat_honey_latte', ['oat_latte', 'honey'], '蜂蜜燕麦拿铁', 'main', 'coffee', '咖啡', '🍯', '#d8b86a'),
    F('orange_coffee_ice', ['orange_coffee', 'ice_cube'], '橙香冰咖', 'main', 'coffee', '咖啡', '🍊', '#d88a4a'),
    F('orange_ice_coffee', ['orange_coffee_ice', 'cane_syrup'], '橙香冰摇咖啡', 'main', 'coffee', '咖啡', '🍊', '#e09a4a'),
    F('osmanthus_cold_brew_chain', ['osmanthus_latte', 'cold_brew'], '桂花冷萃', 'main', 'coffee', '咖啡', '🧊', '#b88a5a'),
    F('butterfly_pea_lime_soda_chain', ['butterfly_pea_soda', 'lime'], '蝶豆花青柠气泡', 'main', 'soda', '气泡水', '🦋', '#a86bd6'),
    F('butterfly_gin_tonic', ['gin_tonic', 'butterfly_pea'], '蝶豆花金汤力', 'main', 'alcohol', '酒', '🍸', '#8a6bd6'),
    F('lavender_herbal_tea', ['herbal_tea', 'lavender'], '薰衣草花草茶', 'main', 'tea', '茶', '💜', '#a89ad8'),
    F('rose_sparkling', ['sparkling_wine', 'rose_syrup'], '玫瑰气泡酒', 'main', 'alcohol', '酒', '🌹', '#e87a9a'),
    F('lychee_sparkling', ['sparkling_wine', 'lychee'], '荔枝气泡酒', 'main', 'alcohol', '酒', '🥂', '#f2d98a'),
    F('rose_lychee_sparkling_chain', ['rose_sparkling', 'lychee'], '玫瑰荔枝气泡酒', 'main', 'alcohol', '酒', '🥂', '#e8a0b8'),
    F('rice_milk_tea', ['rice_wine', 'milk_tea'], '酒酿奶茶', 'main', 'tea', '茶', '🍶', '#e8d8b0'),
    F('osmanthus_rice_milk_tea', ['rice_milk_tea', 'osmanthus_syrup'], '桂花酒酿奶茶', 'main', 'tea', '茶', '🌼', '#d8b87a'),
    F('brown_sugar_pearl_coffee', ['brown_sugar_latte', 'black_sugar_pearl'], '黑糖珍珠咖啡', 'main', 'coffee', '咖啡', '☕', '#8a5a3a')
  ];

  // ---- 三原料 / 四原料固定搭配 ----
  var FORMULA3 = [
    F('hibiscus_soda', ['hibiscus', 'soda_water', 'honey'], '洛神气泡', 'main', 'soda', '气泡水', '🌺', '#d8486a'),
    F('rose_espresso', ['espresso', 'rose_syrup', 'cream'], '玫瑰浓缩', 'main', 'coffee', '咖啡', '🌹', '#c98a8a'),
    F('yuzu_americano', ['espresso', 'yuzu_flower_syrup', 'soda_water'], '柚花美式', 'main', 'coffee', '咖啡', '🍋', '#d8b06a'),
    F('sea_salt_cheese_coffee', ['espresso', 'cheese_foam', 'sea_salt'], '海盐芝士咖啡', 'main', 'coffee', '咖啡', '🧂', '#d8c08a'),
    F('borage_iced_milk_tea', ['milk_tea', 'borage', 'ice_cube'], '琉璃苣冰奶茶', 'main', 'tea', '茶', '💠', '#a8b8d8'),
    F('hibiscus_iced_coffee', ['cold_brew', 'hibiscus_tea', 'peach_puree'], '洛神花冰咖', 'main', 'coffee', '咖啡', '🌺', '#b85a7a'),
    F('osmanthus_cold_brew', ['cold_brew', 'osmanthus_syrup', 'ice_cube'], '桂花冷萃', 'main', 'coffee', '咖啡', '🧊', '#b88a5a'),
    F('butterfly_pea_lime_soda', ['butterfly_pea', 'lime', 'soda_water'], '蝶豆花青柠气泡', 'main', 'soda', '气泡水', '🦋', '#a86bd6'),
    F('rose_lychee_sparkling', ['sparkling_wine', 'rose_syrup', 'lychee'], '玫瑰荔枝气泡酒', 'main', 'alcohol', '酒', '🥂', '#e8a0b8'),
    F('espresso_martini', ['vodka', 'espresso', 'coffee_liqueur'], '浓缩咖啡马天尼', 'main', 'alcohol', '酒', '🍸', '#6a3a22'),
    F('jasmine_green_tea_soda', ['jasmine_green_tea', 'soda_water', 'honey'], '茉莉绿茶气泡', 'main', 'soda', '气泡水', '🌼', '#d8e0a0')
  ];

  window.BarFusions = LEVEL1.concat(LEVEL2).concat(LEVEL3).concat(COFFEE1).concat(FLORAL1).concat(CHAIN2).concat(FORMULA3);
})();
