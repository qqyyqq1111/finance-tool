---
name: "finance-batch-pipeline"
description: "双人理财助手项目(finance-tool)的批次开发流水线：按PRD规格→数据层→纯函数→UI→单测→浏览器验收→小步commit合main。当开始任一新批次(批次⑤/v1.1增量)开发、或用户说'继续批次N'时调用。"
---

# finance-tool 批次开发流水线

本项目（双人家庭AI理财助手，纯静态 HTML5+Tailwind CDN+vanilla JS+LocalStorage）已固化的批次开发流程。开发任一批次时严格按此流水线执行，保证作品集迭代记录质量与验收一致性。

## 0. 开工前必读（按顺序）

1. `docs/06-产品路线图&Git迭代规划.md` — 找当前批次的功能清单/交付物/验收标准
2. `docs/07-分模块PRD.md` — 对应章节的字段定义/交互/验收用例（批次①→§2/§3，②→§4/§5，③→§6，④→§7/§8/§9，加密→§5 vault）
3. `docs/08-开源参考项目调研.md` — 算法借鉴来源与 License 红线（MIT/Apache 可用；AGPL/无license 只看设计）
4. `docs/00-项目工作交接总览.md` §5.4 需求池 — 看有无已记录反馈需顺带处理

## 1. 分支与任务清单

- 建分支：`git checkout -b feature/batchN-<英文短名>`（在 main 上建）
- 用 TodoWrite 建任务：数据层→纯函数→UI→单测→浏览器验收→提交合并

## 2. 代码分层（红线）

文件结构固定：`js/` = db / privacy / ledger / split / dashboard / settings / app.js。

1. **db.js 数据层**：LocalStorage key 统一 `fc_` 前缀；金额一律以**分（整数）**存储；写操作返回 `{ok, errors[]}`；schema 版本迁移；新增写操作注意已结算月份锁定（settlementLockError）。
2. **业务纯函数模块**（privacy/split/dashboard）：核心逻辑写成不碰 DOM、不直接读 localStorage 的纯函数（参数传入 transactions/settings/viewer），便于 node 单测。
3. **取数红线**：任何页面任何统计必须经 `fcPrivacy` 过滤（public/private/vault × 查看人），禁止页面自行过滤隐私。
4. **UI 层**：index.html 加结构 + 对应 js 模块 render/bind；**新模块必须在 app.js boot() 里调用 `xxx.bind()`**（批次③曾漏挂事件），并在 showPage()/renderAll() 里触发该页 render。
5. PowerShell 环境：命令链用 `;` 不用 `&&`/`||`；commit 用单行 `-m`，不用 heredoc。

## 3. 关键设计教训（已踩坑）

- **规则类配置改动不追溯历史**：分摊比例在落账时固化到交易（`splitRatio` 字段），结算读账目自带值而非当前规则。
- **importAll 校验**：validateTx 需支持 ctx 参数（用备份自带 members/accounts 校验，此时备份未写入）。
- **尾差处理**：金额分摊 m1 按比例四舍五入、m2 找补，保证 Σshares=原额。
- **私密/小金库口径**：private 非本人见灰色占位行（不进统计不分摊）；vault 非本人全程无痕（连占位都没有）；本人视角两者都计入自己的统计；公开账目双方互见（验收预期数值易算错，先手工核算）。
- **已结算月份**：confirm 后该月账目禁增/改/删，void 作废解锁。

## 4. 单测（node，无框架）

- 文件 `test/<模块>.test.js`，顶部建 localStorage stub（getItem/setItem/removeItem/key/length）+ `global.window = global`，再 `require('../js/xxx.js')`。
- 用极简 `assert(cond, name)` 计数，末尾 `process.exit(failed?1:0)`。
- **测试数据隔离**：每个用例用不同月份（如 2026-01/02/03…），避免规则改动、结算锁定跨用例污染。
- 逐条覆盖 PRD 验收用例表；跑全部：`node test/privacy.test.js; node test/split.test.js; node test/dashboard.test.js`。

## 5. 浏览器验收

- browser_use 不支持 file://：先 `python -m http.server 8642`（后台运行，跨会话可能已停，用 python urllib 探活，拒绝连接则重启；端口可能变化，用 `Get-CimInstance Win32_Process -Filter "Name like 'python%'"` 查）。
- 给 browser agent 的任务：多用 browser_evaluate 一次执行多步并 return JSON（省预算）；阶段0 先 localStorage.clear()+重建向导（成员A"阿晨"m1、成员B"小棠"m2）；最后截图 1-2 张。
- agent 报告的"数值偏差"先核对：往往是验收提示里的预期算错（公开互见/固化比例），应用逻辑才是准绳；单测通过 + 口径断言一致即可信。

## 6. 提交与合并

- 小步 commit（Conventional Commits 中文描述）：`feat(db): …` / `feat(xxx): …` / `test(xxx): …` / `fix(…): …` / `docs: …`，策略/文档与功能分离。
- 更新 `docs/00` §5.2 批次状态（含单测数、验收结论、特殊决策注记）后单独 docs commit。
- 合并：`git checkout main; git merge feature/batchN-xxx --no-ff -m "merge: 批次N … 合入 main（X项单测全过，浏览器验收通过）"`。
- 提交前 `git status --short` 确认变更集合都属本批次，不制造无关改动凑提交。
- 批次里程碑提醒用户打 tag（v1.0.0-batchN）。
- 完成后更新项目记忆（~/.trae-cn/memory 下 project_memory）的批次状态与下一步。

## 7. 用户协作约定

- 每批次完成**必须主动提醒 git 提交点**（作品集需要迭代记录）。
- 用户反馈先记入 `docs/00` §5.4 需求池（编号 R+n），不阻塞当前批次，收尾统一处理。
- 措辞规范：对外"协作/默契/边界"，对内"关系边界/财务关系"，禁止"关系修复/关系解决方案"。
