import type { ReactNode } from "react";
import { OBJECTIVES, ORIENTATIONS, type ObjectiveMagnification } from "../domain/types";
import type { FieldRejection, RejectCode } from "../domain/rules";

export function parseNum(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 界面层反馈（只在组件状态中，不进持久化数据） */
export interface OpResultView {
  kind: "success" | "error" | "info";
  message: string;
  rejections?: FieldRejection[];
}

export function Banner({
  kind,
  children,
}: {
  kind: "success" | "error" | "info";
  children: ReactNode;
}) {
  if (!children) return null;
  return <div className={`banner banner-${kind}`}>{children}</div>;
}

type BadgeTone = "ok" | "warn" | "danger" | "muted" | "info";

export function Badge({ tone = "muted", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function ObjectiveSelect({
  value,
  onChange,
  allowEmpty,
  disabled,
}: {
  value: number | null;
  onChange: (v: ObjectiveMagnification | null) => void;
  allowEmpty?: boolean;
  disabled?: boolean;
}) {
  return (
    <select
      value={value === null ? "" : String(value)}
      disabled={disabled}
      onChange={(e) =>
        onChange(
          e.target.value === "" ? null : (Number(e.target.value) as ObjectiveMagnification),
        )
      }
    >
      {allowEmpty && <option value="">未选择倍率</option>}
      {OBJECTIVES.map((o) => (
        <option key={o} value={o}>
          {o}x
        </option>
      ))}
    </select>
  );
}

export function OrientationSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: (typeof ORIENTATIONS)[number]["value"]) => void;
  disabled?: boolean;
}) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as never)}>
      {ORIENTATIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const REJECT_CODE_TEXT: Record<RejectCode, string> = {
  MISSING_RULER: "标尺缺失",
  MISSING_COORD: "坐标缺失",
  OBJECTIVE_MISMATCH: "倍率不匹配",
  OVERLAP_INSUFFICIENT: "相邻重叠不足",
  COORD_DUPLICATE_IN_BATCH: "批内坐标重复",
  COORD_OWNED_BY_OTHER: "坐标已归属其他拼接图",
  ORIENTATION_CONFLICT: "方向冲突",
};

/** 整批拒绝面板：逐视野指出原因 */
export function RejectionPanel({
  rejections,
}: {
  rejections: FieldRejection[];
}) {
  if (rejections.length === 0) return null;
  return (
    <div className="reject-panel">
      <div className="reject-head">
        <strong>整批拒绝</strong>
        <span>共 {rejections.length} 个视野不合格，全部未写入</span>
      </div>
      <ul>
        {rejections.map((r) => (
          <li key={r.fovId}>
            <div className="reject-fov">
              <Badge tone="danger">{r.fovLabel}</Badge>
            </div>
            <ul className="reject-reasons">
              {r.reasons.map((reason, i) => (
                <li key={i}>
                  <Badge tone="warn">{REJECT_CODE_TEXT[reason.code]}</Badge>
                  <span>{reason.detail}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="empty-hint">{children}</p>;
}
