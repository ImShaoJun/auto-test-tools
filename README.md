# BDD API Testing MCP Server (v2.0)

这是一个专为大模型（特别是 **Claude Code**）设计的轻量级、纯 TypeScript 的 BDD 自动化接口测试 MCP Server。

## 🌟 核心特性

- **纯 Node.js 实现**：彻底摆脱了传统测试框架对 Java 等环境的依赖。
- **专为大模型定制**：在工具的元数据中内置了自定义的 Gherkin DSL 语法规范，大模型（如 Claude）调用时能零基础学会如何编写测试脚本。
- **开箱即用的测试引擎**：内置 HTTP 执行器和结构化匹配器（支持类似 `#number`, `#[_ > 0]` 断言），进程内极速运行。
- **智能 Cookie 管理**：支持无感知的自动化登录认证、Cookie 缓存（30 分钟）以及运行时动态传入认证参数。
- **接口串联编排**：支持在单个 Scenario 中提取变量，并向下游请求传递，实现复杂的业务流测试。

---

## 🚀 安装指南

由于是 Node.js 项目，使用前需确保本地已安装 Node.js (v18 或更高版本)。

```bash
# 1. 进入项目目录
cd auto-test-tools

# 2. 安装依赖
npm install

# 3. 安装浏览器内核 (用于 UI 测试，必执行)
npx playwright install

# 4. 编译 TypeScript 源码
npm run build
```

---

## ⚙️ 配置说明

在项目根目录下创建一个 `bdd-mcp.config.json` 文件（可以复制 `bdd-mcp.config.example.json`），配置格式如下：

```json
{
  "workspaceDir": "./features", 
  "env": {
    "baseUrl": "http://localhost:8080",
    "auth": {
      "loginUrl": "/api/auth/login",
      "loginPayload": {
        "username": "test_user",
        "password": "test_pass"
      },
      "cookieFieldPath": "data.cookie"
    }
  }
}
```

| 配置项 | 说明 |
| --- | --- |
| `workspaceDir` | `.feature` 测试脚本保存的工作目录，支持相对路径。 |
| `env.baseUrl` | 被测服务的基础 URL。 |
| `env.auth` | (可选) 自动登录配置。如果配置了，引擎执行测试前会自动调用登录接口提取 Cookie 并发往后续所有请求。 |
| `cookieFieldPath` | 指定登录接口响应 JSON 中存放 Cookie 值的精确路径。 |

---

## 🔌 如何挂载到 Claude Code

在你要测试的实际业务项目根目录下，新建或编辑 `.mcp.json` 文件，将我们编译好的产物作为 MCP Server 挂载进去：

```json
{
  "mcpServers": {
    "bdd-mcp": {
      "command": "node",
      "args": [
        "C:/Users/13777/Documents/projects/auto-test-tools/dist/index.js",
        "--config",
        "C:/Users/13777/Documents/projects/auto-test-tools/bdd-mcp.config.json"
      ]
    }
  }
}
```

保存后，重启 Claude Code 即可生效。

---

## 💬 在 Claude Code 中如何使用

挂载成功后，你可以在对话框中直接用自然语言指派测试任务。

**常见对话示例：**

1. **单接口验证**：
   > “帮我测试一下 `POST /api/user/create`，参数传 `username` 为 test，验证返回的 `code` 是 0 并且生成了 `id`（数字类型）”

2. **业务流编排**：
   > “帮我写个脚本：先调用 `/api/category` 创建分类拿到 ID，再用这个 ID 调用 `/api/product` 创建商品。最后执行它。”

3. **指定测试用户**：
   > “用账号 `admin/123456` 去测一下获取用户列表接口，验证列表不为空。账号信息请传给 execute_feature 工具的 auth 参数获取 token。”

---

## 📝 支持的自定义 Gherkin 语法大全

本引擎实现了一个精简且强大的 BDD 语法子集：

### 1. 基础请求构造
```gherkin
Given url 'http://example.com'      # 覆盖全局 baseUrl (通常写在 Background)
Given path '/api/user/list'         # 请求路径 (支持拼接，如 '/api/user/' + userId)
Given header Authorization = '...'  # 设置请求头
Given cookie 'SESSION=abc'          # 设置 Cookie (开启自动登录则无需手动设)
Given param page = 1                # URL Query 参数
```

### 2. 设置请求体
支持单行 JSON 或者 DocString 跨行文本格式：
```gherkin
Given request { "name": "foo", "age": 18 }

# 或者
Given request
"""
{
  "name": "foo",
  "age": 18
}
"""
```

### 3. 发送请求
```gherkin
When method GET   # 支持 GET / POST / PUT / DELETE / PATCH
```

### 4. 强大的断言系统 (Then match)
使用 `response.xxx` 路径直接读取 API 返回 JSON。

```gherkin
Then status 200                         # 断言 HTTP 状态码
Then match response.code == 0           # 严格相等
Then match response.msg != 'error'      # 不等于
Then match response.data contains { name: 'foo' }   # 包含指定的键值对
Then match each response.data.list contains { status: 1 } # 数组全量匹配
```

**模糊类型标记 (Type Markers)**
你可以使用类型标记来代替写死的测试数据：
*   `'#number'` (数字)
*   `'#string'` (字符串)
*   `'#boolean'` (布尔值)
*   `'#array'` (数组)
*   `'#object'` (对象)
*   `'#notnull'` (非空) / `'#null'` (为空)
*   `'#uuid'` (标准的 UUID 格式)
*   `'#[_ > 0]'` (长度大于 0 的数组)

### 5. UI 浏览器操控 (Playwright)
使用原生 Playwright 指令操控浏览器，可以和 API 无缝混合：
```gherkin
Given driver 'https://example.com'        # 启动无头浏览器并导航
When click '#login-btn'                   # 点击元素
And input '#username', 'admin'            # 填入表单
And waitFor '.welcome-msg'                # 等待元素出现
And screenshot 'error.png'                # 截图排错
```

### 6. 变量提取与编排 (def)
利用 `def` 可提取上一步的数据，供后续请求的参数或断言使用：

**从 API 提取：**
```gherkin
Given def userId = response.data.userId
```

**从 UI 提取 (支持异步计算)：**
```gherkin
Given def welcomeText = text('.welcome-msg')
Given def linkUrl = attribute('#link', 'href')
Then match welcomeText == 'Hello, test!'
```
