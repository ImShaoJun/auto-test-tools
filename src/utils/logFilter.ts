// ─── Log Filter ─────────────────────────────────────────────────────────────
//
// 从 Maven / Karate 的执行输出中提取有用信息，剔除无用的 Java 堆栈行，
// 最终结果截断至 maxLength 字符以内，返回给 LLM 上下文。

const MAX_OUTPUT_LENGTH = 1000;

/**
 * 需要剔除的 Java 堆栈行前缀
 */
const STACK_TRACE_PREFIXES = [
  "\tat java.",
  "\tat javax.",
  "\tat jdk.",
  "\tat org.apache.",
  "\tat com.sun.",
  "\tat sun.",
  "\tat org.junit.",
  "\tat org.maven.",
  "\tat org.codehaus.",
  "\tat org.eclipse.",
];

/**
 * Karate 层面的关键词行——保留这些行
 */
const KARATE_KEYWORDS = [
  "match failed",
  "assert",
  "status",
  "url",
  "path",
  "Error",
  "ERROR",
  "Scenario",
  "Feature",
  "failed",
  "passed",
  ">>> ",
  "<<< ",
  "request:",
  "response:",
  "not equal",
  "not present",
  "not a",
  "expected",
  "actual",
];

/**
 * 判断是否为无用的堆栈行
 */
function isStackTraceLine(line: string): boolean {
  const trimmed = line.trimStart();
  return STACK_TRACE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/**
 * 判断是否为有用的 Karate 相关行
 */
function isKarateRelevantLine(line: string): boolean {
  return KARATE_KEYWORDS.some((keyword) => line.includes(keyword));
}

/**
 * 清洗 Maven/Karate 执行输出日志。
 *
 * 策略：
 * 1. 先剔除所有 Java 框架层堆栈行
 * 2. 再保留包含 Karate 关键词的行
 * 3. 如果过滤后没有内容，回退到返回原始日志的尾部
 * 4. 最终截断至 maxLength 字符
 */
export function filterKarateLog(
  rawOutput: string,
  maxLength: number = MAX_OUTPUT_LENGTH
): string {
  const lines = rawOutput.split("\n");

  // 第一步：剔除堆栈行
  const nonStackLines = lines.filter((line) => !isStackTraceLine(line));

  // 第二步：保留 Karate 相关行
  const relevantLines = nonStackLines.filter(
    (line) => line.trim().length > 0 && isKarateRelevantLine(line)
  );

  let result: string;

  if (relevantLines.length > 0) {
    result = relevantLines.join("\n");
  } else {
    // 回退：返回去除堆栈后的尾部内容
    const fallback = nonStackLines
      .filter((line) => line.trim().length > 0)
      .slice(-30)
      .join("\n");
    result = fallback || rawOutput.slice(-maxLength);
  }

  // 截断
  if (result.length > maxLength) {
    result = "...(日志已截断)\n" + result.slice(result.length - maxLength + 20);
  }

  return result;
}
