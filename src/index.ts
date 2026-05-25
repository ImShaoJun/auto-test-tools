#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { loadConfig, parseCliConfigPath } from "./config.js";
import { handleWriteFeatureFile, type WriteFeatureParams } from "./tools/writer.js";
import { handleDryRunApi, type DryRunParams } from "./tools/dryRunner.js";
import { handleListFeatures, type ListFeaturesParams } from "./tools/listFeatures.js";
import { handleReadFeature, type ReadFeatureParams } from "./tools/readFeature.js";
import {
  handleExecuteKarateAndParse,
  type ExecuteParams,
} from "./tools/executor.js";

// ─── Tool Definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "write_feature_file",
    description: "将生成的 Karate .feature 文件内容写入到本地磁盘。自动处理目录创建。",
    inputSchema: {
      type: "object" as const,
      properties: {
        targetPath: {
          type: "string",
          description: "生成的 .feature 文件保存的相对路径（相对于 featureBaseDir），例如 user/user_list.feature",
        },
        content: {
          type: "string",
          description: ".feature 文件的完整文本内容",
        },
      },
      required: ["targetPath", "content"],
    },
  },
  {
    name: "dry_run_api",
    description: "试调真实的后端接口，返回 HTTP 响应。用于在编写 Karate 断言前观察真实的响应结构。会自动携带配置文件中的 Cookie。",
    inputSchema: {
      type: "object" as const,
      properties: {
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
          description: "HTTP 方法",
        },
        path: {
          type: "string",
          description: "接口路径，例如 /api/user/list",
        },
        queryParams: {
          type: "object",
          description: "Query 参数（GET 时填写）",
        },
        body: {
          type: "object",
          description: "请求体结构（POST/PUT 时填写）",
        },
        headers: {
          type: "object",
          description: "额外的 HTTP Header",
        },
      },
      required: ["method", "path"],
    },
  },
  {
    name: "list_feature_files",
    description: "扫描并列出项目中已存在的 Karate .feature 文件。用于在编写新测试前查找可参考的类似用例。",
    inputSchema: {
      type: "object" as const,
      properties: {
        subDir: {
          type: "string",
          description: "可选。指定要扫描的子目录（相对于 featureBaseDir）。留空则扫描所有目录。",
        },
      },
    },
  },
  {
    name: "read_feature_file",
    description: "读取指定的 Karate .feature 文件内容。用于学习项目内现有的测试写法和断言规范。",
    inputSchema: {
      type: "object" as const,
      properties: {
        featurePath: {
          type: "string",
          description: "要读取的 .feature 文件的相对路径，例如 user/user_list.feature",
        },
      },
      required: ["featurePath"],
    },
  },
  {
    name: "execute_karate_and_parse",
    description: "执行指定的 Karate .feature 测试脚本。自动处理认证 Cookie 获取，触发 Maven 执行，并返回过滤清洗后的测试结果。",
    inputSchema: {
      type: "object" as const,
      properties: {
        featurePath: {
          type: "string",
          description: "要执行的 .feature 文件路径（相对于 featureBaseDir 的 classpath 路径），例如 user/user_list.feature",
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

  // 2. 创建 MCP Server
  const server = new Server(
    { name: "karate-mcp-server", version: "1.1.0" },
    { capabilities: { tools: {} } }
  );

  // 3. 注册 Tool 列表
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // 4. 注册 Tool 调用处理
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "write_feature_file": {
          const params = args as unknown as WriteFeatureParams;
          const result = await handleWriteFeatureFile(params, config);
          return { content: [{ type: "text" as const, text: result }] };
        }

        case "dry_run_api": {
          const params = args as unknown as DryRunParams;
          const result = await handleDryRunApi(params, config);
          return { content: [{ type: "text" as const, text: result }] };
        }

        case "list_feature_files": {
          const params = args as unknown as ListFeaturesParams;
          const result = await handleListFeatures(params, config);
          return { content: [{ type: "text" as const, text: result }] };
        }

        case "read_feature_file": {
          const params = args as unknown as ReadFeatureParams;
          const result = await handleReadFeature(params, config);
          return { content: [{ type: "text" as const, text: result }] };
        }

        case "execute_karate_and_parse": {
          const params = args as unknown as ExecuteParams;
          const result = await handleExecuteKarateAndParse(params, config);
          return { content: [{ type: "text" as const, text: result }] };
        }

        default:
          return {
            content: [
              { type: "text" as const, text: `❌ 未知工具: ${name}` },
            ],
          };
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          { type: "text" as const, text: `❌ 执行失败: ${errorMsg}` },
        ],
      };
    }
  });

  // 5. 启动 stdio 传输
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[server] karate-mcp-server 已启动，等待连接...");
  console.error(`[server] 项目根路径: ${config.project.root}`);
  console.error(`[server] 基础 URL: ${config.env.baseUrl}`);
}

main().catch((err) => {
  console.error("[server] 启动失败:", err);
  process.exit(1);
});
