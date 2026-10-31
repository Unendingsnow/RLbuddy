'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const invoke = (channel, value) => ipcRenderer.invoke(channel, value);
const listen = (channel, callback) => {
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
contextBridge.exposeInMainWorld('buddy', {
  getState: () => invoke('buddy:state'),
  getProfile: filters => invoke('buddy:profile', filters),
  getMatch: id => invoke('buddy:match', id),
  reviewMatch: (id, ai) => invoke('buddy:review', {id,ai}),
  deleteMatch: id => invoke('buddy:delete-match', id),
  clearMemory: () => invoke('buddy:clear-memory'),
  localModels: () => invoke('buddy:local-models'),
  detectLocal: () => invoke('buddy:local-detect'),
  setupLocal: () => invoke('buddy:local-setup'),
  cancelLocalSetup: () => invoke('buddy:local-cancel'),
  pullModel: name => invoke('buddy:local-pull', name),
  testLocal: () => invoke('buddy:local-test'),
  testInteraction: payload => invoke('buddy:test-interaction', payload),
  hardware: () => invoke('buddy:hardware'),
  cancelModel: () => invoke('buddy:model-cancel'),
  exportDiagnostics: () => invoke('buddy:diagnostics'),
  checkRelease: () => invoke('buddy:check-release'),
  openReleases: () => invoke('buddy:open-releases'),
  saveSettings: patch => invoke('buddy:settings', patch),
  demo: type => invoke('buddy:demo', type), chat: text => invoke('buddy:chat', text),
  setOverlayVisible: value => invoke('buddy:visible', value),
  setOverlayLocked: value => invoke('buddy:locked', value),
  resetOverlay: () => invoke('buddy:reset-overlay'),
  moveOverlay: delta => invoke('buddy:move-overlay', delta),
  getDisplays: () => invoke('buddy:displays'),
  importPersonality: () => invoke('buddy:import'),
  detectGame: () => invoke('buddy:detect-game'),
  enableGame: () => invoke('buddy:enable-game'),
  getCaptureSources: () => invoke('buddy:capture-sources'),
  previewCapture: id => invoke('buddy:capture-preview', id),
  openFolder: which => invoke('buddy:folder', which),
  quit: () => invoke('buddy:quit'), minimize: () => invoke('buddy:minimize'),
  onClear: callback => listen('buddy:clear', callback),
  onState: callback => listen('buddy:state', callback),
  onReaction: callback => listen('buddy:reaction', callback),
  onMoment: callback => listen('buddy:moment', callback),
  onPartial: callback => listen('buddy:partial', callback),
  onError: callback => listen('buddy:error', callback),
});
