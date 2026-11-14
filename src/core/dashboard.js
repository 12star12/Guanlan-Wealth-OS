'use strict';

const ledger = require('./ledger');
const { pickQuote } = require('./quotes');

/**
 * 看板组装 —— 纯函数，不依赖 Electron
 * 这样它可以在 Node 里被直接测试，不必开窗口。
 */

function thisMonthRange(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const nm = new Date(y, now.getMonth() + 1, 1);
  return {
    from: `${y}-${m}-01`,
    to: `${nm.getFullYear()}-${String(nm.getMonth() + 1).padStart(2, '0')}-01`,
  };
}

function sortDesc(txs) {
  return [...txs].sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** 交易 → 展示行 */
function rowOf(tx, accounts) {
  const typeOf = new Map(accounts.map((a) => [a.id, a.type]));
  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));

  // 期初余额不是一笔收支，显示为「期初」，金额取当时搬进来的资产合计
  if (tx.kind === 'opening') {
    let assets = 0;
    for (const e of tx.entries || []) {
      if (typeOf.get(e.accountId) === 'asset') assets += e.amount;
    }
    return {
      id: tx.id,
      at: tx.at,
      day: tx.at.slice(5, 10).replace('-', '·'),
      title: tx.note || '期初余额',
      tag: '期初',
      cls: 'life',
      kind: 'opening',
      amount: assets,
      isIncome: false,
      demo: !!tx.demo,
    };
  }

  let amount = 0;
  let tag = '转账';
  let cls = 'life';

  for (const e of tx.entries) {
    const t = typeOf.get(e.accountId);
    if (t === 'income') {
      amount = -e.amount;
      tag = '收入';
      cls = 'earn';
    } else if (t === 'expense') {
      amount = e.amount;
      tag = nameOf.get(e.accountId) || '支出';
      cls = e.accountId === 'growth' ? 'grow' : 'life';
    }
  }

  return {
    id: tx.id,
    at: tx.at,
    day: tx.at.slice(5, 10).replace('-', '·'),
    title: tx.note || tag,
    tag,
    cls,
    kind: tx.kind,
    amount,
    isIncome: tx.kind === 'income',
    demo: !!tx.demo,
  };
}

/**
 * @param {{accounts:Array, transactions:Array, now?:Date}} input
 */
function buildDashboard({ accounts, transactions, now = new Date() }) {
  const balances = ledger.accountBalances(transactions);

  const netWorth = ledger.netWorth(accounts, balances);
  const runway = ledger.runway(accounts, balances, transactions, now);
  const debtRatio = ledger.debtRatio(accounts, balances);

  const { from, to } = thisMonthRange(now);
  const cf = ledger.cashflow(transactions, accounts, from, to);
  const savingsRate = cf.inflow > 0 ? cf.net / cf.inflow : null;

  const daysRecorded = new Set(
    transactions
      .filter((t) => t.at >= from && t.at < to)
      .map((t) => t.at.slice(0, 10))
  ).size;

  return {
    netWorth,
    runway,
    debtRatio,
    savingsRate,
    inflow: cf.inflow,
    outflow: cf.outflow,
    net: cf.net,
    daysRecorded,
    hasDemo: transactions.some((t) => t.demo),
    quote: pickQuote({ runway, savingsRate }),
    recent: sortDesc(transactions).slice(0, 6).map((t) => rowOf(t, accounts)),
  };
}

module.exports = { buildDashboard, rowOf, sortDesc, thisMonthRange };
