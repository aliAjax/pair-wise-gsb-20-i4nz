import { useMemo, useState } from "react";
import type { FieldOfView, ObjectiveMagnification, Slide } from "../domain/types";
import {
  findStitchOfFov,
  getCalibration,
  isFovFrozen,
} from "../domain/rules";
import { formatNumber, formatTime } from "../domain/format";
import { useApp } from "../state";
import {
  Badge,
  Banner,
  EmptyHint,
  ObjectiveSelect,
  OrientationSelect,
  parseNum,
  type OpResultView,
} from "./common";

interface FormState {
  label: string;
  objective: ObjectiveMagnification | null;
  rulerPixels: string;
  rulerMicrons: string;
  x: string;
  y: string;
  orientation: FieldOfView["orientation"];
  note: string;
}

const emptyForm: FormState = {
  label: "",
  objective: null,
  rulerPixels: "",
  rulerMicrons: "",
  x: "",
  y: "",
  orientation: "standard",
  note: "",
};

export function FieldRegistry({ slide }: { slide: Slide }) {
  const app = useApp();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [feedback, setFeedback] = useState<OpResultView | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const slideFields = useMemo(
    () =>
      app.data.fields
        .filter((f) => f.slideId === slide.id)
        .sort((a, b) => a.createdAt - b.createdAt),
    [app.data.fields, slide.id],
  );

  function submit() {
    const label = form.label.trim();
    if (!label) {
      setFeedback({ kind: "error", message: "请填写视野名称" });
      return;
    }
    const hasAnyScale =
      form.objective !== null || form.rulerPixels !== "" || form.rulerMicrons !== "";
    const hasAllScale =
      form.objective !== null && form.rulerPixels !== "" && form.rulerMicrons !== "";
    if (hasAnyScale && !hasAllScale) {
      setFeedback({
        kind: "error",
        message: "标尺必须同时包含物镜倍率、像素标尺与微米值，缺一项即视为标尺缺失",
      });
      return;
    }
    const x = parseNum(form.x);
    const y = parseNum(form.y);
    if ((x === null) !== (y === null)) {
      setFeedback({ kind: "error", message: "载物台坐标需同时填写 X、Y（或都留空）" });
      return;
    }
    const res = app.registerFov({
      slideId: slide.id,
      label,
      objective: form.objective,
      rulerPixels: parseNum(form.rulerPixels),
      rulerMicrons: parseNum(form.rulerMicrons),
      coord: x === null || y === null ? null : { x, y },
      orientation: form.orientation,
      note: form.note.trim(),
    });
    setFeedback({ kind: res.ok ? "success" : "error", message: res.message });
    if (res.ok) setForm(emptyForm);
  }

  return (
    <div className="split-grid">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>视野登记</p>
            <h2>新视野校准信息</h2>
          </div>
        </div>
        <p className="rule-note">
          每个视野必须登记 <b>物镜倍率</b>、<b>像素标尺</b>（标尺像素长度）与
          <b> 微米值</b>（标尺实际长度 µm），并记录载物台坐标与方向。
        </p>
        <div className="field-grid">
          <label>
            <span>视野名称 *</span>
            <input
              value={form.label}
              placeholder="如：表皮-B"
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </label>
          <label>
            <span>物镜倍率</span>
            <ObjectiveSelect
              value={form.objective}
              allowEmpty
              onChange={(v) => setForm({ ...form, objective: v })}
            />
          </label>
          <label>
            <span>像素标尺（px）</span>
            <input
              inputMode="decimal"
              value={form.rulerPixels}
              placeholder="如：200"
              onChange={(e) => setForm({ ...form, rulerPixels: e.target.value })}
            />
          </label>
          <label>
            <span>微米值（µm）</span>
            <input
              inputMode="decimal"
              value={form.rulerMicrons}
              placeholder="如：100"
              onChange={(e) => setForm({ ...form, rulerMicrons: e.target.value })}
            />
          </label>
          <label>
            <span>载物台坐标 X</span>
            <input
              inputMode="numeric"
              value={form.x}
              placeholder="如：100"
              onChange={(e) => setForm({ ...form, x: e.target.value })}
            />
          </label>
          <label>
            <span>载物台坐标 Y</span>
            <input
              inputMode="numeric"
              value={form.y}
              placeholder="如：100"
              onChange={(e) => setForm({ ...form, y: e.target.value })}
            />
          </label>
          <label>
            <span>图像方向</span>
            <OrientationSelect
              value={form.orientation}
              onChange={(v) => setForm({ ...form, orientation: v })}
            />
          </label>
          <label>
            <span>观察备注</span>
            <input
              value={form.note}
              placeholder="结构、染色等观察描述"
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
        </div>
        <div className="form-actions">
          <button className="primary-action" onClick={submit}>
            登记视野
          </button>
        </div>
        {feedback && <Banner kind={feedback.kind}>{feedback.message}</Banner>}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>{slide.name}</p>
            <h2>视野台账（{slideFields.length}）</h2>
          </div>
        </div>
        {slideFields.length === 0 && <EmptyHint>该玻片还没有视野记录。</EmptyHint>}
        <div className="fov-list">
          {slideFields.map((fov) => (
            <FovRow
              key={fov.id}
              fov={fov}
              editing={editingId === fov.id}
              onStartEdit={() => {
                setEditingId(fov.id);
                setFeedback(null);
              }}
              onCancelEdit={() => setEditingId(null)}
              onSaved={(res) => {
                setFeedback({ kind: res.ok ? "success" : "error", message: res.message });
                if (res.ok) setEditingId(null);
              }}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function FovRow({
  fov,
  editing,
  onStartEdit,
  onCancelEdit,
  onSaved,
}: {
  fov: FieldOfView;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaved: (res: { ok: boolean; message: string }) => void;
}) {
  const app = useApp();
  const cal = getCalibration(fov);
  const frozen = isFovFrozen(app.data, fov.id);
  const stitch = findStitchOfFov(app.data, fov.id);

  const [draft, setDraft] = useState<{
    objective: ObjectiveMagnification | null;
    rulerPixels: string;
    rulerMicrons: string;
    orientation: FieldOfView["orientation"];
  }>({
    objective: fov.objective,
    rulerPixels: fov.rulerPixels === null ? "" : String(fov.rulerPixels),
    rulerMicrons: fov.rulerMicrons === null ? "" : String(fov.rulerMicrons),
    orientation: fov.orientation,
  });

  if (editing) {
    const save = () => {
      const rp = parseNum(draft.rulerPixels);
      const rm = parseNum(draft.rulerMicrons);
      const hasAny = draft.objective !== null || rp !== null || rm !== null;
      const hasAll = draft.objective !== null && rp !== null && rm !== null;
      if (hasAny && !hasAll) {
        onSaved({ ok: false, message: "标尺三项（倍率/像素/微米）必须同时存在或同时清空" });
        return;
      }
      if ((rp !== null && rp <= 0) || (rm !== null && rm <= 0)) {
        onSaved({ ok: false, message: "像素标尺与微米值必须为正数" });
        return;
      }
      const res = app.updateFov(fov.id, {
        objective: draft.objective,
        rulerPixels: rp,
        rulerMicrons: rm,
        orientation: draft.orientation,
      });
      onSaved(res);
    };
    return (
      <article className="fov-card fov-edit">
        <h3>{fov.label}</h3>
        <div className="fov-edit-grid">
          <label>
            <span>物镜倍率</span>
            <ObjectiveSelect
              value={draft.objective}
              allowEmpty
              onChange={(v) => setDraft({ ...draft, objective: v })}
            />
          </label>
          <label>
            <span>像素标尺（px）</span>
            <input
              value={draft.rulerPixels}
              onChange={(e) => setDraft({ ...draft, rulerPixels: e.target.value })}
            />
          </label>
          <label>
            <span>微米值（µm）</span>
            <input
              value={draft.rulerMicrons}
              onChange={(e) => setDraft({ ...draft, rulerMicrons: e.target.value })}
            />
          </label>
          <label>
            <span>方向</span>
            <OrientationSelect
              value={draft.orientation}
              onChange={(v) => setDraft({ ...draft, orientation: v })}
            />
          </label>
        </div>
        <div className="inline-actions">
          <button className="primary-action" onClick={save}>
            保存修改
          </button>
          <button onClick={onCancelEdit}>取消</button>
        </div>
      </article>
    );
  }

  return (
    <article className={`fov-card${frozen ? " is-frozen" : ""}`}>
      <div className="fov-head">
        <h3>{fov.label}</h3>
        <div className="fov-badges">
          {frozen ? (
            <Badge tone="info">已冻结</Badge>
          ) : cal ? (
            <Badge tone="ok">校准完成</Badge>
          ) : (
            <Badge tone="danger">标尺缺失</Badge>
          )}
          {stitch && (
            <Badge tone={stitch.status === "archived" ? "info" : "muted"}>
              {stitch.status === "archived" ? "归档于 " : "草稿于 "}
              {stitch.title}
            </Badge>
          )}
        </div>
      </div>
      <dl className="fov-meta">
        <div>
          <dt>倍率</dt>
          <dd>{fov.objective === null ? "—" : `${fov.objective}x`}</dd>
        </div>
        <div>
          <dt>像素标尺</dt>
          <dd>{fov.rulerPixels === null ? "—" : `${fov.rulerPixels} px`}</dd>
        </div>
        <div>
          <dt>微米值</dt>
          <dd>{fov.rulerMicrons === null ? "—" : `${fov.rulerMicrons} µm`}</dd>
        </div>
        <div>
          <dt>换算</dt>
          <dd>{cal ? `${formatNumber(cal.umPerPixel)} µm/px` : "—"}</dd>
        </div>
        <div>
          <dt>坐标</dt>
          <dd>{fov.coord ? `(${fov.coord.x}, ${fov.coord.y})` : "未登记"}</dd>
        </div>
        <div>
          <dt>方向</dt>
          <dd>
            {fov.orientation === "standard"
              ? "标准"
              : fov.orientation === "r90"
                ? "旋转 90°"
                : fov.orientation === "r180"
                  ? "旋转 180°"
                  : "旋转 270°"}
          </dd>
        </div>
      </dl>
      {fov.note && <p className="fov-note">{fov.note}</p>}
      <div className="fov-foot">
        <span className="fov-time">登记于 {formatTime(fov.createdAt)}</span>
        <div className="inline-actions">
          <button onClick={onStartEdit} disabled={frozen} title={frozen ? "归档视野冻结" : ""}>
            调整倍率/标尺
          </button>
          <button
            className="danger-btn"
            disabled={!!stitch}
            title={stitch ? `已归入「${stitch.title}」，不可直接删除` : ""}
            onClick={() => {
              const res = app.removeFov(fov.id);
              onSaved(res);
            }}
          >
            删除
          </button>
        </div>
      </div>
    </article>
  );
}
