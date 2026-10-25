// ===== 吧台：预设原料库（约 101 种，removable:false，首次进入幂等初始化）=====
// 约定（对齐 bar 功能数据模型）：
//   role: 'base' | 'main' | 'modifier' | 'addon'；仅 base 带 family/suffix。
//   每个原料必须带 color（hex）——液体混色用，缺失会导致混色失效。
//   removable:false＝预设不可删；temporary:false＝非合成物。
// 幂等：bar.js 按 version 判断是否已初始化，避免覆盖用户已删改的原料。
(function () {
  var PRESET_VERSION = 2;

  // [id, name, family, suffix, emoji, color] —— 基底 base
  var BASE = [
    // tea
    ['black_tea', '红茶', 'tea', '茶', '🫖', '#8a4b1e'],
    ['green_tea', '绿茶', 'tea', '茶', '🍵', '#9ccb6a'],
    ['oolong_tea', '乌龙茶', 'tea', '茶', '🍃', '#c8a24a'],
    ['jasmine_tea', '茉莉花茶', 'tea', '茶', '🌼', '#f3e2a0'],
    ['earl_grey', '伯爵茶', 'tea', '茶', '🫖', '#b0722f'],
    ['matcha', '抹茶', 'tea', '茶', '🍵', '#7fae52'],
    ['pu_er', '普洱', 'tea', '茶', '🍵', '#5a3a1a'],
    ['white_tea', '白茶', 'tea', '茶', '🍵', '#e8e2c0'],
    // milk
    ['milk', '牛奶', 'milk', '奶', '🥛', '#f7f5f0'],
    ['oat_milk', '燕麦奶', 'milk', '奶', '🌾', '#e6d9bd'],
    ['coconut_milk', '椰奶', 'milk', '奶', '🥥', '#f5f2ea'],
    ['condensed_milk', '炼乳', 'milk', '奶', '🍯', '#f0e2c0'],
    // coffee
    ['espresso', '浓缩咖啡', 'coffee', '咖啡', '☕', '#3b2314'],
    ['cold_brew', '冷萃', 'coffee', '咖啡', '🧊', '#4a2e1a'],
    ['americano', '美式', 'coffee', '咖啡', '☕', '#6b4423'],
    // soda
    ['soda_water', '苏打水', 'soda', '气泡水', '💧', '#dff3f7'],
    ['tonic_water', '汤力水', 'soda', '汤力', '🫧', '#e6f2e8'],
    ['cola', '可乐', 'soda', '可乐', '🥤', '#6b3a1a'],
    ['sprite', '雪碧', 'soda', '汽水', '🥤', '#e7f7c8'],
    ['ginger_ale', '姜汁汽水', 'soda', '汽水', '🫚', '#e8c27a'],
    // juice
    ['orange_juice', '橙汁', 'juice', '汁', '🍊', '#f59e2e'],
    ['apple_juice', '苹果汁', 'juice', '汁', '🍎', '#e8b84b'],
    ['grape_juice', '葡萄汁', 'juice', '汁', '🍇', '#7b3f8f'],
    ['tomato_juice', '番茄汁', 'juice', '汁', '🍅', '#d8482f'],
    ['pineapple_juice', '菠萝汁', 'juice', '汁', '🍍', '#f2c93b'],
    // alcohol
    ['rum', '朗姆酒', 'alcohol', '酒', '🏴‍☠️', '#b8722a'],
    ['whisky', '威士忌', 'alcohol', '酒', '🥃', '#c8871f'],
    ['vodka', '伏特加', 'alcohol', '酒', '🍸', '#e9f0f5'],
    ['gin', '金酒', 'alcohol', '酒', '🌿', '#dfe9e0'],
    ['tequila', '龙舌兰', 'alcohol', '酒', '🌵', '#e6e2b0'],
    ['brandy', '白兰地', 'alcohol', '酒', '🍇', '#a4551f'],
    ['sake', '清酒', 'alcohol', '酒', '🍶', '#f2efe0'],
    ['beer', '啤酒', 'alcohol', '酒', '🍺', '#e0a52a'],
    ['red_wine', '红酒', 'alcohol', '酒', '🍷', '#7a1f2b'],
    ['plum_wine', '梅酒', 'alcohol', '酒', '🍑', '#d98a4a'],
    ['baijiu', '白酒', 'alcohol', '酒', '🍶', '#eef2f5'],
    ['soju', '烧酒', 'alcohol', '酒', '🍶', '#eaf0f0'],
    // 咖啡 / 奶 / 酒：cream 只作为基底，咖啡利口酒跨咖啡与酒
    ['cream', '鲜奶油', 'milk', '奶', '🥛', '#f7f2e8'],
    ['coffee_liqueur', '咖啡利口酒', 'alcohol', '酒', '🥃', '#4a2a18'],
    ['sparkling_wine', '起泡酒', 'alcohol', '酒', '🍾', '#f2d98a'],
    ['rice_wine', '米酒', 'alcohol', '酒', '🍶', '#f0ead0']
  ];

  // [id, name, emoji, color] —— 主料 main（水果 + 花草/风味）
  var MAIN = [
    ['lemon', '柠檬', '🍋', '#f7d54a'],
    ['lime', '青柠', '🍈', '#b7d84a'],
    ['orange', '橙子', '🍊', '#f59e2e'],
    ['strawberry', '草莓', '🍓', '#e2415a'],
    ['blueberry', '蓝莓', '🫐', '#4a5fb0'],
    ['mango', '芒果', '🥭', '#f5a623'],
    ['peach', '桃子', '🍑', '#f7b6a0'],
    ['grape', '葡萄', '🍇', '#7b3f8f'],
    ['watermelon', '西瓜', '🍉', '#f0435a'],
    ['passion_fruit', '百香果', '🥭', '#e8a72e'],
    ['lychee', '荔枝', '🍈', '#f5e6d0'],
    ['cherry', '樱桃', '🍒', '#c2203a'],
    ['pineapple', '菠萝', '🍍', '#f2c93b'],
    ['coconut', '椰子', '🥥', '#f5f2ea'],
    ['pomelo', '柚子', '🍊', '#efdf9a'],
    ['pomegranate', '石榴', '🍎', '#c4203a'],
    ['bayberry', '杨梅', '🍒', '#8f2d4a'],
    ['green_plum', '青梅', '🍏', '#a8c94a'],
    ['kiwi', '奇异果', '🥝', '#8fbb3a'],
    ['avocado', '牛油果', '🥑', '#9fbf5a'],
    ['mint', '薄荷', '🌿', '#6fce8a'],
    ['rose', '玫瑰', '🌹', '#e87a9a'],
    ['osmanthus', '桂花', '🌼', '#f2c14e'],
    ['lavender', '薰衣草', '💜', '#9b8bd0'],
    ['ginger', '姜', '🫚', '#e8b96a'],
    ['cocoa', '可可', '🍫', '#6b4326'],
    ['coffee_bean', '咖啡豆', '☕', '#5a3a22'],
    // 花类 / 果泥
    ['jasmine', '茉莉花', '🌼', '#f5f0d8'],
    ['butterfly_pea', '蝶豆花', '🦋', '#4f6bd8'],
    ['yuzu_flower', '柚子花', '🌼', '#f2e6a6'],
    ['borage', '琉璃苣', '💠', '#6b8fd8'],
    ['peach_puree', '水蜜桃果泥', '🍑', '#f5b58f']
  ];

  // [id, name, emoji, color] —— 修饰 modifier
  var MODIFIER = [
    ['sea_salt', '海盐', '🧂', '#e8eef2'],
    ['cheese', '芝士', '🧀', '#f2c14e'],
    ['caramel', '焦糖', '🍮', '#c8792a'],
    ['brown_sugar', '黑糖', '🟤', '#6b4326'],
    ['vanilla', '香草', '🌾', '#f0e2c0'],
    ['cinnamon', '肉桂', '🪵', '#a5622a'],
    ['honey', '蜂蜜', '🍯', '#e8b52a'],
    ['maple_syrup', '枫糖', '🍁', '#b5621f'],
    ['chocolate', '巧克力', '🍫', '#4a2e1c'],
    ['basil', '罗勒', '🌿', '#5a9b4a'],
    ['rosemary', '迷迭香', '🌿', '#5f8f5a'],
    ['cardamom', '豆蔻', '🌰', '#a58a5a'],
    ['black_pepper', '黑胡椒', '⚫', '#3a3a3a'],
    ['chili', '辣椒', '🌶️', '#d8321f'],
    ['wasabi', '芥末', '🟢', '#8fc43a'],
    ['sea_buckthorn', '沙棘', '🟠', '#f2a01f'],
    ['hibiscus', '洛神花', '🌺', '#c41f3a'],
    ['chrysanthemum', '菊花', '🌼', '#f2d98a'],
    ['goji', '枸杞', '🔴', '#d43a2a'],
    ['red_date', '红枣', '🟤', '#8a2f2a'],
    ['longan', '桂圆', '🟤', '#b5764a'],
    ['lotus_seed', '莲子', '⚪', '#f0ead0'],
    ['taro', '芋头', '🟣', '#b79bd0'],
    ['pumpkin', '南瓜', '🎃', '#f08a1f'],
    ['sweet_potato', '红薯', '🍠', '#d4732a'],
    // 花蜜 / 糖浆 / 奶盖
    ['osmanthus_syrup', '桂花糖浆', '🌼', '#f2c14e'],
    ['jasmine_honey', '茉莉花蜜', '🍯', '#f5e6b0'],
    ['rose_syrup', '玫瑰香蜜', '🌹', '#e87a9a'],
    ['lavender_syrup', '薰衣草糖浆', '💜', '#9b8bd0'],
    ['yuzu_flower_syrup', '柚子花液', '🍋', '#f2e6a6'],
    ['brown_sugar_syrup', '黑糖糖浆', '🟤', '#6b4326'],
    ['cane_syrup', '蔗糖糖浆', '🍬', '#f5e8c8'],
    ['cheese_foam', '芝士奶盖', '🧁', '#f7e6b0']
  ];

  // [id, name, emoji, color] —— 小料 addon
  var ADDON = [
    ['sago', '西米', '⚪', '#f0ece0'],
    ['pearl', '珍珠', '⚫', '#3a2a1a'],
    ['coconut_jelly', '椰果', '⬜', '#f5f2ea'],
    ['taro_ball', '芋圆', '🟣', '#b79bd0'],
    ['grass_jelly', '仙草', '⬛', '#2a2a2a'],
    ['pudding', '布丁', '🍮', '#f2c14e'],
    ['agar', '寒天', '⬜', '#f2efe6'],
    ['popping_boba', '爆爆珠', '🔴', '#e2415a'],
    ['red_bean', '红豆', '🟤', '#7a3a2a'],
    ['mung_bean', '绿豆', '🟢', '#8fbb5a'],
    ['oat', '燕麦', '🌾', '#e6d9bd'],
    ['crispy_boba', '脆波波', '🟤', '#c8874a'],
    ['black_sugar_pearl', '黑糖珍珠', '🟤', '#6b4326'],
    ['edible_flower', '三色堇装饰花', '🌸', '#c7a8e8'],
    ['snow_cake', '雪饼', '🍘', '#f2e6c8'],
    ['ice_cube', '冰块', '🧊', '#dfeff5']
  ];

  function baseIng(a) {
    return { id: a[0], name: a[1], role: 'base', family: a[2], suffix: a[3], emoji: a[4], color: a[5], unlocked: true, removable: false, temporary: false };
  }
  function flatIng(a, role) {
    return { id: a[0], name: a[1], role: role, family: null, suffix: null, emoji: a[2], color: a[3], unlocked: true, removable: false, temporary: false };
  }

  var ingredients = BASE.map(baseIng)
    .concat(MAIN.map(function (a) { return flatIng(a, 'main'); }))
    .concat(MODIFIER.map(function (a) { return flatIng(a, 'modifier'); }))
    .concat(ADDON.map(function (a) { return flatIng(a, 'addon'); }));

  window.BarPresets = { version: PRESET_VERSION, ingredients: ingredients };
})();
