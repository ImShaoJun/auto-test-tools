---
name: ui-complex-interaction
description: 评估大模型处理复杂前端交互的能力，包括处理全局 Loading 遮挡、参数化点击和多窗口切换。
---

# Eval 场景：复杂前端交互测试

## 模拟输入 (Prompt)
请编写一个稍微复杂的 UI 操作流测试：
1. 加载 auth.json 鉴权。
2. 在租户列表表格中，点击名为“腾讯云”的租户切换按钮。
3. 此时页面会弹出一个全局的加载蒙层（GlobalLoadingMask），需要等待它消失。
4. 加载完毕后，点击“打开数据看板”按钮，该操作会弹出一个新窗口。
5. 切换到新弹出的窗口。
6. 验证新窗口出现了看板图表（CanvasChart）。

## 提供给模型的上下文 (Context)
假设存在如下 `locators.json`：
```json
{
  "TenantList": {
    "SwitchBtn": "tr:has-text('{tenantName}') >> button.switch",
    "GlobalLoadingMask": "#app-loading-overlay"
  },
  "TenantDetail": {
    "OpenDashboardBtn": "button#open-dashboard"
  },
  "Dashboard": {
    "CanvasChart": "div.echarts-instance"
  }
}
```

## 评估标准 (Scoring Rubric)
- `[ ]` **参数化点击**：步骤必须使用 `When I click "TenantList.SwitchBtn" with parameter "腾讯云"`。
- `[ ]` **蒙层隐退等待**：必须包含 `And I wait for "TenantList.GlobalLoadingMask" to be hidden`。
- `[ ]` **多窗口触发**：必须附带修饰语 `And I click "TenantDetail.OpenDashboardBtn" which opens a new window`。
- `[ ]` **多窗口切换**：必须显式调用 `Then I switch to the newly opened window`。
- `[ ]` **元素断言**：最后使用 `Then I should see "Dashboard.CanvasChart"` 断言。
