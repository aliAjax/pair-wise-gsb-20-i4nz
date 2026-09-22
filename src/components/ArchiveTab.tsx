// 界面层：归档冻结与复核另存。
// active 可归档 → archived（冻结）；archived 只能通过“复核另存”派生
// 新版本（active，versionNo+1，需原因），旧版本转 history 原样保留。
import { useMemo, useState } from "react";
import type { BenchState, Objective, PlacementDir, PlacementInput } from "../types";
import { OBJECTIVES } from "../types";
import { isCalibrated } from "../rules/calibration";
import { validateStitchBatch, MIN_OVERLAP, dirName } from "../rules/stitching";
import { archiveMosaic, reviewMosaic } from "../store";

interface Props {
  state: BenchState;
  setState: (updater: (s: BenchState) => BenchState) => void;
}

interface Row extends PlacementInput {
  _key: string;
}

const DIRS: PlacementDir[] = ["E", "S", "W", "N"];

export default function ArchiveTab({ state, setState }: Props) {
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [overlapPct, setOverlapPct] = useState("15");
  const [rows, setRows] = useState<Row[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);

  // 按拼接图 group 归组
  const groups = useMemo(() => {
    const map = new Map<string, typeof state.mosaics>();
    for (const m of state.mosaics) {
      const list = map.get(m.group) ?? [];
      list.push(m);
      map.set(m.group, list);
    }
    return [...map.entries()].map(([group, list]) => ({
      group,
      versions: [...list].sort((a, b) => b.versionNo - a.versionNo),
    }));
  }, [state.mosaics]);

  const startReview = (mosaicId: string) => {
    const base = state.mosaics.find((m) => m.id === mosaicId);
    if (!base) return;
    setReviewingId(mosaicId);
    setReason("");
    setOverlapPct(String(Math.round(base.overlap * 100)));
    setRows(
      base.placements.map((p, i) => ({
        _key: `${p.fovId}-${i}`,
        fovId: p.fovId,
        dir: p.dir,
        refFovId: p.refFovId,
      }))
    );
    setFeedback(null);
  };

  const cancelReview = () => {
    setReviewingId(null);
    setRows([]);
    setReason("");
    setFeedback(null);
  };

  const base = reviewingId ? state.mosaics.find((m) => m.id === reviewingId) : undefined;

  const updateRow = (key: string, patch: Partial<PlacementInput>) =>
    setRows((rs) => rs.map((r) => (r._key === key ? { ...r, ...patch } : r)));

  const preview = useMemo(() => {
    if (!base || rows.length === 0) return null;
    const others = state.mosaics.filter(
      (m) => m.slide === base.slide && m.status !== "history" && m.group !== base.group
    );
    return validateStitchBatch(
      {
        slide: base.slide,
        objective: base.objective,
        overlap: Number(overlapPct) / 100,
        placements: rows.map(({ fovId, dir, refFovId }) => ({ fovId, dir, refFovId })),
      },
      state.fovs,
      others
    );
  }, [base, rows, overlapPct, state.fovs, state.mosaics]);

  const submitReview = () => {
    if (!base || !reason.trim() || !preview?.ok) return;
    const outcome = reviewMosaic(state, base.id, {
      reason,
      overlap: Number(overlapPct) / 100,
      placements: rows.map(({ fovId, dir, refFovId }) => ({ fovId, dir, refFovId })),
    });
    if (outcome.rejection) {
      setFeedback(`复核被整批拒绝：${outcome.rejection.reasons[0]}`);
      return;
    }
    setState(() => outcome.state);
    setFeedback("复核已另存为新版本，旧版本已转入历史。");
    cancelReview();
  };

  const canSubmit = !!base && reason.trim().length > 0 && !!preview?.ok;

  return (
    <div className="tab-grid">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>归档与复核</p>
            <h2>拼接图版本</h2>
          </div>
        </div>

        {groups.length === 0 && <p className="hint">暂无拼接图，请先在「视野拼接」提交批次。</p>}

        <div className="mosaic-list">
          {groups.map(({ group, versions }) => {
            const current = versions[0];
            return (
              <article key={group} className={`mosaic-card status-${current.status}`}>
                <header>
                  <div>
                    <strong>{current.slide}</strong>
                    <span className={`badge ${current.status === "active" ? "badge-ok" : current.status === "archived" ? "badge-hold" : "badge-muted"}`}>
                      {current.status === "active" ? "在档" : current.status === "archived" ? "已归档冻结" : "历史"}
                    </span>
                    <span className="badge badge-muted">当前 v{current.versionNo} / 共 {versions.length} 版</span>
                  </div>
                  <time>{new Date(current.createdAt).toLocaleDateString("zh-CN")}</time>
                </header>
                <p className="hint">
                  {current.objective}x · {current.placements.length} 视野 · 重叠 {(current.overlap * 100).toFixed(0)}%
                  {current.reviewReason ? ` · 复核原因：${current.reviewReason}` : ""}
                </p>

                <details>
                  <summary>版本历史（{versions.length}）</summary>
                  <ul className="version-list">
                    {versions.map((v) => (
                      <li key={v.id} className={v.status === current.status ? "" : "history-item"}>
                        <span className="badge badge-muted">v{v.versionNo}</span>
                        <span className={`badge ${v.status === "active" ? "badge-ok" : v.status === "archived" ? "badge-hold" : "badge-muted"}`}>
                          {v.status === "active" ? "在档" : v.status === "archived" ? "归档冻结" : "历史旧版"}
                        </span>
                        <span className="mono">{v.id}</span>
                        <time>{new Date(v.createdAt).toLocaleString("zh-CN")}</time>
                        {v.reviewReason && <em className="note">原因：{v.reviewReason}</em>}
                      </li>
                    ))}
                  </ul>
                </details>

                <div className="card-actions">
                  {current.status === "active" && (
                    <button onClick={() => setState((s) => archiveMosaic(s, current.id))}>
                      归档并冻结
                    </button>
                  )}
                  {current.status === "archived" && (
                    <button className="primary-action" onClick={() => startReview(current.id)}>
                      复核另存新版本
                    </button>
                  )}
                  {current.status === "history" && (
                    <span className="hint">该版本为历史旧版，不可再操作。</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* 复核另存表单 */}
      {base && reviewingId === base.id && (
        <section className="panel review-panel">
          <div className="section-heading">
            <div>
              <p>复核另存（基于冻结的 v{base.versionNo}）</p>
              <h2>{base.slide} · 新版本草案</h2>
            </div>
            <button onClick={cancelReview}>取消复核</button>
          </div>

          <div className="field-grid">
            <label className="wide">
              <span>复核原因（必填，随新版本与旧版本一并留档）</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：补拍右侧视野、修正下方方位" />
            </label>
            <label>
              <span>物镜倍率（沿用冻结版本，不可改）</span>
              <select value={base.objective} disabled>
                {OBJECTIVES.map((o) => <option key={o} value={o}>{o}x</option>)}
              </select>
            </label>
            <label>
              <span>相邻重叠率（%），最低 {MIN_OVERLAP * 100}%</span>
              <input value={overlapPct} onChange={(e) => setOverlapPct(e.target.value)} inputMode="decimal" />
            </label>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>视野</th><th>当前校准</th><th>方位</th><th>参考视野</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const fov = state.fovs.find((f) => f.id === r.fovId);
                  const isAnchor = i === 0;
                  return (
                    <tr key={r._key}>
                      <td className="mono">{r.fovId}</td>
                      <td>
                        <span className={`badge ${fov && isCalibrated(fov) ? "badge-ok" : "badge-bad"}`}>
                          {fov && isCalibrated(fov) ? `${fov.objective}x 已校准` : "标尺缺失"}
                        </span>
                      </td>
                      <td>
                        {isAnchor ? (
                          <span className="hint">锚点</span>
                        ) : (
                          <select value={r.dir ?? "E"} onChange={(e) => updateRow(r._key, { dir: e.target.value as PlacementDir })}>
                            {DIRS.map((d) => <option key={d} value={d}>{dirName(d)}</option>)}
                          </select>
                        )}
                      </td>
                      <td>
                        {isAnchor ? (
                          <span className="hint">—</span>
                        ) : (
                          <select value={r.refFovId ?? ""} onChange={(e) => updateRow(r._key, { refFovId: e.target.value })}>
                            {rows.filter((q) => q.fovId !== r.fovId).map((q) => (
                              <option key={q._key} value={q.fovId}>{q.fovId}</option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {preview && (
            <div className={`verdict ${preview.ok ? "verdict-ok" : "verdict-bad"}`}>
              <strong>{preview.ok ? "复核草案规则通过" : `复核草案不通过（${preview.reasons.length} 类原因），提交仍会整批拒绝`}</strong>
              <ul>{preview.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          )}

          {feedback && <p className="hint hint-bad">{feedback}</p>}

          <div className="form-footer">
            <span className="hint">另存后：新版本 active，原 v{base.versionNo} 转 history 原样保留，测量结果不受影响。</span>
            <button className="primary-action" onClick={submitReview} disabled={!canSubmit}>
              保存新版本
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
