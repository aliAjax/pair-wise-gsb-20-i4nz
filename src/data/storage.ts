import type { AppData } from "../domain/types";
import { createSeedData } from "./seed";

// 持久化层：只管读写 localStorage 与结构校验，不包含业务规则。
const STORAGE_KEY = "hxwl-06.calibration-station.v1";

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSeedData();
    const parsed = JSON.parse(raw) as Partial<AppData>;
    if (
      !parsed ||
      !Array.isArray(parsed.slides) ||
      !Array.isArray(parsed.fields) ||
      !Array.isArray(parsed.stitches) ||
      !Array.isArray(parsed.measurements) ||
      !Array.isArray(parsed.reviews)
    ) {
      return createSeedData();
    }
    return parsed as AppData;
  } catch {
    // 数据损坏时回退示例数据，保证刷新后状态可用
    return createSeedData();
  }
}

export function saveData(data: AppData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // 存储不可用（隐私模式 / 配额）时静默降级：本会话状态仍一致
  }
}

export function resetData(): AppData {
  const seed = createSeedData();
  saveData(seed);
  return seed;
}
