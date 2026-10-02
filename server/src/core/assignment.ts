import { ALL_WELLS, isWellId } from '../../../shared/plate.js';
import type { Assignment } from '../../../shared/api.js';
import type { Issue } from '../../../shared/api.js';
import type { NormalizedConfig, NormalizedControl, NormalizedGroup } from './validate.js';

export function groupUnitKey(groupId: string, targetIndex: number): string {
  return `group:${groupId}:${targetIndex}`;
}

export function controlUnitKey(controlId: string): string {
  return `control:${controlId}`;
}

export interface ParsedUnit {
  type: 'group' | 'control';
  group?: NormalizedGroup;
  control?: NormalizedControl;
  targetIndex?: number;
}

/** 按先列后行（A1,B1,...,H1,A2,...）自动排满所有处理单元，其余孔留空。 */
export function autoAssign(cfg: NormalizedConfig): Assignment {
  const assignment: Assignment = {};
  let cursor = 0;
  const put = (key: string) => {
    assignment[ALL_WELLS[cursor]!] = key;
    cursor += 1;
  };
  for (const g of cfg.groups) {
    g.targets.forEach((_, ti) => {
      for (let r = 0; r < g.replicates; r++) put(groupUnitKey(g.id, ti));
    });
  }
  for (const c of cfg.controls) {
    for (let i = 0; i < c.count; i++) put(controlUnitKey(c.id));
  }
  return assignment;
}

export interface AssignmentCheck {
  assignment: Assignment;
  issues: Issue[];
  /** 解析每个被使用孔的归属；解析失败的孔不在表内。 */
  parsed: Record<string, ParsedUnit>;
}

/**
 * 校验前端提交的手工排布：
 * - 孔位必须在 96 板内；
 * - 处理单元必须存在；
 * - 每个目标浓度恰好占 replicates 个孔、每个对照恰好占 count 个孔；
 * - 空孔保持空孔（不允许一个孔有两份定义，也不允许“隐式占孔”）。
 */
export function checkAssignment(
  cfg: NormalizedConfig,
  provided: Assignment | null | undefined,
): AssignmentCheck {
  const issues: Issue[] = [];
  const groupsById = new Map(cfg.groups.map((g) => [g.id, g]));
  const controlsById = new Map(cfg.controls.map((c) => [c.id, c]));
  const parsed: Record<string, ParsedUnit> = {};

  const expected = new Map<string, number>();
  for (const g of cfg.groups) {
    g.targets.forEach((_, ti) => expected.set(groupUnitKey(g.id, ti), g.replicates));
  }
  for (const c of cfg.controls) expected.set(controlUnitKey(c.id), c.count);
  const counts = new Map<string, number>();

  const assignment: Assignment = {};

  for (const [well, key] of Object.entries(provided ?? {})) {
    if (!isWellId(well)) {
      issues.push({ level: 'error', code: 'UNKNOWN_WELL', well, message: `不存在的孔位：${well}` });
      continue;
    }
    if (well in assignment) {
      issues.push({
        level: 'error',
        code: 'DUPLICATE_WELL',
        well,
        message: `孔 ${well} 被重复指定`,
      });
      continue;
    }
    if (key == null) {
      assignment[well] = null;
      continue;
    }

    let unit: ParsedUnit | null = null;
    const gm = /^group:(.+):(\d+)$/.exec(key);
    const cm = /^control:(.+)$/.exec(key);
    if (gm) {
      const g = groupsById.get(gm[1]!);
      const ti = Number(gm[2]);
      if (g && Number.isInteger(ti) && ti >= 0 && ti < g.targets.length) {
        unit = { type: 'group', group: g, targetIndex: ti };
      }
    } else if (cm) {
      const c = controlsById.get(cm[1]!);
      if (c) unit = { type: 'control', control: c };
    }

    if (!unit) {
      issues.push({
        level: 'error',
        code: 'ASSIGNMENT_MISMATCH',
        well,
        message: `孔 ${well} 指向了不存在或已失效的处理定义：${key}（调整重复数/目标浓度后请重新排布）`,
      });
      continue;
    }

    assignment[well] = key;
    parsed[well] = unit;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  for (const [key, want] of expected) {
    const got = counts.get(key) ?? 0;
    if (got !== want) {
      let label = key;
      const gm = /^group:(.+):(\d+)$/.exec(key);
      if (gm) {
        const g = groupsById.get(gm[1]!);
        if (g) label = `「${g.name}」目标浓度 ${g.targets[Number(gm[2])]} ${g.stockUnit}`;
      } else {
        const c = controlsById.get(key.slice('control:'.length));
        if (c) label = `对照「${c.name}」`;
      }
      issues.push({
        level: 'error',
        code: 'ASSIGNMENT_MISMATCH',
        message: `${label} 应占 ${want} 孔，当前板上为 ${got} 孔`,
      });
    }
  }

  // 占了超过预期数量（上面的循环会报“got≠want”，这里给出更具体的方向，不重复阻断）。
  for (const [key, got] of counts) {
    if (!expected.has(key)) {
      issues.push({
        level: 'error',
        code: 'ASSIGNMENT_MISMATCH',
        message: `板上出现了不属于当前配置的处理：${key}`,
      });
    }
  }

  return { assignment, issues, parsed };
}
