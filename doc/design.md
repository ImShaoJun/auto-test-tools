# Claude Code + Karate 自动化测试 MCP 插件设计文档

**文档版本**：v1.1  
**制定日期**：2026-05-23  
**业务背景**：Java后端 + TS前端 + 大数据(MySQL/ES) 的接口集成测试编排  

---

## 一、 架构概述

本系统旨在通过 MCP (Model Context Protocol) 协议，将 Karate 自动化测试框架深度集成到 Claude Code (CC) 的终端开发工作流中。

核心设计理念为"**大脑与肌肉解耦**"，即彻底废弃黑盒化的闭环 Subagent，将"用例生成"与"脚本执行"拆分为两个绝对独立的无状态工具 (Stateless Tools)。由主控 CC 承担决策大脑，由 MCP Server 提供底层操作能力。

---

## 二、 已确认技术决策

| 决策项 | 结论 |
|-------|------|
| **MCP Server 语言** | Node.js + TypeScript |
| **Karate 脚本生成方式** | 调用 Anthropic Claude Agent SDK，通过 LLM + Prompt 生成 |
| **认证机制** | 预留调用后端登录接口获取 Cookie，由 MCP 内部完成注入 |
| **配置管理** | 所有环境相关配置从外部配置文件读取（不 hardcode） |

---

## 三、 系统架构图

```
[ Claude Code (主Agent) ]
       | (stdio 协议通信)
       v
[ MCP Server (Node.js/TS) ]
       |-- 启动时加载 karate-mcp.config.json
       |-- 路由分发
       |
       |--> [ Tool 1: 生成器 (generate_karate_script) ]
       |       |-- 调用: Anthropic Claude Agent SDK
       |       |-- 读取: Prompt 模板 + 配置文件中的固定头/Background
       |       |-- 产出: 写入本地磁盘的 .feature 文件
       |
       |--> [ Tool 2: 执行器 (execute_karate_and_parse) ]
               |-- 内部: 先调用登录接口获取 Cookie（若 Cookie 已缓存且未过期则跳过）
               |-- 依赖: Node.js child_process 执行 Maven 命令
               |-- 操作: mvn test -Dkarate.options=...
               |-- 产出: 过滤清洗后的极简报错/成功日志
```

---

## 四、 配置文件设计

### 4.1 配置文件路径约定

MCP Server 启动时，从以下位置按优先级顺序读取配置（高优先覆盖低优先）：

```
1. 命令行参数指定路径  --config /path/to/config.json
2. 当前工作目录下     ./karate-mcp.config.json
3. 用户 Home 目录下   ~/.karate-mcp/config.json
```

### 4.2 配置文件 Schema（`karate-mcp.config.json`）

```json
{
  "project": {
    "root": "/path/to/java-project",
    "featureBaseDir": "src/test/java/features",
    "karateReportsDir": "target/karate-reports",
    "dbUtilsClass": "com.xxx.DbTestUtils"
  },
  "env": {
    "baseUrl": "http://localhost:8080",
    "authLoginUrl": "/api/auth/login",
    "authLoginPayload": {
      "username": "test_user",
      "password": "test_pass"
    },
    "cookieName": "SESSION"
  },
  "llm": {
    "model": "claude-opus-4-5",
    "maxTokens": 4096
  },
  "executor": {
    "timeoutSeconds": 300,
    "mvnCommand": "mvn",
    "karateRunnerClass": "KarateRunner"
  }
}
```

> **注意**：`ANTHROPIC_API_KEY` 不写入配置文件，通过环境变量 `ANTHROPIC_API_KEY` 注入，防止密钥泄露到 git 仓库。

---

## 五、 模块详细设计

### 5.1 核心层：Java 测试基础设施（前提依赖，需业务侧提供）

> **说明**：Karate 不直接写 SQL 操作数据库，数据构造由后端统一封装。MCP 生成的脚本仅通过 Java interop 调用这些工具类。

**① 数据造数工具类**

```java
// 包路径从 config.project.dbUtilsClass 读取
public class DbTestUtils {
    public static void resetMySqlTable(String tableName) { ... }
    public static void seedEsData(String index, String jsonList) { ... }
}
```

**② KarateRunner（❓ 见待确认问题 #1）**

```java
// 标准写法示例，实际包路径待确认
@RunWith(Karate.class)
public class KarateRunner {
    // 空 Runner，由 -Dkarate.options 动态指定 feature 路径
}
```

---

### 5.2 代理层：MCP Server

* **运行方式**：作为后台守护进程由 CC 按需唤起（`node dist/index.js`）。
* **通信协议**：Standard I/O (stdio)。
* **依赖**：
  ```json
  {
    "@anthropic-ai/sdk": "latest",
    "@modelcontextprotocol/sdk": "latest"
  }
  ```
* **启动流程**：
  1. 读取并校验配置文件，缺少必填项则报错退出。
  2. 初始化 Anthropic SDK Client（读取环境变量 `ANTHROPIC_API_KEY`）。
  3. 注册两个 Tool 并启动 stdio MCP 通信。

---

### 5.3 能力层：生成器 Tool（`generate_karate_script`）

**职责**：调用 Claude API，根据接口定义生成 Karate DSL 脚本并落盘。

**输入参数 (JSON Schema)**：
```json
{
  "targetPath": {
    "type": "string",
    "description": "生成的 .feature 文件保存的相对路径（相对于 config.project.featureBaseDir）"
  },
  "apiContext": {
    "type": "object",
    "description": "接口定义（结构化）",
    "properties": {
      "method":      { "type": "string", "enum": ["GET","POST","PUT","DELETE","PATCH"] },
      "url":         { "type": "string", "description": "接口路径，如 /api/user/list" },
      "headers":     { "type": "object", "description": "额外请求头（认证头由系统自动注入，无需填写）" },
      "requestBody": { "type": "object", "description": "请求体结构（POST/PUT 时填写）" },
      "queryParams": { "type": "object", "description": "Query 参数（GET 时填写）" }
    },
    "required": ["method", "url"]
  },
  "businessRules": {
    "type": "string",
    "description": "用自然语言描述必须校验的断言逻辑，如：code 必须为 0，data.list 不为空，data.list[0].userId 必须是 number 类型"
  },
  "needDbSetup": {
    "type": "boolean",
    "description": "是否需要在 Background 中生成数据库初始化代码（调用 DbTestUtils）",
    "default": false
  }
}
```

**内部逻辑**：

```
1. 从配置文件读取 baseUrl、dbUtilsClass、featureBaseDir 等固定参数。
2. 组装 System Prompt（含 Karate DSL 语法约束、Background 模板、不得使用 SQL 等规则）。
3. 调用 Anthropic Claude API（claude-opus-4-5），传入 System Prompt + 用户的 apiContext + businessRules。
4. 从 LLM 响应中提取 .feature 文件内容（提取 ```feature ... ``` 代码块）。
5. 将文件写入 {config.project.root}/{config.project.featureBaseDir}/{targetPath}。
6. 若目录不存在则自动创建。
```

**System Prompt 关键约束（预设）**：

```
- 生成标准的 Karate DSL feature 文件，不得包含任何 Java 代码以外的 SQL 操作。
- Background 中必须包含：
    * url baseUrl（从配置注入）
    * 认证 Cookie 通过 header Cookie: <SESSION>=<value> 注入（由系统在运行时填充占位符）
    * 若 needDbSetup=true，则通过 Java.type('{dbUtilsClass}') 调用数据初始化方法。
- Scenario 中的断言必须使用 JsonPath 风格（match response.data.id == '#number'）。
- 禁止在 feature 文件中 hardcode 任何测试数据的主键 ID（ID 需从上下文动态读取）。
```

**输出**：
```
✅ 文件已成功写入: src/test/java/features/user/user_list.feature
   Scenario 数量: 3
   包含数据库初始化: 是
```

---

### 5.4 能力层：执行器 Tool（`execute_karate_and_parse`）

**职责**：① 刷新认证 Cookie → ② 触发 Maven 执行 → ③ 过滤日志返回。

**输入参数 (JSON Schema)**：
```json
{
  "featurePath": {
    "type": "string",
    "description": "要执行的 .feature 文件路径（相对于 config.project.featureBaseDir 的 classpath 路径）"
  }
}
```

**内部逻辑**：

```
步骤一：认证 Cookie 获取（Auth Gate）
  1. 检查内存缓存中是否有未过期的 Cookie（简单 TTL，默认 30 分钟）。
  2. 若无，则向 config.env.authLoginUrl POST config.env.authLoginPayload。
  3. 从响应 Set-Cookie 头中提取 config.env.cookieName 对应的 Cookie 值。
  4. 写入 karate-config.js 的 cookie 变量（或通过 -Dkarate.cookie=<value> 注入）。
     （❓ 注入方式见待确认问题 #2）

步骤二：组装并执行 Maven 命令
  cwd: config.project.root
  cmd: {mvnCommand} clean test
       -Dtest={karateRunnerClass}
       -Dkarate.options="classpath:{featurePath}"
  timeout: config.executor.timeoutSeconds

步骤三：日志清洗
  - 如果 Exit Code = 0：直接返回 "✅ 所有 Scenario 通过"。
  - 如果 Exit Code ≠ 0：
    a. 读取 {config.project.root}/{karateReportsDir}/karate-summary-json.txt
    b. 使用正则过滤，剔除 java.lang.*、org.apache.*、com.sun.* 开头的堆栈行。
    c. 仅保留 "match failed"、"* url"、"* path" 等 Karate 层断言信息。
    d. 截断至 1000 字符以内后返回。
```

**输出示例（失败场景）**：
```
❌ 执行失败 | Scenario: 查询用户列表接口 (user_list.feature:15)
   断言失败: match failed: $.data.list[0].userId
     实际值: "12345" (string)
     期望值: '#number'
```

---

## 六、 人机协同工作流 (Workflow)

```
步骤 1: 需求开发与理解
  └─ CC 读取变更的 Controller 文件，梳理接口签名变更

步骤 2: 显式生成（明牌）
  └─ CC 调用 generate_karate_script
  └─ MCP 写入 .feature 文件到磁盘
  └─ 开发者通过 git diff 审计生成内容

步骤 3: 触发执行
  └─ CC（或开发者指令）调用 execute_karate_and_parse
  └─ MCP 自动刷新 Cookie → 执行 Maven → 过滤日志

步骤 4: 结果仲裁（防 AI 作弊）
  ├─ 测试失败 + 断言写错 → CC 调用 generate_karate_script 修复 feature 文件
  └─ 测试失败 + 业务 Bug → CC 向开发者报告，提议修改 Java 业务代码
```

---

## 七、 项目工程结构（MCP Server）

```
auto-test-tools/
├── src/
│   ├── index.ts                  # MCP Server 入口，注册 Tool，启动 stdio
│   ├── config.ts                 # 配置文件加载与校验
│   ├── tools/
│   │   ├── generator.ts          # generate_karate_script 实现
│   │   └── executor.ts           # execute_karate_and_parse 实现
│   ├── auth/
│   │   └── cookieManager.ts      # 登录接口调用 + Cookie TTL 缓存
│   └── utils/
│       └── logFilter.ts          # 日志清洗正则工具
├── karate-mcp.config.json        # 配置文件（git 追踪，不含密钥）
├── .env.example                  # 环境变量示例（ANTHROPIC_API_KEY）
├── package.json
└── tsconfig.json
```

---

## 八、 后续扩展规划

1. **CI/CD 集成**：执行器是无头纯净脚本，可直接挂载到 Jenkins 或 GitLab CI 复用。
2. **数据隔离**：在配置文件中增加多环境 profile 支持（dev/test/staging），确保并发跑测不串数据。

---

## 九、 ❓ 待确认问题清单（明日讨论）

> 以下问题不影响 MCP Server 本身的启动，但影响生成的脚本能否正确执行。

### 问题 #1：KarateRunner.java 的归属

- **问题**：`KarateRunner.java` 是放在业务侧的 Java 测试项目里，还是由 MCP 自动生成并写入？
- **影响**：如果需要 MCP 生成，则执行器需要增加一个"初始化项目"的前置动作。
- **建议选项**：
  - A. 由业务侧研发手动在测试项目中创建（一次性工作，推荐）。
  - B. MCP 在首次执行时检测，如不存在则自动写入。

### 问题 #2：Cookie 注入到 Karate 的方式

- **问题**：获取到 Cookie 后，用哪种方式注入到 Karate 执行环境？
- **影响**：直接决定 `cookieManager.ts` 和 `karate-config.js` 的实现方式。
- **建议选项**：
  - A. 通过 `-Dkarate.env.cookie=<value>` JVM 参数传入，在 `karate-config.js` 里读取 `karate.properties['cookie']`（推荐，无需写文件）。
  - B. 执行前动态覆写 `karate-config.js` 中的 cookie 变量（有并发安全隐患）。
  - C. 写入一个临时 `.env` 文件，`karate-config.js` 通过读文件获取（最重但最灵活）。

### 问题 #3：`DbTestUtils.java` 实际包路径

- **问题**：`config.project.dbUtilsClass` 的实际值是什么（即 `com.xxx.DbTestUtils` 中 `xxx` 的部分）？
- **影响**：生成器写入 feature 文件时会直接硬引用这个类路径。

### 问题 #4：登录接口的响应格式

- **问题**：后端登录接口返回 Cookie 的方式是 `Set-Cookie` 响应头，还是 JSON Body 里的 token 字段？
- **影响**：`cookieManager.ts` 的解析逻辑完全不同。
- **建议选项**：
  - A. `Set-Cookie` 响应头（标准 Session 机制）→ 提取 `config.env.cookieName` 对应的值。
  - B. JSON Body（如 `{ "data": { "token": "xxx" } }`）→ 需要在配置里增加 `authTokenPath`（JsonPath）。

### 问题 #5：`apiContext.requestBody` 的来源规范

- **问题**：CC 调用生成器时，`requestBody` 是让 CC 从 Java Controller 代码中自动提取，还是由开发者手动描述？
- **影响**：决定 CC 侧的 System Prompt 设计（CC 如何与 MCP Tool 协作的上层约定）。
- **建议选项**：
  - A. CC 自动从 `@RequestBody` 注解的 DTO 类定义中提取字段结构（推荐，减少手工）。
  - B. 开发者在对话中以自然语言描述，CC 转换后填入。
