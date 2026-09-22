import { useMemo, useState } from "react";
import "./styles.css";
import { AppProvider, useApp } from "./state";
import { isFovCalibrated, isStitchFrozen } from "./domain/rules";
import { FieldRegistry } from "./components/FieldRegistry";
import { StitchWorkbench } from "./components/StitchWorkbench";
import { MeasureLab } from "./components/MeasureLab";
import { ArchivePanel } from "./components/ArchivePanel";

const TABS = [
  { id: "fields", label: "视野登记" },
  { id: "stitch", label: "拼接工作台" },
  { id: "measure", label: "测量校准" },
  { id: "archive", label: "归档与复核" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function Dashboard() {
  const app = useApp();
  const [slideId, setSlideId] = useState(app.data.slides[0]?.id ?? "");
  const [tab, setTab] = useState<TabId>("fields");

  const slide = app.data.slides.find((s) => s.id === slideId) ?? app.data.slides[0];

  const metrics = useMemo(() => {
    const fields = app.data.fields;
    const calibrated = fields.filter(isFovCalibrated).length;
    const stitches = app.data.stitches;
    const frozen = stitches.filter(isStitchFrozen).length;
    return [
      { label: "玻片样本", value: String(app.data.slides.length) },
      { label: "视野（已校准 / 总数）", value: `${calibrated} / ${fields.length}` },
      { label: "拼接图（归档 / 总数）", value: `${frozen} / ${stitches.length}` },
      { label: "测量记录", value: String(app.data.measurements.length) },
      { label: "复核留档", value: String(app.data.reviews.length) },
    ];
  }, [app.data]);

  if (!slide) {
    return (
      <main className="app-shell">
        <p>暂无玻片数据。</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-06 · port 5106</p>
          <h1>视野拼接与测量校准台</h1>
          <p className="subtitle">
            每个视野登记物镜倍率、像素标尺与微米值；拼接整批校验、坐标唯一、方向冲突不覆盖；
            测量按标尺快照换算；归档冻结，复核另存原因与旧版本。刷新后状态一致。
          </p>
        </div>
        <div className="stack-card">
          <span>分层</span>
          <strong>数据 · 规则 · 界面</strong>
          <span>React + Vite + TypeScript，localStorage 持久化</span>
        </div>
      </section>

      <section className="metrics-grid metrics-grid-5">
        {metrics.map((m) => (
          <article key={m.label} className="metric-card">
            <span>{m.label}</span>
            <strong>{m.value}</strong>
            <i className="status-ok" />
          </article>
        ))}
      </section>

      <section className="panel slide-bar">
        <div className="slide-selector">
          <span className="bar-label">当前玻片</span>
          <div className="chips">
            {app.data.slides.map((s) => (
              <button
                key={s.id}
                className={s.id === slide.id ? "chip-active" : ""}
                onClick={() => setSlideId(s.id)}
              >
                {s.name}
                <small>
                  {s.category} · {s.stain}
                </small>
              </button>
            ))}
          </div>
        </div>
        <button
          className="reset-btn"
          onClick={() => {
            if (window.confirm("重置为演示数据？当前所有修改将被清除。")) {
              app.resetDemo();
              setSlideId(app.data.slides[0]?.id ?? "");
              setTab("fields");
            }
          }}
        >
          重置演示数据
        </button>
      </section>

      <nav className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "tab-active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "fields" && <FieldRegistry slide={slide} />}
      {tab === "stitch" && <StitchWorkbench slide={slide} />}
      {tab === "measure" && <MeasureLab slide={slide} />}
      {tab === "archive" && <ArchivePanel slide={slide} />}
    </main>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Dashboard />
    </AppProvider>
  );
}
