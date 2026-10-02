import { type ComputeResult, type PlannerState, type RawConfig } from "shared";
import { freezeConfirmation } from "./compute.js";

export type StoreAction =
  | { type: "save_draft"; raw: RawConfig; result: ComputeResult }
  | { type: "confirm"; raw: RawConfig; result: ComputeResult; at: Date };

/**
 * 纯函数状态变更，便于测试“方案修订”语义：
 * 草稿可以反复改；一旦确认，confirmed 是冻结快照，之后任何 save_draft 都不能改写它。
 */
export function reduce(state: PlannerState, action: StoreAction): PlannerState {
  switch (action.type) {
    case "save_draft":
      // 即使草稿 hash 与确认版相同，也只动 draft* 字段
      return { ...state, draftRaw: action.raw, draftResult: action.result };
    case "confirm": {
      const confirmed = freezeConfirmation(action.raw, action.result, action.at);
      return { ...state, draftRaw: action.raw, draftResult: action.result, confirmed };
    }
  }
}
