// ─── Step Executor ──────────────────────────────────────────────────────────
//
// 解析 Gherkin Step 文本并执行对应操作。
// 实现 Karate 风格的 BDD 关键词：url, path, header, param, request, method,
// status, match, def, print, cookie,
// 以及 UI 相关的：driver, click, input, waitFor, screenshot 等。

import { ExecutionContext } from "./context.js";
import { deepEquals, containsMatch, matchesTypeMarker } from "./matchers.js";
import type { MatchResult } from "./matchers.js";

export interface StepResult {
  passed: boolean;
  keyword: string;
  text: string;
  error?: string;
}

/**
 * 执行单个 Gherkin Step
 *
 * @param keyword - Given / When / Then / And / But
 * @param text    - Step 文本（不含关键词）
 * @param docString - 可选的 DocString 内容
 * @param ctx     - 执行上下文
 */
export async function executeStep(
  keyword: string,
  text: string,
  docString: string | undefined,
  ctx: ExecutionContext
): Promise<StepResult> {
  const trimmed = text.trim();

  try {
    // ── url 'xxx' ──
    if (trimmed.startsWith("url ")) {
      const value = extractValue(trimmed.substring(4), ctx);
      ctx.baseUrl = String(value);
      return ok(keyword, trimmed);
    }

    // ── path 'xxx' ──
    if (trimmed.startsWith("path ")) {
      const raw = trimmed.substring(5).trim();
      // 支持字符串拼接: '/api/user/' + userId
      const value = evaluateConcatExpression(raw, ctx);
      ctx.path = String(value);
      return ok(keyword, trimmed);
    }

    // ── header Name = 'value' ──
    if (trimmed.startsWith("header ")) {
      const rest = trimmed.substring(7);
      const eqIdx = rest.indexOf("=");
      if (eqIdx === -1) throw new Error(`header 语法错误: ${trimmed}`);
      const name = rest.substring(0, eqIdx).trim();
      const value = extractValue(rest.substring(eqIdx + 1).trim(), ctx);
      ctx.headers[name] = String(value);
      return ok(keyword, trimmed);
    }

    // ── cookie 'value' ──
    if (trimmed.startsWith("cookie ")) {
      const value = extractValue(trimmed.substring(7), ctx);
      ctx.headers["Cookie"] = String(value);
      return ok(keyword, trimmed);
    }

    // ── param name = value ──
    if (trimmed.startsWith("param ")) {
      const rest = trimmed.substring(6);
      const eqIdx = rest.indexOf("=");
      if (eqIdx === -1) throw new Error(`param 语法错误: ${trimmed}`);
      const name = rest.substring(0, eqIdx).trim();
      const value = extractValue(rest.substring(eqIdx + 1).trim(), ctx);
      ctx.params[name] = String(value);
      return ok(keyword, trimmed);
    }

    // ── request { ... } 或 request + docstring ──
    if (trimmed === "request" || trimmed.startsWith("request ")) {
      let bodyText: string;
      if (trimmed === "request" && docString) {
        bodyText = ctx.interpolate(docString);
      } else {
        bodyText = trimmed.substring(8).trim();
        bodyText = ctx.interpolate(bodyText);
      }
      ctx.requestBody = JSON.parse(bodyText);
      return ok(keyword, trimmed);
    }

    // ── method GET/POST/PUT/DELETE/PATCH ──
    if (trimmed.startsWith("method ")) {
      const method = trimmed.substring(7).trim().toUpperCase();
      await ctx.executeRequest(method);
      return ok(keyword, trimmed);
    }

    // ── status 200 ──
    if (trimmed.startsWith("status ")) {
      const expected = parseInt(trimmed.substring(7).trim(), 10);
      if (ctx.statusCode !== expected) {
        return err(
          keyword,
          trimmed,
          `状态码断言失败: 期望 ${expected}，实际 ${ctx.statusCode}`
        );
      }
      return ok(keyword, trimmed);
    }

    // ── match ... ──
    if (trimmed.startsWith("match ")) {
      const result = evaluateMatch(trimmed.substring(6).trim(), ctx);
      if (!result.passed) {
        return err(keyword, trimmed, `match 断言失败: ${result.message}`);
      }
      return ok(keyword, trimmed);
    }

    // ── def varName = expression ──
    if (trimmed.startsWith("def ")) {
      const rest = trimmed.substring(4);
      const eqIdx = rest.indexOf("=");
      if (eqIdx === -1) throw new Error(`def 语法错误: ${trimmed}`);
      const varName = rest.substring(0, eqIdx).trim();
      const expr = rest.substring(eqIdx + 1).trim();
      
      // 处理异步 UI 数据提取，如 text('#id')
      if (expr.startsWith("text(") || expr.startsWith("attribute(")) {
        ctx.variables[varName] = await evaluateAsyncUIExpression(expr, ctx);
      } else {
        ctx.variables[varName] = ctx.resolveExpression(expr);
      }
      return ok(keyword, trimmed);
    }

    // ── print expression ──
    if (trimmed.startsWith("print ")) {
      const expr = trimmed.substring(6).trim();
      const value = ctx.resolveExpression(expr);
      console.error(`[print] ${expr} =`, JSON.stringify(value, null, 2));
      return ok(keyword, trimmed);
    }

    // ─── UI Automation Steps ────────────────────────────────────────────────

    // ── driver 'https://example.com' ──
    if (trimmed.startsWith("driver ")) {
      const value = extractValue(trimmed.substring(7), ctx);
      await ctx.initDriver(String(value));
      return ok(keyword, trimmed);
    }

    // ── click '#btn' ──
    if (trimmed.startsWith("click ")) {
      if (!ctx.page) throw new Error("尚未初始化浏览器，请先调用 driver");
      const selector = String(extractValue(trimmed.substring(6), ctx));
      await ctx.page.click(selector);
      return ok(keyword, trimmed);
    }

    // ── input '#input', 'text' ──
    if (trimmed.startsWith("input ")) {
      if (!ctx.page) throw new Error("尚未初始化浏览器，请先调用 driver");
      const rest = trimmed.substring(6).trim();
      // 解析两个参数：selector 和 text (简化按逗号分割，注意字符串内如果有逗号会出问题，这里做简单处理)
      const commaIdx = rest.indexOf(",");
      if (commaIdx === -1) throw new Error(`input 语法错误: ${trimmed}`);
      const selectorRaw = rest.substring(0, commaIdx).trim();
      const textRaw = rest.substring(commaIdx + 1).trim();
      const selector = String(extractValue(selectorRaw, ctx));
      const text = String(extractValue(textRaw, ctx));
      await ctx.page.fill(selector, text);
      return ok(keyword, trimmed);
    }

    // ── waitFor '.selector' ──
    if (trimmed.startsWith("waitFor ")) {
      if (!ctx.page) throw new Error("尚未初始化浏览器，请先调用 driver");
      const selector = String(extractValue(trimmed.substring(8), ctx));
      await ctx.page.waitForSelector(selector);
      return ok(keyword, trimmed);
    }

    // ── screenshot 'path.png' ──
    if (trimmed.startsWith("screenshot ")) {
      if (!ctx.page) throw new Error("尚未初始化浏览器，请先调用 driver");
      const path = String(extractValue(trimmed.substring(11), ctx));
      await ctx.page.screenshot({ path });
      return ok(keyword, trimmed);
    }

    // ── 未知步骤 ──
    return err(keyword, trimmed, `未知的步骤关键词: ${trimmed}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(keyword, trimmed, msg);
  }
}

// ─── Match 表达式解析 ───────────────────────────────────────────────────────

/**
 * 解析并执行 match 表达式
 *
 * 支持的格式:
 *   match response.code == 0
 *   match response.data.id == '#number'
 *   match response.data.list == '#[_ > 0]'
 *   match response.data != null
 *   match response.data contains { key: 'value' }
 *   match each response.data.list contains { userId: '#number' }
 */
function evaluateMatch(expr: string, ctx: ExecutionContext): MatchResult {
  // 处理 "each" 修饰符
  let isEach = false;
  let remaining = expr;

  if (remaining.startsWith("each ")) {
    isEach = true;
    remaining = remaining.substring(5).trim();
  }

  // 分割操作符: ==, !=, contains
  let operator: string;
  let leftExpr: string;
  let rightExpr: string;

  const containsIdx = remaining.indexOf(" contains ");
  const eqIdx = remaining.indexOf(" == ");
  const neqIdx = remaining.indexOf(" != ");

  if (containsIdx !== -1 && (eqIdx === -1 || containsIdx < eqIdx)) {
    operator = "contains";
    leftExpr = remaining.substring(0, containsIdx).trim();
    rightExpr = remaining.substring(containsIdx + 10).trim();
  } else if (eqIdx !== -1 && (neqIdx === -1 || eqIdx < neqIdx)) {
    operator = "==";
    leftExpr = remaining.substring(0, eqIdx).trim();
    rightExpr = remaining.substring(eqIdx + 4).trim();
  } else if (neqIdx !== -1) {
    operator = "!=";
    leftExpr = remaining.substring(0, neqIdx).trim();
    rightExpr = remaining.substring(neqIdx + 4).trim();
  } else {
    return { passed: false, message: `无法解析 match 表达式: ${expr}` };
  }

  // 解析左值
  const actualValue = ctx.resolveExpression(leftExpr);

  // 解析右值
  const expectedValue = parseRightValue(rightExpr, ctx);

  // 执行匹配
  if (isEach) {
    // each: 对数组中的每个元素执行匹配
    if (!Array.isArray(actualValue)) {
      return {
        passed: false,
        message: `"each" 要求左值为数组，实际: ${typeof actualValue}`,
      };
    }

    for (let i = 0; i < actualValue.length; i++) {
      const itemResult = matchSingle(
        actualValue[i],
        expectedValue,
        operator
      );
      if (!itemResult.passed) {
        return {
          passed: false,
          message: `数组元素 [${i}]: ${itemResult.message}`,
        };
      }
    }
    return { passed: true, message: "" };
  }

  return matchSingle(actualValue, expectedValue, operator);
}

/**
 * 执行单个值的匹配
 */
function matchSingle(
  actual: unknown,
  expected: unknown,
  operator: string
): MatchResult {
  switch (operator) {
    case "==": {
      // 如果 expected 是 Karate 类型标记
      if (typeof expected === "string" && expected.startsWith("#")) {
        return matchesTypeMarker(actual, expected);
      }
      return deepEquals(actual, expected);
    }

    case "!=": {
      if (typeof expected === "string" && expected.startsWith("#")) {
        const r = matchesTypeMarker(actual, expected);
        return r.passed
          ? { passed: false, message: `期望不匹配 ${expected}，但实际匹配了` }
          : { passed: true, message: "" };
      }
      const r = deepEquals(actual, expected);
      return r.passed
        ? { passed: false, message: `期望不等于 ${JSON.stringify(expected)}` }
        : { passed: true, message: "" };
    }

    case "contains": {
      if (typeof expected !== "object" || expected === null) {
        // contains 字符串
        if (typeof actual === "string" && typeof expected === "string") {
          return actual.includes(expected)
            ? { passed: true, message: "" }
            : {
                passed: false,
                message: `字符串 "${actual}" 不包含 "${expected}"`,
              };
        }
        return {
          passed: false,
          message: `contains 需要对象或字符串作为期望值`,
        };
      }
      return containsMatch(actual, expected as Record<string, unknown>);
    }

    default:
      return { passed: false, message: `未知操作符: ${operator}` };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * 解析右值表达式
 * 可能是: 字面量、类型标记(#number)、JSON对象、变量引用
 */
function parseRightValue(expr: string, ctx: ExecutionContext): unknown {
  const trimmed = expr.trim();

  // Karate 类型标记: 以 # 开头且用引号包裹
  // match response.id == '#number'
  if (
    (trimmed.startsWith("'#") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"#') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1); // 去掉引号，保留 #xxx
  }

  // 裸类型标记（不带引号）
  if (trimmed.startsWith("#")) {
    return trimmed;
  }

  // JSON 对象/数组
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      // 先尝试标准 JSON
      return JSON.parse(trimmed);
    } catch {
      // 尝试宽松 JSON（单引号 → 双引号，无引号 key）
      try {
        const relaxed = trimmed
          .replace(/'/g, '"')
          .replace(/(\w+)\s*:/g, '"$1":');
        return JSON.parse(relaxed);
      } catch {
        throw new Error(`无法解析 JSON: ${trimmed}`);
      }
    }
  }

  // 字符串字面量（带引号）
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }

  // 布尔/null
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;

  // 数字
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== "") return num;

  // 变量引用
  return ctx.resolveExpression(trimmed);
}

/**
 * 从步骤参数中提取值（支持引号字符串、数字、变量引用）
 */
function extractValue(raw: string, ctx: ExecutionContext): unknown {
  const trimmed = raw.trim();

  // 带引号的字符串
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    const inner = trimmed.slice(1, -1);
    return ctx.interpolate(inner);
  }

  // 布尔/null
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;

  // 数字
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== "") return num;

  // 变量引用
  return ctx.resolveExpression(trimmed);
}

/**
 * 处理字符串拼接表达式: '/api/user/' + userId
 */
function evaluateConcatExpression(raw: string, ctx: ExecutionContext): string {
  const parts = raw.split("+").map((p) => p.trim());
  return parts.map((part) => String(extractValue(part, ctx))).join("");
}

/**
 * 处理依赖 Playwright 的异步表达式求值 (如 text 和 attribute)
 */
async function evaluateAsyncUIExpression(expr: string, ctx: ExecutionContext): Promise<unknown> {
  if (!ctx.page) {
    throw new Error(`执行 UI 表达式失败，尚未初始化浏览器: ${expr}`);
  }

  // 匹配 text('.selector')
  const textMatch = expr.match(/^text\((['"])(.*?)\1\)$/);
  if (textMatch) {
    return await ctx.page.textContent(textMatch[2]);
  }

  // 匹配 attribute('.selector', 'name')
  const attrMatch = expr.match(/^attribute\((['"])(.*?)\1,\s*(['"])(.*?)\3\)$/);
  if (attrMatch) {
    return await ctx.page.getAttribute(attrMatch[2], attrMatch[4]);
  }

  throw new Error(`未知的异步 UI 表达式: ${expr}`);
}

// ─── Result Helpers ─────────────────────────────────────────────────────────

function ok(keyword: string, text: string): StepResult {
  return { passed: true, keyword, text };
}

function err(keyword: string, text: string, error: string): StepResult {
  return { passed: false, keyword, text, error };
}
