import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { AppConfig } from "../config.js";

export interface WriteFeatureParams {
  targetPath: string;
  content: string;
}

/**
 * 统计 feature 内容中的 Scenario 数量
 */
function countScenarios(featureContent: string): number {
  const matches = featureContent.match(/^\s*Scenario:/gm);
  return matches ? matches.length : 0;
}

export async function handleWriteFeatureFile(
  params: WriteFeatureParams,
  config: AppConfig
): Promise<string> {
  const { targetPath, content } = params;

  if (!targetPath || !content) {
    throw new Error("参数 targetPath 和 content 不能为空");
  }

  // 拼接完整路径
  const fullPath = resolve(
    config.project.root,
    config.project.featureBaseDir,
    targetPath
  );

  // 确保目录存在
  mkdirSync(dirname(fullPath), { recursive: true });

  // 写入文件
  writeFileSync(fullPath, content, "utf-8");

  const scenarioCount = countScenarios(content);

  console.error(`[writer] 文件已写入: ${fullPath}`);

  return [
    `✅ 文件已成功写入: ${config.project.featureBaseDir}/${targetPath}`,
    `   完整路径: ${fullPath}`,
    `   Scenario 数量: ${scenarioCount}`,
  ].join("\n");
}
