// ===== 生成 PWA 图标（白底 + 深色 mochi 文字）=====
// 用法：node gen-icons.mjs  → 生成 src/pwa/icon-192.png、icon-512.png、icon-180.png、icon-maskable-512.png
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'src', 'pwa');
mkdirSync(outDir, { recursive: true });

// ---------- 最小 PNG 编码（RGBA，无依赖） ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(size, pixelFn) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      const o = y * stride + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- "mochi" 点阵字（5x7，每行 5 bit，bit4=最左） ----------
const GLYPHS = {
  m: [0b00000, 0b11011, 0b10101, 0b10101, 0b10101, 0b10101, 0b00000],
  o: [0b00000, 0b01110, 0b10001, 0b10001, 0b10001, 0b01110, 0b00000],
  c: [0b00000, 0b01110, 0b10000, 0b10000, 0b10000, 0b01110, 0b00000],
  h: [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b00000],
  i: [0b00100, 0b00000, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000],
};
const GLYPH_W = 5, GLYPH_H = 7, GAP = 1;
const WORD = 'mochi';
const TEXT_W = WORD.length * GLYPH_W + (WORD.length - 1) * GAP; // 29
const TEXT_H = GLYPH_H; // 7

// 文字实际墨迹范围（单位）——末尾 'i' 很窄，按整格居中会让文字视觉左偏，按墨迹居中才平衡
let INK_MIN_X = GLYPH_W, INK_MAX_X = -1, INK_MIN_Y = GLYPH_H, INK_MAX_Y = -1;
for (let gi = 0; gi < WORD.length; gi++) {
  const g = GLYPHS[WORD[gi]];
  for (let r = 0; r < GLYPH_H; r++) {
    for (let c = 0; c < GLYPH_W; c++) {
      if (g[r] & (1 << (4 - c))) {
        const gx = gi * (GLYPH_W + GAP) + c;
        if (gx < INK_MIN_X) INK_MIN_X = gx;
        if (gx > INK_MAX_X) INK_MAX_X = gx;
        if (r < INK_MIN_Y) INK_MIN_Y = r;
        if (r > INK_MAX_Y) INK_MAX_Y = r;
      }
    }
  }
}
const INK_W = INK_MAX_X - INK_MIN_X + 1;
const INK_H = INK_MAX_Y - INK_MIN_Y + 1;

// 文字覆盖率（8x8 超采样抗锯齿）→ 返回 0~1，1=全墨
function wordCover(px, py, left, top, unit) {
  let hit = 0;
  const steps = 8;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const tx = (px + (i + 0.5) / steps - left) / unit;
      const ty = (py + (j + 0.5) / steps - top) / unit;
      if (tx < 0 || ty < 0 || tx >= TEXT_W || ty >= TEXT_H) continue;
      const gi = Math.floor(tx / (GLYPH_W + GAP));
      const gx = tx - gi * (GLYPH_W + GAP);
      if (gx >= GLYPH_W) continue;
      const glyph = GLYPHS[WORD[gi]];
      const row = Math.floor(ty);
      const col = Math.floor(gx);
      if (glyph && (glyph[row] & (1 << (4 - col)))) hit++;
    }
  }
  return hit / (steps * steps);
}

const INK = [17, 17, 17]; // #111111 深色文字，与开屏 logo 同风格

// 普通图标：白色底（不透明，圆角外也是白——避免系统把透明区域渲染成黑角）+ 深色 mochi 文字
function makeIcon(size) {
  const unit = (size * 0.76) / TEXT_W;
  const left = (size - unit * INK_W) / 2 - unit * INK_MIN_X;
  const top = (size - unit * INK_H) / 2 - unit * INK_MIN_Y;
  return encodePng(size, (x, y) => {
    const c = wordCover(x + 0.5, y + 0.5, left, top, unit);
    const r = Math.round(255 + (INK[0] - 255) * c);
    const g = Math.round(255 + (INK[1] - 255) * c);
    const b = Math.round(255 + (INK[2] - 255) * c);
    return [r, g, b, 255]; // 全图不透明（白底），杜绝黑角
  });
}

// maskable：白色铺满整张，深色 mochi 文字收进中央安全区
function makeMaskable(size) {
  const unit = (size * 0.52) / TEXT_W;
  const left = (size - unit * INK_W) / 2 - unit * INK_MIN_X;
  const top = (size - unit * INK_H) / 2 - unit * INK_MIN_Y;
  return encodePng(size, (x, y) => {
    const c = wordCover(x + 0.5, y + 0.5, left, top, unit);
    const r = Math.round(255 + (INK[0] - 255) * c);
    const g = Math.round(255 + (INK[1] - 255) * c);
    const b = Math.round(255 + (INK[2] - 255) * c);
    return [r, g, b, 255];
  });
}

writeFileSync(join(outDir, 'icon-192.png'), makeIcon(192));
writeFileSync(join(outDir, 'icon-512.png'), makeIcon(512));
writeFileSync(join(outDir, 'icon-180.png'), makeIcon(180));
writeFileSync(join(outDir, 'icon-maskable-512.png'), makeMaskable(512));
console.log('已生成图标 → src/pwa/');
