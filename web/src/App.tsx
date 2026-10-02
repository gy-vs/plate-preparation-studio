import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatConcentration,
  formatVolumeUl,
  type AssignmentKey,
  type ComputeResult,
  type ConfirmedPlan,
  type PlannerState,
  type RawConfig,
} from "shared";
import { api } from "./api.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { ConfigForm, groupColor } from "./ConfigForm.js";
import { PlateView, type PaintOption } from "./PlateView.js";
import { DetailsPanel } from "./DetailsPanel.js";

type Mode = "draft" | "confirmed";

export function App() {
  const [mode, setMode] = useState<Mode>("draft");
  const [config, setConfig] = useState<RawConfig>(DEFAULT_CONFIG);
  const [result, setResult] = useState<ComputeResult | null>(null);
  const [state, setState] = useState<PlannerState | null>(null);
  const [assignments, setAssignments] = useState<Record<string, AssignmentKey> | undefined>(undefined);
  const [selectedWell, setSelectedWell] = useState<string | null>(null);
  const [paintOption, setPaintOption] = useState<PaintOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const reqSeq = useRef(0);

  // 初次进入：直接加载草稿/已确认方案，不经过任何介绍页
  useEffect(() => {
    api.getState().then(({ state }) => {
      setState(state);
      if (state.draftRaw && state.draftResult) {
        setConfig(state.draftRaw);
        setResult(state.draftResult);
        setAssignments(state.draftResult.assignmentAccepted ? undefined : undefined);
        return;
      }
      void recompute(DEFAULT_CONFIG, undefined, false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc 退出涂画
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPaintOption(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function recompute(cfg: RawConfig, map: Record<string, AssignmentKey> | undefined, setBusyFlag = true) {
    const seq = ++reqSeq.current;
    if (setBusyFlag) setBusy(true);
    setError(null);
    try {
      const { result, state } = await api.compute(cfg, map);
      if (seq !== reqSeq.current) return;
      setResult(result);
      setState(state);
      // 服务端拒绝旧安排 → 旧选中孔与旧用量汇总不能继续指向旧安排
      if (!result.assignmentAccepted) {
        setAssignments(undefined);
        setSelectedWell(null);
        setPaintOption(null);
      } else if (map !== undefined) {
        setAssignments(map);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (seq === reqSeq.current) setBusy(false);
    }
  }

  // 输入变更后重新计算（300ms 去抖）。孔位安排总取自服务端本次返回的同一份结果。
  const debounce = useRef<number | undefined>(undefined);
  function handleConfigChange(next: RawConfig) {
    setConfig(next);
    setMode("draft");
    setPaintOption(null);
    // 结构变化（浓度/重复/对照/移液约束）后，旧手工安排可能引用旧版本：
    // 不随请求提交旧 map，由服务端按新配置自动排布，前端以新结果重置一切。
    setAssignments(undefined);
    setSelectedWell(null);
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => void recompute(next, undefined), 300);
  }

  function paintWell(wellId: string) {
    if (!paintOption || !result) return;
    const base: Record<string, AssignmentKey> = { ...result.assignments };
    const current = base[wellId];
    // 点已含相同处理的孔 → 擦除（置空）；否则把该类处理刷到孔上（覆盖原定义）
    const sameTreatment =
      paintOption.kind === "treatment" &&
      current?.kind === "treatment" &&
      current.groupId === paintOption.groupId &&
      current.targetIndex === paintOption.targetIndex;
    if (sameTreatment || (paintOption.kind === "control" && current?.kind === "control")) {
      delete base[wellId];
    } else if (paintOption.kind === "empty") {
      delete base[wellId];
    } else if (paintOption.kind === "control") {
      base[wellId] = { kind: "control" };
    } else {
      base[wellId] = { kind: "treatment", groupId: paintOption.groupId!, targetIndex: paintOption.targetIndex! };
    }
    void recompute(config, base);
  }

  function autoLayout() {
    setAssignments(undefined);
    void recompute(config, undefined);
  }

  function clearLayout() {
    // 只清空手工标记：交给服务端判断数量；这里提交“全空”让结果如实反映未排布
    void recompute(config, {});
  }

  async function confirmPlan() {
    setConfirmError(null);
    try {
      const { confirmed, state } = await api.confirm(config, assignments);
      setState(state);
      setResult(confirmed.result);
      setShowConfirm(false);
      setMode("confirmed");
      setPaintOption(null);
    } catch (e) {
      const data = (e as Error & { data?: { reasons?: { message: string }[] } }).data;
      setConfirmError(data?.reasons?.map((r) => r.message).join("；") ?? (e as Error).message);
    }
  }

  const groupIndex = useMemo(() => {
    const m = new Map<string, number>();
    config.groups.forEach((g, i) => m.set(g.id, i));
    return m;
  }, [config.groups]);

  // 已确认模式下展示冻结快照
  const confirmed: ConfirmedPlan | undefined = state?.confirmed;
  const viewResult: ComputeResult | null = mode === "confirmed" && confirmed ? confirmed.result : result;
  const draftStale = !!result && !result.assignmentAccepted;

  return (
    <div className="app">
      <div className="topbar">
        <h1>96 孔板浓度梯度配液规划</h1>
        <span className="muted">计算在服务端统一执行 · 板位与清单取自同一份结果</span>
        <span className="spacer" />
        <div className="mode-switch">
          <button className={mode === "draft" ? "active" : ""} onClick={() => setMode("draft")}>
            草稿
          </button>
          <button className={mode === "confirmed" ? "active" : ""} disabled={!confirmed} onClick={() => setMode("confirmed")}>
            已确认方案{confirmed ? `（${confirmed.confirmationId}）` : ""}
          </button>
        </div>
      </div>

      {/* 左：配置 */}
      <section className="panel">
        <h2>本次实验配置</h2>
        <ConfigForm config={config} onChange={handleConfigChange} disabled={mode === "confirmed"} />
      </section>

      {/* 中：状态 + 板位 */}
      <section className="panel">
        {mode === "confirmed" && confirmed && (
          <div className="frozen-banner">
            🔒 正在查看已确认并冻结的方案 <b>{confirmed.confirmationId}</b>（{confirmed.confirmedAt}）。
            此板位与操作清单不会被草稿修改改写。
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <a href={api.exportUrl(confirmed.confirmationId, "txt")}><button>导出 TXT</button></a>
              <a href={api.exportUrl(confirmed.confirmationId, "csv")}><button>导出逐孔 CSV</button></a>
              <a href={api.exportUrl(confirmed.confirmationId, "json")}><button>导出 JSON</button></a>
              <button className="primary" onClick={() => setMode("draft")}>返回草稿继续修改</button>
            </div>
          </div>
        )}

        {viewResult && <StatusBar result={viewResult} busy={busy} stale={mode === "draft" && draftStale} />}

        {mode === "draft" && draftStale && (
          <div className="stale-banner">
            孔位安排已失效：{result!.assignmentReasons.map((r) => r.message).join("；")}
            下面的板位与用量是服务端按当前配置重新自动排布的结果，原选中已清空。可直接在此基础上重新标孔。
          </div>
        )}

        {viewResult && viewResult.wells.length > 0 && (
          <>
            <Legend result={viewResult} />
            <div className="toolbar">
              <button onClick={autoLayout} disabled={mode === "confirmed"}>自动排布</button>
              <button onClick={clearLayout} disabled={mode === "confirmed"}>清空排布</button>
              <span style={{ flex: 1 }} />
              <button
                className="primary"
                disabled={!viewResult.feasible || mode === "confirmed"}
                onClick={() => setShowConfirm(true)}
              >
                确认方案并冻结
              </button>
            </div>
            {mode === "draft" && (
              <PaintPalette config={config} paintOption={paintOption} onPick={setPaintOption} />
            )}
            {paintOption && (
              <div className="paint-hint">
                正在涂画：<b>{paintOption.label}</b>。点击孔位刷入该处理（覆盖原定义，一孔只有一份处理）；
                再点一次同类孔可擦除。刷完后孔数必须与配置要求一致，否则服务端判定排布失效并自动重排。Esc 退出。
                <button style={{ marginLeft: 8 }} onClick={() => setPaintOption(null)}>退出涂画</button>
              </div>
            )}
            <PlateView
              result={viewResult}
              selectedWell={selectedWell}
              onSelectWell={setSelectedWell}
              paintOption={mode === "draft" ? paintOption : null}
              onPaint={paintWell}
              stale={mode === "draft" && draftStale}
              groupIndex={groupIndex}
            />
          </>
        )}
        {viewResult && viewResult.wells.length === 0 && (
          <div className="stale-banner">输入未通过校验，无法生成板位，请先修正左侧配置。</div>
        )}
        {!viewResult && <div className="muted">正在加载本次配置…</div>}
      </section>

      {/* 右：详情/步骤/汇总 */}
      <section className="panel">
        {viewResult && viewResult.wells.length > 0 && <Summary result={viewResult} />}
        {viewResult && viewResult.wells.length > 0 && (
          <DetailsPanel result={viewResult} selectedWell={selectedWell} onSelectWell={setSelectedWell} />
        )}
        {error && <div className="stale-banner">{error}</div>}
      </section>

      {showConfirm && (
        <ConfirmModal
          result={result!}
          onCancel={() => setShowConfirm(false)}
          onConfirm={confirmPlan}
          error={confirmError}
        />
      )}
    </div>
  );
}

function StatusBar({ result, busy, stale }: { result: ComputeResult; busy: boolean; stale: boolean }) {
  if (busy) return <p className="muted">服务端重新计算中…</p>;
  if (stale || !result.feasible) {
    return (
      <div>
        <span className="badge bad">不能执行</span>
        <ul className="reasons" style={{ marginTop: 8 }}>
          {result.reasons.map((r, i) => (
            <li key={i}>{r.message}</li>
          ))}
          {result.reasons.length === 0 && <li>存在未解决的排布问题。</li>}
        </ul>
      </div>
    );
  }
  return <span className="badge ok">可执行 — 板位、用量与移液步骤已一致</span>;
}

function Legend({ result }: { result: ComputeResult }) {
  return (
    <div className="legend">
      {result.config.groups.map((g, i) => (
        <span key={g.id}>
          <span className="sw" style={{ background: groupColor(i) }} />
          {g.name}（{g.targetsN.length} 浓度 × {g.replicates} 复孔）
        </span>
      ))}
      <span><span className="sw" style={{ background: "#8a6fb8" }} />对照 × {result.config.controlWells}</span>
      <span><span className="sw" style={{ background: "#fff", borderStyle: "dashed" }} />空孔 {result.totals.emptyWells}</span>
    </div>
  );
}

function PaintPalette({
  config,
  paintOption,
  onPick,
}: {
  config: RawConfig;
  paintOption: PaintOption | null;
  onPick: (p: PaintOption | null) => void;
}) {
  const options: PaintOption[] = [];
  config.groups.forEach((g, gi) => {
    g.targets.forEach((t, ti) => {
      options.push({
        kind: "treatment",
        groupId: g.id,
        targetIndex: ti,
        label: `${g.name} · ${t} ${g.concentrationUnit}`,
        color: groupColor(gi),
      });
    });
  });
  options.push({ kind: "control", label: "对照孔" });
  options.push({ kind: "empty", label: "置为空孔" });

  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ marginTop: 0 }}>选择要涂到孔上的处理（涂画会立即提交服务端重新计算）</label>
      <div className="toolbar">
        {options.map((o) => {
          const active = paintOption?.label === o.label;
          return (
            <button
              key={o.label}
              className={active ? "primary" : ""}
              style={o.color ? { borderColor: o.color } : undefined}
              onClick={() => onPick(active ? null : o)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Summary({ result }: { result: ComputeResult }) {
  const t = result.totals;
  const stockOk = t.stockRequiredUl <= t.stockAvailableUl + 1e-6;
  return (
    <div className="detail-box">
      <div className="big">用量汇总</div>
      <dl className="summary-grid" style={{ marginTop: 6 }}>
        <dt>占用孔位</dt>
        <dd>{t.occupiedWells} / 96（空 {t.emptyWells}）</dd>
        <dt>母液需备</dt>
        <dd className={stockOk ? "" : "over"}>
          {Number.isFinite(t.stockRequiredUl) ? formatVolumeUl(t.stockRequiredUl) : "—"} / 可用 {formatVolumeUl(t.stockAvailableUl)}
        </dd>
        <dt>稀释液需备</dt>
        <dd>{Number.isFinite(t.diluentRequiredUl) ? formatVolumeUl(t.diluentRequiredUl) : "—"}</dd>
        <dt>中间液份数</dt>
        <dd>{t.intermediateBatchCount}（各含 {formatVolumeUl(result.config.deadVolumeUl)} 损耗）</dd>
        <dt>母液浓度</dt>
        <dd>{formatConcentration(result.config.stockConcentrationN)}（最小移液 {formatVolumeUl(result.config.pipetteMinVolumeUl)}）</dd>
      </dl>
    </div>
  );
}

function ConfirmModal({
  result,
  onCancel,
  onConfirm,
  error,
}: {
  result: ComputeResult;
  onCancel: () => void;
  onConfirm: () => void;
  error: string | null;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>确认本次配液方案</h2>
        <p className="muted">确认后该板位与操作清单将作为冻结记录保存，之后修改草稿不会改写这份方案；可随时导出并在重新打开页面后找回核对。</p>
        <ul>
          <li>占用孔位：{result.totals.occupiedWells}/96（对照 {result.config.controlWells}，空孔 {result.totals.emptyWells}）</li>
          <li>母液需备 {formatVolumeUl(result.totals.stockRequiredUl)}（可用 {formatVolumeUl(result.totals.stockAvailableUl)}）</li>
          <li>稀释液需备 {formatVolumeUl(result.totals.diluentRequiredUl)}</li>
          <li>中间液 {result.totals.intermediateBatchCount} 份，移液步骤 {result.steps.length} 步</li>
          <li>配置签名：{result.configHash}</li>
        </ul>
        <label className="checkline">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>我已核对孔位身份、目标浓度、每孔终体积与移液顺序，按此方案执行。</span>
        </label>
        {error && <ul className="reasons"><li>{error}</li></ul>}
        <div className="toolbar" style={{ justifyContent: "flex-end" }}>
          <button onClick={onCancel}>取消</button>
          <button className="primary" disabled={!checked || !result.feasible} onClick={onConfirm}>
            确认并冻结
          </button>
        </div>
      </div>
    </div>
  );
}
