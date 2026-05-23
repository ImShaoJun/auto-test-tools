# Karate 自动化测试 MCP Server 实现计划

## 概述

基于 [design.md](file:///c:/Users/13777/Documents/projects/auto-test-tools/doc/design.md) 构建 Node.js/TypeScript MCP Server，通过 stdio 协议为 Claude Code 提供两个核心工具：**Karate 脚本生成** 和 **Karate 脚本执行**。

## 已确认的设计决策

| # | 问题 | 结论 |
|---|------|------|
| 1 | KarateRunner.java 归属 | MCP 首次执行时自动检测，不存在则自动写入 |
| 2 | Cookie 注入方式 | 通过 `-Dkarate.env.cookie=<value>` JVM 参数传入 |
| 3 | DbTestUtils 包路径 | 暂不实现数据库初始化功能，后续再加 |
| 4 | 登录接口响应格式 | JSON Body：`{ "code": 0, "data": { "cookie": "SESSION=xxx" } }` |
| 5 | requestBody 来源 | CC 自动从 Java Controller 的 DTO 提取 |
| 6 | 测试产物组织方式 | 先放业务项目内，配置文件保持灵活 |

---

## Proposed Changes

### 1. 项目初始化与基础设施

#### [NEW] [package.json](file:///c:/Users/13777/Documents/projects/auto-test-tools/package.json)

Node.js 项目配置，包含以下核心依赖：
- `@modelcontextprotocol/sdk` — MCP 协议 SDK
- `@anthropic-ai/sdk` — Anthropic Claude API 调用
- `zod` — 运行时 Schema 校验（MCP SDK 依赖）
- `typescript`, `tsx` — TypeScript 开发与运行

Scripts:
- `dev`: `tsx src/index.ts` — 开发模式直接运行
- `build`: `tsc` — 编译为 JS
- `start`: `node dist/index.ts` — 生产运行

#### [NEW] [tsconfig.json](file:///c:/Users/13777/Documents/projects/auto-test-tools/tsconfig.json)

TypeScript 编译配置，target ES2022，module NodeNext，输出到 `dist/`。

#### [NEW] [.env.example](file:///c:/Users/13777/Documents/projects/auto-test-tools/.env.example)

环境变量示例文件，记录 `ANTHROPIC_API_KEY` 占位。

---

### 2. 配置模块

#### [NEW] [src/config.ts](file:///c:/Users/13777/Documents/projects/auto-test-tools/src/config.ts)

**职责**：加载、校验、导出全局配置对象。

**配置加载优先级**（高覆盖低）：
1. 命令行参数 `--config /path/to/config.json`
2. 当前工作目录 `./karate-mcp.config.json`
3. 用户 Home 目录 `~/.karate-mcp/config.json`

**配置 Schema**（使用 Zod 校验）：
```typescript
{
  project: {
    root: string,           // Java 项目根路径
    featureBaseDir: string,  // feature 文件相对路径 (默认 "src/test/java/features")
    karateReportsDir: string,// 报告输出路径 (默认 "target/karate-reports")
    karateRunnerClass: string // Runner 类名 (默认 "KarateRunner")
  },
  env: {
    baseUrl: string,          // API 基础 URL
    authLoginUrl: string,     // 登录接口路径
    authLoginPayload: object, // 登录请求体
    cookieFieldPath: string   // JSON 响应中 cookie 字段路径 (默认 "data.cookie")
  },
  llm: {
    model: string,     // 模型名 (默认 "claude-sonnet-4-20250514")
    maxTokens: number  // 最大 token 数 (默认 4096)
  },
  executor: {
    timeoutSeconds: number, // 执行超时 (默认 300)
    mvnCommand: string      // Maven 命令 (默认 "mvn")
  }
}
```

> [!IMPORTANT]
> 原设计中 `cookieName` 字段改为 `cookieFieldPath`，因为登录响应格式已确认为 JSON Body，需要用路径提取（如 `data.cookie`）。

---

### 3. 认证模块

#### [NEW] [src/auth/cookieManager.ts](file:///c:/Users/13777/Documents/projects/auto-test-tools/src/auth/cookieManager.ts)

**职责**：管理认证 Cookie 的获取与缓存。

**核心逻辑**：
1. 内存维护 `{ value: string, expiresAt: number }` 缓存
2. `getCookie()` 方法：检查缓存是否有效（TTL 默认 30 分钟），有效直接返回
3. 缓存失效时，向 `{baseUrl}{authLoginUrl}` POST `authLoginPayload`
4. 从 JSON 响应中按 `cookieFieldPath` 提取 cookie 值（如 `response.data.cookie`）
5. 写入缓存并返回

**错误处理**：登录失败时抛出明确错误信息（含 HTTP 状态码和响应体摘要）。

---

### 4. 工具实现

#### [NEW] [src/tools/generator.ts](file:///c:/Users/13777/Documents/projects/auto-test-tools/src/tools/generator.ts)

**Tool 名称**：`generate_karate_script`

**输入参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `targetPath` | string | ✅ | .feature 文件相对路径 |
| `apiContext` | object | ✅ | 包含 method, url, headers, requestBody, queryParams |
| `businessRules` | string | ✅ | 自然语言断言规则 |

> [!NOTE]
> 原设计中的 `needDbSetup` 参数暂不实现，因 DbTestUtils 包路径未确定。

**内部流程**：
1. 从配置读取 `baseUrl` 等固定参数
2. 组装 System Prompt（包含 Karate DSL 语法约束、Background 模板、Cookie 注入模式等规则）
3. 调用 Anthropic Claude API，传入 System Prompt + apiContext + businessRules
4. 从 LLM 响应中提取 ` ```feature ... ``` ` 代码块
5. 写入 `{project.root}/{featureBaseDir}/{targetPath}`，目录不存在则自动创建
6. 返回写入结果摘要（路径、Scenario 数量）

**System Prompt 关键约束**：
- 生成标准 Karate DSL feature 文件
- Background 中包含 `url baseUrl` 和 `configure headers = { 'Cookie': cookie }` 
- cookie 变量由 `karate-config.js` 通过 `karate.properties['cookie']` 注入
- 断言使用 JsonPath 风格（`match response.data.id == '#number'`）
- 禁止硬编码测试数据主键 ID

---

#### [NEW] [src/tools/executor.ts](file:///c:/Users/13777/Documents/projects/auto-test-tools/src/tools/executor.ts)

**Tool 名称**：`execute_karate_and_parse`

**输入参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `featurePath` | string | ✅ | .feature 文件路径（相对于 featureBaseDir 的 classpath 路径） |

**内部流程**：

**Step 0 — KarateRunner 自检**：
- 检查 `{project.root}/src/test/java/KarateRunner.java` 是否存在
- 不存在则自动生成标准的 `@Karate.Test` Runner 类并写入

**Step 1 — 获取 Cookie**：
- 调用 `cookieManager.getCookie()` 获取认证凭证

**Step 2 — 组装 Maven 命令并执行**：
```bash
{mvnCommand} clean test \
  -Dtest={karateRunnerClass} \
  -Dkarate.options="classpath:{featurePath}" \
  -Dkarate.env.cookie="{cookieValue}"
```
- 通过 `child_process.spawn` 执行，设置 `cwd` 为 `project.root`
- 设置 `timeoutSeconds` 超时保护

**Step 3 — 结果解析与日志清洗**：
- Exit Code = 0：返回 `✅ 所有 Scenario 通过`
- Exit Code ≠ 0：
  1. 读取 `{karateReportsDir}/karate-summary-json.txt`（若存在）
  2. 从 stdout/stderr 中过滤，剔除 `java.lang.*`、`org.apache.*`、`com.sun.*` 等无用堆栈
  3. 仅保留 Karate 层断言信息（`match failed`、`url`、`path` 等关键行）
  4. 截断至 1000 字符以内返回

---

#### [NEW] [src/utils/logFilter.ts](file:///c:/Users/13777/Documents/projects/auto-test-tools/src/utils/logFilter.ts)

**职责**：清洗 Maven/Karate 执行输出日志。

**核心逻辑**：
- 按行过滤，保留包含 Karate 关键词的行（`match failed`, `status`, `assert`, `url`, `path`, `Error`, `Scenario`）
- 剔除以 `at java.`, `at org.apache.`, `at com.sun.`, `at sun.` 等开头的 Java 堆栈行
- 最终结果截断至 1000 字符

---

### 5. MCP Server 入口

#### [NEW] [src/index.ts](file:///c:/Users/13777/Documents/projects/auto-test-tools/src/index.ts)

**职责**：MCP Server 入口，注册 Tools，启动 stdio 通信。

**启动流程**：
1. 解析命令行参数（`--config`）
2. 调用 `loadConfig()` 加载并校验配置
3. 初始化 Anthropic SDK Client（读取 `ANTHROPIC_API_KEY` 环境变量）
4. 创建 MCP Server 实例，注册两个 Tool：
   - `generate_karate_script`
   - `execute_karate_and_parse`
5. 启动 stdio 通信

---

### 6. 示例配置文件

#### [NEW] [karate-mcp.config.example.json](file:///c:/Users/13777/Documents/projects/auto-test-tools/karate-mcp.config.example.json)

提供完整的配置文件示例，所有字段带注释说明。

---

## 最终工程结构

```
auto-test-tools/
├── doc/                           # 既有设计文档
│   ├── design.md
│   └── discussion-e2e-rd-efficiency.md
├── src/
│   ├── index.ts                   # MCP Server 入口
│   ├── config.ts                  # 配置文件加载与校验
│   ├── tools/
│   │   ├── generator.ts           # generate_karate_script
│   │   └── executor.ts            # execute_karate_and_parse
│   ├── auth/
│   │   └── cookieManager.ts       # 登录 + Cookie TTL 缓存
│   └── utils/
│       └── logFilter.ts           # 日志清洗
├── karate-mcp.config.example.json # 配置文件示例
├── .env.example                   # 环境变量示例
├── package.json
├── tsconfig.json
├── .gitignore
├── LICENSE
└── README.md
```

---

## Verification Plan

### 自动化验证

1. **TypeScript 编译**：`npm run build` 确保无编译错误
2. **模块单元验证**：
   - 配置加载：验证优先级和缺失字段报错
   - 日志过滤：用真实 Karate 输出样本验证过滤效果
3. **MCP 协议验证**：通过 `@modelcontextprotocol/inspector` 工具连接 Server，验证 Tool 注册和调用链路

### 手动验证

- 用户提供一个真实的 Java 业务项目路径和登录接口信息后，进行端到端实测
