# 数据库设计

## 一、为什么必须用复式记账

产品有三条硬性要求：

1. 账户转账不应重复计入收入和支出
2. 借款不应算作创收收入
3. 出售原有资产应区分资产处置和新增经营收入

**这三条用单式记账（记一条流水）实现不了。**

反例：银行卡转支付宝 5000 元。

- 单式记账：记两条（银行卡 −5000、支付宝 +5000）。看起来对，但统计"本月总支出"时会被算成支出 5000。
- 加特判：每遇到转账就跳过。但转账嵌套（信用卡还款、内部划转）时特判逻辑会组合爆炸。

复式记账用一条规则解决全部问题：**每笔交易的所有分录金额之和必须为 0。**

```
转账 5000    银行卡 −5000   支付宝 +5000      合计 0 ✓
工资 10000   银行卡 +10000  工资收入 −10000   合计 0 ✓
消费 200     银行卡 −200    餐饮支出 +200     合计 0 ✓
```

转账两端都是资产账户，天然不影响现金流。**不需要任何特判。**

## 二、三条设计原则

1. **余额永远不存字段，永远实时算。** 存余额字段必然出现"余额和流水对不上"的 bug。
2. **每笔交易的分录金额之和为 0。** 应用层校验 + 单元测试双保险。
3. **期初余额是一笔交易，不是账户表里的字段。** 这样历史可追溯。

## 三、表结构

### 账户

```sql
CREATE TABLE account (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  type        TEXT    NOT NULL,   -- asset | liability | income | expense
  subtype     TEXT,               -- cash/bank/investment/receivable/credit/loan
  currency    TEXT    NOT NULL DEFAULT 'CNY',
  is_liquid   INTEGER NOT NULL DEFAULT 0,  -- 是否可立即动用（算生存月数用）
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL
);
```

### 交易

```sql
CREATE TABLE transaction (
  id          INTEGER PRIMARY KEY,
  occurred_at TEXT    NOT NULL,   -- 业务发生时间（可补记）
  kind        TEXT    NOT NULL,   -- income|expense|transfer|adjust|opening
  note        TEXT,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT
);
```

### 分录（核心）

```sql
CREATE TABLE entry (
  id             INTEGER PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES transaction(id) ON DELETE CASCADE,
  account_id     INTEGER NOT NULL REFERENCES account(id),
  amount         INTEGER NOT NULL   -- 单位：分，带符号
);
CREATE INDEX idx_entry_txn ON entry(transaction_id);
CREATE INDEX idx_entry_acc ON entry(account_id);
```

> 金额用**整数分**存储，不用浮点。浮点在财务系统里一定会出错。

### 分类

```sql
CREATE TABLE category (
  id        INTEGER PRIMARY KEY,
  name      TEXT    NOT NULL,
  parent_id INTEGER REFERENCES category(id),
  kind      TEXT    NOT NULL,   -- income | expense
  nature    TEXT                -- living|growth|productive|leisure
);
```

`nature` 用于"尊重消费"的反馈：不评判，只归类。

### 创收行动

```sql
CREATE TABLE earn_action (
  id            INTEGER PRIMARY KEY,
  occurred_at   TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  kind          TEXT,             -- writing|code|consult|service|learn|outreach|other
  status        TEXT    NOT NULL, -- planned|acting|done_no_income|income_pending|income_received
  linked_txn_id INTEGER REFERENCES transaction(id),
  note          TEXT
);
```

**行动 ≠ 收入。** 一次行动没有收入，也值得记录——它是"你尝试过"的证据。

### 成长证据

```sql
CREATE TABLE growth_event (
  id          INTEGER PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  title       TEXT NOT NULL,
  kind        TEXT,              -- knowledge|skill|experience|work|artifact
  summary     TEXT,
  evidence    TEXT               -- 链接或文件路径
);
```

### 报告存档

```sql
CREATE TABLE report (
  id           INTEGER PRIMARY KEY,
  period       TEXT NOT NULL,    -- '2026-W46' | '2026-11' | '2026-Q4'
  type         TEXT NOT NULL,    -- weekly | monthly | quarterly
  generated_at TEXT NOT NULL,
  facts_json   TEXT NOT NULL,    -- 生成时的完整指标快照
  narrative_md TEXT,
  model        TEXT,
  verified     INTEGER DEFAULT 0 -- 数字校验是否通过
);
```

**facts_json 必须存档。** 它是"每条结论可追溯"的唯一保证。

### 名言库（离线）

```sql
CREATE TABLE quote (
  id      INTEGER PRIMARY KEY,
  text    TEXT NOT NULL,
  author  TEXT NOT NULL,
  source  TEXT NOT NULL,   -- 必须具体到书名/篇章/演讲，不能只写人名
  tags    TEXT,            -- 逗号分隔：节制,耐心,开始,复利
  used_at TEXT             -- 避免短期内重复
);
```

**名言不经过 AI 生成。** LLM 会编造出处，一旦出现假引用，产品可信度归零。

## 四、关键计算

```js
账户余额   = Σ entry.amount  (WHERE account_id = X)
总资产     = Σ 余额 WHERE type='asset'
总负债     = −Σ 余额 WHERE type='liability'
净资产     = 总资产 − 总负债

期间流入   = Σ|amount| WHERE account.type='income'
期间流出   = Σ|amount| WHERE account.type='expense'
净现金流   = 期间流入 − 期间流出

生存月数   = Σ(余额 WHERE type='asset' AND is_liquid=1) ÷ 近3月支出中位数
负债率     = 总负债 ÷ 总资产
储蓄率     = 净现金流 ÷ 期间流入
```

## 五、符号约定（全系统统一）

**负债账户余额存为负数。** 欠 10000 存 −10000。

这样 `净资产 = Σ(所有账户余额)`，一行代码，不需要分类讨论。

用户输入时永远填正数（"我欠 10000"），UI 层取反。**这个转换只在一处发生**，其他所有地方遵守同一约定。

## 六、必须覆盖的边界（写测试用）

- [ ] 期初余额如何记账
- [ ] 退款（原支出的反向）
- [ ] 信用卡还款（负债减少 + 资产减少）
- [ ] 一笔交易跨多账户（工资直接扣社保）
- [ ] 修改历史交易后余额重算
- [ ] 删除交易后余额重算
- [ ] 转账不改变净现金流
- [ ] 借款不计入收入
- [ ] 出售资产区分"资产处置"与"经营收入"
- [ ] 跨月/跨年边界的期间归属
