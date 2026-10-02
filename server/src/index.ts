import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { RawConfig } from "shared";
import { computePlan } from "./compute.js";
import { reduce } from "./store.js";
import { loadState, saveState } from "./persist.js";
import { exportCsv, exportTxt } from "./exporter.js";
import type { PlannerState } from "shared";

const PORT = Number(process.env.PORT ?? 4000);
const DATA_FILE = process.env.PLATE_DATA_FILE
  ? resolve(process.env.PLATE_DATA_FILE)
  : resolve(process.cwd(), "data", "planner-state.json");
// 兼容从仓库根（npm start -w server 的 cwd 是 server/，直接 tsx 时可能是根）启动
const WEB_DIST_CANDIDATES = [
  resolve(process.cwd(), "web", "dist"), // 仓库根
  resolve(process.cwd(), "..", "web", "dist"), // server/ 目录
];
const WEB_DIST = WEB_DIST_CANDIDATES.find((p) => existsSync(resolve(p, "index.html")));

let state: PlannerState = loadState(DATA_FILE);

function persist() {
  saveState(DATA_FILE, state);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// 打开页面即获取草稿与已确认方案（重新打开页面可找回冻结方案核对）
app.get("/api/state", (_req, res) => {
  res.json({ ok: true, state });
});

// 所有计算只在服务端发生；前端只提交原始输入与孔位安排
app.post("/api/compute", (req, res) => {
  const raw = req.body?.config as RawConfig | undefined;
  const assignments = req.body?.assignments;
  if (!raw || typeof raw !== "object") {
    return res.status(400).json({ ok: false, error: "缺少 config。" });
  }
  const result = computePlan({ raw, assignments });
  state = reduce(state, { type: "save_draft", raw, result });
  persist();
  res.json({ ok: true, result, state });
});

// 确认：仅当当前草稿可执行。确认后返回冻结快照，后续草稿修改不影响它。
app.post("/api/confirm", (req, res) => {
  const raw = req.body?.config as RawConfig | undefined;
  const assignments = req.body?.assignments;
  if (!raw) return res.status(400).json({ ok: false, error: "缺少 config。" });
  const result = computePlan({ raw, assignments });
  if (!result.feasible) {
    return res.status(409).json({
      ok: false,
      error: "方案当前不可执行，不能确认。",
      reasons: result.reasons,
      result,
    });
  }
  state = reduce(state, { type: "confirm", raw, result, at: new Date() });
  persist();
  res.json({ ok: true, confirmed: state.confirmed, state });
});

app.get("/api/export/:id.:format", (req, res) => {
  const { id, format } = req.params as { id: string; format: string };
  const plan = state.confirmed;
  if (!plan || plan.confirmationId !== id) {
    return res.status(404).json({ ok: false, error: "未找到该确认方案。" });
  }
  const base = `${plan.confirmationId}`;
  if (format === "txt") {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${base}.txt"`);
    return res.send(exportTxt(plan));
  }
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${base}.csv"`);
    return res.send(exportCsv(plan));
  }
  if (format === "json") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${base}.json"`);
    return res.send(JSON.stringify(plan, null, 2));
  }
  res.status(400).json({ ok: false, error: "format 必须是 txt / csv / json。" });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// 生产模式下托管前端构建产物
if (WEB_DIST) {
  app.use(express.static(WEB_DIST));
  app.get("*", (_req, res) => res.sendFile(resolve(WEB_DIST, "index.html")));
} else {
  console.warn("未找到 web/dist，仅提供 API（前端请用 npm run dev 单独启动）。");
}

app.listen(PORT, () => {
  console.log(`plate-planner server on http://localhost:${PORT}`);
});
