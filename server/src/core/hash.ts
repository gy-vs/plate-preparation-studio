import { createHash } from 'node:crypto';

/** 稳定序列化（键排序），保证同一计算结果 hash 相同。 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(stableClone(value));
}

export function hashContent(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function stableClone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableClone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, stableClone((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}
