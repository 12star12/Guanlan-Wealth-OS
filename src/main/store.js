'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 本地存储
 *
 * V0.1 用 JSON 文件，理由：
 *   1. 零 native 依赖，装完即跑（better-sqlite3 在 Electron 里要 rebuild）
 *   2. 个人记账数据量小（几千条），全量序列化无压力
 *   3. 接口已抽象，后续换 SQLite 只改这个文件
 *
 * 写入用「临时文件 + rename」保证原子性，断电不会写坏。
 */

const EMPTY = () => ({
  version: 1,
  createdAt: new Date().toISOString(),
  accounts: [],
  transactions: [],
  meta: { demo: false },
});

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = null;
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.data = JSON.parse(raw);
        // 老数据补上「资产调整」账户，补了就落盘，别每次开机重补一遍
        if (ensureAccounts(this.data)) this.save();
      } else {
        this.data = EMPTY();
        this.data.accounts = defaultAccounts();
        this.save();
      }
    } catch (err) {
      // 文件损坏时先备份，再重建，绝不静默丢数据
      const bak = `${this.filePath}.broken-${Date.now()}`;
      try { fs.copyFileSync(this.filePath, bak); } catch (_) {}
      this.data = EMPTY();
      this.data.accounts = defaultAccounts();
      this.save();
    }
    return this.data;
  }

  save() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  get accounts() { return this.data.accounts; }
  get transactions() { return this.data.transactions; }

  addTransaction(tx) {
    this.data.transactions.push(tx);
    this.save();
    return tx;
  }

  deleteTransaction(id) {
    const i = this.data.transactions.findIndex(t => t.id === id);
    if (i >= 0) {
      this.data.transactions.splice(i, 1);
      this.save();
      return true;
    }
    return false;
  }

  /** 清空示例数据，但保留真实数据 */
  clearDemo() {
    this.data.transactions = this.data.transactions.filter(t => !t.demo);
    this.data.meta.demo = false;
    this.save();
  }

  /* ---------------- 账户 ---------------- */

  accountById(id) {
    return this.data.accounts.find((a) => a.id === id) || null;
  }

  /** 新增账户，id 由名字与时间生成，不依赖外部 */
  addAccount({ name, type }) {
    const clean = String(name || '').trim();
    if (!clean) return { ok: false, reason: '账户名不能为空' };
    if (clean.length > 20) return { ok: false, reason: '名字太长了' };
    if (type !== 'asset' && type !== 'liability') return { ok: false, reason: '类型不对' };

    const same = this.data.accounts.find(
      (a) => !a.archived && a.type === type && a.name === clean
    );
    if (same) return { ok: false, reason: '已经有一个同名账户了' };

    let id = 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    while (this.accountById(id)) id += 'x';

    const acc = {
      id,
      name: clean,
      type,
      subtype: null,
      isLiquid: type === 'asset',
      archived: false,
      createdAt: now(),
    };
    this.data.accounts.push(acc);
    this.save();
    return { ok: true, account: acc };
  }

  renameAccount(id, name) {
    const acc = this.accountById(id);
    if (!acc) return { ok: false, reason: '账户不存在' };
    const clean = String(name || '').trim();
    if (!clean) return { ok: false, reason: '账户名不能为空' };
    if (clean.length > 20) return { ok: false, reason: '名字太长了' };

    const dup = this.data.accounts.find(
      (a) => a.id !== id && !a.archived && a.type === acc.type && a.name === clean
    );
    if (dup) return { ok: false, reason: '已经有一个同名账户了' };

    acc.name = clean;
    this.save();
    return { ok: true, account: acc };
  }

  /** 账户被分录引用过就不能真删，否则历史账目会指向一个不存在的账户 */
  hasEntries(accountId) {
    return this.data.transactions.some(
      (t) => (t.entries || []).some((e) => e.accountId === accountId)
    );
  }

  removeAccount(id) {
    const acc = this.accountById(id);
    if (!acc) return { ok: false, reason: '账户不存在' };
    if (acc.type !== 'asset' && acc.type !== 'liability') {
      return { ok: false, reason: '这个账户不能删' };
    }

    // 至少留一个资产账户，否则记账时无处可记
    const aliveAssets = this.data.accounts.filter(
      (a) => a.type === 'asset' && !a.archived && a.id !== id
    );
    if (acc.type === 'asset' && aliveAssets.length === 0) {
      return { ok: false, reason: '至少保留一个资产账户' };
    }

    if (this.hasEntries(id)) {
      acc.archived = true;
      this.save();
      return { ok: true, archived: true, account: acc };
    }

    this.data.accounts = this.data.accounts.filter((a) => a.id !== id);
    this.save();
    return { ok: true, archived: false, account: acc };
  }
}

/**
 * 老数据补齐：早期版本没有「资产调整」账户，
 * 缺了它就没法把余额改成任意数（差额无处可记）。
 */
function ensureAccounts(data) {
  if (!Array.isArray(data.accounts)) data.accounts = [];
  const has = (id) => data.accounts.some((a) => a.id === id);
  if (has('adjust')) return false;

  data.accounts.push({
    id: 'adjust',
    name: '资产调整',
    type: 'equity',
    subtype: null,
    system: true,
    isLiquid: false,
    archived: false,
    createdAt: now(),
  });
  return true;
}

/** 默认账户 */
function defaultAccounts() {
  return [
    { id: 'bank',   name: '银行卡',   type: 'asset',     subtype: 'bank',       isLiquid: true,  archived: false, createdAt: now() },
    { id: 'alipay', name: '支付宝',   type: 'asset',     subtype: 'wallet',     isLiquid: true,  archived: false, createdAt: now() },
    { id: 'wechat', name: '微信',     type: 'asset',     subtype: 'wallet',     isLiquid: true,  archived: false, createdAt: now() },
    { id: 'cash',   name: '现金',     type: 'asset',     subtype: 'cash',       isLiquid: true,  archived: false, createdAt: now() },
    { id: 'fund',   name: '基金',     type: 'asset',     subtype: 'investment', isLiquid: false, archived: false, createdAt: now() },
    { id: 'credit', name: '信用卡',   type: 'liability', subtype: 'credit',     isLiquid: false, archived: false, createdAt: now() },
    { id: 'salary', name: '工资',     type: 'income',    subtype: null,         isLiquid: false, archived: false, createdAt: now() },
    { id: 'side',   name: '副业收入', type: 'income',    subtype: null,         isLiquid: false, archived: false, createdAt: now() },
    { id: 'food',   name: '餐饮',     type: 'expense',   subtype: null,         isLiquid: false, archived: false, createdAt: now(), nature: 'living' },
    { id: 'traffic',name: '交通',     type: 'expense',   subtype: null,         isLiquid: false, archived: false, createdAt: now(), nature: 'living' },
    { id: 'life',   name: '日用',     type: 'expense',   subtype: null,         isLiquid: false, archived: false, createdAt: now(), nature: 'living' },
    { id: 'growth', name: '成长',     type: 'expense',   subtype: null,         isLiquid: false, archived: false, createdAt: now(), nature: 'growth' },
    { id: 'fun',    name: '娱乐',     type: 'expense',   subtype: null,         isLiquid: false, archived: false, createdAt: now(), nature: 'leisure' },
    // 只用来配平「直接把余额改成某个数」的差额，界面上不出现
    { id: 'adjust', name: '资产调整', type: 'equity',    subtype: null,         isLiquid: false, archived: false, createdAt: now(), system: true },
  ];
}

function now() { return new Date().toISOString(); }

module.exports = { Store, defaultAccounts };
