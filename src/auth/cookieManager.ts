import type { AppConfig, AuthConfig } from "../config.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface CachedCookie {
  value: string;
  expiresAt: number;
}

// ─── Cookie Manager ─────────────────────────────────────────────────────────

const COOKIE_TTL_MS = 30 * 60 * 1000; // 30 minutes

let cachedCookie: CachedCookie | null = null;

/**
 * 从 JSON 对象中按点分路径提取值
 */
function getByPath(obj: unknown, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * 通过调用登录接口获取 Cookie
 *
 * @param baseUrl - API 基础 URL
 * @param auth - 认证配置
 */
export async function fetchCookie(
  baseUrl: string,
  auth: AuthConfig
): Promise<string> {
  // 检查缓存
  if (cachedCookie && Date.now() < cachedCookie.expiresAt) {
    console.error("[auth] 使用缓存的 Cookie");
    return cachedCookie.value;
  }

  // 调用登录接口
  const loginUrl = `${baseUrl}${auth.loginUrl}`;
  console.error(`[auth] 正在请求登录接口: ${loginUrl}`);

  let response: Response;
  try {
    response = await fetch(loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(auth.loginPayload),
    });
  } catch (err) {
    throw new Error(
      `登录接口请求失败: ${loginUrl}\n${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "(无法读取响应体)");
    throw new Error(
      `登录接口返回错误 HTTP ${response.status}: ${bodyText.slice(0, 500)}`
    );
  }

  // 解析 JSON 响应
  let jsonBody: unknown;
  try {
    jsonBody = await response.json();
  } catch {
    throw new Error("登录接口响应不是合法的 JSON");
  }

  // 按 cookieFieldPath 提取 cookie 值
  const cookieValue = getByPath(jsonBody, auth.cookieFieldPath);

  if (typeof cookieValue !== "string" || cookieValue.length === 0) {
    throw new Error(
      `登录接口响应中无法通过路径 "${auth.cookieFieldPath}" 提取到有效的 cookie 值。\n响应体: ${JSON.stringify(jsonBody).slice(0, 500)}`
    );
  }

  // 写入缓存
  cachedCookie = {
    value: cookieValue,
    expiresAt: Date.now() + COOKIE_TTL_MS,
  };

  console.error("[auth] Cookie 获取成功并已缓存");
  return cookieValue;
}

/**
 * 清除缓存的 Cookie（用于强制重新登录）
 */
export function clearCookieCache(): void {
  cachedCookie = null;
  console.error("[auth] Cookie 缓存已清除");
}
