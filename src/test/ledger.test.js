'use strict';

const test = require('node:test');
const assert = require('node:assert');
const L = require('../core/ledger.js');

/** 一组测试账户 */
function makeAccounts() {
  return [
    { id: 'bank', name: '银行卡', type: 'asset', isLiquid: true },
    { id: 'cash', name: '现金', type: 'asset', isLiquid: true },
    { id: 'fund', name: '基金', type: 'asset', isLiquid: false },
    { id: 'card', name: '信用卡', type: 'liability' },
    { id: 'salary', name: '工资收入', type: 'income' },
    { id: 'side', name: '副业收入', type: 'income' },
    { id: 'food', name: '餐饮', type: 'expense' },
    { id: 'book', name: '书籍', type: 'expense' },
  ];
}

test('校验：分录之和必须为 0', () => {
  assert.equal(L.validateTransaction({
    entries: [{ accountId: 'bank', amount: 100 }, { accountId: 'salary', amount: -100 }]
  }).ok, true);

  const bad = L.validateTransaction({
    entries: [{ accountId: 'bank', amount: 100 }, { accountId: 'salary', amount: -90 }]
  });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /分录之和/);
});

test('校验：拒绝浮点金额与单条分录', () => {
  assert.equal(L.validateTransaction({
    entries: [{ accountId: 'bank', amount: 10.5 }, { accountId: 'salary', amount: -10.5 }]
  }).ok, false);

  assert.equal(L.validateTransaction({
    entries: [{ accountId: 'bank', amount: 100 }]
  }).ok, false);
});

test('基本收支：净资产与现金流', () => {
  const accounts = makeAccounts();
  const txs = [
    { id: 't1', at: '2026-11-10T09:00:00+08:00', kind: 'income',
      entries: [{ accountId: 'bank', amount: 850000 }, { accountId: 'salary', amount: -850000 }] },
    { id: 't2', at: '2026-11-12T12:00:00+08:00', kind: 'expense',
      entries: [{ accountId: 'bank', amount: -2500 }, { accountId: 'food', amount: 2500 }] },
  ];

  const balances = L.accountBalances(txs);
  assert.equal(balances.get('bank'), 847500);

  // 净资产 = 资产（银行卡 8475 元）
  assert.equal(L.netWorth(accounts, balances), 847500);

  const cf = L.cashflow(txs, accounts, '2026-11-01', '2026-12-01');
  assert.equal(cf.inflow, 850000);
  assert.equal(cf.outflow, 2500);
  assert.equal(cf.net, 847500);
});

test('转账不改变净现金流', () => {
  const accounts = makeAccounts();
  const txs = [
    { id: 't1', at: '2026-11-10T09:00:00+08:00', kind: 'income',
      entries: [{ accountId: 'bank', amount: 100000 }, { accountId: 'salary', amount: -100000 }] },
    { id: 't2', at: '2026-11-11T10:00:00+08:00', kind: 'transfer',
      entries: [{ accountId: 'bank', amount: -50000 }, { accountId: 'cash', amount: 50000 }] },
  ];

  const cf = L.cashflow(txs, accounts, '2026-11-01', '2026-12-01');
  assert.equal(cf.inflow, 100000);
  assert.equal(cf.outflow, 0, '转账不应计入支出');
  assert.equal(cf.net, 100000);

  const balances = L.accountBalances(txs);
  assert.equal(balances.get('bank'), 50000);
  assert.equal(balances.get('cash'), 50000);
  assert.equal(L.netWorth(accounts, balances), 100000, '转账不改变净资产');
});

test('负债：余额为负，净资产正确', () => {
  const accounts = makeAccounts();
  const txs = [
    // 刷信用卡吃饭 200 元
    { id: 't1', at: '2026-11-10T12:00:00+08:00', kind: 'expense',
      entries: [{ accountId: 'card', amount: -20000 }, { accountId: 'food', amount: 20000 }] },
  ];

  const balances = L.accountBalances(txs);
  assert.equal(balances.get('card'), -20000, '负债余额存为负数');
  assert.equal(L.totalLiabilities(accounts, balances), 20000);
  assert.equal(L.netWorth(accounts, balances), -20000);

  const ratio = L.debtRatio(accounts, balances);
  assert.equal(ratio, null, '总资产为 0 时负债率无意义');
});

test('信用卡还款：负债与资产同时减少，不影响现金流', () => {
  const accounts = makeAccounts();
  const txs = [
    { id: 't1', at: '2026-11-01T09:00:00+08:00', kind: 'income',
      entries: [{ accountId: 'bank', amount: 100000 }, { accountId: 'salary', amount: -100000 }] },
    { id: 't2', at: '2026-11-05T12:00:00+08:00', kind: 'expense',
      entries: [{ accountId: 'card', amount: -30000 }, { accountId: 'food', amount: 30000 }] },
    { id: 't3', at: '2026-11-20T12:00:00+08:00', kind: 'transfer',
      entries: [{ accountId: 'bank', amount: -30000 }, { accountId: 'card', amount: 30000 }] },
  ];

  const balances = L.accountBalances(txs);
  assert.equal(balances.get('card'), 0, '还款后负债清零');
  assert.equal(balances.get('bank'), 70000);

  const cf = L.cashflow(txs, accounts, '2026-11-01', '2026-12-01');
  assert.equal(cf.outflow, 30000, '只有那顿消费算支出，还款不算');
  assert.equal(cf.inflow, 100000);
});

test('退款：原支出的反向分录', () => {
  const accounts = makeAccounts();
  const txs = [
    { id: 't1', at: '2026-11-05T12:00:00+08:00', kind: 'expense',
      entries: [{ accountId: 'bank', amount: -8900 }, { accountId: 'book', amount: 8900 }] },
    // 退货退款
    { id: 't2', at: '2026-11-08T12:00:00+08:00', kind: 'expense',
      entries: [{ accountId: 'bank', amount: 8900 }, { accountId: 'book', amount: -8900 }] },
  ];

  const cf = L.cashflow(txs, accounts, '2026-11-01', '2026-12-01');
  assert.equal(cf.outflow, 0, '全额退款后支出归零');

  const balances = L.accountBalances(txs);
  assert.equal(balances.get('bank'), 0);
});

test('期初余额是一笔交易，不是账户字段', () => {
  const accounts = makeAccounts();
  const txs = [
    { id: 'open', at: '2026-01-01T00:00:00+08:00', kind: 'opening',
      entries: [{ accountId: 'bank', amount: 500000 }, { accountId: 'fund', amount: 300000 },
                { accountId: 'card', amount: -80000 }, { accountId: 'salary', amount: -720000 }] },
  ];
  const balances = L.accountBalances(txs);
  // 资产 8000 - 负债 800 = 7200
  assert.equal(L.netWorth(accounts, balances), 720000);
});

test('生存月数：流动资产 ÷ 近三月支出中位数', () => {
  const accounts = makeAccounts();
  const txs = [
    // 流动资产 30000 元
    { id: 'o', at: '2026-10-01T00:00:00+08:00', kind: 'opening',
      entries: [{ accountId: 'bank', amount: 3000000 }, { accountId: 'salary', amount: -3000000 }] },
    // 9 月支出 3000
    { at: '2026-09-15T12:00:00+08:00', kind: 'expense',
      entries: [{ accountId: 'bank', amount: -300000 }, { accountId: 'food', amount: 300000 }] },
    // 10 月支出 4000
    { at: '2026-10-15T12:00:00+08:00', kind: 'expense',
      entries: [{ accountId: 'bank', amount: -400000 }, { accountId: 'food', amount: 400000 }] },
    // 11 月支出 5000
    { at: '2026-11-15T12:00:00+08:00', kind: 'expense',
      entries: [{ accountId: 'bank', amount: -500000 }, { accountId: 'food', amount: 500000 }] },
  ];

  const balances = L.accountBalances(txs);
  const liquid = L.liquidAssets(accounts, balances);
  assert.equal(liquid, 3000000 - 1200000);

  const r = L.runway(accounts, balances, txs, new Date(2026, 10, 14));
  // 流动资产 18000，支出中位数 4000 → 4.5 个月
  assert.equal(Math.round(r * 10) / 10, 4.5);
});

test('中位数：偶数个取中间两数平均', () => {
  assert.equal(L.median([300, 400, 500]), 400);
  assert.equal(L.median([300, 400, 500, 600]), 450);
  assert.equal(L.median([]), 0);
});
