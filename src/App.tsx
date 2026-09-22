import "./styles.css";
import { useState } from "react";
import type { Fov, MosaicVersion, TabKey } from "./types";
import { useBenchState } from "./useBenchState";
import RegisterTab from "./components/RegisterTab";
import StitchTab from "./components/StitchTab";
import MeasureTab from "./components/MeasureTab";
import ArchiveTab from "./components/ArchiveTab";

const project = {
  id: "hxwl-06",
  port: 5106,
  title: "视野拼接与测量校准台",
  subtitle:
    "视野登记标尺校准 · 相邻视野整批校验拼接 · 标尺快照测量 · 归档冻结与复核版本",
  stack: "React + Vite + TypeScript + CSS（数据 / 规则 / 界面分层）",
};

const TABS: { key: TabKey; label: string }[] = [
  { key: "register", label: "① 视野登记" },
  { key: "stitch", label: "② 视野拼接" },
  { key: "measure", label: "③ 测量校准" },
  { key: "archive", label: "④ 归档复核" },
];

function App() {
  const { state, setState, reset } = useBenchState();
  const [tab, setTab] = useState<TabKey>("register");

  const calibrated = state.fovs.filter(
    (f: Fov) => typeof f.scalePixels === "number" && typeof f.scaleMicrons === "number"
  ).length;
  const activeMosaics = state.mosaics.filter((m: MosaicVersion) => m.status !== "history").length;
  const archived = state.mosaics.filter((m: MosaicVersion) => m.status === "archived").length;

  const metrics = [
    { label: "登记视野", value: state.fovs.length, cls: "status-ok" },
    { label: "已校准视野", value: calibrated, cls: "status-ok" },
    { label: "在档拼接图", value: activeMosaics, cls: "status-watch" },
    { label: "已冻结 / 测量", value: `${archived} / ${state.measurements.length}`, cls: "status-danger" },
  ];

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">{project.id} · port {project.port}</p>
          <h1>{project.title}</h1>
          <p className="subtitle">{project.subtitle}</p>
        </div>
        <div className="stack-card">
          <span>技术栈与分层</span>
          <strong>{project.stack}</strong>
          <button onClick={reset} className="reset-btn">重置为示例数据</button>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((m) => (
          <article key={m.label} className="metric-card">
            <span>{m.label}</span>
            <strong>{m.value}</strong>
            <i className={m.cls} />
          </article>
        ))}
      </section>

      <nav className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab-btn ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "register" && <RegisterTab state={state} setState={setState} />}
      {tab === "stitch" && <StitchTab state={state} setState={setState} />}
      {tab === "measure" && <MeasureTab state={state} setState={setState} />}
      {tab === "archive" && <ArchiveTab state={state} setState={setState} />}

      <footer className="rules-foot">
        <p>
          规则：标尺缺失 / 倍率不匹配 / 相邻重叠不足 → 整批拒绝并逐视野列因；
          同一坐标只能归入一个拼接图，方向冲突不覆盖原图；测量按标尺快照冻结，
          事后改倍率不重算；归档后冻结，复核另存原因与旧版本；刷新后状态一致。
        </p>
      </footer>
    </main>
  );
}

export default App;
