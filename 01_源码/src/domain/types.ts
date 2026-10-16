export type EntryKind = 'file' | 'folder';
export interface SourceEntry {
  id: string;
  name: string;
  path: string;
  kind: EntryKind;
  size: number;
  mtimeMs: number;
  blocked?: string;
}
export interface CanvasNode {
  id: string;
  name: string;
  kind: EntryKind;
  parentId: string | null;
  source: SourceEntry | null;
  x: number;
  y: number;
}
export type NodeMap = Record<string, CanvasNode>;
export interface Project {
  version: 1;
  id: string;
  rootPath: string;
  name: string;
  nodes: NodeMap;
  createdAt: string;
  updatedAt: string;
  demo?: { scenario: 'content-project'; fixtureVersion: 1 };
}
export interface Snapshot {
  nodes: NodeMap;
  label: string;
}
export interface Workspace {
  project: Project;
  past: Snapshot[];
  future: Snapshot[];
}
export interface ProjectRecord {
  id: string;
  name: string;
  rootPath: string;
  updatedAt: string;
}
export interface ImportEntry {
  entry: SourceEntry;
  parentSourceId: string | null;
}
export interface Change {
  id: string;
  name: string;
  kind: 'create' | 'move' | 'rename' | 'move-rename' | 'unchanged';
  source: string | null;
  target: string;
  issues: string[];
}
export interface Preview {
  changes: Change[];
  changed: number;
  unchanged: number;
  issues: number;
  checkedAt: string;
}
export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
export interface FileCanvasApi {
  openRoot(): Promise<ApiResult<Project | null>>;
  listDirectory(path: string): Promise<ApiResult<SourceEntry[]>>;
  search(query: string): Promise<ApiResult<{ entries: SourceEntry[]; truncated: boolean }>>;
  importPaths(paths: string[]): Promise<ApiResult<ImportEntry[]>>;
  save(project: Project): Promise<ApiResult<string>>;
  projects(): Promise<ApiResult<ProjectRecord[]>>;
  load(id: string): Promise<ApiResult<Project>>;
  restore(): Promise<ApiResult<Project | null>>;
  preview(project: Project): Promise<ApiResult<Preview>>;
  openDemo(): Promise<ApiResult<Project>>;
  exportPlan(
    project: Project,
  ): Promise<ApiResult<{ path: string; checkedAt: string; preview: Preview }>>;
  revealExport(): Promise<ApiResult<boolean>>;
  revealRoot(): Promise<ApiResult<boolean>>;
  onCloseRequested(callback: () => void): () => void;
  finishClose(saved: boolean): void;
}
declare global {
  interface Window {
    fileCanvas: FileCanvasApi;
  }
}
