// 前后端 API 契约。计算规则只在服务端 engine 中实现，
// 前端板位图与操作清单都渲染同一个 CalculateResponse。

import type { ALL_WELLS } from './plate';

export type ConcentrationUnit = 'uM' | 'mM' | 'ug/mL' | 'ng/mL';
export type VolumeUnit = 'uL' | 'mL';

/** 一个处理组：一种母液 + 一串目标浓度 + 每浓度重复孔数。 */
export interface GroupInput {
  id?: string;
  name: string;
  stockConcentration: number; // 母液浓度（数值，单位见 stockUnit）
  stockUnit: ConcentrationUnit;
  /** 该组母液实际可被本次实验取用的量（数值，单位见 stockVolumeUnit）。不是无限的。 */
  stockAvailable: number;
  stockVolumeUnit: VolumeUnit;
  /** 目标浓度序列，单位与 stockUnit 相同。 */
  targets: number[];
  replicates: number;
  /** 每孔终体积（数值，单位见 finalVolumeUnit）。 */
  finalVolume: number;
  finalVolumeUnit: VolumeUnit;
}

/** 对照孔：只加稀释液，体积与同组终体积一致。 */
export interface ControlInput {
  id?: string;
  name: string;
  count: number;
  finalVolume: number;
  finalVolumeUnit: VolumeUnit;
}

export interface PipetteSpec {
  /** 单次移液最小可操作体积（µL）。低于此值无法可靠加液。 */
  minVolume: number;
  /** 移液器量程上限（µL）。 */
  maxVolume: number;
}

export interface DraftConfig {
  /** 稀释液名称，例如“完全培养基 / PBS”。 */
  diluentName: string;
  pipette: PipetteSpec;
  /**
   * 每个中间液/稀释液“分装槽”额外计入的操作损耗（µL 绝对量）。
   * 母液本身不加损耗：损耗只体现在被配制的中间液上。
   */
  overageFixed: number;
  groups: GroupInput[];
  controls: ControlInput[];
}

/** 孔位 -> 处理单元 key（group:gid:targetIndex 或 control:cid）。空孔不出现或显式 null。 */
export type Assignment = Record<string, string | null>;

export interface CalculateRequest {
  config: DraftConfig;
  /** 缺省时服务端按先列后行自动排布；提供时做严格校验。 */
  assignment?: Assignment | null;
}

export type IssueCode =
  | 'INVALID_INPUT'
  | 'PLATE_OVERFLOW'
  | 'TARGET_EXCEEDS_STOCK'
  | 'TRANSFER_BELOW_MIN'
  | 'TRANSFER_ABOVE_MAX'
  | 'DILUENT_BELOW_MIN'
  | 'NO_INTERMEDIATE_DILUTION'
  | 'INSUFFICIENT_STOCK'
  | 'ASSIGNMENT_MISMATCH'
  | 'DUPLICATE_WELL'
  | 'UNKNOWN_WELL';

export interface Issue {
  level: 'error' | 'warning';
  code: IssueCode;
  message: string;
  /** 关联的组/孔，便于前端定位。 */
  groupId?: string;
  well?: string;
}

export interface LiquidAddition {
  /** stock | intermediate | diluent */
  kind: 'stock' | 'intermediate' | 'diluent';
  label: string;
  /** 本孔该液体的精确加入体积（µL，未取整；显示时由前端格式化）。 */
  volumeUl: number;
}

export interface WellInfo {
  well: string;
  /** group | control | empty */
  type: 'group' | 'control' | 'empty';
  groupId?: string;
  groupName?: string;
  targetIndex?: number;
  replicateIndex?: number;
  controlId?: string;
  controlName?: string;
  /** 目标浓度（与组的 stockUnit 同单位）；对照与空孔无。 */
  targetConcentration?: number;
  concentrationUnit?: ConcentrationUnit;
  finalVolumeUl: number;
  /** 该孔需要加的液体（体积之和必须等于终体积 —— 服务端测试保证）。 */
  additions: LiquidAddition[];
}

/** 一条配液/移液步骤。 */
export interface PrepStep {
  /** 全局排序号，即实际移液顺序。 */
  order: number;
  /** prepare_intermediate | dispense_stock | dispense_intermediate | dispense_diluent */
  kind:
    | 'prepare_intermediate'
    | 'dispense_stock'
    | 'dispense_intermediate'
    | 'dispense_diluent';
  title: string;
  detail: string;
  /** 该步骤处理的孔（空孔不含）。 */
  wells: string[];
  sourceLabel: string;
  /** 每个目标孔加入量（µL）。 */
  perWellVolumeUl: number;
  /** 实际需要准备/取用的总量（µL，已计入操作损耗与配制分量）。 */
  prepareVolumeUl: number;
  /** 仅 prepare_intermediate：配制配方。 */
  recipe?: {
    stockUl: number;
    diluentUl: number;
    batchUl: number;
    intermediateConcentration: number;
    concentrationUnit: ConcentrationUnit;
    dilutionFactor: number;
  };
}

export interface GroupPlan {
  id: string;
  name: string;
  /** 每个 target 的排布与计算。 */
  targets: Array<{
    index: number;
    concentration: number;
    mode: 'direct' | 'intermediate';
    wells: string[];
    /** 每孔母液/中间液加入量 µL。 */
  }>;
  /** 本组母液总消耗 µL（精确值，不含配制损耗；中间液损耗体现在 aliquot 放大里）。 */
  stockUsedUl: number;
  stockAvailableUl: number;
  intermediates: IntermediateInfo[];
}

export interface IntermediateInfo {
  groupId: string;
  /** 同一组内的中间液序号（通常一组一个）。 */
  key: string;
  label: string;
  dilutionFactor: number;
  concentration: number;
  concentrationUnit: ConcentrationUnit;
  /** 母液 aliquot（µL，即配这批中间液实际从母液管取走的量）。 */
  stockAliquotUl: number;
  diluentUl: number;
  batchUl: number;
  /** 使用该中间液的孔。 */
  wells: string[];
}

export interface Totals {
  usedWells: number;
  emptyWells: number;
  /** 全部组母液消耗（µL，按组）。 */
  stockByGroup: Array<{ groupId: string; groupName: string; usedUl: number; availableUl: number }>;
  /** 稀释液总准备量（µL，已含各分装槽损耗）。 */
  diluentPrepareUl: number;
  /** 稀释液进入孔内的净体积（µL，不含损耗）。 */
  diluentNetUl: number;
  /** 所有孔终体积之和（µL）。 */
  finalVolumeSumUl: number;
}

export interface CalculateResponse {
  config: DraftConfig;
  assignment: Assignment;
  feasible: boolean;
  issues: Issue[];
  wells: Array<WellInfo>; // 固定 96 项，顺序与 ALL_WELLS 一致
  steps: PrepStep[];
  groups: GroupPlan[];
  controls: Array<{
    id: string;
    name: string;
    wells: string[];
    finalVolumeUl: number;
  }>;
  totals: Totals;
  /** 本次计算依据的文字说明（会进入确认快照与导出）。 */
  basis: string[];
  calculatedAt: string;
}

export interface ConfirmPlanRequest {
  response: CalculateResponse;
  note?: string;
}

export interface ConfirmedPlan {
  id: string;
  createdAt: string;
  note?: string;
  response: CalculateResponse;
  /** 规范序列化后内容的 sha256，前端用于核对“这份没被改写”。 */
  contentHash: string;
}

export type WellList = readonly string[];
export type { ALL_WELLS };
