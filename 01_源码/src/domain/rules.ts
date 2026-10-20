import type { CanvasNode, NodeMap, OrganizeRule, RuleMatch } from './types';
import { children, validateName } from './workspace';
import { extensionOf } from './recipes';
import type { Placement, RecipeOptions } from './recipes';

// User-written rules for the "我的规则" draft mode. A file is caught by the first rule
// (in list order) whose conditions it meets; files no rule catches stay where they are.
// Conditions: keywords OR extensions (either one qualifies the file), AND older than N
// days, AND at least N MB. Like the built-in recipes, only the file name, extension,
// modification time and size are read; nothing touches the disk.
export const MAX_RULES = 50;
export const MAX_FOLDER_DEPTH = 6;
const MAX_NAME = 60;
const MAX_KEYWORDS = 20;
const MAX_KEYWORD_LENGTH = 50;
const MAX_EXTENSIONS = 20;
const MAX_DAYS = 36_500;
const MAX_SIZE_MB = 1_048_576;
const MB = 1024 * 1024;
const DAY = 86_400_000;
export const CUSTOM_INFO = {
  title: '我的规则',
  description: '写下自己的条件：名称含…、扩展名、多久没改、多大 → 归入指定文件夹，可保存复用',
};
export const RULE_EXAMPLE = '例：名称含“发票”或扩展名 pdf → 财务/发票';

export type CompiledRule = { rule: OrganizeRule; folder: string };
export interface RulePlacement extends Placement {
  ruleId: string;
}
export interface RuleHit {
  id: string;
  // Files this rule ends up with.
  caught: number;
  // Files that meet this rule's conditions but were already taken by an earlier rule.
  shadowed: number;
}

// Splits a typed folder path on / or \, trims every segment and drops empty ones, so
// "财务\发票" and " 财务 / 发票/" mean the same thing. Each segment must be a legal
// Windows name (the same check the canvas applies to folder names).
export function parseFolderPath(input: string): string[] {
  const parts = input
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) throw new Error('请填写目标文件夹，如 财务/发票。');
  if (parts.length > MAX_FOLDER_DEPTH) throw new Error(`目标文件夹最多 ${MAX_FOLDER_DEPTH} 层。`);
  for (const part of parts) {
    try {
      validateName(part);
    } catch (error) {
      throw new Error(`目标文件夹“${part}”：${(error as Error).message}`);
    }
  }
  return parts;
}
export function canonicalFolder(input: string): string {
  return parseFolderPath(input).join('/');
}
function split(text: string, pattern: RegExp): string[] {
  return text
    .split(pattern)
    .map((part) => part.trim())
    .filter(Boolean);
}
function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
// Keywords are separated by commas / 、 / semicolons / new lines, not by spaces,
// so a keyword may itself contain a space.
export function parseKeywords(text: string): string[] {
  return unique(split(text, /[,，、;；\n]+/));
}
// ".PDF", "*.pdf" and "pdf" are all the extension pdf.
export function normalizeExtension(value: string): string {
  return value
    .trim()
    .replace(/^\*?\./, '')
    .toLowerCase();
}
export function parseExtensions(text: string): string[] {
  return unique(
    split(text, /[\s,，、;；]+/)
      .map(normalizeExtension)
      .filter(Boolean),
  );
}

function list(value: unknown, label: string, max: number): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error(`${label}格式无效。`);
  if (value.length > max) throw new Error(`${label}最多 ${max} 个。`);
  return value as string[];
}
function whole(value: unknown, label: string, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max)
    throw new Error(`${label}需要是 1–${max} 之间的整数。`);
  return value;
}

// Strict validation and canonical form for one rule. Used for rules read from disk, for
// rules arriving over IPC and before a draft is built, so every path agrees on what a
// legal rule is. Throws a readable error for the first problem found.
export function normalizeRule(input: unknown): OrganizeRule {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('规则格式无效。');
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(raw.id))
    throw new Error('规则标识无效。');
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name || name.length > MAX_NAME) throw new Error(`规则名称需要 1–${MAX_NAME} 个字符。`);
  if (!raw.match || typeof raw.match !== 'object' || Array.isArray(raw.match))
    throw new Error(`规则“${name}”的条件格式无效。`);
  const m = raw.match as Record<string, unknown>;
  const match: RuleMatch = {};
  const keywords = list(m.keywords, '关键词', MAX_KEYWORDS);
  if (keywords) {
    const cleaned = unique(keywords.map((word) => word.trim()).filter(Boolean));
    if (cleaned.some((word) => word.length > MAX_KEYWORD_LENGTH))
      throw new Error(`每个关键词最多 ${MAX_KEYWORD_LENGTH} 个字符。`);
    if (cleaned.length) match.keywords = cleaned;
  }
  const extensions = list(m.extensions, '扩展名', MAX_EXTENSIONS);
  if (extensions) {
    const cleaned = unique(extensions.map(normalizeExtension).filter(Boolean));
    const bad = cleaned.find((ext) => !/^[\p{L}\p{N}_+-]{1,16}$/u.test(ext));
    if (bad) throw new Error(`扩展名“${bad}”无效：只能是字母、数字，最长 16 个字符。`);
    if (cleaned.length) match.extensions = cleaned;
  }
  const days = whole(m.olderThanDays, '“多少天未修改”', MAX_DAYS);
  if (days !== undefined) match.olderThanDays = days;
  if (m.minSizeMB !== undefined) {
    if (
      typeof m.minSizeMB !== 'number' ||
      !Number.isFinite(m.minSizeMB) ||
      m.minSizeMB <= 0 ||
      m.minSizeMB > MAX_SIZE_MB
    )
      throw new Error(`“最小大小”需要是大于 0、不超过 ${MAX_SIZE_MB} 的 MB 数。`);
    match.minSizeMB = m.minSizeMB;
  }
  if (!Object.keys(match).length)
    throw new Error('请至少设置一个条件：关键词、扩展名、多久没改或最小大小。');
  if (typeof raw.folder !== 'string') throw new Error('请填写目标文件夹，如 财务/发票。');
  return { id: raw.id, name, match, folder: canonicalFolder(raw.folder) };
}
export function ruleProblem(input: unknown): string | null {
  try {
    normalizeRule(input);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}
// The whole saved list. Ids must be unique; names are not checked here (the editor keeps
// them distinct, but an imported list with repeated names is still usable).
export function normalizeRules(input: unknown): OrganizeRule[] {
  if (!Array.isArray(input)) throw new Error('规则列表格式无效。');
  if (input.length > MAX_RULES) throw new Error(`最多保存 ${MAX_RULES} 条规则。`);
  const ids = new Set<string>();
  return input.map((item) => {
    const rule = normalizeRule(item);
    if (ids.has(rule.id)) throw new Error('规则标识重复。');
    ids.add(rule.id);
    return rule;
  });
}
export function ruleNameTaken(rules: OrganizeRule[], name: string, exceptId?: string): boolean {
  const key = name.trim().toLowerCase();
  return rules.some((rule) => rule.id !== exceptId && rule.name.trim().toLowerCase() === key);
}

// One-line summary of a rule's conditions for lists and tooltips.
export function describeMatch(match: RuleMatch): string {
  const parts: string[] = [];
  const names: string[] = [];
  if (match.keywords?.length) names.push(`名称含${match.keywords.map((k) => `“${k}”`).join('')}`);
  if (match.extensions?.length)
    names.push(`扩展名 ${match.extensions.map((e) => `.${e}`).join(' ')}`);
  if (names.length) parts.push(names.join(' 或 '));
  if (match.olderThanDays !== undefined) parts.push(`超过 ${match.olderThanDays} 天未修改`);
  if (match.minSizeMB !== undefined) parts.push(`不小于 ${match.minSizeMB} MB`);
  return parts.join(' · ');
}

function megabytes(bytes: number): string {
  const value = bytes / MB;
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} MB`;
}
// Why the file is caught, or null when it is not. A missing modification time or
// size can not satisfy a condition about it, so such a file is never caught by it.
export function matchRule(
  node: CanvasNode,
  rule: OrganizeRule,
  options: RecipeOptions = {},
): string | null {
  const match = rule.match;
  const parts: string[] = [];
  if (match.keywords?.length || match.extensions?.length) {
    const lower = node.name.toLowerCase();
    const keyword = match.keywords?.find((word) => lower.includes(word.toLowerCase()));
    const extension = extensionOf(node.name);
    if (keyword) parts.push(`名称含“${keyword}”`);
    else if (extension && match.extensions?.includes(extension)) parts.push(`扩展名 .${extension}`);
    else return null;
  }
  if (match.olderThanDays !== undefined) {
    const mtime = node.source?.mtimeMs;
    if (!mtime || !Number.isFinite(mtime)) return null;
    const days = Math.floor(((options.now ?? Date.now()) - mtime) / DAY);
    if (days < match.olderThanDays) return null;
    parts.push(`已 ${days} 天未修改`);
  }
  if (match.minSizeMB !== undefined) {
    const size = node.source?.size;
    if (size === undefined || !Number.isFinite(size) || size < match.minSizeMB * MB) return null;
    parts.push(`大小 ${megabytes(size)}`);
  }
  // A rule with no conditions at all would catch everything; normalizeRule refuses to
  // store one, and here it simply catches nothing.
  return parts.length ? parts.join('，') : null;
}

// Validates the rules and unifies the casing of their folders: "Docs" and "docs" are one
// folder on Windows, so they form one group, shown with the casing of the first rule.
export function compileRules(rules: OrganizeRule[]): CompiledRule[] {
  const display = new Map<string, string>();
  return normalizeRules(rules).map((rule) => {
    const key = rule.folder.toLowerCase();
    if (!display.has(key)) display.set(key, rule.folder);
    return { rule, folder: display.get(key)! };
  });
}
export function placeByRules(
  node: CanvasNode,
  compiled: CompiledRule[],
  options: RecipeOptions = {},
): RulePlacement | null {
  for (const { rule, folder } of compiled) {
    const reason = matchRule(node, rule, options);
    if (reason) return { folder, reason: `规则“${rule.name}”：${reason}`, ruleId: rule.id };
  }
  return null;
}

const fileChildren = (nodes: NodeMap, parentId: string | null) =>
  children(nodes, parentId).filter((n) => n.kind === 'file');
// For the editor's live counts: what each rule would catch among the loose files of
// one canvas level, taking list order into account.
export function ruleHits(
  nodes: NodeMap,
  parentId: string | null,
  rules: OrganizeRule[],
  options: RecipeOptions = {},
): RuleHit[] {
  const hits = rules.map((rule) => ({ id: rule.id, caught: 0, shadowed: 0 }));
  for (const file of fileChildren(nodes, parentId)) {
    let taken = false;
    rules.forEach((rule, index) => {
      if (!matchRule(file, rule, options)) return;
      if (taken) hits[index].shadowed++;
      else {
        hits[index].caught++;
        taken = true;
      }
    });
  }
  return hits;
}
// How many loose files one rule meets on its own, ignoring the other rules.
export function countMatches(
  nodes: NodeMap,
  parentId: string | null,
  rule: OrganizeRule,
  options: RecipeOptions = {},
): number {
  return fileChildren(nodes, parentId).filter((file) => matchRule(file, rule, options)).length;
}
