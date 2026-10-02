import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ConfirmedPlan } from '../../../shared/api.js';
import { hashContent } from './hash.js';

/**
 * 文件存储的已确认方案仓库。
 * 关键不变量：
 *  - 同一 id 只能写入一次（重复确认抛 ImmutableError，已确认快照永不被覆盖）；
 *  - 写入采用临时文件 + rename 原子落盘；
 *  - 加载时逐个重新计算 hash 并比对；内容被篡改/改写的方案进入隔离名单，
 *    绝不静默展示“被改写的方案”，也不会让单个坏文件拖垮整个服务。
 */
export class ImmutableError extends Error {
  status = 409;
}

export class IntegrityError extends Error {
  status = 409;
}

interface StoreFile {
  plans: ConfirmedPlan[];
}

export class PlanStore {
  private readonly file: string;
  private plans: ConfirmedPlan[] = [];
  /** 被篡改方案 id -> 原因；这些 id 不会被列出或取回。 */
  private corrupted = new Map<string, string>();

  constructor(dataDir: string) {
    this.file = join(dataDir, 'plans.json');
    if (existsSync(this.file)) {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as StoreFile;
      for (const p of parsed.plans ?? []) {
        if (hashContent(p.response) !== p.contentHash) {
          this.corrupted.set(
            p.id,
            `方案 ${p.id} 内容 hash 与存档不符：该方案可能已被改写，已隔离`,
          );
        } else {
          this.plans.push(p);
        }
      }
    } else {
      mkdirSync(dirname(this.file), { recursive: true });
      this.persist();
    }
  }

  /** 测试/运维用：查看隔离原因。 */
  corruptionReason(id: string): string | undefined {
    return this.corrupted.get(id);
  }

  list(): ConfirmedPlan[] {
    return [...this.plans].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  get(id: string): ConfirmedPlan | undefined {
    if (this.corrupted.has(id)) return undefined;
    const plan = this.plans.find((p) => p.id === id);
    if (plan && hashContent(plan.response) !== plan.contentHash) {
      // 进程存活期间底层内容若被改动：隔离，不返回口径不一致的快照。
      this.corrupted.set(id, `方案 ${id} 内容 hash 异常，已隔离`);
      return undefined;
    }
    return plan;
  }

  add(plan: ConfirmedPlan): ConfirmedPlan {
    if (this.plans.some((p) => p.id === plan.id)) {
      throw new ImmutableError(`方案 ${plan.id} 已确认并锁定，不能被后续修改覆盖`);
    }
    if (hashContent(plan.response) !== plan.contentHash) {
      throw new IntegrityError(`方案 ${plan.id} 内容 hash 与提交内容不符，拒绝写入`);
    }
    this.plans.push(plan);
    this.persist();
    return plan;
  }

  private persist(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ plans: this.plans }, null, 2), 'utf8');
    renameSync(tmp, this.file);
  }
}
