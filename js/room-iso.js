(function () { try {
(function () {
"use strict";
/* 新版小屋接管标记：room.js 见到它就整体早退（本文件在 build.mjs 的 jsFiles 里排在 room.js 之前） */
try { window.__roomIso = 1; } catch (e) {}
'use strict';
/* ================= ISO 坐标引擎（房间尺寸动态） ================= */
const TW2 = 48, TH2 = 24, SLAB = 14; let WH = 150;
let OX = 280, OY = 180, SCENE_W = 640, SCENE_H = 500;
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ICON = {
sun: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19"/></svg>',
moon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13.6A8.2 8.2 0 1 1 10.4 3.8a6.6 6.6 0 0 0 9.6 9.8Z"/></svg>'
};
function layoutRoom(){
WH = Math.min(220, Math.max(100, d.wallH || 150));
const padX = 92, padTop = 30, padBot = 50;
SCENE_W = padX * 2 + (d.cols + d.rows) * TW2;
SCENE_H = padTop + WH + (d.cols + d.rows) * TH2 + padBot;
OX = padX + d.rows * TW2;
OY = padTop + WH;
const sc = document.getElementById('scene');
sc.style.width = SCENE_W + 'px'; sc.style.height = SCENE_H + 'px';
const st = document.getElementById('static');
st.setAttribute('width', SCENE_W); st.setAttribute('height', SCENE_H);
}
function P(gx, gy){ return [OX + (gx - gy) * TW2, OY + (gx + gy) * TH2]; }
function A(x, y){ return P(x + 0.5, y + 0.5); }
function tileFromPoint(px, py){
const dx = px - OX, dy = py - OY;
return { x: Math.floor((dx / TW2 + dy / TH2) / 2), y: Math.floor((dy / TH2 - dx / TW2) / 2) };
}
function lp(u, v){ return [(u - v) * TW2, (u + v) * TH2]; }
function poly(pt, fill, extra){ return '<polygon points="' + pt.map(function(p){ return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '" fill="' + fill + '"' + (extra ? ' ' + extra : '') + '/>'; }
function box(u0, v0, u1, v1, h, c, dy){
dy = dy || 0;
var B = lp(u0, v0), R = lp(u1, v0), F = lp(u1, v1), L = lp(u0, v1);
var Bt = [B[0], B[1] - h - dy], Rt = [R[0], R[1] - h - dy], Ft = [F[0], F[1] - h - dy], Lt = [L[0], L[1] - h - dy];
return poly([L, F, Ft, Lt], c.l) + poly([R, F, Ft, Rt], c.r) + poly([B, R, F, L].map(function(p){ return [p[0], p[1] - h - dy]; }), c.t);
}
/* ================= 数据 ================= */
const KEY = 'room-data';
const KEY_BAK = 'room-data-bak-iso';   // 首次接管旧房间时留一份原始存档
const page = document.getElementById('page-room');
function ST(){ try { return window.activeStore ? window.activeStore() : null; } catch (e) { return null; } }
function backupOnce(){
try {
var s = ST(); if (!s) return;
if (s.get(KEY_BAK)) return;
var raw = s.get(KEY);
if (raw) s.set(KEY_BAK, raw);
} catch (e) {}
}
const LV_TH = [0, 8, 16, 26, 38];
function fresh(){
return {
fx: [
{ i: 'a1', t: 'bed',   x: 4, y: 0, r: 0 },
{ i: 'a2', t: 'shelf', x: 0, y: 0, r: 0 },
{ i: 'a3', t: 'plant', x: 1, y: 1, r: 0 },
{ i: 'a4', t: 'chair',     x: 3, y: 2, r: 0 },
{ i: 'w1', t: 'win_rect',  x: 1, y: 0, r: 0 },
{ i: 'w2', t: 'win_rect',  x: 2, y: 0, r: 0 },
{ i: 'w3', t: 'win_round', x: 4, y: 0, r: 0 }
],
inv: {}, pts: 40, lv: 1, lit: {}, vaseFlower: false,
wall: 'cream', floor: 'wood', night: null, followSys: true, stack: false,
cols: 6, rows: 4, wallH: 150,
walls: { L: { c: '#F7EFE2', a: null }, R: { c: '#EADCC8', a: null }, F1: null, F2: null },
fcells: {}, fcol: '#D9B78F',
look: { skin: '#FFE3CF', hair: '#5B4A68', style: 'short', top: '#8E7CC3', bottom: '#6B5B95', h: 1 },
lookArt: {},
customFurn: {},
ta: { x: 2, y: 1, act: 'idle', tx: 2, ty: 1, nextAt: Date.now() + 8000 }
};
}
function fix(o){
const f = fresh();
['cols','rows'].forEach(function(k){ if (typeof o[k] !== 'number') o[k] = f[k]; });
o.cols = Math.min(10, Math.max(4, Math.round(o.cols)));
o.rows = Math.min(8, Math.max(3, Math.round(o.rows)));
if (Array.isArray(o.winL) || Array.isArray(o.winR)){
(o.winL || []).forEach(function(wd, i){ o.fx.push({ i: 'wm' + i + Date.now().toString(36), t: 'win_' + (wd.s || 'rect'), x: 1, y: 0, r: 0 }); });
(o.winR || []).forEach(function(wd, i){ o.fx.push({ i: 'wn' + i + Date.now().toString(36), t: 'win_' + (wd.s || 'rect'), x: o.cols - 1, y: 0, r: 0 }); });
delete o.winL; delete o.winR;
}
if (!o.look || typeof o.look !== 'object') o.look = f.look;
if (typeof o.look.h !== 'number' || isNaN(o.look.h)) o.look.h = 1;
o.look.h = Math.min(1.35, Math.max(0.75, o.look.h));
if (!o.lookArt || typeof o.lookArt !== 'object') o.lookArt = {};
if (!o.customFurn || typeof o.customFurn !== 'object') o.customFurn = {};
if (typeof o.pts !== 'number') o.pts = f.pts;
if (!Array.isArray(o.fx)) o.fx = f.fx;
if (!o.inv || typeof o.inv !== 'object') o.inv = {};
if (!o.lit || typeof o.lit !== 'object') o.lit = {};
if (!o.hints || typeof o.hints !== 'object') o.hints = {};
if (!o.fcells || typeof o.fcells !== 'object') o.fcells = {};
if (typeof o.fcol !== 'string') o.fcol = '#D9B78F';
o.fx.forEach(function(f){ if (!f.w) f.w = 1; if (!f.d) f.d = 1; f.w = Math.min(3, Math.max(1, Math.round(f.w))); f.d = Math.min(3, Math.max(1, Math.round(f.d))); });
if (typeof o.followSys !== 'boolean') o.followSys = true;
if (typeof o.stack !== 'boolean') o.stack = false;
if (typeof o.wallH !== 'number' || isNaN(o.wallH)) o.wallH = 150;
if (!o.walls || typeof o.walls !== 'object'){
const wp0 = WALLS[o.wall] || WALLS.cream;
o.walls = { L: { c: wp0.wl, a: null }, R: { c: wp0.wr, a: null }, F1: null, F2: null };
}
['L', 'R', 'F1', 'F2'].forEach(function(wid){
if (o.walls[wid] && typeof o.walls[wid] === 'object'){ if (!o.walls[wid].c) o.walls[wid].c = '#F7EFE2'; }
else o.walls[wid] = null;
});
o.wallH = Math.min(220, Math.max(100, o.wallH));
Object.keys(o.lookArt).forEach(function(k){ const a = toArt(o.lookArt[k]); if (a) o.lookArt[k] = a; else delete o.lookArt[k]; });
Object.keys(o.customFurn).forEach(function(k){ const cf = o.customFurn[k]; if (cf && cf.art){ const a = toArt(cf.art); cf.art = a || blankArt(12); } });
return o;
}
let roomLoadUncertain = false;
function roomDataReady(){ try { return !!window.__mochiDataReady; } catch (e) { return true; } }
function roomKeyUnread(){ try { var s = ST(); return !!(s && s.awaitingBigKey && s.awaitingBigKey(KEY)); } catch (e) { return false; } }
function load(){
let raw = null;
try { var s = ST(); raw = s ? s.get(KEY) : null; } catch (e) { raw = null; }
if (raw){
try { var o = JSON.parse(raw); if (o && o.fx){ roomLoadUncertain = false; return fix(o); } } catch (e) {}
}
roomLoadUncertain = !roomDataReady() || roomKeyUnread();
return fix(fresh());
}
function save(){
if (roomLoadUncertain) return;
try { var s = ST(); if (s) s.set(KEY, JSON.stringify(d)); } catch (e) {}
try { if (window.idbSet) window.idbSet(window.activePrefix() + ':' + KEY, JSON.stringify(d)); } catch (e) {}
}
let d;
/* ================= 调色板 ================= */
const WALLS = {
cream: { wl: '#F7EFE2', wr: '#EADCC8', trim: '#D9C2A4' },
dusk:  { wl: '#F2D3BE', wr: '#E3BCA6', trim: '#C99B7E' },
star:  { wl: '#3C406B', wr: '#31355A', trim: '#5A5F94' }
};
const FLOORS = {
wood:   { a: '#E9C99E', b: '#E0BF92', line: '#C9A171' },
checker:{ a: '#F1E8D9', b: '#DCCFB8', line: '#C6B69B' }
};
const WOOD  = { t: '#E9C79F', l: '#D2A276', r: '#B78A5F' };
const WOOD2 = { t: '#D9B78F', l: '#C09A6F', r: '#A37A51' };
const FAB   = { t: '#F6EDE2', l: '#E3D4C3', r: '#D1BFAC' };
const PINK  = { t: '#F4C9C5', l: '#E3B0AC', r: '#CE9A95' };
const PIXEL = ['#2B2B3A','#5B4A68','#8E7CC3','#C7B9E8','#FFE3CF','#F7B8AC','#E86A6A','#F2A56B','#F6D365','#B5E0A0','#7FB069','#5F9E58','#9BD3E8','#5B8DB8','#F5EFE0','#B78A5F'];
const HEXCH = '0123456789ABCDEF';
/* ================= 家具图鉴（程序化 ISO 件） ================= */
const CAT = {
bed:      { n: '木质小床', e: '🛏️', cost: 40, cf: 4, lv: 1, act: '躺一下', draw: function(){
return box(-.45,-.40,.45,.32, 24, WOOD)
+ box(-.45,-.40,.45,-.30, 34, WOOD2, 24)
+ box(-.42,-.38,.42,.30, 9, FAB, 24)
+ box(-.38,-.34,-.06,-.14, 7, { t:'#FFFDF8', l:'#EDE4D6', r:'#DCD1C0' }, 33)
+ box(.04,-.34,.36,-.14, 7, { t:'#FFFDF8', l:'#EDE4D6', r:'#DCD1C0' }, 33)
+ box(-.42,.00,.42,.30, 4, PINK, 29)
+ box(-.45,.24,.45,.32, 14, WOOD2, 24); } },
sofa:     { n: '布艺沙发', e: '🛋️', cost: 36, cf: 3, lv: 1, act: '坐下', draw: function(){
return box(-.40,-.30,.40,.30, 14, PINK)
+ box(-.40,-.30,.40,-.16, 20, PINK, 14)
+ box(-.40,-.28,-.28,.28, 26, PINK)
+ box(.28,-.28,.40,.28, 26, PINK)
+ box(-.26,-.12,-.02,.24, 5, FAB, 14)
+ box(.02,-.12,.26,.24, 5, FAB, 14); } },
chair:    { n: '木椅', e: '🪑', cost: 12, cf: 1, lv: 1, act: '坐下', draw: function(){
return box(-.26,-.24,.26,.24, 12, WOOD)
+ box(-.26,-.24,.26,-.12, 18, WOOD2, 12)
+ box(-.22,-.20,.22,.20, 3, FAB, 12); } },
rug:      { n: '圆地毯', e: '🟫', cost: 15, cf: 1, lv: 2, act: '坐一会', flat: true, draw: function(){
return poly([lp(-.42,-.42),lp(.42,-.42),lp(.42,.42),lp(-.42,.42)].map(function(p){ return [p[0], p[1]-1]; }), '#D89A8E')
+ poly([lp(-.30,-.30),lp(.30,-.30),lp(.30,.30),lp(-.30,.30)].map(function(p){ return [p[0], p[1]-2]; }), '#EFC9BF'); } },
shelf:    { n: '书架', e: '📚', cost: 30, cf: 2, lv: 1, act: '抽本书', draw: function(){
var s = box(-.36,-.26,.36,.26, 92, WOOD2), i, bc = ['#E8A0A8','#9BB8D3','#D9C87F','#A8C6A2','#C7A8D8'];
[22,46,70].forEach(function(h){ s += box(-.38,-.28,.38,.28, 3, WOOD, h); });
for (i = 0; i < 5; i++) s += box(-.32 + i * .13, .16, -.32 + i * .13 + .09, .27, 9 + (i % 3) * 3, { t: bc[i], l: bc[i], r: bc[i] }, 75);
return s; } },
cabinet:  { n: '小柜子', e: '🗄️', cost: 20, cf: 1, lv: 2, act: '整理', draw: function(){
return box(-.30,-.24,.30,.24, 38, WOOD2)
+ '<circle cx="10" cy="-16" r="2" fill="#8A6648"/><circle cx="10" cy="-7" r="2" fill="#8A6648"/>'; } },
desklamp: { n: '台灯', e: '💡', cost: 18, cf: 1, lv: 1, act: '开灯', lamp: true, glowH: 46, draw: function(lit){
return box(-.14,-.14,.14,.14, 4, WOOD2)
+ box(-.025,-.025,.025,.025, 30, { t:'#C4B29A', l:'#AA9678', r:'#93805F' })
+ '<path d="M-16 -30 L16 -30 L23 -14 L-23 -14 Z" fill="' + (lit ? '#FFDA8C' : '#EFE3CC') + '"/>'
+ '<ellipse cx="0" cy="-14" rx="23" ry="5" fill="' + (lit ? '#FFC46A' : '#DDD0B8') + '"/>'; } },
plant:    { n: '小绿植', e: '🌱', cost: 10, cf: 1, lv: 1, act: '浇水', draw: function(){
return box(-.14,-.14,.14,.14, 14, { t:'#D98E6A', l:'#C47A56', r:'#A96647' })
+ '<circle cx="-8" cy="-24" r="9" fill="#7FB069"/><circle cx="7" cy="-29" r="11" fill="#5F9E58"/><circle cx="0" cy="-38" r="8" fill="#8FBE7A"/>'; } },
pot:      { n: '盆栽', e: '🪴', cost: 14, cf: 1, lv: 1, act: '看看它', draw: function(){
return box(-.11,-.11,.11,.11, 10, { t:'#C9B458', l:'#B39E45', r:'#97833A' })
+ '<circle cx="0" cy="-18" r="6" fill="#7FB069"/><circle cx="5" cy="-23" r="4" fill="#5F9E58"/>'; } },
vase:     { n: '花瓶', e: '🏺', cost: 24, cf: 1, lv: 3, act: '插花', draw: function(){
var s = '<path d="M-8 -2 L8 -2 L6 -10 L-6 -10 Z" fill="#9BB8D3"/>'
+ '<path d="M-6 -10 L6 -10 L9 -22 L-9 -22 Z" fill="#8AA8C4"/>';
if (d.vaseFlower) s += '<line x1="0" y1="-22" x2="0" y2="-32" stroke="#5F9E58" stroke-width="1.5"/><circle cx="0" cy="-34" r="4.5" fill="#F2A7B8"/><circle cx="-4" cy="-30" r="3" fill="#F7C6D2"/><circle cx="4" cy="-30" r="3" fill="#F7C6D2"/>';
return s; } },
candle:   { n: '香薰蜡烛', e: '🕯️', cost: 20, cf: 2, lv: 2, act: '点上', lamp: true, glowH: 22, draw: function(lit){
return box(-.12,-.12,.12,.12, 2, WOOD2)
+ box(-.07,-.07,.07,.07, 10, { t:'#F6ECDA', l:'#E6D9C2', r:'#D5C6AC' })
+ (lit ? '<line x1="0" y1="-12" x2="0" y2="-15" stroke="#5A4632" stroke-width="1"/><ellipse class="rv-flame" cx="0" cy="-18" rx="3" ry="4.5" fill="#FFC94D"/><ellipse class="rv-flame" cx="0" cy="-17" rx="1.4" ry="2.4" fill="#FFF3C4"/>' : ''); } },
radio:    { n: '收音机', e: '📻', cost: 26, cf: 2, lv: 2, act: '放音乐', draw: function(){
return box(-.22,-.12,.22,.12, 16, { t:'#C98F6B', l:'#B37854', r:'#96613F' })
+ '<path d="M-11 -18 Q0 -30 11 -18" stroke="#7A4E32" stroke-width="2.5" fill="none"/>'
+ '<circle cx="-7" cy="-19" r="4" fill="#5E4632"/><circle cx="8" cy="-14" r="2.5" fill="#E8DCC0"/>'; } },
kettle:   { n: '热茶壶', e: '☕', cost: 14, cf: 1, lv: 1, act: '泡杯热茶', draw: function(){
return '<ellipse cx="0" cy="-9" rx="12" ry="9" fill="#D9DEE5"/>'
+ '<path d="M-11 -12 L-20 -20 L-16 -23 L-8 -15 Z" fill="#C6CCD6"/>'
+ '<path d="M7 -15 Q19 -24 14 -10" stroke="#B9C0CC" stroke-width="3" fill="none"/>'
+ '<circle cx="0" cy="-19" r="3" fill="#B9C0CC"/>'; } },
clock:    { n: '老座钟', e: '⏰', cost: 22, cf: 1, lv: 2, act: '听一听', draw: function(){
return box(-.16,-.12,.16,.12, 64, WOOD2)
+ '<circle cx="0" cy="-53" r="9" fill="#F5EFDF" stroke="#8A6648" stroke-width="2"/>'
+ '<line x1="0" y1="-53" x2="0" y2="-59" stroke="#5A4632" stroke-width="1.5"/><line x1="0" y1="-53" x2="4" y2="-51" stroke="#5A4632" stroke-width="1.5"/>'
+ '<line x1="0" y1="-44" x2="0" y2="-28" stroke="#C9A84C" stroke-width="1"/><circle cx="0" cy="-26" r="2.5" fill="#C9A84C"/>'; } },
doll:     { n: '玩偶熊', e: '🧸', cost: 16, cf: 1, lv: 1, act: '抱一抱', draw: function(){
return '<ellipse cx="0" cy="-11" rx="10" ry="11" fill="#C89B6D"/>'
+ '<circle cx="0" cy="-27" r="8.5" fill="#C89B6D"/>'
+ '<circle cx="-7" cy="-34" r="3" fill="#B78A5E"/><circle cx="7" cy="-34" r="3" fill="#B78A5E"/>'
+ '<circle cx="0" cy="-25" r="3.6" fill="#E8CBA5"/><circle cx="-3" cy="-29" r="1" fill="#4A3728"/><circle cx="3" cy="-29" r="1" fill="#4A3728"/>'; } },
painting: { n: '挂画', e: '🖼️', cost: 20, cf: 1, lv: 2, act: '看看画', wall: true,
thumb: '<svg viewBox="-24 -30 48 40"><rect x="-18" y="-24" width="36" height="30" rx="2" fill="#B78A5F"/><rect x="-14" y="-20" width="28" height="22" fill="#E8C9A0"/><circle cx="0" cy="-10" r="5" fill="#F2A56B"/></svg>' },
mirror:   { n: '穿衣镜', e: '🪞', cost: 18, cf: 1, lv: 2, act: '照镜子', wall: true,
thumb: '<svg viewBox="-24 -30 48 40"><ellipse cx="0" cy="-9" rx="11" ry="16" fill="#CFE4EE" stroke="#B78A5F" stroke-width="3"/><line x1="-5" y1="-18" x2="3" y2="-4" stroke="#fff" stroke-width="2" opacity=".8"/></svg>' },
win_rect: { n: '矩形窗', e: '🪟', cost: 25, cf: 2, lv: 1, act: '看窗外', wall: true, win: 'rect',
thumb: '<svg viewBox="-24 -30 48 40"><rect x="-19" y="-25" width="38" height="34" rx="3" fill="#FBF6EC"/><rect x="-14" y="-20" width="28" height="24" fill="#BFE3F2"/><line x1="0" y1="-20" x2="0" y2="4" stroke="#FBF6EC" stroke-width="2.5"/><line x1="-14" y1="-8" x2="14" y2="-8" stroke="#FBF6EC" stroke-width="2.5"/><ellipse cx="-5" cy="-14" rx="5" ry="3" fill="#fff"/></svg>' },
win_arch: { n: '拱形窗', e: '🪟', cost: 30, cf: 2, lv: 2, act: '看窗外', wall: true, win: 'arch',
thumb: '<svg viewBox="-24 -30 48 40"><path d="M-19 9 L-19 -12 Q-19 -25 0 -25 Q19 -25 19 -12 L19 9 Z" fill="#FBF6EC"/><path d="M-14 4 L-14 -11 Q-14 -20 0 -20 Q14 -20 14 -11 L14 4 Z" fill="#BFE3F2"/><circle cx="3" cy="-12" r="3.5" fill="#fff"/></svg>' },
win_round:{ n: '圆形窗', e: '🪟', cost: 28, cf: 2, lv: 2, act: '看窗外', wall: true, win: 'round',
thumb: '<svg viewBox="-24 -30 48 40"><circle cx="0" cy="-8" r="17" fill="#FBF6EC"/><circle cx="0" cy="-8" r="12" fill="#BFE3F2"/><circle cx="3" cy="-12" r="3" fill="#fff"/><circle cx="-4" cy="-4" r="2" fill="#fff" opacity=".8"/></svg>' },  door:     { n: '木门', e: '🚪', cost: 26, cf: 2, lv: 1, act: '开合门', wall: true, door: true,
thumb: '<svg viewBox="-24 -30 48 40"><rect x="-13" y="-26" width="26" height="34" rx="2" fill="#FBF6EC"/><rect x="-10" y="-23" width="20" height="31" fill="#C89B6D"/><circle cx="6" cy="-6" r="1.8" fill="#C9A227"/></svg>' }
};
/* 手绘家具类型：t = 'u:' + id，这里合成它的图鉴条目 */
function catOf(t){
if (CAT[t]) return CAT[t];
if (t && t.indexOf('u:') === 0){
const cf = d.customFurn[t.slice(2)];
if (cf){
if (cf.kind === 'asm2') return { n: cf.name, e: '', cost: 0, cf: 1, lv: 1, act: '看看', custom: t.slice(2), asm2: true };
if (cf.kind === 'asm') return { n: cf.name, e: '', cost: 0, cf: 1, lv: 1, act: '看看', custom: t.slice(2), asm: true };
return { n: cf.name, e: '🎨', cost: 0, cf: 1, lv: 1, act: '看看', custom: t.slice(2) };
}
}
return null;
}
const SEATS = ['bed', 'sofa', 'chair', 'rug'];
const LV_CAP = [0, 9, 13, 17, 21, 26];
/* ================= 像素画格式与工具（v3） =================
art = { s: 格数, pal: [用到的颜色...], rows: [s 行，每行 s*2 字符] }
每格 2 字符：'..'=透明，否则是 pal 下标的十六进制（支持 250 色） */
function blankArt(s){ const a = { s: s, pal: [], rows: [] }; for (let i = 0; i < s; i++) a.rows.push('.'.repeat(s * 2)); return a; }
function normColor(c){ return String(c || '').toLowerCase(); }
function colorIdx(art, hex){
hex = normColor(hex);
for (let j = 0; j < art.pal.length; j++){ if (normColor(art.pal[j]) === hex) return j; }
if (art.pal.length >= 250) return -1;
art.pal.push(hex);
return art.pal.length - 1;
}
function artSet(art, r, c, hex){
if (r < 0 || c < 0 || r >= art.s || c >= art.s) return true;
let cell;
if (hex === null || hex === undefined) cell = '..';
else { const i = colorIdx(art, hex); if (i < 0) return false; cell = ('0' + i.toString(16)).slice(-2); }
art.rows[r] = art.rows[r].substr(0, c * 2) + cell + art.rows[r].substr(c * 2 + 2);
return true;
}
function artGet(art, r, c){
if (!art || r < 0 || c < 0 || r >= art.s || c >= art.s) return null;
const row = art.rows && art.rows[r];
if (typeof row !== 'string') return null;
const cell = row.substr(c * 2, 2);
if (cell === '..') return null;
return art.pal[parseInt(cell, 16)] || null;
}
function pixRects(art, x, y, w, h){
let s = ''; const n = art.s, cw = w / n, ch = h / n;
for (let r = 0; r < n; r++){
let c = 0;
while (c < n){
const col = artGet(art, r, c);
if (!col){ c++; continue; }
let c2 = c + 1;
while (c2 < n && artGet(art, r, c2) === col) c2++;
s += '<rect x="' + (x + c * cw).toFixed(2) + '" y="' + (y + r * ch).toFixed(2) + '" width="' + ((c2 - c) * cw + 0.09).toFixed(2) + '" height="' + (ch + 0.09).toFixed(2) + '" fill="' + col + '"/>';
c = c2;
}
}
return s;
}
function shiftArt(art, dx, dy){
const na = blankArt(art.s);
na.pal = art.pal.slice();
for (let r = 0; r < art.s; r++) for (let c = 0; c < art.s; c++){
const col = artGet(art, r, c); if (!col) continue;
artSet(na, r + dy, c + dx, col);
}
art.rows = na.rows;
}
function resizeArt(art, ns){
if (ns === art.s) return art;
const na = blankArt(ns);
na.pal = art.pal.slice(); const m = Math.min(ns, art.s);
for (let r = 0; r < m; r++) for (let c = 0; c < m; c++){ const col = artGet(art, r, c); if (col) artSet(na, r, c, col); }
return na;
}
function toArt(v){ // v2 存档迁移：字符串数组(12, HEXCH 索引 PIXEL) → v3 对象
if (v && v.rows) return v;
if (Array.isArray(v)){
const a = blankArt(12); a.pal = PIXEL.slice();
for (let r = 0; r < 12; r++){
const src = v[r] || '';
let row = '';
for (let c = 0; c < 12; c++){
const i = HEXCH.indexOf(src.charAt(c));
row += i < 0 ? '..' : ('0' + i.toString(16)).slice(-2);
}
a.rows[r] = row;
}
return a;
}
return null;
}
function furnArtSVG(art){
return '<svg viewBox="-40 -80 80 88">'
+ '<ellipse cx="0" cy="-1" rx="24" ry="6" fill="rgba(20,10,40,.22)"/>'
+ '<rect x="-14" y="-8" width="5" height="8" rx="2" fill="#B78A5F"/><rect x="9" y="-8" width="5" height="8" rx="2" fill="#B78A5F"/>'
+ '<rect x="-30" y="-72" width="60" height="64" rx="7" fill="#FFFDF6" stroke="#E2D6C0" stroke-width="2"/>'
+ pixRects(art, -26, -70, 52, 52)
+ '</svg>';
}
/* ================= 台词 ================= */
const FB = {
enter: ['你来了。', '欢迎回来。', '……（好像有谁轻轻应了一声）', '回来啦。'],
greet: ['嗯。', '来了。', '……嗯。（TA回应了一声）', '在呢。'],
near: ['过来了？', '再近一点也可以。', '（TA没有躲开）'],
beside: ['坐吧。', '这里留给你了。', '肩并肩坐着，不说话也很好。'],
look: ['看什么？', '……被你看到了。', '我在看你。一直都在。'],
windowl: ['外面没什么。', '天色还行。', '……在看云。', '下次一起出去走走吧。'],
night: ['夜深了。', '还不睡吗？', '灯留着也行。', '晚安之前，再多待一会儿。'],
lamp: ['灯亮了。', '……是暖的。', '把灯留着吧。'],
water: ['它今天精神不错。', '刚浇过水了。', '……谢谢。'],
music: ['这首？可以。', '（跟着节奏轻轻晃）'],
tea: ['给你倒了一杯。', '小心烫。'],
furnuse: ['这个？偶尔用用。', '……还不错吧。'],
custom: ['这个……是你画的？', '（盯着看了一会儿）很喜欢。', '要把这个摆在家里吗？好呀。']
};
function rnd(a){ return a[Math.floor(Math.random() * a.length)]; }
/* 情境提示：每条只出现一次，全部触发后不再显示 */
function hint(){ /* 底部提示条已移除：它正好压在控制按钮上挡选项（用户反馈）。
调用点保留空实现，各处的「首次提示」不再打搅。 */ }
function ri(a, b){ return a + Math.floor(Math.random() * (b - a + 1)); }
function bubble(t){
const b = document.getElementById('bubble');
if (!t) { b.hidden = true; return; }
const p = A(d.ta.x, d.ta.y);
b.style.left = p[0] + 'px'; b.style.top = (p[1] - 62 * ((d.look && d.look.h) || 1)) + 'px';
b.textContent = t; b.hidden = false;
clearTimeout(b._t); b._t = setTimeout(function(){ b.hidden = true; }, 3600);
}
let toastT = null;
function toast(t){
const el = document.getElementById('toast');
el.textContent = t; el.classList.add('rv-show');
clearTimeout(toastT); toastT = setTimeout(function(){ el.classList.remove('rv-show'); }, 2400);
}
function gainPts(n){
d.pts += n; save(); updHud();
const chip = document.getElementById('chip-pt');   // 状态条收起时没有这一格
if (!chip) return;
const s = document.createElement('span');
s.className = 'rv-r-fly'; s.textContent = '+' + n + '';
chip.appendChild(s); setTimeout(function(){ s.remove(); }, 900);
}
function comfortSum(){ return d.fx.reduce(function(a, it){ const c = catOf(it.t); return a + (c ? c.cf : 0); }, 0); }
function starsOf(){ const c = comfortSum(); let k = 1; LV_TH.forEach(function(t, i){ if (c >= t) k = i + 1; }); return Math.min(5, k); }
function checkLevel(){
const c = comfortSum(); let nl = 1;
LV_TH.forEach(function(t, i){ if (c >= t) nl = i + 1; });
if (nl > d.lv) { d.lv = nl; save(); toast(' 小屋升到 Lv.' + nl + '！'); }
}
/* 时间流逝：清晨 5-8 · 白天 8-17 · 傍晚 17-20 · 夜晚 20-5 */
function dayPhase(){
if (d.followSys) return matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
if (d.night === 'n') return 'night';
if (d.night === 'd') return 'day';
const h = new Date().getHours();
if (h >= 5 && h < 8) return 'dawn';
if (h >= 8 && h < 17) return 'day';
if (h >= 17 && h < 20) return 'dusk';
return 'night';
}
function isNight(){ const p = dayPhase(); return p === 'night' || p === 'dusk'; }
const PHASE_STYLE = {
dawn: { pane: '#F9D8B8', sun: '#FFDFA0' },
day:  { pane: '#BFE3F2', clouds: true },
dusk: { pane: '#D9A2BE', sun: '#F2A56B' },
night:{ pane: '#1B2145', moon: true }
};
function itemAt(x, y){
return d.fx.find(function(f){
return x >= f.x && x < f.x + (f.w || 1) && y >= f.y && y < f.y + (f.d || 1);
}) || null;
}
/* 占格：一件家具覆盖的所有格子 + 能否放下 */
function cellsOf(x, y, w, dd){
const out = [];
for (let cx = x; cx < x + w; cx++) for (let cy = y; cy < y + dd; cy++) out.push([cx, cy]);
return out;
}
function fitsAt(x, y, w, dd, ignoreId){
if (x < 0 || y < 0 || x + w > d.cols || y + dd > d.rows) return false;
if (d.stack) return true; // 设置里开启「允许叠放」后只管边界
return cellsOf(x, y, w, dd).every(function(c){
const it = itemAt(c[0], c[1]);
return !it || it.i === ignoreId;
});
}
function ownedCount(t){ return (d.inv[t] || 0) + d.fx.filter(function(x){ return x.t === t; }).length; }
/* 墙面定义：O 后角原点，b1 指向另一端，n 格数，H 高度 */
function wallDefs(){
const list = [
{ id: 'L',  O: [OX, OY], b1: [P(d.cols, 0)[0] - OX, P(d.cols, 0)[1] - OY], n: d.cols, H: WH, horiz: true },
{ id: 'R',  O: [OX, OY], b1: [P(0, d.rows)[0] - OX, P(0, d.rows)[1] - OY], n: d.rows, H: WH, horiz: false }
];
const H2 = Math.round(WH * 0.45);
if (d.walls.F1) list.push({ id: 'F1', O: P(0, d.rows), b1: [d.cols * TW2, d.cols * TH2], n: d.cols, H: H2, horiz: true, front: true });
if (d.walls.F2) list.push({ id: 'F2', O: P(d.cols, 0), b1: [-d.rows * TW2, d.rows * TH2], n: d.rows, H: H2, horiz: false, front: true });
return list;
}
function wallBase(id, t){
const w = wallDefs().find(function(x){ return x.id === id; });
if (!w) return [OX, OY];
return [w.O[0] + (t / w.n) * w.b1[0], w.O[1] + (t / w.n) * w.b1[1]];
}
/* ================= 静态场景（墙/窗/地板） ================= */
let tileEls = [];
function renderStatic(){
const s = document.getElementById('static');
const fp = FLOORS[d.floor], night = isNight();
const C = [OX, OY], Lend = P(d.cols, 0), Rend = P(0, d.rows);
let h = '';
h += poly([P(0, d.rows), P(d.cols, d.rows), [P(d.cols, d.rows)[0], P(d.cols, d.rows)[1] + SLAB], [P(0, d.rows)[0], P(0, d.rows)[1] + SLAB]], '#A87F55');
h += poly([P(d.cols, 0), P(d.cols, d.rows), [P(d.cols, d.rows)[0], P(d.cols, d.rows)[1] + SLAB], [P(d.cols, 0)[0], P(d.cols, 0)[1] + SLAB]], '#96704A');
tileEls = [];
for (let y = 0; y < d.rows; y++) for (let x = 0; x < d.cols; x++){
const pt = [P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)];
const f = d.fcells[x + ',' + y] || (((x + y) % 2 === 0) ? fp.a : fp.b);
h += '<polygon class="rv-tile" data-x="' + x + '" data-y="' + y + '" points="' + pt.map(function(p){ return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '" fill="' + f + '" stroke="' + fp.line + '" stroke-width="1"/>';
}
let defs = '';
const patFor = function(id, art, ox, oy, bx, by){
if (!art) return '';
return '<pattern id="wpat-' + id + '" width="1" height="1" patternUnits="userSpaceOnUse" patternTransform="matrix(' + bx + ',' + by + ',0,-48,' + ox.toFixed(1) + ',' + oy.toFixed(1) + ')">' + pixRects(art, 0, 0, 1, 1) + '</pattern>';
};
defs += patFor('L', d.walls.L.a, OX, OY, TW2, TH2);
defs += patFor('R', d.walls.R.a, OX, OY, -TW2, TH2);
if (d.walls.F1) defs += patFor('F1', d.walls.F1.a, P(0, d.rows)[0], P(0, d.rows)[1], TW2, TH2);
if (d.walls.F2) defs += patFor('F2', d.walls.F2.a, P(d.cols, 0)[0], P(d.cols, 0)[1], -TW2, TH2);
if (defs) h += '<defs>' + defs + '</defs>';
h += poly([C, Lend, [Lend[0], Lend[1] - WH], [C[0], C[1] - WH]], d.walls.L.a ? 'url(#wpat-L)' : d.walls.L.c);
h += poly([C, Rend, [Rend[0], Rend[1] - WH], [C[0], C[1] - WH]], d.walls.R.a ? 'url(#wpat-R)' : d.walls.R.c);
const trimL = shade(d.walls.L.c, .85), trimR = shade(d.walls.R.c, .85);
h += poly([[C[0], C[1] - WH], [Lend[0], Lend[1] - WH], [Lend[0], Lend[1] - WH + 7], [C[0], C[1] - WH + 7]], trimL);
h += poly([[C[0], C[1] - WH], [Rend[0], Rend[1] - WH], [Rend[0], Rend[1] - WH + 7], [C[0], C[1] - WH + 7]], trimR);
h += poly([C, Lend, [Lend[0], Lend[1] - 9], [C[0], C[1] - 9]], trimL);
h += poly([C, Rend, [Rend[0], Rend[1] - 9], [C[0], C[1] - 9]], trimR);
const H2 = Math.round(WH * 0.45);
if (d.walls.F1){
const A1 = P(0, d.rows), B1 = P(d.cols, d.rows);
h += poly([A1, B1, [B1[0], B1[1] - H2], [A1[0], A1[1] - H2]], d.walls.F1.a ? 'url(#wpat-F1)' : d.walls.F1.c);
h += poly([[A1[0], A1[1] - H2], [B1[0], B1[1] - H2], [B1[0], B1[1] - H2 + 6], [A1[0], A1[1] - H2 + 6]], shade(d.walls.F1.c, .85));
}
if (d.walls.F2){
const A2 = P(d.cols, 0), B2 = P(d.cols, d.rows);
h += poly([A2, B2, [B2[0], B2[1] - H2], [A2[0], A2[1] - H2]], d.walls.F2.a ? 'url(#wpat-F2)' : d.walls.F2.c);
h += poly([[A2[0], A2[1] - H2], [B2[0], B2[1] - H2], [B2[0], B2[1] - H2 + 6], [A2[0], A2[1] - H2 + 6]], shade(d.walls.F2.c, .85));
}
if (decoMode && decoMode.wall){
const w0 = wallDefs().find(function(w){ return w.id === decoMode.wall; });
if (w0){
const e0 = [w0.O[0] + w0.b1[0], w0.O[1] + w0.b1[1]];
h += poly([[w0.O[0], w0.O[1]], e0, [e0[0], e0[1] - w0.H], [w0.O[0], w0.O[1] - w0.H]],
'rgba(138,123,216,.12)', 'stroke="#8A7BD8" stroke-width="3" stroke-dasharray="8 5"');
}
}
function winSVG(wx, wy, horiz, style, ws, hs, bot, frame){
ws = ws || 1; hs = hs || ws; bot = bot || 24 * ws; frame = frame || '#FBF6EC';
const ph = PHASE_STYLE[dayPhase()];
const pane = ph.pane;
const hv = horiz ? [28.8 * ws, 14.4 * ws] : [-28.8 * ws, 14.4 * ws];
const paneH = 72 * hs, top = bot + paneH;
const BL = [wx - hv[0], wy - hv[1] - bot], BR = [wx + hv[0], wy + hv[1] - bot];
const TR = [wx + hv[0], wy + hv[1] - top], TL = [wx - hv[0], wy - hv[1] - top];
const cx = (TL[0] + TR[0] + BL[0] + BR[0]) / 4, cy = (TL[1] + TR[1] + BL[1] + BR[1]) / 4;
let w = '';
if (style === 'round'){
w += '<ellipse cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" rx="' + (29 * ws).toFixed(1) + '" ry="' + (33 * hs).toFixed(1) + '" fill="' + pane + '" stroke="' + frame + '" stroke-width="' + (6 * ws).toFixed(1) + '"/>';
} else if (style === 'arch'){
const c = [(TL[0] + TR[0]) / 2, Math.min(TL[1], TR[1]) - 22 * hs];
w += '<path d="M' + BL[0].toFixed(1) + ' ' + BL[1].toFixed(1) + ' L' + TL[0].toFixed(1) + ' ' + TL[1].toFixed(1)
+ ' Q' + c[0].toFixed(1) + ' ' + c[1].toFixed(1) + ' ' + TR[0].toFixed(1) + ' ' + TR[1].toFixed(1)
+ ' L' + BR[0].toFixed(1) + ' ' + BR[1].toFixed(1) + ' Z" fill="' + pane + '" stroke="' + frame + '" stroke-width="' + (6 * ws).toFixed(1) + '" stroke-linejoin="round"/>';
} else {
w += poly([TL, TR, BR, BL], pane, 'stroke="' + frame + '" stroke-width="' + (6 * ws).toFixed(1) + '" stroke-linejoin="round"');
w += '<line x1="' + cx.toFixed(1) + '" y1="' + (cy - 30 * hs).toFixed(1) + '" x2="' + cx.toFixed(1) + '" y2="' + (cy + 30 * hs).toFixed(1) + '" stroke="' + frame + '" stroke-width="' + (3 * ws).toFixed(1) + '"/>';
w += '<line x1="' + ((TL[0] + TR[0]) / 2).toFixed(1) + '" y1="' + ((TL[1] + TR[1]) / 2).toFixed(1) + '" x2="' + ((BL[0] + BR[0]) / 2).toFixed(1) + '" y2="' + ((BL[1] + BR[1]) / 2).toFixed(1) + '" stroke="' + frame + '" stroke-width="' + (3 * ws).toFixed(1) + '"/>';
}
if (ph.clouds){
w += '<ellipse cx="' + (cx - 8 * ws).toFixed(1) + '" cy="' + (cy - 10 * hs).toFixed(1) + '" rx="' + (9 * ws).toFixed(1) + '" ry="' + (5 * hs).toFixed(1) + '" fill="#fff" opacity=".9"/>';
w += '<ellipse cx="' + (cx + 6 * ws).toFixed(1) + '" cy="' + (cy - 4 * hs).toFixed(1) + '" rx="' + (7 * ws).toFixed(1) + '" ry="' + (4 * hs).toFixed(1) + '" fill="#fff" opacity=".75"/>';
}
if (ph.sun){
w += '<circle cx="' + cx.toFixed(1) + '" cy="' + (cy + 12 * hs).toFixed(1) + '" r="' + (8 * ws).toFixed(1) + '" fill="' + ph.sun + '"/>';
w += '<ellipse cx="' + cx.toFixed(1) + '" cy="' + (cy + 15 * hs).toFixed(1) + '" rx="' + (14 * ws).toFixed(1) + '" ry="' + (3 * hs).toFixed(1) + '" fill="' + ph.sun + '" opacity=".45"/>';
}
if (ph.moon){
w += '<circle cx="' + (cx + 6 * ws).toFixed(1) + '" cy="' + (cy - 12 * hs).toFixed(1) + '" r="' + ((style === 'round' ? 5 : 7) * Math.min(ws, hs)).toFixed(1) + '" fill="#F4EDCB"/>';
w += '<circle cx="' + (cx - 8 * ws).toFixed(1) + '" cy="' + (cy - 18 * hs).toFixed(1) + '" r="' + (1.2 * ws).toFixed(1) + '" fill="#F4EDCB"/><circle cx="' + (cx - 2 * ws).toFixed(1) + '" cy="' + (cy - 4 * hs).toFixed(1) + '" r="' + ws.toFixed(1) + '" fill="#F4EDCB" opacity=".8"/>';
}
if (dayPhase() === 'dawn'){
w += '<path d="M' + (cx - 12 * ws).toFixed(1) + ' ' + (cy - 16 * hs).toFixed(1) + ' q' + (2 * ws).toFixed(1) + ' ' + (-3 * hs).toFixed(1) + ' ' + (4 * ws).toFixed(1) + ' 0 q' + (2 * ws).toFixed(1) + ' ' + (-3 * hs).toFixed(1) + ' ' + (4 * ws).toFixed(1) + ' 0" stroke="#7A6A8A" stroke-width="' + (1.2 * ws).toFixed(1) + '" fill="none"/>';
}
return w;
}
let winSL = 0, winSR = 0, decL = 0, decR = 0, doorL = 0, doorR = 0;
d.fx.forEach(function(f){
const c = catOf(f.t); if (!c || !c.wall) return;
const left = f.x < d.cols / 2;
if (c.door){
const idxD = left ? doorL++ : doorR++;
const maxDT = left ? d.cols - 1.2 : d.rows - 1.2;
const t3 = f.wp ? f.wp.t : Math.min(1.4 + idxD * 2.6, maxDT);
const side3 = f.wp ? f.wp.side : (left ? 'L' : 'R');
const wb3 = wallBase(side3, t3);
h += '<g data-wi="' + f.i + '">' + doorSVG(wb3[0], wb3[1], (side3 === 'L' || side3 === 'F1'), f.sc || 1, !!f.open) + '</g>';
return;
}
if (c.win){
if (f.geo){
const wb = wallBase(f.geo.side, f.geo.t);
const horiz = (f.geo.side === 'L' || f.geo.side === 'F1');
h += '<g data-wi="' + f.i + '">' + winSVG(wb[0], wb[1], horiz, c.win, f.geo.ws, f.geo.hs, f.geo.bot, f.fc) + '</g>';
return;
}
if (f.wp){
const wb = wallBase(f.wp.side, f.wp.t);
const horiz = (f.wp.side === 'L' || f.wp.side === 'F1');
h += '<g data-wi="' + f.i + '">' + winSVG(wb[0], wb[1], horiz, c.win, f.s || 1, f.hs || (f.s || 1), f.bot, f.fc) + '</g>';
return;
}
const idx = left ? winSL++ : winSR++;
const maxT = left ? d.cols - 0.8 : d.rows - 0.8;
const t2 = Math.min(1.1 + idx * 1.8, maxT);
const wb = left ? P(t2, 0) : P(0, t2);
h += '<g data-wi="' + f.i + '">' + winSVG(wb[0], wb[1], left, c.win, f.s || 1, f.hs || (f.s || 1), f.bot, f.fc) + '</g>';
return;
}
let base, up, horiz;
if (f.wp){
base = wallBase(f.wp.side, f.wp.t);
horiz = (f.wp.side === 'L' || f.wp.side === 'F1');
up = horiz ? 88 : 84;
}
else if (left){ base = P(0.7 + decL * 1.4, 0); decL++; up = 88; horiz = true; }
else { base = P(0, 0.8 + decR * 1.4); decR++; up = 84; horiz = false; }
const dw = horiz ? [20, 10] : [-20, 10];
const p = [ [base[0] - dw[0], base[1] - dw[1] - up - 26], [base[0] + dw[0], base[1] + dw[1] - up - 26], [base[0] + dw[0], base[1] + dw[1] - up + 26], [base[0] - dw[0], base[1] - dw[1] - up + 26] ];
let dec = poly(p, '#B78A5F');
const q = p.map(function(pt){ return [base[0] + (pt[0] - base[0]) * .82, base[1] + (pt[1] - base[1]) * .82]; });
dec += poly(q, f.t === 'mirror' ? '#CFE4EE' : (night ? '#3E4A7A' : '#E8C9A0'));
if (f.t === 'mirror') dec += '<line x1="' + (q[3][0] + 4).toFixed(1) + '" y1="' + (q[3][1] - 4).toFixed(1) + '" x2="' + (q[1][0] - 6).toFixed(1) + '" y2="' + (q[1][1] + 8).toFixed(1) + '" stroke="#fff" stroke-width="2" opacity=".7"/>';
else dec += '<circle cx="' + ((q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4).toFixed(1) + '" cy="' + ((q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4 - 4).toFixed(1) + '" r="5" fill="' + (night ? '#F4EDCB' : '#F2A56B') + '"/>';
h += '<g data-wi="' + f.i + '">' + dec + '</g>';
});
s.innerHTML = h;
tileEls = Array.prototype.slice.call(s.querySelectorAll('.rv-tile'));
}
/* ================= 家具层 / 灯光 ================= */
/* 门：墙面上的平行四边形门框 + 门扇（open = 门扇转开） */
function doorSVG(wx, wy, horiz, s, open){
s = s || 1;
const HW = 26 * s, HH = 104 * s;
const ux = horiz ? 1 : -1, uy = 0.5;
const ax = HW * ux, ay = HW * uy;
const bl = [wx - ax, wy - ay], br = [wx + ax, wy + ay];
const tl = [bl[0], bl[1] - HH], tr = [br[0], br[1] - HH];
let g = poly([tl, tr, br, bl], '#F3EADB', 'stroke="#B78A5F" stroke-width="4" stroke-linejoin="round"');
const k = open ? 0.4 : 0.93;
const lx = open ? ux * 0.62 : 0;
const a2x = ax * k, a2y = ay * k;
const c0 = [wx - a2x + lx * ax, wy - a2y + lx * ay];
const c1 = [wx + a2x + lx * ax, wy + a2y + lx * ay];
const c2 = [c1[0], c1[1] - HH * k], c3 = [c0[0], c0[1] - HH * k];
g += poly([c3, c2, c1, c0], open ? '#D9B78F' : '#C89B6D', 'stroke="#8A6648" stroke-width="1.5"');
const hx = (c1[0] + c0[0]) / 2 + ux * 12 * s, hy = (c1[1] + c0[1]) / 2 - HH * k * 0.45;
g += '<circle cx="' + hx.toFixed(1) + '" cy="' + hy.toFixed(1) + '" r="' + (2.4 * s).toFixed(1) + '" fill="#C9A227"/>';
return g;
}
function winSill(inst, dv){
const cur = inst.geo ? (inst.geo.bot || 0) : (inst.bot === undefined ? Math.round(24 * (inst.s || 1)) : inst.bot);
const maxBot = Math.max(14, (d.wallH || 150) - 74);
const v = Math.max(0, Math.min(maxBot, Math.round(cur + dv)));
if (inst.geo) inst.geo.bot = v; else inst.bot = v;
save(); renderAll(); furnMenu(inst);
}
function furnSVG(t, lit){
const c = catOf(t);
if (c && c.asm2) return asm2SVG(d.customFurn[c.custom].parts);
if (c && c.asm) return asmSVG(d.customFurn[c.custom]);
if (c && c.custom) return furnArtSVG(d.customFurn[c.custom].art);
return '<svg viewBox="-64 -150 128 160">' + c.draw(lit) + '</svg>';
}
function renderFurniture(){
const layer = document.getElementById('rv-furn');
layer.innerHTML = '';
d.fx.forEach(function(it){
const c = catOf(it.t); if (!c || c.wall) return;
const el = document.createElement('div');
el.className = 'rv-furn' + (it.r ? ' r-flip' : '');
const fsc = 1 + 0.3 * (((it.w || 1) + (it.d || 1)) / 2 - 1);
el.style.transform = 'translate(-50%,-100%) scale(' + fsc.toFixed(3) + ',' + (fsc * (it.vs || 1)).toFixed(3) + ')';
el.style.transformOrigin = '50% 100%';
const p = A(it.x + ((it.w || 1) - 1) / 2, it.y + ((it.d || 1) - 1) / 2);
el.style.left = p[0] + 'px'; el.style.top = p[1] + 'px';
el.style.zIndex = ((it.x + (it.w || 1) - 1) + (it.y + (it.d || 1) - 1)) * 10 + 5;
el.dataset.i = it.i;
el.innerHTML = furnSVG(it.t, !!d.lit[it.i]);
layer.appendChild(el);
});
renderLights();
}
function renderLights(){
const g = document.getElementById('glows');
g.innerHTML = '';
const lamps = [];
d.fx.forEach(function(it){
const c = catOf(it.t); if (!c || !c.lamp || !d.lit[it.i]) return;
const p = A(it.x, it.y);
const pool = document.createElement('div');
pool.className = 'rv-pool';
pool.style.left = p[0] + 'px'; pool.style.top = (p[1] + 8) + 'px';
pool.style.width = '120px'; pool.style.height = '60px';
g.appendChild(pool);
const halo = document.createElement('div');
halo.className = 'rv-halo';
halo.style.left = p[0] + 'px'; halo.style.top = (p[1] - (c.glowH || 40)) + 'px';
halo.style.width = '54px'; halo.style.height = '54px';
g.appendChild(halo);
lamps.push([p[0], p[1] + 6, 78]);
});
const phase = dayPhase();
const mask = document.getElementById('nightmask');
const maskOn = phase !== 'day';
mask.hidden = !maskOn;
if (maskOn){
mask.style.background = { dawn: 'rgba(70,50,100,.18)', dusk: 'rgba(38,22,50,.38)', night: 'rgba(9,10,34,.52)' }[phase];
const pts = (phase === 'dusk' || phase === 'night') ? lamps.slice() : [];
let wl = 0, wr = 0;
d.fx.forEach(function(f){
const c = catOf(f.t); if (!c || !c.win) return;
if (f.geo){
const p = wallBase(f.geo.side, f.geo.t);
pts.push([p[0], p[1] + 40, 58 * f.geo.ws * f.geo.hs]);
return;
}
const left = f.x < d.cols / 2;
const idx = left ? wl++ : wr++;
const maxT = left ? d.cols - 0.8 : d.rows - 0.8;
const t2 = Math.min(1.1 + idx * 1.8, maxT);
const p = left ? P(t2, 0) : P(0, t2);
pts.push([p[0], p[1] + 40, (left ? 58 : 52) * (f.s || 1)]);
});
const grad = pts.map(function(pnt){
return 'radial-gradient(circle ' + pnt[2] + 'px at ' + pnt[0].toFixed(0) + 'px ' + pnt[1].toFixed(0) + 'px, transparent 0 52%, black 100%)';
});
grad.push('linear-gradient(black,black)');
const mv = grad.join(',');
mask.style.webkitMaskImage = mv;
mask.style.maskImage = mv;
} else { mask.style.background = ''; mask.style.webkitMaskImage = ''; mask.style.maskImage = ''; }
}
/* ================= TA 渲染 v3（分层换装 + 手绘五官 + 身高） =================
图层顺序：后发 → 腿(裤子色) → 手臂 → 上衣(或手绘) → 头 → 发型(预设/手绘) → 五官(预设/手绘)
身高 d.look.h（0.75–1.35）：整体 scale，脚底始终锚定格点 */
function dollSVG(artOv, s, lookOv){
const L = Object.assign({}, d.look || {}, lookOv || {});
const art = Object.assign({}, d.lookArt || {}, artOv || {});
const skin = L.skin || '#FFE3CF', hair = L.hair || '#5B4A68';
const top = L.top || '#8E7CC3', bottom = L.bottom || '#6B5B95';
s = s || L.h || 1;
let t = '<svg viewBox="-24 -60 48 64"><g transform="scale(' + s + ')">';
t += '<ellipse cx="0" cy="-1" rx="13" ry="4.5" fill="rgba(20,10,40,.22)"/>';
if (L.style === 'long' && !art.hair) t += '<path d="M-11 -40 Q-14.5 -18 -8 -13 L8 -13 Q14.5 -18 11 -40 Z" fill="' + hair + '"/>';
t += '<rect x="-7" y="-13" width="5.5" height="12" rx="2" fill="' + bottom + '"/><rect x="1.5" y="-13" width="5.5" height="12" rx="2" fill="' + bottom + '"/>';
t += '<rect x="-12" y="-27" width="3.4" height="12" rx="1.7" fill="' + skin + '"/><rect x="8.6" y="-27" width="3.4" height="12" rx="1.7" fill="' + skin + '"/>';
if (art.top){
t += '<path d="M-9 -26 Q0 -33 9 -26 L10 -8 Q0 -3 -10 -8 Z" fill="#DCD3EE"/><rect x="-9" y="-30" width="18" height="7" rx="3.5" fill="#DCD3EE"/>';
t += pixRects(art.top, -11, -34, 22, 22);
} else {
t += '<path d="M-9 -26 Q0 -33 9 -26 L10 -8 Q0 -3 -10 -8 Z" fill="' + top + '"/><rect x="-9" y="-30" width="18" height="7" rx="3.5" fill="' + top + '"/>';
}
if (art.shape){
t += '<rect x="-13" y="-52" width="26" height="26" rx="9" fill="' + skin + '"/>';
t += pixRects(art.shape, -13, -52, 26, 26);
} else {
t += '<circle cx="0" cy="-39" r="10.5" fill="' + skin + '"/>';
}
const cap = '<path d="M-10.5 -40 Q-9 -52 0 -52 Q9 -52 10.5 -40 Q6 -46 0 -46 Q-6 -46 -10.5 -40 Z" fill="' + hair + '"/>';
if (art.hair){
t += pixRects(art.hair, -13, -56, 26, 26);
} else if (L.style === 'twin'){
t += '<circle cx="-11.5" cy="-45" r="4.8" fill="' + hair + '"/><circle cx="11.5" cy="-45" r="4.8" fill="' + hair + '"/>' + cap;
} else if (L.style === 'bun'){
t += '<circle cx="0" cy="-52.5" r="4.2" fill="' + hair + '"/>' + cap;
} else {
t += cap;
if (L.style === 'long'){ t += '<rect x="-12.2" y="-44" width="3.6" height="17" rx="1.8" fill="' + hair + '"/><rect x="8.6" y="-44" width="3.6" height="17" rx="1.8" fill="' + hair + '"/>'; }
}
if (art.face){
t += pixRects(art.face, -8, -47, 16, 16);
} else {
t += '<circle cx="-3.6" cy="-38" r="1.3" fill="#4A3728"/><circle cx="3.6" cy="-38" r="1.3" fill="#4A3728"/>'
+ '<ellipse cx="-6" cy="-34.5" rx="2" ry="1.2" fill="#F7B8AC" opacity=".8"/><ellipse cx="6" cy="-34.5" rx="2" ry="1.2" fill="#F7B8AC" opacity=".8"/>'
+ '<path d="M-1.5 -35.5 Q0 -34.5 1.5 -35.5" stroke="#C97F6E" stroke-width="1" fill="none"/>';
}
t += '</g></svg>';
return t;
}
let _taSvgSig = '', _taSvg = '';
function renderTA(){
const ta = document.getElementById('ta');
if (!ta) return;
const p = A(d.ta.x, d.ta.y);
const h = (d.look && d.look.h) || 1;
ta.style.width = (56 * h) + 'px'; ta.style.height = (66 * h) + 'px';
ta.style.left = p[0] + 'px'; ta.style.top = p[1] + 'px';
ta.style.zIndex = 9999;
const moving = d.ta.x !== d.ta.tx || d.ta.y !== d.ta.ty;
ta.classList.toggle('rv-walking', moving && !RM);
ta.classList.toggle('rv-seated', !moving && (d.ta.act === 'sit' || d.ta.act === 'lie'));
let sig = '';
try { sig = JSON.stringify(d.look || {}) + '|' + JSON.stringify(d.lookArt || {}); } catch (e) { sig = ''; }
if (sig !== _taSvgSig || !ta.firstChild){ _taSvgSig = sig; _taSvg = dollSVG(); ta.innerHTML = _taSvg; }
}
function updHud(){
const cap = LV_CAP[Math.min(d.lv, LV_CAP.length - 1)];
const stars = '★'.repeat(starsOf()) + '<span style="opacity:.35">' + '☆'.repeat(5 - starsOf()) + '</span>';
let chips = '<span class="rv-seg-p"> Lv.' + d.lv + '</span>';
if (!d.hudMin){
chips += '<span class="rv-seg-p">' + stars + '</span>'
+ '<span class="rv-seg-p" id="chip-pt">' + d.pts + ' 点</span>'
+ '<span class="rv-seg-p">家具 ' + d.fx.length + '/' + cap + '</span>'
+ '<span class="rv-seg-p">' + d.cols + '×' + d.rows + '</span>';
}
const hud = document.getElementById('hud');
if (hud){
hud.classList.toggle('rv-mini', !!d.hudMin);
hud.innerHTML = '<button class="rv-hud-toggle" id="hud-toggle" title="收起 / 展开状态">' + (d.hudMin ? '▸' : '▾') + '</button>'
+ '<div class="rv-statbar">' + chips + '</div>';
}
const dn = document.getElementById('daynight');
if (dn) dn.innerHTML = isNight() ? ICON.moon : ICON.sun;
}
function renderAll(){
if (page) page.classList.toggle('rv-dark', dayPhase() === 'night');
layoutRoom(); renderStatic(); renderFurniture(); renderTA(); updHud(); fit();
}
/* ================= TA 行为引擎 ================= */
function pickAction(){
const ta = d.ta, night = isNight();
const seats = d.fx.filter(function(f){ return SEATS.indexOf(f.t) >= 0; });
const plants = d.fx.filter(function(f){ return f.t === 'plant' || f.t === 'pot'; });
const others = d.fx.filter(function(f){ const c = catOf(f.t); return c && SEATS.indexOf(f.t) < 0 && !c.wall; });
const W = [['idle', 10], ['walk', 22],
['sit', seats.length ? (night ? 24 : 18) : 0],
['lie', d.fx.some(function(f){ return f.t === 'bed'; }) ? (night ? 12 : 5) : 0],
['plant', plants.length ? 9 : 0],
['winwatch', 10], ['near', night ? 10 : 15],
['use', others.length ? 10 : 0]];
let total = 0; W.forEach(function(x){ total += x[1]; });
let roll = Math.random() * total, act = 'walk';
for (let i = 0; i < W.length; i++){ roll -= W[i][1]; if (roll < 0){ act = W[i][0]; break; } }
let dur = ri(24, 55);
if (act === 'sit'){ const f = rnd(seats); ta.tx = f.x; ta.ty = f.y; }
else if (act === 'lie'){ const f = d.fx.find(function(x){ return x.t === 'bed'; }); ta.tx = f.x; ta.ty = f.y; }
else if (act === 'plant'){ const f = rnd(plants); ta.tx = Math.max(0, Math.min(d.cols - 1, f.x)); ta.ty = Math.min(d.rows - 1, f.y + 1); }
else if (act === 'winwatch'){ ta.tx = Math.random() < 0.5 ? 1 : Math.min(4, d.cols - 1); ta.ty = 0; }
else if (act === 'near'){ ta.tx = ri(1, Math.max(1, d.cols - 2)); ta.ty = ri(Math.max(0, d.rows - 2), d.rows - 1); }
else if (act === 'use'){ const f = rnd(others); ta.tx = Math.max(0, Math.min(d.cols - 1, f.x)); ta.ty = Math.min(d.rows - 1, f.y + 1); }
else if (act === 'walk'){ ta.tx = ri(0, d.cols - 1); ta.ty = ri(0, d.rows - 1); }
else { ta.tx = ta.x; ta.ty = ta.y; }
ta.act = act; ta.nextAt = Date.now() + dur * 1000;
save();
}
let stepTimer = null;
function stepOnce(){
const ta = d.ta;
if (ta.x === ta.tx && ta.y === ta.ty) return;
const dx = ta.tx - ta.x, dy = ta.ty - ta.y;
if (dx && (Math.abs(dx) > Math.abs(dy) || !dy || Math.random() < 0.55)) ta.x += dx > 0 ? 1 : -1;
else if (dy) ta.y += dy > 0 ? 1 : -1;
renderTA();
}
setInterval(function(){
if (document.hidden || !page || page.hidden) {
if (stepTimer){ clearInterval(stepTimer); stepTimer = null; }
return;
}
const moving = d.ta.x !== d.ta.tx || d.ta.y !== d.ta.ty;
if (moving && !stepTimer) stepTimer = setInterval(stepOnce, 700);
if (!moving && stepTimer){ clearInterval(stepTimer); stepTimer = null; }
if (!moving && Date.now() >= d.ta.nextAt) pickAction();
}, 1000);
/* ================= 面板系统 v3（卡片网格 + 分区 + 自定义行） ================= */
function openPanel(title, desc, items, opts){
opts = opts || {};
hint('rv-panel', '右上角 ✕ 关闭面板');
const box = document.getElementById('panelBox');
let h = '<h3>' + title + '</h3><div class="rv-xclose">✕</div>' + (desc ? '<div class="rv-desc">' + desc + '</div>' : '') + (opts.html || '');
if (opts.grid){
h += '<div class="rv-grid' + ((opts.cols || 3) === 1 ? ' rv-rows' : '') + '" style="grid-template-columns:repeat(' + (opts.cols || 3) + ',1fr)">';
items.forEach(function(it, idx){
if (it.sec){ h += '<div class="rv-sec">' + it.sec + '</div>'; return; }
if (it.html){ h += '<div class="rv-line" data-i="' + idx + '">' + it.html + '</div>'; return; }
h += '<button class="rv-card' + (it.dis ? ' rv-dis' : '') + (it.sel ? ' sel' : '') + '" data-i="' + idx + '">'
+ (it.badge ? '<span class="rv-badge">' + it.badge + '</span>' : '')
+ (it.thumb ? '<span class="rv-thumb">' + it.thumb + '</span>' : '')
+ '<span class="rv-lbl">' + it.label + '</span></button>';
});
h += '</div>';
} else {
items.forEach(function(it, idx){
h += '<button class="rv-pill' + (it.dis ? ' rv-dis' : '') + '" data-i="' + idx + '">' + (it.color ? '<i class="rv-sw" style="background:' + it.color + '"></i>' : '') + it.label + '</button>';
});
}
box.innerHTML = h;
document.getElementById('rv-panel').style.display = 'flex';
box.querySelectorAll('[data-i]').forEach(function(b){
b.addEventListener('click', function(){
const it = items[Number(this.dataset.i)];
if (!it || it.dis) return;
if (it.stay){ if (it.cb) it.cb(this); return; }   // 开关类：点了不关面板
closePanel();
if (it.cb) it.cb(this);
});
});
box.querySelector('.rv-xclose').addEventListener('click', closePanel);
if (opts.onReady) opts.onReady(box);
}
function closePanel(){ document.getElementById('rv-panel').style.display = 'none'; }
function openModal2(title, desc, html){
const box = document.getElementById('modal2Box');
box.innerHTML = '<h3>' + title + '</h3><div class="rv-xclose" id="m2close">✕</div>' + (desc ? '<div class="rv-desc">' + desc + '</div>' : '') + html;
document.getElementById('modal2').style.display = 'flex';
document.getElementById('m2close').addEventListener('click', closeModal2);
}
function closeModal2(){ document.getElementById('modal2').style.display = 'none'; }
/* ================= 模式：放置 / 移动 ================= */
let mode = null, suppressClick = 0; // 时间戳：禁用点击判定的截止时刻
function setMode(m, msg){
mode = m; toast(msg); refreshTiles();
hint('place', '绿色格可放 · 红色格被占用 · 点家具取消');
}
function refreshTiles(hot){
tileEls.forEach(function(t){
const x = Number(t.dataset.x), y = Number(t.dataset.y);
const occ = !d.stack && !!itemAt(x, y);
t.classList.toggle('rv-tgt', !!mode && !occ);
t.classList.toggle('rv-bad', !!mode && occ);
t.classList.toggle('rv-hot', !mode && !!hot && hot.x === x && hot.y === y);
});
}
/* ================= 家具交互 ================= */
function furnMenu(inst){
const c = catOf(inst.t);
const items = [];
if (!c.wall){
items.push({ label: c.act || '使用', cb: function(){ useFurniture(inst); } });
} else if (c.door){
items.push({ label: inst.open ? '关上门' : '打开门', cb: function(){
inst.open = !inst.open; save(); renderAll(); furnMenu(inst);
} });
items.push({ label: '换到另一边墙', cb: function(){
const cur = (inst.wp && inst.wp.side) || 'L';
const nx = (cur === 'L') ? 'R' : (cur === 'R') ? 'L' : 'L';
inst.wp = { side: nx, t: 1.4 };
save(); renderAll(); furnMenu(inst);
} });
items.push({ label: '加宽门', cb: function(){ inst.sc = Math.min(1.8, (inst.sc || 1) + 0.1); save(); renderAll(); furnMenu(inst); } });
items.push({ label: '收窄门', cb: function(){ inst.sc = Math.max(0.7, (inst.sc || 1) - 0.1); save(); renderAll(); furnMenu(inst); } });
} else if (c.win){
items.push({ label: '看窗外', cb: function(){
bubble(isNight() ? rnd(FB.night) : rnd(FB.windowl)); gainPts(1);
} });
items.push({ label: '换样式（矩形→拱形→圆形）', cb: function(){
const seq = ['win_rect', 'win_arch', 'win_round'];
inst.t = seq[(seq.indexOf(inst.t) + 1) % 3];
save(); renderAll(); toast('换好了：' + catOf(inst.t).n);
} });
items.push({ label: '加宽窗户', cb: function(){
if (inst.geo) inst.geo.ws = Math.min(3, inst.geo.ws + 0.15);
else inst.s = Math.min(1.9, (inst.s || 1) + 0.15);
save(); renderAll(); furnMenu(inst);
} });
items.push({ label: '收窄窗户', cb: function(){
if (inst.geo) inst.geo.ws = Math.max(0.5, inst.geo.ws - 0.15);
else inst.s = Math.max(0.6, (inst.s || 1) - 0.15);
save(); renderAll(); furnMenu(inst);
} });
items.push({ label: '加高窗户', cb: function(){
if (inst.geo) inst.geo.hs = Math.min(2, inst.geo.hs + 0.15);
else inst.hs = Math.min(2, (inst.hs || inst.s || 1) + 0.15);
save(); renderAll(); furnMenu(inst);
} });
items.push({ label: '窗台高一点', cb: function(){ winSill(inst, 10); } });
items.push({ label: '窗台低一点', cb: function(){ winSill(inst, -10); } });
items.push({ label: '减矮窗户', cb: function(){
if (inst.geo) inst.geo.hs = Math.max(0.5, inst.geo.hs - 0.15);
else inst.hs = Math.max(0.6, (inst.hs || inst.s || 1) - 0.15);
save(); renderAll(); furnMenu(inst);
} });
FRAME_COLORS.forEach(function(col){
items.push({ label: '', color: col, cb: function(){
inst.fc = col; save(); renderAll(); furnMenu(inst);
} });
});
} else {
items.push({ label: c.act, cb: function(){
bubble(inst.t === 'mirror' ? '（镜子里的 TA 冲你笑了笑）' : '画的是很久以前的一个下午。'); gainPts(1);
} });
}
if (c.custom && !c.asm) items.push({ label: c.asm2 ? ' 重新组装' : ' 重画这件家具', cb: function(){
if (c.asm2) openAssembler2(c.custom); else openStudio({ kind: 'rv-furn', id: c.custom });
} });
if (!c.wall) items.push({ label: '移动', cb: function(){ setMode({ kind: 'move', i: inst.i }, '点一块空地放下它'); } });
if (!c.wall) items.push({ label: '翻转', cb: function(){ inst.r = inst.r ? 0 : 1; save(); renderFurniture(); } });
if (c.wall) items.push({ label: '换到另一面墙', cb: function(){
inst.x = inst.x < d.cols / 2 ? (d.cols - 1) : 1;
save(); renderAll();
} });
if (!c.wall){
const grow = function(key, dv){
const cur = inst[key] || 1;
const nv = Math.min(3, Math.max(1, cur + dv));
if (nv === cur) return;
let nx = inst.x, ny = inst.y;
if (key === 'w' && nx + nv > d.cols) nx = d.cols - nv;
if (key === 'd' && ny + nv > d.rows) ny = d.rows - nv;
if (!fitsAt(nx, ny, key === 'w' ? nv : (inst.w || 1), key === 'd' ? nv : (inst.d || 1), inst.i)){
toast('周围空间不够，放不下更大尺寸'); return;
}
inst[key] = nv; inst.x = nx; inst.y = ny;
checkLevel(); save(); renderAll(); furnMenu(inst);
};
items.push({ label: '占格 · 加宽', cb: function(){ grow('w', 1); } });
items.push({ label: '占格 · 减宽', cb: function(){ grow('w', -1); } });
items.push({ label: '占格 · 加长', cb: function(){ grow('d', 1); } });
items.push({ label: '占格 · 减短', cb: function(){ grow('d', -1); } });
items.push({ label: '变高', cb: function(){
inst.vs = Math.min(1.8, (inst.vs || 1) + 0.15);
save(); renderAll(); furnMenu(inst);
} });
items.push({ label: '变矮', cb: function(){
inst.vs = Math.max(0.6, (inst.vs || 1) - 0.15);
save(); renderAll(); furnMenu(inst);
} });
}
items.push({ label: '收回仓库', cb: function(){
d.fx = d.fx.filter(function(x){ return x.i !== inst.i; });
d.inv[inst.t] = (d.inv[inst.t] || 0) + 1;
delete d.lit[inst.i];
if (d.ta.x >= inst.x && d.ta.x < inst.x + (inst.w || 1) && d.ta.y >= inst.y && d.ta.y < inst.y + (inst.d || 1)){
d.ta.tx = ri(0, d.cols - 1); d.ta.ty = ri(0, d.rows - 1);
}
checkLevel(); save(); renderAll();
toast('已收回：' + c.n);
} });
const sz = c.wall ? '' : ' · 占格 ' + (inst.w || 1) + '×' + (inst.d || 1) + ' · 高 ' + Math.round((inst.vs || 1) * 100) + '%';
openPanel(c.n, '舒适度 +' + c.cf + sz, items);
}
function useFurniture(inst){
const c = catOf(inst.t);
if (c.lamp){
const on = !d.lit[inst.i];
if (on) d.lit[inst.i] = true; else delete d.lit[inst.i];
save(); renderFurniture();
bubble(on ? (isNight() ? '灯亮起来了，房间一下子软了。' : '亮着也很好看。') : '关掉灯，安静了一会儿。');
gainPts(1);
return;
}
const map = { plant: 'water', pot: 'water', vase: 'water', radio: 'music', kettle: 'tea', doll: 'furnuse', shelf: 'furnuse', cabinet: 'furnuse', clock: 'furnuse', rug: 'beside', bed: 'beside', sofa: 'beside', chair: 'beside' };
if (inst.t === 'vase' && !d.vaseFlower && Math.random() < 0.5){
d.vaseFlower = true; save(); renderFurniture();
bubble('插上了一支刚开的花。🌸'); gainPts(1); return;
}
bubble(c.custom ? rnd(FB.custom) : rnd(FB[map[inst.t]] || FB.furnuse));
gainPts(1);
if (Math.hypot(d.ta.x - inst.x, d.ta.y - inst.y) <= 1.6 && Math.random() < 0.45){
d.ta.tx = inst.x; d.ta.ty = Math.min(d.rows - 1, inst.y + 1);
d.ta.act = 'use'; d.ta.nextAt = Date.now() + ri(20, 40) * 1000; save();
}
}
function taMenu(){
openPanel('TA', '', [
{ label: '打招呼', v: 'g', cb: function(){ bubble(rnd(FB.greet)); gainPts(1); } },
{ label: '靠近', v: 'n', cb: function(){
d.ta.tx = Math.max(0, Math.min(d.cols - 1, d.ta.x + (d.ta.x > d.cols / 2 ? -1 : 1)));
d.ta.ty = Math.max(0, Math.min(d.rows - 1, d.ta.y + (Math.random() < 0.5 ? -1 : 1)));
d.ta.nextAt = Date.now() + ri(20, 40) * 1000; save();
bubble(rnd(FB.near)); gainPts(1);
} },
{ label: '坐到旁边', v: 'b', cb: function(){ bubble(rnd(FB.beside)); gainPts(1); } },
{ label: '看看TA', v: 'l', cb: function(){ bubble(rnd(FB.look)); gainPts(1); } }
]);
}
/* ================= 仓库 / 商店（卡片网格；挂墙件带缩略图） ================= */
function furnThumb(t, lit){
const c = catOf(t);
if (c && c.asm2) return furnSVG(t);
if (c && c.asm) return furnSVG(t);
if (c && c.custom) return furnArtSVG(d.customFurn[c.custom].art);
if (c && c.thumb) return c.thumb;
if (c && c.flat) return furnSVG(t, !!lit);
return furnSVG(t, !!lit).replace('viewBox="-64 -150 128 160"', 'viewBox="-46 -112 92 120"');
}
function artThumb(a){
if (a) return '<svg viewBox="-1 -1 14 14" style="background:#f2eef9;border-radius:6px;width:44px;height:44px">' + pixRects(a, 0, 0, 12, 12) + '</svg>';
return '<svg viewBox="0 0 44 44" style="width:44px;height:44px"><circle cx="22" cy="22" r="15" fill="#f2eef9"/><text x="22" y="29" font-size="18" text-anchor="middle" fill="#8a80a0">＋</text></svg>';
}
function invMenu(){
const cap = LV_CAP[Math.min(d.lv, LV_CAP.length - 1)];
const items = [{ label: '兑换新家具', badge: '', thumb: '<span style="font-size:32px"></span>', cb: shopMenu }];
Object.keys(d.inv).forEach(function(t){
if (d.inv[t] > 0 && catOf(t)) items.push({ label: catOf(t).n, badge: '×' + d.inv[t], thumb: furnThumb(t), cb: function(){
if (d.fx.length >= cap){ toast('小屋快满啦，先收回一件吧'); return; }
const c = catOf(t);
if (c.wall){
const walls = d.fx.filter(function(f){ const fc = catOf(f.t); return fc && fc.wall; });
const leftN = walls.filter(function(f){ return f.x < d.cols / 2; }).length;
const hangLeft = leftN * 2 <= walls.length;
d.fx.push({ i: 'f' + Date.now().toString(36) + ri(100, 999), t: t, x: hangLeft ? 1 : (d.cols - 1), y: 0, r: 0 });
d.inv[t]--; checkLevel(); save(); renderAll();
toast('挂到' + (hangLeft ? '左' : '右') + '墙了：' + c.n);
} else setMode({ kind: 'place', t: t }, '放置：' + c.n + ' —— 点一块地板');
} });
});
openPanel('家具仓（已摆 ' + d.fx.length + '/' + cap + '）', items.length > 1 ? '点卡片开始摆放' : '仓库空空的，去兑换或画一件吧', items, { grid: true });
}
function shopMenu(){
const items = [];
Object.keys(CAT).forEach(function(t){
const c = CAT[t];
if (ownedCount(t) >= 2) return;
const lock = c.lv > d.lv;
items.push({ label: c.n, badge: lock ? 'Lv.' + c.cost : c.cost + '', thumb: furnThumb(t), dis: lock || d.pts < c.cost, cb: function(){
d.pts -= c.cost; d.inv[t] = (d.inv[t] || 0) + 1;
save(); updHud(); toast('已放进仓库：' + c.n); setTimeout(invMenu, 0);
} });
});
openPanel('兑换家具（有 ' + d.pts + '）', '窗户、挂画也是家具；手绘/组装家具在「自绘」免费做', items, { grid: true });
}
/* ================= 房间：摇杆尺寸 + 装扮（窗户已归入家具） ================= */
function resizeRoom(dc, dr, quiet){
const nc = Math.min(10, Math.max(4, d.cols + dc)), nr = Math.min(8, Math.max(3, d.rows + dr));
if (nc === d.cols && nr === d.rows){ if (!quiet) toast('已到尺寸极限（宽 4–10，深 3–8）'); return; }
decoSnap();
d.cols = nc; d.rows = nr;
d.fx = d.fx.filter(function(f){
if (f.x < nc && f.y < nr) return true;
d.inv[f.t] = (d.inv[f.t] || 0) + 1; delete d.lit[f.i]; return false;
});
['x','tx'].forEach(function(k){ d.ta[k] = Math.min(d.ta[k], nc - 1); });
['y','ty'].forEach(function(k){ d.ta[k] = Math.min(d.ta[k], nr - 1); });
save(); renderAll();
const js = document.getElementById('joySize'); if (js) js.textContent = nc + '×' + nr;
if (!quiet) toast('房间改成 ' + nc + ' × ' + nr + (dc + dr < 0 ? '，出界的家具已自动收回仓库' : ''));
}
function bindJoy(box){
box.querySelectorAll('.rv-joyb').forEach(function(b){
let tm = null, iv = null;
const step = function(){ resizeRoom(Number(b.dataset.dc), Number(b.dataset.dr), true); };
const stop = function(){ clearTimeout(tm); clearInterval(iv); tm = iv = null; };
b.addEventListener('pointerdown', function(e){
e.preventDefault();
step();
tm = setTimeout(function(){ iv = setInterval(step, 240); }, 420);
});
['pointerup','pointerleave','pointercancel'].forEach(function(ev){ b.addEventListener(ev, stop); });
});
}
function roomMenu(){
const items = [];
const wallNames = { cream: '米白', dusk: '暮色', star: '星空' };
items.push({ sec: '墙纸' });
Object.keys(WALLS).forEach(function(w){
const p = WALLS[w];
items.push({ label: wallNames[w], sel: d.wall === w, thumb: '<span style="display:block;width:56px;height:42px;border-radius:8px;border:1px solid rgba(0,0,0,.1);background:linear-gradient(160deg,' + p.wl + ' 55%,' + p.wr + ' 55%)"></span>', cb: function(){ d.wall = w; d.walls.L.c = p.wl; d.walls.R.c = p.wr; save(); renderAll(); setTimeout(roomMenu, 0); } });
});
items.push({ sec: '地板' });
Object.keys(FLOORS).forEach(function(f){
const fp = FLOORS[f];
items.push({ label: f === 'wood' ? '木地板' : '棋盘砖', sel: d.floor === f, thumb: '<span style="display:block;width:56px;height:42px;border-radius:8px;border:1px solid rgba(0,0,0,.1);background:' + fp.a + '"><i style="display:block;height:12px;margin-top:28px;border-radius:0 0 8px 8px;background:' + fp.b + '"></i></span>', cb: function(){ d.floor = f; save(); renderAll(); setTimeout(roomMenu, 0); } });
});
const html = '<div class="rv-dpadwrap" style="justify-content:center;margin-top:2px"><div class="rv-dpad">'
+ '<span></span><button class="rv-joyb" data-dc="0" data-dr="-1">▲</button><span></span>'
+ '<button class="rv-joyb" data-dc="-1" data-dr="0">◀</button><span id="joySize" style="font-size:10px;align-self:center;text-align:center;color:#8a80a0;line-height:1.2;width:30px">' + d.cols + '×' + d.rows + '</span><button class="rv-joyb" data-dc="1" data-dr="0">▶</button>'
+ '<span></span><button class="rv-joyb" data-dc="0" data-dr="1">▼</button><span></span>'
+ '</div></div><div class="rv-desc" style="text-align:center;margin-top:-4px">按住摇杆改房间大小：◀▶ 调宽，▲▼ 调深</div>';
hint('room', '按住摇杆连续调整房间大小');
openPanel(' 装修', '窗户、挂画、镜子都是家具了，去「仓库」摆放、收回、换样式', items, { grid: true, html: html, onReady: bindJoy });
}
/* 长按墙体打开：墙面管理（选色/纹样/增删）+ 窗户入口 + 墙高 */
/* ================= 装修模式：沉浸式墙面编辑（无弹窗遮挡） ================= */
let decoMode = null;  // { wall, tool: 'edit'|'window'|'door'|'floor', fcol, ferase }
let decoUndo = [];    // 装修期间的撤销栈（存整份 d 的快照）
function decoSnap(){ if (!decoMode) return; decoUndo.push(JSON.stringify(d)); if (decoUndo.length > 40) decoUndo.shift(); }
const FLOOR_COLORS = ['#E9C99E', '#D9B78F', '#C9A171', '#B78A5F', '#F1E8D9', '#DCCFB8', '#C4B49C', '#8A6248'];
function wallAt(px, py){
let hit = null;
wallDefs().forEach(function(w){
const a = (px - w.O[0]) / w.b1[0];
const c = ((py - w.O[1]) - a * w.b1[1]) / -w.H;
if (a >= -0.02 && a <= 1.02 && c >= -0.02 && c <= 1.02) hit = w.id;
});
return hit;
}
function enterDeco(){
mode = null; refreshTiles();
decoMode = { wall: null, tool: 'edit' };
decoUndo = [];
if (page) page.classList.add('rv-deco');   // 装修时只留装修 UI（CSS 隐藏页头/状态条/控制条）
layoutRoom(); fit(true); renderAll(); updateDecoBar();
toast('装修模式：改完点「保存」');
}
function exitDeco(){
decoMode = null;
decoUndo = [];
if (page) page.classList.remove('rv-deco');
document.getElementById('decoUI').hidden = true;
layoutRoom(); fit(true); renderAll();
}
function decoUndoStep(){
if (!decoUndo.length){ toast('没有可撤销的步骤了'); return; }
d = fix(JSON.parse(decoUndo.pop()));
decoMode.wall = null; decoMode.tool = 'edit';
layoutRoom(); renderAll(); refreshTiles(); updateDecoBar();
toast('已撤销一步');
}
function decoSave(){
save();
exitDeco();
toast('已保存');
}
function updateDecoBar(){
const ui = document.getElementById('decoUI');
if (!decoMode){ ui.hidden = true; return; }
ui.hidden = false;
const bar = document.getElementById('decoBar');
let h = '';
const B = function(id, label){ return '<button class="rv-dbtn" id="' + id + '">' + label + '</button>'; };
if (decoMode.tool === 'floor'){
h = '<span class="rv-dname">🎨 地板：点格上色，按住拖动连刷</span>';
FLOOR_COLORS.forEach(function(col){
h += '<button class="rv-dsw' + ((decoMode.fcol === col && !decoMode.ferase) ? ' sel' : '') + '" data-fcol="' + col + '" style="background:' + col + '"></button>';
});
h += B('dErase', '橡皮擦') + B('dCancelTool', '完成');
} else if (decoMode.tool === 'window'){
h = '<span class="rv-dname">✂️ 开窗：在墙上拖出一个矩形</span>' + B('dCancelTool', '取消');
} else if (decoMode.wall && d.walls[decoMode.wall]){
const id = decoMode.wall, w = d.walls[id];
h = '<span class="rv-dname"> ' + WALL_NAMES[id] + (w.a ? ' · 已绘' : '') + '</span>';
WALL_COLORS.forEach(function(col){
h += '<button class="rv-dsw' + (normColor(w.c) === normColor(col) ? ' sel' : '') + '" data-col="' + col + '" style="background:' + col + '"></button>';
});
h += B('dArt', '纹样 ');
if (w.a) h += B('dClearArt', '清纹样');
if (id === 'F1' || id === 'F2') h += B('dRemove', '移除墙');
h += B('dWin', '开窗') + B('dDoor', '装门') + B('dFloor', '地板');
h += '<span style="font-size:11px;color:var(--sub)">墙高</span><input type="range" id="dH" min="100" max="220" step="5" value="' + (d.wallH || 150) + '">';
h += B('dDone', '完成');
} else {
h = '<span class="rv-dname" style="color:var(--sub);font-weight:400">点一面墙开始编辑 · 窗/挂画按住即拖</span>';
h += B('dAdd', '＋ 添半墙') + B('dWin', '开窗') + B('dDoor', '装门') + B('dFloor', '地板') + B('dRoom', '户型') + B('dExit', '退出');
}
h += B('dUndo', '撤销') + B('dSave', '保存');
bar.innerHTML = h;
const on = function(id, fn){ const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
bar.querySelectorAll('.rv-dsw').forEach(function(b){
b.addEventListener('click', function(){
if (!decoMode || !decoMode.wall) return;
decoSnap();
d.walls[decoMode.wall].c = this.dataset.col;
save(); renderAll(); updateDecoBar();
});
});
on('dArt', function(){ if (decoMode.wall) openStudio({ kind: 'wall', wall: decoMode.wall }); });
on('dClearArt', function(){ decoSnap(); const w = d.walls[decoMode.wall]; if (w){ w.a = null; save(); renderAll(); updateDecoBar(); } });
on('dRemove', function(){ decoSnap(); d.walls[decoMode.wall] = null; decoMode.wall = null; save(); renderAll(); updateDecoBar(); });
on('dWin', function(){ decoMode.tool = 'window'; decoMode.ferase = false; updateDecoBar(); toast('在墙上拖出一个矩形，松开成窗'); });
on('dFloor', function(){ decoMode.tool = 'floor'; decoMode.ferase = false; updateDecoBar(); hint('floor', '点地板格子上色 · 按住拖动连刷 · 橡皮擦恢复默认'); });
on('dErase', function(){ decoMode.ferase = true; updateDecoBar(); });
bar.querySelectorAll('.rv-dsw[data-fcol]').forEach(function(b){
b.addEventListener('click', function(){
decoMode.fcol = this.dataset.fcol;
decoMode.ferase = false;
updateDecoBar();
});
});
on('dCancelTool', function(){ decoMode.tool = 'edit'; updateDecoBar(); });
on('dDone', function(){ decoMode.wall = null; renderAll(); updateDecoBar(); });
on('dH', null);
const rH = document.getElementById('dH');
if (rH) rH.addEventListener('input', function(){ decoSnap(); d.wallH = Number(this.value); save(); renderAll(); });
on('dAdd', function(){
decoSnap();
const id = !d.walls.F1 ? 'F1' : (!d.walls.F2 ? 'F2' : null);
if (!id){ toast('两面半墙都加好了'); return; }
d.walls[id] = { c: '#EADCC8', a: null };
decoMode.wall = id;
save(); renderAll(); updateDecoBar();
});
on('dRoom', function(){ roomMenu(); });
on('dUndo', decoUndoStep);
on('dSave', decoSave);
on('dDoor', function(){ decoMode.tool = 'door'; decoMode.ferase = false; updateDecoBar(); toast('在墙上拖出「门」的范围'); });
on('dExit', decoSave);
}
const WALL_NAMES = { L: '左墙', R: '右墙', F1: '前左半墙', F2: '前右半墙' };
const WALL_COLORS = ['#F7EFE2', '#EADCC8', '#F2D3BE', '#E3BCA6', '#D9E4EC', '#CBD8C4', '#E8D5E0', '#D9CFC4'];
const FRAME_COLORS = ['#FBF6EC', '#8A6248', '#2B2B3A', '#C9A227', '#9BB8D3', '#E8A0A8'];
function wallMenu(){
const items = [];
items.push({ sec: '墙面（点进去选色 / 绘纹样）' });
['L', 'R', 'F1', 'F2'].forEach(function(id){
const w = d.walls[id];
if (!w) return;
items.push({ label: WALL_NAMES[id] + (w.a ? ' · 已绘' : ''), thumb: '<span class="rv-swbig" style="background:' + w.c + ';box-shadow:inset 0 0 0 3px ' + shade(w.c, .85) + '"></span>', cb: function(){ wallDetail(id); } });
});
if (!d.walls.F1 || !d.walls.F2){
items.push({ label: '添加半墙', badge: '＋', thumb: '<span style="font-size:28px"></span>', cb: function(){
const id = !d.walls.F1 ? 'F1' : 'F2';
d.walls[id] = { c: '#EADCC8', a: null };
save(); renderAll(); toast('添加了' + WALL_NAMES[id] + '（半高，可继续选色）'); setTimeout(wallMenu, 0);
} });
}
items.push({ sec: '窗户' });
items.push({ label: '框选开窗 ✂️', thumb: '<span style="font-size:28px">✂️</span>', cb: function(){
setMode({ kind: 'winwall' }, '在墙上拖出一个矩形，松开即成窗（按大小扣）');
hint('winband', '拖窗：从墙上一角拖到对角；太小则退出');
} });
items.push({ sec: '快捷挂窗（扣）' });
['win_rect', 'win_arch', 'win_round'].forEach(function(t){
const c = CAT[t];
items.push({ label: c.n, badge: c.cost + '', thumb: c.thumb, dis: d.pts < c.cost, cb: function(){
d.pts -= c.cost;
const walls = d.fx.filter(function(f){ const fc = catOf(f.t); return fc && fc.wall; });
const leftN = walls.filter(function(f){ return f.x < d.cols / 2; }).length;
const hangLeft = leftN * 2 <= walls.length;
d.fx.push({ i: 'f' + Date.now().toString(36) + ri(100, 999), t: t, x: hangLeft ? 1 : (d.cols - 1), y: 0, r: 0 });
save(); renderAll(); toast('挂上了：' + c.n); setTimeout(wallMenu, 0);
} });
});
const wins = d.fx.filter(function(f){ const fc = catOf(f.t); return fc && fc.win; });
if (wins.length){
items.push({ sec: '墙上的窗户（点按管理）' });
wins.forEach(function(w){ items.push({ label: CAT[w.t].n, thumb: CAT[w.t].thumb, cb: function(){ furnMenu(w); } }); });
}
const hv = d.wallH || 150;
hint('wall', '拖动墙高滑条，房间实时变化');
openPanel(' 墙面', '长按墙体随时打开此面板', items, { grid: true,
html: '<div class="rv-prow"><span style="width:34px">墙高</span><input type="range" id="wlH" min="100" max="220" step="5" value="' + hv + '" style="flex:1"><b id="wlHv" style="width:40px;text-align:right;font-size:12px">' + hv + '</b></div>',
onReady: function(box){
const r = box.querySelector('#wlH'), v = box.querySelector('#wlHv');
r.addEventListener('input', function(){
const val = Number(this.value);
d.wallH = val; v.textContent = val;
save(); renderAll();
});
} });
}
/* 单面墙详情：选色 / 纹样 / 移除 */
function wallDetail(id){
const w = d.walls[id];
if (!w){ wallMenu(); return; }
const items = [];
items.push({ sec: '选色' });
WALL_COLORS.forEach(function(col){
items.push({ label: '&nbsp;', sel: normColor(w.c) === normColor(col), thumb: '<span class="rv-swbig" style="background:' + col + '"></span>', cb: function(){
w.c = col; save(); renderAll(); setTimeout(function(){ wallDetail(id); }, 0);
} });
});
items.push({ sec: '纹样（自绘，沿墙平铺）' });
items.push({ label: w.a ? '重新绘制 ' : '绘制纹样 ', thumb: artThumb(w.a), cb: function(){ openStudio({ kind: 'wall', wall: id }); } });
if (w.a) items.push({ label: '清除纹样', thumb: '<span style="font-size:26px">🗑</span>', cb: function(){
w.a = null; save(); renderAll(); setTimeout(function(){ wallDetail(id); }, 0);
} });
if (id === 'F1' || id === 'F2'){
items.push({ sec: '管理' });
items.push({ label: '移除这面墙', thumb: '<span style="font-size:26px">✕</span>', cb: function(){
d.walls[id] = null; save(); renderAll(); wallMenu();
} });
}
items.push({ label: '← 返回墙面列表', thumb: '<span style="font-size:24px">‹</span>', cb: wallMenu });
openPanel(' ' + WALL_NAMES[id], '', items, { grid: true, cols: 4 });
}
/* ================= 换装 v3（分区卡片 + 身高滑条 + 手绘层） ================= */
const LOOK = {
skin: ['#FFE3CF', '#F5CBA7', '#E8B48C', '#D29B6C', '#FFF1E0', '#C98B5E', '#F7D4B8', '#B87850'],
hair: ['#5B4A68', '#2B2B3A', '#8A6248', '#C9A227', '#E8E4DF', '#B5654D', '#7A8B99', '#D98CA6'],
top:  ['#8E7CC3', '#E86A6A', '#F2A56B', '#F6D365', '#7FB069', '#5B8DB8', '#E8A0A8', '#6B5B95'],
bottom: ['#6B5B95', '#4A5568', '#8A6248', '#C9A227', '#7FB069', '#B5654D', '#2B2B3A', '#E8A0A8']
};
const HAIR_NAMES = { short: '短发', long: '长发', twin: '双马尾', bun: '丸子头' };
const LOOK_KINDS = [['skin', '肤色'], ['hair', '发色'], ['top', '上衣'], ['bottom', '裤子']];
function lookMenu(){
const items = [];
items.push({ sec: '发型' });
Object.keys(HAIR_NAMES).forEach(function(st){
items.push({ label: HAIR_NAMES[st], sel: d.look.style === st, thumb: dollSVG({}, 0.95, { style: st }), cb: function(){ d.look.style = st; save(); renderTA(); setTimeout(lookMenu, 0); } });
});
LOOK_KINDS.forEach(function(pair){
items.push({ sec: pair[1] });
LOOK[pair[0]].forEach(function(col){
items.push({ label: '&nbsp;', sel: d.look[pair[0]] === col, thumb: '<span class="rv-swbig" style="background:' + col + '"></span>', cb: function(){ d.look[pair[0]] = col; save(); renderTA(); setTimeout(lookMenu, 0); } });
});
});
const la = d.lookArt || {};
items.push({ sec: '手绘层（覆盖预设，可单独清除）' });
[['hair', '头发'], ['face', '五官'], ['top', '上衣'], ['bottom', '裤子']].forEach(function(pair){
items.push({ label: la[pair[0]] ? pair[1] + ' ' : '画' + pair[1], thumb: artThumb(la[pair[0]]), cb: function(){ openStudio({ kind: pair[0] }); } });
});
if (Object.keys(la).length){
items.push({ label: '全部清除', thumb: '<span style="font-size:30px">🗑</span>', cb: function(){
d.lookArt = {}; save(); renderTA(); toast('已清除全部手绘层'); setTimeout(lookMenu, 0);
} });
}
const hv = Math.round(((d.look && d.look.h) || 1) * 100);
openPanel(' 换装', '', items, { grid: true, cols: 4,
html: '<div class="rv-prow"><span style="width:34px">身高</span><input type="range" id="lkH" min="75" max="135" step="5" value="' + hv + '" style="flex:1"><b id="lkHv" style="width:44px;text-align:right;font-size:12px">' + hv + '%</b></div>',
onReady: function(box){
const r = box.querySelector('#lkH'), v = box.querySelector('#lkHv');
r.addEventListener('input', function(){
const val = Number(this.value);
d.look.h = val / 100; v.textContent = val + '%';
save(); renderTA();
});
} });
}
/* ================= 画室 v3（自选格数 / 色盘自选 / 移动色块） ================= */
const STUDIO = { target: null, art: null, tool: 'pen', color: '#E86A6A', undo: [] };
const stCanvas = document.getElementById('stCanvas');
const stCtx = stCanvas.getContext('2d');
function pushUndo(){ STUDIO.undo.push(JSON.stringify(STUDIO.art)); if (STUDIO.undo.length > 40) STUDIO.undo.shift(); }
function stTitle(){
const k = STUDIO.target.kind;
return { shape: ' 画脸型（覆盖默认头型）', hair: ' 画头发（画完覆盖当前发型）', face: ' 画五官（覆盖默认表情）', top: ' 画上衣服', bottom: ' 画裤子', wall: ' 画墙壁纹样（沿墙平铺）' }[k] || ' 画一件家具';
}
function drawStCanvas(){
const s = STUDIO.art.s, cs = stCanvas.width / s;
stCtx.fillStyle = '#FFFFFF'; stCtx.fillRect(0, 0, stCanvas.width, stCanvas.height);
for (let r = 0; r < s; r++) for (let c = 0; c < s; c++){
const col = artGet(STUDIO.art, r, c);
if (col){ stCtx.fillStyle = col; stCtx.fillRect(c * cs, r * cs, cs, cs); }
}
stCtx.strokeStyle = '#EDE6F5'; stCtx.lineWidth = 1;
for (let i = 0; i <= s; i++){
stCtx.beginPath(); stCtx.moveTo(i * cs + .5, 0); stCtx.lineTo(i * cs + .5, stCanvas.height); stCtx.stroke();
stCtx.beginPath(); stCtx.moveTo(0, i * cs + .5); stCtx.lineTo(stCanvas.width, i * cs + .5); stCtx.stroke();
}
}
function drawStPreview(){
const k = STUDIO.target.kind;
const prev = document.getElementById('stPreview');
if (k === 'rv-furn'){ prev.innerHTML = furnArtSVG(STUDIO.art); return; }
if (k === 'wall'){
prev.innerHTML = '<svg viewBox="0 0 96 72" style="width:140px;height:auto;border-radius:8px"><defs><pattern id="stwp" width="24" height="24" patternUnits="userSpaceOnUse">' + pixRects(STUDIO.art, 0, 0, 24, 24) + '</pattern></defs><rect width="96" height="72" fill="#F7EFE2"/><rect width="96" height="72" fill="url(#stwp)"/></svg>';
return;
}
const o = {}; o[k] = STUDIO.art;
prev.innerHTML = dollSVG(o, 1);
}
function syncSizeSeg(){
document.querySelectorAll('#stSize button').forEach(function(b){ b.classList.toggle('on', Number(b.dataset.s) === STUDIO.art.s); });
const n = document.getElementById('stSizeN');
if (n && document.activeElement !== n) n.value = STUDIO.art.s;
}
function buildStPal(){
const pal = document.getElementById('stPal');
pal.innerHTML = '';
const list = PIXEL.slice();
(STUDIO.art.pal || []).forEach(function(c){ if (list.indexOf(c) < 0) list.push(c); });
list.forEach(function(col){
const b = document.createElement('button');
b.style.background = col;
if (normColor(col) === normColor(STUDIO.color)) b.classList.add('rv-sel');
b.addEventListener('click', function(){
STUDIO.color = col; STUDIO.tool = 'pen';
document.getElementById('stPen').classList.add('rv-on');
document.getElementById('stEraser').classList.remove('rv-on');
buildStPal();
});
pal.appendChild(b);
});
}
function openStudio(target){
STUDIO.target = target;
STUDIO.undo = [];
STUDIO.tool = 'pen';
if (target.kind === 'rv-furn' && target.id) STUDIO.art = JSON.parse(JSON.stringify(d.customFurn[target.id].art));
else if (target.kind === 'wall') STUDIO.art = d.walls[target.wall].a ? JSON.parse(JSON.stringify(d.walls[target.wall].a)) : blankArt(12);
else if (target.kind !== 'rv-furn' && d.lookArt && d.lookArt[target.kind]) STUDIO.art = JSON.parse(JSON.stringify(d.lookArt[target.kind]));
else STUDIO.art = blankArt(12);
document.getElementById('stTitle').textContent = stTitle();
document.getElementById('stName').hidden = !(target.kind === 'rv-furn' && !target.id);
syncSizeSeg(); buildStPal();
document.getElementById('stPen').classList.add('rv-on');
document.getElementById('stEraser').classList.remove('rv-on');
drawStCanvas(); drawStPreview();
document.getElementById('studio').style.display = 'flex';
}
function closeStudio(){ document.getElementById('studio').style.display = 'none'; }
function stPaintAt(e){
const r = stCanvas.getBoundingClientRect();
const c = Math.floor((e.clientX - r.left) / r.width * STUDIO.art.s);
const rr = Math.floor((e.clientY - r.top) / r.height * STUDIO.art.s);
if (c < 0 || rr < 0 || c >= STUDIO.art.s || rr >= STUDIO.art.s) return;
const ok = artSet(STUDIO.art, rr, c, STUDIO.tool === 'eraser' ? null : STUDIO.color);
if (!ok){ toast('这幅画颜色太多啦（250 色上限）'); return; }
drawStCanvas(); drawStPreview();
}
stCanvas.addEventListener('pointerdown', function(e){
e.preventDefault();
pushUndo();
stPaintAt(e);
const mv = function(ev){ stPaintAt(ev); };
const up = function(){ window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
window.addEventListener('pointermove', mv);
window.addEventListener('pointerup', up);
});
document.querySelectorAll('#stSize button').forEach(function(b){
b.addEventListener('click', function(){
const ns = Number(b.dataset.s);
if (ns === STUDIO.art.s) return;
pushUndo();
STUDIO.art = resizeArt(STUDIO.art, ns);
syncSizeSeg(); drawStCanvas(); drawStPreview();
});
});
document.getElementById('stSizeN').addEventListener('change', function(){
let ns = Math.round(Number(this.value));
if (isNaN(ns)) return;
ns = Math.min(48, Math.max(4, ns));
this.value = ns;
if (ns === STUDIO.art.s) return;
pushUndo();
STUDIO.art = resizeArt(STUDIO.art, ns);
syncSizeSeg(); drawStCanvas(); drawStPreview();
});
document.querySelectorAll('#studio .rv-dpad button').forEach(function(b){
b.addEventListener('click', function(){
pushUndo();
shiftArt(STUDIO.art, Number(b.dataset.dx), Number(b.dataset.dy));
drawStCanvas(); drawStPreview();
});
});
document.getElementById('stColor').addEventListener('input', function(){
STUDIO.color = this.value;
document.getElementById('stColorHex').textContent = this.value.toUpperCase();
STUDIO.tool = 'pen';
document.getElementById('stPen').classList.add('rv-on');
document.getElementById('stEraser').classList.remove('rv-on');
buildStPal();
});
document.getElementById('stPen').addEventListener('click', function(){ STUDIO.tool = 'pen'; this.classList.add('rv-on'); document.getElementById('stEraser').classList.remove('rv-on'); });
document.getElementById('stEraser').addEventListener('click', function(){ STUDIO.tool = 'eraser'; this.classList.add('rv-on'); document.getElementById('stPen').classList.remove('rv-on'); });
document.getElementById('stUndo').addEventListener('click', function(){
if (!STUDIO.undo.length) return;
STUDIO.art = JSON.parse(STUDIO.undo.pop());
syncSizeSeg(); drawStCanvas(); drawStPreview();
});
document.getElementById('stClear').addEventListener('click', function(){
pushUndo();
STUDIO.art = blankArt(STUDIO.art.s);
drawStCanvas(); drawStPreview();
});
document.getElementById('stCancel').addEventListener('click', closeStudio);
document.getElementById('stX').addEventListener('click', closeStudio);
document.getElementById('stSave').addEventListener('click', function(){
const k = STUDIO.target.kind;
const snapshot = JSON.parse(JSON.stringify(STUDIO.art));
if (k === 'rv-furn'){
if (STUDIO.target.id){
d.customFurn[STUDIO.target.id].art = snapshot;
toast('已更新家具');
} else {
const name = (document.getElementById('stName').value || '').trim() || '手绘家具';
const id = 'u' + Date.now().toString(36);
d.customFurn[id] = { name: name, art: snapshot };
d.inv['u:' + id] = 1;
toast('「' + name + '」已放入仓库，去摆放吧');
}
} else if (k === 'wall'){
d.walls[STUDIO.target.wall].a = snapshot;
toast('纹样贴上墙了');
} else {
d.lookArt[k] = snapshot;
toast('穿上了！');
}
save();
try { renderAll(); } catch (e) { }   // 二改：渲染出错也不能把用户困在画室里（下面是 closeStudio）
closeStudio();
});
/* ================= 组装台 v2（部件级拼装 + 自由视角预览） ================= */
function shade(hex, f){
const n = parseInt(String(hex).slice(1), 16);
if (isNaN(n)) return hex;
const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
const b = Math.min(255, Math.round((n & 255) * f));
return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
/* 旧版叠层件渲染（兼容 kind:'asm' 存档） */
function asmSVG(a){
const u0 = -a.w / 2, u1 = a.w / 2, v0 = -a.d / 2, v1 = a.d / 2;
const ratios = { 1: [1], 2: [.6, .4], 3: [.5, .3, .2] }[a.layers];
let s = '', dy = 0;
for (let i = 0; i < a.layers; i++){
const lh = Math.max(6, Math.round(a.h * ratios[i]));
const ins = Math.min(i * 0.11, Math.min(a.w, a.d) / 2 - 0.14);
const col = a.colors[i] || '#E9C79F';
s += box(u0 + ins, v0 + ins, u1 - ins, v1 - ins, lh, { t: col, l: shade(col, .82), r: shade(col, .64) }, dy);
dy += lh;
}
if (a.topper === 'ball') s += '<circle cx="0" cy="' + (-dy - 9) + '" r="9" fill="#F4C9C5"/>';
else if (a.topper === 'plant') s += '<circle cx="-5" cy="' + (-dy - 8) + '" r="7" fill="#7FB069"/><circle cx="5" cy="' + (-dy - 11) + '" r="8" fill="#5F9E58"/>';
else if (a.topper === 'star') s += '<path d="M0 ' + (-dy - 23) + ' L3.5 ' + (-dy - 13) + ' L12 ' + (-dy - 13) + ' L5.5 ' + (-dy - 7) + ' L8 ' + (-dy + 1) + ' L0 ' + (-dy - 4) + ' L-8 ' + (-dy + 1) + ' L-5.5 ' + (-dy - 7) + ' L-12 ' + (-dy - 13) + ' L-3.5 ' + (-dy - 13) + ' Z" fill="#F6D365"/>';
return '<svg viewBox="-64 -150 128 160">' + s + '</svg>';
}
/* ---- 通用 3D 投影：yaw 绕竖直轴，pitch 俯仰（30° 时与房间投影完全一致） ---- */
function proj3(u, v, z, vw){
const ca = Math.cos(vw.yaw), sa = Math.sin(vw.yaw);
const u2 = u * ca - v * sa, v2 = u * sa + v * ca;
const K2 = TW2 * 0.5 * (Math.sin(vw.pitch) / Math.sin(Math.PI / 6));
return [ (u2 - v2) * TW2 * vw.zoom, ((u2 + v2) * K2 - z) * vw.zoom ];
}
function groundDepth(g, vw){
const ca = Math.cos(vw.yaw), sa = Math.sin(vw.yaw);
return (g[0] * ca - g[1] * sa) + (g[0] * sa + g[1] * ca);
}
function faceShade(base, p1, p2){
const du = p2[0] - p1[0], dv = p2[1] - p1[1];
const len = Math.hypot(du, dv) || 1;
const d = (dv / len) * (-0.55) + (-du / len) * (-0.72);
return shade(base, 0.6 + 0.35 * (d * 0.5 + 0.5));
}
function asm2Part(p, vw, pi){
const open = pi >= 0 ? '<g data-pi="' + pi + '">' : '<g>';
if (p.shape === 'box'){
const B = [p.x - p.w / 2, p.y - p.d / 2], R = [p.x + p.w / 2, p.y - p.d / 2],
F = [p.x + p.w / 2, p.y + p.d / 2], L = [p.x - p.w / 2, p.y + p.d / 2];
const faces = [[B, R], [R, F], [F, L], [L, B]];
faces.forEach(f => { f.key = groundDepth(f[0], vw) + groundDepth(f[1], vw); });
faces.sort((x, y) => x.key - y.key);
let s = open;
faces.forEach(f => {
s += poly([proj3(f[0][0], f[0][1], p.z, vw), proj3(f[1][0], f[1][1], p.z, vw),
proj3(f[1][0], f[1][1], p.z + p.h, vw), proj3(f[0][0], f[0][1], p.z + p.h, vw)], faceShade(p.color, f[0], f[1]));
});
s += poly([proj3(B[0], B[1], p.z + p.h, vw), proj3(R[0], R[1], p.z + p.h, vw),
proj3(F[0], F[1], p.z + p.h, vw), proj3(L[0], L[1], p.z + p.h, vw)], shade(p.color, 1));
return s + '</g>';
}
if (p.shape === 'ball'){
const r = p.w * TW2 * 0.4 * vw.zoom;
const c = proj3(p.x, p.y, p.z + r, vw);
return open + '<circle cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + p.color + '"/>'
+ '<circle cx="' + (c[0] - r * 0.3).toFixed(1) + '" cy="' + (c[1] - r * 0.35).toFixed(1) + '" r="' + (r * 0.28).toFixed(1) + '" fill="#fff" opacity=".55"/></g>';
}
const N = 14, top = [], bot = [];
for (let k = 0; k < N; k++){
const an = k / N * Math.PI * 2;
top.push(proj3(p.x + Math.cos(an) * p.w / 2, p.y + Math.sin(an) * p.d / 2, p.z + p.h, vw));
bot.push(proj3(p.x + Math.cos(an) * p.w / 2, p.y + Math.sin(an) * p.d / 2, p.z, vw));
}
const ox = p.w / 2 * 0.7071, oy = -p.d / 2 * 0.7071;
const side = poly([proj3(p.x - ox, p.y - oy, p.z, vw), proj3(p.x + ox, p.y + oy, p.z, vw),
proj3(p.x + ox, p.y + oy, p.z + p.h, vw), proj3(p.x - ox, p.y - oy, p.z + p.h, vw)], shade(p.color, 0.78));
return open + poly(bot, shade(p.color, 0.6)) + side + poly(top, shade(p.color, 1)) + '</g>';
}
function asm2Inner(parts, vw, pick){
const order = parts.map((p, i) => ({ i: i, depth: groundDepth([p.x, p.y], vw) })).sort((a, b) => a.depth - b.depth);
let s = '';
order.forEach(o => { s += asm2Part(parts[o.i], vw, pick ? o.i : -1); });
if (pick && ASM2 && ASM2.sel >= 0 && parts[ASM2.sel]){
const p = parts[ASM2.sel];
s += poly([proj3(p.x - p.w / 2, p.y - p.d / 2, p.z, vw), proj3(p.x + p.w / 2, p.y - p.d / 2, p.z, vw),
proj3(p.x + p.w / 2, p.y + p.d / 2, p.z, vw), proj3(p.x - p.w / 2, p.y + p.d / 2, p.z, vw)],
'rgba(255,211,77,.12)', 'stroke="#FFD34D" stroke-width="2.5" stroke-dasharray="5 3"');
}
return s;
}
function asm2SVG(parts){
return '<svg viewBox="-64 -150 128 160">' + asm2Inner(parts, { yaw: 0, pitch: Math.PI / 6, zoom: 1 }, false) + '</svg>';
}
/* ---- 模板：能真正搭出东西的起点 ---- */
const ASM2_TPL = {
table: { parts: [
{ shape:'box', x:0, y:0, z:36, w:1.2, d:0.85, h:7, color:'#D9B78F' },
{ shape:'box', x:-0.48, y:-0.31, z:0, w:0.1, d:0.1, h:36, color:'#A37A51' },
{ shape:'box', x:0.48, y:-0.31, z:0, w:0.1, d:0.1, h:36, color:'#A37A51' },
{ shape:'box', x:-0.48, y:0.31, z:0, w:0.1, d:0.1, h:36, color:'#A37A51' },
{ shape:'box', x:0.48, y:0.31, z:0, w:0.1, d:0.1, h:36, color:'#A37A51' }
]},
sofa: { parts: [
{ shape:'box', x:0, y:0.05, z:0, w:1.35, d:0.7, h:16, color:'#E8A0A8' },
{ shape:'box', x:0, y:-0.28, z:16, w:1.35, d:0.16, h:20, color:'#E8A0A8' },
{ shape:'box', x:-0.57, y:0.02, z:0, w:0.18, d:0.66, h:26, color:'#E8A0A8' },
{ shape:'box', x:0.57, y:0.02, z:0, w:0.18, d:0.66, h:26, color:'#E8A0A8' },
{ shape:'box', x:-0.27, y:0.08, z:16, w:0.5, d:0.48, h:6, color:'#F6EDE2' },
{ shape:'box', x:0.27, y:0.08, z:16, w:0.5, d:0.48, h:6, color:'#F6EDE2' }
]},
bed: { parts: [
{ shape:'box', x:0, y:0, z:0, w:1.5, d:1.05, h:20, color:'#B78A5F' },
{ shape:'box', x:0, y:0.02, z:20, w:1.4, d:0.98, h:9, color:'#F6EDE2' },
{ shape:'box', x:-0.36, y:-0.3, z:29, w:0.48, d:0.3, h:8, color:'#FFFDF8' },
{ shape:'box', x:0.36, y:-0.3, z:29, w:0.48, d:0.3, h:8, color:'#FFFDF8' },
{ shape:'box', x:0, y:0.22, z:29, w:1.4, d:0.52, h:4, color:'#F4C9C5' },
{ shape:'box', x:0, y:-0.5, z:0, w:1.5, d:0.1, h:34, color:'#A37A51' }
]},
shelf: { parts: [
{ shape:'box', x:0, y:0, z:0, w:1.15, d:0.45, h:92, color:'#C09A6F' },
{ shape:'box', x:0, y:0, z:22, w:1.2, d:0.5, h:4, color:'#D9B78F' },
{ shape:'box', x:0, y:0, z:48, w:1.2, d:0.5, h:4, color:'#D9B78F' },
{ shape:'box', x:0, y:0, z:72, w:1.2, d:0.5, h:4, color:'#D9B78F' },
{ shape:'box', x:-0.35, y:0, z:76, w:0.12, d:0.32, h:14, color:'#E8A0A8' },
{ shape:'box', x:-0.2, y:0, z:76, w:0.12, d:0.32, h:11, color:'#9BB8D3' },
{ shape:'box', x:-0.05, y:0, z:76, w:0.12, d:0.32, h:16, color:'#D9C87F' }
]},
lamp: { parts: [
{ shape:'box', x:0, y:0, z:0, w:0.4, d:0.4, h:7, color:'#A37A51' },
{ shape:'box', x:0, y:0, z:7, w:0.09, d:0.09, h:34, color:'#93805F' },
{ shape:'box', x:0, y:0, z:41, w:0.55, d:0.55, h:16, color:'#F6D365' }
]},
plant: { parts: [
{ shape:'cyl', x:0, y:0, z:0, w:0.44, d:0.44, h:20, color:'#C47A56' },
{ shape:'ball', x:-0.07, y:0, z:20, w:0.44, d:0.44, h:0, color:'#7FB069' },
{ shape:'ball', x:0.1, y:0.03, z:32, w:0.36, d:0.36, h:0, color:'#5F9E58' }
]}
};
const ASM2 = { id: null, parts: [], sel: -1, vw: { yaw: 0.7, pitch: 0.62, zoom: 1.15 } };
/* 摇杆向量移动（nx,ny 为归一化屏幕方向×力度，随视角） */
function asmMoveVec(nx, ny){
const p = ASM2.parts[ASM2.sel]; if (!p) return;
const vw = ASM2.vw;
const K2 = TW2 * 0.5 * (Math.sin(vw.pitch) / Math.sin(Math.PI / 6));
const du2 = (nx / TW2 + ny / K2) / 2 * 0.09;
const dv2 = (ny / K2 - nx / TW2) / 2 * 0.09;
const ca = Math.cos(-vw.yaw), sa = Math.sin(-vw.yaw);
p.x = Math.min(1.6, Math.max(-1.6, p.x + du2 * ca - dv2 * sa));
p.y = Math.min(1.6, Math.max(-1.6, p.y + du2 * sa + dv2 * ca));
updateAsm2();
}
function updateAsm2(){
document.getElementById('asmPreview').innerHTML =
'<svg viewBox="-150 -185 300 280" style="width:100%;height:100%;display:block">' + asm2Inner(ASM2.parts, ASM2.vw, true) + '</svg>';
const p = ASM2.parts[ASM2.sel];
const has = !!p;
['asmW', 'asmD', 'asmH', 'asmZ', 'asmC'].forEach(function(k){ document.getElementById(k).disabled = !has; });
document.getElementById('asmDel').disabled = !has;
document.getElementById('asmDup').disabled = !has;
const info = document.getElementById('asmSelInfo');
if (!has){ info.textContent = '点按预览中的部件进行编辑'; return; }
const names = { box: '盒体', ball: '球体', cyl: '圆柱' };
info.textContent = '已选中：' + names[p.shape] + '（#' + (ASM2.sel + 1) + '）';
document.getElementById('asmW').value = Math.round(p.w * 100); document.getElementById('asmWv').textContent = p.w.toFixed(2);
document.getElementById('asmD').value = Math.round(p.d * 100); document.getElementById('asmDv').textContent = p.d.toFixed(2);
document.getElementById('asmH').value = Math.round(p.h); document.getElementById('asmHv').textContent = Math.round(p.h);
document.getElementById('asmZ').value = Math.round(p.z); document.getElementById('asmZv').textContent = Math.round(p.z);
document.getElementById('asmC').value = p.color;
}
function openAssembler2(id){
ASM2.id = id || null;
ASM2.vw = { yaw: 0.7, pitch: 0.62, zoom: 1.15 };
const cf = id ? d.customFurn[id] : null;
ASM2.parts = (cf && cf.kind === 'asm2') ? JSON.parse(JSON.stringify(cf.parts)) : JSON.parse(JSON.stringify(ASM2_TPL.table.parts));
document.getElementById('asmName').value = cf ? cf.name : '';
ASM2.sel = ASM2.parts.length ? 0 : -1;
updateAsm2();
hint('asm', '拖动预览＝旋转 · 滚轮/双指＝缩放 · 点部件选中 · 点空白取消选中');
document.getElementById('asm').style.display = 'flex';
}
function closeAssembler2(){ document.getElementById('asm').style.display = 'none'; }
/* 预览手势：拖动旋转 / 滚轮缩放 / 双指捏合 / 点按选中 */
(function(){
const pv = document.getElementById('asmPreview');
const pMap = new Map();
let orbit = null, pinch0 = 0, zoom0 = 1;
pv.addEventListener('pointerdown', function(e){
pMap.set(e.pointerId, { x: e.clientX, y: e.clientY });
if (pMap.size === 2){
const pts = Array.from(pMap.values());
pinch0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
zoom0 = ASM2.vw.zoom;
orbit = null;
} else {
orbit = { moved: 0 };
}
});
pv.addEventListener('pointermove', function(e){
if (!pMap.has(e.pointerId)) return;
const prev = pMap.get(e.pointerId);
pMap.set(e.pointerId, { x: e.clientX, y: e.clientY });
if (pMap.size === 2){
const pts = Array.from(pMap.values());
const dd = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
if (pinch0 > 0){
ASM2.vw.zoom = Math.min(2.4, Math.max(0.5, zoom0 * dd / pinch0));
updateAsm2();
}
return;
}
if (!orbit) return;
const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
orbit.moved += Math.abs(dx) + Math.abs(dy);
ASM2.vw.yaw += dx * 0.011;
ASM2.vw.pitch = Math.min(1.05, Math.max(0.35, ASM2.vw.pitch + dy * 0.007));
updateAsm2();
});
function pvUp(e){
if (pMap.has(e.pointerId) && pMap.size === 1 && orbit && orbit.moved < 6){
const t = e.target.closest ? e.target.closest('[data-pi]') : null;
if (t){ ASM2.sel = Number(t.dataset.pi); updateAsm2(); }
else if (ASM2.sel >= 0){ ASM2.sel = -1; updateAsm2(); }
}
pMap.delete(e.pointerId);
if (pMap.size < 2) pinch0 = 0;
if (pMap.size === 0) orbit = null;
}
pv.addEventListener('pointerup', pvUp);
pv.addEventListener('pointercancel', pvUp);
pv.addEventListener('wheel', function(e){
e.preventDefault();
ASM2.vw.zoom = Math.min(2.4, Math.max(0.5, ASM2.vw.zoom * Math.exp(-e.deltaY * 0.0012)));
updateAsm2();
}, { passive: false });
})();
/* 圆盘摇杆：拖动方向＝移动方向（随视角），力度决定速度，松开自动回中 */
(function(){
const pad = document.getElementById('rv-joypad');
const knob = document.getElementById('rv-joyknob');
let pid = null, iv = null;
const R = 30;
function tick(){
const dx = Number(knob.dataset.x || 0), dy = Number(knob.dataset.y || 0);
const len = Math.hypot(dx, dy);
if (len < 5) return;
asmMoveVec(dx / len * Math.min(1, len / R), dy / len * Math.min(1, len / R));
}
function moveKnob(e){
const r = pad.getBoundingClientRect();
let dx = e.clientX - (r.left + r.width / 2);
let dy = e.clientY - (r.top + r.height / 2);
const len = Math.hypot(dx, dy);
if (len > R){ dx = dx / len * R; dy = dy / len * R; }
knob.dataset.x = dx; knob.dataset.y = dy;
knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
}
pad.addEventListener('pointerdown', function(e){
e.preventDefault();
pid = e.pointerId;
try { pad.setPointerCapture(pid); } catch (err) {}
moveKnob(e);
iv = setInterval(tick, 80);
});
pad.addEventListener('pointermove', function(e){ if (e.pointerId === pid) moveKnob(e); });
function release(e){
if (e.pointerId !== pid) return;
pid = null;
clearInterval(iv); iv = null;
knob.dataset.x = 0; knob.dataset.y = 0;
knob.style.transition = 'transform .15s';
knob.style.transform = 'translate(0,0)';
setTimeout(function(){ knob.style.transition = ''; }, 160);
}
pad.addEventListener('pointerup', release);
pad.addEventListener('pointercancel', release);
})();
/* 部件参数 */
[['asmW', 'w', 100], ['asmD', 'd', 100], ['asmH', 'h', 1], ['asmZ', 'z', 1]].forEach(function(cfg){
document.getElementById(cfg[0]).addEventListener('input', function(){
const p = ASM2.parts[ASM2.sel]; if (!p) return;
p[cfg[1]] = Number(this.value) / cfg[2];
updateAsm2();
});
});
document.getElementById('asmC').addEventListener('input', function(){
const p = ASM2.parts[ASM2.sel]; if (p){ p.color = this.value; updateAsm2(); }
});
document.getElementById('asmDel').addEventListener('click', function(){
if (ASM2.sel < 0) return;
ASM2.parts.splice(ASM2.sel, 1);
ASM2.sel = ASM2.parts.length ? Math.min(ASM2.sel, ASM2.parts.length - 1) : -1;
updateAsm2();
});
document.getElementById('asmDup').addEventListener('click', function(){
const p = ASM2.parts[ASM2.sel]; if (!p) return;
const c = JSON.parse(JSON.stringify(p));
c.x = Math.min(1.6, c.x + 0.22); c.y = Math.min(1.6, c.y + 0.22);
ASM2.parts.push(c);
ASM2.sel = ASM2.parts.length - 1;
updateAsm2();
});
document.querySelectorAll('.rv-addb').forEach(function(b){
b.addEventListener('click', function(){
const colors = ['#E9C79F', '#F4C9C5', '#9BB8D3', '#B5E0A0', '#C7B9E8', '#F2A56B'];
const p = { shape: b.dataset.shape, x: 0, y: 0, z: 0, w: 0.5, d: 0.5, h: 24, color: colors[ASM2.parts.length % colors.length] };
if (p.shape === 'ball'){ p.w = 0.45; p.d = 0.45; p.h = 0; }
ASM2.parts.push(p);
ASM2.sel = ASM2.parts.length - 1;
updateAsm2();
});
});
document.querySelectorAll('#asmTpl button').forEach(function(b){
b.addEventListener('click', function(){
ASM2.parts = JSON.parse(JSON.stringify(ASM2_TPL[b.dataset.tpl].parts));
ASM2.sel = ASM2.parts.length ? 0 : -1;
updateAsm2();
});
});
document.getElementById('asmCancel').addEventListener('click', closeAssembler2);
document.getElementById('asmX').addEventListener('click', closeAssembler2);
document.getElementById('asmSave').addEventListener('click', function(){
if (!ASM2.parts.length){ toast('还是空的，先添加部件或载入模板'); return; }
const snapshot = {
name: (document.getElementById('asmName').value || '').trim() || '组装家具',
kind: 'asm2', parts: JSON.parse(JSON.stringify(ASM2.parts))
};
if (ASM2.id){
d.customFurn[ASM2.id] = snapshot;
toast('已更新：' + snapshot.name);
} else {
const id = 'u' + Date.now().toString(36);
d.customFurn[id] = snapshot;
d.inv['u:' + id] = 1;
toast('「' + snapshot.name + '」已放入仓库，去摆放吧');
}
save(); renderAll(); closeAssembler2();
});
/* ================= 导入 / 导出 / 重置 ================= */
/* ================= 感应 ================= */
let senseCd = 0;
function sense(){
const now = Date.now();
if (now < senseCd){ toast('感应太频繁了，稍等一下'); return; }
senseCd = now + 4000;
const cx = (d.cols - 1) / 2, cy = (d.rows - 1) / 2;
const dx = d.ta.x - cx, dy = d.ta.y - cy;
const dist = Math.hypot(dx, dy);
let side;
if (dist < 1.2) side = '就在身边';
else if (Math.abs(dx) >= Math.abs(dy)) side = dx < 0 ? '左边' : '右边';
else side = dy < 0 ? '前面（窗边）' : '身后';
const out = document.getElementById('senseOut');
out.textContent = '你现在在房间中央。\n' + side + '：' + (dist <= 2.4 ? 'TA在。' : '说不上来……但在。');
out.style.display = 'block';
clearTimeout(out._t); out._t = setTimeout(function(){ out.style.display = 'none'; }, 6500);
}
/* ================= 场景事件 ================= */
const scene = document.getElementById('scene');
function scenePos(e){
const r = scene.getBoundingClientRect();
const s = cam.s || 1;
return [(e.clientX - r.left) / s, (e.clientY - r.top) / s];
}
/* TA：点按＝互动菜单 · 长按 500ms＝换装 · 长按 330ms 起拖＝搬动 TA */
const taEl = document.getElementById('ta');
let taLp = null, tadrag = null;
taEl.addEventListener('pointerdown', function(e){
if (mode || Date.now() < suppressClick) return;
e.preventDefault();
taLp = setTimeout(function(){ taLp = null; suppressClick = Date.now() + 600; lookMenu(); }, 500);
tadrag = { sx: e.clientX, sy: e.clientY, on: false, tile: null,
timer: setTimeout(function(){
if (!tadrag) return;
clearTimeout(taLp); taLp = null;
tadrag.on = true;
suppressClick = Date.now() + 500;
taEl.classList.add('rv-dragging');
try { taEl.setPointerCapture(e.pointerId); } catch (err) {}
hint('tadrag', '把 TA 拖到想去的位置，松开落脚');
}, 330) };
});
window.addEventListener('pointermove', function(e){
if (!tadrag || !tadrag.on) return;
const sp = scenePos(e);
const c = tileFromPoint(sp[0], sp[1]);
const ok = c.x >= 0 && c.x < d.cols && c.y >= 0 && c.y < d.rows;
tadrag.tile = ok ? c : null;
if (ok){
const p = A(c.x, c.y);
taEl.style.left = p[0] + 'px'; taEl.style.top = p[1] + 'px';
}
tileEls.forEach(function(t){
const x = Number(t.dataset.x), y = Number(t.dataset.y);
t.classList.toggle('rv-tgt', !!(ok && x === c.x && y === c.y));
t.classList.toggle('rv-hot', false);
});
});
window.addEventListener('pointerup', function(e){
if (!tadrag) return;
clearTimeout(tadrag.timer); clearTimeout(taLp);
if (tadrag.on && tadrag.tile){
d.ta.x = d.ta.tx = tadrag.tile.x;
d.ta.y = d.ta.ty = tadrag.tile.y;
d.ta.act = 'idle'; d.ta.nextAt = Date.now() + ri(24, 50) * 1000;
save();
bubble('……被你就这么搬过来了。');
}
taEl.classList.remove('rv-dragging');
tadrag = null;
renderAll(); refreshTiles();
});
scene.addEventListener('click', function(e){
if (Date.now() < suppressClick) return;
if (decoMode){
if (decoMode.tool === 'window'){ toast('在墙上拖出一个矩形，松开成窗'); return; }
const wg = e.target.closest('[data-wi]');
if (wg){
const winst = d.fx.find(function(z){ return z.i === wg.dataset.wi; });
if (winst){ furnMenu(winst); return; }
}
const sp = scenePos(e);
decoMode.wall = wallAt(sp[0], sp[1]);
renderAll(); updateDecoBar();
return;
}
if (e.target.closest('.rv-furn') || e.target.closest('#ta')) return;
const wg = e.target.closest('[data-wi]');
if (wg && !mode){
const winst = d.fx.find(function(z){ return z.i === wg.dataset.wi; });
if (winst){ furnMenu(winst); return; }
}
const t = e.target.closest('.rv-tile');
if (mode){
if (mode.kind === 'winwall'){ mode = null; refreshTiles(); toast('已退出开窗'); return; }
if (!t){ mode = null; refreshTiles(); toast('已取消'); return; }
const x = Number(t.dataset.x), y = Number(t.dataset.y);
if (mode.kind === 'place'){
if (!fitsAt(x, y, 1, 1, null)){ toast('这里被占用了'); return; }
d.fx.push({ i: 'f' + Date.now().toString(36) + ri(100, 999), t: mode.t, x: x, y: y, r: 0, w: 1, d: 1 });
d.inv[mode.t]--;
checkLevel(); save(); renderAll();
if ((d.inv[mode.t] || 0) > 0) toast('放好了（还剩 ' + d.inv[mode.t] + ' 件），继续点地板');
else { mode = null; refreshTiles(); toast('放好了'); }
} else if (mode.kind === 'move'){
const inst = d.fx.find(function(z){ return z.i === mode.i; });
if (!inst){ mode = null; refreshTiles(); return; }
if (!fitsAt(x, y, inst.w || 1, inst.d || 1, inst.i)){ toast('占地范围内有别的家具（可在菜单调占格）'); return; }
inst.x = x; inst.y = y; checkLevel(); save(); renderAll();
mode = null; refreshTiles(); toast('移好了');
}
return;
}
if (t) toast('空的地板。去「仓库」摆放，或长按已有家具拖动');
});
scene.addEventListener('mousemove', function(e){
if (mode || drag) return;
const sp = scenePos(e);
const c = tileFromPoint(sp[0], sp[1]);
const ok = c.x >= 0 && c.x < d.cols && c.y >= 0 && c.y < d.rows;
refreshTiles(ok ? c : null);
});
let drag = null;
document.getElementById('rv-furn').addEventListener('pointerdown', function(e){
const fu = e.target.closest('.rv-furn');
if (!fu || mode) return;
const inst = d.fx.find(function(z){ return z.i === fu.dataset.i; });
if (!inst) return;
drag = { i: inst.i, el: fu, sx: e.clientX, sy: e.clientY, on: false,
timer: setTimeout(function(){
if (!drag) return;
drag.on = true; suppressClick = Date.now() + 500;
drag.el.classList.add('rv-dragging');
refreshTiles();
hint('drag', '拖到目标位置，松开放下');
try { fu.setPointerCapture(e.pointerId); } catch (err) {}
}, 330) };
});
window.addEventListener('pointermove', function(e){
if (!drag || !drag.on) return;
const sp = scenePos(e);
const c = tileFromPoint(sp[0], sp[1]);
const inst = d.fx.find(function(z){ return z.i === drag.i; });
if (!inst) return;
const inGrid = c.x >= 0 && c.x < d.cols && c.y >= 0 && c.y < d.rows;
const ok = inGrid && fitsAt(c.x, c.y, inst.w || 1, inst.d || 1, inst.i);
const cover = {};
if (inGrid) cellsOf(c.x, c.y, inst.w || 1, inst.d || 1).forEach(function(cc){ cover[cc[0] + ',' + cc[1]] = 1; });
if (ok){
const p = A(c.x + ((inst.w || 1) - 1) / 2, c.y + ((inst.d || 1) - 1) / 2);
drag.el.style.left = p[0] + 'px'; drag.el.style.top = p[1] + 'px';
drag.el.style.zIndex = 999;
}
tileEls.forEach(function(t){
const x = Number(t.dataset.x), y = Number(t.dataset.y);
t.classList.toggle('rv-tgt', !!(cover[x + ',' + y] && ok));
t.classList.toggle('rv-bad', !!(cover[x + ',' + y] && !ok));
});
});
window.addEventListener('pointerup', function(e){
if (!drag) return;
clearTimeout(drag.timer);
const wasOn = drag.on, inst = d.fx.find(function(z){ return z.i === drag.i; });
if (wasOn && inst){
const sp = scenePos(e);
const c = tileFromPoint(sp[0], sp[1]);
if (fitsAt(c.x, c.y, inst.w || 1, inst.d || 1, inst.i)){
if (c.x !== inst.x || c.y !== inst.y){ inst.x = c.x; inst.y = c.y; checkLevel(); }
}
save(); renderAll();
}
drag = null;
refreshTiles();
});
document.getElementById('rv-furn').addEventListener('click', function(e){
if (Date.now() < suppressClick) return;
if (mode){ mode = null; refreshTiles(); toast('已取消'); return; }
const fu = e.target.closest('.rv-furn');
if (!fu) return;
const inst = d.fx.find(function(z){ return z.i === fu.dataset.i; });
if (inst) furnMenu(inst);
});
document.getElementById('ta').addEventListener('click', function(e){
if (Date.now() < suppressClick) return;
if (mode){ mode = null; refreshTiles(); toast('已取消'); return; }
taMenu();
});
/* 挂墙件拖动：长按 330ms 后在墙上滑动换位 */
function wallItemT(inst){
if (inst.geo) return { side: inst.geo.side, t: inst.geo.t };
if (inst.wp) return { side: inst.wp.side, t: inst.wp.t };
const c = catOf(inst.t);
const side = inst.x < d.cols / 2 ? 'L' : 'R';
let idx = 0;
for (let k = 0; k < d.fx.length; k++){
const f = d.fx[k];
if (f === inst) break; // 只数排在前面的同槽位件，与渲染顺序一致
const fc = catOf(f.t);
if (!fc || !fc.wall) continue;
if (!!fc.win !== !!c.win) continue;
if (f.geo || f.wp) continue;
if ((f.x < d.cols / 2 ? 'L' : 'R') === side) idx++;
}
const maxT = side === 'L' ? d.cols - 0.8 : d.rows - 0.8;
const t = c.win ? Math.min(1.1 + idx * 1.8, maxT) : (side === 'L' ? 0.7 + idx * 1.4 : 0.8 + idx * 1.4);
return { side: side, t: Math.min(t, maxT) };
}
let wdrag = null;
document.getElementById('static').addEventListener('pointerdown', function(e){
const g = e.target.closest('[data-wi]');
if (!g || mode || Date.now() < suppressClick) return;
const inst = d.fx.find(function(z){ return z.i === g.dataset.wi; });
if (!inst) return;
const st = wallItemT(inst);
const startWDrag = function(){
if (!wdrag) return;
wdrag.on = true;
suppressClick = Date.now() + 500;
try { g.setPointerCapture(e.pointerId); } catch (err) {}
hint('walldrag', '沿墙拖动换位，松开放定（窗户可上下调离地）');
};
wdrag = { i: inst.i, g: g, sx: e.clientX, sy: e.clientY, on: false,
side: st.side, t0: st.t, bot0: inst.geo ? inst.geo.bot : 24 * (inst.s || 1), dt: 0, nbot: null,
timer: decoMode ? (startWDrag(), null) : setTimeout(startWDrag, 330) };
});
window.addEventListener('pointermove', function(e){
if (!wdrag || !wdraj.on) return;
const inst = d.fx.find(function(z){ return z.i === wdrag.i; });
if (!inst){ wdrag = null; return; }
const wd = wallDefs().find(function(w){ return w.id === wdrag.side; });
const len = Math.hypot(wd.b1[0], wd.b1[1]);
const ux = wd.b1[0] / len, uy = wd.b1[1] / len;
const dx = e.clientX - wdrag.sx, dy = e.clientY - wdrag.sy;
const dTile = (dx * ux + dy * uy) / (len / wd.n);
const nt = Math.min(wd.n - 0.4, Math.max(0.4, wdrag.t0 + dTile));
wdrag.dt = nt - wdrag.t0;
let ty = 0;
if (inst.geo){
wdrag.nbot = Math.min(wd.H - 24, Math.max(8, Math.round(wdrag.bot0 - dy)));
ty = -(wdraj.nbot - wdrag.bot0);
}
const px = wdrag.dt * (len / wd.n) * ux, py = wdrag.dt * (len / wd.n) * uy;
wdrag.g.setAttribute('transform', 'translate(' + px.toFixed(1) + ',' + (py + ty).toFixed(1) + ')');
});
window.addEventListener('pointerup', function(e){
if (!wdrag) return;
clearTimeout(wdrag.timer);
const inst = d.fx.find(function(z){ return z.i === wdrag.i; });
if (wdraj.on && inst){
const nt = Math.round((wdraj.t0 + wdrag.dt) * 10) / 10;
if (inst.geo){
inst.geo.t = nt;
if (wdraj.nbot !== null) inst.geo.bot = wdrag.nbot;
} else {
inst.wp = { side: wdrag.side, t: nt };
}
save(); renderAll();
}
wdrag = null;
});
/* 地板涂刷（装修模式 floor 工具） */
let fpaint = false;
function paintTileAt(px, py){
const c = tileFromPoint(px, py);
if (c.x < 0 || c.x >= d.cols || c.y < 0 || c.y >= d.rows) return;
const key = c.x + ',' + c.y;
decoSnap();
if (decoMode.ferase) delete d.fcells[key];
else d.fcells[key] = decoMode.fcol;
const t = tileEls.find(function(el){ return Number(el.dataset.x) === c.x && Number(el.dataset.y) === c.y; });
if (t) t.setAttribute('fill', d.fcells[key] || (((c.x + c.y) % 2 === 0) ? FLOORS[d.floor].a : FLOORS[d.floor].b));
}
scene.addEventListener('pointerdown', function(e){
if (!decoMode || decoMode.tool !== 'floor') return;
if (!e.target.closest('.rv-tile')) return;
fpaint = true;
const sp = scenePos(e);
paintTileAt(sp[0], sp[1]);
try { scene.setPointerCapture(e.pointerId); } catch (err) {}
e.preventDefault();
});
window.addEventListener('pointermove', function(e){
if (!fpaint) return;
const sp = scenePos(e);
paintTileAt(sp[0], sp[1]);
});
window.addEventListener('pointerup', function(e){
if (!fpaint) return;
fpaint = false;
save();
});
/* ================= 开窗 / 装门：沿墙面拖框（墙面局部坐标，不是屏幕矩形）=================
原做法的问题：在斜墙上拖一个「屏幕正方形」，再把屏幕 x/y 直接当成墙上的格位与高度——
墙是平行四边形，右墙的基向量还是负的，于是宽度被算成负数、只能用最小值，落点也偏。
现在改成：把「按下」和「拖动」两点分别投影进墙面局部坐标 (t 沿墙 0..n, u 离地 0..H)，
预览画成贴合墙面的平行四边形，松手直接拿到精确的 起点/宽度/离地高度 —— 所见即所得。 */
function wallUV(w, p){
const t = w.n * (p[0] - w.O[0]) / w.b1[0];
const u = (t / w.n) * w.b1[1] - (p[1] - w.O[1]);
return { t: t, u: u };
}
function wallPt(w, t, u){
const k = t / w.n;
return [w.O[0] + k * w.b1[0], w.O[1] + k * w.b1[1] - u];
}
let band = null;
function bandBox(){
const w = band.w;
const t0 = Math.min(band.t0, band.t1), t1 = Math.max(band.t0, band.t1);
const u0 = Math.min(band.u0, band.u1), u1 = Math.max(band.u0, band.u1);
return { w: w, t0: t0, t1: t1, u0: u0, u1: u1 };
}
function drawBand(kind){
const el = document.getElementById('winband');
if (!el) return;
if (!band){ el.hidden = true; el.innerHTML = ''; return; }
const b = bandBox();
const p = [wallPt(b.w, b.t0, b.u0), wallPt(b.w, b.t1, b.u0), wallPt(b.w, b.t1, b.u1), wallPt(b.w, b.t0, b.u1)];
const pts = p.map(function(q){ return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' ');
const c = wallPt(b.w, (b.t0 + b.t1) / 2, (b.u0 + b.u1) / 2);
const dt = (b.t1 - b.t0), du = (b.u1 - b.u0);
const info = dt.toFixed(1) + ' 格宽 · 离地 ' + Math.round(b.u0) + ' · 高 ' + Math.round(du);
el.hidden = false;
el.innerHTML = '<svg width="' + SCENE_W + '" height="' + SCENE_H + '" style="position:absolute;left:0;top:0;overflow:visible">'
+ '<polygon points="' + pts + '" fill="' + (kind === 'door' ? 'rgba(201,162,39,.20)' : 'rgba(138,123,216,.20)') + '"'
+ ' stroke="' + (kind === 'door' ? '#C9A227' : '#8A7BD8') + '" stroke-width="2" stroke-dasharray="7 5"/>'
+ '<text x="' + c[0].toFixed(1) + '" y="' + (c[1] - 8).toFixed(1) + '" font-size="12" fill="#6c5fc0" text-anchor="middle">' + info + '</text></svg>';
return info;
}
scene.addEventListener('pointerdown', function(e){
const t = decoMode && decoMode.tool;
const wallTool = (mode && mode.kind === 'winwall') || t === 'window' || t === 'door';
if (!wallTool) return;
if (e.target.closest('.rv-furn') || e.target.closest('#ta') || e.target.closest('.rv-tile') || e.target.closest('[data-wi]')) return;
const sp = scenePos(e);
const wid = wallAt(sp[0], sp[1]);
if (!wid){ toast('请在墙面上拖出一个范围'); return; }
const w = wallDefs().find(function(x){ return x.id === wid; });
if (!w) return;
const uv = wallUV(w, sp);
const kind = (mode && mode.kind === 'winwall') ? 'window' : t;
band = { w: w, kind: kind, t0: uv.t, u0: uv.u, t1: uv.t, u1: uv.u };
drawBand(kind);
try { scene.setPointerCapture(e.pointerId); } catch (err) {}
e.preventDefault();
});
window.addEventListener('pointermove', function(e){
if (!band) return;
const sp = scenePos(e);
const uv = wallUV(band.w, sp);
const maxU = band.w.H - (band.kind === 'door' ? 8 : 30);
band.t1 = Math.max(0, Math.min(band.w.n, uv.t));
band.u1 = Math.max(0, Math.min(maxU, uv.u));
drawBand(band.kind);
});
window.addEventListener('pointerup', function(e){
if (!band) return;
const kind = band.kind;
const b = bandBox();
band = null;
drawBand(kind);
mode = null; refreshTiles();
const dt = b.t1 - b.t0, du = b.u1 - b.u0;
const minDt = kind === 'door' ? 0.7 : 0.25, minDu = kind === 'door' ? 70 : 22;
if (dt < minDt || du < minDu){
toast(kind === 'door' ? '门至少要 1 格宽、比人高一点' : '框选范围太小，再拖大一点');
if (decoMode){ decoMode.tool = 'edit'; updateDecoBar(); }
return;
}
const horiz = (b.w.id === 'L' || b.w.id === 'F1');
const wpSide = b.w.id, wpT = Math.round(((b.t0 + b.t1) / 2) * 10) / 10;
const spec = {
i: 'g' + Date.now().toString(36) + ri(100, 999),
t: kind === 'door' ? 'door' : 'win_rect',
x: horiz ? 1 : (d.cols - 1), y: 0, r: 0,
wp: { side: wpSide, t: wpT }
};
if (kind === 'door'){
const cost = 26;
if (d.pts < cost){ toast('装一扇门需要 ' + cost + ' 点'); return; }
d.pts -= cost;
decoSnap();
d.fx.push(spec);
toast('门装好了（' + cost + ' 点）· 点门可以开合/换墙');
} else {
const ws = Math.max(0.5, Math.min(3, dt / 1.2));
const hs = Math.max(0.5, Math.min(2, du / 72));
const bot = Math.max(8, Math.round(b.u0));
spec.geo = { side: wpSide, t: Math.round(((b.t0 + b.t1) / 2) * 10) / 10, bot: bot, ws: Math.round(ws * 100) / 100, hs: Math.round(hs * 100) / 100 };
delete spec.wp;
const cost = Math.round(15 + ws * hs * 10);
if (d.pts < cost){ toast('开这扇窗需要 ' + cost + ' 点'); return; }
d.pts -= cost;
decoSnap();
d.fx.push(spec);
toast('窗开好啦（' + cost + ' 点）· 点窗可换样式、调窗台高度与窗框色');
}
checkLevel(); save(); renderAll();
if (decoMode){ decoMode.tool = 'edit'; updateDecoBar(); }
});
/* ================= 导出 / 导入（可选范围 · 复制与文件双通道） =================
导出范围：
all  ＝整个小屋（含户型/墙/地板/人物/家具/自绘）
look ＝人物（换装配色 + 手绘脸型/头发/五官/衣服）
furn ＝家具（摆放位置 + 仓库 + 点数等级 + 自绘/组装家具）
art  ＝只有自绘（手绘人物层 + 手绘/组装家具 + 墙面纹样）—— 分享给别人最常用
导入：按 JSON 里出现的字段合并，所以「只导入人物」这种半份存档也能直接用。 */
const EXPORT_SCOPES = [
{ k: 'all',  n: '整体' },
{ k: 'look', n: '人物' },
{ k: 'furn', n: '家具' },
{ k: 'art',  n: '自绘' }
];
let exportScope = 'all';
function exportData(k){
if (k === 'look') return { look: d.look, lookArt: d.lookArt };
if (k === 'furn') return { fx: d.fx, inv: d.inv, pts: d.pts, lv: d.lv, customFurn: d.customFurn, vaseFlower: d.vaseFlower };
if (k === 'art')  return { lookArt: d.lookArt, customFurn: d.customFurn, walls: d.walls, fcells: d.fcells, fcol: d.fcol };
return JSON.parse(JSON.stringify(d));
}
function exportText(k){
return JSON.stringify({ app: 'mochi-iso-room', ver: 4, scope: k, data: exportData(k) });
}
function fallbackCopy(t){
try {
const ta = document.createElement('textarea');
ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, 999999);
document.execCommand('copy'); ta.remove();
toast('已复制到剪贴板');
} catch (e) { toast('复制失败，请长按文本框全选复制'); }
}
function copyText(t){
try {
if (navigator.clipboard && navigator.clipboard.writeText){
navigator.clipboard.writeText(t).then(function(){ toast('已复制到剪贴板'); }, function(){ fallbackCopy(t); });
} else fallbackCopy(t);
} catch (e) { fallbackCopy(t); }
}
function exportMenu(k){
if (k) exportScope = k;
openPanel('导出小屋', '先选要导出哪部分，再决定复制还是存文件', EXPORT_SCOPES.map(function(s){
return { label: s.n, sel: exportScope === s.k, cb: function(){ exportMenu(s.k); } };
}), {
grid: true,
html: '<div class="rv-frow"><button class="rv-mini-btn" id="expCopy">复制到剪贴板</button>'
+ '<button class="rv-mini-btn" id="expFile">下载为文件</button></div>'
+ '<textarea class="rv-ta" id="expTa" readonly></textarea>',
onReady: function(box){
const ta = box.querySelector('#expTa');
ta.value = exportText(exportScope);
box.querySelector('#expCopy').addEventListener('click', function(){ copyText(ta.value); });
box.querySelector('#expFile').addEventListener('click', function(){
try {
const blob = new Blob([ta.value], { type: 'application/json' });
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'mochi-room-' + exportScope + '.json';
document.body.appendChild(a); a.click(); a.remove();
setTimeout(function(){ try { URL.revokeObjectURL(a.href); } catch (e) {} }, 2000);
toast('文件已开始下载');
} catch (e) { toast('下载失败，请改用「复制到剪贴板」'); }
});
}
});
}
function applyImport(o){
if (!o || typeof o !== 'object') return false;
const keys = ['look', 'lookArt', 'fx', 'inv', 'pts', 'lv', 'customFurn', 'walls', 'fcells', 'fcol',
'cols', 'rows', 'wallH', 'stack', 'followSys', 'night', 'bright', 'vaseFlower', 'ta', 'lit'];
let n = 0;
keys.forEach(function(k){ if (o[k] !== undefined){ d[k] = o[k]; n++; } });
if (!n) return false;
d = fix(d);
save(); layoutRoom(); renderAll(); refreshTiles();
return true;
}
function importMenu(){
openPanel('导入小屋', '粘贴文本或选文件；只含一部分（比如只有人物）也能导入', [
{ html: '<textarea class="rv-ta" id="impTa" placeholder="把导出的 JSON 粘贴到这里"></textarea>', stay: true, cb: function(){} },
{ label: '选择文件…', cb: function(){
const inp = document.createElement('input');
inp.type = 'file'; inp.accept = '.json,application/json';
inp.addEventListener('change', function(){
const f = inp.files && inp.files[0]; if (!f) return;
const rd = new FileReader();
rd.onload = function(){
importMenu();
const ta = document.getElementById('impTa');
if (ta) ta.value = String(rd.result);
toast('已读取文件，点「导入」确认');
};
rd.readAsText(f);
});
inp.click();
} },
{ label: '导入', cb: function(){
const ta = document.getElementById('impTa');
let obj = null;
try { obj = JSON.parse((ta && ta.value) || ''); } catch (e) {}
if (!obj || !obj.data){ toast('格式不对，导入失败'); return; }
if (!applyImport(obj.data)){ toast('这份存档里没有可用的内容'); return; }
toast('导入成功');
} },
{ sec: '或者' },
{ label: '重置小屋（清空一切，回到初始）', cb: function(){
if (!confirm('确定要重置吗？当前的小屋、画作和换装都会清空。')) return;
d = fresh(); save(); renderAll(); refreshTiles(); toast('已重置');
} }
], { cols: 1, grid: true });
}
/* ================= 控制按钮 v4（5 键 + 长按手势） ================= */
function setRow(k, label, note){
return { stay: true, html:
'<div class="rv-set"><span class="rv-set-l">' + label + (note ? '<i>' + note + '</i>' : '') + '</span>'
+ '<i class="rv-tg' + (d[k] ? ' on' : '') + '" data-sw="' + k + '"><b></b></i></div>',
cb: function(el){
d[k] = !d[k]; save(); renderAll();
const t = el && el.querySelector('.rv-tg'); if (t) t.classList.toggle('on', !!d[k]);
if (k === 'stack') toast(d.stack ? '家具可以叠放了' : '已关闭家具叠放');
if (k === 'followSys') toast(d.followSys ? '已跟随手机夜间模式' : '已改为手动切换昼夜');
} };
}
function actRow(label, note, cb){
return { stay: true, html: '<div class="rv-set rv-set-act"><span class="rv-set-l">' + label
+ (note ? '<i>' + note + '</i>' : '') + '</span><i class="rv-chev"></i></div>', cb: cb };
}
function moreMenu(){
openPanel('小屋设置', '点一下即可开关 · 立即生效', [
{ html: '<div class="rv-set rv-set-bright"><span class="rv-set-l">亮度</span>'
+ '<input type="range" id="mBright" min="50" max="150" value="' + Math.round((d.bright || 1) * 100) + '">'
+ '<b id="mBrightV">' + Math.round((d.bright || 1) * 100) + '%</b></div>', stay: true, cb: function(){} },
{ html: '<div class="rv-set rv-set-rec"><span class="rv-set-l">亮度推荐值<i>100% 最接近设计稿的画面</i></span>'
+ '<button class="rv-mini-btn" id="mBrightRec">用推荐值 100%</button></div>', stay: true, cb: function(){} },
setRow('followSys', '跟随手机夜间模式', '系统深色时小屋也入夜'),
setRow('stack', '允许家具叠放', '关掉时家具不能重叠摆放'),
actRow('感应 TA 的位置', '看看 TA 此刻在屋里哪儿', sense),
actRow('给 TA 换装', '也可以长按 TA 打开', lookMenu),
{ sec: '导入导出' },
actRow('导出小屋', '整体 / 人物 / 家具 / 自绘，可复制也可存文件', function(){ exportMenu(); }),
actRow('导入小屋', '粘贴文本或选文件；重置也在这里', function(){ importMenu(); })
], {
cols: 1, grid: true,
onReady: function(box){
const r = box.querySelector('#mBright'), v = box.querySelector('#mBrightV');
const apply = function(){
const n = Number(r.value) / 100;
d.bright = n;
if (page) page.style.setProperty('--rv-bright', n);
if (v) v.textContent = Math.round(n * 100) + '%';
save();
};
r.addEventListener('input', apply);
apply();
const rec = box.querySelector('#mBrightRec');
if (rec) rec.addEventListener('click', function(){ r.value = 100; apply(); toast('亮度已回到推荐的 100%'); });
}
});
}
document.getElementById('bInv').addEventListener('click', invMenu);
document.getElementById('bRoom').addEventListener('click', function(){ decoMode ? exitDeco() : enterDeco(); });
document.getElementById('bStudio').addEventListener('click', function(){
const la = d.lookArt || {};
hint('studio', '画完点「保存」，直接穿在身上');
openPanel(' 自绘', '画完直接穿上 / 摆进房间 · 支持 8–24 格画布、色盘自选、移动色块', [
{ sec: '给 TA 画' },
{ label: la.shape ? '脸型 ' : '画脸型', thumb: artThumb(la.shape), cb: function(){ openStudio({ kind: 'shape' }); } },
{ label: la.hair ? '头发 ' : '画头发', thumb: artThumb(la.hair), cb: function(){ openStudio({ kind: 'hair' }); } },
{ label: la.face ? '五官 ' : '画五官', thumb: artThumb(la.face), cb: function(){ openStudio({ kind: 'face' }); } },
{ label: la.top ? '上衣 ' : '画上衣', thumb: artThumb(la.top), cb: function(){ openStudio({ kind: 'top' }); } },
{ label: la.bottom ? '裤子 ' : '画裤子', thumb: artThumb(la.bottom), cb: function(){ openStudio({ kind: 'bottom' }); } },
{ sec: '家具与墙面' },
{ label: '手绘家具', thumb: '<span style="font-size:30px">🖼</span>', cb: function(){ openStudio({ kind: 'rv-furn' }); } },
{ label: '组装家具', badge: '', thumb: '<span style="font-size:30px"></span>', cb: function(){ openAssembler2(); } },
{ label: '墙壁纹样', thumb: '<span style="font-size:28px"></span>', cb: function(){
const items = [];
['L', 'R', 'F1', 'F2'].forEach(function(id){
const w = d.walls[id];
if (w) items.push({ label: WALL_NAMES[id] + (w.a ? '（已有纹样）' : ''), thumb: artThumb(w.a), cb: function(){ openStudio({ kind: 'wall', wall: id }); } });
});
openPanel(' 给哪面墙绘纹样', '画好的纹样会沿墙平铺', items, { grid: true });
} },
{ label: '重置全部手绘', thumb: '<span style="font-size:28px"></span>', cb: function(){
d.lookArt = {}; save(); renderTA(); toast('已清除全部手绘层');
} }
], { grid: true });
});
document.getElementById('decoExit').addEventListener('click', exitDeco);
window.addEventListener('keydown', function(e){ if (e.key === 'Escape' && decoMode) exitDeco(); });
document.getElementById('daynight').addEventListener('click', function(){
d.night = isNight() ? 'd' : 'n';
d.followSys = false;
save(); renderAll();
hint('dn', '「设置」里可开启跟随手机夜间模式');
bubble(isNight() ? rnd(FB.night) : rnd(FB.enter));
});
document.getElementById('bMore').addEventListener('click', moreMenu);
/* 长按手势（少按键：功能藏进长按）
长按 TA ＝ 换装 · 长按空地 ＝ 仓库 · 长按家具 ＝ 拖动（原有） */
(function(){
const sc = document.getElementById('scene');
let lpS = null, sx = 0, sy = 0;
sc.addEventListener('pointerdown', function(e){
if (mode || Date.now() < suppressClick) return;
if (decoMode) return;
if (e.target.closest('.rv-furn') || e.target.closest('#ta') || e.target.closest('[data-wi]')) return;
sx = e.clientX; sy = e.clientY;
if (e.target.closest('.rv-tile')) lpS = setTimeout(function(){ lpS = null; suppressClick = Date.now() + 600; invMenu(); }, 500);
else if (e.target.closest('#static')) lpS = setTimeout(function(){ lpS = null; suppressClick = Date.now() + 600; wallMenu(); }, 500);
});
['pointerup','pointercancel'].forEach(function(ev){ sc.addEventListener(ev, function(){ clearTimeout(lpS); lpS = null; }); });
sc.addEventListener('pointermove', function(e){
if (lpS && Math.hypot(e.clientX - sx, e.clientY - sy) > 10){ clearTimeout(lpS); lpS = null; }
});
})();
/* ================= 视口相机：双指缩放 / 单指平移 =================
cam.s 当前缩放，cam.tx/ty 平移；cam.fitS 是「整屋刚好装进视口」的适配比例。
用户没手动动过（cam.user=false）时只做适配并居中；动过之后按相对倍率跟随适配。 */
const cam = { s: 1, tx: 0, ty: 0, fitS: 1, user: false, ratio: 1 };
function viewEl(){ return document.getElementById('rio-view'); }
function vw(){ var el = viewEl(); return (el && el.clientWidth) || window.innerWidth || 320; }
function vh(){ var el = viewEl(); return (el && el.clientHeight) || window.innerHeight || 480; }
function applyCam(){
const st = document.getElementById('stage');
if (!st) return;
st.style.transform = 'translate(' + cam.tx.toFixed(1) + 'px,' + cam.ty.toFixed(1) + 'px) scale(' + cam.s.toFixed(4) + ')';
}
function computeFit(){
const s = Math.min((vw() - 10) / SCENE_W, (vh() - 118) / SCENE_H);
return Math.max(0.14, Math.min(1.8, s));
}
function clampCam(){
const W = SCENE_W * cam.s, H = SCENE_H * cam.s;
const keepX = Math.min(W, vw()) * 0.34, keepY = Math.min(H, vh()) * 0.34;
cam.tx = Math.max(-W + keepX, Math.min(vw() - keepX, cam.tx));
cam.ty = Math.max(-H + keepY, Math.min(vh() - keepY, cam.ty));
}
function centerCam(){ cam.tx = (vw() - SCENE_W * cam.s) / 2; cam.ty = (vh() - SCENE_H * cam.s) / 2; }
function minS(){ return computeFit() * 0.55; }
function maxS(){ return computeFit() * 4; }
function fit(keepUser){
const f = computeFit();
cam.fitS = f;
if (!cam.user || !keepUser){ cam.s = f; centerCam(); }
else { cam.s = Math.max(minS(), Math.min(maxS(), f * (cam.ratio || 1))); }
cam.ratio = cam.fitS ? cam.s / cam.fitS : 1;
clampCam(); applyCam();
}
function resetCam(){ cam.user = false; cam.ratio = 1; fit(true); }
/* ---- 手势：单指平移 / 双指捏合缩放（围绕两指中点）---- */
const ptrs = new Map();
let panG = null, pinchG = null;
function pdist(){
const a = Array.from(ptrs.values());
return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
}
function pmid(){
const a = Array.from(ptrs.values());
const r = viewEl().getBoundingClientRect();
return { x: (a[0].x + a[1].x) / 2 - r.left, y: (a[0].y + a[1].y) / 2 - r.top };
}
function gestureBusy(){
if (mode) return true;
if (drag && drag.on) return true;
if (typeof tadrag !== 'undefined' && tadrag && tadrag.on) return true;
if (decoMode) return true;
return false;
}
function bindCamera(){
const view = viewEl();
if (!view || view._camBound) return;
view._camBound = true;
view.addEventListener('pointerdown', function(e){
const onUI = !!(e.target && e.target.closest && e.target.closest('button, #hud, .rv-xclose'));
ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, ui: onUI });
if (ptrs.size === 2){
panG = null;
pinchG = { d0: pdist(), s0: cam.s, mid0: pmid(), tx0: cam.tx, ty0: cam.ty };
cam.user = true;
suppressClick = Date.now() + 400;
e.preventDefault();
}
}, { passive: false });
view.addEventListener('pointermove', function(e){
if (!ptrs.has(e.pointerId)) return;
const p = ptrs.get(e.pointerId);
p.x = e.clientX; p.y = e.clientY;
if (ptrs.size >= 2 && pinchG){
const k = pdist() / (pinchG.d0 || 1);
const s1 = Math.max(minS(), Math.min(maxS(), pinchG.s0 * k));
const m = pmid();
cam.s = s1;
cam.tx = m.x - (pinchG.mid0.x - pinchG.tx0) * (s1 / pinchG.s0);
cam.ty = m.y - (pinchG.mid0.y - pinchG.ty0) * (s1 / pinchG.s0);
cam.ratio = cam.fitS ? cam.s / cam.fitS : 1;
clampCam(); applyCam();
e.preventDefault();
return;
}
if (!pinchG && ptrs.size === 1){
if (!panG){
if (gestureBusy() || p.ui) return;
if (Math.hypot(p.x - p.x0, p.y - p.y0) < 12) return;   // >12px 才起手：同时让长按自己取消
panG = { tx0: cam.tx, ty0: cam.ty, x0: p.x, y0: p.y };
cam.user = true;
suppressClick = Date.now() + 400;
}
cam.tx = panG.tx0 + (p.x - panG.x0);
cam.ty = panG.ty0 + (p.y - panG.y0);
clampCam(); applyCam();
}
}, { passive: false });
const end = function(e){
ptrs.delete(e.pointerId);
if (ptrs.size < 2) pinchG = null;
if (ptrs.size === 0) panG = null;
};
view.addEventListener('pointerup', end);
view.addEventListener('pointercancel', end);
view.addEventListener('pointerleave', end);
let lastTap = 0;
view.addEventListener('click', function(e){
if (Date.now() < suppressClick) return;
if (e.target.closest('button') || e.target.closest('#hud')) return;
const now = Date.now();
if (now - lastTap < 320){ resetCam(); toast('视角已复位'); }
lastTap = now;
});
}
window.addEventListener('resize', function(){ if (page && !page.hidden) fit(true); });
/* ================= 启动 / 入口 ================= */
function openRoom(){
d = load();
backupOnce();
closePanel(); closeModal2();
Array.prototype.forEach.call(document.querySelectorAll('.page'), function(p){ p.hidden = (p !== page); });
if (!page) return;
page.hidden = false;
mode = null;
layoutRoom();
if (Date.now() >= (d.ta.nextAt || 0)) pickAction();
resetCam();
renderAll();
refreshTiles();
const settle = function(){ if (!page.hidden && !cam.user) fit(true); };
requestAnimationFrame(function(){ requestAnimationFrame(settle); });
setTimeout(settle, 340);
setTimeout(function(){ if (!page.hidden) bubble(isNight() ? rnd(FB.night) : rnd(FB.enter)); }, 600);
}
function closeRoom(toChat){
save();
mode = null;
if (decoMode) { try { exitDeco(); } catch (e) {} }
if (page) page.hidden = true;
Array.prototype.forEach.call(document.querySelectorAll('.page'), function(p){ p.hidden = true; });
const target = document.getElementById(toChat ? 'page-chat' : 'page-phone');
if (target) target.hidden = false;
}
function bindEntry(){
const icon = document.querySelector('.app[data-app="room"]');
if (icon && !icon._rioBound){
icon._rioBound = true;
icon.addEventListener('click', function(e){
try { if (Array.prototype.some.call(document.querySelectorAll('.app-grid'), function(g){ return g.classList.contains('editing'); })) return; } catch (er) {}
e.stopPropagation();
window.__roomFrom = '';
openRoom();
});
}
const more = document.getElementById('more-room');
if (more && !more._rioBound){
more._rioBound = true;
more.addEventListener('click', function(e){
e.stopPropagation();
const mp = document.getElementById('chat-more-panel'); if (mp) mp.hidden = true;
window.__roomFrom = 'chat';
openRoom();
});
}
const hudEl = document.getElementById('hud');
if (hudEl && !hudEl._rioBound){
hudEl._rioBound = true;
hudEl.addEventListener('click', function(e){
if (!e.target.closest('.rv-hud-toggle')) return;
d.hudMin = !d.hudMin; save(); updHud();
});
}
const back = document.getElementById('room-back');
if (back && !back._rioBound){
back._rioBound = true;
back.addEventListener('click', function(e){
e.stopPropagation();
const toChat = window.__roomFrom === 'chat';
window.__roomFrom = '';
closeRoom(toChat);
});
}
}
if (page){
page.hidden = true;                     // 初始隐藏，由入口 openRoom() 打开
d = load();                             // 先备好数据：layoutRoom/renderAll/fit 全都读 d
bindEntry();
bindCamera();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(){
if (d.followSys && !page.hidden) renderAll();
});
document.addEventListener('contact-switched', function(){
d = load();
if (!page.hidden){ resetCam(); renderAll(); refreshTiles(); }
});
document.addEventListener('mochi-restore-done', function(){
if (!page || !roomLoadUncertain) return;
d = load();
if (!page.hidden){ resetCam(); renderAll(); refreshTiles(); }
});
document.addEventListener('mochi-restore-slow', function(){
if (!roomLoadUncertain) return;
if (roomKeyUnread()) return;
roomLoadUncertain = false;
});
}
window.openRoom = openRoom;
window.closeRoom = closeRoom;
window.__roomIsoState = function(){ return JSON.parse(JSON.stringify(d)); };
window.__room = {
state: function(){ return JSON.parse(JSON.stringify(d)); },
open: openRoom, close: closeRoom, cam: cam, fit: fit, resetCam: resetCam,
scenePos: scenePos, layout: layoutRoom, render: renderAll,
tileAt: function(clientX, clientY){ var sp = scenePos({ clientX: clientX, clientY: clientY }); return tileFromPoint(sp[0], sp[1]); },
inv: invMenu, deco: function(){ decoMode ? exitDeco() : enterDeco(); }, studio: openStudio, asm: openAssembler2, menu: moreMenu,
wallPoint: function(side, t, u){ var w = wallDefs().find(function(x){ return x.id === side; }); return w ? wallPt(w, t, u) : null; },
fx: function(){ return d.fx; }, decoState: function(){ return decoMode; },
decoUndo: function(){ return decoUndo.length; }, save: save, snap: decoSnap, undo: decoUndoStep, decoSave: decoSave
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("room-iso.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("room-iso.js"); try { console.error("[JS] room-iso.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[room-iso.js] " + String(__e && __e.message || __e)); } })();