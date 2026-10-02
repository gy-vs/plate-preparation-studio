import { PLATE_COLS, PLATE_ROWS, type ComputeResult, type WellPlan } from "shared";
import { groupColor } from "./ConfigForm.js";

export interface PaintOption {
  label: string;
  groupId?: string;
  targetIndex?: number;
  kind: "treatment" | "control" | "empty";
  color?: string;
}

interface Props {
  result: ComputeResult;
  selectedWell: string | null;
  onSelectWell: (wellId: string | null) => void;
  paintOption: PaintOption | null;
  onPaint: (wellId: string) => void;
  /** 服务器拒绝旧安排时，当前板上标记的孔来自旧版本 */
  stale: boolean;
  groupIndex: Map<string, number>;
}

export function PlateView({ result, selectedWell, onSelectWell, paintOption, onPaint, stale, groupIndex }: Props) {
  const wellMap = new Map(result.wells.map((w) => [w.wellId, w]));

  const handleClick = (wellId: string) => {
    if (paintOption) onPaint(wellId);
    else onSelectWell(wellId === selectedWell ? null : wellId);
  };

  return (
    <div className="plate-wrap">
      <table className="plate">
        <thead>
          <tr>
            <th />
            {PLATE_COLS.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PLATE_ROWS.map((row) => (
            <tr key={row}>
              <th>{row}</th>
              {PLATE_COLS.map((col) => {
                const id = `${row}${col}`;
                const well = wellMap.get(id);
                if (!well) return <td key={id}><div className="well empty" /></td>;
                const style = wellStyle(well, groupIndex);
                const cls = [
                  "well",
                  well.kind,
                  selectedWell === id ? "selected" : "",
                  stale && well.kind !== "empty" ? "stale" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <td key={id}>
                    <div className={cls} style={style} title={titleFor(well)} onClick={() => handleClick(id)}>
                      {well.kind === "empty" ? "" : labelFor(well)}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function wellStyle(w: WellPlan, groupIndex: Map<string, number>): React.CSSProperties | undefined {
  if (w.kind === "treatment" && w.groupId) {
    const base = groupColor(groupIndex.get(w.groupId) ?? 0);
    return { background: base };
  }
  return undefined;
}

function labelFor(w: WellPlan): string {
  if (w.kind === "control") return "CK";
  if (w.kind === "treatment") return `${(w.targetIndex ?? 0) + 1}·${w.replicateIndex ?? ""}`;
  return "";
}

function titleFor(w: WellPlan): string {
  if (w.kind === "empty") return `${w.wellId}：空孔`;
  if (w.kind === "control") return `${w.wellId}：对照（仅稀释液）`;
  return `${w.wellId}：${w.groupName} 第${(w.targetIndex ?? 0) + 1}浓度点 重复${w.replicateIndex}`;
}
