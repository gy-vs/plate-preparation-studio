import type { CalculateResponse } from '../../../shared/api';
import { formatUl, formatVolume } from '../format';

export function WellDetail({
  response,
  well,
  onJump,
}: {
  response: CalculateResponse;
  well: string | null;
  onJump: (well: string) => void;
}) {
  if (!well) {
    return (
      <div className="detail-card">
        <strong>选择一个孔位</strong>
        <div className="sub" style={{ margin: '6px 0 0' }}>
          点击板上任一孔，查看它属于哪个处理组、目标浓度、终体积与应加液体；空孔保持空孔。
        </div>
      </div>
    );
  }
  const w = response.wells.find((x) => x.well === well)!;

  if (w.type === 'empty') {
    return (
      <div className="detail-card">
        <h2 style={{ marginTop: 0 }}>{well} · 空孔</h2>
        <div className="sub">该孔不接受任何处理定义，加液时跳过。</div>
      </div>
    );
  }

  return (
    <div className="detail-card">
      <h2 style={{ marginTop: 0 }}>
        {well} · {w.type === 'group' ? w.groupName : w.controlName}
        {w.type === 'group' && (
          <span
            className={`pill ${
              response.groups.find((g) => g.id === w.groupId)?.targets.find((t) => t.index === w.targetIndex)?.mode
            }`}
            style={{ marginLeft: 8 }}
          >
            {response.groups
              .find((g) => g.id === w.groupId)
              ?.targets.find((t) => t.index === w.targetIndex)?.mode === 'intermediate'
              ? '经中间稀释'
              : '母液直接稀释'}
          </span>
        )}
      </h2>
      <dl className="kv">
        {w.type === 'group' && (
          <>
            <dt>目标浓度</dt>
            <dd>{w.targetConcentration} {w.concentrationUnit}</dd>
            <dt>重复孔序号</dt>
            <dd>第 {(w.replicateIndex ?? 0) + 1} 复孔</dd>
          </>
        )}
        {w.type === 'control' && (
          <>
            <dt>类型</dt>
            <dd>对照孔（仅加 {response.config.diluentName}）</dd>
          </>
        )}
        <dt>每孔终体积</dt>
        <dd>{formatVolume(w.finalVolumeUl)}</dd>
      </dl>
      <h2>应加液体</h2>
      {w.additions.map((a) => (
        <div className="addition" key={a.label}>
          <span>{a.kind === 'diluent' ? '🟢' : a.kind === 'intermediate' ? '🟣' : '🔵'} {a.label}</span>
          <strong>{formatUl(a.volumeUl)} µL</strong>
        </div>
      ))}
      <div className="sub" style={{ marginTop: 8 }}>
        合计 {formatUl(w.additions.reduce((s, a) => s + a.volumeUl, 0))} µL = 终体积 {formatUl(w.finalVolumeUl)} µL
        {w.type === 'group' && <RelatedSteps response={response} well={well} onJump={onJump} />}
      </div>
    </div>
  );
}

function RelatedSteps({
  response,
  well,
  onJump,
}: {
  response: CalculateResponse;
  well: string;
  onJump: (well: string) => void;
}) {
  const related = response.steps.filter((s) => s.wells.includes(well));
  if (related.length === 0) return null;
  return (
    <div style={{ marginTop: 6 }}>
      参与的配液步骤：
      {related.map((s) => (
        <button key={s.order} className="miniwell" onClick={() => onJump(well)} style={{ marginLeft: 6 }}>
          第 {s.order} 步
        </button>
      ))}
    </div>
  );
}
