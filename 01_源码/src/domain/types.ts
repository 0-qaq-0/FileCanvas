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
  reviewDelete?: boolean;
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
  demo?: { scenario: 'content-project' | 'expanded-flow'; fixtureVersion: 1 };
  view?: {
    expandedIds?: string[];
    parentId?: string | null;
    showBrowser?: boolean;
    focused?: boolean;
  };
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
  planId?: string;
  preserved?: number;
  changes: Change[];
  changed: number;
  unchanged: number;
  issues: number;
  checkedAt: string;
}
export interface OperationStatus {
  id: string;
  projectId: string;
  status: string;
  needsRecovery: boolean;
  canUndo: boolean;
  createdAt: string;
  message: string;
}
export interface OperationProgress {
  operationId: string;
  phase: string;
  completed: number;
  total: number;
}
export interface RefreshReview {
  project: Project;
  changes: { kind: 'new' | 'modified' | 'missing'; path: string; name: string }[];
  skipped: { path: string; name: string; reason: string }[];
}
export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
export interface FileContent {
  kind: 'text' | 'image' | 'unsupported';
  text?: string;
  dataUrl?: string;
  truncated?: boolean;
  message?: string;
}
export interface AiSettings {
  baseUrl: string;
  model: string;
  hasKey: boolean;
}
export interface IndexStatus {
  files: number;
  chunks: number;
  skipped: number;
  truncated: boolean;
  builtAt: string | null;
}
export interface ContextSource {
  path: string;
  text: string;
}
export interface AiContext {
  id: string;
  sources: ContextSource[];
  manifest: { id: string; name: string; path: string; kind: EntryKind }[];
  index: IndexStatus;
  omitted: number;
}
export interface AiGroup {
  folder: string;
  ids: string[];
  reason: string;
}
export interface AiReply {
  answer: string;
  groups: AiGroup[];
}
export interface FileAdvice {
  purpose: string;
  contents: string[];
  projectRole: string;
  action: 'keep' | 'move' | 'archive' | 'review-delete';
  destinationId: string | null;
  newFolder: string | null;
  reason: string;
  sources: ContextSource[];
  readBody: boolean;
}
export interface FileAiAccess {
  enabled: boolean;
  baseUrl: string;
  model: string;
}
// A saved organizing rule. keywords and extensions are alternatives (either one
// qualifies a file); olderThanDays and minSizeMB further narrow it. See domain/rules.ts.
export interface RuleMatch {
  keywords?: string[];
  extensions?: string[];
  olderThanDays?: number;
  minSizeMB?: number;
}
export interface OrganizeRule {
  id: string;
  name: string;
  match: RuleMatch;
  // Target folder, possibly a nested path such as 财务/发票.
  folder: string;
}
export interface RulesLoad {
  rules: OrganizeRule[];
  // Set when a damaged rules file was moved aside and the list starts empty.
  notice?: string;
}
export interface FileCanvasApi {
  applyChanges(
    project: Project,
    planId: string,
  ): Promise<ApiResult<{ project: Project; moved: number; message: string }>>;
  undoDisk(projectId: string): Promise<ApiResult<Project>>;
  diskUndoAvailable(projectId: string): Promise<ApiResult<boolean>>;
  operationStatus(projectId: string): Promise<ApiResult<OperationStatus | null>>;
  prepareRefresh(project: Project): Promise<ApiResult<RefreshReview>>;
  onOperationProgress(callback: (progress: OperationProgress) => void): () => void;
  openFile(path: string): Promise<ApiResult<{ path: string; opened: boolean; method: string }>>;
  revealFile(path: string): Promise<ApiResult<boolean>>;
  fileAiAccess(enabled?: boolean): Promise<ApiResult<FileAiAccess>>;
  explainFile(project: Project, id: string, refresh?: boolean): Promise<ApiResult<FileAdvice>>;
  followupFile(project: Project, id: string, question: string): Promise<ApiResult<string>>;
  readContent(path: string): Promise<ApiResult<FileContent>>;
  aiSettings(): Promise<ApiResult<AiSettings>>;
  saveAiSettings(settings: {
    baseUrl: string;
    model: string;
    apiKey?: string;
  }): Promise<ApiResult<AiSettings>>;
  testAi(): Promise<ApiResult<string>>;
  buildIndex(): Promise<ApiResult<IndexStatus>>;
  indexStatus(): Promise<ApiResult<IndexStatus>>;
  prepareAi(project: Project, ids: string[], question: string): Promise<ApiResult<AiContext>>;
  askAi(
    project: Project,
    ids: string[],
    question: string,
    organize: boolean,
    context: AiContext,
    history: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<ApiResult<AiReply>>;
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
  loadRules(): Promise<ApiResult<RulesLoad>>;
  saveRules(rules: OrganizeRule[]): Promise<ApiResult<OrganizeRule[]>>;
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
