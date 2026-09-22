import { useMemo, useState } from "react";
import type { FieldOfView, Slide } from "../domain/types";
import {
  findStitchOfFov,
  getCalibration,
  measurementBlockedReason,
} from "../domain/rules";
import { formatNumber, formatTime, round2 } from "../domain/format";
import { useApp } from "../state";
import { Badge, Banner, EmptyHint, parseNum, type OpResultView } from "./common";

export function MeasureLab({ slide }: { slide: Slide }) {
  const app = useApp();
  const [fovId, setFovId] = useState("");
  const [label, setLabel] = useState("");
  const [pixels, setPixels] = useState("");
  const [feedback, setFeedback] = useState<OpResultView | null>(null);

  const slideFields = useMemo(
    () =>
      app.data.fields
        .filter((f) => f.slideId === slide.id)
        .sort((a, b) => a.createdAt - b.createdAt),
    [app.data.fields, slide.id],
  );

  const selected: FieldOfView | undefined = slideFields.find((f) => f.id === fovId);
  const cal = selected ? getCalibration(selected) : null;
  const blocked = selected ? measurementBlockedReason(app.data, selected) : null;
  const stitch = selected ? findStitchOfFov(app.data, selected.id) : null;

  const previewPx = parseNum(pixels);
  const preview = cal && previewPx !== null ? previewPx * cal.umPerPixel : null;

  const slideMeasurements = useMemo(() => {
    const ids = new Set(slideFields.map((f) => f.id));
    return app.data.measurements
      .filter((m) => ids.has(m.fovId))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [app.data.measurements, slideFields]);

  function submit() {
    if (!selected) {
      setFeedback({ kind: "error", message: "请选择测量视野" });
      return;
    }
    const px = parseNum(pixels);
    const res = app.saveMeasurement({
      fovId: selected.id,
      label,
      pixelLength: px === null ? NaN : px,
    });
    setFeedback({ kind: res.ok ? "success" : "error", message: res.message });
    if (res.ok) {
      setLabel("");
      setPixels("");
    }
  }

  return (
    <div className="split-grid">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>测量校准</p>
            <h2>按标尺快照换算</h2>
          </div>
        </div>
        <p className="rule-note">
          保存瞬间冻结当时的 <b>物镜倍率 / 像素标尺 / 微米值</b> 为标尺快照（µm/px）。
          之后再调整该视野倍率或标尺，<b>已保存结果不变</b>。
        </p>

        <div className="field-grid">
          <label>
            <span>选择视野</span>
            <select value={fovId} onChange={(e) => { setFovId(e.target.value); setFeedback(null); }}>
              <option value="">— 请选择 —</option>
              {slideFields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                  {f.objective !== null ? `（${f.objective}x）` : "（未校准）"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>测量项目</span>
            <input
              value={label}
              placeholder="如：细胞长径"
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label>
            <span>像素长度（px）</span>
            <input
              value={pixels}
              inputMode="decimal"
              placeholder="如：120"
              onChange={(e) => setPixels(e.target.value)}
            />
          </label>
          <div className="preview-box">
            <span>实时预览（当前标尺）</span>
            <strong>
              {preview === null
                ? "—"
                : `${round2(previewPx as number)}px × ${formatNumber(cal?.umPerPixel)}µm/px = ${formatNumber(preview)}µm`}
            </strong>
          </div>
        </div>

        {selected && (
          <div className="snapshot-strip">
            {cal ? (
              <Badge tone="ok">
                当前标尺：{cal.rulerPixels}px = {cal.rulerMicrons}µm →{" "}
                {formatNumber(cal.umPerPixel)}µm/px
              </Badge>
            ) : (
              <Badge tone="danger">标尺缺失：无法测量</Badge>
            )}
            {stitch && (
              <Badge tone={stitch.status === "archived" ? "info" : "muted"}>
                所属：{stitch.title}
                {stitch.status === "archived" ? "（已冻结）" : "（草稿）"}
              </Badge>
            )}
          </div>
        )}

        {blocked && <Banner kind="error">{blocked}</Banner>}

        <div className="form-actions">
          <button
            className="primary-action"
            disabled={!selected || blocked !== null}
            onClick={submit}
          >
            保存测量（冻结快照）
          </button>
        </div>
        {feedback && <Banner kind={feedback.kind}>{feedback.message}</Banner>}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>测量记录</p>
            <h2>{slide.name}（{slideMeasurements.length}）</h2>
          </div>
        </div>
        {slideMeasurements.length === 0 && <EmptyHint>还没有测量记录。</EmptyHint>}
        <div className="meas-list">
          {slideMeasurements.map((m) => {
            const fov = app.data.fields.find((f) => f.id === m.fovId);
            const currentCal = fov ? getCalibration(fov) : null;
            // 当前标尺与保存快照不一致：提示但不覆盖已保存结果
            const drifted =
              currentCal !== null &&
              (currentCal.objective !== m.scaleSnapshot.objective ||
                Math.abs(currentCal.umPerPixel - m.scaleSnapshot.umPerPixel) > 1e-9);
            const mStitch = m.stitchId
              ? app.data.stitches.find((s) => s.id === m.stitchId)
              : null;
            const frozen = mStitch?.status === "archived";
            return (
              <article key={m.id} className={`meas-card${frozen ? " is-frozen" : ""}`}>
                <div className="meas-head">
                  <div>
                    <h3>{m.label}</h3>
                    <p>
                      视野「{fov?.label ?? "已删除视野"}」 · 保存于 {formatTime(m.createdAt)}
                    </p>
                  </div>
                  <strong className="meas-result">{formatNumber(m.resultMicrons)} µm</strong>
                </div>
                <div className="snapshot-strip wrap">
                  <Badge tone="muted">
                    快照：{m.scaleSnapshot.objective}x · {m.scaleSnapshot.rulerPixels}px ={" "}
                    {m.scaleSnapshot.rulerMicrons}µm · {formatNumber(m.scaleSnapshot.umPerPixel)}
                    µm/px
                  </Badge>
                  <Badge tone="muted">{m.pixelLength} px</Badge>
                  {frozen && <Badge tone="info">随归档冻结</Badge>}
                  {drifted && (
                    <Badge tone="warn">
                      当前视野标尺已变为 {formatNumber(currentCal?.umPerPixel)}µm/px（
                      {currentCal?.objective}x），本记录仍按旧快照 {formatNumber(m.scaleSnapshot.umPerPixel)}
                      µm/px 计算
                    </Badge>
                  )}
                </div>
                {!frozen && (
                  <div className="inline-actions">
                    <button
                      className="danger-btn"
                      onClick={() => {
                        const res = app.removeMeasurement(m.id);
                        setFeedback({
                          kind: res.ok ? "success" : "error",
                          message: res.message,
                        });
                      }}
                    >
                      删除
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
