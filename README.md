# 观澜 Guanlan Wealth OS

## 项目简介

观澜（Guanlan Wealth OS）是一款面向个人用户的智能财富管理与成长分析系统。

通过数据分析、金融知识和人工智能技术，帮助用户理解：

- 当前资产状况
- 收支结构
- 财富成长阶段
- 风险情况

## 项目目标

从个人财富管理工具逐步发展为：

- 个人财富操作系统
- 金融教育工具
- 一人公司经营分析平台

## 当前版本

**v0.2 — 可运行的桌面版**

首版只聚焦一件事：**让人能在电脑上坚持记账**。

### 记一笔（完整交互）

- 一句话解析：`午饭25` → 支出 · 餐饮 · 银行卡 · ¥25
- 解析结果全部可改：类型、金额、分类、账户、日期、备注
- 手动改过的字段不会被后续解析覆盖
- 日期支持 今天 / 昨天 / 前天 / 任意日期
- 记完留在本页，可以直接记下一笔，下方列出「刚记下的」并可撤销
- 回车即提交

### 月度财报（可打印）

- 一、资产与负债（期末余额）
- 二、本月收支（收入来源 / 支出分类）
- 三、支出结构（生活 / 成长 / 娱乐占比 + 最大的几笔）
- 四、与上月相比（净资产、收入、支出、结余）
- 五、小结（纯规则生成，不接 AI，只陈述事实）
- 月份可前后翻看；「打印」按钮输出 A4，带独立打印样式

### 底层

- 复式记账，每笔分录之和恒为 0；转账、信用卡还款、退款天然正确
- 三个核心数字：净资产 / 生存月数 / 负债率
- 每日一句（本地库，有出处，按状态匹配）
- 数据存本地 JSON，原子写入，损坏自动备份
- 25 项测试覆盖账目边界与月报计算

## 快速开始

```bash
npm install
npm start
```

> 如果启动报 `Cannot read properties of undefined (reading 'whenReady')`，
> 说明环境里存在 `ELECTRON_RUN_AS_NODE` 变量，先 `unset ELECTRON_RUN_AS_NODE` 再启动。

数据文件位置：用户目录下的 `guanlan-wealth-os/guanlan.json`
（菜单「文件 → 打开数据目录」可直接打开）。

首次启动会放一份示例数据，菜单「文件 → 清空示例数据」可一键清除。

## 测试

```bash
node --test src/test/ledger.test.js src/test/dashboard.test.js src/test/report.test.js
```

## 技术路线

桌面应用（Windows 优先）：

- Electron（主进程 + 渲染进程）
- 原生 ES Module（零构建，改完刷新即生效）
- SQLite（better-sqlite3，本地文件数据库）
- ECharts（图表）
- 复式记账（double-entry bookkeeping）

AI：

- 智谱 GLM-4-Flash（永久免费，兼容 OpenAI API）
- 每周财务分析 / 每季度成长与市场价值评估 / 每月财报

> 早期版本曾规划 Android(Kotlin) + MySQL，已弃用。
> 改为桌面端本地优先，原因见 [docs/architecture.md](docs/architecture.md)。

## 目录结构

```
├── docs/            设计与技术文档
├── src/             应用源码（待建）
│   ├── main/        Electron 主进程
│   ├── renderer/    界面
│   └── core/        复式记账核心（纯函数，可测试）
└── README.md
```

## Development Plan

| 阶段 | 内容 |
|---|---|
| Phase 1 | 课程项目 — 复式记账 + 财务成绩单 |
| Phase 2 | 毕业设计 — 规则引擎、实验验证 |
| Phase 3 | 产品化探索 |

## 三条原则

**温和，但不模糊。**

不因消费产生羞耻，不因资产下降否定用户，不做排名与比较。
但每个风险提示必须带具体数字和具体动作。

**数字必须可追溯。**

所有财务结论由确定性代码计算，AI 只负责解释，不负责计算。

**只增不减的才是成长。**

会波动的指标会制造焦虑。成长类指标必须单调递增。

## 文档

- [产品设计](docs/product_zh.md)
- [V1 范围](docs/requirements.md)
- [系统架构](docs/architecture.md)
- [数据库设计](docs/database.md)
- [开发指南](docs/development.md)
