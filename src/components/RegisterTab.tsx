// 界面层：视野登记（物镜倍率 + 像素标尺 + 微米值）
import { useState } from "react";
import type { BenchState, Fov, Objective } from "../types";
import { OBJECTIVES } from "../types";
import { isCalibrated, micronsPerPixel } from "../rules/calibration";
import { uid, upsertFov } from "../store";

interface Props {
  state: BenchState;
  setState: (updater: (s: BenchState) => BenchState) => void;
}

function numOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function RegisterTab({ state, setState }: Props) {
  const [slide, setSlide] = useState("");
  const [objective, setObjective] = useState<Objective>(400);
  const [scalePixels, setScalePixels] = useState("");
  const [scaleMicrons, setScaleMicrons] = useState("");
  const [note, setNote] = useState("");

  const addFov = () => {
    if (!slide.trim()) return;
    const fov: Fov = {
      id: uid("F"),
      slide: slide.trim(),
      objective,
      scalePixels: numOrNull(scalePixels),
      scaleMicrons: numOrNull(scaleMicrons),
      note: note.trim() || undefined,
    };
    setState((s) => upsertFov(s, fov));
    setSlide("");
    setScalePixels("");
    setScaleMicrons("");
    setNote("");
  };

  // 实时换算仅用于预览，不代表任何已保存测量
  const previewFactor = micronsPerPixel(
    numOrNull(scalePixels),
    numOrNull(scaleMicrons)
  );

  return (
    <div className="tab-grid">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>视野登记</p>
            <h2>新增视野</h2>
          </div>
        </div>
        <div className="field-grid">
          <label>
            <span>玻片 / 样本名称</span>
            <input value={slide} onChange={(e) => setSlide(e.target.value)} placeholder="如：洋葱表皮" />
          </label>
          <label>
            <span>物镜倍率</span>
            <select
              value={objective}
              onChange={(e) => setObjective(Number(e.target.value) as Objective)}
            >
              {OBJECTIVES.map((o) => (
                <option key={o} value={o}>{o}x</option>
              ))}
            </select>
          </label>
          <label>
            <span>像素标尺长度（px）</span>
            <input
              value={scalePixels}
              onChange={(e) => setScalePixels(e.target.value)}
              inputMode="decimal"
              placeholder="如：120"
            />
          </label>
          <label>
            <span>标尺微米值（µm）</span>
            <input
              value={scaleMicrons}
              onChange={(e) => setScaleMicrons(e.target.value)}
              inputMode="decimal"
              placeholder="如：50"
            />
          </label>
          <label className="wide">
            <span>备注</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="视野位置 / 说明（可选）" />
          </label>
        </div>
        <div className="form-footer">
          <span className={`hint ${previewFactor === null ? "hint-bad" : "hint-ok"}`}>
            {previewFactor === null
              ? "标尺不完整：像素标尺与微米值须同时为正数，否则该视野将被拼接整批拒绝且无法测量"
              : `实时预览换算：1 px ≈ ${previewFactor.toFixed(4)} µm（仅预览，测量时才冻结快照）`}
          </span>
          <button className="primary-action" onClick={addFov} disabled={!slide.trim()}>
            登记视野
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>共 {state.fovs.length} 个视野</p>
            <h2>视野台账</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>视野</th><th>玻片</th><th>物镜</th><th>像素标尺</th>
                <th>微米值</th><th>µm/px</th><th>校准</th>
              </tr>
            </thead>
            <tbody>
              {state.fovs.map((f) => {
                const factor = micronsPerPixel(f.scalePixels, f.scaleMicrons);
                return (
                  <tr key={f.id}>
                    <td className="mono">{f.id}</td>
                    <td>{f.slide}{f.note ? <em className="note"> {f.note}</em> : null}</td>
                    <td>{f.objective}x</td>
                    <td>{f.scalePixels ?? "—"}</td>
                    <td>{f.scaleMicrons ?? "—"}</td>
                    <td>{factor === null ? "—" : factor.toFixed(4)}</td>
                    <td>
                      <span className={`badge ${isCalibrated(f) ? "badge-ok" : "badge-bad"}`}>
                        {isCalibrated(f) ? "已校准" : "标尺缺失"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
