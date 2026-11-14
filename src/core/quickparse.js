'use strict';

const { T } = require('./ledger');

/**
 * 自然语言记账解析
 *
 * 记账 App 死亡的原因只有一个：每笔都要选分类、填金额、点保存。
 * 这个模块就是为了把那三步压成一行字。
 *
 * 规则优先，不调 AI —— 确定性、即时、零成本。
 */

/** 分类关键词（越靠前优先级越高） */
const RULES = [
  { id: 'food',    words: ['饭', '午餐', '晚餐', '早餐', '早饭', '午饭', '晚饭', '吃', '外卖', '奶茶', '咖啡', '零食', '餐', '水果'] },
  { id: 'traffic', words: ['地铁', '公交', '打车', '车费', '油', '停车', '高铁', '火车', '机票', '单车'] },
  { id: 'growth',  words: ['书', '课程', '网课', '学习', '培训', '会员', '订阅', '资料'] },
  { id: 'fun',     words: ['电影', '游戏', '娱乐', 'ktv', '演出', '门票'] },
  { id: 'life',    words: ['超市', '日用', '纸', '房租', '水费', '电费', '话费', '网费', '快递', '洗'] },
];

/** 收入关键词 */
const INCOME_WORDS = ['工资', '薪', '稿费', '奖金', '收入', '红包', '分成', '结算', '到账', '赚'];
const SIDE_WORDS = ['稿', '兼职', '项目', '外包', '副业'];

/** 转账关键词 */
const TRANSFER_WORDS = ['转', '转账', '还信用卡', '还款'];

/** 账户关键词 */
const ACCOUNT_WORDS = [
  { id: 'alipay', words: ['支付宝'] },
  { id: 'wechat', words: ['微信'] },
  { id: 'cash',   words: ['现金'] },
  { id: 'credit', words: ['信用卡'] },
];

/**
 * @param {string} text 用户输入
 * @param {Array} accounts 账户列表（用于校验 id 是否有效）
 * @returns {{ok:boolean, reason?:string, data?:object}}
 */
function parseQuick(text, accounts = []) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, reason: '没有内容' };

  // 1. 金额：第一个数字（支持小数）
  const m = raw.match(/(\d+(?:\.\d{1,2})?)/);
  if (!m) return { ok: false, reason: '没找到金额' };
  const yuan = parseFloat(m[1]);
  if (!(yuan > 0)) return { ok: false, reason: '金额必须大于 0' };
  const amount = Math.round(yuan * 100);

  const has = (words) => words.some(w => raw.includes(w));

  // 2. 转账
  if (has(TRANSFER_WORDS)) {
    const toAcc = ACCOUNT_WORDS.find(a => has(a.words));
    const from = 'bank';
    const to = toAcc ? toAcc.id : 'alipay';
    if (from === to) return { ok: false, reason: '转出与转入账户相同' };
    return {
      ok: true,
      data: {
        kind: 'transfer',
        amount,
        note: raw,
        fromAccountId: from,
        toAccountId: to,
      },
    };
  }

  // 3. 收入还是支出
  let kind = 'expense';
  let categoryId = 'life';

  if (has(INCOME_WORDS)) {
    kind = 'income';
    categoryId = has(SIDE_WORDS) ? 'side' : 'salary';
  } else {
    // 支出：按关键词找分类，找不到默认日用
    const hit = RULES.find(r => has(r.words));
    categoryId = hit ? hit.id : 'life';
  }

  // 4. 支付账户
  const accHit = ACCOUNT_WORDS.find(a => has(a.words));
  const accountId = accHit ? accHit.id : 'bank';

  return {
    ok: true,
    data: { kind, amount, note: raw, accountId, categoryId },
  };
}

/** 把解析结果转成复式记账的分录 */
function toEntries(p) {
  if (p.kind === 'transfer') {
    return [
      { accountId: p.fromAccountId, amount: -p.amount },
      { accountId: p.toAccountId,   amount:  p.amount },
    ];
  }
  if (p.kind === 'income') {
    return [
      { accountId: p.accountId, amount:  p.amount },
      { accountId: p.categoryId, amount: -p.amount },
    ];
  }
  // expense
  return [
    { accountId: p.accountId, amount: -p.amount },
    { accountId: p.categoryId, amount:  p.amount },
  ];
}

module.exports = { parseQuick, toEntries, RULES, INCOME_WORDS };
