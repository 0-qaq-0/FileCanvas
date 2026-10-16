import { contextBridge, ipcRenderer } from 'electron';
import type { FileCanvasApi } from '../src/domain/types';
const api: FileCanvasApi = {
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
