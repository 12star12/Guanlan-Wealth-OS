'use strict';

const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const crypto = require('crypto');

const { Store } = require('./store');
const ledger = require('../core/ledger');
const { parseQuick, toEntries } = require('../core/quickparse');
const { buildDashboard, rowOf, sortDesc } = require('../core/dashboard');

let store = null;
let win = null;

/* ============================================================
   应用入口
   ============================================================ */

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: '#DDD4C0',
    title: '观澜',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.once('ready-to-show', () => win.show());

  // 调试用：设 GUANLAN_SHOT=<路径> 时，渲染完成后截图并退出
  if (process.env.GUANLAN_SHOT) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          require('fs').writeFileSync(process.env.GUANLAN_SHOT, img.toPNG());
          console.log('[shot] saved', process.env.GUANLAN_SHOT);
        } catch (e) {
          console.error('[shot] failed', e);
        }
        app.quit();
      }, 2200);
    });
  }

  // 渲染进程崩溃时给出可见提示，而不是静默白屏
  win.webContents.on('render-process-gone', (_e, detail) => {
    console.error('[renderer gone]', detail);
  });
}

app.whenReady().then(() => {
  const file = path.join(app.getPath('userData'), 'guanlan.json');
  store = new Store(file);
  store.load();

  if (store.transactions.length === 0) seedDemo(store);

  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ============================================================
   菜单
   ============================================================ */

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '文件',
      submenu: [
        {
          label: '清空示例数据',
          click: () => {
            store.clearDemo();
            win && win.webContents.send('data:changed');
          },
        },
        {
          label: '打开数据目录',
          click: () => shell.openPath(app.getPath('userData')),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: '退出' },
      ],
    },
    { role: 'editMenu', label: '编辑' },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新载入' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ============================================================
   IPC
   ============================================================ */

ipcMain.handle('dashboard:get', () => buildDashboard({
  accounts: store.accounts,
  transactions: store.transactions,
}));

ipcMain.handle('txn:list', (_e, { limit = 200 } = {}) => {
  return sortDesc(store.transactions)
    .slice(0, limit)
    .map((t) => rowOf(t, store.accounts));
});

ipcMain.handle('txn:add-quick', (_e, text) => {
  const parsed = parseQuick(text, store.accounts);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const tx = {
    id: crypto.randomBytes(8).toString('hex'),
    at: new Date().toISOString(),
    kind: parsed.data.kind,
    note: ''.concat(parsed.data.note || ''),
    entries: toEntries(parsed.data),
    demo: false,
  };

  const check = ledger.validateTransaction(tx);
  if (!check.ok) return { ok: false, reason: check.reason };

  store.addTransaction(tx);
  return { ok: true, tx: rowOf(tx, store.accounts) };
});

ipcMain.handle('txn:delete', (_e, id) => ({ ok: store.deleteTransaction(id) }));

ipcMain.handle('demo:clear', () => {
  store.clearDemo();
  return { ok: true };
});

ipcMain.handle('account:list', () => store.accounts);

/* ============================================================
   示例数据
   ============================================================ */

function seedDemo(s) {
  const d = new Date();
  const y = d.getFullYear();
  const mo = d.getMonth();
  const uid = () => crypto.randomBytes(8).toString('hex');

  const iso = (monthsAgo, day, h = 12) => {
    const dt = new Date(y, mo - monthsAgo, day, h, 0, 0);
    return dt.toISOString();
  };

  const rows = [];

  // 期初：总资产 35,000，负债 3,000，净资产 32,000
  rows.push({
    id: uid(), at: iso(2, 1, 0), kind: 'opening', note: '期初余额', demo: true,
    entries: [
      { accountId: 'bank',   amount:  2400000 },
      { accountId: 'alipay', amount:   400000 },
      { accountId: 'wechat', amount:   200000 },
      { accountId: 'cash',   amount:   100000 },
      { accountId: 'fund',   amount:   400000 },
      { accountId: 'credit', amount:  -300000 },
      { accountId: 'salary', amount: -3200000 },
    ],
  });

  // 三个月工资
  [2, 1, 0].forEach((m) => {
    rows.push({
      id: uid(), at: iso(m, 10, 9), kind: 'income', note: '工资 · 到账', demo: true,
      entries: [
        { accountId: 'bank',   amount:  850000 },
        { accountId: 'salary', amount: -850000 },
      ],
    });
  });

  // 每月开销（约 5,200 元，储蓄率 ~34%，接近真实）
  const monthly = [
    { d: 5,  cat: 'life',    amt: 350000, note: '房租',           acc: 'bank'   },
    { d: 8,  cat: 'food',    amt:   3800, note: '午饭 · 食堂',    acc: 'wechat' },
    { d: 9,  cat: 'traffic', amt:   1200, note: '地铁 · 通勤',    acc: 'alipay' },
    { d: 11, cat: 'food',    amt:   4500, note: '晚饭 · 外卖',    acc: 'wechat' },
    { d: 13, cat: 'life',    amt:  18000, note: '日用 · 超市',    acc: 'alipay' },
    { d: 15, cat: 'food',    amt:   5200, note: '午饭 · 食堂',    acc: 'wechat' },
    { d: 17, cat: 'traffic', amt:   1200, note: '地铁 · 通勤',    acc: 'alipay' },
    { d: 19, cat: 'growth',  amt:   8900, note: '买书',           acc: 'alipay' },
    { d: 20, cat: 'food',    amt:   2800, note: '早饭',           acc: 'wechat' },
    { d: 21, cat: 'life',    amt:  22000, note: '超市',           acc: 'alipay' },
    { d: 22, cat: 'food',    amt:   3500, note: '外卖',           acc: 'wechat' },
    { d: 23, cat: 'fun',     amt:   9800, note: '电影',           acc: 'wechat' },
    { d: 24, cat: 'life',    amt:  40000, note: '衣服',           acc: 'bank'   },
    { d: 25, cat: 'food',    amt:  28000, note: '朋友聚餐',       acc: 'wechat' },
    { d: 26, cat: 'traffic', amt:   1200, note: '地铁 · 通勤',    acc: 'alipay' },
    { d: 27, cat: 'food',    amt:   4200, note: '午饭',           acc: 'wechat' },
    { d: 28, cat: 'life',    amt:   3900, note: '话费',           acc: 'alipay' },
    { d: 28, cat: 'life',    amt:  12000, note: '水电',           acc: 'alipay' },
  ];

  const wave = [1.0, 1.08, 0.96];
  [2, 1, 0].forEach((m, i) => {
    monthly.forEach((e) => {
      // 取整到元，避免出现 25.76 这种碎数
      const amt = Math.round((e.amt * wave[i]) / 100) * 100;
      rows.push({
        id: uid(), at: iso(m, e.d), kind: 'expense', note: e.note, demo: true,
        entries: [
          { accountId: e.acc, amount: -amt },
          { accountId: e.cat, amount:  amt },
        ],
      });
    });
  });

  // 副业收入
  rows.push({
    id: uid(), at: iso(0, 13), kind: 'income', note: '稿费结算 · 头条', demo: true,
    entries: [
      { accountId: 'bank', amount:  32000 },
      { accountId: 'side', amount: -32000 },
    ],
  });

  // 信用卡还款
  rows.push({
    id: uid(), at: iso(0, 5), kind: 'transfer', note: '信用卡还款', demo: true,
    entries: [
      { accountId: 'bank',   amount: -60000 },
      { accountId: 'credit', amount:  60000 },
    ],
  });

  rows.forEach((t) => s.addTransaction(t));
}
