import type { Preferences, PreferencesLoad } from './preferences';
export type EntryKind = 'file' | 'folder';
export interface SourceEntry {
  id: string;
  name: string;
  path: string;
  kind: EntryKind;
  size: number;
  mtimeMs: number;
  blocked?: string;
  // On the note closing a listing that was cut short: how many entries it leaves out.
  overflow?: number;
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
export interface CanvasGroup {
  id: string;
  name: string;
  files: string[];
}
export interface Project {
  version: 1;
  id: string;
  rootPath: string;
  name: string;
  nodes: NodeMap;
  canvasGroups?: CanvasGroup[];
  createdAt: string;
  updatedAt: string;
  demo?: { scenario: 'content-project' | 'expanded-flow'; fixtureVersion: 1 };
  view?: {
    expandedIds?: string[];
    // Items taken off the canvas on purpose: refreshing does not bring them back.
    removedIds?: string[];
    parentId?: string | null;
    showBrowser?: boolean;
    focused?: boolean;
  };
}
export interface Snapshot {
  nodes: NodeMap;
  canvasGroups?: CanvasGroup[];
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
  demo?: boolean;
}
// A common place offered for opening, such as 下载 or 桌面 (only places that exist).
export interface KnownFolder {
  id: string;
  label: string;
  path: string;
}
export interface ImportEntry {
  entry: SourceEntry;
  parentSourceId: string | null;
}
export interface ImportSummary {
  entries: ImportEntry[];
  // Some folders' contents did not fit within the project's limit.
  limited: boolean;
  // Nested items that could not be read, or are links, and were left out.
  skipped: number;
}
export interface AppInfo {
  version: string;
  dataPath: string;
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
  // System files (desktop.ini, Thumbs.db) not on the canvas that move along with their folder.
  companions?: { source: string; target: string }[];
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
  undoDisk(projectId: string, current?: Project): Promise<ApiResult<Project>>;
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
  // `columns`: cards per row for whatever a reopened project picks up from the folder.
  openRoot(columns?: number): Promise<ApiResult<Project | null>>;
  knownFolders(): Promise<ApiResult<KnownFolder[]>>;
  openKnown(id: string, columns?: number): Promise<ApiResult<Project>>;
  openDropped(file: File, columns?: number): Promise<ApiResult<Project>>;
  // Saves the given visible part of the window as a PNG; null when the user cancels.
  saveImage(rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<ApiResult<string | null>>;
  listDirectory(path: string): Promise<ApiResult<SourceEntry[]>>;
  search(query: string): Promise<ApiResult<{ entries: SourceEntry[]; truncated: boolean }>>;
  // `room`: how many more entries the project can take; anything beyond it is left out.
  importPaths(paths: string[], room?: number): Promise<ApiResult<ImportSummary>>;
  save(project: Project): Promise<ApiResult<string>>;
  groupFiles(paths: string[]): Promise<ApiResult<string[]>>;
  exportGroup(
    project: Project,
    id: string,
  ): Promise<ApiResult<{ path: string; missing: string[] } | null>>;
  copyGroup(
    project: Project,
    id: string,
  ): Promise<
    ApiResult<{ folder: string; copied: number; missing: string[]; failed: string[] } | null>
  >;
  missingGroupFiles(files: string[]): Promise<ApiResult<string[]>>;
  projects(): Promise<ApiResult<ProjectRecord[]>>;
  // Forgets a saved project. Its folder and files are not touched.
  deleteProject(id: string): Promise<ApiResult<boolean>>;
  appInfo(): Promise<ApiResult<AppInfo>>;
  revealLogs(): Promise<ApiResult<boolean>>;
  load(id: string): Promise<ApiResult<Project>>;
  restore(): Promise<ApiResult<Project | null>>;
  preview(project: Project): Promise<ApiResult<Preview>>;
  openDemo(columns?: number): Promise<ApiResult<Project>>;
  loadRules(): Promise<ApiResult<RulesLoad>>;
  saveRules(rules: OrganizeRule[]): Promise<ApiResult<OrganizeRule[]>>;
  loadPreferences(): Promise<ApiResult<PreferencesLoad>>;
  savePreferences(preferences: Preferences): Promise<ApiResult<Preferences>>;
  exportPlan(
    project: Project,
  ): Promise<ApiResult<{ path: string; checkedAt: string; preview: Preview }>>;
  revealExport(): Promise<ApiResult<boolean>>;
  revealRoot(): Promise<ApiResult<boolean>>;
  onCloseRequested(callback: () => void): () => void;
  // `saveFailed`: the last save did not work, so the user is asked whether to close anyway.
  finishClose(saved: boolean, saveFailed?: boolean): void;
}
declare global {
  interface Window {
    fileCanvas: FileCanvasApi;
  }
}
