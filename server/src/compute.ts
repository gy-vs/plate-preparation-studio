import {
  type AssignmentKey,
  type ComputeResult,
  type ConservationCheck,
  type ConfirmedPlan,
  type LiquidRef,
  type NormalizedConfig,
  type PrepStep,
  type RawConfig,
  type Reason,
  type WellPlan,
} from "shared";
import { buildDosingPlan, type DosingPlan } from "./chain.js";
import { configHash } from "./hash.js";
import { normalizeConfig } from "./normalize.js";
import {
  PLATE_SIZE,
  allWellIds,
  expandUnits,
  parseWellId,
  requiredWellCount,
  validateAssignments,
  type TreatmentUnit,
} from "./assign.js";

const EPS = 1e-6; // µL 级别守恒容差
const STOCK_LABEL = "母液";
const DILUENT: LiquidRef = { kind: "diluent", label: "稀释液" };

interface UnitRuntime {
  unit: TreatmentUnit;
  plan: DosingPlan;
}

export interface ComputeInput {
  raw: RawConfig;
  assignments?: Record<string, AssignmentKey>;
}

/** 统一计算入口：规范化 → 孔位校验 → 每单元稀释方案 → 孔清单与步骤 → 守恒与可执行性。 */
export function computePlan(input: ComputeInput, now = new Date()): ComputeResult {
  const { config, reasons: normalizeReasons } = normalizeConfig(input.raw);
  const hash = configHash(input.raw);

  if (!config) {
    return emptyResult(hash, normalizeReasons, now);
  }

  const globalReasons: Reason[] = [];

  // 容量预检（排布前必须能看到能否装进一块板）
  const required = requiredWellCount(config);
  if (required > PLATE_SIZE) {
    globalReasons.push({
      code: "CAPACITY_EXCEEDED",
      message: `需要 ${required} 个孔（处理孔 ${required - config.controlWells} + 对照孔 ${config.controlWells}），超过一块 96 孔板容量。`,
      detail: { required, capacity: PLATE_SIZE },
    });
  }

  const assignmentCheck = validateAssignments(input.assignments, config);

  // 为每个处理单元计算稀释方案；同一 (组, 目标) 的重复孔共享一份中间液
  const units = expandUnits(config);
  const planByUnitKey = new Map<string, UnitRuntime>();
  // 同一孔位在自定义排布中只出现一次；按扫描顺序为同一 (组,目标) 的孔编号重复序号
  const replicateCounters = new Map<string, number>();
  for (const u of units) {
    const plan = buildDosingPlan({
      stockConcN: config.stockConcentrationN,
      targetN: u.targetN,
      finalVolumeUl: u.finalVolumeUl,
      wellCount: config.groups.find((g) => g.id === u.groupId)!.replicates,
      pipetteMinUl: config.pipetteMinVolumeUl,
      deadVolumeUl: config.deadVolumeUl,
      nodePrefix: `I-${u.groupId}-T${u.targetIndex + 1}`,
      stockLabel: STOCK_LABEL,
      targetLabel: `${u.groupName} 第${u.targetIndex + 1}个目标浓度`,
    });
    planByUnitKey.set(unitKey(u.groupId, u.targetIndex), { unit: u, plan });
    if (plan.failure) {
      globalReasons.push({
        code: "DILUTION_CHAIN_FAILED",
        message: plan.failure,
        detail: { groupId: u.groupId, targetIndex: u.targetIndex, replicate: u.replicateIndex },
      });
    }
  }

  // 组装孔清单（严格取自服务端的 effective 分配，空孔也显式列出）
  const wells: WellPlan[] = [];
  let occupied = 0;
  for (const wellId of allWellIds()) {
    const key = assignmentCheck.effective[wellId];
    const pos = parseWellId(wellId)!;
    if (!key || key.kind === "empty") {
      wells.push(emptyWell(wellId, pos.row, pos.col));
      continue;
    }
    occupied++;
    if (key.kind === "control") {
      wells.push(buildControlWell(wellId, pos.row, pos.col, config));
      continue;
    }
    const rt = planByUnitKey.get(unitKey(key.groupId, key.targetIndex))!;
    const k = unitKey(key.groupId, key.targetIndex);
    const replicateIndex = (replicateCounters.get(k) ?? 0) + 1;
    replicateCounters.set(k, replicateIndex);
    wells.push(buildTreatmentWell(wellId, pos.row, pos.col, rt, replicateIndex));
  }

  // 操作步骤
  const steps: PrepStep[] = [];
  const checks: ConservationCheck[] = [];
  let stockRequired = 0;
  let diluentRequired = 0;
  let intermediateBatches = 0;
  let order = 1;

  if (globalReasons.filter((r) => r.code === "DILUTION_CHAIN_FAILED").length === 0) {
    // 同一 (组,目标) 的所有重复孔共享一份稀释方案与一份中间液，只迭代一次
    const uniqueRuntimes: UnitRuntime[] = [];
    const seenTargets = new Set<string>();
    for (const u of units) {
      const k = unitKey(u.groupId, u.targetIndex);
      if (seenTargets.has(k)) continue;
      seenTargets.add(k);
      uniqueRuntimes.push(planByUnitKey.get(k)!);
    }

    for (const rt of uniqueRuntimes) {
      const plan = rt.plan;
      const targetWells = wells
        .filter((w) => w.kind === "treatment" && w.groupId === rt.unit.groupId && w.targetIndex === rt.unit.targetIndex)
        .map((w) => w.wellId);

      // 1) 自上而下配制中间液
      for (let i = plan.chain.length - 1; i >= 0; i--) {
        const node = plan.chain[i]!;
        const downstreamDemand = i === 0 ? plan.perWellDoseUl * targetWells.length : plan.chain[i - 1]!.sourceVolumeUl;
        const overPrep = node.batchVolumeUl - downstreamDemand - config.deadVolumeUl;
        const prepNote =
          i === 0
            ? `配制后用于 ${targetWells.length} 个孔；配制量含 ${config.deadVolumeUl} µL 操作损耗。`
            : `仅用于配制上一级中间液 ${plan.chain[i - 1]!.label}；配制量含 ${config.deadVolumeUl} µL 操作损耗。`;
        steps.push({
          id: `prep-${node.id}`,
          order: order++,
          liquid: node.self,
          action: "prepare_intermediate",
          sourceLiquid: node.source,
          concentrationN: node.concentrationN,
          sourceVolumeUl: node.sourceVolumeUl,
          diluentVolumeUl: node.diluentVolumeUl,
          batchVolumeUl: node.batchVolumeUl,
          usedByWells: targetWells,
          totalVolumeUl: node.batchVolumeUl,
          note:
            overPrep > EPS
              ? `${prepNote} 为保证每次移液 ≥ ${config.pipetteMinVolumeUl} µL，额外超配 ${overPrep.toFixed(2)} µL（真实消耗，计入用量）。`
              : prepNote,
        });
        intermediateBatches++;
        diluentRequired += node.diluentVolumeUl;
        checks.push({
          scope: `中间液 ${node.label}`,
          expectedUl: node.batchVolumeUl,
          actualUl: node.sourceVolumeUl + node.diluentVolumeUl,
          ok: Math.abs(node.sourceVolumeUl + node.diluentVolumeUl - node.batchVolumeUl) <= EPS,
        });
      }
      stockRequired += plan.stockDrawUl;

      // 2) 把剂量液体分到孔中（母液直接加样 或 最低级中间液）
      steps.push({
        id: `dose-${rt.unit.groupId}-T${rt.unit.targetIndex + 1}`,
        order: order++,
        liquid: plan.doseLiquid,
        action: "dispense_dose",
        concentrationN: plan.strategy === "direct" ? config.stockConcentrationN : plan.chain[0]!.concentrationN,
        dispensePerWellUl: plan.perWellDoseUl,
        usedByWells: targetWells,
        totalVolumeUl: plan.totalDoseConsumedUl,
        note:
          plan.strategy === "direct"
            ? `直接从母液向 ${targetWells.length} 个孔各加 ${plan.perWellDoseUl.toFixed(3)} µL。`
            : `用 ${plan.chain[0]!.label} 向 ${targetWells.length} 个孔各加 ${plan.perWellDoseUl.toFixed(3)} µL。`,
      });
    }

    // 3) 稀释液补齐（合并为一步，列出所有需要补齐的孔与各自体积）
    const topUpWells = wells.filter((w) => w.kind !== "empty" && w.diluentTopUpUl > EPS);
    if (topUpWells.length > 0) {
      const total = topUpWells.reduce((s, w) => s + w.diluentTopUpUl, 0);
      diluentRequired += total;
      const uniform = topUpWells.every((w) => Math.abs(w.diluentTopUpUl - topUpWells[0]!.diluentTopUpUl) <= EPS);
      steps.push({
        id: "diluent-topup",
        order: order++,
        liquid: DILUENT,
        action: "top_up_diluent",
        dispensePerWellUl: uniform ? topUpWells[0]!.diluentTopUpUl : undefined,
        usedByWells: topUpWells.map((w) => w.wellId),
        totalVolumeUl: total,
        note: uniform
          ? `向 ${topUpWells.length} 个孔各补 ${topUpWells[0]!.diluentTopUpUl.toFixed(3)} µL 稀释液至终体积。`
          : `向 ${topUpWells.length} 个孔按各自差额补稀释液（见孔位清单），共 ${total.toFixed(2)} µL。`,
      });
    }
  }

  // 每孔守恒检查
  for (const w of wells) {
    if (w.kind === "empty") continue;
    const sum = w.additions.reduce((s, a) => s + a.volumeUl, 0) + w.diluentTopUpUl;
    checks.push({
      scope: `孔 ${w.wellId}`,
      expectedUl: w.finalVolumeUl,
      actualUl: sum,
      ok: Math.abs(sum - w.finalVolumeUl) <= EPS,
    });
  }

  // 母液是否充足（母液是有限资源）
  if (stockRequired > config.stockAvailableUl + EPS) {
    globalReasons.push({
      code: "STOCK_INSUFFICIENT",
      message: `母液不足：方案共需 ${stockRequired.toFixed(2)} µL，可用量仅 ${config.stockAvailableUl.toFixed(2)} µL。请减少重复/浓度点、加大稀释倍数或补充母液。`,
      detail: { requiredUl: stockRequired, availableUl: config.stockAvailableUl },
    });
  }

  // 补孔体积约束：剂量不得超过终体积；孔内补齐（若有）必须达到移液器最小体积
  for (const w of wells) {
    if (w.kind === "empty") continue;
    if (w.diluentTopUpUl > EPS && w.diluentTopUpUl + EPS < config.pipetteMinVolumeUl) {
      globalReasons.push({
        code: "DILUTION_CHAIN_FAILED",
        message: `孔 ${w.wellId} 的稀释液补齐量 ${w.diluentTopUpUl.toFixed(3)} µL 低于移液器最小体积 ${config.pipetteMinVolumeUl} µL，不能可靠执行。`,
      });
    }
    if (w.kind !== "treatment") continue;
    const dose = w.additions[0]!.volumeUl;
    if (dose > w.finalVolumeUl + EPS) {
      globalReasons.push({ code: "DILUTION_CHAIN_FAILED", message: `孔 ${w.wellId} 的加样体积超过终体积。` });
    }
    if (dose + EPS < config.pipetteMinVolumeUl) {
      globalReasons.push({
        code: "DILUTION_CHAIN_FAILED",
        message: `孔 ${w.wellId} 的剂量 ${dose.toFixed(3)} µL 低于移液器最小体积 ${config.pipetteMinVolumeUl} µL，不能可靠执行。`,
      });
    }
  }

  const conservationOk = checks.every((c) => c.ok);
  if (!conservationOk) {
    globalReasons.push({ code: "INVALID_INPUT", message: "体积守恒校验未通过，方案不可执行。" });
  }

  const feasible = globalReasons.length === 0 && assignmentCheck.accepted;
  if (!assignmentCheck.accepted) {
    // 排布失效本身不改变 feasible 判定中的计算部分，但按要求：不能同时给出“可执行”总览
    globalReasons.push(...assignmentCheck.reasons);
  }

  return {
    config,
    configHash: hash,
    assignments: assignmentCheck.effective,
    assignmentAccepted: assignmentCheck.accepted,
    assignmentReasons: assignmentCheck.reasons,
    wells,
    steps,
    totals: {
      stockRequiredUl: stockRequired,
      diluentRequiredUl: diluentRequired,
      stockAvailableUl: config.stockAvailableUl,
      intermediateBatchCount: intermediateBatches,
      occupiedWells: occupied,
      emptyWells: PLATE_SIZE - occupied,
    },
    feasible,
    reasons: globalReasons,
    conservationChecks: checks,
    generatedAt: now.toISOString(),
  };
}

function unitKey(groupId: string, targetIndex: number): string {
  return `${groupId}#${targetIndex}`;
}

function buildTreatmentWell(wellId: string, row: string, col: number, rt: UnitRuntime, replicateIndex: number): WellPlan {
  const { unit, plan } = rt;
  const dose = plan.perWellDoseUl;
  return {
    wellId,
    row,
    col,
    kind: "treatment",
    groupId: unit.groupId,
    groupName: unit.groupName,
    targetConcentrationN: unit.targetN,
    targetIndex: unit.targetIndex,
    replicateIndex,
    finalVolumeUl: unit.finalVolumeUl,
    additions: [{ liquid: plan.doseLiquid, volumeUl: dose }],
    diluentTopUpUl: Math.max(0, unit.finalVolumeUl - dose),
  };
}

function buildControlWell(wellId: string, row: string, col: number, config: NormalizedConfig): WellPlan {
  return {
    wellId,
    row,
    col,
    kind: "control",
    groupName: "对照（仅稀释液）",
    finalVolumeUl: config.controlFinalVolumeUl,
    additions: [],
    diluentTopUpUl: config.controlFinalVolumeUl,
  };
}

function emptyWell(wellId: string, row: string, col: number): WellPlan {
  return { wellId, row, col, kind: "empty", finalVolumeUl: 0, additions: [], diluentTopUpUl: 0 };
}

function emptyResult(hash: string, reasons: Reason[], now: Date): ComputeResult {
  return {
    config: {} as NormalizedConfig,
    configHash: hash,
    assignments: {},
    assignmentAccepted: false,
    assignmentReasons: [],
    wells: [],
    steps: [],
    totals: {
      stockRequiredUl: NaN,
      diluentRequiredUl: NaN,
      stockAvailableUl: NaN,
      intermediateBatchCount: 0,
      occupiedWells: 0,
      emptyWells: PLATE_SIZE,
    },
    feasible: false,
    reasons,
    conservationChecks: [],
    generatedAt: now.toISOString(),
  };
}

export function freezeConfirmation(raw: RawConfig, result: ComputeResult, now = new Date()): ConfirmedPlan {
  return {
    confirmationId: `CONF-${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${Math.abs(
      hashString(result.configHash + now.toISOString())
    )
      .toString(36)
      .slice(0, 6)
      .toUpperCase()}`,
    confirmedAt: now.toISOString(),
    experimentName: result.config.experimentName,
    configHash: result.configHash,
    config: result.config,
    rawConfig: raw,
    result,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return h;
}
