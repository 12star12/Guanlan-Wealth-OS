'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { assess } = require('../core/feedback');

const ACCOUNTS = [
  { id: 'bank',   name: '银行卡', type: 'asset'     },
  { id: 'salary', name: '工资',   type: 'income'    },
  { id: 'side',   name: '副业收入', type: 'income'  },
  { id: 'food',    name: '餐饮',   type: 'expense', nature: 'living' },
  { id: 'traffic', name: '交通',   type: 'expense', nature: 'living' },
  { id: 'life',   name: '日用',   type: 'expense', nature: 'living' },
  { id: 'growth', name: '成长',   type: 'expense', nature: 'growth' },
  { id: 'fun',    name: '娱乐',   type: 'expense', nature: 'leisure' },
];

function tx(id, at, kind, entries, note) {
  return { id, at, kind, note: note || id, entries };
}

function income(id, at, sourceId, amount) {
  return tx(id, at, 'income', [
    { accountId: 'bank', amount },
    { accountId: sourceId, amount: -amount },
  ]);
}

function expense(id, at, catId, amount) {
  return tx(id, at, 'expense', [
    { accountId: 'bank', amount: -amount },
    { accountId: catId, amount },
  ]);
}

const NOW = new Date(2026, 10, 14, 20, 0, 0);

test('第一笔收入：不夸张，只说明这条记录开始了', () => {
  const t1 = income('a', '2026-11-14T10:00:00', 'side', 32000);
  const r = assess({ tx: t1, accounts: ACCOUNTS, transactions: [t1], now: NOW });

  assert.equal(r.tone, 'income');
  assert.ok(r.badge.includes('第 1 次'));
  assert.ok(r.lines[0].includes('第一笔收入'));
  assert.ok(!r.lines.join('').includes('太棒'), '不用感叹式表扬');
});

test('重复创收：给出次数、间隔、来源数 —— 让事实自己说话', () => {
  const t1 = income('a', '2026-11-01T10:00:00', 'side', 5000);
  const t2 = income('b', '2026-11-08T10:00:00', 'side', 30000);
  const r = assess({ tx: t2, accounts: ACCOUNTS, transactions: [t1, t2], now: NOW });

  assert.ok(r.badge.includes('第 2 次'));
  assert.ok(r.badge.includes('副业收入'));
  assert.ok(r.lines.join('').includes('7 天'), '应算出距上次 7 天');
  assert.ok(r.lines.join('').includes('1 个来源'));
});

test('新来源第一次：指出这是多出来的一条路', () => {
  const t1 = income('a', '2026-11-01T10:00:00', 'salary', 850000);
  const t2 = income('b', '2026-11-12T10:00:00', 'side', 32000);
  const r = assess({ tx: t2, accounts: ACCOUNTS, transactions: [t1, t2], now: NOW });

  assert.ok(r.lines[0].includes('第一次'));
  assert.ok(r.lines.join('').includes('多了一条路'));
});

test('表扬强度不随金额变化：5 元和 320 元都是第 N 次', () => {
  const big = [income('a', '2026-11-01T10:00:00', 'side', 500000)];
  const small = [income('a', '2026-11-01T10:00:00', 'side', 500)];

  const bigTx = income('b', '2026-11-08T10:00:00', 'side', 500000);
  const smallTx = income('b', '2026-11-08T10:00:00', 'side', 500);

  const rBig = assess({ tx: bigTx, accounts: ACCOUNTS, transactions: [...big, bigTx], now: NOW });
  const rSmall = assess({ tx: smallTx, accounts: ACCOUNTS, transactions: [...small, smallTx], now: NOW });

  assert.equal(rBig.badge, rSmall.badge, 'badge 不应因金额不同');
  assert.deepEqual(rBig.lines, rSmall.lines, '文案不应因金额不同');
});

test('转账不表扬：只说明钱去哪了', () => {
  const t = tx('a', '2026-11-14T10:00:00', 'transfer', [
    { accountId: 'bank', amount: -50000 },
    { accountId: 'food', amount: 50000 },
  ]);
  const r = assess({ tx: t, accounts: ACCOUNTS, transactions: [t], now: NOW });

  assert.equal(r.tone, 'plain');
  assert.ok(r.lines.join('').includes('总额没变'));
  assert.ok(!r.lines.join('').includes('值得'), '转账不该被夸');
});

test('成长支出：可以纵向回指，因为它累积且不消失', () => {
  const t1 = expense('a', '2026-09-01T10:00:00', 'growth', 8900);
  const t2 = expense('b', '2026-11-14T10:00:00', 'growth', 5900);
  const r = assess({ tx: t2, accounts: ACCOUNTS, transactions: [t1, t2], now: NOW });

  assert.equal(r.tone, 'growth');
  assert.ok(r.lines.join('').includes('天前'), '超过 60 天应回指起点');
});

test('第一次为成长花钱：明确它不会立刻变现，但不会消失', () => {
  const t = expense('a', '2026-11-14T10:00:00', 'growth', 8900);
  const r = assess({ tx: t, accounts: ACCOUNTS, transactions: [t], now: NOW });

  assert.equal(r.tone, 'growth');
  assert.ok(r.lines.join('').includes('第一次'));
  assert.ok(r.lines.join('').includes('不会消失'));
});

test('娱乐支出：也换来东西，只是那东西不叫成长', () => {
  const t = expense('a', '2026-11-14T10:00:00', 'fun', 9400);
  const r = assess({ tx: t, accounts: ACCOUNTS, transactions: [t], now: NOW });

  assert.equal(r.title, '心情', '娱乐的收获是心情，不是别的');
  const text = r.lines.join('');
  assert.ok(!text.includes('投资'), '娱乐不能被说成投资');
  assert.ok(!text.includes('值得'));
  assert.ok(text.includes('不在工作'), '要说出情绪价值具体是什么');
});

test('每一类支出都能说出换来了什么', () => {
  const cases = [
    ['food', '力气'],
    ['traffic', '抵达'],
    ['life', '安身'],
    ['growth', '能力'],
    ['fun', '心情'],
  ];
  for (const [cat, label] of cases) {
    const t = expense('a', '2026-11-14T10:00:00', cat, 2500);
    const r = assess({ tx: t, accounts: ACCOUNTS, transactions: [t], now: NOW });
    assert.equal(r.title, label, `${cat} 应换来「${label}」`);
    assert.ok(r.lines.length >= 2, '应有事实行 + 收获行');
  }
});

test('生活支出：给位置，不评价', () => {
  const t = expense('a', '2026-11-05T10:00:00', 'life', 336000);
  const r = assess({ tx: t, accounts: ACCOUNTS, transactions: [t], now: NOW });

  assert.ok(r.badge.includes('日用'));
  assert.ok(r.lines.join('').includes('占支出'));
});

test('全文禁用词：不说教、不评判、不预测', () => {
  const cases = [
    income('a', '2026-11-14T10:00:00', 'side', 32000),
    expense('b', '2026-11-14T11:00:00', 'growth', 8900),
    expense('c', '2026-11-14T12:00:00', 'fun', 9400),
    expense('d', '2026-11-14T13:00:00', 'food', 2500),
  ];
  const banned = ['失败', '糟糕', '应该', '必须', '建议', '浪费', '不该', '太多', '太少', '警告', '注意', '努力'];

  for (const c of cases) {
    const r = assess({ tx: c, accounts: ACCOUNTS, transactions: [c], now: NOW });
    const text = r.badge + r.lines.join('');
    for (const w of banned) {
      assert.ok(!text.includes(w), `「${text}」不应出现「${w}」`);
    }
  }
});

test('期初余额不参与收入计数', () => {
  const opening = tx('o', '2026-10-01T00:00:00', 'opening', [
    { accountId: 'bank', amount: 3200000 },
    { accountId: 'salary', amount: -3200000 },
  ]);
  const t1 = income('a', '2026-11-14T10:00:00', 'salary', 850000);
  const r = assess({ tx: t1, accounts: ACCOUNTS, transactions: [opening, t1], now: NOW });

  assert.ok(r.badge.includes('第 1 次'), '期初不该被算作一次创收');
});
