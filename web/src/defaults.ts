import type { DraftConfig } from '../../shared/api';

/** 打开页面即可直接配置：一份有代表性的默认草稿（含需要中间稀释的低浓度目标）。 */
export function defaultDraft(): DraftConfig {
  return {
    diluentName: '完全培养基',
    pipette: { minVolume: 1, maxVolume: 1000 },
    overageFixed: 2,
    groups: [
      {
        name: '药物A',
        stockConcentration: 1000,
        stockUnit: 'uM',
        stockAvailable: 500,
        stockVolumeUnit: 'uL',
        targets: [200, 50, 10],
        replicates: 3,
        finalVolume: 100,
        finalVolumeUnit: 'uL',
      },
      {
        name: '药物B（低浓度）',
        stockConcentration: 1000,
        stockUnit: 'uM',
        stockAvailable: 200,
        stockVolumeUnit: 'uL',
        targets: [2],
        replicates: 6,
        finalVolume: 100,
        finalVolumeUnit: 'uL',
      },
    ],
    controls: [{ name: '空白对照', count: 2, finalVolume: 100, finalVolumeUnit: 'uL' }],
  };
}
