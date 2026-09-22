import { useMemo, useState } from "react";
import type { Slide } from "../domain/types";
import { formatTime } from "../domain/format";
import { useApp } from "../state";
import { Badge, Banner, EmptyHint, type OpResultView } from "./common";

export function ArchivePanel({ slide }: { slide: Slide }) {
  const app = useApp();
  const [reviewFor, setReviewFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<OpResultView | null>(null);
  const [openVersion, setOpenVersion] = useState<string | null>(null);

  const stitches = useMemo(
    () =>
      app.data.stitches
        .filter((s) => s.slideId === slide.id)
        .sort((a, b) => (b.archivedAt ?? b.createdAt) - (a.archivedAt ?? a.createdAt)),
    [app.data.stitches, slide.id],
  );

  const reviews = useMemo(
    () => app.data.reviews.filter((r) => stitches.some((s) => s.id === r.stitchId)),
    [app.data.reviews, stitches],
  );

  function submitReview(stitchId: string) {
    const res = app.addReview(stitchId, reason);
    setFeedback({ kind: res.ok ? "success" : "error", message: res.message });
    if (res.ok) {
      setReason("");
      setReviewFor(null);
    }
  }

  return (
    <div className="stack-gap">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>归档冻结</p>
            <h2>{slide.name} 的拼接图版本</h2>
          </div>
        </div>
        <p className="rule-note">
          归档后<b>拼接结构、视野与测量全部冻结</b>，不能编辑、追加或删除；如需变更只能
          <b>发起复核并另存</b>：记录复核原因，并把当时的旧版本完整留档，冻结原件不动。
        </p>

        {stitches.length === 0 && <EmptyHint>暂无拼接图。</EmptyHint>}
        <div className="stack-gap">
          {stitches.map((stitch) => {
            const frozen = stitch.status === "archived";
            const measCount = app.data.measurements.filter(
              (m) => m.stitchId === stitch.id,
            ).length;
            return (
              <article key={stitch.id} className={`archive-card${frozen ? " is-frozen" : ""}`}>
                <div className="stitch-head">
                  <div>
                    <h3>
                      {stitch.title} <span className="version-tag">v{stitch.version}</span>
                    </h3>
                    <p className="stitch-sub">
                      {stitch.objective}x · {stitch.entries.length} 视野 · {measCount} 条测量
                      {frozen
                        ? ` · 归档于 ${formatTime(stitch.archivedAt)}`
                        : " · 尚未归档（草稿）"}
                    </p>
                  </div>
                  {frozen ? <Badge tone="info">已冻结</Badge> : <Badge tone="ok">草稿</Badge>}
                </div>
                <ol className="archive-entries">
                  {stitch.entries.map((e, i) => {
                    const fov = app.data.fields.find((f) => f.id === e.fovId);
                    return (
                      <li key={e.fovId}>
                        {i + 1}. {fov?.label ?? "视野已删除"}
                        {fov?.coord && ` (${fov.coord.x}, ${fov.coord.y})`}
                        {i > 0 && e.overlapPct !== null && ` · 重叠 ${e.overlapPct}%`}
                      </li>
                    );
                  })}
                </ol>
                {frozen && (
                  <div className="inline-actions">
                    <button
                      onClick={() => {
                        setReviewFor(reviewFor === stitch.id ? null : stitch.id);
                        setOpenVersion(null);
                      }}
                    >
                      {reviewFor === stitch.id ? "取消复核" : "发起复核（另存）"}
                    </button>
                  </div>
                )}
                {reviewFor === stitch.id && frozen && (
                  <div className="review-box">
                    <label>
                      <span>复核原因 *（与旧版本分开另存）</span>
                      <textarea
                        rows={3}
                        value={reason}
                        placeholder="如：补入相邻视野 / 标尺登记有误，需重拍复核"
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    <div className="inline-actions">
                      <button
                        className="primary-action"
                        disabled={!reason.trim()}
                        onClick={() => submitReview(stitch.id)}
                      >
                        另存复核记录与旧版本
                      </button>
                    </div>
                    <Banner kind="info">
                      提交后当前 v{stitch.version} 冻结版本会被完整快照留档，冻结原件不发生任何改动。
                    </Banner>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>复核留档</p>
            <h2>原因与旧版本（{reviews.length}）</h2>
          </div>
        </div>
        {reviews.length === 0 && <EmptyHint>暂无复核记录。</EmptyHint>}
        <div className="stack-gap">
          {reviews.map((r) => {
            const snap = r.oldVersion;
            const opened = openVersion === r.id;
            return (
              <article key={r.id} className="review-card">
                <div className="stitch-head">
                  <div>
                    <h3>
                      {r.stitchTitle} <span className="version-tag">旧版 v{r.version}</span>
                    </h3>
                    <p className="stitch-sub">复核于 {formatTime(r.createdAt)}</p>
                  </div>
                  <Badge tone="warn">复核另存</Badge>
                </div>
                <p className="review-reason">
                  <b>原因：</b>
                  {r.reason}
                </p>
                <div className="inline-actions">
                  <button onClick={() => setOpenVersion(opened ? null : r.id)}>
                    {opened ? "收起旧版本" : "查看旧版本快照"}
                  </button>
                </div>
                {opened && (
                  <div className="version-snapshot">
                    <p className="snapshot-title">
                      旧版本快照（保存于 {formatTime(snap.savedAt)}，只读）
                    </p>
                    <ul>
                      {snap.stitch.entries.map((e, i) => {
                        const fov = snap.fields.find((f) => f.id === e.fovId);
                        return (
                          <li key={e.fovId}>
                            {i + 1}. {fov?.label ?? "视野已删除"}
                            {fov && fov.objective !== null && ` · ${fov.objective}x`}
                            {fov &&
                              fov.rulerPixels !== null &&
                              ` · 标尺 ${fov.rulerPixels}px=${fov.rulerMicrons}µm`}
                            {fov?.coord && ` · 坐标 (${fov.coord.x}, ${fov.coord.y})`}
                          </li>
                        );
                      })}
                    </ul>
                    {snap.measurements.length > 0 && (
                      <>
                        <p className="snapshot-title">随附测量（{snap.measurements.length}）</p>
                        <ul>
                          {snap.measurements.map((m) => (
                            <li key={m.id}>
                              {m.label}：{m.pixelLength}px → {m.resultMicrons}µm（按{" "}
                              {m.scaleSnapshot.umPerPixel}µm/px 快照）
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
        {feedback && <Banner kind={feedback.kind}>{feedback.message}</Banner>}
      </section>
    </div>
  );
}
