import { contextBridge, ipcRenderer } from 'electron';
import type { FileCanvasApi } from '../src/domain/types';
const api: FileCanvasApi = {
  applyChanges: (project, planId) => ipcRenderer.invoke('fc:apply', project, planId),
  operationStatus: (projectId) => ipcRenderer.invoke('fc:operation-status', projectId),
  prepareRefresh: (project) => ipcRenderer.invoke('fc:refresh', project),
  onOperationProgress: (callback) => {
    const listener = (_event: unknown, progress: import('../src/domain/types').OperationProgress) =>
      callback(progress);
    ipcRenderer.on('fc:operation-progress', listener);
    return () => ipcRenderer.removeListener('fc:operation-progress', listener);
  },
  undoDisk: (projectId) => ipcRenderer.invoke('fc:undo-disk', projectId),
  diskUndoAvailable: (projectId) => ipcRenderer.invoke('fc:disk-undo-available', projectId),
  openFile: (path) => ipcRenderer.invoke('fc:open-file', path),
  fileAiAccess: (enabled) => ipcRenderer.invoke('fc:file-ai-access', enabled),
  explainFile: (project, id, refresh) =>
    ipcRenderer.invoke('fc:file-explain', project, id, refresh),
  followupFile: (project, id, question) =>
    ipcRenderer.invoke('fc:file-followup', project, id, question),
  readContent: (path) => ipcRenderer.invoke('fc:content', path),
  aiSettings: () => ipcRenderer.invoke('fc:ai-settings'),
  saveAiSettings: (settings) => ipcRenderer.invoke('fc:ai-save', settings),
  testAi: () => ipcRenderer.invoke('fc:ai-test'),
  buildIndex: () => ipcRenderer.invoke('fc:ai-index'),
  indexStatus: () => ipcRenderer.invoke('fc:ai-index-status'),
  prepareAi: (project, ids, question) =>
    ipcRenderer.invoke('fc:ai-prepare', project, ids, question),
  askAi: (project, ids, question, organize, context, history) =>
    ipcRenderer.invoke('fc:ai-ask', project, ids, question, organize, context, history),
  openRoot: () => ipcRenderer.invoke('fc:open-root'),
  listDirectory: (path) => ipcRenderer.invoke('fc:list', path),
  search: (query) => ipcRenderer.invoke('fc:search', query),
  importPaths: (paths) => ipcRenderer.invoke('fc:import', paths),
  save: (project) => ipcRenderer.invoke('fc:save', project),
  projects: () => ipcRenderer.invoke('fc:projects'),
  load: (id) => ipcRenderer.invoke('fc:load', id),
  restore: () => ipcRenderer.invoke('fc:restore'),
  preview: (project) => ipcRenderer.invoke('fc:preview', project),
  openDemo: () => ipcRenderer.invoke('fc:open-demo'),
  exportPlan: (project) => ipcRenderer.invoke('fc:export-plan', project),
  revealExport: () => ipcRenderer.invoke('fc:reveal-export'),
  revealRoot: () => ipcRenderer.invoke('fc:reveal-root'),
  onCloseRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('fc:close-requested', listener);
    ipcRenderer.send('fc:renderer-ready');
    return () => ipcRenderer.removeListener('fc:close-requested', listener);
  },
  finishClose: (saved) => ipcRenderer.send('fc:finish-close', saved),
};
contextBridge.exposeInMainWorld('fileCanvas', api);
