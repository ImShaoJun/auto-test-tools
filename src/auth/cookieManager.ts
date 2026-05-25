import type { AppConfig } from "../config.js";

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
 * 例如 getByPath({ data: { cookie: "abc" } }, "data.cookie") => "abc"
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
 * 获取认证 Cookie。
 * 优先返回内存缓存（30 分钟 TTL），缓存失效则调用登录接口重新获取。
 */
export async function getCookie(config: AppConfig): Promise<string> {
  // 检查缓存
  if (cachedCookie && Date.now() < cachedCookie.expiresAt) {
    console.error("[auth] 使用缓存的 Cookie");
    return cachedCookie.value;
  }

  // 调用登录接口
  const loginUrl = `${config.env.baseUrl}${config.env.authLoginUrl}`;
  console.error(`[auth] 正在请求登录接口: ${loginUrl}`);

  let response: Response;
  try {
    response = await fetch(loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config.env.authLoginPayload),
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
  const cookieValue = getByPath(jsonBody, config.env.cookieFieldPath);

  if (typeof cookieValue !== "string" || cookieValue.length === 0) {
    throw new Error(
      `登录接口响应中无法通过路径 "${config.env.cookieFieldPath}" 提取到有效的 cookie 值。\n响应体: ${JSON.stringify(jsonBody).slice(0, 500)}`
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
