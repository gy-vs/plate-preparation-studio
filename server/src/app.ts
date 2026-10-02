import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import type {
  CalculateRequest,
  CalculateResponse,
  ConfirmedPlan,
  ConfirmPlanRequest,
} from '../../shared/api.js';
import { calculatePlan } from './core/engine.js';
import { hashContent } from './core/hash.js';
import { ImmutableError, PlanStore } from './core/store.js';
import { exportHtml } from './export/html.js';

export function createApp(store: PlanStore) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  // 统一计算入口：板位和清单都来自这个响应。
  app.post('/api/calculate', (req, res) => {
    const body = req.body as CalculateRequest;
    if (!body || typeof body !== 'object' || !body.config) {
      res.status(400).json({ error: '请求需要 { config, assignment? }' });
      return;
    }
    const response = calculatePlan({ config: body.config, assignment: body.assignment ?? null });
    res.json(response);
  });

  // 确认当前方案：服务端用同一引擎重算并比对，前端无法把不可执行方案标成可执行。
  app.post('/api/plans', (req, res) => {
    const body = req.body as ConfirmPlanRequest;
    if (!body?.response?.config) {
      res.status(400).json({ error: '请求需要 { response, note? }' });
      return;
    }
    // 前端回传的自动排布是展开后的对象，与 null（让服务端自动排布）语义等价：
    // 两种重算方式任一与提交内容一致即可，避免把“自动”误判成“手工”。
    const submittedHash = hashContent(withoutStamp(body.response as CalculateResponse));
    const recomputedAuto = calculatePlan({ config: body.response.config, assignment: null });
    const recomputedGiven = calculatePlan({
      config: body.response.config,
      assignment: body.response.assignment ?? null,
    });
    const matches =
      hashContent(withoutStamp(recomputedAuto)) === submittedHash ||
      hashContent(withoutStamp(recomputedGiven)) === submittedHash;
    if (!matches) {
      res.status(409).json({ error: '提交内容与服务端计算结果不一致，请刷新后以最新计算结果确认' });
      return;
    }
    const recomputed =
      hashContent(withoutStamp(recomputedAuto)) === submittedHash ? recomputedAuto : recomputedGiven;
    if (!recomputed.feasible) {
      res.status(422).json({ error: '方案存在阻断性错误，不能确认', issues: recomputed.issues });
      return;
    }
    const plan: ConfirmedPlan = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      note: typeof body.note === 'string' ? body.note.slice(0, 500) : undefined,
      response: recomputed,
      contentHash: hashContent(recomputed),
    };
    try {
      store.add(plan);
    } catch (e) {
      if (e instanceof ImmutableError) {
        res.status(e.status).json({ error: e.message });
        return;
      }
      throw e;
    }
    res.json(plan);
  });

  app.get('/api/plans', (_req, res) => {
    res.json(
      store.list().map((p) => ({
        id: p.id,
        createdAt: p.createdAt,
        note: p.note,
        contentHash: p.contentHash,
        totals: p.response.totals,
        groups: p.response.groups.map((g) => ({ id: g.id, name: g.name })),
      })),
    );
  });

  app.get('/api/plans/:id', (req, res) => {
    const corruptedReason = store.corruptionReason(req.params.id!);
    if (corruptedReason) {
      res.status(409).json({ error: corruptedReason });
      return;
    }
    const plan = store.get(req.params.id!);
    if (!plan) {
      res.status(404).json({ error: '未找到该确认方案' });
      return;
    }
    res.json(plan);
  });

  // 导出已确认方案为单文件 HTML（自带计算依据、孔位身份与加液步骤）。
  app.get('/api/plans/:id/export.html', (req, res) => {
    if (store.corruptionReason(req.params.id!)) {
      res.status(409).send('该方案内容完整性校验失败，已隔离，不能导出');
      return;
    }
    const plan = store.get(req.params.id!);
    if (!plan) {
      res.status(404).send('未找到该确认方案');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="plate-plan-${plan.id}.html"`);
    res.send(exportHtml(plan));
  });

  return app;
}

function withoutStamp(r: CalculateResponse): Omit<CalculateResponse, 'calculatedAt'> {
  const { calculatedAt: _omit, ...rest } = r;
  return rest;
}
