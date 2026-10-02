// 前后端共用的展示格式化：内部规范单位（nM / µL）转人类可读字符串。
// 计算从不使用这些函数，它们只负责显示，避免 µL 与 mL 被当成同一个数。

const nM: Record<string, number> = {
  pM: 1e-3,
  nM: 1,
  "µM": 1e3,
  mM: 1e6,
  M: 1e9,
};

export function formatConcentration(valueN: number, digits = 4): string {
  const units: [string, number][] = ["pM", "nM", "µM", "mM", "M"].map((u) => [u, nM[u]!]);
  let chosen = units[1]!;
  for (const u of units) {
    if (valueN >= u[1]) chosen = u;
  }
  return `${trimNum(valueN / chosen[1], digits)} ${chosen[0]}`;
}

export function formatVolumeUl(ul: number, digits = 3): string {
  if (ul >= 1000) return `${trimNum(ul / 1000, digits)} mL`;
  return `${trimNum(ul, digits)} µL`;
}

/** 很小但非零的体积必须显式展示，禁止四舍五入成 0。 */
export function formatTransferUl(ul: number, pipetteMinUl?: number): string {
  if (ul === 0) return "0 µL";
  const rounded = trimNum(ul, 3);
  const shown = Number(rounded) === 0 ? ul.toPrecision(2) : rounded;
  const below = pipetteMinUl !== undefined && ul + 1e-9 < pipetteMinUl;
  return `${shown} µL${below ? "（低于移液器最小体积）" : ""}`;
}

export function trimNum(v: number, digits: number): string {
  if (!Number.isFinite(v)) return String(v);
  const factor = 10 ** digits;
  const rounded = Math.round(v * factor) / factor;
  // 去尾零，但保留单位明确
  return String(rounded);
}

export function wellLabel(rowIndex: number, colIndex: number): string {
  return `${String.fromCharCode(65 + rowIndex)}${colIndex + 1}`;
}

export const PLATE_ROWS = ["A", "B", "C", "D", "E", "F", "G", "H"];
export const PLATE_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
