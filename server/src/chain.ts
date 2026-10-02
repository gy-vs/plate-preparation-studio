import type { LiquidRef } from "shared";

export interface ChainNode {
  id: string;
  label: string;
  /** 该中间液浓度，nM */
  concentrationN: number;
  /** 配制时从上游液体的取液体积，µL（≥ 移液器最小体积） */
  sourceVolumeUl: number;
  /** 配制时加入的稀释液体积，µL（为 0 或 ≥ 移液器最小体积） */
  diluentVolumeUl: number;
  /** 单次配制总量，µL */
  batchVolumeUl: number;
  /** 上游液体：母液或更高浓度中间液 */
  source: LiquidRef;
  self: LiquidRef;
  /** 0 = 直接分给孔的最低一级；数字越大浓度越高 */
  level: number;
}

export interface DosingPlan {
  strategy: "direct" | "chain";
  /** 最终加到每个孔里的液体 */
  doseLiquid: LiquidRef;
  /** 每孔加该液体的体积，µL（≥ 移液器最小体积） */
  perWellDoseUl: number;
  /** 全部孔消耗的该液体体积（不含配制损耗），µL */
  totalDoseConsumedUl: number;
  /** level 0 → 顶层顺序（给孔使用的在最前） */
  chain: ChainNode[];
  /** 直接从母液取出的总体积，µL */
  stockDrawUl: number;
  /** 各级中间液配制用稀释液总体积，µL */
  intermediateDiluentUl: number;
  failure?: string;
}

export interface BuildArgs {
  stockConcN: number;
  targetN: number;
  finalVolumeUl: number;
  wellCount: number;
  pipetteMinUl: number;
  deadVolumeUl: number;
  /** 中间液节点 id 前缀，如 I-G1-T2 */
  nodePrefix: string;
  stockLabel: string;
  targetLabel: string;
}

const EPS = 1e-9;
const MAX_DEPTH = 20;

/**
 * 为某个 (目标浓度, 终体积, 孔数) 单元构造可执行加样方案。
 *
 * 守恒关系：
 *   每孔：剂量 w + 孔内稀释液补齐 = 终体积 Vf，且 Ct·Vf = Cdose·w
 *   中间液节点：上游取液 a + 稀释液 d = 配制总量 B，且 Csrc·a = Cnode·B
 *   每份中间液只配一次：B = 下游消耗总量 + 操作损耗 deadVolume（损耗在配制处计一次）
 *
 * 可操作约束：每一次移液器转移都必须 ≥ pipetteMin（取母液、取中间液、
 * 配制时加稀释液、给孔加样、孔内补齐均包含；体积为 0 不算转移）。
 * 无法满足时返回 failure 并说明原因，绝不把亚最小体积四舍五入成 0。
 */
export function buildDosingPlan(args: BuildArgs): DosingPlan {
  const { stockConcN: Cs, targetN: Ct, finalVolumeUl: Vf, wellCount: n, pipetteMinUl: p, deadVolumeUl: dead } = args;
  const stock: LiquidRef = { kind: "stock", label: args.stockLabel };

  if (Ct > Cs * (1 + EPS)) {
    return fail(`目标浓度高于母液浓度，无法通过稀释得到。`);
  }
  if (Vf + EPS < p) {
    return fail(`终体积 ${Vf} µL 小于移液器最小可操作体积 ${p} µL，无法向孔内可靠加液。`);
  }

  const directDose = (Ct * Vf) / Cs; // 直接加母液时的每孔体积
  const directTopUp = Vf - directDose;

  // 情形一：直接母液加样，且剂量与补齐量（若有）都在可操作区间
  if (directDose + EPS >= p && (directTopUp <= EPS || directTopUp + EPS >= p)) {
    const consumed = directDose * n;
    return {
      strategy: "direct",
      doseLiquid: stock,
      perWellDoseUl: directDose,
      totalDoseConsumedUl: consumed,
      chain: [],
      stockDrawUl: consumed,
      intermediateDiluentUl: 0,
    };
  }

  // 选择最低一级中间液浓度 C0 与每孔剂量 w0 = Ct·Vf/C0：
  //  A) 直接剂量过小（低浓度目标）：取允许的最高浓度 C0 = Ct·Vf/p，此时 w0 = p
  //  B) 孔内补齐量过小（目标接近母液）：整孔终体积都由浓度恰好为 Ct 的中间液提供，
  //     w0 = Vf（孔内不再补稀释液），改在“批量配制”时完成混合。
  let C0: number;
  let w0: number;
  if (directDose + EPS < p) {
    C0 = Math.min(Cs, (Ct * Vf) / p);
    w0 = (Ct * Vf) / C0;
    if (w0 > Vf - p + EPS) {
      return fail(
        `终体积 ${Vf} µL 不足：需要至少两次 ≥ ${p} µL 的移液（加样 + 稀释液补齐），无法可靠配出目标。请加大终体积或放宽移液器最小体积。`
      );
    }
  } else {
    // directTopUp < p 且非零：整孔改用等浓度中间液
    C0 = Ct;
    w0 = Vf;
  }
  if (!(C0 > Ct * (1 - EPS)) && Math.abs(C0 - Ct) > EPS) {
    return fail(`无法为目标 ${args.targetLabel} 构造中间稀释。`);
  }

  // ---- 自底向上构造中间液链 ----
  // 每个节点的配制量允许超过“需求+损耗”（超配部分也是真实消耗，计入母液/稀释液用量），
  // 以保证该节点配制时的母液取液与稀释液移液都达到移液器最小体积。
  const nodes: ChainNode[] = [];
  let Cchild = C0;
  let demandChild = w0 * n; // 下游（孔）对 level 0 的消耗总量
  let level = 0;

  while (level <= MAX_DEPTH) {
    const Bmin = demandChild + dead;

    // 终止判定：能否直接用母液配制本节点（允许放大配制量）
    // a(B)=Cchild·B/Cs ≥ p；d(B)=B-a 为 0 或 ≥ p
    if (Cchild >= Cs * (1 - EPS)) {
      const B = Math.max(Bmin, p);
      const self = makeNodeLiquid(args.nodePrefix, level);
      nodes.push({
        id: self.nodeId!,
        label: self.label,
        concentrationN: Cchild,
        sourceVolumeUl: B,
        diluentVolumeUl: 0,
        batchVolumeUl: B,
        source: stock,
        self,
        level,
      });
      return finalize(nodes, w0, n);
    }
    const BforAliquot = (p * Cs) / Cchild;
    const BforDiluent = p / (1 - Cchild / Cs);
    const Bstock = Math.max(Bmin, BforAliquot, BforDiluent);
    const aStock = (Cchild * Bstock) / Cs;
    const dStock = Bstock - aStock;
    if (aStock + EPS >= p && (dStock <= EPS || dStock + EPS >= p)) {
      const self = makeNodeLiquid(args.nodePrefix, level);
      nodes.push({
        id: self.nodeId!,
        label: self.label,
        concentrationN: Cchild,
        sourceVolumeUl: aStock,
        diluentVolumeUl: dStock,
        batchVolumeUl: Bstock,
        source: stock,
        self,
        level,
      });
      return finalize(nodes, w0, n);
    }

    // 插入更高浓度的一级中间液：从 parent 恰好取 p；配制量至少 2p 以保证稀释液转移可操作
    const Bnode = Math.max(Bmin, 2 * p);
    const Cparent = (Cchild * Bnode) / p;
    if (!(Cparent > Cchild * (1 + EPS))) {
      return fail(`目标 ${args.targetLabel} 过低：损耗 ${dead} µL 下无法构造满足最小移液 ${p} µL 的中间稀释。`);
    }
    if (level === MAX_DEPTH) {
      return fail(`目标 ${args.targetLabel} 过低：稀释链超过 ${MAX_DEPTH} 级仍无法触及母液浓度。`);
    }

    const self = makeNodeLiquid(args.nodePrefix, level);
    nodes.push({
      id: self.nodeId!,
      label: self.label,
      concentrationN: Cchild,
      sourceVolumeUl: p, // 实际来自下一轮创建的 parent 节点（或母液）
      diluentVolumeUl: Bnode - p,
      batchVolumeUl: Bnode,
      source: makeNodeLiquid(args.nodePrefix, level + 1),
      self,
      level,
    });

    Cchild = Cparent;
    demandChild = p; // parent 只需供应本节点一次分装
    level++;
  }

  return fail(`稀释链超过 ${MAX_DEPTH} 级仍无法满足移液器最小体积约束。`);
}

function makeNodeLiquid(prefix: string, level: number): LiquidRef {
  return { kind: "intermediate", nodeId: `${prefix}-L${level}`, label: `中间液 ${prefix}·L${level}` };
}

function finalize(nodes: ChainNode[], perWellDose: number, n: number): DosingPlan {
  const top = nodes[nodes.length - 1]!;
  if (top.source.kind !== "stock") {
    return fail("稀释链构造异常：顶层未连接母液。");
  }
  const stockDraw = top.sourceVolumeUl;
  const intermediateDiluent = nodes.reduce((s, x) => s + x.diluentVolumeUl, 0);
  return {
    strategy: "chain",
    doseLiquid: nodes[0]!.self,
    perWellDoseUl: perWellDose,
    totalDoseConsumedUl: perWellDose * n,
    chain: nodes,
    stockDrawUl: stockDraw,
    intermediateDiluentUl: intermediateDiluent,
  };
}

function fail(message: string): DosingPlan {
  return {
    strategy: "direct",
    doseLiquid: { kind: "stock", label: "" },
    perWellDoseUl: NaN,
    totalDoseConsumedUl: NaN,
    chain: [],
    stockDrawUl: NaN,
    intermediateDiluentUl: NaN,
    failure: message,
  };
}
