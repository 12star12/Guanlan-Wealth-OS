'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 受限接口
 * 渲染进程拿不到 Node、拿不到文件系统、拿不到 API Key。
 */
contextBridge.exposeInMainWorld('api', {
  getDashboard: () => ipcRenderer.invoke('dashboard:get'),
  listTransactions: (opts) => ipcRenderer.invoke('txn:list', opts || {}),
  listAccounts: () => ipcRenderer.invoke('account:list'),

  /* 记账 */
  parseTxn: (text) => ipcRenderer.invoke('txn:parse', text),
  addQuick: (text) => ipcRenderer.invoke('txn:add-quick', text),
  addTxn: (payload) => ipcRenderer.invoke('txn:add', payload),
  deleteTransaction: (id) => ipcRenderer.invoke('txn:delete', id),

  /* 财报 */
  getReport: (ym) => ipcRenderer.invoke('report:get', ym || {}),
  getReportMonths: () => ipcRenderer.invoke('report:months'),

  clearDemo: () => ipcRenderer.invoke('demo:clear'),

  /** 主进程通知数据变化 */
  onDataChanged: (cb) => ipcRenderer.on('data:changed', () => cb()),
});
