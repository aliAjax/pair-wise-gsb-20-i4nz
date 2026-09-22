// ─────────────────────────────────────────────────────────────
// 规则层：标尺校准与测量换算（纯函数，无界面依赖）
// ─────────────────────────────────────────────────────────────

import type { CalibrationSnapshot, Fov } from "../types";

/** 标尺是否完整登记：像素标尺与微米值缺一不可，且必须为正数 */
export function isCalibrated(fov: Fov): boolean {
  return (
    typeof fov.scalePixels === "number" &&
    typeof fov.scaleMicrons === "number" &&
    fov.scalePixels > 0 &&
    fov.scaleMicrons > 0
  );
}

/** 微米 / 像素。标尺缺失时返回 null，禁止换算 */
export function micronsPerPixel(
  scalePixels: number | null,
  scaleMicrons: number | null
): number | null {
  if (
    typeof scalePixels !== "number" ||
    typeof scaleMicrons !== "number" ||
    scalePixels <= 0 ||
    scaleMicrons <= 0
  ) {
    return null;
  }
  return scaleMicrons / scalePixels;
}

/**
 * 接受校准：测量只接受“标尺快照”，之后调整倍率 / 标尺不影响已保存结果。
 */
export function acceptCalibration(
  fov: Fov,
  now: number = Date.now()
): CalibrationSnapshot | null {
  const factor = micronsPerPixel(fov.scalePixels, fov.scaleMicrons);
  if (factor === null) return null;
  return {
    objective: fov.objective,
    scalePixels: fov.scalePixels as number,
    scaleMicrons: fov.scaleMicrons as number,
    micronsPerPixel: factor,
    acceptedAt: now,
  };
}

export interface ConvertResult {
  microns: number;
  snapshot: CalibrationSnapshot;
}

/** 按快照换算像素长度 → 微米长度（结果保留 3 位小数） */
export function convertWithSnapshot(
  fov: Fov,
  lengthPixels: number,
  now: number = Date.now()
): ConvertResult | null {
  if (!(lengthPixels > 0)) return null;
  const snapshot = acceptCalibration(fov, now);
  if (!snapshot) return null;
  return {
    microns: round3(lengthPixels * snapshot.micronsPerPixel),
    snapshot,
  };
}

/**
 * 已保存测量所依据的快照，是否与视野当前登记不一致。
 * 不一致仅做“标尺已更新”提示，不回改、不重算已保存结果。
 */
export function isSnapshotStale(fov: Fov, snapshot: CalibrationSnapshot): boolean {
  return (
    fov.objective !== snapshot.objective ||
    fov.scalePixels !== snapshot.scalePixels ||
    fov.scaleMicrons !== snapshot.scaleMicrons
  );
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
