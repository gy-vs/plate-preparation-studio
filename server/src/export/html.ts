import type { ConfirmedPlan } from '../../../shared/api.js';
import { PLATE_COLS, PLATE_ROWS } from '../../../shared/plate.js';
import { formatUl } from '../core/units.js';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** 生成自包含、可打印/可转发的单文件 HTML：计算依据 + 孔位身份 + 移液步骤。 */
export function exportHtml(plan: ConfirmedPlan): string {
  const r = plan.response;
  const wellMap = new Map(r.wells.map((w) => [w.well, w]));

  const cellHtml = (id: string): string => {
    const w = wellMap.get(id)!;
    if (w.type === 'empty') {
      return `<td class="cell empty" title="空孔"><div class="wid">${id}</div><span>空</span></td>`;
    }
    if (w.type === 'group') {
      return `<td class="cell group" title="${escapeHtml(additions(w))}">
        <div class="wid">${id}</div>
        <div class="g">${escapeHtml(w.groupName ?? '')}</div>
        <div class="t">${escapeHtml(String(w.targetConcentration))} ${escapeHtml(w.concentrationUnit ?? '')}</div>
        <div class="r">复孔 ${(w.replicateIndex ?? 0) + 1}</div></td>`;
    }
    return `<td class="cell control" title="${escapeHtml(additions(w))}">
      <div class="wid">${id}</div>
      <div class="g">${escapeHtml(w.controlName ?? '')}</div>
      <div class="r">对照</div></td>`;
  };

  const rowsHtml = PLATE_ROWS.map(
    (row) =>
      `<tr><th class="rh">${row}</th>${PLATE_COLS.map((col) => cellHtml(`${row}${col}`)).join('')}</tr>`,
  ).join('');

  function additions(w: (typeof r.wells)[number]): string {
    if (w.type === 'empty') return '空孔';
    return w.additions.map((a) => `${a.label} ${formatUl(a.volumeUl)} µL`).join('；');
  }

  const stepsHtml = r.steps
    .map(
      (s) => `<li>
        <div class="step-h"><span class="order">${s.order}</span>${escapeHtml(s.title)}</div>
        <div class="step-d">${escapeHtml(s.detail)}</div>
      </li>`,
    )
    .join('');

  const wellRows = r.wells
    .filter((w) => w.type !== 'empty')
    .map(
      (w) => `<tr>
        <td>${w.well}</td>
        <td>${w.type === 'group' ? escapeHtml(w.groupName ?? '') : escapeHtml(w.controlName ?? '')}</td>
        <td>${w.type === 'group' ? `${escapeHtml(String(w.targetConcentration))} ${escapeHtml(w.concentrationUnit ?? '')}` : '—'}</td>
        <td>${w.replicateIndex !== undefined ? w.replicateIndex + 1 : '—'}</td>
        <td>${formatUl(w.finalVolumeUl)}</td>
        <td>${w.additions.map((a) => `${escapeHtml(a.label)} ${formatUl(a.volumeUl)} µL`).join('<br>')}</td>
      </tr>`,
    )
    .join('');

  const stockRows = r.totals.stockByGroup
    .map(
      (s) => `<tr><td>${escapeHtml(s.groupName)}</td><td>${formatUl(s.usedUl)}</td>
        <td>${formatUl(s.availableUl)}</td><td>${s.usedUl <= s.availableUl ? '足够' : '<b>不足</b>'}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>已确认板实验方案 ${plan.id}</title>
<style>
  body{font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;margin:24px;color:#1a2330}
  h1{font-size:20px} h2{font-size:16px;margin-top:28px;border-left:4px solid #2563eb;padding-left:8px}
  .meta{color:#55606e;font-size:13px}
  .lock{background:#ecfdf5;border:1px solid #10b981;border-radius:6px;padding:10px 14px;display:inline-block}
  table{border-collapse:collapse}
  .plate td,th{border:1px solid #94a3b8}
  .plate .ch,.rh{background:#f1f5f9;padding:4px 6px;font-weight:600}
  .cell{width:74px;height:62px;padding:3px 4px;vertical-align:top;font-size:10px;cursor:default}
  .cell .wid{font-weight:700;color:#64748b}
  .cell.group{background:#eff6ff} .cell.control{background:#fef3c7}
  .cell .g{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cell .t{color:#1d4ed8} .cell .r{color:#64748b} .cell.empty{background:#fafafa;color:#cbd5e1}
  .data{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
  .data th,.data td{border:1px solid #cbd5e1;padding:5px 8px;text-align:left;vertical-align:top}
  .data th{background:#f1f5f9}
  ol.steps{padding-left:0;list-style:none;counter-reset:none}
  ol.steps li{border:1px solid #cbd5e1;border-radius:6px;padding:8px 12px;margin:6px 0}
  .step-h{font-weight:600} .order{display:inline-block;background:#2563eb;color:#fff;border-radius:50%;width:20px;height:20px;text-align:center;line-height:20px;font-size:12px;margin-right:8px}
  .step-d{color:#475569;font-size:13px;margin-top:4px}
  ul.basis li{margin:3px 0;font-size:13px}
  @media print{.noprint{display:none} .cell{width:60px;height:54px}}
</style></head><body>
<h1>96 孔板浓度梯度配液方案（已确认锁定）</h1>
<p class="meta">
  方案 ID：${plan.id}<br>
  确认时间：${plan.createdAt}<br>
  ${plan.note ? `备注：${escapeHtml(plan.note)}<br>` : ''}
  内容指纹：<code>${plan.contentHash}</code>
</p>
<p class="lock">✅ 本文件由服务端基于同一份计算结果生成。确认后的方案不可被后续草稿修改改写；
若页面中同 ID 方案指纹与此不同，说明存档被改动。</p>

<h2>一、计算依据</h2>
<ul class="basis">${r.basis.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>

<h2>二、板位安排（共使用 ${r.totals.usedWells} 孔，空孔 ${r.totals.emptyWells}）</h2>
<table class="plate">
  <tr><th></th>${PLATE_COLS.map((c) => `<th class="ch">${c}</th>`).join('')}</tr>
  ${rowsHtml}
</table>
<p class="meta">悬停单元格可看该孔加液；蓝色=处理组，黄色=对照。</p>

<h2>三、逐孔加液清单</h2>
<table class="data"><thead><tr><th>孔位</th><th>归属</th><th>目标浓度</th><th>重复</th><th>终体积(µL)</th><th>加入液体</th></tr></thead>
<tbody>${wellRows}</tbody></table>

<h2>四、配液与移液步骤（按顺序执行）</h2>
<ol class="steps">${stepsHtml}</ol>

<h2>五、用量汇总（µL）</h2>
<table class="data"><thead><tr><th>母液（组）</th><th>消耗</th><th>实际可用</th><th>结论</th></tr></thead>
<tbody>${stockRows}</tbody></table>
<p class="meta">
  稀释液净入孔 ${formatUl(r.totals.diluentNetUl)} µL；含中间液配液与操作损耗后实际准备
  ${formatUl(r.totals.diluentPrepareUl)} µL；所有孔终体积之和 ${formatUl(r.totals.finalVolumeSumUl)} µL。
</p>
</body></html>`;
}
