// 领域类型定义。所有体积在引擎内部统一为微升（µL），浓度统一为纳摩尔每升（nM）。
// 输入侧保留用户原始单位字符串，结果同时返回规范值与原始单位展示值。

export type ConcentrationUnit = "pM" | "nM" | "µM" | "mM" | "M";
export type VolumeUnit = "µL" | "mL";

export const CONCENTRATION_TO_NM: Record<ConcentrationUnit, number> = {
  pM: 1e-3,
  nM: 1,
  "µM": 1e3,
  mM: 1e6,
  M: 1e9,
};

export const VOLUME_TO_UL: Record<VolumeUnit, number> = {
  "µL": 1,
  mL: 1000,
};

export interface GroupInput {
  id: string;
  name: string;
  /** 目标浓度数值（按 concentrationUnit 解释） */
  targets: number[];
  concentrationUnit: ConcentrationUnit;
  replicates: number;
  /** 每孔终体积数值（按 finalVolumeUnit 解释） */
  finalVolume: number;
  finalVolumeUnit: VolumeUnit;
}

export interface ControlsConfig {
  /** 对照孔数量，对照孔只加稀释液至终体积 */
  count: number;
  finalVolume: number;
  finalVolumeUnit: VolumeUnit;
  name?: string;
}

export interface RawConfig {
  experimentName: string;
  stockConcentration: number;
  stockConcentrationUnit: ConcentrationUnit;
  /** 母液实际可用量（有限值，不允许当作无限） */
  stockAvailable: number;
  stockAvailableUnit: VolumeUnit;
  /** 移液器单次移液最小可靠体积，µL */
  pipetteMinVolume: number;
  /** 配制每份中间液时需要预留的操作损耗，µL */
  deadVolume: number;
  groups: GroupInput[];
  controls: ControlsConfig;
}

/** 规范化后的配置：内部规范单位 nM / µL */
export interface NormalizedConfig {
  experimentName: string;
  stockConcentrationN: number; // nM
  stockAvailableUl: number;
  pipetteMinVolumeUl: number;
  deadVolumeUl: number;
  groups: NormalizedGroup[];
  controlWells: number;
  controlFinalVolumeUl: number;
}

export interface NormalizedGroup {
  id: string;
  name: string;
  targetsN: number[];
  replicates: number;
  finalVolumeUl: number;
}

export type WellKind = "treatment" | "control" | "empty";

export type AssignmentKey =
  | { kind: "treatment"; groupId: string; targetIndex: number }
  | { kind: "control" }
  | { kind: "empty" };

/** 孔位 -> 处理定义，一个孔只能对应一份定义；未出现的 key 视为空孔 */
export type AssignmentMap = Record<string, AssignmentKey>;

export interface AssignmentPayload {
  /** 用户提交的孔位安排，可能为空（由服务端自动排布）或引用了已删除/旧版本的组 */
  assignments?: Record<string, AssignmentKey>;
}

export type LiquidKind = "stock" | "intermediate" | "diluent";

export interface LiquidRef {
  kind: LiquidKind;
  /** 中间液节点 id；stock/diluent 时省略 */
  nodeId?: string;
  /** 展示名，例如“中间液 I-G1-10µM” */
  label: string;
}

export interface WellAddition {
  liquid: LiquidRef;
  /** 本次移液体积，µL（浓度混合中的母液/中间液部分） */
  volumeUl: number;
}

export interface WellPlan {
  wellId: string;
  row: string; // A-H
  col: number; // 1-12
  kind: WellKind;
  groupId?: string;
  groupName?: string;
  targetConcentrationN?: number;
  targetIndex?: number;
  replicateIndex?: number;
  finalVolumeUl: number;
  additions: WellAddition[];
  /** 稀释液补齐体积，µL */
  diluentTopUpUl: number;
}

export interface PrepStep {
  id: string;
  order: number;
  /** 该步涉及的液体（配制产物或被分装的液体） */
  liquid: LiquidRef;
  /** prepare_intermediate：配制中间液；dispense_dose：向孔加入母液/中间液；top_up_diluent：补稀释液至终体积 */
  action: "prepare_intermediate" | "dispense_dose" | "top_up_diluent";
  /** prepare_intermediate：取用的上游液体 */
  sourceLiquid?: LiquidRef;
  /** 配成的中间液浓度，nM */
  concentrationN?: number;
  /** 从上游取液体积（单次配制量），µL */
  sourceVolumeUl?: number;
  /** 加入稀释液体积，µL */
  diluentVolumeUl?: number;
  /** 配成总量，µL */
  batchVolumeUl?: number;
  /** 该中间液被复用了多少份、分给哪些孔（操作损耗只在配制处计一次） */
  usedByWells: string[];
  /** dispense 动作：每次移液体积 × 孔数 */
  dispensePerWellUl?: number;
  /** 该步涉及的总液体体积（已含损耗），µL */
  totalVolumeUl: number;
  note?: string;
}

export interface Reason {
  code:
    | "INVALID_INPUT"
    | "CAPACITY_EXCEEDED"
    | "TARGET_ABOVE_STOCK"
    | "TARGET_NOT_POSITIVE"
    | "DILUTION_CHAIN_FAILED"
    | "STOCK_INSUFFICIENT"
    | "CONTROL_VOLUME_INVALID"
    | "DEAD_VOLUME_INVALID"
    | "ASSIGNMENT_UNKNOWN_REFERENCE"
    | "ASSIGNMENT_COUNT_MISMATCH";
  message: string;
  detail?: Record<string, unknown>;
}

export interface ComputeResult {
  config: NormalizedConfig;
  configHash: string;
  /** 服务端实际采用的孔位安排（自动排布或修正非法引用后） */
  assignments: AssignmentMap;
  /** 提交的安排是否被服务端接受（false 时前端必须清空旧选中态） */
  assignmentAccepted: boolean;
  assignmentReasons: Reason[];
  wells: WellPlan[];
  steps: PrepStep[];
  totals: {
    stockRequiredUl: number;
    diluentRequiredUl: number;
    stockAvailableUl: number;
    intermediateBatchCount: number;
    occupiedWells: number;
    emptyWells: number;
  };
  feasible: boolean;
  reasons: Reason[];
  /** 体积守恒核对：每孔加液之和 === 终体积；每份中间液 取液+稀释液 === 配制量 */
  conservationChecks: ConservationCheck[];
  generatedAt: string;
}

export interface ConservationCheck {
  scope: string;
  expectedUl: number;
  actualUl: number;
  ok: boolean;
}

export interface ConfirmedPlan {
  confirmationId: string;
  confirmedAt: string;
  experimentName: string;
  configHash: string;
  config: NormalizedConfig;
  rawConfig: RawConfig;
  result: ComputeResult;
}

export interface PlannerState {
  draftRaw?: RawConfig;
  draftResult?: ComputeResult;
  confirmed?: ConfirmedPlan;
}
