#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { resolve } from "node:path";
import { loadConfig, parseCliConfigPath } from "./config.js";
import {
  handleGenerateFeature,
  type GenerateParams,
} from "./tools/generator.js";
import {
  handleExecuteFeature,
  type ExecuteParams,
} from "./tools/executor.js";

// ─── Tool Definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "generate_feature",
    description:
      "将生成的 BDD 测试脚本（.feature 文件）写入磁盘。\n\n**重要提示：由于你（LLM）负责生成脚本内容，你必须严格遵循以下自定义 Gherkin DSL 语法规则**：\n\n1. **请求构建 (Given)**\n   - `Given url '<URL>'` — 设置基础 URL\n   - `Given path '<路径>'` — 设置请求路径\n   - `Given header <Name> = '<value>'`\n   - `Given cookie '<value>'`\n   - `Given param <name> = <value>`\n   - `Given request <JSON>` 或使用 DocString 形式\n   - `Given def <var> = <expr>` — 定义变量 (如 `def userId = response.data.id`)\n\n2. **执行 (When)**\n   - `When method GET|POST|PUT|DELETE|PATCH`\n\n3. **断言 (Then)**\n   - `Then status <code>`\n   - `Then match <expr> == <expected>`\n   - `Then match <expr> != <expected>`\n   - `Then match <expr> contains <object>`\n   - `Then match each <array> contains <object>`\n\n4. **类型标记 (用于 match 断言)**\n   - `'#number'`, `'#string'`, `'#boolean'`, `'#array'`, `'#object'`, `'#notnull'`, `'#null'`, `'#uuid'`\n   - `'#[_ > 0]'` (数组长度断言)\n\n5. **调试**\n   - `And print <expr>`\n\n断言时使用 `response.xxx` 访问响应字段。",
    inputSchema: {
      type: "object" as const,
      properties: {
        targetPath: {
          type: "string",
          description:
            "保存的 .feature 文件路径（相对 workspaceDir 或绝对路径）。",
        },
        featureContent: {
          type: "string",
          description: "按照上述 DSL 规则生成的完整 .feature 文件内容。",
        },
      },
      required: ["targetPath", "featureContent"],
    },
  },
  {
    name: "execute_feature",
    description:
      "执行指定的 .feature BDD 测试脚本。自动处理认证 Cookie（支持直传 cookie、运行时指定登录接口、或使用配置文件预设），在进程内执行 HTTP 请求和断言，返回结构化的测试结果。",
    inputSchema: {
      type: "object" as const,
      properties: {
        featurePath: {
          type: "string",
          description:
            "要执行的 .feature 文件路径。相对路径基于 workspaceDir，也支持绝对路径。",
        },
        cookie: {
          type: "string",
          description:
            "直接传入的 Cookie 值（如 SESSION=abc123）。优先级最高，设置后跳过自动登录。",
        },
        auth: {
          type: "object",
          description: "运行时指定的认证配置（优先级高于配置文件预设）",
          properties: {
            loginUrl: {
              type: "string",
              description: "登录接口路径，如 /api/auth/login",
            },
            loginPayload: {
              type: "object",
              description: "登录请求体",
            },
            cookieFieldPath: {
              type: "string",
              description:
                "JSON 响应中 cookie 字段路径，默认 data.cookie",
            },
          },
          required: ["loginUrl", "loginPayload"],
        },
      },
      required: ["featurePath"],
    },
  },
];

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // 1. 加载配置
  const cliConfigPath = parseCliConfigPath();
  const config = loadConfig(cliConfigPath);

  // 2. 解析 workspaceDir
  const workspaceDir = resolve(config.workspaceDir);

  // 3. 创建 MCP Server
  const server = new Server(
    { name: "bdd-mcp-server", version: "2.0.0" },
    { capabilities: { tools: {} } }
  );

  // 4. 注册 Tool 列表
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // 5. 注册 Tool 调用处理
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "generate_feature": {
        try {
          const params = args as unknown as GenerateParams;
          const result = await handleGenerateFeature(params, workspaceDir);
          return { content: [{ type: "text" as const, text: result }] };
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          return {
            content: [
              { type: "text" as const, text: `❌ 写入失败: ${errorMsg}` },
            ],
          };
        }
      }

      case "execute_feature": {
        try {
          const params = args as unknown as ExecuteParams;
          const result = await handleExecuteFeature(
            params,
            config,
            workspaceDir
          );
          return { content: [{ type: "text" as const, text: result }] };
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          return {
            content: [
              { type: "text" as const, text: `❌ 执行异常: ${errorMsg}` },
            ],
          };
        }
      }

      default:
        return {
          content: [
            { type: "text" as const, text: `❌ 未知工具: ${name}` },
          ],
        };
    }
  });

  // 7. 启动 stdio 传输
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[server] bdd-mcp-server v2.0 已启动（纯 TS 引擎）");
  console.error(`[server] 基础 URL: ${config.env.baseUrl}`);
  console.error(`[server] 工作目录: ${workspaceDir}`);
}

main().catch((err) => {
  console.error("[server] 启动失败:", err);
  process.exit(1);
});
