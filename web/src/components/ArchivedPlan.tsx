import { useEffect, useMemo, useState } from 'react';
import type { CalculateResponse, ConfirmedPlan } from '../../../shared/api';
import { api } from '../api';
import { PlateGrid } from './PlateGrid';
import { StepsView } from './StepsView';
import { WellDetail } from './WellDetail';
import { Summary } from './Summary';

/**
 * 已确认方案是只读快照：这里不提供任何编辑入口。
 * 指纹由服务端加载时重新计算校验，前端只展示。
 */
export function ArchivedPlan({
  plan,
  onBack,
}: {
  plan: ConfirmedPlan;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'well' | 'steps' | 'summary'>('well');
  const [highlightedStep, setHighlightedStep] = useState<number | null>(null);
  const response: CalculateResponse = plan.response;

  const problemGroups = useMemo(
    () => new Set<string>(),
    [],
  );

  useEffect(() => {
    setSelected(null);
  }, [plan.id]);

  return (
    <div>
      <div className="lock-box">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span className="locked-badge">✅ 已确认锁定</span>{' '}
            <strong>方案 {plan.id.slice(0, 8)}</strong>
            <div className="sub" style={{ margin: '6px 0 0' }}>确认于 {plan.createdAt}{plan.note ? ` · 备注：${plan.note}` : ''}</div>
          </div>
          <div>
            <a className="btn primary" href={api.exportUrl(plan.id)} target="_blank" rel="noreferrer">
              导出给同事（HTML）
            </a>{' '}
            <button className="btn" onClick={onBack}>返回草稿</button>
          </div>
        </div>
        <div className="mono" style={{ marginTop: 8 }}>内容指纹：{plan.contentHash}</div>
      </div>

      <PlateGrid
        response={response}
        selected={selected}
        onSelect={(w) => {
          setSelected(w);
          setTab('well');
        }}
        assignMode={false}
        pendingWells={new Set()}
        problemGroupIds={problemGroups}
      />

      <div className="tabs">
        <button className={tab === 'well' ? 'active' : ''} onClick={() => setTab('well')}>按孔位查看</button>
        <button className={tab === 'steps' ? 'active' : ''} onClick={() => setTab('steps')}>按配液步骤查看</button>
        <button className={tab === 'summary' ? 'active' : ''} onClick={() => setTab('summary')}>用量汇总与依据</button>
      </div>

      {tab === 'well' && (
        <>
          <WellDetail response={response} well={selected} onJump={(w) => { setSelected(w); setTab('steps'); }} />
          <StepsHint
            response={response}
            well={selected}
            onStep={(n) => {
              setHighlightedStep(n);
              setTab('steps');
            }}
          />
        </>
      )}
      {tab === 'steps' && (
        <StepsView
          response={response}
          highlightWell={selected}
          highlightedStep={highlightedStep}
          onStepShown={() => setHighlightedStep(null)}
          onWellClick={(w) => { setSelected(w); }}
        />
      )}
      {tab === 'summary' && (
        <>
          <Summary response={response} />
          <h2>本次计算依据</h2>
          <ul className="banner ok" style={{ display: 'block' }}>
            {response.basis.map((b, i) => <li key={i} style={{ margin: '3px 0' }}>{b}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}

function StepsHint({
  response,
  well,
  onStep,
}: {
  response: CalculateResponse;
  well: string | null;
  onStep: (order: number) => void;
}) {
  if (!well) return null;
  const related = response.steps.filter((s) => s.wells.includes(well));
  if (related.length === 0) return null;
  return (
    <div className="detail-card">
      该孔参与的配液步骤（点击跳转到步骤视图核对）：
      <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {related.map((s) => (
          <button key={s.order} className="btn small" onClick={() => onStep(s.order)}>
            第 {s.order} 步 · {s.title}
          </button>
        ))}
      </div>
    </div>
  );
}
