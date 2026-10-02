import { describe, expect, it } from "vitest";
import { computePlan } from "../src/compute.js";
import { reduce } from "../src/store.js";
import { makeRaw } from "./fixtures.js";

describe("孔位分配失效（旧安排不能继续指向旧用量）", () => {
  it("调整重复数后，引用旧安排会被拒绝并回退到新的自动排布", () => {
    const raw3 = makeRaw(); // 3 重复 × 3 浓度 + 2 对照 = 11 孔
    const first = computePlan({ raw: raw3 });
    expect(first.assignmentAccepted).toBe(true);
    const staleAssignments = first.assignments;

    const raw2 = makeRaw({
      groups: [
        {
          id: "G1",
          name: "药物A",
          targets: [10, 1, 0.1],
          concentrationUnit: "µM",
          replicates: 2, // 改了重复数
          finalVolume: 200,
          finalVolumeUnit: "µL",
        },
      ],
    });
    const second = computePlan({ raw: raw2, assignments: staleAssignments });
    expect(second.assignmentAccepted).toBe(false);
    expect(second.assignmentReasons.length).toBeGreaterThan(0);
    expect(second.feasible).toBe(false); // 不能同时给出“可执行”
    // 服务端返回的 effective 安排与新配置一致（8 孔）
    const nonEmpty = Object.entries(second.assignments).filter(([, k]) => k.kind !== "empty");
    expect(nonEmpty).toHaveLength(8);
  });

  it("删除处理组后，旧孔位中的引用必须失效", () => {
    const raw = makeRaw();
    const first = computePlan({ raw });
    const assignments = first.assignments;

    const rawDeleted = makeRaw({
      groups: [
        {
          id: "G2", // 换了组 id
          name: "药物B",
          targets: [10],
          concentrationUnit: "µM",
          replicates: 3,
          finalVolume: 200,
          finalVolumeUnit: "µL",
        },
      ],
    });
    const next = computePlan({ raw: rawDeleted, assignments });
    expect(next.assignmentAccepted).toBe(false);
    expect(next.assignmentReasons[0]!.code).toBe("ASSIGNMENT_UNKNOWN_REFERENCE");
  });

  it("同一孔不能有两份处理；空孔保持空孔", () => {
    const raw = makeRaw({ controls: { count: 0, finalVolume: 200, finalVolumeUnit: "µL" } });
    const first = computePlan({ raw }); // 9 个处理孔
    const assignments = first.assignments;
    // 9 孔自动排布为 A1..A9；删掉 A9 的定义 → 8 ≠ 9
    delete assignments["A9"];
    const r = computePlan({ raw, assignments });
    expect(r.assignmentAccepted).toBe(false);
    expect(r.assignmentReasons[0]!.code).toBe("ASSIGNMENT_COUNT_MISMATCH");
    // 未提交的孔在自动排布中可以是空孔
    const partial = { A1: { kind: "treatment", groupId: "G1", targetIndex: 0 } } as never;
    const rr = computePlan({ raw, assignments: partial });
    expect(rr.assignmentAccepted).toBe(false);
    expect(rr.wells.find((w) => w.wellId === "H12")!.kind).toBe("empty");
  });

  it("排布改变会同步改变逐孔清单（不只是颜色）", () => {
    const raw = makeRaw({ controls: { count: 0, finalVolume: 200, finalVolumeUnit: "µL" } });
    const auto = computePlan({ raw });
    // 手工把最后一个浓度点放到 H12
    const custom: Record<string, unknown> = {};
    const units: [string, number][] = [];
    for (let t = 0; t < 3; t++) for (let rep = 0; rep < 3; rep++) units.push(["G1", t]);
    let i = 0;
    for (const [g, t] of units) {
      const id = i === units.length - 1 ? "H12" : auto.wells[i]!.wellId;
      custom[id] = { kind: "treatment", groupId: g, targetIndex: t };
      i++;
    }
    const r = computePlan({ raw, assignments: custom as never });
    expect(r.assignmentAccepted).toBe(true);
    const h12 = r.wells.find((w) => w.wellId === "H12")!;
    expect(h12.kind).toBe("treatment");
    expect(h12.targetIndex).toBe(2);
    expect(h12.additions[0]!.liquid.kind).toMatch(/stock|intermediate/);
    // 原自动排布的 C3 现在应为空孔
    const displaced = r.wells.find((w) => w.wellId === "C3")!;
    expect(displaced.kind).toBe("empty");
  });
});

describe("方案修订与确认冻结", () => {
  it("确认后的快照不被之后草稿输入改写（同一事实源）", () => {
    const raw = makeRaw();
    const confirmedResult = computePlan({ raw });
    let state = reduce({}, { type: "confirm", raw, result: confirmedResult, at: new Date("2026-10-02T09:00:00Z") });
    const frozen = state.confirmed!;
    expect(frozen.result).toBe(confirmedResult);
    expect(frozen.configHash).toBe(confirmedResult.configHash);

    // 之后修改草稿：换浓度、换重复数、换母液量
    const revised = makeRaw({
      stockAvailable: 50,
      stockAvailableUnit: "µL",
      groups: [
        {
          id: "G1",
          name: "药物A-改",
          targets: [10, 1],
          concentrationUnit: "µM",
          replicates: 4,
          finalVolume: 100,
          finalVolumeUnit: "µL",
        },
      ],
    });
    const revisedResult = computePlan({ raw: revised });
    state = reduce(state, { type: "save_draft", raw: revised, result: revisedResult });

    // 冻结快照原样保留
    expect(state.confirmed!.confirmationId).toBe(frozen.confirmationId);
    expect(state.confirmed!.result).toBe(confirmedResult);
    expect(state.confirmed!.rawConfig.groups[0]!.targets).toEqual([10, 1, 0.1]);
    expect(state.confirmed!.rawConfig.groups[0]!.finalVolume).toBe(200);
    // 草稿已是新事实
    expect(state.draftResult!.configHash).toBe(revisedResult.configHash);
    expect(state.draftResult!.wells).toBe(revisedResult.wells);
  });

  it("反复保存草稿不产生或改动确认记录", () => {
    let state = reduce({}, { type: "save_draft", raw: makeRaw(), result: computePlan({ raw: makeRaw() }) });
    expect(state.confirmed).toBeUndefined();
    state = reduce(state, { type: "save_draft", raw: makeRaw({ pipetteMinVolume: 1 }), result: computePlan({ raw: makeRaw({ pipetteMinVolume: 1 }) }) });
    expect(state.confirmed).toBeUndefined();
  });
});
