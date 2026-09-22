// 界面层：视野拼接批次。提交前预演规则，失败整批拒绝并逐视野指明原因。
import { useMemo, useState } from "react";
import type {
  BenchState,
  Fov,
  Objective,
  PlacementDir,
  PlacementInput,
} from "../types";
import { OBJECTIVES } from "../types";
import { isCalibrated } from "../rules/calibration";
import {
  validateStitchBatch,
  MIN_OVERLAP,
  dirName,
  type BatchRequest,
} from "../rules/stitching";
import { archiveMosaic, submitStitchBatch } from "../store";

interface Props {
  state: BenchState;
  setState: (updater: (s: BenchState) => BenchState) => void;
}

interface Row extends PlacementInput {
  _key: string;
}

const DIRS: PlacementDir[] = ["E", "S", "W", "N"];

export default function StitchTab({ state, setState }: Props) {
  const [slide, setSlide] = useState("洋葱表皮");
  const [objective, setObjective] = useState<Objective>(400);
  const [overlapPct, setOverlapPct] = useState("15");
  const [rows, setRows] = useState<Row[]>([]);

  const slideFovs = useMemo(
    () => state.fovs.filter((f) => f.slide === slide),
    [state.fovs, slide]
  );

  const usedFovIds = new Set(rows.map((r) => r.fovId));

  const addRow = (fovId: string) => {
    if (usedFovIds.has(fovId)) return;
    const isFirst = rows.length === 0;
    setRows((rs) => [
      ...rs,
      {
        _key: `${fovId}-${rs.length}`,
        fovId,
        dir: isFirst ? null : "E",
        refFovId: isFirst ? null : rs[0]?.fovId ?? null,
      },
    ]);
  };

  const updateRow = (key: string, patch: Partial<PlacementInput>) => {
    setRows((rs) => rs.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  };

  const removeRow = (key: string) => {
    setRows((rs) => {
      const target = rs.find((r) => r._key === key);
      let next = rs.filter((r) => r._key !== key);
      // 删除后第一行强制为锚点
      if (next.length > 0 && next.every((r) => r.dir !== null)) {
        next = next.map((r, i) =>
          i === 0 ? { ...r, dir: null, refFovId: null } : r
        );
      }
      // 指向被删行的参考不可变地重指向新锚点
      const anchorId = next[0]?.fovId ?? null;
      if (target) {
        next = next.map((r) =>
          r.refFovId === target.fovId && r.fovId !== anchorId
            ? { ...r, refFovId: anchorId }
            : r
        );
      }
      return next;
    });
  };

  const overlap = Number(overlapPct) / 100;

  const request: BatchRequest = {
    slide,
    objective,
    overlap: Number.isFinite(overlap) ? overlap : NaN,
    placements: rows.map(({ fovId, dir, refFovId }) => ({ fovId, dir, refFovId })),
  };

  // 提交前实时预演（不落库），让操作者先看到整批拒绝原因
  const preview = useMemo(
    () =>
      rows.length > 0
        ? validateStitchBatch(request, state.fovs, state.mosaics)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, slide, objective, overlapPct, state.fovs, state.mosaics]
  );

  const slideRejections = state.rejections
    .filter((r) => r.slide === slide)
    .slice()
    .reverse();

  const submit = () => {
    if (!preview?.ok) return;
    const outcome = submitStitchBatch(state, request);
    setState(() => outcome.state);
    if (outcome.mosaic) setRows([]);
  };

  const fovById = (id: string): Fov | undefined =>
    state.fovs.find((f) => f.id === id);

  const liveMosaics = state.mosaics.filter(
    (m) => m.slide === slide && m.status !== "history"
  );

  return (
    <div className="tab-grid">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>拼接批次</p>
            <h2>组织视野与方向</h2>
          </div>
        </div>

        <div className="field-grid">
          <label>
            <span>玻片</span>
            <input value={slide} onChange={(e) => setSlide(e.target.value)} />
          </label>
          <label>
            <span>批次物镜倍率（所有视野须一致）</span>
            <select
              value={objective}
              onChange={(e) => setObjective(Number(e.target.value) as Objective)}
            >
              {OBJECTIVES.map((o) => (
                <option key={o} value={o}>{o}x</option>
              ))}
            </select>
          </label>
          <label className="wide">
            <span>相邻视野重叠率（%），最低 {MIN_OVERLAP * 100}%</span>
            <input
              value={overlapPct}
              onChange={(e) => setOverlapPct(e.target.value)}
              inputMode="decimal"
            />
          </label>
        </div>

        <div className="fov-picker">
          <p className="picker-title">该玻片可加入的视野：</p>
          <div className="chips muted">
            {slideFovs.length === 0 && <span className="hint">该玻片暂无登记视野</span>}
            {slideFovs.map((f) => (
              <button
                key={f.id}
                onClick={() => addRow(f.id)}
                disabled={usedFovIds.has(f.id)}
                title={isCalibrated(f) ? f.note : "标尺缺失"}
              >
                {f.id} · {f.objective}x
                {!isCalibrated(f) && " ⚠"}
              </button>
            ))}
          </div>
        </div>

        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>顺序</th><th>视野</th><th>校准</th><th>方位（位于参考视野…侧）</th><th>参考视野</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const fov = fovById(r.fovId);
                  const isAnchor = i === 0;
                  return (
                    <tr key={r._key}>
                      <td className="mono">{i + 1}</td>
                      <td className="mono">{r.fovId}</td>
                      <td>
                        <span className={`badge ${fov && isCalibrated(fov) ? "badge-ok" : "badge-bad"}`}>
                          {fov && isCalibrated(fov) ? "已校准" : "缺失"}
                        </span>
                      </td>
                      <td>
                        {isAnchor ? (
                          <span className="hint">锚点 (0,0)</span>
                        ) : (
                          <select
                            value={r.dir ?? "E"}
                            onChange={(e) =>
                              updateRow(r._key, { dir: e.target.value as PlacementDir })
                            }
                          >
                            {DIRS.map((d) => (
                              <option key={d} value={d}>{dirName(d)}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>
                        {isAnchor ? (
                          <span className="hint">—</span>
                        ) : (
                          <select
                            value={r.refFovId ?? ""}
                            onChange={(e) => updateRow(r._key, { refFovId: e.target.value })}
                          >
                            {rows
                              .filter((q) => q.fovId !== r.fovId)
                              .map((q) => (
                                <option key={q._key} value={q.fovId}>{q.fovId}</option>
                              ))}
                          </select>
                        )}
                      </td>
                      <td>
                        <button className="link-btn" onClick={() => removeRow(r._key)}>移除</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 预演结果 */}
        {preview && (
          <div className={`verdict ${preview.ok ? "verdict-ok" : "verdict-bad"}`}>
            <strong>
              {preview.ok
                ? "规则预演通过：提交后将生成拼接图"
                : `规则预演不通过：若提交将整批拒绝（${preview.reasons.length} 类原因）`}
            </strong>
            <ul>
              {preview.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            {!preview.ok && (
              <div className="per-field">
                <p>逐视野原因：</p>
                {Object.entries(preview.perField).map(([fid, rs]) => (
                  <div key={fid} className="per-field-row">
                    <span className="mono">{fid}</span>
                    <ul>{rs.map((x) => <li key={x}>{x}</li>)}</ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="form-footer">
          <button onClick={() => setRows([])} disabled={rows.length === 0}>清空批次</button>
          <button className="primary-action" onClick={submit} disabled={!preview?.ok}>
            提交拼接（整批校验）
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>{slide}</p>
            <h2>当前拼接图 / 拒绝留痕</h2>
          </div>
        </div>

        {slideRejections.length === 0 && liveMosaics.length === 0 && (
          <p className="hint">该玻片暂无拒绝记录与拼接图。</p>
        )}
        {slideRejections.map((rj) => (
          <div key={rj.id} className="rejection-card">
            <header>
              <span className="badge badge-bad">整批拒绝 #{rj.batchNo}</span>
              <time>{new Date(rj.createdAt).toLocaleString("zh-CN")}</time>
            </header>
            <p className="hint-bad">
              玻片 {rj.slide} · {rj.objective}x · 声明重叠{" "}
              {(rj.overlap * 100).toFixed(0)}%
            </p>
            <ul>
              {rj.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
            <details>
              <summary>逐视野原因（{Object.keys(rj.perField).length} 个视野）</summary>
              {Object.entries(rj.perField).map(([fid, rs]) => (
                <div key={fid} className="per-field-row">
                  <span className="mono">{fid}</span>
                  <ul>{rs.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
              ))}
            </details>
          </div>
        ))}

        <div className="mosaic-list">
          {liveMosaics.length === 0 && <p className="hint">该玻片暂无在档拼接图</p>}
          {liveMosaics.map((m) => (
            <article key={m.id} className={`mosaic-card status-${m.status}`}>
              <header>
                <div>
                  <strong>{m.id}</strong>
                  <span className={`badge ${m.status === "active" ? "badge-ok" : "badge-hold"}`}>
                    {m.status === "active" ? "在档" : "已归档冻结"}
                  </span>
                  <span className="badge badge-muted">v{m.versionNo}</span>
                </div>
                <time>{new Date(m.createdAt).toLocaleDateString("zh-CN")}</time>
              </header>
              <p className="hint">
                {m.objective}x · {m.placements.length} 视野 · 重叠 {(m.overlap * 100).toFixed(0)}%
              </p>
              <div className="grid-mini">
                {m.placements.map((p) => (
                  <span key={p.fovId} className="cell" title={`${p.fovId} · ${dirName(p.dir)}`}>
                    ({p.x},{p.y}) {p.fovId}
                  </span>
                ))}
              </div>
              {m.status === "active" && (
                <button
                  onClick={() =>
                    setState((s) => archiveMosaic(s, m.id))
                  }
                >
                  归档并冻结
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
