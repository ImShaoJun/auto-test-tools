// ─── Karate-Style Matchers ──────────────────────────────────────────────────
//
// 实现 Karate DSL 中的类型标记匹配器，如 #number, #string, #[_ > 0] 等。

/**
 * 判断一个值是否匹配 Karate 类型标记
 *
 * 支持的标记:
 *   #number    - typeof === 'number'
 *   #string    - typeof === 'string'
 *   #boolean   - typeof === 'boolean'
 *   #array     - Array.isArray
 *   #object    - 非空非数组对象
 *   #notnull   - !== null && !== undefined
 *   #null      - === null || === undefined
 *   #present   - 存在（同 #notnull）
 *   #notpresent - 不存在（同 #null）
 *   #ignore    - 始终通过
 *   #uuid      - UUID 格式
 *   #[_ > 0]   - 数组长度断言
 *   #regex <pattern> - 正则匹配
 */
export function matchesTypeMarker(actual: unknown, marker: string): MatchResult {
  switch (marker) {
    case "#number":
      return typeof actual === "number"
        ? pass()
        : fail(`期望类型 number，实际: ${typeDesc(actual)}`);

    case "#string":
      return typeof actual === "string"
        ? pass()
        : fail(`期望类型 string，实际: ${typeDesc(actual)}`);

    case "#boolean":
      return typeof actual === "boolean"
        ? pass()
        : fail(`期望类型 boolean，实际: ${typeDesc(actual)}`);

    case "#array":
      return Array.isArray(actual)
        ? pass()
        : fail(`期望类型 array，实际: ${typeDesc(actual)}`);

    case "#object":
      return typeof actual === "object" &&
        actual !== null &&
        !Array.isArray(actual)
        ? pass()
        : fail(`期望类型 object，实际: ${typeDesc(actual)}`);

    case "#notnull":
    case "#present":
      return actual !== null && actual !== undefined
        ? pass()
        : fail(`期望非空值，实际: ${String(actual)}`);

    case "#null":
    case "#notpresent":
      return actual === null || actual === undefined
        ? pass()
        : fail(`期望 null/undefined，实际: ${JSON.stringify(actual)}`);

    case "#ignore":
      return pass();

    case "#uuid":
      return typeof actual === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          actual
        )
        ? pass()
        : fail(`期望 UUID 格式，实际: ${JSON.stringify(actual)}`);

    default:
      // #[_ > 0] — 数组长度断言
      if (marker.startsWith("#[") && marker.endsWith("]")) {
        return matchArrayLength(actual, marker);
      }

      // #regex <pattern>
      if (marker.startsWith("#regex ")) {
        return matchRegex(actual, marker.substring(7));
      }

      return fail(`未知的类型标记: ${marker}`);
  }
}

/**
 * 比较两个值是否相等（深度比较）
 */
export function deepEquals(actual: unknown, expected: unknown): MatchResult {
  // 类型标记
  if (typeof expected === "string" && expected.startsWith("#")) {
    return matchesTypeMarker(actual, expected);
  }

  // 严格相等
  if (actual === expected) return pass();

  // null 检查
  if (actual == null || expected == null) {
    return fail(
      `期望: ${JSON.stringify(expected)}，实际: ${JSON.stringify(actual)}`
    );
  }

  // 数组比较
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return fail(`期望数组，实际: ${typeDesc(actual)}`);
    }
    if (actual.length !== expected.length) {
      return fail(
        `数组长度不匹配: 期望 ${expected.length}，实际 ${actual.length}`
      );
    }
    for (let i = 0; i < expected.length; i++) {
      const r = deepEquals(actual[i], expected[i]);
      if (!r.passed) {
        return fail(`数组索引 [${i}]: ${r.message}`);
      }
    }
    return pass();
  }

  // 对象比较
  if (typeof expected === "object" && typeof actual === "object") {
    const expObj = expected as Record<string, unknown>;
    const actObj = actual as Record<string, unknown>;
    for (const key of Object.keys(expObj)) {
      const r = deepEquals(actObj[key], expObj[key]);
      if (!r.passed) {
        return fail(`字段 "${key}": ${r.message}`);
      }
    }
    return pass();
  }

  // 类型不同或值不同
  return fail(
    `期望: ${JSON.stringify(expected)}，实际: ${JSON.stringify(actual)}`
  );
}

/**
 * contains 匹配：actual 对象包含 expected 中的所有 key-value
 */
export function containsMatch(
  actual: unknown,
  expected: Record<string, unknown>
): MatchResult {
  if (typeof actual !== "object" || actual === null) {
    return fail(`期望对象以进行 contains 匹配，实际: ${typeDesc(actual)}`);
  }

  const actObj = actual as Record<string, unknown>;
  for (const [key, expVal] of Object.entries(expected)) {
    const r = deepEquals(actObj[key], expVal);
    if (!r.passed) {
      return fail(`contains 匹配失败 - 字段 "${key}": ${r.message}`);
    }
  }
  return pass();
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

export interface MatchResult {
  passed: boolean;
  message: string;
}

function pass(): MatchResult {
  return { passed: true, message: "" };
}

function fail(message: string): MatchResult {
  return { passed: false, message };
}

function typeDesc(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `array (length=${value.length})`;
  return `${typeof value} (${JSON.stringify(value).slice(0, 100)})`;
}

/**
 * 处理 #[_ > 0] 风格的数组长度断言
 */
function matchArrayLength(actual: unknown, marker: string): MatchResult {
  if (!Array.isArray(actual)) {
    return fail(`期望数组以进行长度断言，实际: ${typeDesc(actual)}`);
  }

  const expr = marker.slice(2, -1).trim(); // e.g., "_ > 0"
  const m = expr.match(/^_\s*(>|>=|<|<=|==|!=)\s*(\d+)$/);
  if (!m) {
    return fail(`无法解析数组长度表达式: ${marker}`);
  }

  const [, op, numStr] = m;
  const num = parseInt(numStr, 10);
  const len = actual.length;

  let result = false;
  switch (op) {
    case ">":  result = len > num; break;
    case ">=": result = len >= num; break;
    case "<":  result = len < num; break;
    case "<=": result = len <= num; break;
    case "==": result = len === num; break;
    case "!=": result = len !== num; break;
  }

  return result
    ? pass()
    : fail(`数组长度 ${len} 不满足 ${op} ${num}`);
}

/**
 * 正则匹配
 */
function matchRegex(actual: unknown, pattern: string): MatchResult {
  if (typeof actual !== "string") {
    return fail(`正则匹配要求 string 类型，实际: ${typeDesc(actual)}`);
  }

  try {
    const regex = new RegExp(pattern);
    return regex.test(actual)
      ? pass()
      : fail(`值 "${actual}" 不匹配正则 /${pattern}/`);
  } catch (e) {
    return fail(`无效的正则表达式: ${pattern}`);
  }
}
