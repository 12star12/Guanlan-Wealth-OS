'use strict';

/**
 * 记账回执 —— 记完一笔之后，跟用户说的那句话
 *
 * 三条原则，写死在代码里：
 *
 *   1. 表扬靠事实，不靠形容词。
 *      「第 7 次」比「太棒了」有力，因为前者无法伪造。
 *
 *   2. 不是每笔消费都有积极意义。
 *      说得清去向的才赋义（成长、安身），说不清的只给位置，不硬拗。
 *      一旦每笔都夸成「投资」，用户三天免疫，信誉一次性赔光。
 *
 *   3. 只陈述，不指挥。
 *      没有「应该」「建议」「注意」，也不预测未来收入。
 */

const DAY = 86400000;

function toDate(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

function daysAgo(iso, now) {
  const d = toDate(iso);
  if (!d) return null;
  return Math.max(0, Math.round((now.getTime() - d.getTime()) / DAY));
}

function monthKey(iso) {
  return String(iso).slice(0, 7);
}

/** 抽出所有收入分录（跳过期初：那不是赚来的钱） */
function incomeItems(transactions, accounts) {
  const incomeIds = new Set(accounts.filter((a) => a.type === 'income').map((a) => a.id));
  const out = [];
  for (const tx of transactions) {
    if (tx.kind === 'opening') continue;
    for (const e of tx.entries || []) {
      if (incomeIds.has(e.accountId) && e.amount < 0) {
        out.push({ txId: tx.id, at: tx.at, sourceId: e.accountId, amount: -e.amount });
      }
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1));
}

/** 抽出所有支出分录 */
function expenseItems(transactions, accounts) {
  const typeOf = new Map(accounts.map((a) => [a.id, a.type]));
  const out = [];
  for (const tx of transactions) {
    if (tx.kind === 'opening') continue;
    for (const e of tx.entries || []) {
      if (typeOf.get(e.accountId) === 'expense' && e.amount > 0) {
        out.push({ txId: tx.id, at: tx.at, catId: e.accountId, amount: e.amount });
      }
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1));
}

const gains = require('./gains');

/**
 * 生成回执
 * @param {object} input { tx, accounts, transactions, now }
 * @returns {{tone:string, badge:string, amount:number, lines:string[]}}
 */
function assess({ tx, accounts, transactions, now = new Date() }) {
  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
  const acctOf = new Map(accounts.map((a) => [a.id, a]));

  if (!tx) return null;

  /* ---------------- 转账：不夸，只说明 ---------------- */
  if (tx.kind === 'transfer') {
    const neg = (tx.entries || []).find((e) => e.amount < 0);
    const pos = (tx.entries || []).find((e) => e.amount > 0);
    return {
      tone: 'plain',
      badge: '转 账',
      amount: Math.abs((neg || {}).amount || 0),
      lines: [
        `钱从${nameOf.get((neg || {}).accountId) || '一个账户'}到${nameOf.get((pos || {}).accountId) || '另一个账户'}。`,
        '总额没变，本月收支也没变。',
      ],
    };
  }

  /* ---------------- 收入 ---------------- */
  if (tx.kind === 'income') {
    const all = incomeItems(transactions, accounts);
    const mine = all.find((i) => i.txId === tx.id) || all[all.length - 1];
    const before = all.filter((i) => i.at < mine.at);
    const count = before.length + 1;
    const sourceId = mine.sourceId;
    const sourceName = nameOf.get(sourceId) || '收入';
    const sourcesAll = new Set(all.map((i) => i.sourceId));
    const firstFromThisSource = !before.some((i) => i.sourceId === sourceId);
    const lastAt = before.length ? before[before.length - 1].at : null;

    const lines = [];

    if (count === 1) {
      lines.push('这是你记下的第一笔收入。');
      lines.push('从今天起，这件事有据可查。');
      return { tone: 'income', badge: '第 1 次创收', amount: mine.amount, lines };
    }

    if (firstFromThisSource) {
      lines.push(`这是「${sourceName}」这个来源的第一次。`);
      lines.push(`此前 ${before.length} 次都来自其他来源，现在多了一条路。`);
      return { tone: 'income', badge: `第 ${count} 次创收`, amount: mine.amount, lines };
    }

    // 同一来源重复发生：说清节奏，这比「继续加油」有用
    const gap = lastAt ? daysAgo(lastAt, toDate(mine.at) || now) : null;
    if (count >= 5) {
      lines.push(`这是第 ${count} 次把能力换成钱。`);
    } else {
      lines.push(`这是第 ${count} 次。`);
    }

    const facts = [];
    if (gap !== null) facts.push(`距上次 ${gap} 天`);
    facts.push(`共 ${sourcesAll.size} 个来源`);
    lines.push(facts.join(' · ') + '。');

    return { tone: 'income', badge: `第 ${count} 次 · ${sourceName}`, amount: mine.amount, lines };
  }

  /* ---------------- 支出 ---------------- */
  const all = expenseItems(transactions, accounts);
  const mine = all.find((i) => i.txId === tx.id) || all[all.length - 1];
  const catId = mine.catId;
  const catName = nameOf.get(catId) || '支出';
  const nature = (acctOf.get(catId) || {}).nature || null;

  const mk = monthKey(mine.at);
  const sameMonth = all.filter((i) => monthKey(i.at) === mk);
  const monthCat = sameMonth.filter((i) => i.catId === catId);
  const monthTotal = sameMonth.reduce((s, i) => s + i.amount, 0);
  const catTotal = monthCat.reduce((s, i) => s + i.amount, 0);
  const share = monthTotal > 0 ? Math.round((catTotal / monthTotal) * 100) : 0;

  const before = all.filter((i) => i.at < mine.at && i.catId === catId);
  const nthThisMonth = monthCat.filter((i) => i.at <= mine.at).length;
  const isLargest = monthCat.every((i) => i.amount <= mine.amount) && monthCat.length > 1;

  const lines = [];
  let badge = `${catName} · 本月第 ${nthThisMonth} 笔`;

  // 这笔钱换来了什么 —— 每一类都有答案，包括只换来心情的那一类
  const gain = gains.gainOf(acctOf.get(catId), tx.note);

  if (nature === 'growth') {
    // 成长投入是唯一值得纵向回指的一类：它累积，而且不会消失
    const firstEver = all.filter((i) => i.catId === catId)[0];
    const days = firstEver ? daysAgo(firstEver.at, toDate(mine.at) || now) : null;

    lines.push(`本月第 ${nthThisMonth} 次为学习花钱，累计 ¥${(catTotal / 100).toFixed(0)}。`);
    if (days !== null && days >= 60) {
      lines.push(`第一次是 ${days} 天前。这件事你一直在做。`);
    } else if (before.length === 0) {
      lines.push('这是你第一次为学习花钱。它不会立刻变成钱，但它不会消失。');
    } else {
      lines.push('它不会立刻变成钱，但它不会消失。');
    }
    badge = `成长 · 本月第 ${nthThisMonth} 次`;
    return { tone: 'growth', badge, title: gain.label, amount: mine.amount, lines, gain: gain.label };
  }

  if (isLargest) {
    lines.push(`这是本月金额最大的一次支出，占本月支出 ${share}%。`);
  } else {
    lines.push(`本月同类共 ${nthThisMonth} 笔，合计 ¥${(catTotal / 100).toFixed(0)}，占支出 ${share}%。`);
  }

  lines.push(gain.line);

  return {
    tone: nature === 'leisure' ? 'leisure' : (nature || 'plain'),
    badge,
    title: gain.label,
    amount: mine.amount,
    lines,
    gain: gain.label,
  };
}

module.exports = { assess, incomeItems, expenseItems, daysAgo };
