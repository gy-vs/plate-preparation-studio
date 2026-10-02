import type {
  CalculateRequest,
  CalculateResponse,
  ConfirmedPlan,
  ConfirmPlanRequest,
  DraftConfig,
} from '../../shared/api';

const BASE = '/api';

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `请求失败：${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  calculate: (req: CalculateRequest) =>
    jsonFetch<CalculateResponse>(`${BASE}/calculate`, {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  confirm: (payload: ConfirmPlanRequest) =>
    jsonFetch<ConfirmedPlan>(`${BASE}/plans`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listPlans: () =>
    jsonFetch<
      Array<{
        id: string;
        createdAt: string;
        note?: string;
        contentHash: string;
        totals: { usedWells: number };
        groups: Array<{ id: string; name: string }>;
      }>
    >(`${BASE}/plans`),

  getPlan: (id: string) => jsonFetch<ConfirmedPlan>(`${BASE}/plans/${id}`),

  exportUrl: (id: string) => `${BASE}/plans/${id}/export.html`,
};

const DRAFT_KEY = 'plate-planner:draft:v1';

export function loadDraft(): DraftConfig | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as DraftConfig) : null;
  } catch {
    return null;
  }
}

export function saveDraft(config: DraftConfig): void {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(config));
}
