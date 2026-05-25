import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type { AppConfig } from "../config.js";
import { getCookie } from "../auth/cookieManager.js";
import { filterKarateLog } from "../utils/logFilter.js";

// ─── KarateRunner Auto-Generation ───────────────────────────────────────────

const KARATE_RUNNER_TEMPLATE = `import com.intuit.karate.junit5.Karate;

class KarateRunner {
    @Karate.Test
    Karate testAll() {
        return Karate.run().relativeTo(getClass());
    }
}
`;

/**
 * 检查 KarateRunner.java 是否存在，不存在则自动生成
 */
function ensureKarateRunner(config: AppConfig): void {
  const runnerPath = resolve(
    config.project.root,
    "src",
    "test",
    "java",
    `${config.project.karateRunnerClass}.java`
  );

  if (existsSync(runnerPath)) {
    console.error(`[executor] KarateRunner 已存在: ${runnerPath}`);
    return;
  }

  console.error(`[executor] KarateRunner 不存在，正在自动生成: ${runnerPath}`);
  mkdirSync(resolve(runnerPath, ".."), { recursive: true });
  writeFileSync(runnerPath, KARATE_RUNNER_TEMPLATE, "utf-8");
  console.error(`[executor] KarateRunner 已生成`);
}

// ─── Maven Execution ────────────────────────────────────────────────────────

interface MavenResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runMaven(
  config: AppConfig,
  featurePath: string,
  cookieValue: string
): Promise<MavenResult> {
  return new Promise((resolvePromise, reject) => {
    const args = [
      "clean",
      "test",
      `-Dtest=${config.project.karateRunnerClass}`,
      `-Dkarate.options=classpath:${featurePath}`,
      `-Dkarate.env.cookie=${cookieValue}`,
    ];

    console.error(
      `[executor] 执行: ${config.executor.mvnCommand} ${args.join(" ")}`
    );
    console.error(`[executor] 工作目录: ${config.project.root}`);

    const child = spawn(config.executor.mvnCommand, args, {
      cwd: config.project.root,
      shell: true,
      timeout: config.executor.timeoutSeconds * 1000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      reject(
        new Error(
          `Maven 进程启动失败: ${err.message}\n请确认 "${config.executor.mvnCommand}" 命令可用且 Java 项目路径正确。`
        )
      );
    });

    child.on("close", (code) => {
      resolvePromise({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

// ─── Karate Report Reader ───────────────────────────────────────────────────

function readKarateReport(config: AppConfig): string | null {
  const reportPath = resolve(
    config.project.root,
    config.project.karateReportsDir,
    "karate-summary-json.txt"
  );

  if (!existsSync(reportPath)) {
    return null;
  }

  try {
    return readFileSync(reportPath, "utf-8");
  } catch {
    return null;
  }
}

// ─── Tool Handler ───────────────────────────────────────────────────────────

export interface ExecuteParams {
  featurePath: string;
}

export async function handleExecuteKarateAndParse(
  params: ExecuteParams,
  config: AppConfig
): Promise<string> {
  const { featurePath } = params;

  // Step 0: 确保 KarateRunner 存在
  ensureKarateRunner(config);

  // Step 1: 获取 Cookie
  console.error("[executor] Step 1: 获取认证 Cookie...");
  let cookieValue: string;
  try {
    cookieValue = await getCookie(config);
  } catch (err) {
    return `❌ 认证失败: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Step 2: 执行 Maven
  console.error("[executor] Step 2: 执行 Maven 测试...");
  let result: MavenResult;
  try {
    result = await runMaven(config, featurePath, cookieValue);
  } catch (err) {
    return `❌ Maven 执行异常: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Step 3: 结果解析
  console.error(
    `[executor] Step 3: 解析结果 (Exit Code: ${result.exitCode})...`
  );

  if (result.exitCode === 0) {
    return "✅ 所有 Scenario 通过";
  }

  // 失败场景：组合日志源
  const logSources: string[] = [];

  // 尝试读取 Karate 报告
  const report = readKarateReport(config);
  if (report) {
    logSources.push("=== Karate Report ===\n" + report);
  }

  // 合并 stdout + stderr
  const combinedOutput = [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n");

  if (combinedOutput) {
    logSources.push("=== Maven Output ===\n" + combinedOutput);
  }

  const rawLog = logSources.join("\n\n");
  const filteredLog = filterKarateLog(rawLog);

  return `❌ 测试失败 (Exit Code: ${result.exitCode})\n\n${filteredLog}`;
}
