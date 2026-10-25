(function () { try {
(function () {
window.BarNames = {
order: ['funny', 'emotion', 'poetic', 'minimal'],
labels: { funny: '搞怪', emotion: '情绪', poetic: '诗意', minimal: '极简' },
pools: {
funny: [
'一醉方休', '今夜不回家', '明天再说', '随便吧', '心情复杂', '一口闷',
'不知道叫什么', '管它呢', '干了这杯', '无所谓', '你猜', '反正不是酒',
'别问了', '反正你会喝', '再来一杯', '就这', '凑合喝吧'
],
emotion: [
'无名的告白', '午夜回声', '混沌特调', '心事重重', '欲言又止', '想你的夜',
'深夜 emo', '有点上头', '微醺时刻', '孤枕难眠', '眼泪的味道', '说不出口',
'一个人喝', '等风也等你', '苦夏', '余甘', '花期', '半醒', '酸涩', '回甘'
],
poetic: [
'落日晚风', '春夜微凉', '海边来信', '云上散步', '星河入梦', '月下独酌',
'南风知我意', '山海不可平', '半糖主义', '温柔乡', '白月光', '朱砂痣',
'一整个夏天', '像你一样甜', '人间朝暮', '金雪', '秋酿', '桂月', '绯色', '刺与蜜', '蓝夜', '蝶变', '紫雾', '白露', '赤霞', '柚光', '夜航', '深焙', '米酿', '旧巷', '洛水', '青紫', '花间', '月桂', '海盐雾', '橙光'
],
minimal: [
'一杯', '特调', '秘密', '无言', '余温', '空白', '未命名', '花', '夜', '苦', '蓝'
]
}
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("bar-names.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("bar-names.js"); try { console.error("[JS] bar-names.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[bar-names.js] " + String(__e && __e.message || __e)); } })();