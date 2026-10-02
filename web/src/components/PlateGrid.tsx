import { PLATE_COLS, PLATE_ROWS } from '../../../shared/plate';
import type { CalculateResponse, WellInfo } from '../../../shared/api';

interface Props {
  response: CalculateResponse;
  selected: string | null;
  onSelect: (well: string) => void;
  /** 排布模式下可点击分配 */
  assignMode: boolean;
  pendingWells: Set<string>; // 当前待放置处理单元会高亮的孔
  problemGroupIds: Set<string>;
}

export function PlateGrid({ response, selected, onSelect, assignMode, pendingWells, problemGroupIds }: Props) {
  const wellMap = new Map(response.wells.map((w) => [w.well, w]));

  return (
    <div className="plate-wrap">
      <table className="plate">
        <thead>
          <tr>
            <th />
            {PLATE_COLS.map((c) => <th key={c}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {PLATE_ROWS.map((row) => (
            <tr key={row}>
              <th>{row}</th>
              {PLATE_COLS.map((col) => {
                const id = `${row}${col}`;
                const w = wellMap.get(id)!;
                const classes = [cellClass(w, problemGroupIds)];
                if (selected === id) classes.push('selected');
                if (assignMode) classes.push('assignable');
                if (pendingWells.has(id)) classes.push('pending');
                return (
                  <td
                    key={id}
                    className={classes.join(' ')}
                    onClick={() => onSelect(id)}
                    title={titleFor(w)}
                  >
                    <span className="wid">{id}</span>
                    <CellBody w={w} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="legend" style={{ marginTop: 10 }}>
        <span><i style={{ background: 'var(--blue-bg)' }} />处理组</span>
        <span><i style={{ background: 'var(--amber-bg)' }} />对照</span>
        <span><i style={{ background: '#fff', border: '1px solid #cbd5e1' }} />空孔</span>
        <span><i style={{ background: '#fff', border: '2px solid var(--red)' }} />该组存在阻断问题</span>
      </div>
    </div>
  );
}

function cellClass(w: WellInfo, problemGroupIds: Set<string>): string {
  if (w.type === 'empty') return 'empty';
  if (w.type === 'control') return 'control';
  return `group ${w.groupId && problemGroupIds.has(w.groupId) ? 'problem' : ''}`;
}

function CellBody({ w }: { w: WellInfo }) {
  if (w.type === 'empty') return null;
  if (w.type === 'control') {
    return (
      <div className="cell-body">
        <div className="n c">{w.controlName}</div>
        <div>#{(w.replicateIndex ?? 0) + 1}</div>
      </div>
    );
  }
  return (
    <div className="cell-body">
      <div className="n">{w.groupName}</div>
      <div className="t">{w.targetConcentration} {w.concentrationUnit}</div>
      <div>#{(w.replicateIndex ?? 0) + 1}</div>
    </div>
  );
}

function titleFor(w: WellInfo): string {
  if (w.type === 'empty') return `${w.well}：空孔`;
  if (w.type === 'control') return `${w.well}：${w.controlName}，仅加稀释液 ${w.finalVolumeUl} µL`;
  const adds = w.additions.map((a) => `${a.label} ${a.volumeUl.toFixed(2)} µL`).join('；');
  return `${w.well}：${w.groupName} ${w.targetConcentration} ${w.concentrationUnit}（复孔 ${(w.replicateIndex ?? 0) + 1}）；${adds}`;
}
