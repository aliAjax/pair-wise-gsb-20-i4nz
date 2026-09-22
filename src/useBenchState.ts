// ─────────────────────────────────────────────────────────────
// 界面层钩子：内存状态与持久化单一来源，刷新后状态一致
// ─────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import type { BenchState } from "./types";
import { loadState, saveState, resetState } from "./store";

export function useBenchState() {
  const [state, setState] = useState<BenchState>(() => loadState());

  // 任意变更都整体持久化；下次刷新从同一存储恢复
  useEffect(() => {
    saveState(state);
  }, [state]);

  const reset = () => setState(resetState());

  return { state, setState, reset };
}
