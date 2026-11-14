'use strict';

/**
 * 每日一句
 *
 * 铁律：名言不走 AI 生成。
 * LLM 会编造出处（"爱因斯坦说：记账是自由的开始"），一旦出现假引用，
 * 产品的可信度立刻归零。所以这里全部是人工核对过的条目，
 * source 具体到书名与篇章。
 *
 * 选择逻辑：按用户当下状态匹配标签，不随机。
 * 匹配不上就不显示 —— 宁缺毋滥。
 */

const QUOTES = [
  {
    text: '知足者富。',
    author: '老子',
    source: '《道德经》第三十三章',
    tags: ['知足', '通用'],
  },
  {
    text: '生财有大道：生之者众，食之者寡，为之者疾，用之者舒，则财恒足矣。',
    author: '《礼记》',
    source: '《大学》',
    tags: ['节制', '积累', '通用'],
  },
  {
    text: '一粥一饭，当思来处不易；半丝半缕，恒念物力维艰。',
    author: '朱柏庐',
    source: '《朱子家训》',
    tags: ['节制'],
  },
  {
    text: '积财千万，不如薄伎在身。',
    author: '颜之推',
    source: '《颜氏家训·勉学》',
    tags: ['成长', '积累'],
  },
  {
    text: '无财作力，少有斗智，既饶争时。',
    author: '司马迁',
    source: '《史记·货殖列传》',
    tags: ['阶段', '眼光', '通用'],
  },
  {
    text: '不义而富且贵，于我如浮云。',
    author: '孔子',
    source: '《论语·述而》',
    tags: ['义利'],
  },
  {
    text: '仓廪实则知礼节，衣食足则知荣辱。',
    author: '管仲',
    source: '《管子·牧民》',
    tags: ['基础', '通用'],
  },
  {
    text: '君子藏器于身，待时而动。',
    author: '',
    source: '《周易·系辞下》',
    tags: ['积累', '耐心'],
  },
];

/**
 * 根据状态挑选
 * @param {object} state { runway, savingsRate, inflow, outflow, hasRecentIncome }
 * @returns {object|null}
 */
function pickQuote(state = {}) {
  const tags = [];

  if (state.runway !== null && state.runway !== undefined && state.runway < 3) tags.push('基础');
  if (state.savingsRate !== null && state.savingsRate !== undefined && state.savingsRate < 0) tags.push('节制');
  if (state.savingsRate !== null && state.savingsRate !== undefined && state.savingsRate > 0.3) tags.push('积累');
  if (state.noIncomeDays >= 21) tags.push('耐心');
  if (state.firstIncome) tags.push('成长');

  const hit = QUOTES.filter(q => q.tags.some(t => tags.includes(t)));
  const pool = hit.length ? hit : QUOTES.filter(q => q.tags.includes('通用'));

  // 同一天稳定同一条，不随刷新跳变
  const dayIndex = Math.floor(Date.now() / 86400000);
  return pool[dayIndex % pool.length] || null;
}

module.exports = { QUOTES, pickQuote };
