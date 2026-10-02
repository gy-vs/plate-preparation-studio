import type { VolumeUnit } from '../../../shared/api.js';

/** 服务端内部统一用 µL 做体积运算 —— 微升和毫升绝不当同一个数。 */
export function toUl(value: number, unit: VolumeUnit): number {
  return unit === 'mL' ? value * 1000 : value;
}

export const EPS = 1e-9;

/** 判定“实际可达到”的约束比较：允许浮点误差。 */
export function belowMin(volume: number, min: number): boolean {
  return volume < min - EPS;
}

export function aboveMax(volume: number, max: number): boolean {
  return volume > max + EPS;
}

/** 分装准备量：净需要量 + 固定损耗，向上取整到 0.1 µL（宁多勿少）。 */
export function prepRoundUp(netUl: number): number {
  return Math.ceil((netUl + EPS) * 10) / 10;
}

/** 显示用：µL 数值格式化为字符串（最多两位小数）。 */
export function formatUl(volume: number): string {
  const rounded = Math.round((volume + EPS) * 100) / 100;
  return rounded.toFixed(2).replace(/\.?0+$/, '') || '0';
}
