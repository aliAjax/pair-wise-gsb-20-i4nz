import type {
  AppData,
  FieldOfView,
  Measurement,
  ReviewRecord,
  Slide,
  Stitch,
} from "../domain/types";
import { snapshotStitch } from "../domain/rules";

// 示例数据固定在 2026-09 教学周，保证首次打开时时间显示一致。
const T0 = Date.UTC(2026, 8, 18, 1, 0);
const T1 = Date.UTC(2026, 8, 19, 1, 30);
const T2 = Date.UTC(2026, 8, 20, 2, 0);
const T3 = Date.UTC(2026, 8, 21, 3, 0);

const slides: Slide[] = [
  { id: "slide_onion", name: "洋葱表皮", category: "植物组织", stain: "碘液", createdAt: T0 },
  { id: "slide_blood", name: "人血涂片", category: "血液涂片", stain: "瑞氏染色", createdAt: T0 },
  { id: "slide_para", name: "草履虫", category: "微生物", stain: "活体观察", createdAt: T1 },
];

const fields: FieldOfView[] = [
  {
    id: "fov_onion_a",
    slideId: "slide_onion",
    label: "洋葱-A",
    objective: 400,
    rulerPixels: 200,
    rulerMicrons: 100,
    coord: { x: 100, y: 100 },
    orientation: "standard",
    note: "细胞壁清晰，细胞核可见",
    createdAt: T1,
  },
  {
    id: "fov_onion_b",
    slideId: "slide_onion",
    label: "洋葱-B",
    objective: 400,
    rulerPixels: 200,
    rulerMicrons: 100,
    coord: { x: 220, y: 100 },
    orientation: "standard",
    note: "与 A 右缘重叠 35%",
    createdAt: T1,
  },
  // 与归档拼接图坐标重合且方向不同：用于演示「坐标唯一 + 方向冲突不得覆盖」
  {
    id: "fov_onion_conflict",
    slideId: "slide_onion",
    label: "洋葱-冲突视野",
    objective: 400,
    rulerPixels: 210,
    rulerMicrons: 105,
    coord: { x: 100, y: 100 },
    orientation: "r90",
    note: "坐标与 A 重合，旋转 90°",
    createdAt: T2,
  },
  {
    id: "fov_onion_extra",
    slideId: "slide_onion",
    label: "洋葱-待拼接",
    objective: 400,
    rulerPixels: 200,
    rulerMicrons: 100,
    coord: { x: 340, y: 100 },
    orientation: "standard",
    note: "校准完成，尚未归入拼接图",
    createdAt: T2,
  },
  {
    id: "fov_blood_a",
    slideId: "slide_blood",
    label: "血涂片-A",
    objective: 1000,
    rulerPixels: 100,
    rulerMicrons: 10,
    coord: { x: 50, y: 50 },
    orientation: "standard",
    note: "红细胞分布均匀",
    createdAt: T2,
  },
  {
    id: "fov_blood_b",
    slideId: "slide_blood",
    label: "血涂片-B",
    objective: 1000,
    rulerPixels: 100,
    rulerMicrons: 10,
    coord: { x: 150, y: 50 },
    orientation: "standard",
    note: "与 A 重叠 25%，草稿待归档",
    createdAt: T2,
  },
  {
    id: "fov_blood_mismatch",
    slideId: "slide_blood",
    label: "血涂片-400x",
    objective: 400,
    rulerPixels: 200,
    rulerMicrons: 100,
    coord: { x: 250, y: 50 },
    orientation: "standard",
    note: "倍率与 1000x 拼接图不匹配",
    createdAt: T2,
  },
  {
    id: "fov_blood_noruler",
    slideId: "slide_blood",
    label: "血涂片-缺标尺",
    objective: 1000,
    rulerPixels: null,
    rulerMicrons: null,
    coord: { x: 350, y: 50 },
    orientation: "standard",
    note: "标尺缺失",
    createdAt: T2,
  },
  {
    id: "fov_para",
    slideId: "slide_para",
    label: "草履虫-1",
    objective: null,
    rulerPixels: null,
    rulerMicrons: null,
    coord: null,
    orientation: "standard",
    note: "活体观察，纤毛运动明显，待登记倍率与标尺",
    createdAt: T1,
  },
];

// 归档的洋葱拼接图（当前版本 v2，含两个视野）
const onionStitch: Stitch = {
  id: "stitch_onion",
  slideId: "slide_onion",
  title: "洋葱表皮 400x 拼接图",
  entries: [
    { fovId: "fov_onion_a", overlapPct: null },
    { fovId: "fov_onion_b", overlapPct: 35 },
  ],
  objective: 400,
  status: "archived",
  version: 2,
  createdAt: T1,
  archivedAt: T2,
};

// v1 旧版本：只含 A，作为复核时另存的旧版本
const onionStitchV1: Stitch = {
  ...(JSON.parse(JSON.stringify(onionStitch)) as Stitch),
  entries: [{ fovId: "fov_onion_a", overlapPct: null }],
  version: 1,
  archivedAt: T1,
};

const bloodStitch: Stitch = {
  id: "stitch_blood",
  slideId: "slide_blood",
  title: "人血涂片 1000x 草稿",
  entries: [
    { fovId: "fov_blood_a", overlapPct: null },
    { fovId: "fov_blood_b", overlapPct: 25 },
  ],
  objective: 1000,
  status: "draft",
  version: 1,
  createdAt: T2,
  archivedAt: null,
};

const measurements: Measurement[] = [
  {
    id: "meas_onion_cell",
    fovId: "fov_onion_a",
    stitchId: "stitch_onion",
    label: "表皮细胞长径",
    pixelLength: 120,
    resultMicrons: 60, // 保存时标尺：200px = 100µm → 0.5µm/px
    scaleSnapshot: {
      objective: 400,
      rulerPixels: 200,
      rulerMicrons: 100,
      umPerPixel: 0.5,
      capturedAt: T1,
    },
    createdAt: T1,
  },
];

// 用领域规则生成旧版本快照（数据层复用纯规则，不手写快照）
const baseData: AppData = {
  slides,
  fields,
  stitches: [onionStitchV1, onionStitch, bloodStitch],
  measurements,
  reviews: [],
};

const onionV1Snapshot = snapshotStitch(baseData, onionStitchV1, T1);

const reviews: ReviewRecord[] = [
  {
    id: "review_onion_01",
    stitchId: "stitch_onion",
    stitchTitle: onionStitch.title,
    version: 1,
    reason: "课后复核：补入右侧相邻视野洋葱-B（重叠 35%），旧版仅 1 个视野，留版对照。",
    oldVersion: onionV1Snapshot,
    createdAt: T3,
  },
];

export function createSeedData(): AppData {
  return JSON.parse(
    JSON.stringify({
      slides,
      fields,
      stitches: [onionStitch, bloodStitch],
      measurements,
      reviews,
    } satisfies AppData),
  ) as AppData;
}
