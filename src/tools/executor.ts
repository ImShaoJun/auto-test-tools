import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import type { AppConfig, AuthConfig } from "../config.js";
import { fetchCookie } from "../auth/cookieManager.js";
import { runFeature, formatResult } from "../engine/runner.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ExecuteParams {
  featurePath: string;

  /** 直接传入的 Cookie 值（优先级最高） */
  cookie?: string;

  /** 运行时指定的认证配置（优先级高于配置文件预设） */
  auth?: {
    loginUrl: string;
    loginPayload: Record<string, unknown>;
    cookieFieldPath?: string;
  };
}

// ─── Tool Handler ───────────────────────────────────────────────────────────

export async function handleExecuteFeature(
  params: ExecuteParams,
  config: AppConfig,
  workspaceDir: string
): Promise<string> {
  const { featurePath } = params;

  // 1. 解析 feature 文件路径
  const fullPath = isAbsolute(featurePath)
    ? featurePath
    : resolve(workspaceDir, featurePath);

  if (!existsSync(fullPath)) {
    return `❌ Feature 文件不存在: ${fullPath}`;
  }

  console.error(`[executor] 读取 Feature: ${fullPath}`);
  const featureContent = readFileSync(fullPath, "utf-8");

  // 2. 解析 Cookie（优先级: 参数 cookie > 参数 auth > 配置 auth > 无认证）
  let cookie: string | undefined;

  if (params.cookie) {
    // 直接传入
    cookie = params.cookie;
    console.error("[executor] 使用参数直传的 Cookie");
  } else if (params.auth) {
    // 运行时指定的认证配置
    console.error("[executor] 使用参数指定的认证配置获取 Cookie...");
    const authConfig: AuthConfig = {
      loginUrl: params.auth.loginUrl,
      loginPayload: params.auth.loginPayload,
      cookieFieldPath: params.auth.cookieFieldPath ?? "data.cookie",
    };
    try {
      cookie = await fetchCookie(config.env.baseUrl, authConfig);
    } catch (err) {
      return `❌ 认证失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else if (config.env.auth) {
    // 配置文件预设
    console.error("[executor] 使用配置文件预设的认证获取 Cookie...");
    try {
      cookie = await fetchCookie(config.env.baseUrl, config.env.auth);
    } catch (err) {
      return `❌ 认证失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    console.error("[executor] 无认证模式，不注入 Cookie");
  }

  // 3. 执行 Feature
  console.error("[executor] 开始执行 Feature...");
  try {
    const result = await runFeature(featureContent, config.env.baseUrl, cookie);
    return formatResult(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ 执行异常: ${msg}`;
  }
}
