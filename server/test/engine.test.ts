import { describe, expect, it } from "vitest";
import { computePlan } from "../src/compute.js";
import { buildDosingPlan } from "../src/chain.js";
import { makeRaw } from "./fixtures.js";

const EPS = 1e-6;

describe("直接母液加样与体积守恒", () => {
  it("剂量 ≥ 移液器最小值时直接加母液，每孔守恒", () => {
    const raw = makeRaw({
      groups: [
        {
          id: "G1",
          name: "A",
          targets: [50, 25], // 100µM 母液：剂量 100µL / 50µL，Vf=200
          concentrationUnit: "µM",
          replicates: 2,
          finalVolume: 200,
          finalVolumeUnit: "µL",
        },
      ],
      controls: { count: 0, finalVolume: 200, finalVolumeUnit: "µL" },
    });
    const r = computePlan({ raw });
    expect(r.feasible).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.totals.occupiedWells).toBe(4);
    // 所有守恒检查（孔 + 中间液）必须通过
    for (const c of r.conservationChecks) {
      expect(c.ok, `${c.scope}: ${c.actualUl} vs ${c.expectedUl}`).toBe(true);
    }
    const treated = r.wells.filter((w) => w.kind === "treatment");
    expect(treated).toHaveLength(4);
    for (const w of treated) {
      expect(w.additions[0]!.liquid.kind).toBe("stock");
      expect(w.additions[0]!.volumeUl + w.diluentTopUpUl).toBeCloseTo(200, 6);
    }
    // 母液总耗 = 2*(100+50) = 300µL
    expect(r.totals.stockRequiredUl).toBeCloseTo(300, 6);
    expect(r.totals.stockRequiredUl).toBeLessThanOrEqual(r.totals.stockAvailableUl);
    // 稀释液 = 处理孔补齐 2*(100+150)=500，加上无对照
    expect(r.totals.diluentRequiredUl).toBeCloseTo(500, 6);
  });
});

describe("中间稀释", () => {
  it("目标过低无法直接配出时，构造中间液链且每次移液量 ≥ 最小值，绝不四舍五入为零", () => {
    const raw = makeRaw({
      pipetteMinVolume: 5,
      groups: [
        {
          id: "G1",
          name: "A",
          targets: [0.1], // 100µM → 0.1µM，Vf 200：直接剂量 0.2µL < 5µL
          concentrationUnit: "µM",
          replicates: 3,
          finalVolume: 200,
          finalVolumeUnit: "µL",
        },
      ],
      controls: { count: 0, finalVolume: 200, finalVolumeUnit: "µL" },
    });
    const r = computePlan({ raw });
    expect(r.feasible).toBe(true);
    const prep = r.steps.filter((s) => s.action === "prepare_intermediate");
    expect(prep.length).toBeGreaterThan(0);
    for (const s of prep) {
      expect(s.sourceVolumeUl!).toBeGreaterThanOrEqual(5 - EPS);
      // 中间液守恒：取液 + 稀释液 = 配制量
      expect(s.sourceVolumeUl! + s.diluentVolumeUl!).toBeCloseTo(s.batchVolumeUl!, 6);
    }
    const dose = r.steps.find((s) => s.action === "dispense_dose")!;
    expect(dose.dispensePerWellUl!).toBeGreaterThanOrEqual(5 - EPS);
    for (const c of r.conservationChecks) expect(c.ok).toBe(true);
    // 配制量允许超配以保证每次移液 ≥ p：L0 为 125µL（取中间液 5 + 稀释液 120）
    // 下游仅消耗 15µL、损耗 5µL，其余 105µL 为可解释的超配，计入真实用量
    const l0 = prep[prep.length - 1]!;
    expect(l0.batchVolumeUl!).toBeCloseTo(125, 6);
    expect(l0.sourceVolumeUl!).toBeCloseTo(5, 6);
    expect(l0.diluentVolumeUl!).toBeCloseTo(120, 6);
    // 母液总取 = 5µL；稀释液 = 中间液配制 120 + 孔内补齐 195×3 = 705
    expect(r.totals.stockRequiredUl).toBeCloseTo(5, 6);
    expect(r.totals.diluentRequiredUl).toBeCloseTo(705, 6);
    for (const s of prep) {
      expect(s.batchVolumeUl!).toBeGreaterThanOrEqual(s.sourceVolumeUl!);
      if (s.diluentVolumeUl! > EPS) expect(s.diluentVolumeUl!).toBeGreaterThanOrEqual(5 - EPS);
    }
  });

  it("单元级：所有转移体积与浓度关系严格守恒", () => {
    const plan = buildDosingPlan({
      stockConcN: 100_000, // 100 µM 以 nM 计
      targetN: 50, // 0.05 µM = 50 nM
      finalVolumeUl: 100,
      wellCount: 4,
      pipetteMinUl: 10,
      deadVolumeUl: 5,
      nodePrefix: "T",
      stockLabel: "母液",
      targetLabel: "0.05µM",
    });
    expect(plan.failure).toBeUndefined();
    expect(plan.strategy).toBe("chain");
    // 给孔剂量守恒
    expect(plan.perWellDoseUl * plan.chain[0]!.concentrationN).toBeCloseTo(50 * 100, 6);
    // 逐级守恒 Csrc·a = Cnode·B
    for (const node of plan.chain) {
      const srcConc = node.source.kind === "stock" ? 100_000 : plan.chain.find((n) => n.self.nodeId === node.source.nodeId)!.concentrationN;
      expect(srcConc * node.sourceVolumeUl).toBeCloseTo(node.concentrationN * node.batchVolumeUl, 6);
      expect(node.sourceVolumeUl).toBeGreaterThanOrEqual(10 - EPS);
      expect(node.sourceVolumeUl + node.diluentVolumeUl).toBeCloseTo(node.batchVolumeUl, 6);
    }
    expect(plan.stockDrawUl).toBeGreaterThan(0);
  });

  it("目标接近母液、孔内补齐量过小时，用整孔等浓度中间液完成混合而非四舍五入", () => {
    // 99µM / 200µL 终体积：直接法需 198µL 母液 + 2µL 补齐，2µL < p=5
    const raw = makeRaw({
      pipetteMinVolume: 5,
      stockAvailable: 2,
      stockAvailableUnit: "mL",
      groups: [
        {
          id: "G1",
          name: "A",
          targets: [99],
          concentrationUnit: "µM",
          replicates: 4,
          finalVolume: 200,
          finalVolumeUnit: "µL",
        },
      ],
      controls: { count: 0, finalVolume: 200, finalVolumeUnit: "µL" },
    });
    const r = computePlan({ raw });
    expect(r.feasible).toBe(true);
    const wells = r.wells.filter((w) => w.kind === "treatment");
    for (const w of wells) {
      expect(w.additions[0]!.liquid.kind).toBe("intermediate");
      expect(w.additions[0]!.volumeUl).toBeCloseTo(200, 6); // 整孔来自中间液
      expect(w.diluentTopUpUl).toBeCloseTo(0, 6); // 孔内不再做亚最小体积补齐
    }
    const prep = r.steps.find((s) => s.action === "prepare_intermediate")!;
    // 批量配制：母液取液与稀释液移液都必须 ≥ 5µL，且浓度关系守恒
    expect(prep.sourceVolumeUl!).toBeGreaterThanOrEqual(5 - EPS);
    expect(prep.diluentVolumeUl!).toBeGreaterThanOrEqual(5 - EPS);
    expect(prep.sourceVolumeUl! * r.config.stockConcentrationN).toBeCloseTo(
      prep.concentrationN! * prep.batchVolumeUl!,
      6
    );
    for (const c of r.conservationChecks) expect(c.ok).toBe(true);
  });

  it("终体积小于两倍最小移液体积时明确判为不可执行", () => {
    const raw = makeRaw({
      pipetteMinVolume: 100,
      groups: [
        {
          id: "G1",
          name: "A",
          targets: [10],
          concentrationUnit: "µM",
          replicates: 2,
          finalVolume: 150,
          finalVolumeUnit: "µL",
        },
      ],
      controls: { count: 0, finalVolume: 150, finalVolumeUnit: "µL" },
    });
    const r = computePlan({ raw });
    expect(r.feasible).toBe(false);
    expect(r.reasons.some((x) => x.code === "DILUTION_CHAIN_FAILED")).toBe(true);
  });

  it("稀释链无法满足约束时明确报告不可执行原因", () => {
    const raw = makeRaw({
      pipetteMinVolume: 150,
      deadVolume: 1,
      groups: [
        {
          id: "G1",
          name: "A",
          targets: [0.001],
          concentrationUnit: "µM",
          replicates: 2,
          finalVolume: 200,
          finalVolumeUnit: "µL",
        },
      ],
      controls: { count: 0, finalVolume: 200, finalVolumeUnit: "µL" },
    });
    const r = computePlan({ raw });
    expect(r.feasible).toBe(false);
    expect(r.reasons.some((x) => x.code === "DILUTION_CHAIN_FAILED")).toBe(true);
    // 不可执行时不能给出乐观的用量结论：steps 不得包含该失败单元的加样步骤
    expect(r.steps.filter((s) => s.action === "dispense_dose")).toHaveLength(0);
  });
});

describe("母液是有限资源", () => {
  it("母液需求超过可用量时不可执行并给出差额原因", () => {
    const raw = makeRaw({
      stockAvailable: 100, // 需要 300
      stockAvailableUnit: "µL",
      groups: [
        {
          id: "G1",
          name: "A",
          targets: [50, 25],
          concentrationUnit: "µM",
          replicates: 2,
          finalVolume: 200,
          finalVolumeUnit: "µL",
        },
      ],
      controls: { count: 0, finalVolume: 200, finalVolumeUnit: "µL" },
    });
    const r = computePlan({ raw });
    expect(r.feasible).toBe(false);
    const reason = r.reasons.find((x) => x.code === "STOCK_INSUFFICIENT");
    expect(reason).toBeDefined();
    expect(reason!.detail!.requiredUl).toBeCloseTo(300, 6);
    expect(reason!.detail!.availableUl).toBeCloseTo(100, 6);
  });

  it("mL 与 µL 输入按单位严格换算，不能当成同一个数", () => {
    const raw = makeRaw({
      stockAvailable: 0.1,
      stockAvailableUnit: "mL", // 100 µL
      groups: [
        {
          id: "G1",
          name: "A",
          targets: [50, 25],
          concentrationUnit: "µM",
          replicates: 2,
          finalVolume: 200,
          finalVolumeUnit: "µL",
        },
      ],
      controls: { count: 0, finalVolume: 200, finalVolumeUnit: "µL" },
    });
    const r = computePlan({ raw });
    expect(r.feasible).toBe(false);
    expect(r.reasons.some((x) => x.code === "STOCK_INSUFFICIENT")).toBe(true);
    expect(r.totals.stockAvailableUl).toBeCloseTo(100, 6);
  });
});

describe("板容量与输入校验", () => {
  it("排布前就能发现超出 96 孔", () => {
    const raw = makeRaw({
      groups: [
        {
          id: "G1",
          name: "A",
          targets: [10, 20, 30, 40, 50],
          concentrationUnit: "µM",
          replicates: 20,
          finalVolume: 200,
          finalVolumeUnit: "µL",
        },
      ],
    });
    const r = computePlan({ raw });
    expect(r.feasible).toBe(false);
    expect(r.reasons.some((x) => x.code === "CAPACITY_EXCEEDED")).toBe(true);
  });

  it("非法目标浓度（0、空、非数字）直接判不可执行，不会被静默过滤成空序列", () => {
    for (const targets of [[0], [NaN], [] as number[]]) {
      const r = computePlan({ raw: makeRaw({ groups: [{
        id: "G1", name: "A", targets, concentrationUnit: "µM", replicates: 2, finalVolume: 200, finalVolumeUnit: "µL",
      }] }) });
      expect(r.feasible).toBe(false);
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });

  it("母液可用量必须为有限正值（不能当作无限）", () => {
    const r = computePlan({ raw: makeRaw({ stockAvailable: 0 }) });
    expect(r.feasible).toBe(false);
    expect(r.reasons.some((x) => x.code === "INVALID_INPUT")).toBe(true);
  });
});
