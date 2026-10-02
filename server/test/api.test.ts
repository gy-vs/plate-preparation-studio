import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CalculateResponse, DraftConfig } from '../../shared/api';
import { createApp } from '../src/app.js';
import { PlanStore } from '../src/core/store.js';
import express from 'express';

const config: DraftConfig = {
  diluentName: '培养基',
  pipette: { minVolume: 1, maxVolume: 1000 },
  overageFixed: 2,
  groups: [
    {
      name: '药物A', stockConcentration: 1000, stockUnit: 'uM',
      stockAvailable: 500, stockVolumeUnit: 'uL',
      targets: [200, 2], replicates: 3,
      finalVolume: 100, finalVolumeUnit: 'uL',
    },
  ],
  controls: [{ name: '空白', count: 2, finalVolume: 100, finalVolumeUnit: 'uL' }],
};

const infeasibleConfig: DraftConfig = {
  ...config,
  groups: [
    { ...config.groups[0]!, name: '药物A', stockAvailable: 1, targets: [900] },
  ],
};

describe('HTTP API：计算、确认与完整性', () => {
  let base: string;
  let dataDir: string;
  let server: ReturnType<express.Express['listen']>;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'api-plans-'));
    const store = new PlanStore(dataDir);
    const app = createApp(store);
    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => server.close());

  it('板位与步骤来自同一计算结果（前端只消费这一个接口）', async () => {
    const res = await fetch(`${base}/api/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, assignment: null }),
    });
    const r = (await res.json()) as CalculateResponse;
    expect(r.feasible).toBe(true);
    expect(r.wells).toHaveLength(96);
    // 中间液步骤列出的孔，正是板上加 intermediate 的孔
    const stepWells = r.steps
      .filter((s) => s.kind === 'dispense_intermediate')
      .flatMap((s) => s.wells)
      .sort();
    const plateWells = r.wells
      .filter((w) => w.additions.some((a) => a.kind === 'intermediate'))
      .map((w) => w.well)
      .sort();
    expect(stepWells).toEqual(plateWells);
  });

  it('服务端实算不可执行的方案，确认返回 422 而不是给出可执行总览', async () => {
    const calcRes = await fetch(`${base}/api/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: infeasibleConfig, assignment: null }),
    });
    const bad = (await calcRes.json()) as CalculateResponse;
    expect(bad.feasible).toBe(false);

    const res = await fetch(`${base}/api/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: bad }),
    });
    expect(res.status).toBe(422);
  });

  it('确认成功后可列表/取回/导出，且导出包含计算依据与孔位身份', async () => {
    const calcRes = await fetch(`${base}/api/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, assignment: null }),
    });
    const good = (await calcRes.json()) as CalculateResponse;
    const res = await fetch(`${base}/api/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: good, note: '集成测试' }),
    });
    expect(res.ok).toBe(true);
    const plan = await res.json();

    const list = await (await fetch(`${base}/api/plans`)).json();
    expect(list).toHaveLength(1);

    const html = await (await fetch(`${base}/api/plans/${plan.id}/export.html`)).text();
    expect(html).toContain('已确认锁定');
    expect(html).toContain('计算依据');
    expect(html).toContain('A1');
    expect(html).toContain(plan.id);
  });

  it('确认后继续改草稿不会改写已确认方案', async () => {
    const listBefore = await (await fetch(`${base}/api/plans`)).json();
    const id = listBefore[0].id as string;
    const before = await (await fetch(`${base}/api/plans/${id}`)).json();

    await fetch(`${base}/api/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: { ...config, groups: [{ ...config.groups[0]!, replicates: 6 }] },
        assignment: null,
      }),
    });

    const after = await (await fetch(`${base}/api/plans/${id}`)).json();
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.response.totals.usedWells).toBe(before.response.totals.usedWells);
  });

  it('存档被外部改写后，该方案被隔离：取回 409 且从列表消失', async () => {
    const list = await (await fetch(`${base}/api/plans`)).json();
    const id = list[0].id as string;
    const file = join(dataDir, 'plans.json');
    const data = JSON.parse(readFileSync(file, 'utf8')) as { plans: Array<Record<string, unknown>> };
    (data.plans[0]!.response as CalculateResponse).wells
      .filter((w) => w.finalVolumeUl > 0)
      .forEach((w) => (w.finalVolumeUl = 999));
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');

    // 新进程视角（模拟重新打开页面/重启服务）
    const app2 = createApp(new PlanStore(dataDir));
    const server2 = app2.listen(0);
    await new Promise<void>((resolve) => server2.once('listening', resolve));
    const port2 = (server2.address() as AddressInfo).port;
    const resGet = await fetch(`http://localhost:${port2}/api/plans/${id}`);
    expect(resGet.status).toBe(409);
    const list2 = await (await fetch(`http://localhost:${port2}/api/plans`)).json();
    expect(list2).toHaveLength(0);
    server2.close();
  });
});
