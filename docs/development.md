# 开发指南

## 技术栈

```
外壳      Electron
界面      原生 ES Module + CSS（零构建）
图表      ECharts
数据库    SQLite（better-sqlite3）
AI        智谱 GLM-4-Flash（永久免费）
测试      Node 内置 test runner
```

> 早期规划的 Android(Kotlin) + MySQL 已弃用。原因见 [architecture.md](architecture.md)。

## 环境准备

```bash
# 1. Node.js 18+
node -v

# 2. 安装依赖
npm init -y
npm i electron better-sqlite3 echarts
npm i -D electron-builder

# 3. 启动开发
npx electron .
```

## 目录结构

```
src/
├── main/
│   ├── index.js        主进程入口
│   ├── db.js           SQLite 连接与迁移
│   ├── ipc.js          IPC 接口定义
│   └── ai.js           GLM 调用（API Key 只在这里）
├── preload/
│   └── index.js        contextBridge 暴露受限接口
├── core/               ★ 纯逻辑，不碰 IO，可单测
│   ├── ledger.js       复式记账：余额、现金流
│   ├── metrics.js      指标：净资产、生存月数、储蓄率
│   ├── facts.js        组装 facts.json
│   ├── narrative.js    AI 叙述的骨架与校验
│   └── quotes.js       名言选择
├── renderer/
│   ├── index.html
│   ├── app.js
│   └── styles/
└── test/
    ├── ledger.test.js
    └── metrics.test.js
```

**`src/core/` 必须不依赖 Electron、不依赖数据库、不依赖网络。**
这样它可以被单元测试完整覆盖——这是整个项目的技术地基。

## 开发顺序

| 阶段 | 内容 | 验收 |
|---|---|---|
| 0 | `core/ledger.js` + 测试 | 20 个测试全绿，能手工验算一个月的账 |
| 1 | SQLite 建库 + IPC + 记一笔界面 | 能连续记一个月真实数据，余额与银行 App 对得上 |
| 2 | 财务成绩单（三个核心数字） | 首页首屏可见，不需滚动 |
| 3 | 名言 + 每周 AI 分析 | 报告中每个数字都能在 facts 里找到 |
| 4 | 月度财报（可打印页面） | 导出的 PDF 排版完整 |
| 5 | 创收记录 + 成长证据 | 可回看"我曾经做成过 N 次" |
| 6 | 备份/导出/恢复 | 换机器能完整恢复 |

**先写核心逻辑和测试，再写界面。** 顺序反了会返工。

## 编码约定

- 金额一律用**整数分**，不用浮点
- 日期存 ISO 字符串（`2026-11-14T12:00:00+08:00`）
- 所有数据库写入走事务
- 删除用软删除（`archived`），不物理删除财务记录
- 渲染进程不持有 API Key

## AI 配置

```bash
# .env（加入 .gitignore）
GLM_API_KEY=your_key_here
```

- 注册：https://open.bigmodel.cn
- 模型：`glm-4-flash`（永久免费，不要用 glm-5，那是付费的）
- 兼容 OpenAI SDK 格式，可以直接用 `openai` 包，改 baseURL

```js
const client = new OpenAI({
  apiKey: process.env.GLM_API_KEY,
  baseURL: 'https://open.bigmodel.cn/api/paas/v4'
});
```

**API Key 用 Electron `safeStorage` 加密后存本地，不写进代码、不进渲染进程。**

## 测试

```bash
node --test src/test/
```

`core/` 下的每个函数都应该有测试。财务计算没有测试等于没有实现。

## 提交规范

```
feat: 新增周报生成
fix: 修复转账被计入支出的问题
docs: 更新数据库设计
refactor: 抽出 metrics 模块
test: 补充退款场景测试
```
