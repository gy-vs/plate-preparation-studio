import type { ComputeResult, ConfirmedPlan, PlannerState, RawConfig } from "shared";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `请求失败 ${res.status}`) as Error & { data?: unknown };
    err.data = data;
    throw err;
  }
  return data as T;
}

export const api = {
  async getState(): Promise<{ state: PlannerState }> {
    const res = await fetch("/api/state");
    return res.json();
  },
  compute(config: RawConfig, assignments: Record<string, unknown> | undefined) {
    return postJson<{ result: ComputeResult; state: PlannerState }>("/api/compute", { config, assignments });
  },
  confirm(config: RawConfig, assignments: Record<string, unknown> | undefined) {
    return postJson<{ confirmed: ConfirmedPlan; state: PlannerState }>("/api/confirm", { config, assignments });
  },
  exportUrl(id: string, format: "txt" | "csv" | "json"): string {
    return `/api/export/${id}.${format}`;
  },
};
