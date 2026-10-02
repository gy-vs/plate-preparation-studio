import type { RawConfig } from "shared";

export function makeRaw(overrides: Partial<RawConfig> = {}): RawConfig {
  return {
    experimentName: "测试板",
    stockConcentration: 100,
    stockConcentrationUnit: "µM",
    stockAvailable: 500,
    stockAvailableUnit: "µL",
    pipetteMinVolume: 2,
    deadVolume: 5,
    controls: { count: 2, finalVolume: 200, finalVolumeUnit: "µL", name: "对照" },
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
    ...overrides,
  };
}
