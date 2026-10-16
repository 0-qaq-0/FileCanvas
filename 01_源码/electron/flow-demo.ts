import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createProject, importPaths, listDirectory, noLinks } from './filesystem';
import { importEntries, workspace } from '../src/domain/workspace';
export async function createFlowDemo(owner: string) {
  const root = path.join(owner, 'flow-demos', randomUUID(), '校园拍摄项目');
  await noLinks(owner, root);
  await fs.mkdir(root, { recursive: true });
  const files = {
    '项目说明.md':
      '# 校园拍摄项目\n目标：周五交付三张校园照片。\n已分类：放本项目正式采用的执行资料和交付清单。\n待整理：需要阅读后决定归属的文件。\n旧版说明需要与现行方案比较，不能仅凭文件名删除。',
    '待整理/拍摄方案.md':
      '# 校园拍摄执行方案\n拍摄地点：图书馆、操场。\n交付三张 JPG，每张不超过 2MB。\n周四完成拍摄，周五交付。\n本文件用于执行当前项目，应与交付清单放在一起。',
    '待整理/预算.csv': '项目,预算元,备注\n交通,30,往返拍摄地点\n道具,50,校园拍摄\n备用,20,待确认',
    '待整理/子目录/验收标准.txt':
      '三张校园照片，JPG 格式，每张不超过 2MB。至少包含图书馆和操场两个地点。与拍摄方案配合使用。',
    '已分类/交付清单.md': '# 交付清单\n1. 图书馆照片\n2. 操场照片\n3. 校园整体照片\n截止：周五。',
    '旧版说明.txt':
      '早期设想：交付五张照片，拍摄地点尚未确定。本文件用于保留讨论记录。是否归档需要对照现行拍摄方案，不应自动删除。',
  };
  for (const [relative, text] of Object.entries(files)) {
    const filename = path.join(root, relative);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, text, { encoding: 'utf8', flag: 'wx' });
  }
  const canonical = await fs.realpath(root),
    project = createProject(canonical);
  project.name = '展开式整理 · 6 文件试用';
  project.demo = { scenario: 'expanded-flow', fixtureVersion: 1 };
  return importEntries(
    workspace(project),
    await importPaths(
      canonical,
      (await listDirectory(canonical, canonical)).map((e) => e.path),
    ),
    null,
  ).project;
}
