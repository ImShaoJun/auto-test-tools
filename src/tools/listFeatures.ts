import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import type { AppConfig } from "../config.js";

export interface ListFeaturesParams {
  subDir?: string;
}

interface FeatureInfo {
  relativePath: string;
  scenarioCount: number;
}

function scanDir(dirPath: string, baseDir: string, results: FeatureInfo[]): void {
  if (!existsSync(dirPath)) return;
  
  const entries = readdirSync(dirPath);
  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory()) {
      scanDir(fullPath, baseDir, results);
    } else if (stat.isFile() && entry.endsWith(".feature")) {
      const content = readFileSync(fullPath, "utf-8");
      const matches = content.match(/^\s*Scenario:/gm);
      const scenarioCount = matches ? matches.length : 0;
      
      results.push({
        relativePath: relative(baseDir, fullPath).replace(/\\/g, "/"),
        scenarioCount,
      });
    }
  }
}

export async function handleListFeatures(
  params: ListFeaturesParams,
  config: AppConfig
): Promise<string> {
  const { subDir = "" } = params;

  const baseDir = resolve(config.project.root, config.project.featureBaseDir);
  const targetDir = subDir ? join(baseDir, subDir) : baseDir;

  if (!existsSync(targetDir)) {
    return `目录不存在: ${targetDir}`;
  }

  console.error(`[listFeatures] 扫描目录: ${targetDir}`);

  const results: FeatureInfo[] = [];
  scanDir(targetDir, baseDir, results);

  if (results.length === 0) {
    return `在 ${subDir || "根目录"} 下未找到任何 .feature 文件`;
  }

  // 按路径排序
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  let output = `找到 ${results.length} 个 feature 文件:\n\n`;
  for (const info of results) {
    output += `  ${info.relativePath.padEnd(40)} (${info.scenarioCount} Scenarios)\n`;
  }

  return output;
}
