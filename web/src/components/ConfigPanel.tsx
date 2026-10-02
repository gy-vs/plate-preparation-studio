import type {
  ConcentrationUnit,
  ControlInput,
  DraftConfig,
  GroupInput,
  VolumeUnit,
} from '../../../shared/api';

const CONC_UNITS: ConcentrationUnit[] = ['uM', 'mM', 'ug/mL', 'ng/mL'];
const VOL_UNITS: VolumeUnit[] = ['uL', 'mL'];

interface Props {
  config: DraftConfig;
  onChange: (next: DraftConfig) => void;
  locked: boolean;
}

export function ConfigPanel({ config, onChange, locked }: Props) {
  const patch = (p: Partial<DraftConfig>) => onChange({ ...config, ...p });

  return (
    <div>
      <h1>本次板实验配置</h1>
      <div className="sub">所有计算在服务端执行；板位与操作清单取自同一份结果。</div>

      <fieldset>
        <legend>通用设置</legend>
        <label className="fld">
          <span>稀释液名称</span>
          <input
            value={config.diluentName}
            disabled={locked}
            onChange={(e) => patch({ diluentName: e.target.value })}
          />
        </label>
        <div className="row3">
          <label className="fld">
            <span>移液器最小可操作体积（µL）</span>
            <input
              type="number" step="0.1" min={0}
              value={config.pipette.minVolume}
              disabled={locked}
              onChange={(e) =>
                patch({ pipette: { ...config.pipette, minVolume: Number(e.target.value) } })
              }
            />
          </label>
          <label className="fld">
            <span>移液器量程上限（µL）</span>
            <input
              type="number" step="1" min={1}
              value={config.pipette.maxVolume}
              disabled={locked}
              onChange={(e) =>
                patch({ pipette: { ...config.pipette, maxVolume: Number(e.target.value) } })
              }
            />
          </label>
        </div>
        <label className="fld">
          <span>每批分装固定操作损耗（µL，中间液/稀释液多备的量）</span>
          <input
            type="number" step="0.1" min={0}
            value={config.overageFixed}
            disabled={locked}
            onChange={(e) => patch({ overageFixed: Number(e.target.value) })}
          />
        </label>
      </fieldset>

      {config.groups.map((g, gi) => (
        <GroupEditor
          key={gi}
          group={g}
          disabled={locked}
          onChange={(ng) => {
            const groups = config.groups.map((x, i) => (i === gi ? ng : x));
            patch({ groups });
          }}
          onRemove={() => patch({ groups: config.groups.filter((_, i) => i !== gi) })}
        />
      ))}
      <button className="btn" disabled={locked} onClick={() => patch({ groups: [...config.groups, emptyGroup(config.groups.length)] })}>
        ＋ 增加处理组
      </button>

      {config.controls.map((c, ci) => (
        <ControlEditor
          key={ci}
          control={c}
          disabled={locked}
          onChange={(nc) =>
            patch({ controls: config.controls.map((x, i) => (i === ci ? nc : x)) })
          }
          onRemove={() => patch({ controls: config.controls.filter((_, i) => i !== ci) })}
        />
      ))}
      <button className="btn" disabled={locked} onClick={() => patch({ controls: [...config.controls, emptyControl(config.controls.length)] })}>
        ＋ 增加对照组
      </button>
    </div>
  );
}

function GroupEditor({
  group,
  onChange,
  onRemove,
  disabled,
}: {
  group: GroupInput;
  onChange: (g: GroupInput) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const addTarget = (v: number) => {
    if (Number.isFinite(v) && v > 0 && !group.targets.includes(v)) {
      onChange({ ...group, targets: [...group.targets, v] });
    }
  };

  return (
    <fieldset>
      <legend>
        处理组：{group.name || '未命名'}
        <button className="btn ghost danger" style={{ float: 'right' }} disabled={disabled} onClick={onRemove}>
          删除
        </button>
      </legend>
      <label className="fld">
        <span>组名</span>
        <input value={group.name} disabled={disabled} onChange={(e) => onChange({ ...group, name: e.target.value })} />
      </label>
      <div className="row3">
        <label className="fld">
          <span>母液浓度</span>
          <div className="row2">
            <input
              type="number" step="any" min={0}
              value={group.stockConcentration}
              disabled={disabled}
              onChange={(e) => onChange({ ...group, stockConcentration: Number(e.target.value) })}
            />
            <select
              value={group.stockUnit}
              disabled={disabled}
              onChange={(e) => onChange({ ...group, stockUnit: e.target.value as ConcentrationUnit })}
            >
              {CONC_UNITS.map((u) => <option key={u}>{u}</option>)}
            </select>
          </div>
        </label>
        <label className="fld">
          <span>母液实际可用量（有限）</span>
          <div className="row2">
            <input
              type="number" step="any" min={0}
              value={group.stockAvailable}
              disabled={disabled}
              onChange={(e) => onChange({ ...group, stockAvailable: Number(e.target.value) })}
            />
            <select
              value={group.stockVolumeUnit}
              disabled={disabled}
              onChange={(e) => onChange({ ...group, stockVolumeUnit: e.target.value as VolumeUnit })}
            >
              {VOL_UNITS.map((u) => <option key={u}>{u}</option>)}
            </select>
          </div>
        </label>
      </div>
      <div className="row3">
        <label className="fld">
          <span>每浓度重复孔数</span>
          <input
            type="number" min={1} step={1}
            value={group.replicates}
            disabled={disabled}
            onChange={(e) => onChange({ ...group, replicates: Math.max(1, Number(e.target.value)) })}
          />
        </label>
        <label className="fld">
          <span>每孔终体积</span>
          <div className="row2">
            <input
              type="number" step="any" min={0}
              value={group.finalVolume}
              disabled={disabled}
              onChange={(e) => onChange({ ...group, finalVolume: Number(e.target.value) })}
            />
            <select
              value={group.finalVolumeUnit}
              disabled={disabled}
              onChange={(e) => onChange({ ...group, finalVolumeUnit: e.target.value as VolumeUnit })}
            >
              {VOL_UNITS.map((u) => <option key={u}>{u}</option>)}
            </select>
          </div>
        </label>
      </div>
      <label className="fld">
        <span>目标浓度序列（单位同母液：{group.stockUnit}）</span>
        <div className="targets">
          {group.targets.map((t) => (
            <span className="tag" key={t}>
              {t} {group.stockUnit}
              <button disabled={disabled} onClick={() => onChange({ ...group, targets: group.targets.filter((x) => x !== t) })}>
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="tag-row" style={{ marginTop: 6 }}>
          <input
            type="number" step="any" placeholder="新增目标浓度"
            disabled={disabled}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                addTarget(Number((e.target as HTMLInputElement).value));
                (e.target as HTMLInputElement).value = '';
              }
            }}
          />
          <button
            className="btn small"
            disabled={disabled}
            onClick={(e) => {
              const input = (e.currentTarget.previousSibling as HTMLInputElement);
              addTarget(Number(input.value));
              input.value = '';
            }}
          >
            添加
          </button>
        </div>
      </label>
    </fieldset>
  );
}

function ControlEditor({
  control,
  onChange,
  onRemove,
  disabled,
}: {
  control: ControlInput;
  onChange: (c: ControlInput) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  return (
    <fieldset>
      <legend>
        对照孔：{control.name || '未命名'}（仅加稀释液）
        <button className="btn ghost danger" style={{ float: 'right' }} disabled={disabled} onClick={onRemove}>
          删除
        </button>
      </legend>
      <div className="row3">
        <label className="fld">
          <span>名称</span>
          <input value={control.name} disabled={disabled} onChange={(e) => onChange({ ...control, name: e.target.value })} />
        </label>
        <label className="fld">
          <span>孔数</span>
          <input
            type="number" min={1} step={1}
            value={control.count}
            disabled={disabled}
            onChange={(e) => onChange({ ...control, count: Math.max(1, Number(e.target.value)) })}
          />
        </label>
      </div>
      <label className="fld">
        <span>每孔终体积</span>
        <div className="row2">
          <input
            type="number" step="any" min={0}
            value={control.finalVolume}
            disabled={disabled}
            onChange={(e) => onChange({ ...control, finalVolume: Number(e.target.value) })}
          />
          <select
            value={control.finalVolumeUnit}
            disabled={disabled}
            onChange={(e) => onChange({ ...control, finalVolumeUnit: e.target.value as VolumeUnit })}
          >
            {VOL_UNITS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </div>
      </label>
    </fieldset>
  );
}

function emptyGroup(n: number): GroupInput {
  return {
    name: `处理组 ${n + 1}`,
    stockConcentration: 1000,
    stockUnit: 'uM',
    stockAvailable: 100,
    stockVolumeUnit: 'uL',
    targets: [100],
    replicates: 3,
    finalVolume: 100,
    finalVolumeUnit: 'uL',
  };
}

function emptyControl(n: number): ControlInput {
  return { name: `对照 ${n + 1}`, count: 2, finalVolume: 100, finalVolumeUnit: 'uL' };
}
