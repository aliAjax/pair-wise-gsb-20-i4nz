import { createContext, useContext } from "react";
import type {
  AppData,
  FieldOfView,
  Measurement,
  ReviewRecord,
  Stitch,
  StitchEntry,
} from "../domain/types";
import type { BatchItemInput, FieldRejection } from "../domain/rules";

/** 编辑视野时允许修改的字段 */
export type FovPatch = Partial<
  Pick<FieldOfView, "label" | "objective" | "rulerPixels" | "rulerMicrons" | "note" | "orientation">
> & { coord?: { x: number; y: number } | null };

export type Action =
  | { type: "replaceData"; data: AppData }
  | { type: "addFov"; fov: FieldOfView }
  | { type: "updateFov"; id: string; patch: FovPatch }
  | { type: "removeFov"; id: string }
  | { type: "addStitch"; stitch: Stitch }
  | { type: "appendEntries"; stitchId: string; entries: StitchEntry[] }
  | { type: "replaceEntries"; stitchId: string; entries: StitchEntry[] }
  | {
      type: "setEntryOverlap";
      stitchId: string;
      fovId: string;
      overlapPct: number | null;
    }
  | { type: "removeStitch"; stitchId: string }
  | { type: "addMeasurement"; measurement: Measurement }
  | { type: "removeMeasurement"; id: string }
  | { type: "archiveStitch"; stitchId: string; at: number }
  | { type: "addReview"; review: ReviewRecord };

export function reducer(data: AppData, action: Action): AppData {
  switch (action.type) {
    case "replaceData":
      return action.data;

    case "addFov":
      return { ...data, fields: [...data.fields, action.fov] };

    case "updateFov":
      return {
        ...data,
        fields: data.fields.map((f) =>
          f.id === action.id ? { ...f, ...action.patch } : f,
        ),
      };

    case "removeFov":
      return { ...data, fields: data.fields.filter((f) => f.id !== action.id) };

    case "addStitch":
      return { ...data, stitches: [...data.stitches, action.stitch] };

    case "appendEntries":
      return {
        ...data,
        stitches: data.stitches.map((s) =>
          s.id === action.stitchId
            ? { ...s, entries: [...s.entries, ...action.entries] }
            : s,
        ),
      };

    case "replaceEntries":
      return {
        ...data,
        stitches: data.stitches.map((s) =>
          s.id === action.stitchId ? { ...s, entries: action.entries } : s,
        ),
      };

    case "setEntryOverlap":
      return {
        ...data,
        stitches: data.stitches.map((s) =>
          s.id === action.stitchId
            ? {
                ...s,
                entries: s.entries.map((e) =>
                  e.fovId === action.fovId ? { ...e, overlapPct: action.overlapPct } : e,
                ),
              }
            : s,
        ),
      };

    case "removeStitch":
      return {
        ...data,
        stitches: data.stitches.filter((s) => s.id !== action.stitchId),
        measurements: data.measurements.filter((m) => m.stitchId !== action.stitchId),
      };

    case "addMeasurement":
      return { ...data, measurements: [...data.measurements, action.measurement] };

    case "removeMeasurement":
      return {
        ...data,
        measurements: data.measurements.filter((m) => m.id !== action.id),
      };

    case "archiveStitch":
      return {
        ...data,
        stitches: data.stitches.map((s) =>
          s.id === action.stitchId
            ? { ...s, status: "archived", archivedAt: action.at }
            : s,
        ),
      };

    case "addReview":
      return { ...data, reviews: [action.review, ...data.reviews] };

    default:
      return data;
  }
}

export interface OpResult {
  ok: boolean;
  message: string;
  rejections?: FieldRejection[];
}

export interface AppContextValue {
  data: AppData;
  registerFov: (
    input: Omit<FieldOfView, "id" | "createdAt">,
  ) => OpResult;
  updateFov: (id: string, patch: FovPatch) => OpResult;
  removeFov: (id: string) => OpResult;
  createStitch: (input: {
    slideId: string;
    title: string;
    objective: Stitch["objective"];
    items: BatchItemInput[];
  }) => OpResult;
  appendToStitch: (stitchId: string, items: BatchItemInput[]) => OpResult;
  removeEntry: (stitchId: string, fovId: string) => OpResult;
  setEntryOverlap: (stitchId: string, fovId: string, overlapPct: number | null) => OpResult;
  removeStitch: (stitchId: string) => OpResult;
  saveMeasurement: (input: {
    fovId: string;
    label: string;
    pixelLength: number;
  }) => OpResult;
  removeMeasurement: (id: string) => OpResult;
  archiveStitch: (stitchId: string) => OpResult;
  addReview: (stitchId: string, reason: string) => OpResult;
  resetDemo: () => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppContext 未提供");
  return ctx;
}
