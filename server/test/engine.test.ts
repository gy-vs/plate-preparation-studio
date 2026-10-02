import { describe, expect, it } from 'vitest';
import { calculatePlan } from '../src/core/engine';
import type { CalculateRequest, DraftConfig } from '../../shared/api';
import { EPS } from '../src/core/units';

function baseConfig(over: Partial<DraftConfig> = {}): DraftConfig {
  return {
    diluentName: '培养基',
    pipette: { minVolume: 1, maxVolume: 1000 },
    overageFixed: 1,
    groups: [
      {
        name: '药物A',
        stockConcentration: 1000,
        stockUnit: 'uM',
        stockAvailable: 500,
        stockVolumeUnit: 'uL',
        targets: [200, 50, 10, 2],
        replicates: 3,
        finalVolume: 100,
        finalVolumeUnit: 'uL',
      },
    ],
    controls: [{ name: '空白对照', count: 2, finalVolume: 100, finalVolumeUnit: 'uL' }],
    ...over,
  };
}

function calc(config: DraftConfig, assignment = null): ReturnType<typeof calculatePlan> {
  const req: CalculateRequest = { config, assignment };
  return calculatePlan(req);
}

describe('体积守恒', () => {
  it('每个占用孔：加入液体体积之和必须等于终体积', () => {
    const r = calc(baseConfig());
    expect(r.feasible).toBe(true);
    for (const w of r.wells) {
      if (w.type === 'empty') {
        expect(w.additions).toHaveLength(0);
        continue;
      }
      const added = w.additions.reduce((s, a) => s + a.volumeUl, 0);
      expect(Math.abs(added - w.finalVolumeUl)).toBeLessThan(1e-6);
    }
  });

  it('终体积支持 mL 输入，内部按 1000 换算，绝不与 µL 混为一个数', () => {
    const r = calc(baseConfig({
      groups: [
        {
          name: '药物A', stockConcentration: 1000, stockUnit: 'uM',
          stockAvailable: 2, stockVolumeUnit: 'mL',
          targets: [100], replicates: 4,
          finalVolume: 0.2, finalVolumeUnit: 'mL',
        },
      ],
      controls: [],
    }));
    expect(r.feasible).toBe(true);
    const occupied = r.wells.filter((w) => w.type !== 'empty');
    expect(occupied).toHaveLength(4);
    for (const w of occupied) expect(w.finalVolumeUl).toBe(200);
    // 母液可用 2 mL = 2000 µL；每孔母液 20 µL × 4 = 80 µL，必须够。
    const stock = r.totals.stockByGroup[0]!;
    expect(stock.availableUl).toBe(2000);
    expect(stock.usedUl).toBeCloseTo(80, 9);
  });

  it('中间液配方自守恒：母液 aliquot + 稀释液 = 批量；复孔少时主动多配，把 aliquot 抬到最小移液体积', () => {
    // 2 µM @100µL：直接母液量仅 0.2 µL < 最小 1 µL，需要 5× 中间液
    // 净分装 15×1=15µL + 损耗 2µL = 17µL；但 aliquot 需 ≥1µL → batch ≥ 5×1=5µL（17 已满足）
    const r = calc(baseConfig({
      groups: [
        {
          name: '药物B', stockConcentration: 1000, stockUnit: 'uM',
          stockAvailable: 100, stockVolumeUnit: 'uL',
          targets: [2], replicates: 15,
          finalVolume: 100, finalVolumeUnit: 'uL',
        },
      ],
      controls: [],
    }));
    expect(r.feasible).toBe(true);
    const prep = r.steps.find((s) => s.kind === 'prepare_intermediate')!;
    expect(prep).toBeTruthy();
    const { stockUl, diluentUl, batchUl, dilutionFactor, intermediateConcentration } = prep.recipe!;
    expect(dilutionFactor).toBe(5);
    expect(intermediateConcentration).toBeCloseTo(200, 9);
    expect(Math.abs(stockUl + diluentUl - batchUl)).toBeLessThan(1e-9);
    expect(batchUl).toBe(16.1); // 15 孔 × 1 µL + 1 µL 损耗，向上取整 0.1µL
    expect(stockUl).toBeCloseTo(3.22, 9);
    expect(diluentUl).toBeCloseTo(12.88, 9);
    // 中间液配液本身也要满足移液器约束，不能被四舍五入成 0
    expect(stockUl).toBeGreaterThanOrEqual(1 - EPS);
  });

  it('复孔很少时主动多配中间液：aliquot 由最小移液体积决定，额外母液消耗如实计入', () => {
    // 3 孔 × 1µL + 1µL 损耗 = 4µL；但 aliquot 需 ≥1µL → batch ≥ pmin·D = 5µL，取 5
    const r = calc(baseConfig({
      groups: [
        {
          name: '药物B', stockConcentration: 1000, stockUnit: 'uM',
          stockAvailable: 100, stockVolumeUnit: 'uL',
          targets: [2], replicates: 3,
          finalVolume: 100, finalVolumeUnit: 'uL',
        },
      ],
      controls: [],
    }));
    expect(r.feasible).toBe(true);
    const used = r.totals.stockByGroup[0]!.usedUl;
    // 批量被抬到 5.1µL（含 0.1 取整），aliquot = 1.02µL，而非理论 3×0.2=0.6µL（移液器取不到）
    expect(used).toBeCloseTo(1.02, 9);
  });

  it('中间液把配制损耗真实计入母液消耗（母液用量 = aliquot，而非每孔理论量之和）', () => {
    const r = calc(baseConfig({
      groups: [
        {
          name: '药物B', stockConcentration: 1000, stockUnit: 'uM',
          stockAvailable: 100, stockVolumeUnit: 'uL',
          targets: [2], replicates: 15,
          finalVolume: 100, finalVolumeUnit: 'uL',
        },
      ],
      controls: [],
    }));
    const used = r.totals.stockByGroup[0]!.usedUl;
    expect(used).toBeCloseTo(3.22, 9); // 16.1µL/5，含损耗；不是 15 × 0.2 = 3
  });

  it('稀释液准备量 = 各分装槽（净量+损耗取整）+ 中间液配方内稀释液，且不小于入孔净量', () => {
    const r = calc(baseConfig());
    const { diluentPrepareUl, diluentNetUl, finalVolumeSumUl } = r.totals;
    expect(diluentPrepareUl).toBeGreaterThanOrEqual(diluentNetUl - 1e-9);
    // 全局守恒：所有孔终体积之和 = 稀释液入孔 + 母液/中间液入孔
    const stockIntoWells = r.wells.reduce(
      (s, w) =>
        s + w.additions.filter((a) => a.kind !== 'diluent').reduce((q, a) => q + a.volumeUl, 0),
      0,
    );
    expect(Math.abs(diluentNetUl + stockIntoWells - finalVolumeSumUl)).toBeLessThan(1e-6);
  });

  it('所有加液步骤的孔集合与板上对应类型的孔完全一致（板位即清单）', () => {
    const r = calc(baseConfig());
    const stockStepWells = r.steps.filter((s) => s.kind === 'dispense_stock').flatMap((s) => s.wells).sort();
    const directWells = r.wells
      .filter((w) => w.additions.some((a) => a.kind === 'stock'))
      .map((w) => w.well)
      .sort();
    expect(stockStepWells).toEqual(directWells);

    const intermediateStepWells = r.steps
      .filter((s) => s.kind === 'dispense_intermediate')
      .flatMap((s) => s.wells)
      .sort();
    const intermediateWells = r.wells
      .filter((w) => w.additions.some((a) => a.kind === 'intermediate'))
      .map((w) => w.well)
      .sort();
    expect(intermediateStepWells).toEqual(intermediateWells);
  });
});

describe('移液器约束与母液可用性', () => {
  it('母液量低于最小可操作体积且无整数倍中间稀释可行时，判不可执行并给出原因（不能四舍五入成零）', () => {
    // 最小移液体积 50µL、终体积 100µL：中间液和孔内稀释液都至少要 50µL，
    // 非平凡稀释（D≥2）在物理上放不下 → 无解，必须明说，不能配出“零体积”
    const r = calc(baseConfig({
      pipette: { minVolume: 50, maxVolume: 1000 },
      groups: [
        {
          name: '药物C', stockConcentration: 1000, stockUnit: 'uM',
          stockAvailable: 50, stockVolumeUnit: 'uL',
          targets: [0.5], replicates: 3,
          finalVolume: 100, finalVolumeUnit: 'uL',
        },
      ],
      controls: [],
    }));
    expect(r.feasible).toBe(false);
    expect(r.issues.some((i) => i.code === 'NO_INTERMEDIATE_DILUTION')).toBe(true);
    // 不可执行时绝不能同时产出 prepare_intermediate 步骤假装可做
    expect(r.steps.some((s) => s.kind === 'prepare_intermediate')).toBe(false);
  });

  it('母液不足必须判不可执行，且总览不能自报可执行', () => {
    const r = calc(baseConfig({
      groups: [
        {
          name: '药物A', stockConcentration: 1000, stockUnit: 'uM',
          stockAvailable: 5, stockVolumeUnit: 'uL',
          targets: [200, 50], replicates: 3,
          finalVolume: 100, finalVolumeUnit: 'uL',
        },
      ],
      controls: [],
    }));
    expect(r.feasible).toBe(false);
    const err = r.issues.find((i) => i.code === 'INSUFFICIENT_STOCK' && i.level === 'error')!;
    expect(err).toBeTruthy();
    expect(err.message).toContain('不足');
  });

  it('超过 96 孔容量时在排布前阻断', () => {
    const r = calc(baseConfig({
      groups: [
        {
          name: '药物A', stockConcentration: 1000, stockUnit: 'uM',
          stockAvailable: 1, stockVolumeUnit: 'mL',
          targets: [500, 250, 100, 50], replicates: 24,
          finalVolume: 100, finalVolumeUnit: 'uL',
        },
      ],
      controls: [{ name: '空白', count: 4, finalVolume: 100, finalVolumeUnit: 'uL' }],
    }));
    expect(r.feasible).toBe(false);
    expect(r.issues.some((i) => i.code === 'PLATE_OVERFLOW')).toBe(true);
  });

  it('目标浓度高于母液浓度不可配出', () => {
    const r = calc(baseConfig({
      groups: [
        {
          name: '药物A', stockConcentration: 100, stockUnit: 'uM',
          stockAvailable: 100, stockVolumeUnit: 'uL',
          targets: [200], replicates: 2,
          finalVolume: 100, finalVolumeUnit: 'uL',
        },
      ],
      controls: [],
    }));
    expect(r.feasible).toBe(false);
    expect(r.issues.some((i) => i.code === 'TARGET_EXCEEDS_STOCK')).toBe(true);
  });
});

describe('排布一致性', () => {
  it('改动重复数后沿用旧排布必须报 ASSIGNMENT_MISMATCH，不能静默指向旧安排', () => {
    const v1 = calc(baseConfig());
    const oldAssignment = v1.assignment;
    // 草稿改为每浓度 4 复孔，仍提交旧排布
    const cfg2 = baseConfig();
    cfg2.groups[0]!.replicates = 4;
    const v2 = calc(cfg2, oldAssignment);
    expect(v2.feasible).toBe(false);
    expect(v2.issues.some((i) => i.code === 'ASSIGNMENT_MISMATCH')).toBe(true);
  });

  it('手工移动一个孔，配液步骤的孔集合同步改变（不是只换颜色）', () => {
    const auto = calc(baseConfig());
    expect(auto.feasible).toBe(true);
    const key = 'group:g1:0'; // 200 µM
    const oldWells = auto.wells.filter((w) => w.groupId === 'g1' && w.targetIndex === 0).map((w) => w.well);
    // 与一个当前为空的孔交换（默认排布共占 14 孔，H12 必为空）
    const moving = oldWells[oldWells.length - 1]!;
    expect(auto.wells.find((w) => w.well === 'H12')!.type).toBe('empty');
    const assignment = { ...auto.assignment, [moving]: null, H12: key };
    const moved = calc(baseConfig(), assignment);
    expect(moved.feasible).toBe(true);
    const step = moved.steps.find(
      (s) => s.kind === 'dispense_stock' && s.wells.includes('H12'),
    )!;
    expect(step).toBeTruthy();
    expect(step.wells).not.toContain(moving);
    const h12 = moved.wells.find((w) => w.well === 'H12')!;
    expect(h12.type).toBe('group');
    expect(h12.targetConcentration).toBe(200);
    const emptied = moved.wells.find((w) => w.well === moving)!;
    expect(emptied.type).toBe('empty');
  });

  it('排布引用已不存在的处理定义时报错（空孔不允许被臆造定义）', () => {
    const r = calculatePlan({
      config: baseConfig(),
      assignment: { A1: 'group:deleted:9', A2: null } as never,
    });
    expect(r.feasible).toBe(false);
    expect(r.issues.some((i) => i.code === 'ASSIGNMENT_MISMATCH')).toBe(true);
    const a1 = r.wells.find((w) => w.well === 'A1')!;
    expect(a1.type).toBe('empty');
  });
});
