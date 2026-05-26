// ─── BDD Feature Runner ─────────────────────────────────────────────────────
//
// 使用 @cucumber/gherkin 解析 .feature 文件为 AST，
// 逐步执行每个 Scenario 中的 Step。

import * as Gherkin from "@cucumber/gherkin";
import * as Messages from "@cucumber/messages";
import { readFileSync } from "node:fs";
import { ExecutionContext } from "./context.js";
import { executeStep, type StepResult } from "./stepExecutor.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ScenarioResult {
  name: string;
  passed: boolean;
  steps: StepResult[];
  error?: string;
}

export interface FeatureResult {
  featureName: string;
  scenarios: ScenarioResult[];
  totalPassed: number;
  totalFailed: number;
}

// ─── Runner ─────────────────────────────────────────────────────────────────

/**
 * 解析并执行一个 .feature 文件
 *
 * @param featureContent - .feature 文件的文本内容
 * @param baseUrl - API 基础 URL
 * @param cookie - 认证 Cookie（可选）
 */
export async function runFeature(
  featureContent: string,
  baseUrl: string,
  cookie?: string
): Promise<FeatureResult> {
  // 解析 Gherkin AST
  const uuidFn = Messages.IdGenerator.uuid();
  const builder = new Gherkin.AstBuilder(uuidFn);
  const matcher = new Gherkin.GherkinClassicTokenMatcher();
  const parser = new Gherkin.Parser(builder, matcher);

  let gherkinDocument: Messages.GherkinDocument;
  try {
    gherkinDocument = parser.parse(featureContent);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      featureName: "(解析失败)",
      scenarios: [
        {
          name: "(解析错误)",
          passed: false,
          steps: [],
          error: `Feature 文件解析失败: ${msg}`,
        },
      ],
      totalPassed: 0,
      totalFailed: 1,
    };
  }

  const feature = gherkinDocument.feature;
  if (!feature) {
    return {
      featureName: "(空文件)",
      scenarios: [],
      totalPassed: 0,
      totalFailed: 0,
    };
  }

  // 提取 Background 步骤（如有）
  let backgroundSteps: readonly Messages.Step[] = [];
  const scenarios: Array<{
    name: string;
    steps: readonly Messages.Step[];
  }> = [];

  for (const child of feature.children) {
    if (child.background) {
      backgroundSteps = child.background.steps;
    }
    if (child.scenario) {
      scenarios.push({
        name: child.scenario.name,
        steps: child.scenario.steps,
      });
    }
  }

  // 逐个执行 Scenario
  const results: ScenarioResult[] = [];

  for (const scenario of scenarios) {
    console.error(`[runner] 执行 Scenario: ${scenario.name}`);

    // 每个 Scenario 创建独立的 Context
    const ctx = new ExecutionContext(baseUrl, cookie);
    const stepResults: StepResult[] = [];
    let scenarioPassed = true;

    // 先执行 Background 步骤
    for (const step of backgroundSteps) {
      const result = await executeStep(
        step.keyword.trim(),
        step.text,
        step.docString?.content,
        ctx
      );
      stepResults.push(result);

      if (!result.passed) {
        scenarioPassed = false;
        break; // Background 失败则跳过后续步骤
      }
    }

    // 再执行 Scenario 步骤（如果 Background 通过）
    if (scenarioPassed) {
      for (const step of scenario.steps) {
        const result = await executeStep(
          step.keyword.trim(),
          step.text,
          step.docString?.content,
          ctx
        );
        stepResults.push(result);

        if (!result.passed) {
          scenarioPassed = false;
          break; // 步骤失败则跳过后续
        }
      }
    }

    results.push({
      name: scenario.name,
      passed: scenarioPassed,
      steps: stepResults,
    });
  }

  const totalPassed = results.filter((r) => r.passed).length;
  const totalFailed = results.filter((r) => !r.passed).length;

  return {
    featureName: feature.name,
    scenarios: results,
    totalPassed,
    totalFailed,
  };
}

/**
 * 从文件路径读取并执行 .feature
 */
export async function runFeatureFile(
  filePath: string,
  baseUrl: string,
  cookie?: string
): Promise<FeatureResult> {
  const content = readFileSync(filePath, "utf-8");
  return runFeature(content, baseUrl, cookie);
}

/**
 * 将 FeatureResult 格式化为人类可读的报告
 */
export function formatResult(result: FeatureResult): string {
  const lines: string[] = [];

  const icon = result.totalFailed === 0 ? "✅" : "❌";
  lines.push(
    `${icon} Feature: ${result.featureName} — ${result.totalPassed} 通过, ${result.totalFailed} 失败`
  );
  lines.push("");

  for (const scenario of result.scenarios) {
    const sIcon = scenario.passed ? "  ✅" : "  ❌";
    lines.push(`${sIcon} Scenario: ${scenario.name}`);

    if (scenario.error) {
      lines.push(`     错误: ${scenario.error}`);
      continue;
    }

    for (const step of scenario.steps) {
      if (step.passed) {
        lines.push(`     ✓ ${step.keyword}${step.text}`);
      } else {
        lines.push(`     ✗ ${step.keyword}${step.text}`);
        if (step.error) {
          lines.push(`       → ${step.error}`);
        }
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}
