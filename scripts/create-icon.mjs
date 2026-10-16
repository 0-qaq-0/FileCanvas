// Original code-drawn artwork; no external resources.
import fs from 'node:fs/promises';
await fs.mkdir('assets', { recursive: true });
const sizes = [32, 48, 64, 128, 256];
function rounded(x, y, left, top, width, height, radius) {
  if (x < left || x > left + width || y < top || y > top + height) return false;
  const cx = Math.max(left + radius, Math.min(x, left + width - radius));
  const cy = Math.max(top + radius, Math.min(y, top + height - radius));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}
const images = sizes.map((size) => {
  const maskRow = Math.ceil(size / 32) * 4;
  const bitmap = Buffer.alloc(40 + size * size * 4 + maskRow * size);
  bitmap.writeUInt32LE(40, 0);
  bitmap.writeInt32LE(size, 4);
  bitmap.writeInt32LE(size * 2, 8);
  bitmap.writeUInt16LE(1, 12);
  bitmap.writeUInt16LE(32, 14);
  bitmap.writeUInt32LE(size * size * 4, 20);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const px = ((x + (sx + 0.5) / 4) / size) * 256,
            py = ((y + (sy + 0.5) / 4) / size) * 256;
          if (!rounded(px, py, 8, 8, 240, 240, 58)) continue;
          let color = [61, 139, 125];
          const back = rounded(px, py, 67, 85, 92, 114, 10) && !rounded(px, py, 74, 92, 78, 100, 4);
          const front =
            rounded(px, py, 96, 59, 92, 115, 11) && !rounded(px, py, 103, 66, 78, 101, 5);
          const fold =
            (px >= 153 && px <= 161 && py >= 60 && py <= 91) ||
            (py >= 84 && py <= 92 && px >= 154 && px <= 185);
          if (back || front || fold) color = [246, 255, 250];
          r += color[0];
          g += color[1];
          b += color[2];
          a++;
        }
      const offset = 40 + ((size - 1 - y) * size + x) * 4;
      bitmap[offset] = a ? Math.round(b / a) : 0;
      bitmap[offset + 1] = a ? Math.round(g / a) : 0;
      bitmap[offset + 2] = a ? Math.round(r / a) : 0;
      bitmap[offset + 3] = Math.round((a / 16) * 255);
    }
  return bitmap;
});
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, index) => {
  const start = 6 + index * 16;
  header[start] = size === 256 ? 0 : size;
  header[start + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, start + 4);
  header.writeUInt16LE(32, start + 6);
  header.writeUInt32LE(images[index].length, start + 8);
  header.writeUInt32LE(offset, start + 12);
  offset += images[index].length;
});
await fs.writeFile('assets/icon.ico', Buffer.concat([header, ...images]));
