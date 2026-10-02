import type { CalculateResponse } from '../../../shared/api';
import { formatUl, formatVolume } from '../format';

export function Summary({ response }: { response: CalculateResponse }) {
  const { totals, feasible } = response;
  const stockBad = totals.stockByGroup.some((s) => s.usedUl > s.availableUl + 0.05 + 1e-9);

  return (
    <div>
      <div className="summary-grid">
        <div className={`stat ${totals.usedWells > 96 ? 'bad' : ''}`}>
          <div className="v">{totals.usedWells} / 96</div>
          <div className="l">占用孔 / 板容量</div>
        </div>
        <div className="stat">
          <div className="v">{totals.emptyWells}</div>
          <div className="l">空孔（不接受处理）</div>
        </div>
        <div className="stat">
          <div className="v">{formatVolume(totals.diluentPrepareUl)}</div>
          <div className="l">稀释液实际准备量（含损耗）</div>
        </div>
        <div className="stat">
          <div className="v">{formatVolume(totals.finalVolumeSumUl)}</div>
          <div className="l">全部孔终体积合计</div>
        </div>
        <div className={`stat ${feasible ? '' : 'bad'}`}>
          <div className="v">{feasible ? '可执行' : '不可执行'}</div>
          <div className="l">服务端统一判定</div>
        </div>
      </div>

      <h2>母液消耗 vs 实际可用（µL）</h2>
      <table className="data">
        <thead>
          <tr><th>处理组</th><th>本次消耗</th><th>实际可用</th><th>余量</th><th>结论</th></tr>
        </thead>
        <tbody>
          {totals.stockByGroup.map((s) => {
            const lack = s.usedUl > s.availableUl + 1e-9;
            return (
              <tr key={s.groupId}>
                <td>{s.groupName}</td>
                <td>{formatUl(s.usedUl)}</td>
                <td>{formatUl(s.availableUl)}</td>
                <td style={{ color: lack ? 'var(--red)' : undefined }}>
                  {formatUl(s.availableUl - s.usedUl)}
                </td>
                <td>{lack ? <strong style={{ color: 'var(--red)' }}>母液不足</strong> : '足够'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {stockBad && (
        <div className="banner err" style={{ marginTop: 8 }}>
          至少一组母液不足：方案不可执行，下方不会给出“可执行”结论，确认与导出已禁用。
        </div>
      )}
      <div className="sub" style={{ marginTop: 8 }}>
        稀释液净入孔 {formatVolume(totals.diluentNetUl)}；中间液配液与各分装批次损耗计入后，
        实际准备 {formatVolume(totals.diluentPrepareUl)}。
      </div>
    </div>
  );
}
