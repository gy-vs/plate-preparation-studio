export function formatUl(volume: number): string {
  const rounded = Math.round((volume + 1e-9) * 100) / 100;
  let s = rounded.toFixed(2);
  s = s.replace(/\.?0+$/, '');
  return s || '0';
}

/** 同时给出 µL 与 mL 表示，单位始终显式标注。 */
export function formatVolume(ul: number): string {
  if (ul >= 1000 && Math.abs(ul % 1000) < 1e-9) return `${ul / 1000} mL`;
  return `${formatUl(ul)} µL`;
}
