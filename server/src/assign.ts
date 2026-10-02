import { PLATE_COLS, PLATE_ROWS, type AssignmentKey, type AssignmentMap, type NormalizedConfig, type Reason } from "shared";

export const PLATE_SIZE = 96;

export function allWellIds(): string[] {
  const ids: string[] = [];
  for (const r of PLATE_ROWS) for (const c of PLATE_COLS) ids.push(`${r}${c}`);
  return ids;
}

export function parseWellId(id: string): { row: string; col: number } | null {
  const m = /^([A-H])([1-9]|1[0-2])$/.exec(id);
  if (!m) return null;
  return { row: m[1]!, col: Number(m[2]!) };
}

export interface TreatmentUnit {
  key: Extract<AssignmentKey, { kind: "treatment" }>;
  groupId: string;
  groupName: string;
  targetIndex: number;
  targetN: number;
  replicateIndex: number;
  finalVolumeUl: number;
}

/** 展开“组 × 目标浓度 × 重复”为最小处理单元，每个单元对应一个孔的一份处理定义 */
export function expandUnits(config: NormalizedConfig): TreatmentUnit[] {
  const units: TreatmentUnit[] = [];
  for (const g of config.groups) {
    g.targetsN.forEach((targetN, targetIndex) => {
      for (let r = 0; r < g.replicates; r++) {
        units.push({
          key: { kind: "treatment", groupId: g.id, targetIndex },
          groupId: g.id,
          groupName: g.name,
          targetIndex,
          targetN,
          replicateIndex: r + 1,
          finalVolumeUl: g.finalVolumeUl,
        });
      }
    });
  }
  return units;
}

export function requiredWellCount(config: NormalizedConfig): number {
  return expandUnits(config).length + config.controlWells;
}

/** 服务端确定性自动排布：处理单元按 组→浓度→重复 的顺序，随后对照孔，行优先排列 */
export function autoAssign(config: NormalizedConfig, startAtFirstWell = true): AssignmentMap {
  const ids = allWellIds();
  const map: AssignmentMap = {};
  let cursor = startAtFirstWell ? 0 : 0;
  for (const u of expandUnits(config)) {
    map[ids[cursor++]!] = u.key;
  }
  for (let i = 0; i < config.controlWells; i++) {
    map[ids[cursor++]!] = { kind: "control" };
  }
  return map;
}

export interface AssignmentCheck {
  accepted: boolean;
  reasons: Reason[];
  /** 接受时为规范化后的孔→单元映射；未列出的孔为空孔 */
  effective: AssignmentMap;
}

/**
 * 校验前端提交的孔位安排。
 * 一个孔只能接受一份明确的处理定义；任何对已删除组/旧目标序号的引用都会导致
 * 整份安排被拒绝（服务端回退到自动排布），前端据此清空旧选中态与旧汇总。
 */
export function validateAssignments(raw: Record<string, AssignmentKey> | undefined, config: NormalizedConfig): AssignmentCheck {
  const reasons: Reason[] = [];
  const required = requiredWellCount(config);

  if (required > PLATE_SIZE) {
    reasons.push({
      code: "CAPACITY_EXCEEDED",
      message: `需要 ${required} 个孔，超过一块 96 孔板容量。`,
      detail: { required, capacity: PLATE_SIZE },
    });
    return { accepted: false, reasons, effective: {} };
  }

  if (!raw || Object.keys(raw).length === 0) {
    return { accepted: true, reasons: [], effective: autoAssign(config) };
  }

  const groupIndex = new Map(config.groups.map((g) => [g.id, g]));
  const effective: AssignmentMap = {};
  const seen = new Set<string>();
  let nonEmpty = 0;

  for (const [wellId, key] of Object.entries(raw)) {
    if (!parseWellId(wellId)) {
      reasons.push({ code: "ASSIGNMENT_UNKNOWN_REFERENCE", message: `孔位「${wellId}」不在 96 孔板范围内。` });
      break;
    }
    if (seen.has(wellId)) {
      reasons.push({ code: "ASSIGNMENT_UNKNOWN_REFERENCE", message: `孔位 ${wellId} 被重复定义，一个孔只能接受一份处理。` });
      break;
    }
    seen.add(wellId);

    if (!key || typeof key !== "object" || typeof key.kind !== "string") {
      reasons.push({ code: "ASSIGNMENT_UNKNOWN_REFERENCE", message: `孔位 ${wellId} 的处理定义无效。` });
      break;
    }
    if (key.kind === "empty") {
      continue;
    }
    if (key.kind === "control") {
      effective[wellId] = { kind: "control" };
      nonEmpty++;
      continue;
    }
    if (key.kind === "treatment") {
      const g = groupIndex.get(key.groupId);
      if (!g) {
        reasons.push({
          code: "ASSIGNMENT_UNKNOWN_REFERENCE",
          message: `孔位 ${wellId} 引用了不存在或已删除的处理组「${key.groupId}」，旧孔位安排已失效。`,
        });
        break;
      }
      if (!Number.isInteger(key.targetIndex) || key.targetIndex < 0 || key.targetIndex >= g.targetsN.length) {
        reasons.push({
          code: "ASSIGNMENT_UNKNOWN_REFERENCE",
          message: `孔位 ${wellId} 引用了组「${g.name}」中不存在的目标浓度序号 ${key.targetIndex}，可能来自上一次安排。`,
        });
        break;
      }
      effective[wellId] = { kind: "treatment", groupId: g.id, targetIndex: key.targetIndex };
      nonEmpty++;
      continue;
    }
    reasons.push({ code: "ASSIGNMENT_UNKNOWN_REFERENCE", message: `孔位 ${wellId} 的处理类型无法识别。` });
    break;
  }

  if (reasons.length > 0) {
    return { accepted: false, reasons, effective: autoAssign(config) };
  }
  if (nonEmpty !== required) {
    reasons.push({
      code: "ASSIGNMENT_COUNT_MISMATCH",
      message: `孔位安排中有 ${nonEmpty} 个非空孔，但当前配置要求 ${required} 个（处理孔 ${required - config.controlWells} + 对照孔 ${config.controlWells}）。调整重复数或对照孔后请重新排布。`,
      detail: { assigned: nonEmpty, required },
    });
    return { accepted: false, reasons, effective: autoAssign(config) };
  }

  return { accepted: true, reasons: [], effective };
}
