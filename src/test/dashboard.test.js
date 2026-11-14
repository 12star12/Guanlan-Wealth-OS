'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildDashboard } = require('../core/dashboard');
const { parseQuick, toEntries } = require('../core/quickparse');
const ledger = require('../core/ledger');

const ACCOUNTS = [
  { id: 'bank', name: '银行卡', type: 'asset', isLiquid: true },
  { id: 'credit', name: '信用卡', type: 'liability', isLiquid: false },
  { id: 'salary', name: '工资', type: 'income' },
  { id: 'side', name: '副业收入', type: 'income' },
  { id: 'food', name: '餐饮', type: 'expense' },
  { id: 'growth', name: '成长', type: 'expense' },
];

function tx(id, at, kind, entries) {
  return { id, at, kind, note: id, entries };
}

test('看板：净资产、现金流、最近记录', () => {
  const now = new Date(2026, 10, 14);
  const txs = [
    tx('t1', '2026-11-10T09:00:00+08:00', 'income', [
      { accountId: 'bank', amount: 850000 }, { accountId: 'salary', amount: -850000 },
    ]),
    tx('t2', '2026-11-12T12:00:00+08:00', 'expense', [
      { accountId: 'bank', amount: -2500 }, { accountId: 'food', amount: 2500 },
    ]),
  ];

  const d = buildDashboard({ accounts: ACCOUNTS, transactions: txs, now });
  assert.equal(d.netWorth, 847500);
  assert.equal(d.inflow, 850000);
  assert.equal(d.outflow, 2500);
  assert.equal(d.net, 847500);
  assert.equal(d.daysRecorded, 2);
  assert.equal(d.recent.length, 2);
  assert.equal(d.recent[0].id, 't2', '按时间倒序');
  assert.equal(d.recent[0].tag, '餐饮');
  assert.equal(d.recent[1].tag, '收入');
  assert.ok(d.quote, '应有一句名言');
  assert.ok(d.quote.source.includes('《'), '出处必须具体到文献');
});

test('看板：示例数据标记', () => {
  const txs = [
    { ...tx('t1', '2026-11-10T09:00:00+08:00', 'income', [
      { accountId: 'bank', amount: 100 }, { accountId: 'salary', amount: -100 },
    ]), demo: true },
  ];
  const d = buildDashboard({ accounts: ACCOUNTS, transactions: txs });
  assert.equal(d.hasDemo, true);
});

test('解析：支出', () => {
  const r = parseQuick('午饭25', ACCOUNTS);
  assert.equal(r.ok, true);
  assert.equal(r.data.kind, 'expense');
  assert.equal(r.data.amount, 2500);
  assert.equal(r.data.categoryId, 'food');
});

test('解析：收入', () => {
  const r = parseQuick('工资8500', ACCOUNTS);
  assert.equal(r.ok, true);
  assert.equal(r.data.kind, 'income');
  assert.equal(r.data.categoryId, 'salary');
  assert.equal(r.data.amount, 850000);
});

test('解析：副业收入', () => {
  const r = parseQuick('稿费320', ACCOUNTS);
  assert.equal(r.ok, true);
  assert.equal(r.data.kind, 'income');
  assert.equal(r.data.categoryId, 'side');
});

test('解析：成长类支出单独归类', () => {
  const r = parseQuick('买书89', ACCOUNTS);
  assert.equal(r.ok, true);
  assert.equal(r.data.categoryId, 'growth');
});

test('解析：转账', () => {
  const r = parseQuick('转500到支付宝', ACCOUNTS);
  assert.equal(r.ok, true);
  assert.equal(r.data.kind, 'transfer');
  assert.equal(r.data.toAccountId, 'alipay');
});

test('解析：无金额则失败', () => {
  const r = parseQuick('今天很累', ACCOUNTS);
  assert.equal(r.ok, false);
});

test('解析结果转分录后必须平衡', () => {
  ['午饭25', '工资8500', '转500到支付宝', '买书89'].forEach((text) => {
    const p = parseQuick(text, ACCOUNTS).data;
    const t = { entries: toEntries(p) };
    assert.equal(ledger.validateTransaction(t).ok, true, `${text} 生成的分录不平衡`);
  });
});
