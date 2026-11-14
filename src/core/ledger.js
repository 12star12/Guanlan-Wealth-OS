'use strict';

/**
 * 复式记账核心 —— 纯函数，不依赖任何 IO
 *
 * 金额单位：分（整数）。财务系统绝不用浮点。
 *
 * 核心规则：每笔交易的所有分录金额之和必须为 0。
 *   工资 10000   → 银行卡 +1000000 / 工资收入 -1000000
 *   消费 200     → 银行卡   -20000 / 餐饮支出   +20000
 *   转账 5000    → 银行卡 -500000 / 支付宝     +500000
 *
 * 因为转账两端都是资产账户，天然不影响现金流，不需要任何特判。
 */

/** 账户类型 */
const T = {
  ASSET: 'asset',
  LIABILITY: 'liability',
  INCOME: 'income',
  EXPENSE: 'expense',
};

/**
 * 校验一笔交易是否合法
 * @returns {{ok: boolean, reason?: string}}
 */
function validateTransaction(tx) {
  if (!tx) return { ok: false, reason: '交易为空' };
  if (!Array.isArray(tx.entries)) return { ok: false, reason: '缺少分录' };
  if (tx.entries.length < 2) return { ok: false, reason: '分录少于两条' };

  let sum = 0;
  for (const e of tx.entries) {
    if (!Number.isInteger(e.amount)) {
      return { ok: false, reason: `金额必须是整数（分），收到 ${e.amount}` };
    }
    if (e.amount === 0) return { ok: false, reason: '分录金额不能为 0' };
    sum += e.amount;
  }
  if (sum !== 0) return { ok: false, reason: `分录之和为 ${sum}，应为 0` };

  return { ok: true };
}

/**
 * 计算每个账户的余额
 * 余额永不存储，永远由分录实时算出
 *
 * @param {Array} transactions 交易数组，每项含 entries
 * @returns {Map<string, number>} accountId -> 余额（分）
 */
function accountBalances(transactions) {
  const balances = new Map();
  for (const tx of transactions) {
    for (const e of tx.entries || []) {
      balances.set(e.accountId, (balances.get(e.accountId) || 0) + e.amount);
    }
  }
  return balances;
}

/** 按类型汇总账户余额 */
function balanceByType(accounts, balances) {
  const out = { asset: 0, liability: 0, income: 0, expense: 0 };
  for (const acc of accounts) {
    if (acc.archived) continue;
    const b = balances.get(acc.id) || 0;
    if (out[acc.type] !== undefined) out[acc.type] += b;
  }
  return out;
}

/**
 * 总负债：负债账户余额为负数，取反得正数
 * 符号约定：欠 10000 存 -10000
 */
function totalLiabilities(accounts, balances) {
  return -balanceByType(accounts, balances).liability;
}

function totalAssets(accounts, balances) {
  return balanceByType(accounts, balances).asset;
}

/** 净资产 = 总资产 − 总负债 */
function netWorth(accounts, balances) {
  return totalAssets(accounts, balances) - totalLiabilities(accounts, balances);
}

/** 判断交易是否落在期间内（ISO 字符串比较） */
function inRange(at, from, to) {
  if (from && at < from) return false;
  if (to && at >= to) return false;
  return true;
}

/**
 * 期间现金流
 * 流入 = 收入类账户分录之和的相反数（收入记负数）
 * 流出 = 支出类账户分录之和（支出记正数）
 * 转账因此在两端都是资产账户，不进入这里
 *
 * @returns {{inflow:number, outflow:number, net:number}} 单位：分
 */
function cashflow(transactions, accounts, from, to) {
  const typeOf = new Map(accounts.map(a => [a.id, a.type]));
  let inflow = 0;
  let outflow = 0;

  for (const tx of transactions) {
    if (!inRange(tx.at, from, to)) continue;
    // 期初余额不是本期赚到的钱。它的对方科目记在收入账户上只是为了配平，
    // 若不做这个排除，开账那个月会被算成「收入 3 万」，报表立刻失真。
    if (tx.kind === 'opening') continue;
    for (const e of tx.entries || []) {
      const t = typeOf.get(e.accountId);
      if (t === T.INCOME) inflow -= e.amount;   // 收入账户记负数，取反
      else if (t === T.EXPENSE) outflow += e.amount;
    }
  }
  return { inflow, outflow, net: inflow - outflow };
}

/** 可立即动用的流动资产（分） */
function liquidAssets(accounts, balances) {
  let sum = 0;
  for (const acc of accounts) {
    if (acc.archived) continue;
    if (acc.type === T.ASSET && acc.isLiquid) sum += balances.get(acc.id) || 0;
  }
  return sum;
}

/** 中位数 */
function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * 生存月数 = 可动用流动资产 ÷ 近 3 个月支出中位数
 * 用中位数不用平均数：一次大额支出会把平均数拉爆
 *
 * @returns {number|null} 无支出数据时返回 null
 */
function runway(accounts, balances, transactions, now = new Date()) {
  const liquid = liquidAssets(accounts, balances);
  if (liquid <= 0) return 0;

  const months = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const nd = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const to = `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-01`;
    const cf = cashflow(transactions, accounts, from, to);
    if (cf.outflow > 0) months.push(cf.outflow);
  }
  if (!months.length) return null;

  const avg = median(months);
  if (avg <= 0) return null;
  return liquid / avg;
}

/** 负债率 = 总负债 ÷ 总资产 */
function debtRatio(accounts, balances) {
  const assets = totalAssets(accounts, balances);
  if (assets <= 0) return null;
  return totalLiabilities(accounts, balances) / assets;
}

/** 储蓄率 = 净现金流 ÷ 流入 */
function savingsRate(accounts, balances, transactions, from, to) {
  const cf = cashflow(transactions, accounts, from, to);
  if (cf.inflow <= 0) return null;
  return cf.net / cf.inflow;
}

module.exports = {
  T,
  validateTransaction,
  accountBalances,
  balanceByType,
  totalAssets,
  totalLiabilities,
  netWorth,
  cashflow,
  liquidAssets,
  runway,
  debtRatio,
  savingsRate,
  median,
  inRange,
};
