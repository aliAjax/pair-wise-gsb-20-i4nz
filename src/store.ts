// ─────────────────────────────────────────────────────────────
// 数据层：集中状态、localStorage 持久化、归档冻结与复核版本
//
// 关键不变式（由本层保证，界面层不得绕过）：
//   · 测量只在创建时换算一次，结果与标尺快照一并冻结
//   · active 拼接图接受后不可改；archive 后冻结，只能复核另存
//   · 复核派生新版本（versionNo 递增），旧版本转 history 保留
//   · 拒绝整批不留任何拼接结果，只在 rejections 留痕
// ─────────────────────────────────────────────────────────────

import type {
  BenchState,
  Fov,
  Measurement,
  MosaicVersion,
  Rejection,
} from "./types";
import { convertWithSnapshot } from "./rules/calibration";
import { validateStitchBatch, type BatchRequest } from "./rules/stitching";

const STORAGE_KEY = "stitch-bench-state-v1";

let seq = 0;
/** 生成带时间戳的本地唯一 id */
export function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

// ── 初始示例数据（校准齐全，便于直接演示）─────────────────────
function seed(): BenchState {
  const fovs: Fov[] = [
    { id: "F-洋葱-A", slide: "洋葱表皮", objective: 400, scalePixels: 120, scaleMicrons: 50, note: "左上视野" },
    { id: "F-洋葱-B", slide: "洋葱表皮", objective: 400, scalePixels: 120, scaleMicrons: 50, note: "右侧相邻" },
    { id: "F-洋葱-C", slide: "洋葱表皮", objective: 400, scalePixels: 120, scaleMicrons: 50, note: "下方相邻" },
    { id: "F-血涂片-1", slide: "人血涂片", objective: 1000, scalePixels: 256, scaleMicrons: 20, note: "密集区" },
    { id: "F-血涂片-2", slide: "人血涂片", objective: 1000, scalePixels: 256, scaleMicrons: 20, note: "稀疏区" },
    { id: "F-草履虫-1", slide: "草履虫", objective: 200, scalePixels: null, scaleMicrons: null, note: "标尺待登记" },
    { id: "F-草履虫-2", slide: "草履虫", objective: 400, scalePixels: 90, scaleMicrons: 80, note: "误登记为400x" },
  ];
  return { fovs, measurements: [], mosaics: [], rejections: [] };
}

export function loadState(): BenchState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as BenchState;
      if (parsed && Array.isArray(parsed.fovs)) return parsed;
    }
  } catch {
    // 持久化损坏时回落到种子数据
  }
  return seed();
}

export function saveState(state: BenchState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时仅影响刷新持久化，内存状态仍一致
  }
}

// ── 变更动作：每个动作返回新状态（不可变更新）────────────────

export function upsertFov(state: BenchState, fov: Fov): BenchState {
  const idx = state.fovs.findIndex((f) => f.id === fov.id);
  const fovs =
    idx >= 0
      ? state.fovs.map((f) => (f.id === fov.id ? fov : f))
      : [...state.fovs, fov];
  return { ...state, fovs };
}

/**
 * 创建测量：此刻接受标尺快照并换算。之后修改视野倍率 / 标尺
 * 都不影响已保存结果（结果与快照在同一对象内冻结）。
 */
export function addMeasurement(
  state: BenchState,
  input: { fovId: string; label: string; lengthPixels: number; now?: number }
): { state: BenchState; error?: string } {
  const fov = state.fovs.find((f) => f.id === input.fovId);
  if (!fov) return { state, error: "视野不存在" };

  const converted = convertWithSnapshot(
    fov,
    input.lengthPixels,
    input.now ?? Date.now()
  );
  if (!converted) {
    return {
      state,
      error: "标尺缺失或测量长度无效，无法换算（像素标尺与微米值必须为正数）",
    };
  }

  const measurement: Measurement = {
    id: uid("M"),
    fovId: input.fovId,
    label: input.label || "未命名测量",
    lengthPixels: input.lengthPixels,
    lengthMicrons: converted.microns,
    snapshot: converted.snapshot,
    createdAt: input.now ?? Date.now(),
  };
  const newState: BenchState = {
    ...state,
    measurements: [...state.measurements, measurement],
  };
  return { state: newState };
}

export interface StitchOutcome {
  state: BenchState;
  mosaic?: MosaicVersion;
  rejection?: Rejection;
}

/**
 * 提交拼接批次：规则通过 → 生成 active 拼接图；
 * 任一规则失败 → 整批拒绝，返回 rejection 留痕，不产生拼接图。
 */
export function submitStitchBatch(
  prev: BenchState,
  request: BatchRequest,
  now: number = Date.now()
): StitchOutcome {
  const result = validateStitchBatch(request, prev.fovs, prev.mosaics);

  if (!result.ok) {
    const batchNo = prev.rejections.length + 1;
    const rejection: Rejection = {
      id: uid("R"),
      batchNo,
      slide: request.slide,
      objective: request.objective,
      requested: result.placements.length
        ? result.placements
        : request.placements.map((p) => ({
            fovId: p.fovId,
            x: 0,
            y: 0,
            dir: p.dir,
            refFovId: p.refFovId,
          })),
      overlap: request.overlap,
      reasons: result.reasons,
      perField: result.perField,
      createdAt: now,
    };
    return { state: { ...prev, rejections: [...prev.rejections, rejection] }, rejection };
  }

  const group = uid("G");
  const mosaic: MosaicVersion = {
    id: uid("MOS"),
    group,
    versionNo: 1,
    slide: request.slide,
    objective: request.objective,
    overlap: request.overlap,
    placements: result.placements,
    status: "active",
    createdAt: now,
  };
  return {
    state: { ...prev, mosaics: [...prev.mosaics, mosaic] },
    mosaic,
  };
}

/** 归档：active → archived，冻结拼接内容与测量，不可再编辑 */
export function archiveMosaic(
  state: BenchState,
  mosaicId: string,
  now: number = Date.now()
): BenchState {
  return {
    ...state,
    mosaics: state.mosaics.map((m) =>
      m.id === mosaicId && m.status === "active"
        ? { ...m, status: "archived", archivedAt: now }
        : m
    ),
  };
}

/**
 * 复核另存：基于一张已冻结（archived）拼接图派生新版本。
 * 旧版本转 history 原样保留，新版本 status=active、versionNo+1，
 * 必须填写复核原因。新批次仍走完整规则校验。
 */
export function reviewMosaic(
  prev: BenchState,
  basedOnId: string,
  review: Omit<BatchRequest, "slide" | "objective"> & { reason: string },
  now: number = Date.now()
): StitchOutcome {
  const base = prev.mosaics.find((m) => m.id === basedOnId);
  if (!base) return { state: prev };
  if (base.status !== "archived") {
    return { state: prev };
  }
  if (!review.reason.trim()) {
    return { state: prev };
  }

  const request: BatchRequest = {
    slide: base.slide,
    objective: base.objective,
    overlap: review.overlap,
    placements: review.placements,
  };

  // 复核版本不与同组旧版本做跨图坐标互斥（它们本就是同一图的历史）
  const others = prev.mosaics.filter(
    (m) => m.slide === base.slide && m.status !== "history" && m.group !== base.group
  );
  const result = validateStitchBatch(request, prev.fovs, others);

  if (!result.ok) {
    const rejection: Rejection = {
      id: uid("R"),
      batchNo: prev.rejections.length + 1,
      slide: request.slide,
      objective: request.objective,
      requested: result.placements,
      overlap: request.overlap,
      reasons: [`复核未通过（基于 ${base.id} v${base.versionNo}）`, ...result.reasons],
      perField: result.perField,
      createdAt: now,
    };
    return { state: { ...prev, rejections: [...prev.rejections, rejection] }, rejection };
  }

  const nextVersionNo =
    1 +
    Math.max(
      ...prev.mosaics.filter((m) => m.group === base.group).map((m) => m.versionNo),
      0
    );

  const mosaic: MosaicVersion = {
    id: uid("MOS"),
    group: base.group,
    versionNo: nextVersionNo,
    slide: base.slide,
    objective: base.objective,
    overlap: request.overlap,
    placements: result.placements,
    status: "active",
    createdAt: now,
    reviewReason: review.reason.trim(),
    basedOn: base.id,
  };

  const mosaics = prev.mosaics.map((m) =>
    m.group === base.group && m.status !== "history"
      ? { ...m, status: "history" as const }
      : m
  );
  mosaics.push(mosaic);

  return { state: { ...prev, mosaics }, mosaic };
}

/** 清空所有数据并恢复种子（界面调试用） */
export function resetState(): BenchState {
  return seed();
}
