import type {
  ControlInput,
  DraftConfig,
  GroupInput,
  Issue,
} from '../../../shared/api.js';

export interface NormalizedGroup extends GroupInput {
  id: string;
  finalVolumeUl: number;
  stockAvailableUl: number;
}

export interface NormalizedControl extends ControlInput {
  id: string;
  finalVolumeUl: number;
}

export interface NormalizedConfig {
  raw: DraftConfig;
  pipette: { minVolume: number; maxVolume: number };
  overageFixed: number;
  diluentName: string;
  groups: NormalizedGroup[];
  controls: NormalizedControl[];
  issues: Issue[];
}

const CONC_UNITS = new Set(['uM', 'mM', 'ug/mL', 'ng/mL']);
const VOL_UNITS = new Set(['uL', 'mL']);

function isPositiveNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * 校验并归一化草稿。任何字段问题都作为 error 收集（不抛异常），
 * 这样前端仍能拿到结构完整的响应并定位错误。
 */
export function normalizeConfig(config: DraftConfig): NormalizedConfig {
  const issues: Issue[] = [];
  const groups: NormalizedGroup[] = [];
  const controls: NormalizedControl[] = [];

  if (!config || typeof config !== 'object') {
    return invalidRoot('请求体缺少 config 对象');
  }

  const diluentName = (config.diluentName ?? '').trim() || '稀释液';

  const pipette = { minVolume: 1, maxVolume: 1000 };
  if (
    isPositiveNumber(config.pipette?.minVolume) &&
    isPositiveNumber(config.pipette?.maxVolume)
  ) {
    pipette.minVolume = config.pipette.minVolume;
    pipette.maxVolume = config.pipette.maxVolume;
    if (pipette.minVolume >= pipette.maxVolume) {
      issues.push({
        level: 'error',
        code: 'INVALID_INPUT',
        message: `移液器最小可操作体积 ${pipette.minVolume} µL 必须小于量程上限 ${pipette.maxVolume} µL`,
      });
    }
  } else {
    issues.push({
      level: 'error',
      code: 'INVALID_INPUT',
      message: '移液器最小/最大体积必须为正数（µL）',
    });
  }

  const overageFixed =
    Number.isFinite(config.overageFixed) && config.overageFixed >= 0
      ? config.overageFixed
      : 0;
  if (!Number.isFinite(config.overageFixed) || config.overageFixed < 0) {
    issues.push({
      level: 'error',
      code: 'INVALID_INPUT',
      message: '操作损耗必须为不小于 0 的数（µL）',
    });
  }

  const seenNames = new Set<string>();
  (config.groups ?? []).forEach((g, gi) => {
    const id = (g.id && String(g.id)) || `g${gi + 1}`;
    const name = (g.name ?? '').trim() || `处理组 ${gi + 1}`;
    if (seenNames.has(name)) {
      issues.push({
        level: 'error',
        code: 'INVALID_INPUT',
        groupId: id,
        message: `处理组名称重复：${name}`,
      });
    }
    seenNames.add(name);

    let bad = false;
    const push = (message: string) =>
      issues.push({ level: 'error', code: 'INVALID_INPUT', groupId: id, message });

    if (!isPositiveNumber(g.stockConcentration)) {
      push(`处理组「${name}」母液浓度必须为正数`);
      bad = true;
    }
    if (!CONC_UNITS.has(g.stockUnit)) {
      push(`处理组「${name}」浓度单位不合法：${g.stockUnit}`);
      bad = true;
    }
    if (!isPositiveNumber(g.stockAvailable)) {
      push(`处理组「${name}」母液可用量必须为正数（不是无限供应）`);
      bad = true;
    }
    if (!VOL_UNITS.has(g.stockVolumeUnit)) {
      push(`处理组「${name}」母液体积单位不合法：${g.stockVolumeUnit}`);
      bad = true;
    }
    if (!isPositiveNumber(g.finalVolume)) {
      push(`处理组「${name}」每孔终体积必须为正数`);
      bad = true;
    }
    if (!VOL_UNITS.has(g.finalVolumeUnit)) {
      push(`处理组「${name}」终体积单位不合法：${g.finalVolumeUnit}`);
      bad = true;
    }
    if (!Number.isInteger(g.replicates) || g.replicates < 1) {
      push(`处理组「${name}」重复数必须为 ≥1 的整数`);
      bad = true;
    }
    const targets = (g.targets ?? []).filter(
      (t) => Number.isFinite(t) && t > 0,
    );
    if (targets.length === 0) {
      push(`处理组「${name}」至少需要一个目标浓度`);
      bad = true;
    }
    if (targets.length !== (g.targets ?? []).length) {
      push(`处理组「${name}」目标浓度必须全部为正数`);
      bad = true;
    }

    if (!bad) {
      groups.push({
        ...g,
        id,
        name,
        targets,
        finalVolumeUl:
          g.finalVolumeUnit === 'mL' ? g.finalVolume * 1000 : g.finalVolume,
        stockAvailableUl:
          g.stockVolumeUnit === 'mL' ? g.stockAvailable * 1000 : g.stockAvailable,
      });
    }
  });

  (config.controls ?? []).forEach((c, ci) => {
    const id = (c.id && String(c.id)) || `c${ci + 1}`;
    const name = (c.name ?? '').trim() || `对照 ${ci + 1}`;
    let bad = false;
    const push = (message: string) =>
      issues.push({ level: 'error', code: 'INVALID_INPUT', groupId: undefined, message });
    if (!Number.isInteger(c.count) || c.count < 1) {
      push(`对照「${name}」孔数必须为 ≥1 的整数`);
      bad = true;
    }
    if (!isPositiveNumber(c.finalVolume) || !VOL_UNITS.has(c.finalVolumeUnit)) {
      push(`对照「${name}」终体积必须为带合法单位的正数`);
      bad = true;
    }
    if (!bad) {
      controls.push({
        ...c,
        id,
        name,
        finalVolumeUl:
          c.finalVolumeUnit === 'mL' ? c.finalVolume * 1000 : c.finalVolume,
      });
    }
  });

  return { raw: config, pipette, overageFixed, diluentName, groups, controls, issues };

  function invalidRoot(message: string): NormalizedConfig {
    return {
      raw: config,
      pipette: { minVolume: 1, maxVolume: 1000 },
      overageFixed: 0,
      diluentName: '稀释液',
      groups: [],
      controls: [],
      issues: [{ level: 'error', code: 'INVALID_INPUT', message }],
    };
  }
}
