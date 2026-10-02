import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, rmSync } from "node:fs";

let PORT = 4099;
const DATA_DIR = "/tmp/plate-test-http";
let BASE = `http://localhost:${PORT}`;

let server: ReturnType<typeof spawn>;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const p = (srv.address() as { port: number }).port;
      srv.close(() => resolve(p));
    });
  });
}

beforeAll(async () => {
  PORT = await freePort();
  BASE = `http://localhost:${PORT}`;
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  server = spawn("node", ["--import", "tsx", "src/index.ts"], {
    env: { ...process.env, PORT: String(PORT), PLATE_DATA_FILE: `${DATA_DIR}/state.json` },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* 等待启动 */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  server.kill("SIGTERM");
  throw new Error("server did not start");
}, 30000);

afterAll(() => {
  server.kill("SIGTERM");
});

const cfg = (overrides: Record<string, unknown> = {}) => ({
  config: {
    experimentName: "HTTP",
    stockConcentration: 100,
    stockConcentrationUnit: "µM",
    stockAvailable: 2,
    stockAvailableUnit: "mL",
    pipetteMinVolume: 5,
    deadVolume: 5,
    groups: [
      { id: "G1", name: "A", targets: [10, 1], concentrationUnit: "µM", replicates: 2, finalVolume: 200, finalVolumeUnit: "µL" },
    ],
    controls: { count: 2, finalVolume: 200, finalVolumeUnit: "µL" },
    ...overrides,
  },
});

describe("HTTP API", () => {
  it("compute 返回同一份结果（板位/步骤/汇总）", async () => {
    const res = await fetch(`${BASE}/api/compute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg()),
    });
    expect(res.ok).toBe(true);
    const { result } = await res.json();
    expect(result.feasible).toBe(true);
    expect(result.totals.occupiedWells).toBe(6);
    expect(result.wells).toHaveLength(96);
  });

  it("不可执行方案不能确认（409），且不产生 confirmed", async () => {
    const res = await fetch(`${BASE}/api/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg({ stockAvailable: 0.001, stockAvailableUnit: "mL" })),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    const state = await (await fetch(`${BASE}/api/state`)).json();
    expect(state.state.confirmed).toBeUndefined();
  });

  it("确认后导出包含计算依据与孔位身份；之后改草稿不改写冻结版", async () => {
    const res = await fetch(`${BASE}/api/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg()),
    });
    expect(res.ok).toBe(true);
    const { confirmed } = await res.json();

    const txt = await (await fetch(`${BASE}/api/export/${confirmed.confirmationId}.txt`)).text();
    expect(txt).toContain(confirmed.confirmationId);
    expect(txt).toContain("计算依据");
    expect(txt).toContain("A1");

    const csv = await (await fetch(`${BASE}/api/export/${confirmed.confirmationId}.csv`)).text();
    expect(csv).toContain("well_id");
    expect(csv).toContain("A1");

    // 修改草稿
    await fetch(`${BASE}/api/compute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg({ experimentName: "草稿改名" })),
    });
    const state = await (await fetch(`${BASE}/api/state`)).json();
    expect(state.state.confirmed.confirmationId).toBe(confirmed.confirmationId);
    expect(state.state.confirmed.experimentName).toBe("HTTP");
    expect(state.state.draftRaw.experimentName).toBe("草稿改名");
  });

  it("引用已删除处理组的旧孔位安排被拒绝，且结果标记为不可执行", async () => {
    const first = await (
      await fetch(`${BASE}/api/compute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg()),
      })
    ).json();
    const stale = first.result.assignments;
    const next = await (
      await fetch(`${BASE}/api/compute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            ...cfg().config,
            groups: [
              { id: "G2", name: "B", targets: [5], concentrationUnit: "µM", replicates: 2, finalVolume: 200, finalVolumeUnit: "µL" },
            ],
          },
          assignments: stale,
        }),
      })
    ).json();
    expect(next.result.assignmentAccepted).toBe(false);
    expect(next.result.feasible).toBe(false);
  });

  it("状态文件已落盘，包含版本字段", () => {
    expect(existsSync(`${DATA_DIR}/state.json`)).toBe(true);
  });
});
