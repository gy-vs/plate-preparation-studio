import {
  CONCENTRATION_TO_NM,
  VOLUME_TO_UL,
  type ConcentrationUnit,
  type NormalizedConfig,
  type RawConfig,
  type Reason,
  type VolumeUnit,
} from "shared";

export function concentrationToN(value: number, unit: ConcentrationUnit): number {
  return value * CONCENTRATION_TO_NM[unit];
}

export function volumeToUl(value: number, unit: VolumeUnit): number {
  return value * VOLUME_TO_UL[unit];
}

export interface NormalizeOutcome {
  config: NormalizedConfig | null;
  reasons: Reason[];
}

/** 规范化原始输入并做与排布无关的硬校验。单位在这里一次性换算，下游只处理 nM / µL。 */
export function normalizeConfig(raw: RawConfig): NormalizeOutcome {
  const reasons: Reason[] = [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  const stockConc = num(raw.stockConcentration);
  const stockAvail = num(raw.stockAvailable);
  const pipMin = num(raw.pipetteMinVolume);
  const dead = num(raw.deadVolume);

  if (stockConc === null || stockConc <= 0) {
    reasons.push({ code: "INVALID_INPUT", message: "母液浓度必须为大于 0 的数字。" });
  }
  if (stockAvail === null || stockAvail <= 0) {
    reasons.push({ code: "INVALID_INPUT", message: "母液可用量必须为大于 0 的数字（母液不是无限的）。" });
  }
  if (pipMin === null || pipMin < 0) {
    reasons.push({ code: "INVALID_INPUT", message: "移液器最小可操作体积必须为非负数字（µL）。" });
  }
  // 损耗必须 >0：否则逐次二分会无限逼近而无法可靠移液。
  if (dead === null || dead <= 0) {
    reasons.push({
      code: "DEAD_VOLUME_INVALID",
      message: "操作损耗（死体积）必须为大于 0 的数字，否则无法可靠设计中间稀释。",
    });
  }
  if (!raw.groups || raw.groups.length === 0) {
    reasons.push({ code: "INVALID_INPUT", message: "至少需要一个处理组。" });
  }

  const groups: NormalizedConfig["groups"] = [];
  for (const g of raw.groups ?? []) {
    const reps = num(g.replicates);
    const fv = num(g.finalVolume);
    if (!g.id?.trim()) {
      reasons.push({ code: "INVALID_INPUT", message: "存在缺少 id 的处理组。" });
      continue;
    }
    if (reps === null || reps < 1 || !Number.isInteger(reps)) {
      reasons.push({ code: "INVALID_INPUT", message: `组「${g.name || g.id}」的重复数必须是 ≥1 的整数。` });
    }
    if (fv === null || fv <= 0) {
      reasons.push({ code: "INVALID_INPUT", message: `组「${g.name || g.id}」的每孔终体积必须大于 0。` });
    }
    const rawTargets = Array.isArray(g.targets) ? g.targets : [];
    if (rawTargets.length === 0) {
      reasons.push({ code: "INVALID_INPUT", message: `组「${g.name || g.id}」没有目标浓度序列。` });
    }
    const targetsN = rawTargets.map((t, i) => {
      const v = num(t);
      if (v === null || v <= 0) {
        reasons.push({
          code: "TARGET_NOT_POSITIVE",
          message: `组「${g.name || g.id}」第 ${i + 1} 个目标浓度必须为大于 0 的数字；若需要零浓度孔请使用对照孔。`,
        });
        return NaN;
      }
      return concentrationToN(v, g.concentrationUnit);
    });
    const validTargets = targetsN.filter((t) => Number.isFinite(t));
    groups.push({
      id: g.id,
      name: g.name?.trim() || g.id,
      targetsN: validTargets,
      replicates: reps ?? 1,
      finalVolumeUl: fv === null ? NaN : volumeToUl(fv, g.finalVolumeUnit),
    });
  }

  const ctrlCount = num(raw.controls?.count);
  const ctrlFv = num(raw.controls?.finalVolume);
  if (ctrlCount === null || ctrlCount < 0 || !Number.isInteger(ctrlCount)) {
    reasons.push({ code: "CONTROL_VOLUME_INVALID", message: "对照孔数量必须为 ≥0 的整数。" });
  }
  if (ctrlFv === null || ctrlFv <= 0) {
    reasons.push({ code: "CONTROL_VOLUME_INVALID", message: "对照孔终体积必须大于 0。" });
  }

  if (reasons.length > 0) {
    return { config: null, reasons };
  }

  const config: NormalizedConfig = {
    experimentName: raw.experimentName?.trim() || "未命名实验",
    stockConcentrationN: concentrationToN(stockConc!, raw.stockConcentrationUnit),
    stockAvailableUl: volumeToUl(stockAvail!, raw.stockAvailableUnit),
    pipetteMinVolumeUl: pipMin!,
    deadVolumeUl: dead!,
    groups,
    controlWells: ctrlCount!,
    controlFinalVolumeUl: volumeToUl(ctrlFv!, raw.controls!.finalVolumeUnit),
  };

  return { config, reasons: [] };
}
