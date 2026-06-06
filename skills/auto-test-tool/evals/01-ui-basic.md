---
name: ui-basic-navigation
description: 评估大模型是否能正确遵循 DSL 规范，利用 locators.json 生成基础的 UI 导航和断言脚本，且不直接硬编码 CSS。
---

# Eval 场景：基础 UI 导航测试

## 模拟输入 (Prompt)
请为一个简单的后台系统编写 UI 测试。步骤如下：
1. 使用系统缓存的鉴权信息加载浏览器。
2. 点击顶部导航栏的“报表分析”链接。
3. 验证页面上出现了“数据大盘”标题。

## 提供给模型的上下文 (Context)
假设当前目录下存在如下 `locators.json`：
```json
{
  "Header": {
    "ReportLink": "div.top-nav > a[data-id='report']"
  },
  "ReportPage": {
    "DashboardTitle": "h1.dashboard-title"
  }
}
```

## 评估标准 (Scoring Rubric)
- `[ ]` **正确启动浏览器**：必须使用 `Given loaded state from "auth.json"`。
- `[ ]` **正确引用字典**：点击步骤应为 `When I click "Header.ReportLink"`。
- `[ ]` **正确断言**：断言步骤应为 `Then I should see "ReportPage.DashboardTitle"`。
- `[ ]` **零硬编码**：生成的 `.feature` 文件中绝对不能出现 `div.top-nav` 或 `h1` 等字样。
