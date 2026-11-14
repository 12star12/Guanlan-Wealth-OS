'use strict';

const ledger = require('./ledger');

/**
 * 资产台账 —— 纯函数，可脱开 Electron 测试
 *
 * 设计前提：余额永不存储，永远由分录累加得出。
 * 那用户想「直接把余额改成 8,600」怎么办？
 * 不存字段，而是生成一笔「调整」交易，把差额记进资产调整账户。
 * 这样复式记账不被破坏，净资产、财报、生存月数全部自动跟上。
 */

/** 资产调整账户：只用来配平，界面上不出现 */
const ADJUST_ID = 'adjust';

/** 负债在库里是负数（欠 100 记 -100），给人看的时候取反 */
function shown(account, balanceFen) {
  const b = balanceFen || 0;
  return account && account.type === 'liability' ? -b : b;
}

/** 人输入的数 → 库里的余额 */
function internal(account, shownFen) {
  return account && account.type === 'liability' ? -shownFen : shownFen;
}

/**
 * 把某个账户的余额改成 targetShownFen（分，人看到的数）
 *
 * @returns {{ok:boolean, reason?:string, delta?:number, tx?:object|null}}
 */
function planAdjust({ account, balanceFen = 0, targetShownFen }) {
  if (!account) return { ok: false, reason: '账户不存在' };
  if (!Number.isInteger(targetShownFen)) return { ok: false, reason: '金额不合法' };
  if (Math.abs(targetShownFen) > 1e12) return { ok: false, reason: '金额过大' };

  const target = internal(account, targetShownFen);
  const delta = target - (balanceFen || 0);
  if (delta === 0) return { ok: true, delta: 0, tx: null };

  const tx = {
    kind: 'adjust',
    note: `调整 · ${account.name}`,
    entries: [
      { accountId: account.id, amount: delta },
      { accountId: ADJUST_ID, amount: -delta },
    ],
  };

  const check = ledger.validateTransaction({ entries: tx.entries });
  if (!check.ok) return { ok: false, reason: check.reason };

  return { ok: true, delta, tx };
}

/**
 * 资产页要的全部数据
 * 只返回未归档的账户；负债合计数为正（欠多少）
 */
function summarize(accounts, balances) {
  const pick = (type) => accounts
    .filter((a) => a.type === type && !a.archived)
    .map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      liquid: !!a.isLiquid,
      balance: shown(a, balances.get(a.id) || 0),
    }));

  const assets = pick(ledger.T.ASSET);
  const liabilities = pick(ledger.T.LIABILITY);

  const sum = (list) => list.reduce((s, x) => s + x.balance, 0);
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);

  return {
    assets,
    liabilities,
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
  };
}

module.exports = { ADJUST_ID, shown, internal, planAdjust, summarize };
