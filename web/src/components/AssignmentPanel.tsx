import type { CalculateResponse } from '../../../shared/api';

export interface PendingUnits {
  /** 处理单元 key -> 还需放置的孔数（0 表示放满） */
  remaining: Record<string, number>;
  selectedKey: string | null;
}

export function unitLabel(response: CalculateResponse, key: string): string {
  if (key.startsWith('control:')) {
    const id = key.slice('control:'.length);
    const c = response.controls.find((x) => x.id === id);
    return c ? `对照「${c.name}」` : key;
  }
  const m = /^group:(.+):(\d+)$/.exec(key);
  if (!m) return key;
  const g = response.groups.find((x) => x.id === m[1]);
  if (!g) return key;
  const t = g.targets[Number(m[2])];
  const mode = t ? `（${t.mode === 'intermediate' ? '中间稀释' : '直接'}）` : '';
  return `${g.name} ${t?.concentration}${mode}`;
}

export function AssignmentPanel({
  response,
  pending,
  onSelectKey,
  onAutoAssign,
  onClearAssignment,
}: {
  response: CalculateResponse;
  pending: PendingUnits;
  onSelectKey: (key: string) => void;
  onAutoAssign: () => void;
  onClearAssignment: () => void;
}) {
  const entries = Object.entries(pending.remaining);
  const allPlaced = entries.every(([, n]) => n === 0);
  const totalLeft = entries.reduce((s, [, n]) => s + Math.max(0, n), 0);

  return (
    <div className="detail-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>手工排布</strong>
        <div>
          <button className="btn small" onClick={onAutoAssign}>恢复自动排布</button>{' '}
          <button className="btn small" onClick={onClearAssignment}>全部清空</button>
        </div>
      </div>
      <div className="sub" style={{ marginTop: 6 }}>
        先点选下方一个待放置的处理单元，再点板上的孔放入；点已占用的孔可将其腾空。
        {totalLeft > 0 ? ` 还需放置 ${totalLeft} 孔。` : ' 全部处理单元已放置。'}
      </div>
      <div className="targets" style={{ marginTop: 8 }}>
        {entries.map(([key, n]) => (
          <button
            key={key}
            className="tag"
            style={{
              cursor: 'pointer',
              outline: pending.selectedKey === key ? '2px solid var(--blue)' : 'none',
              opacity: n === 0 ? 0.55 : 1,
            }}
            onClick={() => onSelectKey(key)}
          >
            {unitLabel(response, key)} · 剩 {Math.max(0, n)}
          </button>
        ))}
      </div>
      {allPlaced && (
        <div className="banner ok" style={{ marginTop: 10 }}>
          排布完整：每个目标浓度与对照的孔数都与配置一致。
        </div>
      )}
    </div>
  );
}
