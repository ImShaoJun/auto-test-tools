# Karate MCP Server 使用文档

**版本**：v1.0  
**更新日期**：2025-05-25

---

## 目录

- [一、项目简介](#一项目简介)
- [二、整体架构](#二整体架构)
- [三、前置条件](#三前置条件)
- [四、安装与构建](#四安装与构建)
- [五、配置说明](#五配置说明)
- [六、执行流程详解](#六执行流程详解)
- [七、MCP 工具详解](#七mcp-工具详解)
- [八、与 Claude Code 集成使用](#八与-claude-code-集成使用)
- [九、端到端使用示例](#九端到端使用示例)
- [十、常见问题排查](#十常见问题排查)
- [十一、项目工程结构](#十一项目工程结构)

---

## 一、项目简介

**Karate MCP Server** 是一个基于 [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) 协议的自动化测试工具。它作为 Claude Code 的插件运行，为 AI 编程助手提供两个核心能力：

1. **生成 Karate BDD 测试脚本**：根据接口定义和业务规则，调用 Claude API 自动生成 `.feature` 文件
2. **执行 Karate 测试并解析结果**：自动获取认证、触发 Maven 执行、过滤清洗日志，返回精简的测试结果

核心设计理念为"**大脑与肌肉解耦**"——Claude Code（主 Agent）负责理解需求和决策，MCP Server 提供底层操作能力（生成脚本、执行测试）。

---

## 二、整体架构

```
┌──────────────────────────────────┐
│     Claude Code (主 Agent)        │
│     理解需求 → 调用工具 → 分析结果  │
└───────────────┬──────────────────┘
                │  stdio 协议通信
                ▼
┌──────────────────────────────────┐
│     MCP Server (Node.js/TS)       │
│     启动时加载 karate-mcp.config  │
│                                   │
│  ┌─────────────────────────────┐  │
│  │ Tool 1: generate_karate_    │  │
│  │         script              │  │
│  │  调用 Claude API → 生成     │  │
│  │  .feature 文件 → 写入磁盘   │  │
│  └─────────────────────────────┘  │
│                                   │
│  ┌─────────────────────────────┐  │
│  │ Tool 2: execute_karate_     │  │
│  │         and_parse           │  │
│  │  获取 Cookie → Maven 执行   │  │
│  │  → 日志清洗 → 返回结果      │  │
│  └─────────────────────────────┘  │
└───────────────┬──────────────────┘
                │  child_process
                ▼
┌──────────────────────────────────┐
│     Java 项目 (Maven + Karate)    │
│     执行 .feature 测试文件        │
└──────────────────────────────────┘
```

---

## 三、前置条件

在使用本工具之前，请确保以下环境已就绪：

| 依赖项 | 版本要求 | 用途 |
|--------|---------|------|
| **Node.js** | >= 18.0.0 | 运行 MCP Server |
| **npm** | 随 Node.js 安装 | 依赖管理 |
| **Java JDK** | 8+ | Karate 测试运行环境 |
| **Maven** | 3.x | 构建和执行 Karate 测试 |
| **Claude Code** | 最新版 | AI 编程助手（MCP 客户端） |
| **Anthropic API Key** | — | 用于 `generate_karate_script` 工具调用 Claude API |

> **注意**：你需要一个已配置好 Karate 依赖的 Java Maven 项目。Karate 框架的 `pom.xml` 依赖配置不在本工具范围内。

---

## 四、安装与构建

### 4.1 克隆项目

```bash
git clone https://github.com/ImShaoJun/auto-test-tools.git
cd auto-test-tools
```

### 4.2 安装依赖

```bash
npm install
```

### 4.3 编译 TypeScript

```bash
npm run build
```

编译产物输出到 `dist/` 目录。

### 4.4 设置环境变量

复制示例环境变量文件并填入你的 Anthropic API Key：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
ANTHROPIC_API_KEY=sk-ant-api03-你的真实Key
```

> **安全提醒**：`.env` 文件已在 `.gitignore` 中排除，不会被提交到 Git 仓库。

---

## 五、配置说明

### 5.1 配置文件位置

MCP Server 启动时按以下优先级查找配置文件（找到第一个即停止）：

| 优先级 | 路径 | 说明 |
|--------|------|------|
| 1（最高） | `--config` 命令行参数指定的路径 | 显式指定 |
| 2 | `./karate-mcp.config.json` | 当前工作目录 |
| 3（最低） | `~/.karate-mcp/config.json` | 用户 Home 目录 |

### 5.2 配置文件格式

参考 `karate-mcp.config.example.json`：

```json
{
  "project": {
    "root": "/path/to/your/java-project",
    "featureBaseDir": "src/test/java/features",
    "karateReportsDir": "target/karate-reports",
    "karateRunnerClass": "KarateRunner"
  },
  "env": {
    "baseUrl": "http://localhost:8080",
    "authLoginUrl": "/api/auth/login",
    "authLoginPayload": {
      "username": "test_user",
      "password": "test_pass"
    },
    "cookieFieldPath": "data.cookie"
  },
  "llm": {
    "model": "claude-sonnet-4-20250514",
    "maxTokens": 4096
  },
  "executor": {
    "timeoutSeconds": 300,
    "mvnCommand": "mvn"
  }
}
```

### 5.3 配置字段详解

#### `project` — 项目相关配置

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `root` | string | ✅ | — | Java 项目的根路径（绝对路径） |
| `featureBaseDir` | string | ❌ | `src/test/java/features` | `.feature` 文件的基础目录（相对于 `root`） |
| `karateReportsDir` | string | ❌ | `target/karate-reports` | Karate 报告输出路径（相对于 `root`） |
| `karateRunnerClass` | string | ❌ | `KarateRunner` | Karate Runner 类名 |

#### `env` — 环境相关配置

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `baseUrl` | string | ✅ | — | API 基础 URL（必须是合法的 URL） |
| `authLoginUrl` | string | ✅ | — | 登录接口路径（如 `/api/auth/login`） |
| `authLoginPayload` | object | ✅ | — | 登录请求体（JSON 格式） |
| `cookieFieldPath` | string | ❌ | `data.cookie` | 登录接口 JSON 响应中 cookie 值的路径 |

> **关于 `cookieFieldPath`**：登录接口返回 JSON，如 `{ "code": 0, "data": { "cookie": "SESSION=xxx" } }`，则路径为 `data.cookie`。支持任意层级的点分路径。

#### `llm` — LLM 模型配置

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `model` | string | ❌ | `claude-sonnet-4-20250514` | 调用的 Claude 模型名称 |
| `maxTokens` | number | ❌ | `4096` | LLM 单次响应的最大 token 数 |

#### `executor` — 执行器配置

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `timeoutSeconds` | number | ❌ | `300` | Maven 执行超时时间（秒） |
| `mvnCommand` | string | ❌ | `mvn` | Maven 命令（如使用 wrapper 可改为 `./mvnw`） |

---

## 六、执行流程详解

### 6.1 MCP Server 启动流程

```
                   启动
                    │
       ┌────────────▼────────────┐
       │ 1. 解析命令行参数         │
       │    (--config 路径)        │
       └────────────┬────────────┘
                    │
       ┌────────────▼────────────┐
       │ 2. 加载配置文件           │
       │    按优先级搜索并读取     │
       │    使用 Zod 校验格式      │
       └────────────┬────────────┘
                    │
       ┌────────────▼────────────┐
       │ 3. 初始化 Anthropic      │
       │    Client (读取 API Key) │
       └────────────┬────────────┘
                    │
       ┌────────────▼────────────┐
       │ 4. 创建 MCP Server       │
       │    注册两个 Tool         │
       └────────────┬────────────┘
                    │
       ┌────────────▼────────────┐
       │ 5. 启动 stdio 传输       │
       │    等待 Claude Code 连接 │
       └─────────────────────────┘
```

### 6.2 `generate_karate_script` 执行流程

```
     Claude Code 调用 Tool
            │
            ▼
  ┌──────────────────────┐
  │ 1. 接收参数            │
  │    targetPath          │
  │    apiContext           │
  │    businessRules       │
  └─────────┬────────────┘
            │
  ┌─────────▼────────────┐
  │ 2. 构建 System Prompt  │
  │    注入 baseUrl 等配置 │
  │    包含 Karate DSL 规则│
  └─────────┬────────────┘
            │
  ┌─────────▼────────────┐
  │ 3. 构建 User Prompt    │
  │    接口定义 + 业务规则  │
  └─────────┬────────────┘
            │
  ┌─────────▼────────────┐
  │ 4. 调用 Anthropic API  │
  │    发送 Prompt 到 LLM  │
  └─────────┬────────────┘
            │
  ┌─────────▼────────────┐
  │ 5. 提取 feature 内容   │
  │    从 ```feature``` 中 │
  │    提取代码块           │
  └─────────┬────────────┘
            │
  ┌─────────▼────────────┐
  │ 6. 写入文件            │
  │    自动创建目录         │
  │    写入 .feature 文件  │
  └─────────┬────────────┘
            │
            ▼
  返回: ✅ 文件路径 + Scenario 数量
```

### 6.3 `execute_karate_and_parse` 执行流程

```
     Claude Code 调用 Tool
            │
            ▼
  ┌──────────────────────┐
  │ Step 0: 检查 Runner    │
  │  KarateRunner.java    │
  │  不存在则自动生成      │
  └─────────┬────────────┘
            │
  ┌─────────▼────────────┐
  │ Step 1: 获取 Cookie    │
  │  检查内存缓存(30min)   │
  │  ├─ 有效 → 直接使用    │
  │  └─ 过期 → 调用登录API │
  │     POST authLoginUrl  │
  │     从 JSON 提取 cookie│
  └─────────┬────────────┘
            │
  ┌─────────▼────────────┐
  │ Step 2: 执行 Maven     │
  │  mvn clean test        │
  │  -Dtest=KarateRunner   │
  │  -Dkarate.options=...  │
  │  -Dkarate.env.cookie=..│
  │  超时: 300s             │
  └─────────┬────────────┘
            │
  ┌─────────▼────────────┐
  │ Step 3: 解析结果       │
  │  ├─ Exit 0 → ✅ 通过  │
  │  └─ Exit ≠0 → 清洗日志│
  │     剔除 Java 堆栈     │
  │     保留 Karate 断言   │
  │     截断至 1000 字符    │
  └─────────┬────────────┘
            │
            ▼
  返回: 测试结果（通过/失败详情）
```

---

## 七、MCP 工具详解

### 7.1 `generate_karate_script`

**功能**：根据接口定义和业务规则，调用 LLM 生成 Karate BDD 测试脚本（`.feature` 文件）并写入磁盘。

**输入参数**：

```json
{
  "targetPath": "user/user_list.feature",
  "apiContext": {
    "method": "GET",
    "url": "/api/user/list",
    "queryParams": {
      "pageNum": 1,
      "pageSize": 10
    }
  },
  "businessRules": "code 必须为 0，data.list 不为空，data.list[0].userId 必须是 number 类型"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `targetPath` | string | ✅ | 生成的 `.feature` 文件保存的相对路径（相对于 `featureBaseDir`） |
| `apiContext.method` | string | ✅ | HTTP 方法：`GET`/`POST`/`PUT`/`DELETE`/`PATCH` |
| `apiContext.url` | string | ✅ | 接口路径 |
| `apiContext.headers` | object | ❌ | 额外请求头（认证头由系统自动注入） |
| `apiContext.requestBody` | object | ❌ | 请求体（`POST`/`PUT` 时填写） |
| `apiContext.queryParams` | object | ❌ | Query 参数（`GET` 时填写） |
| `businessRules` | string | ✅ | 自然语言描述的断言规则 |

**成功输出示例**：

```
✅ 文件已成功写入: src/test/java/features/user/user_list.feature
   完整路径: /path/to/project/src/test/java/features/user/user_list.feature
   Scenario 数量: 3
```

**前提条件**：需要设置 `ANTHROPIC_API_KEY` 环境变量，否则该工具不可用。

---

### 7.2 `execute_karate_and_parse`

**功能**：执行指定的 Karate `.feature` 测试脚本，自动处理认证 Cookie 获取，触发 Maven 执行，返回过滤清洗后的测试结果。

**输入参数**：

```json
{
  "featurePath": "features/user/user_list.feature"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `featurePath` | string | ✅ | `.feature` 文件的 classpath 路径（相对于 `featureBaseDir`） |

**成功输出示例**：

```
✅ 所有 Scenario 通过
```

**失败输出示例**：

```
❌ 测试失败 (Exit Code: 1)

match failed: $.data.list[0].userId
  实际值: "12345" (string)
  期望值: '#number'
Scenario: 查询用户列表接口 (user_list.feature:15)
```

**自动行为**：
- 自动检查并生成 `KarateRunner.java`（若不存在）
- 自动调用登录接口获取 Cookie（带 30 分钟 TTL 缓存）
- 自动清洗 Maven 输出日志，剔除无关 Java 堆栈

---

## 八、与 Claude Code 集成使用

### 8.1 配置 Claude Code 的 MCP Server

在 Claude Code 的 MCP 配置中添加本 Server。通常在项目的 `.claude/mcp.json` 或全局 MCP 配置中：

**开发模式**（使用 `tsx` 直接运行 TypeScript）：

```json
{
  "mcpServers": {
    "karate-mcp": {
      "command": "npx",
      "args": ["tsx", "/path/to/auto-test-tools/src/index.ts", "--config", "/path/to/karate-mcp.config.json"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-api03-你的Key"
      }
    }
  }
}
```

**生产模式**（使用编译后的 JS）：

```json
{
  "mcpServers": {
    "karate-mcp": {
      "command": "node",
      "args": ["/path/to/auto-test-tools/dist/index.js", "--config", "/path/to/karate-mcp.config.json"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-api03-你的Key"
      }
    }
  }
}
```

> **提示**：如果配置文件 `karate-mcp.config.json` 放在 Claude Code 的工作目录下，可以省略 `--config` 参数。

### 8.2 Claude Code 中的使用方式

MCP Server 启动后，Claude Code 可以自动发现并调用以下两个工具：

1. **让 Claude Code 生成测试脚本**：告诉 CC 你的接口信息和断言规则，CC 会调用 `generate_karate_script`
2. **让 Claude Code 执行测试**：告诉 CC 要执行哪个 feature 文件，CC 会调用 `execute_karate_and_parse`
3. **让 Claude Code 自动修复**：如果测试失败，CC 可以分析错误日志，决定是修复 feature 文件还是报告业务 Bug

---

## 九、端到端使用示例

### 场景：为用户列表接口编写并执行测试

#### 第一步：准备配置文件

创建 `karate-mcp.config.json`：

```json
{
  "project": {
    "root": "D:/projects/my-java-backend",
    "featureBaseDir": "src/test/java/features"
  },
  "env": {
    "baseUrl": "http://localhost:8080",
    "authLoginUrl": "/api/auth/login",
    "authLoginPayload": {
      "username": "admin",
      "password": "admin123"
    },
    "cookieFieldPath": "data.cookie"
  }
}
```

#### 第二步：在 Claude Code 中对话

```
你: 请为 GET /api/user/list 接口生成 Karate 测试脚本。
    接口接受 pageNum 和 pageSize 两个 query 参数。
    断言要求：code 为 0，data.list 不为空，每个元素的 userId 是 number 类型。
```

Claude Code 会自动调用 `generate_karate_script` 工具，参数如下：

```json
{
  "targetPath": "user/user_list.feature",
  "apiContext": {
    "method": "GET",
    "url": "/api/user/list",
    "queryParams": { "pageNum": 1, "pageSize": 10 }
  },
  "businessRules": "code 必须为 0，data.list 不为空，data.list 中每个元素的 userId 必须是 number 类型"
}
```

生成的 `.feature` 文件将写入：
```
D:/projects/my-java-backend/src/test/java/features/user/user_list.feature
```

#### 第三步：执行测试

```
你: 请执行刚才生成的测试脚本
```

Claude Code 会调用 `execute_karate_and_parse`：

```json
{
  "featurePath": "features/user/user_list.feature"
}
```

#### 第四步：分析结果

- **如果通过**：CC 报告 `✅ 所有 Scenario 通过`
- **如果失败**：CC 分析清洗后的错误日志，判断是断言写错还是业务 Bug：
  - 断言写错 → CC 自动调用 `generate_karate_script` 重新生成修复版本
  - 业务 Bug → CC 向你报告问题，建议修改 Java 代码

---

## 十、常见问题排查

### Q1: 启动时报 "找不到配置文件"

```
Error: 找不到配置文件。已搜索以下路径：
  - /path/to/karate-mcp.config.json
  - ~/.karate-mcp/config.json
```

**原因**：MCP Server 在所有候选路径中都没有找到配置文件。

**解决**：
- 在项目根目录创建 `karate-mcp.config.json`
- 或通过 `--config` 参数指定配置文件路径

---

### Q2: 提示 "ANTHROPIC_API_KEY 环境变量未设置"

**原因**：`generate_karate_script` 工具需要 Anthropic API Key 来调用 Claude API。

**解决**：
- 在 `.env` 文件中设置 `ANTHROPIC_API_KEY`
- 或在 MCP 配置的 `env` 字段中设置
- 注意：`execute_karate_and_parse` 工具不需要 API Key，可以独立使用

---

### Q3: Maven 执行超时

**原因**：默认超时时间为 300 秒（5 分钟）。

**解决**：
- 在配置文件中增大 `executor.timeoutSeconds`
- 确认 Java 项目依赖已缓存（首次 `mvn test` 会下载大量依赖）

---

### Q4: 登录接口认证失败

```
❌ 认证失败: 登录接口返回错误 HTTP 401: ...
```

**解决**：
- 检查 `env.baseUrl` 和 `env.authLoginUrl` 是否正确
- 检查 `env.authLoginPayload` 中的账号密码是否有效
- 确认后端服务已启动

---

### Q5: Cookie 提取失败

```
❌ 认证失败: 登录接口响应中无法通过路径 "data.cookie" 提取到有效的 cookie 值
```

**解决**：
- 手动调用登录接口，查看实际响应格式
- 根据实际 JSON 结构调整 `env.cookieFieldPath`

---

### Q6: Maven 命令找不到

```
❌ Maven 执行异常: Maven 进程启动失败: ...
```

**解决**：
- 确认 `mvn` 命令在 PATH 中可用
- 如果使用 Maven Wrapper，将 `executor.mvnCommand` 改为 `./mvnw`（Linux/Mac）或 `mvnw.cmd`（Windows）

---

### Q7: 生成的 feature 文件内容异常

**可能原因**：LLM 输出未按预期格式返回。

**解决**：
- 检查 `llm.maxTokens` 是否足够（复杂接口可能需要更大的 token 限制）
- 尝试使用更强的模型（如 `claude-sonnet-4-20250514` → `claude-opus-4-5`）

---

## 十一、项目工程结构

```
auto-test-tools/
├── doc/                              # 文档目录
│   ├── design.md                     # 设计文档
│   ├── implementation_plan.md        # 实现计划
│   ├── discussion-e2e-rd-efficiency.md # 讨论记录
│   └── usage.md                      # 使用文档（本文件）
├── src/                              # 源代码
│   ├── index.ts                      # MCP Server 入口
│   │                                 # 注册两个 Tool，启动 stdio 通信
│   ├── config.ts                     # 配置加载模块
│   │                                 # 加载优先级、Zod 校验、CLI 解析
│   ├── tools/
│   │   ├── generator.ts              # generate_karate_script 实现
│   │   │                             # 构建 Prompt → 调用 API → 提取 feature → 写文件
│   │   └── executor.ts               # execute_karate_and_parse 实现
│   │                                 # Runner 自检 → Cookie 获取 → Maven 执行 → 日志清洗
│   ├── auth/
│   │   └── cookieManager.ts          # Cookie 管理器
│   │                                 # 登录接口调用 + 30 分钟 TTL 缓存
│   └── utils/
│       └── logFilter.ts              # 日志清洗工具
│                                     # 剔除 Java 堆栈，保留 Karate 断言，截断至 1000 字符
├── dist/                             # TypeScript 编译产物
├── karate-mcp.config.example.json    # 配置文件示例
├── .env.example                      # 环境变量示例
├── package.json                      # 项目依赖和脚本
├── tsconfig.json                     # TypeScript 编译配置
├── .gitignore
└── LICENSE                           # Apache-2.0
```

---

## 附录：运行命令速查

| 操作 | 命令 |
|------|------|
| 安装依赖 | `npm install` |
| 开发模式运行 | `npm run dev` 或 `npm run dev -- --config path/to/config.json` |
| 编译 TypeScript | `npm run build` |
| 生产模式运行 | `npm start` 或 `npm start -- --config path/to/config.json` |
