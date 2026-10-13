// Adapters between the engine's API models and the workspace's Portfolio view model.
import type { Company } from "./data";
import type { Recommendation } from "./api";
import type { Holding, Lookup, Portfolio } from "./portfolio";

export type Universe = Map<string, Company>; // ticker -> company
export const MIN_WEIGHT = 0.0005;
// Starting portfolio (ticker -> HKD) shown until the investor uploads their own.
const SAMPLE: Record<string, number> = { "0002.HK": 28000, "0700.HK": 24000, "0066.HK": 20000, "0857.HK": 16000, "0992.HK": 12000 };
const SECTOR_COLORS = ["#438666", "#597fba", "#429797", "#8a79b2", "#b38c45", "#b47567", "#5a846c", "#7f9cc7", "#a68d52", "#9482b8", "#4a9a99", "#bb8f45", "#8b99a6"];

const exchangeOf = (ticker: string) => (ticker.endsWith(".HK") ? "XHKG" : /\.TWO?$/.test(ticker) ? "XTAI" : "Unresolved");
const fmt = (x: number | null | undefined) => (x == null ? "unavailable" : x.toFixed(1));

function explanation(c: Company) {
  if (c.score === null) return "Insufficient data: no environmental score is available for this company in the selected dataset.";
  const flag = c.greenwasher ? " Flagged: stated ambitions outpace documented action." : c.greenhusher ? " Quiet action: documented action exceeds what the company says." : "";
  const assessment = c.assessment_status === "insufficient_data" || c.greenwasher == null || c.greenhusher == null ? " Insufficient data for a greenwashing assessment." : flag || " No signal detected in the available database; this is not a safety assessment.";
  return `E-score ${fmt(c.score)} of 10: emission intensity ranked within ${c.sector}. Dictionary talk score ${fmt(c.talk)}, talk–walk gap ${fmt(c.gap)}.${assessment}`;
}

export function toHolding(c: Company, value: number): Holding {
  return { id: c.ticker, ticker: c.ticker, name: c.name, exchange: exchangeOf(c.ticker), assetClass: "Equity", currency: "HKD",
    value, expectedReturn: null, eScore: c.score, color: c.color, unitPrice: null, units: null, sector: c.sector, greenExplanation: explanation(c) };
}
export const lookupIn = (universe: Universe): Lookup => (ticker) => {
  const c = universe.get(ticker);
  return c ? toHolding(c, 0) : undefined;
};
export function samplePortfolio(universe: Universe): Portfolio | null {
  const holdings = Object.entries(SAMPLE).flatMap(([t, v]) => (universe.has(t) ? [toHolding(universe.get(t)!, v)] : []));
  return holdings.length ? { name: "Sample portfolio", baseCurrency: "HKD", asOf: "Sample", isDemo: true, holdings } : null;
}
export const sectorColor = (sector: string, sectors: string[]) => SECTOR_COLORS[Math.max(0, sectors.indexOf(sector)) % SECTOR_COLORS.length];
/** What the optimizer receives: capital per ticker (cash rows are left out). */
export const holdingsRequest = (p: Portfolio) =>
  Object.fromEntries(p.holdings.filter((h) => h.assetClass.toLowerCase() !== "cash").map((h) => [h.ticker, h.value]));

/** Fills unit price and units the CSV did not supply from the engine's last close. */
export function withPrices(p: Portfolio, rec: Recommendation | null): Portfolio {
  if (!rec) return p;
  const trades = new Map(rec.trades.map((t) => [t.firm_id, t]));
  return { ...p, holdings: p.holdings.map((h) => {
    const t = trades.get(h.ticker);
    return t?.price && h.unitPrice == null ? { ...h, unitPrice: t.price, units: h.units ?? t.shares_current } : h;
  }) };
}

/** The recommended portfolio as holdings: one per position the engine keeps or opens. */
export function recommendedPortfolio(p: Portfolio, rec: Recommendation, universe: Universe): Portfolio {
  const current = new Map(p.holdings.map((h) => [h.ticker, h]));
  const traded = new Set(rec.trades.map((t) => t.firm_id));
  const holdings = rec.trades.filter((t) => t.w_target >= MIN_WEIGHT).map((t): Holding => {
    const base = current.get(t.firm_id) ?? (universe.has(t.firm_id) ? toHolding(universe.get(t.firm_id)!, 0) : null);
    return { ...(base ?? { id: t.firm_id, ticker: t.firm_id, name: t.firm_id, exchange: exchangeOf(t.firm_id), assetClass: "Equity",
      currency: p.baseCurrency, expectedReturn: null, eScore: null, color: "#8b99a6" }),
      value: t.capital_target, unitPrice: t.price, units: t.shares_target };
  });
  // rows the optimizer never saw (cash) carry over unchanged
  return { ...p, name: "Recommended portfolio", holdings: [...holdings, ...p.holdings.filter((h) => !traded.has(h.ticker))] };
}

export type Plan = { industries: string[] | null; tolerancePercent: number };
/** New money the plan adds: the chosen share of today's value, never above the investor's maximum. */
export function newCapital(p: Portfolio, plan: Plan, maximum: number) {
  const total = p.holdings.reduce((sum, h) => sum + h.value, 0);
  return Math.round(Math.min(Math.max(0, (total * plan.tolerancePercent) / 100), maximum) * 100) / 100;
}
/** Investor-facing label for the engine's trade side. */
export function tradeAction(side: string, wCurrent: number, wTarget: number): { label: string; tone: "buy" | "sell" | "" } {
  if (side.startsWith("hold (outside")) return { label: "Kept · outside filter", tone: "" };
  if (side.startsWith("frozen")) return { label: "Kept · not modeled", tone: "" };
  if (side === "buy") return { label: wCurrent < MIN_WEIGHT ? "New" : "Buy more", tone: "buy" };
  if (side.startsWith("sell")) return { label: wTarget < MIN_WEIGHT ? "Sell all" : "Reduce", tone: "sell" };
  return { label: "Hold", tone: "" };
}
