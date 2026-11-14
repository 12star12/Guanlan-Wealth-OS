'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 受限接口
 * 渲染进程拿不到 Node、拿不到文件系统、拿不到 API Key。
 */
contextBridge.exposeInMainWorld('api', {
  getDashboard: () => ipcRenderer.invoke('dashboard:get'),
  listTransactions: (opts) => ipcRenderer.invoke('txn:list', opts || {}),
  addQuick: (text) => ipcRenderer.invoke('txn:add-quick', text),
  deleteTransaction: (id) => ipcRenderer.invoke('txn:delete', id),
  clearDemo: () => ipcRenderer.invoke('demo:clear'),
  listAccounts: () => ipcRenderer.invoke('account:list'),

  /** 主进程通知数据变化 */
  onDataChanged: (cb) => ipcRenderer.on('data:changed', () => cb()),
});
