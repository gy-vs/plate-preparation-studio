import type { RawConfig } from "shared";

/** 打开页面即可直接配置：预置一组会触发中间稀释的梯度，便于立刻看到完整计划。 */
export const DEFAULT_CONFIG: RawConfig = {
  experimentName: "浓度梯度 2026-10-02",
  stockConcentration: 100,
  stockConcentrationUnit: "µM",
  stockAvailable: 500,
  stockAvailableUnit: "µL",
  pipetteMinVolume: 2,
  deadVolume: 5,
  controls: { count: 3, finalVolume: 200, finalVolumeUnit: "µL", name: "空白对照" },
  groups: [
    {
      id: "G1",
      name: "药物A",
      targets: [10, 1, 0.1],
      concentrationUnit: "µM",
      replicates: 3,
      finalVolume: 200,
      finalVolumeUnit: "µL",
    },
  ],
};

export function freshGroup(index: number): RawConfig["groups"][number] {
  return {
    id: `G${Date.now().toString(36)}${index}`,
    name: `处理组 ${index + 1}`,
    targets: [10, 1, 0.1],
    concentrationUnit: "µM",
    replicates: 3,
    finalVolume: 200,
    finalVolumeUnit: "µL",
  };
}
