import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PlannerState } from "shared";

const STATE_VERSION = 1;

export interface PersistedState {
  version: number;
  state: PlannerState;
  savedAt: string;
}

export function loadState(file: string): PlannerState {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as PersistedState;
    if (raw.version !== STATE_VERSION) return {};
    return raw.state ?? {};
  } catch {
    return {};
  }
}

export function saveState(file: string, state: PlannerState): void {
  mkdirSync(dirname(file), { recursive: true });
  const payload: PersistedState = { version: STATE_VERSION, state, savedAt: new Date().toISOString() };
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
}
