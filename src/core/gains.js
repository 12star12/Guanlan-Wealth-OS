'use strict';

const ledger = require('./ledger');

/**
 * 支出换来的是什么
 *
 * 这份产品的记账单位不是「钱花在哪」，而是「钱换来了什么」。
 * 所以每一笔支出都有一个「收获」，包括只换来心情的那一类。
 *
 * 说不清的消费不是没有价值，是我们没找到词。
 * 一杯奶茶换来的是一下午坐得住，一场电影换来的是一晚上不在工作里——
 * 这些都是真的，只是不能折算成钱。而这一点恰恰该说清楚，不是闭嘴的理由。
 *
 * 底线：不把任何消费说成「投资」，不预测收益，不说「值得 / 不值得」。
 *   「换来的是力气」是事实，「换来的是未来收入」是编的。
 */

/** label 是名词，会作为大字显示；line 是解释，不重复 label */
const GAIN = {
  food:    { label: '力气', line: '下午还能坐得住。' },
  traffic: { label: '抵达', line: '少走的那段路。' },
  life:    { label: '安身', line: '日子照常运转。' },
  growth:  { label: '能力', line: '它不会消失。' },
  fun:     { label: '心情', line: '这几个小时，你不在工作里。' },
};

const DEFAULT = { label: '日常', line: '这一天的其中一部分。' };

/** 一个收获里混了多种东西时（房租和衣服都算「安身」），
 *  用类别通用说法，避免把房租的解释安到衣服上 */
const LABEL_LINE = {
  力气: '下午还能坐得住。',
  抵达: '少走的那段路。',
  安身: '日子照常运转。',
  能力: '它不会消失。',
  心情: '这几个小时，你不在工作里。',
  日常: '这一天的其中一部分。',
};

/** 按支出性质兜底：用户以后自己加分类也能落进来 */
const BY_NATURE = {
  living:  { label: '安身', line: '日子照常运转。' },
  growth:  { label: '能力', line: '它不会消失。' },
  leisure: { label: '心情', line: '这几个小时，你不在工作里。' },
};

/** 同样是「日用」，房租和衣服换来的东西不一样 */
const HOME_WORDS = ['房租', '水电', '物业', '话费', '网费', '宽带', '燃气'];

/**
 * @param {object} account 支出账户
 * @param {string} note 交易备注，用于细分同分类下的不同收获
 */
function gainOf(account, note = '') {
  const id = (account && account.id) || '';
  const n = String(note || '');

  if (id === 'life' && HOME_WORDS.some((w) => n.includes(w))) {
    return { label: '安身', line: '一整个月的落脚处。' };
  }
  if (GAIN[id]) return GAIN[id];
  if (account && account.nature && BY_NATURE[account.nature]) return BY_NATURE[account.nature];
  return DEFAULT;
}

/**
 * 把一段时间的支出归并成「换来了什么」
 * @returns {{label:string, line:string, amount:number, count:number, share:number}[]}
 */
function bucketGains(accounts, transactions, from, to, totalExpense) {
  const acctOf = new Map(accounts.map((a) => [a.id, a]));
  const typeOf = new Map(accounts.map((a) => [a.id, a.type]));
  const map = new Map();

  for (const tx of transactions) {
    if (tx.kind === 'opening') continue;
    if (!ledger.inRange(tx.at, from, to)) continue;
    for (const e of tx.entries || []) {
      if (typeOf.get(e.accountId) !== 'expense' || e.amount <= 0) continue;
      const g = gainOf(acctOf.get(e.accountId), tx.note);
      const cur = map.get(g.label) || { label: g.label, lines: new Set(), amount: 0, count: 0 };
      cur.lines.add(g.line);
      cur.amount += e.amount;
      cur.count += 1;
      map.set(g.label, cur);
    }
  }

  return [...map.values()]
    .sort((a, b) => b.amount - a.amount)
    .map((x) => ({
      label: x.label,
      // 一类里只有一种说法时用它自己的；混了就退回类别通用说法
      line: x.lines.size === 1 ? [...x.lines][0] : (LABEL_LINE[x.label] || DEFAULT.line),
      amount: x.amount,
      count: x.count,
      share: totalExpense > 0 ? x.amount / totalExpense : 0,
    }));
}

module.exports = { GAIN, DEFAULT, LABEL_LINE, gainOf, bucketGains };
