import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";

// ─── Configuration Schema ───────────────────────────────────────────────────

const AuthSchema = z.object({
  loginUrl: z.string().describe("登录接口路径"),
  loginPayload: z
    .record(z.unknown())
    .describe("登录请求体"),
  cookieFieldPath: z
    .string()
    .default("data.cookie")
    .describe("JSON 响应中 cookie 字段路径"),
});

const EnvSchema = z.object({
  baseUrl: z.string().describe("API 基础 URL"),
  auth: AuthSchema.optional().describe("认证配置（可选）"),
});

const ConfigSchema = z.object({
  workspaceDir: z
    .string()
    .default("./features")
    .describe("Feature 文件工作目录（相对路径基于配置文件所在目录）"),
  env: EnvSchema,
});

export type AuthConfig = z.infer<typeof AuthSchema>;
export type AppConfig = z.infer<typeof ConfigSchema>;

// ─── Configuration Loader ───────────────────────────────────────────────────

/**
 * 按优先级加载配置文件：
 *   1. 命令行参数 --config 指定路径（最高优先级）
 *   2. 当前工作目录 ./karate-mcp.config.json
 *   3. 用户 Home 目录 ~/.karate-mcp/config.json
 */
export function loadConfig(cliConfigPath?: string): AppConfig {
  const candidates: string[] = [];

  // 优先级 1：命令行参数
  if (cliConfigPath) {
    candidates.push(resolve(cliConfigPath));
  }

  // 优先级 2：当前工作目录
  candidates.push(resolve(process.cwd(), "karate-mcp.config.json"));

  // 优先级 3：用户 Home 目录
  candidates.push(join(homedir(), ".karate-mcp", "config.json"));

  // 查找第一个存在的配置文件
  let configPath: string | undefined;
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      configPath = candidate;
      break;
    }
  }

  if (!configPath) {
    const searched = candidates.map((c) => `  - ${c}`).join("\n");
    throw new Error(
      `找不到配置文件。已搜索以下路径：\n${searched}\n\n请创建配置文件或通过 --config 参数指定路径。`
    );
  }

  // 读取并解析
  let rawJson: unknown;
  try {
    const content = readFileSync(configPath, "utf-8");
    rawJson = JSON.parse(content);
  } catch (err) {
    throw new Error(
      `配置文件读取或解析失败: ${configPath}\n${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Zod 校验
  const result = ConfigSchema.safeParse(rawJson);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`配置文件校验失败: ${configPath}\n${issues}`);
  }

  console.error(`[config] 已加载配置文件: ${configPath}`);
  return result.data;
}

// ─── CLI Argument Parser ────────────────────────────────────────────────────

/**
 * 从 process.argv 中提取 --config 参数值
 */
export function parseCliConfigPath(): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--config");
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}
