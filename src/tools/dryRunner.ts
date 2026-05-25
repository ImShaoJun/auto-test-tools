import type { AppConfig } from "../config.js";
import { getCookie } from "../auth/cookieManager.js";

export interface DryRunParams {
  method: string;
  path: string;
  queryParams?: Record<string, string | number | boolean>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export async function handleDryRunApi(
  params: DryRunParams,
  config: AppConfig
): Promise<string> {
  const { method, path, queryParams, body, headers = {} } = params;

  if (!method || !path) {
    throw new Error("参数 method 和 path 不能为空");
  }

  console.error(`[dryRun] 准备试调接口: ${method} ${path}`);

  // 1. 获取认证 Cookie
  let cookieValue = "";
  try {
    cookieValue = await getCookie(config);
  } catch (err) {
    console.error(`[dryRun] 警告: 获取 Cookie 失败，将不带 Cookie 请求: ${err}`);
  }

  // 2. 构建完整 URL 和查询参数
  const urlObj = new URL(`${config.env.baseUrl}${path}`);
  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      urlObj.searchParams.append(key, String(value));
    }
  }

  // 3. 构建请求头
  const requestHeaders = new Headers(headers as Record<string, string>);
  if (cookieValue) {
    requestHeaders.append("Cookie", cookieValue);
  }
  if (body) {
    requestHeaders.append("Content-Type", "application/json");
  }

  // 4. 发起请求
  const fetchOptions: RequestInit = {
    method,
    headers: requestHeaders,
  };
  if (body && ["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
    fetchOptions.body = JSON.stringify(body);
  }

  console.error(`[dryRun] 发送请求: ${urlObj.toString()}`);
  
  let response: Response;
  try {
    response = await fetch(urlObj.toString(), fetchOptions);
  } catch (err) {
    throw new Error(`请求失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5. 解析响应
  let responseBodyStr = "";
  const contentType = response.headers.get("content-type") || "";
  
  try {
    if (contentType.includes("application/json")) {
      const jsonBody = await response.json();
      responseBodyStr = JSON.stringify(jsonBody, null, 2);
    } else {
      responseBodyStr = await response.text();
    }
  } catch (err) {
    responseBodyStr = `(无法读取响应体: ${err})`;
  }

  // 6. 截断响应体防止过长
  const MAX_LENGTH = 3000;
  if (responseBodyStr.length > MAX_LENGTH) {
    responseBodyStr = responseBodyStr.slice(0, MAX_LENGTH) + "\n... (响应过长，已截断)";
  }

  // 7. 格式化输出
  const result = [
    `HTTP ${response.status} ${response.statusText}`,
    "",
    "Response Body:",
    responseBodyStr
  ].join("\n");

  console.error(`[dryRun] 试调完成，状态码: ${response.status}`);
  return result;
}
