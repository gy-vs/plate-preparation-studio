import type { PipetteSpec } from '../../../shared/api.js';
import { EPS, aboveMax, belowMin } from './units.js';

/**
 * 单个目标浓度的配液方式求解。
 *
 * 直接法（C1*V1=C2*V2）：
 *   母液加入量 s = cTarget / cStock * Vfinal
 *   稀释液     d = Vfinal - s
 *   可行条件：s、d 都在移液器可操作范围 [min, max] 内。
 *
 * 间接法（s 小于最小移液体积时，不能四舍五入成 0）：
 *   用整数稀释倍数 D 配一批中间液：Cmid = Cstock / D
 *     aliquot a（母液） = batch / D
 *     diluent q         = batch - a
 *     批量 batch 必须同时满足：
 *       (1) ≥ n·m + 固定损耗（够分装且有操作损耗）
 *       (2) ≥ pmin·D（把 aliquot 抬到移液器最小可操作体积）
 *     当复孔少、损耗摊薄后 aliquot 仍 < pmin 时，主动多配中间液，
 *     多消耗的母液/稀释液就是“中间稀释带来的消耗”，如实计入母液用量。
 *     batch 向上取整到 0.1 µL。
 *   每孔改加中间液 m = cTarget / Cmid * Vfinal = s·D，其余加稀释液 Vfinal - m。
 *   可行条件：a、q、m、(Vfinal-m) 都在 [min,max] 内，且 m ≤ Vfinal。
 */

export interface DirectSolution {
  mode: 'direct';
  stockPerWellUl: number;
  diluentPerWellUl: number;
}

export interface IntermediateSolution {
  mode: 'intermediate';
  dilutionFactor: number;
  intermediateConcentration: number;
  stockAliquotUl: number;
  intermediateDiluentUl: number;
  batchUl: number;
  intermediatePerWellUl: number;
  diluentPerWellUl: number;
}

export type TargetSolution = DirectSolution | IntermediateSolution;

export type SolveFailure =
  | { code: 'TARGET_EXCEEDS_STOCK'; message: string }
  | { code: 'TRANSFER_ABOVE_MAX'; message: string }
  | { code: 'DILUENT_BELOW_MIN'; message: string }
  | { code: 'NO_INTERMEDIATE_DILUTION'; message: string };

export interface SolveResult {
  ok: boolean;
  solution?: TargetSolution;
  failure?: SolveFailure;
}

/**
 * 中间液批次的可操作上限：用单道移液器配制时，
 * 批次超过量程上限的 MAX_BATCH_PIPETTE_FILLS 倍即不现实（需太多次吸液）。
 */
export const MAX_BATCH_PIPETTE_FILLS = 10;

function round1(v: number): number {
  return Math.ceil((v + EPS) * 10) / 10;
}

export function solveTarget(params: {
  cStock: number;
  cTarget: number;
  finalVolumeUl: number;
  replicateCount: number;
  pipette: PipetteSpec;
  overageFixed: number;
}): SolveResult {
  const { cStock, cTarget, finalVolumeUl: vf, replicateCount: n, pipette, overageFixed } = params;
  const { minVolume: pmin, maxVolume: pmax } = pipette;

  // 目标浓度不可能高于母液浓度（不做浓缩）。
  if (cTarget > cStock + EPS) {
    return {
      ok: false,
      failure: {
        code: 'TARGET_EXCEEDS_STOCK',
        message: `目标浓度 ${cTarget} 高于母液浓度 ${cStock}，无法用稀释达成`,
      },
    };
  }

  const s = (cTarget / cStock) * vf; // 每孔理论母液量
  const d = vf - s; // 直接法每孔稀释液

  // 单孔母液量超过移液器上限：分次移液不在本计划范围，直接判失败。
  if (aboveMax(s, pmax)) {
    return {
      ok: false,
      failure: {
        code: 'TRANSFER_ABOVE_MAX',
        message: `每孔母液量 ${s.toFixed(2)} µL 超过移液器上限 ${pmax} µL`,
      },
    };
  }

  // 直接法可行：母液量达到最小可操作体积，且稀释液量也可操作。
  if (!belowMin(s, pmin) && !belowMin(d, pmin)) {
    return { ok: true, solution: { mode: 'direct', stockPerWellUl: s, diluentPerWellUl: d } };
  }

  // 直接法的稀释液部分过小（目标浓度几乎等于母液浓度），中间稀释也无法补救。
  if (belowMin(d, pmin)) {
    return {
      ok: false,
      failure: {
        code: 'DILUENT_BELOW_MIN',
        message: `每孔稀释液仅 ${d.toFixed(2)} µL，低于最小可操作体积 ${pmin} µL，且无法通过中间稀释解决`,
      },
    };
  }

  // 否则 s < pmin：寻找整数中间稀释倍数 D。
  // D 下界：把每孔母液量放大到可操作区间，D >= pmin/s。
  const dMin = Math.max(2, Math.ceil((pmin - EPS) / s));
  // D 上界由每孔中间液 m = sD ≤ Vf - pmin（孔内还要留至少 pmin 给稀释液）给出。
  const dMax = Math.floor((vf - pmin + EPS) / s);

  for (let dFactor = dMin; dFactor <= dMax; dFactor++) {
    const cMid = cStock / dFactor;
    const m = s * dFactor; // 每孔中间液
    if (belowMin(m, pmin) || aboveMax(m, pmax)) continue;
    if (m > vf - pmin + EPS) continue;

    // 批量：净分装量+损耗，且必须足以让母液 aliquot 达到最小可操作体积。
    const batchRaw = Math.max(n * m + overageFixed, pmin * dFactor);
    const batch = round1(batchRaw);
    // 批次本身不能大到无法用移液器现实配制（稀释液吸液次数过多）。
    if (batch > pmax * MAX_BATCH_PIPETTE_FILLS + EPS) {
      // D 增大只会让批次需求更大，可直接结束搜索
      break;
    }
    const a = batch / dFactor; // 母液 aliquot
    const q = batch - a; // 中间液里的稀释液
    if (belowMin(a, pmin) || aboveMax(a, pmax)) continue;
    if (belowMin(q, pmin)) continue; // 中间液配液也要能可靠移取

    return {
      ok: true,
      solution: {
        mode: 'intermediate',
        dilutionFactor: dFactor,
        intermediateConcentration: cMid,
        stockAliquotUl: a,
        intermediateDiluentUl: q,
        batchUl: batch,
        intermediatePerWellUl: m,
        diluentPerWellUl: vf - m,
      },
    };
  }

  return {
    ok: false,
    failure: {
      code: 'NO_INTERMEDIATE_DILUTION',
      message:
        `目标浓度 ${cTarget} 对应母液量 ${s.toFixed(3)} µL < 最小可操作 ${pmin} µL，` +
        `且在整数倍中间稀释下仍无法同时满足 aliquot、中间液与孔内稀释液的移液约束（D 搜索区间 ${dMin}..${dMax}）`,
    },
  };
}
