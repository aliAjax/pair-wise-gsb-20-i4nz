// 界面层：测量校准。测量在保存瞬间接受标尺快照并换算；
// 之后修改视野倍率 / 标尺，不回改、不重算任何已保存结果。
import { useEffect, useState } from "react";
import type { BenchState, Fov } from "../types";
import {
  isCalibrated,
  isSnapshotStale,
  micronsPerPixel,
} from "../rules/calibration";
import { addMeasurement } from "../store";

interface Props {
  state: BenchState;
  setState: (updater: (s: BenchState) => BenchState) => void;
}

export default function MeasureTab({ state, setState }: Props) {
  const calibratedFovs = state.fovs.filter(isCalibrated);
  const [fovId, setFovId] = useState(calibratedFovs[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [lengthPixels, setLengthPixels] = useState("");
  const [error, setError] = useState<string | null>(null);

  // 选中视野被删除或标尺变为缺失时，回落到第一个仍可测量的视野
  useEffect(() => {
    if (!calibratedFovs.some((f) => f.id === fovId)) {
      setFovId(calibratedFovs[0]?.id ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fovs]);

  const fov: Fov | undefined = state.fovs.find((f) => f.id === fovId);
  const factor = fov ? micronsPerPixel(fov.scalePixels, fov.scaleMicrons) : null;
  const previewLength =
    factor !== null && Number(lengthPixels) > 0
      ? Math.round(Number(lengthPixels) * factor * 1000) / 1000
      : null;

  const save = () => {
    if (!fov) return;
    const px = Number(lengthPixels);
    const outcome = addMeasurement(state, {
      fovId: fov.id,
      label: label.trim() || `测量 ${state.measurements.length + 1}`,
      lengthPixels: px,
    });
    if (outcome.error) {
      setError(outcome.error);
      return;
    }
    setState(() => outcome.state);
    setError(null);
    setLengthPixels("");
    setLabel("");
  };

  return (
    <div className="tab-grid">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>测量校准台</p>
            <h2>按标尺快照换算</h2>
          </div>
        </div>

        {calibratedFovs.length === 0 && (
          <p className="hint hint-bad">没有已校准视野：请先在「视野登记」补齐像素标尺与微米值。</p>
        )}

        <div className="field-grid">
          <label className="wide">
            <span>选择视野（仅可对已校准视野测量）</span>
            <select value={fovId} onChange={(e) => setFovId(e.target.value)}>
              <option value="" disabled>请选择视野</option>
              {state.fovs.map((f) => (
                <option key={f.id} value={f.id} disabled={!isCalibrated(f)}>
                  {f.id} · {f.slide} · {f.objective}x
                  {isCalibrated(f) ? "" : "（标尺缺失，不可测量）"}
                </option>
              ))}
            </select>
          </label>

          {fov && (
            <div className="snapshot-box">
              <p>当前登记（仅作为即将接受的快照来源）</p>
              <div className="snapshot-grid">
                <span>物镜 <strong>{fov.objective}x</strong></span>
                <span>像素标尺 <strong>{fov.scalePixels} px</strong></span>
                <span>微米值 <strong>{fov.scaleMicrons} µm</strong></span>
                <span>换算 <strong>{factor?.toFixed(4)} µm/px</strong></span>
              </div>
            </div>
          )}

          <label>
            <span>测量名称</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="如：细胞长径" />
          </label>
          <label>
            <span>测量长度（px）</span>
            <input
              value={lengthPixels}
              onChange={(e) => setLengthPixels(e.target.value)}
              inputMode="decimal"
              placeholder="如：86"
            />
          </label>
        </div>

        {previewLength !== null && (
          <p className="hint hint-ok">
            接受校准后将记为 <strong>{previewLength} µm</strong>（按上述快照冻结）
          </p>
        )}
        {error && <p className="hint hint-bad">{error}</p>}

        <div className="form-footer">
          <span className="hint">保存即冻结快照；事后调整倍率不会重算此结果。</span>
          <button className="primary-action" onClick={save} disabled={!fov || !(Number(lengthPixels) > 0)}>
            接受校准并保存测量
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>共 {state.measurements.length} 条</p>
            <h2>已保存测量（冻结）</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>测量</th><th>视野</th><th>px</th><th>µm</th>
                <th>依据快照</th><th>一致性</th>
              </tr>
            </thead>
            <tbody>
              {state.measurements.map((m) => {
                const owner = state.fovs.find((f) => f.id === m.fovId);
                const stale = owner ? isSnapshotStale(owner, m.snapshot) : false;
                return (
                  <tr key={m.id}>
                    <td>{m.label}</td>
                    <td className="mono">{m.fovId}</td>
                    <td>{m.lengthPixels}</td>
                    <td><strong>{m.lengthMicrons}</strong></td>
                    <td className="snapshot-cell">
                      {m.snapshot.objective}x · {m.snapshot.scalePixels}px=
                      {m.snapshot.scaleMicrons}µm · {m.snapshot.micronsPerPixel.toFixed(4)}
                      <br /><time>{new Date(m.snapshot.acceptedAt).toLocaleString("zh-CN")}</time>
                    </td>
                    <td>
                      {stale ? (
                        <span className="badge badge-warn" title="视野倍率/标尺已改变，但已保存测量仍按旧快照，不重算">
                          标尺已更新·结果不重算
                        </span>
                      ) : (
                        <span className="badge badge-ok">一致</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {state.measurements.length === 0 && <p className="hint">尚无测量记录。</p>}
      </section>
    </div>
  );
}
