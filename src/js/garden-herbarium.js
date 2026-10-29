/* ===== 花园 · Herbarium 皮肤（2026-10-29）
   只做视觉与交互层，沿用 garden.js 已有的 data.p / dex / log / 工具按钮。
   不迁移、不新增存档字段；?garden=classic 可回退旧版花园。 */
(function () {
'use strict';
var page = document.getElementById('page-garden');
if (!page) return;
try { if (/(^|[?&])garden=classic(&|$)/.test(location.search)) return; } catch (e) {}
page.classList.add('gh');

  var THEME = {
    peony:{f:'#B06A72',s:'#6B4248',latin:'Paeonia suffruticosa',label:'牡丹'},
    lavender:{f:'#7F769C',s:'#554E6B',latin:'Lavandula angustifolia',label:'薰衣草'},
    bamboo:{f:'#687B5D',s:'#45523D',latin:'Bambusoideae',label:'竹'},
    clover:{f:'#778A5B',s:'#4C5B3B',latin:'Trifolium repens',label:'幸运草'},
    cactus:{f:'#6C8260',s:'#46563F',latin:'Cactaceae',label:'仙人掌'},
    iris:{f:'#7C779E',s:'#4E4A6B',latin:'Iris tectorum',label:'鳳尾'},
    lotus:{f:'#BE7C7A',s:'#7C4F4C',latin:'Nelumbo nucifera',label:'荷花'},
    jasmine:{f:'#CFC39E',s:'#7F7358',latin:'Jasminum sambac',label:'茉莉'},
    sakura:{f:'#CD9597',s:'#855A5C',latin:'Prunus serrulata',label:'樱花'},
    camellia:{f:'#A75D56',s:'#6E3E39',latin:'Camellia japonica',label:'山茶花'},
    tulip:{f:'#BE7A63',s:'#774A3A',latin:'Tulipa gesneriana',label:'郁金香'},
    rose:{f:'#AA646A',s:'#6E4145',latin:'Rosa / Morning Dew',label:'玫瑰'},
    sunflower:{f:'#D8A64B',s:'#8A5A20',latin:'Helianthus annuus',label:'向日葵',leafA:'#7E8C5A',leafB:'#4E5C37'},
    daisy:{f:'#F1E8D4',s:'#A9976F',latin:'Bellis perennis',label:'雏菊',leafA:'#7A8C65',leafB:'#4B5B3B'},
    hibiscus:{f:'#C8695E',s:'#7C3D38',latin:'Hibiscus rosa-sinensis',label:'芙蓉'},
    lily:{f:'#EFE6D0',s:'#B49B70',latin:'Lilium brownii',label:'百合',leafA:'#6F835F',leafB:'#43543A'},
    orchid:{f:'#C3A3C2',s:'#775879',latin:'Cymbidium goeringii',label:'兰花',leafA:'#6E8360',leafB:'#40523A'},
    maple:{f:'#B06A45',s:'#6B3F2B',latin:'Acer palmatum',label:'枫叶',leafA:'#A66B45',leafB:'#6B3F2B'},
    wheat:{f:'#C9A96A',s:'#7F6034',latin:'Triticum aestivum',label:'麦穗',leafA:'#C0A96D',leafB:'#7A6436'},
    flameRose:{f:'#D2543D',s:'#7A2318',latin:'Rosa ignis',label:'绚樱玫瑰',rare:true},
    blueRose:{f:'#6F7FBD',s:'#35406F',latin:'Rosa caerulea',label:'蓝玫瑰',rare:true},
    goldSun:{f:'#E3B842',s:'#8A651B',latin:'Helianthus aureus',label:'金向日葵',rare:true,leafA:'#8C8A4E',leafB:'#5C5A2E'},
    nightLotus:{f:'#7A6FAE',s:'#2E2A56',latin:'Nelumbo nocturna',label:'夜莲',rare:true},
    rainbowClover:{f:'#B986A8',s:'#4F6B57',latin:'Trifolium iridis',label:'彩虹草',rare:true,leafA:'#8C8A5A',leafB:'#4E6244'},
    iceRose:{f:'#A9C9DA',s:'#5C7F94',latin:'Rosa glacialis',label:'冰玫瑰',rare:true},
    starLily:{f:'#F4ECD0',s:'#8C7F5F',latin:'Lilium stellatum',label:'星光百合',rare:true,leafA:'#7E8C70',leafB:'#4C5C46'},
    moonFlower:{f:'#D9D3B4',s:'#7D7860',latin:'Ipomoea alba',label:'月光花',rare:true},
    crystalOrchid:{f:'#A9D3CE',s:'#4E7E7A',latin:'Cymbidium crystallinum',label:'水晶兰',rare:true},
    phoenix:{f:'#D9643C',s:'#7E2B1B',latin:'Delonix regia',label:'凤凰花',rare:true},
    gloriosa:{f:'#CF5338',s:'#7A1E1A',latin:'Gloriosa superba',label:'嘉兰百合',rare:true,isNew:true,leafA:'#6F8A5E',leafB:'#3F5438'},
    blackDatura:{f:'#4F335E',s:'#140E1A',latin:'Datura metel',label:'黑色曼陀罗',rare:true,isNew:true,leafA:'#5E7057',leafB:'#33422F'},
    starflower:{f:'#86A5D0',s:'#4E6E9E',latin:'Limonium sinuatum',label:'星辰花',rare:true,isNew:true,leafA:'#728A66',leafB:'#43563B'},
    empty:{f:'#8C7B63',s:'#5B4C3B',latin:'—',label:'空地'}
  };
  var UID = 0;
  function lighten(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.min(255, Math.round(((n >> 16) & 255) + (255 - ((n >> 16) & 255)) * amt));
    var g = Math.min(255, Math.round(((n >> 8) & 255) + (255 - ((n >> 8) & 255)) * amt));
    var b = Math.min(255, Math.round((n & 255) + (255 - (n & 255)) * amt));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  function petal(u, cx, cy, r, angle, narrow, shade) {
    var w = r * (narrow ? .23 : .39);
    var shape = 'M' + cx + ' ' + cy +
      ' C' + (cx - w) + ' ' + (cy - r * .30) + ',' + (cx - w * .94) + ' ' + (cy - r * .92) + ',' + cx + ' ' + (cy - r * 1.03) +
      ' C' + (cx + w * .94) + ' ' + (cy - r * .92) + ',' + (cx + w) + ' ' + (cy - r * .30) + ',' + cx + ' ' + cy + 'Z';
    return '<g transform="rotate(' + angle + ' ' + cx + ' ' + cy + ')">' +
      '<path d="' + shape + '" fill="' + THEME.__s + '" opacity=".16" transform="translate(.4 1.4)"/>' +
      '<path d="' + shape + '" fill="url(#' + u + (shade ? '-petB' : '-pet') + ')" stroke="' + THEME.__s + '" stroke-opacity=".46" stroke-width=".38"/>' +
      '<path d="M' + (cx + w * .12) + ' ' + (cy - r * .18) + ' C' + (cx + w * .45) + ' ' + (cy - r * .44) + ',' + (cx + w * .40) + ' ' + (cy - r * .76) + ',' + cx + ' ' + (cy - r * .96) + '" fill="none" stroke="#fff" stroke-opacity=".30" stroke-width=".42"/>' +
      '<path d="M' + cx + ' ' + (cy - r * .10) + ' L' + cx + ' ' + (cy - r * .78) + '" fill="none" stroke="' + THEME.__s + '" stroke-opacity=".18" stroke-width=".34"/>' +
    '</g>';
  }
  function ring(u, cx, cy, r, n, off, narrow) {
    var s = '';
    for (var i = 0; i < n; i++) {
      var j = ((i * 37 + 11) % 9) / 100;
      var ang = (off || 0) + i * 360 / n + (((i * 13) % 5) - 2) * .7;
      s += petal(u, cx, cy, r * (.91 + j * .18), ang, narrow, i % 3 === 1);
    }
    return s;
  }
  function leaf(u, angle, len, wide, tint) {
    var w = len * wide;
    var tip = 50 - len;
    return '<g transform="rotate(' + angle + ' 50 50)">' +
      '<path d="M50 50 C' + (50 - w) + ' ' + (50 - len * .42) + ',' + (50 - w * .82) + ' ' + (tip + len * .28) + ',50 ' + tip +
      ' C' + (50 + w * .82) + ' ' + (tip + len * .28) + ',' + (50 + w) + ' ' + (50 - len * .42) + ',50 50Z"' +
      ' fill="url(#' + u + '-leaf)" stroke="' + (tint || '#485A43') + '" stroke-opacity=".55" stroke-width=".45"/>' +
      '<path d="M50 48 L50 ' + (tip + 2) + '" fill="none" stroke="' + (tint || '#485A43') + '" stroke-opacity=".34" stroke-width=".4"/>' +
      '<path d="M50 43 L' + (50 - w * .34) + ' 38 M50 38 L' + (50 - w * .3) + ' 33 M50 43 L' + (50 + w * .34) + ' 38 M50 38 L' + (50 + w * .3) + ' 33" fill="none" stroke="' + (tint || '#485A43') + '" stroke-opacity=".22" stroke-width=".3"/>' +
    '</g>';
  }
  function leaves(u, angles, len, wide, tint) {
    var s = '';
    angles.forEach(function(a, i) {
      var f = .86 + ((i * 7) % 5) * .055;
      s += leaf(u, a + (((i * 11) % 5) - 2) * .8, len * f, wide * (.9 + ((i * 5) % 3) * .07), tint);
    });
    return s;
  }
  function spiral(u, cx, cy, r) {
    return '<path d="M' + cx + ' ' + cy + ' C' + (cx + r * .7) + ' ' + (cy - r * .2) + ',' + (cx + r * .2) + ' ' + (cy + r * .62) + ',' + (cx - r * .5) + ' ' + (cy + r * .1) +
      ' C' + (cx - r * .9) + ' ' + (cy - r * .3) + ',' + (cx - r * .2) + ' ' + (cy - r * .85) + ',' + (cx + r * .35) + ' ' + (cy - r * .45) + '" fill="none" stroke="' + THEME.__s + '" stroke-opacity=".62" stroke-width=".8" stroke-linecap="round"/>';
  }
  function star(x, y, r, color, op) {
    var q = r * .24;
    return '<path d="M' + x + ' ' + (y - r) + ' L' + (x + q) + ' ' + (y - q) + ' L' + (x + r) + ' ' + y + ' L' + (x + q) + ' ' + (y + q) +
      ' L' + x + ' ' + (y + r) + ' L' + (x - q) + ' ' + (y + q) + ' L' + (x - r) + ' ' + y + ' L' + (x - q) + ' ' + (y - q) + 'Z" fill="' + color + '" opacity="' + (op || .8) + '"/>';
  }
  function forgetMeNot(u, cx, cy, r, rot) {
    var s = '';
    for (var i = 0; i < 5; i++) {
      var a = (rot + i * 72) * Math.PI / 180;
      var px = cx + Math.cos(a) * r * .6, py = cy + Math.sin(a) * r * .6;
      s += '<ellipse cx="' + px + '" cy="' + py + '" rx="' + r * .46 + '" ry="' + r * .36 + '" transform="rotate(' + (rot + i * 72) + ' ' + px + ' ' + py + ')" fill="url(#' + u + '-pet)" stroke="' + THEME.__s + '" stroke-opacity=".38" stroke-width=".3"/>';
    }
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r * .22 + '" fill="#E7C97A" stroke="' + THEME.__s + '" stroke-opacity=".35" stroke-width=".25"/>';
    return s;
  }
  function finish(o, u) { return o + '<circle cx="50" cy="50" r="39" fill="url(#' + u + '-depth)" pointer-events="none"/></svg>'; }
  function plantSVG(type) {
    var t = THEME[type] || THEME.empty;
    THEME.__s = t.s;
    var u = 'h' + (++UID);
    var petalLight = lighten(t.f, .52);
    var leafA = t.leafA || '#788A6D';
    var leafB = t.leafB || '#46563F';
    var glorDef = type === 'gloriosa' ? '<linearGradient id="' + u + '-glor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F5CC72"/><stop offset=".42" stop-color="#E8873F"/><stop offset=".76" stop-color="#C6402E"/><stop offset="1" stop-color="#841E1B"/></linearGradient>' : '';
    var defs = '<defs>' + glorDef +
      '<radialGradient id="' + u + '-pet" cx="38%" cy="28%" r="78%"><stop offset="0" stop-color="' + petalLight + '"/><stop offset=".52" stop-color="' + t.f + '"/><stop offset="1" stop-color="' + t.s + '"/></radialGradient>' +
      '<radialGradient id="' + u + '-petB" cx="40%" cy="34%" r="78%"><stop offset="0" stop-color="' + lighten(t.f, .30) + '"/><stop offset=".55" stop-color="' + t.s + '"/><stop offset="1" stop-color="' + lighten(t.s, .05) + '"/></radialGradient>' +
      '<linearGradient id="' + u + '-leaf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + leafA + '"/><stop offset="1" stop-color="' + leafB + '"/></linearGradient>' +
      '<filter id="' + u + '-soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2"/></filter>' +
      '<radialGradient id="' + u + '-depth" cx="50%" cy="45%" r="55%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></radialGradient>' +
      '<clipPath id="' + u + '-clip"><circle cx="50" cy="50" r="39"/></clipPath>' +
    '</defs>';
    var o = '<svg class="plant-svg" viewBox="0 0 100 100" aria-hidden="true">' + defs + '<g clip-path="url(#' + u + '-clip)">' +
      '<circle cx="53" cy="55" r="34" fill="#2F2418" opacity=".22" filter="url(#' + u + '-soft)"/>'+
      '<circle cx="56" cy="58" r="25" fill="#2B1F18" opacity=".18" filter="url(#' + u + '-soft)"/>'+
      '<g filter="url(#' + u + '-soft)"><ellipse cx="47" cy="52" rx="30" ry="27" fill="' + t.f + '" opacity=".14"/><ellipse cx="55" cy="48" rx="19" ry="17" fill="' + t.s + '" opacity=".08"/></g>';
    if (type === 'empty') {
      return o + '<g fill="none" stroke="' + t.s + '" stroke-width=".9" opacity=".55"><path d="M38 58 h24"/><circle cx="43" cy="50" r="1.5"/><circle cx="52" cy="48" r="1.2"/><circle cx="58" cy="54" r="1"/><path d="M50 42 l-5 7 M50 42 l5 7" opacity=".5"/></g></svg>';
    }
    if (type === 'bamboo') {
      o += leaves(u, [-155,-125,-95,-65,-35,-5,25,55], 30, .20, t.s);
      o += '<g fill="none" stroke="' + t.s + '" stroke-width="1.6" opacity=".9"><path d="M42 76 L42 44 M58 70 L58 38"/><path d="M40 58 H44 M40 48 H44 M56 52 H60 M56 42 H60" stroke-width=".7"/></g>';
      return finish(o, u);
    }
    if (type === 'iris') {
      o += leaves(u, [-160,-130,-100,-70,-40,-10,20,50], 26, .14, t.s);
      // three wide falls + three small upright standards
      o += ring(u, 50, 50, 27, 3, 90, false);
      o += ring(u, 50, 50, 12, 3, 30, true);
      for (var ib = 0; ib < 3; ib++) {
        var ia = (90 + ib * 120) * Math.PI / 180;
        var ix = 50 + Math.cos(ia) * 15, iy = 50 + Math.sin(ia) * 15;
        o += '<ellipse cx="' + ix + '" cy="' + iy + '" rx="4.6" ry="2.2" transform="rotate(' + (90 + ib * 120) + ' ' + ix + ' ' + iy + ')" fill="#E3C477" stroke="' + t.s + '" stroke-opacity=".4" stroke-width=".35"/>';
        o += '<path d="M' + (50 + Math.cos(ia) * 8) + ' ' + (50 + Math.sin(ia) * 8) + ' L' + (50 + Math.cos(ia) * 24) + ' ' + (50 + Math.sin(ia) * 24) + '" stroke="' + t.s + '" stroke-opacity=".35" stroke-width=".4"/>';
      }
      o += '<circle cx="50" cy="50" r="2.6" fill="#B8895C" stroke="' + t.s + '" stroke-width=".35"/>';
      return finish(o, u);
    }
    if (type === 'cactus') {
      o += '<circle cx="50" cy="52" r="30" fill="#6F8563" stroke="' + t.s + '" stroke-width=".9"/>';
      for (var c = 0; c < 12; c++) {
        var aa = c * 30 * Math.PI / 180;
        o += '<path d="M' + (50 + Math.cos(aa) * 6) + ' ' + (52 + Math.sin(aa) * 6) + ' L' + (50 + Math.cos(aa) * 28) + ' ' + (52 + Math.sin(aa) * 28) + '" stroke="' + t.s + '" stroke-opacity=".35" stroke-width=".7"/>';
      }
      o += '<g stroke="' + t.s + '" stroke-opacity=".5" stroke-width=".45">' +
        '<path d="M38 40 l-3 -3 M62 40 l3 -3 M35 54 l-3 0 M65 54 l3 0 M40 66 l-2 3 M60 66 l2 3"/>' +
      '</g>';
      o += '<g transform="translate(50 26)">' + ring(u, 0, 0, 9, 6, 0) + '<circle cx="0" cy="0" r="3.2" fill="#B05F45"/></g>';
      return finish(o, u);
    }
    // leafy rosette bases
    var baseAngles = [-168,-140,-112,-84,-56,-28,0,28,56,84,112,140];
    if (type === 'lavender') {
      o += leaves(u, [-160,-130,-100,-70,-40,-10,20,50], 31, .15, t.s);
      for (var l = 0; l < 4; l++) {
        var lx = 50 + (l - 1.5) * 7;
        o += '<path d="M' + lx + ' 72 L' + (lx + (l - 1.5) * 2) + ' 30" stroke="' + t.s + '" stroke-width=".8" stroke-opacity=".8"/>';
        for (var q = 0; q < 7; q++) {
          o += '<circle cx="' + (lx + (l - 1.5) * 2 + (q % 2 ? 2.2 : -2.2)) + '" cy="' + (32 + q * 5) + '" r="2.8" fill="url(#' + u + '-pet)" stroke="' + t.s + '" stroke-opacity=".35" stroke-width=".3"/>';
        }
      }
      return finish(o, u);
    }
    if (type === 'clover' || type === 'rainbowClover') {
      o += leaves(u, [-160,-120,-80,-40,0,40,80,120], 30, .24, t.s);
      // three heart-shaped leaves at centre
      for (var h = 0; h < 3; h++) {
        o += '<g transform="rotate(' + (h * 120) + ' 50 50)"><path d="M50 50 C38 45 35 32 43 27 C48 24 50 30 50 35 C50 30 52 24 57 27 C65 32 62 45 50 50Z" fill="url(#' + u + '-leaf)" stroke="' + t.s + '" stroke-opacity=".55" stroke-width=".55"/></g>';
      }
      o += '<g fill="#F4EEDC" stroke="' + t.s + '" stroke-opacity=".4" stroke-width=".35"><circle cx="46" cy="47" r="2"/><circle cx="52" cy="45" r="2.2"/><circle cx="55" cy="51" r="1.8"/><circle cx="46" cy="54" r="1.7"/><circle cx="51" cy="55" r="2"/></g>';
      if (type === 'rainbowClover') {
        var rb = ['#D8899A','#D9B36A','#8FB18A','#7FA6B8','#A68BB8'];
        for (var rq = 0; rq < 10; rq++) {
          var ra = rq * 36 * Math.PI / 180;
          o += '<circle cx="' + (50 + Math.cos(ra) * (16 + (rq % 3) * 5)) + '" cy="' + (50 + Math.sin(ra) * (16 + (rq % 3) * 5)) + '" r="1.6" fill="' + rb[rq % 5] + '" opacity=".9"/>';
        }
      }
      return finish(o, u);
    }
    if (type === 'lotus' || type === 'nightLotus') {
      o += '<circle cx="50" cy="53" r="29" fill="#6E8066" fill-opacity=".22" stroke="' + t.s + '" stroke-opacity=".35" stroke-width=".6"/>';
      o += ring(u, 50, 50, 26, 12, 0);
      o += ring(u, 50, 50, 20, 9, 22);
      o += ring(u, 50, 50, 12, 7, 10);
      o += ring(u, 50, 50, 6, 5, 20);
      o += '<circle cx="50" cy="50" r="3.5" fill="#C9A35C" stroke="' + t.s + '" stroke-width=".45"/>';
      if (type === 'nightLotus') {
        o += '<path d="M65 30 A8 8 0 1 0 70 42 A6.4 6.4 0 1 1 65 30Z" fill="#EFE3B8" opacity=".9"/>';
        o += star(34, 31, 2.2, '#EFE3B8', .85) + star(29, 62, 1.6, '#EFE3B8', .65) + star(70, 66, 1.4, '#EFE3B8', .55);
        o += '<circle cx="50" cy="50" r="30" fill="' + t.f + '" opacity=".08" filter="url(#' + u + '-soft)"/>';
      }
      return finish(o, u);
    }
    if (type === 'daisy') {
      o += leaves(u, [-160,-130,-100,-70,-40,-10,20,50], 31, .19, t.s);
      o += ring(u, 50, 50, 24, 16, 0, true);
      o += ring(u, 50, 50, 17, 12, 12, true);
      o += '<circle cx="50" cy="50" r="8.2" fill="#D9B45E" stroke="#8C6A30" stroke-width=".6"/>';
      o += '<g fill="#A87C36" opacity=".7"><circle cx="47" cy="47" r=".9"/><circle cx="52" cy="47" r=".8"/><circle cx="49" cy="51" r=".9"/><circle cx="54" cy="52" r=".8"/><circle cx="46" cy="53" r=".8"/><circle cx="51" cy="54" r=".7"/></g>';
      return finish(o, u);
    }
    if (type === 'maple') {
      for (var m = 0; m < 6; m++) {
        var ma = m * 60;
        var ms = .86 + (m % 3) * .10;
        o += '<g transform="rotate(' + ma + ' 50 50) translate(50 50) scale(' + ms + ') translate(-50 -50)">' +
          '<path d="M50 50 L45 40 L35 34 L42 33 L36 24 L46 28 L50 16 L54 28 L64 24 L58 33 L65 34 L55 40 Z" fill="url(#' + u + '-leaf)" stroke="' + t.s + '" stroke-opacity=".6" stroke-width=".55"/>' +
          '<path d="M50 50 L50 22 M50 34 L44 28 M50 34 L56 28" fill="none" stroke="' + t.s + '" stroke-opacity=".38" stroke-width=".4"/>' +
          '<path d="M50 50 L50 58" fill="none" stroke="' + t.s + '" stroke-opacity=".5" stroke-width=".55"/>' +
        '</g>';
      }
      o += '<circle cx="50" cy="50" r="2.4" fill="' + t.s + '" opacity=".7"/>';
      return finish(o, u);
    }
    if (type === 'wheat') {
      for (var w = 0; w < 3; w++) {
        var wx = 42 + w * 8;
        var wt = 25 + Math.abs(w - 1) * 3;
        o += '<path d="M' + wx + ' 80 C' + (wx - 3) + ' 63,' + (wx + 2) + ' 46,' + wx + ' ' + wt + '" fill="none" stroke="' + t.s + '" stroke-opacity=".75" stroke-width=".85"/>';
        for (var g = 0; g < 4; g++) {
          var gy = wt + 5 + g * 7.6;
          o += '<ellipse cx="' + (wx - 3.4) + '" cy="' + gy + '" rx="3.7" ry="2.3" transform="rotate(-40 ' + (wx - 3.4) + ' ' + gy + ')" fill="url(#' + u + '-pet)" stroke="' + t.s + '" stroke-opacity=".4" stroke-width=".3"/>' +
               '<ellipse cx="' + (wx + 3.4) + '" cy="' + (gy + 3.8) + '" rx="3.7" ry="2.3" transform="rotate(40 ' + (wx + 3.4) + ' ' + (gy + 3.8) + ')" fill="url(#' + u + '-pet)" stroke="' + t.s + '" stroke-opacity=".4" stroke-width=".3"/>';
        }
        o += '<path d="M' + wx + ' ' + (wt + 4) + ' L' + (wx - 4) + ' ' + (wt - 9) + ' M' + wx + ' ' + (wt + 4) + ' L' + wx + ' ' + (wt - 11) + ' M' + wx + ' ' + (wt + 4) + ' L' + (wx + 4) + ' ' + (wt - 9) + '" stroke="' + t.s + '" stroke-opacity=".42" stroke-width=".45"/>';
      }
      return finish(o, u);
    }
    // generic rosette leaves
    o += leaves(u, baseAngles.concat([-154,-126,-98,-70,-42,-14,14,42,70,98,126,154]), 30, .22, t.s);
    if (type === 'peony') {
      o += ring(u, 50, 50, 27, 10, 0);
      o += ring(u, 50, 50, 22, 9, 18);
      o += ring(u, 50, 50, 16, 8, 9);
      o += ring(u, 50, 50, 10, 6, 26);
      o += ring(u, 50, 50, 4.5, 5, 12);
      o += ring(u, 32, 40, 5.8, 5, 0);
      o += '<g stroke="#C9A35C" stroke-width=".45" opacity=".85">' + [0,36,72,108,144,180,216,252,288,324].map(function(a){return '<path d="M50 50 L'+(50+Math.cos(a*Math.PI/180)*6)+' '+(50+Math.sin(a*Math.PI/180)*6)+'"/>';}).join('') + '</g><circle cx="50" cy="50" r="1.5" fill="#C9A35C"/>';
      o += spiral(u, 50, 50, 4);
    } else if (type === 'rose' || type === 'flameRose' || type === 'blueRose' || type === 'iceRose') {
      o += ring(u, 50, 50, 25, 9, 0);
      o += ring(u, 50, 50, 20, 8, 24);
      o += ring(u, 50, 50, 14.5, 7, 10);
      o += ring(u, 50, 50, 9, 5, 30);
      o += spiral(u, 50, 50, 5.5);
      o += ring(u, 34, 38, 5.4, 5, 0) + ring(u, 66, 61, 4.4, 5, 18);
      if (type === 'flameRose') {
        o += '<circle cx="50" cy="50" r="31" fill="#E5683F" opacity=".12" filter="url(#' + u + '-soft)"/>';
        o += star(71, 33, 2.6, '#F2C46E', .9) + star(31, 64, 2, '#F2C46E', .7);
        o += '<g fill="#F2C46E" opacity=".8"><circle cx="63" cy="24" r="1"/><circle cx="25" cy="45" r=".8"/><circle cx="49" cy="75" r=".9"/></g>';
      } else if (type === 'blueRose') {
        o += '<g fill="#E2F0F7" opacity=".85"><circle cx="34" cy="39" r="1.4"/><circle cx="66" cy="44" r="1.1"/><circle cx="56" cy="68" r="1.2"/><circle cx="31" cy="58" r=".9"/></g>';
      } else if (type === 'iceRose') {
        o += '<circle cx="50" cy="50" r="29" fill="none" stroke="#EAF6FA" stroke-opacity=".5" stroke-width=".7"/>';
        o += star(30, 32, 2.4, '#F4FBFD', .95) + star(69, 36, 1.9, '#F4FBFD', .85) + star(61, 69, 1.5, '#F4FBFD', .7) + star(33, 64, 1.3, '#F4FBFD', .6);
      }
    } else if (type === 'camellia') {
      o += ring(u, 50, 50, 22, 7, 0);
      o += ring(u, 50, 50, 17, 6, 30);
      o += ring(u, 50, 50, 11, 5, 15);
      o += '<g stroke="#C9A35C" stroke-width=".55" opacity=".9">' +
        [0,45,90,135,180,225,270,315].map(function(ang){return '<path d="M50 50 L'+(50+Math.cos(ang*Math.PI/180)*7)+' '+(50+Math.sin(ang*Math.PI/180)*7)+'"/>';}).join('') +
        '</g><circle cx="50" cy="50" r="2.2" fill="#C9A35C"/>';
    } else if (type === 'sakura') {
      o += ring(u, 50, 50, 21, 5, 0);
      o += ring(u, 50, 50, 14, 5, 36, true);
      o += ring(u, 50, 50, 8, 5, 12, true);
      o += '<circle cx="50" cy="50" r="2.4" fill="#C9A35C"/>';
    } else if (type === 'jasmine') {
      o += ring(u, 50, 50, 20, 5, 0, true);
      o += ring(u, 50, 50, 13.5, 5, 36, true);
      o += ring(u, 50, 50, 8, 5, 12, true);
      o += '<circle cx="50" cy="50" r="3" fill="#C9A35C" stroke="#8A7E60" stroke-width=".4"/>';
    } else if (type === 'tulip') {
      o += ring(u, 50, 50, 23, 6, 0);
      o += ring(u, 50, 50, 17, 6, 30);
      o += ring(u, 50, 50, 9.5, 3, 12);
      o += '<circle cx="50" cy="50" r="4" fill="#8A5B3C" fill-opacity=".55"/>';
    } else if (type === 'lily' || type === 'starLily') {
      o += ring(u, 50, 50, 26, 6, 0, true);
      o += ring(u, 50, 50, 18, 6, 30, true);
      for (var ls = 0; ls < 5; ls++) {
        var la = (ls * 72 - 90) * Math.PI / 180;
        var lx2 = 50 + Math.cos(la) * 13, ly2 = 50 + Math.sin(la) * 13;
        o += '<path d="M50 50 L' + lx2 + ' ' + ly2 + '" stroke="' + t.s + '" stroke-opacity=".55" stroke-width=".55"/>' +
          '<ellipse cx="' + lx2 + '" cy="' + ly2 + '" rx="2.2" ry="1.2" transform="rotate(' + (ls * 72) + ' ' + lx2 + ' ' + ly2 + ')" fill="#C9A35C" stroke="' + t.s + '" stroke-opacity=".35" stroke-width=".3"/>';
      }
      o += '<circle cx="50" cy="50" r="2.6" fill="#D8BC78"/>';
      if (type === 'starLily') {
        o += star(29, 33, 2.4, '#FFFBE8', .95) + star(70, 31, 1.9, '#FFFBE8', .9) + star(66, 68, 1.7, '#FFFBE8', .8) + star(34, 67, 1.4, '#FFFBE8', .65);
        o += '<circle cx="50" cy="50" r="30" fill="#F4ECD0" opacity=".08" filter="url(#' + u + '-soft)"/>';
      }
    } else if (type === 'orchid' || type === 'crystalOrchid') {
      o += ring(u, 50, 50, 21, 5, 0);
      o += ring(u, 50, 50, 15, 5, 36);
      o += '<path d="M50 56 C41 58 37 66 41 73 C45 79 55 79 59 73 C63 66 59 58 50 56Z" fill="url(#' + u + '-petB)" stroke="' + t.s + '" stroke-opacity=".55" stroke-width=".5"/>';
      o += '<ellipse cx="50" cy="50" rx="5.4" ry="4.2" fill="#D8B96C" stroke="' + t.s + '" stroke-opacity=".4" stroke-width=".35"/>';
      o += '<g fill="' + t.s + '" opacity=".55"><circle cx="46" cy="64" r=".9"/><circle cx="52" cy="67" r=".8"/><circle cx="56" cy="63" r=".7"/><circle cx="49" cy="70" r=".7"/></g>';
      if (type === 'crystalOrchid') {
        o += '<g fill="none" stroke="#E7FBFA" stroke-opacity=".55" stroke-width=".45"><path d="M50 50 L33 38 M50 50 L68 41 M50 50 L40 69 M50 50 L60 66"/></g>';
        o += star(30, 33, 2.2, '#E7FBFA', .9) + star(69, 59, 1.7, '#E7FBFA', .8) + star(43, 72, 1.3, '#E7FBFA', .6);
      }
    } else if (type === 'hibiscus') {
      o += ring(u, 50, 50, 24, 5, 0);
      o += ring(u, 50, 50, 17, 5, 36);
      o += '<path d="M50 48 C51 39 55 32 61 27" fill="none" stroke="' + t.s + '" stroke-width=".9" stroke-opacity=".8"/>';
      o += '<circle cx="61" cy="27" r="2.6" fill="#D8B25E" stroke="' + t.s + '" stroke-width=".4"/>';
      o += '<g fill="#D8B25E" opacity=".9"><circle cx="64" cy="24" r="1"/><circle cx="66" cy="29" r=".9"/><circle cx="58" cy="24" r=".8"/></g>';
      o += '<circle cx="50" cy="50" r="4.2" fill="#8C3B34" opacity=".8"/>';
    } else if (type === 'moonFlower') {
      o += ring(u, 50, 50, 26, 6, 0);
      o += ring(u, 50, 50, 19, 6, 30);
      o += ring(u, 50, 50, 12, 5, 10);
      o += '<circle cx="50" cy="50" r="4.4" fill="#D8C98C" stroke="' + t.s + '" stroke-opacity=".4" stroke-width=".4"/>';
      o += '<path d="M67 27 A7.4 7.4 0 1 0 71 39 A6 6 0 1 1 67 27Z" fill="#F2E8BC" opacity=".9"/>';
      o += star(30, 32, 1.9, '#F2E8BC', .85) + star(33, 66, 1.5, '#F2E8BC', .65) + star(69, 62, 1.3, '#F2E8BC', .6);
      o += '<circle cx="50" cy="50" r="31" fill="#E8DDAA" opacity=".09" filter="url(#' + u + '-soft)"/>';
    } else if (type === 'phoenix') {
      o += ring(u, 50, 50, 27, 7, 0, true);
      o += ring(u, 50, 50, 20, 6, 25, true);
      o += ring(u, 50, 50, 13, 5, 10);
      o += '<circle cx="50" cy="50" r="4" fill="#E8B45C" stroke="' + t.s + '" stroke-opacity=".5" stroke-width=".45"/>';
      o += '<g fill="#F0A24E" opacity=".85"><circle cx="31" cy="38" r="1.1"/><circle cx="67" cy="34" r=".9"/><circle cx="70" cy="59" r="1"/><circle cx="29" cy="61" r=".8"/><circle cx="49" cy="24" r=".9"/></g>';
    } else if (type === 'gloriosa') {
      // narrow lanceolate leaves + two curling tendrils
      o += leaves(u, [-165,-138,-111,-84,-57,-30,-3,24,51], 30, .11, t.s);
      o += '<path d="M31 62 C21 60,17 51,23 47 C29 43,35 49,31 54 C28 58,23 55,25 51" fill="none" stroke="' + t.s + '" stroke-opacity=".55" stroke-width=".6" stroke-linecap="round"/>';
      o += '<path d="M69 62 C79 60,83 51,77 47 C71 43,65 49,69 54 C72 58,77 55,75 51" fill="none" stroke="' + t.s + '" stroke-opacity=".55" stroke-width=".6" stroke-linecap="round"/>';
      // six asymmetric, reflexed flame tepals: gold tip -> orange -> crimson base
      var gp = 'M50 50 C47 45,44 41,43 36 C42 33,43.5 30,42.5 27 C41.5 24,43.5 20,43 17 C43 13,46 9,50 8 C51 11,53 13,53 16 C53 19,52 21,53 24 C54 27,56 30,55 34 C54 40,52 46,50 50Z';
      for (var gl = 0; gl < 6; gl++) {
        var gs = .94 + (gl % 3) * .045;
        var gmir = gl % 2 ? ' translate(100 0) scale(-1 1)' : '';
        o += '<g transform="rotate(' + (gl * 60 + (gl % 2 ? 3 : -2)) + ' 50 50) translate(50 50) scale(' + gs + ') translate(-50 -50)' + gmir + '">' +
          '<path d="' + gp + '" fill="url(#' + u + '-glor)" stroke="' + t.s + '" stroke-opacity=".55" stroke-width=".45"/>' +
          '<path d="' + gp + '" fill="none" stroke="#F3C86E" stroke-opacity=".62" stroke-width=".65"/>' +
          '<path d="M50 50 C48 41,46 31,47 20" fill="none" stroke="#F7D98C" stroke-opacity=".5" stroke-width=".45"/>' +
          '<path d="M48 32 C44 30,42 27,41 24 M49 26 C53 24,55 21,56 18" fill="none" stroke="#7A1E1A" stroke-opacity=".25" stroke-width=".35"/>' +
        '</g>';
      }
      // long, curving stamens with prominent anthers
      for (var gst = 0; gst < 7; gst++) {
        var gda = gst * 51.4 + 8;
        var gra = gda * Math.PI / 180;
        var gca = Math.cos(gra), gsa2 = Math.sin(gra);
        var gex = 50 + gca * (34 + (gst % 3) * 2.6), gey = 50 + gsa2 * (34 + (gst % 3) * 2.6);
        var gmx = 50 + gca * 19 - gsa2 * 4, gmy = 50 + gsa2 * 19 + gca * 4;
        o += '<path d="M50 50 Q' + gmx + ' ' + gmy + ' ' + gex + ' ' + gey + '" fill="none" stroke="#D9B06A" stroke-opacity=".9" stroke-width=".85" stroke-linecap="round"/>' +
          '<ellipse cx="' + gex + '" cy="' + gey + '" rx="3.6" ry="1.5" transform="rotate(' + gda + ' ' + gex + ' ' + gey + ')" fill="#C9893C" stroke="#7A3A22" stroke-opacity=".7" stroke-width=".32"/>';
      }
      // green ovary + pollen specks
      o += '<circle cx="50" cy="50" r="4.2" fill="#657E52" stroke="#3F5438" stroke-width=".45"/>' +
        '<g fill="#9AAE76"><circle cx="47.4" cy="48.4" r="1"/><circle cx="52.6" cy="48.8" r=".9"/><circle cx="50" cy="52.8" r=".9"/></g>' +
        '<g fill="#F0C36A" opacity=".8"><circle cx="44" cy="45" r=".7"/><circle cx="56" cy="44" r=".6"/><circle cx="55" cy="56" r=".6"/></g>';
      o += '<circle cx="50" cy="50" r="30" fill="#E5683F" opacity=".07" filter="url(#' + u + '-soft)"/>';
    } else if (type === 'blackDatura') {
      o += leaves(u, [-160,-128,-96,-64,-32,0,32,64,96,128], 30, .19, t.s);
      // five-pointed dark trumpet face
      for (var bd = 0; bd < 5; bd++) {
        o += '<g transform="rotate(' + (bd * 72) + ' 50 50)">' +
          '<path d="M50 50 C43 46,36 37,36 27 C36 20,40 15,46 21 L50 28 L54 21 C60 15,64 20,64 27 C64 37,57 46,50 50Z" fill="url(#' + u + '-pet)" stroke="' + t.s + '" stroke-opacity=".72" stroke-width=".55"/>' +
          '<path d="M50 50 L50 29" stroke="#B79BC4" stroke-opacity=".45" stroke-width=".45"/>' +
          '<path d="M50 50 C46 43,43 35,42 28" fill="none" stroke="#B79BC4" stroke-opacity=".22" stroke-width=".4"/>' +
        '</g>';
      }
      o += '<circle cx="50" cy="50" r="13" fill="#2A1B30" fill-opacity=".88" stroke="' + t.s + '" stroke-width=".55"/>' +
        '<circle cx="50" cy="50" r="8.4" fill="#3B2844" stroke="#8E6E9C" stroke-opacity=".4" stroke-width=".4"/>';
      for (var bds = 0; bds < 5; bds++) {
        var bda = (bds * 72 - 90) * Math.PI / 180;
        var bdx = 50 + Math.cos(bda) * 10, bdy = 50 + Math.sin(bda) * 10;
        o += '<path d="M50 50 L' + bdx + ' ' + bdy + '" stroke="#C9AFCB" stroke-opacity=".55" stroke-width=".5"/>' +
          '<circle cx="' + bdx + '" cy="' + bdy + '" r="1.15" fill="#E3C877" opacity=".85"/>';
      }
      o += '<circle cx="50" cy="50" r="3" fill="#C9A35C"/>' +
        '<circle cx="50" cy="50" r="30" fill="none" stroke="#B79BC4" stroke-opacity=".2" stroke-width=".6"/>';
    } else if (type === 'starflower') {
      o += leaves(u, [-160,-130,-100,-70,-40,-10,20,50], 24, .14, t.s);
      // cluster of forget-me-not-like five-petal blossoms
      var fm = [[50,50,10,0],[37,42,7.5,18],[63,42,7.5,36],[35,60,7,8],[65,59,7,50],[50,33,6,30],[50,67,6,12],[29,50,5.5,44],[71,50,5.5,6]];
      fm.forEach(function (f) { o += forgetMeNot(u, f[0], f[1], f[2], f[3]); });
      o += '<g fill="' + t.s + '" opacity=".5"><circle cx="24" cy="38" r="1"/><circle cx="76" cy="38" r="1"/><circle cx="26" cy="66" r="1"/><circle cx="74" cy="66" r="1"/></g>';
      o += '<circle cx="50" cy="50" r="31" fill="#86A5D0" opacity=".07" filter="url(#' + u + '-soft)"/>';
    } else if (type === 'hydrangea') {
      var pts=[[50,42],[39,50],[61,50],[45,60],[55,60]];
      pts.forEach(function(p){ o += '<g transform="translate('+p[0]+' '+p[1]+')">'+ring(u,0,0,7,4,0,true)+'</g>'; });
    } else if (type === 'sunflower' || type === 'goldSun') {
      o += ring(u, 50, 50, 21, 18, 0, true);
      o += ring(u, 50, 50, 15, 14, 12, true);
      o += '<circle cx="50" cy="50" r="9" fill="#4A382A" stroke="' + t.s + '" stroke-width=".6"/>';
      o += '<g fill="#6B4E2C" opacity=".65"><circle cx="47" cy="47" r="1"/><circle cx="53" cy="47" r=".9"/><circle cx="50" cy="51" r="1"/><circle cx="46" cy="53" r=".8"/><circle cx="54" cy="53" r=".8"/></g>';
      if (type === 'goldSun') {
        o += star(30, 31, 2.3, '#F8E3A0', .9) + star(70, 35, 1.8, '#F8E3A0', .8) + star(67, 67, 1.5, '#F8E3A0', .7);
      }
    } else {
      o += ring(u, 50, 50, 20, 6, 0);
    }
    return finish(o, u);
  }

/* ================= 皮肤交互层 ================= */
var grid = document.getElementById('garden-grid');
var tabsEl = document.getElementById('garden-tabs');
var TYPE_BY_NAME = {};
Object.keys(THEME).forEach(function (k) {
  if (THEME[k] && THEME[k].label) TYPE_BY_NAME[THEME[k].label] = k;
});
TYPE_BY_NAME['晨露玫瑰'] = 'rose';

function ghToast(msg) {
  try {
    var t = document.getElementById('gh-toast');
    if (!t) { t = document.createElement('div'); t.id = 'gh-toast'; t.className = 'gh-toast'; page.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  } catch (e) {}
}
/* ---------- 章节页装饰：图鉴 / 工坊 / 日志 / 成就 ---------- */
var RECIPE_ORDER = ['firstLove', 'passion', 'miss', 'eternal', 'lucky', 'miracle', 'pure', 'noble', 'elegant', 'memory', 'harvest', 'messenger', 'zen', 'phoenixWish'];
var RECIPE_META = {
  firstLove: { need: [['rose', 3], ['daisy', 2]], blooms: ['rose', 'rose', 'rose', 'daisy', 'daisy'] },
  passion: { need: [['rose', 2], ['sunflower', 1]], blooms: ['rose', 'sunflower', 'rose'] },
  miss: { need: [['lavender', 3], ['sakura', 1]], blooms: ['lavender', 'lavender', 'sakura', 'lavender'] },
  eternal: { need: [['tulip', 2], ['camellia', 1]], blooms: ['tulip', 'camellia', 'tulip'] },
  lucky: { need: [['clover', 3], ['daisy', 1]], blooms: ['clover', 'clover', 'daisy', 'clover'] },
  miracle: { need: [['flameRose', 1], ['blueRose', 1]], blooms: ['flameRose', 'blueRose'] },
  pure: { need: [['lily', 2], ['jasmine', 2]], blooms: ['lily', 'jasmine', 'lily', 'jasmine'] },
  noble: { need: [['peony', 2], ['camellia', 1]], blooms: ['peony', 'camellia', 'peony'] },
  elegant: { need: [['orchid', 1], ['lavender', 2]], blooms: ['orchid', 'lavender', 'lavender'] },
  memory: { need: [['maple', 2], ['sakura', 1]], blooms: ['maple', 'sakura', 'maple'] },
  harvest: { need: [['wheat', 2], ['sunflower', 1]], blooms: ['wheat', 'sunflower', 'wheat'] },
  messenger: { need: [['iris', 2], ['lily', 1]], blooms: ['iris', 'lily', 'iris'] },
  zen: { need: [['bamboo', 1], ['lotus', 1]], blooms: ['bamboo', 'lotus'] },
  phoenixWish: { need: [['phoenix', 1], ['flameRose', 1]], blooms: ['phoenix', 'flameRose'] }
};
var BLOOM_FAMILY = {
  lavender: 'spike', wheat: 'spike',
  tulip: 'cup',
  lily: 'star', starLily: 'star', jasmine: 'star', blackDatura: 'star',
  iris: 'fan', orchid: 'fan', crystalOrchid: 'fan', lotus: 'fan', nightLotus: 'fan', gloriosa: 'fan',
  daisy: 'daisy', sunflower: 'daisy', goldSun: 'daisy', starflower: 'daisy',
  clover: 'leaf', rainbowClover: 'leaf', maple: 'leaf', bamboo: 'leaf',
  cactus: 'cactus'
};
function bloomHead(type, cx, cy, r, rot) {
  var t = THEME[type] || THEME.rose;
  var f = t.f, s = t.s, l = lighten(f, .55);
  var fam = BLOOM_FAMILY[type] || 'round';
  var g = '<g transform="translate(' + cx + ' ' + cy + ') rotate(' + rot + ')">';
  var i, a, x, y;
  if (fam === 'daisy') {
    var n = type === 'starflower' ? 5 : 11;
    for (i = 0; i < n; i++) {
      var rr = type === 'starflower' ? r * .72 : r;
      g += '<ellipse cx="0" cy="' + (-rr * .48) + '" rx="' + (rr * .17) + '" ry="' + (rr * .62) + '" transform="rotate(' + (i * 360 / n) + ')" fill="' + f + '" stroke="' + s + '" stroke-opacity=".45" stroke-width=".3"/>';
    }
    g += '<circle r="' + (r * .28) + '" fill="' + (type === 'sunflower' || type === 'goldSun' ? '#6A4827' : '#C79B4F') + '" stroke="' + s + '" stroke-width=".3"/>';
  } else if (fam === 'star') {
    for (i = 0; i < 6; i++) {
      g += '<ellipse cx="0" cy="' + (-r * .50) + '" rx="' + (r * .25) + '" ry="' + (r * .78) + '" transform="rotate(' + (i * 60) + ')" fill="' + f + '" stroke="' + s + '" stroke-opacity=".42" stroke-width=".3"/>';
      g += '<path d="M0 0 L0 ' + (-r * .82) + '" transform="rotate(' + (i * 60) + ')" stroke="#fff" stroke-opacity=".22" stroke-width=".3"/>';
    }
    g += '<circle r="' + (r * .23) + '" fill="#E5C574" stroke="' + s + '" stroke-width=".3"/>';
  } else if (fam === 'fan') {
    for (i = 0; i < 5; i++) {
      a = (i - 2) * 34;
      g += '<path d="M0 0 C' + (-r * .38) + ' ' + (-r * .35) + ',' + (-r * .35) + ' ' + (-r * .92) + ',0 ' + (-r * 1.02) + ' C' + (r * .35) + ' ' + (-r * .92) + ',' + (r * .38) + ' ' + (-r * .35) + ',0 0Z" transform="rotate(' + a + ')" fill="' + f + '" stroke="' + s + '" stroke-opacity=".42" stroke-width=".3"/>';
    }
    g += '<circle r="' + (r * .18) + '" fill="' + l + '" stroke="' + s + '" stroke-width=".3"/>';
  } else if (fam === 'cup') {
    g += '<path d="M0 ' + (r * .55) + ' C' + (-r * .75) + ' ' + (r * .25) + ',' + (-r * .62) + ' ' + (-r * .65) + ',0 ' + (-r * .82) + ' C' + (r * .62) + ' ' + (-r * .65) + ',' + (r * .75) + ' ' + (r * .25) + ',0 ' + (r * .55) + 'Z" fill="' + f + '" stroke="' + s + '" stroke-opacity=".45" stroke-width=".35"/>';
    g += '<path d="M0 ' + (r * .4) + ' C' + (-r * .3) + ' ' + (r * .1) + ',' + (-r * .22) + ' ' + (-r * .55) + ',0 ' + (-r * .72) + ' C' + (r * .22) + ' ' + (-r * .55) + ',' + (r * .3) + ' ' + (r * .1) + ',0 ' + (r * .4) + 'Z" fill="' + l + '" opacity=".65"/>';
  } else if (fam === 'spike') {
    for (i = 0; i < 7; i++) {
      y = -r * .82 + i * (r * .26);
      x = (i % 2 ? 1 : -1) * r * .12;
      g += '<circle cx="' + x + '" cy="' + y + '" r="' + (r * (.24 - i * .012)) + '" fill="' + (i % 2 ? l : f) + '" stroke="' + s + '" stroke-opacity=".35" stroke-width=".25"/>';
    }
    g += '<path d="M0 ' + (r * .45) + ' V' + (-r * .8) + '" stroke="#6C805F" stroke-width=".8"/>';
  } else if (fam === 'leaf') {
    if (type === 'maple') {
      g += '<path d="M0 ' + (r * .7) + ' L0 ' + (-r * .1) + ' L' + (-r * .7) + ' ' + (-r * .2) + ' L' + (-r * .36) + ' ' + (-r * .52) + ' L' + (-r * .58) + ' ' + (-r * .8) + ' L' + (-r * .06) + ' ' + (-r * .6) + ' L0 ' + (-r * 1.05) + ' L' + (r * .06) + ' ' + (-r * .6) + ' L' + (r * .58) + ' ' + (-r * .8) + ' L' + (r * .36) + ' ' + (-r * .52) + ' L' + (r * .7) + ' ' + (-r * .2) + ' L0 ' + (-r * .1) + 'Z" fill="' + f + '" stroke="' + s + '" stroke-opacity=".45" stroke-width=".3"/>';
    } else {
      for (i = 0; i < 3; i++) {
        a = i * 120 - 90;
        g += '<ellipse cx="0" cy="' + (-r * .45) + '" rx="' + (r * .34) + '" ry="' + (r * .62) + '" transform="rotate(' + a + ')" fill="' + f + '" stroke="' + s + '" stroke-opacity=".42" stroke-width=".3"/>';
      }
      g += '<circle r="' + (r * .12) + '" fill="#F2D58E"/>';
    }
  } else if (fam === 'cactus') {
    g += '<ellipse rx="' + (r * .48) + '" ry="' + (r * .78) + '" fill="' + f + '" stroke="' + s + '" stroke-width=".4"/>';
    for (i = 0; i < 7; i++) {
      a = i * 51 * Math.PI / 180;
      g += '<path d="M' + (Math.cos(a) * r * .3) + ' ' + (Math.sin(a) * r * .45) + ' l' + (Math.cos(a) * r * .2) + ' ' + (Math.sin(a) * r * .2) + '" stroke="#F1E9D6" stroke-width=".35" opacity=".7"/>';
    }
  } else {
    for (i = 0; i < 8; i++) {
      a = i * 45 + (type === 'rose' ? 10 : 0);
      g += '<ellipse cx="0" cy="' + (-r * .42) + '" rx="' + (r * .48) + '" ry="' + (r * .75) + '" transform="rotate(' + a + ')" fill="' + (i % 2 ? l : f) + '" fill-opacity="' + (i % 2 ? .78 : 1) + '" stroke="' + s + '" stroke-opacity=".35" stroke-width=".28"/>';
    }
    g += '<circle r="' + (r * .27) + '" fill="' + s + '" opacity=".72"/><circle r="' + (r * .12) + '" fill="' + l + '" opacity=".75"/>';
  }
  return g + '</g>';
}
function bouquetSVG(types) {
  var u = 'bq' + (++UID);
  var list = (types || []).slice(0, 7);
  var pos = [[50, 35, 12, -4], [35, 44, 11, 12], [65, 44, 11, -12], [43, 26, 10, 5], [58, 26, 10, -6], [50, 53, 10, 0], [30, 54, 9, 18], [70, 54, 9, -18]];
  var out = '<svg viewBox="0 0 100 120" aria-hidden="true"><defs>' +
    '<linearGradient id="' + u + '-paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFDF7"/><stop offset=".56" stop-color="#F0E5D1"/><stop offset="1" stop-color="#D9C5A7"/></linearGradient>' +
    '<linearGradient id="' + u + '-ribbon" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#C77F69"/><stop offset="1" stop-color="#985644"/></linearGradient>' +
    '<filter id="' + u + '-soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3"/></filter>' +
    '</defs><ellipse cx="50" cy="111" rx="26" ry="4" fill="#4B3B27" opacity=".16"/>';
  for (var i = 0; i < list.length; i++) {
    var p = pos[i];
    out += '<path d="M50 104 Q' + (50 + (p[0] - 50) * .32) + ' ' + (p[1] + 18) + ' ' + p[0] + ' ' + (p[1] + p[2] * .55) + '" fill="none" stroke="#657A59" stroke-width="1.2" stroke-linecap="round"/>';
    out += '<path d="M' + (50 + (p[0] - 50) * .22) + ' ' + (p[1] + 26) + ' q-7 -2 -9 -8 q7 0 9 8" fill="#7A8C68" opacity=".8"/>';
  }
  out += '<path d="M26 56 L74 56 L61 107 Q50 112 39 107 Z" fill="url(#' + u + '-paper)" stroke="#A68D68" stroke-width=".8"/>' +
    '<path d="M26 56 L50 64 L74 56 L71 62 L50 70 L29 62 Z" fill="#FBF5E9" stroke="#B29A75" stroke-width=".55" opacity=".9"/>' +
    '<path d="M34 68 Q50 74 66 68 M37 79 Q50 84 63 79" fill="none" stroke="#B8A17C" stroke-opacity=".32" stroke-width=".6"/>' +
    '<path d="M33 71 Q50 77 67 71 L65 79 Q50 85 35 79 Z" fill="url(#' + u + '-ribbon)" opacity=".96"/>' +
    '<path d="M50 79 l-5 8 l5 -2.4 l5 2.4 Z" fill="#AE6A56" stroke="#874B3C" stroke-width=".45"/>';
  for (var j = 0; j < list.length; j++) {
    var q = pos[j];
    out += bloomHead(list[j], q[0], q[1], q[2], q[3]);
    if (THEME[list[j]] && THEME[list[j]].rare) {
      out += '<path d="M' + (q[0] + q[2] * .75) + ' ' + (q[1] - q[2] * .8) + ' l1 -3 l1 3 l3 1 l-3 1 l-1 3 l-1 -3 l-3 -1Z" fill="#D6AD62" opacity=".8"/>';
    }
  }
  out += '<g fill="#F4E8C7" opacity=".85"><circle cx="25" cy="45" r="1"/><circle cx="76" cy="48" r="1.1"/><circle cx="31" cy="35" r=".8"/><circle cx="69" cy="31" r=".8"/><circle cx="59" cy="51" r=".7"/></g>';
  out += '<g stroke="#7A8C68" fill="none" stroke-width=".8" opacity=".65"><path d="M29 54 C24 47 26 39 32 35 C34 42 32 49 29 54Z"/><path d="M72 54 C77 47 75 39 69 35 C67 42 69 49 72 54Z"/></g>';
  return out + '</svg>';
}
function unknownSpecimenSVG() {
  return '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 78 C48 60 45 42 50 24 C55 42 52 60 50 78Z" fill="none" stroke="#7C8B70" stroke-width="1.2" opacity=".55"/><path d="M50 58 C38 54 31 43 31 32 C43 36 50 46 50 58Z" fill="#7C8B70" opacity=".14" stroke="#7C8B70" stroke-width=".7"/><path d="M50 50 C60 47 67 38 68 28 C57 31 50 40 50 50Z" fill="#7C8B70" opacity=".11" stroke="#7C8B70" stroke-width=".7"/><circle cx="50" cy="66" r="1.2" fill="#7C8B70" opacity=".5"/><circle cx="44" cy="70" r="1" fill="#7C8B70" opacity=".4"/><circle cx="56" cy="72" r=".9" fill="#7C8B70" opacity=".4"/></svg>';
}
function syncDex() {
  var dex = document.getElementById('garden-dex');
  if (!dex) return;
  var items = dex.querySelectorAll('.garden-dex-item');
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.querySelector('.gh-dex-art')) continue;
    var k = item.getAttribute('data-k');
    var art = document.createElement('span');
    art.className = 'gh-dex-art';
    if (!item.classList.contains('unknown') && k && THEME[k]) {
      art.innerHTML = plantSVG(k).replace('class="plant-svg"', 'class="plant-svg"');
      item.setAttribute('title', THEME[k].latin + ' · ' + THEME[k].label);
      var lang = item.querySelector('.dex-lang');
      if (lang && !lang.textContent.trim()) lang.textContent = THEME[k].latin;
    } else {
      art.innerHTML = unknownSpecimenSVG();
    }
    item.insertBefore(art, item.firstChild);
  }
}
function syncLog() {
  var log = document.getElementById('garden-log');
  if (!log) return;
  var items = log.querySelectorAll('.garden-log-item');
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.getAttribute('data-kind')) continue;
    var txt = item.textContent || '';
    var kind = 'garden';
    if (/工具条点/.test(txt)) kind = 'note';
    else if (/解锁成就/.test(txt)) kind = 'achievement';
    else if (/奖励|稀有种子/.test(txt)) kind = 'reward';
    else if (/^Lv\./.test(txt.replace(/^[★\s]+/, ''))) kind = 'level';
    else if (/来访|访客/.test(txt)) kind = 'visitor';
    item.setAttribute('data-kind', kind);
    if (kind === 'note') item.classList.add('note');
  }
}
function syncCraft() {
  var craft = document.getElementById('garden-craft');
  if (!craft) return;
  var craftTitle = craft.querySelector('.garden-craft-title');
  if (craftTitle && craftTitle.textContent.trim() !== '花艺配方') craftTitle.textContent = '花艺配方';
  var cards = craft.querySelectorAll('.garden-recipe');
  var normalIndex = 0;
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var btn = card.querySelector('.recipe-btn');
    if (!btn) continue;
    var id = btn.getAttribute('data-recipe') || RECIPE_ORDER[normalIndex];
    normalIndex++;
    var meta = RECIPE_META[id];
    if (!meta) continue;
    if (card.getAttribute('data-gh-recipe') !== id) {
      card.setAttribute('data-gh-recipe', id);
      var art = document.createElement('div');
      art.className = 'gh-bouquet';
      art.innerHTML = bouquetSVG(meta.blooms);
      card.insertBefore(art, card.firstChild);
    }
    var rqs = card.querySelectorAll('.recipe-need .rq');
    for (var j = 0; j < rqs.length && j < meta.need.length; j++) {
      var rq = rqs[j];
      if (rq.querySelector('.gh-rq-dot')) continue;
      var m = (rq.textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
      var type = meta.need[j][0];
      rq.innerHTML = '<i class="gh-rq-dot" style="--c:' + (THEME[type] ? THEME[type].f : '#74826B') + '"></i><span>' + (THEME[type] ? THEME[type].label : type) + ' ' + (m ? m[1] + '/' + m[2] : '') + '</span>';
    }
    var label = btn.disabled ? '还差几朵花' : '扎成花束';
    if (btn.textContent !== label) btn.textContent = label;
  }
}
function syncAchv() {
  var box = document.getElementById('garden-achv');
  if (!box) return;
  var items = box.querySelectorAll('.garden-achv-item');
  var done = box.querySelectorAll('.garden-achv-item.done').length;
  var total = items.length;
  var pct = total ? Math.round(done / total * 100) : 0;
  var next = '';
  for (var i = 0; i < items.length; i++) {
    if (!items[i].classList.contains('done')) { next = items[i].getAttribute('title') || ''; break; }
  }
  var head = box.querySelector('.gh-achv-head');
  var sig = done + '/' + total + '/' + next;
  if (!head) {
    head = document.createElement('div');
    head.className = 'gh-achv-head';
    box.insertBefore(head, box.firstChild);
  }
  if (head.getAttribute('data-sig') !== sig) {
    head.setAttribute('data-sig', sig);
    head.innerHTML = '<div class="gh-achv-ring" style="--p:' + pct + '"><b>' + done + '<small>/' + total + '</small></b></div>' +
      '<div class="gh-achv-copy"><h2>园丁荣誉</h2><p>每一枚徽章，都记着花园里发生过的事</p><span class="gh-achv-next">' + (next ? '下一枚：' + next : '全部收集完成') + '</span></div>';
  }
  for (var j = 0; j < items.length; j++) {
    if (items[j].querySelector('.achv-desc')) continue;
    var d = document.createElement('span');
    d.className = 'achv-desc';
    d.textContent = items[j].getAttribute('title') || '';
    items[j].appendChild(d);
  }
}
function syncPanels() {
  syncDex();
  syncLog();
  syncCraft();
  syncAchv();
}

function typeForName(name, empty) {
  if (empty) return 'empty';
  if (TYPE_BY_NAME[name]) return TYPE_BY_NAME[name];
  var keys = Object.keys(TYPE_BY_NAME);
  for (var i = 0; i < keys.length; i++) {
    var lab = THEME[TYPE_BY_NAME[keys[i]]].label;
    if (name && (name.indexOf(lab) >= 0 || lab.indexOf(name) >= 0)) return TYPE_BY_NAME[keys[i]];
  }
  return 'rose';
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function pctOf(el) {
  if (!el) return 0;
  var v = parseFloat(el.style && el.style.width);
  return isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
}
function readPlot(plot) {
  var idx = parseInt(plot.getAttribute('data-idx'), 10);
  var empty = plot.classList.contains('empty') || !plot.querySelector('.garden-plant-name');
  var nameEl = plot.querySelector('.garden-plant-name');
  var stageEl = plot.querySelector('.garden-plant-stage');
  var name = empty ? '空地' : (nameEl ? nameEl.textContent.trim() : '花');
  var stage = empty ? '可种植' : (stageEl ? stageEl.textContent.trim() : '生长中');
  var bloomed = plot.classList.contains('bloomed');
  var wilted = plot.classList.contains('wilted');
  if (!empty && wilted) stage = '已凋谢';
  else if (!empty && bloomed && (stage === '成熟' || !stage)) stage = '可收获';
  return {
    idx: idx, empty: empty, name: name, stage: stage,
    water: pctOf(plot.querySelector('.garden-water-fill')),
    grow: bloomed ? 100 : pctOf(plot.querySelector('.garden-grow-fill')),
    bloomed: bloomed, wilted: wilted, type: typeForName(name, empty)
  };
}
function buildInner(plot, info) {
  var inner = plot.querySelector('.gh-inner');
  if (!inner) {
    inner = document.createElement('span');
    inner.className = 'gh-inner';
    plot.appendChild(inner);
  }
  var sig = [info.type, info.name, info.stage, Math.round(info.water), plot.className].join('|');
  if (inner.getAttribute('data-sig') === sig) return;
  inner.setAttribute('data-sig', sig);
  var art = info.empty
    ? '<span class="gh-seed"></span>'
    : plantSVG(info.type).replace('class="plant-svg"', 'class="gh-plant"');
  var tagCls = (info.bloomed && !info.wilted) ? ' class="ready"' : '';
  inner.innerHTML = '<span class="gh-no">' + pad2((isNaN(info.idx) ? 0 : info.idx) + 1) + '</span>' +
    '<span class="gh-pot"><span class="gh-pot-shadow"></span><span class="gh-grain"></span>' + art + '</span>' +
    '<span class="gh-tag"><b>' + info.name + '</b><i' + tagCls + '>' + info.stage + '</i></span>' +
    '<span class="gh-water"><i style="width:' + Math.round(info.water) + '%"></i></span>';
}
function syncAll() {
  if (!grid) return;
  var plots = grid.querySelectorAll('.garden-plot');
  for (var i = 0; i < plots.length; i++) {
    if (plots[i].getAttribute('data-idx') == null) continue;
    buildInner(plots[i], readPlot(plots[i]));
  }
}
function syncChapter() {
  var active = document.querySelector('#garden-tabs .garden-tab.active');
  page.classList.toggle('gh-chapter', !!active && active.getAttribute('data-tab') !== 'garden');
  if (page.classList.contains('gh-chapter')) closeMore();
}

/* ---------- 场景 / 工具台 / 抽屉 ---------- */
var scene = document.createElement('div');
scene.className = 'gh-scene';
scene.innerHTML =
  '<svg class="gh-house" viewBox="0 0 390 280" preserveAspectRatio="xMidYMin slice"><g fill="none" stroke="#555545" stroke-opacity=".10" stroke-width="1">' +
  '<path d="M-20 232 C40 74 152 18 195 18 C238 18 350 74 410 232"/><path d="M22 232 V122 M78 232 V72 M134 232 V38 M195 18 V232 M256 232 V38 M312 232 V72 M368 232 V122"/>' +
  '<path d="M0 232 H390"/><path d="M195 18 L96 232 M195 18 L294 232"/><path d="M78 72 H312" stroke-opacity=".06"/><path d="M40 150 H350" stroke-opacity=".045"/></g></svg>' +
  '<div class="gh-paving"></div><div class="gh-sun"></div>' +
  '<svg class="gh-sprig left" viewBox="0 0 150 260" fill="none" stroke="currentColor" stroke-width=".9"><path d="M72 260 C64 194 58 138 63 70"/><path d="M66 196 C42 180 28 154 26 126 C52 136 66 160 70 186Z" fill="currentColor" fill-opacity=".10"/><path d="M65 168 C92 152 108 124 111 94 C84 104 68 130 65 158Z" fill="currentColor" fill-opacity=".08"/></svg>' +
  '<svg class="gh-sprig right" viewBox="0 0 132 230" fill="none" stroke="currentColor" stroke-width=".9"><path d="M62 230 C72 174 78 120 72 54"/><path d="M70 178 C96 164 110 138 112 108 C86 116 72 142 69 168Z" fill="currentColor" fill-opacity=".08"/><path d="M72 146 C48 134 34 110 32 82 C56 92 70 116 73 136Z" fill="currentColor" fill-opacity=".10"/></svg>' +
  '<div class="gh-grain-layer"></div><div class="gh-frame"></div>';
page.insertBefore(scene, page.firstChild);

var waterSvg = '<svg viewBox="0 0 100 100" aria-hidden="true"><defs>' +
  '<linearGradient id="ghw-body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C7D4BE"/><stop offset=".38" stop-color="#92A68A"/><stop offset="1" stop-color="#5A6D54"/></linearGradient>' +
  '<linearGradient id="ghw-body2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#A9BBA0"/><stop offset="1" stop-color="#62755B"/></linearGradient>' +
  '<linearGradient id="ghw-brass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EFD59D"/><stop offset=".45" stop-color="#C39A5C"/><stop offset="1" stop-color="#7D5A30"/></linearGradient>' +
  '<linearGradient id="ghw-shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF" stop-opacity=".62"/><stop offset="1" stop-color="#FFF" stop-opacity="0"/></linearGradient>' +
  '</defs>' +
  '<ellipse cx="49" cy="91" rx="30" ry="5" fill="#3B3024" opacity=".18"/>' +
  '<ellipse cx="49" cy="90" rx="19" ry="3" fill="#3B3024" opacity=".10"/>' +
  '<path d="M30 51 C30 47 33 44 37 44 H63 C67 44 70 47 70 51 L66 82 C65 88 60 90 54 90 H46 C40 90 35 88 34 82 Z" fill="url(#ghw-body)" stroke="#3D4D38" stroke-width="1.15"/>' +
  '<path d="M35 53 C36 64 36 76 38 85" fill="none" stroke="url(#ghw-shine)" stroke-width="5" stroke-linecap="round"/>' +
  '<path d="M44 88 C48 90 55 90 59 87" fill="none" stroke="#34452F" stroke-opacity=".35" stroke-width=".8" stroke-linecap="round"/>' +
  '<ellipse cx="50" cy="46" rx="21" ry="5.7" fill="#7E9276" stroke="#3D4D38" stroke-width="1.15"/>' +
  '<ellipse cx="50" cy="45.6" rx="17.5" ry="3.7" fill="#B7C6AE" opacity=".68"/>' +
  '<path d="M38 45 C38 24 62 24 62 45" fill="none" stroke="#7A5A30" stroke-width="4.8" stroke-linecap="round"/>' +
  '<path d="M38 45 C38 28 62 28 62 45" fill="none" stroke="url(#ghw-brass)" stroke-width="1.8" stroke-linecap="round"/>' +
  '<path d="M66 55 L78 58 L94 39 L98 44 L78 66 L68 64 Z" fill="url(#ghw-body2)" stroke="#3D4D38" stroke-width="1.05"/>' +
  '<path d="M77 58 L81 59 L96 43 L93 41 Z" fill="#DDE7D2" opacity=".55"/>' +
  '<path d="M64 51 L77 56 L75 65 L62 60 Z" fill="url(#ghw-brass)" stroke="#5E4827" stroke-width="1"/>' +
  '<path d="M66 55 C70 57 72 60 72 64" fill="none" stroke="#F3E1B8" stroke-opacity=".65" stroke-width="1.1"/>' +
  '<ellipse cx="95" cy="40" rx="7.4" ry="3.5" transform="rotate(-40 95 40)" fill="url(#ghw-brass)" stroke="#5E4827" stroke-width="1"/>' +
  '<path d="M98.5 36.5 L101 38.5 M99 43 L101.5 44.5 M92 34.5 L93.5 32" stroke="#EFD59D" stroke-width=".7" stroke-linecap="round" opacity=".7"/>' +
  '<path d="M33 58 H66" stroke="#C39A5C" stroke-width="1.5" opacity=".75"/><path d="M33 59.5 H66" stroke="#F3E1B8" stroke-width=".55" opacity=".5"/>' +
  '<path d="M63 55 C64 69 62 80 60 87" fill="none" stroke="#2F3B2D" stroke-opacity=".24" stroke-width="1"/>' +
  '<path d="M84 32 C84 29 86 27 88 27 C90 27 92 29 92 32 C92 35 88 39 88 39 C88 39 84 35 84 32Z" fill="#9EC4D0" stroke="#5F8794" stroke-width=".55" opacity=".9"/>' +
  '<path d="M80 38 C80 36 81.4 35 82.6 35 C83.8 35 85 36 85 38 C85 40 82.6 42.6 82.6 42.6 C82.6 42.6 80 40 80 38Z" fill="#B8D6DF" stroke="#6E94A0" stroke-width=".45" opacity=".8"/>' +
  '</svg>';
var feedSvg = '<svg viewBox="0 0 100 100" aria-hidden="true"><defs>' +
  '<linearGradient id="ghf-paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF9EC"/><stop offset=".55" stop-color="#EADCC0"/><stop offset="1" stop-color="#CDB68F"/></linearGradient>' +
  '<linearGradient id="ghf-fold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F7EEDB"/><stop offset="1" stop-color="#D8C39D"/></linearGradient>' +
  '<linearGradient id="ghf-brass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EBD09A"/><stop offset="1" stop-color="#916A3A"/></linearGradient>' +
  '</defs>' +
  '<ellipse cx="50" cy="91" rx="26" ry="4.8" fill="#3B3024" opacity=".16"/>' +
  '<path d="M31 36 Q29 29 37 27 H63 Q71 29 69 36 L73 82 Q73 90 65 90 H35 Q27 90 27 82 Z" fill="url(#ghf-paper)" stroke="#7B6648" stroke-width="1.15"/>' +
  '<path d="M31 36 Q35 30 41 33 Q47 37 50 32 Q53 37 59 33 Q65 30 69 36 L67 43 Q50 47 33 43 Z" fill="url(#ghf-fold)" stroke="#7B6648" stroke-width="1"/>' +
  '<path d="M33 42 Q50 46 67 42" fill="none" stroke="#A78B60" stroke-width=".7" stroke-dasharray="1.6 1.7" opacity=".8"/>' +
  '<path d="M36 54 H64 V78 H36 Z" fill="#FCF8EE" stroke="#8B7552" stroke-width=".7"/>' +
  '<path d="M50 73 V59 M50 68 C43 68 39 64 39 58 C46 58 50 62 50 68 M50 64 C57 64 61 60 61 54 C54 54 50 58 50 64" fill="none" stroke="#647A5C" stroke-width="1.1" stroke-linecap="round"/>' +
  '<circle cx="42" cy="81" r="1.1" fill="#8F6E43"/><circle cx="47" cy="84" r="1.3" fill="#A47E4C"/><circle cx="54" cy="82" r="1" fill="#8F6E43"/><circle cx="60" cy="85" r="1.2" fill="#A47E4C"/>' +
  '<path d="M34 48 C34 44 37 42 40 42" fill="none" stroke="#FFFDF7" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>' +
  '<path d="M61 48 H67" stroke="#B08A52" stroke-width="1.2" opacity=".8"/>' +
  '<path d="M68 58 l7 -2 l3 7 l-7 2 Z" fill="url(#ghf-brass)" stroke="#6E4F28" stroke-width=".8"/>' +
  '<path d="M70 59 l4 -1" stroke="#F5E2B8" stroke-width=".5" opacity=".8"/>' +
  '</svg>';
var seedSvg = '<svg viewBox="0 0 100 100" aria-hidden="true"><defs>' +
  '<linearGradient id="ghs-env" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFDF8"/><stop offset=".6" stop-color="#F2E8D4"/><stop offset="1" stop-color="#DCC9A7"/></linearGradient>' +
  '<linearGradient id="ghs-brass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E8CB91"/><stop offset="1" stop-color="#8C673A"/></linearGradient>' +
  '</defs>' +
  '<ellipse cx="50" cy="91" rx="25" ry="4.8" fill="#3B3024" opacity=".16"/>' +
  '<g transform="rotate(-6 50 56)">' +
  '<path d="M33 31 H67 L70 79 Q70 87 62 87 H38 Q30 87 30 79 Z" fill="url(#ghs-env)" stroke="#7E6A4C" stroke-width="1.15"/>' +
  '<path d="M33 31 L50 39 L67 31" fill="none" stroke="#7E6A4C" stroke-width="1"/>' +
  '<path d="M33 31 L50 37 L67 31 L66 41 Q50 47 34 41 Z" fill="#E9DCC4" stroke="#8A7350" stroke-width=".7"/>' +
  '<path d="M37 51 H63 V74 H37 Z" fill="#FFFCF5" stroke="#9A825B" stroke-width=".7"/>' +
  '<path d="M50 71 V57 M50 66 C44 66 41 63 41 58 C47 58 50 61 50 66 M50 63 C56 63 59 60 59 55 C53 55 50 58 50 63" fill="none" stroke="#647A5C" stroke-width="1.1" stroke-linecap="round"/>' +
  '<circle cx="50" cy="53" r="2.2" fill="#C08076"/><circle cx="47" cy="55" r="1.7" fill="#D19A8E"/><circle cx="53" cy="55" r="1.7" fill="#D19A8E"/>' +
  '<path d="M36 44 C36 40 39 38 42 38" fill="none" stroke="#FFF" stroke-opacity=".7" stroke-width="2" stroke-linecap="round"/>' +
  '<path d="M61 28 L66 27 L67 33 L62 34 Z" fill="url(#ghs-brass)" stroke="#6E4F28" stroke-width=".8"/>' +
  '<path d="M63 29 L65 29" stroke="#F5E2B8" stroke-width=".5" opacity=".8"/>' +
  '</g>' +
  '<g fill="#7B5C38" stroke="#5A4127" stroke-width=".45"><ellipse cx="38" cy="86" rx="3.2" ry="1.8" transform="rotate(22 38 86)"/><ellipse cx="50" cy="88" rx="3.4" ry="1.9" transform="rotate(-12 50 88)"/><ellipse cx="61" cy="86" rx="3" ry="1.7" transform="rotate(30 61 86)"/></g>' +
  '</svg>';
var harvestSvg = '<svg viewBox="0 0 100 100" aria-hidden="true"><defs>' +
  '<linearGradient id="ghh-basket" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F0DDB9"/><stop offset=".55" stop-color="#D2B181"/><stop offset="1" stop-color="#A47D50"/></linearGradient>' +
  '<linearGradient id="ghh-linen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFDF6"/><stop offset="1" stop-color="#E8DCC6"/></linearGradient>' +
  '<linearGradient id="ghh-ribbon" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#C77F69"/><stop offset="1" stop-color="#9B5847"/></linearGradient>' +
  '</defs>' +
  '<ellipse cx="50" cy="91" rx="29" ry="5" fill="#3B3024" opacity=".17"/>' +
  '<path d="M29 47 H71 L67 84 Q66 90 59 90 H41 Q34 90 33 84 Z" fill="url(#ghh-basket)" stroke="#755A38" stroke-width="1.15"/>' +
  '<path d="M31 58 Q50 63 69 58 M30 70 Q50 75 70 70" fill="none" stroke="#8E6D43" stroke-width=".8" opacity=".52"/>' +
  '<path d="M38 47 L36 89 M50 47 V90 M62 47 L64 89" stroke="#9C7748" stroke-width=".6" opacity=".35"/>' +
  '<path d="M34 47 Q50 42 66 47 L65 58 Q50 63 35 58 Z" fill="url(#ghh-linen)" stroke="#9A825B" stroke-width=".7"/>' +
  '<path d="M36 47 C36 24 64 24 64 47" fill="none" stroke="#7A5A30" stroke-width="4.4" stroke-linecap="round"/>' +
  '<path d="M36 47 C36 28 64 28 64 47" fill="none" stroke="#D9B87E" stroke-width="1.2" stroke-linecap="round"/>' +
  '<g><path d="M41 43 C38 34 41 29 45 27 C48 32 47 38 44 44Z" fill="#C47D70" stroke="#83544E" stroke-width=".5"/><path d="M46 42 C44 31 48 25 53 24 C55 31 52 38 48 43Z" fill="#DDA093" stroke="#8D5B52" stroke-width=".5"/><path d="M52 43 C53 33 58 29 62 30 C62 37 58 42 54 45Z" fill="#B76C66" stroke="#7D4B47" stroke-width=".5"/><circle cx="50" cy="35" r="2.3" fill="#E8C477"/></g>' +
  '<path d="M40 45 C43 41 46 38 49 36 M52 44 C56 41 59 38 61 35" fill="none" stroke="#61785A" stroke-width="1" stroke-linecap="round"/>' +
  '<path d="M35 54 Q50 59 65 54 L64 60 Q50 65 36 60 Z" fill="url(#ghh-ribbon)" opacity=".9"/>' +
  '<path d="M50 59 l-4 7 l4 -2 l4 2 Z" fill="#B97561" stroke="#8C5141" stroke-width=".45"/>' +
  '<path d="M34 48 C34 45 36 43 39 42" fill="none" stroke="#FFFDF6" stroke-opacity=".7" stroke-width="2" stroke-linecap="round"/>' +
  '</svg>';
var tray = document.createElement('div');
tray.className = 'gh-tray';
tray.innerHTML = '<div class="gh-tray-hint">把工具拖到花盆上</div>' +
  '<button class="gh-tool" data-tool="water" aria-label="水壶：拖到花盆上浇水">' + waterSvg + '<span class="gh-tool-no">浇水</span></button>' +
  '<button class="gh-tool" data-tool="fertilize" aria-label="肥料袋：拖到花盆上施肥">' + feedSvg + '<span class="gh-tool-no">施肥</span></button>' +
  '<button class="gh-tool" data-tool="seed" aria-label="种子袋：拖到空地种植">' + seedSvg + '<span class="gh-tool-no">播种</span></button>' +
  '<button class="gh-tool" data-tool="harvest" aria-label="收获篮：拖到花盆上收获">' + harvestSvg + '<span class="gh-tool-no">收获</span></button>' +
  '<button class="gh-more" id="ghMore" type="button">更多</button>' +
  '<div class="gh-more-menu" id="ghMoreMenu"><button data-more="hybrid">杂交</button><button data-more="waterall">一键浇水</button><button data-more="harvestall">一键收获</button><button data-more="upgrade">升级花盆</button><button data-more="reclaim">开垦</button><button data-more="shrink">收地</button><button data-more="replant">补种</button></div>';
page.appendChild(tray);

var sheetMask = document.createElement('div');
sheetMask.className = 'gh-mask';
sheetMask.id = 'ghMask';
var sheet = document.createElement('section');
sheet.className = 'gh-sheet';
sheet.id = 'ghSheet';
sheet.innerHTML = '<div class="gh-sheet-head"><span>标本 · <b id="ghIdx">000</b></span><button class="gh-sheet-close" id="ghClose" type="button">收起 ×</button></div>' +
  '<div class="gh-specimen"><div class="gh-specimen-art" id="ghArt"></div><div class="gh-specimen-main"><h3 id="ghName"></h3><div class="latin" id="ghLatin"></div><div class="meta" id="ghMeta"></div></div><div class="gh-wheel" id="ghWheel"></div></div>' +
  '<div class="gh-sheet-stats"><div><div class="k">生长进度</div><div class="v"><span id="ghGrow">0</span><small>%</small></div></div><div><div class="k">土壤水分</div><div class="v"><span id="ghWater">0</span><small>%</small></div></div></div>' +
  '<div class="gh-sheet-note" id="ghNote"></div>';
page.appendChild(sheetMask);
page.appendChild(sheet);

var WHEEL = [
  { id: 'water', label: '浇水', svg: '<path d="M12 3S6 10 6 14a6 6 0 0012 0c0-4-6-11-6-11z"/>' },
  { id: 'fertilize', label: '施肥', svg: '<path d="M12 21V9"/><path d="M12 14c-4 0-6-2-6-5 4 0 6 2 6 5z"/><path d="M12 11c4 0 6-2 6-5-4 0-6 2-6 5z"/>' },
  { id: 'harvest', label: '收获', svg: '<path d="M4 11h16l-2 8H6z"/><path d="M8 11V7a4 4 0 018 0v4"/><path d="M9 15h6"/>' },
  { id: 'plant', label: '种植', svg: '<path d="M12 21c0-6 3-9 8-9-1 6-3 9-8 9z"/><path d="M12 21c0-5-3-8-8-8 1 5 3 8 8 8z"/>' },
  { id: 'hybrid', label: '杂交', svg: '<circle cx="9" cy="12" r="5"/><circle cx="15" cy="12" r="5"/><path d="M12 7v10"/>' },
  { id: 'more', label: '更多', svg: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>' }
];
document.getElementById('ghWheel').innerHTML = WHEEL.map(function (w) {
  return '<button type="button" data-act="' + w.id + '" aria-label="' + w.label + '" title="' + w.label + '"><svg viewBox="0 0 24 24">' + w.svg + '</svg></button>';
}).join('');

var suppressSheet = false;
var dragging = false;
function plotByIdx(idx) { return grid ? grid.querySelector('.garden-plot[data-idx="' + idx + '"]') : null; }
function selectPlot(idx) {
  var p = plotByIdx(idx);
  if (!p) return false;
  suppressSheet = true;
  if (!p.classList.contains('selected')) p.click();
  setTimeout(function () { suppressSheet = false; }, 0);
  return true;
}
function clickTool(tool) {
  var btn = document.querySelector('#garden-toolbar [data-tool="' + tool + '"]');
  if (btn) { btn.click(); return true; }
  return false;
}
function applyToolToPlot(tool, idx) {
  if (!selectPlot(idx)) return false;
  return clickTool(tool === 'seed' ? 'plant' : tool);
}

var drag = null;
function startDrag(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (drag) return;
  e.preventDefault();
  var el = e.currentTarget;
  var tool = el.getAttribute('data-tool');
  var ghost = document.createElement('div');
  ghost.className = 'gh-ghost';
  ghost.innerHTML = el.innerHTML;
  ghost.style.left = e.clientX + 'px';
  ghost.style.top = e.clientY + 'px';
  document.body.appendChild(ghost);
  var aura = document.createElement('div');
  aura.className = 'gh-aura gh-aura-' + tool;
  aura.style.left = e.clientX + 'px';
  aura.style.top = e.clientY + 'px';
  document.body.appendChild(aura);
  el.classList.add('dragging');
  drag = { tool: tool, el: el, ghost: ghost, aura: aura, seen: {}, count: 0, startX: e.clientX, startY: e.clientY, moved: false };
  dragging = true;
  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', endDrag, { once: true });
  window.addEventListener('pointercancel', endDrag, { once: true });
}
function moveDrag(e) {
  if (!drag) return;
  drag.ghost.style.left = e.clientX + 'px';
  drag.ghost.style.top = e.clientY + 'px';
  drag.aura.style.left = e.clientX + 'px';
  drag.aura.style.top = e.clientY + 'px';
  if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 5) drag.moved = true;
  if (drag.tool === 'seed') return;
  var under = document.elementFromPoint(e.clientX, e.clientY);
  var plot = under && under.closest ? under.closest('.garden-plot') : null;
  var olds = document.querySelectorAll('.garden-plot.gh-over');
  for (var i = 0; i < olds.length; i++) olds[i].classList.remove('gh-over');
  if (!plot) return;
  plot.classList.add('gh-over');
  var idx = parseInt(plot.getAttribute('data-idx'), 10);
  if (isNaN(idx) || drag.seen[idx]) return;
  drag.seen[idx] = 1;
  drag.count++;
  applyToolToPlot(drag.tool, idx);
  syncAll();
}
function endDrag(e) {
  if (!drag) return;
  var d = drag;
  drag = null;
  dragging = false;
  window.removeEventListener('pointermove', moveDrag);
  d.ghost.remove();
  d.aura.remove();
  d.el.classList.remove('dragging');
  var olds = document.querySelectorAll('.garden-plot.gh-over');
  for (var i = 0; i < olds.length; i++) olds[i].classList.remove('gh-over');
  if (d.tool === 'seed') {
    var under = e && document.elementFromPoint(e.clientX, e.clientY);
    var plot = under && under.closest ? under.closest('.garden-plot') : null;
    if (plot) {
      var idx = parseInt(plot.getAttribute('data-idx'), 10);
      if (!isNaN(idx)) { d.seen[idx] = 1; d.count++; applyToolToPlot('seed', idx); }
    }
  }
  if (d.count > 0) {
    var labels = { water: '浇水', fertilize: '施肥', seed: '种植', harvest: '收获' };
    ghToast(labels[d.tool] + ' · ' + d.count + ' 块花圃');
  } else if (!d.moved) {
    ghToast('把工具拖到花盆上使用');
  }
  setTimeout(syncAll, 60);
}
var toolEls = tray.querySelectorAll('.gh-tool');
for (var ti = 0; ti < toolEls.length; ti++) toolEls[ti].addEventListener('pointerdown', startDrag);

var moreBtn = document.getElementById('ghMore');
var moreMenu = document.getElementById('ghMoreMenu');
function closeMore() { if (moreMenu) moreMenu.classList.remove('open'); }
function openMore() { if (moreMenu) moreMenu.classList.toggle('open'); }
if (moreBtn) moreBtn.addEventListener('click', function (e) { e.stopPropagation(); openMore(); });
if (moreMenu) moreMenu.addEventListener('click', function (e) {
  var b = e.target.closest('button[data-more]');
  if (!b) return;
  var act = b.getAttribute('data-more');
  closeMore();
  if ((act === 'hybrid' || act === 'upgrade') && !document.querySelector('.garden-plot.selected')) {
    ghToast('先点一盆花再使用'); return;
  }
  if (!clickTool(act)) ghToast('这个功能还没准备好');
});
document.addEventListener('click', function (e) {
  if (moreMenu && moreMenu.classList.contains('open') && !e.target.closest('.gh-more') && !e.target.closest('.gh-more-menu')) closeMore();
});

var sheetIdx = -1;
function openSheet(plot) {
  if (!plot) return;
  var info = readPlot(plot);
  sheetIdx = info.idx;
  document.getElementById('ghIdx').textContent = pad2((isNaN(info.idx) ? 0 : info.idx) + 1);
  document.getElementById('ghName').textContent = info.name;
  document.getElementById('ghLatin').textContent = info.empty ? '—' : (THEME[info.type] ? THEME[info.type].latin : '—');
  document.getElementById('ghMeta').innerHTML = info.empty ? '空地 · 可种植' : (info.stage + ' · ' + (info.wilted ? '已凋谢' : info.bloomed ? '可收获' : '生长中'));
  document.getElementById('ghArt').innerHTML = info.empty
    ? '<span class="gh-seed" style="position:relative;left:auto;top:auto;display:block;margin:32px auto;transform:none"></span>'
    : plantSVG(info.type).replace('class="plant-svg"', 'class="gh-plant"');
  document.getElementById('ghGrow').textContent = Math.round(info.grow);
  document.getElementById('ghWater').textContent = Math.round(info.water);
  document.getElementById('ghNote').textContent = info.empty
    ? '这块地还空着，拖种子袋过来，或点轮盘里的种植。'
    : info.wilted ? '已经凋谢了，收下后可以补种一株。'
      : info.bloomed ? '花开得正好，收获后可以做成花束送给 TA。'
        : '慢慢长，别急。';
  page.classList.add('gh-sheet-open');
}
function closeSheet() { page.classList.remove('gh-sheet-open'); }
document.getElementById('ghClose').addEventListener('click', closeSheet);
sheetMask.addEventListener('click', closeSheet);
document.getElementById('ghWheel').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-act]');
  if (!b) return;
  var act = b.getAttribute('data-act');
  if (act === 'more') { closeSheet(); openMore(); return; }
  closeSheet();
  applyToolToPlot(act, sheetIdx);
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeSheet(); closeMore(); } });

function schedule() {
  if (window.__ghPending) return;
  window.__ghPending = true;
  setTimeout(function () { window.__ghPending = false; syncAll(); syncChapter(); syncPanels(); }, 30);
}
if (grid) {
  new MutationObserver(schedule).observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  grid.addEventListener('click', function (e) {
    if (suppressSheet || dragging) return;
    var plot = e.target.closest('.garden-plot');
    if (plot) openSheet(plot);
  });
}
if (tabsEl) {
  tabsEl.addEventListener('click', function () { setTimeout(syncChapter, 0); });
  new MutationObserver(syncChapter).observe(tabsEl, { subtree: true, attributes: true, attributeFilter: ['class'] });
}
new MutationObserver(function () {
  var t = document.getElementById('garden-tabs');
  if (t && t !== tabsEl) { tabsEl = t; t.addEventListener('click', function () { setTimeout(syncChapter, 0); }); }
  schedule();
}).observe(page, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });

(function () {
  var n = page.querySelector('.chat-head .ch-name');
  if (n) n.textContent = '云上花园';
  syncAll();
  syncChapter();
  syncPanels();
})();

})();
