// 前后端共享的唯一事实定义：板的几何尺寸与孔位编址。
// 所有孔位 ID 形如 "A1".."H12"，行用字母 A-H，列用数字 1-12。

export const PLATE_ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export const PLATE_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const PLATE_SIZE = PLATE_ROWS.length * PLATE_COLS.length; // 96

export type RowLabel = (typeof PLATE_ROWS)[number];

export function wellId(row: RowLabel, col: number): string {
  return `${row}${col}`;
}

/** 全部 96 个孔位，按“先列后行”（加样排布惯例）排列。 */
export const ALL_WELLS: readonly string[] = PLATE_COLS.flatMap((col) =>
  PLATE_ROWS.map((row) => wellId(row, col)),
);

export function isWellId(value: string): boolean {
  return /^[A-H]([1-9]|1[0-2])$/.test(value);
}
