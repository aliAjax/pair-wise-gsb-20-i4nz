// 领域模型：视野拼接与测量校准台
// 仅描述数据结构，不包含任何存储或界面逻辑。

export const OBJECTIVES = [40, 100, 200, 400, 1000] as const;
export type ObjectiveMagnification = (typeof OBJECTIVES)[number];

export const ORIENTATIONS = [
  { value: "standard", label: "标准方向" },
  { value: "r90", label: "旋转 90°" },
  { value: "r180", label: "旋转 180°" },
  { value: "r270", label: "旋转 270°" },
] as const;
export type Orientation = (typeof ORIENTATIONS)[number]["value"];

/** 载物台坐标（同一玻片内的视野坐标） */
export interface StageCoord {
  x: number;
  y: number;
}

/** 玻片 */
export interface Slide {
  id: string;
  name: string;
  category: string;
  stain: string;
  createdAt: number;
}

/**
 * 视野：每个视野必须登记物镜倍率、像素标尺（标尺像素长度）与微米值（标尺实际长度）。
 * 任一字段缺失即视为未完成校准。
 */
export interface FieldOfView {
  id: string;
  slideId: string;
  label: string;
  objective: ObjectiveMagnification | null;
  /** 像素标尺：标尺在图像中跨越的像素数 */
  rulerPixels: number | null;
  /** 微米值：该标尺对应的实际长度（µm） */
  rulerMicrons: number | null;
  coord: StageCoord | null;
  orientation: Orientation;
  note: string;
  createdAt: number;
}

/** 拼接图中的有序视野；首个视野没有前邻，overlapPct 为 null */
export interface StitchEntry {
  fovId: string;
  /** 与上一相邻视野的重叠率（%） */
  overlapPct: number | null;
}

export type StitchStatus = "draft" | "archived";

/** 拼接图（整批写入，原子接受或整批拒绝） */
export interface Stitch {
  id: string;
  slideId: string;
  title: string;
  entries: StitchEntry[];
  objective: ObjectiveMagnification;
  status: StitchStatus;
  version: number;
  createdAt: number;
  archivedAt: number | null;
}

/** 测量保存瞬间的标尺快照，事后倍率/标尺调整不影响已保存结果 */
export interface ScaleSnapshot {
  objective: ObjectiveMagnification;
  rulerPixels: number;
  rulerMicrons: number;
  umPerPixel: number;
  capturedAt: number;
}

/** 测量结果：像素长度按保存时的标尺快照换算 */
export interface Measurement {
  id: string;
  fovId: string;
  stitchId: string | null;
  label: string;
  pixelLength: number;
  resultMicrons: number;
  scaleSnapshot: ScaleSnapshot;
  createdAt: number;
}

/** 归档旧版本快照（复核另存，不改冻结原件） */
export interface StitchVersionSnapshot {
  savedAt: number;
  stitch: Stitch;
  fields: FieldOfView[];
  measurements: Measurement[];
}

/** 复核记录：原因与旧版本分开另存 */
export interface ReviewRecord {
  id: string;
  stitchId: string;
  stitchTitle: string;
  version: number;
  reason: string;
  oldVersion: StitchVersionSnapshot;
  createdAt: number;
}

/** 持久化的应用数据（界面临时状态不入此结构） */
export interface AppData {
  slides: Slide[];
  fields: FieldOfView[];
  stitches: Stitch[];
  measurements: Measurement[];
  reviews: ReviewRecord[];
}
