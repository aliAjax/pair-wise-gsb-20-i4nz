// ─────────────────────────────────────────────────────────────
// 领域模型：数据层只描述结构，不包含任何界面逻辑
// ─────────────────────────────────────────────────────────────

export type Objective = 40 | 100 | 200 | 400 | 1000;

export const OBJECTIVES: Objective[] = [40, 100, 200, 400, 1000];

/** 视野登记：每个视野必须登记物镜倍率、像素标尺长度、标尺微米值 */
export interface Fov {
  id: string;
  slide: string;
  /** 物镜倍率 */
  objective: Objective;
  /** 标尺对应的像素长度，缺失（null）表示未登记 */
  scalePixels: number | null;
  /** 标尺对应的微米值，缺失（null）表示未登记 */
  scaleMicrons: number | null;
  note?: string;
}

/** 标尺快照：测量接受校准的那一刻冻结的换算依据 */
export interface CalibrationSnapshot {
  objective: Objective;
  scalePixels: number;
  scaleMicrons: number;
  /** 微米 / 像素 */
  micronsPerPixel: number;
  /** 接受校准时的时间戳 */
  acceptedAt: number;
}

/** 测量结果：长度按接受校准时的标尺快照换算 */
export interface Measurement {
  id: string;
  fovId: string;
  label: string;
  /** 测量线段的像素长度（界面输入） */
  lengthPixels: number;
  /** 依据快照换算出的微米长度 */
  lengthMicrons: number;
  snapshot: CalibrationSnapshot;
  createdAt: number;
}

/** 拼接放置。 */
export type PlacementDir = "E" | "S" | "W" | "N";

/**
 * 拼接放置。
 * 非锚点视野声明：相对「参考视野 refFovId」位于 dir 方向；
 * 网格坐标 (x,y) 在接受批次时按 ref + 方向 推导。
 */
export interface Placement {
  fovId: string;
  x: number;
  y: number;
  /** 相对参考视野的方位（首个锚点视野为 null） */
  dir: PlacementDir | null;
  /** 参考视野 id（锚点为 null） */
  refFovId: string | null;
}

/** 提交批次时的输入：坐标留空，由规则层推导 */
export type PlacementInput = Omit<Placement, "x" | "y">;

export type VersionStatus = "active" | "archived" | "history";

/** 一个拼接版本：接受登记后生成，复核会派生出新版本 */
export interface MosaicVersion {
  id: string;
  /** 同一逻辑拼接图在跨版本复核时保持同一 group */
  group: string;
  versionNo: number;
  slide: string;
  objective: Objective;
  /** 提交时登记的相邻重叠率（0-1） */
  overlap: number;
  placements: Placement[];
  status: VersionStatus;
  createdAt: number;
  archivedAt?: number;
  /** 复核另存时填写的原因 */
  reviewReason?: string;
  /** 若是复核派生版本，记录来源版本 id */
  basedOn?: string;
}

/** 整批拒绝的留痕：拒绝后视野回到未拼接池，原因可查 */
export interface Rejection {
  id: string;
  batchNo: number;
  slide: string;
  objective: number;
  requested: Placement[];
  overlap: number;
  reasons: string[];
  perField: Record<string, string[]>;
  createdAt: number;
}

export interface BenchState {
  fovs: Fov[];
  measurements: Measurement[];
  mosaics: MosaicVersion[];
  rejections: Rejection[];
}

export type TabKey = "register" | "stitch" | "measure" | "archive";
