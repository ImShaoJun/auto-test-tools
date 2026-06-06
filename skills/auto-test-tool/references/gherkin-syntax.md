# BDD 规范指南 (DSL 语法与示例参考)

## 1. UI 浏览器交互 (使用 Playwright)
强制解耦业务意图与底层 DOM，所有 UI 操作必须使用 `locators.json` 中定义的 `Namespace.Key`。

- **加载状态**：`Given loaded state from "auth.json"` — 从缓存状态加载并开启浏览器
- **点击元素**：`When I click "Namespace.Key"`
- **带参数点击**：`When I click "Namespace.Key" with parameter "Value"`
- **强制点击**（解决元素遮挡）：`When I force click "Namespace.Key"`
- **显式网络等待**：`And I wait for the network response from "/api/path"`
- **显式隐退等待**：`And I wait for "Namespace.Mask" to be hidden`
- **触发多窗口**：`And I click "Namespace.Link" which opens a new window`
- **切换新窗口**：`Then I switch to the newly opened window`
- **可见性断言**：`Then I should see "Namespace.Target"`

## 2. API 请求构建 (原有 DSL 兼容)
- **基础 URL**：`Given url '<URL>'`
- **请求路径**：`Given path '<路径>'`
- **发送请求**：`When method GET|POST`
- **状态码断言**：`Then status <code>`
- **数据断言**：`Then match <expr> == <expected>`

## 注意事项
- 严禁在 `.feature` 中写死 CSS 或 XPath，一律通过 `Namespace.Key` 引用。
- 确保存储了 `locators.json` 且键值对准确无误。
