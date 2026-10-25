// ===== 房间数据内核回归测试（纯 Node，无浏览器/无存储） =====
// 运行：node tools/verify-room-core.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';
const code = readFileSync(join(root, 'src/js/room-core.js'), 'utf8');
const ctx = vm.createContext({ console });
vm.runInContext(code, ctx);
const Core = ctx.RoomCore;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}
function eq(name, a, b) {
  ok(name, JSON.stringify(a) === JSON.stringify(b), 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
function noThrow(name, fn) {
  try { const v = fn(); ok(name, true); return v; }
  catch (e) { fail++; console.error('  ✗ ' + name + ' → ' + e.message); }
}
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

console.log('\n[1] 默认存档与版本');
{
  const f = Core.fresh();
  ok('fresh 有 schema', f.schema === Core.VERSION);
  ok('默认家具 7 件', f.fx.length === 7);
  ok('默认格子合法', f.cols >= 4 && f.rows >= 3);
  const n = Core.normalize(f);
  ok('fresh 二次归一化无异常', n.data.fx.length === 7 && n.issues.length === 0, n.issues.join(','));
}

console.log('\n[2] 脏数据永不抛异常');
{
  const inputs = [null, undefined, 0, 'x', [], [1, 2], { fx: null }, { fx: [null, 1, 'x'] }, { look: 'x' }, { ta: [] }, { walls: 'x' }];
  inputs.forEach((v, i) => {
    const n = noThrow('输入 #' + i + ' 可归一化', () => Core.normalize(v));
    if (!n) return;
    ok('输入 #' + i + ' 结构完整', n.data && Array.isArray(n.data.fx) && n.data.ta && n.data.walls);
  });
}

console.log('\n[3] 旧版本迁移');
{
  const n = Core.normalize({ schema: 4, cols: 6, rows: 4, winL: [{ s: 'arch' }], winR: [{ s: 'round' }] });
  ok('winL/winR 迁移成家具', n.data.fx.filter(it => /^win_/.test(it.t)).length === 2, n.data.fx.map(i => i.t).join(','));
  const a = Core.normalize({ schema: 2, lookArt: { hair: ['0'.repeat(12), 'F'.repeat(12)] } });
  ok('v2 像素画迁移成 v3 对象', a.data.lookArt.hair && a.data.lookArt.hair.rows.length === 12);
}

console.log('\n[4] 颜色/名字/HTML 注入');
{
  eq('合法六位色', Core.safeColor('#AABBCC'), '#aabbcc');
  eq('三位色归一化', Core.safeColor('#ABC'), '#aabbcc');
  eq('带引号的伪颜色被拒', Core.safeColor('#fff" onload="alert(1)'), null);
  eq('url() 被拒', Core.safeColor('url(javascript:1)'), null);
  eq('rgba 被拒', Core.safeColor('rgba(0,0,0,.5)'), null);
  eq('名字去掉 HTML 元字符', Core.safeText('<img src=x onerror=1>沙发'), 'img src=x onerror=1沙发');
  ok('esc 转义', Core.esc('<b>&"') === '&lt;b&gt;&amp;&quot;');
  const n = Core.normalize({
    customFurn: { evil: { name: '<svg onload=alert(1)>', art: { s: 4, pal: ['#fff" onload="x', '#123456'], rows: ['00..', '....'] } } },
    walls: { L: { c: 'url(x)' }, R: { c: '#112233' } },
    fcells: { '0,0': '"><image href=x>' },
    accent: 'javascript:1'
  });
  ok('非法颜色回落到默认', n.data.walls.L.c === '#f7efe2' && n.data.accent === '#8a7bd8');
  ok('非法地板色被丢弃', Object.keys(n.data.fcells).length === 0);
  ok('非法调色板色被丢弃', n.data.customFurn.evil.art.pal.length === 1 && n.data.customFurn.evil.art.pal[0] === '#123456');
  ok('名字无尖括号', !/[<>]/.test(n.data.customFurn.evil.name));
  eq('safeType 拒绝原型键', Core.safeType('__proto__'), null);
  eq('safeStyle 拒绝原型键', Core.safeStyle('constructor', 'cream'), 'cream');
}

console.log('\n[4b] 原型链键');
{
  const n = Core.normalize(JSON.parse('{"style":"__proto__","floor":"constructor","fx":[{"i":"__proto__","t":"bed","x":1,"y":1}],"customFurn":{"__proto__":{"name":"x","art":{"s":4,"pal":["#123456"],"rows":["00"]}}},"hints":{"__proto__":true}}'));
  eq('style 原型键回落', n.data.style, 'cream');
  eq('floor 原型键回落', n.data.floor, 'wood');
  ok('customFurn 不落原型键', !Object.prototype.hasOwnProperty.call(n.data.customFurn, '__proto__'));
  ok('fx 原型 ID 被换掉', n.data.fx[0].i !== '__proto__');
  ok('hints 不落原型键', !Object.prototype.hasOwnProperty.call(n.data.hints, '__proto__'));
}

console.log('\n[5] ID / 占格 / 悬空引用');
{
  const n = Core.normalize({
    cols: 5, rows: 4,
    fx: [
      { i: 'dup', t: 'bed', x: 1, y: 1 },
      { i: 'dup', t: 'chair', x: 2, y: 2 },
      { i: 'wallwin', t: 'win_rect', x: 1, y: 0 },
      { i: 'bad', t: 'no spaces allowed', x: 0, y: 0 }
    ],
    inv: { 'u:ghost': 2, bed: 1, 'bad type': 1 },
    lit: { dup: true, ghost: true }
  });
  const ids = n.data.fx.map(i => i.i);
  ok('重复 ID 被拆开', ids.length === 3 && new Set(ids).size === 3, ids.join(','));
  ok('非法类型被丢弃', !n.data.fx.some(i => i.t === 'no spaces allowed'));
  ok('悬空自定义仓库被清掉', !('u:ghost' in n.data.inv));
  ok('lit 只保留在场家具', n.data.lit.ghost === undefined && Object.keys(n.data.lit).length === 1);
  const isWall = t => /^win_|^door$|^painting$|^mirror$/.test(t);
  const wall = n.data.fx.find(i => i.t === 'win_rect');
  ok('墙面件不占地板格', Core.itemAt(n.data.fx, wall.x, wall.y, isWall) === null);
  ok('同格可放地板家具', Core.canPlace(n.data, wall.x, wall.y, 1, 1, null, isWall));
  ok('越界放置被拒', !Core.canPlace(n.data, 99, 0, 1, 1, null, isWall));
  ok('叠放开关生效', Core.canPlace(Object.assign({}, n.data, { stack: true }), 1, 1, 3, 3, null, isWall));
}

console.log('\n[6] 数值边界');
{
  const n = Core.normalize({
    cols: 999, rows: -5, wallH: 9999, pts: -10, lv: 99, bright: 9,
    look: { h: 9, style: 'hacker', skin: '#000' },
    ta: { x: 99, y: 99, tx: -3, ty: 0, act: 'fly', nextAt: Date.now() + 99999999 },
    fx: [{ i: 'a', t: 'bed', x: 99, y: -2, w: 99, d: -1, vs: 99, sc: 0 }]
  });
  eq('cols/rows 被钳制', [n.data.cols, n.data.rows], [10, 3]);
  eq('wallH 被钳制', n.data.wallH, 220);
  eq('点数不为负', n.data.pts, 0);
  eq('等级 1..5', n.data.lv, 5);
  eq('亮度 0.5..1.5', n.data.bright, 1.5);
  ok('身高/发型被钳制', n.data.look.h === 1.35 && n.data.look.style === 'short');
  ok('TA 在格内', n.data.ta.x < n.data.cols && n.data.ta.y < n.data.rows && n.data.ta.act === 'idle');
  ok('家具参数被钳制', n.data.fx[0].x < 10 && n.data.fx[0].y >= 0 && n.data.fx[0].w >= 1 && n.data.fx[0].vs <= 1.8 && n.data.fx[0].sc >= 0.7);
  ok('TA nextAt 不会冻结到未来一天', n.data.ta.nextAt <= Date.now() + 3600000);
}

console.log('\n[7] 容量上限');
{
  const fx = [];
  for (let i = 0; i < 500; i++) fx.push({ i: 'f' + i, t: 'chair', x: 0, y: 0 });
  const n = Core.normalize({ fx });
  ok('家具数量封顶', n.data.fx.length === Core.LIMITS.fx, String(n.data.fx.length));
  const art = { s: 999, pal: new Array(999).fill('#abcdef'), rows: new Array(999).fill('00'.repeat(999)) };
  const a = Core.normalizeArt(art, 12);
  ok('画布尺寸封顶 48', a.s === 48 && a.rows.length === 48 && a.pal.length === 1);
}

console.log('\n[8] 序列化 / 解析 / 幂等');
{
  const n1 = Core.normalize({ fx: [{ i: 'a', t: 'bed', x: 1, y: 1 }], customFurn: { x: { name: '小桌', art: { s: 4, pal: ['#112233'], rows: ['00..'] } } } });
  const s = Core.serialize(n1.data);
  const p = Core.parse(s);
  ok('parse 成功', p.ok && !p.corrupt);
  const n2 = Core.normalize(JSON.parse(s));
  ok('归一化幂等', stable(n1.data) === stable(n2.data));
  ok('损坏 JSON 被标记', Core.parse('{bad').corrupt);
  ok('空存档不当作损坏', Core.parse(null).absent === true);
  ok('数组存档被标记损坏', Core.parse('[]').corrupt === true);
  ok('空对象不是空房间', Core.parse('{}').corrupt === true);
}

console.log('\n[9] 组装家具白名单');
{
  const n = Core.normalize({ customFurn: { t: { kind: 'asm2', name: '桌', parts: [
    { shape: 'box', x: 0, y: 0, z: 10, w: 1, d: 1, h: 10, color: '#123456' },
    { shape: 'evil', x: 0, y: 0, z: 0, w: 1, d: 1, h: 1, color: '#fff' },
    { shape: 'ball', x: 99, y: -99, w: 99, d: 99, h: 99, color: 'url(x)' }
  ] } } });
  const parts = n.data.customFurn.t.parts;
  ok('非法形状被丢弃', parts.length === 2 && parts.every(p => p.shape === 'box' || p.shape === 'ball'));
  ok('部件坐标/尺寸被钳制', parts[1].x <= 3 && parts[1].y >= -3 && parts[1].w <= 3);
  ok('非法部件颜色回落', parts[1].color === '#d9b78f');
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
