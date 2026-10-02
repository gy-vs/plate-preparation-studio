import type { ConcentrationUnit, GroupInput, RawConfig, VolumeUnit } from "shared";
import { freshGroup } from "./defaults.js";

const CONC_UNITS: ConcentrationUnit[] = ["pM", "nM", "µM", "mM", "M"];
const VOL_UNITS: VolumeUnit[] = ["µL", "mL"];

interface Props {
  config: RawConfig;
  onChange: (next: RawConfig) => void;
  disabled?: boolean;
}

export function ConfigForm({ config, onChange, disabled }: Props) {
  const patch = (p: Partial<RawConfig>) => onChange({ ...config, ...p });

  const patchGroup = (id: string, p: Partial<GroupInput>) =>
    onChange({ ...config, groups: config.groups.map((g) => (g.id === id ? { ...g, ...p } : g)) });

  return (
    <div>
      <label>实验名称</label>
      <input value={config.experimentName} disabled={disabled} onChange={(e) => patch({ experimentName: e.target.value })} />

      <h3>母液（有限资源）</h3>
      <div className="row">
        <div>
          <label>母液浓度</label>
          <input
            type="number"
            min={0}
            value={config.stockConcentration}
            disabled={disabled}
            onChange={(e) => patch({ stockConcentration: Number(e.target.value) })}
          />
        </div>
        <div className="narrow">
          <label>单位</label>
          <select
            value={config.stockConcentrationUnit}
            disabled={disabled}
            onChange={(e) => patch({ stockConcentrationUnit: e.target.value as ConcentrationUnit })}
          >
            {CONC_UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div>
          <label>母液实际可用量</label>
          <input
            type="number"
            min={0}
            value={config.stockAvailable}
            disabled={disabled}
            onChange={(e) => patch({ stockAvailable: Number(e.target.value) })}
          />
        </div>
        <div className="narrow">
          <label>单位</label>
          <select
            value={config.stockAvailableUnit}
            disabled={disabled}
            onChange={(e) => patch({ stockAvailableUnit: e.target.value as VolumeUnit })}
          >
            {VOL_UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>

      <h3>移液器约束</h3>
      <div className="row">
        <div>
          <label>最小可操作体积（µL）</label>
          <input
            type="number"
            min={0}
            step={0.1}
            value={config.pipetteMinVolume}
            disabled={disabled}
            onChange={(e) => patch({ pipetteMinVolume: Number(e.target.value) })}
          />
        </div>
        <div>
          <label>每份中间液操作损耗（µL）</label>
          <input
            type="number"
            min={0}
            step={0.1}
            value={config.deadVolume}
            disabled={disabled}
            onChange={(e) => patch({ deadVolume: Number(e.target.value) })}
          />
        </div>
      </div>

      <h3>处理组</h3>
      {config.groups.map((g, gi) => (
        <div className="group-card" key={g.id} style={{ "--g": groupColor(gi) } as React.CSSProperties}>
          <div className="head">
            <input
              value={g.name}
              disabled={disabled}
              placeholder="组名"
              onChange={(e) => patchGroup(g.id, { name: e.target.value })}
            />
            {config.groups.length > 1 && (
              <button
                className="danger"
                disabled={disabled}
                onClick={() => onChange({ ...config, groups: config.groups.filter((x) => x.id !== g.id) })}
              >
                删除
              </button>
            )}
          </div>
          <label>目标浓度序列（逗号分隔，按 {g.concentrationUnit}）</label>
          <input
            value={g.targets.join(", ")}
            disabled={disabled}
            onChange={(e) =>
              patchGroup(g.id, {
                targets: e.target.value
                  .split(/[,，]/)
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map(Number),
              })
            }
          />
          <div className="row">
            <div className="narrow">
              <label>浓度单位</label>
              <select
                value={g.concentrationUnit}
                disabled={disabled}
                onChange={(e) => patchGroup(g.id, { concentrationUnit: e.target.value as ConcentrationUnit })}
              >
                {CONC_UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>
            <div className="narrow">
              <label>重复孔数</label>
              <input
                type="number"
                min={1}
                step={1}
                value={g.replicates}
                disabled={disabled}
                onChange={(e) => patchGroup(g.id, { replicates: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
              />
            </div>
            <div>
              <label>每孔终体积</label>
              <div className="row">
                <input
                  type="number"
                  min={0}
                  value={g.finalVolume}
                  disabled={disabled}
                  onChange={(e) => patchGroup(g.id, { finalVolume: Number(e.target.value) })}
                />
                <select
                  className="narrow"
                  value={g.finalVolumeUnit}
                  disabled={disabled}
                  onChange={(e) => patchGroup(g.id, { finalVolumeUnit: e.target.value as VolumeUnit })}
                >
                  {VOL_UNITS.map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      ))}
      <button disabled={disabled} onClick={() => patch({ groups: [...config.groups, freshGroup(config.groups.length)] })}>
        ＋ 添加处理组
      </button>

      <h3>对照孔（仅稀释液）</h3>
      <div className="row">
        <div className="narrow">
          <label>孔数</label>
          <input
            type="number"
            min={0}
            step={1}
            value={config.controls.count}
            disabled={disabled}
            onChange={(e) => patch({ controls: { ...config.controls, count: Math.max(0, Math.round(Number(e.target.value) || 0)) } })}
          />
        </div>
        <div>
          <label>每孔终体积</label>
          <div className="row">
            <input
              type="number"
              min={0}
              value={config.controls.finalVolume}
              disabled={disabled}
              onChange={(e) => patch({ controls: { ...config.controls, finalVolume: Number(e.target.value) } })}
            />
            <select
              className="narrow"
              value={config.controls.finalVolumeUnit}
              disabled={disabled}
              onChange={(e) => patch({ controls: { ...config.controls, finalVolumeUnit: e.target.value as VolumeUnit } })}
            >
              {VOL_UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

export function groupColor(index: number): string {
  const palette = ["#1769aa", "#e07b39", "#2e8b7d", "#c94f7c", "#5b7c2f", "#b5562a", "#3a6ea5", "#7a5195"];
  return palette[index % palette.length]!;
}
