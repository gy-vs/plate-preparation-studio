import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { calculatePlan } from '../src/core/engine';
import { hashContent } from '../src/core/hash';
import { ImmutableError, IntegrityError, PlanStore } from '../src/core/store';
import type { ConfirmedPlan } from '../../shared/api';

function tempStore(): PlanStore {
  const dir = mkdtempSync(join(tmpdir(), 'plans-'));
  return new PlanStore(dir);
}

function confirmedResponse() {
  return calculatePlan({
    config: {
      diluentName: '培养基',
      pipette: { minVolume: 1, maxVolume: 1000 },
      overageFixed: 1,
      groups: [
        {
          name: '药物A', stockConcentration: 1000, stockUnit: 'uM',
          stockAvailable: 500, stockVolumeUnit: 'uL',
          targets: [200, 2], replicates: 3,
          finalVolume: 100, finalVolumeUnit: 'uL',
        },
      ],
      controls: [{ name: '空白', count: 2, finalVolume: 100, finalVolumeUnit: 'uL' }],
    },
    assignment: null,
  });
}

describe('方案修订：确认后的快照不被后续输入改写', () => {
  it('确认保存后，再用改动过的草稿计算，已确认方案原样可取', () => {
    const store = tempStore();
    const v1 = confirmedResponse();
    const plan: ConfirmedPlan = {
      id: 'plan-001',
      createdAt: new Date().toISOString(),
      response: v1,
      contentHash: hashContent(v1),
    };
    store.add(plan);

    // 之后用户继续改草稿（重复数 3→6、删掉一个目标），这是允许的，但只影响新计算
    const v2 = calculatePlan({
      config: {
        ...v1.config,
        groups: [{ ...v1.config.groups[0]!, replicates: 6, targets: [200] }],
      },
      assignment: null,
    });
    expect(v2.totals.usedWells).toBe(6 + 2);

    const fetched = store.get('plan-001')!;
    expect(fetched.response.totals.usedWells).toBe(v1.totals.usedWells);
    expect(fetched.response.assignment).toEqual(v1.assignment);
    expect(fetched.contentHash).toBe(plan.contentHash);
  });

  it('同一 id 二次写入被拒绝（已确认方案锁死）', () => {
    const store = tempStore();
    const v1 = confirmedResponse();
    const plan: ConfirmedPlan = {
      id: 'plan-002',
      createdAt: new Date().toISOString(),
      response: v1,
      contentHash: hashContent(v1),
    };
    store.add(plan);
    expect(() => store.add({ ...plan, note: '试图覆盖' })).toThrow(ImmutableError);
  });

  it('存档内容被外部改动后，重新加载隔离该方案：列表/取回都不出现被改写的内容', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plans-tamper-'));
    const store1 = new PlanStore(dir);
    const v1 = confirmedResponse();
    store1.add({
      id: 'plan-003',
      createdAt: new Date().toISOString(),
      response: v1,
      contentHash: hashContent(v1),
    });

    // 模拟“确认后被悄悄改写”：解析存档后把终体积改大再写回
    const { readFileSync, writeFileSync } = require('node:fs') as typeof import('node:fs');
    const file = join(dir, 'plans.json');
    const data = JSON.parse(readFileSync(file, 'utf8')) as { plans: ConfirmedPlan[] };
    for (const w of data.plans[0]!.response.wells) {
      if (w.finalVolumeUl > 0) w.finalVolumeUl = 120;
    }
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');

    const store2 = new PlanStore(dir);
    expect(store2.get('plan-003')).toBeUndefined();
    expect(store2.list().some((p) => p.id === 'plan-003')).toBe(false);
    expect(store2.corruptionReason('plan-003')).toContain('已隔离');
    // 未被篡改的其他方案仍正常可取
  });

  it('写入时内容与 hash 不符直接拒绝（防止伪造一份“已确认方案”）', () => {
    const store = tempStore();
    const v1 = confirmedResponse();
    expect(() =>
      store.add({
        id: 'plan-forged',
        createdAt: new Date().toISOString(),
        response: v1,
        contentHash: '0'.repeat(64),
      }),
    ).toThrow(IntegrityError);
  });
});

afterEach(() => {
  // 临时目录由系统清理；这里仅保证测试间状态隔离（每个用例自建目录）
});
