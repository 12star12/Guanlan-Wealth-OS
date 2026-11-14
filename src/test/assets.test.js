'use strict';

const test = require('node:test');
const assert = require('node:assert');

const assets = require('../core/assets');
const ledger = require('../core/ledger');

const BANK = { id: 'bank', name: '银行卡', type: 'asset', isLiquid: true };
const CARD = { id: 'credit', name: '信用卡', type: 'liability' };

test('资产余额可以直接改成某个数', () => {
  const p = assets.planAdjust({ account: BANK, balanceFen: 100000, targetShownFen: 860000 });

  assert.equal(p.ok, true);
  assert.equal(p.delta, 760000, '差额 = 目标 − 当前');
  assert.equal(p.tx.kind, 'adjust');

  // 分录必须配平，否则整本账立刻失准
  const sum = p.tx.entries.reduce((s, e) => s + e.amount, 0);
  assert.equal(sum, 0);
  assert.deepEqual(p.tx.entries, [
    { accountId: 'bank', amount: 760000 },
    { accountId: 'adjust', amount: -760000 },
  ]);
});

test('负债账户输入「欠 3000」，库里记 −3000', () => {
  const p = assets.planAdjust({ account: CARD, balanceFen: 0, targetShownFen: 300000 });

  assert.equal(p.ok, true);
  assert.equal(p.delta, -300000, '欠钱要记成负数');
  assert.deepEqual(p.tx.entries, [
    { accountId: 'credit', amount: -300000 },
    { accountId: 'adjust', amount: 300000 },
  ]);
});

test('负债从 3000 改成 1000，差额为正', () => {
  const p = assets.planAdjust({ account: CARD, balanceFen: -300000, targetShownFen: 100000 });
  assert.equal(p.delta, 200000);
});

test('改成同一个数不产生交易', () => {
  const p = assets.planAdjust({ account: BANK, balanceFen: 50000, targetShownFen: 50000 });
  assert.equal(p.ok, true);
  assert.equal(p.tx, null, '没有变化就不该写一笔空账');
});

test('余额可以改成负数（信用卡溢缴、账户透支）', () => {
  const p = assets.planAdjust({ account: BANK, balanceFen: 0, targetShownFen: -20000 });
  assert.equal(p.ok, true);
  assert.equal(p.delta, -20000);
  assert.equal(p.tx.entries.reduce((s, e) => s + e.amount, 0), 0);
});

test('非法金额被拒绝', () => {
  assert.equal(assets.planAdjust({ account: BANK, targetShownFen: 1.5 }).ok, false);
  assert.equal(assets.planAdjust({ account: BANK, targetShownFen: NaN }).ok, false);
  assert.equal(assets.planAdjust({ account: BANK, targetShownFen: 1e13 }).ok, false);
  assert.equal(assets.planAdjust({ account: null, targetShownFen: 100 }).ok, false);
});

test('负债在界面上显示为正数', () => {
  assert.equal(assets.shown(CARD, -300000), 300000);
  assert.equal(assets.shown(BANK, 2400000), 2400000);
  assert.equal(assets.internal(CARD, 300000), -300000);
});

test('汇总：负债合计为正，净资产 = 资产 − 负债', () => {
  const accounts = [
    BANK,
    { id: 'alipay', name: '支付宝', type: 'asset', isLiquid: true },
    { id: 'fund', name: '基金', type: 'asset', isLiquid: false },
    CARD,
    { id: 'salary', name: '工资', type: 'income' },
    { id: 'gone', name: '旧卡', type: 'asset', archived: true },
  ];
  const balances = new Map([
    ['bank', 2400000],
    ['alipay', 400000],
    ['fund', 400000],
    ['credit', -300000],
    ['salary', -2900000],
    ['gone', 99999999],
  ]);

  const s = assets.summarize(accounts, balances);

  assert.equal(s.assets.length, 3, '收入账户和归档账户都不该出现');
  assert.equal(s.totalAssets, 3200000);
  assert.equal(s.totalLiabilities, 300000);
  assert.equal(s.netWorth, 2900000);
  assert.equal(s.assets[0].balance, 2400000);
  assert.equal(s.liabilities[0].balance, 300000, '负债列表里是正数');
});

test('调整之后净资产跟着变，且不需要任何缓存', () => {
  const accounts = [BANK, { id: 'adjust', name: '资产调整', type: 'equity' }];
  const txs = [];

  const bal = () => ledger.accountBalances(txs);

  const p1 = assets.planAdjust({ account: BANK, balanceFen: bal().get('bank') || 0, targetShownFen: 100000 });
  txs.push({ id: 'a', at: '2026-11-01T00:00:00', ...p1.tx });

  assert.equal(ledger.netWorth(accounts, bal()), 100000);

  const p2 = assets.planAdjust({ account: BANK, balanceFen: bal().get('bank') || 0, targetShownFen: 250000 });
  txs.push({ id: 'b', at: '2026-11-02T00:00:00', ...p2.tx });

  assert.equal(ledger.netWorth(accounts, bal()), 250000, '第二次调整后应以新数为准，不是累加成 35 万');
});

test('调整不会被算成收入或支出', () => {
  const accounts = [BANK, { id: 'adjust', name: '资产调整', type: 'equity' }];
  const p = assets.planAdjust({ account: BANK, balanceFen: 0, targetShownFen: 800000 });
  const txs = [{ id: 'a', at: '2026-11-03T00:00:00', ...p.tx }];

  const cf = ledger.cashflow(txs, accounts, '2026-11-01', '2026-12-01');
  assert.equal(cf.inflow, 0, '改余额不是赚到钱');
  assert.equal(cf.outflow, 0, '也不是花掉钱');
});
