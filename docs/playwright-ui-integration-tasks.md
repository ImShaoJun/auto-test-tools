# UI 自动化测试 (Playwright) 扩展任务列表

- [x] 1. 依赖管理
  - [x] 安装 `playwright` 依赖
- [x] 2. ExecutionContext 扩展 (`src/engine/context.ts`)
  - [x] 引入 `playwright` 类型
  - [x] 实现 `initDriver` 和 `closeDriver` 方法
- [x] 3. Step Executor 扩展 (`src/engine/stepExecutor.ts`)
  - [x] 实现 `driver <url>` 关键字
  - [x] 实现 `click <selector>` 关键字
  - [x] 实现 `input <selector>, <text>` 关键字
  - [x] 实现 `waitFor <selector>` 关键字
  - [x] 实现 `screenshot <path>` 关键字
  - [x] 支持通过 `def` 提取 UI 数据 (如 `text(...)` 和 `attribute(...)`)
- [x] 4. 资源清理 (`src/engine/runner.ts`)
  - [x] 在 Scenario 执行结束时自动清理浏览器进程
- [x] 5. 客户端提示与文档更新
  - [x] 更新 `src/index.ts` 中的 `generate_feature` 工具提示
  - [x] 更新 `README.md`
