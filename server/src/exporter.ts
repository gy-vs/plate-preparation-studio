import { type ConfirmedPlan, formatConcentration, formatVolumeUl, PLATE_COLS, PLATE_ROWS } from "shared";

/** 导出 TXT：含本次计算依据、孔位身份、每步液量与服务端结果的一一对应。 */
export function exportTxt(plan: ConfirmedPlan): string {
  const r = plan.result;
  const c = plan.config;
  const lines: string[] = [];
  lines.push(`# 96 孔板配液确认方案（冻结快照）`);
  lines.push(``);
  lines.push(`确认编号：${plan.confirmationId}`);
  lines.push(`实验名称：${plan.experimentName}`);
  lines.push(`确认时间：${plan.confirmedAt}`);
  lines.push(`配置签名：${plan.configHash}`);
  lines.push(``);
  lines.push(`## 计算依据`);
  lines.push(`- 母液浓度：${formatConcentration(c.stockConcentrationN)}`);
  lines.push(`- 母液可用量：${formatVolumeUl(c.stockAvailableUl)}（有限量，已参与充足性校验）`);
  lines.push(`- 移液器最小可操作体积：${formatVolumeUl(c.pipetteMinVolumeUl)}`);
  lines.push(`- 每份中间液操作损耗：${formatVolumeUl(c.deadVolumeUl)}`);
  lines.push(`- 处理组：${c.groups.length}；对照孔：${c.controlWells}`);
  lines.push(`- 占用孔位：${r.totals.occupiedWells}/96，空孔：${r.totals.emptyWells}`);
  lines.push(``);
  lines.push(`## 用量汇总`);
  lines.push(`- 母液实际需备：${formatVolumeUl(r.totals.stockRequiredUl)} / 可用 ${formatVolumeUl(r.totals.stockAvailableUl)}`);
  lines.push(`- 稀释液实际需备：${formatVolumeUl(r.totals.diluentRequiredUl)}`);
  lines.push(`- 中间液配制份数：${r.totals.intermediateBatchCount}`);
  lines.push(``);
  lines.push(`## 板位（8 行 × 12 列，空孔标记为 ---）`);
  const cell = (row: string, col: number) => {
    const w = r.wells.find((x) => x.row === row && x.col === col)!;
    if (w.kind === "empty") return "---";
    if (w.kind === "control") return `${w.wellId}:CTRL`;
    return `${w.wellId}:${w.groupName}/T${(w.targetIndex ?? 0) + 1}/r${w.replicateIndex}`;
  };
  lines.push(`     ${PLATE_COLS.map((c) => String(c).padStart(14)).join("")}`);
  for (const row of PLATE_ROWS) {
    lines.push(`${row}  ${PLATE_COLS.map((col) => cell(row, col).padStart(14)).join("")}`);
  }
  lines.push(``);
  lines.push(`## 逐孔身份与加液`);
  for (const w of r.wells) {
    if (w.kind === "empty") continue;
    const add = w.additions.map((a) => `${a.liquid.label} ${formatVolumeUl(a.volumeUl)}`).join(" + ") || "无";
    lines.push(
      `- ${w.wellId} [${w.kind === "control" ? "对照" : `${w.groupName}｜目标 ${formatConcentration(w.targetConcentrationN!)}（第 ${w.targetIndex! + 1} 点）｜重复 ${w.replicateIndex}`}] 终体积 ${formatVolumeUl(w.finalVolumeUl)}：${add}；补稀释液 ${formatVolumeUl(w.diluentTopUpUl)}`
    );
  }
  lines.push(``);
  lines.push(`## 移液步骤（顺序执行）`);
  for (const s of r.steps) {
    lines.push(``);
    lines.push(`步骤 ${s.order}｜${actionLabel(s.action)}｜${s.liquid.label}`);
    if (s.action === "prepare_intermediate") {
      lines.push(`  取 ${s.sourceLiquid!.label} ${formatVolumeUl(s.sourceVolumeUl!)} + 稀释液 ${formatVolumeUl(s.diluentVolumeUl!)} = ${formatVolumeUl(s.batchVolumeUl!)}（浓度 ${formatConcentration(s.concentrationN!)}）`);
    } else if (s.dispensePerWellUl !== undefined) {
      lines.push(`  每孔 ${formatVolumeUl(s.dispensePerWellUl)} × ${s.usedByWells.length} 孔`);
    }
    lines.push(`  孔位：${s.usedByWells.join(", ")}`);
    lines.push(`  说明：${s.note ?? ""}`);
  }
  lines.push(``);
  lines.push(`## 体积守恒核对`);
  for (const chk of r.conservationChecks) {
    lines.push(`- [${chk.ok ? "OK" : "FAIL"}] ${chk.scope}：${formatVolumeUl(chk.actualUl)} = 应得 ${formatVolumeUl(chk.expectedUl)}`);
  }
  lines.push(``);
  lines.push(`状态：${r.feasible ? "可执行" : "不可执行"}`);
  return lines.join("\n");
}

function actionLabel(a: string): string {
  return a === "prepare_intermediate" ? "配制中间液" : a === "dispense_dose" ? "分装加样" : "稀释液补齐";
}

/** 导出逐孔 CSV：孔位身份 + 加液步骤可被同事直接核对 */
export function exportCsv(plan: ConfirmedPlan): string {
  const rows: string[] = [];
  rows.push(["well_id", "row", "col", "kind", "group", "target_nM", "replicate", "final_ul", "additions", "topup_diluent_ul"].join(","));
  for (const w of plan.result.wells) {
    if (w.kind === "empty") continue;
    rows.push(
      [
        w.wellId,
        w.row,
        w.col,
        w.kind,
        w.groupName ?? "",
        w.targetConcentrationN ?? "",
        w.replicateIndex ?? "",
        w.finalVolumeUl,
        w.additions.map((a) => `${a.liquid.label} ${a.volumeUl}ul`).join(" | "),
        w.diluentTopUpUl,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return rows.join("\n");
}

function csvCell(v: unknown): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
