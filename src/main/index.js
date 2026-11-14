'use strict';

const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const crypto = require('crypto');

const { Store } = require('./store');
const ledger = require('../core/ledger');
const { parseQuick, toEntries } = require('../core/quickparse');
const { buildDashboard, rowOf, sortDesc } = require('../core/dashboard');
const report = require('../core/report');
const feedback = require('../core/feedback');

let store = null;
let win = null;

// 截图调试时关掉 GPU 合成，避免抓到过时的画面帧
if (process.env.GUANLAN_SHOT) app.disableHardwareAcceleration();

/** 本地时间戳（YYYY-MM-DDTHH:mm:ss，不带时区）
 *  统一用本地时间，避免 UTC 把凌晨记的账算到前一天 */
function localISO(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** "2026-11-14" → 该日中午的本地时间戳 */
function dateAt(dateStr, hour = 12) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return localISO(new Date(y, m - 1, d, hour, 0, 0));
}

/* ============================================================
   应用入口
   ============================================================ */

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: Number(process.env.GUANLAN_H) || 880,
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
  // 可选 GUANLAN_VIEW=add|report 先切到该页，GUANLAN_PRE=<js> 先执行一段脚本
  if (process.env.GUANLAN_SHOT) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (process.env.GUANLAN_PRE) {
            const r = await win.webContents.executeJavaScript(
              `(async()=>{ try { ${process.env.GUANLAN_PRE} ; return 'ok'; } catch(e){ return 'ERR:'+e.message; } })()`,
              true,
            );
            console.log('[pre]', r);
            await new Promise((r2) => setTimeout(r2, 1200));
          }
          if (process.env.GUANLAN_VIEW) {
            const r = await win.webContents.executeJavaScript(
              `(async()=>{ try { show('${process.env.GUANLAN_VIEW}'); return 'ok'; } catch(e){ return 'ERR:'+e.message; } })()`,
              true,
            );
            console.log('[view]', r);
            await new Promise((r2) => setTimeout(r2, 1200));
          }
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
    at: localISO(new Date()),
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

/** 仅解析，不入账 —— 供「记一笔」表单做即时预览，规则只有一份 */
ipcMain.handle('txn:parse', (_e, text) => {
  const r = parseQuick(text, store.accounts);
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, data: r.data };
});

/**
 * 结构化记账 —— 「记一笔」表单提交走这里
 * 金额单位元，主进程统一转成分
 */
ipcMain.handle('txn:add', (_e, payload) => {
  const p = payload || {};
  const amt = Math.round(Number(p.amount) * 100);

  if (!(amt > 0)) return { ok: false, reason: '金额要大于 0' };

  const kind = p.kind || 'expense';
  let entries;

  if (kind === 'transfer') {
    if (!p.fromAccountId || !p.toAccountId) return { ok: false, reason: '缺少转出或转入账户' };
    if (p.fromAccountId === p.toAccountId) return { ok: false, reason: '转出与转入不能是同一个账户' };
    entries = [
      { accountId: p.fromAccountId, amount: -amt },
      { accountId: p.toAccountId, amount: amt },
    ];
  } else if (kind === 'income') {
    if (!p.accountId || !p.categoryId) return { ok: false, reason: '缺少账户或来源' };
    entries = [
      { accountId: p.accountId, amount: amt },
      { accountId: p.categoryId, amount: -amt },
    ];
  } else {
    if (!p.accountId || !p.categoryId) return { ok: false, reason: '缺少账户或分类' };
    entries = [
      { accountId: p.accountId, amount: -amt },
      { accountId: p.categoryId, amount: amt },
    ];
  }

  const today = localISO(new Date()).slice(0, 10);
  const at = p.date === today ? localISO(new Date()) : dateAt(p.date);

  const tx = {
    id: crypto.randomBytes(8).toString('hex'),
    at,
    kind,
    note: String(p.note || '').trim() || defaultNote(kind, p, store.accounts),
    entries,
    demo: false,
  };

  const check = ledger.validateTransaction(tx);
  if (!check.ok) return { ok: false, reason: check.reason };

  store.addTransaction(tx);

  // 回执：记完之后跟人说的那句话，用事实而不是形容词
  const receipt = feedback.assess({
    tx,
    accounts: store.accounts,
    transactions: store.transactions,
    now: new Date(),
  });

  // 顺手把记完之后的净资产带回去，用户立刻能看到变化
  const balances = ledger.accountBalances(store.transactions);
  return {
    ok: true,
    tx: rowOf(tx, store.accounts),
    receipt,
    netWorth: ledger.netWorth(store.accounts, balances),
  };
});

function defaultNote(kind, p, accounts) {
  const nameOf = (id) => (accounts.find((a) => a.id === id) || {}).name || '';
  if (kind === 'transfer') return `${nameOf(p.fromAccountId)} → ${nameOf(p.toAccountId)}`;
  return nameOf(p.categoryId) || (kind === 'income' ? '收入' : '支出');
}

ipcMain.handle('txn:delete', (_e, id) => ({ ok: store.deleteTransaction(id) }));

/* ---------- 月度财报 ---------- */

ipcMain.handle('report:get', (_e, { year, month } = {}) => {
  const now = new Date();
  const y = Number(year) || now.getFullYear();
  const m = Number(month) || now.getMonth() + 1;
  return report.buildMonthlyReport({
    accounts: store.accounts,
    transactions: store.transactions,
    year: y,
    month: m,
  });
});

ipcMain.handle('report:months', () => report.availableMonths(store.transactions));

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

  const iso = (monthsAgo, day, h = 12) => localISO(new Date(y, mo - monthsAgo, day, h, 0, 0));

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
