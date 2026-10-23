import type { PortfolioStats, Recommendation } from "./api";
import { CompanyInfo, InfoPopover, metricExplanations } from "./InfoPopover";
import { MIN_WEIGHT, toHolding, tradeAction } from "./live";
import type { Universe } from "./live";
import { displayTicker, metrics, money, percent, score, totalValue, unitMoney } from "./portfolio";
import type { Portfolio } from "./portfolio";

const FACTORS: Record<string, string> = { mkt_rf: "Market beta", smb: "Size · SMB", hml: "Value · HML", rmw: "Profitability · RMW", cma: "Investment · CMA", mom: "Momentum · MOM", gmb: "Green · GMB" };
const MARKETS: Record<string, string> = { hk: "Hong Kong", tw: "Taiwan" };
type Row = { label: string; info?: string; before: number | null; after: number | null; fmt: (x: number) => string; changeFmt?: (x: number) => string; section?: string };
const pct = (digits: number, unit = "%") => (x: number) => `${(x * 100).toFixed(digits)}${unit}`;
const dec = (digits: number) => (x: number) => x.toFixed(digits);

// Match the displayed precision so an invisible change stays neutral.
export function comparisonChange(before: number | null, after: number | null, fmt: (x: number) => string) {
  if (before === null || after === null) return { tone: "comparison-flat", text: "Unavailable" };
  const delta = after - before;
  if (fmt(Math.abs(delta)) === fmt(0)) return { tone: "comparison-flat", text: fmt(0) };
  return { tone: delta > 0 ? "comparison-up" : "comparison-down", text: `${delta > 0 ? "+" : "−"}${fmt(Math.abs(delta))}` };
}

export function performanceRows(baseline: Portfolio, result: Portfolio, before: PortfolioStats, after: PortfolioStats, targetCapital: number): Row[] {
  const a = metrics(baseline), b = metrics(result), ccy = baseline.baseCurrency;
  return [
    { label: "Portfolio value", info: "Portfolio value", before: totalValue(baseline), after: totalValue(result) > 0 ? targetCapital : 0, fmt: x => money(x, ccy), section: "Risk and return" },
    { label: "USD excess return · annual", info: "Expected return · annual", before: before.ann_ret, after: after.ann_ret, fmt: pct(2), changeFmt: pct(2, " pp") },
    { label: "USD volatility · annual", info: "Portfolio volatility", before: before.ann_vol, after: after.ann_vol, fmt: pct(1), changeFmt: pct(1, " pp") },
    { label: "Portfolio green score", info: "Portfolio green score", before: a.greenScore.value, after: b.greenScore.value, fmt: dec(2), section: "Environment" },
    { label: "Greenness · g", info: "Greenness · g", before: before.g_avg, after: after.g_avg, fmt: dec(2) },
    { label: "E-score coverage", info: "E-score coverage", before: a.greenScore.coverage, after: b.greenScore.coverage, fmt: pct(1), changeFmt: pct(1, " pp") },
    { label: "Positions", info: "Positions", before: before.n_positions, after: after.n_positions, fmt: dec(0), section: "Concentration" },
    { label: "Largest position", info: "Largest position", before: before.top_weight, after: after.top_weight, fmt: pct(1), changeFmt: pct(1, " pp") },
    { label: "Effective positions", info: "Effective positions", before: before.effective_n, after: after.effective_n, fmt: dec(1) },
    // pooled markets report one beta per market factor ("hk_mkt_rf", "tw_mkt_rf")
    ...Object.keys({ ...before.exposures, ...after.exposures }).map((k, i): Row => {
      const [, market, factor] = k.match(/^(?:(hk|tw)_)?(.+)$/)!;
      return { label: `${market ? `${MARKETS[market]} · ` : ""}${FACTORS[factor] ?? factor}`, before: before.exposures[k] ?? null, after: after.exposures[k] ?? null, fmt: dec(2), section: i === 0 ? "Factor exposures (portfolio beta)" : undefined };
    }),
  ];
}

/** Every position held before or after, largest first. */
export const comparisonPositions = (rec: Recommendation) =>
  rec.trades.filter(t => t.w_current >= MIN_WEIGHT || t.w_target >= MIN_WEIGHT).sort((a, b) => Math.max(b.w_current, b.w_target) - Math.max(a.w_current, a.w_target));

/** Current and recommended portfolio side by side: key figures, then every position. */
export default function Comparison({ baseline, result, rec, universe }: { baseline: Portfolio; result: Portfolio; rec: Recommendation; universe: Universe }) {
  const ccy = result.baseCurrency;
  const cell = (r: Row, x: number | null) => (x === null ? "Unavailable" : r.fmt(x));
  const positions = comparisonPositions(rec);
  return <><div className="comparison-color-key" aria-label="Change direction"><span className="comparison-up">↑ Increase / buy</span><span className="comparison-down">↓ Decrease / sell</span><span>— Unchanged</span></div>
    <div className="table-scroll"><table className="comparison-table"><caption>Portfolio performance</caption><thead><tr><th>Metric</th><th>Old portfolio</th><th className="comparison-new">New portfolio</th><th>Change</th></tr></thead>
    <tbody>{performanceRows(baseline, result, rec.before, rec.after, rec.target_capital).flatMap(r => {
      const delta = comparisonChange(r.before, r.after, r.changeFmt ?? r.fmt);
      return [
      ...(r.section ? [<tr key={r.section} className="comparison-section"><th scope="rowgroup" colSpan={4}>{r.section}</th></tr>] : []),
      <tr key={r.label}><th scope="row">{r.info ? <InfoPopover label={r.label} content={<><strong>{r.label}</strong><p>{metricExplanations[r.info]}</p></>}>{r.label}</InfoPopover> : r.label}</th>
        <td>{cell(r, r.before)}</td><td className="comparison-new">{cell(r, r.after)}</td><td className={`comparison-change ${delta.tone}`}>{delta.text}</td></tr>,
    ]; })}</tbody></table></div>
    <p className="holding-table-hint">Company details · Scroll for all share values →</p>
    <div className="table-scroll"><table className="comparison-table company-comparison"><caption>Each company / share</caption><thead><tr><th>Company</th><th>Unit price</th><th>Old units</th><th className="comparison-new">New units</th><th>Old total</th><th className="comparison-new">New total</th><th>E-score</th><th>Old weight</th><th className="comparison-new">New weight</th><th>Action</th></tr></thead>
      <tbody>{positions.map(t => {
        const c = universe.get(t.firm_id), a = tradeAction(t.side, t.w_current, t.w_target);
        return <tr key={t.firm_id}><th scope="row">{c ? <CompanyInfo company={toHolding(c, 0)} /> : t.firm_id}<small className="comparison-symbol">{displayTicker(t.firm_id)}{c ? ` · ${c.sector}` : ""}</small></th>
          <td>{t.price == null ? "Unavailable" : unitMoney(t.price, ccy)}</td><td>{t.shares_current ?? "Unavailable"}</td><td className={`comparison-new ${comparisonChange(t.shares_current, t.shares_target, dec(0)).tone}`}>{t.shares_target ?? "Unavailable"}</td>
          <td>{money(t.capital_current, ccy)}</td><td className={`comparison-new ${comparisonChange(t.capital_current, t.capital_target, x => money(x, ccy)).tone}`}>{money(t.capital_target, ccy)}</td><td>{score(c?.score ?? null)}</td>
          <td>{percent(t.capital_current / rec.total_capital, 1)}</td><td className={`comparison-new ${comparisonChange(t.capital_current / rec.total_capital, t.w_target, pct(1)).tone}`}>{percent(t.w_target, 1)}</td><td><span className={`trade-action ${a.tone}`}>{a.label}</span></td></tr>;
      })}</tbody></table></div></>;
}
