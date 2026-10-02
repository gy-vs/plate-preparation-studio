import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  Assignment,
  CalculateResponse,
  ConfirmedPlan,
  DraftConfig,
} from '../../shared/api';
import { ALL_WELLS } from '../../shared/plate';
import { api, loadDraft, saveDraft } from './api';
import { defaultDraft } from './defaults';
import { ConfigPanel } from './components/ConfigPanel';
import { PlateGrid } from './components/PlateGrid';
import { WellDetail } from './components/WellDetail';
import { StepsView } from './components/StepsView';
import { Summary } from './components/Summary';
import { AssignmentPanel, type PendingUnits } from './components/AssignmentPanel';
import { ArchivedPlan } from './components/ArchivedPlan';

type Tab = 'well' | 'steps' | 'summary';
type ArchiveSummary = Awaited<ReturnType<typeof api.listPlans>>[number];

/** 只反映“孔位数量结构”的签名：重复数、目标个数、对照孔数变化时，旧排布不能继续被使用。 */
function structureSignature(c: DraftConfig): string {
  return JSON.stringify({
    g: c.groups.map((g) => ({ n: g.targets.length, r: g.replicates })),
    c: c.controls.map((x) => x.count),
  });
}

function expectedUnits(c: DraftConfig): Array<{ key: string; need: number }> {
  const units: Array<{ key: string; need: number }> = [];
  c.groups.forEach((g, gi) => {
    g.targets.forEach((_t, ti) => {
      units.push({ key: `group:g${gi + 1}:${ti}`, need: g.replicates });
    });
  });
  c.controls.forEach((_, ci) => units.push({ key: `control:c${ci + 1}`, need: c.controls[ci]!.count }));
  return units;
}

const EMPTY_ASSIGNMENT: Assignment = Object.fromEntries(ALL_WELLS.map((w) => [w, null]));

export function App() {
  const [config, setConfig] = useState<DraftConfig>(() => loadDraft() ?? defaultDraft());
  const [manual, setManual] = useState(false);
  /** 手工模式下正在编辑的排布；自动模式下为 null（服务端按先列后行排布）。 */
  const [assignmentDraft, setAssignmentDraft] = useState<Assignment | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const [response, setResponse] = useState<CalculateResponse | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('well');
  const [highlightedStep, setHighlightedStep] = useState<number | null>(null);

  const [archives, setArchives] = useState<ArchiveSummary[]>([]);
  const [viewing, setViewing] = useState<ConfirmedPlan | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const sigRef = useRef(structureSignature(config));
  const reqSeq = useRef(0);

  // 唯一的数据获取：config 或排布一变，就用同一接口重算板位+清单。
  useEffect(() => {
    const seq = ++reqSeq.current;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .calculate({ config, assignment: manual ? assignmentDraft : null })
        .then((r) => {
          if (seq !== reqSeq.current) return;
          setResponse(r);
          setCalcError(null);
        })
        .catch((e: Error) => {
          if (seq === reqSeq.current) setCalcError(e.message);
        })
        .finally(() => {
          if (seq === reqSeq.current) setLoading(false);
        });
    }, 200);
    return () => clearTimeout(t);
  }, [config, manual, assignmentDraft]);

  const refreshArchives = () => api.listPlans().then(setArchives).catch(() => undefined);
  useEffect(() => {
    refreshArchives();
  }, []);

  const handleConfigChange = (next: DraftConfig) => {
    setConfig(next);
    saveDraft(next);
    if (structureSignature(next) !== sigRef.current) {
      // 重复数 / 目标序列长度 / 对照孔数改变：旧的选中孔与手工排布一律失效。
      sigRef.current = structureSignature(next);
      setManual(false);
      setAssignmentDraft(null);
      setPendingKey(null);
      setSelected(null);
    }
  };

  const enterManual = () => {
    if (!response) return;
    setAssignmentDraft({ ...response.assignment });
    setManual(true);
  };

  const restoreAuto = () => {
    setManual(false);
    setAssignmentDraft(null);
    setPendingKey(null);
  };

  const clearAll = () => setAssignmentDraft({ ...EMPTY_ASSIGNMENT });

  const pending: PendingUnits | null = useMemo(() => {
    if (!manual || !response) return null;
    const remaining: Record<string, number> = {};
    for (const { key, need } of expectedUnits(config)) remaining[key] = need;
    for (const w of ALL_WELLS) {
      const key = response.assignment[w];
      if (key && key in remaining) remaining[key]! -= 1;
    }
    const keys = Object.keys(remaining);
    const selectedKey =
      pendingKey && remaining[pendingKey] !== undefined
        ? pendingKey
        : keys.find((k) => (remaining[k] ?? 0) > 0) ?? keys[0] ?? null;
    return { remaining, selectedKey };
  }, [manual, response, config, pendingKey]);

  const pendingWells = useMemo(() => {
    const set = new Set<string>();
    if (!manual || !pending || !response || !pending.selectedKey) return set;
    for (const w of ALL_WELLS) {
      const key = response.assignment[w];
      if (key === pending.selectedKey || key == null) set.add(w);
    }
    return set;
  }, [manual, pending, response]);

  const problemGroupIds = useMemo(() => {
    if (!response) return new Set<string>();
    return new Set(
      response.issues.filter((i) => i.level === 'error' && i.groupId).map((i) => i.groupId!),
    );
  }, [response]);

  const onPlateClick = (well: string) => {
    setSelected(well);
    if (!manual || !response || !assignmentDraft) return;
    const current = assignmentDraft[well] ?? null;
    const next: Assignment = { ...assignmentDraft };
    if (current !== null) {
      next[well] = null; // 点已占用孔：腾空；一个孔只能有一份定义
    } else if (pending?.selectedKey && (pending.remaining[pending.selectedKey] ?? 0) > 0) {
      next[well] = pending.selectedKey;
    } else {
      return;
    }
    setAssignmentDraft(next);
  };

  const feasible = response?.feasible ?? false;
  const errors = response?.issues.filter((i) => i.level === 'error') ?? [];
  const warnings = response?.issues.filter((i) => i.level === 'warning') ?? [];

  const confirmPlan = async () => {
    if (!response) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      const plan = await api.confirm({ response, note: note.trim() || undefined });
      await refreshArchives();
      setViewing(plan);
      setNote('');
    } catch (e) {
      setConfirmError((e as Error).message);
    } finally {
      setConfirming(false);
    }
  };

  const openArchive = async (id: string) => setViewing(await api.getPlan(id));

  if (viewing) {
    return (
      <div className="app">
        <aside className="sidebar">
          <h1>已确认方案</h1>
          <div className="sub">只读快照：之后的草稿修改不会改写这份。</div>
          <button className="btn" onClick={() => setViewing(null)}>← 返回当前草稿</button>
        </aside>
        <main className="main">
          <ArchivedPlan plan={viewing} onBack={() => setViewing(null)} />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <ConfigPanel config={config} onChange={handleConfigChange} locked={false} />
        {archives.length > 0 && (
          <>
            <h2>已确认方案（重新打开可找回）</h2>
            <ul className="arch-list" style={{ paddingLeft: 16 }}>
              {archives.map((a) => (
                <li key={a.id}>
                  <button className="btn ghost" onClick={() => openArchive(a.id)}>
                    {new Date(a.createdAt).toLocaleString()} · {a.totals.usedWells} 孔 ·{' '}
                    {a.groups.map((g) => g.name).join('、')}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      <main className="main">
        {calcError && <div className="banner err">计算服务错误：{calcError}</div>}
        {loading && <div className="banner warn">正在按最新输入重新计算，板位与清单取自同一份结果……</div>}

        {response && (
          <>
            {errors.length > 0 && (
              <div className="banner err">
                <strong>不能执行（{errors.length} 项阻断，确认与导出已禁用）：</strong>
                <ul className="issues">
                  {errors.map((i, k) => (
                    <li key={k}>{i.message} <span className="code">[{i.code}]</span></li>
                  ))}
                </ul>
              </div>
            )}
            {warnings.length > 0 && (
              <div className="banner warn">
                <strong>提醒：</strong>
                <ul className="issues">
                  {warnings.map((i, k) => (
                    <li key={k}>{i.message} <span className="code">[{i.code}]</span></li>
                  ))}
                </ul>
              </div>
            )}
            {feasible && !loading && (
              <div className="banner ok">
                方案可执行：占用 {response.totals.usedWells} 孔 / 96，空孔 {response.totals.emptyWells}。
                体积统一按 µL 计算（输入 mL 已按 1000 换算）；中间稀释与操作损耗已计入准备量。
              </div>
            )}

            <div className="toolbar">
              {manual ? (
                <>
                  <strong>排布模式：手工</strong>
                  <button className="btn small" onClick={restoreAuto}>放弃手工，回到自动排布</button>
                </>
              ) : (
                <>
                  <strong>排布模式：自动（按列 A1→H1 填充）</strong>
                  <button className="btn small" onClick={enterManual}>手工调整板位</button>
                </>
              )}
            </div>

            {manual && pending && (
              <AssignmentPanel
                response={response}
                pending={pending}
                onSelectKey={setPendingKey}
                onAutoAssign={restoreAuto}
                onClearAssignment={clearAll}
              />
            )}

            <PlateGrid
              response={response}
              selected={selected}
              onSelect={onPlateClick}
              assignMode={manual}
              pendingWells={pendingWells}
              problemGroupIds={problemGroupIds}
            />

            <div className="tabs">
              <button className={tab === 'well' ? 'active' : ''} onClick={() => setTab('well')}>按孔位查看</button>
              <button className={tab === 'steps' ? 'active' : ''} onClick={() => setTab('steps')}>按配液步骤查看</button>
              <button className={tab === 'summary' ? 'active' : ''} onClick={() => setTab('summary')}>用量汇总与计算依据</button>
            </div>

            {tab === 'well' && (
              <WellDetail
                response={response}
                well={selected}
                onJump={(w) => {
                  setSelected(w);
                  const s = response.steps.find((x) => x.wells.includes(w));
                  if (s) {
                    setHighlightedStep(s.order);
                    setTab('steps');
                  }
                }}
              />
            )}
            {tab === 'steps' && (
              <StepsView
                response={response}
                highlightWell={selected}
                highlightedStep={highlightedStep}
                onStepShown={() => setHighlightedStep(null)}
                onWellClick={(w) => setSelected(w)}
              />
            )}
            {tab === 'summary' && (
              <>
                <Summary response={response} />
                <h2>本次计算依据</h2>
                <ul className="banner ok" style={{ display: 'block' }}>
                  {response.basis.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              </>
            )}

            <div className="confirm-bar">
              <input
                placeholder="确认备注（可选，例如批号/操作人）"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="btn primary" disabled={!feasible || confirming || loading} onClick={confirmPlan}>
                {feasible ? '确认本方案并锁定导出' : '存在阻断问题，不能确认'}
              </button>
              {confirmError && <span style={{ color: 'var(--red)', fontSize: 12 }}>{confirmError}</span>}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
