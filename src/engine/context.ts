// ─── Execution Context ──────────────────────────────────────────────────────
//
// 每个 Scenario 拥有独立的 ExecutionContext，维护 HTTP 请求/响应状态和变量，
// 并负责管理独立的浏览器上下文（用于 UI 测试）。

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { LocatorMapper } from "./locatorMapper.js";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

export class ExecutionContext {
  workspaceDir: string;
  locatorMapper: LocatorMapper;
  /** 基础 URL，如 http://localhost:8080 */
  baseUrl: string = "";

  /** 请求路径，如 /api/user/list */
  path: string = "";

  /** 请求头 */
  headers: Record<string, string> = {};

  /** Query 参数 */
  params: Record<string, string> = {};

  /** 请求体（任意 JSON） */
  requestBody: unknown = undefined;

  /** 最近一次响应状态码 */
  statusCode: number = 0;

  /** 最近一次响应体（已解析的 JSON） */
  response: unknown = undefined;

  /** 最近一次原始响应文本 */
  responseText: string = "";

  /** 用户定义变量（通过 def 关键字） */
  variables: Record<string, unknown> = {};

  // ─── UI Automation State ───
  browser: Browser | null = null;
  browserContext: BrowserContext | null = null;
  page: Page | null = null;

  /**
   * 从配置初始化上下文
   */
  constructor(baseUrl: string = "", cookie?: string, workspaceDir: string = process.cwd()) {
    this.baseUrl = baseUrl;
    this.workspaceDir = workspaceDir;
    this.locatorMapper = new LocatorMapper(workspaceDir);
    if (cookie) {
      this.headers["Cookie"] = cookie;
    }
  }

  /**
   * 构建完整请求 URL（baseUrl + path + query params）
   */
  buildUrl(): string {
    let url = this.baseUrl + this.path;

    const entries = Object.entries(this.params);
    if (entries.length > 0) {
      const qs = entries
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
      url += `?${qs}`;
    }

    return url;
  }

  /**
   * 执行 HTTP 请求
   */
  async executeRequest(method: string): Promise<void> {
    const url = this.buildUrl();
    const upperMethod = method.toUpperCase();

    const init: RequestInit = {
      method: upperMethod,
      headers: { ...this.headers },
    };

    // 有 body 的方法
    if (
      this.requestBody !== undefined &&
      ["POST", "PUT", "PATCH"].includes(upperMethod)
    ) {
      (init.headers as Record<string, string>)["Content-Type"] =
        "application/json";
      init.body = JSON.stringify(this.requestBody);
    }

    const res = await fetch(url, init);
    this.statusCode = res.status;
    this.responseText = await res.text();

    // 尝试解析为 JSON
    try {
      this.response = JSON.parse(this.responseText);
    } catch {
      this.response = this.responseText;
    }

    // 重置请求态（path、params、body），为下一次请求做准备
    this.path = "";
    this.params = {};
    this.requestBody = undefined;
  }

  /**
   * 通过点分路径从 response 或 variables 中取值
   * 支持: response.data.list[0].userId, myVar.name
   */
  resolveExpression(expr: string): unknown {
    const trimmed = expr.trim();

    // response.xxx
    if (trimmed === "response") {
      return this.response;
    }
    if (trimmed.startsWith("response.") || trimmed.startsWith("response[")) {
      return getByPath(this.response, trimmed.substring("response".length));
    }

    // responseText
    if (trimmed === "responseText") {
      return this.responseText;
    }

    // statusCode
    if (trimmed === "statusCode") {
      return this.statusCode;
    }

    // 变量引用
    if (trimmed in this.variables) {
      return this.variables[trimmed];
    }

    // 变量的属性: varName.prop
    const dotIdx = trimmed.indexOf(".");
    const bracketIdx = trimmed.indexOf("[");
    const firstAccessor = Math.min(
      dotIdx === -1 ? Infinity : dotIdx,
      bracketIdx === -1 ? Infinity : bracketIdx
    );

    if (firstAccessor < Infinity) {
      const varName = trimmed.substring(0, firstAccessor);
      if (varName in this.variables) {
        return getByPath(
          this.variables[varName],
          trimmed.substring(varName.length)
        );
      }
    }

    // 尝试解析为字面量
    return parseLiteral(trimmed);
  }

  /**
   * 替换字符串中的变量占位符
   * 支持 Karate 风格: '#(varName)' 和模板风格: '<varName>'
   */
  interpolate(text: string): string {
    // 替换 #(varName) → 变量值
    let result = text.replace(/#\(([^)]+)\)/g, (_, expr) => {
      const val = this.resolveExpression(expr);
      return String(val);
    });

    // 替换 <varName> → 变量值
    result = result.replace(/<([^>]+)>/g, (_, varName) => {
      if (varName in this.variables) {
        return String(this.variables[varName]);
      }
      return `<${varName}>`;
    });

    return result;
  }

  // ─── UI Automation Methods ────────────────────────────────────────────────

  /**
   * 启动浏览器并加载 auth.json 状态
   */
  async initDriverWithAuth(authFileName: string): Promise<Page> {
    if (!this.browser) {
      console.error("[ui] 正在启动浏览器...");
      this.browser = await chromium.launch({ headless: true });
    }
    if (!this.browserContext) {
      const authPath = resolve(this.workspaceDir, authFileName);
      if (existsSync(authPath)) {
        console.error(`[ui] 加载会话状态: ${authPath}`);
        this.browserContext = await this.browser.newContext({ storageState: authPath });
      } else {
        console.warn(`[ui] 未找到会话状态文件: ${authPath}，以匿名身份启动`);
        this.browserContext = await this.browser.newContext();
      }
    }
    if (!this.page) {
      this.page = await this.browserContext.newPage();
    }
    return this.page;
  }

  /**
   * 启动浏览器并打开页面（如果尚未启动）
   */
  async initDriver(url?: string): Promise<Page> {
    if (!this.browser) {
      console.error("[ui] 正在启动浏览器...");
      this.browser = await chromium.launch({ headless: true });
    }
    if (!this.browserContext) {
      this.browserContext = await this.browser.newContext();
    }
    if (!this.page) {
      this.page = await this.browserContext.newPage();
    }
    if (url) {
      console.error(`[ui] 导航至: ${url}`);
      await this.page.goto(url);
    }
    return this.page;
  }

  /**
   * 清理浏览器资源
   */
  async closeDriver(): Promise<void> {
    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }
    if (this.browserContext) {
      await this.browserContext.close().catch(() => {});
      this.browserContext = null;
    }
    if (this.browser) {
      console.error("[ui] 关闭浏览器...");
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

/**
 * 从对象中按路径取值，支持点分和数组索引
 * path 格式: .data.list[0].userId 或 [0].name
 */
function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;

  // 将 .foo[0].bar 分解为 tokens: ["foo", "0", "bar"]
  const tokens: string[] = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === ".") {
      i++;
      let token = "";
      while (i < path.length && path[i] !== "." && path[i] !== "[") {
        token += path[i];
        i++;
      }
      if (token) tokens.push(token);
    } else if (path[i] === "[") {
      i++;
      let token = "";
      while (i < path.length && path[i] !== "]") {
        token += path[i];
        i++;
      }
      if (path[i] === "]") i++;
      if (token) tokens.push(token);
    } else {
      let token = "";
      while (i < path.length && path[i] !== "." && path[i] !== "[") {
        token += path[i];
        i++;
      }
      if (token) tokens.push(token);
    }
  }

  let current: unknown = obj;
  for (const token of tokens) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

/**
 * 尝试将字符串解析为 JS 字面量值
 */
function parseLiteral(value: string): unknown {
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "undefined") return undefined;

  // 数字
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== "") return num;

  // 带引号的字符串
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
