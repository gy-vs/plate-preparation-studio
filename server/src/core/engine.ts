import type {
  Assignment,
  CalculateRequest,
  CalculateResponse,
  ControlInput,
  GroupInput,
  IntermediateInfo,
  Issue,
  LiquidAddition,
  PrepStep,
  WellInfo,
} from '../../../shared/api.js';
import { ALL_WELLS } from '../../../shared/plate.js';
import { autoAssign, checkAssignment, controlUnitKey, groupUnitKey } from './assignment.js';
import type { ParsedUnit } from './assignment.js';
import { solveTarget, type TargetSolution } from './dilution.js';
import { normalizeConfig } from './validate.js';
import { EPS, formatUl, prepRoundUp } from './units.js';

interface TargetComputed {
  mode: 'direct' | 'intermediate';
  stockPerWellUl: number;
  diluentPerWellUl: number;
  solution?: TargetSolution; // 缺省表示该目标无法可靠配出
}

/**
 * 计算入口（唯一）。前端板位图与操作清单都消费这个返回值，
 * 因此改板位必然改清单，不存在“两份对不上”的情况。
 */
export function calculatePlan(req: CalculateRequest): CalculateResponse {
  const cfg = normalizeConfig(req.config);
  const issues: Issue[] = [...cfg.issues];

  // ---------- 1. 孔数总量：排布前先看装不装得进一块板 ----------
  const neededWells =
    cfg.groups.reduce((sum, g) => sum + g.targets.length * g.replicates, 0) +
    cfg.controls.reduce((sum, c) => sum + c.count, 0);

  if (neededWells > ALL_WELLS.length) {
    issues.push({
      level: 'error',
      code: 'PLATE_OVERFLOW',
      message: `本次共需 ${neededWells} 孔，超过一块 96 孔板容量（${ALL_WELLS.length} 孔），请减少重复数、目标浓度或对照孔`,
    });
  }

  // ---------- 2. 每个目标浓度求解（直接法 / 中间稀释） ----------
  const computed = new Map<string, TargetComputed>(); // key groupUnitKey
  for (const g of cfg.groups) {
    g.targets.forEach((cTarget, ti) => {
      const res = solveTarget({
        cStock: g.stockConcentration,
        cTarget,
        finalVolumeUl: g.finalVolumeUl,
        replicateCount: g.replicates,
        pipette: cfg.pipette,
        overageFixed: cfg.overageFixed,
      });
      if (res.ok && res.solution) {
        const sol = res.solution;
        computed.set(groupUnitKey(g.id, ti), {
          mode: sol.mode,
          stockPerWellUl:
            sol.mode === 'direct' ? sol.stockPerWellUl : sol.intermediatePerWellUl,
          diluentPerWellUl: sol.diluentPerWellUl,
          solution: sol,
        });
      } else {
        issues.push({
          level: 'error',
          code: res.failure!.code as Issue['code'],
          groupId: g.id,
          message: `处理组「${g.name}」目标 ${cTarget} ${g.stockUnit}：${res.failure!.message}`,
        });
        // 理论值（直接稀释公式），仅用于草稿参照；不可执行由 issue 阻断。
        const s = (cTarget / g.stockConcentration) * g.finalVolumeUl;
        computed.set(groupUnitKey(g.id, ti), {
          mode: 'direct',
          stockPerWellUl: s,
          diluentPerWellUl: g.finalVolumeUl - s,
        });
      }
    });
  }

  // ---------- 3. 排布（自动或手工，手工严格校验） ----------
  let assignment: Assignment;
  let parsed: Record<string, ParsedUnit> = {};
  const overflow = neededWells > ALL_WELLS.length;
  if (req.assignment == null) {
    assignment = overflow ? {} : autoAssign(cfg);
    if (!overflow) {
      const chk = checkAssignment(cfg, assignment);
      issues.push(...chk.issues);
      parsed = chk.parsed;
    }
  } else {
    const chk = checkAssignment(cfg, req.assignment);
    issues.push(...chk.issues);
    assignment = chk.assignment;
    parsed = chk.parsed;
  }

  // ---------- 4. 孔位 -> 加液（96 孔完整视图，空孔仍是空孔） ----------
  const repCounters = new Map<string, number>();
  const wells: WellInfo[] = ALL_WELLS.map((well) => {
    const key = assignment[well] ?? null;
    if (!key) {
      return { well, type: 'empty', finalVolumeUl: 0, additions: [] };
    }
    const unit = parsed[well];
    const repIndex = repCounters.get(key) ?? 0;
    repCounters.set(key, repIndex + 1);

    if (unit?.type === 'group' && unit.group && unit.targetIndex !== undefined) {
      const g = unit.group;
      const ti = unit.targetIndex;
      const c = computed.get(groupUnitKey(g.id, ti))!;
      const additions: LiquidAddition[] = [];
      if (c.mode === 'intermediate') {
        additions.push({
          kind: 'intermediate',
          label: intermediateLabel(g, ti, c.solution!),
          volumeUl: c.stockPerWellUl,
        });
      } else {
        additions.push({
          kind: 'stock',
          label: `${g.name} 母液（${g.stockConcentration} ${g.stockUnit}）`,
          volumeUl: c.stockPerWellUl,
        });
      }
      additions.push({ kind: 'diluent', label: cfg.diluentName, volumeUl: c.diluentPerWellUl });
      return {
        well,
        type: 'group',
        groupId: g.id,
        groupName: g.name,
        targetIndex: ti,
        replicateIndex: repIndex,
        targetConcentration: g.targets[ti],
        concentrationUnit: g.stockUnit,
        finalVolumeUl: g.finalVolumeUl,
        additions,
      };
    }

    if (unit?.type === 'control' && unit.control) {
      const c = unit.control;
      return {
        well,
        type: 'control',
        controlId: c.id,
        controlName: c.name,
        replicateIndex: repIndex,
        finalVolumeUl: c.finalVolumeUl,
        additions: [{ kind: 'diluent', label: cfg.diluentName, volumeUl: c.finalVolumeUl }],
      };
    }

    // 排布引用了无法解析的处理（已由 issue 报告）：保持空孔，不臆造定义。
    return { well, type: 'empty', finalVolumeUl: 0, additions: [] };
  });

  // ---------- 5. 母液消耗与可用量（母液不是无限的） ----------
  const stockByGroup = cfg.groups.map((g) => {
    let used = 0;
    g.targets.forEach((_, ti) => {
      const c = computed.get(groupUnitKey(g.id, ti))!;
      const sol = c.solution;
      if (sol && sol.mode === 'intermediate') {
        used += sol.stockAliquotUl; // 配整批中间液从母液管取走的 aliquot
      } else {
        used += c.stockPerWellUl * g.replicates; // 直接法：每孔精确量 × 孔数
      }
    });
    // 比较容忍取整带来的 0.05µL 级数值误差（准备量向上取整到 0.1µL）。
    if (used > g.stockAvailableUl + 0.05 + EPS) {
      issues.push({
        level: 'error',
        code: 'INSUFFICIENT_STOCK',
        groupId: g.id,
        message:
          `处理组「${g.name}」母液不足：需要 ${formatUl(used)} µL，` +
          `实际可用仅 ${formatUl(g.stockAvailableUl)} µL（缺口 ${formatUl(used - g.stockAvailableUl)} µL）`,
      });
    } else if (used > g.stockAvailableUl * 0.9) {
      issues.push({
        level: 'warning',
        code: 'INSUFFICIENT_STOCK',
        groupId: g.id,
        message: `处理组「${g.name}」母液用量 ${formatUl(used)} µL 已达可用量 ${formatUl(g.stockAvailableUl)} µL 的 90% 以上`,
      });
    }
    return { groupId: g.id, groupName: g.name, usedUl: used, availableUl: g.stockAvailableUl };
  });

  // ---------- 6. 配液步骤（移液顺序） ----------
  const steps: PrepStep[] = [];
  const intermediatesByGroup = new Map<string, IntermediateInfo[]>();

  // 6.1 先配制所有中间液
  for (const g of cfg.groups) {
    const list: IntermediateInfo[] = [];
    g.targets.forEach((_, ti) => {
      const c = computed.get(groupUnitKey(g.id, ti))!;
      const sol = c.solution;
      if (!sol || sol.mode !== 'intermediate') return;
      const targetWells = wellsFor(assignment, groupUnitKey(g.id, ti));
      const info: IntermediateInfo = {
        groupId: g.id,
        key: groupUnitKey(g.id, ti),
        label: intermediateLabel(g, ti, sol),
        dilutionFactor: sol.dilutionFactor,
        concentration: sol.intermediateConcentration,
        concentrationUnit: g.stockUnit,
        stockAliquotUl: sol.stockAliquotUl,
        diluentUl: sol.intermediateDiluentUl,
        batchUl: sol.batchUl,
        wells: targetWells,
      };
      list.push(info);
      steps.push({
        order: 0,
        kind: 'prepare_intermediate',
        title: `配制中间液：${info.label}`,
        detail:
          `取 ${g.name} 母液 ${formatUl(sol.stockAliquotUl)} µL + ${cfg.diluentName} ` +
          `${formatUl(sol.intermediateDiluentUl)} µL，混匀得 ${formatUl(sol.batchUl)} µL ` +
          `（${sol.intermediateConcentration} ${g.stockUnit}，稀释 ${sol.dilutionFactor} 倍）。` +
          `净需 ${formatUl(targetWells.length * sol.intermediatePerWellUl)} µL，` +
          `含操作损耗 ${formatUl(cfg.overageFixed)} µL。供孔：${targetWells.join('、')}`,
        wells: targetWells,
        sourceLabel: info.label,
        perWellVolumeUl: sol.intermediatePerWellUl,
        prepareVolumeUl: sol.batchUl,
        recipe: {
          stockUl: sol.stockAliquotUl,
          diluentUl: sol.intermediateDiluentUl,
          batchUl: sol.batchUl,
          intermediateConcentration: sol.intermediateConcentration,
          concentrationUnit: g.stockUnit,
          dilutionFactor: sol.dilutionFactor,
        },
      });
    });
    intermediatesByGroup.set(g.id, list);
  }

  // 6.2 稀释液分装：按“每孔加入量”聚合成若干个分装槽（各自计损耗）
  const diluentGroups = new Map<number, string[]>();
  for (const w of wells) {
    const add = w.additions.find((a) => a.kind === 'diluent');
    if (add && add.volumeUl > EPS) {
      const list = diluentGroups.get(add.volumeUl) ?? [];
      list.push(w.well);
      diluentGroups.set(add.volumeUl, list);
    }
  }
  const diluentSteps: PrepStep[] = [...diluentGroups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([vol, ws]) => {
      const prepare = prepRoundUp(ws.length * vol + cfg.overageFixed);
      return {
        order: 0,
        kind: 'dispense_diluent' as const,
        title: `分装${cfg.diluentName}：每孔 ${formatUl(vol)} µL × ${ws.length} 孔`,
        detail:
          `向 ${ws.length} 个孔各加入 ${cfg.diluentName} ${formatUl(vol)} µL；` +
          `净需 ${formatUl(ws.length * vol)} µL，加操作损耗 ${formatUl(cfg.overageFixed)} µL，` +
          `实际准备 ${formatUl(prepare)} µL。孔位：${ws.join('、')}`,
        wells: ws,
        sourceLabel: cfg.diluentName,
        perWellVolumeUl: vol,
        prepareVolumeUl: prepare,
      };
    });

  // 6.3 中间液分装到孔
  const intermediateSteps: PrepStep[] = [];
  for (const g of cfg.groups) {
    g.targets.forEach((_, ti) => {
      const c = computed.get(groupUnitKey(g.id, ti))!;
      const sol = c.solution;
      if (!sol || sol.mode !== 'intermediate') return;
      const ws = wellsFor(assignment, groupUnitKey(g.id, ti));
      intermediateSteps.push({
        order: 0,
        kind: 'dispense_intermediate',
        title: `加入${intermediateLabel(g, ti, sol)}：每孔 ${formatUl(sol.intermediatePerWellUl)} µL × ${ws.length} 孔`,
        detail:
          `向 ${ws.length} 个孔各加入中间液 ${formatUl(sol.intermediatePerWellUl)} µL；` +
          `取自上一步配制的 ${formatUl(sol.batchUl)} µL 批次。孔位：${ws.join('、')}`,
        wells: ws,
        sourceLabel: intermediateLabel(g, ti, sol),
        perWellVolumeUl: sol.intermediatePerWellUl,
        prepareVolumeUl: sol.batchUl,
      });
    });
  }

  // 6.4 母液直接分装
  const stockSteps: PrepStep[] = [];
  for (const g of cfg.groups) {
    g.targets.forEach((cTarget, ti) => {
      const c = computed.get(groupUnitKey(g.id, ti))!;
      const sol = c.solution;
      if (!sol || sol.mode !== 'direct') return;
      const ws = wellsFor(assignment, groupUnitKey(g.id, ti));
      stockSteps.push({
        order: 0,
        kind: 'dispense_stock',
        title:
          `加入${g.name} 母液：目标 ${cTarget} ${g.stockUnit}，` +
          `每孔 ${formatUl(sol.stockPerWellUl)} µL × ${ws.length} 孔`,
        detail:
          `取母液（${g.stockConcentration} ${g.stockUnit}）向 ${ws.length} 个孔各加 ` +
          `${formatUl(sol.stockPerWellUl)} µL，共 ${formatUl(ws.length * sol.stockPerWellUl)} µL` +
          `（母液不计分装损耗）。孔位：${ws.join('、')}`,
        wells: ws,
        sourceLabel: `${g.name} 母液`,
        perWellVolumeUl: sol.stockPerWellUl,
        prepareVolumeUl: ws.length * sol.stockPerWellUl,
      });
    });
  }

  const allSteps = [...steps, ...diluentSteps, ...intermediateSteps, ...stockSteps];
  allSteps.forEach((s, i) => (s.order = i + 1));

  // ---------- 7. 汇总 ----------
  const occupied = wells.filter((w) => w.type !== 'empty');
  const diluentNet = occupied.reduce(
    (sum, w) => sum + (w.additions.find((a) => a.kind === 'diluent')?.volumeUl ?? 0),
    0,
  );
  const intermediateDiluent = allSteps
    .filter((s) => s.kind === 'prepare_intermediate')
    .reduce((sum, s) => sum + (s.recipe?.diluentUl ?? 0), 0);
  const diluentPrepare =
    diluentSteps.reduce((sum, s) => sum + s.prepareVolumeUl, 0) + intermediateDiluent;
  const finalVolumeSum = occupied.reduce((sum, w) => sum + w.finalVolumeUl, 0);

  const groupPlans = cfg.groups.map((g) => ({
    id: g.id,
    name: g.name,
    targets: g.targets.map((cTarget, ti) => ({
      index: ti,
      concentration: cTarget,
      mode: computed.get(groupUnitKey(g.id, ti))!.mode,
      wells: wellsFor(assignment, groupUnitKey(g.id, ti)),
    })),
    stockUsedUl: stockByGroup.find((s) => s.groupId === g.id)!.usedUl,
    stockAvailableUl: g.stockAvailableUl,
    intermediates: intermediatesByGroup.get(g.id) ?? [],
  }));

  const controls = cfg.controls.map((c: ControlInput) => ({
    id: c.id!,
    name: c.name,
    wells: wellsFor(assignment, controlUnitKey(c.id!)),
    finalVolumeUl: c.finalVolumeUnit === 'mL' ? c.finalVolume * 1000 : c.finalVolume,
  }));

  const feasible = !issues.some((i) => i.level === 'error');

  const basis = buildBasis(cfg, feasible, req.assignment != null);

  return {
    config: req.config,
    assignment,
    feasible,
    issues,
    wells,
    steps: allSteps,
    groups: groupPlans,
    controls,
    totals: {
      usedWells: occupied.length,
      emptyWells: ALL_WELLS.length - occupied.length,
      stockByGroup,
      diluentPrepareUl: diluentPrepare,
      diluentNetUl: diluentNet,
      finalVolumeSumUl: finalVolumeSum,
    },
    basis,
    calculatedAt: new Date().toISOString(),
  };
}

function wellsFor(assignment: Assignment, key: string): string[] {
  return ALL_WELLS.filter((w) => assignment[w] === key);
}

function intermediateLabel(g: GroupInput, ti: number, sol: TargetSolution): string {
  if (!sol || sol.mode !== 'intermediate') return '';
  return `${g.name} 中间液 ${sol.intermediateConcentration} ${g.stockUnit}（${sol.dilutionFactor}×，目标 ${g.targets[ti]}）`;
}

function buildBasis(
  cfg: ReturnType<typeof normalizeConfig>,
  feasible: boolean,
  manual: boolean,
): string[] {
  const lines = [
    '稀释公式：C1×V1 = C2×V2；每孔终体积 = 母液/中间液加入量 + 稀释液加入量。',
    `移液器约束：单次移液需在 ${cfg.pipette.minVolume}–${cfg.pipette.maxVolume} µL 之间；低于最小可操作体积时改走整数倍中间稀释，不做四舍五入。`,
    `操作损耗：每个稀释液/中间液分装批次固定多备 ${formatUl(cfg.overageFixed)} µL；母液取用不另加损耗。`,
    `排布方式：${manual ? '手工排布（已逐孔校验）' : '系统自动排布，按列（A1→H1→A2…）填充，其余孔留空'}；一个孔只有一份处理定义。`,
  ];
  for (const g of cfg.groups) {
    lines.push(
      `「${g.name}」母液 ${g.stockConcentration} ${g.stockUnit}，可用 ${formatUl(g.stockAvailableUl)} µL，` +
        `${g.targets.length} 个目标浓度 × ${g.replicates} 复孔，每孔终体积 ${formatUl(g.finalVolumeUl)} µL。`,
    );
  }
  for (const c of cfg.controls) {
    lines.push(`对照「${c.name}」${c.count} 孔，只加 ${cfg.diluentName} ${formatUl(c.finalVolumeUl)} µL/孔。`);
  }
  lines.push(feasible ? '校验结论：可执行（无阻断性错误）。' : '校验结论：不可执行（见错误项），确认与导出已被禁用。');
  return lines;
}
