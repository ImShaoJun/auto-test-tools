import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export class LocatorMapper {
  private locators: Record<string, Record<string, string>> = {};

  constructor(workspaceDir: string) {
    const locatorsPath = resolve(workspaceDir, "locators.json");
    if (existsSync(locatorsPath)) {
      try {
        const content = readFileSync(locatorsPath, "utf-8");
        this.locators = JSON.parse(content);
      } catch (e) {
        console.error(`[locatorMapper] 解析 locators.json 失败: ${e}`);
      }
    } else {
      console.warn(`[locatorMapper] 未找到 locators.json: ${locatorsPath}`);
    }
  }

  public get(namespaceKey: string, params: Record<string, string> = {}): string {
    const parts = namespaceKey.split(".");
    if (parts.length !== 2) {
      throw new Error(`[Cache Miss] 无效的 Locator 标识符格式: ${namespaceKey}，期望 Namespace.Key`);
    }

    const [namespace, key] = parts;
    const nsObj = this.locators[namespace];
    if (!nsObj || !(key in nsObj)) {
      throw new Error(`[Cache Miss] locators.json 中未找到对应的键: ${namespaceKey}`);
    }

    let locatorStr = nsObj[key];
    
    // 参数插值
    for (const [k, v] of Object.entries(params)) {
      const regex = new RegExp(`\\{${k}\\}`, "g");
      locatorStr = locatorStr.replace(regex, v);
    }

    return locatorStr;
  }
}
