import {
  formatConcentration,
  formatTransferUl,
  formatVolumeUl,
  type ComputeResult,
  type PrepStep,
} from "shared";

interface Props {
  result: ComputeResult;
  selectedWell: string | null;
  onSelectWell: (id: string | null) => void;
}

export function DetailsPanel({ result, selectedWell, onSelectWell }: Props) {
  const well = selectedWell ? result.wells.find((w) => w.wellId === selectedWell) ?? null : null;

  return (
    <div>
      <WellDetail result={result} well={well} />
      <h3 style={{ marginTop: 14 }}>配液步骤（按执行顺序）</h3>
      <p className="muted">
        中间液自上而下配制（已含操作损耗），随后分装加样，最后统一补稀释液。点击孔位编号可跳转核对该孔。
      </p>
      {result.steps.map((step) => (
        <StepCard key={step.id} step={step} result={result} onSelectWell={onSelectWell} />
      ))}
      {result.steps.length === 0 && <div className="muted">当前方案不可执行，暂无可执行步骤。</div>}
    </div>
  );
}

function WellDetail({ result, well }: { result: ComputeResult; well: ReturnCase }) {
  if (!well) {
    return (
      <div className="detail-box">
        <div className="big">未选孔</div>
        <div className="muted">点击板上孔位查看其所属组、目标浓度、终体积与应加液体。</div>
      </div>
    );
  }
  if (well.kind === "empty") {
    return (
      <div className="detail-box">
        <div className="big">{well.wellId} · 空孔</div>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          空孔仍然是空孔，不接受任何处理，不出现在操作清单中。
        </p>
      </div>
    );
  }
  const pipMin = result.config.pipetteMinVolumeUl;
  return (
    <div className="detail-box">
      <div className="big">
        {well.wellId} · {well.kind === "control" ? "对照孔" : well.groupName}
      </div>
      <dl className="kv">
        {well.kind === "treatment" && (
          <>
            <dt>目标浓度</dt>
            <dd>{formatConcentration(well.targetConcentrationN!)}</dd>
            <dt>浓度点</dt>
            <dd>第 {(well.targetIndex ?? 0) + 1} 点 · 重复 {well.replicateIndex}</dd>
          </>
        )}
        {well.kind === "control" && (
          <>
            <dt>类型</dt>
            <dd>空白对照（仅稀释液）</dd>
          </>
        )}
        <dt>每孔终体积</dt>
        <dd>{formatVolumeUl(well.finalVolumeUl)}</dd>
        <dt>应加液体</dt>
        <dd>
          {well.additions.length === 0
            ? "无母液/中间液"
            : well.additions.map((a) => (
                <div key={a.liquid.label}>
                  {a.liquid.label}：{formatTransferUl(a.volumeUl, pipMin)}
                </div>
              ))}
        </dd>
        <dt>补稀释液</dt>
        <dd>{formatVolumeUl(well.diluentTopUpUl)}</dd>
      </dl>
      {well.kind === "treatment" && (
        <Provenance result={result} wellId={well.wellId} />
      )}
    </div>
  );
}

/** 这份中间液被哪些孔使用：从孔反向追到涉及它的配制/分装步骤 */
function Provenance({ result, wellId }: { result: ComputeResult; wellId: string }) {
  const related = result.steps.filter((s) => s.usedByWells.includes(wellId));
  if (related.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div className="muted" style={{ fontSize: 12 }}>
        该孔涉及的配液步骤
      </div>
      {related.map((s) => (
        <div key={s.id} className="muted" style={{ fontSize: 12 }}>
          步骤 {s.order}：{actionLabel(s.action)} · {s.liquid.label}
        </div>
      ))}
    </div>
  );
}

function StepCard({
  step,
  result,
  onSelectWell,
}: {
  step: PrepStep;
  result: ComputeResult;
  onSelectWell: (id: string | null) => void;
}) {
  return (
    <div className="step">
      <div className="top">
        <span>
          {step.order}. {step.liquid.label}
        </span>
        <span className="tag">{actionLabel(step.action)}</span>
      </div>
      <div className="meta">
        {step.action === "prepare_intermediate" && (
          <>
            取 {step.sourceLiquid!.label} {formatVolumeUl(step.sourceVolumeUl!)} + 稀释液{" "}
            {formatVolumeUl(step.diluentVolumeUl!)} → 配制 {formatVolumeUl(step.batchVolumeUl!)}
            {step.concentrationN !== undefined && <>（{formatConcentration(step.concentrationN)}）</>}
          </>
        )}
        {step.action === "dispense_dose" && (
          <>
            每孔 {formatTransferUl(step.dispensePerWellUl!, result.config.pipetteMinVolumeUl)} ×{" "}
            {step.usedByWells.length} 孔，共 {formatVolumeUl(step.totalVolumeUl)}
          </>
        )}
        {step.action === "top_up_diluent" && (
          <>
            {step.dispensePerWellUl !== undefined ? (
              <>每孔 {formatVolumeUl(step.dispensePerWellUl)} × {step.usedByWells.length} 孔</>
            ) : (
              <>按各孔差额补齐 {step.usedByWells.length} 孔</>
            )}
            ，共 {formatVolumeUl(step.totalVolumeUl)}
          </>
        )}
      </div>
      <div className="wells">
        服务孔位：
        {step.usedByWells.map((id) => (
          <b key={id} onClick={() => onSelectWell(id)}>
            {id}
          </b>
        ))}
      </div>
      {step.note && <div className="note">{step.note}</div>}
    </div>
  );
}

function actionLabel(a: PrepStep["action"]): string {
  return a === "prepare_intermediate" ? "配制中间液" : a === "dispense_dose" ? "分装加样" : "稀释液补齐";
}

type ReturnCase = ComputeResult["wells"][number] | null;
