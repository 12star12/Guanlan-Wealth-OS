'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildMonthlyReport, monthRange, prevMonth } = require('../core/report');

const ACCOUNTS = [
  { id: 'bank',   name: '银行卡', type: 'asset',     isLiquid: true  },
  { id: 'fund',   name: '基金',   type: 'asset',     isLiquid: false },
  { id: 'credit', name: '信用卡', type: 'liability', isLiquid: false },
  { id: 'salary', name: '工资',   type: 'income'    },
  { id: 'food',   name: '餐饮',   type: 'expense',   nature: 'living' },
  { id: 'life',   name: '日用',   type: 'expense',   nature: 'living' },
  { id: 'growth', name: '成长',   type: 'expense',   nature: 'growth' },
];

function tx(id, at, kind, entries, note) {
  return { id, at, kind, note: note || id, entries };
}

test('月份边界：跨年正确', () => {
  assert.deepEqual(monthRange(2026, 12), { from: '2026-12-01', to: '2027-01-01' });
  assert.deepEqual(monthRange(2026, 1), { from: '2026-01-01', to: '2026-02-01' });
  assert.deepEqual(prevMonth(2026, 1), { year: 2025, month: 12 });
  assert.deepEqual(prevMonth(2026, 11), { year: 2026, month: 10 });
});

test('期末余额只累计当月之前的交易', () => {
  const txs = [
    // 上月：期初 5000，工资 8000，支出 2000 → 月末 11000
    tx('a', '2026-10-01T08:00:00', 'opening', [
      { accountId: 'bank', amount: 500000 }, { accountId: 'salary', amount: -500000 },
    ]),
    tx('b', '2026-10-10T09:00:00', 'income', [
      { accountId: 'bank', amount: 800000 }, { accountId: 'salary', amount: -800000 },
    ]),
    tx('c', '2026-10-20T12:00:00', 'expense', [
      { accountId: 'bank', amount: -200000 }, { accountId: 'food', amount: 200000 },
    ]),
    // 本月：工资 8000，支出 3000 + 成长 1000
    tx('d', '2026-11-10T09:00:00', 'income', [
      { accountId: 'bank', amount: 800000 }, { accountId: 'salary', amount: -800000 },
    ]),
    tx('e', '2026-11-12T12:00:00', 'expense', [
      { accountId: 'bank', amount: -300000 }, { accountId: 'life', amount: 300000 },
    ]),
    tx('f', '2026-11-13T12:00:00', 'expense', [
      { accountId: 'bank', amount: -100000 }, { accountId: 'growth', amount: 100000 },
    ]),
  ];

  const r = buildMonthlyReport({ accounts: ACCOUNTS, transactions: txs, year: 2026, month: 11 });

  // 期末净资产 = 5000 + 8000 - 2000 + 8000 - 3000 - 1000 = 15000
  assert.equal(r.netWorth, 1500000);
  // 上月月末 = 11000
  assert.equal(r.prev.netWorth, 1100000);
  assert.equal(r.delta.netWorth, 400000);

  // 本月收支
  assert.equal(r.totalIncome, 800000);
  assert.equal(r.totalExpense, 400000);
  assert.equal(r.net, 400000);
  assert.equal(r.savingsRate, 0.5);

  // 支出结构：生活 3000，成长 1000
  assert.equal(r.nature.living, 300000);
  assert.equal(r.nature.growth, 100000);

  assert.equal(r.daysRecorded, 3);
  assert.equal(r.txnCount, 3);
  assert.equal(r.isEmpty, false);
});

test('转账不计入收支，也不改变净资产', () => {
  const txs = [
    tx('a', '2026-11-01T08:00:00', 'opening', [
      { accountId: 'bank', amount: 1000000 }, { accountId: 'salary', amount: -1000000 },
    ]),
    tx('b', '2026-11-05T12:00:00', 'transfer', [
      { accountId: 'bank', amount: -300000 }, { accountId: 'fund', amount: 300000 },
    ]),
  ];

  const r = buildMonthlyReport({ accounts: ACCOUNTS, transactions: txs, year: 2026, month: 11 });
  assert.equal(r.totalIncome, 0);
  assert.equal(r.totalExpense, 0);
  assert.equal(r.net, 0);
  assert.equal(r.netWorth, 1000000, '转账不改变净资产');
  assert.equal(r.assets.find((a) => a.id === 'fund').amount, 300000);
});

test('负债以正数呈现，负债率 = 负债 ÷ 资产', () => {
  const txs = [
    tx('a', '2026-11-01T08:00:00', 'opening', [
      { accountId: 'bank', amount: 1000000 },
      { accountId: 'credit', amount: -250000 },
      { accountId: 'salary', amount: -750000 },
    ]),
  ];

  const r = buildMonthlyReport({ accounts: ACCOUNTS, transactions: txs, year: 2026, month: 11 });
  assert.equal(r.totalAssets, 1000000);
  assert.equal(r.totalLiabilities, 250000);
  assert.equal(r.netWorth, 750000);
  assert.equal(r.liabilities[0].amount, 250000, '负债显示为正数');
  assert.equal(r.debtRatio, 0.25);
});

test('空月份不产出 NaN', () => {
  const txs = [
    tx('a', '2026-09-01T08:00:00', 'opening', [
      { accountId: 'bank', amount: 100000 }, { accountId: 'salary', amount: -100000 },
    ]),
  ];
  const r = buildMonthlyReport({ accounts: ACCOUNTS, transactions: txs, year: 2026, month: 11 });

  assert.equal(r.isEmpty, true);
  assert.equal(r.savingsRate, null);
  assert.equal(r.totalExpense, 0);
  assert.equal(r.netWorth, 100000, '空月份仍能算出结存');
  assert.ok(Number.isFinite(r.delta.netWorth));
  assert.ok(typeof r.narration === 'string');
});

test('结语只陈述事实，不含评价性词汇', () => {
  const txs = [
    tx('a', '2026-10-01T08:00:00', 'opening', [
      { accountId: 'bank', amount: 3000000 }, { accountId: 'salary', amount: -3000000 },
    ]),
    tx('b', '2026-11-12T12:00:00', 'expense', [
      { accountId: 'bank', amount: -100000 }, { accountId: 'food', amount: 100000 },
    ]),
  ];
  const r = buildMonthlyReport({ accounts: ACCOUNTS, transactions: txs, year: 2026, month: 11 });

  const banned = ['失败', '糟糕', '太差', '应该', '必须', '警告', '危险', '过度'];
  for (const w of banned) {
    assert.ok(!r.narration.includes(w), `结语不应出现「${w}」`);
  }
});
