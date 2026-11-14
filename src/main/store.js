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
  ];
}

function now() { return new Date().toISOString(); }

module.exports = { Store, defaultAccounts };
