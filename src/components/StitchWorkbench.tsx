import { useMemo, useState } from "react";
import type { FieldOfView, ObjectiveMagnification, Slide, Stitch } from "../domain/types";
import {
  archiveBlockedReasons,
  findStitchOfFov,
  getCalibration,
  MIN_OVERLAP_PCT,
} from "../domain/rules";
import { formatTime } from "../domain/format";
import { useApp } from "../state";
import {
  Badge,
  Banner,
  EmptyHint,
  ObjectiveSelect,
  parseNum,
  RejectionPanel,
  type OpResultView,
} from "./common";

interface CompItem {
  fovId: string;
  overlapPct: string; // 首视野留空
}

export function StitchWorkbench({ slide }: { slide: Slide }) {
  const app = useApp();
  const [feedback, setFeedback] = useState<OpResultView | null>(null);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState<ObjectiveMagnification | null>(400);
  const [items, setItems] = useState<CompItem[]>([]);

  const slideStitches = useMemo(
    () =>
      app.data.stitches
        .filter((s) => s.slideId === slide.id)
        .sort((a, b) => b.createdAt - a.createdAt),
    [app.data.stitches, slide.id],
  );

  const fieldsById = useMemo(
    () => new Map(app.data.fields.map((f) => [f.id, f])),
    [app.data.fields],
  );

  // 可用于新拼接图的视野：本玻片、当前不属于任何拼接图
  const available = useMemo(
    () =>
      app.data.fields
        .filter((f) => f.slideId === slide.id)
        .filter((f) => !findStitchOfFov(app.data, f.id))
        .sort((a, b) => a.createdAt - b.createdAt),
    [app.data, slide.id],
  );

  const chosenIds = new Set(items.map((i) => i.fovId));

  function addItem(fovId: string) {
    setItems((prev) => [...prev, { fovId, overlapPct: prev.length === 0 ? "" : "30" }]);
    setFeedback(null);
  }

  function move(index: number, delta: number) {
    setItems((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      // 首视野无前邻重叠
      next[0] = { ...next[0], overlapPct: "" };
      return next;
    });
  }

  function removeItem(fovId: string) {
    setItems((prev) => {
      const next = prev.filter((i) => i.fovId !== fovId);
      if (next.length > 0) next[0] = { ...next[0], overlapPct: "" };
      return next;
    });
  }

  function submitBatch() {
    if (objective === null) {
      setFeedback({ kind: "error", message: "请先选择拼接图的目标物镜倍率" });
      return;
    }
    if (items.length < 1) {
      setFeedback({ kind: "error", message: "请至少选择 1 个视野" });
      return;
    }
    for (let i = 1; i < items.length; i++) {
      const v = parseNum(items[i].overlapPct);
      if (v === null) {
        const fov = fieldsById.get(items[i].fovId);
        setFeedback({
          kind: "error",
          message: `视野「${fov?.label ?? i + 1}」缺少与相邻视野的重叠率`,
        });
        return;
      }
    }
    const res = app.createStitch({
      slideId: slide.id,
      title,
      objective,
      items: items.map((item, index) => ({
        fovId: item.fovId,
        overlapPct: index === 0 ? null : parseNum(item.overlapPct),
      })),
    });
    setFeedback({
      kind: res.ok ? "success" : "error",
      message: res.message,
      rejections: res.rejections,
    });
    if (res.ok) {
      setItems([]);
      setTitle("");
    }
  }

  return (
    <div className="stack-gap">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>批量拼接</p>
            <h2>组装新拼接图</h2>
          </div>
        </div>
        <p className="rule-note">
          整批提交、原子校验：任一视野 <b>标尺缺失</b>、<b>倍率与目标不匹配</b>、
          <b> 相邻重叠不足（&lt; {MIN_OVERLAP_PCT}%）</b>、<b>坐标缺失/重复/已归他图</b> 或
          <b> 方向冲突</b>，整批拒绝且不写入任何数据，并逐视野列出原因。
        </p>

        <div className="composer-controls">
          <label className="title-input">
            <span>拼接图名称</span>
            <input
              value={title}
              placeholder="如：表皮 400x 全幅"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="objective-input">
            <span>目标倍率</span>
            <ObjectiveSelect value={objective} allowEmpty onChange={setObjective} />
          </label>
        </div>

        <div className="composer-body">
          <div className="composer-pool">
            <h3>可选视野（未归属拼接图）</h3>
            {available.length === 0 && <EmptyHint>本玻片视野已全部归属拼接图。</EmptyHint>}
            {available.map((fov) => {
              const cal = getCalibration(fov);
              const mismatch = objective !== null && fov.objective !== null && fov.objective !== objective;
              return (
                <button
                  key={fov.id}
                  className={`pool-item${chosenIds.has(fov.id) ? " is-chosen" : ""}`}
                  disabled={chosenIds.has(fov.id)}
                  onClick={() => addItem(fov.id)}
                >
                  <span className="pool-label">{fov.label}</span>
                  <span className="pool-meta">
                    {fov.objective === null ? "倍率—" : `${fov.objective}x`}
                    {" · "}
                    {fov.coord ? `(${fov.coord.x},${fov.coord.y})` : "无坐标"}
                  </span>
                  {!cal && <Badge tone="danger">标尺缺失</Badge>}
                  {mismatch && <Badge tone="warn">倍率不符</Badge>}
                </button>
              );
            })}
          </div>

          <div className="composer-sequence">
            <h3>拼接顺序（{items.length}）</h3>
            {items.length === 0 && (
              <EmptyHint>从左侧选择视野，按载物台移动顺序排列。</EmptyHint>
            )}
            {items.map((item, index) => {
              const fov = fieldsById.get(item.fovId);
              if (!fov) return null;
              return (
                <div key={`${item.fovId}-${index}`} className="seq-item">
                  <span className="seq-index">{index + 1}</span>
                  <div className="seq-main">
                    <strong>{fov.label}</strong>
                    <span>
                      {fov.objective ?? "—"}x
                      {fov.coord ? ` · (${fov.coord.x}, ${fov.coord.y})` : " · 无坐标"}
                    </span>
                  </div>
                  <div className="seq-overlap">
                    {index === 0 ? (
                      <Badge tone="muted">首视野</Badge>
                    ) : (
                      <label>
                        与前邻重叠 %
                        <input
                          value={item.overlapPct}
                          inputMode="numeric"
                          className={
                            parseNum(item.overlapPct) !== null &&
                            (parseNum(item.overlapPct) as number) < MIN_OVERLAP_PCT
                              ? "input-bad"
                              : ""
                          }
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((it, i) =>
                                i === index ? { ...it, overlapPct: e.target.value } : it,
                              ),
                            )
                          }
                        />
                      </label>
                    )}
                  </div>
                  <div className="seq-ops">
                    <button disabled={index === 0} onClick={() => move(index, -1)}>
                      ↑
                    </button>
                    <button
                      disabled={index === items.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                    <button className="danger-btn" onClick={() => removeItem(item.fovId)}>
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
            {items.length > 0 && (
              <button className="primary-action composer-submit" onClick={submitBatch}>
                整批校验并生成拼接图
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>拼接图</p>
            <h2>{slide.name} 的拼接图（{slideStitches.length}）</h2>
          </div>
        </div>
        {slideStitches.length === 0 && <EmptyHint>暂无拼接图。</EmptyHint>}
        <div className="stack-gap">
          {slideStitches.map((stitch) => (
            <StitchCard
              key={stitch.id}
              stitch={stitch}
              fieldsById={fieldsById}
              available={available}
              onFeedback={setFeedback}
            />
          ))}
        </div>
        {feedback && (
          <>
            <Banner kind={feedback.kind}>{feedback.message}</Banner>
            {feedback.rejections && feedback.rejections.length > 0 && (
              <RejectionPanel rejections={feedback.rejections} />
            )}
          </>
        )}
      </section>
    </div>
  );
}

function StitchCard({
  stitch,
  fieldsById,
  available,
  onFeedback,
}: {
  stitch: Stitch;
  fieldsById: Map<string, FieldOfView>;
  available: FieldOfView[];
  onFeedback: (f: OpResultView) => void;
}) {
  const app = useApp();
  const frozen = stitch.status === "archived";
  const [appendOpen, setAppendOpen] = useState(false);
  const [appendIds, setAppendIds] = useState<{ fovId: string; overlapPct: string }[]>([]);

  const archiveReasons = useMemo(
    () => (frozen ? [] : archiveBlockedReasons(app.data, stitch)),
    [app.data, stitch, frozen],
  );

  function doArchive() {
    const res = app.archiveStitch(stitch.id);
    onFeedback({ kind: res.ok ? "success" : "error", message: res.message });
  }

  function doAppend() {
    const res = app.appendToStitch(
      stitch.id,
      appendIds.map((item) => ({ fovId: item.fovId, overlapPct: parseNum(item.overlapPct) })),
    );
    onFeedback({
      kind: res.ok ? "success" : "error",
      message: res.message,
      rejections: res.rejections,
    });
    if (res.ok) {
      setAppendIds([]);
      setAppendOpen(false);
    }
  }

  return (
    <article className={`stitch-card${frozen ? " is-frozen" : ""}`}>
      <div className="stitch-head">
        <div>
          <h3>
            {stitch.title} <span className="version-tag">v{stitch.version}</span>
          </h3>
          <p className="stitch-sub">
            {stitch.objective}x · {stitch.entries.length} 个视野 · 创建于{" "}
            {formatTime(stitch.createdAt)}
            {frozen && stitch.archivedAt && ` · 归档于 ${formatTime(stitch.archivedAt)}`}
          </p>
        </div>
        <div>
          {frozen ? <Badge tone="info">已归档冻结</Badge> : <Badge tone="ok">草稿</Badge>}
        </div>
      </div>

      <ol className="stitch-entries">
        {stitch.entries.map((entry, index) => {
          const fov = fieldsById.get(entry.fovId);
          if (!fov) return null;
          const overlapBad =
            index > 0 &&
            (entry.overlapPct === null || entry.overlapPct < MIN_OVERLAP_PCT);
          return (
            <li key={entry.fovId} className="entry-row">
              <span className="seq-index">{index + 1}</span>
              <div className="entry-main">
                <strong>{fov.label}</strong>
                <span>
                  {fov.objective}x
                  {fov.coord && ` · (${fov.coord.x}, ${fov.coord.y})`}
                </span>
              </div>
              <div>
                {index === 0 ? (
                  <Badge tone="muted">首视野</Badge>
                ) : entry.overlapPct === null ? (
                  <Badge tone="warn">重叠待登记</Badge>
                ) : (
                  <Badge tone={overlapBad ? "warn" : "ok"}>重叠 {entry.overlapPct}%</Badge>
                )}
              </div>
              {!frozen && (
                <div className="entry-edit">
                  <input
                    aria-label="重叠率"
                    value={entry.overlapPct === null ? "" : String(entry.overlapPct)}
                    inputMode="numeric"
                    placeholder="重叠%"
                    onChange={(e) =>
                      app.setEntryOverlap(stitch.id, entry.fovId, parseNum(e.target.value))
                    }
                  />
                  <button
                    className="danger-btn"
                    onClick={() =>
                      onFeedback({
                        kind: "info",
                        message: app.removeEntry(stitch.id, entry.fovId).message,
                      })
                    }
                  >
                    移除
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {!frozen && (
        <>
          {archiveReasons.length > 0 && (
            <div className="archive-block">
              <strong>归档前需修复：</strong>
              <ul>
                {archiveReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {appendOpen && (
            <div className="append-box">
              <h4>追加视野（同样整批校验，不通过则原图不变）</h4>
              <div className="append-pool">
                {available
                  .filter((f) => !appendIds.some((a) => a.fovId === f.id))
                  .map((fov) => (
                    <button
                      key={fov.id}
                      className="pool-item"
                      onClick={() =>
                        setAppendIds((prev) => [
                          ...prev,
                          { fovId: fov.id, overlapPct: "30" },
                        ])
                      }
                    >
                      <span className="pool-label">{fov.label}</span>
                      <span className="pool-meta">
                        {fov.objective ?? "—"}x
                        {fov.coord && ` · (${fov.coord.x},${fov.coord.y})`}
                      </span>
                    </button>
                  ))}
              </div>
              {appendIds.map((a, i) => {
                const fov = fieldsById.get(a.fovId);
                return (
                  <div key={a.fovId} className="seq-item">
                    <span className="seq-index">+{i + 1}</span>
                    <div className="seq-main">
                      <strong>{fov?.label}</strong>
                    </div>
                    <label className="seq-overlap">
                      与前邻重叠 %
                      <input
                        value={a.overlapPct}
                        inputMode="numeric"
                        onChange={(e) =>
                          setAppendIds((prev) =>
                            prev.map((it, j) =>
                              j === i ? { ...it, overlapPct: e.target.value } : it,
                            ),
                          )
                        }
                      />
                    </label>
                    <button
                      className="danger-btn"
                      onClick={() =>
                        setAppendIds((prev) => prev.filter((_, j) => j !== i))
                      }
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              <div className="inline-actions">
                <button
                  className="primary-action"
                  disabled={appendIds.length === 0}
                  onClick={doAppend}
                >
                  校验并追加
                </button>
                <button onClick={() => setAppendOpen(false)}>取消</button>
              </div>
            </div>
          )}
          <div className="inline-actions stitch-actions">
            <button onClick={() => setAppendOpen((v) => !v)}>追加视野</button>
            <button
              className="primary-action"
              disabled={archiveReasons.length > 0}
              title={archiveReasons.join("；")}
              onClick={doArchive}
            >
              归档冻结
            </button>
            <button
              className="danger-btn"
              onClick={() => {
                const res = app.removeStitch(stitch.id);
                onFeedback({ kind: res.ok ? "success" : "error", message: res.message });
              }}
            >
              删除草稿
            </button>
          </div>
        </>
      )}
    </article>
  );
}
