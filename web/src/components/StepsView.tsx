import { useEffect, useRef } from 'react';
import type { CalculateResponse, PrepStep } from '../../../shared/api';
import { formatUl } from '../format';

const KIND_LABEL: Record<PrepStep['kind'], string> = {
  prepare_intermediate: '配制中间液',
  dispense_stock: '母液直接分装',
  dispense_intermediate: '中间液分装',
  dispense_diluent: '稀释液分装',
};

export function StepsView({
  response,
  highlightWell,
  highlightedStep,
  onStepShown,
  onWellClick,
}: {
  response: CalculateResponse;
  highlightWell: string | null;
  highlightedStep: number | null;
  onStepShown: () => void;
  onWellClick: (well: string) => void;
}) {
  if (response.steps.length === 0) {
    return <div className="detail-card">当前方案不可执行，暂无可执行步骤；请先消除上方错误。</div>;
  }
  return (
    <ol className="steps">
      {response.steps.map((s) => (
        <StepItem
          key={s.order}
          step={s}
          highlightWell={highlightWell}
          highlighted={highlightedStep === s.order}
          onShown={onStepShown}
          onWellClick={onWellClick}
        />
      ))}
    </ol>
  );
}

function StepItem({
  step,
  highlightWell,
  highlighted,
  onShown,
  onWellClick,
}: {
  step: PrepStep;
  highlightWell: string | null;
  highlighted: boolean;
  onShown: () => void;
  onWellClick: (well: string) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (highlighted) {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      onShown();
    }
  }, [highlighted, onShown]);

  return (
    <li ref={ref} className={`kind-${step.kind}`} style={highlighted ? { boxShadow: '0 0 0 2px var(--blue)' } : undefined}>
      <div className="step-title">
        <span className="step-order">{step.order}</span>
        {KIND_LABEL[step.kind]}：{step.title.replace(/^[^：]*：?/, '')}
      </div>
      <div className="step-detail">{step.detail}</div>
      {step.recipe && (
        <div className="recipe">
          <strong>中间稀释配方（体积守恒）：</strong>
          母液 {formatUl(step.recipe.stockUl)} µL + 稀释液 {formatUl(step.recipe.diluentUl)} µL =
          批量 {formatUl(step.recipe.batchUl)} µL（{step.recipe.intermediateConcentration}{' '}
          {step.recipe.concentrationUnit}，{step.recipe.dilutionFactor} 倍稀释）
        </div>
      )}
      <div className="step-wells">
        {step.wells.map((w) => (
          <button
            key={w}
            className="miniwell"
            style={w === highlightWell ? { background: 'var(--blue)', color: '#fff' } : undefined}
            onClick={() => onWellClick(w)}
          >
            {w}
          </button>
        ))}
      </div>
    </li>
  );
}
