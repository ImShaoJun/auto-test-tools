import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, isAbsolute } from "node:path";

// ─── Tool Handler ───────────────────────────────────────────────────────────

export interface GenerateParams {
  targetPath: string;
  featureContent: string;
}

/**
 * 将 CC 生成的 .feature 文件内容写入磁盘
 */
export async function handleGenerateFeature(
  params: GenerateParams,
  workspaceDir: string
): Promise<string> {
  const { targetPath, featureContent } = params;

  if (!featureContent || featureContent.trim().length === 0) {
    throw new Error("featureContent 不能为空");
  }

  // 解析路径
  const fullPath = isAbsolute(targetPath)
    ? targetPath
    : resolve(workspaceDir, targetPath);

  // 确保目录存在
  mkdirSync(dirname(fullPath), { recursive: true });

  // 写入文件
  writeFileSync(fullPath, featureContent, "utf-8");

  // 统计 Scenario 数量
  const scenarioCount = (featureContent.match(/^\s*Scenario:/gm) || []).length;

  console.error(`[generator] 文件已写入: ${fullPath}`);

  return [
    `✅ Feature 文件已写入: ${targetPath}`,
    `   完整路径: ${fullPath}`,
    `   Scenario 数量: ${scenarioCount}`,
  ].join("\n");
}
