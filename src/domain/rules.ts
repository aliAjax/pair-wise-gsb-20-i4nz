// 业务规则（纯函数，无 React、无存储）：
// 1. 视野校准完整性
// 2. 拼接整批校验：标尺缺失 / 倍率不匹配 / 相邻重叠不足 / 坐标缺失 / 坐标重复
// 3. 同一坐标只能归入一个拼接图；方向冲突不得覆盖原图
// 4. 测量按标尺快照换算
// 5. 归档冻结与复核另存

import type {
  AppData,
  FieldOfView,
  Measurement,
  ObjectiveMagnification,
  ScaleSnapshot,
  Stitch,
  StitchEntry,
  StitchVersionSnapshot,
} from "./types";

/** 相邻视野允许的最小重叠率（%） */
export const MIN_OVERLAP_PCT = 20;

// ---------------------------------------------------------------------------
// 1. 视野校准
// ---------------------------------------------------------------------------

export interface Calibration {
  complete: boolean;
  objective: ObjectiveMagnification;
  rulerPixels: number;
  rulerMicrons: number;
  umPerPixel: number;
}

/** 标尺完整且数值合法时给出换算关系，否则为 null（标尺缺失即未校准） */
export function getCalibration(fov: FieldOfView): Calibration | null {
  const { objective, rulerPixels, rulerMicrons } = fov;
  if (
    objective === null ||
    rulerPixels === null ||
    rulerMicrons === null ||
    !Number.isFinite(rulerPixels) ||
    !Number.isFinite(rulerMicrons) ||
    rulerPixels <= 0 ||
    rulerMicrons <= 0
  ) {
    return null;
  }
  return {
    complete: true,
    objective,
    rulerPixels,
    rulerMicrons,
    umPerPixel: rulerMicrons / rulerPixels,
  };
}

export function isFovCalibrated(fov: FieldOfView): boolean {
  return getCalibration(fov) !== null && fov.coord !== null;
}

// ---------------------------------------------------------------------------
// 2. 拼接整批校验
// ---------------------------------------------------------------------------

export type RejectCode =
  | "MISSING_RULER" // 标尺缺失（倍率 / 像素标尺 / 微米值任一缺失）
  | "MISSING_COORD" // 坐标缺失
  | "OBJECTIVE_MISMATCH" // 倍率与拼接目标倍率不匹配
  | "OVERLAP_INSUFFICIENT" // 相邻视野重叠不足
  | "COORD_DUPLICATE_IN_BATCH" // 批内坐标重复
  | "COORD_OWNED_BY_OTHER" // 同一坐标已归入另一拼接图
  | "ORIENTATION_CONFLICT"; // 方向冲突（不得覆盖原图）

export interface FieldRejection {
  fovId: string;
  fovLabel: string;
  reasons: { code: RejectCode; detail: string }[];
}

export interface BatchItemInput {
  fovId: string;
  overlapPct: number | null;
}

export interface BatchCheckResult {
  accepted: boolean;
  rejections: FieldRejection[];
}

interface BatchContext {
  data: AppData;
  slideId: string;
  objective: ObjectiveMagnification;
  /** 追加视野时，允许复用该拼接图自身已有的坐标 */
  appendToStitchId?: string;
  /** 修订时允许复用其（归档）血缘版本的坐标 */
  revisionLineageIds?: string[];
}

function coordKey(x: number, y: number): string {
  return `${x};${y}`;
}

/** 坐标当前归属的拼接图；排除追加目标自身与修订血缘的历史版本 */
export function coordOwnerStitch(
  data: AppData,
  slideId: string,
  x: number,
  y: number,
  exemptIds: string[] = [],
): Stitch | null {
  const key = coordKey(x, y);
  for (const stitch of data.stitches) {
    if (stitch.slideId !== slideId || exemptIds.includes(stitch.id)) continue;
    for (const entry of stitch.entries) {
      const fov = data.fields.find((f) => f.id === entry.fovId);
      if (fov?.coord && coordKey(fov.coord.x, fov.coord.y) === key) {
        return stitch;
      }
    }
  }
  return null;
}

function rejectionMap(rejections: Map<string, FieldRejection>, fov: FieldOfView) {
  let entry = rejections.get(fov.id);
  if (!entry) {
    entry = { fovId: fov.id, fovLabel: fov.label, reasons: [] };
    rejections.set(fov.id, entry);
  }
  return entry;
}

/**
 * 整批校验：任一条规则不通过即整批拒绝，并逐视野列出原因。
 * 顺序即拼接顺序，第二项起必须有 ≥ MIN_OVERLAP_PCT 的相邻重叠。
 */
export function checkBatch(
  items: BatchItemInput[],
  ctx: BatchContext,
): BatchCheckResult {
  const rejections = new Map<string, FieldRejection>();

  if (items.length === 0) {
    return { accepted: false, rejections: [] };
  }

  const exemptIds = [
    ...(ctx.appendToStitchId ? [ctx.appendToStitchId] : []),
    ...(ctx.revisionLineageIds ?? []),
  ];

  const seenCoord = new Map<string, string>(); // coordKey -> fovId
  const orientations = new Map<string, string>(); // coordKey -> orientation

  items.forEach((item, index) => {
    const fov = ctx.data.fields.find((f) => f.id === item.fovId);
    if (!fov) return;

    // 标尺 / 倍率登记缺失
    if (fov.objective === null || fov.rulerPixels === null || fov.rulerMicrons === null) {
      rejectionMap(rejections, fov).reasons.push({
        code: "MISSING_RULER",
        detail: "标尺缺失：须登记物镜倍率、像素标尺与微米值",
      });
    }
    if (fov.coord === null) {
      rejectionMap(rejections, fov).reasons.push({
        code: "MISSING_COORD",
        detail: "载物台坐标缺失，无法定位拼接位置",
      });
    }
    // 倍率与拼接目标不匹配
    if (fov.objective !== null && fov.objective !== ctx.objective) {
      rejectionMap(rejections, fov).reasons.push({
        code: "OBJECTIVE_MISMATCH",
        detail: `视野倍率 ${fov.objective}x 与拼接图倍率 ${ctx.objective}x 不匹配`,
      });
    }
    // 相邻视野重叠不足（首视野无前邻，不检查）
    if (index > 0) {
      if (
        item.overlapPct === null ||
        !Number.isFinite(item.overlapPct) ||
        item.overlapPct < MIN_OVERLAP_PCT
      ) {
        const prev = ctx.data.fields.find((f) => f.id === items[index - 1].fovId);
        rejectionMap(rejections, fov).reasons.push({
          code: "OVERLAP_INSUFFICIENT",
          detail: `与相邻视野 ${prev?.label ?? `#${index}`} 重叠不足：需 ≥ ${MIN_OVERLAP_PCT}%（当前 ${
            item.overlapPct === null ? "未填写" : `${item.overlapPct}%`
          }）`,
        });
      }
    }

    if (fov.coord !== null) {
      const key = coordKey(fov.coord.x, fov.coord.y);

      // 同一坐标在批内重复
      const earlier = seenCoord.get(key);
      if (earlier && earlier !== fov.id) {
        rejectionMap(rejections, fov).reasons.push({
          code: "COORD_DUPLICATE_IN_BATCH",
          detail: `坐标 (${fov.coord.x}, ${fov.coord.y}) 在批内与视野 ${earlier} 重复`,
        });
      } else {
        seenCoord.set(key, fov.id);
      }

      // 同一坐标只能归入一个拼接图；同时核对与原图的方向是否冲突
      const owner = coordOwnerStitch(
        ctx.data,
        ctx.slideId,
        fov.coord.x,
        fov.coord.y,
        exemptIds,
      );
      if (owner) {
        rejectionMap(rejections, fov).reasons.push({
          code: "COORD_OWNED_BY_OTHER",
          detail: `坐标 (${fov.coord.x}, ${fov.coord.y}) 已归入拼接图「${owner.title}」，同一坐标不得重复归属`,
        });
        // 方向冲突不得覆盖原图：与已占用该坐标的原视野方向不同即拒绝
        const originalFovId = owner.entries.find((e) => {
          const of = ctx.data.fields.find((f) => f.id === e.fovId);
          return of?.coord && coordKey(of.coord.x, of.coord.y) === key;
        })?.fovId;
        const original = ctx.data.fields.find((of) => of.id === originalFovId);
        if (original && original.orientation !== fov.orientation) {
          rejectionMap(rejections, fov).reasons.push({
            code: "ORIENTATION_CONFLICT",
            detail: `坐标 (${fov.coord.x}, ${fov.coord.y}) 原图方向为「${original.orientation}」，新方向「${fov.orientation}」冲突，禁止覆盖原图`,
          });
        }
      }

      // 批内同坐标出现不同方向也拒绝
      const seenOrientation = orientations.get(key);
      if (seenOrientation && seenOrientation !== fov.orientation) {
        rejectionMap(rejections, fov).reasons.push({
          code: "ORIENTATION_CONFLICT",
          detail: `坐标 (${fov.coord.x}, ${fov.coord.y}) 在批内存在方向冲突，禁止以新方向覆盖原图`,
        });
      } else {
        orientations.set(key, fov.orientation);
      }
    }
  });

  return {
    accepted: rejections.size === 0,
    rejections: Array.from(rejections.values()),
  };
}

// ---------------------------------------------------------------------------
// 3. 测量：按标尺快照换算
// ---------------------------------------------------------------------------

/** 测量保存瞬间冻结标尺快照；之后调整倍率/标尺不改已保存结果 */
export function captureScaleSnapshot(
  fov: FieldOfView,
  now: number,
): ScaleSnapshot | null {
  const cal = getCalibration(fov);
  if (!cal) return null;
  return {
    objective: fov.objective as ObjectiveMagnification,
    rulerPixels: cal.rulerPixels,
    rulerMicrons: cal.rulerMicrons,
    umPerPixel: cal.umPerPixel,
    capturedAt: now,
  };
}

export function convertMeasurement(
  pixelLength: number,
  snapshot: ScaleSnapshot,
): number {
  return pixelLength * snapshot.umPerPixel;
}

/** 测量前提：视野已校准，且不属于已冻结（归档）拼接图 */
export function measurementBlockedReason(
  data: AppData,
  fov: FieldOfView,
): string | null {
  if (!getCalibration(fov)) return "视野标尺缺失，无法测量";
  const stitch = findStitchOfFov(data, fov.id);
  if (stitch?.status === "archived") {
    return "所属拼接图已归档冻结，测量不可新增或修改";
  }
  return null;
}

export function findStitchOfFov(data: AppData, fovId: string): Stitch | null {
  return data.stitches.find((s) => s.entries.some((e) => e.fovId === fovId)) ?? null;
}

// ---------------------------------------------------------------------------
// 4. 归档冻结与复核另存
// ---------------------------------------------------------------------------

export function isStitchFrozen(stitch: Stitch): boolean {
  return stitch.status === "archived";
}

export function isFovFrozen(data: AppData, fovId: string): boolean {
  return findStitchOfFov(data, fovId)?.status === "archived";
}

/** 归档前确认其全部视野仍满足完整性，避免把坏数据冻结 */
export function archiveBlockedReasons(data: AppData, stitch: Stitch): string[] {
  if (isStitchFrozen(stitch)) return ["拼接图已归档，不能重复归档"];
  const reasons: string[] = [];
  if (stitch.entries.length === 0) {
    reasons.push("拼接图不含任何视野");
  }
  stitch.entries.forEach((entry, index) => {
    const fov = data.fields.find((f) => f.id === entry.fovId);
    if (!fov) {
      reasons.push(`第 ${index + 1} 个视野已不存在`);
      return;
    }
    if (!getCalibration(fov)) {
      reasons.push(`视野「${fov.label}」标尺缺失`);
    }
    if (fov.objective !== stitch.objective) {
      reasons.push(`视野「${fov.label}」倍率与拼接图不匹配`);
    }
    // 首视野无前邻；其余必须有达标重叠链
    if (index > 0) {
      if (
        entry.overlapPct === null ||
        !Number.isFinite(entry.overlapPct) ||
        entry.overlapPct < MIN_OVERLAP_PCT
      ) {
        reasons.push(
          `视野「${fov.label}」与前一视野重叠不足（需 ≥ ${MIN_OVERLAP_PCT}%）`,
        );
      }
    }
  });
  return reasons;
}

/** 生成旧版本快照：复核只另存，不动冻结原件 */
export function snapshotStitch(
  data: AppData,
  stitch: Stitch,
  savedAt: number,
): StitchVersionSnapshot {
  const fovIds = new Set(stitch.entries.map((e: StitchEntry) => e.fovId));
  return {
    savedAt,
    stitch: JSON.parse(JSON.stringify(stitch)) as Stitch,
    fields: data.fields.filter((f) => fovIds.has(f.id)).map((f) => ({ ...f })),
    measurements: data.measurements
      .filter((m: Measurement) => m.stitchId === stitch.id)
      .map((m) => ({ ...m })),
  };
}

export function reviewBlockedReason(stitch: Stitch): string | null {
  if (!isStitchFrozen(stitch)) return "仅归档后的拼接图需要复核另存";
  return null;
}
