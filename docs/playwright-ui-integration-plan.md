# UI 测试能力扩展计划 (Playwright 集成)

## 目标
响应用户需求，在当前的 BDD `.feature` 文件中原生支持 UI 自动化测试。这意味着测试不仅可以发 HTTP 请求，还能操控真实的浏览器，甚至在同一个 Scenario 中混合使用 API 和 UI 步骤（例如：通过 API 造数据，在 UI 上验证显示）。

## 技术选型
使用 **Playwright** 作为底层的浏览器驱动引擎。相比 Puppeteer 和 Selenium，Playwright 在 Node.js 生态中速度最快，对现代前端框架的支持最好，并且自带强大的重试机制和元素等待机制。

## 新增 DSL 语法设计 (Karate 风格)

我们将扩展当前的引擎，使其支持以下 UI 操作关键词：

| 动作 | Gherkin 语法示例 | 对应底层实现 |
| --- | --- | --- |
| **打开浏览器** | `Given driver 'https://example.com'` | 启动无头浏览器并调用 `page.goto()` |
| **点击元素** | `When click '#login-btn'` | `page.click(selector)` |
| **输入文本** | `When input '#username', 'admin'` | `page.fill(selector, text)` |
| **等待元素** | `And waitFor '.welcome-msg'` | `page.waitForSelector(selector)` |
| **提取文本** | `And def msg = text('.welcome-msg')` | `page.textContent(selector)` (支持存入变量供后续断言) |
| **提取属性** | `And def href = attribute('#link', 'href')` | `page.getAttribute(selector, attr)` |
| **截图** | `And screenshot 'error.png'` | `page.screenshot()` |

**混合测试场景示例：**
```gherkin
Scenario: 混合测试
  # 1. API 准备数据
  Given path '/api/user/create'
  And request { "username": "test" }
  When method POST
  Then status 200

  # 2. UI 验证数据
  Given driver 'http://localhost:3000/users'
  And waitFor '.user-list'
  # 提取页面上的文本并用 BDD 引擎的 match 进行断言
  And def firstUser = text('.user-list .name')
  Then match firstUser == 'test'
```

## 核心重构与改造点

### 1. 依赖变更
- 在 `package.json` 中引入 `playwright` 依赖。

### 2. ExecutionContext 扩展 (`src/engine/context.ts`)
- 新增 `browser` 和 `page` 实例的引用。
- 增加异步的 `initDriver(url)` 方法，懒加载启动浏览器。
- 增加 `closeDriver()` 方法清理资源。
- 改造变量求值引擎，支持执行如 `text('#id')` 这种依赖异步浏览器调用的表达式。

### 3. Step Executor 扩展 (`src/engine/stepExecutor.ts`)
- 在巨型路由中增加对 `driver`, `click`, `input`, `waitFor`, `screenshot` 等关键词的解析与分发。
- 使 `def` 支持处理异步的 UI 抽取函数（如 `text()`）。

### 4. 资源生命周期管理 (`src/engine/runner.ts`)
- 修改场景执行流程，在每个 Scenario 执行结束时（使用 `finally` 块），检查上下文中是否开启了浏览器，如果有则自动调用 `closeDriver()` 销毁，确保测试相互隔离且不泄露内存。

### 5. 工具层更新 (`src/tools/generator.ts`)
- 更新传给大模型（Claude Code）的 System Prompt，将全新的 UI 语法规则加入教学文档，让大模型知道不仅可以写 API，还可以写 UI 测试。

## 需要确认的问题 (User Review Required)

> [!IMPORTANT]
> **1. 浏览器环境安装**：引入 Playwright 后，首次使用需要在本地执行一次 `npx playwright install` 下载 Chromium/Webkit 等浏览器内核。这在你的环境里是否可以接受？
> **2. 语法偏好**：目前的 DSL 设计（如 `click '#id'` 和 `def a = text('#id')`）偏向极简。你觉得这套语法符合你写 feature 的直觉吗？
