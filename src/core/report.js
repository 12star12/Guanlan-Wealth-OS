'use strict';

/**
 * 月度财报组装 —— 纯函数，不依赖 Electron
 *
 * 与 dashboard 的区别：
 *   dashboard 回答「此刻我怎么样」
 *   report    回答「这个月发生了什么」
 *
 * 所以 report 必须能算「某个月月底的余额」，而不只是当下余额。
 * 做法：把该月之前的所有分录累计起来 —— 余额永远由分录重算，不存储。
 */

const ledger = require('./ledger');
const gains = require('./gains');

const pad2 = (n) => String(n).padStart(2, '0');

/** 某年月的起止（含前不含后），用于字符串区间比较 */
function monthRange(year, month) {
  const from = `${year}-${pad2(month)}-01`;
  const nd = new Date(year, month, 1); // month 是 1 起，正好是下个月
  const to = `${nd.getFullYear()}-${pad2(nd.getMonth() + 1)}-01`;
  return { from, to };
}

function prevMonth(year, month) {
  const d = new Date(year, month - 2, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function nextMonth(year, month) {
  const d = new Date(year, month, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** 某一时点（不含）的账户余额 */
function balancesBefore(transactions, iso) {
  return ledger.accountBalances(transactions.filter((t) => t.at < iso));
}

/**
 * 期间内按账户汇总收入与支出
 * 转账两端都是资产/负债账户，天然不进入这里
 */
function periodTotals(accounts, transactions, from, to) {
  const typeOf = new Map(accounts.map((a) => [a.id, a.type]));
  const income = new Map();
  const expense = new Map();

  for (const tx of transactions) {
    if (!ledger.inRange(tx.at, from, to)) continue;
    // 期初余额不是本期收支，只是把既有资产搬进账本
    if (tx.kind === 'opening') continue;
    for (const e of tx.entries || []) {
      const t = typeOf.get(e.accountId);
      if (t === 'income') income.set(e.accountId, (income.get(e.accountId) || 0) - e.amount);
      else if (t === 'expense') expense.set(e.accountId, (expense.get(e.accountId) || 0) + e.amount);
    }
  }

  const rows = (map, type) => accounts
    .filter((a) => a.type === type && !a.archived)
    .map((a) => ({
      id: a.id,
      name: a.name,
      nature: a.nature || null,
      amount: map.get(a.id) || 0,
    }))
    .filter((x) => x.amount !== 0)
    .sort((a, b) => b.amount - a.amount);

  return { income: rows(income, 'income'), expense: rows(expense, 'expense') };
}

/** 某一时点的资产负债表 */
function snapshot(accounts, transactions, iso) {
  const b = balancesBefore(transactions, iso);

  const assets = accounts
    .filter((a) => a.type === 'asset' && !a.archived)
    .map((a) => ({ id: a.id, name: a.name, liquid: !!a.isLiquid, amount: b.get(a.id) || 0 }))
    .filter((x) => x.amount !== 0)
    .sort((x, y) => y.amount - x.amount);

  const liabilities = accounts
    .filter((a) => a.type === 'liability' && !a.archived)
    .map((a) => ({ id: a.id, name: a.name, amount: -(b.get(a.id) || 0) }))
    .filter((x) => x.amount !== 0)
    .sort((x, y) => y.amount - x.amount);

  const totalAssets = assets.reduce((s, x) => s + x.amount, 0);
  const totalLiabilities = liabilities.reduce((s, x) => s + x.amount, 0);

  return {
    assets,
    liabilities,
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
    liquid: assets.filter((a) => a.liquid).reduce((s, x) => s + x.amount, 0),
  };
}

/**
 * 该月月末的生存月数
 * 分母用「截至该月的近三个月支出中位数」，不用平均数：
 * 一次年终奖式的大额支出会把平均数拉爆。
 */
function runwayAt(accounts, transactions, year, month) {
  const { to } = monthRange(year, month);
  const b = balancesBefore(transactions, to);

  let liquid = 0;
  for (const a of accounts) {
    if (a.type === 'asset' && a.isLiquid && !a.archived) liquid += b.get(a.id) || 0;
  }
  if (liquid <= 0) return 0;

  const outs = [];
  let y = year;
  let m = month;
  for (let i = 0; i < 3; i++) {
    const r = monthRange(y, m);
    const t = periodTotals(accounts, transactions, r.from, r.to);
    const o = t.expense.reduce((s, x) => s + x.amount, 0);
    if (o > 0) outs.push(o);
    const pm = prevMonth(y, m);
    y = pm.year;
    m = pm.month;
  }
  if (!outs.length) return null;

  const avg = ledger.median(outs);
  return avg > 0 ? liquid / avg : null;
}

/** 本月最大的几笔单笔支出 */
function largestExpenses(accounts, transactions, from, to, n = 3) {
  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
  const typeOf = new Map(accounts.map((a) => [a.id, a.type]));
  const out = [];

  for (const tx of transactions) {
    if (!ledger.inRange(tx.at, from, to)) continue;
    for (const e of tx.entries || []) {
      if (typeOf.get(e.accountId) === 'expense' && e.amount > 0) {
        out.push({
          day: tx.at.slice(5, 10).replace('-', '·'),
          note: tx.note || nameOf.get(e.accountId) || '支出',
          cat: nameOf.get(e.accountId) || '支出',
          amount: e.amount,
        });
      }
    }
  }
  return out.sort((a, b) => b.amount - a.amount).slice(0, n);
}

/**
 * 成长投入的纵向统计
 *
 * 这是财报里唯一「跨月」的一节。理由：单笔的学习支出没有意义，
 * 累积起来才有。所以这里回答的不是「这个月花了多少」，
 * 而是「这件事你做了多久」。
 */
function growthStats(accounts, transactions, from, to, monthTotalExpense) {
  const growthIds = new Set(
    accounts.filter((a) => a.type === 'expense' && a.nature === 'growth').map((a) => a.id)
  );
  if (!growthIds.size) return null;

  let allCount = 0;
  let allTotal = 0;
  let firstAt = null;
  let monthCount = 0;
  let monthTotal = 0;

  for (const tx of transactions) {
    if (tx.kind === 'opening') continue;
    for (const e of tx.entries || []) {
      if (!growthIds.has(e.accountId) || e.amount <= 0) continue;
      allCount += 1;
      allTotal += e.amount;
      if (!firstAt || tx.at < firstAt) firstAt = tx.at;
      if (tx.at >= from && tx.at < to) {
        monthCount += 1;
        monthTotal += e.amount;
      }
    }
  }

  const ref = new Date(`${to}T00:00:00`);
  const first = firstAt ? new Date(`${firstAt.slice(0, 10)}T00:00:00`) : null;
  const days = first ? Math.max(0, Math.round((ref - first) / 86400000)) : null;

  return {
    monthCount,
    monthTotal,
    monthShare: monthTotalExpense > 0 ? monthTotal / monthTotalExpense : 0,
    allCount,
    allTotal,
    firstAt: firstAt ? firstAt.slice(0, 10) : null,
    daysSinceFirst: days,
  };
}

/**
 * 结语 —— 纯规则拼装，不接 AI
 * 只陈述事实，不做评价。这是财报，不是鼓励信。
 */
function narration(r) {
  const bits = [];

  // 先讲换来了什么：这是这份产品真正想让用户看见的东西
  if (r.gains && r.gains.length) {
    const labels = r.gains.slice(0, 4).map((g) => g.label);
    const more = r.gains.length > 4 ? '等' : '';
    const top = r.gains[0];
    bits.push(
      `这个月你的钱换来了 ${r.gains.length} 样东西：${labels.join('、')}${more}。`
      + `比重最大的是${top.label}，占 ${(top.share * 100).toFixed(0)}%。`
    );
  }

  // 再说钱了本身
  if (r.delta.netWorth > 0) {
    bits.push(`净资产比上月增加 ¥${(r.delta.netWorth / 100).toFixed(0)}。`);
  } else if (r.delta.netWorth < 0) {
    bits.push(`净资产比上月减少 ¥${(-r.delta.netWorth / 100).toFixed(0)}。`);
  } else {
    bits.push('净资产与上月持平。');
  }

  if (r.runway !== null) {
    bits.push(`按当前流动资产与近三个月支出计算，可以支撑约 ${r.runway.toFixed(1)} 个月。`);
  }

  return bits.join('');
}

function buildMonthlyReport({ accounts, transactions, year, month }) {
  const { from, to } = monthRange(year, month);

  const end = snapshot(accounts, transactions, to);
  const start = snapshot(accounts, transactions, from);
  const { income, expense } = periodTotals(accounts, transactions, from, to);

  const totalIncome = income.reduce((s, x) => s + x.amount, 0);
  const totalExpense = expense.reduce((s, x) => s + x.amount, 0);
  const net = totalIncome - totalExpense;

  const nature = { living: 0, growth: 0, leisure: 0, other: 0 };
  for (const x of expense) {
    const k = x.nature && nature[x.nature] !== undefined ? x.nature : 'other';
    nature[k] += x.amount;
  }

  const p = prevMonth(year, month);
  const pr = monthRange(p.year, p.month);
  const prevEnd = snapshot(accounts, transactions, pr.to);
  const prevTotals = periodTotals(accounts, transactions, pr.from, pr.to);
  const prevIncome = prevTotals.income.reduce((s, x) => s + x.amount, 0);
  const prevExpense = prevTotals.expense.reduce((s, x) => s + x.amount, 0);

  const inMonth = transactions.filter((t) => t.at >= from && t.at < to);

  const runway = runwayAt(accounts, transactions, year, month);
  const debtRatio = end.totalAssets > 0 ? end.totalLiabilities / end.totalAssets : null;

  const report = {
    year,
    month,
    range: { from, to },

    // 期末资产负债表
    assets: end.assets,
    liabilities: end.liabilities,
    totalAssets: end.totalAssets,
    totalLiabilities: end.totalLiabilities,
    netWorth: end.netWorth,
    liquid: end.liquid,

    // 期初（用于展示本月变动）
    startNetWorth: start.netWorth,

    // 本月收支
    income,
    expense,
    totalIncome,
    totalExpense,
    net,
    savingsRate: totalIncome > 0 ? net / totalIncome : null,

    // 支出性质结构
    nature,

    // 三个核心指标
    runway,
    debtRatio,

    // 与上月相比
    prev: {
      year: p.year,
      month: p.month,
      netWorth: prevEnd.netWorth,
      totalIncome: prevIncome,
      totalExpense: prevExpense,
      net: prevIncome - prevExpense,
    },
    delta: {
      netWorth: end.netWorth - prevEnd.netWorth,
      totalIncome: totalIncome - prevIncome,
      totalExpense: totalExpense - prevExpense,
      net: net - (prevIncome - prevExpense),
    },

    gains: gains.bucketGains(accounts, transactions, from, to, totalExpense),
    growth: growthStats(accounts, transactions, from, to, totalExpense),

    largest: largestExpenses(accounts, transactions, from, to, 3),
    txnCount: inMonth.length,
    daysRecorded: new Set(inMonth.map((t) => t.at.slice(0, 10))).size,
    isEmpty: inMonth.length === 0,
  };

  report.narration = narration(report);
  return report;
}

/** 有数据的月份，倒序，用于月份导航 */
function availableMonths(transactions) {
  const set = new Set(transactions.map((t) => t.at.slice(0, 7)));
  return [...set].sort().reverse();
}

module.exports = {
  monthRange,
  prevMonth,
  nextMonth,
  buildMonthlyReport,
  availableMonths,
  snapshot,
  periodTotals,
  runwayAt,
};
