import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import type { FieldOfView } from "../domain/types";
import {
  archiveBlockedReasons,
  captureScaleSnapshot,
  checkBatch,
  convertMeasurement,
  findStitchOfFov,
  getCalibration,
  isStitchFrozen,
  measurementBlockedReason,
  reviewBlockedReason,
  snapshotStitch,
} from "../domain/rules";
import { formatNumber, uid } from "../domain/format";
import { loadData, resetData, saveData } from "../data/storage";
import {
  AppContext,
  reducer,
  type AppContextValue,
  type OpResult,
} from "./store";

function ok(message: string): OpResult {
  return { ok: true, message };
}
function fail(message: string): OpResult {
  return { ok: false, message };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, dispatch] = useReducer(reducer, undefined, loadData);
  const dataRef = useRef(data);
  dataRef.current = data;

  // 刷新一致：每次状态变化写入 localStorage（数据层序列化）
  useEffect(() => {
    saveData(data);
  }, [data]);

  const registerFov = useCallback<AppContextValue["registerFov"]>((input) => {
    const fov: FieldOfView = {
      ...input,
      id: uid("fov"),
      createdAt: Date.now(),
    };
    dispatch({ type: "addFov", fov });
    return ok(`视野「${fov.label}」已登记（${getCalibration(fov) ? "校准完成" : "标尺待补全"}）`);
  }, []);

  const updateFov = useCallback<AppContextValue["updateFov"]>((id, patch) => {
    const current = dataRef.current.fields.find((f) => f.id === id);
    if (!current) return fail("视野不存在");
    const stitch = findStitchOfFov(dataRef.current, id);
    if (stitch?.status === "archived") {
      return fail("视野属于已归档拼接图，已冻结，禁止修改");
    }
    dispatch({ type: "updateFov", id, patch });
    return ok("视野已更新；已保存的测量仍按其标尺快照计算，不受影响");
  }, []);

  const removeFov = useCallback<AppContextValue["removeFov"]>((id) => {
    const current = dataRef.current.fields.find((f) => f.id === id);
    if (!current) return fail("视野不存在");
    const stitch = findStitchOfFov(dataRef.current, id);
    if (stitch?.status === "archived") {
      return fail(`视野属于归档拼接图「${stitch.title}」，冻结不可删除`);
    }
    if (stitch?.status === "draft") {
      return fail(`视野已归入草稿拼接图「${stitch.title}」，请先从该拼接图移除`);
    }
    dispatch({ type: "removeFov", id });
    return ok(`视野「${current.label}」已删除`);
  }, []);

  const createStitch = useCallback<AppContextValue["createStitch"]>((input) => {
    const result = checkBatch(input.items, {
      data: dataRef.current,
      slideId: input.slideId,
      objective: input.objective,
    });
    if (!result.accepted) {
      return {
        ok: false,
        message: "整批拒绝：存在不合格视野，本批未生成任何拼接图",
        rejections: result.rejections,
      };
    }
    const stitch = {
      id: uid("stitch"),
      slideId: input.slideId,
      title: input.title.trim() || `拼接图 ${new Date().toLocaleDateString("zh-CN")}`,
      entries: input.items.map((item) => ({
        fovId: item.fovId,
        overlapPct: item.overlapPct,
      })),
      objective: input.objective,
      status: "draft" as const,
      version: 1,
      createdAt: Date.now(),
      archivedAt: null,
    };
    dispatch({ type: "addStitch", stitch });
    return ok(`拼接图「${stitch.title}」已创建（${stitch.entries.length} 个视野）`);
  }, []);

  const appendToStitch = useCallback<AppContextValue["appendToStitch"]>(
    (stitchId, items) => {
      const stitch = dataRef.current.stitches.find((s) => s.id === stitchId);
      if (!stitch) return fail("拼接图不存在");
      if (isStitchFrozen(stitch)) return fail("拼接图已归档冻结，不能追加视野");
      if (items.length === 0) return fail("未选择要追加的视野");

      // 调用方按顺序给出新视野；首个新视野的 overlapPct 即与原图末视野的相邻重叠。
      const ordered = items.map((item) => ({ ...item }));

      // 用全量（原 entries + 追加）跑同一套规则；自身坐标豁免
      const allItems = [...stitch.entries, ...ordered];
      const result = checkBatch(allItems, {
        data: dataRef.current,
        slideId: stitch.slideId,
        objective: stitch.objective,
        appendToStitchId: stitch.id,
      });
      if (!result.accepted) {
        // 只回传涉及新追加视野的拒绝原因，原拼接图保持不变
        const newIds = new Set(ordered.map((i) => i.fovId));
        const rejections = result.rejections.filter((r) => newIds.has(r.fovId));
        return {
          ok: false,
          message: "整批拒绝：追加视野未通过校验，原拼接图保持不变",
          rejections,
        };
      }
      dispatch({ type: "appendEntries", stitchId, entries: ordered });
      return ok(`已向「${stitch.title}」追加 ${ordered.length} 个视野`);
    },
    [],
  );

  const removeEntry = useCallback<AppContextValue["removeEntry"]>(
    (stitchId, fovId) => {
      const stitch = dataRef.current.stitches.find((s) => s.id === stitchId);
      if (!stitch) return fail("拼接图不存在");
      if (isStitchFrozen(stitch)) return fail("拼接图已归档冻结，不能移除视野");
      const idx = stitch.entries.findIndex((e) => e.fovId === fovId);
      if (idx < 0) return fail("该视野不在拼接图中");
      const next = stitch.entries.filter((e) => e.fovId !== fovId);
      // 邻接链重排：接替位置的视野与新前邻的重叠未知，清空待重填
      if (idx < next.length) {
        next[idx] = { ...next[idx], overlapPct: null };
      }
      dispatch({ type: "replaceEntries", stitchId, entries: next });
      return ok("视野已移除；新相邻处的重叠率已清空，请重新登记后再归档");
    },
    [],
  );

  const setEntryOverlap = useCallback<AppContextValue["setEntryOverlap"]>(
    (stitchId, fovId, overlapPct) => {
      const stitch = dataRef.current.stitches.find((s) => s.id === stitchId);
      if (!stitch) return fail("拼接图不存在");
      if (isStitchFrozen(stitch)) return fail("拼接图已归档冻结，重叠率不可修改");
      if (overlapPct !== null && (!Number.isFinite(overlapPct) || overlapPct < 0 || overlapPct > 100)) {
        return fail("重叠率需在 0–100 之间");
      }
      dispatch({ type: "setEntryOverlap", stitchId, fovId, overlapPct });
      return ok("相邻重叠率已更新");
    },
    [],
  );

  const removeStitch = useCallback<AppContextValue["removeStitch"]>((stitchId) => {
    const stitch = dataRef.current.stitches.find((s) => s.id === stitchId);
    if (!stitch) return fail("拼接图不存在");
    if (isStitchFrozen(stitch)) {
      return fail("拼接图已归档冻结，不能删除；如需变更请发起复核");
    }
    dispatch({ type: "removeStitch", stitchId });
    return ok(`草稿拼接图「${stitch.title}」已删除`);
  }, []);

  const saveMeasurement = useCallback<AppContextValue["saveMeasurement"]>(
    ({ fovId, label, pixelLength }) => {
      const fov = dataRef.current.fields.find((f) => f.id === fovId);
      if (!fov) return fail("视野不存在");
      const blocked = measurementBlockedReason(dataRef.current, fov);
      if (blocked) return fail(blocked);
      if (!label.trim()) return fail("请填写测量项目名称");
      if (!Number.isFinite(pixelLength) || pixelLength <= 0) {
        return fail("像素长度必须为正数");
      }
      const snapshot = captureScaleSnapshot(fov, Date.now());
      if (!snapshot) return fail("视野标尺缺失，无法换算");
      const resultMicrons = convertMeasurement(pixelLength, snapshot);
      const stitch = findStitchOfFov(dataRef.current, fovId);
      const measurement = {
        id: uid("meas"),
        fovId,
        stitchId: stitch ? stitch.id : null,
        label: label.trim(),
        pixelLength,
        resultMicrons: Math.round(resultMicrons * 1000) / 1000,
        scaleSnapshot: snapshot,
        createdAt: Date.now(),
      };
      dispatch({ type: "addMeasurement", measurement });
      return ok(
        `测量「${measurement.label}」已保存：${pixelLength}px × ${formatNumber(
          snapshot.umPerPixel,
        )}µm/px = ${formatNumber(measurement.resultMicrons)}µm（标尺快照已冻结）`,
      );
    },
    [],
  );

  const removeMeasurement = useCallback<AppContextValue["removeMeasurement"]>((id) => {
    const m = dataRef.current.measurements.find((x) => x.id === id);
    if (!m) return fail("测量记录不存在");
    if (m.stitchId) {
      const stitch = dataRef.current.stitches.find((s) => s.id === m.stitchId);
      if (stitch?.status === "archived") {
        return fail("测量属于已归档拼接图，随拼接冻结，不可删除");
      }
    }
    dispatch({ type: "removeMeasurement", id });
    return ok(`测量「${m.label}」已删除`);
  }, []);

  const archiveStitch = useCallback<AppContextValue["archiveStitch"]>((stitchId) => {
    const stitch = dataRef.current.stitches.find((s) => s.id === stitchId);
    if (!stitch) return fail("拼接图不存在");
    const reasons = archiveBlockedReasons(dataRef.current, stitch);
    if (reasons.length > 0) return fail(reasons.join("；"));
    dispatch({ type: "archiveStitch", stitchId, at: Date.now() });
    return ok(`拼接图「${stitch.title}」已归档：拼接与测量全部冻结`);
  }, []);

  const addReview = useCallback<AppContextValue["addReview"]>((stitchId, reason) => {
    const stitch = dataRef.current.stitches.find((s) => s.id === stitchId);
    if (!stitch) return fail("拼接图不存在");
    const blocked = reviewBlockedReason(stitch);
    if (blocked) return fail(blocked);
    if (!reason.trim()) return fail("复核必须填写原因");
    // 复核另存：保存当前冻结版本为旧版本快照，冻结原件保持不变
    const snapshot = snapshotStitch(dataRef.current, stitch, Date.now());
    const review = {
      id: uid("review"),
      stitchId,
      stitchTitle: stitch.title,
      version: stitch.version,
      reason: reason.trim(),
      oldVersion: snapshot,
      createdAt: Date.now(),
    };
    dispatch({ type: "addReview", review });
    return ok(`复核记录已另存（v${stitch.version} 旧版本留档），归档原件未改动`);
  }, []);

  const resetDemo = useCallback(() => {
    dispatch({ type: "replaceData", data: resetData() });
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      data,
      registerFov,
      updateFov,
      removeFov,
      createStitch,
      appendToStitch,
      removeEntry,
      setEntryOverlap,
      removeStitch,
      saveMeasurement,
      removeMeasurement,
      archiveStitch,
      addReview,
      resetDemo,
    }),
    [
      data,
      registerFov,
      updateFov,
      removeFov,
      createStitch,
      appendToStitch,
      removeEntry,
      setEntryOverlap,
      removeStitch,
      saveMeasurement,
      removeMeasurement,
      archiveStitch,
      addReview,
      resetDemo,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
