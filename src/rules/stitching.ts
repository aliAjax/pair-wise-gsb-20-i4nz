// ─────────────────────────────────────────────────────────────
// 规则层：视野拼接批次校验（纯函数，无界面依赖）
//
// 放置模型：锚点视野 dir/refFovId 均为 null，置于 (0,0)；
// 其余视野声明「我在参考视野 refFovId 的 dir 侧」，坐标据此推导。
//
// 整批拒绝条件（任一触发即整批拒绝，并逐视野列出原因）：
//   1. 标尺缺失：像素标尺或微米值未登记 / 非正
//   2. 倍率不匹配：与批次物镜倍率不一致
//   3. 相邻视野重叠不足：声明重叠率低于阈值
//   4. 坐标冲突：推导后同一坐标被两个视野占用；或该坐标在同玻片
//      的另一张拼接图中已被占用（同一坐标只能归入一个拼接图）
//   5. 方向冲突：同一参考视野的同一侧被多个视野声明，或参考关系
//      自相矛盾（不得用后来的视野覆盖原图位置）
//   6. 结构断裂：锚点缺失 / 重复，参考视野不存在，参考链成环
// ─────────────────────────────────────────────────────────────

import type {
  Fov,
  MosaicVersion,
  Objective,
  Placement,
  PlacementDir,
  PlacementInput,
} from "../types";
import { isCalibrated } from "./calibration";

/** 相邻视野最低重叠率（含）。低于此值整批拒绝 */
export const MIN_OVERLAP = 0.1;

/** dir：本视野位于参考视野的 dir 侧；故本视野坐标 = 参考坐标 + DELTA */
const DELTA: Record<PlacementDir, { dx: number; dy: number }> = {
  E: { dx: 1, dy: 0 },
  W: { dx: -1, dy: 0 },
  N: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
};

export interface BatchRequest {
  slide: string;
  objective: Objective;
  overlap: number;
  placements: PlacementInput[];
}

export interface BatchResult {
  ok: boolean;
  reasons: string[];
  /** 逐视野原因：视野 id → 原因列表 */
  perField: Record<string, string[]>;
  /** 校验通过后推导完成的放置（含坐标） */
  placements: Placement[];
}

function addField(
  perField: Record<string, string[]>,
  fovId: string,
  reason: string
) {
  (perField[fovId] ??= []).push(reason);
}

/**
 * 校验一个拼接批次。只做判定与坐标推导，不修改任何状态。
 * existingMosaics 用于规则 4 的跨拼接图坐标唯一判定。
 */
export function validateStitchBatch(
  request: BatchRequest,
  fovs: Fov[],
  existingMosaics: MosaicVersion[] = []
): BatchResult {
  const { slide, objective, overlap, placements: inputs } = request;
  const reasons: string[] = [];
  const perField: Record<string, string[]> = {};
  const fovById = new Map(fovs.map((f) => [f.id, f]));

  const flag = (reason: string, fovId?: string) => {
    if (!reasons.includes(reason)) reasons.push(reason);
    if (fovId) addField(perField, fovId, reason);
  };

  const empty: BatchResult = { ok: false, reasons, perField, placements: [] };

  if (inputs.length === 0) {
    reasons.push("批次为空：至少需要一个视野");
    return empty;
  }

  // ── 结构：锚点唯一 ──────────────────────────────────────────
  const anchors = inputs.filter((p) => p.dir === null && p.refFovId === null);
  if (anchors.length === 0) {
    reasons.push("缺少锚点视野：需要一个不设方向的起始视野");
  } else if (anchors.length > 1) {
    const reason = `锚点视野不唯一：${anchors.map((a) => `「${a.fovId}」`).join("、")} 均未设方向`;
    reasons.push(reason);
    for (const a of anchors) addField(perField, a.fovId, reason);
  }

  // ── 结构：视野 id 不得在批次内重复 ───────────────────────────
  const seenFov = new Map<string, number>();
  for (const p of inputs) {
    seenFov.set(p.fovId, (seenFov.get(p.fovId) ?? 0) + 1);
  }
  for (const [fovId, count] of seenFov) {
    if (count > 1) flag(`视野重复：「${fovId}」在批次中出现 ${count} 次`, fovId);
  }

  // ── 规则 1 / 2：逐视野标尺与倍率 ────────────────────────────
  for (const p of inputs) {
    const fov = fovById.get(p.fovId);
    if (!fov) {
      flag(`视野 ${p.fovId} 不存在`, p.fovId);
      continue;
    }
    if (!isCalibrated(fov)) {
      flag(`标尺缺失：「${fov.id}」像素标尺或微米值未登记`, p.fovId);
    }
    if (fov.objective !== objective) {
      flag(
        `倍率不匹配：「${fov.id}」为 ${fov.objective}x，批次要求 ${objective}x`,
        p.fovId
      );
    }
  }

  // ── 规则 3：相邻重叠率（批次级，登记到全部视野）──────────────
  if (!(overlap >= MIN_OVERLAP)) {
    const reason = `相邻视野重叠不足：声明 ${(overlap * 100).toFixed(0)}% < 最低 ${MIN_OVERLAP * 100}%`;
    reasons.push(reason);
    for (const p of inputs) addField(perField, p.fovId, reason);
  }

  // ── 坐标推导：从锚点出发按参考链展开（检测断链与环）──────────
  const coords = new Map<string, { x: number; y: number }>();
  const anchor = anchors[0];
  if (anchor) coords.set(anchor.fovId, { x: 0, y: 0 });

  let progressed = true;
  const pending = new Set(inputs.map((p) => p.fovId));
  pending.delete(anchor?.fovId ?? "__none__");

  while (progressed && pending.size > 0) {
    progressed = false;
    for (const p of inputs) {
      if (!pending.has(p.fovId) || p.dir === null || p.refFovId === null) continue;
      const ref = coords.get(p.refFovId);
      if (!ref) {
        // 参考视野不在已定位集合：可能稍后定位，也可能断链/成环
        if (!inputs.some((q) => q.fovId === p.refFovId)) {
          flag(
            `参考缺失：「${p.fovId}」声明的参考视野「${p.refFovId}」不在批次内`,
            p.fovId
          );
          pending.delete(p.fovId);
          progressed = true;
        }
        continue;
      }
      const d = DELTA[p.dir];
      coords.set(p.fovId, { x: ref.x + d.dx, y: ref.y + d.dy });
      pending.delete(p.fovId);
      progressed = true;
    }
  }

  // 仍未定位：参考链成环
  for (const fovId of pending) {
    const p = inputs.find((q) => q.fovId === fovId)!;
    if (p.dir !== null && inputs.some((q) => q.fovId === p.refFovId)) {
      flag(`方向成环：「${fovId}」的参考链最终指回自身，无法定位`, fovId);
    }
  }

  const derived: Placement[] = inputs
    .filter((p) => coords.has(p.fovId))
    .map((p) => ({
      fovId: p.fovId,
      dir: p.dir,
      refFovId: p.refFovId,
      x: coords.get(p.fovId)!.x,
      y: coords.get(p.fovId)!.y,
    }));

  // ── 规则 5：方向冲突（同一参考的同一侧被多个视野声明）────────
  const sideClaims = new Map<string, string[]>();
  for (const p of inputs) {
    if (p.dir === null || p.refFovId === null) continue;
    const key = `${p.refFovId}__${p.dir}`;
    const list = sideClaims.get(key) ?? [];
    list.push(p.fovId);
    sideClaims.set(key, list);
  }
  for (const [, claimers] of sideClaims) {
    if (claimers.length > 1) {
      const reason = `方向冲突：${claimers.map((id) => `「${id}」`).join("、")} 声明占据参考视野的同一侧，后一视野不得覆盖原图像素`;
      reasons.push(reason);
      for (const id of claimers) addField(perField, id, reason);
    }
  }

  // ── 规则 4a：批次内坐标冲突 ─────────────────────────────────
  const coordOwner = new Map<string, string>();
  for (const p of derived) {
    const key = `${p.x},${p.y}`;
    const owner = coordOwner.get(key);
    if (owner && owner !== p.fovId) {
      const reason = `坐标冲突：坐标 (${p.x}, ${p.y}) 已由「${owner}」占用，「${p.fovId}」不得重复归入`;
      reasons.push(reason);
      addField(perField, p.fovId, reason);
      addField(perField, owner, reason);
    } else {
      coordOwner.set(key, p.fovId);
    }
  }

  // ── 规则 4b：跨拼接图坐标唯一（同玻片坐标只能归入一个拼接图）─
  const liveMosaics = existingMosaics.filter(
    (m) => m.slide === slide && m.status !== "history"
  );
  for (const p of derived) {
    for (const m of liveMosaics) {
      const hit = m.placements.find((q) => q.x === p.x && q.y === p.y);
      if (hit) {
        flag(
          `坐标冲突：坐标 (${p.x}, ${p.y}) 在同玻片拼接图「${m.id}」中已由「${hit.fovId}」占用，同一坐标只能归入一个拼接图`,
          p.fovId
        );
      }
    }
  }

  return { ok: reasons.length === 0, reasons, perField, placements: derived };
}

export function dirName(dir: PlacementDir | null): string {
  switch (dir) {
    case "E":
      return "东（右）";
    case "W":
      return "西（左）";
    case "N":
      return "北（上）";
    case "S":
      return "南（下）";
    default:
      return "锚点";
  }
}
