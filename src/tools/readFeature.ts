import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppConfig } from "../config.js";

export interface ReadFeatureParams {
  featurePath: string;
}

export async function handleReadFeature(
  params: ReadFeatureParams,
  config: AppConfig
): Promise<string> {
  const { featurePath } = params;

  if (!featurePath) {
    throw new Error("参数 featurePath 不能为空");
  }

  const fullPath = resolve(
    config.project.root,
    config.project.featureBaseDir,
    featurePath
  );

  if (!existsSync(fullPath)) {
    return `❌ 文件不存在: ${featurePath} (完整路径: ${fullPath})`;
  }

  console.error(`[readFeature] 读取文件: ${fullPath}`);

  try {
    const content = readFileSync(fullPath, "utf-8");
    
    // 如果文件过大，截断处理
    const MAX_LENGTH = 5000;
    if (content.length > MAX_LENGTH) {
      return content.slice(0, MAX_LENGTH) + "\n\n... (文件过长，已截断)";
    }
    
    return content;
  } catch (err) {
    throw new Error(`读取文件失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}
