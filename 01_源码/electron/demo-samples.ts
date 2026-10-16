import fs from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([head, name, data, tail]);
}
function png(seed: number): Buffer {
  const w = 320,
    h = 180,
    pixels = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * (w * 3 + 1) + 1 + x * 3;
      const accent = x > 28 && x < 290 && y > 40 && y < 140;
      pixels[p] = accent ? 55 + seed * 8 : 239;
      pixels[p + 1] = accent ? 130 + seed * 3 : 245;
      pixels[p + 2] = accent ? 118 + seed * 5 : 242;
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function wav(): Buffer {
  const samples = 8000,
    body = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++)
    body.writeInt16LE(Math.round(Math.sin((i / 8000) * 2 * Math.PI * 440) * 1200), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(36 + body.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(body.length, 40);
  return Buffer.concat([header, body]);
}
function zip(): Buffer {
  const name = Buffer.from('sample.txt');
  const data = Buffer.from('FileCanvas original demo archive. No customer data.\n');
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const content = Buffer.concat([local, name, data]);
  const dir = Buffer.concat([central, name]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(content.length, 16);
  return Buffer.concat([content, dir, end]);
}
export function sampleFiles(): Record<string, Buffer> {
  const text = (value: string) => Buffer.from(value, 'utf8');
  return {
    '封面草稿.png': png(1),
    '封面定稿.png': png(2),
    '课堂截图.png': png(3),
    '版式参考.svg': text(
      '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" rx="20" fill="#e7f1ed"/><rect x="36" y="40" width="180" height="190" rx="12" fill="#3d8b7d"/><text x="240" y="120" font-size="24" fill="#254738">示例版式</text><text x="240" y="155" font-size="14" fill="#6b8d7f">FileCanvas · 原创样例</text></svg>',
    ),
    '选题清单.csv': text(
      '\uFEFF选题,状态,备注\n学习记录,待写,示例数据\n产品演示,准备中,不是真实客户项目\n',
    ),
    '拍摄脚本.md': text(
      '# 示例拍摄脚本\n\n1. 展示凌乱资料\n2. 虚拟分类并调整\n3. 对照原路径和目标路径\n4. 明确真实文件没有移动\n',
    ),
    '预算记录.csv': text(
      '\uFEFF项目,示例金额,说明\n软件素材,0,全部原创生成\n客户收入,0,无真实交易\n',
    ),
    '产品说明.md': text(
      '# FileCanvas 示例资料\n\n先演练文件结构，再检查方案。当前未开放真实移动。\n',
    ),
    '项目复盘.txt': text('本文件为演示生成。请记录分类是否符合你的思路、哪里需要手动调整。\n'),
    '最终交付清单.txt': text('示例交付清单，不代表真实付费交付。\n- 封面定稿\n- 整理方案\n'),
    '演示配音.wav': wav(),
    '提示音.wav': wav(),
    '素材备份.zip': zip(),
    '前端按钮.ts': text(
      '// 原创演示代码，不会由 FileCanvas 执行。\nexport const label = "先演练，再决定";\n',
    ),
    '拍摄任务.json': text(
      JSON.stringify({ demo: true, task: '录制虚拟整理流程', paidOrder: false }, null, 2),
    ),
    '待判断素材.sample': text('用于演示未知类型的保守分类，不假装已经知道文件用途。\n'),
    '临时下载/活动说明.txt': text('虚构活动说明，用于演示保留原始子目录。\n'),
    '临时下载/配图.png': png(4),
    '旧资料/封面草稿.png': png(5),
    '旧资料/旧版说明.md': text('# 旧版示例\n\n此处与根目录有同名的“封面草稿.png”，请勿覆盖。\n'),
  };
}
export async function createSampleFolder(
  directory: string,
): Promise<{ fileCount: number; files: { path: string; bytes: number; sha256: string }[] }> {
  // The caller chooses an owned fresh directory. EEXIST deliberately refuses to overwrite or reset it.
  await fs.mkdir(directory);
  const manifest = [];
  for (const [relative, bytes] of Object.entries(sampleFiles())) {
    const full = path.join(directory, relative);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, bytes, { flag: 'wx' });
    manifest.push({
      path: relative,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  return { fileCount: manifest.length, files: manifest };
}
